/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Incidents -- the incident/problem registry plane (A-PROD-006-W1, TL-A).
 *
 * This module holds the schema ids, the durable-state paths, the synthetic
 * taskId, this extension's own id, AND the injected-clock default. The
 * injected-clock law (the durability wave's structural law, mirrored here):
 * no host-clock calls anywhere in src/ -- the clock is injected by
 * the extension layer (the host wall clock, wired with the determinism grep
 * exemption comment) and by tests (the stepping-clock fixture). The default
 * exported here is a deterministic fallback (epoch 0) -- it is never the
 * production clock; the extension layer always overrides it.
 *
 * THE TWO-REGISTRY SEPARATION (DL-86 ADOPT): the workspace-local incident
 * ledger (the paths below) is the OPERATIONAL loop state; WORK-REGISTRY.md
 * is the AUTHORITY for work items. The product surface RECORDS the loop
 * state and LINKS to control-plane state by carrying the repo-side registry
 * item id VERBATIM at the registry-item stage; it never mints, edits, ranks
 * or supersedes control-plane state.
 */

import type * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Schema ids (the order's ids, verbatim)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into the incident ledger (the order's id, verbatim). */
export const INCIDENTS_SCHEMA_ID = 'flauz.incidents/v1';

/** Schema identifier pinned into every per-incident loop journal row (the order's id, verbatim). */
export const LOOP_SCHEMA_ID = 'flauz.incidents-loop/v1';

/** Schema identifier pinned into every ledger-verdict record (the order's id, verbatim). */
export const STATUS_SCHEMA_ID = 'flauz.incidents-status/v1';

// ---------------------------------------------------------------------------
// Paths (workspace-relative; the W1/W2/W3/W5 posture -- never absolute host paths)
// ---------------------------------------------------------------------------

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** This extension's own durable home (the incident ledger + the loop journals + the status records). */
export const INCIDENTS_DIR = '.flauz/incidents';

/** The incident ledger filename (a FIXED file, the registry every command consults). */
export const INCIDENTS_FILENAME = 'incidents.json';

/** The loop journal filename prefix: `loop-<incident>.jsonl` (one journal per incident). */
export const LOOP_PREFIX = 'loop-';

/** The status record filename prefix: `status-<stamp>.json`. */
export const STATUS_PREFIX = 'status-';

/** The banked evidence-ledger path (contract-duplicated from flauz-workspace; census-visible banking). */
export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';

/** The banked evidence-ledger size watermark path (contract-duplicated; the banking resync target). */
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the ledger file self-declares no $schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

// ---------------------------------------------------------------------------
// The synthetic taskId + this extension's own id (the provenance pinned into every artifact)
// ---------------------------------------------------------------------------

/** The synthetic ledger taskId of the banked incident rows (the flauz-backup/flauz-migration/flauz-telemetry/flauz-release/flauz-production/flauz-integrity/flauz-isolation/flauz-durability precedent). */
export const INCIDENTS_TASK_ID = 'flauz-incidents';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-incidents';

// ---------------------------------------------------------------------------
// The injected clock (the determinism law; the durability wave's structural law)
// ---------------------------------------------------------------------------

/** The clock type (epoch milliseconds). */
export type Clock = () => number;

/**
 * The injected-clock DEFAULT: a deterministic fallback (epoch 0). Never the
 * production clock -- the extension layer overrides this with the host wall
 * clock (wired with the determinism grep exemption comment in extension.ts);
 * tests override it with the stepping-clock fixture. The default exists so
 * the pure-API surface has a clock to call when no injection reaches it
 * (the closed-loop machinery never crashes on a missing clock -- it produces
 * a deterministic, honest, reproducible record).
 */
export const DEFAULT_CLOCK: Clock = () => 0;

// ---------------------------------------------------------------------------
// The vscode API holder (the flauz-durability pattern; commands.ts reads it)
// ---------------------------------------------------------------------------

let api: typeof vscode | undefined;

export function setVscodeApi(value: typeof vscode): void {
	api = value;
}

export function vscodeApi(): typeof vscode {
	if (api === undefined) {
		throw new Error('flauz-incidents: vscode API is not set (extension.activate() must run first, or a test shim must be installed)');
	}
	return api;
}
