/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The loop state machine core (A-PROD-006-W1): the
 * `flauz.incidents.advance` semantics -- the closed loop of the handoff's A6
 * law.
 *
 * THE LOOP-STAGE VOCABULARY IS FROZEN VERBATIM from the A6 law:
 *   incident -> reproducible-finding -> registry-item -> fix -> regression
 *           -> release -> post-release-verification.
 * Typed forward transitions ONLY, each evidence-bearing, each carrying its
 * evidence label from the frozen ladder
 *   fixture | simulated | local-real | runtime-real | live-provider | production-real
 * (never promote a label by wording).
 *
 * THE CLOSURE LAW (fail-closed): missing evidence = typed REFUSAL naming the
 * exact missing stage-evidence kind, never a silent skip; NO stage may be
 * skipped forward. The per-transition evidence requirements:
 *   incident -> reproducible-finding: requires a `reproducible-finding-evidence` payload
 *     (the repro note + evidence refs -- the finding's reproduction account);
 *   reproducible-finding -> registry-item: requires a `registry-item-id` payload
 *     (the repo-side registry item id VERBATIM -- the two-registry separation:
 *     the product surface never mints, edits, ranks or supersedes control-plane state);
 *   registry-item -> fix: requires a `fix-evidence` payload (the fix changeset pointer);
 *   fix -> regression: REQUIRES a `regression-receipt` payload (the named
 *     regression test's passing receipt -- the closure law);
 *   regression -> release: REQUIRES a `release-identity` payload (the owning
 *     release/checklist record pointer -- the closure law);
 *   release -> post-release-verification: REQUIRES a `post-release-verification-receipt`
 *     payload (a re-run of the named owning checks against the released state,
 *     banked as the closing receipt -- the closure law); this transition CLOSES the loop.
 *
 * THE ONE REOPEN LAW: a failed post-release verification REOPENS the incident
 * with the failure as evidence (a closed loop never hides a regression). The
 * reopen transition moves the incident from `post-release-verification` (the
 * closed stage) back to `fix` (a new fix is needed for the production
 * regression). The reopen carries the failure as evidence, with the evidence
 * label from the frozen ladder.
 *
 * THE LOOP JOURNAL (the durability pattern): the transition journal
 * `.flauz/incidents/loop-<incident>.jsonl` (`flauz.incidents-loop/v1`,
 * append-only, one row per transition with actor + timestampIso via the
 * INJECTED clock -- the durability injected-clock law; no `Date.now`/`new
 * Date()` in src, grep-clean). Each transition appends ONE row: a `forward`
 * transition, the `close` transition (release -> post-release-verification),
 * the `reopen` transition (post-release-verification -> fix on a failed
 * verification), or a `refusal` row (missing evidence -- the typed refusal).
 *
 * THE TWO-REGISTRY SEPARATION (DL-86 ADOPT): the registry-item stage carries
 * the repo-side registry item id VERBATIM (the link; the product surface
 * never mints, edits, ranks or supersedes control-plane state). The
 * `registry-item-id` evidence payload is the verbatim registry item id;
 * the loop stores it but never modifies it.
 */

import {
	type Clock,
	type IncidentsFsPort,
	type LoopStage,
	type EvidenceLabel,
	type TransitionEvidence,
	type LoopJournalRow,
	IncidentsError,
	EXTENSION_ID,
	INCIDENTS_DIR,
	LOOP_SCHEMA_ID,
	LOOP_FORWARD,
	CLOSURE_STAGE,
	EVIDENCE_LABELS,
	isIncidentId,
	isUnderFlauz,
	joinPath,
	readLoopJournal,
	canonicalJson,
} from './api.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The frozen per-transition evidence requirements (the closure law)
// ---------------------------------------------------------------------------

/** The per-transition required evidence kind (the closure law's named missing-evidence kinds). */
export const TRANSITION_EVIDENCE_REQUIREMENTS: Readonly<Record<LoopStage, string>> = {
	'incident': 'reproducible-finding-evidence',
	'reproducible-finding': 'registry-item-id',
	'registry-item': 'fix-evidence',
	'fix': 'regression-receipt',
	'regression': 'release-identity',
	'release': 'post-release-verification-receipt',
	// the final stage has no forward successor; the missing-evidence list for a closed loop is empty
	'post-release-verification': '',
};

/** The advance command's typed arguments (commands carry DATA only). */
export interface AdvanceArgs {
	readonly incidentId: string;
	readonly actor: string;
	/** The transition the operator requests: `forward` (the next stage), `reopen` (the ONE reopen law). */
	readonly transition: 'forward' | 'reopen';
	/** The evidence the transition carries (absent for the first intake row -- but advance never fires the intake row; the report command does). */
	readonly evidence: {
		readonly label: EvidenceLabel;
		readonly kind: string;
		readonly detail: string;
		readonly evidenceRefs?: readonly string[];
		/** The repo-side registry item id (REQUIRED VERBATIM at the registry-item transition; absent elsewhere). */
		readonly registryItemId?: string;
	};
}

/** Parses + validates the advance arguments (the typed refusal surface). */
export function parseAdvanceArgs(arg: unknown): AdvanceArgs {
	if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: the argument must be { incidentId, actor, transition, evidence }');
	}
	const record = arg as Record<string, unknown>;
	if (!isIncidentId(record.incidentId)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: incidentId must match the flauz:inc:<16-hex> shape (the incident whose loop is advancing)');
	}
	if (typeof record.actor !== 'string' || record.actor.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: actor must be a non-empty string (the operator id firing the transition; never contents)');
	}
	if (record.transition !== 'forward' && record.transition !== 'reopen') {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: transition must be one of forward|reopen (the typed forward transition OR the ONE reopen law; a closed loop never hides a regression)');
	}
	const evRaw = record.evidence;
	if (!evRaw || typeof evRaw !== 'object' || Array.isArray(evRaw)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: evidence must be { label, kind, detail, evidenceRefs?, registryItemId? }');
	}
	const ev = evRaw as Record<string, unknown>;
	if (typeof ev.label !== 'string' || !(EVIDENCE_LABELS as readonly string[]).includes(ev.label)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.advance: evidence.label must be one of ${EVIDENCE_LABELS.join('|')} (the frozen evidence-label ladder -- never promote a label by wording)`);
	}
	if (typeof ev.kind !== 'string' || ev.kind.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: evidence.kind must be a non-empty string (the evidence payload kind: the named regression test id, the release identity, the post-release verification receipt, the registry item id, the fix changeset pointer, the repro note)');
	}
	if (typeof ev.detail !== 'string') {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: evidence.detail must be a string (the operator-facing account; swept fail-closed for secret-shaped values)');
	}
	if (ev.evidenceRefs !== undefined && (!Array.isArray(ev.evidenceRefs) || !ev.evidenceRefs.every((ref: unknown) => typeof ref === 'string' && isUnderFlauz(ref as string)))) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.advance: evidence.evidenceRefs, when present, must be an array of workspace-relative paths under .flauz/ only (never absolute, never parent-escape, never contents)`);
	}
	if (ev.registryItemId !== undefined && typeof ev.registryItemId !== 'string') {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.advance: evidence.registryItemId, when present, must be a string (the repo-side registry item id carried VERBATIM -- the two-registry separation: the product surface never mints, edits, ranks or supersedes control-plane state)');
	}
	return {
		incidentId: record.incidentId,
		actor: record.actor,
		transition: record.transition,
		evidence: {
			label: ev.label as EvidenceLabel,
			kind: ev.kind,
			detail: ev.detail,
			...(ev.evidenceRefs !== undefined ? { evidenceRefs: [...(ev.evidenceRefs as string[])] } : {}),
			...(ev.registryItemId !== undefined ? { registryItemId: ev.registryItemId as string } : {}),
		},
	};
}

/** The advance outcome (command-level). */
export interface AdvanceResult {
	readonly ok: true;
	readonly incidentId: string;
	/** The stage BEFORE the transition (the `from` stage). */
	readonly fromStage: LoopStage;
	/** The stage AFTER the transition (the `to` stage; for a refusal, the stage the incident stays at). */
	readonly toStage: LoopStage;
	/** The transition kind: `forward` | `reopen` | `close` | `refusal`. */
	readonly transition: 'forward' | 'reopen' | 'close' | 'refusal';
	/** The appended journal row. */
	readonly row: LoopJournalRow;
	/** True when the transition was refused for missing evidence (the typed refusal). */
	readonly refused: boolean;
	/** Present when refused: the exact missing stage-evidence kind. */
	readonly refusedEvidenceKind?: string;
	readonly persisted: PersistedJournal;
}

/** The persisted outcome. */
export interface PersistedJournal {
	readonly journalPath: string;
	readonly row: LoopJournalRow;
	readonly banking: BankingOutcome;
}

/** The loop journal's workspace-relative path for one incident. */
export function loopJournalPath(incidentId: string): string {
	return joinPath(INCIDENTS_DIR, `loop-${incidentId}.jsonl`);
}

/**
 * Computes the current loop stage from the journal rows. The first row (the
 * intake row, fired by the report command) is `toStage: 'incident'` with
 * `transition: 'forward'` and no `fromStage`. Each subsequent row's `toStage`
 * is the current stage. Returns `undefined` when the journal is absent
 * (the incident was reported but the report command did not write the intake
 * row -- a programming error caught by the advance path's refusal).
 */
export function currentLoopStage(rows: readonly LoopJournalRow[]): LoopStage | undefined {
	if (rows.length === 0) {
		return undefined;
	}
	return rows[rows.length - 1].toStage;
}

/**
 * Validates the evidence a transition carries against the per-transition
 * requirement (the closure law). Returns `undefined` when the evidence
 * satisfies the requirement, or the exact missing stage-evidence kind when it
 * does not.
 */
export function missingEvidenceKind(fromStage: LoopStage, evidence: AdvanceArgs['evidence']): string | undefined {
	const required = TRANSITION_EVIDENCE_REQUIREMENTS[fromStage];
	if (required === '') {
		// the final stage has no forward successor; a forward transition from here is the closure (handled by the caller)
		return undefined;
	}
	// the reproducible-finding -> registry-item transition requires the verbatim registry item id (the two-registry separation: the product surface carries the repo-side registry item id VERBATIM at the registry-item stage)
	if (fromStage === 'reproducible-finding') {
		if (evidence.registryItemId === undefined || evidence.registryItemId.length === 0) {
			return 'registry-item-id';
		}
		return undefined;
	}
	// the other transitions require their named evidence kind (the evidence.kind must match the required kind)
	if (evidence.kind !== required) {
		return required;
	}
	// the regression-receipt and release-identity and post-release-verification-receipt require a non-empty detail (the receipt's account)
	if (fromStage === 'fix' || fromStage === 'regression' || fromStage === 'release') {
		if (evidence.detail.length === 0) {
			return required;
		}
	}
	return undefined;
}

/**
 * Advances the loop for one incident. THE CLOSURE LAW (fail-closed): missing
 * evidence = typed REFUSAL naming the exact missing stage-evidence kind,
 * never a silent skip; NO stage may be skipped forward. THE ONE REOPEN LAW:
 * a failed post-release verification REOPENS the incident (the closed loop
 * never hides a regression) -- the reopen transition moves the incident from
 * `post-release-verification` back to `fix` with the failure as evidence.
 */
export async function advanceLoop(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, args: AdvanceArgs): Promise<AdvanceResult> {
	const journalState = await readLoopJournal(deps.root, deps.fs, args.incidentId);
	if (journalState.state === 'torn') {
		throw new IncidentsError('FLAUZ_INCIDENTS_FORMAT', `flauz.incidents.advance: REFUSED -- the loop journal for ${args.incidentId} is torn (${journalState.reason}); an advance would silently erase the torn evidence -- route to the operator`);
	}
	const rows: LoopJournalRow[] = journalState.state === 'resolved' ? [...journalState.rows] : [];
	if (rows.length === 0) {
		// the report command writes the intake row (transition='forward', toStage='incident'); an advance with no journal is a programming error
		throw new IncidentsError('FLAUZ_INCIDENTS_UNKNOWN_INCIDENT', `flauz.incidents.advance: REFUSED -- the loop journal for ${args.incidentId} is absent (the report command must fire the intake row first; report the incident with flauz.incidents.report)`);
	}
	const fromStage = currentLoopStage(rows) as LoopStage;

	// the reopen law: a failed post-release verification reopens the incident
	if (args.transition === 'reopen') {
		if (fromStage !== CLOSURE_STAGE) {
			throw new IncidentsError('FLAUZ_INCIDENTS_BAD_TRANSITION', `flauz.incidents.advance: REFUSED -- the ONE reopen law fires ONLY from the closed stage (post-release-verification); the incident is at '${fromStage}' (a closed loop never hides a regression -- but only a closed loop can reopen)`);
		}
		const reopenStage: LoopStage = 'fix';
		const row = buildRow(deps, args, rows.length + 1, fromStage, reopenStage, 'reopen', args.evidence);
		const persisted = await persistRow(deps, args.incidentId, row);
		return { ok: true, incidentId: args.incidentId, fromStage, toStage: reopenStage, transition: 'reopen', row, refused: false, persisted };
	}

	// the forward transition: fromStage -> LOOP_FORWARD[fromStage] (or the closure)
	const toStage = (LOOP_FORWARD as Readonly<Record<LoopStage, LoopStage | undefined>>)[fromStage];
	if (toStage === undefined) {
		// the final stage has no forward successor; an advance from the closed stage is the reopen law (handled above) or a programming error
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_TRANSITION', `flauz.incidents.advance: REFUSED -- the incident is at the closed stage '${fromStage}'; a forward transition from here is not defined (use the reopen transition for a failed post-release verification)`);
	}

	// the closure law: missing evidence = typed refusal
	const missing = missingEvidenceKind(fromStage, args.evidence);
	if (missing !== undefined) {
		// append a refusal row (the typed refusal, never a silent skip); the incident stays at fromStage
		const refusalRow = buildRefusalRow(deps, args, rows.length + 1, fromStage, missing);
		const persisted = await persistRow(deps, args.incidentId, refusalRow);
		return { ok: true, incidentId: args.incidentId, fromStage, toStage: fromStage, transition: 'refusal', row: refusalRow, refused: true, refusedEvidenceKind: missing, persisted };
	}

	// the closure: release -> post-release-verification CLOSES the loop
	const transitionKind: 'forward' | 'close' = toStage === CLOSURE_STAGE ? 'close' : 'forward';
	const row = buildRow(deps, args, rows.length + 1, fromStage, toStage, transitionKind, args.evidence);
	const persisted = await persistRow(deps, args.incidentId, row);
	return { ok: true, incidentId: args.incidentId, fromStage, toStage, transition: transitionKind, row, refused: false, persisted };
}

/** Builds a forward/close/reopen journal row (the evidence-bearing transition). */
function buildRow(deps: { clock: Clock }, args: AdvanceArgs, seq: number, fromStage: LoopStage, toStage: LoopStage, transition: 'forward' | 'reopen' | 'close', evidence: AdvanceArgs['evidence']): LoopJournalRow {
	const at = deps.clock();
	const evidencePayload: TransitionEvidence = {
		label: evidence.label,
		kind: evidence.kind,
		detail: evidence.detail,
		...(evidence.evidenceRefs !== undefined ? { evidenceRefs: [...evidence.evidenceRefs] } : {}),
		...(evidence.registryItemId !== undefined ? { registryItemId: evidence.registryItemId } : {}),
	};
	return {
		$schema: LOOP_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents-loop',
		extensionId: EXTENSION_ID,
		incidentId: args.incidentId,
		seq,
		timestampEpoch: at,
		timestampIso: toIsoStamp(at),
		actor: args.actor,
		transition,
		fromStage,
		toStage,
		evidence: evidencePayload,
	};
}

/** Builds a refusal row (the typed refusal naming the exact missing stage-evidence kind). */
function buildRefusalRow(deps: { clock: Clock }, args: AdvanceArgs, seq: number, fromStage: LoopStage, missingKind: string): LoopJournalRow {
	const at = deps.clock();
	return {
		$schema: LOOP_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents-loop',
		extensionId: EXTENSION_ID,
		incidentId: args.incidentId,
		seq,
		timestampEpoch: at,
		timestampIso: toIsoStamp(at),
		actor: args.actor,
		transition: 'refusal',
		fromStage,
		toStage: fromStage,
		evidence: {
			label: args.evidence.label,
			kind: args.evidence.kind,
			detail: args.evidence.detail,
			...(args.evidence.evidenceRefs !== undefined ? { evidenceRefs: [...args.evidence.evidenceRefs] } : {}),
		},
		refusedEvidenceKind: missingKind,
	};
}

/** Persists one journal row the W3 way: swept, appended, banked census-visible. */
export async function persistRow(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, incidentId: string, row: LoopJournalRow): Promise<PersistedJournal> {
	sweepArtifact(row, 'incidents-loop-row');
	const rowLine = canonicalJson(row);
	const journalRelPath = loopJournalPath(incidentId);
	const journalPath = joinPath(deps.root, journalRelPath);
	await deps.fs.mkdir(joinPath(deps.root, INCIDENTS_DIR));
	// append-only: read existing, append the new row, write back is NOT the pattern -- use appendFile (the durability pattern)
	const existing = await deps.fs.readFileUtf8(journalPath);
	if (existing === undefined) {
		await deps.fs.writeFile(journalPath, `${rowLine}\n`);
	} else {
		await deps.fs.appendFile(journalPath, `${rowLine}\n`);
	}
	const banking = await bankRecord(deps, row, rowLine, journalRelPath);
	return { journalPath, row, banking };
}

/**
 * Fires the intake row for an incident (the first row, fired by the report
 * command when the incident is first reported). The intake row is
 * `transition: 'forward', fromStage: undefined, toStage: 'incident'`, with
 * no evidence (the report command's args carry the evidence -- the intake
 * row records the loop's entry into the `incident` stage).
 */
export async function fireIntakeRow(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, incidentId: string, actor: string): Promise<PersistedJournal> {
	if (!isIncidentId(incidentId)) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', `flauz.incidents.report: the incident id '${incidentId}' is not the flauz:inc:<16-hex> shape`);
	}
	const at = deps.clock();
	const row: LoopJournalRow = {
		$schema: LOOP_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents-loop',
		extensionId: EXTENSION_ID,
		incidentId,
		seq: 1,
		timestampEpoch: at,
		timestampIso: toIsoStamp(at),
		actor,
		transition: 'forward',
		toStage: 'incident',
	};
	return persistRow(deps, incidentId, row);
}

/** Renders the advance outcome (the disclosure-first law). */
export function renderAdvance(result: AdvanceResult): string[] {
	const lines: string[] = [];
	lines.push(`  incident: ${result.incidentId}`);
	lines.push(`    transition: ${result.transition}${result.transition === 'refusal' ? ' (TYPED REFUSAL -- missing evidence)' : result.transition === 'close' ? ' (the loop CLOSES on post-release verification evidence)' : result.transition === 'reopen' ? ' (the ONE reopen law -- a closed loop never hides a regression)' : ''}`);
	lines.push(`    from ${result.fromStage} -> to ${result.toStage}`);
	if (result.refused) {
		lines.push(`    REFUSED: missing stage-evidence kind '${result.refusedEvidenceKind}' (the closure law: missing evidence = typed refusal, never a silent skip; NO stage may be skipped forward)`);
	} else if (result.row.evidence !== undefined) {
		lines.push(`    evidence: label '${result.row.evidence.label}' | kind '${result.row.evidence.kind}' (the frozen evidence-label ladder -- never promote a label by wording)`);
		if (result.row.evidence.evidenceRefs !== undefined) {
			lines.push(`      evidence refs: ${result.row.evidence.evidenceRefs.length} (paths under .flauz/ only)`);
		}
	}
	lines.push(`    journal: ${result.persisted.journalPath} (append-only, census-visible: the banked evidence row taskId 'flauz-incidents'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
	return lines;
}

/** The closure-readiness check for an incident (the status plane's missing-evidence column source). */
export function closureReadiness(fromStage: LoopStage): readonly string[] {
	const required = TRANSITION_EVIDENCE_REQUIREMENTS[fromStage];
	if (required === '') {
		return []; // the closed stage: nothing missing
	}
	return [required];
}

/** Re-exported for the contract suite (the loop vocabulary exactness pin). */
export { LOOP_STAGES, LOOP_FORWARD, CLOSURE_STAGE, EVIDENCE_LABELS } from './api.ts';
