/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Acceptance -- the launch + post-release-acceptance plane
 * (A-PROD-006-W2, DL-87).
 *
 * This module holds the schema ids, the durable-state paths, the synthetic
 * taskId, this extension's own id, AND the injected-clock default. The
 * injected-clock law (the durability wave's structural law, mirrored from the
 * flauz-incidents precedent): no host-clock calls anywhere in src/ -- the
 * clock is injected by the extension layer (the host wall clock, wired with
 * the determinism grep exemption comment) and by tests (the stepping-clock
 * fixture). The default exported here is a deterministic fallback (epoch 0)
 * -- it is never the production clock; the extension layer always overrides
 * it.
 *
 * THE TWO-REGISTRY SEPARATION (DL-87, inheriting DL-86): the workspace-local
 * acceptance ledger (the paths below) is the OPERATIONAL launch + receipt
 * state; WORK-REGISTRY.md is the AUTHORITY for work items. The acceptance
 * surface RECORDS the launch act + the closing receipts and LINKS to
 * control-plane state only by carrying ids VERBATIM; it never mints, edits,
 * ranks or supersedes control-plane state.
 */

import type * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Schema ids (the order's ids, verbatim)
// ---------------------------------------------------------------------------

/** Schema identifier pinned into the acceptance ledger (the order's id, verbatim). */
export const ACCEPTANCE_SCHEMA_ID = 'flauz.acceptance/v1';

/** Schema identifier pinned into every verification-journal row (the order's id, verbatim). */
export const VERIFICATION_SCHEMA_ID = 'flauz.acceptance-verification/v1';

/** Schema identifier pinned into every ledger-verdict record (the order's id, verbatim). */
export const STATUS_SCHEMA_ID = 'flauz.acceptance-status/v1';

// ---------------------------------------------------------------------------
// Paths (workspace-relative; the W1/W2/W3/W5 posture -- never absolute host paths)
// ---------------------------------------------------------------------------

/** Directory (relative to the workspace root) holding all Flauz durable state. */
export const FLAUZ_DIR = '.flauz';

/** This extension's own durable home (the acceptance ledger + the verification journals + the status records). */
export const ACCEPTANCE_DIR = '.flauz/acceptance';

/** The acceptance ledger filename (a FIXED file, the registry every command consults). */
export const ACCEPTANCE_FILENAME = 'acceptances.json';

/** The verification-journal filename prefix: `verify-<acceptanceId>.jsonl` (one journal per acceptance). */
export const VERIFY_PREFIX = 'verify-';

/** The status record filename prefix: `status-<stamp>.json`. */
export const STATUS_PREFIX = 'status-';

// --- the flauz-release surfaces this plane READS through the contract-pinned
//     parser (never edited; the surfaces-disjoint law) -- contract-duplicated
//     from flauz-release/src/api.ts, pinned by the contract suite ---

/** The release extension's durable home (the checklist artifacts this plane binds). */
export const RELEASE_DIR = '.flauz/release';

/** The checklist artifact filename prefix (the launch-act's subject). */
export const CHECKLIST_PREFIX = 'checklist-';

/** The banked evidence-ledger path (contract-duplicated from flauz-workspace; census-visible banking). */
export const LEDGER_PATH = '.flauz/evidence/ledger.jsonl';

/** The banked evidence-ledger size watermark path (contract-duplicated; the banking resync target). */
export const SIZE_PATH = '.flauz/evidence/size.json';

/** The ledger's row-shape format id (the ledger file self-declares no $schema; the pinned row contract is the version). */
export const LEDGER_ROW_FORMAT_ID = 'flauz.evidence.rows/v0';

// ---------------------------------------------------------------------------
// The synthetic taskId + this extension's own id (the provenance pinned into every artifact)
// ---------------------------------------------------------------------------

/** The synthetic ledger taskId of the banked acceptance rows (the flauz-backup/flauz-migration/flauz-telemetry/flauz-release/flauz-production/flauz-integrity/flauz-isolation/flauz-durability/flauz-incidents precedent). */
export const ACCEPTANCE_TASK_ID = 'flauz-acceptance';

/** This extension's own id (the provenance pinned into every artifact it writes). */
export const EXTENSION_ID = 'flauz.flauz-acceptance';

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
 * (the launch + receipt machinery never crashes on a missing clock -- it
 * produces a deterministic, honest, reproducible record).
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
                throw new Error('flauz-acceptance: vscode API is not set (extension.activate() must run first, or a test shim must be installed)');
        }
        return api;
}
