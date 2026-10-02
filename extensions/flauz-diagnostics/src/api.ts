/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Diagnostics -- the support/debug bundle + diagnostics surface contracts (v0).
 *
 * A-PROD-004-W1 (TL-A): the beta-gate's `diagnostics` and `support/debug bundle`
 * rows. THE PRIVACY LAW IS THE PRODUCT HERE: the bundle REDACTS by default --
 * counts and hashes only, paths and ids are metadata, file CONTENTS are never
 * included in v0 (the `contents` class is refused with a typed error listing
 * what a contents-class bundle would need as a future decision).
 *
 * Contract-duplication law (DL-32, the flauz-resources/api.ts precedent): the
 * durable-state formats read by this extension are duplicated HERE as types +
 * parsers -- never imported from the owning extensions. The duplication is
 * pinned by test/contract.test.ts against the REAL modules and the shared
 * fixtures (test-time cross-extension imports are the sanctioned pin pattern;
 * src never crosses extension boundaries).
 */

/** Schema identifier pinned into every diagnostics snapshot. */
export const DIAGNOSTICS_SCHEMA_ID = 'flauz.diagnostics/v0';

/** Schema identifier pinned into every support bundle manifest. */
export const BUNDLE_SCHEMA_ID = 'flauz.support-bundle/v0';

/** Schema identifier pinned into the provider-lanes summary artifact. */
export const PROVIDER_LANES_SCHEMA_ID = 'flauz.provider-lanes/v0';

/** Schema identifier pinned into the recent-events artifact. */
export const RECENT_EVENTS_SCHEMA_ID = 'flauz.recent-events/v0';

/** Schema identifier pinned into the integrity artifact. */
export const INTEGRITY_SCHEMA_ID = 'flauz.integrity/v0';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** The support bundles live here, one directory per bundle: `<FLAUZ_DIR>/support-bundle-<stamp>/`. */
export const BUNDLE_DIR_PREFIX = 'support-bundle-';

// --- the durable-state surface paths (read-only; each owned by its extension) ---

export const TASKS_PATH = '.flauz/tasks.json';
export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
export const SIZE_PATH = '.flauz/evidence/size.json';
export const RESOURCES_GRAPH_PATH = '.flauz/resources.json';
export const RESOURCES_OPS_PATH = '.flauz/resources-ops.jsonl';
export const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';
export const BROWSER_SESSIONS_PATH = '.flauz/browser-sessions.jsonl';
export const ORCH_GRAPHS_PATH = '.flauz/orchestration/graphs.json';
export const ORCH_JOURNAL_PATH = '.flauz/orchestration/journal.jsonl';
export const MODELS_DIR = '.flauz/models';
export const PROVIDERS_PATH = '.flauz/models/providers.json';
export const ROUTING_POLICY_PATH = '.flauz/models/routing-policy.json';
export const ROUTING_DECISIONS_PATH = '.flauz/models/routing-decisions.jsonl';
export const PROVIDER_SWITCHES_PATH = '.flauz/models/provider-switches.jsonl';
export const WORKFLOWS_DIR = '.flauz/workflows';

// ---------------------------------------------------------------------------
// The bundle artifact classes (the enumerated contract; the MANIFEST law)
// ---------------------------------------------------------------------------

/**
 * The artifact classes a v0 bundle can contain. `manifest` is always present
 * (it IS the enumeration the user-facing disclosure renders before creation);
 * the other four are data classes selected by the include filter.
 */
export const BUNDLE_CLASSES = ['manifest', 'diagnostics', 'provider-lanes', 'recent-events', 'integrity'] as const;
export type BundleClass = (typeof BUNDLE_CLASSES)[number];

/**
 * The classes that are NEVER includable in a v0 bundle. Each names the future
 * decision a contents-class bundle would require -- the refusal is the product.
 */
export const REFUSED_CLASSES = ['contents'] as const;
export type RefusedClass = (typeof REFUSED_CLASSES)[number];

/**
 * What a contents-class bundle would need as a FUTURE decision (surfaced
 * verbatim by the typed refusal so the operator sees the gate, not a wall).
 */
export const CONTENTS_FUTURE_DECISIONS: readonly string[] = [
        'a per-class redaction review: every file format that would ride a contents-class bundle needs an explicit per-field disclosure decision (which fields are contents, which are metadata)',
        'an explicit user opt-in at bundle-creation time naming the exact artifact classes whose contents are included, recorded in the bundle manifest',
        'a size/cost budget: contents classes need byte caps + per-file selection so a bundle cannot silently copy the whole workspace',
        'a provenance decision for third-party content: file contents may carry material the user does not own (vendored sources, secrets committed by accident) -- the inclusion law needs an incident/justification record',
        'an extension of the canary sweep to contents fields (the redaction regression suite grows a per-class canary matrix)',
];

/** The default include set: every safe class (the redacted-by-default posture). */
export const DEFAULT_INCLUDE: readonly BundleClass[] = ['manifest', 'diagnostics', 'provider-lanes', 'recent-events', 'integrity'];

/** How many rows each typed-event surface contributes to the recent-events tail. */
export const EVENT_TAIL_SIZE = 20;

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs. One method wider than the
 * flauz-workspace FileSystemPort: the durable-state census enumerates `.flauz/`
 * (readdir); documented here because the sibling port (readFileUtf8/writeFile/
 * appendFile/rename/mkdir) deliberately omits listing.
 */
export interface DiagFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.diag.show` render target). */
export interface OutputChannelPort {
        appendLine(line: string): void;
}

/** The product/extension versions block (wired by extension.ts; injected in tests). */
export interface VersionsInfo {
        readonly productVersion: string;
        readonly productName: string;
        readonly extensions: readonly { readonly id: string; readonly version: string }[];
}

/** The environment summary block (wired by extension.ts; injected in tests). */
export interface EnvironmentInfo {
        readonly nodeVersion: string;
        readonly platform: string;
        readonly arch: string;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type DiagnosticsErrorCode =
        | 'FLAUZ_DIAG_CONTENTS_REFUSED'
        | 'FLAUZ_DIAG_UNKNOWN_CLASS'
        | 'FLAUZ_DIAG_SECRET_SHAPED'
        | 'FLAUZ_DIAG_NO_WORKSPACE'
        | 'FLAUZ_DIAG_UNREADABLE_STATE';

/** Typed diagnostics failure. `code` is stable; `detail` carries the class laws. */
export class DiagnosticsError extends Error {
        readonly code: DiagnosticsErrorCode;

        constructor(code: DiagnosticsErrorCode, message: string) {
                super(message);
                this.name = 'DiagnosticsError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace/api.ts;
// pinned byte-equal by test/contract.test.ts -- never imported across extensions)
// ---------------------------------------------------------------------------

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
        return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace, `undefined`
 * values dropped. This is the exact byte input of every chain row hash.
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
        throw new Error(`flauz.diagnostics/v0: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
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
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded.
 *
 * Duplicated by contract from flauz-workspace/src/api.ts (implemented locally
 * instead of node:crypto so the core stays free of node typings and runtime
 * deps); pinned byte-equal against node:crypto in test/contract.test.ts.
 */
export function sha256Hex(input: string): string {
        const bytes = new TextEncoder().encode(input);
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
                        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
                        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
                        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
                }
                let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
                for (let i = 0; i < 64; i++) {
                        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                        const ch = (e & f) ^ (~e & g);
                        const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
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

/** sha256 over the UTF-8 bytes of an arbitrary string (file-byte digests). */
export function sha256Text(text: string): string {
        return sha256Hex(text);
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

/** Byte length of a UTF-8 string (the watermark comparison uses the same encoder as the ledger). */
export function utf8ByteLength(text: string): number {
        return new TextEncoder().encode(text).length;
}
