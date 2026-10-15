/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * DH-010 Harness console state machine tests (node --test, plain type
 * stripping; no vscode, no node: imports, no harness-kit imports - the
 * port contract's shapes only, imported type-only so they strip at
 * runtime). Deterministic by construction: frozen literal fixtures +
 * injected ISO strings. Every literal below mirrors the REAL frozen
 * vocabularies (the DH-01 industry/work-type lists, the DH-02 stages
 * and size bands) as observed values - the state machine treats them
 * as opaque observed strings, exactly as the port contract declares.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import {
        ACTIVATION_REFUSAL_REASON,
        type HarnessConsoleState,
        type SelectionSessionView,
        activeSession,
        applyHarnessList,
        applyNavigationLoad,
        applyRoleCompositions,
        applySessionResult,
        clearError,
        failOperation,
        initialHarnessState,
        recordProposal,
        selectHarness,
        selectRolesComposition,
        selectSession,
} from '../src/harnessState.ts';

const NOW = '2026-03-03T10:00:00.000Z';
const LATER = '2026-03-04T10:00:00.000Z';

const INDUSTRIES: readonly string[] = ['software', 'legal', 'finance'];
const SIZE_BANDS: readonly string[] = ['solo', 'small', 'medium', 'large', 'enterprise'];
const WORK_TYPES: readonly string[] = ['analysis', 'drafting', 'review', 'planning'];

/** One observed DH-02 session view, at the pre-selection 'industry' stage. */
function freshSession(sessionId: string): SelectionSessionView {
        return {
                sessionId,
                stage: 'industry',
                industry: undefined,
                companyDisplayName: undefined,
                companySizeBand: undefined,
                workTypes: [],
                roleKeys: [],
                proposedHarnessId: undefined,
                revision: 1,
        };
}

/** One observed DH-02 session view, fully walked to 'proposed'. */
function proposedSession(sessionId: string, harnessId: string): SelectionSessionView {
        return {
                sessionId,
                stage: 'proposed',
                industry: 'software',
                companyDisplayName: 'Acme Tools',
                companySizeBand: 'small',
                workTypes: ['analysis', 'review'],
                roleKeys: ['analyst', 'reviewer'],
                proposedHarnessId: harnessId,
                revision: 6,
        };
}

const HARNESS_A = 'flauz:hrn:0123456789abcdef';
const HARNESS_B = 'flauz:hrn:fedcba9876543210';

/** A frozen literal navigation model (the DH-010 view-model shape; type-only import strips at runtime). */
const NAVIGATION = {
        harnessId: HARNESS_A,
        contractVersion: '1.0.0',
        sections: [
                { section: 'overview', sectionState: 'composed', rows: [{ rowKey: 'overview-lifecycle', label: 'draft', detail: 'lifecycle state', badge: 'draft' }] },
                { section: 'roles', sectionState: 'not-composed', rows: [] },
                { section: 'workflows', sectionState: 'not-composed', rows: [] },
                { section: 'capabilities', sectionState: 'not-composed', rows: [] },
                { section: 'policies', sectionState: 'not-composed', rows: [] },
                { section: 'evidence', sectionState: 'not-composed', rows: [] },
                { section: 'kpis', sectionState: 'not-composed', rows: [] },
                { section: 'benchmarks', sectionState: 'not-composed', rows: [] },
                { section: 'lifecycle', sectionState: 'composed', rows: [{ rowKey: 'lifecycle-state-draft', label: 'draft', detail: 'current', badge: 'draft' }] },
        ],
} as const;

function baseline(): HarnessConsoleState {
        return initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES);
}

function driven(): HarnessConsoleState {
        let state = baseline();
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:1111111111111111') });
        state = applySessionResult(state, { ok: true, session: { ...freshSession('flauz:onb:1111111111111111'), stage: 'company', industry: 'software', revision: 2 } });
        return state;
}

test('initial state: the observed vocabularies carried, nothing begun, nothing inspected, nothing proposed', () => {
        const state = baseline();
        deepStrictEqual(state.industries, INDUSTRIES);
        deepStrictEqual(state.sizeBands, SIZE_BANDS);
        deepStrictEqual(state.workTypes, WORK_TYPES);
        deepStrictEqual(state.sessions, []);
        strictEqual(state.activeSessionId, undefined);
        deepStrictEqual(state.roleCompositions, []);
        strictEqual(state.selectedRolesSessionId, undefined);
        deepStrictEqual(state.harnesses, []);
        strictEqual(state.inspectedHarnessId, undefined);
        strictEqual(state.navigation, undefined);
        deepStrictEqual(state.proposals, []);
        strictEqual(state.error, undefined);
});

test('applySessionResult folds an ok result: the observed session recorded newest-last and made the driven one', () => {
        const state = applySessionResult(baseline(), { ok: true, session: freshSession('flauz:onb:1111111111111111') });
        strictEqual(state.sessions.length, 1);
        strictEqual(state.sessions[0].sessionId, 'flauz:onb:1111111111111111');
        strictEqual(state.activeSessionId, 'flauz:onb:1111111111111111');
});

test('applySessionResult refreshes a known session in place (the id-ordered list, newest-last by sort)', () => {
        let state = baseline();
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:1111111111111111') });
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:2222222222222222') });
        state = applySessionResult(state, { ok: true, session: { ...freshSession('flauz:onb:1111111111111111'), stage: 'company', industry: 'software', revision: 2 } });
        deepStrictEqual(state.sessions.map((session) => session.sessionId), ['flauz:onb:1111111111111111', 'flauz:onb:2222222222222222']);
        strictEqual(state.sessions[0].revision, 2);
});

test('applySessionResult refuses a typed refusal as the console error state (the observed reason and detail ride verbatim)', () => {
        const before = driven();
        const after = applySessionResult(before, { ok: false, reason: 'STAGE_ORDER', detail: 'selectIndustry: the industry walk refused' });
        strictEqual(after.error, 'STAGE_ORDER: selectIndustry: the industry walk refused');
});

test('THE RECORD-UNCHANGED LAW: a refused session op leaves every domain field unchanged', () => {
        const before = driven();
        const after = applySessionResult(before, { ok: false, reason: 'STAGE_ORDER', detail: 'refused' });
        deepStrictEqual(after.sessions, before.sessions);
        strictEqual(after.activeSessionId, before.activeSessionId);
        deepStrictEqual(after.roleCompositions, before.roleCompositions);
        deepStrictEqual(after.harnesses, before.harnesses);
        deepStrictEqual(after.proposals, before.proposals);
});

test('applyRoleCompositions folds the observed options and keeps a still-known selection', () => {
        let state = driven();
        state = applyRoleCompositions(state, { ok: true, options: [{ sessionId: 'flauz:rol:1111111111111111', industry: 'software', roleKeys: ['analyst'] }, { sessionId: 'flauz:rol:2222222222222222', industry: 'software', roleKeys: ['reviewer'] }] });
        state = { ...state, selectedRolesSessionId: 'flauz:rol:2222222222222222' };
        const refreshed = applyRoleCompositions(state, { ok: true, options: [{ sessionId: 'flauz:rol:2222222222222222', industry: 'software', roleKeys: ['reviewer'] }] });
        strictEqual(refreshed.selectedRolesSessionId, 'flauz:rol:2222222222222222');
});

test('applyRoleCompositions drops a selection that disappeared from the observed options', () => {
        let state = driven();
        state = applyRoleCompositions(state, { ok: true, options: [{ sessionId: 'flauz:rol:1111111111111111', industry: 'software', roleKeys: ['analyst'] }] });
        state = { ...state, selectedRolesSessionId: 'flauz:rol:1111111111111111' };
        const refreshed = applyRoleCompositions(state, { ok: true, options: [] });
        strictEqual(refreshed.selectedRolesSessionId, undefined);
});

test('applyRoleCompositions refuses a typed refusal as the console error state (record-unchanged)', () => {
        const before = driven();
        const after = applyRoleCompositions(before, { ok: false, reason: 'E_LEDGER_TORN', detail: 'loadRolesKit: the ledger is torn' });
        strictEqual(after.error, 'E_LEDGER_TORN: loadRolesKit: the ledger is torn');
        deepStrictEqual(after.sessions, before.sessions);
});

test('applyHarnessList folds the observed harnesses and keeps a still-known inspection', () => {
        let state = baseline();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'draft', industry: 'software', displayName: 'Acme Tools' }, { harnessId: HARNESS_B, state: 'active', industry: 'legal', displayName: 'Legal Desk' }] });
        strictEqual(state.harnesses.length, 2);
        state = { ...state, inspectedHarnessId: HARNESS_A, navigation: NAVIGATION };
        const refreshed = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'proposed', industry: 'software', displayName: 'Acme Tools' }] });
        strictEqual(refreshed.inspectedHarnessId, HARNESS_A);
        strictEqual(refreshed.navigation, NAVIGATION);
});

test('applyHarnessList drops the inspection (and the navigation) when the harness disappears from the ledger', () => {
        let state = baseline();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'draft', industry: 'software', displayName: 'Acme Tools' }] });
        state = { ...state, inspectedHarnessId: HARNESS_A, navigation: NAVIGATION };
        const refreshed = applyHarnessList(state, { ok: true, harnesses: [] });
        strictEqual(refreshed.inspectedHarnessId, undefined);
        strictEqual(refreshed.navigation, undefined);
});

test('applyHarnessList refuses a typed refusal as the console error state (record-unchanged)', () => {
        const before = baseline();
        const after = applyHarnessList(before, { ok: false, reason: 'E_ENVELOPE_MISMATCH', detail: 'loadHarnessKit: the envelope diverged' });
        strictEqual(after.error, 'E_ENVELOPE_MISMATCH: loadHarnessKit: the envelope diverged');
        deepStrictEqual(after.harnesses, before.harnesses);
});

test('applyNavigationLoad attaches the observed model to the inspected harness', () => {
        const state = applyNavigationLoad(baseline(), HARNESS_A, { ok: true, model: NAVIGATION });
        strictEqual(state.inspectedHarnessId, HARNESS_A);
        strictEqual(state.navigation, NAVIGATION);
});

test('applyNavigationLoad refuses a typed refusal as the console error state - never a partial model (record-unchanged)', () => {
        let state = baseline();
        state = applyNavigationLoad(state, HARNESS_A, { ok: true, model: NAVIGATION });
        const after = applyNavigationLoad(state, HARNESS_B, { ok: false, reason: 'NOT_FOUND', detail: 'inspectHarness: no harness with that id' });
        strictEqual(after.error, 'NOT_FOUND: inspectHarness: no harness with that id');
        strictEqual(after.inspectedHarnessId, HARNESS_A);
        strictEqual(after.navigation, NAVIGATION);
});

test('failOperation records the observed error and clearError clears it (the retry path)', () => {
        const clean = baseline();
        const failed = failOperation(clean, 'the port refused');
        strictEqual(failed.error, 'the port refused');
        const cleared = clearError(failed);
        strictEqual(cleared.error, undefined);
        deepStrictEqual(cleared, clean);
});

test('clearError on a clean state is a no-op (the same reference)', () => {
        const clean = baseline();
        strictEqual(clearError(clean), clean);
});

test('selectSession drives a known session; unknown ids are refused unchanged; the driven id is a no-op', () => {
        let state = baseline();
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:1111111111111111') });
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:2222222222222222') });
        const drivenA = selectSession(state, 'flauz:onb:1111111111111111');
        strictEqual(drivenA.activeSessionId, 'flauz:onb:1111111111111111');
        deepStrictEqual(selectSession(state, 'flauz:onb:9999999999999999'), state);
        deepStrictEqual(selectSession(drivenA, 'flauz:onb:1111111111111111'), drivenA);
});

test('selectRolesComposition selects a known option; unknown ids are refused unchanged; the same id is a no-op', () => {
        let state = driven();
        state = applyRoleCompositions(state, { ok: true, options: [{ sessionId: 'flauz:rol:1111111111111111', industry: 'software', roleKeys: ['analyst'] }, { sessionId: 'flauz:rol:2222222222222222', industry: 'software', roleKeys: ['reviewer'] }] });
        const selected = selectRolesComposition(state, 'flauz:rol:2222222222222222');
        strictEqual(selected.selectedRolesSessionId, 'flauz:rol:2222222222222222');
        deepStrictEqual(selectRolesComposition(state, 'flauz:rol:9999999999999999'), state);
        deepStrictEqual(selectRolesComposition(selected, 'flauz:rol:2222222222222222'), selected);
});

test('selectHarness inspects a known harness and DROPS the stale navigation model; unknown ids are refused unchanged', () => {
        let state = baseline();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'draft', industry: 'software', displayName: 'Acme Tools' }, { harnessId: HARNESS_B, state: 'active', industry: 'legal', displayName: 'Legal Desk' }] });
        state = applyNavigationLoad(state, HARNESS_A, { ok: true, model: NAVIGATION });
        const switched = selectHarness(state, HARNESS_B);
        strictEqual(switched.inspectedHarnessId, HARNESS_B);
        strictEqual(switched.navigation, undefined);
        deepStrictEqual(selectHarness(state, 'flauz:hrn:9999999999999999'), state);
});

test('activeSession returns the driven session and undefined before one begins', () => {
        strictEqual(activeSession(baseline()), undefined);
        const state = driven();
        const drivenOne = activeSession(state);
        ok(drivenOne);
        strictEqual(drivenOne.sessionId, 'flauz:onb:1111111111111111');
        strictEqual(drivenOne.stage, 'company');
});

test('recordProposal mints the deterministic proposal id and the refusal rides verbatim on EVERY record', () => {
        const { state, proposal } = recordProposal(driven(), 'flauz:onb:1111111111111111', HARNESS_A, NOW);
        ok(/^prop-[0-9a-f]{8}$/.test(proposal.proposalId));
        strictEqual(proposal.sessionId, 'flauz:onb:1111111111111111');
        strictEqual(proposal.harnessId, HARNESS_A);
        strictEqual(proposal.proposedAt, NOW);
        strictEqual(proposal.refusalReason, ACTIVATION_REFUSAL_REASON);
        strictEqual(state.proposals.length, 1);
});

test('recordProposal is deterministic in its inputs and accumulates newest-last', () => {
        const first = recordProposal(driven(), 'flauz:onb:1111111111111111', HARNESS_A, NOW);
        const second = recordProposal(first.state, 'flauz:onb:1111111111111111', HARNESS_A, NOW);
        strictEqual(second.proposal.proposalId, first.proposal.proposalId);
        strictEqual(second.state.proposals.length, 2);
        const other = recordProposal(driven(), 'flauz:onb:1111111111111111', HARNESS_A, LATER);
        ok(other.proposal.proposalId !== first.proposal.proposalId);
        const otherHarness = recordProposal(driven(), 'flauz:onb:1111111111111111', HARNESS_B, NOW);
        ok(otherHarness.proposal.proposalId !== first.proposal.proposalId);
});

test('the activation refusal names the DH-01 authority and the no-second-authority law', () => {
        ok(ACTIVATION_REFUSAL_REASON.includes('DH-01 harness authority'));
        ok(ACTIVATION_REFUSAL_REASON.includes('never becomes a second lifecycle authority'));
});

test('every transition is pure: the input state is never mutated (a frozen-state deep-copy proof)', () => {
        const state = driven();
        const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
        applySessionResult(state, { ok: true, session: freshSession('flauz:onb:3333333333333333') });
        applySessionResult(state, { ok: false, reason: 'X', detail: 'y' });
        applyRoleCompositions(state, { ok: false, reason: 'X', detail: 'y' });
        applyHarnessList(state, { ok: false, reason: 'X', detail: 'y' });
        applyNavigationLoad(state, HARNESS_B, { ok: false, reason: 'X', detail: 'y' });
        failOperation(state, 'x');
        clearError(state);
        selectSession(state, 'flauz:onb:2222222222222222');
        selectRolesComposition(state, 'flauz:rol:1111111111111111');
        selectHarness(state, 'flauz:hrn:9999999999999999');
        recordProposal(state, 'flauz:onb:1111111111111111', HARNESS_A, NOW);
        deepStrictEqual(JSON.parse(JSON.stringify(state)) as unknown, snapshot);
});

test('the vocabularies are observed values carried verbatim (the state machine never validates them - the port owns that)', () => {
        const state = initialHarnessState(['observed-a'], ['observed-b'], ['observed-c']);
        deepStrictEqual(state.industries, ['observed-a']);
        deepStrictEqual(state.sizeBands, ['observed-b']);
        deepStrictEqual(state.workTypes, ['observed-c']);
});

test('a refused op keeps the previous error until the explicit retry clears it (the error is observed state, never silently dropped)', () => {
        let state = driven();
        state = failOperation(state, 'first refusal');
        state = applySessionResult(state, { ok: true, session: freshSession('flauz:onb:2222222222222222') });
        strictEqual(state.error, 'first refusal');
        state = clearError(state);
        strictEqual(state.error, undefined);
});

test('failOperation overwrites a previous error (the LATEST observed failure rides the row)', () => {
        let state = failOperation(baseline(), 'first');
        state = failOperation(state, 'second');
        strictEqual(state.error, 'second');
});

test('applyRoleCompositions with zero options on a fresh state keeps the selection undefined', () => {
        const state = applyRoleCompositions(driven(), { ok: true, options: [] });
        strictEqual(state.selectedRolesSessionId, undefined);
        deepStrictEqual(state.roleCompositions, []);
});

test('applyHarnessList with zero harnesses on a fresh state clears nothing (nothing was inspected)', () => {
        const state = applyHarnessList(baseline(), { ok: true, harnesses: [] });
        strictEqual(state.inspectedHarnessId, undefined);
        strictEqual(state.navigation, undefined);
});

test('applyNavigationLoad attaches the SAME model object (no copy, no mutation - the derived value rides by reference)', () => {
        const state = applyNavigationLoad(baseline(), HARNESS_A, { ok: true, model: NAVIGATION });
        strictEqual(state.navigation, NAVIGATION);
});

test('selectHarness to the already-inspected id is a no-op (the navigation stays)', () => {
        let state = baseline();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'draft', industry: 'software', displayName: 'Acme Tools' }] });
        state = applyNavigationLoad(state, HARNESS_A, { ok: true, model: NAVIGATION });
        deepStrictEqual(selectHarness(state, HARNESS_A), state);
});

test('selectSession on an unknown id with zero sessions is refused unchanged', () => {
        deepStrictEqual(selectSession(baseline(), 'flauz:onb:1111111111111111'), baseline());
});

test('recordProposal touches NOTHING but the proposals list (the sessions, harnesses and navigation ride unchanged)', () => {
        const before = inspectedBaseline();
        const { state } = recordProposal(before, 'flauz:onb:1111111111111111', HARNESS_A, NOW);
        deepStrictEqual(state.sessions, before.sessions);
        deepStrictEqual(state.harnesses, before.harnesses);
        strictEqual(state.navigation, before.navigation);
        strictEqual(state.inspectedHarnessId, before.inspectedHarnessId);
});

/** A baseline carrying an inspected navigation (shared by the purity pins). */
function inspectedBaseline(): HarnessConsoleState {
        let state = driven();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: HARNESS_A, state: 'draft', industry: 'software', displayName: 'Acme Tools' }] });
        return applyNavigationLoad(state, HARNESS_A, { ok: true, model: NAVIGATION });
}
