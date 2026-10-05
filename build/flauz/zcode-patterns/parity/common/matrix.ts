/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/common/matrix.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- comparison matrix
 * ----------------------------------------------------------------------------
 *
 * The ten Phase C capability domains as a frozen table, the parity verdict
 * vocabulary, the DomainComparisonRecord contract, and the pure derivation
 * verdictFor(). Surface digests are INJECTED plain strings -- this contract
 * set never computes digests, never executes tests, never runs comparisons.
 * It validates, derives, and pins.
 *
 * LAWS (violations = rejection):
 *
 * - ZERO-DEPENDENCY: no import statements in this file or any common/
 *   contract module. Cross-module vocabularies are duplicated verbatim and
 *   pinned deep-equal by the test suites (see EVIDENCE_LABELS below).
 *
 * - DETERMINISM: no Math.random, no Date.now, no new Date() -- this module
 *   is pure; any timestamp on a record is a plain ISO-8601 string injected
 *   by the caller.
 *
 * - FAIL-CLOSED: verdictFor() returns parity-unmeasured for anything it
 *   cannot measure -- unknown domain, unknown evidence label, absent
 *   digests, or evidence label none.
 *
 * - HONESTY: a DomainComparisonRecord with evidenceLabel none and verdict
 *   parity-confirmed is UNREPRESENTABLE; isDomainComparisonRecord() rejects
 *   it. Evidence must back every confirmed verdict.
 *
 * Contract set: ZCODE_PARITY_CONTRACTS_VERSION 1.0.0 -- one versioned set;
 * evidence.ts / gate.ts / discovery.ts export the same value in lockstep,
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
 * The ten Phase C capability domains -- the frozen comparison matrix rows.
 * Pinned verbatim by matrix.test.ts; do not reorder or extend without a
 * contract-set version bump.
 */
export const PARITY_DOMAINS = Object.freeze([
	'coding',
	'exploration',
	'background-delegation',
	'plan-execute',
	'browser-computer-use',
	'memory',
	'hooks',
	'workflow-monitoring',
	'replay-recovery',
	'capability-discovery',
] as const);

export type ParityDomain = (typeof PARITY_DOMAINS)[number];

/** Pure guard: value is one of the ten frozen domains. */
export function isParityDomain(value: unknown): value is ParityDomain {
	return typeof value === 'string' && (PARITY_DOMAINS as readonly string[]).includes(value);
}

/**
 * The parity verdict vocabulary -- the outcome of one domain comparison.
 * Pinned verbatim by matrix.test.ts.
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
 * EVIDENCE LABEL VOCABULARY -- duplicated verbatim from evidence.ts (the
 * vocabulary authority) under the zero-dependency law, because
 * DomainComparisonRecord and verdictFor() must reference it without
 * importing it. matrix.test.ts pins both declarations deep-equal; edit
 * neither without the other.
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
 * A surface digest: an opaque plain string identifying the contract-surface
 * revision being compared (ZCode side or service/journey-authority side).
 * Injected by the caller; never computed here. A digest is PRESENT when it
 * is a non-empty string; undefined means the surface was not captured. The
 * pure derivation also treats an empty string as not present (guards are
 * stricter than derivations; derivations fail closed on garbage).
 */
export type SurfaceDigest = string;

/** Pure guard: non-empty string usable as an injected surface digest. */
export function isSurfaceDigest(value: unknown): value is SurfaceDigest {
	return typeof value === 'string' && value.length > 0;
}

/**
 * One row of the comparison matrix: the ZCode-side surface digest for a
 * domain, the service-side journey-authority digest it projects, the
 * evidence label backing the comparison, and the derived verdict.
 *
 * - scope + contractVersion on every persisted record (contract law).
 * - verdict MUST equal verdictFor() over the record's own fields; the guard
 *   enforces this, which subsumes the honesty law.
 */
export type DomainComparisonRecord = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly domain: ParityDomain;
	readonly zcodeSurfaceDigest: SurfaceDigest | undefined;
	readonly serviceSurfaceDigest: SurfaceDigest | undefined;
	readonly evidenceLabel: EvidenceLabel;
	readonly verdict: ParityVerdict;
};

/**
 * Pure verdict derivation. Truth table (e = evidence label):
 *
 *   unknown domain, or unknown e           -> parity-unmeasured (fail closed)
 *   e = none                               -> parity-unmeasured (honesty law:
 *                                              no evidence, regardless of digests)
 *   both digests present, equal            -> parity-confirmed
 *   both digests present, different        -> parity-divergent
 *   exactly one digest present             -> parity-partial
 *   neither digest present                 -> parity-unmeasured
 *
 * Note: only the label none forces unmeasured. The STRENGTH of a non-none
 * label (test-suite-green vs documented-comparison, etc.) is judged by the
 * evidence-labels gate check repo-side, not by this derivation.
 */
export function verdictFor(
	domain: ParityDomain,
	zcodeDigest: SurfaceDigest | undefined,
	serviceDigest: SurfaceDigest | undefined,
	evidence: EvidenceLabel,
): ParityVerdict {
	// Fail closed: an unknown domain cannot be measured.
	if (!isParityDomain(domain)) {
		return 'parity-unmeasured';
	}
	// Fail closed: an unknown evidence label backs nothing.
	if (!isEvidenceLabel(evidence)) {
		return 'parity-unmeasured';
	}
	// Honesty law: no evidence -> unmeasured regardless of the digests.
	if (evidence === 'none') {
		return 'parity-unmeasured';
	}
	const zcodePresent = isSurfaceDigest(zcodeDigest);
	const servicePresent = isSurfaceDigest(serviceDigest);
	if (zcodePresent && servicePresent) {
		return zcodeDigest === serviceDigest ? 'parity-confirmed' : 'parity-divergent';
	}
	if (zcodePresent || servicePresent) {
		return 'parity-partial';
	}
	return 'parity-unmeasured';
}

/**
 * Pure guard for DomainComparisonRecord. Checks:
 * - scope shape, contractVersion === ZCODE_PARITY_CONTRACTS_VERSION (the
 *   set validates records of its own version only),
 * - domain / evidenceLabel / verdict inside the frozen vocabularies,
 * - digests absent-or-non-empty,
 * - derivation law: verdict === verdictFor() over the record's own fields.
 *   This subsumes the honesty law -- a record with evidenceLabel none and
 *   verdict parity-confirmed is unrepresentable and is rejected here.
 * Extra properties are tolerated (structural guard); the vocabularies and
 * the derivation are where closure is enforced.
 */
export function isDomainComparisonRecord(value: unknown): value is DomainComparisonRecord {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		domain?: unknown;
		zcodeSurfaceDigest?: unknown;
		serviceSurfaceDigest?: unknown;
		evidenceLabel?: unknown;
		verdict?: unknown;
	};
	if (!isParityScope(record.scope)) {
		return false;
	}
	if (record.contractVersion !== ZCODE_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	if (!isParityDomain(record.domain)) {
		return false;
	}
	if (record.zcodeSurfaceDigest !== undefined && !isSurfaceDigest(record.zcodeSurfaceDigest)) {
		return false;
	}
	if (record.serviceSurfaceDigest !== undefined && !isSurfaceDigest(record.serviceSurfaceDigest)) {
		return false;
	}
	if (!isEvidenceLabel(record.evidenceLabel)) {
		return false;
	}
	if (!isParityVerdict(record.verdict)) {
		return false;
	}
	// Derivation law (subsumes the honesty law).
	return (
		record.verdict ===
		verdictFor(
			record.domain,
			record.zcodeSurfaceDigest,
			record.serviceSurfaceDigest,
			record.evidenceLabel,
		)
	);
}
