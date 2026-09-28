/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M1/M2 suite - the Agent OS service boundary (core/serviceBoundary.mjs).
 *
 * PART A pins the M1 seam usage map: the versioned JSON artifact
 * (core/seamUsageMap.json) and its typed mirror (src/seamUsageMap.ts) are
 * deep-equal, every method the map claims is REAL (registered in the
 * core/protocol.mjs registry), every event is in the SERVICE-SEAM v1
 * catalog, and no proposed extension name is falsely claimed as implemented.
 *
 * PART B pins the pure adapter surfaces: the failure-code semantics table,
 * the method effect classes, the registry-derived method gate, and the
 * transport-failure classifier (every class has a firing case).
 *
 * PART C pins the LIVE boundary against the REAL service (and the frozen
 * v0 stub for the fallback direction): start/negotiation/capabilities,
 * the golden Agent OS flow, A2A wrappers, the idempotency memo, local
 * gating, health watching and shutdown.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
	AgentOsServiceBoundary,
	BoundaryFailure,
	BOUNDARY_FAILURE_CLASSES,
	BOUNDARY_FAILURE_CODES,
	BOUNDARY_RETRY_HINTS,
	classifySendFailure,
	gateSeamMethod,
	seamMethodClass,
} from '../core/serviceBoundary.mjs';
import { SeamProtocolError } from '../src/seamClient.ts';
import { SEAM_METHODS, SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1, capabilitiesForVersion } from '../core/protocol.mjs';
import { SEAM_USAGE_MAP, SEAM_USAGE_PHASES, seamUsagePhaseOf, seamMethodsInUse } from '../src/seamUsageMap.ts';

const USAGE_MAP_JSON_PATH = fileURLToPath(new URL('../core/seamUsageMap.json', import.meta.url));
const V0_SERVICE_PATH = fileURLToPath(new URL('./harness/v0Service.ts', import.meta.url));
const V1_CAPABILITIES = capabilitiesForVersion(SEAM_PROTOCOL_V1);
const SPEC_EVENT_CATALOG = new Set(['task-created', 'task-event', 'evidence-row', 'checkpoint', 'a2a-message']);

function makeWorkspace(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-boundary-'));
}

function sha256Of(text: string): string {
	return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Extract a BoundaryFailure or rethrow (for assert.throws predicates). */
function asBoundary(failure: unknown): BoundaryFailure {
	if (!(failure instanceof BoundaryFailure)) {
		throw failure;
	}
	return failure;
}

// ---------------------------------------------------------------------------------------
// PART A - the seam usage map (M1): artifact <-> mirror consistency, registry truth.
// ---------------------------------------------------------------------------------------

test('usage map: the JSON artifact and the typed TS mirror are deep-equal and versioned', () => {
	const artifact = JSON.parse(readFileSync(USAGE_MAP_JSON_PATH, 'utf-8')) as typeof SEAM_USAGE_MAP;
	assert.deepEqual(SEAM_USAGE_MAP, artifact, 'the typed mirror must equal the JSON artifact byte-for-byte in meaning');
	assert.equal(SEAM_USAGE_MAP.$schema, 'flauz.seam-usage-map/v1');
	assert.equal(SEAM_USAGE_MAP.version, 1);
	assert.equal(SEAM_USAGE_MAP.protocolVersions.v0IsFrozen, true);
	assert.deepEqual(SEAM_USAGE_MAP.protocolVersions.supported, [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1]);
	assert.ok(SEAM_USAGE_MAP.phases.length >= 13, 'the work-order phases plus the auxiliary rows');
});

test('usage map: every served method is registered, every event is in the v1 catalog, phases match the work order', () => {
	const registry = new Set(Object.keys(SEAM_METHODS));
	for (const phase of SEAM_USAGE_MAP.phases) {
		for (const method of phase.servedBy.methods) {
			assert.ok(registry.has(method), `${phase.phase} claims unregistered method ${method}`);
		}
		for (const event of phase.servedBy.events) {
			assert.ok(SPEC_EVENT_CATALOG.has(event), `${phase.phase} claims event ${event} outside the SERVICE-SEAM catalog`);
		}
		assert.ok(['flauz.seam/v0', 'flauz.seam/v1', null].includes(phase.servedBy.minProtocolVersion));
	}
	// The nine lifecycle phases named by the work order must all be present.
	const expected = [
		'orchestrator-start', 'task-submit', 'step-state', 'approval-request', 'lease-op',
		'recovery-scan', 'evidence-checkpoint-append', 'ledger-verify', 'a2a-post-collect',
	];
	for (const phase of expected) {
		assert.ok(SEAM_USAGE_PHASES.includes(phase), `missing work-order phase ${phase}`);
		assert.ok(seamUsagePhaseOf(phase) !== undefined);
	}
	// The phases the work order names as NOT served must say so honestly.
	assert.deepEqual(seamUsagePhaseOf('lease-op')?.servedBy.methods, [], 'lease-op is served by no seam method today');
	assert.notEqual(seamUsagePhaseOf('lease-op')?.additiveExtension, null, 'lease-op needs an additive extension');
});

test('usage map: proposed extensions are clearly NOT implemented (no false surface claims)', () => {
	for (const phase of SEAM_USAGE_MAP.phases) {
		const extension = phase.additiveExtension;
		if (extension === null) {
			continue;
		}
		assert.equal(extension.status, 'proposed-not-implemented');
		for (const proposed of extension.proposed) {
			const firstToken = proposed.split(' ')[0];
			assert.ok(!Object.hasOwn(SEAM_METHODS, firstToken), `${phase.phase} proposes ${proposed} which must not be registered as implemented`);
		}
	}
	// The methods actually in use are exactly the registry entries the map names.
	assert.deepEqual(seamMethodsInUse(), [...new Set(seamMethodsInUse())].sort());
});

// ---------------------------------------------------------------------------------------
// PART B - pure adapter surfaces: failure table, effect classes, gate, classifier.
// ---------------------------------------------------------------------------------------

test('failure semantics table: closed set, every code classified, hints closed', () => {
	const codes = new Set(Object.values(BOUNDARY_FAILURE_CODES));
	assert.equal(codes.size, 7, 'the seven documented failure classes');
	for (const code of codes) {
		assert.ok(BOUNDARY_FAILURE_CLASSES[code] !== undefined, `${code} must have semantics`);
		assert.ok(BOUNDARY_RETRY_HINTS.includes(BOUNDARY_FAILURE_CLASSES[code].retryHint));
		assert.equal(typeof BOUNDARY_FAILURE_CLASSES[code].retryable, 'boolean');
	}
	assert.equal(BOUNDARY_FAILURE_CLASSES[BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN].retryable, false, 'outcome-unknown is NEVER auto-retryable');
	assert.equal(BOUNDARY_FAILURE_CLASSES[BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN].retryHint, 'reconcile-then-new-attempt');
	assert.equal(BOUNDARY_FAILURE_CLASSES[BOUNDARY_FAILURE_CODES.SEAM_REJECTED].retryable, false, 'a definitive service answer is never retried');
	assert.equal(BOUNDARY_FAILURE_CLASSES[BOUNDARY_FAILURE_CODES.REQUEST_TIMEOUT].retryable, true, 'a read-only timeout carries the retry hook');
});

test('effect classes: read-only / idempotent / side-effecting (fail-closed default)', () => {
	assert.equal(seamMethodClass('flauz.workspace.createTask'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.workspace.appendEvent'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.workspace.appendEvidence'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.workspace.createCheckpoint'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.a2a.post'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.lifecycle.shutdown'), 'side-effecting');
	assert.equal(seamMethodClass('flauz.lifecycle.initialize'), 'idempotent', 'idempotent by seam contract');
	assert.equal(seamMethodClass('flauz.workspace.listTasks'), 'read-only');
	assert.equal(seamMethodClass('flauz.workspace.verifyLedger'), 'read-only');
	assert.equal(seamMethodClass('flauz.a2a.collect'), 'read-only');
	assert.equal(seamMethodClass('flauz.health.status'), 'read-only');
	assert.equal(seamMethodClass('ping'), 'read-only');
	assert.equal(seamMethodClass('flauz.nope'), 'side-effecting', 'unknown names default fail-closed');
});

test('method gate: registry-derived version gating + v1 capability advertisement', () => {
	// Unregistered name.
	const unregistered = gateSeamMethod('flauz.nope', SEAM_PROTOCOL_V1, V1_CAPABILITIES);
	assert.equal(unregistered.ok, false);
	assert.equal((unregistered as { failure: BoundaryFailure }).failure.code, BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE);
	assert.equal((unregistered as { failure: BoundaryFailure }).failure.details.reason, 'unregistered');

	// Registered v1 method under v0 negotiation: version-gated.
	const gated = gateSeamMethod('flauz.health.ping', SEAM_PROTOCOL_V0, []);
	assert.equal(gated.ok, false);
	assert.equal((gated as { failure: BoundaryFailure }).failure.details.reason, 'version-gated');
	assert.deepEqual((gated as { failure: BoundaryFailure }).failure.details.dispatchableAt, [SEAM_PROTOCOL_V1]);

	// v1 method under v1 with the real advertisement: ok.
	assert.equal(gateSeamMethod('flauz.health.ping', SEAM_PROTOCOL_V1, V1_CAPABILITIES).ok, true);

	// v0 method under v0: ok (no capability advertisement exists at v0).
	assert.equal(gateSeamMethod('flauz.workspace.createTask', SEAM_PROTOCOL_V0, []).ok, true);

	// The auth skeleton is never advertised at v1: locally refused, fail-closed.
	const auth = gateSeamMethod('flauz.auth.status', SEAM_PROTOCOL_V1, V1_CAPABILITIES);
	assert.equal(auth.ok, false);
	assert.equal((auth as { failure: BoundaryFailure }).failure.details.reason, 'not-advertised');
	assert.equal((auth as { failure: BoundaryFailure }).failure.details.namespace, 'flauz.auth');

	// Legacy ping/shutdown are exempt from the capability gate under v1.
	assert.equal(gateSeamMethod('ping', SEAM_PROTOCOL_V1, V1_CAPABILITIES).ok, true);
	assert.equal(gateSeamMethod('shutdown', SEAM_PROTOCOL_V1, V1_CAPABILITIES).ok, true);
});

test('failure classifier: every failure class has a firing case (fail-closed table)', () => {
	// v1 structured rejection -> seam-rejected with the machine-readable seam code.
	const rejected = classifySendFailure('flauz.nope', new SeamProtocolError('flauz.err.unknown-method', 'unknown command: flauz.nope', { method: 'flauz.nope' }));
	assert.equal(rejected.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
	assert.equal(rejected.details.seamCode, 'flauz.err.unknown-method');
	assert.equal(rejected.retryable, false);

	// Exit 4 -> protocol mismatch (the seam's own mismatch exit).
	const mismatch = classifySendFailure('ping', new Error('flauz core service exited early (code 4)'));
	assert.equal(mismatch.code, BOUNDARY_FAILURE_CODES.PROTOCOL_MISMATCH);
	assert.equal(mismatch.details.seamCode, 'flauz.err.unsupported-version');
	assert.equal(mismatch.retryable, false);

	// Response lost on a side-effecting method -> outcome-unknown, never retried.
	const unknown = classifySendFailure('flauz.workspace.createTask', new Error('flauz core service exited early (code null)'));
	assert.equal(unknown.code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
	assert.equal(unknown.retryHint, 'reconcile-then-new-attempt');
	assert.equal(unknown.retryable, false);

	// Response lost on a read-only method -> retryable service-died.
	const readonlyLost = classifySendFailure('flauz.workspace.listTasks', new Error('flauz core service exited early (code 1)'));
	assert.equal(readonlyLost.code, BOUNDARY_FAILURE_CODES.SERVICE_DIED);
	assert.equal(readonlyLost.retryable, true);

	// Send-time refusal (nothing was written) -> retryable service-died.
	const neverDelivered = classifySendFailure('flauz.workspace.createTask', new Error('cannot flauz.workspace.createTask: flauz core service has exited'));
	assert.equal(neverDelivered.code, BOUNDARY_FAILURE_CODES.SERVICE_DIED);
	assert.equal(neverDelivered.details.phase, 'never-delivered');
	assert.equal(neverDelivered.retryable, true);

	// Handshake never became ready.
	const handshake = classifySendFailure('ping', new Error('flauz core service did not become ready within 10000ms'));
	assert.equal(handshake.code, BOUNDARY_FAILURE_CODES.SERVICE_DIED);
	assert.equal(handshake.details.phase, 'handshake');

	// Timeout on a side-effecting vs read-only method.
	const timeoutEffect = classifySendFailure('flauz.workspace.appendEvidence', new Error('seam request flauz.workspace.appendEvidence timed out after 30000ms'));
	assert.equal(timeoutEffect.code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN);
	const timeoutRead = classifySendFailure('flauz.workspace.verifyLedger', new Error('seam request flauz.workspace.verifyLedger timed out after 30000ms'));
	assert.equal(timeoutRead.code, BOUNDARY_FAILURE_CODES.REQUEST_TIMEOUT);
	assert.equal(timeoutRead.retryable, true);

	// v0 plain-string rejection -> seam-rejected (definitive), code prefix parsed when present.
	const v0Unknown = classifySendFailure('flauz.workspace.getTask', new Error('unknown task: T-999'));
	assert.equal(v0Unknown.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
	assert.equal(v0Unknown.details.seamCode, null);
	const v0Auth = classifySendFailure('flauz.auth.login', new Error('flauz.err.not-implemented: flauz.auth.login is not implemented'));
	assert.equal(v0Auth.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
	assert.equal(v0Auth.details.seamCode, 'flauz.err.not-implemented');

	// Unclassified garbage: fail-closed in both directions.
	const garbageEffect = classifySendFailure('flauz.a2a.post', new Error('something unprecedented'));
	assert.equal(garbageEffect.code, BOUNDARY_FAILURE_CODES.OUTCOME_UNKNOWN, 'side-effecting + unclassified -> never auto-retry');
	const garbageRead = classifySendFailure('flauz.a2a.list', new Error('something unprecedented'));
	assert.equal(garbageRead.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
	assert.equal(garbageRead.retryable, false, 'read-only + unclassified -> definitive, no optimistic retry');
});

// ---------------------------------------------------------------------------------------
// PART C - the LIVE boundary against the REAL service (+ the frozen v0 stub).
// ---------------------------------------------------------------------------------------

test('start(): negotiate v1, affirm capabilities + lifecycle, expose supervision facts', async () => {
	const boundaryEvents: Array<{ boundaryEvent: string; payload: Record<string, unknown> }> = [];
	const seamEvents: Array<{ event: string; payload: Record<string, unknown> }> = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		onEvent: (event) => seamEvents.push({ event: event.event, payload: event.payload }),
		onBoundaryEvent: (record) => boundaryEvents.push({ boundaryEvent: record.boundaryEvent, payload: record.payload }),
	});
	try {
		assert.equal(boundary.protocolVersion, SEAM_PROTOCOL_V1);
		assert.deepEqual([...boundary.capabilities], ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace']);
		assert.equal(boundary.connected, true);
		assert.equal(typeof boundary.servicePid, 'number');
		assert.equal(boundary.generation, 1);

		// The start report carries the lifecycle affirmation (replay: false on a fresh session).
		assert.equal(boundary.startReport?.protocolVersion, SEAM_PROTOCOL_V1);
		assert.equal(boundary.startReport?.lifecycle?.initialized, true);
		assert.equal(boundary.startReport?.lifecycle?.replay, false);

		// Health wrappers work and report the negotiated posture.
		const ping = await boundary.healthPing();
		assert.equal(ping.protocolVersion, SEAM_PROTOCOL_V1);
		assert.equal(ping.pong, true);

		// describe() is the machine-readable diagnostic row.
		const described = boundary.describe();
		assert.equal(described.connected, true);
		assert.equal(described.generation, 1);
		assert.equal(described.eventsReceived, 0);

		// The 'connected' boundary observation fired exactly once.
		assert.deepEqual(boundaryEvents.map((record) => record.boundaryEvent), ['connected']);
	} finally {
		await boundary.shutdown();
	}
	assert.equal(boundary.connected, false);
});

test('golden Agent OS flow through the boundary: task, event, evidence, checkpoint, ledger, events, snapshot', async () => {
	const seamEvents: string[] = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		onEvent: (event) => seamEvents.push(event.event),
	});
	try {
		const { taskId } = await boundary.createTask('boundary golden flow');
		assert.equal(taskId, 'T-001');

		// submit-plan (agent) moves plan -> awaiting-approval (the 9-transition machine).
		const submitted = await boundary.appendEvent(taskId, { actor: 'agent', type: 'submit-plan', payload: {} });
		assert.equal(submitted.task.status, 'awaiting-approval');

		// Human approval -> execute.
		const approved = await boundary.appendEvent(taskId, { actor: 'human', type: 'approve', payload: {} });
		assert.equal(approved.task.status, 'execute');

		// Evidence + checkpoint through the boundary.
		const evidence = await boundary.appendEvidence(taskId, {
			kind: 'command-output',
			uri: '.flauz/artifacts/T-001/command-output-1.txt',
			sha256: sha256Of('boundary golden flow output'),
		});
		assert.equal(evidence.evidenceId, 'E-1');
		const checkpoint = await boundary.createCheckpoint(taskId, 'req-1');
		assert.ok(checkpoint.checkpointRef !== null && checkpoint.checkpointRef.startsWith('flauz-ckpt-'));

		// The ledger explains every appended row.
		const ledger = await boundary.verifyLedger();
		assert.deepEqual(ledger, { ok: true, rows: 1 });

		// Wire events: task-created, task-event x2, evidence-row, checkpoint.
		assert.deepEqual(seamEvents, ['task-created', 'task-event', 'task-event', 'evidence-row', 'checkpoint']);
		assert.equal(boundary.eventsReceived, 5);
		assert.ok(boundary.lastEventTs !== null);

		// The snapshot is the re-read logical state.
		const snapshot = await boundary.snapshot();
		assert.equal(snapshot.tasks.length, 1);
		assert.equal(snapshot.tasks[0].status, 'execute');
		assert.deepEqual(snapshot.ledger, { ok: true, rows: 1 });
		assert.deepEqual(snapshot.a2a, { agents: [] });
	} finally {
		await boundary.shutdown();
	}
});

test('a2a typed wrappers: post -> event -> list -> collect (the coordination surface)', async () => {
	const seamEvents: string[] = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		onEvent: (event) => seamEvents.push(event.event),
	});
	try {
		const posted = await boundary.a2aPost({
			kind: 'task-delegation',
			from: 'flauz.agent',
			to: 'flauz.agent.worker-1',
			payload: { taskId: 'T-001', taskDescription: 'delegated work', prompt: 'do the work' },
		});
		assert.equal(posted.id, 'M-000001');
		assert.equal(posted.seq, 1);
		assert.equal(posted.message.kind, 'task-delegation');

		const list = await boundary.a2aList();
		// The bus lists every agent seen in the journal; the sender has an
		// empty mailbox, the worker holds the posted message.
		assert.deepEqual(list.agents, [
			{ agentId: 'flauz.agent', pending: 0 },
			{ agentId: 'flauz.agent.worker-1', pending: 1 },
		]);

		const collected = await boundary.a2aCollect('flauz.agent.worker-1');
		assert.equal(collected.messages.length, 1);
		assert.equal(collected.messages[0].id, 'M-000001');

		assert.deepEqual(seamEvents, ['a2a-message']);
	} finally {
		await boundary.shutdown();
	}
});

test('idempotency memo: same key = same attempt (one wire effect, replayed outcome, standing verdicts)', async () => {
	const boundary = await AgentOsServiceBoundary.start({ workspaceRoot: makeWorkspace() });
	try {
		// Sequential replay: the second call with the same key resolves the
		// recorded outcome without a second wire effect.
		const first = await boundary.createTask('memo once', { idempotencyKey: 'flauz-orch/G-001/S-01/run/1' });
		const second = await boundary.createTask('memo once', { idempotencyKey: 'flauz-orch/G-001/S-01/run/1' });
		assert.equal(first.taskId, second.taskId);
		const tasks = await boundary.listTasks();
		assert.equal(tasks.tasks.length, 1, 'exactly one task exists - the key never double-applies');

		// In-flight dedup: two concurrent calls share ONE wire request.
		const [a, b] = await Promise.all([
			boundary.createTask('memo concurrent', { idempotencyKey: 'flauz-orch/G-001/S-02/run/1' }),
			boundary.createTask('memo concurrent', { idempotencyKey: 'flauz-orch/G-001/S-02/run/1' }),
		]);
		assert.equal(a.taskId, b.taskId);
		assert.equal((await boundary.listTasks()).tasks.length, 2);

		// A definitive rejection stands for the key (no re-send on re-call).
		const key = 'flauz-orch/G-001/S-03/run/1';
		await assert.rejects(() => boundary.createTask('', { idempotencyKey: key }), (failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
			assert.equal(boundaryFailure.details.seamCode, 'flauz.err.invalid-params');
			return true;
		});
		await assert.rejects(() => boundary.createTask('', { idempotencyKey: key }), (failure: unknown) => {
			assert.equal(asBoundary(failure).code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
			return true;
		});
		assert.equal((await boundary.listTasks()).tasks.length, 2, 'the rejected attempts created nothing');
	} finally {
		await boundary.shutdown();
	}
});

test('local gating through the live boundary: unregistered + unadvertised namespaces refuse before the wire', async () => {
	const boundary = await AgentOsServiceBoundary.start({ workspaceRoot: makeWorkspace() });
	try {
		await assert.rejects(() => boundary.call('flauz.nope'), (failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE);
			assert.equal(boundaryFailure.details.reason, 'unregistered');
			assert.equal(boundaryFailure.retryable, false);
			return true;
		});
		// The auth skeleton advertises nothing: locally refused under v1.
		await assert.rejects(() => boundary.call('flauz.auth.status'), (failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE);
			assert.equal(boundaryFailure.details.reason, 'not-advertised');
			return true;
		});
	} finally {
		await boundary.shutdown();
	}
});

test('v0-only service (frozen stub): v0 fallback, workspace surface, local v1 gating, v0 string rejections', async () => {
	const exits: Array<number | null> = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		servicePath: V0_SERVICE_PATH,
		affirmLifecycle: false,
		onExit: (code) => exits.push(code),
	});
	try {
		assert.equal(boundary.protocolVersion, SEAM_PROTOCOL_V0, 'the stub answers the plain v0 ready');
		assert.deepEqual([...boundary.capabilities], []);

		const { taskId } = await boundary.createTask('v0 fallback check');
		assert.equal(taskId, 'T-001');

		// The legacy ping is exempt from gating and works under v0.
		const pong = await boundary.call<{ pong: boolean }>('ping');
		assert.equal(pong.pong, true);

		// A v1 method is version-gated LOCALLY (registry truth, no round-trip).
		await assert.rejects(() => boundary.healthPing(), (failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE);
			assert.equal(boundaryFailure.details.reason, 'version-gated');
			return true;
		});

		// A v0 string rejection classifies as a definitive seam rejection.
		await assert.rejects(() => boundary.call('flauz.workspace.listTasks'), (failure: unknown) => {
			const boundaryFailure = asBoundary(failure);
			assert.equal(boundaryFailure.code, BOUNDARY_FAILURE_CODES.SEAM_REJECTED);
			assert.equal(boundaryFailure.details.seamCode, null, 'the v0 stub keeps plain string errors');
			return true;
		});
	} finally {
		await boundary.shutdown();
	}
	assert.deepEqual(exits, [0], 'the v0 stub exits 0 on the bare shutdown');
});

test('health watch: kill -> degraded observation -> explicit recovery restores service', async () => {
	const boundaryEvents: Array<{ boundaryEvent: string; payload: Record<string, unknown> }> = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		onBoundaryEvent: (record) => boundaryEvents.push({ boundaryEvent: record.boundaryEvent, payload: record.payload }),
	});
	const degraded = new Promise<BoundaryFailure>((resolve) => {
		boundary.startHealthPoll({ intervalMs: 20, onUnhealthy: (failure) => resolve(failure) });
	});
	try {
		// Kill the supervised process; the poll must observe and report.
		assert.equal(typeof boundary.servicePid, 'number');
		process.kill(boundary.servicePid as number, 'SIGKILL');
		const failure = await degraded;
		assert.equal(failure.code, BOUNDARY_FAILURE_CODES.NOT_CONNECTED);
		assert.equal(boundary.connected, false);

		// Calls short-circuit while dead.
		await assert.rejects(() => boundary.listTasks(), (error: unknown) => {
			assert.equal(asBoundary(error).code, BOUNDARY_FAILURE_CODES.NOT_CONNECTED);
			return true;
		});

		// Explicit recovery: re-spawn, re-hello, re-read.
		const report = await boundary.recover();
		assert.equal(report.generation, 2);
		assert.equal(report.protocolVersion, SEAM_PROTOCOL_V1);
		assert.equal(report.protocolVersionChanged, false);
		assert.equal(report.eventGap, true);
		assert.deepEqual(report.snapshot.ledger, { ok: true, rows: 0 });
		assert.equal(boundary.connected, true);
		assert.deepEqual(boundary.describe().generation, 2);

		// The boundary narrative is machine-readable.
		const names = boundaryEvents.map((record) => record.boundaryEvent);
		assert.ok(names.includes('disconnected'), 'the kill was observed');
		assert.ok(names.includes('event-gap'), 'the event gap is reported, never hidden');
		assert.ok(names.includes('reconnected'));
		assert.ok(names.includes('recovered'));

		// The recovered boundary serves the full surface again.
		const ping = await boundary.healthPing();
		assert.equal(ping.pong, true);
	} finally {
		await boundary.shutdown();
	}
});

test('shutdown: graceful lifecycle shutdown, idempotent, closed boundary refuses everything', async () => {
	const exits: Array<number | null> = [];
	const boundary = await AgentOsServiceBoundary.start({
		workspaceRoot: makeWorkspace(),
		onExit: (code) => exits.push(code),
	});
	await boundary.shutdown();
	await boundary.shutdown();
	assert.deepEqual(exits, [0], 'exactly one graceful exit');
	assert.equal(boundary.connected, false);
	await assert.rejects(() => boundary.listTasks(), (error: unknown) => {
		const failure = asBoundary(error);
		assert.equal(failure.code, BOUNDARY_FAILURE_CODES.NOT_CONNECTED);
		assert.equal(failure.details.phase, 'closed');
		return true;
	});
	await assert.rejects(() => boundary.recover(), (error: unknown) => {
		assert.equal(asBoundary(error).details.phase, 'closed');
		return true;
	});
});
