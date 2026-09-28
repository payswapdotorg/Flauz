/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the LOCAL-REAL executor: real local processes, real fs snapshots.
 *
 * KIND BINDING DECISION (recorded in README + the delivery report): this
 * executor serves `workspace-remote` environments in a documented
 * LOCAL-LOOPBACK posture — the descriptor's authorityPrefix resolves (in this
 * lane) to a loopback agent-host stand-in implemented by the fixed harness
 * process, not a remote authority resolver. The v0 kind vocabulary is NOT
 * mutated; real resolvers/providers for all four kinds land in TL3-004. The
 * executor is ALSO kind-agnostic infrastructure: drills may pass a different
 * `kinds` list to reuse the process/snapshot machinery.
 *
 * INJECTION LAW (fail-closed): the executor spawns EXACTLY ONE executable —
 * the fixed `fixtures/env-agent.ts` harness shipped inside this extension —
 * with arguments the executor constructs itself (`--state-dir/--id/
 * --heartbeat-ms`). No descriptor-derived command, shell, script or arg ever
 * reaches the spawn surface (descriptors carry connection SHAPES only).
 *
 * Process law: pids are tracked in-memory (we only signal processes WE
 * spawned — an alive-but-unowned pid is an `orphan` verdict, never killed:
 * pid reuse could hit an innocent process); stop is graceful-then-SIGKILL
 * with a timeout and full reaping; destroy reaps defensively then removes
 * the per-env state dir.
 *
 * Ports (vscode-free core): LocalEnvFsPort, ProcessPort (the node port
 * implements the ELECTRON_RUN_AS_NODE=1-when-Electron pattern), HashPort.
 */
import { type Clock, type EnvironmentDescriptor, type EnvironmentKind, joinPath, serializeEnvelope } from '../api.ts';

import type { ExecutorOpContext, EnvironmentExecutor } from './executor.ts';
import type { DescribeVerdict, ExecutorEffectResult } from './types.ts';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** The fs surface the local executor needs (envelope port + dir listing + rm). */
export interface LocalEnvFsPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	readdir(path: string): Promise<string[]>;
	rm(path: string): Promise<void>;
}

/** A spawned child process (structural subset of node's ChildProcess). */
export interface ChildHandle {
	readonly pid: number | undefined;
	kill(signal?: string): void;
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'close', listener: (code: number | null) => void): void;
	readonly stdout: { on(event: 'data', listener: (chunk: { toString(encoding?: string): string }) => void): void } | null;
	readonly stdin: { write(chunk: string): boolean; end(): void } | null;
}

/**
 * The process port. `launchNodeProcess` runs a TypeScript harness under the
 * host's node binary — the node wiring sets `ELECTRON_RUN_AS_NODE=1` when
 * `process.execPath` is Electron (the standard extension-host pattern).
 */
export interface ProcessPort {
	launchNodeProcess(scriptPath: string, args: readonly string[], options?: { readonly env?: Record<string, string | undefined> }): ChildHandle;
	isPidAlive(pid: number): boolean;
}

/** Hash port for snapshot manifests (wired to node:crypto sha256). */
export interface HashPort {
	sha256Hex(contents: string): string;
}

// ---------------------------------------------------------------------------
// The executor
// ---------------------------------------------------------------------------

export const LOCAL_PROCESS_EXECUTOR_KIND = 'local-process';

/** Schema id pinned into snapshot manifests. */
export const SNAPSHOT_MANIFEST_SCHEMA_ID = 'flauz.env-snapshot-manifest/v0';

export interface LocalProcessExecutorOptions {
	/** Workspace root (the `.flauz` tree anchor). */
	readonly root: string;
	readonly fs: LocalEnvFsPort;
	readonly process: ProcessPort;
	readonly hash: HashPort;
	readonly clock?: Clock;
	/** ABSOLUTE path of the fixed harness (fixtures/env-agent.ts). */
	readonly harnessPath: string;
	/** Graceful-stop window before SIGKILL escalation (default 3000 ms). */
	readonly stopTimeoutMs?: number;
	/** Harness readiness window (default 5000 ms). */
	readonly startTimeoutMs?: number;
	/** Harness heartbeat cadence (default 500 ms). */
	readonly heartbeatMs?: number;
	/** Kinds served (default ['workspace-remote'] — the local-loopback binding). */
	readonly kinds?: readonly EnvironmentKind[];
	/** DRILL FLAG: spawn the harness with --ignore-termination (SIGKILL-escalation drills). */
	readonly ignoreTermination?: boolean;
}

interface SpawnedProcess {
	readonly pid: number;
	readonly handle: ChildHandle;
	readonly startedAt: number;
	exited: boolean;
}

interface HeldLease {
	readonly leaseId: string;
	readonly heldSince: number;
}

/** One entry of the snapshot manifest (files sorted by path). */
export interface SnapshotManifestFile {
	readonly bytes: number;
	readonly path: string;
	readonly sha256: string;
}

export interface SnapshotManifest {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly environmentId: string;
	readonly createdAt: number;
	readonly files: readonly SnapshotManifestFile[];
}

/** The harness `state.json` document (the backing truth). */
interface EnvStateFile {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly environmentId: string;
	readonly pid: number;
	readonly startedAt: number;
	readonly beat: number;
	readonly status: string;
	readonly stoppedAt?: number;
}

const ENV_STATE_SCHEMA_ID = 'flauz.env-state/v0';

function effectError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
	return { ok: false, error: { code, message } };
}

export class LocalProcessExecutor implements EnvironmentExecutor {
	readonly executorKind = LOCAL_PROCESS_EXECUTOR_KIND;
	readonly infrastructureClass = 'real' as const;
	readonly kinds: readonly EnvironmentKind[];
	private readonly root: string;
	private readonly fs: LocalEnvFsPort;
	private readonly process: ProcessPort;
	private readonly hash: HashPort;
	private readonly clock: Clock;
	private readonly harnessPath: string;
	private readonly stopTimeoutMs: number;
	private readonly startTimeoutMs: number;
	private readonly heartbeatMs: number;
	private readonly ignoreTermination: boolean;
	private readonly spawned = new Map<string, SpawnedProcess>();
	private readonly leases = new Map<string, HeldLease>();
	private leaseCounter = 0;

	constructor(options: LocalProcessExecutorOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.process = options.process;
		this.hash = options.hash;
		this.clock = options.clock ?? (() => Date.now());
		this.harnessPath = options.harnessPath;
		this.stopTimeoutMs = options.stopTimeoutMs ?? 3000;
		this.startTimeoutMs = options.startTimeoutMs ?? 5000;
		this.heartbeatMs = options.heartbeatMs ?? 500;
		this.ignoreTermination = options.ignoreTermination ?? false;
		this.kinds = options.kinds ?? ['workspace-remote'];
	}

	// -- paths ------------------------------------------------------------------

	private stateDirOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-state', envId);
	}

	private stateFileOf(envId: string): string {
		return joinPath(this.stateDirOf(envId), 'state.json');
	}

	private snapshotRootOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-snapshots', envId);
	}

	// -- ops --------------------------------------------------------------------

	async create(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const stateDir = this.stateDirOf(descriptor.id);
		await this.fs.mkdir(stateDir);
		return { ok: true, detail: { type: 'create', stateDir } };
	}

	async start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const existing = this.spawned.get(descriptor.id);
		if (existing !== undefined && !existing.exited) {
			return effectError('ALREADY_RUNNING', `environment '${descriptor.id}' already has a live harness process (pid ${existing.pid})`);
		}
		const stateDir = this.stateDirOf(descriptor.id);
		await this.fs.mkdir(stateDir);
		const harnessArgs = [
			'--state-dir', stateDir,
			'--id', descriptor.id,
			'--heartbeat-ms', String(this.heartbeatMs),
		];
		if (this.ignoreTermination) {
			harnessArgs.push('--ignore-termination');
		}
		const handle = this.process.launchNodeProcess(this.harnessPath, harnessArgs, { env: { FLAUZ_ENV_ID: descriptor.id } });
		handle.on('error', () => undefined); // surfaced via the readiness race below
		const pid = handle.pid;
		if (pid === undefined) {
			return effectError('START_FAILED', `harness spawn for '${descriptor.id}' returned no pid (spawn error)`);
		}
		const ready = await this.awaitReady(handle, this.startTimeoutMs);
		if (!ready.ok) {
			// never leave a half-started child behind
			try { handle.kill('SIGKILL'); } catch { /* already gone */ }
			return effectError('START_FAILED', `harness for '${descriptor.id}' did not report ready: ${ready.reason}`);
		}
		this.spawned.set(descriptor.id, { pid, handle, startedAt: ctx.now, exited: false });
		handle.on('close', () => {
			const tracked = this.spawned.get(descriptor.id);
			if (tracked !== undefined && tracked.handle === handle) {
				tracked.exited = true;
			}
		});
		return { ok: true, detail: { type: 'start', pid } };
	}

	async stop(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const tracked = this.spawned.get(descriptor.id);
		if (tracked !== undefined && !tracked.exited) {
			const forced = await this.terminateAndReap(tracked);
			return { ok: true, detail: { type: 'stop', pid: tracked.pid, forcedSignal: forced } };
		}
		// not spawned by this instance: reconcile against the backing truth
		const state = await this.readStateFile(descriptor.id);
		if (state === undefined) {
			return { ok: true, detail: { type: 'stop', pid: null, forcedSignal: null } };
		}
		if (this.process.isPidAlive(state.pid)) {
			return effectError('PROCESS_NOT_OWNED', `environment '${descriptor.id}' backing pid ${state.pid} is alive but was not spawned by this executor instance — refusing to signal a process we do not own (orphan; kill it manually, then retry)`);
		}
		return { ok: true, detail: { type: 'stop', pid: state.pid, forcedSignal: null } };
	}

	async attach(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		this.leaseCounter += 1;
		const leaseId = `lease-${descriptor.id}-${this.leaseCounter}`;
		const heldSince = ctx.now;
		this.leases.set(descriptor.id, { leaseId, heldSince });
		return { ok: true, detail: { type: 'attach', leaseId, heldSince } };
	}

	async detach(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const lease = this.leases.get(descriptor.id);
		if (lease === undefined) {
			return effectError('NO_LEASE', `environment '${descriptor.id}' holds no connection lease`);
		}
		this.leases.delete(descriptor.id);
		return { ok: true, detail: { type: 'detach', leaseId: lease.leaseId } };
	}

	async snapshot(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const stateDir = this.stateDirOf(descriptor.id);
		let files: string[];
		try {
			files = (await this.fs.readdir(stateDir)).filter(name => name.endsWith('.json')).sort();
		} catch {
			return effectError('NO_STATE_DIR', `environment '${descriptor.id}' has no state directory to snapshot (${stateDir})`);
		}
		if (files.length === 0) {
			return effectError('NO_STATE_DIR', `environment '${descriptor.id}' state directory is empty (${stateDir})`);
		}
		const snapshotDir = joinPath(this.snapshotRootOf(descriptor.id), String(ctx.now));
		await this.fs.mkdir(snapshotDir);
		const manifestFiles: SnapshotManifestFile[] = [];
		for (const name of files) {
			const contents = await this.fs.readFileUtf8(joinPath(stateDir, name));
			if (contents === undefined) {
				return effectError('SNAPSHOT_READ_FAILED', `state file '${name}' vanished during the snapshot of '${descriptor.id}'`);
			}
			await this.fs.writeFile(joinPath(snapshotDir, name), contents);
			manifestFiles.push({ bytes: contents.length, path: name, sha256: this.hash.sha256Hex(contents) });
		}
		const manifest: SnapshotManifest = {
			schemaVersion: 0,
			schema: SNAPSHOT_MANIFEST_SCHEMA_ID,
			environmentId: descriptor.id,
			createdAt: ctx.now,
			files: manifestFiles,
		};
		const manifestPath = joinPath(snapshotDir, 'manifest.json');
		await this.fs.writeFile(manifestPath, serializeEnvelope(manifest));
		return { ok: true, detail: { type: 'snapshot', snapshotDir, fileCount: manifestFiles.length, manifestPath } };
	}

	async destroy(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		let pid: number | null = null;
		const tracked = this.spawned.get(descriptor.id);
		if (tracked !== undefined && !tracked.exited) {
			pid = tracked.pid;
			await this.terminateAndReap(tracked);
			this.spawned.delete(descriptor.id);
		} else {
			const state = await this.readStateFile(descriptor.id);
			if (state !== undefined) {
				pid = state.pid;
				if (this.process.isPidAlive(state.pid)) {
					return effectError('PROCESS_NOT_OWNED', `environment '${descriptor.id}' backing pid ${state.pid} is alive but was not spawned by this executor instance — refusing to signal a process we do not own (orphan; kill it manually, then retry destroy)`);
				}
			}
		}
		this.leases.delete(descriptor.id);
		try {
			await this.fs.rm(this.stateDirOf(descriptor.id));
		} catch {
			// state dir already gone — destroy is idempotent
		}
		return { ok: true, detail: { type: 'destroy', pid } };
	}

	async probe(descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> {
		const lease = this.leases.get(descriptor.id);
		const leasePayload = lease === undefined ? undefined : { leaseId: lease.leaseId, heldSince: lease.heldSince };
		const state = await this.readStateFile(descriptor.id);
		if (state === undefined) {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: null,
				message: `no backing state file for '${descriptor.id}' (never started, or cleaned up)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (state.status === 'stopped') {
			// the harness records a clean shutdown — a dead pid here is a STOP, not a crash
			return {
				health: 'not-running',
				state: 'stopped',
				pid: state.pid,
				message: `harness for '${descriptor.id}' shut down cleanly at epoch ${state.stoppedAt ?? 'unknown'}`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (!this.process.isPidAlive(state.pid)) {
			return {
				health: 'stale',
				state: 'stopped',
				pid: state.pid,
				message: `backing process ${state.pid} for '${descriptor.id}' is gone while its state still claims running (crash reconciliation — the lifecycle state outruns the truth)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const tracked = this.spawned.get(descriptor.id);
		if (tracked === undefined || tracked.exited || tracked.pid !== state.pid) {
			return {
				health: 'orphan',
				state: 'running',
				pid: state.pid,
				message: `backing pid ${state.pid} for '${descriptor.id}' is alive but was not spawned by this executor instance (host restart or pid reuse) — never treated as healthy`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		return {
			health: 'healthy',
			state: 'running',
			pid: state.pid,
			message: `harness process ${state.pid} for '${descriptor.id}' is live (beat ${state.beat})`,
			...(leasePayload === undefined ? {} : { lease: leasePayload }),
		};
	}

	// -- internals ----------------------------------------------------------------

	private async readStateFile(envId: string): Promise<EnvStateFile | undefined> {
		const raw = await this.fs.readFileUtf8(this.stateFileOf(envId));
		if (raw === undefined) {
			return undefined;
		}
		try {
			const value = JSON.parse(raw) as Partial<EnvStateFile> & Record<string, unknown>;
			if (value.schema !== ENV_STATE_SCHEMA_ID || typeof value.pid !== 'number') {
				return undefined;
			}
			return value as EnvStateFile;
		} catch {
			return undefined; // unreadable truth reads as gone (stale), never healthy
		}
	}

	/** Graceful SIGTERM -> timeout -> SIGKILL -> reap. Returns the forced signal. */
	private async terminateAndReap(tracked: SpawnedProcess): Promise<'SIGTERM' | 'SIGKILL'> {
		try { tracked.handle.kill('SIGTERM'); } catch { /* already gone */ }
		if (await this.waitExit(tracked, this.stopTimeoutMs)) {
			return 'SIGTERM';
		}
		try { tracked.handle.kill('SIGKILL'); } catch { /* already gone */ }
		await this.waitExit(tracked, 1000);
		return 'SIGKILL';
	}

	private waitExit(tracked: SpawnedProcess, timeoutMs: number): Promise<boolean> {
		if (tracked.exited) {
			return Promise.resolve(true);
		}
		return new Promise(resolve => {
			let settled = false;
			const finish = (outcome: boolean) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				resolve(outcome);
			};
			const timer = setTimeout(() => finish(tracked.exited), timeoutMs);
			tracked.handle.on('close', () => {
				tracked.exited = true;
				finish(true);
			});
			tracked.handle.on('error', () => finish(tracked.exited));
		});
	}

	/** Resolves when the harness emits its stdio `ready` line (or fails). */
	private awaitReady(handle: ChildHandle, timeoutMs: number): Promise<{ ok: true } | { ok: false; reason: string }> {
		return new Promise(resolve => {
			let settled = false;
			let buffer = '';
			const finish = (outcome: { ok: true } | { ok: false; reason: string }) => {
				if (settled) { return; }
				settled = true;
				clearTimeout(timer);
				resolve(outcome);
			};
			const timer = setTimeout(() => finish({ ok: false, reason: `no ready line within ${timeoutMs} ms` }), timeoutMs);
			handle.on('close', code => finish({ ok: false, reason: `harness exited before ready (code ${code})` }));
			handle.on('error', err => finish({ ok: false, reason: `spawn error: ${err.message}` }));
			if (handle.stdout === null) {
				finish({ ok: false, reason: 'harness spawned without a stdout pipe' });
				return;
			}
			handle.stdout.on('data', (chunk: { toString(encoding?: string): string }) => {
				buffer += chunk.toString('utf-8');
				let newline = buffer.indexOf('\n');
				while (newline !== -1) {
					const line = buffer.slice(0, newline).trim();
					buffer = buffer.slice(newline + 1);
					if (line.length > 0) {
						try {
							const event = JSON.parse(line) as { type?: string; pid?: number };
							if (event.type === 'ready') {
								finish({ ok: true });
								return;
							}
							if (event.type === 'error') {
								finish({ ok: false, reason: `harness protocol error: ${JSON.stringify(event)}` });
								return;
							}
						} catch {
							// non-JSON stdout noise is ignored
						}
					}
					newline = buffer.indexOf('\n');
				}
			});
		});
	}
}
