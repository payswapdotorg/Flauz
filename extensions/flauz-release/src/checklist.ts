/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The release checklist (A-PROD-004-W5 -- the beta gate's closure evidence):
 * the one-command go/no-go that binds ALL TEN beta capabilities, every row
 * carrying its evidence pointer (the command + the observable).
 *
 * THE GO/NO-GO LAW: GO only when all ten rows are green; any red/unknown row
 * = NO-GO with the exact failing row. The row verdict vocabulary:
 *   green   -- the capability's live check passed over the real state;
 *   red     -- the check ran and failed (the exact reason is the row's);
 *   unknown -- the check could not resolve (the telemetry opt-in state that
 *              cannot be known because the config is corrupt; the install
 *              verification with no repo-state product in the workspace) --
 *              NO-GO, never silently green.
 *
 * THE TEN ROWS (each consults its capability through the contract-duplicated
 * machinery -- src never crosses extension boundaries; the evidence pointer
 * names the OWNING command + its observable):
 *   1. diagnostics    -- the W1 census runs clean (flauz.diag.show);
 *   2. backup         -- a fresh self-export verifies green (flauz.backup.export/verify);
 *   3. crashRecovery  -- the verify-first restore drill resolves over the fresh export (flauz.backup.restore);
 *   4. migration      -- the W3 plan path is clear (flauz.migration.plan);
 *   5. telemetry      -- the opt-in state is knowable (flauz.telemetry.config);
 *   6. failureTyping  -- the typed failure taxonomy is loaded + closed (flauz.failures.list);
 *   7. rollback       -- a verified rollback anchor is available (flauz.migration.execute / flauz.backup.verify);
 *   8. supportBundle  -- the support/debug bundle is generatable (flauz.diag.bundle);
 *   9. installVerification -- the install verification is green (flauz.release.verify);
 *  10. checklistArtifact -- this artifact itself, persisted + re-readable (flauz.release.checklist).
 *
 * THE ARTIFACT: `.flauz/release/checklist-<stamp>.json`
 * (flauz.release-checklist/v1) -- the release record the operator signs off.
 * checklistId = sha256 over the canonical body minus checklistId; the row-10
 * verdict is green only after the persist + re-read + re-derive cycle
 * succeeds (the prediction is verified, never assumed). The artifact is
 * swept fail-closed, banked census-visible (taskId 'flauz-release'), and the
 * watermark re-synced.
 */

import {
        type Clock,
        type ReleaseFsPort,
        type VersionsInfo,
        CHECKLIST_PREFIX,
        CHECKLIST_SCHEMA_ID,
        EXTENSION_ID,
        RELEASE_DIR,
        canonicalJson,
        joinPath,
        serializeArtifact,
        sha256Hex,
} from './api.ts';
import { collectDurableStateCensus, censusProblems, type DurableStateCensus } from './census.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { createSelfExport, enumerateForDisclosure, renderExportDisclosure, type ExportResult } from './selfExport.ts';
import { verifySelfExport, type ExportVerification } from './selfVerify.ts';
import { readTelemetryConfigState, taxonomyClosure } from './telemetryState.ts';
import { checkUpdateReadiness, type UpdateReadiness } from './updateCheck.ts';
import { productChecks, readProductState } from './productState.ts';
import { sweepArtifact } from './privacy.ts';
import { bankLedgerRowFor, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The row shapes
// ---------------------------------------------------------------------------

/** The checklist row verdict vocabulary (the go/no-go grammar). */
export type ChecklistVerdict = 'green' | 'red' | 'unknown';

/** The row's evidence pointer (the owning command + its observable). */
export interface ChecklistEvidence {
        readonly command: string;
        readonly observable: string;
}

/** One checklist row. */
export interface ChecklistRow {
        readonly id: string;
        readonly title: string;
        readonly verdict: ChecklistVerdict;
        readonly evidence: ChecklistEvidence;
        readonly reasons: readonly string[];
        readonly details: Record<string, unknown>;
}

/** The whole checklist result (the command surface). */
export interface ReleaseChecklistResult {
        readonly verdict: 'GO' | 'NO-GO';
        readonly createdAt: number;
        readonly rows: readonly ChecklistRow[];
        readonly checklistId: string | undefined;
        readonly artifactPath: string | undefined;
        readonly artifactReReadable: boolean;
        readonly banking: BankingOutcome | undefined;
        readonly refusalRows: readonly string[];
}

/** Deps of the checklist. */
export interface ChecklistDeps {
        readonly root: string;
        readonly fs: ReleaseFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** The repo-state product root (undefined = no repo-state product in this workspace -- row 9 turns unknown, the honest NO-GO). */
        readonly productRoot: string | undefined;
}

// ---------------------------------------------------------------------------
// The ten rows
// ---------------------------------------------------------------------------

function row(id: string, title: string, verdict: ChecklistVerdict, evidence: ChecklistEvidence, reasons: readonly string[], details: Record<string, unknown>): ChecklistRow {
        return { id, title, verdict, evidence, reasons, details };
}

// --- row 1: diagnostics census clean ---
function diagnosticsRow(census: DurableStateCensus): ChecklistRow {
        const problems = censusProblems(census);
        const presentRowCount = Object.values(census).filter(entry => entry.present).length;
        return row(
                'diagnostics',
                'diagnostics census clean',
                problems.length === 0 ? 'green' : 'red',
                { command: 'flauz.diag.show', observable: 'the durable-state census: every present row parse-clean, absence honest' },
                problems.map(problem => `${problem.row}: ${problem.problem}`),
                { presentRowCount, absentRowCount: Object.keys(census).length - presentRowCount, problemCount: problems.length },
        );
}

// --- row 2: backup/export verified ---
function backupRow(exportResult: ExportResult | undefined, verification: ExportVerification | undefined, error: unknown): ChecklistRow {
        if (exportResult === undefined || verification === undefined) {
                return row(
                        'backup',
                        'backup/export verified',
                        'red',
                        { command: 'flauz.backup.export + flauz.backup.verify', observable: 'a fresh self-export verifies green against its manifest' },
                        [error instanceof Error ? error.message : String(error)],
                        {},
                );
        }
        const reasons: string[] = [];
        if (verification.metadata.verdict !== 'green') {
                reasons.push(`the self-export metadata verdict is ${String(verification.metadata.verdict)}${verification.metadata.reasons.length > 0 ? ` (${verification.metadata.reasons.join('; ')})` : ''}`);
        }
        for (const surface of verification.surfaces) {
                if (surface.verdict !== 'green') {
                        reasons.push(`${String(surface.surface)} is ${surface.verdict}${surface.reasons.length > 0 ? ` (${surface.reasons.join('; ')})` : ''}`);
                }
        }
        return row(
                'backup',
                'backup/export verified',
                verification.ok ? 'green' : 'red',
                { command: 'flauz.backup.export + flauz.backup.verify', observable: 'a fresh self-export verifies green against its manifest' },
                reasons,
                { exportDirName: exportResult.exportDirName, fileCount: exportResult.fileCount, totalBytes: exportResult.totalBytes },
        );
}

// --- row 3: crash-recovery drill ---
function crashRecoveryRow(census: DurableStateCensus, verification: ExportVerification | undefined, exportDirName: string | undefined): ChecklistRow {
        if (verification === undefined || exportDirName === undefined) {
                return row(
                        'crashRecovery',
                        'crash-recovery readiness',
                        'red',
                        { command: 'flauz.backup.restore', observable: 'the verify-first restore pre-flight resolves over the fresh export' },
                        ['no verified export exists to drill the recovery path against'],
                        {},
                );
        }
        // the restore drill: the verify-first pre-flight (the export verifies) + the
        // restorable-surface enumeration + the consent enumeration (which surfaces
        // would need overwrite consent because their CURRENT targets are non-empty)
        const restorableSurfaces = verification.surfaces.filter(surface => surface.files.some(file => file.receiptPresent)).map(surface => String(surface.surface));
        const consentRequired: string[] = [];
        for (const surfaceId of restorableSurfaces) {
                const censusRow = (census as unknown as Record<string, { present?: boolean }>)[surfaceId];
                if (censusRow?.present === true) {
                        consentRequired.push(surfaceId);
                }
        }
        return row(
                'crashRecovery',
                'crash-recovery readiness',
                verification.ok ? 'green' : 'red',
                { command: 'flauz.backup.restore', observable: 'the verify-first restore pre-flight resolves over the fresh export (restorable surfaces + consent requirement)' },
                verification.ok ? [] : [`the verify-first pre-flight fails over the fresh export (a restore would refuse: verify-first is the W2 law)`],
                { restorableSurfaces, consentRequired, recoveryLogPath: '.flauz/backup/recovery-log.jsonl', exportDirName },
        );
}

// --- row 4: migration plan path clear ---
function migrationRow(readiness: UpdateReadiness): ChecklistRow {
        const counts = {
                identityCount: readiness.surfaces.filter(entry => entry.readiness === 'identity').length,
                transformCount: readiness.surfaces.filter(entry => entry.readiness === 'transform').length,
                absentCount: readiness.surfaces.filter(entry => entry.readiness === 'absent').length,
                refusalCount: readiness.surfaces.filter(entry => entry.readiness === 'refusal').length,
                anchorFeasible: readiness.anchor.feasible,
        };
        return row(
                'migration',
                'migration plan path clear',
                readiness.ok ? 'green' : 'red',
                { command: 'flauz.migration.plan', observable: 'the plan pre-flight: torn-free, every present surface identity/transform, zero refusal surfaces' },
                readiness.refusalReasons,
                counts,
        );
}

// --- row 5: telemetry config resolvable (opt-in state known) ---
function telemetryRow(state: Awaited<ReturnType<typeof readTelemetryConfigState>>): ChecklistRow {
        if (state.state === 'corrupt') {
                return row(
                        'telemetry',
                        'telemetry config resolvable (opt-in state known)',
                        'unknown',
                        { command: 'flauz.telemetry.config', observable: 'the opt-in state resolves (absent = default-off, or the parsed enabled/disabled state)' },
                        [`${state.problem} -- the opt-in state may never be guessed (the W4 law); fix or remove the config and re-inspect`],
                        { state: 'corrupt' },
                );
        }
        return row(
                'telemetry',
                'telemetry config resolvable (opt-in state known)',
                'green',
                { command: 'flauz.telemetry.config', observable: 'the opt-in state resolves (absent = default-off, or the parsed enabled/disabled state)' },
                [],
                state.state === 'absent-default-off'
                        ? { state: 'absent-default-off', enabled: false }
                        : { state: state.enabled ? 'enabled' : 'disabled', enabled: state.enabled, retentionDays: state.retentionDays, ...(state.consentAction !== undefined ? { consentAction: state.consentAction } : {}) },
        );
}

// --- row 6: provider/env failure typing loaded ---
function failureTypingRow(): ChecklistRow {
        const closure = taxonomyClosure();
        return row(
                'failureTyping',
                'provider/env failure typing loaded',
                closure.closed ? 'green' : 'red',
                { command: 'flauz.failures.list', observable: 'the typed failure taxonomy loads closed (every provider/environment source code typed exactly once)' },
                closure.problems,
                { classCount: closure.classCount, sourceCodeCount: closure.sourceCodeCount },
        );
}

// --- row 7: rollback anchor available ---
function rollbackRow(verification: ExportVerification | undefined, exportDirName: string | undefined, readiness: UpdateReadiness, error: unknown): ChecklistRow {
        if (verification === undefined || exportDirName === undefined) {
                return row(
                        'rollback',
                        'rollback anchor available',
                        'red',
                        { command: 'flauz.migration.execute + flauz.backup.verify', observable: 'a verified rollback anchor exists (the newest export verifies; the anchor dry-run is feasible)' },
                        [error instanceof Error ? error.message : String(error), 'no anchor exists and the dry-run cannot substitute for one'],
                        { anchorFeasible: readiness.anchor.feasible },
                );
        }
        return row(
                'rollback',
                'rollback anchor available',
                verification.ok && readiness.anchor.feasible ? 'green' : 'red',
                { command: 'flauz.migration.execute + flauz.backup.verify', observable: 'a verified rollback anchor exists (the newest export verifies; the anchor dry-run is feasible)' },
                verification.ok ? [] : [`the newest export (the anchor candidate) does not verify: metadata ${String(verification.metadata.verdict)}; ${verification.surfaces.filter(surface => surface.verdict !== 'green').map(surface => `${String(surface.surface)} ${surface.verdict}`).join(', ')}`],
                { anchorDirName: exportDirName, verified: verification.ok, anchorFeasible: readiness.anchor.feasible },
        );
}

// --- row 8: support/debug bundle generatable ---
function supportBundleRow(census: DurableStateCensus): ChecklistRow {
        const problems = censusProblems(census);
        return row(
                'supportBundle',
                'support/debug bundle generatable',
                problems.length === 0 ? 'green' : 'red',
                { command: 'flauz.diag.bundle', observable: 'every bundle artifact class input resolves over the current state (the census rows parse-clean; the versions block is wired)' },
                problems.map(problem => `${problem.row}: ${problem.problem} -- the bundle's input for that class would fail`),
                {
                        inputClasses: 5,
                        problemCount: problems.length,
                        providerLanesState: census.providerLanesState.present ? 'present' : 'absent',
                        ledgerRowCount: typeof census.evidenceLedger.rowCount === 'number' ? census.evidenceLedger.rowCount : 0,
                },
        );
}

// --- row 9: install verification green ---
function installVerificationRow(productRoot: string | undefined, deps: ChecklistDeps, census: DurableStateCensus, chains: IntegrityVerdicts, exportVerification: ExportVerification | undefined): Promise<ChecklistRow> {
        return (async () => {
                const evidence: ChecklistEvidence = { command: 'flauz.release.verify', observable: 'the install verification record (all five check classes green)' };
                if (productRoot === undefined) {
                        return row(
                                'installVerification',
                                'install verification green',
                                'unknown',
                                evidence,
                                ['no repo-state product in this workspace -- the install verification runs against the repo-state product (this wave\'s evidence law); the runtime-installed-product angle is A-PROD-005\'s production-readiness lane'],
                                {},
                        );
                }
                const product = await readProductState(productRoot, deps.fs);
                if (product === undefined) {
                        return row(
                                'installVerification',
                                'install verification green',
                                'unknown',
                                evidence,
                                [`${productRoot} carries no extensions/ directory -- not a repo-state product`],
                                {},
                        );
                }
                const checks: { check: string; verdict: string; reasons: readonly string[]; counts: Record<string, unknown> }[] = productChecks(product).map(check => ({ check: String(check.check), verdict: String(check.verdict), reasons: check.reasons, counts: check.counts }));
                // the census class + the integrity class (the same five classes flauz.release.verify runs)
                const problems = censusProblems(census);
                checks.push({
                        check: 'census',
                        verdict: problems.length === 0 ? 'green' : 'torn',
                        reasons: problems.map(problem => `${problem.row}: ${problem.problem}`),
                        counts: { problemCount: problems.length },
                });
                const ledgerOk = chains.evidenceLedger.ok;
                const opsOk = chains.opsChain.ok;
                const exportOk = exportVerification?.ok ?? false;
                checks.push({
                        check: 'integrity',
                        verdict: ledgerOk && opsOk && exportOk ? 'green' : 'tampered',
                        reasons: [
                                ...(ledgerOk ? [] : [`the current-state ledger chain is not ok: ${chains.evidenceLedger.reason ?? 'chain verification failed'}`]),
                                ...(opsOk ? [] : [`the current-state ops chain is not ok: ${chains.opsChain.problems.map(problem => problem.message).join('; ')}`]),
                                ...(exportOk ? [] : ['the fresh self-export does not verify']),
                        ],
                        counts: { ledgerRows: chains.evidenceLedger.rows, opsRecords: chains.opsChain.records },
                });
                const failing = checks.filter(check => check.verdict !== 'green');
                return row(
                        'installVerification',
                        'install verification green',
                        failing.length === 0 ? 'green' : 'red',
                        evidence,
                        failing.map(check => `the '${String(check.check)}' check class is ${String(check.verdict)}${check.reasons.length > 0 ? ` (${check.reasons.join('; ')})` : ''}`),
                        { productRoot, checks: checks.map(check => ({ check: String(check.check), verdict: String(check.verdict) })) },
                );
        })();
}

// --- row 10: the checklist artifact itself ---
function checklistArtifactRow(artifactReReadable: boolean, reasons: readonly string[], artifactPath: string | undefined): ChecklistRow {
        return row(
                'checklistArtifact',
                'the checklist artifact persisted with the full verdict table',
                artifactReReadable ? 'green' : 'red',
                { command: 'flauz.release.checklist', observable: 'the artifact persisted workspace-locally, re-read, and its checklistId re-derived over the re-read bytes' },
                reasons,
                artifactPath !== undefined ? { artifactPath } : {},
        );
}

// ---------------------------------------------------------------------------
// The artifact
// ---------------------------------------------------------------------------

/** The checklist artifact body (`.flauz/release/checklist-<stamp>.json`). */
export interface ReleaseChecklistArtifact {
        readonly $schema: typeof CHECKLIST_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly checklistId: string;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: typeof EXTENSION_ID;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly commandLine: 'flauz.release.checklist';
        readonly verdict: 'GO' | 'NO-GO';
        readonly rows: readonly ChecklistRow[];
        readonly privacyLaw: string;
}

/** The checklist id: sha256 over the canonical body minus checklistId. */
export function checklistIdOf(artifact: Omit<ReleaseChecklistArtifact, 'checklistId'>): string {
        return sha256Hex(canonicalJson(artifact));
}

/** The filename-safe stamp of a checklist artifact (the export-stamp convention). */
export function checklistStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

// ---------------------------------------------------------------------------
// The whole go/no-go
// ---------------------------------------------------------------------------

/**
 * Runs the release checklist: the ten rows over the real state, the fresh
 * self-export (row 2's backup machinery -- the checklist's one state-shaping
 * side effect besides its own artifact + banking), the artifact persist +
 * re-read + re-derive cycle, and the census-visible banking.
 */
export async function runChecklist(deps: ChecklistDeps): Promise<ReleaseChecklistResult> {
        const createdAt = deps.clock();

        // --- the shared consultations ---
        const census = await collectDurableStateCensus(deps.root, deps.fs);
        const chains = await collectIntegrity(deps.root, deps.fs);
        const readiness = await checkUpdateReadiness({ root: deps.root, fs: deps.fs, clock: deps.clock, versions: deps.versions });
        const telemetryState = await readTelemetryConfigState(deps.root, deps.fs);

        // --- row 2's fresh self-export (cut + verify; the disclosure law renders first at the command layer) ---
        let exportResult: ExportResult | undefined;
        let exportVerification: ExportVerification | undefined;
        let exportError: unknown;
        try {
                exportResult = await createSelfExport({ root: deps.root, fs: deps.fs, clock: deps.clock, versions: deps.versions }, 'flauz.release.checklist');
                exportVerification = await verifySelfExport({ root: deps.root, fs: deps.fs }, exportResult.exportDirName);
        } catch (err) {
                exportError = err;
        }

        // --- rows 1-9 ---
        const rows: ChecklistRow[] = [
                diagnosticsRow(census),
                backupRow(exportResult, exportVerification, exportError),
                crashRecoveryRow(census, exportVerification, exportResult?.exportDirName),
                migrationRow(readiness),
                telemetryRow(telemetryState),
                failureTypingRow(),
                rollbackRow(exportVerification, exportResult?.exportDirName, readiness, exportError),
                supportBundleRow(census),
        ];
        rows.push(await installVerificationRow(deps.productRoot, deps, census, chains, exportVerification));

        // --- row 10 + the artifact persist + re-read + re-derive cycle ---
        const draftRows = [...rows, checklistArtifactRow(true, ['the checklist artifact was persisted workspace-locally, re-read, and its checklistId re-derived over the re-read bytes'], undefined)];
        const artifactBody: Omit<ReleaseChecklistArtifact, 'checklistId'> = {
                $schema: CHECKLIST_SCHEMA_ID,
                schemaVersion: 0,
                createdAt,
                productName: deps.versions.productName,
                productVersion: deps.versions.productVersion,
                extensionId: EXTENSION_ID,
                extensionVersion: deps.versions.extensions.find(extension => extension.id === EXTENSION_ID)?.version ?? 'unknown',
                workspaceRoot: deps.root,
                commandLine: 'flauz.release.checklist',
                verdict: draftRows.every(entry => entry.verdict === 'green') ? 'GO' : 'NO-GO',
                rows: draftRows,
                privacyLaw: 'METADATA-ONLY: surface shapes (paths, versions, checksums, verdicts, counts) -- never contents; swept for secret-shaped values before write. The one content-carrying artifact is the fresh self-export\'s state/ copy (the W2 machinery, byte-identical by construction -- a backup\'s job, exempt by the W2 law).',
        };
        sweepArtifact(artifactBody, 'checklist-artifact');
        const checklistId = checklistIdOf(artifactBody);
        const artifact: ReleaseChecklistArtifact = { ...artifactBody, checklistId };
        const stamp = checklistStamp(createdAt);
        const artifactRelPath = joinPath(RELEASE_DIR, `${CHECKLIST_PREFIX}${stamp}.json`);
        const artifactPath = joinPath(deps.root, artifactRelPath);
        const artifactText = serializeArtifact(artifact);

        let artifactReReadable = false;
        let reReadReasons: readonly string[] = [];
        let banking: BankingOutcome | undefined;
        try {
                await deps.fs.mkdir(joinPath(deps.root, RELEASE_DIR));
                await deps.fs.writeFile(artifactPath, artifactText);
                // the re-read + re-derive cycle: the artifact must parse and its checklistId must re-derive over the re-read bytes
                const reReadText = await deps.fs.readFileUtf8(artifactPath);
                if (reReadText !== artifactText) {
                        reReadReasons = ['the re-read artifact bytes differ from the written bytes'];
                } else {
                        const reRead = JSON.parse(reReadText) as Record<string, unknown>;
                        const { checklistId: reReadId, ...body } = reRead;
                        if (reReadId !== checklistId || checklistIdOf(body as Omit<ReleaseChecklistArtifact, 'checklistId'>) !== checklistId) {
                                reReadReasons = ['the re-read artifact\'s checklistId does not re-derive over the re-read bytes'];
                        } else {
                                artifactReReadable = true;
                        }
                }
                banking = await bankLedgerRowFor({ root: deps.root, fs: deps.fs, clock: deps.clock }, artifactText, artifactRelPath);
        } catch (err) {
                reReadReasons = [`the artifact persist/re-read cycle failed: ${err instanceof Error ? err.message : String(err)}`];
        }

        const finalRows = [...rows, checklistArtifactRow(artifactReReadable, reReadReasons, artifactReReadable ? artifactPath : undefined)];
        const verdict: 'GO' | 'NO-GO' = finalRows.every(entry => entry.verdict === 'green') ? 'GO' : 'NO-GO';
        const refusalRows = finalRows.filter(entry => entry.verdict !== 'green').map(entry => `${entry.id} (${entry.verdict})`);

        // if the persist failed after a write, the on-disk artifact claims row 10 green (the prediction);
        // rewrite it with the truthful red row when possible (best-effort repair)
        if (!artifactReReadable && banking === undefined && reReadReasons.length > 0 && !reReadReasons.some(reason => reason.includes('cycle failed'))) {
                try {
                        const repaired = { ...artifact, rows: finalRows, verdict };
                        await deps.fs.writeFile(artifactPath, serializeArtifact({ ...repaired, checklistId: checklistIdOf(repaired) }));
                } catch {
                        // best-effort: the returned result carries the truthful red row regardless
                }
        }

        return {
                verdict,
                createdAt,
                rows: finalRows,
                checklistId: artifactReReadable ? checklistId : undefined,
                artifactPath: artifactReReadable ? artifactPath : undefined,
                artifactReReadable,
                banking,
                refusalRows,
        };
}

/** The pre-export disclosure enumeration (the command layer renders it before row 2 cuts the export; the stamp is the preview tick). */
export async function checklistDisclosure(deps: { root: string; fs: ReleaseFsPort; clock: Clock }): Promise<readonly string[]> {
        const surfaces = await enumerateForDisclosure(deps.root, deps.fs);
        const stamp = checklistStamp(deps.clock());
        return renderExportDisclosure(surfaces, stamp);
}

/** Renders the checklist (the `flauz.release.checklist` channel surface). */
export function renderChecklist(result: ReleaseChecklistResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.release.checklist: the beta gate go/no-go -- verdict ${result.verdict}`);
        const markers: Record<ChecklistVerdict, string> = { green: '[GREEN ]', red: '[RED   ]', unknown: '[UNKNOWN]' };
        for (const [index, entry] of result.rows.entries()) {
                const evidence = `evidence: ${entry.evidence.command} (${entry.evidence.observable})`;
                const details = Object.entries(entry.details).map(([key, value]) => `${key}=${String(value)}`).join(' ');
                lines.push(`  ${markers[entry.verdict]} ${String(index + 1).padStart(2)}. ${entry.id.padEnd(21)} -- ${entry.title}${details.length > 0 ? ` (${details})` : ''}`);
                lines.push(`            ${evidence}`);
                for (const reason of entry.reasons) {
                        lines.push(`            - ${reason}`);
                }
        }
        lines.push(`  overall: ${result.verdict}${result.refusalRows.length > 0 ? ` -- the failing row(s): ${result.refusalRows.join(', ')}` : ' (all ten rows green)'}`);
        if (result.artifactPath !== undefined) {
                lines.push(`  artifact: ${result.artifactPath}${result.checklistId !== undefined ? ` (checklistId ${result.checklistId.slice(0, 12)}..., re-readable)` : ''}`);
        } else {
                lines.push('  artifact: NOT PERSISTED (the persist/re-read cycle failed -- the row-10 verdict carries the reason)');
        }
        return lines;
}
