/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S3 -- the Agent OS runtime verification battery (fixture rung).
 *
 * A green unit-test suite is not a durable Agent OS. This battery drives the
 * REAL Flauz contracts (the flauz.tasks/v0 TaskService, the EvidenceLedger
 * hash chain, the flauz.workflows/v1 WorkflowService re-run engine with its
 * human approval gates, the BrowserSessionManager over a FakeCdpTransport,
 * the environment lifecycle manager behind the simulated/cloud executors,
 * the flauz.a2a/v0 messaging seam) through eight durability journeys and
 * emits a DETERMINISTIC machine-checkable verdict document:
 *
 *   schema flauz.agentos-battery/v1, rung "fixture"
 *   one row per catalogue invariant (the COVERAGE LAW: a catalogue invariant
 *   with no row is a broken instrument, not an omission).
 *
 * THE INVARIANT CATALOGUE (permanent ids -- fixtures, gates, CI, docs and
 * verdict documents all use them verbatim; spec
 * docs/FLAUZ-PROGRAM/TL2-AGENTOS-BATTERY.md):
 *
 *   INV-1  restart-recovery        process death/restart preserves logical task
 *                                  state and provenance (journal, ledger, task
 *                                  envelopes recover; work continues; no silent
 *                                  state loss)
 *   INV-2  provider-failure-retry  provider errors surface bounded, recorded
 *                                  retry behavior; no silent success; task
 *                                  state reflects the failure path
 *   INV-3  cancellation-propagation  cancel mid-flight stops downstream work;
 *                                  cancellation is recorded with attribution
 *   INV-4  approval-interruption   an interrupted/taken-over approval gate stays
 *                                  FAIL-CLOSED; takeover is recorded with
 *                                  attribution; no approval = no execution
 *   INV-5  lease-conflict          concurrent claimants on one lease: exactly
 *                                  one winner; losers receive an explicit
 *                                  conflict error (never silent
 *                                  double-execution)
 *   INV-6  multi-agent-coordination  concurrent agents preserve evidence and
 *                                  attribution (no ledger clobbering, no
 *                                  cross-agent evidence attribution)
 *   INV-7  evidence-provenance-integrity  the ledger hash chain verifies; any
 *                                  tamper (doctored row, reordered chain) is
 *                                  DETECTED, with the first broken link named
 *   INV-8  partial-environment-browser-failure  a browser/environment leg dying
 *                                  mid-step marks the task FAILED with
 *                                  evidence; never a fake success
 *
 * VERDICT SEMANTICS (the gate interprets, the battery only records):
 *   - PASS: every target assertion of the journey held on the current tree.
 *   - FAIL: a measured durability violation -- a FINDING for TL2 (the Agent OS
 *     owner), recorded as honest data. A FAIL row names the violated invariant
 *     and the FIRST failing assertion id (never only a symptom). Findings do
 *     not fail the default gate; --surge-rung (the completion-claim mode)
 *     demands all-PASS.
 *   - SKIP: the journey could not produce evidence. Contract skips carry the
 *     exact missing contract (e.g. "no lease conflict contract on main ...
 *     TL2-004 pending") -- distance, not silence.
 *
 * INSTRUMENT ASSERTIONS are a different class: the battery's own controls
 * (the committed doctored-ledger fixture MUST be detected). A failed control
 * is not a finding -- it means the instrument is blind, and the final
 * instrument test THROWS (the suite fails, the gate exits 1).
 *
 * RUNG LAW (one contract, two rungs): this file is the FIXTURE rung --
 * fake/simulated ports (FakeCdpTransport, SimulatedRemoteExecutor, the
 * scriptable HttpPort double, an in-memory A2A port) over temp-dir on-disk
 * roots. The RUNTIME rung is
 * extensions/flauz-workflow/test/canaries/agentos-runtime.drill.ts -- the
 * SAME journeys and verdict schema with ONLY the port layer substituted
 * (real child processes for the restart legs, a real CDP endpoint, a stub
 * provider server over a real socket, the on-disk A2A bus). The journeys,
 * the row schema and the invariant ids are NEVER rewritten between rungs.
 *
 * Verdict document emission: the final test writes the verdict JSON to
 * $FLAUZ_AGENTOS_BATTERY_VERDICT (the gate sets a temp path; direct runs
 * fall back to a tmpdir file and print the path).
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import { sha256Hex, type EvidenceKind, type FileSystemPort, type LedgerRow, type TaskEvent } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger, rowLine } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService, type ApprovalPort, type ToolExecutorPort } from '../src/envelope.ts';
import { AgentMessenger, type A2aMessage, type A2aMessageInput, type A2aPort } from '../src/messaging.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError, type OpenSessionResult } from '../../flauz-browser/src/runtime/sessionManager.ts';
import type { NavigationOutcome } from '../../flauz-browser/src/runtime/tabs.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { FileSystemSessionJournal, type SessionJournalRecord } from '../../flauz-browser/src/runtime/journal.ts';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { CloudHttpExecutor, EnvironmentLifecycleManager, PROVIDER_RETRY_ATTEMPT_PREFIX, SimulatedRemoteExecutor, parseProviderRetryAttemptMessage, type EnvironmentOpOutcome, type HttpPort, type LocalEnvFsPort, type RetryWaitPort } from '../../flauz-environments/src/lifecycle/index.ts';
import { A2ABus } from '../../flauz-agent/core/a2a.mjs';
import { LEASE_CONFLICT_CODE, claimStepLease, isLeaseConflictError, leaseConflictFacts, stepResourceId } from '../../flauz-agent/core/leaseConflict.mjs';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';

// ---------------------------------------------------------------------------
// The catalogue (permanent ids + names -- shared verbatim with the gate, the
// fixtures, the CI lane and the spec document)
// ---------------------------------------------------------------------------

export const AGENTOS_BATTERY_SCHEMA = 'flauz.agentos-battery/v1';

interface CatalogueEntry {
	readonly id: string;
	readonly name: string;
	readonly claim: string;
}

const CATALOGUE: readonly CatalogueEntry[] = [
	{ id: 'INV-1', name: 'restart-recovery', claim: 'process death/restart preserves logical task state and provenance (journal, ledger, task envelopes recover; work continues; no silent state loss)' },
	{ id: 'INV-2', name: 'provider-failure-retry', claim: 'provider errors surface bounded, recorded retry behavior; no silent success; task state reflects the failure path' },
	{ id: 'INV-3', name: 'cancellation-propagation', claim: 'cancel mid-flight stops downstream work; cancellation is recorded with attribution' },
	{ id: 'INV-4', name: 'approval-interruption', claim: 'an interrupted/taken-over approval gate stays FAIL-CLOSED; takeover is recorded with attribution; no approval = no execution' },
	{ id: 'INV-5', name: 'lease-conflict', claim: 'concurrent claimants on one lease: exactly one winner; losers receive an explicit conflict error (never silent double-execution)' },
	{ id: 'INV-6', name: 'multi-agent-coordination', claim: 'concurrent agents preserve evidence and attribution (no ledger clobbering, no cross-agent evidence attribution)' },
	{ id: 'INV-7', name: 'evidence-provenance-integrity', claim: 'the ledger hash chain verifies; any tamper (doctored row, reordered chain) is DETECTED, with the first broken link named' },
	{ id: 'INV-8', name: 'partial-environment-browser-failure', claim: 'a browser/environment leg dying mid-step marks the task FAILED with evidence; never a fake success' },
];

const INVARIANT_IDS: readonly string[] = CATALOGUE.map(entry => entry.id);


// ---------------------------------------------------------------------------
// Runner capability guard (SKIP-aware on older nodes: the compiled CI unit
// subset runs this suite as .js on whatever node the runner pinned)
// ---------------------------------------------------------------------------

function nodeMajor(): number {
	const parts = process.versions.node.split('.');
	const major = Number.parseInt(parts[0] ?? '0', 10);
	return Number.isNaN(major) ? 0 : major;
}

function nodeMinor(): number {
	const parts = process.versions.node.split('.');
	const minor = Number.parseInt(parts[1] ?? '0', 10);
	return Number.isNaN(minor) ? 0 : minor;
}

const RUNNER_OK = nodeMajor() > 22 || (nodeMajor() === 22 && nodeMinor() >= 6);
const RUNNER_SKIP_REASON = `node ${process.versions.node ?? ''} predates the battery runner baseline (22.6); the battery runs via --experimental-strip-types in its own gate and CI lanes`;

// ---------------------------------------------------------------------------
// The verdict machinery
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

/**
 * One journey's recorder. `check` records TARGET assertions (measurements of
 * the Agent OS -- a false check is a FINDING recorded in the row, never a
 * thrown test failure). `control` records INSTRUMENT assertions (the
 * battery's own tamper controls -- a false control blinds the instrument
 * and fails the suite in the final instrument test).
 */
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
			controlFailures.push(`${this.invariantId} ${id}: ${detail}`);
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

/** The instrument-control failure channel (consumed by the final test). */
const controlFailures: string[] = [];

/** The registry the final tests assemble into the verdict document. */
const rows = new Map<string, VerdictRow>();

function registerRow(row: VerdictRow): void {
	rows.set(row.invariant, row);
}

// ---------------------------------------------------------------------------
// Shared fixture-rung ports (the session-battery pattern)
// ---------------------------------------------------------------------------

const ENV_ID = 'env-agentos-remote';
const ENV_KIND = 'workspace-remote';
const CLOUD_ENV_ID = 'env-agentos-cloud';
const CLOUD_ENV_KIND = 'cloud-sandbox';
const FIXED_BROWSER_TS = 1_740_000_000_000;

type BatteryFs = FileSystemPort & LocalEnvFsPort & { rm(target: string): Promise<void> };

function batteryFsPort(): BatteryFs {
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

const SEPARATION_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

interface BatteryWorkspace {
	readonly root: string;
	readonly fs: BatteryFs;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly envRegistry: EnvironmentRegistry;
	readonly envManager: EnvironmentLifecycleManager;
	readonly browser: BrowserSessionManager;
	readonly browserTransports: FakeCdpTransport[];
	cleanup(): Promise<void>;
}

async function bootBatteryWorkspace(): Promise<BatteryWorkspace> {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-'));
	const fs = batteryFsPort();
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
		label: 'Agent OS Battery Remote',
		connection: { authorityPrefix: 'flauz-local' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: true, exec: true, terminal: true },
	});
	const envSim = new SimulatedRemoteExecutor({ kind: ENV_KIND, root, fs, clock: envClock, latencyMs: 0 });
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [envSim], simulatedDefault: true });
	await envManager.bootstrap();

	const browserTransports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			const transport = new FakeCdpTransport({ state: new FakeBrowserState(), commandTimeoutMs: 500 });
			browserTransports.push(transport);
			return transport;
		},
	});
	const browser = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(SEPARATION_POLICY),
		host,
		workspaceRoot: root,
		journal: new FileSystemSessionJournal(root),
		clock: () => FIXED_BROWSER_TS,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
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
// The cloud-provider leg (the only provider-failure contract on main): the
// REAL CloudHttpExecutor behind the lifecycle manager, driven through an
// injectable HttpPort. Fixture rung: the scriptable double. Runtime rung (the
// drill): a stub provider server over a real socket. One contract, two rungs.
// ---------------------------------------------------------------------------

interface ScriptedResponse {
	readonly status: number;
	readonly bodyText: string;
}

type RouteHandler = (call: { method: string; path: string }) => ScriptedResponse;

class ScriptedHttpPort implements HttpPort {
	readonly calls: Array<{ method: string; path: string }> = [];
	private readonly routes: ReadonlyArray<{ test: RegExp; handler: RouteHandler }>;

	constructor(routes: ReadonlyArray<{ test: RegExp; handler: RouteHandler }>) {
		this.routes = routes;
	}

	async fetch(request: { method: string; url: string }): Promise<ScriptedResponse> {
		const path = request.url.replace(/^https?:\/\/[^/]+/, '');
		this.calls.push({ method: request.method, path });
		for (const route of this.routes) {
			if (route.test.test(path)) {
				return route.handler({ method: request.method, path });
			}
		}
		return { status: 404, bodyText: '{"error":"no scripted route"}' };
	}

	callsOf(method: string, path: string): number {
		return this.calls.filter(call => call.method === method && call.path === path).length;
	}
}

const CLOUD_SANDBOX_ID = 'sbx-agentos-battery-1';
const CLOUD_START_PATH = `/v0/sandboxes/${CLOUD_SANDBOX_ID}/start`;

interface CloudLeg {
	readonly root: string;
	readonly envManager: EnvironmentLifecycleManager;
	readonly http: ScriptedHttpPort;
	cleanup(): Promise<void>;
}

/** TL2-F2B — the additive cloud-leg options (absent = the pre-F2B wiring byte-identically). */
interface CloudLegOptions {
	/** The injectable provider-retry wait port (deterministic journeys; default: the real timer). */
	readonly providerRetryWait?: RetryWaitPort;
}

async function bootCloudLeg(startResponses: ScriptedResponse[], options: CloudLegOptions = {}): Promise<CloudLeg> {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-cloud-'));
	const fs = batteryFsPort();
	const envClock = steppingClock(1_740_000_000_000);
	const startQueue = [...startResponses];
	const http = new ScriptedHttpPort([
		{ test: /^\/v0\/sandboxes$/, handler: () => ({ status: 200, bodyText: JSON.stringify({ sandboxId: CLOUD_SANDBOX_ID, status: 'created' }) }) },
		{ test: new RegExp(`^${CLOUD_START_PATH}$`), handler: () => startQueue.length > 0 ? startQueue.shift() as ScriptedResponse : { status: 200, bodyText: JSON.stringify({ status: 'running' }) } },
		{ test: /^\/v0\/sandboxes\/[^/]+\/stop$/, handler: () => ({ status: 200, bodyText: '{}' }) },
		{ test: /^\/v0\/sandboxes\/[^/]+$/, handler: () => ({ status: 200, bodyText: JSON.stringify({ sandboxId: CLOUD_SANDBOX_ID, status: 'running' }) }) },
	]);
	const envRegistry = new EnvironmentRegistry({ root, fs, clock: envClock });
	await envRegistry.bootstrap();
	await envRegistry.register({
		id: CLOUD_ENV_ID,
		kind: CLOUD_ENV_KIND,
		label: 'Agent OS Battery Cloud',
		connection: { provider: 'custom', apiKeyRef: 'vault:flauz-battery-key', sandboxTemplate: 'flauz-battery-tpl' },
		trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
		capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
	});
	const cloud = new CloudHttpExecutor({
		root,
		http,
		secrets: { resolve: async ref => ref === 'vault:flauz-battery-key' ? 'test-key-material' : undefined },
		baseUrl: 'https://cloud.invalid',
		fs,
		hash: { sha256Hex: contents => sha256Hex(contents) },
		clock: envClock,
		requestTimeoutMs: 2_000,
	});
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [cloud], ...(options.providerRetryWait === undefined ? {} : { providerRetryWait: options.providerRetryWait }) });
	await envManager.bootstrap();
	return {
		root,
		envManager,
		http,
		cleanup: async () => {
			await nodeFs.rm(root, { recursive: true, force: true });
		},
	};
}

/** The typed error code of an environment op outcome ('' when it succeeded). */
function opErrorCode(outcome: EnvironmentOpOutcome): string {
	return outcome.ok === false ? outcome.error.code : '';
}

// ---------------------------------------------------------------------------
// On-disk readers (the session-battery helpers)
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

/** Seeds one completed task (the J1-style golden spine) and returns its id. */
async function seedCompletedTask(ws: BatteryWorkspace, prompt: string, command: string): Promise<string> {
	const created = await ws.tasks.createTask(prompt);
	const taskId = created.id;
	const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`${command}\`.`;
	await ws.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
	await ws.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
	const output = `${command}\nok`;
	const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
	await ws.fs.mkdir(`${ws.root}/.flauz/artifacts/${taskId}`);
	await ws.fs.writeFile(`${ws.root}/${artifactUri}`, output);
	const appended = await ws.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
	await ws.tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
	await ws.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
	await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
	await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
	return taskId;
}

// ---------------------------------------------------------------------------
// The fixture-dir resolver (the session-battery pattern: walk up to the repo
// root; the gate overrides explicitly via FLAUZ_AGENTOS_BATTERY_FIXTURES)
// ---------------------------------------------------------------------------

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

// ===========================================================================
// INV-1 -- restart-recovery
// ===========================================================================

describe('INV-1 restart-recovery', () => {
	test('process death and cold restart on the same on-disk root: task state, provenance and work continue', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-1', 'restart-recovery');
		const first = await bootBatteryWorkspace();
		const root = first.root;
		let seedTaskId = '';
		let artifactUri = '';
		const artifactSha = sha256Hex('echo flauz-agentos-inv1-ok\nok');
		try {
			// the golden spine + the workflow fragment + env + browser legs
			seedTaskId = await seedCompletedTask(first, 'ship the flauz agentos restart journey', 'echo flauz-agentos-inv1-ok');
			artifactUri = `.flauz/artifacts/${seedTaskId}/command-output-1.txt`;
			await first.workflows.save({ taskId: seedTaskId });
			await first.envManager.perform('create', { id: ENV_ID, actor: 'agent', simulated: true });
			await first.envManager.perform('start', { id: ENV_ID, actor: 'agent', simulated: true });
			await first.envManager.perform('stop', { id: ENV_ID, actor: 'agent', simulated: true });
			const opened = await first.browser.open({ initiator: 'agent', agentId: 'worker-inv1' });
			assert.ok(isSessionError(opened) === false, 'the browser session opens before the death');
			const navigation = await first.browser.navigate((opened as OpenSessionResult).descriptor.sessionId, 'https://welcome.example.com/');
			assert.ok(isNavigationOutcome(navigation) && navigation.verdict.decision === 'allow', 'the allowed navigation commits before the death');
			await first.browser.close((opened as OpenSessionResult).descriptor.sessionId);
		} finally {
			// the "death": dispose every service WITHOUT deleting the root
			await first.browser.dispose();
		}

		// ---- cold boot: fresh service instances on the SAME root ----
		const fs = batteryFsPort();
		const clock = steppingClock(9000);
		const tasks = new TaskService({ root, fs, clock });
		const ledger = new EvidenceLedger({ root, fs, clock });
		const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
		await tasks.bootstrap();
		await ledger.ensure();
		await fs.mkdir(`${root}/.flauz/workflows`);
		const envRegistry = new EnvironmentRegistry({ root, fs, clock });
		await envRegistry.bootstrap();
		const envSim = new SimulatedRemoteExecutor({ kind: ENV_KIND, root, fs, clock });
		const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock, executors: [envSim], simulatedDefault: true });
		await envManager.bootstrap();
		const browser = new BrowserSessionManager({
			engine: () => BrowserPolicyEngine.fromPolicyText(SEPARATION_POLICY),
			host: new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
				transportFactory: () => new FakeCdpTransport({ state: new FakeBrowserState(), commandTimeoutMs: 500 }),
			}),
			workspaceRoot: root,
			journal: new FileSystemSessionJournal(root),
			clock: () => FIXED_BROWSER_TS,
			commandTimeoutMs: 150,
			navigationTimeoutMs: 300,
		});
		try {
			const listedTasks = await tasks.listTasks();
			const listedWorkflows = await workflows.list();
			const journalAfter = await readJournalRecords(root);
			const envState = await readEnvLifecycleState(root, ENV_ID);
			const verify = await ledger.verify();

			// work CONTINUES: the recovered workflow service re-runs the fragment
			const executor: ToolExecutorPort = async () => ({ ok: true, output: 'echo flauz-agentos-inv1-ok\nok' });
			const rerun = await workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });

			recorder.check('inv1.tasks-recover', listedTasks.length === 1 && listedTasks[0]?.id === seedTaskId, `recovered task count ${String(listedTasks.length)} (expected the seed task ${seedTaskId})`);
			const recoveredTask = listedTasks[0];
			recorder.check('inv1.task-spine-recovers', recoveredTask !== undefined && recoveredTask.status === 'done' && recoveredTask.events.length === 7, `recovered task status ${String(recoveredTask?.status)} events ${String(recoveredTask?.events.length)} (expected done with the 6-event spine + the workflow-saved record)`);
			recorder.check('inv1.ledger-recovers', verify.ok && verify.rows === 1, `recovered ledger verify ok=${String(verify.ok)} rows=${String(verify.rows)}`);
			const recoveredRows: LedgerRow[] = await ledger.readRows();
			recorder.check('inv1.provenance-survives', recoveredRows[0]?.taskId === seedTaskId && recoveredRows[0]?.uri === artifactUri && recoveredRows[0]?.sha256 === artifactSha, `recovered evidence row ${JSON.stringify(recoveredRows[0] ?? null)}`);
			recorder.check('inv1.workflows-recover', listedWorkflows.length === 1 && listedWorkflows[0]?.id === 'W-001', `recovered workflow ids ${JSON.stringify(listedWorkflows.map(fragment => fragment.id))}`);
			recorder.check('inv1.work-continues', rerun.stopped === 'completed', `the recovered workflow re-run stopped '${rerun.stopped}'`);
			recorder.check('inv1.journal-recovers', journalAfter.length >= 2, `browser journal lines after restart ${String(journalAfter.length)}`);
			recorder.check('inv1.env-state-recovers', envState === 'stopped', `environment lifecycle state after restart '${envState}'`);

			registerRow(recorder.buildRow(
				`.flauz/tasks.json (1 task, done, 6 events); .flauz/evidence/ledger.jsonl (verify ok, 1 row, sha256-pinned); .flauz/workflows/W-001.json (re-run completed); journal ${String(journalAfter.length)} lines; env state ${envState}`,
			));
		} finally {
			await browser.dispose();
			await nodeFs.rm(root, { recursive: true, force: true });
		}
	});
});

// ===========================================================================
// INV-2 -- provider-failure-retry (the environment cloud-provider seam: the
// only provider-failure contract on main at the pinned base; the flauz-models
// seam has no failure path -- deterministic mock + design-only vendor stubs)
// ===========================================================================

describe('INV-2 provider-failure-retry', () => {
	test('a failing cloud provider surfaces typed, recorded errors with no silent success; the automatic bounded retry engages, is recorded, and exhausts honestly', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-2', 'provider-failure-retry');
		// TL2-F2B (the sanctioned journey extension, the F3/INV-5 precedent): the
		// stub fails BEYOND the retry budget (5 x HTTP 500 against the default
		// bound 3) so the AUTOMATIC bounded retry engages, is recorded, and
		// EXHAUSTS — the call count stops at the bound while failures remain
		// queued (bounded, not unbounded) and the outcome stays the typed
		// failure. The recovery leg stays CALLER-DRIVEN: the second explicit
		// perform('start') opens a FRESH window (composability) and recovers
		// within its own bound. The wait port is injected — never a real sleep
		// on the test path.
		const failingStarts: ScriptedResponse[] = Array.from({ length: 5 }, () => ({ status: 500, bodyText: '{"error":"provider exploded"}' }));
		const leg = await bootCloudLeg(failingStarts, { providerRetryWait: async () => undefined });
		try {
			const actor = 'agent';
			const createOutcome = await leg.envManager.perform('create', { id: CLOUD_ENV_ID, actor });
			assert.equal(createOutcome.ok, true, 'cloud create succeeds against the stub provider (setup)');

			// ---- the provider fails mid-lifecycle, beyond the retry budget ----
			const failedStart = await leg.envManager.perform('start', { id: CLOUD_ENV_ID, actor });
			recorder.check('inv2.no-silent-success', failedStart.ok === false && opErrorCode(failedStart) === 'CLOUD_PROVIDER_ERROR', `failing start outcome ok=${String(failedStart.ok)} code=${opErrorCode(failedStart)} (the exhausted window never flips to success)`);
			const stateAfterFailure = await readEnvLifecycleState(leg.root, CLOUD_ENV_ID);
			recorder.check('inv2.state-reflects-failure', stateAfterFailure === 'failed', `lifecycle state after the provider failure '${stateAfterFailure}' (expected failed)`);
			const ops = await readEnvOps(leg.root);
			const failedOp = ops.find(op => op.op === 'start' && op.result === 'error' && op.toState === 'failed');
			recorder.check('inv2.failure-recorded', failedOp !== undefined && failedOp.actor === 'agent' && failedOp.error?.code === 'CLOUD_PROVIDER_ERROR', `ops ledger records the failed start (the request-level terminal row): ${JSON.stringify(failedOp ?? null)}`);

			// ---- the bounded-retry measurement: the automatic window engaged and exhausted ----
			const startCalls = leg.http.callsOf('POST', CLOUD_START_PATH);
			recorder.check('inv2.bounded-retry', startCalls >= 2, `bounded, recorded retry behavior: the automatic bounded retry performed ${String(startCalls)} provider start call(s) against the failing provider before surfacing the typed error (the window bound is 3; 5 failures were queued)`);
			recorder.check('inv2.bounded-exhaustion', startCalls === 3, `the automatic retry count stops at exactly the window bound (${String(startCalls)} call(s) against 5 queued failures — bounded, not unbounded)`);
			const attemptRows = ops.filter(op => op.op === 'start' && op.result === 'error' && typeof op.error?.message === 'string' && op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
			const attemptFacts = attemptRows.map(op => parseProviderRetryAttemptMessage(op.error?.message));
			recorder.check('inv2.retry-attempts-recorded', attemptRows.length === 3 && attemptFacts.every(fact => fact !== undefined && fact.op === 'start' && fact.code === 'CLOUD_PROVIDER_ERROR' && fact.maxAttempts === 3) && attemptFacts.map(fact => fact!.ordinal).join(',') === '1,2,3' && attemptFacts[0]?.nextAttemptOrdinal === 2 && attemptFacts[1]?.nextAttemptOrdinal === 3 && attemptFacts[2]?.nextAttemptOrdinal === undefined, `the ops ledger carries the recorded retry attempt sequence (ordinals + typed outcomes + waits applied): ${JSON.stringify(attemptFacts)}`);

			// ---- the caller-driven retry after provider recovery: a FRESH window, recorded, succeeds ----
			const recoveredStart = await leg.envManager.perform('start', { id: CLOUD_ENV_ID, actor });
			recorder.check('inv2.retry-recovered-recorded', recoveredStart.ok === true, `the caller-driven retry after provider recovery ok=${String(recoveredStart.ok)} (a fresh bounded window that recovers within its own bound)`);
			const opsAfter = await readEnvOps(leg.root);
			const startRows = opsAfter.filter(op => op.op === 'start');
			const requestLevelRows = startRows.filter(op => typeof op.error?.message !== 'string' || !op.error.message.startsWith(PROVIDER_RETRY_ATTEMPT_PREFIX));
			recorder.check('inv2.retry-recorded', startRows.length === 7 && requestLevelRows.length === 2 && requestLevelRows.filter(op => op.result === 'error').length === 1 && requestLevelRows.filter(op => op.result === 'ok').length === 1, `ops ledger carries the two explicit start requests (2 request-level rows: 1 error + 1 ok) plus the recorded retry attempts (5 attempt rows; ${String(startRows.length)} start lines total)`);

			// ---- the task-level failure path: a task whose tool leg wraps the provider ----
			const ws = await bootBatteryWorkspace();
			try {
				const seedTaskId = await seedCompletedTask(ws, 'ship the flauz agentos provider-failure journey', 'echo flauz-agentos-inv2-ok');
				await ws.workflows.save({ taskId: seedTaskId });
				let executorCalls = 0;
				const executor: ToolExecutorPort = async () => {
					executorCalls += 1;
					return { ok: false, output: 'cloud provider start failed: CLOUD_PROVIDER_ERROR (HTTP 500)' };
				};
				const rerun = await ws.workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
				const failedTask = await ws.tasks.getTask(rerun.taskId);
				recorder.check('inv2.task-reflects-failure-path', rerun.stopped === 'tool-failed' && failedTask.status === 'failed' && failedTask.events.some(event => event.type === 'fail'), `the task wrapping the failing provider leg stopped '${rerun.stopped}' status '${failedTask.status}'`);
				recorder.check('inv2.evidence-on-failure', rerun.evidenceIds.length === 1, `evidence rows recorded for the failing leg: ${String(rerun.evidenceIds.length)}`);
				assert.equal(executorCalls, 1, 'the failing tool leg executed exactly once (setup)');
			} finally {
				await ws.cleanup();
			}

			registerRow(recorder.buildRow(
				'cloud-sandbox seam over the scriptable HttpPort: the automatic bounded retry engaged (3/3 attempts recorded with ordinals + waits, exhausted at the bound against 5 queued failures), typed CLOUD_PROVIDER_ERROR terminal (ops ledger + actor), lifecycle failed; the caller-driven second start opened a FRESH window and recovered (2 request-level rows + 5 attempt rows); the flauz-models seam has no failure path on main (deterministic flauz-mock echo + design-only vendor stubs); the lifecycle-seam contract landed TL2-F2B',
			));
		} finally {
			await leg.cleanup();
		}
	});
});

// ===========================================================================
// INV-3 -- cancellation-propagation
// ===========================================================================

describe('INV-3 cancellation-propagation', () => {
	test('a human cancel recorded mid-run: attribution, downstream work, task terminality', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-3', 'cancellation-propagation');
		const ws = await bootBatteryWorkspace();
		try {
			// seed a completed TWO-tool task so the distilled fragment carries
			// two downstream tool steps
			const created = await ws.tasks.createTask('ship the flauz agentos cancellation journey');
			const taskId = created.id;
			await ws.tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan: `## Flauz plan - ${taskId}`, requestId: 'req-1' } });
			await ws.tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: { requestId: 'req-1' } });
			for (const seq of [1, 2]) {
				const command = `echo flauz-agentos-inv3-tool-${seq}`;
				const output = `${command}\nok`;
				const artifactUri = `.flauz/artifacts/${taskId}/command-output-${seq}.txt`;
				await ws.fs.mkdir(`${ws.root}/.flauz/artifacts/${taskId}`);
				await ws.fs.writeFile(`${ws.root}/${artifactUri}`, output);
				const appended = await ws.ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command });
				await ws.tasks.appendEvent(taskId, { ts: 2 + seq, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: sha256Hex(output), note: command } });
			}
			await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'agent', type: 'report', payload: {} });
			await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'tool', type: 'verify-pass', payload: { rows: 2 } });
			await ws.tasks.appendEvent(taskId, { ts: 7, actor: 'human', type: 'sign-off', payload: {} });
			const saved = await ws.workflows.save({ taskId });
			const fragment = await ws.workflows.load(saved.workflowId);
			assert.equal(fragment.tools.length, 2, 'the seeded fragment carries two downstream tool steps (setup)');

			// ---- the flight: an ask-mode run whose FIRST tool blocks on a gate ----
			let releaseTool1: () => void = () => { };
			const tool1Gate = new Promise<void>(resolve => {
				releaseTool1 = resolve;
			});
			let tool1StartedResolve: () => void = () => { };
			const tool1Started = new Promise<void>(resolve => {
				tool1StartedResolve = resolve;
			});
			let executorCalls = 0;
			let runTaskId = '';
			const executor: ToolExecutorPort = async step => {
				executorCalls += 1;
				if (step.seq === 1) {
					const tasksNow = await ws.tasks.listTasks();
					const newest = tasksNow.find(candidate => candidate.id !== taskId);
					runTaskId = newest?.id ?? '';
					tool1StartedResolve();
					await tool1Gate; // deterministic rendezvous: the cancel lands mid-flight
				}
				return { ok: true, output: `tool-${step.seq}-output` };
			};
			const ask: ApprovalPort = async () => 'approve';
			const runPromise = ws.workflows.run({ workflowId: saved.workflowId, executor, approvals: 'ask', ask });
			await tool1Started; // tool 1 has started and is now blocked (deterministic)
			assert.ok(runTaskId !== '', 'the run task exists once tool 1 starts (setup)');

			// ---- the human cancel, recorded with attribution, mid-flight ----
			await ws.tasks.appendEvent(runTaskId, { ts: 10_000, actor: 'human', type: 'cancel', payload: { gate: 'mid-flight' } });
			releaseTool1();

			let crashMessage = '<no crash>';
			try {
				await runPromise;
			} catch (err) {
				crashMessage = err instanceof Error ? err.message : String(err);
			}

			const finalTask = await ws.tasks.getTask(runTaskId);
			const cancelEvent = finalTask.events.find(event => event.type === 'cancel');
			recorder.check('inv3.cancel-recorded-with-attribution', cancelEvent !== undefined && cancelEvent.actor === 'human', `the cancel event is recorded with actor ${String(cancelEvent?.actor)}`);
			recorder.check('inv3.downstream-stopped', executorCalls === 1, `downstream work stopped by the mid-flight cancel: ${String(executorCalls)} tool step(s) executed (tool 2 ran after the cancel on the v0 slice)`);
			recorder.check('inv3.typed-surface', finalTask.status === 'cancelled', `the cancelled task stays terminal '${finalTask.status}'`);
			recorder.check('inv3.run-surface-typed-error', crashMessage.includes('flauz.tasks/v0'), `the in-flight run surfaces a typed error at the next transition: ${crashMessage.slice(0, 120)}`);

			registerRow(recorder.buildRow(
				`mid-flight human cancel on ${runTaskId}: cancel event actor=human; ${String(executorCalls)} tool step(s) executed (downstream tool 2 executed post-cancel); run crashed at the next transition append with the typed state-machine error`,
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// INV-4 -- approval-interruption
// ===========================================================================

describe('INV-4 approval-interruption', () => {
	test('interrupted and taken-over approval gates stay FAIL-CLOSED with attribution; no approval = no execution', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-4', 'approval-interruption');
		const ws = await bootBatteryWorkspace();
		try {
			const seedTaskId = await seedCompletedTask(ws, 'ship the flauz agentos approval journey', 'echo flauz-agentos-inv4-ok');
			const saved = await ws.workflows.save({ taskId: seedTaskId });
			let calls = 0;
			const countingExecutor: ToolExecutorPort = async () => {
				calls += 1;
				return { ok: true, output: 'echo flauz-agentos-inv4-ok\nok' };
			};

			// (a) interrupted gate: the human cancels at the approval gate
			const cancelled = await ws.workflows.run({
				workflowId: saved.workflowId,
				executor: countingExecutor,
				approvals: 'ask',
				ask: async gate => gate === 'approval' ? 'cancel' : 'approve',
			});
			const cancelledTask = await ws.tasks.getTask(cancelled.taskId);
			const cancelEvent = cancelledTask.events.find(event => event.type === 'cancel');
			recorder.check('inv4.interrupted-stays-cancelled', cancelled.stopped === 'cancelled' && cancelledTask.status === 'cancelled', `the interrupted gate run stopped '${cancelled.stopped}' task '${cancelledTask.status}'`);
			recorder.check('inv4.interrupted-zero-execution', calls === 0, `executor calls after the interrupted gate: ${String(calls)}`);
			recorder.check('inv4.interrupted-attribution', cancelEvent !== undefined && cancelEvent.actor === 'human' && (cancelEvent.payload as { gate?: string }).gate === 'approval', `interrupted-gate cancel event actor=${String(cancelEvent?.actor)} gate=${String((cancelEvent?.payload as { gate?: string }).gate)}`);

			// (b) taken-over gate: the human sends the run back to planning
			const takenOver = await ws.workflows.run({
				workflowId: saved.workflowId,
				executor: countingExecutor,
				approvals: 'ask',
				ask: async gate => gate === 'approval' ? 'request-changes' : 'approve',
			});
			const takenOverTask = await ws.tasks.getTask(takenOver.taskId);
			const requestChangesEvent = takenOverTask.events.find(event => event.type === 'request-changes');
			recorder.check('inv4.takeover-fail-closed', takenOver.stopped === 'request-changes' && takenOverTask.status === 'plan', `the taken-over gate run stopped '${takenOver.stopped}' task '${takenOverTask.status}'`);
			recorder.check('inv4.takeover-zero-execution', calls === 0, `executor calls after the takeover: ${String(calls)}`);
			recorder.check('inv4.takeover-attribution', requestChangesEvent !== undefined && requestChangesEvent.actor === 'human' && (requestChangesEvent.payload as { gate?: string }).gate === 'approval', `takeover event actor=${String(requestChangesEvent?.actor)} gate=${String((requestChangesEvent?.payload as { gate?: string }).gate)}`);

			// (c) the sign-off gate interrupted with 'skip' defers the close (never fakes it)
			const deferred = await ws.workflows.run({
				workflowId: saved.workflowId,
				executor: countingExecutor,
				approvals: 'ask',
				ask: async gate => gate === 'sign-off' ? 'skip' : 'approve',
			});
			recorder.check('inv4.signoff-skip-defers', deferred.stopped === 'awaiting-signoff', `the deferred sign-off run stopped '${deferred.stopped}'`);
			recorder.check('inv4.approved-run-executes-once', calls === 1, `executor calls across all runs: ${String(calls)} (only the fully approved run executed)`);

			registerRow(recorder.buildRow(
				`three ask-mode gate journeys over W-001: cancel -> task cancelled + 0 executor calls; request-changes -> task plan + 0 executor calls; sign-off skip -> awaiting-signoff; all gate events carry actor=human + gate attribution`,
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// INV-5 -- lease-conflict (the TL2-F3 conflict contract: the journey)
// ===========================================================================

/**
 * The evidence-minting TaskPort adapter: links the OrchestrationStore's
 * DL-60 discipline into the battery trio's flauz.tasks/v0 services (the
 * TaskService timeline + the EvidenceLedger hash chain - THE chain this
 * journey verifies end-to-end).
 */
function batteryTaskPort(ws: BatteryWorkspace): { createTask(args: { title: string }): Promise<{ taskId: string }>; appendEvidence(args: { taskId: string; row: { kind: string; uri: string; sha256: string } }): Promise<{ evidenceId: string; seq: number }>; appendEvent(args: { taskId: string; event: Record<string, unknown> }): Promise<{ task: unknown }> } {
	return {
		createTask: async args => ({ taskId: (await ws.tasks.createTask(args.title)).id }),
		appendEvidence: async args => {
			const appended = await ws.ledger.append(args.taskId, { kind: args.row.kind as EvidenceKind, uri: args.row.uri, sha256: args.row.sha256 });
			return { evidenceId: appended.evidenceId, seq: appended.seq };
		},
		appendEvent: async args => ({ task: await ws.tasks.appendEvent(args.taskId, args.event as TaskEvent) }),
	};
}

describe('INV-5 lease-conflict', () => {
	test('two concurrent claimants race one resource lease through the flauz.a2a claim path: exactly one winner; the loser receives the typed conflict; both attempts are journaled with attribution; the chains verify', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-5', 'lease-conflict');
		const ws = await bootBatteryWorkspace();
		try {
			// The enforcing claim path over the battery trio: an OrchestrationStore
			// wired to the workspace services through the evidence-minting TaskPort
			// adapter, plus the on-disk A2ABus (the flauz.a2a claim surface - the
			// TL2-F3 conflict contract, extensions/flauz-agent/core/leaseConflict.mjs).
			const store = new OrchestrationStore(ws.root, { taskPort: batteryTaskPort(ws), clock: steppingClock(500_000) });
			const bus = new A2ABus(ws.root);
			const submitted = await store.submitGraph({
				title: 'inv5 lease-conflict graph',
				steps: [{ stepId: 'S-01', title: 'contended shared work', instruction: 'two agents race for the lease' }],
				actor: 'agent',
				origin: 'battery:inv5',
			});
			await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'battery:inv5' });
			const resource = stepResourceId(submitted.graphId, 'S-01');

			// ---- (a) the race: two concurrent claimants, one resource, through the claim path ----
			const race = await Promise.allSettled([
				claimStepLease(store, bus, { graphId: submitted.graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-1', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-1' }),
				claimStepLease(store, bus, { graphId: submitted.graphId, stepId: 'S-01', claimant: 'flauz.agent.worker-2', ttlMs: 60_000, origin: 'a2a:flauz.agent.worker-2' }),
			]);
			const acquiredRows = store.journalRows.filter(row => row.type === 'lease-acquired');
			const winner = race.find((result): result is PromiseFulfilledResult<{ status: string; leaseId: string; holder: string; deadline: number; rowId: string; noticeId: string }> => result.status === 'fulfilled');
			const loser = race.find((result): result is PromiseRejectedResult => result.status === 'rejected');
			recorder.check('inv5.exactly-one-winner', race.filter(result => result.status === 'fulfilled').length === 1 && loser !== undefined && acquiredRows.length === 1, `exactly one claimant acquired the lease (${race.map(result => result.status).join(' + ')}; lease-acquired rows: ${String(acquiredRows.length)})`);

			// ---- (b) the typed conflict error: the shape asserted (holder, lease id, deadline) ----
			const reason = loser?.reason;
			const facts = reason === undefined ? null : leaseConflictFacts(reason);
			const winnerClaim = winner?.value;
			recorder.check('inv5.typed-conflict-shape', isLeaseConflictError(reason) && facts !== null && facts.code === LEASE_CONFLICT_CODE && facts.violation === 'lease' && facts.holder === 'flauz.agent.worker-1' && facts.leaseId === winnerClaim?.leaseId && facts.deadline === winnerClaim?.deadline && facts.claimant === 'flauz.agent.worker-2', `the loser's typed conflict ${String(facts?.code)} carries the current holder (${String(facts?.holder)}), the lease id (${String(facts?.leaseId)}) and the lease deadline (${String(facts?.deadline)})`);

			// ---- (c) both attempts journaled with attribution: the winner's acquisition + the loser's refusal ----
			const conflicts = store.journalRows.filter(row => row.type === 'conflict-noticed');
			const conflictPayload = conflicts[0]?.payload as { violation: string; expectedHolder: string; actualRunner: string; evidenceId?: string } | undefined;
			const acquiredPayload = acquiredRows[0]?.payload as { holder: string; leaseId: string; expiresAt: number; evidenceId?: string } | undefined;
			recorder.check('inv5.both-attempts-journaled', conflicts.length === 1 && conflictPayload?.violation === 'lease' && conflictPayload?.expectedHolder === 'flauz.agent.worker-1' && conflictPayload?.actualRunner === 'flauz.agent.worker-2' && acquiredPayload?.holder === 'flauz.agent.worker-1' && /^E-\d{6,}$/.test(conflictPayload?.evidenceId ?? '') && /^E-\d{6,}$/.test(acquiredPayload?.evidenceId ?? ''), `the winner's acquisition and the loser's refusal are both journaled with attribution (conflict: expectedHolder=${String(conflictPayload?.expectedHolder)} actualRunner=${String(conflictPayload?.actualRunner)}; both rows carry minted evidence ids)`);

			// ---- (d) the evidence linkage: each minted row references its journal row ----
			const conflictEvidenceRow = conflictPayload?.evidenceId === undefined ? undefined : await ws.ledger.rowByEvidenceId(conflictPayload.evidenceId);
			const acquiredEvidenceRow = acquiredPayload?.evidenceId === undefined ? undefined : await ws.ledger.rowByEvidenceId(acquiredPayload.evidenceId);
			recorder.check('inv5.evidence-linkage', conflictEvidenceRow !== undefined && acquiredEvidenceRow !== undefined && conflictEvidenceRow.uri === `flauz-orch-transition://${String(conflicts[0]?.rowId)}` && acquiredEvidenceRow.uri === `flauz-orch-transition://${String(acquiredRows[0]?.rowId)}` && conflictEvidenceRow.taskId === acquiredEvidenceRow.taskId, 'both attempts minted ledger evidence rows referencing their own journal rows (the conflict is recorded history, never a dropped message)');

			// ---- (e) the hash chains verify end-to-end (the evidence ledger + the orchestration journal) ----
			const ledgerVerify = await ws.ledger.verify();
			const journalVerify = store.verifyJournal();
			recorder.check('inv5.chain-verifies-end-to-end', ledgerVerify.ok && journalVerify.ok, `the evidence ledger chain verifies ok=${String(ledgerVerify.ok)} (${String(ledgerVerify.rows)} rows) and the orchestration journal chain verifies ok=${String(journalVerify.ok)} (${String(journalVerify.rows)} rows)`);

			// ---- (f) the flauz.a2a surface: the winner's notice landed; the enforcement point refuses a raw third claimant ----
			const active = bus.activeClaimOf(resource);
			let rawConflict: unknown = null;
			try {
				bus.post({ message: { kind: 'resource-claim', from: 'flauz.agent.worker-3', to: 'flauz.watchers', ts: (winnerClaim?.deadline ?? 1) - 1, payload: { action: 'acquire', resource, leaseUntil: (winnerClaim?.deadline ?? 1) + 60_000 } } });
			} catch (error) {
				rawConflict = error;
			}
			const rawFacts = leaseConflictFacts(rawConflict);
			const busJournal = (await nodeFs.readFile(nodePath.join(ws.root, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
			recorder.check('inv5.bus-claim-path-enforces', active !== undefined && active.holder === 'flauz.agent.worker-1' && active.leaseId === winnerClaim?.noticeId && active.deadline === winnerClaim?.deadline && busJournal.length === 1 && isLeaseConflictError(rawConflict) && rawFacts?.holder === 'flauz.agent.worker-1' && rawFacts?.leaseId === winnerClaim?.noticeId, `the winner's acquire notice is the journal-projected lease (holder=${String(active?.holder)} leaseId=${String(active?.leaseId)}) and a raw acquire through the bus claim path receives the typed conflict (holder=${String(rawFacts?.holder)}, leaseId=${String(rawFacts?.leaseId)})`);

			// ---- (g) never a silent double-execution: one lease, one notice ----
			recorder.check('inv5.no-silent-double-execution', acquiredRows.length === 1 && busJournal.length === 1 && conflicts.length === 1, `exactly one lease-acquired row, one acquire notice (${String(busJournal.length)} journal line(s)) and one recorded refusal - never a silent double-execution`);

			registerRow(recorder.buildRow(
				`two claimants raced ${resource} through the flauz.a2a claim path: worker-1 acquired ${String(winnerClaim?.leaseId)} (notice ${String(winnerClaim?.noticeId)}, deadline ${String(winnerClaim?.deadline)}); worker-2 received the typed ${LEASE_CONFLICT_CODE} {holder, leaseId, deadline}; both attempts journaled with attribution (lease-acquired + conflict-noticed, both evidence-bearing); ledger verify ok=${String(ledgerVerify.ok)}, journal verify ok=${String(journalVerify.ok)}`,
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// INV-6 -- multi-agent-coordination
// ===========================================================================

/** The in-memory A2A port (the fixture-rung double of the seam client). */
class InMemoryA2aPort implements A2aPort {
	private readonly journal: A2aMessage[] = [];

	async post(input: A2aMessageInput): Promise<{ id: string; seq: number; message: A2aMessage }> {
		const seq = this.journal.length + 1;
		const id = `M-${String(seq).padStart(6, '0')}`;
		const message: A2aMessage = {
			$schema: 'flauz.a2a/v0',
			seq,
			id,
			kind: input.kind,
			from: input.from,
			to: input.to,
			ts: input.ts ?? 1,
			inReplyTo: input.inReplyTo ?? null,
			payload: input.payload,
		};
		this.journal.push(message);
		return { id, seq, message };
	}

	async collect(agentId: string): Promise<A2aMessage[]> {
		return this.journal.filter(message => message.to === agentId);
	}
}

/**
 * The deterministic lost-update rendezvous (fixture rung): a FileSystemPort
 * wrapper that serves the ledger file to N concurrent readers from ONE
 * snapshot, forcing the classic read-read-append-append interleaving. This
 * is the simulated concurrency port of the fixture rung (the session-battery
 * SimulatedRemoteExecutor pattern applied to the ledger); the runtime rung
 * documents the same structural finding over the same contract.
 */
class RendezvousLedgerFs implements BatteryFs {
	private pendingReads: Array<{ path: string; resolve: (text: string | undefined) => void }> = [];
	private armed = false;
	private readonly readers: number;
	private readonly inner: BatteryFs;
	private readonly ledgerPath: string;

	constructor(inner: BatteryFs, ledgerPath: string, readers: number) {
		this.inner = inner;
		this.ledgerPath = ledgerPath;
		this.readers = readers;
	}

	arm(): void {
		this.armed = true;
	}

	async readFileUtf8(path: string): Promise<string | undefined> {
		if (!this.armed || path !== this.ledgerPath) {
			return this.inner.readFileUtf8(path);
		}
		return new Promise<string | undefined>(resolve => {
			this.pendingReads.push({ path, resolve });
			if (this.pendingReads.length >= this.readers) {
				const readers = this.pendingReads.splice(0);
				void this.inner.readFileUtf8(path).then(snapshot => {
					for (const reader of readers) {
						reader.resolve(snapshot);
					}
				});
			}
		});
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

describe('INV-6 multi-agent-coordination', () => {
	test('attribution is preserved across agents and messengers; concurrent ledger appends are measured for clobbering', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-6', 'multi-agent-coordination');
		const ws = await bootBatteryWorkspace();
		try {
			// ---- (a) two agents, two tasks, the A2A delegation round-trip ----
			const parentTask = await ws.tasks.createTask('inv6 parent delegation');
			const workerTask = await ws.tasks.createTask('inv6 worker execution');
			const workerEvidence = await ws.ledger.append(workerTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${workerTask.id}/command-output-1.txt`, sha256: sha256Hex('inv6-worker-output'), note: 'echo inv6-worker' });

			const port = new InMemoryA2aPort();
			const parent = new AgentMessenger({ self: 'flauz.agent', port });
			const worker = new AgentMessenger({ self: 'flauz.agent.worker-1', port });
			const delegated = await parent.delegate('flauz.agent.worker-1', { taskId: workerTask.id, taskDescription: 'inv6 delegated slice', prompt: 'run the delegated slice' });
			const reported = await worker.reportBack('flauz.agent', { taskId: workerTask.id, outcome: 'ok', evidenceIds: [workerEvidence.evidenceId], summary: 'delegated slice done' }, delegated.id);
			const parentMailbox = await parent.drain();
			const reportMessage = parentMailbox.find(message => message.id === reported.id);
			recorder.check('inv6.a2a-report-delivered', reportMessage !== undefined && reportMessage.from === 'flauz.agent.worker-1' && reportMessage.to === 'flauz.agent', `the result-report round-trips with from/to attribution: ${JSON.stringify(reportMessage ?? null)}`);
			const reportedEvidenceIds = reportMessage !== undefined ? (reportMessage.payload as { evidenceIds?: string[] }).evidenceIds ?? [] : [];
			const reportedEvidenceRow = await ws.ledger.rowByEvidenceId(reportedEvidenceIds[0] ?? '');
			recorder.check('inv6.evidence-attribution', reportedEvidenceRow !== undefined && reportedEvidenceRow.taskId === workerTask.id, `the reported evidence id resolves to a ledger row attributed to the worker task: ${JSON.stringify(reportedEvidenceRow?.taskId ?? null)}`);

			// ---- (b) the concurrent append: two agents, one ledger, the forced interleaving ----
			await ws.ledger.append(parentTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${parentTask.id}/command-output-1.txt`, sha256: sha256Hex('inv6-parent-output'), note: 'echo inv6-parent' });
			const rowsBefore = (await ws.ledger.readRows()).length;
			const ledgerPath = `${ws.root}/.flauz/evidence/ledger.jsonl`;
			const rendezvous = new RendezvousLedgerFs(ws.fs, ledgerPath, 2);
			rendezvous.arm();
			const ledgerA = new EvidenceLedger({ root: ws.root, fs: rendezvous, clock: steppingClock(70_000) });
			const ledgerB = new EvidenceLedger({ root: ws.root, fs: rendezvous, clock: steppingClock(80_000) });
			const [appendA, appendB] = await Promise.all([
				ledgerA.append(parentTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${parentTask.id}/command-output-2.txt`, sha256: sha256Hex('inv6-a'), note: 'echo inv6-a' }),
				ledgerB.append(workerTask.id, { kind: 'command-output', uri: `.flauz/artifacts/${workerTask.id}/command-output-2.txt`, sha256: sha256Hex('inv6-b'), note: 'echo inv6-b' }),
			]);

			// attribution: each appended row names its own agent's task
			const rowsAfter: LedgerRow[] = await new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(90_000) }).readRows();
			recorder.check('inv6.attribution-under-concurrency', rowsAfter.some(row => row.taskId === parentTask.id && row.sha256 === sha256Hex('inv6-a')) && rowsAfter.some(row => row.taskId === workerTask.id && row.sha256 === sha256Hex('inv6-b')), `both concurrent rows carry their own agent's taskId (${appendA.evidenceId} -> ${parentTask.id}, ${appendB.evidenceId} -> ${workerTask.id})`);
			const verify = await new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(95_000) }).verify();
			recorder.check('inv6.no-clobber', verify.ok, `concurrent appends preserve the append-only chain: verify ok=${String(verify.ok)}${verify.ok ? '' : ` firstBadSeq=${String(verify.firstBadSeq)} (${verify.reason ?? ''})`}`);
			const duplicateSeq = rowsAfter.filter(row => row.seq === rowsBefore + 1).length;
			recorder.check('inv6.seq-uniqueness', duplicateSeq === 1, `the next seq was minted exactly once (${String(duplicateSeq)} rows carry seq ${String(rowsBefore + 1)} after the concurrent append)`);

			registerRow(recorder.buildRow(
				`A2A round-trip flauz.agent -> flauz.agent.worker-1 (report ${reported.id} attributed; evidence ${workerEvidence.evidenceId} -> ${workerTask.id}); concurrent append over ${String(rowsBefore)} rows: verify ok=${String(verify.ok)} firstBadSeq=${String(verify.firstBadSeq)} (deterministic rendezvous: both appends read the same pre-state)`,
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// INV-7 -- evidence-provenance-integrity
// ===========================================================================

describe('INV-7 evidence-provenance-integrity', () => {
	test('the recovered chain verifies; a doctored mid-chain row and a reordered chain are detected with the first broken link named', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-7', 'evidence-provenance-integrity');
		const ws = await bootBatteryWorkspace();
		try {
			const task = await ws.tasks.createTask('inv7 provenance');
			// build a five-row chain with deterministic content
			for (let seq = 1; seq <= 5; seq += 1) {
				const output = `inv7-row-${seq}`;
				await ws.ledger.append(task.id, { kind: 'command-output', uri: `.flauz/artifacts/${task.id}/command-output-${seq}.txt`, sha256: sha256Hex(output), note: `echo inv7-${seq}` });
			}
			const ledgerPath = `${ws.root}/.flauz/evidence/ledger.jsonl`;

			// (a) recovery: a fresh instance over the same root verifies the chain
			const recovered = new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(20_000) });
			const recoveredVerify = await recovered.verify();
			recorder.check('inv7.chain-verifies', recoveredVerify.ok && recoveredVerify.rows === 5, `the recovered five-row chain verifies ok=${String(recoveredVerify.ok)} rows=${String(recoveredVerify.rows)}`);

			// (b) the live mid-chain tamper: doctor row 3's uri on disk
			const originalLines = (await nodeFs.readFile(ledgerPath, { encoding: 'utf-8' })).split('\n').filter(line => line.length > 0);
			const doctoredRow = JSON.parse(originalLines[2] ?? '') as LedgerRow;
			const tamperedLines = [...originalLines];
			tamperedLines[2] = rowLine({ ...doctoredRow, uri: '.flauz/artifacts/DOCTORED.txt' });
			await nodeFs.writeFile(ledgerPath, `${tamperedLines.join('\n')}\n`, { encoding: 'utf-8' });
			const tamperVerify = await new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(30_000) }).verify();
			recorder.check('inv7.doctored-row-detected', tamperVerify.ok === false && tamperVerify.firstBadSeq === 4, `the doctored mid-chain row is detected with the first broken link named: ok=${String(tamperVerify.ok)} firstBadSeq=${String(tamperVerify.firstBadSeq)} (${tamperVerify.reason ?? ''})`);

			// (c) the reordered chain: swap rows 2 and 3
			const reorderedLines = [...originalLines];
			const second = reorderedLines[1] ?? '';
			reorderedLines[1] = reorderedLines[2] ?? '';
			reorderedLines[2] = second;
			await nodeFs.writeFile(ledgerPath, `${reorderedLines.join('\n')}\n`, { encoding: 'utf-8' });
			const reorderVerify = await new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(40_000) }).verify();
			recorder.check('inv7.reorder-detected', reorderVerify.ok === false && reorderVerify.firstBadSeq !== undefined, `the reordered chain is detected: ok=${String(reorderVerify.ok)} firstBadSeq=${String(reorderVerify.firstBadSeq)} (${reorderVerify.reason ?? ''})`);

			// (d) restore the pristine chain; the row hash discipline is stable
			await nodeFs.writeFile(ledgerPath, `${originalLines.join('\n')}\n`, { encoding: 'utf-8' });
			const restoredVerify = await new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(50_000) }).verify();
			recorder.check('inv7.restored-chain-verifies', restoredVerify.ok && restoredVerify.rows === 5, `the restored pristine chain verifies again ok=${String(restoredVerify.ok)}`);

			// (e) the COMMITTED doctored control fixture (the instrument's tamper
			// corpus): the committed mid-chain-altered ledger tree MUST be
			// detected with the pinned first broken link -- an INSTRUMENT control.
			const fixtureDir = process.env.FLAUZ_AGENTOS_BATTERY_FIXTURES ?? resolveDefaultFixtureDir();
			const doctoredRoot = nodePath.join(fixtureDir, 'doctored-ledger');
			const doctoredLedger = new EvidenceLedger({ root: doctoredRoot, fs: batteryFsPort(), clock: steppingClock(60_000) });
			const controlVerify = await doctoredLedger.verify();
			recorder.check('inv7.control-detection', controlVerify.ok === false, `the committed doctored-ledger control fixture is detected (the instrument is not blind): ok=${String(controlVerify.ok)}`);
			recorder.control('inv7.control-first-broken-link', controlVerify.ok === false && controlVerify.firstBadSeq === 4, `the committed doctored fixture must name the first broken link (got firstBadSeq=${String(controlVerify.firstBadSeq)}, expected 4)`);
			const controlRows = await doctoredLedger.readRows();
			recorder.control('inv7.control-row-count', controlRows.length === 5, `the committed doctored fixture carries its five rows (got ${String(controlRows.length)})`);

			registerRow(recorder.buildRow(
				`live chain: 5 rows, verify ok; mid-chain doctor detected (firstBadSeq 4, prev hash mismatch); reorder detected (firstBadSeq ${String(reorderVerify.firstBadSeq)}); doctored-ledger-control: ${controlVerify.ok === false ? `detected (firstBadSeq ${String(controlVerify.firstBadSeq)})` : 'UNDETECTED'}`,
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// INV-8 -- partial-environment-browser-failure
// ===========================================================================

/**
 * The dying browser transport (fixture rung): the connection is killed the
 * moment a Page.navigate command is dispatched -- the leg dies MID-STEP and
 * the pipeline must surface the typed transport-closed failure (never a
 * fake commit).
 */
class DyingFakeCdpTransport extends FakeCdpTransport {
	protected postMessage(payload: Record<string, unknown>): void {
		if (payload.method === 'Page.navigate') {
			this.drop();
			return;
		}
		super.postMessage(payload);
	}
}

describe('INV-8 partial-environment-browser-failure', () => {
	test('a cloud environment that dies mid-lifecycle and a browser transport that dies mid-navigation both mark the task FAILED with evidence; no fake success', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		const recorder = new JourneyRecorder('INV-8', 'partial-environment-browser-failure');

		// ---- (a) the environment leg: the provider reports the sandbox GONE (HTTP 404) ----
		const leg = await bootCloudLeg([{ status: 404, bodyText: '{"error":"sandbox vanished"}' }]);
		try {
			const actor = 'agent';
			const createOutcome = await leg.envManager.perform('create', { id: CLOUD_ENV_ID, actor });
			assert.equal(createOutcome.ok, true, 'cloud create succeeds (setup)');
			const deadStart = await leg.envManager.perform('start', { id: CLOUD_ENV_ID, actor });
			recorder.check('inv8.env-death-typed', deadStart.ok === false && opErrorCode(deadStart) === 'CLOUD_SANDBOX_UNKNOWN', `the dead environment start surfaces the typed error ok=${String(deadStart.ok)} code=${opErrorCode(deadStart)}`);
			const envState = await readEnvLifecycleState(leg.root, CLOUD_ENV_ID);
			recorder.check('inv8.env-death-state', envState === 'failed', `the lifecycle state after the environment death '${envState}'`);
			const ops = await readEnvOps(leg.root);
			recorder.check('inv8.env-death-recorded', ops.some(op => op.op === 'start' && op.result === 'error' && op.error?.code === 'CLOUD_SANDBOX_UNKNOWN'), 'the environment death is recorded in the ops ledger');
			const described = await leg.envManager.describe({ id: CLOUD_ENV_ID });
			recorder.check('inv8.no-fake-health', described.verdict.health !== 'healthy', `describe never claims healthy for the dead environment: ${String(described.verdict.health)}`);
		} finally {
			await leg.cleanup();
		}

		// ---- (b) the browser leg: the transport dies mid-navigation ----
		const ws = await bootBatteryWorkspace();
		try {
			const browser = new BrowserSessionManager({
				engine: () => BrowserPolicyEngine.fromPolicyText(SEPARATION_POLICY),
				host: new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
					transportFactory: () => new DyingFakeCdpTransport({ state: new FakeBrowserState(), commandTimeoutMs: 500 }),
				}),
				workspaceRoot: ws.root,
				journal: new FileSystemSessionJournal(ws.root),
				clock: () => FIXED_BROWSER_TS,
				commandTimeoutMs: 150,
				navigationTimeoutMs: 300,
			});
			const opened = await browser.open({ initiator: 'agent', agentId: 'worker-inv8' });
			assert.ok(isSessionError(opened) === false, 'the browser session opens before the leg dies (setup)');
			const sessionId = (opened as OpenSessionResult).descriptor.sessionId;
			const deadNavigation = await browser.navigate(sessionId, 'https://welcome.example.com/');
			recorder.check('inv8.browser-death-typed', isNavigationOutcome(deadNavigation) && deadNavigation.error?.code === 'flauz.browser.transport-closed', `the mid-navigation transport death surfaces the typed error: ${JSON.stringify(deadNavigation.error ?? null)}`);
			recorder.check('inv8.browser-death-no-fake-success', isNavigationOutcome(deadNavigation) && deadNavigation.committedUrl === undefined, `the dead navigation never commits a url (committedUrl ${JSON.stringify(deadNavigation.committedUrl ?? null)})`);
			await browser.dispose();

			// ---- (c) the task-level marking: a workflow run whose tool leg wraps the dying leg ----
			const seedTaskId = await seedCompletedTask(ws, 'ship the flauz agentos partial-failure journey', 'echo flauz-agentos-inv8-ok');
			await ws.workflows.save({ taskId: seedTaskId });
			let executorCalls = 0;
			const executor: ToolExecutorPort = async () => {
				executorCalls += 1;
				return { ok: false, output: 'browser leg died mid-step: flauz.browser.transport-closed' };
			};
			const rerun = await ws.workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
			const failedTask = await ws.tasks.getTask(rerun.taskId);
			recorder.check('inv8.task-failed-with-evidence', rerun.stopped === 'tool-failed' && failedTask.status === 'failed' && rerun.evidenceIds.length === 1, `the task wrapping the dead leg stopped '${rerun.stopped}' status '${failedTask.status}' with ${String(rerun.evidenceIds.length)} evidence row(s)`);
			recorder.check('inv8.downstream-stopped', executorCalls === 1, `downstream tool steps after the dead leg: ${String(executorCalls - 1)}`);
			const failEvent = failedTask.events.find(event => event.type === 'fail');
			recorder.check('inv8.failure-attributed', failEvent !== undefined && failEvent.actor === 'agent', `the fail event is recorded with actor ${String(failEvent?.actor)}`);

			registerRow(recorder.buildRow(
				'environment death: CLOUD_SANDBOX_UNKNOWN (HTTP 404) -> lifecycle failed + ops ledger + describe not-healthy; browser death: transport-closed mid-navigation (no committedUrl); task wrapping: tool-failed + 1 evidence row + downstream stopped',
			));
		} finally {
			await ws.cleanup();
		}
	});
});

// ===========================================================================
// The instrument tests (the battery's own verdict: coverage, shapes,
// controls) + the verdict document emission
// ===========================================================================

function assembleVerdict(): VerdictDocument {
	const documentRows: VerdictRow[] = [];
	for (const entry of CATALOGUE) {
		const row = rows.get(entry.id);
		if (row !== undefined) {
			documentRows.push(row);
		}
	}
	const pass = documentRows.filter(row => row.verdict === 'PASS').length;
	const fail = documentRows.filter(row => row.verdict === 'FAIL').length;
	const skip = documentRows.filter(row => row.verdict === 'SKIP').length;
	return {
		schema: AGENTOS_BATTERY_SCHEMA,
		rung: 'fixture',
		rows: documentRows,
		summary: { pass, fail, skip },
	};
}

describe('the verdict document', () => {
	test('the instrument controls fired (a blinded control fails the suite)', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, () => {
		assert.deepEqual(controlFailures, [], `instrument control failures (the battery is blind): ${JSON.stringify(controlFailures)}`);
	});

	test('the coverage law holds: one well-formed row per catalogue invariant', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, () => {
		assert.deepEqual([...rows.keys()].sort(), [...INVARIANT_IDS].sort(), `the verdict must carry exactly the catalogue invariants (got ${JSON.stringify([...rows.keys()].sort())})`);
		for (const entry of CATALOGUE) {
			const row = rows.get(entry.id);
			assert.ok(row !== undefined, `row ${entry.id} exists`);
			if (row.verdict === 'FAIL') {
				assert.ok(typeof row.violatedInvariant === 'string' && row.violatedInvariant.length > 0, `the FAIL row ${entry.id} names the violated invariant`);
				assert.ok(row.violatedInvariant.startsWith(entry.id), `the FAIL row ${entry.id}'s violatedInvariant references its own invariant`);
				assert.ok(/assertion [a-z0-9.-]+/.test(row.violatedInvariant), `the FAIL row ${entry.id} names the first failing assertion id`);
				assert.ok(row.reason.length > 0, `the FAIL row ${entry.id} carries a reason`);
			}
			if (row.verdict === 'SKIP') {
				assert.ok(row.reason.length > 0, `the SKIP row ${entry.id} carries the exact reason`);
			}
			if (row.verdict === 'PASS') {
				assert.ok(row.assertions.pass >= 1, `the PASS row ${entry.id} rests on at least one target assertion`);
			}
			assert.ok(row.assertions.pass >= 0 && row.assertions.fail >= 0, `the row ${entry.id} carries numeric assertion counts`);
			assert.ok(row.evidence.length > 0, `the row ${entry.id} carries evidence`);
		}
	});

	test('the verdict document is emitted (flauz.agentos-battery/v1, rung fixture)', { skip: RUNNER_OK ? false : RUNNER_SKIP_REASON }, async () => {
		assert.deepEqual([...rows.keys()].sort(), [...INVARIANT_IDS].sort(), 'all journeys registered their rows before emission');
		const document = assembleVerdict();
		const path = process.env.FLAUZ_AGENTOS_BATTERY_VERDICT ?? nodePath.join(os.tmpdir(), 'flauz-agentos-battery-verdict.json');
		await nodeFs.mkdir(nodePath.dirname(path), { recursive: true });
		await nodeFs.writeFile(path, `${JSON.stringify(document, null, '\t')}\n`, { encoding: 'utf-8' });
		// the human-readable census (also greppable by the gate's relay)
		console.log(`agentos battery: verdict ${String(document.summary.pass)} PASS, ${String(document.summary.fail)} FAIL (findings), ${String(document.summary.skip)} SKIP -- ${path}`);
		for (const row of document.rows) {
			const suffix = row.verdict === 'FAIL' ? ` -- ${row.violatedInvariant ?? row.reason}` : row.verdict === 'SKIP' ? ` -- ${row.reason}` : '';
			console.log(`agentos battery: ${row.verdict}  ${row.invariant}${suffix}`);
		}
	});
});
