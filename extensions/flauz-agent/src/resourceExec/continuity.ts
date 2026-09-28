/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the continuity hand-off adapter (the task-boundary integration
 * point for `flauz.continuity-bundle/v0`).
 *
 * Over `.flauz/continuity-bundles/<bundleId>/manifest.json` +
 * `.flauz/continuity-ops.jsonl`, consumed READ-ONLY. The bundle lifecycle
 * (export/restore/verify, the staging commit, the force-gated atomic
 * restore) is OWNED by the flauz-environments ContinuityManager (TL3-006);
 * this adapter validates and verifies bundles for TASK hand-offs -- it
 * never exports, never restores, never appends an ops line. The additive
 * `planSwitch.continuityBundleId?` hand-off field (flauz-environments
 * src/continuity.ts) is the precedent this module builds on; that file is
 * NOT modified.
 *
 * THE SECRET-REDACTION LAW (enforced read-only here): a continuity bundle
 * carries STATE, never secrets. Secret-shaped surfaces are exported as
 * `redacted` entries -- PRESENCE plus the sha256 of the PATH, never the
 * payload. The restore-point verification re-derives every redacted
 * path-hash and re-hashes every carried artifact; the hand-off records
 * minted by this module carry the bundle ID only -- never manifest
 * content, never payloads.
 *
 * Hand-off semantics:
 *   - Export-point (task suspend / planSwitch): validates the bundle id
 *     grammar + existence + completeness (the strict manifest parse over the
 *     closed 22-surface table) and consults the continuity ops ledger (a
 *     recorded failed verify for the bundle refuses the hand-off,
 *     fail-closed); attaches `continuityBundleId` + the active lease ids to
 *     the export record.
 *   - Restore-point: the bundle must VERIFY (manifest integrity: carried
 *     artifact hashes + redacted path hashes + the closed table) and the
 *     target environment must be trusted -- fail-closed typed refusals
 *     otherwise (bundle integrity -> CONTINUITY_INVALID; an untrusted
 *     target -> TRUST_REFUSED, the mission's own class for untrusted
 *     environments; an unknown target -> RESOURCE_ABSENT). Leases are
 *     re-bound (annotated with the bundle id); leases discharged before
 *     the switch are reported as typed skips, never silently dropped.
 *
 * DL-32: the bundle manifest key sets, the surface entry statuses, the
 * closed surface table, the ops-ledger line shape and the bundle id
 * grammar are DUPLICATED HERE AS TYPES, pinned by
 * `test/fixtures/continuity/` and `test/fixtures/task-resources/` (both
 * consumed READ-ONLY). Re-sync the duplicated table when TL3 changes the
 * contract (the same note the secret-pattern family carries).
 */
import {
	TASK_RESOURCES_SCHEMA_ID,
	TASK_RESOURCES_SCHEMA_VERSION,
	TaskResourceError,
	hasKey,
	hasOnlyKeys,
	isContinuityBundleId,
	isPlainObject,
	isPositiveEpochMs,
	isTaskId,
	joinPath,
	sha256Hex,
	validateLeaseProvenance,
	type Clock,
	type FileSystemPort,
	type HandOffExportedRecord,
	type HandOffRestoredRecord,
	type LeaseProvenance,
	type TaskHandOffExportRecord,
	type TaskHandOffRestoreRecord,
	type TaskResourceErrorPayload,
	type TaskResourceFailure,
} from './types.ts';
import { resolveEnvironmentPosture } from './environment.ts';
import type { LeaseEnv } from './contracts.ts';

/** Bundles directory, relative to the workspace root (each bundle in its own id-named dir). */
export const CONTINUITY_BUNDLES_DIR = '.flauz/continuity-bundles';

/** The continuity ops ledger path, relative to the workspace root. */
export const CONTINUITY_OPS_PATH = '.flauz/continuity-ops.jsonl';

/** The manifest file name inside a bundle directory (the bundle commit point). */
export const BUNDLE_MANIFEST_NAME = 'manifest.json';

/** Envelope schema id pinned into every bundle manifest. */
export const BUNDLE_SCHEMA_ID = 'flauz.continuity-bundle/v0';

/** Line schema id pinned into every `.flauz/continuity-ops.jsonl` record. */
export const CONTINUITY_OPS_SCHEMA_ID = 'flauz.continuity-ops/v0';

/** Manifest surface classification at export time (contract-duplicated). */
export const SURFACE_STATUSES = ['carried', 'lost', 'redacted'] as const;
export type SurfaceStatus = (typeof SURFACE_STATUSES)[number];

/** The bundleId grammar (contract-duplicated). */
export const BUNDLE_ID_PATTERN = /^flauz:continuity:[0-9a-f]{16}$/;

const SWITCH_PLAN_REF_PATTERN = /^flauz\.switchPlan\/v0:env-[a-z0-9][a-z0-9-]{0,47}@\d+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
/** Artifact paths live strictly inside the bundle: `surfaces/<seg>[/<seg>...]`, no traversal. */
const ARTIFACT_PATH_PATTERN = /^surfaces\/[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
/** The per-file tree manifest of a carried directory surface. */
const SURFACE_TREE_SCHEMA_ID = 'flauz.continuity-surface-tree/v0';

/** The surface tree manifest (contract-duplicated shape). */
export interface SurfaceTreeManifest {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly files: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
}

/** One manifest surface entry -- the contract-duplicated key set. */
export interface BundleSurfaceEntry {
	readonly status: SurfaceStatus;
	readonly artifactPath?: string;
	readonly sha256?: string;
	readonly bytes?: number;
	readonly note?: string;
}

/** The bundle manifest envelope -- the contract-duplicated key set. */
export interface ContinuityBundleManifest {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly bundleId: string;
	readonly createdAt: number;
	readonly actor: 'agent' | 'human' | 'tool';
	readonly sourceEnvironmentId?: string;
	readonly switchPlanRef?: string;
	readonly surfaces: Readonly<Record<string, BundleSurfaceEntry>>;
}

/** One continuity ops-ledger line (the contract-duplicated consumed projection). */
export interface ContinuityOpRecord {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly ts: number;
	readonly actor: 'agent' | 'human' | 'tool';
	readonly op: 'export' | 'restore' | 'verify';
	readonly bundleId: string;
	readonly result: 'ok' | 'error';
}

// ---------------------------------------------------------------------------
// The closed surface table (DL-32 duplication of the TL3-006 table: the 16
// N-8 canon surfaces + the 6 post-canon state surfaces; CLOSED and deterministic)
// ---------------------------------------------------------------------------

export interface ContinuitySurfaceSpec {
	readonly id: string;
	readonly path: string | null;
	readonly kind: 'file' | 'directory' | null;
}

export const CONTINUITY_SURFACES: readonly ContinuitySurfaceSpec[] = [
	{ id: 'flauz-tasks-envelope', path: '.flauz/tasks.json', kind: 'file' },
	{ id: 'flauz-evidence-ledger', path: '.flauz/evidence/ledger.jsonl', kind: 'file' },
	{ id: 'flauz-evidence-artifacts', path: '.flauz/artifacts', kind: 'directory' },
	{ id: 'flauz-environments-registry', path: '.flauz/environments.json', kind: 'file' },
	{ id: 'scm-working-tree', path: null, kind: null },
	{ id: 'chat-sessions', path: null, kind: null },
	{ id: 'chat-editing-checkpoints', path: null, kind: null },
	{ id: 'edit-sessions', path: null, kind: null },
	{ id: 'agent-sessions', path: null, kind: null },
	{ id: 'flauz-task-state-machine', path: null, kind: null },
	{ id: 'persisted-approvals', path: null, kind: null },
	{ id: 'terminal-scrollback', path: null, kind: null },
	{ id: 'browser-pane-state', path: null, kind: null },
	{ id: 'inflight-chat-streams', path: null, kind: null },
	{ id: 'window-layout', path: null, kind: null },
	{ id: 'resolver-connection-state', path: null, kind: null },
	{ id: 'flauz-browser-session-journal', path: '.flauz/browser-sessions.jsonl', kind: 'file' },
	{ id: 'flauz-environments-lifecycle', path: '.flauz/environments-lifecycle.json', kind: 'file' },
	{ id: 'flauz-environments-ops', path: '.flauz/environments-ops.jsonl', kind: 'file' },
	{ id: 'flauz-resources-graph', path: '.flauz/resources.json', kind: 'file' },
	{ id: 'flauz-resources-ops', path: '.flauz/resources-ops.jsonl', kind: 'file' },
	{ id: 'flauz-workflow-state', path: '.flauz/workflows', kind: 'directory' },
];

const SURFACES_BY_ID: ReadonlyMap<string, ContinuitySurfaceSpec> = new Map(CONTINUITY_SURFACES.map(spec => [spec.id, spec]));

function surfaceSpec(id: string): ContinuitySurfaceSpec | undefined {
	return SURFACES_BY_ID.get(id);
}

// ---------------------------------------------------------------------------
// Strict manifest parsing (typed CONTINUITY_INVALID)
// ---------------------------------------------------------------------------

/** The typed CONTINUITY_INVALID payload (for outcome returns). */
function invalidPayload(message: string): TaskResourceErrorPayload {
	return { code: 'CONTINUITY_INVALID', message };
}

/** The typed CONTINUITY_INVALID error (for strict-parse throws -- the sibling precedent). */
function invalidThrow(message: string): TaskResourceError {
	return new TaskResourceError('CONTINUITY_INVALID', message);
}

/** The un-prefixed typed payload of a TaskResourceError. */
function payloadOf(err: TaskResourceError): TaskResourceErrorPayload {
	return { code: err.code, message: err.message.startsWith(`${TASK_RESOURCES_SCHEMA_ID}: `) ? err.message.slice(`${TASK_RESOURCES_SCHEMA_ID}: `.length) : err.message };
}

function isBoundedString(value: unknown, max: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function parseSurfaceEntry(name: string, value: unknown): BundleSurfaceEntry {
	const where = `surfaces['${name}']`;
	if (surfaceSpec(name) === undefined) {
		throw invalidThrow(`${where}: unknown surface '${name}' (not in the closed continuity surface table)`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['status'], ['artifactPath', 'sha256', 'bytes', 'note'])) {
		throw invalidThrow(`${where} must have exactly the keys [status] + optional [artifactPath, sha256, bytes, note]`);
	}
	if (typeof value['status'] !== 'string' || !(SURFACE_STATUSES as readonly string[]).includes(value['status'])) {
		throw invalidThrow(`${where}.status must be one of carried|lost|redacted (got ${JSON.stringify(value['status'])})`);
	}
	const status = value['status'] as SurfaceStatus;
	if (value['note'] !== undefined && !isBoundedString(value['note'], 500)) {
		throw invalidThrow(`${where}.note must be a non-empty string of at most 500 chars`);
	}
	if (status === 'carried') {
		if (typeof value['artifactPath'] !== 'string' || !ARTIFACT_PATH_PATTERN.test(value['artifactPath']) || value['artifactPath'].split('/').includes('..')) {
			throw invalidThrow(`${where}.artifactPath must be a bundle-relative path 'surfaces/<name>[...]' without traversal segments (got ${JSON.stringify(value['artifactPath'])})`);
		}
		if (typeof value['sha256'] !== 'string' || !SHA256_HEX_PATTERN.test(value['sha256'])) {
			throw invalidThrow(`${where}.sha256 must be 64 lowercase hex chars (the artifact content hash)`);
		}
		if (typeof value['bytes'] !== 'number' || !Number.isSafeInteger(value['bytes']) || value['bytes'] < 0) {
			throw invalidThrow(`${where}.bytes must be a non-negative integer`);
		}
		return { status, artifactPath: value['artifactPath'], sha256: value['sha256'], bytes: value['bytes'], ...(value['note'] !== undefined ? { note: value['note'] } : {}) };
	}
	// lost / redacted: no payload artifact is ever recorded
	if (hasKey(value, 'artifactPath')) {
		throw invalidThrow(`${where}: a '${status}' surface must not carry artifactPath (only carried surfaces reference bundle artifacts)`);
	}
	if (hasKey(value, 'bytes')) {
		throw invalidThrow(`${where}: a '${status}' surface must not carry bytes`);
	}
	if (status === 'redacted') {
		if (typeof value['sha256'] !== 'string' || !SHA256_HEX_PATTERN.test(value['sha256'])) {
			throw invalidThrow(`${where}.sha256 must be 64 lowercase hex chars (the sha256 of the surface PATH -- the redaction law records presence + path hash, never the payload)`);
		}
		return { status, sha256: value['sha256'], ...(value['note'] !== undefined ? { note: value['note'] } : {}) };
	}
	if (hasKey(value, 'sha256')) {
		throw invalidThrow(`${where}: a 'lost' surface must not carry sha256 (nothing was hashed)`);
	}
	if (!isBoundedString(value['note'], 500)) {
		throw invalidThrow(`${where}.note is REQUIRED for a lost surface (why the surface was not carried -- typed, never fabricated)`);
	}
	return { status, note: value['note'] };
}

/** Validates + parses a bundle manifest document (strict, closed surface table; typed throws). */
export function parseBundleManifest(raw: string): ContinuityBundleManifest {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (err) {
		throw invalidThrow(`bundle manifest is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'bundleId', 'createdAt', 'actor', 'surfaces'], ['sourceEnvironmentId', 'switchPlanRef'])) {
		throw invalidThrow('bundle manifest must have exactly the keys [schemaVersion, schema, bundleId, createdAt, actor, surfaces] + optional [sourceEnvironmentId, switchPlanRef] (the flauz.continuity-bundle/v0 contract)');
	}
	if (value['schemaVersion'] !== 0) {
		throw invalidThrow(`bundle manifest schemaVersion must be exactly 0 (got ${JSON.stringify(value['schemaVersion'])})`);
	}
	if (value['schema'] !== BUNDLE_SCHEMA_ID) {
		throw invalidThrow(`bundle manifest schema must be exactly '${BUNDLE_SCHEMA_ID}' (got ${JSON.stringify(value['schema'])})`);
	}
	if (typeof value['bundleId'] !== 'string' || !BUNDLE_ID_PATTERN.test(value['bundleId'])) {
		throw invalidThrow(`bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(value['bundleId'])}) -- never a path, never a URL`);
	}
	if (!isPositiveEpochMs(value['createdAt'])) {
		throw invalidThrow(`createdAt must be a positive epoch-ms integer (got ${JSON.stringify(value['createdAt'])})`);
	}
	if (typeof value['actor'] !== 'string' || !['agent', 'human', 'tool'].includes(value['actor'])) {
		throw invalidThrow(`actor must be one of agent|human|tool (got ${JSON.stringify(value['actor'])}) -- provenance is mandatory`);
	}
	if (hasKey(value, 'sourceEnvironmentId') && (typeof value['sourceEnvironmentId'] !== 'string' || !/^env-[a-z0-9][a-z0-9-]{0,47}$/.test(value['sourceEnvironmentId']))) {
		throw invalidThrow(`sourceEnvironmentId must be a registry environment id 'env-<slug>' when present (got ${JSON.stringify(value['sourceEnvironmentId'])})`);
	}
	if (hasKey(value, 'switchPlanRef') && (typeof value['switchPlanRef'] !== 'string' || !SWITCH_PLAN_REF_PATTERN.test(value['switchPlanRef']))) {
		throw invalidThrow(`switchPlanRef must be a citation 'flauz.switchPlan/v0:<envId>@<epochMs>' when present (got ${JSON.stringify(value['switchPlanRef'])})`);
	}
	if (!isPlainObject(value['surfaces']) || Object.keys(value['surfaces']).length === 0) {
		throw invalidThrow('surfaces must be a non-empty object keyed by surface name (every canon surface is classified -- lost surfaces are typed entries)');
	}
	const surfaces: Record<string, BundleSurfaceEntry> = {};
	for (const [name, entry] of Object.entries(value['surfaces'])) {
		surfaces[name] = parseSurfaceEntry(name, entry);
	}
	// closed-table completeness: every surface of the table is classified
	for (const spec of CONTINUITY_SURFACES) {
		if (!hasKey(surfaces, spec.id)) {
			throw invalidThrow(`surfaces must cover the closed surface table (missing '${spec.id}' -- lost surfaces are typed entries, never silently dropped)`);
		}
	}
	return {
		schemaVersion: 0,
		schema: BUNDLE_SCHEMA_ID,
		bundleId: value['bundleId'],
		createdAt: value['createdAt'],
		actor: value['actor'] as ContinuityBundleManifest['actor'],
		surfaces,
		...(hasKey(value, 'sourceEnvironmentId') ? { sourceEnvironmentId: value['sourceEnvironmentId'] as string } : {}),
		...(hasKey(value, 'switchPlanRef') ? { switchPlanRef: value['switchPlanRef'] as string } : {}),
	};
}

/** Validates one continuity ops-ledger line (typed result; advisory consumption). */
export function parseContinuityOpsLine(line: string): { readonly ok: true; readonly record: ContinuityOpRecord } | { readonly ok: false; readonly reason: string } {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch (err) {
		return { ok: false, reason: `not valid JSON -- ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!isPlainObject(value) || !hasOnlyKeys(value, ['schemaVersion', 'schema', 'ts', 'actor', 'op', 'bundleId', 'result'], ['details', 'error'])) {
		return { ok: false, reason: 'record must have the keys [schemaVersion, schema, ts, actor, op, bundleId, result] plus at most [details, error]' };
	}
	if (value['schemaVersion'] !== 0 || value['schema'] !== CONTINUITY_OPS_SCHEMA_ID) {
		return { ok: false, reason: "record must carry schema 'flauz.continuity-ops/v0' version 0" };
	}
	if (!isPositiveEpochMs(value['ts'])) {
		return { ok: false, reason: 'ts must be a positive epoch-ms integer' };
	}
	if (typeof value['actor'] !== 'string' || !['agent', 'human', 'tool'].includes(value['actor'])) {
		return { ok: false, reason: `actor must be one of agent|human|tool (got ${JSON.stringify(value['actor'])}) -- provenance is mandatory` };
	}
	if (typeof value['op'] !== 'string' || !['export', 'restore', 'verify'].includes(value['op'])) {
		return { ok: false, reason: `op must be one of export|restore|verify (got ${JSON.stringify(value['op'])})` };
	}
	if (typeof value['bundleId'] !== 'string' || !BUNDLE_ID_PATTERN.test(value['bundleId'])) {
		return { ok: false, reason: `bundleId must be a logical id 'flauz:continuity:<16-hex>'` };
	}
	if (value['result'] !== 'ok' && value['result'] !== 'error') {
		return { ok: false, reason: `result must be 'ok' or 'error' (got ${JSON.stringify(value['result'])})` };
	}
	return { ok: true, record: { schemaVersion: 0, schema: CONTINUITY_OPS_SCHEMA_ID, ts: value['ts'], actor: value['actor'] as ContinuityOpRecord['actor'], op: value['op'] as ContinuityOpRecord['op'], bundleId: value['bundleId'], result: value['result'] } };
}

// ---------------------------------------------------------------------------
// The hand-off adapter (read-only over the bundle + the ops ledger)
// ---------------------------------------------------------------------------

export interface ContinuityHandOffAdapterOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

export type BundleValidationOutcome =
	| { readonly ok: true; readonly manifest: ContinuityBundleManifest; readonly lastVerify?: ContinuityOpRecord }
	| { readonly ok: false; readonly error: TaskResourceErrorPayload };

export interface VerifySurfaceResult {
	readonly surface: string;
	readonly verdict: 'verified' | 'lost' | 'redacted' | 'mismatch';
	readonly note: string;
}

export type BundleVerifyOutcome =
	| { readonly ok: true; readonly surfaces: readonly VerifySurfaceResult[] }
	| { readonly ok: false; readonly error: TaskResourceErrorPayload; readonly surfaces: readonly VerifySurfaceResult[] };

/** The continuity hand-off adapter: validates + verifies bundles read-only for task hand-offs. */
export class ContinuityHandOffAdapter {
	/** The workspace root the adapter reads (read-only). */
	readonly root: string;
	/** The filesystem port the adapter reads through (read-only). */
	readonly fs: FileSystemPort;

	constructor(options: ContinuityHandOffAdapterOptions) {
		this.root = options.root;
		this.fs = options.fs;
	}

	private bundleDir(bundleId: string): string {
		return joinPath(this.root, CONTINUITY_BUNDLES_DIR, bundleId);
	}

	private async readOps(): Promise<readonly ContinuityOpRecord[]> {
		const raw = await this.fs.readFileUtf8(joinPath(this.root, CONTINUITY_OPS_PATH));
		if (raw === undefined || raw.trim().length === 0) {
			return [];
		}
		const lines = raw.split('\n');
		const body = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
		const records: ContinuityOpRecord[] = [];
		for (const line of body) {
			if (line.trim().length === 0) {
				continue;
			}
			const parsed = parseContinuityOpsLine(line);
			if (parsed.ok) {
				records.push(parsed.record);
			}
			// invalid lines are advisory skips (the read discipline); the manifest is the commit point
		}
		return records;
	}

	/**
	 * Export-point validation: the bundle id grammar + existence +
	 * completeness (the strict manifest parse over the closed table) + the
	 * ops-ledger consult (a recorded failed verify refuses, fail-closed).
	 */
	async validateBundle(bundleId: string): Promise<BundleValidationOutcome> {
		if (!isContinuityBundleId(bundleId)) {
			return { ok: false, error: invalidPayload(`bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(bundleId)}) -- never a path, never a URL`) };
		}
		const raw = await this.fs.readFileUtf8(joinPath(this.bundleDir(bundleId), BUNDLE_MANIFEST_NAME));
		if (raw === undefined) {
			return { ok: false, error: invalidPayload(`no continuity bundle '${bundleId}' exists under ${CONTINUITY_BUNDLES_DIR}/ (export it with flauz.continuity.export at the source FIRST -- the bundle lifecycle belongs to the TL3 manager)`) };
		}
		let manifest: ContinuityBundleManifest;
		try {
			manifest = parseBundleManifest(raw);
		} catch (err) {
			if (err instanceof TaskResourceError) {
				return { ok: false, error: payloadOf(err) };
			}
			return { ok: false, error: invalidPayload(err instanceof Error ? err.message : String(err)) };
		}
		if (manifest.bundleId !== bundleId) {
			return { ok: false, error: invalidPayload(`bundle dir '${bundleId}' holds a manifest for '${manifest.bundleId}' (id mismatch -- incomplete or tampered bundle)`) };
		}
		const ops = await this.readOps();
		const verifies = ops.filter(record => record.bundleId === bundleId && record.op === 'verify');
		const lastVerify = verifies[verifies.length - 1];
		if (lastVerify !== undefined && lastVerify.result === 'error') {
			return { ok: false, error: invalidPayload(`the continuity ops ledger records a FAILED verify for bundle '${bundleId}' (ts ${lastVerify.ts}, actor ${lastVerify.actor}) -- the hand-off is refused until the bundle verifies`) };
		}
		return { ok: true, manifest, ...(lastVerify !== undefined ? { lastVerify } : {}) };
	}

	private parseTreeManifest(raw: string): SurfaceTreeManifest {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (err) {
			throw invalidThrow(`surface tree manifest is not valid JSON -- ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!isPlainObject(value) || value['schemaVersion'] !== 0 || value['schema'] !== SURFACE_TREE_SCHEMA_ID || !Array.isArray(value['files'])) {
			throw invalidThrow(`surface tree manifest must be {schemaVersion: 0, schema: '${SURFACE_TREE_SCHEMA_ID}', files: [...]}`);
		}
		const files: { path: string; sha256: string; bytes: number }[] = [];
		for (const [index, entry] of (value['files'] as readonly unknown[]).entries()) {
			if (!isPlainObject(entry) || typeof entry['path'] !== 'string' || entry['path'].length === 0 || entry['path'].split('/').includes('..')
				|| typeof entry['sha256'] !== 'string' || !SHA256_HEX_PATTERN.test(entry['sha256'])
				|| typeof entry['bytes'] !== 'number' || !Number.isSafeInteger(entry['bytes']) || entry['bytes'] < 0) {
				throw invalidThrow(`surface tree manifest files[${index}] must be {path, sha256, bytes} with a safe relative path`);
			}
			files.push({ path: entry['path'], sha256: entry['sha256'], bytes: entry['bytes'] });
		}
		return { schemaVersion: 0, schema: SURFACE_TREE_SCHEMA_ID, files };
	}

	/**
	 * Restore-point integrity verification (read-only; mirrors the TL3
	 * verify): every carried surface's artifact is re-hashed against the
	 * manifest, every redacted surface's PATH hash is re-derived (the
	 * secret-redaction law), every lost surface is a typed verdict. A
	 * directory surface is verified per-file through its tree manifest.
	 */
	async verifyBundle(bundleId: string): Promise<BundleVerifyOutcome> {
		const validation = await this.validateBundle(bundleId);
		if (!validation.ok) {
			return { ok: false, error: validation.error, surfaces: [] };
		}
		const manifest = validation.manifest;
		const bundleDir = this.bundleDir(manifest.bundleId);
		const surfaces: VerifySurfaceResult[] = [];
		const mismatched: string[] = [];
		for (const spec of CONTINUITY_SURFACES) {
			const entry = manifest.surfaces[spec.id]!;
			if (entry.status === 'lost') {
				surfaces.push({ surface: spec.id, verdict: 'lost', note: entry.note ?? 'not materialized at export time (typed, never fabricated)' });
				continue;
			}
			if (entry.status === 'redacted') {
				// the redaction law: presence + sha256 of the PATH (re-derivable), never the payload
				const expected = sha256Hex(spec.path ?? '');
				const okHash = entry.sha256 === expected;
				surfaces.push({
					surface: spec.id,
					verdict: okHash ? 'redacted' : 'mismatch',
					note: okHash ? 'presence + path hash verified (the payload was never copied -- the secret-redaction law)' : `path-hash mismatch: manifest ${entry.sha256}, re-derived ${expected}`,
				});
				if (!okHash) {
					mismatched.push(spec.id);
				}
				continue;
			}
			// carried
			const artifactPath = entry.artifactPath!;
			try {
				if (spec.kind === 'file') {
					const contents = await this.fs.readFileUtf8(joinPath(bundleDir, artifactPath));
					if (contents === undefined) {
						throw invalidThrow(`the bundle artifact '${artifactPath}' is missing`);
					}
					const actual = sha256Hex(contents);
					if (actual !== entry.sha256 || contents.length !== entry.bytes) {
						throw invalidThrow(`hash mismatch for surface '${spec.id}': manifest ${entry.sha256}/${entry.bytes}, artifact ${actual}/${contents.length} (tampered or truncated bundle)`);
					}
					surfaces.push({ surface: spec.id, verdict: 'verified', note: `sha256 ${entry.sha256} over ${entry.bytes} byte(s)` });
				} else {
					const treeRaw = await this.fs.readFileUtf8(joinPath(bundleDir, `${artifactPath}.manifest.json`));
					if (treeRaw === undefined) {
						throw invalidThrow(`carried directory surface '${artifactPath}' has no tree manifest in the bundle`);
					}
					const tree = this.parseTreeManifest(treeRaw);
					let totalBytes = 0;
					for (const file of tree.files) {
						const contents = await this.fs.readFileUtf8(joinPath(bundleDir, artifactPath, file.path));
						if (contents === undefined || sha256Hex(contents) !== file.sha256 || contents.length !== file.bytes) {
							throw invalidThrow(`hash mismatch at '${file.path}'`);
						}
						totalBytes += contents.length;
					}
					if (totalBytes !== entry.bytes) {
						throw invalidThrow(`byte-size mismatch for surface '${spec.id}': manifest ${entry.bytes}, tree ${totalBytes}`);
					}
					surfaces.push({ surface: spec.id, verdict: 'verified', note: `${tree.files.length} file(s), ${totalBytes} byte(s) verified` });
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				surfaces.push({ surface: spec.id, verdict: 'mismatch', note: message });
				mismatched.push(spec.id);
			}
		}
		if (mismatched.length > 0) {
			return { ok: false, error: invalidPayload(`${mismatched.length} surface(s) failed integrity verification: ${mismatched.sort().join(', ')} (tampered or truncated bundle -- the restore-point is refused)`), surfaces };
		}
		return { ok: true, surfaces };
	}
}

// ---------------------------------------------------------------------------
// The hand-off operations (the export-point and the restore-point)
// ---------------------------------------------------------------------------

function handOffFailure(error: TaskResourceErrorPayload): TaskResourceFailure {
	return { ok: false, error };
}

export interface ExportHandOffRequest {
	readonly taskId: string;
	readonly actor: LeaseProvenance;
	/** The continuity bundle the hand-off carries (validated when present). */
	readonly bundleId?: string;
}

export type ExportHandOffOutcome =
	| { readonly ok: true; readonly record: TaskHandOffExportRecord; readonly line: number }
	| TaskResourceFailure;

/**
 * The export-point (task suspend / planSwitch): validates the bundle
 * (grammar + existence + completeness + the failed-verify consult), then
 * appends the `hand-off-exported` line carrying `continuityBundleId` + the
 * ACTIVE lease ids and returns the hand-off record. The record carries the
 * bundle ID ONLY -- never manifest content, never payloads.
 */
export async function exportHandOff(env: LeaseEnv, continuity: ContinuityHandOffAdapter, request: ExportHandOffRequest): Promise<ExportHandOffOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return handOffFailure(provenance.error);
	}
	if (!isTaskId(request.taskId)) {
		return handOffFailure({ code: 'REQUEST_INVALID', message: `taskId must match the flauz-workspace task-id pattern 'T-<3+ digits>' (got ${JSON.stringify(request.taskId)})` });
	}
	if (request.bundleId !== undefined) {
		if (!isContinuityBundleId(request.bundleId)) {
			return handOffFailure({ code: 'CONTINUITY_INVALID', message: `bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(request.bundleId)}) -- never a path, never a URL` });
		}
		const validation = await continuity.validateBundle(request.bundleId);
		if (!validation.ok) {
			return handOffFailure(validation.error);
		}
	}
	const now = env.clock();
	const active = env.book.activeLeasesOf(request.taskId);
	const record: HandOffExportedRecord = {
		schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
		schema: TASK_RESOURCES_SCHEMA_ID,
		ts: now,
		actor: provenance.provenance.actor,
		event: 'hand-off-exported',
		taskId: request.taskId,
		...(request.bundleId !== undefined ? { continuityBundleId: request.bundleId } : {}),
		leaseIds: active.map(view => view.lease.leaseId),
	};
	let line = 0;
	try {
		line = await env.ledger.append(record);
		env.book.apply(record, line);
	} catch (err) {
		if (err instanceof TaskResourceError) {
			return handOffFailure(payloadOf(err));
		}
		return handOffFailure({ code: 'LEDGER_WRITE_FAILED', message: `the task-resources ledger write failed: ${err instanceof Error ? err.message : String(err)}` });
	}
	const handOff: TaskHandOffExportRecord = {
		schemaVersion: 0,
		taskId: request.taskId,
		ts: now,
		actor: provenance.provenance,
		...(request.bundleId !== undefined ? { continuityBundleId: request.bundleId } : {}),
		leaseIds: record.leaseIds,
	};
	return { ok: true, record: handOff, line };
}

export interface RestoreHandOffRequest {
	/** The export-point record carried across the switch (the hand-off artifact). */
	readonly handOff: TaskHandOffExportRecord;
	readonly actor: LeaseProvenance;
	/** The restore target (trusted environments only -- the trust gate is enforced read-only). */
	readonly targetEnvironmentId?: string;
}

export type RestoreHandOffOutcome =
	| { readonly ok: true; readonly record: TaskHandOffRestoreRecord; readonly line: number }
	| TaskResourceFailure;

/**
 * The restore-point: the bundle must VERIFY (manifest integrity) and the
 * target must be trusted -- fail-closed typed refusals otherwise. Active
 * leases from the export are re-bound (annotated with the bundle id);
 * leases discharged before the switch are typed skips, never silently
 * dropped. A lease id unknown to the ledger refuses the whole restore
 * (fail-closed -- the hand-off record must be consistent with the durable
 * truth).
 */
export async function restoreHandOff(env: LeaseEnv, continuity: ContinuityHandOffAdapter, request: RestoreHandOffRequest): Promise<RestoreHandOffOutcome> {
	const provenance = validateLeaseProvenance(request.actor);
	if (!provenance.ok) {
		return handOffFailure(provenance.error);
	}
	const handOff = request.handOff;
	if (!isPlainObject(handOff) || !isTaskId(handOff.taskId) || typeof handOff.ts !== 'number' || !Array.isArray(handOff.leaseIds) || handOff.leaseIds.some(id => typeof id !== 'string' || !/^flauz:lease:[0-9a-f]{16}$/.test(id))) {
		return handOffFailure({ code: 'REQUEST_INVALID', message: 'handOff must be a TaskHandOffExportRecord { schemaVersion: 0, taskId, ts, actor, continuityBundleId?, leaseIds }' });
	}
	if (handOff.continuityBundleId !== undefined) {
		const verification = await continuity.verifyBundle(handOff.continuityBundleId);
		if (!verification.ok) {
			return handOffFailure(verification.error);
		}
	}
	if (request.targetEnvironmentId !== undefined) {
		const posture = await resolveEnvironmentPosture(continuity.root, continuity.fs, request.targetEnvironmentId);
		if (!posture.ok) {
			return handOffFailure({ code: posture.code, message: `the restore target cannot be verified -- ${posture.message}` });
		}
		if (posture.posture === 'untrusted') {
			return handOffFailure({ code: 'TRUST_REFUSED', message: `the target environment '${request.targetEnvironmentId}' has trust posture 'untrusted' -- restore is rejected fail-closed (re-register with a trusted posture or review the descriptor; SECURITY-MODEL 3.4; the gate belongs to the TL3 manager, enforced read-only here)` });
		}
		if (!posture.enabled) {
			return handOffFailure({ code: 'TRUST_REFUSED', message: `the target environment '${request.targetEnvironmentId}' is disabled -- restore is rejected (enable the descriptor first)` });
		}
	}
	// re-binding: every lease id must be KNOWN to the ledger (fail-closed)
	for (const leaseId of handOff.leaseIds) {
		if (env.book.view(leaseId) === undefined) {
			return handOffFailure({ code: 'REQUEST_INVALID', message: `the hand-off record carries lease '${leaseId}' which is unknown to the lease book (the ledger holds no acquisition for it) -- the hand-off record is inconsistent with the durable truth` });
		}
	}
	const rebound: string[] = [];
	const skipped: string[] = [];
	for (const leaseId of handOff.leaseIds) {
		const view = env.book.view(leaseId);
		if (view !== undefined && view.state === 'active') {
			rebound.push(leaseId);
		} else {
			skipped.push(leaseId);
		}
	}
	const now = env.clock();
	const record: HandOffRestoredRecord = {
		schemaVersion: TASK_RESOURCES_SCHEMA_VERSION,
		schema: TASK_RESOURCES_SCHEMA_ID,
		ts: now,
		actor: provenance.provenance.actor,
		event: 'hand-off-restored',
		taskId: handOff.taskId,
		...(handOff.continuityBundleId !== undefined ? { continuityBundleId: handOff.continuityBundleId } : {}),
		reboundLeaseIds: rebound,
		...(request.targetEnvironmentId !== undefined ? { targetEnvironmentId: request.targetEnvironmentId } : {}),
	};
	let line = 0;
	try {
		line = await env.ledger.append(record);
		env.book.apply(record, line);
	} catch (err) {
		if (err instanceof TaskResourceError) {
			return handOffFailure(payloadOf(err));
		}
		return handOffFailure({ code: 'LEDGER_WRITE_FAILED', message: `the task-resources ledger write failed: ${err instanceof Error ? err.message : String(err)}` });
	}
	const restore: TaskHandOffRestoreRecord = {
		schemaVersion: 0,
		taskId: handOff.taskId,
		ts: now,
		actor: provenance.provenance,
		...(handOff.continuityBundleId !== undefined ? { continuityBundleId: handOff.continuityBundleId } : {}),
		reboundLeaseIds: rebound,
		skippedLeaseIds: skipped,
		...(request.targetEnvironmentId !== undefined ? { targetEnvironmentId: request.targetEnvironmentId } : {}),
	};
	return { ok: true, record: restore, line };
}
