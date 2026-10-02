/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Telemetry -- the telemetry plane + provider/environment failure-typing
 * contracts (v1).
 *
 * A-PROD-004-W4 (TL-A): the beta gate's `telemetry with explicit privacy
 * controls` and `provider/environment failure handling` rows, built on W1's
 * census (PR #128 -- the surface inventory + the census-visible banking
 * target), W2's canary machinery (PR #133 -- the secret-shape sweep law) and
 * W3's typed-refusal grammar (PR #134 -- the REFUSED-not-a-wall command
 * surface).
 *
 * THE PRIVACY LAW IS THIS WAVE'S PRODUCT (the work order's telemetry-specific
 * law, verbatim posture):
 *
 *   1. OPT-IN BY DEFAULT -- zero collection until the operator explicitly
 *      enables it; the config records the consent event itself; a record
 *      attempt while disabled is a TYPED REFUSAL, never a silent no-op.
 *   2. LOCAL-FIRST -- aggregates persist workspace-locally under
 *      `.flauz/telemetry/`; there is NO network egress anywhere in this
 *      extension (no fetch, no http, no socket -- v0 by design); nothing
 *      leaves the machine, and the report command reads the local ledger only.
 *   3. DECLARED BEFORE ENABLED -- every dimension telemetry CAN record is
 *      enumerated in a declared schema the operator can inspect BEFORE
 *      enabling (schema.ts); the config pins the schema digest it was
 *      inspected against.
 *   4. AGGREGATES ONLY, NEVER CONTENTS -- event CONTENTS (prompts,
 *      completions, provider payloads, message texts, free-form notes) are
 *      NEVER recorded: only shapes/counts/durations/outcomes, every value
 *      drawn from a closed vocabulary. The canary sweep (privacy.ts) deep-walks
 *      every would-be-written artifact and refuses the whole batch on any
 *      secret-shaped value (fail-closed, the W2 posture).
 *
 * Contract-duplication law (DL-32, the W3 precedent): every durable-state
 * format read by this extension is duplicated HERE (or in the owning module
 * of this extension's src tree) as types + parsers -- never imported from the
 * owning extensions. The duplication is pinned by test/contract.test.ts
 * against the REAL owning modules (test-time cross-extension imports are the
 * sanctioned pin pattern; src never crosses extension boundaries).
 */

// ---------------------------------------------------------------------------
// Schema ids + durable paths (the telemetry extension's own artifacts)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into the telemetry config artifact. */
export const TELEMETRY_CONFIG_SCHEMA_ID = 'flauz.telemetry-config/v1';

/** Schema identifier pinned into every telemetry ledger row. */
export const TELEMETRY_EVENT_SCHEMA_ID = 'flauz.telemetry-event/v1';

/** Schema identifier pinned into the declared-event-schema descriptor (the inspect-before-enable plane). */
export const TELEMETRY_SCHEMA_DESCRIPTOR_ID = 'flauz.telemetry-schema/v1';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** The telemetry extension's own durable home (config + ledger; workspace-local, never exported). */
export const TELEMETRY_DIR = '.flauz/telemetry';

/** The telemetry configuration artifact (the opt-in plane). */
export const CONFIG_PATH = '.flauz/telemetry/config.json';

/** The workspace-local telemetry ledger (JSONL, one canonical aggregate row per line). */
export const LEDGER_PATH = '.flauz/telemetry/ledger.jsonl';

/** The synthetic ledger taskId of the census-visible telemetry banking rows (the flauz-backup/flauz-migration precedent). */
export const TELEMETRY_TASK_ID = 'flauz-telemetry';

/** Default retention (days) when the operator has not chosen one. */
export const DEFAULT_RETENTION_DAYS = 30;

/** Retention bounds (days): a retention policy must stay inside [1, 3650]. */
export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 3650;

// --- the observed durable-state surface paths (read-only; each owned by its
//     extension; contract-duplicated from the owning constants, pinned by the
//     contract suite) ---

/** The provider-lane routing decisions journal (flauz-models). */
export const ROUTING_DECISIONS_PATH = '.flauz/models/routing-decisions.jsonl';

/** The orchestration journal (flauz-agent core). */
export const ORCH_JOURNAL_PATH = '.flauz/orchestration/journal.jsonl';

/** The environments registry (flauz-environments). */
export const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';

/** The workflow envelopes directory (flauz-workflow). */
export const WORKFLOWS_DIR = '.flauz/workflows';

/** The evidence ledger (flauz-workspace; the census-visible banking target). */
export const EVIDENCE_LEDGER_PATH = '.flauz/evidence/ledger.jsonl';

/** The evidence size watermark (flauz-workspace; resynced after banking, the W3 law). */
export const EVIDENCE_SIZE_PATH = '.flauz/evidence/size.json';

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: read/readdir for the observers,
 * mkdir/write/append for the ledger + config, remove for the retention prune.
 */
export interface TelemetryFsPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	/** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR) -- a leaf, never a crash. */
	readdir(path: string): Promise<readonly string[] | undefined>;
	mkdir(path: string): Promise<void>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
	/** Idempotent removal (an absent target is fine) -- the retention prune surface. */
	remove(path: string): Promise<void>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.telemetry.*` / `flauz.failures.*` render target). */
export interface OutputChannelPort {
	appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type TelemetryErrorCode =
	| 'FLAUZ_TELEMETRY_NO_WORKSPACE'
	| 'FLAUZ_TELEMETRY_DISABLED'
	| 'FLAUZ_TELEMETRY_CONFIG_INVALID'
	| 'FLAUZ_TELEMETRY_CONFIG_CORRUPT'
	| 'FLAUZ_TELEMETRY_SCHEMA_DRIFT'
	| 'FLAUZ_TELEMETRY_SECRET_SHAPED'
	| 'FLAUZ_TELEMETRY_LEDGER_CORRUPT'
	| 'FLAUZ_TELEMETRY_FORMAT';

/** Typed telemetry failure. `code` is stable; `detail` carries the class laws. */
export class TelemetryError extends Error {
	readonly code: TelemetryErrorCode;

	constructor(code: TelemetryErrorCode, message: string) {
		super(message);
		this.name = 'TelemetryError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace/api.ts;
// pinned byte-equal by test/contract.test.ts -- never imported across extensions)
// ---------------------------------------------------------------------------

/** POSIX-style join (v0 targets POSIX workspace roots; documented in README). */
export function joinPath(...parts: readonly string[]): string {
	return parts.filter(part => part.length > 0).join('/').replace(/\/{2,}/g, '/');
}

/**
 * Canonical JSON: keys sorted recursively, no insignificant whitespace, `undefined`
 * values dropped. This is the exact byte input of every chain row hash.
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
	throw new Error(`flauz.telemetry/v1: cannot canonicalize value of type ${typeof value} (payloads must be JSON-safe)`);
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
 * Duplicated by contract from flauz-workspace/src/api.ts (implemented locally
 * instead of node:crypto so the core stays free of node typings and runtime
 * deps); pinned byte-equal against node:crypto in test/contract.test.ts.
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

/** Byte length of a UTF-8 string (the same encoder the watermark comparison uses). */
export function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}
