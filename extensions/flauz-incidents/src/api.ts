/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Incidents -- the incident/problem registry plane (A-PROD-006-W1, TL-A).
 *
 * THE WAVE'S LAW (DL-86 ADOPT): this extension owns the CLOSED-LOOP machinery
 * of the handoff's A6 law -- every material production issue follows
 *   incident -> reproducible-finding -> registry-item -> fix -> regression
 *          -> release -> post-release-verification.
 * The loop stages are FROZEN VERBATIM from the A6 law. Typed forward
 * transitions ONLY, each evidence-bearing, each carrying its evidence label
 * from the frozen ladder `fixture | simulated | local-real | runtime-real |
 * live-provider | production-real` (never promote a label by wording). The
 * closure law (fail-closed): fix -> regression REQUIRES regression evidence
 * (the named regression test's passing receipt); regression -> release
 * requires the release identity (the owning release/checklist record
 * pointer); the loop closes ONLY on post-release verification evidence (a
 * re-run of the named owning checks against the released state, banked as
 * the closing receipt). Missing evidence = typed REFUSAL naming the exact
 * missing stage-evidence kind, never a silent skip; NO stage may be skipped
 * forward. The ONE reopen law: a failed post-release verification REOPENS
 * the incident with the failure as evidence (a closed loop never hides a
 * regression).
 *
 * THE TWO-REGISTRY SEPARATION (DL-86 ADOPT): the workspace-local incident
 * ledger (`.flauz/incidents/`, `flauz.incidents/v1`, the OPERATIONAL loop
 * state) and the repository control plane (`WORK-REGISTRY.md` -- the
 * AUTHORITY for work items) are separate authorities. The product surface
 * RECORDS the loop state and LINKS to control-plane state by carrying the
 * repo-side registry item id VERBATIM at the registry-item stage; it never
 * mints, edits, ranks or supersedes control-plane state.
 *
 * THE HONEST-EVIDENCE LAW: this wave delivers MACHINERY over workspace state.
 * No record, test, or README sentence may imply a production incident,
 * production usage, or production-real evidence. The evidence label for
 * everything in this wave is `local-real` (workspace records) or lower,
 * stated in the README. The launch has not happened; the suite proves the
 * machinery over seeded workspace records, honestly labeled.
 *
 * THE PRIVACY LAW IS THE METADATA LAW (the W1/W2/W3/W5 posture): every
 * surface this extension produces -- the incident ledger, the loop journals,
 * the status records, the banked evidence rows -- enumerates surface SHAPES
 * (incident ids, classes, severities, affected surfaces, source-binding
 * kinds, loop stages, evidence labels, verdicts, counts) and NEVER CONTENTS
 * and never credentials. Every metadata surface is swept for secret-shaped
 * values before a single byte is written (fail-closed, the W2 canary
 * posture). Records carry WORKSPACE-RELATIVE paths only (never absolute
 * host paths, never file contents).
 *
 * THE DETERMINISM LAW (the durability wave's structural law, mirrored here):
 * no host-clock or host-random calls anywhere in src/ -- the incident id
 * (`flauz:inc:<16-hex>`) is generated from an EXPLICIT rng/seed input (the
 * id generator takes a seed string and hashes it). The clock is INJECTED
 * (the injected-clock law); the default deterministic clock lives in
 * globals.ts and is overridden by the extension layer (the host wall clock)
 * and by tests (the stepping-clock fixture).
 *
 * Contract-duplication law (DL-32, the flauz-diagnostics/flauz-release/
 * flauz-production/flauz-integrity/flauz-isolation/flauz-durability
 * precedent): every durable-state format this extension consults is
 * duplicated HERE as types + parsers -- never imported from the owning
 * extensions at src time (the boundary law). The duplication is pinned by
 * test/contract.test.ts against the REAL owning modules (test-time
 * cross-extension imports are the sanctioned pin pattern; src never crosses
 * extension boundaries).
 */

import {
	INCIDENTS_SCHEMA_ID,
	LOOP_SCHEMA_ID,
	STATUS_SCHEMA_ID,
	INCIDENTS_DIR,
	INCIDENTS_FILENAME,
	LOOP_PREFIX,
	FLAUZ_DIR,
	EXTENSION_ID,
} from './globals.ts';

// ---------------------------------------------------------------------------
// The frozen loop-stage vocabulary (the A6 law, verbatim)
// ---------------------------------------------------------------------------

/**
 * The loop stages, FROZEN VERBATIM from the handoff's A6 law. The order's
 * tokens (kebab-case) are the canonical ids; the loop never invents a stage
 * outside this list. Pinned by the contract suite (the stage-list exactness
 * test -- the array is `as const` and the derived union is the only stage
 * type the loop accepts).
 */
export const LOOP_STAGES = [
	'incident',
	'reproducible-finding',
	'registry-item',
	'fix',
	'regression',
	'release',
	'post-release-verification',
] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

/**
 * The typed forward-transition map (the order's law, verbatim semantics).
 * Every key maps to its successor stage; the reopen transition
 * (post-release-verification -> fix on a failed post-release verification)
 * is the ONE non-forward transition and is carried separately by the loop
 * state machine (the reopen law). Pinned by the contract suite (the
 * transition-map total test -- every non-final stage has exactly one
 * forward successor; the final stage closes the loop or reopens).
 */
export const LOOP_FORWARD: Readonly<Record<Exclude<LoopStage, 'post-release-verification'>, LoopStage>> = {
	'incident': 'reproducible-finding',
	'reproducible-finding': 'registry-item',
	'registry-item': 'fix',
	'fix': 'regression',
	'regression': 'release',
	'release': 'post-release-verification',
};

/** The final stage (the loop closes here; the reopen law fires on a failed post-release verification). */
export const CLOSURE_STAGE: LoopStage = 'post-release-verification';

/**
 * The loop verdict (the status record's typed table).
 *   closed -- the loop closed on post-release verification evidence;
 *   open -- the loop is mid-progress (any stage before closure);
 *   reopened -- the loop was closed and then reopened by a failed post-release verification;
 *   refused-evidence -- a transition was refused for missing evidence (the incident is stuck at the refused stage).
 */
export type LoopVerdict = 'closed' | 'open' | 'reopened' | 'refused-evidence';

// ---------------------------------------------------------------------------
// The frozen evidence-label ladder (the program's evidence law, per transition)
// ---------------------------------------------------------------------------

/**
 * The evidence labels, FROZEN from the program's evidence law. The loop
 * never promotes a label by wording -- the same law as the program's
 * evidence law, applied per transition. Pinned by the contract suite (the
 * evidence-label ladder exactness test).
 */
export const EVIDENCE_LABELS = [
	'fixture',
	'simulated',
	'local-real',
	'runtime-real',
	'live-provider',
	'production-real',
] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

// ---------------------------------------------------------------------------
// The incident-class + severity vocabularies
// ---------------------------------------------------------------------------

/** The severity of an incident (the order's vocabulary, verbatim). */
export const SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const;
export type Severity = (typeof SEVERITIES)[number];

// ---------------------------------------------------------------------------
// The typed source-binding vocabulary (the order's law, verbatim)
// ---------------------------------------------------------------------------

/** The typed source-binding kind (the order's vocabulary, verbatim). */
export const SOURCE_BINDING_KINDS = ['manual', 'telemetry-census', 'durability-escalation', 'dogfood-friction'] as const;
export type SourceBindingKind = (typeof SOURCE_BINDING_KINDS)[number];

/**
 * The source binding of an incident (the order's law). A source binding that
 * cannot resolve is a TYPED DISCLOSURE record, never a dropped row and never
 * a fabricated/inferred incident. The `resolved` field is the typed
 * disclosure: false when the binding's referenced record is absent or does
 * not match the binding's claim (the incident is still recorded, disclosed
 * as `disclosed-unresolvable`).
 */
export type SourceBinding =
	| { readonly kind: 'manual'; readonly resolved: true; readonly disclosed: 'manual-disclosed' }
	| {
		readonly kind: 'telemetry-census';
		readonly failureClass: string;
		readonly censusPath: string;
		readonly resolved: boolean;
		readonly disclosed: 'manual-disclosed' | 'resolved' | 'disclosed-unresolvable';
	  }
	| {
		readonly kind: 'durability-escalation';
		readonly laneId: string;
		readonly heartbeatPath: string;
		readonly policy: string;
		readonly resolved: boolean;
		readonly disclosed: 'manual-disclosed' | 'resolved' | 'disclosed-unresolvable';
	  }
	| {
		readonly kind: 'dogfood-friction';
		readonly frictionKind: string;
		readonly phase: string;
		readonly frictionLogPath: string;
		readonly resolved: boolean;
		readonly disclosed: 'manual-disclosed' | 'resolved' | 'disclosed-unresolvable';
	  };

/** The source-binding state (the status record's typed column). */
export type SourceBindingState = 'resolved' | 'disclosed-unresolvable' | 'manual-disclosed';

/** The source-binding state of a binding (the typed column the status record renders). */
export function sourceBindingState(binding: SourceBinding): SourceBindingState {
	if (binding.kind === 'manual') {
		return 'manual-disclosed';
	}
	return binding.resolved ? 'resolved' : 'disclosed-unresolvable';
}

// ---------------------------------------------------------------------------
// The incident id law (the order's `flauz:inc:<16-hex>` pattern, from an explicit seed)
// ---------------------------------------------------------------------------

/** The incident id shape: `flauz:inc:<16-hex>`. Pinned by the contract suite. */
export const INCIDENT_ID_SHAPE = /^flauz:inc:[0-9a-f]{16}$/;

/** True when `value` matches the incident id shape. */
export function isIncidentId(value: unknown): value is string {
	return typeof value === 'string' && INCIDENT_ID_SHAPE.test(value);
}

/**
 * Generates an incident id from an EXPLICIT seed string (the determinism law:
 * no host random). The id is the first 16 hex chars of sha256(seed) -- a
 * stable, reproducible, collision-resistant 16-hex identifier. The seed is
 * the operator's responsibility (a descriptive incident slug is the
 * recommended seed; the id is the deterministic fingerprint of that slug).
 */
export function incidentIdFromSeed(seed: string): string {
	if (typeof seed !== 'string' || seed.length === 0) {
		throw new IncidentsError('FLAUZ_INCIDENTS_BAD_ARGS', 'flauz.incidents.report: the incident id seed must be a non-empty string (the explicit rng/seed input -- the id is the first 16 hex chars of sha256(seed))');
	}
	return `flauz:inc:${sha256Hex(seed).slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the read surface (UTF-8 text +
 * directory listings) plus the writes its OWN artifacts own (the incident
 * ledger, the loop journals, the status records, the census-visible ledger
 * banking).
 */
export interface IncidentsFsPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	/** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
	readdir(path: string): Promise<readonly string[] | undefined>;
	mkdir(path: string): Promise<void>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
}

/** Injectable output channel (the `flauz.incidents.*` render target). */
export interface OutputChannelPort {
	appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type IncidentsErrorCode =
	| 'FLAUZ_INCIDENTS_NO_WORKSPACE'
	| 'FLAUZ_INCIDENTS_UNKNOWN_INCIDENT'
	| 'FLAUZ_INCIDENTS_BAD_ARGS'
	| 'FLAUZ_INCIDENTS_SECRET_SHAPED'
	| 'FLAUZ_INCIDENTS_FORMAT'
	| 'FLAUZ_INCIDENTS_REFUSED_EVIDENCE'
	| 'FLAUZ_INCIDENTS_BAD_TRANSITION';

/** Typed incidents failure. `code` is stable; `detail` carries the class laws. */
export class IncidentsError extends Error {
	readonly code: IncidentsErrorCode;

	constructor(code: IncidentsErrorCode, message: string) {
		super(message);
		this.name = 'IncidentsError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace via
// flauz-release/flauz-production/flauz-integrity/flauz-isolation/flauz-durability;
// pinned byte-equal by test/contract.test.ts -- never imported across extensions)
// ---------------------------------------------------------------------------

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace,
 * `undefined` values dropped. This is the exact byte input of every chain
 * row hash.
 */
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
	throw new Error('flauz.incidents/v1: cannot canonicalize value of type ' + typeof value + ' (payloads must be JSON-safe)');
}

/** Deep copy with recursively sorted keys (input to the pretty artifact serializer). */
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

/**
 * Artifact serialization with the git-diffability discipline (DL-9): fully
 * canonical (sorted) key order, 2-space indent, exactly one trailing newline.
 */
export function serializeArtifact(value: unknown): string {
	return JSON.stringify(deepSorted(value), null, 2) + '\n';
}

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

function rotr(x: number, n: number): number {
	return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/**
 * Pure-TypeScript sha256 over the UTF-8 bytes of `input`, hex-encoded.
 *
 * Duplicated by contract from the flauz-workspace/flauz-release/
 * flauz-production/flauz-integrity/flauz-isolation/flauz-durability
 * implementations (implemented locally instead of node:crypto so the core
 * stays free of node typings and runtime deps); pinned byte-equal against
 * node:crypto AND the owning implementations in test/contract.test.ts.
 */
export function sha256Hex(input: string): string {
	const bytes = new TextEncoder().encode(input);
	const bitLength = bytes.length * 8;
	const paddedLength = (((bytes.length + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLength);
	padded.set(bytes);
	padded[bytes.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);

	let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
	let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

	const w = new Uint32Array(64);
	for (let block = 0; block < paddedLength; block += 64) {
		for (let i = 0; i < 16; i++) {
			w[i] = view.getUint32(block + i * 4, false);
		}
		for (let i = 16; i < 64; i++) {
			const s0 = rotr(w[i - 15] ?? 0, 7) ^ rotr(w[i - 15] ?? 0, 18) ^ ((w[i - 15] ?? 0) >>> 3);
			const s1 = rotr(w[i - 2] ?? 0, 17) ^ rotr(w[i - 2] ?? 0, 19) ^ ((w[i - 2] ?? 0) >>> 10);
			w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + (SHA256_K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
			const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
			const maj = (a & b) ^ (a & c) ^ (b & c);
			const t2 = (S0 + maj) >>> 0;
			h = g; g = f; f = e; e = (d + t1) >>> 0;
			d = c; c = b; b = a; a = (t1 + t2) >>> 0;
		}
		h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
	}

	return [h0, h1, h2, h3, h4, h5, h6, h7]
		.map(word => word.toString(16).padStart(8, '0'))
		.join('');
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasKey(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Splits canonical JSONL text into lines (trailing newline tolerated; blank lines preserved as errors by callers). */
export function splitJsonl(text: string): string[] {
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

/** Byte length of a UTF-8 string (the same encoder the ledger watermark comparison uses). */
export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 64-lowercase-hex check (contract-duplicated; exported for the banking + ledger paths). */
export function isSha256Hex(value: unknown): value is string {
	return typeof value === 'string' && SHA256_HEX.test(value);
}

// ---------------------------------------------------------------------------
// The evidence-ledger row contract (contract-duplicated from flauz-workspace
// via flauz-release/flauz-production/flauz-integrity/flauz-isolation/flauz-durability;
// the banking path + the banked-record taskId law consume exactly these)
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

/** Parse outcome: {ok, row} | {ok: false, error}. */
export type LineParseOutcome<T> = { readonly ok: true; readonly row: T } | { readonly ok: false; readonly error: string };

const LEDGER_ROW_FIELDS = ['kind', 'prev', 'seq', 'sha256', 'taskId', 'ts', 'uri'] as const;

/**
 * The canonical stored line of a ledger row (no trailing newline) -- the
 * exact bytes hashed by the chain. Re-canonicalized from the PARSED row so
 * an on-disk line that is valid JSON but non-canonical still verifies by
 * value.
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

// ---------------------------------------------------------------------------
// The size-watermark contract (banking resync; contract-duplicated shape)
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
// The evidence-ref scoping law (paths under .flauz/ only)
// ---------------------------------------------------------------------------

/** True when `path` is a workspace-relative path under `.flauz/` (the evidence-ref scoping law). */
export function isUnderFlauz(path: string): boolean {
	if (typeof path !== 'string' || path.length === 0) {
		return false;
	}
	const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
	if (normalized.startsWith('/')) {
		return false; // absolute paths are out of scope
	}
	if (normalized.startsWith('../') || normalized.includes('/../') || normalized === '..') {
		return false; // parent-escape is out of scope
	}
	return normalized === FLAUZ_DIR || normalized.startsWith(`${FLAUZ_DIR}/`);
}

// ---------------------------------------------------------------------------
// The incident ledger contract (this plane's OWN durable shape)
// ---------------------------------------------------------------------------

/** The stamp shape every record filename suffix carries (the export-stamp convention, duplicated). */
export const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/;

/** One revision of an incident (the append-only ledger law: re-reporting an id appends a NEW revision, never duplicates). */
export interface IncidentRevision {
	readonly revision: number;
	readonly reportedAtIso: string;
	readonly reportedAtEpoch: number;
	readonly class: string;
	readonly severity: Severity;
	readonly affectedSurface: string;
	readonly reproNote: string;
	readonly evidenceRefs: readonly string[];
	readonly sourceBinding: SourceBinding;
}

/** One incident in the ledger (the unique-id law: one id, N revisions). */
export interface IncidentRecord {
	readonly incidentId: string;
	readonly firstReportedAtIso: string;
	readonly firstReportedAtEpoch: number;
	readonly revisions: readonly IncidentRevision[];
}

/** The persisted incident ledger (schema `flauz.incidents/v1`). */
export interface IncidentsLedger {
	readonly $schema: typeof INCIDENTS_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly kind: 'flauz-incidents';
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly extensionId: typeof EXTENSION_ID;
	readonly incidents: readonly IncidentRecord[];
}

const INCIDENTS_KIND = 'flauz-incidents';

/** The incident ledger's read outcome (absent / torn / resolved -- typed, never guessed). */
export type IncidentsLedgerState =
	| { readonly state: 'absent' }
	| { readonly state: 'torn'; readonly reason: string }
	| { readonly state: 'resolved'; readonly record: IncidentsLedger };

/** Strict parse of one source binding (the typed refusal surface). */
export function parseSourceBinding(value: unknown): SourceBinding | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (value.kind === 'manual') {
		return { kind: 'manual', resolved: true, disclosed: 'manual-disclosed' };
	}
	if (value.kind === 'telemetry-census') {
		if (typeof value.failureClass !== 'string' || value.failureClass.length === 0 || typeof value.censusPath !== 'string' || value.censusPath.length === 0) {
			return undefined;
		}
		if (typeof value.resolved !== 'boolean') {
			return undefined;
		}
		return {
			kind: 'telemetry-census',
			failureClass: value.failureClass,
			censusPath: value.censusPath,
			resolved: value.resolved,
			disclosed: value.resolved ? 'resolved' : 'disclosed-unresolvable',
		};
	}
	if (value.kind === 'durability-escalation') {
		if (typeof value.laneId !== 'string' || value.laneId.length === 0 || typeof value.heartbeatPath !== 'string' || value.heartbeatPath.length === 0 || typeof value.policy !== 'string' || value.policy.length === 0) {
			return undefined;
		}
		if (typeof value.resolved !== 'boolean') {
			return undefined;
		}
		return {
			kind: 'durability-escalation',
			laneId: value.laneId,
			heartbeatPath: value.heartbeatPath,
			policy: value.policy,
			resolved: value.resolved,
			disclosed: value.resolved ? 'resolved' : 'disclosed-unresolvable',
		};
	}
	if (value.kind === 'dogfood-friction') {
		if (typeof value.frictionKind !== 'string' || value.frictionKind.length === 0 || typeof value.phase !== 'string' || value.phase.length === 0 || typeof value.frictionLogPath !== 'string' || value.frictionLogPath.length === 0) {
			return undefined;
		}
		if (typeof value.resolved !== 'boolean') {
			return undefined;
		}
		return {
			kind: 'dogfood-friction',
			frictionKind: value.frictionKind,
			phase: value.phase,
			frictionLogPath: value.frictionLogPath,
			resolved: value.resolved,
			disclosed: value.resolved ? 'resolved' : 'disclosed-unresolvable',
		};
	}
	return undefined;
}

/** Strict parse of one incident revision (value-level: structure + types). */
export function parseIncidentRevision(value: unknown): IncidentRevision | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
		return undefined;
	}
	if (typeof value.reportedAtIso !== 'string' || value.reportedAtIso.length === 0) {
		return undefined;
	}
	if (typeof value.reportedAtEpoch !== 'number' || !Number.isSafeInteger(value.reportedAtEpoch) || value.reportedAtEpoch < 0) {
		return undefined;
	}
	if (typeof value.class !== 'string' || value.class.length === 0) {
		return undefined;
	}
	if (typeof value.severity !== 'string' || !(SEVERITIES as readonly string[]).includes(value.severity)) {
		return undefined;
	}
	if (typeof value.affectedSurface !== 'string' || value.affectedSurface.length === 0) {
		return undefined;
	}
	if (typeof value.reproNote !== 'string') {
		return undefined;
	}
	if (!Array.isArray(value.evidenceRefs) || !value.evidenceRefs.every(ref => typeof ref === 'string' && isUnderFlauz(ref))) {
		return undefined;
	}
	const sourceBinding = parseSourceBinding(value.sourceBinding);
	if (sourceBinding === undefined) {
		return undefined;
	}
	return {
		revision: value.revision,
		reportedAtIso: value.reportedAtIso,
		reportedAtEpoch: value.reportedAtEpoch,
		class: value.class,
		severity: value.severity as Severity,
		affectedSurface: value.affectedSurface,
		reproNote: value.reproNote,
		evidenceRefs: [...(value.evidenceRefs as string[])],
		sourceBinding,
	};
}

/** Strict parse of one incident record (value-level: structure + types). */
export function parseIncidentRecord(value: unknown): IncidentRecord | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (!isIncidentId(value.incidentId)) {
		return undefined;
	}
	if (typeof value.firstReportedAtIso !== 'string' || value.firstReportedAtIso.length === 0) {
		return undefined;
	}
	if (typeof value.firstReportedAtEpoch !== 'number' || !Number.isSafeInteger(value.firstReportedAtEpoch) || value.firstReportedAtEpoch < 0) {
		return undefined;
	}
	if (!Array.isArray(value.revisions) || value.revisions.length === 0) {
		return undefined;
	}
	const revisions: IncidentRevision[] = [];
	for (const row of value.revisions) {
		const rev = parseIncidentRevision(row);
		if (rev === undefined) {
			return undefined;
		}
		revisions.push(rev);
	}
	// revisions must be 1..N in order
	for (let i = 0; i < revisions.length; i++) {
		if (revisions[i].revision !== i + 1) {
			return undefined;
		}
	}
	return {
		incidentId: value.incidentId,
		firstReportedAtIso: value.firstReportedAtIso,
		firstReportedAtEpoch: value.firstReportedAtEpoch,
		revisions,
	};
}

/** Reads + parses the incident ledger from a workspace root (typed at every degradation). */
export async function readIncidentsLedger(root: string, fs: IncidentsFsPort): Promise<IncidentsLedgerState> {
	const text = await fs.readFileUtf8(joinPath(root, INCIDENTS_DIR, INCIDENTS_FILENAME));
	if (text === undefined) {
		return { state: 'absent' };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		return { state: 'torn', reason: `incidents.json is not valid JSON: ${(err as Error).message}` };
	}
	if (!isPlainObject(parsed) || parsed.$schema !== INCIDENTS_SCHEMA_ID || parsed.kind !== INCIDENTS_KIND || !Array.isArray(parsed.incidents)) {
		return { state: 'torn', reason: 'incidents.json is not the flauz.incidents/v1 shape' };
	}
	const incidents: IncidentRecord[] = [];
	for (const row of parsed.incidents) {
		const rec = parseIncidentRecord(row);
		if (rec === undefined) {
			// a torn incident row is skipped (the ledger parses, the row did not) -- the status plane surfaces the ledger state honestly
			continue;
		}
		incidents.push(rec);
	}
	return {
		state: 'resolved',
		record: {
			$schema: INCIDENTS_SCHEMA_ID,
			schemaVersion: 0,
			kind: INCIDENTS_KIND,
			createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
			extensionId: EXTENSION_ID,
			incidents,
		},
	};
}

// ---------------------------------------------------------------------------
// The loop journal contract (this plane's OWN durable shape; one journal per incident)
// ---------------------------------------------------------------------------

/** The evidence a loop transition carries (the closure law + the evidence-label ladder). */
export interface TransitionEvidence {
	/** The evidence label from the frozen ladder (never promoted by wording). */
	readonly label: EvidenceLabel;
	/** The evidence payload (the named regression test's passing receipt, the release identity, the post-release verification receipt, the repro note, the registry item id, the fix changeset pointer -- shapes only). */
	readonly kind: string;
	/** The evidence detail (a short operator-facing account; swept fail-closed for secret-shaped values). */
	readonly detail: string;
	/** Optional workspace-relative evidence refs under .flauz/ only. */
	readonly evidenceRefs?: readonly string[];
	/** The repo-side registry item id (REQUIRED VERBATIM at the reproducible-finding -> registry-item transition; the two-registry separation link; absent elsewhere). */
	readonly registryItemId?: string;
}

/** One row of the per-incident loop journal (schema `flauz.incidents-loop/v1`, append-only). */
export interface LoopJournalRow {
	readonly $schema: typeof LOOP_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly kind: 'flauz-incidents-loop';
	readonly extensionId: typeof EXTENSION_ID;
	readonly incidentId: string;
	/** The transition sequence number within this incident's journal (1, 2, 3...). */
	readonly seq: number;
	/** The transition timestamp (epoch ms; the injected clock -- the only timestamp source). */
	readonly timestampEpoch: number;
	/** The transition timestamp (ISO-8601 UTC; derived from the injected clock). */
	readonly timestampIso: string;
	/** The actor who fired the transition (the operator id; never contents). */
	readonly actor: string;
	/** The transition kind: `forward` (the typed forward transition) | `reopen` (the ONE reopen law) | `close` (the loop closure on post-release verification) | `refusal` (the missing-evidence refusal). */
	readonly transition: 'forward' | 'reopen' | 'close' | 'refusal';
	/** The stage BEFORE the transition (the `from` stage; absent for the first `incident` intake row). */
	readonly fromStage?: LoopStage;
	/** The stage AFTER the transition (the `to` stage; for a `refusal`, the stage the incident stays at). */
	readonly toStage: LoopStage;
	/** The evidence the transition carries (absent for the first `incident` intake row). */
	readonly evidence?: TransitionEvidence;
	/** Present ONLY on `refusal` rows: the exact missing stage-evidence kind. */
	readonly refusedEvidenceKind?: string;
}

/** Strict parse of one loop journal row (value-level: structure + types). */
export function parseLoopJournalRow(value: unknown): LoopJournalRow | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (value.$schema !== LOOP_SCHEMA_ID || value.kind !== 'flauz-incidents-loop' || value.extensionId !== EXTENSION_ID) {
		return undefined;
	}
	if (!isIncidentId(value.incidentId)) {
		return undefined;
	}
	if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) {
		return undefined;
	}
	if (typeof value.timestampEpoch !== 'number' || !Number.isSafeInteger(value.timestampEpoch) || value.timestampEpoch < 0) {
		return undefined;
	}
	if (typeof value.timestampIso !== 'string' || value.timestampIso.length === 0) {
		return undefined;
	}
	if (typeof value.actor !== 'string' || value.actor.length === 0) {
		return undefined;
	}
	if (value.transition !== 'forward' && value.transition !== 'reopen' && value.transition !== 'close' && value.transition !== 'refusal') {
		return undefined;
	}
	if (value.fromStage !== undefined && (typeof value.fromStage !== 'string' || !(LOOP_STAGES as readonly string[]).includes(value.fromStage))) {
		return undefined;
	}
	if (typeof value.toStage !== 'string' || !(LOOP_STAGES as readonly string[]).includes(value.toStage)) {
		return undefined;
	}
	let evidence: TransitionEvidence | undefined;
	if (value.evidence !== undefined) {
		const ev = value.evidence;
		if (!isPlainObject(ev) || typeof ev.label !== 'string' || !(EVIDENCE_LABELS as readonly string[]).includes(ev.label) || typeof ev.kind !== 'string' || ev.kind.length === 0 || typeof ev.detail !== 'string') {
			return undefined;
		}
		if (ev.evidenceRefs !== undefined && (!Array.isArray(ev.evidenceRefs) || !ev.evidenceRefs.every((ref: unknown) => typeof ref === 'string' && isUnderFlauz(ref)))) {
			return undefined;
		}
		if (ev.registryItemId !== undefined && typeof ev.registryItemId !== 'string') {
			return undefined;
		}
		evidence = {
			label: ev.label as EvidenceLabel,
			kind: ev.kind,
			detail: ev.detail,
			...(ev.evidenceRefs !== undefined ? { evidenceRefs: [...(ev.evidenceRefs as string[])] } : {}),
			...(ev.registryItemId !== undefined ? { registryItemId: ev.registryItemId as string } : {}),
		};
	}
	if (value.refusedEvidenceKind !== undefined && typeof value.refusedEvidenceKind !== 'string') {
		return undefined;
	}
	return {
		$schema: LOOP_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents-loop',
		extensionId: EXTENSION_ID,
		incidentId: value.incidentId,
		seq: value.seq,
		timestampEpoch: value.timestampEpoch,
		timestampIso: value.timestampIso,
		actor: value.actor,
		transition: value.transition,
		toStage: value.toStage as LoopStage,
		...(value.fromStage !== undefined ? { fromStage: value.fromStage as LoopStage } : {}),
		...(evidence !== undefined ? { evidence } : {}),
		...(value.refusedEvidenceKind !== undefined ? { refusedEvidenceKind: value.refusedEvidenceKind } : {}),
	};
}

/** Reads the per-incident loop journal (absent when the journal file does not exist yet). */
export async function readLoopJournal(root: string, fs: IncidentsFsPort, incidentId: string): Promise<{ readonly state: 'absent' } | { readonly state: 'resolved'; readonly rows: readonly LoopJournalRow[] } | { readonly state: 'torn'; readonly reason: string }> {
	if (!isIncidentId(incidentId)) {
		return { state: 'torn', reason: `the incident id '${incidentId}' is not the flauz:inc:<16-hex> shape` };
	}
	const text = await fs.readFileUtf8(joinPath(root, INCIDENTS_DIR, `${LOOP_PREFIX}${incidentId}.jsonl`));
	if (text === undefined || text === '') {
		return { state: 'absent' };
	}
	const rows: LoopJournalRow[] = [];
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
		const row = parseLoopJournalRow(parsed);
		if (row === undefined) {
			return { state: 'torn', reason: `loop journal line ${String(index + 1)} is not the flauz.incidents-loop/v1 shape` };
		}
		rows.push(row);
	}
	return { state: 'resolved', rows };
}

// ---------------------------------------------------------------------------
// The status record contract (this plane's OWN durable shape)
// ---------------------------------------------------------------------------

/** One incident's verdict row in the status record. */
export interface IncidentStatusRow {
	readonly incidentId: string;
	/** The current loop stage (the last journal row's toStage; `incident` when no transition has fired yet). */
	readonly loopStage: LoopStage;
	/** The source-binding state (resolved | disclosed-unresolvable | manual-disclosed). */
	readonly sourceBindingState: SourceBindingState;
	/** The source-binding kind (manual | telemetry-census | durability-escalation | dogfood-friction). */
	readonly sourceBindingKind: SourceBindingKind;
	/** The current revision number (the latest revision the incident carries). */
	readonly revisionCount: number;
	/** The current severity (the latest revision's severity). */
	readonly severity: Severity;
	/** The current class (the latest revision's class). */
	readonly class: string;
	/** The current affected surface (the latest revision's affected surface). */
	readonly affectedSurface: string;
	/**
	 * Closure readiness: the EXACT list of missing stage-evidence kinds the
	 * loop needs to close (typed; empty when the loop is closed or no
	 * forward transition is available). Each entry names the evidence kind
	 * the next forward transition requires.
	 */
	readonly missingEvidence: readonly string[];
	/** The loop verdict: closed | open | reopened | refused-evidence. */
	readonly verdict: LoopVerdict;
	/** Present when the verdict is `refused-evidence`: the exact missing stage-evidence kind that refused the last transition. */
	readonly refusedEvidenceKind?: string;
	/** The loop journal length (the number of transition rows recorded). */
	readonly journalRows: number;
	/** The repo-side registry item id carried VERBATIM at the registry-item stage (the two-registry separation link; present after the registry-item transition). */
	readonly registryItemId?: string;
}

/** The persisted ledger-verdict record (schema `flauz.incidents-status/v1`). */
export interface IncidentsStatusRecord {
	readonly $schema: typeof STATUS_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly kind: 'flauz-incidents-status';
	readonly createdAt: number;
	readonly extensionId: typeof EXTENSION_ID;
	/** The honest-scope disclosure, verbatim in every record. */
	readonly boundaryDisclosure: string;
	/** The incident ledger's typed state at the verdict's instant. */
	readonly ledgerState: 'resolved' | 'torn' | 'absent';
	readonly tornReason?: string;
	readonly incidents: readonly IncidentStatusRow[];
	readonly counts: {
		readonly incidents: number;
		readonly closed: number;
		readonly open: number;
		readonly reopened: number;
		readonly refusedEvidence: number;
		readonly manualDisclosed: number;
		readonly resolved: number;
		readonly disclosedUnresolvable: number;
	};
}

// ---------------------------------------------------------------------------
// The source-record contracts (READ-ONLY; contract-duplicated from the owning
// modules -- flauz-telemetry/src/failuresList.ts (the failure census),
// flauz-durability/src/heartbeat.ts (the escalation-demand record),
// build/flauz/dogfood/frictionlog.mjs (the friction log); pinned by the
// contract suite -- never imported across extensions)
// ---------------------------------------------------------------------------

/** The telemetry failure census entry shape (contract-duplicated from flauz-telemetry/src/failuresList.ts). */
export const TELEMETRY_FAILURES_SCHEMA_ID = 'flauz.telemetry-failures/v1';

/** One class group of the telemetry failure census (the consulted slice for a telemetry-census source binding). */
export interface TelemetryFailureClassRow {
	readonly failureClass: string;
	readonly eventCount: number;
}

/** The telemetry failure census (the `flauz.failures.list` record; the consulted contract). */
export interface TelemetryFailureCensus {
	readonly $schema: typeof TELEMETRY_FAILURES_SCHEMA_ID;
	readonly classes: readonly TelemetryFailureClassRow[];
}

/** Lenient parse of a telemetry failure census (undefined when not the owning shape). */
export function parseTelemetryFailureCensusLenient(value: unknown): TelemetryFailureCensus | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (value.$schema !== TELEMETRY_FAILURES_SCHEMA_ID || !Array.isArray(value.classes)) {
		return undefined;
	}
	const classes: TelemetryFailureClassRow[] = [];
	for (const row of value.classes) {
		if (isPlainObject(row) && typeof row.failureClass === 'string' && row.failureClass.length > 0 && typeof row.eventCount === 'number') {
			classes.push({ failureClass: row.failureClass, eventCount: row.eventCount });
		}
	}
	return { $schema: TELEMETRY_FAILURES_SCHEMA_ID, classes };
}

/** The durability heartbeat record schema id (contract-duplicated from flauz-durability/src/heartbeat.ts). */
export const DURABILITY_HEARTBEAT_SCHEMA_ID = 'flauz.durability-heartbeat/v1';

/** The durability heartbeat escalation field (the escalation-demand record; the consulted slice). */
export interface DurabilityHeartbeatEscalation {
	readonly policy: string;
	readonly demandedAt: number;
}

/** The durability heartbeat record (the consulted contract for a durability-escalation source binding). */
export interface DurabilityHeartbeatRecord {
	readonly $schema: typeof DURABILITY_HEARTBEAT_SCHEMA_ID;
	readonly laneId: string;
	readonly escalation?: DurabilityHeartbeatEscalation;
}

/** Lenient parse of a durability heartbeat record (undefined when not the owning shape). */
export function parseDurabilityHeartbeatLenient(value: unknown): DurabilityHeartbeatRecord | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (value.$schema !== DURABILITY_HEARTBEAT_SCHEMA_ID || typeof value.laneId !== 'string' || value.laneId.length === 0) {
		return undefined;
	}
	let escalation: DurabilityHeartbeatEscalation | undefined;
	if (value.escalation !== undefined) {
		if (isPlainObject(value.escalation) && typeof value.escalation.policy === 'string' && typeof value.escalation.demandedAt === 'number') {
			escalation = { policy: value.escalation.policy, demandedAt: value.escalation.demandedAt };
		} else {
			return undefined;
		}
	}
	return {
		$schema: DURABILITY_HEARTBEAT_SCHEMA_ID,
		laneId: value.laneId,
		...(escalation !== undefined ? { escalation } : {}),
	};
}

/** The dogfood friction log schema id (contract-duplicated from build/flauz/dogfood/frictionlog.mjs). */
export const FRICTION_SCHEMA_ID = 'flauz.dogfood-friction/v1';

/** One friction row of the dogfood friction log (the consulted slice for a dogfood-friction source binding). */
export interface FrictionRow {
	readonly schema: typeof FRICTION_SCHEMA_ID;
	readonly type: 'friction';
	readonly ts: number;
	readonly phase: string;
	readonly kind: string;
	readonly detail: string;
	readonly recovery: string;
}

/** Lenient parse of one friction row (undefined when not the owning shape). */
export function parseFrictionRowLenient(value: unknown): FrictionRow | undefined {
	if (!isPlainObject(value)) {
		return undefined;
	}
	if (value.schema !== FRICTION_SCHEMA_ID || value.type !== 'friction') {
		return undefined;
	}
	if (typeof value.ts !== 'number' || typeof value.phase !== 'string' || typeof value.kind !== 'string' || typeof value.detail !== 'string' || typeof value.recovery !== 'string') {
		return undefined;
	}
	return {
		schema: FRICTION_SCHEMA_ID,
		type: 'friction',
		ts: value.ts,
		phase: value.phase,
		kind: value.kind,
		detail: value.detail,
		recovery: value.recovery,
	};
}

// Re-export the globals for the command surface (single import surface).
export {
	INCIDENTS_SCHEMA_ID,
	LOOP_SCHEMA_ID,
	STATUS_SCHEMA_ID,
	INCIDENTS_DIR,
	INCIDENTS_FILENAME,
	LOOP_PREFIX,
	LEDGER_PATH,
	SIZE_PATH,
	LEDGER_ROW_FORMAT_ID,
	INCIDENTS_TASK_ID,
	EXTENSION_ID,
	DEFAULT_CLOCK,
} from './globals.ts';
export type { Clock } from './globals.ts';
