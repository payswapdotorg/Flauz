/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL1-003 protocol conformance: the versioned seam contract of
 * `core/protocol.mjs` proven against the REAL core service
 * (`core/service.mjs` spawned as a child process over stdio — the
 * seamClient.test.ts pattern) plus, for the backward-compat direction
 * "v1-capable client against a v0-only service", the frozen v0 stub at
 * `test/harness/v0Service.ts` (pinned from the TL1-003 base commit).
 *
 * Every rule of the protocol has a case that proves it fires:
 *  - negotiation (pure table + both wire directions + v0 fallback);
 *  - version-mismatch rejection (structured error + exit 4);
 *  - v0 handshake BYTE compatibility (raw line equality);
 *  - unknown-method / invalid-params / internal / not-implemented codes;
 *  - health ping/status; lifecycle initialize/shutdown idempotence;
 *  - event envelope shape on real relayed events (and NO wire events on v0);
 *  - malformed-line tolerance;
 *  - the registry == dispatch consistency.
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, match, rejects } from 'node:assert';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SeamClient, SeamProtocolError } from '../src/seamClient.ts';
import {
	AUTH_METHODS,
	SEAM_METHODS,
	SEAM_PROTOCOL_V0,
	SEAM_PROTOCOL_V1,
	negotiateProtocolVersion,
} from '../core/protocol.mjs';

const SERVICE_PATH = fileURLToPath(new URL('../core/service.mjs', import.meta.url));
const V0_SERVICE_PATH = fileURLToPath(new URL('./harness/v0Service.ts', import.meta.url));
const V0_READY_LINE = '{"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0"}';
const WAIT_MS = 5_000;

interface DeliveredLine {
	raw: string;
	message: Record<string, unknown>;
}

/** A spawned seam service speaking raw NDJSON over stdio (line-capturing). */
class ServiceProcess {
	private readonly child: ReturnType<typeof spawn>;
	private readonly pending: DeliveredLine[] = [];
	private readonly waiters: Array<{ predicate: (message: Record<string, unknown>) => boolean; resolve: (line: DeliveredLine) => void; timer: ReturnType<typeof setTimeout> }> = [];
	private readonly exitWaiters: Array<(code: number | null) => void> = [];
	readonly delivered: Record<string, unknown>[] = [];
	exitCode: number | null | undefined;
	private buffer = '';

	constructor(workspaceRoot: string, servicePath: string = SERVICE_PATH) {
		this.child = spawn(process.execPath, [servicePath, workspaceRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.stdout.setEncoding('utf-8');
		this.child.stdout.on('data', (chunk) => {
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
		this.child.on('close', (code) => {
			this.exitCode = code ?? null;
			for (const waiter of this.exitWaiters) {
				waiter(this.exitCode);
			}
			this.exitWaiters.length = 0;
		});
	}

	private deliver(line: DeliveredLine): void {
		this.delivered.push(line.message);
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

	async exited(): Promise<number | null> {
		if (this.exitCode !== undefined) {
			return this.exitCode;
		}
		return new Promise<number | null>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('timed out waiting for service exit')), WAIT_MS);
			this.exitWaiters.push((code) => {
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
	return mkdtempSync(join(tmpdir(), 'flauz-protocol-'));
}

async function hello(proc: ServiceProcess, protocolVersions?: string[]): Promise<DeliveredLine> {
	const message: Record<string, unknown> = { type: 'hello', client: 'flauz-conformance', version: '0.1.0' };
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

function structuredErrorOf(line: DeliveredLine): { code: string; message: string; details?: Record<string, unknown> } {
	const error = line.message.error;
	ok(error !== null && typeof error === 'object', `expected a structured error object, got: ${JSON.stringify(error)}`);
	return error as { code: string; message: string; details?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------------------
// Negotiation — the pure decision table (core/protocol.mjs).
// ---------------------------------------------------------------------------------------

test('negotiation table: absent/null/non-array -> v0; array -> highest mutual; no overlap -> structured rejection', () => {
	deepStrictEqual(negotiateProtocolVersion(undefined), { ok: true, version: SEAM_PROTOCOL_V0 });
	deepStrictEqual(negotiateProtocolVersion(null), { ok: true, version: SEAM_PROTOCOL_V0 });
	deepStrictEqual(negotiateProtocolVersion('flauz.seam/v1'), { ok: true, version: SEAM_PROTOCOL_V0 }, 'a non-array field is ignored (v0 assumed)');
	deepStrictEqual(negotiateProtocolVersion([SEAM_PROTOCOL_V1]), { ok: true, version: SEAM_PROTOCOL_V1 });
	deepStrictEqual(negotiateProtocolVersion([SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1]), { ok: true, version: SEAM_PROTOCOL_V1 }, 'highest supported wins');
	deepStrictEqual(negotiateProtocolVersion([SEAM_PROTOCOL_V1, SEAM_PROTOCOL_V0]), { ok: true, version: SEAM_PROTOCOL_V1 }, 'client list order is not significant');
	deepStrictEqual(negotiateProtocolVersion([SEAM_PROTOCOL_V0]), { ok: true, version: SEAM_PROTOCOL_V0 });
	deepStrictEqual(negotiateProtocolVersion(['flauz.seam/v99', SEAM_PROTOCOL_V0]), { ok: true, version: SEAM_PROTOCOL_V0 }, 'unknown entries are ignored when a supported one remains');
	deepStrictEqual(negotiateProtocolVersion([42, SEAM_PROTOCOL_V1]), { ok: true, version: SEAM_PROTOCOL_V1 }, 'non-string entries are filtered');

	for (const mismatch of [['flauz.seam/v99'], [], ['flauz.seam/v2', 'flauz.seam/v99']] as unknown[][]) {
		const verdict = negotiateProtocolVersion(mismatch);
		ok(!verdict.ok, `offering ${JSON.stringify(mismatch)} must be rejected`);
		if (!verdict.ok) {
			strictEqual(verdict.error.code, 'flauz.err.unsupported-version');
			deepStrictEqual(verdict.error.details?.['supported'], [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1]);
			deepStrictEqual(verdict.error.details?.['requested'], mismatch.filter((entry) => typeof entry === 'string'));
		}
	}
});

// ---------------------------------------------------------------------------------------
// v0 byte compatibility — a plain v0 hello against the NEW (v1-capable) service.
// ---------------------------------------------------------------------------------------

test('v0 handshake is byte-identical: plain hello -> exact v0 ready line, string errors, no wire events, exit 0', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		const ready = await hello(proc);
		strictEqual(ready.raw, V0_READY_LINE, 'the v0 ready line must be byte-identical (no extra fields, same key order)');
		strictEqual(ready.message.protocolVersion, undefined, 'a v0 ready carries NO protocolVersion field');

		const pong = await request(proc, 'ping');
		deepStrictEqual([pong.message.ok, (pong.message.result as Record<string, unknown>).pong], [true, true]);

		// v0 error shape: plain strings, exact legacy messages.
		const unknown = await request(proc, 'flauz.nope');
		strictEqual(unknown.message.error, 'unknown command: flauz.nope');

		// A v1-only method under v0 answers unknown-method in the v0 string shape.
		const gated = await request(proc, 'flauz.health.ping');
		strictEqual(gated.message.error, 'unknown command: flauz.health.ping');

		const created = await request(proc, 'flauz.workspace.createTask', { title: 'v0 byte check' });
		strictEqual((created.message.result as Record<string, unknown>).taskId, 'T-001');

		// Order the stream with a round-trip: by the time this response arrives,
		// any emitted event line would already have been delivered.
		await request(proc, 'ping');
		ok(!proc.delivered.some((message) => message.type === 'event'), 'v0 stdout carries ready/error/response lines only — no wire events');

		// The v1-capable service answers a v0-only offer with the plain v0 ready too.
		const reHello = await hello(proc, [SEAM_PROTOCOL_V0]);
		strictEqual(reHello.raw, V0_READY_LINE, 'an explicit v0-only offer still negotiates the byte-exact v0 ready');

		proc.send({ id: 900, cmd: 'shutdown' });
		const down = await proc.next((candidate) => candidate.id === 900, 'shutdown response');
		deepStrictEqual([down.message.ok, down.message.result], [true, { ok: true }]);
		strictEqual(await proc.exited(), 0, 'shutdown exits 0 exactly once');
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// v1 negotiation — the new client direction (SeamClient against the real service).
// ---------------------------------------------------------------------------------------

test('v1 negotiation (client direction): ready carries protocolVersion + capabilities; workspace methods unchanged; structured errors surface', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		strictEqual(client.protocolVersion, SEAM_PROTOCOL_V1);
		deepStrictEqual([...client.capabilities], ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace']);

		const { taskId } = await client.createTask('v1 negotiation check');
		strictEqual(taskId, 'T-001', 'the v0 method surface keeps working under v1');

		let caught: unknown;
		try {
			await client.request('flauz.nope');
		} catch (error) {
			caught = error;
		}
		ok(caught instanceof SeamProtocolError, 'a v1 unknown method rejects with SeamProtocolError');
		if (caught instanceof SeamProtocolError) {
			strictEqual(caught.code, 'flauz.err.unknown-method');
			strictEqual(caught.message, 'unknown command: flauz.nope');
			strictEqual(caught.details?.['method'], 'flauz.nope');
		}
	} finally {
		await client.dispose();
	}
});

test('v1 client against a v0-ONLY service (frozen stub): falls back to v0, keeps working, guards v1 wrappers', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace, servicePath: V0_SERVICE_PATH });
	try {
		strictEqual(client.protocolVersion, SEAM_PROTOCOL_V0, 'a ready without protocolVersion negotiates v0');
		deepStrictEqual([...client.capabilities], []);

		const { taskId } = await client.createTask('against the frozen v0 stub');
		strictEqual(taskId, 'T-001');
		const pong = await client.request<{ pong: boolean }>('ping');
		strictEqual(pong.pong, true);

		// v1 wrappers refuse to round-trip against a v0-only service.
		await rejects(() => client.healthPing(), /flauz\.health\.ping requires seam protocol flauz\.seam\/v1/);

		// v0 string errors stay plain Errors (no SeamProtocolError) against a v0 service.
		let caught: unknown;
		try {
			await client.request('flauz.nope');
		} catch (error) {
			caught = error;
		}
		ok(caught instanceof Error && !(caught instanceof SeamProtocolError));
		strictEqual((caught as Error).message, 'unknown command: flauz.nope');
	} finally {
		await client.dispose();
	}
});

// ---------------------------------------------------------------------------------------
// Version-mismatch rejection — structured error + exit 4.
// ---------------------------------------------------------------------------------------

test('version mismatch: hello offering nothing supported -> structured flauz.err.unsupported-version, exit 4', async () => {
	for (const offered of [['flauz.seam/v99'], [] as string[]]) {
		const workspace = makeWorkspace();
		const proc = new ServiceProcess(workspace);
		try {
			proc.send({ type: 'hello', client: 'flauz-conformance', version: '0.1.0', protocolVersions: offered });
			const failure = await proc.next((candidate) => candidate.type === 'error', `unsupported-version error for ${JSON.stringify(offered)}`);
			strictEqual(failure.message.code, 'flauz.err.unsupported-version');
			match(String(failure.message.message), /no mutually supported seam protocol version/);
			deepStrictEqual((failure.message.details as Record<string, unknown>).supported, [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1]);
			deepStrictEqual((failure.message.details as Record<string, unknown>).requested, offered);
			strictEqual(await proc.exited(), 4, 'the service exits 4 (SEAM_EXIT_PROTOCOL_MISMATCH)');
		} finally {
			proc.kill();
		}
	}
});

// ---------------------------------------------------------------------------------------
// Error codes — unknown-method, invalid-params, internal (v1 structured; v0 strings).
// ---------------------------------------------------------------------------------------

test('v1 error envelope: invalid-params (workspace validation) and internal (unexpected handler failure) carry codes + preserved messages', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		await hello(proc, [SEAM_PROTOCOL_V1, SEAM_PROTOCOL_V0]);

		const invalid = await request(proc, 'flauz.workspace.createTask', {});
		strictEqual(invalid.message.ok, false);
		const invalidError = structuredErrorOf(invalid);
		strictEqual(invalidError.code, 'flauz.err.invalid-params');
		strictEqual(invalidError.message, 'createTask requires a non-empty string title', 'the v0 message text is preserved inside the structured envelope');

		const internal = await request(proc, 'flauz.a2a.post', { message: { kind: 'gossip', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: {} } });
		strictEqual(internal.message.ok, false);
		const internalError = structuredErrorOf(internal);
		strictEqual(internalError.code, 'flauz.err.internal', 'a2a bus rejections classify as internal until the bus grows typed errors');
		match(internalError.message, /kind must be one of/);
	} finally {
		proc.kill();
	}
});

test('unknown-method under v1 is structured with the method detail; v1 methods are version-gated from v0', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);
		const unknown = await request(proc, 'flauz.definitely.not.real');
		const error = structuredErrorOf(unknown);
		strictEqual(error.code, 'flauz.err.unknown-method');
		strictEqual(error.message, 'unknown command: flauz.definitely.not.real');
		strictEqual(error.details?.['method'], 'flauz.definitely.not.real');

		const rawError = unknown.raw;
		ok(rawError.includes('"error":{"code":"flauz.err.unknown-method"'), 'the v1 error object serializes inside the response envelope');
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Health + lifecycle (v1) — via the typed client wrappers and on the raw wire.
// ---------------------------------------------------------------------------------------

test('health ping/status (v1): typed wrappers and the raw result shapes', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		const ping = await client.healthPing();
		strictEqual(ping.pong, true);
		strictEqual(ping.protocolVersion, SEAM_PROTOCOL_V1);
		ok(typeof ping.ts === 'number' && ping.uptimeMs >= 0);

		await client.createTask('health check task');
		const status = await client.healthStatus();
		strictEqual(status.status, 'ok');
		strictEqual(status.service, 'flauz-core-service');
		strictEqual(status.protocolVersion, SEAM_PROTOCOL_V1);
		strictEqual(status.tasks, 1);
		strictEqual(status.ledgerRows, 0);
		strictEqual(status.relay, false, 'no globalStoragePath in this session');
		ok(status.uptimeMs >= 0 && typeof status.serviceVersion === 'string');
	} finally {
		await client.dispose();
	}
});

test('lifecycle initialize is idempotent (replay marker) and reports live workspace state', async () => {
	const workspace = makeWorkspace();
	const client = await SeamClient.start({ workspaceRoot: workspace });
	try {
		const first = await client.lifecycleInitialize();
		strictEqual(first.initialized, true);
		strictEqual(first.replay, false);
		strictEqual(first.workspaceRoot, workspace);
		strictEqual(first.tasks, 0);

		await client.createTask('lifecycle check');
		const second = await client.lifecycleInitialize();
		strictEqual(second.initialized, true, 'initialize never fails on repeat');
		strictEqual(second.replay, true, 'a repeat call is an idempotent replay');
		strictEqual(second.tasks, 1, 'the replay reports live state');
	} finally {
		await client.dispose();
	}
});

test('lifecycle shutdown is graceful and idempotent: two back-to-back requests both answer ok, single exit 0', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);
		// Both requests in ONE write: the exit is deferred so the second line
		// must still be answered (idempotence under batched shutdowns).
		proc.sendRaw(`${JSON.stringify({ id: 801, cmd: 'flauz.lifecycle.shutdown' })}\n${JSON.stringify({ id: 802, cmd: 'flauz.lifecycle.shutdown' })}\n`);
		const first = await proc.next((candidate) => candidate.id === 801, 'first shutdown response');
		const second = await proc.next((candidate) => candidate.id === 802, 'second shutdown response');
		deepStrictEqual([first.message.ok, first.message.result], [true, { ok: true, shuttingDown: true }]);
		deepStrictEqual([second.message.ok, second.message.result], [true, { ok: true, shuttingDown: true }]);
		strictEqual(await proc.exited(), 0);
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Event envelope — server-initiated lines on real relayed events (v1 only).
// ---------------------------------------------------------------------------------------

test('event envelope (v1): real relayed events surface as {type:"event", event, payload, ts}; the v0 file relay keeps running', async () => {
	const workspace = makeWorkspace();
	const globalStorage = join(workspace, 'global-storage');
	mkdirSync(globalStorage, { recursive: true });
	const proc = new ServiceProcess(workspace);
	try {
		proc.send({ type: 'hello', client: 'flauz-conformance', version: '0.1.0', globalStoragePath: globalStorage, protocolVersions: [SEAM_PROTOCOL_V1] });
		await proc.next((candidate) => candidate.type === 'ready', 'v1 ready');

		const created = await request(proc, 'flauz.workspace.createTask', { title: 'event envelope check' });
		strictEqual((created.message.result as Record<string, unknown>).taskId, 'T-001');
		const created1 = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'task-created', 'task-created event');
		deepStrictEqual(Object.keys(created1.message), ['type', 'event', 'payload', 'ts'], 'stable key order: type, event, payload, ts');
		deepStrictEqual(created1.message.payload, { taskId: 'T-001' });
		ok(typeof created1.message.ts === 'number');

		const sha256 = createHash('sha256').update('flauz-conformance-evidence', 'utf-8').digest('hex');
		await request(proc, 'flauz.workspace.appendEvidence', { taskId: 'T-001', row: { kind: 'command-output', uri: '.flauz/artifacts/T-001/command-output-1.txt', sha256 } });
		const evidence = await proc.next((candidate) => candidate.type === 'event' && candidate.event === 'evidence-row', 'evidence-row event');
		deepStrictEqual(evidence.message.payload, { taskId: 'T-001', seq: 1, kind: 'command-output' });

		// The v0 file-based relay is unchanged and still written alongside the wire events.
		const relay = readFileSync(join(globalStorage, 'relay.jsonl'), 'utf-8');
		match(relay, /"topic":"task-created"/);
		match(relay, /"topic":"evidence-row"/);
	} finally {
		proc.kill();
	}
});

test('event envelopes reach the client onEvent callback (v1 client direction)', async () => {
	const workspace = makeWorkspace();
	const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
	const client = await SeamClient.start({
		workspaceRoot: workspace,
		onEvent: (envelope) => events.push({ event: envelope.event, payload: envelope.payload }),
	});
	try {
		await client.createTask('client event check');
		strictEqual(events.length, 1);
		strictEqual(events[0].event, 'task-created');
		deepStrictEqual(events[0].payload, { taskId: 'T-001' });
	} finally {
		await client.dispose();
	}
});

// ---------------------------------------------------------------------------------------
// Malformed-line tolerance — the service never dies on bad input.
// ---------------------------------------------------------------------------------------

test('malformed lines are tolerated: v1 answers structured parse errors, v0 answers the legacy shape, both keep serving', async () => {
	const workspace = makeWorkspace();
	const v1 = new ServiceProcess(workspace);
	try {
		await hello(v1, [SEAM_PROTOCOL_V1]);
		v1.sendRaw('this is not json\n');
		const unparseable = await v1.next((candidate) => candidate.type === 'error' && candidate.message === 'unparseable line', 'v1 unparseable line error');
		strictEqual(unparseable.message.code, 'flauz.err.invalid-params');
		v1.sendRaw('{"nonsense":true}\n');
		const unrecognized = await v1.next((candidate) => candidate.type === 'error' && candidate.message === 'unrecognized message', 'v1 unrecognized message error');
		strictEqual(unrecognized.message.code, 'flauz.err.invalid-params');
		const pong = await request(v1, 'ping');
		strictEqual(pong.message.ok, true, 'the service keeps serving after malformed input');
	} finally {
		v1.kill();
	}

	const v0Workspace = makeWorkspace();
	const v0 = new ServiceProcess(v0Workspace);
	try {
		await hello(v0);
		v0.sendRaw('still not json\n');
		const unparseable = await v0.next((candidate) => candidate.type === 'error', 'v0 unparseable line error');
		deepStrictEqual(unparseable.message, { type: 'error', message: 'unparseable line' }, 'the v0 error line keeps the exact legacy shape (no code field)');
		const pong = await request(v0, 'ping');
		strictEqual(pong.message.ok, true);
	} finally {
		v0.kill();
	}
});

// ---------------------------------------------------------------------------------------
// The auth skeleton — fail-closed at every version, no auth logic, no secrets.
// ---------------------------------------------------------------------------------------

test('flauz.auth.* is a fail-closed skeleton: structured not-implemented under v1, code-prefixed string under v0', async () => {
	const workspace = makeWorkspace();
	const v1 = new ServiceProcess(workspace);
	try {
		await hello(v1, [SEAM_PROTOCOL_V1]);
		for (const method of AUTH_METHODS) {
			const refused = await request(v1, method);
			strictEqual(refused.message.ok, false, `${method} must fail closed`);
			const error = structuredErrorOf(refused);
			strictEqual(error.code, 'flauz.err.not-implemented');
			match(error.message, /fail-closed skeleton/);
			strictEqual((error.details as Record<string, unknown>).namespace, 'flauz.auth');
			strictEqual((error.details as Record<string, unknown>).method, method);
		}
	} finally {
		v1.kill();
	}

	const v0Workspace = makeWorkspace();
	const v0 = new ServiceProcess(v0Workspace);
	try {
		await hello(v0);
		const refused = await request(v0, 'flauz.auth.login');
		strictEqual(refused.message.error, 'flauz.err.not-implemented: flauz.auth.login is not implemented: the flauz.auth namespace is a fail-closed skeleton (no token logic, no secrets; ARCHITECTURE-LOCK §3)', 'the v0 projection carries the machine-readable code prefix');
	} finally {
		v0.kill();
	}
});

test('handshake-first discipline: a request before hello is refused in the v0 string shape', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		const refused = await request(proc, 'flauz.health.ping');
		strictEqual(refused.message.error, 'service not ready: send hello first');
		const alive = await hello(proc);
		strictEqual(alive.message.type, 'ready', 'the service still completes the handshake afterwards');
	} finally {
		proc.kill();
	}
});

// ---------------------------------------------------------------------------------------
// Registry == dispatch consistency: every registered method is answerable (never
// unknown-method) at its versions. The two terminating methods are covered above.
// ---------------------------------------------------------------------------------------

test('method registry consistency: every non-terminating SEAM_METHODS entry answers on the v1 wire', async () => {
	const workspace = makeWorkspace();
	const proc = new ServiceProcess(workspace);
	try {
		await hello(proc, [SEAM_PROTOCOL_V1]);
		const terminating = new Set(['shutdown', 'flauz.lifecycle.shutdown']);
		const methods = Object.keys(SEAM_METHODS).filter((method) => !terminating.has(method));
		ok(methods.length >= 15, 'the registry covers the full dispatch surface');
		for (const method of methods) {
			const response = await request(proc, method, {});
			if (response.message.ok !== true) {
				const error = structuredErrorOf(response);
				ok(error.code !== 'flauz.err.unknown-method', `${method} is registered and must not answer unknown-method (got ${error.code})`);
			}
		}
	} finally {
		proc.kill();
	}
});
