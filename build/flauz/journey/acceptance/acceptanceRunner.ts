/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-013 (B3, Phase C-R wave 6) -- THE FINAL PHASE-C-R ACCEPTANCE RUNNER.
 *
 * LAWS:
 * - A MEASUREMENT INSTRUMENT, NEVER A SECOND AUTHORITY: the activation
 *   WiringMap IS the wiring truth; the battery IS the journey
 *   authority. This module censuses their own published fields and
 *   cites them VERBATIM (state, evidence, entryPoints, tests,
 *   gapOwner, gapNote); it mutates no authority table, holds no
 *   second wiring state, and promotes nothing.
 * - CENSUS, NEVER EXECUTE (the station's QA1 ruling, binding): the
 *   runner never spawns the battery, the dogfood driver, or any
 *   runtime. The suite inventory carries STATION-INJECTED gate
 *   receipts (suite + command + result) echoed verbatim; a suite
 *   without a receipt is disclosed as no-receipt-yet, never
 *   fabricated; a receipt outside the expected list is disclosed,
 *   never dropped.
 * - EXERCISE IS SURFACE CONTACT, NEVER A PROMOTION (the gapClosure
 *   law): a battery leg exercises a WiringMap entry when it contacts
 *   a runtime surface that entry's own record declares (its
 *   stateSource surface or the runtime its gap names). The frozen
 *   BATTERY_LEG_SURFACES table below is the disclosed mapping;
 *   pending-wiring legs exercise nothing (they carry no receipt and
 *   no label).
 * - VERDICTS DEFER TO THE MAP: wired -> closed; gap + exercised ->
 *   exercised-still-gap; gap + unexercised -> unexercised-still-gap
 *   (the gapClosure verdict law, unchanged).
 * - PURE BUILDER + THIN EMISSION (the station's DEFAULT-A ruling):
 *   buildAcceptanceReport is a pure function of its inputs (two calls
 *   over equal inputs produce deep-equal reports; the inputs are
 *   never modified); emitAcceptanceReport writes
 *   acceptance-report.json under the given root via the landed
 *   canonicalJson idiom. The report CONTENT is root-independent.
 * - DETERMINISM: no clock, no randomness, no wall-clock reads of any
 *   kind; sorted aggregations; fixed iteration order (the wiring
 *   entries' own order, the journeys' own order).
 *
 * Gate-round note (station tsc round 1, v2): the record-sorting helper
 * is generic over the value shape. The v1 helper was narrowly typed
 * Record<string, number> and the per-authority census record was forced
 * through it with a cast; strict tsc correctly refused (TS2352/TS2345
 * at the byAuthority seam). Typing-only fix: no runtime byte changes.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ACTIVATION_CONTRACTS_VERSION, WIRING } from '../../zcode-patterns/activation/common/wiring.ts';
import type { WiringEntry } from '../../zcode-patterns/activation/common/wiring.ts';
import {
	allContractModules,
	gapEntries,
	wiredEntries,
	wiringInvariant
} from '../../zcode-patterns/activation/common/coverage.ts';
import { BATTERY_VERSION, JOURNEYS } from '../battery/battery.ts';
import type { BatteryJourney, BatteryStep } from '../battery/battery.ts';
import { canonicalJson, sha256Hex } from '../../cli/runtime/context.ts';

export const ACCEPTANCE_REPORT_VERSION = '1.0.0';
export const ACCEPTANCE_REPORT_NAME = 'acceptance-report.json';

export type ClosureVerdict = 'closed' | 'exercised-still-gap' | 'unexercised-still-gap';

/** A station gate receipt (the QA4 shape: suite + command + result), injected as an input. */
export interface StationGateReceipt {
	readonly suite: string;
	readonly command: string;
	readonly result: string;
}

export interface AcceptanceInputs {
	readonly wiringEntries: readonly WiringEntry[];
	readonly journeys: readonly BatteryJourney[];
	readonly gateReceipts: readonly StationGateReceipt[];
}

/* ------------------------------------------------------------------ */
/* The frozen leg-surface table (the gapClosure LEG_SURFACES         */
/* discipline, battery-leg form): which WiringMap entries a           */
/* runnable battery leg's declared surface contact exercises.        */
/* Every mapping cites the entry's own declared surface or the       */
/* runtime its gap names; pending legs map to nothing.               */
/* ------------------------------------------------------------------ */

interface LegSurface {
	readonly capabilityId: string;
	readonly legKind: string;
	readonly note: string;
}

const DRIVER_SURFACE: LegSurface = {
	capabilityId: 'ZC-001',
	legKind: 'driver-lane',
	note: 'the driver lane over the dogfood authorities (a ZC-001 stateSource surface)'
};

const STORE_AGENT_OS_SURFACE: LegSurface = {
	capabilityId: 'ZC-001',
	legKind: 'store-drill',
	note: "the AGENT_OS authority's orchStore seam (a ZC-001 stateSource surface)"
};

const STORE_BG_RUNTIME_SURFACE: LegSurface = {
	capabilityId: 'ZC-002',
	legKind: 'store-drill',
	note: 'the CR-002 background-agent runtime binding over the real OrchestrationStore'
};

const REGISTRY_SURFACE: LegSurface = {
	capabilityId: 'ZC-006',
	legKind: 'registry-pipeline',
	note: 'the CR-006 registry runtime pipeline (discover/inspect/register/verify/approve) over the capability-exchange authority'
};

const CLI_SURFACE: LegSurface = {
	capabilityId: 'ZC-009',
	legKind: 'cli-lane',
	note: 'the CLI runtime (runCli) consuming the ZC-009 grammar/wire/exitcodes contracts'
};

const ROSTER_SURFACE: LegSurface = {
	capabilityId: 'ZC-002',
	legKind: 'roster',
	note: 'the CR-002 runtime roster projection (bus list + store graphs + journal-derived agents)'
};

const BG_CONTROL_SURFACE: LegSurface = {
	capabilityId: 'ZC-002',
	legKind: 'bg-runtime',
	note: 'the CR-002 background-agent runtime surface behind the wired background-agent.resume leg'
};

const REPLAY_SURFACE: LegSurface = {
	capabilityId: 'ZC-004',
	legKind: 'cold-replay',
	note: 'the CR-004 observatory cold-replay drill (the wired ZC-004 runtime)'
};

const STORE_SURFACES: readonly LegSurface[] = [STORE_AGENT_OS_SURFACE, STORE_BG_RUNTIME_SURFACE];

const STEP_SURFACES: Readonly<Record<string, readonly LegSurface[]>> = {
	'j4-s2-discover': [REGISTRY_SURFACE],
	'j4-s3-inspect': [REGISTRY_SURFACE],
	'j4-s4-import': [REGISTRY_SURFACE],
	'j4-s5-verify': [REGISTRY_SURFACE],
	'j4-s6-approval': [REGISTRY_SURFACE],
	'j5-s1-long-task': STORE_SURFACES,
	'j5-s2-interruption': STORE_SURFACES,
	'j5-s3-restart': STORE_SURFACES,
	'j5-s5-reconstruct': STORE_SURFACES,
	'j5-s6-resume': STORE_SURFACES,
	'j5-s7-complete': STORE_SURFACES,
	'j5-s4-replay': [REPLAY_SURFACE],
	'j6-s1-cli': [CLI_SURFACE],
	'j6-s2-task': [CLI_SURFACE],
	'j6-s3-agent': [CLI_SURFACE, ROSTER_SURFACE],
	'j6-s4-approval': [CLI_SURFACE, ...STORE_SURFACES],
	'j6-s5-evidence': [CLI_SURFACE],
	'j6-s6-restart': STORE_SURFACES,
	'j6-s7-inspect': [CLI_SURFACE],
	'j6-s8-resume': [CLI_SURFACE, BG_CONTROL_SURFACE]
};

function surfacesForStep(journey: BatteryJourney, step: BatteryStep): readonly LegSurface[] {
	if (step.status !== 'runnable-now') {
		return []; /* pending-wiring legs exercise nothing */
	}
	if (journey.execution === 'driver') {
		return [DRIVER_SURFACE];
	}
	return STEP_SURFACES[step.stepId] ?? [];
}

/* ------------------------------------------------------------------ */
/* The frozen expected-suite inventory (the station's own gate model: */
/* every source is a pasted byte or a station ruling).                 */
/* ------------------------------------------------------------------ */

interface ExpectedSuite {
	readonly suite: string;
	readonly sourceOfExpectation: string;
}

const EXPECTED_SUITES: readonly ExpectedSuite[] = [
	{ suite: 'build/flauz/zcode-patterns/activation/test/common/wiring.test.ts', sourceOfExpectation: 'the station ls-files + the pasted suite (Batch 3)' },
	{ suite: 'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.test.ts', sourceOfExpectation: 'the WiringMap ZC-003 tests field' },
	{ suite: 'build/flauz/zcode-patterns/observatory/runtime/observatory.test.ts', sourceOfExpectation: 'the WiringMap ZC-004 tests field' },
	{ suite: 'build/flauz/zcode-patterns/memory/runtime/memoryRuntime.test.ts', sourceOfExpectation: 'the WiringMap ZC-005 tests field' },
	{ suite: 'build/flauz/capabilities/commands/runtime/commandFacade.test.ts', sourceOfExpectation: 'the WiringMap ZC-008 tests field' },
	{ suite: 'build/flauz/journey/battery/battery.test.ts', sourceOfExpectation: 'the station ls-files + the pasted suite (Batch 5)' },
	{ suite: 'build/flauz/cli/cli.test.ts', sourceOfExpectation: 'the station QA5 landed-set census (PR #171)' },
	{ suite: 'build/flauz/cli/compound.test.ts', sourceOfExpectation: 'the station QA5 landed-set census (PR #173)' },
	{ suite: 'build/flauz/journey/simulation/simulation.test.ts', sourceOfExpectation: 'the battery README sibling index (CR-012)' },
	{ suite: 'build/flauz/journey/acceptance/acceptanceRunner.test.ts', sourceOfExpectation: 'this delivery (the acceptance suite itself)' }
];

/* ------------------------------------------------------------------ */
/* The report surface.                                                 */
/* ------------------------------------------------------------------ */

export interface EntryPointView {
	readonly path: string;
	readonly exportName: string | null;
	readonly role: string;
}

export interface ExercisedByRecord {
	readonly legKind: string;
	readonly evidenceLabel: string;
	readonly stepIds: readonly string[];
	readonly journeys: readonly string[];
	readonly note: string;
}

export interface PendingStepView {
	readonly stepId: string;
	readonly pendingOwner: string;
}

export interface MapEntryCensus {
	readonly capabilityId: string;
	readonly title: string;
	readonly authority: string;
	readonly state: string;
	readonly mapEvidence: string;
	readonly entryPoints: readonly EntryPointView[];
	readonly tests: readonly string[];
	readonly gapOwner: string | null;
	readonly gapNote: string | null;
	readonly exercisedBy: readonly ExercisedByRecord[];
	readonly closureVerdict: ClosureVerdict;
	readonly disclosures: readonly string[];
}

export interface MapCensus {
	readonly total: number;
	readonly wired: number;
	readonly gaps: number;
	readonly wiredCapabilityIds: readonly string[];
	readonly gapCapabilityIds: readonly string[];
	readonly byAuthority: Readonly<Record<string, { total: number; wired: number; gaps: number }>>;
	readonly byEvidence: Readonly<Record<string, number>>;
	readonly byGapOwner: Readonly<Record<string, number>>;
	readonly contractModules: number;
	readonly invariantFindings: readonly { capabilityId: string; violations: readonly string[] }[];
}

export interface JourneyCensus {
	readonly journeyId: string;
	readonly title: string;
	readonly execution: string;
	readonly steps: number;
	readonly runnable: number;
	readonly pending: number;
	readonly simulated: number;
	readonly localReal: number;
	readonly pendingByOwner: Readonly<Record<string, number>>;
	readonly pendingSteps: readonly PendingStepView[];
}

export interface LegCensus {
	readonly journeys: readonly JourneyCensus[];
	readonly summary: {
		readonly journeys: number;
		readonly steps: number;
		readonly runnable: number;
		readonly pending: number;
		readonly simulated: number;
		readonly localReal: number;
		readonly pendingByOwner: Readonly<Record<string, number>>;
	};
}

export interface SuiteInventoryRow {
	readonly suite: string;
	readonly sourceOfExpectation: string;
	readonly receipt: { readonly command: string; readonly result: string } | null;
}

export interface SuiteInventory {
	readonly rows: readonly SuiteInventoryRow[];
	readonly summary: {
		readonly expected: number;
		readonly withReceipt: number;
		readonly noReceiptYet: number;
		readonly unknownReceipts: readonly string[];
	};
}

export interface AcceptanceSummary {
	readonly total: number;
	readonly closed: number;
	readonly exercisedStillGap: number;
	readonly unexercisedStillGap: number;
	readonly byGapOwner: Readonly<Record<string, number>>;
	readonly exercisedCapabilityIds: readonly string[];
}

export interface AcceptanceReport {
	readonly version: string;
	readonly generatedFrom: {
		readonly activationContractsVersion: string;
		readonly batteryVersion: string;
		readonly gateReceiptCount: number;
	};
	readonly mapCensus: MapCensus;
	readonly legCensus: LegCensus;
	readonly entries: readonly MapEntryCensus[];
	readonly summary: AcceptanceSummary;
	readonly suiteInventory: SuiteInventory;
	readonly disclosures: readonly string[];
}

/* ------------------------------------------------------------------ */
/* The frozen disclosure strings (the instrument's own laws).          */
/* ------------------------------------------------------------------ */

export const EXERCISE_NEVER_PROMOTES =
	'exercise is evidence of surface contact, never a promotion: the WiringMap remains the only wired/gap authority and every verdict defers to it';

const CENSUS_NEVER_EXECUTES =
	'the acceptance runner censuses, never executes: no battery run, no driver spawn, no runtime invocation -- the suite inventory carries station-injected gate receipts only';

const PENDING_EXERCISES_NOTHING =
	'pending-wiring legs exercise nothing: they carry no receipt and no evidence label, and never count as surface contact';

const RECEIPTS_ARE_STATION_INPUTS =
	'gate receipts are station inputs (suite + command + result), echoed verbatim; a suite without a receipt is disclosed as no-receipt-yet, never fabricated';

/* ------------------------------------------------------------------ */
/* Internals.                                                          */
/* ------------------------------------------------------------------ */

/**
 * Key-sorted copy of a string-keyed record, generic over the value
 * shape (the v2 fix: the v1 helper was Record<string, number>-only and
 * the per-authority census record was forced through it with a cast;
 * the generic routes the type properly and the cast is gone).
 */
function sortedRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
	const sorted: Record<string, T> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = record[key];
	}
	return sorted;
}

function legCensusOf(journeys: readonly BatteryJourney[]): LegCensus {
	const overallPendingByOwner: Record<string, number> = {};
	const byJourney: JourneyCensus[] = journeys.map((journey) => {
		let runnable = 0;
		let pending = 0;
		let simulated = 0;
		let localReal = 0;
		const pendingByOwner: Record<string, number> = {};
		const pendingSteps: PendingStepView[] = [];
		for (const step of journey.steps) {
			if (step.status === 'runnable-now') {
				runnable += 1;
				if (step.evidenceLabel === 'simulated') {
					simulated += 1;
				} else if (step.evidenceLabel === 'local-real') {
					localReal += 1;
				}
			} else {
				pending += 1;
				const owner = step.pendingOwner ?? 'unknown';
				pendingByOwner[owner] = (pendingByOwner[owner] ?? 0) + 1;
				overallPendingByOwner[owner] = (overallPendingByOwner[owner] ?? 0) + 1;
				pendingSteps.push({ stepId: step.stepId, pendingOwner: owner });
			}
		}
		return {
			journeyId: journey.id,
			title: journey.title,
			execution: journey.execution,
			steps: journey.steps.length,
			runnable,
			pending,
			simulated,
			localReal,
			pendingByOwner: sortedRecord(pendingByOwner),
			pendingSteps
		};
	});
	return {
		journeys: byJourney,
		summary: {
			journeys: byJourney.length,
			steps: byJourney.reduce((sum, row) => sum + row.steps, 0),
			runnable: byJourney.reduce((sum, row) => sum + row.runnable, 0),
			pending: byJourney.reduce((sum, row) => sum + row.pending, 0),
			simulated: byJourney.reduce((sum, row) => sum + row.simulated, 0),
			localReal: byJourney.reduce((sum, row) => sum + row.localReal, 0),
			pendingByOwner: sortedRecord(overallPendingByOwner)
		}
	};
}

interface ExerciseGroup {
	readonly capabilityId: string;
	readonly legKind: string;
	readonly evidenceLabel: string;
	readonly note: string;
	readonly stepIds: Set<string>;
	readonly journeys: Set<string>;
}

function exerciseGroupsOf(journeys: readonly BatteryJourney[]): Map<string, ExerciseGroup> {
	const groups = new Map<string, ExerciseGroup>();
	for (const journey of journeys) {
		for (const step of journey.steps) {
			if (step.status !== 'runnable-now') {
				continue;
			}
			for (const surface of surfacesForStep(journey, step)) {
				const key = surface.capabilityId + '|' + surface.legKind + '|' + (step.evidenceLabel ?? '');
				const group = groups.get(key) ?? {
					capabilityId: surface.capabilityId,
					legKind: surface.legKind,
					evidenceLabel: step.evidenceLabel ?? '',
					note: surface.note,
					stepIds: new Set<string>(),
					journeys: new Set<string>()
				};
				group.stepIds.add(step.stepId);
				group.journeys.add(journey.id);
				groups.set(key, group);
			}
		}
	}
	return groups;
}

function suiteInventoryOf(gateReceipts: readonly StationGateReceipt[]): SuiteInventory {
	const receiptBySuite = new Map<string, StationGateReceipt>();
	for (const receipt of gateReceipts) {
		receiptBySuite.set(receipt.suite, receipt);
	}
	const expectedSuites = new Set(EXPECTED_SUITES.map((expected) => expected.suite));
	const rows: SuiteInventoryRow[] = EXPECTED_SUITES.map((expected) => {
		const receipt = receiptBySuite.get(expected.suite);
		return {
			suite: expected.suite,
			sourceOfExpectation: expected.sourceOfExpectation,
			receipt: receipt === undefined ? null : { command: receipt.command, result: receipt.result }
		};
	});
	const unknownReceipts = [...receiptBySuite.keys()].filter((suite) => !expectedSuites.has(suite)).sort();
	const withReceipt = rows.filter((row) => row.receipt !== null).length;
	return {
		rows,
		summary: {
			expected: rows.length,
			withReceipt,
			noReceiptYet: rows.length - withReceipt,
			unknownReceipts
		}
	};
}

/* ------------------------------------------------------------------ */
/* The pure builder (the buildGapLedger image).                        */
/* ------------------------------------------------------------------ */

export function buildAcceptanceReport(input: AcceptanceInputs): AcceptanceReport {
	const entries = input.wiringEntries;
	const wired = wiredEntries(entries);
	const gaps = gapEntries(entries);

	const byAuthority: Record<string, { total: number; wired: number; gaps: number }> = {};
	for (const entry of entries) {
		const row = byAuthority[entry.authority] ?? { total: 0, wired: 0, gaps: 0 };
		row.total += 1;
		if (entry.state === 'wired') {
			row.wired += 1;
		} else {
			row.gaps += 1;
		}
		byAuthority[entry.authority] = row;
	}

	const byEvidence: Record<string, number> = {};
	for (const entry of entries) {
		byEvidence[entry.evidence] = (byEvidence[entry.evidence] ?? 0) + 1;
	}

	const byGapOwner: Record<string, number> = {};
	for (const entry of gaps) {
		if (entry.gapOwner !== undefined) {
			byGapOwner[entry.gapOwner] = (byGapOwner[entry.gapOwner] ?? 0) + 1;
		}
	}

	const invariantFindings = entries.flatMap((entry) => {
		const result = wiringInvariant(entry);
		return result.ok ? [] : [{ capabilityId: entry.capabilityId, violations: [...result.violations] }];
	});
	const findingsByCapability = new Map(invariantFindings.map((finding) => [finding.capabilityId, finding]));

	const groups = exerciseGroupsOf(input.journeys);
	const entryCensuses: MapEntryCensus[] = entries.map((entry) => {
		const exercisedBy: ExercisedByRecord[] = [];
		for (const group of groups.values()) {
			if (group.capabilityId === entry.capabilityId) {
				exercisedBy.push({
					legKind: group.legKind,
					evidenceLabel: group.evidenceLabel,
					stepIds: [...group.stepIds].sort(),
					journeys: [...group.journeys].sort(),
					note: group.note
				});
			}
		}
		exercisedBy.sort((a, b) => (a.legKind < b.legKind ? -1 : a.legKind > b.legKind ? 1 : 0));
		const closureVerdict: ClosureVerdict =
			entry.state === 'wired' ? 'closed' : exercisedBy.length > 0 ? 'exercised-still-gap' : 'unexercised-still-gap';
		const disclosures: string[] = [];
		if (findingsByCapability.has(entry.capabilityId)) {
			disclosures.push('the map\'s own law-checker (wiringInvariant) reports violations for this entry; they are carried verbatim in mapCensus.invariantFindings');
		}
		return {
			capabilityId: entry.capabilityId,
			title: entry.title,
			authority: entry.authority,
			state: entry.state,
			mapEvidence: entry.evidence,
			entryPoints: entry.entryPoints.map((point) => ({
				path: point.path,
				exportName: point.exportName ?? null,
				role: point.role
			})),
			tests: [...entry.tests],
			gapOwner: entry.gapOwner ?? null,
			gapNote: entry.gapNote ?? null,
			exercisedBy,
			closureVerdict,
			disclosures
		};
	});

	const ownerCounts = new Map<string, number>();
	for (const entry of gaps) {
		if (entry.gapOwner !== undefined) {
			ownerCounts.set(entry.gapOwner, (ownerCounts.get(entry.gapOwner) ?? 0) + 1);
		}
	}
	const summaryByGapOwner: Record<string, number> = {};
	for (const owner of [...ownerCounts.keys()].sort()) {
		summaryByGapOwner[owner] = ownerCounts.get(owner) ?? 0;
	}

	return {
		version: ACCEPTANCE_REPORT_VERSION,
		generatedFrom: {
			activationContractsVersion: ACTIVATION_CONTRACTS_VERSION,
			batteryVersion: BATTERY_VERSION,
			gateReceiptCount: input.gateReceipts.length
		},
		mapCensus: {
			total: entries.length,
			wired: wired.length,
			gaps: gaps.length,
			wiredCapabilityIds: wired.map((entry) => entry.capabilityId),
			gapCapabilityIds: gaps.map((entry) => entry.capabilityId),
			byAuthority: sortedRecord(byAuthority),
			byEvidence: sortedRecord(byEvidence),
			byGapOwner: sortedRecord(byGapOwner),
			contractModules: allContractModules(entries).length,
			invariantFindings
		},
		legCensus: legCensusOf(input.journeys),
		entries: entryCensuses,
		summary: {
			total: entryCensuses.length,
			closed: entryCensuses.filter((row) => row.closureVerdict === 'closed').length,
			exercisedStillGap: entryCensuses.filter((row) => row.closureVerdict === 'exercised-still-gap').length,
			unexercisedStillGap: entryCensuses.filter((row) => row.closureVerdict === 'unexercised-still-gap').length,
			byGapOwner: summaryByGapOwner,
			exercisedCapabilityIds: entryCensuses.filter((row) => row.exercisedBy.length > 0).map((row) => row.capabilityId).sort()
		},
		suiteInventory: suiteInventoryOf(input.gateReceipts),
		disclosures: [EXERCISE_NEVER_PROMOTES, CENSUS_NEVER_EXECUTES, PENDING_EXERCISES_NOTHING, RECEIPTS_ARE_STATION_INPUTS]
	};
}

/* ------------------------------------------------------------------ */
/* The emission (the DEFAULT-A ruling: output-only, root-independent  */
/* content, canonicalJson + sha256Hex, no clock).                      */
/* ------------------------------------------------------------------ */

export interface AcceptanceEmission {
	readonly ok: true;
	readonly path: string;
	readonly digest: string;
	readonly bytes: number;
}

export async function emitAcceptanceReport(root: string, report: AcceptanceReport): Promise<AcceptanceEmission> {
	const dir = resolve(root);
	await mkdir(dir, { recursive: true });
	const body = canonicalJson(report);
	const target = join(dir, ACCEPTANCE_REPORT_NAME);
	await writeFile(target, body + '\n', 'utf8');
	return { ok: true, path: target, digest: sha256Hex(body), bytes: body.length + 1 };
}

export interface AcceptanceRunOutcome {
	readonly report: AcceptanceReport;
	readonly emission: AcceptanceEmission;
}

/**
 * The convenience entry over the LIVE authorities (read-only imports;
 * nothing executes): builds the report from the landed WIRING map and
 * JOURNEYS manifest plus the injected station gate receipts, and emits
 * it under the given root.
 */
export async function runAcceptance(options: {
	readonly root: string;
	readonly gateReceipts?: readonly StationGateReceipt[];
}): Promise<AcceptanceRunOutcome> {
	const report = buildAcceptanceReport({
		wiringEntries: WIRING,
		journeys: JOURNEYS,
		gateReceipts: options.gateReceipts ?? []
	});
	const emission = await emitAcceptanceReport(options.root, report);
	return { report, emission };
}
