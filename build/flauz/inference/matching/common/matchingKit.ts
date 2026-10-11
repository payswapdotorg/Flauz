/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-006 Free Inference Fabric contracts: the typed deterministic
 * context-window/capability MATCHING kit - the fail-closed factory
 * over the bound adapter record, capability matrix and catalog
 * (validated through the landed family guards), match-entry
 * registration through the frozen rejection walk, the deterministic
 * disclosed ranking (declaredPriority ascending, ties by entry id
 * ascending, then model id ascending), the per-candidate typed
 * verdict rows with the INCLUSIVE context-window boundary math
 * (through the landed contextWindowContains), the derived
 * InferenceProvenance (through the landed unverifiedProvenance
 * constructor), the append-only JSONL decision ledger at the
 * caller-injected root, and the pure rank preview (kit module, the
 * labContracts discipline; binds the landed INF-001..005 family
 * vocabularies verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..005 family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a clock.
 *   Every timestamp - the decision instants and the derived
 *   provenance's recording instants - comes from the single
 *   injected now() function (one read per decision; one validation
 *   read at creation). No Date.now, no Math.random, no process.env
 *   in this module (law comments excepted).
 * - THE DISCLOSURE LAW (inherited, binding): every match decision
 *   carries the full honest verdict rows (every walked (entry,
 *   model) pair - inadmissible rows recorded, never silently
 *   dropped), the ranked admissible candidates, the selected
 *   candidate, and the substitution disclosure riding the landed
 *   SubstitutionState. THE TAG-PREFERENCE LAW (this kit's own
 *   reading of it): the request tag, when it names a REGISTERED
 *   entry, doubles as the caller's DISCLOSED preference - honored
 *   only when the named entry has an admissible pair, and a honored
 *   preference that is not the ranked top IS a disclosed
 *   substitution ('disclosed', requested = the ranked top, actual =
 *   the selected), never silent. An unknown or inadmissible tag is
 *   honestly ignored - the pure ranking stands.
 * - THE DELEGATED BOUNDARY MATH (binding): the context-window
 *   verdict rides the landed contextWindowContains (the INF-002
 *   discipline) - INCLUSIVE boundaries verbatim, never
 *   re-implemented, never widened. A boundary-exact request FITS;
 *   one off each side is the honest too-small / too-large verdict.
 * - THE DELEGATED PROVENANCE (binding): the derived provenance is
 *   built ONLY through the landed unverifiedProvenance constructor -
 *   'unverified' by construction, the substitution label derived by
 *   the landed constructor itself, never hand-built, never
 *   caller-supplied. Promotion is ONLY the landed
 *   markProvenanceVerified one-way law, exercised BY THE CALLER on
 *   the returned decision - the kit deliberately exposes no
 *   promotion mutator and never re-implements the promotion.
 * - THE NO-DANGLING-REF LAW (inherited, binding): the bound records
 *   are validated at creation through the LANDED guards
 *   (admitCatalogRecord, admitProviderAdapterRecord - which enforces
 *   every adapter's provider-entry resolution, and
 *   admitCapabilityMatrix - which enforces every descriptor's
 *   provider-entry resolution), so every registered entry's chain
 *   resolves by construction; register re-checks the chain through
 *   the contract fold all the same (belt and braces).
 * - THE DUPLICATE LAW: registering an entry id the kit already
 *   carries is the typed 'matching-entry-duplicate' rejection (the
 *   kit-level frozen addition) - never a silent overwrite. The
 *   contract guard runs FIRST: a candidate that is both malformed
 *   and a duplicate reports the contract reason, never the
 *   duplicate (the landed kit idiom).
 * - THE HONEST-UNKNOWN LAW: an entry whose capability descriptor is
 *   absent/unresolvable is disclosed as the honest-unknown row
 *   ('capability-unknown') - never silently dropped, never
 *   fabricated. Unreachable through registration (the
 *   no-dangling-ref law admits only entries whose descriptor
 *   resolves); the engine emits it defensively rather than dropping
 *   an entry.
 * - THE NO-MATCH TYPED REFUSAL: zero admissible candidates is the
 *   typed 'no-matching-candidate' decision carrying the FULL honest
 *   rows - never an exception, never a fabricated match. A malformed
 *   request is the typed 'request-rejected' outcome (a frozen-list
 *   reason; fail-closed, never an exception).
 * - THE LEDGER LAW (this family's own): the append-only JSONL
 *   decision ledger at the caller-injected root
 *   (matching-decisions.jsonl) is the family's one bounded local-IO
 *   surface, ordered by the work item. It is DELIVERY EVIDENCE,
 *   never an event authority: the engine never reads it back;
 *   decisions derive from the bound records and the injected clock,
 *   never from the ledger. Appends are canonical
 *   serializeMatchDecision bytes, one decision per line, in call
 *   order (append-only: the file grows, earlier lines never change).
 *   No network I/O (live-provider acceptance is INF-009, never
 *   here); match shapes carry no credential material.
 * - THE DRIFT FAIL-CLOSED LAW: every decision the engine emits is
 *   self-checked through the CONTRACT module's isMatchDecisionRecord
 *   guard before it reaches the caller or the ledger - a mismatch
 *   fails closed as a TypeError, never as a valid-looking record.
 * - Canonical bytes: the ledger appends serializeMatchDecision
 *   bytes (fixed key order, double-run byte-equal); every kit
 *   record carries the re-carried INFERENCE_MATCHING_VERSION (the
 *   battery pins both module copies equal).
 * - Zero external dependencies: node: builtins (path, fs - the
 *   ledger law's bounded surface) and the landed sibling families
 *   only.
 */
import { appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFERENCE_MATCHING_VERSION } from './matchingContract.js';
import {
	MATCHING_REJECTION_REASONS,
	admitMatchCandidate,
	admitMatchRequest,
	serializeMatchDecision,
	isMatchDecisionRecord,
} from './matchingContract.js';
import type {
	MatchCandidateDescriptor,
	MatchCandidateVerdictRow,
	MatchDecisionRecord,
	MatchOutcome,
	MatchRankedCandidate,
	MatchRequestDescriptor,
	MatchVerdictRow,
} from './matchingContract.js';
export { INFERENCE_MATCHING_VERSION } from './matchingContract.js';
import { admitCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitCapabilityMatrix, contextWindowContains } from '../../catalog/common/capabilityMatrix.js';
import type {
	CapabilityDescriptor,
	CapabilityMatrixRecord,
	ModelModality,
} from '../../catalog/common/capabilityMatrix.js';
import type { ProviderCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import type { ProviderAdapterDescriptor, ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { unverifiedProvenance } from '../../semantics/common/capacityDisclosure.js';

/**
 * The kit-level frozen rejection list: the contract's seventeen
 * reasons verbatim, in order, plus the kit's own documented addition
 * 'matching-entry-duplicate' (THE DUPLICATE LAW at the registered
 * set - the contract fold's 'duplicate-match-entry-id' is the
 * within-matrix duplicate). Widening beyond this is a contract
 * change requiring a version bump.
 */
export const MATCHING_KIT_REJECTION_REASONS = [
	...MATCHING_REJECTION_REASONS,
	'matching-entry-duplicate',
] as const;
export type MatchingKitRejectionReason = (typeof MATCHING_KIT_REJECTION_REASONS)[number];

/**
 * The kit-level admission: the contract's admitted entry carried
 * verbatim, with the rejection side widened to the kit's reason
 * vocabulary (the documented 'matching-entry-duplicate' addition).
 * Every contract reason surfaces verbatim through register - cited,
 * never re-worded.
 */
export interface MatchKitAdmitted {
	readonly admitted: true;
	readonly entry: MatchCandidateDescriptor;
}

export interface MatchKitRejected {
	readonly admitted: false;
	readonly reason: MatchingKitRejectionReason;
	readonly detail: string;
}

export type MatchKitAdmission = MatchKitAdmitted | MatchKitRejected;

/**
 * The kit options: the injected clock (THE INJECTED-CLOCK LAW), the
 * bound adapter record, capability matrix and catalog (arriving as
 * unknown at the runtime boundary, validated through the LANDED
 * guards - admitCatalogRecord, admitProviderAdapterRecord with the
 * catalog, admitCapabilityMatrix with the catalog - the landed
 * reasons cited verbatim in the TypeErrors), and the caller-injected
 * ledger root (an existing directory; the kit appends
 * matching-decisions.jsonl inside it - THE LEDGER LAW).
 */
export interface MatchingKitOptions {
	readonly now: () => number;
	readonly adapters: unknown;
	readonly matrix: unknown;
	readonly catalog: unknown;
	readonly ledgerRoot: string;
}

/**
 * One admissible (entry, model) pair before ranking: the effective
 * priority (declared, or the honest 0 default) with the bindings.
 */
interface AdmissiblePair {
	readonly entryId: string;
	readonly adapterId: string;
	readonly providerEntryId: string;
	readonly modelId: string;
	readonly priority: number;
}

/**
 * The deterministic matching kit: match-entry registration through
 * the contract's fail-closed guard (with the kit-level duplicate
 * law), list/find/count lookups, the disclosed deterministic match
 * engine with the derived provenance and the routing binding, the
 * append-only JSONL decision ledger, and the pure rank preview.
 * Pure vocabulary over injected values plus the one bounded ledger
 * surface: no network, no credential material, no clock reading, no
 * randomness, no event authority.
 */
export interface MatchingKit {
	register(candidate: unknown): MatchKitAdmission;
	list(): readonly MatchCandidateDescriptor[];
	find(entryId: string): MatchCandidateDescriptor | undefined;
	count(): number;
	match(request: unknown): MatchOutcome;
	rankPreview(request: unknown): MatchOutcome;
	recordDecision(decision: unknown): void;
}

/**
 * The ledger file name under the caller-injected root (THE LEDGER
 * LAW): matching-decisions.jsonl.
 */
export const MATCHING_DECISIONS_LEDGER_FILE = 'matching-decisions.jsonl';

/**
 * The disclosed fixture match-entry ids (evidence label 'fixture').
 * The kit does NOT pre-register them (a match entry binds the
 * caller's bound records, which the kit cannot know at creation -
 * the sidecar family's creation-time fixture registration does not
 * carry over); the battery registers the three disclosed fixture
 * entries at these ids against its fixture bound records.
 */
export const FIXTURE_MATCH_FITS_ID = 'fixture.match.fits';
export const FIXTURE_MATCH_TOO_SMALL_ID = 'fixture.match.too-small';
export const FIXTURE_MATCH_MODALITY_MISSING_ID = 'fixture.match.modality-missing';

/** The honest default for an undeclared declaredPriority (the neutral preference). */
const UNDECLARED_PRIORITY = 0;

/**
 * Creates a matching kit (fail-closed factory). Validation order is
 * deterministic: the options shape (now must be a function; the
 * ledger root must be a non-empty string), the bound catalog through
 * the LANDED admitCatalogRecord, the bound adapter record through
 * the LANDED admitProviderAdapterRecord (which enforces every
 * adapter's provider-entry resolution against the catalog), the
 * bound capability matrix through the LANDED admitCapabilityMatrix
 * (which enforces every descriptor's provider-entry resolution
 * against the catalog), the ledger root (an existing directory),
 * and finally ONE read of the injected clock to validate it can
 * produce a finite decision time. The kit starts with ZERO
 * registered entries.
 */
export function createMatchingKit(options: MatchingKitOptions): MatchingKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createMatchingKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const record = options as MatchingKitOptions;
	const ledgerRoot = record.ledgerRoot;
	if (!isNonEmptyString(ledgerRoot)) {
		throw new TypeError(
			'createMatchingKit: options.ledgerRoot must be a non-empty string (the caller-injected root the decision ledger lives at - the kit never invents a location)',
		);
	}
	const catalogAdmission = admitCatalogRecord(record.catalog);
	if (!catalogAdmission.admitted) {
		throw new TypeError(
			`createMatchingKit: the bound catalog must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const boundCatalog: ProviderCatalogRecord = catalogAdmission.record;
	const adaptersAdmission = admitProviderAdapterRecord(record.adapters, record.catalog);
	if (!adaptersAdmission.admitted) {
		throw new TypeError(
			`createMatchingKit: the bound adapter record must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
		);
	}
	const boundAdapters: ProviderAdapterRecord = adaptersAdmission.record;
	const matrixAdmission = admitCapabilityMatrix(record.matrix, record.catalog);
	if (!matrixAdmission.admitted) {
		throw new TypeError(
			`createMatchingKit: the bound capability matrix must satisfy admitCapabilityMatrix: '${matrixAdmission.reason}': ${matrixAdmission.detail}`,
		);
	}
	const boundMatrix: CapabilityMatrixRecord = matrixAdmission.matrix;
	const ledgerStats = statSync(ledgerRoot, { throwIfNoEntry: false });
	if (ledgerStats === undefined || !ledgerStats.isDirectory()) {
		throw new TypeError(
			`createMatchingKit: options.ledgerRoot '${ledgerRoot}' must be an existing directory (the caller injects the root; the kit appends ${MATCHING_DECISIONS_LEDGER_FILE} inside it)`,
		);
	}
	const ledgerPath = join(ledgerRoot, MATCHING_DECISIONS_LEDGER_FILE);
	const now = record.now;
	if (!isFiniteEpochMs(now())) {
		throw new TypeError(
			'createMatchingKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
		);
	}
	const adaptersById = new Map<string, ProviderAdapterDescriptor>();
	for (const adapter of boundAdapters.adapters) {
		adaptersById.set(adapter.adapterId, adapter);
	}
	const descriptorsByProvider = new Map<string, CapabilityDescriptor[]>();
	for (const descriptor of boundMatrix.descriptors) {
		const existing = descriptorsByProvider.get(descriptor.providerEntryId);
		if (existing === undefined) {
			descriptorsByProvider.set(descriptor.providerEntryId, [descriptor]);
		} else {
			existing.push(descriptor);
		}
	}
	for (const descriptors of descriptorsByProvider.values()) {
		descriptors.sort((left, right) => {
			if (left.modelId < right.modelId) {
				return -1;
			}
			return left.modelId > right.modelId ? 1 : 0;
		});
	}
	const registered = new Map<string, MatchCandidateDescriptor>();

	const kit: MatchingKit = {
		register(candidate: unknown): MatchKitAdmission {
			const admission = admitMatchCandidate(candidate, boundAdapters, boundMatrix, boundCatalog);
			if (!admission.admitted) {
				// The contract guard runs first: every contract rejection
				// surfaces verbatim, even for a duplicate id.
				return admission;
			}
			const entry = admission.entry;
			if (registered.has(entry.id)) {
				// THE DUPLICATE LAW at the registered set: a repeat is a
				// typed rejection - the kit never silently overwrites.
				return {
					admitted: false,
					reason: 'matching-entry-duplicate',
					detail: `the entry id '${entry.id}' is already registered in this matching kit - a registered entry id is unique, never a silent overwrite`,
				};
			}
			registered.set(entry.id, entry);
			return { admitted: true, entry };
		},
		list(): readonly MatchCandidateDescriptor[] {
			return sortedEntries(registered);
		},
		find(entryId: string): MatchCandidateDescriptor | undefined {
			return registered.get(entryId);
		},
		count(): number {
			return registered.size;
		},
		match(request: unknown): MatchOutcome {
			return runMatch(request, now, registered, adaptersById, descriptorsByProvider, ledgerPath, true);
		},
		rankPreview(request: unknown): MatchOutcome {
			return runMatch(request, now, registered, adaptersById, descriptorsByProvider, ledgerPath, false);
		},
		recordDecision(decision: unknown): void {
			if (!isMatchDecisionRecord(decision)) {
				throw new TypeError(
					'recordDecision: decision must satisfy isMatchDecisionRecord - no dishonest match decision ever gets ledger bytes',
				);
			}
			appendFileSync(ledgerPath, serializeMatchDecision(decision) + '\n', 'utf8');
		},
	};
	return kit;
}

/**
 * THE ENGINE (shared by match and rankPreview; the only difference
 * is the ledger append). Deterministic: same registered entries,
 * same request, same clock instant - same rows, same ranking, same
 * selection, same bytes. The walk order is the entry walk's order
 * (adapter binding -> providerEntryId -> the provider's descriptors
 * in ascending model id order), entries in ascending entry id
 * order.
 */
function runMatch(
	requestInput: unknown,
	now: () => number,
	registered: Map<string, MatchCandidateDescriptor>,
	adaptersById: Map<string, ProviderAdapterDescriptor>,
	descriptorsByProvider: Map<string, CapabilityDescriptor[]>,
	ledgerPath: string,
	append: boolean,
): MatchOutcome {
	const requestAdmission = admitMatchRequest(requestInput);
	if (!requestAdmission.admitted) {
		// THE NO-MATCH TYPED REFUSAL LAW's request half: a malformed
		// request is the typed frozen-list rejection - fail-closed,
		// never an exception, never appended (a rejection is not a
		// decision).
		return { kind: 'request-rejected', reason: requestAdmission.reason, detail: requestAdmission.detail };
	}
	const request = requestAdmission.request;
	const decidedAtEpochMs = now();
	if (!isFiniteEpochMs(decidedAtEpochMs)) {
		throw new TypeError(
			'match: the injected clock must produce a finite epoch-ms decision instant (one read per decision - the kit never reads a clock itself)',
		);
	}
	const rows: MatchVerdictRow[] = [];
	const ranked: MatchRankedCandidate[] = [];
	const admissibleRows: AdmissiblePair[] = [];
	for (const entry of sortedEntries(registered)) {
		const adapter = adaptersById.get(entry.adapterId);
		if (adapter === undefined) {
			// Unreachable by registration (the no-dangling-ref law); the
			// engine never drops an entry silently.
			throw new TypeError(
				`match: the registered entry '${entry.id}' must resolve its adapter binding '${entry.adapterId}' in the bound adapter record - never a dangling ref`,
			);
		}
		const descriptors = descriptorsByProvider.get(adapter.providerEntryId);
		if (descriptors === undefined || descriptors.length === 0) {
			// THE HONEST-UNKNOWN LAW: disclosed as the honest-unknown row,
			// never silently dropped, never fabricated. Unreachable by
			// registration (the contract fold admits only entries whose
			// descriptor resolves); emitted defensively.
			rows.push({ kind: 'unknown-descriptor', entryId: entry.id, adapterId: entry.adapterId });
			continue;
		}
		const priority = entry.declaredPriority === undefined ? UNDECLARED_PRIORITY : entry.declaredPriority;
		for (const descriptor of descriptors) {
			const row = verdictRowFor(entry, adapter, descriptor, request);
			rows.push(row);
			if (row.admissible) {
				admissibleRows.push({
					entryId: entry.id,
					adapterId: entry.adapterId,
					providerEntryId: adapter.providerEntryId,
					modelId: descriptor.modelId,
					priority,
				});
			}
		}
	}
	if (admissibleRows.length === 0) {
		// THE NO-MATCH TYPED REFUSAL: zero admissible candidates - the
		// typed refusal carrying the FULL honest rows, never an
		// exception, never a fabricated match.
		const refusal: MatchDecisionRecord = {
			kind: 'no-matching-candidate',
			contractVersion: INFERENCE_MATCHING_VERSION,
			request,
			decidedAtEpochMs,
			rows,
		};
		if (!isMatchDecisionRecord(refusal)) {
			// THE DRIFT FAIL-CLOSED LAW: the kit's own output must satisfy
			// the CONTRACT guard's copy - a mismatch fails closed here,
			// never reaching the caller as a valid-looking decision.
			throw new TypeError(
				'match: the produced refusal must satisfy isMatchDecisionRecord (the kit and contract version copies must agree - the drift fails closed)',
			);
		}
		if (append) {
			appendFileSync(ledgerPath, serializeMatchDecision(refusal) + '\n', 'utf8');
		}
		return refusal;
	}
	// THE DISCLOSED RANKING: declaredPriority ascending (undeclared
	// rides the honest 0 default), ties by entry id ascending, then by
	// model id ascending (the byte-stability tie-break when one
	// entry's provider offers multiple fitting models) - deterministic,
	// no randomness, no fabricated quality ranking.
	admissibleRows.sort(compareAdmissible);
	for (let index = 0; index < admissibleRows.length; index++) {
		ranked.push({ rank: index + 1, ...admissibleRows[index] });
	}
	const top = ranked[0];
	// THE TAG-PREFERENCE LAW: the request tag, when it names a
	// REGISTERED entry, doubles as the caller's disclosed preference -
	// honored only when the named entry has an admissible pair; a
	// honored preference that is not the ranked top IS a disclosed
	// substitution, never silent. An unknown or inadmissible tag is
	// honestly ignored.
	let selected = top;
	if (request.requestTag !== undefined) {
		const taggedEntry = registered.get(request.requestTag);
		if (taggedEntry !== undefined) {
			for (const candidate of ranked) {
				if (candidate.entryId === taggedEntry.id) {
					selected = candidate;
					break;
				}
			}
		}
	}
	// THE DELEGATED PROVENANCE: built ONLY through the landed
	// unverifiedProvenance constructor - the substitution label derived
	// by the landed constructor itself ('none' iff the actual selection
	// equals the requested selection), never hand-built, never
	// caller-supplied. One decision, one time: the recording instant is
	// the decision instant.
	const provenance = unverifiedProvenance({
		requestedProviderId: top.providerEntryId,
		requestedModelId: top.modelId,
		actualProviderId: selected.providerEntryId,
		actualModelId: selected.modelId,
		recordedAtEpochMs: decidedAtEpochMs,
	});
	const decision: MatchDecisionRecord = {
		kind: 'matched',
		contractVersion: INFERENCE_MATCHING_VERSION,
		request,
		decidedAtEpochMs,
		rows,
		ranked,
		selected: {
			entryId: selected.entryId,
			adapterId: selected.adapterId,
			providerEntryId: selected.providerEntryId,
			modelId: selected.modelId,
		},
		substitution: provenance.substitution,
		provenance,
		routing: {
			adapterId: selected.adapterId,
			// The landed ROUTING_SELECTION_RULES vocabulary, verbatim - the
			// disclosed routing discipline this match ranks within or above
			// (the binder-map law).
			selectionRule: 'stable-adapter-id-order',
		},
	};
	if (!isMatchDecisionRecord(decision)) {
		// THE DRIFT FAIL-CLOSED LAW: a mismatch fails closed here, never
		// reaching the caller or the ledger as a valid-looking decision.
		throw new TypeError(
			'match: the produced decision must satisfy isMatchDecisionRecord (the kit and contract version copies must agree - the drift fails closed)',
		);
	}
	if (append) {
		appendFileSync(ledgerPath, serializeMatchDecision(decision) + '\n', 'utf8');
	}
	return decision;
}

/**
 * The per-(entry, model) verdict row: THE DELEGATED BOUNDARY MATH -
 * the context-window verdict rides the landed contextWindowContains
 * (INCLUSIVE boundaries: a boundary-exact request FITS); one off
 * each side is the honest too-small / too-large verdict. The
 * modality coverage verdict lists the missing modalities in the
 * closed vocabulary's own order; the output-cap verdict compares
 * the request's cap against the descriptor's max output tokens.
 * admissible is the derived conjunction - an inadmissible row is
 * recorded honestly, never silently dropped.
 */
function verdictRowFor(
	entry: MatchCandidateDescriptor,
	adapter: ProviderAdapterDescriptor,
	descriptor: CapabilityDescriptor,
	request: MatchRequestDescriptor,
): MatchCandidateVerdictRow {
	const contextTokens = request.contextTokens;
	let contextWindowVerdict: 'context-fits' | 'context-too-small' | 'context-too-large';
	if (contextWindowContains(descriptor, contextTokens)) {
		// The landed inclusive predicate is the authority on FITS.
		contextWindowVerdict = 'context-fits';
	} else if (contextTokens < descriptor.contextWindow.minTokens) {
		contextWindowVerdict = 'context-too-small';
	} else {
		contextWindowVerdict = 'context-too-large';
	}
	let modalityCoverageVerdict: 'modalities-covered' | 'modalities-missing';
	let missingModalities: readonly ModelModality[] = [];
	if (request.modalities !== undefined) {
		const missing = request.modalities.filter(
			(modality) => !(descriptor.modalities as readonly string[]).includes(modality),
		);
		if (missing.length > 0) {
			modalityCoverageVerdict = 'modalities-missing';
			missingModalities = missing;
		} else {
			modalityCoverageVerdict = 'modalities-covered';
		}
	} else {
		modalityCoverageVerdict = 'modalities-covered';
	}
	let outputCapVerdict: 'output-cap-fits' | 'output-cap-exceeded';
	if (request.outputCapTokens !== undefined && request.outputCapTokens > descriptor.maxOutputTokens) {
		outputCapVerdict = 'output-cap-exceeded';
	} else {
		outputCapVerdict = 'output-cap-fits';
	}
	return {
		kind: 'candidate',
		entryId: entry.id,
		adapterId: entry.adapterId,
		providerEntryId: adapter.providerEntryId,
		modelId: descriptor.modelId,
		contextWindowVerdict,
		modalityCoverageVerdict,
		missingModalities,
		outputCapVerdict,
		admissible:
			contextWindowVerdict === 'context-fits'
			&& modalityCoverageVerdict === 'modalities-covered'
			&& outputCapVerdict === 'output-cap-fits',
	};
}

/** The disclosed ranking comparator: priority, then entry id, then model id. */
function compareAdmissible(
	left: { entryId: string; modelId: string; priority: number },
	right: { entryId: string; modelId: string; priority: number },
): number {
	if (left.priority < right.priority) {
		return -1;
	}
	if (left.priority > right.priority) {
		return 1;
	}
	if (left.entryId < right.entryId) {
		return -1;
	}
	if (left.entryId > right.entryId) {
		return 1;
	}
	if (left.modelId < right.modelId) {
		return -1;
	}
	return left.modelId > right.modelId ? 1 : 0;
}

/** The registered entries in ascending entry id order (the walk order). */
function sortedEntries(registered: Map<string, MatchCandidateDescriptor>): MatchCandidateDescriptor[] {
	return [...registered.values()].sort((left, right) => {
		if (left.id < right.id) {
			return -1;
		}
		return left.id > right.id ? 1 : 0;
	});
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
