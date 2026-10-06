/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W8 (dogfood harness) -- EXERCISE 5: the environments
 * lifecycle lane (the deeper-dogfood dimension: environments lifecycle).
 *
 * The scenario machinery drives the REAL flauz-environments lifecycle
 * seams (the localProcess.test.ts canonical wiring -- the leg-1 lesson:
 * the product's own call sites were read before choosing any shape):
 *
 *   - the REAL EnvironmentRegistry (register/bootstrap) on a dedicated
 *     mkdtemp session root, injected clock, fixed env ids;
 *   - the REAL LocalProcessExecutor (the LOCAL-REAL executor,
 *     workspace-remote / local-loopback posture) spawning the FIXED
 *     harness `extensions/flauz-environments/fixtures/env-agent.ts`
 *     -- the ONLY sanctioned executable (descriptor-supplied execution
 *     is forbidden; the executor constructs every argument itself) --
 *     through the REAL node process port: a REAL child process with the
 *     stdio ready-line handshake, a real state.json beat file, graceful
 *     SIGTERM shutdown, real SIGKILL escalation window;
 *   - the REAL EnvironmentLifecycleManager (the provenance law, the
 *     typed state machine, the fail-closed trust gate, the PIN-2
 *     persistence) over the REAL LifecycleStore:
 *     `.flauz/environments-lifecycle.json` +
 *     `.flauz/environments-ops.jsonl` (the sibling envelopes).
 *
 * THE SCENARIO (deterministic: injected clock, fixed ids, no network):
 *   1. register a workspace-remote environment; create -> start (the
 *      env-agent harness: a REAL child process with the ready-line
 *      handshake) -> attach -> snapshot (the real sha256 manifest) ->
 *      stop -> destroy; the typed state machine asserted at EVERY step
 *      (registered -> created -> starting -> running <-> stopping ->
 *      stopped -> destroyed; the /attached connection substate);
 *   2. failure legs: one ILLEGAL TRANSITION (stop on a destroyed id --
 *      the typed ledger-recorded rejection) and the fail-closed TRUST
 *      GATE (an untrusted-posture environment: start rejected with
 *      TRUST_POSTURE_REJECTED, the message names the posture);
 *   3. the ops ledger asserted append-only (one canonical row per op,
 *      provenance actor recorded) + the PIN-2 envelope shape (the exact
 *      entry key set {state, updatedAt, executorKind, lastOpRef}, the
 *      lastOpRef bootstrap invariant).
 *
 * THE ASK (P2-FIX-119 doctrine): the exercise carries the scripted
 * op-sequence facts IN the prompt (computed at ask time from the REAL
 * manager state -- the ops ledger rows verbatim + the executor kind) and
 * asks the model to report the final state per environment, the
 * ops-ledger census, and the failure-leg verdicts. BOTH lanes answer
 * from the prompt-carried facts.
 *
 * THE INDEPENDENT VERIFIER (the dogfood law): the ground truth is
 * re-derived from the REAL manager's entries()/ops() outputs (never the
 * prompt, never the ask lane) and verifyEnvironmentsLifecycleAnswer
 * checks the model's answer 100% (sound + complete). PASS only at 100%.
 *
 * Evidence label: local-real (a REAL child process, REAL fs state) for
 * the seams; fixture for the model intelligence -- stated in the receipt
 * notes, never promoted by wording.
 *
 * Dogfood dimensions exercised: environments lifecycle, typed state
 * machine legality, failure/recovery, artifacts/evidence, slow-path
 * timing.
 */

import { spawn } from 'node:child_process';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import { answerParseFailDetail } from '../liveBudget.mjs';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem, AskOutcome } from '../harnessTypes.ts';

import { EnvironmentRegistry } from '../../../../extensions/flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager } from '../../../../extensions/flauz-environments/src/lifecycle/manager.ts';
import { LocalProcessExecutor, type ChildHandle, type HashPort, type LocalEnvFsPort, type ProcessPort } from '../../../../extensions/flauz-environments/src/lifecycle/localProcess.ts';
import {
        LIFECYCLE_PATH,
        LIFECYCLE_SCHEMA_ID,
        LIFECYCLE_SCHEMA_VERSION,
        OPS_PATH,
        OPS_SCHEMA_ID,
        type DescribeReport,
        type EnvironmentOpRecord,
        type LifecycleEntry,
        type LifecycleEnvelope,
} from '../../../../extensions/flauz-environments/src/lifecycle/types.ts';

/** The answer document's pinned schema id. */
export const ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA = 'flauz.dogfood-environments-lifecycle-answer/v1';

// ---------------------------------------------------------------------------
// The fixture scenario (deterministic: fixed ids, injected clock)
// ---------------------------------------------------------------------------

/** The fixed environment ids (registry-shaped env-<slug>, deterministic). */
export const LIFECYCLE_MAIN_ENV_ID = 'env-dogfood-w8-main';
export const LIFECYCLE_UNTRUSTED_ENV_ID = 'env-dogfood-w8-untrusted';

/** The fixture registration inputs (the workspaceRemoteRegistrationInput canonical shape). */
export function lifecycleMainRegistration(): Record<string, unknown> {
        return {
                id: LIFECYCLE_MAIN_ENV_ID,
                kind: 'workspace-remote',
                label: 'Dogfood W8 Main Remote',
                connection: { authorityPrefix: 'flauz-local' },
                trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
                capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
                enabled: true,
        };
}

export function lifecycleUntrustedRegistration(): Record<string, unknown> {
        return {
                id: LIFECYCLE_UNTRUSTED_ENV_ID,
                kind: 'workspace-remote',
                label: 'Dogfood W8 Untrusted Remote',
                connection: { authorityPrefix: 'flauz-local' },
                trust: { posture: 'untrusted', inheritsWorkspaceTrust: false },
                capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
                enabled: true,
        };
}

/** The pinned happy-path state chain of the main environment (the state machine, asserted at every step). */
export const MAIN_STATE_CHAIN: readonly string[] = ['registered', 'created', 'running', 'running/attached', 'running/attached', 'stopped', 'destroyed'];

// ---------------------------------------------------------------------------
// The answer contract (checked, never trusted)
// ---------------------------------------------------------------------------

/** One scripted failure leg's verdict as the answer reports it. */
export interface EnvironmentsLifecycleFailureLeg {
        readonly leg: string;
        readonly verdict: 'illegal' | 'rejected';
        readonly code: string;
}

export interface EnvironmentsLifecycleAnswer {
        readonly schema: string;
        readonly environments: Readonly<Record<string, string>>;
        readonly opsLedger: { readonly rows: number; readonly kinds: Readonly<Record<string, number>> };
        readonly failureLegs: readonly EnvironmentsLifecycleFailureLeg[];
}

export type ParseEnvironmentsLifecycleOutcome =
        | { readonly ok: true; readonly answer: EnvironmentsLifecycleAnswer; readonly fenceStripped: boolean }
        | { readonly ok: false; readonly error: string };

/** Parses the environments-lifecycle answer document (fence-tolerant on the LIVE lanes, per P2-FIX-118). */
export function parseEnvironmentsLifecycleAnswer(text: string, options?: AnswerParseOptions): ParseEnvironmentsLifecycleOutcome {
        const strip = fenceTolerantParseBody(text, options);
        let parsed: unknown;
        try {
                parsed = JSON.parse(strip.body);
        } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                return { ok: false, error: strip.fenced ? `the completion is not valid JSON inside the stripped markdown fence: ${reason}` : `the completion is not valid JSON: ${reason}` };
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { ok: false, error: 'the answer document is not a JSON object' };
        }
        const record = parsed as Record<string, unknown>;
        if (record.schema !== ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA) {
                return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA)} was expected` };
        }
        if (record.environments === null || typeof record.environments !== 'object' || Array.isArray(record.environments)) {
                return { ok: false, error: 'the answer field "environments" must be a JSON object (environment id -> final state)' };
        }
        const environments: Record<string, string> = {};
        for (const [envId, state] of Object.entries(record.environments)) {
                if (typeof state !== 'string' || state.length === 0) {
                        return { ok: false, error: `environments entry ${envId}: the final state must be a non-empty string (got ${JSON.stringify(state)})` };
                }
                environments[envId] = state;
        }
        const opsLedger = record.opsLedger;
        if (opsLedger === null || typeof opsLedger !== 'object' || Array.isArray(opsLedger)) {
                return { ok: false, error: 'the answer field "opsLedger" must be a JSON object { rows, kinds }' };
        }
        const ledger = opsLedger as Record<string, unknown>;
        if (typeof ledger.rows !== 'number' || !Number.isInteger(ledger.rows) || ledger.rows < 0) {
                return { ok: false, error: 'the answer field "opsLedger.rows" must be a non-negative integer' };
        }
        if (ledger.kinds === null || typeof ledger.kinds !== 'object' || Array.isArray(ledger.kinds)) {
                return { ok: false, error: 'the answer field "opsLedger.kinds" must be a JSON object (op -> count)' };
        }
        const kinds: Record<string, number> = {};
        for (const [op, count] of Object.entries(ledger.kinds)) {
                if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
                        return { ok: false, error: `opsLedger.kinds entry ${op}: the count must be a positive integer (got ${JSON.stringify(count)})` };
                }
                kinds[op] = count;
        }
        if (!Array.isArray(record.failureLegs)) {
                return { ok: false, error: 'the answer field "failureLegs" must be an array' };
        }
        const failureLegs: EnvironmentsLifecycleFailureLeg[] = [];
        for (const entry of record.failureLegs) {
                if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
                        return { ok: false, error: 'each failureLegs entry must be a JSON object' };
                }
                const leg = entry as Record<string, unknown>;
                if (typeof leg.leg !== 'string' || leg.leg.length === 0) {
                        return { ok: false, error: 'a failureLegs entry is missing a non-empty string "leg"' };
                }
                if (leg.verdict !== 'illegal' && leg.verdict !== 'rejected') {
                        return { ok: false, error: `failureLegs entry ${JSON.stringify(leg.leg)}: "verdict" must be "illegal" or "rejected" (got ${JSON.stringify(leg.verdict)})` };
                }
                if (typeof leg.code !== 'string' || leg.code.length === 0) {
                        return { ok: false, error: `failureLegs entry ${JSON.stringify(leg.leg)}: "code" must be a non-empty string` };
                }
                failureLegs.push({ leg: leg.leg, verdict: leg.verdict, code: leg.code });
        }
        return {
                ok: true,
                answer: { schema: ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA, environments, opsLedger: { rows: ledger.rows as number, kinds }, failureLegs },
                fenceStripped: strip.fenced,
        };
}

// ---------------------------------------------------------------------------
// The INDEPENDENT ground-truth derivation (driver-side, from the REAL manager state)
// ---------------------------------------------------------------------------

export interface EnvironmentsLifecycleGroundTruth {
        readonly environments: Readonly<Record<string, string>>;
        readonly opsRows: number;
        readonly opsKinds: Readonly<Record<string, number>>;
        readonly failureLegs: readonly EnvironmentsLifecycleFailureLeg[];
}

/**
 * Re-derives the ground truth from the REAL manager's entries()/ops()
 * outputs (never the scenario's cached verdicts, never the prompt, never
 * the ask lane). Failure legs are keyed by their typed error code:
 * TRUST_POSTURE_REJECTED -> `untrusted-<op>` (verdict rejected);
 * everything else -> `illegal-<op>` (verdict illegal).
 */
export function deriveEnvironmentsLifecycleGroundTruth(
        entries: Readonly<Record<string, LifecycleEntry>>,
        ops: readonly EnvironmentOpRecord[],
): EnvironmentsLifecycleGroundTruth {
        const environments: Record<string, string> = {};
        for (const [envId, entry] of Object.entries(entries)) {
                environments[envId] = entry.state;
        }
        const kinds: Record<string, number> = {};
        for (const record of ops) {
                kinds[record.op] = (kinds[record.op] ?? 0) + 1;
        }
        const failureLegs: EnvironmentsLifecycleFailureLeg[] = [];
        for (const record of ops) {
                if (record.result === 'error' && record.error !== undefined) {
                        const rejected = record.error.code === 'TRUST_POSTURE_REJECTED';
                        failureLegs.push({
                                leg: rejected ? `untrusted-${record.op}` : `illegal-${record.op}`,
                                verdict: rejected ? 'rejected' : 'illegal',
                                code: record.error.code,
                        });
                }
        }
        failureLegs.sort((a, b) => (a.leg < b.leg ? -1 : a.leg > b.leg ? 1 : 0));
        return { environments, opsRows: ops.length, opsKinds: kinds, failureLegs };
}

export type EnvironmentsLifecycleVerificationOutcome = { readonly ok: boolean; readonly problems: readonly string[]; readonly soundnessViolations: number; readonly completenessViolations: number };

/**
 * Checks the model's answer against the derived ground truth, 100%:
 * soundness = every claimed entry matches ground truth; completeness =
 * every ground-truth entry is claimed. PASS only when both are 100%.
 */
export function verifyEnvironmentsLifecycleAnswer(answer: EnvironmentsLifecycleAnswer, groundTruth: EnvironmentsLifecycleGroundTruth): EnvironmentsLifecycleVerificationOutcome {
        const problems: string[] = [];
        let soundnessViolations = 0;
        let completenessViolations = 0;
        const claimedIds = Object.keys(answer.environments);
        const truthIds = Object.keys(groundTruth.environments);
        if (claimedIds.length !== truthIds.length || truthIds.some(id => !claimedIds.includes(id))) {
                completenessViolations += 1;
                problems.push(`environments: claimed ${JSON.stringify([...claimedIds].sort())} but the lifecycle envelope carries ${JSON.stringify([...truthIds].sort())}`);
        }
        for (const [envId, state] of Object.entries(groundTruth.environments)) {
                const claimed = answer.environments[envId];
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`environments ${envId}: MISSING from the answer (ground truth: ${state})`);
                        continue;
                }
                if (claimed !== state) {
                        soundnessViolations += 1;
                        problems.push(`environments ${envId}: final state claimed ${claimed} but the real envelope says ${state}`);
                }
        }
        for (const envId of claimedIds) {
                if (groundTruth.environments[envId] === undefined) {
                        soundnessViolations += 1;
                        problems.push(`environments ${envId}: FABRICATED entry (no such lifecycle entry)`);
                }
        }
        if (answer.opsLedger.rows !== groundTruth.opsRows) {
                soundnessViolations += 1;
                problems.push(`opsLedger.rows claimed ${String(answer.opsLedger.rows)} but the ops ledger carries ${String(groundTruth.opsRows)} line(s)`);
        }
        const claimedKinds = Object.keys(answer.opsLedger.kinds);
        const truthKinds = Object.keys(groundTruth.opsKinds);
        if (claimedKinds.length !== truthKinds.length || truthKinds.some(kind => !claimedKinds.includes(kind))) {
                completenessViolations += 1;
                problems.push(`opsLedger.kinds: claimed the ops ${JSON.stringify([...claimedKinds].sort())} but the ledger census is ${JSON.stringify([...truthKinds].sort())}`);
        }
        for (const [kind, count] of Object.entries(groundTruth.opsKinds)) {
                const claimed = answer.opsLedger.kinds[kind];
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`opsLedger.kinds ${kind}: MISSING from the answer (ground truth: ${String(count)})`);
                        continue;
                }
                if (claimed !== count) {
                        soundnessViolations += 1;
                        problems.push(`opsLedger.kinds ${kind}: claimed ${String(claimed)} row(s) but the ledger census says ${String(count)}`);
                }
        }
        for (const kind of claimedKinds) {
                if (groundTruth.opsKinds[kind] === undefined) {
                        soundnessViolations += 1;
                        problems.push(`opsLedger.kinds ${kind}: FABRICATED census entry (no such op row in the ledger)`);
                }
        }
        if (answer.failureLegs.length !== groundTruth.failureLegs.length) {
                completenessViolations += 1;
                problems.push(`failureLegs: claimed ${String(answer.failureLegs.length)} leg(s) but the ledger error rows derive ${String(groundTruth.failureLegs.length)}`);
        }
        for (const truth of groundTruth.failureLegs) {
                const claimed = answer.failureLegs.find(leg => leg.leg === truth.leg);
                if (claimed === undefined) {
                        completenessViolations += 1;
                        problems.push(`failureLegs ${truth.leg}: MISSING from the answer (ground truth: ${truth.verdict}/${truth.code})`);
                        continue;
                }
                if (claimed.verdict !== truth.verdict || claimed.code !== truth.code) {
                        soundnessViolations += 1;
                        problems.push(`failureLegs ${truth.leg}: claimed ${claimed.verdict}/${claimed.code} but the ledger error row says ${truth.verdict}/${truth.code}`);
                }
        }
        for (const claimed of answer.failureLegs) {
                if (!groundTruth.failureLegs.some(truth => truth.leg === claimed.leg)) {
                        soundnessViolations += 1;
                        problems.push(`failureLegs ${claimed.leg}: FABRICATED entry (no such ledger error row)`);
                }
        }
        return { ok: problems.length === 0, problems, soundnessViolations, completenessViolations };
}

// ---------------------------------------------------------------------------
// The prompt (P2-FIX-119: the op-sequence facts carried IN the ask, at ask time)
// ---------------------------------------------------------------------------

export const ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN = '=== ENVIRONMENT-LIFECYCLE FACT: the scripted op sequence, computed at ask time from the real manager state (the ops ledger rows verbatim + the executor kind) ===';
export const ENVIRONMENTS_LIFECYCLE_FACTS_END = '=== END environment-lifecycle facts ===';

/** The reportable facts view (exactly what the prompt embeds). */
export interface EnvironmentsLifecycleFacts {
        readonly executorKind: string;
        readonly operations: readonly {
                readonly envId: string;
                readonly op: string;
                readonly actor: string;
                readonly result: string;
                readonly fromState: string;
                readonly toState: string;
                readonly error?: string;
        }[];
}

/** Builds the facts view from the REAL manager state (the ledger rows verbatim). */
export function environmentsLifecycleFactsOf(executorKind: string, ops: readonly EnvironmentOpRecord[]): EnvironmentsLifecycleFacts {
        return {
                executorKind,
                operations: ops.map(record => ({
                        envId: record.environmentId,
                        op: record.op,
                        actor: record.actor,
                        result: record.result,
                        fromState: record.fromState,
                        toState: record.toState,
                        ...(record.error === undefined ? {} : { error: record.error.code }),
                })),
        };
}

/**
 * Builds the full environments-lifecycle question with the op-sequence
 * facts embedded. Called AT ASK TIME (inside the ask window); the facts
 * JSON's sha256 is pinned in the receipt.
 */
export function buildEnvironmentsLifecycleQuestion(facts: EnvironmentsLifecycleFacts): { readonly prompt: string; readonly factsSha256: string } {
        const body = JSON.stringify(facts, null, 2);
        const factsSha256 = sha256Hex(body);
        const prompt = [
                'Report the environment lifecycle outcome of the scripted scenario that just ran under the real Flauz environments lifecycle manager (a REAL local child process; local-real seams).',
                'You are a bare chat completion with NO tool or file access, so the lifecycle facts are embedded below, computed at ask time from the real manager state (the ops-ledger rows verbatim + the executor kind).',
                ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN,
                body,
                ENVIRONMENTS_LIFECYCLE_FACTS_END,
                `Report the facts above faithfully. Answer with exactly one JSON document of shape { "schema": "${ENVIRONMENTS_LIFECYCLE_ANSWER_SCHEMA}", "environments": { "<envId>": "<final state>" }, "opsLedger": { "rows": N, "kinds": { "<op>": N } }, "failureLegs": [{ "leg": "...", "verdict": "illegal"|"rejected", "code": "..." }] } and nothing else. The environments map carries the FINAL state per environment id (the last ledger row's toState per id); opsLedger.rows is the total ledger line count and kinds the per-op census; failureLegs derives from the error rows (a TRUST_POSTURE_REJECTED start is leg "untrusted-start" verdict "rejected"; an ILLEGAL_TRANSITION stop is leg "illegal-stop" verdict "illegal").`,
        ].join('\n');
        return { prompt, factsSha256 };
}

// ---------------------------------------------------------------------------
// The exercise
// ---------------------------------------------------------------------------

class Recorder {
        readonly checks: ExerciseCheck[] = [];

        check(id: string, ok: boolean, detail: string): boolean {
                this.checks.push({ id, ok, detail });
                return ok;
        }
}

async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
        const absolute = nodePath.join(harness.root, uri);
        await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
        await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
        const sha = sha256Hex(contents);
        const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256: sha, note });
        await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256: sha, note });
        return { item: { kind: 'note', uri, sha256: sha }, evidenceId: appended.evidenceId };
}

/** The REAL node-backed ports (the localProcess.test.ts canonical wiring; vscode-free). */
function realLocalPorts() {
        const localFs: LocalEnvFsPort = {
                readFileUtf8: async target => {
                        try {
                                return await nodeFs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if (err !== null && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target, contents) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
                rename: (from, to) => nodeFs.rename(from, to),
                mkdir: async target => {
                        await nodeFs.mkdir(target, { recursive: true });
                },
                readdir: async target => (await nodeFs.readdir(target)).sort(),
                rm: target => nodeFs.rm(target, { recursive: true, force: true }),
        };
        const processPort: ProcessPort = {
                launchNodeProcess: (scriptPath, args, options) => {
                        const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
                        if (process.versions.electron !== undefined) {
                                env.ELECTRON_RUN_AS_NODE = '1';
                        }
                        return spawn(process.execPath, [scriptPath, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as ChildHandle;
                },
                isPidAlive: pid => {
                        try {
                                process.kill(pid, 0);
                                return true;
                        } catch {
                                return false;
                        }
                },
        };
        const hash: HashPort = { sha256Hex: contents => sha256Hex(contents) };
        return { localFs, processPort, hash };
}

function isPidAlive(pid: number): boolean {
        try {
                process.kill(pid, 0);
                return true;
        } catch {
                return false;
        }
}

export const ENVIRONMENTS_LIFECYCLE_EXERCISE: DogfoodExercise = {
        id: 'environments-lifecycle',
        title: 'environments lifecycle: the typed state machine + real child-process environment + ops ledger over the real manager',
        prompt: 'Report the environment lifecycle outcome (the final state per environment, the ops-ledger census, and the failure-leg verdicts).',
        dimensions: ['environments lifecycle', 'typed state machine legality', 'failure/recovery', 'artifacts/evidence', 'slow-path timing'],
        async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
                const recorder = new Recorder();
                const evidenceIds: string[] = [];
                const evidenceItems: EvidenceItem[] = [];
                const notes: string[] = [];
                const clock = harness.clock;
                const sessionRoot = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'flauz-dogfood-envlife-'));
                const harnessPath = nodePath.join(harness.repoRoot, 'extensions', 'flauz-environments', 'fixtures', 'env-agent.ts');

                // the human-gate friction rows (the laws: first-class manual-intervention,
                // recovery accounts where a human gate exists)
                await harness.friction.friction({
                        phase: 'environments-lifecycle:create-approval',
                        kind: 'manual-intervention',
                        detail: 'the human approved the workspace-remote environment provisioning (create, actor human) on the lifecycle rig',
                        recovery: '',
                });

                try {
                        // 1. The REAL rig: registry + local-process executor + manager (the canonical wiring).
                        const ports = realLocalPorts();
                        const registry = new EnvironmentRegistry({ root: sessionRoot, fs: ports.localFs, clock });
                        await registry.bootstrap();
                        await registry.register(lifecycleMainRegistration() as never);
                        await registry.register(lifecycleUntrustedRegistration() as never);
                        const executor = new LocalProcessExecutor({
                                root: sessionRoot,
                                fs: ports.localFs,
                                process: ports.processPort,
                                hash: ports.hash,
                                clock,
                                harnessPath,
                                heartbeatMs: 100,
                                startTimeoutMs: 5_000,
                        });
                        const manager = new EnvironmentLifecycleManager({ registry, root: sessionRoot, fs: ports.localFs, clock, executors: [executor] });
                        await manager.bootstrap();

                        // 2. The happy path, the typed state machine asserted at EVERY step.
                        const observedStates: string[] = [manager.stateOf(LIFECYCLE_MAIN_ENV_ID)];
                        const created = await manager.perform('create', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'human' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        const started = await manager.perform('start', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'agent' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        const startWallStartedAt = Date.now();
                        const runningDescribe: DescribeReport = await manager.describe({ id: LIFECYCLE_MAIN_ENV_ID });
                        // the backing truth captured WHILE RUNNING (the state file beats + destroy removes it later)
                        const stateFileAtRunning = await ports.localFs.readFileUtf8(nodePath.join(sessionRoot, '.flauz', 'env-state', LIFECYCLE_MAIN_ENV_ID, 'state.json'));
                        const attached = await manager.perform('attach', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'agent' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        const attachedDescribe: DescribeReport = await manager.describe({ id: LIFECYCLE_MAIN_ENV_ID });
                        const snapshotted = await manager.perform('snapshot', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'tool' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        await harness.friction.friction({
                                phase: 'environments-lifecycle:teardown-approval',
                                kind: 'manual-intervention',
                                detail: 'the human approved the environment teardown (stop + destroy, actor human) after the snapshot',
                                recovery: '',
                        });
                        const stopped = await manager.perform('stop', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'human' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        const destroyed = await manager.perform('destroy', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'human' });
                        observedStates.push(manager.stateOf(LIFECYCLE_MAIN_ENV_ID));
                        const destroyedDescribe: DescribeReport = await manager.describe({ id: LIFECYCLE_MAIN_ENV_ID });
                        await harness.friction.timing({ phase: 'environments-lifecycle:start-to-ready', durationMs: Math.max(0, Date.now() - startWallStartedAt) });

                        // 3. The failure legs.
                        await harness.friction.friction({
                                phase: 'environments-lifecycle:trust-gate',
                                kind: 'manual-intervention',
                                detail: 'the fail-closed trust gate rejected the start of the untrusted-posture environment (TRUST_POSTURE_REJECTED, the message names the posture) — the SECURITY-MODEL 3.4 review boundary the human stands behind',
                                recovery: 'the human destroyed the untrusted environment instead of pursuing its start (destroy is not trust-gated; teardown ops stay available)',
                        });
                        const untrustedCreated = await manager.perform('create', { id: LIFECYCLE_UNTRUSTED_ENV_ID, actor: 'human' });
                        const untrustedStart = await manager.perform('start', { id: LIFECYCLE_UNTRUSTED_ENV_ID, actor: 'agent' });
                        const untrustedDestroy = await manager.perform('destroy', { id: LIFECYCLE_UNTRUSTED_ENV_ID, actor: 'human' });
                        await harness.friction.friction({
                                phase: 'environments-lifecycle:illegal-stop',
                                kind: 'manual-intervention',
                                detail: 'the human attempted a stop on the already-destroyed environment; the typed state machine rejected it (ILLEGAL_TRANSITION naming the legal ops — none from destroyed)',
                                recovery: 'the typed rejection was ledger-recorded with the terminal state left untouched; the drill closed with the tombstone intact',
                        });
                        const illegalStop = await manager.perform('stop', { id: LIFECYCLE_MAIN_ENV_ID, actor: 'human' });

                        // 4. THE INDEPENDENT ground truth: re-derived from the REAL manager state.
                        const groundTruth = deriveEnvironmentsLifecycleGroundTruth(manager.entries(), manager.ops());
                        const ops = manager.ops();

                        // 5. THE ASK (P2-FIX-119: facts embedded at ask time).
                        const askPromptHolder: { prompt: string; factsSha256: string } = { prompt: '', factsSha256: '' };
                        const ask: AskOutcome = await harness.provider.ask(() => {
                                const facts = environmentsLifecycleFactsOf(executor.executorKind, manager.ops());
                                const built = buildEnvironmentsLifecycleQuestion(facts);
                                askPromptHolder.prompt = built.prompt;
                                askPromptHolder.factsSha256 = built.factsSha256;
                                return built.prompt;
                        });

                        let answerProblems: string[] = [];
                        let verification: EnvironmentsLifecycleVerificationOutcome = { ok: false, problems: ['no answer was produced'], soundnessViolations: 0, completenessViolations: 0 };
                        if (ask.kind === 'ok') {
                                const parsed = parseEnvironmentsLifecycleAnswer(ask.text, { fenceTolerant: harness.mode === 'live-provider' });
                                if (!parsed.ok) {
                                        answerProblems.push(answerParseFailDetail(parsed.error, ask.finishReason));
                                } else {
                                        verification = verifyEnvironmentsLifecycleAnswer(parsed.answer, groundTruth);
                                        answerProblems.push(...verification.problems);
                                }
                        } else {
                                answerProblems.push(`the ask surfaced a typed provider failure: ${ask.code} ${ask.message}`);
                                await harness.friction.friction({
                                        phase: 'environments-lifecycle:ask',
                                        kind: 'provider-failure',
                                        detail: `the environments-lifecycle ask surfaced the TYPED provider failure ${ask.code} (retryable=${String(ask.retryable)}, retryClass=${ask.retryClass}) after ${String(ask.attempts)} attempt(s): ${ask.message}`,
                                        recovery: '',
                                });
                        }

                        // 6. THE CHECKS (every law checked against the real state).
                        recorder.check('el.state-machine-every-step', observedStates.length === MAIN_STATE_CHAIN.length && observedStates.every((state, index) => state === MAIN_STATE_CHAIN[index]),
                                observedStates.length === MAIN_STATE_CHAIN.length && observedStates.every((state, index) => state === MAIN_STATE_CHAIN[index])
                                        ? `the typed state machine held at every step: ${observedStates.join(' -> ')} (the /attached connection substate; snapshot state-preserving)`
                                        : `the observed state chain ${JSON.stringify(observedStates)} diverged from the pinned machine chain ${JSON.stringify([...MAIN_STATE_CHAIN])}`);
                        const startPid = started.ok && started.detail?.type === 'start' ? started.detail.pid : -1;
                        const stateParsed = stateFileAtRunning === undefined ? undefined : JSON.parse(stateFileAtRunning) as Record<string, unknown>;
                        recorder.check('el.real-child-process', started.ok && startPid > 0 && stateParsed !== undefined && stateParsed['pid'] === startPid && stateParsed['status'] === 'running' && runningDescribe.verdict.health === 'healthy' && runningDescribe.verdict.pid === startPid,
                                started.ok && startPid > 0 && stateParsed !== undefined && stateParsed['pid'] === startPid && stateParsed['status'] === 'running' && runningDescribe.verdict.health === 'healthy' && runningDescribe.verdict.pid === startPid
                                        ? `the REAL env-agent harness child ran (pid ${String(startPid)}, ready-line handshake confirmed by the ok start; state.json carries the pid + status running; describe healthy at the real pid; after stop+destroy the pid is reaped: alive=${String(isPidAlive(startPid))}; forcedSignal ${stopped.ok && stopped.detail?.type === 'stop' ? String(stopped.detail.forcedSignal) : 'n/a'})`
                                        : `the start/detail/probe leg failed: started.ok=${String(started.ok)}, pid=${String(startPid)}, state.json=${JSON.stringify(stateParsed === undefined ? null : { pid: stateParsed['pid'], status: stateParsed['status'] })}, describe=${JSON.stringify(runningDescribe.verdict)}`);
                        const snapshotDetail = snapshotted.ok && snapshotted.detail?.type === 'snapshot' ? snapshotted.detail : undefined;
                        // the snapshot's OWN copy (self-consistent: the live file keeps beating)
                        const snapshotCopy = snapshotDetail === undefined ? undefined : await ports.localFs.readFileUtf8(nodePath.join(snapshotDetail.snapshotDir, 'state.json'));
                        const manifestRaw = snapshotDetail === undefined ? undefined : await ports.localFs.readFileUtf8(snapshotDetail.manifestPath);
                        const manifestParsed = manifestRaw === undefined ? undefined : JSON.parse(manifestRaw) as { schema?: string; environmentId?: string; files?: Array<{ path?: string; sha256?: string }> };
                        const snapshotOk = snapshotDetail !== undefined && snapshotCopy !== undefined && manifestParsed !== undefined && manifestParsed['schema'] === 'flauz.env-snapshot-manifest/v0' && manifestParsed['environmentId'] === LIFECYCLE_MAIN_ENV_ID && snapshotDetail.fileCount === 1 && manifestParsed['files'] !== undefined && manifestParsed['files'].length === 1 && manifestParsed['files'][0]?.['path'] === 'state.json' && manifestParsed['files'][0]?.['sha256'] === sha256Hex(snapshotCopy);
                        recorder.check('el.snapshot-manifest', snapshotOk, snapshotOk
                                ? `the snapshot is a REAL fs copy with the sha256 manifest (1 file: state.json, the manifest hash matches the snapshot's own copy ${String(manifestParsed['files']?.[0]?.['sha256'])}, under ${snapshotDetail?.snapshotDir})`
                                : `the snapshot leg failed: detail=${JSON.stringify(snapshotted.ok ? (snapshotted.detail ?? null) : snapshotted.error)}, manifest=${manifestRaw === undefined ? 'absent' : 'present'}, copy=${snapshotCopy === undefined ? 'absent' : 'present'}`);
                        const ledgerFile = await ports.localFs.readFileUtf8(nodePath.join(sessionRoot, ...OPS_PATH.split('/')));
                        const ledgerLines = ledgerFile === undefined ? [] : ledgerFile.split('\n').filter(line => line.length > 0);
                        const envelopeFile = await ports.localFs.readFileUtf8(nodePath.join(sessionRoot, ...LIFECYCLE_PATH.split('/')));
                        const envelopeParsed = envelopeFile === undefined ? undefined : JSON.parse(envelopeFile) as LifecycleEnvelope;
                        const opsFileOk = ledgerLines.length === ops.length && ops.every((record, index) => {
                                const line = JSON.parse(ledgerLines[index] ?? '') as Record<string, unknown>;
                                return line['schema'] === OPS_SCHEMA_ID && line['schemaVersion'] === 0 && line['op'] === record.op && line['environmentId'] === record.environmentId && line['result'] === record.result && (typeof line['actor'] === 'string' && line['actor'] === record.actor);
                        });
                        recorder.check('el.ops-ledger-append-only', opsFileOk && ops.length === 10, opsFileOk && ops.length === 10
                                ? `the ops ledger is append-only on disk (${String(ops.length)} canonical rows, one per op, provenance actor on every row: census ${JSON.stringify(groundTruth.opsKinds)}; ok=${String(ops.filter(record => record.result === 'ok').length)}, error=${String(ops.filter(record => record.result === 'error').length)})`
                                : `the ops ledger leg failed: file lines=${String(ledgerLines.length)}, manager rows=${String(ops.length)}, shapeOk=${String(opsFileOk)}`);
                        const entryKeysOk = envelopeParsed !== undefined && envelopeParsed['schema'] === LIFECYCLE_SCHEMA_ID && envelopeParsed['schemaVersion'] === LIFECYCLE_SCHEMA_VERSION && Object.values(envelopeParsed['entries']).every(entry => {
                                const keys = Object.keys(entry).sort();
                                return keys.length === 4 && keys[0] === 'executorKind' && keys[1] === 'lastOpRef' && keys[2] === 'state' && keys[3] === 'updatedAt';
                        });
                        const lastOpRefOk = envelopeParsed !== undefined && Object.entries(envelopeParsed['entries']).every(([envId, entry]) => {
                                const absorbed = ops[entry.lastOpRef - 1];
                                return absorbed !== undefined && absorbed.environmentId === envId;
                        });
                        recorder.check('el.pin2-envelope-shape', entryKeysOk === true && lastOpRefOk === true && envelopeParsed !== undefined && Object.keys(envelopeParsed['entries']).sort().join(',') === [LIFECYCLE_MAIN_ENV_ID, LIFECYCLE_UNTRUSTED_ENV_ID].sort().join(','),
                                entryKeysOk === true && lastOpRefOk === true
                                        ? `the PIN-2 siblings hold the exact envelope shape (entries {state, updatedAt, executorKind, lastOpRef}, schema ${LIFECYCLE_SCHEMA_ID}, executorKind local-process; every lastOpRef references its own environment's ledger record; both tombstones destroyed)`
                                        : `the PIN-2 envelope leg failed: entries=${envelopeParsed === undefined ? 'absent' : JSON.stringify(envelopeParsed['entries'])}`);
                        recorder.check('el.illegal-transition-leg', !illegalStop.ok && illegalStop.error.code === 'ILLEGAL_TRANSITION' && illegalStop.record.result === 'error' && illegalStop.record.fromState === 'destroyed' && illegalStop.record.toState === 'destroyed' && manager.stateOf(LIFECYCLE_MAIN_ENV_ID) === 'destroyed',
                                !illegalStop.ok && illegalStop.error.code === 'ILLEGAL_TRANSITION'
                                        ? `the stop-on-destroyed attempt was a typed ledger-recorded rejection (ILLEGAL_TRANSITION naming the legal ops; fromState/toState destroyed; the tombstone held; the attempt is row ${String(illegalStop.record.fromState === 'destroyed' ? ops.findIndex(record => record.result === 'error' && record.error?.code === 'ILLEGAL_TRANSITION') + 1 : -1)})`
                                        : `the illegal-transition leg failed: outcome=${JSON.stringify(illegalStop.ok ? illegalStop.detail : illegalStop.error)}`);
                        recorder.check('el.trust-gate-leg', untrustedCreated.ok === true && !untrustedStart.ok && untrustedStart.error.code === 'TRUST_POSTURE_REJECTED' && untrustedStart.error.message.includes('untrusted') && untrustedStart.record.fromState === 'created' && manager.stateOf(LIFECYCLE_UNTRUSTED_ENV_ID) === 'destroyed' && untrustedDestroy.ok === true,
                                untrustedCreated.ok === true && !untrustedStart.ok && untrustedStart.error.code === 'TRUST_POSTURE_REJECTED' && untrustedDestroy.ok === true
                                        ? `the fail-closed trust gate rejected the untrusted start (TRUST_POSTURE_REJECTED, posture named; state untouched at created) and the teardown destroy proceeded (not trust-gated) to the tombstone`
                                        : `the trust-gate leg failed: create=${String(untrustedCreated.ok)}, start=${JSON.stringify(untrustedStart.ok ? untrustedStart.detail : untrustedStart.error)}, destroy=${String(untrustedDestroy.ok)}`);
                        recorder.check('el.describe-verdicts', runningDescribe.verdict.health === 'healthy' && runningDescribe.verdict.pid === startPid && attachedDescribe.verdict.lease !== undefined && attachedDescribe.verdict.health === 'healthy' && destroyedDescribe.verdict.health === 'destroyed' && destroyedDescribe.state === 'destroyed',
                                runningDescribe.verdict.health === 'healthy' && attachedDescribe.verdict.lease !== undefined && destroyedDescribe.verdict.health === 'destroyed'
                                        ? `the describe probes: healthy at the real pid while running, the /attached lease surfaced (${JSON.stringify(attachedDescribe.verdict.lease)}), destroyed tombstone after teardown`
                                        : `the describe leg failed: running=${JSON.stringify(runningDescribe.verdict)}, attached=${JSON.stringify(attachedDescribe.verdict)}, destroyed=${JSON.stringify(destroyedDescribe.verdict)}`);
                        recorder.check('el.answer-verified-100', verification.ok, verification.ok
                                ? `the model's answer matched the independently re-derived ground truth 100% (sound + complete; facts sha256 ${askPromptHolder.factsSha256})`
                                : `answer verification FAILED: ${String(verification.soundnessViolations)} soundness violation(s), ${String(verification.completenessViolations)} completeness violation(s): ${verification.problems.join('; ')}`);
                        recorder.check('el.ask-prompt-carries-facts', askPromptHolder.prompt.includes(ENVIRONMENTS_LIFECYCLE_FACTS_BEGIN) && askPromptHolder.prompt.includes(ENVIRONMENTS_LIFECYCLE_FACTS_END), 'the ask prompt embedded the op-sequence facts at ask time (P2-FIX-119 doctrine)');

                        // 7. The report artifact + the records-dir receipt.
                        const report = {
                                schema: 'flauz.dogfood-environments-lifecycle-report/v1',
                                exerciseId: 'environments-lifecycle',
                                mode: harness.mode,
                                scenarioHash: sha256Hex(`${LIFECYCLE_MAIN_ENV_ID}\n${LIFECYCLE_UNTRUSTED_ENV_ID}\n${JSON.stringify(lifecycleMainRegistration())}\n${JSON.stringify(lifecycleUntrustedRegistration())}`),
                                ask: ask.kind === 'ok'
                                        ? { kind: 'ok', decisionId: ask.decisionId, finishReason: ask.finishReason, fenceStripped: harness.mode === 'live-provider', text: ask.text }
                                        : { kind: 'provider-failure', decisionId: ask.decisionId, code: ask.code, retryClass: ask.retryClass, attempts: ask.attempts, message: ask.message },
                                askPromptExcerpt: askPromptHolder.prompt.slice(0, 2_000),
                                groundTruth,
                                observedStates,
                                startPid,
                                opsLedgerRows: ops.length,
                                answerProblems,
                                verification: { ok: verification.ok, soundnessViolations: verification.soundnessViolations, completenessViolations: verification.completenessViolations },
                        };
                        const reportUri = `.flauz/artifacts/${harness.taskId}/environments-lifecycle-report.json`;
                        const artifact = await mintArtifact(harness, reportUri, `${JSON.stringify(report, null, '\t')}\n`, 'the environments-lifecycle exercise report (the typed state machine + the real child process + the ops ledger)');
                        evidenceItems.push(artifact.item);
                        evidenceIds.push(artifact.evidenceId);
                        await nodeFs.mkdir(harness.recordsDir, { recursive: true });
                        await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'environments-lifecycle.report.json'), `${JSON.stringify(report, null, '\t')}\n`, { encoding: 'utf-8' });
                        recorder.check('el.report-evidence-minted', artifact.evidenceId.length > 0, `the environments-lifecycle report is hash-pinned into the evidence ledger (${artifact.evidenceId})`);

                        notes.push('evidence: the seams are LOCAL-REAL (the REAL EnvironmentRegistry + LocalProcessExecutor spawning the FIXED env-agent harness child + the REAL EnvironmentLifecycleManager over the PIN-2 store); the model intelligence is fixture-level (the fake lane answers from the prompt-carried facts), never promoted');
                        notes.push('the verifier re-derives the ground truth from the real manager entries()/ops() (never the prompt) and checks the answer 100% sound+complete; PASS only at 100%');
                        notes.push('P2-FIX-119 doctrine: both lanes answer from the prompt-carried op-sequence facts (embedded at ask time, the ledger rows verbatim)');
                        notes.push('the fixed harness executable is extensions/flauz-environments/fixtures/env-agent.ts (the ONLY sanctioned executable -- descriptor-supplied execution is forbidden); a real /bin child with the stdio ready-line handshake');
                } finally {
                        await nodeFs.rm(sessionRoot, { recursive: true, force: true }).catch(() => undefined);
                }

                const failCount = recorder.checks.filter(check => !check.ok).length;
                const frictionRows = await harness.friction.readAll();
                return {
                        schema: 'flauz.dogfood-exercise-receipt/v1',
                        exerciseId: 'environments-lifecycle',
                        title: 'environments lifecycle: the typed state machine + real child-process environment + ops ledger over the real manager',
                        dimensions: ['environments lifecycle', 'typed state machine legality', 'failure/recovery', 'artifacts/evidence', 'slow-path timing'],
                        verdict: failCount === 0 ? 'PASS' : 'FAIL',
                        checks: recorder.checks,
                        evidenceIds,
                        evidenceItems,
                        frictionLogPath: harness.friction.path,
                        frictionRows: {
                                friction: frictionRows.filter(row => row.type === 'friction').length,
                                timing: frictionRows.filter(row => row.type === 'timing').length,
                                recovery: frictionRows.filter(row => row.type === 'friction' && typeof (row as { recovery?: unknown }).recovery === 'string' && ((row as { recovery: string }).recovery).length > 0).length,
                        },
                        evidenceLevels: { seams: 'local-real', modelIntelligence: 'fixture' },
                        notes,
                };
        },
};
