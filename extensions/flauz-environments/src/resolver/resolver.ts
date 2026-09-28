/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 — provider resolver rung 2: the pure resolution core.
 *
 * Turns a registered provider kind's connection PLAN into a typed resolution
 * envelope through the intended vscode authority-resolution semantics. This
 * module is vscode-free (src/extension.ts owns the
 * registerRemoteAuthorityResolver call and maps the outcome onto the vscode
 * ResolverResult surface); everything here runs under plain `node --test`.
 *
 * PIPELINE (resolve(), typed result at every step — never a raw throw):
 *
 *   1. authority grammar        src/resolver/authority.ts
 *      (AUTHORITY_MALFORMED)
 *   2. environment lookup       registry.get(envId) — the descriptor registry
 *      (ENVIRONMENT_ABSENT)
 *   3. connection plan          registry.planFor(envId) — the rung-1 artifact
 *      (PLAN_ABSENT on build failure)
 *   4. TRUST gate               descriptor posture + the PIN-2 lifecycle state
 *      (TRUST_REFUSED: posture 'untrusted' OR absent from PIN-2 — the same
 *      fail-closed source the lifecycle manager enforces on start/attach,
 *      src/lifecycle/manager.ts; the resolver READS the verdict, it never
 *      re-derives trust)
 *   5. POLICY gate              enabled + connection-eligible state
 *      (POSTURE_REFUSED: disabled OR outside the running family —
 *      resolution is connection-scoped, the backing must be live)
 *   6. per-kind endpoint probe  the rung-1 seams, the rung-1 semantics:
 *        ssh-local      `ssh <target> true`    (SshCliExecutor create probe)
 *        container      `docker inspect flauz-<envId>` (describe probe)
 *        cloud-sandbox  GET {base}/v0/sandboxes/{id} (describe probe; the
 *                       sandboxId comes from the rung-1 tracking record
 *                       .flauz/env-cloud/<envId>.json; apiKeyRef resolves
 *                       ONLY through the SecretResolverPort)
 *        workspace-remote  the PIN-2 state itself (the local loopback
 *                       posture — the TL3-003 kind binding decision)
 *      (ENDPOINT_UNRESOLVED, detail = the rung-1 taxonomy code
 *      CLI_NOT_AVAILABLE / DAEMON_UNREACHABLE / CLOUD_UNREACHABLE / ...)
 *   7. bridge handshake         the vscode-test-resolver blueprint
 *      (--agent-host-bridge-port + VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN,
 *      mutually exclusive with --agent-host-port; token via the
 *      SecretResolverPort ONLY) — the handshake data rides the RESULT
 *      (SECRET_UNRESOLVED / BRIDGE_MISCONFIGURED)
 *
 * SCOPE DECISIONS (recorded, not blurred — the plan-carrying posture rung 1
 * established, extended to resolution):
 *
 *   - ssh-local is the ONE kind that carries a real TRANSPORT ENDPOINT in
 *     v0 (the SSH endpoint from the descriptor, live-probed). The remote
 *     server spawn over that endpoint (the blueprint's server install +
 *     launch machinery) is the LIVE rung — skip-gated liveRemote discipline.
 *   - container / cloud-sandbox / workspace-remote resolve to a VERIFIED
 *     BACKING (probe green, trust gated) with transport
 *     'pending-live-rung': the tree carries no TCP endpoint for them (the
 *     fixed harness is a stdio state-tracker; the cloud wire contract v0
 *     reports status, not session endpoints). The vscode boundary maps that
 *     honestly to RemoteAuthorityResolverError.NotAvailable naming the
 *     scope — NEVER a fabricated host:port.
 *   - tunnelFactory is NOT wired in v0: an ssh -L forward needs a
 *     long-lived process, the CliPort seam is bounded-invocation by design;
 *     tunnels land with the live rung behind a dedicated session port. No
 *     fake tunnel (INTEGRATION-GAP.md section 7).
 *
 * Re-resolution (context.resolveAttempt > 1, a disconnection recovery):
 * EVERY step re-reads the CURRENT registry + PIN-2 state — a trust or state
 * flip between resolves flips the verdict; nothing is cached.
 */
import { isSecretRef, joinPath, type EnvironmentDescriptor, type FileSystemPort } from '../api.ts';
import type { EnvironmentRegistry } from '../registry.ts';
import type { ConnectionPlan } from '../providers/types.ts';
import type { SshConnection, ContainerConnection, CloudSandboxConnection } from '../api.ts';
import { EnvironmentLifecycleManager, isRunningState } from '../lifecycle/index.ts';
import { excerpt, type CliPort } from '../lifecycle/cliPort.ts';
import type { HttpPort, SecretResolverPort } from '../lifecycle/cloudHttp.ts';
import { AGENT_HOST_BRIDGE_TOKEN_ENV_VAR, ResolverFailure, type FlauzResolvedData, type ResolverOutcome } from './types.ts';
import { authorityFailure, formatFlauzEnvAuthority, parseFlauzEnvAuthority } from './authority.ts';

/** The resolver context subset the pure core needs (the vscode shape). */
export interface ResolveContext {
	readonly resolveAttempt?: number;
}

export interface FlauzEnvResolverOptions {
	/** The booted descriptor registry (trust + kind lookups). */
	readonly registry: EnvironmentRegistry;
	/** The bootstrapped lifecycle manager (the PIN-2 state — the trust source). */
	readonly lifecycle: EnvironmentLifecycleManager;
	/** The process seam (ssh probe / docker inspect — the rung-1 CliPort). */
	readonly cli: CliPort;
	/** The HTTP seam (the cloud-sandbox probe — the rung-1 HttpPort). */
	readonly http: HttpPort;
	/** The vault-reference resolver (bridge tokens + cloud apiKeyRef). */
	readonly secrets: SecretResolverPort;
	/** Workspace root (the cloud tracking record path). */
	readonly root: string;
	/** fs read access to the rung-1 tracking records. */
	readonly fs: FileSystemPort;
	/** Cloud-sandbox API base URL (executor WIRING, not descriptor data — DL-29). */
	readonly cloudBaseUrl: string;
	/** ssh ConnectTimeout budget in ms (default 10 000 — the rung-1 default). */
	readonly connectTimeoutMs?: number;
	/** Per-probe wall-clock budget in ms (default 30 000 — the rung-1 default). */
	readonly probeTimeoutMs?: number;
}

/** The subset of `docker inspect` output the container probe consumes. */
interface DockerInspectReport {
	readonly Id: string;
	readonly State: { readonly Running: boolean; readonly Status: string };
}

/** The subset of the rung-1 cloud tracking record the probe consumes. */
interface CloudTrackSummary {
	readonly sandboxId: string;
	readonly status: string;
}

/** The rung-1 deterministic container name (dockerCli containerNameOf). */
export function containerNameOf(envId: string): string {
	return `flauz-${envId}`;
}

/**
 * The Flauz environment resolver core. One instance serves ALL FOUR kinds
 * under the single `flauz-env` authority prefix; per-kind behavior lives in
 * the private probe methods below.
 */
export class FlauzEnvResolver {
	private readonly registry: EnvironmentRegistry;
	private readonly lifecycle: EnvironmentLifecycleManager;
	private readonly cli: CliPort;
	private readonly http: HttpPort;
	private readonly secrets: SecretResolverPort;
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly cloudBaseUrl: string;
	private readonly connectTimeoutMs: number;
	private readonly probeTimeoutMs: number;

	constructor(options: FlauzEnvResolverOptions) {
		this.registry = options.registry;
		this.lifecycle = options.lifecycle;
		this.cli = options.cli;
		this.http = options.http;
		this.secrets = options.secrets;
		this.root = options.root;
		this.fs = options.fs;
		this.cloudBaseUrl = options.cloudBaseUrl.replace(/\/+$/, '');
		this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
		this.probeTimeoutMs = options.probeTimeoutMs ?? 30_000;
	}

	/** Resolves one Flauz environment authority (typed outcome, never a raw throw). */
	async resolve(authority: string, context?: ResolveContext): Promise<ResolverOutcome> {
		const parse = parseFlauzEnvAuthority(authority);
		if (!parse.ok) {
			return { ok: false, failure: authorityFailure(parse) };
		}
		const resolveAttempt = context?.resolveAttempt ?? 1;

		// 2. environment lookup (the registry)
		const descriptor = this.registry.get(parse.envId);
		if (descriptor === undefined) {
			return { ok: false, failure: new ResolverFailure('ENVIRONMENT_ABSENT', `environment '${parse.envId}' is not registered (authority ${JSON.stringify(authority)})`) };
		}

		// 3. the connection plan (the rung-1 artifact this resolver consumes)
		let plan: ConnectionPlan;
		try {
			plan = this.registry.planFor(parse.envId);
		} catch (err) {
			return { ok: false, failure: new ResolverFailure('PLAN_ABSENT', `connection plan for '${parse.envId}' could not be built: ${err instanceof Error ? err.message : String(err)}`) };
		}

		// 4. TRUST gate — the fail-closed verdict, READ not re-derived. An
		// untrusted environment NEVER resolves (even with a perfect plan);
		// an environment absent from the PIN-2 state is equally refused
		// (unproven backing — the same posture the lifecycle manager holds
		// for start/attach).
		if (descriptor.trust.posture === 'untrusted') {
			return { ok: false, failure: new ResolverFailure('TRUST_REFUSED', `environment '${parse.envId}' has trust posture 'untrusted' — resolution is rejected fail-closed (the lifecycle manager refuses start/attach on the same verdict; re-register with a reviewed posture — SECURITY-MODEL 3.4)`) };
		}
		const entry = this.lifecycle.entryOf(parse.envId);
		if (entry === undefined) {
			return { ok: false, failure: new ResolverFailure('TRUST_REFUSED', `environment '${parse.envId}' has no PIN-2 lifecycle entry (never created) — resolution is rejected fail-closed (an unproven backing never resolves; create the environment first)`) };
		}

		// 5. POLICY gate — enabled + connection-eligible state.
		if (!descriptor.enabled) {
			return { ok: false, failure: new ResolverFailure('POSTURE_REFUSED', `environment '${parse.envId}' is disabled — resolution is rejected (enable the descriptor first)`) };
		}
		if (!isRunningState(entry.state)) {
			return { ok: false, failure: new ResolverFailure('POSTURE_REFUSED', `environment '${parse.envId}' is in lifecycle state '${entry.state}' — resolution is connection-scoped and requires the running family (running | running/attached); start the environment first`) };
		}

		// 6+7. per-kind endpoint probe + bridge handshake.
		switch (descriptor.kind) {
			case 'ssh-local':
				return await this.resolveSsh(authority, descriptor, plan, resolveAttempt, entry.state);
			case 'container':
				return await this.resolveContainer(authority, descriptor, plan, resolveAttempt, entry.state);
			case 'cloud-sandbox':
				return await this.resolveCloud(authority, descriptor, plan, resolveAttempt, entry.state);
			case 'workspace-remote':
				return this.resolveWorkspaceRemote(authority, descriptor, plan, resolveAttempt, entry.state);
		}
	}

	// -- ssh-local: the transport endpoint kind --------------------------------

	/** The rung-1 create-probe argv (SshCliExecutor.baseArgv + `true`). */
	private sshProbeArgv(connection: SshConnection): readonly string[] {
		const argv = ['ssh', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${Math.max(1, Math.ceil(this.connectTimeoutMs / 1000))}`, '-o', 'StrictHostKeyChecking=yes'];
		if (connection.port !== undefined) {
			argv.push('-p', String(connection.port));
		}
		argv.push('--', connection.user !== undefined ? `${connection.user}@${connection.host}` : connection.host);
		argv.push('true');
		return argv;
	}

	private async resolveSsh(authority: string, descriptor: EnvironmentDescriptor, plan: ConnectionPlan, resolveAttempt: number, state: string): Promise<ResolverOutcome> {
		const connection = descriptor.connection as SshConnection;
		const target = connection.user !== undefined ? `${connection.user}@${connection.host}` : connection.host;

		// endpoint probe — the rung-1 create semantics (connectivity + auth
		// verified fail-closed before the endpoint resolves)
		const probe = await this.cli.spawnCli(this.sshProbeArgv(connection), { timeoutMs: this.probeTimeoutMs });
		if (probe.spawnError !== undefined) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the ssh binary is not available for '${descriptor.id}' (${excerpt(probe.spawnError)}) — resolution fails closed (probe: ssh ${target} true)`, 'CLI_NOT_AVAILABLE') };
		}
		if (probe.exitCode !== 0) {
			const reason = probe.stderr.length > 0 ? excerpt(probe.stderr) : excerpt(probe.stdout);
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `ssh connectivity/auth probe failed for '${descriptor.id}' (exit ${probe.exitCode}: ${reason}) — the endpoint is not resolvable (check reachability, keys and host-key pinning)`) };
		}

		// bridge handshake (the blueprint: --agent-host-bridge-port + the
		// token env; MUTUALLY EXCLUSIVE with --agent-host-port / embedded)
		const bridge = connection.agentHostBridge;
		if (bridge !== undefined && plan.agentHost.mode === 'embedded') {
			return { ok: false, failure: new ResolverFailure('BRIDGE_MISCONFIGURED', `descriptor '${descriptor.id}' carries agentHostBridge (bridgePort ${bridge.bridgePort}) but its plan is embedded (--agent-host-port) — bridged and embedded agent hosts are mutually exclusive (vscode-test-resolver blueprint :169-175)`) };
		}
		if (bridge === undefined && plan.agentHost.mode === 'bridged') {
			return { ok: false, failure: new ResolverFailure('BRIDGE_MISCONFIGURED', `plan for '${descriptor.id}' is bridged but the descriptor carries no agentHostBridge block — the bridge handshake is incomplete (bridgePort + tokenRef required)`) };
		}
		let extensionHostEnv: Readonly<Record<string, string>> | undefined;
		let handshake: FlauzResolvedData['agentHostBridge'];
		if (bridge !== undefined) {
			// DL-31/SECURITY-MODEL 3.5 defense in depth: the registry already
			// rejects literal tokens at the schema level; a drifted plan that
			// carries one is refused here too.
			if (!isSecretRef(bridge.tokenRef)) {
				return { ok: false, failure: new ResolverFailure('SECRET_UNRESOLVED', `bridge tokenRef for '${descriptor.id}' is not a vault-style reference (vault:<name> | env:<name>) — literal tokens are rejected (SECURITY-MODEL 3.5 / DL-31)`) };
			}
			const token = await this.secrets.resolve(bridge.tokenRef);
			if (token === undefined || token.length === 0) {
				return { ok: false, failure: new ResolverFailure('SECRET_UNRESOLVED', `bridge token reference ${bridge.tokenRef} for '${descriptor.id}' could not be resolved through the secret port — resolution fails closed (the token is NEVER materialized anywhere else)`, 'VAULT_REF_UNRESOLVED') };
			}
			extensionHostEnv = { [AGENT_HOST_BRIDGE_TOKEN_ENV_VAR]: token };
			handshake = { bridgePort: bridge.bridgePort, tokenEnvVar: AGENT_HOST_BRIDGE_TOKEN_ENV_VAR };
		}

		const result: FlauzResolvedData = {
			authority,
			environmentId: descriptor.id,
			kind: descriptor.kind,
			resolveAttempt,
			transport: {
				kind: 'endpoint',
				endpoint: { host: connection.host, port: connection.port ?? 22 },
			},
			...(handshake === undefined ? {} : { agentHostBridge: handshake }),
			...(extensionHostEnv === undefined ? {} : { extensionHostEnv }),
			isTrusted: true,
			backing: { probe: 'ssh-probe', identity: `ssh ${target} true (exit 0)` },
		};
		return { ok: true, result };
	}

	// -- container: verified backing, transport pending the live rung ----------

	private async resolveContainer(authority: string, descriptor: EnvironmentDescriptor, plan: ConnectionPlan, resolveAttempt: number, state: string): Promise<ResolverOutcome> {
		const name = containerNameOf(descriptor.id);
		const probe = await this.cli.spawnCli(['docker', 'inspect', name], { timeoutMs: this.probeTimeoutMs });
		if (probe.spawnError !== undefined) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the docker binary is not available for '${descriptor.id}' (${excerpt(probe.spawnError)}) — resolution fails closed`, 'CLI_NOT_AVAILABLE') };
		}
		if (probe.exitCode !== 0) {
			const daemonDown = probe.stderr.includes('Cannot connect to the Docker daemon');
			const reason = excerpt(probe.stderr.length > 0 ? probe.stderr : probe.stdout);
			return {
				ok: false,
				failure: new ResolverFailure(
					'ENDPOINT_UNRESOLVED',
					daemonDown
						? `the docker daemon is unreachable for '${descriptor.id}' (${reason}) — resolution fails closed`
						: `no container '${name}' for environment '${descriptor.id}' (${reason}) — the backing is not verifiable, resolution fails closed`,
					daemonDown ? 'DAEMON_UNREACHABLE' : undefined,
				),
			};
		}
		let report: DockerInspectReport | undefined;
		try {
			const reports = JSON.parse(probe.stdout) as Partial<DockerInspectReport>[];
			const first = reports[0];
			if (first !== undefined && typeof first.Id === 'string' && typeof first.State?.Running === 'boolean') {
				report = first as DockerInspectReport;
			}
		} catch {
			// unreadable truth reads as unresolvable (fail-closed)
		}
		if (report === undefined) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `docker inspect for '${name}' returned an unreadable report — the backing is not verifiable, resolution fails closed`) };
		}
		if (!report.State.Running) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `container '${name}' for environment '${descriptor.id}' is not running (State.Status: ${JSON.stringify(report.State.Status)}) — resolution is connection-scoped, the backing must be live`) };
		}
		return {
			ok: true,
			result: {
				authority,
				environmentId: descriptor.id,
				kind: descriptor.kind,
				resolveAttempt,
				transport: {
					kind: 'pending-live-rung',
					pendingReason: `container transport (docker-exec stream / published port) lands with the live server-spawn rung — rung 2 verified the backing (container ${name} running, id ${report.Id.slice(0, 12)}) without fabricating an endpoint (INTEGRATION-GAP section 7)`,
				},
				isTrusted: true,
				backing: { probe: 'docker-inspect', identity: `${name} (${report.Id})` },
			},
		};
	}

	// -- cloud-sandbox: verified backing, transport pending the live rung ------

	private async resolveCloud(authority: string, descriptor: EnvironmentDescriptor, plan: ConnectionPlan, resolveAttempt: number, state: string): Promise<ResolverOutcome> {
		const connection = descriptor.connection as CloudSandboxConnection;
		if (this.cloudBaseUrl.length === 0) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the cloud-sandbox API base URL is not configured (flauz.environments.cloudApiBaseUrl) — resolution for '${descriptor.id}' fails closed (never a fabricated endpoint)`, 'CLOUD_UNREACHABLE') };
		}
		// DL-31 defense in depth: literal keys are rejected at the schema
		// level; a drifted plan carrying one is refused here too.
		if (!isSecretRef(connection.apiKeyRef)) {
			return { ok: false, failure: new ResolverFailure('SECRET_UNRESOLVED', `apiKeyRef for '${descriptor.id}' is not a vault-style reference (vault:<name> | env:<name>) — literal API keys are rejected (SECURITY-MODEL 3.5 / DL-31)`) };
		}

		// the rung-1 tracking record holds the provider-scoped sandboxId
		const trackPath = joinPath(this.root, '.flauz', 'env-cloud', `${descriptor.id}.json`);
		const raw = await this.fs.readFileUtf8(trackPath);
		if (raw === undefined) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `no cloud tracking record for '${descriptor.id}' (${trackPath}) — the sandbox is not provisioned (start the environment first; rung 1 owns the record)`) };
		}
		let track: CloudTrackSummary | undefined;
		try {
			const value = JSON.parse(raw) as Partial<CloudTrackSummary>;
			if (typeof value.sandboxId === 'string' && typeof value.status === 'string') {
				track = value as CloudTrackSummary;
			}
		} catch {
			// unreadable truth reads as unresolvable (fail-closed)
		}
		if (track === undefined) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the cloud tracking record for '${descriptor.id}' is unreadable — the backing is not verifiable, resolution fails closed`) };
		}

		const key = await this.secrets.resolve(connection.apiKeyRef);
		if (key === undefined || key.length === 0) {
			return { ok: false, failure: new ResolverFailure('SECRET_UNRESOLVED', `apiKeyRef ${connection.apiKeyRef} for '${descriptor.id}' could not be resolved through the secret port — resolution fails closed (the key is NEVER materialized anywhere else)`, 'VAULT_REF_UNRESOLVED') };
		}

		const url = `${this.cloudBaseUrl}/v0/sandboxes/${encodeURIComponent(track.sandboxId)}`;
		let response: { readonly status: number; readonly bodyText: string };
		try {
			response = await this.http.fetch({
				method: 'GET',
				url,
				headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
				timeoutMs: this.probeTimeoutMs,
			});
		} catch (err) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the cloud-sandbox API is unreachable for '${descriptor.id}' (${err instanceof Error ? err.message : String(err)}) — resolution fails closed`, 'CLOUD_UNREACHABLE') };
		}
		if (response.status < 200 || response.status >= 300) {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `the cloud-sandbox API probe for '${descriptor.id}' (sandbox ${track.sandboxId}) returned ${response.status} — the backing is not verifiable, resolution fails closed (${excerpt(response.bodyText)})`, response.status === 401 || response.status === 403 ? 'CLOUD_AUTH_FAILED' : undefined) };
		}
		let sandboxStatus = '';
		try {
			const value = JSON.parse(response.bodyText) as { status?: unknown };
			if (typeof value.status === 'string') {
				sandboxStatus = value.status;
			}
		} catch {
			// unreadable truth reads as unresolvable (fail-closed)
		}
		if (sandboxStatus !== 'running') {
			return { ok: false, failure: new ResolverFailure('ENDPOINT_UNRESOLVED', `sandbox ${track.sandboxId} for '${descriptor.id}' is not running (status: ${JSON.stringify(sandboxStatus) || 'unreadable'}) — resolution is connection-scoped, the backing must be live`) };
		}
		return {
			ok: true,
			result: {
				authority,
				environmentId: descriptor.id,
				kind: descriptor.kind,
				resolveAttempt,
				transport: {
					kind: 'pending-live-rung',
					pendingReason: `cloud-sandbox session transport lands with the live rung (the wire contract v0 reports status, not session endpoints — a real provider integration validates/adjusts the contract, INTEGRATION-GAP section 7); rung 2 verified the backing (sandbox ${track.sandboxId} running)`,
				},
				isTrusted: true,
				backing: { probe: 'cloud-sandbox', identity: track.sandboxId },
			},
		};
	}

	// -- workspace-remote: the local loopback posture ---------------------------

	private resolveWorkspaceRemote(authority: string, descriptor: EnvironmentDescriptor, plan: ConnectionPlan, resolveAttempt: number, state: string): ResolverOutcome {
		// The TL3-003 kind binding decision: workspace-remote is served by the
		// LOCAL-REAL executor in a local-loopback posture; the backing truth
		// IS the PIN-2 lifecycle state (the executor owns the probe). The
		// loopback agent-host stand-in (the fixed harness) exposes no TCP
		// endpoint — the transport endpoint for this kind is the live rung.
		return {
			ok: true,
			result: {
				authority,
				environmentId: descriptor.id,
				kind: descriptor.kind,
				resolveAttempt,
				transport: {
					kind: 'pending-live-rung',
					pendingReason: `workspace-remote transport (the loopback agent-host stand-in is a stdio harness, no TCP endpoint) lands with the live rung — rung 2 verified the backing (PIN-2 state '${state}') without fabricating an endpoint (the TL3-003 kind binding decision)`,
				},
				isTrusted: true,
				backing: { probe: 'lifecycle-state', identity: `PIN-2 state '${state}' (executor: ${this.lifecycle.entryOf(descriptor.id)?.executorKind ?? 'none'})` },
			},
		};
	}
}

/** Re-exported so the vscode boundary formats authorities uniformly. */
export { formatFlauzEnvAuthority };
