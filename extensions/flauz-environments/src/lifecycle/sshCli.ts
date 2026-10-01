/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — `SshCliExecutor` (executorKind `ssh-cli`, kind `ssh-local`).
 *
 * REAL lifecycle over the SYSTEM `ssh` binary, entirely through the `CliPort`
 * seam (cliPort.ts — the discipline point; `FakeCli` scripts it in tests):
 *
 *   - capability probe : `ssh -V` — binary absent (spawnError) is the typed
 *     fail-closed `CLI_NOT_AVAILABLE` (never a crash, never a fallback).
 *   - create            : connectivity + auth probe `ssh <target> true`
 *     (auth failures classify as `SSH_AUTH_FAILED`; unreachable hosts as
 *     `SSH_UNREACHABLE`).
 *   - start             : ONE command-free pipe ships the FIXED harness
 *     (`fixtures/env-agent.ts` content over stdin): `ssh <target> mkdir -p
 *     <dir> && nohup node - --state-dir <dir> --id <id> --heartbeat-ms <n>
 *     > <dir>/harness.out 2>&1 &`. The remote `node -` reads the script from
 *     stdin (type-stripping like any node >= 23.6; a node < 23.6 remote
 *     degrades to a typed START_FAILED). `nohup` + `&` detach the harness
 *     from the session; its stdio protocol (ready/beat lines) lands in
 *     `<dir>/harness.out`, which the executor reads with bounded `ssh cat`
 *     polls — the pid comes from the harness's OWN ready line (the same
 *     protocol the local executor reads off its child's stdout).
 *   - stop/destroy      : graceful `kill -15` on the harness-reported pid
 *     (the harness's SIGTERM protocol writes its final stopped state), then
 *     `kill -9` escalation after the grace window; NEVER a pid this executor
 *     instance did not start (`PROCESS_NOT_OWNED` — the never-signal-foreign-
 *     pids law; pid reuse on the remote could hit an innocent process).
 *   - snapshot          : `ssh cat` the harness state file into
 *     `.flauz/env-snapshots/<envId>/<epochMs>/` with the SAME canonical
 *     `manifest.json` (sha256 per file, `flauz.env-snapshot-manifest/v0`)
 *     as the local executor.
 *   - attach/detach     : logical lease, same semantics as local.
 *   - probe (describe)  : remote state file + `kill -0 <pid>` liveness ->
 *     healthy / stale (crash reconciliation) / orphan (alive but not started
 *     by this instance) / not-running. The ssh binary vanishing mid-life
 *     reads as `stale` (fail-closed, never silently healthy); vanishing
 *     FOR the kill -0 itself is the typed `UNVERIFIABLE` liveness outcome
 *     (P2-FIX-110) — the consuming op verdicts fail closed on it, never
 *     claiming the pid gone or destroyed on evidence a spawn error does
 *     not support.
 *
 * INJECTION LAW: argv tokens are executor-constructed ONLY — the descriptor
 * contributes DATA (host/port/user as the ssh DESTINATION, parsed by the ssh
 * client, never by a shell; the remote command words are fixed strings plus
 * the registry-validated env id `[a-z0-9-]` and numbers). No command/shell/
 * script field exists in the v0 descriptor shape and none is invented here;
 * the ONLY program ever run on the remote is the FIXED harness.
 *
 * IDENTITY POSTURE (decision, recorded in the delivery report): v0
 * `SshConnection` carries NO identity material by design (the shape is
 * pinned, DL-29 — `authMethod` names the intent only). The executor runs
 * strictly non-interactive (`-o BatchMode=yes`): authMethod `agent` rides
 * SSH_AUTH_SOCK, `key` rides the remote-configured default identity files,
 * and `password` can never authenticate under BatchMode (typed
 * SSH_AUTH_FAILED — no hidden TTY prompt is an honest fail-closed posture).
 * Should identity MATERIAL ever enter the descriptors it must be a vault
 * reference, never a literal (SECURITY-MODEL 3.5 — same law the
 * connection-plan providers enforce).
 *
 * REMOTE PATHS (decision): the executor derives its own state root
 * `~/.flauz/env-state/<envId>` (tilde expanded by the remote login shell in
 * every invocation — no local knowledge of the remote home). The
 * descriptor's `remotePath` (workspace path) is NOT used as a command path.
 */
import { joinPath, serializeEnvelope, type Clock, type EnvironmentDescriptor, type EnvironmentKind } from '../api.ts';
import type { ExecutorOpContext, EnvironmentExecutor } from './executor.ts';
import { cancelledEffectError, observeCancellation } from './executor.ts';
import type { DescribeVerdict, ExecutorEffectResult } from './types.ts';
import { excerpt, parseHarnessStdio, type CliPort } from './cliPort.ts';
import type { HashPort, LocalEnvFsPort, SnapshotManifest, SnapshotManifestFile } from './localProcess.ts';

export const SSH_CLI_EXECUTOR_KIND = 'ssh-cli';

/** Schema id pinned into snapshot manifests (same as the local executor). */
export const SSH_SNAPSHOT_MANIFEST_SCHEMA_ID = 'flauz.env-snapshot-manifest/v0';

/**
 * P2-FIX-110 — the typed result vocabulary of the `kill -0` liveness probe
 * (`remotePidAlive`). `UNVERIFIABLE` (the ssh binary itself could not be
 * spawned — the single-invocation vanish window between an earlier
 * successful invocation and the probe) is never collapsed into `NOT_ALIVE`:
 * no exit status was ever produced, so the evidence supports neither
 * "alive" nor "gone". The consuming op verdicts fail closed on it (never
 * healthy, never a fabricated teardown, never a confident
 * "destroyed"/"gone" claim).
 */
export const REMOTE_PID_LIVENESS_OUTCOMES = ['ALIVE', 'NOT_ALIVE', 'UNVERIFIABLE'] as const;
export type RemotePidLiveness = (typeof REMOTE_PID_LIVENESS_OUTCOMES)[number];

export interface SshCliExecutorOptions {
	readonly root: string;
	/** The process seam — every ssh invocation goes through it. */
	readonly cli: CliPort;
	/** Local fs (harness read + snapshot writes). */
	readonly fs: LocalEnvFsPort;
	readonly hash: HashPort;
	readonly clock?: Clock;
	/** ABSOLUTE path of the fixed harness (fixtures/env-agent.ts). */
	readonly harnessPath: string;
	/** ssh -o ConnectTimeout budget in ms (default 10 000). */
	readonly connectTimeoutMs?: number;
	/** Harness readiness window (default 15 000). */
	readonly startTimeoutMs?: number;
	/** Graceful-stop window before kill -9 escalation (default 5 000). */
	readonly stopTimeoutMs?: number;
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
	/** Per-invocation wall-clock budget (default 30 000). */
	readonly commandTimeoutMs?: number;
	/** Remote state root (default '~/.flauz/env-state'). */
	readonly remoteStateRoot?: string;
	/** Kinds served (default ['ssh-local']). */
	readonly kinds?: readonly EnvironmentKind[];
}

/** The harness `state.json` document (the remote backing truth). */
interface RemoteEnvState {
	readonly schema: string;
	readonly environmentId: string;
	readonly pid: number;
	readonly beat: number;
	readonly status: string;
	readonly stoppedAt?: number;
}

const ENV_STATE_SCHEMA_ID = 'flauz.env-state/v0';

interface OwnedHarness {
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

export class SshCliExecutor implements EnvironmentExecutor {
	readonly executorKind = SSH_CLI_EXECUTOR_KIND;
	readonly infrastructureClass = 'real' as const;
	readonly kinds: readonly EnvironmentKind[];
	private readonly root: string;
	private readonly cli: CliPort;
	private readonly fs: LocalEnvFsPort;
	private readonly hash: HashPort;
	private readonly clock: Clock;
	private readonly harnessPath: string;
	private readonly connectTimeoutMs: number;
	private readonly startTimeoutMs: number;
	private readonly stopTimeoutMs: number;
	private readonly pollIntervalMs: number;
	private readonly latency: (ms: number) => Promise<void>;
	private readonly commandTimeoutMs: number;
	private readonly remoteStateRoot: string;
	private readonly owned = new Map<string, OwnedHarness>();
	private readonly leases = new Map<string, HeldLease>();
	private leaseCounter = 0;

	constructor(options: SshCliExecutorOptions) {
		this.root = options.root;
		this.cli = options.cli;
		this.fs = options.fs;
		this.hash = options.hash;
		this.clock = options.clock ?? (() => Date.now());
		this.harnessPath = options.harnessPath;
		this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
		this.startTimeoutMs = options.startTimeoutMs ?? 15_000;
		this.stopTimeoutMs = options.stopTimeoutMs ?? 5_000;
		this.pollIntervalMs = options.pollIntervalMs ?? 100;
		this.latency = options.latency ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
		this.commandTimeoutMs = options.commandTimeoutMs ?? 30_000;
		this.remoteStateRoot = options.remoteStateRoot ?? '~/.flauz/env-state';
		this.kinds = options.kinds ?? ['ssh-local'];
	}

	// -- argv construction (the injection law lives here) -----------------------

	/** `-o` options: non-interactive, bounded connect, fail-closed host keys. */
	private baseArgv(connection: { readonly host: string; readonly port?: number; readonly user?: string }): readonly string[] {
		const argv = ['ssh', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.max(1, Math.ceil(this.connectTimeoutMs / 1000))}`, '-o', 'StrictHostKeyChecking=yes'];
		if (connection.port !== undefined) {
			argv.push('-p', String(connection.port));
		}
		argv.push('--', connection.user !== undefined ? `${connection.user}@${connection.host}` : connection.host);
		return argv;
	}

	/** The validated descriptor connection (typed rejection on shape drift). */
	private connectionOf(descriptor: EnvironmentDescriptor): { ok: true; connection: { readonly host: string; readonly port?: number; readonly user?: string } } | { ok: false; error: { code: string; message: string } } {
		const connection = descriptor.connection as { host?: unknown; port?: unknown; user?: unknown };
		if (typeof connection?.host !== 'string' || connection.host.length === 0) {
			return { ok: false, error: { code: 'CONNECTION_INVALID', message: `ssh-local descriptor '${descriptor.id}' has no usable host in its connection shape` } };
		}
		return {
			ok: true,
			connection: {
				host: connection.host,
				...(typeof connection.port === 'number' ? { port: connection.port } : {}),
				...(typeof connection.user === 'string' && connection.user.length > 0 ? { user: connection.user } : {}),
			},
		};
	}

	private remoteDirOf(envId: string): string {
		return joinPath(this.remoteStateRoot, envId);
	}

	private remoteStateFileOf(envId: string): string {
		return joinPath(this.remoteDirOf(envId), 'state.json');
	}

	private remoteLogFileOf(envId: string): string {
		return joinPath(this.remoteDirOf(envId), 'harness.out');
	}

	private snapshotRootOf(envId: string): string {
		return joinPath(this.root, '.flauz', 'env-snapshots', envId);
	}

	private sleep(ms: number): Promise<void> {
		return this.latency(ms);
	}

	// -- the ops ----------------------------------------------------------------

	async create(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		// capability probe: binary absent = typed fail-closed (the dev-box case)
		const version = await this.cli.spawnCli(['ssh', '-V'], { timeoutMs: this.commandTimeoutMs });
		if (version.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the ssh binary is not available on this machine (spawn error: ${excerpt(version.spawnError)}) — the ssh-local real executor fails closed; install ssh or drive the simulated executor with { simulated: true }`);
		}
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		// connectivity + auth probe with the descriptor's connection shape
		const probe = await this.cli.spawnCli([...this.baseArgv(shape.connection), 'true'], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (probe.timedOut) {
			return effectError('SSH_PROBE_TIMEOUT', `ssh probe for '${descriptor.id}' (${shape.connection.host}) timed out after ${this.commandTimeoutMs + this.connectTimeoutMs} ms`);
		}
		if (probe.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the ssh binary disappeared between probe and connect (spawn error: ${excerpt(probe.spawnError)})`);
		}
		if (probe.exitCode !== 0) {
			if (/permission denied|authentic/i.test(probe.stderr)) {
				return effectError('SSH_AUTH_FAILED', `ssh authentication failed for '${descriptor.id}' on ${shape.connection.host} (exit ${probe.exitCode}; non-interactive BatchMode posture — authMethod 'agent' needs SSH_AUTH_SOCK, 'key' needs a default/config identity, 'password' cannot authenticate non-interactively): ${excerpt(probe.stderr)}`);
			}
			return effectError('SSH_UNREACHABLE', `ssh probe 'true' for '${descriptor.id}' on ${shape.connection.host} failed (exit ${probe.exitCode}): ${excerpt(probe.stderr)}`);
		}
		return { ok: true, detail: { type: 'create', stateDir: this.remoteDirOf(descriptor.id) } };
	}

	async start(descriptor: EnvironmentDescriptor, ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const existing = this.owned.get(descriptor.id);
		if (existing !== undefined) {
			const liveness = await this.remotePidAlive(shape.connection, existing.pid);
			if (liveness === 'ALIVE') {
				return effectError('ALREADY_RUNNING', `environment '${descriptor.id}' already has a live remote harness (pid ${existing.pid})`);
			}
			if (liveness === 'UNVERIFIABLE') {
				return effectError('CLI_NOT_AVAILABLE', `liveness of the previously started harness (pid ${existing.pid}) for '${descriptor.id}' is unverifiable (the ssh binary vanished for the kill -0 probe) — refusing to launch a second harness over an unverifiable one (fail closed; restore the binary, then retry start)`);
			}
		}
		const harnessSource = await this.fs.readFileUtf8(this.harnessPath);
		if (harnessSource === undefined) {
			return effectError('HARNESS_MISSING', `the fixed harness is not readable at ${this.harnessPath} — refusing to run anything else (injection law)`);
		}
		// DL-81 / P2-FIX-109 — the PRE-SPAWN effect checkpoint: a cancel observed
		// here returns the typed OP_CANCELLED effect before any remote process
		// or remote state exists.
		const cancelledPreSpawn = observeCancellation(ctx, 'pre-spawn', `no remote harness launched for '${descriptor.id}'`);
		if (cancelledPreSpawn !== undefined) {
			return cancelledPreSpawn;
		}
		const dir = this.remoteDirOf(descriptor.id);
		const log = this.remoteLogFileOf(descriptor.id);
		// The one command-free pipe: the FIXED harness ships over stdin to
		// `node -`; mkdir precedes so the log redirect can land; nohup + &
		// detach the harness from the session. Every token here is fixed or
		// derived from the registry-validated env id — never descriptor text.
		const launch = await this.cli.spawnCli(
			[...this.baseArgv(shape.connection), 'mkdir', '-p', dir, '&&', 'nohup', 'node', '-', '--state-dir', dir, '--id', descriptor.id, '--heartbeat-ms', String(this.heartbeatMs()), '>', log, '2>&1', '&'],
			{ stdin: harnessSource, timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs },
		);
		if (launch.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the ssh binary disappeared before the harness launch (spawn error: ${excerpt(launch.spawnError)})`);
		}
		if (launch.timedOut) {
			return effectError('START_TIMEOUT', `the harness launch session for '${descriptor.id}' did not return within ${this.commandTimeoutMs + this.connectTimeoutMs} ms`);
		}
		if (launch.exitCode !== 0) {
			return effectError('START_FAILED', `remote harness launch for '${descriptor.id}' failed (exit ${launch.exitCode}): ${excerpt(launch.stderr)}`);
		}
		// readiness: the harness's own stdio protocol lands in the remote log
		// (DL-81: the POST-SPAWN/PRE-CONFIRM cancellation checkpoint is observed
		// on every poll of this loop)
		const ready = await this.awaitReady(descriptor.id, shape.connection, ctx);
		if (ready.cancelled) {
			// DL-81 — the defensive reap BEFORE returning CANCELLED: the remote
			// state file names the launched harness pid (the fixed harness
			// writes it before its ready line), so an unconfirmed-but-named
			// pid is terminated over the connection (kill-only-ours holds —
			// this pid is the one THIS start launched). An unreadable state
			// file is the checkpoint miss-window: the nohup'd harness exits on
			// its own when the ssh session's stdin pipe closes, and the
			// superseding destroy removes the remote dir.
			const read = await this.readRemoteState(shape.connection, descriptor.id);
			if (read !== undefined && read.ok) {
				await this.terminateOwned(shape.connection, read.state.pid);
				return { ok: false, error: cancelledEffectError(ctx.cancellation, 'pre-confirm', `remote harness pid ${read.state.pid} launched for '${descriptor.id}' (readiness unconfirmed) — defensively terminated over the connection (no orphan remote child)`) };
			}
			return { ok: false, error: cancelledEffectError(ctx.cancellation, 'pre-confirm', `remote harness launched for '${descriptor.id}' but its remote state file is not readable yet (pid unconfirmed — the checkpoint miss-window; the superseding destroy removes the remote dir)`) };
		}
		if (!ready.ok) {
			return { ok: false, error: ready.error };
		}
		this.owned.set(descriptor.id, { pid: ready.pid, startedAt: ctx.now });
		return { ok: true, detail: { type: 'start', pid: ready.pid } };
	}

	async stop(descriptor: EnvironmentDescriptor, _ctx: ExecutorOpContext): Promise<ExecutorEffectResult> {
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const ownedHarness = this.owned.get(descriptor.id);
		if (ownedHarness !== undefined) {
			const forced = await this.terminateOwned(shape.connection, ownedHarness.pid);
			return { ok: true, detail: { type: 'stop', pid: ownedHarness.pid, forcedSignal: forced } };
		}
		// not started by this instance: reconcile against the remote truth
		const read = await this.readRemoteState(shape.connection, descriptor.id);
		if (read === undefined) {
			return { ok: true, detail: { type: 'stop', pid: null, forcedSignal: null } };
		}
		if (!read.ok) {
			return { ok: false, error: read.reason };
		}
		const state = read.state;
		const liveness = await this.remotePidAlive(shape.connection, state.pid);
		if (liveness === 'ALIVE') {
			return effectError('PROCESS_NOT_OWNED', `environment '${descriptor.id}' backing pid ${state.pid} is alive on the remote but was not started by this executor instance — refusing to signal a process we do not own (orphan; resolve it manually on the remote, then retry)`);
		}
		if (liveness === 'UNVERIFIABLE') {
			return effectError('CLI_NOT_AVAILABLE', `liveness of remote backing pid ${state.pid} for '${descriptor.id}' is unverifiable (the ssh binary vanished between the state read and the kill -0 probe) — refusing to report it stopped (fail closed; restore the binary, then retry stop)`);
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
		const shape = this.connectionOf(descriptor);
		if (!shape.ok) {
			return { ok: false, error: shape.error };
		}
		const stateFile = await this.cli.spawnCli([...this.baseArgv(shape.connection), 'cat', this.remoteStateFileOf(descriptor.id)], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (stateFile.spawnError !== undefined) {
			return effectError('CLI_NOT_AVAILABLE', `the ssh binary is not available (spawn error: ${excerpt(stateFile.spawnError)}) — cannot snapshot '${descriptor.id}'`);
		}
		if (stateFile.exitCode !== 0) {
			return effectError('NO_STATE_DIR', `environment '${descriptor.id}' has no remote state file to snapshot (${this.remoteStateFileOf(descriptor.id)})`);
		}
		const contents = stateFile.stdout;
		const snapshotDir = joinPath(this.snapshotRootOf(descriptor.id), String(ctx.now));
		await this.fs.mkdir(snapshotDir);
		await this.fs.writeFile(joinPath(snapshotDir, 'state.json'), contents);
		const file: SnapshotManifestFile = { bytes: contents.length, path: 'state.json', sha256: this.hash.sha256Hex(contents) };
		const manifest: SnapshotManifest = {
			schemaVersion: 0,
			schema: SSH_SNAPSHOT_MANIFEST_SCHEMA_ID,
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
		let pid: number | null = null;
		const ownedHarness = this.owned.get(descriptor.id);
		if (ownedHarness !== undefined) {
			pid = ownedHarness.pid;
			await this.terminateOwned(shape.connection, ownedHarness.pid);
			this.owned.delete(descriptor.id);
		} else {
			const read = await this.readRemoteState(shape.connection, descriptor.id);
			if (read !== undefined) {
				if (!read.ok) {
					return { ok: false, error: read.reason };
				}
				pid = read.state.pid;
				const liveness = await this.remotePidAlive(shape.connection, read.state.pid);
				if (liveness === 'ALIVE') {
					return effectError('PROCESS_NOT_OWNED', `environment '${descriptor.id}' backing pid ${read.state.pid} is alive on the remote but was not started by this executor instance — refusing to signal it (orphan; resolve it manually on the remote, then retry destroy)`);
				}
				if (liveness === 'UNVERIFIABLE') {
					return effectError('CLI_NOT_AVAILABLE', `liveness of remote backing pid ${read.state.pid} for '${descriptor.id}' is unverifiable (the ssh binary vanished between the state read and the kill -0 probe) — refusing to remove remote state that may still back a live process (fail closed; no fabricated teardown; restore the binary, then retry destroy)`);
				}
			}
		}
		this.leases.delete(descriptor.id);
		const removal = await this.cli.spawnCli([...this.baseArgv(shape.connection), 'rm', '-rf', this.remoteDirOf(descriptor.id)], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (removal.spawnError !== undefined) {
			// the binary vanished before the removal ran: returning ok here
			// would FABRICATE success (the remote state dir was never removed)
			// — the teardown fails closed with the typed capability error and
			// the state is preserved for an honest retry
			return effectError('CLI_NOT_AVAILABLE', `the ssh binary is not available for the destroy of '${descriptor.id}' (spawn error: ${excerpt(removal.spawnError)}) — the remote state dir was NOT removed (no fabricated success; restore the binary, then retry destroy)`);
		}
		if (removal.timedOut) {
			return effectError('DESTROY_FAILED', `removing the remote state dir for '${descriptor.id}' timed out after ${this.commandTimeoutMs + this.connectTimeoutMs} ms — the removal did not complete (retry destroy)`);
		}
		if (removal.exitCode !== 0) {
			return effectError('DESTROY_FAILED', `removing the remote state dir for '${descriptor.id}' failed (exit ${removal.exitCode}): ${excerpt(removal.stderr)}`);
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
		const read = await this.readRemoteState(shape.connection, descriptor.id);
		if (read !== undefined && !read.ok) {
			// fail-closed: the truth is not verifiable (binary gone) — never silently healthy
			return {
				health: 'stale',
				state: 'stopped',
				pid: null,
				message: read.reason.message,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const state = read === undefined || !read.ok ? undefined : read.state;
		if (state === undefined) {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: null,
				message: `no remote backing state file for '${descriptor.id}' (never started, or cleaned up)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (state.status === 'stopped') {
			return {
				health: 'not-running',
				state: 'stopped',
				pid: state.pid,
				message: `remote harness for '${descriptor.id}' shut down cleanly at epoch ${state.stoppedAt ?? 'unknown'}`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const liveness = await this.remotePidAlive(shape.connection, state.pid);
		if (liveness === 'UNVERIFIABLE') {
			// P2-FIX-110 fail-closed: never healthy — and never a confident
			// "gone" (crash reconciliation) claim either; the binary vanished
			// between the successful state read and this probe
			return {
				health: 'stale',
				state: 'stopped',
				pid: state.pid,
				message: `liveness of remote backing process ${state.pid} for '${descriptor.id}' is unverifiable (the ssh binary vanished between the state read and the kill -0 probe) — failing closed as stale, never healthy and never claiming it gone (restore the binary, then re-probe)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		if (liveness === 'NOT_ALIVE') {
			return {
				health: 'stale',
				state: 'stopped',
				pid: state.pid,
				message: `remote backing process ${state.pid} for '${descriptor.id}' is gone while its state still claims running (crash reconciliation — the lifecycle state outruns the truth)`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		const ownedHarness = this.owned.get(descriptor.id);
		if (ownedHarness === undefined || ownedHarness.pid !== state.pid) {
			return {
				health: 'orphan',
				state: 'running',
				pid: state.pid,
				message: `backing pid ${state.pid} for '${descriptor.id}' is alive on the remote but was not started by this executor instance (host restart or pid reuse) — never treated as healthy`,
				...(leasePayload === undefined ? {} : { lease: leasePayload }),
			};
		}
		return {
			health: 'healthy',
			state: 'running',
			pid: state.pid,
			message: `remote harness process ${state.pid} for '${descriptor.id}' is live (beat ${state.beat})`,
			...(leasePayload === undefined ? {} : { lease: leasePayload }),
		};
	}

	// -- internals ----------------------------------------------------------------

	private heartbeatMs(): number {
		return 500;
	}

	/** Reads + validates the remote harness state document (gone/unreadable = undefined; cli-unavailable = typed). */
	private async readRemoteState(connection: { readonly host: string; readonly port?: number; readonly user?: string }, envId: string): Promise<{ ok: true; state: RemoteEnvState } | { ok: false; reason: { code: string; message: string } } | undefined> {
		const result = await this.cli.spawnCli([...this.baseArgv(connection), 'cat', this.remoteStateFileOf(envId)], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (result.spawnError !== undefined) {
			return { ok: false, reason: { code: 'CLI_NOT_AVAILABLE', message: `the ssh binary is not available (spawn error: ${excerpt(result.spawnError)}) — remote truth not verifiable, failing closed` } };
		}
		if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
			return undefined;
		}
		try {
			const value = JSON.parse(result.stdout) as Partial<RemoteEnvState>;
			if (value.schema !== ENV_STATE_SCHEMA_ID || typeof value.pid !== 'number' || typeof value.status !== 'string') {
				return undefined;
			}
			return { ok: true, state: value as RemoteEnvState };
		} catch {
			return undefined; // unreadable truth reads as gone (stale), never healthy
		}
	}

	/**
	 * `kill -0` over the connection — the signal-free liveness check.
	 *
	 * P2-FIX-110: the probe's verdict is TYPED. A spawn failure (the ssh
	 * binary itself vanished — the single-invocation window between this
	 * probe and the invocation that succeeded before it) is
	 * `UNVERIFIABLE`, never "not alive": no exit status was ever produced,
	 * so the evidence supports neither alive nor gone. Consumers fail
	 * closed on `UNVERIFIABLE`.
	 */
	private async remotePidAlive(connection: { readonly host: string; readonly port?: number; readonly user?: string }, pid: number): Promise<RemotePidLiveness> {
		const result = await this.cli.spawnCli([...this.baseArgv(connection), 'kill', '-0', String(pid)], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (result.spawnError !== undefined) {
			return 'UNVERIFIABLE';
		}
		return result.exitCode === 0 ? 'ALIVE' : 'NOT_ALIVE';
	}

	/** Graceful kill -15 -> grace window -> kill -9, on OUR pid only. */
	private async terminateOwned(connection: { readonly host: string; readonly port?: number; readonly user?: string }, pid: number): Promise<'SIGTERM' | 'SIGKILL'> {
		const argv = (signal: string): readonly string[] => [...this.baseArgv(connection), 'kill', signal, String(pid)];
		await this.cli.spawnCli(argv('-15'), { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		if (await this.awaitGone(connection, pid, this.stopTimeoutMs)) {
			return 'SIGTERM';
		}
		await this.cli.spawnCli(argv('-9'), { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
		await this.awaitGone(connection, pid, 1000);
		return 'SIGKILL';
	}

	/** Polls kill -0 until the pid is gone (or the grace window expires on the injectable clock). */
	private async awaitGone(connection: { readonly host: string; readonly port?: number; readonly user?: string }, pid: number, windowMs: number): Promise<boolean> {
		const deadline = this.clock() + windowMs; // the injected clock + latency cue bound every wait
		for (; ;) {
			// P2-FIX-110: only a clean exit-status verdict confirms gone — an
			// UNVERIFIABLE poll (binary vanished) never does, so the grace
			// window runs its course and the escalation proceeds (never a
			// fabricated reap)
			if ((await this.remotePidAlive(connection, pid)) === 'NOT_ALIVE') {
				return true;
			}
			if (this.clock() >= deadline) {
				return false;
			}
			await this.sleep(this.pollIntervalMs);
		}
	}

	/**
	 * Polls the remote harness log until the harness's OWN stdio protocol
	 * reports ready (pid) or error — bounded by the readiness window.
	 * DL-81 / P2-FIX-109: the POST-SPAWN/PRE-CONFIRM cancellation checkpoint
	 * is observed on EVERY poll iteration — a minted cancel resolves the loop
	 * with the `cancelled` arm (the caller performs the defensive remote reap
	 * before returning CANCELLED).
	 */
	private async awaitReady(envId: string, connection: { readonly host: string; readonly port?: number; readonly user?: string }, ctx: ExecutorOpContext): Promise<{ cancelled: false; ok: true; pid: number } | { cancelled: false; ok: false; error: { code: string; message: string } } | { cancelled: true }> {
		const deadline = this.clock() + this.startTimeoutMs; // the injected clock + latency cue bound every wait
		for (; ;) {
			if (ctx.cancellation.cancelled) {
				return { cancelled: true };
			}
			const log = await this.cli.spawnCli([...this.baseArgv(connection), 'cat', this.remoteLogFileOf(envId)], { timeoutMs: this.commandTimeoutMs + this.connectTimeoutMs });
			const parsed = parseHarnessStdio(log.stdout);
			if (parsed.readyPid !== undefined) {
				return { cancelled: false, ok: true, pid: parsed.readyPid };
			}
			if (parsed.error !== undefined) {
				return { cancelled: false, ok: false, error: { code: 'START_FAILED', message: `remote harness for '${envId}' reported a protocol error: ${parsed.error}` } };
			}
			if (this.clock() >= deadline) {
				return { cancelled: false, ok: false, error: { code: 'START_FAILED', message: `remote harness for '${envId}' did not report ready within ${this.startTimeoutMs} ms (log so far: ${excerpt(log.stdout + log.stderr, 160) || 'empty'})` } };
			}
			await this.sleep(this.pollIntervalMs);
		}
	}
}
