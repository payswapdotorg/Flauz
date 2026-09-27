/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-001 — the `flauz.models` view (container `flauz`): the model provider
 * surface — the vendor(s) actually REGISTERED at runtime (v0: the
 * deterministic flauz-mock echo provider) plus the design-only vendor plans
 * (claude/codex/qwen stubs), each labeled with its honest status
 * (docs/FLAUZ-PROGRAM/TL4-IA-SPEC.md section 5: never present a stub as
 * registered).
 *
 * DI shape: the vscode slices arrive as parameters so tests run under plain
 * `node --test`.
 */

import type * as vscode from 'vscode';
import { claudeVendorPlan } from './vendors/claude.ts';
import { codexVendorPlan } from './vendors/codex.ts';
import { qwenVendorPlan } from './vendors/qwen.ts';
import type { VendorPlan } from './vendors/types.ts';

/** View id this module serves (contributed in package.json, container `flauz`). */
export const MODELS_VIEW_ID = 'flauz.models';

/** Focus + refresh commands for the view (category "Flauz", see package.json). */
export const VIEW_COMMAND_IDS = [
	'flauz.focusView.models',
	'flauz.models.refreshView',
] as const;

/** A single Models view row. */
export interface ModelsRow {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly tooltip: string;
	readonly icon: string;
	readonly contextValue: string;
}

/** Registered provider info the view renders (supplied by extension.ts). */
export interface RegisteredProviderInfo {
	readonly vendor: string;
	readonly modelId: string;
	readonly modelName: string;
}

/** The design-only vendor plans, in stable display order. */
export const VENDOR_PLANS: readonly VendorPlan[] = [claudeVendorPlan, codexVendorPlan, qwenVendorPlan];

/** Builds the rows (pure; exported for tests). */
export function modelsRows(registered: readonly RegisteredProviderInfo[]): ModelsRow[] {
	const rows: ModelsRow[] = registered.map(provider => ({
		id: `registered-${provider.vendor}`,
		label: provider.vendor,
		description: `registered · ${provider.modelId} · ${provider.modelName}`,
		tooltip: `Vendor '${provider.vendor}' is REGISTERED and serving model '${provider.modelId}' (${provider.modelName}) through the stable language-model provider API.`,
		icon: 'sparkle',
		contextValue: 'flauzModelRegistered',
	}));
	for (const plan of VENDOR_PLANS) {
		rows.push({
			id: `stub-${plan.vendor}`,
			label: plan.vendor,
			description: `design stub · ${plan.models.map(model => model.id).join(', ')} · not registered`,
			tooltip: `Vendor '${plan.vendor}' is a DESIGN-ONLY plan (${plan.displayName}, ${plan.models.length} model${plan.models.length === 1 ? '' : 's'}): no adapter, no network, no secrets. It pins the registration shape a future adapter will make.`,
			icon: 'circle',
			contextValue: 'flauzModelStub',
		});
	}
	return rows;
}

/** The vscode slices the view needs (injected: real api in extension.ts, doubles in tests). */
export interface ModelsViewApi {
	registerTreeDataProvider(viewId: string, provider: vscode.TreeDataProvider<ModelsRow>): vscode.Disposable;
	registerCommand(command: string, handler: (arg?: unknown) => unknown): vscode.Disposable;
	executeCommand(command: string, ...args: unknown[]): Thenable<unknown>;
	EventEmitter: new <T>() => vscode.EventEmitter<T>;
	TreeItem: typeof vscode.TreeItem;
	ThemeIcon: typeof vscode.ThemeIcon;
	TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
}

/** The Models tree: registered providers + honestly-labeled design stubs. */
export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelsRow> {
	private readonly api: ModelsViewApi;
	private readonly getRegistered: () => readonly RegisteredProviderInfo[];
	private readonly emitter: vscode.EventEmitter<ModelsRow | undefined>;

	constructor(api: ModelsViewApi, getRegistered: () => readonly RegisteredProviderInfo[]) {
		this.api = api;
		this.getRegistered = getRegistered;
		this.emitter = new api.EventEmitter<ModelsRow | undefined>();
	}

	/** Re-reads the provider registry on the next tree refresh. */
	refresh(): void {
		this.emitter.fire(undefined);
	}

	get onDidChangeTreeData(): vscode.Event<ModelsRow | undefined> {
		return this.emitter.event;
	}

	async getChildren(): Promise<ModelsRow[]> {
		return modelsRows(this.getRegistered());
	}

	getTreeItem(element: ModelsRow): vscode.TreeItem {
		const api = this.api;
		const item = new api.TreeItem(element.label, api.TreeItemCollapsibleState.None);
		item.id = `flauz.models/${element.id}`;
		item.description = element.description;
		item.tooltip = element.tooltip;
		item.iconPath = new api.ThemeIcon(element.icon);
		item.contextValue = element.contextValue;
		item.accessibilityInformation = { label: `${element.label}: ${element.description}` };
		return item;
	}
}

/** Registers the tree data provider plus its focus/refresh commands. */
export function registerModelsView(api: ModelsViewApi, getRegistered: () => readonly RegisteredProviderInfo[]): { readonly disposables: readonly vscode.Disposable[]; readonly provider: ModelsTreeProvider } {
	const provider = new ModelsTreeProvider(api, getRegistered);
	const handlers: Record<(typeof VIEW_COMMAND_IDS)[number], () => unknown> = {
		'flauz.focusView.models': () => api.executeCommand(`${MODELS_VIEW_ID}.focus`),
		'flauz.models.refreshView': () => provider.refresh(),
	};
	return {
		provider,
		disposables: [
			api.registerTreeDataProvider(MODELS_VIEW_ID, provider),
			...VIEW_COMMAND_IDS.map(id => api.registerCommand(id, handlers[id])),
		],
	};
}
