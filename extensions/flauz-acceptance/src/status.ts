/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The ledger-verdict core (A-PROD-006-W2): the
 * `flauz.acceptance.status` semantics -- the verdict table over every
 * acceptance record.
 *
 * THE VERDICT TABLE (typed, never silent): per acceptance --
 *   - the bound checklist identity (the path VERBATIM + the checklistId +
 *     the verdict the launch bound -- GO by the launch-act law);
 *   - the revision count (the unique-id law's append history);
 *   - the owning-checks count (the release's acceptance set);
 *   - the incident-binding state (resolved | disclosed-unresolvable, or
 *     absent when the launch did not bind an incident loop);
 *   - the receipts banked so far + the LATEST receipt's verdict
 *     (pass | fail; absent when none banked yet) with its disclosure/fail
 *     counts.
 *
 * THE HONEST-EVIDENCE LAW: this wave delivers MACHINERY over workspace
 * state. The status record states the honest scope (the boundary
 * disclosure, verbatim in every record): machinery COMPLETE, production
 * usage EMPTY by design -- the production launch has not happened; the
 * launch acts exercised by this plane's tests are seeded workspace
 * records. No record may claim production evidence. Evidence level:
 * local-real (workspace records) or lower.
 *
 * The record persists `.flauz/acceptance/status-<stamp>.json`
 * (`flauz.acceptance-status/v1`), swept fail-closed + banked
 * census-visible (taskId `flauz-acceptance`).
 */

import {
        type AcceptanceFsPort,
        type AcceptanceStatusRecord,
        type AcceptanceStatusRow,
        type Clock,
        STATUS_SCHEMA_ID,
        EXTENSION_ID,
        ACCEPTANCE_DIR,
        STATUS_PREFIX,
        joinPath,
        readAcceptanceLedger,
        readVerificationJournal,
        serializeArtifact,
} from './api.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { toIsoStamp } from './format.ts';

/** The honest-scope disclosure carried by every status record + render (the honest-evidence law). */
export const BOUNDARY_DISCLOSURE = 'THE HONEST SCOPE: this wave delivers MACHINERY over workspace state -- the acceptance ledger, the verification journals, the verdict table. Production usage is EMPTY by design: the production launch has not happened; the launch acts exercised by this plane\'s tests are seeded workspace records, honestly labeled. No record, test, or sentence may claim a production launch, production usage, or production-real evidence. The evidence label for everything in this wave is local-real (workspace records) or lower, stated honestly.';

/** The status outcome (command-level). */
export interface StatusResult {
        readonly ok: true;
        readonly record: AcceptanceStatusRecord;
        readonly persisted: PersistedStatus;
}

/** The persisted outcome. */
export interface PersistedStatus {
        readonly recordPath: string;
        readonly record: AcceptanceStatusRecord;
        readonly banking: BankingOutcome;
}

/** The status record's workspace-relative path (the record + banked uri). */
export function statusRecordPath(stamp: string): string {
        return joinPath(ACCEPTANCE_DIR, `${STATUS_PREFIX}${stamp}.json`);
}

/**
 * The supervision verdict: every acceptance in the ledger with its bound
 * checklist identity, revision count, owning-checks count, incident-binding
 * state, and the latest receipt's verdict. A torn ledger persists the
 * honest typed record (zero acceptances + the reason -- never a guessed
 * summary).
 */
export async function runStatus(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }): Promise<StatusResult> {
        const at = deps.clock();
        const ledger = await readAcceptanceLedger(deps.root, deps.fs);

        const rows: AcceptanceStatusRow[] = [];
        if (ledger.state === 'resolved') {
                for (const acceptance of ledger.record.acceptances) {
                        const latest = acceptance.revisions[acceptance.revisions.length - 1];
                        if (latest === undefined) {
                                continue; // unreachable: the parser requires >= 1 revision
                        }
                        const journalState = await readVerificationJournal(deps.root, deps.fs, acceptance.acceptanceId);
                        const journalRows = journalState.state === 'resolved' ? [...journalState.rows] : [];
                        const latestReceipt = journalRows[journalRows.length - 1];
                        const row: Record<string, unknown> = {
                                acceptanceId: acceptance.acceptanceId,
                                revisionCount: acceptance.revisions.length,
                                checklistPath: latest.checklistPath,
                                checklistId: latest.checklistId,
                                launchedAtIso: latest.launchedAtIso,
                                owningCheckCount: latest.owningChecks.length,
                                receipts: journalRows.length,
                        };
                        if (latest.incidentBinding !== undefined) {
                                row.incidentBindingState = latest.incidentBinding.disclosed;
                                row.incidentId = latest.incidentBinding.incidentId;
                                row.regressionTestId = latest.incidentBinding.regressionTestId;
                        }
                        if (latestReceipt !== undefined) {
                                row.latestReceiptVerdict = latestReceipt.verdict;
                                row.latestReceiptDisclosures = latestReceipt.counts.disclosure;
                                row.latestReceiptFails = latestReceipt.counts.fail;
                        }
                        rows.push(row as unknown as AcceptanceStatusRow);
                }
        }

        const record: AcceptanceStatusRecord = {
                $schema: STATUS_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance-status',
                createdAt: at,
                extensionId: EXTENSION_ID,
                boundaryDisclosure: BOUNDARY_DISCLOSURE,
                ledgerState: ledger.state,
                ...(ledger.state === 'torn' ? { tornReason: ledger.reason } : {}),
                acceptances: rows,
                counts: {
                        acceptances: rows.length,
                        withReceipts: rows.filter(row => row.receipts > 0).length,
                        latestPass: rows.filter(row => row.latestReceiptVerdict === 'pass').length,
                        latestFail: rows.filter(row => row.latestReceiptVerdict === 'fail').length,
                        incidentBound: rows.filter(row => row.incidentBindingState !== undefined).length,
                },
        };

        const persisted = await persistStatus(deps, record);
        return { ok: true, record, persisted };
}

/** Persists the status record the W1 way: swept, written, banked census-visible. */
export async function persistStatus(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, record: AcceptanceStatusRecord): Promise<PersistedStatus> {
        const recordLine = serializeArtifact(record);
        const stamp = toIsoStamp(record.createdAt).replaceAll(':', '');
        const recordRelPath = statusRecordPath(stamp);
        const recordPath = joinPath(deps.root, recordRelPath);
        await deps.fs.mkdir(joinPath(deps.root, ACCEPTANCE_DIR));
        await deps.fs.writeFile(recordPath, recordLine);
        const banking = await bankRecord(deps, record, recordLine, recordRelPath);
        return { recordPath, record, banking };
}

/** Renders the ledger verdict (the disclosure-first law). */
export function renderStatus(result: StatusResult): string[] {
        const lines: string[] = [];
        const { record } = result;
        lines.push(`  ${BOUNDARY_DISCLOSURE}`);
        if (record.ledgerState !== 'resolved') {
                lines.push(`  acceptance ledger: ${record.ledgerState}${record.tornReason !== undefined ? ` (${record.tornReason})` : ''} -- the honest typed degradation, never a guessed summary`);
        }
        for (const row of record.acceptances) {
                lines.push(`  acceptance ${row.acceptanceId}: ${row.latestReceiptVerdict === 'fail' ? 'LATEST RECEIPT FAIL (the typed failure record the incidents reopen law consumes)' : row.latestReceiptVerdict === 'pass' ? 'latest receipt pass' : 'no receipts banked yet'}`);
                lines.push(`    bound checklist: ${row.checklistPath} (checklistId ${row.checklistId.slice(0, 12)}..., verdict GO -- the launch-act law bound a GREEN artifact)`);
                lines.push(`    revisions: ${String(row.revisionCount)} | owning checks: ${String(row.owningCheckCount)} | receipts: ${String(row.receipts)}${row.latestReceiptDisclosures !== undefined ? ` | latest: ${String(row.latestReceiptDisclosures)} disclosure(s), ${String(row.latestReceiptFails ?? 0)} fail(s)` : ''}`);
                if (row.incidentBindingState !== undefined) {
                        lines.push(`    incident binding: ${row.incidentBindingState} (${row.incidentId}${row.regressionTestId !== undefined ? `, the named regression test '${row.regressionTestId}'` : ''})`);
                }
        }
        lines.push(`  verdict table: ${String(record.counts.acceptances)} acceptance(s) -- ${String(record.counts.withReceipts)} with receipts (${String(record.counts.latestPass)} latest-pass, ${String(record.counts.latestFail)} latest-fail) | ${String(record.counts.incidentBound)} incident-bound`);
        return lines;
}
