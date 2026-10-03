/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The isolation law (A-PROD-005-W3): the surface-classification table every
 * boundary audit derives from + the boundary-scan shapes.
 *
 * THE DERIVATION LAW: the law NEVER hardcodes the extension set -- the
 * audit enumerates the REAL product registry (the `extensions/flauz-*`
 * manifest set read through the product-root port) and classifies each
 * registry extension's durable surfaces through THIS table. A registry
 * extension the table does not know = typed UNKNOWN (fail-closed
 * disclosure, never a guessed verdict). A `.flauz/` top-level entry no law
 * surface claims = typed UNKNOWN surface (the registry grew a surface
 * class the law does not know). Both disclosures are the drift protection:
 * the law table grows ONLY through a reviewed wave, and the contract suite
 * pins every path below byte-equal against the REAL owning constants.
 *
 * THE THREE CLASSIFICATIONS (the order's law, verbatim semantics):
 *   workspace-bound      -- the DEFAULT: the record's lifetime is the
 *                           workspace's, it never leaves the tree;
 *   workspace-exportable -- the operator-initiated export surfaces (the
 *                           W2 backup export, the release self-export,
 *                           the diagnostics bundle -- the typed allowlist):
 *                           the record may leave the tree ONLY through the
 *                           operator's explicit export act;
 *   port-owned           -- the integrity key store: sealed to the port's
 *                           own path law (never banked, never rendered,
 *                           never swept into a record; the KeyPort owns it).
 *
 * Contract-duplication law (DL-32): every path + record shape below is
 * duplicated from the owning extensions' constants (the flauz-diagnostics
 * census enumeration + each owning extension's api/contracts); pinned
 * byte-equal by test/contract.test.ts against the REAL owning modules.
 */

import {
	FLAUZ_DIR,
	EXPORTS_DIR,
} from './api.ts';

// ---------------------------------------------------------------------------
// The classifications
// ---------------------------------------------------------------------------

/** The isolation law's three classifications (the order's law, verbatim). */
export type SurfaceClassification = 'workspace-bound' | 'workspace-exportable' | 'port-owned';

/** The lawful boundary a surface lives under. */
export type SurfaceBoundary = '.flauz' | '.flauz-exports' | 'port-owned';

// ---------------------------------------------------------------------------
// The durable-surface paths (contract-duplicated from the owning constants;
// pinned byte-equal by test/contract.test.ts)
// ---------------------------------------------------------------------------

// --- flauz-workspace (the W1 census surfaces: tasks + evidence) ---
const TASKS_PATH = '.flauz/tasks.json';
const EVIDENCE_LEDGER_PATH = '.flauz/evidence/ledger.jsonl';
const EVIDENCE_WATERMARK_PATH = '.flauz/evidence/size.json';

// --- flauz-resources ---
const RESOURCES_GRAPH_PATH = '.flauz/resources.json';
const RESOURCES_OPS_PATH = '.flauz/resources-ops.jsonl';

// --- flauz-environments ---
const ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments.json';

// --- flauz-browser ---
const BROWSER_SESSIONS_PATH = '.flauz/browser-sessions.jsonl';
const BROWSER_POLICY_PATH = '.flauz/browser-policy.json';

// --- flauz-workflow ---
const WORKFLOWS_DIR = '.flauz/workflows';
const WORKFLOW_EXEC_DIR = '.flauz/workflow-exec';
const WORKFLOW_RUNS_DIR = '.flauz/workflow-runs';
const A2A_CONTRACTS_DIR = '.flauz/a2a/contracts';

// --- flauz-agent (the in-process orch mediator's store-side surface) ---
const ORCH_GRAPHS_PATH = '.flauz/orchestration/graphs.json';
const ORCH_JOURNAL_PATH = '.flauz/orchestration/journal.jsonl';

// --- flauz-models (the .flauz/models family) ---
const MODELS_DIR = '.flauz/models';
const PROVIDERS_PATH = '.flauz/models/providers.json';
const ROUTING_POLICY_PATH = '.flauz/models/routing-policy.json';
const ROUTING_DECISIONS_PATH = '.flauz/models/routing-decisions.jsonl';
const PROVIDER_SWITCHES_PATH = '.flauz/models/provider-switches.jsonl';

// --- flauz-execution ---
const EXEC_JOURNAL_PATH = '.flauz/execution/journal.jsonl';

// --- flauz-memory (the tiers + the watermarks envelope) ---
const MEMORY_DIR = '.flauz/memory';
const MEMORY_TASKS_DIR = '.flauz/memory/tasks';
const MEMORY_SESSION_JOURNAL_PATH = '.flauz/memory/session.jsonl';
const MEMORY_PROJECT_JOURNAL_PATH = '.flauz/memory/project.jsonl';
const MEMORY_PROMOTIONS_PATH = '.flauz/memory/promotions.jsonl';
const MEMORY_SHARES_PATH = '.flauz/memory/shares.jsonl';
const MEMORY_INDEX_PATH = '.flauz/memory/index.json';
const MEMORY_WATERMARKS_PATH = '.flauz/watermarks.json';

// --- flauz-telemetry (the W4 local-only plane) ---
const TELEMETRY_CONFIG_PATH = '.flauz/telemetry/config.json';
const TELEMETRY_LEDGER_PATH = '.flauz/telemetry/ledger.jsonl';

// --- flauz-migration ---
const MIGRATION_PLAN_PATH = '.flauz/migration/plan.json';
const MIGRATION_MARKER_PATH = '.flauz/migration/in-progress.json';
const MIGRATION_LOG_PATH = '.flauz/migration/migration-log.jsonl';
const MIGRATION_ROLLBACK_LOG_PATH = '.flauz/migration/rollback-log.jsonl';

// --- flauz-backup (the W2 export plane) ---
const BACKUP_RECOVERY_LOG_PATH = '.flauz/backup/recovery-log.jsonl';
const BACKUP_EXPORT_DIR_PREFIX = 'export-';

// --- flauz-diagnostics (the support bundles) ---
const DIAGNOSTICS_BUNDLE_DIR_PREFIX = 'support-bundle-';

// --- flauz-release (the W5 verification plane) ---
const RELEASE_DIR = '.flauz/release';
const RELEASE_VERIFY_PREFIX = 'verify-';
const RELEASE_CHECKLIST_PREFIX = 'checklist-';

// --- flauz-production (the W1 verification plane) ---
const PRODUCTION_DIR = '.flauz/production';
const PRODUCTION_CENSUS_PREFIX = 'census-';
const PRODUCTION_MATRIX_PREFIX = 'matrix-';
const PRODUCTION_GATE_PREFIX = 'gate-';

// --- flauz-integrity (the W2 signing plane + the port-owned key store) ---
const INTEGRITY_DIR = '.flauz/integrity';
const INTEGRITY_LEDGER_PREFIX = 'ledger-';
const INTEGRITY_VERIFY_PREFIX = 'verify-';
const INTEGRITY_KEY_STORE_PATH = '.flauz/integrity/keys/ed25519-local-dev.json';

// --- flauz-isolation (this wave) ---
const ISOLATION_DIR = '.flauz/isolation';
const ISOLATION_AUDIT_PREFIX = 'audit-';
const ISOLATION_ENFORCE_PREFIX = 'enforce-';

// ---------------------------------------------------------------------------
// The law table
// ---------------------------------------------------------------------------

/** One durable surface the law knows: its id, its owning extension, its files/dirs, its classification. */
export interface LawSurface {
	/** The surface id (the census id where one exists: identical to the flauz-diagnostics DurableStateCensus key). */
	readonly id: string;
	/** The owning extension's directory name (the registry identity). */
	readonly owner: string;
	readonly classification: SurfaceClassification;
	/** The surface's fixed files, workspace-relative (absent files are listed absent, never faked). */
	readonly files: readonly string[];
	/** The surface's fixed directories, workspace-relative (the surface is present when any path resolves). */
	readonly dirs: readonly string[];
	/**
	 * Stamp-suffixed RECORD filename prefixes this surface's records use
	 * (`<prefix><stamp>.json` under one of the surface's dirs): the boundary
	 * scan's stray-record shapes grow from THIS table, never a second list.
	 */
	readonly recordPrefixes: readonly string[];
	/**
	 * Stamp-suffixed DIRECTORY shapes this surface owns (`<prefix><stamp>/`
	 * directly under one of the surface's dirs): the boundary scan's
	 * stray-directory shapes (the export + bundle laws).
	 */
	readonly dirPrefixes: readonly string[];
}

/** The complete law table, in census order first (the W1 keys), then the later waves' surfaces. */
export const LAW_SURFACES: readonly LawSurface[] = [
	// --- the W1 census surfaces (ids identical to the flauz-diagnostics DurableStateCensus keys) ---
	{ id: 'tasks', owner: 'flauz-workspace', classification: 'workspace-bound', files: [TASKS_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'evidenceLedger', owner: 'flauz-workspace', classification: 'workspace-bound', files: [EVIDENCE_LEDGER_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'evidenceWatermark', owner: 'flauz-workspace', classification: 'workspace-bound', files: [EVIDENCE_WATERMARK_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'resourcesGraph', owner: 'flauz-resources', classification: 'workspace-bound', files: [RESOURCES_GRAPH_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'opsChain', owner: 'flauz-resources', classification: 'workspace-bound', files: [RESOURCES_OPS_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'environmentsRegistry', owner: 'flauz-environments', classification: 'workspace-bound', files: [ENVIRONMENTS_REGISTRY_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'browserSessions', owner: 'flauz-browser', classification: 'workspace-bound', files: [BROWSER_SESSIONS_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'browserPolicy', owner: 'flauz-browser', classification: 'workspace-bound', files: [BROWSER_POLICY_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'workflows', owner: 'flauz-workflow', classification: 'workspace-bound', files: [`${WORKFLOWS_DIR}/index.json`], dirs: [WORKFLOWS_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'workflowExec', owner: 'flauz-workflow', classification: 'workspace-bound', files: [], dirs: [WORKFLOW_EXEC_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'workflowRuns', owner: 'flauz-workflow', classification: 'workspace-bound', files: [], dirs: [WORKFLOW_RUNS_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'a2aContracts', owner: 'flauz-workflow', classification: 'workspace-bound', files: [], dirs: [A2A_CONTRACTS_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'orchestration', owner: 'flauz-agent', classification: 'workspace-bound', files: [ORCH_GRAPHS_PATH, ORCH_JOURNAL_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'providerLanesState', owner: 'flauz-models', classification: 'workspace-bound', files: [PROVIDERS_PATH, ROUTING_POLICY_PATH, ROUTING_DECISIONS_PATH, PROVIDER_SWITCHES_PATH], dirs: [MODELS_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'executionJournal', owner: 'flauz-execution', classification: 'workspace-bound', files: [EXEC_JOURNAL_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'memoryTiers', owner: 'flauz-memory', classification: 'workspace-bound', files: [MEMORY_SESSION_JOURNAL_PATH, MEMORY_PROJECT_JOURNAL_PATH, MEMORY_PROMOTIONS_PATH, MEMORY_SHARES_PATH, MEMORY_INDEX_PATH], dirs: [MEMORY_DIR, MEMORY_TASKS_DIR], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'memoryWatermarks', owner: 'flauz-memory', classification: 'workspace-bound', files: [MEMORY_WATERMARKS_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'telemetryState', owner: 'flauz-telemetry', classification: 'workspace-bound', files: [TELEMETRY_CONFIG_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'telemetryLedger', owner: 'flauz-telemetry', classification: 'workspace-bound', files: [TELEMETRY_LEDGER_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'migrationState', owner: 'flauz-migration', classification: 'workspace-bound', files: [MIGRATION_PLAN_PATH, MIGRATION_MARKER_PATH, MIGRATION_LOG_PATH, MIGRATION_ROLLBACK_LOG_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	{ id: 'backupRecoveryLog', owner: 'flauz-backup', classification: 'workspace-bound', files: [BACKUP_RECOVERY_LOG_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	// --- the operator-initiated export surfaces (the typed allowlist) ---
	{ id: 'backupExports', owner: 'flauz-backup', classification: 'workspace-exportable', files: [], dirs: [EXPORTS_DIR], recordPrefixes: [], dirPrefixes: [BACKUP_EXPORT_DIR_PREFIX] },
	{ id: 'supportBundles', owner: 'flauz-diagnostics', classification: 'workspace-exportable', files: [], dirs: [FLAUZ_DIR], recordPrefixes: [], dirPrefixes: [DIAGNOSTICS_BUNDLE_DIR_PREFIX] },
	{ id: 'releaseRecords', owner: 'flauz-release', classification: 'workspace-bound', files: [], dirs: [RELEASE_DIR], recordPrefixes: [RELEASE_VERIFY_PREFIX, RELEASE_CHECKLIST_PREFIX], dirPrefixes: [] },
	{ id: 'releaseSelfExports', owner: 'flauz-release', classification: 'workspace-exportable', files: [], dirs: [EXPORTS_DIR], recordPrefixes: [], dirPrefixes: [BACKUP_EXPORT_DIR_PREFIX] },
	{ id: 'productionRecords', owner: 'flauz-production', classification: 'workspace-bound', files: [], dirs: [PRODUCTION_DIR], recordPrefixes: [PRODUCTION_CENSUS_PREFIX, PRODUCTION_MATRIX_PREFIX, PRODUCTION_GATE_PREFIX], dirPrefixes: [] },
	{ id: 'integrityRecords', owner: 'flauz-integrity', classification: 'workspace-bound', files: [], dirs: [INTEGRITY_DIR], recordPrefixes: [INTEGRITY_LEDGER_PREFIX, INTEGRITY_VERIFY_PREFIX], dirPrefixes: [] },
	// --- the port-owned surface (sealed to the KeyPort's own path law) ---
	{ id: 'integrityKeyStore', owner: 'flauz-integrity', classification: 'port-owned', files: [INTEGRITY_KEY_STORE_PATH], dirs: [], recordPrefixes: [], dirPrefixes: [] },
	// --- this wave's own durable home ---
	{ id: 'isolationRecords', owner: 'flauz-isolation', classification: 'workspace-bound', files: [], dirs: [ISOLATION_DIR], recordPrefixes: [ISOLATION_AUDIT_PREFIX, ISOLATION_ENFORCE_PREFIX], dirPrefixes: [] },
];

/**
 * The extensions the law knows (every extension with at least one law
 * surface, PLUS flauz-lab -- the law knows it carries ZERO durable surfaces
 * at this base: W1 saves are in-session only; a later wave that gives the
 * lab durable state must grow this table through a reviewed contract-pin
 * update, or the audit discloses the new surface as UNKNOWN).
 */
export const KNOWN_EXTENSIONS: readonly string[] = [
	'flauz-agent',
	'flauz-backup',
	'flauz-browser',
	'flauz-diagnostics',
	'flauz-environments',
	'flauz-execution',
	'flauz-integrity',
	'flauz-isolation',
	'flauz-lab',
	'flauz-memory',
	'flauz-migration',
	'flauz-models',
	'flauz-production',
	'flauz-release',
	'flauz-resources',
	'flauz-telemetry',
	'flauz-workflow',
	'flauz-workspace',
];

/** The law surfaces of one extension (owner-scoped; empty for the zero-surface extensions). */
export function lawSurfacesOf(owner: string): readonly LawSurface[] {
	return LAW_SURFACES.filter(surface => surface.owner === owner);
}

/** The lawful boundary a surface lives under (derived from its classification + paths). */
export function boundaryOf(surface: LawSurface): SurfaceBoundary {
	if (surface.classification === 'port-owned') {
		return 'port-owned';
	}
	const anyExportDir = surface.dirs.some(dir => dir === EXPORTS_DIR || dir.startsWith(`${EXPORTS_DIR}/`));
	return anyExportDir ? '.flauz-exports' : '.flauz';
}

// ---------------------------------------------------------------------------
// The boundary-scan shapes (derived from the law table -- never a second list)
// ---------------------------------------------------------------------------

/** The stamp shape every record/export/bundle filename suffix carries (the export-stamp convention: ISO-8601 UTC, colons removed). */
export const STAMP_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{6}\.\d{3}Z$/;

/** Every record filename prefix the law knows (the stray-record scan shapes). */
export function lawRecordPrefixes(): readonly string[] {
	return [...new Set(LAW_SURFACES.flatMap(surface => surface.recordPrefixes))].sort();
}

/** Every stamp-suffixed directory prefix the law knows (the stray-directory scan shapes). */
export function lawDirPrefixes(): readonly string[] {
	return [...new Set(LAW_SURFACES.flatMap(surface => surface.dirPrefixes))].sort();
}

/** True when a filename is a stamp-shaped record of one of the law's prefixes (`<prefix><stamp>.json`). */
export function isLawRecordName(name: string): boolean {
	for (const prefix of lawRecordPrefixes()) {
		if (name.startsWith(prefix)) {
			const rest = name.slice(prefix.length);
			if (rest.endsWith('.json') && STAMP_SHAPE.test(rest.slice(0, -5))) {
				return true;
			}
		}
	}
	return false;
}

/** True when a directory name is a stamp-shaped directory of one of the law's prefixes (`<prefix><stamp>`). */
export function isLawDirName(name: string): boolean {
	for (const prefix of lawDirPrefixes()) {
		if (name.startsWith(prefix) && STAMP_SHAPE.test(name.slice(prefix.length))) {
			return true;
		}
	}
	return false;
}

/**
 * The `.flauz/` top-level entries the law claims (the unclaimed-entry
 * disclosure's allowlist): every fixed file/dir top-level segment + every
 * stamp-shaped directory prefix, derived from the table.
 */
export function claimedFlauzTopLevelEntries(): ReadonlySet<string> {
	const claimed = new Set<string>();
	for (const surface of LAW_SURFACES) {
		if (surface.classification === 'port-owned') {
			// the port-owned store's top-level claim (integrity/) is claimed through
			// its owning extension's other surfaces; the store itself rides .flauz/integrity/
			for (const file of surface.files) {
				const segments = file.split('/');
				if (segments[0] === FLAUZ_DIR && segments.length >= 2) {
					claimed.add(segments[1] as string);
				}
			}
			continue;
		}
		for (const file of surface.files) {
			const segments = file.split('/');
			if (segments[0] === FLAUZ_DIR && segments.length >= 2) {
				claimed.add(segments[1] as string);
			}
		}
		for (const dir of surface.dirs) {
			const segments = dir.split('/');
			if (segments[0] === FLAUZ_DIR && segments.length >= 2) {
				claimed.add(segments[1] as string);
			}
		}
		for (const prefix of surface.dirPrefixes) {
			// stamp-shaped directories claim their prefix SHAPE, not a fixed name
			claimed.add(`^${prefix}`);
		}
	}
	return claimed;
}

/** True when a `.flauz/` top-level entry name is claimed by the law (fixed name or claimed shape). */
export function flauzEntryIsClaimed(name: string): boolean {
	for (const claim of claimedFlauzTopLevelEntries()) {
		if (claim.startsWith('^')) {
			if (name.startsWith(claim.slice(1)) && STAMP_SHAPE.test(name.slice(claim.slice(1).length))) {
				return true;
			}
		} else if (name === claim) {
			return true;
		}
	}
	return false;
}

/** The walk's skip law: the host/tooling trees never scanned (disclosed in every record that carries a scan). */
export const SCAN_SKIP_NAMES: readonly string[] = ['.git', 'node_modules'];
