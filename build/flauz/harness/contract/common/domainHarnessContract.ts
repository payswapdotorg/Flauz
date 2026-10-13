/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-001 DomainHarness contract family: the typed composable-configuration
 * vocabulary for the Domain Harness OS direction (MASTER-ROADMAP.md - the
 * product must transform into the domain-specific work harness selected by
 * a user during onboarding). A harness is COMPOSABLE CONFIGURATION OVER
 * THE UNIVERSAL FLAUZ CORE, NOT an industry-specific fork: the frozen
 * industry / work-type vocabularies (the onboarding selection lists), the
 * forward-only harness lifecycle machine (retired is terminal), the typed
 * reference-only descriptor with its NO-FORK and NO-DANGLING-REF
 * validation, the injected read-only catalog snapshot seam, and the
 * canonical fixed-key-order serialization with the fail-closed parse
 * (contract module, the labContracts discipline; the W7 production ops
 * contract family is the landed precedent and its laws are INHERITED and
 * binding here as the closest sibling).
 *
 * LAWS (DH-001 work order; ARCHITECTURE-LOCK; the landed family
 * precedents):
 * - THE NO-FORK LAW (binding, this family's charter): a harness is
 *   composable configuration over the universal Flauz core. The
 *   descriptor's alphabet is REFERENCES ONLY - it cannot carry commands,
 *   tools, implementations, code, patches or any execution material; the
 *   shape guards enforce this structurally and every violation is the
 *   typed NO-FORK rejection. The structural engine has three stations:
 *   (a) the strict-schema parse rejects every UNKNOWN key; (b) the
 *   forbidden-key family ('command', 'commands', 'tool', 'tools',
 *   'implementation', 'code', 'script', 'inline', 'patch', 'fork') is
 *   rejected with the typed NO-FORK rejection even before the strict
 *   schema's unknown-key rejection would fire; (c) role entries carry
 *   only roleKey+summary - any additional key is the NO-FORK rejection.
 *   A named role is CONFIGURATION (a key + a human summary); it grants
 *   NOTHING by itself.
 * - THE NO-DANGLING-REF LAW (binding): every reference must resolve
 *   against the injected catalog snapshot at the propose boundary - a
 *   dangling ref is the typed DANGLING_REF rejection listing every
 *   offender, never a silent skip. Each dangling family (capabilityRefs,
 *   workflowRefs, policyRefs, evidenceRefs) is reported with its own
 *   offending refs. A malformed catalog snapshot resolves nothing
 *   (fail-closed: the dangling phase reports every ref as dangling).
 * - THE FROZEN-VOCABULARY LAW (binding): the industry and work-type
 *   lists are frozen with their exact list order; membership is the only
 *   admissibility; the tests pin both lists verbatim. workTypes is a
 *   non-empty, duplicate-free ordered subset of the frozen list (the
 *   list order preserved).
 * - THE FORWARD-ONLY LIFECYCLE LAW (binding): draft -> proposed ->
 *   approved -> active -> retired; typed forward transitions only;
 *   retired is TERMINAL (no reopen - a changed harness is a NEW harness
 *   id, the registry lineage law); the descriptor is immutable (a change
 *   is a new mint - no in-place mutation, the registry drift law).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...), no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes.
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed outcome
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal.
 * - THE SINGLE-VERSION LAW (binding): DOMAIN_HARNESS_CONTRACTS_VERSION
 *   is '1.0.0' declared ONCE in this contract module, re-carried by the
 *   kit; the battery pins both copies equal.
 * - FROZEN REJECTION VOCABULARIES: the validation walk collects EVERY
 *   violated law into the typed rejection table (each rejection a typed
 *   member of the frozen HARNESS_VALIDATION_REJECTION_REASONS list, in
 *   the exact walk order); the parse walk is first-failure-is-the-
 *   verdict over the frozen HARNESS_PARSE_REJECTION_REASONS list.
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

/** THE SINGLE-VERSION LAW: declared ONCE here, re-carried by the kit. */
export const DOMAIN_HARNESS_CONTRACTS_VERSION = '1.0.0';

/** The harness id prefix (the family's namespace). */
export const HARNESS_ID_PREFIX = 'flauz:hrn:';

/**
 * The closed frozen industry vocabulary: the onboarding selection list
 * (the user picks exactly one industry during onboarding; the harness
 * instantiates over it). The list is FROZEN at DH-001 and bound by
 * DH-002+; widening or reordering it is a versioned contract decision.
 */
export const HARNESS_INDUSTRIES = [
	'software',
	'legal',
	'finance',
	'healthcare',
	'education',
	'marketing',
	'science',
	'media',
	'construction',
	'logistics',
	'retail',
	'manufacturing',
	'energy',
	'agriculture',
	'government',
	'hospitality',
] as const;
export type HarnessIndustry = (typeof HARNESS_INDUSTRIES)[number];

/** Pure predicate over the closed industry list. */
export function isHarnessIndustry(value: unknown): value is HarnessIndustry {
	return (HARNESS_INDUSTRIES as readonly string[]).includes(value as string);
}

/**
 * The closed frozen work-type vocabulary: the kinds of work a harness
 * composes (the workTypes field is a non-empty, duplicate-free ordered
 * subset of this list, the frozen list order preserved). The list is
 * FROZEN at DH-001 and bound by DH-002+.
 */
export const HARNESS_WORK_TYPES = [
	'analysis',
	'drafting',
	'review',
	'planning',
	'research',
	'reporting',
	'data-processing',
	'compliance',
	'communication',
	'administration',
] as const;
export type HarnessWorkType = (typeof HARNESS_WORK_TYPES)[number];

/** Pure predicate over the closed work-type list. */
export function isHarnessWorkType(value: unknown): value is HarnessWorkType {
	return (HARNESS_WORK_TYPES as readonly string[]).includes(value as string);
}

/**
 * The closed frozen lifecycle state vocabulary: draft -> proposed ->
 * approved -> active -> retired (forward-only; retired is TERMINAL).
 */
export const HARNESS_LIFECYCLE_STATES = [
	'draft',
	'proposed',
	'approved',
	'active',
	'retired',
] as const;
export type HarnessLifecycleState = (typeof HARNESS_LIFECYCLE_STATES)[number];

/** Pure predicate over the closed lifecycle-state list. */
export function isHarnessLifecycleState(value: unknown): value is HarnessLifecycleState {
	return (HARNESS_LIFECYCLE_STATES as readonly string[]).includes(value as string);
}

/** One whitelisted forward transition row (THE FORWARD-ONLY LIFECYCLE LAW's whitelist). */
export interface HarnessLifecycleTransition {
	readonly from: HarnessLifecycleState;
	readonly to: HarnessLifecycleState;
}

/**
 * The frozen forward-only whitelist: the ONLY legal transitions are
 * draft->proposed, proposed->approved, approved->active, active->retired.
 * 'retired' is TERMINAL - no reopen; a changed harness is a NEW harness
 * id (the registry lineage law). Widening the map is a versioned
 * contract decision.
 */
export const HARNESS_LIFECYCLE_FORWARD_TRANSITIONS = [
	{ from: 'draft', to: 'proposed' },
	{ from: 'proposed', to: 'approved' },
	{ from: 'approved', to: 'active' },
	{ from: 'active', to: 'retired' },
] as const;

/**
 * THE NO-FORK LAW's forbidden-key family: execution-material key names
 * that can NEVER appear on a descriptor (or on a role entry). The
 * descriptor alphabet is references only - a harness is composable
 * configuration over the universal Flauz core, never an
 * industry-specific fork.
 */
export const FORBIDDEN_HARNESS_DESCRIPTOR_KEYS = [
	'command',
	'commands',
	'tool',
	'tools',
	'implementation',
	'code',
	'script',
	'inline',
	'patch',
	'fork',
] as const;

/**
 * The frozen descriptor schema: the exact ten keys of a
 * DomainHarnessDescriptor, in the canonical fixed-key-order (the
 * serialization order). The strict-schema parse rejects every key
 * outside this list (the forbidden-key family is typed as NO-FORK
 * first, per the precedence law).
 */
export const HARNESS_DESCRIPTOR_SCHEMA_KEYS = [
	'harnessId',
	'contractVersion',
	'industry',
	'workTypes',
	'displayName',
	'roles',
	'capabilityRefs',
	'workflowRefs',
	'policyRefs',
	'evidenceRefs',
] as const;

/**
 * THE CATALOG-BINDING LAW's allowed capability states: a harness is
 * NEVER approved over an unapproved capability - every capabilityRef
 * must sit at one of these states in the catalog snapshot at the
 * approve boundary (fail-closed escalation). The names mirror the
 * CR-006 capability registry's stable interface states.
 */
export const HARNESS_CAPABILITY_BINDING_STATES = [
	'approved',
	'enabled',
	'available',
] as const;

/**
 * Closed frozen list of descriptor validation rejection reasons, in the
 * exact walk order (the walk collects EVERY violated law into the typed
 * rejection table; the table's records appear in this order):
 *   malformed-descriptor      - the candidate is not a plain object, or
 *                               a field carries the wrong structural
 *                               type (a non-array workTypes/roles/refs
 *                               carrier, a non-object role entry, a
 *                               non-string ref member);
 *   no-fork                   - THE NO-FORK LAW: a forbidden
 *                               execution-material key on the
 *                               descriptor, or an extra key on a role
 *                               entry (fires BEFORE the unknown-key
 *                               rejection for the forbidden family);
 *   unknown-key               - THE NO-FORK LAW's strict-schema
 *                               engine: a descriptor key outside the
 *                               frozen schema (and outside the
 *                               forbidden family);
 *   missing-key               - a required descriptor key is absent;
 *   unknown-harness-id        - the harnessId is not the
 *                               flauz:hrn:<16-hex> form;
 *   version-mismatch          - THE SINGLE-VERSION LAW: the
 *                               contractVersion is not
 *                               DOMAIN_HARNESS_CONTRACTS_VERSION;
 *   unknown-industry          - THE FROZEN-VOCABULARY LAW: the
 *                               industry is not a member;
 *   empty-work-types          - workTypes is empty;
 *   unknown-work-type         - a workTypes member is not in the
 *                               frozen list;
 *   duplicate-work-types      - workTypes carries repeats;
 *   work-types-out-of-order   - workTypes violates the frozen list
 *                               order;
 *   invalid-display-name      - displayName is empty or longer than 80
 *                               characters;
 *   empty-roles               - roles is empty;
 *   malformed-role            - a role entry is not { roleKey,
 *                               summary } with non-empty strings;
 *   duplicate-role-keys       - roleKeys are not unique;
 *   duplicate-ref             - a ref family carries repeats;
 *   dangling-ref              - THE NO-DANGLING-REF LAW: a ref does
 *                               not resolve in the catalog snapshot
 *                               (the full walk only - allowed at
 *                               draft, enforced at the propose
 *                               boundary).
 * Widening or reordering the list is a versioned contract decision.
 */
export const HARNESS_VALIDATION_REJECTION_REASONS = [
	'malformed-descriptor',
	'no-fork',
	'unknown-key',
	'missing-key',
	'unknown-harness-id',
	'version-mismatch',
	'unknown-industry',
	'empty-work-types',
	'unknown-work-type',
	'duplicate-work-types',
	'work-types-out-of-order',
	'invalid-display-name',
	'empty-roles',
	'malformed-role',
	'duplicate-role-keys',
	'duplicate-ref',
	'dangling-ref',
] as const;
export type HarnessValidationRejectionReason = (typeof HARNESS_VALIDATION_REJECTION_REASONS)[number];

/** Pure predicate over the closed validation-rejection list. */
export function isHarnessValidationRejectionReason(value: unknown): value is HarnessValidationRejectionReason {
	return (HARNESS_VALIDATION_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The four reference families of the descriptor (the reference-only alphabet). */
export const HARNESS_REF_FAMILIES = [
	'capabilityRefs',
	'workflowRefs',
	'policyRefs',
	'evidenceRefs',
] as const;
export type HarnessRefFamily = (typeof HARNESS_REF_FAMILIES)[number];

/**
 * One typed rejection from the validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. The dangling-ref and duplicate-ref rejections carry
 * the ref family they name.
 */
export interface HarnessValidationRejection {
	readonly reason: HarnessValidationRejectionReason;
	readonly law: string;
	readonly family?: HarnessRefFamily;
	readonly items: readonly string[];
	readonly detail: string;
}

/**
 * The validation phase (THE TWO-PHASE LAW): 'shape' is the mint-time
 * walk (frozen-vocab + NO-FORK immediately; dangling refs ALLOWED at
 * draft - the onboarding flow composes references gradually); 'full'
 * is the propose-boundary walk (the NO-DANGLING check included).
 */
export type HarnessValidationMode = 'shape' | 'full';

/**
 * The typed validation outcome: ok carries the canonical fixed-key-order
 * copy of the validated descriptor and the mode; refusal carries the
 * typed rejection table listing EVERY violated law with its offending
 * items (never a bare throw, never a silent partial verdict).
 */
export type HarnessValidationOutcome =
	| { readonly ok: true; readonly mode: HarnessValidationMode; readonly descriptor: DomainHarnessDescriptor }
	| { readonly ok: false; readonly mode: HarnessValidationMode; readonly rejections: readonly HarnessValidationRejection[] };

/**
 * A named harness role: CONFIGURATION ONLY - a roleKey plus a human
 * summary. A named role grants NOTHING by itself (THE NO-FORK LAW's
 * third station: role entries carry only these two keys; any
 * additional key is the typed NO-FORK rejection).
 */
export interface HarnessRole {
	readonly roleKey: string;
	readonly summary: string;
}

/**
 * THE REFERENCE-ONLY descriptor: the composable configuration a
 * harness IS. The harnessId (flauz:hrn:<16-hex> - minted from the
 * injected rng at the kit boundary, never caller-supplied), the
 * contractVersion (THE SINGLE-VERSION LAW), the industry (one
 * HARNESS_INDUSTRIES member), the workTypes (a non-empty,
 * duplicate-free ordered subset of HARNESS_WORK_TYPES, the frozen list
 * order preserved), the displayName (non-empty, at most 80 chars), the
 * roles (non-empty, unique roleKeys), and the four reference families
 * (string arrays; duplicate-free; MAY be empty - a draft composes
 * gradually). The alphabet is REFERENCES ONLY (THE NO-FORK LAW).
 */
export interface DomainHarnessDescriptor {
	readonly harnessId: string;
	readonly contractVersion: string;
	readonly industry: HarnessIndustry;
	readonly workTypes: readonly HarnessWorkType[];
	readonly displayName: string;
	readonly roles: readonly HarnessRole[];
	readonly capabilityRefs: readonly string[];
	readonly workflowRefs: readonly string[];
	readonly policyRefs: readonly string[];
	readonly evidenceRefs: readonly string[];
}

/**
 * The injected READ-ONLY resolution surface (the stable-seam
 * discipline: DH-002+ binds the real authorities - the CR-006
 * capability registry, the workflow / policy / evidence authorities;
 * tests inject fixtures). The capabilities mirror the registry's
 * entry/state shape ({ entryId, state }); the binding law reads the
 * state at the approve boundary.
 */
export interface HarnessCatalogSnapshot {
	readonly capabilities: ReadonlyArray<{ readonly entryId: string; readonly state: string }>;
	readonly workflowIds: readonly string[];
	readonly policyIds: readonly string[];
	readonly evidenceIds: readonly string[];
}

/**
 * Pure predicate: a well-formed catalog snapshot (the exact four keys;
 * capabilities an array of exact-two-key { entryId, state } entries
 * with non-empty strings and unique entryIds; the three id families
 * non-empty-string arrays, duplicate-free). Fails closed on every
 * malformed path; never mutates its input.
 */
export function isHarnessCatalogSnapshot(value: unknown): value is HarnessCatalogSnapshot {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = ['capabilities', 'evidenceIds', 'policyIds', 'workflowIds'];
	if (keys.length !== expected.length) {
		return false;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return false;
		}
	}
	if (!Array.isArray(record.capabilities)) {
		return false;
	}
	const seenEntryIds = new Set<string>();
	for (const entry of record.capabilities) {
		if (!isRecord(entry)) {
			return false;
		}
		const entryKeys = Object.keys(entry).sort();
		if (entryKeys.length !== 2 || entryKeys[0] !== 'entryId' || entryKeys[1] !== 'state') {
			return false;
		}
		const entryRecord = entry as Record<string, unknown>;
		if (typeof entryRecord.entryId !== 'string' || entryRecord.entryId.length === 0) {
			return false;
		}
		if (typeof entryRecord.state !== 'string' || entryRecord.state.length === 0) {
			return false;
		}
		if (seenEntryIds.has(entryRecord.entryId)) {
			return false;
		}
		seenEntryIds.add(entryRecord.entryId);
	}
	for (const family of ['workflowIds', 'policyIds', 'evidenceIds'] as const) {
		const ids = record[family];
		if (!Array.isArray(ids)) {
			return false;
		}
		const seen = new Set<string>();
		for (const id of ids) {
			if (typeof id !== 'string' || id.length === 0) {
				return false;
			}
			if (seen.has(id)) {
				return false;
			}
			seen.add(id);
		}
	}
	return true;
}

/** Pure predicate: a well-formed harness id (flauz:hrn:<16-hex>). */
export function isHarnessId(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	if (!value.startsWith(HARNESS_ID_PREFIX)) {
		return false;
	}
	const hex = value.slice(HARNESS_ID_PREFIX.length);
	return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * The typed lifecycle verdict: ok carries the granting whitelist row
 * (1-based); refusal is the ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row (the row whose from-state matches, null when
 * none does), the whitelisted successor (expectedTo, null when the
 * from-state is terminal or unknown), and the deterministic detail
 * sentence. Forward-only; 'retired' is TERMINAL.
 */
export type HarnessLifecycleVerdict =
	| { readonly ok: true; readonly from: HarnessLifecycleState; readonly to: HarnessLifecycleState; readonly row: number }
	| {
			readonly ok: false;
			readonly reason: 'ILLEGAL_TRANSITION';
			readonly from: unknown;
			readonly to: unknown;
			readonly whitelistRow: number | null;
			readonly expectedTo: HarnessLifecycleState | null;
			readonly detail: string;
		};

/**
 * THE FORWARD-ONLY LIFECYCLE LAW's verdict machine (pure): the exact
 * whitelist membership check. The only legal transitions are
 * draft->proposed, proposed->approved, approved->active,
 * active->retired; every other edge (skips, backwards moves,
 * self-loops, retired->anything, unknown states, non-strings) is the
 * typed ILLEGAL_TRANSITION rejection naming the violated whitelist row.
 */
export function canTransitionHarnessLifecycle(from: unknown, to: unknown): HarnessLifecycleVerdict {
	const transitions = HARNESS_LIFECYCLE_FORWARD_TRANSITIONS as readonly HarnessLifecycleTransition[];
	let rowNumber = 0;
	for (let i = 0; i < transitions.length; i += 1) {
		if (transitions[i].from === from) {
			rowNumber = i + 1;
			break;
		}
	}
	if (!isHarnessLifecycleState(from) || !isHarnessLifecycleState(to)) {
		return {
			ok: false,
			reason: 'ILLEGAL_TRANSITION',
			from,
			to,
			whitelistRow: rowNumber > 0 ? rowNumber : null,
			expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
			detail: `canTransitionHarnessLifecycle: '${showValue(from)}' -> '${showValue(to)}' is refused - both states must be members of the frozen HARNESS_LIFECYCLE_STATES list (THE FORWARD-ONLY LIFECYCLE LAW - the lifecycle vocabulary is frozen)`,
		};
	}
	if (rowNumber === 0) {
		return {
			ok: false,
			reason: 'ILLEGAL_TRANSITION',
			from,
			to,
			whitelistRow: null,
			expectedTo: null,
			detail: `canTransitionHarnessLifecycle: '${from}' -> '${to}' is refused - 'retired' is TERMINAL (no reopen; a changed harness is a NEW harness id, the registry lineage law) (THE FORWARD-ONLY LIFECYCLE LAW)`,
		};
	}
	const expectedTo = transitions[rowNumber - 1].to;
	if (expectedTo !== to) {
		return {
			ok: false,
			reason: 'ILLEGAL_TRANSITION',
			from,
			to,
			whitelistRow: rowNumber,
			expectedTo,
			detail: `canTransitionHarnessLifecycle: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LIFECYCLE LAW - forward-only; retired is terminal)`,
		};
	}
	return { ok: true, from, to, row: rowNumber };
}

/**
 * THE TWO-PHASE LAW's draft mode: the shape-only walk (frozen-vocab +
 * NO-FORK + id/version/displayName + roles + ref-array shape), the
 * dangling refs ALLOWED (a draft composes gradually; resolution is
 * enforced at the propose boundary by
 * validateDomainHarnessDescriptor). The mint boundary calls this walk
 * IMMEDIATELY.
 */
export function validateHarnessDescriptorShape(descriptor: unknown): HarnessValidationOutcome {
	return walkDescriptor(descriptor, undefined, 'shape');
}

/**
 * The FULL validation walk (the propose boundary): every shape law AND
 * THE NO-DANGLING-REF LAW - every capabilityRef must resolve in
 * catalog.capabilities, every workflowRef in catalog.workflowIds,
 * policyRef in catalog.policyIds, evidenceRef in catalog.evidenceIds;
 * each dangling family is reported with its offending refs. A
 * malformed catalog snapshot resolves nothing (fail-closed: every ref
 * in a non-empty family dangles). Ok carries the canonical
 * fixed-key-order descriptor copy.
 */
export function validateDomainHarnessDescriptor(descriptor: unknown, catalog: unknown): HarnessValidationOutcome {
	return walkDescriptor(descriptor, catalog, 'full');
}

// --- the descriptor walk (internal; the pure engine behind both modes) ---

function walkDescriptor(descriptor: unknown, catalog: unknown, mode: HarnessValidationMode): HarnessValidationOutcome {
	const rejections: HarnessValidationRejection[] = [];
	if (!isRecord(descriptor)) {
		rejections.push({
			reason: 'malformed-descriptor',
			law: 'THE FAIL-CLOSED LAW',
			items: ['descriptor'],
			detail: 'walkDescriptor: the descriptor must be a plain object (never a silent partial verdict)',
		});
		return { ok: false, mode, rejections };
	}
	const record = descriptor as Record<string, unknown>;
	const keys = Object.keys(record);

	// NO-FORK station (b): the forbidden-key family, BEFORE the unknown-key scan (the precedence law).
	const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
	if (forbiddenPresent.length > 0) {
		rejections.push({
			reason: 'no-fork',
			law: 'THE NO-FORK LAW',
			items: forbiddenPresent,
			detail: `walkDescriptor: the descriptor alphabet is REFERENCES ONLY - a harness is composable configuration over the universal Flauz core, never an industry-specific fork; the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on a DomainHarnessDescriptor`,
		});
	}

	// NO-FORK station (a): the strict-schema unknown-key scan (the forbidden family already typed above).
	const unknownKeys = keys.filter(
		(key) =>
			!(HARNESS_DESCRIPTOR_SCHEMA_KEYS as readonly string[]).includes(key)
			&& !(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).includes(key),
	);
	if (unknownKeys.length > 0) {
		rejections.push({
			reason: 'unknown-key',
			law: 'THE NO-FORK LAW',
			items: unknownKeys,
			detail: `walkDescriptor: the strict descriptor schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the descriptor alphabet is references only)`,
		});
	}

	// The missing-key scan (the strict schema requires every key).
	const missingKeys = (HARNESS_DESCRIPTOR_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
	if (missingKeys.length > 0) {
		rejections.push({
			reason: 'missing-key',
			law: 'THE FAIL-CLOSED LAW',
			items: missingKeys,
			detail: `walkDescriptor: the strict descriptor schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
		});
	}

	// The id shape.
	if (!isHarnessId(record.harnessId)) {
		rejections.push({
			reason: 'unknown-harness-id',
			law: 'THE FAIL-CLOSED LAW',
			items: [showValue(record.harnessId)],
			detail: `walkDescriptor: the harnessId must be the ${HARNESS_ID_PREFIX}<16-hex> form (minted from the injected rng, never caller-supplied)`,
		});
	}

	// THE SINGLE-VERSION LAW.
	if (record.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		rejections.push({
			reason: 'version-mismatch',
			law: 'THE SINGLE-VERSION LAW',
			items: [showValue(record.contractVersion)],
			detail: `walkDescriptor: the descriptor must carry DOMAIN_HARNESS_CONTRACTS_VERSION '${DOMAIN_HARNESS_CONTRACTS_VERSION}' exactly (the single-version law - declared once, re-carried by the kit)`,
		});
	}

	// THE FROZEN-VOCABULARY LAW: the industry.
	if (!isHarnessIndustry(record.industry)) {
		rejections.push({
			reason: 'unknown-industry',
			law: 'THE FROZEN-VOCABULARY LAW',
			items: [showValue(record.industry)],
			detail: 'walkDescriptor: the industry must be a member of the frozen HARNESS_INDUSTRIES list (membership is the only admissibility)',
		});
	}

	// THE FROZEN-VOCABULARY LAW: the workTypes subset.
	if (!Array.isArray(record.workTypes)) {
		rejections.push({
			reason: 'malformed-descriptor',
			law: 'THE FAIL-CLOSED LAW',
			items: ['workTypes'],
			detail: 'walkDescriptor: workTypes must be an array (the ordered subset of the frozen HARNESS_WORK_TYPES list)',
		});
	} else {
		const workTypes = record.workTypes as unknown[];
		if (workTypes.length === 0) {
			rejections.push({
				reason: 'empty-work-types',
				law: 'THE FROZEN-VOCABULARY LAW',
				items: ['workTypes'],
				detail: 'walkDescriptor: workTypes must be a non-empty ordered subset of the frozen HARNESS_WORK_TYPES list',
			});
		}
		const nonMembers = workTypes.filter((member) => !isHarnessWorkType(member)).map((member) => showValue(member));
		if (nonMembers.length > 0) {
			rejections.push({
				reason: 'unknown-work-type',
				law: 'THE FROZEN-VOCABULARY LAW',
				items: nonMembers,
				detail: 'walkDescriptor: every workTypes member must be in the frozen HARNESS_WORK_TYPES list (membership is the only admissibility)',
			});
		}
		const duplicates = findDuplicates(workTypes.map((member) => showValue(member)));
		if (duplicates.length > 0) {
			rejections.push({
				reason: 'duplicate-work-types',
				law: 'THE FROZEN-VOCABULARY LAW',
				items: duplicates,
				detail: 'walkDescriptor: workTypes must be duplicate-free (the ordered subset carries no repeats)',
			});
		}
		const inversion = findOrderInversion(workTypes);
		if (inversion !== null) {
			rejections.push({
				reason: 'work-types-out-of-order',
				law: 'THE FROZEN-VOCABULARY LAW',
				items: inversion,
				detail: 'walkDescriptor: workTypes must preserve the frozen HARNESS_WORK_TYPES list order (the pair above is inverted)',
			});
		}
	}

	// The displayName bounds.
	if (typeof record.displayName !== 'string' || record.displayName.length === 0 || record.displayName.length > 80) {
		rejections.push({
			reason: 'invalid-display-name',
			law: 'THE FAIL-CLOSED LAW',
			items: [typeof record.displayName === 'string' ? `${record.displayName.length} chars` : showValue(record.displayName)],
			detail: 'walkDescriptor: displayName must be a non-empty string of at most 80 characters',
		});
	}

	// The roles family.
	if (!Array.isArray(record.roles)) {
		rejections.push({
			reason: 'malformed-descriptor',
			law: 'THE FAIL-CLOSED LAW',
			items: ['roles'],
			detail: 'walkDescriptor: roles must be an array (a harness names its domain roles)',
		});
	} else {
		const roles = record.roles as unknown[];
		if (roles.length === 0) {
			rejections.push({
				reason: 'empty-roles',
				law: 'THE FAIL-CLOSED LAW',
				items: ['roles'],
				detail: 'walkDescriptor: roles must be a non-empty array (a harness names its domain roles)',
			});
		}
		for (let i = 0; i < roles.length; i += 1) {
			const role = roles[i];
			if (!isRecord(role)) {
				rejections.push({
					reason: 'malformed-role',
					law: 'THE FAIL-CLOSED LAW',
					items: [`roles[${i}]`],
					detail: 'walkDescriptor: every role entry must be { roleKey, summary } with non-empty strings (a named role is configuration)',
				});
				continue;
			}
			const roleRecord = role as Record<string, unknown>;
			if (typeof roleRecord.roleKey !== 'string' || roleRecord.roleKey.length === 0 || typeof roleRecord.summary !== 'string' || roleRecord.summary.length === 0) {
				rejections.push({
					reason: 'malformed-role',
					law: 'THE FAIL-CLOSED LAW',
					items: [`roles[${i}]`],
					detail: 'walkDescriptor: every role entry must be { roleKey, summary } with non-empty strings (a named role is configuration)',
				});
			}
			// NO-FORK station (c): role entries carry only roleKey+summary.
			const extraRoleKeys = Object.keys(roleRecord).filter((key) => key !== 'roleKey' && key !== 'summary');
			if (extraRoleKeys.length > 0) {
				rejections.push({
					reason: 'no-fork',
					law: 'THE NO-FORK LAW',
					items: extraRoleKeys.map((key) => `roles[${i}].${key}`),
					detail: 'walkDescriptor: a named role is CONFIGURATION (a roleKey + a human summary) - it grants NOTHING by itself; the extra key(s) above are execution material and cannot appear on a role entry',
				});
			}
		}
		const roleKeyDuplicates = findDuplicates(
			roles.filter((role) => isRecord(role) && typeof (role as Record<string, unknown>).roleKey === 'string').map(
				(role) => (role as Record<string, unknown>).roleKey as string,
			),
		);
		if (roleKeyDuplicates.length > 0) {
			rejections.push({
				reason: 'duplicate-role-keys',
				law: 'THE FAIL-CLOSED LAW',
				items: roleKeyDuplicates,
				detail: 'walkDescriptor: roleKeys must be unique (a named role appears once)',
			});
		}
	}

	// The four reference families (shape first, then the dangling phase).
	const catalogUsable = isHarnessCatalogSnapshot(catalog);
	for (const family of HARNESS_REF_FAMILIES) {
		const refs = record[family];
		if (!Array.isArray(refs)) {
			rejections.push({
				reason: 'malformed-descriptor',
				law: 'THE FAIL-CLOSED LAW',
				items: [family],
				detail: `walkDescriptor: ${family} must be a string array (the reference-only alphabet; MAY be empty - a draft composes gradually)`,
			});
			continue;
		}
		const nonStringMembers: string[] = [];
		for (let i = 0; i < refs.length; i += 1) {
			if (typeof refs[i] !== 'string') {
				nonStringMembers.push(`${family}[${i}]`);
			}
		}
		if (nonStringMembers.length > 0) {
			rejections.push({
				reason: 'malformed-descriptor',
				law: 'THE FAIL-CLOSED LAW',
				items: nonStringMembers,
				detail: `walkDescriptor: every ${family} member must be a string (the reference-only alphabet)`,
			});
			continue;
		}
		const duplicates = findDuplicates(refs as string[]);
		if (duplicates.length > 0) {
			rejections.push({
				reason: 'duplicate-ref',
				law: 'THE FAIL-CLOSED LAW',
				family,
				items: duplicates,
				detail: `walkDescriptor: the ${family} array must be duplicate-free (a reference appears once)`,
			});
		}
		if (mode === 'full') {
			const known = catalogUsable ? resolveFamily(catalog, family) : new Set<string>();
			const dangling = (refs as string[]).filter((ref) => !known.has(ref));
			if (dangling.length > 0) {
				rejections.push({
					reason: 'dangling-ref',
					law: 'THE NO-DANGLING-REF LAW',
					family,
					items: dangling,
					detail: `walkDescriptor: every ${family} member must resolve in the injected catalog snapshot (a dangling ref is never a silent skip)`,
				});
			}
		}
	}

	if (rejections.length > 0) {
		return { ok: false, mode, rejections };
	}
	return { ok: true, mode, descriptor: canonicalDescriptor(record as unknown as DomainHarnessDescriptor) };
}

/** Resolves one ref family against the catalog snapshot (pure set build). */
function resolveFamily(catalog: unknown, family: HarnessRefFamily): Set<string> {
	const snapshot = catalog as HarnessCatalogSnapshot;
	if (family === 'capabilityRefs') {
		return new Set<string>(snapshot.capabilities.map((entry) => entry.entryId));
	}
	if (family === 'workflowRefs') {
		return new Set<string>(snapshot.workflowIds);
	}
	if (family === 'policyRefs') {
		return new Set<string>(snapshot.policyIds);
	}
	return new Set<string>(snapshot.evidenceIds);
}

/**
 * Builds the canonical fixed-key-order copy of a validated descriptor
 * (HARNESS_DESCRIPTOR_SCHEMA_KEYS order; roles entries in the
 * roleKey,summary order). Never re-orders the caller's arrays - the
 * workTypes/roles/refs orders are the descriptor's own, already
 * validated.
 */
function canonicalDescriptor(descriptor: DomainHarnessDescriptor): DomainHarnessDescriptor {
	return {
		harnessId: descriptor.harnessId,
		contractVersion: descriptor.contractVersion,
		industry: descriptor.industry,
		workTypes: [...descriptor.workTypes],
		displayName: descriptor.displayName,
		roles: descriptor.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
		capabilityRefs: [...descriptor.capabilityRefs],
		workflowRefs: [...descriptor.workflowRefs],
		policyRefs: [...descriptor.policyRefs],
		evidenceRefs: [...descriptor.evidenceRefs],
	};
}

/**
 * One provenance note in the harness history: which law granted the
 * mint/transition, which decision accompanied it, which clock reading
 * it landed at, and the deterministic detail sentence (fromState is
 * null ONLY on the mint note - the entry into 'draft').
 */
export interface HarnessTransitionNote {
	readonly at: string;
	readonly fromState: HarnessLifecycleState | null;
	readonly toState: HarnessLifecycleState;
	readonly law: string;
	readonly decision: Readonly<Record<string, string>> | null;
	readonly detail: string;
}

/**
 * The persisted per-harness record (the honest record): the id, the
 * re-carried contract version, the lifecycle state, the IMMUTABLE
 * descriptor, the mint timestamp, the revision count (the mint is
 * revision 1; every applied transition appends one), the full
 * transition history with provenance, and the last validation outcome
 * (the mint-time shape outcome, replaced by the full green outcome at
 * propose).
 */
export interface HarnessRecord {
	readonly harnessId: string;
	readonly contractVersion: string;
	readonly state: HarnessLifecycleState;
	readonly descriptor: DomainHarnessDescriptor;
	readonly mintedAtIso: string;
	readonly revision: number;
	readonly history: readonly HarnessTransitionNote[];
	readonly lastValidation: HarnessValidationOutcome;
}

/** The frozen record schema keys, in the canonical fixed-key-order. */
export const HARNESS_RECORD_SCHEMA_KEYS = [
	'harnessId',
	'contractVersion',
	'state',
	'descriptor',
	'mintedAtIso',
	'revision',
	'history',
	'lastValidation',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const HARNESS_NOTE_SCHEMA_KEYS = [
	'at',
	'fromState',
	'toState',
	'law',
	'decision',
	'detail',
] as const;

/**
 * The canonical decision key order (the frozen per-shape order shared
 * by the approve / activate / retire decisions): approvedBy,
 * activatedBy, retiredBy, note, reason - only the present keys are
 * emitted, in this order.
 */
export const HARNESS_DECISION_SCHEMA_KEYS = [
	'approvedBy',
	'activatedBy',
	'retiredBy',
	'note',
	'reason',
] as const;

/**
 * Closed frozen list of parse rejection reasons (the parse walk is
 * first-failure-is-the-verdict, in this exact order):
 *   malformed-json          - the bytes are not valid JSON;
 *   torn-envelope           - the bytes parse but the record envelope
 *                             is structurally incomplete or torn (a
 *                             non-object, a missing key, a value of
 *                             the wrong structural type - never a
 *                             silent partial parse);
 *   unknown-contract-version- the record (or its descriptor) carries a
 *                             contract version other than
 *                             DOMAIN_HARNESS_CONTRACTS_VERSION;
 *   unknown-key             - an extra key at the record, descriptor,
 *                             role or note level (tampered bytes);
 *   invalid-record          - the deep semantic walk refuses (a bad
 *                             id, a non-member state, a law-violating
 *                             descriptor, a malformed history note, a
 *                             malformed validation outcome).
 */
export const HARNESS_PARSE_REJECTION_REASONS = [
	'malformed-json',
	'torn-envelope',
	'unknown-contract-version',
	'unknown-key',
	'invalid-record',
] as const;
export type HarnessParseRejectionReason = (typeof HARNESS_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isHarnessParseRejectionReason(value: unknown): value is HarnessParseRejectionReason {
	return (HARNESS_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface HarnessParseRejection {
	readonly reason: HarnessParseRejectionReason;
	readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type HarnessParseOutcome =
	| { readonly ok: true; readonly record: HarnessRecord }
	| { readonly ok: false; readonly rejection: HarnessParseRejection };

/**
 * Pure predicate: a well-formed validation outcome (the shape the kit
 * mints, the records carry and the ledger lines embed). The ok branch
 * carries exactly { ok, mode, descriptor } with a shape-green
 * descriptor; the refused branch carries exactly { ok, mode,
 * rejections } with a non-empty typed rejection table.
 */
export function isHarnessValidationOutcome(value: unknown): value is HarnessValidationOutcome {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (record.ok === true) {
		const keys = Object.keys(record).sort();
		if (keys.length !== 3 || keys[0] !== 'descriptor' || keys[1] !== 'mode' || keys[2] !== 'ok') {
			return false;
		}
		if (record.mode !== 'shape' && record.mode !== 'full') {
			return false;
		}
		return walkDescriptor(record.descriptor, undefined, 'shape').ok;
	}
	if (record.ok === false) {
		const keys = Object.keys(record).sort();
		if (keys.length !== 3 || keys[0] !== 'mode' || keys[1] !== 'ok' || keys[2] !== 'rejections') {
			return false;
		}
		if (record.mode !== 'shape' && record.mode !== 'full') {
			return false;
		}
		if (!Array.isArray(record.rejections) || record.rejections.length === 0) {
			return false;
		}
		for (const rejection of record.rejections) {
			if (!isWellFormedRejection(rejection)) {
				return false;
			}
		}
		return true;
	}
	return false;
}

/** Pure predicate: a well-formed typed validation rejection record. */
export function isWellFormedRejection(value: unknown): value is HarnessValidationRejection {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expectedWithoutFamily = ['detail', 'items', 'law', 'reason'];
	const expectedWithFamily = ['detail', 'family', 'items', 'law', 'reason'];
	const matchesWithoutFamily = keys.length === expectedWithoutFamily.length && expectedWithoutFamily.every((key, index) => key === keys[index]);
	const matchesWithFamily = keys.length === expectedWithFamily.length && expectedWithFamily.every((key, index) => key === keys[index]);
	if (!matchesWithoutFamily && !matchesWithFamily) {
		return false;
	}
	if (!isHarnessValidationRejectionReason(record.reason)) {
		return false;
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return false;
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return false;
	}
	if (!Array.isArray(record.items)) {
		return false;
	}
	for (const item of record.items) {
		if (typeof item !== 'string') {
			return false;
		}
	}
	if (record.family !== undefined && !(HARNESS_REF_FAMILIES as readonly string[]).includes(record.family as string)) {
		return false;
	}
	return true;
}

/**
 * Pure predicate: a well-formed history note (the exact six keys; the
 * at/law/detail non-empty strings; fromState null-or-member;
 * toState a member; the decision null or a string-record with
 * non-empty values). Shape only - the chain legality is the ledger
 * replay's cross-check, not this guard.
 */
export function isHarnessTransitionNote(value: unknown): value is HarnessTransitionNote {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = ['at', 'decision', 'detail', 'fromState', 'law', 'toState'];
	if (keys.length !== expected.length) {
		return false;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return false;
		}
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return false;
	}
	if (record.fromState !== null && !isHarnessLifecycleState(record.fromState)) {
		return false;
	}
	if (!isHarnessLifecycleState(record.toState)) {
		return false;
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return false;
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return false;
	}
	if (record.decision !== null) {
		if (!isRecord(record.decision)) {
			return false;
		}
		for (const value of Object.values(record.decision)) {
			if (typeof value !== 'string' || value.length === 0) {
				return false;
			}
		}
	}
	return true;
}

/**
 * Pure deep shape guard: a well-formed harness record (the exact
 * eight keys; the id pattern; the version equality; the member state;
 * the descriptor shape-green; the non-empty mintedAtIso; the positive
 * integer revision; every history note well-formed; the
 * lastValidation a well-formed outcome). Fails closed on every
 * malformed path; never reads a clock; never mutates its input.
 */
export function isHarnessRecord(value: unknown): value is HarnessRecord {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...HARNESS_RECORD_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length) {
		return false;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return false;
		}
	}
	if (!isHarnessId(record.harnessId)) {
		return false;
	}
	if (record.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		return false;
	}
	if (!isHarnessLifecycleState(record.state)) {
		return false;
	}
	if (!walkDescriptor(record.descriptor, undefined, 'shape').ok) {
		return false;
	}
	if (typeof record.mintedAtIso !== 'string' || record.mintedAtIso.length === 0) {
		return false;
	}
	if (typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 1) {
		return false;
	}
	if (!Array.isArray(record.history)) {
		return false;
	}
	for (const note of record.history) {
		if (!isHarnessTransitionNote(note)) {
			return false;
		}
	}
	if (!isHarnessValidationOutcome(record.lastValidation)) {
		return false;
	}
	return true;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * harness record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests). The record keys emit in the HARNESS_RECORD_SCHEMA_KEYS
 * order, the descriptor keys in the HARNESS_DESCRIPTOR_SCHEMA_KEYS
 * order, the role entries in the roleKey,summary order, the history
 * notes in the HARNESS_NOTE_SCHEMA_KEYS order, the decisions in the
 * HARNESS_DECISION_SCHEMA_KEYS order (only the present keys), and the
 * validation outcomes in their own fixed order (ok: ok, mode,
 * descriptor; refused: ok, mode, rejections - each rejection in the
 * reason, law, family?, items, detail order). Throws TypeError on a
 * malformed record (never dishonest bytes).
 */
export function serializeHarnessRecord(record: unknown): string {
	if (!isHarnessRecord(record)) {
		throw new TypeError(
			'serializeHarnessRecord: record must satisfy isHarnessRecord - no dishonest harness record ever gets canonical bytes',
		);
	}
	return JSON.stringify(canonicalRecordObject(record));
}

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (record / descriptor / role / note level), or invalid content (the
 * deep semantic walk) - each a typed rejection naming the drift;
 * never a silent partial parse. First-failure-is-the-verdict, in the
 * frozen HARNESS_PARSE_REJECTION_REASONS order.
 */
export function parseHarnessRecord(bytes: unknown): HarnessParseOutcome {
	if (typeof bytes !== 'string') {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseHarnessRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
			},
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bytes);
	} catch (error) {
		return {
			ok: false,
			rejection: {
				reason: 'malformed-json',
				detail: `parseHarnessRecord: the bytes are not valid JSON: ${toMessage(error)}`,
			},
		};
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseHarnessRecord: the bytes must carry a JSON object (the record envelope)',
			},
		};
	}
	const record = parsed as Record<string, unknown>;
	for (const key of HARNESS_RECORD_SCHEMA_KEYS) {
		if (!hasOwn(record, key)) {
			return {
				ok: false,
				rejection: {
					reason: 'torn-envelope',
					detail: `parseHarnessRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
				},
			};
		}
	}
	if (typeof record.harnessId !== 'string' || typeof record.contractVersion !== 'string' || typeof record.state !== 'string' || typeof record.mintedAtIso !== 'string' || typeof record.revision !== 'number' || !Array.isArray(record.history) || !isRecord(record.descriptor)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseHarnessRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
			},
		};
	}
	if (record.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-contract-version',
				detail: `parseHarnessRecord: the record carries contract version '${record.contractVersion}' - only '${DOMAIN_HARNESS_CONTRACTS_VERSION}' is known (the single-version law)`,
			},
		};
	}
	const descriptorRecord = record.descriptor as Record<string, unknown>;
	if (descriptorRecord.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-contract-version',
				detail: `parseHarnessRecord: the descriptor carries contract version '${showValue(descriptorRecord.contractVersion)}' - only '${DOMAIN_HARNESS_CONTRACTS_VERSION}' is known (the single-version law)`,
			},
		};
	}
	const unknownRecordKeys = Object.keys(record).filter((key) => !(HARNESS_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownRecordKeys.length > 0) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-key',
				detail: `parseHarnessRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict record schema is closed)`,
			},
		};
	}
	const descriptorKeys = Object.keys(descriptorRecord);
	const unknownDescriptorKeys = descriptorKeys.filter((key) => !(HARNESS_DESCRIPTOR_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownDescriptorKeys.length > 0) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-key',
				detail: `parseHarnessRecord: the descriptor carries the unknown key '${unknownDescriptorKeys[0]}' (the strict descriptor schema is closed)`,
			},
		};
	}
	const descriptorRoles = descriptorRecord.roles;
	if (Array.isArray(descriptorRoles)) {
		for (let i = 0; i < descriptorRoles.length; i += 1) {
			const role = descriptorRoles[i];
			if (isRecord(role)) {
				const extraRoleKeys = Object.keys(role as Record<string, unknown>).filter((key) => key !== 'roleKey' && key !== 'summary');
				if (extraRoleKeys.length > 0) {
					return {
						ok: false,
						rejection: {
							reason: 'unknown-key',
							detail: `parseHarnessRecord: the role entry roles[${i}] carries the unknown key '${extraRoleKeys[0]}' (a named role is roleKey + summary only)`,
						},
					};
				}
			}
		}
	}
	for (let i = 0; i < (record.history as unknown[]).length; i += 1) {
		const note = (record.history as unknown[])[i];
		if (isRecord(note)) {
			const extraNoteKeys = Object.keys(note as Record<string, unknown>).filter(
				(key) => !(HARNESS_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
			);
			if (extraNoteKeys.length > 0) {
				return {
					ok: false,
					rejection: {
						reason: 'unknown-key',
						detail: `parseHarnessRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
					},
				};
			}
		}
	}
	if (!isHarnessRecord(parsed)) {
		return {
			ok: false,
			rejection: {
				reason: 'invalid-record',
				detail: 'parseHarnessRecord: the parsed record fails the deep shape walk (the id pattern, the member state, the descriptor laws, the history notes or the validation outcome drifted - never a silent partial parse)',
			},
		};
	}
	return { ok: true, record: parsed };
}

// --- internal helpers (never exported) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property check (never the prototype chain). */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
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

/** The first frozen-list-order inversion in a workTypes list (the offending adjacent pair), or null. */
function findOrderInversion(workTypes: readonly unknown[]): [string, string] | null {
	const order = new Map<string, number>();
	(HARNESS_WORK_TYPES as readonly string[]).forEach((member, index) => order.set(member, index));
	let lastIndex = -1;
	for (let i = 0; i < workTypes.length; i += 1) {
		const member = workTypes[i];
		const index = order.get(member as string);
		if (index === undefined) {
			continue;
		}
		if (index < lastIndex) {
			return [workTypes[i - 1] as string, member as string];
		}
		lastIndex = index;
	}
	return null;
}

/** Shows a value for a deterministic detail sentence (primitives only, never a full dump). */
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

/** Shows a list of keys for a deterministic detail sentence. */
function showList(values: readonly string[]): string {
	return `[${values.join(', ')}]`;
}

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: HarnessRecord): Record<string, unknown> {
	return {
		harnessId: record.harnessId,
		contractVersion: record.contractVersion,
		state: record.state,
		descriptor: canonicalDescriptorObject(record.descriptor),
		mintedAtIso: record.mintedAtIso,
		revision: record.revision,
		history: record.history.map((note) => ({
			at: note.at,
			fromState: note.fromState,
			toState: note.toState,
			law: note.law,
			decision: note.decision === null ? null : canonicalDecisionObject(note.decision),
			detail: note.detail,
		})),
		lastValidation: canonicalValidationObject(record.lastValidation),
	};
}

/** Builds the canonical fixed-key-order object of a validated descriptor. */
function canonicalDescriptorObject(descriptor: DomainHarnessDescriptor): Record<string, unknown> {
	return {
		harnessId: descriptor.harnessId,
		contractVersion: descriptor.contractVersion,
		industry: descriptor.industry,
		workTypes: [...descriptor.workTypes],
		displayName: descriptor.displayName,
		roles: descriptor.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
		capabilityRefs: [...descriptor.capabilityRefs],
		workflowRefs: [...descriptor.workflowRefs],
		policyRefs: [...descriptor.policyRefs],
		evidenceRefs: [...descriptor.evidenceRefs],
	};
}

/** Builds the canonical fixed-key-order object of a decision (only the present keys, in the frozen order). */
function canonicalDecisionObject(decision: Readonly<Record<string, string>>): Record<string, string> {
	const canonical: Record<string, string> = {};
	for (const key of HARNESS_DECISION_SCHEMA_KEYS) {
		if (hasOwn(decision as Record<string, unknown>, key)) {
			canonical[key] = decision[key];
		}
	}
	return canonical;
}

/** Builds the canonical fixed-key-order object of a validation outcome. */
function canonicalValidationObject(outcome: HarnessValidationOutcome): Record<string, unknown> {
	if (outcome.ok) {
		return {
			ok: true,
			mode: outcome.mode,
			descriptor: canonicalDescriptorObject(outcome.descriptor),
		};
	}
	return {
		ok: false,
		mode: outcome.mode,
		rejections: outcome.rejections.map((rejection) => {
			const canonical: Record<string, unknown> = {
				reason: rejection.reason,
				law: rejection.law,
			};
			if (rejection.family !== undefined) {
				canonical.family = rejection.family;
			}
			canonical.items = [...rejection.items];
			canonical.detail = rejection.detail;
			return canonical;
		}),
	};
}
