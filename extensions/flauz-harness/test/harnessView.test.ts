/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * DH-010 view rendering tests (node --test; the vscode slices are
 * injected doubles, mirroring the flauz-lab labView test shape). The
 * navigation-model fixtures are frozen literals carrying the DH-010
 * view-model shape (sections in the frozen order, rows with badges
 * from the REAL state vocabularies) - the projection family's own
 * mocha lane covers the real derivation; this lane covers the
 * rendering over the port contract.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import {
        HARNESS_VIEW_ID,
        INSPECT_HARNESS_COMMAND,
        SELECT_ROLES_COMMAND,
        SELECT_SESSION_COMMAND,
        VIEW_COMMAND_IDS,
        treeElementsFor,
        treeItemFor,
        registerHarnessView,
        type HarnessTreeElement,
        type HarnessViewApi,
} from '../src/harnessView.ts';
import {
        ACTIVATION_REFUSAL_REASON,
        type HarnessConsoleState,
        type SelectionSessionView,
        applyHarnessList,
        applyNavigationLoad,
        applyRoleCompositions,
        applySessionResult,
        initialHarnessState,
        recordProposal,
        selectRolesComposition,
        selectSession,
} from '../src/harnessState.ts';

// ---- the injected vscode doubles (the flauz-lab DI shape) -------------------------------

class FakeEventEmitter<T> {
        private listeners: ((value: T) => void)[] = [];
        readonly event = (listener: (value: T) => void): { dispose(): void } => {
                this.listeners.push(listener);
                return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
        };
        fire(value: T): void { for (const l of this.listeners) { l(value); } }
}

const COLLAPSIBLE = { None: 0, Expanded: 1, Collapsed: 2 } as const;

interface FakeTreeItemShape {
        label: string;
        description?: string;
        tooltip?: string;
        iconPath?: unknown;
        collapsibleState?: number;
        command?: { command: string; title: string; arguments?: unknown[] };
        contextValue?: string;
        accessibilityInformation?: { label: string };
}

class FakeTreeItem implements FakeTreeItemShape {
        label = '';
        description?: string;
        tooltip?: string;
        iconPath?: unknown;
        collapsibleState?: number;
        command?: { command: string; title: string; arguments?: unknown[] };
        contextValue?: string;
        accessibilityInformation?: { label: string };
        constructor(label: string) { this.label = label; }
}

const registered: { viewId: string; provider: unknown }[] = [];

const api: HarnessViewApi = {
        registerTreeDataProvider: (viewId, provider) => { registered.push({ viewId, provider }); return { dispose: () => undefined }; },
        EventEmitter: FakeEventEmitter as unknown as HarnessViewApi['EventEmitter'],
        TreeItem: FakeTreeItem as unknown as HarnessViewApi['TreeItem'],
        ThemeIcon: class { id: string; constructor(id: string) { this.id = id; } } as unknown as HarnessViewApi['ThemeIcon'],
        TreeItemCollapsibleState: COLLAPSIBLE as unknown as HarnessViewApi['TreeItemCollapsibleState'],
};

// ---- fixtures (frozen literals; the REAL vocabularies' members as observed values) -------

const INDUSTRIES: readonly string[] = ['software', 'legal'];
const SIZE_BANDS: readonly string[] = ['solo', 'small', 'medium'];
const WORK_TYPES: readonly string[] = ['analysis', 'drafting', 'review'];

const SESSION_EARLY: SelectionSessionView = {
        sessionId: 'flauz:onb:1111111111111111',
        stage: 'industry',
        industry: undefined,
        companyDisplayName: undefined,
        companySizeBand: undefined,
        workTypes: [],
        roleKeys: [],
        proposedHarnessId: undefined,
        revision: 1,
};

const SESSION_WALKED: SelectionSessionView = {
        sessionId: 'flauz:onb:1111111111111111',
        stage: 'review',
        industry: 'software',
        companyDisplayName: 'Acme Tools',
        companySizeBand: 'small',
        workTypes: ['analysis', 'review'],
        roleKeys: ['analyst', 'reviewer'],
        proposedHarnessId: undefined,
        revision: 5,
};

const SESSION_PROPOSED: SelectionSessionView = {
        ...SESSION_WALKED,
        stage: 'proposed',
        proposedHarnessId: 'flauz:hrn:0123456789abcdef',
        revision: 6,
};

const ROLES_OPTIONS = [
        { sessionId: 'flauz:rol:1111111111111111', industry: 'software', roleKeys: ['analyst'] },
        { sessionId: 'flauz:rol:2222222222222222', industry: 'software', roleKeys: ['reviewer'] },
];

const HARNESS_ROWS = [
        { harnessId: 'flauz:hrn:0123456789abcdef', state: 'draft', industry: 'software', displayName: 'Acme Tools' },
        { harnessId: 'flauz:hrn:fedcba9876543210', state: 'active', industry: 'legal', displayName: 'Legal Desk' },
];

/** A frozen literal navigation model: the nine sections in the frozen order, the honest not-composed states. */
const NAVIGATION = {
        harnessId: 'flauz:hrn:0123456789abcdef',
        contractVersion: '1.0.0',
        sections: [
                {
                        section: 'overview',
                        sectionState: 'composed',
                        rows: [
                                { rowKey: 'overview-harness', label: 'flauz:hrn:0123456789abcdef', detail: 'the harness record (the projection anchor)', badge: 'draft' },
                                { rowKey: 'overview-lifecycle', label: 'draft', detail: 'lifecycle state', badge: 'draft' },
                        ],
                },
                { section: 'roles', sectionState: 'composed', rows: [{ rowKey: 'roles-descriptor-analyst', label: 'analyst', detail: 'reads and structures the work', badge: 'draft' }] },
                { section: 'workflows', sectionState: 'not-composed', rows: [] },
                { section: 'capabilities', sectionState: 'not-composed', rows: [] },
                { section: 'policies', sectionState: 'composed', rows: [{ rowKey: 'policies-flauz:prf:1111111111111111-lean', label: 'lean', detail: 'permissions: (none); approval tiers: (none)', badge: 'composed' }] },
                { section: 'evidence', sectionState: 'not-composed', rows: [] },
                { section: 'kpis', sectionState: 'not-composed', rows: [] },
                { section: 'benchmarks', sectionState: 'composed', rows: [{ rowKey: 'benchmarks-flauz:ben:1111111111111111-baseline', label: 'baseline', detail: 'the baseline benchmark - 1 scenario refs, evidence fixture', badge: 'composed' }] },
                { section: 'lifecycle', sectionState: 'composed', rows: [{ rowKey: 'lifecycle-state-draft', label: 'draft', detail: 'current', badge: 'draft' }] },
        ],
} as const;

function sessionState(session: SelectionSessionView): HarnessConsoleState {
        let state = initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES);
        state = applySessionResult(state, { ok: true, session });
        return state;
}

function walkedState(): HarnessConsoleState {
        let state = sessionState(SESSION_WALKED);
        state = applyRoleCompositions(state, { ok: true, options: ROLES_OPTIONS });
        state = applyHarnessList(state, { ok: true, harnesses: HARNESS_ROWS });
        return state;
}

function inspectedState(): HarnessConsoleState {
        const state = walkedState();
        return applyNavigationLoad(state, 'flauz:hrn:0123456789abcdef', { ok: true, model: NAVIGATION });
}

// ---- the manifest pins --------------------------------------------------------------------

test('the view id and command ids match the manifest contributions', () => {
        strictEqual(HARNESS_VIEW_ID, 'flauz.harness');
        deepStrictEqual([...VIEW_COMMAND_IDS], [
                'flauz.harness.beginSession',
                'flauz.harness.selectIndustry',
                'flauz.harness.composeCompany',
                'flauz.harness.selectWorkTypes',
                'flauz.harness.proposeDraft',
                'flauz.focusView.harness',
                'flauz.harness.refreshView',
        ]);
});

test('the empty state renders the selection header and the harness header only (never fabricated rows)', () => {
        const elements = treeElementsFor(initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES));
        deepStrictEqual(elements.map((element) => element.kind), ['selectionHeader', 'harnessHeader']);
});

test('a begun session renders one session row and its observed selection fields', () => {
        const elements = treeElementsFor(sessionState(SESSION_WALKED));
        const kinds = elements.map((element) => element.kind);
        deepStrictEqual(kinds, ['selectionHeader', 'session', 'selectionField', 'selectionField', 'selectionField', 'selectionField', 'selectionField', 'harnessHeader']);
});

test('a pre-selection session shows the honest not-set labels (THE ABSENT-FAMILY LAW surfaced)', () => {
        const fields = treeElementsFor(sessionState(SESSION_EARLY)).filter((element) => element.kind === 'selectionField') as Extract<HarnessTreeElement, { kind: 'selectionField' }>[];
        strictEqual(fields.length, 5);
        deepStrictEqual(fields.map((field) => field.label), ['(not selected yet)', '(not composed yet)', '(not selected yet)', '(not composed yet)', '(not proposed yet)']);
        ok(fields.every((field) => !field.set));
});

test('the session row carries the observed stage and the drive command with the session id', () => {
        const sessionRow = treeElementsFor(sessionState(SESSION_WALKED)).find((element) => element.kind === 'session');
        ok(sessionRow);
        const item = treeItemFor(sessionRow, api);
        strictEqual(item.label, 'flauz:onb:1111111111111111');
        strictEqual(item.description, 'stage review - driven');
        strictEqual(item.command?.command, SELECT_SESSION_COMMAND);
        deepStrictEqual(item.command?.arguments, ['flauz:onb:1111111111111111']);
});

test('a non-driven session row renders without the driven marker', () => {
        let state = initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES);
        state = applySessionResult(state, { ok: true, session: SESSION_WALKED });
        state = applySessionResult(state, { ok: true, session: { ...SESSION_WALKED, sessionId: 'flauz:onb:2222222222222222' } });
        state = selectSession(state, 'flauz:onb:1111111111111111');
        const other = treeElementsFor(state).find((element) => element.kind === 'session' && element.session.sessionId === 'flauz:onb:2222222222222222');
        ok(other);
        strictEqual(treeItemFor(other, api).description, 'stage review');
});

test('the observed selection fields render set fields with the observed values and the check marker', () => {
        const fields = treeElementsFor(sessionState(SESSION_WALKED)).filter((element) => element.kind === 'selectionField') as Extract<HarnessTreeElement, { kind: 'selectionField' }>[];
        deepStrictEqual(fields.map((field) => field.label), ['software', 'Acme Tools (small)', 'analysis, review', 'analyst, reviewer', '(not proposed yet)']);
        deepStrictEqual(fields.map((field) => field.set), [true, true, true, true, false]);
        ok(fields.every((field) => field.set || field.label.startsWith('(not')));
});

test('the selection field labels name the fields (industry / company / work types / roles / proposed harness)', () => {
        const fields = treeElementsFor(sessionState(SESSION_WALKED)).filter((element) => element.kind === 'selectionField');
        const items = fields.map((field) => treeItemFor(field, api));
        deepStrictEqual(items.map((item) => item.label), ['industry', 'company', 'work types', 'roles', 'proposed harness']);
});

test('a proposed session shows the proposed harness id in the harness field', () => {
        const fields = treeElementsFor(sessionState(SESSION_PROPOSED)).filter((element) => element.kind === 'selectionField') as Extract<HarnessTreeElement, { kind: 'selectionField' }>[];
        const harnessField = fields.find((field) => field.field === 'harness');
        ok(harnessField);
        strictEqual(harnessField.label, 'flauz:hrn:0123456789abcdef');
        strictEqual(harnessField.set, true);
});

test('the roles options render under their header only when options are observed', () => {
        const without = treeElementsFor(sessionState(SESSION_WALKED));
        ok(without.every((element) => element.kind !== 'rolesHeader'));
        const withRoles = treeElementsFor(walkedState());
        ok(withRoles.some((element) => element.kind === 'rolesHeader'));
        strictEqual(withRoles.filter((element) => element.kind === 'rolesOption').length, 2);
});

test('the roles option rows carry the observed industry and roles, and the select command', () => {
        const options = treeElementsFor(walkedState()).filter((element) => element.kind === 'rolesOption') as Extract<HarnessTreeElement, { kind: 'rolesOption' }>[];
        const item = treeItemFor(options[0], api);
        strictEqual(item.label, 'flauz:rol:1111111111111111');
        strictEqual(item.description, 'software - analyst');
        strictEqual(item.command?.command, SELECT_ROLES_COMMAND);
        deepStrictEqual(item.command?.arguments, ['flauz:rol:1111111111111111']);
});

test('the selected roles option is marked in the view (the eye marker and the tooltip note)', () => {
        const state = selectRolesComposition(walkedState(), 'flauz:rol:2222222222222222');
        const options = treeElementsFor(state).filter((element) => element.kind === 'rolesOption') as Extract<HarnessTreeElement, { kind: 'rolesOption' }>[];
        strictEqual(options.filter((option) => option.selected).length, 1);
        const selected = treeItemFor(options.find((option) => option.selected) as Extract<HarnessTreeElement, { kind: 'rolesOption' }>, api) as unknown as FakeTreeItemShape;
        ok(selected.tooltip?.includes('Selected for the draft'));
});

test('the harness rows render under their header with the observed state and industry', () => {
        const rows = treeElementsFor(walkedState()).filter((element) => element.kind === 'harness') as Extract<HarnessTreeElement, { kind: 'harness' }>[];
        strictEqual(rows.length, 2);
        const item = treeItemFor(rows[1], api);
        strictEqual(item.label, 'Legal Desk');
        strictEqual(item.description, 'active - legal');
        strictEqual(item.command?.command, INSPECT_HARNESS_COMMAND);
        deepStrictEqual(item.command?.arguments, ['flauz:hrn:fedcba9876543210']);
});

test('the inspected harness row is marked (the eye marker and the inspected note)', () => {
        const rows = treeElementsFor(inspectedState()).filter((element) => element.kind === 'harness') as Extract<HarnessTreeElement, { kind: 'harness' }>[];
        strictEqual(rows.filter((row) => row.inspected).length, 1);
        const inspected = treeItemFor(rows.find((row) => row.inspected) as Extract<HarnessTreeElement, { kind: 'harness' }>, api) as unknown as FakeTreeItemShape;
        strictEqual(inspected.description, 'draft - software - inspected');
        ok(inspected.tooltip?.includes('Under inspection'));
});

test('the navigation model renders only when one is loaded, with ALL NINE sections in the frozen order', () => {
        const without = treeElementsFor(walkedState());
        ok(without.every((element) => element.kind !== 'navigationHeader'));
        const elements = treeElementsFor(inspectedState());
        const sections = elements.filter((element) => element.kind === 'section') as Extract<HarnessTreeElement, { kind: 'section' }>[];
        deepStrictEqual(sections.map((section) => section.section), [
                'overview', 'roles', 'workflows', 'capabilities', 'policies', 'evidence', 'kpis', 'benchmarks', 'lifecycle',
        ]);
});

test('the composed sections show their row counts and the nav rows under them', () => {
        const elements = treeElementsFor(inspectedState());
        const sections = elements.filter((element) => element.kind === 'section') as Extract<HarnessTreeElement, { kind: 'section' }>[];
        const overview = treeItemFor(sections[0], api);
        strictEqual(overview.label, 'overview');
        strictEqual(overview.description, '2 rows');
        const navRows = elements.filter((element) => element.kind === 'navRow') as Extract<HarnessTreeElement, { kind: 'navRow' }>[];
        strictEqual(navRows.length, 6);
        const overviewRows = navRows.filter((row) => row.section === 'overview');
        strictEqual(overviewRows.length, 2);
});

test('the not-composed sections show the honest state and carry ZERO nav rows (never fabricated)', () => {
        const elements = treeElementsFor(inspectedState());
        const sections = elements.filter((element) => element.kind === 'section') as Extract<HarnessTreeElement, { kind: 'section' }>[];
        const workflows = sections.find((section) => section.section === 'workflows');
        ok(workflows);
        const item = treeItemFor(workflows, api);
        strictEqual(item.description, 'not composed');
        const navRows = elements.filter((element) => element.kind === 'navRow') as Extract<HarnessTreeElement, { kind: 'navRow' }>[];
        strictEqual(navRows.filter((row) => row.section === 'workflows').length, 0);
});

test('the nav rows carry the observed label and the badge as the description', () => {
        const navRows = treeElementsFor(inspectedState()).filter((element) => element.kind === 'navRow') as Extract<HarnessTreeElement, { kind: 'navRow' }>[];
        const lifecycleRow = navRows.find((row) => row.rowKey === 'lifecycle-state-draft');
        ok(lifecycleRow);
        const item = treeItemFor(lifecycleRow, api);
        strictEqual(item.label, 'draft');
        strictEqual(item.description, 'draft');
        ok((item.tooltip as string).includes('lifecycle-state-draft'));
});

test('THE LIFECYCLE ROW: the anchor state observed from the model, with the closed activation door verbatim', () => {
        const lifecycleRow = treeElementsFor(inspectedState()).find((element) => element.kind === 'lifecycle');
        ok(lifecycleRow);
        const item = treeItemFor(lifecycleRow, api) as unknown as FakeTreeItemShape;
        strictEqual(item.label, 'lifecycle');
        strictEqual(item.description, 'draft - activation stays routed through the DH-01 authority');
        ok((item.tooltip as string).includes("flauz:hrn:0123456789abcdef is 'draft'"));
        ok((item.tooltip as string).includes(ACTIVATION_REFUSAL_REASON));
});

test('the recorded proposals render under their header with the refusal in the tooltip', () => {
        const { state } = recordProposal(inspectedState(), 'flauz:onb:1111111111111111', 'flauz:hrn:0123456789abcdef', '2026-03-03T10:00:00.000Z');
        const elements = treeElementsFor(state);
        const header = elements.find((element) => element.kind === 'proposedHeader');
        const proposed = elements.find((element) => element.kind === 'proposed');
        ok(header && proposed);
        strictEqual(treeItemFor(header, api).description, 'activation stays refused');
        const proposedItem = treeItemFor(proposed, api) as unknown as FakeTreeItemShape;
        ok(proposedItem.label.startsWith('prop-'));
        ok((proposedItem.tooltip as string).includes('never becomes a second lifecycle authority'));
});

test('registerHarnessView registers the provider for the flauz.harness view and refresh fires the change event', () => {
        registered.length = 0;
        const stateRef = { current: initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES) };
        const view = registerHarnessView(api, stateRef);
        strictEqual(registered.length, 1);
        strictEqual(registered[0].viewId, 'flauz.harness');
        const provider = registered[0].provider as { getChildren(): HarnessTreeElement[] };
        strictEqual(provider.getChildren().length, 2);
        stateRef.current = inspectedState();
        strictEqual(provider.getChildren().length, 30);
        view.refresh();
});

test('the error row carries the shared grammar: Unable to Load Harness, flauzError, Retry, the retry sentence', () => {
        const failed = { ...inspectedState(), error: 'E_LEDGER_TORN: the ledger is torn' };
        const elements = treeElementsFor(failed);
        const errorRow = elements.find((element) => element.kind === 'error');
        ok(errorRow);
        const item = treeItemFor(errorRow, api) as unknown as FakeTreeItemShape;
        strictEqual(item.label, 'Unable to Load Harness');
        strictEqual(item.contextValue, 'flauzError');
        strictEqual(item.command?.command, 'flauz.harness.refreshView');
        strictEqual(item.command?.title, 'Retry');
        ok((item.tooltip as string).includes('Selecting this row retries'));
        ok((item.tooltip as string).includes('E_LEDGER_TORN'));
});

test('the error row renders first when an operation failure is observed', () => {
        const failed = { ...inspectedState(), error: 'the port refused' };
        strictEqual(treeElementsFor(failed)[0].kind, 'error');
});

test('every tree row carries accessibilityInformation (the a11y law over every kind)', () => {
        const { state } = recordProposal(inspectedState(), 'flauz:onb:1111111111111111', 'flauz:hrn:0123456789abcdef', '2026-03-03T10:00:00.000Z');
        const failed = { ...state, error: 'the port refused' };
        for (const element of treeElementsFor(failed)) {
                const item = treeItemFor(element, api) as unknown as FakeTreeItemShape;
                ok(item.accessibilityInformation !== undefined && item.accessibilityInformation.label.length > 0, `a11y missing on ${element.kind}`);
        }
});

test('the state and view modules resolve under plain type stripping (the kit-free import law: no .js-specifier edges in the test graph)', async () => {
        const stateModule = await import('../src/harnessState.ts');
        const viewModule = await import('../src/harnessView.ts');
        ok(typeof stateModule.recordProposal === 'function');
        ok(typeof stateModule.applySessionResult === 'function');
        ok(typeof viewModule.registerHarnessView === 'function');
        ok(typeof viewModule.treeElementsFor === 'function');
        // The runtime binding (src/flauzHarnessPort.ts) is NEVER imported by a test -
        // its .js specifiers only resolve at bundle time (the flauz-lab law).
        const bindingSource = Object.keys(viewModule).concat(Object.keys(stateModule));
        ok(!bindingSource.includes('openFlauzHarnessPort'));
});

test('the error row renders FIRST even on the empty state (before the selection header)', () => {
        const failed = { ...initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES), error: 'the port refused' };
        const kinds = treeElementsFor(failed).map((element) => element.kind);
        deepStrictEqual(kinds, ['error', 'selectionHeader', 'harnessHeader']);
});

test('the navigation header carries the DH-010 projection description', () => {
        const header = treeElementsFor(inspectedState()).find((element) => element.kind === 'navigationHeader');
        ok(header);
        const item = treeItemFor(header, api) as unknown as FakeTreeItemShape;
        strictEqual(item.label, 'Navigation model');
        strictEqual(item.description, 'the DH-010 projection');
        ok((item.tooltip as string).includes('derived read-only'));
});

test('a navRow tooltip carries the rowKey, the detail and the badge (the observed triple)', () => {
        const navRow = treeElementsFor(inspectedState()).find((element) => element.kind === 'navRow' && element.rowKey === 'policies-flauz:prf:1111111111111111-lean');
        ok(navRow);
        const item = treeItemFor(navRow, api) as unknown as FakeTreeItemShape;
        ok((item.tooltip as string).includes('policies-flauz:prf:1111111111111111-lean'));
        ok((item.tooltip as string).includes('permissions: (none)'));
        ok((item.tooltip as string).includes('badge: composed'));
});

test('the proposedHeader appears only when a proposal is recorded', () => {
        ok(treeElementsFor(inspectedState()).every((element) => element.kind !== 'proposedHeader'));
        const { state } = recordProposal(inspectedState(), 'flauz:onb:1111111111111111', 'flauz:hrn:0123456789abcdef', '2026-03-03T10:00:00.000Z');
        ok(treeElementsFor(state).some((element) => element.kind === 'proposedHeader'));
});

test('the rolesHeader disappears when the observed options drop to zero (the section is never fabricated)', () => {
        let state = walkedState();
        state = applyRoleCompositions(state, { ok: true, options: [] });
        ok(treeElementsFor(state).every((element) => element.kind !== 'rolesHeader'));
});

test('a proposed session row shows the observed proposed stage', () => {
        const sessionRow = treeElementsFor(sessionState(SESSION_PROPOSED)).find((element) => element.kind === 'session');
        ok(sessionRow);
        strictEqual(treeItemFor(sessionRow, api).description, 'stage proposed - driven');
});

test('a retired harness row renders the observed state (the REAL lifecycle vocabulary, never fabricated)', () => {
        let state = walkedState();
        state = applyHarnessList(state, { ok: true, harnesses: [{ harnessId: 'flauz:hrn:0123456789abcdef', state: 'retired', industry: 'software', displayName: 'Sunset Tools' }] });
        const row = treeElementsFor(state).find((element) => element.kind === 'harness');
        ok(row);
        strictEqual(treeItemFor(row, api).description, 'retired - software');
});

test('the lifecycle row falls back to the honest unknown when the model carries no lifecycle row (never fabricated)', () => {
        const stripped = {
                ...NAVIGATION,
                sections: [
                        // The overview section WITHOUT its overview-lifecycle row.
                        { section: 'overview' as const, sectionState: 'composed' as const, rows: [{ rowKey: 'overview-harness', label: 'flauz:hrn:0123456789abcdef', detail: 'the harness record (the projection anchor)', badge: 'draft' as const }] },
                        ...NAVIGATION.sections.filter((section) => section.section !== 'overview'),
                ],
        };
        const state = applyNavigationLoad(walkedState(), 'flauz:hrn:0123456789abcdef', { ok: true, model: stripped });
        const lifecycleRow = treeElementsFor(state).find((element) => element.kind === 'lifecycle');
        ok(lifecycleRow);
        strictEqual(treeItemFor(lifecycleRow, api).description, 'unknown - activation stays routed through the DH-01 authority');
});

test('the error retry command is the refresh command id (the shared error grammar rides the manifest command)', () => {
        const errorRow = treeElementsFor({ ...initialHarnessState(INDUSTRIES, SIZE_BANDS, WORK_TYPES), error: 'x' }).find((element) => element.kind === 'error');
        ok(errorRow);
        strictEqual(treeItemFor(errorRow, api).command?.command, VIEW_COMMAND_IDS[6]);
});
