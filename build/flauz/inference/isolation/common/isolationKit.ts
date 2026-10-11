/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-007 Free Inference Fabric contracts: the typed credential
 * ISOLATION + provider-term ELIGIBILITY kit - the fail-closed factory
 * over the bound adapter record and catalog (validated through the
 * landed family guards), credential-scope registration through the
 * frozen rejection walk (with the kit-local duplicate law), the
 * lookups, THE TYPED RESOLUTION fold (scope -> the bound adapter
 * record -> its own opaque credentialHandle), the honest-unknown
 * eligibility fold emitting the provenance-bearing decision record
 * (through the landed unverifiedProvenance constructor and the
 * contract's verdictForTermState), the pure eligible-scopes fold, and
 * the append-only JSONL decision ledger at the caller-injected root
 * (kit module, the labContracts discipline; binds the landed
 * INF-001..003 family vocabularies verbatim, never re-implemented).
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the landed
 * INF-001..006 family laws are INHERITED and binding here):
 * - THE NO-SECRET LAW (binding, the family charter): the kit resolves
 *   ONLY typed references. resolveHandle returns the typed reference
 *   side (scope id, adapter id, the bound adapter record's own opaque
 *   credentialHandle) - never secret material; the vocabulary cannot
 *   name a secret and the kit cannot return one. No credential
 *   material ever reaches the ledger.
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a clock.
 *   Every timestamp - the eligibility decision instants and the
 *   derived provenance's recording instants - comes from the single
 *   injected now() function (one read per decision; one validation
 *   read at creation). The register / list / find / count /
 *   resolveHandle / eligibleScopes folds read NO clock at all. No
 *   Date.now, no Math.random, no process.env in this module (law
 *   comments excepted).
 * - THE NO-DANGLING-REF LAW (binding, at construction): the bound
 *   adapter record and catalog arrive as unknown at the runtime
 *   boundary and are validated through the LANDED guards
 *   (admitCatalogRecord, admitProviderAdapterRecord with the catalog -
 *   the landed direct-adapter law is the eligibility guard's
 *   provenance precondition, enforced there, never re-implemented
 *   here); every registered scope's adapter binding, catalog binding
 *   and handle equality resolve at registration through the contract's
 *   admission walk.
 * - THE HONEST-UNKNOWN ELIGIBILITY LAW (binding, end-to-end): the
 *   eligibility fold rides the contract's verdictForTermState - a
 *   provider term state of 'unknown' is NEVER auto-eligible; it is
 *   the disclosed 'term-unknown' verdict for every usage class, and
 *   the terms state rides the decision verbatim (the disclosure).
 * - THE TYPED REFUSAL: an unknown scope id or a usage class outside
 *   the frozen vocabulary is the typed 'no-eligible-binding' refusal -
 *   never an exception, never a fabricated eligibility.
 * - THE DELEGATED PROMOTION (binding): the kit exposes NO verification
 *   promotion surface. The one-way promotions belong to the landed
 *   markProvenanceVerified / markEntryMetadataVerified, exercised BY
 *   THE CALLER on the returned decision / the bound catalog entry -
 *   never re-implemented, never a kit-side mutator, never demoted.
 * - THE DUPLICATE LAW: a repeated scope id at the registered set is
 *   the kit-local 'isolation-scope-duplicate' rejection - never a
 *   silent overwrite. The contract guard runs first: a candidate that
 *   is both malformed and a duplicate reports the contract reason.
 * - THE LEDGER LAW: the append-only JSONL decision ledger at the
 *   caller-injected root (isolation-decisions.jsonl) is the family's
 *   one bounded local-IO surface, ordered by the work item. It is
 *   DELIVERY EVIDENCE, never an event authority: the kit never reads
 *   it back; decisions derive from the bound records and the injected
 *   clock, never from the ledger. Appends are canonical
 *   serializeEligibilityDecision bytes, one decision per line, in
 *   call order (append-only: the file grows, earlier lines never
 *   change). No network I/O; no credential material ever reaches the
 *   ledger.
 * - THE DRIFT FAIL-CLOSED LAW: every decision the kit emits is
 *   self-checked through the CONTRACT module's
 *   isEligibilityDecisionRecord guard before it reaches the caller -
 *   a mismatch fails closed as a TypeError, never as a valid-looking
 *   record.
 * - THE PURE FOLDS: eligibleScopes lists the eligible scopes for a
 *   usage class with ZERO clock reads - empty is honest, never
 *   fabricated (no usage class outside the frozen vocabulary can make
 *   anything eligible).
 * - Zero external dependencies: node: builtins (path, fs - the ledger
 *   law's bounded surface) and the landed sibling families only.
 */
import { appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INFERENCE_ISOLATION_VERSION } from './isolationContract.js';
import {
	ISOLATION_REJECTION_REASONS,
	ISOLATION_ELIGIBILITY_PROBE_SCOPE,
	USAGE_CLASSES,
	admitCredentialScope,
	isEligibilityDecisionRecord,
	isUsageClass,
	serializeEligibilityDecision,
	verdictForTermState,
} from './isolationContract.js';
import type {
	CredentialScopeDescriptor,
	EligibilityDecisionRecord,
	HandleResolution,
} from './isolationContract.js';
export { INFERENCE_ISOLATION_VERSION } from './isolationContract.js';
import { admitCatalogRecord, catalogIndexById } from '../../catalog/common/providerCatalog.js';
import type { ProviderCatalogEntry, ProviderCatalogRecord } from '../../catalog/common/providerCatalog.js';
import { admitProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import type { ProviderAdapterDescriptor, ProviderAdapterRecord } from '../../adapters/common/providerAdapter.js';
import { unverifiedProvenance } from '../../semantics/common/capacityDisclosure.js';

/**
 * The kit-level frozen rejection list: the contract's thirteen
 * reasons verbatim, in order, plus the kit's own documented addition
 * 'isolation-scope-duplicate' (THE DUPLICATE LAW at the registered
 * set - the contract fold's 'duplicate-scope-id' is the within-set
 * duplicate). Widening beyond this is a contract change requiring a
 * version bump.
 */
export const ISOLATION_KIT_REJECTION_REASONS = [
	...ISOLATION_REJECTION_REASONS,
	'isolation-scope-duplicate',
] as const;
export type IsolationKitRejectionReason = (typeof ISOLATION_KIT_REJECTION_REASONS)[number];

/**
 * The kit-level admission: the contract's admitted scope carried
 * verbatim, with the rejection side widened to the kit's reason
 * vocabulary (the documented 'isolation-scope-duplicate' addition).
 * Every contract reason surfaces verbatim through register - cited,
 * never re-worded.
 */
export interface ScopeKitAdmitted {
	readonly admitted: true;
	readonly scope: CredentialScopeDescriptor;
}

export interface ScopeKitRejected {
	readonly admitted: false;
	readonly reason: IsolationKitRejectionReason;
	readonly detail: string;
}

export type ScopeKitAdmission = ScopeKitAdmitted | ScopeKitRejected;

/**
 * The kit options: the injected clock (THE INJECTED-CLOCK LAW), the
 * bound adapter record and catalog (arriving as unknown at the
 * runtime boundary, validated through the LANDED guards -
 * admitCatalogRecord, admitProviderAdapterRecord with the catalog -
 * the landed reasons cited verbatim in the TypeErrors), and the
 * caller-injected ledger root (an existing directory; the kit appends
 * isolation-decisions.jsonl inside it - THE LEDGER LAW).
 */
export interface IsolationKitOptions {
	readonly now: () => number;
	readonly adapters: unknown;
	readonly catalog: unknown;
	readonly ledgerRoot: string;
}

/**
 * The deterministic isolation kit: credential-scope registration
 * through the contract's fail-closed guard (with the kit-level
 * duplicate law), list/find/count lookups, THE TYPED RESOLUTION fold,
 * the honest-unknown eligibility fold emitting the provenance-bearing
 * decision record, the pure eligible-scopes fold, and the append-only
 * JSONL decision ledger. Pure vocabulary over injected values plus
 * the one bounded ledger surface: no network, no clock reading, no
 * randomness, no credential material, no event authority.
 */
export interface IsolationKit {
	register(candidate: unknown): ScopeKitAdmission;
	list(): readonly CredentialScopeDescriptor[];
	find(scopeId: string): CredentialScopeDescriptor | undefined;
	count(): number;
	resolveHandle(scopeId: unknown): HandleResolution;
	checkEligibility(scopeId: unknown, usageClass: unknown): EligibilityDecisionRecord;
	recordDecision(decision: unknown): void;
	eligibleScopes(usageClass: unknown): readonly CredentialScopeDescriptor[];
}

/**
 * The ledger file name under the caller-injected root (THE LEDGER
 * LAW): isolation-decisions.jsonl.
 */
export const ISOLATION_DECISIONS_LEDGER_FILE = 'isolation-decisions.jsonl';

/**
 * The disclosed fixture credential-scope ids (evidence label
 * 'fixture'). The kit does NOT pre-register them (a credential scope
 * binds the caller's bound records, which the kit cannot know at
 * creation - the matching family's fixture registration note carries
 * over); the battery registers the three disclosed fixture scopes at
 * these ids against its fixture bound records:
 *   fixture.scope.permitted    - the scope whose bound provider's
 *                                termsState is 'permitted' (verdict
 *                                'eligible');
 *   fixture.scope.unknown-term - the scope whose bound provider's
 *                                termsState is 'unknown' (verdict
 *                                'term-unknown' - the honest-unknown
 *                                law);
 *   fixture.scope.prohibited   - the scope whose bound provider's
 *                                termsState is 'prohibited' (verdict
 *                                'ineligible').
 */
export const FIXTURE_SCOPE_PERMITTED_ID = 'fixture.scope.permitted';
export const FIXTURE_SCOPE_UNKNOWN_TERM_ID = 'fixture.scope.unknown-term';
export const FIXTURE_SCOPE_PROHIBITED_ID = 'fixture.scope.prohibited';

/**
 * Creates an isolation kit (fail-closed factory). Validation order is
 * deterministic: the options shape (now must be a function; the
 * ledger root must be a non-empty string), the bound catalog through
 * the LANDED admitCatalogRecord, the bound adapter record through the
 * LANDED admitProviderAdapterRecord (which enforces every adapter's
 * provider-entry resolution against the catalog - the landed
 * direct-adapter law is the eligibility guard's provenance
 * precondition), the ledger root (an existing directory), and finally
 * ONE read of the injected clock to validate it can produce a finite
 * decision time. The kit starts with ZERO registered scopes.
 */
export function createIsolationKit(options: IsolationKitOptions): IsolationKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createIsolationKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const record = options as IsolationKitOptions;
	const ledgerRoot = record.ledgerRoot;
	if (!isNonEmptyString(ledgerRoot)) {
		throw new TypeError(
			'createIsolationKit: options.ledgerRoot must be a non-empty string (the caller-injected root the decision ledger lives at - the kit never invents a location)',
		);
	}
	const catalogAdmission = admitCatalogRecord(record.catalog);
	if (!catalogAdmission.admitted) {
		throw new TypeError(
			`createIsolationKit: the bound catalog must satisfy admitCatalogRecord: '${catalogAdmission.reason}': ${catalogAdmission.detail}`,
		);
	}
	const boundCatalog: ProviderCatalogRecord = catalogAdmission.record;
	const adaptersAdmission = admitProviderAdapterRecord(record.adapters, record.catalog);
	if (!adaptersAdmission.admitted) {
		throw new TypeError(
			`createIsolationKit: the bound adapter record must satisfy admitProviderAdapterRecord: '${adaptersAdmission.reason}': ${adaptersAdmission.detail}`,
		);
	}
	const boundAdapters: ProviderAdapterRecord = adaptersAdmission.record;
	const ledgerStats = statSync(ledgerRoot, { throwIfNoEntry: false });
	if (ledgerStats === undefined || !ledgerStats.isDirectory()) {
		throw new TypeError(
			`createIsolationKit: options.ledgerRoot '${ledgerRoot}' must be an existing directory (the caller injects the root; the kit appends ${ISOLATION_DECISIONS_LEDGER_FILE} inside it)`,
		);
	}
	const ledgerPath = join(ledgerRoot, ISOLATION_DECISIONS_LEDGER_FILE);
	const now = record.now;
	if (!isFiniteEpochMs(now())) {
		throw new TypeError(
			'createIsolationKit: the injected clock must produce a finite epoch-ms number (one validation read at creation)',
		);
	}
	const adaptersById = new Map<string, ProviderAdapterDescriptor>();
	for (const adapter of boundAdapters.adapters) {
		adaptersById.set(adapter.adapterId, adapter);
	}
	const catalogIndex = catalogIndexById(boundCatalog);
	const registered = new Map<string, CredentialScopeDescriptor>();

	const kit: IsolationKit = {
		register(candidate: unknown): ScopeKitAdmission {
			const admission = admitCredentialScope(candidate, boundAdapters, boundCatalog);
			if (!admission.admitted) {
				// The contract guard runs first: every contract rejection
				// surfaces verbatim, even for a duplicate id.
				return admission;
			}
			const scope = admission.scope;
			if (registered.has(scope.id)) {
				// THE DUPLICATE LAW at the registered set: a repeat is a typed
				// rejection - the kit never silently overwrites.
				return {
					admitted: false,
					reason: 'isolation-scope-duplicate',
					detail: `the scope id '${scope.id}' is already registered in this isolation kit - a registered scope id is unique, never a silent overwrite`,
				};
			}
			registered.set(scope.id, scope);
			return { admitted: true, scope };
		},
		list(): readonly CredentialScopeDescriptor[] {
			return sortedScopes(registered);
		},
		find(scopeId: string): CredentialScopeDescriptor | undefined {
			return registered.get(scopeId);
		},
		count(): number {
			return registered.size;
		},
		resolveHandle(scopeId: unknown): HandleResolution {
			const scope = isNonEmptyString(scopeId) ? registered.get(scopeId) : undefined;
			if (scope === undefined) {
				return {
					resolved: false,
					reason: 'unknown-scope',
					detail: `the scope id '${String(scopeId)}' resolves to no registered credential scope - there is no typed reference to resolve`,
				};
			}
			const adapter = adaptersById.get(scope.adapterId);
			if (adapter === undefined) {
				// Unreachable by registration (the no-dangling-ref law); the fold
				// never dangles silently.
				throw new TypeError(
					`resolveHandle: the registered scope '${scope.id}' must resolve its adapter binding '${scope.adapterId}' in the bound adapter record - never a dangling ref`,
				);
			}
			// THE TYPED RESOLUTION: scope -> the bound adapter record -> its own
			// credentialHandle. The result is the typed reference ONLY - the
			// vocabulary cannot name a secret and the kit cannot return one.
			return {
				resolved: true,
				scopeId: scope.id,
				adapterId: scope.adapterId,
				credentialHandle: adapter.credentialHandle,
			};
		},
		checkEligibility(scopeId: unknown, usageClass: unknown): EligibilityDecisionRecord {
			const decidedAtEpochMs = now();
			if (!isFiniteEpochMs(decidedAtEpochMs)) {
				throw new TypeError(
					'checkEligibility: the injected clock must produce a finite epoch-ms decision instant (one read per decision - the kit never reads a clock itself)',
				);
			}
			if (!isUsageClass(usageClass)) {
				// THE TYPED REFUSAL: no usage class outside the frozen vocabulary
				// can make anything eligible - never an exception, never a
				// fabricated eligibility.
				return {
					kind: 'no-eligible-binding',
					contractVersion: INFERENCE_ISOLATION_VERSION,
					decidedAtEpochMs,
					detail: `the usage class '${String(usageClass)}' is not a member of the frozen USAGE_CLASSES vocabulary (${USAGE_CLASSES.join('/')}) - no binding can be eligible under a class the vocabulary does not carry`,
				};
			}
			const scope = isNonEmptyString(scopeId) ? registered.get(scopeId) : undefined;
			if (scope === undefined) {
				// THE TYPED REFUSAL: an unknown scope id has no eligible binding
				// to decide - never an exception, never a fabricated eligibility.
				return {
					kind: 'no-eligible-binding',
					contractVersion: INFERENCE_ISOLATION_VERSION,
					decidedAtEpochMs,
					detail: `the scope id '${String(scopeId)}' resolves to no registered credential scope - there is no eligible binding to decide, never a fabricated eligibility`,
				};
			}
			const adapter = adaptersById.get(scope.adapterId);
			if (adapter === undefined) {
				// Unreachable by registration (the no-dangling-ref law); the fold
				// never dangles silently.
				throw new TypeError(
					`checkEligibility: the registered scope '${scope.id}' must resolve its adapter binding '${scope.adapterId}' in the bound adapter record - never a dangling ref`,
				);
			}
			const entry = catalogEntryFor(catalogIndex, adapter.providerEntryId);
			// THE DELEGATED PROVENANCE: built ONLY through the landed
			// unverifiedProvenance constructor with the probe scope label - the
			// substitution label derived by the landed constructor itself ('none'
			// by construction: the eligibility decision names one provider on
			// both sides), never hand-built, never caller-supplied. One
			// decision, one time: the recording instant is the decision instant.
			const decision: EligibilityDecisionRecord = {
				kind: 'decided',
				contractVersion: INFERENCE_ISOLATION_VERSION,
				scopeId: scope.id,
				adapterId: scope.adapterId,
				providerEntryId: adapter.providerEntryId,
				usageClass,
				termsState: entry.termsState,
				verdict: verdictForTermState(entry.termsState),
				metadataVerification: entry.metadataVerification,
				provenance: unverifiedProvenance({
					requestedProviderId: adapter.providerEntryId,
					requestedModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					actualProviderId: adapter.providerEntryId,
					actualModelId: ISOLATION_ELIGIBILITY_PROBE_SCOPE,
					recordedAtEpochMs: decidedAtEpochMs,
				}),
				decidedAtEpochMs,
			};
			if (!isEligibilityDecisionRecord(decision)) {
				// THE DRIFT FAIL-CLOSED LAW: the kit's own output must satisfy
				// the CONTRACT guard's copy - a mismatch fails closed here,
				// never reaching the caller as a valid-looking decision.
				throw new TypeError(
					'checkEligibility: the produced decision must satisfy isEligibilityDecisionRecord (the kit and contract version copies must agree - the drift fails closed)',
				);
			}
			return decision;
		},
		recordDecision(decision: unknown): void {
			if (!isEligibilityDecisionRecord(decision)) {
				throw new TypeError(
					'recordDecision: decision must satisfy isEligibilityDecisionRecord - no dishonest eligibility decision ever gets ledger bytes',
				);
			}
			appendFileSync(ledgerPath, serializeEligibilityDecision(decision) + '\n', 'utf8');
		},
		eligibleScopes(usageClass: unknown): readonly CredentialScopeDescriptor[] {
			const eligible: CredentialScopeDescriptor[] = [];
			if (!isUsageClass(usageClass)) {
				// No usage class outside the frozen vocabulary can make anything
				// eligible - the honest empty, never fabricated.
				return eligible;
			}
			for (const scope of sortedScopes(registered)) {
				const adapter = adaptersById.get(scope.adapterId);
				if (adapter === undefined) {
					// Unreachable by registration (the no-dangling-ref law); the
					// fold never dangles silently.
					throw new TypeError(
						`eligibleScopes: the registered scope '${scope.id}' must resolve its adapter binding '${scope.adapterId}' in the bound adapter record - never a dangling ref`,
					);
				}
				const entry = catalogEntryFor(catalogIndex, adapter.providerEntryId);
				if (verdictForTermState(entry.termsState) === 'eligible') {
					eligible.push(scope);
				}
			}
			return eligible;
		},
	};
	return kit;
}

/**
 * The bound catalog entry lookup (the no-dangling-ref law's catalog
 * half at fold time - unreachable as a miss by registration, never a
 * silent dangling ref). Prototype-hazard ids still resolve as own
 * keys - the index is the landed catalogIndexById view.
 */
function catalogEntryFor(
	index: Readonly<Record<string, ProviderCatalogEntry>>,
	providerEntryId: string,
): ProviderCatalogEntry {
	if (!Object.prototype.hasOwnProperty.call(index, providerEntryId)) {
		throw new TypeError(
			`the provider entry '${providerEntryId}' must resolve in the bound catalog record - never a dangling ref`,
		);
	}
	return index[providerEntryId];
}

/** The registered scopes in ascending scope id order (the fold order). */
function sortedScopes(registered: Map<string, CredentialScopeDescriptor>): CredentialScopeDescriptor[] {
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
