/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 Free Inference Fabric contracts: the live-provider
 * acceptance and failure-DRILL family - the typed failure-scenario
 * vocabulary, the drill receipt with THE ACCEPTANCE-VIEW CITATION
 * (the v2 binder law), the frozen rejection vocabulary, and the
 * canonical receipt serialization (contract module, the labContracts
 * discipline; binds the landed INF-001..008 family vocabularies
 * verbatim, never re-implemented).
 *
 * THE DRILL HARNESS CONTRACT (this family's charter, binding): the
 * 'live-provider acceptance' of the inference fabric is THE DRILL
 * HARNESS - typed failure-scenario definitions plus deterministic
 * drill runs over the LANDED family kits. There are NO live provider
 * calls anywhere in this family: no network, no fetch, no provider
 * surface, no credential material. Simulated provider behavior only;
 * every fixture is SYNTHETIC and fixture-prefixed, never an
 * authority value.
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..008 family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock - every timestamp is a caller-injected epoch-ms number.
 *   No Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - THE FIXTURE-PREFIXED LAW (binding): every disclosed fixture id
 *   carries the 'fixture.' prefix - a fixture naming a real or
 *   authority-looking id is the typed rejection, never a silent
 *   pass-through; drill evidence is never confusable with authority
 *   values.
 * - THE ACCEPTANCE-VIEW CITATION LAW (the v2 binder law, binding):
 *   every drill receipt cites the drill's projected presentation
 *   views verbatim - the view objects plus their canonical bytes
 *   through the LANDED serializePresentationRecord - as the
 *   acceptance vocabulary the INF-008 landing record's binder note
 *   demands. The citation is part of the guarded receipt shape: a
 *   missing citation, a view failing its LANDED shape guard, or
 *   bytes that are not the LANDED canonical bytes is the typed
 *   rejection - never a valid receipt.
 * - THE VERBATIM-VOCABULARY LAW (binding): the drill log carries the
 *   LANDED rejection reasons / decision kinds / eligibility states /
 *   attempt outcomes / disclosed capacity states verbatim - cited,
 *   never re-worded, never silent.
 * - THE HONEST-UNKNOWN LAW (binding): the 'unknown' observed verdict
 *   is a first-class drill outcome (the landed honest-unknown states
 *   project AS unknown) - never coerced to a pass, never fabricated.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every admission rejection is a typed member of the
 *   frozen DRILL_REJECTION_REASONS list; each guard walk applies its
 *   applicable subset in the list order and the FIRST failure is THE
 *   verdict, and every rejection names its reason.
 * - THE CANONICAL-BYTES LAW: serializeDrillReceipt emits fixed-
 *   key-order deterministic bytes (double-run byte-equal); the cited
 *   views ride the LANDED serializer's own key order (re-parsed, the
 *   routing serializer's cited idiom). No dishonest receipt ever
 *   gets canonical bytes.
 * - Zero external dependencies: node: builtins (none needed here)
 *   and the landed sibling families only.
 */
import { admitCapabilityMatrix } from '../../catalog/common/capabilityMatrix.js';
import { admitCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { admitCredentialScopeSet } from '../../isolation/common/isolationContract.js';
import {
	isCapacityView,
	isDecisionView,
	isLedgerLineView,
	isProvenanceView,
	isResetExpectationView,
	serializePresentationRecord,
} from '../../presentation/common/presentationContract.js';
import type {
	CapacityView,
	DecisionView,
	LedgerLineView,
	ProvenanceView,
	ResetExpectationView,
} from '../../presentation/common/presentationContract.js';

/** Version of the inference-drills contract set (declared ONCE here; the kit re-exports this copy). */
export const INFERENCE_DRILLS_VERSION = '1.0.0';

/**
 * The closed frozen drill-scenario-kind vocabulary - the honest
 * failure-scenario set the acceptance harness runs over the LANDED
 * kits (the README maps each drill to the family it accepts):
 * cooldown-hold (the routing route path under active cooldown),
 * retry-schedule (deterministic scheduling byte-equality across two
 * failover runs, one clock), failover-walk (the ordered alternates
 * to the no-route terminal), eligibility-denial (the isolation
 * checkEligibility denial laws), quota-exhaustion (the LANDED
 * boundary math at the exhausted edge), substitution-disclosure
 * (the honest-promise guard rejects the dishonest fixture
 * verbatim). Widening the set is a contract change requiring a
 * version bump.
 */
export const DRILL_SCENARIO_KINDS = Object.freeze([
		'cooldown-hold',
		'retry-schedule',
		'failover-walk',
		'eligibility-denial',
		'quota-exhaustion',
		'substitution-disclosure',
] as const);
export type DrillScenarioKind = (typeof DRILL_SCENARIO_KINDS)[number];

/**
 * The closed frozen observed-verdict family vocabulary - the honest
 * observables the six drills map their folds onto, in kind order
 * with the breach member beside each kind's held member and the
 * first-class 'unknown' tail (the honest-unknown outcome). The
 * receipt passes exactly when observed === expected - an observed
 * 'unknown' against a non-unknown expectation is a FAIL plus an
 * honest-unknown count, never a coerced pass.
 */
export const DRILL_VERDICT_FAMILIES = Object.freeze([
		'cooldown-hold',
		'cooldown-breach',
		'retry-schedule-byte-equal',
		'retry-schedule-diverged',
		'failover-walk-exhausted',
		'failover-walk-selected',
		'eligibility-ineligible',
		'eligibility-term-unknown',
		'eligibility-eligible',
		'quota-exhausted',
		'quota-available',
		'substitution-rejected',
		'substitution-admitted',
		'unknown',
] as const);
export type DrillVerdictFamily = (typeof DRILL_VERDICT_FAMILIES)[number];

/**
 * The closed frozen drill-fold vocabulary - which LANDED fold each
 * drill-log row exercised; the row's verdict carries the LANDED
 * vocabulary member the fold produced, verbatim.
 */
export const DRILL_FOLDS = Object.freeze([
		'admitHonestPromise',
		'unverifiedProvenance',
		'route',
		'runWithFailover',
		'checkEligibility',
		'quotaWindowContains',
		'cooldownActive',
		'projectCapacityDisclosure',
		'projectProvenance',
		'projectReset',
		'projectDecision',
] as const);
export type DrillFold = (typeof DRILL_FOLDS)[number];

/**
 * Closed frozen list of drill rejection reasons, in the exact check
 * order (each guard walk applies its applicable subset in this
 * order; the FIRST failure is THE verdict):
 *   not-an-object             - the candidate is not an object;
 *   version-mismatch          - contractVersion is not the declared
 *                               INFERENCE_DRILLS_VERSION;
 *   scenario-malformed        - the scenario fails its own shape law
 *                               (field set, id/seed/expected shapes,
 *                               the fixture surface shapes);
 *   scenario-kind-unrunnable  - the kind is no member of the closed
 *                               DRILL_SCENARIO_KINDS vocabulary;
 *   fixture-id-not-synthetic  - THE FIXTURE-PREFIXED LAW: a
 *                               disclosed fixture id names a real or
 *                               authority-looking id (no 'fixture.'
 *                               prefix);
 *   scenario-inputs-rejected  - the fixture surfaces fail their
 *                               LANDED admission guards (the landed
 *                               reason cited verbatim in the
 *                               detail);
 *   scenario-target-malformed - the target binding is malformed (an
 *                               eligibility-denial scenario with no
 *                               target, a dangling target, or a
 *                               target on a non-targeting kind);
 *   receipt-malformed         - the receipt fails its own shape law
 *                               (field set, log rows, the structural
 *                               pass law);
 *   receipt-citation-missing  - THE ACCEPTANCE-VIEW CITATION LAW:
 *                               the receipt carries no citation;
 *   receipt-citation-rejected - a cited view fails its LANDED shape
 *                               guard, or the cited bytes are not
 *                               the LANDED canonical bytes.
 */
export const DRILL_REJECTION_REASONS = Object.freeze([
		'not-an-object',
		'version-mismatch',
		'scenario-malformed',
		'scenario-kind-unrunnable',
		'fixture-id-not-synthetic',
		'scenario-inputs-rejected',
		'scenario-target-malformed',
		'receipt-malformed',
		'receipt-citation-missing',
		'receipt-citation-rejected',
] as const);
export type DrillRejectionReason = (typeof DRILL_REJECTION_REASONS)[number];

/** The drill scenario's exact own-field set (the shape-law whitelist). */
const SCENARIO_FIELDS = [
		'contractVersion', 'scenarioId', 'kind', 'clockSeed', 'expected',
		'catalog', 'adapters', 'scopes', 'matrix', 'targetId',
] as const;

/** The drill receipt's exact own-field set (the shape-law whitelist). */
const RECEIPT_FIELDS = [
		'contractVersion', 'scenarioId', 'scenarioKind', 'expected', 'observed',
		'passed', 'drillLog', 'citation', 'auditLedgerPath',
] as const;

/** One cited view row's exact own-field set. */
const CITED_VIEW_FIELDS = ['view', 'canonicalBytes'] as const;

/**
 * The typed drill scenario: the pure scenario definition - the kind,
 * the synthetic fixture inputs (the catalog / adapter / scope
 * surfaces and the optional capability matrix, all fixture-prefixed),
 * the injected clock seed, the expected verdict family, and the
 * eligibility-denial target scope id. The fixture surfaces arrive as
 * unknown at the runtime boundary and are validated through the
 * LANDED admission guards.
 */
export interface DrillScenario {
	readonly contractVersion: string;
	readonly scenarioId: string;
	readonly kind: DrillScenarioKind;
	readonly clockSeed: number;
	readonly expected: DrillVerdictFamily;
	readonly catalog: unknown;
	readonly adapters: unknown;
	readonly scopes: unknown;
	readonly matrix?: unknown;
	readonly targetId?: string;
}

export interface DrillScenarioAdmitted {
	readonly admitted: true;
	readonly scenario: DrillScenario;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface DrillScenarioRejected {
	readonly admitted: false;
	readonly reason: DrillRejectionReason;
	readonly detail: string;
}

export type DrillScenarioAdmission = DrillScenarioAdmitted | DrillScenarioRejected;

/**
 * One disclosed drill-log row: the LANDED fold that ran and the
 * LANDED vocabulary member it produced, carried VERBATIM (the
 * verbatim-vocabulary law) - cited, never re-worded.
 */
export interface DrillLogEntry {
	readonly fold: DrillFold;
	readonly verdict: string;
}

/** The landed presentation view vocabulary a citation may carry (the five landed view shapes). */
export type DrillCitedViewLike =
	| ProvenanceView
	| CapacityView
	| ResetExpectationView
	| DecisionView
	| LedgerLineView;

/**
 * One acceptance-view citation row: the projected presentation view
 * object plus its canonical bytes through the LANDED
 * serializePresentationRecord - the bytes ARE the citation,
 * byte-pinned, never re-derived.
 */
export interface DrillCitedView {
	readonly view: DrillCitedViewLike;
	readonly canonicalBytes: string;
}

/**
 * The typed drill receipt: the observed verdict vs the expected
 * verdict, the disclosed drill log (the LANDED vocabulary members
 * verbatim), THE ACCEPTANCE-VIEW CITATION (the projected
 * presentation views plus their LANDED canonical bytes), and the
 * disclosed audit-ledger path (the presentation-audits.jsonl ledger
 * under the kit's fixture ledgerRoot - the audit-stream law). passed
 * is STRUCTURAL: it equals (expected === observed), pinned by the
 * guard.
 */
export interface DrillReceipt {
	readonly contractVersion: string;
	readonly scenarioId: string;
	readonly scenarioKind: DrillScenarioKind;
	readonly expected: DrillVerdictFamily;
	readonly observed: DrillVerdictFamily;
	readonly passed: boolean;
	readonly drillLog: readonly DrillLogEntry[];
	readonly citation: readonly DrillCitedView[];
	readonly auditLedgerPath: string;
}

export interface DrillReceiptAdmitted {
	readonly admitted: true;
	readonly receipt: DrillReceipt;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface DrillReceiptRejected {
	readonly admitted: false;
	readonly reason: DrillRejectionReason;
	readonly detail: string;
}

export type DrillReceiptAdmission = DrillReceiptAdmitted | DrillReceiptRejected;

/**
 * Pure fail-closed scenario guard (the scenario walk of the frozen
 * list): the version stamp, the shape law, the closed kind
 * vocabulary, THE FIXTURE-PREFIXED LAW over every disclosed fixture
 * id, the LANDED admission guards over the fixture surfaces (the
 * landed reasons cited verbatim), and the target binding law.
 * Deterministic: same candidate, same verdict, same reason and
 * detail. Never mutates its input; never reads a clock.
 */
export function admitDrillScenario(candidate: unknown): DrillScenarioAdmission {
	if (!isRecord(candidate)) {
		return rejectScenario('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	if (record.contractVersion !== INFERENCE_DRILLS_VERSION) {
		return rejectScenario(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_DRILLS_VERSION}', got '${String(record.contractVersion)}'`,
		);
	}
	if (!carriesOnlyFields(record, SCENARIO_FIELDS)) {
		return rejectScenario(
			'scenario-malformed',
			'the scenario carries a field beyond the drill-scenario shape (contractVersion, scenarioId, kind, clockSeed, expected, catalog, adapters, scopes, and the optional matrix and targetId) - no extra field is representable',
		);
	}
	if (!isNonEmptyString(record.scenarioId)) {
		return rejectScenario('scenario-malformed', 'scenarioId must be a non-empty string');
	}
	if (!isNonEmptyString(record.kind)) {
		return rejectScenario('scenario-malformed', 'kind must be a non-empty string');
	}
	if (!isFiniteEpochMs(record.clockSeed)) {
		return rejectScenario('scenario-malformed', 'clockSeed must be a finite epoch-ms number (the injected clock seed)');
	}
	if (!(DRILL_VERDICT_FAMILIES as readonly string[]).includes(record.expected as string)) {
		return rejectScenario(
			'scenario-malformed',
			`expected must be a member of the closed DRILL_VERDICT_FAMILIES vocabulary, got '${String(record.expected)}'`,
		);
	}
	for (const surface of ['catalog', 'adapters', 'scopes'] as const) {
		if (!isRecord(record[surface]) || Array.isArray(record[surface])) {
			return rejectScenario(
				'scenario-malformed',
				`fixtures.${surface} must be a non-null non-array object (the landed record shape), got '${typeof record[surface]}'`,
			);
		}
	}
	if (record.matrix !== undefined && (!isRecord(record.matrix) || Array.isArray(record.matrix))) {
		return rejectScenario('scenario-malformed', 'fixtures.matrix, when present, must be a non-null non-array object');
	}
	if (record.targetId !== undefined && !isNonEmptyString(record.targetId)) {
		return rejectScenario('scenario-malformed', 'targetId, when present, must be a non-empty string');
	}
	if (!(DRILL_SCENARIO_KINDS as readonly string[]).includes(record.kind as string)) {
		return rejectScenario(
			'scenario-kind-unrunnable',
			`kind '${String(record.kind)}' is no member of the closed DRILL_SCENARIO_KINDS vocabulary (${DRILL_SCENARIO_KINDS.join('/')}) - an unrunnable kind is a typed rejection, never a silent skip`,
		);
	}
	const syntheticViolation = firstNonSyntheticFixtureId(record);
	if (syntheticViolation !== undefined) {
		return rejectScenario(
			'fixture-id-not-synthetic',
			`${syntheticViolation} does not carry the mandatory 'fixture.' prefix - drill fixtures are SYNTHETIC and fixture-prefixed, never authority values (the fixture-prefixed law)`,
		);
	}
	const catalogAdmission = admitCatalogRecord(record.catalog);
	if (!catalogAdmission.admitted) {
		return rejectScenario(
			'scenario-inputs-rejected',
			`fixtures.catalog must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const adaptersAdmission = admitProviderAdapterRecord(record.adapters, record.catalog);
	if (!adaptersAdmission.admitted) {
		return rejectScenario(
			'scenario-inputs-rejected',
			`fixtures.adapters must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
		);
	}
	const scopesAdmission = admitCredentialScopeSet(record.scopes, adaptersAdmission.record, catalogAdmission.record);
	if (!scopesAdmission.admitted) {
		return rejectScenario(
			'scenario-inputs-rejected',
			`fixtures.scopes must satisfy admitCredentialScopeSet: '${scopesAdmission.reason}': ${scopesAdmission.detail}`,
		);
	}
	if (record.matrix !== undefined) {
		const matrixAdmission = admitCapabilityMatrix(record.matrix, record.catalog);
		if (!matrixAdmission.admitted) {
			return rejectScenario(
				'scenario-inputs-rejected',
				`fixtures.matrix must satisfy admitCapabilityMatrix: '${matrixAdmission.reason}': ${matrixAdmission.detail}`,
			);
		}
	}
	if (record.kind === 'eligibility-denial') {
		if (record.targetId === undefined) {
			return rejectScenario(
				'scenario-target-malformed',
				'an eligibility-denial scenario must name its fixture target scope id (targetId) - the drill drives the LANDED checkEligibility over the named scope, never an implicit one',
			);
		}
		const scopeIds = scopesAdmission.record.scopes.map((scope) => scope.id);
		if (!scopeIds.includes(record.targetId)) {
			return rejectScenario(
				'scenario-target-malformed',
				`the eligibility-denial targetId '${String(record.targetId)}' resolves to no scope in the fixture scope set (${scopeIds.join('/')}) - a dangling target reference is a typed rejection, never a silent skip`,
			);
		}
	} else if (record.targetId !== undefined) {
		return rejectScenario(
			'scenario-target-malformed',
			`kind '${String(record.kind)}' takes no targetId - the target binding is the eligibility-denial drill's own, never silently ignored`,
		);
	}
	return {
		admitted: true,
		scenario: {
			contractVersion: record.contractVersion,
			scenarioId: record.scenarioId,
			kind: record.kind as DrillScenarioKind,
			clockSeed: record.clockSeed,
			expected: record.expected as DrillVerdictFamily,
			catalog: record.catalog,
			adapters: record.adapters,
			scopes: record.scopes,
			...(record.matrix !== undefined ? { matrix: record.matrix } : {}),
			...(record.targetId !== undefined ? { targetId: record.targetId } : {}),
		},
	};
}

/**
 * Pure fail-closed receipt guard (the receipt walk of the frozen
 * list): the version stamp, the shape law INCLUDING the structural
 * pass law (passed === (expected === observed)) and the closed
 * vocabularies, then THE ACCEPTANCE-VIEW CITATION LAW - the citation
 * is present and every cited view satisfies one of the five LANDED
 * presentation shape guards with byte-pinned LANDED canonical bytes.
 * Deterministic; never mutates its input; never reads a clock.
 */
export function admitDrillReceipt(candidate: unknown): DrillReceiptAdmission {
	if (!isRecord(candidate)) {
		return rejectReceipt('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	if (record.contractVersion !== INFERENCE_DRILLS_VERSION) {
		return rejectReceipt(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_DRILLS_VERSION}', got '${String(record.contractVersion)}'`,
		);
	}
	if (!carriesOnlyFields(record, RECEIPT_FIELDS)) {
		return rejectReceipt(
			'receipt-malformed',
			'the receipt carries a field beyond the drill-receipt shape (contractVersion, scenarioId, scenarioKind, expected, observed, passed, drillLog, citation, auditLedgerPath) - no extra field is representable',
		);
	}
	if (!isNonEmptyString(record.scenarioId)) {
		return rejectReceipt('receipt-malformed', 'scenarioId must be a non-empty string');
	}
	if (!(DRILL_SCENARIO_KINDS as readonly string[]).includes(record.scenarioKind as string)) {
		return rejectReceipt(
			'receipt-malformed',
			`scenarioKind must be a member of the closed DRILL_SCENARIO_KINDS vocabulary, got '${String(record.scenarioKind)}'`,
		);
	}
	for (const side of ['expected', 'observed'] as const) {
		if (!(DRILL_VERDICT_FAMILIES as readonly string[]).includes(record[side] as string)) {
			return rejectReceipt(
				'receipt-malformed',
				`the receipt ${side} must be a member of the closed DRILL_VERDICT_FAMILIES vocabulary, got '${String(record[side])}'`,
			);
		}
	}
	if (typeof record.passed !== 'boolean' || record.passed !== (record.expected === record.observed)) {
		return rejectReceipt(
			'receipt-malformed',
			'the receipt passed flag must equal (expected === observed) - the pass law is structural, never a caller-declared boolean',
		);
	}
	if (!isDrillLogShape(record.drillLog)) {
		return rejectReceipt(
			'receipt-malformed',
			'the drill log must be a non-empty array of {fold, verdict} rows with fold a member of the closed DRILL_FOLDS vocabulary and verdict a non-empty string (the verbatim-vocabulary law)',
		);
	}
	if (!isNonEmptyString(record.auditLedgerPath)) {
		return rejectReceipt('receipt-malformed', 'auditLedgerPath must be a non-empty string (the audit-stream disclosure)');
	}
	const citation = record.citation;
	if (!Array.isArray(citation) || citation.length === 0) {
		return rejectReceipt(
			'receipt-citation-missing',
			'the receipt carries no acceptance-view citation - THE ACCEPTANCE-VIEW CITATION LAW: every receipt cites its projected presentation views verbatim (the view objects plus their LANDED canonical bytes), never an empty citation',
		);
	}
	for (let index = 0; index < citation.length; index++) {
		const row = citation[index];
		if (!isRecord(row) || !carriesOnlyFields(row, CITED_VIEW_FIELDS)) {
			return rejectReceipt(
				'receipt-citation-rejected',
				`citation[${index}] must be a {view, canonicalBytes} row - the citation carries the view object and its LANDED canonical bytes, nothing else`,
			);
		}
		if (!isLandedPresentationView(row.view)) {
			return rejectReceipt(
				'receipt-citation-rejected',
				`citation[${index}].view satisfies no landed presentation shape guard (isProvenanceView / isCapacityView / isResetExpectationView / isDecisionView / isLedgerLineView) - the acceptance-view citation carries the LANDED views, never a parallel shape`,
			);
		}
		if (!isNonEmptyString(row.canonicalBytes) || row.canonicalBytes !== serializePresentationRecord(row.view)) {
			return rejectReceipt(
				'receipt-citation-rejected',
				`citation[${index}].canonicalBytes are not the landed serializePresentationRecord bytes of the cited view - the canonical bytes ARE the citation, byte-pinned, never re-derived`,
			);
		}
	}
	return { admitted: true, receipt: candidate as unknown as DrillReceipt };
}

/** Pure shape predicate: a well-formed drill receipt (the citation included). */
export function isDrillReceipt(value: unknown): value is DrillReceipt {
	return admitDrillReceipt(value).admitted;
}

/**
 * Canonical serialization of a drill receipt: fixed key order
 * (contractVersion, scenarioId, scenarioKind, expected, observed,
 * passed, drillLog, citation, auditLedgerPath), deterministic bytes
 * regardless of the input record's key insertion order. The cited
 * views are embedded through the LANDED serializePresentationRecord
 * bytes re-parsed - the landed key order rides verbatim (the routing
 * serializer's cited idiom). Refuses non-admitted receipts
 * fail-closed (TypeError) - no dishonest drill receipt ever gets
 * canonical bytes.
 */
export function serializeDrillReceipt(receipt: unknown): string {
	if (!isDrillReceipt(receipt)) {
		throw new TypeError(
			'serializeDrillReceipt: receipt must satisfy isDrillReceipt - no dishonest drill receipt ever gets canonical bytes',
		);
	}
	return JSON.stringify({
		contractVersion: receipt.contractVersion,
		scenarioId: receipt.scenarioId,
		scenarioKind: receipt.scenarioKind,
		expected: receipt.expected,
		observed: receipt.observed,
		passed: receipt.passed,
		drillLog: receipt.drillLog.map((entry) => ({ fold: entry.fold, verdict: entry.verdict })),
		citation: receipt.citation.map((cited) => ({
			view: JSON.parse(serializePresentationRecord(cited.view)) as Record<string, unknown>,
			canonicalBytes: cited.canonicalBytes,
		})),
		auditLedgerPath: receipt.auditLedgerPath,
	});
}

/**
 * THE FIXTURE-PREFIXED LAW's walk: the first disclosed fixture id
 * that does not carry the 'fixture.' prefix, named by its field
 * path - the scenario's own ids plus every disclosed record id on
 * the fixture surfaces. Malformed surfaces defer to the LANDED
 * guards (the inputs walk); this walk covers only what is walkable.
 */
function firstNonSyntheticFixtureId(record: Record<string, unknown>): string | undefined {
	if (isNonEmptyString(record.scenarioId) && !record.scenarioId.startsWith('fixture.')) {
		return `scenarioId '${record.scenarioId}'`;
	}
	if (record.targetId !== undefined && isNonEmptyString(record.targetId) && !record.targetId.startsWith('fixture.')) {
		return `targetId '${record.targetId}'`;
	}
	const surfaces: ReadonlyArray<readonly [string, unknown, string, string, string]> = [
		['catalog', record.catalog, 'catalogId', 'entries', 'entryId'],
		['adapters', record.adapters, 'adapterSetId', 'adapters', 'adapterId'],
		['scopes', record.scopes, 'scopeSetId', 'scopes', 'id'],
		['matrix', record.matrix, 'matrixId', 'descriptors', 'modelId'],
	];
	for (const [name, surface, recordIdField, rowsField, rowIdField] of surfaces) {
		if (!isRecord(surface)) {
			continue;
		}
		const recordId = surface[recordIdField];
		if (isNonEmptyString(recordId) && !recordId.startsWith('fixture.')) {
			return `${name}.${recordIdField} '${recordId}'`;
		}
		const rows = surface[rowsField];
		if (!Array.isArray(rows)) {
			continue;
		}
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			if (!isRecord(row)) {
				continue;
			}
			const rowId = row[rowIdField];
			if (isNonEmptyString(rowId) && !rowId.startsWith('fixture.')) {
				return `${name}[${index}].${rowIdField} '${rowId}'`;
			}
		}
	}
	return undefined;
}

/** The drill-log shape law: non-empty rows over the closed fold vocabulary. */
function isDrillLogShape(log: unknown): log is readonly DrillLogEntry[] {
	if (!Array.isArray(log) || log.length === 0) {
		return false;
	}
	for (const entry of log) {
		if (!isRecord(entry) || !carriesOnlyFields(entry, ['fold', 'verdict'])) {
			return false;
		}
		if (!(DRILL_FOLDS as readonly string[]).includes((entry as Record<string, unknown>).fold as string)) {
			return false;
		}
		if (!isNonEmptyString((entry as Record<string, unknown>).verdict)) {
			return false;
		}
	}
	return true;
}

/** The five LANDED presentation shape guards, in the serializer's own fixed trial order. */
function isLandedPresentationView(value: unknown): value is DrillCitedViewLike {
	return (
		isProvenanceView(value)
		|| isCapacityView(value)
		|| isResetExpectationView(value)
		|| isDecisionView(value)
		|| isLedgerLineView(value)
	);
}

function rejectScenario(reason: DrillRejectionReason, detail: string): DrillScenarioRejected {
	return { admitted: false, reason, detail };
}

function rejectReceipt(reason: DrillRejectionReason, detail: string): DrillReceiptRejected {
	return { admitted: false, reason, detail };
}

/** The no-extra-own-fields check (the isolation family's no-extra-keys idiom). */
function carriesOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
	for (const key of Object.keys(record)) {
		if (!fields.includes(key)) {
			return false;
		}
	}
	return true;
}

function isFiniteEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
