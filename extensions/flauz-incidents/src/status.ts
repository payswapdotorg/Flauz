/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The ledger-verdict core (A-PROD-006-W1): the
 * `flauz.incidents.status` semantics -- the verdict table over every
 * incident.
 *
 * THE VERDICT TABLE (the order's law, typed, never silent): per incident --
 *   - the loop stage (the last journal row's `toStage`; `incident` when no
 *     transition has fired beyond the intake row);
 *   - the source-binding state (resolved | disclosed-unresolvable |
 *     manual-disclosed);
 *   - the closure readiness (the EXACT list of missing stage-evidence kinds,
 *     typed; empty when the loop is closed or no forward transition is
 *     available);
 *   - the loop verdict (closed | open | reopened | refused-evidence).
 *
 * THE LOOP VERDICT LAW:
 *   closed -- the loop closed on post-release verification evidence (the
 *             current stage is `post-release-verification` AND the last
 *             transition was `close`, not `refusal`);
 *   open -- the loop is mid-progress (any stage before closure, OR the
 *           closure stage reached via a refusal);
 *   reopened -- the loop was closed and then reopened by a failed
 *               post-release verification (the last transition was `reopen`);
 *   refused-evidence -- a transition was refused for missing evidence (the
 *                        last transition was `refusal` and the incident is
 *                        stuck at the refused stage).
 *
 * THE HONEST-EVIDENCE LAW: this wave delivers MACHINERY over workspace state.
 * The status record states the honest scope (the boundary disclosure,
 * verbatim in every record): machinery COMPLETE, production usage EMPTY by
 * design -- the launch has not happened; no record may claim production
 * evidence. Evidence level: local-real (workspace records) or lower.
 *
 * The record persists `.flauz/incidents/status-<stamp>.json`
 * (`flauz.incidents-status/v1`), swept fail-closed + banked
 * census-visible (taskId `flauz-incidents`).
 */

import {
        type Clock,
        type IncidentsFsPort,
        type IncidentRecord,
        type IncidentStatusRow,
        type IncidentsStatusRecord,
        type IncidentsLedgerState,
        type LoopStage,
        type LoopJournalRow,
        type LoopVerdict,
        type SourceBindingKind,
        type SourceBindingState,
        EXTENSION_ID,
        INCIDENTS_DIR,
        STATUS_SCHEMA_ID,
        CLOSURE_STAGE,
        joinPath,
        readIncidentsLedger,
        readLoopJournal,
        serializeArtifact,
} from './api.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { toIsoStamp } from './format.ts';
import { TRANSITION_EVIDENCE_REQUIREMENTS, currentLoopStage } from './loop.ts';

/** The honest-scope disclosure carried by every status record + render (the honest-evidence law). */
export const BOUNDARY_DISCLOSURE = 'THE HONEST SCOPE: this wave delivers MACHINERY over workspace state -- the incident ledger, the loop journals, the verdict table. Production usage is EMPTY by design: the launch has not happened; no record, test, or sentence may claim a production incident, production usage, or production-real evidence. The evidence label for everything in this wave is local-real (workspace records) or lower, stated honestly.';

/** The status outcome (command-level). */
export interface StatusResult {
        readonly ok: true;
        readonly record: IncidentsStatusRecord;
        readonly persisted: PersistedStatus;
}

/** The persisted outcome. */
export interface PersistedStatus {
        readonly recordPath: string;
        readonly record: IncidentsStatusRecord;
        readonly banking: BankingOutcome;
}

/** The status record's workspace-relative path (the record + banked uri). */
export function statusRecordPath(stamp: string): string {
        return joinPath(INCIDENTS_DIR, `status-${stamp}.json`);
}

/**
 * Computes the loop verdict for one incident (the verdict law). The verdict
 * is derived from the loop journal's last transition row + the current
 * stage.
 */
export function loopVerdictOf(rows: readonly LoopJournalRow[]): LoopVerdict {
        if (rows.length === 0) {
                return 'open';
        }
        const last = rows[rows.length - 1];
        if (last.transition === 'refusal') {
                return 'refused-evidence';
        }
        if (last.transition === 'reopen') {
                return 'reopened';
        }
        if (last.toStage === CLOSURE_STAGE && last.transition === 'close') {
                return 'closed';
        }
        return 'open';
}

/**
 * Computes the registry-item id carried VERBATIM at the registry-item stage
 * (the two-registry separation link; present after the registry-item
 * transition). Scans the journal rows for the registry-item transition row
 * and reads its evidence.registryItemId.
 */
export function registryItemIdOf(rows: readonly LoopJournalRow[]): string | undefined {
        for (const row of rows) {
                if (row.toStage === 'registry-item' && row.evidence !== undefined) {
                        // the registry-item transition carries the verbatim registry item id in its evidence payload
                        // (the missingEvidenceKind check at advance time required the registryItemId field)
                        const evidence = row.evidence as { registryItemId?: string };
                        if (typeof evidence.registryItemId === 'string' && evidence.registryItemId.length > 0) {
                                return evidence.registryItemId;
                        }
                }
        }
        return undefined;
}

/**
 * The closure-readiness column: the EXACT list of missing stage-evidence
 * kinds the loop needs to close (typed; empty when the loop is closed or
 * the current stage is the closure stage). Each entry names the evidence
 * kind the next forward transition requires.
 */
export function closureReadinessOf(rows: readonly LoopJournalRow[], currentStage: LoopStage): readonly string[] {
        // the closed stage: nothing missing (the loop closed on post-release verification evidence)
        if (currentStage === CLOSURE_STAGE) {
                return [];
        }
        // the verdict shapes the readiness:
        //   refused-evidence -- the last refusal's missing kind (the incident is stuck at the refused stage);
        //   closed/reopened/open -- the next forward transition's required kind.
        const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
        if (last !== undefined && last.transition === 'refusal' && last.refusedEvidenceKind !== undefined) {
                return [last.refusedEvidenceKind];
        }
        const required = TRANSITION_EVIDENCE_REQUIREMENTS[currentStage];
        if (required === '') {
                return [];
        }
        return [required];
}

/** The source-binding kind + state of an incident's latest revision. */
function sourceBindingOf(incident: IncidentRecord): { kind: SourceBindingKind; state: SourceBindingState } {
        const latest = incident.revisions[incident.revisions.length - 1] as IncidentRecord['revisions'][number];
        const binding = latest.sourceBinding;
        if (binding.kind === 'manual') {
                return { kind: 'manual', state: 'manual-disclosed' };
        }
        return { kind: binding.kind, state: binding.resolved ? 'resolved' : 'disclosed-unresolvable' };
}

/**
 * The supervision verdict: every incident in the ledger with its loop stage,
 * its source-binding state, its closure readiness, and its loop verdict.
 * A torn ledger persists the honest typed record (zero incidents + the
 * reason -- never a guessed summary).
 */
export async function runStatus(deps: { root: string; fs: IncidentsFsPort; clock: Clock }): Promise<StatusResult> {
        const at = deps.clock();
        const ledger: IncidentsLedgerState = await readIncidentsLedger(deps.root, deps.fs);

        const rows: IncidentStatusRow[] = [];
        if (ledger.state === 'resolved') {
                for (const incident of ledger.record.incidents) {
                        const journalState = await readLoopJournal(deps.root, deps.fs, incident.incidentId);
                        const journalRows: LoopJournalRow[] = journalState.state === 'resolved' ? [...journalState.rows] : [];
                        const currentStage = currentLoopStage(journalRows) ?? 'incident';
                        const binding = sourceBindingOf(incident);
                        const latest = incident.revisions[incident.revisions.length - 1] as IncidentRecord['revisions'][number];
                        rows.push({
                                incidentId: incident.incidentId,
                                loopStage: currentStage,
                                sourceBindingState: binding.state,
                                sourceBindingKind: binding.kind,
                                revisionCount: incident.revisions.length,
                                severity: latest.severity,
                                class: latest.class,
                                affectedSurface: latest.affectedSurface,
                                missingEvidence: closureReadinessOf(journalRows, currentStage),
                                verdict: loopVerdictOf(journalRows),
                                journalRows: journalRows.length,
                                ...(registryItemIdOf(journalRows) !== undefined ? { registryItemId: registryItemIdOf(journalRows) } : {}),
                        });
                }
        }

        const record: IncidentsStatusRecord = {
                $schema: STATUS_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-incidents-status',
                createdAt: at,
                extensionId: EXTENSION_ID,
                boundaryDisclosure: BOUNDARY_DISCLOSURE,
                ledgerState: ledger.state,
                ...(ledger.state === 'torn' ? { tornReason: ledger.reason } : {}),
                incidents: rows,
                counts: {
                        incidents: rows.length,
                        closed: rows.filter(row => row.verdict === 'closed').length,
                        open: rows.filter(row => row.verdict === 'open').length,
                        reopened: rows.filter(row => row.verdict === 'reopened').length,
                        refusedEvidence: rows.filter(row => row.verdict === 'refused-evidence').length,
                        manualDisclosed: rows.filter(row => row.sourceBindingState === 'manual-disclosed').length,
                        resolved: rows.filter(row => row.sourceBindingState === 'resolved').length,
                        disclosedUnresolvable: rows.filter(row => row.sourceBindingState === 'disclosed-unresolvable').length,
                },
        };

        const persisted = await persistStatus(deps, record);
        return { ok: true, record, persisted };
}

/** Persists the status record the W3 way: swept, written, banked census-visible. */
export async function persistStatus(deps: { root: string; fs: IncidentsFsPort; clock: Clock }, record: IncidentsStatusRecord): Promise<PersistedStatus> {
        const recordLine = serializeArtifact(record);
        const stamp = toIsoStamp(record.createdAt).replaceAll(':', '');
        const recordRelPath = statusRecordPath(stamp);
        const recordPath = joinPath(deps.root, recordRelPath);
        await deps.fs.mkdir(joinPath(deps.root, INCIDENTS_DIR));
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
                lines.push(`  incident ledger: ${record.ledgerState}${record.tornReason !== undefined ? ` (${record.tornReason})` : ''} -- the honest typed degradation, never a guessed summary`);
        }
        for (const row of record.incidents) {
                lines.push(`  incident ${row.incidentId}: ${row.verdict}`);
                lines.push(`    loop stage: ${row.loopStage} | source binding: ${row.sourceBindingKind} (${row.sourceBindingState}) | severity: ${row.severity} | class: ${row.class} | affected surface: ${row.affectedSurface}`);
                lines.push(`    revisions: ${row.revisionCount} | journal rows: ${row.journalRows}${row.registryItemId !== undefined ? ` | registry item id (VERBATIM): ${row.registryItemId}` : ''}`);
                if (row.missingEvidence.length > 0) {
                        lines.push(`    closure readiness: missing ${row.missingEvidence.length} stage-evidence kind(s): ${row.missingEvidence.join(', ')} (the closure law: missing evidence = typed refusal, never a silent skip)`);
                } else if (row.verdict === 'closed') {
                        lines.push(`    closure readiness: CLOSED -- the loop closed on post-release verification evidence (the named owning checks re-run against the released state, banked as the closing receipt)`);
                } else {
                        lines.push(`    closure readiness: nothing missing at this stage (the next forward transition will name its evidence requirement)`);
                }
        }
        lines.push(`  verdict table: ${record.counts.incidents} incident(s) -- ${record.counts.closed} closed | ${record.counts.open} open | ${record.counts.reopened} reopened | ${record.counts.refusedEvidence} refused-evidence | source bindings: ${record.counts.manualDisclosed} manual-disclosed, ${record.counts.resolved} resolved, ${record.counts.disclosedUnresolvable} disclosed-unresolvable`);
        return lines;
}

/** Re-exported for the contract suite (the verdict vocabulary exactness pin). */
export { CLOSURE_STAGE, LOOP_FORWARD } from './api.ts';
