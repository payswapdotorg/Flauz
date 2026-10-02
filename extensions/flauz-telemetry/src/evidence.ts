/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The census-visible banking core (A-PROD-004-W4) -- the W3 banking law,
 * applied to the telemetry record pass.
 *
 * WHAT THIS MAKES TRUE: a telemetry record pass is DIAGNOSABLE THROUGH THE
 * W1 CENSUS. The evidence ledger (`.flauz/evidence/ledger.jsonl`,
 * flauz-workspace) is a census surface (the evidenceLedger row); banking one
 * note row per record pass means the next `flauz.diag.show` census genuinely
 * reports the telemetry activity (rowCount + 1, kindCounts.note + 1, a new
 * chain head) -- the same law that made W2's recovery records and W3's
 * migration/rollback pairs census-visible.
 *
 * THE PINNING LAW: the banked row's sha256 pins the canonical line of the
 * LAST telemetry row the pass appended (recoverable from the telemetry
 * ledger itself -- the evidence row points at the telemetry ledger via its
 * uri and pins its tail). A pass that appends zero rows banks nothing (an
 * empty pass changed no state; that is the honest posture).
 *
 * The ledger row shape, parse, row hash and watermark resync are
 * contract-duplicated from flauz-workspace (via the W3 flauz-migration
 * re-derivation -- DL-32; pinned by test/contract.test.ts against the REAL
 * flauz-workspace ledger and the REAL flauz-diagnostics census).
 */

import {
	EVIDENCE_LEDGER_PATH,
	EVIDENCE_SIZE_PATH,
	TELEMETRY_TASK_ID,
	canonicalJson,
	isPlainObject,
	joinPath,
	sha256Hex,
	utf8ByteLength,
	type Clock,
	type TelemetryFsPort,
} from './api.ts';
import { sweepArtifact } from './privacy.ts';

// ---------------------------------------------------------------------------
// The evidence ledger row (contract-duplicated, flauz-workspace LedgerRow)
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

const LEDGER_ROW_FIELDS = ['kind', 'prev', 'seq', 'sha256', 'taskId', 'ts', 'uri'] as const;
const LEDGER_KINDS = ['changeset', 'screenshot', 'command-output', 'note', 'checkpoint'] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 64-lowercase-hex check (contract-duplicated). */
export function isSha256Hex(value: unknown): value is string {
	return typeof value === 'string' && SHA256_HEX.test(value);
}

/** Parse outcome: {ok, row} | {ok: false, error}. */
export type LineParseOutcome<T> = { readonly ok: true; readonly row: T } | { readonly ok: false; readonly error: string };

/** The canonical stored line of a ledger row (no trailing newline) -- the exact bytes hashed by the chain. */
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
	const hasCheckpoint = Object.prototype.hasOwnProperty.call(parsed, 'checkpoint');
	const expected = hasCheckpoint ? 8 : 7;
	if (Object.keys(parsed).length !== expected || !LEDGER_ROW_FIELDS.every(field => Object.prototype.hasOwnProperty.call(parsed, field))) {
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
	if (typeof parsed.kind !== 'string' || !(LEDGER_KINDS as readonly string[]).includes(parsed.kind)) {
		return { ok: false, error: `ledger line ${String(lineNo)}: kind must be one of ${LEDGER_KINDS.join('|')}` };
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
// The watermark (contract-duplicated, flauz-workspace hardening.ts)
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
// The banking (the W3 law)
// ---------------------------------------------------------------------------

/** The banking outcome. */
export interface BankingOutcome {
	readonly ledgerRowSeq?: number;
	readonly watermarkUpdated: boolean;
	readonly skippedReason?: string;
}

/**
 * Banks the census-visible ledger note row for one telemetry record pass:
 * uri = the telemetry ledger, sha256 = the canonical line of the LAST row
 * the pass appended (the pinned tail). Degrades honestly (recorded reason,
 * no ledger mutation) when the evidence ledger does not parse -- the
 * telemetry rows still landed in their own ledger, the skippedReason
 * explains. The watermark is resynced when the owner wrote one (the W3 law).
 */
export async function bankTelemetryPassRow(
	deps: { root: string; fs: TelemetryFsPort; clock: Clock },
	pinnedTailLine: string,
): Promise<BankingOutcome> {
	const ledgerPath = joinPath(deps.root, EVIDENCE_LEDGER_PATH);
	const text = await deps.fs.readFileUtf8(ledgerPath);
	const rows: LedgerRowShape[] = [];
	if (text !== undefined && text !== '') {
		for (const [index, line] of text.split('\n').filter(line => line !== '').entries()) {
			const outcome = parseLedgerLine(line, index + 1);
			if (!outcome.ok) {
				return { watermarkUpdated: false, skippedReason: `the telemetry pass was not banked: the evidence ledger does not parse (${outcome.error}) -- the telemetry rows live in .flauz/telemetry/ledger.jsonl only` };
			}
			rows.push(outcome.row);
		}
	}

	const at = deps.clock();
	const row: LedgerRowShape = {
		seq: rows.length + 1,
		ts: at,
		taskId: TELEMETRY_TASK_ID,
		kind: 'note',
		uri: '.flauz/telemetry/ledger.jsonl',
		sha256: sha256Hex(pinnedTailLine),
		prev: rows.length === 0 ? null : ledgerRowHash(rows[rows.length - 1] as LedgerRowShape),
	};
	sweepArtifact(row, 'telemetry-banking-row');
	const rowLine = canonicalJson(row);

	if (text === undefined) {
		// no ledger existed: banking creates it (mkdir + first row)
		await deps.fs.mkdir(ledgerPath.split('/').slice(0, -1).join('/'));
		await deps.fs.writeFile(ledgerPath, `${rowLine}\n`);
	} else {
		await deps.fs.appendFile(ledgerPath, `${rowLine}\n`);
	}

	// --- the watermark re-sync (only when the owner wrote one): rowCount/bytes/head of the POST-banking ledger ---
	let watermarkUpdated = false;
	const watermarkText = await deps.fs.readFileUtf8(joinPath(deps.root, EVIDENCE_SIZE_PATH));
	if (watermarkText !== undefined) {
		let existing: LedgerWatermarkShape | undefined;
		try {
			existing = parseWatermarkLenient(JSON.parse(watermarkText) as unknown);
		} catch {
			existing = undefined; // a corrupt watermark is not resynced (reported by the verifiers); it stays as-is
		}
		const newText = await deps.fs.readFileUtf8(ledgerPath) ?? '';
		const updated: LedgerWatermarkShape = {
			$schema: SIZE_SCHEMA,
			rowCount: rows.length + 1,
			bytes: utf8ByteLength(newText),
			headSha256: ledgerHeadHash([...rows, row]),
			lastCheckpointSeq: existing !== undefined ? existing.lastCheckpointSeq : null,
			updatedAt: at,
		};
		await deps.fs.writeFile(joinPath(deps.root, EVIDENCE_SIZE_PATH), serializeWatermark(updated));
		watermarkUpdated = true;
	}

	return { ledgerRowSeq: row.seq, watermarkUpdated };
}
