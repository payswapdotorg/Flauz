/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M5 - ADDITIVE protocol conformance for the Agent OS usage
 * patterns (every case extends test/protocol.conformance.test.ts, which
 * stays untouched and green; nothing here re-pins an existing case).
 *
 * New firing cases:
 *  - negotiation variants on the WIRE: mixed offers with unknown versions
 *    (highest MUTUAL wins), non-string entries filtered, and the
 *    DOWNGRADE re-hello (v1 session re-offered v0-only: byte-exact v0
 *    ready, v1 methods become unknown commands);
 *  - repeated hello re-handshake at v1: ready re-answered, version
 *    re-negotiated, the lifecycle initialize replay marker RESET, the
 *    workspace seam re-initialized from disk (state re-read);
 *  - shutdown ordering: a request batched AFTER a shutdown command in one
 *    write is still answered before the deferred exit (both the v1
 *    lifecycle twin and the v0 bare command), single exit 0;
 *  - event delivery: the FULL v1 event catalog with exact payloads, and
 *    the ordering guarantee the Agent OS consumes (the event line is
 *    written before the emitting request's response line);
 *  - version-gated method rejection: every v1-only method answers
 *    unknown-method under a v0 negotiation (the wire truth behind the
 *    adapter's local gate);
 *  - adapter gate == service dispatch: the registry-derived gate accepts
 *    every registered method at its versions and refuses everything else
 *    (pure), and every non-terminating registry method answers through
 *    the live v1 boundary (never method-unavailable).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AgentOsServiceBoundary, BoundaryFailure, BOUNDARY_FAILURE_CODES, gateSeamMethod } from '../core/serviceBoundary.mjs';
import { SEAM_METHODS, SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1, capabilitiesForVersion } from '../core/protocol.mjs';

const SERVICE_PATH = fileURLToPath(new URL('../core/service.mjs', import.meta.url));
const V0_READY_LINE = '{"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0"}';
const WAIT_MS = 5_000;

interface DeliveredLine {
	raw: string;
	message: Record<string, unknown>;
}

/** A spawned seam service speaking raw NDJSON over stdio (the conformance pattern). */
class ServiceProcess {
	private readonly child: ReturnType<typeof spawn>;
	private readonly pending: DeliveredLine[] = [];
	private readonly waiters: Array<{ predicate: (message: Record<string, unknown>) => boolean; resolve: (line: DeliveredLine) => void; timer: ReturnType<typeof setTimeout> }> = [];
	private readonly exitWaiters: Array<(code: number | null) => void> = [];
	readonly delivered: DeliveredLine[] = [];
	exitCode: number | null | undefined;
	private buffer = '';

	constructor(workspaceRoot: string) {
		this.child = spawn(process.execPath, [SERVICE_PATH, workspaceRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.stdout.setEncoding('utf-8');
		this.child.stdout.on('data', (chunk: { toString(encoding?: string): string }) => {
			this.buffer += chunk.toString();
			let newline = this.buffer.indexOf('\n');
			while (newline !== -1) {
				const line = this.buffer.slice(0, newline);
				this.buffer = this.buffer.slice(newline + 1);
				if (line.trim().length > 0) {
					this.deliver({ raw: line, message: JSON.parse(line) as Record<string, unknown> });
				}
				newline = this.buffer.indexOf('\n');
			}
		});
		this.child.on('close', (code: number | null) => {
			this.exitCode = code ?? null;
			for (const waiter of this.exitWaiters) {
				waiter(this.exitCode);
			}
			this.exitWaiters.length = 0;
		});
	}

	private deliver(line: DeliveredLine): void {
		this.delivered.push(line);
		const index = this.waiters.findIndex((waiter) => waiter.predicate(line.message));
		if (index !== -1) {
			const [waiter] = this.waiters.splice(index, 1);
			clearTimeout(waiter.timer);
			waiter.resolve(line);
		} else {
			this.pending.push(line);
		}
	}

	send(value: unknown): void {
		this.child.stdin.write(`${JSON.stringify(value)}\n`);
	}

	sendRaw(text: string): void {
		this.child.stdin.write(text);
	}

	async next(predicate: (message: Record<string, unknown>) => boolean, label: string): Promise<DeliveredLine> {
		const index = this.pending.findIndex((line) => predicate(line.message));
		if (index !== -1) {
			return this.pending.splice(index, 1)[0];
		}
		return new Promise<DeliveredLine>((resolve, reject) => {
			const timer = setTimeout(() => {
				const indexToRemove = this.waiters.findIndex((waiter) => waiter.timer === timer);
				if (indexToRemove !== -1) {
					this.waiters.splice(indexToRemove, 1);
				}
				reject(new Error(`timed out after ${WAIT_MS}ms waiting for: ${label}`));
			}, WAIT_MS);
			this.waiters.push({ predicate, resolve, timer });
		});
	}

	/** Index of the first delivered line matching the predicate (ordering proofs). */
	indexOf(predicate: (message: Record<string, unknown>) => boolean): number {
		return this.delivered.findIndex((line) => predicate(line.message));
	}

	async exited(): Promise<number | null> {
		if (this.exitCode !== undefined) {
			return this.exitCode;
		}
		return new Promise<number | null>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('timed out waiting for service exit')), WAIT_MS);
			this.exitWaiters.push((code: number | null) => {
				clearTimeout(timer);
				resolve(code);
			});
		});
	}

	kill(): void {
		if (this.exitCode === undefined) {
			this.child.kill('SIGKILL');
		}
	}
}

function makeWorkspace(): string {
	return mkdtempSync(join(tmpdir(), 'flauz-s1-conformance-'));
}

async function hello(proc: ServiceProcess, protocolVersions?: unknown[]): Promise<DeliveredLine> {
	const message: Record<string, unknown> = { type: 'hello', client: 'flauz-s1-conformance', version: '0.1.0' };
	if (protocolVersions !== undefined) {
		message.protocolVersions = protocolVersions;
	}
	proc.send(message);
	return proc.next((candidate) => candidate.type === 'ready' || candidate.type === 'error', 'ready or error');
}

let nextRequestId = 1;

async function request(proc: ServiceProcess, cmd: string, args?: Record<string, unknown>): Promise<DeliveredLine> {
	const id = nextRequestId++;
	proc.send({ id, cmd, args: args ?? {} });
	return proc.next((candidate) => candidate.id === id, `response for ${cmd}`);
}

// ---------------------------------------------------------------------------------------
// Negotiation variants on the wire (additive: the pure table exists; these fire on the wire).
// ---------------------------------------------------------------------------------------

test('wire negotiation: unknown entries are ignored while a mutual version remains (v0 ready byte-exact)', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		const ready = await hello(proc, ['flauz.seam/v99', 'flauz.seam/v2', SEAM_PROTOCOL_V0]);
		assert.equal(ready.raw, V0_READY_LINE, 'the highest MUTUAL version is v0 - the byte-exact v0 ready');
		const pong = await request(proc, 'ping');
		assert.equal(pong.message.ok, true);
	} finally {
		proc.kill();
	}
});

test('wire negotiation: non-string entries in the offer are filtered (v1 still negotiates)', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		const ready = await hello(proc, [42, true, null, SEAM_PROTOCOL_V1]);
		assert.equal(ready.message.protocolVersion, SEAM_PROTOCOL_V1);
		assert.deepEqual(ready.message.capabilities, ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace']);
	} finally {
		proc.kill();
	}
});

test('downgrade re-hello: a v1 session re-offered v0-only re-negotiates DOWN to the byte-exact v0 ready', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		const v1 = await hello(proc, [SEAM_PROTOCOL_V1, SEAM_PROTOCOL_V0]);
		assert.equal(v1.message.protocolVersion, SEAM_PROTOCOL_V1);

		const downgraded = await hello(proc, [SEAM_PROTOCOL_V0]);
		assert.equal(downgraded.raw, V0_READY_LINE, 'the re-hello negotiates v0 with byte-exact v0 bytes');

		// The session now speaks v0: a v1 method is an unknown command (string shape).
		const gated = await request(proc, 'flauz.health.ping');
		assert.equal(gated.message.ok, false);
		assert.equal(gated.message.error, 'unknown command: flauz.health.ping');

		// The v0 surface keeps working.
		const pong = await request(proc, 'ping');
		assert.equal(pong.message.ok, true);

		// And the session can climb back up.
		const up = await hello(proc, [SEAM_PROTOCOL_V1]);
		assert.equal(up.message.protocolVersion, SEAM_PROTOCOL_V1);
		const health = await request(proc, 'flauz.health.ping');
		assert.equal(health.message.ok, true);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Repeated hello re-handshake (v1) - the workspace seam re-initializes, replay marker resets.
// ---------------------------------------------------------------------------------------

test('repeated hello (v1): ready re-answered, lifecycle replay marker RESET, workspace state re-read from disk', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);

		const first = await request(proc, 'flauz.lifecycle.initialize');
		assert.equal((first.message.result as Record<string, unknown>).replay, false);
		const repeat = await request(proc, 'flauz.lifecycle.initialize');
		assert.equal((repeat.message.result as Record<string, unknown>).replay, true, 'same session: repeat call is a replay');

		// Side effect on the workspace AFTER the session started.
		const created = await request(proc, 'flauz.workspace.createTask', { title: 're-hello state check' });
		assert.equal((created.message.result as Record<string, unknown>).taskId, 'T-001');

		// The re-hello re-runs the whole handshake: fresh ready, replay
		// marker reset, workspace seam re-initialized (health sees the task).
		const reHello = await hello(proc, [SEAM_PROTOCOL_V1]);
		assert.equal(reHello.message.protocolVersion, SEAM_PROTOCOL_V1);
		const afterReHello = await request(proc, 'flauz.lifecycle.initialize');
		assert.equal((afterReHello.message.result as Record<string, unknown>).replay, false, 'a re-hello resets the replay marker');

		const status = await request(proc, 'flauz.health.status');
		assert.equal((status.message.result as Record<string, unknown>).tasks, 1, 'the re-initialized seam re-read the task from disk');
		assert.equal((status.message.result as Record<string, unknown>).ledgerRows, 0);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Shutdown ordering - a request batched after shutdown is answered before the deferred exit.
// ---------------------------------------------------------------------------------------

test('shutdown ordering (v1): a ping batched AFTER flauz.lifecycle.shutdown is answered, then one exit 0', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);
		proc.sendRaw(`${JSON.stringify({ id: 901, cmd: 'flauz.lifecycle.shutdown' })}\n${JSON.stringify({ id: 902, cmd: 'ping' })}\n`);
		const first = await proc.next((candidate) => candidate.id === 901, 'shutdown response');
		const second = await proc.next((candidate) => candidate.id === 902, 'post-shutdown ping response');
		assert.deepEqual([first.message.ok, first.message.result], [true, { ok: true, shuttingDown: true }]);
		assert.equal(second.message.ok, true, 'the batched post-shutdown request is answered before the deferred exit');
		assert.equal(await proc.exited(), 0);
	} finally {
		proc.kill();
	}
});

test('shutdown ordering (v0): the bare shutdown twin behaves identically', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		await hello(proc);
		proc.sendRaw(`${JSON.stringify({ id: 903, cmd: 'shutdown' })}\n${JSON.stringify({ id: 904, cmd: 'ping' })}\n`);
		const first = await proc.next((candidate) => candidate.id === 903, 'shutdown response');
		const second = await proc.next((candidate) => candidate.id === 904, 'post-shutdown ping response');
		assert.deepEqual([first.message.ok, first.message.result], [true, { ok: true }]);
		assert.equal(second.message.ok, true);
		assert.equal(await proc.exited(), 0);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Event delivery - the FULL v1 catalog, exact payloads, and the ordering guarantee.
// ---------------------------------------------------------------------------------------

test('event delivery (v1): the full catalog with exact payloads; each event line PRECEDES its emitting response', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);

		// task-created + ordering.
		const created = await request(proc, 'flauz.workspace.createTask', { title: 'event catalog' });
		const taskCreated = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'task-created', 'task-created event');
		assert.deepEqual(taskCreated.message.payload, { taskId: 'T-001' });
		assert.ok(
			proc.indexOf((message) => message.type === 'event' && message.event === 'task-created') < proc.indexOf((message) => message.id === created.message.id),
			'the task-created event line is written before the createTask response line',
		);

		// task-event.
		await request(proc, 'flauz.workspace.appendEvent', { taskId: 'T-001', event: { actor: 'agent', type: 'submit-plan', payload: {} } });
		const taskEvent = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'task-event', 'task-event event');
		assert.deepEqual(taskEvent.message.payload, { taskId: 'T-001', type: 'submit-plan', actor: 'agent', status: 'awaiting-approval' });

		// evidence-row.
		const sha256 = createHash('sha256').update('s1-conformance-evidence', 'utf-8').digest('hex');
		await request(proc, 'flauz.workspace.appendEvidence', { taskId: 'T-001', row: { kind: 'command-output', uri: '.flauz/artifacts/T-001/out.txt', sha256 } });
		const evidenceRow = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'evidence-row', 'evidence-row event');
		assert.deepEqual(evidenceRow.message.payload, { taskId: 'T-001', seq: 1, kind: 'command-output' });

		// checkpoint.
		await request(proc, 'flauz.workspace.createCheckpoint', { taskId: 'T-001', requestId: 's1-conformance' });
		const checkpoint = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'checkpoint', 'checkpoint event');
		const checkpointRef = (checkpoint.message.payload as Record<string, unknown>).checkpointRef as string;
		assert.equal(typeof checkpointRef, 'string');
		assert.ok(checkpointRef.startsWith('flauz-ckpt-'));

		// a2a-message.
		await request(proc, 'flauz.a2a.post', { message: { kind: 'task-delegation', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: { taskId: 'T-001', taskDescription: 'event catalog', prompt: 'do the work' } } });
		const a2aMessage = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'a2a-message', 'a2a-message event');
		assert.deepEqual(a2aMessage.message.payload, { id: 'M-000001', seq: 1, kind: 'task-delegation', from: 'flauz.agent', to: 'flauz.agent.worker-1' });

		// Every envelope keeps the stable key order.
		assert.deepEqual(Object.keys(taskCreated.message), ['type', 'event', 'payload', 'ts']);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Version-gated method rejection - every v1-only method under v0 (the wire truth).
// ---------------------------------------------------------------------------------------

test('version-gated rejection (v0): every v1-only method answers unknown-method in the v0 string shape', async () => {
	const proc = new ServiceProcess(makeWorkspace());
	try {
		await hello(proc);
		for (const method of ['flauz.health.ping', 'flauz.health.status', 'flauz.lifecycle.initialize', 'flauz.lifecycle.shutdown']) {
			const refused = await request(proc, method);
			assert.equal(refused.message.ok, false, `${method} must be gated under v0`);
			assert.equal(refused.message.error, `unknown command: ${method}`);
		}
		// The v0 surface itself keeps working.
		const pong = await request(proc, 'ping');
		assert.equal(pong.message.ok, true);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Adapter gate == service dispatch (registry consistency through the boundary).
// ---------------------------------------------------------------------------------------

test('adapter gate consistency: the gate mirrors registry x advertisement (pure)', () => {
	const AUTH = new Set(['flauz.auth.status', 'flauz.auth.login', 'flauz.auth.logout']);
	for (const [method, info] of Object.entries(SEAM_METHODS)) {
		for (const version of info.versions) {
			const verdict = gateSeamMethod(method, version, capabilitiesForVersion(version));
			if (AUTH.has(method) && version === SEAM_PROTOCOL_V1) {
				// The fail-closed auth skeleton advertises NOTHING: the gate
				// refuses it locally under v1 (more closed than the wire's
				// not-implemented answer, which the original suite pins).
				assert.equal(verdict.ok, false, `${method} must be locally refused (not-advertised) at v1`);
				if (!verdict.ok) {
					assert.equal((verdict as { failure: BoundaryFailure }).failure.details.reason, 'not-advertised');
				}
			} else {
				assert.equal(verdict.ok, true, `${method} must pass the gate at ${version}`);
			}
		}
		// At any OTHER known version the gate refuses (version-gated).
		for (const version of [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1]) {
			if (!info.versions.includes(version)) {
				const verdict = gateSeamMethod(method, version, []);
				assert.equal(verdict.ok, false, `${method} must be gated at ${version}`);
				if (!verdict.ok) {
					assert.equal((verdict as { failure: BoundaryFailure }).failure.details.reason, 'version-gated');
				}
			}
		}
	}
	// Unregistered names never pass.
	for (const method of ['flauz.nope', 'flauz.orch.appendStepRow', 'flauz.orch.recoveryScan']) {
		assert.equal(gateSeamMethod(method, SEAM_PROTOCOL_V1, capabilitiesForVersion(SEAM_PROTOCOL_V1)).ok, false, `${method} is not registered and must refuse`);
	}
});

test('adapter gate consistency (live): every non-terminating registry method answers through the v1 boundary', async () => {
	const workspace = makeWorkspace();
	const boundary = await AgentOsServiceBoundary.start({ workspaceRoot: workspace });
	try {
		// A task + an a2a message so the read methods have something to see.
		await boundary.createTask('registry consistency');
		const terminating = new Set(['shutdown', 'flauz.lifecycle.shutdown']);
		// The auth skeleton is registered but deliberately locally refused
		// under v1 (never advertised); the wire's not-implemented answer is
		// pinned by the original conformance suite, not re-driven here.
		const locallyRefused = new Set(['flauz.auth.status', 'flauz.auth.login', 'flauz.auth.logout']);
		for (const method of Object.keys(SEAM_METHODS)) {
			if (terminating.has(method) || locallyRefused.has(method)) {
				continue;
			}
			// The gate must NOT refuse; the service must NOT answer
			// unknown-method (the registry == dispatch law, through the
			// adapter). Business-level rejections (invalid params, the auth
			// skeleton's not-implemented on the wire) are definitive ANSWERS.
			try {
				await boundary.call(method, {});
			} catch (failure) {
				assert.ok(failure instanceof BoundaryFailure, `${method} surfaced a raw error (must be BoundaryFailure)`);
				const boundaryFailure = failure as BoundaryFailure;
				assert.notEqual(boundaryFailure.code, BOUNDARY_FAILURE_CODES.METHOD_UNAVAILABLE, `${method} is registered and must pass the gate at v1`);
				if (boundaryFailure.code === BOUNDARY_FAILURE_CODES.SEAM_REJECTED) {
					assert.notEqual(boundaryFailure.details.seamCode, 'flauz.err.unknown-method', `${method} is registered - the service must not answer unknown-method`);
				}
			}
		}
	} finally {
		await boundary.shutdown();
	}
});
