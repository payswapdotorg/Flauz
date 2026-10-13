/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-005 workflow-template kit: the deterministic staged-record runtime
 * over the template contract vocabulary AND the REAL DH-01 harness
 * surfaces (imported, never re-implemented - THE IMPORT LAW, this
 * wave's charter). The kit walks a record begin -> addTask /
 * replaceTaskSummary / removeTask -> finalizeTemplate: beginTemplate
 * binds the record to a harness through the REAL DH-01 harness-id
 * alphabet (the FORM law - isHarnessId, imported by reference; the
 * EXISTENCE binding is the caller's wiring and the AGREEMENT with the
 * bound harness's own industry is the caller's composition law, both
 * pinned in the battery through the real DH-01 kit) and mints the
 * flauz:tpl:<16-hex> id from the injected rng (the template is
 * industry-scoped over the REAL frozen HARNESS_INDUSTRIES list,
 * imported by reference); the task ops apply the task laws (shape,
 * bounds, uniqueness, the MAX_TASKS bound); finalizeTemplate freezes
 * the template (composing -> composed, TERMINAL - the empty-tasks
 * floor fires there, never the record shape) AND enforces THE
 * TERM-RESOLUTION LAW: every non-empty termRef in the template must
 * resolve against the CALLER-SUPPLIED composed DomainOntologyRecord's
 * terms (validated through the REAL DH-04 validateOntologyRecord
 * import - a malformed or non-composed ontology is the typed
 * malformed-ontology refusal, fail closed; a dangling termRef is the
 * typed dangling-term-ref refusal naming every offending ref; the
 * two-phase law: dangling termRefs are LEGAL while composing). THE
 * REMOVE+RE-ADD LAW: a task's key is its identity - immutable once
 * added; replaceTaskSummary replaces ONLY the summary; a changed
 * taskKey is a NEW task (remove, then re-add). Removing the last task
 * is LEGAL while composing (the floor fires only at finalize).
 * emitWorkflowRef emits the COMPOSED template's id as the workflowRef
 * string (the DH-02 review composition's workflowRefs family member
 * form). NO catalog and NO ontology authority is injected: the term
 * resolution happens ONLY against the caller-supplied ontology record
 * at the finalize boundary (THE CONTENT LAW: no per-industry
 * task/workflow template content is shipped - the wave is the LAYER,
 * the machinery; the caller composes the tasks; this family never
 * invents them).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * DH-01/DH-02/DH-03/DH-04 laws EXACTLY): the same .flauz/harness
 * subtree, distinct files - the append-only ops ledger
 * .flauz/harness/templates-ops.jsonl (one canonical JSON line per
 * applied op, the seq strictly increasing and equal to the line
 * number) and the envelope .flauz/harness/templates-records.json ({
 * contractVersion, seq, records }). The ledger is authoritative; the
 * finalize line carries the caller-supplied composed ontology record
 * AS IT STOOD as its payload (the entry-as-it-stood discipline - the
 * replay re-proves THE TERM-RESOLUTION LAW from the ledger alone);
 * loadTemplatesKit replays it and cross-checks the envelope
 * byte-for-byte (a torn or missing line is the typed E_LEDGER_TORN; a
 * divergent envelope is the typed E_ENVELOPE_MISMATCH - never
 * silently rebuilt). A version-bearing surface (a ledger line or the
 * envelope) carrying another contract version is the typed
 * version-mismatch - THE SINGLE-VERSION LAW's live station in this
 * family (the six-key record carries no version field). Lazy
 * persistence (the subtree lands with the first applied op); a fresh
 * kit never appends over a non-empty templates ledger - reopen with
 * loadTemplatesKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface): THE IMPORT LAW,
 * THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW, THE
 * TERM-RESOLUTION LAW, THE REMOVE+RE-ADD LAW, THE NO-FORK LAW, THE
 * CONTENT LAW, THE DETERMINISM LAW (no Math.random, no Date.now, no
 * new Date(...) and no process.env in this module - law comments
 * excepted; the clock, the rng and the fsPort are INJECTED seams; the
 * factory consumes exactly ONE clock read and ONE rng read), THE
 * FAIL-CLOSED LAW (factory misuse throws TypeError; every domain
 * refusal is a typed record { reason, law, detail, items? }; a
 * refused op leaves the record unchanged; payload-walk refusals carry
 * the COMPLETE contract rejection table), THE SINGLE-VERSION LAW (the
 * re-export chain), THE APPEND-ONLY LEDGER LAW, THE DISPOSE LAW (every
 * operation after dispose rejects with the typed DISPOSED refusal).
 */

import {
	MAX_TASKS,
	TEMPLATES_CONTRACTS_VERSION,
	TEMPLATE_ID_PREFIX,
	TEMPLATES_REJECTION_REASONS,
	isHarnessId,
	isHarnessIndustry,
	isTemplateId,
	isTemplateOpName,
	isTemplateStage,
	serializeWorkflowTemplateRecord,
	validateTaskEntry,
	validateTaskSummary,
	validateWorkflowTemplateRecord,
} from './templatesContract.js';
import type {
	HarnessIndustry,
	TemplateOpName,
	TemplatesRejection,
	TaskTemplateEntry,
	TemplateTransitionNote,
	WorkflowTemplateRecord,
	TemplateStage,
} from './templatesContract.js';
import { validateOntologyRecord } from '../../ontology/common/ontologyContract.js';
import type { DomainOntologyRecord } from '../../ontology/common/ontologyContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { TEMPLATES_CONTRACTS_VERSION } from './templatesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-02 version, re-carried by reference. */
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-03 version, re-carried by reference. */
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-04 version, re-carried by reference. */
export { ONTOLOGY_CONTRACTS_VERSION } from '../../ontology/common/ontologyContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as the landed families, distinct file). */
export const TEMPLATES_ENVELOPE_RELATIVE_PATH = '.flauz/harness/templates-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const TEMPLATES_LEDGER_RELATIVE_PATH = '.flauz/harness/templates-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the industry on begin, the task entry on the task
 * ops, the caller-supplied composed ontology record AS IT STOOD on
 * finalize).
 */
export const TEMPLATES_LEDGER_LINE_SCHEMA_KEYS = [
	'seq',
	'at',
	'contractVersion',
	'op',
	'templateId',
	'harnessId',
	'fromStage',
	'toStage',
	'law',
	'payload',
	'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const TEMPLATES_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only workflow-template ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the record id, the
 * BOUND harness id (the REAL DH-01 flauz:hrn:<16-hex> form, carried
 * on every line), the stage edge walked (fromStage null ONLY on the
 * begin line; the task ops walk the composing->composing self edge -
 * the template composes gradually), the granting law, the canonical
 * op payload (the industry on begin; the added / replacement /
 * removed-as-it-stood task entry on the task ops; the caller-supplied
 * composed ontology record as it stood on finalize - the replay
 * re-proves THE TERM-RESOLUTION LAW from the ledger alone), and the
 * deterministic detail sentence.
 */
export interface TemplatesOpsLedgerLine {
	readonly seq: number;
	readonly at: string;
	readonly contractVersion: string;
	readonly op: TemplateOpName;
	readonly templateId: string;
	readonly harnessId: string;
	readonly fromStage: TemplateStage | null;
	readonly toStage: TemplateStage;
	readonly law: string;
	readonly payload: HarnessIndustry | TaskTemplateEntry | DomainOntologyRecord | null;
	readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * TEMPLATES_REJECTION_REASONS):
 *   DISPOSED             - THE DISPOSE LAW: the kit was disposed;
 *                          every operation after dispose rejects;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted record id);
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing templates ledger line, a structurally
 *                          invalid or out-of-order line, an unknown op
 *                          or an illegal stage edge inside the ledger,
 *                          or a fresh kit attempting to append over an
 *                          existing non-empty templates ledger (reopen
 *                          with loadTemplatesKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the templates
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   TEMPLATES_IO         - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the templates family's own files;
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listTemplates
 *                          received an unknown filter field or a
 *                          non-member filter value.
 * The contract's version-mismatch station fires at THIS layer for
 * every version-bearing persisted surface (a ledger line or the
 * envelope carrying another contract version) - THE SINGLE-VERSION
 * LAW's live station in this family.
 */
export const TEMPLATES_KIT_EXTRA_REFUSAL_REASONS = [
	'DISPOSED',
	'CORRUPT_SEAM',
	'E_LEDGER_TORN',
	'E_ENVELOPE_MISMATCH',
	'TEMPLATES_IO',
	'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 23 domain reasons plus the kit-layer extras. */
export const TEMPLATES_KIT_REFUSAL_REASONS = [
	...TEMPLATES_REJECTION_REASONS,
	...TEMPLATES_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type TemplatesKitRefusalReason = (typeof TEMPLATES_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isTemplatesKitRefusalReason(value: unknown): value is TemplatesKitRefusalReason {
	return (TEMPLATES_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface TemplatesKitRefusal {
	readonly reason: TemplatesKitRefusalReason;
	readonly law: string;
	readonly detail: string;
	readonly items?: readonly string[];
	/** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
	readonly rejections?: readonly TemplatesRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog and NO ontology authority: the term resolution happens
 * ONLY against the CALLER-SUPPLIED ontology record at the finalize
 * boundary (THE TERM-RESOLUTION LAW / THE CONTENT LAW - the layer,
 * never the domain content).
 */
export interface TemplatesKitOptions {
	/** The injected clock (returns the ISO string; the kit never reads a clock itself). */
	readonly clock: () => string;
	/** The record-id-minting seam (returns 16 lowercase hex chars; NEVER the random global). */
	readonly rng: () => string;
	/** The OPTIONAL filesystem seam (persistence when paired with root). */
	readonly fsPort?: HarnessFsPort;
	/** The OPTIONAL persistence root (the .flauz/harness subtree lands under it). */
	readonly root?: string;
}

/** The staged-record op outcome: ok carries the honest record; failure carries the typed refusal. */
export type TemplatesRecordOutcome =
	| { readonly ok: true; readonly record: WorkflowTemplateRecord }
	| { readonly ok: false; readonly refusal: TemplatesKitRefusal };

/** The ref outcome: ok carries the emitted workflowRef string; failure carries the typed refusal. */
export type TemplatesRefOutcome =
	| { readonly ok: true; readonly workflowRef: string }
	| { readonly ok: false; readonly refusal: TemplatesKitRefusal };

/** The list outcome: ok carries the templateId-ordered honest records; failure carries the typed refusal. */
export type TemplatesListOutcome =
	| { readonly ok: true; readonly records: readonly WorkflowTemplateRecord[] }
	| { readonly ok: false; readonly refusal: TemplatesKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type TemplatesLoadOutcome =
	| { readonly ok: true; readonly kit: TemplatesKit }
	| { readonly ok: false; readonly refusal: TemplatesKitRefusal };

/**
 * The deterministic workflow-template kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the record unchanged (inspectable before and
 * after).
 */
export interface TemplatesKit {
	beginTemplate(harnessId: unknown, industry: unknown): Promise<TemplatesRecordOutcome>;
	addTask(templateId: unknown, task: unknown): Promise<TemplatesRecordOutcome>;
	replaceTaskSummary(templateId: unknown, taskKey: unknown, summary: unknown): Promise<TemplatesRecordOutcome>;
	removeTask(templateId: unknown, taskKey: unknown): Promise<TemplatesRecordOutcome>;
	finalizeTemplate(templateId: unknown, ontology: unknown): Promise<TemplatesRecordOutcome>;
	emitWorkflowRef(templateId: unknown): Promise<TemplatesRefOutcome>;
	inspectTemplate(templateId: unknown): Promise<TemplatesRecordOutcome>;
	listTemplates(filter?: unknown): Promise<TemplatesListOutcome>;
	dispose(): void;
}

/**
 * Creates a workflow-template kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02/DH-03/
 * DH-04 factory walk EXACTLY (the same preconditions, the same message
 * shapes, the createTemplatesKit prefix): the options shape (clock /
 * rng), the clock's first read (a non-empty ISO string), the rng's
 * first read (exactly 16 lowercase hex chars - the id-minting law),
 * and the fsPort/root pairing (both or neither; the port must expose
 * readFile / writeFile / appendFile / mkdir). The factory consumes
 * exactly ONE clock read and ONE rng read (there is no inner kit to
 * re-validate the seams - the battery pins the exact count). The kit
 * starts with ZERO records; persistence is LAZY (the .flauz/harness
 * subtree lands with the first applied op; a fresh kit never appends
 * over an existing non-empty templates ledger - reopen with
 * loadTemplatesKit).
 */
export function createTemplatesKit(options: TemplatesKitOptions): TemplatesKit {
	const bound = validateKitOptions(options, false, 'createTemplatesKit');
	return buildTemplatesKit(bound, { seq: 0, records: new Map<string, WorkflowTemplateRecord>() });
}

/**
 * Reopens a persisted workflow-template kit: replays the append-only
 * templates ops ledger (the authoritative surface - each line
 * re-validated: the frozen eleven-key line schema, the REAL DH-01
 * harness-id alphabet on every line, the op's stage edge, the
 * record's walk order, the payload's full validation, the MAX_TASKS
 * bound, the replace line's immutable-parts cross-check, the remove
 * line's entry-as-it-stood cross-check, the finalize floor AND the
 * finalize payload's term resolution - THE TERM-RESOLUTION LAW
 * re-proved from the ledger alone), and cross-checks the envelope
 * byte-for-byte against the replay-built state. A torn or missing
 * templates ledger line is the typed E_LEDGER_TORN; a divergent,
 * missing or malformed envelope is the typed E_ENVELOPE_MISMATCH
 * (never silently rebuilt); a version-bearing surface carrying
 * another contract version is the typed version-mismatch (THE
 * SINGLE-VERSION LAW's live station); a refused fs port is the typed
 * TEMPLATES_IO. A fresh root (no files) reopens as an empty kit. The
 * options require BOTH fsPort and root (the load is a
 * persistence-surface operation).
 */
export async function loadTemplatesKit(options: TemplatesKitOptions): Promise<TemplatesLoadOutcome> {
	const bound = validateKitOptions(options, true, 'loadTemplatesKit');
	const fsPort = bound.fsPort as HarnessFsPort;
	const ledgerPath = `${bound.root}/${TEMPLATES_LEDGER_RELATIVE_PATH}`;
	const envelopePath = `${bound.root}/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`;
	try {
		await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
	} catch (error) {
		return { ok: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `loadTemplatesKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
	}
	let ledgerText: string | null;
	try {
		ledgerText = await readText(fsPort, ledgerPath);
	} catch (error) {
		return { ok: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `loadTemplatesKit: the fs port refused the templates ledger read: ${toMessage(error)}`) };
	}
	let envelopeText: string | null;
	try {
		envelopeText = await readText(fsPort, envelopePath);
	} catch (error) {
		return { ok: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `loadTemplatesKit: the fs port refused the templates envelope read: ${toMessage(error)}`) };
	}
	const replay = replayTemplatesLedger(ledgerText);
	if (!('lines' in replay)) {
		return { ok: false, refusal: replay };
	}
	const crossCheck = crossCheckTemplatesEnvelope(envelopeText, replay.lines.length, replay.records);
	if (crossCheck !== null) {
		return { ok: false, refusal: crossCheck };
	}
	return { ok: true, kit: buildTemplatesKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
	readonly rng: () => string;
	readonly fsPort: HarnessFsPort | null;
	readonly root: string | null;
}

interface TemplatesKitState {
	readonly seq: number;
	readonly records: ReadonlyMap<string, WorkflowTemplateRecord>;
}

/** The persist fold's result: applied means the templates ledger line landed (the ledger is authoritative). */
type PersistResult =
	| { readonly applied: false; readonly refusal: TemplatesKitRefusal }
	| { readonly applied: true; readonly refusal: TemplatesKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: TemplatesKitRefusal };

function validateKitOptions(options: TemplatesKitOptions, requirePersistence: boolean, factoryName: 'createTemplatesKit' | 'loadTemplatesKit'): BoundOptions {
	if (!isRecord(options)) {
		throw new TypeError(`${factoryName}: options must be an object`);
	}
	const opts = options as Record<string, unknown>;
	if (typeof opts.clock !== 'function') {
		throw new TypeError(
			`${factoryName}: options.clock must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)`,
		);
	}
	if (typeof opts.rng !== 'function') {
		throw new TypeError(
			`${factoryName}: options.rng must be a function returning 16 lowercase hex chars (the id-minting seam - NEVER the random global)`,
		);
	}
	const clock = opts.clock as () => string;
	const firstClock = clock();
	if (typeof firstClock !== 'string' || firstClock.length === 0) {
		throw new TypeError(`${factoryName}: options.clock() must return a non-empty ISO string (the injected-clock law)`);
	}
	const rng = opts.rng as () => string;
	const firstHex = rng();
	if (!/^[0-9a-f]{16}$/.test(firstHex)) {
		throw new TypeError(
			`${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${TEMPLATE_ID_PREFIX}<16-hex>)`,
		);
	}
	const hasPort = opts.fsPort !== undefined;
	const hasRoot = opts.root !== undefined;
	if (requirePersistence && (!hasPort || !hasRoot)) {
		throw new TypeError(`${factoryName}: options.fsPort and options.root are both required (the load is a persistence-surface operation)`);
	}
	if (hasPort !== hasRoot) {
		throw new TypeError(`${factoryName}: options.fsPort and options.root come together or not at all (the persistence seam is a pair)`);
	}
	let fsPort: HarnessFsPort | null = null;
	let root: string | null = null;
	if (hasPort && hasRoot) {
		const port = opts.fsPort;
		if (!isRecord(port)) {
			throw new TypeError(`${factoryName}: options.fsPort must be an object (the ONLY filesystem seam)`);
		}
		for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir'] as const) {
			if (typeof (port as Record<string, unknown>)[name] !== 'function') {
				throw new TypeError(`${factoryName}: options.fsPort.${name} must be a function (the ONLY filesystem seam)`);
			}
		}
		fsPort = port as unknown as HarnessFsPort;
		if (typeof opts.root !== 'string' || opts.root.length === 0) {
			throw new TypeError(`${factoryName}: options.root must be a non-empty string (the persistence root)`);
		}
		root = (opts.root as string).replace(/\/+$/, '');
	}
	return { clock, rng, fsPort, root };
}

function refused(
	reason: TemplatesKitRefusalReason,
	law: string,
	detail: string,
	items?: readonly string[],
): TemplatesKitRefusal {
	if (items === undefined) {
		return { reason, law, detail };
	}
	return { reason, law, detail, items };
}

/**
 * Surfaces a payload walk's typed refusal: the reason / law / items
 * mirror the FIRST rejection (the frozen walk order's head) and the
 * COMPLETE rejection table is carried in rejections (never
 * first-only - THE FAIL-CLOSED LAW's complete-table discipline).
 */
function payloadRefused(
	opName: string,
	outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly TemplatesRejection[] },
): TemplatesKitRefusal {
	const first = outcome.rejections[0];
	return {
		reason: first.reason,
		law: first.law,
		detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
		items: first.items,
		rejections: outcome.rejections,
	};
}

function buildTemplatesKit(bound: BoundOptions, seed: TemplatesKitState): TemplatesKit {
	let disposed = false;
	let mutableSeq = seed.seq;
	const records = new Map<string, WorkflowTemplateRecord>(seed.records);
	const persisted = bound.fsPort !== null && bound.root !== null;
	const fsPort = bound.fsPort;
	const ledgerPath = bound.root !== null ? `${bound.root}/${TEMPLATES_LEDGER_RELATIVE_PATH}` : '';
	const envelopePath = bound.root !== null ? `${bound.root}/${TEMPLATES_ENVELOPE_RELATIVE_PATH}` : '';
	let dirEnsured = false;
	// A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
	// (its ledger preexists; only a fresh createTemplatesKit guards the append).
	let ledgerGuardDone = seed.seq > 0;

	function readClock(): ClockRead {
		const at = bound.clock();
		if (typeof at !== 'string' || at.length === 0) {
			return {
				refusal: refused(
					'CORRUPT_SEAM',
					'THE DETERMINISM LAW',
					'the injected clock returned an empty value mid-op (the timestamps are carried verbatim from the injected seam)',
				),
			};
		}
		return { at };
	}

	function copyRecord(record: WorkflowTemplateRecord): WorkflowTemplateRecord {
		return JSON.parse(serializeWorkflowTemplateRecord(record)) as WorkflowTemplateRecord;
	}

	/**
	 * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
	 * first (the ledger is authoritative - the seq advances with the
	 * line), the envelope rewrite lands second, the in-memory records
	 * commit last (in the caller). An append refusal leaves NOTHING
	 * applied; an envelope refusal leaves the op applied and the line
	 * landed (the refusal discloses it; a reload fails closed with
	 * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
	 */
	async function persist(line: TemplatesOpsLedgerLine, nextRecords: Map<string, WorkflowTemplateRecord>): Promise<PersistResult> {
		if (!persisted || fsPort === null) {
			mutableSeq = line.seq;
			return { applied: true, refusal: null };
		}
		if (!ledgerGuardDone) {
			let existing: string | null;
			try {
				existing = await readText(fsPort, ledgerPath);
			} catch (error) {
				return { applied: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the templates ledger read: ${toMessage(error)}`) };
			}
			if (existing !== null && existing.trim().length > 0) {
				return {
					applied: false,
					refusal: refused(
						'E_LEDGER_TORN',
						'THE APPEND-ONLY LEDGER LAW',
						'persist: the templates ledger already carries lines - reopen with loadTemplatesKit (a fresh kit never appends over an existing ledger)',
					),
				};
			}
			ledgerGuardDone = true;
		}
		if (!dirEnsured) {
			try {
				await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
			} catch (error) {
				return { applied: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
			}
			dirEnsured = true;
		}
		try {
			await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
		} catch (error) {
			return { applied: false, refusal: refused('TEMPLATES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the templates ledger append: ${toMessage(error)} (nothing was applied)`) };
		}
		mutableSeq = line.seq;
		try {
			await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
		} catch (error) {
			return {
				applied: true,
				refusal: refused(
					'TEMPLATES_IO',
					'THE FAIL-CLOSED LAW',
					`persist: the templates ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
				),
			};
		}
		return { applied: true, refusal: null };
	}

	function commit(nextRecords: Map<string, WorkflowTemplateRecord>): void {
		records.clear();
		for (const [id, record] of nextRecords) {
			records.set(id, record);
		}
	}

	function recordOutcome(record: WorkflowTemplateRecord): TemplatesRecordOutcome {
		return { ok: true, record: copyRecord(record) };
	}

	/** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
	function refuseIfDisposed(opName: string): TemplatesKitRefusal | null {
		if (disposed) {
			return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
		}
		return null;
	}

	/** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
	function lookupRecord(opName: string, templateId: unknown): { record: WorkflowTemplateRecord } | { refusal: TemplatesKitRefusal } {
		if (!isTemplateId(templateId)) {
			return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(templateId)}' (a malformed id fails closed as unknown-record)`) };
		}
		const record = records.get(templateId);
		if (record === undefined) {
			return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${templateId}'`) };
		}
		return { record };
	}

	/**
	 * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
	 * 'composing' stage (a composed record is past them - stale-stage,
	 * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
	 */
	function stageGuard(opName: string, record: WorkflowTemplateRecord): TemplatesKitRefusal | null {
		if (record.stage === 'composing') {
			return null;
		}
		return refused(
			'stale-stage',
			'THE FORWARD-ONLY LAW',
			`${opName}: the record is at the '${record.stage}' stage - the template is FROZEN ('composed' is TERMINAL; a changed template is a NEW template, THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
			[record.stage],
		);
	}

	/** The task lookup for replace / remove (a malformed taskKey fails closed as unknown-task). */
	function findTask(record: WorkflowTemplateRecord, taskKey: unknown): TaskTemplateEntry | null {
		if (typeof taskKey !== 'string') {
			return null;
		}
		const found = record.tasks.find((entry) => entry.taskKey === taskKey);
		return found === undefined ? null : found;
	}

	return {
		async beginTemplate(harnessId: unknown, industry: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('beginTemplate');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			// THE IMPORT LAW: the REAL DH-01 harness-id alphabet (the FORM law; the
			// EXISTENCE binding is the caller's wiring - pinned in the battery through
			// the real DH-01 kit, never resolved here).
			if (!isHarnessId(harnessId)) {
				return {
					ok: false,
					refusal: refused(
						'malformed-harness-id',
						'THE FAIL-CLOSED LAW',
						`beginTemplate: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
						[showValue(harnessId)],
					),
				};
			}
			if (!isHarnessIndustry(industry)) {
				return {
					ok: false,
					refusal: refused(
						'unknown-industry',
						'THE FROZEN-VOCABULARY LAW',
						`beginTemplate: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the template is industry-scoped)`,
						[showValue(industry)],
					),
				};
			}
			const hex = bound.rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginTemplate: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
			}
			const templateId = `${TEMPLATE_ID_PREFIX}${hex}`;
			if (records.has(templateId)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginTemplate: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `began the workflow-template record bound to harness '${harnessId}' over the '${industry}' industry (the walk enters the composing stage with ZERO tasks; the caller composes the tasks - this family never invents them, THE CONTENT LAW)`;
			const record: WorkflowTemplateRecord = {
				templateId,
				harnessId,
				industry,
				stage: 'composing',
				tasks: [],
				history: [
					{ at, fromStage: null, toStage: 'composing', op: 'begin-template', law: 'THE FORWARD-ONLY LAW', detail },
				],
			};
			const line: TemplatesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: TEMPLATES_CONTRACTS_VERSION,
				op: 'begin-template',
				templateId,
				harnessId,
				fromStage: null,
				toStage: 'composing',
				law: 'THE FORWARD-ONLY LAW',
				payload: industry,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(templateId, record);
			const persistResult = await persist(line, nextRecords);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextRecords);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return recordOutcome(record);
		},
		async addTask(templateId: unknown, task: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('addTask');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('addTask', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('addTask', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateTaskEntry(task);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('addTask', verdict) };
			}
			const entry = verdict.value;
			if (record.tasks.some((existing) => existing.taskKey === entry.taskKey)) {
				return {
					ok: false,
					refusal: refused(
						'duplicate-task-key',
						'THE FAIL-CLOSED LAW',
						`addTask: the taskKey '${entry.taskKey}' is already composed (a task appears once)`,
						[entry.taskKey],
					),
				};
			}
			if (record.tasks.length >= MAX_TASKS) {
				return {
					ok: false,
					refusal: refused(
						'max-tasks-exceeded',
						'THE FAIL-CLOSED LAW',
						`addTask: the template already carries ${record.tasks.length} tasks - the composition bound is MAX_TASKS (${MAX_TASKS})`,
						[`${record.tasks.length} tasks`],
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `added the task '${entry.taskKey}' (a task is CONFIGURATION - it grants NOTHING by itself; dangling termRefs are LEGAL while composing - THE TERM-RESOLUTION LAW's two-phase law)`;
			const next: WorkflowTemplateRecord = {
				templateId: record.templateId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				tasks: [...record.tasks, entry],
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-task', law: 'THE NO-FORK LAW', detail }],
			};
			const line: TemplatesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: TEMPLATES_CONTRACTS_VERSION,
				op: 'add-task',
				templateId: record.templateId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE NO-FORK LAW',
				payload: entry,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.templateId, next);
			const persistResult = await persist(line, nextRecords);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextRecords);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return recordOutcome(next);
		},
		async replaceTaskSummary(templateId: unknown, taskKey: unknown, summary: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('replaceTaskSummary');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('replaceTaskSummary', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('replaceTaskSummary', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findTask(record, taskKey);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-task',
						'THE FAIL-CLOSED LAW',
						`replaceTaskSummary: no task '${showValue(taskKey)}' in the template (a malformed taskKey fails closed as unknown-task)`,
					),
				};
			}
			const verdict = validateTaskSummary(summary);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('replaceTaskSummary', verdict) };
			}
			const replacement: TaskTemplateEntry = { taskKey: existing.taskKey, summary: verdict.value, termRefs: [...existing.termRefs] };
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `replaced the summary of the task '${existing.taskKey}' (a task's key is its identity - immutable once added; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
			const next: WorkflowTemplateRecord = {
				templateId: record.templateId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				tasks: record.tasks.map((entry) => (entry.taskKey === replacement.taskKey ? replacement : entry)),
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-task-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: TemplatesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: TEMPLATES_CONTRACTS_VERSION,
				op: 'replace-task-summary',
				templateId: record.templateId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: replacement,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.templateId, next);
			const persistResult = await persist(line, nextRecords);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextRecords);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return recordOutcome(next);
		},
		async removeTask(templateId: unknown, taskKey: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('removeTask');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('removeTask', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('removeTask', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findTask(record, taskKey);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-task',
						'THE FAIL-CLOSED LAW',
						`removeTask: no task '${showValue(taskKey)}' in the template (a malformed taskKey fails closed as unknown-task)`,
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `removed the task '${existing.taskKey}' (THE REMOVE+RE-ADD LAW: a changed taskKey is a NEW task; removing the last task is legal while composing - the empty-tasks floor fires only at finalize)`;
			const next: WorkflowTemplateRecord = {
				templateId: record.templateId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				tasks: record.tasks.filter((entry) => entry.taskKey !== existing.taskKey),
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-task', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: TemplatesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: TEMPLATES_CONTRACTS_VERSION,
				op: 'remove-task',
				templateId: record.templateId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: existing,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.templateId, next);
			const persistResult = await persist(line, nextRecords);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextRecords);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return recordOutcome(next);
		},
		async finalizeTemplate(templateId: unknown, ontology: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('finalizeTemplate');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('finalizeTemplate', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('finalizeTemplate', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			// THE TERM-RESOLUTION LAW, station 1: the CALLER-SUPPLIED ontology must
			// pass the REAL DH-04 record walk AND sit at 'composed' (fail closed - a
			// malformed authority resolves nothing, never a silent skip; the kit
			// NEVER injects an ontology authority of its own).
			const walked = validateOntologyRecord(ontology);
			if (!walked.ok) {
				return {
					ok: false,
					refusal: refused(
						'malformed-ontology',
						'THE TERM-RESOLUTION LAW',
						'finalizeTemplate: the caller-supplied ontology record fails the REAL DH-04 validateOntologyRecord walk (a malformed authority resolves nothing - fail closed, never a silent skip)',
					),
				};
			}
			const ontologyRecord = walked.value;
			if (ontologyRecord.stage !== 'composed') {
				return {
					ok: false,
					refusal: refused(
						'malformed-ontology',
						'THE TERM-RESOLUTION LAW',
						`finalizeTemplate: the caller-supplied ontology record is at the '${ontologyRecord.stage}' stage - termRefs resolve ONLY against a COMPOSED ontology (the frozen terminology)`,
						[ontologyRecord.stage],
					),
				};
			}
			// THE DH-01 FLOOR: at least one task at finalize (never the record shape).
			if (record.tasks.length === 0) {
				return {
					ok: false,
					refusal: refused(
						'empty-tasks',
						'THE FAIL-CLOSED LAW',
						'finalizeTemplate: the template must compose at least one task (THE DH-01 FLOOR - compose tasks with addTask first; the floor fires HERE, never the record shape)',
						['tasks'],
					),
				};
			}
			// THE NO-DANGLING-REF boundary: every non-empty termRef must resolve against
			// the caller-supplied composed ontology's terms (each offender named once,
			// first-seen order).
			const known = new Set<string>(ontologyRecord.terms.map((term) => term.term));
			const reported = new Set<string>();
			const dangling: string[] = [];
			for (const task of record.tasks) {
				for (const ref of task.termRefs) {
					if (!known.has(ref) && !reported.has(ref)) {
						reported.add(ref);
						dangling.push(ref);
					}
				}
			}
			if (dangling.length > 0) {
				return {
					ok: false,
					refusal: refused(
						'dangling-term-ref',
						'THE TERM-RESOLUTION LAW',
						`finalizeTemplate: every non-empty termRef must resolve against the caller-supplied composed ontology record '${ontologyRecord.ontologyId}' (a dangling termRef is never a silent skip; the two-phase law allowed these while composing)`,
						dangling,
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `finalized the workflow template (${record.tasks.length} task(s); composing -> composed, TERMINAL - the template is FROZEN, a changed template is a NEW template; every termRef resolved against the caller-supplied composed ontology '${ontologyRecord.ontologyId}')`;
			const next: WorkflowTemplateRecord = {
				templateId: record.templateId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composed',
				tasks: record.tasks.map((task) => ({ taskKey: task.taskKey, summary: task.summary, termRefs: [...task.termRefs] })),
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-template', law: 'THE TERM-RESOLUTION LAW', detail }],
			};
			const line: TemplatesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: TEMPLATES_CONTRACTS_VERSION,
				op: 'finalize-template',
				templateId: record.templateId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composed',
				law: 'THE TERM-RESOLUTION LAW',
				payload: ontologyRecord,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.templateId, next);
			const persistResult = await persist(line, nextRecords);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextRecords);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return recordOutcome(next);
		},
		async emitWorkflowRef(templateId: unknown): Promise<TemplatesRefOutcome> {
			const disposedRefusal = refuseIfDisposed('emitWorkflowRef');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('emitWorkflowRef', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			if (record.stage !== 'composed') {
				return {
					ok: false,
					refusal: refused(
						'premature-op',
						'THE FORWARD-ONLY LAW',
						`emitWorkflowRef: the record is at the '${record.stage}' stage - a workflowRef is emitted ONLY from a COMPOSED template (finalizeTemplate first)`,
						[record.stage],
					),
				};
			}
			// The emitted ref IS the composed template's id (the review composition's
			// workflowRefs family member form: a string, duplicate-free by identity).
			// A pure read: no state change, no ledger line - the ref is deterministic.
			return { ok: true, workflowRef: record.templateId };
		},
		async inspectTemplate(templateId: unknown): Promise<TemplatesRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('inspectTemplate');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('inspectTemplate', templateId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			return recordOutcome(lookup.record);
		},
		async listTemplates(filter?: unknown): Promise<TemplatesListOutcome> {
			const disposedRefusal = refuseIfDisposed('listTemplates');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (filter !== undefined) {
				if (!isRecord(filter)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listTemplates: the filter must be an object (or absent)') };
				}
				const filterRecord = filter as Record<string, unknown>;
				const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'harnessId');
				if (unknownFields.length > 0) {
					return {
						ok: false,
						refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listTemplates: the filter carries an unknown field (stage / industry / harnessId only)', unknownFields),
					};
				}
				if (filterRecord.stage !== undefined && !isTemplateStage(filterRecord.stage)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listTemplates: the stage filter value is not a member of the frozen TEMPLATE_STAGES list') };
				}
				if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listTemplates: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
				}
				if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listTemplates: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
				}
			}
			const ids = [...records.keys()].sort();
			const listed: WorkflowTemplateRecord[] = [];
			for (const id of ids) {
				const entry = records.get(id) as WorkflowTemplateRecord;
				if (filter !== undefined && !matchesRecordFilter(entry, filter as Record<string, unknown>)) {
					continue;
				}
				listed.push(copyRecord(entry));
			}
			return { ok: true, records: listed };
		},
		dispose(): void {
			disposed = true;
		},
	};
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface TemplatesLedgerReplay {
	readonly lines: readonly TemplatesOpsLedgerLine[];
	readonly records: Map<string, WorkflowTemplateRecord>;
}

/** Parses and validates the whole templates ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayTemplatesLedger(ledgerText: string | null): TemplatesLedgerReplay | TemplatesKitRefusal {
	if (ledgerText === null || ledgerText.length === 0) {
		return { lines: [], records: new Map<string, WorkflowTemplateRecord>() };
	}
	if (!ledgerText.endsWith('\n')) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates ledger does not end with a complete line (a torn append - never a silent skip)');
	}
	const records = new Map<string, WorkflowTemplateRecord>();
	const lines: TemplatesOpsLedgerLine[] = [];
	const rawLines = ledgerText.split('\n');
	rawLines.pop();
	for (let i = 0; i < rawLines.length; i += 1) {
		if (rawLines[i].length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${i + 1} is empty`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawLines[i]);
		} catch {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
		}
		const torn = validateTemplatesLedgerLine(parsed, i + 1, records);
		if (torn !== null) {
			return torn;
		}
		const record = parsed as Record<string, unknown>;
		const line: TemplatesOpsLedgerLine = {
			seq: record.seq as number,
			at: record.at as string,
			contractVersion: record.contractVersion as string,
			op: record.op as TemplateOpName,
			templateId: record.templateId as string,
			harnessId: record.harnessId as string,
			fromStage: record.fromStage as TemplateStage | null,
			toStage: record.toStage as TemplateStage,
			law: record.law as string,
			payload: record.payload as TemplatesOpsLedgerLine['payload'],
			detail: record.detail as string,
		};
		applyTemplatesLine(records, line);
		lines.push(line);
	}
	return { lines, records };
}

/** Validates one parsed templates ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateTemplatesLedgerLine(parsed: unknown, lineNo: number, records: Map<string, WorkflowTemplateRecord>): TemplatesKitRefusal | null {
	if (!isRecord(parsed)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is not a JSON object`);
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...TEMPLATES_LEDGER_LINE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
	}
	if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
	}
	if (record.contractVersion !== TEMPLATES_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${TEMPLATES_CONTRACTS_VERSION}' is known (the single-version law; the six-key record carries no version field, so THIS is the law's live station)`);
	}
	if (!isTemplateOpName(record.op)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
	}
	if (!isTemplateId(record.templateId)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries a malformed record id`);
	}
	if (!isHarnessId(record.harnessId)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
	}
	if (record.fromStage !== null && !isTemplateStage(record.fromStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries an unknown fromStage`);
	}
	if (!isTemplateStage(record.toStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries an unknown toStage`);
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries no law name (the provenance law)`);
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries no provenance detail`);
	}
	const op = record.op as TemplateOpName;
	const template = records.get(record.templateId as string);
	if (op === 'begin-template') {
		if (record.fromStage !== null || record.toStage !== 'composing') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
		}
		if (!isHarnessIndustry(record.payload)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
		}
		if (template !== undefined) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} begins a duplicate record id`);
		}
		return null;
	}
	if (template === undefined) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} advances an unknown record`);
	}
	if (template.stage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
	}
	if (op === 'finalize-template') {
		if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
		}
		// The finalize payload is the caller-supplied composed ontology record AS IT
		// STOOD: the replay re-proves the REAL DH-04 walk, the composed stage, the
		// empty-tasks floor AND the NO-DANGLING-REF resolution from the ledger alone.
		const walked = validateOntologyRecord(record.payload);
		if (!walked.ok) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a finalize line carrying an invalid ontology payload (the REAL DH-04 record walk)`);
		}
		if (walked.value.stage !== 'composed') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a finalize line whose ontology payload is not at the 'composed' stage (THE TERM-RESOLUTION LAW)`);
		}
		if (template.tasks.length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} finalizes an empty template (THE DH-01 FLOOR - the replay re-validates the boundary law)`);
		}
		const known = new Set<string>(walked.value.terms.map((term) => term.term));
		const dangling = template.tasks.flatMap((task) => task.termRefs).filter((ref) => ref.length > 0 && !known.has(ref));
		if (dangling.length > 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries a dangling termRef payload resolution (${showList(dangling)}) - THE TERM-RESOLUTION LAW re-proved from the ledger alone`);
		}
		return null;
	}
	if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} is a task-op line outside the composing->composing self edge (the template composes gradually)`);
	}
	const entry = validateTaskEntry(record.payload);
	if (!entry.ok) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} carries an invalid task payload`);
	}
	const payloadTask = entry.value;
	if (op === 'add-task') {
		if (template.tasks.some((task) => task.taskKey === payloadTask.taskKey)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} adds a duplicate taskKey '${payloadTask.taskKey}'`);
		}
		if (template.tasks.length >= MAX_TASKS) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} exceeds the MAX_TASKS (${MAX_TASKS}) composition bound`);
		}
		return null;
	}
	const standing = template.tasks.find((task) => task.taskKey === payloadTask.taskKey);
	if (standing === undefined) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} advances an unknown task '${payloadTask.taskKey}'`);
	}
	if (op === 'replace-task-summary') {
		// The immutable-parts cross-check: only the summary may differ (a task's key
		// is its identity and the termRefs are carried unchanged).
		if (JSON.stringify(payloadTask.termRefs) !== JSON.stringify(standing.termRefs)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} replaces a task whose termRefs do not match the record's task as it stood (THE REMOVE+RE-ADD LAW)`);
		}
		return null;
	}
	// remove-task: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
	if (payloadTask.summary !== standing.summary || JSON.stringify(payloadTask.termRefs) !== JSON.stringify(standing.termRefs)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: templates ledger line ${lineNo} removes a task entry that does not match the record's template as it stood`);
	}
	return null;
}

/** Applies one validated templates ledger line to the replay records (pure fold). */
function applyTemplatesLine(records: Map<string, WorkflowTemplateRecord>, line: TemplatesOpsLedgerLine): void {
	if (line.op === 'begin-template') {
		records.set(line.templateId, {
			templateId: line.templateId,
			harnessId: line.harnessId,
			industry: line.payload as HarnessIndustry,
			stage: line.toStage,
			tasks: [],
			history: [noteOf(line)],
		});
		return;
	}
	const record = records.get(line.templateId);
	if (record === undefined) {
		return;
	}
	const base: WorkflowTemplateRecord = {
		...record,
		stage: line.toStage,
		history: [...record.history, noteOf(line)],
	};
	let next: WorkflowTemplateRecord;
	if (line.op === 'add-task') {
		next = { ...base, tasks: [...record.tasks, line.payload as TaskTemplateEntry] };
	} else if (line.op === 'replace-task-summary') {
		const replacement = line.payload as TaskTemplateEntry;
		next = { ...base, tasks: record.tasks.map((task) => (task.taskKey === replacement.taskKey ? replacement : task)) };
	} else if (line.op === 'remove-task') {
		const removed = line.payload as TaskTemplateEntry;
		next = { ...base, tasks: record.tasks.filter((task) => task.taskKey !== removed.taskKey) };
	} else {
		next = { ...base, tasks: record.tasks.map((task) => ({ taskKey: task.taskKey, summary: task.summary, termRefs: [...task.termRefs] })) };
	}
	records.set(line.templateId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: TemplatesOpsLedgerLine): TemplateTransitionNote {
	return {
		at: line.at,
		fromStage: line.fromStage,
		toStage: line.toStage,
		op: line.op,
		law: line.law,
		detail: line.detail,
	};
}

/** Cross-checks the templates envelope against the replay; returns the typed refusal or null. */
function crossCheckTemplatesEnvelope(
	envelopeText: string | null,
	lineCount: number,
	replayed: Map<string, WorkflowTemplateRecord>,
): TemplatesKitRefusal | null {
	if (envelopeText === null) {
		if (lineCount === 0) {
			return null;
		}
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: the templates envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	let parsedEnvelope: unknown;
	try {
		parsedEnvelope = JSON.parse(envelopeText);
	} catch {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope is not valid JSON');
	}
	if (!isRecord(parsedEnvelope)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope is not a JSON object');
	}
	const envelope = parsedEnvelope as Record<string, unknown>;
	const keys = Object.keys(envelope).sort();
	const expected = [...TEMPLATES_ENVELOPE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope is structurally invalid (the frozen three-key envelope schema)');
	}
	if (envelope.contractVersion !== TEMPLATES_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadTemplatesKit: the templates envelope carries contract version ${showValue(envelope.contractVersion)} - only '${TEMPLATES_CONTRACTS_VERSION}' is known (the single-version law)`);
	}
	if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope carries a malformed seq');
	}
	if (!Array.isArray(envelope.records)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope carries a malformed records array');
	}
	const envelopeSeq = envelope.seq as number;
	if (envelopeSeq > lineCount) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: the templates envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
	}
	if (envelopeSeq < lineCount) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: the templates envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	const envelopeRecordMap = new Map<string, WorkflowTemplateRecord>();
	for (let i = 0; i < envelope.records.length; i += 1) {
		const entry = envelope.records[i];
		if (!validateWorkflowTemplateRecord(entry).ok) {
			return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadTemplatesKit: the templates envelope's records[${i}] is not a valid workflow-template record`);
		}
		const templateRecord = entry as WorkflowTemplateRecord;
		envelopeRecordMap.set(templateRecord.templateId, templateRecord);
	}
	const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
	const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
	if (replayBytes !== envelopeBytes) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadTemplatesKit: the templates envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
	}
	return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: TemplatesOpsLedgerLine): string {
	return JSON.stringify({
		seq: line.seq,
		at: line.at,
		contractVersion: line.contractVersion,
		op: line.op,
		templateId: line.templateId,
		harnessId: line.harnessId,
		fromStage: line.fromStage,
		toStage: line.toStage,
		law: line.law,
		payload: payloadObject(line.payload),
		detail: line.detail,
	});
}

/** Builds the canonical fixed-key-order object of a ledger-line payload (the industry string, the task entry, or the ontology record). */
function payloadObject(payload: TemplatesOpsLedgerLine['payload']): HarnessIndustry | Record<string, unknown> | null {
	if (payload === null) {
		return null;
	}
	if (typeof payload === 'string') {
		return payload;
	}
	if ('ontologyId' in payload) {
		return {
			ontologyId: payload.ontologyId,
			harnessId: payload.harnessId,
			industry: payload.industry,
			stage: payload.stage,
			terms: payload.terms.map((term) => ({ term: term.term, definition: term.definition })),
			history: payload.history.map((note) => ({
				at: note.at,
				fromStage: note.fromStage,
				toStage: note.toStage,
				op: note.op,
				law: note.law,
				detail: note.detail,
			})),
		};
	}
	return { taskKey: payload.taskKey, summary: payload.summary, termRefs: [...payload.termRefs] };
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by templateId). */
function envelopeBytes(seq: number, nextRecords: Map<string, WorkflowTemplateRecord>): string {
	const ids = [...nextRecords.keys()].sort();
	const listed = ids.map((id) => nextRecords.get(id) as WorkflowTemplateRecord);
	return `{"contractVersion":${JSON.stringify(TEMPLATES_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
		.map((record) => serializeWorkflowTemplateRecord(record))
		.join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, WorkflowTemplateRecord>): string {
	return envelopeBytes(seq, records);
}

/** Reads a text file through the port; a missing file (ENOENT) reads as null. */
async function readText(port: HarnessFsPort, path: string): Promise<string | null> {
	try {
		return await port.readFile(path, 'utf8');
	} catch (error) {
		if (error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') {
			return null;
		}
		throw error;
	}
}

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function matchesRecordFilter(record: WorkflowTemplateRecord, filter: Record<string, unknown>): boolean {
	if (filter.stage !== undefined && record.stage !== filter.stage) {
		return false;
	}
	if (filter.industry !== undefined && record.industry !== filter.industry) {
		return false;
	}
	if (filter.harnessId !== undefined && record.harnessId !== filter.harnessId) {
		return false;
	}
	return true;
}
