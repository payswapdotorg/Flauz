/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The Flauz resource-graph provenance ledger (v0).
 *
 * Append-only mutation log at `.flauz/resources-ops.jsonl`: one canonical-JSON
 * line per graph mutation, carrying the op, the ref id, the actor
 * (agent/human/tool -- MANDATORY, fail-closed: a missing actor is a schema
 * rejection), the timestamp, and the before/after digests of the persisted
 * graph envelope (sha256 over canonical JSON).
 *
 * Integrity story (mirrors the flauz-workspace ledger discipline, adapted to a
 * state-digest chain): the records form a chain via the state digests --
 * record N's `beforeDigest` must equal record N-1's `afterDigest`, and the
 * final record's `afterDigest` must equal the digest of the currently
 * persisted envelope. `verifyChain` checks per-record schema, actor presence,
 * seq contiguity, and digest-chain continuity; a truncated or tampered tail is
 * a verdict, not a silent success.
 *
 * Every graph mutation (ResourceGraph) appends here -- the ledger and the
 * envelope are written through the same FileSystemPort with atomic
 * tmp+rename persistence for the envelope and appends for the log.
 */
import {
	OPS_PATH,
	OPS_SCHEMA_ID,
	FLAUZ_DIR,
	canonicalJson,
	isActor,
	isSha256Hex,
	isPositiveEpochMs,
	isNonEmptyString,
	hasKey,
	joinPath,
	sha256Hex,
	clone,
	type Actor,
	type Clock,
	type FileSystemPort,
	type ResourceProvenance,
} from './api.ts';

/** The mutation kinds recorded in the ops log. */
export const RESOURCE_OPS = [
	'add-ref', 'update-ref', 'remove-ref', 'add-surface', 'add-edge', 'remove-edge', 'restore',
] as const;
export type ResourceOp = (typeof RESOURCE_OPS)[number];

/**
 * One ops-log line. The actor fields are carried FLAT (op, ref id, actor,
 * actorId, timestamp, before/after digests -- the pinned record shape); the
 * optional session/task context of the mutation provenance rides along.
 */
export interface ResourceOpRecord {
	readonly seq: number;
	readonly ts: number;
	readonly op: ResourceOp;
	readonly refId: string;
	readonly actor: Actor;
	readonly actorId?: string;
	readonly sessionId?: string;
	readonly taskId?: string;
	readonly cause?: string;
	readonly beforeDigest: string;
	readonly afterDigest: string;
	readonly note?: string;
}

/** Input to `append` (seq/ts are minted by the ledger). */
export interface OpAppendInput {
	readonly op: ResourceOp;
	readonly refId: string;
	readonly provenance: ResourceProvenance;
	readonly beforeDigest: string;
	readonly afterDigest: string;
	readonly note?: string;
}

export interface OpsVerifyReport {
	readonly ok: boolean;
	readonly records: number;
	readonly problems: readonly OpsProblem[];
}

export interface OpsProblem {
	readonly line: number;
	readonly message: string;
}

export interface ProvenanceLedgerOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

const REQUIRED_KEYS = ['seq', 'ts', 'op', 'refId', 'actor', 'beforeDigest', 'afterDigest'] as const;
const OPTIONAL_KEYS = ['actorId', 'sessionId', 'taskId', 'cause', 'note'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function opsError(message: string): Error {
	return new Error(`${OPS_SCHEMA_ID}: ${message}`);
}

/** Canonical stored line for a record (no trailing newline). */
export function opLine(record: ResourceOpRecord): string {
	return canonicalJson(record);
}

/** Strict parse of a single ops record (throws with a descriptive message). */
export function parseOpRecord(value: unknown, where: string): ResourceOpRecord {
	if (!isPlainObject(value)) {
		throw opsError(`${where}: record must be a JSON object`);
	}
	// fail-closed provenance: the actor check comes FIRST -- a missing or
	// unknown actor is never buried under a generic shape error
	if (!hasKey(value, 'actor')) {
		throw opsError(`${where}: actor is MISSING -- the actor (agent|human|tool) is MANDATORY on every recorded mutation (fail-closed provenance)`);
	}
	if (!isActor(value.actor)) {
		throw opsError(`${where}: actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) -- the agent-vs-human actor distinction is mandatory on every mutation`);
	}
	const allowed = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw opsError(`${where}: unknown key '${key}' (allowed: [${[...REQUIRED_KEYS].join(', ')}] + optional [${[...OPTIONAL_KEYS].join(', ')}])`);
		}
	}
	for (const key of REQUIRED_KEYS) {
		if (!hasKey(value, key)) {
			throw opsError(`${where}: missing required key '${key}'`);
		}
	}
	if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) {
		throw opsError(`${where}: seq must be a positive integer`);
	}
	if (!isPositiveEpochMs(value.ts)) {
		throw opsError(`${where}: ts must be a positive integer epoch-ms`);
	}
	if (typeof value.op !== 'string' || !(RESOURCE_OPS as readonly string[]).includes(value.op)) {
		throw opsError(`${where}: op must be one of ${RESOURCE_OPS.join('|')} (got ${JSON.stringify(value.op)})`);
	}
	if (!isNonEmptyString(value.refId)) {
		throw opsError(`${where}: refId must be a non-empty string`);
	}
	if (!isSha256Hex(value.beforeDigest)) {
		throw opsError(`${where}: beforeDigest must be 64 lowercase hex chars`);
	}
	if (!isSha256Hex(value.afterDigest)) {
		throw opsError(`${where}: afterDigest must be 64 lowercase hex chars`);
	}
	for (const key of ['actorId', 'sessionId', 'taskId', 'note'] as const) {
		if (hasKey(value, key) && !isNonEmptyString(value[key])) {
			throw opsError(`${where}: ${key} must be a non-empty string when present`);
		}
	}
	if (hasKey(value, 'cause') && !isNonEmptyString(value.cause)) {
		throw opsError(`${where}: cause must be a non-empty string when present`);
	}
	return clone(value as unknown as ResourceOpRecord);
}

export class ProvenanceLedger {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;

	constructor(options: ProvenanceLedgerOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
	}

	private ledgerPath(): string {
		return joinPath(this.root, OPS_PATH);
	}

	/** Creates the .flauz dir + empty ops file if absent. Idempotent. */
	async ensure(): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		if (await this.fs.readFileUtf8(this.ledgerPath()) === undefined) {
			await this.fs.writeFile(this.ledgerPath(), '');
		}
	}

	/** True when the ops file exists on disk (a seeded/fixture workspace may lack it). */
	async exists(): Promise<boolean> {
		return await this.fs.readFileUtf8(this.ledgerPath()) !== undefined;
	}

	/** Appends one mutation record; mints seq (last + 1) and ts from the clock. */
	async append(input: OpAppendInput): Promise<ResourceOpRecord> {
		const records = await this.readAll();
		const seq = records.length === 0 ? 1 : ((records[records.length - 1] as ResourceOpRecord).seq + 1);
		const record: ResourceOpRecord = {
			seq,
			ts: this.clock(),
			op: input.op,
			refId: input.refId,
			actor: input.provenance.actor,
			beforeDigest: input.beforeDigest,
			afterDigest: input.afterDigest,
			...(input.provenance.actorId !== undefined ? { actorId: input.provenance.actorId } : {}),
			...(input.provenance.sessionId !== undefined ? { sessionId: input.provenance.sessionId } : {}),
			...(input.provenance.taskId !== undefined ? { taskId: input.provenance.taskId } : {}),
			...(input.provenance.cause !== undefined ? { cause: input.provenance.cause } : {}),
			...(input.note !== undefined ? { note: input.note } : {}),
		};
		// parse our own record first: the fail-closed actor rule applies to the
		// ledger writer too (a malformed record must never reach the file).
		parseOpRecord(record, `pending op seq ${seq}`);
		await this.fs.appendFile(this.ledgerPath(), `${opLine(record)}\n`);
		return record;
	}

	/** Strict parse of all stored records (throws with the offending line number). */
	async readAll(): Promise<readonly ResourceOpRecord[]> {
		const text = await this.fs.readFileUtf8(this.ledgerPath());
		if (text === undefined || text === '') {
			return [];
		}
		const lines = text.split('\n');
		if (lines[lines.length - 1] === '') {
			lines.pop();
		}
		const records: ResourceOpRecord[] = [];
		for (const [index, line] of lines.entries()) {
			const lineNo = index + 1;
			if (line === '') {
				throw opsError(`ops line ${lineNo} is empty (truncated tail)`);
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch (err) {
				throw opsError(`ops line ${lineNo} is not valid JSON -- ${(err as Error).message}`);
			}
			records.push(parseOpRecord(parsed, `ops line ${lineNo}`));
		}
		return records;
	}

	/**
	 * Verifies the chain: per-record schema (actor mandatory), seq contiguity,
	 * and digest continuity (record N's beforeDigest === record N-1's
	 * afterDigest). When `headDigest` is supplied (the digest of the currently
	 * persisted graph envelope), the final record's afterDigest must equal it.
	 */
	async verifyChain(headDigest?: string): Promise<OpsVerifyReport> {
		let records: readonly ResourceOpRecord[];
		try {
			records = await this.readAll();
		} catch (err) {
			return { ok: false, records: 0, problems: [{ line: 0, message: (err as Error).message }] };
		}
		const problems: OpsProblem[] = [];
		let expectedSeq = 1;
		let expectedBefore: string | undefined;
		for (const [index, record] of records.entries()) {
			const line = index + 1;
			if (record.seq !== expectedSeq) {
				problems.push({ line, message: `seq ${record.seq} breaks contiguity (expected ${expectedSeq})` });
			}
			if (expectedBefore !== undefined && record.beforeDigest !== expectedBefore) {
				problems.push({ line, message: `beforeDigest does not match the previous record's afterDigest (chain break: expected ${expectedBefore}, got ${record.beforeDigest})` });
			}
			expectedSeq = record.seq + 1;
			expectedBefore = record.afterDigest;
		}
		if (headDigest !== undefined) {
			if (records.length === 0) {
				// no mutations recorded yet: the head digest must be the empty
				// envelope digest only if the graph was never mutated through
				// the ledger -- covered by callers, not a chain property.
			} else {
				const last = records[records.length - 1] as ResourceOpRecord;
				if (last.afterDigest !== headDigest) {
					problems.push({
						line: records.length,
						message: `final afterDigest does not match the persisted envelope digest (tampered or truncated state: expected ${headDigest}, got ${last.afterDigest})`,
					});
				}
			}
		}
		return { ok: problems.length === 0, records: records.length, problems };
	}
}

/** sha256 over the canonical form of an envelope -- the state digest used in ops records. */
export function envelopeDigest(envelope: unknown): string {
	return sha256Hex(canonicalJson(envelope));
}
