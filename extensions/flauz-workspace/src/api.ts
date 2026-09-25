/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/api.ts
 *
 *  Shared vocabulary for the `.flauz/` contract v0: envelope types, the flauz.tasks/v0
 *  state machine, ledger row types, and the pure primitives every other module builds on
 *  (canonical JSON, deep-sorted serialization, sha256, POSIX-ish path joins).
 *
 *  This module is deliberately dependency-free (no `vscode` runtime import, no node
 *  builtins) so the whole core is testable under plain `node --test` and portable to
 *  any extension host. See README.md for the full contract.
 *--------------------------------------------------------------------------------------------*/

/** Schema identifier pinned into `.flauz/tasks.json`. */
export const SCHEMA_ID = 'flauz.tasks/v0';

/** Directory (relative to the workspace root) holding all Flauz state. */
export const FLAUZ_DIR = '.flauz';

/** Directory (relative to the workspace root) holding evidence artifacts + ledger. */
export const EVIDENCE_DIR = '.flauz/evidence';

/** Envelope path, relative to the workspace root. */
export const ENVELOPE_PATH = '.flauz/tasks.json';

/** Evidence ledger path, relative to the workspace root. */
export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';

export const TASK_STATUSES = ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff', 'failed', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Statuses from which `cancel` is legal ("any-active" in the seam contract). */
export const ACTIVE_STATUSES: readonly TaskStatus[] = ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff'];

export const ACTORS = ['agent', 'human', 'tool'] as const;
export type Actor = (typeof ACTORS)[number];

export const EVIDENCE_KINDS = ['changeset', 'screenshot', 'command-output', 'note'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export interface TaskEvent {
	readonly ts: number;
	readonly actor: Actor;
	readonly type: string;
	readonly payload: Record<string, unknown>;
}

export interface TaskChange {
	readonly uri: string;
	readonly checkpointRef: string | null;
}

export interface TaskTiming {
	readonly created: number;
	readonly updatedAt: number;
}

export interface Task {
	readonly id: string;
	readonly title: string;
	readonly status: TaskStatus;
	readonly events: readonly TaskEvent[];
	readonly timing: TaskTiming;
	readonly changes: readonly TaskChange[];
}

export interface Envelope {
	readonly $schema: string;
	readonly tasks: readonly Task[];
}

/** Caller-facing evidence row (the 7 contract fields are minted by the ledger). */
export interface LedgerRowInput {
	readonly kind: EvidenceKind;
	readonly uri: string;
	readonly sha256: string;
	readonly note?: string;
}

/** Stored ledger row — exactly the 7 contract fields, nothing else. */
export interface LedgerRow {
	readonly seq: number;
	readonly ts: number;
	readonly taskId: string;
	readonly kind: EvidenceKind;
	readonly uri: string;
	readonly sha256: string;
	readonly prev: string | null;
}

export interface TransitionRule {
	readonly type: string;
	readonly from: readonly TaskStatus[];
	readonly actors: readonly Actor[];
	readonly to: TaskStatus;
}

/**
 * Legal transitions of the flauz.tasks/v0 state machine (binding seam contract;
 * seed: flauz-code-lab prototypes/agent-task-state TRANSITIONS).
 * Actor gates are enforced: human gates on approve/request-changes/sign-off/cancel,
 * agent gates on submit-plan/report/fail/verify-fail, agent|tool on verify-pass.
 */
export const TRANSITIONS: readonly TransitionRule[] = [
	{ type: 'submit-plan', from: ['plan'], actors: ['agent'], to: 'awaiting-approval' },
	{ type: 'approve', from: ['awaiting-approval'], actors: ['human'], to: 'execute' },
	{ type: 'request-changes', from: ['awaiting-approval'], actors: ['human'], to: 'plan' },
	{ type: 'report', from: ['execute'], actors: ['agent'], to: 'verify' },
	{ type: 'verify-pass', from: ['verify'], actors: ['agent', 'tool'], to: 'awaiting-signoff' },
	{ type: 'verify-fail', from: ['verify'], actors: ['agent'], to: 'execute' },
	{ type: 'fail', from: ['execute'], actors: ['agent'], to: 'failed' },
	{ type: 'sign-off', from: ['awaiting-signoff'], actors: ['human'], to: 'done' },
	{ type: 'cancel', from: ACTIVE_STATUSES, actors: ['human'], to: 'cancelled' },
];

export function transitionRule(type: string): TransitionRule | undefined {
	return TRANSITIONS.find(rule => rule.type === type);
}

export function isTransitionType(type: string): boolean {
	return transitionRule(type) !== undefined;
}

export function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isActor(value: unknown): value is Actor {
	return typeof value === 'string' && (ACTORS as readonly string[]).includes(value);
}

export function isEvidenceKind(value: unknown): value is EvidenceKind {
	return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export function isSha256Hex(value: unknown): value is string {
	return typeof value === 'string' && SHA256_HEX_PATTERN.test(value);
}

const TASK_ID_PATTERN = /^T-\d{3,}$/;

export function isTaskId(value: unknown): value is string {
	return typeof value === 'string' && TASK_ID_PATTERN.test(value);
}

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace, `undefined`
 * values dropped. This is the exact byte input of the ledger row hash.
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
	throw new Error(`flauz.tasks/v0: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
}

/** Deep copy with recursively sorted keys (input to the pretty envelope serializer). */
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
 * Envelope serialization with the git-diffability discipline (DL-9): fully canonical
 * (sorted) key order, 2-space indent, exactly one trailing newline, no volatile noise.
 * Logically identical states always serialize to identical bytes.
 */
export function serializeEnvelope(envelope: Envelope): string {
	return JSON.stringify(deepSorted(envelope), null, 2) + '\n';
}

/** Structured deep clone (drops `undefined`; key order canonicalized — harmless). */
export function clone<T>(value: T): T {
	return JSON.parse(canonicalJson(value)) as T;
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
 * Implemented locally (instead of `node:crypto` or webcrypto) so that the whole core
 * stays free of node typings and runtime deps — the extension host and the node test
 * runner execute the exact same code path. Cross-checked against `node:crypto`
 * sha256 in test/ledger.test.ts.
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
			const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
			const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
			w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
		}
		let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
		for (let i = 0; i < 64; i++) {
			const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
			const ch = (e & f) ^ (~e & g);
			const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
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

/**
 * Filesystem port consumed by the services. The extension host wires a node-backed
 * implementation (src/extension.ts); tests wire the same against temp dirs. Keeping
 * this a port is what lets the core typecheck without @types/node and run under
 * plain `node --test`.
 */
export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;
