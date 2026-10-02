/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The record-banking core (A-PROD-004-W3, shared by execute + rollback):
 * banks a migration/rollback record into the durable state so the NEXT
 * DIAGNOSTICS CENSUS genuinely reports it (the W2 recovery-banking law).
 *
 *   (a) the durable record: one canonical JSONL line appended to the record
 *       bank (.flauz/migration/migration-log.jsonl or rollback-log.jsonl);
 *   (b) an evidence-ledger note row (the synthetic-taskId `flauz-migration`
 *       precedent of the owning ledger's own `flauz.ledger` checkpoint rows,
 *       following the `flauz-backup` recovery-row precedent) whose uri points
 *       at the record bank and whose sha256 pins the record's canonical
 *       bytes -- so the census reports the migration (rowCount + 1,
 *       kindCounts.note + 1, a new chain head). A migration followed by its
 *       rollback banks TWO rows: the pair is census-visible;
 *   (c) when a size watermark exists it is rewritten consistently
 *       (rowCount/bytes/head of the POST-banking ledger -- the watermark is
 *       unsigned JSON), keeping every post-migration integrity verdict GREEN.
 *
 * Degrades honestly (recorded reason, no ledger mutation) when the ledger
 * does not parse+chain: the record line still lands in its bank, the
 * skippedReason explains. The banking vs byte-identity note (the W2 law):
 * the rollback itself is byte-identical per surface (the anchor restores the
 * exact bytes); the banking step then appends the disclosed rollback row to
 * the ledger -- that is the point of banking (the state now honestly records
 * that a rollback happened).
 */

import {
        type MigrationFsPort,
        type Clock,
        LEDGER_PATH,
        MIGRATION_TASK_ID,
        SIZE_PATH,
        canonicalJson,
        isPlainObject,
        joinPath,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { isSha256Hex, ledgerHeadHash, ledgerRowHash, parseLedgerLine, type LedgerRowShape } from './verify.ts';
import { sweepArtifact } from './privacy.ts';

/** The banking outcome. */
export interface BankingOutcome {
        readonly recordAppended: boolean;
        readonly ledgerRowSeq?: number;
        readonly watermarkUpdated: boolean;
        readonly skippedReason?: string;
}

/** Appends one canonical record line to its JSONL bank (the durable record half of the banking). */
export async function appendRecordLine(deps: { root: string; fs: MigrationFsPort }, recordLine: string, logPath: string): Promise<void> {
        const logTarget = joinPath(deps.root, logPath);
        await deps.fs.mkdir(logTarget.split('/').slice(0, -1).join('/'));
        await deps.fs.appendFile(logTarget, `${recordLine}\n`);
}

/** The contract-duplicated watermark shape (flauz-workspace hardening.ts LedgerWatermark; DL-32). */
export interface LedgerWatermarkShape {
        readonly $schema: string;
        readonly rowCount: number;
        readonly bytes: number;
        readonly headSha256: string;
        readonly lastCheckpointSeq: number | null;
        readonly updatedAt: number;
}

const SIZE_SCHEMA = 'flauz.evidence.size/v1';

/** Lenient parse of a stored watermark (undefined when not the owning shape). */
export function parseWatermarkLenient(value: unknown): LedgerWatermarkShape | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== SIZE_SCHEMA || typeof value.rowCount !== 'number' || typeof value.bytes !== 'number' || typeof value.headSha256 !== 'string' || typeof value.updatedAt !== 'number') {
                return undefined;
        }
        const lastCheckpointSeq = value.lastCheckpointSeq;
        if (lastCheckpointSeq !== null && typeof lastCheckpointSeq !== 'number') {
                return undefined;
        }
        if (!isSha256Hex(value.headSha256)) {
                return undefined;
        }
        return {
                $schema: value.$schema,
                rowCount: value.rowCount,
                bytes: value.bytes,
                headSha256: value.headSha256,
                lastCheckpointSeq,
                updatedAt: value.updatedAt,
        };
}

/** The owning serialization discipline: sorted keys, 2-space indent, one trailing newline. */
export function serializeWatermark(watermark: LedgerWatermarkShape): string {
        const sorted: Record<string, unknown> = {
                $schema: SIZE_SCHEMA,
                bytes: watermark.bytes,
                headSha256: watermark.headSha256,
                lastCheckpointSeq: watermark.lastCheckpointSeq,
                rowCount: watermark.rowCount,
                updatedAt: watermark.updatedAt,
        };
        return `${JSON.stringify(sorted, null, 2)}\n`;
}

/**
 * Banks one record: sweeps it (the metadata law), appends the canonical line
 * to its JSONL bank, appends the census-visible ledger note row (uri = the
 * bank, sha256 = the record's canonical line), and re-syncs the size
 * watermark when one exists.
 */
export async function bankLedgerRowFor(deps: { root: string; fs: MigrationFsPort; clock: Clock }, recordLine: string, logPath: string): Promise<BankingOutcome> {
        // --- the census-visible ledger row (the W2 recovery-row precedent) ---
        const ledgerPath = joinPath(deps.root, LEDGER_PATH);
        const text = await deps.fs.readFileUtf8(ledgerPath);
        const rows: LedgerRowShape[] = [];
        if (text !== undefined && text !== '') {
                for (const [index, line] of text.split('\n').filter(line => line !== '').entries()) {
                        const outcome = parseLedgerLine(line, index + 1);
                        if (!outcome.ok) {
                                return { recordAppended: true, watermarkUpdated: false, skippedReason: `the ledger row was not banked: the migrated ledger does not parse (${outcome.error}) -- the record lives in ${logPath} only` };
                        }
                        rows.push(outcome.row);
                }
        }

        const at = deps.clock();
        const row: LedgerRowShape = {
                seq: rows.length + 1,
                ts: at,
                taskId: MIGRATION_TASK_ID,
                kind: 'note',
                uri: logPath,
                sha256: sha256Hex(recordLine),
                prev: rows.length === 0 ? null : ledgerRowHash(rows[rows.length - 1] as LedgerRowShape),
        };
        const rowLine = canonicalJson(row);

        if (text === undefined) {
                // no ledger existed: banking creates it (mkdir + first row)
                await deps.fs.mkdir(ledgerPath.split('/').slice(0, -1).join('/'));
                await deps.fs.writeFile(ledgerPath, `${rowLine}\n`);
        } else {
                await deps.fs.appendFile(ledgerPath, `${rowLine}\n`);
        }

        // --- the watermark re-sync (only when the owner wrote one): rowCount/bytes/head of the POST-banking ledger ---
        let watermarkUpdated = false;
        const watermarkText = await deps.fs.readFileUtf8(joinPath(deps.root, SIZE_PATH));
        if (watermarkText !== undefined) {
                let existing: LedgerWatermarkShape | undefined;
                try {
                        existing = parseWatermarkLenient(JSON.parse(watermarkText) as unknown);
                } catch {
                        existing = undefined; // a corrupt watermark is not resynced (reported by the verifiers); it stays as the anchor restored it
                }
                const newText = await deps.fs.readFileUtf8(ledgerPath) ?? '';
                const updated: LedgerWatermarkShape = {
                        $schema: SIZE_SCHEMA,
                        rowCount: rows.length + 1,
                        bytes: utf8ByteLength(newText),
                        headSha256: ledgerHeadHash([...rows, row]),
                        lastCheckpointSeq: existing !== undefined ? existing.lastCheckpointSeq : null,
                        updatedAt: at,
                };
                await deps.fs.writeFile(joinPath(deps.root, SIZE_PATH), serializeWatermark(updated));
                watermarkUpdated = true;
        }

        return { recordAppended: true, ledgerRowSeq: row.seq, watermarkUpdated };
}

/**
 * Banks one record the execute way: sweeps it (the metadata law), appends the
 * canonical line to its JSONL bank, then banks the census-visible ledger row.
 */
export async function bankRecord(deps: { root: string; fs: MigrationFsPort; clock: Clock }, record: unknown, recordLine: string, logPath: string): Promise<BankingOutcome> {
        sweepArtifact(record, 'migration-record');
        await appendRecordLine(deps, recordLine, logPath);
        return bankLedgerRowFor(deps, recordLine, logPath);
}
