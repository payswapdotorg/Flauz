/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-003 -- the live hook-bus runtime suite (mocha tdd, 54 tests).
 *
 * Coverage: the real-seam bind (typeness, vocabulary resolution, typed
 * refusals over corrupt authorities), registration (every frozen
 * REGISTRATION_VIOLATIONS branch + the verbatim HOOK_POLICY statements),
 * the flagged-hook load law, the honest digest mapping (the pinned event
 * translations + the unmapped census), compose-through-contract (plan
 * orders pinned against hand-computed orders), delivery receipts (plan
 * order, durable canonical lines, flagged dangerous effects), durable
 * cursors (double-run byte equality, restart resume, the independent a2a
 * cursor), determinism (ISO anchors, two-root byte identity, clock
 * accounting), and fail-typed behavior. The seams are REAL: every test
 * drives actual OrchestrationStore/A2ABus instances over mkdtemp roots;
 * seeding goes through the store's own public async APIs only. The
 * injected clock ticks 1000 ms per call so every stamped ISO second is
 * distinct and the accounting is exact (the store's submitGraph alone
 * consumes 3 ticks: createdAt + the row ts + the mirror-event argument).
 * No wall-clock reads, no randomness.
 */

import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindHookBus, epochMsToIsoUtc, HookBusError, JOURNAL_ROW_EVENT_REF_MAPPING, loadHookBus } from './hookBus.ts';
import type { DispatchReport, HookBusRuntime } from './hookBus.ts';
import * as DispatchContract from '../common/dispatch.ts';
import * as PolicyContract from '../common/policy.ts';
import * as RegistrationContract from '../common/registration.ts';

type Bound = Extract<Awaited<ReturnType<typeof bindHookBus>>, { bound: true }>;

const TEST_SCOPE = { workspaceId: 'hookbus-test-workspace', tenantId: 'tenant-local' };
const ORIGIN = 'flauz-hook-bus-test';
const APPROVAL_EVENTS: readonly RegistrationContract.AuthorityEventDigest[] = ['approval.requested', 'approval.resolved', 'task.awaiting-approval'];

/** The injected clock: +1000 ms per call (each stamped second is distinct) with exact call accounting. */
function makeClock(start = 1_000_000) {
    let t = start;
    let calls = 0;
    return {
        now: (): number => {
            calls += 1;
            return (t += 1000);
        },
        calls: (): number => calls,
        current: (): number => t,
    };
}

async function freshBind(): Promise<Bound & { root: string; clock: ReturnType<typeof makeClock> }> {
    const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
    const clock = makeClock();
    const verdict = await bindHookBus(root, { clock: clock.now, scope: TEST_SCOPE });
    if (!verdict.bound) {
        assert.fail(verdict.detail);
    }
    return { root, clock, ...verdict };
}

/** The store's write API, driven test-side through the REAL bound instance (the context.ts raw-cast pattern). */
interface SeedStore {
    submitGraph(input: Record<string, unknown>): Promise<{ graphId: string; taskId: string | null; stepIds: string[]; rowId: string }>;
    approveGraph(input: Record<string, unknown>): Promise<unknown>;
    startStep(input: Record<string, unknown>): Promise<{ attempt: number; idempotencyKey: string; rowId: string }>;
    finishStep(input: Record<string, unknown>): Promise<unknown>;
    completeGraph(input: Record<string, unknown>): Promise<unknown>;
    failGraph(input: Record<string, unknown>): Promise<unknown>;
    approvalRequest(input: Record<string, unknown>): Promise<unknown>;
    approvalDecide(input: Record<string, unknown>): Promise<unknown>;
    expireApproval(input: Record<string, unknown>): Promise<unknown>;
}

function seedStore(bound: Bound): SeedStore {
    return bound.store as unknown as SeedStore;
}

interface SeedBus {
    post(input: { message: Record<string, unknown> }): { id: string; seq: number };
}

function seedBus(bound: Bound): SeedBus {
    return bound.bus as unknown as SeedBus;
}

const GATED_STEP = { stepId: 'S-01', title: 'the gated step', instruction: 'run under the human approval gate', gate: 'human-approval' };
const PLAIN_STEP = { stepId: 'S-01', title: 'the step', instruction: 'run the step' };

/**
 * The gated happy path: 7 rows (graph-submitted, graph-approved,
 * approval-requested, approval-granted, step-started, step-succeeded,
 * graph-completed). Consumes exactly 9 clock ticks: submitGraph 3
 * (createdAt, row ts, mirror-event ts), then one row ts per remaining op.
 * Row ts values: seq1=1_002_000, seq2=1_004_000, seq3=1_005_000,
 * seq4=1_006_000, seq5=1_007_000, seq6=1_008_000, seq7=1_009_000.
 */
async function seedGatedHappyPath(store: SeedStore): Promise<void> {
    const submitted = await store.submitGraph({ title: 'hook-bus gated run', steps: [GATED_STEP], actor: 'human', origin: ORIGIN });
    await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: ORIGIN });
    await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the human gate', actor: 'agent', origin: ORIGIN });
    await store.approvalDecide({ graphId: submitted.graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: ORIGIN });
    const started = await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', runnerId: 'agent-alpha', actor: 'agent', origin: ORIGIN });
    await store.finishStep({ graphId: submitted.graphId, stepId: 'S-01', attempt: started.attempt, outcome: 'succeeded', actor: 'agent', origin: ORIGIN, output: 'the answer' });
    await store.completeGraph({ graphId: submitted.graphId, actor: 'agent', origin: ORIGIN });
}

/** The minimal approval-resolution seed: 4 rows (graph-submitted, graph-approved, approval-requested, approval-granted). */
async function seedApprovalResolved(store: SeedStore): Promise<void> {
    const submitted = await store.submitGraph({ title: 'hook-bus approval run', steps: [GATED_STEP], actor: 'human', origin: ORIGIN });
    await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: ORIGIN });
    await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the human gate', actor: 'agent', origin: ORIGIN });
    await store.approvalDecide({ graphId: submitted.graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: ORIGIN });
}

async function seedDenialPath(store: SeedStore): Promise<void> {
    const submitted = await store.submitGraph({ title: 'hook-bus denial run', steps: [GATED_STEP], actor: 'human', origin: ORIGIN });
    await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: ORIGIN });
    await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the human gate', actor: 'agent', origin: ORIGIN });
    await store.approvalDecide({ graphId: submitted.graphId, stepId: 'S-01', decision: 'denied', actor: 'human', origin: ORIGIN });
    await store.failGraph({ graphId: submitted.graphId, failedStepId: 'S-01', actor: 'agent', origin: ORIGIN });
}

async function seedExpiryPath(store: SeedStore): Promise<void> {
    const submitted = await store.submitGraph({ title: 'hook-bus expiry run', steps: [PLAIN_STEP], actor: 'human', origin: ORIGIN });
    await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: ORIGIN });
    await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the deadline gate', actor: 'agent', origin: ORIGIN, expiresAt: 2_000_000 });
    await store.expireApproval({ graphId: submitted.graphId, stepId: 'S-01', expiredAt: 2_000_000, actor: 'service', origin: ORIGIN });
}

function hookInput(hookId: string, kind: RegistrationContract.HookKind, effectKind: string, events: readonly RegistrationContract.AuthorityEventDigest[], priority: number, enabled = true) {
    return { hookId, kind, effectKind, matchSpec: { kinds: [kind], events }, priority, enabled };
}

/**
 * The dispatch fixture, registered in this exact order (registration order
 * drives the contract's tie-break): A(approval,10) B(approval,5)
 * C(approval,5,disabled) D(finalization,5) E(approval+finalization,0)
 * G(approval,5, after B).
 */
function registerFixtureHooks(runtime: HookBusRuntime): void {
    runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 10));
    runtime.registerHook(hookInput('hook-B', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
    runtime.registerHook(hookInput('hook-C', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5, false));
    runtime.registerHook(hookInput('hook-D', 'finalization', 'context-enrichment', ['finalization.recorded'], 5));
    runtime.registerHook({
        hookId: 'hook-E',
        kind: 'approval',
        effectKind: 'context-enrichment',
        matchSpec: { kinds: ['approval', 'finalization'], events: ['approval.resolved', 'finalization.recorded'] },
        priority: 0,
        enabled: true,
    });
    runtime.registerHook(hookInput('hook-G', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
}

async function runHappyPath(): Promise<{ ctx: Bound & { root: string; clock: ReturnType<typeof makeClock> }; report: DispatchReport }> {
    const ctx = await freshBind();
    await seedGatedHappyPath(seedStore(ctx));
    registerFixtureHooks(ctx.runtime);
    const report = ctx.runtime.dispatch();
    return { ctx, report };
}

function postAllFourKinds(bus: SeedBus): void {
    bus.post({ message: { kind: 'task-delegation', from: 'agent-alpha', to: 'agent-beta', ts: 1_500_000, payload: { taskId: 'T-001', taskDescription: 'the delegated run', prompt: 'run it' } } });
    bus.post({ message: { kind: 'result-report', from: 'agent-beta', to: 'agent-alpha', ts: 1_500_001, payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: [], summary: 'done' } } });
    bus.post({ message: { kind: 'steering-relay', from: 'agent-alpha', to: 'agent-beta', ts: 1_500_002, payload: { taskId: 'T-001', message: 'steer' } } });
    bus.post({ message: { kind: 'resource-claim', from: 'agent-alpha', to: 'agent-beta', ts: 1_500_003, payload: { action: 'acquire', resource: 'flauz-orch/G-001/S-01', leaseUntil: 2_000_000 } } });
}

function writeCorruptOrchJournal(root: string): void {
    mkdirSync(join(root, '.flauz', 'orchestration'), { recursive: true });
    // A malformed NON-final line is corruption (only a torn FINAL line is a
    // crash artifact) -- the store's own strict load throws.
    writeFileSync(join(root, '.flauz', 'orchestration', 'journal.jsonl'), 'not-json\n{}\n');
}

function writeCorruptA2aJournal(root: string): void {
    mkdirSync(join(root, '.flauz', 'a2a'), { recursive: true });
    writeFileSync(join(root, '.flauz', 'a2a', 'messages.jsonl'), 'garbage\n');
}

function writeRegistryEnvelope(root: string, hooks: readonly unknown[]): void {
    mkdirSync(join(root, '.flauz', 'hooks'), { recursive: true });
    writeFileSync(
        join(root, '.flauz', 'hooks', 'registry.json'),
        JSON.stringify({ $schema: 'flauz.hook-bus.registry/v1', registry: { scope: TEST_SCOPE, contractVersion: '1.0.0', hooks } }, null, 2) + '\n',
    );
}

function writePoisonRegistry(root: string): void {
    writeRegistryEnvelope(root, [{
        scope: TEST_SCOPE,
        contractVersion: '1.0.0',
        hookId: 'hook-P',
        kind: 'approval',
        effectKind: 'policy-override',
        matchSpec: { kinds: ['approval'], events: ['approval.resolved'] },
        priority: 0,
        enabled: true,
        registeredAtIso: '2025-01-01T00:00:00Z',
    }]);
}

suite('hookBus: bind over the real seams', () => {
    // T01
    test('bindHookBus binds the real store and bus over a fresh root', async () => {
        const ctx = await freshBind();
        assert.equal(typeof ctx.runtime.registerHook, 'function');
        assert.equal(typeof ctx.runtime.dispatch, 'function');
        assert.equal(typeof ctx.runtime.registry, 'function');
        assert.equal(typeof ctx.store.load, 'function');
        assert.equal(typeof ctx.store.listGraphs, 'function');
        assert.equal(typeof ctx.store.rowsFor, 'function');
        assert.ok(Array.isArray(ctx.bus.messages));
        assert.deepEqual(ctx.runtime.scope, TEST_SCOPE);
    });

    // T02
    test('bindHookBus refuses a non-string (empty) root', async () => {
        const verdict = await bindHookBus('', { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /root/);
        }
    });

    // T03
    test('bindHookBus refuses a missing clock', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        const verdict = await bindHookBus(root, { scope: TEST_SCOPE } as never);
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /clock/);
        }
    });

    // T04
    test('bindHookBus refuses an invalid scope', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: { workspaceId: '', tenantId: 't' } });
        assert.equal(verdict.bound, false);
    });

    // T05
    test('bindHookBus requires a scope on a fresh root', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        const verdict = await bindHookBus(root, { clock: makeClock().now } as never);
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /scope/);
        }
    });

    // T06
    test('loadHookBus without a scope on a fresh root refuses', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        const verdict = await loadHookBus(root, { clock: makeClock().now });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /scope/);
        }
    });

    // T07
    test('the digest mapping is validated against the loaded authority at bind', async () => {
        const ctx = await freshBind();
        assert.equal(ctx.vocabulary.journalEventTypesResolved, true);
        for (const rowType of Object.keys(JOURNAL_ROW_EVENT_REF_MAPPING)) {
            assert.ok(ctx.vocabulary.journalEventTypes.includes(rowType), `mapped row type ${rowType} must be in the authority vocabulary`);
        }
    });

    // T08
    test('the authority journal vocabulary resolves with 33 types and excludes the ledger note kind', async () => {
        const ctx = await freshBind();
        // 6 graph transitions + 13 step transitions + 14 observational records.
        assert.equal(ctx.vocabulary.journalEventTypes.length, 33);
        for (const rowType of ['approval-requested', 'approval-granted', 'approval-denied', 'approval-expired', 'graph-completed', 'lease-expired', 'recovery-scan', 'step-interrupted', 'cancel-observed']) {
            assert.ok(ctx.vocabulary.journalEventTypes.includes(rowType), `${rowType} must be in the authority vocabulary`);
        }
        // 'note' is a flauz.tasks/v0 ledger evidence KIND, never a journal row type.
        assert.equal(ctx.vocabulary.journalEventTypes.includes('note'), false);
    });

    // T09
    test('the message-kind vocabulary resolves from the a2a seam', async () => {
        const ctx = await freshBind();
        assert.equal(ctx.vocabulary.messageKindsResolved, true);
        assert.deepEqual(ctx.vocabulary.messageKinds, ['task-delegation', 'result-report', 'steering-relay', 'resource-claim']);
    });
});

suite('hookBus: typed bind refusals over corrupt authorities', () => {
    // T10
    test('a corrupt orchestration journal refuses the bind', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        writeCorruptOrchJournal(root);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /orchStore load failed/);
        }
    });

    // T11
    test('a corrupt a2a journal refuses the bind', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        writeCorruptA2aJournal(root);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /a2a bus construction failed/);
        }
    });

    // T12
    test('a corrupt hook registry refuses the bind', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-'));
        mkdirSync(join(root, '.flauz', 'hooks'), { recursive: true });
        writeFileSync(join(root, '.flauz', 'hooks', 'registry.json'), '{');
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /registry-corrupt/);
        }
    });
});

suite('hookBus: registration (the contract laws)', () => {
    // T13
    test('registerHook stamps scope/contractVersion/registeredAtIso and returns a contract-valid descriptor', async () => {
        const ctx = await freshBind();
        const descriptor = ctx.runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 10));
        assert.deepEqual(descriptor.scope, TEST_SCOPE);
        assert.equal(descriptor.contractVersion, RegistrationContract.HOOK_BUS_CONTRACTS_VERSION);
        assert.equal(descriptor.registeredAtIso, epochMsToIsoUtc(1_001_000));
        assert.ok(RegistrationContract.isHookDescriptor(descriptor));
    });

    // T14
    test('registration persists to .flauz/hooks/registry.json in registration order as a contract-valid registry', async () => {
        const ctx = await freshBind();
        registerFixtureHooks(ctx.runtime);
        const parsed = JSON.parse(readFileSync(join(ctx.root, '.flauz', 'hooks', 'registry.json'), 'utf-8')) as { $schema: string; registry: unknown };
        assert.equal(parsed.$schema, 'flauz.hook-bus.registry/v1');
        assert.ok(RegistrationContract.isHookRegistry(parsed.registry));
        assert.deepEqual(
            (parsed.registry as RegistrationContract.HookRegistry).hooks.map((hook) => hook.hookId),
            ['hook-A', 'hook-B', 'hook-C', 'hook-D', 'hook-E', 'hook-G'],
        );
    });

    // T15
    test('registration survives restart; the persisted scope is authoritative; a mismatched scope refuses', async () => {
        const ctx = await freshBind();
        ctx.runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 10));
        ctx.runtime.registerHook(hookInput('hook-B', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
        const second = await loadHookBus(ctx.root, { clock: makeClock().now });
        if (!second.bound) {
            assert.fail(second.detail);
        }
        assert.deepEqual(second.runtime.scope, TEST_SCOPE);
        assert.deepEqual(second.runtime.registry().hooks.map((hook) => hook.hookId), ['hook-A', 'hook-B']);
        assert.deepEqual(
            second.runtime.registry().hooks.map((hook) => [hook.kind, hook.effectKind, hook.priority, hook.enabled, hook.flagged]),
            [['approval', 'context-enrichment', 10, true, false], ['approval', 'context-enrichment', 5, true, false]],
        );
        second.runtime.registerHook(hookInput('hook-C', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
        const third = await loadHookBus(ctx.root, { clock: makeClock().now });
        if (!third.bound) {
            assert.fail(third.detail);
        }
        assert.deepEqual(third.runtime.registry().hooks.map((hook) => hook.hookId), ['hook-A', 'hook-B', 'hook-C']);
        const mismatch = await bindHookBus(ctx.root, { clock: makeClock().now, scope: { workspaceId: 'other-workspace', tenantId: 'other-tenant' } });
        assert.equal(mismatch.bound, false);
        if (!mismatch.bound) {
            assert.match(mismatch.detail, /registry-scope-mismatch/);
        }
    });

    // T16
    test('a duplicate hook id refuses with the frozen violation name', async () => {
        const ctx = await freshBind();
        ctx.runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 10));
        assert.throws(
            () => ctx.runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5)),
            (err: unknown): boolean => {
                assert.ok(err instanceof HookBusError);
                const hookBusError = err as HookBusError;
                assert.equal(hookBusError.code, 'registration-refused');
                assert.deepEqual(hookBusError.violations, ['duplicate-hook-id']);
                return true;
            },
        );
    });

    // T17
    test('an unknown kind refuses with the frozen violation names', async () => {
        const ctx = await freshBind();
        assert.throws(
            () => ctx.runtime.registerHook({
                hookId: 'hook-X',
                kind: 'approval-ish' as unknown as RegistrationContract.HookKind,
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['approval-ish'] as unknown as readonly RegistrationContract.HookKind[], events: ['approval.resolved'] },
                priority: 1,
                enabled: true,
            }),
            (err: unknown): boolean => {
                assert.ok(err instanceof HookBusError);
                const hookBusError = err as HookBusError;
                assert.equal(hookBusError.code, 'registration-refused');
                assert.deepEqual(hookBusError.violations, ['invalid-hook-kind', 'invalid-match-spec']);
                for (const violation of hookBusError.violations ?? []) {
                    assert.ok((RegistrationContract.REGISTRATION_VIOLATIONS as readonly string[]).includes(violation), `${violation} must be a frozen REGISTRATION_VIOLATIONS name`);
                }
                return true;
            },
        );
    });

    // T18
    test('a match spec the kind cannot cover refuses with invalid-match-spec', async () => {
        const ctx = await freshBind();
        assert.throws(
            () => ctx.runtime.registerHook({ hookId: 'hook-X', kind: 'approval', effectKind: 'context-enrichment', matchSpec: { kinds: ['approval'], events: ['prompt.submitted'] }, priority: 1, enabled: true }),
            (err: unknown): boolean => {
                assert.ok(err instanceof HookBusError);
                const hookBusError = err as HookBusError;
                assert.equal(hookBusError.code, 'registration-refused');
                assert.deepEqual(hookBusError.violations, ['invalid-match-spec']);
                return true;
            },
        );
    });

    // T19
    test('a legal effect kind off the kind\'s lane refuses with illegal-effect', async () => {
        const ctx = await freshBind();
        assert.throws(
            () => ctx.runtime.registerHook({ hookId: 'hook-X', kind: 'session', effectKind: 'approval-request', matchSpec: { kinds: ['session'], events: ['session.opened'] }, priority: 1, enabled: true }),
            (err: unknown): boolean => {
                assert.ok(err instanceof HookBusError);
                const hookBusError = err as HookBusError;
                assert.equal(hookBusError.code, 'registration-refused');
                assert.deepEqual(hookBusError.violations, ['illegal-effect']);
                return true;
            },
        );
    });

    // T20
    test('an empty hook id refuses with invalid-descriptor', async () => {
        const ctx = await freshBind();
        assert.throws(
            () => ctx.runtime.registerHook(hookInput('', 'approval', 'context-enrichment', APPROVAL_EVENTS, 1)),
            (err: unknown): boolean => {
                assert.ok(err instanceof HookBusError);
                const hookBusError = err as HookBusError;
                assert.equal(hookBusError.code, 'registration-refused');
                assert.deepEqual(hookBusError.violations, ['invalid-descriptor']);
                return true;
            },
        );
    });

    // T21
    test('every dangerous effect kind refuses with the verbatim policy statements', async () => {
        const ctx = await freshBind();
        const poisonByInvariant: ReadonlyArray<readonly [readonly string[], PolicyContract.HookPolicyInvariant]> = [
            [PolicyContract.PERMISSION_GRANT_EFFECT_KINDS, 'no-permission-grant'],
            [PolicyContract.POLICY_OVERRIDE_EFFECT_KINDS, 'no-policy-override'],
            [PolicyContract.LEASE_BYPASS_EFFECT_KINDS, 'no-lease-bypass'],
            [PolicyContract.AUTO_APPROVAL_EFFECT_KINDS, 'no-auto-approval'],
        ];
        for (const [poisonKinds, invariant] of poisonByInvariant) {
            for (const effectKind of poisonKinds) {
                assert.throws(
                    () => ctx.runtime.registerHook(hookInput('hook-poison', 'approval', effectKind, APPROVAL_EVENTS, 1)),
                    (err: unknown): boolean => {
                        assert.ok(err instanceof HookBusError, `${effectKind} must refuse with HookBusError`);
                        const hookBusError = err as HookBusError;
                        assert.equal(hookBusError.code, 'registration-refused');
                        assert.ok(hookBusError.violations?.includes(invariant) === true, `${effectKind} must violate ${invariant}`);
                        assert.ok(hookBusError.policyStatements?.includes(PolicyContract.HOOK_POLICY[invariant]) === true, `${effectKind} must quote HOOK_POLICY['${invariant}'] verbatim`);
                        return true;
                    },
                );
            }
        }
    });
});

suite('hookBus: the flagged-hook load law (dangerous effects on disk)', () => {
    // T22
    test('a hand-edited registry carrying a poison-effect hook binds and flags it, and the id cannot be re-registered', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-flag-'));
        writePoisonRegistry(root);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        if (!verdict.bound) {
            assert.fail(verdict.detail);
        }
        const registryView = verdict.runtime.registry();
        assert.deepEqual(registryView.flaggedHookIds, ['hook-P']);
        assert.equal(registryView.hooks[0].flagged, true);
        assert.equal(registryView.hooks[0].effectKind, 'policy-override');
        assert.throws(
            () => verdict.runtime.registerHook(hookInput('hook-P', 'approval', 'context-enrichment', APPROVAL_EVENTS, 1)),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'registration-refused' && err.violations?.includes('duplicate-hook-id') === true,
        );
    });

    // T23
    test('a hand-edited registry with an off-lane legal effect refuses to bind (the lane law is re-enforced over hand edits)', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-lane-'));
        writeRegistryEnvelope(root, [{
            scope: TEST_SCOPE,
            contractVersion: '1.0.0',
            hookId: 'hook-L',
            kind: 'session',
            effectKind: 'approval-request',
            matchSpec: { kinds: ['session'], events: ['session.opened'] },
            priority: 1,
            enabled: true,
            registeredAtIso: '2025-01-01T00:00:00Z',
        }]);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /registry-corrupt/);
        }
    });

    // T24
    test('a hand-edited registry with a structurally broken hook refuses to bind', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-broken-'));
        writeRegistryEnvelope(root, [{ nope: true }]);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /registry-corrupt/);
        }
    });

    // T25
    test('a duplicate id inside a hand-edited registry refuses to bind', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-dup-'));
        const hook = {
            scope: TEST_SCOPE,
            contractVersion: '1.0.0',
            hookId: 'hook-A',
            kind: 'approval',
            effectKind: 'context-enrichment',
            matchSpec: { kinds: ['approval'], events: ['approval.resolved'] },
            priority: 1,
            enabled: true,
            registeredAtIso: '2025-01-01T00:00:00Z',
        };
        writeRegistryEnvelope(root, [hook, { ...hook }]);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        assert.equal(verdict.bound, false);
        if (!verdict.bound) {
            assert.match(verdict.detail, /registry-corrupt/);
        }
    });
});

suite('hookBus: the honest digest mapping', () => {
    // T26
    test('the gated happy path translates exactly the four store-sourced eventRefs in global-seq order', async () => {
        const { report } = await runHappyPath();
        // approval-requested is seq 3 (ts 1_005_000), approval-granted seq 4
        // (ts 1_006_000), graph-completed seq 7 (ts 1_009_000).
        assert.deepEqual(report.eventRefs, [
            { kind: 'approval', eventDigest: 'approval.requested', occurredAtIso: epochMsToIsoUtc(1_005_000) },
            { kind: 'approval', eventDigest: 'task.awaiting-approval', occurredAtIso: epochMsToIsoUtc(1_005_000) },
            { kind: 'approval', eventDigest: 'approval.resolved', occurredAtIso: epochMsToIsoUtc(1_006_000) },
            { kind: 'finalization', eventDigest: 'finalization.recorded', occurredAtIso: epochMsToIsoUtc(1_009_000) },
        ]);
        // One literal anchor pin (the pure-arithmetic ISO conversion): 1005 s
        // after the epoch is 1970-01-01T00:16:45Z.
        assert.equal(report.eventRefs[0].occurredAtIso, '1970-01-01T00:16:45Z');
        // The M1 dual ref: both refs come from the SAME approval-requested row.
        assert.equal(report.eventRefs[0].occurredAtIso, report.eventRefs[1].occurredAtIso);
        assert.equal(report.journalSeqObserved, 7);
    });

    // T27
    test('the unmapped census counts every other observed row type', async () => {
        const { report } = await runHappyPath();
        assert.deepEqual(report.unmappedRowTypes, { 'graph-submitted': 1, 'graph-approved': 1, 'step-started': 1, 'step-succeeded': 1 });
        for (const rowType of Object.keys(report.unmappedRowTypes)) {
            assert.equal(JOURNAL_ROW_EVENT_REF_MAPPING[rowType], undefined, `${rowType} must not be a mapped row type`);
        }
    });

    // T28
    test('approval-denied maps to approval.resolved (the denial path)', async () => {
        const ctx = await freshBind();
        await seedDenialPath(seedStore(ctx));
        registerFixtureHooks(ctx.runtime);
        const report = ctx.runtime.dispatch();
        assert.deepEqual(report.eventRefs.map((ref) => ref.eventDigest), ['approval.requested', 'task.awaiting-approval', 'approval.resolved']);
        assert.deepEqual(report.unmappedRowTypes, { 'graph-submitted': 1, 'graph-approved': 1, 'graph-failed': 1 });
        assert.equal(report.receipts.length, 10);
    });

    // T29
    test('approval-expired maps to approval.resolved (the expiry path)', async () => {
        const ctx = await freshBind();
        await seedExpiryPath(seedStore(ctx));
        registerFixtureHooks(ctx.runtime);
        const report = ctx.runtime.dispatch();
        assert.deepEqual(report.eventRefs.map((ref) => ref.eventDigest), ['approval.requested', 'task.awaiting-approval', 'approval.resolved']);
        assert.deepEqual(report.unmappedRowTypes, { 'graph-submitted': 1, 'graph-approved': 1 });
        assert.equal(report.receipts.length, 10);
    });

    // T30
    test('no a2a message kind ever maps: all four kinds are censused, zero eventRefs', async () => {
        const ctx = await freshBind();
        postAllFourKinds(seedBus(ctx));
        const report = ctx.runtime.dispatch();
        assert.deepEqual(report.unmappedMessageKinds, { 'task-delegation': 1, 'result-report': 1, 'steering-relay': 1, 'resource-claim': 1 });
        assert.equal(report.eventRefs.length, 0);
        assert.equal(report.plans.length, 0);
        assert.equal(report.receipts.length, 0);
        assert.deepEqual(report.unmappedRowTypes, {});
        assert.equal(report.a2aSeqObserved, 4);
        for (const kind of Object.keys(report.unmappedMessageKinds)) {
            assert.ok(ctx.vocabulary.messageKinds.includes(kind), `${kind} must be an authority MESSAGE_KIND`);
        }
    });

    // T31
    test('the store-sourced digest set is exactly 4 and the honest gap is exactly 7', () => {
        const storeSourced = [...new Set(Object.values(JOURNAL_ROW_EVENT_REF_MAPPING).flat().map((spec) => spec.eventDigest))].sort();
        assert.deepEqual(storeSourced, ['approval.requested', 'approval.resolved', 'finalization.recorded', 'task.awaiting-approval']);
        const gap = DispatchContract.AUTHORITY_EVENT_DIGEST.filter((digest) => !storeSourced.includes(digest));
        assert.deepEqual(gap, ['session.opened', 'session.closed', 'prompt.submitted', 'tool.invoked', 'post-tool.observed', 'task.awaiting-signoff', 'finalization.requested']);
        assert.deepEqual(Object.keys(JOURNAL_ROW_EVENT_REF_MAPPING).sort(), ['approval-denied', 'approval-expired', 'approval-granted', 'approval-requested', 'graph-completed']);
        for (const specs of Object.values(JOURNAL_ROW_EVENT_REF_MAPPING)) {
            for (const spec of specs) {
                assert.ok(DispatchContract.isHookKind(spec.kind));
                assert.ok(DispatchContract.isAuthorityEventDigest(spec.eventDigest));
                assert.ok(DispatchContract.kindCoversEventDigest(spec.kind, spec.eventDigest));
            }
        }
    });
});

suite('hookBus: compose through the contract', () => {
    // T32
    test('the plan orders are pinned against the hand-computed contract order', async () => {
        const { report } = await runHappyPath();
        assert.deepEqual(report.plans[0].orderedHookIds, ['hook-B', 'hook-G', 'hook-A']);
        assert.deepEqual(report.plans[1].orderedHookIds, ['hook-B', 'hook-G', 'hook-A']);
        assert.deepEqual(report.plans[2].orderedHookIds, ['hook-E', 'hook-B', 'hook-G', 'hook-A']);
        assert.deepEqual(report.plans[3].orderedHookIds, ['hook-E', 'hook-D']);
    });

    // T33
    test('every composed plan is contract-valid and stamps composedAtIso from the event', async () => {
        const { report } = await runHappyPath();
        for (const plan of report.plans) {
            assert.ok(DispatchContract.isHookDispatchPlan(plan));
            assert.equal(plan.composedAtIso, plan.eventRef.occurredAtIso);
            assert.equal(plan.contractVersion, DispatchContract.HOOK_BUS_CONTRACTS_VERSION);
            assert.ok(DispatchContract.hookScopesEqual(plan.scope, TEST_SCOPE));
        }
    });

    // T34
    test('the contract\'s own fail-closed law: an invalid eventRef composes an empty plan (direct pin)', () => {
        const dispatchable: DispatchContract.DispatchableHook = { hookId: 'hook-A', kind: 'approval', matchSpec: { kinds: ['approval'], events: ['approval.resolved'] }, priority: 1, enabled: true };
        const registry: DispatchContract.HookRegistry = { scope: TEST_SCOPE, contractVersion: DispatchContract.HOOK_BUS_CONTRACTS_VERSION, hooks: [dispatchable] };
        const invalidRef = { kind: 'approval', eventDigest: 'prompt.submitted', occurredAtIso: '1970-01-01T00:00:00Z' };
        assert.deepEqual(DispatchContract.composeDispatchPlan(registry, invalidRef).orderedHookIds, []);
    });

    // T35
    test('the contract composes stably: double composition is plan-equal (direct pin)', () => {
        const dispatchable: DispatchContract.DispatchableHook = { hookId: 'hook-A', kind: 'approval', matchSpec: { kinds: ['approval'], events: ['approval.resolved'] }, priority: 1, enabled: true };
        const registry: DispatchContract.HookRegistry = { scope: TEST_SCOPE, contractVersion: DispatchContract.HOOK_BUS_CONTRACTS_VERSION, hooks: [dispatchable] };
        const goodRef = { kind: 'approval', eventDigest: 'approval.resolved', occurredAtIso: '1970-01-01T00:00:00Z' };
        const first = DispatchContract.composeDispatchPlan(registry, goodRef);
        const second = DispatchContract.composeDispatchPlan(registry, goodRef);
        assert.ok(DispatchContract.dispatchPlansEqual(first, second));
        assert.deepEqual(first.orderedHookIds, ['hook-A']);
    });

    // T36
    test('with no hooks registered, plans compose empty orders and no receipts are written', async () => {
        const ctx = await freshBind();
        await seedGatedHappyPath(seedStore(ctx));
        const report = ctx.runtime.dispatch();
        assert.equal(report.eventRefs.length, 4);
        assert.ok(report.plans.every((plan) => plan.orderedHookIds.length === 0));
        assert.equal(report.receipts.length, 0);
        assert.equal(existsSync(join(ctx.root, '.flauz', 'hooks', 'journal.jsonl')), false);
        assert.equal(report.journalSeqObserved, 7);
    });
});

suite('hookBus: delivery receipts', () => {
    // T37
    test('receipts append in plan order with the pinned 12-receipt hook sequence', async () => {
        const { report } = await runHappyPath();
        assert.deepEqual(
            report.receipts.map((receipt) => receipt.hookId),
            ['hook-B', 'hook-G', 'hook-A', 'hook-B', 'hook-G', 'hook-A', 'hook-E', 'hook-B', 'hook-G', 'hook-A', 'hook-E', 'hook-D'],
        );
        assert.ok(report.receipts.every((receipt) => receipt.status === 'delivered'));
        // Provenance: the dual ref shares its source row; later events carry theirs.
        assert.equal(report.receipts[0].sourceRowSeq, 3);
        assert.equal(report.receipts[3].sourceRowSeq, 3);
        assert.equal(report.receipts[6].sourceRowSeq, 4);
        assert.equal(report.receipts[10].sourceRowSeq, 7);
    });

    // T38
    test('every receipt is a durable canonical line in the receipts journal', async () => {
        const { ctx, report } = await runHappyPath();
        const content = readFileSync(join(ctx.root, '.flauz', 'hooks', 'journal.jsonl'), 'utf-8');
        const lines = content.split('\n').filter((line) => line.length > 0);
        assert.equal(lines.length, 12);
        for (const line of lines) {
            assert.ok(line.startsWith('{"$schema":"flauz.hook-bus.receipt/v1",'), 'receipts must be canonical sorted-key lines');
        }
        assert.deepEqual(lines.map((line) => JSON.parse(line)), [...report.receipts]);
    });

    // T39
    test('deliveredAtIso comes from the injected clock, one read per receipt, all distinct', async () => {
        const { report } = await runHappyPath();
        // 9 seed ticks + 6 registration ticks precede the 12 delivery ticks:
        // the first receipt reads tick 16 -> 1016 s -> 00:16:56Z; the last
        // reads tick 27 -> 1027 s -> 00:17:07Z.
        assert.equal(report.receipts[0].deliveredAtIso, '1970-01-01T00:16:56Z');
        assert.equal(report.receipts[11].deliveredAtIso, '1970-01-01T00:17:07Z');
        for (let index = 1; index < report.receipts.length; index += 1) {
            assert.ok(report.receipts[index].deliveredAtIso > report.receipts[index - 1].deliveredAtIso);
        }
    });

    // T40
    test('a flagged hook receives flagged-for-approval receipts with verbatim policy statements; innocent hooks in the same plan still deliver', async () => {
        const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-flag-'));
        writePoisonRegistry(root);
        const verdict = await bindHookBus(root, { clock: makeClock().now, scope: TEST_SCOPE });
        if (!verdict.bound) {
            assert.fail(verdict.detail);
        }
        verdict.runtime.registerHook(hookInput('hook-B', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
        await seedApprovalResolved(seedStore(verdict));
        const report = verdict.runtime.dispatch();
        assert.equal(report.receipts.length, 4);
        assert.deepEqual(report.plans[2].orderedHookIds, ['hook-P', 'hook-B']);
        const flagged = report.receipts.filter((receipt) => receipt.hookId === 'hook-P');
        assert.equal(flagged.length, 1);
        assert.equal(flagged[0].status, 'flagged-for-approval');
        assert.ok(flagged[0].violatedInvariants?.includes('no-policy-override'));
        assert.ok(flagged[0].policyStatements?.includes(PolicyContract.HOOK_POLICY['no-policy-override']));
        for (const receipt of report.receipts.filter((receipt) => receipt.hookId === 'hook-B')) {
            assert.equal(receipt.status, 'delivered');
        }
        // Defense-in-depth: the plan policy verdict records the violation.
        assert.equal(report.planPolicyVerdicts[2].ok, false);
        assert.ok(report.planPolicyVerdicts[2].violations.includes('no-policy-override'));
    });

    // T41
    test('planPolicyVerdicts are recorded per plan (all-clean plans are ok)', async () => {
        const { report } = await runHappyPath();
        assert.equal(report.planPolicyVerdicts.length, report.plans.length);
        assert.ok(report.planPolicyVerdicts.every((verdict) => verdict.ok));
    });
});

suite('hookBus: durable cursors + idempotence', () => {
    // T42
    test('the double run is byte-equal and empty (idempotence)', async () => {
        const { ctx, report } = await runHappyPath();
        assert.equal(report.receipts.length, 12);
        const journalBytes = readFileSync(join(ctx.root, '.flauz', 'hooks', 'journal.jsonl'));
        const cursorBytes = readFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json'));
        const second = ctx.runtime.dispatch();
        assert.equal(second.eventRefs.length, 0);
        assert.equal(second.plans.length, 0);
        assert.equal(second.receipts.length, 0);
        assert.deepEqual(second.unmappedRowTypes, {});
        assert.deepEqual(second.unmappedMessageKinds, {});
        assert.equal(second.journalSeqObserved, 7);
        assert.ok(readFileSync(join(ctx.root, '.flauz', 'hooks', 'journal.jsonl')).equals(journalBytes));
        assert.ok(readFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json')).equals(cursorBytes));
    });

    // T43
    test('a fresh runtime resumes without re-dispatching consumed rows', async () => {
        const { ctx } = await runHappyPath();
        // New authority traffic: G-002 submit -> approve -> approval request.
        const store = seedStore(ctx);
        const submitted = await store.submitGraph({ title: 'hook-bus second run', steps: [PLAIN_STEP], actor: 'human', origin: ORIGIN });
        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: ORIGIN });
        await store.approvalRequest({ graphId: submitted.graphId, stepId: 'S-01', reason: 'the plain gate', actor: 'agent', origin: ORIGIN });
        const resumed = await loadHookBus(ctx.root, { clock: makeClock().now });
        if (!resumed.bound) {
            assert.fail(resumed.detail);
        }
        const report = resumed.runtime.dispatch();
        assert.deepEqual(report.eventRefs.map((ref) => ref.eventDigest), ['approval.requested', 'task.awaiting-approval']);
        assert.deepEqual(
            report.receipts.map((receipt) => receipt.hookId),
            ['hook-B', 'hook-G', 'hook-A', 'hook-B', 'hook-G', 'hook-A'],
        );
        assert.deepEqual(report.unmappedRowTypes, { 'graph-submitted': 1, 'graph-approved': 1 });
        assert.equal(report.journalSeqObserved, 10);
        const cursors = JSON.parse(readFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json'), 'utf-8')) as { journalSeq: number; a2aSeq: number };
        assert.equal(cursors.journalSeq, 10);
    });

    // T44
    test('cursors.json carries the observed high-water marks in the runtime envelope', async () => {
        const { ctx } = await runHappyPath();
        const cursors = JSON.parse(readFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json'), 'utf-8'));
        assert.deepEqual(cursors, { $schema: 'flauz.hook-bus.cursors/v1', journalSeq: 7, a2aSeq: 0 });
    });

    // T45
    test('the a2a cursor advances independently of the journal cursor', async () => {
        const ctx = await freshBind();
        registerFixtureHooks(ctx.runtime);
        await seedGatedHappyPath(seedStore(ctx));
        ctx.runtime.dispatch();
        postAllFourKinds(seedBus(ctx));
        const report = ctx.runtime.dispatch();
        assert.equal(report.eventRefs.length, 0);
        assert.equal(report.receipts.length, 0);
        assert.deepEqual(report.unmappedRowTypes, {});
        assert.deepEqual(report.unmappedMessageKinds, { 'task-delegation': 1, 'result-report': 1, 'steering-relay': 1, 'resource-claim': 1 });
        assert.equal(report.a2aSeqObserved, 4);
        const cursors = JSON.parse(readFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json'), 'utf-8')) as { journalSeq: number; a2aSeq: number };
        assert.deepEqual(cursors, { $schema: 'flauz.hook-bus.cursors/v1', journalSeq: 7, a2aSeq: 4 }); /* station seam-fix: the cursors artifact carries the runtime envelope $schema marker (the sibling test above pins it) — the expectation omitted it */
    });
});

suite('hookBus: determinism', () => {
    // T46
    test('the pure ISO anchors (epoch, day, leap day, decade, time-of-day)', () => {
        assert.equal(epochMsToIsoUtc(0), '1970-01-01T00:00:00Z');
        assert.equal(epochMsToIsoUtc(86_400_000), '1970-01-02T00:00:00Z');
        assert.equal(epochMsToIsoUtc(951_782_400_000), '2000-02-29T00:00:00Z');
        assert.equal(epochMsToIsoUtc(1_583_020_800_000), '2020-03-01T00:00:00Z');
        assert.equal(epochMsToIsoUtc(1_005_000), '1970-01-01T00:16:45Z');
        for (const anchor of [0, 86_400_000, 951_782_400_000, 1_583_020_800_000, 1_005_000]) {
            assert.ok(DispatchContract.isIsoTimestamp(epochMsToIsoUtc(anchor)));
        }
    });

    // T47
    test('two identically-driven roots produce byte-identical artifacts', async () => {
        const artifacts: string[][] = [];
        for (let run = 0; run < 2; run += 1) {
            const root = await mkdtemp(join(tmpdir(), 'flauz-hook-bus-det-'));
            const clock = makeClock();
            const verdict = await bindHookBus(root, { clock: clock.now, scope: TEST_SCOPE });
            if (!verdict.bound) {
                assert.fail(verdict.detail);
            }
            await seedGatedHappyPath(seedStore(verdict));
            registerFixtureHooks(verdict.runtime);
            verdict.runtime.dispatch();
            artifacts.push(['registry.json', 'journal.jsonl', 'cursors.json'].map((name) => readFileSync(join(root, '.flauz', 'hooks', name), 'utf-8')));
        }
        for (let index = 0; index < 3; index += 1) {
            assert.equal(artifacts[0][index], artifacts[1][index]);
        }
    });

    // T48
    test('dispatch consumes exactly one injected clock read per receipt (27 reads for the happy path)', async () => {
        const { ctx, report } = await runHappyPath();
        assert.equal(report.receipts.length, 12);
        // 9 seed ticks (submitGraph consumes 3: createdAt + row ts + the
        // mirror-event ts argument; then one per remaining op) + 6
        // registration ticks + 12 delivery ticks; the bind consumes none.
        assert.equal(ctx.clock.calls(), 27);
        assert.equal(ctx.clock.current(), 1_027_000);
    });
});

suite('hookBus: fail typed', () => {
    // T49
    test('HookBusError carries a code, a name, a message and the law details', () => {
        const error = new HookBusError('registration-refused', 'nope', { violations: ['duplicate-hook-id'], policyStatements: ['a law'] });
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'HookBusError');
        assert.equal(error.code, 'registration-refused');
        assert.equal(error.message, 'nope');
        assert.deepEqual(error.violations, ['duplicate-hook-id']);
        assert.deepEqual(error.policyStatements, ['a law']);
    });

    // T50
    test('dispatch over a journal corrupted after bind throws seam-error', async () => {
        const ctx = await freshBind();
        await seedGatedHappyPath(seedStore(ctx));
        appendFileSync(join(ctx.root, '.flauz', 'orchestration', 'journal.jsonl'), 'not-json\n{}\n');
        assert.throws(
            () => ctx.runtime.dispatch(),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'seam-error',
        );
    });

    // T51
    test('dispatch over a registry corrupted after bind throws registry-corrupt', async () => {
        const ctx = await freshBind();
        registerFixtureHooks(ctx.runtime);
        writeFileSync(join(ctx.root, '.flauz', 'hooks', 'registry.json'), '{');
        assert.throws(
            () => ctx.runtime.dispatch(),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'registry-corrupt',
        );
    });

    // T52
    test('dispatch over corrupted cursors throws cursor-corrupt', async () => {
        const ctx = await freshBind();
        ctx.runtime.dispatch();
        writeFileSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json'), 'nope');
        assert.throws(
            () => ctx.runtime.dispatch(),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'cursor-corrupt',
        );
    });

    // T53
    test('registerHook over an unwritable registry path throws registry-write-failed', async () => {
        const ctx = await freshBind();
        // Block the .flauz path with a regular file: the registry read sees
        // no registry (fresh, scope stamped), but the registry write cannot
        // create .flauz/hooks.
        writeFileSync(join(ctx.root, '.flauz'), 'not a directory');
        assert.throws(
            () => ctx.runtime.registerHook(hookInput('hook-A', 'approval', 'context-enrichment', APPROVAL_EVENTS, 1)),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'registry-write-failed',
        );
    });

    // T54
    test('a failed receipts append throws receipt-journal-write-failed and leaves the cursors untouched (at-least-once)', async () => {
        const ctx = await freshBind();
        ctx.runtime.registerHook(hookInput('hook-B', 'approval', 'context-enrichment', APPROVAL_EVENTS, 5));
        await seedApprovalResolved(seedStore(ctx));
        mkdirSync(join(ctx.root, '.flauz', 'hooks', 'journal.jsonl'));
        assert.throws(
            () => ctx.runtime.dispatch(),
            (err: unknown): boolean => err instanceof HookBusError && err.code === 'receipt-journal-write-failed',
        );
        assert.equal(existsSync(join(ctx.root, '.flauz', 'hooks', 'cursors.json')), false);
    });
});