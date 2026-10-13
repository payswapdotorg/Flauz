/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-004 domain-ontology kit: the deterministic staged-record runtime
 * over the ontology contract vocabulary AND the REAL DH-01 harness
 * surfaces (imported, never re-implemented - THE IMPORT LAW, this
 * wave's charter). The kit walks a record begin -> addTerm /
 * replaceTermDefinition / removeTerm -> finalizeOntology:
 * beginOntology binds the record to a harness through the REAL DH-01
 * harness-id alphabet (the FORM law - isHarnessId, imported by
 * reference; the EXISTENCE binding is the caller's wiring and the
 * AGREEMENT with the bound harness's own industry is the caller's
 * composition law, both pinned in the battery through the real DH-01
 * kit) and mints the flauz:ont:<16-hex> id from the injected rng (the
 * terminology is industry-scoped over the REAL frozen
 * HARNESS_INDUSTRIES list, imported by reference); the term ops apply
 * the term laws (shape, bounds, uniqueness, the MAX_TERMS bound);
 * finalizeOntology freezes the terminology (composing -> composed,
 * TERMINAL - the empty-terms floor fires there, never the record
 * shape). THE REMOVE+RE-ADD LAW: a term is its identity - immutable
 * once added; replaceTermDefinition replaces ONLY the definition; a
 * changed term is a NEW term (remove, then re-add). Removing the last
 * term is LEGAL while composing (the floor fires only at finalize).
 * NO catalog is injected: the ontology resolves nothing (THE CONTENT
 * LAW: no per-industry term templates are shipped - the wave is the
 * LAYER, the machinery; the caller composes the terms; this family
 * never invents them).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * DH-01/DH-02/DH-03 laws EXACTLY): the same .flauz/harness subtree,
 * distinct files - the append-only ops ledger
 * .flauz/harness/ontology-ops.jsonl (one canonical JSON line per
 * applied op, the seq strictly increasing and equal to the line
 * number) and the envelope .flauz/harness/ontology-records.json ({
 * contractVersion, seq, records }). The ledger is authoritative;
 * loadOntologyKit replays it and cross-checks the envelope
 * byte-for-byte (a torn or missing line is the typed E_LEDGER_TORN; a
 * divergent envelope is the typed E_ENVELOPE_MISMATCH - never
 * silently rebuilt). A version-bearing surface (a ledger line or the
 * envelope) carrying another contract version is the typed
 * version-mismatch - THE SINGLE-VERSION LAW's live station in this
 * family (the six-key record carries no version field). Lazy
 * persistence (the subtree lands with the first applied op); a fresh
 * kit never appends over a non-empty ontology ledger - reopen with
 * loadOntologyKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE IMPORT LAW: the frozen vocabularies, the harness-id alphabet,
 *   the staged-session architecture and the persistence pattern are
 *   the LANDED DH-01/DH-02/DH-03 surfaces - imported from the real
 *   modules (../../contract/common/domainHarnessContract.js, the
 *   DH-01 kit's OWN HarnessFsPort type), never re-declared, never
 *   shadowed (the battery pins the imports).
 * - THE FORWARD-ONLY LAW / THE APPEND-ONLY LINEAGE LAW: composing ->
 *   composed; 'composed' is TERMINAL (the terminology is FROZEN;
 *   every mutating op on a composed record refuses with the typed
 *   stale-stage refusal); the DH-012 Lab-driven specialization mints
 *   NEW lineage records - nothing mutates a composed one.
 * - THE REMOVE+RE-ADD LAW: a term is its identity - immutable once
 *   added. replaceTermDefinition replaces ONLY the definition; a
 *   changed term is a NEW term (remove, then re-add). Removing the
 *   last term is LEGAL while composing (the empty-terms floor fires
 *   only at finalize).
 * - THE NO-FORK LAW: the ontology alphabet is configuration only;
 *   the term-entry walk rejects execution material before anything is
 *   applied; a term grants NOTHING by itself.
 * - THE CONTENT LAW: NO per-industry term templates - the wave ships
 *   the LAYER, not domain content (the DH-002 "industry role
 *   templates are LATER waves" precedent, applied to terms); an
 *   invented legal/medical/finance vocabulary would be an unsourced
 *   fork of domain truth. The caller composes the terms.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock, the rng and the fsPort are INJECTED seams; the persisted
 *   bytes are canonical fixed-key-order JSON; restart determinism is
 *   pinned by the battery. The factory consumes exactly ONE clock
 *   read and ONE rng read (there is no inner kit to re-validate the
 *   seams; the battery pins the exact count).
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError (every
 *   factory precondition checked with the exact DH-01 message shape);
 *   every domain refusal is a typed record { reason, law, detail,
 *   items? } naming the violated law and the offending items - never
 *   a string throw, never a silent skip, never a partial effect (a
 *   refused op leaves the record unchanged); payload-walk refusals
 *   carry the COMPLETE contract rejection table (never first-only).
 * - THE SINGLE-VERSION LAW: ONTOLOGY_CONTRACTS_VERSION is declared
 *   ONCE in the contract module, re-carried by this kit (the
 *   re-export); DOMAIN_HARNESS_CONTRACTS_VERSION,
 *   ONBOARDING_CONTRACTS_VERSION and ROLES_CONTRACTS_VERSION are
 *   re-carried through the re-export chain; the battery pins every
 *   copy equal.
 * - THE APPEND-ONLY LEDGER LAW: as the persistence paragraph above.
 * - THE DISPOSE LAW: every operation after dispose rejects with the
 *   typed DISPOSED refusal.
 */

import {
	MAX_TERMS,
	ONTOLOGY_CONTRACTS_VERSION,
	ONTOLOGY_ID_PREFIX,
	ONTOLOGY_REJECTION_REASONS,
	isHarnessId,
	isHarnessIndustry,
	isOntologyId,
	isOntologyOpName,
	isOntologyStage,
	serializeOntologyRecord,
	validateOntologyRecord,
	validateTermDefinition,
	validateTermEntry,
} from './ontologyContract.js';
import type {
	HarnessIndustry,
	OntologyOpName,
	OntologyRejection,
	OntologyTerm,
	OntologyTransitionNote,
	DomainOntologyRecord,
	OntologyStage,
} from './ontologyContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ONTOLOGY_CONTRACTS_VERSION } from './ontologyContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-02 version, re-carried by reference. */
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-03 version, re-carried by reference. */
export { ROLES_CONTRACTS_VERSION } from '../../roles/common/rolesContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as DH-01/DH-02/DH-03, distinct file). */
export const ONTOLOGY_ENVELOPE_RELATIVE_PATH = '.flauz/harness/ontology-records.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const ONTOLOGY_LEDGER_RELATIVE_PATH = '.flauz/harness/ontology-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the ELEVEN-KEY line: the harness link is its own column - the
 * record BINDS to a harness through the REAL DH-01 id alphabet; the
 * payload carries the industry on begin, the term entry on the term
 * ops, null on finalize).
 */
export const ONTOLOGY_LEDGER_LINE_SCHEMA_KEYS = [
	'seq',
	'at',
	'contractVersion',
	'op',
	'ontologyId',
	'harnessId',
	'fromStage',
	'toStage',
	'law',
	'payload',
	'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const ONTOLOGY_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'records'] as const;

/**
 * One append-only domain-ontology ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the record id, the
 * BOUND harness id (the REAL DH-01 flauz:hrn:<16-hex> form, carried
 * on every line), the stage edge walked (fromStage null ONLY on the
 * begin line; the add-term / replace-term-definition / remove-term
 * lines walk the composing->composing self edge - the terminology
 * composes gradually), the granting law, the canonical op payload
 * (the industry on begin; the added / replacement / removed-as-it-stood
 * term entry on the term ops; null on finalize), and the deterministic
 * detail sentence.
 */
export interface OntologyOpsLedgerLine {
	readonly seq: number;
	readonly at: string;
	readonly contractVersion: string;
	readonly op: OntologyOpName;
	readonly ontologyId: string;
	readonly harnessId: string;
	readonly fromStage: OntologyStage | null;
	readonly toStage: OntologyStage;
	readonly law: string;
	readonly payload: HarnessIndustry | OntologyTerm | null;
	readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ONTOLOGY_REJECTION_REASONS):
 *   DISPOSED             - THE DISPOSE LAW: the kit was disposed;
 *                          every operation after dispose rejects;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted record id);
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing ontology ledger line, a structurally
 *                          invalid or out-of-order line, an unknown op
 *                          or an illegal stage edge inside the ledger,
 *                          or a fresh kit attempting to append over an
 *                          existing non-empty ontology ledger (reopen
 *                          with loadOntologyKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the ontology
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   ONTOLOGY_IO          - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the ontology family's own files;
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listOntologies
 *                          received an unknown filter field or a
 *                          non-member filter value.
 * The contract's version-mismatch station fires at THIS layer for
 * every version-bearing persisted surface (a ledger line or the
 * envelope carrying another contract version) - THE SINGLE-VERSION
 * LAW's live station in this family.
 */
export const ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS = [
	'DISPOSED',
	'CORRUPT_SEAM',
	'E_LEDGER_TORN',
	'E_ENVELOPE_MISMATCH',
	'ONTOLOGY_IO',
	'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 18 domain reasons plus the kit-layer extras. */
export const ONTOLOGY_KIT_REFUSAL_REASONS = [
	...ONTOLOGY_REJECTION_REASONS,
	...ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type OntologyKitRefusalReason = (typeof ONTOLOGY_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isOntologyKitRefusalReason(value: unknown): value is OntologyKitRefusalReason {
	return (ONTOLOGY_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, and
 * the COMPLETE contract rejection table (payload-walk refusals -
 * never first-only).
 */
export interface OntologyKitRefusal {
	readonly reason: OntologyKitRefusalReason;
	readonly law: string;
	readonly detail: string;
	readonly items?: readonly string[];
	/** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
	readonly rejections?: readonly OntologyRejection[];
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog: the ontology resolves nothing (THE CONTENT LAW - the
 * layer, never the domain content).
 */
export interface OntologyKitOptions {
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
export type OntologyRecordOutcome =
	| { readonly ok: true; readonly record: DomainOntologyRecord }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/** The list outcome: ok carries the ontologyId-ordered honest records; failure carries the typed refusal. */
export type OntologyListOutcome =
	| { readonly ok: true; readonly records: readonly DomainOntologyRecord[] }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type OntologyLoadOutcome =
	| { readonly ok: true; readonly kit: OntologyKit }
	| { readonly ok: false; readonly refusal: OntologyKitRefusal };

/**
 * The deterministic domain-ontology kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the record unchanged (inspectable before and
 * after).
 */
export interface OntologyKit {
	beginOntology(harnessId: unknown, industry: unknown): Promise<OntologyRecordOutcome>;
	addTerm(ontologyId: unknown, term: unknown): Promise<OntologyRecordOutcome>;
	replaceTermDefinition(ontologyId: unknown, term: unknown, definition: unknown): Promise<OntologyRecordOutcome>;
	removeTerm(ontologyId: unknown, term: unknown): Promise<OntologyRecordOutcome>;
	finalizeOntology(ontologyId: unknown): Promise<OntologyRecordOutcome>;
	inspectOntology(ontologyId: unknown): Promise<OntologyRecordOutcome>;
	listOntologies(filter?: unknown): Promise<OntologyListOutcome>;
	dispose(): void;
}

/**
 * Creates a domain-ontology kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02/DH-03
 * factory walk EXACTLY (the same preconditions, the same message
 * shapes, the createOntologyKit prefix): the options shape (clock /
 * rng), the clock's first read (a non-empty ISO string), the rng's
 * first read (exactly 16 lowercase hex chars - the id-minting law),
 * and the fsPort/root pairing (both or neither; the port must expose
 * readFile / writeFile / appendFile / mkdir). The factory consumes
 * exactly ONE clock read and ONE rng read (there is no inner kit to
 * re-validate the seams - the battery pins the exact count). The kit
 * starts with ZERO records; persistence is LAZY (the .flauz/harness
 * subtree lands with the first applied op; a fresh kit never appends
 * over an existing non-empty ontology ledger - reopen with
 * loadOntologyKit).
 */
export function createOntologyKit(options: OntologyKitOptions): OntologyKit {
	const bound = validateKitOptions(options, false, 'createOntologyKit');
	return buildOntologyKit(bound, { seq: 0, records: new Map<string, DomainOntologyRecord>() });
}

/**
 * Reopens a persisted domain-ontology kit: replays the append-only
 * ontology ops ledger (the authoritative surface - each line
 * re-validated: the frozen eleven-key line schema, the REAL DH-01
 * harness-id alphabet on every line, the op's stage edge, the
 * record's walk order, the payload's full validation, the MAX_TERMS
 * bound, the remove line's entry-as-it-stood cross-check, the
 * finalize floor), and cross-checks the envelope byte-for-byte
 * against the replay-built state. A torn or missing ontology ledger
 * line is the typed E_LEDGER_TORN; a divergent, missing or malformed
 * envelope is the typed E_ENVELOPE_MISMATCH (never silently rebuilt);
 * a version-bearing surface carrying another contract version is the
 * typed version-mismatch (THE SINGLE-VERSION LAW's live station); a
 * refused fs port is the typed ONTOLOGY_IO. A fresh root (no files)
 * reopens as an empty kit. The options require BOTH fsPort and root
 * (the load is a persistence-surface operation).
 */
export async function loadOntologyKit(options: OntologyKitOptions): Promise<OntologyLoadOutcome> {
	const bound = validateKitOptions(options, true, 'loadOntologyKit');
	const fsPort = bound.fsPort as HarnessFsPort;
	const ledgerPath = `${bound.root}/${ONTOLOGY_LEDGER_RELATIVE_PATH}`;
	const envelopePath = `${bound.root}/${ONTOLOGY_ENVELOPE_RELATIVE_PATH}`;
	try {
		await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
	} catch (error) {
		return { ok: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `loadOntologyKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
	}
	let ledgerText: string | null;
	try {
		ledgerText = await readText(fsPort, ledgerPath);
	} catch (error) {
		return { ok: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `loadOntologyKit: the fs port refused the ontology ledger read: ${toMessage(error)}`) };
	}
	let envelopeText: string | null;
	try {
		envelopeText = await readText(fsPort, envelopePath);
	} catch (error) {
		return { ok: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `loadOntologyKit: the fs port refused the ontology envelope read: ${toMessage(error)}`) };
	}
	const replay = replayOntologyLedger(ledgerText);
	if (!('lines' in replay)) {
		return { ok: false, refusal: replay };
	}
	const crossCheck = crossCheckOntologyEnvelope(envelopeText, replay.lines.length, replay.records);
	if (crossCheck !== null) {
		return { ok: false, refusal: crossCheck };
	}
	return { ok: true, kit: buildOntologyKit(bound, { seq: replay.lines.length, records: replay.records }) };
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
	readonly rng: () => string;
	readonly fsPort: HarnessFsPort | null;
	readonly root: string | null;
}

interface OntologyKitState {
	readonly seq: number;
	readonly records: ReadonlyMap<string, DomainOntologyRecord>;
}

/** The persist fold's result: applied means the ontology ledger line landed (the ledger is authoritative). */
type PersistResult =
	| { readonly applied: false; readonly refusal: OntologyKitRefusal }
	| { readonly applied: true; readonly refusal: OntologyKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: OntologyKitRefusal };

function validateKitOptions(options: OntologyKitOptions, requirePersistence: boolean, factoryName: 'createOntologyKit' | 'loadOntologyKit'): BoundOptions {
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
			`${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${ONTOLOGY_ID_PREFIX}<16-hex>)`,
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
	reason: OntologyKitRefusalReason,
	law: string,
	detail: string,
	items?: readonly string[],
): OntologyKitRefusal {
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
	outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly OntologyRejection[] },
): OntologyKitRefusal {
	const first = outcome.rejections[0];
	return {
		reason: first.reason,
		law: first.law,
		detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
		items: first.items,
		rejections: outcome.rejections,
	};
}

function buildOntologyKit(bound: BoundOptions, seed: OntologyKitState): OntologyKit {
	let disposed = false;
	let mutableSeq = seed.seq;
	const records = new Map<string, DomainOntologyRecord>(seed.records);
	const persisted = bound.fsPort !== null && bound.root !== null;
	const fsPort = bound.fsPort;
	const ledgerPath = bound.root !== null ? `${bound.root}/${ONTOLOGY_LEDGER_RELATIVE_PATH}` : '';
	const envelopePath = bound.root !== null ? `${bound.root}/${ONTOLOGY_ENVELOPE_RELATIVE_PATH}` : '';
	let dirEnsured = false;
	// A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
	// (its ledger preexists; only a fresh createOntologyKit guards the append).
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

	function copyRecord(record: DomainOntologyRecord): DomainOntologyRecord {
		return JSON.parse(serializeOntologyRecord(record)) as DomainOntologyRecord;
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
	async function persist(line: OntologyOpsLedgerLine, nextRecords: Map<string, DomainOntologyRecord>): Promise<PersistResult> {
		if (!persisted || fsPort === null) {
			mutableSeq = line.seq;
			return { applied: true, refusal: null };
		}
		if (!ledgerGuardDone) {
			let existing: string | null;
			try {
				existing = await readText(fsPort, ledgerPath);
			} catch (error) {
				return { applied: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the ontology ledger read: ${toMessage(error)}`) };
			}
			if (existing !== null && existing.trim().length > 0) {
				return {
					applied: false,
					refusal: refused(
						'E_LEDGER_TORN',
						'THE APPEND-ONLY LEDGER LAW',
						'persist: the ontology ledger already carries lines - reopen with loadOntologyKit (a fresh kit never appends over an existing ledger)',
					),
				};
			}
			ledgerGuardDone = true;
		}
		if (!dirEnsured) {
			try {
				await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
			} catch (error) {
				return { applied: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
			}
			dirEnsured = true;
		}
		try {
			await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
		} catch (error) {
			return { applied: false, refusal: refused('ONTOLOGY_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the ontology ledger append: ${toMessage(error)} (nothing was applied)`) };
		}
		mutableSeq = line.seq;
		try {
			await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextRecords));
		} catch (error) {
			return {
				applied: true,
				refusal: refused(
					'ONTOLOGY_IO',
					'THE FAIL-CLOSED LAW',
					`persist: the ontology ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
				),
			};
		}
		return { applied: true, refusal: null };
	}

	function commit(nextRecords: Map<string, DomainOntologyRecord>): void {
		records.clear();
		for (const [id, record] of nextRecords) {
			records.set(id, record);
		}
	}

	function recordOutcome(record: DomainOntologyRecord): OntologyRecordOutcome {
		return { ok: true, record: copyRecord(record) };
	}

	/** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
	function refuseIfDisposed(opName: string): OntologyKitRefusal | null {
		if (disposed) {
			return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
		}
		return null;
	}

	/** The unknown-record guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
	function lookupRecord(opName: string, ontologyId: unknown): { record: DomainOntologyRecord } | { refusal: OntologyKitRefusal } {
		if (!isOntologyId(ontologyId)) {
			return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${showValue(ontologyId)}' (a malformed id fails closed as unknown-record)`) };
		}
		const record = records.get(ontologyId);
		if (record === undefined) {
			return { refusal: refused('unknown-record', 'THE FAIL-CLOSED LAW', `${opName}: no record with id '${ontologyId}'`) };
		}
		return { record };
	}

	/**
	 * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
	 * 'composing' stage (a composed record is past them - stale-stage,
	 * 'composed' is TERMINAL, THE APPEND-ONLY LINEAGE LAW).
	 */
	function stageGuard(opName: string, record: DomainOntologyRecord): OntologyKitRefusal | null {
		if (record.stage === 'composing') {
			return null;
		}
		return refused(
			'stale-stage',
			'THE FORWARD-ONLY LAW',
			`${opName}: the record is at the '${record.stage}' stage - the terminology is FROZEN ('composed' is TERMINAL; the DH-012 Lab specialization mints NEW lineage records, never a mutation - THE APPEND-ONLY LINEAGE LAW) (THE FORWARD-ONLY LAW)`,
			[record.stage],
		);
	}

	/** The term lookup for replace / remove (a malformed name fails closed as unknown-term). */
	function findTerm(record: DomainOntologyRecord, term: unknown): OntologyTerm | null {
		if (typeof term !== 'string') {
			return null;
		}
		const found = record.terms.find((entry) => entry.term === term);
		return found === undefined ? null : found;
	}

	return {
		async beginOntology(harnessId: unknown, industry: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('beginOntology');
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
						`beginOntology: the harnessId must satisfy the REAL DH-01 harness-id alphabet (flauz:hrn:<16-hex>, imported by reference - the FORM law; the EXISTENCE binding is the caller's wiring, never this layer's)`,
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
						`beginOntology: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the ontology is industry-scoped)`,
						[showValue(industry)],
					),
				};
			}
			const hex = bound.rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginOntology: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
			}
			const ontologyId = `${ONTOLOGY_ID_PREFIX}${hex}`;
			if (records.has(ontologyId)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginOntology: the injected rng minted a duplicate record id (the id-minting seam is corrupt)') };
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `began the domain-ontology record bound to harness '${harnessId}' over the '${industry}' industry (the walk enters the composing stage with ZERO terms; the caller composes the terms - this family never invents them, THE CONTENT LAW)`;
			const record: DomainOntologyRecord = {
				ontologyId,
				harnessId,
				industry,
				stage: 'composing',
				terms: [],
				history: [
					{ at, fromStage: null, toStage: 'composing', op: 'begin-ontology', law: 'THE FORWARD-ONLY LAW', detail },
				],
			};
			const line: OntologyOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONTOLOGY_CONTRACTS_VERSION,
				op: 'begin-ontology',
				ontologyId,
				harnessId,
				fromStage: null,
				toStage: 'composing',
				law: 'THE FORWARD-ONLY LAW',
				payload: industry,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(ontologyId, record);
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
		async addTerm(ontologyId: unknown, term: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('addTerm');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('addTerm', ontologyId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('addTerm', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateTermEntry(term);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('addTerm', verdict) };
			}
			const entry = verdict.value;
			if (record.terms.some((existing) => existing.term === entry.term)) {
				return {
					ok: false,
					refusal: refused(
						'duplicate-term',
						'THE FAIL-CLOSED LAW',
						`addTerm: the term '${entry.term}' is already composed (a term of art appears once)`,
						[entry.term],
					),
				};
			}
			if (record.terms.length >= MAX_TERMS) {
				return {
					ok: false,
					refusal: refused(
						'max-terms-exceeded',
						'THE FAIL-CLOSED LAW',
						`addTerm: the ontology already carries ${record.terms.length} terms - the composition bound is MAX_TERMS (${MAX_TERMS})`,
						[`${record.terms.length} terms`],
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `added the term '${entry.term}' (a term is CONFIGURATION - it grants NOTHING by itself)`;
			const next: DomainOntologyRecord = {
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				terms: [...record.terms, entry],
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-term', law: 'THE NO-FORK LAW', detail }],
			};
			const line: OntologyOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONTOLOGY_CONTRACTS_VERSION,
				op: 'add-term',
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE NO-FORK LAW',
				payload: entry,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.ontologyId, next);
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
		async replaceTermDefinition(ontologyId: unknown, term: unknown, definition: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('replaceTermDefinition');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('replaceTermDefinition', ontologyId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('replaceTermDefinition', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findTerm(record, term);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-term',
						'THE FAIL-CLOSED LAW',
						`replaceTermDefinition: no term '${showValue(term)}' in the ontology (a malformed term name fails closed as unknown-term)`,
					),
				};
			}
			const verdict = validateTermDefinition(definition);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('replaceTermDefinition', verdict) };
			}
			const replacement: OntologyTerm = { term: existing.term, definition: verdict.value };
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `replaced the definition of the term '${existing.term}' (a term is its identity - immutable; only the definition is replaceable, THE REMOVE+RE-ADD LAW)`;
			const next: DomainOntologyRecord = {
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				terms: record.terms.map((entry) => (entry.term === replacement.term ? replacement : entry)),
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-term-definition', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: OntologyOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONTOLOGY_CONTRACTS_VERSION,
				op: 'replace-term-definition',
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: replacement,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.ontologyId, next);
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
		async removeTerm(ontologyId: unknown, term: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('removeTerm');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('removeTerm', ontologyId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('removeTerm', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findTerm(record, term);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-term',
						'THE FAIL-CLOSED LAW',
						`removeTerm: no term '${showValue(term)}' in the ontology (a malformed term name fails closed as unknown-term)`,
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `removed the term '${existing.term}' (THE REMOVE+RE-ADD LAW: a changed term is a NEW term; removing the last term is legal while composing - the empty-terms floor fires only at finalize)`;
			const next: DomainOntologyRecord = {
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composing',
				terms: record.terms.filter((entry) => entry.term !== existing.term),
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-term', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: OntologyOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONTOLOGY_CONTRACTS_VERSION,
				op: 'remove-term',
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: existing,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.ontologyId, next);
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
		async finalizeOntology(ontologyId: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('finalizeOntology');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('finalizeOntology', ontologyId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const record = lookup.record;
			const stageRefusal = stageGuard('finalizeOntology', record);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			if (record.terms.length === 0) {
				return {
					ok: false,
					refusal: refused(
						'empty-terms',
						'THE FAIL-CLOSED LAW',
						'finalizeOntology: the ontology must compose at least one term of art (THE DH-01 FLOOR - compose terms with addTerm first; the floor fires HERE, never the record shape)',
						['terms'],
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `finalized the domain ontology (${record.terms.length} term(s); composing -> composed, TERMINAL - the terminology is FROZEN; the DH-012 Lab specialization mints NEW lineage records)`;
			const next: DomainOntologyRecord = {
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				industry: record.industry,
				stage: 'composed',
				terms: [...record.terms],
				history: [...record.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-ontology', law: 'THE FORWARD-ONLY LAW', detail }],
			};
			const line: OntologyOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONTOLOGY_CONTRACTS_VERSION,
				op: 'finalize-ontology',
				ontologyId: record.ontologyId,
				harnessId: record.harnessId,
				fromStage: 'composing',
				toStage: 'composed',
				law: 'THE FORWARD-ONLY LAW',
				payload: null,
				detail,
			};
			const nextRecords = new Map(records);
			nextRecords.set(record.ontologyId, next);
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
		async inspectOntology(ontologyId: unknown): Promise<OntologyRecordOutcome> {
			const disposedRefusal = refuseIfDisposed('inspectOntology');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupRecord('inspectOntology', ontologyId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			return recordOutcome(lookup.record);
		},
		async listOntologies(filter?: unknown): Promise<OntologyListOutcome> {
			const disposedRefusal = refuseIfDisposed('listOntologies');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (filter !== undefined) {
				if (!isRecord(filter)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listOntologies: the filter must be an object (or absent)') };
				}
				const filterRecord = filter as Record<string, unknown>;
				const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'harnessId');
				if (unknownFields.length > 0) {
					return {
						ok: false,
						refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listOntologies: the filter carries an unknown field (stage / industry / harnessId only)', unknownFields),
					};
				}
				if (filterRecord.stage !== undefined && !isOntologyStage(filterRecord.stage)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listOntologies: the stage filter value is not a member of the frozen ONTOLOGY_STAGES list') };
				}
				if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listOntologies: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
				}
				if (filterRecord.harnessId !== undefined && !isHarnessId(filterRecord.harnessId)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listOntologies: the harnessId filter value does not satisfy the REAL DH-01 harness-id alphabet (imported by reference)') };
				}
			}
			const ids = [...records.keys()].sort();
			const listed: DomainOntologyRecord[] = [];
			for (const id of ids) {
				const entry = records.get(id) as DomainOntologyRecord;
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

interface OntologyLedgerReplay {
	readonly lines: readonly OntologyOpsLedgerLine[];
	readonly records: Map<string, DomainOntologyRecord>;
}

/** Parses and validates the whole ontology ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayOntologyLedger(ledgerText: string | null): OntologyLedgerReplay | OntologyKitRefusal {
	if (ledgerText === null || ledgerText.length === 0) {
		return { lines: [], records: new Map<string, DomainOntologyRecord>() };
	}
	if (!ledgerText.endsWith('\n')) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology ledger does not end with a complete line (a torn append - never a silent skip)');
	}
	const records = new Map<string, DomainOntologyRecord>();
	const lines: OntologyOpsLedgerLine[] = [];
	const rawLines = ledgerText.split('\n');
	rawLines.pop();
	for (let i = 0; i < rawLines.length; i += 1) {
		if (rawLines[i].length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${i + 1} is empty`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawLines[i]);
		} catch {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
		}
		const torn = validateOntologyLedgerLine(parsed, i + 1, records);
		if (torn !== null) {
			return torn;
		}
		const record = parsed as Record<string, unknown>;
		const line: OntologyOpsLedgerLine = {
			seq: record.seq as number,
			at: record.at as string,
			contractVersion: record.contractVersion as string,
			op: record.op as OntologyOpName,
			ontologyId: record.ontologyId as string,
			harnessId: record.harnessId as string,
			fromStage: record.fromStage as OntologyStage | null,
			toStage: record.toStage as OntologyStage,
			law: record.law as string,
			payload: record.payload as OntologyOpsLedgerLine['payload'],
			detail: record.detail as string,
		};
		applyOntologyLine(records, line);
		lines.push(line);
	}
	return { lines, records };
}

/** Validates one parsed ontology ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateOntologyLedgerLine(parsed: unknown, lineNo: number, records: Map<string, DomainOntologyRecord>): OntologyKitRefusal | null {
	if (!isRecord(parsed)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is not a JSON object`);
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...ONTOLOGY_LEDGER_LINE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`);
	}
	if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
	}
	if (record.contractVersion !== ONTOLOGY_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${ONTOLOGY_CONTRACTS_VERSION}' is known (the single-version law; the six-key record carries no version field, so THIS is the law's live station)`);
	}
	if (!isOntologyOpName(record.op)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
	}
	if (!isOntologyId(record.ontologyId)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries a malformed record id`);
	}
	if (!isHarnessId(record.harnessId)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries a malformed harness id (the REAL DH-01 flauz:hrn:<16-hex> alphabet, imported by reference)`);
	}
	if (record.fromStage !== null && !isOntologyStage(record.fromStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries an unknown fromStage`);
	}
	if (!isOntologyStage(record.toStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries an unknown toStage`);
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries no law name (the provenance law)`);
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries no provenance detail`);
	}
	const op = record.op as OntologyOpName;
	const ontology = records.get(record.ontologyId as string);
	if (op === 'begin-ontology') {
		if (record.fromStage !== null || record.toStage !== 'composing') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is a begin line that does not land 'composing' (every record enters the walk at composing)`);
		}
		if (!isHarnessIndustry(record.payload)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
		}
		if (ontology !== undefined) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} begins a duplicate record id`);
		}
		return null;
	}
	if (ontology === undefined) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} advances an unknown record`);
	}
	if (ontology.stage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is out of order (the record is not at the composing stage; 'composed' is TERMINAL)`);
	}
	if (op === 'finalize-ontology') {
		if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
		}
		if (record.payload !== null) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is a finalize line that carries a payload (the freeze advances the stage, no term payload)`);
		}
		if (ontology.terms.length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} finalizes an empty ontology (THE DH-01 FLOOR - the replay re-validates the boundary law)`);
		}
		return null;
	}
	if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} is a term-op line outside the composing->composing self edge (the terminology composes gradually)`);
	}
	const entry = validateTermEntry(record.payload);
	if (!entry.ok) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} carries an invalid term payload`);
	}
	const payloadTerm = entry.value;
	if (op === 'add-term') {
		if (ontology.terms.some((term) => term.term === payloadTerm.term)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} adds a duplicate term '${payloadTerm.term}'`);
		}
		if (ontology.terms.length >= MAX_TERMS) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} exceeds the MAX_TERMS (${MAX_TERMS}) composition bound`);
		}
		return null;
	}
	if (op === 'replace-term-definition') {
		if (!ontology.terms.some((term) => term.term === payloadTerm.term)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} replaces the definition of an unknown term '${payloadTerm.term}'`);
		}
		return null;
	}
	// remove-term: the payload must match the record's entry AS IT STOOD (the authoritative cross-check).
	const standing = ontology.terms.find((term) => term.term === payloadTerm.term);
	if (standing === undefined || standing.definition !== payloadTerm.definition) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: ontology ledger line ${lineNo} removes a term entry that does not match the record's ontology as it stood`);
	}
	return null;
}

/** Applies one validated ontology ledger line to the replay records (pure fold). */
function applyOntologyLine(records: Map<string, DomainOntologyRecord>, line: OntologyOpsLedgerLine): void {
	if (line.op === 'begin-ontology') {
		records.set(line.ontologyId, {
			ontologyId: line.ontologyId,
			harnessId: line.harnessId,
			industry: line.payload as HarnessIndustry,
			stage: line.toStage,
			terms: [],
			history: [noteOf(line)],
		});
		return;
	}
	const record = records.get(line.ontologyId);
	if (record === undefined) {
		return;
	}
	const base: DomainOntologyRecord = {
		...record,
		stage: line.toStage,
		history: [...record.history, noteOf(line)],
	};
	let next: DomainOntologyRecord;
	if (line.op === 'add-term') {
		next = { ...base, terms: [...record.terms, line.payload as OntologyTerm] };
	} else if (line.op === 'replace-term-definition') {
		const replacement = line.payload as OntologyTerm;
		next = { ...base, terms: record.terms.map((term) => (term.term === replacement.term ? replacement : term)) };
	} else if (line.op === 'remove-term') {
		const removed = line.payload as OntologyTerm;
		next = { ...base, terms: record.terms.filter((term) => term.term !== removed.term) };
	} else {
		next = base;
	}
	records.set(line.ontologyId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: OntologyOpsLedgerLine): OntologyTransitionNote {
	return {
		at: line.at,
		fromStage: line.fromStage,
		toStage: line.toStage,
		op: line.op,
		law: line.law,
		detail: line.detail,
	};
}

/** Cross-checks the ontology envelope against the replay; returns the typed refusal or null. */
function crossCheckOntologyEnvelope(
	envelopeText: string | null,
	lineCount: number,
	replayed: Map<string, DomainOntologyRecord>,
): OntologyKitRefusal | null {
	if (envelopeText === null) {
		if (lineCount === 0) {
			return null;
		}
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: the ontology envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	let parsedEnvelope: unknown;
	try {
		parsedEnvelope = JSON.parse(envelopeText);
	} catch {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope is not valid JSON');
	}
	if (!isRecord(parsedEnvelope)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope is not a JSON object');
	}
	const envelope = parsedEnvelope as Record<string, unknown>;
	const keys = Object.keys(envelope).sort();
	const expected = [...ONTOLOGY_ENVELOPE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope is structurally invalid (the frozen three-key envelope schema)');
	}
	if (envelope.contractVersion !== ONTOLOGY_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadOntologyKit: the ontology envelope carries contract version ${showValue(envelope.contractVersion)} - only '${ONTOLOGY_CONTRACTS_VERSION}' is known (the single-version law)`);
	}
	if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope carries a malformed seq');
	}
	if (!Array.isArray(envelope.records)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope carries a malformed records array');
	}
	const envelopeSeq = envelope.seq as number;
	if (envelopeSeq > lineCount) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: the ontology envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
	}
	if (envelopeSeq < lineCount) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: the ontology envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	const envelopeRecordMap = new Map<string, DomainOntologyRecord>();
	for (let i = 0; i < envelope.records.length; i += 1) {
		const entry = envelope.records[i];
		if (!validateOntologyRecord(entry).ok) {
			return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadOntologyKit: the ontology envelope's records[${i}] is not a valid domain-ontology record`);
		}
		const ontologyRecord = entry as DomainOntologyRecord;
		envelopeRecordMap.set(ontologyRecord.ontologyId, ontologyRecord);
	}
	const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
	const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
	if (replayBytes !== envelopeBytes) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadOntologyKit: the ontology envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
	}
	return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: OntologyOpsLedgerLine): string {
	return JSON.stringify({
		seq: line.seq,
		at: line.at,
		contractVersion: line.contractVersion,
		op: line.op,
		ontologyId: line.ontologyId,
		harnessId: line.harnessId,
		fromStage: line.fromStage,
		toStage: line.toStage,
		law: line.law,
		payload: line.payload === null ? null : typeof line.payload === 'string' ? line.payload : { term: line.payload.term, definition: line.payload.definition },
		detail: line.detail,
	});
}

/** Builds the canonical fixed-key-order bytes of the envelope (records sorted by ontologyId). */
function envelopeBytes(seq: number, nextRecords: Map<string, DomainOntologyRecord>): string {
	const ids = [...nextRecords.keys()].sort();
	const listed = ids.map((id) => nextRecords.get(id) as DomainOntologyRecord);
	return `{"contractVersion":${JSON.stringify(ONTOLOGY_CONTRACTS_VERSION)},"seq":${seq},"records":[${listed
		.map((record) => serializeOntologyRecord(record))
		.join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, records: Map<string, DomainOntologyRecord>): string {
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

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function matchesRecordFilter(record: DomainOntologyRecord, filter: Record<string, unknown>): boolean {
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

