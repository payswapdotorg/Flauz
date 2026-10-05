/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 CLI/headless parity contracts: the journey parity view
 * (contract module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Contract set, not a CLI runtime: this module declares types,
 *   constants and pure functions only. The projection REGISTRY is an
 *   injected plain input - the contract checks, the runtime wires.
 * - PARITY IS PROJECTION: the view is computed over the frozen eight
 *   service journeys (a sibling copy of grammar.ts's CLI_JOURNEYS and
 *   wire.ts's SERVICE_JOURNEY_SURFACES; the test suite pins the copies
 *   deep-equal). A journey outside the list is unrepresentable here as
 *   everywhere in this set: grammar entries and registry entries
 *   naming one are typed rejections.
 * - VERDICT RULES: a journey is par-full ONLY when every grammar
 *   command in its group has a corresponding registered projection;
 *   matched === 0 (or an empty grammar group) is par-absent; anything
 *   between is par-partial.
 * - NEVER SILENT: registry paths that name a frozen journey but
 *   resolve in no grammar group are RECORDED per journey
 *   (unmatchedProjectionPaths) rather than dropped - an extension
 *   beyond the order's minimal field list, forced by the
 *   never-silent principle. parityDrift names missing journeys, extra
 *   journeys and verdict mismatches; drift is TOTAL (it always
 *   answers), and a junk expected verdict surfaces as a named
 *   mismatch, never as silence.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. The view is a pure derivation and carries NO
 *   timestamp by design: the order's field list fixes its shape, and a
 *   persisting runtime stamps it outside this contract.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   The grammar, outcome and scope shapes are sibling copies of
 *   grammar.ts's and wire.ts's, pinned structurally by the test suite
 *   (the real frozen grammar compiles directly against them).
 * - Every persisted record carries scope (CliScope) and
 *   contractVersion; the view is stamped with both by projectParity.
 */

/** Version of the CLI/headless parity contract set (all modules carry it). */
export const CLI_PARITY_CONTRACTS_VERSION = '1.0.0';

/** The closed parity-verdict vocabulary. */
export const PARITY_VERDICTS = ['par-full', 'par-partial', 'par-absent'] as const;
export type ParityVerdict = (typeof PARITY_VERDICTS)[number];

/** Pure guard: a member of the closed verdict vocabulary. */
export function isParityVerdict(value: unknown): value is ParityVerdict {
	return typeof value === 'string' && (PARITY_VERDICTS as readonly string[]).includes(value);
}

/** The frozen eight-journey list (sibling copy of grammar.ts's CLI_JOURNEYS). */
export const CLI_JOURNEYS = [
	'workspace',
	'background-agent',
	'workflow',
	'approval',
	'evidence',
	'replay',
	'lab',
	'capability-discovery',
] as const;
export type CliJourney = (typeof CLI_JOURNEYS)[number];

/** The closed outcome vocabulary (sibling copy of wire.ts's CLI_OUTCOMES). */
export const CLI_OUTCOMES = ['ok', 'typed-refusal', 'not-found', 'partial'] as const;
export type CliOutcome = (typeof CLI_OUTCOMES)[number];

/** The closed arg-kind vocabulary (sibling copy of grammar.ts's CLI_ARG_KINDS). */
export const CLI_ARG_KINDS = ['string', 'number', 'boolean', 'json'] as const;
export type CliArgKind = (typeof CLI_ARG_KINDS)[number];

/** Isolation scope (sibling copy of wire.ts's CliScope). */
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

/** One typed arg triplet (sibling copy of grammar.ts's CliArgSpec). */
export interface CliArgSpec {
	readonly name: string;
	readonly required: boolean;
	readonly argKind: CliArgKind;
}

/** One grammar entry (sibling copy of grammar.ts's CliGrammarEntry). */
export interface CliGrammarEntry {
	readonly journey: CliJourney;
	readonly command: string;
	readonly path: string;
	readonly argSpec: readonly CliArgSpec[];
	readonly summaryDigest: string;
}

/**
 * One registered service projection: the injected plain input. The
 * runtime wires the registry from the real service surfaces; the
 * contract only checks it. lastOutcome feeds the per-journey
 * response-outcome distribution (a registry entry is one observed
 * projection of its command path).
 */
export interface RegisteredProjection {
	/** Dotted command path; its journey segment must be a frozen journey. */
	readonly commandPath: string;
	readonly lastOutcome: CliOutcome;
}

/** Closed parity-computation rejection vocabulary (fail closed, violations named). */
export const PARITY_REJECTION_REASONS = [
	'invalid-scope',
	'invalid-grammar',
	'unknown-journey',
	'invalid-projection',
	'unknown-outcome',
] as const;
export type ParityRejectionReason = (typeof PARITY_REJECTION_REASONS)[number];

/** Per-journey parity: coverage, distribution, unmatched paths, verdict. */
export interface JourneyParityEntry {
	readonly journey: CliJourney;
	/** Grammar commands in this journey's group. */
	readonly grammarCoverage: number;
	/** Distinct grammar paths of the group with a registered projection. */
	readonly registeredProjections: number;
	/**
	 * Registry paths of this journey that resolve in NO grammar group -
	 * recorded, never dropped (the never-silent principle; grammar
	 * drift made visible in the view itself).
	 */
	readonly unmatchedProjectionPaths: readonly string[];
	/** Outcome counts over every registry entry of this journey. */
	readonly outcomeDistribution: Readonly<Record<CliOutcome, number>>;
	readonly verdict: ParityVerdict;
}

/** The journey parity view: the persisted parity record. */
export interface JourneyParityView {
	readonly scope: CliScope;
	readonly contractVersion: string;
	/** One entry per frozen journey, in frozen list order. */
	readonly journeys: readonly JourneyParityEntry[];
}

export interface ParityViewBuilt {
	readonly built: true;
	readonly view: JourneyParityView;
}

export interface ParityViewRejected {
	readonly built: false;
	readonly reason: ParityRejectionReason;
	readonly detail: string;
}

export type ParityOutcome = ParityViewBuilt | ParityViewRejected;

/**
 * Pure parity projection. scope is the required third input (the
 * persisted-record law stamps it on the view; the order's two-argument
 * signature is extended, not replaced - grammar and projections keep
 * their positions). Validation fails closed and names violations:
 * grammar entries must carry frozen journeys, non-empty dotted paths
 * consistent with their journey, and unique paths; registry entries
 * must carry non-empty paths, frozen outcomes and frozen journey
 * segments. Registry paths that name a frozen journey but no grammar
 * command are tolerated and RECORDED per journey. Never mutates
 * inputs; never throws.
 */
export function projectParity(
	grammar: readonly CliGrammarEntry[],
	projections: readonly RegisteredProjection[],
	scope: CliScope,
): ParityOutcome {
	if (!isCliScope(scope)) {
		return rejectParity('invalid-scope', 'scope must carry non-empty workspaceId and tenantId');
	}
	const seenPaths = new Set<string>();
	for (const entry of grammar) {
		if (typeof entry !== 'object' || entry === null) {
			return rejectParity('invalid-grammar', 'every grammar entry must be an object');
		}
		if (!(CLI_JOURNEYS as readonly string[]).includes(entry.journey)) {
			return rejectParity(
				'unknown-journey',
				`grammar entry names journey '${String(entry.journey)}' which is not one of the eight service journeys; a CLI-only journey is unrepresentable (parity is projection)`,
			);
		}
		if (!isNonEmptyString(entry.path)) {
			return rejectParity(
				'invalid-grammar',
				`grammar entry of journey '${entry.journey}' must carry a non-empty path`,
			);
		}
		if (!entry.path.startsWith(`${entry.journey}.`)) {
			return rejectParity(
				'invalid-grammar',
				`grammar entry declares journey '${entry.journey}' but carries path '${entry.path}'; the path must extend its own journey`,
			);
		}
		if (seenPaths.has(entry.path)) {
			return rejectParity(
				'invalid-grammar',
				`grammar path '${entry.path}' appears more than once`,
			);
		}
		seenPaths.add(entry.path);
	}
	for (const projection of projections) {
		if (typeof projection !== 'object' || projection === null) {
			return rejectParity('invalid-projection', 'every registry entry must be an object');
		}
		if (!isNonEmptyString(projection.commandPath)) {
			return rejectParity('invalid-projection', 'every registry entry must carry a non-empty commandPath');
		}
		if (!(CLI_OUTCOMES as readonly string[]).includes(projection.lastOutcome)) {
			return rejectParity(
				'unknown-outcome',
				`registry entry '${projection.commandPath}' carries lastOutcome '${String(projection.lastOutcome)}' which is not one of ok/typed-refusal/not-found/partial`,
			);
		}
		const segment = journeySegmentOf(projection.commandPath);
		if (!(CLI_JOURNEYS as readonly string[]).includes(segment)) {
			return rejectParity(
				'unknown-journey',
				`registry entry '${projection.commandPath}' names journey '${segment}' which is not one of the eight service journeys; a CLI-only journey is unrepresentable (parity is projection)`,
			);
		}
	}
	const entries: JourneyParityEntry[] = [];
	for (const journey of CLI_JOURNEYS) {
		const groupPaths = new Set<string>();
		for (const entry of grammar) {
			if (entry.journey === journey) {
				groupPaths.add(entry.path);
			}
		}
		const matchedPaths = new Set<string>();
		const unmatchedPaths = new Set<string>();
		const distribution: Record<CliOutcome, number> = {
			ok: 0,
			'typed-refusal': 0,
			'not-found': 0,
			partial: 0,
		};
		for (const projection of projections) {
			if (journeySegmentOf(projection.commandPath) !== journey) {
				continue;
			}
			distribution[projection.lastOutcome] += 1;
			if (groupPaths.has(projection.commandPath)) {
				matchedPaths.add(projection.commandPath);
			} else {
				unmatchedPaths.add(projection.commandPath);
			}
		}
		const coverage = groupPaths.size;
		const matched = matchedPaths.size;
		const verdict: ParityVerdict =
			coverage === 0 || matched === 0
				? 'par-absent'
				: matched < coverage
					? 'par-partial'
					: 'par-full';
		entries.push({
			journey,
			grammarCoverage: coverage,
			registeredProjections: matched,
			unmatchedProjectionPaths: [...unmatchedPaths],
			outcomeDistribution: distribution,
			verdict,
		});
	}
	return {
		built: true,
		view: {
			scope,
			contractVersion: CLI_PARITY_CONTRACTS_VERSION,
			journeys: entries,
		},
	};
}

/** The expected parity state: journey name to expected verdict. */
export type ExpectedParityMap = Readonly<Record<string, ParityVerdict>>;

/** One named verdict mismatch: expected vs actual, per journey. */
export interface ParityVerdictMismatch {
	readonly journey: string;
	readonly expected: ParityVerdict;
	readonly actual: ParityVerdict;
}

/** The typed drift diff: missing, extra, mismatched - never silent. */
export interface ParityDrift {
	/** True iff all three channels are empty. */
	readonly inSync: boolean;
	/** Journeys expected but absent from the view, named. */
	readonly missingJourneys: readonly string[];
	/** Journeys present in the view but not expected, named. */
	readonly extraJourneys: readonly string[];
	readonly verdictMismatches: readonly ParityVerdictMismatch[];
}

/**
 * Pure typed diff of a view against an expected parity map. Total (it
 * always answers): a junk expected verdict surfaces as a named
 * mismatch rather than an error, and any single divergence flips
 * inSync to false. Missing and extra journeys are named in encounter
 * order (expected-key order for missing; view order for extra). Never
 * mutates inputs; never throws.
 */
export function parityDrift(view: JourneyParityView, expected: ExpectedParityMap): ParityDrift {
	const viewNames = view.journeys.map((entry) => entry.journey as string);
	const expectedKeys = Object.keys(expected);
	const missingJourneys = expectedKeys.filter((key) => !viewNames.includes(key));
	const extraJourneys = viewNames.filter((name) => !expectedKeys.includes(name));
	const verdictMismatches: ParityVerdictMismatch[] = [];
	for (const entry of view.journeys) {
		const expectedVerdict = expected[entry.journey];
		if (expectedVerdict !== undefined && expectedVerdict !== entry.verdict) {
			verdictMismatches.push({
				journey: entry.journey,
				expected: expectedVerdict,
				actual: entry.verdict,
			});
		}
	}
	const inSync =
		missingJourneys.length === 0 && extraJourneys.length === 0 && verdictMismatches.length === 0;
	return { inSync, missingJourneys, extraJourneys, verdictMismatches };
}

function journeySegmentOf(commandPath: string): string {
	const dotIndex = commandPath.indexOf('.');
	if (dotIndex === -1) {
		return commandPath;
	}
	return commandPath.slice(0, dotIndex);
}

function rejectParity(reason: ParityRejectionReason, detail: string): ParityViewRejected {
	return { built: false, reason, detail };
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
