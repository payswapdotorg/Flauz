/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Ledger hardening v0 (DL-20 Wave-4 hook; SECURITY-MODEL section 3.3).
 *
 * Two additive mechanisms on top of the v0 hash chain:
 *
 *  1. SIGNED CHECKPOINTS - a `checkpoint` ledger row (the optional 8th field)
 *     carries {rowSeq, headSha256, algorithm, keyId, signature} where the
 *     signature covers exactly `signedPayload(rowSeq, headSha256)`. The key is
 *     USER-keystore material (never a Flauz service key - the user owns the
 *     chain). v0 ships the fixture-key posture; real keystores are product
 *     integration (REPORT GAPS-AND-SKIPS).
 *
 *  2. SIZE WATERMARK - `.flauz/evidence/size.json` persists rowCount + bytes +
 *     head sha256 + last checkpoint seq after every append; verify() compares
 *     it against the actual ledger so a TRUNCATED TAIL is a verdict class
 *     instead of a silent success, and the v0 last-row-tamper limitation is
 *     CLOSED (the watermark pins the hash of the final row).
 *
 * Threat posture, honestly scoped: the chain + checkpoints are tamper-EVIDENT
 * against an attacker without the user key; the watermark itself is unsigned,
 * so an attacker with workspace write access could rewrite BOTH the tail and
 * the watermark to match - detection of that class rides the last checkpoint's
 * signature (everything <= its rowSeq stays covered). Signing the watermark is
 * a recorded DL-29-class follow-up. Nothing secret ever enters the chain.
 *
 * Pure module: no node imports (same discipline as api.ts/ledger.ts - the core
 * typechecks without @types/node and runs under plain `node --test`).
 */

import {
	type LedgerCheckpointPayload,
	type LedgerRow,
	CHECKPOINT_ALGORITHMS,
	SIZE_PATH,
	canonicalJson,
	isSha256Hex,
	joinPath,
	sha256Hex,
} from './api.ts';

/** Schema identifier pinned into the size watermark. */
export const SIZE_SCHEMA = 'flauz.evidence.size/v1';

/** Default checkpoint cadence: one signed checkpoint every 8 appended rows (DL-29-class candidate: cadence is a policy knob, not a constant). */
export const DEFAULT_CHECKPOINT_INTERVAL = 8;

/** Synthetic taskId of checkpoint rows (no task owns a ledger checkpoint). */
export const LEDGER_CHECKPOINT_TASK_ID = 'flauz.ledger';

/** URI of checkpoint rows: they are statements about the ledger file itself. */
export const LEDGER_CHECKPOINT_URI = '.flauz/evidence/ledger.jsonl';

const CHECKPOINT_PAYLOAD_FIELDS = ['algorithm', 'headSha256', 'keyId', 'rowSeq', 'signature'] as const;

/** Exactly the bytes the checkpoint signature covers (canonical, minimal, secret-free). */
export function signedPayload(rowSeq: number, headSha256: string): string {
	return canonicalJson({ headSha256, rowSeq });
}

/**
 * The sha256 field of a checkpoint row: the digest of the signed payload -
 * re-derivable at verify time, binding the row to its payload even before the
 * signature check (the "tool-result digests link to stored artifacts" analog).
 */
export function checkpointRowSha256(payload: Pick<LedgerCheckpointPayload, 'rowSeq' | 'headSha256'>): string {
	return sha256Hex(signedPayload(payload.rowSeq, payload.headSha256));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Strict parse of the signed payload (throws with the offending rule). */
export function parseCheckpointPayload(value: unknown): LedgerCheckpointPayload {
	if (!isPlainObject(value)) {
		throw new Error('checkpoint payload must be a JSON object');
	}
	const keys = Object.keys(value).sort();
	if (keys.length !== 5 || !CHECKPOINT_PAYLOAD_FIELDS.every(k => hasKey(value, k))) {
		throw new Error('checkpoint payload must have exactly the 5 fields [algorithm, headSha256, keyId, rowSeq, signature]');
	}
	const algorithm = value.algorithm;
	if (typeof algorithm !== 'string' || !(CHECKPOINT_ALGORITHMS as readonly string[]).includes(algorithm)) {
		throw new Error(`checkpoint payload algorithm must be one of ed25519|hmac-sha256 (got ${JSON.stringify(value.algorithm)})`);
	}
	if (!isSha256Hex(value.headSha256)) {
		throw new Error('checkpoint payload headSha256 must be 64 lowercase hex chars');
	}
	if (typeof value.keyId !== 'string' || value.keyId.length === 0) {
		throw new Error('checkpoint payload keyId must be a non-empty string');
	}
	if (typeof value.rowSeq !== 'number' || !Number.isSafeInteger(value.rowSeq) || value.rowSeq < 1) {
		throw new Error('checkpoint payload rowSeq must be a positive integer');
	}
	if (typeof value.signature !== 'string' || !/^[0-9a-f]{64,}$/.test(value.signature)) {
		throw new Error('checkpoint payload signature must be at least 64 lowercase hex chars');
	}
	return {
		rowSeq: value.rowSeq,
		headSha256: value.headSha256,
		algorithm: algorithm as LedgerCheckpointPayload['algorithm'],
		keyId: value.keyId,
		signature: value.signature,
	};
}

// ---------------------------------------------------------------------------
// Size watermark
// ---------------------------------------------------------------------------

/** The persisted size watermark (DL-20: rowCount + bytes + head + last checkpoint seq). */
export interface LedgerWatermark {
	readonly $schema: string;
	readonly rowCount: number;
	readonly bytes: number;
	readonly headSha256: string;
	readonly lastCheckpointSeq: number | null;
	readonly updatedAt: number;
}

const WATERMARK_FIELDS = ['$schema', 'rowCount', 'bytes', 'headSha256', 'lastCheckpointSeq', 'updatedAt'] as const;

/** Strict parse of a stored watermark (throws with the offending rule). */
export function parseWatermark(value: unknown): LedgerWatermark {
	if (!isPlainObject(value)) {
		throw new Error('size watermark must be a JSON object');
	}
	const keys = Object.keys(value).sort();
	if (keys.length !== 6 || !WATERMARK_FIELDS.every(k => hasKey(value, k))) {
		throw new Error(`size watermark must have exactly the 6 fields [${WATERMARK_FIELDS.slice().sort().join(', ')}]`);
	}
	if (value.$schema !== SIZE_SCHEMA) {
		throw new Error(`size watermark $schema must be '${SIZE_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (typeof value.rowCount !== 'number' || !Number.isSafeInteger(value.rowCount) || value.rowCount < 0) {
		throw new Error('size watermark rowCount must be a non-negative integer');
	}
	if (typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
		throw new Error('size watermark bytes must be a non-negative integer');
	}
	if (typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
		throw new Error('size watermark updatedAt must be a non-negative integer');
	}
	if (!isSha256Hex(value.headSha256)) {
		throw new Error('size watermark headSha256 must be 64 lowercase hex chars');
	}
	if (value.lastCheckpointSeq !== null && (typeof value.lastCheckpointSeq !== 'number' || !Number.isSafeInteger(value.lastCheckpointSeq) || value.lastCheckpointSeq < 1)) {
		throw new Error('size watermark lastCheckpointSeq must be a positive integer or null');
	}
	return {
		$schema: value.$schema,
		rowCount: value.rowCount,
		bytes: value.bytes,
		headSha256: value.headSha256,
		lastCheckpointSeq: value.lastCheckpointSeq,
		updatedAt: value.updatedAt,
	};
}

/** Canonical serialization (DL-9 git-diffability: sorted keys, 2-space, one trailing newline). */
export function serializeWatermark(watermark: LedgerWatermark): string {
	const sorted: Record<string, unknown> = {
		$schema: watermark.$schema,
		bytes: watermark.bytes,
		headSha256: watermark.headSha256,
		lastCheckpointSeq: watermark.lastCheckpointSeq,
		rowCount: watermark.rowCount,
		updatedAt: watermark.updatedAt,
	};
	return `${JSON.stringify(sorted, null, 2)}\n`;
}

/** The actual ledger facts a watermark is compared against. */
export interface WatermarkActual {
	readonly rowCount: number;
	readonly bytes: number;
	readonly headSha256: string;
	readonly lastCheckpointSeq: number | null;
}

export type WatermarkDiff
	= { readonly ok: true }
	| { readonly ok: false; readonly truncated: boolean; readonly reasons: readonly string[] };

/** Pure comparison: mismatch details + the truncated-tail flag (actual short of recorded). */
export function diffWatermark(recorded: LedgerWatermark, actual: WatermarkActual): WatermarkDiff {
	const reasons: string[] = [];
	if (actual.rowCount !== recorded.rowCount) {
		reasons.push(`rowCount: recorded ${String(recorded.rowCount)}, actual ${String(actual.rowCount)}`);
	}
	if (actual.bytes !== recorded.bytes) {
		reasons.push(`bytes: recorded ${String(recorded.bytes)}, actual ${String(actual.bytes)}`);
	}
	if (actual.headSha256 !== recorded.headSha256) {
		reasons.push('headSha256: recorded head does not match the hash of the actual final row (last-row tamper or reordered tail)');
	}
	if (actual.lastCheckpointSeq !== recorded.lastCheckpointSeq) {
		reasons.push(`lastCheckpointSeq: recorded ${String(recorded.lastCheckpointSeq)}, actual ${String(actual.lastCheckpointSeq)}`);
	}
	if (reasons.length === 0) {
		return { ok: true };
	}
	const truncated = actual.rowCount < recorded.rowCount || actual.bytes < recorded.bytes;
	return { ok: false, truncated, reasons };
}

/** Workspace-relative POSIX path of the watermark file. */
export function sizePath(): string {
	return SIZE_PATH;
}

/** Absolute path helper (mirrors joinPath usage in ledger.ts). */
export function sizePathUnder(root: string): string {
	return joinPath(root, SIZE_PATH);
}

/** Count of checkpoint rows in a parsed row list + the seq of the last one. */
export function checkpointSummary(rows: readonly LedgerRow[]): { count: number; lastSeq: number | null } {
	let count = 0;
	let lastSeq: number | null = null;
	for (const row of rows) {
		if (row.kind === 'checkpoint') {
			count += 1;
			lastSeq = row.seq;
		}
	}
	return { count, lastSeq };
}
