/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 Free Inference Fabric contracts: the typed LIVE-PROVIDER
 * ACCEPTANCE and FAILURE DRILLS family - the closed honest-evidence
 * vocabulary for acceptance drills over the landed inference fabric:
 * the frozen evidence labels, the frozen drill classes, the typed
 * adapter-contract wire seam (the injected network port), the
 * caller-injected handle-shaped credential port, the drill evidence
 * records whose every payload is a PROJECTION of the landed canonical
 * surfaces, and the canonical drill-evidence bytes (contract module,
 * the labContracts discipline; binds the landed INF-001..008 family
 * vocabularies verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..008 family laws are INHERITED and binding here):
 * - THE UPGRADE LAW (binding, this family's charter): the evidence
 *   labels are the frozen 'fixture' | 'local-real' | 'live-real'
 *   list, in the exact list order. 'fixture' proves vocabulary
 *   behavior only; 'local-real' proves real-filesystem execution at
 *   caller-injected roots; 'live-real' proves a real network
 *   exchange with a real provider endpoint - claimed ONLY when a
 *   live exchange actually happened, NEVER promoted. A drill that
 *   did not reach the wire is 'fixture' or a typed refusal, never
 *   'live-real'. Evidence labels are DERIVED from the exchange class
 *   (the injected fixture port, the live port's real exchange),
 *   never caller-supplied - a caller-supplied label is the typed
 *   'caller-supplied-label' rejection, and a live-real claim over a
 *   fixture-configured network port is the typed 'no-live-port'
 *   rejection. No drill record is ever 'local-real': the
 *   filesystem-execution class labels the caller-injected ledger
 *   roots (the delivery-evidence stream), never an exchange record.
 * - THE SAFETY LAW (binding, the workstream's charter, enforced here
 *   finally): no shared public Flauz gateway pooling third-party
 *   free-tier keys; NO credential material anywhere in the
 *   vocabulary (the landed no-secret shapes are the only
 *   representable ones); credentials reach the drill ONLY through a
 *   caller-INJECTED credential port ({ kind: 'handle', ... } -
 *   handle-shaped, the landed CredentialScopeDescriptor triple
 *   vocabulary); the shipped code never names a secret, never reads
 *   env, never opens a socket outside the injected network port.
 * - THE HONEST-FAILURE LAW (binding): a failed live probe is
 *   RECORDED as live-real failure evidence (the typed failure record
 *   with the honest reason verbatim - a rate limit, a refusal, an
 *   unknown) - never retried into success, never silently dropped,
 *   never converted to fixture.
 * - THE NEVER-RE-DERIVE LAW (binding): every drill record's
 *   evidence payload is a PROJECTION of the landed canonical
 *   surfaces - the presentation views, the eligibility verdicts, the
 *   serialized canonical bytes - cited through the landed
 *   serialize* / project* / admit* functions, never re-implemented. A
 *   caller-supplied evidence label or verdict is a typed rejection
 *   (derived, never caller-supplied).
 * - THE NO-DANGLING-REF LAW (binding, extended to acceptance): every
 *   drill record's source binding (the adapter id, the scope handle,
 *   the decision id) resolves against the BOUND record surface - or
 *   the drill is a typed rejection, never a dangling ref.
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. Every timestamp is a caller-injected epoch-ms number. No
 *   Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every drill / audit / ledger rejection is a typed
 *   member of the frozen ACCEPTANCE_REJECTION_REASONS list, in the
 *   exact check order; the first failing check is THE verdict, and
 *   every rejection names its reason.
 * - THE NEVER-SILENT-EMPTY LAW (binding): the refused sides are
 *   shown - a failure record's disclosure projection carries the
 *   refused side with its typed reasons verbatim; a drill ledger
 *   stream projects every line exactly once - a malformed line is
 *   the typed 'malformed-record' refusal outcome, never a silent
 *   drop.
 * - Canonical bytes: serializeAcceptanceRecord emits fixed-key-order
 *   deterministic bytes per record kind (double-run byte-equal; the
 *   nested landed views embed the landed serializers' own canonical
 *   bytes, re-parsed - never a re-implemented key order); every
 *   persisted/audited top-level shape carries contractVersion;
 *   transient rejection verdicts carry reason + detail (the landed
 *   families' rejection idiom).
 * - Zero external dependencies: node: builtins (none needed here)
 *   and the landed sibling families only.
 */
import { ADAPTER_TRANSPORT_KINDS } from '../../adapters/common/providerAdapter.js';
import type { AdapterObservation, AdapterTransportKind } from '../../adapters/common/providerAdapter.js';
import { CAPACITY_PROVENANCES } from '../../semantics/common/planSemantics.js';
import type { CapacityProvenance } from '../../semantics/common/planSemantics.js';
import { COOLDOWN_REASONS } from '../../semantics/common/capacityDisclosure.js';
import type { CooldownReason } from '../../semantics/common/capacityDisclosure.js';
import {
	TERM_ELIGIBILITY_VERDICTS,
	isCredentialScopeDescriptor,
	serializeCredentialScope,
	serializeEligibilityDecision,
} from '../../isolation/common/isolationContract.js';
import type { CredentialScopeDescriptor, HandleResolution, TermEligibilityVerdict } from '../../isolation/common/isolationContract.js';
import {
	isCapacityView,
	isDecisionView,
	isProvenanceView,
	isResetExpectationView,
	serializePresentationRecord,
} from '../../presentation/common/presentationContract.js';
import type { CapacityView, DecisionView, ProvenanceView, ResetExpectationView } from '../../presentation/common/presentationContract.js';

/**
 * Version of the inference-acceptance contract set (this family's
 * own constant, declared ONCE here - the single version declaration
 * law; every acceptance-family persisted record carries it). The
 * sibling acceptanceKit module re-carries this same declaration
 * (re-exported; the battery pins both module copies equal). The
 * vocabulary INSIDE the records is the landed families', bound
 * verbatim and never re-implemented: the wire seam rides the INF-003
 * adapter family's AdapterObservation shapes, the scope handle is
 * the INF-007 family's CredentialScopeDescriptor triple, the payload
 * projections are the INF-008 family's presentation views and the
 * INF-007 family's term-eligibility verdicts, and the byte citations
 * name the landed serializers. Those landed sub-records keep their
 * own family version stamps; the acceptance stamp and the landed
 * stamps are distinct roles pinned by the battery.
 */
export const INFERENCE_ACCEPTANCE_VERSION = '1.0.0';

/**
 * The closed frozen evidence-label vocabulary, in the exact list
 * order (THE UPGRADE LAW's own list):
 *   fixture    - proves vocabulary behavior only (the injected
 *               fixture responses; a drill that did not reach the
 *               wire);
 *   local-real - proves real-filesystem execution at caller-injected
 *               roots (the drill ledger / audit stream; never an
 *               exchange record);
 *   live-real  - proves a real network exchange with a real provider
 *               endpoint - claimed ONLY when a live exchange
 *               actually happened, never promoted.
 * Widening or reordering the list is a versioned contract decision.
 */
export const ACCEPTANCE_EVIDENCE_LABELS = ['fixture', 'local-real', 'live-real'] as const;
export type AcceptanceEvidenceLabel = (typeof ACCEPTANCE_EVIDENCE_LABELS)[number];

/** Pure predicate over the closed evidence-label list. */
export function isAcceptanceEvidenceLabel(value: unknown): value is AcceptanceEvidenceLabel {
	return (ACCEPTANCE_EVIDENCE_LABELS as readonly string[]).includes(value as string);
}

/**
 * Closed frozen list of acceptance rejection reasons, in the exact
 * list order (each walk applies its applicable subset in this order;
 * the first failure is THE verdict):
 *   not-an-object               - the candidate is not an object
 *                                 (every walk);
 *   caller-supplied-label       - THE UPGRADE LAW: the candidate
 *                                 carries a caller-supplied evidence
 *                                 label - labels are DERIVED from the
 *                                 exchange class, never supplied;
 *   caller-supplied-verdict     - THE NEVER-RE-DERIVE LAW: the
 *                                 candidate carries a caller-supplied
 *                                 eligibility verdict - verdicts are
 *                                 derived through the landed folds,
 *                                 never supplied;
 *   shape-law-violation         - the shape-law reason: the candidate
 *                                 fails the landed guards (the landed
 *                                 rejection cited verbatim in the
 *                                 detail) or the walk's own
 *                                 input-shape laws (the request /
 *                                 scenario / port / ledger-surface
 *                                 shapes);
 *   no-live-port                - THE UPGRADE LAW: a live-real
 *                                 evidence claim over a
 *                                 fixture-configured network port -
 *                                 live-real is claimed ONLY when a
 *                                 live exchange actually happened,
 *                                 never promoted;
 *   credential-shape            - THE SAFETY LAW: a non-handle-shaped
 *                                 credential reaching the port (a
 *                                 secret-shaped port, a resolution
 *                                 beyond the typed reference, or a
 *                                 handle reference that does not
 *                                 equal the bound adapter record's
 *                                 own credentialHandle) - the
 *                                 no-secret law enforced in both
 *                                 directions;
 *   unresolved-adapter-binding  - THE NO-DANGLING-REF LAW: the
 *                                 adapter id (or the record's adapter
 *                                 binding fields) resolve to no bound
 *                                 adapter, or diverge from the bound
 *                                 adapter record's own fields;
 *   unresolved-scope-binding    - THE NO-DANGLING-REF LAW: the scope
 *                                 id (or the record's scope handle)
 *                                 resolves to no bound credential
 *                                 scope, or cross-inconsistently with
 *                                 the drill's adapter binding;
 *   unresolved-decision-binding - THE NO-DANGLING-REF LAW: the
 *                                 record's eligibility verdict does
 *                                 not resolve against the bound
 *                                 provider's term state folded
 *                                 through the landed
 *                                 verdictForTermState - a verdict the
 *                                 bound records never produced;
 *   unresolved-ledger-line      - THE NO-DANGLING-REF LAW: the
 *                                 ledger surface does not resolve (a
 *                                 missing ledger file, a non-file
 *                                 path) or the line index resolves to
 *                                 no ledger line (out of range);
 *   malformed-record            - THE CANONICAL-BYTES LAW: a ledger
 *                                 line that is not this family's own
 *                                 canonical byte form (unparseable
 *                                 bytes, a record no acceptance guard
 *                                 admits, or a round-trip through
 *                                 serializeAcceptanceRecord that
 *                                 differs from the line's own bytes)
 *                                 - never a silent drop.
 */
export const ACCEPTANCE_REJECTION_REASONS = [
	'not-an-object',
	'caller-supplied-label',
	'caller-supplied-verdict',
	'shape-law-violation',
	'no-live-port',
	'credential-shape',
	'unresolved-adapter-binding',
	'unresolved-scope-binding',
	'unresolved-decision-binding',
	'unresolved-ledger-line',
	'malformed-record',
] as const;
export type AcceptanceRejectionReason = (typeof ACCEPTANCE_REJECTION_REASONS)[number];

/**
 * The closed frozen drill-class vocabulary: the acceptance drill
 * class first, then the failure drill classes in the landed failure
 * order (mirroring the landed vocabularies they ride):
 *   acceptance-exchange  - the acceptance drill class (a completed
 *                          exchange projected through the landed
 *                          folds);
 *   quota-failure        - mirrors the landed quota window /
 *                          exhaustion vocabulary (the disclosed
 *                          'exhausted' state, 'quota-exhausted');
 *   cooldown-failure     - mirrors the landed COOLDOWN_REASONS
 *                          vocabulary (the disclosed 'cooldown'
 *                          state plus the active cooldown's own
 *                          reason);
 *   reset-failure        - mirrors the landed reset-schedule
 *                          vocabulary (the stale fixed-instant reset
 *                          projecting the honest 'unknown'
 *                          expectation - never a fabricated future);
 *   eligibility-refusal  - mirrors the landed term-eligibility
 *                          refusal vocabulary (the landed verdict
 *                          fold of the bound provider's term state);
 *   provenance-unknown   - mirrors the landed honest-unknown
 *                          vocabulary (the disclosed 'unknown'
 *                          capacity state, 'unverified' metadata);
 *   network-refused      - the typed network refusal (the port's
 *                          honest failure reason verbatim).
 * Widening the set is a versioned contract decision.
 */
export const DRILL_CLASSES = [
	'acceptance-exchange',
	'quota-failure',
	'cooldown-failure',
	'reset-failure',
	'eligibility-refusal',
	'provenance-unknown',
	'network-refused',
] as const;
export type DrillClass = (typeof DRILL_CLASSES)[number];

/** Pure predicate over the closed drill-class list. */
export function isDrillClass(value: unknown): value is DrillClass {
	return (DRILL_CLASSES as readonly string[]).includes(value as string);
}

/** The failure drill classes only (the six; never the acceptance class). */
export const FAILURE_DRILL_CLASSES = [
	'quota-failure',
	'cooldown-failure',
	'reset-failure',
	'eligibility-refusal',
	'provenance-unknown',
	'network-refused',
] as const;
export type FailureDrillClass = (typeof FAILURE_DRILL_CLASSES)[number];

/** Pure predicate over the closed failure drill-class list. */
export function isFailureDrillClass(value: unknown): value is FailureDrillClass {
	return (FAILURE_DRILL_CLASSES as readonly string[]).includes(value as string);
}

/**
 * The closed frozen byte-citation serializer vocabulary: which LANDED
 * serializer produced each cited byte string (the never-re-derive
 * law's own citation names - the kit emits citations only through
 * these landed functions, and the guard admits no other name):
 *   serializeCredentialScope       - the INF-007 scope triple bytes;
 *   serializeAdapterReport         - the INF-003 report fold bytes;
 *   serializeCapacityDisclosure    - the INF-001 disclosure bytes;
 *   serializePresentationRecord    - the INF-008 view bytes (one
 *                                    citation per projected view);
 *   serializeEligibilityDecision   - the INF-007 eligibility
 *                                    decision bytes.
 */
export const ACCEPTANCE_BYTE_SERIALIZERS = [
	'serializeCredentialScope',
	'serializeAdapterReport',
	'serializeCapacityDisclosure',
	'serializePresentationRecord',
	'serializeEligibilityDecision',
] as const;
export type AcceptanceByteSerializer = (typeof ACCEPTANCE_BYTE_SERIALIZERS)[number];

/**
 * The typed wire request the acceptance drill sends through the
 * injected network port: the bound adapter's own id and provider
 * entry, the bound scope's own id and opaque handle reference (the
 * typed reference ONLY - the vocabulary cannot name a secret), and
 * the requested model id. The port (fixture respond or live
 * fetchLike) is the ONLY thing that performs the exchange.
 */
export interface DrillWireRequest {
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly scopeId: string;
	readonly handleRef: string;
	readonly requestedModelId: string;
}

/**
 * The completed side of the typed wire response: the observation the
 * adapter REPORTS from the exchange (the landed INF-003
 * AdapterObservation shape - health / quota / cooldown / reset as
 * landed typed states, all fields required, every timestamp
 * injected; the honest unknown states are first-class members).
 */
export interface DrillWireCompleted {
	readonly completed: true;
	readonly observation: AdapterObservation;
}

/**
 * The refused side of the typed wire response: the honest failure
 * reason VERBATIM (a rate limit, a refusal, an unknown) - never
 * re-worded, never retried, never converted (THE HONEST-FAILURE
 * LAW).
 */
export interface DrillWireRefused {
	readonly completed: false;
	readonly refusalReason: string;
}

export type DrillWireResponse = DrillWireCompleted | DrillWireRefused;

/**
 * The fixture network port: the typed injected seam whose respond
 * fold returns the injected fixture response (vocabulary behavior
 * only - the evidence label derives 'fixture'; a drill over this
 * port never claims the wire).
 */
export interface FixtureNetworkPort {
	readonly kind: 'fixture';
	readonly respond: (request: DrillWireRequest) => DrillWireResponse;
}

/**
 * The live network port: the typed injected seam whose caller-
 * supplied fetchLike performs the REAL exchange against the real
 * provider endpoint (the station / canary supplies the real one; the
 * shipped code never calls a global fetch, never opens a socket -
 * the port is the only seam). A completed exchange over this port
 * derives 'live-real'; a refused exchange records live-real failure
 * evidence (THE HONEST-FAILURE LAW).
 */
export interface LiveNetworkPort {
	readonly kind: 'live';
	readonly endpoint: string;
	readonly fetchLike: (endpoint: string, request: DrillWireRequest) => Promise<DrillWireResponse>;
}

export type AcceptanceNetworkPort = FixtureNetworkPort | LiveNetworkPort;

/**
 * The caller-injected credential port - handle-shaped ONLY (THE
 * SAFETY LAW): the landed CredentialScopeDescriptor triple plus the
 * typed resolution fold returning the landed HandleResolution (the
 * typed reference - scope id, adapter id, the bound adapter record's
 * own opaque credentialHandle - never secret material: the
 * vocabulary cannot name a secret and the port cannot return one).
 * Any field beyond { kind, scope, resolve } is the typed
 * credential-shape rejection (the no-secret law enforced in both
 * directions: a secret-shaped port is rejected at the boundary, and
 * a resolution beyond the typed reference is rejected at the fold).
 */
export interface AcceptanceCredentialPort {
	readonly kind: 'handle';
	readonly scope: CredentialScopeDescriptor;
	readonly resolve: () => Promise<HandleResolution>;
}

/**
 * The acceptance drill request: the caller-supplied drill id (the
 * 'fixture.' prefix convention for synthetic ids) and the requested
 * model id. NOTHING else is representable - a caller-supplied
 * evidence label is the typed 'caller-supplied-label' rejection, a
 * caller-supplied eligibility verdict is the typed
 * 'caller-supplied-verdict' rejection, and any other extra field is
 * the typed 'shape-law-violation' rejection (the payload projections
 * are DERIVED through the landed kit functions, never supplied).
 */
export interface AcceptanceDrillRequest {
	readonly drillId: string;
	readonly requestedModelId: string;
}

/**
 * The failure drill scenario: the injected failure response's class
 * plus its class-specific vocabulary members. The drill id follows
 * the 'fixture.' prefix convention for synthetic ids; cooldownReason
 * rides the landed COOLDOWN_REASONS vocabulary; the eligibility
 * refusal names the scope whose bound provider's term state folds
 * non-eligible; the network refusal carries the injected refusal
 * reason (verbatim in the recorded evidence).
 */
export type FailureDrillScenario =
	| { readonly drillId: string; readonly drillClass: 'quota-failure' }
	| { readonly drillId: string; readonly drillClass: 'cooldown-failure'; readonly cooldownReason: CooldownReason }
	| { readonly drillId: string; readonly drillClass: 'reset-failure' }
	| { readonly drillId: string; readonly drillClass: 'eligibility-refusal'; readonly scopeId: string }
	| { readonly drillId: string; readonly drillClass: 'provenance-unknown' }
	| { readonly drillId: string; readonly drillClass: 'network-refused'; readonly refusalReason: string };

/**
 * The drill payload projection: the landed presentation views and
 * the landed eligibility verdict, ALL carried VERBATIM (THE
 * NEVER-RE-DERIVE LAW - the kit projects every member through the
 * landed presentation kit functions and the landed isolation folds,
 * never re-implemented):
 *   provenanceView        - the landed ProvenanceView (the exchange
 *                           provenance's projection);
 *   capacityView          - the landed CapacityView (the disclosed
 *                           capacity projection);
 *   resetExpectationView  - the landed ResetExpectationView (the
 *                           honest reset fold);
 *   decisionView          - the landed DecisionView (the unified
 *                           projection of the drill's eligibility
 *                           decision - the isolation family's decided
 *                           side);
 *   eligibilityVerdict    - the landed TermEligibilityVerdict (the
 *                           landed verdictForTermState fold of the
 *                           bound provider's term state).
 */
export interface DrillPayloadProjection {
	readonly provenanceView: ProvenanceView;
	readonly capacityView: CapacityView;
	readonly resetExpectationView: ResetExpectationView;
	readonly decisionView: DecisionView;
	readonly eligibilityVerdict: TermEligibilityVerdict;
}

/**
 * One canonical-bytes citation: which LANDED serializer produced the
 * cited byte string (the never-re-derive law's citation shape - the
 * kit cites, never re-implements).
 */
export interface ByteCitation {
	readonly serializer: AcceptanceByteSerializer;
	readonly bytes: string;
}

/**
 * The typed acceptance drill record: the honest evidence of one
 * completed exchange. The evidence label is DERIVED (fixture for the
 * injected fixture port, live-real only for a real network exchange
 * - never caller-supplied, never 'local-real'); the adapter binding
 * carries the BOUND adapter record's own fields (never
 * caller-invented); the scope handle is the landed descriptor triple
 * ONLY; the payload is the landed projection set; the byte citations
 * name the landed serializers; the timestamps ride the injected
 * clock (the drill start and completion reads); the failure reason
 * is the literal 'none' (a drill record never failed - failures are
 * FailureEvidence). Carries the acceptance contract-set version
 * stamp.
 */
export interface DrillRecord {
	readonly kind: 'drill';
	readonly contractVersion: string;
	readonly drillId: string;
	readonly drillClass: DrillClass;
	readonly evidenceLabel: AcceptanceEvidenceLabel;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly transportKind: AdapterTransportKind;
	readonly capacityProvenance: CapacityProvenance;
	readonly credentialHandle: string;
	readonly scope: CredentialScopeDescriptor;
	readonly payload: DrillPayloadProjection;
	readonly byteCitations: readonly ByteCitation[];
	readonly startedAtEpochMs: number;
	readonly completedAtEpochMs: number;
	readonly failureReason: 'none';
}

/**
 * The failure disclosure projection: THE NEVER-SILENT-EMPTY LAW - the
 * refused side is SHOWN with its typed reasons verbatim (the landed
 * vocabulary members the failure class rides: the disclosed capacity
 * states, the cooldown reasons, the reset classes, the eligibility
 * verdicts, the honest-unknown states - or the port's verbatim
 * refusal reason for the network class). The reasons are never
 * empty: a failure without a typed reason is not honest evidence.
 */
export interface FailureDisclosureProjection {
	readonly side: 'refused';
	readonly reasons: readonly string[];
}

/**
 * The typed honest-failure record (THE HONEST-FAILURE LAW): the
 * failure drill class, the DERIVED evidence label ('fixture' for
 * injected responses; 'live-real' when a real network exchange was
 * attempted and the provider refused - a failed live probe is
 * RECORDED as live-real failure evidence, never retried into
 * success, never silently dropped, never converted to fixture), the
 * failure reason VERBATIM (never re-worded), and the disclosure
 * projection (the refused side's typed reasons). Carries the
 * acceptance contract-set version stamp.
 */
export interface FailureEvidence {
	readonly kind: 'failure';
	readonly contractVersion: string;
	readonly drillId: string;
	readonly drillClass: DrillClass;
	readonly evidenceLabel: AcceptanceEvidenceLabel;
	readonly adapterId: string;
	readonly failureReason: string;
	readonly disclosure: FailureDisclosureProjection;
	readonly failedAtEpochMs: number;
}

/** Either drill evidence side (the discriminated record union). */
export type DrillEvidence = DrillRecord | FailureEvidence;

/** The drilled side of a drill outcome: the evidence record itself. */
export interface AcceptanceDrillProjected {
	readonly drilled: true;
	readonly evidence: DrillEvidence;
}

/** Typed drill refusal: closed reason, detail names the violation. */
export interface AcceptanceDrillRefused {
	readonly drilled: false;
	readonly reason: AcceptanceRejectionReason;
	readonly detail: string;
}

export type AcceptanceDrillOutcome = AcceptanceDrillProjected | AcceptanceDrillRefused;

/** The recorded side of an audit outcome. */
export interface AcceptanceAuditRecorded {
	readonly audited: true;
}

/** Typed audit refusal: closed reason, detail names the violation. */
export interface AcceptanceAuditRefused {
	readonly audited: false;
	readonly reason: AcceptanceRejectionReason;
	readonly detail: string;
}

export type AcceptanceAuditOutcome = AcceptanceAuditRecorded | AcceptanceAuditRefused;

/** The projected side of any acceptance read fold. */
export interface AcceptanceProjected<TView> {
	readonly projected: true;
	readonly view: TView;
}

/** Typed read refusal: closed reason, detail names the violation. */
export interface AcceptanceRefused {
	readonly projected: false;
	readonly reason: AcceptanceRejectionReason;
	readonly detail: string;
}

export type AcceptanceOutcome<TView> = AcceptanceProjected<TView> | AcceptanceRefused;

/**
 * The drill ledger line view: the parsed projection of ONE drill
 * ledger line - the canonical bytes parsed through THIS family's own
 * canonical form (cited, never re-derived: the parsed record admits
 * under isDrillRecord / isFailureEvidence AND round-trips
 * byte-equal through serializeAcceptanceRecord - the byte comparison
 * IS the parse). line is the 1-based position in the ledger stream
 * (over the non-empty lines - the trailing-newline artifact is not a
 * line); recordKind names which record shape the line carries and
 * AGREES with the record's own kind (one line, one record kind);
 * canonicalBytes is the line's own bytes carried verbatim; record is
 * the parsed evidence record. Carries the acceptance contract-set
 * version stamp.
 */
export interface AcceptanceLedgerLine {
	readonly contractVersion: string;
	readonly line: number;
	readonly recordKind: 'drill' | 'failure';
	readonly canonicalBytes: string;
	readonly record: DrillEvidence;
}

/** One ledger stream entry: the projected side. */
export interface AcceptanceLedgerLineProjected {
	readonly projected: true;
	readonly line: number;
	readonly view: AcceptanceLedgerLine;
}

/** One ledger stream entry: the typed refusal side (never a silent drop). */
export interface AcceptanceLedgerLineRefused {
	readonly projected: false;
	readonly line: number;
	readonly reason: AcceptanceRejectionReason;
	readonly detail: string;
}

export type AcceptanceLedgerLineOutcome = AcceptanceLedgerLineProjected | AcceptanceLedgerLineRefused;

/**
 * Canonical serialization of an acceptance evidence record (either
 * side): fixed key order per record kind, deterministic bytes
 * regardless of the input record's key insertion order. The nested
 * landed shapes embed the LANDED serializers' own canonical bytes,
 * re-parsed to carry their fixed key order VERBATIM (the routing
 * family's cited idiom): the scope triple through
 * serializeCredentialScope, every payload view through
 * serializePresentationRecord. Refuses non-records fail-closed
 * (TypeError) - no dishonest drill evidence ever gets canonical
 * bytes. This canonical form is the persistence/audit shape the
 * kit's acceptance-drills.jsonl ledger appends and the post-INF
 * binders consume.
 */
export function serializeAcceptanceRecord(record: unknown): string {
	if (!isDrillEvidence(record)) {
		throw new TypeError(
			'serializeAcceptanceRecord: record must satisfy isDrillRecord / isFailureEvidence - no dishonest drill evidence ever gets canonical bytes',
		);
	}
	if (record.kind === 'failure') {
		return JSON.stringify({
			kind: record.kind,
			contractVersion: record.contractVersion,
			drillId: record.drillId,
			drillClass: record.drillClass,
			evidenceLabel: record.evidenceLabel,
			adapterId: record.adapterId,
			failureReason: record.failureReason,
			disclosure: {
				side: record.disclosure.side,
				reasons: [...record.disclosure.reasons],
			},
			failedAtEpochMs: record.failedAtEpochMs,
		});
	}
	return JSON.stringify({
		kind: record.kind,
		contractVersion: record.contractVersion,
		drillId: record.drillId,
		drillClass: record.drillClass,
		evidenceLabel: record.evidenceLabel,
		adapterId: record.adapterId,
		providerEntryId: record.providerEntryId,
		transportKind: record.transportKind,
		capacityProvenance: record.capacityProvenance,
		credentialHandle: record.credentialHandle,
		// THROUGH the landed serializer: the scope triple's canonical bytes
		// are produced by the landed serializeCredentialScope and re-parsed
		// to embed its fixed key order verbatim (the cited idiom).
		scope: JSON.parse(serializeCredentialScope(record.scope)) as Record<string, unknown>,
		payload: {
			provenanceView: JSON.parse(serializePresentationRecord(record.payload.provenanceView)) as Record<string, unknown>,
			capacityView: JSON.parse(serializePresentationRecord(record.payload.capacityView)) as Record<string, unknown>,
			resetExpectationView: JSON.parse(serializePresentationRecord(record.payload.resetExpectationView)) as Record<string, unknown>,
			decisionView: JSON.parse(serializePresentationRecord(record.payload.decisionView)) as Record<string, unknown>,
			eligibilityVerdict: record.payload.eligibilityVerdict,
		},
		byteCitations: record.byteCitations.map((citation) => ({
			serializer: citation.serializer,
			bytes: citation.bytes,
		})),
		startedAtEpochMs: record.startedAtEpochMs,
		completedAtEpochMs: record.completedAtEpochMs,
		failureReason: record.failureReason,
	});
}

/**
 * Pure shape guard: a well-formed, version-stamped acceptance drill
 * record. Pins the projection laws STRUCTURALLY: the exact
 * own-field set (no parallel vocabulary is representable); the drill
 * class is the acceptance-exchange class (failures ride
 * FailureEvidence); the evidence label is a member of the frozen
 * list AND never 'local-real' (THE UPGRADE LAW's honest record
 * classes - the filesystem-execution class labels the ledger
 * surface, never an exchange record); the adapter binding fields are
 * members of the landed transport-kind and capacity-provenance
 * vocabularies; the scope handle satisfies the LANDED
 * isCredentialScopeDescriptor and agrees with the adapter binding on
 * both the adapter id and the handle reference (THE HANDLE-EQUALITY
 * LAW made structural); every payload view satisfies its LANDED
 * presentation guard, the decision view is the isolation family's
 * decided-side projection whose reasons carry exactly the landed
 * eligibility verdict, and the payload's provider attributions name
 * the record's own provider entry (NO DANGLING ATTRIBUTION); the
 * byte citations name only the landed serializer vocabulary; the
 * timestamps are finite with completion at or after the start (the
 * injected clock's reads); and the failure reason is the literal
 * 'none' (a drill record never failed). Fails closed on every
 * malformed path; never reads a clock; never mutates its input.
 */
export function isDrillRecord(value: unknown): value is DrillRecord {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!carriesOnlyFields(record, DRILL_RECORD_FIELDS)) {
		return false;
	}
	if (record.contractVersion !== INFERENCE_ACCEPTANCE_VERSION) {
		return false;
	}
	if (record.kind !== 'drill') {
		return false;
	}
	if (!isNonEmptyString(record.drillId)) {
		return false;
	}
	if (record.drillClass !== 'acceptance-exchange') {
		// A drill record is the completed-exchange class; the failure
		// classes ride FailureEvidence, never here.
		return false;
	}
	if (!isRecordLabel(record.evidenceLabel)) {
		return false;
	}
	if (!isNonEmptyString(record.adapterId) || !isNonEmptyString(record.providerEntryId) || !isNonEmptyString(record.credentialHandle)) {
		return false;
	}
	if (!(ADAPTER_TRANSPORT_KINDS as readonly string[]).includes(record.transportKind as string)) {
		return false;
	}
	if (!(CAPACITY_PROVENANCES as readonly string[]).includes(record.capacityProvenance as string)) {
		return false;
	}
	if (!isCredentialScopeDescriptor(record.scope)) {
		return false;
	}
	const scope = record.scope;
	if (scope.adapterId !== record.adapterId || scope.handleRef !== record.credentialHandle) {
		// THE HANDLE-EQUALITY LAW, made structural: the scope handle is the
		// bound adapter record's own credentialHandle and the scope's
		// adapter binding is the record's own adapter binding.
		return false;
	}
	const payload = record.payload;
	if (!isRecord(payload)) {
		return false;
	}
	if (!carriesOnlyFields(payload, DRILL_PAYLOAD_FIELDS)) {
		return false;
	}
	if (!isProvenanceView(payload.provenanceView)) {
		return false;
	}
	if (!isCapacityView(payload.capacityView)) {
		return false;
	}
	if (!isResetExpectationView(payload.resetExpectationView)) {
		return false;
	}
	if (!isDecisionView(payload.decisionView)) {
		return false;
	}
	if (!(TERM_ELIGIBILITY_VERDICTS as readonly string[]).includes(payload.eligibilityVerdict as string)) {
		return false;
	}
	const decisionView = payload.decisionView;
	if (decisionView.family !== 'isolation' || decisionView.side !== 'selected') {
		// The drill's decision view is the landed isolation family's
		// decided-side projection (an 'ineligible' or 'term-unknown' verdict
		// is a DECIDED disclosure carried verbatim, never fabricated).
		return false;
	}
	if (decisionView.reasons.length !== 1 || decisionView.reasons[0] !== payload.eligibilityVerdict) {
		// The decision view's reasons carry exactly the landed verdict -
		// the landed projection's own shape, made structural.
		return false;
	}
	if (payload.provenanceView.actualProviderId !== record.providerEntryId) {
		// NO DANGLING ATTRIBUTION: the exchange provenance names the
		// record's own provider entry.
		return false;
	}
	if (payload.capacityView.providerId !== record.providerEntryId) {
		return false;
	}
	if (!Array.isArray(record.byteCitations) || record.byteCitations.length === 0) {
		return false;
	}
	for (const citation of record.byteCitations) {
		if (!isRecord(citation)) {
			return false;
		}
		const citationRecord = citation as Record<string, unknown>;
		if (!carriesOnlyFields(citationRecord, BYTE_CITATION_FIELDS)) {
			return false;
		}
		if (!(ACCEPTANCE_BYTE_SERIALIZERS as readonly string[]).includes(citationRecord.serializer as string)) {
			return false;
		}
		if (!isNonEmptyString(citationRecord.bytes)) {
			return false;
		}
	}
	if (!isFiniteEpochMs(record.startedAtEpochMs) || !isFiniteEpochMs(record.completedAtEpochMs)) {
		return false;
	}
	if ((record.completedAtEpochMs as number) < (record.startedAtEpochMs as number)) {
		// The completion read is at or after the start read (the injected
		// clock's own reads - never a negative latency).
		return false;
	}
	return record.failureReason === 'none';
}

/**
 * Pure shape guard: a well-formed, version-stamped failure evidence
 * record. Pins the honest-failure laws STRUCTURALLY: the exact
 * own-field set; the drill class is a FAILURE class (never the
 * acceptance-exchange class); the evidence label is a member of the
 * frozen list AND never 'local-real'; the failure reason is a
 * non-empty string (verbatim, never re-worded); the disclosure
 * projection carries the literal 'refused' side with AT LEAST ONE
 * non-empty typed reason (THE NEVER-SILENT-EMPTY LAW - a failure
 * without a typed reason is not honest evidence); the failure
 * instant is finite. Fails closed on every malformed path.
 */
export function isFailureEvidence(value: unknown): value is FailureEvidence {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!carriesOnlyFields(record, FAILURE_RECORD_FIELDS)) {
		return false;
	}
	if (record.contractVersion !== INFERENCE_ACCEPTANCE_VERSION) {
		return false;
	}
	if (record.kind !== 'failure') {
		return false;
	}
	if (!isNonEmptyString(record.drillId)) {
		return false;
	}
	if (!isFailureDrillClass(record.drillClass)) {
		// The failure classes only - never the acceptance-exchange class
		// (a completed exchange is a DrillRecord, never a failure).
		return false;
	}
	if (!isRecordLabel(record.evidenceLabel)) {
		return false;
	}
	if (!isNonEmptyString(record.adapterId)) {
		return false;
	}
	if (!isNonEmptyString(record.failureReason)) {
		return false;
	}
	const disclosure = record.disclosure;
	if (!isRecord(disclosure)) {
		return false;
	}
	const disclosureRecord = disclosure as Record<string, unknown>;
	if (!carriesOnlyFields(disclosureRecord, DISCLOSURE_FIELDS)) {
		return false;
	}
	if (disclosureRecord.side !== 'refused') {
		return false;
	}
	if (!Array.isArray(disclosureRecord.reasons) || disclosureRecord.reasons.length === 0) {
		// THE NEVER-SILENT-EMPTY LAW: the refused side is shown with its
		// typed reasons - never empty on a failure record.
		return false;
	}
	for (const reason of disclosureRecord.reasons) {
		if (!isNonEmptyString(reason)) {
			return false;
		}
	}
	return isFiniteEpochMs(record.failedAtEpochMs);
}

/** Pure shape predicate: either well-formed evidence record side. */
export function isDrillEvidence(value: unknown): value is DrillEvidence {
	return isDrillRecord(value) || isFailureEvidence(value);
}

/**
 * Pure shape guard: a well-formed drill ledger line view. Pins the
 * ledger laws STRUCTURALLY: the line is a 1-based positive integer;
 * the record kind is a member of the frozen two and AGREES with the
 * embedded record's own kind (one line, one record kind); the
 * canonical bytes are a non-empty string; the embedded record
 * satisfies its own guard. Fails closed on every malformed path.
 */
export function isAcceptanceLedgerLine(value: unknown): value is AcceptanceLedgerLine {
	if (!isRecord(value)) {
		return false;
	}
	const view = value as Record<string, unknown>;
	if (!carriesOnlyFields(view, LEDGER_LINE_FIELDS)) {
		return false;
	}
	if (view.contractVersion !== INFERENCE_ACCEPTANCE_VERSION) {
		return false;
	}
	if (!isPositiveLine(view.line)) {
		return false;
	}
	if (view.recordKind !== 'drill' && view.recordKind !== 'failure') {
		return false;
	}
	if (!isNonEmptyString(view.canonicalBytes)) {
		return false;
	}
	if (!isDrillEvidence(view.record)) {
		return false;
	}
	return (view.record as DrillEvidence).kind === view.recordKind;
}

/** The drill record's exact own-field set (no parallel vocabulary is representable). */
const DRILL_RECORD_FIELDS = [
	'kind',
	'contractVersion',
	'drillId',
	'drillClass',
	'evidenceLabel',
	'adapterId',
	'providerEntryId',
	'transportKind',
	'capacityProvenance',
	'credentialHandle',
	'scope',
	'payload',
	'byteCitations',
	'startedAtEpochMs',
	'completedAtEpochMs',
	'failureReason',
] as const;

/** The drill payload projection's exact own-field set. */
const DRILL_PAYLOAD_FIELDS = [
	'provenanceView',
	'capacityView',
	'resetExpectationView',
	'decisionView',
	'eligibilityVerdict',
] as const;

/** The failure evidence record's exact own-field set. */
const FAILURE_RECORD_FIELDS = [
	'kind',
	'contractVersion',
	'drillId',
	'drillClass',
	'evidenceLabel',
	'adapterId',
	'failureReason',
	'disclosure',
	'failedAtEpochMs',
] as const;

/** The failure disclosure projection's exact own-field set. */
const DISCLOSURE_FIELDS = ['side', 'reasons'] as const;

/** The byte citation's exact own-field set. */
const BYTE_CITATION_FIELDS = ['serializer', 'bytes'] as const;

/** The ledger line view's exact own-field set. */
const LEDGER_LINE_FIELDS = ['contractVersion', 'line', 'recordKind', 'canonicalBytes', 'record'] as const;

/**
 * THE UPGRADE LAW's own record-label check: a member of the frozen
 * evidence-label list that is NEVER 'local-real' (the
 * filesystem-execution class labels the caller-injected ledger
 * roots, never an exchange record - records are the honest exchange
 * classes 'fixture' / 'live-real' only).
 */
function isRecordLabel(value: unknown): value is AcceptanceEvidenceLabel {
	if (!isAcceptanceEvidenceLabel(value)) {
		return false;
	}
	return value !== 'local-real';
}

/** The no-extra-own-fields check (the landed families' no-extra-keys idiom). */
function carriesOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
	for (const key of Object.keys(record)) {
		if (!(fields as readonly string[]).includes(key)) {
			return false;
		}
	}
	return true;
}

/** A 1-based positive integer line index (the landed ledger-line idiom). */
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
