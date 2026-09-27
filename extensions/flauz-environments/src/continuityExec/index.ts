/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-006 — the continuity EXECUTION module (single import site).
 *
 *   - types    : the two NEW sibling envelopes (flauz.continuity-bundle/v0 +
 *               flauz.continuity-ops/v0), typed errors, outcome envelopes
 *   - surfaces : the closed surface table (the N-8 16-surface canon
 *               materialized from actual .flauz/ state + the post-canon
 *               state surfaces) + the secret-shape classification
 *   - store    : strict parsing, canonical serialization, sha256, the
 *               append-only ops ledger
 *   - manager  : ContinuityManager — export / restore / verify / status
 */
export {
	BUNDLE_ID_PATTERN,
	BUNDLE_MANIFEST_NAME,
	BUNDLE_SCHEMA_ID,
	CONTINUITY_BUNDLES_DIR,
	CONTINUITY_ERROR_CODES,
	CONTINUITY_OPS,
	CONTINUITY_OPS_PATH,
	CONTINUITY_OPS_SCHEMA_ID,
	CONTINUITY_SCHEMA_VERSION,
	ContinuityError,
	PROVENANCE_ACTORS,
	RESTORE_SURFACE_OUTCOMES,
	SURFACE_STATUSES,
	VERIFY_SURFACE_VERDICTS,
	isContinuityBundleId,
	type BundleStatusRow,
	type BundleSurfaceEntry,
	type ContinuityBundleManifest,
	type ContinuityErrorCode,
	type ContinuityOpDetails,
	type ContinuityOpError,
	type ContinuityOpName,
	type ContinuityOpRecord,
	type ContinuityStatusReport,
	type ExportOutcome,
	type ProvenanceActor,
	type RestoreOutcome,
	type RestoreSurfaceOutcome,
	type RestoreSurfaceResult,
	type SurfaceStatus,
	type VerifyOutcome,
	type VerifySurfaceResult,
	type VerifySurfaceVerdict,
} from './types.ts';
export {
	ABSENT_NOTE,
	CONTINUITY_SURFACES,
	REDACTED_NOTE,
	looksSecretShaped,
	surfaceIds,
	surfaceSpec,
	type ContinuitySurfaceSpec,
	type SurfaceMaterialization,
	type SurfaceSecretClass,
} from './surfaces.ts';
export {
	ContinuityOpsLedger,
	bundleManifestPath,
	parseBundleManifest,
	parseContinuityOpLine,
	parseContinuityOpRecord,
	serializeBundleManifest,
	serializeContinuityOpRecord,
	sha256Hex,
} from './store.ts';
export {
	ContinuityManager,
	SURFACE_TREE_SCHEMA_ID,
	mintBundleId,
	type ContinuityFsPort,
	type ContinuityManagerOptions,
	type DirEntry,
	type ExportRequest,
	type RestoreRequest,
	type SurfaceTreeFile,
	type SurfaceTreeManifest,
	type VerifyRequest,
} from './manager.ts';
