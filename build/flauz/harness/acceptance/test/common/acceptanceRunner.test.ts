/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see LICENSE in the repository root for
 * additional information.
 *
 * DH-013 acceptance runner battery: the fail-closed factory (every
 * option station, the one-clock/one-rng read law), THE CROSS-INDUSTRY
 * CROWN (the four industries journey-complete through the REAL kits -
 * the REAL DH-01 authority re-read at 'active' for every industry,
 * the DH-10 navigation models populated, the SE benchmark evaluated +
 * the REAL LAB closedLoop routed, the DH-12 optimization
 * recommendations auditable, the twelve-version identity census green,
 * every gap-ledger row registered, the overall verdict green, the
 * canonical report emitted + re-parsed + byte-stable), THE FAIL-CLOSED
 * PINS (a refused journey leg fails the whole verdict - CORRUPT_SEAM
 * budget pin; the malformed-fixture pins with the contract's typed
 * rejection table carried verbatim; THE UNIQUE-INDUSTRY LAW; the
 * fresh-kit guard), THE COMPOSITION-NOT-FORK PINS (the census
 * identity, the pure-data fixture modules, the runner's NO
 * industry-string-branch source law, THE IMPORT LAW, the
 * fifth-industry data-only proof), THE PERSISTENCE MIRROR (the frozen
 * line schema, the op order, the payload walks, the envelope
 * cross-check, restart determinism at two points, the resumable
 * terminal walk, every torn/tampered/drifted/unknown/repeated/
 * out-of-order line refused E_LEDGER_TORN, the envelope
 * missing/divergent refused E_ENVELOPE_MISMATCH, the IO refusals),
 * THE DISPOSE LAW and the in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
        ACCEPTANCE_ENVELOPE_RELATIVE_PATH,
        ACCEPTANCE_ENVELOPE_SCHEMA_KEYS,
        ACCEPTANCE_LEDGER_LINE_SCHEMA_KEYS,
        ACCEPTANCE_LEDGER_RELATIVE_PATH,
        ACCEPTANCE_OP_NAMES,
        ACCEPTANCE_REPORT_RELATIVE_PATH,
        ACCEPTANCE_RUNNER_REFUSAL_REASONS,
        createAcceptanceRunner,
        loadAcceptanceRunner,
} from '../../common/acceptanceRunner.js';
import type { AcceptanceRunner, AcceptanceRunnerRefusal, IndustryRunOutcome, CrossIndustryRunOutcome } from '../../common/acceptanceRunner.js';
import {
        ACCEPTANCE_GAP_KEYS,
        ACCEPTANCE_INDUSTRIES,
        COMPOSITION_VERSION_FAMILY_KEYS,
        DOMAIN_NAVIGATION_SECTIONS,
        HARNESS_ACCEPTANCE_GAP_LEDGER,
        HARNESS_ACCEPTANCE_VERSION,
        LAB_CONTRACTS_VERSION,
        parseAcceptanceReport,
        serializeAcceptanceReport,
} from '../../common/acceptanceContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        ONTOLOGY_CONTRACTS_VERSION,
        TEMPLATES_CONTRACTS_VERSION,
        BODIES_CONTRACTS_VERSION,
        PACKS_CONTRACTS_VERSION,
        PROFILES_CONTRACTS_VERSION,
        BENCHMARKS_CONTRACTS_VERSION,
        PROJECTIONS_CONTRACTS_VERSION,
        ACTIVATION_CONTRACTS_VERSION,
        OPTIMIZATION_CONTRACTS_VERSION,
} from '../../common/acceptanceContract.js';
import { loadHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import type { HarnessFsPort } from '../../../contract/common/domainHarnessKit.js';
import { SOFTWARE_ACCEPTANCE_FIXTURE } from '../../industries/software.js';
import { FINANCE_ACCEPTANCE_FIXTURE } from '../../industries/finance.js';
import { HEALTHCARE_ACCEPTANCE_FIXTURE } from '../../industries/healthcare.js';
import { CONSTRUCTION_ACCEPTANCE_FIXTURE } from '../../industries/construction.js';
import type { IndustryAcceptanceFixture, IndustryAcceptanceVerdict, HarnessAcceptanceReport } from '../../common/acceptanceContract.js';

const RUNNER_SOURCE = readFileSync(fileURLToPath(new URL('../../common/acceptanceRunner.ts', import.meta.url)), 'utf8');
const INDUSTRY_SOURCES: readonly string[] = ['software', 'finance', 'healthcare', 'construction'].map(
        (name) => readFileSync(fileURLToPath(new URL(`../../industries/${name}.ts`, import.meta.url)), 'utf8'),
);

/** The twelve family versions imported by reference (THE IMPORT LAW's cross-pin constants). */
const FAMILY_VERSIONS: Readonly<Record<string, string>> = {
        'domain-harness': DOMAIN_HARNESS_CONTRACTS_VERSION,
        onboarding: ONBOARDING_CONTRACTS_VERSION,
        roles: ROLES_CONTRACTS_VERSION,
        ontology: ONTOLOGY_CONTRACTS_VERSION,
        templates: TEMPLATES_CONTRACTS_VERSION,
        bodies: BODIES_CONTRACTS_VERSION,
        packs: PACKS_CONTRACTS_VERSION,
        profiles: PROFILES_CONTRACTS_VERSION,
        benchmarks: BENCHMARKS_CONTRACTS_VERSION,
        projections: PROJECTIONS_CONTRACTS_VERSION,
        activation: ACTIVATION_CONTRACTS_VERSION,
        optimization: OPTIMIZATION_CONTRACTS_VERSION,
};

const LANE_FIXTURES: Readonly<Record<string, IndustryAcceptanceFixture>> = {
        software: SOFTWARE_ACCEPTANCE_FIXTURE,
        finance: FINANCE_ACCEPTANCE_FIXTURE,
        healthcare: HEALTHCARE_ACCEPTANCE_FIXTURE,
        construction: CONSTRUCTION_ACCEPTANCE_FIXTURE,
};

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT; selective refusals isolate the acceptance family's own files). */
class MemoryFsPort {
        readonly files = new Map<string, string>();
        refuseAppends = false;
        refuseWrites = false;
        refuseMkdirs = false;
        refuseReads = false;
        /** The selective mode: when set, only paths containing this fragment refuse (isolates the acceptance family's own files). */
        selectFragment: string | null = null;
        private refused(path: string, flag: boolean): boolean {
                if (!flag) {
                        return false;
                }
                return this.selectFragment === null || path.includes(this.selectFragment);
        }
        async readFile(path: string): Promise<string> {
                if (this.refused(path, this.refuseReads)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                if (!this.files.has(path)) {
                        throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
                }
                return this.files.get(path) as string;
        }
        async writeFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseWrites)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, text);
        }
        async appendFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseAppends)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, (this.files.get(path) ?? '') + text);
        }
        async mkdir(): Promise<void> {
                if (this.refuseMkdirs) {
                        throw { code: 'EACCES', message: 'refused mkdir' };
                }
        }
        dump(path: string): string | undefined {
                return this.files.get(path);
        }
        overwrite(path: string, text: string): void {
                this.files.set(path, text);
        }
        remove(path: string): void {
                this.files.delete(path);
        }
}

function makeSeams(): { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number } {
        let clockCount = 0;
        let rngCount = 0;
        return {
                clock: () => {
                        clockCount += 1;
                        return `2026-03-03T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
                },
                rng: () => {
                        rngCount += 1;
                        return rngCount.toString(16).padStart(16, '0');
                },
                clockReads: () => clockCount,
                rngReads: () => rngCount,
        };
}

/** A structural deep copy (JSON) of a fixture for the mutation stations. */
function copy(fixture: unknown): Record<string, unknown> {
        return JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
}

/** The typed refusal extractor (the family pattern: a failed narrowing is a test bug, never a pass). */
function mustRefuse(outcome: { readonly ok: boolean } & ({ readonly ok: true } | { readonly ok: false; refusal: AcceptanceRunnerRefusal })): AcceptanceRunnerRefusal {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

/** The ok-run extractor for the crown lanes. */
function mustComplete(outcome: CrossIndustryRunOutcome): { readonly report: HarnessAcceptanceReport; readonly bytes: number; readonly appendedOps: number } {
        if (!outcome.ok) {
                throw new Error(`the cross run refused: ${outcome.refusal.reason}: ${outcome.refusal.message}`);
        }
        return { report: outcome.report, bytes: outcome.emission.bytes, appendedOps: outcome.emission.appendedOps };
}

interface CrownRig {
        readonly runner: AcceptanceRunner;
        readonly port: MemoryFsPort;
        readonly seams: ReturnType<typeof makeSeams>;
        readonly report: HarnessAcceptanceReport;
        readonly bytes: number;
}

/** THE CROWN RIG (memoized): ONE full cross-industry run shared by the crown suites. */
let crownCache: CrownRig | null = null;
async function crown(): Promise<CrownRig> {
        if (crownCache !== null) {
                return crownCache;
        }
        const port = new MemoryFsPort();
        const seams = makeSeams();
        const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
        const outcome = await runner.runCrossIndustryAcceptance();
        const complete = mustComplete(outcome);
        crownCache = { runner, port, seams, report: complete.report, bytes: complete.bytes };
        return crownCache;
}

/** The ledger's parsed lines (the frozen eight-key schema, one JSON object per line; an absent ledger carries ZERO lines). */
function ledgerLines(port: MemoryFsPort): Record<string, unknown>[] {
        const text = port.dump('ws/.flauz/harness/acceptance-ops.jsonl');
        if (text === undefined) {
                return [];
        }
        return text.split('\n').filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Rewrites the acceptance ledger with a mutation over its parsed lines (the tamper stations). */
function rewriteLedger(port: MemoryFsPort, mutate: (lines: Record<string, unknown>[]) => Record<string, unknown>[]): string {
        const lines = mutate(ledgerLines(port));
        const text = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
        port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', text);
        return text;
}

/** The envelope the replay expects for the given ledger state (the byte-for-byte cross-check's content). */
function expectedEnvelope(industries: string[], compositionCensus: boolean, overallVerdict: string | null, report: { path: string; bytes: number } | null, seq: number): string {
        return `${JSON.stringify({ contractVersion: HARNESS_ACCEPTANCE_VERSION, seq, run: { industries, compositionCensus, overallVerdict, report } })}\n`;
}

// --- the fail-closed factory -----------------------------------------------------------------------------------

suite('acceptanceRunner · the fail-closed factory', () => {
        test('the options shape: every missing / malformed station throws (clock / rng / fsPort / root)', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                for (const badOptions of [
                        undefined,
                        null,
                        42,
                        { rng: seams.rng, fsPort: port, root: 'ws' },
                        { clock: seams.clock, fsPort: port, root: 'ws' },
                        { clock: seams.clock, rng: seams.rng, root: 'ws' },
                        { clock: seams.clock, rng: seams.rng, fsPort: port },
                ] as unknown[]) {
                        assert.throws(() => createAcceptanceRunner(badOptions as never), /createAcceptanceRunner/);
                }
        });

        test("the clock's first read must be a non-empty ISO string (the injected-clock law)", () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                for (const badClock of [() => '', () => 42, () => null]) {
                        assert.throws(() => createAcceptanceRunner({ clock: badClock as never, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' }), /options\.clock/);
                }
        });

        test("the rng's first read must be exactly 16 lowercase hex chars (the id-minting seam - NEVER the random global)", () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                for (const badRng of [() => '', () => 'XYZ', () => '0000000000000001a', () => '00000000000000A1', () => 42]) {
                        assert.throws(() => createAcceptanceRunner({ clock: seams.clock, rng: badRng as never, fsPort: port as unknown as HarnessFsPort, root: 'ws' }), /options\.rng/);
                }
        });

        test("the fs port's four functions are required (the ONLY filesystem seam)", () => {
                const seams = makeSeams();
                const partial = { readFile: () => 'x' } as never;
                assert.throws(() => createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: partial, root: 'ws' }), /readFile|writeFile|appendFile|mkdir/);
        });

        test('the root must be a non-empty string (the persistence pair is required, never optional)', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                assert.throws(() => createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' }), /options\.root/);
                assert.throws(() => createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 42 as never }), /options\.root/);
        });

        test('THE ONE-READ LAW: the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: new MemoryFsPort() as unknown as HarnessFsPort, root: 'ws' });
                assert.strictEqual(seams.clockReads(), 1);
                assert.strictEqual(seams.rngReads(), 1);
        });

        test('loadAcceptanceRunner carries the SAME factory discipline (the same preconditions, the loadAcceptanceRunner prefix)', async () => {
                const seams = makeSeams();
                await assert.rejects(() => loadAcceptanceRunner({ clock: () => '', rng: seams.rng, fsPort: new MemoryFsPort() as unknown as HarnessFsPort, root: 'ws' }), /loadAcceptanceRunner: options\.clock/);
                await assert.rejects(() => loadAcceptanceRunner({ clock: seams.clock, rng: () => 'nope', fsPort: new MemoryFsPort() as unknown as HarnessFsPort, root: 'ws' }), /loadAcceptanceRunner: options\.rng/);
        });

        test('a fresh root reopens as an empty runner; an envelope without a ledger refuses E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const fresh = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(fresh.ok);
                const inspected = fresh.runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.rows.length, 0);
                assert.strictEqual(inspected.complete, false);
                const orphan = new MemoryFsPort();
                orphan.overwrite('ws/.flauz/harness/acceptance-runs.json', '{}\n');
                const refusedReload = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: orphan as unknown as HarnessFsPort, root: 'ws' });
                assert.strictEqual(mustRefuse(refusedReload).reason, 'E_ENVELOPE_MISMATCH');
        });

        test('the frozen runner refusal vocabulary (the sixteen stations)', () => {
                assert.strictEqual(ACCEPTANCE_RUNNER_REFUSAL_REASONS.length, 16);
                assert.ok((ACCEPTANCE_RUNNER_REFUSAL_REASONS as readonly string[]).includes('journey-refused'));
                assert.ok((ACCEPTANCE_RUNNER_REFUSAL_REASONS as readonly string[]).includes('E_LEDGER_TORN'));
        });
});

// --- the cross-industry crown ----------------------------------------------------------------------------------

suite('acceptanceRunner · THE CROSS-INDUSTRY CROWN (the four industries through the ONE shared real kit construction)', () => {
        test('THE OVERALL VERDICT IS COMPLETE: four industries complete, zero refused, all six ledger rows registered (THE FAIL-CLOSED VERDICT LAW)', async () => {
                const rig = await crown();
                const verdict = rig.report.overallVerdict;
                assert.strictEqual(verdict.verdict, 'complete');
                assert.strictEqual(verdict.industriesComplete, 4);
                assert.strictEqual(verdict.industriesRefused, 0);
                assert.strictEqual(verdict.gapRowsRegistered, HARNESS_ACCEPTANCE_GAP_LEDGER.length);
                assert.strictEqual(verdict.refusalReason, null);
        });

        test('the four industries in the FROZEN lane order (software, finance, healthcare, construction)', async () => {
                const rig = await crown();
                assert.deepStrictEqual(rig.report.industries.map((row) => row.industry), [...ACCEPTANCE_INDUSTRIES]);
        });

        test('every industry\'s journey leg is complete and its journey record sits at the active terminal', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.journey.verdict, 'complete', row.industry);
                        assert.strictEqual(row.journey.journeyStage, 'active', `${row.industry}: the journey stage machine's terminal`);
                        assert.ok(row.journey.journeyId.startsWith('flauz:jrn:'), `${row.industry}: a REAL journey id`);
                        assert.ok(row.journey.harnessId.startsWith('flauz:hrn:'), `${row.industry}: a REAL harness id`);
                        assert.ok(row.journey.bindingHarnessId.startsWith('flauz:hrn:'), `${row.industry}: a REAL binding harness id (THE LINEAGE LAW)`);
                }
        });

        test('THE EVIDENCE-NOT-AUTHORITY LAW: every industry\'s harness record re-read from the REAL DH-01 authority\'s own ledger at \'active\'', async () => {
                const rig = await crown();
                const catalog = { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] };
                const loaded = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(loaded.ok);
                for (const row of rig.report.industries) {
                        const inspected = await loaded.kit.inspectHarness(row.journey.harnessId);
                        assert.ok(inspected.ok, `${row.industry}: the authority re-read`);
                        assert.strictEqual(inspected.record.state, 'active', `${row.industry}: the REAL DH-01 lifecycle end-state`);
                        assert.strictEqual(inspected.record.contractVersion, DOMAIN_HARNESS_CONTRACTS_VERSION, `${row.industry}: the real DH-01 record version`);
                }
        });

        test('THE DH-01 LIFECYCLE AUTHORITY PINS: the transitions walked draft -> proposed -> approved -> active through the real machine', async () => {
                const rig = await crown();
                const catalog = { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] };
                const loaded = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(loaded.ok);
                for (const row of rig.report.industries) {
                        assert.deepStrictEqual([...row.taskExecution.authorityTransitionsWalked], ['draft', 'proposed', 'approved', 'active'], row.industry);
                        const inspected = await loaded.kit.inspectHarness(row.journey.harnessId);
                        assert.ok(inspected.ok);
                        const walked: string[] = inspected.record.history.map((note: { readonly toState: string }) => note.toState);
                        assert.deepStrictEqual(walked, ['draft', 'proposed', 'approved', 'active'], `${row.industry}: the authority's own history notes`);
                }
        });

        test('THE APPROVALS LEG: the user approval and activation decisions recorded pre-activation (the evidence mirror)', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.approvals.verdict, 'complete');
                        assert.strictEqual(row.approvals.approvedBy, 'acceptance-approver');
                        assert.strictEqual(row.approvals.activatedBy, 'acceptance-activator');
                        assert.strictEqual(row.approvals.recordedBeforeActivation, true);
                        assert.strictEqual(row.journey.approvalRecorded, true);
                        assert.strictEqual(row.journey.activationRecorded, true);
                }
        });

        test('THE ROLE-COMPOSITION LEG: the composed role keys are the fixture\'s own three roles (THE MULTI-ROLE LAW)', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.roleComposition.verdict, 'complete');
                        assert.deepStrictEqual([...row.roleComposition.roleKeys], LANE_FIXTURES[row.industry].roles.map((role) => role.roleKey), row.industry);
                        assert.strictEqual(row.roleComposition.roleKeys.length, 3, `${row.industry}: the curated three-role composition`);
                        assert.ok(row.roleComposition.rolesSessionId.startsWith('flauz:rol:'), `${row.industry}: a REAL roles session id`);
                }
        });

        test('THE WORKFLOWS LEG: the composed task keys and term refs are the fixture\'s own (term-resolved)', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.workflows.verdict, 'complete');
                        assert.deepStrictEqual([...row.workflows.taskKeys], LANE_FIXTURES[row.industry].tasks.map((task) => task.taskKey), row.industry);
                        assert.deepStrictEqual([...row.workflows.termRefs], LANE_FIXTURES[row.industry].tasks.flatMap((task) => [...task.termRefs]), row.industry);
                        assert.strictEqual(row.workflows.termResolution, 'resolved');
                }
        });

        test('THE POLICIES LEG: the composed permission refs and approval tiers are the fixture\'s own REAL members', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.policies.verdict, 'complete');
                        assert.deepStrictEqual([...row.policies.profileKeys], LANE_FIXTURES[row.industry].profiles.map((profile) => profile.profileKey), row.industry);
                        assert.deepStrictEqual([...row.policies.permissionRefs], [...new Set(LANE_FIXTURES[row.industry].profiles.flatMap((profile) => [...profile.permissionRefs]))], row.industry);
                        assert.deepStrictEqual([...row.policies.approvalTiers], [...new Set(LANE_FIXTURES[row.industry].profiles.flatMap((profile) => [...profile.approvalTiers]))], row.industry);
                }
        });

        test('THE EVIDENCE LEG: the composed evidence floors are the fixture\'s own REAL ladder rungs', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.evidence.verdict, 'complete');
                        assert.deepStrictEqual([...row.evidence.evidenceFloors], LANE_FIXTURES[row.industry].profiles.map((profile) => profile.evidenceFloor), row.industry);
                }
        });

        test('THE UI-BEHAVIOR LEG: the DH-10 navigation model derived per industry - the REAL section alphabet, every section populated', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.uiBehavior.verdict, 'complete');
                        assert.strictEqual(row.uiBehavior.anchorHarnessId, row.journey.bindingHarnessId, `${row.industry}: THE LINEAGE LAW - the model anchors on the binding composition root`);
                        assert.deepStrictEqual(row.uiBehavior.sections.map((section) => section.section), [...DOMAIN_NAVIGATION_SECTIONS], row.industry);
                        assert.strictEqual(row.uiBehavior.populatedSections, DOMAIN_NAVIGATION_SECTIONS.length, `${row.industry}: every section populated after a complete journey`);
                        assert.strictEqual(row.uiBehavior.notComposedSections, 0);
                        for (const section of row.uiBehavior.sections) {
                                assert.strictEqual(section.state, 'populated', `${row.industry}/${section.section}: THE SECTION-STATE LAW's honest two-state projection`);
                                assert.ok(section.rowCount > 0, `${row.industry}/${section.section}: the derived row count`);
                        }
                }
        });

        test('THE CAPABILITY-GAPS LEG: the software row registers the five non-world rows; the other three register all six (world-coverage included)', async () => {
                const rig = await crown();
                const software = rig.report.industries[0];
                assert.ok(!software.capabilityGaps.registeredGapKeys.includes('lab-task-worlds-coverage'), 'the software row does not register the world-coverage row (its benchmark leg IS evaluated)');
                for (const row of rig.report.industries.slice(1)) {
                        assert.ok(row.capabilityGaps.registeredGapKeys.includes('lab-task-worlds-coverage'), `${row.industry}: the honest world-coverage row`);
                }
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.capabilityGaps.verdict, 'complete');
                        for (const gapRow of row.expectedGaps) {
                                const frozen = HARNESS_ACCEPTANCE_GAP_LEDGER.find((ledgerRow) => ledgerRow.gapKey === gapRow.gapKey);
                                assert.ok(frozen !== undefined);
                                assert.strictEqual(gapRow.description, frozen.description, `${row.industry}/${gapRow.gapKey}: VERBATIM`);
                                assert.strictEqual(gapRow.evidenceLevel, frozen.evidenceLevel);
                                assert.strictEqual(gapRow.owner, frozen.owner);
                        }
                }
        });

        test('THE TASK-EXECUTION LEG (software): the LAB closedLoop fixture execution routed - four executions, the loop closed, the honest scores', async () => {
                const rig = await crown();
                const software = rig.report.industries[0];
                assert.strictEqual(software.taskExecution.verdict, 'complete');
                assert.strictEqual(software.taskExecution.closedLoopExecutions, 4, 'the closedLoop execution count (the seeded instance count)');
                assert.strictEqual(software.taskExecution.closedLoopLoopClosed, true, 'the ten-stage loop closed');
                assert.deepStrictEqual(software.taskExecution.benchmarkScores?.map((score) => score.dimension), ['success', 'quality'], 'exactly the declared KPI dimensions (THE HONEST-MEASURE LAW)');
                assert.ok(software.taskExecution.benchmarkEvidenceLevel === 'fixture', 'the honest evidence level');
        });

        test('THE TASK-EXECUTION LEG (non-software): the honest nulls + the execution disclosure carried verbatim', async () => {
                const rig = await crown();
                for (const row of rig.report.industries.slice(1)) {
                        assert.strictEqual(row.taskExecution.closedLoopExecutions, null, `${row.industry}: no closedLoop claim without a curated benchmark`);
                        assert.strictEqual(row.taskExecution.closedLoopLoopClosed, null);
                        assert.strictEqual(row.taskExecution.benchmarkScores, null);
                        assert.strictEqual(row.taskExecution.benchmarkEvidenceLevel, null);
                        assert.strictEqual(row.taskExecution.authorityState, 'active', `${row.industry}: the DH-01 authority pin still proven`);
                        assert.ok(row.taskExecution.executionDisclosure.includes('fixture-level evidence, honestly labeled'));
                }
        });

        test('THE BENCHMARK STATUS: software evaluated; finance / healthcare / construction gap-registered', async () => {
                const rig = await crown();
                assert.strictEqual(rig.report.industries[0].benchmarkStatus, 'evaluated');
                for (const row of rig.report.industries.slice(1)) {
                        assert.strictEqual(row.benchmarkStatus, 'gap-registered', row.industry);
                }
        });

        test('THE COMPOSITION-NOT-FORK CENSUS: the twelve family versions identical across all four industries AND equal to the imported constants', async () => {
                const rig = await crown();
                const census = rig.report.compositionCensus;
                assert.deepStrictEqual(census.rows.map((row) => row.family), [...COMPOSITION_VERSION_FAMILY_KEYS]);
                for (const row of census.rows) {
                        assert.strictEqual(row.identicalAcrossIndustries, true, row.family);
                        assert.strictEqual(row.contractVersion, FAMILY_VERSIONS[row.family], `${row.family}: the imported family constant`);
                }
                assert.strictEqual(census.labContractsVersion, LAB_CONTRACTS_VERSION);
                assert.deepStrictEqual([...census.industriesServed], [...ACCEPTANCE_INDUSTRIES]);
                assert.deepStrictEqual([...census.sharedKitConstructions], ['activation-kit', 'projections-kit', 'optimization-kit']);
                assert.strictEqual(census.fixturesArePureData, true);
        });

        test('every industry row carries the twelve-family composedRecordVersions map (the census input)', async () => {
                const rig = await crown();
                for (const row of rig.report.industries) {
                        assert.deepStrictEqual(Object.keys(row.composedRecordVersions).sort(), [...COMPOSITION_VERSION_FAMILY_KEYS].sort(), row.industry);
                        for (const [family, version] of Object.entries(row.composedRecordVersions)) {
                                assert.strictEqual(version, FAMILY_VERSIONS[family], `${row.industry}/${family}`);
                        }
                }
        });

        test('the honest gap ledger rides the report VERBATIM (the six frozen rows)', async () => {
                const rig = await crown();
                assert.deepStrictEqual(rig.report.gapLedger.map((row) => row.gapKey), [...ACCEPTANCE_GAP_KEYS]);
                assert.deepStrictEqual(rig.report.gapLedger, HARNESS_ACCEPTANCE_GAP_LEDGER.map((row) => ({ gapKey: row.gapKey, description: row.description, evidenceLevel: row.evidenceLevel, owner: row.owner })));
        });

        test('the four frozen disclosures ride the report (the content / evidence / composition / fail-closed laws)', async () => {
                const rig = await crown();
                assert.strictEqual(rig.report.disclosures.length, 4);
                assert.ok(rig.report.disclosures[0].includes('curated fixture-level acceptance content'));
                assert.ok(rig.report.disclosures[1].includes('LAB closedLoop fixture execution'));
                assert.ok(rig.report.disclosures[2].includes('the industries differ only in data'));
                assert.ok(rig.report.disclosures[3].includes('fail-closed'));
        });

        test('THE HONEST RECEIPT: a fresh full cross run appends exactly the eight canonical lines', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const complete = mustComplete(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(complete.appendedOps, 8, 'the receipt counts exactly the lines THIS call landed');
                assert.strictEqual(ledgerLines(port).length, 8);
                runner.dispose();
        });

        test('THE MIXED WALK: a manually-run industry is resumed, the cross run drives ONLY the remaining industries + the terminal walk', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE))).ok);
                const complete = mustComplete(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(complete.appendedOps, 7, 'three remaining industries + the four terminal lines');
                assert.strictEqual(ledgerLines(port).length, 8);
                assert.deepStrictEqual(ledgerLines(port).map((line) => line.industry), [...ACCEPTANCE_INDUSTRIES, null, null, null, null], 'the frozen lane order holds over the mixed walk');
                runner.dispose();
        });

        test('THE DETERMINISTIC MEASURES: the SE benchmark scores are the reproducible fixture-derived values (seeded, rounded to 3 decimals)', async () => {
                const rig = await crown();
                const software = rig.report.industries[0];
                assert.deepStrictEqual(software.taskExecution.benchmarkScores?.map((score) => ({ dimension: score.dimension, value: score.value })), [
                        { dimension: 'success', value: 0.333 },
                        { dimension: 'quality', value: 0.37 },
                ]);
        });

        test("THE REGISTRY-BOUND DERIVATION: the DH-09 family's own ledger carries the curated SE benchmark key and the three registry-bound non-SE keys (data-derived, never an industry branch)", async () => {
                const rig = await crown();
                const benchmarksLedger = rig.port.dump('ws/.flauz/harness/benchmarks-ops.jsonl');
                assert.ok(benchmarksLedger !== undefined, 'the REAL DH-09 family ledger exists under the shared root');
                assert.ok((benchmarksLedger as string).includes('regression-suite-health'), 'the software journey composed the CURATED benchmark (bound to the REAL three SE scenarios)');
                for (const industry of ['finance', 'healthcare', 'construction']) {
                        assert.ok((benchmarksLedger as string).includes(`${industry}-registry-bound-acceptance`), `the ${industry} journey composed the REGISTRY-BOUND benchmark (the honest compose floor over the only REAL scenarios)`);
                }
                assert.ok(RUNNER_SOURCE.includes('journeyBenchmarkOf'), 'the derivation is uniform over the fixture data');
        });

        test("THE SINGLE-VERSION LAW at the report surface: the report version and every industry row's contractVersion are the family version", async () => {
                const rig = await crown();
                assert.strictEqual(rig.report.version, HARNESS_ACCEPTANCE_VERSION);
                for (const row of rig.report.industries) {
                        assert.strictEqual(row.contractVersion, HARNESS_ACCEPTANCE_VERSION, row.industry);
                }
        });

        test('THE CANONICAL REPORT EMISSION: the report file lands at the canonical path and re-parses green (THE CR-013 PATTERN)', async () => {
                const rig = await crown();
                const text = rig.port.dump('ws/.flauz/harness/acceptance-report.json');
                assert.ok(text !== undefined, 'the report file exists');
                const parsed = parseAcceptanceReport(text as string);
                assert.ok(parsed.ok, parsed.ok ? '' : parsed.rejection.message);
                assert.strictEqual(serializeAcceptanceReport(parsed.report), text, 'the canonical serialization round-trips byte-identically');
        });

        test('THE IDEMPOTENT RE-READ: a re-run over the complete run re-emits the identical bytes WITHOUT appending', async () => {
                const rig = await crown();
                const before = ledgerLines(rig.port).length;
                const again = await rig.runner.runCrossIndustryAcceptance();
                const complete = mustComplete(again);
                assert.strictEqual(complete.appendedOps, 0, 'no ops appended by the idempotent re-read');
                assert.strictEqual(complete.bytes, rig.bytes, 'the identical report bytes');
                assert.strictEqual(ledgerLines(rig.port).length, before, 'the ledger is unchanged');
        });

        test('THE RESTART-DETERMINISM PIN: two independent fresh runners with the same seams emit byte-identical reports', async () => {
                const firstPort = new MemoryFsPort();
                const first = createAcceptanceRunner({ clock: makeSeams().clock, rng: makeSeams().rng, fsPort: firstPort as unknown as HarnessFsPort, root: 'ws' });
                const secondPort = new MemoryFsPort();
                const second = createAcceptanceRunner({ clock: makeSeams().clock, rng: makeSeams().rng, fsPort: secondPort as unknown as HarnessFsPort, root: 'ws' });
                const firstRun = mustComplete(await first.runCrossIndustryAcceptance());
                const secondRun = mustComplete(await second.runCrossIndustryAcceptance());
                assert.strictEqual(firstRun.bytes, secondRun.bytes);
                assert.strictEqual(firstPort.dump('ws/.flauz/harness/acceptance-report.json'), secondPort.dump('ws/.flauz/harness/acceptance-report.json'), 'the full report bytes are identical');
                first.dispose();
                second.dispose();
        });

        test('inspectRun over the complete run: the four rows, complete true, the report non-null', async () => {
                const rig = await crown();
                const inspected = rig.runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.rows.length, 4);
                assert.strictEqual(inspected.complete, true);
                assert.ok(inspected.report !== null);
                assert.strictEqual(inspected.report?.overallVerdict.verdict, 'complete');
        });
});

// --- the per-industry op surface ---------------------------------------------------------------------------------

suite('acceptanceRunner · the per-industry op surface', () => {
        test('runIndustryAcceptance over ONE fixture: the row lands, one ledger line, the run incomplete', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const outcome = await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE));
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.refusal.message);
                assert.strictEqual(outcome.verdict.industry, 'finance');
                assert.strictEqual(outcome.verdict.benchmarkStatus, 'gap-registered');
                assert.strictEqual(ledgerLines(port).length, 1, 'exactly one run-industry line');
                const inspected = runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.rows.length, 1);
                assert.strictEqual(inspected.complete, false);
                assert.strictEqual(inspected.report, null, 'no report before the terminal walk');
                runner.dispose();
        });

        test('THE UNIQUE-INDUSTRY LAW: a second run of the same industry refuses (a re-run is a NEW runner or a reload)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const first = await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE));
                assert.ok(first.ok);
                const second = await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE));
                assert.strictEqual(mustRefuse(second).reason, 'industry-already-run');
                assert.strictEqual(ledgerLines(port).length, 1, 'the refused run appended nothing');
                runner.dispose();
        });

        test('THE FIFTH-INDUSTRY PIN: a well-formed fixture for a REAL industry outside the four runs green through the SAME code path (a fifth industry is a new fixture module, never a code path)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const legal = copy(FINANCE_ACCEPTANCE_FIXTURE);
                legal.industry = 'legal';
                const outcome = await runner.runIndustryAcceptance(legal);
                assert.ok(outcome.ok, outcome.ok ? '' : outcome.refusal.message);
                assert.strictEqual(outcome.verdict.industry, 'legal');
                assert.strictEqual(outcome.verdict.journey.verdict, 'complete');
                assert.strictEqual(outcome.verdict.journey.harnessLifecycleEndState, 'active');
                assert.strictEqual(outcome.verdict.benchmarkStatus, 'gap-registered');
                runner.dispose();
        });

        test('a fixture with a dangling internal ref refuses (the contract\'s typed rejection table carried verbatim)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                ((mutated.tasks as { termRefs: string[] }[])[0]).termRefs = ['no.such.term'];
                const refusal = mustRefuse(await runner.runIndustryAcceptance(mutated));
                assert.strictEqual(refusal.reason, 'malformed-fixture');
                assert.ok(refusal.fixtureRejection !== undefined, 'THE VERBATIM-CARRY LAW: the contract\'s typed rejection rides the refusal');
                assert.strictEqual(refusal.fixtureRejection?.reason, 'dangling-ref');
                assert.ok((refusal.fixtureRejection?.items as string[])[0].startsWith('dangling-ref:tasks'));
                assert.strictEqual(ledgerLines(port).length, 0, 'the refused run appended nothing');
                runner.dispose();
        });

        test('a fixture outside the REAL industry vocabulary refuses (the typed unknown-industry rejection carried verbatim)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const mutated = copy(SOFTWARE_ACCEPTANCE_FIXTURE);
                mutated.industry = 'aerospace';
                const refusal = mustRefuse(await runner.runIndustryAcceptance(mutated));
                assert.strictEqual(refusal.reason, 'malformed-fixture');
                assert.strictEqual(refusal.fixtureRejection?.reason, 'unknown-industry');
                runner.dispose();
        });

        test('a missing world-coverage gap row on a benchmark-absent fixture refuses (THE GAP-MUST-BE-REGISTERED LAW)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                mutated.expectedGaps = (mutated.expectedGaps as { gapKey: string }[]).filter((row) => row.gapKey !== 'lab-task-worlds-coverage');
                const refusal = mustRefuse(await runner.runIndustryAcceptance(mutated));
                assert.strictEqual(refusal.reason, 'malformed-fixture');
                assert.strictEqual(refusal.fixtureRejection?.reason, 'gap-registration-missing');
                runner.dispose();
        });

        test('a non-object fixture is the typed malformed-fixture refusal (never a silent partial verdict)', async () => {
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: new MemoryFsPort() as unknown as HarnessFsPort, root: 'ws' });
                for (const candidate of [undefined, null, 42, 'fixture', []]) {
                        const refusal = mustRefuse(await runner.runIndustryAcceptance(candidate));
                        assert.strictEqual(refusal.reason, 'malformed-fixture');
                        assert.strictEqual(refusal.fixtureRejection?.reason, 'malformed-fixture');
                }
                runner.dispose();
        });

        test('THE DISPOSE LAW: every operation refuses after dispose', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                runner.dispose();
                assert.strictEqual(mustRefuse(await runner.runCrossIndustryAcceptance()).reason, 'disposed');
                assert.strictEqual(mustRefuse(await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).reason, 'disposed');
                assert.strictEqual(mustRefuse(runner.inspectRun()).reason, 'disposed');
        });

        test('THE FRESH-KIT GUARD: a fresh runner never appends over an existing non-empty acceptance ledger (E_LEDGER_TORN)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const first = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await first.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).ok);
                first.dispose();
                const second = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = mustRefuse(await second.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE)));
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('reopen with loadAcceptanceRunner'));
                second.dispose();
        });
});

// --- the fail-closed pins (a refused leg fails the whole verdict) --------------------------------------------------

suite('acceptanceRunner · THE FAIL-CLOSED PINS (a refused leg fails the whole verdict, never a silent pass)', () => {
        test('THE CORRUPT_SEAM BUDGET PIN: a journey leg refusal fails the WHOLE cross run - the real kit\'s refusal carried COMPLETE, zero lines landed, no report emitted', async () => {
                const port = new MemoryFsPort();
                let reads = 0;
                // reads 1-2: the runner + activation factories; reads 3-7: beginJourney's five
                // reads; read 8: selectIndustry's REAL DH-02 clock read returns '' and the REAL
                // kit's CORRUPT_SEAM refusal rides verbatim as the journey-refused leg.
                const clock = () => {
                        reads += 1;
                        return reads <= 7 ? `2026-03-03T00:00:00.${String(reads).padStart(3, '0')}Z` : '';
                };
                const runner = createAcceptanceRunner({ clock, rng: () => '0000000000000001', fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = mustRefuse(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(refusal.reason, 'journey-refused');
                assert.ok(refusal.law.includes('selectIndustry'), `the refused leg is named: ${refusal.law}`);
                assert.ok(refusal.activationRefusal !== undefined, 'THE VERBATIM-CARRY LAW: the REAL DH-11 kit\'s own refusal rides COMPLETE');
                assert.strictEqual(refusal.activationRefusal?.reason, 'CORRUPT_SEAM');
                assert.strictEqual(refusal.activationRefusal?.law, 'THE DETERMINISM LAW');
                assert.strictEqual(ledgerLines(port).length, 0, 'THE RECORD-UNCHANGED LAW: no line landed');
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-report.json'), undefined, 'no report over a refused leg');
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-runs.json'), undefined, 'no envelope over a refused leg');
                const inspected = runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.rows.length, 0, 'no silent partial verdict');
        });

        test('a tampered activation envelope refuses the next industry run through the REAL load surface (record-read-refused, the real E_ENVELOPE_MISMATCH carried verbatim)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).ok);
                runner.dispose();
                const reloaded = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                port.overwrite('ws/.flauz/harness/activation-journeys.json', '{"junk":true}\n');
                const refusal = mustRefuse(await reloaded.runner.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE)));
                assert.strictEqual(refusal.reason, 'record-read-refused');
                assert.ok(refusal.recordReadRefusal !== undefined);
                assert.strictEqual(refusal.recordReadRefusal?.reason, 'E_ENVELOPE_MISMATCH', 'the REAL activation family\'s own refusal carried verbatim');
        });

        test('a corrupted composed-family ledger refuses the journey\'s record-composition leg (the real family refusal carried COMPLETE)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).ok);
                runner.dispose();
                const reloaded = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                port.overwrite('ws/.flauz/harness/ontology-ops.jsonl', 'not json\n');
                const refusal = mustRefuse(await reloaded.runner.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE)));
                assert.strictEqual(refusal.reason, 'journey-refused');
                assert.ok(refusal.activationRefusal !== undefined);
                assert.ok(refusal.activationRefusal?.message.includes('torn record ledger'), 'the real DH-04 family\'s own refusal rides verbatim');
        });

        test('THE CENSUS-DIVERGENCE PIN: a tampered composed-record version refuses the resumed run (THE COMPOSITION-NOT-FORK LAW is structural, re-proven from the ledger alone)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runCrossIndustryAcceptance()).ok);
                runner.dispose();
                // keep the four run-industry lines, tamper one family version, regenerate the matching envelope, reload, resume
                const kept = ledgerLines(port).slice(0, 4).map((line, index) => {
                        const copyLine: Record<string, unknown> = { ...line, seq: index + 1 };
                        if (index === 1) {
                                const payload = copyLine.payload as Record<string, Record<string, string>>;
                                payload.composedRecordVersions = { ...payload.composedRecordVersions, 'domain-harness': '1.0.1' };
                        }
                        return copyLine;
                });
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${kept.map((line) => JSON.stringify(line)).join('\n')}\n`);
                port.overwrite('ws/.flauz/harness/acceptance-runs.json', expectedEnvelope(['software', 'finance', 'healthcare', 'construction'], false, null, null, 4));
                const reloaded = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const refusal = mustRefuse(await reloaded.runner.runCrossIndustryAcceptance());
                assert.strictEqual(refusal.reason, 'census-divergence');
                assert.ok(refusal.message.includes('domain-harness'), 'the divergence names the family');
                assert.ok((refusal.items as string[]).some((item) => item.includes('1.0.1')), 'the divergence names the versions');
        });

        test('a refused industry run never lands a row (the run state unchanged; THE FAIL-CLOSED VERDICT LAW)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).ok);
                const refused = await runner.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE));
                assert.ok(refused.ok); // the second industry is a DIFFERENT industry - it runs green
                const inspected = runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.rows.length, 2);
                // the malformed-fixture refusal leaves the state untouched
                const mutated = copy(FINANCE_ACCEPTANCE_FIXTURE);
                mutated.industry = 'aerospace';
                const refusal = mustRefuse(await runner.runIndustryAcceptance(mutated));
                assert.strictEqual(refusal.reason, 'malformed-fixture');
                const after = runner.inspectRun();
                assert.ok(after.ok);
                assert.strictEqual(after.rows.length, 2, 'THE RECORD-UNCHANGED LAW');
                runner.dispose();
        });
});

// --- the composition-not-fork source pins ---------------------------------------------------------------------------

suite('acceptanceRunner · THE COMPOSITION-NOT-FORK source pins', () => {
        test('the four fixture modules are PURE DATA: no function declarations, exactly one export each, frozen at every level', () => {
                for (const source of INDUSTRY_SOURCES) {
                        const codeLines = source.split('\n').filter((line) => {
                                const trimmed = line.trim();
                                return trimmed.length > 0 && !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                        });
                        for (const line of codeLines) {
                                assert.ok(!/\bfunction\b/.test(line), `a pure-data module declares no functions: ${line.trim()}`);
                        }
                        const exports = codeLines.filter((line) => line.trim().startsWith('export '));
                        assert.strictEqual(exports.length, 1, 'exactly one export (the frozen fixture)');
                        assert.ok(exports[0].includes('Object.freeze('), 'the export is frozen');
                }
        });

        test('the runner source carries NO industry-string literal (the industries differ only in data - the LANE wiring is by identifier, never a branch)', () => {
                for (const literal of ["'software'", "'finance'", "'healthcare'", "'construction'"]) {
                        assert.ok(!RUNNER_SOURCE.includes(literal), `the industry literal ${literal} must not appear in the runner source`);
                }
                // the LANE wiring: the four fixtures are wired by their module identifiers
                for (const identifier of ['SOFTWARE_ACCEPTANCE_FIXTURE', 'FINANCE_ACCEPTANCE_FIXTURE', 'HEALTHCARE_ACCEPTANCE_FIXTURE', 'CONSTRUCTION_ACCEPTANCE_FIXTURE']) {
                        assert.ok(RUNNER_SOURCE.includes(identifier), `the lane wiring references ${identifier}`);
                }
        });

        test('THE IMPORT LAW: the runner drives the REAL kits by reference (never a re-implementation)', () => {
                for (const realSurface of [
                        'loadHarnessKit', 'loadOnboardingKit', 'loadRolesKit', 'loadOntologyKit', 'loadTemplatesKit',
                        'loadBodiesKit', 'loadPacksKit', 'loadProfilesKit', 'loadBenchmarksKit', 'createActivationKit',
                        'loadActivationKit', 'createProjectionsKit', 'createOptimizationKit', 'loadOptimizationKit',
                        'runClosedLoop', 'TASK_WORLDS',
                ]) {
                        assert.ok(RUNNER_SOURCE.includes(realSurface), `the runner imports ${realSurface}`);
                }
                assert.ok(RUNNER_SOURCE.includes("from '../../activation/common/activationKit.js'"));
                assert.ok(RUNNER_SOURCE.includes("from '../../../lab/common/closedLoop.js'"));
        });

        test('THE IMPORT LAW (versions): the twelve family versions are imported by reference, never transcribed', () => {
                for (const identifier of [
                        'DOMAIN_HARNESS_CONTRACTS_VERSION', 'ONBOARDING_CONTRACTS_VERSION', 'ROLES_CONTRACTS_VERSION',
                        'ONTOLOGY_CONTRACTS_VERSION', 'TEMPLATES_CONTRACTS_VERSION', 'BODIES_CONTRACTS_VERSION',
                        'PACKS_CONTRACTS_VERSION', 'PROFILES_CONTRACTS_VERSION', 'BENCHMARKS_CONTRACTS_VERSION',
                        'PROJECTIONS_CONTRACTS_VERSION', 'ACTIVATION_CONTRACTS_VERSION', 'OPTIMIZATION_CONTRACTS_VERSION',
                ]) {
                        assert.ok(RUNNER_SOURCE.includes(identifier), `the census carries ${identifier} by import`);
                }
                assert.ok(RUNNER_SOURCE.includes("from './acceptanceContract.js'"), 'the versions flow through the contract\'s single-version re-exports');
        });
});

// --- the persistence mirror (the PIN-2 pattern) -----------------------------------------------------------------------

suite('acceptanceRunner · THE PERSISTENCE MIRROR (the append-only ledger + the envelope + the report)', () => {
        test('LAZY LANDING: no acceptance file exists before the first op', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-ops.jsonl'), undefined);
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-runs.json'), undefined);
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-report.json'), undefined);
                runner.dispose();
        });

        test('the frozen line schema: every line the exact eight keys with seq equal to the line number', async () => {
                const rig = await crown();
                const lines = ledgerLines(rig.port);
                assert.strictEqual(lines.length, 8, 'the complete run: four run-industry lines + the four terminal lines');
                for (let i = 0; i < lines.length; i += 1) {
                        assert.deepStrictEqual(Object.keys(lines[i]), [...ACCEPTANCE_LEDGER_LINE_SCHEMA_KEYS], `the line ${i + 1} key order`);
                        assert.strictEqual(lines[i].seq, i + 1, 'the strictly-increasing seq = the line number');
                        assert.strictEqual(lines[i].contractVersion, HARNESS_ACCEPTANCE_VERSION, 'THE SINGLE-VERSION LAW');
                        assert.ok(typeof lines[i].at === 'string' && (lines[i].at as string).length > 0, `the line ${i + 1} clock stamp`);
                        assert.ok(typeof lines[i].law === 'string' && (lines[i].law as string).length > 0);
                        assert.ok(typeof lines[i].detail === 'string' && (lines[i].detail as string).length > 0);
                }
        });

        test('the frozen op order: the four run-industry lines then compose-census -> register-gaps -> resolve-verdict -> emit-report', async () => {
                const rig = await crown();
                const ops = ledgerLines(rig.port).map((line) => line.op);
                assert.deepStrictEqual(ops, ['run-industry', 'run-industry', 'run-industry', 'run-industry', 'compose-census', 'register-gaps', 'resolve-verdict', 'emit-report']);
                assert.deepStrictEqual([...ACCEPTANCE_OP_NAMES], ['run-industry', 'compose-census', 'register-gaps', 'resolve-verdict', 'emit-report']);
        });

        test('the industry column: the four lane industries in the frozen order, then null on every terminal line', async () => {
                const rig = await crown();
                const industries = ledgerLines(rig.port).map((line) => line.industry);
                assert.deepStrictEqual(industries, [...ACCEPTANCE_INDUSTRIES, null, null, null, null]);
        });

        test('the payload walks: the run-industry payloads are the verdict rows; the terminal payloads the census / the six gap keys / the COMPLETE verdict / the emission receipt', async () => {
                const rig = await crown();
                const lines = ledgerLines(rig.port);
                for (let i = 0; i < 4; i += 1) {
                        const payload = lines[i].payload as Record<string, unknown>;
                        assert.strictEqual(payload.industry, ACCEPTANCE_INDUSTRIES[i], `the row ${i} payload's industry`);
                        assert.strictEqual(payload.contractVersion, HARNESS_ACCEPTANCE_VERSION);
                }
                assert.strictEqual((lines[4].payload as Record<string, unknown>).labContractsVersion, LAB_CONTRACTS_VERSION);
                assert.deepStrictEqual(lines[5].payload, [...ACCEPTANCE_GAP_KEYS]);
                const verdictPayload = lines[6].payload as Record<string, unknown>;
                assert.strictEqual(verdictPayload.verdict, 'complete');
                assert.strictEqual(verdictPayload.industriesComplete, 4);
                assert.strictEqual(verdictPayload.gapRowsRegistered, HARNESS_ACCEPTANCE_GAP_LEDGER.length);
                const emissionPayload = lines[7].payload as Record<string, unknown>;
                assert.strictEqual(emissionPayload.path, 'ws/.flauz/harness/acceptance-report.json');
                assert.strictEqual(emissionPayload.bytes, rig.bytes, 'the emission receipt\'s byte count');
        });

        test('the envelope: the frozen three-key schema, cross-checked byte-for-byte against the ledger replay', async () => {
                const rig = await crown();
                const envelope = rig.port.dump('ws/.flauz/harness/acceptance-runs.json');
                assert.ok(envelope !== undefined, 'the envelope exists');
                const parsed = JSON.parse(envelope as string) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...ACCEPTANCE_ENVELOPE_SCHEMA_KEYS]);
                assert.strictEqual(parsed.contractVersion, HARNESS_ACCEPTANCE_VERSION);
                assert.strictEqual(parsed.seq, 8);
                const run = parsed.run as Record<string, unknown>;
                assert.deepStrictEqual(run.industries, [...ACCEPTANCE_INDUSTRIES]);
                assert.strictEqual(run.compositionCensus, true);
                assert.strictEqual(run.overallVerdict, 'complete');
                assert.deepStrictEqual(run.report, { path: 'ws/.flauz/harness/acceptance-report.json', bytes: rig.bytes });
        });

        test('RESTART DETERMINISM (mid-run): a reload after one industry carries the identical row and resumes to a complete run', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const first = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const softwareOutcome = await first.runIndustryAcceptance(copy(SOFTWARE_ACCEPTANCE_FIXTURE));
                assert.ok(softwareOutcome.ok);
                const softwareRow: IndustryAcceptanceVerdict = softwareOutcome.verdict;
                const before = first.inspectRun();
                assert.ok(before.ok);
                first.dispose();
                const reloaded = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const after = reloaded.runner.inspectRun();
                assert.ok(after.ok);
                assert.deepStrictEqual(after.rows, before.rows, 'the reloaded state is the pre-dispose state (restart-deterministic)');
                assert.deepStrictEqual(after.rows[0], softwareRow);
                assert.ok((await reloaded.runner.runIndustryAcceptance(copy(FINANCE_ACCEPTANCE_FIXTURE))).ok, 'the resumed runner continues the walk');
                const done = mustComplete(await reloaded.runner.runCrossIndustryAcceptance());
                assert.strictEqual(done.appendedOps, 6, 'the resumed run appended ONLY the remaining ops (2 industries + the terminal walk)');
                assert.strictEqual(ledgerLines(port).length, 8, 'the final ledger is exactly the canonical eight lines');
                const parsed = parseAcceptanceReport(port.dump('ws/.flauz/harness/acceptance-report.json') as string);
                assert.ok(parsed.ok, 'the resumed run\'s report re-parses green');
                reloaded.runner.dispose();
        });

        test('RELOAD AFTER COMPLETE: the runner reopens complete and the idempotent re-read re-emits the identical bytes', async () => {
                const rig = await crown();
                const reloaded = await loadAcceptanceRunner({ clock: rig.seams.clock, rng: rig.seams.rng, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const inspected = reloaded.runner.inspectRun();
                assert.ok(inspected.ok);
                assert.strictEqual(inspected.complete, true);
                assert.ok(inspected.report !== null);
                const done = mustComplete(await reloaded.runner.runCrossIndustryAcceptance());
                assert.strictEqual(done.appendedOps, 0);
                assert.strictEqual(done.bytes, rig.bytes);
                reloaded.runner.dispose();
        });

        test('THE RESUMABLE TERMINAL WALK: a report-write refusal heals by appending ONLY the un-landed emit-report line (never a torn ledger)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                port.refuseWrites = true;
                port.selectFragment = 'acceptance-report';
                const refused = mustRefuse(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(refused.reason, 'ACCEPTANCE_IO');
                assert.strictEqual(ledgerLines(port).length, 7, 'the four industries + census + gaps + verdict landed; the emission did not');
                port.refuseWrites = false;
                const healed = mustComplete(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(healed.appendedOps, 1, 'the healed run appended ONLY the emit-report line');
                const ops = ledgerLines(port).map((line) => line.op);
                assert.deepStrictEqual(ops, ['run-industry', 'run-industry', 'run-industry', 'run-industry', 'compose-census', 'register-gaps', 'resolve-verdict', 'emit-report']);
                const reload = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reload.ok, 'the healed ledger reloads green (no fabricated torn state)');
                runner.dispose();
                if (reload.ok) {
                        reload.runner.dispose();
                }
        });

        test('the IO refusals: a refused append leaves the state unchanged and the next op heals', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                port.refuseAppends = true;
                port.selectFragment = 'acceptance-ops';
                const refused = mustRefuse(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(refused.reason, 'ACCEPTANCE_IO');
                assert.ok(refused.message.includes('the acceptance ledger append'));
                assert.strictEqual(port.dump('ws/.flauz/harness/acceptance-ops.jsonl'), undefined, 'no partial line landed');
                port.refuseAppends = false;
                const healed = mustComplete(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(healed.appendedOps, 8, 'the healed run appended every line');
                runner.dispose();
        });

        test('the IO refusals: a refused envelope write discloses the authoritative ledger (the 73-b pattern: the stuck reload fails closed first)', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                port.refuseWrites = true;
                port.selectFragment = 'acceptance-runs';
                const refused = mustRefuse(await runner.runCrossIndustryAcceptance());
                assert.strictEqual(refused.reason, 'ACCEPTANCE_IO');
                assert.ok(refused.message.includes('the line landed: the ledger is authoritative'));
                assert.strictEqual(ledgerLines(port).length, 1, 'the run-industry line landed');
                const stuck = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.strictEqual(mustRefuse(stuck).reason, 'E_ENVELOPE_MISMATCH', 'the stuck reload fails closed (never silently rebuilt)');
                port.refuseWrites = false;
                const healed = mustComplete(await runner.runCrossIndustryAcceptance());
                assert.ok(healed.report.overallVerdict.verdict === 'complete', 'the NEXT op rewrote the envelope and the run completed');
                runner.dispose();
        });

        test('the IO refusals: a refused read / mkdir at load is the typed ACCEPTANCE_IO', async () => {
                const port = new MemoryFsPort();
                const seams = makeSeams();
                const runner = createAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok((await runner.runCrossIndustryAcceptance()).ok);
                runner.dispose();
                port.refuseReads = true;
                port.selectFragment = 'acceptance-ops';
                assert.strictEqual(mustRefuse(await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' })).reason, 'ACCEPTANCE_IO');
                const freshPort = new MemoryFsPort();
                freshPort.refuseMkdirs = true;
                assert.strictEqual(mustRefuse(await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: freshPort as unknown as HarnessFsPort, root: 'ws' })).reason, 'ACCEPTANCE_IO');
        });
});

// --- the ledger replay's fail-closed stations (the laws re-proven from the ledger alone) ------------------------------

suite('acceptanceRunner · the ledger replay fail-closed stations (E_LEDGER_TORN / E_ENVELOPE_MISMATCH)', () => {
        async function reloadRefusal(port: MemoryFsPort, seams: ReturnType<typeof makeSeams>): Promise<AcceptanceRunnerRefusal> {
                const outcome = await loadAcceptanceRunner({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                return mustRefuse(outcome);
        }

        test('a torn (dropped) line is the typed E_LEDGER_TORN (the seq strictly-increasing law re-proven from the ledger alone)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                // drop the THIRD run-industry line: the fourth line carries seq 4 at line number 3
                const kept = ledgerLines(port).filter((line, index) => index !== 2);
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${kept.map((line) => JSON.stringify(line)).join('\n')}\n`);
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('seq must equal the line number'));
        });

        test('a non-JSON line is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                const text = (port.dump('ws/.flauz/harness/acceptance-ops.jsonl') as string).split('\n').filter((line) => line.trim().length > 0);
                text[3] = 'not json';
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${text.join('\n')}\n`);
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('is not JSON'));
        });

        test('a drifted seq is the typed E_LEDGER_TORN (the strictly-increasing law)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 2 ? { ...line, seq: 99 } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('seq must equal the line number'));
        });

        test('an unknown op is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 5 ? { ...line, op: 'transmogrify' } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('unknown op'));
        });

        test('a foreign contract version is the typed E_LEDGER_TORN (THE SINGLE-VERSION LAW)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 1 ? { ...line, contractVersion: '9.9.9' } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('contract version'));
        });

        test('a repeated industry is the typed E_LEDGER_TORN (THE UNIQUE-INDUSTRY LAW)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => {
                        const copyLines = lines.map((line) => ({ ...line }));
                        copyLines[1].industry = 'software';
                        (copyLines[1].payload as Record<string, unknown>).industry = 'software';
                        return copyLines;
                });
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('repeats the industry'));
        });

        test('a terminal op before the four lane industries is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                // two run-industry lines, then the compose-census line (re-sequenced) - the terminal walk began too early
                const all = ledgerLines(port);
                const mutated = [all[0], all[1], all[4]].map((line, index) => ({ ...line, seq: index + 1 }));
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${mutated.map((line) => JSON.stringify(line)).join('\n')}\n`);
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('before the four lane industries ran'));
        });

        test('a terminal op out of order is the typed E_LEDGER_TORN (the frozen terminal walk)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                // swap the register-gaps and resolve-verdict lines (re-sequenced): the frozen terminal walk is order-checked
                const swapped = ledgerLines(port).map((line) => ({ ...line }));
                [swapped[5], swapped[6]] = [swapped[6], swapped[5]];
                const resequenced = swapped.map((line, index) => ({ ...line, seq: index + 1 }));
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${resequenced.map((line) => JSON.stringify(line)).join('\n')}\n`);
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('out of order'));
        });

        test('a run-industry line after the terminal walk began is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                // append a REAL run-industry line (re-sequenced) AFTER the completed terminal walk
                const all = ledgerLines(port);
                const mutated = [...all.map((line) => ({ ...line })), { ...all[0], seq: all.length + 1 }];
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', `${mutated.map((line) => JSON.stringify(line)).join('\n')}\n`);
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('AFTER the terminal walk began'));
        });

        test('a terminal op with a non-null industry column is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 4 ? { ...line, industry: 'software' } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('non-null industry column'));
        });

        test('a register-gaps payload drift is the typed E_LEDGER_TORN (the six frozen keys in the frozen order)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 5 ? { ...line, payload: ['made-up-gap'] } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('six frozen gap keys'));
        });

        test('a tampered row payload failing the industry-row walk is the typed E_LEDGER_TORN', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 2 ? { ...line, payload: { junk: true } } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('payload fails the industry-row walk'));
        });

        test('a tampered census payload failing the census walk is the typed E_LEDGER_TORN (THE COMPOSITION-NOT-FORK LAW)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 4 ? { ...line, payload: { labContractsVersion: '0.0.0', rows: [], industriesServed: [], sharedKitConstructions: [], fixturesArePureData: true } } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('census walk'));
        });

        test('an unknown line key is the typed E_LEDGER_TORN (the frozen eight-key line schema)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                rewriteLedger(port, (lines) => lines.map((line, index) => (index === 0 ? { ...line, extraKey: true } : line)));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
                assert.ok(refusal.message.includes('unknown key'));
        });

        test('a whitespace-only ledger is the typed E_LEDGER_TORN (never silently rebuilt as fresh)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                port.overwrite('ws/.flauz/harness/acceptance-ops.jsonl', '   \n\n');
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_LEDGER_TORN');
        });

        test('a missing envelope over a carrying ledger is the typed E_ENVELOPE_MISMATCH', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                port.remove('ws/.flauz/harness/acceptance-runs.json');
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_ENVELOPE_MISMATCH');
                assert.ok(refusal.message.includes('the envelope is missing'));
        });

        test('a divergent envelope is the typed E_ENVELOPE_MISMATCH (the ledger is authoritative)', async () => {
                const rig = await crown();
                const port = new MemoryFsPort();
                for (const [path, text] of rig.port.files) {
                        port.files.set(path, text);
                }
                port.overwrite('ws/.flauz/harness/acceptance-runs.json', expectedEnvelope(['software'], false, null, null, 8));
                const refusal = await reloadRefusal(port, rig.seams);
                assert.strictEqual(refusal.reason, 'E_ENVELOPE_MISMATCH');
                assert.ok(refusal.message.includes('diverges from the ledger replay'));
        });
});

// --- the determinism law -----------------------------------------------------------------------------------------

suite('acceptanceRunner · THE DETERMINISM LAW (the in-suite source greps)', () => {
        test('no Math.random / Date.now / new Date( / process.env outside the law-comment lines (the runner + the industries modules)', () => {
                for (const source of [RUNNER_SOURCE, ...INDUSTRY_SOURCES]) {
                        const lines = source.split('\n');
                        for (let i = 0; i < lines.length; i += 1) {
                                const line = lines[i];
                                for (const pattern of ['Math.random', 'Date.now', 'new Date(', 'process.env']) {
                                        if (line.includes(pattern)) {
                                                assert.ok(
                                                        line.trim().startsWith('*') || line.trim().startsWith('/*') || line.trim().startsWith('//'),
                                                        `the determinism violation at line ${i + 1}: ${line.trim()}`,
                                                );
                                        }
                                }
                        }
                }
        });
});
