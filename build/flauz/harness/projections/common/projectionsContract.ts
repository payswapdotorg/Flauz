/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-010 domain UI/navigation projections contract family: the typed
 * DERIVED-READ-ONLY view-model layer for the Domain Harness OS
 * direction (WORK-REGISTRY.md - registry row DH-010 "domain
 * UI/navigation projections"; ARCHITECTURE-LOCK 12.5: a harness may
 * compose "UI/navigation projections" - a harness over the universal
 * Flauz core, never a fork; ARCHITECTURE-LOCK 4: the preferred
 * placement is a built-in Flauz extension consuming a pure derivation
 * layer, never a core fork). A harness is domain-specific through its
 * industry label (DH-01), its onboarding record (DH-02), its named
 * roles (DH-03), its domain terms (DH-04), its task/workflow
 * templates (DH-05), its organization's default agent bodies
 * (DH-06), its default capability packs (DH-07), its policy /
 * approval / evidence / KPI profiles (DH-08) and its benchmark /
 * simulation worlds (DH-09) - and through its NAVIGATION MODEL: the
 * frozen section list (overview, roles, workflows, capabilities,
 * policies, evidence, kpis, benchmarks, lifecycle) the user-facing
 * Flauz surfaces render. This family is the PROJECTION layer for
 * that model: typed, total, deterministic, fail-closed derivation
 * over CALLER-SUPPLIED composed records, with the family's
 * validation, serialization and parse laws.
 *
 * THE PROJECTION LAW (binding, this family's charter): projections
 * are DERIVED READ-ONLY view models computed from CALLER-SUPPLIED
 * composed records. The family never mutates a record (every input
 * is walked read-only; the derived rows are fresh values), never
 * persists state (no ledger, no envelope, no journal - a second
 * persistence authority is forbidden, ARCHITECTURE-LOCK 12.6; the
 * navigation model is a transport value between surfaces, its bytes
 * are the canonical serialization of a derived value, never a
 * persisted record), and never becomes an authority (no permission,
 * approval, evidence, KPI, lifecycle or execution authority is
 * granted, brokered or led here; applying/activating stays routed
 * through the DH-01 authority - the closed door the consuming
 * surface must disclose).
 *
 * THE IMPORT LAW (binding, the family charter): the record shapes
 * and versions are IMPORTED from the real family contracts - the
 * DH-01 DomainHarnessDescriptor / HarnessRole / HarnessRecord /
 * lifecycle-state vocabulary, the DH-02 onboarding session record,
 * and the roles / ontology / templates / bodies / packs / profiles /
 * benchmarks record interfaces - never re-declared,
 * re-implemented or shadowed (the battery pins the imports). The
 * per-family record validation is the REAL families' own deep
 * validators (isHarnessRecord, isOnboardingSessionRecord,
 * isRoleCompositionSession, isOntologyRecord,
 * isWorkflowTemplateRecord, isOrganizationDefaultsRecord,
 * isCapabilityPacksRecord, isProfilesRecord, isBenchmarksRecord) -
 * imported by reference and called; a second record walk is
 * forbidden here.
 *
 * LAWS (the DH-010 work order; the landed family precedents,
 * inherited and binding):
 * - THE ANCHOR LAW (binding): the DH-01 harness record is the
 *   projection's ANCHOR - the navigation model is THE projection of
 *   ONE harness. The 'harness' input slot is REQUIRED: the key
 *   absent or the value undefined is the typed missing-record
 *   rejection naming the domain-harness family (never a silent
 *   empty model).
 * - THE ABSENT-FAMILY LAW (binding, the explicit distinction): the
 *   eight optional family input slots (onboarding, roles, ontology,
 *   templates, bodies, packs, profiles, benchmarks) carry
 *   readonly record ARRAYS; undefined (the key absent) is the ONE
 *   honest absent marker - the family has no records composed yet
 *   and the section carries the honest 'not-composed' state, never
 *   a refusal. A PRESENT value (anything other than undefined,
 *   including null) that is not the family's valid records is the
 *   typed malformed-record rejection naming the family - never a
 *   silent skip, never a silent normalization. The distinction is
 *   typed: ProjectNavigationInputs declares the absent marker as
 *   exactly `undefined` on each optional slot.
 * - THE BINDING LAW (binding): a family record that carries a
 *   harnessId binding must bind to the ANCHOR's harnessId or the
 *   typed foreign-record rejection names it (a record from another
 *   harness never projects into this harness's navigation). The
 *   DH-02 session's harnessId is nullable (a pre-proposal session)
 *   - checked only when non-null; the DH-03 roles session carries
 *   no harnessId (the caller's wiring binds it) - never checked.
 * - THE DUPLICATE-RECORD LAW (binding): repeated record ids within
 *   one family slot are the typed duplicate-record rejection (the
 *   derived rowKeys are unique per record id; a repeat would forge
 *   duplicate rows - refused at the boundary, never rendered).
 * - THE SECTION-SOURCE MAP (binding, frozen): overview <- the DH-01
 *   record (industry, workTypes, displayName, lifecycle state) +
 *   the DH-02 session records (the selection state: session stage,
 *   company, work types, the review composition, the proposed
 *   harness); roles <- the DH-01 descriptor's roles (the anchor
 *   floor - always present) + the DH-03 records (the
 *   composition-layer roles); workflows <- the DH-05 records (the
 *   task templates) + the DH-04 records (the domain terms the
 *   templates' termRefs reference); capabilities <- the DH-07
 *   records (the packs) + the DH-06 records (the default agent
 *   bodies the packs' bodyRefs reference) + the DH-08 permission
 *   legs (the distinct permissionRefs across the profiles); policies
 *   <- the DH-08 records (permissionRefs / approvalTiers per
 *   profile); evidence <- the DH-08 records (the evidenceFloor
 *   legs); kpis <- the DH-08 records (the kpiDimensions legs);
 *   benchmarks <- the DH-09 records; lifecycle <- the DH-01 record
 *   (the REAL state machine projection). THE CONTENT LAW: no
 *   per-industry UI content is shipped - the labels are the
 *   caller's record values (the harnessId, the industry, the
 *   roleKey, the profileKey, the term, the taskKey, the packKey,
 *   the permissionRef, the benchmarkKey, the state names); the
 *   details are derived structural sentences; the badges are typed
 *   markers derived from the REAL record states. The caller
 *   composes the content; this family never invents it.
 * - THE SECTION-STATE LAW (binding): a section is 'composed' iff it
 *   carries at least one row, 'not-composed' otherwise (the honest
 *   absence - whether the family is absent or composing with zero
 *   entries, the section has no composed content yet); the
 *   not-composed section carries NO rows (never fabricated). The
 *   rows' badges carry the per-record REAL states.
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - projections are PURE DERIVATION and this family
 *   has ZERO SEAMS by design: no clock, no rng, no fs, no injected
 *   options (the kit module documents the same law at its
 *   boundary). The same inputs always produce a byte-identical
 *   model.
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed record
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal (factory misuse in the kit is a TypeError, not a
 *   domain refusal); multi-offense input walks report the COMPLETE
 *   rejection table in the frozen walk order.
 * - THE SINGLE-VERSION LAW (binding): PROJECTIONS_CONTRACTS_VERSION
 *   is '1.0.0' declared ONCE here, re-carried by the kit; the NINE
 *   landed family versions (DH-01..DH-09) are re-carried here BY
 *   REFERENCE (the battery pins every copy equal).
 * - THE CANONICAL SERIALIZATION LAW (binding): the navigation model
 *   serializes to canonical fixed-key-order JSON bytes
 *   (byte-deterministic; double-serialize byte-equality; the
 *   sections in the frozen section order, the rows in their derived
 *   order); the fail-closed parse refuses non-canonical bytes
 *   (never a silent normalization).
 * - Zero external dependencies: this module is pure vocabulary and
 *   derivation over typed values; no I/O, no clock, no env read.
 */

import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_LIFECYCLE_FORWARD_TRANSITIONS,
	HARNESS_LIFECYCLE_STATES,
	isHarnessId,
	isHarnessRecord,
} from '../../contract/common/domainHarnessContract.js';
import type {
	DomainHarnessDescriptor,
	HarnessLifecycleState,
	HarnessRecord,
	HarnessRole,
} from '../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION, ONBOARDING_STAGES, isOnboardingSessionRecord } from '../../onboarding/common/onboardingContract.js';
import type { OnboardingSessionRecord } from '../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION, isRoleCompositionSession } from '../../roles/common/rolesContract.js';
import type { RoleCompositionSession, RoleCompositionStage } from '../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION, isOntologyRecord } from '../../ontology/common/ontologyContract.js';
import type { DomainOntologyRecord, OntologyStage } from '../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION, isWorkflowTemplateRecord } from '../../templates/common/templatesContract.js';
import type { TemplateStage, WorkflowTemplateRecord } from '../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION, isOrganizationDefaultsRecord } from '../../bodies/common/bodiesContract.js';
import type { BodyStage, OrganizationDefaultsRecord } from '../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION, isCapabilityPacksRecord } from '../../packs/common/packsContract.js';
import type { PackStage, CapabilityPacksRecord } from '../../packs/common/packsContract.js';
import { PROFILES_CONTRACTS_VERSION, isProfilesRecord } from '../../profiles/common/profilesContract.js';
import type { ProfileEntry, ProfilesRecord, ProfilesStage } from '../../profiles/common/profilesContract.js';
import { BENCHMARKS_CONTRACTS_VERSION, isBenchmarksRecord } from '../../benchmarks/common/benchmarksContract.js';
import type { BenchmarkStage, BenchmarksRecord } from '../../benchmarks/common/benchmarksContract.js';

/**
 * THE IMPORT LAW's re-export block: the NINE landed family versions
 * re-carried BY REFERENCE (the same bindings, never re-declared
 * copies; the battery pins referential identity against the real
 * modules).
 */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';
export { TEMPLATES_CONTRACTS_VERSION } from '../../templates/common/templatesContract.js';
export { BODIES_CONTRACTS_VERSION } from '../../bodies/common/bodiesContract.js';
export { PACKS_CONTRACTS_VERSION } from '../../packs/common/packsContract.js';
export { PROFILES_CONTRACTS_VERSION } from '../../profiles/common/profilesContract.js';
export { BENCHMARKS_CONTRACTS_VERSION } from '../../benchmarks/common/benchmarksContract.js';

/**
 * THE IMPORT LAW's shape re-export block: the REAL record interfaces
 * (the projection's input vocabulary IS the families' record
 * vocabulary - never re-declared here).
 */
export type {
	DomainHarnessDescriptor,
	HarnessLifecycleState,
	HarnessRecord,
	HarnessRole,
} from '../../contract/common/domainHarnessContract.js';
export type { OnboardingSessionRecord } from '../../onboarding/common/onboardingContract.js';
export type { RoleCompositionSession } from '../../roles/common/rolesContract.js';
export type { DomainOntologyRecord } from '../../ontology/common/ontologyContract.js';
export type { WorkflowTemplateRecord } from '../../templates/common/templatesContract.js';
export type { OrganizationDefaultsRecord } from '../../bodies/common/bodiesContract.js';
export type { CapabilityPacksRecord } from '../../packs/common/packsContract.js';
export type { ProfileEntry, ProfilesRecord } from '../../profiles/common/profilesContract.js';
export type { BenchmarksRecord } from '../../benchmarks/common/benchmarksContract.js';

/** THE SINGLE-VERSION LAW: PROJECTIONS_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const PROJECTIONS_CONTRACTS_VERSION = '1.0.0';

/**
 * THE IMPORT LAW's stage-type mirror: the seven composing families'
 * stage unions (RoleCompositionStage | OntologyStage | TemplateStage
 * | BodyStage | PackStage | ProfilesStage | BenchmarkStage), pinned
 * exhaustively at compile time by the Record below - if ANY family's
 * stage list drifts (a stage added or removed), this module's
 * compilation breaks until the mirror is reconciled (the
 * profilesContract pinned-mirror discipline: a projection of the
 * real vocabularies, never a second authority).
 */
type ComposingFamilyStage = RoleCompositionStage | OntologyStage | TemplateStage | BodyStage | PackStage | ProfilesStage | BenchmarkStage;

const FAMILY_STAGE_MEMBERS: Readonly<Record<ComposingFamilyStage, true>> = {
	'composing': true,
	'composed': true,
};

/** The composing families' shared stage vocabulary as a runtime list (derived from the pinned mirror). */
export const DOMAIN_FAMILY_STAGES: readonly ComposingFamilyStage[] = Object.freeze([...(Object.keys(FAMILY_STAGE_MEMBERS) as ComposingFamilyStage[])]);

/**
 * The frozen navigation section list, in the EXACT frozen order (the
 * work order's order; widening or reordering is a versioned contract
 * decision):
 *   overview     - industry, workTypes, displayName, lifecycle state
 *                  (the DH-01 record) + the DH-02 session records;
 *   roles        - the DH-01 descriptor's roles + the DH-03 records;
 *   workflows    - the DH-05 template records + the DH-04 term
 *                  records;
 *   capabilities - the DH-07 pack records + the DH-06 body records +
 *                  the DH-08 permission legs;
 *   policies     - the DH-08 records (permissionRefs/approvalTiers);
 *   evidence     - the DH-08 records (evidenceFloor legs);
 *   kpis         - the DH-08 records (kpiDimensions legs);
 *   benchmarks   - the DH-09 records;
 *   lifecycle    - the DH-01 state machine projection.
 */
export const DOMAIN_NAVIGATION_SECTIONS = [
	'overview',
	'roles',
	'workflows',
	'capabilities',
	'policies',
	'evidence',
	'kpis',
	'benchmarks',
	'lifecycle',
] as const;
export type DomainNavigationSectionId = (typeof DOMAIN_NAVIGATION_SECTIONS)[number];

/** Pure predicate over the closed section list. */
export function isDomainNavigationSectionId(value: unknown): value is DomainNavigationSectionId {
	return (DOMAIN_NAVIGATION_SECTIONS as readonly string[]).includes(value as string);
}

/**
 * THE SECTION-STATE LAW's two honest states: 'composed' iff the
 * section carries at least one row; 'not-composed' when the family
 * has no composed content yet (absent, or composing with zero
 * entries) - the rows stay empty, never fabricated.
 */
export const DOMAIN_SECTION_STATES = ['composed', 'not-composed'] as const;
export type DomainSectionStateKind = (typeof DOMAIN_SECTION_STATES)[number];

/** Pure predicate over the closed section-state list. */
export function isDomainSectionStateKind(value: unknown): value is DomainSectionStateKind {
	return (DOMAIN_SECTION_STATES as readonly string[]).includes(value as string);
}

/**
 * The frozen row-badge vocabulary, DERIVED from the REAL imported
 * state vocabularies (never transcribed): the DH-01 lifecycle states
 * (draft/proposed/approved/active/retired - the anchor's badge), the
 * DH-02 onboarding stages (industry/company/work-types/review/
 * proposed - the session rows' badge), the composing families' shared
 * stages (composing/composed - the family rows' badge), plus the one
 * derived marker 'not-composed' (THE ABSENT-FAMILY LAW's honest
 * section state; the surface renders it on the section header, never
 * on a fabricated row).
 */
export const DOMAIN_SECTION_ROW_BADGES = [
	...HARNESS_LIFECYCLE_STATES,
	...ONBOARDING_STAGES,
	...DOMAIN_FAMILY_STAGES,
	'not-composed',
] as const;
export type DomainSectionRowBadge = (typeof DOMAIN_SECTION_ROW_BADGES)[number];

/** Pure predicate over the closed badge list. */
export function isDomainSectionRowBadge(value: unknown): value is DomainSectionRowBadge {
	return (DOMAIN_SECTION_ROW_BADGES as readonly string[]).includes(value as string);
}

/**
 * THE CONTENT LAW's typed row: one navigation row. The label is the
 * caller's record value; the detail is the derived structural
 * sentence; the badge is the typed lifecycle/validity marker derived
 * from the REAL record state (e.g. 'composed', 'draft', 'active').
 */
export interface DomainSectionRow {
	readonly rowKey: string;
	readonly label: string;
	readonly detail: string;
	readonly badge: DomainSectionRowBadge;
}

/** One frozen section of the navigation model (THE SECTION-STATE LAW). */
export interface DomainNavigationSection {
	readonly section: DomainNavigationSectionId;
	readonly sectionState: DomainSectionStateKind;
	readonly rows: readonly DomainSectionRow[];
}

/**
 * The derived navigation model: the anchor's harness id, the
 * re-carried contract version (THE SINGLE-VERSION LAW), and the
 * EXACTLY nine sections in the frozen order. A DERIVED READ-ONLY
 * view model (THE PROJECTION LAW) - never persisted by this family.
 */
export interface DomainNavigationModel {
	readonly harnessId: string;
	readonly contractVersion: string;
	readonly sections: readonly DomainNavigationSection[];
}

/** The frozen model schema keys, in the canonical fixed-key-order (the serialization order). */
export const DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS = ['harnessId', 'contractVersion', 'sections'] as const;

/** The frozen section schema keys, in the canonical fixed-key-order. */
export const DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS = ['section', 'sectionState', 'rows'] as const;

/** The frozen row schema keys, in the canonical fixed-key-order. */
export const DOMAIN_SECTION_ROW_SCHEMA_KEYS = ['rowKey', 'label', 'detail', 'badge'] as const;

/**
 * THE ANCHOR LAW + THE ABSENT-FAMILY LAW's typed input: the REQUIRED
 * harness slot (one DH-01 record - the projection anchor; the key
 * absent or undefined is the typed missing-record rejection) and the
 * eight optional family slots (record arrays; `undefined` is THE ONE
 * honest absent marker - the section renders the honest
 * not-composed state; a present value that is not the family's valid
 * records is the typed malformed-record rejection naming the family).
 * THE BINDING LAW: records that carry a harnessId must bind to the
 * anchor's harnessId.
 */
export interface ProjectNavigationInputs {
	/** REQUIRED (THE ANCHOR LAW): the DH-01 harness record the model projects. */
	readonly harness: HarnessRecord;
	/** The DH-02 onboarding session records (undefined = the absent family). */
	readonly onboarding?: readonly OnboardingSessionRecord[];
	/** The DH-03 role-composition session records (undefined = the absent family; no harnessId binding - the caller's wiring). */
	readonly roles?: readonly RoleCompositionSession[];
	/** The DH-04 domain ontology records (undefined = the absent family). */
	readonly ontology?: readonly DomainOntologyRecord[];
	/** The DH-05 workflow template records (undefined = the absent family). */
	readonly templates?: readonly WorkflowTemplateRecord[];
	/** The DH-06 organization defaults records (undefined = the absent family). */
	readonly bodies?: readonly OrganizationDefaultsRecord[];
	/** The DH-07 capability packs records (undefined = the absent family). */
	readonly packs?: readonly CapabilityPacksRecord[];
	/** The DH-08 policy/approval/evidence/KPI profiles records (undefined = the absent family). */
	readonly profiles?: readonly ProfilesRecord[];
	/** The DH-09 benchmark records (undefined = the absent family). */
	readonly benchmarks?: readonly BenchmarksRecord[];
}

/** The frozen input schema keys (THE IMPORT LAW's nine family slots, in the walk order). */
export const PROJECTIONS_INPUT_SCHEMA_KEYS = [
	'harness',
	'onboarding',
	'roles',
	'ontology',
	'templates',
	'bodies',
	'packs',
	'profiles',
	'benchmarks',
] as const;

/**
 * The frozen per-family id alphabets (for the duplicate-record walk
 * and the rejection details; the REAL contracts' own prefixes,
 * restated here only as the projection's family-name map - the id
 * FORM laws live in the real contracts and are enforced by the
 * imported validators, never here).
 */
export const PROJECTIONS_FAMILY_ID_PREFIXES = {
	harness: 'flauz:hrn:',
	onboarding: 'flauz:onb:',
	roles: 'flauz:rol:',
	ontology: 'flauz:ont:',
	templates: 'flauz:tpl:',
	bodies: 'flauz:bod:',
	packs: 'flauz:pak:',
	profiles: 'flauz:prf:',
	benchmarks: 'flauz:ben:',
} as const;

/**
 * Closed frozen list of projection rejection reasons, in the exact
 * walk order (the walk collects EVERY violated law into the typed
 * rejection table, the table's records appearing in this order):
 *   malformed-inputs  - the inputs carrier is not a plain object;
 *   unknown-key       - an inputs key outside the frozen nine-key
 *                       input schema (THE NO-FORK LAW's strict
 *                       schema engine);
 *   missing-record    - THE ANCHOR LAW: the 'harness' slot is absent
 *                       (the key missing or the value undefined) -
 *                       the projection has no anchor;
 *   malformed-record  - THE ABSENT-FAMILY LAW's refusal side: a
 *                       PRESENT family slot (or the anchor slot's
 *                       present value, or an array member) fails the
 *                       REAL family validator - never a silent skip;
 *   duplicate-record  - THE DUPLICATE-RECORD LAW: repeated record
 *                       ids within one family slot;
 *   foreign-record    - THE BINDING LAW: a record binds to a
 *                       harnessId other than the anchor's.
 * Widening or reordering the list is a versioned contract decision.
 */
export const PROJECTIONS_REJECTION_REASONS = [
	'malformed-inputs',
	'unknown-key',
	'missing-record',
	'malformed-record',
	'duplicate-record',
	'foreign-record',
] as const;
export type ProjectionsRejectionReason = (typeof PROJECTIONS_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isProjectionsRejectionReason(value: unknown): value is ProjectionsRejectionReason {
	return (PROJECTIONS_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from the input walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface ProjectionsRejection {
	readonly reason: ProjectionsRejectionReason;
	readonly law: string;
	readonly items?: readonly string[];
	readonly detail: string;
}

/**
 * The typed projection outcome: ok carries the derived navigation
 * model; refusal carries the COMPLETE typed rejection table in the
 * frozen walk order - never first-only.
 */
export type NavigationProjectionOutcome =
	| { readonly ok: true; readonly model: DomainNavigationModel }
	| { readonly ok: false; readonly mode: 'inputs'; readonly rejections: readonly ProjectionsRejection[] };

// --- the per-section row derivations (pure; THE SECTION-SOURCE MAP) ---

/**
 * The overview rows: the anchor's identity panel (the harness id,
 * the industry, the work types, the display name, the lifecycle
 * state - all from the REAL DH-01 record, badged with the record's
 * REAL lifecycle state) plus, per DH-02 session record (in input
 * order), the observed selection state (the session stage, the
 * selected industry, the company profile, the selected work types,
 * the review composition, the proposed harness link - badged with
 * the session's REAL stage; the nullable payload fields project only
 * when set, never fabricated).
 */
export function projectOverviewRows(harness: HarnessRecord, onboarding: readonly OnboardingSessionRecord[]): DomainSectionRow[] {
	const state = harness.state;
	const descriptor = harness.descriptor;
	const rows: DomainSectionRow[] = [
		{ rowKey: 'overview-harness', label: harness.harnessId, detail: 'the harness record (the projection anchor)', badge: state },
		{ rowKey: 'overview-industry', label: descriptor.industry, detail: 'industry', badge: state },
		{ rowKey: 'overview-work-types', label: showList(descriptor.workTypes), detail: 'work types', badge: state },
		{ rowKey: 'overview-display-name', label: descriptor.displayName, detail: 'display name', badge: state },
		{ rowKey: 'overview-lifecycle', label: state, detail: 'lifecycle state', badge: state },
	];
	for (const session of onboarding) {
		rows.push({ rowKey: `overview-session-${session.sessionId}`, label: session.sessionId, detail: `onboarding session - stage ${session.stage}`, badge: stageBadge(session.stage) });
		if (session.industry !== null) {
			rows.push({ rowKey: `overview-session-industry-${session.sessionId}`, label: session.industry, detail: 'the session\'s selected industry', badge: stageBadge(session.stage) });
		}
		if (session.companyProfile !== null) {
			rows.push({ rowKey: `overview-company-${session.sessionId}`, label: session.companyProfile.displayName, detail: `company - ${session.companyProfile.sizeBand}`, badge: stageBadge(session.stage) });
		}
		if (session.workTypes !== null) {
			rows.push({ rowKey: `overview-session-work-types-${session.sessionId}`, label: showList(session.workTypes), detail: 'the session\'s selected work types', badge: stageBadge(session.stage) });
		}
		if (session.reviewComposition !== null) {
			const composition = session.reviewComposition;
			rows.push({
				rowKey: `overview-session-composition-${session.sessionId}`,
				label: `${composition.roles.length} roles, ${composition.capabilityRefs.length} capability refs, ${composition.workflowRefs.length} workflow refs, ${composition.policyRefs.length} policy refs, ${composition.evidenceRefs.length} evidence refs`,
				detail: 'the review composition',
				badge: stageBadge(session.stage),
			});
		}
		if (session.harnessId !== null) {
			rows.push({ rowKey: `overview-session-harness-${session.sessionId}`, label: session.harnessId, detail: 'the session\'s proposed harness', badge: stageBadge(session.stage) });
		}
	}
	return rows;
}

/**
 * The roles rows: the anchor descriptor's roles (THE ANCHOR LAW's
 * floor - the DH-01 record's own composed roles, badged with the
 * record's REAL lifecycle state) plus, per DH-03 session record (in
 * input order), the composition-layer roles (badged with the
 * session's REAL stage).
 */
export function projectRolesRows(harness: HarnessRecord, roles: readonly RoleCompositionSession[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const role of harness.descriptor.roles) {
		rows.push({ rowKey: `roles-descriptor-${role.roleKey}`, label: role.roleKey, detail: role.summary, badge: harness.state });
	}
	for (const session of roles) {
		for (const role of session.roles) {
			rows.push({ rowKey: `roles-${session.sessionId}-${role.roleKey}`, label: role.roleKey, detail: role.summary, badge: stageBadge(session.stage) });
		}
	}
	return rows;
}

/**
 * The workflows rows: per DH-05 template record (in input order),
 * one row per task entry (badged with the record's REAL stage),
 * then per DH-04 ontology record (in input order), one row per term
 * entry (the domain terminology the templates' termRefs reference,
 * badged with the record's REAL stage).
 */
export function projectWorkflowsRows(templates: readonly WorkflowTemplateRecord[], ontology: readonly DomainOntologyRecord[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of templates) {
		for (const task of record.tasks) {
			rows.push({ rowKey: `workflows-${record.templateId}-${task.taskKey}`, label: task.taskKey, detail: task.summary, badge: stageBadge(record.stage) });
		}
	}
	for (const record of ontology) {
		for (const term of record.terms) {
			rows.push({ rowKey: `workflows-terms-${record.ontologyId}-${term.term}`, label: term.term, detail: term.definition, badge: stageBadge(record.stage) });
		}
	}
	return rows;
}

/**
 * The capabilities rows: per DH-07 pack record (in input order), one
 * row per pack entry; per DH-06 body record (in input order), one
 * row per body entry (the default agent bodies the packs' bodyRefs
 * reference); then the DH-08 permission legs - one row per DISTINCT
 * permissionRef across the profiles records (first-seen order),
 * carrying the declaring profileKeys and the combined stage badge
 * ('composed' iff EVERY declaring record is composed).
 */
export function projectCapabilitiesRows(
	packs: readonly CapabilityPacksRecord[],
	bodies: readonly OrganizationDefaultsRecord[],
	profiles: readonly ProfilesRecord[],
): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of packs) {
		for (const pack of record.packs) {
			rows.push({ rowKey: `capabilities-${record.id}-${pack.packKey}`, label: pack.packKey, detail: pack.summary, badge: stageBadge(record.stage) });
		}
	}
	for (const record of bodies) {
		for (const body of record.bodies) {
			rows.push({ rowKey: `capabilities-bodies-${record.bodyId}-${body.bodyKey}`, label: body.bodyKey, detail: body.summary, badge: stageBadge(record.stage) });
		}
	}
	const declaring = new Map<string, { profileKeys: string[]; allComposed: boolean }>();
	for (const record of profiles) {
		for (const profile of record.profiles) {
			for (const permissionRef of profile.permissionRefs) {
				const entry = declaring.get(permissionRef) ?? { profileKeys: [], allComposed: true };
				if (!entry.profileKeys.includes(profile.profileKey)) {
					entry.profileKeys.push(profile.profileKey);
				}
				if (record.stage !== 'composed') {
					entry.allComposed = false;
				}
				declaring.set(permissionRef, entry);
			}
		}
	}
	for (const [permissionRef, entry] of declaring) {
		rows.push({
			rowKey: `capabilities-permission-${permissionRef}`,
			label: permissionRef,
			detail: `permission leg - declared by ${showList(entry.profileKeys)}`,
			badge: entry.allComposed ? 'composed' : 'composing',
		});
	}
	return rows;
}

/** The policies rows: per DH-08 record (in input order), one row per profile entry (the permissionRefs and approvalTiers legs). */
export function projectPoliciesRows(profiles: readonly ProfilesRecord[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of profiles) {
		for (const profile of record.profiles) {
			rows.push({
				rowKey: `policies-${record.profilesId}-${profile.profileKey}`,
				label: profile.profileKey,
				detail: `permissions: ${showList(profile.permissionRefs)}; approval tiers: ${showList(profile.approvalTiers)}`,
				badge: stageBadge(record.stage),
			});
		}
	}
	return rows;
}

/** The evidence rows: per DH-08 record (in input order), one row per profile entry (the evidenceFloor leg). */
export function projectEvidenceRows(profiles: readonly ProfilesRecord[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of profiles) {
		for (const profile of record.profiles) {
			rows.push({
				rowKey: `evidence-${record.profilesId}-${profile.profileKey}`,
				label: profile.profileKey,
				detail: `evidence floor: ${profile.evidenceFloor}`,
				badge: stageBadge(record.stage),
			});
		}
	}
	return rows;
}

/** The kpis rows: per DH-08 record (in input order), one row per profile entry (the kpiDimensions leg). */
export function projectKpisRows(profiles: readonly ProfilesRecord[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of profiles) {
		for (const profile of record.profiles) {
			rows.push({
				rowKey: `kpis-${record.profilesId}-${profile.profileKey}`,
				label: profile.profileKey,
				detail: `KPI dimensions: ${showList(profile.kpiDimensions)}`,
				badge: stageBadge(record.stage),
			});
		}
	}
	return rows;
}

/** The benchmarks rows: per DH-09 record (in input order), one row per benchmark entry (badged with the record's REAL stage). */
export function projectBenchmarksRows(benchmarks: readonly BenchmarksRecord[]): DomainSectionRow[] {
	const rows: DomainSectionRow[] = [];
	for (const record of benchmarks) {
		for (const benchmark of record.benchmarks) {
			rows.push({
				rowKey: `benchmarks-${record.id}-${benchmark.benchmarkKey}`,
				label: benchmark.benchmarkKey,
				detail: `${benchmark.summary} - ${benchmark.scenarioRefs.length} scenario refs, evidence ${benchmark.evidenceLevel}`,
				badge: stageBadge(record.stage),
			});
		}
	}
	return rows;
}

/**
 * The lifecycle rows (the DH-01 state machine projection): one row
 * per REAL lifecycle state in the frozen list order (badged with the
 * state it names; the detail carries the derived position - current /
 * past / upcoming, retired noted terminal), then one row per
 * whitelisted forward transition in the frozen order (badged with
 * the edge's from-state; the detail carries the derived position -
 * available (the next legal step from the current state) / consumed /
 * not reached).
 */
export function projectLifecycleRows(harness: HarnessRecord): DomainSectionRow[] {
	const current = harness.state;
	const currentIndex = stateIndex(current);
	const rows: DomainSectionRow[] = [];
	for (const state of HARNESS_LIFECYCLE_STATES) {
		const index = stateIndex(state);
		const position = index === currentIndex ? 'current' : index < currentIndex ? 'past' : 'upcoming';
		rows.push({
			rowKey: `lifecycle-state-${state}`,
			label: state,
			detail: position === 'current' && state === 'retired' ? 'current (terminal)' : position === 'upcoming' && state === 'retired' ? 'upcoming (terminal)' : position,
			badge: state,
		});
	}
	for (const transition of HARNESS_LIFECYCLE_FORWARD_TRANSITIONS) {
		const fromIndex = stateIndex(transition.from);
		const position = fromIndex === currentIndex ? 'available (the next legal step)' : fromIndex < currentIndex ? 'consumed' : 'not reached';
		rows.push({
			rowKey: `lifecycle-transition-${transition.from}-${transition.to}`,
			label: `${transition.from} -> ${transition.to}`,
			detail: position,
			badge: transition.from,
		});
	}
	return rows;
}

// --- THE PROJECTION FUNCTION (total, deterministic, fail-closed) ---

/**
 * THE PROJECTION FUNCTION: caller-supplied composed records -> the
 * navigation model. Total (every input gets a typed verdict),
 * deterministic (zero seams - no clock, no rng, no fs), fail-closed
 * (the frozen six-station input walk collects EVERY violated law
 * into the COMPLETE typed rejection table; the records are validated
 * by the REAL families' own validators, imported by reference). THE
 * ANCHOR LAW / THE ABSENT-FAMILY LAW / THE BINDING LAW /
 * THE DUPLICATE-RECORD LAW hold at this boundary. Never mutates its
 * inputs; never persists anything (THE PROJECTION LAW).
 */
export function projectNavigation(inputs: unknown): NavigationProjectionOutcome {
	const malformedInputs: ProjectionsRejection[] = [];
	const unknownKey: ProjectionsRejection[] = [];
	const missingRecord: ProjectionsRejection[] = [];
	const malformedRecord: ProjectionsRejection[] = [];
	const duplicateRecord: ProjectionsRejection[] = [];
	const foreignRecord: ProjectionsRejection[] = [];

	if (!isRecord(inputs)) {
		malformedInputs.push({
			reason: 'malformed-inputs',
			law: 'THE FAIL-CLOSED LAW',
			items: ['inputs'],
			detail: 'projectNavigation: the inputs must be a plain object (THE ANCHOR LAW\'s harness slot plus the eight optional family slots)',
		});
		return { ok: false, mode: 'inputs', rejections: malformedInputs };
	}

	const carrier = inputs as Record<string, unknown>;
	const keys = Object.keys(carrier);
	const unknownKeys = keys.filter((key) => !(PROJECTIONS_INPUT_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		unknownKey.push({
			reason: 'unknown-key',
			law: 'THE NO-FORK LAW',
			items: unknownKeys,
			detail: `projectNavigation: the input schema is closed (the nine family slots only) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
		});
	}

	// THE ANCHOR LAW: the harness slot is REQUIRED (undefined/absent = the missing anchor).
	let anchor: HarnessRecord | undefined;
	if (!hasOwn(carrier, 'harness') || carrier.harness === undefined) {
		missingRecord.push({
			reason: 'missing-record',
			law: 'THE ANCHOR LAW',
			items: ['harness'],
			detail: `projectNavigation: the 'harness' slot is REQUIRED - the navigation model is the projection of ONE harness and has no anchor without the DH-01 record (${PROJECTIONS_FAMILY_ID_PREFIXES.harness}<16-hex>)`,
		});
	} else if (!isHarnessRecord(carrier.harness)) {
		malformedRecord.push({
			reason: 'malformed-record',
			law: 'THE IMPORT LAW',
			items: ['harness'],
			detail: 'projectNavigation: the present harness slot fails the REAL DH-01 isHarnessRecord walk (imported by reference, never re-implemented)',
		});
	} else {
		anchor = carrier.harness;
	}

	// The optional family slots: undefined = the honest absent family; present = the REAL validator's verdict.
	const onboarding = familyRecords<OnboardingSessionRecord>(carrier.onboarding, 'onboarding', isOnboardingSessionRecord, malformedRecord);
	const roles = familyRecords<RoleCompositionSession>(carrier.roles, 'roles', isRoleCompositionSession, malformedRecord);
	const ontology = familyRecords<DomainOntologyRecord>(carrier.ontology, 'ontology', isOntologyRecord, malformedRecord);
	const templates = familyRecords<WorkflowTemplateRecord>(carrier.templates, 'templates', isWorkflowTemplateRecord, malformedRecord);
	const bodies = familyRecords<OrganizationDefaultsRecord>(carrier.bodies, 'bodies', isOrganizationDefaultsRecord, malformedRecord);
	const packs = familyRecords<CapabilityPacksRecord>(carrier.packs, 'packs', isCapabilityPacksRecord, malformedRecord);
	const profiles = familyRecords<ProfilesRecord>(carrier.profiles, 'profiles', isProfilesRecord, malformedRecord);
	const benchmarks = familyRecords<BenchmarksRecord>(carrier.benchmarks, 'benchmarks', isBenchmarksRecord, malformedRecord);

	// THE DUPLICATE-RECORD LAW (per family slot, first-seen order).
	if (onboarding !== undefined) {
		collectDuplicateIds(onboarding.map((record) => record.sessionId), 'onboarding', duplicateRecord);
	}
	if (roles !== undefined) {
		collectDuplicateIds(roles.map((record) => record.sessionId), 'roles', duplicateRecord);
	}
	if (ontology !== undefined) {
		collectDuplicateIds(ontology.map((record) => record.ontologyId), 'ontology', duplicateRecord);
	}
	if (templates !== undefined) {
		collectDuplicateIds(templates.map((record) => record.templateId), 'templates', duplicateRecord);
	}
	if (bodies !== undefined) {
		collectDuplicateIds(bodies.map((record) => record.bodyId), 'bodies', duplicateRecord);
	}
	if (packs !== undefined) {
		collectDuplicateIds(packs.map((record) => record.id), 'packs', duplicateRecord);
	}
	if (profiles !== undefined) {
		collectDuplicateIds(profiles.map((record) => record.profilesId), 'profiles', duplicateRecord);
	}
	if (benchmarks !== undefined) {
		collectDuplicateIds(benchmarks.map((record) => record.id), 'benchmarks', duplicateRecord);
	}

	// THE BINDING LAW: records carrying a harnessId must bind to the anchor (walkable only with a valid anchor).
	if (anchor !== undefined) {
		if (onboarding !== undefined) {
			collectForeignRecords(
				onboarding.map((record) => ({ id: record.sessionId, harnessId: record.harnessId })),
				'onboarding',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (ontology !== undefined) {
			collectForeignRecords(
				ontology.map((record) => ({ id: record.ontologyId, harnessId: record.harnessId })),
				'ontology',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (templates !== undefined) {
			collectForeignRecords(
				templates.map((record) => ({ id: record.templateId, harnessId: record.harnessId })),
				'templates',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (bodies !== undefined) {
			collectForeignRecords(
				bodies.map((record) => ({ id: record.bodyId, harnessId: record.harnessId })),
				'bodies',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (packs !== undefined) {
			collectForeignRecords(
				packs.map((record) => ({ id: record.id, harnessId: record.harnessId })),
				'packs',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (profiles !== undefined) {
			collectForeignRecords(
				profiles.map((record) => ({ id: record.profilesId, harnessId: record.harnessId })),
				'profiles',
				anchor.harnessId,
				foreignRecord,
			);
		}
		if (benchmarks !== undefined) {
			collectForeignRecords(
				benchmarks.map((record) => ({ id: record.id, harnessId: record.harnessId })),
				'benchmarks',
				anchor.harnessId,
				foreignRecord,
			);
		}
	}

	const rejections = [...malformedInputs, ...unknownKey, ...missingRecord, ...malformedRecord, ...duplicateRecord, ...foreignRecord];
	if (rejections.length > 0) {
		return { ok: false, mode: 'inputs', rejections };
	}
	if (anchor === undefined) {
		// Unreachable in practice (the anchor slot's verdicts are collected above); kept for the type narrowing law.
		return { ok: false, mode: 'inputs', rejections: [{ reason: 'missing-record', law: 'THE ANCHOR LAW', items: ['harness'], detail: 'projectNavigation: the harness slot is required' }] };
	}

	const model: DomainNavigationModel = {
		harnessId: anchor.harnessId,
		contractVersion: PROJECTIONS_CONTRACTS_VERSION,
		sections: [
			sectionOf('overview', projectOverviewRows(anchor, onboarding ?? [])),
			sectionOf('roles', projectRolesRows(anchor, roles ?? [])),
			sectionOf('workflows', projectWorkflowsRows(templates ?? [], ontology ?? [])),
			sectionOf('capabilities', projectCapabilitiesRows(packs ?? [], bodies ?? [], profiles ?? [])),
			sectionOf('policies', projectPoliciesRows(profiles ?? [])),
			sectionOf('evidence', projectEvidenceRows(profiles ?? [])),
			sectionOf('kpis', projectKpisRows(profiles ?? [])),
			sectionOf('benchmarks', projectBenchmarksRows(benchmarks ?? [])),
			sectionOf('lifecycle', projectLifecycleRows(anchor)),
		],
	};
	return { ok: true, model };
}

// --- the model validation walk + the canonical serialization + the fail-closed parse ---

/**
 * Closed frozen list of navigation-model rejection reasons, in the
 * exact walk order (the walk is first-failure-is-the-verdict at each
 * station, the stations visited in this order):
 *   malformed-model        - the candidate is not a plain object, or
 *                            a carrier carries the wrong structural
 *                            type (a non-array sections / rows
 *                            carrier, a non-object section / row, a
 *                            non-string row field);
 *   unknown-key            - a key outside the frozen schema at the
 *                            model / section / row level;
 *   missing-key            - a required key is absent;
 *   bad-harness-id         - the model's harnessId is not the REAL
 *                            DH-01 flauz:hrn:<16-hex> form (imported
 *                            by reference);
 *   version-mismatch       - THE SINGLE-VERSION LAW: the
 *                            contractVersion is not
 *                            PROJECTIONS_CONTRACTS_VERSION;
 *   bad-section-list       - the sections are not EXACTLY the nine
 *                            frozen sections in the frozen order;
 *   bad-section-state      - a sectionState is not a member of the
 *                            frozen two-state list, or THE
 *                            SECTION-STATE LAW is violated (a
 *                            'composed' section with zero rows, a
 *                            'not-composed' section with rows);
 *   bad-row                - a row's rowKey / label / detail is not
 *                            a non-empty string, or the badge is not
 *                            a member of the frozen badge list;
 *   duplicate-row-key      - rowKeys repeat within the model.
 * Widening or reordering the list is a versioned contract decision.
 */
export const PROJECTIONS_MODEL_REJECTION_REASONS = [
	'malformed-model',
	'unknown-key',
	'missing-key',
	'bad-harness-id',
	'version-mismatch',
	'bad-section-list',
	'bad-section-state',
	'bad-row',
	'duplicate-row-key',
] as const;
export type ProjectionsModelRejectionReason = (typeof PROJECTIONS_MODEL_REJECTION_REASONS)[number];

/** Pure predicate over the closed model-rejection list. */
export function isProjectionsModelRejectionReason(value: unknown): value is ProjectionsModelRejectionReason {
	return (PROJECTIONS_MODEL_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** One typed model rejection: the frozen reason, the violated law's name, the offending items, and the deterministic detail sentence. */
export interface ProjectionsModelRejection {
	readonly reason: ProjectionsModelRejectionReason;
	readonly law: string;
	readonly items?: readonly string[];
	readonly detail: string;
}

/** The typed model-validation outcome: ok carries the canonical model; refusal carries the first violated station's typed rejection. */
export type NavigationModelValidationOutcome =
	| { readonly ok: true; readonly model: DomainNavigationModel }
	| { readonly ok: false; readonly rejection: ProjectionsModelRejection };

/**
 * The deep navigation-model walk (pure): the frozen nine-station
 * tour over a model candidate. THE PROJECTION LAW re-proven here:
 * the walk never reads a clock, never mutates its input. Ok carries
 * the canonical fixed-key-order copy. First-failure-is-the-verdict
 * in the frozen walk order.
 */
export function validateNavigationModel(value: unknown): NavigationModelValidationOutcome {
	if (!isRecord(value)) {
		return rejectedModel('malformed-model', 'THE FAIL-CLOSED LAW', 'validateNavigationModel: the navigation model must be a plain object (never a silent partial verdict)', ['model']);
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	const unknownKeys = keys.filter((key) => !(DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		return rejectedModel('unknown-key', 'THE NO-FORK LAW', `validateNavigationModel: the model schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
	}
	const missingKeys = (DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
	if (missingKeys.length > 0) {
		return rejectedModel('missing-key', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the model schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
	}
	if (typeof candidate.harnessId !== 'string' || typeof candidate.contractVersion !== 'string' || !Array.isArray(candidate.sections)) {
		return rejectedModel('malformed-model', 'THE FAIL-CLOSED LAW', 'validateNavigationModel: the model envelope carries a value of the wrong structural type (a non-string harnessId / contractVersion, a non-array sections carrier)', ['model']);
	}
	if (!isHarnessId(candidate.harnessId)) {
		return rejectedModel('bad-harness-id', 'THE IMPORT LAW', `validateNavigationModel: the harnessId must be the REAL DH-01 ${PROJECTIONS_FAMILY_ID_PREFIXES.harness}<16-hex> form (imported by reference)`, [showValue(candidate.harnessId)]);
	}
	if (candidate.contractVersion !== PROJECTIONS_CONTRACTS_VERSION) {
		return rejectedModel('version-mismatch', 'THE SINGLE-VERSION LAW', `validateNavigationModel: the model must carry PROJECTIONS_CONTRACTS_VERSION '${PROJECTIONS_CONTRACTS_VERSION}' exactly`, [showValue(candidate.contractVersion)]);
	}
	const sections = candidate.sections as unknown[];
	if (sections.length !== DOMAIN_NAVIGATION_SECTIONS.length) {
		return rejectedModel('bad-section-list', 'THE SECTION-SOURCE MAP', `validateNavigationModel: the model carries ${sections.length} sections - EXACTLY ${DOMAIN_NAVIGATION_SECTIONS.length} are required (the frozen section list)`, [`${sections.length} sections`]);
	}
	const seenRowKeys = new Set<string>();
	for (let i = 0; i < sections.length; i += 1) {
		const sectionCandidate = sections[i];
		if (!isRecord(sectionCandidate)) {
			return rejectedModel('malformed-model', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the section at index ${i} must be a plain object`, [`sections[${i}]`]);
		}
		const sectionKeys = Object.keys(sectionCandidate);
		const unknownSectionKeys = sectionKeys.filter((key) => !(DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS as readonly string[]).includes(key));
		if (unknownSectionKeys.length > 0) {
			return rejectedModel('unknown-key', 'THE NO-FORK LAW', `validateNavigationModel: the section at index ${i} carries the unknown key(s) ${showList(unknownSectionKeys)} (the three-key section schema is closed)`, unknownSectionKeys);
		}
		const missingSectionKeys = (DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(sectionCandidate, key));
		if (missingSectionKeys.length > 0) {
			return rejectedModel('missing-key', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the section at index ${i} is missing the key(s) ${showList(missingSectionKeys)}`, missingSectionKeys);
		}
		if (sectionCandidate.section !== DOMAIN_NAVIGATION_SECTIONS[i]) {
			return rejectedModel('bad-section-list', 'THE SECTION-SOURCE MAP', `validateNavigationModel: the section at index ${i} must be '${DOMAIN_NAVIGATION_SECTIONS[i]}' (the frozen section order) - found '${showValue(sectionCandidate.section)}'`, [`sections[${i}]:${showValue(sectionCandidate.section)}`]);
		}
		if (!isDomainSectionStateKind(sectionCandidate.sectionState)) {
			return rejectedModel('bad-section-state', 'THE SECTION-STATE LAW', `validateNavigationModel: the section at index ${i} carries a sectionState that is not a member of the frozen two-state list`, [`sections[${i}]:${showValue(sectionCandidate.sectionState)}`]);
		}
		if (!Array.isArray(sectionCandidate.rows)) {
			return rejectedModel('malformed-model', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the section at index ${i} carries a rows carrier that is not an array`, [`sections[${i}]:rows`]);
		}
		const rows = sectionCandidate.rows as unknown[];
		if ((sectionCandidate.sectionState === 'composed') !== (rows.length > 0)) {
			return rejectedModel('bad-section-state', 'THE SECTION-STATE LAW', `validateNavigationModel: the section '${DOMAIN_NAVIGATION_SECTIONS[i]}' violates the section-state law - 'composed' iff at least one row, 'not-composed' with zero rows (never fabricated)`, [`sections[${i}]:${sectionCandidate.sectionState}:${rows.length} rows`]);
		}
		for (let j = 0; j < rows.length; j += 1) {
			const rowCandidate = rows[j];
			if (!isRecord(rowCandidate)) {
				return rejectedModel('malformed-model', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the row at sections[${i}][${j}] must be a plain object`, [`sections[${i}][${j}]`]);
			}
			const rowKeys = Object.keys(rowCandidate);
			const unknownRowKeys = rowKeys.filter((key) => !(DOMAIN_SECTION_ROW_SCHEMA_KEYS as readonly string[]).includes(key));
			if (unknownRowKeys.length > 0) {
				return rejectedModel('unknown-key', 'THE NO-FORK LAW', `validateNavigationModel: the row at sections[${i}][${j}] carries the unknown key(s) ${showList(unknownRowKeys)} (the four-key row schema is closed)`, unknownRowKeys);
			}
			const missingRowKeys = (DOMAIN_SECTION_ROW_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(rowCandidate, key));
			if (missingRowKeys.length > 0) {
				return rejectedModel('missing-key', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the row at sections[${i}][${j}] is missing the key(s) ${showList(missingRowKeys)}`, missingRowKeys);
			}
			const row = rowCandidate as Record<string, unknown>;
			if (typeof row.rowKey !== 'string' || row.rowKey.length === 0 || typeof row.label !== 'string' || row.label.length === 0 || typeof row.detail !== 'string' || row.detail.length === 0) {
				return rejectedModel('bad-row', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the row at sections[${i}][${j}] carries a rowKey / label / detail that is not a non-empty string`, [`sections[${i}][${j}]`]);
			}
			if (!isDomainSectionRowBadge(row.badge)) {
				return rejectedModel('bad-row', 'THE IMPORT LAW', `validateNavigationModel: the row at sections[${i}][${j}] carries a badge that is not a member of the frozen badge list (derived from the REAL imported state vocabularies)`, [`sections[${i}][${j}]:${showValue(row.badge)}`]);
			}
			if (seenRowKeys.has(row.rowKey)) {
				return rejectedModel('duplicate-row-key', 'THE FAIL-CLOSED LAW', `validateNavigationModel: the rowKey '${row.rowKey}' repeats within the model (the derived rowKeys are unique)`, [row.rowKey]);
			}
			seenRowKeys.add(row.rowKey);
		}
	}
	return { ok: true, model: canonicalNavigationModel(candidate as unknown as DomainNavigationModel) };
}

/** Pure deep shape guard: a well-formed navigation model (the deep walk above, green). */
export function isNavigationModel(value: unknown): value is DomainNavigationModel {
	return validateNavigationModel(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * navigation model (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests). The model keys emit in the
 * DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS order, the sections in the
 * frozen section order, the section keys in the
 * DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS order, the rows in their
 * derived order, the row keys in the DOMAIN_SECTION_ROW_SCHEMA_KEYS
 * order. Throws TypeError on a malformed model (never dishonest
 * bytes). THE PROJECTION LAW: the bytes are a DERIVED value's
 * transport form - this family never persists them.
 */
export function serializeNavigationModel(model: unknown): string {
	if (!isNavigationModel(model)) {
		throw new TypeError(
			'serializeNavigationModel: model must satisfy isNavigationModel - no dishonest navigation model ever gets canonical bytes',
		);
	}
	return JSON.stringify(canonicalModelObject(model));
}

/**
 * Closed frozen list of parse rejection reasons (the parse walk is
 * first-failure-is-the-verdict, in this exact order):
 *   malformed-json           - the bytes are not valid JSON;
 *   torn-envelope            - the bytes parse but the model
 *                              envelope is structurally incomplete or
 *                              torn (a non-object, a missing key, a
 *                              value of the wrong structural type -
 *                              never a silent partial parse);
 *   unknown-contract-version - the bytes carry a contract version
 *                              other than
 *                              PROJECTIONS_CONTRACTS_VERSION;
 *   unknown-key              - an extra key at the model / section /
 *                              row level (tampered bytes);
 *   invalid-model            - the deep semantic walk refuses;
 *   non-canonical            - the bytes parse and validate but are
 *                              NOT the canonical serialization (a key
 *                              emitted out of the frozen order, the
 *                              sections out of the frozen order, or
 *                              drifting whitespace) - the parse
 *                              refuses non-canonical bytes, never a
 *                              silent normalization.
 */
export const PROJECTIONS_PARSE_REJECTION_REASONS = [
	'malformed-json',
	'torn-envelope',
	'unknown-contract-version',
	'unknown-key',
	'invalid-model',
	'non-canonical',
] as const;
export type ProjectionsParseRejectionReason = (typeof PROJECTIONS_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isProjectionsParseRejectionReason(value: unknown): value is ProjectionsParseRejectionReason {
	return (PROJECTIONS_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface ProjectionsParseRejection {
	readonly reason: ProjectionsParseRejectionReason;
	readonly detail: string;
}

/** The typed parse outcome: ok carries the validated model; failure names the drift. */
export type NavigationParseOutcome =
	| { readonly ok: true; readonly model: DomainNavigationModel }
	| { readonly ok: false; readonly rejection: ProjectionsParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown
 * key (model / section / row level), invalid content (the deep
 * model walk), or non-canonical bytes (the round-trip canonicality
 * law) - each a typed rejection naming the drift; never a silent
 * partial parse, never a silent normalization.
 * First-failure-is-the-verdict, in the frozen
 * PROJECTIONS_PARSE_REJECTION_REASONS order.
 */
export function parseNavigationModel(bytes: unknown): NavigationParseOutcome {
	if (typeof bytes !== 'string') {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseNavigationModel: bytes must be a string (the canonical fixed-key-order navigation-model bytes)',
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
				detail: `parseNavigationModel: the bytes are not valid JSON: ${toMessage(error)}`,
			},
		};
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseNavigationModel: the bytes must carry a JSON object (the navigation-model envelope)',
			},
		};
	}
	const model = parsed as Record<string, unknown>;
	for (const key of DOMAIN_NAVIGATION_MODEL_SCHEMA_KEYS) {
		if (!hasOwn(model, key)) {
			return {
				ok: false,
				rejection: {
					reason: 'torn-envelope',
					detail: `parseNavigationModel: the '${key}' key is missing (a torn write - never a silent partial parse)`,
				},
			};
		}
	}
	if (typeof model.harnessId !== 'string' || typeof model.contractVersion !== 'string' || !Array.isArray(model.sections)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseNavigationModel: the model envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
			},
		};
	}
	if (model.contractVersion !== PROJECTIONS_CONTRACTS_VERSION) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-contract-version',
				detail: `parseNavigationModel: the bytes carry contract version '${model.contractVersion}' - only '${PROJECTIONS_CONTRACTS_VERSION}' is known (the single-version law)`,
			},
		};
	}
	const sections = model.sections as unknown[];
	for (let i = 0; i < sections.length; i += 1) {
		const sectionCandidate = sections[i];
		if (isRecord(sectionCandidate)) {
			const extraSectionKeys = Object.keys(sectionCandidate).filter((key) => !(DOMAIN_NAVIGATION_SECTION_SCHEMA_KEYS as readonly string[]).includes(key));
			if (extraSectionKeys.length > 0) {
				return {
					ok: false,
					rejection: {
						reason: 'unknown-key',
						detail: `parseNavigationModel: the section at index ${i} carries the unknown key '${extraSectionKeys[0]}' (the three-key section schema is closed)`,
					},
				};
			}
			if (Array.isArray(sectionCandidate.rows)) {
				const rows = sectionCandidate.rows as unknown[];
				for (let j = 0; j < rows.length; j += 1) {
					const rowCandidate = rows[j];
					if (isRecord(rowCandidate)) {
						const extraRowKeys = Object.keys(rowCandidate).filter((key) => !(DOMAIN_SECTION_ROW_SCHEMA_KEYS as readonly string[]).includes(key));
						if (extraRowKeys.length > 0) {
							return {
								ok: false,
								rejection: {
									reason: 'unknown-key',
									detail: `parseNavigationModel: the row at sections[${i}][${j}] carries the unknown key '${extraRowKeys[0]}' (the four-key row schema is closed)`,
								},
							};
						}
					}
				}
			}
		}
	}
	const deep = validateNavigationModel(parsed);
	if (!deep.ok) {
		return {
			ok: false,
			rejection: {
				reason: 'invalid-model',
				detail: `parseNavigationModel: the parsed model fails the deep model walk (${deep.rejection.reason} - ${deep.rejection.detail}; never a silent partial parse)`,
			},
		};
	}
	// THE CANONICALITY LAW: the bytes must BE the canonical serialization
	// (the frozen key orders, the frozen section order, the compact JSON
	// form) - a parse that normalizes drifting bytes would be a silent rewrite.
	if (bytes !== serializeNavigationModel(deep.model)) {
		return {
			ok: false,
			rejection: {
				reason: 'non-canonical',
				detail: 'parseNavigationModel: the bytes are not the canonical serialization (the frozen key orders, the frozen section order, the compact JSON form) - non-canonical bytes are refused, never silently normalized',
			},
		};
	}
	return { ok: true, model: deep.model };
}

// --- internal helpers (never exported; the family's mirrored idioms) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own-property check (never the prototype chain). */
function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

/** Shows a list for a deterministic detail sentence. */
function showList(values: readonly string[]): string {
	return values.length === 0 ? '(none)' : values.join(', ');
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

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/** The index of a lifecycle state in the REAL frozen list (the projection's position arithmetic). */
function stateIndex(state: HarnessLifecycleState): number {
	return (HARNESS_LIFECYCLE_STATES as readonly string[]).indexOf(state);
}

/**
 * The stage/state badge (the REAL vocabularies' members are all badges
 * by derivation - the composing families' two-stage vocabulary, the
 * DH-02 onboarding stages, the DH-01 lifecycle states; typed through
 * the frozen badge list).
 */
function stageBadge(state: DomainSectionRowBadge): DomainSectionRowBadge {
	return state;
}

/** Builds one section from its derived rows (THE SECTION-STATE LAW). */
function sectionOf(section: DomainNavigationSectionId, rows: readonly DomainSectionRow[]): DomainNavigationSection {
	return {
		section,
		sectionState: rows.length > 0 ? 'composed' : 'not-composed',
		rows,
	};
}

/**
 * THE ABSENT-FAMILY LAW's slot walk: undefined (or the key absent) is
 * the honest absent family (undefined returned); a present value
 * must be an array whose every member satisfies the REAL family
 * validator (the valid records returned); anything else is the typed
 * malformed-record rejection naming the family (never a silent
 * skip).
 */
function familyRecords<R>(
	value: unknown,
	family: string,
	validator: (candidate: unknown) => boolean,
	rejections: ProjectionsRejection[],
): readonly R[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		rejections.push({
			reason: 'malformed-record',
			law: 'THE ABSENT-FAMILY LAW',
			items: [family],
			detail: `projectNavigation: the present '${family}' slot must be an array of the family's records (undefined is the honest absent marker; a present value is never silently skipped)`,
		});
		return undefined;
	}
	const records: R[] = [];
	let malformed = false;
	for (let i = 0; i < value.length; i += 1) {
		if (!validator(value[i])) {
			malformed = true;
		} else {
			records.push(value[i] as R);
		}
	}
	if (malformed) {
		rejections.push({
			reason: 'malformed-record',
			law: 'THE IMPORT LAW',
			items: [family],
			detail: `projectNavigation: a member of the present '${family}' slot fails the REAL family validator (imported by reference, never re-implemented) - a present record is never silently skipped`,
		});
		return undefined;
	}
	return records;
}

/** THE DUPLICATE-RECORD LAW's collector (each repeated id reported once, in first-seen order). */
function collectDuplicateIds(ids: readonly string[], family: string, rejections: ProjectionsRejection[]): void {
	const seen = new Set<string>();
	const reported = new Set<string>();
	const duplicates: string[] = [];
	for (const id of ids) {
		if (seen.has(id) && !reported.has(id)) {
			reported.add(id);
			duplicates.push(id);
		}
		seen.add(id);
	}
	if (duplicates.length > 0) {
		rejections.push({
			reason: 'duplicate-record',
			law: 'THE DUPLICATE-RECORD LAW',
			items: duplicates.map((id) => `${family}:${id}`),
			detail: `projectNavigation: the '${family}' slot carries the repeated record id(s) ${showList(duplicates)} (the derived rowKeys are unique per record id - a repeat is refused at the boundary, never rendered)`,
		});
	}
}

/** THE BINDING LAW's collector (a null binding is a pre-proposal session - never foreign). */
function collectForeignRecords(
	bindings: readonly { id: string; harnessId: string | null }[],
	family: string,
	anchorHarnessId: string,
	rejections: ProjectionsRejection[],
): void {
	const foreign: string[] = [];
	for (const binding of bindings) {
		if (binding.harnessId !== null && binding.harnessId !== anchorHarnessId) {
			foreign.push(`${family}:${binding.id}->${binding.harnessId}`);
		}
	}
	if (foreign.length > 0) {
		rejections.push({
			reason: 'foreign-record',
			law: 'THE BINDING LAW',
			items: foreign,
			detail: `projectNavigation: the '${family}' slot carries record(s) bound to another harness - every harnessId-bearing record must bind to the anchor '${anchorHarnessId}' (a record from another harness never projects into this harness's navigation)`,
		});
	}
}

/** Builds the typed model rejection (the shorthand every station uses). */
function rejectedModel(reason: ProjectionsModelRejectionReason, law: string, detail: string, items: readonly string[]): NavigationModelValidationOutcome {
	return { ok: false, rejection: { reason, law, items, detail } };
}

/** Builds the canonical fixed-key-order copy of a validated model (the serializer's engine). */
function canonicalNavigationModel(model: DomainNavigationModel): DomainNavigationModel {
	return canonicalModelObject(model) as unknown as DomainNavigationModel;
}

/** Builds the canonical fixed-key-order object of a validated model. */
function canonicalModelObject(model: DomainNavigationModel): Record<string, unknown> {
	return {
		harnessId: model.harnessId,
		contractVersion: model.contractVersion,
		sections: model.sections.map((section) => ({
			section: section.section,
			sectionState: section.sectionState,
			rows: section.rows.map((row) => ({
				rowKey: row.rowKey,
				label: row.label,
				detail: row.detail,
				badge: row.badge,
			})),
		})),
	};
}
