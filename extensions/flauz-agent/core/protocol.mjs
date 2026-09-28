/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz seam protocol definition (TL1-003) — the versioned client-to-service
 * integration seam, shared by the core service (`core/service.mjs`, G side)
 * and the conformance suite (`test/protocol.conformance.test.ts`).
 *
 * Placement (ARCHITECTURE-LOCK §4): the seam lives at the "separate Flauz
 * service" rung — extension source imports TYPES only from the sibling
 * `protocol.d.mts` (the `contracts.d.mts` discipline); the .mjs is imported
 * at runtime only by Node (service + tests), never from shipped extension
 * code. Zero dependencies, plain Node, sandbox-safe.
 *
 * Protocol versions:
 *  - 'flauz.seam/v0' — the FROZEN wire contract of the original vertical
 *    slice (stdio NDJSON; hello -> ready; {id, cmd, args} ->
 *    {id, ok, result|error} with STRING errors; `flauz.workspace.*`,
 *    `flauz.a2a.*`, bare `ping`/`shutdown`). v0 keeps byte compatibility
 *    forever: a v0-only client must keep working against every future
 *    service, and a v0-only service must keep working against every future
 *    client.
 *  - 'flauz.seam/v1' — ADDITIVE on top of v0: negotiated via
 *    `hello.protocolVersions`; the ready message gains `protocolVersion` +
 *    `capabilities`; errors become structured `{code, message, details?}`
 *    with machine-readable `flauz.err.*` codes (v0 clients still receive
 *    the string shape); server-initiated event envelopes
 *    `{type: 'event', event, payload, ts}` formalize the v0 file-based
 *    event relay on the wire; new namespaces `flauz.health.*`,
 *    `flauz.lifecycle.*` and the fail-closed `flauz.auth.*` skeleton.
 *
 * The event envelope is field-aligned with the FlauzEventEnvelope stable
 * cross-TL contract family (ARCHITECTURE-LOCK §5: teams converge on
 * contract families, never implementation internals).
 *
 * Versioning policy (SERVICE-SEAM.md is the full spec): additive and
 * negotiated only. A version is deprecated by announcement plus one full
 * cycle, never by breakage. Unknown FUTURE versions offered by a client
 * never hard-fail the service unless the client offers nothing the service
 * supports (then: structured `flauz.err.unsupported-version` + exit 4).
 */

/** The frozen original wire contract. */
export const SEAM_PROTOCOL_V0 = 'flauz.seam/v0';

/** Additive negotiated extension: structured errors, events, health/lifecycle/auth. */
export const SEAM_PROTOCOL_V1 = 'flauz.seam/v1';

/** All supported protocol versions, ascending (the last entry is the latest). */
export const SEAM_PROTOCOL_VERSIONS = [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1];

/**
 * Service exit code when hello carries a `protocolVersions` array with no
 * mutually supported entry (documented in SERVICE-SEAM.md; distinct from
 * usage error 2 and workspace-init failure 3).
 */
export const SEAM_EXIT_PROTOCOL_MISMATCH = 4;

/**
 * Negotiate the protocol version from a hello message's `protocolVersions`
 * field.
 *
 * Rules (SERVICE-SEAM.md §Versioning):
 *  - field absent / null / not an array  -> v0 (a plain v0 hello negotiates
 *    v0; this is the v0-only-client compatibility path);
 *  - array: non-string entries are ignored; the service picks the HIGHEST
 *    version present in both the client's list and SEAM_PROTOCOL_VERSIONS
 *    (client list order is not significant);
 *  - array with no supported entry (including the empty array) -> hard
 *    mismatch: `{ok: false, error}` with the structured
 *    `flauz.err.unsupported-version` envelope. The service answers one
 *    error line and exits SEAM_EXIT_PROTOCOL_MISMATCH.
 *
 * Pure function; the service applies the result.
 *
 * @returns {{ ok: true, version: string } | { ok: false, error: object }}
 */
export function negotiateProtocolVersion(clientVersions) {
		if (clientVersions === undefined || clientVersions === null || !Array.isArray(clientVersions)) {
				return { ok: true, version: SEAM_PROTOCOL_V0 };
		}
		const requested = clientVersions.filter((version) => typeof version === 'string');
		const supported = SEAM_PROTOCOL_VERSIONS.filter((version) => requested.includes(version));
		if (supported.length === 0) {
				return {
						ok: false,
						error: seamError(
							SEAM_ERROR_CODES.UNSUPPORTED_VERSION,
							`no mutually supported seam protocol version (service supports ${SEAM_PROTOCOL_VERSIONS.join(' | ')}; client offered [${requested.join(' | ')}])`,
							{ supported: [...SEAM_PROTOCOL_VERSIONS], requested },
						),
				};
		}
		return { ok: true, version: supported[supported.length - 1] };
}

/**
 * The method namespace registry — the single source of truth for every
 * method the service dispatches, and for the protocol versions at which
 * each is dispatchable. The service's version gate is derived from this
 * table (a method requested outside its versions answers
 * `flauz.err.unknown-method`, exactly like an unregistered name).
 *
 * Entry fields:
 *  - namespace: the `flauz.<ns>` family the method belongs to;
 *  - since:     first protocol version at which the method is dispatchable;
 *  - versions:  ALL versions at which it is dispatchable (v1 is a superset
 *    of v0 for every v0 method);
 *  - status:    'stable' | 'legacy' | 'skeleton';
 *  - note:      human context.
 */
export const SEAM_METHODS = {
		// --- flauz.workspace.* — the v0 task/evidence seam (unchanged wire shapes) ---
		'flauz.workspace.createTask': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.appendEvent': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.listTasks': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.getTask': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.appendEvidence': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.createCheckpoint': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.workspace.verifyLedger': { namespace: 'flauz.workspace', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		// --- flauz.a2a.* — the v0 agent-to-agent bus (Wave 4 Lane K) ---
		'flauz.a2a.post': { namespace: 'flauz.a2a', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.a2a.collect': { namespace: 'flauz.a2a', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.a2a.list': { namespace: 'flauz.a2a', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'stable' },
		// --- legacy bare v0 commands (kept byte-compatible; namespaced twins exist at v1) ---
		'ping': { namespace: '(legacy)', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'legacy', note: 'v0 bare command; namespaced twin is flauz.health.ping (v1)' },
		'shutdown': { namespace: '(legacy)', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'legacy', note: 'v0 bare command; namespaced twin is flauz.lifecycle.shutdown (v1)' },
		// --- flauz.health.* — v1 ---
		'flauz.health.ping': { namespace: 'flauz.health', since: SEAM_PROTOCOL_V1, versions: [SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.health.status': { namespace: 'flauz.health', since: SEAM_PROTOCOL_V1, versions: [SEAM_PROTOCOL_V1], status: 'stable' },
		// --- flauz.lifecycle.* — v1, graceful and idempotent by contract ---
		'flauz.lifecycle.initialize': { namespace: 'flauz.lifecycle', since: SEAM_PROTOCOL_V1, versions: [SEAM_PROTOCOL_V1], status: 'stable' },
		'flauz.lifecycle.shutdown': { namespace: 'flauz.lifecycle', since: SEAM_PROTOCOL_V1, versions: [SEAM_PROTOCOL_V1], status: 'stable' },
		// --- flauz.auth.* — FAIL-CLOSED SKELETON, dispatchable at every version ---
		'flauz.auth.status': { namespace: 'flauz.auth', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'skeleton', note: 'answers flauz.err.not-implemented; no token logic, no secrets (ARCHITECTURE-LOCK §3)' },
		'flauz.auth.login': { namespace: 'flauz.auth', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'skeleton', note: 'answers flauz.err.not-implemented; no token logic, no secrets (ARCHITECTURE-LOCK §3)' },
		'flauz.auth.logout': { namespace: 'flauz.auth', since: SEAM_PROTOCOL_V0, versions: [SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1], status: 'skeleton', note: 'answers flauz.err.not-implemented; no token logic, no secrets (ARCHITECTURE-LOCK §3)' },
};

/** Every method of the fail-closed auth skeleton. */
export const AUTH_METHODS = ['flauz.auth.status', 'flauz.auth.login', 'flauz.auth.logout'];

/**
 * Protocol versions at which `method` is dispatchable, or null for
 * unregistered names. The service derives its version gate from this.
 */
export function seamMethodVersions(method) {
		const info = SEAM_METHODS[method];
		return info ? [...info.versions] : null;
}

/**
 * Capability namespaces advertised in the v1 ready message: every namespace
 * with at least one non-skeleton, non-legacy dispatchable method at that
 * version, sorted. The auth namespace is INTENTIONALLY absent at every
 * version — a skeleton that implements nothing advertises no capability
 * (fail-closed posture, ARCHITECTURE-LOCK §3). Unknown versions answer the
 * empty list.
 */
export function capabilitiesForVersion(version) {
		const namespaces = new Set();
		for (const info of Object.values(SEAM_METHODS)) {
				if (info.status === 'stable' && info.versions.includes(version)) {
						namespaces.add(info.namespace);
				}
		}
		return [...namespaces].sort();
}

/**
 * The v1 structured error codes (machine-readable, namespaced). The set is
 * closed for 'flauz.seam/v1'; new codes may only arrive with a new
 * negotiated protocol version (additive policy, SERVICE-SEAM.md).
 */
export const SEAM_ERROR_CODES = {
		UNSUPPORTED_VERSION: 'flauz.err.unsupported-version',
		UNKNOWN_METHOD: 'flauz.err.unknown-method',
		INVALID_PARAMS: 'flauz.err.invalid-params',
		INTERNAL: 'flauz.err.internal',
		NOT_IMPLEMENTED: 'flauz.err.not-implemented',
};

/**
 * Build a structured v1 error envelope `{code, message, details?}`. The
 * `details` key is only present when details are supplied (stable key
 * order: code, message, details).
 */
export function seamError(code, message, details) {
		const error = { code, message };
		if (details !== undefined) {
				error.details = details;
		}
		return error;
}

/** Structural guard for the structured error envelope. */
export function isSeamError(value) {
		return value !== null && typeof value === 'object'
			&& typeof value.code === 'string' && value.code.startsWith('flauz.err.')
			&& typeof value.message === 'string';
}

/**
 * The v0 string projection of a structured error: `"<code>: <message>"`.
 * Used only for protocol-level errors that have NO v0 legacy message to
 * preserve (the auth skeleton); every error with a v0 legacy message keeps
 * its exact v0 bytes (hard backward-compat bound, SERVICE-SEAM.md).
 */
export function seamErrorToString(error) {
		return `${error.code}: ${error.message}`;
}

/**
 * The server-initiated event envelope discriminator: a line
 * `{type: 'event', event, payload, ts}` on the service stdout. Field-aligned
 * with the FlauzEventEnvelope contract family (ARCHITECTURE-LOCK §5) and
 * emitted only under a negotiated protocol version >= v1 (v0 stdout carries
 * ready/error/response lines only — byte compatibility).
 */
export const SEAM_EVENT_ENVELOPE_TYPE = 'event';

/**
 * Build an event envelope. `ts` defaults to now; `payload` defaults to {}.
 * Stable key order: type, event, payload, ts.
 */
export function seamEvent(event, payload, ts) {
		return {
				type: SEAM_EVENT_ENVELOPE_TYPE,
				event,
				payload: payload && typeof payload === 'object' ? payload : {},
				ts: typeof ts === 'number' ? ts : Date.now(),
		};
}

/** Structural guard for the event envelope. */
export function isSeamEvent(value) {
		return value !== null && typeof value === 'object'
			&& value.type === SEAM_EVENT_ENVELOPE_TYPE
			&& typeof value.event === 'string'
			&& value.payload !== null && typeof value.payload === 'object'
			&& typeof value.ts === 'number';
}
