/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 -- the task-boundary resource/execution integration barrel.
 *
 * Purely additive: this module + its sub-modules live entirely under
 * `extensions/flauz-agent/src/resourceExec/` and consume the TL3 contracts
 * READ-ONLY (DL-32: types duplicated + pinned by repo-root fixtures;
 * never imported across extension boundaries). The future TL2-A
 * orchestrator imports the vocabulary from here; the orchestrator composes
 * the adapters with the store and dispatches the actual TL3 commands
 * through the op-port surface (the orchestrator is the one that calls
 * `flauz.env.start` / `flauz.browser.navigate` / etc. -- the lease only
 * references the port, never re-implements it).
 *
 * Layer separation (state it once in the barrel): a task lease is the
 * TASK-GRAPH-LEVEL obligation binding a task to a logical resource id;
 * the ACTUAL lifecycle effects remain OWNED by the TL3 managers
 * (flauz-browser sessionManager, flauz-environments lifecycle/manager,
 * flauz-resources graph). This module never calls CDP, never spawns a
 * process, never writes TL3-owned state.
 *
 * Re-exports are EXPLICIT (not `export *`) so the consumers of this barrel
 * get a single, unambiguous name per symbol even though several adapter
 * modules duplicate the DL-32 sibling primitives (canonicalJson, etc.).
 * The canonical source for every duplicated primitive is `./types.ts`.
 */
export * from './types.ts';
export * from './contracts.ts';

// browserSession.ts: the PIN-1 read-only adapter
export {
        BROWSER_SESSION_JOURNAL_PATH,
        JOURNAL_SCHEMA_ID,
        JOURNAL_SCHEMA_VERSION,
        JOURNAL_ACTORS,
        JOURNAL_EVENTS,
        JOURNAL_SESSION_STATES,
        JOURNAL_TAB_STATES,
        parseJournalLine,
        readSessionJournal,
        latestBySession,
        browserSurfaceOf,
        BrowserSessionAdapter,
        type JournalActor,
        type JournalEvent,
        type JournalSessionState,
        type JournalTabState,
        type JournalTabRecord,
        type JournalSessionDescriptor,
        type JournalRecord,
        type JournalSkip,
        type JournalReadResult,
        type BrowserSessionAdapterOptions,
        type BrowserAcquireResult,
        type BrowserReleaseResult,
} from './browserSession.ts';

// environment.ts: the PIN-2 read-only adapter
export {
        LIFECYCLE_SCHEMA_ID,
        OPS_SCHEMA_ID as ENVIRONMENTS_OPS_SCHEMA_ID,
        LIFECYCLE_SCHEMA_VERSION,
        LIFECYCLE_PATH,
        ENVIRONMENTS_OPS_PATH,
        ENVIRONMENTS_REGISTRY_PATH,
        ENVIRONMENTS_REGISTRY_SCHEMA_ID,
        TRUST_POSTURES,
        ATTACHED_STATES,
        ENVIRONMENT_KINDS,
        isRunningState,
        isAttachedState,
        isLifecycleState,
        parseLifecycleEntry,
        parseLifecycleEnvelope,
        parseOpRecord as parseEnvironmentOpRecord, // alias to avoid clash with continuity's
        parseEnvironmentsEnvelope,
        EnvironmentAdapter,
        type TrustPosture,
        type ProvenanceActor as EnvironmentProvenanceActor,
        type EnvironmentOpName,
        type LifecyclePhase,
        type EnvironmentKind,
        type EnvironmentTrust,
        type EnvironmentCapabilities,
        type EnvironmentDescriptor,
        type EnvironmentsEnvelope,
        type EnvironmentOpRecord,
        type LifecycleEntry,
        type LifecycleEnvelope,
        type EnvironmentAdapterOptions,
        type EnvironmentAcquireResult,
        type EnvironmentReleaseResult,
} from './environment.ts';

// resourceRef.ts: the ResourceRef graph read-only adapter
export {
        RESOURCES_SCHEMA_ID,
        RESOURCES_OPS_SCHEMA_ID,
        GRAPH_PATH,
        RESOURCES_OPS_PATH,
        RESOURCE_KINDS,
        KIND_NAMESPACES,
        SECRET_KINDS,
        EDGE_KINDS,
        ACTORS as RESOURCE_ACTORS,
        isResourceKind,
        parseResourceUrn,
        parseResourceRef,
        parseResourcesEnvelope,
        edgeFor,
        ResourceRefAdapter,
        type ResourceKind,
        type Actor as ResourceActor,
        type ResourceProvenance,
        type ResourceRef,
        type BrowserSurface as ResourceBrowserSurface,
        type EnvironmentSurface as ResourceEnvironmentSurface,
        type FileSystemSurface as ResourceFileSystemSurface,
        type Surface,
        type SurfaceVersion,
        type SurfaceRecord,
        type GraphEdge,
        type ResourcesEnvelope,
        type ResourceRefAdapterOptions,
        type ResourceRefAcquireResult,
        type ResourceRefReleaseResult,
} from './resourceRef.ts';

// continuity.ts: the continuity hand-off metadata adapter
export {
        BUNDLE_SCHEMA_ID,
        CONTINUITY_OPS_SCHEMA_ID,
        CONTINUITY_SCHEMA_VERSION,
        CONTINUITY_BUNDLES_DIR,
        CONTINUITY_OPS_PATH,
        BUNDLE_MANIFEST_NAME,
        PROVENANCE_ACTORS as CONTINUITY_PROVENANCE_ACTORS,
        CONTINUITY_OPS,
        SURFACE_STATUSES,
        VERIFY_SURFACE_VERDICTS,
        sha256Hex,
        parseBundleManifest,
        parseContinuityOpRecord,
        parseOpsLedger as parseContinuityOpsLedger,
        ContinuityAdapter,
        type ProvenanceActor as ContinuityProvenanceActor,
        type ContinuityOpName,
        type SurfaceStatus,
        type VerifySurfaceVerdict,
        type BundleSurfaceEntry,
        type ContinuityBundleManifest,
        type ContinuityOpRecord,
        type ContinuityAdapterOptions,
        type ExportPointResult,
        type RestorePointResult,
} from './continuity.ts';

// store.ts: the append-only ledger + crash recovery
export {
        TASK_RESOURCES_LEDGER_PATH,
        LEDGER_RECORD_KINDS,
        parseLedgerRecord,
        parseLedger,
        serializeLedgerRecord,
        deriveIndex,
        latestLease,
        activeLeasesFor,
        hasConflict,
        TaskResourceStore,
        type LedgerRecordKind,
        type TaskResourceLedgerRecord,
        type LeaseIndex,
        type TaskResourceStoreOptions,
} from './store.ts';
