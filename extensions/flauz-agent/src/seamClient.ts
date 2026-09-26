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
} from './types.ts';

export type SpawnFn = typeof spawn;

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
	private nextId = 1;
	private buffer = '';
	private readyPromise: Promise<void>;
	private exited = false;
	private exitCode: number | null = null;
	private exitError: Error | undefined;
	private exitWaiters: Array<(code: number | null) => void> = [];

	private constructor(options: SeamClientOptions) {
		const spawnFn = options.spawnFn ?? spawn;
		const nodePath = options.nodePath ?? process.execPath;
		const servicePath = options.servicePath ?? defaultServicePath();
		this.logger = options.logger ?? (() => undefined);
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
			});
		});
	}

	private readyCallbacks: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

	private onReady(message: { service?: string; schema?: string }): void {
		this.logger(`[flauz-core] ready: ${String(message.service)} (${String(message.schema)})`);
		for (const callback of this.readyCallbacks) {
			clearTimeout(callback.timer);
			callback.resolve();
		}
		this.readyCallbacks = [];
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
				pending.reject(new Error(typeof message.error === 'string' ? message.error : 'unknown seam error'));
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
