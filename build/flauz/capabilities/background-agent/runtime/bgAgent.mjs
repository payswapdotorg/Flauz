/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-002 -- THE BACKGROUND-AGENT RUNTIME (Phase C-R, B1, wave 2).
 *
 * LAWS:
 * - OVER THE REAL SEAMS, ONLY: every operation goes through a REAL
 *   OrchestrationStore and a REAL A2ABus constructed over a root.
 *   No fakes, no shadow state models, no second journal.
 * - A RUN IS A GRAPH + A THREAD: one run is one single-step graph
 *   (submit -> approve) with the step routed to the agent
 *   (routeDecide -> bus.post -> delegationSent) -- the store's own
 *   first-class delegation linkage, never a private encoding.
 * - THE SEAM'S VOCABULARY IS THE SEAM'S: actor / reason / kind / the
 *   runtime's own agent identity are resolved at bind time from the
 *   modules' exported frozen constants (ORCH_ACTORS,
 *   ROUTING_REASONS, MESSAGE_KINDS, TERMINAL_STEP_STATUSES) and the
 *   exported isAgentId validator. The runtime never invents a
 *   frozen-vocabulary string.
 * - ENFORCED VS ADVISORY: cancel is ENFORCED (store.cancelGraph, a
 *   durable terminal transition) with a best-effort A2A notice;
 *   pause/resume are ADVISORY (A2A control messages to the agent) --
 *   the store has no pause transition and faking one is forbidden.
 * - DURABLE DERIVATION: the run's agent is re-derived from the
 *   journal (the latest route-decision row carrying targetAgent)
 *   whenever the in-memory launch index misses -- a fresh runtime
 *   over the same root serves the same run.
 * - FAIL TYPED, NEVER SILENTLY: seam errors are classified into
 *   typed BgAgentError codes; the bind is a typed
 *   { bound: false, detail } verdict -- never a throw, never a fake
 *   (the cli/runtime/context.ts discipline).
 * - DETERMINISM BY INJECTION: an injected clock drives the store
 *   (StoreOptions.clock) and every posted message ts; nothing in
 *   this module calls Date.now or Math.random itself.
 */

const ORCH_STORE_SEAM = '../../../../../extensions/flauz-agent/core/orchStore.mjs';
const ORCH_PROTOCOL_SEAM = '../../../../../extensions/flauz-agent/core/orchestration.mjs';
const A2A_BUS_SEAM = '../../../../../extensions/flauz-agent/core/a2a.mjs';

const STEP_ID = 'S-01';
const TERMINAL_GRAPH_STATUS = /^(complete|completed|cancelled|canceled|failed|succeeded|aborted)$/i;

/**
 * Station seam-completion: the a2a contract requires task ids of the form
 * T-NNN+; a background-agent run IS a single-step graph (G-NNN), so the
 * delegated task id is the graph's own counter, re-prefixed. The mapping
 * is bijective and journal-derivable (never a private encoding).
 */
function taskIdOfRun(runId) {
        const digits = /^G-(\d+)$/.exec(String(runId));
        if (digits === null) {
                throw new BgAgentError('INVALID_SPEC', 'taskIdOfRun: runId must be a G-NNN graph id (got ' + JSON.stringify(runId) + ')');
        }
        return 'T-' + digits[1];
}

export class BgAgentError extends Error {
        constructor(code, message) {
                super(message ?? code);
                this.name = 'BgAgentError';
                this.code = code;
        }
}

function need(condition, code, message) {
        if (!condition) throw new BgAgentError(code, message);
}

function isPlainObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function describeError(error) {
        return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_VOCABULARY = {
        actor: 'human',
        reason: 'capability-match',
        kind: 'task-delegation',
        steeringKind: 'steering-relay',
        from: 'flauz-bg-runtime',
        fromValidated: false,
        origin: 'flauz-bg-agent',
        messageKinds: [],
        orchActors: [],
        routingReasons: [],
        terminalStepStatuses: ['succeeded', 'failed', 'cancelled', 'canceled', 'skipped'],
        validateAgentId: null,
};

/** First preference present in the seam's frozen list; else the list's own head; else the fallback. */
function firstFrom(list, preferences, fallback) {
        if (Array.isArray(list)) {
                for (const preference of preferences) {
                        if (list.includes(preference)) return preference;
                }
                if (list.length > 0) return list[0];
        }
        return fallback;
}

/**
 * Resolve every frozen vocabulary the runtime must speak from the
 * loaded seam modules. Never invents a value: each field is either a
 * preference hit, the seam's own first entry, or (only when the seam
 * exports nothing usable) the documented fallback.
 */
function resolveVocabulary(orchModule, a2aModule, orchProtocolModule) {
        const orchActors = Array.isArray(orchModule && orchModule.ORCH_ACTORS) ? orchModule.ORCH_ACTORS : null;
        // Station seam-completion: ROUTING_REASONS lives in orchestration.mjs (the
        // protocol vocabulary module), NOT orchStore.mjs — resolved from the
        // protocol seam, falling back to the store's re-exports if present.
        const routingReasons = Array.isArray(orchProtocolModule && orchProtocolModule.ROUTING_REASONS)
                ? orchProtocolModule.ROUTING_REASONS
                : Array.isArray(orchModule && orchModule.ROUTING_REASONS) ? orchModule.ROUTING_REASONS : null;
        const messageKinds = Array.isArray(a2aModule && a2aModule.MESSAGE_KINDS) ? a2aModule.MESSAGE_KINDS : null;
        const terminalStepStatuses = Array.isArray(orchModule && orchModule.TERMINAL_STEP_STATUSES)
                ? orchModule.TERMINAL_STEP_STATUSES
                : null;
        const validateAgentId = a2aModule && typeof a2aModule.isAgentId === 'function' ? a2aModule.isAgentId : null;
        const fromPreferences = ['flauz-bg-runtime', 'flauz-cli', 'runtime', 'system', 'orchestrator', 'local'];
        let from = fromPreferences[0];
        let fromValidated = false;
        if (validateAgentId !== null) {
                for (const candidate of fromPreferences) {
                        if (validateAgentId(candidate)) {
                                from = candidate;
                                fromValidated = true;
                                break;
                        }
                }
        }
        return {
                actor: firstFrom(orchActors, ['human', 'service', 'system', 'orchestrator'], 'human'),
                reason: firstFrom(routingReasons, ['capability-match', 'load-balance', 'operator-choice', 'delegation', 'background-agent'], 'capability-match'),
                kind: firstFrom(messageKinds, ['task-delegation', 'request', 'task', 'instruction', 'delegate', 'message', 'control'], 'task-delegation'),
                steeringKind: firstFrom(messageKinds, ['steering-relay', 'task-delegation', 'request', 'message', 'control'], 'steering-relay'),
                from,
                fromValidated,
                origin: 'flauz-bg-agent',
                messageKinds: messageKinds ?? [],
                orchActors: orchActors ?? [],
                routingReasons: routingReasons ?? [],
                terminalStepStatuses: terminalStepStatuses ?? DEFAULT_VOCABULARY.terminalStepStatuses,
                validateAgentId,
        };
}

/**
 * The runtime over REAL OrchestrationStore / A2ABus instances.
 * Public surface: launch / inspect / message / control / outcome /
 * roster (+ dispose).
 */
export function createBgAgentRuntime(deps = {}) {
        const { store, bus, now, vocabulary, logger } = deps;
        need(isPlainObject(store) && typeof store.stateOf === 'function' && typeof store.submitGraph === 'function',
                'INVALID_SPEC', 'createBgAgentRuntime: a REAL OrchestrationStore binding is required');
        need(isPlainObject(bus) && typeof bus.post === 'function' && typeof bus.collect === 'function',
                'INVALID_SPEC', 'createBgAgentRuntime: a REAL A2ABus binding is required');
        const clock = typeof now === 'function' ? now : Date.now;
        const vocab = { ...DEFAULT_VOCABULARY, ...(isPlainObject(vocabulary) ? vocabulary : {}) };

        let disposed = false;
        const runs = new Map(); // graphId -> { agentId, launchMessageId }

        function warn(message) {
                if (logger && typeof logger.warn === 'function') logger.warn('flauz-bg-agent: ' + message);
        }

        function assertLive() {
                need(!disposed, 'DISPOSED', 'the bgAgent runtime has been disposed');
        }

        /** Classify a seam error into a typed code (shape-based: the seam's own error text). */
        function classify(error, contextMessage) {
                if (error instanceof BgAgentError) return error;
                const code = error && typeof error.code === 'string' ? error.code : '';
                const message = describeError(error);
                const hay = (code + ' ' + message).toLowerCase();
                if (/not.?found|unknown graph|no such graph|missing graph|does not exist/.test(hay)) {
                        return new BgAgentError('NOT_FOUND', message.length > 0 ? message : contextMessage);
                }
                if (/transition|illegal|invalid state|wrong state|not allowed/.test(hay)) {
                        return new BgAgentError('INVALID_TRANSITION', message.length > 0 ? message : contextMessage);
                }
                return new BgAgentError('SEAM_FAILURE', message + (contextMessage ? ' (' + contextMessage + ')' : ''));
        }

        function statusOf(state) {
                return typeof state.graphStatus === 'string' ? state.graphStatus : 'unknown';
        }

        function phaseOf(state) {
                const derived = state && state.derived;
                return derived && typeof derived.phase === 'string' ? derived.phase : null;
        }

        function stepsOf(state) {
                const steps = state && state.steps;
                if (steps == null || typeof steps !== 'object') return [];
                return Object.values(steps);
        }

        function isTerminal(state) {
                if (state == null) return false;
                if (state.completedAt != null) return true;
                if (TERMINAL_GRAPH_STATUS.test(statusOf(state))) return true;
                const steps = stepsOf(state);
                if (steps.length === 0) return false;
                return steps.every((step) => vocab.terminalStepStatuses.includes(String(step && step.status)));
        }

        async function requireState(runId) {
                need(typeof runId === 'string' && runId.length > 0, 'INVALID_SPEC', 'runId must be a non-empty string');
                let state;
                try {
                        state = await store.stateOf(runId);
                } catch (error) {
                        throw classify(error, 'stateOf failed for ' + runId);
                }
                need(state != null && typeof state === 'object', 'NOT_FOUND', 'run not found: ' + runId);
                return state;
        }

        async function requireRows(runId) {
                let rows;
                try {
                        rows = await store.rowsFor(runId);
                } catch (error) {
                        throw classify(error, 'rowsFor failed for ' + runId);
                }
                need(Array.isArray(rows), 'SEAM_FAILURE', 'rowsFor did not return an array for ' + runId);
                return rows;
        }

        /** The run's agent: launch index first, then the journal's latest route decision. */
        function agentOf(runId, rows) {
                const entry = runs.get(runId);
                if (entry) return entry.agentId;
                for (let i = rows.length - 1; i >= 0; i--) {
                        const row = rows[i];
                        const agent = row && row.payload ? row.payload.targetAgent : undefined;
                        if (typeof agent === 'string' && agent.length > 0) return agent;
                }
                return null;
        }

        function launchMessageOf(runId) {
                const entry = runs.get(runId);
                return entry ? entry.launchMessageId : null;
        }

        function rowToEvent(row) {
                return { at: row.ts, kind: row.type, data: row.payload, seq: row.seq, rowId: row.rowId };
        }

        // ── operations ───────────────────────────────────────────────────────────

        async function launch(spec = {}) {
                assertLive();
                need(isPlainObject(spec), 'INVALID_SPEC', 'launch: spec must be a plain object');
                const agentId = spec.agentId;
                need(typeof agentId === 'string' && agentId.trim().length > 0, 'INVALID_SPEC', 'launch: agentId must be a non-empty string');
                const label = spec.label;
                need(label === undefined || typeof label === 'string', 'INVALID_SPEC', 'launch: label must be a string');
                const input = spec.input;
                need(input === undefined || isPlainObject(input), 'INVALID_SPEC', 'launch: input must be a plain object');
                const title = label !== undefined ? label : 'background-agent run';
                const submitted = await store.submitGraph({
                        title,
                        steps: [{
                                stepId: STEP_ID,
                                title,
                                instruction: 'Execute the background-agent run for ' + agentId + '.',
                                toolInput: input !== undefined ? input : {},
                                routing: { allowedAgents: [agentId] },
                        }],
                        actor: vocab.actor,
                        origin: vocab.origin,
                });
                const runId = submitted.graphId;
                await store.approveGraph({ graphId: runId, actor: vocab.actor, origin: vocab.origin });
                const decision = await store.routeDecide({
                        graphId: runId,
                        stepId: null,
                        targetAgent: agentId,
                        reason: vocab.reason,
                        details: { source: 'flauz-bg-agent', label: label !== undefined ? label : null },
                        actor: vocab.actor,
                        origin: vocab.origin,
                });
                const posted = await bus.post({
                        message: {
                                // The a2a contract's task-delegation shape (exactly taskId /
                                // taskDescription / prompt / workflowId?; the graph linkage rides
                                // the taskDescription + prompt strings, the store's delegationSent
                                // receipt links the row to the message id).
                                kind: vocab.kind,
                                from: vocab.from,
                                to: agentId,
                                ts: clock(),
                                payload: {
                                        taskId: taskIdOfRun(runId),
                                        taskDescription: 'Background-agent run ' + runId + (label !== undefined ? ': ' + label : ''),
                                        prompt: JSON.stringify({ graphId: runId, label: label !== undefined ? label : null, input: input !== undefined ? input : null }),
                                },
                        },
                });
                await store.delegationSent({
                        graphId: runId,
                        stepId: null,
                        decisionRowId: decision.rowId,
                        messageId: posted.id,
                        actor: vocab.actor,
                        origin: vocab.origin,
                });
                runs.set(runId, { agentId, launchMessageId: posted.id });
                let status = 'approved';
                try {
                        const state = await store.stateOf(runId);
                        if (state != null && typeof state.graphStatus === 'string') status = state.graphStatus;
                } catch (error) {
                        warn('launch: stateOf after launch failed: ' + describeError(error));
                }
                return { runId, agentId, status };
        }

        async function inspect(runId, options = {}) {
                assertLive();
                const eventLimit = options.eventLimit === undefined ? 20 : options.eventLimit;
                need(Number.isInteger(eventLimit) && eventLimit >= 0, 'INVALID_SPEC', 'inspect: eventLimit must be a non-negative integer');
                const state = await requireState(runId);
                const rows = await requireRows(runId);
                const graph = isPlainObject(state.graph) ? state.graph : {};
                return {
                        runId,
                        agentId: agentOf(runId, rows),
                        label: typeof graph.title === 'string' ? graph.title : null,
                        status: statusOf(state),
                        phase: phaseOf(state),
                        terminal: isTerminal(state),
                        createdAt: typeof graph.createdAt === 'number' ? graph.createdAt : null,
                        updatedAt: typeof graph.updatedAt === 'number' ? graph.updatedAt : null,
                        completedAt: typeof state.completedAt === 'number' ? state.completedAt : null,
                        events: rows.slice(-eventLimit).map(rowToEvent),
                        eventCount: rows.length,
                };
        }

        async function message(runId, msg = {}) {
                assertLive();
                need(isPlainObject(msg), 'INVALID_SPEC', 'message: the message must be a plain object');
                const payload = msg.payload;
                need(payload !== undefined, 'INVALID_SPEC', 'message: payload is required');
                const type = msg.type === undefined ? 'user.message' : msg.type;
                need(typeof type === 'string' && type.length > 0, 'INVALID_SPEC', 'message: type must be a non-empty string');
                const state = await requireState(runId);
                if (isTerminal(state)) {
                        throw new BgAgentError('INVALID_TRANSITION', 'message: run ' + runId + ' is terminal (' + statusOf(state) + ')');
                }
                const rows = await requireRows(runId);
                const agentId = agentOf(runId, rows);
                need(agentId !== null, 'NOT_FOUND', 'message: the agent of run ' + runId + ' could not be derived from the journal');
                const posted = await bus.post({
                        message: {
                                // The a2a contract's steering-relay shape (exactly taskId /
                                // message; the typed body rides the message string).
                                kind: vocab.steeringKind,
                                from: vocab.from,
                                to: agentId,
                                ts: clock(),
                                inReplyTo: launchMessageOf(runId),
                                payload: {
                                        taskId: taskIdOfRun(runId),
                                        message: JSON.stringify({ graphId: runId, type, payload }),
                                },
                        },
                });
                return { runId, delivered: true, messageId: posted.id, seq: posted.seq, type };
        }

        async function postControlNotice(runId, rows, controlWord, reason) {
                try {
                        const agentId = agentOf(runId, rows);
                        if (agentId === null) return null;
                        const posted = await bus.post({
                                message: {
                                        // The a2a contract's steering-relay shape (exactly taskId /
                                        // message; the control word rides the message string).
                                        kind: vocab.steeringKind,
                                        from: vocab.from,
                                        to: agentId,
                                        ts: clock(),
                                        inReplyTo: launchMessageOf(runId),
                                        payload: {
                                                taskId: taskIdOfRun(runId),
                                                message: JSON.stringify({ graphId: runId, control: controlWord, reason }),
                                        },
                                },
                        });
                        return posted.id;
                } catch (error) {
                        warn('control: the ' + controlWord + ' notice could not be posted: ' + describeError(error));
                        return null;
                }
        }

        async function control(runId, command, options = {}) {
                assertLive();
                need(isPlainObject(options), 'INVALID_SPEC', 'control: options must be a plain object');
                if (command !== 'pause' && command !== 'resume' && command !== 'cancel') {
                        throw new BgAgentError('INVALID_COMMAND', "control: unknown command '" + String(command) + "' (expected pause | resume | cancel)");
                }
                const state = await requireState(runId);
                const rows = await requireRows(runId);
                if (command === 'cancel') {
                        if (isTerminal(state)) {
                                throw new BgAgentError('INVALID_TRANSITION', 'control: cannot cancel a terminal run (' + statusOf(state) + ')');
                        }
                        const reason = typeof options.reason === 'string' && options.reason.length > 0 ? options.reason : 'background-agent cancel';
                        let cancelledSteps = [];
                        try {
                                const result = await store.cancelGraph({ graphId: runId, reason, actor: vocab.actor, origin: vocab.origin });
                                cancelledSteps = result && Array.isArray(result.cancelledSteps) ? result.cancelledSteps : [];
                        } catch (error) {
                                throw classify(error, 'cancelGraph failed for ' + runId);
                        }
                        const noticeMessageId = await postControlNotice(runId, rows, 'cancel', reason);
                        return { runId, command: 'cancel', enforced: true, cancelledSteps, noticeMessageId };
                }
                const agentId = agentOf(runId, rows);
                need(agentId !== null, 'NOT_FOUND', 'control: the agent of run ' + runId + ' could not be derived from the journal');
                const posted = await bus.post({
                        message: {
                                // The a2a contract's steering-relay shape (advisory controls).
                                kind: vocab.steeringKind,
                                from: vocab.from,
                                to: agentId,
                                ts: clock(),
                                inReplyTo: launchMessageOf(runId),
                                payload: {
                                        taskId: taskIdOfRun(runId),
                                        message: JSON.stringify({ graphId: runId, control: command }),
                                },
                        },
                });
                return { runId, command, enforced: false, messageId: posted.id };
        }

        function terminalOutcome(runId, state, rows) {
                const steps = stepsOf(state);
                const ok = steps.length > 0 && steps.every((step) => /succeed/i.test(String(step && step.status)));
                let error = null;
                for (const step of steps) {
                        const failure = step && step.failure;
                        if (failure && typeof failure.message === 'string' && failure.message.length > 0) {
                                error = failure.message;
                                break;
                        }
                }
                let result = null;
                if (ok) {
                        for (let i = rows.length - 1; i >= 0; i--) {
                                const output = rows[i] && rows[i].payload ? rows[i].payload.output : undefined;
                                if (typeof output === 'string') {
                                        result = output;
                                        break;
                                }
                        }
                }
                return { runId, status: statusOf(state), terminal: true, ok, result, error, timedOut: false };
        }

        async function outcome(runId, options = {}) {
                assertLive();
                const waitMs = options.waitMs === undefined ? 0 : options.waitMs;
                const pollMs = options.pollMs === undefined ? 25 : options.pollMs;
                need(Number.isFinite(waitMs) && waitMs >= 0, 'INVALID_SPEC', 'outcome: waitMs must be a non-negative number');
                need(Number.isFinite(pollMs) && pollMs > 0, 'INVALID_SPEC', 'outcome: pollMs must be a positive number');
                const deadline = clock() + waitMs;
                for (;;) {
                        const state = await requireState(runId);
                        if (isTerminal(state)) {
                                const rows = await requireRows(runId);
                                return terminalOutcome(runId, state, rows);
                        }
                        if (clock() >= deadline) {
                                return { runId, status: statusOf(state), terminal: false, ok: false, result: null, error: null, timedOut: waitMs > 0 };
                        }
                        await sleep(pollMs);
                }
        }

        async function roster(options = {}) {
                assertLive();
                need(isPlainObject(options), 'INVALID_SPEC', 'roster: options must be a plain object');
                const agentFilter = options.agentId;
                need(agentFilter === undefined || (typeof agentFilter === 'string' && agentFilter.length > 0),
                        'INVALID_SPEC', 'roster: agentId must be a non-empty string');
                const pendingByAgent = new Map();
                try {
                        const listed = await bus.list();
                        const agents = listed && Array.isArray(listed.agents) ? listed.agents : [];
                        for (const entry of agents) {
                                if (entry && typeof entry.agentId === 'string') {
                                        pendingByAgent.set(entry.agentId, typeof entry.pending === 'number' ? entry.pending : 0);
                                }
                        }
                } catch (error) {
                        throw classify(error, 'bus list failed');
                }
                const runsByAgent = new Map();
                try {
                        const graphs = await store.listGraphs();
                        if (Array.isArray(graphs)) {
                                for (const graph of graphs) {
                                        if (!graph || typeof graph.graphId !== 'string') continue;
                                        const rows = await store.rowsFor(graph.graphId);
                                        const agent = agentOf(graph.graphId, Array.isArray(rows) ? rows : []);
                                        if (agent !== null) runsByAgent.set(agent, (runsByAgent.get(agent) ?? 0) + 1);
                                }
                        }
                } catch (error) {
                        throw classify(error, 'listGraphs failed');
                }
                const agentIds = new Set([...pendingByAgent.keys(), ...runsByAgent.keys()]);
                return [...agentIds]
                        .map((id) => ({ agentId: id, pending: pendingByAgent.get(id) ?? 0, runs: runsByAgent.get(id) ?? 0 }))
                        .filter((entry) => agentFilter === undefined || entry.agentId === agentFilter)
                        .sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
        }

        async function dispose() {
                disposed = true;
        }

        return { launch, inspect, message, control, outcome, roster, dispose };
}

async function importSeamModule(specifier) {
        // Non-literal on purpose: the seam contract is validated at runtime
        // (the cli/runtime/context.ts discipline); tsc must not resolve it.
        return await import(specifier);
}

/**
 * Bind the runtime over the REAL seams at a root: non-literal dynamic
 * imports, class-shape validation, structural method validation, and
 * vocabulary resolution from the modules' frozen constants. Every
 * failure is a typed { bound: false, detail } verdict -- never a
 * throw, never a silent fake.
 */
export async function loadBgAgentRuntime(options = {}) {
        const root = options.root;
        const now = options.now;
        const logger = options.logger;
        need(typeof root === 'string' && root.length > 0, 'INVALID_SPEC', 'loadBgAgentRuntime: root is required');

        let orchModule;
        try {
                orchModule = await importSeamModule(ORCH_STORE_SEAM);
        } catch (error) {
                return { bound: false, detail: 'orchStore seam import failed: ' + describeError(error) };
        }
        let a2aModule;
        try {
                a2aModule = await importSeamModule(A2A_BUS_SEAM);
        } catch (error) {
                return { bound: false, detail: 'a2a seam import failed: ' + describeError(error) };
        }
        let orchProtocolModule;
        try {
                orchProtocolModule = await importSeamModule(ORCH_PROTOCOL_SEAM);
        } catch (error) {
                // Non-fatal: the protocol vocabulary module is optional when the store
                // itself re-exports ROUTING_REASONS; the vocabulary resolver probes both.
                orchProtocolModule = null;
        }

        const StoreCtor = orchModule && orchModule.OrchestrationStore;
        if (typeof StoreCtor !== 'function') {
                return { bound: false, detail: 'orchStore seam does not export the OrchestrationStore class' };
        }
        let store;
        try {
                store = new StoreCtor(root, typeof now === 'function' ? { clock: now } : undefined);
                const loaded = store.load();
                if (loaded !== undefined && typeof loaded.then === 'function') await loaded;
        } catch (error) {
                return { bound: false, detail: 'orchStore load failed: ' + describeError(error) };
        }
        const STORE_METHODS = ['submitGraph', 'approveGraph', 'routeDecide', 'delegationSent', 'cancelGraph', 'startStep', 'finishStep', 'stateOf', 'rowsFor', 'listGraphs'];
        for (const method of STORE_METHODS) {
                if (typeof store[method] !== 'function') {
                        return { bound: false, detail: 'orchStore binding lacks ' + method + '()' };
                }
        }

        const BusCtor = a2aModule && a2aModule.A2ABus;
        if (typeof BusCtor !== 'function') {
                return { bound: false, detail: 'a2a seam does not export the A2ABus class' };
        }
        let bus;
        try {
                bus = new BusCtor(root);
        } catch (error) {
                return { bound: false, detail: 'a2a bus construction failed: ' + describeError(error) };
        }
        for (const method of ['post', 'collect', 'list']) {
                if (typeof bus[method] !== 'function') {
                        return { bound: false, detail: 'a2a binding lacks ' + method + '()' };
                }
        }

        const vocabulary = resolveVocabulary(orchModule, a2aModule, orchProtocolModule);
        const runtime = createBgAgentRuntime({ store, bus, now, vocabulary, logger });
        return { bound: true, runtime, store, bus, vocabulary };
}
