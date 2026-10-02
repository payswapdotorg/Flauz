/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The tamper-evidence verdicts: the integrity.json surface (A-PROD-004-W1).
 *
 * Two chains are verified, each with a contract-duplicated re-implementation
 * of the OWNING extension's verifier (DL-32; pinned against the real verifiers
 * in test/integrity.test.ts -- the duplication is the point: a diagnostics
 * verdict must not depend on the verified extension's code being importable):
 *
 *   1. the evidence ledger chain (flauz-workspace ledger.verify classes 1-6):
 *      row parse + seq contiguity + prev linkage (rowHash = sha256 of the
 *      canonical stored line) + the genesis rule + the size-watermark
 *      comparison (rowCount/bytes/head) when the hardening watermark exists;
 *   2. the resource ops chain (flauz-resources verifyChain): record parse +
 *      seq contiguity + digest continuity (beforeDigest === prior
 *      afterDigest) + prev linkage + the genesis rule + the envelope head
 *      digest when the graph file exists.
 *
 * Checkpoint SIGNATURES are counted, never verified here: the signing key
 * belongs to the user keystore and NEVER enters a bundle (the privacy law);
 * the verdict records the deferral explicitly (owner-side verify).
 */

import {
        type DiagFsPort,
        LEDGER_PATH,
        RESOURCES_GRAPH_PATH,
        RESOURCES_OPS_PATH,
        SIZE_PATH,
        canonicalJson,
        hasKey,
        isPlainObject,
        joinPath,
        sha256Hex,
        splitJsonl,
        utf8ByteLength,
} from './api.ts';

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

/** Contract-duplicated stored ops record (flauz-resources ResourceOpRecord; DL-32). */
export interface OpsRecordShape {
        readonly seq: number;
        readonly ts: number;
        readonly op: string;
        readonly refId: string;
        readonly actor: string;
        readonly actorId?: string;
        readonly sessionId?: string;
        readonly taskId?: string;
        readonly cause?: string;
        readonly beforeDigest: string;
        readonly afterDigest: string;
        readonly prev: string | null;
        readonly note?: string;
}

/** Parse outcome: {ok, row} | {ok: false, error}. */
export type LineParseOutcome<T> = { readonly ok: true; readonly row: T } | { readonly ok: false; readonly error: string };

const LEDGER_ROW_FIELDS = ['kind', 'prev', 'seq', 'sha256', 'taskId', 'ts', 'uri'] as const;
const OPS_REQUIRED = ['seq', 'ts', 'op', 'refId', 'actor', 'beforeDigest', 'afterDigest', 'prev'] as const;
const OPS_OPTIONAL = ['actorId', 'sessionId', 'taskId', 'cause', 'note'] as const;
const OPS_KINDS = ['add-ref', 'update-ref', 'remove-ref', 'add-surface', 'add-edge', 'remove-edge', 'restore'] as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 64-lowercase-hex check (contract-duplicated; exported for the census parse paths). */
export function isSha256Hex(value: unknown): value is string {
        return typeof value === 'string' && SHA256_HEX.test(value);
}

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

/** The chain head: the hash of the final row (null-... the empty-ledger convention: sha256 of ''). */
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

/** The canonical stored line of an ops record (checkpoint field never present on this shape). */
export function opsRecordLine(record: OpsRecordShape): string {
        const carried: Record<string, unknown> = {
                seq: record.seq,
                ts: record.ts,
                op: record.op,
                refId: record.refId,
                actor: record.actor,
                beforeDigest: record.beforeDigest,
                afterDigest: record.afterDigest,
                prev: record.prev,
        };
        for (const field of ['actorId', 'sessionId', 'taskId', 'cause', 'note'] as const) {
                if (record[field] !== undefined) {
                        carried[field] = record[field];
                }
        }
        return canonicalJson(carried);
}

/** The chain link value of an ops record: sha256 over its canonical line. */
export function opsRecordHash(record: OpsRecordShape): string {
        return sha256Hex(opsRecordLine(record));
}

/** Strict parse of one stored ops line. */
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
// Verdict shapes (the integrity.json artifact body)
// ---------------------------------------------------------------------------

/** The evidence-ledger chain verdict (flauz-workspace verify classes 1-6, re-derived). */
export interface LedgerVerifyVerdict {
        readonly ok: boolean;
        readonly rows: number;
        readonly headSha256: string;
        readonly firstBadSeq?: number;
        readonly reason?: string;
        readonly truncated?: boolean;
        readonly checkpoints?: { readonly count: number; readonly signatureVerification: 'owner-side (the user keystore never enters a bundle)' };
        readonly watermark?: {
                readonly status: 'ok' | 'mismatch' | 'missing' | 'corrupt';
                readonly recorded?: { readonly rowCount: number; readonly bytes: number; readonly headSha256?: string };
                readonly actual?: { readonly rowCount: number; readonly bytes: number; readonly headSha256: string };
        };
}

/** One ops-chain problem (line-numbered, like the owning verifier's report). */
export interface OpsProblem {
        readonly line: number;
        readonly message: string;
}

/** The resource ops-chain verdict (flauz-resources verifyChain, re-derived). */
export interface OpsVerifyVerdict {
        readonly ok: boolean;
        readonly records: number;
        readonly problems: readonly OpsProblem[];
}

/** The whole integrity surface. */
export interface IntegrityVerdicts {
        readonly evidenceLedger: LedgerVerifyVerdict;
        readonly opsChain: OpsVerifyVerdict;
}

/**
 * The ledger chain recompute. Classes surfaced (matching the owning
 * verifier's numbering for the shared classes): 1 mutated payload, 2 mutated
 * sha256, 3 deleted middle row (seq contiguity), 4 forged appended row (prev
 * mismatch), 5 genesis prev != null, 6 watermark mismatch / truncated tail.
 * Class 7 (checkpoint signature) is owner-side by law -- counted, deferred.
 */
export async function verifyLedgerChain(root: string, fs: DiagFsPort): Promise<LedgerVerifyVerdict> {
        const text = await fs.readFileUtf8(joinPath(root, LEDGER_PATH));
        if (text === undefined) {
                return { ok: true, rows: 0, headSha256: sha256Hex('') };
        }
        const lines = splitJsonl(text);
        const rows: LedgerRowShape[] = [];
        let expectedSeq = 1;
        let prevHash: string | null = null;
        let checkpointCount = 0;
        for (const [index, line] of lines.entries()) {
                const lineNo = index + 1;
                if (line === '') {
                        return { ok: false, rows: rows.length, headSha256: ledgerHeadHash(rows), firstBadSeq: lineNo, reason: `line ${String(lineNo)} is empty` };
                }
                const outcome = parseLedgerLine(line, lineNo);
                if (!outcome.ok) {
                        return { ok: false, rows: rows.length, headSha256: ledgerHeadHash(rows), firstBadSeq: lineNo, reason: outcome.error };
                }
                const row = outcome.row;
                if (row.seq !== expectedSeq) {
                        return { ok: false, rows: rows.length, headSha256: ledgerHeadHash(rows), firstBadSeq: row.seq, reason: `seq ${String(row.seq)} breaks contiguity at line ${String(lineNo)} (expected ${String(expectedSeq)}) -- deleted-row class` };
                }
                if (row.prev !== prevHash) {
                        const at = index === 0
                                ? `line ${String(lineNo)} carries prev ${JSON.stringify(row.prev)} but is the genesis row (expected null)`
                                : `line ${String(lineNo)} (seq ${String(row.seq)}) carries a prev that does not match the previous row's hash (forged or mutated-row class)`;
                        return { ok: false, rows: rows.length, headSha256: ledgerHeadHash(rows), firstBadSeq: row.seq, reason: at };
                }
                if (row.kind === 'checkpoint') {
                        checkpointCount += 1;
                }
                rows.push(row);
                expectedSeq += 1;
                prevHash = ledgerRowHash(row);
        }

        // the hardening watermark (class 6) -- only when the owner wrote one
        const verdict: { ok: boolean; rows: number; headSha256: string; firstBadSeq?: number; reason?: string; truncated?: boolean; checkpoints?: LedgerVerifyVerdict['checkpoints']; watermark?: LedgerVerifyVerdict['watermark'] } = {
                ok: true,
                rows: rows.length,
                headSha256: ledgerHeadHash(rows),
        };
        if (checkpointCount > 0) {
                verdict.checkpoints = { count: checkpointCount, signatureVerification: 'owner-side (the user keystore never enters a bundle)' };
        }
        const watermarkText = await fs.readFileUtf8(joinPath(root, SIZE_PATH));
        if (watermarkText !== undefined) {
                const actual = {
                        rowCount: rows.length,
                        bytes: utf8ByteLength(text),
                        headSha256: ledgerHeadHash(rows),
                };
                let recorded: { rowCount: number; bytes: number; headSha256?: string } | undefined;
                try {
                        const parsed: unknown = JSON.parse(watermarkText);
                        if (isPlainObject(parsed) && typeof parsed.rowCount === 'number' && typeof parsed.bytes === 'number') {
                                recorded = { rowCount: parsed.rowCount, bytes: parsed.bytes };
                                if (typeof parsed.headSha256 === 'string') {
                                        recorded.headSha256 = parsed.headSha256;
                                }
                        }
                } catch {
                        // corrupt watermark: recorded stays undefined, status corrupt below
                }
                if (recorded === undefined) {
                        verdict.watermark = { status: 'corrupt', actual };
                        verdict.ok = false;
                        verdict.reason = 'size watermark is corrupt (not parseable flauz.evidence.size/v1 data)';
                        verdict.firstBadSeq = rows.length;
                } else {
                        const reasons: string[] = [];
                        if (recorded.rowCount !== actual.rowCount) {
                                reasons.push(`rowCount ${String(recorded.rowCount)} recorded vs ${String(actual.rowCount)} actual`);
                        }
                        if (recorded.bytes !== actual.bytes) {
                                reasons.push(`bytes ${String(recorded.bytes)} recorded vs ${String(actual.bytes)} actual`);
                        }
                        if (recorded.headSha256 !== undefined && recorded.headSha256 !== actual.headSha256) {
                                reasons.push('headSha256 recorded vs actual differs (the final row was rewritten)');
                        }
                        if (reasons.length > 0) {
                                const truncated = actual.rowCount < recorded.rowCount;
                                verdict.watermark = { status: 'mismatch', recorded, actual };
                                verdict.ok = false;
                                verdict.truncated = truncated;
                                verdict.firstBadSeq = truncated ? rows.length + 1 : rows.length;
                                verdict.reason = `${truncated ? 'watermark mismatch (truncated tail)' : 'watermark mismatch'}: ${reasons.join('; ')}`;
                        } else {
                                verdict.watermark = { status: 'ok', recorded, actual };
                        }
                }
        }
        return verdict as LedgerVerifyVerdict;
}

/** The ops-chain recompute (digest continuity + prev chain + envelope head digest). */
export async function verifyOpsChain(root: string, fs: DiagFsPort): Promise<OpsVerifyVerdict> {
        const text = await fs.readFileUtf8(joinPath(root, RESOURCES_OPS_PATH));
        if (text === undefined) {
                return { ok: true, records: 0, problems: [] };
        }
        if (text !== '' && !text.endsWith('\n')) {
                return { ok: false, records: 0, problems: [{ line: 0, message: 'ops ledger is torn: the file does not end with a newline (an interrupted append never parses silently)' }] };
        }
        const lines = splitJsonl(text);
        const records: OpsRecordShape[] = [];
        const problems: OpsProblem[] = [];
        let expectedSeq = 1;
        let expectedBefore: string | undefined;
        for (const [index, line] of lines.entries()) {
                const lineNo = index + 1;
                if (line === '') {
                        problems.push({ line: lineNo, message: `ops line ${String(lineNo)} is empty (truncated tail)` });
                        continue;
                }
                const outcome = parseOpsLine(line, lineNo);
                if (!outcome.ok) {
                        problems.push({ line: lineNo, message: outcome.error });
                        continue;
                }
                const record = outcome.row;
                if (record.seq !== expectedSeq) {
                        problems.push({ line: lineNo, message: `seq ${String(record.seq)} breaks contiguity (expected ${String(expectedSeq)})` });
                }
                if (expectedBefore !== undefined && record.beforeDigest !== expectedBefore) {
                        problems.push({ line: lineNo, message: `beforeDigest does not match the previous record's afterDigest (chain break)` });
                }
                if (index === 0) {
                        if (record.prev !== null) {
                                problems.push({ line: lineNo, message: `the genesis record must carry prev === null (got ${JSON.stringify(record.prev)}) -- a non-null prev implies deleted history before it` });
                        }
                } else {
                        const expectedPrev = opsRecordHash(records[records.length - 1] as OpsRecordShape);
                        if (record.prev !== expectedPrev) {
                                problems.push({ line: lineNo, message: `prev does not match the previous record's line hash (in-place content tamper)` });
                        }
                }
                records.push(record);
                expectedSeq = record.seq + 1;
                expectedBefore = record.afterDigest;
        }

        // the envelope head digest (only when the graph file exists)
        const graphText = await fs.readFileUtf8(joinPath(root, RESOURCES_GRAPH_PATH));
        if (graphText !== undefined) {
                let headDigest: string;
                try {
                        headDigest = sha256Hex(canonicalJson(JSON.parse(graphText)));
                } catch (err) {
                        problems.push({ line: 0, message: `the resources graph envelope is not valid JSON (${(err as Error).message})` });
                        headDigest = '';
                }
                if (headDigest !== '') {
                        if (records.length === 0) {
                                if (headDigest !== sha256Hex(canonicalJson({ $schema: 'flauz.resources/v0', nodes: [], edges: [], surfaces: [] }))) {
                                        problems.push({ line: 0, message: 'the ops ledger is empty but the graph envelope is non-empty (history erased)' });
                                }
                        } else {
                                const last = records[records.length - 1] as OpsRecordShape;
                                if (last.afterDigest !== headDigest) {
                                        problems.push({ line: records.length, message: 'final afterDigest does not match the persisted envelope digest (tampered or truncated state)' });
                                }
                        }
                }
        }
        return { ok: problems.length === 0, records: records.length, problems };
}

/** Collects both verdicts (the integrity.json artifact body). */
export async function collectIntegrity(root: string, fs: DiagFsPort): Promise<IntegrityVerdicts> {
        const evidenceLedger = await verifyLedgerChain(root, fs);
        const opsChain = await verifyOpsChain(root, fs);
        return { evidenceLedger, opsChain };
}
