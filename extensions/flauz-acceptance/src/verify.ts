/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The closing-receipt core (A-PROD-006-W2, DL-87 law 3): the
 * `flauz.acceptance.verify` semantics -- the re-run of the named owning
 * checks against the released state, banked as the post-release
 * verification receipt (pass or FAIL, both typed, both banked).
 *
 * THE POST-RELEASE-ACCEPTANCE LAW: a FAILED receipt is the typed failure
 * record the incidents reopen law consumes (the closed loop never hides a
 * regression). The receipt's evidence label comes from the frozen ladder
 * and is never promoted by wording; a check the acceptance plane cannot
 * itself evaluate is a TYPED DISCLOSURE row naming its owning surface (the
 * honest-scope law), never a silent green.
 *
 * THE HONEST-SCOPE CARVE-OUT (which named checks are genuinely re-run):
 *   - `checklistArtifact` (the one self-evaluable checklist row): re-read
 *     the bound checklist artifact's bytes + re-derive its checklistId --
 *     exactly the row's own observable, re-run by this plane over the
 *     workspace state (evidence label: local-real);
 *   - every OTHER checklist row kind: a TYPED DISCLOSURE row naming the
 *     row's owning command (flauz.diag.show, flauz.backup.export, ... --
 *     this plane never invokes another extension's command; the boundary
 *     law). The disclosure row carries NO evidence label (a disclosure is
 *     not evidence -- never a fabricated label);
 *   - the incident's named regression test: a TYPED DISCLOSURE row naming
 *     the repo test lane (this plane never executes tests);
 *   - PLUS the product-state pin row (this plane's own check over the
 *     released state): re-read every pinned surface + the pinned
 *     regression receipt ref and compare presence + detected format version
 *     + parse cleanliness against the launch pin (evidence label:
 *     local-real). Byte growth of the append-only surfaces is DISCLOSED,
 *     never failed (the pin semantics; see productState.ts).
 *
 * THE RECEIPT VERDICT: 'fail' iff any self-evaluated row failed; 'pass'
 * otherwise. The disclosures render on every receipt (never silent greens)
 * but do not fail it -- an honest pass with N disclosed surfaces is the
 * truthful verdict this plane can bank.
 *
 * THE JOURNAL (the durability pattern): `.flauz/acceptance/verify-<acceptanceId>.jsonl`
 * (`flauz.acceptance-verification/v1`, append-only, one row per verify run
 * with actor + timestampIso via the INJECTED clock -- the durability
 * injected-clock law).
 */

import {
        type AcceptanceFsPort,
        type AcceptanceRecord,
        type AcceptanceRevision,
        type Clock,
        type EvidenceLabel,
        type PinnedProductState,
        type VerificationCheckRow,
        type VerificationRow,
        AcceptanceError,
        ACCEPTANCE_DIR,
        EXTENSION_ID,
        VERIFICATION_SCHEMA_ID,
        isAcceptanceId,
        joinPath,
        readAcceptanceLedger,
        readVerificationJournal,
        canonicalJson,
} from './api.ts';
import { reReadProductState } from './productState.ts';
import { bankRecord, type BankingOutcome } from './ledger.ts';
import { sweepArtifact } from './privacy.ts';
import { toIsoStamp } from './format.ts';
import { readChecklistArtifact } from './launch.ts';

// ---------------------------------------------------------------------------
// The pin comparison (the released-state drift law)
// ---------------------------------------------------------------------------

/** The per-file drift reasons of the product-state pin comparison. */
export interface PinDrift {
        readonly reasons: readonly string[];
        readonly growthDisclosed: readonly string[];
}

/**
 * Compares the re-read product state against the launch pin (the pin
 * semantics): a present file gone absent, a detected format version change,
 * or a clean surface that tore = DRIFT (a fail reason); a file that grew
 * (byte-size change on an append-only surface) or appeared after the launch
 * = DISCLOSED growth (never a failure -- append-only surfaces lawfully
 * grow; the pin carries presence + format identity + cleanliness, never
 * byte equality).
 */
export function comparePin(pin: PinnedProductState, fresh: PinnedProductState): PinDrift {
        const reasons: string[] = [];
        const growthDisclosed: string[] = [];
        const freshByPath = new Map<string, { present: boolean; sha256?: string; bytes?: number; detectedVersion?: string; problem?: string }>();
        for (const surface of fresh.versionInventory) {
                for (const file of surface.files) {
                        freshByPath.set(file.sourcePath, file);
                }
        }
        for (const pinnedSurface of pin.versionInventory) {
                for (const pinnedFile of pinnedSurface.files) {
                        const freshFile = freshByPath.get(pinnedFile.sourcePath);
                        if (pinnedFile.present && (freshFile === undefined || !freshFile.present)) {
                                reasons.push(`${pinnedFile.sourcePath}: present at launch, ABSENT in the released state (the released state lost a pinned file)`);
                                continue;
                        }
                        if (!pinnedFile.present) {
                                if (freshFile !== undefined && freshFile.present) {
                                        growthDisclosed.push(`${pinnedFile.sourcePath}: absent at launch, present now (new durable state accumulating after the release -- disclosed, never failed)`);
                                }
                                continue;
                        }
                        if (freshFile === undefined) {
                                reasons.push(`${pinnedFile.sourcePath}: the re-read did not enumerate the pinned file (the surface registry moved underneath the acceptance)`);
                                continue;
                        }
                        if (pinnedFile.detectedVersion !== undefined && freshFile.detectedVersion !== pinnedFile.detectedVersion) {
                                reasons.push(`${pinnedFile.sourcePath}: the detected format version changed (launch '${pinnedFile.detectedVersion}' -> now '${String(freshFile.detectedVersion)}') -- the released state was migrated under the acceptance`);
                        }
                        if (pinnedFile.problem === undefined && freshFile.problem !== undefined) {
                                reasons.push(`${pinnedFile.sourcePath}: clean at launch, TORN now (${freshFile.problem})`);
                        }
                        if (pinnedFile.bytes !== undefined && freshFile.bytes !== undefined && freshFile.bytes < pinnedFile.bytes) {
                                reasons.push(`${pinnedFile.sourcePath}: the released state SHRANK (launch ${String(pinnedFile.bytes)} bytes -> now ${String(freshFile.bytes)} bytes -- an append-only surface never shrinks lawfully)`);
                        } else if (pinnedFile.bytes !== undefined && freshFile.bytes !== undefined && freshFile.bytes > pinnedFile.bytes) {
                                growthDisclosed.push(`${pinnedFile.sourcePath}: grew after the launch (${String(pinnedFile.bytes)} -> ${String(freshFile.bytes)} bytes; append-only growth -- disclosed, never failed)`);
                        }
                }
        }
        return { reasons, growthDisclosed };
}

// ---------------------------------------------------------------------------
// The verify arguments + result
// ---------------------------------------------------------------------------

/** The verify command's typed arguments (commands carry DATA only). */
export interface VerifyArgs {
        readonly acceptanceId: string;
        readonly actor: string;
}

/** Parses + validates the verify arguments (the typed refusal surface). */
export function parseVerifyArgs(arg: unknown): VerifyArgs {
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.verify: the argument must be { acceptanceId, actor }');
        }
        const record = arg as Record<string, unknown>;
        if (!isAcceptanceId(record.acceptanceId)) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.verify: acceptanceId must match the flauz:acc:<16-hex> shape (the acceptance whose released state is verified)');
        }
        if (typeof record.actor !== 'string' || record.actor.length === 0) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.verify: actor must be a non-empty string (the operator id firing the verification; never contents)');
        }
        return { acceptanceId: record.acceptanceId, actor: record.actor };
}

/** The verify outcome (command-level). */
export interface VerifyResult {
        readonly ok: true;
        readonly acceptanceId: string;
        readonly verdict: 'pass' | 'fail';
        readonly evidenceLabel: EvidenceLabel;
        readonly row: VerificationRow;
        readonly persisted: PersistedReceipt;
}

/** The persisted outcome. */
export interface PersistedReceipt {
        readonly journalPath: string;
        readonly row: VerificationRow;
        readonly banking: BankingOutcome;
}

/** The verification journal's workspace-relative path for one acceptance. */
export function verificationJournalPath(acceptanceId: string): string {
        return joinPath(ACCEPTANCE_DIR, `verify-${acceptanceId}.jsonl`);
}

// ---------------------------------------------------------------------------
// The verify act (the closing receipt)
// ---------------------------------------------------------------------------

/**
 * Re-runs the named owning checks against the released state and banks the
 * closing receipt -- pass or FAIL, both typed, both banked (the
 * post-release-acceptance law).
 */
export async function verifyAcceptance(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, args: VerifyArgs): Promise<VerifyResult> {
        const ledgerState = await readAcceptanceLedger(deps.root, deps.fs);
        if (ledgerState.state === 'torn') {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_FORMAT', `flauz.acceptance.verify: REFUSED -- the acceptance ledger is torn (${ledgerState.reason}); a verification would silently erase the torn evidence -- route to the operator`);
        }
        const record: AcceptanceRecord | undefined = ledgerState.state === 'resolved' ? ledgerState.record.acceptances.find(row => row.acceptanceId === args.acceptanceId) : undefined;
        if (record === undefined) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_UNKNOWN_ACCEPTANCE', `flauz.acceptance.verify: REFUSED -- the acceptance id '${args.acceptanceId}' is not in the ledger (${ledgerState.state === 'resolved' ? 'the ledger resolved; the id is unknown' : 'the ledger is absent'}; launch it with flauz.acceptance.launch first)`);
        }
        const latest = record.revisions[record.revisions.length - 1] as AcceptanceRevision;

        const checks: VerificationCheckRow[] = [];

        // --- the named owning checks (the checklist row kinds + the named regression test) ---
        for (const check of latest.owningChecks) {
                if (check.source === 'checklist-row' && check.selfEvaluable) {
                        // the ONE genuinely re-run checklist row: re-read the bound artifact + re-derive its checklistId
                        // (exactly the row's own observable -- "the artifact persisted workspace-locally, re-read, and its
                        // checklistId re-derived over the re-read bytes")
                        const state = await readChecklistArtifact(deps.root, deps.fs, latest.checklistPath);
                        if (state.state === 'absent') {
                                checks.push({
                                        checkId: check.checkId,
                                        source: 'checklist-row',
                                        verdict: 'fail',
                                        evidenceLabel: 'local-real',
                                        owningSurface: 'flauz.acceptance.verify (the re-read + the checklistId re-derivation over the bound artifact)',
                                        detail: 'the bound checklist artifact is ABSENT in the released state -- the release identity was destroyed after the launch',
                                        reasons: [`the bound artifact '${latest.checklistPath}' no longer reads back`],
                                });
                        } else if (state.state === 'torn') {
                                checks.push({
                                        checkId: check.checkId,
                                        source: 'checklist-row',
                                        verdict: 'fail',
                                        evidenceLabel: 'local-real',
                                        owningSurface: 'flauz.acceptance.verify (the re-read + the checklistId re-derivation over the bound artifact)',
                                        detail: 'the bound checklist artifact is TORN in the released state -- the release identity no longer verifies',
                                        reasons: [state.reason],
                                });
                        } else {
                                const rederived = state.artifact.checklistId;
                                checks.push({
                                        checkId: check.checkId,
                                        source: 'checklist-row',
                                        verdict: rederived === latest.checklistId ? 'pass' : 'fail',
                                        evidenceLabel: 'local-real',
                                        owningSurface: 'flauz.acceptance.verify (the re-read + the checklistId re-derivation over the bound artifact)',
                                        detail: rederived === latest.checklistId
                                                ? 'the bound checklist artifact re-reads and its checklistId re-derives over the re-read bytes (the release identity intact)'
                                                : 'the bound checklist artifact re-reads but its checklistId does NOT re-derive over the re-read bytes (the release identity was tampered after the launch)',
                                        reasons: rederived === latest.checklistId ? [] : [`launch checklistId ${latest.checklistId} != re-derived ${rederived}`],
                                });
                        }
                        continue;
                }
                // the honest-scope carve-out: a TYPED DISCLOSURE row naming the owning surface (never a silent green)
                checks.push({
                        checkId: check.checkId,
                        source: check.source,
                        verdict: 'disclosure',
                        owningSurface: check.owningSurface,
                        detail: check.source === 'regression-test'
                                ? 'the acceptance plane cannot execute the named regression test (the repo test lane owns execution); the pinned receipt ref\'s integrity is re-read in the product-state pin row'
                                : 'the acceptance plane cannot invoke another extension\'s command (the boundary law); the row\'s verdict is owned by its named surface',
                        reasons: [],
                });
        }

        // --- the product-state pin (this plane's own check over the released state) ---
        const fresh = await reReadProductState(deps.root, deps.fs);
        const drift = comparePin(latest.pinnedState, fresh);
        const pinReasons = [...drift.reasons];
        if (latest.incidentBinding?.regressionReceiptRef !== undefined) {
                const receiptText = await deps.fs.readFileUtf8(joinPath(deps.root, latest.incidentBinding.regressionReceiptRef));
                if (receiptText === undefined || receiptText.length === 0) {
                        pinReasons.push(`${latest.incidentBinding.regressionReceiptRef}: the pinned regression receipt ref is ABSENT in the released state (the named regression test's banked receipt was destroyed after the launch)`);
                }
        }
        checks.push({
                checkId: 'product-state-pin',
                source: 'product-state-pin',
                verdict: pinReasons.length === 0 ? 'pass' : 'fail',
                evidenceLabel: 'local-real',
                owningSurface: 'flauz.acceptance.verify (the pinned product state re-read: presence + detected format version + parse cleanliness)',
                detail: pinReasons.length === 0
                        ? `every pinned surface re-reads with its launch-time presence + detected format version + parse cleanliness intact (${String(drift.growthDisclosed.length)} lawful growth disclosure(s)${drift.growthDisclosed.length > 0 ? ': ' + drift.growthDisclosed.join('; ') : ''})`
                        : `the released state drifted from the launch pin: ${pinReasons.join('; ')}`,
                reasons: pinReasons,
        });

        // --- the receipt ---
        const at = deps.clock();
        const verdict: 'pass' | 'fail' = checks.some(check => check.verdict === 'fail') ? 'fail' : 'pass';
        const row: VerificationRow = {
                $schema: VERIFICATION_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance-verification',
                extensionId: EXTENSION_ID,
                acceptanceId: args.acceptanceId,
                seq: 0, // assigned by the journal append below
                timestampEpoch: at,
                timestampIso: toIsoStamp(at),
                actor: args.actor,
                verdict,
                evidenceLabel: 'local-real',
                checks,
                counts: {
                        total: checks.length,
                        pass: checks.filter(check => check.verdict === 'pass').length,
                        fail: checks.filter(check => check.verdict === 'fail').length,
                        disclosure: checks.filter(check => check.verdict === 'disclosure').length,
                },
        };

        const persisted = await persistReceipt(deps, args.acceptanceId, row);
        return { ok: true, acceptanceId: args.acceptanceId, verdict, evidenceLabel: row.evidenceLabel, row: persisted.row, persisted };
}

/** Persists one receipt the W1 way: swept, appended to the journal, banked census-visible. */
async function persistReceipt(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, acceptanceId: string, row: VerificationRow): Promise<PersistedReceipt> {
        const journalState = await readVerificationJournal(deps.root, deps.fs, acceptanceId);
        if (journalState.state === 'torn') {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_FORMAT', `flauz.acceptance.verify: REFUSED -- the verification journal for ${acceptanceId} is torn (${journalState.reason}); an append would silently erase the torn evidence -- route to the operator`);
        }
        const seq = journalState.state === 'resolved' ? journalState.rows.length + 1 : 1;
        const finalRow: VerificationRow = { ...row, seq };
        sweepArtifact(finalRow, 'acceptance-verification-row');
        const rowLine = canonicalJson(finalRow);
        const journalRelPath = verificationJournalPath(acceptanceId);
        const journalPath = joinPath(deps.root, journalRelPath);
        await deps.fs.mkdir(joinPath(deps.root, ACCEPTANCE_DIR));
        const existing = await deps.fs.readFileUtf8(journalPath);
        if (existing === undefined) {
                await deps.fs.writeFile(journalPath, `${rowLine}\n`);
        } else {
                await deps.fs.appendFile(journalPath, `${rowLine}\n`);
        }
        const banking = await bankRecord(deps, finalRow, rowLine, journalRelPath);
        return { journalPath, row: finalRow, banking };
}

/** Renders the closing receipt (the disclosure-first law). */
export function renderVerify(result: VerifyResult): string[] {
        const lines: string[] = [];
        lines.push(`  acceptance: ${result.acceptanceId}`);
        lines.push(`    closing receipt: ${result.verdict.toUpperCase()} (evidence label '${result.evidenceLabel}' from the frozen ladder -- never promoted by wording)`);
        for (const check of result.row.checks) {
                const label = check.evidenceLabel !== undefined ? ` | label '${check.evidenceLabel}'` : ' | NO evidence label (a disclosure is not evidence)';
                lines.push(`    ${check.verdict === 'pass' ? '[PASS    ]' : check.verdict === 'fail' ? '[FAIL    ]' : '[DISCLOSE]'} ${check.checkId} (${check.source})${label}`);
                lines.push(`      owning surface: ${check.owningSurface}`);
                lines.push(`      ${check.detail}`);
                for (const reason of check.reasons) {
                        lines.push(`        - ${reason}`);
                }
        }
        lines.push(`    counts: ${String(result.row.counts.total)} check row(s) -- ${String(result.row.counts.pass)} pass, ${String(result.row.counts.fail)} fail, ${String(result.row.counts.disclosure)} disclosure (a check this plane cannot itself evaluate is a TYPED DISCLOSURE row naming its owning surface, never a silent green)`);
        if (result.verdict === 'fail') {
                lines.push(`    the FAILED receipt is the typed failure record the incidents reopen law consumes (the closed loop never hides a regression): cite ${result.persisted.journalPath} as the reopen evidence`);
        }
        lines.push(`    journal: ${result.persisted.journalPath} (append-only, census-visible: the banked evidence row taskId 'flauz-acceptance'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
        return lines;
}
