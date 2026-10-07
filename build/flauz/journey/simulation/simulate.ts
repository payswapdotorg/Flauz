/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-012 -- THE LARGE-SCALE CROSS-INDUSTRY SIMULATION HARNESS.
 *
 * LAWS:
 * - A MEASUREMENT INSTRUMENT, NOT A SCHEDULER: the harness drives the
 *   EXISTING real seams only -- the CR-006 registry (its public API
 *   over the simulation root's own registry directory), the real
 *   OrchestrationStore through the CR-002 bgAgent binding, the real
 *   CLI runtime (read-shaped legs), the real lab engine, and the
 *   journey battery's own runner (once, as a shared baseline). No new
 *   orchestration state, no event bus, no capability authority.
 * - SINGLE WRITER: one registry instance and one store binding per
 *   simulation; all writes flow through them. The CLI legs are
 *   read-only by construction (workflow.view / roster), and the
 *   battery baseline lives in its own subroot (battery-baseline/).
 * - HONESTY LABELS: registry/store/cli legs are local-real (fixture
 *   payloads over real pipelines, the J4 precedent); lab legs are
 *   local-real executions of the real engine over the fixture world
 *   with the engine's own evidence level (fixture) banked verbatim
 *   and never promoted; the battery baseline is simulated (the
 *   battery's own driver-leg label). The profiles are fixture.
 * - FAIL TYPED, NEVER SILENTLY: every seam refusal or error is a
 *   typed record in the receipt; a refusal is NEVER a pass; no silent
 *   retries. Upstream-failure skips are typed skipped-after-failure
 *   records. An invalid lab request surfaces as the engine's own
 *   undefined verdict recorded as a typed failure (the engine is the
 *   authority -- config validation does not pre-reject what the seam
 *   itself must refuse).
 * - DETERMINISM: no wall-clock reads, no randomness anywhere in this
 *   module. One injected stepper clock (start 1000, +1 per call) is
 *   threaded into the registry and the store; leg "durations" are
 *   injected-clock STEPS, never milliseconds. The manual --scale
 *   large lane is timed externally by its invoker. The report is
 *   canonical JSON over stable, root-independent facts only: two runs
 *   over two fresh roots produce byte-identical reports.
 * - CONTAINMENT: the simulation writes nothing outside its given
 *   root. The root's .flauz tree and battery-baseline/ are wiped at
 *   start so repeated runs rebuild byte-identical state.
 *
 * DISCLOSED FALLBACKS (see REPORT deviations D1-D9): the one-shape
 * capability lane; runnerIds resolved from the binding's own
 * vocabulary; graphs capped at 32 steps (the drill-validated two-digit
 * step-id form); the bgAgent seam bound via a non-literal dynamic
 * import with structural validation (the cli/runtime/context.ts
 * discipline -- no on-disk declaration was confirmed for it); the lab
 * engine imported statically (in-repo TypeScript) with organization
 * candidates obtained ONLY from the real searchOrganizations; the
 * battery baseline driven with an injected stub driver; the
 * delegation/launch thread struck (a2a.mjs never pasted).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JOURNEYS, runBattery, type BatteryRunRecord, type DriverRunner } from '../battery/battery.ts';
import {
        canonicalJson,
        deriveScope,
        describeError,
        realRegistryFsPort,
        registryRootFor,
        sha256Hex,
} from '../../cli/runtime/context.ts';
import { runCli } from '../../cli/bin/flauz.ts';
import { createRegistry } from '../../capabilities/registry/registry.mjs';
import type { QueryPredicate, RegistryRuntime } from '../../capabilities/registry/registry.mjs';
import { WIRING } from '../../zcode-patterns/activation/common/wiring.ts';
import { runLadder, type EvaluationRequest } from '../../lab/common/runEngine.ts';
import { searchOrganizations, type OrgSearchRequest } from '../../lab/common/orgSearch.ts';
import { INDUSTRY_PROFILES, type IndustryProfile } from './industries.ts';
import { buildGapLedger, PENDING_GATE_DISCLOSURE, type GapLedger, type LedgerLegSummary } from './gapClosure.ts';

export const SIMULATION_VERSION = '1.0.0';

/** The modest in-suite lane and the manual-only large lane (never claimed in-suite). */
export const MODEST_SCALE: Readonly<SimulationScale> = Object.freeze({ profiles: 6, runsPerProfile: 8, entriesPerRun: 32 });
export const LARGE_SCALE: Readonly<SimulationScale> = Object.freeze({ profiles: 6, runsPerProfile: 16, entriesPerRun: 128 });

const CLOCK_START = 1000;
const MAX_STEPS_PER_GRAPH = 32;
const SIM_ORIGIN = 'sim:cr012-journey-simulation';
const REGISTRY_JOURNAL = 'registry-journal.jsonl';
const STORE_JOURNAL_RELATIVE = ['.flauz', 'orchestration', 'journal.jsonl'];

/** The lab fixtures scope (the lab's own pinned scope, verbatim). */
export const LAB_FIXTURE_SCOPE = Object.freeze({ workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' });

const REGISTRY_DISCLOSURE = 'fixture payload (the J4-validated single shape), real registry pipeline';
const STORE_DISCLOSURE = 'sim-driven steps over the real OrchestrationStore via the CR-002 binding';
const ROSTER_DISCLOSURE = 'read-only roster projection through the CR-002 runtime binding';
const CLI_DISCLOSURE = 'read-shaped CLI legs over the real CLI runtime';
const LAB_DISCLOSURE = 'fixture world + fixture response model (engine-labeled fixture), real engine execution';
const BATTERY_DISCLOSURE =
        'battery baseline with an injected stub driver (a deterministic record); the real dogfood driver lane remains the battery suite\'s own real-driver test; journey-7 is pending-only by design (CR-008) and its red verdict is the honest pending status';

export type SimLegKind = 'registry' | 'query' | 'store' | 'roster' | 'lab' | 'cli' | 'battery';
export type SimEvidenceLabel = 'local-real' | 'simulated';
export type SimLegStatus = 'green' | 'typed-failure' | 'skipped-after-failure';

export type LegFacts = Readonly<Record<string, string | number | boolean | null>>;

export interface SimLegReceipt {
        readonly legId: string;
        readonly kind: SimLegKind;
        readonly op: string;
        readonly status: SimLegStatus;
        readonly evidenceLabel: SimEvidenceLabel;
        readonly detail: string;
        readonly disclosure: string;
        readonly clockSteps: number;
        readonly facts: LegFacts;
}

export interface SimRunMeasurements {
        readonly registryJournalLines: number;
        readonly registryEntriesTotal: number;
        readonly registryQueryCounts: Readonly<Record<'total' | 'approved' | 'cli' | 'linuxX64', number>>;
        readonly registryQueryBytes: Readonly<Record<'total' | 'approved' | 'cli' | 'linuxX64', number>>;
        readonly storeJournalRows: number;
        readonly storeGraphs: number;
        readonly storeRowsLatestGraph: number;
        readonly storeChainOk: boolean | null;
        readonly storeChainRows: number | null;
}

export interface SimRunReceipt {
        readonly profileId: string;
        readonly runIndex: number;
        readonly seedHex: string;
        readonly seedNumeric: number;
        readonly verdict: 'green' | 'red';
        readonly legs: readonly SimLegReceipt[];
        readonly measurements: SimRunMeasurements;
}

export interface BatteryBaselineProjection {
        readonly batteryVersion: string;
        readonly driverMode: 'stub-injected' | 'caller-injected';
        readonly driverExitCode: number;
        readonly driverExercises: readonly string[];
        readonly coreJourneysGreen: boolean;
        readonly journeys: readonly {
                readonly journeyId: string;
                readonly verdict: string;
                readonly executed: number;
                readonly pending: number;
                readonly labels: readonly string[];
        }[];
        readonly reload: Readonly<Record<'loadedFirst' | 'disposeApplied' | 'loadedSecond' | 'byteEqual', boolean>>;
        readonly capability: Readonly<Record<'entryId' | 'entryState', string>>;
        readonly parity: readonly { readonly journey: string; readonly verdict: string }[];
        readonly pendingSteps: readonly { readonly stepId: string; readonly pendingOwner: string }[];
        readonly referencedPendingSteps: readonly { readonly stepId: string; readonly pendingOwner: string }[];
}

export interface SimulationScale {
        readonly profiles: number;
        readonly runsPerProfile: number;
        readonly entriesPerRun: number;
        readonly seeds?: number;
}

export interface LatencyAggregate {
        readonly legKind: string;
        readonly count: number;
        readonly clockStepsTotal: number;
        readonly clockStepsMin: number;
        readonly clockStepsMean: number;
        readonly clockStepsMax: number;
}

export interface SimulationReport {
        readonly simulationVersion: string;
        readonly generatedBy: string;
        readonly lane: 'modest' | 'large' | 'custom';
        readonly scale: Readonly<Record<'profiles' | 'runsPerProfile' | 'entriesPerRun' | 'seedsSalt', number>>;
        readonly industryIds: readonly string[];
        readonly registryLoad: Readonly<Record<'seq' | 'entries', number> & { readonly recoveredDisclosed: boolean; readonly recoveredCode: string | null }>;
        readonly batteryBaseline: BatteryBaselineProjection;
        readonly runs: readonly SimRunReceipt[];
        readonly measurements: {
                readonly growth: readonly {
                        readonly runOrdinal: number;
                        readonly profileId: string;
                        readonly runIndex: number;
                        readonly registryEntries: number;
                        readonly registryJournalLines: number;
                        readonly storeJournalRows: number;
                        readonly storeGraphs: number;
                }[];
                readonly latency: readonly LatencyAggregate[];
        };
        readonly ledger: GapLedger;
        readonly disclosures: readonly string[];
}

export type SimulationOutcome =
        | { readonly ok: true; readonly report: SimulationReport; readonly reportPath: string }
        | { readonly ok: false; readonly refusal: { readonly code: string; readonly detail: string } };

export interface RunSimulationOptions {
        readonly root: string;
        readonly industries?: readonly IndustryProfile[];
        readonly scale?: SimulationScale;
        readonly batteryDriver?: DriverRunner;
}

// ---------------------------------------------------------------------------
// Deterministic derivations (the battery's established sha256 form)
// ---------------------------------------------------------------------------

export function hashSeed(profileId: string, seedBase: string, runIndex: number, salt = 0): string {
        return sha256Hex('cr012-seed|' + String(salt) + '|' + profileId + '|' + seedBase + '|' + String(runIndex));
}

export function numericSeedOf(seedHex: string): number {
        return Number.parseInt(seedHex.slice(0, 8), 16);
}

export function capabilityContentHash(profileId: string, runIndex: number, entryIndex: number): string {
        return sha256Hex('cr012-capability|' + profileId + '|' + String(runIndex) + '|' + String(entryIndex));
}

function round6(value: number): number {
        return Math.round(value * 1e6) / 1e6;
}

/** The injected stepper: +1 per call, never the wall clock. */
export interface Stepper {
        now(): number;
        steps(): number;
}

export function makeStepper(start: number): Stepper {
        let value = start;
        return {
                now: () => {
                        const current = value;
                        value += 1;
                        return current;
                },
                steps: () => value - start,
        };
}

// ---------------------------------------------------------------------------
// Typed failures and refusal formatting (the battery's discipline)
// ---------------------------------------------------------------------------

class TypedLegFailure extends Error {
        readonly code: string;
        constructor(code: string, detail: string) {
                super(detail);
                this.name = 'TypedLegFailure';
                this.code = code;
        }
}

function refusalCodeOf(refusal: unknown): string {
        const code = (refusal as { code?: unknown }).code;
        return typeof code === 'string' ? code : 'unknown-refusal';
}

function refusalText(refusal: unknown): string {
        const record = refusal as { code?: unknown; law?: unknown; detail?: unknown };
        const law = typeof record.law === 'string' ? ' (' + record.law + ')' : '';
        const detail = typeof record.detail === 'string' && record.detail.length > 0 ? ': ' + record.detail : '';
        return refusalCodeOf(record) + law + detail;
}

function errorCodeOf(error: unknown): string {
        if (error instanceof TypedLegFailure) {
                return error.code;
        }
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : 'SEAM_FAILURE';
}

async function runLeg(input: {
        legId: string;
        kind: SimLegKind;
        op: string;
        evidenceLabel: SimEvidenceLabel;
        disclosure: string;
        stepper: Stepper;
        drive: () => Promise<{ detail: string; facts: LegFacts }>;
}): Promise<SimLegReceipt> {
        const before = input.stepper.steps();
        try {
                const out = await input.drive();
                return {
                        legId: input.legId,
                        kind: input.kind,
                        op: input.op,
                        status: 'green',
                        evidenceLabel: input.evidenceLabel,
                        detail: out.detail,
                        disclosure: input.disclosure,
                        clockSteps: input.stepper.steps() - before,
                        facts: out.facts,
                };
        } catch (error) {
                return {
                        legId: input.legId,
                        kind: input.kind,
                        op: input.op,
                        status: 'typed-failure',
                        evidenceLabel: input.evidenceLabel,
                        detail: errorCodeOf(error) + ': ' + describeError(error),
                        disclosure: input.disclosure,
                        clockSteps: input.stepper.steps() - before,
                        facts: { refusalCode: errorCodeOf(error) },
                };
        }
}

function skippedLeg(
        legId: string,
        kind: SimLegKind,
        op: string,
        evidenceLabel: SimEvidenceLabel,
        disclosure: string,
        reason: string,
): SimLegReceipt {
        return {
                legId,
                kind,
                op,
                status: 'skipped-after-failure',
                evidenceLabel,
                detail: 'skipped: ' + reason,
                disclosure,
                clockSteps: 0,
                facts: { reason },
        };
}

// ---------------------------------------------------------------------------
// The bgAgent seam binding (non-literal dynamic import, structural validation
// -- the cli/runtime/context.ts discipline; no on-disk declaration confirmed)
// ---------------------------------------------------------------------------

const BG_AGENT_SEAM = '../../capabilities/background-agent/runtime/bgAgent.mjs';

export interface BgVocabulary {
        readonly actor: string;
        readonly from: string;
}

export interface BgStoreBinding {
        submitGraph(input: Record<string, unknown>): Promise<{ graphId: string; stepIds: string[] }>;
        approveGraph(input: Record<string, unknown>): Promise<unknown>;
        startStep(input: Record<string, unknown>): Promise<{ attempt: number; idempotencyKey: string; rowId: string }>;
        finishStep(input: Record<string, unknown>): Promise<unknown>;
        completeGraph(input: Record<string, unknown>): Promise<unknown>;
        stateOf(graphId: string): unknown;
        rowsFor(graphId?: string): unknown[];
        listGraphs(): unknown[];
        verifyJournal?(): { ok: boolean; rows: number };
}

export interface BgAgentBinding {
        readonly store: BgStoreBinding;
        readonly vocabulary: BgVocabulary;
        roster(): Promise<unknown[]>;
}

export type BgBindingOutcome = { bound: true; binding: BgAgentBinding } | { bound: false; detail: string };

async function importSeamModule(specifier: string): Promise<unknown> {
        // Non-literal on purpose: tsc must not resolve or reject the seam module.
        return await import(specifier);
}

export async function loadBgAgentBinding(root: string, now: () => number): Promise<BgBindingOutcome> {
        let moduleValue: unknown;
        try {
                moduleValue = await importSeamModule(BG_AGENT_SEAM);
        } catch (error) {
                return { bound: false, detail: 'bgAgent seam import failed: ' + describeError(error) };
        }
        const moduleRecord = moduleValue as Record<string, unknown> | null;
        if (moduleRecord === null || typeof moduleRecord !== 'object' || typeof moduleRecord.loadBgAgentRuntime !== 'function') {
                return { bound: false, detail: 'bgAgent seam does not export loadBgAgentRuntime' };
        }
        let loaded: unknown;
        try {
                loaded = await (moduleRecord.loadBgAgentRuntime as (options: { root: string; now: () => number }) => Promise<unknown>)({ root, now });
        } catch (error) {
                return { bound: false, detail: 'bgAgent bind failed: ' + describeError(error) };
        }
        const record = loaded as Record<string, unknown> | null;
        if (record === null || typeof record !== 'object' || record.bound !== true) {
                const detail = record !== null && typeof record === 'object' && typeof record.detail === 'string' ? record.detail : 'unknown bind failure';
                return { bound: false, detail };
        }
        const store = record.store as Record<string, unknown> | undefined;
        const vocabulary = record.vocabulary as Record<string, unknown> | undefined;
        const runtime = record.runtime as Record<string, unknown> | undefined;
        if (store === undefined || vocabulary === undefined || runtime === undefined) {
                return { bound: false, detail: 'the bgAgent binding lacks store/vocabulary/runtime' };
        }
        for (const method of ['submitGraph', 'approveGraph', 'startStep', 'finishStep', 'completeGraph', 'stateOf', 'rowsFor', 'listGraphs']) {
                if (typeof store[method] !== 'function') {
                        return { bound: false, detail: 'the bound store lacks ' + method + '()' };
                }
        }
        if (typeof vocabulary.actor !== 'string' || vocabulary.actor.length === 0 || typeof vocabulary.from !== 'string' || vocabulary.from.length === 0) {
                return { bound: false, detail: 'the resolved vocabulary lacks actor/from' };
        }
        if (typeof runtime.roster !== 'function') {
                return { bound: false, detail: 'the bgAgent runtime lacks roster()' };
        }
        return {
                bound: true,
                binding: {
                        store: store as unknown as BgStoreBinding,
                        vocabulary: { actor: vocabulary.actor, from: vocabulary.from },
                        roster: () => (runtime.roster as () => Promise<unknown[]>)(),
                },
        };
}

// ---------------------------------------------------------------------------
// Leg drivers over the real seams
// ---------------------------------------------------------------------------

async function driveRegistryEntry(input: {
        registry: RegistryRuntime;
        stepper: Stepper;
        profile: IndustryProfile;
        runIndex: number;
        entryIndex: number;
}): Promise<SimLegReceipt[]> {
        const { registry, stepper, profile, runIndex, entryIndex } = input;
        const needs = profile.capabilityNeeds;
        const contentHash = capabilityContentHash(profile.id, runIndex, entryIndex);
        const disclosure = REGISTRY_DISCLOSURE + ' (' + needs.disclosure + ')';

        const discover = await runLeg({
                legId: 'registry:discover:' + profile.id + ':r' + runIndex + ':e' + entryIndex,
                kind: 'registry',
                op: 'discover',
                evidenceLabel: 'local-real',
                disclosure,
                stepper,
                drive: async () => {
                        const result = await registry.discover({
                                sourceKind: needs.sourceKind,
                                artifactKind: needs.artifactKind,
                                version: needs.version,
                                contentHash,
                                name: 'cr012-' + profile.id + '-' + runIndex + '-' + entryIndex,
                        });
                        if (!result.ok) {
                                throw new TypedLegFailure(refusalCodeOf(result.refusal), 'discover refused: ' + refusalText(result.refusal));
                        }
                        return {
                                detail: 'discover ' + result.entryId + ' (' + result.state + ')',
                                facts: { entryId: result.entryId, state: result.state, duplicate: result.disclosure !== null },
                        };
                },
        });
        let entryId = typeof discover.facts.entryId === 'string' ? discover.facts.entryId : '';

        const register = await runLeg({
                legId: 'registry:register:' + profile.id + ':r' + runIndex + ':e' + entryIndex,
                kind: 'registry',
                op: 'register',
                evidenceLabel: 'local-real',
                disclosure,
                stepper,
                drive: async () => {
                        const result = await registry.register({
                                digest: contentHash,
                                version: needs.version,
                                license: needs.license,
                                permissions: [...needs.permissions],
                                endpoints: ['https://example.com/demo'],
                                platforms: [needs.platform],
                                artifactKind: needs.artifactKind,
                                provenance: { origin: needs.sourceKind },
                        });
                        if (!result.ok) {
                                throw new TypedLegFailure(refusalCodeOf(result.refusal), 'register refused: ' + refusalText(result.refusal));
                        }
                        entryId = result.entryId;
                        return { detail: 'register ' + result.entryId + ' (' + result.state + ')', facts: { entryId: result.entryId, state: result.state } };
                },
        });

        const verify = await runLeg({
                legId: 'registry:verify:' + profile.id + ':r' + runIndex + ':e' + entryIndex,
                kind: 'registry',
                op: 'verify',
                evidenceLabel: 'local-real',
                disclosure,
                stepper,
                drive: async () => {
                        const result = await registry.verify(entryId, { verificationStatus: 'verified', checks: [{ check: 'digest', outcome: 'match' }] });
                        if (!result.ok) {
                                throw new TypedLegFailure(refusalCodeOf(result.refusal), 'verify refused: ' + refusalText(result.refusal));
                        }
                        return { detail: 'verify ' + result.entryId + ' (' + result.state + ')', facts: { entryId: result.entryId, state: result.state } };
                },
        });

        const approve = await runLeg({
                legId: 'registry:approve:' + profile.id + ':r' + runIndex + ':e' + entryIndex,
                kind: 'registry',
                op: 'approve',
                evidenceLabel: 'local-real',
                disclosure,
                stepper,
                drive: async () => {
                        const result = await registry.approve(entryId, { approver: 'operator-1', acknowledgedPermissions: [...needs.permissions] });
                        if (!result.ok) {
                                throw new TypedLegFailure(refusalCodeOf(result.refusal), 'approve refused: ' + refusalText(result.refusal));
                        }
                        return { detail: 'approve ' + result.entryId + ' (' + result.state + ')', facts: { entryId: result.entryId, state: result.state } };
                },
        });

        const enable = await runLeg({
                legId: 'registry:enable:' + profile.id + ':r' + runIndex + ':e' + entryIndex,
                kind: 'registry',
                op: 'enable',
                evidenceLabel: 'local-real',
                disclosure,
                stepper,
                drive: async () => {
                        const result = await registry.enable(entryId);
                        if (!result.ok) {
                                throw new TypedLegFailure(refusalCodeOf(result.refusal), 'enable refused: ' + refusalText(result.refusal));
                        }
                        return { detail: 'enable ' + result.entryId + ' (' + result.state + ')', facts: { entryId: result.entryId, state: result.state } };
                },
        });

        return [discover, register, verify, approve, enable];
}

function splitSteps(totalSteps: number): number[] {
        const graphs: number[] = [];
        let remaining = totalSteps;
        while (remaining > 0) {
                const take = Math.min(remaining, MAX_STEPS_PER_GRAPH);
                graphs.push(take);
                remaining -= take;
        }
        return graphs;
}

async function driveStoreLegs(input: {
        binding: BgBindingOutcome;
        stepper: Stepper;
        profile: IndustryProfile;
        runIndex: number;
        storeSteps: number;
}): Promise<{ receipts: SimLegReceipt[]; graphIds: string[] }> {
        const { binding, stepper, profile, runIndex, storeSteps } = input;
        if (!binding.bound) {
                return {
                        receipts: [
                                skippedLeg(
                                        'store:bind:' + profile.id + ':r' + runIndex,
                                        'store',
                                        'bind',
                                        'local-real',
                                        STORE_DISCLOSURE,
                                        'the bgAgent binding is not bound: ' + binding.detail,
                                ),
                        ],
                        graphIds: [],
                };
        }
        const store = binding.binding.store;
        const actor = binding.binding.vocabulary.actor;
        const runnerId = binding.binding.vocabulary.from;
        /* The executor-side actor: the frozen STEP_TRANSITIONS law (orchestration.mjs)
         * admits agent|tool|service for step-started/step-succeeded and graph-completed —
         * the vocabulary actor (human, the operator-side submit/approve acts) is NOT
         * step-legal. The simulation drives the executor side itself, so the steps and
         * complete legs speak as 'service' (the harness-as-runner disclosure).
         * (The A-PROD-006-W4 audit find: the landed code drove startStep/finishStep/
         * completeGraph with the human actor -- the store correctly refused every
         * step-started transition, so the store legs could never go green.) */
        const stepActor = 'service';
        const receipts: SimLegReceipt[] = [];
        const graphIds: string[] = [];
        const graphSizes = splitSteps(storeSteps);

        for (let graphIndex = 0; graphIndex < graphSizes.length; graphIndex += 1) {
                const stepCount = graphSizes[graphIndex];
                const stepDefs = Array.from({ length: stepCount }, (_, k) => ({
                        stepId: 'S-' + String(k + 1).padStart(2, '0'),
                        title: 'sim step ' + String(k + 1),
                        instruction: 'CR-012 simulation step over the real orchestration store',
                }));
                const legBase = 'store:' + profile.id + ':r' + runIndex + ':g' + graphIndex;

                const submit = await runLeg({
                        legId: legBase + ':submit',
                        kind: 'store',
                        op: 'submit',
                        evidenceLabel: 'local-real',
                        disclosure: STORE_DISCLOSURE,
                        stepper,
                        drive: async () => {
                                const result = await store.submitGraph({
                                        title: 'cr012 ' + profile.id + ' run ' + runIndex + ' graph ' + graphIndex,
                                        steps: stepDefs,
                                        actor,
                                        origin: SIM_ORIGIN,
                                });
                                return { detail: 'submit ' + result.graphId + ' (' + stepCount + ' steps)', facts: { graphId: result.graphId, steps: stepCount } };
                        },
                });
                if (submit.status !== 'green') {
                        receipts.push(
                                submit,
                                skippedLeg(legBase + ':approve', 'store', 'approve', 'local-real', STORE_DISCLOSURE, 'submit failed'),
                                skippedLeg(legBase + ':steps', 'store', 'steps', 'local-real', STORE_DISCLOSURE, 'submit failed'),
                                skippedLeg(legBase + ':complete', 'store', 'complete', 'local-real', STORE_DISCLOSURE, 'submit failed'),
                        );
                        continue;
                }
                const graphId = typeof submit.facts.graphId === 'string' ? submit.facts.graphId : '';
                graphIds.push(graphId);

                const approve = await runLeg({
                        legId: legBase + ':approve',
                        kind: 'store',
                        op: 'approve',
                        evidenceLabel: 'local-real',
                        disclosure: STORE_DISCLOSURE,
                        stepper,
                        drive: async () => {
                                const row = (await store.approveGraph({ graphId, actor, origin: SIM_ORIGIN })) as { rowId?: string };
                                return { detail: 'approve ' + graphId, facts: { graphId, rowId: typeof row?.rowId === 'string' ? row.rowId : '' } };
                        },
                });

                const steps = approve.status === 'green'
                        ? await runLeg({
                                legId: legBase + ':steps',
                                kind: 'store',
                                op: 'steps',
                                evidenceLabel: 'local-real',
                                disclosure: STORE_DISCLOSURE,
                                stepper,
                                drive: async () => {
                                        let started = 0;
                                        let succeeded = 0;
                                        for (const def of stepDefs) {
                                                const start = await store.startStep({ graphId, stepId: def.stepId, runnerId, actor: stepActor, origin: SIM_ORIGIN });
                                                started += 1;
                                                await store.finishStep({
                                                        graphId,
                                                        stepId: def.stepId,
                                                        attempt: start.attempt,
                                                        outcome: 'succeeded',
                                                        actor: stepActor,
                                                        origin: SIM_ORIGIN,
                                                        output: 'sim-output:' + profile.id + ':' + runIndex + ':' + graphId + ':' + def.stepId,
                                                });
                                                succeeded += 1;
                                        }
                                        return { detail: 'steps ' + succeeded + '/' + stepCount + ' started+succeeded', facts: { graphId, steps: stepCount, started, succeeded } };
                                },
                        })
                        : skippedLeg(legBase + ':steps', 'store', 'steps', 'local-real', STORE_DISCLOSURE, 'approve failed');

                const complete = steps.status === 'green'
                        ? await runLeg({
                                legId: legBase + ':complete',
                                kind: 'store',
                                op: 'complete',
                                evidenceLabel: 'local-real',
                                disclosure: STORE_DISCLOSURE,
                                stepper,
                                drive: async () => {
                                        await store.completeGraph({ graphId, actor: stepActor, origin: SIM_ORIGIN });
                                        const rows = store.rowsFor(graphId);
                                        return { detail: 'complete ' + graphId + ' (' + rows.length + ' rows)', facts: { graphId, rowsForGraph: rows.length } };
                                },
                        })
                        : skippedLeg(legBase + ':complete', 'store', 'complete', 'local-real', STORE_DISCLOSURE, 'steps failed');

                receipts.push(submit, approve, steps, complete);
        }

        const verify = await runLeg({
                legId: 'store:verify-journal:' + profile.id + ':r' + runIndex,
                kind: 'store',
                op: 'verify-journal',
                evidenceLabel: 'local-real',
                disclosure: STORE_DISCLOSURE,
                stepper,
                drive: async () => {
                        const result = store.verifyJournal === undefined ? null : store.verifyJournal();
                        if (result === null) {
                                return { detail: 'verifyJournal not exposed by the binding', facts: { chainOk: null, chainRows: null } };
                        }
                        return {
                                detail: 'journal chain ' + (result.ok ? 'ok' : 'BROKEN') + ' at ' + result.rows + ' rows',
                                facts: { chainOk: result.ok, chainRows: result.rows },
                        };
                },
        });
        receipts.push(verify);
        return { receipts, graphIds };
}

async function driveRosterLeg(input: { binding: BgBindingOutcome; stepper: Stepper; profile: IndustryProfile; runIndex: number }): Promise<SimLegReceipt> {
        const { binding, stepper, profile, runIndex } = input;
        return runLeg({
                legId: 'roster:' + profile.id + ':r' + runIndex,
                kind: 'roster',
                op: 'roster',
                evidenceLabel: 'local-real',
                disclosure: ROSTER_DISCLOSURE,
                stepper,
                drive: async () => {
                        if (!binding.bound) {
                                throw new TypedLegFailure('roster-unbound', 'the bgAgent binding is not bound: ' + binding.detail);
                        }
                        const agents = await binding.binding.roster();
                        return { detail: 'roster ' + agents.length + ' agents', facts: { agents: agents.length } };
                },
        });
}

async function driveCliLegs(input: { root: string; stepper: Stepper; profile: IndustryProfile; runIndex: number; graphIds: readonly string[] }): Promise<SimLegReceipt[]> {
        const { root, stepper, profile, runIndex, graphIds } = input;
        const latest = graphIds.length > 0 ? graphIds[graphIds.length - 1] : undefined;
        const view =
                latest === undefined
                        ? skippedLeg('cli:view:' + profile.id + ':r' + runIndex, 'cli', 'workflow.view', 'local-real', CLI_DISCLOSURE, 'no graph to view (store legs failed)')
                        : await runLeg({
                                legId: 'cli:view:' + profile.id + ':r' + runIndex,
                                kind: 'cli',
                                op: 'workflow.view',
                                evidenceLabel: 'local-real',
                                disclosure: CLI_DISCLOSURE,
                                stepper,
                                drive: async () => {
                                        const result = await runCli(['--root', root, 'workflow.view', latest]);
                                        if (result.response === undefined) {
                                                throw new TypedLegFailure(
                                                        'cli-no-response',
                                                        'workflow.view produced no response (edge: ' + (result.edgeFailure !== undefined ? result.edgeFailure.reason : 'none') + ')',
                                                );
                                        }
                                        if (result.response.commandPath !== 'workflow.view') {
                                                throw new TypedLegFailure('cli-wrong-path', 'expected workflow.view, got ' + result.response.commandPath);
                                        }
                                        return {
                                                detail: 'workflow.view ' + latest + ' -> ' + result.response.outcome + ' (exit ' + result.exitCode + ')',
                                                facts: { commandPath: result.response.commandPath, exitCode: result.exitCode, outcome: result.response.outcome },
                                        };
                                },
                        });
        const rosterCli = await runLeg({
                legId: 'cli:roster:' + profile.id + ':r' + runIndex,
                kind: 'cli',
                op: 'background-agent.roster',
                evidenceLabel: 'local-real',
                disclosure: CLI_DISCLOSURE,
                stepper,
                drive: async () => {
                        const result = await runCli(['--root', root, 'background-agent.roster']);
                        if (result.response === undefined) {
                                throw new TypedLegFailure(
                                        'cli-no-response',
                                        'background-agent.roster produced no response (edge: ' + (result.edgeFailure !== undefined ? result.edgeFailure.reason : 'none') + ')',
                                );
                        }
                        return {
                                detail: 'background-agent.roster -> ' + result.response.outcome + ' (exit ' + result.exitCode + ')',
                                facts: { commandPath: result.response.commandPath, exitCode: result.exitCode, outcome: result.response.outcome },
                        };
                },
        });
        return [view, rosterCli];
}

async function driveLabLegs(input: { stepper: Stepper; profile: IndustryProfile; runIndex: number; seedNumeric: number }): Promise<SimLegReceipt[]> {
        const { stepper, profile, runIndex, seedNumeric } = input;
        const seeds = profile.lab.ladderLevel === 2 ? [seedNumeric, seedNumeric + 1] : [seedNumeric];

        const searchLeg = await runLeg({
                legId: 'lab:search:' + profile.id + ':r' + runIndex,
                kind: 'lab',
                op: 'search-organizations',
                evidenceLabel: 'local-real',
                disclosure: LAB_DISCLOSURE,
                stepper,
                drive: async () => {
                        const request: OrgSearchRequest = {
                                scope: LAB_FIXTURE_SCOPE,
                                scenarioId: profile.lab.scenarioId,
                                taskTypeId: profile.lab.taskTypeId,
                                utilityWeights: profile.lab.utilityWeights,
                                ladderLevel: profile.lab.ladderLevel,
                                seeds,
                                maxAgents: profile.lab.maxAgents,
                        };
                        const result = searchOrganizations(request);
                        if (result === undefined) {
                                throw new TypedLegFailure('lab-search-invalid-request', 'searchOrganizations returned undefined (invalid request: utility weights must be non-negative and sum to 1)');
                        }
                        return {
                                detail: 'search ' + result.candidates.length + ' candidates, best ' + result.best.candidate.id,
                                facts: { candidates: result.candidates.length, best: result.best.candidate.id, baseline: result.baseline.candidate.id },
                        };
                },
        });

        const ladderLeg = await runLeg({
                legId: 'lab:ladder:' + profile.id + ':r' + runIndex,
                kind: 'lab',
                op: 'run-ladder',
                evidenceLabel: 'local-real',
                disclosure: LAB_DISCLOSURE,
                stepper,
                drive: async () => {
                        const searchRequest: OrgSearchRequest = {
                                scope: LAB_FIXTURE_SCOPE,
                                scenarioId: profile.lab.scenarioId,
                                taskTypeId: profile.lab.taskTypeId,
                                utilityWeights: profile.lab.utilityWeights,
                                ladderLevel: profile.lab.ladderLevel,
                                seeds,
                                maxAgents: profile.lab.maxAgents,
                        };
                        const search = searchOrganizations(searchRequest);
                        if (search === undefined) {
                                throw new TypedLegFailure('lab-search-invalid-request', 'searchOrganizations returned undefined (invalid request: utility weights must be non-negative and sum to 1)');
                        }
                        const baseline = search.baseline.candidate;
                        const rest = search.candidates.filter((c) => c.candidate.id !== baseline.id).map((c) => c.candidate);
                        const request: EvaluationRequest = {
                                scope: LAB_FIXTURE_SCOPE,
                                runId: 'sim-' + profile.id + '-r' + runIndex,
                                taskScenarioId: profile.lab.scenarioId,
                                ladderLevel: profile.lab.ladderLevel,
                                seeds,
                                instanceCount: profile.lab.instanceCount,
                                utilityWeights: profile.lab.utilityWeights,
                                candidates: [baseline, ...rest],
                        };
                        const ladder = runLadder(request);
                        if (ladder === undefined) {
                                throw new TypedLegFailure('lab-ladder-invalid-request', 'runLadder returned undefined (invalid request)');
                        }
                        return {
                                detail:
                                        'ladder ' + ladder.reports.length + ' reports, best ' + ladder.bestReport.candidate.id + ' (utility ' + round6(ladder.bestReport.utility) + ')',
                                facts: {
                                        reports: ladder.reports.length,
                                        best: ladder.bestReport.candidate.id,
                                        bestUtility: round6(ladder.bestReport.utility),
                                        baselineUtility: round6(ladder.baselineReport.utility),
                                        engineEvidenceLevel: ladder.bestReport.evidenceLevel,
                                        seedsUsed: seeds.length,
                                        traceSteps: ladder.trace.length,
                                        baselineId: baseline.id,
                                        firstCandidateId: request.candidates[0].id,
                                },
                        };
                },
        });
        return [searchLeg, ladderLeg];
}

async function driveQueryLegs(input: { registry: RegistryRuntime; stepper: Stepper; profile: IndustryProfile; runIndex: number }): Promise<SimLegReceipt[]> {
        const { registry, stepper, profile, runIndex } = input;
        const specs: readonly { op: string; predicate: QueryPredicate }[] = [
                { op: 'query-all', predicate: {} },
                { op: 'query-approved', predicate: { state: 'approved' } },
                { op: 'query-cli', predicate: { artifactKind: 'cli' } },
                { op: 'query-platform', predicate: { platform: 'linux-x64' } },
        ];
        const receipts: SimLegReceipt[] = [];
        for (const spec of specs) {
                receipts.push(
                        await runLeg({
                                legId: 'registry:' + spec.op + ':' + profile.id + ':r' + runIndex,
                                kind: 'query',
                                op: spec.op,
                                evidenceLabel: 'local-real',
                                disclosure: REGISTRY_DISCLOSURE,
                                stepper,
                                drive: async () => {
                                        const result = await registry.query(spec.predicate);
                                        if (!result.ok) {
                                                throw new TypedLegFailure(refusalCodeOf(result.refusal), spec.op + ' refused: ' + refusalText(result.refusal));
                                        }
                                        return {
                                                detail: spec.op + ' matched ' + result.count + ' entries',
                                                facts: { count: result.count, resultBytes: canonicalJson(result.entries).length },
                                        };
                                },
                        }),
                );
        }
        return receipts;
}

// ---------------------------------------------------------------------------
// Measurements and the battery baseline
// ---------------------------------------------------------------------------

async function countLines(path: string): Promise<number> {
        try {
                const text = await readFile(path, 'utf8');
                return text.split('\n').filter((line) => line.length > 0).length;
        } catch {
                return 0;
        }
}

async function collectMeasurements(input: {
        root: string;
        registry: RegistryRuntime;
        binding: BgBindingOutcome;
        legs: readonly SimLegReceipt[];
        latestGraphId: string | undefined;
}): Promise<SimRunMeasurements> {
        const { root, binding, legs, latestGraphId } = input;
        const factOf = (op: string): LegFacts => legs.find((leg) => leg.op === op && leg.status === 'green')?.facts ?? {};
        const countOf = (op: string): number => {
                const value = factOf(op).count;
                return typeof value === 'number' ? value : 0;
        };
        const bytesOf = (op: string): number => {
                const value = factOf(op).resultBytes;
                return typeof value === 'number' ? value : 0;
        };
        const chainOkRaw = factOf('verify-journal').chainOk;
        const chainRowsRaw = factOf('verify-journal').chainRows;
        return {
                registryJournalLines: await countLines(join(registryRootFor(root), REGISTRY_JOURNAL)),
                registryEntriesTotal: countOf('query-all'),
                registryQueryCounts: { total: countOf('query-all'), approved: countOf('query-approved'), cli: countOf('query-cli'), linuxX64: countOf('query-platform') },
                registryQueryBytes: { total: bytesOf('query-all'), approved: bytesOf('query-approved'), cli: bytesOf('query-cli'), linuxX64: bytesOf('query-platform') },
                storeJournalRows: await countLines(join(root, ...STORE_JOURNAL_RELATIVE)),
                storeGraphs: binding.bound ? binding.binding.store.listGraphs().length : 0,
                storeRowsLatestGraph: binding.bound && latestGraphId !== undefined ? binding.binding.store.rowsFor(latestGraphId).length : 0,
                storeChainOk: typeof chainOkRaw === 'boolean' ? chainOkRaw : null,
                storeChainRows: typeof chainRowsRaw === 'number' ? chainRowsRaw : null,
        };
}

export function stubBatteryDriver(batteryRoot: string): DriverRunner {
        return async () => ({
                invocation: ['cr012-simulation-stub-driver'],
                exitCode: 0,
                outDir: join(batteryRoot, 'dogfood-records'),
                exercises: ['agent-delegation', 'tools-exploration'],
                verdictGreen: true,
                runGreenText: true,
        });
}

function projectBattery(record: BatteryRunRecord, selected: readonly IndustryProfile[], driverMode: 'stub-injected' | 'caller-injected'): BatteryBaselineProjection {
        const pendingSteps = JOURNEYS.flatMap((journey) =>
                journey.steps
                        .filter((step) => step.status === 'pending-wiring')
                        .map((step) => ({ stepId: step.stepId, pendingOwner: String(step.pendingOwner) })),
        );
        const referenced = new Set<string>();
        for (const profile of selected) {
                for (const key of Object.keys(profile.journeyLegWeights)) {
                        referenced.add(key);
                }
        }
        const core = record.journeys.filter((receipt) => receipt.journeyId !== 'journey-7-unsafe-capability');
        /* station seam-fix: strict-mode no-undefined guard — the battery record's
         * driver leg is optional in the type; the projection requires it (the
         * battery always runs the driver leg per its own runner contract). */
        if (record.driver === undefined) {
                throw new TypedLegFailure('battery-driver-missing', 'the battery run record carries no driver leg (the runner contract requires one)');
        }
        return {
                batteryVersion: record.batteryVersion,
                driverMode,
                driverExitCode: record.driver.exitCode,
                driverExercises: [...record.driver.exercises],
                coreJourneysGreen:
                        core.length > 0 && core.every((receipt) => receipt.verdict === 'green') && record.driver.verdictGreen && record.reloadDrill.byteEqual,
                journeys: record.journeys.map((receipt) => ({
                        journeyId: receipt.journeyId,
                        verdict: receipt.verdict,
                        executed: receipt.executed.length,
                        pending: receipt.pending.length,
                        labels: [...new Set(receipt.executed.map((step) => step.evidenceLabel))].sort(),
                })),
                reload: {
                        loadedFirst: record.reloadDrill.loadedFirst,
                        disposeApplied: record.reloadDrill.disposeApplied,
                        loadedSecond: record.reloadDrill.loadedSecond,
                        byteEqual: record.reloadDrill.byteEqual,
                },
                capability: { entryId: record.capability.entryId, entryState: record.capability.entryState },
                parity: record.parity.map((entry) => ({ journey: entry.journey, verdict: entry.verdict })),
                pendingSteps,
                referencedPendingSteps: pendingSteps.filter((step) => referenced.has(step.stepId)),
        };
}

function latencyAggregates(legs: readonly SimLegReceipt[]): LatencyAggregate[] {
        const byKind = new Map<string, number[]>();
        for (const leg of legs) {
                const list = byKind.get(leg.kind) ?? [];
                list.push(leg.clockSteps);
                byKind.set(leg.kind, list);
        }
        return [...byKind.keys()].sort().map((legKind) => {
                const steps = byKind.get(legKind) ?? [];
                const total = steps.reduce((sum, value) => sum + value, 0);
                return {
                        legKind,
                        count: steps.length,
                        clockStepsTotal: total,
                        clockStepsMin: steps.length > 0 ? Math.min(...steps) : 0,
                        clockStepsMean: steps.length > 0 ? round6(total / steps.length) : 0,
                        clockStepsMax: steps.length > 0 ? Math.max(...steps) : 0,
                };
        });
}

// ---------------------------------------------------------------------------
// Config validation (fail closed, typed refusals, never throws)
// ---------------------------------------------------------------------------

function validateSimulationConfig(industries: readonly IndustryProfile[], scale: SimulationScale): { code: string; detail: string } | null {
        if (!Array.isArray(industries) || industries.length === 0) {
                return { code: 'E_SIM_CONFIG', detail: 'industries must be a non-empty array of profiles' };
        }
        if (!Number.isInteger(scale.profiles) || scale.profiles < 1 || scale.profiles > industries.length) {
                return { code: 'E_SIM_CONFIG', detail: 'scale.profiles must be an integer within 1..' + String(industries.length) };
        }
        if (!Number.isInteger(scale.runsPerProfile) || scale.runsPerProfile < 1) {
                return { code: 'E_SIM_CONFIG', detail: 'scale.runsPerProfile must be a positive integer' };
        }
        if (!Number.isInteger(scale.entriesPerRun) || scale.entriesPerRun < 2) {
                return { code: 'E_SIM_CONFIG', detail: 'scale.entriesPerRun must be an integer of at least 2' };
        }
        if (scale.seeds !== undefined && (!Number.isInteger(scale.seeds) || scale.seeds < 0)) {
                return { code: 'E_SIM_CONFIG', detail: 'scale.seeds (the derivation salt) must be a non-negative integer' };
        }
        const selected = industries.slice(0, scale.profiles);
        const knownSteps = new Set(JOURNEYS.flatMap((journey) => journey.steps.map((step) => step.stepId)));
        for (const profile of selected) {
                for (const key of Object.keys(profile.journeyLegWeights)) {
                        if (!knownSteps.has(key)) {
                                return { code: 'E_SIM_UNKNOWN_STEP', detail: 'profile ' + profile.id + ' references unknown battery step ' + key };
                        }
                }
                const mix = profile.taskMix;
                const sum = mix.capability + mix.orchestration + mix.lab + mix.cli;
                if (mix.capability < 0 || mix.orchestration < 0 || mix.lab < 0 || mix.cli < 0 || Math.abs(sum - 1) > 1e-9) {
                        return { code: 'E_SIM_TASKMIX', detail: 'profile ' + profile.id + ' has an invalid task mix (non-negative weights summing to 1)' };
                }
                const share = profile.capabilityNeeds.entryShare;
                if (!Number.isInteger(share) || share < 1 || share >= scale.entriesPerRun) {
                        return {
                                code: 'E_SIM_CONFIG',
                                detail: 'profile ' + profile.id + ' entryShare must be a positive integer below entriesPerRun (' + String(scale.entriesPerRun) + ')',
                        };
                }
        }
        return null;
}

// ---------------------------------------------------------------------------
// The simulation
// ---------------------------------------------------------------------------

export async function runSimulation(options: RunSimulationOptions): Promise<SimulationOutcome> {
        const industries = options.industries ?? INDUSTRY_PROFILES;
        const scale = options.scale ?? MODEST_SCALE;
        const configRefusal = validateSimulationConfig(industries, scale);
        if (configRefusal !== null) {
                return { ok: false, refusal: configRefusal };
        }

        const root = resolve(options.root);
        const salt = scale.seeds ?? 0;
        const lane: SimulationReport['lane'] =
                scale.profiles === MODEST_SCALE.profiles && scale.runsPerProfile === MODEST_SCALE.runsPerProfile && scale.entriesPerRun === MODEST_SCALE.entriesPerRun
                        ? 'modest'
                        : scale.profiles === LARGE_SCALE.profiles && scale.runsPerProfile === LARGE_SCALE.runsPerProfile && scale.entriesPerRun === LARGE_SCALE.entriesPerRun
                                ? 'large'
                                : 'custom';

        // The determinism wipe: repeated runs over the same root rebuild byte-identical state.
        await rm(join(root, '.flauz'), { recursive: true, force: true });
        await rm(join(root, 'battery-baseline'), { recursive: true, force: true });
        await rm(join(root, 'simulation-report.json'), { force: true });
        await mkdir(root, { recursive: true });

        const stepper = makeStepper(CLOCK_START);
        const registry = createRegistry({
                root: registryRootFor(root),
                clock: stepper.now,
                fsPort: realRegistryFsPort(),
                scope: deriveScope(root),
        });
        const loaded = await registry.load();
        if (!loaded.ok) {
                return { ok: false, refusal: { code: refusalCodeOf(loaded.refusal), detail: 'registry load refused: ' + refusalText(loaded.refusal) } };
        }
        const recoveredCodeRaw = loaded.recovered === null ? null : (loaded.recovered as unknown as { code?: unknown }).code;
        const registryLoad = {
                seq: loaded.seq,
                entries: loaded.entries,
                recoveredDisclosed: loaded.recovered !== null,
                recoveredCode: typeof recoveredCodeRaw === 'string' ? recoveredCodeRaw : null,
        };

        const binding = await loadBgAgentBinding(root, stepper.now);

        const batteryRoot = join(root, 'battery-baseline');
        const driverMode: 'stub-injected' | 'caller-injected' = options.batteryDriver === undefined ? 'stub-injected' : 'caller-injected';
        const batteryRecord = await runBattery({ root: batteryRoot, driverRunner: options.batteryDriver ?? stubBatteryDriver(batteryRoot) });
        const selected = industries.slice(0, scale.profiles);
        const batteryBaseline = projectBattery(batteryRecord, selected, driverMode);
        const batteryLeg: SimLegReceipt = {
                legId: 'battery:run-baseline',
                kind: 'battery',
                op: 'run-battery',
                status: batteryBaseline.coreJourneysGreen ? 'green' : 'typed-failure',
                evidenceLabel: 'simulated',
                detail:
                        'battery baseline over battery-baseline/ (driver ' + driverMode + ', exit ' + String(batteryBaseline.driverExitCode) +
                        '; core journeys green: ' + String(batteryBaseline.coreJourneysGreen) + ')',
                disclosure: BATTERY_DISCLOSURE,
                clockSteps: 0,
                facts: { journeys: batteryBaseline.journeys.length, coreGreen: batteryBaseline.coreJourneysGreen },
        };

        const runs: SimRunReceipt[] = [];
        for (const profile of selected) {
                for (let runIndex = 0; runIndex < scale.runsPerProfile; runIndex += 1) {
                        const seedHex = hashSeed(profile.id, profile.seedBase, runIndex, salt);
                        const seedNumeric = numericSeedOf(seedHex);
                        const legs: SimLegReceipt[] = [];
                        const entryShare = profile.capabilityNeeds.entryShare;
                        for (let entryIndex = 0; entryIndex < entryShare; entryIndex += 1) {
                                legs.push(...(await driveRegistryEntry({ registry, stepper, profile, runIndex, entryIndex })));
                        }
                        const store = await driveStoreLegs({
                                binding,
                                stepper,
                                profile,
                                runIndex,
                                storeSteps: scale.entriesPerRun - entryShare,
                        });
                        legs.push(...store.receipts);
                        legs.push(await driveRosterLeg({ binding, stepper, profile, runIndex }));
                        legs.push(...(await driveCliLegs({ root, stepper, profile, runIndex, graphIds: store.graphIds })));
                        legs.push(...(await driveLabLegs({ stepper, profile, runIndex, seedNumeric })));
                        legs.push(...(await driveQueryLegs({ registry, stepper, profile, runIndex })));
                        const measurements = await collectMeasurements({
                                root,
                                registry,
                                binding,
                                legs,
                                latestGraphId: store.graphIds.length > 0 ? store.graphIds[store.graphIds.length - 1] : undefined,
                        });
                        runs.push({
                                profileId: profile.id,
                                runIndex,
                                seedHex,
                                seedNumeric,
                                verdict: legs.every((leg) => leg.status === 'green') ? 'green' : 'red',
                                legs,
                                measurements,
                        });
                }
        }

        const ledgerSummaries: LedgerLegSummary[] = [
                { kind: 'battery', op: batteryLeg.op, evidenceLabel: batteryLeg.evidenceLabel, profileId: 'battery-baseline', runIndex: 0, status: batteryLeg.status },
                ...runs.flatMap((run) =>
                        run.legs.map((leg) => ({
                                kind: leg.kind,
                                op: leg.op,
                                evidenceLabel: leg.evidenceLabel,
                                profileId: run.profileId,
                                runIndex: run.runIndex,
                                status: leg.status,
                        })),
                ),
        ];
        const ledger = buildGapLedger({ simulationReceipts: ledgerSummaries, wiringEntries: WIRING });

        const report: SimulationReport = {
                simulationVersion: SIMULATION_VERSION,
                generatedBy: 'cr012-large-scale-simulation',
                lane,
                scale: { profiles: scale.profiles, runsPerProfile: scale.runsPerProfile, entriesPerRun: scale.entriesPerRun, seedsSalt: salt },
                industryIds: selected.map((profile) => profile.id),
                registryLoad,
                batteryBaseline,
                runs,
                measurements: {
                        growth: runs.map((run, index) => ({
                                runOrdinal: index + 1,
                                profileId: run.profileId,
                                runIndex: run.runIndex,
                                registryEntries: run.measurements.registryEntriesTotal,
                                registryJournalLines: run.measurements.registryJournalLines,
                                storeJournalRows: run.measurements.storeJournalRows,
                                storeGraphs: run.measurements.storeGraphs,
                        })),
                        latency: latencyAggregates([batteryLeg, ...runs.flatMap((run) => run.legs)]),
                },
                ledger,
                disclosures: REPORT_DISCLOSURES,
        };

        const reportPath = join(root, 'simulation-report.json');
        await writeFile(reportPath, canonicalJson(report) + '\n', 'utf8');
        return { ok: true, report, reportPath };
}

const REPORT_DISCLOSURES: readonly string[] = [
        PENDING_GATE_DISCLOSURE,
        'one-shape capability lane (D1): state.mjs was never pasted into this lane; every registry leg uses the battery-J4-validated artifact shape and profiles vary density (entryShare), never kind',
        'store runner identity (D2): the orchestration protocol module was never pasted; step runnerIds are the bgAgent binding\'s own resolved vocabulary.from, actors are the binding\'s resolved vocabulary.actor, and step ids are held to the drill-validated two-digit form (graphs carry at most 32 steps)',
        'lab lane (D4): the lab contracts modules were never pasted byte-for-byte; the engine is imported statically (in-repo TypeScript, landed lab lane) and organization candidates are obtained ONLY from the real searchOrganizations -- never hand-built',
        'lab evidence honesty: lab legs are local-real executions of the real engine over the fixture world; the engine\'s own evidence level (fixture) is banked verbatim and never promoted',
        'battery baseline (D6): runBattery executes once per simulation over battery-baseline/ with an injected stub driver (a deterministic record); the real dogfood driver lane remains the battery suite\'s own real-driver test -- never claimed here',
        'battery digest exclusion: the reload drill seeds its graph with the store\'s default clock, so only stable boolean drill facts are banked (no digests, no run ids, no root paths) -- keeping the report byte-deterministic across roots',
        'entry calibration (D7, the R1 ruling): entriesPerRun splits per profile into entryShare registry pipelines plus the remainder as store steps -- the registry rewrites its full snapshot on every mutation, so a 1:1 registry split would make the large lane a hundreds-of-gigabytes run',
        'delegation leg struck (D8): a2a.mjs was never pasted; the CR-002 launch/route/delegation thread is not driven -- the orchestration surface is exercised through the store legs and the roster projection',
        'no WiringMap entry carries the LAB authority: the lab legs are recorded in the receipts and mapped to no capability (never silently dropped)',
        'clockSteps are injected-clock steps (the deterministic stepper threaded into the registry and the store), never wall time; the manual large lane is timed externally by its invoker',
];

// ---------------------------------------------------------------------------
// The manual-lane entry (direct-run guarded, the bin/flauz.ts pattern):
//   node --import tsx build/flauz/journey/simulation/simulate.ts --scale large --root <dir>
// The invoker times the run externally (the harness itself reads no clock).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
        const args = process.argv.slice(2);
        const scaleIndex = args.indexOf('--scale');
        const scaleName = scaleIndex >= 0 && scaleIndex + 1 < args.length ? args[scaleIndex + 1] : 'modest';
        const rootIndex = args.indexOf('--root');
        const rootArg = rootIndex >= 0 && rootIndex + 1 < args.length ? args[rootIndex + 1] : 'flauz-cr012-simulation';
        const scale = scaleName === 'large' ? LARGE_SCALE : MODEST_SCALE;
        const outcome = await runSimulation({ root: rootArg, scale });
        if (!outcome.ok) {
                process.stderr.write('flauz-simulation: ' + outcome.refusal.code + ': ' + outcome.refusal.detail + '\n');
                process.exitCode = 2;
                return;
        }
        const report = outcome.report;
        const green = report.runs.filter((run) => run.verdict === 'green').length;
        const lines = [
                'CR-012 simulation (' + report.lane + ' lane): ' + report.scale.profiles + ' profiles x ' + report.scale.runsPerProfile + ' runs x ' + report.scale.entriesPerRun + ' entries',
                'runs: ' + String(report.runs.length) + ' (green ' + String(green) + ', red ' + String(report.runs.length - green) + ')',
                'registry: ' + String(report.runs.length > 0 ? report.runs[report.runs.length - 1].measurements.registryEntriesTotal : 0) + ' entries, ' +
                        String(report.runs.length > 0 ? report.runs[report.runs.length - 1].measurements.registryJournalLines : 0) + ' journal lines',
                'store: ' + String(report.runs.length > 0 ? report.runs[report.runs.length - 1].measurements.storeGraphs : 0) + ' graphs, ' +
                        String(report.runs.length > 0 ? report.runs[report.runs.length - 1].measurements.storeJournalRows : 0) + ' journal rows',
                'ledger: closed ' + String(report.ledger.summary.closed) + ' / exercised-still-gap ' + String(report.ledger.summary.exercisedStillGap) +
                        ' / unexercised-still-gap ' + String(report.ledger.summary.unexercisedStillGap) + ' of ' + String(report.ledger.summary.total),
                'report: ' + outcome.reportPath,
        ];
        process.stdout.write(lines.join('\n') + '\n');
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
        void main();
}