/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration service protocol contract (TL2-001 M4 / TL2-004) - pure,
 * zero-dependency. The orchestration-domain protocol layer ABOVE the TL1-003
 * service seam (SERVICE-SEAM.md).
 *
 * COMPOSITION LAW (binding, SERVICE-SEAM.md section 1 "adopt namespaces, not
 * implementations"): this module DEFINES the orchestration-domain message
 * shapes - method names, request/response shapes, the event catalog and the
 * typed failure taxonomy - while the TL1-003 seam owns TRANSPORT: the
 * hello/ready handshake, the {id, cmd, args} -> {id, ok, result|error}
 * framing, the flauz.err.* structured-error envelope and the
 * {type:'event', event, payload, ts} wire events. Nothing here re-implements
 * a seam concern; the seam definitions (negotiateProtocolVersion, seamError,
 * seamEvent, SEAM_ERROR_CODES, SEAM_PROTOCOL_V1) are IMPORTED and reused.
 * The transport adapter that carries this protocol inside the real core
 * service is a thin wiring step (the TL2-S1 secondment); until then the
 * fixtures prove the contract: the in-process mediator (core/orchMediator.mjs)
 * and the stdio loopback driver (test/harness/orchLoopback.ts).
 *
 * Protocol version 'flauz.orch/v1':
 *  - negotiated ON TOP of a negotiated 'flauz.seam/v1' session (the orch
 *    layer uses v1-only seam features: structured errors + wire events; a
 *    v0-negotiated session never carries orchestration methods);
 *  - the client offers 'orchProtocolVersions: string[]' as an ADDITIVE hello
 *    key - unknown hello keys are ignored by non-orchestration services (the
 *    documented seam rule that makes additive negotiation safe), so an orch
 *    client against a plain seam service degrades to a working seam session
 *    with NO orchestration (the client detects the absence of
 *    orchProtocolVersion in ready and surfaces a typed
 *    flauz.orch.err.unsupported-version - never a silent lie);
 *  - a negotiated orch session answers ready with the v1 fields PLUS
 *    orchProtocolVersion and the 'flauz.orch' capability (additive fields;
 *    the plain v1 ready line stays byte-identical when no orch version was
 *    offered).
 *
 * Versioning discipline mirrors the seam: additive and negotiated only; a
 * future flauz.orch/v2 only ADDS methods/events/failure codes; v1 shapes are
 * never rewritten. The versioned JSON Schema document
 * (core/orch-protocol.schema.json) is pinned bidirectionally to this module
 * by the conformance suite (method/event/failure enums and the per-method
 * required/optional key lists must agree exactly).
 *
 * FAILURE MAPPING (the M4 conformance target): every flauz.err.*-class seam
 * failure maps to a typed orchestration failure (mapSeamFailure); every
 * OrchestrationError domain code maps to a typed orchestration failure
 * (mapOrchestrationError); an unknown code of either class maps to
 * flauz.orch.err.internal - the taxonomy is a closed set and fails closed.
 * The conformance suite proves every code in ORCH_FAILURE_CODES fires from a
 * real path.
 *
 * The human authorization boundary: this protocol carries approvals and
 * takeovers as REQUESTS that gate execution. The actor gate lives in the
 * durable graph transition tables (core/orchestration.mjs) and is NOT
 * re-implemented here; a non-human decideApproval is rejected by the graph
 * itself and surfaces as a typed flauz.orch.err.illegal-transition failure.
 * Nothing in this module can auto-grant an approval.
 *
 * The approval-expiry surface (the flauz.orch.expireApproval method, the
 * orch-approval-expired event and the approval-expired journal class)
 * landed with the TL2-004 closure (M5) as an ADDITIVE growth of this same
 * v1: new method, new event, new request keys - no v1 shape rewritten.
 */

import { SEAM_PROTOCOL_V1, SEAM_ERROR_CODES } from './protocol.mjs';
import { isGraphId, isStepId, isAgentId, ORCH_ACTORS, ROUTING_REASONS } from './orchestration.mjs';

/** The orchestration-domain protocol version introduced by this module. */
export const ORCH_PROTOCOL_V1 = 'flauz.orch/v1';

/** All supported orchestration protocol versions, ascending. */
export const ORCH_PROTOCOL_VERSIONS = [ORCH_PROTOCOL_V1];

/** The method namespace this protocol owns. */
export const ORCH_NAMESPACE = 'flauz.orch';

/** The capability token advertised in ready when an orch version is negotiated. */
export const ORCH_CAPABILITY = 'flauz.orch';

const TASK_ID_PATTERN = /^T-\d{3,}$/;
const EVIDENCE_KINDS = ['changeset', 'screenshot', 'command-output', 'note', 'checkpoint'];
const SHA256_HEX = /^[0-9a-f]{64}$/;

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
	const keys = Object.keys(value);
	if (keys.length < required.length || keys.length > required.length + optional.length) {
		return false;
	}
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			return false;
		}
	}
	for (const key of keys) {
		if (!required.includes(key) && !optional.includes(key)) {
			return false;
		}
	}
	return true;
}

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// The method registry (the SEAM_METHODS discipline, orchestration domain)
// ---------------------------------------------------------------------------

/**
 * Every orchestration method the service side dispatches, with the protocol
 * version that introduced it and the versions at which it is dispatchable.
 * The service's dispatch gate is DERIVED from this table (an unregistered
 * name and a registered name outside its versions both answer
 * flauz.orch.err.unknown-method, exactly like the seam registry).
 */
export const ORCH_METHODS = {
	'flauz.orch.submitGraph': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'task-submit: submit a durable task graph' },
	'flauz.orch.approveGraph': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'human gate: approve a submitted graph' },
	'flauz.orch.rejectGraph': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'human gate: send a submitted graph back to planning' },
	'flauz.orch.cancelGraph': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'coherent cancellation sweep' },
	'flauz.orch.getGraph': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'step-state read: the replay-derived graph summary' },
	'flauz.orch.listGraphs': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'list graph projections' },
	'flauz.orch.verifyJournal': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'hash-chain verification of the journal' },
	'flauz.orch.startStep': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'start one step attempt (mints the idempotency key)' },
	'flauz.orch.finishStep': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'finish an attempt (succeeded w/ evidence | failed w/ class)' },
	'flauz.orch.retryStep': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'schedule a policy retry' },
	'flauz.orch.requestApproval': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'approval-request: a REQUEST that gates execution (never a grant)' },
	'flauz.orch.decideApproval': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'human decision: granted | denied' },
	'flauz.orch.expireApproval': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'TL2-004: the fail-closed service timeout of a deadline-bearing pending approval (the step is cancelled, never auto-granted)' },
	'flauz.orch.requestTakeover': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'takeover REQUEST (human or agent may suggest; only human accepts)' },
	'flauz.orch.acceptTakeover': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'human gate: accept a takeover' },
	'flauz.orch.completeTakeover': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'human gate: complete a taken-over step with evidence' },
	'flauz.orch.acquireClaim': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'lease-op: exclusive step claim' },
	'flauz.orch.releaseClaim': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'lease-op: release a step claim' },
	'flauz.orch.acquireLease': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'lease-op: acquire a TTL lease on a step' },
	'flauz.orch.renewLease': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'lease-op: renew the active lease' },
	'flauz.orch.releaseLease': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'lease-op: release the active lease' },
	'flauz.orch.noticeConflict': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'record a claim/lease conflict notice (informational v0 enforcement)' },
	'flauz.orch.routeStep': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'durable routing decision record (why this agent)' },
	'flauz.orch.recoveryScan': { namespace: ORCH_NAMESPACE, since: ORCH_PROTOCOL_V1, versions: [ORCH_PROTOCOL_V1], status: 'stable', note: 'recovery-scan: the restart recovery pass over every graph' },
};

/** Every registered method name (schema-parity export). */
export const ORCH_METHOD_NAMES = Object.keys(ORCH_METHODS);

/**
 * Protocol versions at which `method` is dispatchable, or null for
 * unregistered names (the seamMethodVersions discipline).
 */
export function orchMethodVersions(method) {
	const info = ORCH_METHODS[method];
	return info ? [...info.versions] : null;
}

// ---------------------------------------------------------------------------
// The failure taxonomy (typed orchestration failures; closed set)
// ---------------------------------------------------------------------------

/**
 * The typed orchestration failure codes. Every seam flauz.err.* failure and
 * every OrchestrationError domain code maps into this set; unmapped codes
 * land on internal (fail closed). New codes only arrive with a new
 * negotiated orchestration protocol version.
 */
export const ORCH_FAILURE_CODES = {
	UNSUPPORTED_VERSION: 'flauz.orch.err.unsupported-version',
	UNKNOWN_METHOD: 'flauz.orch.err.unknown-method',
	INVALID_PARAMS: 'flauz.orch.err.invalid-params',
	NOT_READY: 'flauz.orch.err.not-ready',
	SHUTTING_DOWN: 'flauz.orch.err.shutting-down',
	UNKNOWN_GRAPH: 'flauz.orch.err.unknown-graph',
	UNKNOWN_STEP: 'flauz.orch.err.unknown-step',
	ILLEGAL_TRANSITION: 'flauz.orch.err.illegal-transition',
	NOT_IMPLEMENTED: 'flauz.orch.err.not-implemented',
	INTERNAL: 'flauz.orch.err.internal',
};

/** Every failure code value (schema-parity export). */
export const ORCH_FAILURE_CODE_VALUES = Object.values(ORCH_FAILURE_CODES);

/**
 * Build a typed orchestration failure `{code, message, details?, seamCode?,
 * domainCode?}`. `seamCode` records the originating seam flauz.err.* code and
 * `domainCode` the originating OrchestrationError code when the failure is a
 * mapping (provenance of the mapping, never silently dropped).
 */
export function orchFailure(code, message, details) {
	const failure = { code, message };
	if (details !== undefined) {
		failure.details = details;
	}
	return failure;
}

/**
 * The failure carrier thrown by the mediator and the transport adapter: an
 * Error whose .orchFailure is the typed envelope (the SeamProtocolFailure
 * pattern; .message stays the plain message so .message matching works).
 */
export class OrchProtocolFailure extends Error {
	constructor(failure) {
		super(failure.message);
		this.name = 'OrchProtocolFailure';
		this.orchFailure = failure;
	}
}

/**
 * The typed failure of any thrown value: an OrchProtocolFailure carries its
 * own; an OrchestrationError maps by domain code; anything else maps to
 * internal (fail closed).
 */
export function orchFailureOf(error) {
	if (error instanceof OrchProtocolFailure) {
		return error.orchFailure;
	}
	return mapOrchestrationError(error);
}

/** Structural guard for the typed orchestration failure. */
export function isOrchFailure(value) {
	return isPlainObject(value)
		&& typeof value.code === 'string' && value.code.startsWith('flauz.orch.err.')
		&& typeof value.message === 'string';
}

/** The OrchestrationError.code -> typed failure code table (closed mapping). */
export const ORCHESTRATION_ERROR_CODE_MAP = {
	'invalid-params': ORCH_FAILURE_CODES.INVALID_PARAMS,
	'unknown-graph': ORCH_FAILURE_CODES.UNKNOWN_GRAPH,
	'unknown-step': ORCH_FAILURE_CODES.UNKNOWN_STEP,
	'illegal-transition': ORCH_FAILURE_CODES.ILLEGAL_TRANSITION,
	// FLAUZ-TL2-F1 (INV-3 level 3): the store's typed cancelled-observed
	// outcome. Maps onto the existing wire failure (the closed flauz.orch.err.*
	// taxonomy is unchanged at the seam); the store-level code + message carry
	// the stale-run distinction for runners. Promoting it to a first-class
	// flauz.orch.err.stale-run-cancelled code is a versioned additive protocol
	// proposal (see the lane REPORT).
	'stale-run-cancelled': ORCH_FAILURE_CODES.ILLEGAL_TRANSITION,
	'corrupt-graphs': ORCH_FAILURE_CODES.INTERNAL,
	'corrupt-journal': ORCH_FAILURE_CODES.INTERNAL,
	'internal': ORCH_FAILURE_CODES.INTERNAL,
};

/** The seam flauz.err.* code -> typed failure code table (closed mapping). */
export const SEAM_FAILURE_CODE_MAP = {
	[SEAM_ERROR_CODES.UNSUPPORTED_VERSION]: ORCH_FAILURE_CODES.UNSUPPORTED_VERSION,
	[SEAM_ERROR_CODES.UNKNOWN_METHOD]: ORCH_FAILURE_CODES.UNKNOWN_METHOD,
	[SEAM_ERROR_CODES.INVALID_PARAMS]: ORCH_FAILURE_CODES.INVALID_PARAMS,
	[SEAM_ERROR_CODES.INTERNAL]: ORCH_FAILURE_CODES.INTERNAL,
	[SEAM_ERROR_CODES.NOT_IMPLEMENTED]: ORCH_FAILURE_CODES.NOT_IMPLEMENTED,
};

/**
 * Map a structured seam error envelope `{code, message, details?}` (or an
 * unknown value) to a typed orchestration failure. Unknown flauz.err.* codes
 * map to internal - the taxonomy is closed and never passes an unmapped code
 * through silently.
 */
export function mapSeamFailure(error) {
	const seamCode = isPlainObject(error) && typeof error.code === 'string' ? error.code : null;
	const message = isPlainObject(error) && typeof error.message === 'string' && error.message.length > 0 ? error.message : 'unknown seam failure';
	const code = seamCode !== null && Object.prototype.hasOwnProperty.call(SEAM_FAILURE_CODE_MAP, seamCode)
		? SEAM_FAILURE_CODE_MAP[seamCode]
		: ORCH_FAILURE_CODES.INTERNAL;
	const failure = orchFailure(code, message, isPlainObject(error) && isPlainObject(error.details) ? { ...error.details } : undefined);
	failure.seamCode = seamCode;
	return failure;
}

/**
 * Map a thrown domain error to a typed orchestration failure. An
 * OrchestrationError maps by its code; everything else is internal.
 */
export function mapOrchestrationError(error) {
	if (error !== null && typeof error === 'object' && error.name === 'OrchestrationError' && typeof error.code === 'string') {
		const code = Object.prototype.hasOwnProperty.call(ORCHESTRATION_ERROR_CODE_MAP, error.code)
			? ORCHESTRATION_ERROR_CODE_MAP[error.code]
			: ORCH_FAILURE_CODES.INTERNAL;
		const failure = orchFailure(code, error instanceof Error ? error.message : String(error));
		failure.domainCode = error.code;
		return failure;
	}
	return orchFailure(ORCH_FAILURE_CODES.INTERNAL, error instanceof Error ? error.message : String(error));
}

// ---------------------------------------------------------------------------
// Negotiation (composition with the TL1-003 seam handshake)
// ---------------------------------------------------------------------------

/**
 * Negotiate the orchestration protocol version from the ADDITIVE hello key
 * `orchProtocolVersions` (the negotiateProtocolVersion discipline, with one
 * deliberate difference: the orchestration layer has NO legacy default - no
 * offer means the layer is INERT, never silently v1).
 *
 *  - absent / null / not an array -> { offered: false } (the plain seam path);
 *  - array: non-string entries ignored; the highest version present in both
 *    the client's list and ORCH_PROTOCOL_VERSIONS wins (order insignificant);
 *  - array with no supported entry (including []) -> a typed
 *    flauz.orch.err.unsupported-version failure (the SERVICE answers the
 *    plain seam ready without orch fields; the CLIENT surfaces this failure
 *    from the absent orchProtocolVersion - see orchSessionOf).
 */
export function negotiateOrchVersion(clientVersions) {
	if (clientVersions === undefined || clientVersions === null || !Array.isArray(clientVersions)) {
		return { offered: false };
	}
	const requested = clientVersions.filter((version) => typeof version === 'string');
	const supported = ORCH_PROTOCOL_VERSIONS.filter((version) => requested.includes(version));
	if (supported.length === 0) {
		return {
			offered: true,
			ok: false,
			failure: orchFailure(
				ORCH_FAILURE_CODES.UNSUPPORTED_VERSION,
				`no mutually supported orchestration protocol version (service supports ${ORCH_PROTOCOL_VERSIONS.join(' | ')}; client offered [${requested.join(' | ')}])`,
				{ supported: [...ORCH_PROTOCOL_VERSIONS], requested },
			),
		};
	}
	return { offered: true, ok: true, version: supported[supported.length - 1] };
}

/** The orch offer of a hello message (the additive `orchProtocolVersions` key), or null when not offered. */
export function orchHelloOffer(hello) {
	if (!isPlainObject(hello)) {
		return null;
	}
	const offer = hello.orchProtocolVersions;
	return Array.isArray(offer) ? offer : null;
}

/**
 * Compose the ready message of a negotiated orch session: the seam v1 ready
 * PLUS `orchProtocolVersion` and the 'flauz.orch' capability (additive
 * fields; the plain v1 ready is returned UNCHANGED when no orch version was
 * negotiated - byte compatibility of the non-orchestration surface).
 */
export function composeOrchReady(ready, orchVersion) {
	if (!ORCH_PROTOCOL_VERSIONS.includes(orchVersion)) {
		return ready;
	}
	const composed = { ...ready, orchProtocolVersion: orchVersion };
	if (Array.isArray(composed.capabilities)) {
		composed.capabilities = composed.capabilities.includes(ORCH_CAPABILITY)
			? [...composed.capabilities]
			: [...composed.capabilities, ORCH_CAPABILITY];
	} else {
		composed.capabilities = [ORCH_CAPABILITY];
	}
	return composed;
}

/**
 * The client-side orchestration handshake outcome:
 *  - no orch offer sent -> { orch: false, version: null } (not an error; the
 *    client simply did not ask for orchestration);
 *  - offer sent + ready carries a supported orchProtocolVersion -> { orch: true, version };
 *  - offer sent + ready carries none -> a typed flauz.orch.err.unsupported-version
 *    failure (the service cannot do what the client asked for - surfaced,
 *    never silently degraded).
 */
export function orchSessionOf(offeredVersions, ready) {
	const negotiation = negotiateOrchVersion(offeredVersions);
	if (!negotiation.offered) {
		return { orch: false, version: null, failure: null };
	}
	const readyVersion = isPlainObject(ready) && typeof ready.orchProtocolVersion === 'string' ? ready.orchProtocolVersion : null;
	if (readyVersion !== null && ORCH_PROTOCOL_VERSIONS.includes(readyVersion)) {
		return { orch: true, version: readyVersion, failure: null };
	}
	const requested = offeredVersions.filter((version) => typeof version === 'string');
	return {
		orch: false,
		version: null,
		failure: orchFailure(
			ORCH_FAILURE_CODES.UNSUPPORTED_VERSION,
			`the service does not support the offered orchestration protocol versions (offered [${requested.join(' | ')}]; the ready message carries no orchProtocolVersion)`,
			{ supported: [...ORCH_PROTOCOL_VERSIONS], requested },
		),
	};
}

/**
 * Whether `method` is dispatchable in a session negotiated at
 * `seamVersion` / `orchVersion`: a registered name, inside its versions,
 * riding a v1 seam session (the registry-derived gate - anything else
 * answers unknown-method, exactly like the seam).
 */
export function orchMethodDispatchable(method, seamVersion, orchVersion) {
	const versions = orchMethodVersions(method);
	if (versions === null) {
		return false;
	}
	if (seamVersion !== SEAM_PROTOCOL_V1) {
		return false;
	}
	return versions.includes(orchVersion);
}

/**
 * The client-side local guard: calling an orchestration method without a
 * negotiated orch session fails fast with flauz.orch.err.not-ready (the
 * seamClient.requestV1 pattern, lifted to the orchestration layer).
 */
export function assertOrchSession(session, method) {
	if (!isPlainObject(session) || session.orch !== true || !ORCH_PROTOCOL_VERSIONS.includes(session.version)) {
		return orchFailure(
			ORCH_FAILURE_CODES.NOT_READY,
			`${method} requires a negotiated orchestration session (flauz.orch/v1 over flauz.seam/v1; the session has none)`,
		);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Request validation (the envelope; domain semantics stay in the store)
// ---------------------------------------------------------------------------

function evidenceItemError(item, label) {
	if (!isPlainObject(item) || !hasExactKeys(item, ['kind', 'uri', 'sha256'])) {
		return `${label}: evidence items must have exactly the keys [kind, sha256, uri]`;
	}
	if (!EVIDENCE_KINDS.includes(item.kind)) {
		return `${label}: evidence item kind must be one of ${EVIDENCE_KINDS.join(' | ')}`;
	}
	if (!isNonEmptyString(item.uri)) {
		return `${label}: evidence item uri must be a non-empty string`;
	}
	if (!SHA256_HEX.test(item.sha256)) {
		return `${label}: evidence item sha256 must be 64 lowercase hex chars`;
	}
	return undefined;
}

function provenanceError(args, label) {
	if (!ORCH_ACTORS.includes(args.actor)) {
		return `${label}: actor must be one of ${ORCH_ACTORS.join(' | ')} (got ${JSON.stringify(args.actor)})`;
	}
	if (!isNonEmptyString(args.origin)) {
		return `${label}: origin must be a non-empty provenance string`;
	}
	return undefined;
}

/**
 * The per-method required/optional request-key table. AUTHORITATIVE for the
 * JSON Schema document (core/orch-protocol.schema.json) - the conformance
 * suite pins the schema and the validator to this table exactly (a minimal
 * request with exactly the required keys validates; removing any required
 * key or adding an unknown key fails).
 */
export const ORCH_REQUEST_KEYS = {
	'flauz.orch.submitGraph': { required: ['actor', 'origin', 'steps', 'title'], optional: ['policy', 'taskId'] },
	'flauz.orch.approveGraph': { required: ['actor', 'graphId', 'origin'], optional: ['note'] },
	'flauz.orch.rejectGraph': { required: ['actor', 'graphId', 'origin'], optional: ['note'] },
	'flauz.orch.cancelGraph': { required: ['actor', 'graphId', 'origin'], optional: ['reason'] },
	'flauz.orch.getGraph': { required: ['graphId'], optional: [] },
	'flauz.orch.listGraphs': { required: [], optional: [] },
	'flauz.orch.verifyJournal': { required: [], optional: [] },
	'flauz.orch.startStep': { required: ['actor', 'graphId', 'origin', 'runnerId', 'stepId'], optional: [] },
	'flauz.orch.finishStep': { required: ['actor', 'graphId', 'origin', 'outcome', 'stepId'], optional: ['attempt', 'evidence', 'failureClass', 'message', 'output', 'retryPlanned'] },
	'flauz.orch.retryStep': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: [] },
	'flauz.orch.requestApproval': { required: ['actor', 'graphId', 'origin', 'reason', 'stepId'], optional: ['expiresAt'] },
	'flauz.orch.decideApproval': { required: ['actor', 'decision', 'graphId', 'origin', 'stepId'], optional: ['note'] },
	'flauz.orch.expireApproval': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: ['expiredAt', 'note'] },
	'flauz.orch.requestTakeover': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: ['reason'] },
	'flauz.orch.acceptTakeover': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: ['note'] },
	'flauz.orch.completeTakeover': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: ['evidence', 'summary'] },
	'flauz.orch.acquireClaim': { required: ['actor', 'graphId', 'holder', 'origin', 'stepId'], optional: [] },
	'flauz.orch.releaseClaim': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: [] },
	'flauz.orch.acquireLease': { required: ['actor', 'graphId', 'holder', 'origin', 'stepId', 'ttlMs'], optional: [] },
	'flauz.orch.renewLease': { required: ['actor', 'graphId', 'origin', 'stepId', 'ttlMs'], optional: [] },
	'flauz.orch.releaseLease': { required: ['actor', 'graphId', 'origin', 'stepId'], optional: [] },
	'flauz.orch.noticeConflict': { required: ['actor', 'actualRunner', 'expectedHolder', 'graphId', 'origin', 'stepId', 'violation'], optional: ['note'] },
	'flauz.orch.routeStep': { required: ['actor', 'graphId', 'origin', 'reason', 'targetAgent'], optional: ['details', 'stepId'] },
	'flauz.orch.recoveryScan': { required: ['actor', 'origin'], optional: ['now', 'record'] },
};

/**
 * Validate one orchestration request envelope. This layer checks STRUCTURE
 * (exact keys, id patterns, enums, provenance shapes); DOMAIN semantics
 * (DAG shape, transition legality, gates, attempt discipline) stay owned by
 * core/orchestration.mjs - nothing is duplicated.
 *
 * @returns {string | undefined} the error, or undefined when valid.
 */
export function validateOrchRequest(method, args) {
	if (!Object.prototype.hasOwnProperty.call(ORCH_REQUEST_KEYS, method)) {
		return `unknown orchestration method '${String(method)}'`;
	}
	if (!isPlainObject(args)) {
		return `${method}: request args must be a JSON object`;
	}
	const spec = ORCH_REQUEST_KEYS[method];
	if (!hasExactKeys(args, spec.required, spec.optional)) {
		return `${method}: request args must have exactly the keys [${spec.required.slice().sort().join(', ')}${spec.optional.length > 0 ? `, ${spec.optional.slice().sort().map((key) => `${key}?`).join(', ')}` : ''}]`;
	}
	const label = method;
	if (args.graphId !== undefined && !isGraphId(args.graphId)) {
		return `${label}: graphId must match /^G-\\d{3,}$/`;
	}
	if (args.stepId !== undefined && args.stepId !== null && !isStepId(args.stepId)) {
		return `${label}: stepId must match /^S-\\d{2,}$/ or be null`;
	}
	if (args.actor !== undefined) {
		const error = provenanceError(args, label);
		if (error !== undefined) {
			return error;
		}
	}
	if (method === 'flauz.orch.submitGraph') {
		if (!isNonEmptyString(args.title)) {
			return `${label}: title must be a non-empty string`;
		}
		if (!Array.isArray(args.steps) || args.steps.length === 0) {
			return `${label}: steps must be a non-empty array (step specs; the graph validator owns the deep shape)`;
		}
		if (args.taskId !== undefined && args.taskId !== null && !TASK_ID_PATTERN.test(args.taskId)) {
			return `${label}: taskId must match /^T-\\d{3,}$/ or be null`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.finishStep') {
		if (!['succeeded', 'failed'].includes(args.outcome)) {
			return `${label}: outcome must be 'succeeded' | 'failed'`;
		}
		if (args.attempt !== undefined && !isPositiveInteger(args.attempt)) {
			return `${label}: attempt must be a positive integer`;
		}
		if (args.evidence !== undefined) {
			if (!Array.isArray(args.evidence)) {
				return `${label}: evidence must be an array of {kind, uri, sha256} items`;
			}
			for (const item of args.evidence) {
				const error = evidenceItemError(item, label);
				if (error !== undefined) {
					return error;
				}
			}
		}
		if (args.failureClass !== undefined && !isNonEmptyString(args.failureClass)) {
			return `${label}: failureClass must be a non-empty string`;
		}
		if (args.retryPlanned !== undefined && typeof args.retryPlanned !== 'boolean') {
			return `${label}: retryPlanned must be a boolean`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.requestApproval') {
		if (!isNonEmptyString(args.reason)) {
			return `${label}: reason must be a non-empty string`;
		}
		if (args.expiresAt !== undefined && !isPositiveInteger(args.expiresAt)) {
			return `${label}: expiresAt must be a positive integer (epoch ms)`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.decideApproval') {
		if (!['granted', 'denied'].includes(args.decision)) {
			return `${label}: decision must be 'granted' | 'denied'`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.expireApproval') {
		if (args.expiredAt !== undefined && !isPositiveInteger(args.expiredAt)) {
			return `${label}: expiredAt must be a positive integer (epoch ms; defaults to the request deadline)`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.acquireLease' || method === 'flauz.orch.renewLease') {
		if (!isPositiveInteger(args.ttlMs)) {
			return `${label}: ttlMs must be a positive integer (epoch ms)`;
		}
	}
	if (method === 'flauz.orch.acquireClaim' || method === 'flauz.orch.acquireLease') {
		if (!isAgentId(args.holder)) {
			return `${label}: holder must be an agent id`;
		}
	}
	if (method === 'flauz.orch.startStep') {
		if (!isNonEmptyString(args.runnerId)) {
			return `${label}: runnerId must be a non-empty string`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.noticeConflict') {
		if (!['claim', 'lease'].includes(args.violation)) {
			return `${label}: violation must be 'claim' | 'lease'`;
		}
		if (!isNonEmptyString(args.expectedHolder) || !isNonEmptyString(args.actualRunner)) {
			return `${label}: expectedHolder/actualRunner must be non-empty strings`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.routeStep') {
		if (!isAgentId(args.targetAgent)) {
			return `${label}: targetAgent must be an agent id`;
		}
		if (!ROUTING_REASONS.includes(args.reason)) {
			return `${label}: reason must be one of ${ROUTING_REASONS.join(' | ')}`;
		}
		if (args.details !== undefined && !isPlainObject(args.details)) {
			return `${label}: details must be a JSON object when present`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.completeTakeover') {
		if (args.evidence !== undefined) {
			if (!Array.isArray(args.evidence)) {
				return `${label}: evidence must be an array of {kind, uri, sha256} items`;
			}
			for (const item of args.evidence) {
				const error = evidenceItemError(item, label);
				if (error !== undefined) {
					return error;
				}
			}
		}
		return undefined;
	}
	if (method === 'flauz.orch.recoveryScan') {
		if (args.record !== undefined && typeof args.record !== 'boolean') {
			return `${label}: record must be a boolean (false computes the report without appending)`;
		}
		if (args.now !== undefined && !isPositiveInteger(args.now)) {
			return `${label}: now must be a positive integer (epoch ms; the deterministic-test hook)`;
		}
		return undefined;
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Result validation (the response envelope of every method)
// ---------------------------------------------------------------------------

/**
 * Validate one orchestration method RESULT (the mediator self-checks its own
 * outputs against this - a store that ever returns an unexpected shape fails
 * loudly instead of shipping a malformed response).
 *
 * @returns {string | undefined} the error, or undefined when valid.
 */
export function validateOrchResult(method, result) {
	if (!Object.prototype.hasOwnProperty.call(ORCH_METHODS, method)) {
		return `unknown orchestration method '${String(method)}'`;
	}
	if (!isPlainObject(result)) {
		return `${method}: result must be a JSON object`;
	}
	const label = `${method} result`;
	if (method === 'flauz.orch.submitGraph') {
		if (!hasExactKeys(result, ['graphId', 'rowId', 'stepIds', 'taskId'])) {
			return `${label} must have exactly the keys [graphId, rowId, stepIds, taskId]`;
		}
		if (!isGraphId(result.graphId) || !isNonEmptyString(result.rowId)) {
			return `${label} graphId/rowId shapes are invalid`;
		}
		if (!Array.isArray(result.stepIds) || !result.stepIds.every((stepId) => isStepId(stepId))) {
			return `${label} stepIds must be an array of step ids`;
		}
		if (result.taskId !== null && !TASK_ID_PATTERN.test(result.taskId)) {
			return `${label} taskId must match /^T-\\d{3,}$/ or be null`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.getGraph') {
		if (!isGraphId(result.graphId) || typeof result.graphStatus !== 'string' || !isPlainObject(result.steps)) {
			return `${label} must carry {graphId, graphStatus, steps} (the replay-derived summary)`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.listGraphs') {
		if (!hasExactKeys(result, ['graphs']) || !Array.isArray(result.graphs)) {
			return `${label} must have exactly the key [graphs] (an array)`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.verifyJournal') {
		if (!hasExactKeys(result, ['ok', 'rows']) || typeof result.ok !== 'boolean' || !Number.isSafeInteger(result.rows)) {
			return `${label} must have exactly the keys [ok, rows]`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.startStep') {
		if (!hasExactKeys(result, ['attempt', 'idempotencyKey', 'rowId']) || !isPositiveInteger(result.attempt) || !isNonEmptyString(result.idempotencyKey)) {
			return `${label} must have exactly the keys [attempt, idempotencyKey, rowId]`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.cancelGraph') {
		if (!hasExactKeys(result, ['cancelledSteps']) || !Array.isArray(result.cancelledSteps)) {
			return `${label} must have exactly the key [cancelledSteps]`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.acquireClaim') {
		if (!hasExactKeys(result, ['claimId', 'evidenceId?', 'rowId'], []) && !hasOptional(result, ['claimId', 'rowId'], ['evidenceId'])) {
			return `${label} must have exactly the keys [claimId, rowId, evidenceId?]`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.acquireLease') {
		if (!hasOptional(result, ['leaseId', 'rowId'], ['evidenceId'])) {
			return `${label} must have exactly the keys [leaseId, rowId, evidenceId?]`;
		}
		return undefined;
	}
	if (method === 'flauz.orch.recoveryScan') {
		for (const key of ['actions', 'clean', 'graphs', 'journalRows', 'scannedAt']) {
			if (!Object.prototype.hasOwnProperty.call(result, key)) {
				return `${label} must carry the recovery report key [${key}]`;
			}
		}
		if (typeof result.clean !== 'boolean' || !Array.isArray(result.actions) || !Array.isArray(result.graphs)) {
			return `${label} recovery report shapes are invalid`;
		}
		return undefined;
	}
	// The remaining methods answer {rowId} with the optional minted evidenceId
	// (and the row-minted id linkage of TL2-004).
	if (!hasOptional(result, ['rowId'], ['evidenceId'])) {
		return `${label} must have exactly the keys [rowId, evidenceId?]`;
	}
	if (!isNonEmptyString(result.rowId)) {
		return `${label} rowId must be a non-empty string`;
	}
	if (result.evidenceId !== undefined && !/^E-\d{6,}$/.test(result.evidenceId)) {
		return `${label} evidenceId must match /^E-\\d{6,}$/ when present`;
	}
	return undefined;
}

/** hasExactKeys with an optional-key list (internal helper of validateOrchResult). */
function hasOptional(value, required, optional) {
	return hasExactKeys(value, required, optional);
}

// ---------------------------------------------------------------------------
// The event catalog (domain events over the seam event envelope)
// ---------------------------------------------------------------------------

/**
 * The orchestration event catalog. Every event rides the TL1-003 v1 wire
 * event envelope `{type:'event', event, payload, ts}` (seamEvent); the names
 * are orchestration-domain. New events may only be ADDED (the seam catalog
 * law); consumers must ignore unknown event names.
 *
 * 'orch-journal-row' is the universal step-state stream: one event per
 * appended journal row, carrying the persisted facts (the event is emitted
 * only after the row is on disk - never fabricated). The remaining events
 * are the approval/takeover/lease/claim/conflict/recovery surfaces.
 */
export const ORCH_EVENTS = {
	'orch-journal-row': { since: ORCH_PROTOCOL_V1, note: 'one per appended journal row (the step-state stream)' },
	'orch-approval-requested': { since: ORCH_PROTOCOL_V1, note: 'a step entered awaiting-approval (a REQUEST, never a grant)' },
	'orch-approval-decided': { since: ORCH_PROTOCOL_V1, note: 'the human granted or denied a pending approval' },
	'orch-approval-expired': { since: ORCH_PROTOCOL_V1, note: 'TL2-004: a deadline-bearing pending approval timed out (fail-closed - cancelled, never auto-granted)' },
	'orch-takeover-requested': { since: ORCH_PROTOCOL_V1, note: 'a takeover was requested (human or agent suggestion)' },
	'orch-takeover-accepted': { since: ORCH_PROTOCOL_V1, note: 'the human accepted a takeover' },
	'orch-takeover-completed': { since: ORCH_PROTOCOL_V1, note: 'the human completed a taken-over step with evidence' },
	'orch-claim-acquired': { since: ORCH_PROTOCOL_V1, note: 'claim notice: a step claim was acquired' },
	'orch-claim-released': { since: ORCH_PROTOCOL_V1, note: 'claim notice: a step claim was released' },
	'orch-lease-acquired': { since: ORCH_PROTOCOL_V1, note: 'lease notice: a TTL lease was acquired' },
	'orch-lease-renewed': { since: ORCH_PROTOCOL_V1, note: 'lease notice: the active lease was renewed' },
	'orch-lease-released': { since: ORCH_PROTOCOL_V1, note: 'lease notice: the active lease was released' },
	'orch-lease-expired': { since: ORCH_PROTOCOL_V1, note: 'lease notice: a lease expired (the step becomes claimable again)' },
	'orch-conflict-noticed': { since: ORCH_PROTOCOL_V1, note: 'a claim/lease conflict notice (informational v0 enforcement)' },
	'orch-recovery-scan': { since: ORCH_PROTOCOL_V1, note: 'a recovery pass recorded its scan of one graph' },
};

/** Every event name (schema-parity export). */
export const ORCH_EVENT_NAMES = Object.keys(ORCH_EVENTS);

/**
 * The journal-row-type -> domain-event mapping (the mediator projects each
 * appended row onto the catalog; row types without a domain event surface
 * only through the orch-journal-row stream).
 */
export const ORCH_ROW_EVENT_OF = {
	'approval-requested': 'orch-approval-requested',
	'approval-granted': 'orch-approval-decided',
	'approval-denied': 'orch-approval-decided',
	'approval-expired': 'orch-approval-expired',
	'takeover-requested': 'orch-takeover-requested',
	'takeover-accepted': 'orch-takeover-accepted',
	'takeover-completed': 'orch-takeover-completed',
	'claim-acquired': 'orch-claim-acquired',
	'claim-released': 'orch-claim-released',
	'lease-acquired': 'orch-lease-acquired',
	'lease-renewed': 'orch-lease-renewed',
	'lease-released': 'orch-lease-released',
	'lease-expired': 'orch-lease-expired',
	'conflict-noticed': 'orch-conflict-noticed',
	'recovery-scan': 'orch-recovery-scan',
};

/**
 * Project one journal row onto its domain event `{event, payload}` (or null
 * when the row type has no domain event). Pure; the payload mirrors the
 * persisted row facts only.
 */
export function orchEventOfRow(row) {
	if (!isPlainObject(row)) {
		return null;
	}
	const type = typeof row.type === 'string' ? row.type : null;
	if (type === null || !Object.prototype.hasOwnProperty.call(ORCH_ROW_EVENT_OF, type)) {
		return null;
	}
	const base = { graphId: row.graphId, stepId: row.stepId };
	if (type === 'approval-requested') {
		return { event: 'orch-approval-requested', payload: { ...base, reason: row.payload.reason, ...(row.payload.expiresAt !== undefined ? { expiresAt: row.payload.expiresAt } : {}) } };
	}
	if (type === 'approval-granted' || type === 'approval-denied') {
		return { event: 'orch-approval-decided', payload: { ...base, decision: type === 'approval-granted' ? 'granted' : 'denied', ...(row.payload.note !== undefined ? { note: row.payload.note } : {}) } };
	}
	if (type === 'approval-expired') {
		return { event: 'orch-approval-expired', payload: { ...base, expiredAt: row.payload.expiredAt } };
	}
	if (type === 'takeover-requested') {
		return { event: 'orch-takeover-requested', payload: { ...base, requestedBy: row.actor } };
	}
	if (type === 'takeover-accepted' || type === 'takeover-completed') {
		return { event: ORCH_ROW_EVENT_OF[type], payload: { ...base } };
	}
	if (type === 'claim-acquired' || type === 'claim-released') {
		return { event: ORCH_ROW_EVENT_OF[type], payload: { ...base, claimId: row.payload.claimId, holder: row.payload.holder } };
	}
	if (type === 'lease-acquired' || type === 'lease-renewed') {
		return { event: ORCH_ROW_EVENT_OF[type], payload: { ...base, leaseId: row.payload.leaseId, holder: row.payload.holder, expiresAt: row.payload.expiresAt } };
	}
	if (type === 'lease-released') {
		return { event: 'orch-lease-released', payload: { ...base, leaseId: row.payload.leaseId, holder: row.payload.holder } };
	}
	if (type === 'lease-expired') {
		return { event: 'orch-lease-expired', payload: { ...base, leaseId: row.payload.leaseId, holder: row.payload.holder, expiredAt: row.payload.expiredAt } };
	}
	if (type === 'conflict-noticed') {
		return { event: 'orch-conflict-noticed', payload: { ...base, violation: row.payload.violation, expectedHolder: row.payload.expectedHolder, actualRunner: row.payload.actualRunner, ...(row.payload.note !== undefined ? { note: row.payload.note } : {}) } };
	}
	// type === 'recovery-scan'
	return { event: 'orch-recovery-scan', payload: { graphId: row.graphId, clean: row.payload.clean, actions: row.payload.actions } };
}

/**
 * The orch-journal-row stream projection of one appended row (the universal
 * step-state event; carries the persisted facts only).
 */
export function journalRowEventOf(row) {
	return {
		event: 'orch-journal-row',
		payload: { graphId: row.graphId, rowId: row.rowId, seq: row.seq, type: row.type, stepId: row.stepId, actor: row.actor },
	};
}

/**
 * Validate one catalog event payload (the a2a discipline: every rule is
 * violated by a bad fixture in the conformance suite).
 *
 * @returns {string | undefined} the error, or undefined when valid.
 */
export function validateOrchEventPayload(event, payload) {
	if (!Object.prototype.hasOwnProperty.call(ORCH_EVENTS, event)) {
		return `unknown orchestration event '${String(event)}'`;
	}
	if (!isPlainObject(payload)) {
		return `orch event ${event}: payload must be a JSON object`;
	}
	const label = `orch event ${event}`;
	if (event === 'orch-journal-row') {
		if (!hasExactKeys(payload, ['actor', 'graphId', 'rowId', 'seq', 'stepId', 'type'])) {
			return `${label} payload must have exactly the keys [actor, graphId, rowId, seq, stepId, type]`;
		}
		if (!isGraphId(payload.graphId) || !isNonEmptyString(payload.rowId) || !isPositiveInteger(payload.seq)) {
			return `${label} payload graphId/rowId/seq shapes are invalid`;
		}
		if (payload.stepId !== null && !isStepId(payload.stepId)) {
			return `${label} payload stepId must be a step id or null`;
		}
		if (!ORCH_ACTORS.includes(payload.actor)) {
			return `${label} payload actor must be one of ${ORCH_ACTORS.join(' | ')}`;
		}
		return undefined;
	}
	if (!isGraphId(payload.graphId)) {
		return `${label} payload graphId must match /^G-\\d{3,}$/`;
	}
	if (payload.stepId !== undefined && payload.stepId !== null && !isStepId(payload.stepId)) {
		return `${label} payload stepId must be a step id`;
	}
	if (event === 'orch-approval-requested') {
		if (!hasExactKeys(payload, ['graphId', 'reason', 'stepId'], ['expiresAt'])) {
			return `${label} payload must have exactly the keys [expiresAt?, graphId, reason, stepId]`;
		}
		if (!isNonEmptyString(payload.reason)) {
			return `${label} payload reason must be a non-empty string`;
		}
		if (payload.expiresAt !== undefined && !isPositiveInteger(payload.expiresAt)) {
			return `${label} payload expiresAt must be a positive integer`;
		}
		return undefined;
	}
	if (event === 'orch-approval-decided') {
		if (!hasExactKeys(payload, ['decision', 'graphId', 'stepId'], ['note'])) {
			return `${label} payload must have exactly the keys [decision, graphId, note?, stepId]`;
		}
		if (!['granted', 'denied'].includes(payload.decision)) {
			return `${label} payload decision must be 'granted' | 'denied'`;
		}
		return undefined;
	}
	if (event === 'orch-approval-expired') {
		if (!hasExactKeys(payload, ['expiredAt', 'graphId', 'stepId'])) {
			return `${label} payload must have exactly the keys [expiredAt, graphId, stepId]`;
		}
		if (!isPositiveInteger(payload.expiredAt)) {
			return `${label} payload expiredAt must be a positive integer`;
		}
		return undefined;
	}
	if (event === 'orch-takeover-requested') {
		if (!hasExactKeys(payload, ['graphId', 'requestedBy', 'stepId'])) {
			return `${label} payload must have exactly the keys [graphId, requestedBy, stepId]`;
		}
		if (!ORCH_ACTORS.includes(payload.requestedBy)) {
			return `${label} payload requestedBy must be one of ${ORCH_ACTORS.join(' | ')}`;
		}
		return undefined;
	}
	if (event === 'orch-takeover-accepted' || event === 'orch-takeover-completed') {
		if (!hasExactKeys(payload, ['graphId', 'stepId'])) {
			return `${label} payload must have exactly the keys [graphId, stepId]`;
		}
		return undefined;
	}
	if (event === 'orch-claim-acquired' || event === 'orch-claim-released') {
		if (!hasExactKeys(payload, ['claimId', 'graphId', 'holder', 'stepId'])) {
			return `${label} payload must have exactly the keys [claimId, graphId, holder, stepId]`;
		}
		if (!isNonEmptyString(payload.claimId) || !isAgentId(payload.holder)) {
			return `${label} payload claimId/holder shapes are invalid`;
		}
		return undefined;
	}
	if (event === 'orch-lease-acquired' || event === 'orch-lease-renewed') {
		if (!hasExactKeys(payload, ['expiresAt', 'graphId', 'holder', 'leaseId', 'stepId'])) {
			return `${label} payload must have exactly the keys [expiresAt, graphId, holder, leaseId, stepId]`;
		}
		if (!isNonEmptyString(payload.leaseId) || !isAgentId(payload.holder) || !isPositiveInteger(payload.expiresAt)) {
			return `${label} payload leaseId/holder/expiresAt shapes are invalid`;
		}
		return undefined;
	}
	if (event === 'orch-lease-released') {
		if (!hasExactKeys(payload, ['graphId', 'holder', 'leaseId', 'stepId'])) {
			return `${label} payload must have exactly the keys [graphId, holder, leaseId, stepId]`;
		}
		if (!isNonEmptyString(payload.leaseId) || !isAgentId(payload.holder)) {
			return `${label} payload leaseId/holder shapes are invalid`;
		}
		return undefined;
	}
	if (event === 'orch-lease-expired') {
		if (!hasExactKeys(payload, ['expiredAt', 'graphId', 'holder', 'leaseId', 'stepId'])) {
			return `${label} payload must have exactly the keys [expiredAt, graphId, holder, leaseId, stepId]`;
		}
		if (!isNonEmptyString(payload.leaseId) || !isAgentId(payload.holder) || !isPositiveInteger(payload.expiredAt)) {
			return `${label} payload leaseId/holder/expiredAt shapes are invalid`;
		}
		return undefined;
	}
	if (event === 'orch-conflict-noticed') {
		if (!hasExactKeys(payload, ['actualRunner', 'expectedHolder', 'graphId', 'stepId', 'violation'], ['note'])) {
			return `${label} payload must have exactly the keys [actualRunner, expectedHolder, graphId, note?, stepId, violation]`;
		}
		if (!['claim', 'lease'].includes(payload.violation)) {
			return `${label} payload violation must be 'claim' | 'lease'`;
		}
		if (!isNonEmptyString(payload.expectedHolder) || !isNonEmptyString(payload.actualRunner)) {
			return `${label} payload expectedHolder/actualRunner must be non-empty strings`;
		}
		return undefined;
	}
	// event === 'orch-recovery-scan'
	if (!hasExactKeys(payload, ['actions', 'clean', 'graphId'])) {
		return `${label} payload must have exactly the keys [actions, clean, graphId]`;
	}
	if (typeof payload.clean !== 'boolean' || !Array.isArray(payload.actions)) {
		return `${label} payload clean/actions shapes are invalid`;
	}
	return undefined;
}
