/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The row-contract core (A-PROD-005-W1, contract-duplicated from the W5
 * flauz-release verify subset, itself duplicated from the owning
 * flauz-workspace/flauz-resources row contracts -- DL-32; pinned against the
 * real owning modules by test/contract.test.ts): the evidence-ledger row
 * shape + the ops-record row shape + their strict parsers + their chain-hash
 * helpers. The census-visible banking (banking.ts) and the per-surface
 * version inventory (versionInventory.ts) consume exactly these.
 */

import {
        canonicalJson,
        hasKey,
        isPlainObject,
        sha256Hex,
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

/** 64-lowercase-hex check (contract-duplicated; exported for the banking paths). */
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

/** The canonical stored line of an ops record (the optional fields only when present). */
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
        for (const field of OPS_OPTIONAL) {
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
