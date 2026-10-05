/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/common/gate.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- gate verdict
 * ----------------------------------------------------------------------------
 *
 * The frozen gate-check table and status vocabulary, the GateCheckRecord
 * contract, the PhaseCVerdictRecord contract, and the pure aggregation
 * aggregateVerdict() -- the machine-checkable Phase C completion verdict.
 * This module never runs the checks: check results are INJECTED as
 * GateCheckRecord values and domain comparisons as DomainComparisonSummary
 * values; the aggregate validates, places, names, and rules.
 *
 * LAWS (violations = rejection):
 *
 * - ZERO-DEPENDENCY: no import statements in this file or any common/
 *   contract module. This module is the AUTHORITY for the gate-check
 *   table, the check-status vocabulary, and the overall-verdict
 *   vocabulary; it carries the third verbatim duplicate of the domain,
 *   verdict, and evidence-label vocabularies (matrix.ts is the domain and
 *   verdict authority; evidence.ts is the label authority) because
 *   aggregation must read all three. gate.test.ts pins every duplication
 *   deep-equal against the authorities.
 *
 * - DETERMINISM: no Math.random, no Date.now, no new Date() -- this module
 *   is pure. The aggregate is a pure function of its inputs: records are
 *   placed first-wins in input order, every output list is emitted in
 *   frozen-table order, and no timestamp is ever constructed here.
 *
 * - FAIL-CLOSED / NEVER SILENT: the aggregate is complete ONLY when every
 *   one of the ten domains is present exactly once with a qualifying
 *   verdict (parity-confirmed or parity-partial) AND every one of the four
 *   checks is present exactly once with status green AND no input record
 *   was malformed. Anything else is phase-c-incomplete, and the record
 *   NAMES the failure modes: missingDomains, duplicateDomains,
 *   failingDomains, missingChecks, duplicateChecks, failingChecks, and
 *   the malformedDomainRecords / malformedCheckRecords counts. A check
 *   with status unmeasured makes the whole verdict incomplete -- the
 *   aggregate may never fabricate a green check.
 *
 * - ABSENCE DERIVATION: a domain with no valid record is reported in
 *   domainVerdicts with verdict parity-unmeasured (exactly what
 *   verdictFor(undefined, undefined, 'none') derives in matrix.ts for an
 *   absent surface) AND named in missingDomains; a check with no valid
 *   record is reported with status unmeasured AND named in missingChecks.
 *   Absence is never guessed into a measurement.
 *
 * - HONESTY: the summary reader enforces the duplicated form of the
 *   evidence.ts law labelBacksVerdict: evidence label none backs
 *   parity-unmeasured ONLY -- a row claiming parity-confirmed on no
 *   evidence is malformed and can never contribute to completion.
 *
 * - GUARD RE-DERIVATION: isPhaseCVerdictRecord recomputes the completion
 *   equivalence from the record's own failure lists -- overall is
 *   phase-c-complete if and only if every failure list is empty and both
 *   malformed counts are zero. A record may not fabricate completion,
 *   and may not claim incompleteness without a named cause.
 *
 * SIGNATURE NOTE (order elaboration): the order's shorthand names
 * aggregateVerdict(domainRecords, checkRecords); this module implements
 * aggregateVerdict(scope, domainRecords, checkRecords). The leading
 * ParityScope is the asserted identity of the evaluation (the contract
 * law puts a scope on every persisted record, and the verdict record
 * inherits the asserted scope); input records whose scope disagrees with
 *   the assertion are malformed and named by count. This keeps the function
 *   total -- no undefined-scope escape hatch, no sentinel fabrication.
 *
 * Contract set: ZCODE_PARITY_CONTRACTS_VERSION 1.0.0 -- one versioned set;
 * matrix.ts / evidence.ts / discovery.ts export the same value in
 * lockstep, pinned equal by the test suites.
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
 * THE TEN PHASE C DOMAINS -- duplicated verbatim from matrix.ts (the
 * authority) under the zero-dependency law, because the aggregate must
 * place and name domain rows. gate.test.ts pins both declarations
 * deep-equal; edit neither without the other.
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
 * THE FOUR PARITY VERDICTS -- duplicated verbatim from matrix.ts (the
 * authority) under the zero-dependency law. gate.test.ts pins both
 * declarations deep-equal; edit neither without the other.
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
 * THE FIVE EVIDENCE LABELS -- duplicated verbatim from evidence.ts (the
 * authority) under the zero-dependency law, because the summary reader
 * must enforce the honesty clause. gate.test.ts pins both declarations
 * deep-equal; edit neither without the other.
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
 * The frozen gate-check table -- the checks Phase C must pass, exactly as
 * the order names them. AUTHORITY declaration (this module owns it).
 * Pinned verbatim by gate.test.ts; do not reorder or extend without a
 * contract-set version bump.
 */
export const GATE_CHECK_IDS = Object.freeze([
	'targeted-tests',
	'evidence-labels',
	'discovery-a11y',
	'existing-gates',
] as const);

export type GateCheckId = (typeof GATE_CHECK_IDS)[number];

/** Pure guard: value is one of the four frozen gate checks. */
export function isGateCheckId(value: unknown): value is GateCheckId {
	return typeof value === 'string' && (GATE_CHECK_IDS as readonly string[]).includes(value);
}

/**
 * The frozen check-status vocabulary. AUTHORITY declaration.
 * unmeasured is a FIRST-CLASS failure for completion: a check record with
 * unmeasured status makes the whole aggregate incomplete (fail-closed).
 */
export const GATE_CHECK_STATUSES = Object.freeze([
	'green',
	'red',
	'unmeasured',
] as const);

export type GateCheckStatus = (typeof GATE_CHECK_STATUSES)[number];

/** Pure guard: value is one of the three frozen statuses. */
export function isGateCheckStatus(value: unknown): value is GateCheckStatus {
	return typeof value === 'string' && (GATE_CHECK_STATUSES as readonly string[]).includes(value);
}

/**
 * The frozen overall-verdict vocabulary. AUTHORITY declaration.
 * phase-c-complete means: every domain qualified, every check green,
 * nothing missing, duplicated, or malformed -- nothing else.
 */
export const PHASE_C_OVERALL_VERDICTS = Object.freeze([
	'phase-c-complete',
	'phase-c-incomplete',
] as const);

export type PhaseCOverallVerdict = (typeof PHASE_C_OVERALL_VERDICTS)[number];

/** Pure guard: value is one of the two frozen overall verdicts. */
export function isPhaseCOverallVerdict(value: unknown): value is PhaseCOverallVerdict {
	return typeof value === 'string' && (PHASE_C_OVERALL_VERDICTS as readonly string[]).includes(value);
}

/**
 * The aggregation-relevant projection of a domain comparison: the fields
 * aggregateVerdict() reads. matrix.ts's DomainComparisonRecord is
 * structurally assignable to this summary (it carries every field below);
 * this guard is intentionally WEAKER than matrix.ts's record guard -- the
 * full derivation law (verdict === verdictFor(...) over the digests) is
 * matrix.ts's to enforce, while this reader enforces exactly what the
 * aggregate depends on: vocabularies, version, scope shape, and the
 * honesty clause.
 */
export type DomainComparisonSummary = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly domain: ParityDomain;
	readonly verdict: ParityVerdict;
	readonly evidenceLabel: EvidenceLabel;
};

/**
 * Pure guard for DomainComparisonSummary. Enforces:
 * - scope shape and contractVersion === ZCODE_PARITY_CONTRACTS_VERSION,
 * - domain / verdict / evidenceLabel inside the frozen vocabularies,
 * - the honesty clause (duplicated form of evidence.ts
 *   labelBacksVerdict): label none backs parity-unmeasured ONLY. A row
 *   claiming a measured verdict on no evidence is malformed here and can
 *   never contribute to completion.
 * Extra properties are tolerated (structural guard); matrix.ts records
 * pass through with their digest fields unread.
 */
export function isDomainComparisonSummary(value: unknown): value is DomainComparisonSummary {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		domain?: unknown;
		verdict?: unknown;
		evidenceLabel?: unknown;
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
	if (!isParityVerdict(record.verdict)) {
		return false;
	}
	if (!isEvidenceLabel(record.evidenceLabel)) {
		return false;
	}
	// Honesty clause: label none backs parity-unmeasured ONLY.
	if (record.evidenceLabel === 'none' && record.verdict !== 'parity-unmeasured') {
		return false;
	}
	return true;
}

/**
 * One gate-check record: the injected outcome of one check of the frozen
 * table, with the digest of the detail that backs it.
 *
 * - scope + contractVersion on every persisted record (contract law).
 * - detailDigest is a non-empty injected string (the digest of the
 *   check's supporting detail); a check record without detail is
 *   malformed -- an unbacked check backs nothing.
 */
export type GateCheckRecord = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly checkId: GateCheckId;
	readonly status: GateCheckStatus;
	readonly detailDigest: string;
};

/**
 * Pure guard for GateCheckRecord (the record comment above states the
 * laws). Extra properties are tolerated (structural guard).
 */
export function isGateCheckRecord(value: unknown): value is GateCheckRecord {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		checkId?: unknown;
		status?: unknown;
		detailDigest?: unknown;
	};
	if (!isParityScope(record.scope)) {
		return false;
	}
	if (record.contractVersion !== ZCODE_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	if (!isGateCheckId(record.checkId)) {
		return false;
	}
	if (!isGateCheckStatus(record.status)) {
		return false;
	}
	return typeof record.detailDigest === 'string' && record.detailDigest.length > 0;
}

/** One per-domain comparison outcome, always in frozen-table order. */
export type DomainVerdictEntry = {
	readonly domain: ParityDomain;
	readonly verdict: ParityVerdict;
};

/** One gate-check status, always in frozen-table order. */
export type CheckStatusEntry = {
	readonly checkId: GateCheckId;
	readonly status: GateCheckStatus;
};

/**
 * The Phase C completion verdict record.
 *
 * - scope + contractVersion on every persisted record (contract law); the
 *   scope is the asserted evaluation identity the aggregate was run with.
 * - domainVerdicts: ALWAYS exactly the ten frozen domains in table order.
 *   A domain with no valid record appears here with verdict
 *   parity-unmeasured (the absence derivation) and additionally in
 *   missingDomains.
 * - checkStatuses: ALWAYS exactly the four frozen checks in table order.
 *   A check with no valid record appears here with status unmeasured and
 *   additionally in missingChecks.
 * - The six failure lists are canonically ordered (frozen-table order),
 *   duplicate-free, and name every failure mode:
 *   - missingDomains / missingChecks: no valid record at all;
 *   - duplicateDomains / duplicateChecks: more than one valid record
 *     (first-wins placement; the duplicate flag alone forces incomplete);
 *   - failingDomains: present but verdict outside
 *     {parity-confirmed, parity-partial};
 *   - failingChecks: present but status not green (red OR unmeasured).
 * - malformedDomainRecords / malformedCheckRecords: counts of input
 *   records that were unreadable, out-of-vocabulary, foreign-versioned,
 *   scope-mismatched, or dishonest (label none with a measured verdict).
 * - overall: phase-c-complete if and only if all six lists are empty and
 *   both counts are zero. isPhaseCVerdictRecord re-derives this
 *   equivalence -- the record cannot lie in either direction.
 */
export type PhaseCVerdictRecord = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly domainVerdicts: ReadonlyArray<DomainVerdictEntry>;
	readonly checkStatuses: ReadonlyArray<CheckStatusEntry>;
	readonly overall: PhaseCOverallVerdict;
	readonly missingDomains: ReadonlyArray<ParityDomain>;
	readonly duplicateDomains: ReadonlyArray<ParityDomain>;
	readonly failingDomains: ReadonlyArray<ParityDomain>;
	readonly missingChecks: ReadonlyArray<GateCheckId>;
	readonly duplicateChecks: ReadonlyArray<GateCheckId>;
	readonly failingChecks: ReadonlyArray<GateCheckId>;
	readonly malformedDomainRecords: number;
	readonly malformedCheckRecords: number;
};

// ---------------------------------------------------------------------------
// Internal helpers (pure; not part of the public contract surface).
// ---------------------------------------------------------------------------

/** Exact scope equality (identity comparison of the two members). */
function isSameScope(left: ParityScope, right: ParityScope): boolean {
	return left.workspaceId === right.workspaceId && left.tenantId === right.tenantId;
}

/** Frozen-table rank of a domain value; -1 when not in the vocabulary. */
function domainRank(value: unknown): number {
	return typeof value === 'string' ? (PARITY_DOMAINS as readonly string[]).indexOf(value) : -1;
}

/** Frozen-table rank of a check value; -1 when not in the vocabulary. */
function checkRank(value: unknown): number {
	return typeof value === 'string' ? (GATE_CHECK_IDS as readonly string[]).indexOf(value) : -1;
}

/**
 * Pure guard: an array of domains that is in-vocabulary, free of
 * duplicates, and strictly in frozen-table order (the canonical list
 * shape every failure list must carry).
 */
function isCanonicalDomainList(value: unknown): value is ReadonlyArray<ParityDomain> {
	if (!Array.isArray(value)) {
		return false;
	}
	let previous = -1;
	for (const element of value) {
		const rank = domainRank(element);
		if (rank < 0 || rank <= previous) {
			return false;
		}
		previous = rank;
	}
	return true;
}

/** Pure guard: the canonical list shape for check-id lists. */
function isCanonicalCheckList(value: unknown): value is ReadonlyArray<GateCheckId> {
	if (!Array.isArray(value)) {
		return false;
	}
	let previous = -1;
	for (const element of value) {
		const rank = checkRank(element);
		if (rank < 0 || rank <= previous) {
			return false;
		}
		previous = rank;
	}
	return true;
}

/** Ranks of an already-validated canonical domain list. */
function domainRanksOf(list: ReadonlyArray<ParityDomain>): number[] {
	return list.map((domain) => (PARITY_DOMAINS as readonly string[]).indexOf(domain));
}

/** Ranks of an already-validated canonical check list. */
function checkRanksOf(list: ReadonlyArray<GateCheckId>): number[] {
	return list.map((checkId) => (GATE_CHECK_IDS as readonly string[]).indexOf(checkId));
}

/** Pure guard: a non-negative integer (the malformed counters' shape). */
function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Pure aggregation -- the Phase C completion verdict.
 *
 * Inputs are read defensively: every candidate is validated (vocabulary
 * guards, contractVersion, asserted-scope match, honesty clause); anything
 * unreadable, foreign, scope-mismatched, or dishonest is counted in the
 * malformed counters -- it can never contribute to completion.
 *
 * Placement is first-wins in input order; a second valid record for the
 * same domain/check names that domain/check in the duplicate list (the
 * reported verdict/status stays whatever the FIRST record said --
 * deterministic; never averaged, merged, or silently upgraded).
 *
 * overall is phase-c-complete ONLY when all ten domains are present
 * exactly once with qualifying verdicts AND all four checks are present
 * exactly once with status green AND both malformed counters are zero.
 * Every other configuration is phase-c-incomplete, with every failure
 * mode named in the record. The aggregate may never fabricate a green
 * check: status unmeasured (or a missing check) fails closed.
 */
export function aggregateVerdict(
	scope: ParityScope,
	domainRecords: ReadonlyArray<unknown>,
	checkRecords: ReadonlyArray<unknown>,
): PhaseCVerdictRecord {
	// -- Pass 1 (domains): validate, count malformed, place first-wins.
	const domainRows = new Map<ParityDomain, DomainComparisonSummary>();
	const duplicateDomainFlags = new Set<ParityDomain>();
	let malformedDomainRecords = 0;
	for (const candidate of domainRecords) {
		if (!isDomainComparisonSummary(candidate) || !isSameScope(candidate.scope, scope)) {
			malformedDomainRecords += 1;
			continue;
		}
		if (domainRows.has(candidate.domain)) {
			duplicateDomainFlags.add(candidate.domain);
			continue;
		}
		domainRows.set(candidate.domain, candidate);
	}

	// -- Pass 1 (checks): same discipline over the frozen check table.
	const checkRows = new Map<GateCheckId, GateCheckRecord>();
	const duplicateCheckFlags = new Set<GateCheckId>();
	let malformedCheckRecords = 0;
	for (const candidate of checkRecords) {
		if (!isGateCheckRecord(candidate) || !isSameScope(candidate.scope, scope)) {
			malformedCheckRecords += 1;
			continue;
		}
		if (checkRows.has(candidate.checkId)) {
			duplicateCheckFlags.add(candidate.checkId);
			continue;
		}
		checkRows.set(candidate.checkId, candidate);
	}

	// -- Pass 2 (domains): one entry per frozen domain, table order;
	// absence derives parity-unmeasured and is named, never guessed.
	const domainVerdicts: DomainVerdictEntry[] = [];
	const missingDomains: ParityDomain[] = [];
	const failingDomains: ParityDomain[] = [];
	for (const domain of PARITY_DOMAINS) {
		const row = domainRows.get(domain);
		if (row === undefined) {
			domainVerdicts.push({ domain, verdict: 'parity-unmeasured' });
			missingDomains.push(domain);
			continue;
		}
		domainVerdicts.push({ domain, verdict: row.verdict });
		if (row.verdict !== 'parity-confirmed' && row.verdict !== 'parity-partial') {
			failingDomains.push(domain);
		}
	}
	const duplicateDomains = PARITY_DOMAINS.filter((domain) => duplicateDomainFlags.has(domain));

	// -- Pass 2 (checks): one entry per frozen check, table order;
	// absence derives unmeasured and is named, never guessed.
	const checkStatuses: CheckStatusEntry[] = [];
	const missingChecks: GateCheckId[] = [];
	const failingChecks: GateCheckId[] = [];
	for (const checkId of GATE_CHECK_IDS) {
		const row = checkRows.get(checkId);
		if (row === undefined) {
			checkStatuses.push({ checkId, status: 'unmeasured' });
			missingChecks.push(checkId);
			continue;
		}
		checkStatuses.push({ checkId, status: row.status });
		if (row.status !== 'green') {
			failingChecks.push(checkId);
		}
	}
	const duplicateChecks = GATE_CHECK_IDS.filter((checkId) => duplicateCheckFlags.has(checkId));

	// -- The completion law: green only on full evidence-backed coverage.
	const complete =
		missingDomains.length === 0 &&
		duplicateDomains.length === 0 &&
		failingDomains.length === 0 &&
		missingChecks.length === 0 &&
		duplicateChecks.length === 0 &&
		failingChecks.length === 0 &&
		malformedDomainRecords === 0 &&
		malformedCheckRecords === 0;

	return {
		scope,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		domainVerdicts,
		checkStatuses,
		overall: complete ? 'phase-c-complete' : 'phase-c-incomplete',
		missingDomains,
		duplicateDomains,
		failingDomains,
		missingChecks,
		duplicateChecks,
		failingChecks,
		malformedDomainRecords,
		malformedCheckRecords,
	};
}

/**
 * Pure guard for PhaseCVerdictRecord -- the never-fabricate law made
 * structural. Beyond shape (scope, version, vocabularies, canonical
 * lists, non-negative counters), it enforces:
 *
 * - domainVerdicts / checkStatuses cover the frozen tables exactly, in
 *   table order, one entry each;
 * - every missing domain carries verdict parity-unmeasured (the absence
 *   derivation) and is NOT in failingDomains; every present domain is in
 *   failingDomains if and only if its verdict is outside
 *   {parity-confirmed, parity-partial};
 * - every missing check carries status unmeasured and is NOT in
 *   failingChecks; every present check is in failingChecks if and only
 *   if its status is not green;
 * - missing and duplicate are mutually exclusive per table entry (no
 *   valid record vs. two or more);
 * - the completion equivalence: overall is phase-c-complete if and only
 *   if all six failure lists are empty and both malformed counters are
 *   zero. A record may not fabricate completion, and may not claim
 *   incompleteness without a named cause.
 *
 * Extra properties are tolerated (structural guard).
 */
export function isPhaseCVerdictRecord(value: unknown): value is PhaseCVerdictRecord {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		domainVerdicts?: unknown;
		checkStatuses?: unknown;
		overall?: unknown;
		missingDomains?: unknown;
		duplicateDomains?: unknown;
		failingDomains?: unknown;
		missingChecks?: unknown;
		duplicateChecks?: unknown;
		failingChecks?: unknown;
		malformedDomainRecords?: unknown;
		malformedCheckRecords?: unknown;
	};
	if (!isParityScope(record.scope)) {
		return false;
	}
	if (record.contractVersion !== ZCODE_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	const overall = record.overall;
	if (!isPhaseCOverallVerdict(overall)) {
		return false;
	}
	const malformedDomainRecords = record.malformedDomainRecords;
	if (!isNonNegativeInteger(malformedDomainRecords)) {
		return false;
	}
	const malformedCheckRecords = record.malformedCheckRecords;
	if (!isNonNegativeInteger(malformedCheckRecords)) {
		return false;
	}

	// -- domainVerdicts: exactly the ten frozen domains, table order.
	const domainVerdicts = record.domainVerdicts;
	if (!Array.isArray(domainVerdicts) || domainVerdicts.length !== PARITY_DOMAINS.length) {
		return false;
	}
	const verdictByRank: (ParityVerdict | undefined)[] = [];
	for (let index = 0; index < domainVerdicts.length; index += 1) {
		const entry: unknown = domainVerdicts[index];
		if (typeof entry !== 'object' || entry === null) {
			return false;
		}
		const candidate = entry as { domain?: unknown; verdict?: unknown };
		if (candidate.domain !== PARITY_DOMAINS[index]) {
			return false;
		}
		if (!isParityVerdict(candidate.verdict)) {
			return false;
		}
		verdictByRank.push(candidate.verdict);
	}

	// -- checkStatuses: exactly the four frozen checks, table order.
	const checkStatuses = record.checkStatuses;
	if (!Array.isArray(checkStatuses) || checkStatuses.length !== GATE_CHECK_IDS.length) {
		return false;
	}
	const statusByRank: (GateCheckStatus | undefined)[] = [];
	for (let index = 0; index < checkStatuses.length; index += 1) {
		const entry: unknown = checkStatuses[index];
		if (typeof entry !== 'object' || entry === null) {
			return false;
		}
		const candidate = entry as { checkId?: unknown; status?: unknown };
		if (candidate.checkId !== GATE_CHECK_IDS[index]) {
			return false;
		}
		if (!isGateCheckStatus(candidate.status)) {
			return false;
		}
		statusByRank.push(candidate.status);
	}

	// -- The six failure lists: canonical order, in vocabulary, no dups.
	const missingDomains = record.missingDomains;
	if (!isCanonicalDomainList(missingDomains)) {
		return false;
	}
	const duplicateDomains = record.duplicateDomains;
	if (!isCanonicalDomainList(duplicateDomains)) {
		return false;
	}
	const failingDomains = record.failingDomains;
	if (!isCanonicalDomainList(failingDomains)) {
		return false;
	}
	const missingChecks = record.missingChecks;
	if (!isCanonicalCheckList(missingChecks)) {
		return false;
	}
	const duplicateChecks = record.duplicateChecks;
	if (!isCanonicalCheckList(duplicateChecks)) {
		return false;
	}
	const failingChecks = record.failingChecks;
	if (!isCanonicalCheckList(failingChecks)) {
		return false;
	}

	const missingDomainRanks = new Set(domainRanksOf(missingDomains));
	const duplicateDomainRanks = new Set(domainRanksOf(duplicateDomains));
	const failingDomainRanks = new Set(domainRanksOf(failingDomains));
	const missingCheckRanks = new Set(checkRanksOf(missingChecks));
	const duplicateCheckRanks = new Set(checkRanksOf(duplicateChecks));
	const failingCheckRanks = new Set(checkRanksOf(failingChecks));

	// -- Missing and duplicate are mutually exclusive per table entry.
	for (const rank of missingDomainRanks) {
		if (duplicateDomainRanks.has(rank)) {
			return false;
		}
	}
	for (const rank of missingCheckRanks) {
		if (duplicateCheckRanks.has(rank)) {
			return false;
		}
	}

	// -- Per-domain consistency (absence derivation + exactness).
	for (let rank = 0; rank < PARITY_DOMAINS.length; rank += 1) {
		const verdict = verdictByRank[rank];
		if (verdict === undefined) {
			return false;
		}
		if (missingDomainRanks.has(rank)) {
			if (verdict !== 'parity-unmeasured') {
				return false;
			}
			if (failingDomainRanks.has(rank)) {
				return false;
			}
			continue;
		}
		const qualifying = verdict === 'parity-confirmed' || verdict === 'parity-partial';
		if (qualifying === failingDomainRanks.has(rank)) {
			return false;
		}
	}

	// -- Per-check consistency (unmeasured fails closed + exactness).
	for (let rank = 0; rank < GATE_CHECK_IDS.length; rank += 1) {
		const status = statusByRank[rank];
		if (status === undefined) {
			return false;
		}
		if (missingCheckRanks.has(rank)) {
			if (status !== 'unmeasured') {
				return false;
			}
			if (failingCheckRanks.has(rank)) {
				return false;
			}
			continue;
		}
		if ((status === 'green') === failingCheckRanks.has(rank)) {
			return false;
		}
	}

	// -- The completion equivalence: the record cannot lie in either
	// direction about completion.
	const clean =
		missingDomainRanks.size === 0 &&
		duplicateDomainRanks.size === 0 &&
		failingDomainRanks.size === 0 &&
		missingCheckRanks.size === 0 &&
		duplicateCheckRanks.size === 0 &&
		failingCheckRanks.size === 0 &&
		malformedDomainRecords === 0 &&
		malformedCheckRecords === 0;
	if (overall === 'phase-c-complete') {
		return clean;
	}
	return !clean;
}
