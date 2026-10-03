/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The one-command integrity verdict (A-PROD-005-W2): `flauz.integrity.verify`.
 *
 * THE VERDICT TABLE (the work order's typed vocabulary, per pinned artifact):
 *   green     -- the live re-derived hash matches the pin AND the ledger
 *                signature verifies against the ledger's recorded public key;
 *   tampered  -- the live hash disagrees with the pin (the bytes are not the
 *                pinned bytes), OR the entry's recorded hash disagrees with
 *                the live re-derivation, OR the signature does not verify
 *                (a ledger-entry tamper signal);
 *   unsigned  -- no ledger entry covers the artifact (the ledger starts
 *                EMPTY by design: the first sign run is the operator's);
 *   torn      -- the artifact's bytes are absent, or its ledger entry is
 *                unparseable (an unverifiable row is never guessed).
 *
 * THE LEDGER-CHAIN ROW: the ledger's own self-hash + self-signature are
 * re-derived over the chain-free canonical bytes -- any edit to the ledger
 * breaks it (tamper-evident chain). An unparseable ledger = torn chain + every
 * artifact torn.
 *
 * THE DEGRADATION LAW (never a silent green): absent key store / absent
 * ledger / any non-green row => ok=false with the typed degradation reason,
 * and the RECORD PERSISTS (the verify record is written + banked whatever the
 * verdict says). Verification is key-store-INDEPENDENT (signatures verify
 * against the ledger's recorded public key) -- the key row reports the
 * store's presence + fingerprint binding as its own typed check.
 */

import {
        type Clock,
        type IntegrityFsPort,
        type KeyPort,
        INTEGRITY_DIR,
        LEDGER_PREFIX,
        LEDGER_SCHEMA_ID,
        PRODUCT_BUNDLE_MANIFEST_PATH,
        SIGNING_ALGORITHM,
        VERIFY_PREFIX,
        VERIFY_SCHEMA_ID,
        EXTENSION_ID,
        base64ToBytes,
        canonicalJson,
        fingerprintFor,
        isPlainObject,
        isPublicKeyHex,
        isSha256Hex,
        joinPath,
        pinnedArtifacts,
        serializeArtifact,
        sha256HexBytes,
        utf8Bytes,
} from './api.ts';
import { toIsoStamp } from './format.ts';
import { readPinnedManifest, type IntegrityLedgerRecord, type LedgerEntry } from './ledger.ts';
import { sweepArtifact } from './privacy.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';

/** The per-artifact typed verdict (the work order's four-value vocabulary). */
export type ArtifactVerdict = 'green' | 'tampered' | 'unsigned' | 'torn';

/** The ledger-chain row verdict. */
export type ChainVerdict = 'green' | 'tampered' | 'torn' | 'unsigned';

/** One per-artifact row of the verdict table. */
export interface VerifyArtifactRow {
        readonly bundle: string;
        readonly artifactPath: string;
        readonly verdict: ArtifactVerdict;
        /** Shape-only reasons (never contents). */
        readonly reasons: readonly string[];
        /** The live re-derived hash (when the bytes were readable). */
        readonly liveSha256?: string;
        readonly pinnedSha256: string;
        /** The signature check outcome (when an entry was parseable). */
        readonly signatureVerified?: boolean;
}

/** The key-store row (the custody-binding check; verification itself is store-independent). */
export interface VerifyKeyRow {
        readonly status: 'present' | 'absent' | 'torn';
        readonly fingerprint?: string;
        readonly fingerprintMatch?: boolean;
        readonly error?: string;
}

/** The ledger row (coverage + provenance). */
export interface VerifyLedgerRow {
        readonly status: 'present' | 'absent' | 'torn';
        readonly path?: string;
        readonly keyFingerprint?: string;
        readonly entryCount?: number;
        /** Ledger entries covering artifacts the manifest does NOT pin (disclosed, never a table row). */
        readonly extraEntries?: readonly string[];
        readonly error?: string;
}

/** The persisted verify record (schema `flauz.integrity-verify/v1`). */
export interface IntegrityVerifyRecord {
        readonly $schema: typeof VERIFY_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-integrity-verify';
        readonly createdAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        readonly manifestPath: string;
        readonly manifestDigest: string;
        readonly manifestStatus: string;
        readonly algorithm: typeof SIGNING_ALGORITHM;
        readonly pinnedArtifactCount: number;
        readonly ledger: VerifyLedgerRow;
        readonly chain: { readonly verdict: ChainVerdict; readonly reasons: readonly string[] };
        readonly keyStore: VerifyKeyRow;
        readonly artifacts: readonly VerifyArtifactRow[];
        readonly counts: { readonly green: number; readonly tampered: number; readonly unsigned: number; readonly torn: number };
        readonly verdict: 'GREEN' | 'NOT-GREEN';
        readonly ok: boolean;
        /** The typed degradation reason whenever ok=false (never a silent green). */
        readonly degradation?: string;
}

/** The verify outcome (command-level). */
export interface VerifyResult {
        readonly ok: boolean;
        readonly record: IntegrityVerifyRecord;
}

/** The persisted outcome. */
export interface PersistedVerify {
        readonly recordPath: string;
        readonly record: IntegrityVerifyRecord;
        readonly banking: BankingOutcome;
}

/** Lenient parse of one ledger entry (undefined when not the owning shape -- the torn class). */
function parseLedgerEntry(value: unknown): LedgerEntry | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.bundle !== 'string' || typeof value.artifactPath !== 'string' || typeof value.artifactRel !== 'string') {
                return undefined;
        }
        if (!isSha256Hex(value.sha256) || !isSha256Hex(value.pinnedSha256)) {
                return undefined;
        }
        if (typeof value.signature !== 'string' || value.signature.length === 0) {
                return undefined;
        }
        if (typeof value.signedAt !== 'number' || !Number.isSafeInteger(value.signedAt) || value.signedAt <= 0) {
                return undefined;
        }
        return {
                bundle: value.bundle,
                artifactPath: value.artifactPath,
                artifactRel: value.artifactRel,
                sha256: value.sha256,
                pinnedSha256: value.pinnedSha256,
                signature: value.signature,
                signedAt: value.signedAt,
        };
}

/** Lenient parse of a stored ledger record (undefined when not the owning shape -- torn). */
export function parseLedgerRecord(value: unknown): IntegrityLedgerRecord | undefined {
        if (!isPlainObject(value) || value.$schema !== LEDGER_SCHEMA_ID || value.schemaVersion !== 0 || value.kind !== 'flauz-integrity-ledger') {
                return undefined;
        }
        if (!isPublicKeyHex(value.publicKey) || !isSha256Hex(value.keyFingerprint)) {
                return undefined;
        }
        if (!Array.isArray(value.entries) || !isPlainObject(value.chain) || !isSha256Hex((value.chain as Record<string, unknown>).ledgerSha256)) {
                return undefined;
        }
        const entries: LedgerEntry[] = [];
        for (const entry of value.entries) {
                const parsed = parseLedgerEntry(entry);
                if (parsed === undefined) {
                        return undefined;
                }
                entries.push(parsed);
        }
        const chain = value.chain as Record<string, unknown>;
        if (typeof chain.signature !== 'string' || chain.signature.length === 0) {
                return undefined;
        }
        return {
                $schema: LEDGER_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-integrity-ledger',
                createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
                extensionId: EXTENSION_ID,
                manifestPath: PRODUCT_BUNDLE_MANIFEST_PATH,
                manifestDigest: typeof value.manifestDigest === 'string' ? value.manifestDigest : '',
                manifestStatus: value.manifestStatus === 'STATION-PENDING' ? 'STATION-PENDING' : 'PINNED',
                algorithm: SIGNING_ALGORITHM,
                keyPosture: 'local-dev',
                keyFingerprint: value.keyFingerprint,
                publicKey: value.publicKey,
                entries,
                chain: {
                        ledgerSha256: chain.ledgerSha256 as string,
                        signature: chain.signature as string,
                        signedAt: typeof chain.signedAt === 'number' ? chain.signedAt : 0,
                },
        };
}

/** The chain-free canonical form of a parsed ledger (the self-hash input, re-derived at verify time). */
function ledgerChainFreeBytes(record: IntegrityLedgerRecord): string {
        return canonicalJson({
                $schema: record.$schema,
                schemaVersion: record.schemaVersion,
                kind: record.kind,
                createdAt: record.createdAt,
                extensionId: record.extensionId,
                manifestPath: record.manifestPath,
                manifestDigest: record.manifestDigest,
                manifestStatus: record.manifestStatus,
                algorithm: record.algorithm,
                keyPosture: record.keyPosture,
                keyFingerprint: record.keyFingerprint,
                publicKey: record.publicKey,
                entries: record.entries,
        });
}

/** Selects the latest ledger record file (lexicographic stamp = chronological). */
export async function latestLedgerPath(root: string, fs: IntegrityFsPort): Promise<string | undefined> {
        const entries = await fs.readdir(joinPath(root, INTEGRITY_DIR));
        if (entries === undefined) {
                return undefined;
        }
        const ledgers = entries.filter(name => name.startsWith(LEDGER_PREFIX) && name.endsWith('.json')).sort();
        return ledgers.length === 0 ? undefined : ledgers[ledgers.length - 1];
}

/**
 * Runs the verify pass: re-hash every pinned artifact, compare against the
 * pin, verify the ledger signatures + self-chain, check coverage + the key
 * binding. The record is ASSEMBLED whatever the verdict -- persistence is the
 * caller's (persistVerify always writes: never a silent green).
 */
export async function runVerify(deps: { root: string; productRoot: string; fs: IntegrityFsPort; clock: Clock; keys: KeyPort }): Promise<VerifyResult> {
        const { manifest, manifestDigest } = await readPinnedManifest(deps.productRoot, deps.fs);
        const artifacts = pinnedArtifacts(manifest);
        const createdAt = deps.clock();

        // --- the ledger (absent = every artifact unsigned; torn = torn rows) ---
        const ledgerRel = await latestLedgerPath(deps.root, deps.fs);
        let ledger: IntegrityLedgerRecord | undefined;
        let ledgerRow: VerifyLedgerRow;
        let chainVerdict: ChainVerdict;
        const chainReasons: string[] = [];
        if (ledgerRel === undefined) {
                ledgerRow = { status: 'absent' };
                chainVerdict = 'unsigned';
                chainReasons.push('no signature ledger exists under .flauz/integrity/ -- the ledger starts EMPTY by design: the first sign run (flauz.integrity.sign) is the operator\'s');
        } else {
                const ledgerText = await deps.fs.readFileUtf8(joinPath(deps.root, INTEGRITY_DIR, ledgerRel));
                let parsedRecord: unknown;
                let parseOk = true;
                if (ledgerText === undefined) {
                        parseOk = false;
                } else {
                        try {
                                parsedRecord = JSON.parse(ledgerText);
                        } catch {
                                parseOk = false;
                        }
                }
                ledger = parseOk ? parseLedgerRecord(parsedRecord) : undefined;
                if (ledger === undefined) {
                        ledgerRow = { status: 'torn', path: joinPath(INTEGRITY_DIR, ledgerRel), error: 'the latest ledger record does not parse as a flauz.integrity-ledger/v1 body (torn: entries unverifiable, never guessed)' };
                        chainVerdict = 'torn';
                        chainReasons.push('the ledger record is torn (unparseable) -- the self-chain cannot be re-derived');
                } else {
                        // --- the self-chain: re-derive hash + signature over the chain-free canonical bytes ---
                        const chainBytes = ledgerChainFreeBytes(ledger);
                        const recomputedHash = sha256HexBytes(utf8Bytes(chainBytes));
                        const fingerprintRederived = fingerprintFor(ledger.publicKey);
                        let selfSignatureOk = false;
                        try {
                                selfSignatureOk = await deps.keys.verifyBytes(utf8Bytes(chainBytes), base64ToBytes(ledger.chain.signature), ledger.publicKey);
                        } catch {
                                selfSignatureOk = false; // a malformed signature encoding = the tampered/torn signal, never a crash
                        }
                        if (ledger.chain.ledgerSha256 !== recomputedHash) {
                                chainVerdict = 'tampered';
                                chainReasons.push(`the ledger self-hash disagrees with the re-derivation (recorded ${ledger.chain.ledgerSha256.slice(0, 12)}.., recomputed ${recomputedHash.slice(0, 12)}..) -- the ledger was edited after signing`);
                        } else if (!selfSignatureOk) {
                                chainVerdict = 'tampered';
                                chainReasons.push('the ledger self-signature does not verify against the ledger\'s recorded public key -- the chain row was edited after signing');
                        } else if (fingerprintRederived !== ledger.keyFingerprint) {
                                chainVerdict = 'tampered';
                                chainReasons.push('the recorded key fingerprint disagrees with the sha256 of the recorded public key -- the key material was edited after signing');
                        } else {
                                chainVerdict = 'green';
                                chainReasons.push(`self-hash + self-signature verify (fingerprint ${ledger.keyFingerprint.slice(0, 16)}..)`);
                        }
                        const pinnedPaths = new Set(artifacts.map(artifact => artifact.artifactPath));
                        const extra = ledger.entries.map(entry => entry.artifactPath).filter(path => !pinnedPaths.has(path));
                        ledgerRow = {
                                status: 'present',
                                path: joinPath(INTEGRITY_DIR, ledgerRel),
                                keyFingerprint: ledger.keyFingerprint,
                                entryCount: ledger.entries.length,
                                extraEntries: extra.length > 0 ? extra : undefined,
                        };
                }
        }

        // --- the key store (the custody-binding row; verification itself is store-independent) ---
        const peek = await deps.keys.peekKeyInfo(deps.root);
        let keyRow: VerifyKeyRow;
        if (peek.status === 'present' && peek.info !== undefined) {
                const match = ledger !== undefined && peek.info.fingerprint === ledger.keyFingerprint;
                keyRow = { status: 'present', fingerprint: peek.info.fingerprint, fingerprintMatch: match };
        } else if (peek.status === 'torn') {
                keyRow = { status: 'torn', error: peek.error ?? 'the key store does not parse' };
        } else {
                keyRow = { status: 'absent' };
        }

        // --- the per-artifact verdict table ---
        const rows: VerifyArtifactRow[] = [];
        for (const artifact of artifacts) {
                const reasons: string[] = [];
                const bytes = await deps.fs.readFileBytes(joinPath(deps.productRoot, artifact.artifactPath));
                if (bytes === undefined) {
                        rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'torn', reasons: ['the artifact bytes are absent under the product root (a pre-install tree has no dist/ artifacts) -- unverifiable, never guessed'], pinnedSha256: artifact.pinnedSha256 });
                        continue;
                }
                const live = sha256HexBytes(bytes);
                if (live !== artifact.pinnedSha256) {
                        reasons.push(`the live re-derived sha256 disagrees with the manifest pin (pinned ${artifact.pinnedSha256.slice(0, 12)}.., live ${live.slice(0, 12)}..) -- the bytes are not the pinned bytes (tamper signal or stale pin)`);
                        rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'tampered', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256 });
                        continue;
                }
                if (ledger === undefined) {
                        if (ledgerRow.status === 'torn') {
                                reasons.push('the ledger record is torn (unparseable) -- this artifact\'s entry is unverifiable, never guessed');
                                rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'torn', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256 });
                        } else {
                                reasons.push('no ledger entry covers this artifact (the ledger is absent -- it starts empty by design: run flauz.integrity.sign)');
                                rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'unsigned', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256 });
                        }
                        continue;
                }
                const entry = ledger.entries.find(candidate => candidate.artifactPath === artifact.artifactPath);
                if (entry === undefined) {
                        reasons.push('no ledger entry covers this artifact (the ledger starts empty by design: run flauz.integrity.sign)');
                        rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'unsigned', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256 });
                        continue;
                }
                if (entry.sha256 !== live) {
                        reasons.push(`the ledger entry's recorded sha256 disagrees with the live re-derivation (entry ${entry.sha256.slice(0, 12)}.., live ${live.slice(0, 12)}..) -- a ledger-entry tamper signal`);
                        rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'tampered', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256 });
                        continue;
                }
                let signatureVerified = false;
                try {
                        signatureVerified = await deps.keys.verifyBytes(bytes, base64ToBytes(entry.signature), ledger.publicKey);
                } catch {
                        signatureVerified = false;
                }
                if (!signatureVerified) {
                        reasons.push('the detached signature does not verify against the ledger\'s recorded public key -- a ledger-entry tamper signal (hash matches pin; authenticity fails)');
                        rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'tampered', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256, signatureVerified: false });
                        continue;
                }
                reasons.push('hash matches the pin (re-derived live) + the detached signature verifies against the ledger\'s recorded public key');
                rows.push({ bundle: artifact.bundle, artifactPath: artifact.artifactPath, verdict: 'green', reasons, liveSha256: live, pinnedSha256: artifact.pinnedSha256, signatureVerified: true });
        }

        const counts = {
                green: rows.filter(row => row.verdict === 'green').length,
                tampered: rows.filter(row => row.verdict === 'tampered').length,
                unsigned: rows.filter(row => row.verdict === 'unsigned').length,
                torn: rows.filter(row => row.verdict === 'torn').length,
        };

        // --- the aggregate (never a silently green aggregate) ---
        const degradations: string[] = [];
        if (counts.unsigned > 0) {
                degradations.push(`${String(counts.unsigned)} unsigned artifact(s) (the ledger starts empty by design: the first sign run is the operator's)`);
        }
        if (counts.tampered > 0) {
                degradations.push(`${String(counts.tampered)} tampered artifact(s)`);
        }
        if (counts.torn > 0) {
                degradations.push(`${String(counts.torn)} torn artifact(s)`);
        }
        if (chainVerdict !== 'green') {
                degradations.push(`the ledger chain is ${chainVerdict}`);
        }
        if (keyRow.status === 'absent') {
                degradations.push('the workspace-local key store is absent (signing has not run in this workspace: no key was generated)');
        } else if (keyRow.status === 'torn') {
                degradations.push('the workspace-local key store is torn (unparseable)');
        } else if (keyRow.fingerprintMatch === false) {
                degradations.push('the workspace-local key store\'s fingerprint does not match the ledger\'s recorded key (a different key signed this ledger)');
        }
        if (ledgerRow.extraEntries !== undefined) {
                degradations.push(`the ledger carries ${String(ledgerRow.extraEntries.length)} entr(ies) for artifacts the manifest does not pin (disclosed)`);
        }

        const ok = counts.green === artifacts.length && artifacts.length > 0 && chainVerdict === 'green' && keyRow.status === 'present' && keyRow.fingerprintMatch === true && (ledgerRow.extraEntries === undefined || ledgerRow.extraEntries.length === 0);

        const record: IntegrityVerifyRecord = {
                $schema: VERIFY_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-integrity-verify',
                createdAt,
                extensionId: EXTENSION_ID,
                manifestPath: PRODUCT_BUNDLE_MANIFEST_PATH,
                manifestDigest,
                manifestStatus: manifest.status,
                algorithm: SIGNING_ALGORITHM,
                pinnedArtifactCount: artifacts.length,
                ledger: ledgerRow,
                chain: { verdict: chainVerdict, reasons: chainReasons },
                keyStore: keyRow,
                artifacts: rows,
                counts,
                verdict: ok ? 'GREEN' : 'NOT-GREEN',
                ok,
                degradation: ok ? undefined : degradations.join('; '),
        };
        return { ok, record };
}

/**
 * Persists the verify record workspace-locally + banks it census-visible --
 * ALWAYS (a degraded verdict persists its record; never a silent green).
 */
export async function persistVerify(deps: { root: string; fs: IntegrityFsPort; clock: Clock }, record: IntegrityVerifyRecord): Promise<PersistedVerify> {
        sweepArtifact(record, 'integrity-verify');
        const line = serializeArtifact(record);
        const dir = joinPath(deps.root, INTEGRITY_DIR);
        await deps.fs.mkdir(dir);
        const stamp = toIsoStamp(record.createdAt).replaceAll(':', '');
        const rel = joinPath(INTEGRITY_DIR, `${VERIFY_PREFIX}${stamp}.json`);
        const recordPath = joinPath(deps.root, rel);
        await deps.fs.writeFile(recordPath, line);
        const banking = await bankRecord(deps, record, line, rel);
        return { recordPath, record, banking };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderVerify(result: VerifyResult): string[] {
        const record = result.record;
        const lines: string[] = [];
        lines.push(`flauz.integrity.verify: the one-command integrity verdict -- ${String(record.pinnedArtifactCount)} pinned artifact(s), every hash re-derived live, every signature verified against the ledger's recorded public key, the ledger self-chain re-derived.`);
        lines.push(`  ledger: ${record.ledger.status}${record.ledger.path !== undefined ? ` (${record.ledger.path})` : ''}${record.ledger.entryCount !== undefined ? ` -- ${String(record.ledger.entryCount)} entr(ies)` : ''}`);
        lines.push(`  chain: ${record.chain.verdict} -- ${record.chain.reasons.join('; ')}`);
        lines.push(`  key store: ${record.keyStore.status}${record.keyStore.fingerprint !== undefined ? ` (fingerprint ${record.keyStore.fingerprint.slice(0, 16)}.., ${record.keyStore.fingerprintMatch === true ? 'matches the ledger key' : record.keyStore.fingerprintMatch === false ? 'DOES NOT match the ledger key' : 'binding n/a'})` : ''}`);
        for (const row of record.artifacts) {
                lines.push(`  ${row.verdict.padEnd(8)} ${row.artifactPath}${row.verdict === 'green' ? ` (sha256=${(row.liveSha256 ?? '').slice(0, 12)}..)` : ` -- ${row.reasons[0] ?? ''}`}`);
        }
        lines.push(`  counts: ${String(record.counts.green)} green / ${String(record.counts.tampered)} tampered / ${String(record.counts.unsigned)} unsigned / ${String(record.counts.torn)} torn`);
        lines.push(`  verdict: ${record.verdict}${record.degradation !== undefined ? ` -- ${record.degradation}` : ' (every artifact green + chain green + key bound)'}`);
        return lines;
}
