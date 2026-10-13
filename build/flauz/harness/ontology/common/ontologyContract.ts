/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-004 domain ontology/terminology contract family: the typed
 * per-industry terminology vocabulary for the Domain Harness OS
 * direction (WORK-REGISTRY.md - the wave-4 ontology family, registry
 * row DH-004 "domain ontology/terminology layer"). This family gives a
 * harness its domain VOCABULARY - the shared language the roles'
 * summaries and the workflows speak - as pure reference-only
 * configuration over the frozen industry list imported from the REAL
 * DH-01 contract (never re-declared - THE REAL-VOCABULARY LAW). A term
 * is termKey + definition ONLY (it grants NOTHING by itself); relations
 * live in the per-industry relation registry, never inline on a term
 * (THE NO-FORK LAW's shape discipline). The layer is harness-ADJACENT:
 * the DH-01 descriptor's alphabet stays the frozen ten keys - terms are
 * NOT a descriptor key, and this module never touches the descriptor
 * schema (the scope boundary; the battery pins it against the real
 * module).
 *
 * LAWS (the DH-004 work order; the landed DH-01/DH-02/DH-03 family
 * precedents, inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a term is termKey +
 *   definition ONLY - reference-only configuration; any additional key
 *   on a term (or a relation) is the typed no-fork rejection; relations
 *   live in the registry, never inline on a term; the catalogs carry
 *   zero execution material.
 * - THE REAL-VOCABULARY LAW (binding): the industries are imported
 *   from the DH-01 contract, never re-declared - HARNESS_INDUSTRIES and
 *   isHarnessIndustry are the REAL bindings re-exported by reference
 *   (the battery pins referential identity).
 * - THE FROZEN-CATALOG LAW (binding): the sixteen term catalogs and the
 *   relation registries are frozen at this family; membership is the
 *   only admissibility; the relation-class vocabulary is the frozen
 *   four-class list; widening or reordering is a versioned contract
 *   decision.
 * - THE INTEGRITY LAW (binding): every relation end resolves in its
 *   industry's catalog; the reciprocity classes carry their inverses
 *   (every broader-than has its narrower-than; every related-to has
 *   its mirror; part-of demands no inverse - the class is one-
 *   directional containment); no self-relations; no duplicates; the
 *   integrity walk is typed and never throws.
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   serialization is canonical fixed-key-order bytes; same inputs
 *   produce byte-identical outputs.
 * - THE FAIL-CLOSED LAW (binding): every domain refusal is the typed
 *   record { ok: false, refusal: { reason, law, message, items? } }
 *   naming the violated law and every offending item - never a string
 *   throw, never a silent skip, never a partial effect; the walk is
 *   first-failure in the frozen station order with the COMPLETE item
 *   list at that station (the work order's single-refusal shape; a
 *   disclosed divergence from the landed siblings' complete-table
 *   refusals - documented in the README SPEC).
 * - THE SINGLE-VERSION LAW (binding): ONTOLOGY_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION is declared ONCE in ITS module
 *   and re-carried here by reference (the battery pins every copy
 *   equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/**
 * THE REAL-VOCABULARY LAW's re-export block: the frozen DH-01 industry
 * vocabulary is re-exported BY REFERENCE (the same bindings, never
 * re-declared copies). The battery pins referential identity against
 * the real module.
 */
export {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_INDUSTRIES,
        isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW: ONTOLOGY_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const ONTOLOGY_CONTRACTS_VERSION = '1.0.0';

// --- the term shape (THE NO-FORK LAW's reference-only discipline) ---

/** The termKey bound (a non-empty kebab-case identifier of at most 64 characters). */
export const TERM_KEY_MAX_LENGTH = 64;

/** The definition bound (a non-empty human string of at most 300 characters, no control characters). */
export const TERM_DEFINITION_MAX_LENGTH = 300;

/** The frozen term schema keys, in the canonical fixed-key-order (the serialization order). */
export const DOMAIN_TERM_SCHEMA_KEYS = ['termKey', 'definition'] as const;

/**
 * One domain term: the reference-only vocabulary entry. A term is
 * termKey + definition ONLY (exactly two keys - any additional key is
 * the typed no-fork rejection); the termKey is a non-empty kebab-case
 * identifier of at most 64 characters, unique within its catalog; the
 * definition is a non-empty human string of at most 300 characters
 * with no control characters. A term grants NOTHING by itself; it MAY
 * carry relations ONLY via the industry's relation registry, never
 * inline (the NO-FORK shape discipline).
 */
export interface DomainTerm {
        readonly termKey: string;
        readonly definition: string;
}

/**
 * The kebab-case alphabet for term keys: one or more lowercase
 * alphanumeric segments joined by single hyphens (no leading or
 * trailing hyphen, no doubling, no whitespace, no control characters,
 * no uppercase). Pure predicate over the shape + the 64-character
 * bound.
 */
export function isKebabCaseTermKey(value: unknown): value is string {
        if (typeof value !== 'string') {
                return false;
        }
        if (value.length === 0 || value.length > TERM_KEY_MAX_LENGTH) {
                return false;
        }
        return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

// --- the relation classes (THE FROZEN-CATALOG LAW's class vocabulary) ---

/**
 * The closed frozen relation-class vocabulary: the four directional
 * kinds of term relations. 'broader-than' and 'narrower-than' are
 * inverse twins (a hypernym edge and its hyponym mirror); 'related-to'
 * is symmetric (every edge demands its mirror); 'part-of' is
 * one-directional containment (the class demands NO inverse - the
 * inverse edge is not part of the frozen vocabulary). Widening or
 * reordering the list is a versioned contract decision.
 */
export const TERM_RELATION_CLASSES = [
        'broader-than',
        'narrower-than',
        'related-to',
        'part-of',
] as const;
export type TermRelationClass = (typeof TERM_RELATION_CLASSES)[number];

/** Pure predicate over the closed class list. */
export function isTermRelationClass(value: unknown): value is TermRelationClass {
        return (TERM_RELATION_CLASSES as readonly string[]).includes(value as string);
}

/** The frozen relation schema keys, in the canonical fixed-key-order (the serialization order). */
export const TERM_RELATION_SCHEMA_KEYS = ['fromTermKey', 'relationClass', 'toTermKey'] as const;

/**
 * One term relation from the registry: the source term, the relation
 * class and the target term (exactly three keys - any additional key
 * is the typed no-fork rejection). BOTH ends must resolve in the SAME
 * industry's catalog; no self-relations; no duplicate triples.
 */
export interface TermRelation {
        readonly fromTermKey: string;
        readonly relationClass: TermRelationClass;
        readonly toTermKey: string;
}

/** One reciprocity table row: the class and the inverse class it demands (null when the class demands none). */
export interface TermRelationInverseRow {
        readonly relationClass: TermRelationClass;
        readonly inverseClass: TermRelationClass | null;
}

/**
 * THE INTEGRITY LAW's reciprocity table: the frozen map from every
 * relation class to the inverse class it demands. broader-than and
 * narrower-than are inverse twins; related-to is its own symmetric
 * mirror; part-of demands NO inverse (one-directional containment -
 * "each bi-directionally consistent where the class demands it", and
 * part-of is the class that does not demand it). Widening or amending
 * the table is a versioned contract decision.
 */
export const TERM_RELATION_INVERSE_TABLE = [
        { relationClass: 'broader-than', inverseClass: 'narrower-than' },
        { relationClass: 'narrower-than', inverseClass: 'broader-than' },
        { relationClass: 'related-to', inverseClass: 'related-to' },
        { relationClass: 'part-of', inverseClass: null },
] as const;

/**
 * Pure lookup over the frozen reciprocity table: the inverse class a
 * relation class demands (null when the class demands no inverse).
 */
export function inverseRelationClassOf(relationClass: TermRelationClass): TermRelationClass | null {
        for (const row of TERM_RELATION_INVERSE_TABLE) {
                if (row.relationClass === relationClass) {
                        return row.inverseClass;
                }
        }
        return null;
}

// --- the frozen catalogs (THE FROZEN-CATALOG LAW) ---

/**
 * The frozen per-industry terminology catalogs: EXACTLY one entry for
 * each of the sixteen frozen HARNESS_INDUSTRIES members (imported by
 * reference - the Record type over HarnessIndustry enforces the
 * exhaustiveness at compile time; the battery pins the key set against
 * the real list). Each catalog is a non-empty ordered frozen array of
 * DomainTerm entries (6-14 terms per industry, domain-honest); the
 * termKey is unique within its catalog. A term carries relations ONLY
 * via INDUSTRY_TERM_RELATIONS, never inline.
 */
export const INDUSTRY_TERM_CATALOGS: Readonly<Record<HarnessIndustry, readonly DomainTerm[]>> = {
        software: [
                { termKey: 'source-code', definition: 'The human-readable instructions of a program, written in a programming language and transformed into executable form by a build.' },
                { termKey: 'code-review', definition: 'The systematic examination of source code by peers to find defects and improve quality before a change merges.' },
                { termKey: 'unit-test', definition: 'An automated test that exercises one small unit of code in isolation, asserting its expected behavior.' },
                { termKey: 'technical-debt', definition: 'The accumulated future cost imposed by expedient shortcuts taken in code and design today.' },
                { termKey: 'continuous-integration', definition: 'The practice of merging work frequently and verifying every merge with automated builds and tests.' },
                { termKey: 'api-contract', definition: 'The published agreement of an interface: the operations, inputs, outputs and error cases callers may rely on.' },
                { termKey: 'version-control', definition: 'The system recording changes to files over time, enabling history inspection, branching and rollback.' },
                { termKey: 'refactoring', definition: 'A behavior-preserving restructuring of code intended to make it clearer and cheaper to change.' },
                { termKey: 'deployment-pipeline', definition: 'The automated sequence of build, test and promotion stages that carries a change to production.' },
                { termKey: 'defect', definition: 'An observable deviation of the software from its specified or intended behavior.' },
                { termKey: 'regression', definition: 'A defect that reintroduces previously fixed behavior after a later change.' },
        ],
        legal: [
                { termKey: 'litigation', definition: 'The process of resolving a dispute through the courts, from filing and pleadings through trial to judgment and appeal.' },
                { termKey: 'statute', definition: 'A law enacted by a legislature, binding as written within its jurisdiction.' },
                { termKey: 'precedent', definition: 'A prior court decision that guides or binds later courts deciding similar issues.' },
                { termKey: 'discovery', definition: 'The pre-trial phase in which parties must disclose evidence and documents relevant to the case.' },
                { termKey: 'contract', definition: 'A legally enforceable agreement between parties that creates mutual obligations.' },
                { termKey: 'tort', definition: 'A civil wrong, other than breach of contract, causing harm for which the law provides a remedy.' },
                { termKey: 'negligence', definition: 'The failure to exercise reasonable care; the most common basis of tort liability.' },
                { termKey: 'jurisdiction', definition: 'The power of a court to hear and decide a matter, defined by territory and subject matter.' },
                { termKey: 'legal-hold', definition: 'A directive suspending routine document destruction because litigation is reasonably anticipated.' },
                { termKey: 'pleading', definition: 'A formal written statement filed with a court setting out the claims and defenses of a party.' },
        ],
        finance: [
                { termKey: 'asset', definition: 'An economic resource controlled by an entity that is expected to produce future value.' },
                { termKey: 'liability', definition: 'A present obligation of an entity arising from past events, settled through resources or services.' },
                { termKey: 'equity', definition: "The residual interest in an entity's assets after deducting its liabilities; the owners' claim." },
                { termKey: 'balance-sheet', definition: "The statement of an entity's assets, liabilities and equity at a point in time." },
                { termKey: 'cash-flow', definition: 'The movement of cash into and out of an entity over a period, by operating, investing and financing activity.' },
                { termKey: 'audit', definition: 'An independent examination of financial records and statements to attest their fairness and compliance.' },
                { termKey: 'reconciliation', definition: 'The process of comparing two sets of records to confirm they agree, resolving every difference.' },
                { termKey: 'ledger', definition: 'The principal book of accounts recording every transaction by account and period.' },
                { termKey: 'accrual', definition: 'The recognition of revenue and expense when earned or incurred, regardless of when cash moves.' },
                { termKey: 'fiscal-year', definition: 'The twelve-month accounting period an entity uses for its reporting.' },
        ],
        healthcare: [
                { termKey: 'patient-record', definition: 'The longitudinal clinical record of a patient: history, findings, diagnoses, medications and care plans.' },
                { termKey: 'informed-consent', definition: "A patient's documented, voluntary agreement to a procedure after being told of risks and alternatives." },
                { termKey: 'triage', definition: 'The sorting of patients by clinical urgency to allocate care when demand exceeds capacity.' },
                { termKey: 'differential-diagnosis', definition: "The systematic comparison of the conditions that could explain a patient's findings, narrowed by evidence." },
                { termKey: 'care-pathway', definition: 'A standardized sequence of assessments and interventions for a defined group of patients.' },
                { termKey: 'adverse-event', definition: 'Harm caused by medical care rather than the underlying disease, detected and reported for learning.' },
                { termKey: 'referral', definition: "A clinician's directed handoff of a patient to another practitioner for specialized assessment or care." },
                { termKey: 'discharge-summary', definition: 'The document closing an episode of care, summarizing findings, treatment and the follow-up plan.' },
                { termKey: 'contraindication', definition: 'A condition or circumstance that makes a treatment inappropriate or unsafe for a patient.' },
                { termKey: 'clinical-assessment', definition: "The structured evaluation of a patient's condition through history, examination and measurement." },
                { termKey: 'telemedicine', definition: 'The remote delivery of clinical consultation and monitoring using telecommunications.' },
        ],
        education: [
                { termKey: 'curriculum', definition: 'The planned sequence of learning objectives, content and experiences a program delivers.' },
                { termKey: 'syllabus', definition: 'The course-level document stating objectives, schedule, policies and assessment for a class.' },
                { termKey: 'assessment', definition: "Any systematic evaluation of a learner's knowledge or performance against expectations." },
                { termKey: 'formative-assessment', definition: 'Low-stakes checks of understanding during learning, used to adjust teaching in progress.' },
                { termKey: 'summative-assessment', definition: 'Evaluation of achieved learning at the end of a unit or course, used for grading and certification.' },
                { termKey: 'learning-objective', definition: 'A specific, observable statement of what a learner will be able to do after instruction.' },
                { termKey: 'rubric', definition: 'The published criteria and performance levels used to score student work consistently.' },
                { termKey: 'prerequisite', definition: 'A required prior course or competence a student must hold before enrolling in a course.' },
                { termKey: 'accreditation', definition: 'The external review certifying that a program meets defined quality standards.' },
                { termKey: 'pedagogy', definition: 'The theory and practice of how teaching is designed and delivered.' },
        ],
        marketing: [
                { termKey: 'brand-positioning', definition: "The deliberate choice of what a brand stands for relative to alternatives in the customer's mind." },
                { termKey: 'conversion-rate', definition: 'The share of the exposed audience that completes the desired action; the primary performance ratio.' },
                { termKey: 'funnel', definition: 'The staged model of the customer journey from first awareness to purchase and retention.' },
                { termKey: 'segment', definition: 'A grouping of a market defined by shared characteristics that responds similarly to an offer.' },
                { termKey: 'lead', definition: 'A prospective customer identified and engaged as a possible buyer.' },
                { termKey: 'campaign', definition: 'A time-bounded, coordinated set of marketing activities pursuing a measurable objective.' },
                { termKey: 'attribution', definition: 'The analysis assigning credit for a conversion to the touchpoints that influenced it.' },
                { termKey: 'churn', definition: 'The rate at which customers or subscribers stop doing business over a period.' },
                { termKey: 'call-to-action', definition: 'A prompt in marketing material that tells the audience the immediate action to take.' },
                { termKey: 'a-b-test', definition: 'A controlled experiment comparing two variants on live audiences to decide by measured outcome.' },
        ],
        science: [
                { termKey: 'hypothesis', definition: 'A testable proposed explanation for an observation, stating a relationship that can be checked.' },
                { termKey: 'peer-review', definition: 'The evaluation of a manuscript by qualified experts before publication, judging validity and significance.' },
                { termKey: 'reproducibility', definition: 'The ability of an independent party to obtain consistent results using the published method.' },
                { termKey: 'protocol', definition: 'The detailed, pre-specified procedure for an experiment or study.' },
                { termKey: 'control-group', definition: 'The comparison group not receiving the treatment, isolating the effect under test.' },
                { termKey: 'replication', definition: "An independent repetition of a study's method to test whether its findings hold." },
                { termKey: 'dataset', definition: 'A structured collection of measurements or observations assembled for analysis.' },
                { termKey: 'preprint', definition: 'A manuscript shared publicly before peer review, establishing priority and inviting comment.' },
                { termKey: 'funding-grant', definition: 'An award of money for research, with stated scope, reporting duties and period.' },
                { termKey: 'variable', definition: 'A measured or manipulated quantity in an experiment; independent variables are set, dependent ones observed.' },
        ],
        media: [
                { termKey: 'editorial-calendar', definition: "The schedule of planned content topics and release dates governing a publication's output." },
                { termKey: 'byline', definition: 'The published attribution naming the author of a piece.' },
                { termKey: 'embargo', definition: 'An agreement holding a story until a stated release time, giving access under condition.' },
                { termKey: 'correction', definition: 'A published amendment fixing an error in earlier reporting.' },
                { termKey: 'anonymous-source', definition: 'A person providing information on condition that their identity is not published.' },
                { termKey: 'fact-checking', definition: 'The verification of claims, names and numbers before publication.' },
                { termKey: 'headline', definition: 'The prominent text announcing and framing a story for the audience.' },
                { termKey: 'newsroom', definition: 'The organization and workspace where journalists research, write and edit the news.' },
                { termKey: 'op-ed', definition: 'An opinion essay by a named outside author, published apart from reported coverage.' },
                { termKey: 'press-release', definition: 'An official statement issued to media to announce something, authored by its subject.' },
        ],
        construction: [
                { termKey: 'blueprint', definition: 'The precise technical drawing set specifying a design for construction.' },
                { termKey: 'building-permit', definition: 'The official authorization to build, issued after plans are checked against code.' },
                { termKey: 'structural-load', definition: 'The forces a structure must carry and resist, from weight, use and environment.' },
                { termKey: 'subcontractor', definition: 'A specialized firm engaged by the general contractor to perform a defined scope.' },
                { termKey: 'punch-list', definition: 'The itemized defects and incomplete work compiled at the end of a project for correction.' },
                { termKey: 'change-order', definition: 'The documented, authorized modification of scope, price or schedule during construction.' },
                { termKey: 'site-inspection', definition: 'The on-site verification that work conforms to plans, codes and safety requirements.' },
                { termKey: 'specifications', definition: 'The written technical requirements governing materials, workmanship and quality for the work.' },
                { termKey: 'critical-path', definition: 'The longest dependent sequence of activities, which determines the shortest possible schedule.' },
                { termKey: 'as-built-drawing', definition: 'The revised drawing set recording what was actually built, including field changes.' },
        ],
        logistics: [
                { termKey: 'bill-of-lading', definition: 'The carrier-issued document listing shipped goods, serving as receipt, contract and title evidence.' },
                { termKey: 'last-mile-delivery', definition: 'The final leg of transport from the local hub to the recipient, typically the costliest per unit.' },
                { termKey: 'lead-time', definition: 'The elapsed time from order placement to receipt of goods.' },
                { termKey: 'freight-forwarder', definition: 'The intermediary arranging transport and documentation for international shipments.' },
                { termKey: 'warehousing', definition: 'The storage and handling of goods within facilities between production and distribution.' },
                { termKey: 'route-optimization', definition: 'The computation of delivery paths minimizing distance, time or cost under constraints.' },
                { termKey: 'order-fulfillment', definition: 'The end-to-end process from order receipt through picking, packing and shipping to delivery.' },
                { termKey: 'customs-clearance', definition: 'The procedure moving goods across borders, with duties paid and documents accepted.' },
                { termKey: 'sku', definition: 'The unique identifier for a distinct item held and sold in inventory.' },
                { termKey: 'reverse-logistics', definition: 'The flow of goods back from customers for return, repair, recycling or disposal.' },
        ],
        retail: [
                { termKey: 'planogram', definition: 'The diagram prescribing exactly where each product sits on shelves and displays.' },
                { termKey: 'shrinkage', definition: 'The loss of inventory from theft, damage or error; the gap between recorded and counted stock.' },
                { termKey: 'private-label', definition: 'Products owned and branded by the retailer itself rather than an external manufacturer.' },
                { termKey: 'markdown', definition: 'The scheduled reduction of a price to clear aging inventory.' },
                { termKey: 'point-of-sale', definition: 'The checkout system and station where transactions and payments are captured.' },
                { termKey: 'stockout', definition: 'The state of a demanded item being unavailable on shelf or in warehouse.' },
                { termKey: 'assortment', definition: 'The chosen range of products a retailer offers, by category, brand and variant.' },
                { termKey: 'loss-leader', definition: 'An item deliberately priced near or below cost to drive store traffic.' },
                { termKey: 'loyalty-program', definition: 'The structured scheme rewarding repeat purchasing with points, tiers or privileges.' },
                { termKey: 'inventory-count', definition: 'The periodic physical counting of stock to reconcile records and surface shrinkage.' },
        ],
        manufacturing: [
                { termKey: 'bill-of-materials', definition: 'The structured list of every component and quantity needed to build one unit of a product.' },
                { termKey: 'overall-equipment-effectiveness', definition: 'The composite measure of availability, performance and quality for production equipment.' },
                { termKey: 'root-cause-analysis', definition: 'The systematic investigation of a failure to find and eliminate its fundamental cause.' },
                { termKey: 'lean-manufacturing', definition: 'The practice of maximizing customer value while eliminating waste from production processes.' },
                { termKey: 'statistical-process-control', definition: 'The monitoring of process variation using control charts to keep output within limits.' },
                { termKey: 'tolerance', definition: 'The permitted deviation from a specified dimension or property that still allows function.' },
                { termKey: 'tooling', definition: 'The dedicated dies, molds, jigs and fixtures prepared to produce a specific part.' },
                { termKey: 'downtime', definition: 'Any period in which a production asset is unavailable for its planned use.' },
                { termKey: 'quality-inspection', definition: 'The examination of outputs against standards, accepting, rejecting or reworking units.' },
                { termKey: 'throughput', definition: 'The rate of finished units a process delivers per period.' },
        ],
        energy: [
                { termKey: 'grid', definition: 'The interconnected network carrying electricity from generation to end consumers.' },
                { termKey: 'baseload', definition: 'The continuous minimum demand level a power system must supply at all times.' },
                { termKey: 'capacity-factor', definition: 'The ratio of the energy actually produced over a period to the maximum possible at full rating.' },
                { termKey: 'demand-response', definition: 'Programs paying consumers to reduce load at peak times, shifting demand by agreement.' },
                { termKey: 'curtailment', definition: 'The deliberate reduction of renewable output when supply exceeds what the grid can absorb.' },
                { termKey: 'levelized-cost', definition: "The average cost per unit of energy over a project's life, discounted to present value." },
                { termKey: 'intermittency', definition: 'The variable, weather-driven availability of renewable generation, requiring backup or storage.' },
                { termKey: 'smart-meter', definition: 'The meter recording consumption in intervals and communicating readings to the utility.' },
                { termKey: 'megawatt-hour', definition: 'The energy unit equal to one megawatt sustained for one hour; the standard wholesale quantity.' },
                { termKey: 'net-metering', definition: "The arrangement crediting a customer's exported generation against consumed energy." },
        ],
        agriculture: [
                { termKey: 'crop-rotation', definition: 'The planned sequence of different crops on the same field to preserve soil and break pest cycles.' },
                { termKey: 'irrigation-scheduling', definition: 'The timing and quantity of water application matched to crop need, weather and soil moisture.' },
                { termKey: 'soil-fertility', definition: 'The capacity of a soil to supply nutrients and sustain plant growth.' },
                { termKey: 'integrated-pest-management', definition: 'The pest-control strategy combining monitoring, thresholds and minimal chemical intervention.' },
                { termKey: 'growing-season', definition: 'The annual window of temperature and moisture in which a crop can complete its cycle.' },
                { termKey: 'cover-crop', definition: 'A non-cash crop grown to protect and enrich the soil between main crops.' },
                { termKey: 'precision-agriculture', definition: 'The use of field data and variable-rate technology to manage crops site-specifically.' },
                { termKey: 'futures-contract', definition: 'The standardized exchange agreement to buy or sell a commodity at a set price and date.' },
                { termKey: 'soil-tillage', definition: 'The mechanical preparation of soil for seeding, affecting structure, moisture and erosion.' },
                { termKey: 'no-till', definition: 'The practice of seeding directly into undisturbed residue, protecting soil structure.' },
        ],
        government: [
                { termKey: 'public-consultation', definition: 'The formal process inviting citizens and stakeholders to comment on a proposed policy.' },
                { termKey: 'regulatory-impact-assessment', definition: 'The analysis of the costs, benefits and effects a proposed regulation would impose.' },
                { termKey: 'procurement', definition: 'The rules-bound process by which government purchases goods and services from the market.' },
                { termKey: 'case-work', definition: "The handling of individual citizens' requests and problems raised with their representatives." },
                { termKey: 'fiscal-transfer', definition: 'The flow of funds between levels of government under an agreed formula or program.' },
                { termKey: 'public-records-request', definition: "The citizen's lawful demand for access to documents held by government." },
                { termKey: 'notice-and-comment', definition: 'The rulemaking step that publishes a draft rule and considers public comments before finalizing.' },
                { termKey: 'sunset-clause', definition: 'The provision expiring a law or program on a set date unless affirmatively renewed.' },
                { termKey: 'mandate', definition: 'A duty assigned by a higher level of government, often with funding attached or absent.' },
        ],
        hospitality: [
                { termKey: 'occupancy-rate', definition: 'The share of available rooms or seats sold in a period; the core utilization measure.' },
                { termKey: 'average-daily-rate', definition: 'The mean revenue earned per occupied room per night.' },
                { termKey: 'revenue-per-available-room', definition: 'Revenue per available room, combining rate and occupancy into one yield measure.' },
                { termKey: 'check-in', definition: 'The arrival process registering a guest, assigning the room and opening the folio.' },
                { termKey: 'guest-folio', definition: "The running account of a guest's charges and payments, settled at departure." },
                { termKey: 'walk-in', definition: 'A guest arriving without a reservation, accommodated from unsold inventory.' },
                { termKey: 'overbooking', definition: 'Accepting more reservations than capacity, managing anticipated no-shows.' },
                { termKey: 'revenue-management', definition: 'The discipline of forecasting demand and dynamically pricing fixed, perishable inventory.' },
                { termKey: 'loyalty-tier', definition: 'The membership level within a program that grants graded privileges.' },
                { termKey: 'attrition-clause', definition: 'The contract term adjusting charges when a group event delivers fewer attendees than booked.' },
        ],
};

/**
 * The frozen per-industry relation registries: EXACTLY one entry for
 * each of the sixteen frozen HARNESS_INDUSTRIES members (the same
 * Record discipline as the catalogs). Each registry is an ordered
 * frozen array of TermRelation entries (2-6 relations per industry,
 * where natural); BOTH ends of every relation resolve in the SAME
 * industry's catalog; the reciprocity classes carry their inverses
 * (TERM_RELATION_INVERSE_TABLE); no self-relations; no duplicate
 * triples. The battery pins a clean integrity walk for every industry.
 */
export const INDUSTRY_TERM_RELATIONS: Readonly<Record<HarnessIndustry, readonly TermRelation[]>> = {
        software: [
                { fromTermKey: 'defect', relationClass: 'broader-than', toTermKey: 'regression' },
                { fromTermKey: 'regression', relationClass: 'narrower-than', toTermKey: 'defect' },
                { fromTermKey: 'refactoring', relationClass: 'related-to', toTermKey: 'technical-debt' },
                { fromTermKey: 'technical-debt', relationClass: 'related-to', toTermKey: 'refactoring' },
                { fromTermKey: 'unit-test', relationClass: 'part-of', toTermKey: 'continuous-integration' },
                { fromTermKey: 'code-review', relationClass: 'part-of', toTermKey: 'deployment-pipeline' },
        ],
        legal: [
                { fromTermKey: 'tort', relationClass: 'broader-than', toTermKey: 'negligence' },
                { fromTermKey: 'negligence', relationClass: 'narrower-than', toTermKey: 'tort' },
                { fromTermKey: 'precedent', relationClass: 'related-to', toTermKey: 'statute' },
                { fromTermKey: 'statute', relationClass: 'related-to', toTermKey: 'precedent' },
                { fromTermKey: 'legal-hold', relationClass: 'related-to', toTermKey: 'discovery' },
                { fromTermKey: 'discovery', relationClass: 'related-to', toTermKey: 'legal-hold' },
        ],
        finance: [
                { fromTermKey: 'asset', relationClass: 'related-to', toTermKey: 'liability' },
                { fromTermKey: 'liability', relationClass: 'related-to', toTermKey: 'asset' },
                { fromTermKey: 'balance-sheet', relationClass: 'related-to', toTermKey: 'cash-flow' },
                { fromTermKey: 'cash-flow', relationClass: 'related-to', toTermKey: 'balance-sheet' },
                { fromTermKey: 'reconciliation', relationClass: 'part-of', toTermKey: 'audit' },
                { fromTermKey: 'equity', relationClass: 'part-of', toTermKey: 'balance-sheet' },
        ],
        healthcare: [
                { fromTermKey: 'clinical-assessment', relationClass: 'broader-than', toTermKey: 'triage' },
                { fromTermKey: 'triage', relationClass: 'narrower-than', toTermKey: 'clinical-assessment' },
                { fromTermKey: 'discharge-summary', relationClass: 'part-of', toTermKey: 'patient-record' },
                { fromTermKey: 'contraindication', relationClass: 'related-to', toTermKey: 'adverse-event' },
                { fromTermKey: 'adverse-event', relationClass: 'related-to', toTermKey: 'contraindication' },
                { fromTermKey: 'differential-diagnosis', relationClass: 'part-of', toTermKey: 'clinical-assessment' },
        ],
        education: [
                { fromTermKey: 'assessment', relationClass: 'broader-than', toTermKey: 'formative-assessment' },
                { fromTermKey: 'formative-assessment', relationClass: 'narrower-than', toTermKey: 'assessment' },
                { fromTermKey: 'assessment', relationClass: 'broader-than', toTermKey: 'summative-assessment' },
                { fromTermKey: 'summative-assessment', relationClass: 'narrower-than', toTermKey: 'assessment' },
                { fromTermKey: 'syllabus', relationClass: 'part-of', toTermKey: 'curriculum' },
                { fromTermKey: 'rubric', relationClass: 'part-of', toTermKey: 'summative-assessment' },
        ],
        marketing: [
                { fromTermKey: 'lead', relationClass: 'part-of', toTermKey: 'funnel' },
                { fromTermKey: 'conversion-rate', relationClass: 'related-to', toTermKey: 'funnel' },
                { fromTermKey: 'funnel', relationClass: 'related-to', toTermKey: 'conversion-rate' },
                { fromTermKey: 'attribution', relationClass: 'related-to', toTermKey: 'conversion-rate' },
                { fromTermKey: 'conversion-rate', relationClass: 'related-to', toTermKey: 'attribution' },
                { fromTermKey: 'a-b-test', relationClass: 'part-of', toTermKey: 'campaign' },
        ],
        science: [
                { fromTermKey: 'replication', relationClass: 'related-to', toTermKey: 'reproducibility' },
                { fromTermKey: 'reproducibility', relationClass: 'related-to', toTermKey: 'replication' },
                { fromTermKey: 'preprint', relationClass: 'related-to', toTermKey: 'peer-review' },
                { fromTermKey: 'peer-review', relationClass: 'related-to', toTermKey: 'preprint' },
                { fromTermKey: 'control-group', relationClass: 'part-of', toTermKey: 'protocol' },
                { fromTermKey: 'hypothesis', relationClass: 'part-of', toTermKey: 'protocol' },
        ],
        media: [
                { fromTermKey: 'fact-checking', relationClass: 'part-of', toTermKey: 'newsroom' },
                { fromTermKey: 'correction', relationClass: 'related-to', toTermKey: 'fact-checking' },
                { fromTermKey: 'fact-checking', relationClass: 'related-to', toTermKey: 'correction' },
                { fromTermKey: 'embargo', relationClass: 'related-to', toTermKey: 'press-release' },
                { fromTermKey: 'press-release', relationClass: 'related-to', toTermKey: 'embargo' },
                { fromTermKey: 'editorial-calendar', relationClass: 'part-of', toTermKey: 'newsroom' },
        ],
        construction: [
                { fromTermKey: 'change-order', relationClass: 'related-to', toTermKey: 'as-built-drawing' },
                { fromTermKey: 'as-built-drawing', relationClass: 'related-to', toTermKey: 'change-order' },
                { fromTermKey: 'punch-list', relationClass: 'part-of', toTermKey: 'site-inspection' },
                { fromTermKey: 'blueprint', relationClass: 'related-to', toTermKey: 'specifications' },
                { fromTermKey: 'specifications', relationClass: 'related-to', toTermKey: 'blueprint' },
                { fromTermKey: 'site-inspection', relationClass: 'part-of', toTermKey: 'building-permit' },
        ],
        logistics: [
                { fromTermKey: 'last-mile-delivery', relationClass: 'part-of', toTermKey: 'order-fulfillment' },
                { fromTermKey: 'warehousing', relationClass: 'part-of', toTermKey: 'order-fulfillment' },
                { fromTermKey: 'freight-forwarder', relationClass: 'related-to', toTermKey: 'customs-clearance' },
                { fromTermKey: 'customs-clearance', relationClass: 'related-to', toTermKey: 'freight-forwarder' },
                { fromTermKey: 'route-optimization', relationClass: 'related-to', toTermKey: 'last-mile-delivery' },
                { fromTermKey: 'last-mile-delivery', relationClass: 'related-to', toTermKey: 'route-optimization' },
        ],
        retail: [
                { fromTermKey: 'markdown', relationClass: 'related-to', toTermKey: 'stockout' },
                { fromTermKey: 'stockout', relationClass: 'related-to', toTermKey: 'markdown' },
                { fromTermKey: 'private-label', relationClass: 'part-of', toTermKey: 'assortment' },
                { fromTermKey: 'inventory-count', relationClass: 'related-to', toTermKey: 'shrinkage' },
                { fromTermKey: 'shrinkage', relationClass: 'related-to', toTermKey: 'inventory-count' },
        ],
        manufacturing: [
                { fromTermKey: 'root-cause-analysis', relationClass: 'related-to', toTermKey: 'downtime' },
                { fromTermKey: 'downtime', relationClass: 'related-to', toTermKey: 'root-cause-analysis' },
                { fromTermKey: 'statistical-process-control', relationClass: 'part-of', toTermKey: 'quality-inspection' },
                { fromTermKey: 'tolerance', relationClass: 'related-to', toTermKey: 'statistical-process-control' },
                { fromTermKey: 'statistical-process-control', relationClass: 'related-to', toTermKey: 'tolerance' },
        ],
        energy: [
                { fromTermKey: 'curtailment', relationClass: 'related-to', toTermKey: 'intermittency' },
                { fromTermKey: 'intermittency', relationClass: 'related-to', toTermKey: 'curtailment' },
                { fromTermKey: 'intermittency', relationClass: 'related-to', toTermKey: 'capacity-factor' },
                { fromTermKey: 'capacity-factor', relationClass: 'related-to', toTermKey: 'intermittency' },
                { fromTermKey: 'smart-meter', relationClass: 'part-of', toTermKey: 'grid' },
        ],
        agriculture: [
                { fromTermKey: 'cover-crop', relationClass: 'part-of', toTermKey: 'crop-rotation' },
                { fromTermKey: 'no-till', relationClass: 'related-to', toTermKey: 'soil-tillage' },
                { fromTermKey: 'soil-tillage', relationClass: 'related-to', toTermKey: 'no-till' },
                { fromTermKey: 'cover-crop', relationClass: 'related-to', toTermKey: 'soil-fertility' },
                { fromTermKey: 'soil-fertility', relationClass: 'related-to', toTermKey: 'cover-crop' },
        ],
        government: [
                { fromTermKey: 'notice-and-comment', relationClass: 'related-to', toTermKey: 'public-consultation' },
                { fromTermKey: 'public-consultation', relationClass: 'related-to', toTermKey: 'notice-and-comment' },
                { fromTermKey: 'public-consultation', relationClass: 'part-of', toTermKey: 'regulatory-impact-assessment' },
                { fromTermKey: 'public-records-request', relationClass: 'related-to', toTermKey: 'procurement' },
                { fromTermKey: 'procurement', relationClass: 'related-to', toTermKey: 'public-records-request' },
                { fromTermKey: 'sunset-clause', relationClass: 'part-of', toTermKey: 'mandate' },
        ],
        hospitality: [
                { fromTermKey: 'occupancy-rate', relationClass: 'part-of', toTermKey: 'revenue-per-available-room' },
                { fromTermKey: 'average-daily-rate', relationClass: 'part-of', toTermKey: 'revenue-per-available-room' },
                { fromTermKey: 'overbooking', relationClass: 'related-to', toTermKey: 'walk-in' },
                { fromTermKey: 'walk-in', relationClass: 'related-to', toTermKey: 'overbooking' },
                { fromTermKey: 'revenue-management', relationClass: 'related-to', toTermKey: 'overbooking' },
                { fromTermKey: 'overbooking', relationClass: 'related-to', toTermKey: 'revenue-management' },
        ],
};

// --- the serialization envelope ---

/** The frozen per-industry ontology envelope schema keys, in the canonical fixed-key-order (the serialization order). */
export const INDUSTRY_ONTOLOGY_SCHEMA_KEYS = ['contractVersion', 'industry', 'terms', 'relations'] as const;

/**
 * The serialization unit: one industry's frozen ontology - the contract
 * version (THE SINGLE-VERSION LAW's live station on this surface), the
 * industry (one REAL HARNESS_INDUSTRIES member), the term catalog and
 * the relation registry. The canonical serialization emits these four
 * keys in this exact order; the fail-closed parse rejects every key
 * outside the schema.
 */
export interface IndustryOntology {
        readonly contractVersion: string;
        readonly industry: HarnessIndustry;
        readonly terms: readonly DomainTerm[];
        readonly relations: readonly TermRelation[];
}

// --- the rejection vocabulary (THE FAIL-CLOSED LAW) ---

/**
 * Closed frozen list of ontology validation rejection reasons, in the
 * exact walk order (the work order's sixteen stations verbatim; the
 * validation walks report the FIRST violated station in this order,
 * with items naming EVERY offender at that station):
 *   malformed-record         - the candidate is not a plain object, an
 *                              envelope carrier (terms / relations) is
 *                              not an array, or a term entry or term
 *                              carrier carries the wrong structural
 *                              type;
 *   no-fork                  - THE NO-FORK LAW's shape station: an
 *                              extra key on a term entry or a relation
 *                              entry (a term is termKey + definition
 *                              ONLY; a relation is fromTermKey +
 *                              relationClass + toTermKey ONLY; a term
 *                              MAY carry relations ONLY via the
 *                              registry, never inline);
 *   unknown-key              - a key outside the frozen four-key
 *                              envelope schema (the strict-schema
 *                              engine; the entry-level extras fired as
 *                              no-fork first, per the DH-01 precedence
 *                              law);
 *   missing-key              - an absent envelope key, or an absent
 *                              termKey / definition on a term entry,
 *                              or an absent fromTermKey / relationClass
 *                              / toTermKey on a relation entry (the
 *                              DH-01 absent-key discipline: an absent
 *                              key is never a structural station);
 *   unknown-industry         - THE REAL-VOCABULARY LAW: the industry
 *                              is not a member of the DH-01 list
 *                              (imported by reference);
 *   invalid-term-key         - a present termKey is empty, longer than
 *                              64 characters, or not kebab-case
 *                              (lowercase alphanumeric segments joined
 *                              by single hyphens);
 *   invalid-definition       - a present definition is empty, longer
 *                              than 300 characters, or carries control
 *                              characters (C0/DEL/C1);
 *   duplicate-term-keys      - termKeys are not unique within the
 *                              catalog;
 *   malformed-relation       - a relation entry is not a plain object,
 *                              or a fromTermKey / relationClass /
 *                              toTermKey carrier is absent or not a
 *                              string (in the standalone integrity
 *                              walk an absent carrier is this station;
 *                              the deep walk reports absences at
 *                              missing-key first);
 *   unknown-relation-class   - a present relationClass is not a member
 *                              of the frozen TERM_RELATION_CLASSES
 *                              list (THE FROZEN-CATALOG LAW);
 *   unknown-term-ref         - THE INTEGRITY LAW: a relation end does
 *                              not resolve in the same industry's
 *                              catalog (and, at the kit layer, a
 *                              lookup / term-set key that resolves to
 *                              no term - a malformed key fails closed
 *                              as unknown);
 *   self-relation            - a relation's fromTermKey and toTermKey
 *                              are the same key (a term is never
 *                              related to itself);
 *   duplicate-relation       - the exact fromTermKey + relationClass +
 *                              toTermKey triple carries repeats;
 *   missing-inverse-relation - THE INTEGRITY LAW's reciprocity: a
 *                              relation whose class demands an inverse
 *                              (TERM_RELATION_INVERSE_TABLE) is
 *                              missing that inverse triple;
 *   version-mismatch         - THE SINGLE-VERSION LAW: the envelope's
 *                              contractVersion is not
 *                              ONTOLOGY_CONTRACTS_VERSION;
 *   empty-catalog            - the terms array is empty (a catalog is
 *                              a non-empty ordered frozen array).
 * Widening or reordering the list is a versioned contract decision.
 */
export const ONTOLOGY_VALIDATION_REJECTION_REASONS = [
        'malformed-record',
        'no-fork',
        'unknown-key',
        'missing-key',
        'unknown-industry',
        'invalid-term-key',
        'invalid-definition',
        'duplicate-term-keys',
        'malformed-relation',
        'unknown-relation-class',
        'unknown-term-ref',
        'self-relation',
        'duplicate-relation',
        'missing-inverse-relation',
        'version-mismatch',
        'empty-catalog',
] as const;
export type OntologyRejectionReason = (typeof ONTOLOGY_VALIDATION_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isOntologyRejectionReason(value: unknown): value is OntologyRejectionReason {
        return (ONTOLOGY_VALIDATION_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed refusal from a validation walk (THE FAIL-CLOSED LAW, the
 * work order's shape): the frozen reason, the violated law's name, the
 * deterministic message sentence, and - when offenders exist - every
 * offending item (never first-offender-only at the reporting station).
 * NEVER a string throw, NEVER a silent skip.
 */
export interface OntologyRejection {
        readonly reason: OntologyRejectionReason;
        readonly law: string;
        readonly message: string;
        readonly items?: readonly string[];
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * work order's single-refusal shape): ok carries the canonical value;
 * refusal carries the typed record naming the FIRST violated station
 * in the frozen walk order (a disclosed divergence from the landed
 * siblings' complete rejection tables - the work order's refusal
 * shape left no room for a table; the items field carries every
 * offender at the reporting station).
 */
export type OntologyValidationOutcome<T> =
        | { readonly ok: true; readonly value: T }
        | { readonly ok: false; readonly refusal: OntologyRejection };

/** The relation-integrity finding reasons: the six relation-family stations of the frozen list. */
export type RelationIntegrityFindingReason = Extract<
        OntologyRejectionReason,
        'malformed-relation' | 'unknown-relation-class' | 'unknown-term-ref' | 'self-relation' | 'duplicate-relation' | 'missing-inverse-relation'
>;

/**
 * One finding from the relation-integrity walk: the frozen reason, the
 * violated law's name, the deterministic message sentence and the
 * offending items. The walk is a typed REPORT (never a throw, never a
 * refusal) - the findings array is the honest record.
 */
export interface RelationIntegrityFinding {
        readonly reason: RelationIntegrityFindingReason;
        readonly law: string;
        readonly message: string;
        readonly items: readonly string[];
}

// --- the pure validators (THE FAIL-CLOSED LAW's walk machines) ---

/**
 * The single-term station walk (pure): malformed-record (the record
 * and its carriers) -> no-fork (any additional key) -> missing-key
 * (an absent termKey / definition) -> invalid-term-key ->
 * invalid-definition, the first violated station in the frozen order
 * with every offender at that station in items. Ok carries the
 * canonical { termKey, definition } copy.
 */
export function validateDomainTerm(term: unknown): OntologyValidationOutcome<DomainTerm> {
        if (!isRecord(term)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-record',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['term'],
                                message: 'validateDomainTerm: every domain term must be a plain object of exactly { termKey, definition } (a term is reference-only vocabulary - it grants NOTHING by itself)',
                        },
                };
        }
        const record = term as Record<string, unknown>;
        // station 1 (malformed-record): the carriers - a PRESENT-but-non-string carrier; an absent key is station 3's missing-key (the DH-01 absent-key discipline).
        const carrierViolations: string[] = [];
        if (hasOwn(record, 'termKey') && typeof record.termKey !== 'string') {
                carrierViolations.push('termKey');
        }
        if (hasOwn(record, 'definition') && typeof record.definition !== 'string') {
                carrierViolations.push('definition');
        }
        if (carrierViolations.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-record',
                                law: 'THE FAIL-CLOSED LAW',
                                items: carrierViolations,
                                message: `validateDomainTerm: the carrier(s) ${showList(carrierViolations)} must be strings (a term is a termKey plus a human definition)`,
                        },
                };
        }
        // station 2 (no-fork): THE NO-FORK LAW's shape station - any additional key.
        const extraKeys = Object.keys(record).filter((key) => !(DOMAIN_TERM_SCHEMA_KEYS as readonly string[]).includes(key));
        if (extraKeys.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: extraKeys,
                                message: `validateDomainTerm: a term is termKey + definition ONLY (reference-only configuration - it grants NOTHING by itself); the extra key(s) ${showList(extraKeys)} are rejected (a term MAY carry relations ONLY via the industry's relation registry, never inline)`,
                        },
                };
        }
        // station 3 (missing-key): the strict two-key schema requires both keys.
        const missingKeys = (DOMAIN_TERM_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
        if (missingKeys.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'missing-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: missingKeys,
                                message: `validateDomainTerm: the term schema requires both keys - the key(s) ${showList(missingKeys)} are missing`,
                        },
                };
        }
        // stations 4-5 (invalid-term-key / invalid-definition): PRESENT-but-invalid values.
        const keyViolations = termKeyViolationsOf(record.termKey as string);
        if (keyViolations.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'invalid-term-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: keyViolations,
                                message: `validateDomainTerm: the termKey must be a non-empty kebab-case identifier of at most ${TERM_KEY_MAX_LENGTH} characters (lowercase alphanumeric segments joined by single hyphens)`,
                        },
                };
        }
        const definitionViolations = definitionViolationsOf(record.definition as string);
        if (definitionViolations.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'invalid-definition',
                                law: 'THE FAIL-CLOSED LAW',
                                items: definitionViolations,
                                message: `validateDomainTerm: the definition must be a non-empty human string of at most ${TERM_DEFINITION_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
                        },
                };
        }
        return { ok: true, value: { termKey: record.termKey as string, definition: record.definition as string } };
}

/**
 * The single-relation station walk (pure, shape only - no catalog
 * context): malformed-relation (the record and its carriers; in this
 * standalone walk an absent carrier is the structural station) ->
 * no-fork (any additional key) -> missing-key (an absent carrier,
 * never reached here - the absent check fires malformed-relation
 * first in this walk; the distinction is documented in the README
 * SPEC) -> unknown-relation-class. Ok carries the canonical
 * { fromTermKey, relationClass, toTermKey } copy.
 */
export function validateTermRelation(relation: unknown): OntologyValidationOutcome<TermRelation> {
        if (!isRecord(relation)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-relation',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['relation'],
                                message: 'validateTermRelation: every term relation must be a plain object of exactly { fromTermKey, relationClass, toTermKey } (the registry is the ONLY place a relation lives)',
                        },
                };
        }
        const record = relation as Record<string, unknown>;
        // station 1 (malformed-relation): the carriers - absent or non-string in this standalone walk.
        const carrierViolations: string[] = [];
        for (const key of TERM_RELATION_SCHEMA_KEYS) {
                if (!hasOwn(record, key) || typeof record[key] !== 'string') {
                        carrierViolations.push(key);
                }
        }
        if (carrierViolations.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-relation',
                                law: 'THE FAIL-CLOSED LAW',
                                items: carrierViolations,
                                message: `validateTermRelation: the carrier(s) ${showList(carrierViolations)} must be strings (a relation names its two ends and its class)`,
                        },
                };
        }
        // station 2 (no-fork): THE NO-FORK LAW's shape station - any additional key.
        const extraKeys = Object.keys(record).filter((key) => !(TERM_RELATION_SCHEMA_KEYS as readonly string[]).includes(key));
        if (extraKeys.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: extraKeys,
                                message: `validateTermRelation: a relation is fromTermKey + relationClass + toTermKey ONLY; the extra key(s) ${showList(extraKeys)} are rejected (the registry is reference-only configuration)`,
                        },
                };
        }
        // station 3 (unknown-relation-class): the frozen class vocabulary.
        if (!isTermRelationClass(record.relationClass)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'unknown-relation-class',
                                law: 'THE FROZEN-CATALOG LAW',
                                items: [showValue(record.relationClass)],
                                message: 'validateTermRelation: the relationClass must be a member of the frozen TERM_RELATION_CLASSES list (broader-than / narrower-than / related-to / part-of)',
                        },
                };
        }
        return {
                ok: true,
                value: {
                        fromTermKey: record.fromTermKey as string,
                        relationClass: record.relationClass as TermRelationClass,
                        toTermKey: record.toTermKey as string,
                },
        };
}

/** The triple rendering of a relation (the duplicate / inverse item grammar). */
function tripleOf(relation: TermRelation): string {
        return `${relation.fromTermKey} ${relation.relationClass} ${relation.toTermKey}`;
}

/**
 * THE INTEGRITY LAW's walk machine (pure, never a throw): the six
 * relation-family stations of the frozen walk order, each reporting
 * EVERY offender at that station as one finding - malformed-relation
 * -> unknown-relation-class -> unknown-term-ref -> self-relation ->
 * duplicate-relation -> missing-inverse-relation. The catalog is the
 * resolution context (typed DomainTerm entries); the relations
 * carrier is walked as unknown (the walk checks its own shapes).
 * Returns the findings array in the frozen station order - the typed
 * REPORT the kit's relationIntegrityReport wraps (clean when empty);
 * the deep envelope walk maps the first finding to its refusal.
 */
export function walkRelationIntegrity(catalog: readonly DomainTerm[], relations: readonly unknown[]): readonly RelationIntegrityFinding[] {
        const termKeys = new Set(catalog.map((term) => term.termKey));
        const wellFormed: TermRelation[] = [];
        const malformed: string[] = [];
        const unknownClasses: string[] = [];
        for (let i = 0; i < relations.length; i += 1) {
                const relation = relations[i];
                if (!isRecord(relation)) {
                        malformed.push(`relations[${i}]`);
                        continue;
                }
                const record = relation as Record<string, unknown>;
                let structurallySound = true;
                for (const key of TERM_RELATION_SCHEMA_KEYS) {
                        if (!hasOwn(record, key) || typeof record[key] !== 'string') {
                                malformed.push(`relations[${i}].${key}`);
                                structurallySound = false;
                        }
                }
                if (!structurallySound) {
                        continue;
                }
                const typed: TermRelation = {
                        fromTermKey: record.fromTermKey as string,
                        relationClass: record.relationClass as TermRelationClass,
                        toTermKey: record.toTermKey as string,
                };
                if (!isTermRelationClass(typed.relationClass)) {
                        unknownClasses.push(`relations[${i}]:${typed.relationClass}`);
                        continue;
                }
                wellFormed.push(typed);
        }
        const findings: RelationIntegrityFinding[] = [];
        if (malformed.length > 0) {
                findings.push({
                        reason: 'malformed-relation',
                        law: 'THE FAIL-CLOSED LAW',
                        message: `walkRelationIntegrity: the relation carrier(s) ${showList(malformed)} must be plain objects of string fromTermKey / relationClass / toTermKey (in this standalone walk an absent carrier is the structural station)`,
                        items: malformed,
                });
        }
        if (unknownClasses.length > 0) {
                findings.push({
                        reason: 'unknown-relation-class',
                        law: 'THE FROZEN-CATALOG LAW',
                        message: `walkRelationIntegrity: the relationClass of ${showList(unknownClasses)} is not a member of the frozen TERM_RELATION_CLASSES list`,
                        items: unknownClasses,
                });
        }
        const unresolved: string[] = [];
        for (let i = 0; i < wellFormed.length; i += 1) {
                const relation = wellFormed[i];
                if (!termKeys.has(relation.fromTermKey)) {
                        unresolved.push(`relations[${i}]:fromTermKey=${relation.fromTermKey}`);
                }
                if (!termKeys.has(relation.toTermKey)) {
                        unresolved.push(`relations[${i}]:toTermKey=${relation.toTermKey}`);
                }
        }
        if (unresolved.length > 0) {
                findings.push({
                        reason: 'unknown-term-ref',
                        law: 'THE INTEGRITY LAW',
                        message: `walkRelationIntegrity: both ends of every relation must resolve in the same industry's catalog - the offender(s) ${showList(unresolved)} do not resolve`,
                        items: unresolved,
                });
        }
        const selfRelations: string[] = [];
        for (let i = 0; i < wellFormed.length; i += 1) {
                const relation = wellFormed[i];
                if (relation.fromTermKey === relation.toTermKey) {
                        selfRelations.push(`relations[${i}]:${relation.fromTermKey}`);
                }
        }
        if (selfRelations.length > 0) {
                findings.push({
                        reason: 'self-relation',
                        law: 'THE INTEGRITY LAW',
                        message: `walkRelationIntegrity: a term is never related to itself - the offender(s) ${showList(selfRelations)} carry fromTermKey === toTermKey`,
                        items: selfRelations,
                });
        }
        const duplicateTriples = findDuplicates(wellFormed.map((relation) => tripleOf(relation)));
        if (duplicateTriples.length > 0) {
                findings.push({
                        reason: 'duplicate-relation',
                        law: 'THE INTEGRITY LAW',
                        message: `walkRelationIntegrity: every relation triple appears once - the duplicate(s) ${showList(duplicateTriples)} carry repeats`,
                        items: duplicateTriples,
                });
        }
        const presentTriples = new Set(wellFormed.map((relation) => tripleOf(relation)));
        const missingInverses: string[] = [];
        for (const relation of wellFormed) {
                const inverseClass = inverseRelationClassOf(relation.relationClass);
                if (inverseClass === null) {
                        // part-of demands NO inverse (one-directional containment - the reciprocity table's null row).
                        continue;
                }
                const inverseTriple = `${relation.toTermKey} ${inverseClass} ${relation.fromTermKey}`;
                if (!presentTriples.has(inverseTriple)) {
                        missingInverses.push(`expected ${inverseTriple}`);
                }
        }
        if (missingInverses.length > 0) {
                findings.push({
                        reason: 'missing-inverse-relation',
                        law: 'THE INTEGRITY LAW',
                        message: `walkRelationIntegrity: the reciprocity classes carry their inverses (TERM_RELATION_INVERSE_TABLE) - the inverse(s) ${showList(missingInverses)} are absent from the registry`,
                        items: missingInverses,
                });
        }
        return findings;
}

/**
 * The deep envelope walk (pure): the strict four-key
 * { contractVersion, industry, terms, relations } walk over the
 * serialization unit, the FIRST violated station in the frozen
 * ONTOLOGY_VALIDATION_REJECTION_REASONS order with every offender at
 * that station in items. Ok carries the canonical fixed-key-order
 * copy. The relation-family stations (9-14) delegate to
 * walkRelationIntegrity (the first finding mapped to its refusal).
 */
export function validateIndustryOntology(value: unknown): OntologyValidationOutcome<IndustryOntology> {
        if (!isRecord(value)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-record',
                                law: 'THE FAIL-CLOSED LAW',
                                items: ['ontology'],
                                message: 'validateIndustryOntology: the industry-ontology envelope must be a plain object of exactly { contractVersion, industry, terms, relations }',
                        },
                };
        }
        const record = value as Record<string, unknown>;

        // station 1 (malformed-record): the envelope and term carriers (the relation carriers are station 9's malformed-relation).
        const structural: string[] = [];
        if (hasOwn(record, 'terms') && !Array.isArray(record.terms)) {
                structural.push('terms');
        }
        if (hasOwn(record, 'relations') && !Array.isArray(record.relations)) {
                structural.push('relations');
        }
        const terms = Array.isArray(record.terms) ? (record.terms as unknown[]) : null;
        if (terms !== null) {
                for (let i = 0; i < terms.length; i += 1) {
                        const term = terms[i];
                        if (!isRecord(term)) {
                                structural.push(`terms[${i}]`);
                                continue;
                        }
                        const entry = term as Record<string, unknown>;
                        for (const key of DOMAIN_TERM_SCHEMA_KEYS) {
                                if (hasOwn(entry, key) && typeof entry[key] !== 'string') {
                                        structural.push(`terms[${i}].${key}`);
                                }
                        }
                }
        }
        if (structural.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'malformed-record',
                                law: 'THE FAIL-CLOSED LAW',
                                items: structural,
                                message: `validateIndustryOntology: a field carries the wrong structural type - the offender(s) ${showList(structural)} (the terms / relations carriers must be arrays; a term entry must be a plain object of string termKey / definition; never a silent partial verdict)`,
                        },
                };
        }

        // station 2 (no-fork): extra keys on term entries and relation entries (THE NO-FORK LAW's shape station; terms before relations).
        const noFork: string[] = [];
        if (terms !== null) {
                for (let i = 0; i < terms.length; i += 1) {
                        const term = terms[i];
                        if (isRecord(term)) {
                                for (const key of Object.keys(term as Record<string, unknown>)) {
                                        if (!(DOMAIN_TERM_SCHEMA_KEYS as readonly string[]).includes(key)) {
                                                noFork.push(`terms[${i}]:${key}`);
                                        }
                                }
                        }
                }
        }
        const relations = Array.isArray(record.relations) ? (record.relations as unknown[]) : null;
        if (relations !== null) {
                for (let i = 0; i < relations.length; i += 1) {
                        const relation = relations[i];
                        if (isRecord(relation)) {
                                for (const key of Object.keys(relation as Record<string, unknown>)) {
                                        if (!(TERM_RELATION_SCHEMA_KEYS as readonly string[]).includes(key)) {
                                                noFork.push(`relations[${i}]:${key}`);
                                        }
                                }
                        }
                }
        }
        if (noFork.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'no-fork',
                                law: 'THE NO-FORK LAW',
                                items: noFork,
                                message: `validateIndustryOntology: a term is termKey + definition ONLY and a relation is fromTermKey + relationClass + toTermKey ONLY - the extra key(s) ${showList(noFork)} are execution material and cannot appear (relations live in the registry, never inline on a term)`,
                        },
                };
        }

        // station 3 (unknown-key): the strict four-key envelope schema is closed.
        const unknownKeys = Object.keys(record).filter((key) => !(INDUSTRY_ONTOLOGY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownKeys.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'unknown-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: unknownKeys,
                                message: `validateIndustryOntology: the envelope schema is closed (contractVersion / industry / terms / relations) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
                        },
                };
        }

        // station 4 (missing-key): every required key, envelope AND entries (an absent key is never a structural station - the DH-01 absent-key discipline; a NON-RECORD entry is its structural station's business, never a cascade here).
        const missing: string[] = [];
        for (const key of INDUSTRY_ONTOLOGY_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        missing.push(key);
                }
        }
        if (terms !== null) {
                for (let i = 0; i < terms.length; i += 1) {
                        const term = terms[i];
                        if (!isRecord(term)) {
                                continue;
                        }
                        for (const key of DOMAIN_TERM_SCHEMA_KEYS) {
                                if (!hasOwn(term, key)) {
                                        missing.push(`terms[${i}].${key}`);
                                }
                        }
                }
        }
        if (relations !== null) {
                for (let i = 0; i < relations.length; i += 1) {
                        const relation = relations[i];
                        if (!isRecord(relation)) {
                                continue;
                        }
                        for (const key of TERM_RELATION_SCHEMA_KEYS) {
                                if (!hasOwn(relation, key)) {
                                        missing.push(`relations[${i}].${key}`);
                                }
                        }
                }
        }
        if (missing.length > 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'missing-key',
                                law: 'THE FAIL-CLOSED LAW',
                                items: missing,
                                message: `validateIndustryOntology: the schema requires every key - the key(s) ${showList(missing)} are missing`,
                        },
                };
        }

        // station 5 (unknown-industry): THE REAL-VOCABULARY LAW against the REAL import.
        if (!isHarnessIndustry(record.industry)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'unknown-industry',
                                law: 'THE REAL-VOCABULARY LAW',
                                items: [showValue(record.industry)],
                                message: 'validateIndustryOntology: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (never re-declared)',
                        },
                };
        }
        const industry = record.industry as HarnessIndustry;

        // stations 6-8 (the term family laws), only walkable when the carrier is an array.
        if (terms !== null) {
                const invalidTermKeys: string[] = [];
                const invalidDefinitions: string[] = [];
                const termKeyList: string[] = [];
                for (let i = 0; i < terms.length; i += 1) {
                        const term = terms[i] as Record<string, unknown>;
                        const keyViolations = termKeyViolationsOf(term.termKey as string);
                        if (keyViolations.length > 0) {
                                invalidTermKeys.push(...keyViolations.map((violation) => `terms[${i}]:${violation}`));
                        }
                        const definitionViolations = definitionViolationsOf(term.definition as string);
                        if (definitionViolations.length > 0) {
                                invalidDefinitions.push(...definitionViolations.map((violation) => `terms[${i}]:${violation}`));
                        }
                        termKeyList.push(term.termKey as string);
                }
                if (invalidTermKeys.length > 0) {
                        return {
                                ok: false,
                                refusal: {
                                        reason: 'invalid-term-key',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: invalidTermKeys,
                                        message: `validateIndustryOntology: the termKey must be a non-empty kebab-case identifier of at most ${TERM_KEY_MAX_LENGTH} characters - the offender(s) ${showList(invalidTermKeys)}`,
                                },
                        };
                }
                if (invalidDefinitions.length > 0) {
                        return {
                                ok: false,
                                refusal: {
                                        reason: 'invalid-definition',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: invalidDefinitions,
                                        message: `validateIndustryOntology: the definition must be a non-empty human string of at most ${TERM_DEFINITION_MAX_LENGTH} characters with no control characters - the offender(s) ${showList(invalidDefinitions)}`,
                                },
                        };
                }
                const duplicateTermKeys = findDuplicates(termKeyList);
                if (duplicateTermKeys.length > 0) {
                        return {
                                ok: false,
                                refusal: {
                                        reason: 'duplicate-term-keys',
                                        law: 'THE FAIL-CLOSED LAW',
                                        items: duplicateTermKeys,
                                        message: 'validateIndustryOntology: termKeys must be unique within the catalog (a term appears once)',
                                },
                        };
                }
        }

        // stations 9-14 (the relation family laws): the integrity walk's first finding, in the frozen station order.
        if (relations !== null && terms !== null) {
                const validatedTerms = terms.map(
                        (term) => ({ termKey: (term as Record<string, unknown>).termKey as string, definition: (term as Record<string, unknown>).definition as string }),
                );
                const findings = walkRelationIntegrity(validatedTerms, relations);
                if (findings.length > 0) {
                        const first = findings[0];
                        return {
                                ok: false,
                                refusal: {
                                        reason: first.reason,
                                        law: first.law,
                                        items: [...first.items],
                                        message: first.message,
                                },
                        };
                }
        }

        // station 15 (version-mismatch): THE SINGLE-VERSION LAW's live station on this surface.
        if (hasOwn(record, 'contractVersion') && record.contractVersion !== ONTOLOGY_CONTRACTS_VERSION) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'version-mismatch',
                                law: 'THE SINGLE-VERSION LAW',
                                items: [showValue(record.contractVersion)],
                                message: `validateIndustryOntology: the envelope's contractVersion must be ONTOLOGY_CONTRACTS_VERSION ('${ONTOLOGY_CONTRACTS_VERSION}')`,
                        },
                };
        }

        // station 16 (empty-catalog): a catalog is a non-empty ordered frozen array.
        if (terms !== null && terms.length === 0) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'empty-catalog',
                                law: 'THE FROZEN-CATALOG LAW',
                                items: ['terms'],
                                message: 'validateIndustryOntology: the term catalog is a non-empty ordered frozen array (an empty catalog is not a vocabulary)',
                        },
                };
        }

        return { ok: true, value: canonicalIndustryOntology(record as unknown as IndustryOntology) };
}

/**
 * Builds the canonical serialization envelope of one industry's FROZEN
 * ontology (pure): the contract version, the industry, and the frozen
 * catalog + registry BY REFERENCE (the battery pins the identity). An
 * industry outside the frozen sixteen is the typed unknown-industry
 * refusal (THE REAL-VOCABULARY LAW).
 */
export function buildIndustryOntologyEnvelope(industry: unknown): OntologyValidationOutcome<IndustryOntology> {
        if (!isHarnessIndustry(industry)) {
                return {
                        ok: false,
                        refusal: {
                                reason: 'unknown-industry',
                                law: 'THE REAL-VOCABULARY LAW',
                                items: [showValue(industry)],
                                message: 'buildIndustryOntologyEnvelope: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract',
                        },
                };
        }
        return {
                ok: true,
                value: {
                        contractVersion: ONTOLOGY_CONTRACTS_VERSION,
                        industry,
                        terms: INDUSTRY_TERM_CATALOGS[industry],
                        relations: INDUSTRY_TERM_RELATIONS[industry],
                },
        };
}

/** Pure deep shape guard: a well-formed industry ontology (the deep walk above, green). */
export function isIndustryOntology(value: unknown): value is IndustryOntology {
        return validateIndustryOntology(value).ok;
}

/** Pure deep shape guard: a well-formed domain term (the term walk above, green). */
export function isDomainTerm(value: unknown): value is DomainTerm {
        return validateDomainTerm(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of an
 * industry ontology (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The envelope keys emit in the
 * INDUSTRY_ONTOLOGY_SCHEMA_KEYS order, the term entries in the
 * termKey, definition order, and the relation entries in the
 * fromTermKey, relationClass, toTermKey order. Throws TypeError on a
 * malformed record (never dishonest bytes).
 */
export function serializeIndustryOntology(record: unknown): string {
        if (!isIndustryOntology(record)) {
                throw new TypeError(
                        'serializeIndustryOntology: record must satisfy isIndustryOntology - no dishonest industry ontology ever gets canonical bytes',
                );
        }
        return JSON.stringify(canonicalOntologyObject(record));
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
 *   unknown-contract-version - the envelope's contractVersion is not
 *                              ONTOLOGY_CONTRACTS_VERSION (THE
 *                              SINGLE-VERSION LAW's live station on
 *                              this surface);
 *   unknown-key              - an extra key at the envelope, term or
 *                              relation level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const ONTOLOGY_PARSE_REJECTION_REASONS = [
        'malformed-json',
        'torn-envelope',
        'unknown-contract-version',
        'unknown-key',
        'invalid-record',
] as const;
export type OntologyParseRejectionReason = (typeof ONTOLOGY_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isOntologyParseRejectionReason(value: unknown): value is OntologyParseRejectionReason {
        return (ONTOLOGY_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface OntologyParseRejection {
        readonly reason: OntologyParseRejectionReason;
        readonly detail: string;
}

/** The typed parse outcome: ok carries the validated ontology; failure names the drift. */
export type OntologyParseOutcome =
        | { readonly ok: true; readonly ontology: IndustryOntology }
        | { readonly ok: false; readonly rejection: OntologyParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown contract version, an unknown key
 * (envelope / term / relation level), or invalid content (the deep
 * walk) - each a typed rejection naming the drift; never a silent
 * partial parse. First-failure-is-the-verdict, in the frozen
 * ONTOLOGY_PARSE_REJECTION_REASONS order.
 */
export function parseIndustryOntology(bytes: unknown): OntologyParseOutcome {
        if (typeof bytes !== 'string') {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseIndustryOntology: bytes must be a string (the canonical fixed-key-order ontology bytes)',
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
                                detail: `parseIndustryOntology: the bytes are not valid JSON: ${toMessage(error)}`,
                        },
                };
        }
        if (!isRecord(parsed)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseIndustryOntology: the bytes must carry a JSON object (the industry-ontology envelope)',
                        },
                };
        }
        const record = parsed as Record<string, unknown>;
        for (const key of INDUSTRY_ONTOLOGY_SCHEMA_KEYS) {
                if (!hasOwn(record, key)) {
                        return {
                                ok: false,
                                rejection: {
                                        reason: 'torn-envelope',
                                        detail: `parseIndustryOntology: the '${key}' key is missing (a torn write - never a silent partial parse)`,
                                },
                        };
                }
        }
        if (typeof record.contractVersion !== 'string' || typeof record.industry !== 'string' || !Array.isArray(record.terms) || !Array.isArray(record.relations)) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'torn-envelope',
                                detail: 'parseIndustryOntology: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
                        },
                };
        }
        if (record.contractVersion !== ONTOLOGY_CONTRACTS_VERSION) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-contract-version',
                                detail: `parseIndustryOntology: the contractVersion '${showValue(record.contractVersion)}' is not ONTOLOGY_CONTRACTS_VERSION ('${ONTOLOGY_CONTRACTS_VERSION}') - THE SINGLE-VERSION LAW`,
                        },
                };
        }
        const unknownRecordKeys = Object.keys(record).filter((key) => !(INDUSTRY_ONTOLOGY_SCHEMA_KEYS as readonly string[]).includes(key));
        if (unknownRecordKeys.length > 0) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'unknown-key',
                                detail: `parseIndustryOntology: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict four-key envelope schema is closed)`,
                        },
                };
        }
        const terms = record.terms as unknown[];
        for (let i = 0; i < terms.length; i += 1) {
                const term = terms[i];
                if (isRecord(term)) {
                        const extraTermKeys = Object.keys(term as Record<string, unknown>).filter((key) => !(DOMAIN_TERM_SCHEMA_KEYS as readonly string[]).includes(key));
                        if (extraTermKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseIndustryOntology: the term entry terms[${i}] carries the unknown key '${extraTermKeys[0]}' (a term is termKey + definition only)`,
                                        },
                                };
                        }
                }
        }
        const relations = record.relations as unknown[];
        for (let i = 0; i < relations.length; i += 1) {
                const relation = relations[i];
                if (isRecord(relation)) {
                        const extraRelationKeys = Object.keys(relation as Record<string, unknown>).filter(
                                (key) => !(TERM_RELATION_SCHEMA_KEYS as readonly string[]).includes(key),
                        );
                        if (extraRelationKeys.length > 0) {
                                return {
                                        ok: false,
                                        rejection: {
                                                reason: 'unknown-key',
                                                detail: `parseIndustryOntology: the relation entry relations[${i}] carries the unknown key '${extraRelationKeys[0]}' (a relation is fromTermKey + relationClass + toTermKey only)`,
                                        },
                                };
                        }
                }
        }
        const deep = validateIndustryOntology(parsed);
        if (!deep.ok) {
                return {
                        ok: false,
                        rejection: {
                                reason: 'invalid-record',
                                detail: `parseIndustryOntology: the parsed record fails the deep ontology walk (${deep.refusal.reason} - ${deep.refusal.message}; never a silent partial parse)`,
                        },
                };
        }
        return { ok: true, ontology: deep.value };
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

/** The distinct control characters of a string (C0, DEL and C1), as U+XXXX codes in first-seen order. */
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

/** The termKey law violations (empty, over-length, not kebab-case), as deterministic item strings. */
function termKeyViolationsOf(termKey: string): string[] {
        const violations: string[] = [];
        if (termKey.length === 0) {
                violations.push('empty');
        }
        if (termKey.length > TERM_KEY_MAX_LENGTH) {
                violations.push(`${termKey.length} chars`);
        }
        if (termKey.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(termKey)) {
                violations.push('not kebab-case');
        }
        return violations;
}

/** The definition law violations (empty, over-length, control characters), as deterministic item strings. */
function definitionViolationsOf(definition: string): string[] {
        const violations: string[] = [];
        if (definition.length === 0) {
                violations.push('empty');
        }
        if (definition.length > TERM_DEFINITION_MAX_LENGTH) {
                violations.push(`${definition.length} chars`);
        }
        const controls = controlCharactersOf(definition);
        if (controls.length > 0) {
                violations.push(...controls);
        }
        return violations;
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

/** Builds the canonical fixed-key-order copy of a validated industry ontology. */
function canonicalIndustryOntology(record: IndustryOntology): IndustryOntology {
        return canonicalOntologyObject(record) as unknown as IndustryOntology;
}

/** Builds the canonical fixed-key-order object of an industry ontology (the serializer's engine). */
function canonicalOntologyObject(record: IndustryOntology): Record<string, unknown> {
        return {
                contractVersion: record.contractVersion,
                industry: record.industry,
                terms: record.terms.map((term) => ({ termKey: term.termKey, definition: term.definition })),
                relations: record.relations.map((relation) => ({
                        fromTermKey: relation.fromTermKey,
                        relationClass: relation.relationClass,
                        toTermKey: relation.toTermKey,
                })),
        };
}
