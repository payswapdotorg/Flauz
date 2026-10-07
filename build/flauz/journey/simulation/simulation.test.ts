/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-012 -- the simulation suite (mocha tdd).
 *
 * Coverage: the profile fixture freeze (real battery step ids, the
 * lab's frozen vocabularies, the J4-validated single capability
 * shape), seed/hash determinism, the scale presets and fail-closed
 * config validation, the registry/store/cli/lab legs over the REAL
 * seams (green lanes + the refusal-never-passes lanes), the
 * gap-closure ledger matrix (coverage, verbatim carry, purity, the
 * synthetic verdict branches, the honest pending-gate disclosure),
 * the report artifact (canonical bytes, the two-fresh-root
 * byte-determinism double-run, root-independence, the growth series,
 * the latency aggregates, the disclosure set), and containment.
 *
 * The in-suite lane is tiny/modest ONLY. The large lane is pinned by
 * its preset numbers and NEVER run here.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { INDUSTRY_PROFILES, INDUSTRIES_VERSION, type IndustryProfile } from './industries.ts';
import {
        LAB_FIXTURE_SCOPE,
        LARGE_SCALE,
        MODEST_SCALE,
        capabilityContentHash,
        hashSeed,
        numericSeedOf,
        runSimulation,
        type SimLegReceipt,
        type SimulationOutcome,
        type SimulationReport,
} from './simulate.ts';
import { GAP_LEDGER_VERSION, PENDING_GATE_DISCLOSURE, buildGapLedger } from './gapClosure.ts';
import { JOURNEYS } from '../battery/battery.ts';
import { WIRING, type WiringEntry } from '../../zcode-patterns/activation/common/wiring.ts';
import { runLadder, type EvaluationRequest } from '../../lab/common/runEngine.ts';
import { FIXTURE_REQUIRED_CAPABILITIES, searchOrganizations, type OrgSearchRequest } from '../../lab/common/orgSearch.ts';
import { getScenario } from '../../lab/common/taskWorlds.ts';
import { createRegistry } from '../../capabilities/registry/registry.mjs';
import { deriveScope, realRegistryFsPort, registryRootFor } from '../../cli/runtime/context.ts';

const TINY = Object.freeze({ profiles: 1, runsPerProfile: 1, entriesPerRun: 6 });
const TINY_ALL = Object.freeze({ profiles: 6, runsPerProfile: 1, entriesPerRun: 8 });

function freshRoot(): Promise<string> {
        return mkdtemp(join(tmpdir(), 'flauz-cr012-'));
}

let tinyCache: Promise<SimulationOutcome> | undefined;
function tinyRun(): Promise<SimulationOutcome> {
        tinyCache ??= (async () => runSimulation({ root: await freshRoot(), scale: TINY }))();
        return tinyCache;
}

let tinyAllCache: Promise<SimulationOutcome> | undefined;
function tinyAllRun(): Promise<SimulationOutcome> {
        tinyAllCache ??= (async () => runSimulation({ root: await freshRoot(), scale: TINY_ALL }))();
        return tinyAllCache;
}

const BAD_WEIGHTS_PROFILE: IndustryProfile = {
        ...INDUSTRY_PROFILES[0],
        id: 'test-bad-weights',
        seedBase: 'test-bad-weights',
        lab: { ...INDUSTRY_PROFILES[0].lab, utilityWeights: { success: 0.9, quality: 0.9, latency: 0.9, cost: 0.9 } },
};

let badWeightsCache: Promise<SimulationOutcome> | undefined;
function badWeightsRun(): Promise<SimulationOutcome> {
        badWeightsCache ??= (async () => runSimulation({ root: await freshRoot(), industries: [BAD_WEIGHTS_PROFILE], scale: TINY }))();
        return badWeightsCache;
}

let modestCache: Promise<{ rootA: string; outcomeA: SimulationOutcome; rootB: string; outcomeB: SimulationOutcome }> | undefined;
function modestPair(): Promise<{ rootA: string; outcomeA: SimulationOutcome; rootB: string; outcomeB: SimulationOutcome }> {
        modestCache ??= (async () => {
                const rootA = await freshRoot();
                const outcomeA = await runSimulation({ root: rootA, scale: MODEST_SCALE });
                const rootB = await freshRoot();
                const outcomeB = await runSimulation({ root: rootB, scale: MODEST_SCALE });
                return { rootA, outcomeA, rootB, outcomeB };
        })();
        return modestCache;
}

function okReport(outcome: SimulationOutcome): SimulationReport {
        assert.equal(outcome.ok, true, 'the simulation outcome must be ok');
        return outcome.ok ? outcome.report : (undefined as never);
}

function runLegs(report: SimulationReport, kind: string): SimLegReceipt[] {
        return report.runs.flatMap((run) => run.legs.filter((leg) => leg.kind === kind));
}

function legByOp(report: SimulationReport, kind: string, op: string): SimLegReceipt {
        const leg = runLegs(report, kind).find((candidate) => candidate.op === op);
        /* station seam-fix: strict-mode narrowing — the assert guards at runtime;
         * the explicit check narrows the type for the return. */
        if (leg === undefined) {
                throw new Error('missing leg: ' + kind + ':' + op);
        }
        return leg;
}

suite('flauz simulation: the industry profile fixtures', () => {
        test('there are exactly six profiles with stable ids', () => {
                assert.equal(INDUSTRY_PROFILES.length, 6);
                assert.deepEqual(
                        INDUSTRY_PROFILES.map((profile) => profile.id),
                        ['se-maintenance', 'content-ops', 'data-analysis', 'support-ops', 'compliance-audit', 'research-synthesis'],
                );
                assert.equal(INDUSTRIES_VERSION, '1.0.0');
        });

        test('every profile is deep-frozen', () => {
                assert.ok(Object.isFrozen(INDUSTRY_PROFILES));
                for (const profile of INDUSTRY_PROFILES) {
                        assert.ok(Object.isFrozen(profile), profile.id);
                        assert.ok(Object.isFrozen(profile.taskMix), profile.id);
                        assert.ok(Object.isFrozen(profile.capabilityNeeds), profile.id);
                        assert.ok(Object.isFrozen(profile.capabilityNeeds.permissions), profile.id);
                        assert.ok(Object.isFrozen(profile.journeyLegWeights), profile.id);
                        assert.ok(Object.isFrozen(profile.lab), profile.id);
                        assert.ok(Object.isFrozen(profile.lab.utilityWeights), profile.id);
                }
        });

        test('journey leg weights name only real battery steps', () => {
                const known = new Set(JOURNEYS.flatMap((journey) => journey.steps.map((step) => step.stepId)));
                for (const profile of INDUSTRY_PROFILES) {
                        assert.ok(Object.keys(profile.journeyLegWeights).length > 0, profile.id);
                        for (const key of Object.keys(profile.journeyLegWeights)) {
                                assert.ok(known.has(key), profile.id + ' references unknown step ' + key);
                        }
                }
        });

        test('pending battery steps are referenced with the manifest\'s own owners', () => {
                const pending = new Map(JOURNEYS.flatMap((journey) => journey.steps.filter((step) => step.status === 'pending-wiring').map((step) => [step.stepId, step.pendingOwner as string])));
                const referencedPending = new Set<string>();
                for (const profile of INDUSTRY_PROFILES) {
                        for (const key of Object.keys(profile.journeyLegWeights)) {
                                if (pending.has(key)) {
                                        referencedPending.add(key);
                                }
                        }
                }
                assert.ok(referencedPending.size > 0, 'at least one profile references a pending battery step');
        });

        test('task mix weights are non-negative and sum to one', () => {
                for (const profile of INDUSTRY_PROFILES) {
                        const mix = profile.taskMix;
                        assert.ok(mix.capability >= 0 && mix.orchestration >= 0 && mix.lab >= 0 && mix.cli >= 0, profile.id);
                        assert.ok(Math.abs(mix.capability + mix.orchestration + mix.lab + mix.cli - 1) <= 1e-9, profile.id);
                }
        });

        test('capability needs stay inside the J4-validated single shape', () => {
                for (const profile of INDUSTRY_PROFILES) {
                        const needs = profile.capabilityNeeds;
                        assert.equal(needs.sourceKind, 'community-project', profile.id);
                        assert.equal(needs.artifactKind, 'cli', profile.id);
                        assert.equal(needs.platform, 'linux-x64', profile.id);
                        assert.equal(needs.license, 'MIT', profile.id);
                        assert.equal(needs.version, '1.0.0', profile.id);
                        assert.deepEqual([...needs.permissions], ['read-files'], profile.id);
                        assert.ok(needs.disclosure.length > 0, profile.id);
                }
        });

        test('entry shares are integers within 1..8 and below the modest entriesPerRun', () => {
                for (const profile of INDUSTRY_PROFILES) {
                        const share = profile.capabilityNeeds.entryShare;
                        assert.ok(Number.isInteger(share) && share >= 1 && share <= 8, profile.id);
                        assert.ok(share < MODEST_SCALE.entriesPerRun, profile.id);
                }
        });

        test('lab parameters stay inside the lab\'s frozen fixture vocabularies', () => {
                const taskTypeIds = Object.keys(FIXTURE_REQUIRED_CAPABILITIES).filter((key) => key !== '_default');
                for (const profile of INDUSTRY_PROFILES) {
                        const lab = profile.lab;
                        assert.notEqual(getScenario(lab.scenarioId), undefined, profile.id + ' scenario');
                        assert.ok(taskTypeIds.includes(lab.taskTypeId), profile.id + ' task type');
                        assert.ok(lab.ladderLevel === 0 || lab.ladderLevel === 1 || lab.ladderLevel === 2, profile.id);
                        assert.ok(lab.maxAgents >= 1 && lab.maxAgents <= 5, profile.id);
                        assert.ok(lab.instanceCount > 0, profile.id);
                        const weights = lab.utilityWeights;
                        const sum = weights.success + weights.quality + weights.latency + weights.cost;
                        assert.ok(weights.success >= 0 && weights.quality >= 0 && weights.latency >= 0 && weights.cost >= 0, profile.id);
                        assert.ok(Math.abs(sum - 1) <= 1e-9, profile.id);
                }
        });

        test('seed bases and profile ids are distinct', () => {
                assert.equal(new Set(INDUSTRY_PROFILES.map((profile) => profile.id)).size, 6);
                assert.equal(new Set(INDUSTRY_PROFILES.map((profile) => profile.seedBase)).size, 6);
        });

        test('profiles are fixture-labeled and the lab parameters genuinely vary', () => {
                for (const profile of INDUSTRY_PROFILES) {
                        assert.equal(profile.evidenceLabel, 'fixture', profile.id);
                }
                const weightVectors = new Set(INDUSTRY_PROFILES.map((profile) => JSON.stringify(profile.lab.utilityWeights)));
                assert.ok(weightVectors.size >= 3, 'at least three distinct lab weight vectors');
                const levels = new Set(INDUSTRY_PROFILES.map((profile) => profile.lab.ladderLevel));
                assert.deepEqual([...levels].sort(), [0, 1, 2]);
        });
});

suite('flauz simulation: seeds and hashes', () => {
        test('hashSeed is deterministic and order-sensitive', () => {
                const a = hashSeed('se-maintenance', 'se-maintenance', 0);
                const b = hashSeed('se-maintenance', 'se-maintenance', 0);
                assert.equal(a, b);
                assert.equal(a.length, 64);
                assert.notEqual(a, hashSeed('se-maintenance', 'se-maintenance', 1));
                assert.notEqual(a, hashSeed('content-ops', 'content-ops', 0));
                assert.notEqual(a, hashSeed('se-maintenance', 'se-maintenance', 0, 1));
        });

        test('numeric seeds are uint32 values', () => {
                for (const profile of INDUSTRY_PROFILES) {
                        for (let runIndex = 0; runIndex < 3; runIndex += 1) {
                                const numeric = numericSeedOf(hashSeed(profile.id, profile.seedBase, runIndex));
                                assert.ok(Number.isInteger(numeric) && numeric >= 0 && numeric < 4294967296, profile.id);
                        }
                }
        });

        test('capability content hashes are unique 64-hex values across the sample grid', () => {
                const seen = new Set<string>();
                for (const profile of INDUSTRY_PROFILES.slice(0, 2)) {
                        for (let runIndex = 0; runIndex < 3; runIndex += 1) {
                                for (let entryIndex = 0; entryIndex < 4; entryIndex += 1) {
                                        const hash = capabilityContentHash(profile.id, runIndex, entryIndex);
                                        assert.match(hash, /^[0-9a-f]{64}$/);
                                        assert.ok(!seen.has(hash));
                                        seen.add(hash);
                                }
                        }
                }
        });

        test('seed bases flow into the derivation', () => {
                const a = hashSeed('se-maintenance', 'se-maintenance', 0);
                const b = hashSeed('se-maintenance', 'compliance-audit', 0);
                assert.notEqual(a, b);
        });
});

suite('flauz simulation: scale presets and config validation', () => {
        test('the modest and large presets are frozen with the ordered numbers', () => {
                assert.deepEqual({ ...MODEST_SCALE }, { profiles: 6, runsPerProfile: 8, entriesPerRun: 32 });
                assert.deepEqual({ ...LARGE_SCALE }, { profiles: 6, runsPerProfile: 16, entriesPerRun: 128 });
                assert.ok(Object.isFrozen(MODEST_SCALE));
                assert.ok(Object.isFrozen(LARGE_SCALE));
        });

        test('invalid configs fail closed with typed refusals (never throws)', async () => {
                const root = await freshRoot();
                const invalidScales = [
                        { profiles: 0, runsPerProfile: 1, entriesPerRun: 6 },
                        { profiles: 1, runsPerProfile: 0, entriesPerRun: 6 },
                        { profiles: 1, runsPerProfile: 1, entriesPerRun: 1 },
                        { profiles: 1, runsPerProfile: 1, entriesPerRun: 4 }, // below the profile's entryShare of 4
                        { profiles: 1, runsPerProfile: 1, entriesPerRun: 6, seeds: -1 },
                ];
                for (const scale of invalidScales) {
                        const outcome = await runSimulation({ root, scale });
                        assert.equal(outcome.ok, false, JSON.stringify(scale));
                        assert.ok(!outcome.ok && outcome.refusal.code.startsWith('E_SIM'), JSON.stringify(scale));
                }
                const unknownStepProfile: IndustryProfile = { ...INDUSTRY_PROFILES[0], journeyLegWeights: { 'j9-s99-nonexistent': 1 } };
                const outcome = await runSimulation({ root, industries: [unknownStepProfile], scale: TINY });
                assert.equal(outcome.ok, false);
                assert.ok(!outcome.ok && outcome.refusal.code === 'E_SIM_UNKNOWN_STEP');
        });

        test('a tiny-scale simulation returns ok with a written report', async function () {
                this.timeout(120000);
                const outcome = await tinyRun();
                assert.equal(outcome.ok, true);
                const report = okReport(outcome);
                assert.equal(report.runs.length, 1);
                assert.equal(report.runs[0].profileId, 'se-maintenance');
                assert.equal(report.lane, 'custom');
        });
});

suite('flauz simulation: registry legs over the real seam', () => {
        test('every registry pipeline leg is green with banked entry ids and states', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const registryLegs = runLegs(report, 'registry');
                assert.equal(registryLegs.length, 20); // 4 entries x 5 ops
                assert.ok(registryLegs.every((leg) => leg.status === 'green'));
                for (const op of ['discover', 'register', 'verify', 'approve', 'enable']) {
                        assert.equal(registryLegs.filter((leg) => leg.op === op).length, 4, op);
                }
                assert.ok(registryLegs.every((leg) => typeof leg.facts.entryId === 'string' && (leg.facts.entryId as string).startsWith('e-')));
                assert.ok(registryLegs.every((leg) => typeof leg.facts.state === 'string' && (leg.facts.state as string).length > 0));
        });

        test('the approve leg banks the battery-validated approved state', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const approve = legByOp(report, 'registry', 'approve');
                assert.equal(approve.status, 'green');
                assert.equal(approve.facts.state, 'approved');
        });

        test('the registry journal on disk carries exactly five lines per entry', async function () {
                this.timeout(120000);
                const outcome = await tinyRun();
                assert.equal(outcome.ok, true);
                const report = okReport(outcome);
                assert.equal(report.runs[0].measurements.registryJournalLines, 5 * 4);
                assert.equal(report.runs[0].measurements.registryJournalLines, 5 * report.runs[0].measurements.registryEntriesTotal);
        });

        test('the fresh-root registry load is recovered-disclosed', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                assert.equal(report.registryLoad.recoveredDisclosed, true);
                assert.equal(report.registryLoad.entries, 0);
        });

        test('entry ids are unique across the simulation with no duplicate disclosures', async function () {
                this.timeout(120000);
                const report = okReport(await tinyAllRun());
                const discoverLegs = runLegs(report, 'registry').filter((leg) => leg.op === 'discover');
                const ids = discoverLegs.map((leg) => leg.facts.entryId as string);
                assert.equal(new Set(ids).size, ids.length);
                assert.ok(discoverLegs.every((leg) => leg.facts.duplicate === false));
        });

        test('a real registry refusal is typed, never a pass', async function () {
                this.timeout(60000);
                const root = await freshRoot();
                const registry = createRegistry({ root: registryRootFor(root), clock: () => 1000, fsPort: realRegistryFsPort(), scope: deriveScope(root) });
                const loaded = await registry.load();
                assert.equal(loaded.ok, true);
                const refused = await registry.register({
                        digest: 'b'.repeat(64),
                        version: '1.0.0',
                        license: 'MIT',
                        permissions: ['read-files'],
                        endpoints: ['https://example.com/demo'],
                        platforms: ['linux-x64'],
                        artifactKind: 'cli',
                        provenance: { origin: 'community-project' },
                });
                assert.equal(refused.ok, false);
                assert.equal((refused.refusal as { code?: string }).code, 'E_REGISTER_REQUIRES_DISCOVERED');
        });
});

suite('flauz simulation: store legs over the real binding', () => {
        test('submit/approve/steps/complete legs are green with G-numbered graph ids', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const submit = legByOp(report, 'store', 'submit');
                const approve = legByOp(report, 'store', 'approve');
                const steps = legByOp(report, 'store', 'steps');
                const complete = legByOp(report, 'store', 'complete');
                for (const leg of [submit, approve, steps, complete]) {
                        assert.equal(leg.status, 'green', leg.op);
                        assert.equal(leg.evidenceLabel, 'local-real', leg.op);
                }
                assert.match(submit.facts.graphId as string, /^G-\d{3,}$/);
                assert.equal(submit.facts.steps, 2); // 6 entries - 4 registry share
        });

        test('the store journal on disk matches the row formula', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const storeSteps = TINY.entriesPerRun - INDUSTRY_PROFILES[0].capabilityNeeds.entryShare;
                const expectedRows = 3 + 2 * storeSteps; // one graph: submitted + approved + completed + 2 rows per step
                assert.equal(report.runs[0].measurements.storeJournalRows, expectedRows);
                assert.equal(report.runs[0].measurements.storeRowsLatestGraph, expectedRows);
        });

        test('the journal chain verifies at the measured row count', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const chain = legByOp(report, 'store', 'verify-journal');
                assert.equal(chain.facts.chainOk, true);
                assert.equal(chain.facts.chainRows, report.runs[0].measurements.storeJournalRows);
        });

        test('listGraphs banks the expected graph count', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                assert.equal(report.runs[0].measurements.storeGraphs, 1);
        });

        test('every driven step started and succeeded', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const steps = legByOp(report, 'store', 'steps');
                assert.equal(steps.facts.started, steps.facts.steps);
                assert.equal(steps.facts.succeeded, steps.facts.steps);
        });

        test('the roster leg is green over the unrouted simulation root', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const roster = legByOp(report, 'roster', 'roster');
                assert.equal(roster.status, 'green');
                assert.equal(roster.facts.agents, 0);
        });

        test('the store artifacts live under the simulation root', async function () {
                this.timeout(120000);
                const outcome = await tinyRun();
                assert.equal(outcome.ok, true);
                const journal = await readFile(join(outcome.ok ? outcome.reportPath : '', '..', '.flauz', 'orchestration', 'journal.jsonl'), 'utf8');
                assert.ok(journal.length > 0);
        });
});

suite('flauz simulation: cli read legs', () => {
        test('workflow.view over a real graph answers on the response channel (never not-found)', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const view = legByOp(report, 'cli', 'workflow.view');
                assert.equal(view.status, 'green');
                assert.equal(view.facts.commandPath, 'workflow.view');
                assert.notEqual(view.facts.outcome, 'not-found');
        });

        test('the roster CLI leg answers on the response channel', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const roster = legByOp(report, 'cli', 'background-agent.roster');
                assert.equal(roster.status, 'green');
                assert.equal(roster.facts.commandPath, 'background-agent.roster');
        });

        test('the cli legs add no store journal rows (read-only proof)', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const chain = legByOp(report, 'store', 'verify-journal');
                assert.equal(chain.facts.chainRows, report.runs[0].measurements.storeJournalRows);
        });
});

suite('flauz simulation: lab legs over the real engine', () => {
        test('search + ladder legs are green for every profile', async function () {
                this.timeout(180000);
                const report = okReport(await tinyAllRun());
                assert.equal(report.runs.length, 6);
                const searchLegs = runLegs(report, 'lab').filter((leg) => leg.op === 'search-organizations');
                const ladderLegs = runLegs(report, 'lab').filter((leg) => leg.op === 'run-ladder');
                assert.equal(searchLegs.length, 6);
                assert.equal(ladderLegs.length, 6);
                assert.ok(searchLegs.every((leg) => leg.status === 'green' && (leg.facts.candidates as number) >= 1));
                assert.ok(ladderLegs.every((leg) => leg.status === 'green'));
        });

        test('the ladder candidate list is baseline-first (the lab law)', async function () {
                this.timeout(180000);
                const report = okReport(await tinyAllRun());
                for (const leg of runLegs(report, 'lab').filter((leg) => leg.op === 'run-ladder')) {
                        assert.equal(leg.facts.firstCandidateId, leg.facts.baselineId);
                }
        });

        test('lab evidence is honest: local-real legs carrying the engine fixture label verbatim', async function () {
                this.timeout(180000);
                const report = okReport(await tinyAllRun());
                for (const leg of runLegs(report, 'lab')) {
                        assert.equal(leg.evidenceLabel, 'local-real');
                        assert.ok(leg.disclosure.includes('fixture world'));
                }
                for (const leg of runLegs(report, 'lab').filter((leg) => leg.op === 'run-ladder')) {
                        assert.equal(leg.facts.engineEvidenceLevel, 'fixture');
                }
        });

        test('L2 profiles evaluate two seeds, L0/L1 one', async function () {
                this.timeout(180000);
                const report = okReport(await tinyAllRun());
                const byProfile = new Map(report.runs.map((run) => [run.profileId, run]));
                const ladderOf = (profileId: string) => runLegs(report, 'lab').find((leg) => leg.legId === 'lab:ladder:' + profileId + ':r0');
                const l2 = ladderOf('research-synthesis');
                const l1 = ladderOf('se-maintenance');
                assert.equal(l2?.facts.seedsUsed, 2);
                assert.equal(l1?.facts.seedsUsed, 1);
                assert.ok(byProfile.size === 6);
        });

        test('the ladder engine is deterministic for identical requests', async function () {
                const profile = INDUSTRY_PROFILES[0];
                const seeds = [numericSeedOf(hashSeed(profile.id, profile.seedBase, 0))];
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
                assert.notEqual(search, undefined);
                const candidates = [search!.baseline.candidate, ...search!.candidates.filter((c) => c.candidate.id !== search!.baseline.candidate.id).map((c) => c.candidate)];
                const request: EvaluationRequest = {
                        scope: LAB_FIXTURE_SCOPE,
                        runId: 'sim-determinism-probe',
                        taskScenarioId: profile.lab.scenarioId,
                        ladderLevel: profile.lab.ladderLevel,
                        seeds,
                        instanceCount: profile.lab.instanceCount,
                        utilityWeights: profile.lab.utilityWeights,
                        candidates,
                };
                assert.deepStrictEqual(runLadder(request), runLadder(request));
        });

        test('an invalid lab profile produces typed failures and a red run, never a pass', async function () {
                this.timeout(120000);
                const report = okReport(await badWeightsRun());
                assert.equal(report.runs[0].verdict, 'red');
                const labLegs = runLegs(report, 'lab');
                assert.equal(labLegs.length, 2);
                assert.ok(labLegs.every((leg) => leg.status === 'typed-failure'));
                assert.ok(labLegs.every((leg) => leg.facts.refusalCode === 'lab-search-invalid-request' || leg.facts.refusalCode === 'lab-ladder-invalid-request'));
                assert.ok(runLegs(report, 'registry').every((leg) => leg.status === 'green'));
                assert.ok(runLegs(report, 'store').every((leg) => leg.status === 'green'));
                assert.notEqual(report.ledger.entries.length, 0);
        });
});

suite('flauz simulation: the gap-closure ledger', () => {
        test('the ledger covers every WiringMap entry in order', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                assert.equal(report.ledger.version, GAP_LEDGER_VERSION);
                assert.deepEqual(
                        report.ledger.entries.map((entry) => entry.capabilityId),
                        WIRING.map((entry) => entry.capabilityId),
                );
        });

        test('gap owners and notes are carried verbatim from the map', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                for (const entry of report.ledger.entries) {
                        const wiring = WIRING.find((candidate) => candidate.capabilityId === entry.capabilityId);
                        assert.notEqual(wiring, undefined, entry.capabilityId);
                        assert.equal(entry.gapOwner, wiring!.gapOwner, entry.capabilityId);
                        assert.equal(entry.gapNote, wiring!.gapNote, entry.capabilityId);
                        assert.equal(entry.state, wiring!.state, entry.capabilityId);
                        assert.equal(entry.mapEvidence, wiring!.evidence, entry.capabilityId);
                }
        });

        test('the ledger never mutates the WiringMap', async function () {
                const before = JSON.stringify(WIRING);
                buildGapLedger({
                        simulationReceipts: [{ kind: 'cli', op: 'workflow.view', evidenceLabel: 'local-real', profileId: 'p', runIndex: 0, status: 'green' }],
                        wiringEntries: WIRING,
                });
                assert.equal(JSON.stringify(WIRING), before);
        });

        test('the deliberate ZC-003 flip closes one entry and the five untouched entries stay unexercised', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const verdicts = new Map(report.ledger.entries.map((entry) => [entry.capabilityId, entry.closureVerdict]));
                /* Post the wave-3 map repair (the deliberate flip, 5e560e04bc4): ZC-003 is
                 * wired (the 54-test pinning suite, local-real) so its verdict is closed and
                 * the untouched-gap group shrinks to five. Authored pre-flip, this test
                 * pinned zero closed entries; the flip landed after CR-012's authoring in
                 * the same wave -- the A-PROD-006-W4 audit updated the pin to the map's
                 * own current truth. */
                assert.equal(report.ledger.summary.closed, 1);
                assert.equal(verdicts.get('ZC-003'), 'closed', 'ZC-003');
                for (const id of ['ZC-004', 'ZC-005', 'ZC-007', 'ZC-008', 'ZC-010']) {
                        assert.equal(verdicts.get(id), 'unexercised-still-gap', id);
                }
                for (const id of ['ZC-001', 'ZC-002', 'ZC-006', 'ZC-009']) {
                        assert.equal(verdicts.get(id), 'exercised-still-gap', id);
                }
        });

        test('the exercised entries name the expected legs and labels', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const byId = new Map(report.ledger.entries.map((entry) => [entry.capabilityId, entry]));
                const kindsOf = (id: string) => (byId.get(id)?.exercisedBy ?? []).map((record) => record.legKind + ':' + record.evidenceLabel).sort();
                assert.ok(kindsOf('ZC-006').includes('registry:local-real'));
                assert.ok(kindsOf('ZC-006').includes('query:local-real'));
                assert.ok(kindsOf('ZC-006').includes('battery:simulated'));
                assert.ok(kindsOf('ZC-002').includes('store:local-real'));
                assert.ok(kindsOf('ZC-002').includes('roster:local-real'));
                assert.ok(kindsOf('ZC-009').includes('cli:local-real'));
                assert.ok(kindsOf('ZC-001').includes('store:local-real'));
                assert.ok(kindsOf('ZC-001').includes('battery:simulated'));
        });

        test('synthetic wired and gap inputs exercise all three verdict branches', () => {
                const wiredEntry: WiringEntry = {
                        capabilityId: 'ZC-TEST-WIRED',
                        title: 'synthetic wired entry',
                        contractModules: ['synthetic.ts'],
                        authority: 'AGENT_OS',
                        state: 'wired',
                        entryPoints: [{ path: 'synthetic.ts', role: 'synthetic' }],
                        stateSource: 'synthetic',
                        projection: 'synthetic',
                        tests: [],
                        evidence: 'local-real',
                };
                const exercisedGap: WiringEntry = {
                        capabilityId: 'ZC-009',
                        title: 'synthetic gap entry over a real leg surface',
                        contractModules: ['synthetic.ts'],
                        authority: 'AGENT_OS',
                        state: 'gap',
                        entryPoints: [],
                        stateSource: 'synthetic',
                        projection: 'synthetic',
                        tests: [],
                        evidence: 'fixture',
                        gapOwner: 'CR-009',
                        gapNote: 'synthetic gap note',
                };
                const untouchedGap: WiringEntry = {
                        capabilityId: 'ZC-TEST-GAP',
                        title: 'synthetic untouched gap entry',
                        contractModules: ['synthetic.ts'],
                        authority: 'AGENT_OS',
                        state: 'gap',
                        entryPoints: [],
                        stateSource: 'synthetic',
                        projection: 'synthetic',
                        tests: [],
                        evidence: 'fixture',
                        gapOwner: 'CR-002',
                        gapNote: 'another synthetic note',
                };
                const ledger = buildGapLedger({
                        simulationReceipts: [{ kind: 'cli', op: 'workflow.view', evidenceLabel: 'local-real', profileId: 'p', runIndex: 0, status: 'green' }],
                        wiringEntries: [wiredEntry, exercisedGap, untouchedGap],
                });
                const verdicts = new Map(ledger.entries.map((entry) => [entry.capabilityId, entry.closureVerdict]));
                assert.equal(verdicts.get('ZC-TEST-WIRED'), 'closed');
                assert.equal(verdicts.get('ZC-009'), 'exercised-still-gap');
                assert.equal(verdicts.get('ZC-TEST-GAP'), 'unexercised-still-gap');
        });

        test('the ledger is pure: double-call equality and re-derivation from the report\'s own receipts', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const receipts = [{ kind: 'battery', op: 'run-battery', evidenceLabel: 'simulated', profileId: 'battery-baseline', runIndex: 0, status: 'green' }];
                const a = buildGapLedger({ simulationReceipts: receipts, wiringEntries: WIRING });
                const b = buildGapLedger({ simulationReceipts: receipts, wiringEntries: WIRING });
                assert.deepStrictEqual(a, b);
                const rebuilt = [
                        {
                                kind: 'battery',
                                op: 'run-battery',
                                evidenceLabel: 'simulated',
                                profileId: 'battery-baseline',
                                runIndex: 0,
                                status: report.batteryBaseline.coreJourneysGreen ? 'green' : 'typed-failure',
                        },
                        ...report.runs.flatMap((run) =>
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
                assert.deepStrictEqual(report.ledger, buildGapLedger({ simulationReceipts: rebuilt, wiringEntries: WIRING }));
        });

        test('ZC-008 carries the honest pending-gate disclosure (gate.mjs not landed)', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const zc008 = report.ledger.entries.find((entry) => entry.capabilityId === 'ZC-008');
                assert.notEqual(zc008, undefined);
                assert.ok(zc008!.disclosures.includes(PENDING_GATE_DISCLOSURE));
                assert.equal(zc008!.gapOwner, 'CR-008');
        });

        test('lab legs map to no capability and the no-LAB-entry disclosure is present', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                assert.ok(report.ledger.disclosures.some((text) => text.includes('no WiringMap entry carries the LAB authority')));
                for (const entry of report.ledger.entries) {
                        assert.ok(!entry.exercisedBy.some((record) => record.legKind === 'lab'), entry.capabilityId);
                }
        });

        test('the summary arithmetic is consistent (owners, counts)', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const summary = report.ledger.summary;
                assert.equal(summary.total, 10);
                assert.equal(summary.closed + summary.exercisedStillGap + summary.unexercisedStillGap, summary.total);
                /* Post-flip: ZC-003 closed, so it no longer counts as a gap owner
                 * (the closed entry is owned by its landed runtime, not a pending CR). */
                assert.deepEqual(summary.byGapOwner, { 'CR-002': 2, 'CR-004': 1, 'CR-005': 1, 'CR-006': 1, 'CR-007': 1, 'CR-008': 1, 'CR-009': 1, 'CR-010': 1 });
                assert.deepEqual(summary.exercisedCapabilityIds, ['ZC-001', 'ZC-002', 'ZC-006', 'ZC-009']);
        });
});

suite('flauz simulation: the report artifact and determinism', () => {
        test('the report is written as canonical JSON with a trailing newline', async function () {
                this.timeout(120000);
                const outcome = await tinyRun();
                assert.equal(outcome.ok, true);
                const text = await readFile(outcome.ok ? outcome.reportPath : '', 'utf8');
                assert.ok(text.endsWith('\n'));
                assert.ok(JSON.parse(text) !== null);
        });

        test('two full modest runs over fresh roots are byte-identical', async function () {
                this.timeout(600000);
                const { outcomeA, outcomeB } = await modestPair();
                assert.equal(outcomeA.ok, true);
                assert.equal(outcomeB.ok, true);
                const textA = await readFile(outcomeA.ok ? outcomeA.reportPath : '', 'utf8');
                const textB = await readFile(outcomeB.ok ? outcomeB.reportPath : '', 'utf8');
                assert.strictEqual(textA, textB);
                assert.equal(okReport(outcomeA).runs.length, 48);
                assert.equal(okReport(outcomeA).lane, 'modest');
        });

        test('the report carries no root-dependent bytes', async function () {
                this.timeout(600000);
                const { rootA, outcomeA } = await modestPair();
                const text = await readFile(outcomeA.ok ? outcomeA.reportPath : '', 'utf8');
                assert.ok(!text.includes(rootA));
                assert.ok(!text.includes(basename(rootA)));
                assert.ok(!text.includes(dirname(rootA)));
        });

        test('the growth series is monotone with the predicted totals', async function () {
                this.timeout(600000);
                const report = okReport((await modestPair()).outcomeA);
                const shares = INDUSTRY_PROFILES.map((profile) => profile.capabilityNeeds.entryShare);
                const expectedEntries = MODEST_SCALE.runsPerProfile * shares.reduce((sum, share) => sum + share, 0);
                const expectedRows =
                        MODEST_SCALE.runsPerProfile *
                        INDUSTRY_PROFILES.reduce((sum, profile) => sum + (3 + 2 * (MODEST_SCALE.entriesPerRun - profile.capabilityNeeds.entryShare)), 0);
                const growth = report.measurements.growth;
                assert.equal(growth.length, 48);
                const final = growth[growth.length - 1];
                assert.equal(final.registryEntries, expectedEntries);
                assert.equal(final.registryJournalLines, 5 * expectedEntries);
                assert.equal(final.storeJournalRows, expectedRows);
                assert.equal(final.storeGraphs, 48);
                for (let index = 1; index < growth.length; index += 1) {
                        assert.ok(growth[index].registryEntries > growth[index - 1].registryEntries);
                        assert.ok(growth[index].storeJournalRows > growth[index - 1].storeJournalRows);
                }
        });

        test('the latency aggregates cover every leg kind with injected-clock steps', async function () {
                this.timeout(600000);
                const report = okReport((await modestPair()).outcomeA);
                const kinds = new Set(report.measurements.latency.map((aggregate) => aggregate.legKind));
                for (const kind of ['registry', 'query', 'store', 'roster', 'lab', 'cli', 'battery']) {
                        assert.ok(kinds.has(kind), kind);
                }
                const registry = report.measurements.latency.find((aggregate) => aggregate.legKind === 'registry');
                assert.ok(registry !== undefined && registry.count === 760 && registry.clockStepsTotal > 0 && registry.clockStepsMin >= 1);
                const battery = report.measurements.latency.find((aggregate) => aggregate.legKind === 'battery');
                assert.ok(battery !== undefined && battery.clockStepsTotal === 0);
        });

        test('the disclosures array carries the honest disclosure set', async function () {
                this.timeout(120000);
                const report = okReport(await tinyRun());
                const text = report.disclosures.join('\n');
                assert.ok(report.disclosures.length >= 8);
                assert.ok(text.includes('gate.mjs (CR-008)'));
                assert.ok(text.includes('one-shape capability lane'));
                assert.ok(text.includes('stub driver'));
                assert.ok(text.includes('entry calibration'));
                assert.ok(text.includes('delegation leg struck'));
                assert.ok(text.includes('LAB authority'));
                assert.ok(text.includes('injected-clock steps'));
                assert.ok(text.includes('battery digest exclusion'));
        });
});

suite('flauz simulation: containment', () => {
        test('the simulation writes nothing outside its given root', async function () {
                this.timeout(180000);
                const root = await freshRoot();
                const parent = dirname(root);
                const before = new Set((await readdir(parent)).sort());
                await runSimulation({ root, scale: TINY });
                const after = new Set((await readdir(parent)).sort());
                assert.deepEqual([...after].filter((name) => !before.has(name)), []);
        });
});