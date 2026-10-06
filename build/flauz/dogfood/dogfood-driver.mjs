#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W1 (dogfood harness) -- THE DRIVER.
 *
 * Constructs the REAL product seams on one workspace root (the
 * journey-drill pattern: imports + real seams + receipts) and executes
 * EXERCISE SCRIPTS against them:
 *
 *   - Workspace OS root: TaskService + EvidenceLedger (the fixture
 *     ed25519 signer, the committed repo fixtures -- no secrets) +
 *     MemoryStore, on a REAL mkdtemp root, real fs, ensure()d;
 *   - Agent OS session + task envelope: OrchestrationStore
 *     submitGraph -> approveGraph (the mission -> task mint), the
 *     exclusive session claim (acquireClaim) + the session-tier memory
 *     record, startStep -> finishStep per exercise, releaseClaim,
 *     completeGraph;
 *   - Model Fabric with a SELECTABLE provider lane: the workspace
 *     providers-file enablement act + the routing-policy rewrite per
 *     switch, a fresh capability-registry load, a durable ModelRouter
 *     decision per call, and the REAL openAiCompat adapter + nodeHttpPort
 *     streaming every completion over a REAL local socket;
 *   - the evidence ledger: every exercise's artifacts hash-pinned via
 *     ledger.append + tasks.recordEvidence.
 *
 * MODES (the credential-free law):
 *   fake-lane (default)   the model intelligence is the fake/scripted
 *                         provider lane (fixture level -- NEVER
 *                         wording-promoted; the station runs the live
 *                         mode). The answers are COMPUTED live from the
 *                         real tree/workspace by the local wire server.
 *   live-provider         selected ONLY when ALL THREE env vars are
 *                         present (FLAUZ_LIVE_PROVIDER_BASE_URL /
 *                         _API_KEY / _MODEL -- the repo's established
 *                         vendor-neutral contract, env-only, never
 *                         files, never inline). A partially-present
 *                         contract FAILS CLOSED (exit 2) -- never a
 *                         silent fallback to the fake lane.
 *
 * RECEIPTS: per-exercise friction logs (schema flauz.dogfood-friction/v1,
 * append-only) + per-exercise receipts + a run summary (schema
 * flauz.dogfood-run/v1) under --out (default <root>/.flauz/dogfood-records).
 *
 * W2.1 (A-PROD-003-W2.1): the three REGISTERED W2 dogfood findings are
 * fixed harness-side here -- P2-FIX-117 (the FLAUZ_DOGFOOD_WALL_CLOCK_BUDGET_MS
 * env knob wired through AdapterConfig.requestTimeoutMs; ask-measuring
 * timing rows + the run summary record the budget actually used; the typed
 * TIMEOUT / bounded-retry semantics unchanged), P2-FIX-118 (the live lanes
 * parse answers through the fence-tolerant strip-fence-then-parse path),
 * and P2-FIX-119 (the provider-switch question carries the workspace facts
 * in the prompt, built at ask time; both lanes answer from the prompt).
 *
 * W3.2 (A-PROD-003-W3.2): the REGISTERED live finding P2-FIX-121 is fixed
 * harness-side here -- the LIVE lane's ask request sets an explicit
 * completion budget (the FLAUZ_DOGFOOD_LIVE_MAX_TOKENS env knob, default
 * 32_768, fail-closed on a malformed value) wired through the product's
 * existing request surface ChatRequest.maxOutputTokens -> the openAiCompat
 * wire body's max_tokens; the fake lanes' request shape is UNCHANGED. The
 * ask's ok-result and the exercise receipts surface the finish reason (the
 * adapter's terminal finish event); a `length` finish renders as the
 * VISIBLE TRUNCATED marker -- never a silent ok, never a bare raw-parse
 * error.
 *
 * Usage:
 *   node --experimental-strip-types build/flauz/dogfood/dogfood-driver.mjs \
 *        [--repo <dir>] [--out <dir>] [--exercise <id>]
 *
 * W7 (A-PROD-003-W7): the agent-with-tools lanes -- the exercise list
 * grows to FIVE (agent-delegation + tools-exploration join explore-repo
 * + provider-switch + browser-policy); the run summary's localLaneCensus
 * grows the additive toolsComputations counter (the tools-lane turns).
 * The existing exercises' receipts stay byte-compatible in shape (their
 * code paths are untouched).
 *
 * Harness module (build/flauz/dogfood/**): NOT a gate instrument.
 */

import * as nodeFs from 'node:fs';
import * as nodeFsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import { sha256Hex } from '../../../extensions/flauz-workspace/src/api.ts';
import { TaskService } from '../../../extensions/flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../../extensions/flauz-workspace/src/ledger.ts';
import { MemoryStore } from '../../../extensions/flauz-memory/src/memory.ts';
import { createEd25519Signer } from '../../../extensions/flauz-workflow/src/keys.ts';
import { ModelCapabilityRegistry } from '../../../extensions/flauz-models/src/discovery/registry.ts';
import { writeProviderOverrides } from '../../../extensions/flauz-models/src/discovery/configs.ts';
import { ModelRouter, saveRoutingPolicy } from '../../../extensions/flauz-models/src/routing/store.ts';
import { DEFAULT_ROUTING_POLICY } from '../../../extensions/flauz-models/src/routing/policy.ts';
import { createOpenAiCompatAdapter } from '../../../extensions/flauz-models/src/adapters/openAiCompat.ts';
import { nodeHttpPort } from '../../../extensions/flauz-models/src/contract/nodePorts.ts';
import { isProviderError } from '../../../extensions/flauz-models/src/contract/errors.ts';
import { OrchestrationStore } from '../../../extensions/flauz-agent/core/orchStore.mjs';
import { resolveProviderRetryBound } from '../../../extensions/flauz-agent/core/providerRetry.mjs';

import { FrictionLog } from './frictionlog.mjs';
import { startFakeProvider } from './fake-provider.mjs';
import { consumeAskStream, DEFAULT_LIVE_MAX_TOKENS, LIVE_MAX_TOKENS_ENV, parseLiveMaxTokens } from './liveBudget.mjs';
import { EXPLORE_EXERCISE } from './exercises/explore-repo.task.ts';
import { PROVIDER_SWITCH_EXERCISE } from './exercises/provider-switch.task.ts';
import { BROWSER_POLICY_EXERCISE } from './exercises/browser-policy.task.ts';
import { AGENT_DELEGATION_EXERCISE } from './exercises/agent-delegation.task.ts';
import { TOOLS_EXPLORATION_EXERCISE } from './exercises/tools-exploration.task.ts';

// ---------------------------------------------------------------------------
// Constants, environment, small utilities
// ---------------------------------------------------------------------------

const WO_ID = 'A-PROD-003-W1';
const PRIMARY = 'flauz.agent.primary';
const STEP_ID = 'S-01';
const DRIVER_TAG = 'flauz dogfood driver';

const LIVE_BASE_URL = process.env['FLAUZ_LIVE_PROVIDER_BASE_URL'] ?? '';
const LIVE_API_KEY = process.env['FLAUZ_LIVE_PROVIDER_API_KEY'] ?? '';
const LIVE_MODEL = process.env['FLAUZ_LIVE_PROVIDER_MODEL'] ?? '';
const LIVE_CREDENTIAL_REF = 'env:FLAUZ_LIVE_PROVIDER_API_KEY';

// P2-FIX-117 (the budget env knob): env-only, OPTIONAL, fail-closed on a
// malformed value. Wired through the product's EXISTING wall-clock budget
// surface for the ask -- AdapterConfig.requestTimeoutMs
// (extensions/flauz-models/src/adapters/common.ts), the same field the real
// openAiCompat adapter turns into the request `timeoutMs` whose expiry maps
// onto the TYPED TIMEOUT ("request exceeded its wall-clock budget") with
// the bounded-retry semantics UNCHANGED. The default (knob absent) keeps the
// W1 value exactly: 15_000 ms, unchanged for the fake lanes.
const WALL_CLOCK_BUDGET_ENV = 'FLAUZ_DOGFOOD_WALL_CLOCK_BUDGET_MS';
const DEFAULT_WALL_CLOCK_BUDGET_MS = 15_000;

// P2-FIX-121 (the live completion-budget knob): env-only, OPTIONAL,
// fail-closed on a malformed value (the constants + the pure parser live
// in liveBudget.mjs -- the single source the tests pin). The value lands
// on the LIVE lane's ask requests ONLY, wired through the product's
// EXISTING request surface -- ChatRequest.maxOutputTokens
// (extensions/flauz-models/src/contract/types.ts), the field the real
// openAiCompat adapter maps onto the wire body's `max_tokens`
// (extensions/flauz-models/src/adapters/openAiCompat.ts,
// buildOpenAiRequestBody). The default (knob absent) is the generous
// 32_768-token budget (the platform default ~4096 truncated the real
// 23-consumer exploration map mid-JSON: finish_reason length at
// completion_tokens 4095, the opening fence without the closing). The
// fake lanes' request shape is UNCHANGED (the P2-FIX-121 acceptance).
//

const FAKE_PROVIDER_ID = 'flauz-dogfood-fake';
const FAILING_PROVIDER_ID = 'flauz-dogfood-failing';
const LIVE_PROVIDER_ID = 'flauz-dogfood-live';
const FAKE_CREDENTIAL_REF = 'env:FLAUZ_DOGFOOD_FAKE_KEY';
const FAILING_CREDENTIAL_REF = 'env:FLAUZ_DOGFOOD_FAILING_KEY';

const RUN_SCHEMA = 'flauz.dogfood-run/v1';

const log = (line) => {
        console.log(`${DRIVER_TAG}: ${line}`);
};

/** Resolves the repo root from this driver file (build/flauz/dogfood/<this file> -> three dirs up). */
function repoRootFromHere() {
        const url = import.meta.url;
        if (!url.startsWith('file://')) {
                throw new Error(`${DRIVER_TAG}: unsupported module url ${url}`);
        }
        let target = url.slice('file://'.length);
        if (process.platform === 'win32') {
                target = target.replace(/^\/([A-Za-z]:)/, '$1');
        }
        const here = nodePath.dirname(decodeURIComponent(target));
        return nodePath.resolve(here, '..', '..', '..');
}

// ---------------------------------------------------------------------------
// The shared ports (the journey-drill runtime pattern)
// ---------------------------------------------------------------------------

function runtimeFsPort() {
        return {
                readFileUtf8: async target => {
                        try {
                                return await nodeFsPromises.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if (err !== null && typeof err === 'object' && err.code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target, contents) => nodeFsPromises.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target, contents) => nodeFsPromises.appendFile(target, contents, { encoding: 'utf-8' }),
                rename: (from, to) => nodeFsPromises.rename(from, to),
                mkdir: target => nodeFsPromises.mkdir(target, { recursive: true }),
                readdir: async target => (await nodeFsPromises.readdir(target)).sort(),
        };
}

/** Deterministic stepping clock for the SEAMS (receipts/timing use the real wall clock). */
function steppingClock(start) {
        let current = start;
        return () => {
                const value = current;
                current += 1000;
                return value;
        };
}

const nodeHashPort = { sha256Hex: contents => sha256Hex(contents) };

/** The evidence-minting TaskPort adapter (the journey's journeyTaskPort pattern). */
function dogfoodTaskPort(tasks, ledger) {
        return {
                createTask: async args => ({ taskId: (await tasks.createTask(args.title)).id }),
                appendEvent: async args => ({ task: await tasks.appendEvent(args.taskId, args.event) }),
                appendEvidence: async args => {
                        const appended = await ledger.append(args.taskId, {
                                kind: args.row.kind,
                                uri: args.row.uri,
                                sha256: args.row.sha256,
                                ...(args.row.note !== undefined ? { note: args.row.note } : {}),
                        });
                        await tasks.recordEvidence(args.taskId, {
                                evidenceId: appended.evidenceId,
                                seq: appended.seq,
                                kind: args.row.kind,
                                uri: args.row.uri,
                                sha256: args.row.sha256,
                                ...(args.row.note !== undefined ? { note: args.row.note } : {}),
                        });
                        return { evidenceId: appended.evidenceId, seq: appended.seq };
                },
        };
}

/** The dogfood lane preference policy (the harness authored it in this session; the switch act rewrites it). */
function dogfoodPolicy(preferredProviderId) {
        const userRule = {
                id: 'dogfood-lane-preference',
                description: 'Dogfood harness rule: prefer the currently selected provider lane (the switch act).',
                priority: 10,
                match: { enabledOnly: true },
                ranking: 'prefer-order',
                prefer: [preferredProviderId],
        };
        return { ...DEFAULT_ROUTING_POLICY, rules: [userRule, ...DEFAULT_ROUTING_POLICY.rules] };
}

function dogfoodModelDescriptor(modelId = 'dogfood-1') {
        return {
                modelId,
                modelName: 'Flauz Dogfood Model',
                family: 'dogfood',
                version: '1',
                contextWindowTokens: 32_000,
                maxOutputTokens: 4_096,
                inputModalities: ['text'],
                toolCalling: false,
        };
}

// ---------------------------------------------------------------------------
// The provider-lane facade (selectable lanes + the real fabric per ask)
// ---------------------------------------------------------------------------

function makeProviderFacade(seams) {
        const state = {
                switchNo: 0,
                currentLane: '',
                currentProviderId: '',
                currentModelId: '',
                adapter: undefined,
                router: undefined,
                currentTaskId: '',
                requestTimeoutMs: DEFAULT_WALL_CLOCK_BUDGET_MS,
        };

        /** P2-FIX-121: the ask request for the currently selected lane -- the LIVE lane carries the explicit completion budget; the fake lanes' request shape is UNCHANGED. */
        function askRequest(prompt) {
                return {
                        modelId: state.currentModelId,
                        messages: [{ role: 'user', content: [{ kind: 'text', value: prompt }] }],
                        // P2-FIX-121: the LIVE lane's explicit completion budget -- the
                        // neutral ChatRequest.maxOutputTokens surface the REAL openAiCompat
                        // adapter maps onto the wire body's `max_tokens` (the platform
                        // default ~4096 truncated the real exploration map mid-JSON). The
                        // fake/scripted lanes keep the W1 request shape exactly (no
                        // max_tokens field -- their wire behavior is the P2-FIX-121 baseline).
                        ...(state.currentLane === 'live' ? { maxOutputTokens: seams.liveMaxTokens } : {}),
                };
        }

        function laneConfiguration(lane, mode, providerPort) {
                if (lane === 'fake') {
                        return {
                                providerId: FAKE_PROVIDER_ID,
                                baseUrl: `http://127.0.0.1:${String(providerPort)}/v1`,
                                credentialRef: FAKE_CREDENTIAL_REF,
                                models: [dogfoodModelDescriptor()],
                        };
                }
                if (lane === 'scripted-failing') {
                        return {
                                providerId: FAILING_PROVIDER_ID,
                                baseUrl: `http://127.0.0.1:${String(providerPort)}/fail`,
                                credentialRef: FAILING_CREDENTIAL_REF,
                                models: [dogfoodModelDescriptor()],
                        };
                }
                if (lane === 'live') {
                        return {
                                providerId: LIVE_PROVIDER_ID,
                                baseUrl: LIVE_BASE_URL,
                                credentialRef: LIVE_CREDENTIAL_REF,
                                models: [dogfoodModelDescriptor(LIVE_MODEL)],
                        };
                }
                throw new Error(`${DRIVER_TAG}: unknown provider lane ${lane}`);
        }

        /** The full override list per switch: every lane stays configured; exactly the selected lane is enabled. */
        function overridesFor(lane, mode, providerPort) {
                const entries = [
                        { ...laneConfiguration('fake', mode, providerPort), enabled: lane === 'fake' },
                        { ...laneConfiguration('scripted-failing', mode, providerPort), enabled: lane === 'scripted-failing' },
                ];
                if (mode === 'live-provider') {
                        entries.push({ ...laneConfiguration('live', mode, providerPort), enabled: lane === 'live' });
                }
                return entries;
        }

        const secrets = {
                resolve: async ref => {
                        if (ref === FAKE_CREDENTIAL_REF || ref === FAILING_CREDENTIAL_REF) {
                                // a local-wire marker (fixture posture; the local server ignores it)
                                return 'dogfood-local-wire-marker';
                        }
                        if (ref === LIVE_CREDENTIAL_REF) {
                                return LIVE_API_KEY === '' ? undefined : LIVE_API_KEY;
                        }
                        return undefined;
                },
        };

        async function selectLane(lane) {
                const mode = seams.mode;
                const config = laneConfiguration(lane, mode, seams.providerPort);
                const overrides = overridesFor(lane, mode, seams.providerPort);
                await writeProviderOverrides(seams.fs, `${seams.root}/.flauz/models`, overrides, seams.clock());
                const policy = dogfoodPolicy(config.providerId);
                await saveRoutingPolicy(seams.fs, `${seams.root}/.flauz/models`, policy);

                const registry = new ModelCapabilityRegistry({ root: seams.root, fs: seams.fs, clock: seams.clock });
                await registry.load();
                const enabled = registry.list().filter(record => record.providerId.startsWith('flauz-dogfood') && record.enabled).map(record => record.providerId).sort();
                const router = new ModelRouter({ stateDir: `${seams.root}/.flauz/models`, fs: seams.fs, clock: seams.clock, records: () => registry.list(), policy });

                // the selection probe: the enablement act MUST select this lane (no silent fallback -- ever)
                const probe = await router.route({ purpose: 'dogfood-lane-selection', requirements: { enabledOnly: true } });
                if (probe.selected === null || probe.selected.providerId !== config.providerId) {
                        throw new Error(`${DRIVER_TAG}: lane selection FAILED CLOSED -- the routing decision ${probe.decisionId} selected ${JSON.stringify(probe.selected)} instead of ${config.providerId} (${probe.explanation})`);
                }

                // the evidence row minted per switch (hash-pinning the providers file of this act)
                const providersText = await seams.fs.readFileUtf8(`${seams.root}/.flauz/models/providers.json`);
                const providersSha = sha256Hex(providersText ?? '');
                const appended = await seams.ledger.append(state.currentTaskId, {
                        kind: 'note',
                        uri: '.flauz/models/providers.json',
                        sha256: providersSha,
                        note: `dogfood provider lane switch ${String(state.switchNo + 1)}: ${lane} (enablement act; routing decision ${probe.decisionId} selected ${config.providerId})`,
                });
                await seams.tasks.recordEvidence(state.currentTaskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri: '.flauz/models/providers.json', sha256: providersSha, note: `dogfood provider lane switch ${String(state.switchNo + 1)}: ${lane}` });

                state.switchNo += 1;
                state.currentLane = lane;
                state.currentProviderId = config.providerId;
                state.currentModelId = config.models[0].modelId;
                state.router = router;
                state.requestTimeoutMs = seams.wallClockBudgetMs;
                state.adapter = createOpenAiCompatAdapter({
                        config: {
                                providerId: config.providerId,
                                vendor: 'flauz-dogfood',
                                displayName: `Flauz Dogfood (${lane})`,
                                baseUrl: config.baseUrl,
                                credentialRef: config.credentialRef,
                                models: config.models,
                                // P2-FIX-117: the ask wall-clock budget, wired through the
                                // product's existing budget surface (AdapterConfig.requestTimeoutMs);
                                // the typed TIMEOUT + bounded-retry semantics are the product's own.
                                requestTimeoutMs: seams.wallClockBudgetMs,
                        },
                        http: nodeHttpPort,
                        secrets,
                        hash: nodeHashPort,
                        clock: () => Date.now(),
                });
                return {
                        switchNo: state.switchNo,
                        lane,
                        providerId: config.providerId,
                        enabledLanes: enabled,
                        providersFileSha256: providersSha,
                        evidenceId: appended.evidenceId,
                        seq: appended.seq,
                        at: seams.clock(),
                };
        }

        async function ask(input) {
                if (state.adapter === undefined || state.router === undefined) {
                        // the session's default provider lane materializes on first use (the
                        // product's own materialize-on-first-use pattern; the healthy lane of
                        // the mode -- fake in the W1 sandbox, live at the station)
                        const defaultLane = seams.mode === 'live-provider' ? 'live' : 'fake';
                        log(`materializing the session default provider lane (${defaultLane}) on first use`);
                        await selectLane(defaultLane);
                }
                const startedAt = Date.now();
                const decision = await state.router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
                if (decision.selected === null || decision.selected.providerId !== state.currentProviderId) {
                        throw new Error(`${DRIVER_TAG}: the routing decision ${decision.decisionId} drifted off the selected lane ${state.currentProviderId} (${decision.explanation})`);
                }
                // P2-FIX-119: a prompt BUILDER runs at ask time -- after the ask's own
                // durable routing decision (so the embedded workspace facts include it)
                // and right before the request ships. Literal prompts are unchanged.
                const prompt = typeof input === 'function' ? await input({ decisionId: decision.decisionId }) : input;
                const maxAttempts = resolveProviderRetryBound(null);
                let attempts = 0;
                for (;;) {
                        attempts += 1;
                        try {
                                // P2-FIX-121: the stream is consumed through the shared
                                // ask-stream consumer -- the joined text PLUS the terminal
                                // finish event's reason (the surface the W1 loop dropped;
                                // a `length` finish is a VISIBLE truncation in the receipts).
                                const consumed = await consumeAskStream(state.adapter.stream(askRequest(prompt)));
                                return {
                                        kind: 'ok',
                                        text: consumed.text,
                                        decisionId: decision.decisionId,
                                        providerId: state.currentProviderId,
                                        modelId: state.currentModelId,
                                        durationMs: Date.now() - startedAt,
                                        attempts,
                                        wallClockBudgetMs: state.requestTimeoutMs,
                                        finishReason: consumed.finishReason,
                                };
                        } catch (err) {
                                if (isProviderError(err)) {
                                        if (err.retryable && attempts < maxAttempts) {
                                                // the product's bounded-retry bound (re-attempts are immediate; no backoff sleeps in the harness window)
                                                continue;
                                        }
                                        return {
                                                kind: 'provider-failure',
                                                code: err.code,
                                                retryable: err.retryable,
                                                retryClass: err.retryClass,
                                                status: err.status,
                                                retryAfterMs: err.retryAfterMs,
                                                message: err.message,
                                                decisionId: decision.decisionId,
                                                providerId: state.currentProviderId,
                                                modelId: state.currentModelId,
                                                durationMs: Date.now() - startedAt,
                                                attempts,
                                                wallClockBudgetMs: state.requestTimeoutMs,
                                        };
                                }
                                throw err;
                        }
                }
        }

        return {
                selectLane,
                ask,
                setCurrentTask: taskId => {
                        state.currentTaskId = taskId;
                },
                get switchCount() {
                        return state.switchNo;
                },
        };
}

// ---------------------------------------------------------------------------
// The exercise runner (task envelope -> session -> step -> receipt)
// ---------------------------------------------------------------------------

async function writeJson(target, value) {
        await nodeFsPromises.mkdir(nodePath.dirname(target), { recursive: true });
        await nodeFsPromises.writeFile(target, `${JSON.stringify(value, null, '\t')}\n`, { encoding: 'utf-8' });
}

async function runExercise(exercise, seams, provider, outDir) {
        log(`exercise ${exercise.id}: minting the task envelope (submitGraph + approveGraph)`);
        const submitted = await seams.store.submitGraph({
                title: `dogfood: ${exercise.title}`,
                steps: [{ stepId: STEP_ID, title: exercise.title, instruction: exercise.prompt }],
                actor: 'agent',
                origin: `dogfood:${WO_ID}`,
        });
        const graphId = submitted.graphId;
        const taskId = submitted.taskId ?? '';
        await seams.store.approveGraph({ graphId, actor: 'human', origin: `dogfood:${WO_ID}` });

        log(`exercise ${exercise.id}: opening the agent session (claim + session-tier memory) on ${taskId}`);
        await seams.store.acquireClaim({ graphId, stepId: STEP_ID, holder: PRIMARY, actor: 'agent', origin: 'dogfood:session' });
        await seams.memory.record('session', {
                kind: 'observation',
                content: `dogfood session opened on ${taskId} by ${PRIMARY} (exercise ${exercise.id}, run ${seams.runId})`,
                taskId,
                agentId: PRIMARY,
                provenance: { actor: 'agent', origin: 'task-event', ts: seams.clock() },
        });

        const friction = new FrictionLog({ path: nodePath.join(outDir, `${exercise.id}.friction.jsonl`) });
        const start = await seams.store.startStep({ graphId, stepId: STEP_ID, runnerId: PRIMARY, actor: 'agent', origin: `dogfood:${WO_ID}` });
        provider.setCurrentTask(taskId);

        const harness = {
                runId: seams.runId,
                mode: seams.mode,
                root: seams.root,
                repoRoot: seams.repoRoot,
                recordsDir: outDir,
                clock: seams.clock,
                friction,
                tasks: seams.tasks,
                ledger: seams.ledger,
                memory: seams.memory,
                store: seams.store,
                provider,
                exerciseId: exercise.id,
                taskId,
                graphId,
                stepId: STEP_ID,
                log: line => {
                        log(`exercise ${exercise.id}: ${line}`);
                },
        };

        let receipt;
        try {
                receipt = await exercise.run(harness);
        } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                log(`exercise ${exercise.id}: MACHINERY FAILURE -- ${message}`);
                await friction.friction({ phase: `machinery:${exercise.id}`, kind: 'failed-task', detail: `the exercise machinery failed: ${message}`, recovery: '' });
                receipt = {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: exercise.id,
                        title: exercise.title,
                        dimensions: exercise.dimensions,
                        verdict: 'FAIL',
                        checks: [{ id: 'machinery', ok: false, detail: `the exercise machinery failed: ${message}` }],
                        evidenceIds: [],
                        evidenceItems: [],
                        frictionLogPath: friction.path,
                        frictionRows: { friction: 1, timing: 0, recovery: 0 },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes: [`machinery failure: ${message}`],
                };
        }

        // the step transition carries one summary evidence row (the journey's
        // effect-row pattern); the artifact rows were minted by the exercise itself
        const receiptJson = JSON.stringify(receipt);
        await seams.store.finishStep({
                graphId,
                stepId: STEP_ID,
                attempt: start.attempt,
                outcome: receipt.verdict === 'PASS' ? 'succeeded' : 'failed',
                output: `${exercise.id}: ${receipt.verdict}`,
                evidence: [{ kind: 'note', uri: `flauz-dogfood-receipt://${exercise.id}`, sha256: sha256Hex(receiptJson) }],
                actor: 'agent',
                origin: `dogfood:${WO_ID}`,
        });
        await seams.store.releaseClaim({ graphId, stepId: STEP_ID, actor: 'agent', origin: 'dogfood:session-close' });
        if (receipt.verdict === 'PASS') {
                await seams.store.completeGraph({ graphId, actor: 'agent', origin: `dogfood:${WO_ID}` });
        } else {
                await seams.store.failGraph({ graphId, failedStepId: STEP_ID, actor: 'agent', origin: `dogfood:${WO_ID}` });
        }

        await writeJson(nodePath.join(outDir, `${exercise.id}.receipt.json`), receipt);
        log(`exercise ${exercise.id}: ${receipt.verdict} (${String(receipt.checks.filter(check => check.ok).length)}/${String(receipt.checks.length)} checks; friction log ${friction.path})`);
        return receipt;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function resolveMode() {
        const present = {
                baseUrl: LIVE_BASE_URL !== '',
                apiKey: LIVE_API_KEY !== '',
                model: LIVE_MODEL !== '',
        };
        const values = Object.values(present);
        if (values.every(Boolean)) {
                return 'live-provider';
        }
        if (values.some(Boolean)) {
                const missing = Object.entries(present).filter(([, ok]) => !ok).map(([name]) => `FLAUZ_LIVE_PROVIDER_${name === 'baseUrl' ? 'BASE_URL' : name === 'apiKey' ? 'API_KEY' : 'MODEL'}`).join(', ');
                console.error(`${DRIVER_TAG}: FAIL-CLOSED -- the live-provider env contract is partially present; missing: ${missing}`);
                console.error(`${DRIVER_TAG}: the harness never silently falls back to the fake lane (the credential-free law); set all three or none`);
                process.exit(2);
        }
        return 'fake-lane';
}

/**
 * P2-FIX-117: resolves the ask wall-clock budget from the env-only knob
 * (FLAUZ_DOGFOOD_WALL_CLOCK_BUDGET_MS). Absent -> the default (15_000 ms,
 * the W1 behavior unchanged for the fake lanes). Present but malformed ->
 * FAIL CLOSED (exit 2, the harness's env-contract discipline).
 */
function resolveWallClockBudget() {
        const raw = process.env[WALL_CLOCK_BUDGET_ENV] ?? '';
        if (raw === '') {
                return { ms: DEFAULT_WALL_CLOCK_BUDGET_MS, source: 'default' };
        }
        if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
                console.error(`${DRIVER_TAG}: FAIL-CLOSED -- ${WALL_CLOCK_BUDGET_ENV} must be a positive integer of milliseconds (got ${JSON.stringify(raw)})`);
                process.exit(2);
        }
        return { ms: Number(raw), source: 'env' };
}

/**
 * P2-FIX-121: resolves the live lane's completion budget from the env-only
 * knob (FLAUZ_DOGFOOD_LIVE_MAX_TOKENS; the pure parser lives in
 * liveBudget.mjs -- the single source the tests pin). Absent -> the
 * generous default (32_768 tokens). Present but malformed -> FAIL CLOSED
 * (exit 2, the same env-contract discipline as P2-FIX-117).
 */
function resolveLiveMaxTokens() {
        const parsed = parseLiveMaxTokens(process.env[LIVE_MAX_TOKENS_ENV] ?? '');
        if (!parsed.ok) {
                console.error(`${DRIVER_TAG}: FAIL-CLOSED -- ${parsed.error}`);
                process.exit(2);
        }
        return parsed;
}

async function main() {
        const args = process.argv.slice(2);
        const argMap = new Map();
        for (let index = 0; index + 1 < args.length; index += 2) {
                argMap.set(args[index], args[index + 1]);
        }
        if (args.some(arg => arg.startsWith('--') && !argMap.has(arg))) {
                console.error(`${DRIVER_TAG}: unknown or valueless argument(s): ${args.join(' ')}`);
                console.error(`usage: node --experimental-strip-types build/flauz/dogfood/dogfood-driver.mjs [--repo <dir>] [--out <dir>] [--exercise <id>]`);
                process.exit(2);
        }

        const repoRoot = nodePath.resolve(argMap.get('--repo') ?? repoRootFromHere());
        const mode = resolveMode();
        const wallClockBudget = resolveWallClockBudget();
        const liveMaxTokens = resolveLiveMaxTokens();
        const runId = `dogfood-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const root = await nodeFsPromises.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-dogfood-'));
        const outDir = nodePath.resolve(argMap.get('--out') ?? nodePath.join(root, '.flauz', 'dogfood-records'));
        await nodeFsPromises.mkdir(outDir, { recursive: true });

        const exercises = [EXPLORE_EXERCISE, PROVIDER_SWITCH_EXERCISE, BROWSER_POLICY_EXERCISE, AGENT_DELEGATION_EXERCISE, TOOLS_EXPLORATION_EXERCISE];
        const only = argMap.get('--exercise');
        if (only !== undefined) {
                const selected = exercises.filter(exercise => exercise.id === only);
                if (selected.length === 0) {
                        console.error(`${DRIVER_TAG}: no such exercise '${only}' (known: ${exercises.map(exercise => exercise.id).join(', ')})`);
                        process.exit(2);
                }
                exercises.length = 0;
                exercises.push(...selected);
        }

        log(`mode=${mode} (model intelligence: ${mode === 'live-provider' ? 'live-provider (the env contract)' : 'fixture (the fake/scripted lane -- claimed at fixture level, never promoted)'})`);
        log(`ask wall-clock budget ${String(wallClockBudget.ms)} ms (${wallClockBudget.source === 'env' ? `env:${WALL_CLOCK_BUDGET_ENV}` : `default; ${WALL_CLOCK_BUDGET_ENV} absent`}) wired through AdapterConfig.requestTimeoutMs (P2-FIX-117; the typed TIMEOUT + bounded-retry semantics unchanged)`);
        log(`live-lane completion budget ${String(liveMaxTokens.tokens)} tokens (${liveMaxTokens.source === 'env' ? `env:${LIVE_MAX_TOKENS_ENV}` : `default; ${LIVE_MAX_TOKENS_ENV} absent`}) wired through ChatRequest.maxOutputTokens -> the openAiCompat wire body max_tokens (P2-FIX-121; the fake lanes' request shape unchanged)`);
        if (liveMaxTokens.source === 'env' && mode !== 'live-provider') {
                log(`note: ${LIVE_MAX_TOKENS_ENV} is set but this run selects no live lane (mode=${mode}); the completion budget lands on live-lane ask requests only`);
        }
        log(`workspace root ${root}; repo ${repoRoot}; records ${outDir}`);

        const fakeProvider = await startFakeProvider({ repoRoot, workspaceRoot: root });
        log(`local provider lanes on 127.0.0.1:${String(fakeProvider.port)} (fake: /v1, scripted-failing: /fail)`);

        const startedAt = Date.now();
        const fs = runtimeFsPort();
        const clock = steppingClock(1_760_000_000_000);
        const tasks = new TaskService({ root, fs, clock });
        const ledger = new EvidenceLedger({
                root,
                fs,
                clock,
                signer: createEd25519Signer(
                        'flauz-fixture-ed25519-1',
                        nodeFs.readFileSync(nodePath.join(repoRoot, 'test', 'fixtures', 'workflow', 'keys', 'ed25519-private.pem'), { encoding: 'utf-8' }),
                        nodeFs.readFileSync(nodePath.join(repoRoot, 'test', 'fixtures', 'workflow', 'keys', 'ed25519-public.pem'), { encoding: 'utf-8' }),
                ),
                checkpointInterval: 0,
        });
        const memory = new MemoryStore({ root, fs, clock });
        await tasks.bootstrap();
        await ledger.ensure();
        await memory.ensure();
        const store = new OrchestrationStore(root, { clock, taskPort: dogfoodTaskPort(tasks, ledger) });

        const seams = {
                runId,
                mode,
                root,
                repoRoot,
                fs,
                clock,
                tasks,
                ledger,
                memory,
                store,
                providerPort: fakeProvider.port,
                wallClockBudgetMs: wallClockBudget.ms,
                liveMaxTokens: liveMaxTokens.tokens,
        };
        const provider = makeProviderFacade(seams);

        const receipts = [];
        try {
                for (const exercise of exercises) {
                        receipts.push(await runExercise(exercise, seams, provider, outDir));
                }
        } finally {
                fakeProvider.close();
        }

        const durationMs = Date.now() - startedAt;
        const summary = {
                schema: RUN_SCHEMA,
                wo: WO_ID,
                runId,
                mode,
                modelIntelligence: mode === 'live-provider' ? 'live-provider' : 'fixture (the fake/scripted lanes; never wording-promoted)',
                startedAt: new Date(startedAt).toISOString(),
                durationMs,
                wallClockBudget: {
                        configuredMs: wallClockBudget.ms,
                        defaultMs: DEFAULT_WALL_CLOCK_BUDGET_MS,
                        source: wallClockBudget.source === 'env' ? `env:${WALL_CLOCK_BUDGET_ENV}` : 'default',
                        wiredThrough: 'AdapterConfig.requestTimeoutMs (the product request wall-clock budget surface; the typed TIMEOUT + bounded-retry semantics unchanged)',
                },
                liveCompletionBudget: {
                        configuredTokens: liveMaxTokens.tokens,
                        defaultTokens: DEFAULT_LIVE_MAX_TOKENS,
                        source: liveMaxTokens.source === 'env' ? `env:${LIVE_MAX_TOKENS_ENV}` : 'default',
                        wiredThrough: 'ChatRequest.maxOutputTokens -> the openAiCompat adapter wire body max_tokens (the LIVE lane\'s ask requests only; the fake lanes\' request shape unchanged)',
                },
                workspaceRoot: root,
                repoRoot,
                recordsDir: outDir,
                exercises: receipts.map(receipt => ({
                        exerciseId: receipt.exerciseId,
                        title: receipt.title,
                        dimensions: receipt.dimensions,
                        verdict: receipt.verdict,
                        assertions: { pass: receipt.checks.filter(check => check.ok).length, fail: receipt.checks.filter(check => !check.ok).length },
                        evidenceIds: receipt.evidenceIds,
                        frictionLogPath: receipt.frictionLogPath,
                        frictionRows: receipt.frictionRows,
                        evidenceLevels: receipt.evidenceLevels,
                        notes: receipt.notes,
                })),
                localLaneCensus: {
                        chatCalls: fakeProvider.chatCalls,
                        failCalls: fakeProvider.failCalls,
                        exploreComputations: fakeProvider.exploreComputations,
                        configPromptReads: fakeProvider.configPromptReads,
                        toolsComputations: fakeProvider.toolsComputations,
                        note: 'the local wire census (the live lane, when selected, talks to the vendor directly and never appears here); the provider-configuration answers are read from the prompt-carried workspace facts (P2-FIX-119: the server-side computation path is retired for that question)',
                },
        };
        await writeJson(nodePath.join(outDir, 'run-summary.json'), summary);

        for (const receipt of receipts) {
                log(`receipt ${receipt.exerciseId}: ${receipt.verdict} -- ${String(receipt.checks.filter(check => check.ok).length)}/${String(receipt.checks.length)} checks, friction ${String(receipt.frictionRows.friction)}/timing ${String(receipt.frictionRows.timing)}/recovery ${String(receipt.frictionRows.recovery)}`);
                for (const check of receipt.checks.filter(entry => !entry.ok)) {
                        console.error(`${DRIVER_TAG}: FAIL ${receipt.exerciseId}.${check.id} -- ${check.detail}`);
                }
        }
        log(`run summary ${nodePath.join(outDir, 'run-summary.json')} (${String(durationMs)} ms, ${String(provider.switchCount)} lane switch(es))`);

        const failing = receipts.filter(receipt => receipt.verdict !== 'PASS').length;
        if (failing > 0) {
                log(`RUN FAIL (${String(failing)} exercise(s) failed)`);
                process.exit(1);
        }
        log('RUN GREEN (both machinery and every exercise verdict PASS)');
        process.exit(0);
}

main().catch(err => {
        console.error(`${DRIVER_TAG}: FAIL machinery -- ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof Error && err.stack !== undefined) {
                console.error(err.stack);
        }
        process.exit(1);
});
