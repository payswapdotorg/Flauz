/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Integrity -- the signing and integrity plane
 * (A-PROD-005-W2, the wave the W1 gate's signingIntegrity NOT-YET row names).
 *
 * THE WAVE'S LAW: this extension owns the SIGNING PLANE for the release
 * artifacts -- detached ed25519 signatures over the PINNED bundle artifacts
 * (the 16-pin build/flauz/security/bundle-manifest.json at this base), the
 * signature ledger that binds each artifact's path + RE-DERIVED sha256 +
 * algorithm id + key fingerprint + signature + clock-port timestamp, the
 * ledger's own self-hash + self-signature (the tamper-evident chain), and the
 * one-command verify that produces the typed verdict table
 * (green/tampered/unsigned/torn) plus the ledger-chain row. It never re-bundles,
 * never regenerates the manifest (the STATION-PENDING doctrine: the pins are
 * minted at the integration station), never trusts a manifest's hash where the
 * bytes can be re-read -- every sha256 is re-derived LIVE over the artifact
 * bytes.
 *
 * THE KEY-POSTURE DISCLOSURE (the honest boundary, stated in every command
 * render and every record): the signing key is a LOCAL-DEV key posture -- a
 * workspace-local ed25519 keypair generated on first sign through the
 * injected KeyPort (node:crypto on the desktop lane), private key confined to
 * the workspace-local key store the PORT owns (never committed, never banked,
 * never rendered; only the PUBLIC key + fingerprint appear in records).
 * Production signing keys are the OPERATOR's, held outside the product; this
 * extension proves the VERIFICATION machinery, not key custody. The KeyPort
 * is the seam an operator-key deployment drives.
 *
 * THE EVIDENCE LAW (local-real): the pinned bundle manifest is the REAL
 * committed registry; artifact hashes are re-derived over REAL bytes through
 * the pure-TS sha256 below; ed25519 runs through the REAL node:crypto on the
 * desktop lane and through real node:crypto-backed fixture ports in tests.
 * Never claim runtime-real for production key custody (the local-dev posture
 * is the disclosed boundary). In a pre-install tree the pinned dist artifacts
 * do not exist -- sign refuses typed (ARTIFACT_MISSING) and verify reports
 * torn rows: the honest degradation, never a silent green.
 *
 * THE PRIVACY LAW IS THE METADATA LAW (the W1/W5 posture): every surface this
 * extension produces -- the ledger record, the verify record, the status
 * render, the banked evidence rows -- enumerates surface SHAPES (algorithm
 * ids, key fingerprints, signature encodings, artifact hashes, verdicts,
 * counts, paths) and NEVER CONTENTS and NEVER PRIVATE KEY MATERIAL. Every
 * metadata surface is swept for secret-shaped values before a single byte is
 * written (fail-closed, the W2 canary posture).
 *
 * Contract-duplication law (DL-32, the flauz-diagnostics/flauz-release
 * precedent): every durable-state format + sibling extension state this
 * extension consults is duplicated HERE as types + parsers -- never imported
 * from the owning extensions at src time (the W3/W4/W5 boundary law). The
 * duplication is pinned by test/contract.test.ts against the REAL owning
 * modules (test-time cross-extension imports are the sanctioned pin pattern;
 * src never crosses extension boundaries).
 */

/** Schema identifier pinned into every signature-ledger record. */
export const LEDGER_SCHEMA_ID = 'flauz.integrity-ledger/v1';

/** Schema identifier pinned into every verify record. */
export const VERIFY_SCHEMA_ID = 'flauz.integrity-verify/v1';

/** Schema identifier of the KeyPort-owned workspace-local key store file (never a record surface). */
export const KEY_STORE_SCHEMA_ID = 'flauz.integrity-keystore/v1';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** This extension's own durable home (the ledger + verify records). */
export const INTEGRITY_DIR = '.flauz/integrity';

/** The ledger record filename prefix: `ledger-<stamp>.json`. */
export const LEDGER_PREFIX = 'ledger-';

/** The verify record filename prefix: `verify-<stamp>.json`. */
export const VERIFY_PREFIX = 'verify-';

/** The KeyPort-owned key-store directory (workspace-local; never banked, never rendered). */
export const KEY_STORE_DIR = '.flauz/integrity/keys';

/** The KeyPort-owned key-store file (the ONLY place private key material ever lives). */
export const KEY_STORE_PATH = '.flauz/integrity/keys/ed25519-local-dev.json';

/** The signing algorithm id bound into every ledger record + entry. */
export const SIGNING_ALGORITHM = 'ed25519' as const;

/** The disclosed key posture bound into every ledger record (never a custody claim). */
export const KEY_POSTURE = 'local-dev' as const;

/** The synthetic ledger taskId of the banked integrity rows (the flauz-backup/flauz-migration/flauz-telemetry/flauz-release/flauz-production precedent). */
export const INTEGRITY_TASK_ID = 'flauz-integrity';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-integrity';

// --- the repo-state product surfaces (read-only; contract-duplicated from
//     flauz-release/src/api.ts + flauz-production/src/api.ts; the product-root
//     ports read these) ---

/** The packaging-parity registry path (relative to the product root; the product-state signature probe). */
export const PRODUCT_PARITY_REGISTRY_PATH = 'build/flauz/packaging-parity.json';

/** The pinned bundle manifest (relative to the product root; the reproducible-release-artifact pins this wave signs). */
export const PRODUCT_BUNDLE_MANIFEST_PATH = 'build/flauz/security/bundle-manifest.json';

/** The extensions directory of the product state (one `flauz-*` directory per packaged extension). */
export const PRODUCT_EXTENSIONS_DIR = 'extensions';

// --- the durable-state banking surfaces (read-only; owned by flauz-workspace;
//     contract-duplicated from the owning constants, pinned by the contract suite) ---

export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the ledger file self-declares no $schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the read surface (UTF-8 + RAW
 * BYTES -- artifact hashing reads bytes, not text) plus the writes its OWN
 * artifacts own (the ledger record, the verify record, the census-visible
 * ledger banking).
 */
export interface IntegrityFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        /** Raw artifact bytes (undefined when absent: ENOENT -- a leaf, never a crash). */
        readFileBytes(path: string): Promise<Uint8Array | undefined>;
        /** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
        appendFile(path: string, contents: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.integrity.*` render target). */
export interface OutputChannelPort {
        appendLine(line: string): void;
}

/** The workspace-local key info (the ONLY key material that ever appears in records: public + fingerprint). */
export interface KeyInfo {
        /** The raw 32-byte ed25519 public key, hex (64 chars). */
        readonly publicKeyHex: string;
        /** sha256 over the raw public-key bytes, hex -- the display/binding fingerprint. */
        readonly fingerprint: string;
        /** Clock-stamped creation time of the key (not of the store read). */
        readonly createdAt: number;
}

/** The getOrCreate outcome: `generated` = the store was absent and a new keypair was minted. */
export interface KeyStoreOutcome {
        readonly status: 'loaded' | 'generated';
        readonly info: KeyInfo;
}

/** The read-only peek outcome: `torn` = a store file exists but does not parse/validate. */
export interface KeyPeekOutcome {
        readonly status: 'present' | 'absent' | 'torn';
        readonly info?: KeyInfo;
        readonly error?: string;
}

/**
 * The key-operations port (THE SEAM this wave drives): keypair custody +
 * detached ed25519 signatures + public-key signature verification. The
 * workspace root locates the port-owned store (`<root>/.flauz/integrity/keys/`);
 * the private key NEVER leaves the store through this port -- only public
 * material (KeyInfo) and derived artifacts (signatures) cross the boundary.
 * node:crypto on the desktop lane; fixture ports in tests (real node:crypto
 * for the local-real receipts, deterministic keys for the determinism law).
 */
export interface KeyPort {
        /** The workspace-local key info, generating the store on first call (the "generated on first sign" law). */
        getOrCreateKeyInfo(root: string): Promise<KeyStoreOutcome>;
        /** Read-only peek (the status view NEVER generates: no state change). */
        peekKeyInfo(root: string): Promise<KeyPeekOutcome>;
        /** Detached ed25519 signature over `bytes` with the store's private key (64 raw bytes). */
        signBytes(root: string, bytes: Uint8Array): Promise<Uint8Array>;
        /** Public-key signature verification (key-material-free; the ledger's recorded public key drives it). */
        verifyBytes(bytes: Uint8Array, signature: Uint8Array, publicKeyHex: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type IntegrityErrorCode =
        | 'FLAUZ_INTEGRITY_NO_WORKSPACE'
        | 'FLAUZ_INTEGRITY_NO_PRODUCT_STATE'
        | 'FLAUZ_INTEGRITY_NO_MANIFEST'
        | 'FLAUZ_INTEGRITY_MANIFEST_FORMAT'
        | 'FLAUZ_INTEGRITY_ARTIFACT_MISSING'
        | 'FLAUZ_INTEGRITY_PIN_MISMATCH'
        | 'FLAUZ_INTEGRITY_KEY_STORE'
        | 'FLAUZ_INTEGRITY_SECRET_SHAPED'
        | 'FLAUZ_INTEGRITY_FORMAT';

/** Typed integrity failure. `code` is stable; `detail` carries the class laws. */
export class IntegrityError extends Error {
        readonly code: IntegrityErrorCode;

        constructor(code: IntegrityErrorCode, message: string) {
                super(message);
                this.name = 'IntegrityError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 + codecs (contract-duplicated from
// flauz-workspace/api.ts via flauz-release/api.ts + flauz-production/api.ts;
// pinned byte-equal by test/contract.test.ts -- never imported across
// extensions). This wave's extension: the sha256 CORE runs over raw bytes
// (artifact hashing), the string variant delegates -- byte-equal to the
// owning string implementations.
// ---------------------------------------------------------------------------

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
        return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace, `undefined`
 * values dropped. This is the exact byte input of every chain row hash and of
 * the ledger's self-hash.
 */
export function canonicalJson(value: unknown): string {
        if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
                return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
                return '[' + value.map(canonicalJson).join(',') + ']';
        }
        if (typeof value === 'object') {
                const record = value as Record<string, unknown>;
                const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
                return '{' + keys.map(key => JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
        }
        throw new Error('flauz.integrity/v1: cannot canonicalize value of type ' + typeof value + ' (payloads must be JSON-safe)');
}

/** Deep copy with recursively sorted keys (input to the pretty artifact serializer). */
export function deepSorted(value: unknown): unknown {
        if (Array.isArray(value)) {
                return value.map(deepSorted);
        }
        if (value !== null && typeof value === 'object') {
                const record = value as Record<string, unknown>;
                const result: Record<string, unknown> = {};
                for (const key of Object.keys(record).filter(k => record[k] !== undefined).sort()) {
                        result[key] = deepSorted(record[key]);
                }
                return result;
        }
        return value;
}

/**
 * Artifact serialization with the git-diffability discipline (DL-9): fully
 * canonical (sorted) key order, 2-space indent, exactly one trailing newline.
 */
export function serializeArtifact(value: unknown): string {
        return JSON.stringify(deepSorted(value), null, 2) + '\n';
}

const SHA256_K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
        return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure-TypeScript sha256 over RAW BYTES, hex-encoded -- this wave's artifact
 * hashing core (the manifest pins are sha256 over file bytes; the hashes are
 * always RE-DERIVED live, never trusted from the manifest).
 *
 * Duplicated by contract from the flauz-workspace/flauz-release string
 * implementation (implemented locally instead of node:crypto so the core
 * stays free of node typings and runtime deps); pinned byte-equal against
 * node:crypto AND the owning string implementations in test/contract.test.ts.
 */
export function sha256HexBytes(bytes: Uint8Array): string {
        const bitLength = bytes.length * 8;
        const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
        const padded = new Uint8Array(paddedLength);
        padded.set(bytes);
        padded[bytes.length] = 0x80;
        const view = new DataView(padded.buffer);
        view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
        view.setUint32(paddedLength - 4, bitLength >>> 0, false);

        let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
        let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

        const w = new Uint32Array(64);
        for (let block = 0; block < paddedLength; block += 64) {
                for (let i = 0; i < 16; i++) {
                        w[i] = view.getUint32(block + i * 4, false);
                }
                for (let i = 16; i < 64; i++) {
                        const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3);
                        const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10);
                        w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
                }
                let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
                for (let i = 0; i < 64; i++) {
                        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                        const ch = (e & f) ^ (~e & g);
                        const t1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
                        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                        const maj = (a & b) ^ (a & c) ^ (b & c);
                        const t2 = (S0 + maj) >>> 0;
                        h = g; g = f; f = e; e = (d + t1) >>> 0;
                        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
                }
                h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
                h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
        }

        return [h0, h1, h2, h3, h4, h5, h6, h7]
                .map(word => word.toString(16).padStart(8, '0'))
                .join('');
}

/**
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded (the
 * chain-row + self-hash input for textual canonical forms). Byte-equal to the
 * flauz-workspace/flauz-release/flauz-production implementations (DL-32; the
 * contract suite pins it) and to node:crypto.
 */
export function sha256Hex(input: string): string {
        return sha256HexBytes(new TextEncoder().encode(input));
}

// --- byte codecs (records carry hex keys + base64 signatures; pure, node-free) ---

const HEX_CHARS = '0123456789abcdef';

/** Raw bytes -> lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
        let out = '';
        for (const byte of bytes) {
                out += HEX_CHARS[byte >> 4] + HEX_CHARS[byte & 0x0f];
        }
        return out;
}

/** Lowercase hex -> raw bytes (throws typed on malformed input). */
export function hexToBytes(hex: string): Uint8Array {
        if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
                throw new IntegrityError('FLAUZ_INTEGRITY_FORMAT', `flauz.integrity/v1: not a lowercase hex string (${hex.length} chars)`);
        }
        const out = new Uint8Array(hex.length / 2);
        for (let i = 0; i < out.length; i++) {
                out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        }
        return out;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Raw bytes -> base64 (standard alphabet, padded -- the signature encoding in records). */
export function bytesToBase64(bytes: Uint8Array): string {
        let out = '';
        for (let i = 0; i < bytes.length; i += 3) {
                const b0 = bytes[i] ?? 0;
                const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
                const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
                out += BASE64_CHARS[b0 >> 2];
                out += BASE64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
                out += b1 === undefined ? '=' : BASE64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
                out += b2 === undefined ? '=' : BASE64_CHARS[b2 & 0x3f];
        }
        return out;
}

/** Base64 -> raw bytes (throws typed on malformed input). */
export function base64ToBytes(text: string): Uint8Array {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
                throw new IntegrityError('FLAUZ_INTEGRITY_FORMAT', `flauz.integrity/v1: not a base64 string (${text.length} chars)`);
        }
        const unpadded = text.replace(/=+$/, '');
        const out = new Uint8Array(Math.floor(unpadded.length * 3 / 4));
        let buffer = 0;
        let bits = 0;
        let index = 0;
        for (const char of unpadded) {
                const value = BASE64_CHARS.indexOf(char);
                if (value < 0) {
                        throw new IntegrityError('FLAUZ_INTEGRITY_FORMAT', 'flauz.integrity/v1: invalid base64 character');
                }
                buffer = (buffer << 6) | value;
                bits += 6;
                if (bits >= 8) {
                        bits -= 8;
                        out[index] = (buffer >> bits) & 0xff;
                        index += 1;
                }
        }
        return out;
}

/** The key fingerprint: sha256 over the raw public-key bytes (hex). */
export function fingerprintFor(publicKeyHex: string): string {
        return sha256HexBytes(hexToBytes(publicKeyHex));
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasKey(obj: object, key: string): boolean {
        return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Splits canonical JSONL text into lines (trailing newline tolerated; blank lines preserved as errors by callers). */
export function splitJsonl(text: string): string[] {
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') {
                lines.pop();
        }
        return lines;
}

/** Byte length of a UTF-8 string (the same encoder the ledger watermark comparison uses). */
export function utf8ByteLength(text: string): number {
        return new TextEncoder().encode(text).length;
}

/** The UTF-8 bytes of a string (the self-hash + self-signature input over canonical forms). */
export function utf8Bytes(text: string): Uint8Array {
        return new TextEncoder().encode(text);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 64-lowercase-hex check (contract-duplicated; exported for the banking + ledger paths). */
export function isSha256Hex(value: unknown): value is string {
        return typeof value === 'string' && SHA256_HEX.test(value);
}

/** The 64-lowercase-hex ed25519 public-key shape. */
export function isPublicKeyHex(value: unknown): value is string {
        return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

// ---------------------------------------------------------------------------
// The pinned bundle manifest (contract-duplicated shape + strict parser; the
// owning instrument is build/flauz/scripts/security-runtime-gate.mjs, the
// pins are minted at the integration station -- this extension READS the
// registry, never regenerates it)
// ---------------------------------------------------------------------------

/** One pinned bundle: the extension's version + its dist artifacts' pinned sha256 (path-relative-to-extension -> hash). */
export interface BundleManifestEntry {
        readonly version: string | null;
        readonly artifacts: Readonly<Record<string, string>>;
}

/** The parsed pinned bundle manifest (schema `flauz.bundle-manifest/v1`). */
export interface BundleManifest {
        readonly status: 'PINNED' | 'STATION-PENDING';
        readonly baseCommit: string | null;
        readonly bundles: Readonly<Record<string, BundleManifestEntry>>;
}

/** Strict parse of the committed bundle-manifest body. */
export function parseBundleManifest(text: string): { ok: true; manifest: BundleManifest } | { ok: false; error: string } {
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { ok: false, error: `the bundle manifest does not parse as JSON (${(err as Error).message})` };
        }
        if (!isPlainObject(parsed)) {
                return { ok: false, error: 'the bundle manifest is not a JSON object' };
        }
        if (parsed.$schema !== 'flauz.bundle-manifest/v1') {
                return { ok: false, error: `the bundle manifest's $schema must be 'flauz.bundle-manifest/v1' (got ${JSON.stringify(parsed.$schema)})` };
        }
        if (parsed.manifestVersion !== 1) {
                return { ok: false, error: 'the bundle manifest\'s manifestVersion must be 1' };
        }
        if (parsed.status !== 'PINNED' && parsed.status !== 'STATION-PENDING') {
                return { ok: false, error: `the bundle manifest's status must be 'PINNED' or 'STATION-PENDING' (got ${JSON.stringify(parsed.status)})` };
        }
        if (!isPlainObject(parsed.bundles)) {
                return { ok: false, error: 'the bundle manifest carries no bundles{} -- not a bundle manifest body' };
        }
        const bundles: Record<string, BundleManifestEntry> = {};
        for (const [name, entry] of Object.entries(parsed.bundles)) {
                if (!isPlainObject(entry)) {
                        return { ok: false, error: `bundle '${name}' is not a JSON object` };
                }
                if (!isPlainObject(entry.artifacts) || Object.keys(entry.artifacts).length === 0) {
                        return { ok: false, error: `bundle '${name}' carries no artifacts{}` };
                }
                for (const [rel, hash] of Object.entries(entry.artifacts)) {
                        if (!isSha256Hex(hash)) {
                                return { ok: false, error: `bundle '${name}' artifact '${rel}' pin is not 64 lowercase hex chars` };
                        }
                }
                bundles[name] = {
                        version: typeof entry.version === 'string' ? entry.version : null,
                        artifacts: entry.artifacts as Record<string, string>,
                };
        }
        if (Object.keys(bundles).length === 0) {
                return { ok: false, error: 'the bundle manifest pins zero bundles' };
        }
        return {
                ok: true,
                manifest: {
                        status: parsed.status,
                        baseCommit: typeof parsed.baseCommit === 'string' ? parsed.baseCommit : null,
                        bundles,
                },
        };
}

/** One pinned artifact, flattened + sorted (the signing/verifying enumeration). */
export interface PinnedArtifact {
        readonly bundle: string;
        /** Product-relative: `extensions/<bundle>/<artifactRel>`. */
        readonly artifactPath: string;
        /** Extension-relative (the manifest's artifact key): `dist/extension.js`. */
        readonly artifactRel: string;
        readonly pinnedSha256: string;
}

/** The pinned-artifact enumeration (bundle-major, artifact sorted; deterministic order). */
export function pinnedArtifacts(manifest: BundleManifest): PinnedArtifact[] {
        const out: PinnedArtifact[] = [];
        for (const bundle of Object.keys(manifest.bundles).sort()) {
                const entry = manifest.bundles[bundle] as BundleManifestEntry;
                for (const artifactRel of Object.keys(entry.artifacts).sort()) {
                        out.push({
                                bundle,
                                artifactPath: joinPath(PRODUCT_EXTENSIONS_DIR, bundle, artifactRel),
                                artifactRel,
                                pinnedSha256: entry.artifacts[artifactRel] as string,
                        });
                }
        }
        return out;
}

/**
 * The product-state signature probe (contract-duplicated from
 * flauz-release/src/productState.ts + flauz-production/src/productState.ts):
 * a root carrying the parity registry is repo-state-product-shaped.
 */
export async function isProductRoot(root: string, fs: IntegrityFsPort): Promise<boolean> {
        const text = await fs.readFileUtf8(joinPath(root, PRODUCT_PARITY_REGISTRY_PATH));
        return text !== undefined;
}

// ---------------------------------------------------------------------------
// The evidence-ledger row contract (contract-duplicated from
// flauz-workspace via flauz-release/flauz-production verify.ts; the banking
// path + the cross-recognition contract pins consume exactly these)
// ---------------------------------------------------------------------------

/** Contract-duplicated stored ledger row (flauz-workspace LedgerRow; DL-32). */
export interface LedgerRowShape {
        readonly seq: number;
        readonly ts: number;
        readonly taskId: string;
        readonly kind: string;
        readonly uri: string;
        readonly sha256: string;
        readonly prev: string | null;
        readonly checkpoint?: unknown;
}

/** Parse outcome: {ok, row} | {ok: false, error}. */
export type LineParseOutcome<T> = { readonly ok: true; readonly row: T } | { readonly ok: false; readonly error: string };

const LEDGER_ROW_FIELDS = ['kind', 'prev', 'seq', 'sha256', 'taskId', 'ts', 'uri'] as const;

/**
 * The canonical stored line of a ledger row (no trailing newline) -- the exact
 * bytes hashed by the chain. Re-canonicalized from the PARSED row so an
 * on-disk line that is valid JSON but non-canonical still verifies by value.
 */
export function ledgerRowLine(row: LedgerRowShape): string {
        const record: Record<string, unknown> = {
                seq: row.seq,
                ts: row.ts,
                taskId: row.taskId,
                kind: row.kind,
                uri: row.uri,
                sha256: row.sha256,
                prev: row.prev,
        };
        if (row.checkpoint !== undefined) {
                record.checkpoint = row.checkpoint;
        }
        return canonicalJson(record);
}

/** The chain link value of a ledger row: sha256 over its canonical line. */
export function ledgerRowHash(row: LedgerRowShape): string {
        return sha256Hex(ledgerRowLine(row));
}

/** The chain head: the hash of the final row (the empty-ledger convention: sha256 of ''). */
export function ledgerHeadHash(rows: readonly LedgerRowShape[]): string {
        return rows.length === 0 ? sha256Hex('') : ledgerRowHash(rows[rows.length - 1] as LedgerRowShape);
}

/** Strict parse of one stored ledger line (value-level: structure + types). */
export function parseLedgerLine(line: string, lineNo: number): LineParseOutcome<LedgerRowShape> {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { ok: false, error: `ledger line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { ok: false, error: `ledger line ${String(lineNo)} is not a JSON object` };
        }
        const hasCheckpoint = hasKey(parsed, 'checkpoint');
        const expected = hasCheckpoint ? 8 : 7;
        if (Object.keys(parsed).length !== expected || !LEDGER_ROW_FIELDS.every(field => hasKey(parsed, field))) {
                return { ok: false, error: `ledger line ${String(lineNo)} must have exactly the 7 fields [kind, prev, seq, sha256, taskId, ts, uri]${hasCheckpoint ? ' + checkpoint' : ''}` };
        }
        if (typeof parsed.seq !== 'number' || !Number.isSafeInteger(parsed.seq) || parsed.seq < 1) {
                return { ok: false, error: `ledger line ${String(lineNo)}: seq must be a positive integer` };
        }
        if (typeof parsed.ts !== 'number' || !Number.isSafeInteger(parsed.ts) || parsed.ts <= 0) {
                return { ok: false, error: `ledger line ${String(lineNo)}: ts must be a positive integer` };
        }
        if (typeof parsed.taskId !== 'string' || parsed.taskId.length === 0) {
                return { ok: false, error: `ledger line ${String(lineNo)}: taskId must be a non-empty string` };
        }
        if (typeof parsed.kind !== 'string' || !['changeset', 'screenshot', 'command-output', 'note', 'checkpoint'].includes(parsed.kind)) {
                return { ok: false, error: `ledger line ${String(lineNo)}: kind must be one of changeset|screenshot|command-output|note|checkpoint` };
        }
        if (typeof parsed.uri !== 'string' || parsed.uri.length === 0) {
                return { ok: false, error: `ledger line ${String(lineNo)}: uri must be a non-empty string` };
        }
        if (!isSha256Hex(parsed.sha256)) {
                return { ok: false, error: `ledger line ${String(lineNo)}: sha256 must be 64 lowercase hex chars` };
        }
        if (parsed.prev !== null && !isSha256Hex(parsed.prev)) {
                return { ok: false, error: `ledger line ${String(lineNo)}: prev must be null or 64 lowercase hex chars` };
        }
        const row: Record<string, unknown> = {
                seq: parsed.seq,
                ts: parsed.ts,
                taskId: parsed.taskId,
                kind: parsed.kind,
                uri: parsed.uri,
                sha256: parsed.sha256,
                prev: parsed.prev,
        };
        if (hasCheckpoint) {
                row.checkpoint = parsed.checkpoint;
        }
        return { ok: true, row: row as unknown as LedgerRowShape };
}

// ---------------------------------------------------------------------------
// The size-watermark contract (banking resync; contract-duplicated shape)
// ---------------------------------------------------------------------------

/** The contract-duplicated watermark shape (flauz-workspace hardening.ts LedgerWatermark; DL-32). */
export interface LedgerWatermarkShape {
        readonly $schema: string;
        readonly rowCount: number;
        readonly bytes: number;
        readonly headSha256: string;
        readonly lastCheckpointSeq: number | null;
        readonly updatedAt: number;
}

const SIZE_SCHEMA = 'flauz.evidence.size/v1';

/** Lenient parse of a stored watermark (undefined when not the owning shape). */
export function parseWatermarkLenient(value: unknown): LedgerWatermarkShape | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== SIZE_SCHEMA || typeof value.rowCount !== 'number' || typeof value.bytes !== 'number' || typeof value.headSha256 !== 'string' || typeof value.updatedAt !== 'number') {
                return undefined;
        }
        const lastCheckpointSeq = value.lastCheckpointSeq;
        if (lastCheckpointSeq !== null && typeof lastCheckpointSeq !== 'number') {
                return undefined;
        }
        if (!isSha256Hex(value.headSha256)) {
                return undefined;
        }
        return {
                $schema: value.$schema,
                rowCount: value.rowCount,
                bytes: value.bytes,
                headSha256: value.headSha256,
                lastCheckpointSeq,
                updatedAt: value.updatedAt,
        };
}

/** The owning serialization discipline: sorted keys, 2-space indent, one trailing newline. */
export function serializeWatermark(watermark: LedgerWatermarkShape): string {
        const sorted: Record<string, unknown> = {
                $schema: SIZE_SCHEMA,
                bytes: watermark.bytes,
                headSha256: watermark.headSha256,
                lastCheckpointSeq: watermark.lastCheckpointSeq,
                rowCount: watermark.rowCount,
                updatedAt: watermark.updatedAt,
        };
        return `${JSON.stringify(sorted, null, 2)}\n`;
}
