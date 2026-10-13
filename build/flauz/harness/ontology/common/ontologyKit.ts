/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-004 domain ontology/terminology kit: the deterministic terminology
 * instrument over the frozen ontology contract vocabulary (imported,
 * never re-implemented). THE STATELESS DESIGN (deliberate and
 * disclosed): the instrument is PURE over the frozen catalogs - it
 * holds NO sessions, mints NO ids (no rng seam) and touches NO
 * filesystem (no fsPort seam); persistence belongs to the session
 * families (the DH-01/DH-02/DH-03 precedent), and this family - the
 * vocabulary layer - needs none of it. The ONLY injected seam is the
 * clock: createOntologyKit consumes exactly ONE clock read (the
 * seam-validation read, the landed-family factory precedent) and
 * lookupTerm consumes exactly ONE read per SUCCESSFUL lookup, carried
 * VERBATIM into the lookup record (the kit never reads a clock
 * itself - a refused lookup consumes no read; the record never
 * exists).
 *
 * The surface (every op async with a typed outcome, every domain
 * refusal typed):
 * - lookupTerm(industry, termKey): the read surface - the resolved
 *   DomainTerm plus its relations in BOTH directions (the outgoing
 *   edges where the term is the source, the incoming edges where it is
 *   the target); the typed unknown-term-ref refusal on a miss (a
 *   malformed key fails closed as unknown - the roles-family
 *   precedent); the typed unknown-industry refusal outside the frozen
 *   sixteen.
 * - validateTermSet(industry, termKeys): the user's selected
 *   terminology - every key must resolve (the typed unknown-term-ref
 *   refusal listing EVERY offender), no duplicates (the typed
 *   duplicate-term-keys refusal), non-empty (the typed empty-term-set
 *   refusal); the ok result carries the resolved terms in CATALOG
 *   order (never caller order - the catalog is the vocabulary's
 *   order).
 * - inspectCatalog(industry): the frozen catalog and relation registry
 *   BY REFERENCE (the battery pins the identity against the contract
 *   module's exports).
 * - relationIntegrityReport(industry): THE INTEGRITY LAW's walk over
 *   the frozen registry - a typed REPORT (never a throw, never a
 *   refusal): the term and relation counts, the clean flag and the
 *   findings array (empty on a clean registry; the battery pins a
 *   clean report for every one of the sixteen industries).
 * - dispose(): THE DISPOSE LAW - every operation after dispose refuses
 *   with the typed disposed refusal (the work order's lowercase
 *   literal sets this family's kit-extra naming convention).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE REAL-VOCABULARY LAW: the industries, the catalogs and the
 *   relation registries are imported from the real contract module
 *   (which imports the DH-01 vocabulary by reference) - never
 *   re-declared, never shadowed (the battery pins referential
 *   identity).
 * - THE NO-FORK LAW: the instrument resolves and reports reference-
 *   only vocabulary; it grants NOTHING by itself.
 * - THE FROZEN-CATALOG LAW: membership is the only admissibility; the
 *   kit reads the frozen catalogs and writes nothing.
 * - THE INTEGRITY LAW: the integrity walk is the contract's
 *   walkRelationIntegrity engine - typed, never throwing.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock is an INJECTED seam; same inputs produce byte-identical
 *   outputs (the battery pins double-lookup determinism).
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError (the DH-01
 *   message shapes, the createOntologyKit prefix); every domain
 *   refusal is the typed record { reason, law, message, items? }
 *   naming the violated law and the offending items - never a string
 *   throw, never a silent skip, never a partial effect.
 * - THE SINGLE-VERSION LAW: ONTOLOGY_CONTRACTS_VERSION is declared
 *   ONCE in the contract module, re-carried by this kit (the
 *   re-export); DOMAIN_HARNESS_CONTRACTS_VERSION re-carried through
 *   the re-export chain; the battery pins every copy equal.
 * - THE DISPOSE LAW: every operation after dispose rejects with the
 *   typed disposed refusal.
 */

import {
	ONTOLOGY_CONTRACTS_VERSION,
	ONTOLOGY_VALIDATION_REJECTION_REASONS,
	INDUSTRY_TERM_CATALOGS,
	INDUSTRY_TERM_RELATIONS,
	isHarnessIndustry,
	walkRelationIntegrity,
} from './ontologyContract.js';
import type {
	DomainTerm,
	HarnessIndustry,
	RelationIntegrityFinding,
	TermRelation,
} from './ontologyContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ONTOLOGY_CONTRACTS_VERSION } from './ontologyContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** The REAL frozen catalogs and registries, re-exported BY REFERENCE (the resolution surface the kit reads). */
export { INDUSTRY_TERM_CATALOGS, INDUSTRY_TERM_RELATIONS } from './ontologyContract.js';

/** The REAL DH-01 industry vocabulary, re-exported BY REFERENCE (never re-declared). */
export { HARNESS_INDUSTRIES, isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/** The REAL contract types, re-exported BY REFERENCE (the kit's payload shapes). */
export type { DomainTerm, TermRelation, IndustryOntology, RelationIntegrityFinding } from './ontologyContract.js';

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ONTOLOGY_VALIDATION_REJECTION_REASONS; the work order's lowercase
 * 'disposed' literal sets this family's kit-extra naming convention -
 * kebab-case, unlike the landed families' SCREAMING extras, a
 * disclosed design decision):
 *   disposed            - THE DISPOSE LAW: the kit was disposed; every
 *                         operation after dispose refuses;
 *   corrupt-seam        - THE DETERMINISM LAW: the injected clock
 *                         returned a malformed value mid-lookup (an
 *                         empty or non-string reading);
 *   malformed-term-set  - THE FAIL-CLOSED LAW: validateTermSet
 *                         received a non-array termKeys carrier or a
 *                         non-string member;
 *   empty-term-set      - THE FAIL-CLOSED LAW: validateTermSet
 *                         received an empty selection (the selected
 *                         terminology is non-empty).
 */
export const ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS = [
	'disposed',
	'corrupt-seam',
	'malformed-term-set',
	'empty-term-set',
] as const;

/** The frozen kit refusal vocabulary: the contract's 16 domain reasons plus the 4 kit-layer extras. */
export const ONTOLOGY_KIT_REFUSAL_REASONS = [
	...ONTOLOGY_VALIDATION_REJECTION_REASONS,
	...ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type OntologyKitRefusalReason = (typeof ONTOLOGY_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isOntologyKitRefusalReason(value: unknown): value is OntologyKitRefusalReason {
	return (ONTOLOGY_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic message sentence and - when offenders exist -
 * every offending item (the work order's single-refusal shape,
 * mirrored from the contract's OntologyRejection).
 */
export interface OntologyKitRefusal {
	readonly reason: OntologyKitRefusalReason;
	readonly law: string;
	readonly message: string;
	readonly items?: readonly string[];
}

/**
 * The kit construction options (all injected, never env-read). The
 * clock is the ONLY seam: NO rng (the instrument mints nothing), NO
 * fsPort and NO root (the stateless design - persistence belongs to
 * the session families; disclosed in the family README).
 */
export interface OntologyKitOptions {
	/** The injected clock (returns the ISO string; carried verbatim into lookup records - the kit never reads a clock itself). */
	readonly clock: () => string;
}

/**
 * One term lookup record: the injected clock reading carried VERBATIM
 * (at), the industry, the resolved DomainTerm, and the term's
 * relations in BOTH directions - the outgoing edges (the term is the
 * fromTermKey) and the incoming edges (the term is the toTermKey).
 */
export interface TermLookupRecord {
	readonly at: string;
	readonly industry: HarnessIndustry;
	readonly term: DomainTerm;
	readonly outgoingRelations: readonly TermRelation[];
	readonly incomingRelations: readonly TermRelation[];
}

/** The lookup outcome: ok carries the lookup record; failure carries the typed refusal. */
export type OntologyLookupOutcome =
	| { readonly ok: true; readonly lookup: TermLookupRecord }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/** The term-set outcome: ok carries the resolved terms in CATALOG order; failure carries the typed refusal. */
export type OntologyTermSetOutcome =
	| { readonly ok: true; readonly industry: HarnessIndustry; readonly terms: readonly DomainTerm[] }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/** The catalog-inspection outcome: ok carries the frozen catalog + registry BY REFERENCE; failure carries the typed refusal. */
export type OntologyCatalogOutcome =
	| { readonly ok: true; readonly industry: HarnessIndustry; readonly terms: readonly DomainTerm[]; readonly relations: readonly TermRelation[] }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/**
 * THE INTEGRITY LAW's typed report (a value, never a throw, never a
 * refusal): the industry, the term and relation counts, the clean flag
 * (true iff the findings array is empty) and the findings in the
 * frozen station order. The battery pins a clean report for every one
 * of the sixteen industries.
 */
export interface RelationIntegrityReport {
	readonly industry: HarnessIndustry;
	readonly termCount: number;
	readonly relationCount: number;
	readonly clean: boolean;
	readonly findings: readonly RelationIntegrityFinding[];
}

/** The integrity-report outcome: ok carries the typed report; failure carries the typed refusal. */
export type OntologyIntegrityOutcome =
	| { readonly ok: true; readonly report: RelationIntegrityReport }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/**
 * The deterministic terminology kit: every operation is async with a
 * typed outcome ({ ok: true, ... } | { ok: false, refusal }) - the
 * landed family shape; the instrument itself is pure and stateless
 * over the frozen catalogs (the only mutable state is the disposed
 * flag).
 */
export interface OntologyKit {
	lookupTerm(industry: unknown, termKey: unknown): Promise<OntologyLookupOutcome>;
	validateTermSet(industry: unknown, termKeys: unknown): Promise<OntologyTermSetOutcome>;
	inspectCatalog(industry: unknown): Promise<OntologyCatalogOutcome>;
	relationIntegrityReport(industry: unknown): Promise<OntologyIntegrityOutcome>;
	dispose(): void;
}

/**
 * Creates an ontology kit (fail-closed factory). Validation order is
 * deterministic and mirrors the landed DH-01 factory walk (the same
 * preconditions, the same message shapes, the createOntologyKit
 * prefix): the options shape (a plain object; clock a function), then
 * the clock's first read (a non-empty ISO string - the injected-clock
 * law). The factory consumes exactly ONE clock read (the seam-
 * validation read; the battery pins the exact count). There is NO rng
 * seam and NO fs seam: the instrument is stateless and pure over the
 * frozen catalogs (the disclosed design).
 */
export function createOntologyKit(options: OntologyKitOptions): OntologyKit {
	const bound = validateKitOptions(options);
	let disposed = false;
	const refuseIfDisposed = (op: string): OntologyKitRefusal | null => {
		if (disposed) {
			return refused('disposed', 'THE DISPOSE LAW', `${op}: the kit was disposed - every operation after dispose refuses`);
		}
		return null;
	};
	const refuseUnknownIndustry = (op: string, industry: unknown): OntologyKitRefusal => {
		return refused(
			'unknown-industry',
			'THE REAL-VOCABULARY LAW',
			`${op}: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (received ${showValue(industry)})`,
			[showValue(industry)],
		);
	};
	return {
		async lookupTerm(industry: unknown, termKey: unknown): Promise<OntologyLookupOutcome> {
			const disposedRefusal = refuseIfDisposed('lookupTerm');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (!isHarnessIndustry(industry)) {
				return { ok: false, refusal: refuseUnknownIndustry('lookupTerm', industry) };
			}
			const catalog = INDUSTRY_TERM_CATALOGS[industry];
			let term: DomainTerm | null = null;
			if (typeof termKey === 'string') {
				for (const candidate of catalog) {
					if (candidate.termKey === termKey) {
						term = candidate;
						break;
					}
				}
			}
			if (term === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-term-ref',
						'THE INTEGRITY LAW',
						`lookupTerm: the termKey ${showValue(termKey)} does not resolve in the ${industry} catalog (a malformed key fails closed as unknown)`,
						[showValue(termKey)],
					),
				};
			}
			// THE INJECTED-CLOCK LAW: exactly one read on the success path, carried VERBATIM into the record.
			const at = bound.clock();
			if (typeof at !== 'string' || at.length === 0) {
				return {
					ok: false,
					refusal: refused('corrupt-seam', 'THE DETERMINISM LAW', 'lookupTerm: the injected clock returned a malformed value (a non-empty ISO string is required - the kit never reads a clock itself)'),
				};
			}
			const registry = INDUSTRY_TERM_RELATIONS[industry];
			return {
				ok: true,
				lookup: {
					at,
					industry,
					term,
					outgoingRelations: registry.filter((relation) => relation.fromTermKey === term!.termKey),
					incomingRelations: registry.filter((relation) => relation.toTermKey === term!.termKey),
				},
			};
		},
		async validateTermSet(industry: unknown, termKeys: unknown): Promise<OntologyTermSetOutcome> {
			const disposedRefusal = refuseIfDisposed('validateTermSet');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (!isHarnessIndustry(industry)) {
				return { ok: false, refusal: refuseUnknownIndustry('validateTermSet', industry) };
			}
			if (!Array.isArray(termKeys)) {
				return {
					ok: false,
					refusal: refused('malformed-term-set', 'THE FAIL-CLOSED LAW', 'validateTermSet: the termKeys carrier must be an array of strings (the selected terminology)', ['termKeys']),
				};
			}
			const nonStringMembers: string[] = [];
			for (let i = 0; i < termKeys.length; i += 1) {
				if (typeof termKeys[i] !== 'string') {
					nonStringMembers.push(`termKeys[${i}]`);
				}
			}
			if (nonStringMembers.length > 0) {
				return {
					ok: false,
					refusal: refused('malformed-term-set', 'THE FAIL-CLOSED LAW', `validateTermSet: the member(s) ${showList(nonStringMembers)} must be strings (a termKey is a kebab-case identifier)`, nonStringMembers),
				};
			}
			const keys = termKeys as string[];
			if (keys.length === 0) {
				return {
					ok: false,
					refusal: refused('empty-term-set', 'THE FAIL-CLOSED LAW', 'validateTermSet: the selected terminology is non-empty (at least one termKey)', ['termKeys']),
				};
			}
			const catalog = INDUSTRY_TERM_CATALOGS[industry];
			const catalogKeys = new Set(catalog.map((candidate) => candidate.termKey));
			const unresolved = keys.filter((key) => !catalogKeys.has(key));
			if (unresolved.length > 0) {
				return {
					ok: false,
					refusal: refused(
						'unknown-term-ref',
						'THE INTEGRITY LAW',
						`validateTermSet: every selected termKey must resolve in the ${industry} catalog - the offender(s) ${showList(unresolved)} do not resolve`,
						unresolved,
					),
				};
			}
			const duplicates = findDuplicates(keys);
			if (duplicates.length > 0) {
				return {
					ok: false,
					refusal: refused('duplicate-term-keys', 'THE FAIL-CLOSED LAW', `validateTermSet: the selected termKeys are duplicate-free (a term appears once) - the duplicate(s) ${showList(duplicates)}`, duplicates),
				};
			}
			// the ok result carries the resolved terms in CATALOG order (never caller order - the catalog is the vocabulary's order).
			const selected = new Set(keys);
			return { ok: true, industry, terms: catalog.filter((candidate) => selected.has(candidate.termKey)) };
		},
		async inspectCatalog(industry: unknown): Promise<OntologyCatalogOutcome> {
			const disposedRefusal = refuseIfDisposed('inspectCatalog');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (!isHarnessIndustry(industry)) {
				return { ok: false, refusal: refuseUnknownIndustry('inspectCatalog', industry) };
			}
			// BY REFERENCE: the frozen catalog + registry themselves (the battery pins the identity).
			return { ok: true, industry, terms: INDUSTRY_TERM_CATALOGS[industry], relations: INDUSTRY_TERM_RELATIONS[industry] };
		},
		async relationIntegrityReport(industry: unknown): Promise<OntologyIntegrityOutcome> {
			const disposedRefusal = refuseIfDisposed('relationIntegrityReport');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (!isHarnessIndustry(industry)) {
				return { ok: false, refusal: refuseUnknownIndustry('relationIntegrityReport', industry) };
			}
			const terms = INDUSTRY_TERM_CATALOGS[industry];
			const relations = INDUSTRY_TERM_RELATIONS[industry];
			const findings = walkRelationIntegrity(terms, relations);
			return {
				ok: true,
				report: {
					industry,
					termCount: terms.length,
					relationCount: relations.length,
					clean: findings.length === 0,
					findings,
				},
			};
		},
		dispose(): void {
			disposed = true;
		},
	};
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
}

/** The fail-closed factory walk (the DH-01 message shapes, the createOntologyKit prefix). */
function validateKitOptions(options: OntologyKitOptions): BoundOptions {
	if (!isRecord(options)) {
		throw new TypeError('createOntologyKit: options must be an object');
	}
	const opts = options as Record<string, unknown>;
	if (typeof opts.clock !== 'function') {
		throw new TypeError(
			'createOntologyKit: options.clock must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const clock = opts.clock as () => string;
	const firstClock = clock();
	if (typeof firstClock !== 'string' || firstClock.length === 0) {
		throw new TypeError('createOntologyKit: options.clock() must return a non-empty ISO string (the injected-clock law)');
	}
	return { clock };
}

/** Builds the typed refusal (the work order's single-refusal shape). */
function refused(reason: OntologyKitRefusalReason, law: string, message: string, items?: readonly string[]): OntologyKitRefusal {
	if (items === undefined) {
		return { reason, law, message };
	}
	return { reason, law, message, items };
}

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The duplicated members of a list (each duplicate reported once, in first-seen order). */
function findDuplicates(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const reported = new Set<string>();
	const duplicates: string[] = [];
	for (const value of values) {
		if (seen.has(value) && !reported.has(value)) {
			reported.add(value);
			duplicates.push(value);
		}
		seen.add(value);
	}
	return duplicates;
}

/** Shows a value for a deterministic message sentence (primitives only, never a full dump). */
function showValue(value: unknown): string {
	if (typeof value === 'string') {
		return value.length === 0 ? '<empty string>' : value;
	}
	if (value === null) {
		return '<null>';
	}
	if (value === undefined) {
		return '<undefined>';
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return '<array>';
	}
	return '<object>';
}

/** Shows a list of keys for a deterministic message sentence. */
function showList(values: readonly string[]): string {
	return `[${values.join(', ')}]`;
}
