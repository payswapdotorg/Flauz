/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz — TL4 (product quality). rubric.mjs — the P2-003 user-discovery audit
// rubric + the pinned known-gap registry for p2-003-discovery-gate.mjs.
//
// The rubric = the TL4-PRODUCT-HANDOFF.md P2-003 checklist (9 areas) × the
// persona split where the expectation changes (new user = empty-product
// discovery; returning user = populated-state recovery/resume/provenance).
// Every row names a REAL user-facing contract that is machine-checkable in
// the extension/view sources at the static-contract evidence level (the
// ia-gate/premium-ux-gate precedent):
//
//   DA01 six views, human-facing names, one container (A1, new)
//   DA02 focus-command family, category "Flauz" (A1, new — F1/palette)
//   DA03 every welcome links its surface's PRIMARY next action (A2, new)
//   DA04 every welcome explains the surface (guidance sentence) (A2, new)
//   DA05 Home welcome folder-branch carries view links (A2, new)
//   DA06 every Home "not initialized" row is actionable (A2, returning)
//   DA07 the agent capability is discoverable (A3, new)
//   DA08 the browser capability is discoverable (A3, new)
//   DA09 the environments capability is discoverable (A3, new)
//   DA10 the models surface is honest (registered vs design stub) (A3, new)
//   DA11 delegation/A2A is discoverable (A3, new) — KNOWN GAP (P2-FIX-203)
//   DA12 the shared error grammar (label/context/Retry/guidance) (A4, new)
//   DA13 recovery keeps last-known-good / fails closed (A4, returning)
//   DA14 consistent time grammar (shared format.ts) (A4, new)
//   DA15 approval gates are comprehensible (A5, new)
//   DA16 takeover is comprehensible (A5, new) — KNOWN GAP (P2-FIX-204)
//   DA17 evidence provenance is readable (id/kind/uri/SHA-256/open) (A6, new)
//   DA18 the ledger verify affordance is palette-categorized (A6, returning)
//        — KNOWN GAP (P2-FIX-205)
//   DA19 no dead-end empty states (welcome + link per view) (A7, new)
//   DA20 post-action states are recoverable (A7, returning)
//   DA21 accessibility labels on every tree row (A8, new)
//   DA22 keyboard/navigation contract (focus + reveal + guide) (A8, new)
//   DA23 web-posture honesty (tree views only + parity coverage) (A9, new)
//
// KNOWN-GAP law (the honest-CI mechanism): a rubric row that currently
// fails on the integrated tree is pinned here with its routed finding id.
// The gate reports pinned misses as KNOWN-GAP (routed, not silent) and exits
// 0 — the owning TL fixes the finding, then `--strict` flips the pinned
// misses to failures for post-fix enforcement. An UNPINNED miss always fails
// (fail-closed: a regression never hides behind the gap registry).
//
// Zero dependencies: node >= 20 stdlib only.
// ---------------------------------------------------------------------------------------------

/** The six TL4-001 views: view id -> the exact user-facing name. */
export const EXPECTED_VIEWS = new Map([
        ['flauz.home', 'Home'],
        ['flauz.tasks', 'Tasks'],
        ['flauz.agentSessions', 'Agent Sessions'],
        ['flauz.environments', 'Environments'],
        ['flauz.browser', 'Browser'],
        ['flauz.models', 'Models'],
]);

/** The single activity-bar container id (TL4-IA-SPEC section 2). */
export const CONTAINER_ID = 'flauz';

/** The premium-UX documented exemption marker (spec section 9). */
export const NO_FAILURE_MARKER = 'premium-ux-gate: no-failure-source';

/**
 * DA03 — the primary next-action command each empty state must link.
 * `any` = the welcome passes when at least one of these command ids is
 * linked. An empty `any` = the surface has NO user-facing creation command
 * in v0 (honest no-action posture, recorded as a note, not a miss).
 */
export const PRIMARY_ACTIONS = new Map([
        ['flauz.home', { any: ['workbench.action.files.openFolder'], note: 'First run = no folder: Open Folder is the primary action.' }],
        ['flauz.tasks', { any: ['workbench.action.chat.open'], note: 'Task creation rides the flauz.agent chat participant: Open Chat is the primary action.' }],
        ['flauz.agentSessions', { any: ['workbench.action.files.openFolder'], note: 'The bridge needs a workspace folder first: Open Folder is the primary action.' }],
        ['flauz.environments', { any: ['flauz.env.register'], note: 'A new user\'s primary action is registering the first environment (the command exists, category "Flauz").' }],
        ['flauz.browser', { any: ['flauz.browser.setPolicy', 'workbench.action.files.openFolder'], note: 'No-folder state: Open Folder; with a folder: create the policy file.' }],
        ['flauz.models', { any: [], note: 'v0: no user-facing provider-registration command exists (flauz-models contributes focus + refresh only); the welcome cannot link a creation action. The surface\'s honesty is carried by DA10 instead.' }],
]);

/** The audit rubric (one row per checklist item; persona where it changes the expectation). */
export const RUBRIC = [
        { id: 'DA01', area: 'A1 view-discoverability', persona: 'new', title: 'the six views exist in the single flauz container with their human-facing names' },
        { id: 'DA02', area: 'A1 view-discoverability', persona: 'new', title: 'container + per-view focus commands, category "Flauz" (palette/F1 reachable)' },
        { id: 'DA03', area: 'A2 next-steps', persona: 'new', title: 'every welcome links its surface\'s primary next action' },
        { id: 'DA04', area: 'A2 next-steps', persona: 'new', title: 'every welcome carries a guidance sentence explaining the surface' },
        { id: 'DA05', area: 'A2 next-steps', persona: 'new', title: 'Home welcome: Open Folder link plus the no-folder view links (Tasks/Environments)' },
        { id: 'DA06', area: 'A2 next-steps', persona: 'returning', title: 'every Home "not initialized" row carries an action command' },
        { id: 'DA07', area: 'A3 capability-discoverability', persona: 'new', title: 'the agent capability is discoverable (default participant + welcomes point to Chat)' },
        { id: 'DA08', area: 'A3 capability-discoverability', persona: 'new', title: 'the browser capability is discoverable (welcome links the policy action)' },
        { id: 'DA09', area: 'A3 capability-discoverability', persona: 'new', title: 'the environments capability is discoverable (register command family)' },
        { id: 'DA10', area: 'A3 capability-discoverability', persona: 'new', title: 'the models surface is honest (registered vs design stub, mock labeled)' },
        { id: 'DA11', area: 'A3 capability-discoverability', persona: 'new', title: 'delegation/A2A is discoverable from some user-facing surface' },
        { id: 'DA12', area: 'A4 error-recovery-grammar', persona: 'new', title: 'the shared error grammar on every failure-capable view (Unable to Load / flauzError / Retry / retry sentence)' },
        { id: 'DA13', area: 'A4 error-recovery-grammar', persona: 'returning', title: 'recovery keeps last-known-good rows; Browser fails closed (no stale policy)' },
        { id: 'DA14', area: 'A4 error-recovery-grammar', persona: 'new', title: 'one time grammar: ages/stamps only through the shared format.ts' },
        { id: 'DA15', area: 'A5 approval-takeover', persona: 'new', title: 'approval gates are comprehensible (human-gate descriptions, followups, named terminal confirmation)' },
        { id: 'DA16', area: 'A5 approval-takeover', persona: 'new', title: 'takeover is comprehensible from some user-facing surface' },
        { id: 'DA17', area: 'A6 evidence-provenance', persona: 'new', title: 'evidence rows carry provenance (id, kind, uri, age, SHA-256, open affordance)' },
        { id: 'DA18', area: 'A6 evidence-provenance', persona: 'returning', title: 'the ledger verify affordance exists and is palette-categorized (category "Flauz")' },
        { id: 'DA19', area: 'A7 no-dead-ends', persona: 'new', title: 'no dead-end empty states: every view has a welcome with at least one action link' },
        { id: 'DA20', area: 'A7 no-dead-ends', persona: 'returning', title: 'post-action states are recoverable (failed/cancelled visible; verify-fail returns to an approvable state)' },
        { id: 'DA21', area: 'A8 accessibility', persona: 'new', title: 'accessibilityInformation on every tree row; error rows announce the retry affordance' },
        { id: 'DA22', area: 'A8 accessibility', persona: 'new', title: 'keyboard contract: per-view focus + reveal navigation + the guide documents tree keys' },
        { id: 'DA23', area: 'A9 web-posture', persona: 'new', title: 'web-posture honesty: tree views only (no webviews) + parity registry covers every flauz extension' },
];

/**
 * The pinned known-gap registry: "ROW:subject" -> the routed finding.
 * Exactly the NON-PASS verdicts of the 2026-09-29/30 audit record
 * (docs/FLAUZ-PROGRAM/acceptance/p2-003-discovery-audit.md): five findings
 * (P2-FIX-201..205), six pinned instances — DA18 fires twice (two
 * uncategorized commands, one finding). When the owning TL lands the fix,
 * remove the pin (or keep it — the gate then reports the gap RESOLVED) and
 * enforce with --strict during re-verification.
 */
export const KNOWN_GAPS = new Map([
        ['DA03:flauz.environments', {
                finding: 'P2-FIX-201',
                note: 'The Environments welcome links Refresh + Back to Home but not Register Environment (the primary creation affordance; premium spec section 9 records the refresh-primary decision — the audit proposes the amendment).',
        }],
        ['DA06:home-workflows-not-initialized', {
                finding: 'P2-FIX-202',
                note: 'The Home "Workflows: not initialized" row carries no command — the only inert Home row; the tooltip explains the trigger but not as an action.',
        }],
        ['DA11:product-wide', {
                finding: 'P2-FIX-203',
                note: 'No user-facing surface (views, welcomes, commands, participant, guide) mentions delegation/A2A — the capability is invisible without docs.',
        }],
        ['DA16:product-wide', {
                finding: 'P2-FIX-204',
                note: 'No user-facing surface explains takeover (the word appears nowhere a user can see); approvals are visible, takeover is not.',
        }],
        ['DA18:flauz.verifyLedger', {
                finding: 'P2-FIX-205',
                note: 'flauz.verifyLedger ("Verify Flauz Evidence Ledger") has no category — it groups outside the Flauz palette family.',
        }],
        ['DA18:flauz.showTasks', {
                finding: 'P2-FIX-205',
                note: 'flauz.showTasks ("Show Flauz Tasks") has no category and opens the raw .flauz/tasks.json — its title collides with the Tasks view focus command.',
        }],
]);
