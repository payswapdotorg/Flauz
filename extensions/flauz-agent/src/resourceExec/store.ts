/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the task-resources ledger (`.flauz/task-resources.jsonl`, the
 * durable truth of the `flauz.task-resources/v0` envelope).
 *
 * BYTE LAW (the PIN-1/PIN-2 JSONL discipline, matched exactly): one
 * canonical-JSON record (recursively sorted keys, compact single line) +
 * exactly one `\n` per acquisition/release/rollback/hand-off/failure/
 * expiry. Appends PRESERVE every existing byte (read + validate + extend +
 * atomic tmp+rename) -- the ledger never rewrites history. A write failure
 * fails the operation (fail-closed). The actor is MANDATORY on every line.
 *
 * Crash recovery: the ledger is the durable truth -- after a restart the
 * task graph rebuilds its lease obligations from it
 * (`TaskResourceLedger.rebuildBook`, tested). `verify()` re-derives the
 * full lease-state chain from the ledger bytes: per-line strict shape
 * validation INCLUDING canonicality (the bytes must equal the canonical
 * JSON of the parsed record), plus the chain invariants (unique lease
 * minting, terminal events only for active leases, hand-off events only
 * for active leases).
 *
 * vscode-free, zero deps, ports injected (FileSystemPort/Clock).
 */
import {
	FLAUZ_DIR,
	TASK_RESOURCES_PATH,
	TASK_RESOURCES_SCHEMA_ID,
	TASK_RESOURCES_SCHEMA_VERSION,
	TaskResourceError,
	canonicalJson,
	joinPath,
	parseTaskResourceRecord,
	type Clock,
	type FileSystemPort,
	type TaskResourceLedgerRecord,
} from './types.ts';
import { TaskLeaseBook, type BookProblem } from './contracts.ts';

/** One verify problem (1-based ledger line + message). */
export interface LedgerProblem {
	readonly line: number;
	readonly message: string;
}

export interface LedgerVerifyReport {
	readonly ok: boolean;
	readonly records: number;
	readonly problems: readonly LedgerProblem[];
}

export interface TaskResourceLedgerOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

function corrupt(message: string): TaskResourceError {
	return new TaskResourceError('LEDGER_CORRUPT', message);
}

/**
 * The append-only task-resources ledger. `bootstrap()` loads + validates the
 * file (missing = empty; corrupt = typed LEDGER_CORRUPT, fail-closed);
 * `append()` validates the full existing content before extending it.
 */
export class TaskResourceLedger {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly ledgerPath: string;
	private cached: readonly TaskResourceLedgerRecord[] | undefined;

	constructor(options: TaskResourceLedgerOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.ledgerPath = joinPath(options.root, TASK_RESOURCES_PATH);
	}

	get path(): string {
		return this.ledgerPath;
	}

	/** Loads + validates the ledger (idempotent; missing file = zero records). */
	async bootstrap(): Promise<void> {
		if (this.cached !== undefined) {
			return;
		}
		const raw = await this.fs.readFileUtf8(this.ledgerPath);
		this.cached = raw === undefined || raw.length === 0 ? [] : TaskResourceLedger.parseLedger(raw);
	}

	/** The committed records, in file order (bootstrap or an append loads them). */
	records(): readonly TaskResourceLedgerRecord[] {
		return this.cached ?? [];
	}

	/**
	 * Validates + appends one record (returns its 1-based line number). The
	 * existing content is fully re-validated, then preserved byte-for-byte;
	 * the extended file is written atomically (tmp + rename). Fail-closed on
	 * any validation or write failure.
	 */
	async append(record: TaskResourceLedgerRecord): Promise<number> {
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		const raw = await this.fs.readFileUtf8(this.ledgerPath);
		const existing = raw === undefined || raw.length === 0 ? '' : raw;
		if (existing.length > 0) {
			TaskResourceLedger.parseLedger(existing); // corruption fails closed BEFORE we extend
		}
		const line = canonicalJson(record);
		if (line.includes('\n')) {
			throw corrupt('a task-resources record must serialize to a single canonical line');
		}
		const contents = `${existing}${line}\n`;
		const tmp = `${this.ledgerPath}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.ledgerPath);
		this.cached = [...(this.cached ?? []), record];
		return contents.split('\n').length - 1; // number of lines
	}

	/**
	 * Verifies the ledger bytes + the full lease-state chain: every line
	 * strict-parses, is CANONICAL (bytes equal the canonical JSON of the
	 * parsed record), and the replay invariants hold. Problems are
	 * line-numbered; the report is diagnostics-only (nothing mutates).
	 */
	async verify(): Promise<LedgerVerifyReport> {
		const raw = await this.fs.readFileUtf8(this.ledgerPath);
		if (raw === undefined || raw.length === 0) {
			return { ok: true, records: 0, problems: [] };
		}
		const problems: LedgerProblem[] = [];
		const lines = raw.split('\n');
		if (lines[lines.length - 1] !== '') {
			problems.push({ line: lines.length, message: 'the ledger must end with exactly one newline (one record + one \\n per event)' });
		}
		const records: TaskResourceLedgerRecord[] = [];
		const body = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
		for (const [index, line] of body.entries()) {
			const lineNo = index + 1;
			if (line.trim().length === 0) {
				problems.push({ line: lineNo, message: 'empty line (one JSON object per line; no blank lines)' });
				continue;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				problems.push({ line: lineNo, message: `not valid JSON -- ${err instanceof Error ? err.message : String(err)}` });
				continue;
			}
			try {
				const record = parseTaskResourceRecord(parsed, `ledger line ${lineNo}`);
				if (line !== canonicalJson(record)) {
					problems.push({ line: lineNo, message: 'record is not canonical: bytes must equal the canonical JSON serialization (sorted keys, no insignificant whitespace) of the record' });
					continue;
				}
				records.push(record);
			} catch (err) {
				problems.push({ line: lineNo, message: err instanceof TaskResourceError ? (err.message.startsWith(`${TASK_RESOURCES_SCHEMA_ID}: `) ? err.message.slice(`${TASK_RESOURCES_SCHEMA_ID}: `.length) : err.message) : String(err) });
			}
		}
		const book = new TaskLeaseBook();
		const replay = book.replay(records);
		if (!replay.ok) {
			for (const problem of replay.problems) {
				problems.push({ line: problem.line, message: problem.message });
			}
		}
		return { ok: problems.length === 0, records: records.length, problems };
	}

	/**
	 * Rebuilds the lease book from the ledger (crash recovery). The ledger is
	 * the durable truth: after a restart the task graph rebuilds its lease
	 * obligations from it. Fails closed on any problem (typed, never a
	 * best-effort rebuild).
	 */
	async rebuildBook(): Promise<{ ok: true; book: TaskLeaseBook; records: number } | { ok: false; problems: readonly BookProblem[] }> {
		const report = await this.verify();
		if (!report.ok) {
			return { ok: false, problems: report.problems.map(problem => ({ line: problem.line, message: problem.message })) };
		}
		const book = new TaskLeaseBook();
		const records = await this.loadRecords();
		book.replay(records);
		this.cached = records;
		return { ok: true, book, records: records.length };
	}

	private async loadRecords(): Promise<readonly TaskResourceLedgerRecord[]> {
		const raw = await this.fs.readFileUtf8(this.ledgerPath);
		return raw === undefined || raw.length === 0 ? [] : TaskResourceLedger.parseLedger(raw);
	}

	/**
	 * Validates + parses a full ledger document (strict): every line
	 * strict-parses AND is canonical; the file ends with exactly one
	 * newline; no blank lines. Typed LEDGER_CORRUPT failures.
	 */
	static parseLedger(raw: string): TaskResourceLedgerRecord[] {
		const lines = raw.split('\n');
		// a well-formed ledger ends with exactly one trailing newline
		if (lines[lines.length - 1] !== '') {
			throw corrupt('the task-resources ledger must end with a newline (one record + one \\n per event)');
		}
		const records: TaskResourceLedgerRecord[] = [];
		for (let i = 0; i < lines.length - 1; i++) {
			const line = lines[i]!;
			if (line.trim().length === 0) {
				throw corrupt(`ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				throw corrupt(`ledger line ${i + 1} is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
			}
			const record = parseTaskResourceRecord(parsed, `ledger line ${i + 1}`);
			if (line !== canonicalJson(record)) {
				throw corrupt(`ledger line ${i + 1} is not canonical: bytes must equal the canonical JSON serialization (sorted keys, no insignificant whitespace) of the record`);
			}
			records.push(record);
		}
		return records;
	}
}

// re-exported for consumers (single import site)
export { TaskLeaseBook };
export type { BookProblem, Clock, FileSystemPort, TaskResourceLedgerRecord, TaskResourceError };
