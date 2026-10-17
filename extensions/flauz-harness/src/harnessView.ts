/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DH-010 - the `flauz.harness` tree view (container `flauz`, owned by
 * flauz-workspace): the SELECTION section (the onboarding session's
 * observed industry / company / work-types / roles state plus the
 * composed DH-03 roles options the draft composes from), the
 * workspace's HARNESS rows (the inspection targets), the NAVIGATION
 * model (the DH-010 projected sections with their rows / badges),
 * the LIFECYCLE row (the closed activation door), the recorded
 * proposals with their activation-refusal notes, and the observed
 * refresh-failure row ('Unable to Load Harness', contextValue
 * 'flauzError', the Retry-titled row command - the shared error
 * grammar).
 *
 * DI shape mirrors extensions/flauz-lab/src/labView.ts (and the
 * flauz-agent sessionsView before it): the module takes the vscode
 * slices it needs as parameters so tests run under plain
 * `node --test` without the editor. Node-free: no node: imports
 * anywhere. Every row carries accessibilityInformation (premium spec
 * sections 4/6). Every row is observed state from the real
 * kits/projections - never fabricated.
 */

import type * as vscode from 'vscode';
import type { DomainNavigationModel, RoleCompositionOption, SelectionSessionView } from './harnessPort.ts';
import {
        ACTIVATION_REFUSAL_REASON,
        type HarnessConsoleState,
        activeSession,
} from './harnessState.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const HARNESS_VIEW_ID = 'flauz.harness';

/** Commands contributed for the view (see package.json; focus follows the flauz.focusView.<view> law). */
export const VIEW_COMMAND_IDS = [
        'flauz.harness.beginSession',
        'flauz.harness.selectIndustry',
        'flauz.harness.composeCompany',
        'flauz.harness.selectWorkTypes',
        'flauz.harness.proposeDraft',
        'flauz.focusView.harness',
        'flauz.harness.refreshView',
] as const;

/** Row-internal commands (invoked by tree rows; registered by extension.ts, never in package.json). */
export const SELECT_SESSION_COMMAND = 'flauz.harness.selectSession';
export const SELECT_ROLES_COMMAND = 'flauz.harness.selectRoles';
export const INSPECT_HARNESS_COMMAND = 'flauz.harness.inspectHarness';

/** The retry command the error row carries (the refresh command re-used as Retry). */
export const ERROR_RETRY_COMMAND = 'flauz.harness.refreshView';

/** Tree element union: the error row, the selection section, the harness rows, the navigation model, the lifecycle row, the proposals. */
export type HarnessTreeElement =
        | { readonly kind: 'error'; readonly message: string }
        | { readonly kind: 'selectionHeader' }
        | { readonly kind: 'session'; readonly session: SelectionSessionView; readonly active: boolean }
        | { readonly kind: 'selectionField'; readonly field: 'industry' | 'company' | 'work-types' | 'roles' | 'harness'; readonly label: string; readonly detail: string; readonly set: boolean }
        | { readonly kind: 'rolesHeader' }
        | { readonly kind: 'rolesOption'; readonly option: RoleCompositionOption; readonly selected: boolean }
        | { readonly kind: 'harnessHeader' }
        | { readonly kind: 'harness'; readonly harnessId: string; readonly state: string; readonly industry: string; readonly displayName: string; readonly inspected: boolean }
        | { readonly kind: 'navigationHeader' }
        | { readonly kind: 'section'; readonly section: string; readonly sectionState: string; readonly rowCount: number }
        | { readonly kind: 'navRow'; readonly section: string; readonly rowKey: string; readonly label: string; readonly detail: string; readonly badge: string }
        | { readonly kind: 'lifecycle'; readonly state: string; readonly harnessId: string }
        | { readonly kind: 'proposedHeader' }
        | { readonly kind: 'proposed'; readonly proposalId: string; readonly harnessId: string; readonly proposedAt: string; readonly refusal: string };

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface HarnessViewApi {
        registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<HarnessTreeElement>): vscode.Disposable;
        EventEmitter: new <T>() => vscode.EventEmitter<T>;
        TreeItem: typeof vscode.TreeItem;
        ThemeIcon: typeof vscode.ThemeIcon;
        TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

/** Map a console state to the tree elements the view shows (error first, selection, harnesses, navigation, lifecycle, proposals). */
export function treeElementsFor(state: HarnessConsoleState): HarnessTreeElement[] {
        const elements: HarnessTreeElement[] = [];
        if (state.error !== undefined) {
                elements.push({ kind: 'error', message: state.error });
        }
        // THE SELECTION SECTION: the observed sessions and the active one's selection state.
        elements.push({ kind: 'selectionHeader' });
        for (const session of state.sessions) {
                elements.push({ kind: 'session', session, active: session.sessionId === state.activeSessionId });
        }
        const driven = activeSession(state);
        if (driven) {
                elements.push({ kind: 'selectionField', field: 'industry', label: driven.industry ?? '(not selected yet)', detail: 'the session\'s selected industry', set: driven.industry !== undefined });
                elements.push({
                        kind: 'selectionField',
                        field: 'company',
                        label: driven.companyDisplayName !== undefined ? `${driven.companyDisplayName} (${driven.companySizeBand})` : '(not composed yet)',
                        detail: 'the session\'s company profile',
                        set: driven.companyDisplayName !== undefined,
                });
                elements.push({ kind: 'selectionField', field: 'work-types', label: driven.workTypes.length > 0 ? driven.workTypes.join(', ') : '(not selected yet)', detail: 'the session\'s selected work types', set: driven.workTypes.length > 0 });
                elements.push({ kind: 'selectionField', field: 'roles', label: driven.roleKeys.length > 0 ? driven.roleKeys.join(', ') : '(not composed yet)', detail: 'the review composition\'s roles', set: driven.roleKeys.length > 0 });
                elements.push({ kind: 'selectionField', field: 'harness', label: driven.proposedHarnessId ?? '(not proposed yet)', detail: 'the session\'s proposed harness', set: driven.proposedHarnessId !== undefined });
        }
        // The composed DH-03 roles options (the draft's composition menu).
        if (state.roleCompositions.length > 0) {
                elements.push({ kind: 'rolesHeader' });
                for (const option of state.roleCompositions) {
                        elements.push({ kind: 'rolesOption', option, selected: option.sessionId === state.selectedRolesSessionId });
                }
        }
        // The workspace's harnesses (the inspection targets).
        elements.push({ kind: 'harnessHeader' });
        for (const row of state.harnesses) {
                elements.push({ kind: 'harness', harnessId: row.harnessId, state: row.state, industry: row.industry, displayName: row.displayName, inspected: row.harnessId === state.inspectedHarnessId });
        }
        // THE NAVIGATION MODEL: the projected sections with their rows/badges.
        const navigation = state.navigation;
        if (navigation) {
                elements.push({ kind: 'navigationHeader' });
                for (const section of navigation.sections) {
                        elements.push({ kind: 'section', section: section.section, sectionState: section.sectionState, rowCount: section.rows.length });
                        for (const row of section.rows) {
                                elements.push({ kind: 'navRow', section: section.section, rowKey: row.rowKey, label: row.label, detail: row.detail, badge: row.badge });
                        }
                }
                // THE LIFECYCLE ROW: the anchor's REAL lifecycle state with the closed activation door.
                elements.push({ kind: 'lifecycle', state: lifecycleStateOf(navigation), harnessId: navigation.harnessId });
        }
        // The recorded proposals (the proposed-draft state) with the refusal riding verbatim.
        if (state.proposals.length > 0) {
                elements.push({ kind: 'proposedHeader' });
                for (const proposal of state.proposals) {
                        elements.push({ kind: 'proposed', proposalId: proposal.proposalId, harnessId: proposal.harnessId, proposedAt: proposal.proposedAt, refusal: proposal.refusalReason });
                }
        }
        return elements;
}

/** The anchor's REAL lifecycle state, observed from the navigation model's overview section. */
function lifecycleStateOf(navigation: DomainNavigationModel): string {
        const overview = navigation.sections.find((section) => section.section === 'overview');
        const stateRow = overview?.rows.find((row) => row.rowKey === 'overview-lifecycle');
        return stateRow?.label ?? 'unknown';
}

/** Render one tree element as a vscode TreeItem (label/description/tooltip/icon/command/a11y). */
export function treeItemFor(element: HarnessTreeElement, api: HarnessViewApi): vscode.TreeItem {
        const item = new api.TreeItem('');
        switch (element.kind) {
                case 'error': {
                        // The shared error grammar: Unable to Load <Surface>, contextValue
                        // 'flauzError', a Retry-titled row command, the retry sentence.
                        item.label = 'Unable to Load Harness';
                        item.description = 'the last operation failed';
                        item.tooltip = `${element.message}\n\nSelecting this row retries the console refresh.`;
                        item.iconPath = new api.ThemeIcon('error');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.contextValue = 'flauzError';
                        item.command = { command: ERROR_RETRY_COMMAND, title: 'Retry' };
                        item.accessibilityInformation = { label: `Unable to load the Flauz Harness state: ${element.message}. Select to retry.` };
                        break;
                }
                case 'selectionHeader': {
                        item.label = 'Selection session';
                        item.description = 'the DH-02 onboarding walk';
                        item.tooltip = 'The onboarding selection session: industry, company, work types, roles and the proposed harness - observed through the real DH-02 kit.';
                        item.iconPath = new api.ThemeIcon('account');
                        item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
                        item.accessibilityInformation = { label: 'Selection session. Select an industry, compose the company, select the work types and propose the draft through the real onboarding kit.' };
                        break;
                }
                case 'session': {
                        item.label = element.session.sessionId;
                        item.description = element.active ? `stage ${element.session.stage} - driven` : `stage ${element.session.stage}`;
                        item.tooltip = `Onboarding session ${element.session.sessionId} at stage ${element.session.stage} (revision ${element.session.revision})${element.active ? ' - the driven session.' : ''}`;
                        item.iconPath = new api.ThemeIcon(element.active ? 'play-circle' : 'circle-outline');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.command = { command: SELECT_SESSION_COMMAND, title: 'Drive Session', arguments: [element.session.sessionId] };
                        item.accessibilityInformation = { label: `Session ${element.session.sessionId}, stage ${element.session.stage}${element.active ? ', the driven session' : ''}. Select to drive it.` };
                        break;
                }
                case 'selectionField': {
                        item.label = element.field === 'work-types' ? 'work types' : element.field === 'harness' ? 'proposed harness' : element.field;
                        item.description = element.label;
                        item.tooltip = `${element.detail}: ${element.label}`;
                        item.iconPath = new api.ThemeIcon(element.set ? 'check' : 'circle-dotted');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.accessibilityInformation = { label: `${element.field}: ${element.label}${element.set ? '' : ', not set yet'}.` };
                        break;
                }
                case 'rolesHeader': {
                        item.label = 'Role compositions';
                        item.description = 'the composed DH-03 sessions';
                        item.tooltip = 'The workspace\'s composed role-composition sessions - the draft composes its review composition from the selected one through the real DH-03 emit.';
                        item.iconPath = new api.ThemeIcon('people');
                        item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
                        item.accessibilityInformation = { label: 'Role compositions. Select one to compose the draft from its roles.' };
                        break;
                }
                case 'rolesOption': {
                        item.label = element.option.sessionId;
                        item.description = `${element.option.industry} - ${element.option.roleKeys.join(', ')}`;
                        item.tooltip = `Role composition ${element.option.sessionId} (industry ${element.option.industry}): ${element.option.roleKeys.join(', ')}${element.selected ? '\nSelected for the draft.' : ''}`;
                        item.iconPath = new api.ThemeIcon(element.selected ? 'eye' : 'circle-filled');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.command = { command: SELECT_ROLES_COMMAND, title: 'Select Role Composition', arguments: [element.option.sessionId] };
                        item.accessibilityInformation = { label: `Role composition ${element.option.sessionId} for ${element.option.industry}, roles ${element.option.roleKeys.join(', ')}. Select to compose the draft from it.` };
                        break;
                }
                case 'harnessHeader': {
                        item.label = 'Harnesses';
                        item.description = 'the DH-01 records';
                        item.tooltip = 'The workspace\'s harness records, observed from the real DH-01 ledger. Select one to inspect its navigation model.';
                        item.iconPath = new api.ThemeIcon('library');
                        item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
                        item.accessibilityInformation = { label: 'Harnesses. Select one to inspect its navigation model.' };
                        break;
                }
                case 'harness': {
                        item.label = element.displayName;
                        item.description = `${element.state} - ${element.industry}${element.inspected ? ' - inspected' : ''}`;
                        item.tooltip = `Harness ${element.harnessId} - ${element.displayName} (${element.industry}, state ${element.state})${element.inspected ? '\nUnder inspection.' : ''}`;
                        item.iconPath = new api.ThemeIcon(element.inspected ? 'eye' : 'circle-outline');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.command = { command: INSPECT_HARNESS_COMMAND, title: 'Inspect Harness', arguments: [element.harnessId] };
                        item.accessibilityInformation = { label: `Harness ${element.displayName}, ${element.industry}, state ${element.state}. Select to inspect its navigation model.` };
                        break;
                }
                case 'navigationHeader': {
                        item.label = 'Navigation model';
                        item.description = 'the DH-010 projection';
                        item.tooltip = 'The inspected harness\'s projected navigation model - derived read-only from the caller-supplied composed records (the DH-010 projections family).';
                        item.iconPath = new api.ThemeIcon('symbol-structure');
                        item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
                        item.accessibilityInformation = { label: 'Navigation model. The projected sections with their rows and badges.' };
                        break;
                }
                case 'section': {
                        item.label = element.section;
                        item.description = element.sectionState === 'composed' ? `${element.rowCount} rows` : 'not composed';
                        item.tooltip = `The '${element.section}' section - ${element.sectionState}${element.sectionState === 'composed' ? ` (${element.rowCount} derived rows)` : ' (the family has no composed content yet; rows are never fabricated)'}.`;
                        item.iconPath = new api.ThemeIcon(element.sectionState === 'composed' ? 'folder-opened' : 'folder');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.accessibilityInformation = { label: `Section ${element.section}, ${element.sectionState}${element.sectionState === 'composed' ? `, ${element.rowCount} rows` : ''}.` };
                        break;
                }
                case 'navRow': {
                        item.label = element.label;
                        item.description = element.badge;
                        item.tooltip = `${element.rowKey}: ${element.detail} (badge: ${element.badge})`;
                        item.iconPath = new api.ThemeIcon('dash');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.accessibilityInformation = { label: `${element.label}, ${element.detail}, ${element.badge}.` };
                        break;
                }
                case 'lifecycle': {
                        item.label = 'lifecycle';
                        item.description = `${element.state} - activation stays routed through the DH-01 authority`;
                        item.tooltip = `The anchor harness ${element.harnessId} is '${element.state}'.\n${ACTIVATION_REFUSAL_REASON}`;
                        item.iconPath = new api.ThemeIcon('debug-step-over');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.accessibilityInformation = { label: `Lifecycle ${element.state}. ${ACTIVATION_REFUSAL_REASON}` };
                        break;
                }
                case 'proposedHeader': {
                        item.label = 'Recorded proposals';
                        item.description = 'activation stays refused';
                        item.tooltip = ACTIVATION_REFUSAL_REASON;
                        item.iconPath = new api.ThemeIcon('bookmark');
                        item.collapsibleState = api.TreeItemCollapsibleState.Expanded;
                        item.accessibilityInformation = { label: 'Recorded proposals. Activation stays refused: activation routes through the DH-01 authority.' };
                        break;
                }
                case 'proposed': {
                        item.label = element.proposalId;
                        item.description = `${element.harnessId} - proposed ${element.proposedAt}`;
                        item.tooltip = `${element.proposalId}: harness ${element.harnessId} proposed at ${element.proposedAt}.\n${element.refusal}`;
                        item.iconPath = new api.ThemeIcon('bookmark');
                        item.collapsibleState = api.TreeItemCollapsibleState.None;
                        item.accessibilityInformation = { label: `Recorded proposal ${element.proposalId} for harness ${element.harnessId}. ${element.refusal}` };
                        break;
                }
        }
        return item;
}

/**
 * The tree's ROOT level: the section headers plus the standalone rows
 * (the error row, the lifecycle row). The flat census (`treeElementsFor`)
 * remains the single source of truth — the root is its structural spine.
 *
 * THE HIERARCHICAL CONTRACT LAW (live-caught 2026-10-17 at the LIVE 0.2.1
 * surface, the third layer under the ESM pair): vscode tree providers
 * MUST honor the `element` argument of getChildren. A provider whose
 * getChildren ignores it and always returns the full list, combined with
 * any TreeItemCollapsibleState.Expanded row, recurses without bound —
 * every expanded row's children fetch returns the same list (including
 * the expanded row itself) — the workbench allocates TreeItems and DOM
 * nodes until the renderer's heap dies ("Target crashed"). The headers
 * keep their Expanded state; their children are now the section-scoped
 * sub-lists.
 */
export function rootElementsFor(state: HarnessConsoleState): HarnessTreeElement[] {
        return treeElementsFor(state).filter((element) => {
                switch (element.kind) {
                        case 'error':
                        case 'selectionHeader':
                        case 'rolesHeader':
                        case 'harnessHeader':
                        case 'navigationHeader':
                        case 'proposedHeader':
                        case 'lifecycle':
                                return true;
                        default:
                                return false;
                }
        });
}

/**
 * The children of one tree element (the hierarchical contract). Leaves
 * return an empty list — an expanded header returns its section-scoped
 * sub-rows, filtered from the same flat census.
 */
export function childElementsFor(element: HarnessTreeElement, state: HarnessConsoleState): HarnessTreeElement[] {
        const census = treeElementsFor(state);
        switch (element.kind) {
                case 'selectionHeader':
                        return census.filter((row) => row.kind === 'session' || row.kind === 'selectionField');
                case 'rolesHeader':
                        return census.filter((row) => row.kind === 'rolesOption');
                case 'harnessHeader':
                        return census.filter((row) => row.kind === 'harness');
                case 'navigationHeader':
                        return census.filter((row) => row.kind === 'section');
                case 'section':
                        return census.filter((row) => row.kind === 'navRow' && row.section === element.section);
                case 'proposedHeader':
                        return census.filter((row) => row.kind === 'proposed');
                default:
                        return [];
        }
}

/**
 * Register the `flauz.harness` tree view over a mutable state ref. The
 * provider re-reads `stateRef.current` on every getChildren; the
 * returned `refresh` fires the change event so the tree repaints
 * (extension.ts calls it after every state transition).
 */
export function registerHarnessView(api: HarnessViewApi, stateRef: { current: HarnessConsoleState }): { refresh(): void } {
        const emitter = new api.EventEmitter<HarnessTreeElement | undefined>();
        const provider: vscode.TreeDataProvider<HarnessTreeElement> = {
                onDidChangeTreeData: emitter.event,
                getTreeItem: (element: HarnessTreeElement) => treeItemFor(element, api),
                getChildren: (element?: HarnessTreeElement) =>
                        element === undefined ? rootElementsFor(stateRef.current) : childElementsFor(element, stateRef.current),
        };
        api.registerTreeDataProvider(HARNESS_VIEW_ID, provider);
        return {
                refresh(): void {
                        emitter.fire(undefined);
                },
        };
}
