/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M1/M2 - the execution journal store: the additive append-only
 * sibling artifact (flauz.execution-journal/v0) that records every
 * acquisition, hand-off, denial, loss, reattach, continuity binding and
 * effect settlement a durable task step causes.
 *
 * Discipline (the DL-9/DL-20 house style, mirrored from the orchestration
 * core's OrchestrationStore):
 *
 *   - ONE canonical JSON object per line, hash-chained (each row's prev
 *     carries the previous row's full-row hash; seq 1 has prev null).
 *   - Loading is STRICT: a bad $schema, unknown keys, malformed records, a
 *     broken chain or byte drift fail loudly and are never silently
 *     rewritten. Only the FINAL line may be a crash-torn tail (dropped and
 *     surfaced as this.tornTail).
 *   - appendRow is the ONLY write path. The candidate row is validated by a
 *     full replay of the journal INCLUDING it - an illegal acquisition
 *     transition, a wrong actor gate, a duplicate effect settlement all
 *     throw BEFORE any byte is written.
 *   - Logical acquisition state is ALWAYS a REPLAY PROJECTION of the
 *     journal, never persisted (graphs.json-style definitions are not
 *     needed here: the journal is the whole truth).
 *
 * vscode-free, zero deps; Node stdlib (sync fs, single O_APPEND-style
 * appendFileSync per row) at this boundary only.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import {
	ACQUISITION_ID_PATTERN,
	ACQUISITION_TRANSITIONS,
	ACQUISITION_STATES,
	ACQUISITION_TRANSITION_TYPES,
	EXEC_JOURNAL_PATH,
	EXEC_JOURNAL_SCHEMA_ID,
	ExecError,
	type ExecJournalRow,
	EXEC_ACTORS,
	EXEC_EVENT_TYPES,
	type ExecEventType,
	type ExecActor,
	type ExecutionResourceRef,
	canonicalJson,
	execJournalLine,
	execRowHashOf,
	execRowIdOf,
	execSha256Hex,
	eventLevelOf,
	validateExecJournalRow,
	validateExecPayload,
} from './contracts.ts';

export interface ExecJournalStoreOptions {
	/** Injectable clock (deterministic fixtures/tests; Date.now in the host). */
	readonly clock?: () => number;
	/** Acquisition-id minter (deterministic tests inject their own; default: crypto random). */
	readonly mintAcquisitionId?: () => string;
}

/** The replay-projected state of ONE acquisition. */
export interface AcquisitionProjection {
	readonly acquisitionId: string;
	readonly resource: ExecutionResourceRef;
	/** 'denied' when acquire was denied (the acquisition never opened). */
	readonly state: AcquisitionStates;
	readonly purpose: string;
	readonly graphId: string | null;
	readonly stepId: string | null;
	readonly attempt: number | null;
	readonly idempotencyKey: string | null;
	/** The task-step lease binding (the orchestration lease reference), when acquired with one. */
	readonly lease: { leaseId: string; holder: string; expiresAt: number } | null;
	/** The last hand-off surface snapshot digest chain (every recorded surface). */
	readonly surfaceDigests: readonly string[];
	/** The settle record for the effect keyed by idempotencyKey, when settled. */
	readonly settled: { outcome: 'ok' | 'failed'; rowId: string; valueDigest?: string; failureClass?: string; message?: string } | null;
	/** The last denial record, when acquire was denied. */
	readonly denied: { gate: string; message: string; rowId: string } | null;
	/** The last loss record, when the resource was lost. */
	readonly lost: { failureClass: string; message: string; rowId: string } | null;
	readonly createdAt: number;
	readonly updatedAt: number;
}

/** Acquisition states incl. the pre-open 'denied' (never persisted; replay only). */
export type AcquisitionStates = 'denied' | 'acquired' | 'lost' | 'released' | 'expired';

/** Default acquisition-id minter: flauz:exec:<16-hex> from node:crypto. */
function defaultMintAcquisitionId(): string {
	return `flauz:exec:${randomBytes(8).toString('hex')}`;
}

/** The execution journal store (append-only; strict load; replay projection). */
export class ExecJournalStore {
	readonly root: string;
	readonly journalPath: string;
	private readonly clock: () => number;
	readonly mintAcquisitionId: () => string;
	/** The raw torn tail dropped at load (a crash artifact; surfaced by the recovery scan). */
	tornTail: { line: string; reason: string } | null = null;
	private rows: ExecJournalRow[] = [];

	constructor(root: string, options: ExecJournalStoreOptions = {}) {
		if (typeof root !== 'string' || root.length === 0) {
			throw new ExecError('EXEC_INVALID_PARAMS', 'ExecJournalStore requires a workspace root');
		}
		this.root = root;
		this.journalPath = join(root, EXEC_JOURNAL_PATH);
		this.clock = options.clock ?? (() => Date.now());
		this.mintAcquisitionId = options.mintAcquisitionId ?? defaultMintAcquisitionId;
		this.load();
	}

	// ---------------------------------------------------------------------------
	// Load (strict; only the final line may be a torn tail)
	// ---------------------------------------------------------------------------

	private load(): void {
		this.rows = [];
		this.tornTail = null;
		if (!existsSync(this.journalPath)) {
			return;
		}
		const raw = readFileSync(this.journalPath, 'utf-8');
		if (raw.length === 0) {
			return;
		}
		const lines = raw.split('\n').filter((line) => line.length > 0);
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			const seq = index + 1;
			const drop = (reason: string): void => {
				if (index !== lines.length - 1) {
					throw new ExecError('EXEC_JOURNAL_CORRUPT', `journal line ${String(seq)} is malformed: ${reason} (only the FINAL line may be a crash-torn tail)`);
				}
				this.tornTail = { line, reason };
			};
			let row: unknown;
			try {
				row = JSON.parse(line);
			} catch {
				drop('not valid JSON');
				break;
			}
			const verdict = validateExecJournalRow(row);
			if (!verdict.ok) {
				drop(verdict.error);
				break;
			}
			if (verdict.row.seq !== seq) {
				drop(`seq ${String(verdict.row.seq)} at journal position ${String(seq)}`);
				break;
			}
			if (line !== execJournalLine(verdict.row)) {
				drop('not canonical (byte drift - rewrite via the store only)');
				break;
			}
			const previous = this.rows[seq - 2];
			const expectedPrev = previous === undefined ? null : execRowHashOf(previous);
			if (verdict.row.prev !== expectedPrev) {
				drop('broken hash chain (prev does not carry the previous row hash)');
				break;
			}
			this.rows.push(verdict.row);
		}
	}

	// ---------------------------------------------------------------------------
	// Append (the ONLY write path; validated by full replay incl. the row)
	// ---------------------------------------------------------------------------

	appendRow(type: ExecEventType, fields: {
		graphId?: string | null;
		stepId?: string | null;
		attempt?: number | null;
		idempotencyKey?: string | null;
		acquisitionId?: string | null;
		actor?: ExecActor;
		origin: string;
		ts?: number;
		payload: Record<string, unknown>;
	}): ExecJournalRow {
		if (!EXEC_EVENT_TYPES.includes(type)) {
			throw new ExecError('EXEC_INVALID_PARAMS', `unknown journal event type '${String(type)}'`);
		}
		const actor = fields.actor ?? 'agent';
		if (!EXEC_ACTORS.includes(actor)) {
			throw new ExecError('EXEC_INVALID_PARAMS', `actor must be one of ${EXEC_ACTORS.join(' | ')} (got '${String(actor)}')`);
		}
		const level = eventLevelOf(type);
		const acquisitionId = fields.acquisitionId ?? null;
		if (level === 'acquisition' && (acquisitionId === null || !ACQUISITION_ID_PATTERN.test(acquisitionId))) {
			throw new ExecError('EXEC_INVALID_PARAMS', `${type} is acquisition-level (acquisitionId must be flauz:exec:<16-hex>)`);
		}
		if (level === 'aggregate' && acquisitionId !== null) {
			throw new ExecError('EXEC_INVALID_PARAMS', `${type} is aggregate (acquisitionId must be null)`);
		}
		const payloadError = validateExecPayload(type, fields.payload);
		if (payloadError !== undefined) {
			throw new ExecError('EXEC_INVALID_PARAMS', `${type}: ${payloadError}`);
		}
		const seq = this.rows.length + 1;
		const candidate: ExecJournalRow = {
			$schema: EXEC_JOURNAL_SCHEMA_ID,
			seq,
			ts: fields.ts ?? this.clock(),
			rowId: execRowIdOf(seq),
			graphId: fields.graphId ?? null,
			stepId: fields.stepId ?? null,
			attempt: fields.attempt ?? null,
			idempotencyKey: fields.idempotencyKey ?? null,
			acquisitionId,
			type,
			actor,
			origin: fields.origin,
			payload: fields.payload,
			contentHash: execSha256Hex(canonicalJson(fields.payload)),
			prev: this.headHash(),
		};
		// Full replay INCLUDING the candidate row: transition legality and
		// actor gates throw BEFORE any byte is written (never a fabricated
		// or out-of-law row on disk).
		this.replay([...this.rows, candidate]);
		mkdirSync(join(this.root, '.flauz/execution'), { recursive: true });
		appendFileSync(this.journalPath, execJournalLine(candidate) + '\n');
		this.rows.push(candidate);
		return candidate;
	}

	// ---------------------------------------------------------------------------
	// Projections
	// ---------------------------------------------------------------------------

	headHash(): string | null {
		return this.rows.length === 0 ? null : execRowHashOf(this.rows[this.rows.length - 1]);
	}

	rowsAll(): readonly ExecJournalRow[] {
		return this.rows;
	}

	rowsForGraph(graphId: string): readonly ExecJournalRow[] {
		return this.rows.filter((row) => row.graphId === graphId);
	}

	verifyJournal(): { ok: boolean; rows: number; firstBadSeq?: number } {
		for (let index = 0; index < this.rows.length; index += 1) {
			const row = this.rows[index];
			const verdict = validateExecJournalRow(row);
			if (!verdict.ok || row.seq !== index + 1) {
				return { ok: false, rows: this.rows.length, firstBadSeq: index + 1 };
			}
			const previous = this.rows[index - 1];
			const expectedPrev = previous === undefined ? null : execRowHashOf(previous);
			if (row.prev !== expectedPrev) {
				return { ok: false, rows: this.rows.length, firstBadSeq: index + 1 };
			}
		}
		return { ok: true, rows: this.rows.length };
	}

	/** The settle row for an idempotency key (replay detection for the effect sink). */
	settledRowFor(idempotencyKey: string): ExecJournalRow | undefined {
		return this.rows.find((row) => row.type === 'effect-settled' && row.idempotencyKey === idempotencyKey);
	}

	/** The acquisition rows for an idempotency key (acquire/deny records). */
	acquisitionRowsForKey(idempotencyKey: string): readonly ExecJournalRow[] {
		return this.rows.filter((row) => row.idempotencyKey === idempotencyKey && (row.type === 'resource-acquired' || row.type === 'acquire-denied'));
	}

	/** The full acquisition projection (replay; throws on illegal sequences). */
	acquisitions(): Map<string, AcquisitionProjection> {
		return this.replay(this.rows);
	}

	acquisitionOf(acquisitionId: string): AcquisitionProjection {
		const found = this.acquisitions().get(acquisitionId);
		if (found === undefined) {
			throw new ExecError('EXEC_ACQUISITION_UNKNOWN', `unknown acquisition ${acquisitionId}`);
		}
		return found;
	}

	/** Acquisitions still held (acquired) for a graph, step or idempotency key. */
	heldAcquisitions(filter: { graphId?: string; stepId?: string; idempotencyKey?: string } = {}): readonly AcquisitionProjection[] {
		return [...this.acquisitions().values()].filter((acquisition) => {
			if (acquisition.state !== 'acquired') {
				return false;
			}
			if (filter.graphId !== undefined && acquisition.graphId !== filter.graphId) {
				return false;
			}
			if (filter.stepId !== undefined && acquisition.stepId !== filter.stepId) {
				return false;
			}
			if (filter.idempotencyKey !== undefined && acquisition.idempotencyKey !== filter.idempotencyKey) {
				return false;
			}
			return true;
		});
	}

	// ---------------------------------------------------------------------------
	// The replay (transition legality + actor gates; the single law table)
	// ---------------------------------------------------------------------------

	private replay(rows: readonly ExecJournalRow[]): Map<string, AcquisitionProjection> {
		const projections = new Map<string, AcquisitionProjection>();
		for (const row of rows) {
			// Aggregate rows (recovery scans, continuity exports, rollback
			// records) change NO acquisition state.
			if (row.acquisitionId === null) {
				continue;
			}
			const current = projections.get(row.acquisitionId);
			this.assertTransitionLegality(row, current);
			projections.set(row.acquisitionId, this.projectRow(current, row));
		}
		return projections;
	}

	private assertTransitionLegality(row: ExecJournalRow, current: AcquisitionProjection | undefined): void {
		const type = row.type as (typeof ACQUISITION_TRANSITION_TYPES)[number];
		if (!ACQUISITION_TRANSITION_TYPES.includes(type)) {
			return;
		}
		const rule = ACQUISITION_TRANSITIONS.find((candidate) => candidate.type === type);
		if (rule === undefined) {
			throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: no transition rule for '${String(type)}' (impossible - closed table)`);
		}
		if (type === 'resource-acquired') {
			if (current !== undefined && current.state !== 'denied') {
				// A re-acquire after a DENIAL is legal (the next attempt); every other re-acquire is not.
				throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: resource-acquired on acquisition ${row.acquisitionId} already in state '${current.state}' (allowed source states: [denied])`);
			}
		} else if (current === undefined) {
			throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: ${String(type)} on unknown acquisition ${String(row.acquisitionId)} (the acquisition must open first)`);
		} else if (!rule.from.includes(current.state as (typeof ACQUISITION_STATES)[number])) {
			throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: ${String(type)} from state '${current.state}' (allowed source states: [${rule.from.join(' | ')}])`);
		}
		if (!(rule.actors as readonly string[]).includes(row.actor)) {
			throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: actor '${row.actor}' is not allowed to ${String(type)} (allowed actors: ${rule.actors.join(' | ')})`);
		}
	}

	/** Folds ONE acquisition-level row into the projection (pure; observational rows mutate side fields only). */
	private projectRow(current: AcquisitionProjection | undefined, row: ExecJournalRow): AcquisitionProjection {
		const acquisitionId = row.acquisitionId ?? '';
		switch (row.type) {
			case 'acquire-denied': {
				const resource = row.payload['resource'] as ExecutionResourceRef;
				const lease = current?.lease ?? null;
				return {
					acquisitionId,
					resource,
					state: 'denied',
					purpose: current?.purpose ?? '',
					graphId: row.graphId,
					stepId: row.stepId,
					attempt: row.attempt,
					idempotencyKey: row.idempotencyKey,
					lease,
					surfaceDigests: current?.surfaceDigests ?? [],
					settled: current?.settled ?? null,
					denied: { gate: String(row.payload['gate'] ?? ''), message: String(row.payload['message'] ?? ''), rowId: row.rowId },
					lost: null,
					createdAt: current?.createdAt ?? row.ts,
					updatedAt: row.ts,
				};
			}
			case 'resource-acquired': {
				const resource = row.payload['resource'] as ExecutionResourceRef;
				const lease = row.payload['lease'] as { leaseId: string; holder: string; expiresAt: number } | undefined;
				return {
					acquisitionId,
					resource,
					state: 'acquired',
					purpose: String(row.payload['purpose'] ?? ''),
					graphId: row.graphId,
					stepId: row.stepId,
					attempt: row.attempt,
					idempotencyKey: row.idempotencyKey,
					lease: lease ?? null,
					surfaceDigests: current?.surfaceDigests ?? [],
					settled: current?.settled ?? null,
					denied: current?.denied ?? null,
					lost: null,
					createdAt: current?.createdAt ?? row.ts,
					updatedAt: row.ts,
				};
			}
			case 'resource-released':
			case 'resource-expired': {
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: ${row.type} on unknown acquisition`); }
				const state = row.type === 'resource-released' ? 'released' : 'expired';
				return { ...current, state, updatedAt: row.ts };
			}
			case 'resource-lost': {
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: resource-lost on unknown acquisition`); }
				return {
					...current,
					state: 'lost',
					lost: { failureClass: String(row.payload['failureClass'] ?? ''), message: String(row.payload['message'] ?? ''), rowId: row.rowId },
					updatedAt: row.ts,
				};
			}
			case 'session-reattached':
			case 'continuity-restored': {
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: ${row.type} on unknown acquisition`); }
				const digest = row.type === 'session-reattached' ? String(row.payload['surfaceDigest'] ?? '') : null;
				return {
					...current,
					state: 'acquired',
					surfaceDigests: digest === null ? current.surfaceDigests : [...current.surfaceDigests, digest],
					updatedAt: row.ts,
				};
			}
			case 'handoff-recorded': {
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: handoff-recorded on unknown acquisition`); }
				return { ...current, surfaceDigests: [...current.surfaceDigests, String(row.payload['surfaceDigest'] ?? '')], updatedAt: row.ts };
			}
			case 'effect-settled': {
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: effect-settled on unknown acquisition`); }
				const outcome = row.payload['outcome'] === 'ok' ? 'ok' : 'failed';
				return {
					...current,
					settled: {
						outcome,
						rowId: row.rowId,
						valueDigest: outcome === 'ok' ? String(row.payload['valueDigest'] ?? '') : undefined,
						failureClass: outcome === 'failed' ? String(row.payload['failureClass'] ?? '') : undefined,
						message: outcome === 'failed' ? String(row.payload['message'] ?? '') : undefined,
					},
					updatedAt: row.ts,
				};
			}
			default:
				if (current === undefined) { throw new ExecError('EXEC_TRANSITION_ILLEGAL', `row ${row.rowId}: ${row.type} on unknown acquisition`); }
				return current;
		}
	}
}
