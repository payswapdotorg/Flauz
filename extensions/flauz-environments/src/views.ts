/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-001 — the `flauz.environments` view (container `flauz`): the live
 * environment registry (.flauz/environments.json) as tree rows — id, kind,
 * trust, enabled/active state — plus a retryable error row when the registry
 * cannot be read (docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 5).
 *
 * State contract: empty (viewsWelcome) when the registry is inactive (no
 * workspace folder) or no environment is registered; async loads ride the
 * stock tree progress; everything shown comes from the REAL registry state.
 *
 * DI shape: the vscode slices arrive as parameters (mirrors the agent
 * bridge's tool modules) so tests run under plain `node --test`.
 */

import type * as vscode from 'vscode';
import type { EnvironmentRegistry } from './registry.ts';
import type { EnvironmentDescriptor } from './api.ts';
import { formatAge, formatTimestamp } from './format.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const ENVIRONMENTS_VIEW_ID = 'flauz.environments';

/** Focus + refresh commands for the view (category "Flauz", see package.json). */
export const VIEW_COMMAND_IDS = [
        'flauz.focusView.environments',
        'flauz.env.refreshView',
] as const;

/** Tree element union: one environment row, or an error row. */
export type EnvironmentsTreeElement =
        | { readonly kind: 'environment'; readonly descriptor: EnvironmentDescriptor; readonly active: boolean }
        | { readonly kind: 'error'; readonly message: string; readonly retryCommand: string; readonly stale: boolean };

/** Live registry context the provider reads. */
export interface EnvironmentsViewContext {
        /** The registry; undefined when inactive (no workspace folder / failed bootstrap). */
        readonly getRegistry: () => EnvironmentRegistry | undefined;
        /** Set when the last bootstrap attempt failed (rendered as an error row). */
        readonly getError: () => string | undefined;
        /** Optional clock for the relative-age descriptions (tests pass a fixed one). */
        readonly clock?: () => number;
}

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface EnvironmentsViewApi {
        registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<EnvironmentsTreeElement>): vscode.Disposable;
        registerCommand(command: string, handler: (arg?: unknown) => unknown): vscode.Disposable;
        executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
        EventEmitter: new <T>() => vscode.EventEmitter<T>;
        TreeItem: typeof vscode.TreeItem;
        ThemeIcon: typeof vscode.ThemeIcon;
        TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

function truncate(text: string, max: number): string {
        return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The Environments tree: registry rows with real state. */
export class EnvironmentsTreeProvider implements vscode.TreeDataProvider<EnvironmentsTreeElement> {
        private readonly api: EnvironmentsViewApi;
        private readonly context: EnvironmentsViewContext;
        private readonly emitter: vscode.EventEmitter<EnvironmentsTreeElement | undefined>;
        /** Last successful render — the recovery cache (TL4-PREMIUM-UX.md section 4). */
        private lastKnownGood: readonly EnvironmentsTreeElement[] | undefined;

        constructor(api: EnvironmentsViewApi, context: EnvironmentsViewContext) {
                this.api = api;
                this.context = context;
                this.emitter = new api.EventEmitter<EnvironmentsTreeElement | undefined>();
        }

        /** Re-reads the registry on the next tree refresh. */
        refresh(): void {
                this.emitter.fire(undefined);
        }

        get onDidChangeTreeData(): vscode.Event<EnvironmentsTreeElement | undefined> {
                return this.emitter.event;
        }

        async getChildren(): Promise<EnvironmentsTreeElement[]> {
                const error = this.context.getError();
                if (error !== undefined) {
                        return this.errorRows(error);
                }
                const registry = this.context.getRegistry();
                if (registry === undefined) {
                        return [];
                }
                try {
                        await registry.bootstrap();
                        const activeId = registry.activeId();
                        const rows = registry.list().map(descriptor => ({ kind: 'environment', descriptor, active: descriptor.id === activeId }) as const);
                        this.lastKnownGood = rows;
                        return rows;
                } catch (err) {
                        return this.errorRows(err instanceof Error ? err.message : String(err));
                }
        }

        /** Error row first, then the last-known-good rows (never blanks a populated view). */
        private errorRows(message: string): EnvironmentsTreeElement[] {
                const cached = this.lastKnownGood ?? [];
                return [
                        { kind: 'error', message, retryCommand: 'flauz.env.refreshView', stale: cached.length > 0 },
                        ...cached,
                ];
        }

        getTreeItem(element: EnvironmentsTreeElement): vscode.TreeItem {
                const api = this.api;
                switch (element.kind) {
                        case 'environment':
                                return this.environmentItem(element.descriptor, element.active);
                        case 'error': {
                                const item = new api.TreeItem('Unable to Load Environments', api.TreeItemCollapsibleState.None);
                                item.id = 'flauz.environments/error';
                                item.description = truncate(element.message, 80);
                                item.tooltip = element.stale
                                        ? `${element.message}\n\nThe rows below are the last-known-good snapshot.\nSelecting this row retries the load. The Flauz guide (context menu) explains this surface's files.`
                                        : `${element.message}\n\nSelecting this row retries the load. The Flauz guide (context menu) explains this surface's files.`;
                                item.iconPath = new api.ThemeIcon('error');
                                item.contextValue = 'flauzError';
                                item.command = { command: element.retryCommand, title: 'Retry' };
                                item.accessibilityInformation = { label: `Error loading environments: ${truncate(element.message, 80)}. Select to retry.` };
                                return item;
                        }
                }
        }

        private environmentItem(descriptor: EnvironmentDescriptor, active: boolean): vscode.TreeItem {
                const api = this.api;
                const now = this.context.clock?.() ?? Date.now();
                const item = new api.TreeItem(descriptor.label, api.TreeItemCollapsibleState.None);
                item.id = `flauz.environments/${descriptor.id}`;
                item.description = `${descriptor.id} · ${descriptor.kind}${active ? ' · active' : descriptor.enabled ? '' : ' · disabled'} · updated ${formatAge(descriptor.timing.updatedAt, now)}`;
                item.tooltip = [
                        `Environment ${descriptor.id} — ${descriptor.label}`,
                        `Kind: ${descriptor.kind}`,
                        `Trust: ${descriptor.trust.posture}`,
                        `Status: ${active ? 'active' : descriptor.enabled ? 'enabled (not active)' : 'disabled'}`,
                        `Created: ${formatTimestamp(descriptor.timing.created)} UTC (${descriptor.timing.created})`,
                        `Updated: ${formatTimestamp(descriptor.timing.updatedAt)} UTC (${descriptor.timing.updatedAt})`,
                        'Connection plans are generated by the Flauz environment commands (flauz.env.showPlan).',
                ].join('\n');
                item.iconPath = new api.ThemeIcon(active ? 'circle-filled' : descriptor.enabled ? 'server' : 'circle');
                item.contextValue = active ? 'flauzEnvironmentActive' : 'flauzEnvironment';
                item.accessibilityInformation = { label: `Environment ${descriptor.id}, ${descriptor.label}, kind ${descriptor.kind}${active ? ', active' : ''}` };
                return item;
        }
}

/**
 * Registers the tree data provider plus its focus/refresh commands.
 * `retry` re-attempts a failed bootstrap (real recovery, wired by extension.ts).
 */
export function registerEnvironmentsView(api: EnvironmentsViewApi, context: EnvironmentsViewContext & { retry(): Promise<void> }): { readonly disposables: readonly vscode.Disposable[]; readonly provider: EnvironmentsTreeProvider } {
        const provider = new EnvironmentsTreeProvider(api, context);
        const handlers: Record<(typeof VIEW_COMMAND_IDS)[number], () => unknown> = {
                'flauz.focusView.environments': () => api.executeCommand(`${ENVIRONMENTS_VIEW_ID}.focus`),
                'flauz.env.refreshView': () => {
                        void context.retry().then(() => provider.refresh(), () => provider.refresh());
                        return undefined;
                },
        };
        return {
                provider,
                disposables: [
                        api.registerTreeDataProvider(ENVIRONMENTS_VIEW_ID, provider),
                        ...VIEW_COMMAND_IDS.map(id => api.registerCommand(id, handlers[id])),
                ],
        };
}
