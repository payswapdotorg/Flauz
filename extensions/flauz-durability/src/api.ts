/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Durability -- the long-running worker supervision plane
 * (A-PROD-005-W4, the wave the W1 production gate's workerDurability
 * NOT-YET row names -- the gate's LAST refusal).
 *
 * THE WAVE'S LAW: this extension owns the RECORD-KEEPING + VERDICT machinery
 * for long-running worker durability -- the supervised lane registry (typed
 * lane records with heartbeat interval, staleness threshold and escalation
 * policy), the worker's own liveness signal (the heartbeat stamping a bounded
 * ring of beat history with the injected clock, classified LIVE / STALE /
 * FLAT / UNKNOWN -- typed, never a guessed verdict), and the supervision
 * verdict (every registered lane with its liveness class, its beat-history
 * shape, its escalation state and its CHECKPOINT LAW consultation: the
 * workspace-bound record surfaces the lane's owning extension owns through
 * the W3 isolation audit's derivation surfaces, read-only, plus the W2
 * backup plane's export anchor when one exists).
 *
 * THE HONEST-BOUNDARY DISCLOSURE (stated in every command render and every
 * record): this extension proves the RECORD-KEEPING + VERDICT machinery.
 * The EXECUTION of an actual restart routes through the owning task's own
 * machinery -- the escalation machinery RECORDS the demand (what the lane's
 * policy demands), it never spawns, kills or restarts anything. Cross-process
 * supervision is the host's orchestration posture, outside this plane's
 * jurisdiction (disclosed, never claimed) -- the same posture as the W3
 * wave's host-isolation disclosure. Evidence level: local-real (fixture
 * lanes with real heartbeat histories through the injected clock; the
 * checkpoint-law consultation over fixture workspaces carrying real record
 * surfaces + a real W2 export anchor). Never claim runtime-real for
 * cross-process supervision.
 *
 * THE PRIVACY LAW IS THE METADATA LAW (the W1/W2/W3/W5 posture): every
 * surface this extension produces -- the lanes registry, the heartbeat
 * records, the status records, the banked evidence rows -- enumerates
 * surface SHAPES (lane ids, owning extension names, heartbeat stamps,
 * verdicts, counts, interval statistics) and NEVER CONTENTS and never
 * credentials. Every metadata surface is swept for secret-shaped values
 * before a single byte is written (fail-closed, the W2 canary posture).
 * Records carry WORKSPACE-RELATIVE paths only (never absolute host paths,
 * never file contents).
 *
 * Contract-duplication law (DL-32, the flauz-diagnostics/flauz-release/
 * flauz-production/flauz-integrity/flauz-isolation precedent): every
 * durable-state format + sibling extension state this extension consults is
 * duplicated HERE as types + parsers -- never imported from the owning
 * extensions at src time (the boundary law). The duplication is pinned by
 * test/contract.test.ts against the REAL owning modules (test-time
 * cross-extension imports are the sanctioned pin pattern; src never crosses
 * extension boundaries).
 */

/** Schema identifier pinned into the lane registry (the order's id, verbatim). */
export const LANES_SCHEMA_ID = 'flauz.durability-lanes/v1';

/** Schema identifier pinned into every heartbeat record (the order's id, verbatim). */
export const HEARTBEAT_SCHEMA_ID = 'flauz.durability-heartbeat/v1';

/** Schema identifier pinned into every supervision-verdict record (the order's id, verbatim). */
export const STATUS_SCHEMA_ID = 'flauz.durability-status/v1';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** This extension's own durable home (the lane registry + the heartbeat + status records). */
export const DURABILITY_DIR = '.flauz/durability';

/** The lane registry filename (a FIXED file, the registry every command consults). */
export const LANES_FILENAME = 'lanes.json';

/** The heartbeat record filename prefix: `heartbeat-<stamp>.json`. */
export const HEARTBEAT_PREFIX = 'heartbeat-';

/** The status record filename prefix: `status-<stamp>.json`. */
export const STATUS_PREFIX = 'status-';

/** The bounded ring's capacity: the last N beat stamps a lane record carries. */
export const BEAT_RING_CAP = 32;

/** The synthetic ledger taskId of the banked durability rows (the flauz-backup/flauz-migration/flauz-telemetry/flauz-release/flauz-production/flauz-integrity/flauz-isolation precedent). */
export const DURABILITY_TASK_ID = 'flauz-durability';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-durability';

// --- the escalation policies (the order's law, verbatim semantics) ---

/** The escalation policy a lane's supervision demands when liveness degrades. */
export type EscalationPolicy = 'notify' | 'checkpoint-and-restart' | 'refuse';

/** Every lawful escalation policy (the typed refusal surface). */
export const ESCALATION_POLICIES: readonly EscalationPolicy[] = ['notify', 'checkpoint-and-restart', 'refuse'];

// --- the liveness classes + the supervision verdicts (the order's law) ---

/** The liveness class of a lane at an evaluation instant. */
export type LivenessClass = 'LIVE' | 'STALE' | 'FLAT' | 'UNKNOWN';

/** The supervision verdict of a lane (the status record's typed table). */
export type SupervisionVerdict = 'supervised-green' | 'stale' | 'flat' | 'unknown' | 'degraded';

// --- the durable-state banking surfaces (read-only; owned by flauz-workspace;
//     contract-duplicated from the owning constants, pinned by the contract suite) ---

export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the ledger file self-declares no $schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

// --- the W3 isolation audit consultation surface (read-only; owned by
//     flauz-isolation; contract-duplicated from the owning constants + shapes,
//     pinned by the contract suite) ---

/** The isolation extension's durable home (the audit records this plane consults). */
export const ISOLATION_DIR = '.flauz/isolation';

/** The isolation boundary-audit record filename prefix: `audit-<stamp>.json`. */
export const ISOLATION_AUDIT_PREFIX = 'audit-';

/** The isolation audit record's schema id (the consulted contract's owning pin). */
export const ISOLATION_AUDIT_SCHEMA_ID = 'flauz-isolation-audit/v1';

// --- the W2 backup export anchor surface (read-only; owned by flauz-backup;
//     contract-duplicated from the owning constants + shapes, pinned by the
//     contract suite) ---

/**
 * Directory (relative to the workspace root) holding every export, one
 * directory per export: `<root>/.flauz-exports/export-<stamp>/` (the W2
 * backup law, contract-duplicated: an export must never recurse into
 * itself -- DELIBERATELY outside `.flauz/`, never inside it).
 */
export const EXPORTS_DIR = '.flauz-exports';

/** One directory per export: `export-<stamp>/` (the stamp sorts lexicographically). */
export const EXPORT_DIR_PREFIX = 'export-';

/** The export metadata artifact inside every export directory (the anchor's owning pin). */
export const EXPORT_METADATA_FILENAME = 'export.json';

/** The export metadata artifact's schema id (the W2 anchor contract's owning pin). */
export const EXPORT_METADATA_SCHEMA_ID = 'flauz.backup-export/v1';

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the read surface (UTF-8 text +
 * directory listings) plus the writes its OWN artifacts own (the lane
 * registry, the heartbeat records, the status records, the census-visible
 * ledger banking).
 */
export interface DurabilityFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        /** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
        appendFile(path: string, contents: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.durability.*` render target). */
export interface OutputChannelPort {
        appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type DurabilityErrorCode =
        | 'FLAUZ_DURABILITY_NO_WORKSPACE'
        | 'FLAUZ_DURABILITY_UNKNOWN_LANE'
        | 'FLAUZ_DURABILITY_BAD_ARGS'
        | 'FLAUZ_DURABILITY_SECRET_SHAPED'
        | 'FLAUZ_DURABILITY_FORMAT';

/** Typed durability failure. `code` is stable; `detail` carries the class laws. */
export class DurabilityError extends Error {
        readonly code: DurabilityErrorCode;

        constructor(code: DurabilityErrorCode, message: string) {
                super(message);
                this.name = 'DurabilityError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace/api.ts
// via flauz-release/flauz-production/flauz-integrity/flauz-isolation; pinned
// byte-equal by test/contract.test.ts -- never imported across extensions)
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
        throw new Error('flauz.durability/v1: cannot canonicalize value of type ' + typeof value + ' (payloads must be JSON-safe)');
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
 * flauz-production/flauz-integrity/flauz-isolation implementations
 * (implemented locally instead of node:crypto so the core stays free of node
 * typings and runtime deps); pinned byte-equal against node:crypto AND the
 * owning implementations in test/contract.test.ts.
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
// via flauz-release/flauz-production/flauz-integrity/flauz-isolation; the
// banking path + the banked-record taskId law consume exactly these)
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

// ---------------------------------------------------------------------------
// The lane registry contract (this plane's OWN durable shape)
// ---------------------------------------------------------------------------

/** One supervised worker lane (the typed lane record the order names). */
export interface LaneRecord {
        /** The lane's unique id (re-registering an id refreshes its policy, never duplicates). */
        readonly laneId: string;
        /** The owning task/extension (the checkpoint-law consultation's subject). */
        readonly owner: string;
        /** The heartbeat interval the lane's worker promised (ms). */
        readonly heartbeatIntervalMs: number;
        /** The staleness threshold: a beat gap past this is STALE (ms). */
        readonly stalenessThresholdMs: number;
        /** The escalation policy demanded when liveness degrades. */
        readonly escalationPolicy: EscalationPolicy;
        readonly registeredAt: number;
        readonly updatedAt: number;
        /** The bounded ring: the last N beat stamps (BEAT_RING_CAP; ascending). */
        readonly beats: readonly number[];
        /** How many beats the lane has ever recorded (the ring is the last N only). */
        readonly totalBeats: number;
        /** The escalation-demand state (what the policy demanded, recorded -- never executed here). */
        readonly escalation: {
                readonly policy: EscalationPolicy;
                readonly demandCount: number;
                readonly lastDemandAt?: number;
        };
}

/** The persisted lane registry (schema `flauz.durability-lanes/v1`). */
export interface LanesRecord {
        readonly $schema: typeof LANES_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-durability-lanes';
        readonly createdAt: number;
        readonly updatedAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        readonly lanes: readonly LaneRecord[];
}

const LANES_KIND = 'flauz-durability-lanes';

/** Lenient parse of a stored lane row (undefined + reason when not the owning shape -- typed, never guessed). */
export type LaneParseOutcome =
        | { readonly ok: true; readonly lane: LaneRecord }
        | { readonly ok: false; readonly laneId: string | undefined; readonly reason: string };

function parseEscalationPolicy(value: unknown): EscalationPolicy | undefined {
        return typeof value === 'string' && (ESCALATION_POLICIES as readonly string[]).includes(value) ? (value as EscalationPolicy) : undefined;
}

function positiveInt(value: unknown): value is number {
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Non-negative safe integer (the counters a fresh lane legitimately zeroes). */
function nonNegativeInt(value: unknown): value is number {
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strict parse of one lane row (value-level: structure + types; the torn-row typed-unknown source). */
export function parseLaneRow(value: unknown): LaneParseOutcome {
        if (!isPlainObject(value)) {
                return { ok: false, laneId: undefined, reason: 'the lane row is not a JSON object' };
        }
        const laneId = typeof value.laneId === 'string' ? value.laneId : undefined;
        if (typeof value.laneId !== 'string' || value.laneId.length === 0) {
                return { ok: false, laneId, reason: 'laneId must be a non-empty string' };
        }
        if (typeof value.owner !== 'string' || value.owner.length === 0) {
                return { ok: false, laneId, reason: 'owner must be a non-empty string' };
        }
        if (!positiveInt(value.heartbeatIntervalMs)) {
                return { ok: false, laneId, reason: 'heartbeatIntervalMs must be a positive integer' };
        }
        if (!positiveInt(value.stalenessThresholdMs)) {
                return { ok: false, laneId, reason: 'stalenessThresholdMs must be a positive integer' };
        }
        const escalationPolicy = parseEscalationPolicy(value.escalationPolicy);
        if (escalationPolicy === undefined) {
                return { ok: false, laneId, reason: `escalationPolicy must be one of ${ESCALATION_POLICIES.join('|')}` };
        }
        if (!positiveInt(value.registeredAt) || !positiveInt(value.updatedAt)) {
                return { ok: false, laneId, reason: 'registeredAt/updatedAt must be positive integers' };
        }
        if (!Array.isArray(value.beats) || !value.beats.every(stamp => positiveInt(stamp))) {
                return { ok: false, laneId, reason: 'beats must be an array of positive-integer stamps' };
        }
        if (!nonNegativeInt(value.totalBeats) || value.totalBeats < value.beats.length) {
                return { ok: false, laneId, reason: 'totalBeats must be a non-negative integer >= the ring length' };
        }
        const escalation = value.escalation;
        if (!isPlainObject(escalation) || parseEscalationPolicy(escalation.policy) !== escalationPolicy || !nonNegativeInt(escalation.demandCount)) {
                return { ok: false, laneId, reason: 'escalation must carry the lane policy + a non-negative demand count' };
        }
        if (escalation.lastDemandAt !== undefined && !positiveInt(escalation.lastDemandAt)) {
                return { ok: false, laneId, reason: 'escalation.lastDemandAt must be a positive integer when present' };
        }
        return {
                ok: true,
                lane: {
                        laneId: value.laneId,
                        owner: value.owner,
                        heartbeatIntervalMs: value.heartbeatIntervalMs,
                        stalenessThresholdMs: value.stalenessThresholdMs,
                        escalationPolicy,
                        registeredAt: value.registeredAt,
                        updatedAt: value.updatedAt,
                        beats: [...(value.beats as number[])].sort((a, b) => a - b),
                        totalBeats: value.totalBeats,
                        escalation: {
                                policy: escalationPolicy,
                                demandCount: escalation.demandCount,
                                ...(escalation.lastDemandAt !== undefined ? { lastDemandAt: escalation.lastDemandAt } : {}),
                        },
                },
        };
}

/** The lanes registry's read outcome (absent / torn / resolved -- typed, never guessed). */
export type LanesRegistryState =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly record: LanesRecord; readonly tornLaneIds: readonly string[] };

/** Reads + parses the lane registry from a workspace root (typed at every degradation). */
export async function readLanesRegistry(root: string, fs: DurabilityFsPort): Promise<LanesRegistryState> {
        const text = await fs.readFileUtf8(joinPath(root, DURABILITY_DIR, LANES_FILENAME));
        if (text === undefined) {
                return { state: 'absent' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `lanes.json is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed) || parsed.$schema !== LANES_SCHEMA_ID || parsed.kind !== LANES_KIND || !Array.isArray(parsed.lanes)) {
                return { state: 'torn', reason: 'lanes.json is not the flauz.durability-lanes/v1 shape' };
        }
        const lanes: LaneRecord[] = [];
        const tornLaneIds: string[] = [];
        for (const row of parsed.lanes) {
                const outcome = parseLaneRow(row);
                if (outcome.ok) {
                        lanes.push(outcome.lane);
                } else {
                        tornLaneIds.push(outcome.laneId ?? '(unnamed)');
                }
        }
        return {
                state: 'resolved',
                record: {
                        $schema: LANES_SCHEMA_ID,
                        schemaVersion: 0,
                        kind: LANES_KIND,
                        createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
                        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
                        extensionId: EXTENSION_ID,
                        lanes,
                },
                tornLaneIds,
        };
}

// ---------------------------------------------------------------------------
// The W3 isolation-audit consultation contract (contract-duplicated from
// flauz-isolation/src/audit.ts; pinned by the contract suite -- never
// imported across extensions)
// ---------------------------------------------------------------------------

/** One classified surface row of the isolation audit record (the consulted shape, duplicated). */
export interface IsolationAuditSurfaceRow {
        readonly id: string;
        readonly owner: string;
        readonly classification: 'workspace-bound' | 'workspace-exportable' | 'port-owned';
        readonly boundary: string;
        readonly paths: readonly string[];
        readonly present: boolean;
}

/** The consulted slice of the isolation audit record (the derivation surfaces, read-only). */
export interface IsolationAuditConsultation {
        readonly surfaces: readonly IsolationAuditSurfaceRow[];
        readonly unknownExtensions: readonly { readonly owner: string; readonly reason: string }[];
        readonly consultedRecord: string;
}

/** The newest-record resolution outcome (typed at every degradation). */
export type ConsultationState =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly consultation: IsolationAuditConsultation };

/** The stamp shape every record filename suffix carries (the export-stamp convention, duplicated). */
export const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/;

/**
 * Resolves the newest isolation audit record under `.flauz/isolation/` and
 * parses the consulted slice (the derivation surfaces + the typed UNKNOWN
 * extension disclosures). Absent / torn are typed, never guessed.
 */
export async function consultIsolationAudit(root: string, fs: DurabilityFsPort): Promise<ConsultationState> {
        const entries = await fs.readdir(joinPath(root, ISOLATION_DIR));
        if (entries === undefined) {
                return { state: 'absent' };
        }
        const stamps = [...entries]
                .filter(name => name.startsWith(ISOLATION_AUDIT_PREFIX) && name.endsWith('.json'))
                .map(name => name.slice(ISOLATION_AUDIT_PREFIX.length, -5))
                .filter(stamp => STAMP_SHAPE.test(stamp))
                .sort();
        const newest = stamps[stamps.length - 1];
        if (newest === undefined) {
                return { state: 'absent' };
        }
        const recordName = `${ISOLATION_AUDIT_PREFIX}${newest}.json`;
        const text = await fs.readFileUtf8(joinPath(root, ISOLATION_DIR, recordName));
        if (text === undefined) {
                return { state: 'torn', reason: `the newest audit record ${recordName} vanished between the listing and the read` };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `the newest audit record ${recordName} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed) || parsed.$schema !== ISOLATION_AUDIT_SCHEMA_ID || !Array.isArray(parsed.surfaces)) {
                return { state: 'torn', reason: `the newest audit record ${recordName} is not the flauz-isolation-audit/v1 shape` };
        }
        const surfaces: IsolationAuditSurfaceRow[] = [];
        for (const row of parsed.surfaces) {
                if (
                        isPlainObject(row) && typeof row.id === 'string' && typeof row.owner === 'string' &&
                        (row.classification === 'workspace-bound' || row.classification === 'workspace-exportable' || row.classification === 'port-owned') &&
                        typeof row.boundary === 'string' && Array.isArray(row.paths) && row.paths.every(p => typeof p === 'string') &&
                        typeof row.present === 'boolean'
                ) {
                        surfaces.push({
                                id: row.id,
                                owner: row.owner,
                                classification: row.classification,
                                boundary: row.boundary,
                                paths: [...(row.paths as string[])],
                                present: row.present,
                        });
                }
        }
        const unknownExtensions: { owner: string; reason: string }[] = [];
        if (Array.isArray(parsed.unknownExtensions)) {
                for (const row of parsed.unknownExtensions) {
                        if (isPlainObject(row) && typeof row.owner === 'string' && typeof row.reason === 'string') {
                                unknownExtensions.push({ owner: row.owner, reason: row.reason });
                        }
                }
        }
        return { state: 'resolved', consultation: { surfaces, unknownExtensions, consultedRecord: joinPath(ISOLATION_DIR, recordName) } };
}

// ---------------------------------------------------------------------------
// The W2 backup export-anchor contract (contract-duplicated from
// flauz-backup/src/api.ts + export.ts; pinned by the contract suite)
// ---------------------------------------------------------------------------

/** The resolved export anchor (a banked export the lane's workspace resolves). */
export interface ExportAnchor {
        readonly present: boolean;
        readonly exportDirName?: string;
        readonly createdAt?: number;
}

/** The export-anchor resolution outcome (present / absent / torn -- typed). */
export type ExportAnchorState =
        | { readonly state: 'present'; readonly anchor: ExportAnchor }
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string };

/**
 * Resolves the newest banked export under `.flauz-exports/` (the W2 plane's
 * anchor): reads the newest `export-<stamp>/export.json` and parses the
 * owning metadata shape (flauz.backup-export/v1). Absence is honest (an
 * anchor exists only when the operator banked one); a torn newest export is
 * typed, never guessed.
 */
export async function resolveExportAnchor(root: string, fs: DurabilityFsPort): Promise<ExportAnchorState> {
        const entries = await fs.readdir(joinPath(root, EXPORTS_DIR));
        if (entries === undefined) {
                return { state: 'absent' };
        }
        const stamps = [...entries]
                .filter(name => name.startsWith(EXPORT_DIR_PREFIX))
                .map(name => name.slice(EXPORT_DIR_PREFIX.length))
                .filter(stamp => STAMP_SHAPE.test(stamp))
                .sort();
        const newest = stamps[stamps.length - 1];
        if (newest === undefined) {
                return { state: 'absent' };
        }
        const exportDirName = `${EXPORT_DIR_PREFIX}${newest}`;
        const text = await fs.readFileUtf8(joinPath(root, EXPORTS_DIR, exportDirName, EXPORT_METADATA_FILENAME));
        if (text === undefined) {
                return { state: 'torn', reason: `the newest export ${exportDirName} carries no readable ${EXPORT_METADATA_FILENAME}` };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `the newest export ${exportDirName}'s ${EXPORT_METADATA_FILENAME} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed) || parsed.$schema !== EXPORT_METADATA_SCHEMA_ID || typeof parsed.createdAt !== 'number') {
                return { state: 'torn', reason: `the newest export ${exportDirName}'s ${EXPORT_METADATA_FILENAME} is not the flauz.backup-export/v1 shape` };
        }
        return { state: 'present', anchor: { present: true, exportDirName, createdAt: parsed.createdAt } };
}
