/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * F-side client for the Flauz workspace seam service (`core/service.mjs`).
 *
 * Transport: the extension spawns the zero-dependency Node service and speaks
 * newline-delimited JSON over stdio. Handshake is `hello` -> `ready`; every
 * request carries a numeric id and is answered with `{id, ok, result|error}`.
 *
 * Protocol negotiation (TL1-003): the hello offers
 * `protocolVersions: ['flauz.seam/v1', 'flauz.seam/v0']`. A v1 service
 * answers ready with `protocolVersion` + `capabilities`; a v0-only service
 * ignores the field and answers the plain v0 ready, which the client takes
 * as `flauz.seam/v0` — v1 with v0 fallback, no retry needed. Under v1 the
 * service's errors become structured `{code, message, details?}` and are
 * surfaced as `SeamProtocolError` (an `Error` subclass — existing callers
 * reading `.message` keep working unchanged).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
	AppendEventResult,
	AppendEvidenceResult,
	CreateCheckpointResult,
	CreateTaskResult,
	GetTaskResult,
	ListTasksResult,
	TaskEvent,
	EvidenceRowInput,
	VerifyLedgerResult,
	SeamEventEnvelope,
	SeamHealthPingResult,
	SeamHealthStatusResult,
	SeamLifecycleInitializeResult,
	SeamLifecycleShutdownResult,
} from './types.ts';

export type SpawnFn = typeof spawn;

/** Protocol versions this client offers, highest first (v1 with v0 fallback). */
const OFFERED_PROTOCOL_VERSIONS: readonly string[] = ['flauz.seam/v1', 'flauz.seam/v0'];

/** Negotiated version assumed when the ready message carries no `protocolVersion` (a v0-only service). */
const DEFAULT_NEGOTIATED_PROTOCOL_VERSION = 'flauz.seam/v0';

/**
 * Rejection carrying a v1 structured seam error. `message` stays the plain
 * service message, so existing `.message` matching keeps working; `code`
 * (`flauz.err.*`) and `details` are the machine-readable additions.
 */
export class SeamProtocolError extends Error {
	readonly code: string;
	readonly details: Record<string, unknown> | undefined;

	constructor(code: string, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = 'SeamProtocolError';
		this.code = code;
		this.details = details;
	}
}

export interface SeamClientOptions {
	/** Absolute path of the workspace root the service should operate on. */
	workspaceRoot: string;
	/** Extension globalStorage path; the service relays events here (v0). */
	globalStoragePath?: string;
	/** Node binary used to spawn the service (defaults to process.execPath). */
	nodePath?: string;
	/** Path to core/service.mjs (defaults to the copy next to src/). */
	servicePath?: string;
	/** Injectable spawn for tests; defaults to node:child_process.spawn. */
	spawnFn?: SpawnFn;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	/** Diagnostic sink (output channel in production, console in tests). */
	logger?: (message: string) => void;
	/**
	 * v1+: receiver for server-initiated event envelopes
	 * (`{type:'event', event, payload, ts}`). v0 services never emit them;
	 * without a receiver they are logged and dropped.
	 */
	onEvent?: (event: SeamEventEnvelope) => void;
}

interface PendingRequest {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DISPOSE_TIMEOUT_MS = 5_000;

function defaultServicePath(): string {
	return fileURLToPath(new URL('../core/service.mjs', import.meta.url));
}

export class SeamClient {
	private readonly child;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly logger;
	private readonly requestTimeoutMs: number;
	private readonly onEventCallback: ((event: SeamEventEnvelope) => void) | undefined;
	private nextId = 1;
	private buffer = '';
	private readyPromise: Promise<void>;
	private exited = false;
	private exitCode: number | null = null;
	private exitError: Error | undefined;
	private exitWaiters: Array<(code: number | null) => void> = [];
	private negotiatedProtocolVersion = DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
	private negotiatedCapabilities: readonly string[] = [];

	private constructor(options: SeamClientOptions) {
		const spawnFn = options.spawnFn ?? spawn;
		const nodePath = options.nodePath ?? process.execPath;
		const servicePath = options.servicePath ?? defaultServicePath();
		this.logger = options.logger ?? (() => undefined);
		this.onEventCallback = options.onEvent;
		this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.child = spawnFn(nodePath, [servicePath, options.workspaceRoot], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.stdout.on('data', (chunk) => this.onStdout(chunk.toString('utf-8')));
		this.child.stderr.on('data', (chunk) => this.logger(`[flauz-core] ${chunk.toString('utf-8').trimEnd()}`));
		this.child.on('error', (error) => this.setExited(null, error));
		this.child.on('close', (code) => this.setExited(code));
		this.readyPromise = this.handshake(options);
	}

	static async start(options: SeamClientOptions): Promise<SeamClient> {
		const client = new SeamClient(options);
		await client.readyPromise;
		return client;
	}

	private handshake(options: SeamClientOptions): Promise<void> {
		const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
		return new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`flauz core service did not become ready within ${timeoutMs}ms`));
				void this.dispose();
			}, timeoutMs);
			timer.unref();
			this.readyCallbacks.push({ resolve, reject, timer });
			this.send({
				type: 'hello',
				client: 'flauz-agent',
				version: '0.1.0',
				globalStoragePath: options.globalStoragePath,
				// TL1-003: offer v1 with v0 fallback. A v0-only service ignores
				// the field (unknown hello keys are skipped) and answers the
				// plain v0 ready, which onReady takes as 'flauz.seam/v0'.
				protocolVersions: [...OFFERED_PROTOCOL_VERSIONS],
			});
		});
	}

	private readyCallbacks: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

	private onReady(message: { service?: string; schema?: string; protocolVersion?: unknown; capabilities?: unknown }): void {
		if (typeof message.protocolVersion === 'string' && message.protocolVersion.length > 0) {
			this.negotiatedProtocolVersion = message.protocolVersion;
		} else {
			this.negotiatedProtocolVersion = DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
		}
		if (Array.isArray(message.capabilities)) {
			this.negotiatedCapabilities = message.capabilities.filter((capability): capability is string => typeof capability === 'string');
		} else {
			this.negotiatedCapabilities = [];
		}
		this.logger(`[flauz-core] ready: ${String(message.service)} (${String(message.schema)}, ${this.negotiatedProtocolVersion})`);
		for (const callback of this.readyCallbacks) {
			clearTimeout(callback.timer);
			callback.resolve();
		}
		this.readyCallbacks = [];
	}

	/** Protocol version negotiated at the hello/ready handshake ('flauz.seam/v0' against a v0-only service). */
	get protocolVersion(): string {
		return this.negotiatedProtocolVersion;
	}

	/** Capability namespaces the service advertised in ready (v1+; empty for v0 services). */
	get capabilities(): readonly string[] {
		return this.negotiatedCapabilities;
	}

	private onStdout(text: string): void {
		this.buffer += text;
		let newline = this.buffer.indexOf('\n');
		while (newline !== -1) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (line.trim().length > 0) {
				this.handleLine(line);
			}
			newline = this.buffer.indexOf('\n');
		}
	}

	private handleLine(line: string): void {
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(line) as Record<string, unknown>;
		} catch {
			this.logger(`[flauz-core] unparseable line: ${line.slice(0, 120)}`);
			return;
		}
		if (message.type === 'ready') {
			this.onReady(message as { service?: string; schema?: string });
			return;
		}
		if (message.type === 'error') {
			this.logger(`[flauz-core] error: ${String(message.message)}`);
			return;
		}
		if (message.type === 'event' && typeof message.event === 'string') {
			// v1 server-initiated event envelope (tolerated — never fatal — under v0 clients too).
			const envelope: SeamEventEnvelope = {
				type: 'event',
				event: message.event,
				payload: (message.payload ?? {}) as Record<string, unknown>,
				ts: typeof message.ts === 'number' ? message.ts : Date.now(),
			};
			if (this.onEventCallback) {
				this.onEventCallback(envelope);
			} else {
				this.logger(`[flauz-core] event: ${envelope.event}`);
			}
			return;
		}
		const id = message.id;
		if (typeof id === 'number') {
			const pending = this.pending.get(id);
			if (!pending) {
				return;
			}
			this.pending.delete(id);
			clearTimeout(pending.timer);
			if (message.ok === true) {
				pending.resolve(message.result);
			} else {
				const failure = message.error;
				if (failure !== null && typeof failure === 'object' && typeof (failure as { code?: unknown }).code === 'string' && typeof (failure as { message?: unknown }).message === 'string') {
					// v1 structured error envelope: {code, message, details?}.
					const structured = failure as { code: string; message: string; details?: Record<string, unknown> };
					pending.reject(new SeamProtocolError(structured.code, structured.message, structured.details));
				} else {
					pending.reject(new Error(typeof failure === 'string' ? failure : 'unknown seam error'));
				}
			}
		}
	}

	private send(message: unknown): void {
		if (this.exited) {
			throw new Error('flauz core service has exited');
		}
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	/** Issue a seam request; rejects on error, timeout, or service exit. */
	request<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (this.exited) {
				reject(new Error(`cannot ${cmd}: flauz core service has exited`));
				return;
			}
			const id = this.nextId++;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`seam request ${cmd} timed out after ${this.requestTimeoutMs}ms`));
			}, this.requestTimeoutMs);
			timer.unref();
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
			try {
				this.send({ id, cmd, args: args ?? {} });
			} catch (error) {
				this.pending.delete(id);
				clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	// --- Typed convenience wrappers over the command seam (section H) ---

	createTask(title: string): Promise<CreateTaskResult> {
		return this.request<CreateTaskResult>('flauz.workspace.createTask', { title });
	}

	appendEvent(taskId: string, event: Omit<TaskEvent, 'ts'> & { ts?: number }): Promise<AppendEventResult> {
		return this.request<AppendEventResult>('flauz.workspace.appendEvent', { taskId, event });
	}

	listTasks(): Promise<ListTasksResult> {
		return this.request<ListTasksResult>('flauz.workspace.listTasks');
	}

	getTask(taskId: string): Promise<GetTaskResult> {
		return this.request<GetTaskResult>('flauz.workspace.getTask', { taskId });
	}

	appendEvidence(taskId: string, row: EvidenceRowInput): Promise<AppendEvidenceResult> {
		return this.request<AppendEvidenceResult>('flauz.workspace.appendEvidence', { taskId, row });
	}

	createCheckpoint(taskId: string, requestId: string, stopId?: string): Promise<CreateCheckpointResult> {
		return this.request<CreateCheckpointResult>('flauz.workspace.createCheckpoint', { taskId, requestId, stopId });
	}

	verifyLedger(): Promise<VerifyLedgerResult> {
		return this.request<VerifyLedgerResult>('flauz.workspace.verifyLedger');
	}

	// --- v1 protocol wrappers (health/lifecycle only; the flauz.auth skeleton
	// --- stays unwrapped by design — fail-closed, no client surface) ---

	/** `flauz.health.ping` (requires a v1 service; rejects locally against v0). */
	healthPing(): Promise<SeamHealthPingResult> {
		return this.requestV1<SeamHealthPingResult>('flauz.health.ping');
	}

	/** `flauz.health.status` (requires a v1 service; rejects locally against v0). */
	healthStatus(): Promise<SeamHealthStatusResult> {
		return this.requestV1<SeamHealthStatusResult>('flauz.health.status');
	}

	/** `flauz.lifecycle.initialize` — graceful and idempotent (requires a v1 service). */
	lifecycleInitialize(): Promise<SeamLifecycleInitializeResult> {
		return this.requestV1<SeamLifecycleInitializeResult>('flauz.lifecycle.initialize');
	}

	/** `flauz.lifecycle.shutdown` — graceful and idempotent (requires a v1 service). */
	lifecycleShutdown(): Promise<SeamLifecycleShutdownResult> {
		return this.requestV1<SeamLifecycleShutdownResult>('flauz.lifecycle.shutdown');
	}

	private requestV1<T>(cmd: string): Promise<T> {
		if (this.negotiatedProtocolVersion === DEFAULT_NEGOTIATED_PROTOCOL_VERSION) {
			return Promise.reject(new Error(`${cmd} requires seam protocol flauz.seam/v1 (negotiated: ${this.negotiatedProtocolVersion}; the service answered a v0-only ready)`));
		}
		return this.request<T>(cmd);
	}

	private setExited(code: number | null, error?: Error): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.exitCode = code;
		this.exitError = error;
		const failure = error ?? new Error(`flauz core service exited early (code ${String(code)})`);
		for (const callback of this.readyCallbacks) {
			clearTimeout(callback.timer);
			callback.reject(failure);
		}
		this.readyCallbacks = [];
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(failure);
		}
		this.pending.clear();
		for (const waiter of this.exitWaiters) {
			waiter(code);
		}
		this.exitWaiters = [];
	}

	private waitExit(): Promise<number | null> {
		if (this.exited) {
			return Promise.resolve(this.exitCode);
		}
		return new Promise((resolve) => {
			this.exitWaiters.push(resolve);
		});
	}

	/** Ask the service to shut down and await its exit (bounded wait). */
	async dispose(): Promise<void> {
		if (this.exited) {
			return;
		}
		try {
			await this.request('shutdown', {});
		} catch {
			// Best effort: fall through to ending stdin.
		}
		try {
			this.child.stdin.end();
		} catch {
			// Already closed.
		}
		let disposeTimer: ReturnType<typeof setTimeout> | undefined;
		const bounded = await Promise.race([
			this.waitExit(),
			new Promise<number | null>((resolve) => {
				disposeTimer = setTimeout(() => resolve(null), DISPOSE_TIMEOUT_MS);
				disposeTimer.unref();
			}),
		]);
		clearTimeout(disposeTimer);
		if (bounded === null && !this.exited) {
			this.child.kill();
		}
		if (this.exitError) {
			throw this.exitError;
		}
	}
}
