/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-008 Free Inference Fabric contracts: the typed PROVENANCE /
 * CAPACITY / RESET presentation family - the read-side projection
 * views over the landed canonical surfaces (the INF-001 semantics
 * family's provenance / capacity-disclosure / reset-schedule
 * vocabulary, the INF-005 routing family's decision bytes, the
 * INF-006 matching family's decision records and the INF-007
 * isolation family's eligibility decisions), the frozen projection
 * rejection vocabulary, the unified selected/refused decision view
 * and the canonical view serialization (contract module, the
 * labContracts discipline; every landed vocabulary is bound by
 * relative import and carried VERBATIM, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..007 family laws are INHERITED and binding here):
 * - THE NEVER-RE-DERIVE LAW (binding, this family's charter): every
 *   view is a PROJECTION of the landed canonical surfaces. The
 *   verification, substitution, health, capacity-state, reset-class
 *   and decision vocabularies are the landed ones VERBATIM - no
 *   parallel display vocabulary exists anywhere in this family. The
 *   provenance view's scope label is the landed record's own actual
 *   model field carried verbatim (the landed probe-scope conventions
 *   ride exactly that field); the capacity view's cooldown verdict is
 *   the landed disclosed capacity state's own 'cooldown' membership
 *   (the inclusive-boundary fold happened upstream through the landed
 *   projection, never re-computed here); a caller-supplied provenance,
 *   substitution, verification or scope label - any field beyond the
 *   landed canonical shape - is the typed 'caller-supplied-label'
 *   rejection: the view's labels are DERIVED from the landed record,
 *   never supplied.
 * - THE NEVER-SILENT-EMPTY LAW (binding): the refused sides are
 *   shown. The unified decision view carries the selected side AND
 *   the refused side - the EligibilityRefused-class and
 *   no-routable-candidate-class refusals project to the "why" views
 *   with their typed reasons verbatim (the routing attempt ledger's
 *   own reasons in ledger order, the matching verdict rows' own
 *   verdict values in row order, the isolation refusal's own typed
 *   detail). A ledger stream projects EVERY line exactly once - a
 *   malformed line is the typed 'malformed-ledger-line' refusal
 *   outcome, never a silent drop. Honest-unknown states project AS
 *   unknown (the stale fixed-instant reset, the unknown capacity
 *   state, the term-unknown verdict) - never fabricated healthy,
 *   eligible or future values.
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. Every timestamp is a caller-injected epoch-ms number
 *   carried verbatim from the landed record, or - for the reset
 *   countdown view - the single injected probe the kit folds over.
 *   No Date.now, no Math.random, no process.env in this module (law
 *   comments excepted). A reset countdown view is a pure fold of
 *   (schedule, now) through the LANDED nextResetAt - never a hidden
 *   clock read, never re-implemented boundary math.
 * - THE NO-DANGLING-REF LAW (extended to presentation): every view's
 *   source binding resolves against the BOUND record surface - a
 *   decision's adapter binding resolves in the bound adapter record,
 *   an isolation decision's scope binding resolves in the bound
 *   credential scope set, a ledger line index resolves in the bound
 *   ledger file - or projection is the typed 'unresolved-*' rejection,
 *   never a silent dangling ref.
 * - THE CANONICAL-BYTES LAW: a ledger line parses through the LANDED
 *   serializer's own canonical bytes - the parsed record must admit
 *   under the landed decision guard AND round-trip byte-equal through
 *   the landed serializeRoutingDecision / serializeMatchDecision /
 *   serializeEligibilityDecision (cited, never re-derived; the byte
 *   comparison IS the parse). A line that is not the landed canonical
 *   byte form is the typed 'malformed-ledger-line' rejection, never a
 *   silent drop, never a re-serialized stand-in.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every projection rejection is a typed member of the
 *   frozen PRESENTATION_REJECTION_REASONS list; each walk applies its
 *   applicable subset in the list order and the FIRST failure is THE
 *   verdict, and every rejection names its reason.
 * - THE SAFETY LAW STANDS (binding): no network I/O anywhere; no
 *   credential material in any view (the landed no-credential shapes
 *   are the only representable ones - a view can name a plain adapter
 *   id or scope id reference, never a secret value, a key byte, a
 *   token string or an env name).
 * - Canonical bytes: serializePresentationRecord emits fixed-key-order
 *   deterministic bytes (double-run byte-equal); every view carries
 *   contractVersion; transient rejection verdicts carry reason +
 *   detail (the landed families' rejection idiom).
 * - Zero external dependencies: node: builtins (none needed here) and
 *   the landed sibling families only.
 */
import {
	DISCLOSED_CAPACITY_STATES,
	PROVIDER_HEALTH_STATES,
	PROVIDER_METADATA_VERIFICATIONS,
	RESET_SCHEDULE_KINDS,
	SUBSTITUTION_STATES,
} from '../../semantics/common/capacityDisclosure.js';
import type {
	DisclosedCapacityState,
	ProviderHealthState,
	ProviderMetadataVerification,
	ResetExpectation,
	ResetScheduleKind,
	SubstitutionState,
} from '../../semantics/common/capacityDisclosure.js';

/**
 * Version of the inference-presentation contract set (this family's
 * own constant, declared ONCE here - the single version declaration
 * law; every presentation-family view carries it). The sibling
 * presentationKit module re-carries this same declaration
 * (re-exported; the battery pins both module copies equal). The
 * vocabulary INSIDE the views is the landed families', bound
 * verbatim and never re-implemented: verification / substitution /
 * health / capacity-state / reset-class states ride the INF-001
 * semantics family's vocabularies, decision shapes ride the
 * INF-005/006/007 families' landed records. Those landed sub-records
 * keep their own family version stamps; the presentation stamp and
 * the landed stamps are distinct roles pinned by the battery.
 */
export const INFERENCE_PRESENTATION_VERSION = '1.0.0';

/**
 * Closed frozen list of presentation rejection reasons, in the exact
 * list order (each projection walk applies its applicable subset in
 * this order; the first failure is THE verdict):
 *   not-an-object              - the candidate is not an object (every
 *                                walk);
 *   unknown-decision-family    - a decision record no landed decision
 *                                family (routing / matching /
 *                                isolation) discriminates;
 *   caller-supplied-label      - THE NEVER-RE-DERIVE LAW: the
 *                                candidate carries a field beyond the
 *                                landed canonical shape - a
 *                                caller-supplied provenance,
 *                                substitution, verification or scope
 *                                label; the view's labels are DERIVED
 *                                from the landed record, never
 *                                supplied;
 *   shape-law-violation        - the shape-law reason: the candidate
 *                                fails the landed guard (the landed
 *                                rejection cited verbatim in the
 *                                detail) or the walk's own input-shape
 *                                law (the ledger path / line index
 *                                shape, the ledger stream shape);
 *   unresolved-ledger-line     - THE NO-DANGLING-REF LAW: the ledger
 *                                surface does not resolve (a missing
 *                                ledger file, a non-file path) or the
 *                                line index resolves to no ledger line
 *                                (out of range);
 *   malformed-ledger-line      - a ledger line that is not the landed
 *                                canonical byte form: unparseable
 *                                bytes, a record no landed decision
 *                                guard admits, or a round-trip through
 *                                the landed serializer that differs
 *                                from the line's own bytes - never a
 *                                silent drop;
 *   unresolved-decision-record - THE NO-DANGLING-REF LAW: the
 *                                decision's own id binding (the
 *                                isolation decision's scope id)
 *                                resolves to no bound credential scope,
 *                                or resolves cross-inconsistently with
 *                                the decision's adapter binding;
 *   unresolved-adapter-binding - THE NO-DANGLING-REF LAW: an adapter
 *                                binding (the decision's own, the
 *                                selected candidate's, or a refused
 *                                row's / ledger entry's adapterId)
 *                                resolves to no adapter in the bound
 *                                adapter record.
 */
export const PRESENTATION_REJECTION_REASONS = [
	'not-an-object',
	'unknown-decision-family',
	'caller-supplied-label',
	'shape-law-violation',
	'unresolved-ledger-line',
	'malformed-ledger-line',
	'unresolved-decision-record',
	'unresolved-adapter-binding',
] as const;
export type PresentationRejectionReason = (typeof PRESENTATION_REJECTION_REASONS)[number];

/**
 * The closed frozen decision-family vocabulary: which landed decision
 * surface a decision view projects. The list order (routing,
 * matching, isolation) is the landed landing order and the ledger
 * admission order - frozen; widening is a versioned contract
 * decision, never a silent addition.
 */
export const PRESENTATION_DECISION_FAMILIES = ['routing', 'matching', 'isolation'] as const;
export type PresentationDecisionFamily = (typeof PRESENTATION_DECISION_FAMILIES)[number];

/** The closed frozen unified-side vocabulary: the selected side and the refused side. */
export const DECISION_VIEW_SIDES = ['selected', 'refused'] as const;
export type DecisionViewSide = (typeof DECISION_VIEW_SIDES)[number];

/** Typed refusal: closed reason, detail names the violation. */
export interface PresentationRefused {
	readonly projected: false;
	readonly reason: PresentationRejectionReason;
	readonly detail: string;
}

/** The projected side of any presentation fold. */
export interface PresentationProjected<TView> {
	readonly projected: true;
	readonly view: TView;
}

export type PresentationOutcome<TView> = PresentationProjected<TView> | PresentationRefused;

/**
 * The provenance view: the projection of the landed
 * InferenceProvenance - the verification state, the substitution
 * label and the scope label, ALL derived from the landed record
 * verbatim (THE NEVER-RE-DERIVE LAW). verification rides the landed
 * ProviderMetadataVerification vocabulary; substitution rides the
 * landed SubstitutionState vocabulary; the scope label IS the landed
 * record's own actual model field carried verbatim (the landed
 * probe-scope conventions - ROUTING_PROBE_SCOPE /
 * ISOLATION_ELIGIBILITY_PROBE_SCOPE - ride exactly that field, and a
 * model-scoped provenance carries the model id there): the view
 * derives the label from the landed record (the shape guard pins
 * scopeLabel === actualModelId structurally), never re-derives a
 * display label, and a caller-supplied label is the typed rejection.
 * Carries the presentation contract-set version stamp.
 */
export interface ProvenanceView {
	readonly contractVersion: string;
	readonly verification: ProviderMetadataVerification;
	readonly substitution: SubstitutionState;
	readonly scopeLabel: string;
	readonly requestedProviderId: string;
	readonly requestedModelId: string;
	readonly actualProviderId: string;
	readonly actualModelId: string;
	readonly recordedAtEpochMs: number;
}

/**
 * The reset expectation view: the pure fold of (the landed
 * ResetSchedule, an injected now). resetClass is the landed schedule's
 * own kind carried VERBATIM through the landed RESET_SCHEDULE_KINDS
 * membership (the honest 'unknown' class for a malformed or non-member
 * schedule - never a fabricated class); expectation is the LANDED
 * nextResetAt fold (the inclusive boundary law: a probe exactly at a
 * reset instant names that instant; the stale-reset law: a
 * fixed-instant reset in the past projects the honest 'unknown'
 * EXPECTATION - never a fabricated future); projectedAtEpochMs is the
 * injected probe instant. Carries the presentation contract-set
 * version stamp.
 */
export interface ResetExpectationView {
	readonly contractVersion: string;
	readonly resetClass: ResetScheduleKind;
	readonly expectation: ResetExpectation;
	readonly projectedAtEpochMs: number;
}

/**
 * The capacity view: the projection of the landed
 * ProviderCapacityDisclosure - health, quota, cooldown and reset, the
 * user-facing shapes over the landed vocabulary ONLY. health rides the
 * landed ProviderHealthState vocabulary; verification rides the landed
 * ProviderMetadataVerification vocabulary; capacityState rides the
 * landed DisclosedCapacityState vocabulary (the total disclosed fold,
 * computed upstream THROUGH the landed projectCapacityDisclosure with
 * its INCLUSIVE boundary verdicts - the cooldown gate, the quota
 * window and the reset probe never re-computed here); cooldown is the
 * landed capacity state's own 'cooldown' membership (the shape guard
 * pins the fold structurally); quotaRemaining and resetExpectation are
 * carried verbatim; provenance is the mandatory provenance view
 * (projection of the landed disclosure's own provenance); the
 * generation instant is the disclosure's own. Carries the presentation
 * contract-set version stamp.
 */
export interface CapacityView {
	readonly contractVersion: string;
	readonly providerId: string;
	readonly health: ProviderHealthState;
	readonly verification: ProviderMetadataVerification;
	readonly capacityState: DisclosedCapacityState;
	readonly cooldown: boolean;
	readonly quotaRemaining: number | 'unknown';
	readonly resetExpectation: ResetExpectation;
	readonly provenance: ProvenanceView;
	readonly generatedAtEpochMs: number;
}

/**
 * The unified read-side decision view over the landed decision
 * surfaces (routing / matching / isolation): the selected side AND
 * the refused side (THE NEVER-SILENT-EMPTY LAW). family names which
 * landed surface was projected; side is the unified fold (the
 * decided / matched / routing-decision records are the selected side
 * whatever honest verdict they carry - an 'ineligible' or
 * 'term-unknown' verdict is a DECIDED disclosure carried verbatim,
 * never a fabricated eligibility; the exhausted / no-matching-
 * candidate / no-eligible-binding records are the refused side);
 * decidedAtEpochMs is the landed decision instant verbatim; adapterId
 * is the source adapter binding (the literal 'none' - the landed
 * absence marker - on the refused side, where no single binding was
 * selected); reasons are THE TYPED REASONS VERBATIM - the selected
 * side carries the landed record's own typed user-facing label (the
 * routing decision's disclosed capacity state, the matched decision's
 * substitution label, the decided eligibility record's verdict), the
 * refused side carries the landed refusal reasons (the routing
 * attempt ledger's own reasons in ledger order, the matching verdict
 * rows' own verdict values in row order, the isolation refusal's own
 * typed detail) - never silent, and honestly empty exactly when the
 * landed refusal honestly carried nothing (a routing set with zero
 * admitted candidates); provenance is the derived provenance view
 * when the landed record carries one, the literal 'none' on the
 * refused side (nothing is fabricated). Carries the presentation
 * contract-set version stamp.
 */
export interface DecisionView {
	readonly contractVersion: string;
	readonly family: PresentationDecisionFamily;
	readonly side: DecisionViewSide;
	readonly decidedAtEpochMs: number;
	readonly adapterId: string;
	readonly reasons: readonly string[];
	readonly provenance: ProvenanceView | 'none';
}

/**
 * The ledger line view: the parsed projection of ONE ledger line -
 * the canonical bytes parsed through the LANDED serializer's own
 * shape (cited, never re-derived: the parsed record admitted under
 * the landed decision guard AND round-tripped byte-equal through the
 * landed serializer). line is the 1-based position in the ledger
 * stream (over the non-empty lines - the trailing-newline artifact
 * is not a line); family is the landed family whose canonical bytes
 * the line carries; canonicalBytes is the line's own bytes carried
 * verbatim; decision is the unified decision view (both sides, the
 * typed reasons verbatim). Carries the presentation contract-set
 * version stamp.
 */
export interface LedgerLineView {
	readonly contractVersion: string;
	readonly line: number;
	readonly family: PresentationDecisionFamily;
	readonly canonicalBytes: string;
	readonly decision: DecisionView;
}

/** One ledger stream entry: the projected side. */
export interface LedgerLineProjected {
	readonly projected: true;
	readonly line: number;
	readonly view: LedgerLineView;
}

/** One ledger stream entry: the typed refusal side (never a silent drop). */
export interface LedgerLineRefused {
	readonly projected: false;
	readonly line: number;
	readonly reason: PresentationRejectionReason;
	readonly detail: string;
}

export type LedgerLineOutcome = LedgerLineProjected | LedgerLineRefused;

/**
 * Canonical serialization of a presentation view: fixed key order per
 * view kind, deterministic bytes regardless of the input view's key
 * insertion order (the nested provenance and reset-expectation
 * sub-records are canonicalized too; the reasons array order is the
 * projection's own landed order, preserved verbatim). The view kinds
 * are tried in the fixed order provenance / capacity / reset /
 * decision / ledger-line through their shape guards; a candidate that
 * is no well-formed view is refused fail-closed (TypeError) - no
 * dishonest view ever gets canonical bytes. This canonical form is
 * the persistence/audit shape the kit's presentation-audits.jsonl
 * ledger appends and the INF-009 binder consumes.
 */
export function serializePresentationRecord(view: unknown): string {
	if (isProvenanceView(view)) {
		return JSON.stringify(canonicalProvenanceViewObject(view));
	}
	if (isCapacityView(view)) {
		return JSON.stringify({
			contractVersion: view.contractVersion,
			providerId: view.providerId,
			health: view.health,
			verification: view.verification,
			capacityState: view.capacityState,
			cooldown: view.cooldown,
			quotaRemaining: view.quotaRemaining,
			resetExpectation: canonicalExpectationObject(view.resetExpectation),
			provenance: canonicalProvenanceViewObject(view.provenance),
			generatedAtEpochMs: view.generatedAtEpochMs,
		});
	}
	if (isResetExpectationView(view)) {
		return JSON.stringify({
			contractVersion: view.contractVersion,
			resetClass: view.resetClass,
			expectation: canonicalExpectationObject(view.expectation),
			projectedAtEpochMs: view.projectedAtEpochMs,
		});
	}
	if (isDecisionView(view)) {
		return JSON.stringify(canonicalDecisionViewObject(view));
	}
	if (isLedgerLineView(view)) {
		return JSON.stringify({
			contractVersion: view.contractVersion,
			line: view.line,
			family: view.family,
			canonicalBytes: view.canonicalBytes,
			decision: canonicalDecisionViewObject(view.decision),
		});
	}
	throw new TypeError(
		'serializePresentationRecord: view must satisfy one of the presentation shape guards (isProvenanceView / isCapacityView / isResetExpectationView / isDecisionView / isLedgerLineView) - no dishonest view ever gets canonical bytes',
	);
}

/**
 * Pure shape guard: a well-formed provenance view. Pins the
 * never-re-derive law STRUCTURALLY: the verification and substitution
 * values are members of the landed vocabularies, the record's own
 * fields are exactly the view's (no extra display-label field is
 * representable), and scopeLabel EQUALS actualModelId - the label is
 * the landed record's own actual model field, never a re-derived
 * display label. Fails closed on every malformed path; never reads a
 * clock; never mutates its input.
 */
export function isProvenanceView(value: unknown): value is ProvenanceView {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, PROVENANCE_VIEW_FIELDS)) {
		// THE NEVER-RE-DERIVE LAW at the shape level: any field beyond
		// the view's own is a caller-supplied label, not a provenance view.
		return false;
	}
	if (view.contractVersion !== INFERENCE_PRESENTATION_VERSION) {
		return false;
	}
	if (!isProviderMetadataVerification(view.verification)) {
		return false;
	}
	if (!isSubstitutionState(view.substitution)) {
		return false;
	}
	if (
		!isNonEmptyString(view.requestedProviderId)
		|| !isNonEmptyString(view.requestedModelId)
		|| !isNonEmptyString(view.actualProviderId)
		|| !isNonEmptyString(view.actualModelId)
	) {
		return false;
	}
	if (!isNonEmptyString(view.scopeLabel)) {
		return false;
	}
	if (view.scopeLabel !== view.actualModelId) {
		// The scope label is the landed record's own actual model field
		// carried VERBATIM - a re-derived display label is not a projection.
		return false;
	}
	const sameSelection =
		view.actualProviderId === view.requestedProviderId && view.actualModelId === view.requestedModelId;
	if (view.substitution === 'none' && !sameSelection) {
		// THE NO-HIDDEN-SUBSTITUTION LAW, made structural (the landed
		// admitProvenance's own law): a differing actual selection labeled
		// 'none' is a hidden substitution - not a projection.
		return false;
	}
	if (view.substitution === 'disclosed' && sameSelection) {
		// The landed substitution-label-mismatch law, made structural: an
		// equal actual selection labeled 'disclosed' is a mislabeled view.
		return false;
	}
	return isFiniteEpochMs(view.recordedAtEpochMs);
}

/**
 * Pure shape guard: a well-formed capacity view. Pins the projection
 * laws STRUCTURALLY: every vocabulary field is a member of its landed
 * vocabulary; cooldown is EXACTLY the landed disclosed capacity
 * state's own 'cooldown' membership (the inclusive-boundary fold
 * happened upstream through the landed projection, never re-computed
 * here); the reset expectation mirrors the landed shape (the landed
 * ResetExpectation's own field checks, mirrored - the routing kit's
 * cited idiom); the provenance sub-record satisfies isProvenanceView.
 * Fails closed on every malformed path.
 */
export function isCapacityView(value: unknown): value is CapacityView {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, CAPACITY_VIEW_FIELDS)) {
		return false;
	}
	if (view.contractVersion !== INFERENCE_PRESENTATION_VERSION) {
		return false;
	}
	if (!isNonEmptyString(view.providerId)) {
		return false;
	}
	if (!isProviderHealthState(view.health)) {
		return false;
	}
	if (!isProviderMetadataVerification(view.verification)) {
		return false;
	}
	if (!isDisclosedCapacityState(view.capacityState)) {
		return false;
	}
	if (view.cooldown !== (view.capacityState === 'cooldown')) {
		// The cooldown verdict is the landed disclosed capacity state's
		// own 'cooldown' membership - never a recomputed cooldownActive.
		return false;
	}
	if (view.quotaRemaining !== 'unknown' && !isNonNegativeInteger(view.quotaRemaining)) {
		return false;
	}
	if (!isLandedResetExpectationShape(view.resetExpectation)) {
		return false;
	}
	if (!isProvenanceView(view.provenance)) {
		return false;
	}
	return isFiniteEpochMs(view.generatedAtEpochMs);
}

/**
 * Pure shape guard: a well-formed reset expectation view. Pins the
 * landed fold laws STRUCTURALLY: resetClass is a member of the landed
 * RESET_SCHEDULE_KINDS vocabulary; the expectation mirrors the landed
 * ResetExpectation shape; a KNOWN expectation's basis EQUALS the
 * reset class and originates from a known-producing class only
 * ('fixed-instant' / 'interval-aligned'), while a
 * 'provider-discretion' or 'unknown' class carries the honest
 * 'unknown' expectation - the landed law that a known next reset can
 * only originate from those two schedule kinds. A fixed-instant or
 * interval-aligned class MAY carry the honest 'unknown' expectation
 * (a stale reset, a malformed payload) - the honest-unknown
 * projection, never a fabricated future. Fails closed on every
 * malformed path.
 */
export function isResetExpectationView(value: unknown): value is ResetExpectationView {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, RESET_VIEW_FIELDS)) {
		return false;
	}
	if (view.contractVersion !== INFERENCE_PRESENTATION_VERSION) {
		return false;
	}
	if (!isResetScheduleKind(view.resetClass)) {
		return false;
	}
	if (!isLandedResetExpectationShape(view.expectation)) {
		return false;
	}
	const expectation = view.expectation as ResetExpectation;
	if (expectation.kind === 'known') {
		if (expectation.basis !== view.resetClass) {
			// A known expectation's basis is the schedule's own class - the
			// landed projectCapacityDisclosure fold, mirrored verbatim.
			return false;
		}
		if (view.resetClass !== 'fixed-instant' && view.resetClass !== 'interval-aligned') {
			return false;
		}
	}
	return isFiniteEpochMs(view.projectedAtEpochMs);
}

/**
 * Pure shape guard: a well-formed unified decision view. Pins the
 * never-silent-empty and nothing-is-fabricated laws STRUCTURALLY: the
 * family and side are members of the frozen vocabularies; the reasons
 * are non-empty strings in the projection's own order; the refused
 * side carries the literal 'none' adapter binding and the literal
 * 'none' provenance (nothing is fabricated on a refusal); the
 * selected side carries a real provenance view (every landed selected
 * shape carries one). Fails closed on every malformed path.
 */
export function isDecisionView(value: unknown): value is DecisionView {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, DECISION_VIEW_FIELDS)) {
		return false;
	}
	if (view.contractVersion !== INFERENCE_PRESENTATION_VERSION) {
		return false;
	}
	if (!isDecisionFamily(view.family)) {
		return false;
	}
	if (!isDecisionViewSide(view.side)) {
		return false;
	}
	if (!isFiniteEpochMs(view.decidedAtEpochMs)) {
		return false;
	}
	if (!isNonEmptyString(view.adapterId)) {
		return false;
	}
	if (!Array.isArray(view.reasons)) {
		return false;
	}
	for (const reason of view.reasons) {
		if (!isNonEmptyString(reason)) {
			return false;
		}
	}
	if (view.side === 'refused') {
		if (view.adapterId !== 'none') {
			// The refused side carries no single selected binding - the
			// landed absence marker, never a fabricated selection.
			return false;
		}
		return view.provenance === 'none';
	}
	return isProvenanceView(view.provenance);
}

/**
 * Pure shape guard: a well-formed ledger line view. Pins the ledger
 * laws STRUCTURALLY: the line is a 1-based positive integer; the
 * family is a member of the frozen vocabulary AND agrees with the
 * embedded decision view's own family (one line, one family); the
 * canonical bytes are a non-empty string; the embedded decision view
 * satisfies isDecisionView. Fails closed on every malformed path.
 */
export function isLedgerLineView(value: unknown): value is LedgerLineView {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, LEDGER_LINE_VIEW_FIELDS)) {
		return false;
	}
	if (view.contractVersion !== INFERENCE_PRESENTATION_VERSION) {
		return false;
	}
	if (!isPositiveLine(view.line)) {
		return false;
	}
	if (!isDecisionFamily(view.family)) {
		return false;
	}
	if (!isNonEmptyString(view.canonicalBytes)) {
		return false;
	}
	if (!isDecisionView(view.decision)) {
		return false;
	}
	return (view.decision as DecisionView).family === view.family;
}

/** The provenance view's exact own-field set (no display-label field is representable). */
const PROVENANCE_VIEW_FIELDS = [
	'contractVersion',
	'verification',
	'substitution',
	'scopeLabel',
	'requestedProviderId',
	'requestedModelId',
	'actualProviderId',
	'actualModelId',
	'recordedAtEpochMs',
] as const;

/** The capacity view's exact own-field set. */
const CAPACITY_VIEW_FIELDS = [
	'contractVersion',
	'providerId',
	'health',
	'verification',
	'capacityState',
	'cooldown',
	'quotaRemaining',
	'resetExpectation',
	'provenance',
	'generatedAtEpochMs',
] as const;

/** The reset expectation view's exact own-field set. */
const RESET_VIEW_FIELDS = ['contractVersion', 'resetClass', 'expectation', 'projectedAtEpochMs'] as const;

/** The decision view's exact own-field set. */
const DECISION_VIEW_FIELDS = [
	'contractVersion',
	'family',
	'side',
	'decidedAtEpochMs',
	'adapterId',
	'reasons',
	'provenance',
] as const;

/** The ledger line view's exact own-field set. */
const LEDGER_LINE_VIEW_FIELDS = ['contractVersion', 'line', 'family', 'canonicalBytes', 'decision'] as const;

/**
 * The landed InferenceProvenance's exact own-field set - the
 * caller-supplied-label walk's whitelist (a field beyond the landed
 * canonical shape is a caller-supplied label).
 */
export const LANDED_PROVENANCE_FIELDS = [
	'contractVersion',
	'requestedProviderId',
	'requestedModelId',
	'actualProviderId',
	'actualModelId',
	'substitution',
	'modelVerification',
	'recordedAtEpochMs',
] as const;

/**
 * The landed ProviderCapacityDisclosure's exact own-field set - the
 * caller-supplied-label walk's whitelist for the capacity projection.
 */
export const LANDED_DISCLOSURE_FIELDS = [
	'contractVersion',
	'providerId',
	'health',
	'verification',
	'capacityState',
	'quotaRemaining',
	'resetExpectation',
	'provenance',
	'generatedAtEpochMs',
] as const;

/**
 * The landed decision surfaces' exact own-field sets - the
 * caller-supplied-label walk's whitelist per discriminated family
 * shape (the routing decision, the routing exhausted outcome, the
 * matched and no-matching-candidate match decisions, the decided and
 * no-eligible-binding eligibility decisions). A field beyond the
 * discriminated shape is a caller-supplied label - the refusal sides
 * carry NO provenance or substitution by landed law (nothing is
 * fabricated), so a caller-supplied one is always the typed
 * rejection.
 */
export const LANDED_DECISION_FIELDS = {
	routingDecision: ['contractVersion', 'adapterId', 'selectionRule', 'disclosure', 'decidedAtEpochMs'],
	routingExhausted: ['kind', 'contractVersion', 'atEpochMs', 'attemptLedger'],
	matchingMatched: [
		'kind',
		'contractVersion',
		'request',
		'decidedAtEpochMs',
		'rows',
		'ranked',
		'selected',
		'substitution',
		'provenance',
		'routing',
	],
	matchingNoMatch: ['kind', 'contractVersion', 'request', 'decidedAtEpochMs', 'rows'],
	isolationDecided: [
		'kind',
		'contractVersion',
		'scopeId',
		'adapterId',
		'providerEntryId',
		'usageClass',
		'termsState',
		'verdict',
		'metadataVerification',
		'provenance',
		'decidedAtEpochMs',
	],
	isolationRefused: ['kind', 'contractVersion', 'decidedAtEpochMs', 'detail'],
} as const;

/** The canonical provenance view object: fixed key order (the cited idiom). */
function canonicalProvenanceViewObject(view: ProvenanceView): Record<string, unknown> {
	return {
		contractVersion: view.contractVersion,
		verification: view.verification,
		substitution: view.substitution,
		scopeLabel: view.scopeLabel,
		requestedProviderId: view.requestedProviderId,
		requestedModelId: view.requestedModelId,
		actualProviderId: view.actualProviderId,
		actualModelId: view.actualModelId,
		recordedAtEpochMs: view.recordedAtEpochMs,
	};
}

/** The canonical reset expectation object: fixed key order per kind (the cited idiom). */
function canonicalExpectationObject(expectation: ResetExpectation): Record<string, unknown> {
	if (expectation.kind === 'known') {
		return {
			kind: 'known',
			nextResetEpochMs: expectation.nextResetEpochMs,
			basis: expectation.basis,
		};
	}
	return { kind: 'unknown' };
}

/** The canonical decision view object: fixed key order (the cited idiom). */
function canonicalDecisionViewObject(view: DecisionView): Record<string, unknown> {
	return {
		contractVersion: view.contractVersion,
		family: view.family,
		side: view.side,
		decidedAtEpochMs: view.decidedAtEpochMs,
		adapterId: view.adapterId,
		reasons: [...view.reasons],
		provenance: view.provenance === 'none' ? 'none' : canonicalProvenanceViewObject(view.provenance),
	};
}

/**
 * The landed reset-expectation shape check, MIRRORED from the landed
 * capacityDisclosure module's own field checks (the cited idiom: the
 * key order and state semantics are the landed shape's own - kind
 * 'unknown', or kind 'known' with a basis drawn from the landed
 * known-producing classes and a finite next reset instant). The
 * landed module exports no standalone expectation guard, so this
 * mirror is the family's cited-idiom binding, never a re-derived
 * vocabulary.
 */
function isLandedResetExpectationShape(value: unknown): value is ResetExpectation {
	if (!isRecord(value)) {
		return false;
	}
	const expectation = value as Record<string, unknown>;
	if (expectation.kind === 'unknown') {
		return true;
	}
	if (expectation.kind !== 'known') {
		return false;
	}
	if (expectation.basis !== 'fixed-instant' && expectation.basis !== 'interval-aligned') {
		return false;
	}
	return isFiniteEpochMs(expectation.nextResetEpochMs);
}

/**
 * The no-extra-own-fields check (the isolation family's
 * no-extra-keys idiom): every own key of the record is one of the
 * allowed fields. A field beyond the shape is not the shape.
 */
function carriesOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
	for (const key of Object.keys(record)) {
		if (!(fields as readonly string[]).includes(key)) {
			return false;
		}
	}
	return true;
}

/**
 * The landed provider-metadata verification membership check, riding
 * the imported PROVIDER_METADATA_VERIFICATIONS list verbatim - never
 * a re-implementation.
 */
function isProviderMetadataVerification(value: unknown): value is ProviderMetadataVerification {
	return (PROVIDER_METADATA_VERIFICATIONS as readonly string[]).includes(value as string);
}

/** The landed substitution membership check, riding the imported list verbatim. */
function isSubstitutionState(value: unknown): value is SubstitutionState {
	return (SUBSTITUTION_STATES as readonly string[]).includes(value as string);
}

/** The landed health membership check, riding the imported list verbatim. */
function isProviderHealthState(value: unknown): value is ProviderHealthState {
	return (PROVIDER_HEALTH_STATES as readonly string[]).includes(value as string);
}

/** The landed disclosed-capacity-state membership check, riding the imported list verbatim. */
function isDisclosedCapacityState(value: unknown): value is DisclosedCapacityState {
	return (DISCLOSED_CAPACITY_STATES as readonly string[]).includes(value as string);
}

/** The landed reset-schedule-kind membership check, riding the imported list verbatim. */
function isResetScheduleKind(value: unknown): value is ResetScheduleKind {
	return (RESET_SCHEDULE_KINDS as readonly string[]).includes(value as string);
}

/** The presentation decision-family membership check over this family's own frozen list. */
function isDecisionFamily(value: unknown): value is PresentationDecisionFamily {
	return (PRESENTATION_DECISION_FAMILIES as readonly string[]).includes(value as string);
}

/** The unified-side membership check over this family's own frozen list. */
function isDecisionViewSide(value: unknown): value is DecisionViewSide {
	return (DECISION_VIEW_SIDES as readonly string[]).includes(value as string);
}

/** A non-negative integer count (the landed quota-remaining idiom). */
function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** A 1-based positive integer line index. */
function isPositiveLine(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 1;
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
