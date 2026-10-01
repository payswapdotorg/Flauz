/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the continuity manager (export -> carry -> restore -> verify).
 *
 * Owns the surface table materialization, the bundle lifecycle, the
 * secret-redaction law and the ops ledger; pure TypeScript, vscode-free,
 * ports injected (ContinuityFsPort/Clock/mintId/registry), tested against
 * in-memory + temp-dir file systems.
 *
 * Operation protocol (typed results, never raw throws at the boundary):
 *
 *   PRE-FLIGHT (typed `ContinuityError` throws — nothing recorded, nothing
 *   mutated):
 *     - missing/invalid actor            -> ACTOR_REQUIRED / ACTOR_INVALID
 *     - malformed bundle id / args       -> BUNDLE_ID_INVALID / OP_INVALID
 *     - unknown bundle / bad manifest    -> BUNDLE_UNKNOWN / BUNDLE_CORRUPT
 *
 *   RECORDED (ledger-recorded `{ ok: false, error }` outcomes — every
 *   destructive-class attempt is auditable):
 *     - environment resolution failures  -> ENVIRONMENT_UNKNOWN
 *     - untrusted restore target         -> TRUST_POSTURE_REJECTED (fail-closed,
 *                                            the message NAMES the posture)
 *     - non-empty target without force   -> RESTORE_TARGET_NOT_EMPTY
 *     - per-surface restore failures     -> RESTORE_SURFACE_FAILED (ALL-OR-
 *                                            NOTHING: every carried surface is
 *                                            fully validated BEFORE any byte
 *                                            is written; a write-phase failure
 *                                            rolls the target back to its prior
 *                                            state — no partially-restored
 *                                            workspaces, ever)
 *     - secret in a carried payload      -> EXPORT_SECRET_DETECTED (fail-closed
 *                                            defense-in-depth; the bundle is
 *                                            never committed)
 *     - hash mismatch at verify          -> VERIFY_FAILED
 *
 * Atomicity: bundles are staged in `<bundleId>.staging/` and committed by a
 * single directory rename (the manifest is written last inside the staging
 * dir; a dir without a parseable manifest is inert — listed as incomplete by
 * `status`, never restorable). RESTORE is all-or-nothing: Phase 1 validates
 * every carried surface and resolves the complete write plan (no writes);
 * Phase 2 snapshots the prior target state; Phase 3 writes per-file
 * tmp+rename and, on ANY failure, rolls every already-written path back to
 * its prior bytes (removing files the prior state did not carry) before the
 * typed failure is recorded. Ops are STRICTLY SERIAL (the DL-77 transition
 * lock): concurrent export/restore/verify calls queue, so no two ops ever
 * interleave their ledger appends or their target writes.
 *
 * v0 boundary (documented): restore re-hydrates the CURRENT workspace root's
 * `.flauz/` state. `targetEnvironmentId` is a provenance/trust attribute of
 * the restore (the trust gate applies exactly as the lifecycle's); carrying
 * bytes to a REMOTE filesystem is the TL3-004 provider lane.
 */
import { FLAUZ_DIR, canonicalJson, joinPath, serializeEnvelope, type Clock, type FileSystemPort, type TrustPosture } from '../api.ts';
import type { EnvironmentRegistry } from '../registry.ts';
import {
	BUNDLE_MANIFEST_NAME,
	CONTINUITY_BUNDLES_DIR,
	CONTINUITY_OPS_SCHEMA_ID,
	CONTINUITY_SCHEMA_VERSION,
	ContinuityError,
	isContinuityBundleId,
	PROVENANCE_ACTORS,
	type ContinuityBundleManifest,
	type ContinuityOpAppendInput,
	type ContinuityOpDetails,
	type ContinuityOpError,
	type ContinuityOpRecord,
	type ContinuityStatusReport,
	type BundleStatusRow,
	type ExportOutcome,
	type ProvenanceActor,
	type RestoreOutcome,
	type RestoreSurfaceResult,
	type VerifyOutcome,
	type VerifySurfaceResult,
} from './types.ts';
import { ABSENT_NOTE, CONTINUITY_SURFACES, REDACTED_NOTE, looksSecretShaped, surfaceSpec, type ContinuitySurfaceSpec } from './surfaces.ts';
import { ContinuityOpsLedger, parseBundleManifest, serializeBundleManifest, sha256Hex } from './store.ts';

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/** One directory entry (kinded — the tree walk never guesses from names). */
export interface DirEntry {
	readonly name: string;
	readonly kind: 'file' | 'directory';
}

/**
 * The filesystem surface the continuity layer needs: the registry port plus
 * a kinded readdir (directory surfaces) and rm (staging cleanup). The
 * extension host wires node:fs; tests wire in-memory or temp-dir ports.
 */
export interface ContinuityFsPort extends FileSystemPort {
	/** Sorted entries; `undefined` when the directory is absent. */
	readdir(path: string): Promise<readonly DirEntry[] | undefined>;
	rm(path: string): Promise<void>;
}

export interface ContinuityManagerOptions {
	readonly root: string;
	readonly fs: ContinuityFsPort;
	readonly clock?: Clock;
	/** Bundle id minter (deterministic tests inject their own; default: WebCrypto-backed). */
	readonly mintId?: () => string;
	/** The descriptor registry (source/target environment resolution + the trust gate). */
	readonly registry?: EnvironmentRegistry;
}

// ---------------------------------------------------------------------------
// The directory-tree manifest (the per-file detail of a carried directory
// surface; stored at `surfaces/<id>.manifest.json` inside the bundle)
// ---------------------------------------------------------------------------

export const SURFACE_TREE_SCHEMA_ID = 'flauz.continuity-surface-tree/v0';

export interface SurfaceTreeFile {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}

export interface SurfaceTreeManifest {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly files: readonly SurfaceTreeFile[];
}

// ---------------------------------------------------------------------------
// Bundle id minting (WebCrypto when available; the id is a logical id, not a
// security token)
// ---------------------------------------------------------------------------

interface RandomSource {
	getRandomValues(view: Uint8Array): Uint8Array;
}

/** Mints a logical bundle id `flauz:continuity:<16-hex>`. */
export function mintBundleId(): string {
	const bytes = new Uint8Array(8);
	const source = (globalThis as { crypto?: RandomSource }).crypto;
	if (source !== undefined) {
		source.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	return 'flauz:continuity:' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export interface ExportRequest {
	readonly actor?: unknown;
	readonly environmentId?: unknown;
	readonly switchPlanRef?: unknown;
}

export interface RestoreRequest {
	readonly bundleId: unknown;
	readonly actor?: unknown;
	readonly targetEnvironmentId?: unknown;
	readonly force?: unknown;
}

export interface VerifyRequest {
	readonly bundleId: unknown;
	readonly actor?: unknown;
}

const SWITCH_PLAN_REF_PATTERN = /^flauz\.switchPlan\/v0:env-[a-z0-9][a-z0-9-]{0,47}@\d+$/;

function requireActor(op: string, actor: unknown): ProvenanceActor {
	if (actor === undefined || actor === null || actor === '') {
		throw new ContinuityError('ACTOR_REQUIRED', `op '${op}' requires a provenance actor (agent|human|tool) — every operation is provenance-carrying`);
	}
	if (typeof actor !== 'string' || !(PROVENANCE_ACTORS as readonly string[]).includes(actor)) {
		throw new ContinuityError('ACTOR_INVALID', `actor must be one of agent|human|tool (got ${JSON.stringify(actor)})`);
	}
	return actor as ProvenanceActor;
}

function recordError(message: string): ContinuityOpError {
	return { code: 'EXPORT_SURFACE_FAILED', message: message.length > 300 ? `${message.slice(0, 299)}…` : message };
}

/** Narrows a parsed `carried` entry to its required fields (the parser guarantees them for status 'carried'). */
function carriedEntryOf(surfaceId: string, entry: { status: string; artifactPath?: string; sha256?: string; bytes?: number }): { artifactPath: string; sha256: string; bytes: number } {
	if (entry.artifactPath === undefined || entry.sha256 === undefined || entry.bytes === undefined) {
		throw new ContinuityError('BUNDLE_CORRUPT', `surface '${surfaceId}' is carried but lacks its artifact fields (closed-contract violation)`);
	}
	return { artifactPath: entry.artifactPath, sha256: entry.sha256, bytes: entry.bytes };
}

// ---------------------------------------------------------------------------
// The manager
// ---------------------------------------------------------------------------

export class ContinuityManager {
	private readonly root: string;
	private readonly fs: ContinuityFsPort;
	private readonly clock: Clock;
	private readonly mintId: () => string;
	private readonly registry: EnvironmentRegistry | undefined;
	private readonly ledger: ContinuityOpsLedger;
	private readonly bundlesDir: string;
	/** The DL-77 serialized-op discipline: export/restore/verify are STRICTLY serial. */
	private opLock: Promise<unknown> = Promise.resolve();

	constructor(options: ContinuityManagerOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
		this.mintId = options.mintId ?? mintBundleId;
		this.registry = options.registry;
		this.ledger = new ContinuityOpsLedger({ root: options.root, fs: options.fs, clock: this.clock });
		this.bundlesDir = joinPath(options.root, CONTINUITY_BUNDLES_DIR);
	}

	/** Runs `operation` strictly serially against every other continuity op (DL-77). */
	private runSerial<T>(operation: () => Promise<T>): Promise<T> {
		const prior = this.opLock;
		let release: () => void = () => undefined;
		this.opLock = new Promise<void>(resolve => {
			release = resolve;
		});
		return prior.then(async () => {
			try {
				return await operation();
			} finally {
				release();
			}
		});
	}

	get opsLedgerPath(): string {
		return this.ledger.path;
	}

	// -- environment resolution (RECORDED failures — every attempt auditable) --

	private resolveEnvironment(environmentId: string, role: 'source' | 'target'): Promise<{ ok: true; posture: TrustPosture } | { ok: false; error: ContinuityOpError }> {
		if (this.registry === undefined) {
			return Promise.resolve({
				ok: false,
				error: { code: 'ENVIRONMENT_UNKNOWN', message: `the ${role} environment '${environmentId}' cannot be verified (no registry wired) — continuity ops fail closed rather than trust an unverified environment` },
			});
		}
		const descriptor = this.registry.get(environmentId);
		if (descriptor === undefined) {
			return Promise.resolve({
				ok: false,
				error: { code: 'ENVIRONMENT_UNKNOWN', message: `the ${role} environment '${environmentId}' is not registered` },
			});
		}
		return Promise.resolve({ ok: true, posture: descriptor.trust.posture });
	}

	private static isValidEnvironmentIdShape(value: string): boolean {
		return /^env-[a-z0-9][a-z0-9-]{0,47}$/.test(value);
	}

	// -- the ops ledger commit path ------------------------------------------------

	private async appendRecord(record: ContinuityOpAppendInput): Promise<ContinuityOpRecord> {
		return await this.ledger.append(record);
	}

	private baseRecord(actor: ProvenanceActor, op: ContinuityOpRecord['op'], bundleId: string, ts: number): Omit<ContinuityOpRecord, 'prev' | 'result'> {
		return {
			schemaVersion: CONTINUITY_SCHEMA_VERSION,
			schema: CONTINUITY_OPS_SCHEMA_ID,
			ts,
			actor,
			op,
			bundleId,
		};
	}

	private static manifestCounts(manifest: ContinuityBundleManifest): { carried: number; lost: number; redacted: number; details: ContinuityOpDetails } {
		let carried = 0;
		let lost = 0;
		let redacted = 0;
		for (const entry of Object.values(manifest.surfaces)) {
			if (entry.status === 'carried') {
				carried++;
			} else if (entry.status === 'redacted') {
				redacted++;
			} else {
				lost++;
			}
		}
		return {
			carried,
			lost,
			redacted,
			details: {
				surfacesCarried: carried,
				surfacesLost: lost,
				surfacesRedacted: redacted,
				...(manifest.sourceEnvironmentId !== undefined ? { fromEnvironmentId: manifest.sourceEnvironmentId } : {}),
			},
		};
	}

	// -- export ---------------------------------------------------------------------

	/**
	 * Materializes a continuity bundle from the workspace's ACTUAL `.flauz/`
	 * state (the closed surface table): carried surfaces are copied into the
	 * bundle with sha256 recorded; secret-shaped surfaces are `redacted`
	 * (presence + path hash, never the payload); non-materialized surfaces
	 * are typed `lost` entries. Fails closed (`EXPORT_SECRET_DETECTED`) if a
	 * carried payload unexpectedly contains secret-shaped text.
	 */
	async export(request: ExportRequest): Promise<ExportOutcome> {
		const actor = requireActor('export', request.actor);
		let environmentId: string | undefined;
		if (request.environmentId !== undefined) {
			if (typeof request.environmentId !== 'string' || !ContinuityManager.isValidEnvironmentIdShape(request.environmentId)) {
				throw new ContinuityError('ENVIRONMENT_ID_INVALID', `environmentId must be a registry environment id 'env-<slug>' (got ${JSON.stringify(request.environmentId)})`);
			}
			environmentId = request.environmentId;
		}
		if (request.switchPlanRef !== undefined && (typeof request.switchPlanRef !== 'string' || !SWITCH_PLAN_REF_PATTERN.test(request.switchPlanRef))) {
			throw new ContinuityError('OP_INVALID', `switchPlanRef must be a citation 'flauz.switchPlan/v0:<envId>@<epochMs>' (got ${JSON.stringify(request.switchPlanRef)})`);
		}
		const bundleId = this.mintId();
		if (!isContinuityBundleId(bundleId)) {
			throw new ContinuityError('BUNDLE_ID_INVALID', `the id factory minted a malformed bundle id (${JSON.stringify(bundleId)}) — expected 'flauz:continuity:<16-hex>'`);
		}
		// ops are STRICTLY SERIAL (DL-77): no two exports/restores/verifies
		// ever interleave their ledger appends or their workspace reads/writes.
		return await this.runSerial(async () => {
			const ts = this.clock();

			// environment resolution is a RECORDED failure (auditable)
			if (environmentId !== undefined) {
				const resolved = await this.resolveEnvironment(environmentId, 'source');
				if (!resolved.ok) {
					const record = await this.appendRecord({ ...this.baseRecord(actor, 'export', bundleId, ts), result: 'error', error: resolved.error });
					return { ok: false, record, error: resolved.error };
				}
			}

			const stagingDir = joinPath(this.bundlesDir, `${bundleId}.staging`);
			const finalDir = joinPath(this.bundlesDir, bundleId);
			const fail = async (error: ContinuityOpError): Promise<ExportOutcome> => {
				await this.rmBestEffort(stagingDir);
				const record = await this.appendRecord({ ...this.baseRecord(actor, 'export', bundleId, ts), result: 'error', error });
				return { ok: false, record, error };
			};

			try {
				await this.fs.mkdir(joinPath(stagingDir, 'surfaces'));
				const surfaces: Record<string, ContinuityBundleManifest['surfaces'][string]> = {};
				for (const spec of CONTINUITY_SURFACES) {
					surfaces[spec.id] = await this.exportSurface(spec, stagingDir);
				}
				const manifest: ContinuityBundleManifest = {
					schemaVersion: CONTINUITY_SCHEMA_VERSION,
					schema: 'flauz.continuity-bundle/v0',
					bundleId,
					createdAt: ts,
					actor,
					...(environmentId !== undefined ? { sourceEnvironmentId: environmentId } : {}),
					surfaces,
					...(request.switchPlanRef !== undefined ? { switchPlanRef: request.switchPlanRef as string } : {}),
				};
				// strict round-trip: a manifest that would not re-parse never reaches the disk
				parseBundleManifest(serializeBundleManifest(manifest));
				// commit point: manifest last, then the single directory rename
				await this.fs.writeFile(joinPath(stagingDir, BUNDLE_MANIFEST_NAME), serializeBundleManifest(manifest));
				try {
					await this.fs.rename(stagingDir, finalDir);
				} catch (err) {
					return await fail({
						code: 'BUNDLE_EXISTS',
						message: `bundle '${bundleId}' already exists or the commit rename failed: ${err instanceof Error ? err.message : String(err)}`,
					});
				}
				const counts = ContinuityManager.manifestCounts(manifest);
				const record = await this.appendRecord({
					...this.baseRecord(actor, 'export', bundleId, ts),
					result: 'ok',
					details: counts.details,
				});
				return { ok: true, record, manifest };
			} catch (err) {
				if (err instanceof ContinuityError) {
					return await fail({ code: err.code, message: err.message.length > 300 ? `${err.message.slice(0, 299)}…` : err.message });
				}
				return await fail(recordError(`export of '${bundleId}' failed: ${err instanceof Error ? err.message : String(err)}`));
			}
		});
	}

	/** Exports ONE surface of the closed table (never throws raw — typed ContinuityError). */
	private async exportSurface(spec: ContinuitySurfaceSpec, stagingDir: string): Promise<ContinuityBundleManifest['surfaces'][string]> {
		if (spec.path === null || spec.kind === null || spec.artifactName === null) {
			return { status: 'lost', note: spec.lostNote };
		}
		const workspacePath = joinPath(this.root, spec.path);
		if (spec.kind === 'file') {
			const contents = await this.fs.readFileUtf8(workspacePath);
			if (contents === undefined) {
				return { status: 'lost', note: ABSENT_NOTE };
			}
			if (spec.secretClass === 'captured') {
				return { status: 'redacted', sha256: sha256Hex(spec.path), note: REDACTED_NOTE };
			}
			this.scanForSecrets(spec.id, contents);
			const artifactPath = spec.artifactName;
			await this.fs.writeFile(joinPath(stagingDir, artifactPath), contents);
			return { status: 'carried', artifactPath, sha256: sha256Hex(contents), bytes: contents.length, note: `carried from ${spec.path}` };
		}
		// directory surface
		const entries = await this.fs.readdir(workspacePath);
		if (entries === undefined) {
			return { status: 'lost', note: ABSENT_NOTE };
		}
		if (spec.secretClass === 'captured') {
			return { status: 'redacted', sha256: sha256Hex(spec.path), note: REDACTED_NOTE };
		}
		const files = await this.walkTree(workspacePath, '');
		for (const file of files) {
			this.scanForSecrets(`${spec.id}/${file.path}`, file.contents);
			await this.fs.mkdir(joinPath(stagingDir, spec.artifactName, ...file.path.split('/').slice(0, -1)));
			await this.fs.writeFile(joinPath(stagingDir, spec.artifactName, file.path), file.contents);
		}
		const tree: SurfaceTreeManifest = {
			schemaVersion: CONTINUITY_SCHEMA_VERSION,
			schema: SURFACE_TREE_SCHEMA_ID,
			files: files.map(file => ({ path: file.path, sha256: sha256Hex(file.contents), bytes: file.contents.length })),
		};
		await this.fs.writeFile(joinPath(stagingDir, `${spec.artifactName}.manifest.json`), serializeEnvelope(tree));
		return {
			status: 'carried',
			artifactPath: spec.artifactName,
			sha256: sha256Hex(canonicalJson(tree)),
			bytes: files.reduce((total, file) => total + file.contents.length, 0),
			note: `carried from ${spec.path} (${files.length} file(s); per-file hashes in ${spec.artifactName}.manifest.json)`,
		};
	}

	/** Defense-in-depth: a carried payload containing secret-shaped text fails the export closed. */
	private scanForSecrets(where: string, contents: string): void {
		if (looksSecretShaped(contents)) {
			throw new ContinuityError(
				'EXPORT_SECRET_DETECTED',
				`the carried payload of surface '${where}' contains secret-shaped text — the vault-only policy rejects literal credentials (this is a source-envelope contract violation; fix the source state, never carry the secret)`,
			);
		}
	}

	private async walkTree(dir: string, prefix: string): Promise<readonly { path: string; contents: string }[]> {
		const entries = await this.fs.readdir(dir);
		if (entries === undefined) {
			return [];
		}
		const files: { path: string; contents: string }[] = [];
		for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			const childPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
			if (entry.kind === 'directory') {
				files.push(...(await this.walkTree(joinPath(dir, entry.name), childPath)));
			} else {
				const contents = await this.fs.readFileUtf8(joinPath(dir, entry.name));
				if (contents === undefined) {
					throw new ContinuityError('EXPORT_SURFACE_FAILED', `file '${childPath}' vanished during the directory walk`);
				}
				files.push({ path: childPath, contents });
			}
		}
		return files;
	}

	private async rmBestEffort(path: string): Promise<void> {
		try {
			await this.fs.rm(path);
		} catch {
			// best-effort: a manifest-less staging dir is inert (never restorable)
		}
	}

	// -- bundle loading (pre-flight: unknown/corrupt bundles throw) ------------------

	private async loadBundle(bundleId: string): Promise<{ manifest: ContinuityBundleManifest; bundleDir: string }> {
		if (typeof bundleId !== 'string' || !isContinuityBundleId(bundleId)) {
			throw new ContinuityError('BUNDLE_ID_INVALID', `bundleId must be a logical id 'flauz:continuity:<16-hex>' (got ${JSON.stringify(bundleId)})`);
		}
		const manifestPath = joinPath(this.bundlesDir, bundleId, BUNDLE_MANIFEST_NAME);
		const raw = await this.fs.readFileUtf8(manifestPath);
		if (raw === undefined) {
			throw new ContinuityError('BUNDLE_UNKNOWN', `no continuity bundle '${bundleId}' exists under ${CONTINUITY_BUNDLES_DIR}/`);
		}
		const manifest = parseBundleManifest(raw);
		if (manifest.bundleId !== bundleId) {
			throw new ContinuityError('BUNDLE_CORRUPT', `bundle dir '${bundleId}' holds a manifest for '${manifest.bundleId}' (id mismatch)`);
		}
		return { manifest, bundleDir: joinPath(this.bundlesDir, bundleId) };
	}

	private async loadTreeManifest(bundleDir: string, artifactPath: string): Promise<SurfaceTreeManifest> {
		const raw = await this.fs.readFileUtf8(joinPath(bundleDir, `${artifactPath}.manifest.json`));
		if (raw === undefined) {
			throw new ContinuityError('BUNDLE_CORRUPT', `carried directory surface '${artifactPath}' has no tree manifest in the bundle`);
		}
		return ContinuityManager.parseTreeManifest(raw);
	}

	private static parseTreeManifest(raw: string): SurfaceTreeManifest {
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (err) {
			throw new ContinuityError('BUNDLE_CORRUPT', `surface tree manifest is not valid JSON -- ${(err as Error).message}`);
		}
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			throw new ContinuityError('BUNDLE_CORRUPT', 'surface tree manifest must be an object');
		}
		const record = value as Record<string, unknown>;
		if (record.schemaVersion !== CONTINUITY_SCHEMA_VERSION || record.schema !== SURFACE_TREE_SCHEMA_ID || !Array.isArray(record.files)) {
			throw new ContinuityError('BUNDLE_CORRUPT', `surface tree manifest must be {schemaVersion: 0, schema: '${SURFACE_TREE_SCHEMA_ID}', files: [...]}`);
		}
		const files: SurfaceTreeFile[] = [];
		for (const [index, entry] of (record.files as readonly unknown[]).entries()) {
			if (typeof entry !== 'object' || entry === null) {
				throw new ContinuityError('BUNDLE_CORRUPT', `surface tree manifest files[${index}] must be an object`);
			}
			const file = entry as Record<string, unknown>;
			if (typeof file.path !== 'string' || file.path.length === 0 || file.path.split('/').includes('..')
				|| typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256)
				|| typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
				throw new ContinuityError('BUNDLE_CORRUPT', `surface tree manifest files[${index}] must be {path, sha256, bytes} with a safe relative path`);
			}
			files.push({ path: file.path, sha256: file.sha256, bytes: file.bytes });
		}
		return { schemaVersion: CONTINUITY_SCHEMA_VERSION, schema: SURFACE_TREE_SCHEMA_ID, files };
	}

	// -- restore ---------------------------------------------------------------------

	/**
	 * DESTRUCTIVE-CLASS: re-hydrates state files from a bundle, ALL-OR-
	 * NOTHING. Phase 1 validates every carried surface and resolves the
	 * complete write plan (artifact presence + content hashes + byte sizes)
	 * BEFORE a single byte is written; Phase 2 snapshots the prior target
	 * state of every planned path; Phase 3 writes per-file tmp+rename and,
	 * on ANY failure, rolls every already-written path back to its prior
	 * bytes (removing files the prior state did not carry). A failed
	 * restore therefore leaves NO partially-restored state. Requires
	 * `force` to overwrite non-empty existing state; fails closed on
	 * untrusted target environments; every surface outcome is typed.
	 * Ops are serialized (DL-77): concurrent restores queue.
	 */
	async restore(request: RestoreRequest): Promise<RestoreOutcome> {
		const actor = requireActor('restore', request.actor);
		if (request.force !== undefined && typeof request.force !== 'boolean') {
			throw new ContinuityError('OP_INVALID', `force must be a boolean (got ${JSON.stringify(request.force)})`);
		}
		const force = request.force === true;
		let targetEnvironmentId: string | undefined;
		if (request.targetEnvironmentId !== undefined) {
			if (typeof request.targetEnvironmentId !== 'string' || !ContinuityManager.isValidEnvironmentIdShape(request.targetEnvironmentId)) {
				throw new ContinuityError('ENVIRONMENT_ID_INVALID', `targetEnvironmentId must be a registry environment id 'env-<slug>' (got ${JSON.stringify(request.targetEnvironmentId)})`);
			}
			targetEnvironmentId = request.targetEnvironmentId;
		}
		return await this.runSerial(async () => {
			const { manifest, bundleDir } = await this.loadBundle(request.bundleId as string);
			const bundleId = manifest.bundleId;
			const ts = this.clock();
			const counts = ContinuityManager.manifestCounts(manifest);
			const details: ContinuityOpDetails = {
				...counts.details,
				...(targetEnvironmentId !== undefined ? { toEnvironmentId: targetEnvironmentId } : {}),
			};
			const fail = async (error: ContinuityOpError, surfaces: readonly RestoreSurfaceResult[]): Promise<RestoreOutcome> => {
				const record = await this.appendRecord({ ...this.baseRecord(actor, 'restore', bundleId, ts), result: 'error', details, error });
				return { ok: false, record, error, surfaces };
			};

			// trust gate: fail-closed for untrusted target environments
			if (targetEnvironmentId !== undefined) {
				const resolved = await this.resolveEnvironment(targetEnvironmentId, 'target');
				if (!resolved.ok) {
					return await fail(resolved.error, []);
				}
				if (resolved.posture === 'untrusted') {
					return await fail({
						code: 'TRUST_POSTURE_REJECTED',
						message: `the target environment '${targetEnvironmentId}' has trust posture 'untrusted' — restore is rejected fail-closed (re-register with a trusted posture or review the descriptor; SECURITY-MODEL 3.4)`,
					}, []);
				}
			}

			// pre-flight: overwriting non-empty existing state requires force
			if (!force) {
				const occupied: string[] = [];
				for (const spec of CONTINUITY_SURFACES) {
					const entry = manifest.surfaces[spec.id];
					if (entry === undefined || entry.status !== 'carried' || spec.path === null) {
						continue;
					}
					const workspacePath = joinPath(this.root, spec.path);
					if (await this.pathIsNonEmpty(workspacePath, spec.kind)) {
						occupied.push(spec.id);
					}
				}
				if (occupied.length > 0) {
					return await fail({
						code: 'RESTORE_TARGET_NOT_EMPTY',
						message: `the target already holds non-empty state for ${occupied.length} carried surface(s): ${occupied.sort().join(', ')} — pass force: true to overwrite (restore is destructive-class; the requirement is explicit)`,
					}, []);
				}
			}

			// Phase 1: validate EVERY carried surface + resolve the full write plan (no writes yet).
			const writePlan: Array<{ targetPath: string; contents: string }> = [];
			const validationFailures: Array<{ surface: string; reason: string }> = [];
			const carriedIds: string[] = [];
			for (const spec of CONTINUITY_SURFACES) {
				const entry = manifest.surfaces[spec.id];
				if (entry === undefined) {
					validationFailures.push({ surface: spec.id, reason: 'surface missing from the manifest (closed-table violation)' });
					continue;
				}
				if (entry.status === 'lost' || entry.status === 'redacted') {
					continue;
				}
				carriedIds.push(spec.id);
				try {
					writePlan.push(...(await this.planSurfaceWrites(spec, carriedEntryOf(spec.id, entry), bundleDir)));
				} catch (err) {
					validationFailures.push({ surface: spec.id, reason: err instanceof ContinuityError ? `${err.code}: ${err.message}` : (err instanceof Error ? err.message : String(err)) });
				}
			}
			if (validationFailures.length > 0) {
				const surfaces = this.restoreOutcomes(manifest, carriedIds, carriedId => {
					const failed = validationFailures.find(failure => failure.surface === carriedId);
					return failed !== undefined
						? `restore failed, nothing written — ${failed.reason}`
						: 'not attempted — restore is all-or-nothing and another surface failed pre-write validation';
				});
				return await fail({
					code: 'RESTORE_SURFACE_FAILED',
					message: `${validationFailures.length} surface(s) failed pre-write validation (all-or-nothing: NOTHING was written): ${validationFailures.map(failure => failure.surface).sort().join(', ')}`,
				}, surfaces);
			}

			// Phase 2: snapshot the prior state of every planned target path (rollback material).
			const prior = new Map<string, string | undefined>();
			for (const write of writePlan) {
				prior.set(write.targetPath, await this.fs.readFileUtf8(write.targetPath));
			}

			// Phase 3: write everything (tmp+rename per file); roll back on ANY failure.
			const written: string[] = [];
			const createdDirs: string[] = [];
			try {
				for (const write of writePlan) {
					await this.writeTracked(write.targetPath, write.contents, createdDirs);
					written.push(write.targetPath);
				}
			} catch (err) {
				const reason = err instanceof ContinuityError ? `${err.code}: ${err.message}` : (err instanceof Error ? err.message : String(err));
				let rollbackNote = `rolled back to the prior target state (${written.length} file(s) reverted)`;
				try {
					await this.rollbackWrites(written, prior, createdDirs);
				} catch (rollErr) {
					rollbackNote = `ROLLBACK INCOMPLETE (${rollErr instanceof Error ? rollErr.message : String(rollErr)}) — inspect the target state before retrying`;
				}
				const surfaces = this.restoreOutcomes(manifest, carriedIds, () => `restore failed mid-write and was ${rollbackNote} — ${reason}`);
				return await fail({
					code: 'RESTORE_SURFACE_FAILED',
					message: `the write phase failed after ${written.length} file(s) (${reason}); all-or-nothing: ${rollbackNote}`,
				}, surfaces);
			}

			const surfaces = this.restoreOutcomes(manifest, carriedIds, () => undefined);
			const record = await this.appendRecord({ ...this.baseRecord(actor, 'restore', bundleId, ts), result: 'ok', details });
			return { ok: true, record, surfaces };
		});
	}

	/** Builds the per-surface restore results (lost/redacted typed; carried annotated by `noteFor`). */
	private restoreOutcomes(manifest: ContinuityBundleManifest, carriedIds: readonly string[], noteFor: (carriedId: string) => string | undefined): RestoreSurfaceResult[] {
		const surfaces: RestoreSurfaceResult[] = [];
		for (const spec of CONTINUITY_SURFACES) {
			const entry = manifest.surfaces[spec.id];
			if (entry === undefined) {
				surfaces.push({ surface: spec.id, outcome: 'skipped', note: 'surface missing from the manifest (closed-table violation)' });
				continue;
			}
			if (entry.status === 'lost') {
				surfaces.push({ surface: spec.id, outcome: 'lost', note: entry.note });
				continue;
			}
			if (entry.status === 'redacted') {
				surfaces.push({ surface: spec.id, outcome: 'redacted', note: 'the payload was never copied into the bundle (the secret-redaction law) — re-acquire via the SCM surface or the source environment' });
				continue;
			}
			const note = noteFor(spec.id);
			if (note !== undefined) {
				surfaces.push({ surface: spec.id, outcome: 'skipped', note });
				continue;
			}
			surfaces.push({ surface: spec.id, outcome: 'carried', note: `restored to ${spec.path}` });
		}
		return surfaces;
	}

	/**
	 * Phase 1 of the all-or-nothing restore: verifies a carried surface's
	 * artifacts COMPLETELY (presence + content hashes + byte sizes, every
	 * file of a directory tree) and returns the resolved writes WITHOUT
	 * touching the workspace.
	 */
	private async planSurfaceWrites(spec: ContinuitySurfaceSpec, entry: { artifactPath: string; sha256: string; bytes: number }, bundleDir: string): Promise<readonly { targetPath: string; contents: string }[]> {
		if (spec.path === null || spec.kind === null || spec.artifactName === null) {
			throw new ContinuityError('BUNDLE_CORRUPT', `surface '${spec.id}' is carried by the bundle but has no workspace materialization (closed-table violation)`);
		}
		const workspacePath = joinPath(this.root, spec.path);
		if (spec.kind === 'file') {
			const contents = await this.fs.readFileUtf8(joinPath(bundleDir, entry.artifactPath));
			if (contents === undefined) {
				throw new ContinuityError('BUNDLE_CORRUPT', `the bundle artifact '${entry.artifactPath}' is missing`);
			}
			const actual = sha256Hex(contents);
			if (actual !== entry.sha256) {
				throw new ContinuityError('BUNDLE_CORRUPT', `hash mismatch for surface '${spec.id}': manifest ${entry.sha256}, artifact ${actual} (tampered or truncated bundle — restore refused)`);
			}
			if (contents.length !== entry.bytes) {
				throw new ContinuityError('BUNDLE_CORRUPT', `byte-size mismatch for surface '${spec.id}': manifest ${entry.bytes}, artifact ${contents.length}`);
			}
			return [{ targetPath: workspacePath, contents }];
		}
		// directory surface: verify EVERY file of the tree before any write
		const tree = await this.loadTreeManifest(bundleDir, entry.artifactPath);
		const totalBytes = tree.files.reduce((total, file) => total + file.bytes, 0);
		if (totalBytes !== entry.bytes) {
			throw new ContinuityError('BUNDLE_CORRUPT', `byte-size mismatch for surface '${spec.id}': manifest ${entry.bytes}, tree ${totalBytes}`);
		}
		const writes: Array<{ targetPath: string; contents: string }> = [];
		for (const file of tree.files) {
			const contents = await this.fs.readFileUtf8(joinPath(bundleDir, entry.artifactPath, file.path));
			if (contents === undefined) {
				throw new ContinuityError('BUNDLE_CORRUPT', `the bundle artifact '${entry.artifactPath}/${file.path}' is missing`);
			}
			if (sha256Hex(contents) !== file.sha256 || contents.length !== file.bytes) {
				throw new ContinuityError('BUNDLE_CORRUPT', `hash mismatch for surface '${spec.id}/${file.path}' (tampered or truncated bundle — restore refused)`);
			}
			writes.push({ targetPath: joinPath(workspacePath, file.path), contents });
		}
		return writes;
	}

	private async writeAtomic(path: string, contents: string): Promise<void> {
		const parent = path.includes('/') ? joinPath(path.slice(0, path.lastIndexOf('/'))) : path;
		await this.fs.mkdir(parent);
		const tmp = `${path}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, path);
	}

	/** The ancestor directory chain of `path` (shallow -> deep), for rollback tracking. */
	private static ancestorsOf(path: string): string[] {
		const parts = path.split('/');
		const result: string[] = [];
		for (let i = 2; i <= parts.length - 1; i++) {
			result.push(parts.slice(0, i).join('/'));
		}
		return result;
	}

	/** Atomic write that records every directory it had to CREATE (rollback material). */
	private async writeTracked(path: string, contents: string, createdDirs: string[]): Promise<void> {
		for (const dir of ContinuityManager.ancestorsOf(path)) {
			if ((await this.fs.readdir(dir)) === undefined) {
				createdDirs.push(dir);
			}
		}
		await this.writeAtomic(path, contents);
	}

	/**
	 * Rolls a failed write phase back to the prior target state: files that
	 * existed before get their prior bytes back (atomically); files the
	 * prior state did not carry are removed; directories the write phase
	 * created are removed deepest-first.
	 */
	private async rollbackWrites(written: readonly string[], prior: ReadonlyMap<string, string | undefined>, createdDirs: readonly string[]): Promise<void> {
		for (const path of [...written].reverse()) {
			const contents = prior.get(path);
			if (contents === undefined) {
				await this.fs.rm(path);
			} else {
				await this.writeAtomic(path, contents);
			}
		}
		const byDepth = [...createdDirs].sort((a, b) => {
			const depthA = a.split('/').length;
			const depthB = b.split('/').length;
			return depthA !== depthB ? (depthA > depthB ? -1 : 1) : (a > b ? -1 : a < b ? 1 : 0);
		});
		for (const dir of byDepth) {
			await this.fs.rm(dir);
		}
	}

	private async pathIsNonEmpty(path: string, kind: 'file' | 'directory' | null): Promise<boolean> {
		if (kind === 'file') {
			const contents = await this.fs.readFileUtf8(path);
			return contents !== undefined && contents.length > 0;
		}
		const entries = await this.fs.readdir(path);
		return entries !== undefined && entries.length > 0;
	}

	// -- verify ----------------------------------------------------------------------

	/**
	 * Integrity check: manifest hashes re-verified against the bundle
	 * artifacts (content hashes for carried surfaces; the re-derivable path
	 * hash for redacted surfaces), with typed per-surface verdicts.
	 */
	async verify(request: VerifyRequest): Promise<VerifyOutcome> {
		const actor = requireActor('verify', request.actor);
		return await this.runSerial(async () => {
			const { manifest, bundleDir } = await this.loadBundle(request.bundleId as string);
			const bundleId = manifest.bundleId;
			const ts = this.clock();
			const counts = ContinuityManager.manifestCounts(manifest);
			const surfaces: VerifySurfaceResult[] = [];
			const mismatched: string[] = [];
			for (const spec of CONTINUITY_SURFACES) {
				const entry = manifest.surfaces[spec.id];
				if (entry === undefined) {
					surfaces.push({ surface: spec.id, verdict: 'mismatch', note: 'surface missing from the manifest (closed-table violation)' });
					mismatched.push(spec.id);
					continue;
				}
				if (entry.status === 'lost') {
					surfaces.push({ surface: spec.id, verdict: 'lost', note: entry.note });
					continue;
				}
				if (entry.status === 'redacted') {
					// the path hash is re-derivable from the closed table — verify it
					const expected = sha256Hex(spec.path ?? '');
					const okHash = entry.sha256 === expected;
					surfaces.push({
						surface: spec.id,
						verdict: okHash ? 'redacted' : 'mismatch',
						note: okHash ? 'presence + path hash verified (the payload was never copied)' : `path-hash mismatch: manifest ${entry.sha256}, re-derived ${expected}`,
					});
					if (!okHash) {
						mismatched.push(spec.id);
					}
					continue;
				}
				try {
					if (spec.kind === 'file') {
						const carried = carriedEntryOf(spec.id, entry);
						const contents = await this.fs.readFileUtf8(joinPath(bundleDir, carried.artifactPath));
						if (contents === undefined) {
							throw new ContinuityError('BUNDLE_CORRUPT', 'artifact missing');
						}
						const actual = sha256Hex(contents);
						if (actual !== carried.sha256 || contents.length !== carried.bytes) {
							throw new ContinuityError('BUNDLE_CORRUPT', `hash mismatch (manifest ${carried.sha256}/${carried.bytes}, artifact ${actual}/${contents.length})`);
						}
						surfaces.push({ surface: spec.id, verdict: 'verified', note: `sha256 ${carried.sha256} over ${carried.bytes} byte(s)` });
					} else {
						const carried = carriedEntryOf(spec.id, entry);
						const tree = await this.loadTreeManifest(bundleDir, carried.artifactPath);
						let totalBytes = 0;
						for (const file of tree.files) {
							const contents = await this.fs.readFileUtf8(joinPath(bundleDir, carried.artifactPath, file.path));
							if (contents === undefined || sha256Hex(contents) !== file.sha256 || contents.length !== file.bytes) {
								throw new ContinuityError('BUNDLE_CORRUPT', `hash mismatch at '${file.path}'`);
							}
							totalBytes += contents.length;
						}
						if (totalBytes !== carried.bytes) {
							throw new ContinuityError('BUNDLE_CORRUPT', `byte-size mismatch (manifest ${carried.bytes}, tree ${totalBytes})`);
						}
						surfaces.push({ surface: spec.id, verdict: 'verified', note: `${tree.files.length} file(s), ${totalBytes} byte(s) verified` });
					}
				} catch (err) {
					const reason = err instanceof Error ? err.message : String(err);
					surfaces.push({ surface: spec.id, verdict: 'mismatch', note: reason });
					mismatched.push(spec.id);
				}
			}
			if (mismatched.length > 0) {
				const error: ContinuityOpError = {
					code: 'VERIFY_FAILED',
					message: `${mismatched.length} surface(s) failed integrity verification: ${mismatched.sort().join(', ')}`,
				};
				const record = await this.appendRecord({ ...this.baseRecord(actor, 'verify', bundleId, ts), result: 'error', details: counts.details, error });
				return { ok: false, record, error, surfaces };
			}
			const record = await this.appendRecord({ ...this.baseRecord(actor, 'verify', bundleId, ts), result: 'ok', details: counts.details });
			return { ok: true, record, surfaces };
		});
	}

	// -- status (read-only; never appends a ledger line) ----------------------------

	/**
	 * Lists the bundles under `.flauz/continuity-bundles/` (complete =
	 * strict-parseable manifest; staging leftovers / manifest-less dirs are
	 * listed as incomplete, never restorable) plus the full ops ledger.
	 */
	async status(): Promise<ContinuityStatusReport> {
		const entries = await this.fs.readdir(this.bundlesDir);
		const bundles: BundleStatusRow[] = [];
		if (entries !== undefined) {
			for (const entry of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
				if (entry.kind !== 'directory') {
					continue;
				}
				if (entry.name.endsWith('.staging')) {
					bundles.push({ dir: entry.name, complete: false, note: 'staging leftover (an interrupted export; inert, never restorable)' });
					continue;
				}
				const raw = await this.fs.readFileUtf8(joinPath(this.bundlesDir, entry.name, BUNDLE_MANIFEST_NAME));
				if (raw === undefined) {
					bundles.push({ dir: entry.name, complete: false, note: 'no manifest.json (incomplete bundle; inert, never restorable)' });
					continue;
				}
				try {
					const manifest = parseBundleManifest(raw);
					if (manifest.bundleId !== entry.name) {
						bundles.push({ dir: entry.name, complete: false, note: `manifest id '${manifest.bundleId}' does not match the dir name (id mismatch)` });
						continue;
					}
					bundles.push({ dir: entry.name, complete: true, manifest });
				} catch (err) {
					bundles.push({ dir: entry.name, complete: false, note: `manifest rejected: ${err instanceof Error ? err.message : String(err)}` });
				}
			}
		}
		const ops = await this.ledger.readAll();
		return { bundles, ops };
	}
}
