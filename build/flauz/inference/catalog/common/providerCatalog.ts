/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-002 Free Inference Fabric contracts: the typed provider catalog
 * - who can serve inference, under which honest plan claims, with
 * which disclosed capacity and verification states (contract module,
 * the labContracts discipline; binds the landed INF-001 semantics
 * family vocabulary verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the INF-001
 * semantics family laws are INHERITED and binding here):
 * - THE PROMISE-SPLIT LAW (inherited, binding): every catalog plan
 *   claim passes the landed admitHonestPromise guard. A claim whose
 *   capacity guarantee is not 'provider-dependent' - the 'unlimited
 *   provider tokens' lie - is unrepresentable in the semantics
 *   vocabulary AND rejected here THROUGH admitHonestPromise's own
 *   rejection reasons, cited verbatim, never re-worded.
 * - HONEST STATES ARE DEFAULTS (the unverified-default law,
 *   inherited): metadataVerification defaults 'unverified',
 *   termsState defaults 'unknown' (never silently assume permission
 *   - INF-007 later builds the eligibility guards over this state),
 *   and capacity defaults ride the semantics family's
 *   unknownSnapshot. Never silent nulls, never guessed states.
 * - ENTRY-ID UNIQUENESS: a catalog entry id is unique; a duplicate
 *   entryId is a typed rejection, never a silent overwrite.
 * - ONE-WAY PROMOTIONS: markEntryMetadataVerified promotes
 *   'unverified' -> 'verified' and mirrors the semantics family's
 *   markProvenanceVerified; an already-verified entry stays verified
 *   and there is deliberately NO demotion transition - a stale
 *   verification must be re-derived from a fresh record.
 * - NO SHARED PUBLIC GATEWAY: nothing in this family models or
 *   permits a public Flauz gateway pooling third-party free-tier
 *   provider keys; third-party-free-tier entries are disclosed
 *   capacity, never a Flauz guarantee.
 * - Determinism: no Math.random, no Date.now, no new Date(, no
 *   process.env in this module. All timestamps are injected plain
 *   epoch-ms numbers; all ids are injected plain strings.
 * - Vocabulary only: this module declares types, constants, pure
 *   guards, pure derivations and pure copy transitions. It is not a
 *   runtime, not an engine, not a scheduler, not a router, not a key
 *   pool, not a second authority - and not a matching engine (the
 *   requirement -> provider/model matching engine is INF-006's
 *   item, a binding scope boundary).
 * - Every persisted record carries contractVersion.
 */
import {
	CAPACITY_PROVENANCES,
	admitHonestPromise,
} from '../../semantics/common/planSemantics.js';
import type {
	CapacityProvenance,
	PlanSemanticsRecord,
} from '../../semantics/common/planSemantics.js';
import {
	PROVIDER_METADATA_VERIFICATIONS,
	isProviderCapacitySnapshot,
	unknownSnapshot,
} from '../../semantics/common/capacityDisclosure.js';
import type {
	ProviderCapacitySnapshot,
	ProviderMetadataVerification,
	ResetSchedule,
} from '../../semantics/common/capacityDisclosure.js';

/**
 * Version of the inference-catalog contract set (this family's own
 * constant; every catalog-family persisted record carries it). The
 * provider-class/plan-claim/capacity vocabulary inside the records
 * is the INF-001 semantics family's, and those sub-records keep the
 * semantics family's own INFERENCE_SEMANTICS_CONTRACTS_VERSION
 * stamp; the catalog stamp and the semantics stamp are distinct
 * roles pinned by the test suite.
 */
export const INFERENCE_CATALOG_VERSION = '1.0.0';

/**
 * The closed, honest provider-term state vocabulary. 'unknown' is
 * the DEFAULT (the unverified-default law: permission is never
 * silently assumed). INF-007 later builds the credential-isolation
 * and provider-term eligibility guards over this state.
 */
export const PROVIDER_TERM_STATES = ['unknown', 'permitted', 'prohibited'] as const;
export type ProviderTermState = (typeof PROVIDER_TERM_STATES)[number];

/**
 * The typed provider catalog entry: one inference provider as the
 * persistence/audit shape. The entry rides the INF-001 semantics
 * vocabulary verbatim - the provider class is a CapacityProvenance,
 * every plan claim is an admitted PlanSemanticsRecord, and the
 * capacity snapshot is a disclosed ProviderCapacitySnapshot.
 * Carries the catalog contract-set version stamp.
 */
export interface ProviderCatalogEntry {
	readonly entryId: string;
	readonly displayName: string;
	readonly providerClass: CapacityProvenance;
	readonly planClaims: readonly PlanSemanticsRecord[];
	readonly capacitySnapshot: ProviderCapacitySnapshot;
	readonly metadataVerification: ProviderMetadataVerification;
	readonly termsState: ProviderTermState;
	readonly contractVersion: string;
}

/**
 * The typed provider catalog record: the named collection of
 * entries. Entry ids are unique inside a record (admission-enforced).
 * Carries the catalog contract-set version stamp.
 */
export interface ProviderCatalogRecord {
	readonly catalogId: string;
	readonly entries: readonly ProviderCatalogEntry[];
	readonly contractVersion: string;
}

/** Closed list of catalog-entry admission rejection reasons. */
export const CATALOG_ENTRY_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-entry-id',
	'invalid-display-name',
	'unknown-provider-class',
	'invalid-plan-claims',
	'dishonest-plan-claim',
	'invalid-capacity-snapshot',
	'invalid-metadata-verification',
	'invalid-terms-state',
] as const;
export type CatalogEntryRejectionReason = (typeof CATALOG_ENTRY_REJECTION_REASONS)[number];

export interface CatalogEntryAdmitted {
	readonly admitted: true;
	readonly entry: ProviderCatalogEntry;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface CatalogEntryRejected {
	readonly admitted: false;
	readonly reason: CatalogEntryRejectionReason;
	readonly detail: string;
}

export type CatalogEntryAdmission = CatalogEntryAdmitted | CatalogEntryRejected;

/** Closed list of catalog-record admission rejection reasons. */
export const CATALOG_RECORD_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-catalog-id',
	'invalid-entries',
	'invalid-entry',
	'duplicate-entry-id',
] as const;
export type CatalogRecordRejectionReason = (typeof CATALOG_RECORD_REJECTION_REASONS)[number];

export interface CatalogRecordAdmitted {
	readonly admitted: true;
	readonly record: ProviderCatalogRecord;
}

export interface CatalogRecordRejected {
	readonly admitted: false;
	readonly reason: CatalogRecordRejectionReason;
	readonly detail: string;
}

export type CatalogRecordAdmission = CatalogRecordAdmitted | CatalogRecordRejected;

/**
 * Pure fail-closed guard: admits only catalog entries whose every
 * plan claim passes the landed admitHonestPromise guard (dishonest
 * claims are rejected THROUGH that guard's own reasons, cited
 * verbatim in the detail), whose provider class is a member of the
 * semantics family's CAPACITY_PROVENANCES vocabulary, and whose
 * capacity snapshot satisfies isProviderCapacitySnapshot (a
 * snapshot without provenance - missing attribution, verification
 * state or observed time - is rejected). metadataVerification
 * defaults 'unverified' and termsState defaults 'unknown' when
 * absent (the unverified-default law; a present-but-invalid state
 * is a typed rejection, never a silent coercion). Deterministic:
 * same candidate, same verdict, same reason and detail. Never
 * mutates its input; never reads a clock.
 */
export function admitCatalogEntry(candidate: unknown): CatalogEntryAdmission {
	if (!isRecord(candidate)) {
		return rejectEntry('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_CATALOG_VERSION) {
		return rejectEntry(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_CATALOG_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const entryId = record.entryId;
	if (!isNonEmptyString(entryId)) {
		return rejectEntry('invalid-entry-id', 'entryId must be a non-empty string');
	}
	const displayName = record.displayName;
	if (!isNonEmptyString(displayName)) {
		return rejectEntry('invalid-display-name', 'displayName must be a non-empty string');
	}
	const providerClass = record.providerClass;
	if (!isCapacityProvenance(providerClass)) {
		return rejectEntry(
			'unknown-provider-class',
			`providerClass must be one of third-party-free-tier/flauz-provisioned/user-owned-endpoint, got '${String(providerClass)}'`,
		);
	}
	const planClaims = record.planClaims;
	if (!Array.isArray(planClaims)) {
		return rejectEntry('invalid-plan-claims', 'planClaims must be an array of plan-semantics records');
	}
	const claims: PlanSemanticsRecord[] = [];
	for (let index = 0; index < planClaims.length; index++) {
		const claimAdmission = admitHonestPromise(planClaims[index]);
		if (!claimAdmission.honest) {
			// THE PROMISE-SPLIT LAW surfaces the landed guard's own
			// reason and detail verbatim - cited, never re-worded.
			return rejectEntry(
				'dishonest-plan-claim',
				`planClaims[${index}] must satisfy admitHonestPromise: '${claimAdmission.reason}': ${claimAdmission.detail}`,
			);
		}
		claims.push(claimAdmission.record);
	}
	const capacitySnapshot = record.capacitySnapshot;
	if (!isProviderCapacitySnapshot(capacitySnapshot)) {
		return rejectEntry(
			'invalid-capacity-snapshot',
			'capacitySnapshot must satisfy isProviderCapacitySnapshot - a snapshot without provenance (missing attribution, verification state or observed time) is rejected',
		);
	}
	const metadataVerificationInput = record.metadataVerification;
	let metadataVerification: ProviderMetadataVerification;
	if (metadataVerificationInput === undefined) {
		// The unverified-default law: external provider metadata is
		// untrusted until verified; the default is never a guess.
		metadataVerification = 'unverified';
	} else if (isProviderMetadataVerification(metadataVerificationInput)) {
		metadataVerification = metadataVerificationInput;
	} else {
		return rejectEntry(
			'invalid-metadata-verification',
			`metadataVerification must be unverified or verified, got '${String(metadataVerificationInput)}'`,
		);
	}
	const termsStateInput = record.termsState;
	let termsState: ProviderTermState;
	if (termsStateInput === undefined) {
		// The honest default: provider permission is never silently
		// assumed - 'unknown' until the INF-007 eligibility guards
		// say otherwise.
		termsState = 'unknown';
	} else if (isProviderTermState(termsStateInput)) {
		termsState = termsStateInput;
	} else {
		return rejectEntry(
			'invalid-terms-state',
			`termsState must be one of unknown/permitted/prohibited, got '${String(termsStateInput)}'`,
		);
	}
	return {
		admitted: true,
		entry: {
			entryId,
			displayName,
			providerClass,
			planClaims: claims,
			capacitySnapshot,
			metadataVerification,
			termsState,
			contractVersion,
		},
	};
}

/**
 * Pure fail-closed guard over the catalog record: every entry must
 * pass admitCatalogEntry (its own rejection surfaces verbatim in
 * the detail) and ENTRY IDS ARE UNIQUE - a duplicate entryId is a
 * typed rejection, never a silent overwrite. Deterministic; never
 * mutates its input.
 */
export function admitCatalogRecord(candidate: unknown): CatalogRecordAdmission {
	if (!isRecord(candidate)) {
		return rejectRecord('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_CATALOG_VERSION) {
		return rejectRecord(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_CATALOG_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const catalogId = record.catalogId;
	if (!isNonEmptyString(catalogId)) {
		return rejectRecord('invalid-catalog-id', 'catalogId must be a non-empty string');
	}
	const entries = record.entries;
	if (!Array.isArray(entries)) {
		return rejectRecord('invalid-entries', 'entries must be an array of provider catalog entries');
	}
	const admittedEntries: ProviderCatalogEntry[] = [];
	const seenEntryIds = new Set<string>();
	for (let index = 0; index < entries.length; index++) {
		const entryAdmission = admitCatalogEntry(entries[index]);
		if (!entryAdmission.admitted) {
			return rejectRecord(
				'invalid-entry',
				`entries[${index}] must satisfy admitCatalogEntry: '${entryAdmission.reason}': ${entryAdmission.detail}`,
			);
		}
		const entry = entryAdmission.entry;
		if (seenEntryIds.has(entry.entryId)) {
			// THE ENTRY-ID UNIQUENESS LAW: a repeat is a typed
			// rejection - the catalog never silently overwrites.
			return rejectRecord(
				'duplicate-entry-id',
				`entries[${index}] repeats entryId '${entry.entryId}' - a catalog entry id is unique, never a silent overwrite`,
			);
		}
		seenEntryIds.add(entry.entryId);
		admittedEntries.push(entry);
	}
	return {
		admitted: true,
		record: {
			catalogId,
			entries: admittedEntries,
			contractVersion,
		},
	};
}

/**
 * Pure derivation: the frozen entry-id lookup map over an admitted
 * catalog record (a read-only view; entry ids are unique by
 * admission). Prototype-hazard ids ('__proto__', 'constructor')
 * still land as own keys - the index is built with defineProperty,
 * never plain assignment. Deterministic; never mutates its input.
 */
export function catalogIndexById(record: ProviderCatalogRecord): Readonly<Record<string, ProviderCatalogEntry>> {
	const index: Record<string, ProviderCatalogEntry> = {};
	for (const entry of record.entries) {
		Object.defineProperty(index, entry.entryId, {
			value: entry,
			enumerable: true,
			writable: false,
			configurable: false,
		});
	}
	return Object.freeze(index);
}

/**
 * The ONE-WAY metadata-verification promotion: 'unverified' ->
 * 'verified', mirroring the semantics family's
 * markProvenanceVerified. Pure copy transition - every other field
 * is preserved verbatim, including termsState (verification never
 * rewrites provider terms). Idempotent: a verified entry stays
 * verified. There is deliberately NO demotion transition: a stale
 * verification must be re-derived from a fresh record, never
 * silently downgraded.
 */
export function markEntryMetadataVerified(entry: ProviderCatalogEntry): ProviderCatalogEntry {
	return { ...entry, metadataVerification: 'verified' };
}

/**
 * The honest default entry constructor (riding the semantics
 * family's unknownSnapshot): all capacity unknown, metadata
 * unverified, provider terms unknown, and NO plan claims (no claims
 * is honest; a fabricated claim is not). The entryId doubles as the
 * displayName - the id is the honest display name when nothing else
 * is known, never an invented label. Deterministic; stamps the
 * catalog contract version; never reads a clock. Throws TypeError
 * on an empty entryId, an unknown provider class or a non-finite
 * timestamp (fail-closed factory).
 */
export function unknownCapacityEntry(
	entryId: string,
	providerClass: CapacityProvenance,
	observedAtEpochMs: number,
): ProviderCatalogEntry {
	if (!isNonEmptyString(entryId)) {
		throw new TypeError('unknownCapacityEntry: entryId must be a non-empty string');
	}
	if (!isCapacityProvenance(providerClass)) {
		throw new TypeError(
			`unknownCapacityEntry: providerClass must be one of third-party-free-tier/flauz-provisioned/user-owned-endpoint, got '${String(providerClass)}'`,
		);
	}
	if (!isFiniteEpochMs(observedAtEpochMs)) {
		throw new TypeError('unknownCapacityEntry: observedAtEpochMs must be a finite number');
	}
	return {
		entryId,
		displayName: entryId,
		providerClass,
		planClaims: [],
		capacitySnapshot: unknownSnapshot(entryId, observedAtEpochMs),
		metadataVerification: 'unverified',
		termsState: 'unknown',
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

/**
 * Canonical serialization of a catalog entry: fixed key order,
 * deterministic bytes independent of the input record's key
 * insertion order (plan claims and the capacity snapshot are
 * canonicalized with their own fixed key orders, mirroring the
 * serializePlanSemanticsRecord / serializeCapacityDisclosure
 * idiom). Refuses non-admitted entries (fail closed: no dishonest
 * entry ever gets canonical bytes). This canonical form is the
 * persistence/audit shape for the INF-003..009 binders.
 */
export function serializeCatalogEntry(entry: unknown): string {
	const admission = admitCatalogEntry(entry);
	if (!admission.admitted) {
		throw new Error(
			`serializeCatalogEntry: entry rejected '${admission.reason}': ${admission.detail}`,
		);
	}
	return JSON.stringify(canonicalEntryObject(admission.entry));
}

/**
 * Canonical serialization of a catalog record: fixed key order
 * (catalogId, entries in the record's own order, contractVersion),
 * every entry canonicalized. Refuses non-admitted records (fail
 * closed - a duplicate entry id never gets canonical bytes). Entry
 * order is the ordered array's own order and is preserved;
 * reordering entries is a byte-level difference of the audit shape.
 */
export function serializeCatalogRecord(record: unknown): string {
	const admission = admitCatalogRecord(record);
	if (!admission.admitted) {
		throw new Error(
			`serializeCatalogRecord: record rejected '${admission.reason}': ${admission.detail}`,
		);
	}
	return JSON.stringify({
		catalogId: admission.record.catalogId,
		entries: admission.record.entries.map((entry) => canonicalEntryObject(entry)),
		contractVersion: admission.record.contractVersion,
	});
}

/** Pure shape predicate: an admitted, well-formed catalog entry. */
export function isProviderCatalogEntry(value: unknown): value is ProviderCatalogEntry {
	return admitCatalogEntry(value).admitted;
}

/** Pure shape predicate: an admitted, well-formed catalog record. */
export function isProviderCatalogRecord(value: unknown): value is ProviderCatalogRecord {
	return admitCatalogRecord(value).admitted;
}

/**
 * The canonical entry object: the fixed-key-order form shared by
 * serializeCatalogEntry and serializeCatalogRecord. Plan claims
 * mirror serializePlanSemanticsRecord's fixed key order; the
 * capacity snapshot carries its own fixed key order per state kind.
 */
function canonicalEntryObject(entry: ProviderCatalogEntry): Record<string, unknown> {
	return {
		entryId: entry.entryId,
		displayName: entry.displayName,
		providerClass: entry.providerClass,
		planClaims: entry.planClaims.map((claim) => ({
			planId: claim.planId,
			contractVersion: claim.contractVersion,
			tier: claim.tier,
			productPromise: {
				promiseSide: claim.productPromise.promiseSide,
				subject: claim.productPromise.subject,
				guarantee: claim.productPromise.guarantee,
			},
			providerCapacityClaim: {
				promiseSide: claim.providerCapacityClaim.promiseSide,
				subject: claim.providerCapacityClaim.subject,
				guarantee: claim.providerCapacityClaim.guarantee,
				capacityProvenance: claim.providerCapacityClaim.capacityProvenance,
			},
		})),
		capacitySnapshot: canonicalSnapshotObject(entry.capacitySnapshot),
		metadataVerification: entry.metadataVerification,
		termsState: entry.termsState,
		contractVersion: entry.contractVersion,
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

function isProviderTermState(value: unknown): value is ProviderTermState {
	return (PROVIDER_TERM_STATES as readonly string[]).includes(value as string);
}

function isCapacityProvenance(value: unknown): value is CapacityProvenance {
	return (CAPACITY_PROVENANCES as readonly string[]).includes(value as string);
}

function isProviderMetadataVerification(value: unknown): value is ProviderMetadataVerification {
	return (PROVIDER_METADATA_VERIFICATIONS as readonly string[]).includes(value as string);
}

function rejectEntry(reason: CatalogEntryRejectionReason, detail: string): CatalogEntryRejected {
	return { admitted: false, reason, detail };
}

function rejectRecord(reason: CatalogRecordRejectionReason, detail: string): CatalogRecordRejected {
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
