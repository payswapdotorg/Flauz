/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — continuity EXECUTION core types.
 *
 * `src/continuity.ts` is the N-8 MODEL (surface canon + switch plans); this
 * module turns it into an EXECUTABLE capability: export -> carry -> restore ->
 * verify, with provenance and typed outcomes.
 *
 * Persistence (NEW sibling envelopes — the registry `flauz.environments/v0`
 * and the PIN-2 lifecycle envelopes are NEVER mutated by this layer):
 *   - `.flauz/continuity-bundles/<bundleId>/manifest.json` — envelope
 *     `flauz.continuity-bundle/v0` (this module's `ContinuityBundleManifest`).
 *   - `.flauz/continuity-ops.jsonl` — append-only, one canonical JSON line
 *     per op: envelope `flauz.continuity-ops/v0`
 *     (`ContinuityOpRecord`).
 *
 * THE SECRET-REDACTION LAW (documented here because the manifest is the
 * contract surface): a continuity bundle carries STATE, never secrets.
 * A surface whose content model admits secret-shaped material (captured
 * network/console evidence, arbitrary artifact bytes, journal tab URLs) is
 * exported as a typed `redacted` entry — its PRESENCE is recorded together
 * with the sha256 of its PATH, and the payload is NEVER copied into the
 * bundle. Structurally-validated envelopes that reject secret literals at
 * the schema level (the vault-only policy surfaces) are `carried`; as
 * defense-in-depth the export deep-scans every carried payload and fails
 * closed (`EXPORT_SECRET_DETECTED`) if a secret-shaped literal is ever found
 * in one — a carried surface silently containing a secret is a contract
 * violation of its source envelope, never a carryable state.
 *
 * Discipline (DL-9/DL-32): canonical serialization (sorted keys, 2-space
 * indent, one trailing newline) for the manifest; canonical single-line JSON
 * per ops record; atomic tmp+rename persistence; append-only ledger (the
 * existing content is fully re-validated and preserved byte-for-byte before
 * extension).
 *
 * vscode-free, zero deps, Node stdlib only at the wiring boundary. Ports are
 * injected (FileSystemPort/Clock from src/api.ts; the richer
 * `ContinuityFsPort` in manager.ts).
 */
import { PROVENANCE_ACTORS, type ProvenanceActor } from '../lifecycle/types.ts';

/** Envelope schema id pinned into every bundle manifest. */
export const BUNDLE_SCHEMA_ID = 'flauz.continuity-bundle/v0';

/** Line schema id pinned into every `.flauz/continuity-ops.jsonl` record. */
export const CONTINUITY_OPS_SCHEMA_ID = 'flauz.continuity-ops/v0';

/** Both new envelopes carry schemaVersion 0. */
export const CONTINUITY_SCHEMA_VERSION = 0;

/** Bundles directory, relative to the workspace root (each bundle in its own id-named dir). */
export const CONTINUITY_BUNDLES_DIR = '.flauz/continuity-bundles';

/** The continuity ops ledger path, relative to the workspace root. */
export const CONTINUITY_OPS_PATH = '.flauz/continuity-ops.jsonl';

/** The manifest file name inside a bundle directory (the bundle commit point). */
export const BUNDLE_MANIFEST_NAME = 'manifest.json';

/** The bundleId grammar: a LOGICAL id (`flauz:continuity:<16-hex>`), never a path, never a URL. */
export const BUNDLE_ID_PATTERN = /^flauz:continuity:[0-9a-f]{16}$/;

/** `true` when `value` is a well-formed continuity bundle id. */
export function isContinuityBundleId(value: unknown): value is string {
	return typeof value === 'string' && BUNDLE_ID_PATTERN.test(value);
}

export type { ProvenanceActor };
export { PROVENANCE_ACTORS };

// ---------------------------------------------------------------------------
// The ops (ledger-recorded mutating ops; `status` is a read-only probe and
// never appends a line)
// ---------------------------------------------------------------------------

export const CONTINUITY_OPS = ['export', 'restore', 'verify'] as const;
export type ContinuityOpName = (typeof CONTINUITY_OPS)[number];

// ---------------------------------------------------------------------------
// Surface statuses + restore outcomes
// ---------------------------------------------------------------------------

/** Manifest surface classification at export time. */
export const SURFACE_STATUSES = ['carried', 'lost', 'redacted'] as const;
export type SurfaceStatus = (typeof SURFACE_STATUSES)[number];

/** Per-surface outcome of a restore (a surface recorded `lost`/`redacted` in the bundle restores nothing). */
export const RESTORE_SURFACE_OUTCOMES = ['carried', 'lost', 'redacted', 'skipped'] as const;
export type RestoreSurfaceOutcome = (typeof RESTORE_SURFACE_OUTCOMES)[number];

/** Per-surface verdict of a verify (integrity check). */
export const VERIFY_SURFACE_VERDICTS = ['verified', 'lost', 'redacted', 'mismatch'] as const;
export type VerifySurfaceVerdict = (typeof VERIFY_SURFACE_VERDICTS)[number];

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Machine-checkable continuity error codes. Pre-flight failures (bad args,
 * unknown/corrupt bundles) throw; accepted attempts return typed
 * `{ ok: false, error }` outcomes that are ledger-recorded (every
 * destructive-class attempt is auditable).
 */
export const CONTINUITY_ERROR_CODES = [
	'ACTOR_REQUIRED',
	'ACTOR_INVALID',
	'OP_INVALID',
	'BUNDLE_ID_INVALID',
	'BUNDLE_UNKNOWN',
	'BUNDLE_CORRUPT',
	'ENVIRONMENT_ID_INVALID',
	'ENVIRONMENT_UNKNOWN',
	'TRUST_POSTURE_REJECTED',
	'EXPORT_SECRET_DETECTED',
	'EXPORT_SURFACE_FAILED',
	'RESTORE_TARGET_NOT_EMPTY',
	'RESTORE_SURFACE_FAILED',
	'VERIFY_FAILED',
	'OPS_CORRUPT',
] as const;
export type ContinuityErrorCode = (typeof CONTINUITY_ERROR_CODES)[number];

/** Typed continuity error (fail-closed surfaces carry a stable code). */
export class ContinuityError extends Error {
	readonly code: ContinuityErrorCode;
	constructor(code: ContinuityErrorCode, message: string) {
		super(`flauz.continuity/v0: ${message}`);
		this.name = 'ContinuityError';
		this.code = code;
	}
}

// ---------------------------------------------------------------------------
// The record shapes (persisted exactly; canonical JSON on the wire)
// ---------------------------------------------------------------------------

/** Typed error payload carried by error records (ops lines + outcomes). */
export interface ContinuityOpError {
	readonly code: string;
	readonly message: string;
}

/**
 * One manifest surface entry — the exact key set of
 * `flauz.continuity-bundle/v0` surface records:
 *   - `carried`   : {status, artifactPath, sha256, bytes, note?} — the payload
 *                   was copied into the bundle; sha256 is the CONTENT hash.
 *   - `lost`      : {status, note} — no file materialized the canon surface
 *                   (absent on disk, or natively rehydrated / lost per N-8);
 *                   never fabricated.
 *   - `redacted`  : {status, sha256, note} — secret-shaped surface: presence
 *                   + sha256 of the PATH (NOT the payload); the payload is
 *                   never copied (the secret-redaction law).
 */
export interface BundleSurfaceEntry {
	readonly status: SurfaceStatus;
	readonly artifactPath?: string;
	readonly sha256?: string;
	readonly bytes?: number;
	readonly note?: string;
}

/**
 * The `.flauz/continuity-bundles/<bundleId>/manifest.json` envelope —
 * `flauz.continuity-bundle/v0` (the exact key set).
 */
export interface ContinuityBundleManifest {
	readonly schemaVersion: number;
	readonly schema: string;
	/** Logical id: exactly `flauz:continuity:<16-hex>`. */
	readonly bundleId: string;
	readonly createdAt: number;
	readonly actor: ProvenanceActor;
	/** The source environment the bundle was exported from, when known. */
	readonly sourceEnvironmentId?: string;
	/** Every canon surface, classified (lost surfaces are typed, never dropped). */
	readonly surfaces: Readonly<Record<string, BundleSurfaceEntry>>;
	/**
	 * Optional citation of the switch plan this bundle was exported for
	 * (`flauz.switchPlan/v0:<toEnvironmentId>@<epochMs>` — a citation:
	 * switch plans are documents returned to callers, not persisted files).
	 */
	readonly switchPlanRef?: string;
}

/** One ops-ledger line's detail block — the exact key set. */
export interface ContinuityOpDetails {
	readonly fromEnvironmentId?: string;
	readonly toEnvironmentId?: string;
	readonly surfacesCarried: number;
	readonly surfacesLost: number;
	readonly surfacesRedacted: number;
}

/**
 * One ops-ledger line: `flauz.continuity-ops/v0` (the exact key set).
 * `prev` is the per-row hash chain (DL-77 tamper detection): the sha256 of
 * the PREVIOUS record's canonical line, null on the genesis record.
 */
export interface ContinuityOpRecord {
	readonly schemaVersion: number;
	readonly schema: string;
	readonly ts: number;
	readonly actor: ProvenanceActor;
	readonly op: ContinuityOpName;
	readonly bundleId: string;
	readonly result: 'ok' | 'error';
	readonly prev: string | null;
	readonly details?: ContinuityOpDetails;
	readonly error?: ContinuityOpError;
}

/** Input to `ContinuityOpsLedger.append` (`prev` is minted by the ledger). */
export type ContinuityOpAppendInput = Omit<ContinuityOpRecord, 'prev'>;

// ---------------------------------------------------------------------------
// Command-level typed outcomes (ephemeral, never persisted whole in the
// ledger lines; commands return them to callers)
// ---------------------------------------------------------------------------

/** Per-surface restore result (the command surface). */
export interface RestoreSurfaceResult {
	readonly surface: string;
	readonly outcome: RestoreSurfaceOutcome;
	readonly note?: string;
}

/** Per-surface verify verdict (the command surface). */
export interface VerifySurfaceResult {
	readonly surface: string;
	readonly verdict: VerifySurfaceVerdict;
	readonly note?: string;
}

export type ExportOutcome =
	| { readonly ok: true; readonly record: ContinuityOpRecord; readonly manifest: ContinuityBundleManifest }
	| { readonly ok: false; readonly record: ContinuityOpRecord; readonly error: ContinuityOpError };

export type RestoreOutcome =
	| { readonly ok: true; readonly record: ContinuityOpRecord; readonly surfaces: readonly RestoreSurfaceResult[] }
	| { readonly ok: false; readonly record: ContinuityOpRecord; readonly error: ContinuityOpError; readonly surfaces: readonly RestoreSurfaceResult[] };

export type VerifyOutcome =
	| { readonly ok: true; readonly record: ContinuityOpRecord; readonly surfaces: readonly VerifySurfaceResult[] }
	| { readonly ok: false; readonly record: ContinuityOpRecord; readonly error: ContinuityOpError; readonly surfaces: readonly VerifySurfaceResult[] };

/** One bundle summary of the read-only status probe. */
export interface BundleStatusRow {
	/** The bundle dir name (a logical bundle id for complete bundles). */
	readonly dir: string;
	/** Present + strict-parseable manifest. */
	readonly complete: boolean;
	readonly manifest?: ContinuityBundleManifest;
	readonly note?: string;
}

export interface ContinuityStatusReport {
	readonly bundles: readonly BundleStatusRow[];
	readonly ops: readonly ContinuityOpRecord[];
}
