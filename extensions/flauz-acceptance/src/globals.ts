/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Acceptance -- the launch + post-release-acceptance plane
 * (A-PROD-006-W2, DL-87). UNVERIFIED-BY-ME: authored against the
 * unblock-packet surfaces; the station runs the battery.
 *
 * This module holds the schema ids, the durable-state paths, the synthetic
 * taskId, this extension's own id, the frozen disclosure/law strings, AND
 * the injected-clock default (the W1 sibling's globals.ts pattern, mirrored).
 *
 * THE INJECTED-CLOCK LAW: no host-clock calls anywhere in src/ -- the clock
 * is injected by the extension layer (the host wall clock, wired with the
 * determinism grep exemption comment) and by tests (the stepping-clock
 * fixture). The default exported here is a deterministic fallback (epoch 0);
 * it is never the production clock.
 *
 * THE TWO-REGISTRY SEPARATION (carried from the W1/DL-86 posture): the
 * workspace-local acceptance records are OPERATIONAL launch state;
 * WORK-REGISTRY.md is the AUTHORITY for work items. Acceptance records
 * NEVER mint, edit, rank or supersede control-plane state.
 *
 * THE READ-ONLY SIBLING CONTRACTS: the flauz-release checklist artifact home
 * (.flauz/release/checklist-<stamp>.json) and the flauz-incidents loop
 * journals (.flauz/incidents/loop-<incident>.jsonl) are READ through the
 * contract-pinned parsers in api.ts; neither sibling's source is touched.
 * The constants marked INFERENCE below were not in the unblock packet and
 * are isolated here for a one-line reconciliation (delivery-report seam 2).
 */

import type * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Schema ids (the order's ids, verbatim)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into every acceptance record + verification receipt (the order's id, verbatim). */
export const ACCEPTANCE_SCHEMA_ID = 'flauz.acceptance/v1';

// ---------------------------------------------------------------------------
// Paths (workspace-relative; the W1/W2/W3/W5 posture -- never absolute host paths)
// ---------------------------------------------------------------------------

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** This extension's own durable home (the acceptance records + the verification receipts). */
export const ACCEPTANCE_DIR = '.flauz/acceptance';

/** The acceptance record filename prefix: `acceptance-<flauz:acc:<16-hex>>.json`. */
export const ACCEPTANCE_PREFIX = 'acceptance-';

/** The receipt filename prefix: `receipt-<flauz:rcp:<16-hex>>.json`. */
export const RECEIPT_PREFIX = 'receipt-';

/** The flauz-release checklist artifact home (contract-duplicated from flauz-release; READ-only). */
export const RELEASE_DIR = '.flauz/release';

/** The checklist artifact filename prefix (contract-duplicated from flauz-release). */
export const CHECKLIST_PREFIX = 'checklist-';

/** The checklist artifact filename suffix. */
export const CHECKLIST_SUFFIX = '.json';

/** The checklist artifact's pinned commandLine (verbatim from the ReleaseChecklistArtifact surface). */
export const CHECKLIST_COMMAND_LINE = 'flauz.release.checklist';

/** The flauz-incidents durable home (contract-duplicated from flauz-incidents; READ-only). */
export const INCIDENTS_DIR = '.flauz/incidents';

/** The per-incident loop journal filename prefix (contract-duplicated from flauz-incidents). */
export const LOOP_PREFIX = 'loop-';

/** The loop journal filename suffix. */
export const LOOP_SUFFIX = '.jsonl';

/** The banked evidence-ledger path (contract-duplicated from flauz-workspace via W1; census-visible banking). */
export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';

/** The banked evidence-ledger size watermark path (contract-duplicated; the banking resync target). */
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

/** The size watermark's schema id. */
export const SIZE_SCHEMA_ID = 'flauz.evidence.size/v1';

// ---------------------------------------------------------------------------
// The census snapshot paths (contract-duplicated from flauz-release/src/census.ts).
// LEDGER_PATH/SIZE_PATH above are pinned verbatim from the W1 globals surface;
// the constants below are INFERENCE (the owning literals were not in the
// unblock packet) -- isolated here for a one-line reconciliation.
// ---------------------------------------------------------------------------
export const CENSUS_TASKS_PATH = '.flauz/tasks.json';
export const CENSUS_RESOURCES_GRAPH_PATH = '.flauz/resources/graph.json';
export const CENSUS_RESOURCES_OPS_PATH = '.flauz/resources/ops.jsonl';
export const CENSUS_ENVIRONMENTS_REGISTRY_PATH = '.flauz/environments/environments.json';
export const CENSUS_BROWSER_SESSIONS_PATH = '.flauz/browser/sessions.jsonl';
export const CENSUS_WORKFLOWS_DIR = '.flauz/workflows';
export const CENSUS_ORCH_GRAPHS_PATH = '.flauz/orchestration/graphs.json';
export const CENSUS_ORCH_JOURNAL_PATH = '.flauz/orchestration/journal.jsonl';
export const CENSUS_MODELS_DIR = '.flauz/models';
export const CENSUS_PROVIDERS_PATH = '.flauz/models/providers.json';
export const CENSUS_ROUTING_DECISIONS_PATH = '.flauz/models/routing-decisions.jsonl';

// ---------------------------------------------------------------------------
// The product-state paths (contract-duplicated from flauz-release/src/productState.ts).
// PRODUCT_PARITY_REGISTRY_PATH + PRODUCT_SBOM_PATH are pinned by the work
// order's authority list; PRODUCT_EXTENSIONS_DIR is pinned by the
// ExtensionManifestSummary doc comment ('extensions/flauz-release').
// ---------------------------------------------------------------------------
export const PRODUCT_EXTENSIONS_DIR = 'extensions';
export const PRODUCT_PARITY_REGISTRY_PATH = 'build/flauz/packaging-parity.json';
export const PRODUCT_SBOM_PATH = 'build/flauz/security/flauz-sbom.json';

// ---------------------------------------------------------------------------
// The synthetic taskId + this extension's own id (the provenance pinned into every artifact)
// ---------------------------------------------------------------------------

/** The synthetic ledger taskId of the banked acceptance rows (the flauz-incidents W1 precedent). */
export const ACCEPTANCE_TASK_ID = 'flauz-acceptance';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-acceptance';

// ---------------------------------------------------------------------------
// The launch-act freshness law
// ---------------------------------------------------------------------------

/**
 * The FRESH window: a checklist artifact whose createdAt is older than this
 * (or future-dated against the injected clock) is NOT FRESH and refuses the
 * launch-act (typed FLAUZ_ACCEPTANCE_CHECKLIST_STALE). 24h.
 */
export const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The frozen disclosure + privacy strings (pinned verbatim into every record + receipt)
// ---------------------------------------------------------------------------

/** The honest-scope disclosure, pinned verbatim into every acceptance record + receipt. */
export const BOUNDARY_DISCLOSURE = 'the honest-scope disclosure: this plane delivers launch + post-release-acceptance MACHINERY over workspace state; production usage is EMPTY by design -- the launch has not happened; no acceptance record or receipt may claim production-real evidence; the receipt evidence label is local-real (real workspace state, locally re-verified) and is never promoted by wording; a check this plane cannot itself evaluate is a TYPED DISCLOSURE row naming its owning surface, never a silent green.';

/** The metadata law, pinned verbatim into every acceptance record + receipt. */
export const PRIVACY_LAW = 'METADATA-ONLY: surface shapes (acceptance ids, checklist ids + paths, verdicts, counts, product-inventory shapes, durable-census shapes) -- never contents and never credential-shaped values; swept fail-closed for secret-shaped values before a single byte is written.';

// ---------------------------------------------------------------------------
// The injected clock (the determinism law; the durability wave's structural law)
// ---------------------------------------------------------------------------

/** The clock type (epoch milliseconds). */
export type Clock = () => number;

/**
 * The injected-clock DEFAULT: a deterministic fallback (epoch 0). Never the
 * production clock -- the extension layer overrides this with the host wall
 * clock (wired with the determinism grep exemption comment in extension.ts);
 * tests override it with the stepping-clock fixture.
 */
export const DEFAULT_CLOCK: Clock = () => 0;

// ---------------------------------------------------------------------------
// The vscode API holder (the W1 pattern; commands.ts reads it)
// ---------------------------------------------------------------------------

let api: typeof vscode | undefined;

export function setVscodeApi(value: typeof vscode): void {
	api = value;
}

export function vscodeApi(): typeof vscode {
	if (api === undefined) {
		throw new Error('flauz-acceptance: vscode API is not set (extension.activate() must run first, or a test shim must be installed)');
	}
	return api;
}
