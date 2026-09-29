/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S3 -- the Agent OS runtime verification battery, RUNTIME rung (the
 * promotion of test/agentos-battery.test.ts; spec
 * docs/FLAUZ-PROGRAM/TL2-AGENTOS-BATTERY.md).
 *
 * The SAME eight journeys (INV-1..INV-8, catalogue and verdict schema
 * IDENTICAL to the fixture suite) over the REAL ports:
 *
 *   - restart legs (INV-1): REAL child processes -- a seed child boots the
 *     services against the on-disk root, reaches quiescence, then is
 *     SIGKILLED (true process death); a recovery child cold-boots fresh
 *     instances on the SAME root and proves state, provenance and continued
 *     work. The environment leg inside the seed runs the REAL
 *     LocalProcessExecutor (real grandchild harness processes).
 *   - cancellation leg (INV-3): a REAL child process runs the workflow; the
 *     parent records the human cancel against the same on-disk root
 *     mid-flight; the child reports what actually executed afterwards.
 *   - concurrency leg (INV-6): TWO REAL child processes append evidence to
 *     the one shared ledger through a two-phase read-completion rendezvous
 *     (both internal reads provably complete before either append lands --
 *     the deterministic cross-process lost-update).
 *   - browser legs (INV-1/INV-8): the real CdpEndpointHost +
 *     BrowserSessionManager against a REAL headless Chromium over a real CDP
 *     WebSocket (env FLAUZ_CDP_ENDPOINT), with the transport wrapped in a
 *     recording subclass (the TL3-003 pattern) so wire-level assertions
 *     hold; the INV-8 death leg CLOSES the real socket mid-navigation. The
 *     allowed-navigation host is a REAL local origin server (node:http on
 *     127.0.0.1, ephemeral port) -- real navigations, no external network.
 *   - provider legs (INV-2/INV-8): a STUB PROVIDER SERVER over a REAL socket
 *     (node:http on 127.0.0.1) serving the Flauz cloud-sandbox wire
 *     contract: 500 (provider failure), 404 (sandbox gone) and recovery
 *     routes, consumed by the REAL CloudHttpExecutor through the node
 *     stdlib fetch port.
 *   - A2A attribution leg (INV-6): the REAL on-disk A2ABus
 *     (extensions/flauz-agent/core/a2a.mjs) instead of the fixture rung's
 *     in-memory port.
 *   - INV-4 (approval gates) and INV-7 (ledger tamper detection over real
 *     fs) have no rung-substitutable port at the fixture rung (their ports
 *     are already the real on-disk task machine and a human-responder
 *     double); they re-run in-process against the same contracts. INV-5
 *     runs the landed TL2-F3 lease-conflict contract over the REAL on-disk
 *     A2ABus (the same two-claimant race as the fixture rung - the one
 *     contract, two rungs law; the verdict rows agree).
 *
 * The verdict document (schema flauz.agentos-battery/v1, rung "runtime") is
 * written to $FLAUZ_AGENTOS_BATTERY_VERDICT and the census is printed as
 * greppable evidence lines. The gate (build/flauz/scripts/agentos-battery.mjs
 * --runtime) enforces this drill's exit code AND its GREEN line.
 *
 * MODES:
 *   (no flags)  the full runtime rung (requires FLAUZ_CDP_ENDPOINT).
 *   --selftest   zero-dep machinery self-test (verdict assembly, contract
 *                skip classification, the two-phase rendezvous fs, the
 *                child-report line parser). No Chromium, no endpoint.
 *   --child <role> [--root <dir>] [--id a|b] [--task <id>]
 *                CHILD MODE (never run by hand): one substrate role of the
 *                rung -- inv1-seed | inv1-recover | inv3-flight |
 *                inv6-agent. Roles speak the AGENTOS-CHILD line protocol.
 *
 * HOW TO RUN (a real Chromium endpoint is required for the full rung; the
 * TL3-003/session drills document the exact launch pattern):
 *   chromium --headless=new --no-sandbox --disable-gpu \
 *            --disable-popup-blocking --remote-debugging-port=9222 \
 *            --user-data-dir=/tmp/flauz-chrome about:blank
 *   # take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
 *   FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
 *     node --experimental-strip-types \
 *     extensions/flauz-workflow/test/canaries/agentos-runtime.drill.ts
 *
 * SKIP semantics (same policy as the TL3-003/session drills -- never fail a
 * gate for lacking a browser):
 *   - FLAUZ_AGENTOS_RUNTIME_SKIP=1 -> SKIP (forced)
 *   - FLAUZ_CDP_ENDPOINT unset     -> SKIP (no FLAUZ_CDP_ENDPOINT)
 *   - endpoint unreachable (3s probe) -> SKIP (FLAUZ_CDP_ENDPOINT unreachable)
 *   Exit 0 on SKIP. Exit 1 when a REACHABLE rung diverges (a real regression
 *   or an instrument failure); findings are verdict rows, not exit codes.
 *
 * Exit codes: 0 = drill green (or SKIP, or selftest green);
 * 1 = any instrument assertion failed (the failing row is named on stderr);
 * 2 = usage error.
 */

import * as http from 'node:http';
import { spawn } from 'node:child_process';
import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { createHash } from 'node:crypto';

import { sha256Hex, type EvidenceKind, type FileSystemPort, type LedgerRow, type TaskEvent } from '../../../flauz-workspace/src/api.ts';
import { TaskService } from '../../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger, rowLine } from '../../../flauz-workspace/src/ledger.ts';
import { WorkflowService, type ApprovalPort, type ToolExecutorPort } from '../../src/envelope.ts';
import { AgentMessenger, type A2aMessage, type A2aMessageInput, type A2aPort } from '../../src/messaging.ts';
import { BrowserPolicyEngine } from '../../../flauz-browser/src/policy.ts';
import { CdpEndpointHost } from '../../../flauz-browser/src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError, type OpenSessionResult } from '../../../flauz-browser/src/runtime/sessionManager.ts';
import type { NavigationOutcome } from '../../../flauz-browser/src/runtime/tabs.ts';
import { WebSocketCdpTransport } from '../../../flauz-browser/src/cdp/transport.ts';
import { FakeBrowserState } from '../../../flauz-browser/src/cdp/fake.ts';
import { FileSystemSessionJournal, type SessionJournalRecord } from '../../../flauz-browser/src/runtime/journal.ts';
import { EnvironmentRegistry } from '../../../flauz-environments/src/registry.ts';
import { CloudHttpExecutor, EnvironmentLifecycleManager, LocalProcessExecutor, PROVIDER_RETRY_ATTEMPT_PREFIX, nodeHttpPort, parseProviderRetryAttemptMessage, type ChildHandle, type EnvironmentOpOutcome, type HashPort, type HttpPort, type LocalEnvFsPort, type ProcessPort } from '../../../flauz-environments/src/lifecycle/index.ts';
import { A2ABus } from '../../../flauz-agent/core/a2a.mjs';
import { OrchestrationStore } from '../../../flauz-agent/core/orchStore.mjs';
import { LEASE_CONFLICT_CODE, claimStepLease, isLeaseConflictError, leaseConflictFacts, stepResourceId } from '../../../flauz-agent/core/leaseConflict.mjs';

// ---------------------------------------------------------------------------
// Constants, environment, assertion surface
// ---------------------------------------------------------------------------

const ENDPOINT = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
const FORCE_SKIP = process.env['FLAUZ_AGENTOS_RUNTIME_SKIP'] === '1';

/** Tuned for a real local Chromium (the TL3-003 drill values). */
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

const ENV_ID = 'env-agentos-remote';
const ENV_KIND = 'workspace-remote';
const CLOUD_ENV_ID = 'env-agentos-cloud';
const CLOUD_ENV2_ID = 'env-agentos-cloud2';
const CLOUD_ENV_KIND = 'cloud-sandbox';
const FIXED_BROWSER_TS = 1_740_000_000_000;

const AGENTOS_BATTERY_SCHEMA = 'flauz.agentos-battery/v1';

const RUNTIME_GREEN_PREFIX = 'agentos runtime drill: GREEN';
const INV5_SKIP_REASON = 'no lease conflict contract on main (the flauz.a2a/v0 resource-claim surface is informational-only by design - AGENT-INTEGRATION section 5 records enforcement as a follow-up; concurrent claimants cannot receive a conflict error); TL2-004 pending';

interface CatalogueEntry {
	readonly id: string;
	readonly name: string;
}

const CATALOGUE: readonly CatalogueEntry[] = [
	{ id: 'INV-1', name: 'restart-recovery' },
	{ id: 'INV-2', name: 'provider-failure-retry' },
	{ id: 'INV-3', name: 'cancellation-propagation' },
	{ id: 'INV-4', name: 'approval-interruption' },
	{ id: 'INV-5', name: 'lease-conflict' },
	{ id: 'INV-6', name: 'multi-agent-coordination' },
	{ id: 'INV-7', name: 'evidence-provenance-integrity' },
	{ id: 'INV-8', name: 'partial-environment-browser-failure' },
];

let failures = 0;
let assertions = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	assertions += 1;
	if (condition) {
		console.log(`agentos runtime drill: PASS ${label}`);
	} else {
		failures += 1;
		console.error(`agentos runtime drill: FAIL ${label} -- ${detail}`);
	}
}

function info(message: string): void {
	console.log(`agentos runtime drill: NOTE ${message}`);
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
		throw new Error(`agentos runtime drill: unsupported module url ${url}`);
	}
	let target = url.slice(prefix.length);
	if (process.platform === 'win32') {
		target = target.replace(/^\/([A-Za-z]:)/, '$1');
	}
	return decodeURIComponent(target);
}

// ---------------------------------------------------------------------------
// The verdict machinery (the fixture suite's contract, verbatim row shapes)
// ---------------------------------------------------------------------------

interface VerdictRow {
	readonly invariant: string;
	readonly verdict: 'PASS' | 'FAIL' | 'SKIP';
	readonly reason: string;
	readonly violatedInvariant?: string;
	readonly assertions: { readonly pass: number; readonly fail: number };
	readonly evidence: string;
}

interface VerdictDocument {
	readonly schema: string;
	readonly rung: 'fixture' | 'runtime';
	readonly rows: readonly VerdictRow[];
	readonly summary: { readonly pass: number; readonly fail: number; readonly skip: number };
}

interface RecordedCheck {
	readonly id: string;
	readonly ok: boolean;
	readonly detail: string;
}

class JourneyRecorder {
	private readonly checks: RecordedCheck[] = [];
	private readonly invariantId: string;
	private readonly invariantName: string;

	constructor(invariantId: string, invariantName: string) {
		this.invariantId = invariantId;
		this.invariantName = invariantName;
	}

	check(id: string, ok: boolean, detail: string): boolean {
		this.checks.push({ id, ok, detail });
		return ok;
	}

	control(id: string, ok: boolean, detail: string): void {
		if (!ok) {
			failures += 1;
			console.error(`agentos runtime drill: FAIL instrument control ${this.invariantId} ${id} -- ${detail}`);
		}
	}

	buildRow(evidence: string): VerdictRow {
		const pass = this.checks.filter(check => check.ok).length;
		const fail = this.checks.filter(check => !check.ok).length;
		const firstFailing = this.checks.find(check => !check.ok);
		if (firstFailing !== undefined) {
			return {
				invariant: this.invariantId,
				verdict: 'FAIL',
				reason: `violated invariant ${this.invariantId} ${this.invariantName}: ${firstFailing.detail}`,
				violatedInvariant: `${this.invariantId} ${this.invariantName} -- first failing assertion ${firstFailing.id}: ${firstFailing.detail}`,
				assertions: { pass, fail },
				evidence,
			};
		}
		return {
			invariant: this.invariantId,
			verdict: 'PASS',
			reason: `all ${pass} target assertions held (${this.invariantId} ${this.invariantName})`,
			assertions: { pass, fail },
			evidence,
		};
	}
}

const rows = new Map<string, VerdictRow>();

function registerRow(row: VerdictRow): void {
	rows.set(row.invariant, row);
}

/** A SKIP row whose reason names the missing product contract (distance, not silence). */
function isContractSkip(reason: string): boolean {
	return /;\s*TL2-\d{3}\s+pending$/.test(reason);
}

function assembleVerdictDocument(): VerdictDocument {
	const documentRows: VerdictRow[] = [];
	for (const entry of CATALOGUE) {
		const row = rows.get(entry.id);
		if (row !== undefined) {
			documentRows.push(row);
		}
	}
	return {
		schema: AGENTOS_BATTERY_SCHEMA,
		rung: 'runtime',
		rows: documentRows,
		summary: {
			pass: documentRows.filter(row => row.verdict === 'PASS').length,
			fail: documentRows.filter(row => row.verdict === 'FAIL').length,
			skip: documentRows.filter(row => row.verdict === 'SKIP').length,
		},
	};
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
	sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex'),
};

/** The FIXED flauz-environments harness (the only executable the local-real executor ever spawns). */
const HARNESS_PATH = nodePath.join(repoRootFromHere(), 'extensions', 'flauz-environments', 'fixtures', 'env-agent.ts');

// ---------------------------------------------------------------------------
// Wire recording (the TL3-003 pattern) + the mid-flight socket death
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

/**
 * The dying browser transport (runtime rung): the REAL socket is closed the
 * moment a Page.navigate frame is dispatched -- the leg dies MID-STEP on the
 * real wire and the pipeline must surface the typed transport-closed failure
 * (never a fake commit). The fixture rung's DyingFakeCdpTransport is the
 * same journey over the fake transport.
 */
class ClosingWebSocketCdpTransport extends RecordingWebSocketCdpTransport {
	protected postMessage(payload: Record<string, unknown>): void {
		if (payload.method === 'Page.navigate') {
			this.sentFrames.push({
				method: 'Page.navigate',
				sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
			});
			this.close();
			return;
		}
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
			response.end(`<!doctype html><title>${url}</title><body>flauz agentos runtime origin ${url}</body>`);
		});
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({ port, close: () => server.close() });
		});
	});
}

// ---------------------------------------------------------------------------
// The stub provider server over a REAL socket (INV-2/INV-8): serves the
// Flauz cloud-sandbox wire contract v0 with scripted failure routes.
// ---------------------------------------------------------------------------

interface ProviderServer {
	readonly port: number;
	readonly calls: Array<{ method: string; path: string }>;
	close(): void;
}

function startProviderServer(): Promise<ProviderServer> {
	const calls: Array<{ method: string; path: string }> = [];
	// INV-2's sandbox (TL2-F2B, the budget-exceeding pattern): the provider fails
	// the first FIVE starts — beyond the default retry bound 3 — then recovers, so
	// the automatic bounded retry engages, is recorded, and EXHAUSTS before the
	// caller-driven second start recovers over a fresh window.
	let inv2StartCalls = 0;
	const server = http.createServer((request, response) => {
		const url = request.url ?? '/';
		const method = request.method ?? 'GET';
		calls.push({ method, path: url });
		if (url === '/__calls') {
			response.writeHead(200, { 'content-type': 'application/json' });
			response.end(JSON.stringify({ startCalls: inv2StartCalls }));
			return;
		}
		let body = '';
		request.on('data', (chunk: { toString(encoding?: string): string }) => {
			body += chunk.toString();
		});
		request.on('end', () => {
			const respond = (status: number, payload: Record<string, unknown>): void => {
				response.writeHead(status, { 'content-type': 'application/json' });
				response.end(JSON.stringify(payload));
			};
			if (method === 'POST' && url === '/v0/sandboxes') {
				let environmentId = 'unknown';
				try {
					const parsed = JSON.parse(body) as { metadata?: { environmentId?: string } };
					environmentId = parsed.metadata?.environmentId ?? 'unknown';
				} catch {
					// fall through with the unknown id
				}
				respond(200, { sandboxId: `sbx-${environmentId}`, status: 'created' });
				return;
			}
			if (method === 'POST' && url === `/v0/sandboxes/sbx-${CLOUD_ENV_ID}/start`) {
				inv2StartCalls += 1;
				if (inv2StartCalls <= 5) {
					respond(500, { error: 'provider exploded' });
					return;
				}
				respond(200, { status: 'running' });
				return;
			}
			if (method === 'POST' && url === `/v0/sandboxes/sbx-${CLOUD_ENV2_ID}/start`) {
				respond(404, { error: 'sandbox vanished' });
				return;
			}
			if (method === 'POST' && url.endsWith('/stop')) {
				respond(200, {});
				return;
			}
			if (method === 'GET' && url.startsWith('/v0/sandboxes/')) {
				respond(200, { sandboxId: url.slice('/v0/sandboxes/'.length), status: 'running' });
				return;
			}
			respond(404, { error: 'no such provider route' });
		});
	});
	return new Promise(resolve => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({ port, calls, close: () => server.close() });
		});
	});
}

// ---------------------------------------------------------------------------
// The on-disk helpers (shared with the fixture suite's shapes)
// ---------------------------------------------------------------------------

interface EnvOpLine {
	readonly op?: string;
	readonly result?: string;
	readonly actor?: string;
	readonly error?: { readonly code?: string; readonly message?: string };
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

/** Boots a minimal task/ledger/workflow trio on a root (the runtime drill's shared base). */
interface TaskTrio {
	readonly root: string;
	readonly fs: RuntimeFs;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
}

async function bootTaskTrio(root: string, clockStart: number): Promise<TaskTrio> {
	const fs = runtimeFsPort();
	const clock = steppingClock(clockStart);
	const tasks = new TaskService({ root, fs, clock });
	const ledger = new EvidenceLedger({ root, fs, clock });
	const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
	await tasks.bootstrap();
	await ledger.ensure();
	await fs.mkdir(`${root}/.flauz/workflows`);
	return { root, fs, tasks, ledger, workflows };
}

/** Seeds one completed single-tool task and saves W-001 (the runtime golden spine). */
async function seedAndSave(trio: TaskTrio, prompt: string, command: string): Promise<{ taskId: string; output: string }> {
	const created = await trio.tasks.createTask(prompt);
	const taskId = created.id;
	const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.`;
	await trio.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
	await trio.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
	const output = `${command}\nok`;
	const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
	await trio.fs.mkdir(`${trio.root}/.flauz/artifacts/${taskId}`);
	await trio.fs.writeFile(`${trio.root}/${artifactUri}`, output);
	const appended = await trio.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
	await trio.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
	await trio.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
	await trio.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
	await trio.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
	await trio.workflows.save({ taskId });
	return { taskId, output };
}

// ---------------------------------------------------------------------------
// The child-process machinery (the AGENTOS-CHILD line protocol)
// ---------------------------------------------------------------------------

interface DrillChild {
	kill9(): void;
	waitExit(timeoutMs: number): Promise<number | null>;
	waitFor(kind: string, timeoutMs: number): Promise<Record<string, unknown>>;
}

function drillAssertFail(label: string, detail: string): void {
	failures += 1;
	console.error(`agentos runtime drill: FAIL ${label} -- ${detail}`);
}

function spawnDrillChild(role: string, args: readonly string[], env: Record<string, string>): DrillChild {
	const child = spawn(process.execPath, ['--experimental-strip-types', nodePath.join(repoRootFromHere(), 'extensions', 'flauz-workflow', 'test', 'canaries', 'agentos-runtime.drill.ts'), '--child', role, ...args], {
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
			if (!line.startsWith('AGENTOS-CHILD ')) {
				if (line.length > 0) {
					console.log(`agentos runtime drill: CHILD[${role}] ${line}`);
				}
				continue;
			}
			const parts = line.slice('AGENTOS-CHILD '.length).split(' ');
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
		console.error('agentos runtime drill: --child requires --root <dir>');
		process.exit(2);
	}
	if (role === 'inv1-seed') {
		await childInv1Seed(root);
		return;
	}
	if (role === 'inv1-recover') {
		await childInv1Recover(root);
		return;
	}
	if (role === 'inv3-flight') {
		await childInv3Flight(root);
		return;
	}
	if (role === 'inv6-agent') {
		await childInv6Agent(root, args.get('--id') === 'b' ? 'b' : 'a', args.get('--task') ?? '');
		return;
	}
	console.error(`agentos runtime drill: unknown child role '${role}'`);
	process.exit(2);
}

function childReport(role: string, kind: string, payload: Record<string, unknown>): void {
	console.log(`AGENTOS-CHILD ${role} ${kind} ${JSON.stringify(payload)}`);
}

/** inv1-seed: the golden spine + real env + real browser, then idle until killed. */
async function childInv1Seed(root: string): Promise<void> {
	const trio = await bootTaskTrio(root, 1000);
	const seeded = await seedAndSave(trio, 'ship the flauz agentos inv1 runtime restart journey', 'echo flauz-agentos-inv1-runtime-ok');

	// the environment leg: the REAL LocalProcessExecutor (real grandchild harness)
	const fs = trio.fs;
	const envClock = steppingClock(1_740_000_000_000);
	const envRegistry = new EnvironmentRegistry({ root, fs, clock: envClock });
	await envRegistry.bootstrap();
	await envRegistry.register({
		id: ENV_ID,
		kind: ENV_KIND,
		label: 'Agent OS Runtime Drill Remote',
		connection: { authorityPrefix: 'flauz-local' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
	});
	const localExecutor = new LocalProcessExecutor({
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
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [localExecutor] });
	await envManager.bootstrap();
	const created = await envManager.perform('create', { id: ENV_ID, actor: 'agent' });
	if (!created.ok) {
		childReport('inv1-seed', 'ERROR', { stage: 'env-create', code: opErrorCode(created) });
		process.exit(1);
	}
	const started = await envManager.perform('start', { id: ENV_ID, actor: 'agent' });
	if (!started.ok) {
		childReport('inv1-seed', 'ERROR', { stage: 'env-start', code: opErrorCode(started) });
		process.exit(1);
	}
	const stopped = await envManager.perform('stop', { id: ENV_ID, actor: 'agent' });
	if (!stopped.ok) {
		childReport('inv1-seed', 'ERROR', { stage: 'env-stop', code: opErrorCode(stopped) });
		process.exit(1);
	}

	// the browser leg: the REAL CDP endpoint against the local origin
	const origin = process.env['FLAUZ_AGENTOS_ORIGIN'] ?? '';
	const endpoint = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
	if (origin === '' || endpoint === '') {
		childReport('inv1-seed', 'ERROR', { stage: 'browser-env', code: 'missing FLAUZ_AGENTOS_ORIGIN/FLAUZ_CDP_ENDPOINT' });
		process.exit(1);
	}
	const browser = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(RUNTIME_POLICY),
		host: new CdpEndpointHost(endpoint, {
			transportFactory: url => new RecordingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS }),
		}),
		workspaceRoot: root,
		journal: new FileSystemSessionJournal(root),
		clock: () => FIXED_BROWSER_TS,
		commandTimeoutMs: COMMAND_TIMEOUT_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
	});
	const opened = await browser.open({ initiator: 'agent', agentId: 'worker-inv1-runtime' });
	if (isSessionError(opened)) {
		childReport('inv1-seed', 'ERROR', { stage: 'browser-open', code: opened.error.code });
		process.exit(1);
	}
	const navigation = await browser.navigate((opened as OpenSessionResult).descriptor.sessionId, `${origin}/inv1`);
	if (!isNavigationOutcome(navigation) || navigation.verdict.decision !== 'allow') {
		childReport('inv1-seed', 'ERROR', { stage: 'browser-navigate' });
		process.exit(1);
	}
	await browser.close((opened as OpenSessionResult).descriptor.sessionId);
	await browser.dispose();

	const journalLines = (await readJournalRecords(root)).length;
	childReport('inv1-seed', 'READY', {
		taskId: seeded.taskId,
		ledgerRows: (await trio.ledger.readRows()).length,
		journalLines,
		workflowId: 'W-001',
	});
	// quiescent idle: the parent SIGKILLs this process (true process death)
	await new Promise<void>(() => {
		const keepalive = setInterval(() => undefined, 60_000);
		if (typeof keepalive.unref === 'function') {
			keepalive.unref();
		}
	});
}

/** inv1-recover: cold boot on the SAME root; census + the continuation re-run. */
async function childInv1Recover(root: string): Promise<void> {
	const trio = await bootTaskTrio(root, 9000);
	const listedTasks = await trio.tasks.listTasks();
	const listedWorkflows = await trio.workflows.list();
	const journalLines = (await readJournalRecords(root)).length;
	const verify = await trio.ledger.verify();
	const envState = await readEnvLifecycleState(root, ENV_ID);
	const executor: ToolExecutorPort = async () => ({ ok: true, output: 'echo flauz-agentos-inv1-runtime-ok\nok' });
	const rerun = await trio.workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
	const recoveredTask = listedTasks[0];
	childReport('inv1-recover', 'REPORT', {
		taskCount: listedTasks.length,
		taskId: recoveredTask?.id ?? '',
		taskStatus: recoveredTask?.status ?? '',
		taskEvents: recoveredTask?.events.length ?? -1,
		ledgerVerifyOk: verify.ok,
		ledgerRows: verify.rows,
		workflowIds: listedWorkflows.map(fragment => fragment.id),
		journalLines,
		envState,
		rerunStopped: rerun.stopped,
	});
}

/** inv3-flight: run the two-tool workflow; block tool 1 on the GO file; report the post-cancel truth. */
async function childInv3Flight(root: string): Promise<void> {
	const trio = await bootTaskTrio(root, 5000);
	let executorCalls = 0;
	let runTaskId = '';
	const goPath = nodePath.join(root, 'GO');
	const executor: ToolExecutorPort = async step => {
		executorCalls += 1;
		if (step.seq === 1) {
			const tasksNow = await trio.tasks.listTasks();
			const flight = tasksNow.find(candidate => candidate.id !== 'T-001');
			runTaskId = flight?.id ?? '';
			childReport('inv3-flight', 'TASK', { taskId: runTaskId });
			childReport('inv3-flight', 'TOOL-START', { seq: 1 });
			const deadline = Date.now() + 30_000;
			while (!nodeFsSync.existsSync(goPath)) {
				if (Date.now() > deadline) {
					childReport('inv3-flight', 'ERROR', { stage: 'go-timeout' });
					process.exit(1);
				}
				await sleep(20);
			}
		} else {
			childReport('inv3-flight', 'TOOL-START', { seq: step.seq });
		}
		return { ok: true, output: `tool-${step.seq}-runtime-output` };
	};
	const ask: ApprovalPort = async () => 'approve';
	let crashMessage = '<no crash>';
	try {
		await trio.workflows.run({ workflowId: 'W-001', executor, approvals: 'ask', ask });
	} catch (err) {
		crashMessage = err instanceof Error ? err.message : String(err);
	}
	const finalTask = await trio.tasks.getTask(runTaskId);
	childReport('inv3-flight', 'REPORT', {
		taskId: runTaskId,
		toolCalls: executorCalls,
		crashTyped: crashMessage.includes('flauz.tasks/v0'),
		crashExcerpt: crashMessage.slice(0, 160),
		finalStatus: finalTask.status,
		cancelEventActor: finalTask.events.find(event => event.type === 'cancel')?.actor ?? '',
	});
}

/**
 * The two-phase read-completion rendezvous fs (the deterministic
 * cross-process lost-update): a readFileUtf8 of the ledger file writes MY
 * read-done marker, waits for the OTHER agent's read-done marker, then returns
 * -- so both internal reads of EvidenceLedger.append provably complete
 * before either appendFile is issued.
 */
class RendezvousRuntimeFs {
	private readonly inner: RuntimeFs;
	private readonly ledgerPath: string;
	private readonly myMarker: string;
	private readonly otherMarker: string;

	constructor(inner: RuntimeFs, ledgerPath: string, myId: 'a' | 'b') {
		this.inner = inner;
		this.ledgerPath = ledgerPath;
		this.myMarker = `${nodePath.dirname(ledgerPath)}/marker-${myId}.read-done`;
		this.otherMarker = `${nodePath.dirname(ledgerPath)}/marker-${myId === 'a' ? 'b' : 'a'}.read-done`;
	}

	async readFileUtf8(path: string): Promise<string | undefined> {
		if (path !== this.ledgerPath) {
			return this.inner.readFileUtf8(path);
		}
		const snapshot = await this.inner.readFileUtf8(path);
		await this.inner.writeFile(this.myMarker, 'done');
		const deadline = Date.now() + 30_000;
		while (!nodeFsSync.existsSync(this.otherMarker)) {
			if (Date.now() > deadline) {
				throw new Error(`agentos runtime drill: rendezvous timeout waiting for ${this.otherMarker}`);
			}
			await sleep(10);
		}
		return snapshot;
	}

	writeFile(target: string, contents: string): Promise<void> {
		return this.inner.writeFile(target, contents);
	}
	appendFile(target: string, contents: string): Promise<void> {
		return this.inner.appendFile(target, contents);
	}
	rename(from: string, to: string): Promise<void> {
		return this.inner.rename(from, to);
	}
	mkdir(target: string): Promise<void> {
		return this.inner.mkdir(target);
	}
	readdir(target: string): Promise<string[]> {
		return this.inner.readdir(target);
	}
	rm(target: string): Promise<void> {
		return this.inner.rm(target);
	}
}

/** inv6-agent: one of the two concurrent ledger appenders. */
async function childInv6Agent(root: string, id: 'a' | 'b', taskId: string): Promise<void> {
	const fs = runtimeFsPort();
	const ledgerPath = nodePath.join(root, '.flauz', 'evidence', 'ledger.jsonl');
	const rendezvous = new RendezvousRuntimeFs(fs, ledgerPath, id);
	const ledger = new EvidenceLedger({ root, fs: rendezvous, clock: steppingClock(id === 'a' ? 70_000 : 80_000) });
	const appended = await ledger.append(taskId, { kind: 'command-output', uri: `.flauz/artifacts/${taskId}/runtime-agent-${id}.txt`, sha256: sha256Hex(`inv6-runtime-${id}`), note: `echo inv6-runtime-${id}` });
	childReport('inv6-agent', 'REPORT', { id, taskId, evidenceId: appended.evidenceId, seq: appended.seq });
}

// ===========================================================================
// The runtime journeys
// ===========================================================================

/** INV-1 over REAL child processes: seed -> SIGKILL -> cold recovery. */
async function journeyInv1(origin: string): Promise<void> {
	const recorder = new JourneyRecorder('INV-1', 'restart-recovery');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv1-'));
	const seed = spawnDrillChild('inv1-seed', ['--root', root], {
		FLAUZ_CDP_ENDPOINT: ENDPOINT,
		FLAUZ_AGENTOS_ORIGIN: origin,
	});
	const ready = await seed.waitFor('READY', 90_000);
	drillAssert(typeof ready.taskId === 'string' && ready.taskId !== '', 'inv1 runtime: the seed child reached quiescence (READY)', JSON.stringify(ready));
	seed.kill9();
	const seedExit = await seed.waitExit(15_000);
	drillAssert(seedExit !== 0, 'inv1 runtime: the seed child died by SIGKILL (nonzero exit)', `exit ${String(seedExit)}`);

	const recover = spawnDrillChild('inv1-recover', ['--root', root], {});
	const report = await recover.waitFor('REPORT', 90_000);
	const recoverExit = await recover.waitExit(15_000);
	drillAssert(recoverExit === 0, 'inv1 runtime: the recovery child exited cleanly', `exit ${String(recoverExit)}`);

	recorder.check('inv1.tasks-recover', report.taskCount === 1 && report.taskId === ready.taskId, `recovered task count ${String(report.taskCount)}`);
	recorder.check('inv1.task-spine-recovers', report.taskStatus === 'done' && report.taskEvents === 7, `recovered task status ${String(report.taskStatus)} events ${String(report.taskEvents)}`);
	recorder.check('inv1.ledger-recovers', report.ledgerVerifyOk === true && report.ledgerRows === 1, `recovered ledger verify ok=${String(report.ledgerVerifyOk)} rows=${String(report.ledgerRows)}`);
	recorder.check('inv1.workflows-recover', Array.isArray(report.workflowIds) && (report.workflowIds as string[]).join(',') === 'W-001', `recovered workflows ${JSON.stringify(report.workflowIds)}`);
	recorder.check('inv1.work-continues', report.rerunStopped === 'completed', `the recovered re-run stopped ${String(report.rerunStopped)}`);
	recorder.check('inv1.journal-recovers', typeof report.journalLines === 'number' && (report.journalLines as number) >= 2, `journal lines after the kill ${String(report.journalLines)}`);
	recorder.check('inv1.env-state-recovers', report.envState === 'stopped', `environment state after the kill ${String(report.envState)}`);

	registerRow(recorder.buildRow(
		`real child processes against ${root}: seed READY -> SIGKILL (exit ${String(seedExit)}) -> cold recovery (task done/7 events, ledger verify ok, W-001 re-run completed, journal ${String(report.journalLines)} lines, env stopped)`,
	));
	await nodeFs.rm(root, { recursive: true, force: true });
}

/** INV-2 over the real-socket stub provider server. */
async function journeyInv2(providerPort: number): Promise<void> {
	const recorder = new JourneyRecorder('INV-2', 'provider-failure-retry');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv2-'));
	try {
		const fs = runtimeFsPort();
		const envClock = steppingClock(1_740_000_000_000);
		const envRegistry = new EnvironmentRegistry({ root, fs, clock: envClock });
		await envRegistry.bootstrap();
		await envRegistry.register({
			id: CLOUD_ENV_ID,
			kind: CLOUD_ENV_KIND,
			label: 'Agent OS Runtime Drill Cloud',
			connection: { provider: 'custom', apiKeyRef: 'vault:flauz-battery-key', sandboxTemplate: 'flauz-battery-tpl' },
			trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
			capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		});
		const cloud = new CloudHttpExecutor({
			root,
			http: nodeHttpPort,
			secrets: { resolve: async ref => ref === 'vault:flauz-battery-key' ? 'test-key-material' : undefined },
			baseUrl: `http://127.0.0.1:${String(providerPort)}`,
			fs,
			hash: nodeHashPort,
			clock: envClock,
			requestTimeoutMs: 5_000,
		});
		const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [cloud], providerRetryWait: async () => undefined }); // deterministic: the drill path never really sleeps
		await envManager.bootstrap();

		const actor = 'agent';
		const createOutcome = await envManager.perform('create', { id: CLOUD_ENV_ID, actor });
		drillAssert(createOutcome.ok, 'inv2 runtime: cloud create succeeds against the real-socket stub provider', opErrorCode(createOutcome));
		const failedStart = await envManager.perform('start', { id: CLOUD_ENV_ID, actor });
		recorder.check('inv2.no-silent-success', failedStart.ok === false && opErrorCode(failedStart) === 'CLOUD_PROVIDER_ERROR', `failing start over the real socket ok=${String(failedStart.ok)} code=${opErrorCode(failedStart)} (the exhausted window never flips to success)`);
		const stateAfterFailure = await readEnvLifecycleState(root, CLOUD_ENV_ID);
		recorder.check('inv2.state-reflects-failure', stateAfterFailure === 'failed', `lifecycle state after the provider failure '${stateAfterFailure}'`);
		const ops = await readEnvOps(root);
		const failedOp = ops.find(op => op.op === 'start' && op.result === 'error' && op.toState === 'failed');
		recorder.check('inv2.failure-recorded', failedOp !== undefined && failedOp.actor === 'agent' && failedOp.error?.code === 'CLOUD_PROVIDER_ERROR', `ops ledger records the failed start over the real socket (the request-level terminal row): ${JSON.stringify(failedOp ?? null)}`);

		const providerStartCalls = await readProviderStartCalls(providerPort);
		recorder.check('inv2.bounded-retry', providerStartCalls >= 2, `bounded, recorded retry behavior over the real socket: the automatic bounded retry performed ${String(providerStartCalls)} provider start call(s) against the failing provider before surfacing the typed error (the window bound is 3; the stub fails the first 5)`);
		recorder.check('inv2.bounded-exhaustion', providerStartCalls === 3, `the automatic retry count stops at exactly the window bound (${String(providerStartCalls)} call(s) against a stub failing the first 5 — bounded, not unbounded)`);
		const attemptRows = ops.filter(op => op.op === 'start' && op.result === 'error' && typeof op.error?.message === 'string' && op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
		const attemptFacts = attemptRows.map(op => parseProviderRetryAttemptMessage(op.error?.message));
		recorder.check('inv2.retry-attempts-recorded', attemptRows.length === 3 && attemptFacts.every(fact => fact !== undefined && fact.op === 'start' && fact.code === 'CLOUD_PROVIDER_ERROR' && fact.maxAttempts === 3) && attemptFacts.map(fact => fact!.ordinal).join(',') === '1,2,3' && attemptFacts[0]?.nextAttemptOrdinal === 2 && attemptFacts[1]?.nextAttemptOrdinal === 3 && attemptFacts[2]?.nextAttemptOrdinal === undefined, `the ops ledger carries the recorded retry attempt sequence over the real socket (ordinals + typed outcomes + waits applied): ${JSON.stringify(attemptFacts)}`);

		const recoveredStart = await envManager.perform('start', { id: CLOUD_ENV_ID, actor });
		recorder.check('inv2.retry-recovered-recorded', recoveredStart.ok === true, `the caller-driven retry after provider recovery ok=${String(recoveredStart.ok)} (a fresh bounded window that recovers within its own bound)`);
		const opsAfter = await readEnvOps(root);
		const startRows = opsAfter.filter(op => op.op === 'start');
		const requestLevelRows = startRows.filter(op => typeof op.error?.message !== 'string' || !op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
		recorder.check('inv2.retry-recorded', startRows.length === 7 && requestLevelRows.length === 2 && requestLevelRows.filter(op => op.result === 'error').length === 1 && requestLevelRows.filter(op => op.result === 'ok').length === 1, `ops ledger carries the two explicit start requests (2 request-level rows: 1 error + 1 ok) plus the recorded retry attempts (5 attempt rows; ${String(startRows.length)} start lines total)`);

		// the task-level failure path (in-process, same as the fixture rung)
		const trio = await bootTaskTrio(root, 1000);
		const seeded = await seedAndSave(trio, 'ship the flauz agentos inv2 runtime journey', 'echo flauz-agentos-inv2-runtime-ok');
		void seeded;
		let executorCalls = 0;
		const executor: ToolExecutorPort = async () => {
			executorCalls += 1;
			return { ok: false, output: 'cloud provider start failed over the real socket: CLOUD_PROVIDER_ERROR (HTTP 500)' };
		};
		const rerun = await trio.workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
		const failedTask = await trio.tasks.getTask(rerun.taskId);
		recorder.check('inv2.task-reflects-failure-path', rerun.stopped === 'tool-failed' && failedTask.status === 'failed' && failedTask.events.some(event => event.type === 'fail'), `the task wrapping the failing provider leg stopped '${rerun.stopped}' status '${failedTask.status}'`);
		recorder.check('inv2.evidence-on-failure', rerun.evidenceIds.length === 1, `evidence rows recorded for the failing leg: ${String(rerun.evidenceIds.length)}`);
		drillAssert(executorCalls === 1, 'inv2 runtime: the failing tool leg executed exactly once', `calls ${String(executorCalls)}`);

		registerRow(recorder.buildRow(
			`cloud-sandbox seam over the REAL socket (stub provider server 127.0.0.1:${String(providerPort)}): the automatic bounded retry engaged (3/3 attempts recorded, exhausted at the bound against a stub failing the first 5), typed CLOUD_PROVIDER_ERROR terminal, lifecycle failed; the caller-driven second start opened a FRESH window and recovered (2 request-level rows + 5 attempt rows); the flauz-models seam has no failure path on main; the lifecycle-seam contract landed TL2-F2B`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

async function readProviderStartCalls(providerPort: number): Promise<number> {
	// the provider server exposes a debug census route (real HTTP, no state guessing)
	const response = await fetch(`http://127.0.0.1:${String(providerPort)}/__calls`);
	const payload = JSON.parse(await response.text()) as { startCalls?: number };
	return payload.startCalls ?? -1;
}


/** INV-3 over a REAL child process running the flight. */
async function journeyInv3(): Promise<void> {
	const recorder = new JourneyRecorder('INV-3', 'cancellation-propagation');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv3-'));
	try {
		// pre-seed the two-tool fragment + the seed task
		const trio = await bootTaskTrio(root, 1000);
		const created = await trio.tasks.createTask('ship the flauz agentos inv3 runtime journey');
		const taskId = created.id;
		await trio.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan: `## Flauz plan - ${taskId}`, requestId: 'req-1' } });
		await trio.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
		for (const seq of [1, 2]) {
			const command = `echo flauz-agentos-inv3-runtime-tool-${seq}`;
			const output = `${command}\nok`;
			const artifactUri = `.flauz/artifacts/${taskId}/command-output-${seq}.txt`;
			await trio.fs.mkdir(`${root}/.flauz/artifacts/${taskId}`);
			await trio.fs.writeFile(`${root}/${artifactUri}`, output);
			const appended = await trio.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
			await trio.tasks.appendEvent(taskId, { ts: 2 + seq, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
		}
		await trio.tasks.appendEvent(taskId, { ts: 5, actor: 'agent', type: 'report', payload: {} });
		await trio.tasks.appendEvent(taskId, { ts: 6, actor: 'tool', type: 'verify-pass', payload: { rows: 2 } });
		await trio.tasks.appendEvent(taskId, { ts: 7, actor: 'human', type: 'sign-off', payload: {} });
		await trio.workflows.save({ taskId });

		const flight = spawnDrillChild('inv3-flight', ['--root', root], {});
		const taskReport = await flight.waitFor('TASK', 90_000);
		const runTaskId = typeof taskReport.taskId === 'string' ? taskReport.taskId : '';
		await flight.waitFor('TOOL-START', 90_000);
		drillAssert(runTaskId !== '' && runTaskId !== taskId, 'inv3 runtime: the flight child reported the run task and blocked on tool 1', `runTaskId ${runTaskId}`);

		// the human cancel, recorded mid-flight against the SAME on-disk root
		await trio.tasks.appendEvent(runTaskId, { ts: 20_000, actor: 'human', type: 'cancel', payload: { gate: 'mid-flight-runtime' } });
		await trio.fs.writeFile(nodePath.join(root, 'GO'), 'go');

		const report = await flight.waitFor('REPORT', 90_000);
		const flightExit = await flight.waitExit(15_000);
		drillAssert(flightExit === 0, 'inv3 runtime: the flight child exited cleanly after the report', `exit ${String(flightExit)}`);

		recorder.check('inv3.cancel-recorded-with-attribution', report.cancelEventActor === 'human', `the cancel event is recorded with actor ${String(report.cancelEventActor)}`);
		recorder.check('inv3.downstream-stopped', report.toolCalls === 1, `downstream work stopped by the mid-flight cancel: ${String(report.toolCalls)} tool step(s) executed by the flight child (tool 2 ran after the cancel on the v0 slice)`);
		recorder.check('inv3.typed-surface', report.finalStatus === 'cancelled', `the cancelled task stays terminal '${String(report.finalStatus)}'`);
		recorder.check('inv3.run-surface-typed-error', report.crashTyped === true, `the in-flight run surfaced a typed error at the next transition: ${String(report.crashExcerpt)}`);

		registerRow(recorder.buildRow(
			`real child process flight on ${root}: human cancel recorded mid-flight (actor human); ${String(report.toolCalls)} tool step(s) executed; typed crash ${String(report.crashTyped)}; final status ${String(report.finalStatus)}`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

/** INV-4 (in-process: the approval ports are human doubles at both rungs). */
async function journeyInv4(): Promise<void> {
	const recorder = new JourneyRecorder('INV-4', 'approval-interruption');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv4-'));
	try {
		const trio = await bootTaskTrio(root, 1000);
		const seeded = await seedAndSave(trio, 'ship the flauz agentos inv4 runtime journey', 'echo flauz-agentos-inv4-runtime-ok');
		void seeded;
		let calls = 0;
		const countingExecutor: ToolExecutorPort = async () => {
			calls += 1;
			return { ok: true, output: 'echo flauz-agentos-inv4-runtime-ok\nok' };
		};

		const cancelled = await trio.workflows.run({
			workflowId: 'W-001',
			executor: countingExecutor,
			approvals: 'ask',
			ask: async gate => gate === 'approval' ? 'cancel' : 'approve',
		});
		const cancelledTask = await trio.tasks.getTask(cancelled.taskId);
		const cancelEvent = cancelledTask.events.find(event => event.type === 'cancel');
		recorder.check('inv4.interrupted-stays-cancelled', cancelled.stopped === 'cancelled' && cancelledTask.status === 'cancelled', `the interrupted gate run stopped '${cancelled.stopped}' task '${cancelledTask.status}'`);
		recorder.check('inv4.interrupted-zero-execution', calls === 0, `executor calls after the interrupted gate: ${String(calls)}`);
		recorder.check('inv4.interrupted-attribution', cancelEvent !== undefined && cancelEvent.actor === 'human' && (cancelEvent.payload as { gate?: string }).gate === 'approval', `interrupted-gate cancel event actor=${String(cancelEvent?.actor)}`);

		const takenOver = await trio.workflows.run({
			workflowId: 'W-001',
			executor: countingExecutor,
			approvals: 'ask',
			ask: async gate => gate === 'approval' ? 'request-changes' : 'approve',
		});
		const takenOverTask = await trio.tasks.getTask(takenOver.taskId);
		const requestChangesEvent = takenOverTask.events.find(event => event.type === 'request-changes');
		recorder.check('inv4.takeover-fail-closed', takenOver.stopped === 'request-changes' && takenOverTask.status === 'plan', `the taken-over gate run stopped '${takenOver.stopped}' task '${takenOverTask.status}'`);
		recorder.check('inv4.takeover-zero-execution', calls === 0, `executor calls after the takeover: ${String(calls)}`);
		recorder.check('inv4.takeover-attribution', requestChangesEvent !== undefined && requestChangesEvent.actor === 'human' && (requestChangesEvent.payload as { gate?: string }).gate === 'approval', `takeover event actor=${String(requestChangesEvent?.actor)}`);

		const deferred = await trio.workflows.run({
			workflowId: 'W-001',
			executor: countingExecutor,
			approvals: 'ask',
			ask: async gate => gate === 'sign-off' ? 'skip' : 'approve',
		});
		recorder.check('inv4.signoff-skip-defers', deferred.stopped === 'awaiting-signoff', `the deferred sign-off run stopped '${deferred.stopped}'`);
		recorder.check('inv4.approved-run-executes-once', calls === 1, `executor calls across all runs: ${String(calls)}`);

		registerRow(recorder.buildRow(
			'three ask-mode gate journeys over W-001 (in-process, human-double ask port -- the rung-honest port for a human gate): cancel -> cancelled + 0 executor calls; request-changes -> plan + 0 executor calls; sign-off skip -> awaiting-signoff; actor=human + gate attribution on every gate event',
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

/**
 * INV-5: the lease-conflict contract (TL2-F3) over the REAL on-disk A2ABus -
 * the same two-claimant race as the fixture rung (only the ports change: the
 * runtime trio + the real file-backed bus); the verdict rows must agree.
 */
async function journeyInv5(): Promise<void> {
	const recorder = new JourneyRecorder('INV-5', 'lease-conflict');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv5-'));
	try {
		const trio = await bootTaskTrio(root, 1000);
		// The enforcing claim path over the runtime trio: an OrchestrationStore wired
		// to the task trio through the evidence-minting TaskPort adapter + the REAL
		// on-disk A2ABus (the flauz.a2a claim surface).
		const taskPort = {
			createTask: async (args: { title: string }) => ({ taskId: (await trio.tasks.createTask(args.title)).id }),
			appendEvidence: async (args: { taskId: string; row: { kind: string; uri: string; sha256: string } }) => {
				const appended = await trio.ledger.append(args.taskId, { kind: args.row.kind as EvidenceKind, uri: args.row.uri, sha256: args.row.sha256 });
				return { evidenceId: appended.evidenceId, seq: appended.seq };
			},
			appendEvent: async (args: { taskId: string; event: Record<string, unknown> }) => ({ task: await trio.tasks.appendEvent(args.taskId, args.event as TaskEvent) }),
		};
		const store = new OrchestrationStore(root, { taskPort, clock: steppingClock(500_000) });
		const bus = new A2ABus(root);
		const submitted = await store.submitGraph({
			title: 'inv5 runtime lease-conflict graph',
			steps: [{ stepId: 'S-01', title: 'contended shared work', instruction: 'two agents race for the lease' }],
			actor: 'agent',
			origin: 'runtime:inv5',
		});
		await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'runtime:inv5' });
		const resource = stepResourceId(submitted.graphId, 'S-01');

		// the race: two concurrent claimants, one resource, through the claim path
		const race = await Promise.allSettled([
			claimStepLease(store, bus, { graphId: submitted.graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-1', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-1' }),
			claimStepLease(store, bus, { graphId: submitted.graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-2', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-2' }),
		]);
		const acquiredRows = store.journalRows.filter(row => row.type === 'lease-acquired');
		const winner = race.find((result): result is PromiseFulfilledResult<{ status: string; leaseId: string; holder: string; deadline: number; rowId: string; noticeId: string }> => result.status === 'fulfilled');
		const loser = race.find((result): result is PromiseRejectedResult => result.status === 'rejected');
		recorder.check('inv5.exactly-one-winner', race.filter(result => result.status === 'fulfilled').length === 1 && loser !== undefined && acquiredRows.length === 1, `exactly one claimant acquired the lease (${race.map(result => result.status).join(' + ')}; lease-acquired rows: ${String(acquiredRows.length)})`);

		// the typed conflict error: the shape asserted (holder, lease id, deadline)
		const reason = loser?.reason;
		const facts = reason === undefined ? null : leaseConflictFacts(reason);
		const winnerClaim = winner?.value;
		recorder.check('inv5.typed-conflict-shape', isLeaseConflictError(reason) && facts !== null && facts.code === LEASE_CONFLICT_CODE && facts.violation === 'lease' && facts.holder === 'flauz.agent.worker-1' && facts.leaseId === winnerClaim?.leaseId && facts.deadline === winnerClaim?.deadline && facts.claimant === 'flauz.agent.worker-2', `the loser's typed conflict ${String(facts?.code)} carries the current holder (${String(facts?.holder)}), the lease id (${String(facts?.leaseId)}) and the lease deadline (${String(facts?.deadline)})`);

		// both attempts journaled with attribution: the winner's acquisition + the loser's refusal
		const conflicts = store.journalRows.filter(row => row.type === 'conflict-noticed');
		const conflictPayload = conflicts[0]?.payload as { violation: string; expectedHolder: string; actualRunner: string; evidenceId?: string } | undefined;
		const acquiredPayload = acquiredRows[0]?.payload as { holder: string; leaseId: string; expiresAt: number; evidenceId?: string } | undefined;
		recorder.check('inv5.both-attempts-journaled', conflicts.length === 1 && conflictPayload?.violation === 'lease' && conflictPayload?.expectedHolder === 'flauz.agent.worker-1' && conflictPayload?.actualRunner === 'flauz.agent.worker-2' && acquiredPayload?.holder === 'flauz.agent.worker-1' && /^E-\d{6,}$/.test(conflictPayload?.evidenceId ?? '') && /^E-\d{6,}$/.test(acquiredPayload?.evidenceId ?? ''), `the winner's acquisition and the loser's refusal are both journaled with attribution (conflict: expectedHolder=${String(conflictPayload?.expectedHolder)} actualRunner=${String(conflictPayload?.actualRunner)}; both rows carry minted evidence ids)`);

		// the evidence linkage: each minted row references its journal row
		const conflictEvidenceRow = conflictPayload?.evidenceId === undefined ? undefined : await trio.ledger.rowByEvidenceId(conflictPayload.evidenceId);
		const acquiredEvidenceRow = acquiredPayload?.evidenceId === undefined ? undefined : await trio.ledger.rowByEvidenceId(acquiredPayload.evidenceId);
		recorder.check('inv5.evidence-linkage', conflictEvidenceRow !== undefined && acquiredEvidenceRow !== undefined && conflictEvidenceRow.uri === `flauz-orch-transition://${String(conflicts[0]?.rowId)}` && acquiredEvidenceRow.uri === `flauz-orch-transition://${String(acquiredRows[0]?.rowId)}`, 'both attempts minted ledger evidence rows referencing their own journal rows (the conflict is recorded history, never a dropped message)');

		// the hash chains verify end-to-end (the evidence ledger + the orchestration journal)
		const ledgerVerify = await trio.ledger.verify();
		const journalVerify = store.verifyJournal();
		recorder.check('inv5.chain-verifies-end-to-end', ledgerVerify.ok && journalVerify.ok, `the evidence ledger chain verifies ok=${String(ledgerVerify.ok)} (${String(ledgerVerify.rows)} rows) and the orchestration journal chain verifies ok=${String(journalVerify.ok)} (${String(journalVerify.rows)} rows)`);

		// the flauz.a2a surface: the winner's notice landed on the real file-backed bus; the
		// enforcement point refuses a raw third claimant
		const active = bus.activeClaimOf(resource);
		let rawConflict: unknown = null;
		try {
			bus.post({ message: { kind: 'resource-claim', from: 'flauz.agent.worker-3', to: 'flauz.watchers', ts: (winnerClaim?.deadline ?? 1) - 1, payload: { action: 'acquire', resource, leaseUntil: (winnerClaim?.deadline ?? 1) + 60_000 } } });
		} catch (error) {
			rawConflict = error;
		}
		const rawFacts = leaseConflictFacts(rawConflict);
		const busJournal = (await nodeFs.readFile(nodePath.join(root, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
		recorder.check('inv5.bus-claim-path-enforces', active !== undefined && active.holder === 'flauz.agent.worker-1' && active.leaseId === winnerClaim?.noticeId && active.deadline === winnerClaim?.deadline && busJournal.length === 1 && isLeaseConflictError(rawConflict) && rawFacts?.holder === 'flauz.agent.worker-1' && rawFacts?.leaseId === winnerClaim?.noticeId, `the winner's acquire notice is the journal-projected lease (holder=${String(active?.holder)} leaseId=${String(active?.leaseId)}) and a raw acquire through the on-disk bus claim path receives the typed conflict (holder=${String(rawFacts?.holder)}, leaseId=${String(rawFacts?.leaseId)})`);

		// never a silent double-execution: one lease, one notice
		recorder.check('inv5.no-silent-double-execution', acquiredRows.length === 1 && busJournal.length === 1 && conflicts.length === 1, `exactly one lease-acquired row, one acquire notice (${String(busJournal.length)} journal line(s)) and one recorded refusal - never a silent double-execution`);

		// runtime-rung machine checks (the observable outcome over the real file-backed bus)
		const notice = JSON.parse(busJournal[0] ?? '{}') as { kind?: string; from?: string; payload?: { resource?: string } };
		drillAssert(busJournal.length === 1 && notice.kind === 'resource-claim' && notice.from === 'flauz.agent.worker-1' && notice.payload?.resource === resource, 'inv5 runtime: the on-disk A2A journal carries exactly the winner\'s acquire notice', `lines=${String(busJournal.length)}`);
		drillAssert(store.verifyJournal().ok && (await trio.ledger.verify()).ok, 'inv5 runtime: both hash chains verify end-to-end over the real fs', 'verify');

		registerRow(recorder.buildRow(
			`two claimants raced ${resource} through the flauz.a2a claim path over the REAL on-disk bus: worker-1 acquired ${String(winnerClaim?.leaseId)} (notice ${String(winnerClaim?.noticeId)}, deadline ${String(winnerClaim?.deadline)}); worker-2 received the typed ${LEASE_CONFLICT_CODE} {holder, leaseId, deadline}; both attempts journaled with attribution (lease-acquired + conflict-noticed, both evidence-bearing); ledger verify ok=${String(ledgerVerify.ok)}, journal verify ok=${String(journalVerify.ok)}`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

/** INV-6: the REAL on-disk A2A bus + TWO REAL concurrent child processes. */
async function journeyInv6(): Promise<void> {
	const recorder = new JourneyRecorder('INV-6', 'multi-agent-coordination');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv6-'));
	try {
		const trio = await bootTaskTrio(root, 1000);
		const parentTask = await trio.tasks.createTask('inv6 runtime parent delegation');
		const workerTask = await trio.tasks.createTask('inv6 runtime worker execution');
		const workerEvidence = await trio.ledger.append(workerTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${workerTask.id}/command-output-1.txt`, sha256: sha256Hex('inv6-runtime-worker-output'), note: 'echo inv6-runtime-worker' });

		// the A2A attribution leg over the REAL on-disk bus
		const bus = new A2ABus(root);
		const busPort: A2aPort = {
			post: async (input: A2aMessageInput) => bus.post({ message: { kind: input.kind, from: input.from, to: input.to, ts: input.ts, inReplyTo: input.inReplyTo, payload: input.payload } }),
			collect: async (agentId: string) => (await Promise.resolve(bus.collect({ agentId }))).messages,
		};
		const parent = new AgentMessenger({ self: 'flauz.agent', port: busPort, clock: steppingClock(30_000) });
		const worker = new AgentMessenger({ self: 'flauz.agent.worker-1', port: busPort, clock: steppingClock(31_000) });
		const delegated = await parent.delegate('flauz.agent.worker-1', { taskId: workerTask.id, taskDescription: 'inv6 runtime delegated slice', prompt: 'run the delegated slice' });
		const reported = await worker.reportBack('flauz.agent', { taskId: workerTask.id, outcome: 'ok', evidenceIds: [workerEvidence.evidenceId], summary: 'delegated slice done (runtime bus)' }, delegated.id);
		const mailbox = await parent.drain();
		const reportMessage = mailbox.find(message => message.id === reported.id);
		recorder.check('inv6.a2a-report-delivered', reportMessage !== undefined && reportMessage.from === 'flauz.agent.worker-1' && reportMessage.to === 'flauz.agent', `the result-report round-trips over the on-disk bus with from/to attribution: ${JSON.stringify(reportMessage ?? null)}`);
		const reportedEvidenceIds = reportMessage !== undefined ? (reportMessage.payload as { evidenceIds?: string[] }).evidenceIds ?? [] : [];
		const reportedEvidenceRow = await trio.ledger.rowByEvidenceId(reportedEvidenceIds[0] ?? '');
		recorder.check('inv6.evidence-attribution', reportedEvidenceRow !== undefined && reportedEvidenceRow.taskId === workerTask.id, `the reported evidence id resolves to a ledger row attributed to the worker task: ${JSON.stringify(reportedEvidenceRow?.taskId ?? null)}`);
		drillAssert((await nodeFs.readFile(nodePath.join(root, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0).length === 2, 'inv6 runtime: the on-disk A2A journal carries the two bus messages', 'journal line count');

		// the concurrent leg: TWO REAL child processes, the two-phase rendezvous
		await trio.ledger.append(parentTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${parentTask.id}/command-output-1.txt`, sha256: sha256Hex('inv6-runtime-parent-output'), note: 'echo inv6-runtime-parent' });
		const rowsBefore = (await trio.ledger.readRows()).length;
		await trio.fs.mkdir(nodePath.join(root, '.flauz', 'evidence'));
		const agentA = spawnDrillChild('inv6-agent', ['--root', root, '--id', 'a', '--task', parentTask.id], {});
		const agentB = spawnDrillChild('inv6-agent', ['--root', root, '--id', 'b', '--task', workerTask.id], {});
		const reportA = await agentA.waitFor('REPORT', 60_000);
		const reportB = await agentB.waitFor('REPORT', 60_000);
		const exitA = await agentA.waitExit(15_000);
		const exitB = await agentB.waitExit(15_000);
		drillAssert(exitA === 0 && exitB === 0, 'inv6 runtime: both concurrent agent children exited cleanly', `exits ${String(exitA)}/${String(exitB)}`);

		const rowsAfter = await new EvidenceLedger({ root, fs: runtimeFsPort(), clock: steppingClock(90_000) }).readRows();
		recorder.check('inv6.attribution-under-concurrency', rowsAfter.some(row => row.taskId === parentTask.id && row.sha256 === sha256Hex('inv6-runtime-a')) && rowsAfter.some(row => row.taskId === workerTask.id && row.sha256 === sha256Hex('inv6-runtime-b')), `both concurrent rows carry their own agent's taskId (${String(reportA.evidenceId)} -> ${parentTask.id}, ${String(reportB.evidenceId)} -> ${workerTask.id})`);
		const verify = await new EvidenceLedger({ root, fs: runtimeFsPort(), clock: steppingClock(95_000) }).verify();
		recorder.check('inv6.no-clobber', verify.ok, `concurrent appends from two REAL processes preserve the append-only chain: verify ok=${String(verify.ok)}${verify.ok ? '' : ` firstBadSeq=${String(verify.firstBadSeq)} (${verify.reason ?? ''})`}`);
		const duplicateSeq = rowsAfter.filter(row => row.seq === rowsBefore + 1).length;
		recorder.check('inv6.seq-uniqueness', duplicateSeq === 1, `the next seq was minted exactly once (${String(duplicateSeq)} rows carry seq ${String(rowsBefore + 1)} after the concurrent append)`);

		registerRow(recorder.buildRow(
			`A2A over the on-disk bus (report ${reported.id}); two real child processes with the two-phase read-completion rendezvous over ${String(rowsBefore)} rows: verify ok=${String(verify.ok)} firstBadSeq=${String(verify.firstBadSeq)}`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

/** INV-7 (in-process over real fs -- the ledger has no rung-substitutable port). */
async function journeyInv7(fixtureDir: string): Promise<void> {
	const recorder = new JourneyRecorder('INV-7', 'evidence-provenance-integrity');
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv7-'));
	try {
		const trio = await bootTaskTrio(root, 1000);
		const task = await trio.tasks.createTask('inv7 runtime provenance');
		for (let seq = 1; seq <= 5; seq += 1) {
			const output = `inv7-runtime-row-${seq}`;
			await trio.ledger.append(task.id, { kind: 'command-output', uri: `.flauz/artifacts/${task.id}/command-output-${seq}.txt`, sha256: sha256Hex(output), note: `echo inv7-runtime-${seq}` });
		}
		const ledgerPath = nodePath.join(root, '.flauz', 'evidence', 'ledger.jsonl');

		const recovered = new EvidenceLedger({ root, fs: trio.fs, clock: steppingClock(20_000) });
		const recoveredVerify = await recovered.verify();
		recorder.check('inv7.chain-verifies', recoveredVerify.ok && recoveredVerify.rows === 5, `the recovered five-row chain verifies ok=${String(recoveredVerify.ok)} rows=${String(recoveredVerify.rows)}`);

		const originalLines = (await nodeFs.readFile(ledgerPath, { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
		const doctoredRow = JSON.parse(originalLines[2] ?? '') as LedgerRow;
		const tamperedLines = [...originalLines];
		tamperedLines[2] = rowLine({ ...doctoredRow, uri: '.flauz/artifacts/DOCTORED-RUNTIME.txt' });
		await nodeFs.writeFile(ledgerPath, `${tamperedLines.join('\n')}\n`, { encoding: 'utf-8' });
		const tamperVerify = await new EvidenceLedger({ root, fs: trio.fs, clock: steppingClock(30_000) }).verify();
		recorder.check('inv7.doctored-row-detected', tamperVerify.ok === false && tamperVerify.firstBadSeq === 4, `the doctored mid-chain row is detected with the first broken link named: ok=${String(tamperVerify.ok)} firstBadSeq=${String(tamperVerify.firstBadSeq)} (${tamperVerify.reason ?? ''})`);

		const reorderedLines = [...originalLines];
		const second = reorderedLines[1] ?? '';
		reorderedLines[1] = reorderedLines[2] ?? '';
		reorderedLines[2] = second;
		await nodeFs.writeFile(ledgerPath, `${reorderedLines.join('\n')}\n`, { encoding: 'utf-8' });
		const reorderVerify = await new EvidenceLedger({ root, fs: trio.fs, clock: steppingClock(40_000) }).verify();
		recorder.check('inv7.reorder-detected', reorderVerify.ok === false && reorderVerify.firstBadSeq !== undefined, `the reordered chain is detected: ok=${String(reorderVerify.ok)} firstBadSeq=${String(reorderVerify.firstBadSeq)} (${reorderVerify.reason ?? ''})`);

		await nodeFs.writeFile(ledgerPath, `${originalLines.join('\n')}\n`, { encoding: 'utf-8' });
		const restoredVerify = await new EvidenceLedger({ root, fs: trio.fs, clock: steppingClock(50_000) }).verify();
		recorder.check('inv7.restored-chain-verifies', restoredVerify.ok && restoredVerify.rows === 5, `the restored pristine chain verifies again ok=${String(restoredVerify.ok)}`);

		const doctoredRoot = nodePath.join(fixtureDir, 'doctored-ledger');
		const doctoredLedger = new EvidenceLedger({ root: doctoredRoot, fs: runtimeFsPort(), clock: steppingClock(60_000) });
		const controlVerify = await doctoredLedger.verify();
		recorder.check('inv7.control-detection', controlVerify.ok === false, `the committed doctored-ledger control fixture is detected over real fs: ok=${String(controlVerify.ok)}`);
		recorder.control('inv7.control-first-broken-link', controlVerify.ok === false && controlVerify.firstBadSeq === 4, `the committed doctored fixture must name the first broken link (got firstBadSeq=${String(controlVerify.firstBadSeq)}, expected 4)`);
		const controlRows = await doctoredLedger.readRows();
		recorder.control('inv7.control-row-count', controlRows.length === 5, `the committed doctored fixture carries its five rows (got ${String(controlRows.length)})`);

		registerRow(recorder.buildRow(
			`live chain: 5 rows, verify ok; mid-chain doctor detected (firstBadSeq 4); reorder detected (firstBadSeq ${String(reorderVerify.firstBadSeq)}); doctored-ledger-control: ${controlVerify.ok === false ? `detected (firstBadSeq ${String(controlVerify.firstBadSeq)})` : 'UNDETECTED'}`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

/** INV-8: the dead cloud sandbox (real-socket 404) + the dead browser socket. */
async function journeyInv8(providerPort: number, origin: string): Promise<void> {
	const recorder = new JourneyRecorder('INV-8', 'partial-environment-browser-failure');

	// (a) the environment leg: the provider reports the sandbox GONE (HTTP 404) over the real socket
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-runtime-inv8-'));
	try {
		const fs = runtimeFsPort();
		const envClock = steppingClock(1_740_000_000_000);
		const envRegistry = new EnvironmentRegistry({ root, fs, clock: envClock });
		await envRegistry.bootstrap();
		await envRegistry.register({
			id: CLOUD_ENV2_ID,
			kind: CLOUD_ENV_KIND,
			label: 'Agent OS Runtime Drill Cloud 2',
			connection: { provider: 'custom', apiKeyRef: 'vault:flauz-battery-key', sandboxTemplate: 'flauz-battery-tpl' },
			trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
			capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
		});
		const cloud = new CloudHttpExecutor({
			root,
			http: nodeHttpPort,
			secrets: { resolve: async ref => ref === 'vault:flauz-battery-key' ? 'test-key-material' : undefined },
			baseUrl: `http://127.0.0.1:${String(providerPort)}`,
			fs,
			hash: nodeHashPort,
			clock: envClock,
			requestTimeoutMs: 5_000,
		});
		const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [cloud] });
		await envManager.bootstrap();
		const actor = 'agent';
		const createOutcome = await envManager.perform('create', { id: CLOUD_ENV2_ID, actor });
		drillAssert(createOutcome.ok, 'inv8 runtime: cloud create succeeds against the real-socket stub provider', opErrorCode(createOutcome));
		const deadStart = await envManager.perform('start', { id: CLOUD_ENV2_ID, actor });
		recorder.check('inv8.env-death-typed', deadStart.ok === false && opErrorCode(deadStart) === 'CLOUD_SANDBOX_UNKNOWN', `the dead environment start surfaces the typed error ok=${String(deadStart.ok)} code=${opErrorCode(deadStart)}`);
		const envState = await readEnvLifecycleState(root, CLOUD_ENV2_ID);
		recorder.check('inv8.env-death-state', envState === 'failed', `the lifecycle state after the environment death '${envState}'`);
		const ops = await readEnvOps(root);
		recorder.check('inv8.env-death-recorded', ops.some(op => op.op === 'start' && op.result === 'error' && op.error?.code === 'CLOUD_SANDBOX_UNKNOWN'), 'the environment death is recorded in the ops ledger');
		const described = await envManager.describe({ id: CLOUD_ENV2_ID });
		recorder.check('inv8.no-fake-health', described.verdict.health !== 'healthy', `describe never claims healthy for the dead environment: ${String(described.verdict.health)}`);

		// (b) the browser leg: the REAL socket dies mid-navigation
		const browser = new BrowserSessionManager({
			engine: () => BrowserPolicyEngine.fromPolicyText(RUNTIME_POLICY),
			host: new CdpEndpointHost(ENDPOINT, {
				transportFactory: url => new ClosingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS }),
			}),
			workspaceRoot: root,
			journal: new FileSystemSessionJournal(root),
			clock: () => FIXED_BROWSER_TS,
			commandTimeoutMs: COMMAND_TIMEOUT_MS,
			navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
		});
		const opened = await browser.open({ initiator: 'agent', agentId: 'worker-inv8-runtime' });
		drillAssert(isSessionError(opened) === false, 'inv8 runtime: the browser session opens against the real Chromium', isSessionError(opened) ? opened.error.code : '');
		const sessionId = (opened as OpenSessionResult).descriptor.sessionId;
		const deadNavigation = await browser.navigate(sessionId, `${origin}/inv8`);
		recorder.check('inv8.browser-death-typed', isNavigationOutcome(deadNavigation) && deadNavigation.error?.code === 'flauz.browser.transport-closed', `the mid-navigation real-socket death surfaces the typed error: ${JSON.stringify(deadNavigation.error ?? null)}`);
		recorder.check('inv8.browser-death-no-fake-success', isNavigationOutcome(deadNavigation) && deadNavigation.committedUrl === undefined, `the dead navigation never commits a url (committedUrl ${JSON.stringify(deadNavigation.committedUrl ?? null)})`);
		await browser.dispose();

		// (c) the task-level marking (in-process, same as the fixture rung)
		const trio = await bootTaskTrio(root, 1000);
		const seeded = await seedAndSave(trio, 'ship the flauz agentos inv8 runtime journey', 'echo flauz-agentos-inv8-runtime-ok');
		void seeded;
		let executorCalls = 0;
		const executor: ToolExecutorPort = async () => {
			executorCalls += 1;
			return { ok: false, output: 'browser leg died mid-step over the real socket: flauz.browser.transport-closed' };
		};
		const rerun = await trio.workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
		const failedTask = await trio.tasks.getTask(rerun.taskId);
		recorder.check('inv8.task-failed-with-evidence', rerun.stopped === 'tool-failed' && failedTask.status === 'failed' && rerun.evidenceIds.length === 1, `the task wrapping the dead leg stopped '${rerun.stopped}' status '${failedTask.status}' with ${String(rerun.evidenceIds.length)} evidence row(s)`);
		recorder.check('inv8.downstream-stopped', executorCalls === 1, `downstream tool steps after the dead leg: ${String(executorCalls - 1)}`);
		const failEvent = failedTask.events.find(event => event.type === 'fail');
		recorder.check('inv8.failure-attributed', failEvent !== undefined && failEvent.actor === 'agent', `the fail event is recorded with actor ${String(failEvent?.actor)}`);

		registerRow(recorder.buildRow(
			`environment death over the real socket: CLOUD_SANDBOX_UNKNOWN (HTTP 404) -> lifecycle failed + ops ledger + describe not-healthy; browser death: the real CDP socket closed mid-navigation (no committedUrl); task wrapping: tool-failed + 1 evidence row + downstream stopped`,
		));
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
}

// ===========================================================================
// The selftest (zero-dep machinery)
// ===========================================================================

async function runSelftest(): Promise<void> {
	console.log('agentos runtime drill: --- selftest (zero-dep machinery) ---');
	// verdict assembly: synthetic rows -> document with consistent summary
	const syntheticRows: VerdictRow[] = [
		{ invariant: 'INV-1', verdict: 'PASS', reason: 'all 1 target assertions held', assertions: { pass: 1, fail: 0 }, evidence: 'x' },
		{ invariant: 'INV-2', verdict: 'FAIL', reason: 'violated invariant INV-2 provider-failure-retry: x', violatedInvariant: 'INV-2 provider-failure-retry -- first failing assertion inv2.bounded-retry: x', assertions: { pass: 2, fail: 1 }, evidence: 'y' },
		{ invariant: 'INV-5', verdict: 'SKIP', reason: INV5_SKIP_REASON, assertions: { pass: 0, fail: 0 }, evidence: 'z' },
	];
	const synthetic = new Map(syntheticRows.map(row => [row.invariant, row]));
	for (const row of syntheticRows) {
		registerRow(row);
	}
	const document = assembleVerdictDocument();
	drillAssert(document.schema === AGENTOS_BATTERY_SCHEMA && document.rung === 'runtime' && document.rows.length === 3 && document.summary.pass === 1 && document.summary.fail === 1 && document.summary.skip === 1, 'selftest: verdict assembly produces a consistent flauz.agentos-battery/v1 runtime document', JSON.stringify(document.summary));
	rows.clear();
	void synthetic;
	// contract-skip classification: the TL2-pending marker is detected
	drillAssert(isContractSkip(INV5_SKIP_REASON) === true, 'selftest: the contract-skip reason (TL2-004 pending) is classified as distance', INV5_SKIP_REASON.slice(-40));
	drillAssert(isContractSkip('no FLAUZ_CDP_ENDPOINT') === false, 'selftest: an environmental skip reason is NOT classified as distance', 'no FLAUZ_CDP_ENDPOINT');
	// the two-phase rendezvous fs (in-process): two concurrent ledger reads
	// both return the pre-state after exchanging markers
	const tmpRoot = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-selftest-'));
	try {
		const fs = runtimeFsPort();
		await fs.mkdir(nodePath.join(tmpRoot, '.flauz', 'evidence'));
		const ledgerPath = nodePath.join(tmpRoot, '.flauz', 'evidence', 'ledger.jsonl');
		await fs.writeFile(ledgerPath, 'PRE-STATE\n');
		const fsA = new RendezvousRuntimeFs(fs, ledgerPath, 'a');
		const fsB = new RendezvousRuntimeFs(fs, ledgerPath, 'b');
		const [readA, readB] = await Promise.all([
			fsA.readFileUtf8(ledgerPath),
			fsB.readFileUtf8(ledgerPath),
		]);
		drillAssert(readA === 'PRE-STATE\n' && readB === 'PRE-STATE\n', 'selftest: the two-phase rendezvous serves both concurrent readers the same pre-state', `${JSON.stringify(readA ?? '')}/${JSON.stringify(readB ?? '')}`);
	} finally {
		await nodeFs.rm(tmpRoot, { recursive: true, force: true });
	}
	if (failures > 0) {
		console.error(`agentos runtime drill: SELFTEST FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log(`agentos runtime drill: ${assertions} assertions, 0 failures`);
	console.log('agentos runtime drill: SELFTEST GREEN (verdict + rendezvous + classifier machinery, zero-dep)');
}

// ===========================================================================
// main
// ===========================================================================

function resolveDefaultFixtureDir(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i += 1) {
		const candidate = nodePath.join(dir, 'test', 'fixtures', 'agentos-battery');
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
	return nodePath.join(process.cwd(), 'test', 'fixtures', 'agentos-battery');
}

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (argv.includes('--selftest')) {
		await runSelftest();
		return;
	}
	const childIndex = argv.indexOf('--child');
	if (childIndex !== -1) {
		const role = argv[childIndex + 1] ?? '';
		const args = new Map<string, string>();
		for (let i = childIndex + 2; i < argv.length - 1; i += 2) {
			args.set(argv[i] ?? '', argv[i + 1] ?? '');
		}
		await runChildMode(role, args);
		return;
	}
	for (const arg of argv) {
		console.error(`agentos runtime drill: unknown argument '${arg}' (expected --selftest | --child <role> [...])`);
		process.exit(2);
	}

	if (FORCE_SKIP) {
		console.log('agentos runtime drill: SKIP (FLAUZ_AGENTOS_RUNTIME_SKIP=1 forced)');
		return;
	}
	if (ENDPOINT === '') {
		console.log('agentos runtime drill: SKIP (no FLAUZ_CDP_ENDPOINT)');
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
		console.log('agentos runtime drill: SKIP (FLAUZ_CDP_ENDPOINT unreachable)');
		return;
	}
	probe.close();
	console.log(`agentos runtime drill: endpoint ${ENDPOINT}`);

	const fixtureDir = process.env['FLAUZ_AGENTOS_BATTERY_FIXTURES'] ?? resolveDefaultFixtureDir();
	const originServer = await startLocalServer();
	const origin = `http://127.0.0.1:${String(originServer.port)}`;
	const providerServer = await startProviderServer();
	info(`local origin server ${origin} (allowed host 127.0.0.1)`);
	info(`stub provider server http://127.0.0.1:${String(providerServer.port)} (cloud-sandbox wire contract: 500/404/recovery routes)`);

	try {
		await journeyInv1(origin);
		await journeyInv2(providerServer.port);
		await journeyInv3();
		await journeyInv4();
		await journeyInv5();
		await journeyInv6();
		await journeyInv7(fixtureDir);
		await journeyInv8(providerServer.port, origin);
	} finally {
		originServer.close();
		providerServer.close();
	}

	// ---- the instrument's own coverage law (a missing row is a broken instrument) ----
	const missing = CATALOGUE.filter(entry => !rows.has(entry.id)).map(entry => entry.id);
	drillAssert(missing.length === 0, 'the runtime verdict covers every catalogue invariant (the coverage law)', `missing: ${missing.join(', ')}`);
	for (const [invariant, row] of rows) {
		if (row.verdict === 'FAIL') {
			drillAssert(typeof row.violatedInvariant === 'string' && row.violatedInvariant.startsWith(invariant) && /assertion [a-z0-9.-]+/.test(row.violatedInvariant ?? ''), `the FAIL row ${invariant} names the violated invariant + first failing assertion`, String(row.violatedInvariant ?? ''));
		}
		if (row.verdict === 'SKIP') {
			drillAssert(row.reason.length > 0, `the SKIP row ${invariant} carries the exact reason`, row.reason);
		}
	}

	const document = assembleVerdictDocument();
	const verdictPath = process.env['FLAUZ_AGENTOS_BATTERY_VERDICT'] ?? nodePath.join(os.tmpdir(), 'flauz-agentos-battery-runtime-verdict.json');
	await nodeFs.mkdir(nodePath.dirname(verdictPath), { recursive: true });
	await nodeFs.writeFile(verdictPath, `${JSON.stringify(document, null, '\t')}\n`, { encoding: 'utf-8' });

	if (failures > 0) {
		console.error(`agentos runtime drill: FAILED (${failures} instrument assertion(s))`);
		process.exit(1);
	}
	console.log(`agentos runtime drill: ${assertions} assertions, 0 failures`);
	console.log(`${RUNTIME_GREEN_PREFIX} (INV-1..INV-8 over real ports; ${String(document.summary.pass)} PASS, ${String(document.summary.fail)} FAIL findings, ${String(document.summary.skip)} SKIP pending TL2 contracts)`);
	console.log(`agentos runtime drill: verdict ${verdictPath}`);
	for (const row of document.rows) {
		const suffix = row.verdict === 'FAIL' ? ` -- ${row.violatedInvariant ?? row.reason}` : row.verdict === 'SKIP' ? ` -- ${row.reason}` : '';
		console.log(`agentos runtime drill: ROW ${row.verdict}  ${row.invariant}${suffix}`);
	}
}

void main().catch(error => {
	console.error('agentos runtime drill: ERROR', error);
	process.exit(1);
});
