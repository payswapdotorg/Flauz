/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture-workspace boot for the flauz-telemetry suite (A-PROD-004-W4).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces are constructed by
 * driving the REAL owning services (test-time cross-extension imports are
 * the sanctioned session-battery pattern; src never crosses boundaries):
 *
 *   - TaskService + EvidenceLedger     (extensions/flauz-workspace)
 *   - appendDecision                   (extensions/flauz-models routing store)
 *   - OrchestrationStore               (extensions/flauz-agent core)
 *   - WorkflowService                  (extensions/flauz-workflow)
 *
 * The environments registry is seeded from the shared contract fixture
 * (test/fixtures/resources/contracts/environments-registry.json) -- the same
 * pin the flauz-resources contract tests, the flauz-diagnostics suite, the
 * flauz-backup suite and the flauz-migration suite use -- then extended with
 * the disabled + invalid entries the environment-validation observer needs.
 *
 * The FAILURE SEQUENCES are real too: the fixture drives the orchestration
 * store's real provider-retry window (retryable-failed -> exhausted, and a
 * recovered window), a terminally failed step, a no-candidate routing
 * decision, and a workflow whose last tool step failed -- every failure
 * mode the prior waves' surfaces can produce, typed through the taxonomy.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { appendDecision } from '../../flauz-models/src/routing/store.ts';
import { ROUTING_DECISION_SCHEMA_ID } from '../../flauz-models/src/routing/policy.ts';
import type { FileSystemPort as ModelsFsPort } from '../../flauz-models/src/contract/ports.ts';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import { WorkflowService } from '../../flauz-workflow/src/envelope.ts';

import type { TelemetryFsPort, Clock } from '../src/api.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const ENVIRONMENTS_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'resources', 'contracts', 'environments-registry.json');

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_000_000_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/** The flauz-telemetry TelemetryFsPort over node:fs (the extension-host wiring). */
export function nodeTelemetryFs(): TelemetryFsPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		readdir: async target => {
			try {
				return await fs.readdir(target);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code === 'ENOENT' || code === 'ENOTDIR') {
					return undefined;
				}
				throw err;
			}
		},
		mkdir: target => fs.mkdir(target, { recursive: true }),
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
		remove: target => fs.rm(target, { force: true }),
	};
}

/** The flauz-workspace FileSystemPort over node:fs (the extension-host wiring). */
export function nodeWorkspaceFs(): FileSystemPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
	};
}

/** A models FileSystemPort bound to a fixed root (the makeTempFs shape, workspace-bound). */
function modelsFsPort(): ModelsFsPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: async (target, contents) => {
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, contents, { encoding: 'utf-8' });
		},
		rename: async (from, to) => fs.rename(from, to),
		mkdir: async target => {
			await fs.mkdir(target, { recursive: true });
		},
	};
}

export interface FixtureWorkspace {
	readonly root: string;
	readonly fs: TelemetryFsPort;
	readonly clock: Clock;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly orchestration: OrchestrationStore;
	readonly workflows: WorkflowService;
	cleanup(): Promise<void>;
}

export interface FixtureOptions {
	readonly clock?: () => number;
	/**
	 * Free-form payload fields to plant in the durable sources' CONTENTS
	 * fields (the canary sweep's delivery vehicle): [0] the routing decision
	 * explanation, [1] the failed-step message, [2] the succeeded-step output,
	 * [3] the environment label, [4] the workflow tool note.
	 */
	readonly canaries?: readonly string[];
	/** When true the fixture writes the environments registry WITHOUT the disabled+invalid entries (the absent-classes leg). */
	readonly plainEnvironments?: boolean;
}

/** One real routing decision row (the exact durable shape the store appends). */
function decisionOf(index: number, at: number, selected: { providerId: string; modelId: string } | null, explanation: string): Record<string, unknown> {
	return {
		schema: ROUTING_DECISION_SCHEMA_ID,
		schemaVersion: 0,
		decisionId: `rd-${String(index).padStart(6, '0')}`,
		at,
		purpose: 'telemetry-fixture',
		requirements: { enabledOnly: true },
		ruleId: 'zero-network-default',
		ruleDescription: 'the fixture rule',
		selected,
		candidates: selected !== null
			? [{ providerId: selected.providerId, modelId: selected.modelId, eligible: true, contextWindowTokens: 8192, locality: 'local' as const, rank: 1 }]
			: [{ providerId: 'lane-x', modelId: 'lane-x-model', eligible: false, exclusionReason: 'provider disabled', contextWindowTokens: 8192, locality: 'remote' as const }],
		selectionBasis: selected !== null ? 'rule-match' : 'no-candidate',
		explanation,
	};
}

/**
 * Boots a REAL `.flauz/` workspace: every artifact class constructed through
 * its owning service, with the failure sequences the taxonomy types, then
 * handed to the telemetry surface under test.
 */
export async function bootFixtureWorkspace(options: FixtureOptions = {}): Promise<FixtureWorkspace> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-telemetry-'));
	const workspaceFs = nodeWorkspaceFs();
	const telemetryFs = nodeTelemetryFs();
	const clock = options.clock ?? steppingClock();
	const canaries = options.canaries ?? [];

	// --- flauz-workspace: the task envelope + the evidence ledger ---
	const tasks = new TaskService({ root, fs: workspaceFs, clock });
	await tasks.bootstrap();
	await tasks.createTask('Observe the provider lanes');
	await tasks.createTask('Run the failing workflow');
	const first = await tasks.getTask('T-001');
	if (first === undefined) {
		throw new Error('flauz-telemetry fixture: T-001 missing after createTask');
	}
	await tasks.appendEvent(first.id, {
		ts: clock(),
		actor: 'agent',
		type: 'custom-note',
		payload: { note: 'ordinary note' },
	});

	const ledger = new EvidenceLedger({ root, fs: workspaceFs, clock });
	await ledger.ensure();
	const artifactSha = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';
	await ledger.append('T-001', { kind: 'command-output', uri: '.flauz/artifacts/T-001/out.txt', sha256: artifactSha });
	await ledger.append('T-001', { kind: 'note', uri: '.flauz/artifacts/T-001/note.txt', sha256: artifactSha });

	// --- flauz-models: real routing decisions (2 ok lanes + the no-candidate incompatibility) ---
	const modelsFs = modelsFsPort();
	const modelsStateDir = path.join(root, '.flauz', 'models');
	await appendDecision(modelsFs, modelsStateDir, decisionOf(1, clock(), { providerId: 'flauz-mock', modelId: 'mock-model-1' }, 'ordinary explanation (fixture)') as never);
	await appendDecision(modelsFs, modelsStateDir, decisionOf(2, clock(), { providerId: 'lane-b', modelId: 'lane-b-model' }, canaries[0] ?? 'ordinary explanation (fixture)') as never);
	await appendDecision(modelsFs, modelsStateDir, decisionOf(3, clock(), null, 'no candidate satisfied the requirements (fixture)') as never);
	await appendDecision(modelsFs, modelsStateDir, decisionOf(4, clock(), { providerId: 'flauz-mock', modelId: 'mock-model-1' }, 'ordinary explanation (fixture)') as never);

	// --- flauz-agent: the real orchestration store with the failure sequences ---
	const orchestration = new OrchestrationStore(root, { clock });
	const submitted = await orchestration.submitGraph({
		title: 'the telemetry fixture graph',
		steps: [
			{ stepId: 'S-01', title: 'Probe the durable state', instruction: 'read the .flauz census surfaces' },
			{ stepId: 'S-02', title: 'Emit the aggregate', instruction: 'record the telemetry rows' },
			{ stepId: 'S-03', title: 'Recover the window', instruction: 'prove the recovered outcome' },
		],
		actor: 'agent',
		taskId: 'T-001',
	});
	const graphId = submitted.graphId;
	await orchestration.approveGraph({ graphId, actor: 'human', origin: 'test:flauz-telemetry' });

	// S-01: the exhausted provider-retry window (PROVIDER_OVERLOADED -> NETWORK_ERROR -> exhausted TIMEOUT)
	const start1 = await orchestration.startStep({ graphId, stepId: 'S-01', actor: 'agent', origin: 'test:flauz-telemetry', runnerId: 'telemetry-runner' });
	await orchestration.recordProviderRetry({ graphId, stepId: 'S-01', attempt: start1.attempt, idempotencyKey: start1.idempotencyKey, attemptOrdinal: 1, outcome: 'retryable-failed', code: 'PROVIDER_OVERLOADED', retryClass: 'short-backoff', waitAppliedMs: 5, maxAttempts: 3, nextAttemptOrdinal: 2 });
	await orchestration.recordProviderRetry({ graphId, stepId: 'S-01', attempt: start1.attempt, idempotencyKey: start1.idempotencyKey, attemptOrdinal: 2, outcome: 'retryable-failed', code: 'NETWORK_ERROR', retryClass: 'short-backoff', waitAppliedMs: 500, maxAttempts: 3, nextAttemptOrdinal: 3 });
	await orchestration.recordProviderRetry({ graphId, stepId: 'S-01', attempt: start1.attempt, idempotencyKey: start1.idempotencyKey, attemptOrdinal: 3, outcome: 'exhausted', code: 'TIMEOUT', retryClass: 'short-backoff', waitAppliedMs: 15000, maxAttempts: 3 });
	await orchestration.finishStep({
		graphId,
		stepId: 'S-01',
		outcome: 'failed',
		actor: 'agent',
		origin: 'test:flauz-telemetry',
		failureClass: 'transient',
		message: canaries[1] ?? 'ordinary step failure (fixture)',
		retryPlanned: false,
	});

	// S-02: the clean succeeded step (duration = the ts delta of started -> succeeded)
	const start2 = await orchestration.startStep({ graphId, stepId: 'S-02', actor: 'agent', origin: 'test:flauz-telemetry', runnerId: 'telemetry-runner' });
	await orchestration.finishStep({
		graphId,
		stepId: 'S-02',
		outcome: 'succeeded',
		actor: 'agent',
		origin: 'test:flauz-telemetry',
		evidence: [],
		output: canaries[2] ?? 'ordinary step output (fixture)',
	});

	// S-03: the recovered provider-retry window (RATE_LIMITED at ordinal 1, recovered at ordinal 2)
	const start3 = await orchestration.startStep({ graphId, stepId: 'S-03', actor: 'agent', origin: 'test:flauz-telemetry', runnerId: 'telemetry-runner' });
	await orchestration.recordProviderRetry({ graphId, stepId: 'S-03', attempt: start3.attempt, idempotencyKey: start3.idempotencyKey, attemptOrdinal: 1, outcome: 'retryable-failed', code: 'RATE_LIMITED', retryClass: 'long-backoff', waitAppliedMs: 250, maxAttempts: 3, nextAttemptOrdinal: 2 });
	await orchestration.recordProviderRetry({ graphId, stepId: 'S-03', attempt: start3.attempt, idempotencyKey: start3.idempotencyKey, attemptOrdinal: 2, outcome: 'recovered', code: 'RATE_LIMITED', retryClass: 'long-backoff', waitAppliedMs: 0, maxAttempts: 3 });
	await orchestration.finishStep({
		graphId,
		stepId: 'S-03',
		outcome: 'succeeded',
		actor: 'agent',
		origin: 'test:flauz-telemetry',
		evidence: [],
	});

	// --- flauz-workflow: a real saved envelope whose last tool step FAILED ---
	const second = await tasks.getTask('T-002');
	if (second === undefined) {
		throw new Error('flauz-telemetry fixture: T-002 missing after createTask');
	}
	await tasks.appendEvent(second.id, { ts: clock(), actor: 'agent', type: 'submit-plan', payload: { plan: '## fixture plan' } });
	await tasks.appendEvent(second.id, { ts: clock(), actor: 'human', type: 'approve', payload: {} });
	const evidenceRow = await ledger.append('T-002', { kind: 'command-output', uri: '.flauz/artifacts/T-002/out.txt', sha256: artifactSha });
	await tasks.recordEvidence('T-002', { evidenceId: evidenceRow.evidenceId, seq: evidenceRow.seq, kind: 'command-output', uri: '.flauz/artifacts/T-002/out.txt', sha256: artifactSha, note: canaries[4] ?? 'build the bundle' });
	await tasks.appendEvent(second.id, { ts: clock(), actor: 'agent', type: 'fail', payload: { reason: 'ordinary fixture failure' } });
	await fs.mkdir(path.join(root, '.flauz', 'workflows'), { recursive: true });
	const workflows = new WorkflowService({ root, fs: workspaceFs, tasks, ledger, clock });
	await workflows.save({ taskId: 'T-002' });

	// --- flauz-environments: the shared contract fixture + the disabled + invalid entries ---
	await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
	const registryBase = JSON.parse(await fs.readFile(ENVIRONMENTS_FIXTURE, 'utf-8')) as { environments: unknown[] };
	if (options.plainEnvironments === true) {
		await fs.writeFile(path.join(root, '.flauz', 'environments.json'), `${JSON.stringify(registryBase, null, 2)}\n`, 'utf-8');
	} else {
		const extended = {
			...registryBase,
			environments: [
				...registryBase.environments,
				{
					id: 'env-disabled-box',
					kind: 'ssh-local',
					label: canaries[3] ?? 'Disabled box',
					connection: { host: 'disabled.example.internal', port: 2223, user: 'builder', authMethod: 'key' },
					trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
					capabilities: { agentHost: false, browser: false, exec: true, terminal: true },
					enabled: false,
					timing: { created: 1730000100000, updatedAt: 1730000150000 },
				},
				{
					// the INVALID entry: connection is not an object (descriptor shape drift)
					id: 'env-broken-box',
					kind: 'container',
					label: 'Broken container',
					connection: 'not-an-object',
					trust: { posture: 'trusted', inheritsWorkspaceTrust: true },
					capabilities: { agentHost: true, browser: false, exec: true, terminal: true },
					enabled: true,
					timing: { created: 1730000200000, updatedAt: 1730000250000 },
				},
			],
		};
		await fs.writeFile(path.join(root, '.flauz', 'environments.json'), `${JSON.stringify(extended, null, 2)}\n`, 'utf-8');
	}

	return {
		root,
		fs: telemetryFs,
		clock,
		tasks,
		ledger,
		orchestration,
		workflows,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------------------
// The telemetry-specific fixture helpers
// ---------------------------------------------------------------------------

/** Reads every file under a directory (recursive) as { path, text } -- the canary byte-scan vehicle. */
export async function readAllFiles(dir: string): Promise<{ path: string; text: string }[]> {
	const out: { path: string; text: string }[] = [];
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const target = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...await readAllFiles(target));
		} else if (entry.isFile()) {
			out.push({ path: target, text: await fs.readFile(target, 'utf-8') });
		}
	}
	return out;
}

/** The telemetry ledger's on-disk text (undefined when absent). */
export async function readTelemetryLedgerText(root: string): Promise<string | undefined> {
	try {
		return await fs.readFile(path.join(root, '.flauz', 'telemetry', 'ledger.jsonl'), 'utf-8');
	} catch {
		return undefined;
	}
}

/** The telemetry config's on-disk text (undefined when absent). */
export async function readConfigText(root: string): Promise<string | undefined> {
	try {
		return await fs.readFile(path.join(root, '.flauz', 'telemetry', 'config.json'), 'utf-8');
	} catch {
		return undefined;
	}
}

/** Reads the on-disk evidence ledger row count (the census-visibility assert helper). */
export async function onDiskLedgerRowCount(root: string): Promise<number> {
	const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
	return text.split('\n').filter(line => line !== '').length;
}

/** The on-disk evidence ledger's kind counts (the census-visibility assert helper). */
export async function onDiskLedgerKindCounts(root: string): Promise<Record<string, number>> {
	const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
	const counts: Record<string, number> = {};
	for (const line of text.split('\n').filter(line => line !== '')) {
		const parsed = JSON.parse(line) as { kind: string };
		counts[parsed.kind] = (counts[parsed.kind] ?? 0) + 1;
	}
	return counts;
}

/** A capture output channel (the command-render assert vehicle). */
export function captureChannel(): { lines: string[]; appendLine(line: string): void } {
	const lines: string[] = [];
	return { lines, appendLine: (line: string) => { lines.push(line); } };
}
