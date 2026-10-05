/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 CLI/headless parity contracts: exit codes, output formats and
 * the headless-mode law (contract module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Contract set, not a CLI runtime: renderSpec below is a PURE SHAPE
 *   contract - WHAT fields each output format must carry. It is never
 *   a renderer: no formatting, no streaming, no terminal handling.
 * - Closed vocabularies: exit codes, outcomes, output formats, render
 *   fields, rejection reasons and modes are frozen as-const lists with
 *   derived unions, pinned by tests.
 * - THE EXIT-CODE LAW: the vocabulary is frozen at five codes
 *   (0 ok, 1 typed-refusal, 2 usage-error, 3 not-found, 4 partial).
 *   RECONCILIATION NOTE: 'usage-error' (2) is the PARSE-LAYER code -
 *   reached through grammar.ts's typed parse mismatches (argv that
 *   does not satisfy a command's argSpec), never through a response
 *   outcome: the four CliResponse outcomes map to 0/1/3/4, totally.
 *   A response whose outcome channel is corrupt (runtime junk outside
 *   the frozen outcome set) fails closed to 'usage-error' - a response
 *   that is not contract-shaped can only be caller misuse.
 * - DELIBERATE ASYMMETRY: exitCodeFor is TOTAL (an exit code is the
 *   last-resort channel and must always answer); renderSpec REJECTS
 *   with typed verdicts (a spec is a contract check and may refuse).
 * - THE NON-INTERACTIVE LAW: 'headless' mode never carries interactive
 *   prompts - the CliRequest shape in wire.ts admits no prompt flag
 *   (pinned there by a key-set test) - and interactive-only surfaces
 *   are typed refusals in headless mode, DISCLOSED via the frozen
 *   refusal code re-declared below as a sibling copy (pinned equal to
 *   wire.ts's refusal-table member by the test suite).
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; durations
 *   are injected plain numbers.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   The response shapes below are sibling copies of wire.ts's (forced
 *   by the zero-import law) and are pinned structurally by the test
 *   suite - wire-built responses compile against these signatures only
 *   because the shapes are identical.
 * - Every PERSISTED record carries scope (CliScope), contractVersion
 *   and plain-string ISO timestamps. RenderSpec is a derived shape
 *   contract, not a persisted record - it carries no scope; the
 *   responses it specs do.
 */

/** Version of the CLI/headless parity contract set (all modules carry it). */
export const CLI_PARITY_CONTRACTS_VERSION = '1.0.0';

/** The frozen five-code exit vocabulary (closed; pinned by tests). */
export const EXIT_CODES = [0, 1, 2, 3, 4] as const;
export type ExitCode = (typeof EXIT_CODES)[number];

export const EXIT_OK = 0;
export const EXIT_TYPED_REFUSAL = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_PARTIAL = 4;

/** Closed response-outcome vocabulary (sibling copy of wire.ts's). */
export const CLI_OUTCOMES = ['ok', 'typed-refusal', 'not-found', 'partial'] as const;
export type CliOutcome = (typeof CLI_OUTCOMES)[number];

/** Isolation scope (sibling copy of wire.ts's). */
export interface CliScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

/** Response base fields (sibling copy of wire.ts's). */
export interface CliResponseBase {
	readonly scope: CliScope;
	readonly contractVersion: string;
	readonly requestId: string;
	readonly commandPath: string;
	/** Injected plain number; echoed verbatim by the wire builder. */
	readonly durationMs: number;
}

export interface CliOkResponse extends CliResponseBase {
	readonly outcome: 'ok';
	readonly resultDigest: string;
}

export interface CliRefusalResponse extends CliResponseBase {
	readonly outcome: 'typed-refusal';
	readonly refusalCode: string;
	readonly violatedLaw: string;
}

export interface CliNotFoundResponse extends CliResponseBase {
	readonly outcome: 'not-found';
}

export interface CliPartialResponse extends CliResponseBase {
	readonly outcome: 'partial';
	readonly resultDigest: string;
}

export type CliResponse =
	| CliOkResponse
	| CliRefusalResponse
	| CliNotFoundResponse
	| CliPartialResponse;

/**
 * The total outcome-to-exit-code table. Every CliResponse outcome maps
 * to exactly one exit code; the test suite pins this by iterating the
 * frozen outcome set. 'usage-error' is deliberately absent from the
 * image: it is the parse-layer code (see the header's reconciliation
 * note).
 */
export const EXIT_CODE_BY_OUTCOME: Readonly<Record<CliOutcome, ExitCode>> = {
	ok: EXIT_OK,
	'typed-refusal': EXIT_TYPED_REFUSAL,
	'not-found': EXIT_NOT_FOUND,
	partial: EXIT_PARTIAL,
};

/**
 * Pure total mapping from a response to its exit code. Well-formed
 * outcomes map through the frozen table; a corrupt outcome channel
 * (runtime junk outside the frozen set) fails closed to 'usage-error'.
 * Never throws; never mutates its input.
 */
export function exitCodeFor(response: CliResponse): ExitCode {
	const outcome = (response as { outcome?: unknown }).outcome;
	if (typeof outcome === 'string' && (CLI_OUTCOMES as readonly string[]).includes(outcome)) {
		return EXIT_CODE_BY_OUTCOME[outcome as CliOutcome];
	}
	return EXIT_USAGE_ERROR;
}

/** The closed output-format vocabulary. */
export const OUTPUT_FORMATS = ['json', 'table', 'digest'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * The closed render-field vocabulary: every field name a rendered
 * output may be required to carry. Fields are the response record's
 * own field names - a render spec references them, never invents new
 * payload fields.
 */
export const RENDER_FIELDS = [
	'scope',
	'contractVersion',
	'requestId',
	'commandPath',
	'outcome',
	'durationMs',
	'resultDigest',
	'refusalCode',
	'violatedLaw',
] as const;
export type RenderField = (typeof RENDER_FIELDS)[number];

/**
 * The render spec: WHAT each output format must carry for one
 * response. requiredFields is in canonical order (base fields first,
 * outcome-specific fields after) - the order is part of the contract so
 * downstream renderers produce stable output shapes. This is a shape
 * contract, never a renderer.
 */
export interface RenderSpec {
	readonly format: OutputFormat;
	readonly outcome: CliOutcome;
	readonly requiredFields: readonly RenderField[];
}

/** Closed render-spec rejection vocabulary (fail closed, violations named). */
export const RENDER_REJECTION_REASONS = ['invalid-format', 'invalid-response'] as const;
export type RenderRejectionReason = (typeof RENDER_REJECTION_REASONS)[number];

export interface RenderSpecBuilt {
	readonly built: true;
	readonly spec: RenderSpec;
}

export interface RenderSpecRejected {
	readonly built: false;
	readonly reason: RenderRejectionReason;
	readonly detail: string;
}

export type RenderSpecOutcome = RenderSpecBuilt | RenderSpecRejected;

const JSON_BASE_FIELDS: readonly RenderField[] = [
	'scope',
	'contractVersion',
	'requestId',
	'commandPath',
	'outcome',
	'durationMs',
];

const TABLE_CORE_FIELDS: readonly RenderField[] = ['commandPath', 'outcome', 'durationMs'];

/**
 * Pure shape contract. Format rules (contract decisions; changing any
 * rule is a version bump):
 * - json: the full canonical record - every base field plus the
 *   outcome-specific fields (resultDigest for ok/partial;
 *   refusalCode and violatedLaw for typed-refusal; nothing extra for
 *   not-found).
 * - table: the human scan line - commandPath, outcome, durationMs,
 *   plus resultDigest (ok/partial) or refusalCode (typed-refusal; a
 *   law citation does not fit a table row).
 * - digest: the provenance-minimal line - resultDigest (ok/partial)
 *   or refusalCode (typed-refusal); not-found has no digest channel,
 *   so its digest-format spec names commandPath and outcome.
 * Fails closed: an unknown format or a response whose outcome channel
 * is not contract-shaped is a typed rejection naming the violation.
 */
export function renderSpec(format: OutputFormat, response: CliResponse): RenderSpecOutcome {
	if (!(OUTPUT_FORMATS as readonly string[]).includes(format as string)) {
		return rejectRender(
			'invalid-format',
			`output format must be one of json/table/digest, got '${String(format)}'`,
		);
	}
	if (typeof response !== 'object' || response === null) {
		return rejectRender('invalid-response', 'response must be a contract-shaped CliResponse object');
	}
	const outcome = (response as { outcome?: unknown }).outcome;
	if (typeof outcome !== 'string' || !(CLI_OUTCOMES as readonly string[]).includes(outcome)) {
		return rejectRender(
			'invalid-response',
			`response outcome must be one of ok/typed-refusal/not-found/partial, got '${String(outcome)}'`,
		);
	}
	const fields = fieldsFor(format as OutputFormat, outcome as CliOutcome);
	return {
		built: true,
		spec: { format: format as OutputFormat, outcome: outcome as CliOutcome, requiredFields: fields },
	};
}

function fieldsFor(format: OutputFormat, outcome: CliOutcome): readonly RenderField[] {
	switch (format) {
		case 'json':
			return [...JSON_BASE_FIELDS, ...jsonOutcomeFields(outcome)];
		case 'table':
			return [...TABLE_CORE_FIELDS, ...tableOutcomeFields(outcome)];
		case 'digest':
			return digestFields(outcome);
	}
}

function jsonOutcomeFields(outcome: CliOutcome): readonly RenderField[] {
	switch (outcome) {
		case 'ok':
		case 'partial':
			return ['resultDigest'];
		case 'typed-refusal':
			return ['refusalCode', 'violatedLaw'];
		case 'not-found':
			return [];
	}
}

function tableOutcomeFields(outcome: CliOutcome): readonly RenderField[] {
	switch (outcome) {
		case 'ok':
		case 'partial':
			return ['resultDigest'];
		case 'typed-refusal':
			return ['refusalCode'];
		case 'not-found':
			return [];
	}
}

function digestFields(outcome: CliOutcome): readonly RenderField[] {
	switch (outcome) {
		case 'ok':
		case 'partial':
			return ['resultDigest'];
		case 'typed-refusal':
			return ['refusalCode'];
		case 'not-found':
			return ['commandPath', 'outcome'];
	}
}

/** The closed mode vocabulary (the non-interactive law's modes). */
export const CLI_MODES = ['headless', 'interactive'] as const;
export type HeadlessMode = (typeof CLI_MODES)[number];

/** Pure guard: a member of the closed mode vocabulary. */
export function isHeadlessMode(value: unknown): value is HeadlessMode {
	return typeof value === 'string' && (CLI_MODES as readonly string[]).includes(value);
}

/**
 * SIBLING COPY of wire.ts's refusal-table member for the non-interactive
 * law (zero-import law). The test suite pins this constant equal to the
 * wire table's code; mismatched copies fail the gates.
 */
export const HEADLESS_INTERACTIVE_REFUSAL_CODE = 'headless-interactive-surface';

/**
 * Pure: whether the mode admits interactive surfaces (prompts).
 * 'headless' never does - interactive-only surfaces are typed refusals
 * in headless mode, disclosed. 'interactive' does (the VS Code
 * surfaces' native mode).
 */
export function admitsInteractiveSurfaces(mode: HeadlessMode): boolean {
	return mode === 'interactive';
}

/**
 * Pure: the disclosed typed-refusal code an interactive-only surface
 * produces in headless mode ('headless-interactive-surface'), or
 * undefined in interactive mode (no refusal). The violated law itself
 * is carried verbatim by wire.ts's frozen refusal table - responses
 * are built there, never here.
 */
export function interactiveRefusalCodeFor(mode: HeadlessMode): 'headless-interactive-surface' | undefined {
	return mode === 'headless' ? HEADLESS_INTERACTIVE_REFUSAL_CODE : undefined;
}

function rejectRender(reason: RenderRejectionReason, detail: string): RenderSpecRejected {
	return { built: false, reason, detail };
}
