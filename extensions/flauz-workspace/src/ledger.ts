/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
	type CheckpointSigner,
	type Clock,
	type FileSystemPort,
	type LedgerCheckpointPayload,
	type LedgerRow,
	type LedgerRowInput,
	LEDGER_PATH,
	SIZE_PATH,
	EVIDENCE_DIR,
	canonicalJson,
	isEvidenceKind,
	isSha256Hex,
	joinPath,
	sha256Hex,
} from './api.ts';
import {
	DEFAULT_CHECKPOINT_INTERVAL,
	LEDGER_CHECKPOINT_TASK_ID,
	LEDGER_CHECKPOINT_URI,
	SIZE_SCHEMA,
	checkpointRowSha256,
	checkpointSummary,
	diffWatermark,
	parseCheckpointPayload,
	parseWatermark,
	serializeWatermark,
	type LedgerWatermark,
	type WatermarkActual,
} from './hardening.ts';

export interface VerifyResult {
	readonly ok: boolean;
	readonly rows: number;
	readonly firstBadSeq?: number;
	readonly reason?: string;
	/** Present only on hardening verdicts (truncated-tail class). */
	readonly truncated?: boolean;
	/** Present only when checkpoint rows exist (signed-checkpoint stage). */
	readonly checkpoints?: { readonly count: number; readonly verified: number };
	/** Present only when a size watermark exists (watermark stage). */
	readonly watermark?: {
		readonly status: 'ok' | 'mismatch' | 'missing';
		readonly recorded?: { readonly rowCount: number; readonly bytes: number };
		readonly actual?: { readonly rowCount: number; readonly bytes: number };
	};
}

export interface AppendResult {
	readonly evidenceId: string;
	readonly seq: number;
	readonly row: LedgerRow;
}

export type RowParseOutcome = { ok: true; row: LedgerRow } | { ok: false; error: string };

/** Canonical stored line for a row (no trailing newline). */
export function rowLine(row: LedgerRow): string {
	return canonicalJson(row);
}

/** sha256 over the canonical stored line — the chain link value. */
export function rowHash(row: LedgerRow): string {
	return sha256Hex(rowLine(row));
}

/** Evidence ids are `E-` + zero-padded seq (6 digits, growing past E-999999 naturally). */
export function evidenceIdOf(seq: number): string {
	return `E-${String(seq).padStart(6, '0')}`;
}

export function seqOfEvidenceId(evidenceId: string): number | undefined {
	const match = /^E-(\d+)$/.exec(evidenceId);
	return match ? Number.parseInt(match[1] ?? '', 10) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ROW_FIELDS = ['kind', 'prev', 'seq', 'sha256', 'taskId', 'ts', 'uri'] as const;

/** Own-property presence check (the eslint-blessed replacement for the `in` operator). */
export function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

export function parseLedgerRow(value: unknown): RowParseOutcome {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'row is not a JSON object' };
	}
	const keys = Object.keys(value).sort();
	const hasCheckpointField = hasKey(value, 'checkpoint');
	const fieldCount = hasCheckpointField ? 8 : 7;
	if (keys.length !== fieldCount || !ROW_FIELDS.every(k => hasKey(value, k))) {
		return {
			ok: false, error: hasCheckpointField
				? `row must have exactly the 7 fields [kind, prev, seq, sha256, taskId, ts, uri] + checkpoint (only on kind 'checkpoint' rows)`
				: 'row must have exactly the 7 fields [kind, prev, seq, sha256, taskId, ts, uri]'
		};
	}
	if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) {
		return { ok: false, error: 'seq must be a positive integer' };
	}
	if (typeof value.ts !== 'number' || !Number.isSafeInteger(value.ts) || value.ts <= 0) {
		return { ok: false, error: 'ts must be a positive integer' };
	}
	if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
		return { ok: false, error: 'taskId must be a non-empty string' };
	}
	if (!isEvidenceKind(value.kind)) {
		return { ok: false, error: `kind must be one of changeset|screenshot|command-output|note|checkpoint (got ${JSON.stringify(value.kind)})` };
	}
	if (typeof value.uri !== 'string' || value.uri.length === 0) {
		return { ok: false, error: 'uri must be a non-empty string' };
	}
	if (!isSha256Hex(value.sha256)) {
		return { ok: false, error: 'sha256 must be 64 lowercase hex chars' };
	}
	if (value.prev !== null && typeof value.prev !== 'string') {
		return { ok: false, error: 'prev must be a string or null' };
	}
	let checkpoint: LedgerCheckpointPayload | undefined;
	if (value.kind === 'checkpoint') {
		if (!hasCheckpointField) {
			return { ok: false, error: `kind 'checkpoint' requires the 8th field 'checkpoint' (the signed payload)` };
		}
		try {
			checkpoint = parseCheckpointPayload(value.checkpoint);
		} catch (err) {
			return { ok: false, error: `checkpoint payload malformed: ${(err as Error).message}` };
		}
		if (checkpoint.rowSeq >= value.seq) {
			return { ok: false, error: `checkpoint payload rowSeq must be less than the checkpoint row's own seq (it covers a PRIOR row; got rowSeq ${String(checkpoint.rowSeq)} on seq ${String(value.seq)})` };
		}
		if (value.sha256 !== checkpointRowSha256(checkpoint)) {
			return { ok: false, error: 'checkpoint row sha256 must equal sha256(canonicalJson({headSha256, rowSeq})) of its payload - the digest binding' };
		}
	} else if (hasCheckpointField) {
		return { ok: false, error: `the 8th field 'checkpoint' is only legal on kind 'checkpoint' rows` };
	}
	return {
		ok: true,
		row: checkpoint === undefined
			? { seq: value.seq, ts: value.ts, taskId: value.taskId, kind: value.kind, uri: value.uri, sha256: value.sha256, prev: value.prev }
			: { seq: value.seq, ts: value.ts, taskId: value.taskId, kind: value.kind, uri: value.uri, sha256: value.sha256, prev: value.prev, checkpoint },
	};
}

export function validateRowInput(input: unknown): LedgerRowInput {
	if (!isPlainObject(input)) {
		throw new Error('flauz: evidence row must be a plain object {kind, uri, sha256, note?}');
	}
	if (!hasKey(input, 'kind') || !hasKey(input, 'uri') || !hasKey(input, 'sha256')) {
		throw new Error('flauz: evidence row must have kind, uri and sha256');
	}
	const kind = input.kind;
	if (!isEvidenceKind(kind)) {
		throw new Error(`flauz: evidence row kind must be one of changeset|screenshot|command-output|note (got ${JSON.stringify(kind)})`);
	}
	const uri = input.uri;
	if (typeof uri !== 'string' || uri.length === 0) {
		throw new Error('flauz: evidence row uri must be a non-empty string');
	}
	const sha256 = input.sha256;
	if (!isSha256Hex(sha256)) {
		throw new Error('flauz: evidence row sha256 must be 64 lowercase hex chars');
	}
	const note = input.note;
	if (note !== undefined && typeof note !== 'string') {
		throw new Error('flauz: evidence row note must be a string when present');
	}
	return note === undefined ? { kind, uri, sha256 } : { kind, uri, sha256, note };
}

export interface LedgerOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
	/** Enables the DL-20 Wave-4 hardening (signed checkpoints + size watermark) when present. */
	readonly signer?: CheckpointSigner;
	/** Checkpoint cadence: one signed checkpoint every N appended rows (default 8; 0 disables interval checkpoints). */
	readonly checkpointInterval?: number;
}

export class EvidenceLedger {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly signer: CheckpointSigner | undefined;
	private readonly checkpointInterval: number;

	constructor(options: LedgerOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.signer = options.signer;
		this.checkpointInterval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
	}

	/** True when the DL-20 hardening (signer) is enabled for this ledger instance. */
	get hardened(): boolean {
		return this.signer !== undefined;
	}

	private ledgerPath(): string {
		return joinPath(this.root, LEDGER_PATH);
	}

	/** Creates the evidence dir + empty ledger file if absent. Idempotent. */
	async ensure(): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, EVIDENCE_DIR));
		if (await this.fs.readFileUtf8(this.ledgerPath()) === undefined) {
			await this.fs.writeFile(this.ledgerPath(), '');
		}
	}

	/**
	 * Append one evidence row (the serialized-append discipline, INV-6).
	 *
	 * The append is a read-tail -> mint -> appendFile -> SETTLE sequence:
	 * after the line lands, the ledger is re-read and OUR row is verified as a
	 * valid chain continuation at its position. When a concurrent appender
	 * read the same pre-state (the deterministic lost-update rendezvous: both
	 * readers observe the same tail), the SECOND lander's line carries a
	 * duplicate seq and is repaired in place as the correct continuation of
	 * the valid prefix - only the appender's OWN just-written line is ever
	 * rewritten, never committed history. Exactly one additional read per
	 * append (deadlock-safe under the battery's paired-reader rendezvous).
	 */
	async append(taskId: string, input: LedgerRowInput): Promise<AppendResult> {
		if (typeof taskId !== 'string' || taskId.length === 0) {
			throw new Error('flauz: ledger append requires a non-empty taskId');
		}
		validateRowInput(input);
		if (input.kind === 'checkpoint') {
			throw new Error(`flauz: ledger append cannot mint 'checkpoint' rows - they carry a signature and are minted only by appendCheckpoint()`);
		}
		const rows = await this.readRows();
		const seq = rows.length === 0 ? 1 : (rows[rows.length - 1] as LedgerRow).seq + 1;
		const prev = rows.length === 0 ? null : rowHash(rows[rows.length - 1] as LedgerRow);
		const row: LedgerRow = {
			seq,
			ts: this.clock(),
			taskId,
			kind: input.kind,
			uri: input.uri,
			sha256: input.sha256,
			prev,
		};
		await this.fs.appendFile(this.ledgerPath(), `${rowLine(row)}\n`);
		const settled = await this.settleAppendedRow(row);
		const result: AppendResult = { evidenceId: evidenceIdOf(settled.seq), seq: settled.seq, row: settled };
		if (this.signer !== undefined) {
			if (this.checkpointInterval > 0 && settled.seq % this.checkpointInterval === 0) {
				await this.appendCheckpoint();
			} else {
				await this.writeWatermark();
			}
		}
		return result;
	}

	/**
	 * The settlement half of the serialized append: re-read the ledger, locate
	 * OUR line (byte-identical canonical form, searched from the tail), and
	 * verify it landed as a valid continuation (seq === position, prev chains).
	 *
	 * - Fast path (the line is valid at its position): return the row as-is.
	 *   A concurrent appender that landed BEFORE us sits in the valid prefix;
	 *   one that lands AFTER us settles its own line.
	 * - Repair path (our line carries a duplicate seq - we were the second
	 *   lander of a shared pre-state, and our line is the FINAL line): re-mint
	 *   the row as the continuation of the valid prefix (identity fields ts /
	 *   taskId / kind / uri / sha256 are preserved; only seq and prev are
	 *   corrected) and rewrite the file atomically-ish (.tmp + rename).
	 * - Fail-closed path (our line is broken but NOT final, or vanished): a
	 *   3+-way clobber is beyond the v0 cross-instance concurrency contract -
	 *   refuse loudly instead of guessing (in-process appenders serialize on
	 *   the caller's single-writer discipline; the two-appender rendezvous is
	 *   the proven envelope).
	 */
	private async settleAppendedRow(row: LedgerRow): Promise<LedgerRow> {
		const mine = rowLine(row);
		const text = await this.fs.readFileUtf8(this.ledgerPath());
		if (text === undefined || text === '') {
			throw new Error('flauz: ledger append settlement failed: the ledger file is empty after the append (concurrent repair? retry the append)');
		}
		const lines = text.split('\n');
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		let index = -1;
		for (let position = lines.length - 1; position >= 0; position -= 1) {
			if (lines[position] === mine) {
				index = position;
				break;
			}
		}
		if (index === -1) {
			throw new Error('flauz: ledger append settlement failed: the appended row is not in the ledger (a concurrent repair removed it; retry the append)');
		}
		const prefix: LedgerRow[] = [];
		for (const [position, line] of lines.slice(0, index).entries()) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line as string);
			} catch (err) {
				throw new Error(`flauz: ledger append settlement failed: line ${String(position + 1)} is not valid JSON: ${(err as Error).message}`);
			}
			const outcome = parseLedgerRow(parsed);
			if (!outcome.ok || outcome.row.seq !== position + 1) {
				throw new Error(`flauz: ledger append settlement failed: line ${String(position + 1)} is not a valid chain prefix (concurrent repair raced this append; retry the append)`);
			}
			prefix.push(outcome.row);
		}
		const expectedSeq = index + 1;
		const expectedPrev = prefix.length === 0 ? null : rowHash(prefix[prefix.length - 1] as LedgerRow);
		if (row.seq === expectedSeq && row.prev === expectedPrev) {
			return row;
		}
		if (index !== lines.length - 1) {
			throw new Error(`flauz: ledger append settlement failed: row ${String(row.seq)} landed broken at line ${String(expectedSeq)} with later lines present (a 3+-way concurrent clobber is beyond the v0 cross-instance append contract; in-process appenders must serialize on the single-writer discipline)`);
		}
		const repaired: LedgerRow = {
			seq: expectedSeq,
			ts: row.ts,
			taskId: row.taskId,
			kind: row.kind,
			uri: row.uri,
			sha256: row.sha256,
			prev: expectedPrev,
		};
		const target = this.ledgerPath();
		const kept = lines.slice(0, index);
		await this.fs.writeFile(`${target}.tmp`, `${[...kept, rowLine(repaired)].join('\n')}\n`);
		await this.fs.rename(`${target}.tmp`, target);
		return repaired;
	}

	/**
	 * Mints a SIGNED CHECKPOINT row covering the current final row (DL-20 Wave-4
	 * hook; SECURITY-MODEL section 3.3): {rowSeq, headSha256} signed with the
	 * user-keystore key, appended into the chain, then the size watermark is
	 * refreshed. Idempotent: when the final row is already a checkpoint row, the
	 * existing checkpoint is returned unchanged (no double coverage).
	 */
	async appendCheckpoint(): Promise<AppendResult> {
		if (this.signer === undefined) {
			throw new Error('flauz: ledger checkpoints require a CheckpointSigner (the user-keystore key; construct the ledger with hardening enabled)');
		}
		const rows = await this.readRows();
		if (rows.length === 0) {
			throw new Error('flauz: nothing to checkpoint (empty ledger)');
		}
		const last = rows[rows.length - 1] as LedgerRow;
		if (last.kind === 'checkpoint') {
			return { evidenceId: evidenceIdOf(last.seq), seq: last.seq, row: last };
		}
		const rowSeq = last.seq;
		const headSha256 = rowHash(last);
		const signature = await this.signer.sign(rowSeq, headSha256);
		const payload: LedgerCheckpointPayload = { rowSeq, headSha256, algorithm: this.signer.algorithm, keyId: this.signer.keyId, signature };
		const row: LedgerRow = {
			seq: rowSeq + 1,
			ts: this.clock(),
			taskId: LEDGER_CHECKPOINT_TASK_ID,
			kind: 'checkpoint',
			uri: LEDGER_CHECKPOINT_URI,
			sha256: checkpointRowSha256(payload),
			prev: headSha256,
			checkpoint: payload,
		};
		await this.fs.appendFile(this.ledgerPath(), `${rowLine(row)}\n`);
		await this.writeWatermark();
		return { evidenceId: evidenceIdOf(row.seq), seq: row.seq, row };
	}

	/**
	 * Persists the size watermark (rowCount + bytes + head sha256 + last
	 * checkpoint seq) atomically (tmp + rename). Called after every append on a
	 * hardened ledger - the truncated-tail detector of DL-20.
	 */
	private async writeWatermark(): Promise<void> {
		const text = (await this.fs.readFileUtf8(this.ledgerPath())) ?? '';
		const rows = await this.readRows();
		const { lastSeq } = checkpointSummary(rows);
		const last = rows.length === 0 ? undefined : rows[rows.length - 1] as LedgerRow;
		const watermark: LedgerWatermark = {
			$schema: SIZE_SCHEMA,
			rowCount: rows.length,
			bytes: new TextEncoder().encode(text).length,
			headSha256: last === undefined ? sha256Hex('') : rowHash(last),
			lastCheckpointSeq: lastSeq,
			updatedAt: this.clock(),
		};
		const target = joinPath(this.root, SIZE_PATH);
		await this.fs.writeFile(`${target}.tmp`, serializeWatermark(watermark));
		await this.fs.rename(`${target}.tmp`, target);
	}

	/** Strict parse of the stored rows (throws with the offending line number). */
	async readRows(): Promise<LedgerRow[]> {
		const text = await this.fs.readFileUtf8(this.ledgerPath());
		if (text === undefined || text === '') {
			return [];
		}
		const lines = text.split('\n');
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		const rows: LedgerRow[] = [];
		for (const [index, line] of lines.entries()) {
			const lineNo = index + 1;
			if (line === '') {
				throw new Error(`flauz: ledger line ${lineNo} is empty`);
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				throw new Error(`flauz: ledger line ${lineNo} is not valid JSON: ${(err as Error).message}`);
			}
			const outcome = parseLedgerRow(parsed);
			if (!outcome.ok) {
				throw new Error(`flauz: ledger line ${lineNo} is malformed: ${outcome.error}`);
			}
			rows.push(outcome.row);
		}
		return rows;
	}

	/**
	 * Full chain recompute; reports the first bad seq across all tamper classes.
	 *
	 * v0 classes (1-5): mutated payload, mutated sha256, deleted middle row
	 * (seq contiguity), forged appended row (prev mismatch), genesis prev != null.
	 * DL-20 Wave-4 classes, engaged only when hardening artifacts exist:
	 *   6. watermark mismatch / truncated tail (rowCount, bytes, head sha256,
	 *      last checkpoint seq vs the persisted size.json) - this CLOSES the v0
	 *      last-row-tamper limitation (the watermark pins the final row's hash);
	 *   7. bad checkpoint signature (forged or wrong key) and bad checkpoint
	 *      binding (headSha256 does not match the covered row / non-increasing
	 *      coverage / keyId mismatch vs the verifying key).
	 */
	async verify(): Promise<VerifyResult> {
		const text = await this.fs.readFileUtf8(this.ledgerPath());
		const watermarkText = await this.fs.readFileUtf8(joinPath(this.root, SIZE_PATH));
		if (text === undefined || text === '') {
			// Truncating EVERY row while a non-empty watermark survives is still a verdict.
			if (watermarkText !== undefined) {
				try {
					const recorded = parseWatermark(JSON.parse(watermarkText));
					if (recorded.rowCount > 0) {
						return { ok: false, rows: 0, firstBadSeq: 1, truncated: true, reason: `watermark mismatch (truncated tail): ledger is empty but the size watermark records ${String(recorded.rowCount)} rows` };
					}
				} catch {
					return { ok: false, rows: 0, firstBadSeq: 1, reason: 'size watermark is corrupt (not valid flauz.evidence.size/v1 JSON)' };
				}
			}
			return { ok: true, rows: 0 };
		}
		const lines = text.split('\n');
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		let prevHash: string | null = null;
		let expectedSeq = 1;
		let validated = 0;
		const hashes: string[] = [];
		const checkpointRows: LedgerRow[] = [];
		for (const [index, line] of lines.entries()) {
			const lineNo = index + 1;
			if (line === '') {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${String(lineNo)} is empty` };
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
			}
			const outcome = parseLedgerRow(parsed);
			if (!outcome.ok) {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${String(lineNo)} is malformed: ${outcome.error}` };
			}
			const row = outcome.row;
			if (row.seq !== expectedSeq) {
				return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: seq must be ${String(expectedSeq)} (contiguity broken - row deleted or reordered?)` };
			}
			if (row.prev !== prevHash) {
				return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: prev hash mismatch (chain broken or payload mutated upstream)` };
			}
			prevHash = rowHash(row);
			hashes.push(prevHash);
			expectedSeq += 1;
			validated += 1;
			if (row.kind === 'checkpoint') {
				checkpointRows.push(row);
			}
		}
		// --- signed-checkpoint stage (class 7) ---
		if (checkpointRows.length > 0 && this.signer === undefined) {
			const first = checkpointRows[0] as LedgerRow;
			return { ok: false, rows: validated, firstBadSeq: first.seq, reason: `row ${String(first.seq)}: checkpoint rows present but no signer supplied - the user-keystore key is required to verify them`, checkpoints: { count: checkpointRows.length, verified: 0 } };
		}
		if (this.signer !== undefined) {
			let lastCovered = 0;
			for (const row of checkpointRows) {
				const payload = row.checkpoint as LedgerCheckpointPayload;
				if (payload.keyId !== this.signer.keyId) {
					return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: checkpoint was signed by key '${payload.keyId}' but the verifying key is '${this.signer.keyId}' (keyId mismatch - verify with the owning user-keystore key)`, checkpoints: { count: checkpointRows.length, verified: 0 } };
				}
				if (payload.algorithm !== this.signer.algorithm) {
					return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: checkpoint algorithm '${payload.algorithm}' does not match the verifying signer ('${this.signer.algorithm}')`, checkpoints: { count: checkpointRows.length, verified: 0 } };
				}
				if (payload.rowSeq <= lastCovered) {
					return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: checkpoint coverage must strictly increase (rowSeq ${String(payload.rowSeq)} after ${String(lastCovered)} - re-signed or reordered checkpoints?)`, checkpoints: { count: checkpointRows.length, verified: 0 } };
				}
				const hashAtCovered = hashes[payload.rowSeq - 1];
				if (hashAtCovered === undefined || hashAtCovered !== payload.headSha256) {
					return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: checkpoint headSha256 does not match the hash of the covered row ${String(payload.rowSeq)} (bad binding - chain rewritten above the checkpoint?)`, checkpoints: { count: checkpointRows.length, verified: 0 } };
				}
				if (!(await this.signer.verify(payload.rowSeq, payload.headSha256, payload.signature))) {
					return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: checkpoint signature verification failed (forged or wrong key)`, checkpoints: { count: checkpointRows.length, verified: 0 } };
				}
				lastCovered = payload.rowSeq;
			}
		}
		// --- size-watermark stage (class 6) ---
		const actual: WatermarkActual = {
			rowCount: validated,
			bytes: new TextEncoder().encode(text).length,
			headSha256: hashes.length > 0 ? hashes[hashes.length - 1] as string : sha256Hex(''),
			lastCheckpointSeq: checkpointRows.length > 0 ? (checkpointRows[checkpointRows.length - 1] as LedgerRow).seq : null,
		};
		if (watermarkText === undefined) {
			if (checkpointRows.length > 0) {
				const first = checkpointRows[0] as LedgerRow;
				return { ok: false, rows: validated, firstBadSeq: first.seq, reason: `row ${String(first.seq)}: size watermark missing but checkpoint rows present (watermark deleted?)`, checkpoints: { count: checkpointRows.length, verified: checkpointRows.length }, watermark: { status: 'missing' } };
			}
			return { ok: true, rows: validated };
		}
		let recorded: LedgerWatermark;
		try {
			recorded = parseWatermark(JSON.parse(watermarkText));
		} catch (err) {
			return { ok: false, rows: validated, firstBadSeq: validated, reason: `size watermark is corrupt: ${(err as Error).message}` };
		}
		const checkpointsOnMismatch = checkpointRows.length > 0 ? { checkpoints: { count: checkpointRows.length, verified: checkpointRows.length } } : {};
		const diff = diffWatermark(recorded, actual);
		if (!diff.ok) {
			const head = `${diff.truncated ? 'watermark mismatch (truncated tail)' : 'watermark mismatch'}: ${diff.reasons.join('; ')}`;
			return {
				ok: false,
				rows: validated,
				firstBadSeq: diff.truncated ? validated + 1 : validated,
				truncated: diff.truncated,
				reason: head,
				watermark: { status: 'mismatch', recorded: { rowCount: recorded.rowCount, bytes: recorded.bytes }, actual: { rowCount: actual.rowCount, bytes: actual.bytes } },
				...checkpointsOnMismatch,
			};
		}
		if (checkpointRows.length > 0 || watermarkText !== undefined) {
			const checkpointsOnOk = checkpointRows.length > 0 ? { checkpoints: { count: checkpointRows.length, verified: checkpointRows.length } } : {};
			return {
				ok: true,
				rows: validated,
				watermark: { status: 'ok', recorded: { rowCount: recorded.rowCount, bytes: recorded.bytes }, actual: { rowCount: actual.rowCount, bytes: actual.bytes } },
				...checkpointsOnOk,
			};
		}
		return { ok: true, rows: validated };
	}

	async rowByEvidenceId(evidenceId: string): Promise<LedgerRow | undefined> {
		const seq = seqOfEvidenceId(evidenceId);
		if (seq === undefined) {
			return undefined;
		}
		const rows = await this.readRows();
		return rows.find(row => row.seq === seq);
	}
}
