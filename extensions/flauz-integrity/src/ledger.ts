/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The signature-ledger core (A-PROD-005-W2): `flauz.integrity.sign`.
 *
 * THE RE-DERIVATION LAW: every artifact's sha256 is computed LIVE over the
 * real bytes read through the fs port -- the manifest's pin is consulted ONLY
 * as the cross-check (a live hash that disagrees with the pin = the typed
 * PIN_MISMATCH refusal: the signing plane never signs bytes that are not the
 * pinned bytes). A pinned artifact whose bytes are absent = the typed
 * ARTIFACT_MISSING refusal (never a partial ledger: the fail-closed batch
 * law -- every artifact is read + re-derived BEFORE the first signature is
 * produced).
 *
 * THE DETERMINISM LAW (modulo the injected clock): identical inputs -- same
 * pinned manifest, same artifact bytes, same key store, same clock -- produce
 * a byte-identical ledger (ed25519 signatures are deterministic per RFC 8032;
 * the record carries exactly ONE clock reading, stamped into createdAt and
 * every signedAt + the filename stamp).
 *
 * THE SELF-CHAIN: the ledger signs itself -- the chain row carries sha256 +
 * an ed25519 signature over the canonical JSON of the record WITHOUT the
 * chain row, so any post-hoc edit to entries, key material or hashes breaks
 * the verify-time chain check (the tamper-evident chain the work order names).
 *
 * THE KEY-POSTURE DISCLOSURE rides every render + every record: local-dev
 * key posture (see api.ts) -- the verification machinery is the product, not
 * key custody.
 */

import {
        type Clock,
        type IntegrityFsPort,
        type KeyPort,
        type KeyStoreOutcome,
        type BundleManifest,
        INTEGRITY_DIR,
        KEY_POSTURE,
        LEDGER_PREFIX,
        LEDGER_SCHEMA_ID,
        PRODUCT_BUNDLE_MANIFEST_PATH,
        SIGNING_ALGORITHM,
        EXTENSION_ID,
        IntegrityError,
        bytesToBase64,
        canonicalJson,
        fingerprintFor,
        isPublicKeyHex,
        joinPath,
        parseBundleManifest,
        pinnedArtifacts,
        serializeArtifact,
        sha256Hex,
        sha256HexBytes,
        utf8Bytes,
} from './api.ts';
import { toIsoStamp } from './format.ts';
import { sweepArtifact } from './privacy.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';

/** One signed pinned artifact (the ledger entry). */
export interface LedgerEntry {
        readonly bundle: string;
        /** Product-relative: `extensions/<bundle>/<artifactRel>`. */
        readonly artifactPath: string;
        /** Extension-relative (the manifest's artifact key). */
        readonly artifactRel: string;
        /** The LIVE re-derived sha256 over the artifact bytes (never the manifest's value). */
        readonly sha256: string;
        /** The manifest pin (bound for the verify-time cross-check). */
        readonly pinnedSha256: string;
        /** Detached ed25519 signature over the artifact bytes (base64). */
        readonly signature: string;
        readonly signedAt: number;
}

/** The self-chain row: the ledger's own hash + signature over its chain-free canonical bytes. */
export interface LedgerChain {
        /** sha256 over canonicalJson(record minus the chain row). */
        readonly ledgerSha256: string;
        /** ed25519 signature (base64) over the UTF-8 bytes of that same canonical form. */
        readonly signature: string;
        readonly signedAt: number;
}

/** The persisted signature-ledger record (schema `flauz.integrity-ledger/v1`). */
export interface IntegrityLedgerRecord {
        readonly $schema: typeof LEDGER_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-integrity-ledger';
        readonly createdAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        readonly manifestPath: string;
        /** sha256 over the manifest file's raw bytes as read this run (the pin-source binding). */
        readonly manifestDigest: string;
        readonly manifestStatus: BundleManifest['status'];
        readonly algorithm: typeof SIGNING_ALGORITHM;
        readonly keyPosture: typeof KEY_POSTURE;
        readonly keyFingerprint: string;
        /** The raw public key, hex -- the ONLY key material in any record. */
        readonly publicKey: string;
        readonly entries: readonly LedgerEntry[];
        readonly chain: LedgerChain;
}

/** The sign outcome (command-level). */
export interface SignResult {
        readonly ok: true;
        readonly ledger: IntegrityLedgerRecord;
        readonly keyStatus: KeyStoreOutcome['status'];
        readonly artifactCount: number;
        readonly disclosure: string;
}

/** The persisted outcome. */
export interface PersistedLedger {
        readonly recordPath: string;
        readonly record: IntegrityLedgerRecord;
        readonly banking: BankingOutcome;
}

/** The filename-safe stamp of a ledger record (the export-stamp convention). */
export function ledgerStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** The ledger record WITHOUT the chain row (the self-hash input). */
function recordForChain(record: Omit<IntegrityLedgerRecord, 'chain'>): unknown {
        return record;
}

/** Reads + parses the pinned bundle manifest from a product root (the shared sign/verify prelude). */
export async function readPinnedManifest(productRoot: string, fs: IntegrityFsPort): Promise<{ manifest: BundleManifest; manifestText: string; manifestDigest: string; manifestPath: string }> {
        const manifestPath = joinPath(productRoot, PRODUCT_BUNDLE_MANIFEST_PATH);
        const manifestText = await fs.readFileUtf8(manifestPath);
        if (manifestText === undefined) {
                throw new IntegrityError('FLAUZ_INTEGRITY_NO_MANIFEST', `flauz.integrity/v1: ${PRODUCT_BUNDLE_MANIFEST_PATH} is absent from the product state -- the pinned bundle manifest is the signing plane's registry (the pins are minted at the integration station; a product without it has nothing to sign)`);
        }
        const parsed = parseBundleManifest(manifestText);
        if (!parsed.ok) {
                throw new IntegrityError('FLAUZ_INTEGRITY_MANIFEST_FORMAT', `flauz.integrity/v1: ${PRODUCT_BUNDLE_MANIFEST_PATH}: ${parsed.error}`);
        }
        const bytes = await fs.readFileBytes(manifestPath);
        if (bytes === undefined) {
                throw new IntegrityError('FLAUZ_INTEGRITY_NO_MANIFEST', `flauz.integrity/v1: ${PRODUCT_BUNDLE_MANIFEST_PATH} is not readable as bytes`);
        }
        return { manifest: parsed.manifest, manifestText, manifestDigest: sha256HexBytes(bytes), manifestPath: PRODUCT_BUNDLE_MANIFEST_PATH };
}

/**
 * Runs the sign pass: read the manifest, re-derive every artifact's hash LIVE,
 * cross-check the pins, sign every artifact + the self-chain through the
 * KeyPort. Pure deps-injected core; callers render + persist.
 */
export async function runSign(deps: { root: string; productRoot: string; fs: IntegrityFsPort; clock: Clock; keys: KeyPort }): Promise<SignResult> {
        const { manifest, manifestDigest, manifestPath } = await readPinnedManifest(deps.productRoot, deps.fs);
        const artifacts = pinnedArtifacts(manifest);

        // --- the fail-closed batch prelude: read + re-derive EVERYTHING before signing anything ---
        const missing: string[] = [];
        const pinMismatches: string[] = [];
        const liveHashes = new Map<string, string>();
        for (const artifact of artifacts) {
                const bytes = await deps.fs.readFileBytes(joinPath(deps.productRoot, artifact.artifactPath));
                if (bytes === undefined) {
                        missing.push(artifact.artifactPath);
                        continue;
                }
                const live = sha256HexBytes(bytes);
                liveHashes.set(artifact.artifactPath, live);
                if (live !== artifact.pinnedSha256) {
                        pinMismatches.push(`${artifact.artifactPath} (pinned ${artifact.pinnedSha256.slice(0, 12)}.., live ${live.slice(0, 12)}..)`);
                }
        }
        if (missing.length > 0) {
                throw new IntegrityError(
                        'FLAUZ_INTEGRITY_ARTIFACT_MISSING',
                        `flauz.integrity/v1: ${String(missing.length)} pinned artifact(s) have no bytes under the product root -- the ledger would be partial: ${missing.join(', ')} (a pre-install tree has no dist/ artifacts: the pins are minted at the integration station; this refusal is the honest fail-closed posture, never a partial ledger)`,
                );
        }
        if (pinMismatches.length > 0) {
                throw new IntegrityError(
                        'FLAUZ_INTEGRITY_PIN_MISMATCH',
                        `flauz.integrity/v1: ${String(pinMismatches.length)} artifact(s) whose LIVE re-derived sha256 disagrees with the manifest pin -- the signing plane never signs bytes that are not the pinned bytes (tamper signal or stale pin): ${pinMismatches.join('; ')}`,
                );
        }

        // --- the key (generated on first sign; the port owns the store) ---
        const key = await deps.keys.getOrCreateKeyInfo(deps.root);
        if (!isPublicKeyHex(key.info.publicKeyHex)) {
                throw new IntegrityError('FLAUZ_INTEGRITY_KEY_STORE', 'flauz.integrity/v1: the key port produced a malformed public key (expected 64 lowercase hex chars)');
        }
        const fingerprint = key.info.fingerprint.length === 64 ? key.info.fingerprint : fingerprintFor(key.info.publicKeyHex);

        // --- the entries: one detached signature per pinned artifact ---
        const createdAt = deps.clock();
        const entries: LedgerEntry[] = [];
        for (const artifact of artifacts) {
                const bytes = await deps.fs.readFileBytes(joinPath(deps.productRoot, artifact.artifactPath));
                if (bytes === undefined) {
                        // unreachable after the batch prelude; kept fail-closed anyway
                        throw new IntegrityError('FLAUZ_INTEGRITY_ARTIFACT_MISSING', `flauz.integrity/v1: ${artifact.artifactPath} vanished mid-run`);
                }
                const signature = await deps.keys.signBytes(deps.root, bytes);
                entries.push({
                        bundle: artifact.bundle,
                        artifactPath: artifact.artifactPath,
                        artifactRel: artifact.artifactRel,
                        sha256: liveHashes.get(artifact.artifactPath) as string,
                        pinnedSha256: artifact.pinnedSha256,
                        signature: bytesToBase64(signature),
                        signedAt: createdAt,
                });
        }

        // --- the self-chain: the ledger signs itself over its chain-free canonical bytes ---
        const chainFree = recordForChain({
                $schema: LEDGER_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-integrity-ledger',
                createdAt,
                extensionId: EXTENSION_ID,
                manifestPath,
                manifestDigest,
                manifestStatus: manifest.status,
                algorithm: SIGNING_ALGORITHM,
                keyPosture: KEY_POSTURE,
                keyFingerprint: fingerprint,
                publicKey: key.info.publicKeyHex,
                entries,
        });
        const chainBytes = canonicalJson(chainFree);
        const chainSignature = await deps.keys.signBytes(deps.root, utf8Bytes(chainBytes));
        const record: IntegrityLedgerRecord = {
                ...(chainFree as Omit<IntegrityLedgerRecord, 'chain'>),
                chain: {
                        ledgerSha256: sha256Hex(chainBytes),
                        signature: bytesToBase64(chainSignature),
                        signedAt: createdAt,
                },
        };

        const disclosure = `LOCAL-DEV KEY POSTURE: the signing key is a workspace-local ed25519 keypair (fingerprint ${fingerprint.slice(0, 16)}.., ${key.status === 'generated' ? 'GENERATED on this first sign run' : 'loaded from the workspace-local key store'}); the private key never leaves the port-owned store. Production signing keys are the OPERATOR's, held outside the product -- this extension proves the VERIFICATION machinery, not key custody.`;

        return { ok: true, ledger: record, keyStatus: key.status, artifactCount: entries.length, disclosure };
}

/**
 * Persists the ledger record workspace-locally + banks it census-visible:
 * sweep (fail-closed) -> serializeArtifact (DL-9) -> write
 * `.flauz/integrity/ledger-<stamp>.json` -> bank the evidence-ledger note row
 * (+ watermark resync when one exists).
 */
export async function persistLedger(deps: { root: string; fs: IntegrityFsPort; clock: Clock }, record: IntegrityLedgerRecord): Promise<PersistedLedger> {
        sweepArtifact(record, 'integrity-ledger');
        const line = serializeArtifact(record);
        const dir = joinPath(deps.root, INTEGRITY_DIR);
        await deps.fs.mkdir(dir);
        const recordPath = joinPath(dir, `${LEDGER_PREFIX}${ledgerStamp(record.createdAt)}.json`);
        await deps.fs.writeFile(recordPath, line);
        const banking = await bankRecord(deps, record, line, joinPath(INTEGRITY_DIR, `${LEDGER_PREFIX}${ledgerStamp(record.createdAt)}.json`));
        return { recordPath, record, banking };
}

/** The command render (channel lines; shape-only, canary-clean by construction). */
export function renderSign(result: SignResult): string[] {
        const lines: string[] = [];
        lines.push(`flauz.integrity.sign: the detached-signature ledger -- ${String(result.artifactCount)} pinned artifact(s) signed (ed25519, detached), every sha256 RE-DERIVED live over the real bytes (never trusted from the manifest), the ledger self-signed (tamper-evident chain).`);
        lines.push(`  ${result.disclosure}`);
        for (const entry of result.ledger.entries) {
                lines.push(`  signed ${entry.artifactPath} sha256=${entry.sha256.slice(0, 16)}.. sig=${entry.signature.slice(0, 12)}..`);
        }
        lines.push(`  chain: ledgerSha256=${result.ledger.chain.ledgerSha256.slice(0, 16)}.. self-signature=${result.ledger.chain.signature.slice(0, 12)}.. (any edit to this ledger breaks the verify-time chain check)`);
        lines.push(`  key fingerprint: ${result.ledger.keyFingerprint.slice(0, 16)}.. (public key recorded in the ledger; the private key stays in the workspace-local store)`);
        return lines;
}
