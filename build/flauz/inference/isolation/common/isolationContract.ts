/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-007 Free Inference Fabric contracts: the typed credential
 * ISOLATION + provider-term ELIGIBILITY family - the closed no-secret
 * vocabulary for naming WHERE an isolated runtime looks a credential
 * up (the typed reference triple: a scope id, a bound adapter id and
 * the bound adapter record's own opaque credentialHandle reference),
 * the fail-closed admission guards binding the landed adapter record
 * and catalog record (the no-dangling-ref and handle-equality laws),
 * the frozen usage-class vocabulary, the honest-unknown term-eligibility
 * verdicts, the typed handle-resolution vocabulary and the
 * provenance-bearing eligibility decision record (contract module, the
 * labContracts discipline; binds the landed INF-001 semantics
 * family's provenance and metadata-verification vocabulary, the
 * INF-002 catalog family's ProviderTermState and the INF-003 adapter
 * family's opaque credentialHandle reference verbatim, never
 * re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..006 family laws are INHERITED and binding here):
 * - THE NO-SECRET LAW (binding, this family's charter): the
 *   vocabulary carries NO credential material anywhere - no secret
 *   values, no key bytes, no token strings, no env names - only
 *   TYPED REFERENCES (the landed opaque credentialHandle id shape). A
 *   credential scope is the typed triple (id, adapterId, handleRef)
 *   and NOTHING else: any field beyond the typed reference shape is
 *   the typed 'secret-shaped-scope' rejection, checked FIRST so a
 *   secret-bearing candidate is always named as the secret shape,
 *   never downgraded to a generic shape rejection (the honest-promise
 *   family's lie-first discipline). Unrepresentable AND rejected -
 *   the scope triple is so minimal it carries no contractVersion of
 *   its own; the enclosing audit shapes carry the family stamps.
 * - THE HANDLE-EQUALITY LAW (binding): a scope's handleRef EQUALS the
 *   bound adapter record's own credentialHandle - never
 *   caller-invented. A caller-invented handle reference is the typed
 *   'credential-handle-mismatch' rejection.
 * - THE NO-DANGLING-REF LAW (binding, extended to isolation): every
 *   scope's adapterId resolves in the bound adapter record; through
 *   the bound adapter's providerEntryId every catalog binding resolves
 *   in the bound catalog record - or admission is a typed rejection,
 *   never a silent dangling ref.
 * - THE HONEST-UNKNOWN ELIGIBILITY LAW (binding, the INF-002 catalog's
 *   own law re-enforced at the eligibility seam): a provider term
 *   state of 'unknown' is NEVER auto-eligible. Every eligibility check
 *   over an unknown term state is the typed 'term-unknown' verdict -
 *   disclosed, never silent, never assumed permission.
 * - THE SAFETY LAW (binding, the INF workstream's): no shared public
 *   Flauz gateway pooling third-party free-tier keys; NO network I/O
 *   (live-provider acceptance is INF-009, never here). The landed
 *   direct-adapter law (a per-user/direct adapter is never
 *   'flauz-provisioned') is the eligibility guard's provenance
 *   precondition - enforced through the landed
 *   admitProviderAdapterRecord at kit creation, never re-implemented.
 * - THE DELEGATED PROMOTION (binding): the landed one-way verification
 *   promotions (markProvenanceVerified / markEntryMetadataVerified)
 *   are delegated, never re-implemented; the landed
 *   ProviderMetadataVerification states are the disclosure vocabulary.
 *   This family exposes NO promotion surface at all.
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. Every timestamp is a caller-injected epoch-ms number. No
 *   Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every admission rejection is a typed member of the
 *   frozen ISOLATION_REJECTION_REASONS list, in the exact check order;
 *   the first failing check is THE verdict, and every rejection names
 *   its reason.
 * - THE PROVENANCE-DERIVATION LAW (binding): an eligibility decision's
 *   provenance is DERIVED from the bound records through the landed
 *   unverifiedProvenance constructor, never caller-supplied, never
 *   hand-built; the decision guard pins the derivation structurally.
 * - Vocabulary only: this module declares types, constants, pure
 *   guards and pure folds. It is not a runtime, not a network, not an
 *   event authority, not a secret store, not a second version
 *   declaration (the kit module re-carries THIS module's
 *   INFERENCE_ISOLATION_VERSION; the battery pins both module copies
 *   equal).
 * - Canonical bytes: serializeEligibilityDecision /
 *   serializeCredentialScope emit fixed-key-order deterministic bytes
 *   (double-run byte-equal); every persisted/audited top-level shape
 *   carries contractVersion; transient rejection verdicts carry
 *   reason + detail (the landed families' rejection idiom).
 * - Zero external dependencies: node: builtins (none needed) and the
 *   landed sibling families only.
 */
import { PROVIDER_TERM_STATES, catalogIndexById } from '../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord, ProviderTermState } from '../../catalog/common/providerCatalog.js';
import type { ProviderAdapterDescriptor, ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { PROVIDER_METADATA_VERIFICATIONS, admitProvenance } from '../../semantics/common/capacityDisclosure.js';
import type { InferenceProvenance, ProviderMetadataVerification } from '../../semantics/common/capacityDisclosure.js';

/**
 * Version of the inference-isolation contract set (this family's own
 * constant, declared ONCE here - the single version declaration law;
 * every isolation-family persisted record carries it). The sibling
 * isolationKit module re-carries this same declaration (re-exported;
 * the battery pins both module copies equal). The vocabulary INSIDE
 * the records is the landed families', bound verbatim and never
 * re-implemented: provider term states ride the INF-002 catalog
 * family's PROVIDER_TERM_STATES vocabulary, adapter bindings are the
 * INF-003 family's ProviderAdapterRecord entries, the opaque handle
 * reference is that family's credentialHandle id shape, and the
 * derived provenance + metadata verification states ride the INF-001
 * semantics family's vocabulary. Those sub-records keep their own
 * family version stamps; the isolation stamp and the landed stamps
 * are distinct roles pinned by the suite.
 */
export const INFERENCE_ISOLATION_VERSION = '1.0.0';

/**
 * Closed frozen list of isolation rejection reasons, in the exact
 * check order (each guard walks its applicable subset in this order;
 * the first failure is THE verdict):
 *   not-an-object             - the candidate is not an object (both
 *                               walks);
 *   version-mismatch          - contractVersion must be
 *                               INFERENCE_ISOLATION_VERSION (the set
 *                               walk; the scope triple itself carries
 *                               no version field - the no-secret law);
 *   invalid-scope-set-id      - scopeSetId is not a non-empty string
 *                               (set walk);
 *   invalid-scopes            - scopes is not an array (set walk);
 *   invalid-scope             - an entry fails the scope walk (set
 *                               walk; the scope walk's own reason
 *                               surfaces verbatim in the detail);
 *   secret-shaped-scope       - THE NO-SECRET LAW: the candidate
 *                               carries a field beyond the typed
 *                               reference triple (id, adapterId,
 *                               handleRef) - no secret values, no key
 *                               bytes, no token strings, no env names,
 *                               no extra fields of any kind (scope
 *                               walk, checked FIRST so the secret shape
 *                               is always named, never downgraded);
 *   invalid-scope-id          - id is not a non-empty string (scope
 *                               walk);
 *   invalid-adapter-id        - adapterId is not a non-empty string
 *                               (scope walk);
 *   invalid-handle-ref        - handleRef is not a non-empty string
 *                               (scope walk);
 *   unresolved-adapter-binding - THE NO-DANGLING-REF LAW: the scope's
 *                               adapterId resolves to no adapter in
 *                               the bound adapter record (scope walk);
 *   unresolved-catalog-entry  - THE NO-DANGLING-REF LAW: the bound
 *                               adapter's providerEntryId resolves to
 *                               no entry in the bound catalog record
 *                               (scope walk);
 *   credential-handle-mismatch - THE HANDLE-EQUALITY LAW: the scope's
 *                               handleRef does not EQUAL the bound
 *                               adapter record's own credentialHandle -
 *                               never caller-invented (scope walk);
 *   duplicate-scope-id        - THE DUPLICATE LAW at the set fold: a
 *                               repeated scope id inside a candidate
 *                               scope set record, never a silent
 *                               overwrite (the kit's own
 *                               registered-set duplicate is the
 *                               kit-level 'isolation-scope-duplicate'
 *                               addition).
 */
export const ISOLATION_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-scope-set-id',
	'invalid-scopes',
	'invalid-scope',
	'secret-shaped-scope',
	'invalid-scope-id',
	'invalid-adapter-id',
	'invalid-handle-ref',
	'unresolved-adapter-binding',
	'unresolved-catalog-entry',
	'credential-handle-mismatch',
	'duplicate-scope-id',
] as const;
export type IsolationRejectionReason = (typeof ISOLATION_REJECTION_REASONS)[number];

/**
 * The typed credential scope: the reference triple ONLY - the scope
 * id (the `fixture.` prefix convention for synthetic ids), the plain
 * adapter id reference into the bound INF-003 adapter record, and the
 * handle reference that must EQUAL the bound adapter record's own
 * opaque credentialHandle. NO other fields are representable in the
 * type: no secret values, no key bytes, no token strings, no env
 * names, not even a contractVersion (THE NO-SECRET LAW - the typed
 * reference is so minimal that even the family stamp is beyond it;
 * the enclosing audit shapes carry the stamps).
 */
export interface CredentialScopeDescriptor {
	readonly id: string;
	readonly adapterId: string;
	readonly handleRef: string;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface ScopeRejected {
	readonly admitted: false;
	readonly reason: IsolationRejectionReason;
	readonly detail: string;
}

/** The admitted scope side of the scope walk. */
export interface ScopeAdmitted {
	readonly admitted: true;
	readonly scope: CredentialScopeDescriptor;
}

export type ScopeAdmission = ScopeAdmitted | ScopeRejected;

/**
 * Pure fail-closed scope guard (the scope walk of the frozen list):
 * THE NO-SECRET LAW fires first - a candidate carrying any own field
 * beyond the typed reference triple is the typed 'secret-shaped-scope'
 * rejection, never downgraded to a generic shape rejection; then the
 * triple's shape checks; then the no-dangling-ref chain - the scope's
 * adapter binding resolves in the bound adapter record, and through
 * the bound adapter's providerEntryId the catalog binding resolves in
 * the bound catalog record; then THE HANDLE-EQUALITY LAW - the
 * scope's handleRef must EQUAL the bound adapter record's own
 * credentialHandle, never caller-invented. The bound records are
 * taken as the landed admitted shapes (typed arguments; the kit
 * validates them through the landed guards at creation, and the
 * battery fires the dangling reasons here with cross-inconsistent
 * hand-built records). Deterministic: same candidate, same verdict,
 * same reason and detail. Never mutates its input; never reads a
 * clock.
 */
export function admitCredentialScope(
	candidate: unknown,
	adapters: ProviderAdapterRecord,
	catalog: ProviderCatalogRecord,
): ScopeAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key !== 'id' && key !== 'adapterId' && key !== 'handleRef') {
			// THE NO-SECRET LAW fires first: any field beyond the typed
			// reference triple is the secret shape - always named, never
			// downgraded to a generic shape rejection.
			return reject(
				'secret-shaped-scope',
				`a credential scope is the typed reference triple (id, adapterId, handleRef) and nothing else - the field '${key}' is beyond the typed reference shape; no secret values, no key bytes, no token strings, no env names, never admitted`,
			);
		}
	}
	const id = record.id;
	if (!isNonEmptyString(id)) {
		return reject('invalid-scope-id', 'id must be a non-empty string');
	}
	const adapterId = record.adapterId;
	if (!isNonEmptyString(adapterId)) {
		return reject(
			'invalid-adapter-id',
			'adapterId must be a non-empty string (a plain id reference into the bound adapter record, never credential material)',
		);
	}
	const handleRef = record.handleRef;
	if (!isNonEmptyString(handleRef)) {
		return reject(
			'invalid-handle-ref',
			'handleRef must be a non-empty string - the typed reference that must equal the bound adapter record\'s own credentialHandle',
		);
	}
	const adapter = findAdapter(adapters, adapterId);
	if (adapter === undefined) {
		// THE NO-DANGLING-REF LAW: the scope's adapter binding never dangles.
		return reject(
			'unresolved-adapter-binding',
			`the scope's adapterId '${adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
		);
	}
	if (!carriesEntry(catalog, adapter.providerEntryId)) {
		// THE NO-DANGLING-REF LAW: the catalog binding through the adapter's
		// providerEntryId never dangles.
		return reject(
			'unresolved-catalog-entry',
			`adapter '${adapterId}' references providerEntryId '${adapter.providerEntryId}' which the bound catalog does not carry - a dangling catalog reference is a typed rejection, never a silent dangling ref`,
		);
	}
	if (handleRef !== adapter.credentialHandle) {
		// THE HANDLE-EQUALITY LAW: the handle reference is the bound adapter
		// record's own credentialHandle - never caller-invented.
		return reject(
			'credential-handle-mismatch',
			`the scope's handleRef must EQUAL the bound adapter record's own credentialHandle for adapter '${adapterId}' - a caller-invented handle reference is a typed rejection, never a silent substitution`,
		);
	}
	return { admitted: true, scope: { id, adapterId, handleRef } };
}

/**
 * The typed credential scope set record: the named collection of
 * scope triples (the catalog-record shape). Scope ids are unique
 * inside a record (admission-enforced). Carries the isolation
 * contract-set version stamp (the triple itself carries none - the
 * no-secret law; the enclosing audit shape carries the stamp).
 */
export interface CredentialScopeSetRecord {
	readonly scopeSetId: string;
	readonly scopes: readonly CredentialScopeDescriptor[];
	readonly contractVersion: string;
}

/** The admitted set side of the set walk. */
export interface ScopeSetAdmitted {
	readonly admitted: true;
	readonly record: CredentialScopeSetRecord;
}

export type ScopeSetAdmission = ScopeSetAdmitted | ScopeRejected;

/**
 * Pure fail-closed set guard (the set walk of the frozen list): every
 * scope must pass admitCredentialScope against the SAME bound records
 * (its own rejection surfaces verbatim in the detail) and SCOPE IDS
 * ARE UNIQUE inside the record - a duplicate is a typed rejection,
 * never a silent overwrite. Deterministic; never mutates its input.
 */
export function admitCredentialScopeSet(
	candidate: unknown,
	adapters: ProviderAdapterRecord,
	catalog: ProviderCatalogRecord,
): ScopeSetAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_ISOLATION_VERSION) {
		return reject(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_ISOLATION_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const scopeSetId = record.scopeSetId;
	if (!isNonEmptyString(scopeSetId)) {
		return reject('invalid-scope-set-id', 'scopeSetId must be a non-empty string');
	}
	const scopes = record.scopes;
	if (!Array.isArray(scopes)) {
		return reject('invalid-scopes', 'scopes must be an array of credential scope triples');
	}
	const admittedScopes: CredentialScopeDescriptor[] = [];
	const seenScopeIds = new Set<string>();
	for (let index = 0; index < scopes.length; index++) {
		const scopeAdmission = admitCredentialScope(scopes[index], adapters, catalog);
		if (!scopeAdmission.admitted) {
			return reject(
				'invalid-scope',
				`scopes[${index}] must satisfy admitCredentialScope: '${scopeAdmission.reason}': ${scopeAdmission.detail}`,
			);
		}
		const scope = scopeAdmission.scope;
		if (seenScopeIds.has(scope.id)) {
			// THE DUPLICATE LAW at the set fold: a repeat is a typed rejection -
			// the scope set never silently overwrites.
			return reject(
				'duplicate-scope-id',
				`scopes[${index}] repeats id '${scope.id}' - a credential scope id is unique inside a scope set record, never a silent overwrite`,
			);
		}
		seenScopeIds.add(scope.id);
		admittedScopes.push(scope);
	}
	return {
		admitted: true,
		record: { scopeSetId, scopes: admittedScopes, contractVersion },
	};
}

/**
 * The closed frozen eligibility usage-class vocabulary - the classes
 * the landed families' surfaces already name in their binder maps:
 *   product-inference   - the product's own inference path (INF-009's
 *                         live-provider acceptance is the consumer);
 *   routing-failover    - the INF-005 routing family's failover
 *                         surface;
 *   matching-selection  - the INF-006 matching family's selection
 *                         surface;
 *   sidecar-report      - the INF-004 sidecar family's report
 *                         surface.
 * Widening the set is a versioned contract decision, never a silent
 * addition.
 */
export const USAGE_CLASSES = [
	'product-inference',
	'routing-failover',
	'matching-selection',
	'sidecar-report',
] as const;
export type IsolationUsageClass = (typeof USAGE_CLASSES)[number];

/** Pure predicate over the closed usage-class list. */
export function isUsageClass(value: unknown): value is IsolationUsageClass {
	return (USAGE_CLASSES as readonly string[]).includes(value as string);
}

/**
 * The closed frozen term-eligibility verdict vocabulary. THE
 * HONEST-UNKNOWN ELIGIBILITY LAW: a provider term state of 'unknown'
 * is NEVER auto-eligible - every eligibility check over an unknown
 * term state is the disclosed 'term-unknown' verdict, never silent,
 * never assumed permission.
 */
export const TERM_ELIGIBILITY_VERDICTS = ['eligible', 'ineligible', 'term-unknown'] as const;
export type TermEligibilityVerdict = (typeof TERM_ELIGIBILITY_VERDICTS)[number];

/**
 * The total deterministic verdict fold over the landed provider term
 * states - THE HONEST-UNKNOWN ELIGIBILITY LAW: 'permitted' is
 * 'eligible', 'prohibited' is 'ineligible', and 'unknown' is NEVER
 * auto-eligible - it is the disclosed 'term-unknown' verdict. The
 * decision guard pins this fold structurally; the kit's eligibility
 * checks ride it verbatim.
 */
export function verdictForTermState(termsState: ProviderTermState): TermEligibilityVerdict {
	if (termsState === 'permitted') {
		return 'eligible';
	}
	if (termsState === 'prohibited') {
		return 'ineligible';
	}
	return 'term-unknown';
}

/**
 * The provenance scope-label convention for the eligibility decision:
 * the eligibility fold is provider-scoped and carries no model ids,
 * so the derived provenance's model fields name the ELIGIBILITY probe
 * scope - a scope label, never a model claim (mirroring the routing
 * family's ROUTING_PROBE_SCOPE convention). The decision guard pins
 * the label structurally.
 */
export const ISOLATION_ELIGIBILITY_PROBE_SCOPE = 'isolation.eligibility-probe';

/**
 * The closed frozen handle-resolution failure vocabulary (the typed
 * resolution verdict's refusal side): 'unknown-scope' - the scope id
 * resolves to no registered credential scope. Registration enforces
 * every binding law, so the unknown scope is the only resolvable
 * failure at fold time.
 */
export const ISOLATION_RESOLUTION_REASONS = ['unknown-scope'] as const;
export type IsolationResolutionReason = (typeof ISOLATION_RESOLUTION_REASONS)[number];

/**
 * The resolved side of the typed resolution: the scope id, the bound
 * adapter id and the bound adapter record's own opaque
 * credentialHandle - the typed reference ONLY. The vocabulary cannot
 * name a secret and the kit cannot return one: the credentialHandle
 * IS the landed opaque reference id, never the material itself.
 */
export interface HandleResolved {
	readonly resolved: true;
	readonly scopeId: string;
	readonly adapterId: string;
	readonly credentialHandle: string;
}

/** Typed resolution refusal: closed reason, detail names the miss. */
export interface HandleUnresolved {
	readonly resolved: false;
	readonly reason: IsolationResolutionReason;
	readonly detail: string;
}

export type HandleResolution = HandleResolved | HandleUnresolved;

/**
 * The typed eligibility decision, decided side (the provenance-bearing
 * eligibility decision): the scope binding chain (scope id, adapter
 * id, provider entry id), the usage class (the disclosed context of
 * the question), the bound provider's ProviderTermState VERBATIM, the
 * frozen verdict (the total fold of the term state), the metadata
 * verification state riding the landed ProviderMetadataVerification
 * vocabulary (carried verbatim from the bound catalog entry - the
 * landed one-way promotion's own state, never re-stamped here), and
 * the DERIVED InferenceProvenance (built by the kit through the
 * landed unverifiedProvenance constructor with the probe scope label;
 * one decision, one time - the recording instant IS the decision
 * instant). Carries the isolation contract-set version stamp.
 */
export interface EligibilityDecided {
	readonly kind: 'decided';
	readonly contractVersion: string;
	readonly scopeId: string;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly usageClass: IsolationUsageClass;
	readonly termsState: ProviderTermState;
	readonly verdict: TermEligibilityVerdict;
	readonly metadataVerification: ProviderMetadataVerification;
	readonly provenance: InferenceProvenance;
	readonly decidedAtEpochMs: number;
}

/**
 * The typed eligibility decision, refused side: there is no eligible
 * binding to decide - the scope id resolves to no registered scope,
 * or the usage class is not a member of the frozen USAGE_CLASSES
 * vocabulary. The typed 'no-eligible-binding' refusal - never an
 * exception, never a fabricated eligibility (nothing is decided, no
 * provenance is derived, no verdict is invented; the detail names the
 * miss). Carries the isolation contract-set version stamp.
 */
export interface EligibilityRefused {
	readonly kind: 'no-eligible-binding';
	readonly contractVersion: string;
	readonly decidedAtEpochMs: number;
	readonly detail: string;
}

export type EligibilityDecisionRecord = EligibilityDecided | EligibilityRefused;

/**
 * Canonical serialization of an eligibility decision (either side):
 * fixed key order, deterministic bytes regardless of the input
 * record's key insertion order. The provenance sub-record mirrors the
 * landed canonical provenance key order (the adapter family's cited
 * idiom - contractVersion, requestedProviderId, requestedModelId,
 * actualProviderId, actualModelId, substitution, modelVerification,
 * recordedAtEpochMs). Refuses non-admitted decisions fail-closed
 * (TypeError) - no dishonest eligibility decision ever gets canonical
 * bytes. This canonical form is the persistence/audit shape for the
 * INF-008/009 binders (INF-008's UI renders it).
 */
export function serializeEligibilityDecision(decision: unknown): string {
	if (!isEligibilityDecisionRecord(decision)) {
		throw new TypeError(
			'serializeEligibilityDecision: decision must satisfy isEligibilityDecisionRecord - no dishonest eligibility decision ever gets canonical bytes',
		);
	}
	if (decision.kind === 'no-eligible-binding') {
		return JSON.stringify({
			kind: decision.kind,
			contractVersion: decision.contractVersion,
			decidedAtEpochMs: decision.decidedAtEpochMs,
			detail: decision.detail,
		});
	}
	return JSON.stringify({
		kind: decision.kind,
		contractVersion: decision.contractVersion,
		scopeId: decision.scopeId,
		adapterId: decision.adapterId,
		providerEntryId: decision.providerEntryId,
		usageClass: decision.usageClass,
		termsState: decision.termsState,
		verdict: decision.verdict,
		metadataVerification: decision.metadataVerification,
		provenance: canonicalProvenanceObject(decision.provenance),
		decidedAtEpochMs: decision.decidedAtEpochMs,
	});
}

/**
 * Canonical serialization of a credential scope: fixed key order (id,
 * adapterId, handleRef - the typed triple and nothing else),
 * deterministic bytes regardless of the input record's key insertion
 * order. Refuses non-admitted scopes fail-closed (TypeError) - no
 * dishonest scope (and no secret-shaped candidate) ever gets
 * canonical bytes. This canonical form is the persistence/audit shape
 * for the INF-008/009 binders.
 */
export function serializeCredentialScope(scope: unknown): string {
	if (!isCredentialScopeDescriptor(scope)) {
		throw new TypeError(
			'serializeCredentialScope: scope must satisfy isCredentialScopeDescriptor - no dishonest credential scope ever gets canonical bytes',
		);
	}
	return JSON.stringify({
		id: scope.id,
		adapterId: scope.adapterId,
		handleRef: scope.handleRef,
	});
}

/**
 * Pure shape predicate: an admitted, well-formed credential scope,
 * checked through the scope walk's SHAPE checks WITHOUT the bound
 * records - the no-extra-keys no-secret check and the non-empty
 * triple (a plain shape check; the no-dangling-ref chain and the
 * handle-equality law are the caller-bound laws of
 * admitCredentialScope, mirroring the landed isMatchCandidateDescriptor
 * scope note).
 */
export function isCredentialScopeDescriptor(value: unknown): value is CredentialScopeDescriptor {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (key !== 'id' && key !== 'adapterId' && key !== 'handleRef') {
			// THE NO-SECRET LAW at the shape level: any field beyond the typed
			// triple is not a credential scope.
			return false;
		}
	}
	return (
		isNonEmptyString(record.id)
		&& isNonEmptyString(record.adapterId)
		&& isNonEmptyString(record.handleRef)
	);
}

/**
 * Pure shape guard: a well-formed, version-stamped eligibility
 * decision (either side). The decided side additionally pins the
 * internal consistency laws structurally: the usage class is a member
 * of the frozen USAGE_CLASSES vocabulary; the terms state is a member
 * of the landed PROVIDER_TERM_STATES vocabulary; the verdict is the
 * TOTAL DETERMINISTIC FOLD of the term state (THE HONEST-UNKNOWN
 * ELIGIBILITY LAW made structural - an 'unknown' term state can never
 * carry an 'eligible' verdict); the metadata verification state is a
 * member of the landed PROVIDER_METADATA_VERIFICATIONS vocabulary; the
 * derived provenance satisfies the landed admitProvenance and names
 * the bound provider on BOTH sides with the probe scope label and the
 * 'none' substitution (no substitution is representable - the
 * eligibility decision is about one provider), with the same
 * recording instant as the decision's own decidedAtEpochMs (one
 * decision, one time). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isEligibilityDecisionRecord(value: unknown): value is EligibilityDecisionRecord {
	if (!isRecord(value)) {
		return false;
	}
	const decision = value as Record<string, unknown>;
	if (decision.contractVersion !== INFERENCE_ISOLATION_VERSION) {
		return false;
	}
	if (decision.kind === 'no-eligible-binding') {
		if (!isFiniteEpochMs(decision.decidedAtEpochMs)) {
			return false;
		}
		return isNonEmptyString(decision.detail);
	}
	if (decision.kind !== 'decided') {
		return false;
	}
	if (
		!isNonEmptyString(decision.scopeId)
		|| !isNonEmptyString(decision.adapterId)
		|| !isNonEmptyString(decision.providerEntryId)
	) {
		return false;
	}
	if (!isUsageClass(decision.usageClass)) {
		return false;
	}
	if (!isProviderTermState(decision.termsState)) {
		return false;
	}
	if (!isTermEligibilityVerdict(decision.verdict)) {
		return false;
	}
	if (verdictForTermState(decision.termsState) !== decision.verdict) {
		// THE HONEST-UNKNOWN ELIGIBILITY LAW, made structural: the verdict is
		// the total fold of the term state - an 'unknown' term state can never
		// carry an 'eligible' verdict.
		return false;
	}
	if (!isProviderMetadataVerification(decision.metadataVerification)) {
		return false;
	}
	if (!isFiniteEpochMs(decision.decidedAtEpochMs)) {
		return false;
	}
	const provenanceAdmission = admitProvenance(decision.provenance);
	if (!provenanceAdmission.admitted) {
		return false;
	}
	const provenance = provenanceAdmission.provenance;
	if (
		provenance.requestedProviderId !== decision.providerEntryId
		|| provenance.actualProviderId !== decision.providerEntryId
		|| provenance.requestedModelId !== ISOLATION_ELIGIBILITY_PROBE_SCOPE
		|| provenance.actualModelId !== ISOLATION_ELIGIBILITY_PROBE_SCOPE
		|| provenance.substitution !== 'none'
	) {
		// The derived provenance names the bound provider on both sides with
		// the probe scope label - derived from the bound records, never a
		// parallel shape (no substitution is representable).
		return false;
	}
	return provenance.recordedAtEpochMs === decision.decidedAtEpochMs;
}

/**
 * The canonical provenance object: the landed fixed key order (the
 * adapter family's canonicalProvenanceObject idiom, cited - never
 * re-derived semantics).
 */
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

/** The bound adapter lookup: the scope's adapter binding resolution. */
function findAdapter(
	adapters: ProviderAdapterRecord,
	adapterId: string,
): ProviderAdapterDescriptor | undefined {
	for (const adapter of adapters.adapters) {
		if (adapter.adapterId === adapterId) {
			return adapter;
		}
	}
	return undefined;
}

/** The catalog binding check: the adapter's providerEntryId resolution. */
function carriesEntry(catalog: ProviderCatalogRecord, providerEntryId: string): boolean {
	const index = catalogIndexById(catalog);
	return Object.prototype.hasOwnProperty.call(index, providerEntryId);
}

/**
 * The landed provider-term-state membership check, riding the imported
 * PROVIDER_TERM_STATES list verbatim - never a re-implementation.
 */
function isProviderTermState(value: unknown): value is ProviderTermState {
	return (PROVIDER_TERM_STATES as readonly string[]).includes(value as string);
}

/**
 * The landed provider-metadata verification membership check, riding
 * the imported PROVIDER_METADATA_VERIFICATIONS list verbatim - never a
 * re-implementation.
 */
function isProviderMetadataVerification(value: unknown): value is ProviderMetadataVerification {
	return (PROVIDER_METADATA_VERIFICATIONS as readonly string[]).includes(value as string);
}

function isTermEligibilityVerdict(value: unknown): value is TermEligibilityVerdict {
	return (TERM_ELIGIBILITY_VERDICTS as readonly string[]).includes(value as string);
}

function reject(reason: IsolationRejectionReason, detail: string): ScopeRejected {
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
