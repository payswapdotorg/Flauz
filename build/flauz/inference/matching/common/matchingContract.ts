/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-006 Free Inference Fabric contracts: the typed
 * context-window/capability MATCHING family - the closed vocabulary
 * for matching a token/modalities/output-cap request against the
 * bound adapter record's entries, through each entry's
 * providerEntryId the bound capability matrix descriptors (the
 * matrix walk), with every match decision DISCLOSED, never silently
 * substituted (contract module, the labContracts discipline; binds
 * the landed INF-001..005 family vocabularies verbatim, never
 * re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..005 family laws are INHERITED and binding here):
 * - THE DISCLOSURE LAW (binding, this family's own): match decisions
 *   are DISCLOSED, never silently substituted. A fallback selection
 *   IS a substitution and carries the landed SubstitutionState
 *   vocabulary ('none' when the selected candidate is the ranked
 *   top, 'disclosed' when it is not); the matched state is disclosed
 *   THROUGH the landed projection vocabulary (the derived
 *   InferenceProvenance, admitted by the landed admitProvenance),
 *   never a parallel shape.
 * - THE SAFETY LAW (binding, the INF workstream's): no shared public
 *   Flauz gateway pooling third-party free-tier keys. Pure matching
 *   vocabulary over user-declared entries; NO network I/O
 *   (live-provider acceptance is INF-009, never here). Match shapes
 *   carry NO credential material, no endpoints, no urls.
 * - THE NO-DANGLING-REF LAW (binding, extended to matching): every
 *   match entry's adapter binding resolves in the bound adapter
 *   record; through the adapter's providerEntryId the capability
 *   descriptor resolves in the bound capability matrix record; every
 *   catalog binding resolves in the bound catalog record - or
 *   admission is a typed rejection, never a dangling ref.
 * - FROZEN REJECTION VOCABULARIES, FIRST-FAILURE-IS-THE-VERDICT
 *   (binding): every admission rejection is a typed member of the
 *   frozen MATCHING_REJECTION_REASONS list, in the exact check
 *   order; the first failing check is THE verdict, and every
 *   rejection names its reason.
 * - THE PROVENANCE-DERIVATION LAW (binding): provenance is DERIVED
 *   from the bound records, never caller-supplied. A
 *   caller-supplied provenance or substitution label on a match
 *   request is a typed rejection ('caller-supplied-provenance').
 * - THE INCLUSIVE-BOUNDARY LAW (binding): context-window bounds are
 *   INCLUSIVE on both ends - the landed contextWindowContains
 *   predicate (the INF-002 discipline) is the authority on FITS in
 *   the kit's engine; a boundary-exact request FITS; one off each
 *   side is the honest too-small / too-large verdict. Never
 *   re-implemented, never widened here.
 * - Determinism: no Date.now, no Math.random, no process.env in this
 *   module (law comments excepted). All token counts are injected
 *   plain positive integers; all ids are injected plain strings.
 * - Vocabulary only: this module declares types, constants, pure
 *   guards and pure folds. It is not a runtime, not a network, not
 *   an event authority, not a second version declaration (the kit
 *   module re-carries THIS module's INFERENCE_MATCHING_VERSION; the
 *   battery pins both module copies equal).
 * - Canonical bytes: serializeMatchDecision / serializeMatchCandidate
 *   emit fixed-key-order deterministic bytes (double-run
 *   byte-equal); every persisted/audited top-level shape carries
 *   contractVersion; transient rejection verdicts carry reason +
 *   detail (the landed families' rejection idiom).
 * - Zero external dependencies: node: builtins (none needed) and
 *   the landed sibling families only.
 */
import { catalogIndexById } from '../../catalog/common/providerCatalog.js';
import type { ProviderCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { MODEL_MODALITIES } from '../../catalog/common/capabilityMatrix.js';
import type { CapabilityMatrixRecord, ModelModality } from '../../catalog/common/capabilityMatrix.js';
import type { ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { SUBSTITUTION_STATES, admitProvenance } from '../../semantics/common/capacityDisclosure.js';
import type { InferenceProvenance, SubstitutionState } from '../../semantics/common/capacityDisclosure.js';
import { ROUTING_SELECTION_RULES } from '../../routing/common/routingContract.js';
import type { RoutingSelectionRule } from '../../routing/common/routingContract.js';

/**
 * Version of the inference-matching contract set (this family's own
 * constant, declared ONCE here - the single version declaration law;
 * every matching-family persisted record carries it). The sibling
 * matchingKit module re-carries this same declaration (re-exported;
 * the battery pins both module copies equal). The vocabulary INSIDE
 * the records is the landed families', bound verbatim and never
 * re-implemented: modality verdicts ride the INF-002 catalog
 * family's MODEL_MODALITIES vocabulary, adapter bindings are the
 * INF-003 family's ProviderAdapterRecord entries, the substitution
 * disclosure rides the INF-001 semantics family's SubstitutionState,
 * and the routing binding rides the INF-005 family's
 * ROUTING_SELECTION_RULES. Those sub-records keep their own family
 * version stamps; the matching stamp and the landed stamps are
 * distinct roles pinned by the suite.
 */
export const INFERENCE_MATCHING_VERSION = '1.0.0';

/**
 * Closed frozen list of matching rejection reasons, in the exact
 * check order (each guard walks its applicable subset in this order;
 * the first failure is THE verdict):
 *   not-an-object                    - the candidate/request is not an
 *                                     object (both walks);
 *   version-mismatch                 - contractVersion must be
 *                                     INFERENCE_MATCHING_VERSION
 *                                     (entry and matrix walks);
 *   invalid-matrix-id                - matrixId is not a non-empty
 *                                     string (matrix walk);
 *   invalid-entries                  - entries is not an array
 *                                     (matrix walk);
 *   invalid-entry                     - an entry fails the entry walk
 *                                     (matrix walk; the entry walk's
 *                                     own reason surfaces verbatim in
 *                                     the detail);
 *   invalid-match-entry-id           - id is not a non-empty string
 *                                     (entry walk);
 *   invalid-adapter-id               - adapterId is not a non-empty
 *                                     string (entry walk, shape
 *                                     level - before resolution);
 *   invalid-declared-priority        - declaredPriority, when
 *                                     present, is not a finite
 *                                     number (entry walk);
 *   unresolved-adapter-binding       - THE NO-DANGLING-REF LAW: the
 *                                     entry's adapterId resolves to
 *                                     no adapter in the bound
 *                                     adapter record (entry walk);
 *   unresolved-catalog-entry         - THE NO-DANGLING-REF LAW: the
 *                                     bound adapter's providerEntryId
 *                                     resolves to no entry in the
 *                                     bound catalog record (entry
 *                                     walk);
 *   unresolved-capability-descriptor - THE NO-DANGLING-REF LAW: the
 *                                     bound adapter's providerEntryId
 *                                     resolves to no descriptor in
 *                                     the bound capability matrix
 *                                     record (entry walk);
 *   duplicate-match-entry-id         - THE DUPLICATE LAW at the
 *                                     matrix fold: a repeated entry
 *                                     id inside a candidate matrix
 *                                     record, never a silent
 *                                     overwrite (the kit's own
 *                                     registered-set duplicate is
 *                                     the kit-level
 *                                     'matching-entry-duplicate'
 *                                     addition);
 *   invalid-context-tokens           - contextTokens is not a
 *                                     positive integer (request
 *                                     walk);
 *   invalid-request-modalities       - modalities, when present, is
 *                                     not a non-empty array drawn
 *                                     from the landed closed
 *                                     vocabulary (request walk; an
 *                                     empty modalities set is
 *                                     malformed - the request asks
 *                                     for nothing);
 *   invalid-output-cap               - outputCapTokens, when present,
 *                                     is not a positive integer
 *                                     (request walk; a negative or
 *                                     zero output cap is malformed);
 *   invalid-request-tag              - requestTag, when present, is
 *                                     not a non-empty string
 *                                     (request walk);
 *   caller-supplied-provenance       - THE PROVENANCE-DERIVATION
 *                                     LAW: a caller-supplied
 *                                     provenance or substitution
 *                                     label on a match request is a
 *                                     typed rejection - provenance is
 *                                     DERIVED from the bound
 *                                     records, never supplied.
 */
export const MATCHING_REJECTION_REASONS = [
	'not-an-object',
	'version-mismatch',
	'invalid-matrix-id',
	'invalid-entries',
	'invalid-entry',
	'invalid-match-entry-id',
	'invalid-adapter-id',
	'invalid-declared-priority',
	'unresolved-adapter-binding',
	'unresolved-catalog-entry',
	'unresolved-capability-descriptor',
	'duplicate-match-entry-id',
	'invalid-context-tokens',
	'invalid-request-modalities',
	'invalid-output-cap',
	'invalid-request-tag',
	'caller-supplied-provenance',
] as const;
export type MatchingRejectionReason = (typeof MATCHING_REJECTION_REASONS)[number];

/** Typed rejection: closed reason, detail names the violation. */
export interface MatchingRejected {
	readonly admitted: false;
	readonly reason: MatchingRejectionReason;
	readonly detail: string;
}

/**
 * The typed match request: what the caller asks for - a context
 * size in tokens, optionally the modalities the request requires,
 * optionally an output cap, optionally a request tag. NO credential
 * material, NO endpoints, NO urls (the safety law). The optional
 * fields are honest: absent modalities means no modality
 * requirement; absent output cap means no output-cap requirement.
 */
export interface MatchRequestDescriptor {
	readonly contextTokens: number;
	readonly modalities?: readonly ModelModality[];
	readonly outputCapTokens?: number;
	readonly requestTag?: string;
}

/** The admitted request side of the request walk. */
export interface MatchRequestAdmitted {
	readonly admitted: true;
	readonly request: MatchRequestDescriptor;
}

export type MatchRequestAdmission = MatchRequestAdmitted | MatchingRejected;

/**
 * Pure fail-closed request guard (the request walk of the frozen
 * list): contextTokens must be a positive integer; modalities, when
 * present, must be a non-empty array drawn from the landed
 * MODEL_MODALITIES vocabulary (canonicalized into the closed order
 * on admission); outputCapTokens, when present, must be a positive
 * integer; requestTag, when present, must be a non-empty string; a
 * caller-supplied 'provenance' or 'substitution' field is the typed
 * provenance-substitution rejection (provenance is derived from the
 * bound records). Deterministic: same candidate, same verdict, same
 * reason and detail. Never mutates its input.
 */
export function admitMatchRequest(candidate: unknown): MatchRequestAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contextTokens = record.contextTokens;
	if (!isPositiveInteger(contextTokens)) {
		return reject(
			'invalid-context-tokens',
			'contextTokens must be a positive integer (fractional, zero or negative token counts are rejected)',
		);
	}
	let modalities: readonly ModelModality[] | undefined;
	if (record.modalities !== undefined) {
		const modalitiesInput = record.modalities;
		if (!Array.isArray(modalitiesInput)) {
			return reject(
				'invalid-request-modalities',
				'modalities, when present, must be a non-empty array drawn from the landed closed vocabulary',
			);
		}
		if (modalitiesInput.length === 0) {
			return reject(
				'invalid-request-modalities',
				'modalities, when present, must be a non-empty set - a request asking for zero modalities is malformed',
			);
		}
		for (const modality of modalitiesInput) {
			if (!isModelModality(modality)) {
				return reject(
					'invalid-request-modalities',
					`modalities must be drawn from the closed vocabulary ${MODEL_MODALITIES.join('/')}, got '${String(modality)}'`,
				);
			}
		}
		// Canonical set form: the closed vocabulary's own order, duplicates
		// collapsed. Insertion order is not semantic and never reaches the
		// canonical bytes.
		modalities = MODEL_MODALITIES.filter((modality) =>
			(modalitiesInput as readonly unknown[]).includes(modality),
		);
	}
	let outputCapTokens: number | undefined;
	if (record.outputCapTokens !== undefined) {
		const outputCapInput = record.outputCapTokens;
		if (!isPositiveInteger(outputCapInput)) {
			return reject(
				'invalid-output-cap',
				'outputCapTokens, when present, must be a positive integer (a negative or zero output cap is rejected)',
			);
		}
		outputCapTokens = outputCapInput;
	}
	let requestTag: string | undefined;
	if (record.requestTag !== undefined) {
		const tagInput = record.requestTag;
		if (!isNonEmptyString(tagInput)) {
			return reject('invalid-request-tag', 'requestTag, when present, must be a non-empty string');
		}
		requestTag = tagInput;
	}
	if (
		Object.prototype.hasOwnProperty.call(record, 'provenance')
		|| Object.prototype.hasOwnProperty.call(record, 'substitution')
	) {
		// THE PROVENANCE-DERIVATION LAW: provenance (and its substitution
		// label) is derived from the bound records at decision time -
		// never supplied by the caller.
		return reject(
			'caller-supplied-provenance',
			'a match request carries no provenance or substitution label - provenance is derived from the bound records, never caller-supplied',
		);
	}
	const admittedRequest: MatchRequestDescriptor = {
		contextTokens,
		...(modalities !== undefined ? { modalities } : {}),
		...(outputCapTokens !== undefined ? { outputCapTokens } : {}),
		...(requestTag !== undefined ? { requestTag } : {}),
	};
	return { admitted: true, request: admittedRequest };
}

/**
 * The typed match candidate: one user-declared match entry binding
 * the INF-003 adapter record through adapterId (a plain id reference
 * - NO credential material, no endpoint, no url), with an optional
 * declared priority (a finite number; the ranking's first key).
 * Through the bound adapter's providerEntryId the INF-002 capability
 * descriptor binding resolves in the bound capability matrix record
 * (the matrix walk - the no-dangling-ref law). Carries the matching
 * contract-set version stamp.
 */
export interface MatchCandidateDescriptor {
	readonly id: string;
	readonly adapterId: string;
	readonly declaredPriority?: number;
	readonly contractVersion: string;
}

/**
 * The typed match matrix record: the named collection of match
 * entries (the catalog-record shape). Entry ids are unique inside a
 * record (admission-enforced). Carries the matching contract-set
 * version stamp.
 */
export interface MatchMatrixRecord {
	readonly matrixId: string;
	readonly entries: readonly MatchCandidateDescriptor[];
	readonly contractVersion: string;
}

/** The admitted entry side of the entry walk. */
export interface MatchCandidateAdmitted {
	readonly admitted: true;
	readonly entry: MatchCandidateDescriptor;
}

export type MatchCandidateAdmission = MatchCandidateAdmitted | MatchingRejected;

/** The admitted matrix side of the matrix walk. */
export interface MatchMatrixAdmitted {
	readonly admitted: true;
	readonly matrix: MatchMatrixRecord;
}

export type MatchMatrixAdmission = MatchMatrixAdmitted | MatchingRejected;

/**
 * Pure fail-closed entry guard (the entry walk of the frozen list):
 * shape checks first (the landed kit idiom), then the
 * no-dangling-ref chain - the entry's adapter binding resolves in
 * the bound adapter record; through the bound adapter's
 * providerEntryId the catalog binding resolves in the bound catalog
 * record; the capability descriptor binding resolves in the bound
 * capability matrix record. The bound records are taken as the
 * landed admitted shapes (typed arguments; the kit validates them
 * through the landed guards at creation, and the battery fires the
 * dangling reasons here with cross-inconsistent hand-built records).
 * Deterministic; never mutates its input.
 */
export function admitMatchCandidate(
	candidate: unknown,
	adapters: ProviderAdapterRecord,
	matrix: CapabilityMatrixRecord,
	catalog: ProviderCatalogRecord,
): MatchCandidateAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_MATCHING_VERSION) {
		return reject(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_MATCHING_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const id = record.id;
	if (!isNonEmptyString(id)) {
		return reject('invalid-match-entry-id', 'id must be a non-empty string');
	}
	const adapterId = record.adapterId;
	if (!isNonEmptyString(adapterId)) {
		return reject(
			'invalid-adapter-id',
			'adapterId must be a non-empty string (a plain id reference, never credential material)',
		);
	}
	const declaredPriorityInput = record.declaredPriority;
	let declaredPriority: number | undefined;
	if (declaredPriorityInput !== undefined) {
		if (!isFiniteNumber(declaredPriorityInput)) {
			return reject('invalid-declared-priority', 'declaredPriority, when present, must be a finite number');
		}
		declaredPriority = declaredPriorityInput;
	}
	const adapter = findAdapter(adapters, adapterId);
	if (adapter === undefined) {
		// THE NO-DANGLING-REF LAW: the entry's adapter binding never
		// dangles.
		return reject(
			'unresolved-adapter-binding',
			`the entry's adapterId '${adapterId}' resolves to no adapter in the bound adapter record - a dangling adapter reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const providerEntryId = adapter.providerEntryId;
	if (!carriesEntry(catalog, providerEntryId)) {
		// THE NO-DANGLING-REF LAW: the catalog binding through the
		// adapter's providerEntryId never dangles.
		return reject(
			'unresolved-catalog-entry',
			`adapter '${adapterId}' references providerEntryId '${providerEntryId}' which the bound catalog does not carry - a dangling catalog reference is a typed rejection, never a silent dangling ref`,
		);
	}
	if (!carriesDescriptor(matrix, providerEntryId)) {
		// THE NO-DANGLING-REF LAW: the capability descriptor binding
		// through the adapter's providerEntryId never dangles.
		return reject(
			'unresolved-capability-descriptor',
			`adapter '${adapterId}' references providerEntryId '${providerEntryId}' which the bound capability matrix carries no descriptor for - a dangling capability reference is a typed rejection, never a silent dangling ref`,
		);
	}
	const admittedEntry: MatchCandidateDescriptor = {
		id,
		adapterId,
		...(declaredPriority !== undefined ? { declaredPriority } : {}),
		contractVersion,
	};
	return { admitted: true, entry: admittedEntry };
}

/**
 * Pure fail-closed matrix guard (the matrix walk of the frozen
 * list): every entry must pass admitMatchCandidate against the SAME
 * bound records (its own rejection surfaces verbatim in the detail)
 * and ENTRY IDS ARE UNIQUE inside the record - a duplicate is a
 * typed rejection, never a silent overwrite. Deterministic; never
 * mutates its input.
 */
export function admitMatchMatrix(
	candidate: unknown,
	adapters: ProviderAdapterRecord,
	matrix: CapabilityMatrixRecord,
	catalog: ProviderCatalogRecord,
): MatchMatrixAdmission {
	if (!isRecord(candidate)) {
		return reject('not-an-object', 'candidate must be a non-null object');
	}
	const record = candidate as Record<string, unknown>;
	const contractVersion = record.contractVersion;
	if (contractVersion !== INFERENCE_MATCHING_VERSION) {
		return reject(
			'version-mismatch',
			`contractVersion must be '${INFERENCE_MATCHING_VERSION}', got '${String(contractVersion)}'`,
		);
	}
	const matrixId = record.matrixId;
	if (!isNonEmptyString(matrixId)) {
		return reject('invalid-matrix-id', 'matrixId must be a non-empty string');
	}
	const entries = record.entries;
	if (!Array.isArray(entries)) {
		return reject('invalid-entries', 'entries must be an array of match candidate descriptors');
	}
	const admittedEntries: MatchCandidateDescriptor[] = [];
	const seenEntryIds = new Set<string>();
	for (let index = 0; index < entries.length; index++) {
		const entryAdmission = admitMatchCandidate(entries[index], adapters, matrix, catalog);
		if (!entryAdmission.admitted) {
			return reject(
				'invalid-entry',
				`entries[${index}] must satisfy admitMatchCandidate: '${entryAdmission.reason}': ${entryAdmission.detail}`,
			);
		}
		const entry = entryAdmission.entry;
		if (seenEntryIds.has(entry.id)) {
			// THE DUPLICATE LAW at the matrix fold: a repeat is a typed
			// rejection - the matrix never silently overwrites.
			return reject(
				'duplicate-match-entry-id',
				`entries[${index}] repeats id '${entry.id}' - a match entry id is unique inside a matrix record, never a silent overwrite`,
			);
		}
		seenEntryIds.add(entry.id);
		admittedEntries.push(entry);
	}
	return {
		admitted: true,
		matrix: { matrixId, entries: admittedEntries, contractVersion },
	};
}

/**
 * Closed frozen verdict vocabulary - the per-candidate typed verdict
 * values (each walked (entry, model) pair carries one verdict per
 * dimension, plus the honest-unknown row kind):
 *   context-fits / context-too-small / context-too-large
 *     - the context-window verdict, INCLUSIVE bounds through the
 *       landed contextWindowContains discipline (a boundary-exact
 *       request FITS; one off each side is the honest verdict);
 *   modalities-covered / modalities-missing
 *     - the modality coverage verdict (missing modalities are
 *       listed in the closed frozen modality set's own order);
 *   output-cap-fits / output-cap-exceeded
 *     - the output-cap verdict;
 *   capability-unknown
 *     - the honest-unknown row: an entry whose capability descriptor
 *       is absent/unresolvable is disclosed as an honest-unknown row,
 *       never silently dropped, never fabricated.
 */
export const MATCH_VERDICTS = [
	'context-fits',
	'context-too-small',
	'context-too-large',
	'modalities-covered',
	'modalities-missing',
	'output-cap-fits',
	'output-cap-exceeded',
	'capability-unknown',
] as const;
export type MatchingVerdict = (typeof MATCH_VERDICTS)[number];

/** The context-window verdict values (the inclusive-boundary law). */
export const CONTEXT_WINDOW_VERDICTS = ['context-fits', 'context-too-small', 'context-too-large'] as const;
export type ContextWindowVerdict = (typeof CONTEXT_WINDOW_VERDICTS)[number];

/** The modality coverage verdict values. */
export const MODALITY_COVERAGE_VERDICTS = ['modalities-covered', 'modalities-missing'] as const;
export type ModalityCoverageVerdict = (typeof MODALITY_COVERAGE_VERDICTS)[number];

/** The output-cap verdict values. */
export const OUTPUT_CAP_VERDICTS = ['output-cap-fits', 'output-cap-exceeded'] as const;
export type OutputCapVerdict = (typeof OUTPUT_CAP_VERDICTS)[number];

/**
 * One honest verdict row for one walked (entry, model) pair: the
 * entry id, the adapter binding, the provider binding through the
 * adapter's providerEntryId, the model id, and the three typed
 * verdicts (context window, modality coverage with the missing list
 * in the closed vocabulary's own order, output cap). admissible is
 * the derived conjunction (all three verdicts fit); an inadmissible
 * row is recorded honestly, never silently dropped.
 */
export interface MatchCandidateVerdictRow {
	readonly kind: 'candidate';
	readonly entryId: string;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly modelId: string;
	readonly contextWindowVerdict: ContextWindowVerdict;
	readonly modalityCoverageVerdict: ModalityCoverageVerdict;
	readonly missingModalities: readonly ModelModality[];
	readonly outputCapVerdict: OutputCapVerdict;
	readonly admissible: boolean;
}

/**
 * The honest-unknown row: an entry whose capability descriptor is
 * absent/unresolvable in the bound capability matrix record is
 * disclosed as unknown - never silently dropped, never fabricated.
 * Unreachable through kit registration (the no-dangling-ref law
 * admits only entries whose descriptor resolves); the engine emits
 * it defensively and the shape is a first-class member of the
 * verdict vocabulary.
 */
export interface MatchUnknownDescriptorRow {
	readonly kind: 'unknown-descriptor';
	readonly entryId: string;
	readonly adapterId: string;
}

export type MatchVerdictRow = MatchCandidateVerdictRow | MatchUnknownDescriptorRow;

/**
 * One ranked admissible candidate: the (entry, model) pair that fit,
 * in the deterministic rank order - declaredPriority ascending
 * (undeclared priority rides the honest 0 default), ties by entry id
 * ascending, then by model id ascending (the byte-stability
 * tie-break when one entry's provider offers multiple fitting
 * models). rank is 1-based. priority is the effective rank key.
 */
export interface MatchRankedCandidate {
	readonly rank: number;
	readonly entryId: string;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly modelId: string;
	readonly priority: number;
}

/**
 * The selected candidate identity: the (entry, model) pair the
 * decision serves, with its adapter binding (the routing binding
 * names the same adapterId) and provider binding.
 */
export interface MatchSelectedCandidate {
	readonly entryId: string;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly modelId: string;
}

/**
 * The routing binding (the binder-map law): the matched decision
 * carries the RoutingDecision's adapterId discipline - the selected
 * candidate's adapterId, plus the routing selection rule the match
 * ranks within or above (the landed ROUTING_SELECTION_RULES
 * vocabulary, imported verbatim - never a parallel shape).
 */
export interface MatchRoutingBinding {
	readonly adapterId: string;
	readonly selectionRule: RoutingSelectionRule;
}

/**
 * The typed match decision, matched side (the DISCLOSED match
 * decision): the full honest verdict rows (every walked pair, never
 * a silent drop), the ranked admissible candidates, the selected
 * candidate, the substitution disclosure riding the landed
 * SubstitutionState ('none' when the selected candidate is the
 * ranked top, 'disclosed' when it is not - never silent), the
 * derived InferenceProvenance (built by the kit through the landed
 * unverifiedProvenance constructor; provenance is DERIVED from the
 * bound records), and the routing binding. decidedAtEpochMs is the
 * injected decision instant and MUST equal the provenance's own
 * recordedAtEpochMs (one decision, one time). Carries the matching
 * contract-set version stamp.
 */
export interface MatchDecisionMatched {
	readonly kind: 'matched';
	readonly contractVersion: string;
	readonly request: MatchRequestDescriptor;
	readonly decidedAtEpochMs: number;
	readonly rows: readonly MatchVerdictRow[];
	readonly ranked: readonly MatchRankedCandidate[];
	readonly selected: MatchSelectedCandidate;
	readonly substitution: SubstitutionState;
	readonly provenance: InferenceProvenance;
	readonly routing: MatchRoutingBinding;
}

/**
 * The typed match decision, no-match side: zero admissible
 * candidates - the typed refusal, never an exception, never a
 * fabricated match. Carries the FULL honest verdict rows (every
 * walked pair with its honest verdicts - never a silent empty) and
 * no selection, no provenance, no routing binding (nothing is
 * fabricated). Carries the matching contract-set version stamp.
 */
export interface MatchDecisionNoMatch {
	readonly kind: 'no-matching-candidate';
	readonly contractVersion: string;
	readonly request: MatchRequestDescriptor;
	readonly decidedAtEpochMs: number;
	readonly rows: readonly MatchVerdictRow[];
}

export type MatchDecisionRecord = MatchDecisionMatched | MatchDecisionNoMatch;

/**
 * The typed outcome of a match call: a decision record (matched or
 * the no-matching-candidate refusal) or the typed request rejection
 * (a frozen-list reason; fail-closed, never an exception - the
 * request walk's verdict).
 */
export type MatchOutcome = MatchDecisionRecord | MatchingRequestRejected;

/** The typed request rejection: closed reason, detail names the violation. */
export interface MatchingRequestRejected {
	readonly kind: 'request-rejected';
	readonly reason: MatchingRejectionReason;
	readonly detail: string;
}

/**
 * Canonical serialization of a match decision (either side): fixed
 * key order, deterministic bytes regardless of the input record's
 * key insertion order. The provenance sub-record mirrors the landed
 * canonical provenance key order (the adapter family's cited idiom -
 * contractVersion, requestedProviderId, requestedModelId,
 * actualProviderId, actualModelId, substitution, modelVerification,
 * recordedAtEpochMs). Refuses non-admitted decisions fail-closed
 * (TypeError) - no dishonest decision ever gets canonical bytes.
 * This canonical form is the persistence/audit shape for the
 * INF-007..009 binders (INF-008's UI renders it).
 */
export function serializeMatchDecision(decision: unknown): string {
	if (!isMatchDecisionRecord(decision)) {
		throw new TypeError(
			'serializeMatchDecision: decision must satisfy isMatchDecisionRecord - no dishonest match decision ever gets canonical bytes',
		);
	}
	if (decision.kind === 'no-matching-candidate') {
		return JSON.stringify({
			kind: decision.kind,
			contractVersion: decision.contractVersion,
			request: canonicalRequestObject(decision.request),
			decidedAtEpochMs: decision.decidedAtEpochMs,
			rows: decision.rows.map((row) => canonicalRowObject(row)),
		});
	}
	return JSON.stringify({
		kind: decision.kind,
		contractVersion: decision.contractVersion,
		request: canonicalRequestObject(decision.request),
		decidedAtEpochMs: decision.decidedAtEpochMs,
		rows: decision.rows.map((row) => canonicalRowObject(row)),
		ranked: decision.ranked.map((candidate) => ({
			rank: candidate.rank,
			entryId: candidate.entryId,
			adapterId: candidate.adapterId,
			providerEntryId: candidate.providerEntryId,
			modelId: candidate.modelId,
			priority: candidate.priority,
		})),
		selected: {
			entryId: decision.selected.entryId,
			adapterId: decision.selected.adapterId,
			providerEntryId: decision.selected.providerEntryId,
			modelId: decision.selected.modelId,
		},
		substitution: decision.substitution,
		provenance: canonicalProvenanceObject(decision.provenance),
		routing: {
			adapterId: decision.routing.adapterId,
			selectionRule: decision.routing.selectionRule,
		},
	});
}

/**
 * Canonical serialization of a match candidate (a match entry): fixed
 * key order (id, adapterId, declaredPriority when present,
 * contractVersion), deterministic bytes regardless of the input
 * record's key insertion order. Refuses non-admitted candidates
 * fail-closed (TypeError) - no dishonest entry ever gets canonical
 * bytes. This canonical form is the persistence/audit shape for the
 * INF-007..009 binders.
 */
export function serializeMatchCandidate(candidate: unknown): string {
	if (!isMatchCandidateDescriptor(candidate)) {
		throw new TypeError(
			'serializeMatchCandidate: candidate must satisfy isMatchCandidateDescriptor - no dishonest match entry ever gets canonical bytes',
		);
	}
	const canonical: Record<string, unknown> = {
		id: candidate.id,
		adapterId: candidate.adapterId,
	};
	if (candidate.declaredPriority !== undefined) {
		canonical.declaredPriority = candidate.declaredPriority;
	}
	canonical.contractVersion = candidate.contractVersion;
	return JSON.stringify(canonical);
}

/**
 * Pure shape predicate: an admitted, well-formed match request (the
 * request walk, both directions).
 */
export function isMatchRequestDescriptor(value: unknown): value is MatchRequestDescriptor {
	return admitMatchRequest(value).admitted;
}

/**
 * Pure shape predicate: an admitted, well-formed match entry,
 * checked through the same entry walk's SHAPE checks WITHOUT the
 * bound records (a plain shape check; the no-dangling-ref chain is
 * the caller-bound law of admitMatchCandidate, mirroring the landed
 * isProviderAdapterRecord scope note).
 */
export function isMatchCandidateDescriptor(value: unknown): value is MatchCandidateDescriptor {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.contractVersion !== INFERENCE_MATCHING_VERSION) {
		return false;
	}
	if (!isNonEmptyString(record.id)) {
		return false;
	}
	if (!isNonEmptyString(record.adapterId)) {
		return false;
	}
	const declaredPriority = record.declaredPriority;
	if (declaredPriority !== undefined && !isFiniteNumber(declaredPriority)) {
		return false;
	}
	return true;
}

/**
 * Pure shape guard: a well-formed, version-stamped match decision
 * (either side). The matched side additionally pins the internal
 * consistency laws: the selected candidate is a member of the ranked
 * list; the substitution label is 'none' exactly when the selected
 * candidate is the ranked top (the no-hidden-substitution law made
 * structural); the derived provenance satisfies the landed
 * admitProvenance and names the ranked top as requested and the
 * selected candidate as actual, with the same substitution label and
 * the same recording instant as the decision's own
 * decidedAtEpochMs (one decision, one time); the routing binding
 * names the selected candidate's adapterId with a selection rule
 * drawn from the landed ROUTING_SELECTION_RULES. Fails closed on
 * every malformed path; never reads a clock; never mutates its
 * input.
 */
export function isMatchDecisionRecord(value: unknown): value is MatchDecisionRecord {
	if (!isRecord(value)) {
		return false;
	}
	const decision = value as Record<string, unknown>;
	if (decision.contractVersion !== INFERENCE_MATCHING_VERSION) {
		return false;
	}
	if (decision.kind === 'no-matching-candidate') {
		if (!isAdmittedRequest(decision.request)) {
			return false;
		}
		if (!isFiniteNumber(decision.decidedAtEpochMs)) {
			return false;
		}
		return areWellFormedRows(decision.rows);
	}
	if (decision.kind !== 'matched') {
		return false;
	}
	if (!isAdmittedRequest(decision.request)) {
		return false;
	}
	if (!isFiniteNumber(decision.decidedAtEpochMs)) {
		return false;
	}
	if (!areWellFormedRows(decision.rows)) {
		return false;
	}
	if (!Array.isArray(decision.ranked) || decision.ranked.length === 0) {
		return false;
	}
	let top: MatchRankedCandidate | undefined;
	for (let index = 0; index < decision.ranked.length; index++) {
		const candidate = decision.ranked[index];
		if (!isRecord(candidate)) {
			return false;
		}
		if (!isPositiveInteger(candidate.rank) || candidate.rank !== index + 1) {
			return false;
		}
		if (
			!isNonEmptyString(candidate.entryId)
			|| !isNonEmptyString(candidate.adapterId)
			|| !isNonEmptyString(candidate.providerEntryId)
			|| !isNonEmptyString(candidate.modelId)
			|| !isFiniteNumber(candidate.priority)
		) {
			return false;
		}
		if (index === 0) {
			top = candidate as unknown as MatchRankedCandidate;
		}
	}
	if (top === undefined) {
		return false;
	}
	const selected = decision.selected;
	if (!isRecord(selected)) {
		return false;
	}
	if (
		!isNonEmptyString(selected.entryId)
		|| !isNonEmptyString(selected.adapterId)
		|| !isNonEmptyString(selected.providerEntryId)
		|| !isNonEmptyString(selected.modelId)
	) {
		return false;
	}
	const selectedIsTop = selected.entryId === top.entryId && selected.modelId === top.modelId;
	const substitution = decision.substitution;
	if (!isSubstitutionState(substitution)) {
		return false;
	}
	if (substitution === 'none' !== selectedIsTop) {
		// THE NO-HIDDEN-SUBSTITUTION LAW, made structural: 'none'
		// exactly when the selected candidate is the ranked top.
		return false;
	}
	const provenance = decision.provenance;
	const provenanceAdmission = admitProvenance(provenance);
	if (!provenanceAdmission.admitted) {
		return false;
	}
	const derived = provenanceAdmission.provenance;
	if (
		derived.requestedProviderId !== top.providerEntryId
		|| derived.requestedModelId !== top.modelId
		|| derived.actualProviderId !== selected.providerEntryId
		|| derived.actualModelId !== selected.modelId
	) {
		// The derived provenance names the ranked top as requested and
		// the selected candidate as actual - derived from the bound
		// records, never a parallel shape.
		return false;
	}
	if (derived.substitution !== substitution || derived.recordedAtEpochMs !== decision.decidedAtEpochMs) {
		return false;
	}
	const routing = decision.routing;
	if (!isRecord(routing)) {
		return false;
	}
	if (!isNonEmptyString(routing.adapterId) || !isRoutingSelectionRule(routing.selectionRule)) {
		return false;
	}
	return routing.adapterId === selected.adapterId;
}

/** The canonical request object: fixed key order, present optionals only. */
function canonicalRequestObject(request: MatchRequestDescriptor): Record<string, unknown> {
	const canonical: Record<string, unknown> = { contextTokens: request.contextTokens };
	if (request.modalities !== undefined) {
		canonical.modalities = [...request.modalities];
	}
	if (request.outputCapTokens !== undefined) {
		canonical.outputCapTokens = request.outputCapTokens;
	}
	if (request.requestTag !== undefined) {
		canonical.requestTag = request.requestTag;
	}
	return canonical;
}

/** The canonical row object: fixed key order per row kind. */
function canonicalRowObject(row: MatchVerdictRow): Record<string, unknown> {
	if (row.kind === 'unknown-descriptor') {
		return { kind: row.kind, entryId: row.entryId, adapterId: row.adapterId };
	}
	return {
		kind: row.kind,
		entryId: row.entryId,
		adapterId: row.adapterId,
		providerEntryId: row.providerEntryId,
		modelId: row.modelId,
		contextWindowVerdict: row.contextWindowVerdict,
		modalityCoverageVerdict: row.modalityCoverageVerdict,
		missingModalities: [...row.missingModalities],
		outputCapVerdict: row.outputCapVerdict,
		admissible: row.admissible,
	};
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

/** The request echo check: the admitted canonical request shape. */
function isAdmittedRequest(value: unknown): value is MatchRequestDescriptor {
	return admitMatchRequest(value).admitted;
}

/** The rows check: every row well-formed with closed-vocabulary verdicts. */
function areWellFormedRows(value: unknown): value is readonly MatchVerdictRow[] {
	if (!Array.isArray(value)) {
		return false;
	}
	for (const row of value) {
		if (!isRecord(row)) {
			return false;
		}
		if (row.kind === 'unknown-descriptor') {
			if (!isNonEmptyString(row.entryId) || !isNonEmptyString(row.adapterId)) {
				return false;
			}
			continue;
		}
		if (row.kind !== 'candidate') {
			return false;
		}
		if (
			!isNonEmptyString(row.entryId)
			|| !isNonEmptyString(row.adapterId)
			|| !isNonEmptyString(row.providerEntryId)
			|| !isNonEmptyString(row.modelId)
		) {
			return false;
		}
		if (!isContextWindowVerdict(row.contextWindowVerdict)) {
			return false;
		}
		if (!isModalityCoverageVerdict(row.modalityCoverageVerdict)) {
			return false;
		}
		if (!Array.isArray(row.missingModalities)) {
			return false;
		}
		for (const modality of row.missingModalities) {
			if (!isModelModality(modality)) {
				return false;
			}
		}
		if (!isOutputCapVerdict(row.outputCapVerdict)) {
			return false;
		}
		if (typeof row.admissible !== 'boolean') {
			return false;
		}
	}
	return true;
}

/** The bound adapter lookup: the entry's adapter binding resolution. */
function findAdapter(
	adapters: ProviderAdapterRecord,
	adapterId: string,
): ProviderAdapterRecord['adapters'][number] | undefined {
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

/** The capability descriptor check: the provider's descriptor resolution. */
function carriesDescriptor(matrix: CapabilityMatrixRecord, providerEntryId: string): boolean {
	for (const descriptor of matrix.descriptors) {
		if (descriptor.providerEntryId === providerEntryId) {
			return true;
		}
	}
	return false;
}

function isModelModality(value: unknown): value is ModelModality {
	return (MODEL_MODALITIES as readonly string[]).includes(value as string);
}

function isSubstitutionState(value: unknown): value is SubstitutionState {
	return (SUBSTITUTION_STATES as readonly string[]).includes(value as string);
}

function isRoutingSelectionRule(value: unknown): value is RoutingSelectionRule {
	return (ROUTING_SELECTION_RULES as readonly string[]).includes(value as string);
}

function isContextWindowVerdict(value: unknown): value is ContextWindowVerdict {
	return (CONTEXT_WINDOW_VERDICTS as readonly string[]).includes(value as string);
}

function isModalityCoverageVerdict(value: unknown): value is ModalityCoverageVerdict {
	return (MODALITY_COVERAGE_VERDICTS as readonly string[]).includes(value as string);
}

function isOutputCapVerdict(value: unknown): value is OutputCapVerdict {
	return (OUTPUT_CAP_VERDICTS as readonly string[]).includes(value as string);
}

function reject(reason: MatchingRejectionReason, detail: string): MatchingRejected {
	return { admitted: false, reason, detail };
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
