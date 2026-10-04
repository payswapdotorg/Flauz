/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 6: Replay/resume projection contracts. Versioned data contracts,
 * constants, and the pure resume-plan derivation over the execution journal.
 * Zero-dependency by law: this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges.
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW: this module is a READ-MODEL over the execution journal authority
 * (extensions/flauz-execution/src/contracts.ts: EXEC_JOURNAL_SCHEMA_ID, the
 * append-only flauz.execution-journal/v0 journal with positive-integer seq rows).
 * The journal remains canonical; this projection derives replay plans from a cursor
 * and NEVER reads, writes, or replays the journal itself. No journal engine, no
 * restart machinery may appear here: types, constants, pure guards only.
 *
 * DIVERGENCE LAW (fail-closed): `deriveResumePlan` is pure and total: it returns a
 * typed outcome and NEVER throws. A journal that has grown past the cursor is
 * resumable; a journal behind the cursor (or a malformed input) is a divergence:
 * replay from that cursor is unsafe, so it is reported as data, never as an
 * exception and never as a resumable plan.
 */

/**
 * Version of the ZC-001 pattern contract set; a record is current only when its
 * `contractVersion` matches exactly. Re-declared in every zcode-patterns contract
 * module because the zero-import law forbids a shared base module; tests pin all
 * declarations to this exact value.
 */
export const ZCODE_PATTERNS_CONTRACTS_VERSION = '1.0.0';

/**
 * Workspace/tenant scoping tuple attached to every persisted zcode-patterns record.
 */
export interface ZcodeScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * The journal this projection replays: the execution journal authority's schema id
 * ('flauz.execution-journal/v0'), contract-duplicated here because common/ modules
 * import nothing. Tests pin this constant against the authority constant so drift
 * is impossible.
 */
export const JOURNAL_SUBJECT = 'flauz.execution-journal/v0';

/**
 * Maximum number of journal rows in one replay step (bounded replay windows).
 * Exported for tuning; the derivation never hides a magic number.
 */
export const REPLAY_WINDOW_ROWS = 500;

/**
 * Read-model of one consumer's replay position: the journal subject, the last
 * sequence number the consumer processed (0 means nothing processed yet; the
 * authority journal's seq is a positive integer, contiguous from 1), the ISO stamp
 * of the last resume, and whether that resume was a cold replay after restart.
 */
export interface ReplayCursorRecord {
	scope: ZcodeScope;
	contractVersion: string;
	journalSubject: typeof JOURNAL_SUBJECT;
	lastSequenceNumber: number;
	resumedAtIso: string;
	cold: boolean;
}

/**
 * One bounded replay window: journal rows from `fromSequence` to `toSequence`,
 * both inclusive.
 */
export interface ReplayStep {
	readonly fromSequence: number;
	readonly toSequence: number;
}

/**
 * Resumable outcome: the journal has not fallen behind the cursor. `steps` lists
 * the bounded, ordered, non-overlapping replay windows covering exactly the rows
 * after the cursor (empty when the cursor is already at the head).
 */
export interface ResumableResumePlan {
	readonly kind: 'resumable';
	readonly cold: boolean;
	readonly lastSequenceNumber: number;
	readonly journalLength: number;
	readonly pendingCount: number;
	readonly steps: readonly ReplayStep[];
}

/**
 * Divergence outcome: replay from this cursor is unsafe. Either the journal is
 * behind the cursor (truncated/rotated/compacted) or an input was malformed;
 * either way the divergence is reported as data, never as an exception.
 */
export interface DivergenceResumePlan {
	readonly kind: 'divergence';
	readonly cold: boolean;
	readonly lastSequenceNumber: number;
	readonly journalLength: number;
	readonly reason: 'journal-behind-cursor' | 'invalid-input';
}

/**
 * The typed resume-plan outcome.
 */
export type ResumePlan = ResumableResumePlan | DivergenceResumePlan;

/**
 * Pure derivation: the resume plan for one cursor against a journal of
 * `journalLength` rows. Deterministic (same inputs, same plan), total (typed
 * outcomes only, never an exception):
 *
 * - malformed inputs (negative or non-integer cursor position or journal length)
 *   -> divergence('invalid-input');
 * - journal behind the cursor (journalLength < lastSequenceNumber)
 *   -> divergence('journal-behind-cursor');
 * - otherwise -> resumable, with bounded ordered windows covering exactly
 *   (lastSequenceNumber, journalLength].
 */
export function deriveResumePlan(cursor: ReplayCursorRecord, journalLength: number): ResumePlan {
	if (typeof cursor.lastSequenceNumber !== 'number' || !Number.isInteger(cursor.lastSequenceNumber) || cursor.lastSequenceNumber < 0) {
		return {
			kind: 'divergence',
			cold: cursor.cold,
			lastSequenceNumber: cursor.lastSequenceNumber,
			journalLength,
			reason: 'invalid-input',
		};
	}
	if (typeof journalLength !== 'number' || !Number.isInteger(journalLength) || journalLength < 0) {
		return {
			kind: 'divergence',
			cold: cursor.cold,
			lastSequenceNumber: cursor.lastSequenceNumber,
			journalLength,
			reason: 'invalid-input',
		};
	}
	if (journalLength < cursor.lastSequenceNumber) {
		return {
			kind: 'divergence',
			cold: cursor.cold,
			lastSequenceNumber: cursor.lastSequenceNumber,
			journalLength,
			reason: 'journal-behind-cursor',
		};
	}
	const pendingCount = journalLength - cursor.lastSequenceNumber;
	const steps: ReplayStep[] = [];
	let from = cursor.lastSequenceNumber + 1;
	while (from <= journalLength) {
		const to = Math.min(from + REPLAY_WINDOW_ROWS - 1, journalLength);
		steps.push({ fromSequence: from, toSequence: to });
		from = to + 1;
	}
	return {
		kind: 'resumable',
		cold: cursor.cold,
		lastSequenceNumber: cursor.lastSequenceNumber,
		journalLength,
		pendingCount,
		steps,
	};
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedReplayCursorRecord(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
