/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The artifact-banking core (A-PROD-006-W2, contract-duplicated from the W1
 * flauz-incidents machinery, itself duplicated from the W4 flauz-durability
 * machinery): banks an acceptance artifact into the durable state so the
 * NEXT DIAGNOSTICS CENSUS genuinely reports it (the recovery-banking law).
 *
 *   (a) the census-visible evidence-ledger note row (the synthetic-taskId
 *       'flauz-acceptance', the W1 'flauz-incidents' precedent) whose uri
 *       points at the banked artifact and whose sha256 pins the artifact's
 *       canonical bytes -- the banked row carries the sha256 of the
 *       artifact, NEVER the artifact's contents (the privacy law: a canary
 *       test proves record bodies never reach banked census rows);
 *   (b) when a size watermark exists it is rewritten consistently
 *       (rowCount/bytes/head of the POST-banking ledger), keeping every
 *       post-banking verdict GREEN.
 *
 * Degrades honestly (recorded reason, no ledger mutation) when the ledger
 * does not parse+chain: the artifact itself still lands on disk, the
 * skippedReason explains.
 *
 * UNVERIFIED-BY-ME: authored against the unblock-packet surfaces; the
 * station runs the battery.
 */

import {
	type AcceptanceFsPort,
	type Clock,
	type LedgerRowShape,
	type LedgerWatermarkShape,
	type AcceptanceRecord,
	type VerificationReceipt,
	LEDGER_PATH,
	SIZE_PATH,
	ACCEPTANCE_TASK_ID,
	acceptanceRelPath,
	canonicalJson,
	joinPath,
	sha256Hex,
	utf8ByteLength,
	parseLedgerLine,
	parseWatermarkLenient,
	serializeWatermark,
	ledgerRowHash,
	ledgerHeadHash,
	receiptRelPath,
	serializeArtifact,
} from './api.ts';
import { ACCEPTANCE_DIR } from './globals.ts';
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
 * the artifact path, sha256 = the artifact's canonical bytes -- never the
 * artifact's contents) and re-syncs the size watermark when one exists.
 */
export async function bankLedgerRowFor(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, recordLine: string, logPath: string): Promise<BankingOutcome> {
	// --- the census-visible ledger row (the recovery-row precedent) ---
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
		taskId: ACCEPTANCE_TASK_ID,
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

/** The persisted acceptance record (the artifact + its banking outcome). */
export interface PersistedAcceptance {
	readonly recordPath: string;
	readonly record: AcceptanceRecord;
	readonly banking: BankingOutcome;
}

/** Sweeps (the metadata law, fail-closed) then writes + banks the acceptance record. */
export async function persistAcceptance(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, record: AcceptanceRecord): Promise<PersistedAcceptance> {
	sweepArtifact(record, 'acceptance-record');
	const recordLine = serializeArtifact(record);
	const relPath = acceptanceRelPath(record.acceptanceId);
	const recordPath = joinPath(deps.root, relPath);
	await deps.fs.mkdir(joinPath(deps.root, ACCEPTANCE_DIR));
	await deps.fs.writeFile(recordPath, recordLine);
	const banking = await bankLedgerRowFor(deps, recordLine, relPath);
	return { recordPath, record, banking };
}

/** The persisted verification receipt (pass or FAIL, both banked). */
export interface PersistedReceipt {
	readonly recordPath: string;
	readonly receipt: VerificationReceipt;
	readonly banking: BankingOutcome;
}

/** Sweeps then writes + banks the closing receipt (pass or FAIL -- the FAILED receipt is banked too; it is the reopen-consumable record). */
export async function persistReceipt(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, receipt: VerificationReceipt): Promise<PersistedReceipt> {
	sweepArtifact(receipt, 'acceptance-receipt');
	const recordLine = serializeArtifact(receipt);
	const relPath = receiptRelPath(receipt.acceptanceId, receipt.receiptId);
	const recordPath = joinPath(deps.root, relPath);
	await deps.fs.mkdir(joinPath(deps.root, ACCEPTANCE_DIR));
	await deps.fs.writeFile(recordPath, recordLine);
	const banking = await bankLedgerRowFor(deps, recordLine, relPath);
	return { recordPath, receipt, banking };
}
