/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-002 -- the background-agent runtime suite (mocha tdd).
 *
 * Coverage: the real-seam bind (typeness + vocabulary resolution),
 * launch (graph + delegation thread), inspect (journal tail),
 * message (A2A delivery + threading), control (enforced cancel vs
 * advisory pause/resume), outcome (terminal derivation + bounded
 * wait), roster (bus list + journal-derived run counts), and the
 * runtime lifecycle. The seams are REAL: every test drives actual
 * OrchestrationStore/A2ABus instances over mkdtemp roots; the agent
 * side is driven through the store's own startStep/finishStep.
 * Determinism: an injected clock drives the store and every posted
 * ts (the two outcome-wait tests use real timers and assert no
 * bytes). No Date.now, no Math.random.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BgAgentError, createBgAgentRuntime, loadBgAgentRuntime } from './bgAgent.mjs';
import type { BgAgentBusView } from './bgAgent.mjs';

type Seams = Extract<Awaited<ReturnType<typeof loadBgAgentRuntime>>, { bound: true }>;

function makeClock(start = 1_000_000) {
        let t = start;
        return { now: () => ++t, tick: (ms = 1) => (t += ms) };
}

async function freshRuntime(): Promise<Seams & { root: string; clock: ReturnType<typeof makeClock> }> {
        const root = await mkdtemp(join(tmpdir(), 'flauz-bg-agent-'));
        const clock = makeClock();
        const loaded = await loadBgAgentRuntime({ root, now: clock.now });
        if (!loaded.bound) {
                assert.fail(loaded.detail);
        }
        return { root, clock, ...loaded };
}

function peek(seams: { bus: BgAgentBusView }, agentId: string): Array<Record<string, unknown>> {
        return seams.bus.collect({ agentId, consume: false }).messages;
}

/** The agent side, driven through the REAL store API. */
async function agentCompletes(
        seams: Seams,
        runId: string,
        outcome: 'succeeded' | 'failed',
        extra: Record<string, unknown> = {},
): Promise<void> {
        // The store's law: step transitions (step-started from ready) require
        // an agent-side actor (agent | tool | service) — the human actor owns
        // graph-level submit/approve, never step execution.
        const agentActor = seams.vocabulary.orchActors.includes('agent')
                ? 'agent'
                : (seams.vocabulary.orchActors.find((a) => a !== seams.vocabulary.actor) ?? 'agent');
        const started = await seams.store.startStep({
                graphId: runId,
                stepId: 'S-01',
                runnerId: 'agent-alpha',
                actor: agentActor,
                origin: 'agent-side',
        });
        await seams.store.finishStep({
                graphId: runId,
                stepId: 'S-01',
                attempt: started.attempt,
                outcome,
                ...extra,
                origin: 'agent-side',
        });
}

suite('bgAgent: seam binding over the real seams', () => {
        // T01
        test('loadBgAgentRuntime binds the real store and bus over a fresh root', async () => {
                const ctx = await freshRuntime();
                assert.equal(typeof ctx.store.submitGraph, 'function');
                assert.equal(typeof ctx.store.stateOf, 'function');
                assert.equal(typeof ctx.bus.post, 'function');
                assert.equal(typeof ctx.bus.list, 'function');
        });

        // T02
        test('the launch kind resolves from the module\'s frozen MESSAGE_KINDS', async () => {
                const ctx = await freshRuntime();
                assert.ok(ctx.vocabulary.messageKinds.length === 0 || ctx.vocabulary.messageKinds.includes(ctx.vocabulary.kind));
        });

        // T03
        test('the actor resolves from the module\'s frozen ORCH_ACTORS', async () => {
                const ctx = await freshRuntime();
                assert.ok(ctx.vocabulary.orchActors.length === 0 || ctx.vocabulary.orchActors.includes(ctx.vocabulary.actor));
        });

        // T04
        test('the runtime identity passes the module\'s isAgentId when exported', async () => {
                const ctx = await freshRuntime();
                if (ctx.vocabulary.validateAgentId !== null) {
                        assert.equal(ctx.vocabulary.validateAgentId(ctx.vocabulary.from), true);
                } else {
                        assert.equal(ctx.vocabulary.fromValidated, false);
                }
        });
});

suite('bgAgent: launch', () => {
        // T05
        test('launch returns the graphId as runId with the agent and a status', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                assert.equal(launched.agentId, 'agent-alpha');
                assert.ok(typeof launched.runId === 'string' && launched.runId.length > 0);
                assert.ok(typeof launched.status === 'string' && launched.status.length > 0);
        });

        // T06
        test('launch creates exactly one durable graph', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const graphs = ctx.store.listGraphs() as Array<{ graphId: string }>;
                assert.equal(graphs.length, 1);
                assert.equal(graphs[0].graphId, launched.runId);
        });

        // T07
        test('launch journals the submit and approve rows with ascending seqs', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const rows = ctx.store.rowsFor(launched.runId) as Array<{ seq: number; type: string }>;
                assert.ok(rows.length >= 2);
                for (let i = 1; i < rows.length; i++) {
                        assert.ok(rows[i].seq > rows[i - 1].seq);
                }
                assert.ok(rows.every((row) => typeof row.type === 'string' && row.type.length > 0));
        });

        // T08
        test('launch posts one message to the agent inbox', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const messages = peek(ctx, 'agent-alpha');
                assert.equal(messages.length, 1);
                const message = messages[0] as { to: string; from: string; kind: string; payload: { taskId: string; taskDescription: string; prompt: string } };
                assert.equal(message.to, 'agent-alpha');
                assert.equal(message.from, ctx.vocabulary.from);
                // The a2a task-delegation contract shape: exactly taskId /
                // taskDescription / prompt (the graph linkage rides the strings).
                assert.match(message.payload.taskId, /^T-\d{3,}$/);
                assert.ok(message.payload.taskDescription.includes(launched.runId));
                const prompt = JSON.parse(message.payload.prompt) as { graphId: string };
                assert.equal(prompt.graphId, launched.runId);
        });

        // T09
        test('the posted message kind is a module-declared kind', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const message = peek(ctx, 'agent-alpha')[0] as { kind: string };
                assert.ok(ctx.vocabulary.messageKinds.length === 0 || ctx.vocabulary.messageKinds.includes(message.kind));
        });

        // T10
        test('launch persists the label as the graph title', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha', label: 'deep-dive' });
                const graphs = ctx.store.listGraphs() as Array<{ title: string }>;
                assert.equal(graphs[0].title, 'deep-dive');
        });

        // T11
        test('launch rejects a spec without agentId', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.launch({} as never),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_SPEC',
                );
        });

        // T12
        test('launch rejects a non-object input', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.launch({ agentId: 'agent-alpha', input: 'nope' } as never),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_SPEC',
                );
        });

        // T13
        test('two launches mint distinct runIds', async () => {
                const ctx = await freshRuntime();
                const a = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const b = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                assert.notEqual(a.runId, b.runId);
                assert.equal((ctx.store.listGraphs() as unknown[]).length, 2);
        });

        // T14
        test('launch routes the step to the launched agent only', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const graphs = ctx.store.listGraphs() as Array<{ graphId: string }>;
                const state = ctx.store.stateOf(graphs[0].graphId) as {
                        spec?: { steps?: Array<{ routing?: { allowedAgents?: string[] } }> };
                };
                assert.deepEqual(state.spec?.steps?.[0]?.routing?.allowedAgents, ['agent-alpha']);
        });
});

suite('bgAgent: inspect', () => {
        // T15
        test('inspect returns the journal tail as events', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const snap = await ctx.runtime.inspect(launched.runId);
                assert.equal(snap.runId, launched.runId);
                assert.ok(snap.events.length >= 2);
                assert.ok(snap.events.every((event) => typeof event.kind === 'string' && event.kind.length > 0));
                assert.equal(snap.agentId, 'agent-alpha');
        });

        // T16
        test('inspect bounds the tail by eventLimit', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await agentCompletes(ctx, launched.runId, 'succeeded');
                const snap = await ctx.runtime.inspect(launched.runId, { eventLimit: 3 });
                const rows = ctx.store.rowsFor(launched.runId) as Array<{ seq: number }>;
                assert.equal(snap.events.length, 3);
                assert.deepEqual(snap.events.map((event) => event.seq), rows.slice(-3).map((row) => row.seq));
        });

        // T17
        test('inspect maps journal rows faithfully', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const snap = await ctx.runtime.inspect(launched.runId, { eventLimit: 100 });
                const rows = ctx.store.rowsFor(launched.runId) as Array<{
                        seq: number;
                        ts: number;
                        type: string;
                        payload: Record<string, unknown>;
                }>;
                assert.equal(snap.events.length, rows.length);
                assert.equal(snap.events[0].at, rows[0].ts);
                assert.equal(snap.events[0].kind, rows[0].type);
                assert.deepEqual(snap.events[0].data, rows[0].payload);
        });

        // T18
        test('inspect of an unknown runId is NOT_FOUND', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.inspect('nope'),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'NOT_FOUND',
                );
        });

        // T19
        test('terminality flips after the agent finishes the step', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                assert.equal((await ctx.runtime.inspect(launched.runId)).terminal, false);
                await agentCompletes(ctx, launched.runId, 'succeeded');
                assert.equal((await ctx.runtime.inspect(launched.runId)).terminal, true);
        });
});

suite('bgAgent: message', () => {
        // T20
        test('message delivers to the agent inbox with type and payload', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.message(launched.runId, { type: 'user.prompt', payload: { k: 1 } });
                const messages = peek(ctx, 'agent-alpha');
                assert.equal(messages.length, 2);
                const second = messages[1] as { kind: string; payload: { taskId: string; message: string } };
                // The a2a steering-relay contract shape: exactly taskId /
                // message (the typed body rides the message string).
                assert.equal(second.kind, 'steering-relay');
                assert.match(second.payload.taskId, /^T-\d{3,}$/);
                const body = JSON.parse(second.payload.message) as { graphId: string; type: string; payload: { k: number } };
                assert.equal(body.graphId, launched.runId);
                assert.equal(body.type, 'user.prompt');
                assert.deepEqual(body.payload, { k: 1 });
        });

        // T21
        test('message threads inReplyTo the launch message', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.message(launched.runId, { payload: { hi: true } });
                const messages = peek(ctx, 'agent-alpha') as Array<{ id: string; inReplyTo: string | null }>;
                assert.equal(messages[1].inReplyTo, messages[0].id);
        });

        // T22
        test('message returns a delivery receipt', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const receipt = await ctx.runtime.message(launched.runId, { type: 'user.prompt', payload: { n: 1 } });
                assert.equal(receipt.runId, launched.runId);
                assert.equal(receipt.delivered, true);
                assert.ok(typeof receipt.messageId === 'string' && receipt.messageId.length > 0);
                assert.equal(typeof receipt.seq, 'number');
                assert.equal(receipt.type, 'user.prompt');
        });

        // T23
        test('message on an unknown run is NOT_FOUND', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.message('nope', { payload: {} }),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'NOT_FOUND',
                );
        });

        // T24
        test('message on a cancelled run is INVALID_TRANSITION', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.control(launched.runId, 'cancel');
                await assert.rejects(
                        () => ctx.runtime.message(launched.runId, { payload: {} }),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_TRANSITION',
                );
        });
});

suite('bgAgent: control', () => {
        // T25
        test('cancel is enforced and terminalizes the run', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const result = await ctx.runtime.control(launched.runId, 'cancel', { reason: 'test cancel' });
                assert.equal(result.enforced, true);
                assert.ok(Array.isArray(result.cancelledSteps));
                assert.equal((await ctx.runtime.inspect(launched.runId)).terminal, true);
        });

        // T26
        test('cancel posts a control notice to the agent', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.control(launched.runId, 'cancel');
                const messages = peek(ctx, 'agent-alpha');
                assert.equal(messages.length, 2);
                const notice = messages[1] as { kind: string; payload: { message: string } };
                // The control notice rides the a2a steering-relay message string.
                assert.equal(notice.kind, 'steering-relay');
                const body = JSON.parse(notice.payload.message) as { control: string };
                assert.equal(body.control, 'cancel');
        });

        // T27
        test('pause is advisory: the graph state is unchanged while the inbox grows', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const before = (ctx.store.stateOf(launched.runId) as { graphStatus?: string }).graphStatus;
                const result = await ctx.runtime.control(launched.runId, 'pause');
                assert.equal(result.enforced, false);
                const after = (ctx.store.stateOf(launched.runId) as { graphStatus?: string }).graphStatus;
                assert.equal(after, before);
                assert.equal(peek(ctx, 'agent-alpha').length, 2);
        });

        // T28
        test('pause and resume each post one control message', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.control(launched.runId, 'pause');
                await ctx.runtime.control(launched.runId, 'resume');
                const messages = peek(ctx, 'agent-alpha') as Array<{ payload: { message: string } }>;
                assert.equal(messages.length, 3);
                assert.equal((JSON.parse(messages[1].payload.message) as { control: string }).control, 'pause');
                assert.equal((JSON.parse(messages[2].payload.message) as { control: string }).control, 'resume');
        });

        // T29
        test('an unknown command is INVALID_COMMAND', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await assert.rejects(
                        () => ctx.runtime.control(launched.runId, 'restart' as never),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_COMMAND',
                );
        });

        // T30
        test('control on an unknown run is NOT_FOUND', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.control('nope', 'pause'),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'NOT_FOUND',
                );
        });

        // T31
        test('a second cancel rejects (the seam\'s transition guard)', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.control(launched.runId, 'cancel');
                await assert.rejects(
                        () => ctx.runtime.control(launched.runId, 'cancel'),
                        (err: unknown) => err instanceof BgAgentError,
                );
        });
});

suite('bgAgent: outcome', () => {
        // T32
        test('a succeeded run is ok and terminal with the step output', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await agentCompletes(ctx, launched.runId, 'succeeded', { output: 'the answer' });
                const out = await ctx.runtime.outcome(launched.runId);
                assert.equal(out.terminal, true);
                assert.equal(out.ok, true);
                assert.equal(out.timedOut, false);
                assert.equal(out.result, 'the answer');
        });

        // T33
        test('a failed run carries the failure message', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await agentCompletes(ctx, launched.runId, 'failed', { message: 'kaput' });
                const out = await ctx.runtime.outcome(launched.runId);
                assert.equal(out.terminal, true);
                assert.equal(out.ok, false);
                assert.ok(String(out.error ?? '').includes('kaput'));
        });

        // T34
        test('a pending run with no wait is non-terminal and not timed out', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const out = await ctx.runtime.outcome(launched.runId);
                assert.equal(out.terminal, false);
                assert.equal(out.timedOut, false);
                assert.ok(typeof out.status === 'string');
        });

        // T35
        test('outcome waits for a late completion (real clock)', async function () {
                this.timeout(10000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-bg-agent-real-'));
                const loaded = await loadBgAgentRuntime({ root });
                if (!loaded.bound) {
                        assert.fail(loaded.detail);
                }
                const { runtime, store, vocabulary } = loaded;
                const launched = await runtime.launch({ agentId: 'agent-alpha' });
                const runId = launched.runId;
                const waiting = runtime.outcome(runId, { waitMs: 5000, pollMs: 25 });
                const timer = setTimeout(() => {
                        void (async () => {
                                const started = await store.startStep({
                                        graphId: runId,
                                        stepId: 'S-01',
                                        runnerId: 'agent-alpha',
                                        actor: vocabulary.orchActors.includes('agent')
                                                ? 'agent'
                                                : (vocabulary.orchActors.find((a) => a !== vocabulary.actor) ?? 'agent'),
                                        origin: 'agent-side',
                                });
                                await store.finishStep({
                                        graphId: runId,
                                        stepId: 'S-01',
                                        attempt: started.attempt,
                                        outcome: 'succeeded',
                                        origin: 'agent-side',
                                });
                        })();
                }, 25);
                try {
                        const out = await waiting;
                        assert.equal(out.terminal, true);
                        assert.equal(out.ok, true);
                } finally {
                        clearTimeout(timer);
                }
        });

        // T36
        test('outcome times out when waitMs elapses first (real clock)', async function () {
                this.timeout(10000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-bg-agent-real-'));
                const loaded = await loadBgAgentRuntime({ root });
                if (!loaded.bound) {
                        assert.fail(loaded.detail);
                }
                const launched = await loaded.runtime.launch({ agentId: 'agent-alpha' });
                const out = await loaded.runtime.outcome(launched.runId, { waitMs: 25, pollMs: 5 });
                assert.equal(out.terminal, false);
                assert.equal(out.timedOut, true);
        });

        // T37
        test('outcome on an unknown run is NOT_FOUND', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        () => ctx.runtime.outcome('nope'),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'NOT_FOUND',
                );
        });
});

suite('bgAgent: roster', () => {
        // T38
        test('roster lists the agent with its pending count', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const entries = await ctx.runtime.roster();
                const entry = entries.find((candidate) => candidate.agentId === 'agent-alpha');
                assert.notEqual(entry, undefined);
                assert.ok(entry!.pending >= 1);
                assert.ok(entry!.runs >= 1);
        });

        // T39
        test('roster counts runs per agent', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const entries = await ctx.runtime.roster();
                assert.equal(entries.find((candidate) => candidate.agentId === 'agent-alpha')?.runs, 2);
        });

        // T40
        test('roster filters by agentId', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.launch({ agentId: 'agent-alpha' });
                await ctx.runtime.launch({ agentId: 'agent-beta' });
                const entries = await ctx.runtime.roster({ agentId: 'agent-beta' });
                assert.equal(entries.length, 1);
                assert.equal(entries[0].agentId, 'agent-beta');
        });

        // T41
        test('roster over an empty root is empty', async () => {
                const ctx = await freshRuntime();
                const entries = await ctx.runtime.roster();
                assert.deepEqual(entries, []);
        });
});

suite('bgAgent: runtime lifecycle', () => {
        // T42
        test('BgAgentError carries a code, a name and a message', () => {
                const err = new BgAgentError('NOT_FOUND', 'gone');
                assert.ok(err instanceof Error);
                assert.equal(err.name, 'BgAgentError');
                assert.equal(err.code, 'NOT_FOUND');
                assert.equal(err.message, 'gone');
        });

        // T43
        test('createBgAgentRuntime requires the store and the bus', async () => {
                const ctx = await freshRuntime();
                await assert.rejects(
                        async () => createBgAgentRuntime(),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_SPEC',
                );
                await assert.rejects(
                        async () => createBgAgentRuntime({ store: ctx.store }),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'INVALID_SPEC',
                );
        });

        // T44
        test('a fresh runtime over the same root re-derives the agent from the journal', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const second = await loadBgAgentRuntime({ root: ctx.root, now: ctx.clock.now });
                if (!second.bound) {
                        assert.fail(second.detail);
                }
                const snap = await second.runtime.inspect(launched.runId);
                assert.equal(snap.agentId, 'agent-alpha');
        });

        // T45
        test('a fresh runtime can still message the run', async () => {
                const ctx = await freshRuntime();
                const launched = await ctx.runtime.launch({ agentId: 'agent-alpha' });
                const second = await loadBgAgentRuntime({ root: ctx.root, now: ctx.clock.now });
                if (!second.bound) {
                        assert.fail(second.detail);
                }
                const before = peek(second, 'agent-alpha').length;
                const receipt = await second.runtime.message(launched.runId, { type: 'user.prompt', payload: { k: 1 } });
                assert.equal(receipt.delivered, true);
                assert.equal(peek(second, 'agent-alpha').length, before + 1);
        });

        // T46
        test('operations after dispose reject with DISPOSED', async () => {
                const ctx = await freshRuntime();
                await ctx.runtime.dispose();
                await assert.rejects(
                        () => ctx.runtime.launch({ agentId: 'agent-alpha' }),
                        (err: unknown) => err instanceof BgAgentError && err.code === 'DISPOSED',
                );
        });
});
