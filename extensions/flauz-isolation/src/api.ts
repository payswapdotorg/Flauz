/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Isolation -- the data-isolation plane
 * (A-PROD-005-W3, the wave the W1 gate's dataIsolation NOT-YET row names).
 *
 * THE WAVE'S LAW: this extension owns the WORKSPACE-BOUNDARY ENFORCEMENT
 * plane -- the boundary audit that enumerates EVERY persistent surface the
 * product writes (each discovered through the REAL product registry
 * surfaces: the extensions/flauz-* manifests + the packaging-parity
 * registry + the SBOM components -- the census derivation, never a
 * hardcoded list that can drift) and classifies each against the isolation
 * law (workspace-bound / workspace-exportable / port-owned), and the
 * enforcement verdict that checks the CURRENT workspace against the
 * boundary laws (the one-tree census, the export-dir shape, the telemetry
 * local-only law, the memory-tier + migration-state containment, the
 * banked-record taskId law) with the typed verdict table
 * green/violation/unknown/absent. It never repairs, never quarantines,
 * never deletes: an isolation plane PROVES boundaries, it does not mutate
 * state (a failed check routes to the operator).
 *
 * THE HONEST-BOUNDARY DISCLOSURE (stated in every command render and every
 * record): the workspace is the isolatable unit this product owns. The
 * boundary laws are enforced WITHIN the workspace root's reachable tree;
 * OS-level sandboxing, containerization and multi-tenant HOST isolation
 * are the HOST's posture, outside this plane's jurisdiction (disclosed,
 * never claimed). A check that cannot resolve degrades typed (absent /
 * unknown) -- never a silent green.
 *
 * THE EVIDENCE LAW (local-real): the product registry is the REAL
 * repo-state tree (real manifests read through the product-root port);
 * fixture workspaces carry real .flauz/ trees (records with the owning
 * schema ids, evidence rows written through THIS extension's real banking
 * writer); planted violations are real trees walked by the real boundary
 * scan. Never claim runtime-real for multi-tenant host isolation.
 *
 * THE PRIVACY LAW IS THE METADATA LAW (the W1/W2/W5 posture): every
 * surface this extension produces -- the audit record, the enforce record,
 * the status render, the banked evidence rows -- enumerates surface SHAPES
 * (paths, classifications, verdicts, counts, extension names, boundary
 * ids) and NEVER CONTENTS. Every metadata surface is swept for
 * secret-shaped values before a single byte is written (fail-closed, the
 * W2 canary posture). Records carry WORKSPACE-RELATIVE paths only (never
 * absolute host paths, never file contents).
 *
 * Contract-duplication law (DL-32, the flauz-diagnostics/flauz-release/
 * flauz-production/flauz-integrity precedent): every durable-state format
 * + sibling extension state this extension consults is duplicated HERE as
 * types + parsers -- never imported from the owning extensions at src time
 * (the boundary law). The duplication is pinned by test/contract.test.ts
 * against the REAL owning modules (test-time cross-extension imports are
 * the sanctioned pin pattern; src never crosses extension boundaries).
 */

/** Schema identifier pinned into every boundary-audit record (the order's id, verbatim). */
export const AUDIT_SCHEMA_ID = 'flauz-isolation-audit/v1';

/** Schema identifier pinned into every enforcement-verdict record (the order's id, verbatim). */
export const ENFORCE_SCHEMA_ID = 'flauz-isolation-enforce/v1';

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/**
 * Directory (relative to the workspace root) holding every export, one
 * directory per export: `<root>/.flauz-exports/export-<stamp>/` (the W2
 * backup law, contract-duplicated: an export must never recurse into
 * itself -- DELIBERATELY outside `.flauz/`, never inside it).
 */
export const EXPORTS_DIR = '.flauz-exports';

/** This extension's own durable home (the audit + enforce records). */
export const ISOLATION_DIR = '.flauz/isolation';

/** The audit record filename prefix: `audit-<stamp>.json`. */
export const AUDIT_PREFIX = 'audit-';

/** The enforce record filename prefix: `enforce-<stamp>.json`. */
export const ENFORCE_PREFIX = 'enforce-';

/** The synthetic ledger taskId of the banked isolation rows (the flauz-backup/flauz-migration/flauz-telemetry/flauz-release/flauz-production/flauz-integrity precedent). */
export const ISOLATION_TASK_ID = 'flauz-isolation';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-isolation';

/** The one-tree law: exactly this many `.flauz/` trees may be reachable from a workspace root. */
export const ONE_TREE_LAW = 1;

// --- the repo-state product surfaces (read-only; contract-duplicated from
//     flauz-release/src/api.ts via flauz-production/src/api.ts +
//     flauz-integrity/src/api.ts; the product-root port reads these) -- the
//     registry the audit's surface derivation enumerates ---

/** The packaging-parity registry path (relative to the product root; the product-state signature probe). */
export const PRODUCT_PARITY_REGISTRY_PATH = 'build/flauz/packaging-parity.json';

/** The SBOM path (relative to the product root; the security-runtime-gate component inventory). */
export const PRODUCT_SBOM_PATH = 'build/flauz/security/flauz-sbom.json';

/** The extensions directory of the product state (one `flauz-*` directory per packaged extension). */
export const PRODUCT_EXTENSIONS_DIR = 'extensions';

// --- the durable-state banking surfaces (read-only; owned by flauz-workspace;
//     contract-duplicated from the owning constants, pinned by the contract suite) ---

export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the ledger file self-declares no $schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

// ---------------------------------------------------------------------------
// Ports (the node-free core discipline; extension.ts wires node, tests wire temp dirs)
// ---------------------------------------------------------------------------

/**
 * The filesystem port this extension needs: the read surface (UTF-8 text +
 * directory listings + symlink probing -- the boundary scan walks REAL
 * trees) plus the writes its OWN artifacts own (the audit record, the
 * enforce record, the census-visible ledger banking).
 */
export interface IsolationFsPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	/** Undefined when the path is not listable as a directory: missing (ENOENT) or a non-directory path (ENOTDIR). */
	readdir(path: string): Promise<readonly string[] | undefined>;
	mkdir(path: string): Promise<void>;
	writeFile(path: string, contents: string): Promise<void>;
	appendFile(path: string, contents: string): Promise<void>;
	/**
	 * The symlink target when `path` is a symbolic link (raw target text:
	 * absolute or link-relative, exactly as stored); undefined when the path
	 * is absent or is not a symlink (ENOENT/EINVAL -- a leaf, never a crash).
	 */
	readlink(path: string): Promise<string | undefined>;
}

/** Injectable clock (deterministic fixtures in tests; Date.now in the host). */
export type Clock = () => number;

/** Injectable output channel (the `flauz.isolation.*` render target). */
export interface OutputChannelPort {
	appendLine(line: string): void;
}

// ---------------------------------------------------------------------------
// Typed errors (fail-closed surface; stable codes for logs/audit)
// ---------------------------------------------------------------------------

export type IsolationErrorCode =
	| 'FLAUZ_ISOLATION_NO_WORKSPACE'
	| 'FLAUZ_ISOLATION_NO_PRODUCT_STATE'
	| 'FLAUZ_ISOLATION_SECRET_SHAPED'
	| 'FLAUZ_ISOLATION_FORMAT';

/** Typed isolation failure. `code` is stable; `detail` carries the class laws. */
export class IsolationError extends Error {
	readonly code: IsolationErrorCode;

	constructor(code: IsolationErrorCode, message: string) {
		super(message);
		this.name = 'IsolationError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// Canonical JSON + sha256 (contract-duplicated from flauz-workspace/api.ts
// via flauz-release/flauz-production/flauz-integrity; pinned byte-equal by
// test/contract.test.ts -- never imported across extensions)
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
	throw new Error('flauz.isolation/v1: cannot canonicalize value of type ' + typeof value + ' (payloads must be JSON-safe)');
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
 * flauz-production/flauz-integrity implementations (implemented locally
 * instead of node:crypto so the core stays free of node typings and runtime
 * deps); pinned byte-equal against node:crypto AND the owning
 * implementations in test/contract.test.ts.
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
// via flauz-release/flauz-production/flauz-integrity; the banking path + the
// banked-record taskId law consume exactly these)
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
 * The canonical stored line of a ledger row (no trailing newline) -- the exact
 * bytes hashed by the chain. Re-canonicalized from the PARSED row so an
 * on-disk line that is valid JSON but non-canonical still verifies by value.
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
// The repo-state product registry reader (contract-duplicated from
// flauz-release/flauz-production productState.ts -- THE registry the audit's
// surface derivation enumerates; the duplication is pinned against the real
// owning module by test/contract.test.ts)
// ---------------------------------------------------------------------------

/** The registry summary the audit derives its surface enumeration from (shapes only, never contents). */
export interface ProductRegistry {
	/** The extension directory names (sorted): every `extensions/flauz-*` of the product state. */
	readonly extensions: readonly string[];
	/** The parity registry's row count (absent registry = -1: reported inside, never guessed). */
	readonly parityRowCount: number;
	/** The SBOM's component count (absent SBOM = -1). */
	readonly sbomComponentCount: number;
	/** The SBOM's extension-kind component names (the packaged set the SBOM tracks). */
	readonly sbomExtensionComponents: readonly string[];
}

/**
 * The product-state signature probe (the W5 port, contract-duplicated): a
 * root carrying the parity registry is repo-state-product-shaped (the
 * registry is the machine contract that pins the packaged surface set; the
 * wiring layer resolves the workspace root's product state through this
 * probe).
 */
export async function isProductRoot(root: string, fs: IsolationFsPort): Promise<boolean> {
	const text = await fs.readFileUtf8(joinPath(root, PRODUCT_PARITY_REGISTRY_PATH));
	return text !== undefined;
}

/**
 * Reads the product registry from a repo-shaped root: the `extensions/flauz-*`
 * manifest set (the packaged extension surface -- the census derivation's
 * subject), the parity registry's row count + the SBOM's component inventory
 * (shape-only summaries; the registry surfaces are read-only evidence).
 */
export async function readProductRegistry(productRoot: string, fs: IsolationFsPort): Promise<ProductRegistry | undefined> {
	const entries = await fs.readdir(joinPath(productRoot, PRODUCT_EXTENSIONS_DIR));
	if (entries === undefined) {
		return undefined;
	}
	const extensions = [...entries].filter(name => /^flauz-[a-z0-9-]+$/.test(name)).sort();

	let parityRowCount = -1;
	const parityText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_PARITY_REGISTRY_PATH));
	if (parityText !== undefined) {
		try {
			const parsed: unknown = JSON.parse(parityText);
			if (isPlainObject(parsed) && Array.isArray(parsed.rows)) {
				parityRowCount = parsed.rows.length;
			}
		} catch {
			// a torn registry is reported as absent (-1); the audit's registry row carries the shape
		}
	}

	let sbomComponentCount = -1;
	const sbomExtensionComponents: string[] = [];
	const sbomText = await fs.readFileUtf8(joinPath(productRoot, PRODUCT_SBOM_PATH));
	if (sbomText !== undefined) {
		try {
			const parsed: unknown = JSON.parse(sbomText);
			if (isPlainObject(parsed) && Array.isArray(parsed.components)) {
				sbomComponentCount = parsed.components.length;
				for (const component of parsed.components) {
					if (isPlainObject(component) && typeof component.name === 'string' && component.name.startsWith('flauz-')) {
						sbomExtensionComponents.push(component.name);
					}
				}
			}
		} catch {
			// a torn SBOM is reported as absent (-1); the audit's registry row carries the shape
		}
	}

	return { extensions, parityRowCount, sbomComponentCount, sbomExtensionComponents: [...new Set(sbomExtensionComponents)].sort() };
}
