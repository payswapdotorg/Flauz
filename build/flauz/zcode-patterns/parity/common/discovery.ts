/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/common/discovery.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- discovery / a11y
 * ----------------------------------------------------------------------------
 *
 * The frozen discovery/a11y check table, the DiscoveryCheckRecord
 * contract, and the pure validators that turn observed discovery records
 * into gate-check statuses. This module never inspects the repository,
 * never runs a check, never resolves an artifact reference: observations
 * are INJECTED as plain record values; the validators validate, derive,
 * and fail closed.
 *
 * LAWS (violations = rejection):
 *
 * - ZERO-DEPENDENCY: no import statements in this file or any common/
 *   contract module. This module is the AUTHORITY for the discovery
 *   check table and the discovery-outcome vocabulary; it carries verbatim
 *   duplicates of the ParityScope shape and the gate-check status
 *   vocabulary (gate.ts is the status authority) because the validators
 *   must reference both without importing them. discovery.test.ts pins
 *   every duplication against its authority.
 *
 * - DETERMINISM: no Math.random, no Date.now, no new Date() -- this module
 *   is pure; every value it reads or returns is injected or derived.
 *
 * - FAIL-CLOSED: a missing artifact means the check cannot be established.
 *   Any input that is not a valid DiscoveryCheckRecord -- including a
 *   record whose artifactRef is absent or empty -- derives status
 *   unmeasured, and unmeasured fails the Phase C gate closed (gate.ts:
 *   a check with unmeasured status makes the whole verdict incomplete).
 *
 * - EVIDENCE BOTH WAYS: every record -- passing OR failing -- must cite a
 *   non-empty artifactRef. A pass without an artifact is an unbacked
 *   claim (malformed); a fail without an artifact is an unlocatable one
 *   (malformed). Both derive unmeasured, never green.
 *
 * ELABORATIONS beyond the order's named surface (documented for the TL):
 * - observedOutcome ('pass' | 'fail'): the order names the record, the
 *   artifact law, and the unmeasured mapping, but no outcome field.
 *   Without one, a definitively failed check would be indistinguishable
 *   from an unestablished one (both would fall to unmeasured). The
 *   outcome field keeps red reachable and honest; fail-closed behavior
 *   is unchanged either way.
 * - discoveryStatusTable(): a pure projection returning exactly one
 *   derived status per frozen check in table order -- the bridge the
 *   repo-side harvester uses to build the discovery-a11y GateCheckRecord.
 *
 * Contract set: ZCODE_PARITY_CONTRACTS_VERSION 1.0.0 -- one versioned set;
 * matrix.ts / evidence.ts / gate.ts export the same value in lockstep,
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
 * The frozen discovery/a11y check table -- exactly as the order names it.
 * AUTHORITY declaration (this module owns it). Pinned verbatim by
 * discovery.test.ts; do not reorder or extend without a contract-set
 * version bump.
 */
export const DISCOVERY_CHECKS = Object.freeze([
	'surface-indexed',
	'contract-discoverable',
	'journey-documented',
	'a11y-law-annotated',
] as const);

export type DiscoveryCheckId = (typeof DISCOVERY_CHECKS)[number];

/** Pure guard: value is one of the four frozen discovery checks. */
export function isDiscoveryCheckId(value: unknown): value is DiscoveryCheckId {
	return typeof value === 'string' && (DISCOVERY_CHECKS as readonly string[]).includes(value);
}

/**
 * The frozen discovery-outcome vocabulary. AUTHORITY declaration.
 * pass: the check was observed to hold. fail: the check was observed NOT
 * to hold. The distinction from "could not establish" (which derives
 * unmeasured) is the point of this vocabulary.
 */
export const DISCOVERY_OUTCOMES = Object.freeze(['pass', 'fail'] as const);

export type DiscoveryOutcome = (typeof DISCOVERY_OUTCOMES)[number];

/** Pure guard: value is one of the two frozen outcomes. */
export function isDiscoveryOutcome(value: unknown): value is DiscoveryOutcome {
	return typeof value === 'string' && (DISCOVERY_OUTCOMES as readonly string[]).includes(value);
}

/**
 * THE GATE-CHECK STATUS VOCABULARY -- duplicated verbatim from gate.ts
 * (the authority) under the zero-dependency law, because the discovery
 * validators derive statuses in that vocabulary. discovery.test.ts pins
 * both declarations deep-equal; edit neither without the other.
 */
export const GATE_CHECK_STATUSES = Object.freeze(['green', 'red', 'unmeasured'] as const);

export type GateCheckStatus = (typeof GATE_CHECK_STATUSES)[number];

/** Pure guard: value is one of the three frozen statuses. */
export function isGateCheckStatus(value: unknown): value is GateCheckStatus {
	return typeof value === 'string' && (GATE_CHECK_STATUSES as readonly string[]).includes(value);
}

/**
 * One observed discovery/a11y check: which frozen check it is, what the
 * observation found, and the artifact that evidences the observation.
 *
 * - scope + contractVersion on every persisted record (contract law).
 * - observedOutcome is the INJECTED observed result (pass | fail); this
 *   module never establishes it.
 * - artifactRef is a non-empty injected string (a repo path or a doc
 *   anchor) and is required on BOTH outcomes: a pass cites its proof, a
 *   fail cites where the failure was observed. A record without an
 *   artifact is malformed -- and a malformed record derives unmeasured,
 *   which fails the gate closed.
 */
export type DiscoveryCheckRecord = {
	readonly scope: ParityScope;
	readonly contractVersion: string;
	readonly checkId: DiscoveryCheckId;
	readonly observedOutcome: DiscoveryOutcome;
	readonly artifactRef: string;
};

/**
 * Pure guard for DiscoveryCheckRecord (the record comment above states
 * the laws). Extra properties are tolerated (structural guard); closure
 * is enforced on the vocabulary, the version, and the artifact law.
 */
export function isDiscoveryCheckRecord(value: unknown): value is DiscoveryCheckRecord {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const record = value as {
		scope?: unknown;
		contractVersion?: unknown;
		checkId?: unknown;
		observedOutcome?: unknown;
		artifactRef?: unknown;
	};
	if (!isParityScope(record.scope)) {
		return false;
	}
	if (record.contractVersion !== ZCODE_PARITY_CONTRACTS_VERSION) {
		return false;
	}
	if (!isDiscoveryCheckId(record.checkId)) {
		return false;
	}
	if (!isDiscoveryOutcome(record.observedOutcome)) {
		return false;
	}
	// Evidence both ways: every observation cites its artifact.
	return typeof record.artifactRef === 'string' && record.artifactRef.length > 0;
}

/**
 * Pure status derivation. Truth table:
 *
 *   not a valid record (shape, version, vocabulary, scope, or a
 *     missing / empty artifactRef)            -> unmeasured (fail closed)
 *   valid record, observedOutcome pass        -> green
 *   valid record, observedOutcome fail        -> red
 *
 * The unmeasured branch is the order's missing-artifact law: a check
 * whose evidence cannot be cited cannot be established, and unmeasured
 * fails the Phase C gate closed -- it is never silently promoted to
 * green.
 */
export function discoveryStatusFor(record: DiscoveryCheckRecord): GateCheckStatus {
	// Fail closed: anything unreadable -- including a missing artifact --
	// is unmeasured, never green.
	if (!isDiscoveryCheckRecord(record)) {
		return 'unmeasured';
	}
	return record.observedOutcome === 'pass' ? 'green' : 'red';
}

/** One derived status, always in frozen-table order. */
export type DiscoveryStatusEntry = {
	readonly checkId: DiscoveryCheckId;
	readonly status: GateCheckStatus;
};

/**
 * Pure table projection (the bridge to the gate): exactly one entry per
 * frozen discovery check, in table order.
 *
 * Placement is first-valid-wins in input order; a check with no valid
 * record derives unmeasured (absence is never guessed into a
 * measurement). Malformed records never place; a duplicate valid record
 * for a check does not re-flag here -- gate.ts owns duplicate detection
 * once these observations become gate check records repo-side. The
 * repo-side harvester folds this table into the discovery-a11y
 * GateCheckRecord (green only when all four entries are green).
 */
export function discoveryStatusTable(records: ReadonlyArray<unknown>): ReadonlyArray<DiscoveryStatusEntry> {
	const placed = new Map<DiscoveryCheckId, DiscoveryCheckRecord>();
	for (const candidate of records) {
		if (!isDiscoveryCheckRecord(candidate)) {
			continue;
		}
		if (!placed.has(candidate.checkId)) {
			placed.set(candidate.checkId, candidate);
		}
	}
	return DISCOVERY_CHECKS.map((checkId) => {
		const record = placed.get(checkId);
		return {
			checkId,
			status: record === undefined ? 'unmeasured' : discoveryStatusFor(record),
		};
	});
}
