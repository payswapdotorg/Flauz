/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Harness console - the WEB (browser) extension entry point
 * (A-PROD-006-W9, the gap-ledger row-4 closure vehicle).
 *
 * THE BOUNDARY (the packaging-parity law, verbatim): this entry composes
 * ONLY the web-full console core - the pure selection-session state
 * machine (src/harnessState.ts), the flauz.harness tree view
 * (src/harnessView.ts) and the shared timestamp formatter
 * (src/format.ts) - over the in-session HarnessConsolePort binding
 * below. THE RUNTIME BINDING NEVER SHIPS WEB: src/flauzHarnessPort.ts
 * (the node:fs/node:crypto wiring to the REAL Domain Harness OS kits)
 * is web-blocked by the parity law and is imported by THIS FILE NEVER.
 * The desktop entry (src/extension.ts) is byte-untouched.
 *
 * THE WEB PORT SEAM (the W9 design decision, disclosed): the browser
 * session has no workspace filesystem, so the port surfaces an honest
 * in-session selection session - every op implements the SAME
 * HarnessConsolePort contract the desktop binding implements, the
 * vocabularies are the REAL frozen contract constants (imported by
 * reference - the same frozen values the desktop binding serves; no
 * re-declaration), and the session walk follows the REAL DH-02 stage
 * order with the same refusal discipline. What the web surface cannot
 * do - persist the .flauz/harness tree, compose through the REAL
 * DH-03 roles kit, mint through the inner REAL DH-01 kit, bank
 * proposals durably - is disclosed honestly: the draft's composition
 * menu stays empty (the REAL roles sessions are a workspace-file
 * surface; never fabricated), the proposal mint records the
 * in-session boundary on the harness history, and the navigation
 * projection refuses as the observed 'navigation-not-composed' bound
 * (the REAL DH-010 projection rides the REAL family records the web
 * session store does not hold). The honest bound is the surface - the
 * same (not ... yet) markers the desktop empty state shows, never an
 * error, never a promotion.
 */
import * as vscode from 'vscode';
import {
        type HarnessConsoleState,
        applyHarnessList,
        applyNavigationLoad,
        applyRoleCompositions,
        applySessionResult,
        clearError,
        failOperation,
        initialHarnessState,
        recordProposal,
        selectHarness,
} from './harnessState.ts';
import type {
        HarnessConsolePort,
        HarnessSummaryRow,
        RoleCompositionsResult,
        SelectionSessionView,
        SessionOpResult,
} from './harnessPort.ts';
import {
        HARNESS_VIEW_ID,
        INSPECT_HARNESS_COMMAND,
        SELECT_SESSION_COMMAND,
        VIEW_COMMAND_IDS,
        registerHarnessView,
} from './harnessView.ts';
import { toIsoStamp } from './format.ts';
import { DOMAIN_HARNESS_CONTRACTS_VERSION, HARNESS_INDUSTRIES, HARNESS_WORK_TYPES, isHarnessIndustry, isHarnessWorkType } from '../../../build/flauz/harness/contract/common/domainHarnessContract.js';
import type { HarnessIndustry, HarnessRecord, HarnessWorkType } from '../../../build/flauz/harness/contract/common/domainHarnessContract.js';
import { COMPANY_SIZE_BANDS, ONBOARDING_STAGES, isCompanySizeBand } from '../../../build/flauz/harness/onboarding/common/onboardingContract.js';
import type { CompanySizeBand } from '../../../build/flauz/harness/onboarding/common/onboardingContract.js';

/** ISO timestamp for the in-session records (the shared module is the single timestamp source). */
function nowIso(): string {
        return toIsoStamp(Date.now());
}

/**
 * The observed in-session session record: the honest web shape of the
 * DH-02 selection-session walk (session lifetime only). The stage
 * order is the REAL kit's own (industry -> company -> work-types ->
 * review -> proposed); every op appends the revision count exactly as
 * the real record does.
 */
/** The in-session stage vocabulary: the REAL kit's own frozen ONBOARDING_STAGES members (imported by reference; never re-declared). */
type WebSessionStage = (typeof ONBOARDING_STAGES)[number];

interface WebSessionRecord {
        readonly sessionId: string;
        stage: WebSessionStage;
        industry?: HarnessIndustry;
        companyDisplayName?: string;
        companySizeBand?: CompanySizeBand;
        workTypes: HarnessWorkType[];
        rolesSessionId?: string;
        proposedHarnessId?: string;
        revision: number;
}

/** The in-session store (session lifetime only: the sessions map + the proposed records). */
interface WebHarnessStore {
        sessions: Map<string, WebSessionRecord>;
        proposals: HarnessRecord[];
}

/** The in-session observed view-model (the REAL DH-02 session record's console view shape). */
function sessionView(record: WebSessionRecord): SelectionSessionView {
        return {
                sessionId: record.sessionId,
                stage: record.stage,
                industry: record.industry,
                companyDisplayName: record.companyDisplayName,
                companySizeBand: record.companySizeBand,
                workTypes: [...record.workTypes],
                roleKeys: [],
                proposedHarnessId: record.proposedHarnessId,
                revision: record.revision,
        };
}

/** The typed refusal shape (the port contract's own). */
const refusal = (reason: string, detail: string) => ({ ok: false as const, reason, detail });

/**
 * The session-scoped web HarnessConsolePort (the W9 design decision).
 * The vocabularies are the REAL frozen constants imported by
 * reference; the session walk follows the real stage order; the
 * durable-state surfaces (roles compositions, harness list,
 * navigation) return the observed in-session truth - empty until the
 * walk proposes, honest thereafter, session lifetime only.
 */
function createWebHarnessPort(store: WebHarnessStore, rng: () => string): HarnessConsolePort {
        const session = (sessionId: string): WebSessionRecord | undefined => store.sessions.get(sessionId);
        const revise = (record: WebSessionRecord): void => { record.revision += 1; };

        const port: HarnessConsolePort = {
                id: 'flauz-harness-web-in-session',
                mode: 'flauz',
                listIndustries: async () => HARNESS_INDUSTRIES,
                listSizeBands: async () => COMPANY_SIZE_BANDS,
                listWorkTypes: async () => HARNESS_WORK_TYPES,
                beginSession: async () => {
                        const sessionId = `flauz:onb:${rng()}${rng()}`;
                        store.sessions.set(sessionId, { sessionId, stage: 'industry', workTypes: [], revision: 0 });
                        return { ok: true as const, session: sessionView(store.sessions.get(sessionId)!) };
                },
                selectIndustry: async (sessionId, industry) => {
                        const record = session(sessionId);
                        if (record === undefined) { return refusal('session-not-found', 'No in-session onboarding session is open in this browser session.'); }
                        if (!isHarnessIndustry(industry)) { return refusal('industry-not-member', 'The selected industry is not a member of the frozen industry vocabulary.'); }
                        record.industry = industry;
                        record.stage = 'company';
                        revise(record);
                        return { ok: true as const, session: sessionView(record) };
                },
                composeCompany: async (sessionId, displayName, sizeBand) => {
                        const record = session(sessionId);
                        if (record === undefined) { return refusal('session-not-found', 'No in-session onboarding session is open in this browser session.'); }
                        if (!isCompanySizeBand(sizeBand)) { return refusal('size-band-not-member', 'The selected company size band is not a member of the frozen size-band vocabulary.'); }
                        record.companyDisplayName = displayName;
                        record.companySizeBand = sizeBand;
                        record.stage = 'work-types';
                        revise(record);
                        return { ok: true as const, session: sessionView(record) };
                },
                selectWorkTypes: async (sessionId, workTypes) => {
                        const record = session(sessionId);
                        if (record === undefined) { return refusal('session-not-found', 'No in-session onboarding session is open in this browser session.'); }
                        for (const workType of workTypes) {
                                if (!isHarnessWorkType(workType)) { return refusal('work-type-not-member', 'A selected work type is not a member of the frozen work-type vocabulary.'); }
                        }
                        record.workTypes = workTypes.filter(isHarnessWorkType);
                        record.stage = 'review';
                        revise(record);
                        return { ok: true as const, session: sessionView(record) };
                },
                proposeDraft: async (sessionId, rolesSessionId) => {
                        const record = session(sessionId);
                        if (record === undefined) { return refusal('session-not-found', 'No in-session onboarding session is open in this browser session.'); }
                        if (record.stage !== 'review') { return refusal('session-stage', `The session is at stage '${record.stage}'; the proposal boundary opens at 'review'.`); }
                        if (rolesSessionId !== undefined && store.sessions.has(rolesSessionId)) { record.rolesSessionId = rolesSessionId; }
                        // The in-session mint boundary (disclosed): the desktop binding mints through the inner REAL DH-01 kit over the workspace tree;
                        // the web session store records the proposal at the same lifecycle state ('proposed') with the boundary on the harness history.
                        const harnessId = `flauz:hrn:${rng()}${rng()}`;
                        const descriptor: HarnessRecord['descriptor'] = {
                                harnessId,
                                contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
                                industry: record.industry ?? 'software',
                                workTypes: [...record.workTypes] as HarnessRecord['descriptor']['workTypes'],
                                displayName: record.companyDisplayName ?? harnessId,
                                roles: [],
                                capabilityRefs: [],
                                workflowRefs: [],
                                policyRefs: [],
                                evidenceRefs: [],
                        };
                        const harness: HarnessRecord = {
                                harnessId,
                                contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
                                state: 'proposed',
                                descriptor,
                                mintedAtIso: nowIso(),
                                revision: 1,
                                history: [{ at: nowIso(), fromState: null, toState: 'proposed', law: 'DH-01', decision: null, detail: 'proposed through the browser session store (the web surface\'s in-session boundary; the REAL DH-01 mint is a workspace-file surface)' }],
                                lastValidation: { ok: true, mode: 'shape', descriptor },
                        };
                        store.proposals.push(harness);
                        record.proposedHarnessId = harnessId;
                        record.stage = 'proposed';
                        revise(record);
                        return { ok: true as const, session: sessionView(record) };
                },
                inspectSession: async (sessionId) => {
                        const record = session(sessionId);
                        if (record === undefined) { return refusal('session-not-found', 'No in-session onboarding session is open in this browser session.'); }
                        return { ok: true as const, session: sessionView(record) };
                },
                listRoleCompositions: async (): Promise<RoleCompositionsResult> => {
                        // The REAL composed DH-03 roles sessions are a workspace-file surface: the web session store holds none, and fabricating
                        // options would violate the observed-state law. The menu stays empty (the honest bound; the view discloses it).
                        return { ok: true as const, options: [] };
                },
                listHarnesses: async () => {
                        // The observed in-session proposals only (never a fabricated list; empty until the walk proposes).
                        const rows: readonly HarnessSummaryRow[] = store.proposals.map((harness) => ({
                                harnessId: harness.harnessId,
                                state: harness.state,
                                industry: harness.descriptor.industry,
                                displayName: harness.descriptor.displayName,
                        }));
                        return { ok: true as const, harnesses: rows };
                },
                loadNavigation: async (harnessId) => {
                        const harness = store.proposals.find((candidate) => candidate.harnessId === harnessId);
                        if (harness === undefined) {
                                return refusal('harness-not-found', 'The web session store holds only the harnesses proposed in this browser session (the durable .flauz/harness tree is a workspace-file surface).');
                        }
                        // The REAL DH-010 projection composes over the REAL family records (roles/ontology/templates/...); the web session
                        // store holds none - the navigation projection is the observed honest bound, refused typed, never a fabricated model.
                        return refusal('navigation-not-composed', 'The DH-010 navigation projection rides the REAL family records under the workspace .flauz/harness tree - the browser session store holds no family records, so the projection is not composed here (the honest web bound; the desktop surface composes it).');
                },
        };
        return port;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
        const channel = vscode.window.createOutputChannel('Flauz Harness (Web)');
        const log = (message: string) => channel.appendLine(message);
        context.subscriptions.push({ dispose: () => channel.dispose() });

        log('Flauz Harness web console activating (A-PROD-006-W9: the in-session port seam; the runtime binding never ships web).');

        // The in-session store (session lifetime only; the REAL durable-state rows are workspace-file surfaces, never faked).
        const store: WebHarnessStore = { sessions: new Map(), proposals: [] };
        // The in-session id seam (Web Crypto; the web surface's own disclosed seam - the desktop uses node:crypto at the same boundary).
        const rng = (): string => {
                const bytes = new Uint8Array(8);
                crypto.getRandomValues(bytes);
                return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        };
        const port = createWebHarnessPort(store, rng);

        const stateRef: { current: HarnessConsoleState } = { current: initialHarnessState(HARNESS_INDUSTRIES, COMPANY_SIZE_BANDS, HARNESS_WORK_TYPES) };

        // The view registers FIRST (the shell surface law) - the same injected-vs-web slices the desktop entry uses.
        const view = registerHarnessView(
                {
                        registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
                        EventEmitter: vscode.EventEmitter,
                        TreeItem: vscode.TreeItem,
                        ThemeIcon: vscode.ThemeIcon,
                        TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
                },
                stateRef,
        );

        /** The observed refresh: the vocabularies, the roles options, the harness list, the driven session. */
        const refresh = async (): Promise<void> => {
                stateRef.current = clearError(stateRef.current);
                try {
                        const [roles, harnesses] = await Promise.all([
                                port.listRoleCompositions(),
                                port.listHarnesses(),
                        ]);
                        stateRef.current = applyRoleCompositions(stateRef.current, roles);
                        stateRef.current = applyHarnessList(stateRef.current, harnesses);
                        const driven = stateRef.current.activeSessionId;
                        if (driven !== undefined) {
                                stateRef.current = applySessionResult(stateRef.current, await port.inspectSession(driven));
                        }
                        if (stateRef.current.inspectedHarnessId !== undefined) {
                                stateRef.current = applyNavigationLoad(stateRef.current, stateRef.current.inspectedHarnessId, await port.loadNavigation(stateRef.current.inspectedHarnessId));
                        }
                        log(`refreshed: ${stateRef.current.harnesses.length} in-session harnesses, ${stateRef.current.sessions.length} sessions`);
                        view.refresh();
                } catch (error) {
                        const message = String(error);
                        log(`refresh failed: ${message}`);
                        stateRef.current = failOperation(stateRef.current, message);
                        view.refresh();
                }
        };

        /** Folds a session op into the state and surfaces the observed refusal when refused (the desktop entry's own discipline). */
        const runSessionOp = async (op: () => Promise<SessionOpResult>): Promise<void> => {
                stateRef.current = clearError(stateRef.current);
                const result = await op();
                stateRef.current = applySessionResult(stateRef.current, result);
                if (!result.ok) {
                        log(`session op refused: ${result.reason}: ${result.detail}`);
                        vscode.window.showWarningMessage(`Flauz Harness: ${result.reason} - ${result.detail}`);
                }
                view.refresh();
        };

        const beginSession = async (): Promise<void> => {
                await runSessionOp(() => port.beginSession());
        };

        const selectIndustry = async (): Promise<void> => {
                const sessionId = stateRef.current.activeSessionId;
                if (sessionId === undefined) {
                        vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
                        return;
                }
                const industry = await vscode.window.showQuickPick([...stateRef.current.industries], { placeHolder: 'Select the industry' });
                if (industry === undefined) {
                        return;
                }
                await runSessionOp(() => port.selectIndustry(sessionId, industry));
        };

        const composeCompany = async (): Promise<void> => {
                const sessionId = stateRef.current.activeSessionId;
                if (sessionId === undefined) {
                        vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
                        return;
                }
                const displayName = await vscode.window.showInputBox({ placeHolder: 'The company display name', prompt: 'The company profile\'s display name (at most 120 characters)' });
                if (displayName === undefined) {
                        return;
                }
                const sizeBand = await vscode.window.showQuickPick([...stateRef.current.sizeBands], { placeHolder: 'Select the company size band' });
                if (sizeBand === undefined) {
                        return;
                }
                await runSessionOp(() => port.composeCompany(sessionId, displayName, sizeBand));
        };

        const selectWorkTypes = async (): Promise<void> => {
                const sessionId = stateRef.current.activeSessionId;
                if (sessionId === undefined) {
                        vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
                        return;
                }
                const picks = await vscode.window.showQuickPick(
                        stateRef.current.workTypes.map((workType) => ({ label: workType, picked: false })),
                        { placeHolder: 'Select the work types (the frozen list order is preserved)', canPickMany: true },
                );
                if (picks === undefined) {
                        return;
                }
                const workTypes = stateRef.current.workTypes.filter((workType) => picks.some((pick) => pick.label === workType));
                await runSessionOp(() => port.selectWorkTypes(sessionId, workTypes));
        };

        const proposeDraft = async (): Promise<void> => {
                const sessionId = stateRef.current.activeSessionId;
                if (sessionId === undefined) {
                        vscode.window.showWarningMessage('Flauz Harness: begin a session first.');
                        return;
                }
                // The web port composes the draft from the session's own walk (the REAL DH-03 roles composition is a workspace-file
                // surface; the empty menu is the honest bound - the desktop entry requires a composition selection here).
                await runSessionOp(() => port.proposeDraft(sessionId, stateRef.current.selectedRolesSessionId ?? sessionId));
                const sessionRow = stateRef.current.sessions.find((candidate) => candidate.sessionId === sessionId);
                const harnessId = sessionRow?.proposedHarnessId;
                if (sessionRow !== undefined && sessionRow.stage === 'proposed' && harnessId !== undefined) {
                        const at = nowIso();
                        const { state, proposal } = recordProposal(stateRef.current, sessionId, harnessId, at);
                        stateRef.current = state;
                        log(`proposed ${harnessId} through the browser session walk (${proposal.proposalId})`);
                        // The refusal rides EVERY recorded proposal - the closed activation door.
                        vscode.window.showInformationMessage(`Flauz Harness: proposed ${harnessId} (the browser session's in-session boundary). ${proposal.refusalReason}`);
                }
                view.refresh();
        };

        const inspectHarness = async (harnessId: string): Promise<void> => {
                stateRef.current = clearError(stateRef.current);
                stateRef.current = selectHarness(stateRef.current, harnessId);
                const navigation = await port.loadNavigation(harnessId);
                stateRef.current = applyNavigationLoad(stateRef.current, harnessId, navigation);
                if (!navigation.ok) {
                        log(`navigation load refused: ${navigation.reason}: ${navigation.detail}`);
                        vscode.window.showWarningMessage(`Flauz Harness: ${navigation.reason} - ${navigation.detail}`);
                }
                view.refresh();
        };

        context.subscriptions.push(
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[0], () => { void beginSession(); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[1], () => { void selectIndustry(); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[2], () => { void composeCompany(); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[3], () => { void selectWorkTypes(); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[4], () => { void proposeDraft(); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[5], () => { vscode.commands.executeCommand(`${HARNESS_VIEW_ID}.focus`); }),
                vscode.commands.registerCommand(VIEW_COMMAND_IDS[6], () => { void refresh(); }),
                vscode.commands.registerCommand(SELECT_SESSION_COMMAND, (sessionId: string) => {
                        stateRef.current = clearError(stateRef.current);
                        void port.inspectSession(sessionId).then((result) => {
                                stateRef.current = applySessionResult(stateRef.current, result);
                                view.refresh();
                        });
                }),
                vscode.commands.registerCommand(INSPECT_HARNESS_COMMAND, (harnessId: string) => { void inspectHarness(harnessId); }),
        );

        log('Flauz Harness web console active: the flauz.harness view is registered; every row is observed in-session state.');
}

export function deactivate(): void {
        // The in-session store dies with the session (session lifetime only - the disclosed web seam).
}
