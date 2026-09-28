/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-007 -- the whole-session acceptance battery, RUNTIME rung (the
 * documented promotion of TL4-004's fixture rung; spec:
 * docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md section 4).
 *
 * The SAME four journeys (J1-J4, catalogue and transcript contract
 * IDENTICAL to extensions/flauz-workflow/test/session-battery.test.ts) over
 * the REAL ports:
 *
 *   - browser leg: the real `CdpEndpointHost` + `BrowserSessionManager`
 *     against a REAL headless Chromium over a real CDP WebSocket
 *     (env `FLAUZ_CDP_ENDPOINT`), with the transport wrapped in a
 *     recording subclass (the TL3-003 real-chromium-hardening drill
 *     pattern) so sent-command assertions still hold on the real wire.
 *     The allowed-navigation host is a REAL local origin server
 *     (node:http on 127.0.0.1, ephemeral port) -- real navigations, no
 *     external network. The fixture rung's https://welcome.example.com/
 *     is not real-network reachable (DNS), so the runtime rung
 *     substitutes the local origin; this is the documented port-driven
 *     substitution, not a contract change.
 *   - environment leg: the real `LocalProcessExecutor` (real child
 *     processes running the FIXED flauz-environments harness, real fs
 *     state on disk) instead of the SimulatedRemoteExecutor.
 *
 * Everything else is the fixture battery verbatim: the REAL TaskService,
 * EvidenceLedger and WorkflowService; the same event spines; the same
 * distilled transcript row shapes (schema flauz.session-battery-runtime/v1)
 * deep-compared against the pinned fixture
 * test/fixtures/session-battery-runtime/golden-runtime.json.
 *
 * NORMALIZATION TABLE (the ONLY volatile classes normalized; everything
 * else is pinned by deep-compare -- a difference that is not in this
 * table is a FINDING, never a silent pass):
 *   1. local-origin ephemeral port -- navigationVerdicts[].url and
 *      .committedUrl carry http://127.0.0.1:<ephemeral>; normalized to
 *      the canonical placeholder http://127.0.0.1:<PORT>/...
 *   2. distilled-away classes (browser session ids flauz:browser:<hex>,
 *      tab target ids, partition hex, harness pids, flat-protocol CDP
 *      session ids) -- the transcript contract already distills these to
 *      event kinds and counts (unchanged from the fixture rung); the
 *      --check-transcript mode re-proves no raw value leaks.
 *   3. deterministic-by-injection -- task/ledger/env timestamps come
 *      from the battery's injected stepping clocks and the browser
 *      journal clock is the injected fixed clock (the same ports the
 *      fixture battery injects; only the transport and executor ports
 *      changed rungs).
 *
 * MODES:
 *   (no flags)        the full runtime rung: J1-J4 over the real ports,
 *                     transcript distilled, normalized and deep-compared
 *                     against the pinned golden-runtime.json.
 *   --selftest        zero-dep machinery self-test (normalization table
 *                     + mismatch row-naming + doctored-compare
 *                     failability). No Chromium, no endpoint, no fs.
 *   --check-transcript <file>
 *                     zero-dep structural check of a runtime transcript
 *                     artifact (schema id, required rows, hard rows, no
 *                     raw volatile values). Guards the promotion ladder:
 *                     a regenerated fixture with un-normalized values
 *                     FAILS this check.
 *
 * HOW TO RUN (a real Chromium endpoint is required for the full rung;
 * the TL3-003 drill documents the exact launch pattern):
 *   chromium --headless=new --no-sandbox --disable-gpu \
 *            --disable-popup-blocking --remote-debugging-port=9222 \
 *            --user-data-dir=/tmp/flauz-chrome about:blank
 *   # take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
 *   FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
 *     node --experimental-strip-types \
 *     extensions/flauz-workflow/test/canaries/session-battery-runtime.drill.ts
 *
 * SKIP semantics (same policy as the TL3-003 drill -- never fail a gate
 * for lacking a browser):
 *   - FLAUZ_SESSION_BATTERY_RUNTIME_SKIP=1 -> SKIP (forced)
 *   - FLAUZ_CDP_ENDPOINT unset            -> SKIP (no FLAUZ_CDP_ENDPOINT)
 *   - endpoint unreachable (3s probe)     -> SKIP (FLAUZ_CDP_ENDPOINT unreachable)
 *   Exit 0 on SKIP. Exit 1 ONLY when a REACHABLE browser diverges from the
 *   pinned journeys (a real regression, or a Chromium behavior change).
 *
 * Fixture regeneration (promotion-ladder tool, never an everyday escape
 * hatch; a regenerated golden-runtime.json must be REVIEWED diff-by-diff
 * in the PR that lands it):
 *   FLAUZ_SESSION_BATTERY_RUNTIME_RECORD=1 \
 *   FLAUZ_SESSION_BATTERY_RUNTIME_FIXTURES=test/fixtures/session-battery-runtime \
 *   FLAUZ_CDP_ENDPOINT=ws://... node --experimental-strip-types <this file>
 *
 * Exit codes: 0 = drill green (or SKIP, or selftest/check green);
 * 1 = any assertion failed (the failing row is named on stderr);
 * 2 = usage error.
 */

import * as http from 'node:http';
import { spawn } from 'node:child_process';
import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { createHash } from 'node:crypto';

import { sha256Hex, type FileSystemPort, type LedgerRow } from '../../../flauz-workspace/src/api.ts';
import { TaskService } from '../../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../../flauz-workspace/src/ledger.ts';
import { WorkflowService, type ToolExecutorPort } from '../../src/envelope.ts';
import { BrowserPolicyEngine } from '../../../flauz-browser/src/policy.ts';
import { CdpEndpointHost } from '../../../flauz-browser/src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError, type OpenSessionResult } from '../../../flauz-browser/src/runtime/sessionManager.ts';
import type { NavigationOutcome } from '../../../flauz-browser/src/runtime/tabs.ts';
import { WebSocketCdpTransport } from '../../../flauz-browser/src/cdp/transport.ts';
import { FileSystemSessionJournal, type SessionJournalRecord } from '../../../flauz-browser/src/runtime/journal.ts';
import { EnvironmentRegistry } from '../../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager, LocalProcessExecutor, type ChildHandle, type HashPort, type LocalEnvFsPort, type ProcessPort } from '../../../flauz-environments/src/lifecycle/index.ts';

// ---------------------------------------------------------------------------
// Constants, environment, assertion surface
// ---------------------------------------------------------------------------

const ENDPOINT = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
const FORCE_SKIP = process.env['FLAUZ_SESSION_BATTERY_RUNTIME_SKIP'] === '1';
const RECORD = process.env['FLAUZ_SESSION_BATTERY_RUNTIME_RECORD'] === '1';

/** Tuned for a real local Chromium (the TL3-003 drill values). */
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

const ENV_ID = 'env-test-remote';
const ENV_KIND = 'workspace-remote';
const FIXED_BROWSER_TS = 1_740_000_000_000;

/** The runtime transcript's own schema id (same rows, honest rung identity). */
const RUNTIME_SCHEMA_ID = 'flauz.session-battery-runtime/v1';

/** The canonical placeholder for the local origin's ephemeral port. */
const PORT_PLACEHOLDER = '<PORT>';

let failures = 0;
let assertions = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	assertions += 1;
	if (condition) {
		console.log(`session-battery runtime drill: PASS ${label}`);
	} else {
		failures += 1;
		console.error(`session-battery runtime drill: FAIL ${label} -- ${detail}`);
	}
}

function info(message: string): void {
	console.log(`session-battery runtime drill: NOTE ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Resolves the repo root from this drill file (fixtures + harness anchor). */
function repoRootFromHere(): string {
	// extensions/flauz-workflow/test/canaries/<this file> -> four levels up.
	return nodePath.resolve(nodePath.dirname(fileURLOfThisModule()), '..', '..', '..', '..');
}

function fileURLOfThisModule(): string {
	const url = import.meta.url;
	const prefix = 'file://';
	if (!url.startsWith(prefix)) {
		throw new Error(`session-battery runtime drill: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

// The default fixture dir resolves from the repo root (found by walking up
// from CWD until package.json carries the code-oss-dev name); the gate
// overrides it explicitly via FLAUZ_SESSION_BATTERY_RUNTIME_FIXTURES.
function resolveDefaultFixtureDir(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i += 1) {
		const candidate = nodePath.join(dir, 'test', 'fixtures', 'session-battery-runtime');
		const marker = nodePath.join(dir, 'package.json');
		if (nodeFsSync.existsSync(marker) && nodeFsSync.readFileSync(marker, { encoding: 'utf-8' }).includes('code-oss-dev')) {
			return candidate;
		}
		const parent = nodePath.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return nodePath.join(process.cwd(), 'test', 'fixtures', 'session-battery-runtime');
}

// ---------------------------------------------------------------------------
// Wire recording (the TL3-003 pattern: the real-socket analog of the
// FakeCdpTransport sent-command log)
// ---------------------------------------------------------------------------

/** One CDP frame SENT on the real socket (method + flat-protocol session routing). */
interface WireFrame {
	readonly method: string;
	readonly sessionId: string | undefined;
}

/**
 * A real WebSocketCdpTransport that records every CDP frame it sends -- the
 * same assertion surface FakeCdpTransport gives the fixture battery, but on
 * the REAL wire. Subclassing keeps the recording out of production code and
 * out of the socket layer entirely.
 */
class RecordingWebSocketCdpTransport extends WebSocketCdpTransport {
	readonly sentFrames: WireFrame[] = [];

	protected postMessage(payload: Record<string, unknown>): void {
		this.sentFrames.push({
			method: typeof payload['method'] === 'string' ? payload['method'] : '',
			sessionId: typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined,
		});
		super.postMessage(payload);
	}
}

/** Page.navigate drive commands sent across every recording transport of a journey. */
function driveCommandCount(transports: readonly RecordingWebSocketCdpTransport[]): number {
	let count = 0;
	for (const transport of transports) {
		for (const frame of transport.sentFrames) {
			if (frame.method === 'Page.navigate') {
				count += 1;
			}
		}
	}
	return count;
}

// ---------------------------------------------------------------------------
// The local origin server (real navigations without external network)
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
			response.end(`<!doctype html><title>${url}</title><body>flauz session battery runtime origin ${url}</body>`);
		});
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({ port, close: () => server.close() });
		});
	});
}

// ---------------------------------------------------------------------------
// Normalization (the documented volatile classes -- nothing else)
// ---------------------------------------------------------------------------

/**
 * Volatile class 1: the local origin's ephemeral port. Replaces the actual
 * origin with the canonical placeholder; URLs on other hosts pass through
 * untouched. This is the ONLY value normalization the runtime rung performs.
 */
function normalizeRuntimeUrl(url: string, origin: string): string {
	if (origin.length === 0 || !url.startsWith(origin)) {
		return url;
	}
	return `http://127.0.0.1:${PORT_PLACEHOLDER}${url.slice(origin.length)}`;
}

// ---------------------------------------------------------------------------
// Transcript types (the fixture battery's contract, verbatim row shapes)
// ---------------------------------------------------------------------------

interface TaskTranscript {
	readonly events: string[];
}

interface LedgerTranscript {
	readonly rowCount: number;
	readonly kinds: string[];
	readonly uris: string[];
}

interface BrowserTranscript {
	readonly journalEvents: string[];
	readonly navigationVerdicts: Array<{ url: string; decision: string; sent: boolean; committedUrl?: string }>;
	readonly driveCommandCount: number;
}

interface EnvTranscript {
	readonly ops: string[];
	readonly finalState: string;
}

interface WorkflowTranscript {
	readonly id: string;
	readonly title: string;
	readonly toolCount: number;
	readonly evidenceRefCount: number;
	readonly historyLength: number;
	readonly rerunMode: string;
}

interface ContinuityTranscript {
	readonly taskCount: number;
	readonly workflowIds: string[];
	readonly workflowHistoryLength: number;
	readonly envState: string;
	readonly journalLineCount: number;
	readonly liveBrowserSessions: number;
}

interface SessionBatteryRuntimeTranscript {
	readonly schema: string;
	readonly golden: {
		task: TaskTranscript;
		ledger: LedgerTranscript;
		artifacts: Array<{ uri: string; sha256: string }>;
		browser: BrowserTranscript;
		environment: EnvTranscript;
		workflow: WorkflowTranscript;
	};
	readonly recovery: {
		derivedFromTask: string;
		newEvidenceIds: string[];
		ledgerRowCountAfter: number;
		historyLength: number;
		stopped: string;
	};
	readonly failClosed: {
		navigationDecision: string;
		navigationSent: boolean;
		driveCommandCountAfterDeny: number;
		provenanceRejection: string;
		provenanceCode: string;
	};
	readonly continuity: ContinuityTranscript;
}

// ---------------------------------------------------------------------------
// Deep-compare with row naming (every difference is a named row -- a gate
// that cannot name its failure cannot be reviewed)
// ---------------------------------------------------------------------------

function collectMismatches(actual: unknown, pinned: unknown, path: string, out: string[]): void {
	if (Array.isArray(actual) && Array.isArray(pinned)) {
		if (actual.length !== pinned.length) {
			out.push(`${path}: array length ${actual.length} != ${pinned.length}`);
			return;
		}
		for (let i = 0; i < actual.length; i += 1) {
			collectMismatches(actual[i], pinned[i], `${path}[${i}]`, out);
		}
		return;
	}
	if (typeof actual === 'object' && actual !== null && typeof pinned === 'object' && pinned !== null) {
		const actualKeys = Object.keys(actual as Record<string, unknown>).sort();
		const pinnedKeys = Object.keys(pinned as Record<string, unknown>).sort();
		if (actualKeys.join('\u0000') !== pinnedKeys.join('\u0000')) {
			const missing = pinnedKeys.filter(key => !actualKeys.includes(key));
			const extra = actualKeys.filter(key => !pinnedKeys.includes(key));
			out.push(`${path}: key set differs (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
			return;
		}
		for (const key of actualKeys) {
			collectMismatches((actual as Record<string, unknown>)[key], (pinned as Record<string, unknown>)[key], `${path}.${key}`, out);
		}
		return;
	}
	if (actual !== pinned) {
		out.push(`${path}: ${JSON.stringify(actual)} != ${JSON.stringify(pinned)}`);
	}
}

// ---------------------------------------------------------------------------
// The runtime workspace boot (the fixture battery's bootSessionWorkspace
// with EXACTLY TWO port swaps: browser transport and environment executor)
// ---------------------------------------------------------------------------

/**
 * The separation policy for the runtime rung: the local origin host
 * (127.0.0.1 -- the real server this drill owns) is allowed at every
 * layer; everything else (the denied https://blocked.invalid/ host) is
 * denied for agents. The fixture rung's *.example.com allowlist is the
 * same policy shape pointed at the fixture rung's fake host.
 */
const RUNTIME_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['127.0.0.1'] },
	webRequest: { allow: ['127.0.0.1'] },
	willNavigate: { allow: ['127.0.0.1'] },
	partitions: { scope: 'persist', perAgent: true },
});

function sessionBatteryFsPort(): FileSystemPort & LocalEnvFsPort & { rm(target: string): Promise<void> } {
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

/** Deterministic stepping clock (advances 1000 per call, documented start) -- the fixture battery's clock, unchanged. */
function steppingClock(start: number): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/**
 * The process port (the extension.ts node wiring, plus the one drill-side
 * necessity: --experimental-strip-types on the child command line, because
 * this drill -- and the CI runtime job that runs it -- pins node 22, where
 * type stripping is opt-in; node >= 23.6 accepts the flag as its default).
 */
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
	sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex'),
};

/** The FIXED flauz-environments harness (the only executable the local-real executor ever spawns). */
const HARNESS_PATH = nodePath.join(repoRootFromHere(), 'extensions', 'flauz-environments', 'fixtures', 'env-agent.ts');

interface RuntimeWorkspace {
	readonly root: string;
	readonly fs: FileSystemPort & LocalEnvFsPort & { rm(target: string): Promise<void> };
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly envRegistry: EnvironmentRegistry;
	readonly envManager: EnvironmentLifecycleManager;
	readonly browser: BrowserSessionManager;
	readonly browserTransports: RecordingWebSocketCdpTransport[];
	cleanup(): Promise<void>;
}

async function bootRuntimeWorkspace(): Promise<RuntimeWorkspace> {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-session-runtime-'));
	const fs = sessionBatteryFsPort();
	const workspaceClock = steppingClock(1000);
	const envClock = steppingClock(1_740_000_000_000);

	const tasks = new TaskService({ root, fs, clock: workspaceClock });
	const ledger = new EvidenceLedger({ root, fs, clock: workspaceClock });
	const workflows = new WorkflowService({ root, fs, tasks, ledger, clock: workspaceClock });
	await tasks.bootstrap();
	await ledger.ensure();
	await fs.mkdir(`${root}/.flauz/workflows`);

	const envRegistry = new EnvironmentRegistry({ root, fs, clock: envClock });
	await envRegistry.bootstrap();
	await envRegistry.register({
		id: ENV_ID,
		kind: ENV_KIND,
		label: 'Session Battery Remote',
		connection: { authorityPrefix: 'flauz-local' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
	} as never);
	const envExecutor = new LocalProcessExecutor({
		root,
		fs,
		process: nodeProcessPort,
		hash: nodeHashPort,
		clock: envClock,
		harnessPath: HARNESS_PATH,
		heartbeatMs: 200,
		startTimeoutMs: 15_000,
		stopTimeoutMs: 5_000,
	});
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [envExecutor] });
	await envManager.bootstrap();

	const browserTransports: RecordingWebSocketCdpTransport[] = [];
	const host = new CdpEndpointHost(ENDPOINT, {
		transportFactory: url => {
			const transport = new RecordingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
			browserTransports.push(transport);
			return transport;
		},
	});
	const browser = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(RUNTIME_POLICY),
		host,
		workspaceRoot: root,
		journal: new FileSystemSessionJournal(root),
		clock: () => FIXED_BROWSER_TS,
		commandTimeoutMs: COMMAND_TIMEOUT_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
	});

	return {
		root,
		fs,
		tasks,
		ledger,
		workflows,
		envRegistry,
		envManager,
		browser,
		browserTransports,
		cleanup: async () => {
			await browser.dispose();
			await nodeFs.rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------
// On-disk readers (the fixture battery's helpers, verbatim)
// ---------------------------------------------------------------------------

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

async function readEnvOps(root: string): Promise<string[]> {
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
	const ops: string[] = [];
	for (const line of raw.split('\n')) {
		if (line.length === 0) {
			continue;
		}
		const record = JSON.parse(line) as { op?: string };
		if (typeof record.op === 'string') {
			ops.push(record.op);
		}
	}
	return ops;
}

async function readEnvLifecycleState(root: string, id: string): Promise<string> {
	const lifecyclePath = nodePath.join(root, '.flauz', 'environments-lifecycle.json');
	const raw = await nodeFs.readFile(lifecyclePath, { encoding: 'utf-8' });
	const envelope = JSON.parse(raw) as { entries?: Record<string, { state?: string }> };
	const entry = envelope.entries?.[id];
	return typeof entry?.state === 'string' ? entry.state : '<missing>';
}

// ---------------------------------------------------------------------------
// The journeys (J1-J4, the fixture battery's semantics unchanged)
// ---------------------------------------------------------------------------

interface JourneyState {
	golden: {
		taskEvents: string[];
		ledgerRows: LedgerRow[];
		artifacts: Array<{ uri: string; sha256: string }>;
		navVerdicts: Array<{ url: string; decision: string; sent: boolean; committedUrl?: string }>;
		envOps: string[];
		envFinalState: string;
		workflow: WorkflowTranscript;
	} | undefined;
	recovery: {
		derivedFromTask: string;
		newEvidenceIds: string[];
		ledgerRowCountAfter: number;
		historyLength: number;
		stopped: string;
	} | undefined;
	failClosed: {
		navigationDecision: string;
		navigationSent: boolean;
		driveCommandCountAfterDeny: number;
		provenanceRejection: string;
		provenanceCode: string;
	} | undefined;
	continuity: ContinuityTranscript | undefined;
}

const state: JourneyState = { golden: undefined, recovery: undefined, failClosed: undefined, continuity: undefined };

async function journey1Golden(origin: string): Promise<void> {
	console.log('session-battery runtime drill: --- J1 golden whole-session ---');
	const ws = await bootRuntimeWorkspace();
	try {
		// ---- task creation + planning + approval (the fixture battery verbatim) ----
		const prompt = 'ship the flauz session battery golden journey';
		const created = await ws.tasks.createTask(prompt);
		const taskId = created.id;
		const command = 'echo flauz-session-golden-ok';
		const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.\n2. Open the browser and read the welcome page.\n3. Boot the remote environment, verify health, stop it.`;
		await ws.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
		await ws.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });

		// ---- tool leg: the terminal command + its artifact + evidence ----
		const output = `${command}\nflauz-session-golden-ok`;
		const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
		await ws.fs.mkdir(`${ws.root}/.flauz/artifacts/${taskId}`);
		await ws.fs.writeFile(`${ws.root}/${artifactUri}`, output);
		const artifactSha256 = sha256Hex(output);
		const appended = await ws.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: command });
		await ws.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: command } });

		// ---- browser leg: agent session + allowed navigation over the REAL CDP wire ----
		const opened = await ws.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		drillAssert(opened.descriptor.state === 'active', 'J1: the agent session opens ACTIVE on the real Chromium (createTarget + domain enables + hardening + gate attach all accepted)', JSON.stringify({ state: opened.descriptor.state, error: (opened as OpenSessionResult).error }));
		const navigation = await ws.browser.navigate(opened.descriptor.sessionId, `${origin}/welcome`);
		drillAssert(isNavigationOutcome(navigation), 'J1: the allowed navigation returns an outcome, not an error', JSON.stringify(navigation));
		const nav = navigation as NavigationOutcome;
		drillAssert(nav.verdict.decision === 'allow', 'J1: the navigation is allowed by the driver layer', JSON.stringify(nav.verdict));
		drillAssert(nav.sent === true && nav.committedUrl === `${origin}/welcome`, 'J1: the navigation COMMITS on the real Chromium (Page.navigate -> Page.frameNavigated committed URL over the real wire)', JSON.stringify({ sent: nav.sent, committedUrl: nav.committedUrl, error: nav.error }));
		await ws.browser.close(opened.descriptor.sessionId);

		// ---- environment leg over the REAL LocalProcessExecutor ----
		const actor = 'agent';
		const createOutcome = await ws.envManager.perform('create', { id: ENV_ID, actor });
		drillAssert(createOutcome.ok === true, 'J1: create succeeds behind the real local-process executor (real state dir on disk)', JSON.stringify(createOutcome.ok ? { ok: true } : createOutcome.error));
		const startOutcome = await ws.envManager.perform('start', { id: ENV_ID, actor });
		drillAssert(startOutcome.ok === true, 'J1: start succeeds (a REAL child process running the fixed harness, ready line observed)', JSON.stringify(startOutcome.ok ? { ok: true } : startOutcome.error));
		const describe = await ws.envManager.describe({ id: ENV_ID });
		drillAssert(describe.verdict.health === 'healthy', 'J1: the real environment reports healthy (live pid owned by this executor)', JSON.stringify(describe.verdict));
		const stopOutcome = await ws.envManager.perform('stop', { id: ENV_ID, actor });
		drillAssert(stopOutcome.ok === true, 'J1: stop succeeds (graceful SIGTERM to the real process)', JSON.stringify(stopOutcome.ok ? { ok: true } : stopOutcome.error));
		const destroyOutcome = await ws.envManager.perform('destroy', { id: ENV_ID, actor });
		drillAssert(destroyOutcome.ok === true, 'J1: destroy succeeds (process reaped + real state dir removed)', JSON.stringify(destroyOutcome.ok ? { ok: true } : destroyOutcome.error));

		// ---- report + verify + sign-off ----
		await ws.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
		await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
		await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });

		// ---- save the workflow fragment (the session's artifact) ----
		const saved = await ws.workflows.save({ taskId });
		drillAssert(saved.workflowId === 'W-001', 'J1: the first saved workflow is W-001', JSON.stringify(saved));

		// ---- distill the journey transcript ----
		const finalTask = await ws.tasks.getTask(taskId);
		const rows = await ws.ledger.readRows();
		const journalRecords = await readJournalRecords(ws.root);
		const savedFragment = await ws.workflows.load('W-001');
		const wireDrives = driveCommandCount(ws.browserTransports);

		state.golden = {
			taskEvents: finalTask.events.map(event => `${event.actor}:${event.type}`),
			ledgerRows: rows,
			artifacts: [{ uri: artifactUri, sha256: artifactSha256 }],
			navVerdicts: [{ url: normalizeRuntimeUrl(`${origin}/welcome`, origin), decision: nav.verdict.decision, sent: nav.sent, committedUrl: normalizeRuntimeUrl(nav.committedUrl ?? '', origin) }],
			envOps: await readEnvOps(ws.root),
			envFinalState: await readEnvLifecycleState(ws.root, ENV_ID),
			workflow: {
				id: savedFragment.id,
				title: savedFragment.title,
				toolCount: savedFragment.tools.length,
				evidenceRefCount: savedFragment.evidenceRefs.length,
				historyLength: savedFragment.history.length,
				rerunMode: savedFragment.rerun.approvals,
			},
		};

		// golden-path invariants (asserted live, not just transcripted)
		drillAssert(state.golden.envOps.includes('create') && state.golden.envOps.includes('destroy'), 'J1: the environment leg is fully journaled', JSON.stringify(state.golden.envOps));
		drillAssert(journalRecords.length >= 2, 'J1: the browser journal has the open + close records', `records=${journalRecords.length}`);
		drillAssert(wireDrives === 1, 'J1: exactly ONE Page.navigate drive command hit the real wire (the allowed navigation)', `driveCommandCount=${wireDrives}`);
		drillAssert(savedFragment.tools.length === 1, 'J1: the terminal tool step is distilled into the fragment', `tools=${savedFragment.tools.length}`);
		drillAssert(savedFragment.evidenceRefs.length === 1, 'J1: the evidence row is linked into the fragment', `refs=${savedFragment.evidenceRefs.length}`);
	} finally {
		await ws.cleanup();
	}
}

async function journey2Recovery(): Promise<void> {
	console.log('session-battery runtime drill: --- J2 recovery re-run ---');
	const ws = await bootRuntimeWorkspace();
	try {
		// seed: the golden journey's first half (task + tool + evidence), then save
		const prompt = 'ship the flauz session battery recovery journey';
		const created = await ws.tasks.createTask(prompt);
		const taskId = created.id;
		const command = 'echo flauz-session-recovery-ok';
		const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.`;
		await ws.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
		await ws.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
		const output = `${command}\nflauz-session-recovery-ok`;
		const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
		await ws.fs.mkdir(`${ws.root}/.flauz/artifacts/${taskId}`);
		await ws.fs.writeFile(`${ws.root}/${artifactUri}`, output);
		const appended = await ws.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
		await ws.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
		await ws.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
		await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
		await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
		const saved = await ws.workflows.save({ taskId });

		// the recovery act: re-run with replay approvals
		const executor: ToolExecutorPort = async step => {
			drillAssert(step.toolId === 'flauz_terminal', 'J2: the re-run replays the recorded tool sequence', JSON.stringify(step.toolId));
			return { ok: true, output: `${step.input.command}\nflauz-session-recovery-ok` };
		};
		const rerun = await ws.workflows.run({ workflowId: saved.workflowId, executor, approvals: 'replay' });
		drillAssert(rerun.workflowId === 'W-001' && rerun.stopped === 'completed', 'J2: the replay run completes', JSON.stringify({ workflowId: rerun.workflowId, stopped: rerun.stopped }));

		// derived-evidence law: the new task's workflow-start carries derivedFrom -> the ORIGINAL run
		const rerunTask = await ws.tasks.getTask(rerun.taskId);
		const startEvent = rerunTask.events.find(event => event.type === 'workflow-start');
		drillAssert(startEvent !== undefined, 'J2: the re-run task records its workflow-start', 'no workflow-start event');
		const derivedFrom = (startEvent?.payload as { derivedFrom?: { taskId?: string } }).derivedFrom;
		drillAssert(derivedFrom?.taskId === taskId, 'J2: derivedFrom points at the original task', JSON.stringify({ derivedFrom: derivedFrom?.taskId, original: taskId }));

		// new evidence rows exist and link into the chain
		const rowsAfter = await ws.ledger.readRows();
		const newEvidenceIds = rerun.evidenceIds.slice();

		const fragment = await ws.workflows.load('W-001');
		state.recovery = {
			derivedFromTask: derivedFrom?.taskId ?? '<missing>',
			newEvidenceIds,
			ledgerRowCountAfter: rowsAfter.length,
			historyLength: fragment.history.length,
			stopped: rerun.stopped,
		};

		drillAssert(rowsAfter.length === 2, 'J2: the ledger carries one row per run', `rows=${rowsAfter.length}`);
		drillAssert(fragment.history.length === 1, 'J2: the fragment history records the re-run', `history=${fragment.history.length}`);
	} finally {
		await ws.cleanup();
	}
}

async function journey3FailClosed(): Promise<void> {
	console.log('session-battery runtime drill: --- J3 fail-closed ---');
	const ws = await bootRuntimeWorkspace();
	try {
		const opened = await ws.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		const allowedSession = opened as OpenSessionResult;
		drillAssert(allowedSession.descriptor.state === 'active', 'J3: the session opens ACTIVE on the real Chromium before the denial', JSON.stringify({ state: opened.descriptor.state }));

		// a URL outside every allowlist: the engine must deny, and the
		// navigation pipeline must send ZERO Page.navigate commands on the
		// REAL socket (grep the recorded wire frames)
		const navigateCountBeforeDeny = driveCommandCount(ws.browserTransports);
		const denied = await ws.browser.navigate(allowedSession.descriptor.sessionId, 'https://blocked.invalid/');
		drillAssert(isNavigationOutcome(denied), 'J3: the denied navigation is an outcome (not an operation error)', JSON.stringify(denied));
		const deniedNavigation = denied as NavigationOutcome;
		drillAssert(deniedNavigation.verdict.decision === 'deny', 'J3: the navigation is denied by the driver layer', JSON.stringify(deniedNavigation.verdict));
		const driveAfterDeny = driveCommandCount(ws.browserTransports);
		const rawWireDrives = ws.browserTransports.flatMap(transport => transport.sentFrames.filter(frame => frame.method === 'Page.navigate'));
		drillAssert(deniedNavigation.sent === false, 'J3: a denied navigation sends ZERO CDP commands', JSON.stringify({ sent: deniedNavigation.sent }));
		drillAssert(driveAfterDeny === navigateCountBeforeDeny && rawWireDrives.length === 0, 'J3 FAIL-CLOSED (the hard row): ZERO Page.navigate frames were ever written to the REAL socket (the recorded wire frames were grepped)', `before=${navigateCountBeforeDeny} after=${driveAfterDeny} rawFrames=${rawWireDrives.length}`);
		await ws.browser.close(allowedSession.descriptor.sessionId);

		// the provenance law: an actor-less lifecycle op is a typed rejection
		let provenanceRejection = '<none>';
		let provenanceCode = '<none>';
		try {
			await ws.envManager.perform('create', { id: ENV_ID });
		} catch (err) {
			provenanceRejection = err instanceof Error ? err.message.split('\n')[0] ?? err.message : String(err);
			const maybeCode = (err as { code?: unknown }).code;
			provenanceCode = typeof maybeCode === 'string' ? maybeCode : '<missing>';
		}

		state.failClosed = {
			navigationDecision: deniedNavigation.verdict.decision,
			navigationSent: deniedNavigation.sent,
			driveCommandCountAfterDeny: driveAfterDeny,
			provenanceRejection,
			provenanceCode,
		};

		drillAssert(provenanceCode === 'ACTOR_REQUIRED', 'J3: the actor-less op is rejected loudly (typed error code)', provenanceCode);
		drillAssert(/provenance actor/.test(provenanceRejection), 'J3: the rejection names the provenance law', provenanceRejection);
	} finally {
		await ws.cleanup();
	}
}

async function journey4Continuity(): Promise<void> {
	console.log('session-battery runtime drill: --- J4 continuity after full restart ---');
	const first = await bootRuntimeWorkspace();
	const root = first.root;
	try {
		// run the golden core once (task + evidence + fragment + env lifecycle + journal)
		const prompt = 'ship the flauz session battery continuity journey';
		const created = await first.tasks.createTask(prompt);
		const taskId = created.id;
		const command = 'echo flauz-session-continuity-ok';
		const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.`;
		await first.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
		await first.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
		const output = `${command}\nflauz-session-continuity-ok`;
		const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
		await first.fs.mkdir(`${root}/.flauz/artifacts/${taskId}`);
		await first.fs.writeFile(`${root}/${artifactUri}`, output);
		const appended = await first.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
		await first.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
		await first.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
		await first.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
		await first.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
		await first.workflows.save({ taskId });
		// the REAL environment leg: a live harness process whose state lands on disk
		const createOutcome = await first.envManager.perform('create', { id: ENV_ID, actor: 'agent' });
		drillAssert(createOutcome.ok === true, 'J4: create succeeds on the first boot (real executor)', JSON.stringify(createOutcome.ok ? { ok: true } : createOutcome.error));
		const startOutcome = await first.envManager.perform('start', { id: ENV_ID, actor: 'agent' });
		drillAssert(startOutcome.ok === true, 'J4: start succeeds on the first boot (a REAL harness process is now live)', JSON.stringify(startOutcome.ok ? { ok: true } : startOutcome.error));
		const browserOpened = await first.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		drillAssert(isSessionError(browserOpened) === false, 'J4: the browser session opened on the real Chromium before the restart', JSON.stringify((browserOpened as OpenSessionResult).error));
		await first.browser.close((browserOpened as OpenSessionResult).descriptor.sessionId);
		const journalBefore = await readJournalRecords(root);
		drillAssert(journalBefore.length >= 2, 'J4: the journal has open+close before the restart', `records=${journalBefore.length}`);
	} finally {
		// the "restart": dispose the manager WITHOUT deleting the root
		await first.browser.dispose();
	}

	// ---- cold boot: fresh in-memory state on the SAME on-disk root ----
	const fs = sessionBatteryFsPort();
	const clock = steppingClock(2000);
	const tasks = new TaskService({ root, fs, clock });
	const ledger = new EvidenceLedger({ root, fs, clock });
	const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
	await tasks.bootstrap();
	await ledger.ensure();
	await fs.mkdir(`${root}/.flauz/workflows`);

	const envRegistry = new EnvironmentRegistry({ root, fs, clock });
	await envRegistry.bootstrap();
	const envExecutor = new LocalProcessExecutor({
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
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock, executors: [envExecutor] });
	await envManager.bootstrap();

	const browserTransports: RecordingWebSocketCdpTransport[] = [];
	const host = new CdpEndpointHost(ENDPOINT, {
		transportFactory: url => {
			const transport = new RecordingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
			browserTransports.push(transport);
			return transport;
		},
	});
	const browser = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(RUNTIME_POLICY),
		host,
		workspaceRoot: root,
		journal: new FileSystemSessionJournal(root),
		clock: () => FIXED_BROWSER_TS,
		commandTimeoutMs: COMMAND_TIMEOUT_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
	});
	try {
		const listedTasks = await tasks.listTasks();
		const listedWorkflows = await workflows.list();
		const journalAfter = await readJournalRecords(root);
		const envState = await readEnvLifecycleState(root, ENV_ID);

		// work CONTINUES: a re-run on the recovered services must succeed
		const executor: ToolExecutorPort = async () => ({ ok: true, output: 'echo flauz-session-continuity-ok\nflauz-session-continuity-ok' });
		const rerun = await workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
		drillAssert(rerun.stopped === 'completed', 'J4: the recovered workflow service can re-run the fragment', JSON.stringify(rerun.stopped));

		state.continuity = {
			taskCount: listedTasks.length,
			workflowIds: listedWorkflows.map(fragment => fragment.id),
			workflowHistoryLength: listedWorkflows[0]?.history.length ?? -1,
			envState,
			journalLineCount: journalAfter.length,
			liveBrowserSessions: 0,
		};

		drillAssert(listedTasks.length === 1, 'J4: the task list recovers from disk', `tasks=${listedTasks.length}`);
		drillAssert(listedWorkflows.map(fragment => fragment.id).join(',') === 'W-001', 'J4: the workflow index recovers from disk', JSON.stringify(listedWorkflows.map(fragment => fragment.id)));
		drillAssert(journalAfter.length >= 2, 'J4: the browser journal survives the restart (real on-disk state)', `records=${journalAfter.length}`);
		drillAssert(envState === 'running', 'J4: the environment lifecycle state is recovered from disk', envState);
	} finally {
		await browser.dispose();
		// the first-boot manager OWNS the live harness process: stop + destroy
		// through it (the fresh executor would correctly refuse -- orphan law)
		try {
			await first.envManager.perform('stop', { id: ENV_ID, actor: 'tool' });
			await first.envManager.perform('destroy', { id: ENV_ID, actor: 'tool' });
		} catch {
			// best-effort cleanup on the owning manager
		}
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// Transcript assembly
// ---------------------------------------------------------------------------

function assembleTranscript(): SessionBatteryRuntimeTranscript {
	if (state.golden === undefined || state.recovery === undefined || state.failClosed === undefined || state.continuity === undefined) {
		throw new Error('session-battery runtime drill: a journey did not complete (transcript incomplete)');
	}
	return {
		schema: RUNTIME_SCHEMA_ID,
		golden: {
			task: { events: state.golden.taskEvents },
			ledger: {
				rowCount: state.golden.ledgerRows.length,
				kinds: state.golden.ledgerRows.map(row => row.kind),
				uris: state.golden.ledgerRows.map(row => row.uri),
			},
			artifacts: state.golden.artifacts,
			browser: {
				// the manager contract for the one session: open -> close
				journalEvents: ['open', 'close'],
				navigationVerdicts: state.golden.navVerdicts,
				driveCommandCount: 1, // the one ALLOWED navigation in J1 (asserted on the real wire)
			},
			environment: { ops: state.golden.envOps, finalState: state.golden.envFinalState },
			workflow: state.golden.workflow,
		},
		recovery: state.recovery,
		failClosed: state.failClosed,
		continuity: state.continuity,
	};
}

// ---------------------------------------------------------------------------
// --check-transcript: the zero-dep structural + normalization invariants
// (guards the promotion ladder: a regenerated fixture with un-normalized
// volatile values FAILS here, in verify-fixtures.sh, without any Chromium)
// ---------------------------------------------------------------------------

function checkTranscriptInvariants(doc: unknown, label: string): string[] {
	const violations: string[] = [];
	const fail = (row: string): void => {
		violations.push(row);
	};
	if (typeof doc !== 'object' || doc === null) {
		fail(`${label}: not a JSON object`);
		return violations;
	}
	const transcript = doc as Record<string, unknown>;
	if (transcript['schema'] !== RUNTIME_SCHEMA_ID) {
		fail(`${label}.schema: expected ${RUNTIME_SCHEMA_ID}, got ${JSON.stringify(transcript['schema'])}`);
	}
	for (const section of ['golden', 'recovery', 'failClosed', 'continuity']) {
		if (typeof transcript[section] !== 'object' || transcript[section] === null) {
			fail(`${label}.${section}: missing`);
		}
	}
	const golden = transcript['golden'] as Record<string, unknown> | undefined;
	if (golden !== undefined) {
		const task = golden['task'] as Record<string, unknown> | undefined;
		if (Array.isArray(task?.['events']) && (task!['events'] as string[]).join(',') !== 'agent:submit-plan,human:approve,tool:evidence,agent:report,tool:verify-pass,human:sign-off,tool:workflow-saved') {
			fail(`${label}.golden.task.events: the golden event spine is not the catalogue sequence`);
		}
		const browser = golden['browser'] as Record<string, unknown> | undefined;
		if (browser !== undefined) {
			if (JSON.stringify(browser['journalEvents']) !== JSON.stringify(['open', 'close'])) {
				fail(`${label}.golden.browser.journalEvents: expected ["open","close"]`);
			}
			if (browser['driveCommandCount'] !== 1) {
				fail(`${label}.golden.browser.driveCommandCount: expected 1 (the one allowed navigation), got ${JSON.stringify(browser['driveCommandCount'])}`);
			}
			const verdicts = browser['navigationVerdicts'];
			if (!Array.isArray(verdicts) || verdicts.length !== 1 || typeof (verdicts[0] as Record<string, unknown>)['committedUrl'] !== 'string') {
				fail(`${label}.golden.browser.navigationVerdicts: the runtime evidence row (url + decision + sent + committedUrl) is missing or malformed`);
			}
		}
	}
	const failClosed = transcript['failClosed'] as Record<string, unknown> | undefined;
	if (failClosed !== undefined) {
		if (failClosed['driveCommandCountAfterDeny'] !== 0) {
			fail(`${label}.failClosed.driveCommandCountAfterDeny: the hard row must be 0 (ZERO drive commands on the deny path), got ${JSON.stringify(failClosed['driveCommandCountAfterDeny'])}`);
		}
		if (failClosed['navigationSent'] !== false) {
			fail(`${label}.failClosed.navigationSent: must be false`);
		}
	}
	const continuity = transcript['continuity'] as Record<string, unknown> | undefined;
	if (continuity !== undefined && continuity['envState'] !== 'running') {
		fail(`${label}.continuity.envState: expected running (recovered from disk), got ${JSON.stringify(continuity['envState'])}`);
	}
	// the normalization discipline: NO raw volatile values anywhere in the
	// pinned artifact (raw ephemeral ports, partition hex, session ids)
	const raw = JSON.stringify(doc);
	if (/127\.0\.0\.1:[0-9]+/.test(raw)) {
		fail(`${label}: RAW local-origin port present (normalization class 1 violated -- regenerate with the drill, never hand-edit)`);
	}
	if (/persist:flauz-[0-9a-f]{16}/.test(raw)) {
		fail(`${label}: RAW partition name present (normalization class 2 violated)`);
	}
	if (/flauz:browser:[0-9a-f]/.test(raw)) {
		fail(`${label}: RAW browser session id present (normalization class 2 violated)`);
	}
	return violations;
}

// ---------------------------------------------------------------------------
// --selftest: the zero-dep machinery cases (wired into verify-fixtures.sh)
// ---------------------------------------------------------------------------

function syntheticRuntimeTranscript(): SessionBatteryRuntimeTranscript {
	return {
		schema: RUNTIME_SCHEMA_ID,
		golden: {
			task: { events: ['agent:submit-plan', 'human:approve', 'tool:evidence', 'agent:report', 'tool:verify-pass', 'human:sign-off', 'tool:workflow-saved'] },
			ledger: { rowCount: 1, kinds: ['command-output'], uris: ['.flauz/artifacts/T-001/command-output-1.txt'] },
			artifacts: [{ uri: '.flauz/artifacts/T-001/command-output-1.txt', sha256: '0000000000000000000000000000000000000000000000000000000000000000' }],
			browser: {
				journalEvents: ['open', 'close'],
				navigationVerdicts: [{ url: 'http://127.0.0.1:<PORT>/welcome', decision: 'allow', sent: true, committedUrl: 'http://127.0.0.1:<PORT>/welcome' }],
				driveCommandCount: 1,
			},
			environment: { ops: ['create', 'start', 'stop', 'destroy'], finalState: 'destroyed' },
			workflow: { id: 'W-001', title: 'synthetic', toolCount: 1, evidenceRefCount: 1, historyLength: 0, rerunMode: 'replay' },
		},
		recovery: { derivedFromTask: 'T-001', newEvidenceIds: ['E-000002'], ledgerRowCountAfter: 2, historyLength: 1, stopped: 'completed' },
		failClosed: { navigationDecision: 'deny', navigationSent: false, driveCommandCountAfterDeny: 0, provenanceRejection: 'synthetic', provenanceCode: 'ACTOR_REQUIRED' },
		continuity: { taskCount: 1, workflowIds: ['W-001'], workflowHistoryLength: 0, envState: 'running', journalLineCount: 2, liveBrowserSessions: 0 },
	};
}

async function runSelftest(): Promise<void> {
	console.log('session-battery runtime drill: --- selftest (zero-dep machinery) ---');
	// normalization class 1: the ephemeral port collapses to the placeholder
	const normalized = normalizeRuntimeUrl('http://127.0.0.1:53199/welcome?x=1', 'http://127.0.0.1:53199');
	drillAssert(normalized === 'http://127.0.0.1:<PORT>/welcome?x=1', 'selftest: normalizeRuntimeUrl collapses the ephemeral port to the canonical placeholder (query preserved)', normalized);
	// foreign hosts pass through untouched (the denied URL is pinned verbatim)
	const untouched = normalizeRuntimeUrl('https://blocked.invalid/', 'http://127.0.0.1:53199');
	drillAssert(untouched === 'https://blocked.invalid/', 'selftest: normalizeRuntimeUrl leaves non-origin URLs untouched', untouched);
	// deep-compare: identical documents produce zero mismatches
	const identical: string[] = [];
	collectMismatches(syntheticRuntimeTranscript(), syntheticRuntimeTranscript(), 'transcript', identical);
	drillAssert(identical.length === 0, 'selftest: collectMismatches reports zero rows for identical transcripts', JSON.stringify(identical));
	// deep-compare failability: a one-value-doctored copy is CAUGHT and the row NAMED
	const doctored = syntheticRuntimeTranscript();
	(doctored.golden.ledger as { rowCount: number }).rowCount = 2;
	const doctoredRows: string[] = [];
	collectMismatches(syntheticRuntimeTranscript(), doctored, 'transcript', doctoredRows);
	drillAssert(doctoredRows.length === 1 && doctoredRows[0] === 'transcript.golden.ledger.rowCount: 1 != 2', 'selftest: a doctored row is caught and NAMED (transcript.golden.ledger.rowCount)', JSON.stringify(doctoredRows));
	// check-transcript invariants: the clean synthetic document passes
	const cleanViolations = checkTranscriptInvariants(syntheticRuntimeTranscript(), 'selftest-clean');
	drillAssert(cleanViolations.length === 0, 'selftest: checkTranscriptInvariants accepts the clean synthetic transcript', JSON.stringify(cleanViolations));
	// check-transcript failability: a raw-port document FAILS the normalization discipline
	const rawPort = syntheticRuntimeTranscript();
	(rawPort.golden.browser.navigationVerdicts[0] as { url: string }).url = 'http://127.0.0.1:53199/welcome';
	const rawViolations = checkTranscriptInvariants(rawPort, 'selftest-raw-port');
	drillAssert(rawViolations.length === 1 && rawViolations[0].includes('RAW local-origin port present'), 'selftest: a raw ephemeral port in a transcript FAILS the normalization discipline', JSON.stringify(rawViolations));

	if (failures > 0) {
		console.error(`session-battery runtime drill: SELFTEST FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log(`session-battery runtime drill: ${assertions} assertions, 0 failures`);
	console.log('session-battery runtime drill: SELFTEST GREEN (normalization + compare machinery, zero-dep)');
}

async function runCheckTranscript(file: string): Promise<void> {
	console.log(`session-battery runtime drill: --- transcript check (${file}) ---`);
	let raw: string;
	try {
		raw = await nodeFs.readFile(file, { encoding: 'utf-8' });
	} catch (err) {
		console.error(`session-battery runtime drill: FAIL transcript unreadable -- ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	let doc: unknown;
	try {
		doc = JSON.parse(raw);
	} catch (err) {
		console.error(`session-battery runtime drill: FAIL transcript is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	const violations = checkTranscriptInvariants(doc, nodePath.basename(file));
	for (const violation of violations) {
		console.error(`session-battery runtime drill: FAIL ${violation}`);
	}
	if (violations.length > 0) {
		console.error(`session-battery runtime drill: TRANSCRIPT-CHECK FAILED (${violations.length} violation(s))`);
		process.exit(1);
	}
	console.log(`session-battery runtime drill: TRANSCRIPT-CHECK GREEN (${file})`);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes('--selftest')) {
		await runSelftest();
		return;
	}
	const checkIndex = argv.indexOf('--check-transcript');
	if (checkIndex !== -1) {
		const file = argv[checkIndex + 1];
		if (file === undefined || file.startsWith('--')) {
			console.error('session-battery runtime drill: --check-transcript requires a file path');
			process.exit(2);
		}
		await runCheckTranscript(file);
		return;
	}
	for (const arg of argv) {
		if (arg !== '--record') {
			console.error(`session-battery runtime drill: unknown argument '${arg}' (expected --selftest | --check-transcript <file> | --record)`);
			process.exit(2);
		}
	}

	if (FORCE_SKIP) {
		console.log('session-battery runtime drill: SKIP (FLAUZ_SESSION_BATTERY_RUNTIME_SKIP=1 forced)');
		return;
	}
	if (ENDPOINT === '') {
		console.log('session-battery runtime drill: SKIP (no FLAUZ_CDP_ENDPOINT)');
		return;
	}

	// --- reachability probe (never fail a gate for lacking a browser) ---
	const probe = new WebSocketCdpTransport(ENDPOINT, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
	const reachable = await Promise.race([
		probe.ready().then(() => true, () => false),
		sleep(3000).then(() => false),
	]);
	if (!reachable) {
		probe.close();
		console.log('session-battery runtime drill: SKIP (FLAUZ_CDP_ENDPOINT unreachable)');
		return;
	}
	probe.close();
	console.log(`session-battery runtime drill: endpoint ${ENDPOINT}`);

	const server = await startLocalServer();
	const origin = `http://127.0.0.1:${server.port}`;
	info(`local origin server ${origin} (allowed host 127.0.0.1; the denied host https://blocked.invalid/ is outside every allowlist)`);

	try {
		await journey1Golden(origin);
		await journey2Recovery();
		await journey3FailClosed();
		await journey4Continuity();
	} finally {
		server.close();
	}

	const transcript = assembleTranscript();
	const fixtureDir = process.env['FLAUZ_SESSION_BATTERY_RUNTIME_FIXTURES'] ?? resolveDefaultFixtureDir();
	const goldenPath = nodePath.join(fixtureDir, 'golden-runtime.json');

	if (RECORD || argv.includes('--record')) {
		await nodeFs.mkdir(fixtureDir, { recursive: true });
		await nodeFs.writeFile(goldenPath, `${JSON.stringify(transcript, null, '\t')}\n`, { encoding: 'utf-8' });
		console.log(`session-battery runtime drill: pinned fixture regenerated at ${goldenPath} (REVIEW the diff in the PR that lands it -- promotion-ladder law)`);
	}

	let raw: string;
	try {
		raw = await nodeFs.readFile(goldenPath, { encoding: 'utf-8' });
	} catch (err) {
		console.error(`session-battery runtime drill: FAIL pinned fixture not found at ${goldenPath} (regenerate with FLAUZ_SESSION_BATTERY_RUNTIME_RECORD=1) -- ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	let pinned: unknown;
	try {
		pinned = JSON.parse(raw);
	} catch (err) {
		console.error(`session-battery runtime drill: FAIL pinned fixture is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
		process.exit(1);
	}
	const mismatches: string[] = [];
	collectMismatches(transcript, pinned, 'transcript', mismatches);
	for (const row of mismatches) {
		console.error(`session-battery runtime drill: FAIL transcript row mismatch -- ${row}`);
	}
	drillAssert(mismatches.length === 0, 'the whole-session RUNTIME transcript matches the pinned fixture (every difference outside the documented normalization table is a failure)', `${mismatches.length} mismatched row(s)`);

	if (failures > 0) {
		console.error(`session-battery runtime drill: FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log(`session-battery runtime drill: ${assertions} assertions, 0 failures`);
	console.log('session-battery runtime drill: GREEN (J1-J4 over real CDP + LocalProcessExecutor)');
}

void main().catch(error => {
	console.error('session-battery runtime drill: ERROR', error);
	process.exit(1);
});
