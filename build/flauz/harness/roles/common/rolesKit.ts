/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-003 role-composition kit: the deterministic staged-session runtime
 * over the roles contract vocabulary AND the REAL DH-02 onboarding
 * surfaces (imported, never re-implemented - THE IMPORT LAW, this
 * wave's charter). The kit walks a session begin -> addRole /
 * replaceRoleSummary / removeRole -> finalizeComposition:
 * beginSession mints the flauz:rol:<16-hex> id from the injected rng
 * (the composition is industry-scoped over the REAL frozen
 * HARNESS_INDUSTRIES list, imported by reference); the role ops apply
 * the composition-layer role laws (shape, bounds, uniqueness, the
 * MAX_ROLES bound); finalizeComposition freezes the composition
 * (composing -> composed, TERMINAL - the empty-roles floor fires
 * there, never the session shape); emitReviewComposition returns the
 * full OnboardingReviewComposition on a COMPOSED session only (the
 * typed premature-op refusal otherwise) - the composed roles carried
 * VERBATIM from the frozen composition and the four ref families from
 * the caller's optional refs record (validated string arrays,
 * duplicate-free, defaulting to EMPTY - never invented; the emit MUST
 * pass the REAL validateOnboardingReviewComposition, the imported
 * cross-check - a divergence is a bug in this composition, fail
 * closed). The emit is a READ op: no clock read, no ledger line.
 * NO catalog is injected: the composition resolves nothing - the
 * propose boundary is the DH-02 kit's own, through the real catalog
 * (THE HONEST-GAP LAW: the absent workflow / policy / evidence
 * authorities are the DH-004 / DH-005 / DH-008 waves; an empty family
 * is the truth, a fabricated id would be the fork).
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the landed
 * DH-01/DH-02 laws EXACTLY): the same .flauz/harness subtree,
 * distinct files - the append-only ops ledger
 * .flauz/harness/roles-ops.jsonl (one canonical JSON line per applied
 * op, the seq strictly increasing and equal to the line number) and
 * the envelope .flauz/harness/roles-sessions.json ({ contractVersion,
 * seq, sessions }). The ledger is authoritative; loadRolesKit replays
 * it and cross-checks the envelope byte-for-byte (a torn or missing
 * line is the typed E_LEDGER_TORN; a divergent envelope is the typed
 * E_ENVELOPE_MISMATCH - never silently rebuilt). A version-bearing
 * surface (a ledger line or the envelope) carrying another contract
 * version is the typed version-mismatch - THE SINGLE-VERSION LAW's
 * live station in this family (the five-key session record carries no
 * version field). Lazy persistence (the subtree lands with the first
 * applied op); a fresh kit never appends over a non-empty roles
 * ledger - reopen with loadRolesKit; restart-deterministic.
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE IMPORT LAW: the frozen vocabularies, the HarnessRole law, the
 *   review-composition validator, the ref-family list
 *   (HARNESS_REF_FAMILIES) and the persistence architecture are the
 *   LANDED DH-01/DH-02 surfaces - imported from the real modules
 *   (../../contract/common/domainHarnessContract.js,
 *   ../../onboarding/common/onboardingContract.js, the DH-01 kit's
 *   OWN HarnessFsPort type), never re-declared, never shadowed (the
 *   battery pins the imports).
 * - THE FORWARD-ONLY LAW: composing -> composed; 'composed' is
 *   TERMINAL (the composition is FROZEN; every mutating op on a
 *   composed session refuses with the typed stale-stage refusal; the
 *   emit before finalize refuses with the typed premature-op
 *   refusal); a changed composition is a NEW session (the composition
 *   lineage law).
 * - THE REMOVE+RE-ADD LAW: a role's key is its identity - immutable
 *   once added. replaceRoleSummary replaces ONLY the summary; a
 *   changed key is a NEW role (remove, then re-add). Removing the
 *   last role is LEGAL while composing (the empty-roles floor fires
 *   only at finalize).
 * - THE NO-FORK LAW: the composition alphabet is configuration only;
 *   the role-entry walk rejects execution material before anything is
 *   applied; a named role grants NOTHING by itself.
 * - THE HONEST-GAP LAW: the absent workflow / policy / evidence
 *   authorities are disclosed, never papered over - the emit's ref
 *   families default EMPTY (an empty family is the truth; a
 *   fabricated id would be the fork; the owning waves are DH-004 /
 *   DH-005 / DH-008). Resolution happens at the DH-02 propose
 *   boundary against the bound catalog - never here.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock, the rng and the fsPort are INJECTED seams; the persisted
 *   bytes are canonical fixed-key-order JSON; restart determinism is
 *   pinned by the battery. The factory consumes exactly ONE clock
 *   read and ONE rng read (there is no inner kit to re-validate the
 *   seams - unlike the DH-02 kit's doubled reads; the battery pins
 *   the exact count).
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError (every
 *   factory precondition checked with the exact DH-01 message shape);
 *   every domain refusal is a typed record { reason, law, detail,
 *   items? } naming the violated law and the offending items - never
 *   a string throw, never a silent skip, never a partial effect (a
 *   refused op leaves the session unchanged); payload-walk refusals
 *   carry the COMPLETE contract rejection table (never first-only).
 * - THE SINGLE-VERSION LAW: ROLES_CONTRACTS_VERSION is declared ONCE
 *   in the contract module, re-carried by this kit (the re-export);
 *   DOMAIN_HARNESS_CONTRACTS_VERSION and ONBOARDING_CONTRACTS_VERSION
 *   are re-carried through the re-export chain; the battery pins
 *   every copy equal.
 * - THE APPEND-ONLY LEDGER LAW: as the persistence paragraph above.
 * - THE DISPOSE LAW: every operation after dispose rejects with the
 *   typed DISPOSED refusal.
 */

import {
	MAX_ROLES,
	ROLES_CONTRACTS_VERSION,
	ROLE_COMPOSITION_ID_PREFIX,
	ROLES_REJECTION_REASONS,
	isHarnessIndustry,
	isRoleCompositionOpName,
	isRoleCompositionSessionId,
	isRoleCompositionStage,
	serializeRoleCompositionSession,
	validateRoleCompositionSession,
	validateReviewCompositionEmit,
	validateRoleEntry,
	validateRoleSummary,
} from './rolesContract.js';
import type {
	HarnessIndustry,
	HarnessRole,
	RoleCompositionOpName,
	RoleCompositionRejection,
	RoleCompositionSession,
	RoleCompositionStage,
	RoleCompositionTransitionNote,
} from './rolesContract.js';
import { validateOnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';
import type { OnboardingRefusal, OnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';
import type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ROLES_CONTRACTS_VERSION } from './rolesContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-01 version, re-carried by reference. */
export { DOMAIN_HARNESS_CONTRACTS_VERSION } from '../../contract/common/domainHarnessContract.js';

/** THE SINGLE-VERSION LAW (the re-export chain): the landed DH-02 version, re-carried by reference. */
export { ONBOARDING_CONTRACTS_VERSION } from '../../onboarding/common/onboardingContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The REAL DH-02 review-composition type (re-exported by reference - the emit's return shape). */
export type { OnboardingReviewComposition } from '../../onboarding/common/onboardingContract.js';

/** The verbatim DH-02 refusal carrier (re-exported by reference for the imported cross-check surface). */
export type { OnboardingRefusal } from '../../onboarding/common/onboardingContract.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as DH-01/DH-02, distinct file). */
export const ROLES_ENVELOPE_RELATIVE_PATH = '.flauz/harness/roles-sessions.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree, distinct file). */
export const ROLES_LEDGER_RELATIVE_PATH = '.flauz/harness/roles-ops.jsonl';

/**
 * The frozen ledger-line schema keys, in the canonical fixed-key-order
 * (the TEN-KEY line: NO harness link - this family mints no harness;
 * the DH-02 composeDraft mints it later through the real DH-01 kit,
 * THE REAL-KIT LAW of the onboarding family).
 */
export const ROLES_LEDGER_LINE_SCHEMA_KEYS = [
	'seq',
	'at',
	'contractVersion',
	'op',
	'sessionId',
	'fromStage',
	'toStage',
	'law',
	'payload',
	'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const ROLES_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'sessions'] as const;

/**
 * One append-only role-composition ops ledger line (the canonical
 * persisted op): the seq (equal to the line number), the clock
 * reading, the contract version, the op name, the session id, the
 * stage edge walked (fromStage null ONLY on the begin line; the
 * add-role / replace-role-summary / remove-role lines walk the
 * composing->composing self edge - the composition composes
 * gradually), the granting law, the canonical op payload (the
 * industry on begin; the added / replacement / removed-as-it-stood
 * role entry on the role ops; null on finalize), and the
 * deterministic detail sentence.
 */
export interface RolesOpsLedgerLine {
	readonly seq: number;
	readonly at: string;
	readonly contractVersion: string;
	readonly op: RoleCompositionOpName;
	readonly sessionId: string;
	readonly fromStage: RoleCompositionStage | null;
	readonly toStage: RoleCompositionStage;
	readonly law: string;
	readonly payload: HarnessIndustry | HarnessRole | null;
	readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ROLES_REJECTION_REASONS):
 *   DISPOSED             - THE DISPOSE LAW: the kit was disposed;
 *                          every operation after dispose rejects;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted session id);
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing roles ledger line, a structurally
 *                          invalid or out-of-order line, an unknown op
 *                          or an illegal stage edge inside the ledger,
 *                          or a fresh kit attempting to append over an
 *                          existing non-empty roles ledger (reopen
 *                          with loadRolesKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the roles
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   ROLES_IO             - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the roles family's own files;
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listSessions received
 *                          an unknown filter field or a non-member
 *                          filter value.
 * The contract's version-mismatch station fires at THIS layer for
 * every version-bearing persisted surface (a ledger line or the
 * envelope carrying another contract version) - THE SINGLE-VERSION
 * LAW's live station in this family.
 */
export const ROLES_KIT_EXTRA_REFUSAL_REASONS = [
	'DISPOSED',
	'CORRUPT_SEAM',
	'E_LEDGER_TORN',
	'E_ENVELOPE_MISMATCH',
	'ROLES_IO',
	'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 19 domain reasons plus the kit-layer extras. */
export const ROLES_KIT_REFUSAL_REASONS = [
	...ROLES_REJECTION_REASONS,
	...ROLES_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type RolesKitRefusalReason = (typeof ROLES_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isRolesKitRefusalReason(value: unknown): value is RolesKitRefusalReason {
	return (ROLES_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic detail sentence, the optional offending items, the
 * COMPLETE contract rejection table (payload-walk refusals - never
 * first-only), and - for the imported cross-check - the verbatim DH-02
 * refusal (unreachable through the staged laws; a divergence is a bug
 * in this composition, fail closed).
 */
export interface RolesKitRefusal {
	readonly reason: RolesKitRefusalReason;
	readonly law: string;
	readonly detail: string;
	readonly items?: readonly string[];
	/** payload-walk refusals carry the COMPLETE contract rejection table (never first-only). */
	readonly rejections?: readonly RoleCompositionRejection[];
	/** the imported DH-002 cross-check refusal, carried verbatim (unreachable through the staged laws). */
	readonly reviewRefusal?: OnboardingRefusal;
}

/**
 * The kit construction options (all injected, never env-read; fsPort
 * and root come together or not at all - the DH-01 options law).
 * NO catalog: the composition resolves nothing (the propose boundary
 * is the DH-02 kit's own, through the real catalog).
 */
export interface RolesKitOptions {
	/** The injected clock (returns the ISO string; the kit never reads a clock itself). */
	readonly clock: () => string;
	/** The session-id-minting seam (returns 16 lowercase hex chars; NEVER the random global). */
	readonly rng: () => string;
	/** The OPTIONAL filesystem seam (persistence when paired with root). */
	readonly fsPort?: HarnessFsPort;
	/** The OPTIONAL persistence root (the .flauz/harness subtree lands under it). */
	readonly root?: string;
}

/** The staged-session op outcome: ok carries the honest session record; failure carries the typed refusal. */
export type RolesSessionOutcome =
	| { readonly ok: true; readonly session: RoleCompositionSession }
	| { readonly ok: false; readonly refusal: RolesKitRefusal };

/** The emit outcome: ok carries the full OnboardingReviewComposition; failure carries the typed refusal. */
export type RolesEmitOutcome =
	| { readonly ok: true; readonly composition: OnboardingReviewComposition }
	| { readonly ok: false; readonly refusal: RolesKitRefusal };

/** The list outcome: ok carries the sessionId-ordered honest records; failure carries the typed refusal. */
export type RolesListOutcome =
	| { readonly ok: true; readonly sessions: readonly RoleCompositionSession[] }
	| { readonly ok: false; readonly refusal: RolesKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type RolesLoadOutcome =
	| { readonly ok: true; readonly kit: RolesKit }
	| { readonly ok: false; readonly refusal: RolesKitRefusal };

/**
 * The deterministic role-composition kit: every operation is async
 * with a typed outcome ({ ok: true, ... } | { ok: false, refusal });
 * a refused op leaves the session unchanged (inspectable before and
 * after); the emit is a READ op (no clock read, no ledger line).
 */
export interface RolesKit {
	beginSession(industry: unknown): Promise<RolesSessionOutcome>;
	addRole(sessionId: unknown, role: unknown): Promise<RolesSessionOutcome>;
	replaceRoleSummary(sessionId: unknown, roleKey: unknown, summary: unknown): Promise<RolesSessionOutcome>;
	removeRole(sessionId: unknown, roleKey: unknown): Promise<RolesSessionOutcome>;
	finalizeComposition(sessionId: unknown): Promise<RolesSessionOutcome>;
	emitReviewComposition(sessionId: unknown, refs?: unknown): Promise<RolesEmitOutcome>;
	inspectSession(sessionId: unknown): Promise<RolesSessionOutcome>;
	listSessions(filter?: unknown): Promise<RolesListOutcome>;
	dispose(): void;
}

/**
 * Creates a role-composition kit (fail-closed factory). Validation
 * order is deterministic and mirrors the landed DH-01/DH-02 factory
 * walk EXACTLY (the same preconditions, the same message shapes, the
 * createRolesKit prefix): the options shape (clock / rng), the
 * clock's first read (a non-empty ISO string), the rng's first read
 * (exactly 16 lowercase hex chars - the id-minting law), and the
 * fsPort/root pairing (both or neither; the port must expose
 * readFile / writeFile / appendFile / mkdir). The factory consumes
 * exactly ONE clock read and ONE rng read (there is no inner kit to
 * re-validate the seams - the battery pins the exact count). The kit
 * starts with ZERO sessions; persistence is LAZY (the .flauz/harness
 * subtree lands with the first applied op; a fresh kit never appends
 * over an existing non-empty roles ledger - reopen with loadRolesKit).
 */
export function createRolesKit(options: RolesKitOptions): RolesKit {
	const bound = validateKitOptions(options, false, 'createRolesKit');
	return buildRolesKit(bound, { seq: 0, sessions: new Map<string, RoleCompositionSession>() });
}

/**
 * Reopens a persisted role-composition kit: replays the append-only
 * roles ops ledger (the authoritative surface - each line re-validated:
 * the frozen ten-key line schema, the op's stage edge, the session's
 * walk order, the payload's full validation, the MAX_ROLES bound, the
 * remove line's entry-as-it-stood cross-check, the finalize floor),
 * and cross-checks the envelope byte-for-byte against the
 * replay-built state. A torn or missing roles ledger line is the typed
 * E_LEDGER_TORN; a divergent, missing or malformed envelope is the
 * typed E_ENVELOPE_MISMATCH (never silently rebuilt); a version-
 * bearing surface carrying another contract version is the typed
 * version-mismatch (THE SINGLE-VERSION LAW's live station); a refused
 * fs port is the typed ROLES_IO. A fresh root (no files) reopens as
 * an empty kit. The options require BOTH fsPort and root (the load is
 * a persistence-surface operation).
 */
export async function loadRolesKit(options: RolesKitOptions): Promise<RolesLoadOutcome> {
	const bound = validateKitOptions(options, true, 'loadRolesKit');
	const fsPort = bound.fsPort as HarnessFsPort;
	const ledgerPath = `${bound.root}/${ROLES_LEDGER_RELATIVE_PATH}`;
	const envelopePath = `${bound.root}/${ROLES_ENVELOPE_RELATIVE_PATH}`;
	try {
		await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
	} catch (error) {
		return { ok: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `loadRolesKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
	}
	let ledgerText: string | null;
	try {
		ledgerText = await readText(fsPort, ledgerPath);
	} catch (error) {
		return { ok: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `loadRolesKit: the fs port refused the roles ledger read: ${toMessage(error)}`) };
	}
	let envelopeText: string | null;
	try {
		envelopeText = await readText(fsPort, envelopePath);
	} catch (error) {
		return { ok: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `loadRolesKit: the fs port refused the roles envelope read: ${toMessage(error)}`) };
	}
	const replay = replayRolesLedger(ledgerText);
	if (!('lines' in replay)) {
		return { ok: false, refusal: replay };
	}
	const crossCheck = crossCheckRolesEnvelope(envelopeText, replay.lines.length, replay.sessions);
	if (crossCheck !== null) {
		return { ok: false, refusal: crossCheck };
	}
	return { ok: true, kit: buildRolesKit(bound, { seq: replay.lines.length, sessions: replay.sessions }) };
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
	readonly rng: () => string;
	readonly fsPort: HarnessFsPort | null;
	readonly root: string | null;
}

interface RolesKitState {
	readonly seq: number;
	readonly sessions: ReadonlyMap<string, RoleCompositionSession>;
}

/** The persist fold's result: applied means the roles ledger line landed (the ledger is authoritative). */
type PersistResult =
	| { readonly applied: false; readonly refusal: RolesKitRefusal }
	| { readonly applied: true; readonly refusal: RolesKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: RolesKitRefusal };

function validateKitOptions(options: RolesKitOptions, requirePersistence: boolean, factoryName: 'createRolesKit' | 'loadRolesKit'): BoundOptions {
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
			`${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${ROLE_COMPOSITION_ID_PREFIX}<16-hex>)`,
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
	reason: RolesKitRefusalReason,
	law: string,
	detail: string,
	items?: readonly string[],
	extra?: Omit<RolesKitRefusal, 'reason' | 'law' | 'detail' | 'items'>,
): RolesKitRefusal {
	if (items === undefined) {
		return { reason, law, detail, ...extra };
	}
	return { reason, law, detail, items, ...extra };
}

/**
 * Surfaces a payload walk's typed refusal: the reason / law / items
 * mirror the FIRST rejection (the frozen walk order's head) and the
 * COMPLETE rejection table is carried in rejections (never
 * first-only - THE FAIL-CLOSED LAW's complete-table discipline).
 */
function payloadRefused(
	opName: string,
	outcome: { readonly ok: false; readonly mode: 'shape'; readonly rejections: readonly RoleCompositionRejection[] },
): RolesKitRefusal {
	const first = outcome.rejections[0];
	return {
		reason: first.reason,
		law: first.law,
		detail: `${opName}: the payload walk refused - the COMPLETE rejection table follows in the frozen walk order (the first station: ${first.detail})`,
		items: first.items,
		rejections: outcome.rejections,
	};
}

function buildRolesKit(bound: BoundOptions, seed: RolesKitState): RolesKit {
	let disposed = false;
	let mutableSeq = seed.seq;
	const sessions = new Map<string, RoleCompositionSession>(seed.sessions);
	const persisted = bound.fsPort !== null && bound.root !== null;
	const fsPort = bound.fsPort;
	const ledgerPath = bound.root !== null ? `${bound.root}/${ROLES_LEDGER_RELATIVE_PATH}` : '';
	const envelopePath = bound.root !== null ? `${bound.root}/${ROLES_ENVELOPE_RELATIVE_PATH}` : '';
	let dirEnsured = false;
	// A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
	// (its ledger preexists; only a fresh createRolesKit guards the append).
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

	function copySession(record: RoleCompositionSession): RoleCompositionSession {
		return JSON.parse(serializeRoleCompositionSession(record)) as RoleCompositionSession;
	}

	/**
	 * THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
	 * first (the ledger is authoritative - the seq advances with the
	 * line), the envelope rewrite lands second, the in-memory sessions
	 * commit last (in the caller). An append refusal leaves NOTHING
	 * applied; an envelope refusal leaves the op applied and the line
	 * landed (the refusal discloses it; a reload fails closed with
	 * E_ENVELOPE_MISMATCH until the next op rewrites the envelope).
	 */
	async function persist(line: RolesOpsLedgerLine, nextSessions: Map<string, RoleCompositionSession>): Promise<PersistResult> {
		if (!persisted || fsPort === null) {
			mutableSeq = line.seq;
			return { applied: true, refusal: null };
		}
		if (!ledgerGuardDone) {
			let existing: string | null;
			try {
				existing = await readText(fsPort, ledgerPath);
			} catch (error) {
				return { applied: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the roles ledger read: ${toMessage(error)}`) };
			}
			if (existing !== null && existing.trim().length > 0) {
				return {
					applied: false,
					refusal: refused(
						'E_LEDGER_TORN',
						'THE APPEND-ONLY LEDGER LAW',
						'persist: the roles ledger already carries lines - reopen with loadRolesKit (a fresh kit never appends over an existing ledger)',
					),
				};
			}
			ledgerGuardDone = true;
		}
		if (!dirEnsured) {
			try {
				await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
			} catch (error) {
				return { applied: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
			}
			dirEnsured = true;
		}
		try {
			await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
		} catch (error) {
			return { applied: false, refusal: refused('ROLES_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the roles ledger append: ${toMessage(error)} (nothing was applied)`) };
		}
		mutableSeq = line.seq;
		try {
			await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextSessions));
		} catch (error) {
			return {
				applied: true,
				refusal: refused(
					'ROLES_IO',
					'THE FAIL-CLOSED LAW',
					`persist: the roles ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
				),
			};
		}
		return { applied: true, refusal: null };
	}

	function commit(nextSessions: Map<string, RoleCompositionSession>): void {
		sessions.clear();
		for (const [id, record] of nextSessions) {
			sessions.set(id, record);
		}
	}

	function sessionOutcome(record: RoleCompositionSession): RolesSessionOutcome {
		return { ok: true, session: copySession(record) };
	}

	/** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
	function refuseIfDisposed(opName: string): RolesKitRefusal | null {
		if (disposed) {
			return refused('DISPOSED', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
		}
		return null;
	}

	/** The unknown-session guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
	function lookupSession(opName: string, sessionId: unknown): { session: RoleCompositionSession } | { refusal: RolesKitRefusal } {
		if (!isRoleCompositionSessionId(sessionId)) {
			return { refusal: refused('unknown-session', 'THE FAIL-CLOSED LAW', `${opName}: no session with id '${showValue(sessionId)}' (a malformed id fails closed as unknown-session)`) };
		}
		const session = sessions.get(sessionId);
		if (session === undefined) {
			return { refusal: refused('unknown-session', 'THE FAIL-CLOSED LAW', `${opName}: no session with id '${sessionId}'`) };
		}
		return { session };
	}

	/**
	 * THE FORWARD-ONLY LAW's stage guard: the mutating ops require the
	 * 'composing' stage (a composed session is past them - stale-stage,
	 * 'composed' is TERMINAL); the emit requires the 'composed' stage
	 * (a composing session is behind it - premature-op).
	 */
	function stageGuard(opName: string, session: RoleCompositionSession, requiredStage: RoleCompositionStage): RolesKitRefusal | null {
		if (session.stage === requiredStage) {
			return null;
		}
		if (requiredStage === 'composed') {
			return refused(
				'premature-op',
				'THE FORWARD-ONLY LAW',
				`${opName}: the session is at the '${session.stage}' stage - the op requires the 'composed' stage (finalizeComposition must freeze the composition first; the stage machine never walks back)`,
				[session.stage],
			);
		}
		return refused(
			'stale-stage',
			'THE FORWARD-ONLY LAW',
			`${opName}: the session is at the '${session.stage}' stage - the composition is FROZEN ('composed' is TERMINAL; a changed composition is a NEW session, the composition lineage law) (THE FORWARD-ONLY LAW)`,
			[session.stage],
		);
	}

	/** The role lookup for replace / remove (a malformed key fails closed as unknown-role). */
	function findRole(session: RoleCompositionSession, roleKey: unknown): HarnessRole | null {
		if (typeof roleKey !== 'string') {
			return null;
		}
		const found = session.roles.find((role) => role.roleKey === roleKey);
		return found === undefined ? null : found;
	}

	return {
		async beginSession(industry: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('beginSession');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (!isHarnessIndustry(industry)) {
				return {
					ok: false,
					refusal: refused(
						'unknown-industry',
						'THE FROZEN-VOCABULARY LAW',
						`beginSession: the industry must be a member of the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract (membership is the only admissibility; the composition is industry-scoped)`,
						[showValue(industry)],
					),
				};
			}
			const hex = bound.rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginSession: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
			}
			const sessionId = `${ROLE_COMPOSITION_ID_PREFIX}${hex}`;
			if (sessions.has(sessionId)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginSession: the injected rng minted a duplicate session id (the id-minting seam is corrupt)') };
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `began the role-composition session scoped to the '${industry}' industry (the walk enters the composing stage with ZERO roles)`;
			const record: RoleCompositionSession = {
				sessionId,
				industry,
				stage: 'composing',
				roles: [],
				history: [
					{ at, fromStage: null, toStage: 'composing', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail },
				],
			};
			const line: RolesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ROLES_CONTRACTS_VERSION,
				op: 'begin-session',
				sessionId,
				fromStage: null,
				toStage: 'composing',
				law: 'THE FORWARD-ONLY LAW',
				payload: industry,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async addRole(sessionId: unknown, role: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('addRole');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('addRole', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('addRole', session, 'composing');
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateRoleEntry(role);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('addRole', verdict) };
			}
			const entry = verdict.value;
			if (session.roles.some((existing) => existing.roleKey === entry.roleKey)) {
				return {
					ok: false,
					refusal: refused(
						'duplicate-role-key',
						'THE FAIL-CLOSED LAW',
						`addRole: the roleKey '${entry.roleKey}' is already composed (a named role appears once)`,
						[entry.roleKey],
					),
				};
			}
			if (session.roles.length >= MAX_ROLES) {
				return {
					ok: false,
					refusal: refused(
						'max-roles-exceeded',
						'THE FAIL-CLOSED LAW',
						`addRole: the composition already carries ${session.roles.length} roles - the composition bound is MAX_ROLES (${MAX_ROLES})`,
						[`${session.roles.length} roles`],
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `added the role '${entry.roleKey}' (a named role is CONFIGURATION - it grants NOTHING by itself)`;
			const record: RoleCompositionSession = {
				sessionId: session.sessionId,
				industry: session.industry,
				stage: 'composing',
				roles: [...session.roles, entry],
				history: [...session.history, { at, fromStage: 'composing', toStage: 'composing', op: 'add-role', law: 'THE NO-FORK LAW', detail }],
			};
			const line: RolesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ROLES_CONTRACTS_VERSION,
				op: 'add-role',
				sessionId: session.sessionId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE NO-FORK LAW',
				payload: entry,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async replaceRoleSummary(sessionId: unknown, roleKey: unknown, summary: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('replaceRoleSummary');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('replaceRoleSummary', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('replaceRoleSummary', session, 'composing');
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findRole(session, roleKey);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-role',
						'THE FAIL-CLOSED LAW',
						`replaceRoleSummary: no role with key '${showValue(roleKey)}' in the composition (a malformed key fails closed as unknown-role)`,
					),
				};
			}
			const verdict = validateRoleSummary(summary);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('replaceRoleSummary', verdict) };
			}
			const replacement: HarnessRole = { roleKey: existing.roleKey, summary: verdict.value };
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `replaced the summary of the role '${existing.roleKey}' (a role's key is its identity - immutable; only the summary is replaceable, THE REMOVE+RE-ADD LAW)`;
			const record: RoleCompositionSession = {
				sessionId: session.sessionId,
				industry: session.industry,
				stage: 'composing',
				roles: session.roles.map((role) => (role.roleKey === replacement.roleKey ? replacement : role)),
				history: [...session.history, { at, fromStage: 'composing', toStage: 'composing', op: 'replace-role-summary', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: RolesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ROLES_CONTRACTS_VERSION,
				op: 'replace-role-summary',
				sessionId: session.sessionId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: replacement,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async removeRole(sessionId: unknown, roleKey: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('removeRole');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('removeRole', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('removeRole', session, 'composing');
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const existing = findRole(session, roleKey);
			if (existing === null) {
				return {
					ok: false,
					refusal: refused(
						'unknown-role',
						'THE FAIL-CLOSED LAW',
						`removeRole: no role with key '${showValue(roleKey)}' in the composition (a malformed key fails closed as unknown-role)`,
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `removed the role '${existing.roleKey}' (THE REMOVE+RE-ADD LAW: a changed key is a NEW role; removing the last role is legal while composing - the empty-roles floor fires only at finalize)`;
			const record: RoleCompositionSession = {
				sessionId: session.sessionId,
				industry: session.industry,
				stage: 'composing',
				roles: session.roles.filter((role) => role.roleKey !== existing.roleKey),
				history: [...session.history, { at, fromStage: 'composing', toStage: 'composing', op: 'remove-role', law: 'THE REMOVE+RE-ADD LAW', detail }],
			};
			const line: RolesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ROLES_CONTRACTS_VERSION,
				op: 'remove-role',
				sessionId: session.sessionId,
				fromStage: 'composing',
				toStage: 'composing',
				law: 'THE REMOVE+RE-ADD LAW',
				payload: existing,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async finalizeComposition(sessionId: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('finalizeComposition');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('finalizeComposition', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('finalizeComposition', session, 'composing');
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			if (session.roles.length === 0) {
				return {
					ok: false,
					refusal: refused(
						'empty-roles',
						'THE FAIL-CLOSED LAW',
						'finalizeComposition: the composition must name at least one domain role (THE DH-01 FLOOR - compose roles with addRole first; the floor fires HERE, never the session shape)',
						['roles'],
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `finalized the composition (${session.roles.length} role(s); composing -> composed, TERMINAL - the composition is FROZEN)`;
			const record: RoleCompositionSession = {
				sessionId: session.sessionId,
				industry: session.industry,
				stage: 'composed',
				roles: [...session.roles],
				history: [...session.history, { at, fromStage: 'composing', toStage: 'composed', op: 'finalize-composition', law: 'THE FORWARD-ONLY LAW', detail }],
			};
			const line: RolesOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ROLES_CONTRACTS_VERSION,
				op: 'finalize-composition',
				sessionId: session.sessionId,
				fromStage: 'composing',
				toStage: 'composed',
				law: 'THE FORWARD-ONLY LAW',
				payload: null,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return { ok: false, refusal: persistResult.refusal };
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async emitReviewComposition(sessionId: unknown, refs?: unknown): Promise<RolesEmitOutcome> {
			const disposedRefusal = refuseIfDisposed('emitReviewComposition');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('emitReviewComposition', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('emitReviewComposition', session, 'composed');
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			// THE HONEST-GAP LAW: the caller's optional refs param defaults to the
			// empty record (all four families EMPTY - an empty family is the truth;
			// a fabricated id would be the fork; the owning waves are DH-004 /
			// DH-005 / DH-008).
			const refsRecord = refs === undefined ? {} : refs;
			const verdict = validateReviewCompositionEmit(session.roles, refsRecord);
			if (!verdict.ok) {
				return { ok: false, refusal: payloadRefused('emitReviewComposition', verdict) };
			}
			const composition = verdict.value;
			// THE IMPORT LAW's cross-check: the emitted composition MUST pass the
			// REAL DH-02 review-composition validator (a divergence is a bug in
			// this composition, fail closed - never emitted).
			const review = validateOnboardingReviewComposition(composition);
			if (!review.ok) {
				return {
					ok: false,
					refusal: refused(
						'malformed-record',
						'THE IMPORT LAW',
						'emitReviewComposition: the emitted composition failed the REAL DH-002 review-composition validator - a divergence is a bug in this composition, fail closed (never emitted)',
						undefined,
						{ reviewRefusal: review.refusal },
					),
				};
			}
			return { ok: true, composition };
		},
		async inspectSession(sessionId: unknown): Promise<RolesSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('inspectSession');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('inspectSession', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			return sessionOutcome(lookup.session);
		},
		async listSessions(filter?: unknown): Promise<RolesListOutcome> {
			const disposedRefusal = refuseIfDisposed('listSessions');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (filter !== undefined) {
				if (!isRecord(filter)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the filter must be an object (or absent)') };
				}
				const filterRecord = filter as Record<string, unknown>;
				const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry');
				if (unknownFields.length > 0) {
					return {
						ok: false,
						refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the filter carries an unknown field (stage / industry only)', unknownFields),
					};
				}
				if (filterRecord.stage !== undefined && !isRoleCompositionStage(filterRecord.stage)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the stage filter value is not a member of the frozen ROLE_COMPOSITION_STAGES list') };
				}
				if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
				}
			}
			const ids = [...sessions.keys()].sort();
			const records: RoleCompositionSession[] = [];
			for (const id of ids) {
				const entry = sessions.get(id) as RoleCompositionSession;
				if (filter !== undefined && !matchesSessionFilter(entry, filter as Record<string, unknown>)) {
					continue;
				}
				records.push(copySession(entry));
			}
			return { ok: true, sessions: records };
		},
		dispose(): void {
			disposed = true;
		},
	};
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface RolesLedgerReplay {
	readonly lines: readonly RolesOpsLedgerLine[];
	readonly sessions: Map<string, RoleCompositionSession>;
}

/** Parses and validates the whole roles ledger text; returns the typed refusal or the replay (never a silent skip). */
function replayRolesLedger(ledgerText: string | null): RolesLedgerReplay | RolesKitRefusal {
	if (ledgerText === null || ledgerText.length === 0) {
		return { lines: [], sessions: new Map<string, RoleCompositionSession>() };
	}
	if (!ledgerText.endsWith('\n')) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles ledger does not end with a complete line (a torn append - never a silent skip)');
	}
	const sessions = new Map<string, RoleCompositionSession>();
	const lines: RolesOpsLedgerLine[] = [];
	const rawLines = ledgerText.split('\n');
	rawLines.pop();
	for (let i = 0; i < rawLines.length; i += 1) {
		if (rawLines[i].length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${i + 1} is empty`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawLines[i]);
		} catch {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`);
		}
		const torn = validateRolesLedgerLine(parsed, i + 1, sessions);
		if (torn !== null) {
			return torn;
		}
		const record = parsed as Record<string, unknown>;
		const line: RolesOpsLedgerLine = {
			seq: record.seq as number,
			at: record.at as string,
			contractVersion: record.contractVersion as string,
			op: record.op as RoleCompositionOpName,
			sessionId: record.sessionId as string,
			fromStage: record.fromStage as RoleCompositionStage | null,
			toStage: record.toStage as RoleCompositionStage,
			law: record.law as string,
			payload: record.payload as RolesOpsLedgerLine['payload'],
			detail: record.detail as string,
		};
		applyRolesLine(sessions, line);
		lines.push(line);
	}
	return { lines, sessions };
}

/** Validates one parsed roles ledger line; returns the typed refusal or null (the line is structurally valid and legal). */
function validateRolesLedgerLine(parsed: unknown, lineNo: number, sessions: Map<string, RoleCompositionSession>): RolesKitRefusal | null {
	if (!isRecord(parsed)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is not a JSON object`);
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...ROLES_LEDGER_LINE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is structurally invalid (the frozen ten-key line schema)`);
	}
	if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`);
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`);
	}
	if (record.contractVersion !== ROLES_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadRolesKit: roles ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${ROLES_CONTRACTS_VERSION}' is known (the single-version law; the five-key session record carries no version field, so THIS is the law's live station)`);
	}
	if (!isRoleCompositionOpName(record.op)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`);
	}
	if (!isRoleCompositionSessionId(record.sessionId)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries a malformed session id`);
	}
	if (record.fromStage !== null && !isRoleCompositionStage(record.fromStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries an unknown fromStage`);
	}
	if (!isRoleCompositionStage(record.toStage)) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries an unknown toStage`);
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries no law name (the provenance law)`);
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries no provenance detail`);
	}
	const op = record.op as RoleCompositionOpName;
	const session = sessions.get(record.sessionId as string);
	if (op === 'begin-session') {
		if (record.fromStage !== null || record.toStage !== 'composing') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is a begin line that does not land 'composing' (every session enters the walk at composing)`);
		}
		if (!isHarnessIndustry(record.payload)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is a begin line without a frozen-HARNESS_INDUSTRIES industry payload`);
		}
		if (session !== undefined) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} begins a duplicate session id`);
		}
		return null;
	}
	if (session === undefined) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} advances an unknown session`);
	}
	if (session.stage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is out of order (the session is not at the composing stage; 'composed' is TERMINAL)`);
	}
	if (op === 'finalize-composition') {
		if (record.fromStage !== 'composing' || record.toStage !== 'composed') {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is a finalize line outside the composing->composed edge`);
		}
		if (record.payload !== null) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is a finalize line that carries a payload (the freeze advances the stage, no role payload)`);
		}
		if (session.roles.length === 0) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} finalizes an empty composition (THE DH-01 FLOOR - the replay re-validates the boundary law)`);
		}
		return null;
	}
	if (record.fromStage !== 'composing' || record.toStage !== 'composing') {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} is a role-op line outside the composing->composing self edge (the composition composes gradually)`);
	}
	const entry = validateRoleEntry(record.payload);
	if (!entry.ok) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} carries an invalid role payload`);
	}
	const payloadRole = entry.value;
	if (op === 'add-role') {
		if (session.roles.some((role) => role.roleKey === payloadRole.roleKey)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} adds a duplicate roleKey '${payloadRole.roleKey}'`);
		}
		if (session.roles.length >= MAX_ROLES) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} exceeds the MAX_ROLES (${MAX_ROLES}) composition bound`);
		}
		return null;
	}
	if (op === 'replace-role-summary') {
		if (!session.roles.some((role) => role.roleKey === payloadRole.roleKey)) {
			return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} replaces the summary of an unknown role '${payloadRole.roleKey}'`);
		}
		return null;
	}
	// remove-role: the payload must match the session's entry AS IT STOOD (the authoritative cross-check).
	const standing = session.roles.find((role) => role.roleKey === payloadRole.roleKey);
	if (standing === undefined || standing.summary !== payloadRole.summary) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: roles ledger line ${lineNo} removes a role entry that does not match the session's composition as it stood`);
	}
	return null;
}

/** Applies one validated roles ledger line to the replay sessions (pure fold). */
function applyRolesLine(sessions: Map<string, RoleCompositionSession>, line: RolesOpsLedgerLine): void {
	if (line.op === 'begin-session') {
		sessions.set(line.sessionId, {
			sessionId: line.sessionId,
			industry: line.payload as HarnessIndustry,
			stage: line.toStage,
			roles: [],
			history: [noteOf(line)],
		});
		return;
	}
	const session = sessions.get(line.sessionId);
	if (session === undefined) {
		return;
	}
	const base: RoleCompositionSession = {
		...session,
		stage: line.toStage,
		history: [...session.history, noteOf(line)],
	};
	let next: RoleCompositionSession;
	if (line.op === 'add-role') {
		next = { ...base, roles: [...session.roles, line.payload as HarnessRole] };
	} else if (line.op === 'replace-role-summary') {
		const replacement = line.payload as HarnessRole;
		next = { ...base, roles: session.roles.map((role) => (role.roleKey === replacement.roleKey ? replacement : role)) };
	} else if (line.op === 'remove-role') {
		const removed = line.payload as HarnessRole;
		next = { ...base, roles: session.roles.filter((role) => role.roleKey !== removed.roleKey) };
	} else {
		next = base;
	}
	sessions.set(line.sessionId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: RolesOpsLedgerLine): RoleCompositionTransitionNote {
	return {
		at: line.at,
		fromStage: line.fromStage,
		toStage: line.toStage,
		op: line.op,
		law: line.law,
		detail: line.detail,
	};
}

/** Cross-checks the roles envelope against the replay; returns the typed refusal or null. */
function crossCheckRolesEnvelope(
	envelopeText: string | null,
	lineCount: number,
	replayed: Map<string, RoleCompositionSession>,
): RolesKitRefusal | null {
	if (envelopeText === null) {
		if (lineCount === 0) {
			return null;
		}
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: the roles envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	let parsedEnvelope: unknown;
	try {
		parsedEnvelope = JSON.parse(envelopeText);
	} catch {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope is not valid JSON');
	}
	if (!isRecord(parsedEnvelope)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope is not a JSON object');
	}
	const envelope = parsedEnvelope as Record<string, unknown>;
	const keys = Object.keys(envelope).sort();
	const expected = [...ROLES_ENVELOPE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope is structurally invalid (the frozen three-key envelope schema)');
	}
	if (envelope.contractVersion !== ROLES_CONTRACTS_VERSION) {
		return refused('version-mismatch', 'THE SINGLE-VERSION LAW', `loadRolesKit: the roles envelope carries contract version ${showValue(envelope.contractVersion)} - only '${ROLES_CONTRACTS_VERSION}' is known (the single-version law)`);
	}
	if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope carries a malformed seq');
	}
	if (!Array.isArray(envelope.sessions)) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope carries a malformed sessions array');
	}
	const envelopeSeq = envelope.seq as number;
	if (envelopeSeq > lineCount) {
		return refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: the roles envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`);
	}
	if (envelopeSeq < lineCount) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: the roles envelope claims seq ${envelopeSeq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`);
	}
	const envelopeRecordMap = new Map<string, RoleCompositionSession>();
	for (let i = 0; i < envelope.sessions.length; i += 1) {
		const entry = envelope.sessions[i];
		if (!validateRoleCompositionSession(entry).ok) {
			return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', `loadRolesKit: the roles envelope's sessions[${i}] is not a valid role-composition session record`);
		}
		const sessionRecord = entry as RoleCompositionSession;
		envelopeRecordMap.set(sessionRecord.sessionId, sessionRecord);
	}
	const replayBytes = envelopeBytesOf(envelopeSeq, replayed);
	const envelopeBytes = envelopeBytesOf(envelopeSeq, envelopeRecordMap);
	if (replayBytes !== envelopeBytes) {
		return refused('E_ENVELOPE_MISMATCH', 'THE APPEND-ONLY LEDGER LAW', 'loadRolesKit: the roles envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)');
	}
	return null;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order bytes of one ledger line. */
function ledgerLineBytes(line: RolesOpsLedgerLine): string {
	return JSON.stringify({
		seq: line.seq,
		at: line.at,
		contractVersion: line.contractVersion,
		op: line.op,
		sessionId: line.sessionId,
		fromStage: line.fromStage,
		toStage: line.toStage,
		law: line.law,
		payload: line.payload === null ? null : typeof line.payload === 'string' ? line.payload : { roleKey: line.payload.roleKey, summary: line.payload.summary },
		detail: line.detail,
	});
}

/** Builds the canonical fixed-key-order bytes of the envelope (sessions sorted by sessionId). */
function envelopeBytes(seq: number, nextSessions: Map<string, RoleCompositionSession>): string {
	const ids = [...nextSessions.keys()].sort();
	const records = ids.map((id) => nextSessions.get(id) as RoleCompositionSession);
	return `{"contractVersion":${JSON.stringify(ROLES_CONTRACTS_VERSION)},"seq":${seq},"sessions":[${records
		.map((record) => serializeRoleCompositionSession(record))
		.join(',')}]}`;
}

/** The envelope-bytes builder for the load cross-check (byte-for-byte against the persisted envelope). */
function envelopeBytesOf(seq: number, sessions: Map<string, RoleCompositionSession>): string {
	return envelopeBytes(seq, sessions);
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

function matchesSessionFilter(record: RoleCompositionSession, filter: Record<string, unknown>): boolean {
	if (filter.stage !== undefined && record.stage !== filter.stage) {
		return false;
	}
	if (filter.industry !== undefined && record.industry !== filter.industry) {
		return false;
	}
	return true;
}
