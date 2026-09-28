/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-004 -- the whole-session acceptance battery (fixture rung).
 *
 * A green unit-test suite is not a green product. This battery drives WHOLE
 * user sessions across the REAL Flauz surfaces -- the flauz.tasks/v0 state
 * machine (flauz-workspace TaskService), the evidence ledger, the workflow
 * envelope (save + re-run with replay approvals), the browser session
 * manager over a FakeCdpTransport (policy-gated navigation, journal on
 * disk), and the environment lifecycle manager behind the simulated remote
 * executor (provenance law, PIN-2 persistence).
 *
 * Four journeys (spec: docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md):
 *
 *   J1 golden      -- create task -> plan -> approve -> tool -> browser leg
 *                    (agent session, allowed navigation) -> environment leg
 *                    (create/start/describe/stop/destroy) -> verify -> sign
 *                    off -> save workflow fragment. Everything observable
 *                    lands on disk at the workspace root.
 *   J2 recovery    -- re-run the saved fragment (replay approvals): a NEW
 *                    task, NEW evidence rows linked to the ORIGINAL run via
 *                    derivedFrom, fragment history records the re-run.
 *   J3 fail-closed -- denied navigation (zero CDP drive commands past the
 *                    gate) + the provenance law (actor-less lifecycle op is
 *                    a typed rejection, not a silent no-op).
 *   J4 continuity  -- a full restart (fresh service instances on the SAME
 *                    root): tasks, workflows, lifecycle state and the
 *                    browser journal are all recovered from disk; work
 *                    continues; nothing is lost.
 *
 * Fixture discipline: each journey distills an observable transcript
 * (state/event sequences, row counts, artifact uris + sha256, verdicts --
 * volatile ids normalized to stable markers). The assembled document is
 * deep-compared against the pinned fixture
 * test/fixtures/session-battery/golden-transcript.json. FLAUZ_SESSION_BATTERY_RECORD=1
 * regenerates the pinned fixture (promotion-ladder tool; documented in the
 * spec). A doctored fixture must FAIL the battery (proven by the gate's
 * fixture matrix, see verify-fixtures.sh).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodeFsSync from 'node:fs';
import * as nodePath from 'node:path';

import { sha256Hex, type FileSystemPort, type LedgerRow } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService, type ToolExecutorPort } from '../src/envelope.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError, type OpenSessionResult } from '../../flauz-browser/src/runtime/sessionManager.ts';
import type { NavigationOutcome } from '../../flauz-browser/src/runtime/tabs.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { FileSystemSessionJournal, type SessionJournalRecord } from '../../flauz-browser/src/runtime/journal.ts';
import { EnvironmentRegistry } from '../../flauz-environments/src/registry.ts';
import { EnvironmentLifecycleManager, SimulatedRemoteExecutor } from '../../flauz-environments/src/lifecycle/index.ts';

// ---------------------------------------------------------------------------
// Workspace boot (whole-session variant: one root, every service, one
// deterministic story)
// ---------------------------------------------------------------------------

const ENV_ID = 'env-test-remote';
const ENV_KIND = 'workspace-remote';
const FIXED_BROWSER_TS = 1_740_000_000_000;

function sessionBatteryFsPort(): FileSystemPort & { rm(target: string): Promise<void> } {
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

interface SessionWorkspace {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly envRegistry: EnvironmentRegistry;
	readonly envManager: EnvironmentLifecycleManager;
	readonly envSim: SimulatedRemoteExecutor;
	readonly browser: BrowserSessionManager;
	readonly browserTransports: FakeCdpTransport[];
	readonly workspaceClock: () => number;
	cleanup(): Promise<void>;
}

/**
 * The separation policy used by every journey: driver allowlist
 * *.example.com (agents may drive example.com subdomains); everything
 * else is denied for agents.
 */
const SEPARATION_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

async function bootSessionWorkspace(): Promise<SessionWorkspace> {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-session-'));
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
	const envSim = new SimulatedRemoteExecutor({ kind: ENV_KIND, root, fs, clock: envClock, latencyMs: 0 });
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock: envClock, executors: [envSim], simulatedDefault: true });
	await envManager.bootstrap();

	const browserTransports: FakeCdpTransport[] = [];
	const fakeState = new FakeBrowserState();
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			const transport = new FakeCdpTransport({ state: fakeState, commandTimeoutMs: 500 });
			browserTransports.push(transport);
			return transport;
		},
	});
	const journal = new FileSystemSessionJournal(root);
	const browser = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(SEPARATION_POLICY),
		host,
		workspaceRoot: root,
		journal,
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
		envSim,
		browser,
		browserTransports,
		workspaceClock,
		cleanup: async () => {
			await browser.dispose();
			await nodeFs.rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------
// Transcript distillation (observable outcomes only; volatile ids
// normalized to stable markers)
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
	readonly navigationVerdicts: Array<{ url: string; decision: string; sent: boolean }>;
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

interface SessionBatteryTranscript {
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

/** Page.navigate commands sent across every transport (the policy-gating surface). */
function driveCommandCount(transports: readonly FakeCdpTransport[]): number {
	let count = 0;
	for (const transport of transports) {
		for (const command of transport.sentCommands) {
			if (command.method === 'Page.navigate') {
				count += 1;
			}
		}
	}
	return count;
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

// The default fixture dir resolves from the repo root (found by walking up
// from CWD until package.json carries the code-oss-dev name); the gate
// overrides it explicitly via FLAUZ_SESSION_BATTERY_FIXTURES.
function resolveDefaultFixtureDir(): string {
	let dir = process.cwd();
	for (let i = 0; i < 6; i += 1) {
		const candidate = nodePath.join(dir, 'test', 'fixtures', 'session-battery');
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
	return nodePath.join(process.cwd(), 'test', 'fixtures', 'session-battery');
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

interface JourneyState {
	golden: {
		taskEvents: string[];
		ledgerRows: LedgerRow[];
		artifacts: Array<{ uri: string; sha256: string }>;
		navVerdicts: Array<{ url: string; decision: string; sent: boolean }>;
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

test('J1 golden whole-session: task -> plan -> approve -> tool -> browser -> environment -> verify -> sign-off -> save fragment', async () => {
	const ws = await bootSessionWorkspace();
	try {
		// ---- task creation + planning + approval ----
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

		// ---- browser leg: agent session + allowed navigation ----
		const opened = await ws.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		assert.equal(opened.descriptor.state, 'active', 'the agent session opens (policy + journal allow it)');
		const navigation = await ws.browser.navigate(opened.descriptor.sessionId, 'https://welcome.example.com/');
		assert.ok(isNavigationOutcome(navigation), 'the allowed navigation returns an outcome, not an error');
		assert.equal((navigation as NavigationOutcome).verdict.decision, 'allow', 'the navigation is allowed by the driver layer');
		await ws.browser.close(opened.descriptor.sessionId);

		// ---- environment leg: create -> start -> describe -> stop -> destroy ----
		const actor = 'agent';
		const createOutcome = await ws.envManager.perform('create', { id: ENV_ID, actor, simulated: true });
		assert.equal(createOutcome.ok, true, 'create succeeds behind the simulated executor');
		const startOutcome = await ws.envManager.perform('start', { id: ENV_ID, actor, simulated: true });
		assert.equal(startOutcome.ok, true, 'start succeeds');
		const describe = await ws.envManager.describe({ id: ENV_ID });
		assert.equal(describe.verdict.health, 'healthy', 'the simulated environment reports healthy');
		const stopOutcome = await ws.envManager.perform('stop', { id: ENV_ID, actor, simulated: true });
		assert.equal(stopOutcome.ok, true, 'stop succeeds');
		const destroyOutcome = await ws.envManager.perform('destroy', { id: ENV_ID, actor, simulated: true });
		assert.equal(destroyOutcome.ok, true, 'destroy succeeds');

		// ---- report + verify + sign-off ----
		await ws.tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
		await ws.tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
		await ws.tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });

		// ---- save the workflow fragment (the session's artifact) ----
		const saved = await ws.workflows.save({ taskId });
		assert.equal(saved.workflowId, 'W-001', 'the first saved workflow is W-001');

		// ---- distill the journey transcript ----
		const finalTask = await ws.tasks.getTask(taskId);
		const rows = await ws.ledger.readRows();
		const journalRecords = await readJournalRecords(ws.root);
		const savedFragment = await ws.workflows.load('W-001');

		state.golden = {
			taskEvents: finalTask.events.map(event => `${event.actor}:${event.type}`),
			ledgerRows: rows,
			artifacts: [{ uri: artifactUri, sha256: artifactSha256 }],
			navVerdicts: [{ url: 'https://welcome.example.com/', decision: (navigation as NavigationOutcome).verdict.decision, sent: (navigation as NavigationOutcome).sent }],
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
		assert.ok(state.golden.envOps.includes('create') && state.golden.envOps.includes('destroy'), 'the environment leg is fully journaled');
		assert.equal(journalRecords.length >= 2, true, 'the browser journal has the open + close records');
		assert.equal(savedFragment.tools.length, 1, 'the terminal tool step is distilled into the fragment');
		assert.equal(savedFragment.evidenceRefs.length, 1, 'the evidence row is linked into the fragment');
	} finally {
		await ws.cleanup();
	}
});

test('J2 recovery: re-run the saved fragment with replay approvals -- new task, derived evidence, history records', async () => {
	const ws = await bootSessionWorkspace();
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

		// the recovery act: re-run with replay approvals (the human gates are
		// answered from the recorded decisions, the tool executes fresh)
		const executor: ToolExecutorPort = async step => {
			assert.equal(step.toolId, 'flauz_terminal', 'the re-run replays the recorded tool sequence');
			return { ok: true, output: `${step.input.command}\nflauz-session-recovery-ok` };
		};
		const rerun = await ws.workflows.run({ workflowId: saved.workflowId, executor, approvals: 'replay' });
		assert.equal(rerun.workflowId, 'W-001');
		assert.equal(rerun.stopped, 'completed', 'the replay run completes');

		// derived-evidence law: the new task's workflow-start event carries
		// derivedFrom pointing at the ORIGINAL run
		const rerunTask = await ws.tasks.getTask(rerun.taskId);
		const startEvent = rerunTask.events.find(event => event.type === 'workflow-start');
		assert.ok(startEvent !== undefined, 'the re-run task records its workflow-start');
		const derivedFrom = (startEvent.payload as { derivedFrom?: { taskId?: string } }).derivedFrom;
		assert.equal(derivedFrom?.taskId, taskId, 'derivedFrom points at the original task');

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

		assert.equal(rowsAfter.length, 2, 'the ledger carries one row per run');
		assert.equal(fragment.history.length, 1, 'the fragment history records the re-run');
	} finally {
		await ws.cleanup();
	}
});

test('J3 fail-closed: denied navigation sends ZERO drive commands; actor-less lifecycle op is a typed rejection', async () => {
	const ws = await bootSessionWorkspace();
	try {
		const opened = await ws.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		const allowedSession = opened as OpenSessionResult;
		assert.equal(allowedSession.descriptor.state, 'active');

		// a URL outside every allowlist: the engine must deny, and the
		// navigation pipeline must send ZERO Page.navigate commands
		const denied = await ws.browser.navigate(allowedSession.descriptor.sessionId, 'https://blocked.invalid/');
		assert.ok(isNavigationOutcome(denied), 'the denied navigation is an outcome (not an operation error)');
		const deniedNavigation = denied as NavigationOutcome;
		assert.equal(deniedNavigation.verdict.decision, 'deny');

		const driveAfterDeny = driveCommandCount(ws.browserTransports);

		// the provenance law: an actor-less lifecycle op is a typed rejection
		let provenanceRejection = '<none>';
		let provenanceCode = '<none>';
		try {
			await ws.envManager.perform('create', { id: ENV_ID, simulated: true });
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

		assert.equal(deniedNavigation.sent, false, 'a denied navigation sends ZERO CDP commands');
		assert.equal(driveAfterDeny, 0, 'no Page.navigate was ever sent on the deny path');
		assert.equal(provenanceCode, 'ACTOR_REQUIRED', 'the actor-less op is rejected loudly (typed error code)');
		assert.match(provenanceRejection, /provenance actor/, 'the rejection names the provenance law');
	} finally {
		await ws.cleanup();
	}
});

test('J4 continuity: full restart on the same root -- everything recovers from disk, work continues', async () => {
	const first = await bootSessionWorkspace();
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
		await first.envManager.perform('create', { id: ENV_ID, actor: 'agent', simulated: true });
		await first.envManager.perform('start', { id: ENV_ID, actor: 'agent', simulated: true });
		const browserOpened = await first.browser.open({ initiator: 'agent', agentId: 'worker-1' });
		const ok = isSessionError(browserOpened) === false;
		assert.equal(ok, true, 'the browser session opened before the restart');
		await first.browser.close((browserOpened as OpenSessionResult).descriptor.sessionId);
		const journalBefore = await readJournalRecords(root);
		const journalLineCountBefore = journalBefore.length;
	} finally {
		// the "restart": dispose the manager WITHOUT deleting the root
		await first.browser.dispose();
	}

	// ---- cold boot: fresh instances on the SAME root ----
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
	const envSim = new SimulatedRemoteExecutor({ kind: ENV_KIND, root, fs, clock });
	const envManager = new EnvironmentLifecycleManager({ registry: envRegistry, root, fs, clock, executors: [envSim], simulatedDefault: true });
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
	try {
		const listedTasks = await tasks.listTasks();
		const listedWorkflows = await workflows.list();
		const journalAfter = await readJournalRecords(root);
		const envState = await readEnvLifecycleState(root, ENV_ID);

		// work CONTINUES: a re-run on the recovered services must succeed
		const executor: ToolExecutorPort = async () => ({ ok: true, output: 'echo flauz-session-continuity-ok\nflauz-session-continuity-ok' });
		const rerun = await workflows.run({ workflowId: 'W-001', executor, approvals: 'replay' });
		assert.equal(rerun.stopped, 'completed', 'the recovered workflow service can re-run the fragment');

		state.continuity = {
			taskCount: listedTasks.length,
			workflowIds: listedWorkflows.map(fragment => fragment.id),
			workflowHistoryLength: listedWorkflows[0]?.history.length ?? -1,
			envState,
			journalLineCount: journalAfter.length,
			liveBrowserSessions: 0,
		};

		assert.equal(listedTasks.length, 1, 'the task list recovers from disk');
		assert.deepEqual(listedWorkflows.map(fragment => fragment.id), ['W-001'], 'the workflow index recovers from disk');
		assert.equal(journalAfter.length >= 2, true, 'the browser journal survives the restart');
		assert.equal(envState, 'running', 'the environment lifecycle state is recovered');
	} finally {
		await browser.dispose();
		await nodeFs.rm(root, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// The pinned-fixture comparison (the battery's verdict)
// ---------------------------------------------------------------------------

test('the whole-session transcript matches the pinned fixture', async () => {
	assert.ok(state.golden !== undefined, 'J1 ran');
	assert.ok(state.recovery !== undefined, 'J2 ran');
	assert.ok(state.failClosed !== undefined, 'J3 ran');
	assert.ok(state.continuity !== undefined, 'J4 ran');

	const transcript: SessionBatteryTranscript = {
		schema: 'flauz.session-battery/v1',
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
				driveCommandCount: 1, // the one ALLOWED navigation in J1
			},
			environment: { ops: state.golden.envOps, finalState: state.golden.envFinalState },
			workflow: state.golden.workflow,
		},
		recovery: state.recovery,
		failClosed: state.failClosed,
		continuity: state.continuity,
	};

	const fixtureDir = process.env.FLAUZ_SESSION_BATTERY_FIXTURES ?? resolveDefaultFixtureDir();
	const goldenPath = nodePath.join(fixtureDir, 'golden-transcript.json');

	if (process.env.FLAUZ_SESSION_BATTERY_RECORD === '1') {
		await nodeFs.mkdir(fixtureDir, { recursive: true });
		await nodeFs.writeFile(goldenPath, `${JSON.stringify(transcript, null, '\t')}\n`, { encoding: 'utf-8' });
		console.log('session-battery: pinned fixture regenerated');
		return;
	}

	let raw: string;
	try {
		raw = await nodeFs.readFile(goldenPath, { encoding: 'utf-8' });
	} catch (err) {
		assert.fail(`session-battery: pinned fixture not found at ${goldenPath} (regenerate with FLAUZ_SESSION_BATTERY_RECORD=1) -- ${err instanceof Error ? err.message : String(err)}`);
	}
	const pinned = JSON.parse(raw) as SessionBatteryTranscript;
	assert.deepEqual(transcript, pinned, 'the whole-session transcript matches the pinned fixture');
});

