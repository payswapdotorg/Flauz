/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Executable reusable workflow tests (TL2-005 M3): typed inputs, semantic
 * validation, versioning discipline, durable runs and the KILL-AND-RECOVER
 * matrix (interrupt at every step boundary; recovery to a coherent state).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootWorkflowWorkspace, goldenRun, type TestWorkspace } from './helpers.ts';
import {
	type ExecToolPort,
	RUN_SCHEMA,
	SUPPORTED_ENVELOPE_VERSION,
	WorkflowRunService,
	graphRowsOf,
	validateSemantics,
	validateWorkflowSpec,
	type WorkflowSpec,
} from '../src/executable.ts';

const REGISTRY = { toolIds: () => ['flauz_terminal', 'flauz_read_file'] };

interface ExecCall {
	readonly seq: number;
	readonly toolId: string;
	readonly input: Record<string, unknown>;
}

/** A recording executor with an optional crash at a specific step (the kill simulator). */
function recorder(calls: ExecCall[], crashAt?: number): ExecToolPort {
	return async call => {
		calls.push({ seq: call.seq, toolId: call.toolId, input: call.input });
		if (crashAt !== undefined && call.seq === crashAt) {
			throw new Error(`simulated process death at step ${String(call.seq)}`);
		}
		return { ok: true, output: `step ${String(call.seq)} output` };
	};
}

async function bootExec(ws: TestWorkspace): Promise<WorkflowRunService> {
	return new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, clock: ws.workflows ? undefined : undefined, fragments: ws.workflows });
}

/** An authored 3-step spec with one typed param. */
function authoredSpec(): WorkflowSpec {
	const now = 1_740_000_000_000;
	return validateWorkflowSpec({
		$schema: 'flauz.workflows.exec/v1',
		id: 'WS-001',
		title: 'Parameterized build check',
		sourceFragmentId: null,
		envelopeVersion: SUPPORTED_ENVELOPE_VERSION,
		version: 1,
		inputs: [
			{ name: 'targetDir', type: 'string', required: true, description: 'The directory to check' },
			{ name: 'verbose', type: 'boolean', required: false, description: 'Verbose output', defaultValue: false },
		],
		steps: [
			{ seq: 1, toolId: 'flauz_terminal', name: 'list files', inputTemplate: { command: 'ls', dir: { $param: 'targetDir' } }, approval: 'recorded', onFail: 'abort' },
			{ seq: 2, toolId: 'flauz_terminal', name: 'verbose flag', inputTemplate: { command: 'check', dir: { $param: 'targetDir' }, verbose: { $param: 'verbose' } }, approval: 'recorded', onFail: 'abort' },
			{ seq: 3, toolId: 'flauz_read_file', name: 'read summary', inputTemplate: { path: { $param: 'targetDir' } }, approval: 'recorded', onFail: 'abort' },
		],
		migrations: [],
		model: { provider: 'flauz-mock', model: 'flauz-mock-1' },
		timing: { created: now, updatedAt: now },
	});
}

test('validateWorkflowSpec: strict keys, ids, contiguity; validateSemantics: tool refs + param refs', () => {
	const spec = authoredSpec();
	validateSemantics(spec, REGISTRY);
	assert.equal(spec.steps.length, 3);
	// Unknown tool fails semantics.
	assert.throws(() => validateSemantics({ ...spec, steps: spec.steps.map(step => ({ ...step, toolId: 'nonexistent' })) }, REGISTRY), /references unknown tool 'nonexistent'/);
	// Undeclared param ref fails semantics.
	assert.throws(() => validateSemantics({ ...spec, steps: spec.steps.map(step => ({ ...step, inputTemplate: { x: { $param: 'undeclared' } } })) }, REGISTRY), /undeclared param 'undeclared'/);
	// Envelope version above supported is a typed error (never reinterpretation).
	assert.throws(() => validateWorkflowSpec({ ...authoredSpec(), envelopeVersion: 2 }), /explicit version bump \+ migration is required/);
	// Steps must be contiguous.
	assert.throws(() => validateWorkflowSpec({ ...authoredSpec(), steps: authoredSpec().steps.map(step => ({ ...step, seq: step.seq + 1 })) }), /contiguous from 1/);
});

test('run executes typed-input steps and completes through the task state machine', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const exec = await bootExec(ws);
		await exec.saveSpec(authoredSpec());
		const calls: ExecCall[] = [];
		const outcome = await exec.run('WS-001', { targetDir: 'src/lib' }, { executor: recorder(calls) });
		assert.equal(outcome.status, 'completed');
		assert.equal(outcome.completedSteps, 3);
		assert.equal(outcome.evidenceIds.length, 3);
		assert.deepEqual(calls.map(call => call.seq), [1, 2, 3]);
		// Resolved inputs reached the executor.
		assert.equal(calls[0]?.input.dir, 'src/lib');
		const task = await ws.tasks.getTask(outcome.taskId);
		assert.equal(task.status, 'done');
		// The durable run envelope persisted.
		const run = await exec.loadRun(outcome.runId);
		assert.equal(run.$schema, RUN_SCHEMA);
		assert.equal(run.status, 'completed');
		assert.ok(run.steps.every(step => step.status === 'done'));
		// Graph rows: the durable-graph seam shape.
		const rows = graphRowsOf(run);
		assert.deepEqual(rows.map(row => row.status), ['done', 'done', 'done']);
		assert.equal(rows[0]?.rowKind, 'workflow-step');
	} finally {
		await ws.cleanup();
	}
});

test('typed inputs are enforced: missing required throws, wrong type throws, undeclared input throws', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const exec = await bootExec(ws);
		await exec.saveSpec(authoredSpec());
		const calls: ExecCall[] = [];
		await assert.rejects(() => exec.run('WS-001', {}, { executor: recorder(calls) }), /missing required input 'targetDir'/);
		await assert.rejects(() => exec.run('WS-001', { targetDir: 42 }, { executor: recorder(calls) }), /input 'targetDir' must be of type string/);
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src', extra: true }, { executor: recorder(calls) }), /undeclared input 'extra'/);
		// Defaults fill optional params.
		const outcome = await exec.run('WS-001', { targetDir: 'src' }, { executor: recorder(calls) });
		assert.equal(outcome.status, 'completed');
	} finally {
		await ws.cleanup();
	}
});

test('distillSpec promotes a saved fragment into an executable spec with derivedFrom linkage', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const golden = await goldenRun(ws);
		const saved = await ws.workflows.save({ taskId: golden.taskId });
		const exec = await bootExec(ws);
		const spec = await exec.distillSpec(await ws.workflows.load(saved.workflowId), { toolRegistry: REGISTRY });
		assert.equal(spec.id, 'WS-001');
		assert.equal(spec.sourceFragmentId, saved.workflowId);
		assert.equal(spec.steps.length, 1);
		validateSemantics(spec, REGISTRY);
		const outcome = await exec.run(spec.id, {}, { executor: recorder([]) });
		assert.equal(outcome.status, 'completed');
		// derivedFrom links to the ORIGINAL run's task (the house pattern).
		const run = await exec.loadRun(outcome.runId);
		assert.equal(run.derivedFrom.taskId, golden.taskId);
		assert.deepEqual(run.derivedFrom.evidenceIds, [golden.evidenceId]);
	} finally {
		await ws.cleanup();
	}
});

test('bumpSpec records the migration stub and bumps the version (explicit versioning)', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const exec = await bootExec(ws);
		await exec.saveSpec(authoredSpec());
		const bumped = await exec.bumpSpec('WS-001', 'add a lint step in v2');
		assert.equal(bumped.version, 2);
		assert.deepEqual(bumped.migrations, [{ fromVersion: 1, toVersion: 2, note: 'add a lint step in v2' }]);
		const reloaded = await exec.loadSpec('WS-001');
		assert.equal(reloaded.version, 2);
	} finally {
		await ws.cleanup();
	}
});

// ---------------------------------------------------------------------------
// THE KILL-AND-RECOVER MATRIX (the work order's prove-with-a-matrix clause)
// ---------------------------------------------------------------------------

async function bootMatrix(): Promise<{ ws: TestWorkspace; exec: WorkflowRunService }> {
	const ws = await bootWorkflowWorkspace();
	const exec = new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, fragments: ws.workflows });
	await exec.saveSpec(authoredSpec());
	return { ws, exec };
}

test('KILL-AND-RECOVER: interrupt at step 1 - recovery executes all steps exactly once each', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		const crashed: ExecCall[] = [];
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src' }, { executor: recorder(crashed, 1) }), /simulated process death at step 1/);
		const runs = await exec.listRuns();
		const interrupted = runs.find(run => run.status === 'running');
		assert.ok(interrupted !== undefined, 'the interrupted run envelope persisted as running');
		assert.equal(interrupted?.steps[0]?.status, 'running');
		assert.equal(interrupted?.steps[0]?.attempt, 1);
		// Recover with a healthy executor.
		const recovered: ExecCall[] = [];
		const outcome = await exec.recover(interrupted.runId, { executor: recorder(recovered) });
		assert.equal(outcome.status, 'completed');
		assert.equal(outcome.completedSteps, 3);
		assert.equal(outcome.recoveryCount, 1);
		assert.deepEqual(recovered.map(call => call.seq), [1, 2, 3]);
		const task = await ws.tasks.getTask(outcome.taskId);
		assert.equal(task.status, 'done');
		const events = task.events.filter(event => event.type === 'workflow-recovered');
		assert.equal(events.length, 1);
	} finally {
		await ws.cleanup();
	}
});

test('KILL-AND-RECOVER: interrupt at step 2 - steps 1 kept, step 2 re-run, step 3 fresh', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		const crashed: ExecCall[] = [];
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src' }, { executor: recorder(crashed, 2) }), /simulated process death at step 2/);
		const interrupted = (await exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		assert.equal(interrupted.steps[0]?.status, 'done');
		assert.equal(interrupted.steps[1]?.status, 'running');
		assert.equal(interrupted.steps[2]?.status, 'pending');
		const recovered: ExecCall[] = [];
		const outcome = await exec.recover(interrupted.runId, { executor: recorder(recovered) });
		assert.equal(outcome.status, 'completed');
		// The completed step was NOT re-executed.
		assert.deepEqual(recovered.map(call => call.seq), [2, 3]);
		// Evidence: 3 steps -> exactly 3 rows for the completed attempts (the
		// crashed step-2 attempt appended none).
		assert.equal(outcome.evidenceIds.length, 3);
		const run = await exec.loadRun(interrupted.runId);
		assert.equal(run.steps[1]?.attempt, 2);
		assert.equal(run.steps[0]?.attempt, 1);
	} finally {
		await ws.cleanup();
	}
});

test('KILL-AND-RECOVER: interrupt at step 3 (last) - only step 3 re-runs', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 3) }), /simulated process death at step 3/);
		const interrupted = (await exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const recovered: ExecCall[] = [];
		const outcome = await exec.recover(interrupted.runId, { executor: recorder(recovered) });
		assert.equal(outcome.status, 'completed');
		assert.deepEqual(recovered.map(call => call.seq), [3]);
	} finally {
		await ws.cleanup();
	}
});

test('KILL-AND-RECOVER: recovering a completed run is a no-op (idempotence)', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		const calls: ExecCall[] = [];
		const first = await exec.run('WS-001', { targetDir: 'src' }, { executor: recorder(calls) });
		assert.equal(first.status, 'completed');
		const again = await exec.recover(first.runId, { executor: recorder([]) });
		assert.equal(again.status, 'completed');
		assert.equal(again.recoveryCount, 0);
		assert.equal(calls.length, 3);
	} finally {
		await ws.cleanup();
	}
});

test('KILL-AND-RECOVER: double recovery after an interrupted one is a no-op', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 2) }), /simulated process death at step 2/);
		const interrupted = (await exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const first = await exec.recover(interrupted.runId, { executor: recorder([]) });
		assert.equal(first.status, 'completed');
		assert.equal(first.recoveryCount, 1);
		const second = await exec.recover(interrupted.runId, { executor: recorder([]) });
		assert.equal(second.status, 'completed');
		assert.equal(second.recoveryCount, 1);
	} finally {
		await ws.cleanup();
	}
});

test('KILL-AND-RECOVER: recovery is pinned to the spec version it started with', async () => {
	const { ws, exec } = await bootMatrix();
	try {
		await assert.rejects(() => exec.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 2) }), /simulated process death at step 2/);
		const interrupted = (await exec.listRuns()).find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		await exec.bumpSpec('WS-001', 'changed semantics mid-flight');
		await assert.rejects(() => exec.recover(interrupted.runId, { executor: recorder([]) }), /recovery is pinned to the version it started with/);
	} finally {
		await ws.cleanup();
	}
});

test('restart durability: a fresh service instance recovers an interrupted run from disk', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const first = new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, fragments: ws.workflows });
		await first.saveSpec(authoredSpec());
		await assert.rejects(() => first.run('WS-001', { targetDir: 'src' }, { executor: recorder([], 2) }), /simulated process death at step 2/);
		// New instance over the same files (the process restarted).
		const second = new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, fragments: ws.workflows });
		const runs = await second.listRuns();
		const interrupted = runs.find(run => run.status === 'running');
		assert.ok(interrupted !== undefined);
		const outcome = await second.recover(interrupted.runId, { executor: recorder([]) });
		assert.equal(outcome.status, 'completed');
		assert.equal(outcome.recoveryCount, 1);
	} finally {
		await ws.cleanup();
	}
});

test('onFail continue skips a failed step and completes the run', async () => {
	const ws = await bootWorkflowWorkspace();
	try {
		const exec = new WorkflowRunService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: ws.ledger, fragments: ws.workflows });
		const spec = authoredSpec();
		const tolerant = validateWorkflowSpec({ ...spec, steps: spec.steps.map(step => step.seq === 2 ? { ...step, onFail: 'continue' } : step) });
		await exec.saveSpec(tolerant);
		const failing: ExecToolPort = async call => call.seq === 2 ? { ok: false, output: 'step 2 failed loudly' } : { ok: true, output: `step ${String(call.seq)} ok` };
		const outcome = await exec.run('WS-001', { targetDir: 'src' }, { executor: failing });
		assert.equal(outcome.status, 'completed');
		const run = await exec.loadRun(outcome.runId);
		assert.deepEqual(run.steps.map(step => step.status), ['done', 'skipped', 'done']);
	} finally {
		await ws.cleanup();
	}
});
