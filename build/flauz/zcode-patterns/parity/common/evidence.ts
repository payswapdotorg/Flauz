/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/common/evidence.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- evidence labels
 * ----------------------------------------------------------------------------
 *
 * The closed evidence-label vocabulary (the AUTHORITY declaration --
 * common/matrix.ts carries the verbatim zero-dependency duplicate), the
 * EvidenceRecord contract, the pure label derivation labelFor(), and the
 * honesty-law relation labelBacksVerdict().
 *
 * This module never runs test suites, never reads the repository, never
 * computes digests. The observed facts are INJECTED as plain booleans; the
 * artifact references are INJECTED as plain strings; the pure functions
 * validate and derive.
 *
 * LAWS (violations = rejection):
 *
 * - ZERO-DEPENDENCY: no import statements in this file or any common/
 *   contract module. This module is the EVIDENCE_LABELS authority; the
 *   PARITY_VERDICTS vocabulary is duplicated verbatim from matrix.ts (the
 *   verdict authority) because labelBacksVerdict() must reference the
 *   verdicts without importing them. evidence.test.ts pins both
 *   duplications deep-equal against the authorities.
 *
 * - DETERMINISM: no Math.random, no Date.now, no new Date() -- this module
 *   is pure. capturedAtIso is a plain injected ISO-8601 UTC string; the
 *   guard below checks its SHAPE only (calendar validity is the caller's
 *   concern), and this module never constructs a timestamp.
 *
 * - FAIL-CLOSED: labelFor() returns none for anything it cannot read --
 *   malformed facts back nothing. An EvidenceRecord citing label none
 *   carries NO artifactRef (there is nothing to cite); any other label
 *   MUST cite a non-empty artifactRef.
 *
 * - HONESTY: evidence must back every confirmed verdict. labelBacksVerdict
 *   is the pure form of the law: label none backs parity-unmeasured only;
 *   the combination (none, parity-confirmed) is UNREPRESENTABLE. The same
 *   law is enforced structurally by matrix.ts -- isDomainComparisonRecord
 *   rejects any record whose verdict contradicts verdictFor() over its own
 *   fields, which subsumes (none, confirmed).
 *
 * Contract set: ZCODE_PARITY_CONTRACTS_VERSION 1.0.0 -- one versioned set;
 * matrix.ts / gate.ts / discovery.ts export the same value in lockstep,
 * pinned equal by the test suites.
 *
 * MIT License. Full text: LICENSE at the repository root.
 * ----------------------------------------------------------------------------
 */

/** Version of the ZC-010 parity contract set (lockstep across all modules). */
export const ZCODE_PARITY_CONTRACTS_VERSION = '1.0.0';

/**
 * Scope on every persisted record (duplicated across the contract set under
 * the zero-dependency law; test suites pin the guards behaviorally equal).
 */
export type ParityScope = {
	readonly workspaceId: string;
	readonly tenantId: string;
};

/** Pure structural guard: object with non-empty workspaceId and tenantId. */
export function isParityScope(value: unknown): value is ParityScope {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as { workspaceId?: unknown; tenantId?: unknown };
	return (
		typeof candidate.workspaceId === 'string' &&
		candidate.workspaceId.length > 0 &&
		typeof candidate.tenantId === 'string' &&
		candidate.tenantId.length > 0
	);
}

/**
 * The closed evidence-label vocabulary -- the AUTHORITY declaration. The
 * order pins the five members; matrix.ts carries the verbatim duplicate
 * (pinned deep-equal by matrix.test.ts). Do not reorder or extend without
 * a contract-set version bump.
 */
export const EVIDENCE_LABELS = Object.freeze([
	'test-suite-green',
	'contract-pinned',
	'authority-mirrored',
	'documented-comparison',
	'none',
] as const);

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

/** Pure guard: value is one of the five frozen evidence labels. */
export function isEvidenceLabel(value: unknown): value is EvidenceLabel {
	return typeof value === 'string' && (EVIDENCE_LABELS as readonly string[]).includes(value);
}

/**
 * PARITY VERDICT VOCABULARY -- duplicated verbatim from matrix.ts (the
 * verdict authority) under the zero-dependency law, because
 * labelBacksVerdict() must reference the verdicts without importing them.
 * evidence.test.ts pins both declarations deep-equal; edit neither without
 * the other.
 */
export const PARITY_VERDICTS = Object.freeze([
	'parity-confirmed',
	'parity-partial',
	'parity-divergent',
	'parity-unmeasured',
] as const);

export type ParityVerdict = (typeof PARITY_VERDICTS)[number];

/** Pure guard: value is one of the four frozen verdicts. */
export function isParityVerdict(value: unknown): value is ParityVerdict {
	return typeof value === 'string' && (PARITY_VERDICTS as readonly string[]).includes(value);
}

/**
 * Shape guard for injected ISO-8601 UTC timestamps: exactly
 * YYYY-MM-DDTHH:MM:SS with an optional 1-6 digit fractional-second part
 * and a literal Z. The contract set standardizes on UTC -- offset forms
 * are non-canonical and rejected. Shape only: calendar validity (month 02
 * day 30, and friends) is the caller's concern, and this module never
 * constructs a timestamp, only validates the injected string.
 */
const ISO_8601_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/** Pure guard: plausible ISO-8601 UTC timestamp string. */
export function isIso8601UtcString(value: unknown): value is string {
	return typeof value === 'string' && ISO_8601_UTC_PATTERN.test(value);
}

/**
 * One evidence record: what was observed for a domain, which artifact
 * backs it (a repo path or a test-suite name), and when the observation
 * was captured.
 *
 * - scope + contractVersion on every persisted record (contract law).
 * - label none carries NO artifactRef -- there is nothing to cite, and
 *   citing one would be dishonest; every other label MUST cite a
 *   non-empty artifactRef (fail-closed both ways).
 * - capturedAtIso is a plain injected ISO-8601 UTC string (shape-pinned
 *   by isIso8601UtcString).
 */
export type EvidenceRecord = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly label: EvidenceLabel;
	readonly artifactRef: string | undefined;
	readonly capturedAtIso: string;
};

/**
 * Pure guard for EvidenceRecord (the record comment above states the
 * laws). Extra properties are tolerated (structural guard); closure is
 * enforced on the vocabulary, the version, and the artifactRef law.
 */
export function isEvidenceRecord(value: unknown): value is EvidenceRecord {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		label?: unknown;
		artifactRef?: unknown;
		capturedAtIso?: unknown;
	};
	if (!isParityScope(record.scope)) {
		return false;
	}
	if (record.contractVersion !== ZCODE_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	if (!isEvidenceLabel(record.label)) {
		return false;
	}
	if (record.label === 'none') {
		// Honesty: no evidence means nothing to cite.
		if (record.artifactRef !== undefined) {
			return false;
		}
	} else {
		// Every real label cites its artifact.
		if (typeof record.artifactRef !== 'string' || record.artifactRef.length === 0) {
			return false;
		}
	}
	return isIso8601UtcString(record.capturedAtIso);
}

/**
 * The injected observations labelFor() derives from. Each fact is a plain
 * boolean supplied by the caller (the harvester repo-side); this module
 * never establishes a fact itself.
 */
export type EvidenceFacts = {
	/** A green tdd suite for the domain, pinned to the journey authority. */
	readonly greenTddSuitePinnedToAuthority: boolean;
	/** A structural mirror of the authority, pinned by tests. */
	readonly structuralMirrorPinnedByTests: boolean;
	/** A structural mirror of the authority, present but not test-pinned. */
	readonly structuralMirrorPresent: boolean;
	/** A prose (README) comparison claim, present. */
	readonly documentedComparisonPresent: boolean;
};

/** Pure guard: all four facts present and boolean. */
export function isEvidenceFacts(value: unknown): value is EvidenceFacts {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const facts = value as Record<string, unknown>;
	return (
		typeof facts.greenTddSuitePinnedToAuthority === 'boolean' &&
		typeof facts.structuralMirrorPinnedByTests === 'boolean' &&
		typeof facts.structuralMirrorPresent === 'boolean' &&
		typeof facts.documentedComparisonPresent === 'boolean'
	);
}

/**
 * Pure label derivation -- strongest evidence wins, fail-closed to none.
 *
 * Ladder (first match wins):
 *
 *   green tdd suite pinned to the authority  -> test-suite-green
 *   structural mirror pinned by tests        -> contract-pinned
 *   structural mirror present (unpinned)     -> authority-mirrored
 *   documented (prose) comparison present    -> documented-comparison
 *   nothing / unreadable facts               -> none
 *
 * The order's prose pins the first, second, fourth and fifth rungs. The
 * vocabulary's remaining member, authority-mirrored, takes the natural
 * third rung: a structural mirror of the journey authority exists in the
 * contract set but is not yet pinned by tests -- weaker than
 * contract-pinned, stronger than prose. This placement keeps labelFor()
 * total over the closed vocabulary.
 *
 * "A prose README claim only" falls out of the ladder: prose alone reaches
 * the fourth rung because nothing stronger matched.
 */
export function labelFor(facts: EvidenceFacts): EvidenceLabel {
	// Fail closed: unreadable facts back nothing.
	if (!isEvidenceFacts(facts)) {
		return 'none';
	}
	if (facts.greenTddSuitePinnedToAuthority) {
		return 'test-suite-green';
	}
	if (facts.structuralMirrorPinnedByTests) {
		return 'contract-pinned';
	}
	if (facts.structuralMirrorPresent) {
		return 'authority-mirrored';
	}
	if (facts.documentedComparisonPresent) {
		return 'documented-comparison';
	}
	return 'none';
}

/**
 * The honesty law in pure form: may a comparison honestly cite this
 * evidence label alongside this parity verdict?
 *
 *   label none            -> backs parity-unmeasured ONLY -- no evidence
 *                            backs nothing; (none, parity-confirmed) is
 *                            UNREPRESENTABLE
 *   any other label       -> backs every verdict -- an unmeasured verdict
 *                            with real evidence present is honest (it
 *                            means the surfaces were not captured, which
 *                            fails closed rather than lying)
 *   unknown label/verdict -> false (fail closed)
 *
 * The STRENGTH ordering among non-none labels (is documented-comparison
 * strong enough for a completion verdict?) is judged by the evidence-labels
 * gate check repo-side, not by this relation. Consistency note: for every
 * (label, digests) input, verdictFor() in matrix.ts only ever emits a
 * verdict that labelBacksVerdict() accepts -- the two modules cannot
 * disagree; evidence.test.ts pins this cross-module coherence.
 */
export function labelBacksVerdict(label: EvidenceLabel, verdict: ParityVerdict): boolean {
	// Fail closed: unknown vocabulary backs nothing.
	if (!isEvidenceLabel(label)) {
		return false;
	}
	if (!isParityVerdict(verdict)) {
		return false;
	}
	if (label === 'none') {
		return verdict === 'parity-unmeasured';
	}
	return true;
}
