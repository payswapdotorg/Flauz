/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-001 — the `flauz.browser` view (container `flauz`): the effective
 * browser policy as tree rows — source (workspace file vs fail-closed
 * builtin deny-all), the three enforcement layers with their allow/deny
 * counts, partitions, and warnings — all read from the LIVE
 * BrowserPolicyEngine (docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 5).
 *
 * State contract: empty (viewsWelcome) when no workspace folder is open (the
 * policy file + partitions need one); an invalid policy file renders an
 * honest fail-closed error row whose command is the real retry (engine
 * reload); nothing is fabricated.
 *
 * DI shape: the vscode slices arrive as parameters so tests run under plain
 * `node --test` against real BrowserPolicyEngine instances.
 */

import type * as vscode from 'vscode';
import { POLICY_LAYERS, type BrowserPolicyEngine, type PolicyLayer } from './policy.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const BROWSER_VIEW_ID = 'flauz.browser';

/** Focus + refresh commands for the view (category "Flauz", see package.json). */
export const VIEW_COMMAND_IDS = [
        'flauz.focusView.browser',
        'flauz.browser.refreshView',
] as const;

/** A single Browser view row. */
export interface BrowserRow {
        readonly id: string;
        readonly label: string;
        readonly description: string;
        readonly tooltip: string;
        readonly icon: string;
        readonly command?: vscode.Command;
        readonly contextValue: string;
}

/** Live engine context the provider reads. */
export interface BrowserViewContext {
        /** The effective engine; undefined when not yet activated. */
        readonly getEngine: () => BrowserPolicyEngine | undefined;
        /** True when a workspace folder is open (the policy file needs one). */
        readonly getFolderOpen: () => boolean;
}

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface BrowserViewApi {
        registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<BrowserRow>): vscode.Disposable;
        registerCommand(command: string, handler: (arg?: unknown) => unknown): vscode.Disposable;
        executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
        EventEmitter: new <T>() => vscode.EventEmitter<T>;
        TreeItem: typeof vscode.TreeItem;
        ThemeIcon: typeof vscode.ThemeIcon;
        TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

const LAYER_LABELS: Record<PolicyLayer, string> = {
        driver: 'Driver Layer',
        webRequest: 'WebRequest Layer',
        willNavigate: 'Will-Navigate Layer',
};

const LAYER_ICONS: Record<PolicyLayer, string> = {
        driver: 'window',
        webRequest: 'shield',
        willNavigate: 'arrow-right',
};

function truncate(text: string, max: number): string {
        return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Builds the rows for an engine snapshot (pure; exported for tests). */
export function browserRows(engine: BrowserPolicyEngine): BrowserRow[] {
        const rows: BrowserRow[] = [];
        const policy = engine.policyInEffect;
        if (engine.sourceError !== undefined) {
                const error = engine.sourceError;
                rows.push({
                        id: 'source',
                        label: 'Policy Source',
                        description: 'invalid — deny-all in effect',
                        tooltip: `Policy file INVALID (${error.code}).\n${error.message}\nThe fail-closed built-in deny-all default is in effect. Selecting this row reloads the policy file (retry). The Flauz guide (context menu) explains this surface's files.`,
                        icon: 'error',
                        command: { command: 'flauz.browser.refreshView', title: 'Retry' },
                        contextValue: 'flauzError',
                });
        } else {
                rows.push({
                        id: 'source',
                        label: 'Policy Source',
                        description: engine.source === 'workspace-file' ? 'workspace file' : 'built-in default (deny-all)',
                        tooltip: engine.source === 'workspace-file'
                                ? 'Effective policy loaded from .flauz/browser-policy.json (flauz.browser-policy/v0). Selecting opens the policy file.'
                                : 'No .flauz/browser-policy.json — the fail-closed built-in deny-all default is in effect. Selecting creates + opens the policy file.',
                        icon: 'shield',
                        command: { command: 'flauz.browser.setPolicy', title: 'Open (or Create) Browser Policy File' },
                        contextValue: 'flauzBrowserSource',
                });
        }
        for (const layer of POLICY_LAYERS) {
                const rules = policy[layer];
                rows.push({
                        id: `layer-${layer}`,
                        label: LAYER_LABELS[layer],
                        description: `${rules.enabled ? '' : 'disabled · '}allow ${rules.allow.length} · deny ${rules.deny.length}${layer === 'driver' ? ` · fileRoots ${rules.fileRoots.length}` : ''}`,
                        tooltip: `${LAYER_LABELS[layer]} (${layer}) — ${rules.enabled ? 'enabled' : 'disabled (kill-switch off: the layer never denies)'}.\nAllow patterns: ${rules.allow.length === 0 ? '(none)' : rules.allow.join(', ')}\nDeny patterns: ${rules.deny.length === 0 ? '(none)' : rules.deny.join(', ')}${layer === 'driver' ? `\nTrusted file roots: ${rules.fileRoots.length === 0 ? '(none)' : rules.fileRoots.join(', ')}` : ''}`,
                        icon: LAYER_ICONS[layer],
                        contextValue: `flauzBrowserLayer-${layer}`,
                });
        }
        rows.push({
                id: 'partitions',
                label: 'Partitions',
                description: `${policy.partitions.scope} · ${policy.partitions.perAgent ? 'per-agent isolation' : 'shared per workspace'}`,
                tooltip: `Session isolation: scope '${policy.partitions.scope}' (${policy.partitions.scope === 'persist' ? 'durable jars' : 'in-memory'}), per-agent isolation ${policy.partitions.perAgent ? 'ON' : 'OFF'}. Agent and human browser sessions stay distinguishable.`,
                icon: 'layers',
                contextValue: 'flauzBrowserPartitions',
        });
        for (const [index, warning] of engine.warnings.entries()) {
                rows.push({
                        id: `warning-${index}`,
                        label: 'Warning',
                        description: truncate(warning, 60),
                        tooltip: `${warning}\nRun Flauz: Verify Browser Policy File for the full receipt.`,
                        icon: 'warning',
                        contextValue: 'flauzBrowserWarning',
                });
        }
        return rows;
}

/** The Browser tree: effective policy rows from the live engine. */
export class BrowserTreeProvider implements vscode.TreeDataProvider<BrowserRow> {
        private readonly api: BrowserViewApi;
        private readonly context: BrowserViewContext;
        private readonly emitter: vscode.EventEmitter<BrowserRow | undefined>;

        constructor(api: BrowserViewApi, context: BrowserViewContext) {
                this.api = api;
                this.context = context;
                this.emitter = new api.EventEmitter<BrowserRow | undefined>();
        }

        /** Re-reads the engine on the next tree refresh. */
        refresh(): void {
                this.emitter.fire(undefined);
        }

        get onDidChangeTreeData(): vscode.Event<BrowserRow | undefined> {
                return this.emitter.event;
        }

        async getChildren(): Promise<BrowserRow[]> {
                if (!this.context.getFolderOpen()) {
                        return [];
                }
                const engine = this.context.getEngine();
                if (engine === undefined) {
                        return [];
                }
                return browserRows(engine);
        }

        getTreeItem(element: BrowserRow): vscode.TreeItem {
                const api = this.api;
                const item = new api.TreeItem(element.label, api.TreeItemCollapsibleState.None);
                item.id = `flauz.browser/${element.id}`;
                item.description = element.description;
                item.tooltip = element.tooltip;
                item.iconPath = new api.ThemeIcon(element.icon);
                item.contextValue = element.contextValue;
                // Premium spec section 6: summary-row a11y grammar "<label>: <description>".
                item.accessibilityInformation = { label: `${element.label}: ${element.description}` };
                if (element.command !== undefined) {
                        item.command = element.command;
                }
                return item;
        }
}

/**
 * Registers the tree data provider plus its focus/refresh commands.
 * `reload` re-reads the policy file (the real retry, wired by extension.ts —
 * the same path the file watcher uses).
 */
export function registerBrowserView(api: BrowserViewApi, context: BrowserViewContext & { reload(): Promise<void> }): { readonly disposables: readonly vscode.Disposable[]; readonly provider: BrowserTreeProvider } {
        const provider = new BrowserTreeProvider(api, context);
        const handlers: Record<(typeof VIEW_COMMAND_IDS)[number], () => unknown> = {
                'flauz.focusView.browser': () => api.executeCommand(`${BROWSER_VIEW_ID}.focus`),
                'flauz.browser.refreshView': () => {
                        void context.reload().then(() => provider.refresh(), () => provider.refresh());
                        return undefined;
                },
        };
        return {
                provider,
                disposables: [
                        api.registerTreeDataProvider(BROWSER_VIEW_ID, provider),
                        ...VIEW_COMMAND_IDS.map(id => api.registerCommand(id, handlers[id])),
                ],
        };
}
