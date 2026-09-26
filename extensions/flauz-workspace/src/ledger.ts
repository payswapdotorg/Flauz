/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
	type Clock,
	type FileSystemPort,
	type LedgerRow,
	type LedgerRowInput,
	LEDGER_PATH,
	EVIDENCE_DIR,
	canonicalJson,
	isEvidenceKind,
	isSha256Hex,
	joinPath,
	sha256Hex,
} from './api.ts';

export interface VerifyResult {
	readonly ok: boolean;
	readonly rows: number;
	readonly firstBadSeq?: number;
	readonly reason?: string;
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
	if (keys.length !== 7 || !ROW_FIELDS.every(k => hasKey(value, k))) {
		return { ok: false, error: 'row must have exactly the 7 fields [kind, prev, seq, sha256, taskId, ts, uri]' };
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
		return { ok: false, error: `kind must be one of changeset|screenshot|command-output|note (got ${JSON.stringify(value.kind)})` };
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
	return {
		ok: true,
		row: { seq: value.seq, ts: value.ts, taskId: value.taskId, kind: value.kind, uri: value.uri, sha256: value.sha256, prev: value.prev },
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
}

export class EvidenceLedger {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;

	constructor(options: LedgerOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
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

	async append(taskId: string, input: LedgerRowInput): Promise<AppendResult> {
		if (typeof taskId !== 'string' || taskId.length === 0) {
			throw new Error('flauz: ledger append requires a non-empty taskId');
		}
		validateRowInput(input);
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
		return { evidenceId: evidenceIdOf(seq), seq, row };
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

	/** Full chain recompute; reports the first bad seq across all tamper classes. */
	async verify(): Promise<VerifyResult> {
		const text = await this.fs.readFileUtf8(this.ledgerPath());
		if (text === undefined || text === '') {
			return { ok: true, rows: 0 };
		}
		const lines = text.split('\n');
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		let prevHash: string | null = null;
		let expectedSeq = 1;
		let validated = 0;
		for (const [index, line] of lines.entries()) {
			const lineNo = index + 1;
			if (line === '') {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${lineNo} is empty` };
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${lineNo} is not valid JSON: ${(err as Error).message}` };
			}
			const outcome = parseLedgerRow(parsed);
			if (!outcome.ok) {
				return { ok: false, rows: validated, firstBadSeq: lineNo, reason: `line ${lineNo} is malformed: ${outcome.error}` };
			}
			const row = outcome.row;
			if (row.seq !== expectedSeq) {
				return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${row.seq}: seq must be ${expectedSeq} (contiguity broken — row deleted or reordered?)` };
			}
			if (row.prev !== prevHash) {
				return { ok: false, rows: validated, firstBadSeq: row.seq, reason: `row ${row.seq}: prev hash mismatch (chain broken or payload mutated upstream)` };
			}
			prevHash = rowHash(row);
			expectedSeq += 1;
			validated += 1;
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
