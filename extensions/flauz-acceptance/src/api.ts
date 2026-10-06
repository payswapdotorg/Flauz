/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The record contracts of the launch + post-release-acceptance plane
 * (A-PROD-006-W2, DL-32 pattern from the W1 sibling). UNVERIFIED-BY-ME:
 * authored against the unblock-packet surfaces; the station runs the battery.
 *
 * THE READ-ONLY SIBLING CONTRACTS: the flauz-release checklist artifact and
 * the flauz-incidents loop journal are READ here through contract-pinned
 * parsers over CONTRACT-DUPLICATED shapes (the repo convention -- the
 * owning modules' source stays untouched; the duplicate shapes are pinned
 * by this suite against the surfaces in the unblock packet).
 *
 * THE GATE VOCABULARY DOES NOT GROW: the eleven prove-items stay verbatim;
 * this module reads the checklist verdict, never redefines it.
 */

import {
        ACCEPTANCE_SCHEMA_ID,
        ACCEPTANCE_DIR,
        ACCEPTANCE_PREFIX,
        RECEIPT_PREFIX,
        RELEASE_DIR,
        CHECKLIST_PREFIX,
        CHECKLIST_SUFFIX,
        CHECKLIST_COMMAND_LINE,
        INCIDENTS_DIR,
        LOOP_PREFIX,
        LOOP_SUFFIX,
        SIZE_SCHEMA_ID,
        LEDGER_ROW_FORMAT_ID,
        EXTENSION_ID,
        ACCEPTANCE_TASK_ID,
        FLAUZ_DIR,
        BOUNDARY_DISCLOSURE,
        PRIVACY_LAW,
} from './globals.ts';
export { LEDGER_PATH, SIZE_PATH } from './globals.ts';
export type { Clock } from './globals.ts';

// ---------------------------------------------------------------------------
// The frozen evidence-label ladder (the order's ladder, verbatim; never promoted by wording)
// ---------------------------------------------------------------------------

export const EVIDENCE_LABELS = ['fixture', 'simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real'] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export function isEvidenceLabel(value: unknown): value is EvidenceLabel {
        return typeof value === 'string' && (EVIDENCE_LABELS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Errors (typed refusals, fail-closed; every refusal carries a reason)
// ---------------------------------------------------------------------------

export type AcceptanceErrorCode =
        | 'FLAUZ_ACCEPTANCE_BAD_ARGS'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_ABSENT'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_RED'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN'
        | 'FLAUZ_ACCEPTANCE_CHECKLIST_STALE'
        | 'FLAUZ_ACCEPTANCE_INCIDENT_ABSENT'
        | 'FLAUZ_ACCEPTANCE_INCIDENT_NOT_AT_RELEASE'
        | 'FLAUZ_ACCEPTANCE_RECORD_ABSENT'
        | 'FLAUZ_ACCEPTANCE_RECORD_TORN'
        | 'FLAUZ_ACCEPTANCE_SECRET_SHAPED'
        | 'FLAUZ_ACCEPTANCE_FORMAT';

export class AcceptanceError extends Error {
        readonly code: AcceptanceErrorCode;

        constructor(code: AcceptanceErrorCode, message: string) {
                super(message);
                this.name = 'AcceptanceError';
                this.code = code;
        }
}

// ---------------------------------------------------------------------------
// The fs port (the W1 IncidentsFsPort surface, contract-duplicated)
// ---------------------------------------------------------------------------

export interface AcceptanceFsPort {
        readFileUtf8(path: string): Promise<string | undefined>;
        /** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
        readdir(path: string): Promise<readonly string[] | undefined>;
        mkdir(path: string): Promise<void>;
        writeFile(path: string, contents: string): Promise<void>;
        appendFile(path: string, contents: string): Promise<void>;
}

export interface OutputChannelPort {
        appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Deterministic primitives (no Math.random; no Date in this module's logic)
// ---------------------------------------------------------------------------

/** fnv1a32 over the UTF-8 bytes of `input`, as 8 lowercase hex chars. */
export function fnv1a32Hex(input: string): string {
        let h = 0x811c9dc5;
        const bytes = new TextEncoder().encode(input);
        for (const b of bytes) {
                h = h ^ b;
                h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
}

/** The acceptance id: `flauz:acc:<16-hex>` -- a double fnv1a32-style derivation from the bound content (deterministic, no random). */
export function acceptanceIdFromContent(content: string): string {
        const first = fnv1a32Hex(content);
        const second = fnv1a32Hex(`${content}:${first}`);
        return `flauz:acc:${first}${second}`;
}

/** The receipt id: `flauz:rcp:<16-hex>` -- the same double-fnv derivation over the receipt's bound content. */
export function receiptIdFromContent(content: string): string {
        const first = fnv1a32Hex(content);
        const second = fnv1a32Hex(`${content}:${first}`);
        return `flauz:rcp:${first}${second}`;
}

export const ACCEPTANCE_ID_SHAPE = /^flauz:acc:[0-9a-f]{16}$/;
export const RECEIPT_ID_SHAPE = /^flauz:rcp:[0-9a-f]{16}$/;
export const SHA256_HEX = /^[0-9a-f]{64}$/;

export function isAcceptanceId(value: unknown): value is string {
        return typeof value === 'string' && ACCEPTANCE_ID_SHAPE.test(value);
}

export function isReceiptId(value: unknown): value is string {
        return typeof value === 'string' && RECEIPT_ID_SHAPE.test(value);
}

export function isSha256Hex(value: unknown): value is string {
        return typeof value === 'string' && SHA256_HEX.test(value);
}

// --- the pure-TS sha256 (the DL-32 convention: duplicated pure implementation, pinned against node:crypto by the test suite) ---

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

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

export function sha256Hex(input: string): string {
        const bytes = new TextEncoder().encode(input);
        const bitLen = bytes.length * 8;
        const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
        padded.set(bytes);
        padded[bytes.length] = 0x80;
        const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
        dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
        dv.setUint32(padded.length - 4, bitLen >>> 0);
        const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
        const w = new Uint32Array(64);
        for (let off = 0; off < padded.length; off += 64) {
                for (let i = 0; i < 16; i++) {
                        w[i] = dv.getUint32(off + i * 4);
                }
                for (let i = 16; i < 64; i++) {
                        const s0 = rotr(w[i - 15] as number, 7) ^ rotr(w[i - 15] as number, 18) ^ ((w[i - 15] as number) >>> 3);
                        const s1 = rotr(w[i - 2] as number, 17) ^ rotr(w[i - 2] as number, 19) ^ ((w[i - 2] as number) >>> 10);
                        w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
                }
                let a = h[0] as number, b = h[1] as number, c = h[2] as number, d = h[3] as number;
                let e = h[4] as number, f = h[5] as number, g = h[6] as number, hh = h[7] as number;
                for (let i = 0; i < 64; i++) {
                        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
                        const ch = (e & f) ^ (~e & g);
                        const t1 = (hh + S1 + ch + (SHA256_K[i] as number) + (w[i] as number)) >>> 0;
                        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
                        const maj = (a & b) ^ (a & c) ^ (b & c);
                        const t2 = (S0 + maj) >>> 0;
                        hh = g; g = f; f = e; e = (d + t1) >>> 0;
                        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
                }
                h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
                h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
        }
        let out = '';
        for (const word of h) {
                out += word.toString(16).padStart(8, '0');
        }
        return out;
}

// ---------------------------------------------------------------------------
// Canonical serialization (the W1 sibling's, contract-duplicated)
// ---------------------------------------------------------------------------

export function joinPath(...parts: readonly string[]): string {
        return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

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

export function serializeArtifact(value: unknown): string {
        return JSON.stringify(deepSorted(value), null, 2) + '\n';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function splitJsonl(text: string): string[] {
        const lines = text.split('\n');
        if (lines[lines.length - 1] === '') {
                lines.pop();
        }
        return lines;
}

export function utf8ByteLength(text: string): number {
        return new TextEncoder().encode(text).length;
}

export function isUnderFlauz(path: string): boolean {
        if (typeof path !== 'string' || path.length === 0) {
                return false;
        }
        const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
        if (normalized.startsWith('/')) {
                return false;
        }
        if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
                return false;
        }
        return normalized === FLAUZ_DIR || normalized.startsWith(`${FLAUZ_DIR}/`);
}

// ---------------------------------------------------------------------------
// The evidence-ledger row contract (contract-duplicated from flauz-workspace via W1; census-visible banking)
// ---------------------------------------------------------------------------

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

export type LineParseOutcome<T> = { readonly ok: true; readonly row: T } | { readonly ok: false; readonly error: string };

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

export function ledgerRowHash(row: LedgerRowShape): string {
        return sha256Hex(ledgerRowLine(row));
}

export function ledgerHeadHash(rows: readonly LedgerRowShape[]): string {
        return rows.length === 0 ? sha256Hex('') : ledgerRowHash(rows[rows.length - 1] as LedgerRowShape);
}

export function parseLedgerLine(line: string, lineNo: number): LineParseOutcome<LedgerRowShape> {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { ok: false, error: `line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { ok: false, error: `line ${String(lineNo)} is not a JSON object` };
        }
        if (!Number.isSafeInteger(parsed.seq) || (parsed.seq as number) < 1) {
                return { ok: false, error: `line ${String(lineNo)}: seq must be a positive safe integer` };
        }
        if (typeof parsed.ts !== 'number' || !Number.isSafeInteger(parsed.ts) || (parsed.ts as number) < 0) {
                return { ok: false, error: `line ${String(lineNo)}: ts must be a non-negative safe integer (epoch ms)` };
        }
        if (typeof parsed.taskId !== 'string' || parsed.taskId.length === 0) {
                return { ok: false, error: `line ${String(lineNo)}: taskId must be a non-empty string` };
        }
        if (typeof parsed.kind !== 'string' || parsed.kind.length === 0) {
                return { ok: false, error: `line ${String(lineNo)}: kind must be a non-empty string` };
        }
        if (typeof parsed.uri !== 'string' || parsed.uri.length === 0) {
                return { ok: false, error: `line ${String(lineNo)}: uri must be a non-empty string` };
        }
        if (!isSha256Hex(parsed.sha256)) {
                return { ok: false, error: `line ${String(lineNo)}: sha256 must be a 64-char lowercase hex string` };
        }
        if (parsed.prev !== null && !isSha256Hex(parsed.prev)) {
                return { ok: false, error: `line ${String(lineNo)}: prev must be null or a 64-char lowercase hex string` };
        }
        return {
                ok: true,
                row: {
                        seq: parsed.seq as number,
                        ts: parsed.ts as number,
                        taskId: parsed.taskId,
                        kind: parsed.kind,
                        uri: parsed.uri,
                        sha256: parsed.sha256,
                        prev: parsed.prev as string | null,
                        ...(parsed.checkpoint !== undefined ? { checkpoint: parsed.checkpoint } : {}),
                },
        };
}

export interface LedgerWatermarkShape {
        readonly $schema: string;
        readonly rowCount: number;
        readonly bytes: number;
        readonly headSha256: string;
        readonly lastCheckpointSeq: number | null;
        readonly updatedAt: number;
}

export function parseWatermarkLenient(value: unknown): LedgerWatermarkShape | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== SIZE_SCHEMA_ID || typeof value.rowCount !== 'number' || typeof value.bytes !== 'number' || typeof value.headSha256 !== 'string' || typeof value.updatedAt !== 'number') {
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

export function serializeWatermark(watermark: LedgerWatermarkShape): string {
        const sorted: Record<string, unknown> = {
                $schema: SIZE_SCHEMA_ID,
                bytes: watermark.bytes,
                headSha256: watermark.headSha256,
                lastCheckpointSeq: watermark.lastCheckpointSeq,
                rowCount: watermark.rowCount,
                updatedAt: watermark.updatedAt,
        };
        return `${JSON.stringify(sorted, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// The flauz-release checklist artifact contract (contract-duplicated; READ-only)
// ---------------------------------------------------------------------------

/** The checklist verdict vocabulary, contract-pinned from flauz-release (never redefined here). */
export type ChecklistVerdictPin = 'green' | 'red' | 'unknown';

export interface ChecklistEvidencePin {
        readonly command: string;
        readonly observable: string;
}

export interface ChecklistRowPin {
        readonly id: string;
        readonly title: string;
        readonly verdict: ChecklistVerdictPin;
        readonly evidence: ChecklistEvidencePin;
        readonly reasons: readonly string[];
        readonly details: Record<string, unknown>;
}

export interface ReleaseChecklistArtifactPin {
        readonly schemaVersion: 0;
        readonly checklistId: string;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly extensionId: string;
        readonly workspaceRoot: string;
        readonly commandLine: 'flauz.release.checklist';
        readonly verdict: 'GO' | 'NO-GO';
        readonly rows: readonly ChecklistRowPin[];
        readonly privacyLaw: string;
}

/** The checklistId derivation, contract-pinned from flauz-release (sha256 over the canonical body without the id). */
export function checklistIdOfPin(artifact: Omit<ReleaseChecklistArtifactPin, 'checklistId'>): string {
        return sha256Hex(canonicalJson(artifact));
}

export type ChecklistArtifactState =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly artifact: ReleaseChecklistArtifactPin; readonly text: string; readonly idReDerives: boolean; readonly relPath: string };

function parseChecklistRow(value: unknown): ChecklistRowPin | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (typeof value.id !== 'string' || typeof value.title !== 'string') {
                return undefined;
        }
        if (value.verdict !== 'green' && value.verdict !== 'red' && value.verdict !== 'unknown') {
                return undefined;
        }
        if (!isPlainObject(value.evidence) || typeof value.evidence.command !== 'string' || typeof value.evidence.observable !== 'string') {
                return undefined;
        }
        if (!Array.isArray(value.reasons) || value.reasons.some(reason => typeof reason !== 'string')) {
                return undefined;
        }
        if (!isPlainObject(value.details)) {
                return undefined;
        }
        return {
                id: value.id,
                title: value.title,
                verdict: value.verdict,
                evidence: { command: value.evidence.command, observable: value.evidence.observable },
                reasons: value.reasons as readonly string[],
                details: value.details,
        };
}

/**
 * Reads one checklist artifact through the contract-pinned parser. The
 * checklistId is RE-DERIVED over the re-read bytes (the flauz-release
 * re-read cycle law, mirrored); a mismatched id is torn data.
 */
export async function readChecklistArtifact(root: string, fs: AcceptanceFsPort, relPath: string): Promise<ChecklistArtifactState> {
        if (typeof relPath !== 'string' || relPath.length === 0) {
                return { state: 'torn', reason: 'the checklist artifact path must be a non-empty workspace-relative string' };
        }
        const text = await fs.readFileUtf8(joinPath(root, relPath));
        if (text === undefined) {
                return { state: 'absent' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `the checklist artifact is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed) || typeof parsed.checklistId !== 'string' || !isSha256Hex(parsed.checklistId)) {
                return { state: 'torn', reason: 'the checklist artifact is not the flauz.release.checklist shape (checklistId missing or not a sha256 hex)' };
        }
        if (parsed.schemaVersion !== 0 || parsed.commandLine !== CHECKLIST_COMMAND_LINE) {
                return { state: 'torn', reason: `the checklist artifact is not the flauz.release.checklist shape (schemaVersion/commandLine mismatch; expected commandLine '${CHECKLIST_COMMAND_LINE}')` };
        }
        if (typeof parsed.createdAt !== 'number' || !Number.isSafeInteger(parsed.createdAt) || (parsed.createdAt as number) < 0) {
                return { state: 'torn', reason: 'the checklist artifact carries no safe-integer createdAt (epoch ms)' };
        }
        if (typeof parsed.productName !== 'string' || typeof parsed.productVersion !== 'string' || typeof parsed.extensionId !== 'string' || typeof parsed.workspaceRoot !== 'string' || typeof parsed.privacyLaw !== 'string') {
                return { state: 'torn', reason: 'the checklist artifact is not the flauz.release.checklist shape (productName/productVersion/extensionId/workspaceRoot/privacyLaw must be strings)' };
        }
        if (parsed.verdict !== 'GO' && parsed.verdict !== 'NO-GO') {
                return { state: 'torn', reason: 'the checklist artifact carries no GO/NO-GO verdict' };
        }
        if (!Array.isArray(parsed.rows) || parsed.rows.length === 0) {
                return { state: 'torn', reason: 'the checklist artifact carries no rows[] array' };
        }
        const rows: ChecklistRowPin[] = [];
        for (const row of parsed.rows) {
                const parsedRow = parseChecklistRow(row);
                if (parsedRow === undefined) {
                        return { state: 'torn', reason: 'a checklist row is not the ChecklistRow shape (id/title/verdict/evidence/reasons/details)' };
                }
                rows.push(parsedRow);
        }
        const { checklistId } = parsed;
        const artifact: ReleaseChecklistArtifactPin = {
                schemaVersion: 0,
                checklistId,
                createdAt: parsed.createdAt,
                productName: parsed.productName,
                productVersion: parsed.productVersion,
                extensionId: parsed.extensionId,
                workspaceRoot: parsed.workspaceRoot,
                commandLine: CHECKLIST_COMMAND_LINE,
                verdict: parsed.verdict,
                rows,
                privacyLaw: parsed.privacyLaw,
        };
        // re-derive over the PIN-shaped body (the contract: sha256 over the
        // canonical body without the id) -- the raw parsed JSON may carry
        // $schema and foreign keys the pin deliberately does not.
        const pinBody = { ...artifact } as Omit<ReleaseChecklistArtifactPin, 'checklistId'>;
        delete (pinBody as { checklistId?: string }).checklistId;
        const idReDerives = checklistIdOfPin(pinBody) === checklistId;
        return { state: 'resolved', artifact, text, idReDerives, relPath };
}

/** Finds the newest checklist artifact under .flauz/release/ (sorted by filename stamp; undefined when the dir is absent/empty). */
export async function latestChecklistArtifactPath(root: string, fs: AcceptanceFsPort): Promise<string | undefined> {
        const entries = await fs.readdir(joinPath(root, RELEASE_DIR));
        if (entries === undefined) {
                return undefined;
        }
        const artifacts = entries.filter(name => name.startsWith(CHECKLIST_PREFIX) && name.endsWith(CHECKLIST_SUFFIX)).sort();
        return artifacts.length === 0 ? undefined : joinPath(RELEASE_DIR, artifacts[artifacts.length - 1] as string);
}

// ---------------------------------------------------------------------------
// The flauz-incidents loop-journal contract (contract-duplicated; READ-only)
// ---------------------------------------------------------------------------

export type LoopStagePin = 'incident' | 'reproducible-finding' | 'registry-item' | 'fix' | 'regression' | 'release' | 'post-release-verification';

export interface LoopJournalRowPin {
        readonly incidentId: string;
        readonly seq: number;
        readonly transition: 'forward' | 'reopen' | 'close' | 'refusal';
        readonly toStage: LoopStagePin;
        readonly fromStage?: LoopStagePin;
        readonly evidence?: { readonly label: string; readonly kind: string; readonly detail: string };
}

export type LoopJournalStatePin =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly rows: readonly LoopJournalRowPin[] };

function isLoopStagePin(value: unknown): value is LoopStagePin {
        return typeof value === 'string' && ['incident', 'reproducible-finding', 'registry-item', 'fix', 'regression', 'release', 'post-release-verification'].includes(value);
}

export async function readLoopJournalPin(root: string, fs: AcceptanceFsPort, incidentId: string): Promise<LoopJournalStatePin> {
        const text = await fs.readFileUtf8(joinPath(root, INCIDENTS_DIR, `${LOOP_PREFIX}${incidentId}${LOOP_SUFFIX}`));
        if (text === undefined || text === '') {
                return { state: 'absent' };
        }
        const rows: LoopJournalRowPin[] = [];
        for (const [index, line] of splitJsonl(text).entries()) {
                if (line === '') {
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch (err) {
                        return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not valid JSON: ${(err as Error).message}` };
                }
                if (!isPlainObject(parsed) || typeof parsed.incidentId !== 'string' || !Number.isSafeInteger(parsed.seq)) {
                        return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape` };
                }
                if (parsed.transition !== 'forward' && parsed.transition !== 'reopen' && parsed.transition !== 'close' && parsed.transition !== 'refusal') {
                        return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape (transition)` };
                }
                if (!isLoopStagePin(parsed.toStage)) {
                        return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape (toStage)` };
                }
                if (parsed.fromStage !== undefined && !isLoopStagePin(parsed.fromStage)) {
                        return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape (fromStage)` };
                }
                let evidence: LoopJournalRowPin['evidence'] | undefined;
                if (parsed.evidence !== undefined) {
                        if (!isPlainObject(parsed.evidence) || typeof parsed.evidence.label !== 'string' || typeof parsed.evidence.kind !== 'string' || typeof parsed.evidence.detail !== 'string') {
                                return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape (evidence)` };
                        }
                        evidence = { label: parsed.evidence.label, kind: parsed.evidence.kind, detail: parsed.evidence.detail };
                }
                rows.push({
                        incidentId: parsed.incidentId,
                        seq: parsed.seq as number,
                        transition: parsed.transition,
                        toStage: parsed.toStage,
                        ...(parsed.fromStage !== undefined ? { fromStage: parsed.fromStage } : {}),
                        ...(evidence !== undefined ? { evidence } : {}),
                });
        }
        return { state: 'resolved', rows };
}

/** The incident id shape, contract-pinned from flauz-incidents. */
export const INCIDENT_ID_SHAPE = /^flauz:inc:[0-9a-f]{16}$/;
export function isIncidentIdPin(value: unknown): value is string {
        return typeof value === 'string' && INCIDENT_ID_SHAPE.test(value);
}

// ---------------------------------------------------------------------------
// The product-state pin (contract-duplicated summary shapes from flauz-release/productState.ts)
// ---------------------------------------------------------------------------

export interface ExtensionManifestSummaryPin {
        readonly extensionDir: string;
        readonly manifestPath: string;
        readonly name: string;
        readonly manifestPresent: boolean;
        readonly parseError?: string;
        readonly publisher?: string;
        readonly version?: string;
        readonly main?: string;
        readonly browser?: string;
        readonly activationEvents: readonly string[];
        readonly enginesVscode?: string;
        readonly id?: string;
}

export interface ParityRegistrySummaryPin {
        readonly present: boolean;
        readonly parseError?: string;
        readonly rowCount: number;
        readonly rows: readonly { readonly surface: string; readonly capability: string; readonly class: string }[];
        readonly extensionSurfaces: readonly string[];
}

export interface SbomSummaryPin {
        readonly present: boolean;
        readonly parseError?: string;
        readonly componentCount: number;
        readonly extensionComponents: readonly { readonly name: string; readonly version: string; readonly bomRef: string; readonly artifact?: string }[];
        readonly dependsOn: readonly string[];
}

export interface ProductStatePin {
        readonly extensions: readonly ExtensionManifestSummaryPin[];
        readonly parity: ParityRegistrySummaryPin;
        readonly sbom: SbomSummaryPin;
}

// ---------------------------------------------------------------------------
// The durable-state census pin (contract-duplicated row shapes from flauz-release/census.ts)
// ---------------------------------------------------------------------------

export interface CensusRowPin {
        readonly present: boolean;
        readonly path: string;
        readonly [summary: string]: unknown;
}

export interface CensusPin {
        readonly rows: readonly { readonly row: string; readonly censusRow: CensusRowPin }[];
        readonly problems: readonly { readonly row: string; readonly problem: string }[];
}

// ---------------------------------------------------------------------------
// The owning-check vocabulary (the release's acceptance set)
// ---------------------------------------------------------------------------

export type OwningCheckKind = 'checklist-row' | 'incident-regression-test' | 'binding-checklist-re-read' | 'binding-incident-journal' | 'product-inventory' | 'census-integrity';

export interface OwningCheck {
        readonly name: string;
        readonly kind: OwningCheckKind;
        /** The evidence command this check binds (the checklist row's evidence command; the binding checks' own re-read commands). */
        readonly command: string;
        readonly observable: string;
        /** The owning surface (a disclosure row names it; an evaluable row names this plane). */
        readonly owner: string;
        /** True when this plane can itself evaluate the check; false = a TYPED DISCLOSURE row at verify time (the honest-scope law). */
        readonly evaluableByPlane: boolean;
}

export interface IncidentBinding {
        readonly incidentId: string;
        /** The stage the incident must sit at when the launch fires (the release stage; the regression->release carry). */
        readonly stage: 'release';
        /** The named regression test the incident's fix carries (the owning check the release must not hide). */
        readonly regressionTestName: string;
}

// ---------------------------------------------------------------------------
// The acceptance record (flauz.acceptance/v1)
// ---------------------------------------------------------------------------

export interface AcceptanceRecord {
        readonly $schema: typeof ACCEPTANCE_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-acceptance';
        readonly extensionId: typeof EXTENSION_ID;
        readonly acceptanceId: string;
        readonly createdAt: number;
        readonly createdAtIso: string;
        readonly actor: string;
        /** The bound release identity: the checklist artifact path VERBATIM + the pinned binding summary. */
        readonly checklist: {
                readonly artifactPath: string;
                readonly checklistId: string;
                readonly createdAt: number;
                readonly productName: string;
                readonly productVersion: string;
                readonly verdict: 'GO';
                readonly rowCount: number;
                readonly fileSha256: string;
        };
        readonly productStatePin: ProductStatePin;
        readonly censusPin: CensusPin;
        readonly owningChecks: readonly OwningCheck[];
        readonly incidentBinding?: IncidentBinding;
        readonly boundaryDisclosure: string;
        readonly privacyLaw: string;
}

// ---------------------------------------------------------------------------
// The verification receipt (flauz.acceptance/v1, kind flauz-acceptance-receipt)
// ---------------------------------------------------------------------------

export type ReceiptRowVerdict = 'pass' | 'fail' | 'disclosure';

export interface ReceiptRow {
        readonly check: string;
        readonly kind: OwningCheckKind;
        readonly verdict: ReceiptRowVerdict;
        /** The evidence label from the frozen ladder (never promoted by wording; 'fixture' on disclosure rows = this plane observed nothing itself). */
        readonly evidenceLabel: EvidenceLabel;
        readonly detail: string;
        /** REQUIRED on disclosure rows: the owning surface that must evaluate the check (the honest-scope law). */
        readonly owningSurface?: string;
}

export interface VerificationReceipt {
        readonly $schema: typeof ACCEPTANCE_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-acceptance-receipt';
        readonly extensionId: typeof EXTENSION_ID;
        readonly receiptId: string;
        readonly acceptanceId: string;
        readonly verdict: 'pass' | 'fail';
        readonly createdAt: number;
        readonly createdAtIso: string;
        readonly actor: string;
        readonly rows: readonly ReceiptRow[];
        readonly counts: {
                readonly checks: number;
                readonly pass: number;
                readonly fail: number;
                readonly disclosure: number;
        };
        readonly boundaryDisclosure: string;
        readonly privacyLaw: string;
}

// ---------------------------------------------------------------------------
// The acceptance-record + receipt readers (typed absent/torn/resolved)
// ---------------------------------------------------------------------------

function parseOwningCheck(value: unknown): OwningCheck | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        const kinds: readonly string[] = ['checklist-row', 'incident-regression-test', 'binding-checklist-re-read', 'binding-incident-journal', 'product-inventory', 'census-integrity'];
        if (typeof value.name !== 'string' || value.name.length === 0) {
                return undefined;
        }
        if (typeof value.kind !== 'string' || !kinds.includes(value.kind as string)) {
                return undefined;
        }
        if (typeof value.command !== 'string' || typeof value.observable !== 'string' || typeof value.owner !== 'string' || typeof value.evaluableByPlane !== 'boolean') {
                return undefined;
        }
        return { name: value.name, kind: value.kind as OwningCheckKind, command: value.command, observable: value.observable, owner: value.owner, evaluableByPlane: value.evaluableByPlane };
}

function parseProductStatePin(value: unknown): ProductStatePin | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (!isPlainObject(value.parity) || !isPlainObject(value.sbom) || !Array.isArray(value.extensions)) {
                return undefined;
        }
        if (typeof value.parity.present !== 'boolean' || typeof value.parity.rowCount !== 'number' || !Array.isArray(value.parity.rows) || !Array.isArray(value.parity.extensionSurfaces)) {
                return undefined;
        }
        if (typeof value.sbom.present !== 'boolean' || typeof value.sbom.componentCount !== 'number' || !Array.isArray(value.sbom.extensionComponents) || !Array.isArray(value.sbom.dependsOn)) {
                return undefined;
        }
        const extensions: ExtensionManifestSummaryPin[] = [];
        for (const row of value.extensions) {
                if (!isPlainObject(row) || typeof row.extensionDir !== 'string' || typeof row.manifestPath !== 'string' || typeof row.name !== 'string' || typeof row.manifestPresent !== 'boolean' || !Array.isArray(row.activationEvents)) {
                        return undefined;
                }
                extensions.push(row as unknown as ExtensionManifestSummaryPin);
        }
        return {
                extensions,
                parity: value.parity as unknown as ParityRegistrySummaryPin,
                sbom: value.sbom as unknown as SbomSummaryPin,
        };
}

function parseCensusPin(value: unknown): CensusPin | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (!Array.isArray(value.rows) || !Array.isArray(value.problems)) {
                return undefined;
        }
        for (const row of value.rows) {
                if (!isPlainObject(row) || typeof row.row !== 'string' || !isPlainObject(row.censusRow) || typeof row.censusRow.present !== 'boolean' || typeof row.censusRow.path !== 'string') {
                        return undefined;
                }
        }
        for (const problem of value.problems) {
                if (!isPlainObject(problem) || typeof problem.row !== 'string' || typeof problem.problem !== 'string') {
                        return undefined;
                }
        }
        return value as unknown as CensusPin;
}

export function parseAcceptanceRecord(value: unknown): AcceptanceRecord | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== ACCEPTANCE_SCHEMA_ID || value.schemaVersion !== 0 || value.kind !== 'flauz-acceptance' || value.extensionId !== EXTENSION_ID) {
                return undefined;
        }
        if (!isAcceptanceId(value.acceptanceId)) {
                return undefined;
        }
        if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0) {
                return undefined;
        }
        if (typeof value.createdAtIso !== 'string' || typeof value.actor !== 'string' || value.actor.length === 0) {
                return undefined;
        }
        if (!isPlainObject(value.checklist) || typeof value.checklist.artifactPath !== 'string' || !isSha256Hex(value.checklist.checklistId) || typeof value.checklist.createdAt !== 'number' || typeof value.checklist.productName !== 'string' || typeof value.checklist.productVersion !== 'string' || value.checklist.verdict !== 'GO' || typeof value.checklist.rowCount !== 'number' || !isSha256Hex(value.checklist.fileSha256)) {
                return undefined;
        }
        const productStatePin = parseProductStatePin(value.productStatePin);
        if (productStatePin === undefined) {
                return undefined;
        }
        const censusPin = parseCensusPin(value.censusPin);
        if (censusPin === undefined) {
                return undefined;
        }
        if (!Array.isArray(value.owningChecks) || value.owningChecks.length === 0) {
                return undefined;
        }
        const owningChecks: OwningCheck[] = [];
        for (const row of value.owningChecks) {
                const check = parseOwningCheck(row);
                if (check === undefined) {
                        return undefined;
                }
                owningChecks.push(check);
        }
        let incidentBinding: IncidentBinding | undefined;
        if (value.incidentBinding !== undefined) {
                if (!isPlainObject(value.incidentBinding) || !isIncidentIdPin(value.incidentBinding.incidentId) || value.incidentBinding.stage !== 'release' || typeof value.incidentBinding.regressionTestName !== 'string' || value.incidentBinding.regressionTestName.length === 0) {
                        return undefined;
                }
                incidentBinding = { incidentId: value.incidentBinding.incidentId, stage: 'release', regressionTestName: value.incidentBinding.regressionTestName };
        }
        if (value.boundaryDisclosure !== BOUNDARY_DISCLOSURE || value.privacyLaw !== PRIVACY_LAW) {
                return undefined;
        }
        return {
                $schema: ACCEPTANCE_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance',
                extensionId: EXTENSION_ID,
                acceptanceId: value.acceptanceId,
                createdAt: value.createdAt,
                createdAtIso: value.createdAtIso,
                actor: value.actor,
                checklist: value.checklist as AcceptanceRecord['checklist'],
                productStatePin,
                censusPin,
                owningChecks,
                incidentBinding,
                boundaryDisclosure: value.boundaryDisclosure,
                privacyLaw: value.privacyLaw,
        };
}

export function parseVerificationReceipt(value: unknown): VerificationReceipt | undefined {
        if (!isPlainObject(value)) {
                return undefined;
        }
        if (value.$schema !== ACCEPTANCE_SCHEMA_ID || value.schemaVersion !== 0 || value.kind !== 'flauz-acceptance-receipt' || value.extensionId !== EXTENSION_ID) {
                return undefined;
        }
        if (!isReceiptId(value.receiptId) || !isAcceptanceId(value.acceptanceId)) {
                return undefined;
        }
        if (value.verdict !== 'pass' && value.verdict !== 'fail') {
                return undefined;
        }
        if (typeof value.createdAt !== 'number' || !Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0) {
                return undefined;
        }
        if (typeof value.createdAtIso !== 'string' || typeof value.actor !== 'string' || value.actor.length === 0) {
                return undefined;
        }
        if (!Array.isArray(value.rows) || value.rows.length === 0) {
                return undefined;
        }
        const rows: ReceiptRow[] = [];
        for (const row of value.rows) {
                if (!isPlainObject(row) || typeof row.check !== 'string' || row.check.length === 0) {
                        return undefined;
                }
                if (row.verdict !== 'pass' && row.verdict !== 'fail' && row.verdict !== 'disclosure') {
                        return undefined;
                }
                if (!isEvidenceLabel(row.evidenceLabel) || typeof row.detail !== 'string') {
                        return undefined;
                }
                if (row.verdict === 'disclosure' && (typeof row.owningSurface !== 'string' || (row.owningSurface as string).length === 0)) {
                        return undefined;
                }
                rows.push({
                        check: row.check,
                        kind: row.kind as OwningCheckKind,
                        verdict: row.verdict,
                        evidenceLabel: row.evidenceLabel,
                        detail: row.detail,
                        ...(typeof row.owningSurface === 'string' ? { owningSurface: row.owningSurface } : {}),
                });
        }
        if (!isPlainObject(value.counts) || typeof value.counts.checks !== 'number' || typeof value.counts.pass !== 'number' || typeof value.counts.fail !== 'number' || typeof value.counts.disclosure !== 'number') {
                return undefined;
        }
        if (value.boundaryDisclosure !== BOUNDARY_DISCLOSURE || value.privacyLaw !== PRIVACY_LAW) {
                return undefined;
        }
        return {
                $schema: ACCEPTANCE_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-acceptance-receipt',
                extensionId: EXTENSION_ID,
                receiptId: value.receiptId,
                acceptanceId: value.acceptanceId,
                verdict: value.verdict,
                createdAt: value.createdAt,
                createdAtIso: value.createdAtIso,
                actor: value.actor,
                rows,
                counts: value.counts as VerificationReceipt['counts'],
                boundaryDisclosure: value.boundaryDisclosure,
                privacyLaw: value.privacyLaw,
        };
}

export type AcceptanceRecordState =
        | { readonly state: 'absent' }
        | { readonly state: 'torn'; readonly reason: string }
        | { readonly state: 'resolved'; readonly record: AcceptanceRecord; readonly relPath: string };

export async function readAcceptanceRecord(root: string, fs: AcceptanceFsPort, acceptanceId: string): Promise<AcceptanceRecordState> {
        if (!isAcceptanceId(acceptanceId)) {
                return { state: 'torn', reason: `the acceptance id '${String(acceptanceId)}' is not the flauz:acc:<16-hex> shape` };
        }
        const relPath = joinPath(ACCEPTANCE_DIR, `${ACCEPTANCE_PREFIX}${acceptanceId}.json`);
        const text = await fs.readFileUtf8(joinPath(root, relPath));
        if (text === undefined) {
                return { state: 'absent' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'torn', reason: `the acceptance record is not valid JSON: ${(err as Error).message}` };
        }
        const record = parseAcceptanceRecord(parsed);
        if (record === undefined) {
                return { state: 'torn', reason: 'the acceptance record is not the flauz.acceptance/v1 shape' };
        }
        return { state: 'resolved', record, relPath };
}

/** The receipt filename for an acceptance id + receipt id (the durable closing-receipt home). */
export function receiptRelPath(acceptanceId: string, receiptId: string): string {
        return joinPath(ACCEPTANCE_DIR, `${RECEIPT_PREFIX}${acceptanceId}.${receiptId}.json`);
}

export function acceptanceRelPath(acceptanceId: string): string {
        return joinPath(ACCEPTANCE_DIR, `${ACCEPTANCE_PREFIX}${acceptanceId}.json`);
}

export { LEDGER_ROW_FORMAT_ID, ACCEPTANCE_TASK_ID };
