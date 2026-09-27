/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-003 — the PIN-2 sibling-envelope persistence (CROSS-WORKER CONTRACT —
 * implement exactly; another lane consumes these files READ-ONLY).
 *
 *   - `.flauz/environments-lifecycle.json` — `flauz.environments-lifecycle/v0`
 *     envelope `{schemaVersion, schema, updatedAt, entries}` with per-env
 *     entries `{state, updatedAt, executorKind, lastOpRef}`. Serialized with
 *     the full DL-9/DL-32 discipline: canonical sorted keys, 2-space indent,
 *     exactly one trailing newline, atomic tmp+rename.
 *   - `.flauz/environments-ops.jsonl` — append-only ledger, one canonical
 *     (sorted-keys, compact) JSON line per op. Appends preserve every
 *     existing byte (read + validate + extend + atomic rewrite); the ledger
 *     never rewrites history.
 *
 * Parsing is STRICT: unknown keys, wrong schema ids, non-enum states/actors/
 * ops/results, `result:'error'` without an `error` payload (or `ok` with
 * one) are typed `STORE_CORRUPT` errors — the store fails closed rather than
 * best-effort-loading a mutated file (DL-29 discipline: no silent
 * reinterpretation).
 */
import {
	FLAUZ_DIR,
	isBoundedString,
	isEnvironmentId,
	isPlainObject,
	isPositiveEpochMs,
	joinPath,
	canonicalJson,
	serializeEnvelope,
	hasExactKeys,
	hasOnlyKeys,
	hasKey,
	type Clock,
	type FileSystemPort,
} from '../api.ts';
import {
	EnvironmentLifecycleError,
	LIFECYCLE_SCHEMA_ID,
	LIFECYCLE_SCHEMA_VERSION,
	OPS_SCHEMA_ID,
	OPS_PATH,
	LIFECYCLE_PATH,
	PROVENANCE_ACTORS,
	ENVIRONMENT_OPS,
	type EnvironmentOpRecord,
	type LifecycleEnvelope,
	type LifecycleEntry,
} from './types.ts';
import { isLifecycleState } from './stateMachine.ts';

const EXECUTOR_KIND_MAX = 64;
const ERROR_CODE_MAX = 64;
const ERROR_MESSAGE_MAX = 300;

function storeError(message: string): EnvironmentLifecycleError {
	return new EnvironmentLifecycleError('STORE_CORRUPT', message);
}

// ---------------------------------------------------------------------------
// Lifecycle envelope (flauz.environments-lifecycle/v0)
// ---------------------------------------------------------------------------

/** Validates + parses a lifecycle entry (exact PIN-2 key set). */
export function parseLifecycleEntry(value: unknown, envId: string): LifecycleEntry {
	if (!isPlainObject(value) || !hasExactKeys(value, ['state', 'updatedAt', 'executorKind', 'lastOpRef'])) {
		throw storeError(`entries['${envId}'] must have exactly the keys [executorKind, lastOpRef, state, updatedAt] (the PIN-2 contract)`);
	}
	if (!isLifecycleState(value.state)) {
		throw storeError(`entries['${envId}'].state '${JSON.stringify(value.state)}' is not a lifecycle state (expected one of ${'registered|created|starting|running|stopping|stopped|destroyed|failed (+ /attached composites on running/stopped)'})`);
	}
	if (!isPositiveEpochMs(value.updatedAt)) {
		throw storeError(`entries['${envId}'].updatedAt must be a positive epoch-ms integer (got ${JSON.stringify(value.updatedAt)})`);
	}
	if (!isBoundedString(value.executorKind, EXECUTOR_KIND_MAX)) {
		throw storeError(`entries['${envId}'].executorKind must be a non-empty string (<= ${EXECUTOR_KIND_MAX} chars)`);
	}
	if (typeof value.lastOpRef !== 'number' || !Number.isSafeInteger(value.lastOpRef) || value.lastOpRef < 1) {
		throw storeError(`entries['${envId}'].lastOpRef must be a positive integer (1-based ops-ledger line number; got ${JSON.stringify(value.lastOpRef)})`);
	}
	return { state: value.state, updatedAt: value.updatedAt, executorKind: value.executorKind, lastOpRef: value.lastOpRef };
}

/** Validates + parses a lifecycle envelope document (strict, PIN-2 exact). */
export function parseLifecycleEnvelope(raw: string): LifecycleEnvelope {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw storeError(`lifecycle file is not valid JSON -- ${(err as Error).message}`);
	}
	if (!isPlainObject(value) || !hasExactKeys(value, ['schemaVersion', 'schema', 'updatedAt', 'entries'])) {
		throw storeError('lifecycle envelope must be an object with exactly the keys [entries, schema, schemaVersion, updatedAt] (the PIN-2 contract)');
	}
	if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
		throw storeError(`lifecycle envelope schemaVersion must be exactly ${LIFECYCLE_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
	}
	if (value.schema !== LIFECYCLE_SCHEMA_ID) {
		throw storeError(`lifecycle envelope schema must be exactly '${LIFECYCLE_SCHEMA_ID}' (got ${JSON.stringify(value.schema)})`);
	}
	if (!isPositiveEpochMs(value.updatedAt)) {
		throw storeError(`lifecycle envelope updatedAt must be a positive epoch-ms integer (got ${JSON.stringify(value.updatedAt)})`);
	}
	if (!isPlainObject(value.entries)) {
		throw storeError('lifecycle envelope entries must be an object keyed by environment id');
	}
	const entries: Record<string, LifecycleEntry> = {};
	for (const [envId, entry] of Object.entries(value.entries)) {
		if (!isEnvironmentId(envId)) {
			throw storeError(`lifecycle envelope entry key '${envId}' is not a valid environment id`);
		}
		entries[envId] = parseLifecycleEntry(entry, envId);
	}
	return { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt: value.updatedAt, entries };
}

/** Serializes a lifecycle envelope with the DL-9/DL-32 discipline. */
export function serializeLifecycleEnvelope(envelope: LifecycleEnvelope): string {
	return serializeEnvelope(envelope);
}

// ---------------------------------------------------------------------------
// Ops ledger (flauz.environments-ops/v0 — one JSON line per op)
// ---------------------------------------------------------------------------

/** Validates one parsed ledger line (strict, PIN-2 exact key set). */
export function parseOpRecord(value: unknown, lineNo: number): EnvironmentOpRecord {
	const where = `ops ledger line ${lineNo}`;
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'environmentId', 'result', 'fromState', 'toState'], ['error'])) {
		throw storeError(`${where} must have the keys [actor, environmentId, fromState, op, result, schema, schemaVersion, toState, ts] plus at most [error] (the PIN-2 contract)`);
	}
	if (value.schemaVersion !== LIFECYCLE_SCHEMA_VERSION) {
		throw storeError(`${where} schemaVersion must be exactly ${LIFECYCLE_SCHEMA_VERSION}`);
	}
	if (value.schema !== OPS_SCHEMA_ID) {
		throw storeError(`${where} schema must be exactly '${OPS_SCHEMA_ID}'`);
	}
	if (!isPositiveEpochMs(value.ts)) {
		throw storeError(`${where} ts must be a positive epoch-ms integer`);
	}
	if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
		throw storeError(`${where} actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) — provenance is mandatory`);
	}
	if (typeof value.op !== 'string' || !(ENVIRONMENT_OPS as readonly string[]).includes(value.op)) {
		throw storeError(`${where} op must be one of ${ENVIRONMENT_OPS.join('|')} (got ${JSON.stringify(value.op)})`);
	}
	if (!isEnvironmentId(value.environmentId)) {
		throw storeError(`${where} environmentId must be a valid environment id (got ${JSON.stringify(value.environmentId)})`);
	}
	if (value.result !== 'ok' && value.result !== 'error') {
		throw storeError(`${where} result must be 'ok' or 'error' (got ${JSON.stringify(value.result)})`);
	}
	for (const key of ['fromState', 'toState'] as const) {
		if (typeof value[key] !== 'string' || !isLifecycleState(value[key])) {
			throw storeError(`${where} ${key} '${JSON.stringify(value[key])}' is not a lifecycle state`);
		}
	}
	if (value.result === 'error') {
		if (!hasKey(value, 'error')) {
			throw storeError(`${where} result 'error' requires the error payload {code, message}`);
		}
		if (!isPlainObject(value.error) || !hasExactKeys(value.error, ['code', 'message'])) {
			throw storeError(`${where} error must have exactly the keys [code, message]`);
		}
		const error = value.error as Record<string, unknown>;
		if (!isBoundedString(error.code, ERROR_CODE_MAX)) {
			throw storeError(`${where} error.code must be a non-empty string (<= ${ERROR_CODE_MAX} chars)`);
		}
		if (!isBoundedString(error.message, ERROR_MESSAGE_MAX)) {
			throw storeError(`${where} error.message must be a non-empty string (<= ${ERROR_MESSAGE_MAX} chars)`);
		}
	} else if (hasKey(value, 'error')) {
		throw storeError(`${where} result 'ok' must not carry an error payload`);
	}
	return {
		schemaVersion: LIFECYCLE_SCHEMA_VERSION,
		schema: OPS_SCHEMA_ID,
		ts: value.ts,
		actor: value.actor as EnvironmentOpRecord['actor'],
		op: value.op as EnvironmentOpRecord['op'],
		environmentId: value.environmentId,
		result: value.result,
		fromState: value.fromState as string,
		toState: value.toState as string,
		...(value.result === 'error'
			? { error: { code: (value.error as Record<string, string>).code, message: (value.error as Record<string, string>).message } }
			: {}),
	};
}

/** Validates + parses a single raw ledger line (JSON text, no trailing newline). */
export function parseOpLine(line: string, lineNo: number): EnvironmentOpRecord {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (err) {
		throw storeError(`ops ledger line ${lineNo} is not valid JSON -- ${(err as Error).message}`);
	}
	return parseOpRecord(value, lineNo);
}

/** Canonical single-line serialization of an op record (sorted keys, compact). */
export function serializeOpRecord(record: EnvironmentOpRecord): string {
	return canonicalJson(record);
}

// ---------------------------------------------------------------------------
// The store (owns both files; atomic writes; append-only ledger)
// ---------------------------------------------------------------------------

export interface LifecycleStoreOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

/**
 * The PIN-2 file pair owner. `load()` reads + validates both files (typed
 * STORE_CORRUPT failures); `appendOp` validates the full ledger before
 * extending it (history is never silently mutated); `writeEnvelope` is
 * atomic tmp+rename.
 */
export class LifecycleStore {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly lifecyclePath: string;
	private readonly opsPath: string;

	constructor(options: LifecycleStoreOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.lifecyclePath = joinPath(options.root, LIFECYCLE_PATH);
		this.opsPath = joinPath(options.root, OPS_PATH);
	}

	get envelopePath(): string {
		return this.lifecyclePath;
	}

	get opsLedgerPath(): string {
		return this.opsPath;
	}

	/** Loads + validates both files; missing files load as empty. Idempotent. */
	async load(): Promise<{ readonly envelope: LifecycleEnvelope; readonly records: readonly EnvironmentOpRecord[] }> {
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		const envelope = await this.loadEnvelope();
		const records = await this.loadRecords();
		return { envelope, records };
	}

	private async loadEnvelope(): Promise<LifecycleEnvelope> {
		const raw = await this.fs.readFileUtf8(this.lifecyclePath);
		if (raw === undefined || raw.trim().length === 0) {
			return { schemaVersion: LIFECYCLE_SCHEMA_VERSION, schema: LIFECYCLE_SCHEMA_ID, updatedAt: this.clock(), entries: {} };
		}
		return parseLifecycleEnvelope(raw);
	}

	private async loadRecords(): Promise<EnvironmentOpRecord[]> {
		const raw = await this.fs.readFileUtf8(this.opsPath);
		if (raw === undefined || raw.trim().length === 0) {
			return [];
		}
		return LifecycleStore.parseLedger(raw);
	}

	/** Validates + parses a full ledger document (used by load + tests). */
	static parseLedger(raw: string): EnvironmentOpRecord[] {
		const lines = raw.split('\n');
		// a well-formed ledger ends with exactly one trailing newline
		if (lines[lines.length - 1] !== '') {
			throw storeError('ops ledger must end with a newline');
		}
		const records: EnvironmentOpRecord[] = [];
		for (let i = 0; i < lines.length - 1; i++) {
			const line = lines[i]!;
			if (line.trim().length === 0) {
				throw storeError(`ops ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
			}
			records.push(parseOpLine(line, i + 1));
		}
		return records;
	}

	/**
	 * Appends one record to the ledger (returns its 1-based line number).
	 * The existing content is fully re-validated, then preserved byte-for-
	 * byte — appends never rewrite history.
         */
	async appendOp(record: EnvironmentOpRecord): Promise<number> {
		const raw = await this.fs.readFileUtf8(this.opsPath);
		const existing = raw === undefined || raw.trim().length === 0 ? '' : raw;
		if (existing.length > 0) {
			LifecycleStore.parseLedger(existing); // corruption fails closed BEFORE we extend
		}
		const line = serializeOpRecord(record);
		if (line.includes('\n')) {
			throw storeError('an op record must serialize to a single line');
		}
		const contents = `${existing}${line}\n`;
		const tmp = `${this.opsPath}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.opsPath);
		return contents.split('\n').length - 1; // number of lines
	}

	/** Persists the lifecycle envelope (atomic tmp+rename, DL-9 serialization). */
	async writeEnvelope(envelope: LifecycleEnvelope): Promise<void> {
		const contents = serializeLifecycleEnvelope(envelope);
		const tmp = `${this.lifecyclePath}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.lifecyclePath);
	}

	/** Round-trip check: envelope serialization must re-parse to the same state. */
	verifyEnvelopeRoundTrip(envelope: LifecycleEnvelope): void {
		const parsed = parseLifecycleEnvelope(serializeLifecycleEnvelope(envelope));
		if (canonicalJson(parsed) !== canonicalJson(envelope)) {
			throw storeError('lifecycle envelope round-trip mismatch (serialization is not canonical)');
		}
	}
}
