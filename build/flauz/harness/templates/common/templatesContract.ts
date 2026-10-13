/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-005 workflow-template contract family: the typed task/workflow
 * template layer for the Domain Harness OS direction (WORK-REGISTRY.md
 * - registry row DH-005 "domain task/workflow templates"). A harness
 * is domain-specific not only through its industry label (DH-01), its
 * named roles (DH-03) and its domain terms (DH-04) but through its
 * TASK AND WORKFLOW TEMPLATES - the reusable shapes of the domain's
 * work. This family is that layer: a typed, staged, deterministic
 * workflow-template record family bound to a harness, composing task
 * entries (configuration only) whose term references bind to the
 * DH-04 ontology, with the family's validation, serialization and
 * persistence laws. Composition over the landed families: the frozen
 * industry vocabulary, the harness-id alphabet, the staged-session
 * and the PIN-2 persistence architecture are the LANDED
 * DH-01/DH-02/DH-03/DH-04 surfaces - imported from the real modules,
 * never re-declared, re-implemented or shadowed (THE IMPORT LAW, this
 * wave's charter).
 *
 * LAWS (the DH-005 work order; the landed family precedents,
 * inherited and binding):
 * - THE NO-FORK LAW (binding, the family charter): a task entry is
 *   CONFIGURATION (a taskKey plus a human summary plus its term
 *   references, EXACTLY three keys); it grants NOTHING by itself. The
 *   structural engine's task station: any additional key on a task
 *   entry is the typed no-fork rejection.
 * - THE IMPORT LAW (binding, this wave's charter): the frozen industry
 *   vocabulary, the harness-id alphabet, the staged-session
 *   architecture, the term shape and the persistence pattern are the
 *   LANDED DH-01/DH-02/DH-03/DH-04 surfaces - imported from the real
 *   modules, never re-declared, re-implemented or shadowed (the
 *   battery pins the imports).
 * - THE CONTENT LAW (binding, this wave's honesty): NO per-industry
 *   task/workflow template content is shipped - this wave ships the
 *   LAYER, the machinery, not domain content (the registry's DH-002
 *   precedent "industry templates are LATER waves - do not invent
 *   them" applied verbatim to task/workflow templates); an invented
 *   legal / medical / finance task vocabulary would be an unsourced
 *   fork of domain truth. The caller composes the tasks; this family
 *   never invents them.
 * - THE TERM-RESOLUTION LAW (binding): task termRefs resolve ONLY
 *   against the caller-supplied composed DomainOntologyRecord at the
 *   finalize boundary (the two-phase law: dangling termRefs are LEGAL
 *   while composing; the boundary refuses typed); this layer never
 *   injects an ontology authority.
 * - THE FROZEN-VOCABULARY LAW (binding): the template admits ONLY the
 *   landed HARNESS_INDUSTRIES members, and the harnessId must satisfy
 *   the REAL DH-01 harness-id alphabet (the FORM law - the EXISTENCE
 *   binding is the caller's wiring, never this layer's).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW (binding):
 *   composing -> composed; 'composed' is TERMINAL (a frozen template;
 *   every mutating op on a composed record refuses with the stage
 *   law); a changed template is a NEW template, never a mutation of a
 *   composed one.
 * - THE TASK LAWS (binding, frozen constants): the taskKey is
 *   non-empty, at most TASK_KEY_MAX_LENGTH (64) characters, carries
 *   NO leading or trailing whitespace and no control characters; the
 *   summary is non-empty, at most TASK_SUMMARY_MAX_LENGTH (200)
 *   characters and carries no control characters; the template holds
 *   at most MAX_TASKS (128) tasks; taskKeys are unique within the
 *   template; termRefs is a string array, duplicate-free, MAY be
 *   empty (the honest-gap law: a task MAY name zero terms); at least
 *   one task at finalize (the empty-tasks floor fires THERE, never
 *   the record shape - a composing record may hold zero).
 * - THE DETERMINISM LAW (binding): no Math.random, no Date.now, no
 *   new Date(...) and no process.env in this module (law comments
 *   excepted) - the module is pure vocabulary over typed values; the
 *   clock and the rng are INJECTED at the kit boundary; the
 *   serialization is canonical fixed-key-order bytes.
 * - THE FAIL-CLOSED LAW (binding): every refusal is a typed record
 *   naming the violated law and the offending items; no silent
 *   successes, no partial effects, never a bare throw on a domain
 *   refusal; multi-offense validations report the COMPLETE rejection
 *   table in the frozen walk order.
 * - THE SINGLE-VERSION LAW (binding): TEMPLATES_CONTRACTS_VERSION is
 *   '1.0.0' declared ONCE here, re-carried by the kit;
 *   DOMAIN_HARNESS_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION,
 *   ROLES_CONTRACTS_VERSION and ONTOLOGY_CONTRACTS_VERSION are
 *   declared ONCE in THEIR modules and re-carried here by reference
 *   (the battery pins every copy equal).
 * - Zero external dependencies: this module is pure vocabulary over
 *   typed values; no I/O, no clock, no env read.
 */

import { isHarnessId, isHarnessIndustry } from '../../contract/common/domainHarnessContract.js';
import type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';

/**
 * THE IMPORT LAW's re-export block: the REAL DH-01 harness-id alphabet
 * and the frozen industry vocabulary, plus the four landed contract
 * versions, are re-exported BY REFERENCE (the same bindings, never
 * re-declared copies). The battery pins referential identity against
 * the real modules.
 */
export {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_ID_PREFIX,
	HARNESS_INDUSTRIES,
	isHarnessId,
	isHarnessIndustry,
} from '../../contract/common/domainHarnessContract.js';
export type { HarnessIndustry } from '../../contract/common/domainHarnessContract.js';
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';

/** THE SINGLE-VERSION LAW: TEMPLATES_CONTRACTS_VERSION is declared ONCE here, re-carried by the kit. */
export const TEMPLATES_CONTRACTS_VERSION = '1.0.0';

/**
 * The workflow-template record id prefix (this family's namespace; the
 * same id law as flauz:hrn: / flauz:onb: / flauz:rol: / flauz:ont: -
 * the kit mints <prefix><16 lowercase hex> from the injected rng).
 */
export const TEMPLATE_ID_PREFIX = 'flauz:tpl:';

/**
 * The closed frozen stage vocabulary: the template walk's two stages.
 * 'composed' is TERMINAL (a frozen template; every mutating op on a
 * composed record refuses with the stage law; THE APPEND-ONLY LINEAGE
 * LAW: a changed template is a NEW template, never a mutation of a
 * composed one).
 */
export const TEMPLATE_STAGES = [
	'composing',
	'composed',
] as const;
export type TemplateStage = (typeof TEMPLATE_STAGES)[number];

/** Pure predicate over the closed stage list. */
export function isTemplateStage(value: unknown): value is TemplateStage {
	return (TEMPLATE_STAGES as readonly string[]).includes(value as string);
}

/** One whitelisted forward stage transition row (THE FORWARD-ONLY LAW's whitelist). */
export interface TemplateStageTransition {
	readonly from: TemplateStage;
	readonly to: TemplateStage;
}

/**
 * The frozen forward-only whitelist: the ONLY legal stage transition
 * is composing->composed. 'composed' is TERMINAL - no reopen; a
 * changed template is a NEW template (THE APPEND-ONLY LINEAGE LAW).
 * Widening the map is a versioned contract decision.
 */
export const TEMPLATE_FORWARD_TRANSITIONS = [
	{ from: 'composing', to: 'composed' },
] as const;

/**
 * The typed stage verdict: ok carries the granting whitelist row
 * (1-based); refusal is the ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row (the row whose from-stage matches, null when
 * none does), the whitelisted successor (expectedTo, null when the
 * from-stage is terminal or unknown), and the deterministic detail
 * sentence. Forward-only; 'composed' is TERMINAL.
 */
export type TemplateStageVerdict =
	| { readonly ok: true; readonly from: TemplateStage; readonly to: TemplateStage; readonly row: number }
	| {
			readonly ok: false;
			readonly reason: 'ILLEGAL_TRANSITION';
			readonly from: unknown;
			readonly to: unknown;
			readonly whitelistRow: number | null;
			readonly expectedTo: TemplateStage | null;
			readonly detail: string;
		};

/**
 * THE FORWARD-ONLY LAW's verdict machine (pure): the exact whitelist
 * membership check. The only legal transition is composing->composed;
 * every other edge (self-loops, composed->anything, unknown stages,
 * non-strings) is the typed ILLEGAL_TRANSITION rejection naming the
 * violated whitelist row.
 */
export function canTransitionTemplateStage(from: unknown, to: unknown): TemplateStageVerdict {
	const transitions = TEMPLATE_FORWARD_TRANSITIONS as readonly TemplateStageTransition[];
	let rowNumber = 0;
	for (let i = 0; i < transitions.length; i += 1) {
		if (transitions[i].from === from) {
			rowNumber = i + 1;
			break;
		}
	}
	if (!isTemplateStage(from) || !isTemplateStage(to)) {
		return {
			ok: false,
			reason: 'ILLEGAL_TRANSITION',
			from,
			to,
			whitelistRow: rowNumber > 0 ? rowNumber : null,
			expectedTo: rowNumber > 0 ? transitions[rowNumber - 1].to : null,
			detail: `canTransitionTemplateStage: '${showValue(from)}' -> '${showValue(to)}' is refused - both stages must be members of the frozen TEMPLATE_STAGES list (THE FORWARD-ONLY LAW - the stage vocabulary is frozen)`,
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
			detail: `canTransitionTemplateStage: '${from}' -> '${to}' is refused - 'composed' is TERMINAL (the template is FROZEN; a changed template is a NEW template, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
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
			detail: `canTransitionTemplateStage: '${from}' -> '${to}' is refused - the only whitelisted forward transition from '${from}' is row ${rowNumber} ('${from}' -> '${expectedTo}') (THE FORWARD-ONLY LAW - forward-only; composed is terminal)`,
		};
	}
	return { ok: true, from, to, row: rowNumber };
}

/**
 * The task laws (all frozen constants): the taskKey is non-empty, at
 * most 64 characters, carries NO leading/trailing whitespace and no
 * control characters; the summary is non-empty, at most 200
 * characters and carries no control characters; the template holds at
 * most MAX_TASKS (128) tasks.
 */
export const TASK_KEY_MAX_LENGTH = 64;

/** The summary bound (non-empty, at most 200 characters, no control characters). */
export const TASK_SUMMARY_MAX_LENGTH = 200;

/** The composition bound (at most 128 tasks; the empty floor fires at finalize). */
export const MAX_TASKS = 128;

/**
 * The frozen workflow-template op-name vocabulary (the ledger line ops).
 */
export const TEMPLATE_OP_NAMES = [
	'begin-template',
	'add-task',
	'replace-task-summary',
	'remove-task',
	'finalize-template',
] as const;
export type TemplateOpName = (typeof TEMPLATE_OP_NAMES)[number];

/** Pure predicate over the closed op-name list. */
export function isTemplateOpName(value: unknown): value is TemplateOpName {
	return (TEMPLATE_OP_NAMES as readonly string[]).includes(value as string);
}

/**
 * One provenance note in the record history: which clock reading the
 * op landed at, the stage edge it walked (fromStage null ONLY on the
 * begin note - the entry into 'composing'; the task ops are the
 * composing->composing self edge - the template composes gradually),
 * which op and which law granted it, and the deterministic detail
 * sentence.
 */
export interface TemplateTransitionNote {
	readonly at: string;
	readonly fromStage: TemplateStage | null;
	readonly toStage: TemplateStage;
	readonly op: TemplateOpName;
	readonly law: string;
	readonly detail: string;
}

/**
 * THE TASK LAWS' configuration entry: a taskKey plus a human summary
 * plus its term references, EXACTLY three keys (THE NO-FORK LAW's
 * task station: any additional key is the typed no-fork rejection).
 * A task is CONFIGURATION; it grants NOTHING by itself. termRefs is a
 * string array, duplicate-free, MAY be empty (the honest-gap law: a
 * task MAY name zero terms).
 */
export interface TaskTemplateEntry {
	readonly taskKey: string;
	readonly summary: string;
	readonly termRefs: readonly string[];
}

/**
 * The persisted per-record honest record (THE SIX-KEY MODEL): the id,
 * the bound harness id (the REAL DH-01 flauz:hrn:<16-hex> form - the
 * FORM law here; the EXISTENCE binding is the caller's wiring, and
 * the AGREEMENT with the bound harness's own industry is the caller's
 * composition law, both pinned in the battery through the real kits),
 * the industry that scopes the template (one REAL HARNESS_INDUSTRIES
 * member, imported by reference), the stage, the composed tasks (MAY
 * be empty while composing - the empty floor fires at finalize, never
 * the record shape), and the full op history with provenance. The
 * record carries NO contractVersion field: THE SINGLE-VERSION LAW is
 * enforced at the kit-layer persistence surfaces (every ledger line
 * and the envelope carry TEMPLATES_CONTRACTS_VERSION; a drift there
 * is the typed version-mismatch). Stage-vs-payload consistency is the
 * ledger replay's cross-check, never this shape's (the DH-01 guard
 * discipline).
 */
export interface WorkflowTemplateRecord {
	readonly templateId: string;
	readonly harnessId: string;
	readonly industry: HarnessIndustry;
	readonly stage: TemplateStage;
	readonly tasks: readonly TaskTemplateEntry[];
	readonly history: readonly TemplateTransitionNote[];
}

/** The frozen record schema keys, in the canonical fixed-key-order (the serialization order). */
export const TEMPLATE_RECORD_SCHEMA_KEYS = [
	'templateId',
	'harnessId',
	'industry',
	'stage',
	'tasks',
	'history',
] as const;

/** The frozen history-note schema keys, in the canonical fixed-key-order. */
export const TEMPLATE_NOTE_SCHEMA_KEYS = [
	'at',
	'fromStage',
	'toStage',
	'op',
	'law',
	'detail',
] as const;

/** The frozen task-entry schema keys, in the canonical fixed-key-order. */
export const TASK_ENTRY_SCHEMA_KEYS = [
	'taskKey',
	'summary',
	'termRefs',
] as const;

/** Pure predicate: a well-formed workflow-template record id (flauz:tpl:<16-hex>). */
export function isTemplateId(value: unknown): value is string {
	if (typeof value !== 'string') {
		return false;
	}
	if (!value.startsWith(TEMPLATE_ID_PREFIX)) {
		return false;
	}
	const hex = value.slice(TEMPLATE_ID_PREFIX.length);
	return /^[0-9a-f]{16}$/.test(hex);
}

/**
 * Closed frozen list of workflow-template rejection reasons, in the
 * exact walk order (the work order's eighteen stations are the EXACT
 * PREFIX; the five appended stations are this family's own design -
 * each documented below - the work order authorizes the extension
 * "where your design needs a distinct station"; the validation walks
 * collect EVERY violated law into the typed rejection table, the
 * table's records appearing in this order):
 *   malformed-record      - the candidate is not a plain object, or a
 *                           carrier carries the wrong structural type
 *                           (a non-array tasks / history carrier);
 *   unknown-key           - a key outside the frozen six-key record
 *                           schema;
 *   missing-key           - a required record key is absent;
 *   malformed-harness-id  - the bound harnessId is not the REAL
 *                           DH-01 flauz:hrn:<16-hex> form (imported
 *                           by reference - the FORM law; the
 *                           EXISTENCE binding is the caller's
 *                           wiring, never this layer's);
 *   unknown-industry      - THE FROZEN-VOCABULARY LAW: the industry
 *                           is not a member of the DH-01 list
 *                           (imported by reference);
 *   malformed-task        - a task entry is not a plain object, or
 *                           the taskKey / summary carrier is not a
 *                           string;
 *   no-fork               - THE NO-FORK LAW's task station: a task
 *                           entry carries a key beyond taskKey +
 *                           summary + termRefs (a task is
 *                           CONFIGURATION - it grants NOTHING by
 *                           itself);
 *   invalid-task-key      - the taskKey is empty, longer than 64
 *                           characters, carries leading/trailing
 *                           whitespace, or carries control characters
 *                           (C0/DEL/C1);
 *   invalid-summary       - the summary is empty, longer than 200
 *                           characters, or carries control characters
 *                           (C0/DEL/C1);
 *   malformed-term-refs   - the termRefs carrier is not an array, or
 *                           a member is not a string;
 *   duplicate-term-ref    - a task's termRefs carry repeats;
 *   duplicate-task-key    - taskKeys are not unique within the
 *                           template;
 *   max-tasks-exceeded    - the template carries more than MAX_TASKS
 *                           (128) tasks (the composition bound);
 *   empty-tasks           - THE DH-01 FLOOR: the finalize boundary
 *                           requires at least one composed task (a
 *                           composing record may hold zero);
 *   unknown-record        - the record id is not the
 *                           flauz:tpl:<16-hex> form (and, at the kit
 *                           layer, no record resolves under the id -
 *                           a malformed id fails closed as unknown);
 *   version-mismatch      - THE SINGLE-VERSION LAW: a version-bearing
 *                           persisted surface (a kit-layer ledger line
 *                           or the envelope) carries a contract
 *                           version other than
 *                           TEMPLATES_CONTRACTS_VERSION (the six-key
 *                           record carries no version field - this
 *                           station never fires in the pure record
 *                           walk);
 *   unknown-stage         - the stage is not a member of the frozen
 *                           TEMPLATE_STAGES list;
 *   malformed-history     - a history note fails the frozen six-key
 *                           note shape;
 *   dangling-term-ref     - THE TERM-RESOLUTION LAW (kit layer): a
 *                           non-empty termRef does not resolve against
 *                           the caller-supplied composed ontology
 *                           record at the finalize boundary (the
 *                           refusal names every offending ref; the
 *                           two-phase law: dangling termRefs are
 *                           LEGAL while composing);
 *   malformed-ontology    - THE TERM-RESOLUTION LAW (kit layer): the
 *                           caller-supplied ontology record fails the
 *                           REAL DH-04 validateOntologyRecord walk, or
 *                           is not at the 'composed' stage (fail
 *                           closed - a malformed authority resolves
 *                           nothing, never a silent skip);
 *   premature-op          - THE FORWARD-ONLY LAW (kit layer): the op
 *                           precedes its precondition (a workflow ref
 *                           emitted while the record is still at
 *                           'composing' - refs are emitted only from
 *                           a COMPOSED template);
 *   stale-stage           - THE FORWARD-ONLY LAW (kit layer): the op
 *                           is behind the walk (a mutating op on a
 *                           composed record - 'composed' is TERMINAL,
 *                           the template is FROZEN; a changed template
 *                           is a NEW record, THE APPEND-ONLY LINEAGE
 *                           LAW);
 *   unknown-task          - the taskKey names no task in the template
 *                           (at the kit layer; a malformed taskKey
 *                           fails closed as unknown).
 * Widening or reordering the list is a versioned contract decision.
 */
export const TEMPLATES_REJECTION_REASONS = [
	'malformed-record',
	'unknown-key',
	'missing-key',
	'malformed-harness-id',
	'unknown-industry',
	'malformed-task',
	'no-fork',
	'invalid-task-key',
	'invalid-summary',
	'malformed-term-refs',
	'duplicate-term-ref',
	'duplicate-task-key',
	'max-tasks-exceeded',
	'empty-tasks',
	'unknown-record',
	'version-mismatch',
	'unknown-stage',
	'malformed-history',
	'dangling-term-ref',
	'malformed-ontology',
	'premature-op',
	'stale-stage',
	'unknown-task',
] as const;
export type TemplatesRejectionReason = (typeof TEMPLATES_REJECTION_REASONS)[number];

/** Pure predicate over the closed rejection list. */
export function isTemplatesRejectionReason(value: unknown): value is TemplatesRejectionReason {
	return (TEMPLATES_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/**
 * One typed rejection from a validation walk: the frozen reason, the
 * violated law's name, the offending items, and the deterministic
 * detail sentence. NEVER a string throw, NEVER a silent skip.
 */
export interface TemplatesRejection {
	readonly reason: TemplatesRejectionReason;
	readonly law: string;
	readonly items?: readonly string[];
	readonly detail: string;
}

/**
 * The typed validation outcome (the family's outcome pattern, the
 * DH-04 OntologyValidationOutcome shape carrying the DH-01
 * complete-table law): ok carries the canonical value; refusal
 * carries the COMPLETE typed rejection table in the frozen walk order
 * - never first-only.
 */
export type TemplatesValidationOutcome<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly TemplatesRejection[] };

/**
 * The single-task station walk (the kit's addTask station, the
 * family's per-payload validator architecture): malformed-task ->
 * no-fork -> invalid-task-key -> invalid-summary ->
 * malformed-term-refs -> duplicate-term-ref, the complete table over
 * ONE entry. Ok carries the canonical { taskKey, summary, termRefs }
 * copy.
 */
export function validateTaskEntry(task: unknown): TemplatesValidationOutcome<TaskTemplateEntry> {
	const rejections: TemplatesRejection[] = [];
	if (!isRecord(task)) {
		rejections.push({
			reason: 'malformed-task',
			law: 'THE FAIL-CLOSED LAW',
			items: ['task'],
			detail: 'validateTaskEntry: every task entry must be a plain object of exactly { taskKey, summary, termRefs } (a task is configuration; it grants NOTHING by itself)',
		});
		return { ok: false, mode: 'shape', rejections };
	}
	const record = task as Record<string, unknown>;
	if (typeof record.taskKey !== 'string' || typeof record.summary !== 'string') {
		rejections.push({
			reason: 'malformed-task',
			law: 'THE FAIL-CLOSED LAW',
			items: [typeof record.taskKey !== 'string' ? 'taskKey' : 'summary'],
			detail: 'validateTaskEntry: the taskKey and the summary must be strings (a task is a key plus a human summary)',
		});
	}
	const extraKeys = Object.keys(record).filter((key) => !(TASK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
	if (extraKeys.length > 0) {
		rejections.push({
			reason: 'no-fork',
			law: 'THE NO-FORK LAW',
			items: extraKeys,
			detail: `validateTaskEntry: a task is CONFIGURATION (a taskKey plus a human summary plus its term references) - it grants NOTHING by itself; the extra key(s) ${showList(extraKeys)} are execution material and cannot appear on a task entry`,
		});
	}
	if (typeof record.taskKey === 'string') {
		const violations = taskKeyViolationsOf(record.taskKey);
		if (violations.length > 0) {
			rejections.push({
				reason: 'invalid-task-key',
				law: 'THE FAIL-CLOSED LAW',
				items: violations,
				detail: `validateTaskEntry: the taskKey must be a non-empty string of at most ${TASK_KEY_MAX_LENGTH} characters with no leading/trailing whitespace and no control characters (C0/DEL/C1)`,
			});
		}
	}
	if (typeof record.summary === 'string') {
		const violations = summaryViolationsOf(record.summary);
		if (violations.length > 0) {
			rejections.push({
				reason: 'invalid-summary',
				law: 'THE FAIL-CLOSED LAW',
				items: violations,
				detail: `validateTaskEntry: the summary must be a non-empty string of at most ${TASK_SUMMARY_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
			});
		}
	}
	if (!Array.isArray(record.termRefs)) {
		rejections.push({
			reason: 'malformed-term-refs',
			law: 'THE FAIL-CLOSED LAW',
			items: ['termRefs'],
			detail: 'validateTaskEntry: the termRefs must be a string array (the task\'s term references; MAY be empty - a task MAY name zero terms)',
		});
	} else {
		const termRefs = record.termRefs as unknown[];
		const nonStringMembers: string[] = [];
		for (let i = 0; i < termRefs.length; i += 1) {
			if (typeof termRefs[i] !== 'string') {
				nonStringMembers.push(`termRefs[${i}]`);
			}
		}
		if (nonStringMembers.length > 0) {
			rejections.push({
				reason: 'malformed-term-refs',
				law: 'THE FAIL-CLOSED LAW',
				items: nonStringMembers,
				detail: 'validateTaskEntry: every termRefs member must be a string (the term-reference alphabet)',
			});
		}
		const duplicates = findDuplicates(termRefs.filter((ref): ref is string => typeof ref === 'string'));
		if (duplicates.length > 0) {
			rejections.push({
				reason: 'duplicate-term-ref',
				law: 'THE FAIL-CLOSED LAW',
				items: duplicates,
				detail: 'validateTaskEntry: the termRefs array must be duplicate-free (a term reference appears once per task)',
			});
		}
	}
	if (rejections.length > 0) {
		return { ok: false, mode: 'shape', rejections };
	}
	return { ok: true, value: { taskKey: record.taskKey as string, summary: record.summary as string, termRefs: [...(record.termRefs as string[])] } };
}

/**
 * The summary station walk (the kit's replaceTaskSummary station):
 * malformed-record (the non-string carrier) -> invalid-summary (the
 * bounds). Ok carries the summary string.
 */
export function validateTaskSummary(summary: unknown): TemplatesValidationOutcome<string> {
	const rejections: TemplatesRejection[] = [];
	if (typeof summary !== 'string') {
		rejections.push({
			reason: 'malformed-record',
			law: 'THE FAIL-CLOSED LAW',
			items: ['summary'],
			detail: 'validateTaskSummary: the summary must be a string (the task\'s human summary)',
		});
	} else {
		const violations = summaryViolationsOf(summary);
		if (violations.length > 0) {
			rejections.push({
				reason: 'invalid-summary',
				law: 'THE FAIL-CLOSED LAW',
				items: violations,
				detail: `validateTaskSummary: the summary must be a non-empty string of at most ${TASK_SUMMARY_MAX_LENGTH} characters with no control characters (C0/DEL/C1)`,
			});
		}
	}
	if (rejections.length > 0) {
		return { ok: false, mode: 'shape', rejections };
	}
	return { ok: true, value: summary as string };
}

/**
 * The deep record walk (pure): the strict six-key shape walk over the
 * honest record - malformed-record (the record and its carriers),
 * unknown-key, missing-key, malformed-harness-id (THE REAL DH-01
 * harness-id alphabet import - the FORM law), unknown-industry (THE
 * FROZEN-VOCABULARY LAW against the REAL import), the tasks family
 * laws (malformed-task / no-fork / invalid-task-key / invalid-summary
 * / malformed-term-refs / duplicate-term-ref per entry,
 * duplicate-task-key, max-tasks-exceeded), unknown-record (the id
 * alphabet), unknown-stage, malformed-history. THE COMPLETE TABLE:
 * every violated station is reported, in the frozen walk order. Empty
 * tasks are LEGAL here (the floor fires at finalize, never the record
 * shape); stage-vs-payload consistency is the ledger replay's
 * cross-check, never this walk's. Ok carries the canonical
 * fixed-key-order copy.
 */
export function validateWorkflowTemplateRecord(value: unknown): TemplatesValidationOutcome<WorkflowTemplateRecord> {
	const rejections: TemplatesRejection[] = [];
	if (!isRecord(value)) {
		rejections.push({
			reason: 'malformed-record',
			law: 'THE FAIL-CLOSED LAW',
			items: ['record'],
			detail: 'validateWorkflowTemplateRecord: the record must be a plain object (never a silent partial verdict)',
		});
		return { ok: false, mode: 'shape', rejections };
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record);

	// station 1 (malformed-record): the carriers.
	const carrierViolations: string[] = [];
	if (hasOwn(record, 'tasks') && !Array.isArray(record.tasks)) {
		carrierViolations.push('tasks');
	}
	if (hasOwn(record, 'history') && !Array.isArray(record.history)) {
		carrierViolations.push('history');
	}
	if (carrierViolations.length > 0) {
		rejections.push({
			reason: 'malformed-record',
			law: 'THE FAIL-CLOSED LAW',
			items: carrierViolations,
			detail: `validateWorkflowTemplateRecord: a record field carries the wrong structural type - the carrier(s) ${showList(carrierViolations)} must be arrays (never a silent partial verdict)`,
		});
	}

	// station 2 (unknown-key): the strict six-key schema is closed.
	const unknownKeys = keys.filter((key) => !(TEMPLATE_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownKeys.length > 0) {
		rejections.push({
			reason: 'unknown-key',
			law: 'THE FAIL-CLOSED LAW',
			items: unknownKeys,
			detail: `validateWorkflowTemplateRecord: the record schema is closed (THE SIX-KEY MODEL) - the unknown key(s) ${showList(unknownKeys)} are rejected`,
		});
	}

	// station 3 (missing-key): the strict schema requires every key.
	const missingKeys = (TEMPLATE_RECORD_SCHEMA_KEYS as readonly string[]).filter((key) => !hasOwn(record, key));
	if (missingKeys.length > 0) {
		rejections.push({
			reason: 'missing-key',
			law: 'THE FAIL-CLOSED LAW',
			items: missingKeys,
			detail: `validateWorkflowTemplateRecord: the record schema requires every key - the key(s) ${showList(missingKeys)} are missing`,
		});
	}

	// station 4 (malformed-harness-id): the REAL DH-01 harness-id alphabet (THE IMPORT LAW).
	// (the absent-key discipline: an absent harnessId is station 3's missing-key,
	// never a cascade here - the DH-01 law: an absent key is the missing-key
	// station, never a structural one.)
	if (hasOwn(record, 'harnessId') && !isHarnessId(record.harnessId)) {
		rejections.push({
			reason: 'malformed-harness-id',
			law: 'THE FAIL-CLOSED LAW',
			items: [showValue(record.harnessId)],
			detail: 'validateWorkflowTemplateRecord: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller\'s wiring, never this layer\'s)',
		});
	}

	// station 5 (unknown-industry): THE FROZEN-VOCABULARY LAW against the REAL import.
	if (hasOwn(record, 'industry') && !isHarnessIndustry(record.industry)) {
		rejections.push({
			reason: 'unknown-industry',
			law: 'THE FROZEN-VOCABULARY LAW',
			items: [showValue(record.industry)],
			detail: 'validateWorkflowTemplateRecord: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the template is industry-scoped)',
		});
	}

	// stations 6-13 (the tasks family laws), only walkable when the carrier is an array.
	if (Array.isArray(record.tasks)) {
		const tasks = record.tasks as unknown[];
		for (let i = 0; i < tasks.length; i += 1) {
			const task = tasks[i];
			if (!isRecord(task)) {
				rejections.push({
					reason: 'malformed-task',
					law: 'THE FAIL-CLOSED LAW',
					items: [`tasks[${i}]`],
					detail: 'validateWorkflowTemplateRecord: every task entry must be { taskKey, summary, termRefs } with non-empty strings and a string-array termRefs (a task is configuration; it grants NOTHING by itself)',
				});
				continue;
			}
			const entry = validateTaskEntry(task);
			if (!entry.ok) {
				for (const rejection of entry.rejections) {
					rejections.push(prefixRejectionItems(rejection, `tasks[${i}]`));
				}
			}
		}
		const taskKeyDuplicates = findDuplicates(
			tasks.filter((task) => isRecord(task) && typeof (task as Record<string, unknown>).taskKey === 'string').map(
				(task) => (task as Record<string, unknown>).taskKey as string,
			),
		);
		if (taskKeyDuplicates.length > 0) {
			rejections.push({
				reason: 'duplicate-task-key',
				law: 'THE FAIL-CLOSED LAW',
				items: taskKeyDuplicates,
				detail: 'validateWorkflowTemplateRecord: taskKeys must be unique within the template (a task appears once)',
			});
		}
		if (tasks.length > MAX_TASKS) {
			rejections.push({
				reason: 'max-tasks-exceeded',
				law: 'THE FAIL-CLOSED LAW',
				items: [`${tasks.length} tasks`],
				detail: `validateWorkflowTemplateRecord: the template carries at most MAX_TASKS (${MAX_TASKS}) tasks (the composition bound)`,
			});
		}
	}

	// station 14 (empty-tasks) never fires on the record shape: the floor lives at
	// the kit's finalizeTemplate boundary (a composing record may hold ZERO tasks).

	// station 15 (unknown-record): the id alphabet.
	// (the absent-key discipline: an absent templateId is station 3's missing-key,
	// never a cascade here.)
	if (hasOwn(record, 'templateId') && !isTemplateId(record.templateId)) {
		rejections.push({
			reason: 'unknown-record',
			law: 'THE FAIL-CLOSED LAW',
			items: [showValue(record.templateId)],
			detail: `validateWorkflowTemplateRecord: the templateId must be the ${TEMPLATE_ID_PREFIX}<16-hex> form (minted from the injected rng at the kit boundary, never caller-supplied)`,
		});
	}

	// station 16 (version-mismatch) never fires on THE SIX-KEY MODEL: the record
	// carries no contractVersion - THE SINGLE-VERSION LAW is enforced at the
	// kit-layer persistence surfaces (every ledger line and the envelope carry
	// TEMPLATES_CONTRACTS_VERSION; a drift there is the typed version-mismatch).

	// station 17 (unknown-stage).
	// (the absent-key discipline: an absent stage is station 3's missing-key,
	// never a cascade here.)
	if (hasOwn(record, 'stage') && !isTemplateStage(record.stage)) {
		rejections.push({
			reason: 'unknown-stage',
			law: 'THE FORWARD-ONLY LAW',
			items: [showValue(record.stage)],
			detail: 'validateWorkflowTemplateRecord: the stage must be a member of the frozen TEMPLATE_STAGES list (composing -> composed; composed is TERMINAL)',
		});
	}

	// station 18 (malformed-history), only walkable when the carrier is an array.
	if (Array.isArray(record.history)) {
		const history = record.history as unknown[];
		const malformed: string[] = [];
		for (let i = 0; i < history.length; i += 1) {
			if (!isWellFormedNote(history[i])) {
				malformed.push(`history[${i}]`);
			}
		}
		if (malformed.length > 0) {
			rejections.push({
				reason: 'malformed-history',
				law: 'THE FAIL-CLOSED LAW',
				items: malformed,
				detail: 'validateWorkflowTemplateRecord: every history note must carry the frozen six-key note shape (at / fromStage / toStage / op / law / detail - the provenance record)',
			});
		}
	}

	if (rejections.length > 0) {
		return { ok: false, mode: 'shape', rejections };
	}
	return { ok: true, value: canonicalWorkflowTemplateRecord(record as unknown as WorkflowTemplateRecord) };
}

/**
 * Pure deep shape guard: a well-formed workflow-template record (the
 * deep walk above, green). Fails closed on every malformed path;
 * never reads a clock; never mutates its input.
 */
export function isWorkflowTemplateRecord(value: unknown): value is WorkflowTemplateRecord {
	return validateWorkflowTemplateRecord(value).ok;
}

/**
 * THE CANONICAL SERIALIZATION: the fixed-key-order JSON bytes of a
 * workflow-template record (byte-deterministic; double-serialize
 * byte-equality; the key order frozen in this module and pinned by
 * tests - the DH-01 algorithm: the frozen per-shape key orders applied
 * deeply, never an alphabetic re-sort). The record keys emit in the
 * TEMPLATE_RECORD_SCHEMA_KEYS order, the task entries in the
 * taskKey,summary,termRefs order, and the history notes in the
 * TEMPLATE_NOTE_SCHEMA_KEYS order. Throws TypeError on a malformed
 * record (never dishonest bytes).
 */
export function serializeWorkflowTemplateRecord(record: unknown): string {
	if (!isWorkflowTemplateRecord(record)) {
		throw new TypeError(
			'serializeWorkflowTemplateRecord: record must satisfy isWorkflowTemplateRecord - no dishonest workflow-template record ever gets canonical bytes',
		);
	}
	return JSON.stringify(canonicalRecordObject(record));
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
 *   unknown-contract-version - the family-parity slot: THE SIX-KEY
 *                              MODEL carries no contractVersion field,
 *                              so this station never fires on record
 *                              bytes (the version law fires at the
 *                              kit-layer persistence surfaces as the
 *                              typed version-mismatch); the slot is
 *                              retained for the landed family's
 *                              five-reason parse shape;
 *   unknown-key              - an extra key at the record, task or
 *                              note level (tampered bytes);
 *   invalid-record           - the deep semantic walk refuses.
 */
export const TEMPLATES_PARSE_REJECTION_REASONS = [
	'malformed-json',
	'torn-envelope',
	'unknown-contract-version',
	'unknown-key',
	'invalid-record',
] as const;
export type TemplatesParseRejectionReason = (typeof TEMPLATES_PARSE_REJECTION_REASONS)[number];

/** Pure predicate over the closed parse-rejection list. */
export function isTemplatesParseRejectionReason(value: unknown): value is TemplatesParseRejectionReason {
	return (TEMPLATES_PARSE_REJECTION_REASONS as readonly string[]).includes(value as string);
}

/** The typed parse rejection: the frozen reason and the drift-naming detail. */
export interface TemplatesParseRejection {
	readonly reason: TemplatesParseRejectionReason;
	readonly detail: string;
}

/** The typed parse outcome: ok carries the validated record; failure names the drift. */
export type TemplatesParseOutcome =
	| { readonly ok: true; readonly record: WorkflowTemplateRecord }
	| { readonly ok: false; readonly rejection: TemplatesParseRejection };

/**
 * THE FAIL-CLOSED PARSE: bytes -> the typed parse outcome. Malformed
 * JSON, a torn envelope, an unknown key (record / task / note level),
 * or invalid content (the deep record walk) - each a typed rejection
 * naming the drift; never a silent partial parse.
 * First-failure-is-the-verdict, in the frozen
 * TEMPLATES_PARSE_REJECTION_REASONS order.
 */
export function parseWorkflowTemplateRecord(bytes: unknown): TemplatesParseOutcome {
	if (typeof bytes !== 'string') {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseWorkflowTemplateRecord: bytes must be a string (the canonical fixed-key-order record bytes)',
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
				detail: `parseWorkflowTemplateRecord: the bytes are not valid JSON: ${toMessage(error)}`,
			},
		};
	}
	if (!isRecord(parsed)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseWorkflowTemplateRecord: the bytes must carry a JSON object (the record envelope)',
			},
		};
	}
	const record = parsed as Record<string, unknown>;
	for (const key of TEMPLATE_RECORD_SCHEMA_KEYS) {
		if (!hasOwn(record, key)) {
			return {
				ok: false,
				rejection: {
					reason: 'torn-envelope',
					detail: `parseWorkflowTemplateRecord: the '${key}' key is missing (a torn write - never a silent partial parse)`,
				},
			};
		}
	}
	if (typeof record.templateId !== 'string' || typeof record.harnessId !== 'string' || typeof record.industry !== 'string' || typeof record.stage !== 'string' || !Array.isArray(record.tasks) || !Array.isArray(record.history)) {
		return {
			ok: false,
			rejection: {
				reason: 'torn-envelope',
				detail: 'parseWorkflowTemplateRecord: the record envelope carries a value of the wrong structural type (a torn write - never a silent partial parse)',
			},
		};
	}
	const unknownRecordKeys = Object.keys(record).filter((key) => !(TEMPLATE_RECORD_SCHEMA_KEYS as readonly string[]).includes(key));
	if (unknownRecordKeys.length > 0) {
		return {
			ok: false,
			rejection: {
				reason: 'unknown-key',
				detail: `parseWorkflowTemplateRecord: the record carries the unknown key '${unknownRecordKeys[0]}' (the strict six-key record schema is closed)`,
			},
		};
	}
	const tasks = record.tasks as unknown[];
	for (let i = 0; i < tasks.length; i += 1) {
		const task = tasks[i];
		if (isRecord(task)) {
			const extraTaskKeys = Object.keys(task as Record<string, unknown>).filter((key) => !(TASK_ENTRY_SCHEMA_KEYS as readonly string[]).includes(key));
			if (extraTaskKeys.length > 0) {
				return {
					ok: false,
					rejection: {
						reason: 'unknown-key',
						detail: `parseWorkflowTemplateRecord: the task entry tasks[${i}] carries the unknown key '${extraTaskKeys[0]}' (a task is taskKey + summary + termRefs only)`,
					},
				};
			}
		}
	}
	const history = record.history as unknown[];
	for (let i = 0; i < history.length; i += 1) {
		const note = history[i];
		if (isRecord(note)) {
			const extraNoteKeys = Object.keys(note as Record<string, unknown>).filter(
				(key) => !(TEMPLATE_NOTE_SCHEMA_KEYS as readonly string[]).includes(key),
			);
			if (extraNoteKeys.length > 0) {
				return {
					ok: false,
					rejection: {
						reason: 'unknown-key',
						detail: `parseWorkflowTemplateRecord: the history note history[${i}] carries the unknown key '${extraNoteKeys[0]}' (the note schema is closed)`,
					},
				};
			}
		}
	}
	const deep = validateWorkflowTemplateRecord(parsed);
	if (!deep.ok) {
		return {
			ok: false,
			rejection: {
				reason: 'invalid-record',
				detail: `parseWorkflowTemplateRecord: the parsed record fails the deep record walk (${deep.rejections[0].reason} - ${deep.rejections[0].detail}; never a silent partial parse)`,
			},
		};
	}
	return { ok: true, record: deep.value };
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

/** The taskKey law violations (empty, over-length, whitespace padding, control characters), as deterministic item strings. */
function taskKeyViolationsOf(taskKey: string): string[] {
	const violations: string[] = [];
	if (taskKey.length === 0) {
		violations.push('empty');
	}
	if (taskKey.length > TASK_KEY_MAX_LENGTH) {
		violations.push(`${taskKey.length} chars`);
	}
	if (taskKey !== taskKey.trim()) {
		violations.push('leading/trailing whitespace');
	}
	const controls = controlCharactersOf(taskKey);
	if (controls.length > 0) {
		violations.push(...controls);
	}
	return violations;
}

/** The summary law violations (empty, over-length, control characters), as deterministic item strings. */
function summaryViolationsOf(summary: string): string[] {
	const violations: string[] = [];
	if (summary.length === 0) {
		violations.push('empty');
	}
	if (summary.length > TASK_SUMMARY_MAX_LENGTH) {
		violations.push(`${summary.length} chars`);
	}
	const controls = controlCharactersOf(summary);
	if (controls.length > 0) {
		violations.push(...controls);
	}
	return violations;
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

/** Pure predicate: a well-formed history note (the exact six keys; member stages and op; non-empty strings). */
function isWellFormedNote(value: unknown): value is TemplateTransitionNote {
	if (!isRecord(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...TEMPLATE_NOTE_SCHEMA_KEYS].sort();
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
	if (record.fromStage !== null && !isTemplateStage(record.fromStage)) {
		return false;
	}
	if (!isTemplateStage(record.toStage)) {
		return false;
	}
	if (!isTemplateOpName(record.op)) {
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

/** Prefixes a delegation-walk rejection's items with the entry path (the indexed station context). */
function prefixRejectionItems(rejection: TemplatesRejection, prefix: string): TemplatesRejection {
	if (rejection.items === undefined) {
		return rejection;
	}
	return {
		...rejection,
		items: rejection.items.map((item) => `${prefix}:${item}`),
	};
}

/** Builds the canonical fixed-key-order copy of a validated record. */
function canonicalWorkflowTemplateRecord(record: WorkflowTemplateRecord): WorkflowTemplateRecord {
	return canonicalRecordObject(record) as unknown as WorkflowTemplateRecord;
}

/** Builds the canonical fixed-key-order object of a validated record (the serializer's engine). */
function canonicalRecordObject(record: WorkflowTemplateRecord): Record<string, unknown> {
	return {
		templateId: record.templateId,
		harnessId: record.harnessId,
		industry: record.industry,
		stage: record.stage,
		tasks: record.tasks.map((task) => ({ taskKey: task.taskKey, summary: task.summary, termRefs: [...task.termRefs] })),
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
