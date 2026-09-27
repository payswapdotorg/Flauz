/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the continuity persistence: strict parsing + canonical
 * serialization of the two NEW sibling envelopes, and the append-only ops
 * ledger.
 *
 *   - `.flauz/continuity-bundles/<bundleId>/manifest.json` —
 *     `flauz.continuity-bundle/v0`, serialized with the full DL-9/DL-32
 *     discipline (canonical sorted keys, 2-space indent, exactly one
 *     trailing newline, atomic tmp+rename).
 *   - `.flauz/continuity-ops.jsonl` — append-only, one canonical
 *     (sorted-keys, compact) JSON line per op. Appends re-validate and
 *     preserve every existing byte (read + validate + extend + atomic
 *     rewrite); the ledger never rewrites history.
 *
 * Parsing is STRICT: unknown keys, wrong schema ids, non-enum statuses/
 * actors/ops/results, cross-field violations (a `carried` entry without its
 * artifact; a `lost` entry with one; `result:'error'` without an error
 * payload or `ok` with one; artifact paths outside `surfaces/` or containing
 * traversal segments) are typed `BUNDLE_CORRUPT`/`OPS_CORRUPT` failures —
 * fail closed, never best-effort-load a mutated file.
 *
 * sha256: the pure-TypeScript implementation VERBATIM from
 * flauz-resources `src/api.ts` (itself the flauz-workspace copy — the
 * established DL-32 sibling-duplication discipline; zero deps, identical
 * code path in the extension host and `node --test`).
 */
import {
	FLAUZ_DIR,
	canonicalJson,
	hasExactKeys,
	hasKey,
	hasOnlyKeys,
	isBoundedString,
	isEnvironmentId,
	isPlainObject,
	isPositiveEpochMs,
	joinPath,
	serializeEnvelope,
	type Clock,
	type FileSystemPort,
} from '../api.ts';
import {
	BUNDLE_ID_PATTERN,
	BUNDLE_MANIFEST_NAME,
	BUNDLE_SCHEMA_ID,
	CONTINUITY_OPS,
	CONTINUITY_OPS_SCHEMA_ID,
	CONTINUITY_OPS_PATH,
	CONTINUITY_SCHEMA_VERSION,
	ContinuityError,
	PROVENANCE_ACTORS,
	SURFACE_STATUSES,
	isContinuityBundleId,
	type BundleSurfaceEntry,
	type ContinuityBundleManifest,
	type ContinuityOpDetails,
	type ContinuityOpError,
	type ContinuityOpRecord,
	type ProvenanceActor,
	type SurfaceStatus,
} from './types.ts';
import { surfaceSpec, CONTINUITY_SURFACES } from './surfaces.ts';

const NOTE_MAX = 500;
const SWITCH_PLAN_REF_PATTERN = /^flauz\.switchPlan\/v0:env-[a-z0-9][a-z0-9-]{0,47}@\d+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
/** Artifact paths live strictly inside the bundle: `surfaces/<seg>[/<seg>...]`, no traversal, no absolute, no backslash. */
const ARTIFACT_PATH_PATTERN = /^surfaces\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

function bundleError(message: string): ContinuityError {
	return new ContinuityError('BUNDLE_CORRUPT', message);
}

function opsError(message: string): ContinuityError {
	return new ContinuityError('OPS_CORRUPT', message);
}

// ---------------------------------------------------------------------------
// sha256 (pure TypeScript, zero deps — verbatim flauz-resources api.ts)
// ---------------------------------------------------------------------------

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

/** sha256 over the UTF-8 bytes of `input`, hex-encoded. */
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
			const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
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
// Bundle manifest (flauz.continuity-bundle/v0)
// ---------------------------------------------------------------------------

function parseSurfaceEntry(name: string, value: unknown): BundleSurfaceEntry {
	const where = `surfaces['${name}']`;
	if (surfaceSpec(name) === undefined) {
		throw bundleError(`${where}: unknown surface '${name}' (not in the closed continuity surface table — the N-8 canon + the post-canon state surfaces)`);
	}
	if (!isPlainObject(value)) {
		throw bundleError(`${where} must be an object {status, artifactPath?, sha256?, bytes?, note?}`);
	}
	if (!hasOnlyKeys(value, ['status'], ['artifactPath', 'sha256', 'bytes', 'note'])) {
		throw bundleError(`${where} must have exactly the keys [status] + optional [artifactPath, sha256, bytes, note] (the flauz.continuity-bundle/v0 surface contract)`);
	}
	if (typeof value.status !== 'string' || !(SURFACE_STATUSES as readonly string[]).includes(value.status)) {
		throw bundleError(`${where}.status must be one of carried|lost|redacted (got ${JSON.stringify(value.status)})`);
	}
	const status = value.status as SurfaceStatus;
	if (value.note !== undefined && !isBoundedString(value.note, NOTE_MAX)) {
		throw bundleError(`${where}.note must be a non-empty string of at most ${NOTE_MAX} chars`);
	}
	if (status === 'carried') {
		if (typeof value.artifactPath !== 'string' || !ARTIFACT_PATH_PATTERN.test(value.artifactPath) || value.artifactPath.split('/').includes('..')) {
			throw bundleError(`${where}.artifactPath must be a bundle-relative path 'surfaces/<name>[...]' without traversal segments (got ${JSON.stringify(value.artifactPath)})`);
		}
		if (typeof value.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(value.sha256)) {
			throw bundleError(`${where}.sha256 must be 64 lowercase hex chars (the artifact content hash)`);
		}
		if (typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes < 0) {
			throw bundleError(`${where}.bytes must be a non-negative integer`);
		}
		return { status, artifactPath: value.artifactPath, sha256: value.sha256, bytes: value.bytes, ...(value.note !== undefined ? { note: value.note } : {}) };
	}
	// lost / redacted: no payload artifact is ever recorded
	if (hasKey(value, 'artifactPath')) {
		throw bundleError(`${where}: a '${status}' surface must not carry artifactPath (only carried surfaces reference bundle artifacts)`);
	}
	if (hasKey(value, 'bytes')) {
		throw bundleError(`${where}: a '${status}' surface must not carry bytes (no payload metadata is recorded for ${status} surfaces)`);
	}
	if (status === 'redacted') {
		if (typeof value.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(value.sha256)) {
			throw bundleError(`${where}.sha256 must be 64 lowercase hex chars (the sha256 of the surface PATH — the redaction law records presence + path hash, never the payload)`);
		}
		const spec = surfaceSpec(name);
		if (spec !== undefined && spec.path !== null && value.sha256 !== sha256Hex(spec.path)) {
			throw bundleError(`${where}.sha256 must be the sha256 of the surface path '${spec.path}' (the redaction law: presence + PATH hash — got ${value.sha256}, expected ${sha256Hex(spec.path)})`);
		}
		return { status, sha256: value.sha256, ...(value.note !== undefined ? { note: value.note } : {}) };
	}
	if (hasKey(value, 'sha256')) {
		throw bundleError(`${where}: a 'lost' surface must not carry sha256 (nothing was hashed — the surface was not materialized)`);
	}
	if (!isBoundedString(value.note, NOTE_MAX)) {
		throw bundleError(`${where}.note is REQUIRED for a lost surface (why the surface was not carried — typed, never fabricated)`);
	}
	return { status, note: value.note };
}

/** Validates + parses a bundle manifest document (strict, closed surface table). */
export function parseBundleManifest(raw: string): ContinuityBundleManifest {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw bundleError(`bundle manifest is not valid JSON -- ${(err as Error).message}`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'bundleId', 'createdAt', 'actor', 'surfaces'], ['sourceEnvironmentId', 'switchPlanRef'])) {
		throw bundleError('bundle manifest must have exactly the keys [schemaVersion, schema, bundleId, createdAt, actor, surfaces] + optional [sourceEnvironmentId, switchPlanRef] (the flauz.continuity-bundle/v0 contract)');
	}
	if (value.schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
		throw bundleError(`bundle manifest schemaVersion must be exactly ${CONTINUITY_SCHEMA_VERSION} (got ${JSON.stringify(value.schemaVersion)})`);
	}
	if (value.schema !== BUNDLE_SCHEMA_ID) {
		throw bundleError(`bundle manifest schema must be exactly '${BUNDLE_SCHEMA_ID}' (got ${JSON.stringify(value.schema)})`);
	}
	if (typeof value.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(value.bundleId)) {
		throw bundleError(`bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(value.bundleId)}) — never a path, never a URL`);
	}
	if (!isPositiveEpochMs(value.createdAt)) {
		throw bundleError(`createdAt must be a positive epoch-ms integer (got ${JSON.stringify(value.createdAt)})`);
	}
	if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
		throw bundleError(`actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) — provenance is mandatory`);
	}
	if (hasKey(value, 'sourceEnvironmentId')) {
		if (!isEnvironmentId(value.sourceEnvironmentId)) {
			throw bundleError(`sourceEnvironmentId must be a registry environment id 'env-<slug>' when present (got ${JSON.stringify(value.sourceEnvironmentId)})`);
		}
	}
	if (hasKey(value, 'switchPlanRef')) {
		if (typeof value.switchPlanRef !== 'string' || !SWITCH_PLAN_REF_PATTERN.test(value.switchPlanRef)) {
			throw bundleError(`switchPlanRef must be a citation 'flauz.switchPlan/v0:<envId>@<epochMs>' when present (got ${JSON.stringify(value.switchPlanRef)})`);
		}
	}
	if (!isPlainObject(value.surfaces) || Object.keys(value.surfaces).length === 0) {
		throw bundleError('surfaces must be a non-empty object keyed by surface name (every canon surface is classified — lost surfaces are typed entries)');
	}
	const surfaces: Record<string, BundleSurfaceEntry> = {};
	for (const [name, entry] of Object.entries(value.surfaces)) {
		surfaces[name] = parseSurfaceEntry(name, entry);
	}
	// closed-table completeness: every surface of the table is classified —
	// a lost surface is a typed entry, never a dropped key
	for (const spec of CONTINUITY_SURFACES) {
		if (!hasKey(surfaces, spec.id)) {
			throw bundleError(`surfaces must cover the closed surface table (missing '${spec.id}' — lost surfaces are typed entries, never silently dropped)`);
		}
	}
	return {
		schemaVersion: CONTINUITY_SCHEMA_VERSION,
		schema: BUNDLE_SCHEMA_ID,
		bundleId: value.bundleId,
		createdAt: value.createdAt,
		actor: value.actor as ProvenanceActor,
		surfaces,
		...(hasKey(value, 'sourceEnvironmentId') ? { sourceEnvironmentId: value.sourceEnvironmentId as string } : {}),
		...(hasKey(value, 'switchPlanRef') ? { switchPlanRef: value.switchPlanRef as string } : {}),
	};
}

/** Serializes a bundle manifest with the DL-9/DL-32 discipline. */
export function serializeBundleManifest(manifest: ContinuityBundleManifest): string {
	return serializeEnvelope(manifest);
}

// ---------------------------------------------------------------------------
// Ops ledger (flauz.continuity-ops/v0 — one canonical JSON line per op)
// ---------------------------------------------------------------------------

function parseOpDetails(value: unknown, where: string): ContinuityOpDetails {
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['surfacesCarried', 'surfacesLost', 'surfacesRedacted'], ['fromEnvironmentId', 'toEnvironmentId'])) {
		throw opsError(`${where}: details must have exactly the keys [surfacesCarried, surfacesLost, surfacesRedacted] + optional [fromEnvironmentId, toEnvironmentId]`);
	}
	for (const key of ['surfacesCarried', 'surfacesLost', 'surfacesRedacted'] as const) {
		if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0) {
			throw opsError(`${where}.details.${key} must be a non-negative integer`);
		}
	}
	for (const key of ['fromEnvironmentId', 'toEnvironmentId'] as const) {
		if (hasKey(value, key) && !isEnvironmentId(value[key])) {
			throw opsError(`${where}.details.${key} must be a registry environment id 'env-<slug>' when present`);
		}
	}
	return {
		surfacesCarried: value.surfacesCarried as number,
		surfacesLost: value.surfacesLost as number,
		surfacesRedacted: value.surfacesRedacted as number,
		...(hasKey(value, 'fromEnvironmentId') ? { fromEnvironmentId: value.fromEnvironmentId as string } : {}),
		...(hasKey(value, 'toEnvironmentId') ? { toEnvironmentId: value.toEnvironmentId as string } : {}),
	};
}

/** Validates one parsed ledger line (strict, exact key set). */
export function parseContinuityOpRecord(value: unknown, lineNo: number): ContinuityOpRecord {
	const where = `ops ledger line ${lineNo}`;
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'bundleId', 'result'], ['details', 'error'])) {
		throw opsError(`${where} must have the keys [schemaVersion, schema, ts, actor, op, bundleId, result] plus at most [details, error] (the flauz.continuity-ops/v0 contract)`);
	}
	if (value.schemaVersion !== CONTINUITY_SCHEMA_VERSION) {
		throw opsError(`${where} schemaVersion must be exactly ${CONTINUITY_SCHEMA_VERSION}`);
	}
	if (value.schema !== CONTINUITY_OPS_SCHEMA_ID) {
		throw opsError(`${where} schema must be exactly '${CONTINUITY_OPS_SCHEMA_ID}'`);
	}
	if (!isPositiveEpochMs(value.ts)) {
		throw opsError(`${where} ts must be a positive epoch-ms integer`);
	}
	if (typeof value.actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(value.actor)) {
		throw opsError(`${where} actor must be one of agent|human|tool (got ${JSON.stringify(value.actor)}) — provenance is mandatory`);
	}
	if (typeof value.op !== 'string' || !(CONTINUITY_OPS as readonly string[]).includes(value.op)) {
		throw opsError(`${where} op must be one of ${CONTINUITY_OPS.join('|')} (got ${JSON.stringify(value.op)})`);
	}
	if (typeof value.bundleId !== 'string' || !BUNDLE_ID_PATTERN.test(value.bundleId)) {
		throw opsError(`${where} bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(value.bundleId)})`);
	}
	if (value.result !== 'ok' && value.result !== 'error') {
		throw opsError(`${where} result must be 'ok' or 'error' (got ${JSON.stringify(value.result)})`);
	}
	if (value.result === 'error') {
		if (!hasKey(value, 'error')) {
			throw opsError(`${where} result 'error' requires the error payload {code, message}`);
		}
		if (!isPlainObject(value.error) || !hasExactKeys(value.error, ['code', 'message'])) {
			throw opsError(`${where} error must have exactly the keys [code, message]`);
		}
		const error = value.error as Record<string, unknown>;
		if (!isBoundedString(error.code, 64)) {
			throw opsError(`${where} error.code must be a non-empty string (<= 64 chars)`);
		}
		if (!isBoundedString(error.message, 300)) {
			throw opsError(`${where} error.message must be a non-empty string (<= 300 chars)`);
		}
	} else if (hasKey(value, 'error')) {
		throw opsError(`${where} result 'ok' must not carry an error payload`);
	}
	if (hasKey(value, 'details')) {
		parseOpDetails(value.details, where); // validated; kept as-is (already canonical-safe)
	}
	return {
		schemaVersion: CONTINUITY_SCHEMA_VERSION,
		schema: CONTINUITY_OPS_SCHEMA_ID,
		ts: value.ts,
		actor: value.actor as ProvenanceActor,
		op: value.op as ContinuityOpRecord['op'],
		bundleId: value.bundleId,
		result: value.result,
		...(hasKey(value, 'details') ? { details: value.details as ContinuityOpDetails } : {}),
		...(value.result === 'error'
			? { error: { code: (value.error as Record<string, string>).code, message: (value.error as Record<string, string>).message } }
			: {}),
	};
}

/** Validates + parses a single raw ledger line (JSON text, no trailing newline). */
export function parseContinuityOpLine(line: string, lineNo: number): ContinuityOpRecord {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (err) {
		throw opsError(`ops ledger line ${lineNo} is not valid JSON -- ${(err as Error).message}`);
	}
	return parseContinuityOpRecord(value, lineNo);
}

/** Canonical single-line serialization of an op record (sorted keys, compact). */
export function serializeContinuityOpRecord(record: ContinuityOpRecord): string {
	return canonicalJson(record);
}

/**
 * The append-only continuity ops ledger. `append` re-validates the full
 * existing content before extending it (history is never silently mutated);
 * the extended file is written atomically (tmp + rename).
 */
export class ContinuityOpsLedger {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly opsPath: string;

	constructor(options: { readonly root: string; readonly fs: FileSystemPort; readonly clock?: Clock }) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.opsPath = joinPath(options.root, CONTINUITY_OPS_PATH);
	}

	get path(): string {
		return this.opsPath;
	}

	/** Validates + parses a full ledger document (used by load + tests). */
	static parseLedger(raw: string): ContinuityOpRecord[] {
		const lines = raw.split('\n');
		if (lines[lines.length - 1] !== '') {
			throw opsError('ops ledger must end with a newline');
		}
		const records: ContinuityOpRecord[] = [];
		for (let i = 0; i < lines.length - 1; i++) {
			const line = lines[i]!;
			if (line.trim().length === 0) {
				throw opsError(`ops ledger line ${i + 1} is empty (one JSON object per line; no blank lines)`);
			}
			records.push(parseContinuityOpLine(line, i + 1));
		}
		return records;
	}

	/** All records (missing file = no ops yet). Fails closed on corruption. */
	async readAll(): Promise<readonly ContinuityOpRecord[]> {
		const raw = await this.fs.readFileUtf8(this.opsPath);
		if (raw === undefined || raw.trim().length === 0) {
			return [];
		}
		return ContinuityOpsLedger.parseLedger(raw);
	}

	/** Appends one record; returns its 1-based line number. Existing bytes preserved. */
	async append(record: ContinuityOpRecord): Promise<number> {
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		const raw = await this.fs.readFileUtf8(this.opsPath);
		const existing = raw === undefined || raw.trim().length === 0 ? '' : raw;
		if (existing.length > 0) {
			ContinuityOpsLedger.parseLedger(existing); // corruption fails closed BEFORE we extend
		}
		const line = serializeContinuityOpRecord(record);
		if (line.includes('\n')) {
			throw opsError('an op record must serialize to a single line');
		}
		const contents = `${existing}${line}\n`;
		const tmp = `${this.opsPath}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, this.opsPath);
		return contents.split('\n').length - 1; // number of lines
	}
}

/** Builds the manifest file path of a bundle dir. */
export function bundleManifestPath(bundlesDir: string, bundleId: string): string {
	return joinPath(bundlesDir, bundleId, BUNDLE_MANIFEST_NAME);
}
