/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/views.ts (the flauz.environments view). The view module takes
 * its vscode slices as parameters, so these run under plain `node --test`
 * against a REAL registry booted in a temp workspace (test/helpers.ts).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import type * as vscode from 'vscode';
import {
        ENVIRONMENTS_VIEW_ID,
        VIEW_COMMAND_IDS,
        EnvironmentsTreeProvider,
        registerEnvironmentsView,
        type EnvironmentsTreeElement,
        type EnvironmentsViewApi,
} from '../src/views.ts';
import { EnvironmentRegistry } from '../src/registry.ts';
import { bootRegistry, FIXED_TS, sshRegistrationInput } from './helpers.ts';

const COLLAPSIBLE = { None: 0, Collapsed: 1, Expanded: 2 } as const;

/** Minimal vscode slices the view needs (hand-rolled doubles). */
function createApiDouble() {
        const registeredHandlers = new Map<string, (arg?: unknown) => unknown>();
        const registeredViews: string[] = [];
        const executed: string[] = [];
        const api: EnvironmentsViewApi & {
                readonly registeredHandlers: Map<string, (arg?: unknown) => unknown>;
                readonly registeredViews: string[];
                readonly executedCommands: string[];
        } = {
                registeredHandlers,
                registeredViews,
                executedCommands: executed,
                registerTreeDataProvider: (viewId, provider) => {
                        registeredViews.push(viewId);
                        ok(typeof provider.getChildren === 'function');
                        return { dispose: () => undefined };
                },
                registerCommand: (command, handler) => {
                        registeredHandlers.set(command, handler);
                        return { dispose: () => registeredHandlers.delete(command) };
                },
                executeCommand: async command => {
                        executed.push(command);
                        return undefined;
                },
                EventEmitter: class {
                        private listeners: Array<(e: unknown) => void> = [];
                        get event() {
                                return (listener: (e: unknown) => void) => {
                                        this.listeners.push(listener);
                                        return { dispose: () => undefined };
                                };
                        }
                        fire(e: unknown): void {
                                for (const listener of [...this.listeners]) {
                                        listener(e);
                                }
                        }
                        dispose(): void {
                                this.listeners = [];
                        }
                } as unknown as EnvironmentsViewApi['EventEmitter'],
                TreeItem: class {
                        label?: string;
                        id?: string;
                        description?: string | boolean;
                        tooltip?: string;
                        iconPath?: { id: string };
                        command?: { command: string; title: string; arguments?: unknown[] };
                        contextValue?: string;
                        accessibilityInformation?: { label: string; role?: string };
                        collapsibleState: number;
                        constructor(label: string, collapsibleState = COLLAPSIBLE.None) {
                                this.label = label;
                                this.collapsibleState = collapsibleState;
                        }
                } as unknown as EnvironmentsViewApi['TreeItem'],
                ThemeIcon: class {
                        readonly id: string;
                        constructor(id: string) {
                                this.id = id;
                        }
                } as unknown as EnvironmentsViewApi['ThemeIcon'],
                TreeItemCollapsibleState: COLLAPSIBLE as unknown as EnvironmentsViewApi['TreeItemCollapsibleState'],
        };
        return api;
}

/** iconPath narrowed to the ThemeIcon shape the view sets. */
function iconId(item: vscode.TreeItem): string | undefined {
        return (item.iconPath as unknown as { id?: string } | undefined)?.id;
}

function tooltipText(item: vscode.TreeItem): string | undefined {
        return item.tooltip as unknown as string | undefined;
}

test('provider: inactive registry -> empty (viewsWelcome path)', async () => {
        const api = createApiDouble();
        const provider = new EnvironmentsTreeProvider(api, { getRegistry: () => undefined, getError: () => undefined });
        deepStrictEqual(await provider.getChildren(), []);
});

test('provider: rows reflect the real registry (active/disabled states, tooltips)', async () => {
        const api = createApiDouble();
        const t = await bootRegistry();
        try {
                await t.registry.register(sshRegistrationInput() as never);
                await t.registry.register(sshRegistrationInput({ id: 'env-test-disabled', label: 'Disabled Env', enabled: false }) as never);
                await t.registry.activate('env-test-ssh');
                const provider = new EnvironmentsTreeProvider(api, { getRegistry: () => t.registry, getError: () => undefined, clock: () => FIXED_TS });
                const rows = await provider.getChildren();
                deepStrictEqual(rows.map(row => (row.kind === 'environment' ? row.descriptor.id : row.kind)), ['env-test-disabled', 'env-test-ssh']);
                const active = rows[1]!;
                strictEqual(active.kind === 'environment' && active.active, true);
                const activeItem = provider.getTreeItem(active);
                strictEqual(activeItem.label, 'Test SSH');
                strictEqual(activeItem.description, 'env-test-ssh · ssh-local · active · updated just now');
                strictEqual(iconId(activeItem), 'circle-filled');
                ok(tooltipText(activeItem)?.includes('Kind: ssh-local'));
                ok(tooltipText(activeItem)?.includes('Trust: unknown'));
                // TL4-002: tooltips carry the absolute UTC stamp (fixed clock = 1730000000000).
                ok(tooltipText(activeItem)?.includes('Updated: 2024-10-27 03:33 UTC (1730000000000)'));
                const disabledItem = provider.getTreeItem(rows[0]!);
                strictEqual(disabledItem.description, 'env-test-disabled · ssh-local · disabled · updated just now');
                strictEqual(iconId(disabledItem), 'circle');
        } finally {
                await t.cleanup();
        }
});

test('provider: corrupt registry file -> error row wired to the retry command', async () => {
        const api = createApiDouble();
        const t = await bootRegistry();
        try {
                // corrupt the persisted envelope, then hand the provider a FRESH registry
                // (bootstrap re-reads the file; the booted one has the envelope cached)
                await t.fs.writeFile(`${t.root}/.flauz/environments.json`, '{ nope');
                const fresh = new EnvironmentRegistry({ root: t.root, fs: t.fs, clock: () => 1 });
                const provider = new EnvironmentsTreeProvider(api, { getRegistry: () => fresh, getError: () => undefined });
                const rows = await provider.getChildren();
                strictEqual(rows.length, 1);
                strictEqual(rows[0]?.kind, 'error');
                const item = provider.getTreeItem(rows[0]!);
                strictEqual(iconId(item), 'error');
                strictEqual(item.command?.command, 'flauz.env.refreshView');
                strictEqual(item.command?.title, 'Retry');
        } finally {
                await t.cleanup();
        }
});

test('provider recovery: a failed re-read keeps the last-known-good rows below the error row', async () => {
        const api = createApiDouble();
        const t = await bootRegistry();
        try {
                await t.registry.register(sshRegistrationInput() as never);
                // A registry whose bootstrap ALWAYS throws — swapped in after a
                // successful render to simulate a failed re-read.
                const broken = new Proxy(t.registry, {
                        get(target, prop, receiver) {
                                if (prop === 'bootstrap') {
                                        return async () => {
                                                throw new Error('read failed');
                                        };
                                }
                                return Reflect.get(target, prop, receiver);
                        },
                });
                let useBroken = false;
                const provider = new EnvironmentsTreeProvider(api, {
                        getRegistry: () => (useBroken ? broken : t.registry),
                        getError: () => undefined,
                        clock: () => FIXED_TS,
                });
                const first = await provider.getChildren();
                strictEqual(first.length, 1);
                strictEqual(first[0]?.kind, 'environment');
                useBroken = true;
                const second = await provider.getChildren();
                strictEqual(second.length, 2);
                strictEqual(second[0]?.kind, 'error');
                strictEqual(second[1]?.kind, 'environment');
                const errorItem = provider.getTreeItem(second[0]!);
                strictEqual(errorItem.contextValue, 'flauzError');
                ok(errorItem.tooltip?.includes('The rows below are the last-known-good snapshot.'));
        } finally {
                await t.cleanup();
        }
});

test('provider: a recorded bootstrap error renders the error row too', async () => {
        const api = createApiDouble();
        const provider = new EnvironmentsTreeProvider(api, { getRegistry: () => undefined, getError: () => 'flauz.environments/v0: registry is not valid JSON -- oops' });
        const rows = await provider.getChildren();
        strictEqual(rows[0]?.kind, 'error');
        const item = provider.getTreeItem(rows[0]!);
        strictEqual(item.command?.command, 'flauz.env.refreshView');
});

test('registration: view + both commands register; focus delegates; refresh runs retry then fires change', async () => {
        const api = createApiDouble();
        let changeEvents = 0;
        let retries = 0;
        const { provider } = registerEnvironmentsView(api, {
                getRegistry: () => undefined,
                getError: () => undefined,
                retry: async () => {
                        retries++;
                },
        });
        provider.onDidChangeTreeData?.(() => {
                changeEvents++;
        });
        deepStrictEqual(api.registeredViews, [ENVIRONMENTS_VIEW_ID]);
        deepStrictEqual([...api.registeredHandlers.keys()].sort(), [...VIEW_COMMAND_IDS].sort());
        await api.registeredHandlers.get('flauz.focusView.environments')?.();
        deepStrictEqual(api.executedCommands, ['flauz.environments.focus']);
        api.registeredHandlers.get('flauz.env.refreshView')?.();
        // the refresh handler awaits the retry promise, then fires the change event
        // (microtask chain — a few bare awaits let it settle deterministically)
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        strictEqual(retries, 1);
        strictEqual(changeEvents, 1);
});
