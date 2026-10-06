/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Acceptance -- the launch + post-release-acceptance plane
 * (A-PROD-006-W2, DL-87).
 *
 * THE WAVE'S LAW (DL-87 ADOPT): this extension owns the machinery that makes
 * the incidents loop's last two stages REAL -- the `regression -> release`
 * transition's `release-identity` evidence and the `release ->
 * post-release-verification` closure's `post-release-verification-receipt`
 * evidence. The launch act (flauz.acceptance.launch) mints the
 * release-acceptance record ONLY over a GREEN, FRESH
 * flauz.release.checklist artifact; the verify act
 * (flauz.acceptance.verify) re-runs the named owning checks against the
 * released state and banks the closing receipt -- pass or FAIL, both typed,
 * both banked. A FAILED receipt is the typed failure record the incidents
 * reopen law consumes (the closed loop never hides a regression).
 *
 * THE GATE VOCABULARY DOES NOT GROW (DL-86's scope guard honored, DL-87 law
 * 4): the eleven prove-items of the production gate stay verbatim; this
 * plane binds the gate by READING its verdict from the checklist artifacts,
 * never by redefining it. PROVE_ITEM_IDS below is the READ-PIN declaration
 * -- it exists so the contract suite can fail the moment the owning gate's
 * vocabulary drifts; no acceptance surface derives a verdict from it.
 *
 * THE HONEST-EVIDENCE LAW: this wave delivers MACHINERY over workspace
 * state. No record, test, or README sentence may imply a production launch,
 * production usage, or production-real evidence. The evidence label for
 * everything in this wave is `local-real` (workspace records) or lower,
 * stated in the README. The launch act is exercised over seeded workspace
 * records, honestly labeled.
 *
 * THE PRIVACY LAW IS THE METADATA LAW (the W1/W2/W3/W5 posture): every
 * surface this extension produces -- the acceptance ledger, the
 * verification journals, the status records, the banked evidence rows --
 * enumerates surface SHAPES (acceptance ids, checklist paths + ids, product
 * versions, surface ids, format versions, verdicts, counts) and NEVER
 * CONTENTS and never credentials. Every metadata surface is swept for
 * secret-shaped values before a single byte is written (fail-closed, the W2
 * canary posture). Records carry WORKSPACE-RELATIVE paths only (never
 * absolute host paths, never file contents).
 *
 * THE DETERMINISM LAW (the durability wave's structural law, mirrored): no
 * host-clock or host-random calls anywhere in src/ -- the acceptance id
 * (`flauz:acc:<16-hex>`) is generated from an EXPLICIT rng/seed input (the
 * id generator takes a seed string and hashes it). The clock is INJECTED
 * (the injected-clock law); the default deterministic clock lives in
 * globals.ts and is overridden by the extension layer (the host wall clock)
 * and by tests (the stepping-clock fixture).
 *
 * Contract-duplication law (DL-32, the flauz-incidents precedent): every
 * durable-state format + sibling extension state this extension consults is
 * duplicated HERE as types + parsers -- never imported from the owning
 * extensions (the boundary law). The duplication is pinned by
 * test/contract.test.ts against the REAL owning modules (test-time
 * cross-extension imports are the sanctioned pin pattern; src never crosses
 * extension boundaries).
 */

import {
        ACCEPTANCE_SCHEMA_ID,
        VERIFICATION_SCHEMA_ID,
        STATUS_SCHEMA_ID,
        ACCEPTANCE_DIR,
        ACCEPTANCE_FILENAME,
        VERIFY_PREFIX,
        FLAUZ_DIR,
        LEDGER_ROW_FORMAT_ID,
        EXTENSION_ID,
} from './globals.ts';
import { toIsoStamp } from './format.ts';

// ---------------------------------------------------------------------------
// The frozen evidence-label ladder (the program's evidence law, contract-
// duplicated from flauz-incidents/src/api.ts; never promote a label by wording)
// ---------------------------------------------------------------------------

/**
 * The evidence labels, FROZEN from the program's evidence law. The receipt's
 * evidence label comes from this ladder and is never promoted by wording --
 * the same law as the program's evidence law, applied per receipt. Pinned by
 * the contract suite (the evidence-label ladder exactness test).
 */
export const EVIDENCE_LABELS = [
        'fixture',
        'simulated',
        'local-real',
        'runtime-real',
        'live-provider',
        'production-real',
] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

// ---------------------------------------------------------------------------
// The eleven prove-items READ-PIN (DL-87 law 4: the gate vocabulary does not
// grow; the launch plane binds by READING the checklist verdict, never by
// redefining it -- this constant exists to be PINNED, not to derive verdicts)
// ---------------------------------------------------------------------------

/**
 * The production gate's eleven prove-item ids, VERBATIM (the read-pin; DL-87
 * law 4). The contract suite reads the owning
 * extensions/flauz-production/src/gate.ts source and fails on any drift.
 * NO acceptance surface derives a verdict from this list: the launch binds
 * the gate by READING the checklist artifact's verdict field.
 */
export const PROVE_ITEM_IDS = [
        'reproducibleArtifacts',
        'signingIntegrity',
        'securityPosture',
        'dataIsolation',
        'secretHandling',
        'workerDurability',
        'observability',
        'backupRecovery',
        'failureRollback',
        'upgradeCompatibility',
        'documentedCapabilities',
] as const;
export type ProveItemId = (typeof PROVE_ITEM_IDS)[number];

// ---------------------------------------------------------------------------
// The id shapes (the acceptance id from an explicit seed; the incident id
// link carried verbatim -- contract-duplicated from flauz-incidents)
// ---------------------------------------------------------------------------

/** The acceptance id shape: `flauz:acc:<16-hex>`. Pinned by the contract suite. */
export const ACCEPTANCE_ID_SHAPE = /^flauz:acc:[0-9a-f]{16}$/;

/** True when `value` matches the acceptance id shape. */
export function isAcceptanceId(value: unknown): value is string {
        return typeof value === 'string' && ACCEPTANCE_ID_SHAPE.test(value);
}

/**
 * The incident id shape, contract-duplicated from
 * flauz-incidents/src/api.ts (the launch's incident binding carries it
 * VERBATIM; pinned by the contract suite).
 */
export const INCIDENT_ID_SHAPE = /^flauz:inc:[0-9a-f]{16}$/;

/** True when `value` matches the incident id shape. */
export function isIncidentId(value: unknown): value is string {
        return typeof value === 'string' && INCIDENT_ID_SHAPE.test(value);
}

/**
 * Generates an acceptance id from an EXPLICIT seed string (the determinism
 * law: no host random). The id is the first 16 hex chars of sha256(seed) --
 * a stable, reproducible, collision-resistant 16-hex identifier. The seed is
 * the operator's responsibility (a descriptive acceptance slug is the
 * recommended seed; the id is the deterministic fingerprint of that slug).
 */
export function acceptanceIdFromSeed(seed: string): string {
        if (typeof seed !== 'string' || seed.length === 0) {
                throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.launch: the acceptance id seed must be a non-empty string (the explicit rng/seed input -- the id is the first 16 hex chars of sha256(seed))');
        }
        return `flauz:acc:${sha256Hex(seed).slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the read surface (UTF-8 text +
 * directory listings) plus the writes its OWN artifacts own (the acceptance
 * ledger, the verification journals, the status records, the census-visible
 * ledger banking). The flauz-release checklist artifacts are READ-ONLY
 * subjects (the surfaces-disjoint law).
 */
export interface AcceptanceFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        /** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
        appendFile(path: string, contents: string): Promise<void>;
}

/** Injectable output channel (the `flauz.acceptance.*` render target). */
export interface OutputChannelPort {
        appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type AcceptanceErrorCode =
        | 'FLAUZ_ACCEPTANCE_NO_WORKSPACE'
        | 'FLAUZ_ACCEPTANCE_NO_CHECKLIST'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_RED'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_STALE'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_NOT_FOUND'
        | 'FLAUZ_ACCEPTANCE_UNKNOWN_ACCEPTANCE'
        | 'FLAUZ_ACCEPTANCE_BAD_ARGS'
        | 'FLAUZ_ACCEPTANCE_SECRET_SHAPED'
        | 'FLAUZ_ACCEPTANCE_FORMAT';

/** Typed acceptance failure. `code` is stable; `detail` carries the class laws. */
export class AcceptanceError extends Error {
        readonly code: AcceptanceErrorCode;

        constructor(code: AcceptanceErrorCode, message: string) {
                super(message);
                this.name = 'AcceptanceError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace via
// flauz-release/flauz-incidents; pinned byte-equal by test/contract.test.ts
// -- never imported across extensions)
// ---------------------------------------------------------------------------

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
        return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. This is the exact byte input of every chain
 * row hash.
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
        throw new Error('flauz.acceptance/v1: cannot canonicalize value of type ' + typeof value + ' (payloads must be JSON-safe)');
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
 * Duplicated by contract from the flauz-workspace/flauz-release/
 * flauz-incidents implementations (implemented locally instead of
 * node:crypto so the core stays free of node typings and runtime deps);
 * pinned byte-equal against node:crypto AND the owning implementations in
 * test/contract.test.ts.
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

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 64-lowercase-hex check (contract-duplicated; exported for the banking + ledger paths). */
export function isSha256Hex(value: unknown): value is string {
        return typeof value === 'string' && SHA256_HEX.test(value);
}

// ---------------------------------------------------------------------------
// The evidence-ledger row contract (contract-duplicated from flauz-workspace
// via flauz-release/flauz-incidents; the banking path + the banked-record
// taskId law consume exactly these)
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
 * The canonical stored line of a ledger row (no trailing newline) -- the
 * exact bytes hashed by the chain. Re-canonicalized from the PARSED row so
 * an on-disk line that is valid JSON but non-canonical still verifies by
 * value.
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

// ---------------------------------------------------------------------------
// The evidence-ref scoping law (paths under .flauz/ only)
// ---------------------------------------------------------------------------

/** True when `path` is a workspace-relative path under `.flauz/` (the evidence-ref scoping law). */
export function isUnderFlauz(path: string): boolean {
        if (typeof path !== 'string' || path.length === 0) {
                return false;
        }
        const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
        if (normalized.startsWith('/')) {
                return false; // absolute paths are out of scope
        }
        if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
                return false; // parent-escape is out of scope
        }
        return normalized === FLAUZ_DIR || normalized.startsWith(`${FLAUZ_DIR}/`);
}

// ---------------------------------------------------------------------------
// The release-checklist artifact contract (READ-ONLY; contract-duplicated
// from flauz-release/src/checklist.ts + api.ts -- the launch-act's subject;
// pinned by the contract suite; NEVER edited by this extension)
// ---------------------------------------------------------------------------

/** The checklist schema id (contract-duplicated from flauz-release/src/api.ts). */
export const CHECKLIST_SCHEMA_ID = 'flauz.release-checklist/v1';

/** The checklist row verdict vocabulary (contract-duplicated; the go/no-go grammar). */
export type ChecklistVerdict = 'green' | 'red' | 'unknown';

/** The checklist row's evidence pointer (contract-duplicated; the owning command + its observable). */
export interface ChecklistEvidence {
        readonly command: string;
        readonly observable: string;
}

/** One checklist row (contract-duplicated from flauz-release/src/checklist.ts). */
export interface ChecklistRow {
        readonly id: string;
        readonly title: string;
        readonly verdict: ChecklistVerdict;
        readonly evidence: ChecklistEvidence;
        readonly reasons: readonly string[];
        readonly details: Record<string, unknown>;
}

/** The whole checklist artifact body (contract-duplicated from flauz-release/src/checklist.ts). */
export interface ReleaseChecklistArtifact {
        readonly $schema: typeof CHECKLIST_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly checklistId: string;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: string;
        readonly extensionVersion: string;
        readonly workspaceRoot: string;
        readonly commandLine: 'flauz.release.checklist';
        readonly verdict: 'GO' | 'NO-GO';
        readonly rows: readonly ChecklistRow[];
        readonly privacyLaw: string;
}

/**
 * The checklist id: sha256 over the canonical body minus checklistId
 * (contract-duplicated from flauz-release/src/checklist.ts checklistIdOf;
 * pinned byte-equal by the contract suite).
 */
export function checklistIdOf(artifact: Omit<ReleaseChecklistArtifact, 'checklistId'>): string {
        return sha256Hex(canonicalJson(artifact));
}

/**
 * The filename-safe stamp of a checklist artifact (the export-stamp
 * convention; contract-duplicated from flauz-release/src/checklist.ts
 * checklistStamp; pinned byte-equal by the contract suite).
 */
export function checklistStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}

/** Strict parse of one checklist artifact (the launch-act's contract-pinned reader). */
export function parseChecklistArtifact(value: unknown): ReleaseChecklistArtifact | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== CHECKLIST_SCHEMA_ID || value.schemaVersion !== 0 || value.commandLine !== 'flauz.release.checklist') {
                return undefined;
        }
        if (typeof value.checklistId !== 'string' || !isSha256Hex(value.checklistId)) {
                return undefined;
        }
        if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) {
                return undefined;
        }
        if (typeof value.productName !== 'string' || value.productName.length === 0 || typeof value.productVersion !== 'string' || value.productVersion.length === 0) {
                return undefined;
        }
        if (typeof value.extensionId !== 'string' || value.extensionId.length === 0 || typeof value.extensionVersion !== 'string') {
                return undefined;
        }
        if (typeof value.workspaceRoot !== 'string') {
                return undefined;
        }
        if (value.verdict !== 'GO' && value.verdict !== 'NO-GO') {
                return undefined;
        }
        if (typeof value.privacyLaw !== 'string' || value.privacyLaw.length === 0) {
                return undefined;
        }
        if (!Array.isArray(value.rows) || value.rows.length === 0) {
                return undefined;
        }
        const rows: ChecklistRow[] = [];
        for (const row of value.rows) {
                if (!isPlainObject(row) || typeof row.id !== 'string' || row.id.length === 0 || typeof row.title !== 'string' || row.title.length === 0) {
                        return undefined;
                }
                if (row.verdict !== 'green' && row.verdict !== 'red' && row.verdict !== 'unknown') {
                        return undefined;
                }
                const evidence = row.evidence;
                if (!isPlainObject(evidence) || typeof evidence.command !== 'string' || evidence.command.length === 0 || typeof evidence.observable !== 'string' || evidence.observable.length === 0) {
                        return undefined;
                }
                if (!Array.isArray(row.reasons) || !row.reasons.every((reason: unknown) => typeof reason === 'string')) {
                        return undefined;
                }
                if (!isPlainObject(row.details)) {
                        return undefined;
                }
                rows.push({
                        id: row.id,
                        title: row.title,
                        verdict: row.verdict as ChecklistVerdict,
                        evidence: { command: evidence.command, observable: evidence.observable },
                        reasons: [...(row.reasons as string[])],
                        details: row.details,
                });
        }
        return {
                $schema: CHECKLIST_SCHEMA_ID,
                schemaVersion: 0,
                checklistId: value.checklistId,
                createdAt: value.createdAt,
                productName: value.productName,
                productVersion: value.productVersion,
                extensionId: value.extensionId,
                extensionVersion: value.extensionVersion,
                workspaceRoot: value.workspaceRoot,
                commandLine: 'flauz.release.checklist',
                verdict: value.verdict as 'GO' | 'NO-GO',
                rows,
                privacyLaw: value.privacyLaw,
        };
}

// ---------------------------------------------------------------------------
// The durable-state surface registry (READ-ONLY; contract-duplicated from
// flauz-release/src/api.ts -- the pinned product state's enumeration;
// pinned by the contract suite)
// ---------------------------------------------------------------------------

/** The durable-state surface paths (contract-duplicated from flauz-release/src/api.ts). */
export const TASKS_PATH = '.flauz/tasks.json';
export const EVIDENCE_LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
export const EVIDENCE_SIZE_PATH = '.flauz/evidence/size.json';
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
export const WORKFLOW_INDEX_PATH = '.flauz/workflows/index.json';

/** One consulted surface: the census row it mirrors, its files, its format version. */
export interface SurfaceDef {
        /** The census row id (identical to the flauz-release DurableStateCensus key). */
        readonly id: SurfaceId;
        /** Every fixed file of the surface, workspace-relative (absent files are listed absent, never faked). */
        readonly fixedFiles: readonly string[];
        /** Optional enumerated dir (the workflows envelopes): every file matching the pattern is part of the surface. */
        readonly dirFile?: { readonly dir: string; readonly pattern: RegExp };
        /** The surface's durable format version (the owning schema id, contract-duplicated). */
        readonly formatVersion: string;
}

/** The surface ids -- exactly the flauz-release census's DurableStateCensus keys. */
export type SurfaceId =
        | 'tasks'
        | 'evidenceLedger'
        | 'evidenceWatermark'
        | 'resourcesGraph'
        | 'opsChain'
        | 'environmentsRegistry'
        | 'browserSessions'
        | 'workflows'
        | 'orchestration'
        | 'providerLanesState';

/**
 * The complete surface registry, in census order (contract-duplicated from
 * flauz-release/src/api.ts; pinned deep-equal by the contract suite). THE
 * SURFACE-SET LAW: the pinned product state enumerates THIS set; a surface
 * absent in a workspace is reported as absent (present: false), never faked.
 */
export const SURFACES: readonly SurfaceDef[] = [
        { id: 'tasks', fixedFiles: [TASKS_PATH], formatVersion: 'flauz.tasks/v0' },
        { id: 'evidenceLedger', fixedFiles: [EVIDENCE_LEDGER_PATH], formatVersion: LEDGER_ROW_FORMAT_ID },
        { id: 'evidenceWatermark', fixedFiles: [EVIDENCE_SIZE_PATH], formatVersion: 'flauz.evidence.size/v1' },
        { id: 'resourcesGraph', fixedFiles: [RESOURCES_GRAPH_PATH], formatVersion: 'flauz.resources/v0' },
        { id: 'opsChain', fixedFiles: [RESOURCES_OPS_PATH], formatVersion: 'flauz.resources-ops/v0' },
        { id: 'environmentsRegistry', fixedFiles: [ENVIRONMENTS_REGISTRY_PATH], formatVersion: 'flauz.environments/v0' },
        { id: 'browserSessions', fixedFiles: [BROWSER_SESSIONS_PATH], formatVersion: 'flauz.browser-session-journal/v0' },
        { id: 'workflows', fixedFiles: [WORKFLOW_INDEX_PATH], dirFile: { dir: WORKFLOWS_DIR, pattern: /^W-\d{3,}\.json$/ }, formatVersion: 'flauz.workflows/v1' },
        { id: 'orchestration', fixedFiles: [ORCH_GRAPHS_PATH, ORCH_JOURNAL_PATH], formatVersion: 'flauz.orch.graphs/v1 + flauz.orch.journal/v1' },
        { id: 'providerLanesState', fixedFiles: [PROVIDERS_PATH, ROUTING_POLICY_PATH, ROUTING_DECISIONS_PATH, PROVIDER_SWITCHES_PATH], formatVersion: 'flauz.model-providers/v0 + flauz.model-routing-policy/v0 + flauz.model-routing-decision/v0 + flauz.model-provider-switch/v0' },
];

// ---------------------------------------------------------------------------
// The ops-chain row contract (READ-ONLY; contract-duplicated from
// flauz-release/src/verify.ts -- the ops surface's pinned row contract)
// ---------------------------------------------------------------------------

/** The ops-record required/optional keys + op kinds (contract-duplicated from flauz-release/src/verify.ts). */
const OPS_REQUIRED = ['seq', 'ts', 'op', 'refId', 'actor', 'beforeDigest', 'afterDigest', 'prev'] as const;
const OPS_OPTIONAL = ['actorId', 'sessionId', 'taskId', 'cause', 'note'] as const;
const OPS_KINDS = ['add-ref', 'update-ref', 'remove-ref', 'add-surface', 'add-edge', 'remove-edge', 'restore'] as const;

/** Contract-duplicated stored ops row (flauz-release verify.ts OpsRecordShape; DL-32). */
export interface OpsRecordShape {
        readonly [key: string]: unknown;
}

/** Strict parse of one stored ops line (value-level: structure + types; contract-duplicated semantics). */
export function parseOpsLine(line: string, lineNo: number): LineParseOutcome<OpsRecordShape> {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { ok: false, error: `ops line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { ok: false, error: `ops line ${String(lineNo)} is not a JSON object` };
        }
        if (!hasKey(parsed, 'actor')) {
                return { ok: false, error: `ops line ${String(lineNo)}: actor is MISSING -- the actor (agent|human|tool) is MANDATORY on every recorded mutation` };
        }
        if (typeof parsed.actor !== 'string' || !['agent', 'human', 'tool'].includes(parsed.actor)) {
                return { ok: false, error: `ops line ${String(lineNo)}: actor must be one of agent|human|tool` };
        }
        for (const key of Object.keys(parsed)) {
                if (!([...OPS_REQUIRED, ...OPS_OPTIONAL] as readonly string[]).includes(key)) {
                        return { ok: false, error: `ops line ${String(lineNo)}: unknown key '${key}'` };
                }
        }
        for (const key of OPS_REQUIRED) {
                if (!hasKey(parsed, key)) {
                        return { ok: false, error: `ops line ${String(lineNo)}: missing required key '${key}'` };
                }
        }
        if (typeof parsed.seq !== 'number' || !Number.isSafeInteger(parsed.seq) || parsed.seq < 1) {
                return { ok: false, error: `ops line ${String(lineNo)}: seq must be a positive integer` };
        }
        if (typeof parsed.ts !== 'number' || !Number.isSafeInteger(parsed.ts) || parsed.ts <= 0) {
                return { ok: false, error: `ops line ${String(lineNo)}: ts must be a positive integer` };
        }
        if (typeof parsed.op !== 'string' || !(OPS_KINDS as readonly string[]).includes(parsed.op)) {
                return { ok: false, error: `ops line ${String(lineNo)}: op must be one of ${OPS_KINDS.join('|')}` };
        }
        if (typeof parsed.refId !== 'string' || parsed.refId.length === 0) {
                return { ok: false, error: `ops line ${String(lineNo)}: refId must be a non-empty string` };
        }
        if (!isSha256Hex(parsed.beforeDigest) || !isSha256Hex(parsed.afterDigest)) {
                return { ok: false, error: `ops line ${String(lineNo)}: beforeDigest/afterDigest must be 64 lowercase hex chars` };
        }
        if (parsed.prev !== null && !isSha256Hex(parsed.prev)) {
                return { ok: false, error: `ops line ${String(lineNo)}: prev must be null or 64 lowercase hex chars` };
        }
        return { ok: true, row: parsed as unknown as OpsRecordShape };
}

// ---------------------------------------------------------------------------
// The pinned product state (the version-inventory + census snapshot shapes;
// shape-compatible with flauz-release's SurfaceVersionReading + CensusRow)
// ---------------------------------------------------------------------------

/** One file's pinned reading (shape-compatible with flauz-release's FileVersionReading). */
export interface PinnedFileState {
        readonly sourcePath: string;
        readonly present: boolean;
        readonly sha256?: string;
        readonly bytes?: number;
        /** The detected format version (present files only; undefined = unrecognized). */
        readonly detectedVersion?: string;
        /** True when the version came from an in-band declaration (vs the pinned row contract). */
        readonly declared?: boolean;
        readonly problem?: string;
}

/** One surface's pinned reading (shape-compatible with flauz-release's SurfaceVersionReading). */
export interface PinnedSurfaceState {
        readonly surface: SurfaceId;
        readonly present: boolean;
        readonly expectedVersion: string;
        readonly files: readonly PinnedFileState[];
}

/** One census-snapshot row (shape-compatible with flauz-release's CensusRow: present + path + summary fields). */
export interface PinnedCensusRow {
        readonly present: boolean;
        readonly path: string;
        readonly [summary: string]: unknown;
}

/** The pinned product state the acceptance record carries (DL-87 law 2). */
export interface PinnedProductState {
        readonly versionInventory: readonly PinnedSurfaceState[];
        readonly censusSnapshot: readonly PinnedCensusRow[];
}

// ---------------------------------------------------------------------------
// The incident-binding contract (the launch's link into the incidents loop;
// resolved against the incidents ledger through the contract-pinned reader)
// ---------------------------------------------------------------------------

/** The incidents ledger path (contract-duplicated from flauz-incidents/src/globals.ts). */
export const INCIDENTS_LEDGER_PATH = '.flauz/incidents/incidents.json';

/** The incidents ledger schema id (contract-duplicated from flauz-incidents/src/globals.ts). */
export const INCIDENTS_SCHEMA_ID = 'flauz.incidents/v1';

/** The incident binding of a launch (the closing-loop link; typed disclosure on unresolvable). */
export interface IncidentBinding {
        /** The incident id (flauz:inc:<16-hex>), carried VERBATIM. */
        readonly incidentId: string;
        /** The named regression test (the incidents loop's regression-stage evidence named it). */
        readonly regressionTestId: string;
        /** Optional workspace-relative receipt ref under .flauz/ (the regression receipt's banked artifact). */
        readonly regressionReceiptRef?: string;
        /** The binding's typed resolution state (the honest-scope law: unresolvable is DISCLOSED, never fabricated). */
        readonly resolved: boolean;
        readonly disclosed: 'resolved' | 'disclosed-unresolvable';
}

// ---------------------------------------------------------------------------
// The named owning checks (DL-87 law 2: the release's acceptance set)
// ---------------------------------------------------------------------------

/** One named owning check of the release's acceptance set. */
export interface NamedOwningCheck {
        /** The check id (a checklist row id, or the named regression test id). */
        readonly checkId: string;
        /** Where the check comes from: a checklist row kind, or the incident's named regression test. */
        readonly source: 'checklist-row' | 'regression-test';
        /** The check's owning surface (the checklist row's evidence command; the repo test lane for the regression test). */
        readonly owningSurface: string;
        /** True when the acceptance plane can itself evaluate this check (the honest-scope law's carve-out). */
        readonly selfEvaluable: boolean;
}

// ---------------------------------------------------------------------------
// The acceptance-record contract (this plane's OWN durable shape)
// ---------------------------------------------------------------------------

/** The stamp shape every record filename suffix carries (the export-stamp convention, duplicated). */
export const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/;

/** One revision of an acceptance record (the append-only ledger law: re-launching an id appends a NEW revision, never duplicates). */
export interface AcceptanceRevision {
        readonly revision: number;
        readonly launchedAtEpoch: number;
        readonly launchedAtIso: string;
        readonly actor: string;
        /** The bound checklist artifact path, VERBATIM (workspace-relative; the release identity's location). */
        readonly checklistPath: string;
        /** The bound checklist's id (sha256-derived; re-derived over the bound bytes at launch). */
        readonly checklistId: string;
        /** The bound checklist's verdict (GREEN only -- the launch-act law refused everything else). */
        readonly checklistVerdict: 'GO';
        readonly productName: string;
        readonly productVersion: string;
        /** The pinned product state (the version-inventory + census snapshot; DL-87 law 2). */
        readonly pinnedState: PinnedProductState;
        /** The named owning checks set (the checklist row kinds + the incident's named regression test when bound). */
        readonly owningChecks: readonly NamedOwningCheck[];
        /** Present when launched to close an incident loop. */
        readonly incidentBinding?: IncidentBinding;
}

/** One acceptance record in the ledger (the unique-id law: one id, N revisions). */
export interface AcceptanceRecord {
        readonly acceptanceId: string;
        readonly firstLaunchedAtIso: string;
        readonly firstLaunchedAtEpoch: number;
        readonly revisions: readonly AcceptanceRevision[];
}

/** The persisted acceptance ledger (schema `flauz.acceptance/v1`). */
export interface AcceptanceLedger {
        readonly $schema: typeof ACCEPTANCE_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-acceptance';
        readonly createdAt: number;
        readonly updatedAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        readonly acceptances: readonly AcceptanceRecord[];
}

const ACCEPTANCE_KIND = 'flauz-acceptance';

/** The acceptance ledger's read outcome (absent / torn / resolved -- typed, never guessed). */
export type AcceptanceLedgerState =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly record: AcceptanceLedger };

/** Strict parse of one incident binding (the typed disclosure surface). */
export function parseIncidentBinding(value: unknown): IncidentBinding | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (!isIncidentId(value.incidentId)) {
                return undefined;
        }
        if (typeof value.regressionTestId !== 'string' || value.regressionTestId.length === 0) {
                return undefined;
        }
        if (value.regressionReceiptRef !== undefined && (typeof value.regressionReceiptRef !== 'string' || !isUnderFlauz(value.regressionReceiptRef))) {
                return undefined;
        }
        if (typeof value.resolved !== 'boolean') {
                return undefined;
        }
        if (value.disclosed !== 'resolved' && value.disclosed !== 'disclosed-unresolvable') {
                return undefined;
        }
        if (value.resolved !== (value.disclosed === 'resolved')) {
                return undefined;
        }
        return {
                incidentId: value.incidentId,
                regressionTestId: value.regressionTestId,
                ...(value.regressionReceiptRef !== undefined ? { regressionReceiptRef: value.regressionReceiptRef } : {}),
                resolved: value.resolved,
                disclosed: value.disclosed,
        };
}

/** Strict parse of one named owning check. */
export function parseNamedOwningCheck(value: unknown): NamedOwningCheck | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.checkId !== 'string' || value.checkId.length === 0) {
                return undefined;
        }
        if (value.source !== 'checklist-row' && value.source !== 'regression-test') {
                return undefined;
        }
        if (typeof value.owningSurface !== 'string' || value.owningSurface.length === 0) {
                return undefined;
        }
        if (typeof value.selfEvaluable !== 'boolean') {
                return undefined;
        }
        return { checkId: value.checkId, source: value.source, owningSurface: value.owningSurface, selfEvaluable: value.selfEvaluable };
}

/** Strict parse of one pinned census row (shape-compatible with flauz-release's CensusRow). */
function parsePinnedCensusRow(value: unknown): PinnedCensusRow | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.present !== 'boolean' || typeof value.path !== 'string' || value.path.length === 0) {
                return undefined;
        }
        const row: Record<string, unknown> = { present: value.present, path: value.path };
        for (const key of Object.keys(value)) {
                if (key !== 'present' && key !== 'path') {
                        row[key] = value[key];
                }
        }
        return row as unknown as PinnedCensusRow;
}

/** Strict parse of one pinned file state. */
function parsePinnedFileState(value: unknown): PinnedFileState | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.sourcePath !== 'string' || value.sourcePath.length === 0 || typeof value.present !== 'boolean') {
                return undefined;
        }
        if (value.sha256 !== undefined && !isSha256Hex(value.sha256)) {
                return undefined;
        }
        if (value.bytes !== undefined && (typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0)) {
                return undefined;
        }
        if (value.detectedVersion !== undefined && typeof value.detectedVersion !== 'string') {
                return undefined;
        }
        if (value.declared !== undefined && typeof value.declared !== 'boolean') {
                return undefined;
        }
        if (value.problem !== undefined && typeof value.problem !== 'string') {
                return undefined;
        }
        if (value.present && value.sha256 === undefined) {
                return undefined; // a present file always carries its pin
        }
        return {
                sourcePath: value.sourcePath,
                present: value.present,
                ...(value.sha256 !== undefined ? { sha256: value.sha256 } : {}),
                ...(value.bytes !== undefined ? { bytes: value.bytes } : {}),
                ...(value.detectedVersion !== undefined ? { detectedVersion: value.detectedVersion } : {}),
                ...(value.declared !== undefined ? { declared: value.declared } : {}),
                ...(value.problem !== undefined ? { problem: value.problem } : {}),
        };
}

/** Strict parse of one pinned surface state. */
function parsePinnedSurfaceState(value: unknown): PinnedSurfaceState | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.surface !== 'string' || !(SURFACES.map(def => def.id) as readonly string[]).includes(value.surface)) {
                return undefined;
        }
        if (typeof value.present !== 'boolean' || typeof value.expectedVersion !== 'string' || !Array.isArray(value.files)) {
                return undefined;
        }
        const files: PinnedFileState[] = [];
        for (const file of value.files) {
                const parsed = parsePinnedFileState(file);
                if (parsed === undefined) {
                        return undefined;
                }
                files.push(parsed);
        }
        return { surface: value.surface as SurfaceId, present: value.present, expectedVersion: value.expectedVersion, files };
}

/** Strict parse of one pinned product state. */
export function parsePinnedProductState(value: unknown): PinnedProductState | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (!Array.isArray(value.versionInventory) || !Array.isArray(value.censusSnapshot)) {
                return undefined;
        }
        const versionInventory: PinnedSurfaceState[] = [];
        for (const surface of value.versionInventory) {
                const parsed = parsePinnedSurfaceState(surface);
                if (parsed === undefined) {
                        return undefined;
                }
                versionInventory.push(parsed);
        }
        const censusSnapshot: PinnedCensusRow[] = [];
        for (const row of value.censusSnapshot) {
                const parsed = parsePinnedCensusRow(row);
                if (parsed === undefined) {
                        return undefined;
                }
                censusSnapshot.push(parsed);
        }
        return { versionInventory, censusSnapshot };
}

/** Strict parse of one acceptance revision (value-level: structure + types). */
export function parseAcceptanceRevision(value: unknown): AcceptanceRevision | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
                return undefined;
        }
        if (typeof value.launchedAtEpoch !== 'number' || !Number.isSafeInteger(value.launchedAtEpoch) || value.launchedAtEpoch < 0) {
                return undefined;
        }
        if (typeof value.launchedAtIso !== 'string' || value.launchedAtIso.length === 0) {
                return undefined;
        }
        if (typeof value.actor !== 'string' || value.actor.length === 0) {
                return undefined;
        }
        if (typeof value.checklistPath !== 'string' || !isUnderFlauz(value.checklistPath)) {
                return undefined;
        }
        if (typeof value.checklistId !== 'string' || !isSha256Hex(value.checklistId)) {
                return undefined;
        }
        if (value.checklistVerdict !== 'GO') {
                return undefined;
        }
        if (typeof value.productName !== 'string' || value.productName.length === 0 || typeof value.productVersion !== 'string' || value.productVersion.length === 0) {
                return undefined;
        }
        const pinnedState = parsePinnedProductState(value.pinnedState);
        if (pinnedState === undefined) {
                return undefined;
        }
        if (!Array.isArray(value.owningChecks) || value.owningChecks.length === 0) {
                return undefined;
        }
        const owningChecks: NamedOwningCheck[] = [];
        for (const check of value.owningChecks) {
                const parsed = parseNamedOwningCheck(check);
                if (parsed === undefined) {
                        return undefined;
                }
                owningChecks.push(parsed);
        }
        let incidentBinding: IncidentBinding | undefined;
        if (value.incidentBinding !== undefined) {
                incidentBinding = parseIncidentBinding(value.incidentBinding);
                if (incidentBinding === undefined) {
                        return undefined;
                }
        }
        return {
                revision: value.revision,
                launchedAtEpoch: value.launchedAtEpoch,
                launchedAtIso: value.launchedAtIso,
                actor: value.actor,
                checklistPath: value.checklistPath,
                checklistId: value.checklistId,
                checklistVerdict: 'GO',
                productName: value.productName,
                productVersion: value.productVersion,
                pinnedState,
                owningChecks,
                ...(incidentBinding !== undefined ? { incidentBinding } : {}),
        };
}

/** Strict parse of one acceptance record (value-level: structure + types). */
export function parseAcceptanceRecord(value: unknown): AcceptanceRecord | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (!isAcceptanceId(value.acceptanceId)) {
                return undefined;
        }
        if (typeof value.firstLaunchedAtIso !== 'string' || value.firstLaunchedAtIso.length === 0) {
                return undefined;
        }
        if (typeof value.firstLaunchedAtEpoch !== 'number' || !Number.isSafeInteger(value.firstLaunchedAtEpoch) || value.firstLaunchedAtEpoch < 0) {
                return undefined;
        }
        if (!Array.isArray(value.revisions) || value.revisions.length === 0) {
                return undefined;
        }
        const revisions: AcceptanceRevision[] = [];
        for (const row of value.revisions) {
                const rev = parseAcceptanceRevision(row);
                if (rev === undefined) {
                        return undefined;
                }
                revisions.push(rev);
        }
        // revisions must be 1..N in order
        for (let i = 0; i < revisions.length; i++) {
                if (revisions[i].revision !== i + 1) {
                        return undefined;
                }
        }
        return {
                acceptanceId: value.acceptanceId,
                firstLaunchedAtIso: value.firstLaunchedAtIso,
                firstLaunchedAtEpoch: value.firstLaunchedAtEpoch,
                revisions,
        };
}

/** Reads + parses the acceptance ledger from a workspace root (typed at every degradation). */
export async function readAcceptanceLedger(root: string, fs: AcceptanceFsPort): Promise<AcceptanceLedgerState> {
        const text = await fs.readFileUtf8(joinPath(root, ACCEPTANCE_DIR, ACCEPTANCE_FILENAME));
        if (text === undefined) {
                return { state: 'absent' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `acceptances.json is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed) || parsed.$schema !== ACCEPTANCE_SCHEMA_ID || parsed.kind !== ACCEPTANCE_KIND || !Array.isArray(parsed.acceptances)) {
                return { state: 'torn', reason: 'acceptances.json is not the flauz.acceptance/v1 shape' };
        }
        const acceptances: AcceptanceRecord[] = [];
        for (const row of parsed.acceptances) {
                const rec = parseAcceptanceRecord(row);
                if (rec === undefined) {
                        // a torn acceptance row is skipped (the ledger parses, the row did not) -- the status plane surfaces the ledger state honestly
                        continue;
                }
                acceptances.push(rec);
        }
        return {
                state: 'resolved',
                record: {
                        $schema: ACCEPTANCE_SCHEMA_ID,
                        schemaVersion: 0,
                        kind: ACCEPTANCE_KIND,
                        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
                        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
                        extensionId: EXTENSION_ID,
                        acceptances,
                },
        };
}

// ---------------------------------------------------------------------------
// The verification-journal contract (this plane's OWN durable shape; one
// append-only journal per acceptance)
// ---------------------------------------------------------------------------

/** One check row of a verification receipt. */
export interface VerificationCheckRow {
        readonly checkId: string;
        readonly source: 'checklist-row' | 'regression-test' | 'product-state-pin';
        /** pass | fail for self-evaluated checks; disclosure for the honest-scope rows (never a silent green). */
        readonly verdict: 'pass' | 'fail' | 'disclosure';
        /** The evidence label (present ONLY on self-evaluated rows -- a disclosure row carries NO evidence, never a fabricated label). */
        readonly evidenceLabel?: EvidenceLabel;
        /** The check's owning surface (named on EVERY row -- the honest-scope law). */
        readonly owningSurface: string;
        readonly detail: string;
        readonly reasons: readonly string[];
}

/** One row of the per-acceptance verification journal (schema `flauz.acceptance-verification/v1`, append-only). */
export interface VerificationRow {
        readonly $schema: typeof VERIFICATION_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-acceptance-verification';
        readonly extensionId: typeof EXTENSION_ID;
        readonly acceptanceId: string;
        /** The verification sequence number within this acceptance's journal (1, 2, 3...). */
        readonly seq: number;
        /** The verification timestamp (epoch ms; the injected clock -- the only timestamp source). */
        readonly timestampEpoch: number;
        /** The verification timestamp (ISO-8601 UTC; derived from the injected clock). */
        readonly timestampIso: string;
        /** The actor who fired the verification (the operator id; never contents). */
        readonly actor: string;
        /** The receipt's verdict: pass | fail (both typed, both banked; a FAIL is the typed failure record the incidents reopen law consumes). */
        readonly verdict: 'pass' | 'fail';
        /** The receipt's evidence label (from the frozen ladder; the self-evaluated rows are workspace-state re-reads -- local-real or lower, never promoted by wording). */
        readonly evidenceLabel: EvidenceLabel;
        readonly checks: readonly VerificationCheckRow[];
        readonly counts: {
                readonly total: number;
                readonly pass: number;
                readonly fail: number;
                readonly disclosure: number;
        };
}

/** Strict parse of one verification check row. */
export function parseVerificationCheckRow(value: unknown): VerificationCheckRow | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.checkId !== 'string' || value.checkId.length === 0) {
                return undefined;
        }
        if (value.source !== 'checklist-row' && value.source !== 'regression-test' && value.source !== 'product-state-pin') {
                return undefined;
        }
        if (value.verdict !== 'pass' && value.verdict !== 'fail' && value.verdict !== 'disclosure') {
                return undefined;
        }
        if (value.evidenceLabel !== undefined && (typeof value.evidenceLabel !== 'string' || !(EVIDENCE_LABELS as readonly string[]).includes(value.evidenceLabel))) {
                return undefined;
        }
        // the never-fabricate law: a disclosure row carries NO evidence label; a pass/fail row ALWAYS carries one
        if (value.verdict === 'disclosure' && value.evidenceLabel !== undefined) {
                return undefined;
        }
        if (value.verdict !== 'disclosure' && value.evidenceLabel === undefined) {
                return undefined;
        }
        if (typeof value.owningSurface !== 'string' || value.owningSurface.length === 0) {
                return undefined;
        }
        if (typeof value.detail !== 'string') {
                return undefined;
        }
        if (!Array.isArray(value.reasons) || !value.reasons.every((reason: unknown) => typeof reason === 'string')) {
                return undefined;
        }
        return {
                checkId: value.checkId,
                source: value.source,
                verdict: value.verdict,
                ...(value.evidenceLabel !== undefined ? { evidenceLabel: value.evidenceLabel as EvidenceLabel } : {}),
                owningSurface: value.owningSurface,
                detail: value.detail,
                reasons: [...(value.reasons as string[])],
        };
}

/** Strict parse of one verification journal row (value-level: structure + types). */
export function parseVerificationRow(value: unknown): VerificationRow | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== VERIFICATION_SCHEMA_ID || value.kind !== 'flauz-acceptance-verification' || value.extensionId !== EXTENSION_ID) {
                return undefined;
        }
        if (!isAcceptanceId(value.acceptanceId)) {
                return undefined;
        }
        if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) {
                return undefined;
        }
        if (typeof value.timestampEpoch !== 'number' || !Number.isSafeInteger(value.timestampEpoch) || value.timestampEpoch < 0) {
                return undefined;
        }
        if (typeof value.timestampIso !== 'string' || value.timestampIso.length === 0) {
                return undefined;
        }
        if (typeof value.actor !== 'string' || value.actor.length === 0) {
                return undefined;
        }
        if (value.verdict !== 'pass' && value.verdict !== 'fail') {
                return undefined;
        }
        if (typeof value.evidenceLabel !== 'string' || !(EVIDENCE_LABELS as readonly string[]).includes(value.evidenceLabel)) {
                return undefined;
        }
        if (!Array.isArray(value.checks) || value.checks.length === 0) {
                return undefined;
        }
        const checks: VerificationCheckRow[] = [];
        for (const row of value.checks) {
                const parsed = parseVerificationCheckRow(row);
                if (parsed === undefined) {
                        return undefined;
                }
                checks.push(parsed);
        }
        const counts = value.counts;
        if (!isPlainObject(counts) || typeof counts.total !== 'number' || typeof counts.pass !== 'number' || typeof counts.fail !== 'number' || typeof counts.disclosure !== 'number') {
                return undefined;
        }
        // the count coherence law: counts derive from the check rows exactly
        if (counts.total !== checks.length || counts.pass !== checks.filter(check => check.verdict === 'pass').length || counts.fail !== checks.filter(check => check.verdict === 'fail').length || counts.disclosure !== checks.filter(check => check.verdict === 'disclosure').length) {
                return undefined;
        }
        // the verdict coherence law: fail iff any check row failed
        if ((value.verdict === 'fail') !== checks.some(check => check.verdict === 'fail')) {
                return undefined;
        }
        return {
                $schema: VERIFICATION_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance-verification',
                extensionId: EXTENSION_ID,
                acceptanceId: value.acceptanceId,
                seq: value.seq,
                timestampEpoch: value.timestampEpoch,
                timestampIso: value.timestampIso,
                actor: value.actor,
                verdict: value.verdict,
                evidenceLabel: value.evidenceLabel as EvidenceLabel,
                checks,
                counts: { total: counts.total, pass: counts.pass, fail: counts.fail, disclosure: counts.disclosure },
        };
}

/** Reads the per-acceptance verification journal (absent when the journal file does not exist yet). */
export async function readVerificationJournal(root: string, fs: AcceptanceFsPort, acceptanceId: string): Promise<{ readonly state: 'absent' } | { readonly state: 'resolved'; readonly rows: readonly VerificationRow[] } | { readonly state: 'torn'; readonly reason: string }> {
        if (!isAcceptanceId(acceptanceId)) {
                return { state: 'torn', reason: `the acceptance id '${acceptanceId}' is not the flauz:acc:<16-hex> shape` };
        }
        const text = await fs.readFileUtf8(joinPath(root, ACCEPTANCE_DIR, `${VERIFY_PREFIX}${acceptanceId}.jsonl`));
        if (text === undefined || text === '') {
                return { state: 'absent' };
        }
        const rows: VerificationRow[] = [];
        for (const [index, line] of splitJsonl(text).entries()) {
                if (line === '') {
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch (err) {
                        return { state: 'torn', reason: `verification journal line ${String(index + 1)} is not valid JSON: ${(err as Error).message}` };
                }
                const row = parseVerificationRow(parsed);
                if (row === undefined) {
                        return { state: 'torn', reason: `verification journal line ${String(index + 1)} is not the flauz.acceptance-verification/v1 shape` };
                }
                rows.push(row);
        }
        return { state: 'resolved', rows };
}

// ---------------------------------------------------------------------------
// The status-record contract (this plane's OWN durable shape)
// ---------------------------------------------------------------------------

/** One acceptance's verdict row in the status record. */
export interface AcceptanceStatusRow {
        readonly acceptanceId: string;
        readonly revisionCount: number;
        /** The bound checklist identity (path VERBATIM + checklistId + verdict). */
        readonly checklistPath: string;
        readonly checklistId: string;
        readonly launchedAtIso: string;
        readonly owningCheckCount: number;
        /** Present when the launch bound an incident loop. */
        readonly incidentBindingState?: 'resolved' | 'disclosed-unresolvable';
        readonly incidentId?: string;
        readonly regressionTestId?: string;
        /** The receipts banked so far (the verification journal's length). */
        readonly receipts: number;
        /** The latest receipt's verdict (absent when none banked yet). */
        readonly latestReceiptVerdict?: 'pass' | 'fail';
        /** The latest receipt's disclosure count (absent when none banked yet). */
        readonly latestReceiptDisclosures?: number;
        /** The latest receipt's fail count (absent when none banked yet). */
        readonly latestReceiptFails?: number;
}

/** The persisted ledger-verdict record (schema `flauz.acceptance-status/v1`). */
export interface AcceptanceStatusRecord {
        readonly $schema: typeof STATUS_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-acceptance-status';
        readonly createdAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        /** The honest-scope disclosure, verbatim in every record. */
        readonly boundaryDisclosure: string;
        /** The acceptance ledger's typed state at the verdict's instant. */
        readonly ledgerState: 'resolved' | 'torn' | 'absent';
        readonly tornReason?: string;
        readonly acceptances: readonly AcceptanceStatusRow[];
        readonly counts: {
                readonly acceptances: number;
                readonly withReceipts: number;
                readonly latestPass: number;
                readonly latestFail: number;
                readonly incidentBound: number;
        };
}

// Re-export the globals for the command surface (single import surface).
export {
        ACCEPTANCE_SCHEMA_ID,
        VERIFICATION_SCHEMA_ID,
        STATUS_SCHEMA_ID,
        ACCEPTANCE_DIR,
        ACCEPTANCE_FILENAME,
        VERIFY_PREFIX,
        STATUS_PREFIX,
        RELEASE_DIR,
        CHECKLIST_PREFIX,
        LEDGER_PATH,
        SIZE_PATH,
        LEDGER_ROW_FORMAT_ID,
        ACCEPTANCE_TASK_ID,
        EXTENSION_ID,
        DEFAULT_CLOCK,
} from './globals.ts';
export type { Clock } from './globals.ts';
