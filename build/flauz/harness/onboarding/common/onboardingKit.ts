/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-002 onboarding kit: the deterministic staged-session runtime over
 * the onboarding contract vocabulary AND the REAL DH-001 DomainHarness
 * kit (constructed internally, never re-implemented - THE REAL-KIT
 * LAW). The kit walks a session begin -> industry -> company ->
 * work-types -> review -> proposed: beginSession mints the
 * flauz:onb:<16-hex> id from the injected rng; selectIndustry /
 * composeCompany / selectWorkTypes validate and advance the
 * forward-only stage machine; composeDraft shape-validates the
 * review composition, ASSEMBLES the DH-01 descriptor spec from the
 * session state, and mints it THROUGH the real kit (THE TWO-PHASE
 * LAW: dangling refs mint fine at draft; a refused mint is the typed
 * harness-kit-refused refusal carrying the DH-01 refusal verbatim,
 * the session unchanged); proposeSession advances the harness
 * draft->proposed through the real kit's NO-DANGLING-REF boundary
 * (on ok, the session's review->proposed advance - TERMINAL for the
 * onboarding walk; the post-proposal lifecycle is the DH-01 kit's).
 * The catalog stays the injected READ-ONLY snapshot seam, forwarded
 * to the real kit verbatim (the real-authority binding is the DH-007+
 * era; the DH-01 kit's own comment says so). Role/ontology invention
 * is DH-003's item: the review composition is supplied by the caller,
 * validated, never invented.
 *
 * Persistence (the PIN-2 sibling precedent, mirroring the DH-01 laws
 * EXACTLY): the same .flauz/harness subtree, distinct files - the
 * append-only ops ledger .flauz/harness/onboarding-ops.jsonl (one
 * canonical JSON line per applied op, the seq strictly increasing and
 * equal to the line number) and the envelope
 * .flauz/harness/onboarding-sessions.json ({ contractVersion, seq,
 * sessions }). The ledger is authoritative; loadOnboardingKit replays
 * it and cross-checks the envelope byte-for-byte (a torn or missing
 * line is the typed E_LEDGER_TORN; a divergent envelope is the typed
 * E_ENVELOPE_MISMATCH - never silently rebuilt). The inner real kit
 * persists its OWN harness ledger / envelope through the SAME injected
 * fsPort + root (the harness mint lands FIRST at composeDraft - the
 * real kit's authority; the onboarding line lands second; an orphan
 * draft after a torn onboarding append is honest history, never
 * data loss). loadOnboardingKit reopens the inner kit through the
 * real loadHarnessKit (a refused inner reopen is the typed
 * harness-kit-refused refusal carrying the DH-01 refusal verbatim).
 *
 * LAWS (inherited binding from the contract module's header; the
 * contract module carries their enforcement surface):
 * - THE REAL-KIT LAW: the mint and the draft->proposed advance are
 *   ALWAYS the DH-01 kit's own operations (createHarnessKit /
 *   loadHarnessKit imported and constructed with the SAME injected
 *   seams - clock, rng, catalog, fsPort, root - forwarded verbatim,
 *   never re-implemented, never bypassed).
 * - THE FORWARD-ONLY LAW: the stage machine never walks back;
 *   'proposed' is TERMINAL for the onboarding session; premature-op
 *   (the op precedes its precondition within the walk) and stale-stage
 *   (the op is behind the walk) are the typed stage refusals.
 * - THE TWO-PHASE LAW: composeDraft mints at draft with dangling refs
 *   allowed; proposeSession enforces resolution through the real
 *   kit's boundary against the injected catalog snapshot; a refused
 *   propose leaves the session unchanged (re-compose at review to
 *   fix the composition - each re-composition mints a NEW harness id,
 *   the registry lineage law).
 * - THE NO-FORK LAW: the composition walk rejects execution material
 *   BEFORE the real kit is ever consulted; the assembled spec carries
 *   references only.
 * - THE DETERMINISM LAW: no Math.random, no Date.now, no new Date(...)
 *   and no process.env in this module (law comments excepted) - the
 *   clock, the rng, the catalog and the fsPort are INJECTED seams;
 *   the persisted bytes are canonical fixed-key-order JSON; restart
 *   determinism is pinned by the battery.
 * - THE FAIL-CLOSED LAW: factory misuse throws TypeError (every
 *   factory precondition checked with the exact DH-01 message shape);
 *   every domain refusal is a typed record { reason, law, message,
 *   items? } naming the violated law and the offending items; no
 *   silent partial effects (a refused op leaves the session
 *   unchanged).
 * - THE SINGLE-VERSION LAW: ONBOARDING_CONTRACTS_VERSION is declared
 *   ONCE in the contract module, re-carried by this kit (the
 *   re-export); the battery pins both copies equal.
 * - THE APPEND-ONLY LEDGER LAW: as the persistence paragraph above.
 * - THE DISPOSE LAW: every operation after dispose rejects with the
 *   typed disposed refusal (the inner real kit is disposed with it).
 */

import {
	createHarnessKit,
	loadHarnessKit,
} from '../../contract/common/domainHarnessKit.js';
import type {
	HarnessFsPort,
	HarnessKit,
	HarnessKitRefusal,
} from '../../contract/common/domainHarnessKit.js';
import type { HarnessCatalogSnapshot } from '../../contract/common/domainHarnessContract.js';
import { isHarnessCatalogSnapshot, isHarnessId } from '../../contract/common/domainHarnessContract.js';
import {
	ONBOARDING_CONTRACTS_VERSION,
	ONBOARDING_SESSION_ID_PREFIX,
	ONBOARDING_STAGES,
	ONBOARDING_VALIDATION_REJECTION_REASONS,
	isHarnessIndustry,
	isHarnessWorkType,
	isOnboardingOpName,
	isOnboardingSessionId,
	isOnboardingStage,
	serializeOnboardingSession,
	validateOnboardingCompanyProfile,
	validateOnboardingIndustryPayload,
	validateOnboardingReviewComposition,
	validateOnboardingSessionRecord,
	validateOnboardingWorkTypes,
} from './onboardingContract.js';
import type {
	HarnessIndustry,
	HarnessWorkType,
	OnboardingCompanyProfile,
	OnboardingIndustryPayload,
	OnboardingOpName,
	OnboardingPayloadOutcome,
	OnboardingReviewComposition,
	OnboardingSessionRecord,
	OnboardingStage,
	OnboardingTransitionNote,
} from './onboardingContract.js';

/** THE SINGLE-VERSION LAW: the kit re-carries the contract's version (declared ONCE there). */
export { ONBOARDING_CONTRACTS_VERSION } from './onboardingContract.js';

/**
 * The injected fs port is the DH-01 kit's OWN port type (the ONLY
 * filesystem seam - the PIN-2 sibling precedent; re-exported by
 * reference, never re-declared). The shipped kit never touches a
 * global fs, never reads the env; the caller wires the real driver.
 */
export type { HarnessFsPort } from '../../contract/common/domainHarnessKit.js';

/** The injected READ-ONLY catalog snapshot is the DH-01 contract's own type (re-exported by reference). */
export type { HarnessCatalogSnapshot } from '../../contract/common/domainHarnessContract.js';

/** The verbatim DH-01 refusal carrier (re-exported by reference for the harness-kit-refused surface). */
export type { HarnessKitRefusal } from '../../contract/common/domainHarnessKit.js';

/** The envelope path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const ONBOARDING_ENVELOPE_RELATIVE_PATH = '.flauz/harness/onboarding-sessions.json';

/** The append-only ops ledger path (relative to the injected root; the same .flauz/harness subtree as DH-01, distinct file). */
export const ONBOARDING_LEDGER_RELATIVE_PATH = '.flauz/harness/onboarding-ops.jsonl';

/** The frozen ledger-line schema keys, in the canonical fixed-key-order. */
export const ONBOARDING_LEDGER_LINE_SCHEMA_KEYS = [
	'seq',
	'at',
	'contractVersion',
	'op',
	'sessionId',
	'fromStage',
	'toStage',
	'law',
	'payload',
	'harnessId',
	'detail',
] as const;

/** The frozen envelope schema keys, in the canonical fixed-key-order. */
export const ONBOARDING_ENVELOPE_SCHEMA_KEYS = ['contractVersion', 'seq', 'sessions'] as const;

/**
 * One append-only onboarding ops ledger line (the canonical persisted
 * op): the seq (equal to the line number), the clock reading, the
 * contract version, the op name, the session id, the stage edge
 * walked (fromStage null ONLY on the begin line; compose-draft is the
 * review->review self edge - the draft composes gradually), the
 * granting law, the canonical stage payload (null on begin / propose),
 * the minted harness link (compose-draft / propose-session lines
 * only), and the deterministic detail sentence.
 */
export interface OnboardingOpsLedgerLine {
	readonly seq: number;
	readonly at: string;
	readonly contractVersion: string;
	readonly op: OnboardingOpName;
	readonly sessionId: string;
	readonly fromStage: OnboardingStage | null;
	readonly toStage: OnboardingStage;
	readonly law: string;
	readonly payload: OnboardingIndustryPayload | OnboardingCompanyProfile | readonly HarnessWorkType[] | OnboardingReviewComposition | null;
	readonly harnessId: string | null;
	readonly detail: string;
}

/**
 * The kit-layer refusal extras (the frozen list beyond the contract's
 * ONBOARDING_VALIDATION_REJECTION_REASONS):
 *   E_LEDGER_TORN        - THE APPEND-ONLY LEDGER LAW: a torn or
 *                          missing onboarding ledger line, a
 *                          structurally invalid or out-of-order line,
 *                          an unknown op or contract version, an
 *                          illegal stage edge inside the ledger, or a
 *                          fresh kit attempting to append over an
 *                          existing non-empty onboarding ledger
 *                          (reopen with loadOnboardingKit);
 *   E_ENVELOPE_MISMATCH  - THE APPEND-ONLY LEDGER LAW: the onboarding
 *                          envelope diverges from the ledger replay
 *                          (or is missing / malformed while the ledger
 *                          carries lines) - never silently rebuilt;
 *   ONBOARDING_IO        - THE FAIL-CLOSED LAW: the injected fs port
 *                          refused a read / append / write / mkdir on
 *                          the onboarding family's own files;
 *   CORRUPT_SEAM         - THE DETERMINISM LAW: the injected clock or
 *                          rng returned a malformed value mid-op (an
 *                          empty clock reading, a non-16-hex rng
 *                          output, a duplicate minted session id);
 *   UNKNOWN_FILTER       - THE FAIL-CLOSED LAW: listSessions received
 *                          an unknown filter field or a non-member
 *                          filter value.
 */
export const ONBOARDING_KIT_EXTRA_REFUSAL_REASONS = [
	'E_LEDGER_TORN',
	'E_ENVELOPE_MISMATCH',
	'ONBOARDING_IO',
	'CORRUPT_SEAM',
	'UNKNOWN_FILTER',
] as const;

/** The frozen kit refusal vocabulary: the contract's 22 domain reasons plus the kit-layer extras. */
export const ONBOARDING_KIT_REFUSAL_REASONS = [
	...ONBOARDING_VALIDATION_REJECTION_REASONS,
	...ONBOARDING_KIT_EXTRA_REFUSAL_REASONS,
] as const;
export type OnboardingKitRefusalReason = (typeof ONBOARDING_KIT_REFUSAL_REASONS)[number];

/** Pure predicate over the closed kit-refusal list. */
export function isOnboardingKitRefusalReason(value: unknown): value is OnboardingKitRefusalReason {
	return (ONBOARDING_KIT_REFUSAL_REASONS as readonly string[]).includes(value as string);
}

/**
 * The typed kit refusal: the frozen reason, the violated law's name,
 * the deterministic message, the optional offending items, and (for
 * harness-kit-refused) the verbatim DH-01 refusal the real kit
 * returned - carried complete, never paraphrased.
 */
export interface OnboardingKitRefusal {
	readonly reason: OnboardingKitRefusalReason;
	readonly law: string;
	readonly message: string;
	readonly items?: readonly string[];
	/** harness-kit-refused carries the complete DH-01 kit refusal verbatim (mint, advance or reopen). */
	readonly harnessRefusal?: HarnessKitRefusal;
}

/** The kit construction options (all injected, never env-read; fsPort and root come together or not at all). */
export interface OnboardingKitOptions {
	/** The injected clock (returns the ISO string; forwarded to the real DH-01 kit verbatim). */
	readonly clock: () => string;
	/** The session-id-minting seam (returns 16 lowercase hex chars; NEVER the random global; forwarded to the real kit). */
	readonly rng: () => string;
	/** The injected READ-ONLY catalog snapshot (forwarded to the real DH-01 kit; tests inject fixtures). */
	readonly catalog: HarnessCatalogSnapshot;
	/** The OPTIONAL filesystem seam (persistence when paired with root; shared with the inner real kit). */
	readonly fsPort?: HarnessFsPort;
	/** The OPTIONAL persistence root (the .flauz/harness subtree lands under it). */
	readonly root?: string;
}

/** The staged-session op outcome: ok carries the honest session record; failure carries the typed refusal. */
export type OnboardingSessionOutcome =
	| { readonly ok: true; readonly session: OnboardingSessionRecord }
	| { readonly ok: false; readonly refusal: OnboardingKitRefusal };

/** The list outcome: ok carries the sessionId-ordered honest records; failure carries the typed refusal. */
export type OnboardingListOutcome =
	| { readonly ok: true; readonly sessions: readonly OnboardingSessionRecord[] }
	| { readonly ok: false; readonly refusal: OnboardingKitRefusal };

/** The load outcome: ok carries the reopened kit; failure carries the typed refusal. */
export type OnboardingLoadOutcome =
	| { readonly ok: true; readonly kit: OnboardingKit }
	| { readonly ok: false; readonly refusal: OnboardingKitRefusal };

/**
 * The deterministic onboarding kit: every operation is async with a
 * typed outcome ({ ok: true, ... } | { ok: false, refusal }); the
 * mint and the propose delegate to the REAL DH-01 kit constructed
 * internally with the same injected seams.
 */
export interface OnboardingKit {
	beginSession(): Promise<OnboardingSessionOutcome>;
	selectIndustry(sessionId: unknown, industry: unknown): Promise<OnboardingSessionOutcome>;
	composeCompany(sessionId: unknown, profile: unknown): Promise<OnboardingSessionOutcome>;
	selectWorkTypes(sessionId: unknown, workTypes: unknown): Promise<OnboardingSessionOutcome>;
	composeDraft(sessionId: unknown, reviewComposition: unknown): Promise<OnboardingSessionOutcome>;
	proposeSession(sessionId: unknown): Promise<OnboardingSessionOutcome>;
	inspectSession(sessionId: unknown): Promise<OnboardingSessionOutcome>;
	listSessions(filter?: unknown): Promise<OnboardingListOutcome>;
	dispose(): void;
}

/**
 * Creates an onboarding kit (fail-closed factory). Validation order is
 * deterministic and mirrors the DH-01 factory EXACTLY (the same
 * preconditions, the same message shapes, the createOnboardingKit
 * prefix): the options shape (clock / rng / catalog), the clock's
 * first read (a non-empty ISO string), the rng's first read (exactly
 * 16 lowercase hex chars - the id-minting law), the catalog snapshot
 * guard, and the fsPort/root pairing (both or neither; the port must
 * expose readFile / writeFile / appendFile / mkdir). THE REAL-KIT LAW:
 * the factory then CONSTRUCTS the real DH-01 kit internally with the
 * same seams forwarded (the inner construction re-reads the clock and
 * rng seams once - the battery pins the doubled factory reads). The
 * kit starts with ZERO sessions; persistence is LAZY (the
 * .flauz/harness subtree lands with the first applied op; a fresh kit
 * never appends over an existing non-empty onboarding ledger - reopen
 * with loadOnboardingKit).
 */
export function createOnboardingKit(options: OnboardingKitOptions): OnboardingKit {
	const bound = validateKitOptions(options, false, 'createOnboardingKit');
	const inner = createHarnessKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort ?? undefined, root: bound.root ?? undefined });
	return buildOnboardingKit(bound, inner, { seq: 0, sessions: new Map<string, OnboardingSessionRecord>() });
}

/**
 * Reopens a persisted onboarding kit: replays the append-only
 * onboarding ops ledger (the authoritative surface), cross-checks the
 * envelope byte-for-byte against the replay-built state, and reopens
 * the INNER REAL KIT through the DH-01 loadHarnessKit (a refused inner
 * reopen is the typed harness-kit-refused refusal carrying the DH-01
 * refusal verbatim). A torn or missing onboarding ledger line is the
 * typed E_LEDGER_TORN; a divergent, missing or malformed envelope is
 * the typed E_ENVELOPE_MISMATCH (never silently rebuilt); a refused fs
 * port is the typed ONBOARDING_IO. A fresh root (no files) reopens as
 * an empty kit. The options require BOTH fsPort and root (the load is
 * a persistence-surface operation).
 */
export async function loadOnboardingKit(options: OnboardingKitOptions): Promise<OnboardingLoadOutcome> {
	const bound = validateKitOptions(options, true, 'loadOnboardingKit');
	const fsPort = bound.fsPort as HarnessFsPort;
	const ledgerPath = `${bound.root}/${ONBOARDING_LEDGER_RELATIVE_PATH}`;
	const envelopePath = `${bound.root}/${ONBOARDING_ENVELOPE_RELATIVE_PATH}`;
	try {
		await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
	} catch (error) {
		return { ok: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `loadOnboardingKit: the fs port refused the root mkdir: ${toMessage(error)}`) };
	}
	let ledgerText: string | null;
	try {
		ledgerText = await readText(fsPort, ledgerPath);
	} catch (error) {
		return { ok: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `loadOnboardingKit: the fs port refused the onboarding ledger read: ${toMessage(error)}`) };
	}
	let envelopeText: string | null;
	try {
		envelopeText = await readText(fsPort, envelopePath);
	} catch (error) {
		return { ok: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `loadOnboardingKit: the fs port refused the onboarding envelope read: ${toMessage(error)}`) };
	}
	const replay = replayOnboardingLedger(ledgerText);
	if (typeof replay === 'string') {
		return { ok: false, refusal: refused('E_LEDGER_TORN', 'THE APPEND-ONLY LEDGER LAW', replay) };
	}
	const crossCheck = crossCheckOnboardingEnvelope(envelopeText, replay.lines.length, replay.sessions);
	if (crossCheck !== null) {
		return { ok: false, refusal: refused(crossCheck.reason, 'THE APPEND-ONLY LEDGER LAW', crossCheck.message) };
	}
	const innerLoad = await loadHarnessKit({ clock: bound.clock, rng: bound.rng, catalog: bound.catalog, fsPort: bound.fsPort ?? undefined, root: bound.root ?? undefined });
	if (!innerLoad.ok) {
		return {
			ok: false,
			refusal: refused(
				'harness-kit-refused',
				'THE REAL-KIT LAW',
				'loadOnboardingKit: the real DH-001 kit refused to reopen over the persisted harness ledger - the refusal is carried verbatim (the onboarding family never re-implements the harness load)',
				undefined,
				{ harnessRefusal: innerLoad.refusal },
			),
		};
	}
	return { ok: true, kit: buildOnboardingKit(bound, innerLoad.kit, { seq: replay.lines.length, sessions: replay.sessions }) };
}

// --- the kit internals ---

interface BoundOptions {
	readonly clock: () => string;
	readonly rng: () => string;
	readonly catalog: HarnessCatalogSnapshot;
	readonly fsPort: HarnessFsPort | null;
	readonly root: string | null;
}

interface OnboardingKitState {
	readonly seq: number;
	readonly sessions: ReadonlyMap<string, OnboardingSessionRecord>;
}

/** The persist fold's result: applied means the onboarding ledger line landed (the ledger is authoritative). */
type PersistResult =
	| { readonly applied: false; readonly refusal: OnboardingKitRefusal }
	| { readonly applied: true; readonly refusal: OnboardingKitRefusal | null };

/** The clock read's result: the injected seam's value or the typed corrupt-seam refusal. */
type ClockRead = { readonly at: string } | { readonly refusal: OnboardingKitRefusal };

function validateKitOptions(options: OnboardingKitOptions, requirePersistence: boolean, factoryName: 'createOnboardingKit' | 'loadOnboardingKit'): BoundOptions {
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
	if (!isHarnessCatalogSnapshot(opts.catalog)) {
		throw new TypeError(
			`${factoryName}: options.catalog must satisfy isHarnessCatalogSnapshot (the injected READ-ONLY resolution surface - the real-authority binding is the DH-007+ era)`,
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
			`${factoryName}: options.rng() must return exactly 16 lowercase hex chars (the id-minting seam - the kit mints ${ONBOARDING_SESSION_ID_PREFIX}<16-hex>)`,
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
	return { clock, rng, catalog: opts.catalog as HarnessCatalogSnapshot, fsPort, root };
}

function refused(
	reason: OnboardingKitRefusalReason,
	law: string,
	message: string,
	items?: readonly string[],
	extra?: Omit<OnboardingKitRefusal, 'reason' | 'law' | 'message' | 'items'>,
): OnboardingKitRefusal {
	if (items === undefined) {
		return { reason, law, message, ...extra };
	}
	return { reason, law, message, items, ...extra };
}

function buildOnboardingKit(bound: BoundOptions, inner: HarnessKit, seed: OnboardingKitState): OnboardingKit {
	let disposed = false;
	let mutableSeq = seed.seq;
	const sessions = new Map<string, OnboardingSessionRecord>(seed.sessions);
	const persisted = bound.fsPort !== null && bound.root !== null;
	const fsPort = bound.fsPort;
	const ledgerPath = bound.root !== null ? `${bound.root}/${ONBOARDING_LEDGER_RELATIVE_PATH}` : '';
	const envelopePath = bound.root !== null ? `${bound.root}/${ONBOARDING_ENVELOPE_RELATIVE_PATH}` : '';
	let dirEnsured = false;
	// A kit reloaded from a persisted ledger NEVER re-fires the fresh-kit guard
	// (its ledger preexists; only a fresh createOnboardingKit guards the append).
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

	function copySession(record: OnboardingSessionRecord): OnboardingSessionRecord {
		return JSON.parse(serializeOnboardingSession(record)) as OnboardingSessionRecord;
	}

	function envelopeBytes(nextSeq: number, nextSessions: Map<string, OnboardingSessionRecord>): string {
		const ids = [...nextSessions.keys()].sort();
		const records = ids.map((id) => nextSessions.get(id) as OnboardingSessionRecord);
		return `{"contractVersion":${JSON.stringify(ONBOARDING_CONTRACTS_VERSION)},"seq":${nextSeq},"sessions":[${records
			.map((record) => serializeOnboardingSession(record))
			.join(',')}]}`;
	}

	function ledgerLineBytes(line: OnboardingOpsLedgerLine): string {
		return JSON.stringify({
			seq: line.seq,
			at: line.at,
			contractVersion: line.contractVersion,
			op: line.op,
			sessionId: line.sessionId,
			fromStage: line.fromStage,
			toStage: line.toStage,
			law: line.law,
			payload: canonicalPayloadObject(line.payload),
			harnessId: line.harnessId,
			detail: line.detail,
		});
	}

	/**
 	* THE APPEND-ONLY LEDGER LAW's persistence fold: the append lands
 	* first (the ledger is authoritative - the seq advances with the
 	* line), the envelope rewrite lands second, the in-memory sessions
 	* commit last (in the caller). An append refusal leaves NOTHING
 	* applied (the real kit's already-landed mint, if any, is disclosed
 	* in the refusal - an orphan draft in the harness ledger is honest
 	* history, never data loss); an envelope refusal leaves the op
 	* applied and the line landed (the refusal discloses it; a reload
 	* fails closed with E_ENVELOPE_MISMATCH until the next op rewrites
 	* the envelope).
 	*/
	async function persist(line: OnboardingOpsLedgerLine, nextSessions: Map<string, OnboardingSessionRecord>): Promise<PersistResult> {
		if (!persisted || fsPort === null) {
			mutableSeq = line.seq;
			return { applied: true, refusal: null };
		}
		if (!ledgerGuardDone) {
			let existing: string | null;
			try {
				existing = await readText(fsPort, ledgerPath);
			} catch (error) {
				return { applied: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the onboarding ledger read: ${toMessage(error)}`) };
			}
			if (existing !== null && existing.trim().length > 0) {
				return {
					applied: false,
					refusal: refused(
						'E_LEDGER_TORN',
						'THE APPEND-ONLY LEDGER LAW',
						'persist: the onboarding ledger already carries lines - reopen with loadOnboardingKit (a fresh kit never appends over an existing ledger)',
					),
				};
			}
			ledgerGuardDone = true;
		}
		if (!dirEnsured) {
			try {
				await fsPort.mkdir(`${bound.root}/.flauz/harness`, { recursive: true });
			} catch (error) {
				return { applied: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the root mkdir: ${toMessage(error)}`) };
			}
			dirEnsured = true;
		}
		try {
			await fsPort.appendFile(ledgerPath, `${ledgerLineBytes(line)}\n`);
		} catch (error) {
			return { applied: false, refusal: refused('ONBOARDING_IO', 'THE FAIL-CLOSED LAW', `persist: the fs port refused the onboarding ledger append: ${toMessage(error)} (nothing was applied)`) };
		}
		mutableSeq = line.seq;
		try {
			await fsPort.writeFile(envelopePath, envelopeBytes(line.seq, nextSessions));
		} catch (error) {
			return {
				applied: true,
				refusal: refused(
					'ONBOARDING_IO',
					'THE FAIL-CLOSED LAW',
					`persist: the onboarding ledger line landed at seq ${line.seq} but the fs port refused the envelope rewrite: ${toMessage(error)} (the op applied and the ledger is authoritative; a reload fails closed with E_ENVELOPE_MISMATCH until the envelope is rewritten)`,
				),
			};
		}
		return { applied: true, refusal: null };
	}

	function commit(nextSessions: Map<string, OnboardingSessionRecord>): void {
		sessions.clear();
		for (const [id, record] of nextSessions) {
			sessions.set(id, record);
		}
	}

	function sessionOutcome(record: OnboardingSessionRecord): OnboardingSessionOutcome {
		return { ok: true, session: copySession(record) };
	}

	/** The disposed guard (THE DISPOSE LAW - the op-entry first station). */
	function refuseIfDisposed(opName: string): OnboardingKitRefusal | null {
		if (disposed) {
			return refused('disposed', 'THE DISPOSE LAW', `${opName}: the kit was disposed - every operation after dispose rejects`);
		}
		return null;
	}

	/** The unknown-session guard (a malformed id fails closed as unknown - the DH-01 NOT_FOUND discipline, this family's reason). */
	function lookupSession(opName: string, sessionId: unknown): { session: OnboardingSessionRecord } | { refusal: OnboardingKitRefusal } {
		if (!isOnboardingSessionId(sessionId)) {
			return { refusal: refused('unknown-session', 'THE FAIL-CLOSED LAW', `${opName}: no session with id '${showValue(sessionId)}' (a malformed id fails closed as unknown-session)`) };
		}
		const session = sessions.get(sessionId);
		if (session === undefined) {
			return { refusal: refused('unknown-session', 'THE FAIL-CLOSED LAW', `${opName}: no session with id '${sessionId}'`) };
		}
		return { session };
	}

	/**
 	* THE FORWARD-ONLY LAW's stage guard: the op requires the session
 	* to sit at its stage (premature-op when the walk is behind,
 	* stale-stage when the walk is past it; proposeSession additionally
 	* refuses premature until composeDraft has minted the harness link).
 	*/
	function stageGuard(opName: string, session: OnboardingSessionRecord, requiredStage: OnboardingStage, requiresHarness: boolean): OnboardingKitRefusal | null {
		if (session.stage === requiredStage) {
			if (requiresHarness && session.harnessId === null) {
				return refused('premature-op', 'THE FORWARD-ONLY LAW', `${opName}: the session is at the 'review' stage but carries no composed draft - ${opName} is premature (composeDraft must mint through the real kit first)`, [session.stage]);
			}
			return null;
		}
		const requiredIndex = (ONBOARDING_STAGES as readonly string[]).indexOf(requiredStage);
		const currentIndex = (ONBOARDING_STAGES as readonly string[]).indexOf(session.stage);
		if (currentIndex < requiredIndex) {
			return refused('premature-op', 'THE FORWARD-ONLY LAW', `${opName}: the session is at the '${session.stage}' stage - the op requires the '${requiredStage}' stage (call the walk in order; the stage machine never walks back)`, [session.stage]);
		}
		return refused('stale-stage', 'THE FORWARD-ONLY LAW', `${opName}: the session is at the '${session.stage}' stage - the '${requiredStage}' stage is behind the walk${session.stage === 'proposed' ? " ('proposed' is TERMINAL for the onboarding session; a changed session is a NEW session)" : ''} (THE FORWARD-ONLY LAW)`, [session.stage]);
	}

	/** Surfaces the payload walk's typed outcome (the contract's refusal IS the kit refusal - verbatim). */
	function payloadRefused<P>(outcome: OnboardingPayloadOutcome<P>): boolean {
		return !outcome.ok;
	}

	/** The session's invariant fields for the spec assembly (guaranteed non-null at the review stage by the stage machine). */
	function reviewStageInputs(session: OnboardingSessionRecord): { industry: HarnessIndustry; workTypes: readonly HarnessWorkType[]; displayName: string } | null {
		if (session.industry === null || session.workTypes === null || session.companyProfile === null) {
			return null;
		}
		return { industry: session.industry, workTypes: session.workTypes, displayName: session.companyProfile.displayName };
	}

	return {
		async beginSession(): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('beginSession');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const hex = bound.rng();
			if (!/^[0-9a-f]{16}$/.test(hex)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginSession: the injected rng returned a non-16-hex value (the id-minting seam is corrupt)') };
			}
			const sessionId = `${ONBOARDING_SESSION_ID_PREFIX}${hex}`;
			if (sessions.has(sessionId)) {
				return { ok: false, refusal: refused('CORRUPT_SEAM', 'THE DETERMINISM LAW', 'beginSession: the injected rng minted a duplicate session id (the id-minting seam is corrupt)') };
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = 'began the onboarding session (the walk enters the industry stage)';
			const record: OnboardingSessionRecord = {
				sessionId,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				stage: 'industry',
				industry: null,
				companyProfile: null,
				workTypes: null,
				reviewComposition: null,
				harnessId: null,
				createdAtIso: at,
				revision: 1,
				history: [
					{ at, fromStage: null, toStage: 'industry', op: 'begin-session', law: 'THE FORWARD-ONLY LAW', detail },
				],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'begin-session',
				sessionId,
				fromStage: null,
				toStage: 'industry',
				law: 'THE FORWARD-ONLY LAW',
				payload: null,
				harnessId: null,
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
		async selectIndustry(sessionId: unknown, industry: unknown): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('selectIndustry');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('selectIndustry', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('selectIndustry', session, 'industry', false);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateOnboardingIndustryPayload({ industry });
			if (payloadRefused(verdict)) {
				return { ok: false, refusal: (verdict as { ok: false; refusal: OnboardingKitRefusal }).refusal };
			}
			const selected = (verdict as { ok: true; value: OnboardingIndustryPayload }).value;
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `selected the '${selected.industry}' industry (the frozen HARNESS_INDUSTRIES list, imported by reference from the DH-01 contract)`;
			const record: OnboardingSessionRecord = {
				...session,
				stage: 'company',
				industry: selected.industry,
				revision: session.revision + 1,
				history: [...session.history, { at, fromStage: 'industry', toStage: 'company', op: 'select-industry', law: 'THE FORWARD-ONLY LAW', detail }],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'select-industry',
				sessionId: session.sessionId,
				fromStage: 'industry',
				toStage: 'company',
				law: 'THE FORWARD-ONLY LAW',
				payload: selected,
				harnessId: null,
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
		async composeCompany(sessionId: unknown, profile: unknown): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('composeCompany');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('composeCompany', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('composeCompany', session, 'company', false);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateOnboardingCompanyProfile(profile);
			if (payloadRefused(verdict)) {
				return { ok: false, refusal: (verdict as { ok: false; refusal: OnboardingKitRefusal }).refusal };
			}
			const composed = (verdict as { ok: true; value: OnboardingCompanyProfile }).value;
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `composed the company profile (displayName carried verbatim; size band '${composed.sizeBand}')`;
			const record: OnboardingSessionRecord = {
				...session,
				stage: 'work-types',
				companyProfile: composed,
				revision: session.revision + 1,
				history: [...session.history, { at, fromStage: 'company', toStage: 'work-types', op: 'compose-company', law: 'THE FORWARD-ONLY LAW', detail }],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'compose-company',
				sessionId: session.sessionId,
				fromStage: 'company',
				toStage: 'work-types',
				law: 'THE FORWARD-ONLY LAW',
				payload: composed,
				harnessId: null,
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
		async selectWorkTypes(sessionId: unknown, workTypes: unknown): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('selectWorkTypes');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('selectWorkTypes', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('selectWorkTypes', session, 'work-types', false);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateOnboardingWorkTypes(workTypes);
			if (payloadRefused(verdict)) {
				return { ok: false, refusal: (verdict as { ok: false; refusal: OnboardingKitRefusal }).refusal };
			}
			const selected = (verdict as { ok: true; value: readonly HarnessWorkType[] }).value;
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `selected the work-type subset (${selected.length} of the frozen 10, the list order preserved)`;
			const record: OnboardingSessionRecord = {
				...session,
				stage: 'review',
				workTypes: selected,
				revision: session.revision + 1,
				history: [...session.history, { at, fromStage: 'work-types', toStage: 'review', op: 'select-work-types', law: 'THE FORWARD-ONLY LAW', detail }],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'select-work-types',
				sessionId: session.sessionId,
				fromStage: 'work-types',
				toStage: 'review',
				law: 'THE FORWARD-ONLY LAW',
				payload: selected,
				harnessId: null,
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
		async composeDraft(sessionId: unknown, reviewComposition: unknown): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('composeDraft');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('composeDraft', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('composeDraft', session, 'review', false);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const verdict = validateOnboardingReviewComposition(reviewComposition);
			if (payloadRefused(verdict)) {
				return { ok: false, refusal: (verdict as { ok: false; refusal: OnboardingKitRefusal }).refusal };
			}
			const composition = (verdict as { ok: true; value: OnboardingReviewComposition }).value;
			const inputs = reviewStageInputs(session);
			if (inputs === null) {
				return { ok: false, refusal: refused('malformed-record', 'THE FAIL-CLOSED LAW', 'composeDraft: the session record is internally inconsistent (the review-stage invariant was violated - unreachable through the stage machine; the ledger replay is the cross-check)') };
			}
			// THE REAL-KIT LAW + THE NO-FORK LAW: the assembled spec is references
			// only; the harnessId and the contractVersion are the DH-01 kit's OWN
			// minted keys (a caller-supplied copy of either is refused by the real
			// kit's own boundary).
			const spec = {
				industry: inputs.industry,
				workTypes: [...inputs.workTypes],
				displayName: inputs.displayName,
				roles: composition.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
				capabilityRefs: [...composition.capabilityRefs],
				workflowRefs: [...composition.workflowRefs],
				policyRefs: [...composition.policyRefs],
				evidenceRefs: [...composition.evidenceRefs],
			};
			const mint = await inner.mintHarness(spec);
			if (!mint.ok) {
				return {
					ok: false,
					refusal: refused(
						'harness-kit-refused',
						'THE REAL-KIT LAW',
						'composeDraft: the real DH-001 kit refused the mint - the refusal is carried verbatim (the onboarding family never re-implements the mint); the session is unchanged',
						undefined,
						{ harnessRefusal: mint.refusal },
					),
				};
			}
			const harnessId = mint.record.harnessId;
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `composed the harness draft through the real DH-001 kit (minted ${harnessId} at draft; dangling refs allowed at draft per THE TWO-PHASE LAW)`;
			const record: OnboardingSessionRecord = {
				...session,
				stage: 'review',
				reviewComposition: composition,
				harnessId,
				revision: session.revision + 1,
				history: [...session.history, { at, fromStage: 'review', toStage: 'review', op: 'compose-draft', law: 'THE REAL-KIT LAW', detail }],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'compose-draft',
				sessionId: session.sessionId,
				fromStage: 'review',
				toStage: 'review',
				law: 'THE REAL-KIT LAW',
				payload: composition,
				harnessId,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return {
					ok: false,
					refusal: refused(
						persistResult.refusal.reason,
						persistResult.refusal.law,
						`${persistResult.refusal.message} (the real kit's mint landed: harness ${harnessId} sits at draft in the harness ledger - the DH-01 authority; the session is unchanged and the orphan draft is honest history; re-run composeDraft to re-mint)`,
						persistResult.refusal.items,
					),
				};
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async proposeSession(sessionId: unknown): Promise<OnboardingSessionOutcome> {
			const disposedRefusal = refuseIfDisposed('proposeSession');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			const lookup = lookupSession('proposeSession', sessionId);
			if ('refusal' in lookup) {
				return { ok: false, refusal: lookup.refusal };
			}
			const session = lookup.session;
			const stageRefusal = stageGuard('proposeSession', session, 'review', true);
			if (stageRefusal !== null) {
				return { ok: false, refusal: stageRefusal };
			}
			const harnessId = session.harnessId as string;
			// THE REAL-KIT LAW + THE TWO-PHASE LAW: the propose is the real kit's
			// own draft->proposed boundary (the NO-DANGLING-REF check fires THERE
			// against the injected catalog snapshot).
			const advance = await inner.advanceHarness(harnessId, 'proposed');
			if (!advance.ok) {
				return {
					ok: false,
					refusal: refused(
						'harness-kit-refused',
						'THE REAL-KIT LAW',
						'proposeSession: the real DH-001 kit refused the draft->proposed advance (the NO-DANGLING-REF boundary fires there against the injected catalog snapshot) - the refusal is carried verbatim; the session is unchanged (re-compose at review to fix the composition)',
						undefined,
						{ harnessRefusal: advance.refusal },
					),
				};
			}
			const clockRead = readClock();
			if ('refusal' in clockRead) {
				return { ok: false, refusal: clockRead.refusal };
			}
			const at = clockRead.at;
			const detail = `proposed the harness through the real DH-001 kit boundary (${harnessId} advanced to proposed; full validation green over the injected catalog snapshot; the onboarding walk is complete)`;
			const record: OnboardingSessionRecord = {
				...session,
				stage: 'proposed',
				revision: session.revision + 1,
				history: [...session.history, { at, fromStage: 'review', toStage: 'proposed', op: 'propose-session', law: 'THE TWO-PHASE LAW', detail }],
			};
			const line: OnboardingOpsLedgerLine = {
				seq: mutableSeq + 1,
				at,
				contractVersion: ONBOARDING_CONTRACTS_VERSION,
				op: 'propose-session',
				sessionId: session.sessionId,
				fromStage: 'review',
				toStage: 'proposed',
				law: 'THE TWO-PHASE LAW',
				payload: null,
				harnessId,
				detail,
			};
			const nextSessions = new Map(sessions);
			nextSessions.set(session.sessionId, record);
			const persistResult = await persist(line, nextSessions);
			if (!persistResult.applied) {
				return {
					ok: false,
					refusal: refused(
						persistResult.refusal.reason,
						persistResult.refusal.law,
						`${persistResult.refusal.message} (the real kit's advance landed: harness ${harnessId} sits at proposed in the harness ledger - the DH-01 authority; the session is unchanged at review and a re-propose will surface the real kit's ILLEGAL_TRANSITION refusal honestly)`,
						persistResult.refusal.items,
					),
				};
			}
			commit(nextSessions);
			if (persistResult.refusal !== null) {
				return { ok: false, refusal: persistResult.refusal };
			}
			return sessionOutcome(record);
		},
		async inspectSession(sessionId: unknown): Promise<OnboardingSessionOutcome> {
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
		async listSessions(filter?: unknown): Promise<OnboardingListOutcome> {
			const disposedRefusal = refuseIfDisposed('listSessions');
			if (disposedRefusal !== null) {
				return { ok: false, refusal: disposedRefusal };
			}
			if (filter !== undefined) {
				if (!isRecord(filter)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the filter must be an object (or absent)') };
				}
				const filterRecord = filter as Record<string, unknown>;
				const unknownFields = Object.keys(filterRecord).filter((key) => key !== 'stage' && key !== 'industry' && key !== 'workType');
				if (unknownFields.length > 0) {
					return {
						ok: false,
						refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the filter carries an unknown field (stage / industry / workType only)', unknownFields),
					};
				}
				if (filterRecord.stage !== undefined && !isOnboardingStage(filterRecord.stage)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the stage filter value is not a member of the frozen ONBOARDING_STAGES list') };
				}
				if (filterRecord.industry !== undefined && !isHarnessIndustry(filterRecord.industry)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the industry filter value is not a member of the frozen HARNESS_INDUSTRIES list (imported by reference)') };
				}
				if (filterRecord.workType !== undefined && !isHarnessWorkType(filterRecord.workType)) {
					return { ok: false, refusal: refused('UNKNOWN_FILTER', 'THE FAIL-CLOSED LAW', 'listSessions: the workType filter value is not a member of the frozen HARNESS_WORK_TYPES list (imported by reference)') };
				}
			}
			const ids = [...sessions.keys()].sort();
			const records: OnboardingSessionRecord[] = [];
			for (const id of ids) {
				const entry = sessions.get(id) as OnboardingSessionRecord;
				if (filter !== undefined && !matchesSessionFilter(entry, filter as Record<string, unknown>)) {
					continue;
				}
				records.push(copySession(entry));
			}
			return { ok: true, sessions: records };
		},
		dispose(): void {
			disposed = true;
			inner.dispose();
		},
	};
}

// --- ledger replay + envelope cross-check (the load surface) ---

interface OnboardingLedgerReplay {
	readonly lines: readonly OnboardingOpsLedgerLine[];
	readonly sessions: Map<string, OnboardingSessionRecord>;
}

/** Parses and validates the whole onboarding ledger text; returns the torn detail or the replay (never a silent skip). */
function replayOnboardingLedger(ledgerText: string | null): OnboardingLedgerReplay | string {
	if (ledgerText === null || ledgerText.length === 0) {
		return { lines: [], sessions: new Map<string, OnboardingSessionRecord>() };
	}
	if (!ledgerText.endsWith('\n')) {
		return 'loadOnboardingKit: the onboarding ledger does not end with a complete line (a torn append - never a silent skip)';
	}
	const sessions = new Map<string, OnboardingSessionRecord>();
	const lines: OnboardingOpsLedgerLine[] = [];
	const rawLines = ledgerText.split('\n');
	rawLines.pop();
	for (let i = 0; i < rawLines.length; i += 1) {
		if (rawLines[i].length === 0) {
			return `loadOnboardingKit: onboarding ledger line ${i + 1} is empty`;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawLines[i]);
		} catch {
			return `loadOnboardingKit: onboarding ledger line ${i + 1} is not valid JSON (a torn write - never a silent skip)`;
		}
		const torn = validateOnboardingLedgerLine(parsed, i + 1, sessions);
		if (torn !== null) {
			return torn;
		}
		const record = parsed as Record<string, unknown>;
		const line: OnboardingOpsLedgerLine = {
			seq: record.seq as number,
			at: record.at as string,
			contractVersion: record.contractVersion as string,
			op: record.op as OnboardingOpName,
			sessionId: record.sessionId as string,
			fromStage: record.fromStage as OnboardingStage | null,
			toStage: record.toStage as OnboardingStage,
			law: record.law as string,
			payload: record.payload as OnboardingOpsLedgerLine['payload'],
			harnessId: record.harnessId as string | null,
			detail: record.detail as string,
		};
		applyOnboardingLine(sessions, line);
		lines.push(line);
	}
	return { lines, sessions };
}

/** Validates one parsed onboarding ledger line; returns the torn detail or null (the line is structurally valid and legal). */
function validateOnboardingLedgerLine(parsed: unknown, lineNo: number, sessions: Map<string, OnboardingSessionRecord>): string | null {
	if (!isRecord(parsed)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is not a JSON object`;
	}
	const record = parsed as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	const expected = [...ONBOARDING_LEDGER_LINE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is structurally invalid (the frozen eleven-key line schema)`;
	}
	if (typeof record.seq !== 'number' || !Number.isInteger(record.seq) || record.seq !== lineNo) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries sequence ${showValue(record.seq)}; ledger lines are missing or out of order`;
	}
	if (typeof record.at !== 'string' || record.at.length === 0) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} has no timestamp (the injected clock's reading, carried verbatim)`;
	}
	if (record.contractVersion !== ONBOARDING_CONTRACTS_VERSION) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries contract version ${showValue(record.contractVersion)} - only '${ONBOARDING_CONTRACTS_VERSION}' is known (the single-version law)`;
	}
	if (!isOnboardingOpName(record.op)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an unknown op ${showValue(record.op)}`;
	}
	if (!isOnboardingSessionId(record.sessionId)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries a malformed session id`;
	}
	if (record.fromStage !== null && !isOnboardingStage(record.fromStage)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an unknown fromStage`;
	}
	if (!isOnboardingStage(record.toStage)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an unknown toStage`;
	}
	if (typeof record.law !== 'string' || record.law.length === 0) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries no law name (the provenance law)`;
	}
	if (typeof record.detail !== 'string' || record.detail.length === 0) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} carries no provenance detail`;
	}
	const op = record.op as OnboardingOpName;
	const session = sessions.get(record.sessionId as string);
	if (op === 'begin-session') {
		if (record.payload !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a begin line that carries a payload (the begin mints the session, no stage payload)`;
		}
		if (record.harnessId !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries a harness id outside the compose-draft / propose-session boundaries`;
		}
		if (record.fromStage !== null || record.toStage !== 'industry') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a begin line that does not land 'industry' (every session enters the walk at industry)`;
		}
		if (session !== undefined) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} begins a duplicate session id`;
		}
		return null;
	}
	if (session === undefined) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} advances an unknown session`;
	}
	if (op === 'select-industry') {
		if (record.fromStage !== 'industry' || record.toStage !== 'company') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a select-industry line outside the industry->company edge`;
		}
		if (record.harnessId !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries a harness id outside the compose-draft / propose-session boundaries`;
		}
		if (session.stage !== 'industry' || session.industry !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is out of order (the session is not at the industry stage awaiting its selection)`;
		}
		if (!validateOnboardingIndustryPayload(record.payload).ok) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an invalid industry payload`;
		}
		return null;
	}
	if (op === 'compose-company') {
		if (record.fromStage !== 'company' || record.toStage !== 'work-types') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a compose-company line outside the company->work-types edge`;
		}
		if (record.harnessId !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries a harness id outside the compose-draft / propose-session boundaries`;
		}
		if (session.stage !== 'company' || session.companyProfile !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is out of order (the session is not at the company stage awaiting its profile)`;
		}
		if (!validateOnboardingCompanyProfile(record.payload).ok) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an invalid company profile`;
		}
		return null;
	}
	if (op === 'select-work-types') {
		if (record.fromStage !== 'work-types' || record.toStage !== 'review') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a select-work-types line outside the work-types->review edge`;
		}
		if (record.harnessId !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries a harness id outside the compose-draft / propose-session boundaries`;
		}
		if (session.stage !== 'work-types' || session.workTypes !== null) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is out of order (the session is not at the work-types stage awaiting its selection)`;
		}
		if (!validateOnboardingWorkTypes(record.payload).ok) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an invalid work-type selection`;
		}
		return null;
	}
	if (op === 'compose-draft') {
		if (record.fromStage !== 'review' || record.toStage !== 'review') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a compose-draft line outside the review->review self edge (the draft composes gradually; the stage never moves)`;
		}
		if (!isHarnessId(record.harnessId)) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is a compose-draft line without the minted harness id (THE REAL-KIT LAW's link)`;
		}
		if (session.stage !== 'review') {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} is out of order (the session is not at the review stage)`;
		}
		if (!validateOnboardingReviewComposition(record.payload).ok) {
			return `loadOnboardingKit: onboarding ledger line ${lineNo} carries an invalid review composition`;
		}
		return null;
	}
	if (record.payload !== null) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is a propose line that carries a payload (the propose advances the harness, no stage payload)`;
	}
	if (!isHarnessId(record.harnessId)) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is a propose line without the harness id it advanced`;
	}
	if (record.fromStage !== 'review' || record.toStage !== 'proposed') {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is a propose-session line outside the review->proposed edge`;
	}
	if (session.stage !== 'review' || session.harnessId === null || session.harnessId !== record.harnessId) {
		return `loadOnboardingKit: onboarding ledger line ${lineNo} is out of order (the session is not at the review stage holding the harness the line advances)`;
	}
	return null;
}

/** Applies one validated onboarding ledger line to the replay sessions (pure fold). */
function applyOnboardingLine(sessions: Map<string, OnboardingSessionRecord>, line: OnboardingOpsLedgerLine): void {
	if (line.op === 'begin-session') {
		sessions.set(line.sessionId, {
			sessionId: line.sessionId,
			contractVersion: ONBOARDING_CONTRACTS_VERSION,
			stage: line.toStage,
			industry: null,
			companyProfile: null,
			workTypes: null,
			reviewComposition: null,
			harnessId: null,
			createdAtIso: line.at,
			revision: 1,
			history: [noteOf(line)],
		});
		return;
	}
	const session = sessions.get(line.sessionId);
	if (session === undefined) {
		return;
	}
	const base: OnboardingSessionRecord = {
		...session,
		stage: line.toStage,
		revision: session.revision + 1,
		history: [...session.history, noteOf(line)],
	};
	let next: OnboardingSessionRecord;
	if (line.op === 'select-industry') {
		next = { ...base, industry: (line.payload as OnboardingIndustryPayload).industry };
	} else if (line.op === 'compose-company') {
		next = { ...base, companyProfile: line.payload as OnboardingCompanyProfile };
	} else if (line.op === 'select-work-types') {
		next = { ...base, workTypes: [...(line.payload as readonly HarnessWorkType[])] };
	} else if (line.op === 'compose-draft') {
		next = { ...base, reviewComposition: line.payload as OnboardingReviewComposition, harnessId: line.harnessId };
	} else {
		next = base;
	}
	sessions.set(line.sessionId, next);
}

/** Builds the history note of one ledger line (the provenance fold). */
function noteOf(line: OnboardingOpsLedgerLine): OnboardingTransitionNote {
	return {
		at: line.at,
		fromStage: line.fromStage,
		toStage: line.toStage,
		op: line.op,
		law: line.law,
		detail: line.detail,
	};
}

/** Cross-checks the onboarding envelope against the replay; returns the refusal carrier or null. */
function crossCheckOnboardingEnvelope(
	envelopeText: string | null,
	lineCount: number,
	replayed: Map<string, OnboardingSessionRecord>,
): { reason: 'E_LEDGER_TORN' | 'E_ENVELOPE_MISMATCH'; message: string } | null {
	if (envelopeText === null) {
		if (lineCount === 0) {
			return null;
		}
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			message: `loadOnboardingKit: the onboarding envelope is missing while the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`,
		};
	}
	let parsedEnvelope: unknown;
	try {
		parsedEnvelope = JSON.parse(envelopeText);
	} catch {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope is not valid JSON' };
	}
	if (!isRecord(parsedEnvelope)) {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope is not a JSON object' };
	}
	const envelope = parsedEnvelope as Record<string, unknown>;
	const keys = Object.keys(envelope).sort();
	const expected = [...ONBOARDING_ENVELOPE_SCHEMA_KEYS].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope is structurally invalid (the frozen three-key envelope schema)' };
	}
	if (envelope.contractVersion !== ONBOARDING_CONTRACTS_VERSION) {
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			message: `loadOnboardingKit: the onboarding envelope carries contract version ${showValue(envelope.contractVersion)} - only '${ONBOARDING_CONTRACTS_VERSION}' is known (the single-version law)`,
		};
	}
	if (typeof envelope.seq !== 'number' || !Number.isInteger(envelope.seq) || envelope.seq < 0) {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope carries a malformed seq' };
	}
	if (!Array.isArray(envelope.sessions)) {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope carries a malformed sessions array' };
	}
	if (envelope.seq > lineCount) {
		return {
			reason: 'E_LEDGER_TORN',
			message: `loadOnboardingKit: the onboarding envelope claims seq ${envelope.seq} but the ledger carries ${lineCount} line(s) - missing ledger lines (never a silent skip)`,
		};
	}
	if (envelope.seq < lineCount) {
		return {
			reason: 'E_ENVELOPE_MISMATCH',
			message: `loadOnboardingKit: the onboarding envelope claims seq ${envelope.seq} but the ledger carries ${lineCount} line(s) - the divergent envelope is never silently rebuilt`,
		};
	}
	const envelopeRecordMap = new Map<string, OnboardingSessionRecord>();
	for (let i = 0; i < envelope.sessions.length; i += 1) {
		const entry = envelope.sessions[i];
		const sessionOutcome = validateOnboardingSessionRecordShape(entry);
		if (sessionOutcome !== null) {
			return { reason: 'E_ENVELOPE_MISMATCH', message: `loadOnboardingKit: the onboarding envelope's sessions[${i}] is not a valid onboarding session record` };
		}
		const sessionRecord = entry as OnboardingSessionRecord;
		envelopeRecordMap.set(sessionRecord.sessionId, sessionRecord);
	}
	const replayBytes = envelopeBytesOf(envelope.seq as number, replayed);
	const envelopeBytes = envelopeBytesOf(envelope.seq as number, envelopeRecordMap);
	if (replayBytes !== envelopeBytes) {
		return { reason: 'E_ENVELOPE_MISMATCH', message: 'loadOnboardingKit: the onboarding envelope diverges from the ledger replay byte-for-byte (never silently rebuilt)' };
	}
	return null;
}

/** The deep shape guard behind the envelope cross-check (the contract module's own walk). */
function validateOnboardingSessionRecordShape(value: unknown): string | null {
	const outcome = validateOnboardingSessionRecord(value);
	if (outcome.ok) {
		return null;
	}
	return outcome.refusal.message;
}

function envelopeBytesOf(seq: number, sessions: Map<string, OnboardingSessionRecord>): string {
	const ids = [...sessions.keys()].sort();
	const records = ids.map((id) => sessions.get(id) as OnboardingSessionRecord);
	return `{"contractVersion":${JSON.stringify(ONBOARDING_CONTRACTS_VERSION)},"seq":${seq},"sessions":[${records
		.map((record) => serializeOnboardingSession(record))
		.join(',')}]}`;
}

// --- internal helpers (never exported) ---

/** Builds the canonical fixed-key-order object of a ledger-line payload. */
function canonicalPayloadObject(payload: OnboardingOpsLedgerLine['payload']): unknown {
	if (payload === null) {
		return null;
	}
	if (Array.isArray(payload)) {
		return [...payload];
	}
	if (isRecord(payload) && 'industry' in payload) {
		return { industry: (payload as OnboardingIndustryPayload).industry };
	}
	if (isRecord(payload) && 'displayName' in payload) {
		const profile = payload as OnboardingCompanyProfile;
		return { displayName: profile.displayName, sizeBand: profile.sizeBand };
	}
	const composition = payload as OnboardingReviewComposition;
	return {
		roles: composition.roles.map((role) => ({ roleKey: role.roleKey, summary: role.summary })),
		capabilityRefs: [...composition.capabilityRefs],
		workflowRefs: [...composition.workflowRefs],
		policyRefs: [...composition.policyRefs],
		evidenceRefs: [...composition.evidenceRefs],
	};
}

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

/** Shows a value for a deterministic message sentence (primitives only). */
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

function matchesSessionFilter(record: OnboardingSessionRecord, filter: Record<string, unknown>): boolean {
	if (filter.stage !== undefined && record.stage !== filter.stage) {
		return false;
	}
	if (filter.industry !== undefined && record.industry !== filter.industry) {
		return false;
	}
	if (filter.workType !== undefined && (record.workTypes === null || !record.workTypes.includes(filter.workType as HarnessWorkType))) {
		return false;
	}
	return true;
}
