/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-002 Worker A -- the full product acceptance journey, RUNTIME rung.
 *
 * Executes the canonical 14-leg acceptance journey (docs/FLAUZ-PROGRAM/
 * PRODUCT-PHASE.md "Acceptance journey"; TL4-PRODUCT-HANDOFF.md P2-002)
 * over the REAL product runtime, composing the repo's established drill
 * machinery instead of reinventing it:
 *
 *   LEG  1 workspace-open         boot the full product substrate on a REAL
 *                                 workspace root (task envelope, evidence
 *                                 ledger, tiered memory, model registry,
 *                                 environment registry, orchestration store,
 *                                 A2A bus) -- real fs, real bootstrap.
 *   LEG  2 mission-task           submit + approve the mission graph through
 *                                 the orchestration surface; the mission ->
 *                                 task envelope mints and persists on disk.
 *   LEG  3 agent-session          the primary agent opens a session (exclusive
 *                                 claim + session-tier memory record), with
 *                                 attribution on every row.
 *   LEG  4 provider-model         choose a live provider/model: the real
 *                                 capability registry + router, the workspace
 *                                 providers-file enablement act, the durable
 *                                 routing decision ledger, and a REAL chat
 *                                 completion streamed through the REAL
 *                                 openAiCompat adapter + nodeHttpPort over a
 *                                 REAL local OpenAI-compatible wire.
 *   LEG  5 workspace-resources    the session's tool step edits + reads a
 *                                 workspace resource on the real fs and mints
 *                                 changeset evidence.
 *   LEG  6 browser-use            the real BrowserSessionManager +
 *                                 CdpEndpointHost against a REAL headless
 *                                 Chromium over a real CDP WebSocket; a REAL
 *                                 local origin server (127.0.0.1); the
 *                                 fail-closed denial probe (ZERO wire
 *                                 commands) + the on-disk session journal.
 *   LEG  7 environment-use        the real EnvironmentRegistry + lifecycle
 *                                 manager + LocalProcessExecutor: a REAL
 *                                 grandchild harness process (real pid, real
 *                                 on-disk state file, real heartbeats),
 *                                 create -> start -> use -> stop.
 *   LEG  8 a2a-delegation         the real on-disk A2ABus: typed delegation
 *                                 round-trip, worker evidence attribution,
 *                                 no ledger clobbering.
 *   LEG  9 approval-takeover      the human-approval gate arms FAIL-CLOSED;
 *                                 the human interrupts it and TAKES the step
 *                                 over (3 attributed rows, evidence minted).
 *   LEG 10 artifact-evidence      note + signed checkpoint ledger rows, the
 *                                 journey artifacts on disk, the workflow
 *                                 fragment save; the hash chain verifies.
 *   LEG 11 provider-env-failure   REAL wire failures: the model provider
 *                                 returns HTTP 500 over the real socket (the
 *                                 typed PROVIDER_OVERLOADED feeds the bounded
 *                                 recorded retry); the cloud-sandbox provider
 *                                 fails starts over the real wire (typed
 *                                 CLOUD_PROVIDER_ERROR, bounded exhaustion);
 *                                 an exhaustion probe fails terminally.
 *   LEG 12 retry-cancel-recover   the cloud env recovers on a fresh bounded
 *                                 window (real wire census); a REAL child
 *                                 process is cancelled MID-FLIGHT through the
 *                                 task machine (typed stale-run-cancelled
 *                                 crash, downstream never runs).
 *   LEG 13 restart                REAL process death: a finisher child is
 *                                 SIGKILLed inside the crash window (effect
 *                                 settled durably, journal append pending).
 *   LEG 14 resume-continuity      cold boot on the same root: recovery marks
 *                                 the interrupted step (never fabricates),
 *                                 no silent state loss, work CONTINUES (the
 *                                 settled effect REPLAYS on the same
 *                                 idempotency key), the mission completes,
 *                                 and the end-to-end provenance walk holds.
 *
 * ONE-STATE LAW: exactly one workspace root (a mkdtemp temp dir) carries the
 * whole journey. LEG 13 is the sanctioned restart exception: the service
 * INSTANCES live in a REAL child process that is SIGKILLed; the on-disk state
 * is never reset.
 *
 * EVIDENCE LEVELS (honest, per the evidence law; never up-claimed):
 *   - runtime-real: real fs, real child processes (SIGKILL death, mid-flight
 *     cancel), real sockets (the OpenAI-compatible provider wire, the
 *     cloud-sandbox wire, the local origin server), real CDP against a real
 *     headless Chromium, the real LocalProcessExecutor grandchild processes.
 *   - live-provider: when FLAUZ_LIVE_PROVIDER_BASE_URL / _API_KEY / _MODEL
 *     are present the drill ADDITIONALLY invokes the repo's TL2-H1
 *     live-provider drill (extensions/flauz-models/test/canaries/
 *     live-provider-runtime.drill.ts) and LEG 4 upgrades its level.
 *
 * RECEIPTS: per-leg JSON receipts (schema flauz.p2-002-journey-receipt/v1)
 * are written to $FLAUZ_JOURNEY_RECORDS (the gate passes it; see
 * build/flauz/journey/records/README.md for the format). A leg that CANNOT
 * execute is recorded honestly (verdict SKIP + the exact reason, or FAIL with
 * the failing assertion) -- never a silent skip. The summary receipt
 * (flauz.p2-002-journey/v1) carries the whole verdict document.
 *
 * MODES:
 *   (no flags)  the full runtime journey (LEG 6 needs FLAUZ_CDP_ENDPOINT).
 *   --selftest  zero-dep machinery self-test (the receipt writer, the verdict
 *               assembly, the child-report line parser). No Chromium.
 *   --child <role> [--root <dir>]
 *               CHILD MODE (never run by hand): finisher | cancel-flight.
 *               Roles speak the JOURNEY-CHILD line protocol.
 *
 * HOW TO RUN (the gate build/flauz/journey/p2-002-journey.mjs drives this;
 * the TL3-003/session/budgets drills document the Chromium launch pattern):
 *   chromium --headless=new --no-sandbox --disable-gpu \
 *            --disable-popup-blocking --remote-debugging-port=9222 \
 *            --user-data-dir=/tmp/flauz-chrome about:blank
 *   # take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
 *   FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
 *     node --experimental-strip-types build/flauz/journey/journey.drill.ts
 *
 * SKIP semantics (the repo drill law -- never fail a gate for lacking a
 * browser): without FLAUZ_CDP_ENDPOINT, LEG 6 records verdict SKIP with the
 * reason (exit stays 0 only if every other leg passed); the GATE's --require
 * mode promotes that SKIP to a failure. A divergent leg FAILS the drill.
 *
 * Exit codes: 0 = journey green (or selftest green); 1 = any leg failed (or
 * the drill machinery failed); 2 = usage error.
 */

import * as http from 'node:http';
import { spawn } from 'node:child_process';
import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { createHash } from 'node:crypto';

import { sha256Hex, type EvidenceKind, type FileSystemPort, type TaskEvent } from '../../../extensions/flauz-workspace/src/api.ts';
import { TaskService } from '../../../extensions/flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../../extensions/flauz-workspace/src/ledger.ts';
import { WorkflowService, type ApprovalPort, type ToolExecutorPort } from '../../../extensions/flauz-workflow/src/envelope.ts';
import { createEd25519Signer } from '../../../extensions/flauz-workflow/src/keys.ts';
import { MemoryStore } from '../../../extensions/flauz-memory/src/memory.ts';
import { ModelCapabilityRegistry } from '../../../extensions/flauz-models/src/discovery/registry.ts';
import { writeProviderOverrides } from '../../../extensions/flauz-models/src/discovery/configs.ts';
import { ModelRouter, listDecisions, loadRoutingPolicy, saveRoutingPolicy } from '../../../extensions/flauz-models/src/routing/store.ts';
import { DEFAULT_ROUTING_POLICY, type RoutingPolicyFile, type RoutingRule } from '../../../extensions/flauz-models/src/routing/policy.ts';
import { createOpenAiCompatAdapter } from '../../../extensions/flauz-models/src/adapters/openAiCompat.ts';
import { nodeHttpPort } from '../../../extensions/flauz-models/src/contract/nodePorts.ts';
import { isProviderError } from '../../../extensions/flauz-models/src/contract/errors.ts';
import type { ModelDescriptor, ResponseProvenance, TokenUsage } from '../../../extensions/flauz-models/src/contract/types.ts';
import { BrowserPolicyEngine } from '../../../extensions/flauz-browser/src/policy.ts';
import { CdpEndpointHost } from '../../../extensions/flauz-browser/src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError, type OpenSessionResult } from '../../../extensions/flauz-browser/src/runtime/sessionManager.ts';
import type { NavigationOutcome } from '../../../extensions/flauz-browser/src/runtime/tabs.ts';
import { WebSocketCdpTransport } from '../../../extensions/flauz-browser/src/cdp/transport.ts';
import { FileSystemSessionJournal, type SessionJournalRecord } from '../../../extensions/flauz-browser/src/runtime/journal.ts';
import { EnvironmentRegistry } from '../../../extensions/flauz-environments/src/registry.ts';
import { CloudHttpExecutor, EnvironmentLifecycleManager, LocalProcessExecutor, PROVIDER_RETRY_ATTEMPT_PREFIX, nodeHttpPort as envNodeHttpPort, parseProviderRetryAttemptMessage, type ChildHandle, type EnvironmentOpOutcome, type HashPort, type HttpPort, type LocalEnvFsPort, type ProcessPort } from '../../../extensions/flauz-environments/src/lifecycle/index.ts';
import { A2ABus, type A2aMessage } from '../../../extensions/flauz-agent/core/a2a.mjs';
import { OrchestrationStore, type TaskPort } from '../../../extensions/flauz-agent/core/orchStore.mjs';
import type { JournalRow } from '../../../extensions/flauz-agent/core/orchestration.mjs';
import { driveGraph, type EffectSink, type EffectSinkResult, type EffectSpec, type ProviderErrorField } from '../../../extensions/flauz-agent/core/runtime.mjs';
import { recoveryScan } from '../../../extensions/flauz-agent/core/recovery.mjs';
import { delegateStep, ingestResultReport } from '../../../extensions/flauz-agent/core/routing.mjs';

// ---------------------------------------------------------------------------
// Constants, environment, assertion surface
// ---------------------------------------------------------------------------

const ENDPOINT = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
const RECORDS_DIR = process.env['FLAUZ_JOURNEY_RECORDS'] ?? '';
const LIVE_PROVIDER_BASE_URL = process.env['FLAUZ_LIVE_PROVIDER_BASE_URL'] ?? '';
const LIVE_PROVIDER_API_KEY = process.env['FLAUZ_LIVE_PROVIDER_API_KEY'] ?? '';
const LIVE_PROVIDER_MODEL = process.env['FLAUZ_LIVE_PROVIDER_MODEL'] ?? '';

/** Tuned for a real local Chromium (the TL3-003 drill values). */
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

const JOURNEY_SCHEMA = 'flauz.p2-002-journey/v1';
const RECEIPT_SCHEMA = 'flauz.p2-002-journey-receipt/v1';
const WO_ID = 'P2-002';
const WORKER_ID = 'A';

const PRIMARY = 'flauz.agent.primary';
const WORKER_1 = 'flauz.agent.worker-1';

const MISSION_TITLE = 'P2-002 full product acceptance journey mission';
const PLANNING_PROMPT = 'plan the flauz product acceptance journey';

const JOURNEY_PROVIDER_ID = 'flauz-journey-openai';
const JOURNEY_MODEL_ID = 'journey-1';
const JOURNEY_CREDENTIAL_REF = 'env:FLAUZ_JOURNEY_PROVIDER_KEY';

const ENV_ID = 'env-journey-local';
const ENV_KIND = 'workspace-remote';
const CLOUD_ENV_ID = 'env-journey-cloud';
const CLOUD_ENV_KIND = 'cloud-sandbox';
const FIXED_BROWSER_TS = 1_740_000_000_000;

const GREEN_LINE = 'p2-002 journey drill: GREEN (14 legs over the real runtime)';

interface LegEntry {
	readonly leg: number;
	readonly slug: string;
	readonly name: string;
}

const LEGS: readonly LegEntry[] = [
	{ leg: 1, slug: 'workspace-open', name: 'create/open workspace' },
	{ leg: 2, slug: 'mission-task', name: 'create mission/task' },
	{ leg: 3, slug: 'agent-session', name: 'start agent session' },
	{ leg: 4, slug: 'provider-model', name: 'choose a live provider/model' },
	{ leg: 5, slug: 'workspace-resources', name: 'edit/read workspace resources' },
	{ leg: 6, slug: 'browser-use', name: 'use browser' },
	{ leg: 7, slug: 'environment-use', name: 'create/use environment' },
	{ leg: 8, slug: 'a2a-delegation', name: 'delegate to another agent (A2A)' },
	{ leg: 9, slug: 'approval-takeover', name: 'require/handle approval or takeover' },
	{ leg: 10, slug: 'artifact-evidence', name: 'produce artifact/evidence' },
	{ leg: 11, slug: 'provider-env-failure', name: 'exercise provider/environment failure' },
	{ leg: 12, slug: 'retry-cancel-recover', name: 'retry/cancel/recover' },
	{ leg: 13, slug: 'restart', name: 'restart' },
	{ leg: 14, slug: 'resume-continuity', name: 'resume task and inspect continuity/provenance' },
];

let failures = 0;
let assertions = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	assertions += 1;
	if (condition) {
		console.log(`p2-002 journey drill: PASS ${label}`);
	} else {
		failures += 1;
		console.error(`p2-002 journey drill: FAIL ${label} -- ${detail}`);
	}
}

function info(message: string): void {
	console.log(`p2-002 journey drill: NOTE ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Resolves the repo root from this drill file (build/flauz/journey/<this file> -> three levels up). */
function repoRootFromHere(): string {
	return nodePath.resolve(nodePath.dirname(fileURLOfThisModule()), '..', '..', '..');
}

function fileURLOfThisModule(): string {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`p2-002 journey drill: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

// ---------------------------------------------------------------------------
// The leg recorder + per-leg receipts (fail-closed: a leg that cannot
// execute records SKIP with the reason; a false check FAILs the leg)
// ---------------------------------------------------------------------------

interface LegVerdict {
	readonly leg: number;
	readonly slug: string;
	readonly name: string;
	readonly verdict: 'PASS' | 'FAIL' | 'SKIP';
	readonly assertions: { readonly pass: number; readonly fail: number };
	readonly evidenceLevel: string;
	readonly firstFailing?: string;
	readonly skipReason?: string;
	readonly notes?: string;
}

interface RecordedCheck {
	readonly id: string;
	readonly ok: boolean;
	readonly detail: string;
}

const legVerdicts: LegVerdict[] = [];
const receiptChecks = new Map<number, RecordedCheck[]>();

/**
 * The leg recorder: the battery's JourneyRecorder discipline, journey-shaped.
 * The check rows are mirrored into the receipt-check map so the per-leg
 * receipt carries the full assertion detail.
 */
class LegRecorder {
	private readonly checks: RecordedCheck[] = [];
	private readonly entry: LegEntry;
	private readonly level: string;
	private readonly notes: string[];
	private readonly startedAtMs: number;

	constructor(legNumber: number, level: string) {
		const entry = LEGS.find(candidate => candidate.leg === legNumber);
		if (entry === undefined) {
			throw new Error(`p2-002 journey drill: leg ${String(legNumber)} is not in the catalogue`);
		}
		this.entry = entry;
		this.level = level;
		this.notes = [];
		this.startedAtMs = Date.now();
	}

	/** Records one target assertion. NEVER weakens: a false check fails the leg (and the drill census). */
	check(id: string, ok: boolean, detail: string): boolean {
		this.checks.push({ id, ok, detail });
		const existing = receiptChecks.get(this.entry.leg) ?? [];
		existing.push({ id, ok, detail });
		receiptChecks.set(this.entry.leg, existing);
		assertions += 1;
		if (!ok) {
			failures += 1;
		}
		return ok;
	}

	note(text: string): void {
		this.notes.push(text);
	}

	buildVerdict(extra?: { verdict?: 'SKIP'; skipReason?: string }): LegVerdict {
		const pass = this.checks.filter(check => check.ok).length;
		const fail = this.checks.filter(check => !check.ok).length;
		const firstFailing = this.checks.find(check => !check.ok);
		const verdict: 'PASS' | 'FAIL' | 'SKIP' = extra?.verdict === 'SKIP' ? 'SKIP' : fail === 0 ? 'PASS' : 'FAIL';
		return {
			leg: this.entry.leg,
			slug: this.entry.slug,
			name: this.entry.name,
			verdict,
			assertions: { pass, fail },
			evidenceLevel: verdict === 'SKIP' ? 'unavailable' : this.level,
			...(firstFailing === undefined ? {} : { firstFailing: `${firstFailing.id}: ${firstFailing.detail}` }),
			...(extra?.skipReason === undefined ? {} : { skipReason: extra.skipReason }),
			...(this.notes.length === 0 ? {} : { notes: this.notes.join(' | ') }),
		};
	}

	elapsedMs(): number {
		return Date.now() - this.startedAtMs;
	}
}

/** Writes one per-leg receipt (schema flauz.p2-002-journey-receipt/v1). */
async function writeLegReceipt(verdict: LegVerdict, durationMs: number, command: string): Promise<string> {
	if (RECORDS_DIR === '') {
		return '';
	}
	const receipt = {
		schema: RECEIPT_SCHEMA,
		wo: WO_ID,
		worker: WORKER_ID,
		leg: verdict.leg,
		slug: verdict.slug,
		name: verdict.name,
		verdict: verdict.verdict,
		evidenceLevel: verdict.evidenceLevel,
		assertions: verdict.assertions,
		checks: receiptChecks.get(verdict.leg) ?? [],
		startedAt: new Date(Date.now() - durationMs).toISOString(),
		durationMs,
		command,
		...(verdict.firstFailing === undefined ? {} : { firstFailing: verdict.firstFailing }),
		...(verdict.skipReason === undefined ? {} : { skipReason: verdict.skipReason }),
		...(verdict.notes === undefined ? {} : { notes: verdict.notes }),
	};
	const fileName = `leg-${String(verdict.leg).padStart(2, '0')}-${verdict.slug}.json`;
	const target = nodePath.join(RECORDS_DIR, fileName);
	await nodeFs.mkdir(RECORDS_DIR, { recursive: true });
	await nodeFs.writeFile(target, `${JSON.stringify(receipt, null, '\t')}\n`, { encoding: 'utf-8' });
	return target;
}

async function finishLeg(recorder: LegRecorder, command: string, extra?: { verdict?: 'SKIP'; skipReason?: string }): Promise<LegVerdict> {
	const verdict = recorder.buildVerdict(extra);
	const receiptPath = await writeLegReceipt(verdict, recorder.elapsedMs(), command);
	legVerdicts.push(verdict);
	if (receiptPath !== '') {
		console.log(`p2-002 journey drill: receipt ${nodePath.basename(receiptPath)} (${verdict.verdict}, ${String(verdict.assertions.pass)} assertions, evidence ${verdict.evidenceLevel})`);
	}
	return verdict;
}

// ---------------------------------------------------------------------------
// Shared ports (the session-battery runtime pattern)
// ---------------------------------------------------------------------------

type RuntimeFs = FileSystemPort & LocalEnvFsPort & { rm(target: string): Promise<void> };

function runtimeFsPort(): RuntimeFs {
	return {
		readFileUtf8: async target => {
			try {
				return await nodeFs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => nodeFs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => nodeFs.rename(from, to),
		mkdir: target => nodeFs.mkdir(target, { recursive: true }),
		readdir: async target => (await nodeFs.readdir(target)).sort(),
		rm: target => nodeFs.rm(target, { force: true, recursive: true }),
	};
}

/** Deterministic stepping clock (advances 1000 per call, documented start). */
function steppingClock(start: number): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

const RUNTIME_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['127.0.0.1'] },
	webRequest: { allow: ['127.0.0.1'] },
	willNavigate: { allow: ['127.0.0.1'] },
	partitions: { scope: 'persist', perAgent: true },
});

const nodeProcessPort: ProcessPort = {
	launchNodeProcess: (scriptPath, args, options) => {
		const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
		if (process.versions.electron !== undefined) {
			env.ELECTRON_RUN_AS_NODE = '1';
		}
		return spawn(process.execPath, ['--experimental-strip-types', scriptPath, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildHandle;
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

const nodeHashPort: HashPort = {
	sha256Hex: contents => createHash('sha256').update(contents, 'utf8').digest('hex'),
};

/** The FIXED flauz-environments harness (the only executable the local-real executor ever spawns). */
const HARNESS_PATH = nodePath.join(repoRootFromHere(), 'extensions', 'flauz-environments', 'fixtures', 'env-agent.ts');

/** The fixture signer keys (the committed Wave-4 Lane K fixture posture; committed repo fixtures, no secrets). */
const KEYS_DIR = nodePath.join(repoRootFromHere(), 'test', 'fixtures', 'workflow', 'keys');

/** The repo's TL2-H1 live-provider drill (invoked when live env vars are present). */
const LIVE_PROVIDER_DRILL = nodePath.join(repoRootFromHere(), 'extensions', 'flauz-models', 'test', 'canaries', 'live-provider-runtime.drill.ts');

// ---------------------------------------------------------------------------
// Wire recording (the TL3-003 pattern) -- the sent-frame census
// ---------------------------------------------------------------------------

interface WireFrame {
	readonly method: string;
	readonly sessionId: string | undefined;
}

class RecordingWebSocketCdpTransport extends WebSocketCdpTransport {
	readonly sentFrames: WireFrame[] = [];

	protected postMessage(payload: Record<string, unknown>): void {
		this.sentFrames.push({
			method: typeof payload.method === 'string' ? payload.method : '',
			sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
		});
		super.postMessage(payload);
	}
}

// ---------------------------------------------------------------------------
// The real local-origin server (real navigations without external network)
// ---------------------------------------------------------------------------

interface LocalServer {
	readonly port: number;
	close(): void;
}

function startLocalServer(): Promise<LocalServer> {
	return new Promise(resolve => {
		const server = http.createServer((request, response) => {
			const url = request.url ?? '/';
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end(`<!doctype html><title>${url}</title><body>flauz p2-002 journey origin ${url}</body>`);
		});
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({ port, close: () => server.close() });
		});
	});
}

// ---------------------------------------------------------------------------
// The journey provider server over a REAL socket: an OpenAI-compatible
// chat-completions wire + the Flauz cloud-sandbox wire contract v0, with
// scripted failure routes (the INV-2/stub-provider-server pattern -- the
// server-side scripting is a control seam, the wire and the consumers are
// the REAL product code paths).
// ---------------------------------------------------------------------------

interface ProviderServer {
	readonly port: number;
	readonly chatCalls: ReadonlyArray<{ model: string; authorization: string }>;
	readonly cloudStartCalls: number;
	armChatFailures(count: number): void;
	census(): { readonly chat: number; readonly cloudStarts: number };
	close(): void;
}

function startProviderServer(): Promise<ProviderServer> {
	const chatCalls: Array<{ model: string; authorization: string }> = [];
	let cloudStartCalls = 0;
	let failNextChat = 0;
	const server = http.createServer((request, response) => {
		const url = request.url ?? '/';
		const method = request.method ?? 'GET';
		let body = '';
		request.on('data', (chunk: { toString(encoding?: string): string }) => {
			body += chunk.toString();
		});
		request.on('end', () => {
			const respond = (status: number, payload: string, headers?: Record<string, string>): void => {
				response.writeHead(status, { 'content-type': headers?.['content-type'] ?? 'application/json', ...(headers ?? {}) });
				response.end(payload);
			};
			if (method === 'POST' && url === '/__script') {
				try {
					const parsed = JSON.parse(body) as { failNextChat?: number };
					failNextChat = typeof parsed.failNextChat === 'number' ? parsed.failNextChat : failNextChat;
				} catch {
					// keep the current script
				}
				respond(200, '{}');
				return;
			}
			if (method === 'GET' && url === '/__calls') {
				respond(200, JSON.stringify({ chat: chatCalls.length, cloudStarts: cloudStartCalls }));
				return;
			}
			if (method === 'POST' && url === '/v1/chat/completions') {
				let model = 'unknown';
				let prompt = '';
				try {
					const parsed = JSON.parse(body) as { model?: string; messages?: Array<{ role?: string; content?: unknown }> };
					model = parsed.model ?? 'unknown';
					const lastUser = [...(parsed.messages ?? [])].reverse().find(message => message.role === 'user');
					const content = lastUser?.content;
					prompt = typeof content === 'string' ? content : '';
				} catch {
					// fall through with the unknown model
				}
				chatCalls.push({ model, authorization: request.headers['authorization'] ?? '' });
				if (failNextChat > 0) {
					failNextChat -= 1;
					respond(500, JSON.stringify({ error: { message: 'journey provider overloaded (scripted failure window)' } }));
					return;
				}
				const echo = `journey wire echo: ${prompt}`;
				respond(200, openAiSseBody(model, echo), { 'content-type': 'text/event-stream' });
				return;
			}
			if (method === 'POST' && url === '/v0/sandboxes') {
				let environmentId = 'unknown';
				try {
					const parsed = JSON.parse(body) as { metadata?: { environmentId?: string } };
					environmentId = parsed.metadata?.environmentId ?? 'unknown';
				} catch {
					// fall through with the unknown id
				}
				respond(200, JSON.stringify({ sandboxId: `sbx-${environmentId}`, status: 'created' }));
				return;
			}
			if (method === 'POST' && url === `/v0/sandboxes/sbx-${CLOUD_ENV_ID}/start`) {
				cloudStartCalls += 1;
				if (cloudStartCalls <= 5) {
					respond(500, JSON.stringify({ error: 'journey cloud provider exploded' }));
					return;
				}
				respond(200, JSON.stringify({ status: 'running' }));
				return;
			}
			if (method === 'POST' && url.endsWith('/stop')) {
				respond(200, '{}');
				return;
			}
			if (method === 'GET' && url.startsWith('/v0/sandboxes/')) {
				respond(200, JSON.stringify({ sandboxId: url.slice('/v0/sandboxes/'.length), status: 'running' }));
				return;
			}
			respond(404, JSON.stringify({ error: 'no such journey provider route' }));
		});
	});
	return new Promise(resolve => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({
				port,
				get chatCalls() {
					return chatCalls;
				},
				get cloudStartCalls() {
					return cloudStartCalls;
				},
				armChatFailures: count => {
					failNextChat = count;
				},
				census: () => ({ chat: chatCalls.length, cloudStarts: cloudStartCalls }),
				close: () => server.close(),
			});
		});
	});
}

/** One OpenAI-shaped SSE completion body (the wire shape the adapter parses; each data frame is a blank-line-delimited SSE event). */
function openAiSseBody(model: string, echo: string): string {
	const id = 'chatcmpl-journey-1';
	const created = 1_750_000_000;
	const events: string[] = [];
	events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}`);
	for (const delta of [echo.slice(0, Math.ceil(echo.length / 2)), echo.slice(Math.ceil(echo.length / 2))]) {
		events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}`);
	}
	events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`);
	events.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: { prompt_tokens: 17, completion_tokens: 6 } })}`);
	events.push('data: [DONE]');
	return `${events.join('\n\n')}\n\n`;
}

/** The crash-window hook: freeze AFTER the durable settle log line, BEFORE the drive journals the transition. */
interface FreezeHook {
	readonly matchesKey: (idempotencyKey: string) => boolean;
	readonly onFreeze: () => void;
}

// ---------------------------------------------------------------------------
// The file-backed idempotent effect sink (the rehearsal's durable pattern:
// every run() settles its idempotency key durably; a key already settled
// REPLAYS its recorded outcome instead of executing twice)
// ---------------------------------------------------------------------------

interface SettledEffect {
	readonly ok: boolean;
	readonly value?: unknown;
	readonly failureClass?: string;
	readonly message?: string;
	readonly providerError?: ProviderErrorField;
}

type StepEffectFn = (spec: EffectSpec) => Promise<EffectSinkResult> | EffectSinkResult;

class JourneyEffectSink implements EffectSink {
	private readonly settled: Map<string, SettledEffect>;
	private readonly effects: ReadonlyMap<string, StepEffectFn>;
	private readonly freeze: FreezeHook | undefined;
	readonly logPath: string;
	readonly callLog: Array<{ readonly key: string; readonly replayed: boolean }> = [];

	constructor(logPath: string, effects: ReadonlyMap<string, StepEffectFn>, freeze?: FreezeHook) {
		this.logPath = logPath;
		this.effects = effects;
		this.freeze = freeze;
		this.settled = new Map<string, SettledEffect>();
		if (nodeFsSync.existsSync(logPath)) {
			for (const line of nodeFsSync.readFileSync(logPath, { encoding: 'utf-8' }).split('\n')) {
				if (line.length === 0) {
					continue;
				}
				const entry = JSON.parse(line) as { key: string; replayed: boolean } & SettledEffect;
				if (!entry.replayed) {
					this.settled.set(entry.key, { ok: entry.ok, value: entry.value, failureClass: entry.failureClass, message: entry.message, providerError: entry.providerError });
				}
			}
		}
	}

	async run(idempotencyKey: string, spec: EffectSpec): Promise<EffectSinkResult> {
		const recorded = this.settled.get(idempotencyKey);
		if (recorded !== undefined) {
			// The effect already executed (its log line survived the death) -
			// replay the recorded outcome, NEVER execute twice.
			this.callLog.push({ key: idempotencyKey, replayed: true });
			await this.appendLog({ key: idempotencyKey, replayed: true, ok: recorded.ok, value: recorded.value, failureClass: recorded.failureClass, message: recorded.message });
			return { ok: recorded.ok, value: recorded.value, failureClass: recorded.failureClass, message: recorded.message, providerError: recorded.providerError, replayed: true };
		}
		const effect = this.effects.get(`${spec.graphId}/${spec.stepId}`);
		const result: EffectSinkResult = effect === undefined
			? { ok: true, value: `effect:${spec.stepId}:attempt-${String(spec.attempt)}` }
			: await effect(spec);
		const record: SettledEffect = { ok: result.ok, value: result.value, failureClass: result.failureClass, message: result.message, providerError: result.providerError };
		this.settled.set(idempotencyKey, record);
		this.callLog.push({ key: idempotencyKey, replayed: false });
		await this.appendLog({ key: idempotencyKey, replayed: false, ok: record.ok, value: record.value, failureClass: record.failureClass, message: record.message });
		if (this.freeze !== undefined && this.freeze.matchesKey(idempotencyKey)) {
			// LEG 13's crash window: the effect SETTLED durably (the log line
			// above survives the death); freeze BEFORE driveGraph can journal
			// the step transition. The parent SIGKILLs this process here.
			this.freeze.onFreeze();
			await new Promise<void>(() => {
				setInterval(() => undefined, 60_000);
			});
		}
		return { ...result, replayed: false };
	}

	private async appendLog(entry: Record<string, unknown>): Promise<void> {
		await nodeFs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf-8' });
	}

	/** Fresh executions of one key recorded in the DURABLE log (survives instance drops). */
	freshExecutionsInLog(key: string): number {
		return this.readLog().filter(entry => entry.key === key && !entry.replayed).length;
	}

	/** Replay calls of one key recorded in the DURABLE log (survives instance drops). */
	replaysOf(key: string): number {
		return this.readLog().filter(entry => entry.key === key && entry.replayed).length;
	}

	readLog(): Array<{ key: string; replayed: boolean }> {
		if (!nodeFsSync.existsSync(this.logPath)) {
			return [];
		}
		const entries: Array<{ key: string; replayed: boolean }> = [];
		for (const line of nodeFsSync.readFileSync(this.logPath, { encoding: 'utf-8' }).split('\n')) {
			if (line.length === 0) {
				continue;
			}
			entries.push(JSON.parse(line) as { key: string; replayed: boolean });
		}
		return entries;
	}

	callsForStep(graphId: string, stepId: string): number {
		return this.callLog.filter(call => call.key.includes(`/${graphId}/${stepId}/`)).length;
	}
}

// ---------------------------------------------------------------------------
// The substrate (constructed per boot; the root persists across LEG 13's death)
// ---------------------------------------------------------------------------

interface JourneyState {
	readonly root: string;
	readonly fs: RuntimeFs;
	readonly clock: () => number;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly memory: MemoryStore;
	readonly store: OrchestrationStore;
	readonly bus: A2ABus;
	readonly sink: JourneyEffectSink;
	readonly envRegistry: EnvironmentRegistry;
	readonly envManager: EnvironmentLifecycleManager;
	readonly router: ModelRouter;
}

/** The evidence-minting TaskPort adapter (the battery trio pattern, recordEvidence-aware). */
function journeyTaskPort(tasks: TaskService, ledger: EvidenceLedger): TaskPort {
	return {
		createTask: async args => ({ taskId: (await tasks.createTask(args.title)).id }),
		appendEvent: async args => ({ task: await tasks.appendEvent(args.taskId, args.event as unknown as TaskEvent) }),
		appendEvidence: async args => {
			const appended = await ledger.append(args.taskId, {
				kind: args.row.kind as EvidenceKind,
				uri: args.row.uri,
				sha256: args.row.sha256,
				...(args.row.note !== undefined ? { note: args.row.note } : {}),
			});
			await tasks.recordEvidence(args.taskId, {
				evidenceId: appended.evidenceId,
				seq: appended.seq,
				kind: args.row.kind as EvidenceKind,
				uri: args.row.uri,
				sha256: args.row.sha256,
				...(args.row.note !== undefined ? { note: args.row.note } : {}),
			});
			return { evidenceId: appended.evidenceId, seq: appended.seq };
		},
	};
}

/** The routing policy the journey's router carries (user rule first, then the shipped default). */
function journeyPolicy(): RoutingPolicyFile {
	const userRule: RoutingRule = {
		id: 'journey-live-preference',
		description: 'Journey rule: prefer the workspace-enabled OpenAI-compatible provider (the live-capable route).',
		priority: 10,
		match: { enabledOnly: true },
		ranking: 'prefer-order',
		prefer: [JOURNEY_PROVIDER_ID],
	};
	return { ...DEFAULT_ROUTING_POLICY, rules: [userRule, ...DEFAULT_ROUTING_POLICY.rules] };
}

async function readJourneyPolicyFromDisk(fs: RuntimeFs, root: string): Promise<RoutingPolicyFile> {
	const loaded = await loadRoutingPolicy(fs, `${root}/.flauz/models`, () => 0);
	if (loaded.rules.some(rule => rule.id === 'journey-live-preference')) {
		return loaded;
	}
	return journeyPolicy();
}

/**
 * Boots the full substrate on one workspace root. The `effects` map is
 * injected so the LEG 14 cold boot re-creates the sink over the same log
 * with the same effect closures (settled keys replay; the closures never
 * re-run for settled keys).
 */
async function bootJourney(root: string, effects: ReadonlyMap<string, StepEffectFn>, providerPort: number, freeze?: FreezeHook): Promise<JourneyState> {
	const fs = runtimeFsPort();
	const clock = steppingClock(1_740_000_000_000);
	const tasks = new TaskService({ root, fs, clock });
	const ledger = new EvidenceLedger({
		root,
		fs,
		clock,
		signer: createEd25519Signer(
			'flauz-fixture-ed25519-1',
			nodeFsSync.readFileSync(nodePath.join(KEYS_DIR, 'ed25519-private.pem'), { encoding: 'utf-8' }),
			nodeFsSync.readFileSync(nodePath.join(KEYS_DIR, 'ed25519-public.pem'), { encoding: 'utf-8' }),
		),
		checkpointInterval: 0,
	});
	const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
	const memory = new MemoryStore({ root, fs, clock });
	await tasks.bootstrap();
	await ledger.ensure();
	await memory.ensure();
	await fs.mkdir(`${root}/.flauz/workflows`);
	const registry = new ModelCapabilityRegistry({ root, fs, clock });
	await registry.load();
	const router = new ModelRouter({ stateDir: `${root}/.flauz/models`, fs, clock, records: () => registry.list(), policy: await readJourneyPolicyFromDisk(fs, root) });
	const store = new OrchestrationStore(root, { clock, taskPort: journeyTaskPort(tasks, ledger) });
	const bus = new A2ABus(root);
	const sink = new JourneyEffectSink(`${root}/.flauz/journey-sink.jsonl`, effects, freeze);
	const envRegistry = new EnvironmentRegistry({ root, fs, clock });
	await envRegistry.bootstrap();
	const localExecutor = new LocalProcessExecutor({
		root,
		fs,
		process: nodeProcessPort,
		hash: nodeHashPort,
		clock,
		harnessPath: HARNESS_PATH,
		heartbeatMs: 200,
		startTimeoutMs: 15_000,
		stopTimeoutMs: 5_000,
	});
	const cloud = new CloudHttpExecutor({
		root,
		http: envNodeHttpPort as HttpPort,
		secrets: { resolve: async ref => ref === 'vault:flauz-journey-key' ? 'journey-cloud-key-material' : undefined },
		baseUrl: `http://127.0.0.1:${String(providerPort)}`,
		fs,
		hash: nodeHashPort,
		clock,
		requestTimeoutMs: 5_000,
	});
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock, executors: [localExecutor, cloud], providerRetryWait: async () => undefined });
	await envManager.bootstrap();
	return { root, fs, clock, tasks, ledger, workflows, memory, store, bus, sink, envRegistry, envManager, router };
}

/** Reads the on-disk bus journal lines (the shared A2A surface). */
async function readBusMessages(root: string): Promise<A2aMessage[]> {
	const raw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' });
	return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as A2aMessage);
}

/** Reads the on-disk orchestration journal (raw; the store's own loader is the strict reader). */
async function readJournalOnDisk(root: string): Promise<JournalRow[]> {
	const raw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'orchestration', 'journal.jsonl'), { encoding: 'utf-8' });
	return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as JournalRow);
}

async function readJournalRecords(root: string): Promise<SessionJournalRecord[]> {
	const journalPath = nodePath.join(root, '.flauz', 'browser-sessions.jsonl');
	let raw: string;
	try {
		raw = await nodeFs.readFile(journalPath, { encoding: 'utf-8' });
	} catch (err) {
		if ((err as { code?: string }).code === 'ENOENT') {
			return [];
		}
		throw err;
	}
	const records: SessionJournalRecord[] = [];
	for (const line of raw.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		records.push(JSON.parse(line) as SessionJournalRecord);
	}
	return records;
}

async function readEnvLifecycleState(root: string, id: string): Promise<string> {
	const lifecyclePath = nodePath.join(root, '.flauz', 'environments-lifecycle.json');
	const raw = await nodeFs.readFile(lifecyclePath, { encoding: 'utf-8' });
	const envelope = JSON.parse(raw) as { entries?: Record<string, { state?: string }> };
	const entry = envelope.entries?.[id];
	return typeof entry?.state === 'string' ? entry.state : '<missing>';
}

interface EnvOpLine {
	readonly op?: string;
	readonly result?: string;
	readonly actor?: string;
	readonly toState?: string;
	readonly error?: { readonly code?: string; readonly message?: string };
}

async function readEnvOps(root: string): Promise<EnvOpLine[]> {
	const opsPath = nodePath.join(root, '.flauz', 'environments-ops.jsonl');
	let raw: string;
	try {
		raw = await nodeFs.readFile(opsPath, { encoding: 'utf-8' });
	} catch (err) {
		if ((err as { code?: string }).code === 'ENOENT') {
			return [];
		}
		throw err;
	}
	const ops: EnvOpLine[] = [];
	for (const line of raw.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		ops.push(JSON.parse(line) as EnvOpLine);
	}
	return ops;
}

function opErrorCode(outcome: EnvironmentOpOutcome): string {
	return outcome.ok === false ? outcome.error.code : '';
}

/** One provider-attempt wait observation (the injected wait port; never a real sleep). */
interface WaitObservation {
	readonly ms: number;
}

// ---------------------------------------------------------------------------
// The child-process machinery (the JOURNEY-CHILD line protocol)
// ---------------------------------------------------------------------------

interface DrillChild {
	kill9(): void;
	waitExit(timeoutMs: number): Promise<number | null>;
	waitFor(kind: string, timeoutMs: number): Promise<Record<string, unknown>>;
}

function drillAssertFail(label: string, detail: string): void {
	failures += 1;
	console.error(`p2-002 journey drill: FAIL ${label} -- ${detail}`);
}

function spawnJourneyChild(role: string, args: readonly string[], env: Record<string, string>): DrillChild {
	const child = spawn(process.execPath, ['--experimental-strip-types', nodePath.join(repoRootFromHere(), 'build', 'flauz', 'journey', 'journey.drill.ts'), '--child', role, ...args], {
		env: { ...process.env, ...env },
		stdio: ['ignore', 'pipe', 'pipe'],
		cwd: repoRootFromHere(),
	});
	// capture the exit code EAGERLY (attaching 'close' only inside waitExit races
	// with fast-exiting children and silently resolves null)
	let closedCode: number | null | undefined = undefined;
	child.on('close', code => {
		closedCode = code;
	});
	const reports = new Map<string, Array<Record<string, unknown>>>();
	const waiters: Array<{ kind: string; resolve: (payload: Record<string, unknown>) => void }> = [];
	let stdoutRest = '';
	let stderrTail = '';
	child.stdout?.setEncoding('utf-8');
	child.stdout?.on('data', (chunk: string) => {
		stdoutRest += chunk;
		const lines = stdoutRest.split('\n');
		stdoutRest = lines.pop() ?? '';
		for (const line of lines) {
			if (!line.startsWith('JOURNEY-CHILD ')) {
				if (line.length > 0) {
					console.log(`p2-002 journey drill: CHILD[${role}] ${line}`);
				}
				continue;
			}
			const parts = line.slice('JOURNEY-CHILD '.length).split(' ');
			const reportRole = parts.shift() ?? '';
			const kind = parts.shift() ?? '';
			const payload = JSON.parse(parts.join(' ') || '{}') as Record<string, unknown>;
			if (reportRole !== role) {
				continue;
			}
			const list = reports.get(kind) ?? [];
			list.push(payload);
			reports.set(kind, list);
			for (let i = waiters.length - 1; i >= 0; i -= 1) {
				if (waiters[i]?.kind === kind) {
					const waiter = waiters[i];
					waiters.splice(i, 1);
					waiter.resolve(payload);
				}
			}
		}
	});
	child.stderr?.setEncoding('utf-8');
	child.stderr?.on('data', (chunk: string) => {
		stderrTail += chunk;
		if (stderrTail.length > 4000) {
			stderrTail = stderrTail.slice(-4000);
		}
	});
	return {
		kill9: () => {
			child.kill('SIGKILL');
		},
		waitExit: timeoutMs => new Promise(resolve => {
			if (closedCode !== undefined) {
				resolve(closedCode);
				return;
			}
			const timer = setTimeout(() => resolve(null), timeoutMs);
			child.on('close', code => {
				clearTimeout(timer);
				resolve(code);
			});
		}),
		waitFor: (kind, timeoutMs) => new Promise(resolve => {
			const existing = reports.get(kind);
			if (existing !== undefined && existing.length > 0) {
				resolve(existing[existing.length - 1] as Record<string, unknown>);
				return;
			}
			const timer = setTimeout(() => {
				drillAssertFail(`child ${role} report`, `timed out waiting for report kind '${kind}' (stderr tail: ${stderrTail.slice(-500)})`);
				resolve({});
			}, timeoutMs);
			waiters.push({
				kind,
				resolve: payload => {
					clearTimeout(timer);
					resolve(payload);
				},
			});
		}),
	};
}

// ===========================================================================
// CHILD MODE (never run by hand)
// ===========================================================================

async function runChildMode(role: string, args: ReadonlyMap<string, string>): Promise<void> {
	const root = args.get('--root') ?? '';
	if (root === '') {
		console.error('p2-002 journey drill: --child requires --root <dir>');
		process.exit(2);
	}
	if (role === 'finisher') {
		await childFinisher(root, Number.parseInt(args.get('--provider-port') ?? '0', 10));
		return;
	}
	if (role === 'cancel-flight') {
		await childCancelFlight(root);
		return;
	}
	console.error(`p2-002 journey drill: unknown child role '${role}'`);
	process.exit(2);
}

function childReport(role: string, kind: string, payload: Record<string, unknown>): void {
	console.log(`JOURNEY-CHILD ${role} ${kind} ${JSON.stringify(payload)}`);
}

/**
 * finisher: boots FRESH service instances on the shared root and drives the
 * mission graph into the crash window -- the final step's effect SETTLES
 * durably (the sink log line) and then the child FREEZES before driveGraph
 * can journal the step transition (reports WINDOW-ARMED and idles; the
 * parent SIGKILLs this process = true process death inside the window).
 */
async function childFinisher(root: string, providerPort: number): Promise<void> {
	const effects = new Map<string, StepEffectFn>();
	effects.set('G-001/S-05', () => ({ ok: true, value: 'journey final assembly complete' }));
	// the crash window hook: the S-05 effect settles durably, the sink FREEZES
	// before driveGraph can journal the step transition, this process reports
	// the window facts and idles until the parent SIGKILLs it
	let stateRef: JourneyState | undefined;
	const freeze: FreezeHook = {
		matchesKey: key => key.startsWith('flauz-orch/G-001/S-05/run/'),
		onFreeze: () => {
			const state = stateRef;
			if (state === undefined) {
				childReport('finisher', 'ERROR', { stage: 'freeze-before-boot' });
				process.exit(1);
			}
			childReport('finisher', 'WINDOW-ARMED', {
				journalRows: state.store.journalRows.length,
				s05Status: state.store.stateOf('G-001').steps['S-05']?.status ?? '',
				sinkLogLines: state.sink.readLog().length,
			});
		},
	};
	const state = await bootJourney(root, effects, providerPort, freeze);
	stateRef = state;
	// the crash window composition: S-05 was granted its approval by the
	// parent BEFORE this child spawned; the drive starts the final step and
	// freezes inside the sink (the journal append never happens here).
	const drive = await driveGraph(state.store, { graphId: 'G-001', sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:finisher', now: state.clock(), wait: async () => undefined });
	void drive;
	childReport('finisher', 'ERROR', { stage: 'drive-returned-past-the-freeze' });
}

/**
 * cancel-flight: boots fresh instances on the shared root and re-runs the
 * saved workflow fragment W-001 (the product's Run Workflow surface); tool 1
 * blocks on the GO file (REAL mid-flight in a REAL process); the parent
 * cancels the run task through the task machine; the child reports the
 * post-cancel truth (the INV-3 cross-process pattern).
 */
async function childCancelFlight(root: string): Promise<void> {
	const state = await bootJourney(root, new Map(), 0);
	let executorCalls = 0;
	let runTaskId = '';
	const goPath = nodePath.join(root, 'CANCEL-GO');
	const executor: ToolExecutorPort = async step => {
		executorCalls += 1;
		if (step.seq === 1) {
			const tasksNow = await state.tasks.listTasks();
			const seedTaskId = process.env['FLAUZ_JOURNEY_SEED_TASK'] ?? '';
			const flight = [...tasksNow].reverse().find(candidate => candidate.id !== seedTaskId);
			runTaskId = flight?.id ?? '';
			childReport('cancel-flight', 'TASK', { taskId: runTaskId });
			childReport('cancel-flight', 'TOOL-START', { seq: 1 });
			const deadline = Date.now() + 90_000;
			while (!nodeFsSync.existsSync(goPath)) {
				if (Date.now() > deadline) {
					childReport('cancel-flight', 'ERROR', { stage: 'go-timeout' });
					process.exit(1);
				}
				await sleep(20);
			}
		} else {
			childReport('cancel-flight', 'TOOL-START', { seq: step.seq });
		}
		return { ok: true, output: `journey-cancel-flight-tool-${String(step.seq)}-output` };
	};
	const ask: ApprovalPort = async () => 'approve';
	let crashMessage = '<no crash>';
	try {
		await state.workflows.run({ workflowId: 'W-001', executor, approvals: 'ask', ask });
	} catch (err) {
		crashMessage = err instanceof Error ? err.message : String(err);
	}
	const finalTask = runTaskId === '' ? undefined : await state.tasks.getTask(runTaskId);
	childReport('cancel-flight', 'REPORT', {
		taskId: runTaskId,
		toolCalls: executorCalls,
		crashTyped: crashMessage.includes('flauz.tasks/v0') || crashMessage.includes("status 'cancelled'"),
		crashExcerpt: crashMessage.slice(0, 160),
		finalStatus: finalTask?.status ?? '',
		cancelEventActor: finalTask?.events.find(event => event.type === 'cancel')?.actor ?? '',
	});
}

// ===========================================================================
// SELFTEST MODE (zero-dep machinery self-test; no Chromium, no sockets)
// ===========================================================================

async function runSelftest(): Promise<void> {
	// (a) the verdict assembly counts pass/fail and names the first failing check
	const recorder = new LegRecorder(14, 'runtime-real');
	recorder.check('selftest.check-pass', true, 'a passing check');
	recorder.check('selftest.check-fail', false, 'a failing check');
	const verdict = recorder.buildVerdict();
	drillAssert(verdict.verdict === 'FAIL' && verdict.assertions.pass === 1 && verdict.assertions.fail === 1 && (verdict.firstFailing ?? '').startsWith('selftest.check-fail'), 'selftest: verdict assembly counts pass/fail and names the first failing check', JSON.stringify(verdict));
	// (b) the SKIP path carries the reason and drops the level honestly
	const skipRecorder = new LegRecorder(13, 'runtime-real');
	skipRecorder.check('selftest.skip-check', true, 'a passing check on a skipped leg');
	const skipVerdict = skipRecorder.buildVerdict({ verdict: 'SKIP', skipReason: 'selftest: no FLAUZ_CDP_ENDPOINT' });
	drillAssert(skipVerdict.verdict === 'SKIP' && skipVerdict.evidenceLevel === 'unavailable' && (skipVerdict.skipReason ?? '') === 'selftest: no FLAUZ_CDP_ENDPOINT', 'selftest: SKIP carries the reason and never claims a level', JSON.stringify(skipVerdict));
	// (c) the child-report line parser (the JOURNEY-CHILD protocol)
	const line = 'JOURNEY-CHILD finisher WINDOW-ARMED {"journalRows":42,"s05Status":"running"}';
	const parts = line.slice('JOURNEY-CHILD '.length).split(' ');
	const reportRole = parts.shift() ?? '';
	const kind = parts.shift() ?? '';
	const payload = JSON.parse(parts.join(' ') || '{}') as Record<string, unknown>;
	drillAssert(reportRole === 'finisher' && kind === 'WINDOW-ARMED' && payload['journalRows'] === 42 && payload['s05Status'] === 'running', 'selftest: the child-report line parser splits role/kind/payload', `${reportRole} ${kind} ${JSON.stringify(payload)}`);
	// (d) the leg catalogue: exactly the 14 canonical legs, in order
	drillAssert(LEGS.length === 14 && LEGS.every((entry, index) => entry.leg === index + 1), 'selftest: the catalogue carries exactly the 14 canonical legs in order', `legs=${String(LEGS.length)}`);
	console.log('p2-002 journey drill: selftest GREEN (machinery verified: verdict assembly, SKIP honesty, child line protocol, leg catalogue)');
}

// ===========================================================================
// THE JOURNEY (one shared state, fourteen legs in order)
// ===========================================================================

async function runJourney(): Promise<void> {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-p2-002-journey-'));
	const effects = new Map<string, StepEffectFn>();
	const providerWaits: WaitObservation[] = [];
	const fakeWait = async (ms: number): Promise<void> => {
		providerWaits.push({ ms });
	};

	// shared journey facts (captured by the effect closures and asserted across legs)
	let missionTaskId = '';
	let missionGraphId = '';
	let planningEchoText = '';
	let briefResourceUri = 'journey-brief.md';
	let briefReadBack: string | undefined;
	let workerEvidenceId = '';
	let journalRowsAtDeath = 0;
	let ledgerRowsAtDeath = 0;
	let seedTaskId = '';
	let cancelRunTaskId = '';

	const localServer = await startLocalServer();
	const providerServer = await startProviderServer();
	info(`local origin server 127.0.0.1:${String(localServer.port)} (the allowed host); the denied host https://blocked.invalid/ is outside every allowlist`);
	info(`journey provider server 127.0.0.1:${String(providerServer.port)} (OpenAI-compatible + cloud-sandbox wire)`);

	// ---- the scripted effects (the sink executes them; settled keys replay) ----

	// LEG 5: S-01 drafts the journey brief (the resource edit + read on the real fs)
	effects.set('G-001/S-01', async () => {
		const briefContent = `# Journey brief\n\n${planningEchoText}\n\n- mission: ${MISSION_TITLE}\n- task: ${missionTaskId}\n`;
		await nodeFs.writeFile(nodePath.join(root, briefResourceUri), briefContent, { encoding: 'utf-8' });
		briefReadBack = await nodeFs.readFile(nodePath.join(root, briefResourceUri), { encoding: 'utf-8' });
		return { ok: true, value: `brief drafted (${String(briefReadBack.length)} bytes)` };
	});

	// LEG 11: S-04 is the provider-reliant step: its effect calls the REAL
	// openAiCompat adapter over the REAL socket; the server's scripted 500s
	// surface the typed provider error that feeds the bounded retry window.
	effects.set('G-001/S-04', async () => {
		const adapter = journeyAdapter(providerServer.port);
		const parts: string[] = [];
		try {
			for await (const event of adapter.stream({ modelId: JOURNEY_MODEL_ID, messages: [{ role: 'user', content: [{ kind: 'text', value: 'enrich the journey brief' }] }] })) {
				if (event.type === 'text-delta') {
					parts.push(event.text);
				}
			}
			return { ok: true, value: `provider-reliant enrichment recovered: ${parts.join('')}` };
		} catch (err) {
			return providerFailureFrom(err);
		}
	});

	// LEG 11 (b): the exhaustion probe -- the provider fails beyond the bound.
	effects.set('G-002/S-01', async () => {
		const adapter = journeyAdapter(providerServer.port);
		try {
			for await (const event of adapter.stream({ modelId: JOURNEY_MODEL_ID, messages: [{ role: 'user', content: [{ kind: 'text', value: 'the always-failing probe' }] }] })) {
				void event;
			}
			return { ok: true, value: 'probe unexpectedly succeeded' };
		} catch (err) {
			return providerFailureFrom(err);
		}
	});

	let state = await bootJourney(root, effects, providerServer.port);

	try {
		// =====================================================================
		// LEG 1 -- create/open workspace: the full substrate boots on real fs
		// =====================================================================
		{
			const recorder = new LegRecorder(1, 'runtime-real');
			const envelopeRaw = await state.fs.readFileUtf8(`${root}/.flauz/tasks.json`);
			const envelope = envelopeRaw === undefined ? undefined : JSON.parse(envelopeRaw) as { $schema?: string; tasks?: unknown[] };
			recorder.check('leg1.workspace-envelope-bootstrapped', envelopeRaw !== undefined && envelope?.$schema === 'flauz.tasks/v0' && Array.isArray(envelope?.tasks) === true, `the workspace root carries the bootstrapped flauz.tasks/v0 envelope (${String(envelope?.tasks?.length ?? -1)} tasks)`);
			const ledgerRaw = await state.fs.readFileUtf8(`${root}/.flauz/evidence/ledger.jsonl`);
			recorder.check('leg1.evidence-ledger-ensured', ledgerRaw !== undefined, 'the evidence ledger file exists on disk (ensure())');
			const memoryRaw = await state.fs.readFileUtf8(`${root}/.flauz/memory/session.jsonl`);
			recorder.check('leg1.memory-ensured', memoryRaw !== undefined, 'the tiered memory substrate is ensured on disk');
			const envEntries = state.envManager.entries();
			recorder.check('leg1.environment-registry-bootstrapped', Object.keys(envEntries).length === 0, 'the environment registry bootstrapped empty (a clean workspace)');
			recorder.check('leg1.orchestration-store-initialized', state.store.journalRows.length === 0 && state.store.listGraphs().length === 0 && await state.fs.readFileUtf8(`${root}/.flauz/orchestration/graphs.json`) === undefined, 'the orchestration store initialized clean (0 graphs, 0 journal rows; its on-disk home materializes with the first graph)');
			const modelsDir = await state.fs.readdir(`${root}/.flauz/models`).catch(() => [] as string[]);
			recorder.check('leg1.model-registry-materialized', modelsDir.includes('capabilities.json'), `the model capability state materialized on first load (${modelsDir.join(',')})`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 2 -- create mission/task: the mission -> task envelope
		// =====================================================================
		{
			const recorder = new LegRecorder(2, 'runtime-real');
			const submitted = await state.store.submitGraph({
				title: MISSION_TITLE,
				steps: [
					{ stepId: 'S-01', title: 'draft the journey brief', instruction: 'route the planning turn through the model fabric and draft the workspace brief resource', tool: 'flauz_terminal' },
					{ stepId: 'S-02', title: 'research the delegated slice', instruction: 'the delegated research slice, executed by the worker agent', dependsOn: ['S-01'] },
					{ stepId: 'S-03', title: 'gated release decision', instruction: 'the human-approval gate before release', dependsOn: ['S-02'], gate: 'human-approval' },
					{ stepId: 'S-04', title: 'provider-reliant enrichment', instruction: 'the enrichment step that calls the provider over the real wire', dependsOn: ['S-03'] },
					{ stepId: 'S-05', title: 'final assembly', instruction: 'assemble the journey artifacts (gated: the human approves the final assembly)', dependsOn: ['S-04'], gate: 'human-approval' },
				],
				actor: 'agent',
				origin: 'journey:p2-002',
			});
			missionGraphId = submitted.graphId;
			missionTaskId = submitted.taskId ?? '';
			await state.store.approveGraph({ graphId: missionGraphId, actor: 'human', origin: 'journey:p2-002' });

			const envelopeRaw = await state.fs.readFileUtf8(`${root}/.flauz/tasks.json`);
			recorder.check('leg2.task-envelope-persisted', envelopeRaw !== undefined && envelopeRaw.includes(missionTaskId), `the .flauz/tasks.json envelope carries the minted task ${missionTaskId}`);
			const envelope = envelopeRaw === undefined ? undefined : JSON.parse(envelopeRaw) as { tasks?: Array<{ id?: string; status?: string; events?: Array<{ type?: string; actor?: string }> }> };
			recorder.check('leg2.mission-to-task-minted', /^T-\d{3,}$/.test(missionTaskId) && envelope?.tasks?.some(task => task.id === missionTaskId) === true, `submitGraph minted the task envelope ${missionTaskId} through the orchestration surface`);
			const mintedTask = envelope?.tasks?.find(task => task.id === missionTaskId);
			recorder.check('leg2.task-spine-on-disk', mintedTask?.status === 'plan' && (mintedTask.events?.length ?? 0) >= 1 && mintedTask.events?.some(event => event.type === 'graph-submitted' && event.actor === 'agent') === true, `the persisted task ${missionTaskId} is 'plan' and carries the mirrored graph-submitted (actor agent) event on its timeline`);

			const graphsRaw = await state.fs.readFileUtf8(`${root}/.flauz/orchestration/graphs.json`);
			const graphs = graphsRaw === undefined ? undefined : JSON.parse(graphsRaw) as { graphs?: Array<{ graphId?: string; taskId?: string; steps?: unknown[] }> };
			recorder.check('leg2.graph-envelope-persisted', graphs?.graphs?.some(graph => graph.graphId === missionGraphId && graph.taskId === missionTaskId && (graph.steps?.length ?? 0) === 5) === true, `the graphs envelope persists ${missionGraphId} (5 steps) linked to ${missionTaskId}`);

			const rows = state.store.rowsFor(missionGraphId);
			recorder.check('leg2.journal-rows', rows.some(row => row.type === 'graph-submitted' && row.actor === 'agent' && (row.payload as { taskId?: string }).taskId === missionTaskId) && rows.some(row => row.type === 'graph-approved' && row.actor === 'human'), `the journal records graph-submitted (actor agent, taskId ${missionTaskId}) + graph-approved (actor human)`);

			const listed = state.store.listGraphs();
			recorder.check('leg2.graph-approved-state', listed.some(graph => graph.graphId === missionGraphId && graph.graphStatus === 'approved'), `the mission graph ${missionGraphId} is approved and ready for work`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 3 -- start agent session: state + attribution
		// =====================================================================
		{
			const recorder = new LegRecorder(3, 'runtime-real');
			const claim = await state.store.acquireClaim({ graphId: missionGraphId, stepId: 'S-01', holder: PRIMARY, actor: 'agent', origin: 'journey:session' });
			const sessionRecord = await state.memory.record('session', {
				kind: 'observation',
				content: `session opened on ${missionTaskId} by ${PRIMARY}`,
				taskId: missionTaskId,
				agentId: PRIMARY,
				provenance: { actor: 'agent', origin: 'task-event', ts: state.clock() },
			});

			const claimRow = state.store.journalRows.find(row => row.type === 'claim-acquired' && row.rowId === claim.rowId);
			recorder.check('leg3.claim-attribution', claimRow !== undefined && (claimRow.payload as { holder?: string }).holder === PRIMARY && claimRow.actor === 'agent', `the session claim row carries holder ${PRIMARY} with actor attribution`);
			const stateAfter = state.store.stateOf(missionGraphId);
			const activeClaim = (stateAfter as { claims?: Record<string, { holder?: string }> }).claims?.['S-01'];
			recorder.check('leg3.session-claim-state', activeClaim?.holder === PRIMARY, `the session claim is active in the graph state (holder ${String(activeClaim?.holder)})`);

			const sessionRecords = await state.memory.list('session');
			recorder.check('leg3.session-memory-attribution', sessionRecords.length === 1 && sessionRecords[0]?.taskId === missionTaskId && sessionRecords[0]?.agentId === PRIMARY && sessionRecords[0]?.provenance.actor === 'agent', `the session-tier memory record is attributed to task ${missionTaskId} + agent ${PRIMARY}`);

			const sessionJournalRaw = await state.fs.readFileUtf8(`${root}/.flauz/memory/session.jsonl`);
			recorder.check('leg3.session-memory-persisted', sessionJournalRaw !== undefined && sessionJournalRaw.includes(sessionRecord.record.id), `the session journal on disk carries the record ${sessionRecord.record.id}`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 4 -- choose a live provider/model: the real fabric + the real wire
		// =====================================================================
		{
			const level = LIVE_PROVIDER_BASE_URL !== '' && LIVE_PROVIDER_API_KEY !== '' && LIVE_PROVIDER_MODEL !== '' ? 'live-provider' : 'runtime-real';
			const recorder = new LegRecorder(4, level);
			// (a) the shipped zero-network default: BEFORE any override, the router
			// routes to the deterministic flauz-mock vendor (labeled, no silent fallback)
			const defaultDecision = await state.router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
			recorder.check('leg4.default-routes-zero-network', defaultDecision.selected?.providerId === 'flauz-mock' && defaultDecision.selected?.modelId === 'echo-1' && defaultDecision.ruleId === 'zero-network-default', `the pristine workspace routes to ${String(defaultDecision.selected?.providerId)}/${String(defaultDecision.selected?.modelId)} via the labeled zero-network default (decision ${defaultDecision.decisionId})`);

			// (b) the live-provider enablement act: the workspace providers file
			// (flauz.model-providers/v0) enables the OpenAI-compatible provider with a
			// vault credentialRef; the user routing rule prefers it (rules are DATA)
			await writeProviderOverrides(state.fs, `${root}/.flauz/models`, [
				{
					providerId: JOURNEY_PROVIDER_ID,
					enabled: true,
					baseUrl: `http://127.0.0.1:${String(providerServer.port)}/v1`,
					credentialRef: JOURNEY_CREDENTIAL_REF,
					models: [journeyModelDescriptor()],
				},
			], state.clock());
			await saveRoutingPolicy(state.fs, `${root}/.flauz/models`, journeyPolicy());
			// fresh registry + router over the same root: the real load path picks the override up
			const registry2 = new ModelCapabilityRegistry({ root, fs: state.fs, clock: state.clock });
			await registry2.load();
			const enabled = registry2.list().find(record => record.providerId === JOURNEY_PROVIDER_ID);
			recorder.check('leg4.providers-file-enablement', enabled !== undefined && enabled.enabled === true && enabled.source === 'providers-file', `the workspace providers file enabled ${JOURNEY_PROVIDER_ID} (source providers-file, enabled)`);
			const router2 = new ModelRouter({ stateDir: `${root}/.flauz/models`, fs: state.fs, clock: state.clock, records: () => registry2.list(), policy: journeyPolicy() });
			const liveDecision = await router2.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
			recorder.check('leg4.routes-the-live-capable-provider', liveDecision.selected?.providerId === JOURNEY_PROVIDER_ID && liveDecision.selected?.modelId === JOURNEY_MODEL_ID && liveDecision.ruleId === 'journey-live-preference', `the user rule routed to ${String(liveDecision.selected?.providerId)}/${String(liveDecision.selected?.modelId)} (decision ${liveDecision.decisionId})`);

			// (c) the REAL completion through the REAL adapter + nodeHttpPort over the
			// REAL local OpenAI-compatible wire (credentialRef resolved to the Bearer header)
			const adapter = journeyAdapter(providerServer.port);
			const parts: string[] = [];
			let finishProvenance: ResponseProvenance | undefined;
			let finishUsage: TokenUsage | undefined;
			for await (const event of adapter.stream({ modelId: JOURNEY_MODEL_ID, messages: [{ role: 'user', content: [{ kind: 'text', value: PLANNING_PROMPT }] }] })) {
				if (event.type === 'text-delta') {
					parts.push(event.text);
				}
				if (event.type === 'finish') {
					finishProvenance = event.provenance;
					finishUsage = event.usage;
				}
			}
			planningEchoText = parts.join('');
			recorder.check('leg4.real-wire-completion', planningEchoText === `journey wire echo: ${PLANNING_PROMPT}`, `the routed provider call streamed the deterministic completion over the real wire: ${planningEchoText.slice(0, 60)}...`);
			recorder.check('leg4.wire-provenance', finishProvenance?.providerId === JOURNEY_PROVIDER_ID && finishProvenance?.modelId === JOURNEY_MODEL_ID && finishProvenance?.wireFamily === 'openai-chat-completions' && typeof finishProvenance?.requestHash === 'string' && finishProvenance.requestHash.length === 64, `the finish event carries the hard-rule provenance (provider ${String(finishProvenance?.providerId)}, model ${String(finishProvenance?.modelId)}, requestHash ${String(finishProvenance?.requestHash).slice(0, 12)}...)`);
			recorder.check('leg4.wire-usage-reported', finishUsage?.reportedInputTokens === 17 && finishUsage?.reportedOutputTokens === 6, `the wire-reported usage arrived (input ${String(finishUsage?.reportedInputTokens)}, output ${String(finishUsage?.reportedOutputTokens)})`);
			const call = providerServer.chatCalls[providerServer.chatCalls.length - 1];
			recorder.check('leg4.credential-resolution-on-wire', call?.model === JOURNEY_MODEL_ID && call?.authorization === 'Bearer journey-wire-key', `the wire saw model ${String(call?.model)} under the resolved credential (Bearer; the env: vault ref resolved through the real seam)`);

			// (d) the live-provider rung hook: when the live env contract is present the
			// repo's own TL2-H1 drill runs against the real vendor; otherwise the honest
			// residue is recorded (never a fabricated live claim)
			if (level === 'live-provider') {
				const live = await import('node:child_process').then(cp => cp.spawnSync(process.execPath, ['--experimental-strip-types', LIVE_PROVIDER_DRILL], { cwd: repoRootFromHere(), encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }));
				const liveOut = `${live.stdout ?? ''}\n${live.stderr ?? ''}`;
				const routingRow = liveOut.split('\n').filter(line => line.includes('"row":"routing"')).pop() ?? '';
				recorder.check('leg4.live-provider-drill-routing-pass', live.status === 0 && routingRow.includes('"status":"pass"'), 'the TL2-H1 live-provider drill ran against the real vendor endpoint and its routing row passed');
			} else {
				recorder.note('live-provider rung not reached: no FLAUZ_LIVE_PROVIDER_BASE_URL/_API_KEY/_MODEL in this environment (the rung exists: extensions/flauz-models/test/canaries/live-provider-runtime.drill.ts; the adapter+wire path above is the same code path a live vendor uses)');
			}

			// (e) the planning output lands in the shared evidence chain
			const echoArtifactUri = `.flauz/artifacts/${missionTaskId}/planning-echo-1.txt`;
			await state.fs.mkdir(`${root}/.flauz/artifacts/${missionTaskId}`);
			await state.fs.writeFile(`${root}/${echoArtifactUri}`, planningEchoText);
			const appended = await state.ledger.append(missionTaskId, { kind: 'note', uri: echoArtifactUri, sha256: sha256Hex(planningEchoText), note: 'the routed provider planning turn (real wire)' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri: echoArtifactUri, sha256: sha256Hex(planningEchoText), note: 'the routed provider planning turn (real wire)' });
			recorder.check('leg4.evidence-minted', appended.evidenceId !== '' && (await state.ledger.rowByEvidenceId(appended.evidenceId))?.uri === echoArtifactUri, `the planning turn minted evidence row ${appended.evidenceId}`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 5 -- edit/read workspace resources (the real fs round-trip)
		// =====================================================================
		{
			const recorder = new LegRecorder(5, 'runtime-real');
			const start = await state.store.startStep({ graphId: missionGraphId, stepId: 'S-01', runnerId: PRIMARY, actor: 'agent', origin: 'journey:brief' });
			const effect = await state.sink.run(start.idempotencyKey, {
				graphId: missionGraphId,
				stepId: 'S-01',
				attempt: start.attempt,
				tool: 'flauz_terminal',
				toolInput: null,
				instruction: 'route the planning turn through the model fabric and draft the workspace brief resource',
			});
			const finished = await state.store.finishStep({
				graphId: missionGraphId,
				stepId: 'S-01',
				attempt: start.attempt,
				outcome: 'succeeded',
				output: String(effect.value ?? ''),
				evidence: [{ kind: 'note', uri: `flauz-orch-effect://${missionGraphId}/S-01/run/${String(start.attempt)}`, sha256: sha256Hex(String(effect.value ?? '')) }],
				actor: 'agent',
				origin: 'journey:brief',
			});

			const briefOnDisk = await state.fs.readFileUtf8(`${root}/${briefResourceUri}`);
			recorder.check('leg5.resource-round-trip', briefReadBack !== undefined && briefOnDisk === briefReadBack && (briefReadBack?.includes(missionTaskId) ?? false), `the workspace resource ${briefResourceUri} round-trips on the real fs (${String(briefReadBack?.length)} bytes, task-pinned)`);
			recorder.check('leg5.resource-on-disk', briefOnDisk !== undefined && briefOnDisk.length === (briefReadBack?.length ?? -1) && briefOnDisk.length > 0, `the edited resource is persisted on disk (${String(briefOnDisk?.length)} bytes)`);
			recorder.check('leg5.step-started-attribution', (state.store.journalRows.find(row => row.type === 'step-started' && row.rowId === start.rowId)?.payload as { runnerId?: string } | undefined)?.runnerId === PRIMARY, `the tool step started with runner attribution ${PRIMARY}`);
			recorder.check('leg5.effect-idempotency-key', start.idempotencyKey === `flauz-orch/${missionGraphId}/S-01/run/${String(start.attempt)}` && state.sink.freshExecutionsInLog(start.idempotencyKey) === 1, `the effect settled exactly once on its idempotency key ${start.idempotencyKey}`);
			recorder.check('leg5.step-succeeded', finished.type === 'step-succeeded' && state.store.stateOf(missionGraphId).steps['S-01']?.status === 'succeeded', `the brief-drafting step S-01 succeeded (row ${finished.rowId})`);

			const briefContent = briefReadBack ?? '';
			const changeset = await state.ledger.append(missionTaskId, { kind: 'changeset', uri: briefResourceUri, sha256: sha256Hex(briefContent), note: 'the journey brief resource edit' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: changeset.evidenceId, seq: changeset.seq, kind: 'changeset', uri: briefResourceUri, sha256: sha256Hex(briefContent), note: 'the journey brief resource edit' });
			const missionTask = await state.tasks.getTask(missionTaskId);
			recorder.check('leg5.changeset-linkage', (await state.ledger.rowByEvidenceId(changeset.evidenceId))?.uri === briefResourceUri && missionTask.changes.some(change => change.uri === briefResourceUri), `the resource edit minted changeset evidence ${changeset.evidenceId} and the task carries the change ${briefResourceUri}`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 6 -- use browser: real CDP against a real headless Chromium
		// =====================================================================
		{
			const recorder = new LegRecorder(6, 'runtime-real');
			if (ENDPOINT === '') {
				recorder.note('browser leg SKIP: no FLAUZ_CDP_ENDPOINT in this environment (a real headless Chromium CDP WebSocket endpoint is required; see the header for the launch pattern)');
				await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts', { verdict: 'SKIP', skipReason: 'no FLAUZ_CDP_ENDPOINT (the browser leg needs a real headless Chromium CDP WebSocket endpoint)' });
			} else {
				const origin = `http://127.0.0.1:${String(localServer.port)}`;
				const transports: RecordingWebSocketCdpTransport[] = [];
				const browser = new BrowserSessionManager({
					engine: () => BrowserPolicyEngine.fromPolicyText(RUNTIME_POLICY),
					host: new CdpEndpointHost(ENDPOINT, {
						transportFactory: url => {
							const transport = new RecordingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
							transports.push(transport);
							return transport;
						},
					}),
					workspaceRoot: root,
					journal: new FileSystemSessionJournal(root),
					clock: () => FIXED_BROWSER_TS,
					commandTimeoutMs: COMMAND_TIMEOUT_MS,
					navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
				});
				const opened = await browser.open({ initiator: 'agent', agentId: PRIMARY });
				recorder.check('leg6.session-opens-active', !isSessionError(opened) && (opened as OpenSessionResult).descriptor.state === 'active', `the agent browser session opened ACTIVE on the real Chromium (${(opened as OpenSessionResult).descriptor.sessionId})`);
				const sessionId = (opened as OpenSessionResult).descriptor.sessionId;
				const navigation = await browser.navigate(sessionId, `${origin}/journey`);
				recorder.check('leg6.allowed-navigation-commits', isNavigationOutcome(navigation) && (navigation as NavigationOutcome).verdict.decision === 'allow' && (navigation as NavigationOutcome).committedUrl === `${origin}/journey`, `the allowed navigation COMMITTED on the real Chromium (Page.navigate -> committed URL ${String((navigation as NavigationOutcome).committedUrl)})`);
				const wireDrives = transports.flatMap(transport => transport.sentFrames).filter(frame => frame.method === 'Page.navigate');
				recorder.check('leg6.one-wire-drive', wireDrives.length === 1, `exactly ONE Page.navigate drive command hit the real wire (${String(wireDrives.length)})`);

				// the fail-closed denial probe: a denied navigation sends ZERO CDP commands
				const denied = await browser.navigate(sessionId, 'https://blocked.invalid/');
				const framesAfterDeny = transports.flatMap(transport => transport.sentFrames).filter(frame => frame.method === 'Page.navigate');
				recorder.check('leg6.fail-closed-denial', isNavigationOutcome(denied) && (denied as NavigationOutcome).verdict.decision === 'deny' && (denied as NavigationOutcome).sent === false && framesAfterDeny.length === 1, `the denied navigation produced a deny verdict with ZERO additional Page.navigate frames on the real wire (frames ${String(framesAfterDeny.length)})`);

				await browser.close(sessionId);
				await browser.dispose();
				const journalRecords = await readJournalRecords(root);
				recorder.check('leg6.session-journal-on-disk', journalRecords.length >= 2, `the browser session journal persisted ${String(journalRecords.length)} records on disk (open/navigate/close events; the journal is the session's on-disk evidence)`);
				const journalRaw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'browser-sessions.jsonl'), { encoding: 'utf-8' });
				const browserJournalHash = sha256Hex(journalRaw);
				const browserEvidence = await state.ledger.append(missionTaskId, { kind: 'note', uri: '.flauz/browser-sessions.jsonl', sha256: browserJournalHash, note: 'the agent browser session journal (real CDP over real Chromium)' });
				await state.tasks.recordEvidence(missionTaskId, { evidenceId: browserEvidence.evidenceId, seq: browserEvidence.seq, kind: 'note', uri: '.flauz/browser-sessions.jsonl', sha256: browserJournalHash, note: 'the agent browser session journal (real CDP over real Chromium)' });
				recorder.check('leg6.browser-evidence-minted', (await state.ledger.rowByEvidenceId(browserEvidence.evidenceId))?.sha256 === browserJournalHash, `the browser session journal is hash-pinned into the shared evidence chain (${browserEvidence.evidenceId})`);
				await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
			}
		}

		// =====================================================================
		// LEG 7 -- create/use environment: real grandchild harness processes
		// =====================================================================
		{
			const recorder = new LegRecorder(7, 'runtime-real');
			await state.envRegistry.register({
				id: ENV_ID,
				kind: ENV_KIND,
				label: 'P2-002 Journey Local',
				connection: { authorityPrefix: 'flauz-local' },
				trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
				capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
			});
			const created = await state.envManager.perform('create', { id: ENV_ID, actor: 'agent' });
			recorder.check('leg7.environment-created', created.ok, `the local environment created (code ${opErrorCode(created)})`);
			const started = await state.envManager.perform('start', { id: ENV_ID, actor: 'agent' });
			recorder.check('leg7.environment-started', started.ok && await readEnvLifecycleState(root, ENV_ID) === 'running', `the local environment started (state '${await readEnvLifecycleState(root, ENV_ID)}')`);
			const stateRaw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'env-state', ENV_ID, 'state.json'), { encoding: 'utf-8' });
			const envState = JSON.parse(stateRaw) as { status?: string; pid?: number; environmentId?: string; schema?: string };
			recorder.check('leg7.real-grandchild-process', envState.status === 'running' && typeof envState.pid === 'number' && nodeProcessPort.isPidAlive(envState.pid) === true && envState.environmentId === ENV_ID && envState.schema === 'flauz.env-state/v0', `a REAL harness process is running (pid ${String(envState.pid)}, state file ${String(envState.schema)})`);
			const stopped = await state.envManager.perform('stop', { id: ENV_ID, actor: 'agent' });
			const stateAfterStop = await nodeFs.readFile(nodePath.join(root, '.flauz', 'env-state', ENV_ID, 'state.json'), { encoding: 'utf-8' });
			const envStateAfter = JSON.parse(stateAfterStop) as { status?: string };
			recorder.check('leg7.environment-stopped', stopped.ok && await readEnvLifecycleState(root, ENV_ID) === 'stopped' && envStateAfter.status === 'stopped', `the environment stopped gracefully (lifecycle '${await readEnvLifecycleState(root, ENV_ID)}', harness state '${String(envStateAfter.status)}')`);
			const ops = await readEnvOps(root);
			const envOps = ops.filter(op => op.actor === 'agent' && (op.result === 'ok' || op.result === 'error'));
			recorder.check('leg7.provenance-carrying-ops', envOps.length >= 3 && envOps.every(op => op.actor === 'agent'), `every lifecycle op carries provenance (actor agent on ${String(envOps.length)} op rows: ${envOps.map(op => `${String(op.op)}->${String(op.toState)}`).join(',')})`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 8 -- A2A delegation: the real on-disk bus round-trip
		// =====================================================================
		{
			const recorder = new LegRecorder(8, 'runtime-real');
			const ledgerRowsBefore = (await state.ledger.readRows()).length;

			const delegation = await delegateStep(state.store, state.bus, {
				graphId: missionGraphId,
				stepId: 'S-02',
				targetAgent: WORKER_1,
				reason: 'capability-match',
				details: { requiredCapability: 'journey-research', matched: [WORKER_1] },
				fromAgent: PRIMARY,
				origin: 'journey:delegation',
			});

			// the worker executes the delegated slice: its own artifact + evidence in the SHARED ledger
			const workerArtifactUri = `.flauz/artifacts/${missionTaskId}/worker-research-1.txt`;
			const workerOutput = `delegated research slice complete for ${MISSION_TITLE}`;
			await state.fs.writeFile(`${root}/${workerArtifactUri}`, workerOutput);
			const workerEvidence = await state.ledger.append(missionTaskId, { kind: 'command-output', uri: workerArtifactUri, sha256: sha256Hex(workerOutput), note: 'the delegated research slice (worker)' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: workerEvidence.evidenceId, seq: workerEvidence.seq, kind: 'command-output', uri: workerArtifactUri, sha256: sha256Hex(workerOutput), note: 'the delegated research slice (worker)' });
			workerEvidenceId = workerEvidence.evidenceId;

			// the worker reports back over the real bus (the typed result-report)
			const report = await state.bus.post({
				message: {
					kind: 'result-report',
					from: WORKER_1,
					to: PRIMARY,
					payload: { taskId: missionTaskId, outcome: 'ok', evidenceIds: [workerEvidenceId], summary: workerOutput },
				},
			});
			const ingested = await ingestResultReport(state.store, {
				graphId: missionGraphId,
				stepId: 'S-02',
				messageId: report.id,
				outcome: 'ok',
				summary: workerOutput,
				evidenceIds: [workerEvidenceId],
				fromAgent: WORKER_1,
			});

			const decisionRow = state.store.journalRows.find(row => row.type === 'route-decided' && row.rowId === delegation.decisionRowId);
			recorder.check('leg8.routing-decision-recorded', (decisionRow?.payload as { targetAgent?: string; reason?: string } | undefined)?.targetAgent === WORKER_1 && decisionRow !== undefined && (decisionRow.payload as { reason?: string }).reason === 'capability-match', `the routing decision row records WHY ${WORKER_1} (reason capability-match)`);
			const receiptRow = state.store.journalRows.find(row => row.type === 'delegation-sent' && row.rowId === delegation.receiptRowId);
			recorder.check('leg8.delegation-receipt-linked', receiptRow !== undefined && (receiptRow.payload as { messageId?: string; decisionRowId?: string }).messageId === delegation.messageId && (receiptRow.payload as { decisionRowId?: string }).decisionRowId === delegation.decisionRowId, `the delegation-sent receipt links decision row ${delegation.decisionRowId} + bus message ${delegation.messageId}`);
			const resultRow = state.store.journalRows.find(row => row.type === 'result-received' && row.rowId === ingested.receiptRowId);
			recorder.check('leg8.result-attribution', resultRow !== undefined && resultRow.origin === `a2a:${WORKER_1}` && (resultRow.payload as { evidenceIds?: string[] }).evidenceIds?.[0] === workerEvidenceId, `the result-received row carries the delegate attribution origin ${String(resultRow?.origin)}`);

			const busMessages = await readBusMessages(root);
			const delegationMessage = busMessages.find(message => message.id === delegation.messageId);
			const reportMessage = busMessages.find(message => message.id === report.id);
			recorder.check('leg8.bus-round-trip', delegationMessage?.kind === 'task-delegation' && delegationMessage?.from === PRIMARY && delegationMessage?.to === WORKER_1 && reportMessage?.kind === 'result-report' && reportMessage?.from === WORKER_1 && reportMessage?.to === PRIMARY, `the typed A2A round-trip landed on the shared on-disk bus journal (${String(delegationMessage?.kind)} ${String(delegationMessage?.id)} + ${String(reportMessage?.kind)} ${String(reportMessage?.id)})`);

			const delegatedStep = state.store.stateOf(missionGraphId).steps['S-02'];
			recorder.check('leg8.delegated-step-succeeded', delegatedStep?.status === 'succeeded' && delegatedStep?.runnerId === WORKER_1, `the delegated step S-02 succeeded with runner ${String(delegatedStep?.runnerId)}`);
			const workerRow = await state.ledger.rowByEvidenceId(workerEvidenceId);
			recorder.check('leg8.evidence-attribution', workerRow !== undefined && workerRow.taskId === missionTaskId && workerRow.uri === workerArtifactUri, `the delegate's reported evidence ${workerEvidenceId} resolves to a ledger row attributed to ${missionTaskId}`);
			const ledgerRowsAfter = await state.ledger.readRows();
			recorder.check('leg8.no-ledger-clobbering', ledgerRowsAfter.length === ledgerRowsBefore + 1 && new Set(ledgerRowsAfter.map(row => row.seq)).size === ledgerRowsAfter.length, `the shared ledger grew by exactly the worker's one row (${String(ledgerRowsBefore)} -> ${String(ledgerRowsAfter.length)}, seqs unique)`);
			const chainVerify = await state.ledger.verify();
			recorder.check('leg8.chain-intact', chainVerify.ok, `the ledger hash chain verifies after the delegation round-trip (rows ${String(chainVerify.rows)})`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 9 -- require/handle approval or takeover: FAIL-CLOSED + takeover
		// =====================================================================
		{
			const recorder = new LegRecorder(9, 'runtime-real');
			// (a) the gate arms and the drive STOPS: no approval = no execution
			const gateDrive = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:gate', now: state.clock(), wait: fakeWait });
			const approvalRow = state.store.journalRows.find(row => row.type === 'approval-requested' && row.graphId === missionGraphId && row.stepId === 'S-03');
			recorder.check('leg9.gate-arms-fail-closed', approvalRow !== undefined && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'awaiting-approval' && gateDrive.started.length === 0, `the human-approval gate armed on S-03 (row ${String(approvalRow?.rowId)}) and the drive executed zero steps`);
			recorder.check('leg9.no-execution-without-approval', state.sink.callsForStep(missionGraphId, 'S-03') === 0 && state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-03') === false, 'FAIL-CLOSED: the gated step never started (no approval = no execution)');

			// (b) the human INTERRUPTS the pending gate and TAKES the step over
			const takeoverRequested = await state.store.takeoverRequest({ graphId: missionGraphId, stepId: 'S-03', actor: 'human', origin: 'journey:takeover', reason: 'the human interrupts the approval gate and takes the release decision over' });
			recorder.check('leg9.takeover-interrupts-gate', takeoverRequested.type === 'takeover-requested' && takeoverRequested.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'takeover-pending', `the interrupted gate moved to takeover-pending (row ${takeoverRequested.rowId}, actor human)`);
			const takeoverAccepted = await state.store.takeoverAccept({ graphId: missionGraphId, stepId: 'S-03', actor: 'human', origin: 'journey:takeover', note: 'the human accepts the takeover' });
			recorder.check('leg9.takeover-accepted', takeoverAccepted.type === 'takeover-accepted' && takeoverAccepted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'taken-over', 'the human-only takeover acceptance landed with attribution');
			const takeoverSummary = 'the human completed the gated release decision personally';
			const takeoverCompleted = await state.store.takeoverComplete({
				graphId: missionGraphId,
				stepId: 'S-03',
				actor: 'human',
				origin: 'journey:takeover',
				summary: takeoverSummary,
				evidence: [{ kind: 'note', uri: `flauz-orch-takeover://${missionGraphId}/S-03`, sha256: sha256Hex(takeoverSummary) }],
			});
			recorder.check('leg9.takeover-completed-attribution', takeoverCompleted.type === 'takeover-completed' && takeoverCompleted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'succeeded', `the taken-over step completed by the HUMAN (row ${takeoverCompleted.rowId}, actor human) -- never by an unapproved agent execution`);
			const takeoverEvidenceIds = (takeoverCompleted.payload as { evidence?: Array<{ evidenceId?: string }> }).evidence?.map(item => item.evidenceId ?? '') ?? [];
			const takeoverEvidenceRow = takeoverEvidenceIds[0] === undefined || takeoverEvidenceIds[0] === '' ? undefined : await state.ledger.rowByEvidenceId(takeoverEvidenceIds[0]);
			recorder.check('leg9.takeover-evidence-minted', takeoverEvidenceRow !== undefined && takeoverEvidenceRow.uri === `flauz-orch-takeover://${missionGraphId}/S-03`, `the takeover minted evidence ${String(takeoverEvidenceIds[0])} into the shared chain`);
			recorder.check('leg9.gate-never-unlocked-agent-run', state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-03') === false && state.sink.callsForStep(missionGraphId, 'S-03') === 0, 'the gate stayed FAIL-CLOSED end to end: the step was completed by the human takeover, never by agent execution');
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 10 -- produce artifact/evidence: the run's distilled provenance
		// =====================================================================
		{
			const recorder = new LegRecorder(10, 'runtime-real');
			// (a) a note row + its artifact
			const noteArtifactUri = `.flauz/artifacts/${missionTaskId}/journey-note-1.txt`;
			const noteText = `journey midpoint provenance note for ${missionTaskId}`;
			await state.fs.writeFile(`${root}/${noteArtifactUri}`, noteText);
			const noteRow = await state.ledger.append(missionTaskId, { kind: 'note', uri: noteArtifactUri, sha256: sha256Hex(noteText), note: 'the journey midpoint note' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: noteRow.evidenceId, seq: noteRow.seq, kind: 'note', uri: noteArtifactUri, sha256: sha256Hex(noteText), note: 'the journey midpoint note' });

			// (b) a SIGNED ledger checkpoint (the committed fixture-signer posture)
			const checkpoint = await state.ledger.appendCheckpoint();
			const checkpointRow = checkpoint.row;
			recorder.check('leg10.checkpoint-signed', checkpointRow.kind === 'checkpoint' && checkpointRow.checkpoint !== undefined && checkpointRow.checkpoint.algorithm === 'ed25519', `the signed checkpoint row ${checkpoint.evidenceId} carries the ed25519 payload (key ${String(checkpointRow.checkpoint?.keyId)})`);

			// (c) the mission workflow fragment: the run's distilled provenance
			const savedFragment = await state.workflows.save({ taskId: missionTaskId });
			const fragments = await state.workflows.list();
			recorder.check('leg10.fragment-saved', fragments.some(fragment => fragment.id === savedFragment.workflowId && fragment.source.taskId === missionTaskId), `the mission's distilled provenance saved as fragment ${savedFragment.workflowId} (task ${missionTaskId})`);

			// (d) the seed task + fragment W-001 (the two-tool run the cancel-flight
			// child will re-run in LEG 12 -- the product's Run Workflow surface)
			const seed = await seedTwoToolTask(state, 'journey cancel-flight seed');
			seedTaskId = seed.taskId;

			// (e) the hash chains verify at the midpoint
			const verify = await state.ledger.verify();
			recorder.check('leg10.chain-verifies', verify.ok && verify.rows >= 6, `the evidence chain verifies at the journey midpoint (${String(verify.rows)} rows)`);
			const journalVerify = state.store.verifyJournal();
			recorder.check('leg10.journal-verifies', journalVerify.ok, `the orchestration journal hash chain verifies (${String(journalVerify.rows)} rows)`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 11 -- exercise provider/environment failure (REAL wire failures)
		// =====================================================================
		{
			const recorder = new LegRecorder(11, 'runtime-real');
			// (a) the mission's provider-reliant step over the REAL wire: the server
			// returns HTTP 500 twice, then recovers; the typed PROVIDER_OVERLOADED
			// error feeds the bounded recorded retry window
			providerServer.armChatFailures(2);
			const chatCallsBefore = providerServer.census().chat;
			const providerDrive = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:provider', providerRetry: { maxAttempts: 3 }, wait: fakeWait, now: state.clock() });
			const s04 = providerDrive.started.find(record => record.stepId === 'S-04');
			recorder.check('leg11.recovered-within-bound', s04 !== undefined && s04.providerAttempts === 3 && s04.providerExhausted === false && state.store.stateOf(missionGraphId).steps['S-04']?.status === 'succeeded', `the provider-reliant step recovered on attempt ${String(s04?.providerAttempts)}/3 (bounded) and succeeded`);
			const retryRows = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === missionGraphId && row.stepId === 'S-04');
			const ordinals = retryRows.map(row => (row.payload as { attemptOrdinal?: number }).attemptOrdinal ?? -1).join(',');
			const outcomes = retryRows.map(row => (row.payload as { outcome?: string }).outcome ?? '').join(',');
			recorder.check('leg11.retry-attempts-recorded', retryRows.length === 3 && ordinals === '1,2,3' && outcomes === 'retryable-failed,retryable-failed,recovered', `the retry window recorded its attempts (ordinals ${ordinals}; outcomes ${outcomes})`);
			const codeFacts = retryRows.map(row => (row.payload as { code?: string }).code ?? '').join(',');
			const waitFacts = retryRows.map(row => (row.payload as { waitAppliedMs?: number }).waitAppliedMs ?? -1).join(',');
			recorder.check('leg11.retry-rows-typed-from-real-wire', codeFacts === 'PROVIDER_OVERLOADED,PROVIDER_OVERLOADED,PROVIDER_OVERLOADED' && waitFacts === '0,0,0' && retryRows.every(row => (row.payload as { maxAttempts?: number }).maxAttempts === 3), `every attempt row carries the typed facts classified from the REAL 500 wire responses (code ${codeFacts}; waits applied ${waitFacts}; bound 3)`);
			recorder.check('leg11.wire-call-census', providerServer.census().chat - chatCallsBefore === 3, `the real provider wire saw exactly ${String(providerServer.census().chat - chatCallsBefore)} chat calls (2 failures + 1 recovery)`);
			recorder.check('leg11.final-gate-armed', state.store.stateOf(missionGraphId).steps['S-05']?.status === 'awaiting-approval', 'the final-assembly gate armed (S-05 awaits the human)');

			// (b) the cloud-sandbox environment provider failure over the REAL wire:
			// the server fails the first 5 starts (beyond the bound 3); the bounded
			// retry exhausts at exactly the bound and surfaces the typed error
			await state.envRegistry.register({
				id: CLOUD_ENV_ID,
				kind: CLOUD_ENV_KIND,
				label: 'P2-002 Journey Cloud',
				connection: { provider: 'custom', apiKeyRef: 'vault:flauz-journey-key', sandboxTemplate: 'flauz-journey-tpl' },
				trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
				capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
			});
			const cloudCreated = await state.envManager.perform('create', { id: CLOUD_ENV_ID, actor: 'agent' });
			const failedStart = await state.envManager.perform('start', { id: CLOUD_ENV_ID, actor: 'agent' });
			recorder.check('leg11.cloud-created-then-fails-typed', cloudCreated.ok && failedStart.ok === false && opErrorCode(failedStart) === 'CLOUD_PROVIDER_ERROR', `the cloud env created then the failing start surfaced the typed ${opErrorCode(failedStart)} over the real wire`);
			recorder.check('leg11.cloud-state-reflects-failure', await readEnvLifecycleState(root, CLOUD_ENV_ID) === 'failed', `lifecycle state after the provider failure '${await readEnvLifecycleState(root, CLOUD_ENV_ID)}'`);
			const ops = await readEnvOps(root);
			const attemptRows = ops.filter(op => op.op === 'start' && op.result === 'error' && typeof op.error?.message === 'string' && op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
			const attemptFacts = attemptRows.map(op => parseProviderRetryAttemptMessage(op.error?.message));
			recorder.check('leg11.cloud-bounded-exhaustion-recorded', providerServer.census().cloudStarts === 3 && attemptRows.length === 3 && attemptFacts.every(fact => fact !== undefined && fact.code === 'CLOUD_PROVIDER_ERROR' && fact.maxAttempts === 3) && attemptFacts.map(fact => fact?.ordinal).join(',') === '1,2,3', `the cloud provider retry stopped at exactly the window bound (${String(providerServer.census().cloudStarts)} wire calls against a stub failing the first 5; ordinals ${attemptFacts.map(fact => String(fact?.ordinal)).join(',')})`);

			// (c) the exhaustion probe: the bound STOPS; the failure is terminal and
			// recorded, never a silent success
			providerServer.armChatFailures(999);
			const probeSubmitted = await state.store.submitGraph({
				title: 'journey provider-failure exhaustion probe',
				steps: [{ stepId: 'S-01', title: 'always-failing provider call', instruction: 'the provider fails beyond the window bound' }],
				policy: { onStepFailure: 'fail-graph' },
				actor: 'agent',
				origin: 'journey:p2-002',
			});
			await state.store.approveGraph({ graphId: probeSubmitted.graphId, actor: 'human', origin: 'journey:p2-002' });
			const probeDrive = await driveGraph(state.store, { graphId: probeSubmitted.graphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:provider-probe', providerRetry: { maxAttempts: 3 }, wait: fakeWait, now: state.clock() });
			const probeRetryRows = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === probeSubmitted.graphId);
			const probeOutcomes = probeRetryRows.map(row => (row.payload as { outcome?: string }).outcome ?? '').join(',');
			const probeStep = probeDrive.started.find(record => record.stepId === 'S-01');
			recorder.check('leg11.exhaustion-bounded', probeStep !== undefined && probeStep.providerAttempts === 3 && probeStep.providerExhausted === true && probeRetryRows.length === 3 && probeOutcomes === 'retryable-failed,retryable-failed,exhausted', `the exhaustion window stopped at exactly the bound (${String(probeStep?.providerAttempts)} attempts; outcomes ${probeOutcomes})`);
			const probeFailedRow = state.store.journalRows.find(row => row.type === 'step-failed' && row.graphId === probeSubmitted.graphId);
			recorder.check('leg11.exhaustion-terminal-recorded', probeFailedRow !== undefined && (probeFailedRow.payload as { retryPlanned?: boolean }).retryPlanned === false && state.store.journalRows.some(row => row.type === 'graph-failed' && row.graphId === probeSubmitted.graphId), `the exhausted step failed TERMINALLY (retryPlanned false) and the graph failed honestly (never a silent success)`);
			recorder.check('leg11.probe-no-silent-success', probeDrive.completed === false, 'the probe never completed (no silent success)');
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 12 -- retry/cancel/recover
		// =====================================================================
		{
			const recorder = new LegRecorder(12, 'runtime-real');
			// (a) RETRY/RECOVER over the real wire: the caller-driven second start
			// opens a FRESH bounded window; the provider (now past its scripted
			// failures) recovers WITHIN the new window
			const recoveredStart = await state.envManager.perform('start', { id: CLOUD_ENV_ID, actor: 'agent' });
			recorder.check('leg12.cloud-retry-recovers', recoveredStart.ok === true && await readEnvLifecycleState(root, CLOUD_ENV_ID) === 'running', `the caller-driven retry recovered on a fresh bounded window over the real wire (state '${await readEnvLifecycleState(root, CLOUD_ENV_ID)}')`);
			const opsAfter = await readEnvOps(root);
			const startRows = opsAfter.filter(op => op.op === 'start' && op.actor === 'agent' && op.environmentId === CLOUD_ENV_ID);
			const requestLevelRows = startRows.filter(op => typeof op.error?.message !== 'string' || !op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
			const attemptRowFacts = startRows.filter(op => typeof op.error?.message === 'string' && op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX)).map(op => parseProviderRetryAttemptMessage(op.error?.message));
			recorder.check('leg12.retry-recorded-in-ops-ledger', providerServer.census().cloudStarts === 6 && startRows.length === 7 && requestLevelRows.length === 2 && requestLevelRows.filter(op => op.result === 'error').length === 1 && requestLevelRows.filter(op => op.result === 'ok').length === 1 && attemptRowFacts.length === 5 && attemptRowFacts.every(fact => fact !== undefined && fact.code === 'CLOUD_PROVIDER_ERROR'), `the ops ledger carries the two explicit start requests (1 error + 1 ok) plus five recorded retry attempt rows across the two bounded windows (3 exhausted + 2 failed; the successful third call of the fresh window is the request-level ok row) (${String(startRows.length)} start lines total, ${String(providerServer.census().cloudStarts)} wire calls; the recovered window records its recovered attempt too)`);

			// (b) CANCEL mid-flight in a REAL child process (the INV-3 cross-process
			// pattern): the child re-runs the saved fragment W-001; tool 1 blocks on
			// the GO file; the human cancels the RUN TASK through the task machine;
			// the child's next transition surfaces the typed stale-run-cancelled crash
			const flight = spawnJourneyChild('cancel-flight', ['--root', root], { FLAUZ_JOURNEY_SEED_TASK: seedTaskId });
			const taskReport = await flight.waitFor('TASK', 90_000);
			cancelRunTaskId = typeof taskReport['taskId'] === 'string' ? taskReport['taskId'] : '';
			await flight.waitFor('TOOL-START', 90_000);
			drillAssert(cancelRunTaskId !== '' && cancelRunTaskId !== seedTaskId, 'leg12 runtime: the flight child reported the run task and blocked on tool 1', `runTaskId ${cancelRunTaskId}`);
			await state.tasks.appendEvent(cancelRunTaskId, { ts: 90_000, actor: 'human', type: 'cancel', payload: { gate: 'mid-flight-runtime' } });
			await nodeFs.writeFile(nodePath.join(root, 'CANCEL-GO'), 'go', { encoding: 'utf-8' });
			const report = await flight.waitFor('REPORT', 90_000);
			const flightExit = await flight.waitExit(15_000);
			drillAssert(flightExit === 0, 'leg12 runtime: the flight child exited cleanly after the report', `exit ${String(flightExit)}`);
			const toolCalls = typeof report['toolCalls'] === 'number' ? report['toolCalls'] : -1;
			const crashTyped = report['crashTyped'] === true;
			const finalStatus = typeof report['finalStatus'] === 'string' ? report['finalStatus'] : '';
			const cancelEventActor = typeof report['cancelEventActor'] === 'string' ? report['cancelEventActor'] : '';
			recorder.check('leg12.cancel-recorded-with-attribution', cancelEventActor === 'human', `the cancel event is recorded with actor ${cancelEventActor}`);
			recorder.check('leg12.downstream-stopped', toolCalls === 1, `downstream work stopped by the mid-flight cancel: ${String(toolCalls)} tool step(s) executed by the flight child (tool 2 never ran after the cancel)`);
			recorder.check('leg12.cancel-terminal-typed-surface', finalStatus === 'cancelled' && crashTyped, `the cancelled task stays terminal '${finalStatus}' and the in-flight run surfaced the typed stale-run-cancelled crash at its next transition`);
			const cancelRunTask = await state.tasks.getTask(cancelRunTaskId);
			recorder.check('leg12.cancel-event-on-disk', cancelRunTask.status === 'cancelled' && cancelRunTask.events.some(event => event.type === 'cancel' && event.actor === 'human'), `the cancelled run task ${cancelRunTaskId} is terminal on disk with the human-attributed cancel event`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 13 -- restart: REAL process death inside the crash window
		// =====================================================================
		{
			const recorder = new LegRecorder(13, 'runtime-real');
			// the human grants the final-assembly approval BEFORE the finisher boots
			const granted = await state.store.approvalDecide({ graphId: missionGraphId, stepId: 'S-05', decision: 'granted', actor: 'human', origin: 'journey:approval' });
			recorder.check('leg13.approval-granted', granted.type === 'approval-granted' && granted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-05']?.status === 'ready', `the human granted the final-assembly approval (row ${granted.rowId}); S-05 is ready`);

			// the finisher child: FRESH instances on the SAME root; the drive starts
			// S-05, its effect SETTLES durably, the child freezes inside the crash
			// window and the parent SIGKILLs it (true process death)
			const finisher = spawnJourneyChild('finisher', ['--root', root, '--provider-port', String(providerServer.port)], {});
			const windowReport = await finisher.waitFor('WINDOW-ARMED', 120_000);
			const journalRowsInChild = typeof windowReport['journalRows'] === 'number' ? windowReport['journalRows'] : -1;
			const s05StatusInChild = typeof windowReport['s05Status'] === 'string' ? windowReport['s05Status'] : '';
			const sinkLogLines = typeof windowReport['sinkLogLines'] === 'number' ? windowReport['sinkLogLines'] : -1;
			finisher.kill9();
			const deathExit = await finisher.waitExit(15_000);

			recorder.check('leg13.true-process-death', deathExit === null || deathExit === 1 || deathExit === 137, `the finisher child died by SIGKILL (waitExit ${String(deathExit)}; null/137 = signal death)`);
			// the crash window on disk: the effect settled, the journal append never landed
			const journalOnDisk = await readJournalOnDisk(root);
			journalRowsAtDeath = journalOnDisk.length;
			ledgerRowsAtDeath = (await state.ledger.readRows()).length;
			const sinkLogOnDisk = new JourneyEffectSink(`${root}/.flauz/journey-sink.jsonl`, new Map()).readLog();
			const s05Key = `flauz-orch/${missionGraphId}/S-05/run/1`;
			recorder.check('leg13.crash-window-open', journalRowsInChild === journalOnDisk.length && s05StatusInChild === 'running' && journalOnDisk.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-05') === true && journalOnDisk.some(row => row.type === 'step-succeeded' && row.graphId === missionGraphId && row.stepId === 'S-05') === false, `the death landed between the settled effect and its journal append (${String(journalOnDisk.length)} journal rows frozen; S-05 running, started, never succeeded)`);
			recorder.check('leg13.effect-settled-durably', sinkLogLines === sinkLogOnDisk.length && sinkLogOnDisk.some(entry => entry.key === s05Key && !entry.replayed), `the final-assembly effect settled durably on key ${s05Key} and survived the process death (${String(sinkLogOnDisk.length)} sink log lines)`);
			const tasksAtDeath = await state.tasks.listTasks();
			recorder.check('leg13.state-frozen-on-disk', journalRowsAtDeath > 0 && ledgerRowsAtDeath > 0 && tasksAtDeath.length >= 3, `the death froze ${String(journalRowsAtDeath)} journal rows, ${String(ledgerRowsAtDeath)} ledger rows and ${String(tasksAtDeath.length)} tasks on disk`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// =====================================================================
		// LEG 14 -- resume task and inspect continuity/provenance: cold boot,
		// no silent state loss, WORK CONTINUES, the provenance walk holds
		// =====================================================================
		{
			const recorder = new LegRecorder(14, 'runtime-real');
			// cold boot: fresh instances on the SAME root (the recovery convention)
			state = await bootJourney(root, effects, providerServer.port);

			const tasksRecovered = await state.tasks.listTasks();
			recorder.check('leg14.task-envelopes-recover', tasksRecovered.length >= 3 && tasksRecovered.some(task => task.id === missionTaskId && task.events.some(event => event.type === 'graph-submitted' && event.actor === 'agent')), `all ${String(tasksRecovered.length)} task envelopes recovered (mission ${missionTaskId} carries its mirrored events)`);
			const ledgerVerify = await state.ledger.verify();
			const ledgerRowsRecovered = await state.ledger.readRows();
			recorder.check('leg14.ledger-recovers-no-loss', ledgerVerify.ok && ledgerRowsRecovered.length === ledgerRowsAtDeath, `the ledger chain recovered with NO silent state loss (verify ok, ${String(ledgerRowsRecovered.length)} rows === ${String(ledgerRowsAtDeath)} at death)`);
			recorder.check('leg14.journal-recovers-no-loss', state.store.journalRows.length === journalRowsAtDeath && state.store.verifyJournal().ok && state.store.tornTail === null, `the orchestration journal recovered exactly (${String(state.store.journalRows.length)} rows, chain verifies, no torn tail)`);
			const providerRetryRowsRecovered = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === missionGraphId && row.stepId === 'S-04');
			recorder.check('leg14.provider-retry-state-survives', providerRetryRowsRecovered.length === 3, `the provider-retry state created in LEG 11 survived the restart (${String(providerRetryRowsRecovered.length)} attempt rows) -- the seam held`);
			const memoryVerdict = await state.memory.verify();
			const sessionRecords = await state.memory.list('session');
			recorder.check('leg14.memory-recovers', memoryVerdict.ok && sessionRecords.length >= 1 && sessionRecords.some(record => record.taskId === missionTaskId && record.agentId === PRIMARY), `tiered memory recovered and verifies (${String(memoryVerdict.records)} records; the session records persist)`);
			const workerMailbox = state.bus.collect({ agentId: WORKER_1 }).messages;
			const busJournalRecovered = await readBusMessages(root);
			recorder.check('leg14.a2a-journal-recovers', workerMailbox.length === 1 && workerMailbox.some(message => message.kind === 'task-delegation') && busJournalRecovered.length === 2, `the A2A bus journal recovered (the worker mailbox replays the delegation; ${String(busJournalRecovered.length)} messages on disk)`);
			const fragments = await state.workflows.list();
			recorder.check('leg14.workflow-fragments-recover', fragments.length === 2 && fragments.some(fragment => fragment.source.taskId === missionTaskId) && fragments.some(fragment => fragment.id === 'W-001'), `both workflow fragments recovered (${fragments.map(fragment => fragment.id).join(',')})`);
			const decisionsRecovered = await listDecisions(state.fs, `${root}/.flauz/models`);
			recorder.check('leg14.routing-state-recovers', decisionsRecovered.length === 2 && decisionsRecovered.some(decision => decision.selected?.providerId === JOURNEY_PROVIDER_ID), `the model routing state recovered (${String(decisionsRecovered.length)} durable decisions incl. the live-capable one)`);
			recorder.check('leg14.cloud-env-state-recovers', await readEnvLifecycleState(root, CLOUD_ENV_ID) === 'running' && await readEnvLifecycleState(root, ENV_ID) === 'stopped', `the environment lifecycle recovered (cloud '${await readEnvLifecycleState(root, CLOUD_ENV_ID)}', local '${await readEnvLifecycleState(root, ENV_ID)}')`);
			const cancelRunTaskRecovered = cancelRunTaskId === '' ? undefined : await state.tasks.getTask(cancelRunTaskId);
			recorder.check('leg14.cancelled-run-recovers-terminal', cancelRunTaskRecovered?.status === 'cancelled', `the cancelled run task recovered terminal (${cancelRunTaskId}: ${String(cancelRunTaskRecovered?.status)})`);

			// the recovery pass: the interrupted step is marked, never fabricated
			const recovery = await recoveryScan(state.store, { record: true, now: state.clock(), actor: 'service', origin: 'journey:recovery' });
			const g001Report = recovery.graphs.find(report => report.graphId === missionGraphId);
			recorder.check('leg14.recovery-marks-interrupted', recovery.clean === false && g001Report !== undefined && g001Report.actions.includes('step-interrupted:S-05') && state.store.stateOf(missionGraphId).steps['S-05']?.status === 'ready', `the recovery pass marked the interrupted final step (${String(g001Report?.actions.join(','))}); S-05 is ready again`);
			recorder.check('leg14.recovery-never-fabricates', state.store.journalRows.some(row => row.type === 'step-succeeded' && row.graphId === missionGraphId && row.stepId === 'S-05') === false && state.store.journalRows.some(row => row.type === 'graph-completed' && row.graphId === missionGraphId) === false, 'the recovery pass completed nothing on its own (no fabricated completion)');

			// WORK CONTINUES: the re-drive replays the settled effect on the SAME idempotency key
			providerServer.armChatFailures(0);
			const continuation = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:continuation', wait: fakeWait, now: state.clock() });
			const s05 = continuation.started.find(record => record.stepId === 'S-05');
			const s05Key = `flauz-orch/${missionGraphId}/S-05/run/1`;
			recorder.check('leg14.work-continues-replays', s05 !== undefined && s05.replayed === true && state.sink.freshExecutionsInLog(s05Key) === 1 && state.sink.replaysOf(s05Key) === 1, `the interrupted step re-drove on the SAME key ${s05Key}: the settled effect REPLAYED (1 fresh + 1 replay -- never executed twice)`);
			recorder.check('leg14.mission-completes', continuation.completed === true && state.store.stateOf(missionGraphId).graphStatus === 'completed' && state.store.journalRows.some(row => row.type === 'graph-completed' && row.graphId === missionGraphId), `the mission graph completed after the restart (drive completed=${String(continuation.completed)})`);
			recorder.check('leg14.takeover-step-survives-restart', state.store.stateOf(missionGraphId).steps['S-03']?.status === 'succeeded' && state.store.stateOf(missionGraphId).steps['S-03']?.takeover?.state === 'completed', 'the taken-over step survived the restart with its takeover state intact');

			// the session closes: the claim is released with attribution
			const claimReleased = await state.store.releaseClaim({ graphId: missionGraphId, stepId: 'S-01', actor: 'agent', origin: 'journey:session-close' });
			recorder.check('leg14.session-claim-released', claimReleased.type === 'claim-released' && (claimReleased.payload as { holder?: string }).holder === PRIMARY && (state.store.stateOf(missionGraphId) as { claims?: Record<string, unknown> }).claims?.['S-01'] === undefined, `the session claim was released with attribution (${String((claimReleased.payload as { holder?: string }).holder)})`);

			// the end-to-end provenance walk
			const finalVerify = await state.ledger.verify();
			const finalRows = await state.ledger.readRows();
			recorder.check('leg14.chain-verifies-end-to-end', finalVerify.ok && finalRows.length >= ledgerRowsAtDeath && finalRows.every((row, index) => row.seq === index + 1), `the final chain verifies: ${String(finalRows.length)} rows, seqs contiguous 1..${String(finalRows.length)}`);
			recorder.check('leg14.journal-verifies', state.store.verifyJournal().ok, `the orchestration journal hash chain verifies (${String(state.store.journalRows.length)} rows)`);
			const journalOnDiskFinal = await readJournalOnDisk(root);
			const evidenceBearing = journalOnDiskFinal.filter(row => typeof (row.payload as { evidenceId?: unknown }).evidenceId === 'string');
			const resolvedIds: string[] = [];
			for (const row of evidenceBearing) {
				const evidenceId = (row.payload as { evidenceId?: string }).evidenceId ?? '';
				const resolved = await state.ledger.rowByEvidenceId(evidenceId);
				if (resolved !== undefined) {
					resolvedIds.push(evidenceId);
				}
			}
			recorder.check('leg14.journal-evidence-linkage', evidenceBearing.length >= 8 && resolvedIds.length === evidenceBearing.length, `every one of the ${String(evidenceBearing.length)} evidence-bearing journal rows resolves into the ledger`);
			const primaryStarts = journalOnDiskFinal.filter(row => row.type === 'step-started' && (row.payload as { runnerId?: string }).runnerId === PRIMARY);
			recorder.check('leg14.primary-agent-attribution', primaryStarts.length >= 2 && journalOnDiskFinal.some(row => row.type === 'claim-acquired' && (row.payload as { holder?: string }).holder === PRIMARY) && journalOnDiskFinal.some(row => row.type === 'claim-released' && (row.payload as { holder?: string }).holder === PRIMARY), `the primary agent's attribution is intact (${String(primaryStarts.length)} started steps + the session claim round-trip)`);
			const delegationDecision = journalOnDiskFinal.find(row => row.type === 'route-decided' && (row.payload as { targetAgent?: string }).targetAgent === WORKER_1);
			const resultReceived = journalOnDiskFinal.find(row => row.type === 'result-received' && row.origin === `a2a:${WORKER_1}`);
			recorder.check('leg14.delegate-attribution', delegationDecision !== undefined && resultReceived !== undefined && busJournalRecovered.some(message => message.kind === 'task-delegation' && message.from === PRIMARY && message.to === WORKER_1) && busJournalRecovered.some(message => message.kind === 'result-report' && message.from === WORKER_1), `the delegate's attribution is intact (decision row + result-received origin + the typed bus round-trip)`);
			const workerRow = await state.ledger.rowByEvidenceId(workerEvidenceId);
			recorder.check('leg14.delegate-evidence-attributed', workerRow !== undefined && workerRow.taskId === missionTaskId, `the delegate's evidence ${workerEvidenceId} still resolves to ${missionTaskId}`);
			const takeoverRows = journalOnDiskFinal.filter(row => row.type.startsWith('takeover-'));
			recorder.check('leg14.takeover-attribution', takeoverRows.length === 3 && takeoverRows.every(row => row.actor === 'human'), `the takeover's three rows all carry the human attribution (${takeoverRows.map(row => row.type).join(',')})`);
			recorder.check('leg14.canceller-attribution', journalOnDiskFinal.some(row => row.type === 'graph-approved' && row.actor === 'human') && journalOnDiskFinal.find(row => row.type === 'approval-granted' && row.graphId === missionGraphId)?.actor === 'human' && cancelRunTaskRecovered?.events.some(event => event.type === 'cancel' && event.actor === 'human') === true, 'every human act kept its attribution (graph approval, final gate grant, the mid-flight run cancel)');
			const missionRows = finalRows.filter(row => row.taskId === missionTaskId);
			const finalMissionTask = await state.tasks.getTask(missionTaskId);
			const evidenceEvents = finalMissionTask.events.filter(event => event.type === 'evidence');
			recorder.check('leg14.task-ledger-linkage', missionRows.length === evidenceEvents.length && missionRows.length >= 12, `every one of the ${String(missionRows.length)} mission ledger rows has its evidence event on the task timeline (no orphan evidence, no silent drops)`);
			const briefOnDiskFinal = await state.fs.readFileUtf8(`${root}/${briefResourceUri}`);
			const changesetRow = finalRows.find(row => row.uri === briefResourceUri);
			recorder.check('leg14.resource-provenance', briefOnDiskFinal !== undefined && changesetRow !== undefined && changesetRow.sha256 === sha256Hex(briefOnDiskFinal), `the workspace resource is still on disk and its ledger row hash-pins it (${briefResourceUri})`);
			await finishLeg(recorder, 'node --experimental-strip-types build/flauz/journey/journey.drill.ts');
		}

		// ---- the verdict: every leg green, the receipts + document emitted ----
		if (legVerdicts.length !== LEGS.length) {
			drillAssert(false, 'journey completeness', `the journey recorded ${String(legVerdicts.length)} legs (expected ${String(LEGS.length)})`);
		}
	} finally {
		localServer.close();
		providerServer.close();
	}
}

/** The journey's OpenAI-compatible adapter (the REAL adapter + the REAL stdlib HTTP port). */
function journeyAdapter(providerPort: number): ProviderAdapter {
	return createOpenAiCompatAdapter({
		config: {
			providerId: JOURNEY_PROVIDER_ID,
			vendor: 'flauz-journey',
			displayName: 'Flauz Journey OpenAI-Compatible',
			baseUrl: `http://127.0.0.1:${String(providerPort)}/v1`,
			credentialRef: JOURNEY_CREDENTIAL_REF,
			models: [journeyModelDescriptor()],
			requestTimeoutMs: 5_000,
		},
		http: nodeHttpPort,
		secrets: { resolve: async ref => ref === JOURNEY_CREDENTIAL_REF ? 'journey-wire-key' : undefined },
		hash: nodeHashPort,
		clock: () => Date.now(),
	});
}

/** Maps a thrown error from the real adapter seam into the DL-35 sink shape. */
function providerFailureFrom(err: unknown): EffectSinkResult {
	if (isProviderError(err)) {
		return {
			ok: false,
			failureClass: 'provider-error',
			message: `typed provider failure over the real wire (HTTP ${String(err.status)} ${err.code})`,
			providerError: { code: err.code, retryClass: err.retryClass, ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}) },
		};
	}
	return { ok: false, failureClass: 'provider-error', message: err instanceof Error ? err.message : String(err) };
}

/** Seeds the two-tool task + fragment W-001 (the LEG 12 cancel-flight substrate). */
async function seedTwoToolTask(state: JourneyState, prompt: string): Promise<{ taskId: string }> {
	const created = await state.tasks.createTask(prompt);
	const taskId = created.id;
	const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`echo journey-tool-1\`.\n2. Run \`echo journey-tool-2\`.`;
	await state.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
	await state.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
	for (const seq of [1, 2]) {
		const command = `echo journey-tool-${String(seq)}`;
		const output = `${command}\nok`;
		const artifactUri = `.flauz/artifacts/${taskId}/command-output-${String(seq)}.txt`;
		await state.fs.mkdir(`${state.root}/.flauz/artifacts/${taskId}`);
		await state.fs.writeFile(`${state.root}/${artifactUri}`, output);
		const appended = await state.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
		await state.tasks.appendEvent(taskId, { ts: 2 + seq, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
	}
	await state.tasks.appendEvent(taskId, { ts: 5, actor: 'agent', type: 'report', payload: {} });
	await state.tasks.appendEvent(taskId, { ts: 6, actor: 'tool', type: 'verify-pass', payload: { rows: 2 } });
	await state.tasks.appendEvent(taskId, { ts: 7, actor: 'human', type: 'sign-off', payload: {} });
	await state.workflows.save({ taskId });
	return { taskId };
}

function journeyModelDescriptor(): ModelDescriptor {
	return {
		modelId: JOURNEY_MODEL_ID,
		modelName: 'Flauz Journey Model',
		family: 'journey',
		version: '1',
		contextWindowTokens: 32_000,
		maxOutputTokens: 4_096,
		inputModalities: ['text'],
		toolCalling: false,
	};
}

// ---------------------------------------------------------------------------
// The verdict document + the summary receipt + the GREEN line
// ---------------------------------------------------------------------------

async function emitVerdict(): Promise<void> {
	const skipped = legVerdicts.filter(verdict => verdict.verdict === 'SKIP');
	const failing = legVerdicts.filter(verdict => verdict.verdict === 'FAIL');
	for (const verdict of failing) {
		console.log(`p2-002 journey drill: LEG ${String(verdict.leg).padStart(2, '0')} ${verdict.slug} FAIL -- ${verdict.firstFailing ?? 'no detail'}`);
	}
	const document = {
		schema: JOURNEY_SCHEMA,
		wo: WO_ID,
		worker: WORKER_ID,
		rung: 'runtime',
		legs: legVerdicts,
		summary: {
			pass: legVerdicts.filter(verdict => verdict.verdict === 'PASS').length,
			fail: failing.length,
			skip: skipped.length,
		},
		levels: Object.fromEntries(legVerdicts.map(verdict => [verdict.slug, verdict.evidenceLevel])),
	};
	if (RECORDS_DIR !== '') {
		await nodeFs.mkdir(RECORDS_DIR, { recursive: true });
		await nodeFs.writeFile(nodePath.join(RECORDS_DIR, 'journey-summary.json'), `${JSON.stringify(document, null, '\t')}\n`, { encoding: 'utf-8' });
	}
	for (const verdict of legVerdicts) {
		console.log(`p2-002 journey drill: LEG ${String(verdict.leg).padStart(2, '0')} ${verdict.slug} ${verdict.verdict} (${String(verdict.assertions.pass)} assertions, evidence ${verdict.evidenceLevel})`);
	}
	const allGreen = failing.length === 0 && skipped.length === 0;
	if (allGreen) {
		console.log(GREEN_LINE);
	}
	console.log(`p2-002 journey drill: ${String(assertions)} assertions, ${String(failures)} failures`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args[0] === '--selftest') {
		await runSelftest();
		return;
	}
	if (args[0] === '--child') {
		const childArgs = new Map<string, string>();
		for (let i = 2; i + 1 < args.length; i += 2) {
			childArgs.set(args[i] ?? '', args[i + 1] ?? '');
		}
		await runChildMode(args[1] ?? '', childArgs);
		return;
	}
	if (args.length > 0) {
		console.error(`p2-002 journey drill: unknown arguments ${args.join(' ')}`);
		process.exit(2);
	}
	try {
		await runJourney();
	} catch (err) {
		failures += 1;
		console.error(`p2-002 journey drill: FAIL journey machinery -- ${err instanceof Error ? err.message : String(err)}`);
		if (err instanceof Error && err.stack !== undefined) {
			console.error(err.stack);
		}
	}
	await emitVerdict();
	const failingLegs = legVerdicts.filter(verdict => verdict.verdict === 'FAIL').length;
	if (failures > 0 || failingLegs > 0) {
		process.exit(1);
	}
	process.exit(0);
}

void main();
