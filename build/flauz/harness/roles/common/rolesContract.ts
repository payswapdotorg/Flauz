/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-003 roles contract family: the typed role-composition vocabulary for
 * the Domain Harness OS direction (WORK-REGISTRY.md § TL-B, item 3/13) -
 * the multi-role user composition instrument. THE ROLE-COMPOSITION
 * INSTRUMENT: the frozen per-industry role-template catalogs (exactly one
 * per frozen DH-01 industry; roleKey + summary ONLY - the DH-01 role
 * shape), the frozen per-work-type role-key affinity map (exactly one per
 * frozen DH-01 work type; every key resolving in at least one catalog),
 * the deterministic composition selection (the union of the requested
 * work-type affinities, intersected with the industry's catalog, ordered
 * by the catalog's own order, deduplicated, each entry carrying its
 * provenance - the contributing work types), the explicit-selection
 * validation (every roleKey must be a member of the industry's catalog),
 * and the canonical fixed-key-order serialization of the composition
 * record with the fail-closed parse (contract module, the labContracts
 * discipline; the DH-001 contract family is the landed precedent and the
 * DH-002 onboarding family is the closest sibling - their laws are
 * INHERITED and binding here).
 *
 * A role template is CONFIGURATION (a roleKey + a human summary); it
 * grants NOTHING by itself. Role/ontology TERMINOLOGY (the industry
 * ontology layer) is DH-004's item; capability POPULATION is DH-007's;
 * this family is the role vocabulary + the composition + the selection
 * validation - a PURE, STATELESS instrument. NO session machine, NO
 * persistence layer (the DH-002 onboarding session owns persistence),
 * and the composition output composes directly into the DH-002 review
 * stage's composeDraft roles input (battery-pinned through a REAL
 * onboarding kit mint; the review composition itself is supplied by the
 * caller - the DH-002 work order's scope boundary deferred role
 * invention to THIS item, and this family is that item).
 *
 * LAWS (the DH-003 work order; the landed DH-001/DH-002 family
 * precedents):
 * - THE NO-FORK LAW (binding, inherited): a role template is roleKey +
 *   summary ONLY - any additional key is the typed no-fork rejection
 *   (the DH-01 station (c)); the catalogs carry ZERO execution material
 *   (the forbidden-key family is rejected with the typed no-fork
 *   rejection BEFORE the unknown-key rejection would fire - the DH-01
 *   precedence law); a named role is configuration and grants NOTHING.
 * - THE FROZEN-CATALOG LAW (binding, this family's charter): the 16
 *   per-industry catalogs and the 10 per-work-type affinities are FROZEN
 *   at this family (bound by DH-004+); membership is the only
 *   admissibility - a suggested or selected role is ALWAYS a member of
 *   the industry's catalog; an affinity key that resolves in NO catalog
 *   is the typed unknown-affinity-role rejection (the integrity walk).
 * - THE REAL-VOCABULARY LAW (binding): the industries and the work
 *   types are imported from the DH-01 contract BY REFERENCE (the same
 *   bindings, re-exported, never re-declared); the role shape is the
 *   DH-01 role shape ({ roleKey, summary } - HarnessRole).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock is INJECTED at the kit boundary (the composition record's
 *   timestamp is carried verbatim from the injected seam); the
 *   serialization is canonical fixed-key-order bytes (the DH-01
 *   algorithm: the frozen per-shape key orders applied deeply, never an
 *   alphabetic re-sort); same inputs produce byte-identical outputs.
 * - THE FAIL-CLOSED LAW (binding): every domain refusal is a typed
 *   record { reason, law, message, items? } naming the violated law and
 *   the offending items - never a string throw, never a silent skip,
 *   never a partial verdict. The walks are first-failure-is-the-verdict
 *   in the frozen ROLES_VALIDATION_REJECTION_REASONS walk order; the
 *   parse walk is first-failure-is-the-verdict over the frozen
 *   ROLES_PARSE_REJECTION_REASONS list.
 * - THE SINGLE-VERSION LAW (binding): ROLES_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE in this contract module, re-carried by the
 *   kit; the battery pins both copies equal.
 * - THE COMPOSITION LAW (this family's own): the suggestion is the
 *   union of the requested work-type affinities INTERSECTED with the
 *   industry's catalog (affinity keys absent from the industry's
 *   catalog belong to other industries' vocabularies - the intersection
 *   is the composition rule, never a silent skip; the integrity walk
 *   guarantees every affinity key resolves in at least ONE catalog),
 *   ordered by the industry catalog's own order, deduplicated, each
 *   entry carrying its provenance (the contributing work types, in the
 *   frozen work-type order); an empty intersection is the typed
 *   empty-composition rejection (the honest refusal - never a silent
 *   empty success).
 * - THE ROLE-KEY LAW (this family's own): a roleKey is a non-empty
 *   lowercase hyphen-free single-word kebab identifier (the regular
 *   expression ^[a-z]+$: lowercase ASCII letters only); a summary is a
 *   non-empty human string of at most 200 characters.
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import {
        FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
        HARNESS_INDUSTRIES,
        HARNESS_WORK_TYPES,
        isHarnessIndustry,
        isHarnessWorkType,
} from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessRole, HarnessWorkType } from '../../contract/common/domainHarnessContract.js';

/**
 * THE REAL-VOCABULARY LAW / THE NO-FORK-OF-THE-CORE discipline: the
 * frozen DH-01 vocabularies are re-exported BY REFERENCE (the same
 * bindings, never re-declared copies). The battery pins referential
 * identity against the DH-01 contract module.
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
export const ROLES_CONTRACTS_VERSION = '1.0.0';

/**
 * THE ROLE-KEY LAW's bound: a role summary is a non-empty human string
 * of at most this many characters (the DH-01 descriptor's own 80-char
 * displayName bound is a different field's law - a role summary is
 * prose, not a name).
 */
export const ROLE_SUMMARY_MAX_CHARS = 200;

/**
 * Pure predicate: a well-formed roleKey (THE ROLE-KEY LAW) - a non-empty
 * lowercase hyphen-free single-word kebab identifier (lowercase ASCII
 * letters only; no hyphens, no digits, no dots, no separators).
 */
export function isRoleKey(value: unknown): value is string {
        return typeof value === 'string' && /^[a-z]+$/.test(value);
}

/**
 * THE FROZEN-CATALOG LAW: the per-industry role-template catalogs -
 * exactly one entry for EACH of the 16 frozen HARNESS_INDUSTRIES (the
 * DH-01 vocabulary, imported by reference), each a non-empty ordered
 * frozen array of role templates { roleKey, summary } (the DH-01 role
 * shape; roleKey unique within the catalog, the ROLE-KEY LAW shape, the
 * summary bound by ROLE_SUMMARY_MAX_CHARS). 4-8 domain-honest templates
 * per industry (the design law, pinned byte-exact by the battery); a
 * role template MAY appear in multiple industries' catalogs (the shared
 * vocabulary - e.g. 'reviewer' sits in the software, legal, finance,
 * marketing, science, media and government catalogs); the summaries are
 * per-catalog (the same shared key means domain-specific work in each
 * industry). The catalogs are FROZEN at this family and bound by
 * DH-004+; a role template is CONFIGURATION - it grants NOTHING by
 * itself (THE NO-FORK LAW).
 */
export const INDUSTRY_ROLE_CATALOGS: Readonly<Record<HarnessIndustry, readonly HarnessRole[]>> = {
        software: [
                { roleKey: 'architect', summary: 'shapes the software system, its structure and its boundary contracts (the design authority)' },
                { roleKey: 'implementer', summary: 'builds the software against the agreed contracts and lands the changes' },
                { roleKey: 'reviewer', summary: 'examines the changes for defects, risks and design drift before they land' },
                { roleKey: 'tester', summary: 'designs and runs the verification battery that pins the behavior' },
                { roleKey: 'analyst', summary: 'studies the requirements and the telemetry to define what the work must satisfy' },
                { roleKey: 'writer', summary: 'maintains the technical documentation the harness composes (guides, references, runbooks)' },
                { roleKey: 'coordinator', summary: 'tracks the work items, the schedule and the handoffs between the roles' },
                { roleKey: 'auditor', summary: 'examines the work and its artifacts for policy and compliance drift' },
        ],
        legal: [
                { roleKey: 'counsel', summary: 'owns the legal judgment: advises the party, frames the position and signs the opinions' },
                { roleKey: 'paralegal', summary: 'prepares the filings, the research bundles and the matter administration' },
                { roleKey: 'drafter', summary: 'writes the contracts, the pleadings and the instruments the matter needs' },
                { roleKey: 'reviewer', summary: 'examines the drafts for legal risk and for drift from the agreed position' },
                { roleKey: 'researcher', summary: 'performs the case research and the precedent analysis the position rests on' },
                { roleKey: 'writer', summary: 'maintains the memoranda and the client-facing explanations of the work' },
                { roleKey: 'negotiator', summary: 'represents the party in negotiating terms and settling disputes' },
                { roleKey: 'analyst', summary: 'processes the matter data and the discovery material into the position files' },
        ],
        finance: [
                { roleKey: 'advisor', summary: 'advises the client on the financial position and the course to take' },
                { roleKey: 'analyst', summary: 'models the markets, the positions and the performance the decisions rest on' },
                { roleKey: 'accountant', summary: 'keeps the books, prepares the statements and processes the account data' },
                { roleKey: 'auditor', summary: 'examines the books and the controls for accuracy and compliance' },
                { roleKey: 'reviewer', summary: 'examines the analyses and the filings for risk before they are released' },
                { roleKey: 'planner', summary: 'builds the financial plans, the budgets and the forecast scenarios' },
                { roleKey: 'writer', summary: 'writes the reports and the client-facing performance narratives' },
                { roleKey: 'administrator', summary: 'runs the operations calendar, the filings register and the records' },
        ],
        healthcare: [
                { roleKey: 'clinician', summary: 'diagnoses and treats the patient (the clinical authority of the harness)' },
                { roleKey: 'nurse', summary: 'delivers the care, monitors the patient and administers the treatment plan' },
                { roleKey: 'pharmacist', summary: 'dispenses the medication, checks the interactions and advises on dosage' },
                { roleKey: 'technician', summary: 'runs the laboratory equipment and processes the specimens and the data' },
                { roleKey: 'administrator', summary: 'runs the scheduling, the records and the facility operations' },
                { roleKey: 'writer', summary: 'maintains the clinical documentation and the patient-facing materials' },
                { roleKey: 'researcher', summary: 'runs the clinical research and the evidence analysis the care rests on' },
                { roleKey: 'auditor', summary: 'examines the clinical records and the processes for standards compliance' },
        ],
        education: [
                { roleKey: 'instructor', summary: 'teaches the learners and runs the sessions (the delivery authority)' },
                { roleKey: 'designer', summary: 'designs the curriculum, the courses and the learning materials' },
                { roleKey: 'assessor', summary: 'assesses the learners work and grades the outcomes against the rubrics' },
                { roleKey: 'administrator', summary: 'runs the enrollment, the scheduling and the institution records' },
                { roleKey: 'researcher', summary: 'studies the pedagogy and the outcomes evidence the teaching rests on' },
                { roleKey: 'writer', summary: 'writes the learning materials, the guides and the course documentation' },
                { roleKey: 'analyst', summary: 'analyzes the performance data and the cohort outcomes' },
                { roleKey: 'inspector', summary: 'inspects the teaching and the governance for standards compliance' },
        ],
        marketing: [
                { roleKey: 'strategist', summary: 'sets the positioning, the audience and the campaign strategy' },
                { roleKey: 'copywriter', summary: 'writes the copy: the messages, the landing pages and the campaign texts' },
                { roleKey: 'designer', summary: 'designs the creative: the visuals, the layouts and the brand artifacts' },
                { roleKey: 'analyst', summary: 'measures the campaigns, the funnels and the audience data' },
                { roleKey: 'researcher', summary: 'researches the market, the competitors and the audience' },
                { roleKey: 'producer', summary: 'produces the campaigns and the content calendar end to end' },
                { roleKey: 'coordinator', summary: 'coordinates the launches, the channels and the handoffs' },
                { roleKey: 'reviewer', summary: 'reviews the creative and the claims for brand and policy compliance' },
        ],
        science: [
                { roleKey: 'researcher', summary: 'designs and runs the studies and the experiments (the inquiry authority)' },
                { roleKey: 'analyst', summary: 'analyzes the datasets and the results the conclusions rest on' },
                { roleKey: 'technician', summary: 'operates the instruments and prepares the samples and the runs' },
                { roleKey: 'writer', summary: 'writes the papers, the protocols and the research documentation' },
                { roleKey: 'reviewer', summary: 'peer-reviews the methods and the findings for rigor' },
                { roleKey: 'editor', summary: 'edits the publications and manages the submission pipeline' },
                { roleKey: 'administrator', summary: 'runs the grants, the lab operations and the compliance records' },
                { roleKey: 'curator', summary: 'curates the collections, the specimens and the research data' },
        ],
        media: [
                { roleKey: 'writer', summary: 'writes the stories, the scripts and the editorial content' },
                { roleKey: 'editor', summary: 'edits the content, commissions the pieces and guards the voice' },
                { roleKey: 'producer', summary: 'plans and produces the pieces end to end (the production authority)' },
                { roleKey: 'reviewer', summary: 'reviews the content for accuracy, standards and legal risk' },
                { roleKey: 'designer', summary: 'designs the layouts, the graphics and the visual identity' },
                { roleKey: 'researcher', summary: 'researches the facts, the sources and the background for the pieces' },
                { roleKey: 'coordinator', summary: 'coordinates the calendar, the contributors and the publishing pipeline' },
                { roleKey: 'analyst', summary: 'analyzes the audience data and the performance of the pieces' },
        ],
        construction: [
                { roleKey: 'architect', summary: 'designs the building and owns the design intent through construction' },
                { roleKey: 'engineer', summary: 'engineers the structure and the systems against the codes and the loads' },
                { roleKey: 'surveyor', summary: 'surveys the site, the quantities and the works (the measurement authority)' },
                { roleKey: 'inspector', summary: 'inspects the works for code, safety and specification compliance' },
                { roleKey: 'supervisor', summary: 'supervises the trades, the site and the daily works' },
                { roleKey: 'planner', summary: 'plans the phases, the schedule and the resource loading' },
                { roleKey: 'drafter', summary: 'drafts the drawings, the details and the build documentation' },
                { roleKey: 'coordinator', summary: 'coordinates the contractors, the permits and the handoffs' },
        ],
        logistics: [
                { roleKey: 'dispatcher', summary: 'dispatches the shipments and manages the routes and the fleet' },
                { roleKey: 'coordinator', summary: 'coordinates the orders, the carriers and the warehouse handoffs' },
                { roleKey: 'planner', summary: 'plans the network, the capacity and the inventory placement' },
                { roleKey: 'inspector', summary: 'inspects the goods, the handling and the chain of custody' },
                { roleKey: 'analyst', summary: 'analyzes the flows, the costs and the service levels' },
                { roleKey: 'administrator', summary: 'runs the documentation, the customs records and the billing' },
                { roleKey: 'auditor', summary: 'audits the processes, the inventory and the compliance records' },
        ],
        retail: [
                { roleKey: 'buyer', summary: 'selects and buys the assortment and negotiates the terms with the suppliers' },
                { roleKey: 'merchandiser', summary: 'merchandises the assortment, the pricing and the floor placement' },
                { roleKey: 'associate', summary: 'serves the customers, runs the floor and the registers' },
                { roleKey: 'planner', summary: 'plans the assortment, the seasons and the stock levels' },
                { roleKey: 'analyst', summary: 'analyzes the sales, the margins and the customer data' },
                { roleKey: 'administrator', summary: 'runs the store operations, the schedules and the records' },
                { roleKey: 'coordinator', summary: 'coordinates the promotions, the events and the channels' },
                { roleKey: 'auditor', summary: 'audits the stock, the takings and the compliance records' },
        ],
        manufacturing: [
                { roleKey: 'engineer', summary: 'engineers the process, the tooling and the line layout' },
                { roleKey: 'technician', summary: 'operates and maintains the machines and the line equipment' },
                { roleKey: 'supervisor', summary: 'supervises the shifts, the line and the safety of the works' },
                { roleKey: 'planner', summary: 'plans the production schedule, the materials and the capacity' },
                { roleKey: 'inspector', summary: 'inspects the parts and the output against the specifications' },
                { roleKey: 'analyst', summary: 'analyzes the yield, the defects and the line data' },
                { roleKey: 'drafter', summary: 'drafts the technical drawings and the work instructions' },
                { roleKey: 'administrator', summary: 'runs the plant records, the compliance files and the reporting' },
        ],
        energy: [
                { roleKey: 'engineer', summary: 'engineers the generation, the grid and the plant systems' },
                { roleKey: 'technician', summary: 'operates and maintains the turbines, the lines and the plant equipment' },
                { roleKey: 'analyst', summary: 'analyzes the load, the market and the plant performance data' },
                { roleKey: 'planner', summary: 'plans the generation, the maintenance windows and the fuel supply' },
                { roleKey: 'inspector', summary: 'inspects the plant, the lines and the safety systems for compliance' },
                { roleKey: 'surveyor', summary: 'surveys the sites, the resources and the works' },
                { roleKey: 'coordinator', summary: 'coordinates the crews, the outages and the contractors' },
                { roleKey: 'administrator', summary: 'runs the regulatory records, the reporting and the filings' },
        ],
        agriculture: [
                { roleKey: 'agronomist', summary: 'advises on the crops, the soil and the field plan (the field authority)' },
                { roleKey: 'technician', summary: 'operates the machinery and runs the irrigation and the sensors' },
                { roleKey: 'planner', summary: 'plans the planting, the rotation and the harvest schedule' },
                { roleKey: 'inspector', summary: 'inspects the produce, the inputs and the practices for standards' },
                { roleKey: 'buyer', summary: 'buys the inputs and sells the produce on the market terms' },
                { roleKey: 'analyst', summary: 'analyzes the yields, the costs and the market data' },
                { roleKey: 'administrator', summary: 'runs the farm records, the subsidies and the compliance files' },
        ],
        government: [
                { roleKey: 'administrator', summary: 'runs the programs, the records and the public operations' },
                { roleKey: 'analyst', summary: 'analyzes the policy data, the programs and the outcomes' },
                { roleKey: 'drafter', summary: 'drafts the legislation, the regulations and the policy instruments' },
                { roleKey: 'reviewer', summary: 'reviews the instruments and the decisions for legal and policy risk' },
                { roleKey: 'auditor', summary: 'audits the programs, the spending and the compliance' },
                { roleKey: 'counsel', summary: 'advises on the legal position of the administration and its acts' },
                { roleKey: 'coordinator', summary: 'coordinates the stakeholders, the consultations and the communications' },
                { roleKey: 'inspector', summary: 'inspects the licensed premises and the regulated activities' },
        ],
        hospitality: [
                { roleKey: 'concierge', summary: 'welcomes the guests and arranges the services and the experiences' },
                { roleKey: 'chef', summary: 'runs the kitchen, the menu and the food quality (the culinary authority)' },
                { roleKey: 'coordinator', summary: 'coordinates the events, the bookings and the service handoffs' },
                { roleKey: 'planner', summary: 'plans the events, the occupancy and the service capacity' },
                { roleKey: 'associate', summary: 'serves the guests, the rooms and the front of house' },
                { roleKey: 'administrator', summary: 'runs the bookings, the records and the property operations' },
                { roleKey: 'analyst', summary: 'analyzes the occupancy, the revenue and the guest data' },
                { roleKey: 'auditor', summary: 'audits the housekeeping, the takings and the standards compliance' },
        ],
};

/**
 * THE FROZEN-CATALOG LAW: the per-work-type role-key affinity map -
 * exactly one entry for EACH of the 10 frozen HARNESS_WORK_TYPES (the
 * DH-01 vocabulary, imported by reference), each a non-empty ordered
 * array of role keys ordered by affinity strength, every key resolving
 * in at least one industry catalog (the integrity walk's
 * unknown-affinity-role rejection is the guarantee). The affinity map is
 * the CROSS-INDUSTRY suggestion vocabulary: a work type's affinity keys
 * name which role kinds that work typically needs, ANYWHERE; the
 * industry catalog is the admissibility filter (THE COMPOSITION LAW -
 * the suggestion is the intersection).
 */
export const WORK_TYPE_ROLE_AFFINITIES: Readonly<Record<HarnessWorkType, readonly string[]>> = {
        analysis: ['analyst', 'researcher', 'auditor'],
        drafting: ['drafter', 'writer', 'implementer', 'designer', 'copywriter'],
        review: ['reviewer', 'editor', 'auditor', 'inspector', 'assessor'],
        planning: ['planner', 'architect', 'strategist', 'supervisor', 'counsel', 'administrator', 'producer'],
        research: ['researcher', 'analyst', 'technician', 'surveyor'],
        reporting: ['writer', 'analyst', 'editor', 'accountant'],
        'data-processing': ['implementer', 'analyst', 'technician', 'accountant'],
        compliance: ['auditor', 'counsel', 'inspector', 'reviewer', 'accountant'],
        communication: ['writer', 'coordinator', 'producer', 'associate', 'instructor', 'copywriter', 'editor'],
        administration: ['administrator', 'paralegal', 'coordinator', 'associate'],
};

/**
 * The frozen composition-record schema: the exact six keys of a
 * RoleCompositionRecord, in the canonical fixed-key-order (the
 * serialization order). The strict-schema parse rejects every key
 * outside this list.
 */
export const ROLE_COMPOSITION_SCHEMA_KEYS = [
        'contractVersion',
        'industry',
        'workTypes',
        'composedAtIso',
        'roles',
        'provenance',
] as const;

/** The frozen provenance-entry schema keys, in the canonical fixed-key-order. */
export const ROLE_PROVENANCE_SCHEMA_KEYS = [
        'roleKey',
        'contributedBy',
] as const;

/**
 * Closed frozen list of roles validation rejection reasons, in the exact
 * walk order (each walk is first-failure-is-the-verdict at each station,
 * the stations visited in this order):
 *   malformed-record        - the candidate is not a plain object, or a
 *                             PRESENT field / carrier carries the wrong
 *                             structural type (a non-array workTypes /
 *                             roleKeys / roles / provenance carrier, a
 *                             non-object role or provenance entry, a
 *                             malformed composedAtIso, a torn provenance
 *                             parallel structure, an empty catalog or
 *                             affinity carrier);
 *   no-fork                 - THE NO-FORK LAW: a forbidden
 *                             execution-material key on the record, or an
 *                             extra key on a role template (the DH-01
 *                             station (c), fired BEFORE the unknown-key
 *                             rejection);
 *   unknown-key             - THE NO-FORK LAW's strict-schema engine: a
 *                             key outside the frozen schema (record or
 *                             provenance level);
 *   missing-key             - a required key is absent (record, request,
 *                             provenance or template level);
 *   unknown-industry        - THE FROZEN-VOCABULARY LAW: the industry is
 *                             not a member of the frozen DH-01 list;
 *   empty-work-types        - the request's workTypes is empty;
 *   unknown-work-type       - a workTypes member (or a provenance
 *                             contributedBy member) is not in the frozen
 *                             DH-01 list;
 *   duplicate-work-types    - workTypes (or a provenance contributedBy)
 *                             carries repeats;
 *   work-types-out-of-order - workTypes (or a provenance contributedBy)
 *                             violates the frozen DH-01 list order;
 *   role-not-in-catalog     - THE FROZEN-CATALOG LAW: a selected
 *                             roleKey (or a record's role entry) is not
 *                             a member of the industry's catalog;
 *   duplicate-role-keys     - roleKeys are not unique (a selection, a
 *                             catalog, a record's roles or an affinity);
 *   unknown-affinity-role   - THE FROZEN-CATALOG LAW's integrity
 *                             guarantee: an affinity key that resolves
 *                             in NO industry catalog (a malformed
 *                             catalogs argument resolves nothing -
 *                             fail-closed);
 *   empty-composition       - THE COMPOSITION LAW's honest refusal: the
 *                             composed/selected role set is empty (an
 *                             empty roleKeys selection, or a suggestion
 *                             whose affinity intersection with the
 *                             industry's catalog is empty);
 *   invalid-role-key        - THE ROLE-KEY LAW: a roleKey is not the
 *                             ^[a-z]+$ single-word lowercase form;
 *   invalid-summary         - THE ROLE-KEY LAW's summary bound: a
 *                             summary is empty or longer than
 *                             ROLE_SUMMARY_MAX_CHARS;
 *   version-mismatch        - THE SINGLE-VERSION LAW: the record's
 *                             contractVersion is not
 *                             ROLES_CONTRACTS_VERSION (the LAST station
 *                             of the record walk).
 * Widening or reordering the list is a versioned contract decision.
 */
export const ROLES_VALIDATION_REJECTION_REASONS = [
        'malformed-record',
        'no-fork',
        'unknown-key',
        'missing-key',
        'unknown-industry',
        'empty-work-types',
        'unknown-work-type',
        'duplicate-work-types',
        'work-types-out-of-order',
        'role-not-in-catalog',
        'duplicate-role-keys',
        'unknown-affinity-role',
        'empty-composition',
        'invalid-role-key',
        'invalid-summary',
        'version-mismatch',
] as const;
export type RolesValidationRejectionReason = (typeof ROLES_VALIDATION_REJECTION_REASONS)[number];

/** Pure predicate over the closed validation-rejection list. */
export function isRolesValidationRejectionReason(value: unknown): value is RolesValidationRejectionReason {
        return (ROLES_VALIDATION_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed domain refusal: the frozen reason, the violated law's name,
 * the deterministic message sentence, and the offending items. NEVER a
 * string throw, NEVER a silent skip, never a partial verdict. The kit
 * layer widens the reason vocabulary with its own frozen extras
 * (disposed, corrupt-seam) over the same record shape.
 */
export interface RolesRefusal {
        readonly reason: RolesValidationRejectionReason;
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
export type RolesPayloadOutcome<P> =
        | { readonly ok: true; readonly value: P }
        | { readonly ok: false; readonly refusal: RolesRefusal };

/**
 * The composition request: one frozen DH-01 industry + a non-empty,
 * duplicate-free ordered subset of the frozen DH-01 work-type list (the
 * frozen list order preserved) - both validated against the frozen
 * vocabularies imported by reference (THE REAL-VOCABULARY LAW).
 */
export interface RoleCompositionRequest {
        readonly industry: HarnessIndustry;
        readonly workTypes: readonly HarnessWorkType[];
}

/**
 * The explicit selection request: one frozen DH-01 industry + a
 * non-empty, duplicate-free array of role keys, every key a member of
 * the industry's catalog (THE FROZEN-CATALOG LAW - membership is the
 * only admissibility).
 */
export interface RoleSelectionRequest {
        readonly industry: HarnessIndustry;
        readonly roleKeys: readonly string[];
}

/**
 * One provenance entry: which work-type affinities contributed the role
 * to the composition (the contributing work types, in the frozen DH-01
 * list order; parallel to the composition's roles array - same length,
 * same order, same keys).
 */
export interface RoleProvenance {
        readonly roleKey: string;
        readonly contributedBy: readonly HarnessWorkType[];
}

/**
 * The composed role set: the ordered deduplicated role list (the DH-01
 * role shape, in the industry catalog's own order) plus its parallel
 * provenance array (which affinity / work type contributed each role).
 * The roles array is DIRECTLY admissible as the DH-002 review stage's
 * composeDraft roles input (THE INTEGRATION LAW - battery-pinned
 * through a REAL onboarding kit mint).
 */
export interface RoleComposition {
        readonly roles: readonly HarnessRole[];
        readonly provenance: readonly RoleProvenance[];
}

/**
 * The persisted-shaped composition record (the honest record of one
 * deterministic suggestion): the re-carried contract version, the
 * industry, the request echo (the validated ordered work-type subset),
 * the injected-clock timestamp (carried verbatim from the seam - the
 * module never reads a clock itself), and the composed role set with
 * its parallel provenance.
 */
export interface RoleCompositionRecord {
        readonly contractVersion: string;
        readonly industry: HarnessIndustry;
        readonly workTypes: readonly HarnessWorkType[];
        readonly composedAtIso: string;
        readonly roles: readonly HarnessRole[];
        readonly provenance: readonly RoleProvenance[];
}

/**
 * The resolved explicit selection: the industry + the resolved
 * templates in the industry catalog's own order (never the request's
 * order - the catalog is the vocabulary).
 */
export interface RoleSelection {
        readonly industry: HarnessIndustry;
        readonly roles: readonly HarnessRole[];
}

/**
 * Closed frozen list of parse rejection reasons (the parse walk is
 * first-failure-is-the-verdict, in this exact order):
 *   malformed-json           - the bytes are not valid JSON;
 *   torn-envelope            - the bytes parse but the record envelope
 *                              is structurally incomplete or torn (a
 *                              non-string input, a non-object, a missing
 *                              key, a value of the wrong structural
 *                              type - never a silent partial parse);
 *   unknown-contract-version - the record carries a contract version
 *                              other than ROLES_CONTRACTS_VERSION;
 *   unknown-key              - an extra key at the record, role or
 *                              provenance level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses (the
 *                              frozen refusal taxonomy of
 *                              validateRoleCompositionRecord).
 */
export const ROLES_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type RolesParseRejectionReason = (typeof ROLES_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isRolesParseRejectionReason(value: unknown): value is RolesParseRejectionReason {
        return (ROLES_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming message. */
export interface RolesParseRejection {
        readonly reason: RolesParseRejectionReason;
        readonly message: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type RolesParseOutcome =
        | { readonly ok: true; readonly record: RoleCompositionRecord }
        | { readonly ok: false; readonly rejection: RolesParseRejection };

// --- the template walk (the DH-01 role shape, this family's own bounds) ---

/**
 * The role-template walk (pure): malformed-record (not a plain object),
 * no-fork (ANY extra key beyond roleKey+summary - the DH-01 station
 * (c); a named role is configuration and grants NOTHING), missing-key
 * (roleKey or summary absent), invalid-role-key (THE ROLE-KEY LAW
 * shape), invalid-summary (the ROLE_SUMMARY_MAX_CHARS bound). Ok
 * carries the canonical { roleKey, summary } copy.
 */
export function validateRoleTemplate(template: unknown): RolesPayloadOutcome<HarnessRole> {
        if (!isRecord(template)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleTemplate: a role template must be a plain object (never a silent partial verdict)', ['template']);
        }
        const record = template as Record<string, unknown>;
        const extraKeys = Object.keys(record).filter((key) => key !== 'roleKey' && key !== 'summary');
        if (extraKeys.length > 0) {
                return refused(
                        'no-fork',
                        'THE NO-FORK LAW',
                        `validateRoleTemplate: a named role is CONFIGURATION (a roleKey + a human summary) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} cannot appear on a role template (a harness is composable configuration over the universal Flauz core, never an industry-specific fork)`,
                        extraKeys,
                );
        }
        const missingKeys = ['roleKey', 'summary'].filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateRoleTemplate: a role template requires both keys - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isRoleKey(record.roleKey)) {
                return refused('invalid-role-key', 'THE ROLE-KEY LAW', `validateRoleTemplate: the roleKey must be a non-empty lowercase hyphen-free single-word kebab identifier (the ^[a-z]+$ form) - '${showValue(record.roleKey)}' is refused`, [showValue(record.roleKey)]);
        }
        if (typeof record.summary !== 'string' || record.summary.length === 0 || record.summary.length > ROLE_SUMMARY_MAX_CHARS) {
                const shown = typeof record.summary !== 'string' ? showValue(record.summary) : record.summary.length === 0 ? '<empty string>' : `${record.summary.length} chars`;
                return refused('invalid-summary', 'THE ROLE-KEY LAW', `validateRoleTemplate: the summary must be a non-empty human string of at most ${ROLE_SUMMARY_MAX_CHARS} characters - '${shown}' is refused`, [shown]);
        }
        return { ok: true, value: { roleKey: record.roleKey, summary: record.summary } };
}

// --- the catalog integrity walks (THE FROZEN-CATALOG LAW) ---

/**
 * The per-industry catalog walk (pure): malformed-record (the catalog
 * is not a non-empty array; an entry is not a plain object),
 * unknown-industry (the industry is not a frozen DH-01 member), then
 * the per-entry template walk (no-fork / missing-key / invalid-role-key
 * / invalid-summary, each entry's items carrying its catalog position),
 * then duplicate-role-keys (roleKey unique within the catalog). Ok
 * carries the canonical template list (fresh { roleKey, summary }
 * copies). The battery runs this walk over all 16 frozen catalogs.
 */
export function validateIndustryRoleCatalog(industry: unknown, catalog: unknown): RolesPayloadOutcome<readonly HarnessRole[]> {
        if (!Array.isArray(catalog)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateIndustryRoleCatalog: the catalog must be a non-empty array of role templates (the frozen per-industry vocabulary)', ['catalog']);
        }
        if ((catalog as unknown[]).length === 0) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateIndustryRoleCatalog: the catalog must be a non-empty array of role templates (the frozen per-industry vocabulary)', ['catalog']);
        }
        if (!isHarnessIndustry(industry)) {
                return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateIndustryRoleCatalog: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility)', [showValue(industry)]);
        }
        const templates: HarnessRole[] = [];
        for (let i = 0; i < (catalog as unknown[]).length; i += 1) {
                const verdict = validateRoleTemplate((catalog as unknown[])[i]);
                if (!verdict.ok) {
                        return {
                                ok: false,
                                refusal: {
                                        reason: verdict.refusal.reason,
                                        law: verdict.refusal.law,
                                        message: `validateIndustryRoleCatalog: the catalog entry catalog[${i}] is refused - ${verdict.refusal.message}`,
                                        items: verdict.refusal.items === undefined ? undefined : verdict.refusal.items.map((item) => `catalog[${i}].${item}`),
                                },
                        };
                }
                templates.push(verdict.value);
        }
        const duplicates = findDuplicates(templates.map((template) => template.roleKey));
        if (duplicates.length > 0) {
                return refused('duplicate-role-keys', 'THE FAIL-CLOSED LAW', `validateIndustryRoleCatalog: roleKeys must be unique within the catalog (a named role appears once) - the offender(s) ${showList(duplicates)}`, duplicates);
        }
        return { ok: true, value: templates };
}

/**
 * The per-work-type affinity walk (pure): malformed-record (the
 * affinity is not a non-empty array), unknown-work-type (the work type
 * is not a frozen DH-01 member), duplicate-role-keys (the affinity
 * carries repeats), then unknown-affinity-role (every key must resolve
 * in at least one of the given catalogs' role keys; a non-string member
 * fails resolution; a malformed catalogs argument resolves NOTHING -
 * fail-closed, the DH-01 malformed-catalog discipline). Ok carries the
 * fresh key list. The battery runs this walk over all 10 frozen
 * affinities against the frozen catalogs.
 */
export function validateWorkTypeRoleAffinity(workType: unknown, affinity: unknown, catalogs: unknown): RolesPayloadOutcome<readonly string[]> {
        if (!Array.isArray(affinity)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateWorkTypeRoleAffinity: the affinity must be a non-empty array of role keys (the cross-industry suggestion vocabulary)', ['affinity']);
        }
        const keys = affinity as unknown[];
        if (keys.length === 0) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateWorkTypeRoleAffinity: the affinity must be a non-empty array of role keys (the cross-industry suggestion vocabulary)', ['affinity']);
        }
        if (!isHarnessWorkType(workType)) {
                return refused('unknown-work-type', 'THE FROZEN-VOCABULARY LAW', 'validateWorkTypeRoleAffinity: the work type must be a member of the frozen HARNESS_WORK_TYPES list, imported by reference from the DH-01 contract (membership is the only admissibility)', [showValue(workType)]);
        }
        const duplicates = findDuplicates(keys.map((key) => showValue(key)));
        if (duplicates.length > 0) {
                return refused('duplicate-role-keys', 'THE FAIL-CLOSED LAW', `validateWorkTypeRoleAffinity: the affinity's role keys must be duplicate-free (a role kind appears once per work type) - the offender(s) ${showList(duplicates)}`, duplicates);
        }
        const resolvable = resolvableRoleKeys(catalogs);
        const unresolvable = keys.filter((key) => typeof key !== 'string' || !resolvable.has(key)).map((key) => showValue(key));
        if (unresolvable.length > 0) {
                return refused(
                        'unknown-affinity-role',
                        'THE FROZEN-CATALOG LAW',
                        `validateWorkTypeRoleAffinity: every affinity key must resolve in at least one industry catalog (the integrity guarantee) - the key(s) ${showList(unresolvable)} resolve in none (a malformed catalogs argument resolves nothing - fail-closed)`,
                        unresolvable,
                );
        }
        return { ok: true, value: [...(affinity as string[])] };
}

// --- the request / selection walks ---

/**
 * The composition-request walk (pure): malformed-record (not a plain
 * object; a PRESENT workTypes carrier is not an array), no-fork (the
 * DH-01 forbidden-key family on the request record, BEFORE unknown-key
 * - the precedence law), unknown-key (a key beyond industry/workTypes),
 * missing-key, unknown-industry, then the DH-01 work-type subset laws
 * in the frozen order - empty-work-types, unknown-work-type,
 * duplicate-work-types, work-types-out-of-order (the frozen list order
 * preserved). Ok carries { industry, workTypes }.
 */
export function validateRoleCompositionRequest(request: unknown): RolesPayloadOutcome<RoleCompositionRequest> {
        if (!isRecord(request)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleCompositionRequest: the composition request must be a plain object (never a silent partial verdict)', ['request']);
        }
        const record = request as Record<string, unknown>;
        if (hasOwn(record, 'workTypes') && !Array.isArray(record.workTypes)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleCompositionRequest: workTypes must be an array (the ordered subset of the frozen DH-01 HARNESS_WORK_TYPES list, imported by reference)', ['workTypes']);
        }
        const keys = Object.keys(record);
        const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
        if (forbiddenPresent.length > 0) {
                return refused(
                        'no-fork',
                        'THE NO-FORK LAW',
                        `validateRoleCompositionRequest: the composition request is CONFIGURATION ONLY - a harness is composable configuration over the universal Flauz core, never an industry-specific fork; the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on the request`,
                        forbiddenPresent,
                );
        }
        const unknownKeys = keys.filter((key) => key !== 'industry' && key !== 'workTypes');
        if (unknownKeys.length > 0) {
                return refused('unknown-key', 'THE NO-FORK LAW', `validateRoleCompositionRequest: the request schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected (the request alphabet is references only)`, unknownKeys);
        }
        const missingKeys = ['industry', 'workTypes'].filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateRoleCompositionRequest: the request schema requires both keys - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isHarnessIndustry(record.industry)) {
                return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRequest: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility)', [showValue(record.industry)]);
        }
        const workTypes = record.workTypes as unknown[];
        if (workTypes.length === 0) {
                return refused('empty-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRequest: workTypes must be a non-empty ordered subset of the frozen HARNESS_WORK_TYPES list', ['workTypes']);
        }
        const nonMembers = workTypes.filter((member) => !isHarnessWorkType(member)).map((member) => showValue(member));
        if (nonMembers.length > 0) {
                return refused('unknown-work-type', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRequest: every workTypes member must be in the frozen HARNESS_WORK_TYPES list (membership is the only admissibility)', nonMembers);
        }
        const duplicates = findDuplicates(workTypes.map((member) => showValue(member)));
        if (duplicates.length > 0) {
                return refused('duplicate-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRequest: workTypes must be duplicate-free (the ordered subset carries no repeats)', duplicates);
        }
        const inversion = findOrderInversion(workTypes);
        if (inversion !== null) {
                return refused('work-types-out-of-order', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRequest: workTypes must preserve the frozen HARNESS_WORK_TYPES list order (the pair above is inverted)', inversion);
        }
        return { ok: true, value: { industry: record.industry, workTypes: [...(workTypes as HarnessWorkType[])] } };
}

/**
 * The explicit-selection walk (pure): malformed-record (not a plain
 * object; a PRESENT roleKeys carrier is not an array), no-fork,
 * unknown-key (a key beyond industry/roleKeys), missing-key,
 * unknown-industry, then role-not-in-catalog (EVERY roleKey must be a
 * member of the industry's catalog - THE FROZEN-CATALOG LAW; the
 * offenders are listed, non-strings fail closed as non-members),
 * duplicate-role-keys (the inherited law), empty-composition (the
 * selection is non-empty). Ok carries the resolved templates in the
 * industry catalog's own order (never the request's order).
 */
export function validateRoleSelection(request: unknown): RolesPayloadOutcome<RoleSelection> {
        if (!isRecord(request)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleSelection: the selection request must be a plain object (never a silent partial verdict)', ['request']);
        }
        const record = request as Record<string, unknown>;
        if (hasOwn(record, 'roleKeys') && !Array.isArray(record.roleKeys)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleSelection: roleKeys must be an array (the explicit multi-role selection against the industry catalog)', ['roleKeys']);
        }
        const keys = Object.keys(record);
        const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
        if (forbiddenPresent.length > 0) {
                return refused(
                        'no-fork',
                        'THE NO-FORK LAW',
                        `validateRoleSelection: the selection request is CONFIGURATION ONLY - the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on the request`,
                        forbiddenPresent,
                );
        }
        const unknownKeys = keys.filter((key) => key !== 'industry' && key !== 'roleKeys');
        if (unknownKeys.length > 0) {
                return refused('unknown-key', 'THE NO-FORK LAW', `validateRoleSelection: the request schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = ['industry', 'roleKeys'].filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateRoleSelection: the request schema requires both keys - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isHarnessIndustry(record.industry)) {
                return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateRoleSelection: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility)', [showValue(record.industry)]);
        }
        const roleKeys = record.roleKeys as unknown[];
        const catalogKeys = new Set<string>(INDUSTRY_ROLE_CATALOGS[record.industry as HarnessIndustry].map((template) => template.roleKey));
        const offenders = roleKeys.filter((key) => typeof key !== 'string' || !catalogKeys.has(key)).map((key) => showValue(key));
        if (offenders.length > 0) {
                return refused(
                        'role-not-in-catalog',
                        'THE FROZEN-CATALOG LAW',
                        `validateRoleSelection: every selected roleKey must be a member of the '${record.industry}' industry's frozen catalog (membership is the only admissibility) - the offender(s) ${showList(offenders)} are not in the catalog`,
                        offenders,
                );
        }
        const duplicates = findDuplicates(roleKeys.map((key) => showValue(key)));
        if (duplicates.length > 0) {
                return refused('duplicate-role-keys', 'THE FAIL-CLOSED LAW', `validateRoleSelection: the selected roleKeys must be duplicate-free (a named role appears once) - the offender(s) ${showList(duplicates)}`, duplicates);
        }
        if (roleKeys.length === 0) {
                return refused('empty-composition', 'THE COMPOSITION LAW', 'validateRoleSelection: the selection must name at least one role (an empty selection composes nothing)', ['roleKeys']);
        }
        const selected = new Set<string>(roleKeys as string[]);
        const resolved = INDUSTRY_ROLE_CATALOGS[record.industry as HarnessIndustry].filter((template) => selected.has(template.roleKey)).map((template) => ({ roleKey: template.roleKey, summary: template.summary }));
        return { ok: true, value: { industry: record.industry, roles: resolved } };
}

// --- the composition-record walk (the honest record's deep shape) ---

/**
 * The deep composition-record walk (pure): the full station tour in the
 * frozen ROLES_VALIDATION_REJECTION_REASONS walk order - malformed-record
 * (the record, its carriers, its role/provenance entries' structural
 * shape, the composedAtIso), no-fork (the forbidden family on the
 * record; extra keys on role entries), unknown-key (record and
 * provenance level), missing-key, unknown-industry, the workTypes subset
 * laws, role-not-in-catalog (every role entry must be a member of the
 * industry's catalog - THE FROZEN-CATALOG LAW), duplicate-role-keys,
 * empty-composition, invalid-role-key / invalid-summary (the per-entry
 * template bounds), the provenance parallel laws (a torn parallel
 * structure is malformed-record; the contributedBy work-type subset
 * laws), and version-mismatch LAST (THE SINGLE-VERSION LAW). Ok carries
 * the canonical fixed-key-order copy. First-failure-is-the-verdict.
 */
export function validateRoleCompositionRecord(record: unknown): RolesPayloadOutcome<RoleCompositionRecord> {
        if (!isRecord(record)) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', 'validateRoleCompositionRecord: the composition record must be a plain object (never a silent partial verdict)', ['record']);
        }
        const candidate = record as Record<string, unknown>;
        const structural: string[] = [];
        if (hasOwn(candidate, 'workTypes') && !Array.isArray(candidate.workTypes)) {
                structural.push('workTypes');
        }
        if (hasOwn(candidate, 'roles') && !Array.isArray(candidate.roles)) {
                structural.push('roles');
        }
        if (hasOwn(candidate, 'provenance') && !Array.isArray(candidate.provenance)) {
                structural.push('provenance');
        }
        if (hasOwn(candidate, 'composedAtIso') && (typeof candidate.composedAtIso !== 'string' || candidate.composedAtIso.length === 0)) {
                structural.push('composedAtIso');
        }
        if (Array.isArray(candidate.roles)) {
                for (let i = 0; i < (candidate.roles as unknown[]).length; i += 1) {
                        if (!isRecord((candidate.roles as unknown[])[i])) {
                                structural.push(`roles[${i}]`);
                        }
                }
        }
        if (Array.isArray(candidate.provenance)) {
                for (let i = 0; i < (candidate.provenance as unknown[]).length; i += 1) {
                        const entry = (candidate.provenance as unknown[])[i];
                        if (!isRecord(entry)) {
                                structural.push(`provenance[${i}]`);
                                continue;
                        }
                        if (hasOwn(entry as Record<string, unknown>, 'contributedBy') && !Array.isArray((entry as Record<string, unknown>).contributedBy)) {
                                structural.push(`provenance[${i}].contributedBy`);
                        }
                }
        }
        if (structural.length > 0) {
                return refused('malformed-record', 'THE FAIL-CLOSED LAW', `validateRoleCompositionRecord: the composition record carries a field of the wrong structural type - the offending field(s) ${showList(structural)} (never a silent partial verdict)`, structural);
        }
        const keys = Object.keys(candidate);
        const forbiddenPresent = (FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as readonly string[]).filter((key) => keys.includes(key));
        if (forbiddenPresent.length > 0) {
                return refused(
                        'no-fork',
                        'THE NO-FORK LAW',
                        `validateRoleCompositionRecord: the composition record is the honest record of a configuration walk - the forbidden execution-material key(s) ${showList(forbiddenPresent)} cannot appear on it`,
                        forbiddenPresent,
                );
        }
        const unknownKeys = keys.filter((key) => !(ROLE_COMPOSITION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return refused('unknown-key', 'THE NO-FORK LAW', `validateRoleCompositionRecord: the record schema is closed - the unknown key(s) ${showList(unknownKeys)} are rejected`, unknownKeys);
        }
        const missingKeys = (ROLE_COMPOSITION_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(candidate, key));
        if (missingKeys.length > 0) {
                return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateRoleCompositionRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`, missingKeys);
        }
        if (!isHarnessIndustry(candidate.industry)) {
                return refused('unknown-industry', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract', [showValue(candidate.industry)]);
        }
        const workTypes = candidate.workTypes as unknown[];
        if (workTypes.length === 0) {
                return refused('empty-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRecord: workTypes must be a non-empty ordered subset of the frozen HARNESS_WORK_TYPES list', ['workTypes']);
        }
        const nonMembers = workTypes.filter((member) => !isHarnessWorkType(member)).map((member) => showValue(member));
        if (nonMembers.length > 0) {
                return refused('unknown-work-type', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRecord: every workTypes member must be in the frozen HARNESS_WORK_TYPES list (membership is the only admissibility)', nonMembers);
        }
        const duplicates = findDuplicates(workTypes.map((member) => showValue(member)));
        if (duplicates.length > 0) {
                return refused('duplicate-work-types', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRecord: workTypes must be duplicate-free (the ordered subset carries no repeats)', duplicates);
        }
        const inversion = findOrderInversion(workTypes);
        if (inversion !== null) {
                return refused('work-types-out-of-order', 'THE FROZEN-VOCABULARY LAW', 'validateRoleCompositionRecord: workTypes must preserve the frozen HARNESS_WORK_TYPES list order (the pair above is inverted)', inversion);
        }
        const catalog = INDUSTRY_ROLE_CATALOGS[candidate.industry as HarnessIndustry];
        const catalogKeys = new Set<string>(catalog.map((template) => template.roleKey));
        const roles = candidate.roles as unknown[];
        const notInCatalog = roles
                .filter((role) => isRecord(role) && typeof (role as Record<string, unknown>).roleKey === 'string')
                .map((role) => (role as Record<string, unknown>).roleKey as string)
                .filter((roleKey) => !catalogKeys.has(roleKey));
        if (notInCatalog.length > 0) {
                return refused(
                        'role-not-in-catalog',
                        'THE FROZEN-CATALOG LAW',
                        `validateRoleCompositionRecord: every composed role must be a member of the '${candidate.industry}' industry's frozen catalog (membership is the only admissibility) - the offender(s) ${showList(notInCatalog)} are not in the catalog`,
                        notInCatalog,
                );
        }
        const roleKeyDuplicates = findDuplicates(
                roles.filter((role) => isRecord(role) && typeof (role as Record<string, unknown>).roleKey === 'string').map(
                        (role) => (role as Record<string, unknown>).roleKey as string,
                ),
        );
        if (roleKeyDuplicates.length > 0) {
                return refused('duplicate-role-keys', 'THE FAIL-CLOSED LAW', `validateRoleCompositionRecord: the composed roleKeys must be unique (a named role appears once) - the offender(s) ${showList(roleKeyDuplicates)}`, roleKeyDuplicates);
        }
        if (roles.length === 0) {
                return refused('empty-composition', 'THE COMPOSITION LAW', 'validateRoleCompositionRecord: the composed role set must be non-empty (an empty composition composes nothing - the honest refusal)', ['roles']);
        }
        for (let i = 0; i < roles.length; i += 1) {
                const verdict = validateRoleTemplate(roles[i]);
                if (!verdict.ok) {
                        return {
                                ok: false,
                                refusal: {
                                        reason: verdict.refusal.reason,
                                        law: verdict.refusal.law,
                                        message: `validateRoleCompositionRecord: the composed role roles[${i}] is refused - ${verdict.refusal.message}`,
                                        items: verdict.refusal.items === undefined ? undefined : verdict.refusal.items.map((item) => `roles[${i}].${item}`),
                                },
                        };
                }
        }
        const provenance = candidate.provenance as unknown[];
        const provenanceTears: string[] = [];
        if (provenance.length !== roles.length) {
                provenanceTears.push('provenance');
        } else {
                for (let i = 0; i < provenance.length; i += 1) {
                        const entry = provenance[i] as Record<string, unknown>;
                        const role = roles[i] as Record<string, unknown>;
                        if (entry.roleKey !== role.roleKey) {
                                provenanceTears.push(`provenance[${i}].roleKey`);
                        }
                        if (Array.isArray(entry.contributedBy) && (entry.contributedBy as unknown[]).length === 0) {
                                provenanceTears.push(`provenance[${i}].contributedBy`);
                        }
                }
        }
        if (provenanceTears.length > 0) {
                return refused(
                        'malformed-record',
                        'THE FAIL-CLOSED LAW',
                        `validateRoleCompositionRecord: the provenance array must be parallel to the roles array (same length, same order, same keys; every entry naming at least one contributing work type) - the torn field(s) ${showList(provenanceTears)}`,
                        provenanceTears,
                );
        }
        for (let i = 0; i < provenance.length; i += 1) {
                const entry = provenance[i] as Record<string, unknown>;
                const extraEntryKeys = Object.keys(entry).filter((key) => !(ROLE_PROVENANCE_SCHEMA_KEYS as readonly string[]).includes(key));
                if (extraEntryKeys.length > 0) {
                        return refused('unknown-key', 'THE NO-FORK LAW', `validateRoleCompositionRecord: the provenance entry provenance[${i}] carries the unknown key(s) ${showList(extraEntryKeys)} (the provenance schema is closed)`, extraEntryKeys);
                }
                const missingEntryKeys = (ROLE_PROVENANCE_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(entry, key));
                if (missingEntryKeys.length > 0) {
                        return refused('missing-key', 'THE FAIL-CLOSED LAW', `validateRoleCompositionRecord: the provenance entry provenance[${i}] requires both keys - the key(s) ${showList(missingEntryKeys)} are missing`, missingEntryKeys);
                }
                const contributedBy = entry.contributedBy as unknown[];
                const contributedNonMembers = contributedBy.filter((member) => !isHarnessWorkType(member)).map((member) => showValue(member));
                if (contributedNonMembers.length > 0) {
                        return refused('unknown-work-type', 'THE FROZEN-VOCABULARY LAW', `validateRoleCompositionRecord: every provenance[${i}].contributedBy member must be in the frozen HARNESS_WORK_TYPES list (a provenance work type is a real work type)`, contributedNonMembers);
                }
                const contributedDuplicates = findDuplicates(contributedBy.map((member) => showValue(member)));
                if (contributedDuplicates.length > 0) {
                        return refused('duplicate-work-types', 'THE FROZEN-VOCABULARY LAW', `validateRoleCompositionRecord: every provenance[${i}].contributedBy array must be duplicate-free`, contributedDuplicates);
                }
                const contributedInversion = findOrderInversion(contributedBy);
                if (contributedInversion !== null) {
                        return refused('work-types-out-of-order', 'THE FROZEN-VOCABULARY LAW', `validateRoleCompositionRecord: every provenance[${i}].contributedBy array must preserve the frozen HARNESS_WORK_TYPES list order (the pair above is inverted)`, contributedInversion);
                }
        }
        if (candidate.contractVersion !== ROLES_CONTRACTS_VERSION) {
                return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `validateRoleCompositionRecord: the record must carry ROLES_CONTRACTS_VERSION '${ROLES_CONTRACTS_VERSION}' exactly (the single-version law - declared once, re-carried by the kit; the LAST station of the record walk)`, [showValue(candidate.contractVersion)]);
        }
        return { ok: true, value: canonicalCompositionRecord(candidate as unknown as RoleCompositionRecord) };
}

/**
 * Pure deep shape guard: a well-formed composition record (the deep
 * walk above, green). Fails closed on every malformed path; never reads
 * a clock; never mutates its input.
 */
export function isRoleCompositionRecord(value: unknown): value is RoleCompositionRecord {
        return validateRoleCompositionRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * composition record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * ROLE_COMPOSITION_SCHEMA_KEYS order, the role entries in the
 * roleKey,summary order, the provenance entries in the
 * roleKey,contributedBy order. Throws TypeError on a malformed record
 * (never dishonest bytes).
 */
export function serializeRoleComposition(record: unknown): string {
        if (!isRoleCompositionRecord(record)) {
                throw new TypeError(
                        'serializeRoleComposition: record must satisfy isRoleCompositionRecord - no dishonest composition record ever gets canonical bytes',
                );
        }
        return JSON.stringify(canonicalCompositionObject(record));
}

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (record / role / provenance level), or invalid content (the deep
 * semantic walk) - each a typed rejection naming the drift; never a
 * silent partial parse. First-failure-is-the-verdict, in the frozen
 * ROLES_PARSE_REJECTION_REASONS order.
 */
export function parseRoleComposition(bytes: unknown): RolesParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                message: 'parseRoleComposition: bytes must be a string (the canonical fixed-key-order composition-record bytes)',
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
                                message: `parseRoleComposition: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                message: 'parseRoleComposition: the bytes must carry a JSON object (the composition-record envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of ROLE_COMPOSITION_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        message: `parseRoleComposition: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.contractVersion !== 'string' || typeof record.industry !== 'string' || typeof record.composedAtIso !== 'string' || !Array.isArray(record.workTypes) || !Array.isArray(record.roles) || !Array.isArray(record.provenance)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                message: 'parseRoleComposition: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        if (record.contractVersion !== ROLES_CONTRACTS_VERSION) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-contract-version',
                                message: `parseRoleComposition: the record carries contract version '${record.contractVersion}' - only '${ROLES_CONTRACTS_VERSION}' is known (the single-version law)`,
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(ROLE_COMPOSITION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                message: `parseRoleComposition: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict record schema is closed)`,
                        },
                };
        }
        const roles = record.roles as unknown[];
        for (let i = 0; i < roles.length; i += 1) {
                const role = roles[i];
                if (isRecord(role)) {
                        const extraRoleKeys = Object.keys(role as Record<string, unknown>).filter((key) => key !== 'roleKey' && key !== 'summary');
                        if (extraRoleKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                message: `parseRoleComposition: the role entry roles[${i}] carries the unknown key '${extraRoleKeys[0]}' (a named role is roleKey + summary only)`,
                                        },
                                };
                        }
                }
        }
        const provenance = record.provenance as unknown[];
        for (let i = 0; i < provenance.length; i += 1) {
                const entry = provenance[i];
                if (isRecord(entry)) {
                        const extraEntryKeys = Object.keys(entry as Record<string, unknown>).filter(
                                (key) => !(ROLE_PROVENANCE_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraEntryKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                message: `parseRoleComposition: the provenance entry provenance[${i}] carries the unknown key '${extraEntryKeys[0]}' (the provenance schema is closed)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateRoleCompositionRecord(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                message: `parseRoleComposition: the parsed record fails the deep composition walk (${deep.refusal.reason} - ${deep.refusal.message}; never a silent partial parse)`,
                        },
                };
        }
        return { ok: true, record: deep.value };
}

// --- internal helpers (never exported) ---

/** Builds one typed refusal (the single refusal-record shape). */
function refused(reason: RolesValidationRejectionReason, law: string, message: string, items?: readonly string[]): RolesPayloadOutcome<never> {
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

/**
 * The resolvable role-key set of a catalogs argument (the union of
 * every industry catalog's role keys). Fail-closed: a non-record
 * argument, a malformed catalog value or a malformed entry resolves
 * NOTHING (the DH-01 malformed-catalog discipline).
 */
function resolvableRoleKeys(catalogs: unknown): Set<string> {
        const resolvable = new Set<string>();
        if (!isRecord(catalogs)) {
                return resolvable;
        }
        for (const value of Object.values(catalogs)) {
                if (!Array.isArray(value)) {
                        continue;
                }
                for (const entry of value as unknown[]) {
                        if (isRecord(entry) && typeof (entry as Record<string, unknown>).roleKey === 'string') {
                                resolvable.add((entry as Record<string, unknown>).roleKey as string);
                        }
                }
        }
        return resolvable;
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

/** Builds the canonical fixed-key-order copy of a validated composition record. */
function canonicalCompositionRecord(record: RoleCompositionRecord): RoleCompositionRecord {
        return canonicalCompositionObject(record) as unknown as RoleCompositionRecord;
}

/** Builds the canonical fixed-key-order object of a validated composition record (the serializer's engine). */
function canonicalCompositionObject(record: RoleCompositionRecord): Record<string, unknown> {
        return {
                contractVersion: record.contractVersion,
                industry: record.industry,
                workTypes: [...record.workTypes],
                composedAtIso: record.composedAtIso,
                roles: record.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
                provenance: record.provenance.map((entry) => ({ roleKey: entry.roleKey, contributedBy: [...entry.contributedBy] })),
        };
}
