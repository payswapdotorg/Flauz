/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — `DockerCliExecutor` (executorKind `docker-cli`, kind
 * `container`).
 *
 * REAL lifecycle over the SYSTEM `docker` CLI, entirely through the `CliPort`
 * seam (cliPort.ts — the discipline point; `FakeCli` scripts it in tests):
 *
 *   - capability probe : `docker info` — binary absent (spawnError) is the
 *     typed fail-closed `CLI_NOT_AVAILABLE`; binary present but daemon down
 *     (the common dev-box case) is the typed `DAEMON_UNREACHABLE` — a clean
 *     typed error surfaced through the command surface, never a raw throw.
 *   - create            : probe + validation of the descriptor's container
 *     connection shape (data fields only).
 *   - start             : `docker run -d --name flauz-<envId> <image>
 *     tail -f /dev/null` holds the container up; the FIXED harness
 *     (`fixtures/env-agent.ts`, written to a temp file under `.flauz/`)
 *     ships in via `docker cp`; `docker exec -d <cid> sh -c 'tail -f
 *     /dev/null | node /flauz/env-agent.ts --state-dir /flauz/env-state
 *     --id <id> --heartbeat-ms <n> > /flauz/harness.out 2>&1'` runs it.
 *     The stdin pipe-holder (`tail -f /dev/null |`) is REQUIRED: the fixed
 *     harness exits cleanly when its stdin reaches EOF (its "parent went
 *     away" law), and `docker exec -d` provides no interactive stdin — a
 *     never-EOF pipe is the honest way to keep the fixed program alive
 *     unmodified. Plain `node` inside the container (the ELECTRON_RUN_AS_NODE
 *     note does not apply there); the harness pid is read from its own stdio
 *     protocol (`/flauz/harness.out`) — the same protocol the local executor
 *     reads off its child's stdout.
 *   - stop              : graceful `docker exec kill -15` on the OWNED
 *     harness pid (the harness's SIGTERM protocol writes its final stopped
 *     state), `kill -9` escalation after the grace window; then the blessed
 *     container-level `docker stop --time <grace>` (which also tears down
 *     the keep-alive holder; documented escalation: docker stop's own
 *     SIGTERM-to-PID-1 + SIGKILL path). Foreign (not started by this
 *     instance) harness pids are NEVER signalled directly — the
 *     never-signal-foreign-pids law; the container-scoped `docker stop`
 *     remains the honest recovery tool (the pid namespace bounds the blast
 *     radius — it cannot hit host processes).
 *   - snapshot          : `docker cp <cid>:/flauz/env-state/state.json
 *     <snapshotDir>` -> the SAME canonical `manifest.json` (sha256 per
 *     file, `flauz.env-snapshot-manifest/v0`) as the local executor.
 *   - destroy           : stop-then-remove (`docker stop --time <grace>` +
 *     `docker rm`, `docker rm -f` escalation on races), idempotent for a
 *     container that is already gone.
 *   - probe (describe)  : crash reconciliation against REAL `docker inspect`
 *     state — container gone / exited while the lifecycle claims running =>
 *     `stale` (never silently healthy); the harness pid alive-but-not-ours
 *     => `orphan`; the harness dead inside a running container => `stale`.
 *
 * INJECTION LAW: argv tokens are executor-constructed ONLY — the v0
 * `ContainerConnection` carries `workspaceFolder`/`name`/`devcontainerConfig`
 * (data; `workspaceFolder`/`devcontainerConfig` are NOT used as command
 * paths) and NO image field (the shape is pinned, DL-29). The IMAGE is an
 * executor option with a pinned safe default (`node:24-alpine` — node
 * >= 23.6 so the fixed harness type-strips inside the container); container
 * names derive from the registry-validated env id `[a-z0-9-]`. The ONLY
 * program ever run inside the container is the FIXED harness (plus its
 * `tail -f /dev/null` stdin holder); descriptor-supplied execution is
 * forbidden, fail-closed against injection.
 */
import { joinPath, serializeEnvelope, type Clock } from '../api.ts';
import type { EnvironmentDescriptor, EnvironmentKind } from '../api.ts';
import type { ExecutorOpContext, EnvironmentExecutor } from './executor.ts';
import type { DescribeVerdict, ExecutorEffectResult } from './types.ts';
import { excerpt, parseHarnessStdio, type CliPort } from './cliPort.ts';
import type { HashPort, LocalEnvFsPort, SnapshotManifest, SnapshotManifestFile } from './localProcess.ts';

export const DOCKER_CLI_EXECUTOR_KIND = 'docker-cli';

/** Schema id pinned into snapshot manifests (same as the local executor). */
export const DOCKER_SNAPSHOT_MANIFEST_SCHEMA_ID = 'flauz.env-snapshot-manifest/v0';

/** Fixed in-container paths (the executor's own state root, not descriptor text). */
export const DOCKER_CONTAINER_STATE_DIR = '/flauz/env-state';
const DOCKER_CONTAINER_SCRIPT = '/flauz/env-agent.ts';
const DOCKER_CONTAINER_LOG = '/flauz/harness.out';

const CONTAINER_ID_PATTERN = /^[0-9a-f]{12,64}$/;

export interface DockerCliExecutorOptions {
	readonly root: string;
	/** The process seam — every docker invocation goes through it. */
	readonly cli: CliPort;
	/** Local fs (harness read + temp file + snapshot writes). */
	readonly fs: LocalEnvFsPort;
	readonly hash: HashPort;
	readonly clock?: Clock;
	/** ABSOLUTE path of the fixed harness (fixtures/env-agent.ts). */
	readonly harnessPath: string;
	/** Image the harness runs in (v0 descriptors carry no image field — pinned shape, DL-29). */
	readonly image?: string;
	/** Harness readiness window (default 20 000). */
	readonly startTimeoutMs?: number;
	/** Graceful kill -15 window before kill -9 escalation (default 5 000). */
	readonly stopTimeoutMs?: number;
	/** `docker stop --time` grace in seconds (default 10). */
	readonly stopGraceSeconds?: number;
	/** Readiness/liveness poll cadence (default 100). */
	readonly pollIntervalMs?: number;
	/**
	 * Latency cue — how poll-loop waits pass time (default: real
	 * setTimeout). The test rigs inject a virtual-time cue that ADVANCES
	 * the injected clock, so every readiness/stop window terminates in
	 * bounded iterations with ZERO wall-clock waiting — a test never
	 * depends on a real readiness window.
	 */
	readonly latency?: (ms: number) => Promise<void>;
	/** Per-invocation wall-clock budget (default 120 000 — first run may pull the image). */
	readonly commandTimeoutMs?: number;
	/** Kinds served (default ['container']). */
	readonly kinds?: readonly EnvironmentKind[];
}

/** The harness `state.json` document (the in-container backing truth). */
interface ContainerEnvState {
	readonly schema: string;
	readonly environmentId: string;
	readonly pid: number;
	readonly beat: number;
	readonly status: string;
	readonly stoppedAt?: number;
}

/** The `docker inspect` shape subset the executor consumes. */
interface InspectReport {
	readonly Id: string;
	readonly State: { readonly Running: boolean; readonly Status: string };
}

interface OwnedContainer {
	readonly containerId: string;
	readonly pid: number;
	readonly startedAt: number;
}

interface HeldLease {
	readonly leaseId: string;
	readonly heldSince: number;
}

function effectError(code: string, message: string): { ok: false; error: { code: string; message: string } } {
	return { ok: false, error: { code, message } };
}

export class DockerCliExecutor implements EnvironmentExecutor {
	readonly executorKind = DOCKER_CLI_EXECUTOR_KIND;
	readonly infrastructureClass = 'real' as const;
	readonly kinds: readonly EnvironmentKind[];
	private readonly root: string;
	private readonly cli: CliPort;
	private readonly fs: LocalEnvFsPort;
	private readonly hash: HashPort;
	private readonly clock: Clock;
	private readonly harnessPath: string;
	private readonly image: string;
	private readonly startTimeoutMs: number;
	private readonly stopTimeoutMs: number;
	private readonly stopGraceSeconds: number;
	private readonly pollIntervalMs: number;
	private readonly latency: (ms: number) => Promise<void>;
	private readonly commandTimeoutMs: number;
	private readonly owned = new Map<string, OwnedContainer>();
	private readonly leases = new Map<string, HeldLease>();
	private leaseCounter = 0;

	constructor(options: DockerCliExecutorOptions) {
		this.root = options.root;
		this.cli = options.cli;
		this.fs = options.fs;
		this.hash = options.hash;
		this.clock = options.clock ?? (() => Date.now());
		this.harnessPath = options.harnessPath;
		this.image = options.image ?? 'node:24-alpine';
		this.startTimeoutMs = options.startTimeoutMs ?? 20_000;
		this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
		this.stopGraceSeconds = options.stopGraceSeconds ?? 10;
		this.pollIntervalMs = options.pollIntervalMs ?? 100;
		this.latency = options.latency ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
		this.commandTimeoutMs = options.commandTimeoutMs ?? 120_000;
		this.kinds = options.kinds ?? ['container'];
	}

	// -- helpers -------------------------------------------------------------------

	private containerNameOf(envId: string): string {
		return `flauz-${envId}`;
	}

	private snapshotRootOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-snapshots', envId);
	}

	private sleep(ms: number): Promise<void> {
		return this.latency(ms);
	}

	/** The validated descriptor connection (typed rejection on shape drift). */
	private connectionOf(descriptor: EnvironmentDescriptor): { ok: true } | { ok: false; error: { code: string; message: string } } {
		const connection = descriptor.connection as { workspaceFolder?: unknown; name?: unknown };
		if (typeof connection?.workspaceFolder !== 'string' || connection.workspaceFolder.length === 0 || typeof connection?.name !== 'string' || connection.name.length === 0) {
			return { ok: false, error: { code: 'CONNECTION_INVALID', message: `container descriptor '${descriptor.id}' has no usable connection shape (workspaceFolder + name are required data fields)` } };
		}
		return { ok: true };
	}

	/** Runs `docker inspect` for the deterministic container name (undefined = no container). */
	private async inspectContainer(envId: string): Promise<{ ok: true; report: InspectReport } | { ok: false; reason: { code: string; message: string } } | undefined> {
		const result = await this.cli.spawnCli(['docker', 'inspect', this.containerNameOf(envId)], { timeoutMs: this.commandTimeoutMs });
		if (result.spawnError !== undefined) {
			return { ok: false, reason: { code: 'CLI_NOT_AVAILABLE', message: `the docker binary is not available (spawn error: ${excerpt(result.spawnError)}) — container truth not verifiable, failing closed` } };
		}
		if (result.exitCode !== 0) {
			return undefined; // "No such object" — no container for this environment
		}
		try {
			const reports = JSON.parse(result.stdout) as Partial<InspectReport>[];
			const report = reports[0];
			if (report === undefined || typeof report.Id !== 'string' || typeof report.State?.Running !== 'boolean') {
				return undefined;
			}
			return { ok: true, report: report as InspectReport };
		} catch {
			return undefined; // unreadable truth reads as gone (stale), never healthy
		}
	}

	/** Reads the in-container harness state via `docker exec cat` (undefined = gone). */
	private async readContainerState(containerId: string, envId: string): Promise<ContainerEnvState | undefined> {
		const result = await this.cli.spawnCli(['docker', 'exec', containerId, 'cat', joinPath(DOCKER_CONTAINER_STATE_DIR, 'state.json')], { timeoutMs: this.commandTimeoutMs });
		if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
			return undefined;
		}
		try {
			const value = JSON.parse(result.stdout) as Partial<ContainerEnvState>;
			if (value.schema !== 'flauz.env-state/v0' || typeof value.pid !== 'number' || typeof value.status !== 'string') {
				return undefined;
			}
			return value as ContainerEnvState;
		} catch {
			return undefined;
		}
	}

	/** In-container pid liveness via the signal-free `kill -0`. */
	private async containerPidAlive(containerId: string, pid: number): Promise<boolean> {
		const result = await this.cli.spawnCli(['docker', 'exec', containerId, 'kill', '-0', String(pid)], { timeoutMs: this.commandTimeoutMs });
		return result.exitCode === 0;
	}

	/** Copies the in-container harness state out to a stopped/running container (undefined = gone). */
	private async copyStateOut(containerId: string, targetDir: string): Promise<string | undefined> {
		const result = await this.cli.spawnCli(['docker', 'cp', `${containerId}:${joinPath(DOCKER_CONTAINER_STATE_DIR, 'state.json')}`, targetDir], { timeoutMs: this.commandTimeoutMs });
		if (result.exitCode !== 0) {
			return undefined;
		}
		return await this.fs.readFileUtf8(joinPath(targetDir, 'state.json'));
	}

	// -- the ops -------------------------------------------------------------------

	async create(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		// capability probe: binary absent / daemon down = typed fail-closed
		const info = await this.cli.spawnCli(['docker', 'info'], { timeoutMs: this.commandTimeoutMs });
		if (info.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the docker binary is not available on this machine (spawn error: ${excerpt(info.spawnError)}) — the container real executor fails closed; install docker or drive the simulated executor with { simulated: true }`);
		}
		if (info.exitCode !== 0) {
			return effectError('DAEMON_UNREACHABLE', `the docker daemon is not reachable (docker info exit ${info.exitCode}): ${excerpt(info.stderr)} — start the daemon (or drive the simulated executor with { simulated: true })`);
		}
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		return { ok: true, detail: { type: 'create', stateDir: DOCKER_CONTAINER_STATE_DIR } };
	}

	async start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const existing = this.owned.get(descriptor.id);
		if (existing !== undefined) {
			const running = await this.inspectContainer(descriptor.id);
			if (running !== undefined && running.ok && running.report.State.Running) {
				return effectError('ALREADY_RUNNING', `environment '${descriptor.id}' already has a live container (${existing.containerId.slice(0, 12)})`);
			}
		}
		const harnessSource = await this.fs.readFileUtf8(this.harnessPath);
		if (harnessSource === undefined) {
			return effectError('HARNESS_MISSING', `the fixed harness is not readable at ${this.harnessPath} — refusing to run anything else (injection law)`);
		}
		const name = this.containerNameOf(descriptor.id);
		// 1. the keep-alive holder: a pinned-safe detached container
		const run = await this.cli.spawnCli(['docker', 'run', '-d', '--name', name, this.image, 'tail', '-f', '/dev/null'], { timeoutMs: this.commandTimeoutMs });
		if (run.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the docker binary disappeared before the container launch (spawn error: ${excerpt(run.spawnError)})`);
		}
		if (run.timedOut) {
			return effectError('START_TIMEOUT', `docker run for '${descriptor.id}' (image ${this.image}) did not return within ${this.commandTimeoutMs} ms — the first run may be pulling the image`);
		}
		if (run.exitCode !== 0) {
			return effectError('START_FAILED', `docker run for '${descriptor.id}' (image ${this.image}) failed (exit ${run.exitCode}): ${excerpt(run.stderr)}`);
		}
		const containerId = run.stdout.trim();
		if (!CONTAINER_ID_PATTERN.test(containerId)) {
			return effectError('START_FAILED', `docker run for '${descriptor.id}' printed no usable container id (got ${JSON.stringify(excerpt(containerId))})`);
		}
		// 2. ship the FIXED harness via docker cp from a temp file under .flauz/
		const tempDir = joinPath(this.root, '.flauz', 'env-docker-tmp');
		const tempFile = joinPath(tempDir, `${descriptor.id}.ts`);
		await this.fs.mkdir(tempDir);
		await this.fs.writeFile(tempFile, harnessSource);
		const mkdir = await this.cli.spawnCli(['docker', 'exec', containerId, 'mkdir', '-p', DOCKER_CONTAINER_STATE_DIR], { timeoutMs: this.commandTimeoutMs });
		const copy = await this.cli.spawnCli(['docker', 'cp', tempFile, `${containerId}:${DOCKER_CONTAINER_SCRIPT}`], { timeoutMs: this.commandTimeoutMs });
		await this.fs.rm(tempFile).catch(() => undefined);
		if (mkdir.exitCode !== 0 || copy.exitCode !== 0) {
			await this.removeContainer(containerId, name);
			return effectError('START_FAILED', `shipping the fixed harness into ${name} failed (mkdir exit ${mkdir.exitCode}, cp exit ${copy.exitCode}): ${excerpt(copy.stderr || mkdir.stderr)}`);
		}
		// 3. run the FIXED harness inside (stdin pipe-holder + stdio protocol to the log)
		const harnessCommand = `tail -f /dev/null | node ${DOCKER_CONTAINER_SCRIPT} --state-dir ${DOCKER_CONTAINER_STATE_DIR} --id ${descriptor.id} --heartbeat-ms 500 > ${DOCKER_CONTAINER_LOG} 2>&1`;
		const launch = await this.cli.spawnCli(['docker', 'exec', '-d', containerId, 'sh', '-c', harnessCommand], { timeoutMs: this.commandTimeoutMs });
		if (launch.exitCode !== 0) {
			await this.removeContainer(containerId, name);
			return effectError('START_FAILED', `docker exec of the fixed harness into '${descriptor.id}' failed (exit ${launch.exitCode}): ${excerpt(launch.stderr)}`);
		}
		// 4. readiness: the harness's own stdio protocol lands in the log
		const ready = await this.awaitReady(containerId, descriptor.id);
		if (!ready.ok) {
			await this.removeContainer(containerId, name);
			return { ok: false, error: ready.error };
		}
		this.owned.set(descriptor.id, { containerId, pid: ready.pid, startedAt: ctx.now });
		return { ok: true, detail: { type: 'start', pid: ready.pid } };
	}

	async stop(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const name = this.containerNameOf(descriptor.id);
		const inspection = await this.inspectContainer(descriptor.id);
		if (inspection !== undefined && !inspection.ok) {
			return { ok: false, error: inspection.reason };
		}
		let pid: number | null = null;
		let forcedSignal: 'SIGTERM' | 'SIGKILL' | null = null;
		const containerId = inspection === undefined ? undefined : inspection.report.Id;
		if (containerId !== undefined && inspection?.report.State.Running === true) {
			const state = await this.readContainerState(containerId, descriptor.id);
			const owned = this.owned.get(descriptor.id);
			if (state !== undefined && owned !== undefined && owned.pid === state.pid) {
				// graceful via the harness protocol (SIGTERM handler), then escalation — OUR pid only
				pid = state.pid;
				forcedSignal = await this.terminateOwned(containerId, pid);
			} else if (state !== undefined) {
				// foreign pid: never signalled directly (pid reuse could hit an
				// innocent in-container process); docker stop is the container-scoped path
				pid = state.pid;
			}
		} else if (containerId !== undefined) {
			const state = await this.readContainerState(containerId, descriptor.id);
			pid = state?.pid ?? null;
		}
		// the blessed container-level stop (SIGTERM to PID 1, SIGKILL after the grace)
		const stopped = await this.cli.spawnCli(['docker', 'stop', '--time', String(this.stopGraceSeconds), name], { timeoutMs: this.commandTimeoutMs + this.stopGraceSeconds * 1000 });
		if (stopped.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the docker binary is not available (spawn error: ${excerpt(stopped.spawnError)})`);
		}
		if (stopped.exitCode !== 0) {
			return effectError('STOP_FAILED', `docker stop for '${descriptor.id}' (${name}) failed (exit ${stopped.exitCode}): ${excerpt(stopped.stderr)}`);
		}
		return { ok: true, detail: { type: 'stop', pid, forcedSignal } };
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
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const name = this.containerNameOf(descriptor.id);
		const inspection = await this.inspectContainer(descriptor.id);
		if (inspection === undefined) {
			return effectError('NO_STATE_DIR', `environment '${descriptor.id}' has no backing container to snapshot (${name})`);
		}
		if (!inspection.ok) {
			return { ok: false, error: inspection.reason };
		}
		const containerId = inspection.report.Id;
		const snapshotDir = joinPath(this.snapshotRootOf(descriptor.id), String(ctx.now));
		await this.fs.mkdir(snapshotDir);
		const contents = await this.copyStateOut(containerId, snapshotDir);
		if (contents === undefined) {
			return effectError('NO_STATE_DIR', `environment '${descriptor.id}' has no in-container state file to snapshot (${DOCKER_CONTAINER_STATE_DIR}/state.json)`);
		}
		const file: SnapshotManifestFile = { bytes: contents.length, path: 'state.json', sha256: this.hash.sha256Hex(contents) };
		const manifest: SnapshotManifest = {
			schemaVersion: 0,
			schema: DOCKER_SNAPSHOT_MANIFEST_SCHEMA_ID,
			environmentId: descriptor.id,
			createdAt: ctx.now,
			files: [file],
		};
		const manifestPath = joinPath(snapshotDir, 'manifest.json');
		await this.fs.writeFile(manifestPath, serializeEnvelope(manifest));
		return { ok: true, detail: { type: 'snapshot', snapshotDir, fileCount: 1, manifestPath } };
	}

	async destroy(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const name = this.containerNameOf(descriptor.id);
		const inspection = await this.inspectContainer(descriptor.id);
		if (inspection === undefined) {
			this.owned.delete(descriptor.id);
			this.leases.delete(descriptor.id);
			return { ok: true, detail: { type: 'destroy', pid: null } }; // already gone — idempotent
		}
		if (!inspection.ok) {
			return { ok: false, error: inspection.reason };
		}
		let pid: number | null = null;
		const containerId = inspection.report.Id;
		if (inspection.report.State.Running) {
			const state = await this.readContainerState(containerId, descriptor.id);
			const owned = this.owned.get(descriptor.id);
			if (state !== undefined && owned !== undefined && owned.pid === state.pid) {
				pid = state.pid;
				await this.terminateOwned(containerId, pid);
			} else if (state !== undefined) {
				pid = state.pid; // foreign pid: never signalled directly (docker stop is container-scoped)
			}
		} else {
			pid = (await this.readContainerState(containerId, descriptor.id))?.pid ?? null;
		}
		this.owned.delete(descriptor.id);
		this.leases.delete(descriptor.id);
		const removed = await this.removeContainer(containerId, name);
		if (!removed.ok) {
			return { ok: false, error: removed.error };
		}
		return { ok: true, detail: { type: 'destroy', pid } };
	}

	async probe(descriptor: EnvironmentDescriptor): Promise<DescribeVerdict> {
		const lease = this.leases.get(descriptor.id);
		const leasePayload = lease === undefined ? undefined : { leaseId: lease.leaseId, heldSince: lease.heldSince };
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { health: 'stale', state: 'stopped', pid: null, message: shape.error.message, ...(leasePayload === undefined ? {} : { lease: leasePayload }) };
		}
		const name = this.containerNameOf(descriptor.id);
		const inspection = await this.inspectContainer(descriptor.id);
		if (inspection === undefined) {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: null,
				message: `no backing container for '${descriptor.id}' (${name}: never started, or removed)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (!inspection.ok) {
			// fail-closed: truth not verifiable (binary gone) — never silently healthy
			return {
				health: 'stale',
				state: 'stopped',
				pid: null,
				message: inspection.reason.message,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const containerId = inspection.report.Id;
		if (!inspection.report.State.Running) {
			const state = await this.readStoppedState(containerId);
			if (state === undefined) {
				return {
					health: 'not-running',
					state: 'stopped',
					pid: null,
					message: `container for '${descriptor.id}' is ${inspection.report.State.Status} (no harness state inside)`,
					...(leasePayload === undefined ? {} : { lease: leasePayload }),
				};
			}
			if (state.status === 'stopped') {
				return {
					health: 'not-running',
					state: 'stopped',
					pid: state.pid,
					message: `harness for '${descriptor.id}' shut down cleanly at epoch ${state.stoppedAt ?? 'unknown'}`,
					...(leasePayload === undefined ? {} : { lease: leasePayload }),
				};
			}
			return {
				health: 'stale',
				state: 'stopped',
				pid: state.pid,
				message: `container for '${descriptor.id}' is ${inspection.report.State.Status} while the harness state still claims running (crash reconciliation — the lifecycle state outruns the truth)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const state = await this.readContainerState(containerId, descriptor.id);
		if (state === undefined) {
			return {
				health: 'stale',
				state: 'stopped',
				pid: null,
				message: `container for '${descriptor.id}' is running but carries no harness state (never became ready, or the state vanished)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (state.status === 'stopped') {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: state.pid,
				message: `harness for '${descriptor.id}' shut down cleanly at epoch ${state.stoppedAt ?? 'unknown'} (container still up)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (!(await this.containerPidAlive(containerId, state.pid))) {
			return {
				health: 'stale',
				state: 'stopped',
				pid: state.pid,
				message: `harness pid ${state.pid} for '${descriptor.id}' is gone inside its running container (crash reconciliation — never silently healthy)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const owned = this.owned.get(descriptor.id);
		if (owned === undefined || owned.pid !== state.pid) {
			return {
				health: 'orphan',
				state: 'running',
				pid: state.pid,
				message: `harness pid ${state.pid} for '${descriptor.id}' is alive but was not started by this executor instance (host restart or pid reuse) — never treated as healthy`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		return {
			health: 'healthy',
			state: 'running',
			pid: state.pid,
			message: `harness pid ${state.pid} for '${descriptor.id}' is live inside container ${containerId.slice(0, 12)} (beat ${state.beat})`,
			...(leasePayload === undefined ? {} : { lease: leasePayload }),
		};
	}

	// -- internals -----------------------------------------------------------------

	/** Reads the harness state out of a STOPPED container via docker cp. */
	private async readStoppedState(containerId: string): Promise<ContainerEnvState | undefined> {
		const tempDir = joinPath(this.root, '.flauz', 'env-docker-tmp', `probe-${containerId.slice(0, 12)}`);
		await this.fs.mkdir(tempDir);
		const contents = await this.copyStateOut(containerId, tempDir);
		await this.fs.rm(tempDir).catch(() => undefined);
		if (contents === undefined) {
			return undefined;
		}
		try {
			const value = JSON.parse(contents) as Partial<ContainerEnvState>;
			if (value.schema !== 'flauz.env-state/v0' || typeof value.pid !== 'number' || typeof value.status !== 'string') {
				return undefined;
			}
			return value as ContainerEnvState;
		} catch {
			return undefined;
		}
	}

	/** Graceful kill -15 -> grace window -> kill -9, on OUR pid only. */
	private async terminateOwned(containerId: string, pid: number): Promise<'SIGTERM' | 'SIGKILL'> {
		await this.cli.spawnCli(['docker', 'exec', containerId, 'kill', '-15', String(pid)], { timeoutMs: this.commandTimeoutMs });
		if (await this.awaitContainerPidGone(containerId, pid, this.stopTimeoutMs)) {
			return 'SIGTERM';
		}
		await this.cli.spawnCli(['docker', 'exec', containerId, 'kill', '-9', String(pid)], { timeoutMs: this.commandTimeoutMs });
		await this.awaitContainerPidGone(containerId, pid, 1000);
		return 'SIGKILL';
	}

	private async awaitContainerPidGone(containerId: string, pid: number, windowMs: number): Promise<boolean> {
		const deadline = this.clock() + windowMs; // the injected clock + latency cue bound every wait
		for (; ;) {
			if (!(await this.containerPidAlive(containerId, pid))) {
				return true;
			}
			if (this.clock() >= deadline) {
				return false;
			}
			await this.sleep(this.pollIntervalMs);
		}
	}

	/** Polls the in-container harness log until its stdio protocol reports ready (pid) or error. */
	private async awaitReady(containerId: string, envId: string): Promise<{ ok: true; pid: number } | { ok: false; error: { code: string; message: string } }> {
		const deadline = this.clock() + this.startTimeoutMs; // the injected clock + latency cue bound every wait
		for (; ;) {
			const log = await this.cli.spawnCli(['docker', 'exec', containerId, 'cat', DOCKER_CONTAINER_LOG], { timeoutMs: this.commandTimeoutMs });
			const parsed = parseHarnessStdio(log.stdout);
			if (parsed.readyPid !== undefined) {
				return { ok: true, pid: parsed.readyPid };
			}
			if (parsed.error !== undefined) {
				return { ok: false, error: { code: 'START_FAILED', message: `in-container harness for '${envId}' reported a protocol error: ${parsed.error}` } };
			}
			if (this.clock() >= deadline) {
				return { ok: false, error: { code: 'START_FAILED', message: `in-container harness for '${envId}' did not report ready within ${this.startTimeoutMs} ms (log so far: ${excerpt(log.stdout + log.stderr, 160) || 'empty'})` } };
			}
			await this.sleep(this.pollIntervalMs);
		}
	}

	/** stop-then-remove, `rm -f` escalation on races (idempotent for a gone container). */
	private async removeContainer(containerId: string, name: string): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> {
		const stopped = await this.cli.spawnCli(['docker', 'stop', '--time', String(this.stopGraceSeconds), name], { timeoutMs: this.commandTimeoutMs + this.stopGraceSeconds * 1000 });
		if (stopped.exitCode !== 0) {
			const stoppedGone = await this.cli.spawnCli(['docker', 'inspect', name], { timeoutMs: this.commandTimeoutMs });
			if (stoppedGone.exitCode !== 0) {
				return { ok: true }; // already gone — idempotent
			}
			return { ok: false, error: { code: 'DESTROY_FAILED', message: `docker stop for '${name}' failed (exit ${stopped.exitCode}): ${excerpt(stopped.stderr)}` } };
		}
		const removed = await this.cli.spawnCli(['docker', 'rm', name], { timeoutMs: this.commandTimeoutMs });
		if (removed.exitCode !== 0) {
			const forced = await this.cli.spawnCli(['docker', 'rm', '-f', name], { timeoutMs: this.commandTimeoutMs });
			if (forced.exitCode !== 0) {
				return { ok: false, error: { code: 'DESTROY_FAILED', message: `docker rm for '${name}' failed (exit ${removed.exitCode}, escalation exit ${forced.exitCode}): ${excerpt(forced.stderr)}` } };
			}
		}
		return { ok: true };
	}
}
