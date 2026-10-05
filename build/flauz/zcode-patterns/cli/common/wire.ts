/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 CLI/headless parity contracts: request/response wire records
 * (contract module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Contract set, not a CLI runtime: this module declares types,
 *   constants, pure guards and the pure response builder below. No
 *   network client, no renderer, no process spawning - the runtime
 *   client is a later product wave; this wave pins its contract.
 * - PARITY IS PROJECTION: every CliResponse corresponds 1:1 to a
 *   service-side projection of the SAME journeys the VS Code surfaces
 *   expose (workspace, background-agent, workflow, approval, evidence,
 *   replay, lab, capability-discovery). The grammar table is derived
 *   from the existing surfaces; a CLI-only journey is UNREPRESENTABLE.
 *   SERVICE_JOURNEY_SURFACES below is the frozen service surface list
 *   (a sibling copy of grammar.ts's CLI_JOURNEYS, forced by the
 *   zero-import law) and the test suite pins the two lists deep-equal.
 *   A request whose command path names a journey outside the list is
 *   rejected 'unknown-journey'; a projection naming one is rejected
 *   'invalid-projection'. Both fail closed.
 * - NO FREE-FORM ERROR STRINGS: a typed-refusal response carries a
 *   refusalCode from the frozen refusal table and the exact violated
 *   law, copied verbatim from that table. The response types admit no
 *   other error channel.
 * - THE NON-INTERACTIVE LAW: the CliRequest shape admits no prompt
 *   flag - it carries exactly scope, contractVersion, commandPath,
 *   args, requestId and issuedAtIso, BY DESIGN. Interactive-only
 *   surfaces surface as typed refusals (refusal code
 *   'headless-interactive-surface'), disclosed, never as prompts.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; durationMs
 *   is an injected plain number.
 * - Zero-dependency: this module pulls in nothing from other modules.
 * - Every persisted record carries scope (CliScope), contractVersion
 *   and plain-string ISO timestamps.
 */

/** Version of the CLI/headless parity contract set (all modules carry it). */
export const CLI_PARITY_CONTRACTS_VERSION = '1.0.0';

/**
 * THE PARITY PIN SOURCE: the frozen service surface list - the eight
 * journeys the VS Code surfaces expose. Sibling copy of grammar.ts's
 * CLI_JOURNEYS; the test suite pins the two deep-equal. A CLI-only
 * journey is unrepresentable: nothing outside this list resolves.
 */
export const SERVICE_JOURNEY_SURFACES = [
	'workspace',
	'background-agent',
	'workflow',
	'approval',
	'evidence',
	'replay',
	'lab',
	'capability-discovery',
] as const;
export type ServiceJourney = (typeof SERVICE_JOURNEY_SURFACES)[number];

/** Pure guard: a member of the frozen service journey list. */
export function isServiceJourney(value: unknown): value is ServiceJourney {
	return typeof value === 'string' && (SERVICE_JOURNEY_SURFACES as readonly string[]).includes(value);
}

/** The closed response-outcome vocabulary (pinned by tests). */
export const CLI_OUTCOMES = ['ok', 'typed-refusal', 'not-found', 'partial'] as const;
export type CliOutcome = (typeof CLI_OUTCOMES)[number];

/**
 * THE frozen refusal table. Every typed-refusal response carries a code
 * from this table and the exact violated law, copied verbatim. The
 * table is closed: adding a refusal is a contract change requiring a
 * version bump.
 */
export const CLI_REFUSAL_CODES = [
	'headless-interactive-surface',
	'parity-projection-missing',
	'scope-isolation-violated',
] as const;
export type CliRefusalCode = (typeof CLI_REFUSAL_CODES)[number];

export interface CliRefusalEntry {
	readonly code: CliRefusalCode;
	/** The exact violated law, carried verbatim on refusal responses. */
	readonly violatedLaw: string;
}

export const CLI_REFUSAL_TABLE: readonly CliRefusalEntry[] = Object.freeze([
	{
		code: 'headless-interactive-surface',
		violatedLaw:
			'the non-interactive law: --headless requests never carry interactive prompts; interactive-only surfaces are typed refusals in headless mode, disclosed',
	},
	{
		code: 'parity-projection-missing',
		violatedLaw:
			'the parity law: parity is projection; every CLI journey corresponds 1:1 to a service-side projection, and a journey without a registered projection is refused, never silently served',
	},
	{
		code: 'scope-isolation-violated',
		violatedLaw:
			'the isolation law: requests are served only within their own workspace and tenant scope; cross-scope projections are refused',
	},
]);

/** Pure lookup: the frozen refusal entry for a code, or undefined. */
export function refusalFor(code: CliRefusalCode): CliRefusalEntry | undefined {
	for (const entry of CLI_REFUSAL_TABLE) {
		if (entry.code === code) {
			return entry;
		}
	}
	return undefined;
}

/** Isolation scope stamped on every persisted record. */
export interface CliScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

/** Pure guard: a scope with non-empty workspace and tenant ids. */
export function isCliScope(value: unknown): value is CliScope {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const scope = value as { workspaceId?: unknown; tenantId?: unknown };
	return isNonEmptyString(scope.workspaceId) && isNonEmptyString(scope.tenantId);
}

/**
 * A CLI request. The shape admits NO prompt flag, BY DESIGN (the
 * non-interactive law): exactly the six fields below, nothing else -
 * the test suite pins the key set. commandPath is the dotted
 * '<journey>.<command>' form of the frozen grammar.
 */
export interface CliRequest {
	readonly scope: CliScope;
	readonly contractVersion: string;
	readonly commandPath: string;
	/** The parsed args map (string values, per the grammar argSpecs). */
	readonly args: Readonly<Record<string, string>>;
	readonly requestId: string;
	/** ISO-8601 plain-string issue timestamp. */
	readonly issuedAtIso: string;
}

/** Pure guard: a well-formed CLI request (shape only; journey membership is enforced by responseFor). */
export function isCliRequest(value: unknown): value is CliRequest {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const request = value as Record<string, unknown>;
	if (!isCliScope(request.scope)) {
		return false;
	}
	if (request.contractVersion !== CLI_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	if (!isNonEmptyString(request.requestId)) {
		return false;
	}
	if (!isNonEmptyString(request.issuedAtIso)) {
		return false;
	}
	if (!isNonEmptyString(request.commandPath)) {
		return false;
	}
	return isStringArgsMap(request.args);
}

/** Closed completeness vocabulary of a service-side projection. */
export const PROJECTION_COMPLETENESS = ['full', 'partial'] as const;
export type ProjectionCompleteness = (typeof PROJECTION_COMPLETENESS)[number];

/** Closed service-projection kind list. */
export const SERVICE_PROJECTION_KINDS = ['projected', 'absent', 'refused'] as const;
export type ServiceProjectionKind = (typeof SERVICE_PROJECTION_KINDS)[number];

/**
 * A projected service-side state: the 1:1 parity evidence. The digest
 * is over the projected authority state the response will carry.
 */
export interface ProjectedProjection {
	readonly kind: 'projected';
	readonly journey: ServiceJourney;
	readonly commandPath: string;
	/** Opaque digest over the projected authority state. */
	readonly projectionDigest: string;
	readonly completeness: ProjectionCompleteness;
}

/** The service holds no state for the requested path: a not-found outcome. */
export interface AbsentProjection {
	readonly kind: 'absent';
	readonly journey: ServiceJourney;
	readonly commandPath: string;
}

/**
 * The service refuses to project: the typed refusal input. Carries ONLY
 * the code - the violated law is copied verbatim from the frozen table
 * by the builder, never supplied here (no free-form law strings).
 */
export interface RefusedProjection {
	readonly kind: 'refused';
	readonly journey: ServiceJourney;
	readonly commandPath: string;
	readonly refusalCode: CliRefusalCode;
}

export type ServiceProjection = ProjectedProjection | AbsentProjection | RefusedProjection;

/** Fields shared by every response variant. */
export interface CliResponseBase {
	readonly scope: CliScope;
	readonly contractVersion: string;
	readonly requestId: string;
	readonly commandPath: string;
	/** Injected plain number; echoed verbatim, never derived. */
	readonly durationMs: number;
}

export interface CliOkResponse extends CliResponseBase {
	readonly outcome: 'ok';
	readonly resultDigest: string;
}

/** The only error channel: a frozen code plus the exact violated law. */
export interface CliRefusalResponse extends CliResponseBase {
	readonly outcome: 'typed-refusal';
	readonly refusalCode: CliRefusalCode;
	readonly violatedLaw: string;
}

export interface CliNotFoundResponse extends CliResponseBase {
	readonly outcome: 'not-found';
}

export interface CliPartialResponse extends CliResponseBase {
	readonly outcome: 'partial';
	/** Digest over the partial projection actually carried. */
	readonly resultDigest: string;
}

export type CliResponse =
	| CliOkResponse
	| CliRefusalResponse
	| CliNotFoundResponse
	| CliPartialResponse;

/** Closed builder-rejection vocabulary (fail closed, violations named). */
export const WIRE_REJECTION_REASONS = [
	'invalid-scope',
	'contract-version-mismatch',
	'invalid-request-id',
	'invalid-issued-at',
	'invalid-command-path',
	'invalid-args',
	'unknown-journey',
	'invalid-projection',
	'unknown-refusal-code',
	'projection-journey-mismatch',
	'projection-path-mismatch',
	'invalid-duration',
] as const;
export type WireRejectionReason = (typeof WIRE_REJECTION_REASONS)[number];

export interface ResponseBuilt {
	readonly built: true;
	readonly response: CliResponse;
}

export interface ResponseRejected {
	readonly built: false;
	readonly reason: WireRejectionReason;
	readonly detail: string;
}

export type CliResponseOutcome = ResponseBuilt | ResponseRejected;

/**
 * Pure response builder. durationMs is the injected plain-number input
 * (the order specifies it as an input; the determinism law forbids
 * deriving it here). Validation order: request shape, request journey
 * membership in the frozen service surface list (a CLI-only journey is
 * unrepresentable - 'unknown-journey'), projection shape, projection
 * journey/path agreement with the request, refusal-code resolution,
 * then duration. Refusal responses copy the violated law verbatim from
 * the frozen table. The builder never mutates its inputs.
 */
export function responseFor(
	request: CliRequest,
	projection: ServiceProjection,
	durationMs: number,
): CliResponseOutcome {
	if (!isCliScope(request.scope)) {
		return rejectWire('invalid-scope', 'scope must carry non-empty workspaceId and tenantId');
	}
	if (request.contractVersion !== CLI_PARITY_CONTRACTS_VERSION) {
		return rejectWire(
			'contract-version-mismatch',
			`contractVersion must be '${CLI_PARITY_CONTRACTS_VERSION}', got '${request.contractVersion}'`,
		);
	}
	if (!isNonEmptyString(request.requestId)) {
		return rejectWire('invalid-request-id', 'requestId must be a non-empty string');
	}
	if (!isNonEmptyString(request.issuedAtIso)) {
		return rejectWire('invalid-issued-at', 'issuedAtIso must be a non-empty ISO-8601 string');
	}
	if (!isNonEmptyString(request.commandPath)) {
		return rejectWire('invalid-command-path', 'commandPath must be a non-empty dotted string');
	}
	if (!isStringArgsMap(request.args)) {
		return rejectWire('invalid-args', 'args must be a plain map of non-empty names to string values');
	}
	const requestJourney = journeySegmentOf(request.commandPath);
	if (!isServiceJourney(requestJourney)) {
		return rejectWire(
			'unknown-journey',
			`command path '${request.commandPath}' names journey '${requestJourney}' which is not one of the eight service journeys; a CLI-only journey is unrepresentable (parity is projection)`,
		);
	}
	const projectionCheck = projectionViolation(projection);
	if (projectionCheck !== undefined) {
		return rejectWire(projectionCheck.reason, projectionCheck.detail);
	}
	if (projection.journey !== requestJourney) {
		return rejectWire(
			'projection-journey-mismatch',
			`projection carries journey '${projection.journey}' but the request names '${requestJourney}'; every response corresponds 1:1 to the projection of its own journey`,
		);
	}
	if (projection.commandPath !== request.commandPath) {
		return rejectWire(
			'projection-path-mismatch',
			`projection carries command path '${projection.commandPath}' but the request names '${request.commandPath}'`,
		);
	}
	if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
		return rejectWire(
			'invalid-duration',
			'durationMs must be an injected finite non-negative plain number',
		);
	}
	const base = {
		scope: request.scope,
		contractVersion: CLI_PARITY_CONTRACTS_VERSION,
		requestId: request.requestId,
		commandPath: request.commandPath,
		durationMs,
	};
	if (projection.kind === 'projected') {
		if (projection.completeness === 'partial') {
			return { built: true, response: { ...base, outcome: 'partial', resultDigest: projection.projectionDigest } };
		}
		return { built: true, response: { ...base, outcome: 'ok', resultDigest: projection.projectionDigest } };
	}
	if (projection.kind === 'absent') {
		return { built: true, response: { ...base, outcome: 'not-found' } };
	}
	const entry = refusalFor(projection.refusalCode);
	if (entry === undefined) {
		return rejectWire(
			'unknown-refusal-code',
			`refusal code '${String(projection.refusalCode)}' does not resolve in the frozen refusal table`,
		);
	}
	return {
		built: true,
		response: {
			...base,
			outcome: 'typed-refusal',
			refusalCode: entry.code,
			violatedLaw: entry.violatedLaw,
		},
	};
}

/** Returns the journey segment of a dotted command path (the part before the first dot). */
function journeySegmentOf(commandPath: string): string {
	const dotIndex = commandPath.indexOf('.');
	if (dotIndex === -1) {
		return commandPath;
	}
	return commandPath.slice(0, dotIndex);
}

/** Projection shape check: typed reason + detail, or undefined when well-formed. */
function projectionViolation(projection: ServiceProjection): { reason: WireRejectionReason; detail: string } | undefined {
	const kind = (projection as { kind?: unknown }).kind;
	if (!(SERVICE_PROJECTION_KINDS as readonly string[]).includes(kind as string)) {
		return {
			reason: 'invalid-projection',
			detail: `a projection must be one of projected/absent/refused, got '${String(kind)}'`,
		};
	}
	if (!isServiceJourney(projection.journey)) {
		return {
			reason: 'invalid-projection',
			detail: `projection carries journey '${String(projection.journey)}' which is not one of the eight service journeys`,
		};
	}
	if (!isNonEmptyString(projection.commandPath)) {
		return {
			reason: 'invalid-projection',
			detail: 'projection must carry a non-empty commandPath',
		};
	}
	if (projection.kind === 'projected') {
		if (!isNonEmptyString(projection.projectionDigest)) {
			return {
				reason: 'invalid-projection',
				detail: 'a projected projection must carry a non-empty projectionDigest',
			};
		}
		if (!(PROJECTION_COMPLETENESS as readonly string[]).includes(projection.completeness)) {
			return {
				reason: 'invalid-projection',
				detail: `projection completeness must be full or partial, got '${String(projection.completeness)}'`,
			};
		}
	}
	return undefined;
}

function isStringArgsMap(value: unknown): boolean {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key.length === 0) {
			return false;
		}
		if (typeof record[key] !== 'string') {
			return false;
		}
	}
	return true;
}

function rejectWire(reason: WireRejectionReason, detail: string): ResponseRejected {
	return { built: false, reason, detail };
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
