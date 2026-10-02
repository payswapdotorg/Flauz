/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Migration -- the workspace migration/upgrade safety + rollback
 * contracts (v1).
 *
 * A-PROD-004-W3 (TL-A): the beta gate's `workspace migration/upgrade safety`
 * and `rollback` rows, built directly on W1's census (PR #128, the surface
 * enumeration) and W2's backup/export machinery (PR #133, the anchor IS a W2
 * export). The surface set this extension migrates is EXACTLY the surface set
 * that census enumerates (one surface definition per census row, the ids
 * identical, pinned by test/contract.test.ts at test time).
 *
 * THE ANCHOR-FIRST LAW (this wave's core safety): NO destructive migration
 * step may run without a verified rollback anchor -- a W2 export of the
 * CURRENT state, created and verified BEFORE the first transform. A migration
 * without a verified anchor is a typed refusal, never a warning.
 *
 * THE TORN-MIGRATION LAW: a migration interrupted mid-transform is DETECTABLE
 * (the in-progress marker + the stage-file scan + the census/verifier readers
 * report the torn state with the exact surface) and RECOVERABLE (rollback to
 * the anchor restores byte-identically; a resume-after-rollback is a FRESH
 * plan, never a blind continue -- rollback deletes the persisted plan by law).
 *
 * THE PRIVACY LAW IS SPLIT-SIDED (the W2 posture): durable-state CONTENTS
 * legitimately transit (that is a migration's job -- the anchor's state/ copy
 * and the transformed files carry them); the METADATA class (plan.json, the
 * in-progress marker, the migration/rollback records, every command render)
 * carries counts, hashes, paths and ids only, and is swept for secret-shaped
 * values before a single byte is written (fail-closed).
 *
 * Contract-duplication law (DL-32, the W2 precedent): every durable-state
 * format read by this extension is duplicated HERE as types + parsers --
 * never imported from the owning extensions (nor from flauz-diagnostics or
 * flauz-backup; a migration's verify must not depend on ANY verified code
 * being importable). The duplication is pinned by test/contract.test.ts
 * against the REAL owning modules, and the ANCHOR machinery is pinned
 * cross-recognizable with the REAL flauz-backup export/verify in BOTH
 * directions (test-time cross-extension imports are the sanctioned pin
 * pattern; src never crosses extension boundaries).
 */

// ---------------------------------------------------------------------------
// Schema ids + durable paths (the migration's own artifacts)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into every persisted migration plan. */
export const PLAN_SCHEMA_ID = 'flauz.migration-plan/v1';

/** Schema identifier pinned into the in-progress marker (the torn signal). */
export const MARKER_SCHEMA_ID = 'flauz.migration-in-progress/v0';

/** Schema identifier pinned into every banked migration record. */
export const MIGRATION_RECORD_SCHEMA_ID = 'flauz.migration-executed/v0';

/** Schema identifier pinned into every banked rollback record. */
export const ROLLBACK_RECORD_SCHEMA_ID = 'flauz.migration-rolledback/v0';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** The migration extension's own durable home (records + plan + marker; NOT census surfaces). */
export const MIGRATION_DIR = '.flauz/migration';

/** The persisted migration plan (the pre-flight artifact execute consumes). */
export const PLAN_PATH = '.flauz/migration/plan.json';

/** The in-progress marker (present = a migration is torn or in flight). */
export const MARKER_PATH = '.flauz/migration/in-progress.json';

/** The migration record bank (JSONL, one canonical record per execute). */
export const MIGRATION_LOG_PATH = '.flauz/migration/migration-log.jsonl';

/** The rollback record bank (JSONL, one canonical record per rollback). */
export const ROLLBACK_LOG_PATH = '.flauz/migration/rollback-log.jsonl';

/** The synthetic ledger taskId of the banked migration/rollback rows (the `flauz-backup` precedent). */
export const MIGRATION_TASK_ID = 'flauz-migration';

/** The stage-file suffix (sibling temp path inside the target directory; a leftover = torn). */
export const STAGE_SUFFIX = '.flauz-migration.tmp';

/** The anchor provenance pinned into the anchor export's export.json (the W2 commandLine field). */
export const ANCHOR_COMMAND_LINE = 'flauz.migration.execute';

// ---------------------------------------------------------------------------
// The anchor = a W2 export: the SAME schema ids, the SAME directory shape
// (pinned cross-recognizable with the real flauz-backup machinery in tests)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into every anchor export's export.json (the W2 id). */
export const EXPORT_SCHEMA_ID = 'flauz.backup-export/v1';

/** Schema identifier pinned into every anchor export's MANIFEST.json (the W2 id). */
export const MANIFEST_SCHEMA_ID = 'flauz.backup-manifest/v1';

/** Schema identifier pinned into every anchor export's integrity.json (the W2 id). */
export const INTEGRITY_SCHEMA_ID = 'flauz.integrity/v0';

/** The anchor export format version (the W2 export format version). */
export const EXPORT_FORMAT_VERSION = 1;

/** Directory (relative to the workspace root) holding every export (the W2 location, deliberately outside .flauz/). */
export const EXPORTS_DIR = '.flauz-exports';

/** One directory per export: `export-<stamp>/` (the stamp sorts lexicographically). */
export const EXPORT_DIR_PREFIX = 'export-';

/** The directory inside an anchor export holding the byte-identical state copy. */
export const STATE_DIR = 'state';

// --- the durable-state surface paths (read-only; each owned by its extension;
//     contract-duplicated from the owning constants, pinned by the contract suite) ---

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
export const WORKFLOW_INDEX_PATH = '.flauz/workflows/index.json';

// ---------------------------------------------------------------------------
// The surface registry: EXACTLY the W1 census enumeration, one definition per
// census row, the ids identical (pinned by test/contract.test.ts)
// ---------------------------------------------------------------------------

/** One migrated surface: the census row it mirrors, its files, its format version. */
export interface SurfaceDef {
        /** The census row id (identical to the flauz-diagnostics DurableStateCensus key). */
        readonly id: SurfaceId;
        /** Every fixed file of the surface, workspace-relative (absent files are listed absent, never faked). */
        readonly fixedFiles: readonly string[];
        /** Optional enumerated dir (the workflows envelopes): every file matching the pattern is part of the surface. */
        readonly dirFile?: { readonly dir: string; readonly pattern: RegExp };
        /** The surface's durable format version (the owning schema id, contract-duplicated). */
        readonly formatVersion: string;
}

/** The surface ids -- exactly the census's DurableStateCensus keys. */
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

/** The ledger's row-shape format id (the ledger file self-declares no schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

/**
 * The complete surface registry, in census order. THE SURFACE-SET LAW: this
 * list is the migration surface set; a surface absent in a workspace is
 * planned as absent (it will not move) and never faked.
 */
export const SURFACES: readonly SurfaceDef[] = [
        { id: 'tasks', fixedFiles: [TASKS_PATH], formatVersion: 'flauz.tasks/v0' },
        { id: 'evidenceLedger', fixedFiles: [LEDGER_PATH], formatVersion: LEDGER_ROW_FORMAT_ID },
        { id: 'evidenceWatermark', fixedFiles: [SIZE_PATH], formatVersion: 'flauz.evidence.size/v1' },
        { id: 'resourcesGraph', fixedFiles: [RESOURCES_GRAPH_PATH], formatVersion: 'flauz.resources/v0' },
        { id: 'opsChain', fixedFiles: [RESOURCES_OPS_PATH], formatVersion: 'flauz.resources-ops/v0' },
        { id: 'environmentsRegistry', fixedFiles: [ENVIRONMENTS_REGISTRY_PATH], formatVersion: 'flauz.environments/v0' },
        { id: 'browserSessions', fixedFiles: [BROWSER_SESSIONS_PATH], formatVersion: 'flauz.browser-session-journal/v0' },
        { id: 'workflows', fixedFiles: [WORKFLOW_INDEX_PATH], dirFile: { dir: WORKFLOWS_DIR, pattern: /^W-\d{3,}\.json$/ }, formatVersion: 'flauz.workflows/v1' },
        { id: 'orchestration', fixedFiles: [ORCH_GRAPHS_PATH, ORCH_JOURNAL_PATH], formatVersion: 'flauz.orch.graphs/v1 + flauz.orch.journal/v1' },
        { id: 'providerLanesState', fixedFiles: [PROVIDERS_PATH, ROUTING_POLICY_PATH, ROUTING_DECISIONS_PATH, PROVIDER_SWITCHES_PATH], formatVersion: 'flauz.model-providers/v0 + flauz.model-routing-policy/v0 + flauz.model-routing-decision/v0 + flauz.model-provider-switch/v0' },
];

// ---------------------------------------------------------------------------
// The transform registry (the compat matrix's executable side)
// ---------------------------------------------------------------------------

/**
 * One registered cross-format transform: how a surface's file content moves
 * from `fromVersion` to `toVersion`. IDENTITY steps (detected == target) are
 * NOT registry rows -- identity is the detected equivalence; the registry
 * carries only the explicit cross-format upgrades.
 *
 * HONEST SCOPE (the pinned base's real state): ZERO production transforms are
 * registered in this wave -- every surface's current format IS this build's
 * format, and inventing another extension's future format would violate the
 * boundary law (a surface's own format-version handling belongs to its owner
 * in a later wave). The registry structure + the execute/plan machinery are
 * complete and proven by tests with injected transform specs over REAL
 * surface files; the first real (from, to) pair lands with the owning wave
 * that defines it.
 */
export interface TransformSpec {
        readonly surface: SurfaceId;
        readonly fromVersion: string;
        readonly toVersion: string;
        /** Applies to ONE file's text (the same spec governs every file of the surface). */
        readonly apply: (sourcePath: string, text: string) => string;
}

/** The production transform registry: EMPTY at the pinned base (see TransformSpec's scope note). */
export const PRODUCTION_TRANSFORMS: readonly TransformSpec[] = [];

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the W2 BackupFsPort plus the
 * `remove` the rollback path owns (clearing the torn marker, the stage
 * leftovers and the persisted plan -- the fresh-plan law).
 */
export interface MigrationFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        /** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR) -- a leaf, never a crash. */
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
        appendFile(path: string, contents: string): Promise<void>;
        rename(fromPath: string, toPath: string): Promise<void>;
        /** Idempotent removal (an absent target is fine) -- the rollback cleanup surface. */
        remove(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.migration.*` render target). */
export interface OutputChannelPort {
        appendLine(line: string): void;
}

/** The product/extension versions block (wired by extension.ts; injected in tests). */
export interface VersionsInfo {
        readonly productVersion: string;
        readonly productName: string;
        readonly extensions: readonly { readonly id: string; readonly version: string }[];
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type MigrationErrorCode =
        | 'FLAUZ_MIGRATION_NO_WORKSPACE'
        | 'FLAUZ_MIGRATION_SECRET_SHAPED'
        | 'FLAUZ_MIGRATION_TORN'
        | 'FLAUZ_MIGRATION_INCOMPATIBLE'
        | 'FLAUZ_MIGRATION_NO_PLAN'
        | 'FLAUZ_MIGRATION_PLAN_STALE'
        | 'FLAUZ_MIGRATION_ANCHOR_NOT_FOUND'
        | 'FLAUZ_MIGRATION_ANCHOR_UNVERIFIED'
        | 'FLAUZ_MIGRATION_TAMPERED'
        | 'FLAUZ_MIGRATION_NO_MIGRATION'
        | 'FLAUZ_MIGRATION_TARGET_NOT_EMPTY'
        | 'FLAUZ_MIGRATION_FORMAT';

/** Typed migration failure. `code` is stable; `detail` carries the class laws. */
export class MigrationError extends Error {
        readonly code: MigrationErrorCode;

        constructor(code: MigrationErrorCode, message: string) {
                super(message);
                this.name = 'MigrationError';
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
        throw new Error(`flauz.migration/v1: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
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
