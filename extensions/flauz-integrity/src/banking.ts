/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The artifact-banking core (A-PROD-005-W2, contract-duplicated from the W1
 * flauz-production machinery, itself duplicated from the W5 flauz-release
 * machinery): banks an integrity artifact into the durable state so the NEXT
 * DIAGNOSTICS CENSUS genuinely reports it (the W2 recovery-banking law).
 *
 *   (a) the census-visible evidence-ledger note row (the synthetic-taskId
 *       `flauz-integrity`, following the `flauz-backup` / `flauz-migration` /
 *       `flauz-telemetry` / `flauz-release` / `flauz-production` precedent)
 *       whose uri points at the banked artifact and whose sha256 pins the
 *       artifact's canonical bytes -- so the census reports the integrity
 *       activity (rowCount + 1, kindCounts.note + 1, a new chain head);
 *   (b) when a size watermark exists it is rewritten consistently
 *       (rowCount/bytes/head of the POST-banking ledger -- the watermark is
 *       unsigned JSON), keeping every post-banking integrity verdict GREEN.
 *
 * Degrades honestly (recorded reason, no ledger mutation) when the ledger
 * does not parse+chain: the artifact itself still lands on disk, the
 * skippedReason explains.
 *
 * THE KEY-STORE LAW: the only artifacts that ride this banking path are the
 * LEDGER record and the VERIFY record -- the KeyPort-owned key store is
 * never banked (its path never appears as a banked uri; the privacy suite
 * pins this).
 */

import {
        type IntegrityFsPort,
        type Clock,
        type LedgerRowShape,
        type LedgerWatermarkShape,
        LEDGER_PATH,
        INTEGRITY_TASK_ID,
        SIZE_PATH,
        canonicalJson,
        isPlainObject,
        joinPath,
        sha256Hex,
        utf8ByteLength,
        parseLedgerLine,
        parseWatermarkLenient,
        serializeWatermark,
        ledgerRowHash,
        ledgerHeadHash,
        isSha256Hex,
} from './api.ts';
import { sweepArtifact } from './privacy.ts';

/** The banking outcome. */
export interface BankingOutcome {
        readonly recordAppended: boolean;
        readonly ledgerRowSeq?: number;
        readonly watermarkUpdated: boolean;
        readonly skippedReason?: string;
}

/**
 * Banks one artifact row: appends the census-visible ledger note row (uri =
 * the artifact path, sha256 = the artifact's canonical bytes) and re-syncs
 * the size watermark when one exists.
 */
export async function bankLedgerRowFor(deps: { root: string; fs: IntegrityFsPort; clock: Clock }, recordLine: string, logPath: string): Promise<BankingOutcome> {
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
                taskId: INTEGRITY_TASK_ID,
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
                        $schema: 'flauz.evidence.size/v1',
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
 * Banks one record the integrity way: sweeps it (the metadata law) then
 * banks the census-visible ledger row (the artifacts themselves are written
 * by their owning command paths; this composite pins the sweep-then-bank
 * order every integrity artifact follows).
 */
export async function bankRecord(deps: { root: string; fs: IntegrityFsPort; clock: Clock }, record: unknown, recordLine: string, logPath: string): Promise<BankingOutcome> {
        sweepArtifact(record, 'integrity-record');
        return bankLedgerRowFor(deps, recordLine, logPath);
}

/** Exposed for the privacy suite's key-store assertions (shape reuse only). */
export function bankedUriIsKeyStore(uri: string, keyStorePath: string): boolean {
        return uri === keyStorePath || uri.startsWith(`${keyStorePath}/`);
}

/** Re-exported for the privacy suite (the watermark shape stays a banking concern). */
export function watermarkShapeOf(value: unknown): LedgerWatermarkShape | undefined {
        if (!isPlainObject(value) || !isSha256Hex(value.headSha256)) {
                return undefined;
        }
        return parseWatermarkLenient(value);
}
