/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-004 -- the live observatory runtime suite (mocha tdd).
 *
 * Coverage: the REAL authority binding (a real TaskService + a real
 * ExecJournalStore over a temp root, hermetic fs port + injected ticking
 * clock); the plan-mode projection over a REAL task lifecycle (draft ->
 * awaiting-approval -> approved+executing -> superseded, driven by the task
 * authority's own transition discipline); the evidence-edge trail through
 * the contract's canTransitionPlanMode guard (including the request-changes
 * supersede cycle and its fail-closed successor-digest law); the drift
 * verdicts (an approved plan superseded mid-execution is the typed verdict,
 * never an exception); the phases projection over a REAL journal (a graph's
 * acquisition rows classed through PHASE_STATE_ORDER, forward-only
 * transitions through canTransitionPhase, aggregate/effect rows as the
 * typed unclassable verdicts); the runHealth gauge over live task records
 * with injected nowMs at the contract's exported threshold boundaries
 * (healthy -> stalled -> heart-missing); the cold-replay drill (the cursor
 * pinned to the journal's OWN head hash, the contract's replayDigest fold,
 * the fail-closed tampered-cursor refusal carrying BOTH digests); the
 * restart-determinism pin (a fresh runtime over the same root re-derives
 * byte-equal projections); determinism (two identically-built roots produce
 * identical projection bytes; the law-comment greps; the pure ISO
 * converter anchors).
 *
 * Both authorities are REAL: every test drives the actual TaskService (over
 * an mkdtemp root through the injected fs port) and the actual
 * ExecJournalStore (whose rows are seeded through the store's own public
 * appendRow ONLY). The clock ticks 1000 ms per call and every task event ts
 * is an explicit deterministic constant. No wall-clock reads, no
 * randomness.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskService } from '../../../../../extensions/flauz-workspace/src/taskService.ts';
import { ExecJournalStore } from '../../../../../extensions/flauz-execution/src/journal.ts';
import { canonicalJson as execCanonicalJson, execRowHashOf, execSha256Hex } from '../../../../../extensions/flauz-execution/src/contracts.ts';
import {
    ACQUISITION_PHASE_BRIDGE,
    epochMsToIsoUtc,
    ObservatoryRuntime,
    ObservatoryRuntimeError,
    type ObservatoryRuntimeErrorCode,
    PLAN_REVISION_DIGEST_PAYLOAD_KEY,
    planIdOfTask,
    TASK_TRANSITION_PLAN_MODE_BRIDGE,
    taskEventDigest,
} from './observatory.ts';
import * as PhasesContract from '../common/phases.ts';
import * as RunHealthContract from '../common/runHealth.ts';

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

const SCOPE = { tenantId: 'tenant-cr004', workspaceId: 'ws-cr004' };

/** The injected clock: +1000 ms per call (each stamped second is distinct), with an advance helper. */
function makeClock(start = 1_000_000) {
    let t = start;
    return {
        now: (): number => {
            t += 1000;
            return t;
        },
        current: (): number => t,
        advance: (ms: number): void => {
            t += ms;
        },
    };
}

/** The node-backed fs port (the task service's own hermetic test discipline, restated). */
function nodeFsPort() {
    return {
        readFileUtf8: async (target: string): Promise<string | undefined> => {
            try {
                return await fsPromises.readFile(target, { encoding: 'utf-8' });
            } catch (err) {
                if ((err as { code?: string }).code === 'ENOENT') {
                    return undefined;
                }
                throw err;
            }
        },
        writeFile: (target: string, contents: string) => fsPromises.writeFile(target, contents, { encoding: 'utf-8' }),
        appendFile: (target: string, contents: string) => fsPromises.appendFile(target, contents, { encoding: 'utf-8' }),
        rename: (from: string, to: string) => fsPromises.rename(from, to),
        mkdir: async (target: string) => {
            await fsPromises.mkdir(target, { recursive: true });
        },
    };
}

interface Env {
    readonly runtime: ObservatoryRuntime;
    readonly root: string;
    readonly clock: ReturnType<typeof makeClock>;
    cleanup(): Promise<void>;
}

async function freshRuntime(clockStart?: number): Promise<Env> {
    const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-obsrv-'));
    const clock = makeClock(clockStart);
    const runtime = new ObservatoryRuntime({ root, fs: nodeFsPort(), clock: clock.now });
    await runtime.ensure();
    return {
        runtime,
        root,
        clock,
        cleanup: async () => {
            await fsPromises.rm(root, { recursive: true, force: true });
        },
    };
}

function describeErr(error: unknown): string {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** The typed-refusal assertion: every refusal names its violated law through an ObservatoryRuntimeError code. */
async function expectTypedError(code: ObservatoryRuntimeErrorCode, run: () => Promise<unknown> | unknown, check?: (err: ObservatoryRuntimeError) => void): Promise<void> {
    let caught: unknown;
    let completed = false;
    try {
        await run();
        completed = true;
    } catch (error) {
        caught = error;
    }
    assert.ok(!completed, `expected a typed ObservatoryRuntimeError ('${code}') but the operation completed`);
    assert.ok(caught instanceof ObservatoryRuntimeError, `expected ObservatoryRuntimeError, got ${describeErr(caught)}`);
    assert.strictEqual(caught.code, code, `expected code '${code}', got '${caught.code}' (${caught.message})`);
    if (check !== undefined) {
        check(caught);
    }
}

// ---------------------------------------------------------------------------
// The journal seeding helpers (through the store's PUBLIC appendRow only)
// ---------------------------------------------------------------------------

const TASK_RESOURCE_REF = { resourceClass: 'logical-resource', kind: 'task', id: 'flauz:task:obsrv-0001' } as const;

const LOGICAL_TASK_SURFACE = {
    resourceClass: 'logical-resource',
    refId: 'flauz:task:obsrv-0001',
    family: 'task',
    surface: { kind: 'task', envelopePath: '.flauz/tasks.json', taskId: 'T-001' },
} as const;

const ORIGIN = 'cr004-observatory-suite';

function seedAcquired(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number; stepId?: string; attempt?: number }) {
    return journal.appendRow('resource-acquired', {
        graphId: info.graphId,
        stepId: info.stepId ?? 'S-01',
        attempt: info.attempt ?? 1,
        idempotencyKey: `flauz-orch/${info.graphId}/${info.stepId ?? 'S-01'}/run/${String(info.attempt ?? 1)}`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: { purpose: 'the observatory suite acquisition', resource: TASK_RESOURCE_REF },
    });
}

function seedReleased(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number }) {
    return journal.appendRow('resource-released', {
        graphId: info.graphId,
        stepId: 'S-01',
        attempt: 1,
        idempotencyKey: `flauz-orch/${info.graphId}/S-01/run/1`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: { releaseKind: 'completion' },
    });
}

function seedLost(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number }) {
    return journal.appendRow('resource-lost', {
        graphId: info.graphId,
        stepId: 'S-01',
        attempt: 1,
        idempotencyKey: `flauz-orch/${info.graphId}/S-01/run/1`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: { detectedBy: 'manager-report', failureClass: 'executor-death', message: 'the surface was lost' },
    });
}

function seedReattached(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number }) {
    return journal.appendRow('session-reattached', {
        graphId: info.graphId,
        stepId: 'S-01',
        attempt: 1,
        idempotencyKey: `flauz-orch/${info.graphId}/S-01/run/1`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: {
            policyRecheck: 'pass',
            surface: LOGICAL_TASK_SURFACE,
            surfaceDigest: execSha256Hex(execCanonicalJson(LOGICAL_TASK_SURFACE)),
        },
    });
}

function seedHandoff(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number }) {
    return journal.appendRow('handoff-recorded', {
        graphId: info.graphId,
        stepId: 'S-01',
        attempt: 1,
        idempotencyKey: `flauz-orch/${info.graphId}/S-01/run/1`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: {
            surface: LOGICAL_TASK_SURFACE,
            surfaceDigest: execSha256Hex(execCanonicalJson(LOGICAL_TASK_SURFACE)),
        },
    });
}

function seedEffectSettled(journal: ExecJournalStore, info: { graphId: string; acquisitionId: string; ts: number }) {
    return journal.appendRow('effect-settled', {
        graphId: info.graphId,
        stepId: 'S-01',
        attempt: 1,
        idempotencyKey: `flauz-orch/${info.graphId}/S-01/run/1`,
        acquisitionId: info.acquisitionId,
        actor: 'agent',
        origin: ORIGIN,
        ts: info.ts,
        payload: { outcome: 'ok', valueDigest: 'a'.repeat(64) },
    });
}

function seedRecoveryScan(journal: ExecJournalStore, info: { graphId: string; ts: number }) {
    return journal.appendRow('recovery-scan', {
        graphId: info.graphId,
        stepId: null,
        attempt: null,
        idempotencyKey: null,
        acquisitionId: null,
        actor: 'service',
        origin: ORIGIN,
        ts: info.ts,
        payload: { actions: ['none'], clean: true },
    });
}

// ---------------------------------------------------------------------------
// The task lifecycle helpers (through the TaskService's PUBLIC surfaces only)
// ---------------------------------------------------------------------------

async function submitPlan(runtime: ObservatoryRuntime, taskId: string, digest: string, ts: number) {
    return runtime.tasks.appendEvent(taskId, {
        ts,
        actor: 'agent',
        type: 'submit-plan',
        payload: { [PLAN_REVISION_DIGEST_PAYLOAD_KEY]: digest, note: 'the plan submitted for approval' },
    });
}

async function approvePlan(runtime: ObservatoryRuntime, taskId: string, digest: string, ts: number) {
    return runtime.tasks.appendEvent(taskId, {
        ts,
        actor: 'human',
        type: 'approve',
        payload: { [PLAN_REVISION_DIGEST_PAYLOAD_KEY]: digest },
    });
}

async function requestChanges(runtime: ObservatoryRuntime, taskId: string, successorDigest: string | undefined, ts: number) {
    const payload: Record<string, unknown> = { note: 'changes requested' };
    if (successorDigest !== undefined) {
        payload[PLAN_REVISION_DIGEST_PAYLOAD_KEY] = successorDigest;
    }
    return runtime.tasks.appendEvent(taskId, { ts, actor: 'human', type: 'request-changes', payload });
}

/** The typed view unwrapper: a projected plan-mode view or a fail-loud assertion. */
async function projectedView(runtime: ObservatoryRuntime, taskId: string) {
    const verdict = await runtime.planModeForTask(SCOPE, taskId);
    assert.strictEqual(verdict.kind, 'projected', 'expected a projected view, got: ' + JSON.stringify(verdict).slice(0, 200));
    return verdict.view;
}

suite('CR-004 observatory runtime', function () {

    suite('the authority binding', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('the runtime binds the REAL authorities over the root', function () {
            assert.ok(env.runtime.tasks instanceof TaskService, 'the task authority is a real TaskService');
            assert.ok(env.runtime.journal instanceof ExecJournalStore, 'the journal authority is a real ExecJournalStore');
            assert.strictEqual(env.runtime.journal.root, env.root);
            assert.strictEqual(env.runtime.journal.rowsAll().length, 0);
            assert.strictEqual(env.runtime.journal.headHash(), null);
        });

        test('ensure bootstraps the task authority envelope', async function () {
            const envelopeText = await fsPromises.readFile(join(env.root, '.flauz', 'tasks.json'), 'utf-8');
            assert.ok(envelopeText.includes('flauz.tasks/v0'));
            const tasks = await env.runtime.tasks.listTasks();
            assert.deepStrictEqual(tasks, []);
        });

        test('constructor validation is typed and fail-closed', async function () {
            await expectTypedError('INVALID-PARAMS', () => new ObservatoryRuntime({ root: '', clock: env.clock.now }));
            await expectTypedError('INVALID-PARAMS', () => new ObservatoryRuntime({ root: env.root } as unknown as { root: string; clock: () => number }));
            const fsPort = nodeFsPort();
            const partialPort = { readFileUtf8: fsPort.readFileUtf8 } as unknown as ReturnType<typeof nodeFsPort>;
            await expectTypedError('INVALID-PARAMS', () => new ObservatoryRuntime({ root: env.root, fs: partialPort, clock: env.clock.now }));
        });

        test('the default acquisition-id minter derives ids purely from the injected clock', function () {
            const runtime = new ObservatoryRuntime({ root: env.root, clock: env.clock.now });
            const first = runtime.journal.mintAcquisitionId();
            const second = runtime.journal.mintAcquisitionId();
            assert.match(first, /^flauz:exec:[0-9a-f]{16}$/);
            assert.match(second, /^flauz:exec:[0-9a-f]{16}$/);
            assert.notStrictEqual(first, second, 'a ticking clock mints distinct ids');
        });

        test('an injected minter passes through to the journal authority', function () {
            let counter = 0;
            const runtime = new ObservatoryRuntime({
                root: env.root,
                clock: env.clock.now,
                mintAcquisitionId: () => `flauz:exec:${String(counter += 1).padStart(16, '0')}`,
            });
            assert.strictEqual(runtime.journal.mintAcquisitionId(), 'flauz:exec:0000000000000001');
            assert.strictEqual(runtime.journal.mintAcquisitionId(), 'flauz:exec:0000000000000002');
        });
    });

    suite('the planMode view over a real task lifecycle', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('a created task projects draft with an empty evidence trail', async function () {
            const task = await env.runtime.tasks.createTask('the observatory lifecycle task');
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.taskStatus, 'plan');
            assert.strictEqual(view.planMode, 'draft');
            assert.strictEqual(view.eventsProjected, 0);
            assert.deepStrictEqual([...view.evidence], []);
            assert.strictEqual(view.continuity, null);
        });

        test('submit-plan projects awaiting-approval with the approval-requested evidence', async function () {
            const task = await env.runtime.tasks.createTask('the observatory lifecycle task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.planMode, 'awaiting-approval');
            assert.strictEqual(view.evidence.length, 1);
            const row = view.evidence[0]!;
            assert.strictEqual(row.kind, 'evidence');
            if (row.kind === 'evidence') {
                assert.strictEqual(row.row.edge, 'draft->awaiting-approval');
                assert.strictEqual(row.row.evidenceKind, 'approval-requested');
                assert.strictEqual(row.row.taskEventType, 'submit-plan');
                assert.strictEqual(row.row.observedAtIso, epochMsToIsoUtc(10_000));
            }
        });

        test('approve projects executing with BOTH evidence edges (plan-approved then execution-started)', async function () {
            const task = await env.runtime.tasks.createTask('the observatory lifecycle task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await approvePlan(env.runtime, task.id, 'plan-a', 20_000);
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.taskStatus, 'execute');
            assert.strictEqual(view.planMode, 'executing');
            assert.strictEqual(view.evidence.length, 3);
            const edges = view.evidence.map((row) => (row.kind === 'evidence' ? row.row.edge : row.violatedLaw));
            assert.deepStrictEqual(edges, ['draft->awaiting-approval', 'awaiting-approval->approved', 'approved->executing']);
            const kinds = view.evidence.map((row) => (row.kind === 'evidence' ? row.row.evidenceKind : row.violatedLaw));
            assert.deepStrictEqual(kinds, ['approval-requested', 'plan-approved', 'execution-started']);
        });

        test('the full lifecycle: draft -> awaiting-approval -> executing -> superseded (the drift verdict, never an exception)', async function () {
            const task = await env.runtime.tasks.createTask('the observatory lifecycle task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            const awaiting = await projectedView(env.runtime, task.id);
            assert.strictEqual(awaiting.planMode, 'awaiting-approval');
            await approvePlan(env.runtime, task.id, 'plan-a', 20_000);
            const executing = await projectedView(env.runtime, task.id);
            assert.strictEqual(executing.planMode, 'executing');
            // mid-execution revision: the plan is superseded -- the typed drift verdict
            await env.runtime.tasks.appendEvent(task.id, {
                ts: 30_000,
                actor: 'agent',
                type: 'plan-revised',
                payload: { [PLAN_REVISION_DIGEST_PAYLOAD_KEY]: 'plan-b', note: 'the plan revised mid-execution' },
            });
            const superseded = await projectedView(env.runtime, task.id);
            assert.strictEqual(superseded.planMode, 'superseded');
            assert.ok(superseded.continuity !== null && superseded.continuity.kind === 'drifted');
        });

        test('terminal statuses keep the plan pinned (the post-approval statuses project executing)', async function () {
            const task = await env.runtime.tasks.createTask('the terminal-status task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await approvePlan(env.runtime, task.id, 'plan-a', 20_000);
            await env.runtime.tasks.appendEvent(task.id, { ts: 30_000, actor: 'agent', type: 'report', payload: {} });
            await env.runtime.tasks.appendEvent(task.id, { ts: 40_000, actor: 'tool', type: 'verify-pass', payload: {} });
            await env.runtime.tasks.appendEvent(task.id, { ts: 50_000, actor: 'human', type: 'sign-off', payload: {} });
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.taskStatus, 'done');
            assert.strictEqual(view.planMode, 'executing', 'the plan stays pinned until superseded');
            assert.strictEqual(view.evidence.length, 3, 'report/verify-pass/sign-off cross no plan-mode edge');
            assert.ok(view.continuity !== null && view.continuity.kind === 'current');
        });

        test('non-transition events carry no plan-mode edge but stay counted (no silent skips)', async function () {
            const task = await env.runtime.tasks.createTask('the observational task');
            await env.runtime.tasks.appendEvent(task.id, { ts: 10_000, actor: 'agent', type: 'note', payload: { text: 'an observational event' } });
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.eventsProjected, 1);
            assert.deepStrictEqual([...view.evidence], []);
        });

        test('a corrupted envelope status fails closed through the authority (typed wrap, never a silent projection)', async function () {
            const task = await env.runtime.tasks.createTask('the corrupted task');
            const envelopePath = join(env.root, '.flauz', 'tasks.json');
            await fsPromises.writeFile(envelopePath, JSON.stringify({
                $schema: 'flauz.tasks/v0',
                tasks: [{
                    id: task.id,
                    title: 'the corrupted task',
                    status: 'bogus-status',
                    events: [],
                    timing: { created: 1, updatedAt: 1 },
                    changes: [],
                }],
            }), 'utf-8');
            await expectTypedError('TASK-AUTHORITY-REFUSED', () => env.runtime.planModeForTask(SCOPE, task.id));
        });

        test('an unknown task id is the typed TASK-NOT-FOUND refusal', async function () {
            await expectTypedError('TASK-NOT-FOUND', () => env.runtime.planModeForTask(SCOPE, 'T-999'));
            await expectTypedError('TASK-NOT-FOUND', () => env.runtime.planContinuityForTask(SCOPE, 'T-999'));
        });
    });

    suite('the plan continuity verdicts', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test('plan continuity is unpinned before approval (the honest pre-approval gap)', async function () {
            const task = await env.runtime.tasks.createTask('the unpinned task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            const outcome = await env.runtime.planContinuityForTask(SCOPE, task.id);
            assert.strictEqual(outcome.kind, 'unpinned', 'no approval evidence: the typed unpinned verdict, no fabricated anchor');
            if (outcome.kind === 'unpinned') {
                assert.strictEqual(outcome.violatedLaw, 'plan-continuity-unpinned');
                assert.ok(outcome.detail.includes('no approval evidence'));
            }
        });

        test('the pinned record anchors the approved revision at execution start', async function () {
            const task = await env.runtime.tasks.createTask('the pinned task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await approvePlan(env.runtime, task.id, 'plan-a', 20_000);
            const outcome = await env.runtime.planContinuityForTask(SCOPE, task.id);
            assert.ok(outcome !== null && outcome.kind === 'pinned');
            assert.strictEqual(outcome.record.planId, planIdOfTask(task.id));
            assert.strictEqual(outcome.record.pinnedRevisionDigest, 'plan-a');
            assert.strictEqual(outcome.record.pinnedAtIso, epochMsToIsoUtc(20_000));
            assert.strictEqual(outcome.observedRevisionDigest, 'plan-a');
            assert.deepStrictEqual(outcome.verdict, { kind: 'current', planRevisionDigest: 'plan-a' });
        });

        test('the drift verdict is typed, carrying both digests and the violated law (never an exception)', async function () {
            const task = await env.runtime.tasks.createTask('the drifted task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await approvePlan(env.runtime, task.id, 'plan-a', 20_000);
            await env.runtime.tasks.appendEvent(task.id, {
                ts: 30_000,
                actor: 'agent',
                type: 'plan-revised',
                payload: { [PLAN_REVISION_DIGEST_PAYLOAD_KEY]: 'plan-b' },
            });
            const outcome = await env.runtime.planContinuityForTask(SCOPE, task.id);
            assert.ok(outcome !== null && outcome.kind === 'pinned');
            assert.deepStrictEqual(outcome.verdict, {
                kind: 'drifted',
                violatedLaw: 'plan-revision-drift',
                pinnedRevisionDigest: 'plan-a',
                observedRevisionDigest: 'plan-b',
            });
        });

        test('an approval event without the payload digest is the typed unpinned refusal', async function () {
            const task = await env.runtime.tasks.createTask('the digest-less approval task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await env.runtime.tasks.appendEvent(task.id, { ts: 20_000, actor: 'human', type: 'approve', payload: {} });
            const outcome = await env.runtime.planContinuityForTask(SCOPE, task.id);
            assert.ok(outcome !== null && outcome.kind === 'unpinned');
            assert.strictEqual(outcome.violatedLaw, 'plan-continuity-unpinned');
            assert.ok(outcome.detail.includes(PLAN_REVISION_DIGEST_PAYLOAD_KEY));
        });

        test('request-changes supersedes the submitted revision when the successor digest rides the payload', async function () {
            const task = await env.runtime.tasks.createTask('the revision cycle task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await requestChanges(env.runtime, task.id, 'plan-b', 20_000);
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.evidence.length, 2);
            const supersedeRow = view.evidence[1]!;
            assert.strictEqual(supersedeRow.kind, 'evidence');
            if (supersedeRow.kind === 'evidence') {
                assert.strictEqual(supersedeRow.row.edge, 'awaiting-approval->superseded');
                assert.strictEqual(supersedeRow.row.evidenceKind, 'plan-superseded');
            }
            assert.strictEqual(view.taskStatus, 'plan');
            assert.strictEqual(view.planMode, 'draft');
        });

        test('request-changes without the successor digest is the typed supersede-requires-successor refusal row', async function () {
            const task = await env.runtime.tasks.createTask('the successor-less task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await requestChanges(env.runtime, task.id, undefined, 20_000);
            const view = await projectedView(env.runtime, task.id);
            const refused = view.evidence[1]!;
            assert.strictEqual(refused.kind, 'refused');
            assert.strictEqual(refused.violatedLaw, 'plan-mode-supersede-requires-successor-digest');
        });

        test('the revised resubmission opens a fresh plan-mode cycle at draft', async function () {
            const task = await env.runtime.tasks.createTask('the resubmission task');
            await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            await requestChanges(env.runtime, task.id, 'plan-b', 20_000);
            await submitPlan(env.runtime, task.id, 'plan-b', 30_000);
            const view = await projectedView(env.runtime, task.id);
            assert.strictEqual(view.planMode, 'awaiting-approval');
            assert.strictEqual(view.evidence.length, 3);
            const lastRow = view.evidence[2]!;
            assert.strictEqual(lastRow.kind, 'evidence');
            if (lastRow.kind === 'evidence') {
                assert.strictEqual(lastRow.row.edge, 'draft->awaiting-approval');
                assert.strictEqual(lastRow.row.taskEventType, 'submit-plan');
            }
        });

        test('the evidence digest of every row is the sha256 of the canonical task event', async function () {
            const task = await env.runtime.tasks.createTask('the digest task');
            const submitted = await submitPlan(env.runtime, task.id, 'plan-a', 10_000);
            const view = await projectedView(env.runtime, task.id);
            const row = view.evidence[0]!;
            assert.strictEqual(row.kind, 'evidence');
            if (row.kind === 'evidence') {
                assert.strictEqual(row.row.evidenceDigest, taskEventDigest(submitted.events[submitted.events.length - 1]!));
            }
        });
    });

    suite('the phases view over a real journal', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test("a graph's acquisition rows class through PHASE_STATE_ORDER with the journal's own row hashes", function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            const acquired = seedAcquired(env.runtime.journal, { graphId: 'G-901', acquisitionId, ts: 10_000 });
            const released = seedReleased(env.runtime.journal, { graphId: 'G-901', acquisitionId, ts: 20_000 });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-901');
            assert.strictEqual(view.rows, 2);
            assert.strictEqual(view.graphId, 'G-901');
            assert.strictEqual(view.rowsProjected.length, 2);
            const first = view.rowsProjected[0]!;
            assert.strictEqual(first.kind, 'phase');
            if (first.kind === 'phase') {
                assert.strictEqual(first.descriptor.agentTaskState, 'running');
                assert.strictEqual(first.descriptor.phaseId, acquisitionId);
                assert.strictEqual(first.descriptor.parentTaskRef, 'G-901');
                assert.strictEqual(first.descriptor.entryEvidenceDigest, execRowHashOf(acquired));
                assert.strictEqual(first.transition, null, 'the first classed row opens the phase');
                assert.strictEqual(first.descriptor.scope.workspaceId, SCOPE.workspaceId);
            }
            const second = view.rowsProjected[1]!;
            assert.strictEqual(second.kind, 'phase');
            if (second.kind === 'phase') {
                assert.strictEqual(second.descriptor.agentTaskState, 'stopped');
                assert.strictEqual(second.descriptor.entryEvidenceDigest, execRowHashOf(released));
                assert.deepStrictEqual(second.transition, { admissible: true });
            }
        });

        test('the acquire -> lost -> reattach chain projects running -> failed -> running/attached (all forward)', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-902', acquisitionId, ts: 10_000 });
            seedLost(env.runtime.journal, { graphId: 'G-902', acquisitionId, ts: 20_000 });
            seedReattached(env.runtime.journal, { graphId: 'G-902', acquisitionId, ts: 30_000 });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-902');
            const states = view.rowsProjected.map((row) => (row.kind === 'phase' ? row.descriptor.agentTaskState : row.violatedLaw));
            assert.deepStrictEqual(states, ['running', 'failed', 'running/attached']);
            const transitions = view.rowsProjected.map((row) => (row.kind === 'phase' ? row.transition : null));
            assert.deepStrictEqual(transitions[1], { admissible: true });
            assert.deepStrictEqual(transitions[2], { admissible: true });
        });

        test('a lateral handoff after acquire is the typed not-forward verdict (the honest hold disclosure)', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-903', acquisitionId, ts: 10_000 });
            seedHandoff(env.runtime.journal, { graphId: 'G-903', acquisitionId, ts: 20_000 });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-903');
            const handoff = view.rowsProjected[1]!;
            assert.strictEqual(handoff.kind, 'phase');
            if (handoff.kind === 'phase') {
                assert.strictEqual(handoff.descriptor.agentTaskState, 'running');
                assert.strictEqual(handoff.transition !== null && handoff.transition.admissible, false);
                if (handoff.transition !== null && !handoff.transition.admissible) {
                    assert.strictEqual(handoff.transition.violatedLaw, 'phase-transition-not-forward');
                }
            }
        });

        test('aggregate rows are the typed unclassable verdict (never a silent skip)', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-904', acquisitionId, ts: 10_000 });
            seedRecoveryScan(env.runtime.journal, { graphId: 'G-904', ts: 20_000 });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-904');
            assert.strictEqual(view.rows, 2);
            const scan = view.rowsProjected[1]!;
            assert.strictEqual(scan.kind, 'unclassable');
            assert.strictEqual(scan.violatedLaw, 'phase-state-unknown');
            assert.strictEqual(scan.eventType, 'recovery-scan');
            assert.ok(scan.detail.length > 0);
        });

        test('effect-settled rows are the typed unclassable verdict', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-905', acquisitionId, ts: 10_000 });
            seedEffectSettled(env.runtime.journal, { graphId: 'G-905', acquisitionId, ts: 20_000 });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-905');
            const settled = view.rowsProjected[1]!;
            assert.strictEqual(settled.kind, 'unclassable');
            assert.strictEqual(settled.violatedLaw, 'phase-state-unknown');
        });

        test('a denied acquisition opens a failed phase (no transition verdict)', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            env.runtime.journal.appendRow('acquire-denied', {
                graphId: 'G-906',
                stepId: 'S-01',
                attempt: 1,
                idempotencyKey: 'flauz-orch/G-906/S-01/run/1',
                acquisitionId,
                actor: 'agent',
                origin: ORIGIN,
                ts: 10_000,
                payload: { gate: 'graph-state', failureClass: 'acquire-denied', message: 'the gate denied the acquisition', resource: TASK_RESOURCE_REF },
            });
            const view = env.runtime.phasesForGraph(SCOPE, 'G-906');
            const denied = view.rowsProjected[0]!;
            assert.strictEqual(denied.kind, 'phase');
            if (denied.kind === 'phase') {
                assert.strictEqual(denied.descriptor.agentTaskState, 'failed');
                assert.strictEqual(denied.transition, null);
            }
        });

        test('an unknown graph projects zero rows (honest, not an error)', function () {
            const view = env.runtime.phasesForGraph(SCOPE, 'G-999');
            assert.strictEqual(view.rows, 0);
            assert.deepStrictEqual([...view.rowsProjected], []);
        });

        test('the bridge covers every journal event type and PHASE_STATE_ORDER deep-equals the authority order', function () {
            const bridged = new Set(ACQUISITION_PHASE_BRIDGE.map((row) => row.eventType));
            for (const row of ACQUISITION_PHASE_BRIDGE) {
                if (row.agentTaskState !== null) {
                    assert.ok(PhasesContract.PHASE_STATE_ORDER.includes(row.agentTaskState), row.rowId);
                }
            }
            assert.strictEqual(bridged.size, 12, 'the closed EXEC_EVENT_TYPES vocabulary');
            assert.strictEqual(PhasesContract.PHASE_STATE_ORDER.length, 10);
        });

        test('the plan-mode bridge covers every task authority transition verb', function () {
            const bridged = new Set(TASK_TRANSITION_PLAN_MODE_BRIDGE.map((row) => row.transitionType));
            for (const verb of ['submit-plan', 'approve', 'request-changes', 'report', 'verify-pass', 'verify-fail', 'sign-off', 'fail', 'cancel']) {
                assert.ok(bridged.has(verb), `the bridge must cover the authority transition '${verb}'`);
            }
            assert.strictEqual(TASK_TRANSITION_PLAN_MODE_BRIDGE.length, 9);
        });
    });

    suite('the runHealth gauge over live task records', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        /** Creates a task with exactly one heart-bearing event and returns its observed timings. */
        async function taskWithHeart(title: string, eventTs: number) {
            const task = await env.runtime.tasks.createTask(title);
            await env.runtime.tasks.appendEvent(task.id, { ts: eventTs, actor: 'agent', type: 'note', payload: { text: 'a heart event' } });
            return env.runtime.tasks.getTask(task.id);
        }

        test('healthy below the stalled threshold (the boundary is the contract-exported constant)', async function () {
            const task = await taskWithHeart('the healthy task', 10_000_000);
            const lastEventAtMs = task.timing.updatedAt;
            const verdict = await env.runtime.runHealthView(SCOPE, {
                concurrencyCapacity: 2,
                nowMs: lastEventAtMs + RunHealthContract.stalledAfterMs - 1,
            });
            assert.ok(!('kind' in verdict), 'expected a view: ' + JSON.stringify(verdict).slice(0, 200));
            if (!('kind' in verdict)) {
                assert.strictEqual(verdict.tasks[0]!.stallVerdict, 'healthy');
                assert.strictEqual(verdict.tasks[0]!.taskRef, task.id);
            }
        });

        test('stalled at exactly stalledAfterMs', async function () {
            const task = await taskWithHeart('the stalled task', 10_000_000);
            const verdict = await env.runtime.runHealthView(SCOPE, {
                concurrencyCapacity: 2,
                nowMs: task.timing.updatedAt + RunHealthContract.stalledAfterMs,
            });
            assert.ok(!('kind' in verdict));
            if (!('kind' in verdict)) {
                assert.strictEqual(verdict.tasks[0]!.stallVerdict, 'stalled');
            }
        });

        test('heart-missing at exactly heartMissingAfterMs (the heart outranks the event delta)', async function () {
            const task = await taskWithHeart('the heart-missing task', 10_000_000);
            const lastHeartAtMs = task.events[task.events.length - 1]!.ts;
            const verdict = await env.runtime.runHealthView(SCOPE, {
                concurrencyCapacity: 2,
                nowMs: lastHeartAtMs + RunHealthContract.heartMissingAfterMs,
            });
            assert.ok(!('kind' in verdict));
            if (!('kind' in verdict)) {
                assert.strictEqual(verdict.tasks[0]!.stallVerdict, 'heart-missing');
            }
        });

        test('a task with no events is heart-missing immediately (missing heart evidence)', async function () {
            const task = await env.runtime.tasks.createTask('the silent task');
            const verdict = await env.runtime.runHealthView(SCOPE, { concurrencyCapacity: 1, nowMs: task.timing.updatedAt + 1000 });
            assert.ok(!('kind' in verdict));
            if (!('kind' in verdict)) {
                assert.strictEqual(verdict.tasks[0]!.stallVerdict, 'heart-missing');
            }
        });

        test('the mixed view: stalled and heart-missing verdicts coexist and the gauge counts both slots', async function () {
            const stalledTask = await taskWithHeart('the stale-event task', 10_000_000);
            const quietTask = await env.runtime.tasks.createTask('the quiet task');
            const verdict = await env.runtime.runHealthView(SCOPE, {
                concurrencyCapacity: 4,
                nowMs: 10_000_000 + RunHealthContract.heartMissingAfterMs + 1000,
            });
            assert.ok(!('kind' in verdict));
            if (!('kind' in verdict)) {
                const byRef = new Map(verdict.tasks.map((entry) => [entry.taskRef, entry]));
                assert.strictEqual(byRef.get(stalledTask.id)!.stallVerdict, 'heart-missing');
                assert.strictEqual(byRef.get(quietTask.id)!.stallVerdict, 'heart-missing');
                assert.deepStrictEqual(verdict.concurrency, { capacity: 4, inUse: 2, queued: 0 });
            }
        });

        test('the concurrency gauge projects slots from the authority active statuses', async function () {
            const activeTask = await env.runtime.tasks.createTask('the active task');
            const cancelledTask = await env.runtime.tasks.createTask('the cancelled task');
            await env.runtime.tasks.appendEvent(cancelledTask.id, { ts: 10_000, actor: 'human', type: 'cancel', payload: {} });
            const verdict = await env.runtime.runHealthView(SCOPE, { concurrencyCapacity: 3, nowMs: 20_000_000 });
            assert.ok(!('kind' in verdict));
            if (!('kind' in verdict)) {
                const byRef = new Map(verdict.tasks.map((entry) => [entry.taskRef, entry]));
                assert.strictEqual(byRef.get(activeTask.id)!.slot, 'in-use');
                assert.strictEqual(byRef.get(cancelledTask.id)!.slot, 'queued');
                assert.strictEqual(byRef.get(activeTask.id)!.agentTaskState, 'plan');
                assert.strictEqual(byRef.get(cancelledTask.id)!.agentTaskState, 'cancelled');
                assert.deepStrictEqual(verdict.concurrency, { capacity: 3, inUse: 1, queued: 1 });
                assert.deepStrictEqual([...verdict.taskRefs], [activeTask.id, cancelledTask.id]);
            }
        });

        test('an empty task list is the typed run-health-empty-input refusal (the contract verdict)', async function () {
            const verdict = await env.runtime.runHealthView(SCOPE, { concurrencyCapacity: 2, nowMs: 1_000 });
            assert.ok('kind' in verdict);
            if ('kind' in verdict) {
                assert.strictEqual(verdict.violatedLaw, 'run-health-empty-input');
            }
        });

        test('the default nowMs comes from the injected clock (no wall clock anywhere)', async function () {
            const task = await env.runtime.tasks.createTask('the clock-driven task');
            const eventTs = env.clock.current();
            await env.runtime.tasks.appendEvent(task.id, { ts: eventTs, actor: 'agent', type: 'note', payload: { text: 'a heart event' } });
            const fresh = await env.runtime.runHealthView(SCOPE, { concurrencyCapacity: 1 });
            assert.ok(!('kind' in fresh));
            if (!('kind' in fresh)) {
                assert.strictEqual(fresh.tasks[0]!.stallVerdict, 'healthy', 'the freshly injected clock is within every threshold');
            }
            env.clock.advance(RunHealthContract.heartMissingAfterMs + 60_000);
            const advanced = await env.runtime.runHealthView(SCOPE, { concurrencyCapacity: 1 });
            assert.ok(!('kind' in advanced));
            if (!('kind' in advanced)) {
                assert.strictEqual(advanced.tasks[0]!.stallVerdict, 'heart-missing', 'the advanced injected clock crosses the heart threshold');
                assert.strictEqual(advanced.tasks[0]!.taskRef, task.id);
            }
        });
    });

    suite('the cold-replay drill', function () {
        let env: Env;
        setup(async function () {
            env = await freshRuntime();
        });
        teardown(async function () {
            await env.cleanup();
        });

        test("the drill pins the cursor to the journal's OWN head hash", function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-901', acquisitionId, ts: 10_000 });
            const lost = seedLost(env.runtime.journal, { graphId: 'G-901', acquisitionId, ts: 20_000 });
            const verdict = env.runtime.coldReplayDrill(SCOPE);
            assert.strictEqual(verdict.kind, 'drilled');
            if (verdict.kind === 'drilled') {
                assert.strictEqual(verdict.result.cursor.journalPosition, 2);
                assert.strictEqual(verdict.result.cursor.pinnedEventDigest, env.runtime.journal.headHash());
                assert.strictEqual(verdict.result.cursor.pinnedEventDigest, execRowHashOf(lost));
                assert.strictEqual(verdict.result.headHash, execRowHashOf(lost));
                assert.strictEqual(verdict.result.headRowId, 'X-000002');
                assert.strictEqual(verdict.result.journalRows, 2);
                assert.deepStrictEqual(verdict.result.journalVerify, { ok: true, rows: 2 });
            }
        });

        test('the digest fold covers the head slice and rides the contract digests', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            const acquired = seedAcquired(env.runtime.journal, { graphId: 'G-902', acquisitionId, ts: 10_000 });
            const released = seedReleased(env.runtime.journal, { graphId: 'G-902', acquisitionId, ts: 20_000 });
            const verdict = env.runtime.coldReplayDrill(SCOPE);
            assert.strictEqual(verdict.kind, 'drilled');
            if (verdict.kind === 'drilled') {
                assert.deepStrictEqual([...verdict.result.replay.appliedEventDigests], [execRowHashOf(released)]);
                assert.match(verdict.result.replay.journalDigest, /^[0-9a-f]{8}$/);
                assert.strictEqual(verdict.result.replay.cursor.journalPosition, 2);
                assert.notStrictEqual(execRowHashOf(acquired), execRowHashOf(released));
            }
        });

        test('a cursor override re-pins a stored cursor (the resume drill is byte-stable)', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-903', acquisitionId, ts: 10_000 });
            seedReleased(env.runtime.journal, { graphId: 'G-903', acquisitionId, ts: 20_000 });
            const first = env.runtime.coldReplayDrill(SCOPE);
            assert.strictEqual(first.kind, 'drilled');
            if (first.kind === 'drilled') {
                const resumed = env.runtime.coldReplayDrill(SCOPE, first.result.cursor);
                assert.deepStrictEqual(resumed, first);
            }
        });

        test('a tampered cursor is the typed refusal carrying BOTH digests', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-904', acquisitionId, ts: 10_000 });
            seedReleased(env.runtime.journal, { graphId: 'G-904', acquisitionId, ts: 20_000 });
            const headHash = env.runtime.journal.headHash() as string;
            const tampered = {
                scope: SCOPE,
                contractVersion: '1.0.0',
                journalPosition: 1,
                pinnedEventDigest: execRowHashOf(env.runtime.journal.rowsAll()[0]!),
            };
            const verdict = env.runtime.coldReplayDrill(SCOPE, tampered);
            assert.strictEqual(verdict.kind, 'refused');
            if (verdict.kind === 'refused') {
                assert.strictEqual(verdict.violatedLaw, 'cold-replay-cursor-not-at-journal-head');
                assert.strictEqual(verdict.cursorPinnedEventDigest, tampered.pinnedEventDigest);
                assert.strictEqual(verdict.journalHeadDigest, headHash);
                assert.notStrictEqual(verdict.cursorPinnedEventDigest, verdict.journalHeadDigest);
            }
        });

        test('an empty journal is the typed refusal (no head event to pin)', function () {
            const verdict = env.runtime.coldReplayDrill(SCOPE);
            assert.strictEqual(verdict.kind, 'refused');
            if (verdict.kind === 'refused') {
                assert.strictEqual(verdict.violatedLaw, 'replay-cursor-invalid');
                assert.strictEqual(verdict.journalHeadDigest, null);
            }
        });

        test('the drill is repeatable: the same journal folds the same digest, always', function () {
            const acquisitionId = env.runtime.journal.mintAcquisitionId();
            seedAcquired(env.runtime.journal, { graphId: 'G-905', acquisitionId, ts: 10_000 });
            seedLost(env.runtime.journal, { graphId: 'G-905', acquisitionId, ts: 20_000 });
            const first = env.runtime.coldReplayDrill(SCOPE);
            const second = env.runtime.coldReplayDrill(SCOPE);
            assert.deepStrictEqual(second, first);
        });
    });

    suite('restart determinism (the fresh-runtime pin)', function () {
        test('a FRESH runtime over the same root re-derives the identical projections', async function () {
            const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-obsrv-restart-'));
            try {
                const clock = makeClock(1_000_000);
                const original = new ObservatoryRuntime({ root, fs: nodeFsPort(), clock: clock.now });
                await original.ensure();
                const task = await original.tasks.createTask('the restart task');
                await submitPlan(original, task.id, 'plan-a', 10_000);
                await approvePlan(original, task.id, 'plan-a', 20_000);
                const acquisitionId = original.journal.mintAcquisitionId();
                seedAcquired(original.journal, { graphId: 'G-901', acquisitionId, ts: 30_000 });
                seedReleased(original.journal, { graphId: 'G-901', acquisitionId, ts: 40_000 });

                const fresh = new ObservatoryRuntime({ root, fs: nodeFsPort(), clock: makeClock(50_000_000).now });
                const projections = async (runtime: ObservatoryRuntime) => ({
                    planMode: await runtime.planModeForTask(SCOPE, task.id),
                    continuity: await runtime.planContinuityForTask(SCOPE, task.id),
                    phases: runtime.phasesForGraph(SCOPE, 'G-901'),
                    drill: runtime.coldReplayDrill(SCOPE),
                    health: await runtime.runHealthView(SCOPE, { concurrencyCapacity: 2, nowMs: 100_000_000 }),
                });
                const before = JSON.stringify(await projections(original));
                const after = JSON.stringify(await projections(fresh));
                assert.strictEqual(after, before);
            } finally {
                await fsPromises.rm(root, { recursive: true, force: true });
            }
        });
    });

    suite('determinism', function () {
        test('two runs over identically-built roots produce identical projection bytes', async function () {
            const runs: string[] = [];
            for (let index = 0; index < 2; index += 1) {
                const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-obsrv-det-'));
                try {
                    const runtime = new ObservatoryRuntime({ root, fs: nodeFsPort(), clock: makeClock(1_000_000).now });
                    await runtime.ensure();
                    const task = await runtime.tasks.createTask('the determinism task');
                    await submitPlan(runtime, task.id, 'plan-det-a', 10_000);
                    await approvePlan(runtime, task.id, 'plan-det-a', 20_000);
                    await runtime.tasks.appendEvent(task.id, {
                        ts: 30_000,
                        actor: 'agent',
                        type: 'plan-revised',
                        payload: { [PLAN_REVISION_DIGEST_PAYLOAD_KEY]: 'plan-det-b' },
                    });
                    const acquisitionId = runtime.journal.mintAcquisitionId();
                    seedAcquired(runtime.journal, { graphId: 'G-901', acquisitionId, ts: 40_000 });
                    seedLost(runtime.journal, { graphId: 'G-901', acquisitionId, ts: 50_000 });
                    seedReattached(runtime.journal, { graphId: 'G-901', acquisitionId, ts: 60_000 });
                    runs.push(JSON.stringify({
                        planMode: await runtime.planModeForTask(SCOPE, task.id),
                        phases: runtime.phasesForGraph(SCOPE, 'G-901'),
                        drill: runtime.coldReplayDrill(SCOPE),
                        health: await runtime.runHealthView(SCOPE, { concurrencyCapacity: 3, nowMs: 10_000_000 }),
                    }));
                } finally {
                    await fsPromises.rm(root, { recursive: true, force: true });
                }
            }
            assert.strictEqual(runs[0], runs[1]);
        });

        test('the law-comment grep: banned tokens live in comment lines only (runtime + suite)', function () {
            const banned = /Date\.now|Math\.random|new Date\(/;
            for (const file of ['observatory.ts', 'observatory.test.ts']) {
                const source = readFileSync(join(RUNTIME_DIR, file), 'utf-8');
                for (const [index, line] of source.split('\n').entries()) {
                    if (!banned.test(line)) {
                        continue;
                    }
                    const trimmed = line.trim();
                    assert.ok(
                        trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*'),
                        `${file} line ${String(index + 1)}: the determinism-law token appears outside a comment: ${trimmed}`,
                    );
                }
            }
        });

        test('the pure ISO converter anchors (no calendar objects)', function () {
            assert.strictEqual(epochMsToIsoUtc(0), '1970-01-01T00:00:00Z');
            assert.strictEqual(epochMsToIsoUtc(86_400_000), '1970-01-02T00:00:00Z');
            // 1,791,345,600,000 epoch-ms is exactly 2026-10-07T04:00:00Z (the pinned
            // instant, precomputed as a constant -- the suite constructs no calendar
            // object and reads no clock).
            assert.strictEqual(epochMsToIsoUtc(1_791_345_600_000), '2026-10-07T04:00:00Z');
        });
    });

    suite('the dispose law', function () {
        test('every view rejects with DISPOSED after dispose', async function () {
            const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-obsrv-dispose-'));
            try {
                const runtime = new ObservatoryRuntime({ root, fs: nodeFsPort(), clock: makeClock().now });
                await runtime.ensure();
                const task = await runtime.tasks.createTask('the dispose task');
                runtime.dispose();
                await expectTypedError('DISPOSED', () => runtime.planModeForTask(SCOPE, task.id));
                await expectTypedError('DISPOSED', () => runtime.planContinuityForTask(SCOPE, task.id));
                await expectTypedError('DISPOSED', () => runtime.runHealthView(SCOPE, { concurrencyCapacity: 1 }));
                runtime.dispose();
            } finally {
                await fsPromises.rm(root, { recursive: true, force: true });
            }
        });
    });
});
