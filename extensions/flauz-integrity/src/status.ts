/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The read-only state view (A-PROD-005-W2): `flauz.integrity.status`.
 *
 * THE READ-ONLY LAW: this command changes NO state -- no record is written,
 * nothing is banked, the key store is only PEEKED (never generated: the
 * getOrCreate path is the sign command's alone). It renders the signing
 * plane's current posture: the pinned artifact count (from the manifest), the
 * signed coverage (from the latest ledger), the key fingerprint, and the last
 * verify verdict summary (from the latest verify record).
 */

import {
        type IntegrityFsPort,
        type KeyPort,
        type KeyPeekOutcome,
        type BundleManifest,
        INTEGRITY_DIR,
        VERIFY_PREFIX,
        joinPath,
        pinnedArtifacts,
} from './api.ts';
import { readPinnedManifest } from './ledger.ts';
import { parseLedgerRecord, latestLedgerPath } from './verify.ts';
import { toIsoStamp } from './format.ts';

/** The status snapshot (rendered read-only; never persisted). */
export interface IntegrityStatus {
        readonly pinnedArtifactCount: number;
        readonly manifestStatus: BundleManifest['status'];
        readonly manifestBaseCommit: string | null;
        readonly signedCoverage: { readonly signed: number; readonly total: number } | undefined;
        readonly ledgerFingerprint: string | undefined;
        readonly ledgerCreatedAt: number | undefined;
        readonly keyStore: KeyPeekOutcome;
        readonly lastVerify: { readonly verdict: string; readonly ok: boolean; readonly createdAt: number; readonly counts: { green: number; tampered: number; unsigned: number; torn: number } } | undefined;
}

/** Selects the latest verify record file (lexicographic stamp = chronological). */
async function latestVerifyPath(root: string, fs: IntegrityFsPort): Promise<string | undefined> {
        const entries = await fs.readdir(joinPath(root, INTEGRITY_DIR));
        if (entries === undefined) {
                return undefined;
        }
        const records = entries.filter(name => name.startsWith(VERIFY_PREFIX) && name.endsWith('.json')).sort();
        return records.length === 0 ? undefined : records[records.length - 1];
}

/** Assembles the read-only status snapshot (no writes, no generation, no banking). */
export async function runStatus(deps: { root: string; productRoot: string; fs: IntegrityFsPort; keys: KeyPort }): Promise<IntegrityStatus> {
        const { manifest } = await readPinnedManifest(deps.productRoot, deps.fs);
        const artifacts = pinnedArtifacts(manifest);

        let signedCoverage: IntegrityStatus['signedCoverage'] = undefined;
        let ledgerFingerprint: string | undefined;
        let ledgerCreatedAt: number | undefined;
        const ledgerRel = await latestLedgerPath(deps.root, deps.fs);
        if (ledgerRel !== undefined) {
                const text = await deps.fs.readFileUtf8(joinPath(deps.root, INTEGRITY_DIR, ledgerRel));
                if (text !== undefined) {
                        try {
                                const parsed = parseLedgerRecord(JSON.parse(text));
                                if (parsed !== undefined) {
                                        const pinned = new Set(artifacts.map(artifact => artifact.artifactPath));
                                        const signed = parsed.entries.filter(entry => pinned.has(entry.artifactPath)).length;
                                        signedCoverage = { signed, total: artifacts.length };
                                        ledgerFingerprint = parsed.keyFingerprint;
                                        ledgerCreatedAt = parsed.createdAt;
                                }
                        } catch {
                                // a torn latest ledger leaves the coverage undefined (the honest absent view)
                        }
                }
        }

        let lastVerify: IntegrityStatus['lastVerify'] = undefined;
        const verifyRel = await latestVerifyPath(deps.root, deps.fs);
        if (verifyRel !== undefined) {
                const text = await deps.fs.readFileUtf8(joinPath(deps.root, INTEGRITY_DIR, verifyRel));
                if (text !== undefined) {
                        try {
                                const parsed = JSON.parse(text) as Record<string, unknown>;
                                if (parsed.$schema === 'flauz.integrity-verify/v1' && typeof parsed.verdict === 'string' && typeof parsed.ok === 'boolean' && typeof parsed.createdAt === 'number' && parsed.counts !== undefined) {
                                        const counts = parsed.counts as Record<string, unknown>;
                                        lastVerify = {
                                                verdict: parsed.verdict,
                                                ok: parsed.ok,
                                                createdAt: parsed.createdAt,
                                                counts: {
                                                        green: typeof counts.green === 'number' ? counts.green : 0,
                                                        tampered: typeof counts.tampered === 'number' ? counts.tampered : 0,
                                                        unsigned: typeof counts.unsigned === 'number' ? counts.unsigned : 0,
                                                        torn: typeof counts.torn === 'number' ? counts.torn : 0,
                                                },
                                        };
                                }
                        } catch {
                                // a torn verify record leaves the summary undefined (the honest absent view)
                        }
                }
        }

        const keyStore = await deps.keys.peekKeyInfo(deps.root);
        return {
                pinnedArtifactCount: artifacts.length,
                manifestStatus: manifest.status,
                manifestBaseCommit: manifest.baseCommit,
                signedCoverage,
                ledgerFingerprint,
                ledgerCreatedAt,
                keyStore,
                lastVerify,
        };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderStatus(status: IntegrityStatus): string[] {
        const lines: string[] = [];
        lines.push(`flauz.integrity.status: the signing plane's read-only state view (no state change: nothing written, nothing banked, the key store only peeked).`);
        lines.push(`  pinned artifacts: ${String(status.pinnedArtifactCount)} (bundle manifest ${status.manifestStatus}${status.manifestBaseCommit !== null ? `, base ${status.manifestBaseCommit.slice(0, 12)}..` : ''})`);
        if (status.signedCoverage !== undefined) {
                lines.push(`  signed coverage: ${String(status.signedCoverage.signed)}/${String(status.signedCoverage.total)} (latest ledger${status.ledgerCreatedAt !== undefined ? `, signed ${toIsoStamp(status.ledgerCreatedAt)}` : ''})`);
        } else {
                lines.push('  signed coverage: 0 (no parseable ledger -- the ledger starts empty by design: the first sign run is the operator\'s)');
        }
        if (status.ledgerFingerprint !== undefined) {
                lines.push(`  ledger key fingerprint: ${status.ledgerFingerprint.slice(0, 16)}..`);
        }
        if (status.keyStore.status === 'present' && status.keyStore.info !== undefined) {
                lines.push(`  key store: present (fingerprint ${status.keyStore.info.fingerprint.slice(0, 16)}.., local-dev posture -- production signing keys are the operator's)`);
        } else {
                lines.push(`  key store: ${status.keyStore.status} (signing has not run in this workspace: the keypair is generated on first sign)`);
        }
        if (status.lastVerify !== undefined) {
                const counts = status.lastVerify.counts;
                lines.push(`  last verify: ${status.lastVerify.verdict} (${String(counts.green)} green / ${String(counts.tampered)} tampered / ${String(counts.unsigned)} unsigned / ${String(counts.torn)} torn, ${toIsoStamp(status.lastVerify.createdAt)})`);
        } else {
                lines.push('  last verify: (none recorded in this workspace)');
        }
        return lines;
}
