/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-002 onboarding contract family: the typed staged-session vocabulary
 * for the industry/company/work-type onboarding instrument - the second
 * item of the Domain Harness OS workstream (WORK-REGISTRY.md § TL-B).
 * A user walks a session from industry selection through company-profile
 * composition to work-type selection; the review stage composes the
 * harness descriptor draft; the walk ends at 'proposed' where the real
 * DH-001 kit's own boundary takes over (the post-proposal harness
 * lifecycle - approved/active/retired - belongs to the DH-001 family,
 * never this one's). The onboarding family is a flow state machine +
 * descriptor assembly OVER the landed DH-001 contract layer: the frozen
 * industry (16) and work-type (10) vocabularies are imported and
 * re-exported BY REFERENCE (never re-declared - the no-fork-of-the-core
 * discipline), the composed draft mints THROUGH the real DH-001 kit
 * (the kit module's law), and the catalog stays the injected READ-ONLY
 * snapshot seam (the real-authority binding is the DH-007+ era; the
 * DH-001 kit's own comment says so). Role/ontology INVENTION is DH-003's
 * item: the review-stage composition inputs are supplied by the caller,
 * validated, never invented.
 *
 * LAWS (the DH-002 work order; the landed DH-001 family's inherited
 * binding precedents):
 * - THE NO-FORK LAW (inherited through the DH-01 descriptor mint): the
 *   onboarding alphabet is references and configuration ONLY - a
 *   session's payloads can never carry commands, tools, implementations,
 *   code, patches or any execution material. The structural engine
 *   mirrors the DH-01 stations: (a) the strict-schema scan rejects every
 *   UNKNOWN key; (b) the forbidden-key family ('command', 'commands',
 *   'tool', 'tools', 'implementation', 'code', 'script', 'inline',
 *   'patch', 'fork' - imported by reference from the DH-01 contract) is
 *   rejected with the typed no-fork rejection BEFORE the unknown-key
 *   rejection would fire (the precedence law); (c) role entries carry
 *   only roleKey+summary - any additional key is the no-fork rejection.
 *   The composed draft inherits the law through the real kit's own mint
 *   boundary (never relaxed here).
 * - THE FORWARD-ONLY LAW: the onboarding stage machine walks
 *   industry -> company -> work-types -> review -> proposed and NEVER
 *   back; 'proposed' is TERMINAL for the onboarding session (the
 *   post-proposal lifecycle is the DH-001 kit's); a changed session is
 *   a NEW session (the onboarding lineage law).
 * - THE TWO-PHASE LAW (inherited): dangling refs mint fine at draft
 *   (the review composition composes gradually); resolution is enforced
 *   at the propose boundary through the real kit's NO-DANGLING-REF
 *   check against the injected catalog snapshot.
 * - THE REAL-KIT LAW: the mint and the advance are ALWAYS the DH-01
 *   kit's own operations (the kit module constructs the real kit and
 *   forwards; this contract module only assembles the spec).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes (the DH-01
 *   algorithm: the frozen per-shape key orders applied deeply, never
 *   an alphabetic re-sort).
 * - THE FAIL-CLOSED LAW (binding): every domain refusal is a typed
 *   record { reason, law, message, items? } naming the violated law
 *   and the offending items - never a string throw, never a silent
 *   skip, never a partial verdict. The validation walk is
 *   first-failure-is-the-verdict in the frozen
 *   ONBOARDING_VALIDATION_REJECTION_REASONS walk order.
 * - THE SINGLE-VERSION LAW (binding): ONBOARDING_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE in this contract module, re-carried by the
 *   kit; the battery pins both copies equal.
 * - FROZEN REJECTION VOCABULARIES: the validation walk order is the
 *   frozen ONBOARDING_VALIDATION_REJECTION_REASONS list (each station
 *   in its list position; the kit's entry guards - disposed,
 *   unknown-session lookup, premature-op / stale-stage - and the
 *   harness-kit-refused boundary complete the taxonomy at the kit
 *   layer); the parse walk is first-failure-is-the-verdict over the
 *   frozen ONBOARDING_PARSE_REJECTION_REASONS list.
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import {
	FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
	HARNESS_WORK_TYPES,
	isHarnessId,
	isHarnessIndustry,
	isHarnessWorkType,
} from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessRole, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';

/**
 * THE NO-FORK-OF-THE-CORE discipline: the frozen DH-01 vocabularies are
 * re-exported BY REFERENCE (the same bindings, never re-declared
 * copies). The battery pins referential identity against the DH-01
 * contract module.
 */
export {
	FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
	HARNESS_INDUSTRIES,
	HARNESS_WORK_TYPES,
	isHarnessIndustry,
	isHarnessWorkType,
} from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry, HarnessRole, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW: declared ONCE here, re-carried by the kit. */
export const ONBOARDING_CONTRACTS_VERSION = '1.0.0';

/** The onboarding session id prefix (this family's namespace). */
export const ONBOARDING_SESSION_ID_PREFIX = 'flauz:onb:';

/**
 * The closed frozen stage vocabulary: the onboarding walk's five stages
 * in the exact walk order. 'proposed' is TERMINAL for the onboarding
 * session (the post-proposal lifecycle belongs to the DH-01 kit).
 */
export const ONBOARDING_STAGES = [
	'industry',
	'company',
	'work-types',
	'review',
	'proposed',
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isOnboardingStage(value: unknown): value is OnboardingStage {
	return (ONBOARDING_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface OnboardingStageTransition {
	readonly from: OnboardingStage;
	readonly to: OnboardingStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transitions
 * are industry->company, company->work-types, work-types->review,
 * review->proposed. 'proposed' is TERMINAL - no reopen; a changed
 * session is a NEW session (the onboarding lineage law). Widening the
 * map is a versioned contract decision.
 */
export const ONBOARDING_FORWARD_TRANSITIONS = [
	{ from: 'industry', to: 'company' },
	{ from: 'company', to: 'work-types' },
	{ from: 'work-types', to: 'review' },
	{ from: 'review', to: 'proposed' },
] as const;

/**
 * The typed stage verdict: ok carries the granting whitelist row
 * (1-based); refusal is the ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row (the row whose from-stage matches, null when
 * none does), the whitelisted successor (expectedTo, null when the
 * from-stage is terminal or unknown), and the deterministic detail
 * sentence. Forward-only; 'proposed' is TERMINAL.
 */
export type OnboardingStageVerdict =
	| { readonly ok: true; readonly from: OnboardingStage; readonly to: OnboardingStage; readonly row: number }
	| {
			readonly ok: false;
			readonly reason: 'ILLEGAL_TRANSITION';
			readonly from: unknown;
			readonly to: unknown;
			readonly whitelistRow: number | null;
			readonly expectedTo: OnboardingStage | null;
			readonly detail: string;
		};

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transitions are the four forward
 * rows; every other edge (skips, backwards moves, self-loops,
 * proposed->anything, unknown stages, non-strings) is the typed
 * ILLEGAL_TRANSITION rejection naming the violated whitelist row.
 */
export function canTransitionOnboardingStage(from: unknown, to: unknown): OnboardingStageVerdict {
	const transitions = ONBOARDING_FORWARD_TRANSITIONS as readonly OnboardingStageTransition[];
	let rowNumber = 0;
	for (let i = 0; i < transitions.length; i += 1) {
		if (transitions[i].from === from) {
			rowNumber = i + 1;
			break;
		}
	}
	if (!isOnboardingStage(from) || !isOnboardingStage(to)) {
		return {
			ok: false,
			reason: 'ILLEGAL_TRANSITION',
			from,
			to,
			whitelistRow: rowNumber > 0 ? rowNumber : null,
			expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
			detail: `canTransitionOnboardingStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen ONBOARDING_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
			detail: `canTransitionOnboardingStage: '${from}' -> '${to}' is refused - 'proposed' is TERMINAL for the onboarding session (no reopen; a changed session is a NEW session, the onboarding lineage law) (THE FORWARD-ONLY LAW)`,
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
			detail: `canTransitionOnboardingStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; proposed is terminal)`,
		};
	}
	return { ok: true, from, to, row: rowNumber };
}

/**
 * The closed frozen company size-band vocabulary: the company-profile
 * composition's sizeBand selection list (frozen at DH-002).
 */
export const COMPANY_SIZE_BANDS = [
	'solo',
	'small',
	'medium',
	'large',
	'enterprise',
] as const;
export type CompanySizeBand = (typeof COMPANY_SIZE_BANDS)[number];

/** Pure predicate over the closed size-band list. */
export function isCompanySizeBand(value: unknown): value is CompanySizeBand {
	return (COMPANY_SIZE_BANDS as readonly string[]).includes(value as string);
}

/**
 * The frozen company-profile schema: the exact two keys, in the
 * canonical fixed-key-order (the serialization order). displayName is
 * a non-empty string of at most 120 characters carrying no control
 * characters; sizeBand is a COMPANY_SIZE_BANDS member.
 */
export const COMPANY_PROFILE_SCHEMA_KEYS = [
	'displayName',
	'sizeBand',
] as const;

/**
 * The frozen review-composition schema: the exact five keys, in the
 * canonical fixed-key-order (the serialization order). roles is a
 * non-empty array of the DH-01 role shape ({ roleKey, summary } - an
 * extra key is the no-fork rejection); the four ref families are
 * string arrays, duplicate-free, MAY be empty (a draft composes
 * gradually).
 */
export const ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS = [
	'roles',
	'capabilityRefs',
	'workflowRefs',
	'policyRefs',
	'evidenceRefs',
] as const;

/**
 * The industry-selection payload: one HARNESS_INDUSTRIES member (the
 * frozen DH-01 vocabulary, imported by reference).
 */
export interface OnboardingIndustryPayload {
	readonly industry: HarnessIndustry;
}

/**
 * The company-profile payload: the displayName (non-empty, at most 120
 * characters, no control characters) and the sizeBand (a frozen
 * COMPANY_SIZE_BANDS member).
 */
export interface OnboardingCompanyProfile {
	readonly displayName: string;
	readonly sizeBand: CompanySizeBand;
}

/**
 * The work-type-selection payload: a non-empty, duplicate-free ordered
 * subset of the frozen HARNESS_WORK_TYPES list (the frozen list order
 * preserved).
 */
export type OnboardingWorkTypesPayload = readonly HarnessWorkType[];

/**
 * The review-stage composition payload: the roles (the DH-01 role
 * shape, supplied by the caller - never invented here; role/ontology
 * invention is DH-003's item) and the four reference families (string
 * arrays, duplicate-free, MAY be empty - dangling refs are allowed at
 * draft per THE TWO-PHASE LAW and resolved at the propose boundary
 * through the real kit).
 */
export interface OnboardingReviewComposition {
	readonly roles: readonly HarnessRole[];
	readonly capabilityRefs: readonly string[];
	readonly workflowRefs: readonly string[];
	readonly policyRefs: readonly string[];
	readonly evidenceRefs: readonly string[];
}

/**
 * Closed frozen list of onboarding validation rejection reasons, in the
 * exact walk order (the walk is first-failure-is-the-verdict at each
 * station, the stations visited in this order):
 *   malformed-record        - the candidate is not a plain object, or a
 *                             field / carrier carries the wrong
 *                             structural type (a non-array roles /
 *                             ref-family carrier, a non-member stage, a
 *                             malformed harnessId, a malformed history
 *                             note);
 *   no-fork                 - THE NO-FORK LAW: a forbidden
 *                             execution-material key on the payload
 *                             record, or an extra key on a role entry
 *                             (fires BEFORE the unknown-key rejection
 *                             for the forbidden family);
 *   unknown-key             - THE NO-FORK LAW's strict-schema engine: a
 *                             payload key outside the frozen schema;
 *   missing-key             - a required payload key is absent;
 *   unknown-session         - the session id is not the
 *                             flauz:onb:<16-hex> form (and, at the kit
 *                             layer, no session resolves under the id -
 *                             a malformed id fails closed as unknown);
 *   version-mismatch        - THE SINGLE-VERSION LAW: the session
 *                             record's contractVersion is not
 *                             ONBOARDING_CONTRACTS_VERSION;
 *   unknown-industry        - THE FROZEN-VOCABULARY LAW: the industry
 *                             is not a member of the DH-01 list;
 *   invalid-display-name    - the company displayName is empty, longer
 *                             than 120 characters, or carries control
 *                             characters (the DH-01 descriptor's own
 *                             80-character bound is enforced by the
 *                             REAL kit at the mint boundary - never
 *                             relaxed here);
 *   unknown-size-band       - THE FROZEN-VOCABULARY LAW: the sizeBand
 *                             is not a member of the frozen band list;
 *   empty-work-types        - the work-type selection is empty;
 *   unknown-work-type       - a selected work type is not in the
 *                             frozen DH-01 list;
 *   duplicate-work-types    - the selection carries repeats;
 *   work-types-out-of-order - the selection violates the frozen list
 *                             order;
 *   premature-op            - THE FORWARD-ONLY LAW (kit layer): the op
 *                             precedes its precondition within the walk
 *                             (the session is at an earlier stage, or
 *                             the review stage has no composed draft
 *                             yet);
 *   stale-stage             - THE FORWARD-ONLY LAW (kit layer): the op
 *                             is behind the walk (the session already
 *                             moved past the op's stage; a proposed
 *                             session is terminal);
 *   empty-roles             - the review composition carries no roles;
 *   malformed-role          - a role entry is not { roleKey, summary }
 *                             with non-empty strings;
 *   duplicate-role-keys     - roleKeys are not unique;
 *   malformed-refs          - a ref family member is not a string;
 *   duplicate-ref           - a ref family carries repeats;
 *   harness-kit-refused     - THE REAL-KIT LAW (kit layer): the real
 *                             DH-01 kit refused the mint or the
 *                             advance; the refusal carries the DH-01
 *                             refusal verbatim;
 *   disposed                - THE DISPOSE LAW (kit layer): the kit was
 *                             disposed; every operation after dispose
 *                             rejects.
 * Widening or reordering the list is a versioned contract decision.
 */
export const ONBOARDING_VALIDATION_REJECTION_REASONS = [
	'malformed-record',
	'no-fork',
	'unknown-key',
	'missing-key',
	'unknown-session',
	'version-mismatch',
	'unknown-industry',
	'invalid-display-name',
	'unknown-size-band',
	'empty-work-types',
	'unknown-work-type',
	'duplicate-work-types',
	'work-types-out-of-order',
	'premature-op',
	'stale-stage',
	'empty-roles',
	'malformed-role',
	'duplicate-role-keys',
	'malformed-refs',
	'duplicate-ref',
	'harness-kit-refused',
	'disposed',
] as const;
export type OnboardingValidationRejectionReason = (typeof ONBOARDING_VALIDATION_REJECTION_REASONS)[number];

/** Pure predicate over the closed validation-rejection list. */
export function isOnboardingValidationRejectionReason(value: unknown): value is OnboardingValidationRejectionReason {
	return (ONBOARDING_VALIDATION_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed domain refusal: the frozen reason, the violated law's
 * name, the deterministic message sentence, and the offending items.
 * NEVER a string throw, NEVER a silent skip. The kit layer widens the
 * reason vocabulary with its own frozen extras (E_LEDGER_TORN,
 * E_ENVELOPE_MISMATCH, ONBOARDING_IO, CORRUPT_SEAM, UNKNOWN_FILTER)
 * and adds the verbatim harnessRefusal carrier for
 * harness-kit-refused; the payload refusals are surfaced verbatim.
 */
export interface OnboardingRefusal {
	readonly reason: OnboardingValidationRejectionReason;
	readonly law: string;
	readonly message: string;
	readonly items?: readonly string[];
}

/**
 * The typed payload-validation outcome: ok carries the canonical
 * fixed-key-order copy of the validated payload; refusal carries the
 * single typed refusal of the FIRST violated station (the frozen walk
 * order).
 */
export type OnboardingPayloadOutcome<P> =
	| { readonly ok: true; readonly value: P }
	| { readonly ok: false; readonly refusal: OnboardingRefusal };

/**
 * The industry-selection walk (pure): malformed-record, no-fork,
 * unknown-key, missing-key, then the frozen-vocab membership (the
 * DH-01 list, imported by reference). Ok carries { industry }.
 */
export function validateOnboardingIndustryPayload(payload: unknown): OnboardingPayloadOutcome<OnboardingIndustryPayload> {
	if (!isRecord(payload)) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOnboardingIndustryPayload: the industry payload must be a plain object (never a silent partial verdict)', ['payload']);
	}
	const record = payload as Record<string, unknown>;
	const keys = Object.keys(record);
	const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
	if (forbiddenPresent.length > 0) {
		return refused(
			'no-fork',
			'THE NO-FORK LAW',
			`validateOnboardingIndustryPayload: the onboarding alphabet is references and configuration ONLY - a harness is composable configuration over the universal Flauz core, never an industry-specific fork; the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on the industry payload`,
			forbiddenPresent,
		);
	}
	const unknownKeys = keys.filter((key) => key !== 'industry');
	if (unknownKeys.length > 0) {
		return refused('unknown-key', 'THE NO-FORK LAW', `validateOnboardingIndustryPayload: the industry payload schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the onboarding alphabet is references only)`, unknownKeys);
	}
	if (!hasOwn(record, 'industry')) {
		return refused('missing-key', 'THE FAIL-CLOSED LAW', 'validateOnboardingIndustryPayload: the industry payload requires the industry key (the frozen DH-01 selection list, imported by reference)', ['industry']);
	}
	if (!isHarnessIndustry(record.industry)) {
		return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingIndustryPayload: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility)', [showValue(record.industry)]);
	}
	return { ok: true, value: { industry: record.industry } };
}

/**
 * The company-profile walk (pure): malformed-record, no-fork,
 * unknown-key, missing-key, then the displayName bounds (non-empty, at
 * most 120 characters, no control characters) and the sizeBand
 * membership. Ok carries { displayName, sizeBand } in the canonical
 * key order.
 */
export function validateOnboardingCompanyProfile(profile: unknown): OnboardingPayloadOutcome<OnboardingCompanyProfile> {
	if (!isRecord(profile)) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOnboardingCompanyProfile: the company profile must be a plain object (never a silent partial verdict)', ['profile']);
	}
	const record = profile as Record<string, unknown>;
	const keys = Object.keys(record);
	const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
	if (forbiddenPresent.length > 0) {
		return refused(
			'no-fork',
			'THE NO-FORK LAW',
			`validateOnboardingCompanyProfile: the onboarding alphabet is references and configuration ONLY - the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on the company profile`,
			forbiddenPresent,
		);
	}
	const unknownKeys = keys.filter((key) => !(COMPANY_PROFILE_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		return refused('unknown-key', 'THE NO-FORK LAW', `validateOnboardingCompanyProfile: the company-profile schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
	}
	const missingKeys = (COMPANY_PROFILE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
	if (missingKeys.length > 0) {
		return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateOnboardingCompanyProfile: the company-profile schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
	}
	const displayName = record.displayName;
	if (typeof displayName !== 'string' || displayName.length === 0 || displayName.length > 120) {
		const shown = typeof displayName !== 'string' ? showValue(displayName) : displayName.length === 0 ? '<empty string>' : `${displayName.length} chars`;
		return refused('invalid-display-name', 'THE FAIL-CLOSED LAW', 'validateOnboardingCompanyProfile: displayName must be a non-empty string of at most 120 characters with no control characters (the DH-01 descriptor\'s own 80-character bound is enforced by the REAL kit at the mint boundary)', [
			shown,
		]);
	}
	const controlCharacters = controlCharactersOf(displayName);
	if (controlCharacters.length > 0) {
		return refused('invalid-display-name', 'THE FAIL-CLOSED LAW', `validateOnboardingCompanyProfile: displayName must carry no control characters - the offending character(s) ${showList(controlCharacters)} are rejected`, controlCharacters);
	}
	if (!isCompanySizeBand(record.sizeBand)) {
		return refused('unknown-size-band', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingCompanyProfile: the sizeBand must be a member of the frozen COMPANY_SIZE_BANDS list (membership is the only admissibility)', [showValue(record.sizeBand)]);
	}
	return { ok: true, value: { displayName, sizeBand: record.sizeBand } };
}

/**
 * The work-type-selection walk (pure): malformed-record (the carrier),
 * then the DH-01 subset laws in the frozen order - non-empty, members
 * only, duplicate-free, the frozen list order preserved. Ok carries
 * the fresh ordered list.
 */
export function validateOnboardingWorkTypes(workTypes: unknown): OnboardingPayloadOutcome<OnboardingWorkTypesPayload> {
	if (!Array.isArray(workTypes)) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOnboardingWorkTypes: the work-type selection must be an array (the ordered subset of the frozen DH-01 HARNESS_WORK_TYPES list, imported by reference)', ['workTypes']);
	}
	const selection = workTypes as unknown[];
	if (selection.length === 0) {
		return refused('empty-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingWorkTypes: the work-type selection must be a non-empty ordered subset of the frozen HARNESS_WORK_TYPES list', ['workTypes']);
	}
	const nonMembers = selection.filter((member) => !isHarnessWorkType(member)).map((member) => showValue(member));
	if (nonMembers.length > 0) {
		return refused('unknown-work-type', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingWorkTypes: every selected work type must be in the frozen HARNESS_WORK_TYPES list (membership is the only admissibility)', nonMembers);
	}
	const duplicates = findDuplicates(selection.map((member) => showValue(member)));
	if (duplicates.length > 0) {
		return refused('duplicate-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingWorkTypes: the work-type selection must be duplicate-free (the ordered subset carries no repeats)', duplicates);
	}
	const inversion = findOrderInversion(selection);
	if (inversion !== null) {
		return refused('work-types-out-of-order', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingWorkTypes: the work-type selection must preserve the frozen HARNESS_WORK_TYPES list order (the pair above is inverted)', inversion);
	}
	return { ok: true, value: [...(workTypes as HarnessWorkType[])] };
}

/**
 * The review-composition walk (pure): malformed-record (the record and
 * the roles / ref-family carriers), no-fork (the forbidden family on
 * the record AND the extra keys on role entries - the DH-01 station
 * (c), before unknown-key), unknown-key, missing-key, then the roles
 * family (non-empty, the DH-01 role shape, unique roleKeys) and the
 * four ref families (string members, duplicate-free). Ok carries the
 * canonical fixed-key-order copy.
 */
export function validateOnboardingReviewComposition(composition: unknown): OnboardingPayloadOutcome<OnboardingReviewComposition> {
	if (!isRecord(composition)) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOnboardingReviewComposition: the review composition must be a plain object (never a silent partial verdict)', ['composition']);
	}
	const record = composition as Record<string, unknown>;
	const keys = Object.keys(record);
	const carrierViolations: string[] = [];
	if (hasOwn(record, 'roles') && !Array.isArray(record.roles)) {
		carrierViolations.push('roles');
	}
	for (const family of REF_FAMILIES) {
		if (hasOwn(record, family) && !Array.isArray(record[family])) {
			carrierViolations.push(family);
		}
	}
	if (carrierViolations.length > 0) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', `validateOnboardingReviewComposition: a payload field carries the wrong structural type - the carrier(s) ${showList(carrierViolations)} must be arrays (never a silent partial verdict)`, carrierViolations);
	}
	const noForkItems: string[] = [];
	const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
	noForkItems.push(...forbiddenPresent);
	const roles = Array.isArray(record.roles) ? (record.roles as unknown[]) : [];
	for (let i = 0; i < roles.length; i += 1) {
		const role = roles[i];
		if (isRecord(role)) {
			const extraRoleKeys = Object.keys(role as Record<string, unknown>).filter((key) => key !== 'roleKey' && key !== 'summary');
			for (const extraKey of extraRoleKeys) {
				noForkItems.push(`roles[${i}].${extraKey}`);
			}
		}
	}
	if (noForkItems.length > 0) {
		return refused(
			'no-fork',
			'THE NO-FORK LAW',
			`validateOnboardingReviewComposition: the review composition is CONFIGURATION ONLY - a named role is a roleKey plus a human summary and the payload alphabet is references; the forbidden execution-material key(s) ${showList(noForkItems)} cannot appear (a harness is composable configuration over the universal Flauz core, never an industry-specific fork)`,
			noForkItems,
		);
	}
	const unknownKeys = keys.filter((key) => !(ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		return refused('unknown-key', 'THE NO-FORK LAW', `validateOnboardingReviewComposition: the review-composition schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the composition alphabet is references only)`, unknownKeys);
	}
	const missingKeys = (ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
	if (missingKeys.length > 0) {
		return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateOnboardingReviewComposition: the review-composition schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
	}
	if (roles.length === 0) {
		return refused('empty-roles', 'THE FAIL-CLOSED LAW', 'validateOnboardingReviewComposition: the review composition must name its domain roles (a non-empty roles array; the caller supplies them - role invention is DH-003\'s item)', ['roles']);
	}
	const malformedRoles: string[] = [];
	for (let i = 0; i < roles.length; i += 1) {
		const role = roles[i] as Record<string, unknown>;
		if (!isRecord(role) || typeof role.roleKey !== 'string' || role.roleKey.length === 0 || typeof role.summary !== 'string' || role.summary.length === 0) {
			malformedRoles.push(`roles[${i}]`);
		}
	}
	if (malformedRoles.length > 0) {
		return refused('malformed-role', 'THE FAIL-CLOSED LAW', 'validateOnboardingReviewComposition: every role entry must be { roleKey, summary } with non-empty strings (a named role is configuration; it grants NOTHING by itself)', malformedRoles);
	}
	const roleKeyDuplicates = findDuplicates(roles.map((role) => (role as Record<string, unknown>).roleKey as string));
	if (roleKeyDuplicates.length > 0) {
		return refused('duplicate-role-keys', 'THE FAIL-CLOSED LAW', 'validateOnboardingReviewComposition: roleKeys must be unique (a named role appears once)', roleKeyDuplicates);
	}
	const malformedRefs: string[] = [];
	for (const family of REF_FAMILIES) {
		const refs = record[family] as unknown[];
		for (let i = 0; i < refs.length; i += 1) {
			if (typeof refs[i] !== 'string') {
				malformedRefs.push(`${family}[${i}]`);
			}
		}
	}
	if (malformedRefs.length > 0) {
		return refused('malformed-refs', 'THE FAIL-CLOSED LAW', `validateOnboardingReviewComposition: every ref-family member must be a string (the reference-only alphabet; the family arrays MAY be empty - a draft composes gradually)`, malformedRefs);
	}
	const duplicateRefItems: string[] = [];
	for (const family of REF_FAMILIES) {
		const duplicates = findDuplicates(record[family] as string[]);
		for (const duplicate of duplicates) {
			duplicateRefItems.push(`${family}:${duplicate}`);
		}
	}
	if (duplicateRefItems.length > 0) {
		return refused('duplicate-ref', 'THE FAIL-CLOSED LAW', `validateOnboardingReviewComposition: every ref family must be duplicate-free (a reference appears once) - the offender(s) ${showList(duplicateRefItems)} carry the family prefix`, duplicateRefItems);
	}
	return {
		ok: true,
		value: {
			roles: roles.map((role) => {
				const roleRecord = role as Record<string, unknown>;
				return { roleKey: roleRecord.roleKey as string, summary: roleRecord.summary as string };
			}),
			capabilityRefs: [...(record.capabilityRefs as string[])],
			workflowRefs: [...(record.workflowRefs as string[])],
			policyRefs: [...(record.policyRefs as string[])],
			evidenceRefs: [...(record.evidenceRefs as string[])],
		},
	};
}

// --- the session record (the honest record of the staged walk) ---

/** The frozen onboarding op-name vocabulary (the ledger line ops). */
export const ONBOARDING_OP_NAMES = [
	'begin-session',
	'select-industry',
	'compose-company',
	'select-work-types',
	'compose-draft',
	'propose-session',
] as const;
export type OnboardingOpName = (typeof ONBOARDING_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isOnboardingOpName(value: unknown): value is OnboardingOpName {
	return (ONBOARDING_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the session history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'industry'), which op and which law
 * granted it, and the deterministic detail sentence.
 */
export interface OnboardingTransitionNote {
	readonly at: string;
	readonly fromStage: OnboardingStage | null;
	readonly toStage: OnboardingStage;
	readonly op: OnboardingOpName;
	readonly law: string;
	readonly detail: string;
}

/**
 * The persisted per-session record (the honest record): the id, the
 * re-carried contract version, the current stage, the stage payloads
 * (industry / companyProfile / workTypes set as the walk advances;
 * reviewComposition + harnessId set by composeDraft - re-composable at
 * review per the gradual-draft law), the minted harness link, the
 * creation timestamp, the revision count (the begin is revision 1;
 * every applied op appends one), and the full op history with
 * provenance. Stage-vs-payload consistency is the ledger replay's
 * cross-check, never this shape's (the DH-01 guard discipline).
 */
export interface OnboardingSessionRecord {
	readonly sessionId: string;
	readonly contractVersion: string;
	readonly stage: OnboardingStage;
	readonly industry: HarnessIndustry | null;
	readonly companyProfile: OnboardingCompanyProfile | null;
	readonly workTypes: readonly HarnessWorkType[] | null;
	readonly reviewComposition: OnboardingReviewComposition | null;
	readonly harnessId: string | null;
	readonly createdAtIso: string;
	readonly revision: number;
	readonly history: readonly OnboardingTransitionNote[];
}

/** The frozen session-record schema keys, in the canonical fixed-key-order. */
export const ONBOARDING_SESSION_SCHEMA_KEYS = [
	'sessionId',
	'contractVersion',
	'stage',
	'industry',
	'companyProfile',
	'workTypes',
	'reviewComposition',
	'harnessId',
	'createdAtIso',
	'revision',
	'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const ONBOARDING_NOTE_SCHEMA_KEYS = [
	'at',
	'fromStage',
	'toStage',
	'op',
	'law',
	'detail',
] as const;

/** Pure predicate: a well-formed onboarding session id (flauz:onb:<16-hex>). */
export function isOnboardingSessionId(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	if (!value.startsWith(ONBOARDING_SESSION_ID_PREFIX)) {
		return false;
	}
	const hex = value.slice(ONBOARDING_SESSION_ID_PREFIX.length);
	return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * The deep session-record walk (pure): the full
 * ONBOARDING_VALIDATION_REJECTION_REASONS station tour over the honest
 * record - malformed-record (the record and its carriers / stage /
 * harnessId / revision / history notes), no-fork (the session-level
 * forbidden family), unknown-key, missing-key, unknown-session (the id
 * form), version-mismatch (THE SINGLE-VERSION LAW), unknown-industry,
 * then the companyProfile / workTypes / reviewComposition payload
 * walks surfaced verbatim. Ok carries the canonical fixed-key-order
 * copy. First-failure-is-the-verdict in the frozen walk order.
 */
export function validateOnboardingSessionRecord(record: unknown): OnboardingPayloadOutcome<OnboardingSessionRecord> {
	if (!isRecord(record)) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateOnboardingSessionRecord: the session record must be a plain object (never a silent partial verdict)', ['session-record']);
	}
	const candidate = record as Record<string, unknown>;
	const structural: string[] = [];
	if (hasOwn(candidate, 'stage') && !isOnboardingStage(candidate.stage)) {
		structural.push('stage');
	}
	if (hasOwn(candidate, 'harnessId') && candidate.harnessId !== null && !isHarnessId(candidate.harnessId)) {
		structural.push('harnessId');
	}
	if (hasOwn(candidate, 'createdAtIso') && (typeof candidate.createdAtIso !== 'string' || candidate.createdAtIso.length === 0)) {
		structural.push('createdAtIso');
	}
	if (hasOwn(candidate, 'revision') && (typeof candidate.revision !== 'number' || !Number.isInteger(candidate.revision) || candidate.revision < 1)) {
		structural.push('revision');
	}
	if (hasOwn(candidate, 'history') && !Array.isArray(candidate.history)) {
		structural.push('history');
	} else if (Array.isArray(candidate.history)) {
		for (let i = 0; i < candidate.history.length; i += 1) {
			if (!isWellFormedNote(candidate.history[i])) {
				structural.push(`history[${i}]`);
			}
		}
	}
	if (hasOwn(candidate, 'companyProfile') && candidate.companyProfile !== null && !isRecord(candidate.companyProfile)) {
		structural.push('companyProfile');
	}
	if (hasOwn(candidate, 'workTypes') && candidate.workTypes !== null && !Array.isArray(candidate.workTypes)) {
		structural.push('workTypes');
	}
	if (hasOwn(candidate, 'reviewComposition') && candidate.reviewComposition !== null && !isRecord(candidate.reviewComposition)) {
		structural.push('reviewComposition');
	}
	if (structural.length > 0) {
		return refused('malformed-record', 'THE FAIL-CLOSED LAW', `validateOnboardingSessionRecord: the session record carries a field of the wrong structural type - the offending field(s) ${showList(structural)} (never a silent partial verdict)`, structural);
	}
	const keys = Object.keys(candidate);
	const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
	if (forbiddenPresent.length > 0) {
		return refused(
			'no-fork',
			'THE NO-FORK LAW',
			`validateOnboardingSessionRecord: the session record is the honest record of a configuration walk - the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on it`,
			forbiddenPresent,
		);
	}
	const unknownKeys = keys.filter((key) => !(ONBOARDING_SESSION_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		return refused('unknown-key', 'THE NO-FORK LAW', `validateOnboardingSessionRecord: the session-record schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
	}
	const missingKeys = (ONBOARDING_SESSION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
	if (missingKeys.length > 0) {
		return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateOnboardingSessionRecord: the session-record schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
	}
	if (!isOnboardingSessionId(candidate.sessionId)) {
		return refused('unknown-session', 'THE FAIL-CLOSED LAW', `validateOnboardingSessionRecord: the sessionId must be the ${ONBOARDING_SESSION_ID_PREFIX}<16-hex> form (minted from the injected rng at the kit boundary, never caller-supplied)`, [showValue(candidate.sessionId)]);
	}
	if (candidate.contractVersion !== ONBOARDING_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `validateOnboardingSessionRecord: the session record must carry ONBOARDING_CONTRACTS_VERSION '${ONBOARDING_CONTRACTS_VERSION}' exactly (the single-version law - declared once, re-carried by the kit)`, [showValue(candidate.contractVersion)]);
	}
	if (candidate.industry !== null && !isHarnessIndustry(candidate.industry)) {
		return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateOnboardingSessionRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract', [showValue(candidate.industry)]);
	}
	if (candidate.companyProfile !== null) {
		const profile = validateOnboardingCompanyProfile(candidate.companyProfile);
		if (!profile.ok) {
			return profile;
		}
	}
	if (candidate.workTypes !== null) {
		const workTypes = validateOnboardingWorkTypes(candidate.workTypes);
		if (!workTypes.ok) {
			return workTypes;
		}
	}
	if (candidate.reviewComposition !== null) {
		const composition = validateOnboardingReviewComposition(candidate.reviewComposition);
		if (!composition.ok) {
			return composition;
		}
	}
	return { ok: true, value: canonicalSessionRecord(candidate as unknown as OnboardingSessionRecord) };
}

/**
 * Pure deep shape guard: a well-formed onboarding session record (the
 * deep walk above, green). Fails closed on every malformed path; never
 * reads a clock; never mutates its input.
 */
export function isOnboardingSessionRecord(value: unknown): value is OnboardingSessionRecord {
	return validateOnboardingSessionRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of an
 * onboarding session record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * ONBOARDING_SESSION_SCHEMA_KEYS order, the company profile in the
 * COMPANY_PROFILE_SCHEMA_KEYS order, the review composition in the
 * ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS order, the role entries in
 * the roleKey,summary order, and the history notes in the
 * ONBOARDING_NOTE_SCHEMA_KEYS order. Throws TypeError on a malformed
 * record (never dishonest bytes).
 */
export function serializeOnboardingSession(record: unknown): string {
	if (!isOnboardingSessionRecord(record)) {
		throw new TypeError(
			'serializeOnboardingSession: record must satisfy isOnboardingSessionRecord - no dishonest onboarding session ever gets canonical bytes',
		);
	}
	return JSON.stringify(canonicalSessionObject(record));
}

/**
 * Closed frozen list of parse rejection reasons (the parse walk is
 * first-failure-is-the-verdict, in this exact order):
 *   malformed-json           - the bytes are not valid JSON;
 *   torn-envelope            - the bytes parse but the record envelope
 *                              is structurally incomplete or torn (a
 *                              non-object, a missing key, a value of
 *                              the wrong structural type - never a
 *                              silent partial parse);
 *   unknown-contract-version - the record carries a contract version
 *                              other than ONBOARDING_CONTRACTS_VERSION;
 *   unknown-key              - an extra key at the record, profile,
 *                              composition, role or note level
 *                              (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses (the
 *                              frozen refusal taxonomy of
 *                              validateOnboardingSessionRecord).
 */
export const ONBOARDING_PARSE_REJECTION_REASONS = [
	'malformed-json',
	'torn-envelope',
	'unknown-contract-version',
	'unknown-key',
	'invalid-record',
] as const;
export type OnboardingParseRejectionReason = (typeof ONBOARDING_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isOnboardingParseRejectionReason(value: unknown): value is OnboardingParseRejectionReason {
	return (ONBOARDING_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming message. */
export interface OnboardingParseRejection {
	readonly reason: OnboardingParseRejectionReason;
	readonly message: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type OnboardingParseOutcome =
	| { readonly ok: true; readonly record: OnboardingSessionRecord }
	| { readonly ok: false; readonly rejection: OnboardingParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (record / profile / composition / role / note level), or invalid
 * content (the deep session walk) - each a typed rejection naming the
 * drift; never a silent partial parse. First-failure-is-the-verdict,
 * in the frozen ONBOARDING_PARSE_REJECTION_REASONS order.
 */
export function parseOnboardingSession(bytes: unknown): OnboardingParseOutcome {
	if (typeof bytes !== 'string') {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				message: 'parseOnboardingSession: bytes must be a string (the canonical fixed-key-order session bytes)',
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
				message: `parseOnboardingSession: the bytes are not valid JSON: ${toMessage(error)}`,
			},
		};
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				message: 'parseOnboardingSession: the bytes must carry a JSON object (the session-record envelope)',
			},
		};
	}
	const record = parsed as Record<string, unknown>;
	for (const key of ONBOARDING_SESSION_SCHEMA_KEYS) {
		if (!hasOwn(record, key)) {
			return {
				ok: false,
				rejection: {
					reason: 'torn-envelope',
					message: `parseOnboardingSession: the '${key}' key is missing (a torn write - never a silent partial parse)`,
				},
			};
		}
	}
	if (typeof record.sessionId !== 'string' || typeof record.contractVersion !== 'string' || typeof record.stage !== 'string' || typeof record.createdAtIso !== 'string' || typeof record.revision !== 'number' || !Array.isArray(record.history) || (record.industry !== null && typeof record.industry !== 'string') || (record.companyProfile !== null && !isRecord(record.companyProfile)) || (record.workTypes !== null && !Array.isArray(record.workTypes)) || (record.reviewComposition !== null && !isRecord(record.reviewComposition)) || (record.harnessId !== null && typeof record.harnessId !== 'string')) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				message: 'parseOnboardingSession: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
			},
		};
	}
	if (record.contractVersion !== ONBOARDING_CONTRACTS_VERSION) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-contract-version',
				message: `parseOnboardingSession: the record carries contract version '${record.contractVersion}' - only '${ONBOARDING_CONTRACTS_VERSION}' is known (the single-version law)`,
			},
		};
	}
	const unknownRecordKeys = Object.keys(record).filter((key) => !(ONBOARDING_SESSION_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownRecordKeys.length > 0) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-key',
				message: `parseOnboardingSession: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict session schema is closed)`,
			},
		};
	}
	const profile = record.companyProfile as Record<string, unknown> | null;
	if (profile !== null) {
		const unknownProfileKeys = Object.keys(profile).filter((key) => !(COMPANY_PROFILE_SCHEMA_KEYS as readonly string[]).includes(key));
		if (unknownProfileKeys.length > 0) {
			return {
				ok: false,
				rejection: {
					reason: 'unknown-key',
					message: `parseOnboardingSession: the company profile carries the unknown key '${unknownProfileKeys[0]}' (the strict profile schema is closed)`,
				},
			};
		}
	}
	const composition = record.reviewComposition as Record<string, unknown> | null;
	if (composition !== null) {
		const unknownCompositionKeys = Object.keys(composition).filter((key) => !(ONBOARDING_REVIEW_COMPOSITION_SCHEMA_KEYS as readonly string[]).includes(key));
		if (unknownCompositionKeys.length > 0) {
			return {
				ok: false,
				rejection: {
					reason: 'unknown-key',
					message: `parseOnboardingSession: the review composition carries the unknown key '${unknownCompositionKeys[0]}' (the strict composition schema is closed)`,
				},
			};
		}
		const compositionRoles = composition.roles;
		if (Array.isArray(compositionRoles)) {
			for (let i = 0; i < compositionRoles.length; i += 1) {
				const role = compositionRoles[i];
				if (isRecord(role)) {
					const extraRoleKeys = Object.keys(role as Record<string, unknown>).filter((key) => key !== 'roleKey' && key !== 'summary');
					if (extraRoleKeys.length > 0) {
						return {
							ok: false,
							rejection: {
								reason: 'unknown-key',
								message: `parseOnboardingSession: the role entry roles[${i}] carries the unknown key '${extraRoleKeys[0]}' (a named role is roleKey + summary only)`,
							},
						};
					}
				}
			}
		}
	}
	for (let i = 0; i < (record.history as unknown[]).length; i += 1) {
		const note = (record.history as unknown[])[i];
		if (isRecord(note)) {
			const extraNoteKeys = Object.keys(note as Record<string, unknown>).filter(
				(key) => !(ONBOARDING_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
			);
			if (extraNoteKeys.length > 0) {
				return {
					ok: false,
					rejection: {
						reason: 'unknown-key',
						message: `parseOnboardingSession: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
					},
				};
			}
		}
	}
	const deep = validateOnboardingSessionRecord(parsed);
	if (!deep.ok) {
		return {
			ok: false,
			rejection: {
				reason: 'invalid-record',
				message: `parseOnboardingSession: the parsed record fails the deep session walk (${deep.refusal.reason} - ${deep.refusal.message}; never a silent partial parse)`,
			},
		};
	}
	return { ok: true, record: deep.value };
}

// --- internal helpers (never exported) ---

/** The four reference families of the review composition (the DH-01 family list, mirrored by name). */
const REF_FAMILIES = ['capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs'] as const;

/** Builds one typed refusal (the single refusal-record shape). */
function refused(reason: OnboardingValidationRejectionReason, law: string, message: string, items?: readonly string[]): OnboardingPayloadOutcome<never> {
	return { ok: false, refusal: items === undefined ? { reason, law, message } : { reason, law, message, items } };
}

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

/** The first frozen-list-order inversion in a work-types list (the offending adjacent pair), or null. */
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

/** The distinct control characters of a display name (C0, DEL and C1), as U+XXXX codes in first-seen order. */
function controlCharactersOf(value: string): string[] {
	const seen = new Set<string>();
	const found: string[] = [];
	for (const character of value) {
		if (/[\u0000-\u001F\u007F-\u009F]/.test(character) && !seen.has(character)) {
			seen.add(character);
			found.push(`U+${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
		}
	}
	return found;
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

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/** Pure predicate: a well-formed history note (the exact six keys; member stages and op; non-empty strings). */
function isWellFormedNote(value: unknown): value is OnboardingTransitionNote {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...ONBOARDING_NOTE_SCHEMA_KEYS].sort();
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
	if (record.fromStage !== null && !isOnboardingStage(record.fromStage)) {
		return false;
	}
	if (!isOnboardingStage(record.toStage)) {
		return false;
	}
	if (!isOnboardingOpName(record.op)) {
		return false;
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return false;
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return false;
	}
	return true;
}

/** Builds the canonical fixed-key-order copy of a validated session record. */
function canonicalSessionRecord(record: OnboardingSessionRecord): OnboardingSessionRecord {
	return canonicalSessionObject(record) as unknown as OnboardingSessionRecord;
}

/** Builds the canonical fixed-key-order object of a validated session record. */
function canonicalSessionObject(record: OnboardingSessionRecord): Record<string, unknown> {
	return {
		sessionId: record.sessionId,
		contractVersion: record.contractVersion,
		stage: record.stage,
		industry: record.industry,
		companyProfile: record.companyProfile === null ? null : {
			displayName: record.companyProfile.displayName,
			sizeBand: record.companyProfile.sizeBand,
		},
		workTypes: record.workTypes === null ? null : [...record.workTypes],
		reviewComposition: record.reviewComposition === null ? null : {
			roles: record.reviewComposition.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
			capabilityRefs: [...record.reviewComposition.capabilityRefs],
			workflowRefs: [...record.reviewComposition.workflowRefs],
			policyRefs: [...record.reviewComposition.policyRefs],
			evidenceRefs: [...record.reviewComposition.evidenceRefs],
		},
		harnessId: record.harnessId,
		createdAtIso: record.createdAtIso,
		revision: record.revision,
		history: record.history.map((note) => ({
			at: note.at,
			fromStage: note.fromStage,
			toStage: note.toStage,
			op: note.op,
			law: note.law,
			detail: note.detail,
		})),
	};
}
