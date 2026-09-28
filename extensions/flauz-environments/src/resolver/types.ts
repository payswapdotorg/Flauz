/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 — provider resolver rung 2: the core types.
 *
 * The authority grammar, the typed failure taxonomy and the typed resolution
 * envelope the pure resolver core produces. vscode-free, zero deps, Node
 * stdlib never imported here (the packaging-parity node-free evidence set):
 * every effect surface is an injected port (CliPort/HttpPort/
 * SecretResolverPort from src/lifecycle/ — the rung-1 seams).
 *
 * AUTHORITY GRAMMAR (pinned by test/resolverAuthority.test.ts; keep stable):
 *
 *   authority := "flauz-env" "+" <kind> "+" <envId>
 *
 *   - ONE Flauz authority prefix ("flauz-env") is registered with
 *     vscode.workspace.registerRemoteAuthorityResolver (the proposal surface
 *     at vscode-dts/vscode.proposed.resolvers.d.ts:456); the workbench
 *     dispatches every "flauz-env+..." authority to this resolver.
 *   - <kind> is one of the four v0 environment kinds (ENVIRONMENT_KINDS,
 *     src/api.ts) — the registered PROVIDER KIND is encoded in the authority.
 *   - <envId> is the registry's logical id (env-[a-z0-9][a-z0-9-]{0,47} —
 *     api.ts ENVIRONMENT_ID_PATTERN), the same id grammar the descriptors,
 *     the PIN-2 lifecycle entries and the continuity model key on.
 *
 * Examples: "flauz-env+ssh-local+env-host01",
 * "flauz-env+container+env-buildbox", "flauz-env+cloud-sandbox+env-sbx".
 *
 * TRUST/POLICY GATE (the acceptance's center of gravity — resolver.ts reads
 * the SAME fail-closed sources of truth the lifecycle manager enforces):
 *
 *   - TRUST_REFUSED: the descriptor's trust posture is "untrusted", OR the
 *     environment is absent from the PIN-2 lifecycle state (never created —
 *     an unproven environment never resolves, mirroring the manager's
 *     start/attach fail-closed gate in src/lifecycle/manager.ts).
 *   - POSTURE_REFUSED: the descriptor is disabled, or the PIN-2 lifecycle
 *     state is outside the connection-eligible running family
 *     ("running" / "running/attached") — resolution is connection-scoped,
 *     so the backing must be live.
 *   - The resolver NEVER re-derives trust: it READS the registry + PIN-2
 *     verdict on EVERY resolve() call (re-resolution after a disconnection
 *     re-checks the CURRENT state — a state flip between resolves flips
 *     the verdict; nothing is cached).
 */
import type { EnvironmentKind } from '../api.ts';

/** The ONE authority prefix the Flauz resolver registers under. */
export const FLAUZ_ENV_AUTHORITY_PREFIX = 'flauz-env';

/** The env var carrying the AHP bridge connection token (blueprint :26). */
export const AGENT_HOST_BRIDGE_TOKEN_ENV_VAR = 'VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN';

// ---------------------------------------------------------------------------
// Typed failures (mirroring the rung-1 executor taxonomy: never a raw throw)
// ---------------------------------------------------------------------------

/**
 * Machine-checkable resolver failure codes. ENDPOINT_UNRESOLVED carries the
 * rung-1 executor detail code (CLI_NOT_AVAILABLE / DAEMON_UNREACHABLE /
 * CLOUD_UNREACHABLE / ...) in `detail` — the resolver-class umbrella over
 * the executor-class capability taxonomy.
 */
export const RESOLVER_ERROR_CODES = [
	'AUTHORITY_MALFORMED',
	'ENVIRONMENT_ABSENT',
	'PLAN_ABSENT',
	'TRUST_REFUSED',
	'POSTURE_REFUSED',
	'ENDPOINT_UNRESOLVED',
	'SECRET_UNRESOLVED',
	'BRIDGE_MISCONFIGURED',
] as const;
export type ResolverErrorCode = (typeof RESOLVER_ERROR_CODES)[number];

/** Typed resolution failure (fail-closed surfaces carry a stable code). */
export class ResolverFailure extends Error {
	readonly code: ResolverErrorCode;
	/** The rung-1 executor taxonomy code when one underlies the failure. */
	readonly detail?: string;
	constructor(code: ResolverErrorCode, message: string, detail?: string) {
		super(`flauz.env-resolver/v0: ${message}`);
		this.name = 'ResolverFailure';
		this.code = code;
		this.detail = detail;
	}
}

// ---------------------------------------------------------------------------
// The typed resolution envelope (pure data; extension.ts maps it onto the
// vscode ResolverResult surface — the ONLY vscode-importing file)
// ---------------------------------------------------------------------------

/**
 * The AHP bridge handshake data carried by a bridged result (the
 * vscode-test-resolver blueprint: `--agent-host-bridge-port <port>` +
 * `VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN` env, extensions/
 * vscode-test-resolver/src/extension.ts:26, :166-194). The token VALUE rides
 * `extensionHostEnv` under `tokenEnvVar` (resolved ONLY through the
 * SecretResolverPort — never in the descriptor, never in logs); the bridge
 * port rides the envelope for the workbench / the live server-spawn rung
 * (the vscode ResolverResult has no argv surface — the handshake data rides
 * the RESULT, the workbench consumes it).
 */
export interface AgentHostBridgeHandshake {
	readonly bridgePort: number;
	readonly tokenEnvVar: string;
}

/** What the probe verified about the environment's backing truth. */
export interface ResolvedBacking {
	readonly probe: 'ssh-probe' | 'docker-inspect' | 'cloud-sandbox' | 'lifecycle-state';
	/** The backing identity the probe verified (ssh target / container id / sandbox id / state). */
	readonly identity: string;
}

/**
 * A full transport endpoint (host + port). v0 rung 2: only `ssh-local`
 * carries one — the SSH transport endpoint from the descriptor, probed live
 * by the rung-1 create probe (`ssh <target> true` through the CliPort). The
 * remote-server spawn over that endpoint is the LIVE rung (skip-gated
 * liveRemote discipline; INTEGRATION-GAP.md section 7).
 */
export interface ResolvedTransportEndpoint {
	readonly host: string;
	readonly port: number;
	readonly connectionToken?: string;
}

/**
 * The successful resolution envelope. `transport.endpoint` present = the
 * vscode boundary returns a ResolvedAuthority; `transport.pendingReason`
 * present = the kind's transport endpoint materializes with the live
 * server-spawn rung (the verified backing + the typed envelope are the
 * rung-2 artifact — the plan-carrying posture rung 1 established, extended
 * to resolution; the vscode boundary maps it honestly to
 * RemoteAuthorityResolverError.NotAvailable naming the scope).
 */
export interface FlauzResolvedData {
	readonly authority: string;
	readonly environmentId: string;
	readonly kind: EnvironmentKind;
	/** Echo of the resolver context (re-resolution attempt number). */
	readonly resolveAttempt: number;
	readonly transport:
	| { readonly kind: 'endpoint'; readonly endpoint: ResolvedTransportEndpoint }
	| { readonly kind: 'pending-live-rung'; readonly pendingReason: string };
	/** The AHP bridge handshake when the plan is bridged (ssh-local). */
	readonly agentHostBridge?: AgentHostBridgeHandshake;
	/** Env the remote extension host receives (the bridge token rides here). */
	readonly extensionHostEnv?: Readonly<Record<string, string>>;
	readonly isTrusted: boolean;
	/** What the probe verified (the honesty surface). */
	readonly backing: ResolvedBacking;
}

/** The outcome every resolve() call returns (typed, never a raw throw). */
export type ResolverOutcome =
	| { readonly ok: true; readonly result: FlauzResolvedData }
	| { readonly ok: false; readonly failure: ResolverFailure };
