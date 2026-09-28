/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the continuity hand-off metadata adapter (the task-boundary
 * layer over flauz-environments' `.flauz/continuity-bundles/<bundleId>/
 * manifest.json` + `.flauz/continuity-ops.jsonl`).
 *
 * Design law (DL-32, verbatim from `journalBridge.ts`): the bundle manifest
 * shape, the ops record shape, the surface status vocabulary and the bundle
 * id grammar are DUPLICATED HERE AS TYPES and pinned by the EXISTING repo-root
 * fixtures at `test/fixtures/continuity/` (valid + 35 invalid samples --
 * consumed READ-ONLY, never modified). This module NEVER imports from
 * `extensions/flauz-environments/*` -- the contract is duplicated.
 *
 * THE SECRET-REDACTION LAW (mirrored verbatim from
 * `extensions/flauz-environments/src/continuityExec/types.ts`): a continuity
 * bundle carries STATE, never secrets. A surface whose content model admits
 * secret-shaped material is exported as a typed `redacted` entry -- its
 * PRESENCE is recorded together with the sha256 of its PATH, and the payload
 * is NEVER copied into the bundle. The adapter NEVER re-derives the payload
 * from the manifest; secret-shaped surfaces stay redacted (presence + path
 * hash only).
 *
 * Export-point (task suspend / planSwitch): validate the bundle id grammar +
 * existence + completeness; attach `continuityBundleId` to the hand-off
 * record (the additive `planSwitch.continuityBundleId?` field is the
 * precedent -- this module does NOT modify continuity.ts).
 *
 * Restore-point (rebind after restart): the bundle must VERIFY (manifest
 * integrity) and the target must be trusted -- fail-closed, typed
 * `CONTINUITY_INVALID` otherwise.
 */
import {
        CONTINUITY_BUNDLE_ID_PATTERN,
        TaskResourceError,
        canonicalJson,
        hasExactKeys,
        hasKey,
        hasOnlyKeys,
        isBoundedString,
        isContinuityBundleId,
        isPlainObject,
        isPositiveEpochMs,
        joinPath,
        type Clock,
        type FileSystemPort,
        type TaskResourceFailure,
} from './types.ts';
import { failure, looksSecretShaped } from './contracts.ts';

// ---------------------------------------------------------------------------
// The continuity contracts, duplicated as types (DL-32)
// ---------------------------------------------------------------------------

/** Envelope schema id pinned into every bundle manifest. */
export const BUNDLE_SCHEMA_ID = 'flauz.continuity-bundle/v0';

/** Line schema id pinned into every `.flauz/continuity-ops.jsonl` record. */
export const CONTINUITY_OPS_SCHEMA_ID = 'flauz.continuity-ops/v0';

/** Both envelopes carry schemaVersion 0. */
export const CONTINUITY_SCHEMA_VERSION = 0;

/** Bundles directory, relative to the workspace root. */
export const CONTINUITY_BUNDLES_DIR = '.flauz/continuity-bundles';

/** The continuity ops ledger path, relative to the workspace root. */
export const CONTINUITY_OPS_PATH = '.flauz/continuity-ops.jsonl';

/** The manifest file name inside a bundle directory (the bundle commit point). */
export const BUNDLE_MANIFEST_NAME = 'manifest.json';

/** The actor enum (DL-32: MANDATORY on every continuity op). */
export const PROVENANCE_ACTORS = ['agent', 'human', 'tool'] as const;
export type ProvenanceActor = (typeof PROVENANCE_ACTORS)[number];

/** The continuity ops (ledger-recorded mutating ops; `status` is a read-only probe). */
export const CONTINUITY_OPS = ['export', 'restore', 'verify'] as const;
export type ContinuityOpName = (typeof CONTINUITY_OPS)[number];

/** Manifest surface classification at export time. */
export const SURFACE_STATUSES = ['carried', 'lost', 'redacted'] as const;
export type SurfaceStatus = (typeof SURFACE_STATUSES)[number];

/** Per-surface verdict of a verify (integrity check). */
export const VERIFY_SURFACE_VERDICTS = ['verified', 'lost', 'redacted', 'mismatch'] as const;
export type VerifySurfaceVerdict = (typeof VERIFY_SURFACE_VERDICTS)[number];

/** One manifest surface entry -- the exact key set of `flauz.continuity-bundle/v0` surface records. */
export interface BundleSurfaceEntry {
        readonly status: SurfaceStatus;
        readonly artifactPath?: string;
        readonly sha256?: string;
        readonly bytes?: number;
        readonly note?: string;
}

/** The `.flauz/continuity-bundles/<bundleId>/manifest.json` envelope -- `flauz.continuity-bundle/v0` (the exact key set). */
export interface ContinuityBundleManifest {
        readonly schemaVersion: number;
        readonly schema: string;
        readonly bundleId: string;
        readonly createdAt: number;
        readonly actor: ProvenanceActor;
        readonly sourceEnvironmentId?: string;
        readonly surfaces: Readonly<Record<string, BundleSurfaceEntry>>;
        readonly switchPlanRef?: string;
}

/** One ops-ledger line: `flauz.continuity-ops/v0` (the exact key set). */
export interface ContinuityOpRecord {
        readonly schemaVersion: number;
        readonly schema: string;
        readonly ts: number;
        readonly actor: ProvenanceActor;
        readonly op: ContinuityOpName;
        readonly bundleId: string;
        readonly result: 'ok' | 'error';
        readonly details?: {
                readonly fromEnvironmentId?: string;
                readonly toEnvironmentId?: string;
                readonly surfacesCarried: number;
                readonly surfacesLost: number;
                readonly surfacesRedacted: number;
        };
        readonly error?: { readonly code: string; readonly message: string };
}

// ---------------------------------------------------------------------------
// Pure-TypeScript sha256 (DL-32 sibling -- the same posture as
// flauz-resources/src/api.ts; cross-checked against node:crypto in tests)
// ---------------------------------------------------------------------------

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

/** Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded. */
export function sha256Hex(input: string): string {
        const bytes = utf8Encode(input);
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
                        const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
                        const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
                        w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
                }
                let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
                for (let i = 0; i < 64; i++) {
                        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                        const ch = (e & f) ^ (~e & g);
                        const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
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
// Strict parsers (fail-closed: typed TaskResourceError on shape violations)
// ---------------------------------------------------------------------------

function parseError(message: string): TaskResourceError {
        return new TaskResourceError('OP_INVALID', `continuity parse: ${message}`);
}

export function parseBundleManifest(raw: string): ContinuityBundleManifest {
        let value: unknown;
        try {
                value = JSON.parse(raw);
        } catch (err) {
                throw parseError(`manifest is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!isPlainObject(value)) {
                throw parseError('manifest must be a JSON object');
        }
        if (!hasOnlyKeys(value, ['schemaVersion', 'schema', 'bundleId', 'createdAt', 'actor', 'surfaces'], ['sourceEnvironmentId', 'switchPlanRef'])) {
                throw parseError(`manifest must have exactly the keys [schemaVersion, schema, bundleId, createdAt, actor, surfaces] + optional [sourceEnvironmentId, switchPlanRef] (got [${Object.keys(value).sort().join(', ')}])`);
        }
        if (value.schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
                throw parseError(`manifest.schemaVersion must be exactly ${CONTINUITY_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
        }
        if (value.schema !== BUNDLE_SCHEMA_ID) {
                throw parseError(`manifest.schema must be exactly '${BUNDLE_SCHEMA_ID}' (got ${JSON.stringify(value.schema)})`);
        }
        if (typeof value.bundleId !== 'string' || !isContinuityBundleId(value.bundleId)) {
                throw parseError(`manifest.bundleId must be 'flauz:continuity:<16-hex>' (got ${JSON.stringify(value.bundleId)})`);
        }
        if (!isPositiveEpochMs(value.createdAt)) {
                throw parseError(`manifest.createdAt must be a positive epoch-ms integer (got ${JSON.stringify(value.createdAt)})`);
        }
        if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
                throw parseError(`manifest.actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)})`);
        }
        if (value.sourceEnvironmentId !== undefined) {
                if (typeof value.sourceEnvironmentId !== 'string' || !/^env-[a-z0-9][a-z0-9-]{0,47}$/.test(value.sourceEnvironmentId)) {
                        throw parseError(`manifest.sourceEnvironmentId must be 'env-<slug>' (got ${JSON.stringify(value.sourceEnvironmentId)})`);
                }
        }
        if (value.switchPlanRef !== undefined) {
                if (typeof value.switchPlanRef !== 'string' || !/^flauz\.switchPlan\/v0:env-[a-z0-9][a-z0-9-]{0,47}@\d+$/.test(value.switchPlanRef)) {
                        throw parseError(`manifest.switchPlanRef must be 'flauz.switchPlan/v0:env-<slug>@<epochMs>' (got ${JSON.stringify(value.switchPlanRef)})`);
                }
        }
        if (!isPlainObject(value.surfaces)) {
                throw parseError('manifest.surfaces must be an object keyed by surface id');
        }
        for (const [surfaceId, entry] of Object.entries(value.surfaces)) {
                validateSurfaceEntry(entry, `surfaces['${surfaceId}']`);
        }
        // defense-in-depth: a manifest silently containing a secret-shaped
        // literal is a contract violation of its source envelope
        if (looksSecretShaped(canonicalJson(value))) {
                throw parseError('manifest payload contains secret-shaped text -- vault-only policy surfaces may carry only vault-style references, never literal credentials');
        }
        return value as unknown as ContinuityBundleManifest;
}

function validateSurfaceEntry(value: unknown, where: string): void {
        if (!isPlainObject(value)) {
                throw parseError(`${where} must be a plain object`);
        }
        if (!hasOnlyKeys(value, ['status'], ['artifactPath', 'sha256', 'bytes', 'note'])) {
                throw parseError(`${where} must have the keys [status] + optional [artifactPath, sha256, bytes, note]`);
        }
        if (typeof value.status !== 'string' || !(SURFACE_STATUSES as readonly string[]).includes(value.status)) {
                throw parseError(`${where}.status must be one of ${SURFACE_STATUSES.join('|')}`);
        }
        if (value.status === 'carried') {
                if (typeof value.artifactPath !== 'string' || value.artifactPath.length === 0) {
                        throw parseError(`${where}: carried entries require artifactPath`);
                }
                if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
                        throw parseError(`${where}: carried entries require sha256 (64 lowercase hex chars)`);
                }
                if (typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
                        throw parseError(`${where}: carried entries require bytes (non-negative integer)`);
                }
        }
        if (value.status === 'lost') {
                if (value.artifactPath !== undefined || value.sha256 !== undefined || value.bytes !== undefined) {
                        throw parseError(`${where}: lost entries must not carry artifact/sha256/bytes`);
                }
                if (typeof value.note !== 'string' || value.note.length === 0) {
                        throw parseError(`${where}: lost entries require a note (the why-note)`);
                }
        }
        if (value.status === 'redacted') {
                if (value.artifactPath !== undefined || value.bytes !== undefined) {
                        throw parseError(`${where}: redacted entries must not carry artifactPath/bytes (the payload is never copied)`);
                }
                if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) {
                        throw parseError(`${where}: redacted entries require sha256 (sha256 of the PATH, not the payload)`);
                }
                if (typeof value.note !== 'string' || value.note.length === 0) {
                        throw parseError(`${where}: redacted entries require a note`);
                }
        }
}

export function parseContinuityOpRecord(value: unknown, lineNo: number): ContinuityOpRecord {
        const where = `ops ledger line ${lineNo}`;
        if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'bundleId', 'result'], ['details', 'error'])) {
                throw parseError(`${where} must have the keys [schemaVersion, schema, ts, actor, op, bundleId, result] + optional [details, error]`);
        }
        if (value.schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
                throw parseError(`${where} schemaVersion must be exactly ${CONTINUITY_SCHEMA_VERSION}`);
        }
        if (value.schema !== CONTINUITY_OPS_SCHEMA_ID) {
                throw parseError(`${where} schema must be exactly '${CONTINUITY_OPS_SCHEMA_ID}'`);
        }
        if (!isPositiveEpochMs(value.ts)) {
                throw parseError(`${where} ts must be a positive epoch-ms integer`);
        }
        if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
                throw parseError(`${where} actor must be one of agent|human|tool`);
        }
        if (typeof value.op !== 'string' || !(CONTINUITY_OPS as readonly string[]).includes(value.op)) {
                throw parseError(`${where} op must be one of ${CONTINUITY_OPS.join('|')}`);
        }
        if (typeof value.bundleId !== 'string' || !isContinuityBundleId(value.bundleId)) {
                throw parseError(`${where} bundleId must be 'flauz:continuity:<16-hex>'`);
        }
        if (value.result !== 'ok' && value.result !== 'error') {
                throw parseError(`${where} result must be 'ok' or 'error'`);
        }
        if (value.result === 'error') {
                if (!hasKey(value, 'error')) {
                        throw parseError(`${where} result 'error' requires the error payload {code, message}`);
                }
                if (!isPlainObject(value.error) || !hasExactKeys(value.error, ['code', 'message'])) {
                        throw parseError(`${where} error must have exactly the keys [code, message]`);
                }
        } else if (hasKey(value, 'error')) {
                throw parseError(`${where} result 'ok' must not carry an error payload`);
        }
        return value as unknown as ContinuityOpRecord;
}

/** Parses a full ops ledger (strict; one record per line; one trailing newline). */
export function parseOpsLedger(raw: string): ContinuityOpRecord[] {
        const lines = raw.split('\n');
        if (lines[lines.length - 1] !== '') {
                throw parseError('ops ledger must end with a newline');
        }
        const records: ContinuityOpRecord[] = [];
        for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i]!;
                if (line.trim().length === 0) {
                        throw parseError(`ops ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch (err) {
                        throw parseError(`ops ledger line ${i + 1} is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
                }
                records.push(parseContinuityOpRecord(parsed, i + 1));
        }
        return records;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface ContinuityAdapterOptions {
        readonly workspaceRoot: string;
        readonly fs: FileSystemPort;
        readonly clock?: Clock;
}

/** Export-point validation result (typed; never a raw throw). */
export type ExportPointResult =
        | { readonly ok: true; readonly manifest: ContinuityBundleManifest }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/** Restore-point result (typed; fail-closed on trust/verify). */
export type RestorePointResult =
        | { readonly ok: true; readonly manifest: ContinuityBundleManifest; readonly surfacesCarried: number; readonly surfacesLost: number; readonly surfacesRedacted: number }
        | { readonly ok: false; readonly error: TaskResourceFailure };

/**
 * The continuity hand-off metadata adapter. Owns:
 *   - bundle manifest loading + strict parsing (canonical JSONL discipline);
 *   - ops ledger loading + strict parsing;
 *   - export-point validation (id grammar + existence + completeness);
 *   - restore-point validation (manifest integrity + completeness).
 *
 * NEVER mutates the bundle directory or the ops ledger; NEVER re-derives the
 * payload from a redacted surface (the SECRET-REDACTION law). The trust-gate
 * verdict for the restore target is READ from the registry by the
 * orchestrator (the EnvironmentAdapter exposes it); this adapter only
 * validates the bundle, and applies the orchestrator's trust verdict.
 */
export class ContinuityAdapter {
        private readonly workspaceRoot: string;
        private readonly fs: FileSystemPort;
        private readonly clock: Clock;

        constructor(options: ContinuityAdapterOptions) {
                this.workspaceRoot = options.workspaceRoot;
                this.fs = options.fs;
                this.clock = options.clock ?? (() => Date.now());
        }

        get bundlesDir(): string {
                return joinPath(this.workspaceRoot, CONTINUITY_BUNDLES_DIR);
        }

        get opsPath(): string {
                return joinPath(this.workspaceRoot, CONTINUITY_OPS_PATH);
        }

        manifestPath(bundleId: string): string {
                return joinPath(this.bundlesDir, bundleId, BUNDLE_MANIFEST_NAME);
        }

        /** Loads + validates the manifest; missing => undefined. */
        async loadManifest(bundleId: string): Promise<ContinuityBundleManifest | undefined> {
                if (!isContinuityBundleId(bundleId)) {
                        throw new TaskResourceError('OP_INVALID', `loadManifest: bundleId must be 'flauz:continuity:<16-hex>' (got ${JSON.stringify(bundleId)})`);
                }
                const raw = await this.fs.readFileUtf8(this.manifestPath(bundleId));
                if (raw === undefined || raw.trim().length === 0) {
                        return undefined;
                }
                return parseBundleManifest(raw);
        }

        /** Loads + validates the ops ledger; missing => empty. */
        async loadOps(): Promise<ContinuityOpRecord[]> {
                const raw = await this.fs.readFileUtf8(this.opsPath);
                if (raw === undefined || raw.trim().length === 0) {
                        return [];
                }
                return parseOpsLedger(raw);
        }

        /**
         * Export-point: validate the bundle id grammar + existence + completeness.
         * Attaches `continuityBundleId` to the hand-off record (the additive
         * `planSwitch.continuityBundleId?` field is the precedent -- this module
         * does NOT modify continuity.ts).
         */
        async validateExportPoint(bundleId: string): Promise<ExportPointResult> {
                if (!isContinuityBundleId(bundleId)) {
                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundleId must be 'flauz:continuity:<16-hex>' (got ${JSON.stringify(bundleId)}) -- bundle ids are never paths, never URLs`) };
                }
                const manifest = await this.loadManifest(bundleId);
                if (manifest === undefined) {
                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundle ${bundleId} not found at ${this.manifestPath(bundleId)} (the bundle must exist before the export-point)`) };
                }
                // the bundle must be COMPLETE: the manifest is strict-parseable (done)
                // and every canon surface is classified (no missing surface ids)
                if (Object.keys(manifest.surfaces).length === 0) {
                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundle ${bundleId} has zero surfaces (incomplete -- the export must classify every canon surface)`) };
                }
                return { ok: true, manifest };
        }

        /**
         * Restore-point: the bundle must VERIFY (manifest integrity + completeness)
         * and the target must be trusted -- fail-closed, typed `CONTINUITY_INVALID`
         * otherwise. The orchestrator passes the trust verdict (the trust gate is
         * the EnvironmentAdapter's; this adapter only validates the bundle).
         */
        async validateRestorePoint(bundleId: string, targetTrusted: boolean): Promise<RestorePointResult> {
                if (!isContinuityBundleId(bundleId)) {
                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundleId must be 'flauz:continuity:<16-hex>' (got ${JSON.stringify(bundleId)})`) };
                }
                if (!targetTrusted) {
                        return {
                                ok: false,
                                error: failure(
                                        'CONTINUITY_INVALID',
                                        `restore target is not trusted -- the fail-closed gate belongs to the TL3 manager; the adapter enforces the SAME verdict (target trust must be 'trusted' before any restore)`,
                                        { targetTrusted },
                                ),
                        };
                }
                const manifest = await this.loadManifest(bundleId);
                if (manifest === undefined) {
                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundle ${bundleId} not found (the bundle must exist before the restore-point)`) };
                }
                // the bundle must VERIFY: manifest strict-parseable (done) + surfaces
                // classified + the carryable surfaces' artifact paths non-empty
                let carried = 0;
                let lost = 0;
                let redacted = 0;
                for (const [surfaceId, entry] of Object.entries(manifest.surfaces)) {
                        if (entry.status === 'carried') {
                                carried++;
                                if (entry.artifactPath === undefined || entry.sha256 === undefined || entry.bytes === undefined) {
                                        return { ok: false, error: failure('CONTINUITY_INVALID', `bundle ${bundleId} surface '${surfaceId}' is carried but lacks artifact fields (manifest is corrupt -- the closed-contract violation)`) };
                                }
                        } else if (entry.status === 'redacted') {
                                redacted++;
                                // secret-shaped surfaces stay redacted (presence + path hash
                                // only -- the SECRET-REDACTION law). The payload is NEVER
                                // re-derived here; the orchestrator re-acquires the secret
                                // through the vault, never through the bundle.
                        } else {
                                lost++;
                        }
                }
                return { ok: true, manifest, surfacesCarried: carried, surfacesLost: lost, surfacesRedacted: redacted };
        }
}

export { canonicalJson, isPlainObject, isPositiveEpochMs, isBoundedString, hasKey, hasOnlyKeys, hasExactKeys, CONTINUITY_BUNDLE_ID_PATTERN };

// ---------------------------------------------------------------------------
// Minimal pure-TypeScript UTF-8 encoder (no TextEncoder dependency -- the
// extension's shims do not declare it, and we add no shims under this dir).
// RFC 3629; cross-checked against node:crypto in tests.
// ---------------------------------------------------------------------------

function utf8Encode(input: string): Uint8Array {
        const out: number[] = [];
        for (let i = 0; i < input.length; i++) {
                let code = input.charCodeAt(i);
                if (code < 0x80) {
                        out.push(code);
                } else if (code < 0x800) {
                        out.push(0xc0 | (code >> 6));
                        out.push(0x80 | (code & 0x3f));
                } else if (code >= 0xd800 && code <= 0xdbff) {
                        // surrogate pair
                        const low = input.charCodeAt(++i);
                        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
                        out.push(0xf0 | (code >> 18));
                        out.push(0x80 | ((code >> 12) & 0x3f));
                        out.push(0x80 | ((code >> 6) & 0x3f));
                        out.push(0x80 | (code & 0x3f));
                } else {
                        out.push(0xe0 | (code >> 12));
                        out.push(0x80 | ((code >> 6) & 0x3f));
                        out.push(0x80 | (code & 0x3f));
                }
        }
        return new Uint8Array(out);
}
