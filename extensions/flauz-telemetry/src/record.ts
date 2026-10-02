/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The telemetry record command core (A-PROD-004-W4) -- the collection plane.
 *
 * THE COLLECTION LAW: when telemetry is ENABLED, the pass observes the real
 * durable surfaces (observe.ts), folds the observations into AGGREGATE rows
 * (one row per distinct dimension-tuple with its count -- shapes/counts/
 * durations/outcomes, never contents), sweeps the WHOLE batch before a
 * single byte is written (fail-closed: one poisoned row refuses the entire
 * pass), applies the retention prune, appends the rows to the workspace-local
 * ledger (`.flauz/telemetry/ledger.jsonl`), and banks the census-visible
 * evidence row (evidence.ts -- the W1-census diagnosability).
 *
 * When telemetry is DISABLED the command is a TYPED REFUSAL
 * (FLAUZ_TELEMETRY_DISABLED) -- never a silent no-op: the refusal renders
 * the declared schema and the explicit-enable path so the operator sees the
 * gate, not a wall (the W3 grammar).
 *
 * THE SESSION LAW: every pass carries a session id (the observing session).
 * The default id derives from the wall clock; an explicit id may be passed
 * via the command argument (validated: ids are metadata, and metadata may
 * never be secret-shaped -- the sweep enforces it).
 */

import {
        LEDGER_PATH,
        TelemetryError,
        canonicalJson,
        isPlainObject,
        joinPath,
        splitJsonl,
        type Clock,
        type TelemetryFsPort,
} from './api.ts';
import { loadTelemetryConfig, schemaDigestMatches, telemetryRowLine, type TelemetryRow } from './config.ts';
import { isDurationBucket, isEventKind, isFailureClassId, isOutcome, isSurfaceId } from './schema.ts';
import { observeAllSurfaces, type ObservationEvent } from './observe.ts';
import { bankTelemetryPassRow } from './evidence.ts';
import { sweepArtifact } from './privacy.ts';

// ---------------------------------------------------------------------------
// The ledger row contract (the durable form -- the parse side)
// ---------------------------------------------------------------------------

/** The telemetry ledger row schema id (durable rows pin it in-band). */
export const TELEMETRY_ROW_SCHEMA_ID = 'flauz.telemetry-event/v1';

/** Strict parse of one stored telemetry ledger line. */
export function parseTelemetryRow(line: string, lineNo: number): { readonly ok: true; readonly row: TelemetryRow } | { readonly ok: false; readonly error: string } {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { ok: false, error: `telemetry line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { ok: false, error: `telemetry line ${String(lineNo)} is not a JSON object` };
        }
        if (parsed.$schema !== TELEMETRY_ROW_SCHEMA_ID) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: $schema must be '${TELEMETRY_ROW_SCHEMA_ID}' (a foreign line is not a telemetry row)` };
        }
        const keys = Object.keys(parsed);
        const required = ['$schema', 'seq', 'at', 'session', 'eventKind', 'surface', 'outcome', 'durationBucket', 'count'];
        const hasErrorCode = Object.prototype.hasOwnProperty.call(parsed, 'errorCode');
        const hasIdentity = Object.prototype.hasOwnProperty.call(parsed, 'identity');
        const expected = required.length + (hasErrorCode ? 1 : 0) + (hasIdentity ? 1 : 0);
        if (keys.length !== expected || !required.every(field => Object.prototype.hasOwnProperty.call(parsed, field))) {
                return { ok: false, error: `telemetry line ${String(lineNo)} must have exactly the fields [${required.join(', ')}] plus optionals [errorCode?, identity?]` };
        }
        if (typeof parsed.seq !== 'number' || !Number.isSafeInteger(parsed.seq) || parsed.seq < 1) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: seq must be a positive integer` };
        }
        if (typeof parsed.at !== 'number' || !Number.isSafeInteger(parsed.at) || parsed.at <= 0) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: at must be a positive integer` };
        }
        if (typeof parsed.session !== 'string' || parsed.session.length === 0 || parsed.session.length > 64) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: session must be a non-empty string of at most 64 chars` };
        }
        if (!isEventKind(parsed.eventKind)) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: eventKind must be one of the declared event kinds` };
        }
        if (!isSurfaceId(parsed.surface)) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: surface must be one of the declared surfaces` };
        }
        if (!isOutcome(parsed.outcome)) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: outcome must be one of the declared outcomes` };
        }
        if (!isDurationBucket(parsed.durationBucket)) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: durationBucket must be one of the declared buckets` };
        }
        if (hasErrorCode && !isFailureClassId(parsed.errorCode)) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: errorCode must be a taxonomy class id` };
        }
        if (typeof parsed.count !== 'number' || !Number.isSafeInteger(parsed.count) || parsed.count < 1) {
                return { ok: false, error: `telemetry line ${String(lineNo)}: count must be a positive integer` };
        }
        if (hasIdentity) {
                const identity = parsed.identity;
                if (!isPlainObject(identity) || Object.keys(identity).length === 0) {
                        return { ok: false, error: `telemetry line ${String(lineNo)}: identity must be a non-empty object of id fields` };
                }
                for (const [field, value] of Object.entries(identity)) {
                        if (!['providerId', 'environmentId', 'workflowId', 'graphId'].includes(field) || typeof value !== 'string' || value.length === 0) {
                                return { ok: false, error: `telemetry line ${String(lineNo)}: identity fields must be providerId|environmentId|workflowId|graphId with non-empty string values` };
                        }
                }
        }
        const row: TelemetryRow = {
                $schema: TELEMETRY_ROW_SCHEMA_ID,
                seq: parsed.seq,
                at: parsed.at,
                session: parsed.session,
                eventKind: parsed.eventKind,
                surface: parsed.surface,
                outcome: parsed.outcome,
                durationBucket: parsed.durationBucket,
                count: parsed.count,
                ...(hasErrorCode ? { errorCode: parsed.errorCode as string } : {}),
                ...(hasIdentity ? { identity: parsed.identity as Record<string, string> } : {}),
        };
        return { ok: true, row };
}

/** Reads + parses the whole local ledger ({rows, firstParseError}). */
export async function readTelemetryLedger(root: string, fs: TelemetryFsPort): Promise<{ rows: TelemetryRow[]; firstParseError?: string }> {
        const text = await fs.readFileUtf8(joinPath(root, LEDGER_PATH));
        if (text === undefined) {
                return { rows: [] };
        }
        const rows: TelemetryRow[] = [];
        let firstParseError: string | undefined;
        for (const [index, line] of splitJsonl(text).entries()) {
                if (line === '') {
                        firstParseError ??= `line ${String(index + 1)} is empty`;
                        continue;
                }
                const outcome = parseTelemetryRow(line, index + 1);
                if (outcome.ok) {
                        rows.push(outcome.row);
                } else {
                        firstParseError ??= outcome.error;
                }
        }
        return { rows, ...(firstParseError !== undefined ? { firstParseError } : {}) };
}

// ---------------------------------------------------------------------------
// The aggregation (observations -> aggregate rows)
// ---------------------------------------------------------------------------

/** The aggregate key: the full dimension tuple (sorted identity fields; NO counts inside the key). */
function aggregateKeyOf(event: ObservationEvent): string {
        const identity = event.identity === undefined ? {} : Object.fromEntries(Object.entries(event.identity).sort(([a], [b]) => (a < b ? -1 : 1)));
        return canonicalJson({
                durationBucket: event.durationBucket,
                errorCode: event.errorCode ?? null,
                eventKind: event.eventKind,
                identity,
                outcome: event.outcome,
                surface: event.surface,
        });
}

/**
 * Folds observations into aggregate rows: one row per distinct dimension
 * tuple, `count` = how many observations folded into it. Deterministic
 * ordering (the key's canonical JSON sorts the rows).
 */
export function aggregateEvents(events: readonly ObservationEvent[]): TelemetryRow[] {
        const counts = new Map<string, { event: ObservationEvent; count: number }>();
        for (const event of events) {
                const key = aggregateKeyOf(event);
                const existing = counts.get(key);
                if (existing === undefined) {
                        counts.set(key, { event, count: 1 });
                } else {
                        existing.count += 1;
                }
        }
        return [...counts.entries()]
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([, value], index) => ({
                        $schema: TELEMETRY_ROW_SCHEMA_ID,
                        seq: index + 1,
                        at: 0, // stamped by the record pass (the caller sets the real clock value)
                        session: '', // stamped by the record pass
                        eventKind: value.event.eventKind,
                        surface: value.event.surface,
                        outcome: value.event.outcome,
                        durationBucket: value.event.durationBucket,
                        count: value.count,
                        ...(value.event.errorCode !== undefined ? { errorCode: value.event.errorCode } : {}),
                        ...(value.event.identity !== undefined ? { identity: value.event.identity } : {}),
                }));
}

// ---------------------------------------------------------------------------
// The session id
// ---------------------------------------------------------------------------

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Parses the record-command session argument (undefined -> the clock-derived default). */
export function resolveSessionId(arg: unknown, clock: Clock): string {
        if (arg === undefined || arg === null) {
                return `sess-${String(clock())}`;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                if (record.session === undefined || record.session === null) {
                        return `sess-${String(clock())}`;
                }
                if (typeof record.session === 'string') {
                        if (!SESSION_ID_PATTERN.test(record.session)) {
                                throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', 'flauz.telemetry.record: \'session\' must match [A-Za-z0-9][A-Za-z0-9._-]{0,63} (ids are metadata; metadata may never be secret-shaped)');
                        }
                        return record.session;
                }
                throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', 'flauz.telemetry.record: \'session\' must be a string');
        }
        throw new TelemetryError('FLAUZ_TELEMETRY_CONFIG_INVALID', 'flauz.telemetry.record: the argument must be an object like { session: \'sess-42\' } (or omitted)');
}

// ---------------------------------------------------------------------------
// The record pass
// ---------------------------------------------------------------------------

/** The record pass outcome (rendered by the command; every field is counts/ids/names). */
export interface RecordPassResult {
        readonly session: string;
        readonly rowsAppended: number;
        readonly eventsObserved: number;
        readonly prunedRows: number;
        readonly ledgerRowsAfter: number;
        readonly unparseableSurfaces: readonly string[];
        readonly absentSurfaces: readonly string[];
        readonly bankedLedgerRowSeq?: number;
        readonly watermarkUpdated: boolean;
        readonly skippedBankingReason?: string;
}

export interface RecordDeps {
        readonly root: string;
        readonly fs: TelemetryFsPort;
        readonly clock: Clock;
}

/**
 * Runs one record pass. THE ORDER OF OPERATIONS IS THE LAW:
 *   1. typed refusal when disabled (never a silent no-op);
 *   2. typed refusal on schema drift (the vocabulary changed under consent);
 *   3. observe the real surfaces;
 *   4. fold into aggregate rows + stamp session/clock;
 *   5. retention-prune the existing ledger;
 *   6. sweep the WHOLE would-be-written state (fail-closed batch law);
 *   7. append the rows;
 *   8. bank the census-visible evidence row (pinning the appended tail).
 */
export async function runRecordPass(deps: RecordDeps, session: string): Promise<RecordPassResult> {
        // --- 1. the opt-in gate ---
        const config = await loadTelemetryConfig(deps.root, deps.fs);
        if (!config.enabled) {
                throw new TelemetryError(
                        'FLAUZ_TELEMETRY_DISABLED',
                        'flauz.telemetry.record: REFUSED -- telemetry is DISABLED (the opt-in default: zero collection). Inspect the declared schema with flauz.telemetry.config, then enable explicitly with flauz.telemetry.config { enable: true }. A disabled record pass is a typed refusal, never a silent no-op.',
                );
        }

        // --- 2. the schema-drift gate ---
        if (!schemaDigestMatches(config)) {
                throw new TelemetryError(
                        'FLAUZ_TELEMETRY_SCHEMA_DRIFT',
                        'flauz.telemetry.record: REFUSED -- the declared event schema has drifted from the digest pinned at enable time (the recording vocabulary changed under the active consent). Re-inspect the schema (flauz.telemetry.config) and re-enable consciously; consent is pinned to the exact vocabulary it was given for.',
                );
        }

        // --- 3. observe ---
        const pass = await observeAllSurfaces(deps.root, deps.fs);

        // --- 4. fold + stamp ---
        const at = deps.clock();
        const rows = aggregateEvents(pass.events).map(row => ({ ...row, at, session }));

        // --- 5. retention prune ---
        const existingText = await deps.fs.readFileUtf8(joinPath(deps.root, LEDGER_PATH));
        const existing = await readTelemetryLedger(deps.root, deps.fs);
        const cutoff = at - config.retentionDays * 86_400_000;
        const kept = existing.rows.filter(row => row.at >= cutoff);
        const prunedRows = existing.rows.length - kept.length;
        if (prunedRows > 0) {
                const ledgerTarget = joinPath(deps.root, LEDGER_PATH);
                const rewritten = kept.map((row, index) => telemetryRowLine({ ...row, seq: index + 1 })).join('\n');
                await deps.fs.writeFile(ledgerTarget, kept.length > 0 ? `${rewritten}\n` : '');
        }
        // the seq base is the RAW line count (unparseable lines still occupy seq space --
        // parse errors surface honestly in the report; seq never collides)
        const seqBase = existingText === undefined || existingText === '' ? 0 : splitJsonl(existingText).length;

        // --- 6. the fail-closed batch sweep (the W1 bundle law: one poisoned row refuses the whole pass) ---
        sweepArtifact({ rows, session }, 'telemetry-record-batch');

        // --- 7. append ---
        const ledgerTarget = joinPath(deps.root, LEDGER_PATH);
        let nextSeq = seqBase;
        if (rows.length > 0) {
                await deps.fs.mkdir(ledgerTarget.split('/').slice(0, -1).join('/'));
                const stamped = rows.map(row => ({ ...row, seq: (nextSeq += 1) }));
                const lines = stamped.map(row => `${telemetryRowLine(row)}\n`).join('');
                await deps.fs.appendFile(ledgerTarget, lines);
        }

        // --- 8. bank the census-visible evidence row (pinning the appended tail) ---
        let bankedLedgerRowSeq: number | undefined;
        let watermarkUpdated = false;
        let skippedBankingReason: string | undefined;
        if (rows.length > 0) {
                const tailRow: TelemetryRow = { ...(rows[rows.length - 1] as TelemetryRow), seq: nextSeq };
                const banking = await bankTelemetryPassRow(deps, telemetryRowLine(tailRow));
                bankedLedgerRowSeq = banking.ledgerRowSeq;
                watermarkUpdated = banking.watermarkUpdated;
                skippedBankingReason = banking.skippedReason;
        }

        const ledgerRowsAfter = kept.length + rows.length;
        return {
                session,
                rowsAppended: rows.length,
                eventsObserved: pass.events.length,
                prunedRows,
                ledgerRowsAfter,
                unparseableSurfaces: pass.unparseableSurfaces,
                absentSurfaces: pass.absentSurfaces,
                ...(bankedLedgerRowSeq !== undefined ? { bankedLedgerRowSeq } : {}),
                watermarkUpdated,
                ...(skippedBankingReason !== undefined ? { skippedBankingReason } : {}),
        };
}

/** Renders the record pass result (counts + names only). */
export function renderRecordResult(result: RecordPassResult): string[] {
        const lines: string[] = [];
        lines.push(`flauz.telemetry.record: session ${result.session} -- observed ${String(result.eventsObserved)} event(s), appended ${String(result.rowsAppended)} aggregate row(s) to the workspace-local ledger (.flauz/telemetry/ledger.jsonl).`);
        lines.push(`  ledger now carries ${String(result.ledgerRowsAfter)} row(s); retention pruned ${String(result.prunedRows)} row(s) this pass.`);
        if (result.bankedLedgerRowSeq !== undefined) {
                lines.push(`  census-visible: banked evidence-ledger note row seq ${String(result.bankedLedgerRowSeq)} (the next flauz.diag.show census reports this pass; the row pins the appended telemetry tail).`);
        } else if (result.skippedBankingReason !== undefined) {
                lines.push(`  census-visible: NOT banked -- ${result.skippedBankingReason}`);
        } else {
                lines.push('  census-visible: nothing banked (the pass appended zero rows; an empty pass changed no state).');
        }
        if (result.watermarkUpdated) {
                lines.push('  the evidence size watermark was resynced after banking (rowCount/bytes/head of the post-banking ledger).');
        }
        if (result.unparseableSurfaces.length > 0) {
                lines.push(`  honest parse report: ${result.unparseableSurfaces.join(', ')} did not parse -- no events faked for them.`);
        }
        if (result.absentSurfaces.length > 0) {
                lines.push(`  absent surfaces (honest absence): ${result.absentSurfaces.join(', ')}.`);
        }
        lines.push('  local-first: no network egress exists in v0; these aggregates never leave the machine.');
        return lines;
}
