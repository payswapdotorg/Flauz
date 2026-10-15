/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DH-010 Harness console state machine - the pure, vscode-free,
 * node-free core of the Harness console. The extension renders what
 * this module decides; every effect (selecting an industry, composing
 * a company, proposing a draft, loading the navigation model) flows
 * through the injected HarnessConsolePort (src/harnessPort.ts).
 * `node --test` runs it under plain type stripping: only type-only
 * imports cross this module's boundary (the port contract's shapes).
 *
 * DETERMINISM LAW: no Math.random, no clock reads; every timestamp is
 * an injected string (nowIso parameters). The same inputs always
 * produce a byte-identical result.
 *
 * THE CLOSED ACTIVATION SEAM (ARCHITECTURE-LOCK 12.5/12.6): proposing
 * a draft is allowed and rides the REAL DH-02/DH-01 kits through the
 * port; ACTIVATING the proposed harness through the console is
 * refused - the refusal reason is carried on every recorded proposal
 * and shown to the user every time (activation routes through the
 * DH-01 authority, never a second lifecycle authority).
 */

import type {
        HarnessListResult,
        HarnessSummaryRow,
        ProposedDraft,
        RoleCompositionOption,
        RoleCompositionsResult,
        SelectionSessionView,
        SessionOpResult,
} from './harnessPort.ts';
import type { DomainNavigationModel } from './harnessPort.ts';

/** The port's vocabulary IS the console's (the flauz-lab re-export idiom): the observed session view-model. */
export type { SelectionSessionView } from './harnessPort.ts';

/**
 * The refusal shown on EVERY recorded proposal: activating routes
 * through the DH-01 harness authority; the console never becomes a
 * second lifecycle authority.
 */
export const ACTIVATION_REFUSAL_REASON =
        'Activation routes through the DH-01 harness authority (advanceHarness): the Harness console never becomes a second lifecycle authority.';

/** The Harness console state (immutable shape; every transition returns a new state). */
export interface HarnessConsoleState {
        /** The REAL frozen industry list (from the last refresh). */
        readonly industries: readonly string[];
        /** The REAL frozen company size-band list (from the last refresh). */
        readonly sizeBands: readonly string[];
        /** The REAL frozen work-type list (from the last refresh). */
        readonly workTypes: readonly string[];
        /** The observed sessions (newest last; one row per begun session). */
        readonly sessions: readonly SelectionSessionView[];
        /** The session the console drives (undefined until one begins). */
        readonly activeSessionId?: string;
        /** The composed DH-03 roles sessions (the draft's composition options). */
        readonly roleCompositions: readonly RoleCompositionOption[];
        /** The roles session selected for the draft (undefined until selected). */
        readonly selectedRolesSessionId?: string;
        /** The workspace's harnesses (from the last refresh). */
        readonly harnesses: readonly HarnessSummaryRow[];
        /** The harness under inspection (undefined until one is selected). */
        readonly inspectedHarnessId?: string;
        /** The inspected harness's projected navigation model (the DH-010 derivation). */
        readonly navigation?: DomainNavigationModel;
        /** Recorded proposals (the proposed-draft state), newest last. */
        readonly proposals: readonly ProposedDraft[];
        /** Observed operation failure (the 'Unable to Load Harness' row; cleared on retry). */
        readonly error?: string;
}

/** FNV-1a 32-bit hash rendered as exactly 8 lowercase hex chars (deterministic). */
function fnv1a32hex(text: string): string {
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i += 1) {
                hash ^= text.charCodeAt(i);
                hash = Math.imul(hash, 0x01000193) >>> 0;
        }
        return hash.toString(16).padStart(8, '0');
}

/** The initial state: the observed vocabularies loaded, nothing begun, nothing inspected. */
export function initialHarnessState(
        industries: readonly string[],
        sizeBands: readonly string[],
        workTypes: readonly string[],
): HarnessConsoleState {
        return { industries, sizeBands, workTypes, sessions: [], roleCompositions: [], harnesses: [], proposals: [] };
}

/** Fold the observed roles-composition options (the draft's composition menu); a typed refusal is the console error state. */
export function applyRoleCompositions(state: HarnessConsoleState, result: RoleCompositionsResult): HarnessConsoleState {
        if (!result.ok) {
                return failOperation(state, `${result.reason}: ${result.detail}`);
        }
        const roleCompositions = result.options;
        const keepSelected = state.selectedRolesSessionId !== undefined
                && roleCompositions.some((option) => option.sessionId === state.selectedRolesSessionId);
        return {
                ...state,
                roleCompositions,
                selectedRolesSessionId: keepSelected ? state.selectedRolesSessionId : undefined,
        };
}

/** Fold the observed harness list (the inspection menu); a typed refusal is the console error state. */
export function applyHarnessList(state: HarnessConsoleState, result: HarnessListResult): HarnessConsoleState {
        if (!result.ok) {
                return failOperation(state, `${result.reason}: ${result.detail}`);
        }
        const harnesses = result.harnesses;
        const keepInspected = state.inspectedHarnessId !== undefined
                && harnesses.some((row) => row.harnessId === state.inspectedHarnessId);
        return {
                ...state,
                harnesses,
                inspectedHarnessId: keepInspected ? state.inspectedHarnessId : undefined,
                navigation: keepInspected ? state.navigation : undefined,
        };
}

/**
 * Fold a session-op result: ok refreshes the observed session (and
 * makes it the driven one); a typed refusal is surfaced as the
 * console error state (the observed reason and detail ride the error
 * row - never swallowed, never fabricated).
 */
export function applySessionResult(state: HarnessConsoleState, result: SessionOpResult): HarnessConsoleState {
        if (!result.ok) {
                return failOperation(state, `${result.reason}: ${result.detail}`);
        }
        const session = result.session;
        const others = state.sessions.filter((candidate) => candidate.sessionId !== session.sessionId);
        return { ...state, sessions: [...others, session].sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1)), activeSessionId: session.sessionId };
}

/**
 * Fold a navigation load: ok attaches the projected model to the
 * inspected harness; a typed refusal is the console error state (the
 * observed reason and detail, never a silent partial model).
 */
export function applyNavigationLoad(state: HarnessConsoleState, harnessId: string, result: { ok: true; model: DomainNavigationModel } | { ok: false; reason: string; detail: string }): HarnessConsoleState {
        if (!result.ok) {
                return failOperation(state, `${result.reason}: ${result.detail}`);
        }
        return { ...state, inspectedHarnessId: harnessId, navigation: result.model };
}

/** Record an observed operation failure (shown as the Unable to Load Harness row). */
export function failOperation(state: HarnessConsoleState, message: string): HarnessConsoleState {
        return { ...state, error: message };
}

/** Clear the observed error (the retry path: a fresh refresh attempt begins). */
export function clearError(state: HarnessConsoleState): HarnessConsoleState {
        if (state.error === undefined) {
                return state;
        }
        const next: HarnessConsoleState = { ...state };
        delete (next as { error?: string }).error;
        return next;
}

/** Select the session the console drives; unknown ids are refused (the state is returned unchanged). */
export function selectSession(state: HarnessConsoleState, sessionId: string): HarnessConsoleState {
        if (!state.sessions.some((session) => session.sessionId === sessionId) || state.activeSessionId === sessionId) {
                return state;
        }
        return { ...state, activeSessionId: sessionId };
}

/** Select the roles composition the draft composes from; unknown ids are refused (unchanged). */
export function selectRolesComposition(state: HarnessConsoleState, rolesSessionId: string): HarnessConsoleState {
        if (!state.roleCompositions.some((option) => option.sessionId === rolesSessionId) || state.selectedRolesSessionId === rolesSessionId) {
                return state;
        }
        return { ...state, selectedRolesSessionId: rolesSessionId };
}

/** Select the harness under inspection; unknown ids are refused (unchanged). */
export function selectHarness(state: HarnessConsoleState, harnessId: string): HarnessConsoleState {
        if (!state.harnesses.some((row) => row.harnessId === harnessId) || state.inspectedHarnessId === harnessId) {
                return state;
        }
        return { ...state, inspectedHarnessId: harnessId, navigation: undefined };
}

/** The driven session's observed view (undefined until one begins). */
export function activeSession(state: HarnessConsoleState): SelectionSessionView | undefined {
        return state.sessions.find((session) => session.sessionId === state.activeSessionId);
}

/**
 * Record a proposal (the proposed-draft state): the session's proposed
 * harness id, the injected ISO stamp, and the activation refusal
 * riding verbatim on EVERY recorded proposal. Deterministic in the
 * proposal inputs (the id is the FNV hash of session, harness and
 * stamp).
 */
export function recordProposal(state: HarnessConsoleState, sessionId: string, harnessId: string, nowIso: string): { state: HarnessConsoleState; proposal: ProposedDraft } {
        const proposal: ProposedDraft = {
                proposalId: `prop-${fnv1a32hex(`${sessionId}|${harnessId}|${nowIso}`)}`,
                sessionId,
                harnessId,
                proposedAt: nowIso,
                refusalReason: ACTIVATION_REFUSAL_REASON,
        };
        return { state: { ...state, proposals: [...state.proposals, proposal] }, proposal };
}
