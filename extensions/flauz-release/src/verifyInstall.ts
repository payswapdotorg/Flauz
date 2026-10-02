/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The install verification (A-PROD-004-W5 -- the install/update reliability
 * plane): verifies the INSTALLED product state end-to-end, over the REAL
 * surfaces, and persists the verification record workspace-locally
 * (census-visible -- a banked evidence row).
 *
 * THE FIVE CHECK CLASSES (the typed verdict table, green/tampered/torn per
 * class -- the W2 vocabulary):
 *
 *   extensions -- the extension census (productState.ts): every packaged
 *                 extension present + activation-lint clean;
 *   parity     -- the packaging-parity contract (rows vs manifests);
 *   sbom       -- the SBOM component coverage;
 *   census     -- the durable-state surfaces readable (the W1 census runs
 *                 clean: every present row parse-clean, absence honest);
 *   integrity  -- the W2 verify machinery applied to the CURRENT state: the
 *                 current chain verdicts + a FRESH self-export that must
 *                 verify (the export of a chain-broken workspace is still a
 *                 green EXPORT -- the W2 law -- so the current chains are
 *                 folded in: a truncated tail is torn, a broken chain is
 *                 tampered).
 *
 * THE RECORD: `.flauz/release/verify-<stamp>.json` (flauz.release-verify/v1)
 * -- surface SHAPES only (paths, versions, checksums, verdicts, counts),
 * swept fail-closed before write, banked census-visible (taskId
 * 'flauz-release', uri = the record path, sha256 = the artifact bytes), the
 * watermark re-synced so every post-verification integrity verdict stays
 * GREEN.
 */

import {
        type Clock,
        type ReleaseFsPort,
        type VersionsInfo,
        EXTENSION_ID,
        RELEASE_DIR,
        VERIFY_RECORD_PREFIX,
        VERIFY_RECORD_SCHEMA_ID,
        joinPath,
        serializeArtifact,
        sha256Hex,
} from './api.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { collectDurableStateCensus, censusProblems, type DurableStateCensus } from './census.ts';
import { createSelfExport, type ExportResult } from './selfExport.ts';
import { verifySelfExport, type ExportVerification } from './selfVerify.ts';
import { productChecks, readProductState } from './productState.ts';
import { sweepArtifact } from './privacy.ts';
import { bankLedgerRowFor, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

/** The install-verification check classes (the verdict table's rows). */
export type InstallCheckClass = 'extensions' | 'parity' | 'sbom' | 'census' | 'integrity';

/** The typed verdict vocabulary (the W2 grammar). */
export type InstallVerdict = 'green' | 'tampered' | 'torn';

/** One check outcome. */
export interface InstallCheck {
        readonly check: InstallCheckClass;
        readonly verdict: InstallVerdict;
        readonly reasons: readonly string[];
        readonly counts: Record<string, unknown>;
}

/** The self-export receipt carried by the result + the record. */
export interface SelfExportReceipt {
        readonly exportDirName: string;
        readonly fileCount: number;
        readonly totalBytes: number;
        readonly manifestSha256: string;
        readonly surfaces: readonly { readonly surface: string; readonly present: boolean; readonly fileCount: number }[];
        readonly verified: boolean;
}

/** The whole install-verification result (the `flauz.release.verify` surface). */
export interface InstallVerificationResult {
        readonly ok: boolean;
        readonly createdAt: number;
        readonly productRoot: string;
        readonly checks: readonly InstallCheck[];
        readonly selfExport: SelfExportReceipt;
        readonly chainVerdicts: IntegrityVerdicts;
        readonly census: DurableStateCensus;
}

/** Deps of the install verification. */
export interface VerifyInstallDeps {
        readonly root: string;
        readonly fs: ReleaseFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** The repo-state product root (the caller's typed refusal owns the absent case). */
        readonly productRoot: string;
}

function worse(a: InstallVerdict, b: InstallVerdict): InstallVerdict {
        if (a === 'tampered' || b === 'tampered') {
                return 'tampered';
        }
        if (a === 'torn' || b === 'torn') {
                return 'torn';
        }
        return 'green';
}

/**
 * The current-state chain classification: ok -> green; the interrupted-write
 * shapes (the watermark's truncated flag, an unparseable/torn ledger line,
 * a torn ops tail) -> torn; anything else (a mutated payload, a forged row,
 * a chain break that still parses) -> tampered.
 */
function currentChainsVerdict(verdicts: IntegrityVerdicts): InstallVerdict {
        const ledger = verdicts.evidenceLedger;
        const ops = verdicts.opsChain;
        if (ledger.ok && ops.ok) {
                return 'green';
        }
        const tornShaped = ledger.truncated === true
                || (ledger.reason !== undefined && (ledger.reason.includes('not valid JSON') || ledger.reason.includes('is empty')))
                || ops.problems.some(problem => problem.message.includes('torn') || problem.message.includes('truncated'));
        return tornShaped ? 'torn' : 'tampered';
}

/** The fresh self-export verification mapped onto the typed verdict vocabulary. */
function selfExportVerdict(verification: ExportVerification): InstallVerdict {
        if (verification.ok) {
                return 'green';
        }
        let verdict: InstallVerdict = 'tampered';
        if (verification.metadata.verdict === 'torn') {
                verdict = worse(verdict, 'torn');
        }
        for (const surface of verification.surfaces) {
                if (surface.verdict === 'torn') {
                        verdict = worse(verdict, 'torn');
                }
        }
        return verdict;
}

/**
 * Runs the install verification end-to-end. Cuts a FRESH self-export (the
 * integrity class's W2 machinery -- the only write this function performs)
 * and verifies it; never persists the record (the caller owns persistence).
 */
export async function verifyInstall(deps: VerifyInstallDeps): Promise<InstallVerificationResult> {
        const createdAt = deps.clock();
        const checks: InstallCheck[] = [];

        // --- the product half: extensions census + parity contract + SBOM coverage ---
        const product = await readProductState(deps.productRoot, deps.fs);
        if (product === undefined) {
                // the caller owns the typed refusal; defensively surfaced here as a torn product class
                checks.push({ check: 'extensions', verdict: 'torn', reasons: [`${deps.productRoot} carries no extensions/ directory -- not a repo-state product`], counts: {} });
        } else {
                checks.push(...productChecks(product));
        }

        // --- the census class: the durable-state surfaces readable (the W1 census runs clean) ---
        const census = await collectDurableStateCensus(deps.root, deps.fs);
        const problems = censusProblems(census);
        const presentRowCount = Object.values(census).filter(row => row.present).length;
        checks.push({
                check: 'census',
                verdict: problems.length === 0 ? 'green' : 'torn',
                reasons: problems.map(problem => `${problem.row}: ${problem.problem}`),
                counts: {
                        presentRowCount,
                        absentRowCount: Object.keys(census).length - presentRowCount,
                        problemCount: problems.length,
                },
        });

        // --- the integrity class: the W2 verify machinery applied to the CURRENT state ---
        const chainVerdicts = await collectIntegrity(deps.root, deps.fs);
        const exportResult: ExportResult = await createSelfExport({ root: deps.root, fs: deps.fs, clock: deps.clock, versions: deps.versions }, 'flauz.release.verify');
        const verification = await verifySelfExport({ root: deps.root, fs: deps.fs }, exportResult.exportDirName);
        const manifestText = await deps.fs.readFileUtf8(joinPath(exportResult.exportDir, 'MANIFEST.json'));
        const integrityVerdict = worse(currentChainsVerdict(chainVerdicts), selfExportVerdict(verification));
        const integrityReasons: string[] = [];
        if (!chainVerdicts.evidenceLedger.ok) {
                integrityReasons.push(`the current-state ledger chain is not ok: ${chainVerdicts.evidenceLedger.reason ?? 'chain verification failed'}`);
        }
        if (!chainVerdicts.opsChain.ok) {
                integrityReasons.push(`the current-state ops chain is not ok: ${chainVerdicts.opsChain.problems.map(problem => problem.message).join('; ')}`);
        }
        if (!verification.ok) {
                integrityReasons.push(`the fresh self-export does not verify: metadata ${String(verification.metadata.verdict)}; ${verification.surfaces.filter(surface => surface.verdict !== 'green').map(surface => `${String(surface.surface)} ${surface.verdict}`).join(', ')}`);
        }
        checks.push({
                check: 'integrity',
                verdict: integrityVerdict,
                reasons: integrityReasons,
                counts: {
                        ledgerRows: chainVerdicts.evidenceLedger.rows,
                        opsRecords: chainVerdicts.opsChain.records,
                        selfExportOk: verification.ok,
                },
        });

        const selfExport: SelfExportReceipt = {
                exportDirName: exportResult.exportDirName,
                fileCount: exportResult.fileCount,
                totalBytes: exportResult.totalBytes,
                manifestSha256: manifestText !== undefined ? sha256Hex(manifestText) : '',
                surfaces: exportResult.surfaces.map(surface => ({ surface: String(surface.surface), present: surface.present, fileCount: surface.fileCount })),
                verified: verification.ok,
        };

        sweepArtifact(selfExport, 'self-export-receipt');

        return {
                ok: checks.every(check => check.verdict === 'green'),
                createdAt,
                productRoot: deps.productRoot,
                checks,
                selfExport,
                chainVerdicts,
                census,
        };
}

// ---------------------------------------------------------------------------
// The persisted record
// ---------------------------------------------------------------------------

/** The verification record body (`.flauz/release/verify-<stamp>.json`). */
export interface InstallVerificationRecord {
        readonly $schema: typeof VERIFY_RECORD_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: typeof EXTENSION_ID;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly productRoot: string;
        readonly commandLine: 'flauz.release.verify';
        readonly ok: boolean;
        readonly checks: readonly InstallCheck[];
        readonly selfExport: SelfExportReceipt;
        readonly chainVerdicts: IntegrityVerdicts;
        readonly censusRowCounts: Record<string, unknown>;
        readonly privacyLaw: string;
}

/** The filename-safe stamp of a verification record (the export-stamp convention). */
export function verifyRecordStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The persisted outcome. */
export interface PersistedVerification {
        readonly recordPath: string;
        readonly record: InstallVerificationRecord;
        readonly banking: BankingOutcome;
}

/**
 * Persists the verification record workspace-locally + banks it
 * census-visible: sweeps the record (fail-closed), writes
 * `.flauz/release/verify-<stamp>.json` (DL-9 serialization), then appends the
 * evidence-ledger note row (uri = the record path, sha256 = the artifact
 * bytes) with the watermark re-sync.
 */
export async function persistInstallVerification(deps: { root: string; fs: ReleaseFsPort; clock: Clock }, versions: VersionsInfo, result: InstallVerificationResult): Promise<PersistedVerification> {
        const record: InstallVerificationRecord = {
                $schema: VERIFY_RECORD_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: result.createdAt,
                productName: versions.productName,
                productVersion: versions.productVersion,
                extensionId: EXTENSION_ID,
                extensionVersion: versions.extensions.find(extension => extension.id === EXTENSION_ID)?.version ?? 'unknown',
                workspaceRoot: deps.root,
                productRoot: result.productRoot,
                commandLine: 'flauz.release.verify',
                ok: result.ok,
                checks: result.checks,
                selfExport: result.selfExport,
                chainVerdicts: result.chainVerdicts,
                censusRowCounts: {
                        presentRowCount: Object.values(result.census).filter(row => row.present).length,
                        absentRowCount: Object.keys(result.census).length - Object.values(result.census).filter(row => row.present).length,
                },
                privacyLaw: 'METADATA-ONLY: surface shapes (paths, versions, checksums, verdicts, counts) -- never contents; swept for secret-shaped values before write. The one content-carrying artifact is the fresh self-export\'s state/ copy (the W2 machinery, byte-identical by construction -- a backup\'s job, exempt by the W2 law).',
        };
        sweepArtifact(record, 'verification-record');
        const recordText = serializeArtifact(record);
        const dirName = `${VERIFY_RECORD_PREFIX}${verifyRecordStamp(result.createdAt)}`;
        const recordPath = joinPath(deps.root, RELEASE_DIR, `${dirName}.json`);
        await deps.fs.mkdir(joinPath(deps.root, RELEASE_DIR));
        await deps.fs.writeFile(recordPath, recordText);
        const banking = await bankLedgerRowFor({ root: deps.root, fs: deps.fs, clock: deps.clock }, recordText, joinPath(RELEASE_DIR, `${dirName}.json`));
        return { recordPath, record, banking };
}

/** Renders the typed verdict table (the `flauz.release.verify` channel surface). */
export function renderInstallVerification(result: InstallVerificationResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.release.verify: the install verification -- verdict ${result.ok ? 'GREEN (the installed product state verifies end-to-end)' : 'REFUSED (the installed product state does not verify)'}`);
        lines.push(`  product state: ${result.productRoot} (the repo-state product -- the runtime-installed-product angle is A-PROD-005's production-readiness lane)`);
        lines.push('  check verdicts:');
        for (const check of result.checks) {
                const summary = check.reasons.length > 0 ? ` -- ${check.reasons.join('; ')}` : '';
                const counts = Object.entries(check.counts).map(([key, value]) => `${key}=${String(value)}`).join(' ');
                lines.push(`    ${check.verdict.padEnd(8)} ${check.check.padEnd(11)}${counts.length > 0 ? ` (${counts})` : ''}${summary}`);
        }
        const ledger = result.chainVerdicts.evidenceLedger;
        const ops = result.chainVerdicts.opsChain;
        lines.push(`  fresh self-export: ${result.selfExport.exportDirName} (${String(result.selfExport.fileCount)} file(s), ${String(result.selfExport.totalBytes)} bytes, manifest ${result.selfExport.manifestSha256.slice(0, 12)}...) -- ${result.selfExport.verified ? 'verifies GREEN' : 'DOES NOT VERIFY'}`);
        lines.push(`  current-state chain verdicts: ledger ${ledger.ok ? 'ok' : 'BROKEN'} (${String(ledger.rows)} rows), ops ${ops.ok ? 'ok' : 'BROKEN'} (${String(ops.records)} records)`);
        return lines;
}
