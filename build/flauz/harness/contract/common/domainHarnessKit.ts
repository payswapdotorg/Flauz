/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-001 DomainHarness kit: the deterministic harness lifecycle runtime
 * over the contract vocabulary (the fail-closed factory binding the
 * injected clock, the injected rng (the flauz:hrn:<16-hex> id-minting
 * seam - NEVER the random global), the injected read-only catalog
 * snapshot (the stable seam DH-002+ binds to the real authorities), and
 * the OPTIONAL injected fs port + root (the PIN-2 sibling precedent:
 * the .flauz/harness/harnesses.json envelope + the append-only
 * .flauz/harness/harness-ops.jsonl ledger; the ledger is authoritative,
 * the envelope is cross-checked, a divergence is NEVER silently
 * rebuilt). The kit mints DRAFT harnesses (THE TWO-PHASE LAW: the spec
 * is validated for vocabulary + shape IMMEDIATELY; dangling refs are
 * ALLOWED at draft - resolution is enforced at the propose boundary),
 * advances the forward-only lifecycle (draft -> proposed -> approved ->
 * active -> retired; retired is terminal; the descriptor is IMMUTABLE -
 * a changed harness is a new mint, the registry drift law), inspects
 * the honest record, lists with fail-closed filters, and refuses every
 * operation after dispose (kit module, the labContracts discipline;
 * binds the DH-001 contract family verbatim, never re-implemented).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE NO-FORK LAW: the descriptor alphabet is references only; the
 *   mint boundary validates the spec for vocabulary + shape
 *   IMMEDIATELY (the typed VALIDATION_REFUSED rejection carrying the
 *   complete outcome - the forbidden-key family, the strict schema,
 *   the frozen vocabularies).
 * - THE NO-DANGLING-REF LAW: every reference must resolve against the
 *   injected catalog snapshot at the propose boundary (draft ->
 *   proposed requires FULL validation green; the refusal carries the
 *   complete outcome listing every offender).
 * - THE TWO-PHASE LAW: a draft composes gradually - dangling refs mint
 *   fine at draft; resolution is enforced at the propose boundary.
 * - THE FORWARD-ONLY LIFECYCLE LAW: typed forward transitions only;
 *   retired is TERMINAL (no reopen - a changed harness is a NEW
 *   harness id, the registry lineage law); the descriptor is immutable
 *   (no in-place mutation, the registry drift law).
 * - THE CATALOG-BINDING LAW: a harness is NEVER approved over an
 *   unapproved capability - every capabilityRef must sit at 'approved',
 *   'enabled' or 'available' in the catalog snapshot at the approve
 *   boundary (fail-closed escalation, the typed
 *   CATALOG_BINDING_REFUSED rejection listing every offender).
 * - THE DETERMINISM LAW: the kit never reads a clock, never rolls a
 *   random, never reads env - no Math.random, no Date.now, no
 *   new Date(...), no process.env in this module (law comments
 *   excepted); the clock and the rng are INJECTED seams; the persisted
 *   bytes are canonical fixed-key-order JSON.
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError; every
 *   domain refusal is a typed record (the frozen
 *   HARNESS_KIT_REFUSAL_REASONS table) naming the violated law and the
 *   offending items - never a string throw, never a silent skip, never
 *   a silent partial effect.
 * - THE SINGLE-VERSION LAW: DOMAIN_HARNESS_CONTRACTS_VERSION is
 *   declared ONCE in the contract module and re-carried here (the
 *   re-export below); the battery pins both copies equal.
 * - THE APPEND-ONLY LEDGER LAW: the ops ledger is append-only (one
 *   canonical JSON line per applied op, the seq strictly increasing
 *   and equal to the line number); nothing is edited or deleted; the
 *   load replays the ledger and cross-checks the envelope (a torn or
 *   missing ledger line is the typed E_LEDGER_TORN; a divergent
 *   envelope is the typed E_ENVELOPE_MISMATCH - never silently
 *   rebuilt).
 */

import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_CAPABILITY_BINDING_STATES,
	HARNESS_ID_PREFIX,
	canTransitionHarnessLifecycle,
	isHarnessCatalogSnapshot,
	isHarnessId,
	isHarnessIndustry,
	isHarnessLifecycleState,
	isHarnessRecord,
	isHarnessValidationOutcome,
	isHarnessWorkType,
	serializeHarnessRecord,
	validateDomainHarnessDescriptor,
	validateHarnessDescriptorShape,
} from './domainHarnessContract.js';
import type {
	DomainHarnessDescriptor,
	HarnessCatalogSnapshot,
	HarnessLifecycleState,
	HarnessLifecycleVerdict,
	HarnessRecord,
	HarnessValidationOutcome,
	HarnessValidationRejection,
	HarnessWorkType,
} from './domainHarnessContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from './domainHarnessContract.js';

/**
 * The injected fs port: the ONLY filesystem seam (the PIN-2 sibling
 * precedent). The shipped kit never touches a global fs, never reads
 * the env; the caller wires the real driver. readFile signals a
 * missing file with an ENOENT-coded error (the registry precedent's
 * convention).
 */
export interface HarnessFsPort {
	readFile(path: string, encoding: 'utf8'): Promise<string>;
	writeFile(path: string, text: string): Promise<void>;
	appendFile(path: string, text: string): Promise<void>;
	mkdir(path: string, options: { recursive: boolean }): Promise<void>;
}

/** The kit construction options (all injected, never env-read; fsPort and root come together or not at all). */
export interface HarnessKitOptions {
	/** The injected clock (returns the ISO string; the kit carries it verbatim). */
	readonly clock: () => string;
	/** The id-minting seam (returns 16 lowercase hex chars; NEVER the random global). */
	readonly rng: () => string;
	/** The injected READ-ONLY catalog snapshot (DH-002+ binds the real authorities; tests inject fixtures). */
	readonly catalog: HarnessCatalogSnapshot;
	/** The OPTIONAL filesystem seam (persistence when paired with root). */
	readonly fsPort?: HarnessFsPort;
	/** The OPTIONAL persistence root (the .flauz/harness subtree lands under it). */
	readonly root?: string;
}

/**
 * Closed frozen list of kit refusal reasons (every domain refusal is a
 * typed member; factory misuse is a TypeError, not a refusal):
 *   DISPOSED                 - THE DISPOSE LAW: the kit was disposed;
 *                              every operation after dispose rejects.
 *   E_LEDGER_TORN            - THE APPEND-ONLY LEDGER LAW: a torn or
 *                              missing ledger line, a structurally
 *                              invalid or out-of-order line, an
 *                              unknown op or contract version, an
 *                              illegal transition inside the ledger,
 *                              or a fresh kit attempting to append
 *                              over an existing non-empty ledger
 *                              (reopen with loadHarnessKit).
 *   E_ENVELOPE_MISMATCH      - THE APPEND-ONLY LEDGER LAW: the
 *                              envelope diverges from the ledger
 *                              replay (or is missing / malformed while
 *                              the ledger carries lines) - never
 *                              silently rebuilt.
 *   HARNESS_IO               - THE FAIL-CLOSED LAW: the injected fs
 *                              port refused a read / append / write /
 *                              mkdir.
 *   CORRUPT_SEAM             - THE DETERMINISM LAW: the injected clock
 *                              or rng returned a malformed value
 *                              mid-op (an empty clock reading, a
 *                              non-16-hex rng output, a duplicate
 *                              minted id).
 *   NOT_FOUND                - THE FAIL-CLOSED LAW: no harness with
 *                              the given id (a malformed id is
 *                              fail-closed as not-found).
 *   ILLEGAL_TRANSITION       - THE FORWARD-ONLY LIFECYCLE LAW: the
 *                              whitelist verdict refused the edge
 *                              (skips, backwards moves, self-loops,
 *                              retired->anything, unknown states).
 *   VALIDATION_REFUSED       - THE TWO-PHASE LAW / THE NO-DANGLING-REF
 *                              LAW: the mint-time shape walk or the
 *                              propose-boundary full walk refused; the
 *                              refusal carries the complete validation
 *                              outcome.
 *   CATALOG_BINDING_REFUSED  - THE CATALOG-BINDING LAW: a capabilityRef
 *                              sits below approved/enabled/available
 *                              (or is absent) at the approve boundary;
 *                              the refusal lists every offender.
 *   MALFORMED_DECISION       - THE FAIL-CLOSED LAW: the decision
 *                              payload drifts from the frozen
 *                              per-transition shape ({ approvedBy,
 *                              note? } / { activatedBy } / { retiredBy,
 *                              reason? }; the propose transition
 *                              carries NO decision).
 *   UNKNOWN_FILTER           - THE FAIL-CLOSED LAW: listHarnesses
 *                              received an unknown filter field or a
 *                              non-member filter value.
 */
export const HARNESS_KIT_REFUSAL_REASONS = [
	'DISPOSED',
	'E_LEDGER_TORN',
	'E_ENVELOPE_MISMATCH',
	'HARNESS_IO',
	'CORRUPT_SEAM',
	'NOT_FOUND',
	'ILLEGAL_TRANSITION',
	'VALIDATION_REFUSED',
	'CATALOG_BINDING_REFUSED',
	'MALFORMED_DECISION',
	'UNKNOWN_FILTER',
] as const;
export type HarnessKitRefusalReason = (typeof HARNESS_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isHarnessKitRefusalReason(value: unknown): value is HarnessKitRefusalReason {
	return (HARNESS_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/** The typed kit refusal: the frozen reason, the violated law's name, the deterministic detail, and the optional carried surface. */
export interface HarnessKitRefusal {
	readonly reason: HarnessKitRefusalReason;
	readonly law: string;
	readonly detail: string;
	/** VALIDATION_REFUSED carries the complete validation outcome (the typed rejection table). */
	readonly validation?: HarnessValidationOutcome;
	/** CATALOG_BINDING_REFUSED / UNKNOWN_FILTER carry the offending items. */
	readonly offenders?: readonly string[];
	/** ILLEGAL_TRANSITION carries the contract's typed verdict. */
	readonly transition?: HarnessLifecycleVerdict;
}

/** The mint outcome: ok carries the honest record; failure carries the typed refusal. */
export type HarnessMintOutcome =
	| { readonly ok: true; readonly record: HarnessRecord }
	| { readonly ok: false; readonly refusal: HarnessKitRefusal };

/** The advance outcome: ok carries the honest record; failure carries the typed refusal. */
export type HarnessAdvanceOutcome =
	| { readonly ok: true; readonly record: HarnessRecord }
	| { readonly ok: false; readonly refusal: HarnessKitRefusal };

/** The inspect outcome: ok carries the honest record; failure carries the typed refusal. */
export type HarnessInspectOutcome =
	| { readonly ok: true; readonly record: HarnessRecord }
	| { readonly ok: false; readonly refusal: HarnessKitRefusal };

/** The list outcome: ok carries the harnessId-ordered honest records; failure carries the typed refusal. */
export type HarnessListOutcome =
	| { readonly ok: true; readonly records: readonly HarnessRecord[] }
	| { readonly ok: false; readonly refusal: HarnessKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type HarnessLoadOutcome =
	| { readonly ok: true; readonly kit: HarnessKit }
	| { readonly ok: false; readonly refusal: HarnessKitRefusal };

/** The deterministic DomainHarness kit. */
export interface HarnessKit {
	mintHarness(spec: unknown): Promise<HarnessMintOutcome>;
	advanceHarness(harnessId: unknown, to: unknown, decision?: unknown): Promise<HarnessAdvanceOutcome>;
	inspectHarness(harnessId: unknown): Promise<HarnessInspectOutcome>;
	listHarnesses(filter?: unknown): Promise<HarnessListOutcome>;
	dispose(): void;
}

/** The envelope path (relative to the injected root). */
export const HARNESS_ENVELOPE_RELATIVE_PATH = '.flauz/harness/harnesses.json';

/** The append-only ops ledger path (relative to the injected root). */
export const HARNESS_LEDGER_RELATIVE_PATH = '.flauz/harness/harness-ops.jsonl';

/** The frozen ledger-line schema keys, in the canonical fixed-key-order. */
export const HARNESS_LEDGER_LINE_SCHEMA_KEYS = [
	'seq',
	'at',
	'contractVersion',
	'op',
	'harnessId',
	'fromState',
	'toState',
	'law',
	'decision',
	'descriptor',
	'validation',
	'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const HARNESS_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'harnesses'] as const;

/** One append-only ops ledger line (the canonical persisted op). */
export interface HarnessOpsLedgerLine {
	readonly seq: number;
	readonly at: string;
	readonly contractVersion: string;
	readonly op: 'mint' | 'transition';
	readonly harnessId: string;
	readonly fromState: HarnessLifecycleState | null;
	readonly toState: HarnessLifecycleState;
	readonly law: string;
	readonly decision: Readonly<Record<string, string>> | null;
	readonly descriptor: DomainHarnessDescriptor | null;
	readonly validation: HarnessValidationOutcome | null;
	readonly detail: string;
}

/**
 * Creates a DomainHarness kit (fail-closed factory). Validation order
 * is deterministic: the options shape (clock / rng / catalog), the
 * clock's first read (a non-empty ISO string), the rng's first read
 * (exactly 16 lowercase hex chars - the id-minting law), the catalog
 * snapshot guard, and the fsPort/root pairing (both or neither; the
 * port must expose readFile / writeFile / appendFile / mkdir). The
 * kit starts with ZERO harnesses; persistence is LAZY (the
 * .flauz/harness subtree lands with the first applied op; a fresh kit
 * never appends over an existing non-empty ledger - reopen with
 * loadHarnessKit).
 */
export function createHarnessKit(options: HarnessKitOptions): HarnessKit {
	const bound = validateKitOptions(options, false);
	return buildKit(bound, { seq: 0, entries: new Map<string, HarnessRecord>() });
}

/**
 * Reopens a persisted kit: replays the append-only ops ledger (the
 * authoritative surface) and cross-checks the envelope byte-for-byte
 * against the replay-built state. A torn or missing ledger line is the
 * typed E_LEDGER_TORN; a divergent, missing or malformed envelope is
 * the typed E_ENVELOPE_MISMATCH (never silently rebuilt); a refused fs
 * port is the typed HARNESS_IO. A fresh root (no files) reopens as an
 * empty kit. The options require BOTH fsPort and root (the load is a
 * persistence-surface operation).
 */
export async function loadHarnessKit(options: HarnessKitOptions): Promise<HarnessLoadOutcome> {
	const bound = validateKitOptions(options, true);
	const ledgerPath = `${bound.root}/${HARNESS_LEDGER_RELATIVE_PATH}`;
	const envelopePath = `${bound.root}/${HARNESS_ENVELOPE_RELATIVE_PATH}`;
	const fsPort = bound.fsPort as HarnessFsPort;
	try {
		await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
	} catch (error) {
		return { ok: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `loadHarnessKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
	}
	let ledgerText: string | null;
	try {
		ledgerText = await readText(fsPort, ledgerPath);
	} catch (error) {
		return { ok: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `loadHarnessKit: the fs port refused the ledger read: ${toMessage(error)}`) };
	}
	let envelopeText: string | null;
	try {
		envelopeText = await readText(fsPort, envelopePath);
	} catch (error) {
		return { ok: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `loadHarnessKit: the fs port refused the envelope read: ${toMessage(error)}`) };
	}
	const replay = replayLedger(ledgerText);
	if (typeof replay === 'string') {
		return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', replay) };
	}
	const crossCheck = crossCheckEnvelope(envelopeText, replay.lines.length, replay.entries);
	if (crossCheck !== null) {
		return { ok: false, refusal: refused(crossCheck.reason, 'THE APPEND-ONLY LEDGER LAW', crossCheck.detail) };
	}
	return { ok: true, kit: buildKit(bound, { seq: replay.lines.length, entries: replay.entries }) };
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
	readonly rng: () => string;
	readonly catalog: HarnessCatalogSnapshot;
	readonly fsPort: HarnessFsPort | null;
	readonly root: string | null;
}

interface KitState {
	seq: number;
	entries: Map<string, HarnessRecord>;
}

/** The persist fold's result: applied means the ledger line landed (the ledger is authoritative). */
type PersistResult =
	| { readonly applied: false; readonly refusal: HarnessKitRefusal }
	| { readonly applied: true; readonly refusal: HarnessKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: HarnessKitRefusal };

function validateKitOptions(options: HarnessKitOptions, requirePersistence: boolean): BoundOptions {
	if (!isRecord(options)) {
		throw new TypeError('createHarnessKit: options must be an object');
	}
	const opts = options as Record<string, unknown>;
	if (typeof opts.clock !== 'function') {
		throw new TypeError(
			'createHarnessKit: options.clock must be a function returning ISO string values (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	if (typeof opts.rng !== 'function') {
		throw new TypeError(
			'createHarnessKit: options.rng must be a function returning 16 lowercase hex chars (the id-minting seam - NEVER the random global)',
		);
	}
	if (!isHarnessCatalogSnapshot(opts.catalog)) {
		throw new TypeError(
			'createHarnessKit: options.catalog must satisfy isHarnessCatalogSnapshot (the injected READ-ONLY resolution surface - DH-002+ binds the real authorities)',
		);
	}
	const clock = opts.clock as () => string;
	const firstClock = clock();
	if (typeof firstClock !== 'string' || firstClock.length === 0) {
		throw new TypeError('createHarnessKit: options.clock() must return a non-empty ISO string (the injected-clock law)');
	}
	const rng = opts.rng as () => string;
	const firstHex = rng();
	if (!/^[0-9a-f]{16}$/.test(firstHex)) {
		throw new TypeError(
			'createHarnessKit: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints flauz:hrn:<16-hex>)',
		);
	}
	const hasPort = opts.fsPort !== undefined;
	const hasRoot = opts.root !== undefined;
	if (requirePersistence && (!hasPort || !hasRoot)) {
		throw new TypeError('loadHarnessKit: options.fsPort and options.root are both required (the load is a persistence-surface operation)');
	}
	if (hasPort !== hasRoot) {
		throw new TypeError('createHarnessKit: options.fsPort and options.root come together or not at all (the persistence seam is a pair)');
	}
	let fsPort: HarnessFsPort | null = null;
	let root: string | null = null;
	if (hasPort && hasRoot) {
		const port = opts.fsPort;
		if (!isRecord(port)) {
			throw new TypeError('createHarnessKit: options.fsPort must be an object (the ONLY filesystem seam)');
		}
		for (const name of ['readFile', 'writeFile', 'appendFile', 'mkdir'] as const) {
			if (typeof (port as Record<string, unknown>)[name] !== 'function') {
				throw new TypeError(`createHarnessKit: options.fsPort.${name} must be a function (the ONLY filesystem seam)`);
			}
		}
		fsPort = port as unknown as HarnessFsPort;
		if (typeof opts.root !== 'string' || opts.root.length === 0) {
			throw new TypeError('createHarnessKit: options.root must be a non-empty string (the persistence root)');
		}
		root = (opts.root as string).replace(/\/+$/, '');
	}
	return { clock, rng, catalog: opts.catalog as HarnessCatalogSnapshot, fsPort, root };
}

function refused(reason: HarnessKitRefusalReason, law: string, detail: string, extra?: Omit<HarnessKitRefusal, 'reason' | 'law' | 'detail'>): HarnessKitRefusal {
	return { reason, law, detail, ...extra };
}

function buildKit(bound: BoundOptions, seed: KitState): HarnessKit {
	let disposed = false;
	let seq = seed.seq;
	const entries = seed.entries;
	const persisted = bound.fsPort !== null && bound.root !== null;
	const fsPort = bound.fsPort;
	const ledgerPath = bound.root !== null ? `${bound.root}/${HARNESS_LEDGER_RELATIVE_PATH}` : '';
	const envelopePath = bound.root !== null ? `${bound.root}/${HARNESS_ENVELOPE_RELATIVE_PATH}` : '';
	let dirEnsured = false;
	// A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
	// (its ledger preexists; only a fresh createHarnessKit guards the append).
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

	function copyRecord(record: HarnessRecord): HarnessRecord {
		return JSON.parse(serializeHarnessRecord(record)) as HarnessRecord;
	}

	function envelopeBytes(nextSeq: number, nextEntries: Map<string, HarnessRecord>): string {
		const ids = [...nextEntries.keys()].sort();
		const records = ids.map((id) => nextEntries.get(id) as HarnessRecord);
		return `{"contractVersion":${JSON.stringify(DOMAIN_HARNESS_CONTRACTS_VERSION)},"seq":${nextSeq},"harnesses":[${records
			.map((record) => serializeHarnessRecord(record))
			.join(',')}]}`;
	}

	function ledgerLineBytes(line: HarnessOpsLedgerLine): string {
		return JSON.stringify({
			seq: line.seq,
			at: line.at,
			contractVersion: line.contractVersion,
			op: line.op,
			harnessId: line.harnessId,
			fromState: line.fromState,
			toState: line.toState,
			law: line.law,
			decision: line.decision === null ? null : decisionObject(line.decision),
			descriptor: line.descriptor === null ? null : descriptorObject(line.descriptor),
			validation: line.validation === null ? null : validationObject(line.validation),
			detail: line.detail,
		});
	}

	/**
	 * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
	 * first (the ledger is authoritative - the seq advances with the
	 * line), the envelope rewrite lands second, the in-memory entries
	 * commit last (in the caller). An append refusal leaves NOTHING
	 * applied; an envelope refusal leaves the op applied and the line
	 * landed (the refusal discloses it; a reload fails closed with
	 * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
	 */
	async function persist(line: HarnessOpsLedgerLine, nextEntries: Map<string, HarnessRecord>): Promise<PersistResult> {
		if (!persisted || fsPort === null) {
			seq = line.seq;
			return { applied: true, refusal: null };
		}
		if (!ledgerGuardDone) {
			let existing: string | null;
			try {
				existing = await readText(fsPort, ledgerPath);
			} catch (error) {
				return { applied: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the ledger read: ${toMessage(error)}`) };
			}
			if (existing !== null && existing.trim().length > 0) {
				return {
					applied: false,
					refusal: refused(
						'E_LEDGER_TORN',
						'THE APPEND-ONLY LEDGER LAW',
						'persist: the ledger already carries lines - reopen with loadHarnessKit (a fresh kit never appends over an existing ledger)',
					),
				};
			}
			ledgerGuardDone = true;
		}
		if (!dirEnsured) {
			try {
				await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
			} catch (error) {
				return { applied: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
			}
			dirEnsured = true;
		}
		try {
			await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
		} catch (error) {
			return { applied: false, refusal: refused('HARNESS_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the ledger append: ${toMessage(error)} (nothing was applied)`) };
		}
		seq = line.seq;
		try {
			await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextEntries));
		} catch (error) {
			return {
				applied: true,
				refusal: refused(
					'HARNESS_IO',
					'THE FAIL-CLOSED LAW',
					`persist: the ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
				),
			};
		}
		return { applied: true, refusal: null };
	}

	function commit(nextEntries: Map<string, HarnessRecord>): void {
		entries.clear();
		for (const [id, record] of nextEntries) {
			entries.set(id, record);
		}
	}

	return {
		async mintHarness(spec: unknown): Promise<HarnessMintOutcome> {
			if (disposed) {
				return { ok: false, refusal: refused('DISPOSED', 'THE DISPOSE LAW', 'mintHarness: the kit was disposed - every operation after dispose rejects') };
			}
			const hex = bound.rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'mintHarness: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
			}
			const harnessId = `${HARNESS_ID_PREFIX}${hex}`;
			// The kit-owned keys pre-scan: the harnessId and the contractVersion are MINTED, never caller-supplied.
			const kitOwnedKeys: string[] = [];
			if (isRecord(spec)) {
				for (const key of Object.keys(spec as Record<string, unknown>)) {
					if (key === 'harnessId' || key === 'contractVersion') {
						kitOwnedKeys.push(key);
					}
				}
			}
			const candidate = isRecord(spec)
				? { ...(spec as Record<string, unknown>), harnessId, contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION }
				: spec;
			const walked = validateHarnessDescriptorShape(candidate);
			const kitOwnedRejection: HarnessValidationRejection | null = kitOwnedKeys.length > 0
				? {
					reason: 'unknown-key',
					law: 'THE NO-FORK LAW',
					items: kitOwnedKeys,
					detail: 'mintHarness: the kit mints the harnessId from the injected rng and carries DOMAIN_HARNESS_CONTRACTS_VERSION itself - these keys are never caller-supplied',
				}
				: null;
			if (!walked.ok) {
				const rejections = kitOwnedRejection === null ? [...walked.rejections] : [kitOwnedRejection, ...walked.rejections];
				return {
					ok: false,
					refusal: refused(
						'VALIDATION_REFUSED',
						'THE TWO-PHASE LAW',
						'mintHarness: the spec failed the immediate shape validation (frozen-vocab + NO-FORK); dangling refs are allowed at draft',
						{ validation: { ok: false, mode: 'shape', rejections } },
					),
				};
			}
			if (kitOwnedRejection !== null) {
				return {
					ok: false,
					refusal: refused(
						'VALIDATION_REFUSED',
						'THE TWO-PHASE LAW',
						'mintHarness: the spec failed the immediate shape validation (frozen-vocab + NO-FORK); dangling refs are allowed at draft',
						{ validation: { ok: false, mode: 'shape', rejections: [kitOwnedRejection] } },
					),
				};
			}
			if (entries.has(harnessId)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'mintHarness: the injected rng minted a duplicate harness id (the id-minting seam is corrupt)') };
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const descriptor = walked.descriptor;
			const detail = `minted a DRAFT harness over the '${descriptor.industry}' industry (shape validation green; dangling refs allowed at draft)`;
			const record: HarnessRecord = {
				harnessId,
				contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
				state: 'draft',
				descriptor,
				mintedAtIso: at,
				revision: 1,
				history: [
					{
						at,
						fromState: null,
						toState: 'draft',
						law: 'THE FORWARD-ONLY LIFECYCLE LAW',
						decision: null,
						detail,
					},
				],
				lastValidation: walked,
			};
			const line: HarnessOpsLedgerLine = {
				seq: seq + 1,
				at,
				contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
				op: 'mint',
				harnessId,
				fromState: null,
				toState: 'draft',
				law: 'THE FORWARD-ONLY LIFECYCLE LAW',
				decision: null,
				descriptor,
				validation: walked,
				detail,
			};
			const nextEntries = new Map(entries);
			nextEntries.set(harnessId, record);
			const persistResult = await persist(line, nextEntries);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextEntries);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return { ok: true, record: copyRecord(record) };
		},
		async advanceHarness(harnessId: unknown, to: unknown, decision?: unknown): Promise<HarnessAdvanceOutcome> {
			if (disposed) {
				return { ok: false, refusal: refused('DISPOSED', 'THE DISPOSE LAW', 'advanceHarness: the kit was disposed - every operation after dispose rejects') };
			}
			if (!isHarnessId(harnessId)) {
				return { ok: false, refusal: refused('NOT_FOUND', 'THE FAIL-CLOSED LAW', `advanceHarness: no harness with id '${showValue(harnessId)}' (a malformed id fails closed as not-found)`) };
			}
			const entry = entries.get(harnessId);
			if (entry === undefined) {
				return { ok: false, refusal: refused('NOT_FOUND', 'THE FAIL-CLOSED LAW', `advanceHarness: no harness with id '${harnessId}'`) };
			}
			const verdict = canTransitionHarnessLifecycle(entry.state, to);
			if (!verdict.ok) {
				return { ok: false, refusal: refused('ILLEGAL_TRANSITION', 'THE FORWARD-ONLY LIFECYCLE LAW', verdict.detail, { transition: verdict }) };
			}
			const target = to as HarnessLifecycleState;
			let decisionRecord: Readonly<Record<string, string>> | null = null;
			let law = 'THE FORWARD-ONLY LIFECYCLE LAW';
			let detail = '';
			let validation: HarnessValidationOutcome | null = null;
			if (target === 'proposed') {
				if (decision !== undefined) {
					return { ok: false, refusal: refused('MALFORMED_DECISION', 'THE FAIL-CLOSED LAW', 'advanceHarness: the propose transition carries NO decision (full validation is the gate)') };
				}
				const outcome = validateDomainHarnessDescriptor(entry.descriptor, bound.catalog);
				if (!outcome.ok) {
					return {
						ok: false,
						refusal: refused(
							'VALIDATION_REFUSED',
							'THE NO-DANGLING-REF LAW',
							'advanceHarness: the draft->proposed boundary requires FULL validation green (the NO-DANGLING check included) - the refusal carries the complete outcome',
							{ validation: outcome },
						),
					};
				}
				law = 'THE TWO-PHASE LAW';
				detail = 'proposed the harness (full validation green over the injected catalog snapshot)';
				validation = outcome;
			} else if (target === 'approved') {
				const walked = walkDecision(decision, 'approved');
				if (typeof walked === 'string') {
					return { ok: false, refusal: refused('MALFORMED_DECISION', 'THE FAIL-CLOSED LAW', walked) };
				}
				decisionRecord = walked;
				const stateById = new Map<string, string>(bound.catalog.capabilities.map((capability) => [capability.entryId, capability.state]));
				const offenders = entry.descriptor.capabilityRefs
					.filter((ref) => {
						const state = stateById.get(ref);
						return state === undefined || !(HARNESS_CAPABILITY_BINDING_STATES as readonly string[]).includes(state);
					})
					.map((ref) => `${ref} (state: ${stateById.get(ref) ?? 'absent from the catalog snapshot'})`);
				if (offenders.length > 0) {
					return {
						ok: false,
						refusal: refused(
							'CATALOG_BINDING_REFUSED',
							'THE CATALOG-BINDING LAW',
							'advanceHarness: a harness is NEVER approved over an unapproved capability - every capabilityRef must sit at approved/enabled/available in the catalog snapshot (fail-closed escalation)',
							{ offenders },
						),
					};
				}
				law = 'THE CATALOG-BINDING LAW';
				detail = 'approved the harness (every capabilityRef sits at approved/enabled/available in the catalog snapshot)';
			} else if (target === 'active') {
				const walked = walkDecision(decision, 'active');
				if (typeof walked === 'string') {
					return { ok: false, refusal: refused('MALFORMED_DECISION', 'THE FAIL-CLOSED LAW', walked) };
				}
				decisionRecord = walked;
				detail = 'activated the harness (the operator act)';
			} else {
				const walked = walkDecision(decision, 'retired');
				if (typeof walked === 'string') {
					return { ok: false, refusal: refused('MALFORMED_DECISION', 'THE FAIL-CLOSED LAW', walked) };
				}
				decisionRecord = walked;
				detail = 'retired the harness (terminal; a changed harness is a NEW harness id)';
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const record: HarnessRecord = {
				harnessId: entry.harnessId,
				contractVersion: entry.contractVersion,
				state: target,
				descriptor: entry.descriptor,
				mintedAtIso: entry.mintedAtIso,
				revision: entry.revision + 1,
				history: [...entry.history, { at, fromState: entry.state, toState: target, law, decision: decisionRecord, detail }],
				lastValidation: validation ?? entry.lastValidation,
			};
			const line: HarnessOpsLedgerLine = {
				seq: seq + 1,
				at,
				contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
				op: 'transition',
				harnessId: entry.harnessId,
				fromState: entry.state,
				toState: target,
				law,
				decision: decisionRecord,
				descriptor: null,
				validation,
				detail,
			};
			const nextEntries = new Map(entries);
			nextEntries.set(entry.harnessId, record);
			const persistResult = await persist(line, nextEntries);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextEntries);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return { ok: true, record: copyRecord(record) };
		},
		async inspectHarness(harnessId: unknown): Promise<HarnessInspectOutcome> {
			if (disposed) {
				return { ok: false, refusal: refused('DISPOSED', 'THE DISPOSE LAW', 'inspectHarness: the kit was disposed - every operation after dispose rejects') };
			}
			if (!isHarnessId(harnessId)) {
				return { ok: false, refusal: refused('NOT_FOUND', 'THE FAIL-CLOSED LAW', `inspectHarness: no harness with id '${showValue(harnessId)}' (a malformed id fails closed as not-found)`) };
			}
			const entry = entries.get(harnessId);
			if (entry === undefined) {
				return { ok: false, refusal: refused('NOT_FOUND', 'THE FAIL-CLOSED LAW', `inspectHarness: no harness with id '${harnessId}'`) };
			}
			return { ok: true, record: copyRecord(entry) };
		},
		async listHarnesses(filter?: unknown): Promise<HarnessListOutcome> {
			if (disposed) {
				return { ok: false, refusal: refused('DISPOSED', 'THE DISPOSE LAW', 'listHarnesses: the kit was disposed - every operation after dispose rejects') };
			}
			if (filter !== undefined) {
				if (!isRecord(filter)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listHarnesses: the filter must be an object (or absent)') };
				}
				const filterRecord = filter as Record<string, unknown>;
				const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'industry' && key !== 'workType' && key !== 'state');
				if (unknownFields.length > 0) {
					return {
						ok: false,
						refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listHarnesses: the filter carries an unknown field (industry / workType / state only)', {
							offenders: unknownFields,
						}),
					};
				}
				if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listHarnesses: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list') };
				}
				if (filterRecord.workType !== undefined && !isHarnessWorkType(filterRecord.workType)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listHarnesses: the workType filter value is not a member of the frozen HARNESS_WORK_TYPES list') };
				}
				if (filterRecord.state !== undefined && !isHarnessLifecycleState(filterRecord.state)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listHarnesses: the state filter value is not a member of the frozen HARNESS_LIFECYCLE_STATES list') };
				}
			}
			const ids = [...entries.keys()].sort();
			const records: HarnessRecord[] = [];
			for (const id of ids) {
				const entry = entries.get(id) as HarnessRecord;
				if (filter !== undefined && !matchesFilter(entry, filter as Record<string, unknown>)) {
					continue;
				}
				records.push(copyRecord(entry));
			}
			return { ok: true, records };
		},
		dispose(): void {
			disposed = true;
		},
	};
}

// --- decision walks (the frozen per-transition shapes) ---

function walkDecision(decision: unknown, target: 'approved' | 'active' | 'retired'): Readonly<Record<string, string>> | string {
	if (decision === undefined || decision === null || !isRecord(decision)) {
		return `advanceHarness: the ${target} transition requires the decision object (${decisionShapeOf(target)})`;
	}
	const record = decision as Record<string, unknown>;
	const allowed = decisionKeysOf(target);
	const keys = Object.keys(record);
	const unknownKeys = keys.filter((key) => !allowed.includes(key));
	if (unknownKeys.length > 0) {
		return `advanceHarness: the ${target} decision carries an unknown key '${unknownKeys[0]}' (${decisionShapeOf(target)})`;
	}
	const requiredKey = target === 'approved' ? 'approvedBy' : target === 'active' ? 'activatedBy' : 'retiredBy';
	if (typeof record[requiredKey] !== 'string' || (record[requiredKey] as string).length === 0) {
		return `advanceHarness: the ${target} decision requires the '${requiredKey}' key (${decisionShapeOf(target)})`;
	}
	for (const key of keys) {
		if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
			return `advanceHarness: the ${target} decision's '${key}' value must be a non-empty string`;
		}
	}
	const canonical: Record<string, string> = {};
	for (const key of ['approvedBy', 'activatedBy', 'retiredBy', 'note', 'reason'] as const) {
		if (Object.prototype.hasOwnProperty.call(record, key)) {
			canonical[key] = record[key] as string;
		}
	}
	return canonical;
}

function decisionShapeOf(target: 'approved' | 'active' | 'retired'): string {
	if (target === 'approved') {
		return '{ approvedBy, note? }';
	}
	if (target === 'active') {
		return '{ activatedBy }';
	}
	return '{ retiredBy, reason? }';
}

function decisionKeysOf(target: 'approved' | 'active' | 'retired'): string[] {
	if (target === 'approved') {
		return ['approvedBy', 'note'];
	}
	if (target === 'active') {
		return ['activatedBy'];
	}
	return ['retiredBy', 'reason'];
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface LedgerReplay {
	readonly lines: readonly HarnessOpsLedgerLine[];
	readonly entries: Map<string, HarnessRecord>;
}

/** Parses and validates the whole ledger text; returns the torn detail or the replay (never a silent skip). */
function replayLedger(ledgerText: string | null): LedgerReplay | string {
	if (ledgerText === null || ledgerText.length === 0) {
		return { lines: [], entries: new Map<string, HarnessRecord>() };
	}
	if (!ledgerText.endsWith('\n')) {
		return 'loadHarnessKit: the ledger does not end with a complete line (a torn append - never a silent skip)';
	}
	const entries = new Map<string, HarnessRecord>();
	const lines: HarnessOpsLedgerLine[] = [];
	const rawLines = ledgerText.split('\n');
	rawLines.pop();
	for (let i = 0; i < rawLines.length; i += 1) {
		if (rawLines[i].length === 0) {
			return `loadHarnessKit: ledger line ${i + 1} is empty`;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawLines[i]);
		} catch {
			return `loadHarnessKit: ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`;
		}
		const torn = validateLedgerLine(parsed, i + 1, entries);
		if (torn !== null) {
			return torn;
		}
		const record = parsed as Record<string, unknown>;
		const line: HarnessOpsLedgerLine = {
			seq: record.seq as number,
			at: record.at as string,
			contractVersion: record.contractVersion as string,
			op: record.op as 'mint' | 'transition',
			harnessId: record.harnessId as string,
			fromState: record.fromState as HarnessLifecycleState | null,
			toState: record.toState as HarnessLifecycleState,
			law: record.law as string,
			decision: record.decision as Readonly<Record<string, string>> | null,
			descriptor: record.descriptor as DomainHarnessDescriptor | null,
			validation: record.validation as HarnessValidationOutcome | null,
			detail: record.detail as string,
		};
		applyLine(entries, line);
		lines.push(line);
	}
	return { lines, entries };
}

/** Validates one parsed ledger line; returns the torn detail or null (the line is structurally valid). */
function validateLedgerLine(parsed: unknown, lineNo: number, entries: Map<string, HarnessRecord>): string | null {
	if (!isRecord(parsed)) {
		return `loadHarnessKit: ledger line ${lineNo} is not a JSON object`;
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...HARNESS_LEDGER_LINE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length) {
		return `loadHarnessKit: ledger line ${lineNo} is structurally invalid (the frozen twelve-key line schema)`;
	}
	for (let i = 0; i < keys.length; i += 1) {
		if (keys[i] !== expected[i]) {
			return `loadHarnessKit: ledger line ${lineNo} is structurally invalid (the frozen twelve-key line schema)`;
		}
	}
	if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
		return `loadHarnessKit: ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`;
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return `loadHarnessKit: ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`;
	}
	if (record.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		return `loadHarnessKit: ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${DOMAIN_HARNESS_CONTRACTS_VERSION}' is known (the single-version law)`;
	}
	if (record.op !== 'mint' && record.op !== 'transition') {
		return `loadHarnessKit: ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`;
	}
	if (!isHarnessId(record.harnessId)) {
		return `loadHarnessKit: ledger line ${lineNo} carries a malformed harness id`;
	}
	if (record.fromState !== null && !isHarnessLifecycleState(record.fromState)) {
		return `loadHarnessKit: ledger line ${lineNo} carries an unknown fromState`;
	}
	if (!isHarnessLifecycleState(record.toState)) {
		return `loadHarnessKit: ledger line ${lineNo} carries an unknown toState`;
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return `loadHarnessKit: ledger line ${lineNo} carries no law name (the provenance law)`;
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return `loadHarnessKit: ledger line ${lineNo} carries no provenance detail`;
	}
	if (record.decision !== null) {
		if (!isRecord(record.decision)) {
			return `loadHarnessKit: ledger line ${lineNo} carries a malformed decision`;
		}
		for (const value of Object.values(record.decision)) {
			if (typeof value !== 'string' || value.length === 0) {
				return `loadHarnessKit: ledger line ${lineNo} carries a malformed decision value`;
			}
		}
	}
	if (record.op === 'mint') {
		if (record.fromState !== null || record.toState !== 'draft') {
			return `loadHarnessKit: ledger line ${lineNo} is a mint line that does not land 'draft' (every harness enters at draft)`;
		}
		if (!isHarnessValidationOutcome(record.validation) || record.validation.ok !== true || record.validation.mode !== 'shape') {
			return `loadHarnessKit: ledger line ${lineNo} is a mint line without the green shape-validation outcome (THE TWO-PHASE LAW's draft mode)`;
		}
		const shape = validateHarnessDescriptorShape(record.descriptor);
		if (!shape.ok) {
			return `loadHarnessKit: ledger line ${lineNo} is a mint line whose descriptor fails the shape walk`;
		}
		if (shape.descriptor.harnessId !== record.harnessId) {
			return `loadHarnessKit: ledger line ${lineNo} is a mint line whose descriptor id diverges from the line's harness id`;
		}
		if (entries.has(record.harnessId as string)) {
			return `loadHarnessKit: ledger line ${lineNo} mints a duplicate harness id`;
		}
	} else {
		if (record.descriptor !== null) {
			return `loadHarnessKit: ledger line ${lineNo} is a transition line that carries a descriptor (the descriptor is IMMUTABLE - carried once, at the mint)`;
		}
		if (record.toState === 'proposed') {
			if (!isHarnessValidationOutcome(record.validation) || record.validation.ok !== true || record.validation.mode !== 'full') {
				return `loadHarnessKit: ledger line ${lineNo} is a propose line without the green full-validation outcome (THE NO-DANGLING-REF LAW's boundary)`;
			}
		} else if (record.validation !== null) {
			return `loadHarnessKit: ledger line ${lineNo} carries a validation outcome outside the mint / propose boundaries`;
		}
		const entry = entries.get(record.harnessId as string);
		if (entry === undefined) {
			return `loadHarnessKit: ledger line ${lineNo} advances an unknown harness`;
		}
		if (record.fromState !== entry.state) {
			return `loadHarnessKit: ledger line ${lineNo} is out of order (its fromState is not the harness's current state)`;
		}
		const verdict = canTransitionHarnessLifecycle(record.fromState, record.toState);
		if (!verdict.ok) {
			return `loadHarnessKit: ledger line ${lineNo} carries an illegal transition (${verdict.detail})`;
		}
	}
	return null;
}

/** Applies one validated ledger line to the replay entries (pure fold). */
function applyLine(entries: Map<string, HarnessRecord>, line: HarnessOpsLedgerLine): void {
	if (line.op === 'mint') {
		const shape = validateHarnessDescriptorShape(line.descriptor);
		entries.set(line.harnessId, {
			harnessId: line.harnessId,
			contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
			state: line.toState,
			descriptor: shape.ok ? shape.descriptor : (line.descriptor as DomainHarnessDescriptor),
			mintedAtIso: line.at,
			revision: 1,
			history: [
				{
					at: line.at,
					fromState: null,
					toState: line.toState,
					law: line.law,
					decision: line.decision,
					detail: line.detail,
				},
			],
			lastValidation: line.validation as HarnessValidationOutcome,
		});
		return;
	}
	const entry = entries.get(line.harnessId);
	if (entry === undefined) {
		return;
	}
	entries.set(line.harnessId, {
		harnessId: entry.harnessId,
		contractVersion: entry.contractVersion,
		state: line.toState,
		descriptor: entry.descriptor,
		mintedAtIso: entry.mintedAtIso,
		revision: entry.revision + 1,
		history: [
			...entry.history,
			{
				at: line.at,
				fromState: line.fromState,
				toState: line.toState,
				law: line.law,
				decision: line.decision,
				detail: line.detail,
			},
		],
		lastValidation: line.validation ?? entry.lastValidation,
	});
}

/** Cross-checks the envelope against the replay; returns the refusal carrier or null. */
function crossCheckEnvelope(
	envelopeText: string | null,
	lineCount: number,
	replayed: Map<string, HarnessRecord>,
): { reason: 'E_LEDGER_TORN' | 'E_ENVELOPE_MISMATCH'; detail: string } | null {
	if (envelopeText === null) {
		if (lineCount === 0) {
			return null;
		}
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			detail: `loadHarnessKit: the envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`,
		};
	}
	let parsedEnvelope: unknown;
	try {
		parsedEnvelope = JSON.parse(envelopeText);
	} catch {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope is not valid JSON' };
	}
	if (!isRecord(parsedEnvelope)) {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope is not a JSON object' };
	}
	const envelope = parsedEnvelope as Record<string, unknown>;
	const keys = Object.keys(envelope).sort();
	const expected = [...HARNESS_ENVELOPE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope is structurally invalid (the frozen three-key envelope schema)' };
	}
	if (envelope.contractVersion !== DOMAIN_HARNESS_CONTRACTS_VERSION) {
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			detail: `loadHarnessKit: the envelope carries contract version ${showValue(envelope.contractVersion)} - only '${DOMAIN_HARNESS_CONTRACTS_VERSION}' is known (the single-version law)`,
		};
	}
	if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope carries a malformed seq' };
	}
	if (!Array.isArray(envelope.harnesses)) {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope carries a malformed harnesses array' };
	}
	if (envelope.seq > lineCount) {
		return {
			reason: 'E_LEDGER_TORN',
			detail: `loadHarnessKit: the envelope claims seq ${envelope.seq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`,
		};
	}
	if (envelope.seq < lineCount) {
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			detail: `loadHarnessKit: the envelope claims seq ${envelope.seq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`,
		};
	}
	for (let i = 0; i < envelope.harnesses.length; i += 1) {
		if (!isHarnessRecord(envelope.harnesses[i])) {
			return { reason: 'E_ENVELOPE_MISMATCH', detail: `loadHarnessKit: the envelope's harnesses[${i}] is not a valid harness record` };
		}
	}
	const envelopeRecordMap = new Map<string, HarnessRecord>();
	for (const record of envelope.harnesses as unknown[]) {
		const harnessRecord = record as HarnessRecord;
		envelopeRecordMap.set(harnessRecord.harnessId, harnessRecord);
	}
	const replayBytes = envelopeBytesOf(envelope.seq as number, replayed);
	const envelopeBytes = envelopeBytesOf(envelope.seq as number, envelopeRecordMap);
	if (replayBytes !== envelopeBytes) {
		return { reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)' };
	}
	return null;
}

function envelopeBytesOf(seq: number, entries: Map<string, HarnessRecord>): string {
	const ids = [...entries.keys()].sort();
	const records = ids.map((id) => entries.get(id) as HarnessRecord);
	return `{"contractVersion":${JSON.stringify(DOMAIN_HARNESS_CONTRACTS_VERSION)},"seq":${seq},"harnesses":[${records
		.map((record) => serializeHarnessRecord(record))
		.join(',')}]}`;
}

// --- internal helpers (never exported) ---

/** Pure predicate: a plain object (not null, not an array). */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
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

/** Extracts an honest message from a thrown value (never re-throws). */
function toMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/** Shows a value for a deterministic detail sentence (primitives only). */
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

function matchesFilter(record: HarnessRecord, filter: Record<string, unknown>): boolean {
	if (filter.industry !== undefined && record.descriptor.industry !== filter.industry) {
		return false;
	}
	if (filter.workType !== undefined && !record.descriptor.workTypes.includes(filter.workType as HarnessWorkType)) {
		return false;
	}
	if (filter.state !== undefined && record.state !== filter.state) {
		return false;
	}
	return true;
}

/** Builds the canonical fixed-key-order object of a decision (only the present keys, in the frozen order). */
function decisionObject(decision: Readonly<Record<string, string>>): Record<string, string> {
	const canonical: Record<string, string> = {};
	for (const key of ['approvedBy', 'activatedBy', 'retiredBy', 'note', 'reason'] as const) {
		if (Object.prototype.hasOwnProperty.call(decision, key)) {
			canonical[key] = decision[key];
		}
	}
	return canonical;
}

/** Builds the canonical fixed-key-order object of a descriptor (for the ledger line bytes). */
function descriptorObject(descriptor: DomainHarnessDescriptor): Record<string, unknown> {
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

/** Builds the canonical fixed-key-order object of a validation outcome (for the ledger line bytes). */
function validationObject(outcome: HarnessValidationOutcome): Record<string, unknown> {
	if (outcome.ok) {
		return {
			ok: true,
			mode: outcome.mode,
			descriptor: descriptorObject(outcome.descriptor),
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
