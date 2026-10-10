/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-003 Free Inference Fabric contracts: the typed per-user/direct
 * provider adapter family - the vocabulary a per-user adapter uses to
 * REPORT what it observes about a provider (quota, cooldown, reset,
 * provenance) through the capacity-disclosure vocabulary, with every
 * timestamp INJECTED by the adapter runtime (contract module, the
 * labContracts discipline; binds the landed INF-001 semantics family
 * and INF-002 catalog family verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the INF-001
 * semantics family and INF-002 catalog family laws are INHERITED and
 * binding here):
 * - THE DIRECT-ADAPTER LAW (binding): a per-user/direct adapter never
 *   carries the 'flauz-provisioned' capacity provenance - Flauz does
 *   not provision what it does not own. A descriptor carrying it is a
 *   TYPED rejection with a dedicated reason, never a silent
 *   admission.
 * - CREDENTIAL REFERENCES ONLY (binding): credentialHandle names
 *   WHERE an isolated runtime would look a credential up - an opaque
 *   typed reference, NEVER a secret value, NEVER embedded material.
 *   The admission guard applies a conservative vocabulary-level
 *   honesty shape check (see the rule below); it is NOT a security
 *   boundary - INF-007 owns the real credential isolation.
 * - THE ADAPTER-RUNTIME INJECTION LAW (binding): this contract never
 *   reads a clock. Every timestamp is a caller-injected epoch-ms
 *   number. No Date.now, no Math.random, no new Date(, no
 *   process.env in this module (law comments excepted).
 * - NEVER FABRICATE VERIFICATION: an unverified adapter reports
 *   unverified. The report fold derives its provenance through the
 *   landed unverifiedProvenance constructor ('unverified' by
 *   construction) unless the caller supplies a verified provenance
 *   record - which is carried verbatim, never re-stamped, never
 *   demoted. Only the ONE-WAY markReportVerified promotion (riding
 *   the landed markProvenanceVerified) flips a report to verified;
 *   there is deliberately NO demotion transition.
 * - THE NO-DANGLING-REF LAW (extended from the catalog family):
 *   every adapter's providerEntryId RESOLVES in the bound catalog
 *   record. An adapter set referencing a provider the catalog does
 *   not carry is a typed rejection - never a silent dangling ref.
 * - ADAPTER-ID UNIQUENESS: an adapter id is unique inside an adapter
 *   set record; a duplicate adapterId is a typed rejection, never a
 *   silent overwrite.
 * - HONEST STATES ARE DEFAULTS (inherited): unknown
 *   health/quota/cooldown/reset ride the disclosure vocabulary's own
 *   honest states through unknownSnapshot - never silent nulls,
 *   never guessed states. A missing or malformed observation field
 *   is a fail-closed TypeError, never a silent default.
 * - NO DANGLING ATTRIBUTION: a report's provenance actual provider
 *   must name the adapter's provider entry; a misattributed capacity
 *   report is rejected fail-closed, mirroring the semantics family's
 *   provider-mismatch law.
 * - VOCABULARY ONLY: no network, no fetch, no real credentials, no
 *   credential storage, no runtime loop, no router, no retry
 *   engine, no failover engine (INF-005's items), no sidecar
 *   (INF-004's item - this family delivers the transport-SHAPE
 *   vocabulary only), no second authority. Transport kinds are
 *   transport SHAPES, never endpoints, never URLs, never
 *   credentials.
 * - NO SHARED PUBLIC GATEWAY: nothing in this family models or
 *   permits a public Flauz gateway pooling third-party free-tier
 *   keys; third-party-free-tier adapter capacity is disclosed
 *   capacity, never a Flauz guarantee.
 * - Determinism: canonical serialization is fixed-key-order
 *   deterministic. Same inputs, same bytes, same verdicts.
 * - Every persisted record carries contractVersion.
 *
 * THE CREDENTIAL-HANDLE SHAPE RULE (the exact conservative check the
 * admission guard applies; documented here because the guard is
 * vocabulary-level honesty, not a security boundary):
 *   1. credentialHandle must be a string containing at least one
 *      non-whitespace character (a whitespace-only handle is not a
 *      reference);
 *   2. every whitespace-separated run must be at most 40 characters
 *      long (long high-entropy runs look like key material);
 *   3. the handle must contain none of the characters '=', ':' or
 *      '/' (the characteristic shapes of base64 payloads, key:value
 *      secret pairs and URLs/paths - a plain identifier carries
 *      none of them).
 * The rule is deliberately conservative: it catches the obvious
 * secret-looking shapes only. The real credential isolation guards
 * are INF-007's item and are binding scope boundaries here.
 */
import { CAPACITY_PROVENANCES } from '../../semantics/common/planSemantics.js';
import type { CapacityProvenance } from '../../semantics/common/planSemantics.js';
import {
	admitProvenance,
	isProviderCapacitySnapshot,
	markProvenanceVerified,
	unknownSnapshot,
	unverifiedProvenance,
} from '../../semantics/common/capacityDisclosure.js';
import type {
	CooldownState,
	InferenceProvenance,
	ProviderCapacitySnapshot,
	ProviderHealthState,
	QuotaState,
	ResetSchedule,
	UnverifiedProvenanceInput,
} from '../../semantics/common/capacityDisclosure.js';
import { admitCatalogRecord, catalogIndexById } from '../../catalog/common/providerCatalog.js';

/**
 * Version of the inference-adapter contract set (this family's own
 * constant, declared ONCE here; every adapter-family persisted record
 * carries it and the test suite pins it). The vocabulary INSIDE the
 * records is the landed INF-001 semantics family's and INF-002
 * catalog family's, bound verbatim and never re-implemented: capacity
 * states are ProviderCapacitySnapshot fields, provenance is an
 * InferenceProvenance, and the bound catalog is a
 * ProviderCatalogRecord. Those sub-records keep their own family
 * version stamps; the adapter stamp and the semantics/catalog stamps
 * are distinct roles pinned by the test suite.
 */
export const INFERENCE_ADAPTER_VERSION = '1.0.0';

/**
 * The closed frozen transport-kind vocabulary. These are transport
 * SHAPES - the request/response dialect an adapter speaks - never
 * endpoints, never URLs, never credentials:
 * - http-openai-compatible:    speaks an OpenAI-compatible
 *                              JSON-over-HTTP dialect shape;
 * - http-anthropic-compatible: speaks an Anthropic-compatible
 *                              JSON-over-HTTP dialect shape;
 * - http-generic-json:         speaks a generic JSON-over-HTTP shape
 *                              (no named dialect);
 * - local-sidecar:             speaks to a local sidecar process
 *                              shape (INF-004's optional
 *                              FreeLLMAPI-compatible sidecar rides
 *                              this kind; this family delivers the
 *                              shape vocabulary only, no sidecar).
 * Widening the set is a contract change requiring a version bump.
 */
export const ADAPTER_TRANSPORT_KINDS = Object.freeze([
	'http-openai-compatible',
	'http-anthropic-compatible',
	'http-generic-json',
	'local-sidecar',
] as const);
export type AdapterTransportKind = (typeof ADAPTER_TRANSPORT_KINDS)[number];

/**
 * The typed per-user/direct provider adapter descriptor: one adapter
 * as the persistence/audit shape. The providerEntryId binds into the
 * INF-002 catalog (the no-dangling-ref law: it must resolve in the
 * bound catalog record at set admission), transportKind is drawn from
 * the closed ADAPTER_TRANSPORT_KINDS vocabulary, capacityProvenance
 * rides the semantics family's CAPACITY_PROVENANCES vocabulary - and
 * a per-user/direct adapter is 'user-owned-endpoint' or
 * 'third-party-free-tier' class, NEVER 'flauz-provisioned' (THE
 * DIRECT-ADAPTER LAW). credentialHandle is an opaque typed REFERENCE
 * naming where an isolated runtime would look the credential up -
 * never a secret value, never embedded material (INF-007 owns the
 * real isolation). Carries the adapter contract-set version stamp.
 */
export interface ProviderAdapterDescriptor {
	readonly adapterId: string;
	readonly displayName: string;
	readonly providerEntryId: string;
	readonly transportKind: AdapterTransportKind;
	readonly capacityProvenance: CapacityProvenance;
	readonly credentialHandle: string;
	readonly contractVersion: string;
}

/**
 * The typed adapter set record: the named collection of per-user/
 * direct adapter descriptors. Adapter ids are unique inside a record
 * (admission-enforced) and every adapter's providerEntryId resolves
 * in the bound catalog record (the no-dangling-ref law extended).
 * Carries the adapter contract-set version stamp.
 */
export interface ProviderAdapterRecord {
	readonly adapterSetId: string;
	readonly adapters: readonly ProviderAdapterDescriptor[];
	readonly contractVersion: string;
}

/**
 * The injected observation input: what a per-user adapter observed
 * about its provider. ALL fields are required - the caller injects
 * everything (THE ADAPTER-RUNTIME INJECTION LAW: this contract never
 * reads a clock, so observedAtEpochMs is a caller-injected epoch-ms
 * number). health/quota/cooldown/reset ride the landed
 * capacity-disclosure states verbatim; the honest unknown states
 * ('unknown' health, {state:'unknown'} quota, {state:'none'}
 * cooldown, {kind:'unknown'} reset) are first-class members, never
 * silent nulls.
 */
export interface AdapterObservation {
	readonly observedAtEpochMs: number;
	readonly health: ProviderHealthState;
	readonly quota: QuotaState;
	readonly cooldown: CooldownState;
	readonly reset: ResetSchedule;
}

/**
 * The provenance input the report fold carries: either an
 * unverifiedProvenance-shaped input (the honest default - the raw
 * requested/actual selection, folded through the landed
 * unverifiedProvenance constructor, 'unverified' by construction) or
 * a full InferenceProvenance record the caller supplies (a verified
 * one is carried verbatim, never re-stamped, never demoted). The
 * fold itself NEVER fabricates verification.
 */
export type AdapterProvenanceInput = UnverifiedProvenanceInput | InferenceProvenance;

/**
 * The typed adapter health report: the pure report fold's output -
 * what one adapter observed about its provider, as the
 * persistence/audit shape. The snapshot is a ProviderCapacitySnapshot
 * for the adapter's provider entry built from the injected
 * observation; the provenance is the InferenceProvenance the report
 * carries (unverified unless the caller supplied a verified one or
 * the one-way markReportVerified promotion flipped it).
 * observedAtEpochMs is the injected observation time (identical to
 * snapshot.observedAtEpochMs - one observation, one time). Carries
 * the adapter contract-set version stamp.
 */
export interface ProviderAdapterHealthReport {
	readonly adapterId: string;
	readonly snapshot: ProviderCapacitySnapshot;
	readonly provenance: InferenceProvenance;
	readonly observedAtEpochMs: number;
	readonly contractVersion: string;
}

/** Closed list of adapter-descriptor admission rejection reasons. */
export const ADAPTER_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-adapter-id',
	'invalid-display-name',
	'invalid-provider-entry-id',
	'unknown-transport-kind',
	'invalid-capacity-provenance',
	'flauz-provisioned-adapter',
	'invalid-credential-handle',
	'secret-bearing-credential-handle',
] as const;
export type AdapterRejectionReason = (typeof ADAPTER_REJECTION_REASONS)[number];

export interface ProviderAdapterAdmitted {
	readonly admitted: true;
	readonly adapter: ProviderAdapterDescriptor;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface ProviderAdapterRejected {
	readonly admitted: false;
	readonly reason: AdapterRejectionReason;
	readonly detail: string;
}

export type ProviderAdapterAdmission = ProviderAdapterAdmitted | ProviderAdapterRejected;

/** Closed list of adapter-set-record admission rejection reasons. */
export const ADAPTER_RECORD_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-adapter-set-id',
	'invalid-adapters',
	'invalid-adapter',
	'duplicate-adapter-id',
	'invalid-catalog',
	'unknown-provider-entry',
] as const;
export type AdapterRecordRejectionReason = (typeof ADAPTER_RECORD_REJECTION_REASONS)[number];

export interface ProviderAdapterRecordAdmitted {
	readonly admitted: true;
	readonly record: ProviderAdapterRecord;
}

export interface ProviderAdapterRecordRejected {
	readonly admitted: false;
	readonly reason: AdapterRecordRejectionReason;
	readonly detail: string;
}

export type ProviderAdapterRecordAdmission =
	| ProviderAdapterRecordAdmitted
	| ProviderAdapterRecordRejected;

/**
 * The maximum length of one whitespace-separated run inside a
 * credential handle before the run looks like key material (the
 * conservative vocabulary-level honesty rule; see the module header
 * for the full documented rule).
 */
const CREDENTIAL_HANDLE_MAX_RUN_LENGTH = 40;

/**
 * Pure fail-closed guard: admits only descriptors with non-empty
 * string ids and display names, a transportKind drawn from the closed
 * ADAPTER_TRANSPORT_KINDS vocabulary, a capacityProvenance drawn from
 * the landed CAPACITY_PROVENANCES vocabulary that is NOT
 * 'flauz-provisioned' (THE DIRECT-ADAPTER LAW - Flauz does not
 * provision what it does not own; the violation is a TYPED rejection
 * with the dedicated 'flauz-provisioned-adapter' reason), and a
 * credentialHandle that is a plain opaque reference (non-string,
 * empty/whitespace-only and secret-looking handles are typed
 * rejections - the exact conservative shape rule is documented in the
 * module header; it is vocabulary-level honesty, not a security
 * boundary - INF-007 owns the real credential isolation).
 * Deterministic: same candidate, same verdict, same reason and
 * detail. Never mutates its input; never reads a clock.
 */
export function admitProviderAdapter(candidate: unknown): ProviderAdapterAdmission {
	if (!isRecord(candidate)) {
		return rejectAdapter('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_ADAPTER_VERSION) {
		return rejectAdapter(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_ADAPTER_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const adapterId = record.adapterId;
	if (!isNonEmptyString(adapterId)) {
		return rejectAdapter('invalid-adapter-id', 'adapterId must be a non-empty string');
	}
	const displayName = record.displayName;
	if (!isNonEmptyString(displayName)) {
		return rejectAdapter('invalid-display-name', 'displayName must be a non-empty string');
	}
	const providerEntryId = record.providerEntryId;
	if (!isNonEmptyString(providerEntryId)) {
		return rejectAdapter('invalid-provider-entry-id', 'providerEntryId must be a non-empty string');
	}
	const transportKind = record.transportKind;
	if (!isAdapterTransportKind(transportKind)) {
		return rejectAdapter(
			'unknown-transport-kind',
			`transportKind must be one of ${ADAPTER_TRANSPORT_KINDS.join('/')}, got '${String(transportKind)}'`,
		);
	}
	const capacityProvenance = record.capacityProvenance;
	if (!isCapacityProvenance(capacityProvenance)) {
		return rejectAdapter(
			'invalid-capacity-provenance',
			`capacityProvenance must be one of ${CAPACITY_PROVENANCES.join('/')} (the landed semantics vocabulary), got '${String(capacityProvenance)}'`,
		);
	}
	if (capacityProvenance === 'flauz-provisioned') {
		// THE DIRECT-ADAPTER LAW: a per-user/direct adapter never
		// carries the flauz-provisioned provenance - Flauz does not
		// provision what it does not own.
		return rejectAdapter(
			'flauz-provisioned-adapter',
			"capacityProvenance must be 'user-owned-endpoint' or 'third-party-free-tier' for a per-user/direct adapter - Flauz does not provision what it does not own (the direct-adapter law)",
		);
	}
	const credentialHandle = record.credentialHandle;
	if (!isCredentialHandleReference(credentialHandle)) {
		return rejectAdapter(
			'invalid-credential-handle',
			'credentialHandle must be a non-empty string reference naming where an isolated runtime would look the credential up - never a secret value',
		);
	}
	if (isSecretLookingCredentialHandle(credentialHandle)) {
		return rejectAdapter(
			'secret-bearing-credential-handle',
			`credentialHandle must be a plain reference identifier (whitespace-separated runs of at most ${CREDENTIAL_HANDLE_MAX_RUN_LENGTH} characters, none of the characters '=', ':' or '/') - secret-looking material in a handle is a vocabulary-level honesty violation; the real credential isolation guards are INF-007's`,
		);
	}
	return {
		admitted: true,
		adapter: {
			adapterId,
			displayName,
			providerEntryId,
			transportKind,
			capacityProvenance,
			credentialHandle,
			contractVersion,
		},
	};
}

/**
 * Pure fail-closed guard over the adapter set record bound to a
 * catalog record: every adapter must pass admitProviderAdapter (its
 * own rejection surfaces verbatim in the detail), ADAPTER IDS ARE
 * UNIQUE (a duplicate is a typed rejection, never a silent
 * overwrite), the bound catalog must itself satisfy the landed
 * admitCatalogRecord (the catalog family's own rejection surfaces
 * verbatim - cited, never re-worded), and every adapter's
 * providerEntryId must RESOLVE in that catalog (THE NO-DANGLING-REF
 * LAW extended to adapters - a set referencing a provider the
 * catalog does not carry is a typed rejection, never a silent
 * dangling ref). Deterministic; never mutates its inputs.
 */
export function admitProviderAdapterRecord(
	candidate: unknown,
	catalog: unknown,
): ProviderAdapterRecordAdmission {
	const shapeAdmission = admitAdapterSetShape(candidate);
	if (!shapeAdmission.admitted) {
		return shapeAdmission;
	}
	const catalogAdmission = admitCatalogRecord(catalog);
	if (!catalogAdmission.admitted) {
		return rejectAdapterRecord(
			'invalid-catalog',
			`the bound catalog record must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const index = catalogIndexById(catalogAdmission.record);
	const adapters = shapeAdmission.record.adapters;
	for (let indexPosition = 0; indexPosition < adapters.length; indexPosition++) {
		const providerEntryId = adapters[indexPosition].providerEntryId;
		if (!Object.prototype.hasOwnProperty.call(index, providerEntryId)) {
			// THE NO-DANGLING-REF LAW, extended: the adapter set never
			// carries a provider the bound catalog does not.
			return rejectAdapterRecord(
				'unknown-provider-entry',
				`adapters[${indexPosition}] references providerEntryId '${providerEntryId}' which the bound catalog does not carry - a dangling provider reference is a typed rejection, never a silent dangling ref`,
			);
		}
	}
	return shapeAdmission;
}

/**
 * THE PURE REPORT FOLD: builds a ProviderCapacitySnapshot for the
 * adapter's provider entry FROM the injected observation (riding the
 * landed unknownSnapshot defaults where the observation is honestly
 * unknown - the unknown health/quota/no-cooldown/unknown-reset
 * states are the snapshot's own honest states) and carries the
 * adapter's provenance:
 *   - an unverifiedProvenance-shaped input is folded through the
 *     landed unverifiedProvenance constructor - 'unverified' by
 *     construction, NEVER fabricated upward;
 *   - a caller-supplied InferenceProvenance record that satisfies
 *     the landed admitProvenance is carried VERBATIM (a verified one
 *     is never demoted, an unverified one is never stamped up);
 *   - a provenance-record-shaped input that FAILS admitProvenance is
 *     a fail-closed TypeError - a hidden substitution is never
 *     silently repaired by re-derivation.
 * The snapshot's verification state rides the injected provenance's
 * verification (the caller's receipt is the only source of
 * 'verified'; the fold itself never fabricates it). The provenance's
 * actual provider must name the adapter's provider entry - a
 * misattributed capacity report is rejected fail-closed. Throws
 * TypeError on a non-admitted adapter, a malformed observation
 * (every field is required and must satisfy the landed snapshot
 * vocabulary, checked through isProviderCapacitySnapshot), or a
 * malformed provenance input. Never reads a clock; never mutates its
 * inputs; never does I/O.
 */
export function reportAdapterSnapshot(
	adapter: ProviderAdapterDescriptor,
	observation: AdapterObservation,
	provenance: AdapterProvenanceInput,
): ProviderAdapterHealthReport {
	if (!isProviderAdapterDescriptor(adapter)) {
		throw new TypeError(
			'reportAdapterSnapshot: adapter must satisfy isProviderAdapterDescriptor before it can report - a rejected adapter never gets a report',
		);
	}
	if (!isRecord(observation)) {
		throw new TypeError(
			'reportAdapterSnapshot: observation must be a non-null object (all fields required, the caller injects everything)',
		);
	}
	const observationRecord = observation as Record<string, unknown>;
	const observedAtEpochMs = observationRecord.observedAtEpochMs;
	if (!isFiniteEpochMs(observedAtEpochMs)) {
		throw new TypeError(
			'reportAdapterSnapshot: observation.observedAtEpochMs must be a finite number (the adapter runtime injects every timestamp - the contract never reads a clock)',
		);
	}
	// The snapshot: the landed unknownSnapshot base carries the
	// provider id, the semantics version stamp, the honest 'unverified'
	// default and the injected observation time; the observation's own
	// states override. A missing or malformed field fails the landed
	// snapshot shape guard below - never a silent default.
	const snapshot = {
		...unknownSnapshot(adapter.providerEntryId, observedAtEpochMs),
		health: observationRecord.health,
		quota: observationRecord.quota,
		cooldown: observationRecord.cooldown,
		resetSchedule: observationRecord.reset,
	} as unknown as ProviderCapacitySnapshot;
	if (!isProviderCapacitySnapshot(snapshot)) {
		throw new TypeError(
			'reportAdapterSnapshot: the observation states must satisfy the capacity-disclosure snapshot vocabulary (health/quota/cooldown/reset as landed typed states - all fields required, never silent defaults)',
		);
	}
	const reportProvenance = foldReportProvenance(provenance);
	if (reportProvenance.actualProviderId !== adapter.providerEntryId) {
		// NO DANGLING ATTRIBUTION: a capacity report may never be
		// misattributed - the provenance's actual provider must name
		// the adapter's provider entry.
		throw new TypeError(
			`reportAdapterSnapshot: the provenance actual provider '${reportProvenance.actualProviderId}' must name the adapter's provider entry '${adapter.providerEntryId}' - a capacity report may never be misattributed`,
		);
	}
	// The caller's verification receipt is the only source of a
	// 'verified' snapshot: the state rides the injected provenance
	// verbatim, never fabricated here.
	const verification = reportProvenance.modelVerification;
	return {
		adapterId: adapter.adapterId,
		snapshot: verification === 'verified' ? { ...snapshot, verification: 'verified' } : snapshot,
		provenance: reportProvenance,
		observedAtEpochMs,
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

/**
 * The ONE-WAY report-verification promotion: unverified -> verified,
 * riding the semantics family's markProvenanceVerified on the
 * report's provenance (the literal promotion) and promoting the
 * snapshot's provider-metadata verification alongside so the report
 * stays internally consistent. Pure copy transition - every other
 * field is preserved verbatim. Idempotent: a verified report stays
 * verified. There is deliberately NO demotion transition: a stale
 * verification must be re-derived from a fresh report, never
 * silently downgraded.
 */
export function markReportVerified(report: ProviderAdapterHealthReport): ProviderAdapterHealthReport {
	return {
		...report,
		snapshot: { ...report.snapshot, verification: 'verified' },
		provenance: markProvenanceVerified(report.provenance),
	};
}

/**
 * Canonical serialization of an adapter health report: fixed key
 * order, deterministic bytes regardless of the input record's key
 * insertion order (the snapshot and provenance sub-records are
 * canonicalized with their own fixed key orders, mirroring the
 * landed families' serializer idiom). Refuses non-admitted reports
 * (fail closed: no dishonest report ever gets canonical bytes). This
 * canonical form is the persistence/audit shape for the
 * INF-004..009 binders.
 */
export function serializeAdapterReport(report: unknown): string {
	if (!isAdapterHealthReport(report)) {
		throw new TypeError(
			'serializeAdapterReport: report must satisfy isAdapterHealthReport - no dishonest report ever gets canonical bytes',
		);
	}
	return JSON.stringify(canonicalReportObject(report));
}

/** Pure shape predicate: an admitted, well-formed adapter descriptor. */
export function isProviderAdapterDescriptor(value: unknown): value is ProviderAdapterDescriptor {
	return admitProviderAdapter(value).admitted;
}

/**
 * Pure shape predicate: an adapter set record whose every adapter is
 * admitted and whose adapter ids are unique (the SHAPE level - the
 * catalog binding is an admission-time law carried by
 * admitProviderAdapterRecord, which this predicate does not repeat
 * because it takes no catalog, mirroring the landed
 * serializeCapabilityMatrixRecord scope note).
 */
export function isProviderAdapterRecord(value: unknown): value is ProviderAdapterRecord {
	return admitAdapterSetShape(value).admitted;
}

/**
 * Pure shape guard: a well-formed, version-stamped adapter health
 * report with an admitted snapshot, an admitted provenance, a finite
 * injected observation time that agrees with the snapshot's own
 * observation time (one observation, one time), and internal
 * attribution consistency - the provenance's actual provider names
 * the snapshot's provider (a misattributed report is never
 * well-formed). Fails closed on every malformed path.
 */
export function isAdapterHealthReport(value: unknown): value is ProviderAdapterHealthReport {
	if (!isRecord(value)) {
		return false;
	}
	const report = value as Record<string, unknown>;
	if (report.contractVersion !== INFERENCE_ADAPTER_VERSION) {
		return false;
	}
	if (!isNonEmptyString(report.adapterId)) {
		return false;
	}
	if (!isFiniteEpochMs(report.observedAtEpochMs)) {
		return false;
	}
	if (!isProviderCapacitySnapshot(report.snapshot)) {
		return false;
	}
	const provenanceAdmission = admitProvenance(report.provenance);
	if (!provenanceAdmission.admitted) {
		return false;
	}
	const snapshot = report.snapshot;
	if (report.observedAtEpochMs !== snapshot.observedAtEpochMs) {
		return false;
	}
	return provenanceAdmission.provenance.actualProviderId === snapshot.providerId;
}

/**
 * The shape-level admission shared by admitProviderAdapterRecord and
 * isProviderAdapterRecord: record shape, per-adapter admission
 * (rejections surface verbatim) and adapter-id uniqueness. The
 * catalog binding is deliberately NOT repeated here.
 */
function admitAdapterSetShape(candidate: unknown): ProviderAdapterRecordAdmission {
	if (!isRecord(candidate)) {
		return rejectAdapterRecord('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_ADAPTER_VERSION) {
		return rejectAdapterRecord(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_ADAPTER_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const adapterSetId = record.adapterSetId;
	if (!isNonEmptyString(adapterSetId)) {
		return rejectAdapterRecord('invalid-adapter-set-id', 'adapterSetId must be a non-empty string');
	}
	const adapters = record.adapters;
	if (!Array.isArray(adapters)) {
		return rejectAdapterRecord('invalid-adapters', 'adapters must be an array of provider adapter descriptors');
	}
	const admittedAdapters: ProviderAdapterDescriptor[] = [];
	const seenAdapterIds = new Set<string>();
	for (let index = 0; index < adapters.length; index++) {
		const adapterAdmission = admitProviderAdapter(adapters[index]);
		if (!adapterAdmission.admitted) {
			return rejectAdapterRecord(
				'invalid-adapter',
				`adapters[${index}] must satisfy admitProviderAdapter: '${adapterAdmission.reason}': ${adapterAdmission.detail}`,
			);
		}
		const adapter = adapterAdmission.adapter;
		if (seenAdapterIds.has(adapter.adapterId)) {
			// THE ADAPTER-ID UNIQUENESS LAW: a repeat is a typed
			// rejection - the adapter set never silently overwrites.
			return rejectAdapterRecord(
				'duplicate-adapter-id',
				`adapters[${index}] repeats adapterId '${adapter.adapterId}' - an adapter id is unique, never a silent overwrite`,
			);
		}
		seenAdapterIds.add(adapter.adapterId);
		admittedAdapters.push(adapter);
	}
	return {
		admitted: true,
		record: {
			adapterSetId,
			adapters: admittedAdapters,
			contractVersion,
		},
	};
}

/**
 * The provenance fold: an admitted InferenceProvenance record is
 * carried verbatim; a provenance-record-shaped input that fails the
 * landed admitProvenance is a fail-closed TypeError (a hidden
 * substitution is never silently repaired by re-derivation); any
 * other object is folded through the landed unverifiedProvenance
 * constructor (its own fail-closed TypeError guards apply - 'never
 * fabricates verification' is the law).
 */
function foldReportProvenance(provenance: AdapterProvenanceInput): InferenceProvenance {
	if (!isRecord(provenance)) {
		throw new TypeError(
			'reportAdapterSnapshot: provenance input must be a non-null object (an unverifiedProvenance-shaped input or an InferenceProvenance record)',
		);
	}
	const provenanceAdmission = admitProvenance(provenance);
	if (provenanceAdmission.admitted) {
		// Carried verbatim: a caller-supplied verified record is never
		// demoted, and the fold never stamps verification upward.
		return provenanceAdmission.provenance;
	}
	if (isProvenanceRecordShaped(provenance)) {
		throw new TypeError(
			`reportAdapterSnapshot: provenance record rejected '${provenanceAdmission.reason}': ${provenanceAdmission.detail}`,
		);
	}
	return unverifiedProvenance(provenance as UnverifiedProvenanceInput);
}

/**
 * Structural discriminator: an object carrying any provenance-record
 * field claims to be an InferenceProvenance record and must pass
 * admitProvenance - it is never re-derived as raw input (a hidden
 * substitution stays a lie, never silently repaired).
 */
function isProvenanceRecordShaped(candidate: Record<string, unknown>): boolean {
	return (
		'substitution' in candidate
		|| 'modelVerification' in candidate
		|| 'contractVersion' in candidate
	);
}

/**
 * The canonical report object: the fixed-key-order form shared by
 * serializeAdapterReport. The snapshot mirrors the catalog family's
 * canonical snapshot key order; the provenance mirrors the semantics
 * family's serializeCapacityDisclosure provenance key order.
 */
function canonicalReportObject(report: ProviderAdapterHealthReport): Record<string, unknown> {
	return {
		adapterId: report.adapterId,
		snapshot: canonicalSnapshotObject(report.snapshot),
		provenance: canonicalProvenanceObject(report.provenance),
		observedAtEpochMs: report.observedAtEpochMs,
		contractVersion: report.contractVersion,
	};
}

/** The canonical snapshot object: fixed key order per state kind. */
function canonicalSnapshotObject(snapshot: ProviderCapacitySnapshot): Record<string, unknown> {
	return {
		contractVersion: snapshot.contractVersion,
		providerId: snapshot.providerId,
		verification: snapshot.verification,
		health: snapshot.health,
		quota:
			snapshot.quota.state === 'known'
				? {
						state: 'known',
						remaining: snapshot.quota.remaining,
						limit: snapshot.quota.limit,
						window: {
							kind: snapshot.quota.window.kind,
							windowStartEpochMs: snapshot.quota.window.windowStartEpochMs,
							windowLengthMs: snapshot.quota.window.windowLengthMs,
						},
					}
				: { state: 'unknown' },
		cooldown:
			snapshot.cooldown.state === 'active'
				? {
						state: 'active',
						reason: snapshot.cooldown.reason,
						sinceEpochMs: snapshot.cooldown.sinceEpochMs,
						untilEpochMs: snapshot.cooldown.untilEpochMs,
					}
				: { state: 'none' },
		resetSchedule: canonicalResetScheduleObject(snapshot.resetSchedule),
		observedAtEpochMs: snapshot.observedAtEpochMs,
	};
}

/** The canonical reset-schedule object: fixed key order per kind. */
function canonicalResetScheduleObject(schedule: ResetSchedule): Record<string, unknown> {
	switch (schedule.kind) {
		case 'fixed-instant':
			return { kind: 'fixed-instant', atEpochMs: schedule.atEpochMs };
		case 'interval-aligned':
			return {
				kind: 'interval-aligned',
				anchorEpochMs: schedule.anchorEpochMs,
				intervalMs: schedule.intervalMs,
			};
		case 'provider-discretion':
			return { kind: 'provider-discretion' };
		default:
			return { kind: 'unknown' };
	}
}

/** The canonical provenance object: the landed fixed key order. */
function canonicalProvenanceObject(provenance: InferenceProvenance): Record<string, unknown> {
	return {
		contractVersion: provenance.contractVersion,
		requestedProviderId: provenance.requestedProviderId,
		requestedModelId: provenance.requestedModelId,
		actualProviderId: provenance.actualProviderId,
		actualModelId: provenance.actualModelId,
		substitution: provenance.substitution,
		modelVerification: provenance.modelVerification,
		recordedAtEpochMs: provenance.recordedAtEpochMs,
	};
}

function isAdapterTransportKind(value: unknown): value is AdapterTransportKind {
	return (ADAPTER_TRANSPORT_KINDS as readonly string[]).includes(value as string);
}

function isCapacityProvenance(value: unknown): value is CapacityProvenance {
	return (CAPACITY_PROVENANCES as readonly string[]).includes(value as string);
}

/**
 * The reference-shape half of the credential-handle rule: a string
 * with at least one non-whitespace character (a whitespace-only
 * handle is not a reference).
 */
function isCredentialHandleReference(value: unknown): value is string {
	return isNonEmptyString(value) && value.trim().length > 0;
}

/**
 * The secret-looking half of the credential-handle rule (the exact
 * conservative check, documented in the module header): any
 * whitespace-separated run longer than 40 characters, or any of the
 * characters '=', ':' or '/' (base64 payloads, key:value secret
 * pairs, URLs/paths). Vocabulary-level honesty only - INF-007 owns
 * the real isolation guards.
 */
function isSecretLookingCredentialHandle(handle: string): boolean {
	for (const run of handle.split(/\s+/)) {
		if (run.length > CREDENTIAL_HANDLE_MAX_RUN_LENGTH) {
			return true;
		}
	}
	return handle.includes('=') || handle.includes(':') || handle.includes('/');
}

function rejectAdapter(reason: AdapterRejectionReason, detail: string): ProviderAdapterRejected {
	return { admitted: false, reason, detail };
}

function rejectAdapterRecord(
	reason: AdapterRecordRejectionReason,
	detail: string,
): ProviderAdapterRecordRejected {
	return { admitted: false, reason, detail };
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
