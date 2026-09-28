/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * flauz-models extension entry (Wave 3 Lane F; TL2-002 fabric bootstrap).
 *
 * Activation is LAZY: the activation events are `onView:flauz.models` and
 * `onLanguageModelChatProvider:<vendor>` (the mock + the three adapter
 * vendors), the latter emitted by the editor when a consumer actually needs
 * a model of that vendor (languageModels.ts activationEventsGenerator,
 * src/vs/workbench/contrib/chat/common/languageModels.ts:910-914). This
 * follows PERFORMANCE-PLAN section 2.1 (no startup cost for vendors nobody
 * has selected).
 *
 * On activation:
 *  1. the deterministic flauz-mock provider registers through the STABLE
 *     API `vscode.lm.registerLanguageModelChatProvider` (vscode.d.ts:20851)
 *     -- DL-4: stable APIs only;
 *  2. the TL2-002 fabric bootstraps (src/fabric.ts): the durable capability
 *     registry recovers from `.flauz/models`, the routing + tool policies
 *     materialize, and the three adapter-backed vendors register
 *     SYNCHRONOUSLY with model lists that arrive when the registry is ready
 *     (a DISABLED provider reports zero models -- the honest zero-network
 *     default; enabling is an explicit act in `.flauz/models/providers.json`);
 *  3. the `flauz.models` view renders the fabric state (registered vendors,
 *     design stubs, capability records, routing default, tool policy) with
 *     honest status labels (TL4-001/002 posture).
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';

import { bootstrapFabric, FABRIC_VENDORS } from './fabric.ts';
import { nodeHttpPort } from './contract/nodePorts.ts';
import type { FileSystemPort, SecretResolverPort } from './contract/ports.ts';
import { createMockProvider, ECHO_MODEL_INFO, MOCK_VENDOR_ID } from './mockProvider.ts';
import { registerModelsView } from './views.ts';

/** node:fs-backed FileSystemPort (sync implementation; .flauz state files are small). */
function nodeFileSystemPort(): FileSystemPort {
	return {
		async readFileUtf8(path) {
			try {
				return fs.readFileSync(path, 'utf-8');
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw error;
			}
		},
		async writeFile(path, contents) {
			fs.writeFileSync(path, contents, 'utf-8');
		},
		async rename(from, to) {
			fs.renameSync(from, to);
		},
		async mkdir(path) {
			try {
				fs.mkdirSync(path);
			} catch (error) {
				if ((error as { code?: string }).code === 'EEXIST') {
					return;
				}
				throw error;
			}
		},
	};
}

/**
 * Credential resolver: `env:<NAME>` from the process environment;
 * `vault:<NAME>` from the workspace secret surface (the extension-context
 * SecretStorage). References only -- key material is never copied into
 * Flauz state, logs or artifacts, and an unresolvable reference fails
 * closed (CREDENTIAL_UNRESOLVED) before any traffic.
 */
function contextSecretResolver(context: vscode.ExtensionContext): SecretResolverPort {
	return {
		async resolve(ref) {
			if (ref.startsWith('env:')) {
				return process.env[ref.slice('env:'.length)];
			}
			if (ref.startsWith('vault:')) {
				return context.secrets?.get(ref.slice('vault:'.length));
			}
			return undefined;
		},
	};
}

export function activate(context: vscode.ExtensionContext): void {
	// 1. The deterministic mock vendor (stable API, vscode.d.ts:20851; the
	//    vendor is declared via the languageModelChatProviders contribution).
	const disposable = vscode.lm.registerLanguageModelChatProvider(MOCK_VENDOR_ID, createMockProvider());
	context.subscriptions.push(disposable);
	// 2. The TL2-002 fabric: registry + policies + adapter-backed vendors.
	const workspaceRoot = vscode.workspace?.workspaceFolders?.[0]?.uri.fsPath;
	const fabric = bootstrapFabric({
		root: workspaceRoot,
		fs: nodeFileSystemPort(),
		clock: () => Date.now(),
		secrets: contextSecretResolver(context),
		hash: { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') },
		http: nodeHttpPort,
		log: message => console.log(message),
	});
	for (const entry of FABRIC_VENDORS) {
		context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(entry.vendor, fabric.providerFor(entry)));
	}
	// 3. The view (registered vendors + stubs + fabric state, honestly labeled).
	const view = registerModelsView(
		{
			registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
			registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
			executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
			EventEmitter: vscode.EventEmitter,
			TreeItem: vscode.TreeItem,
			ThemeIcon: vscode.ThemeIcon,
			TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
		},
		() => [{ vendor: MOCK_VENDOR_ID, modelId: ECHO_MODEL_INFO.id, modelName: ECHO_MODEL_INFO.name }],
		fabric.summary,
	);
	for (const viewDisposable of view.disposables) {
		context.subscriptions.push(viewDisposable);
	}
	// Minimal logging for v0: no output channel, no other side effects.
	console.log(`[flauz-models] registered language model chat provider '${MOCK_VENDOR_ID}' (echo-1) + ${FABRIC_VENDORS.length} adapter-backed vendors (model lists gated by the enabled state)`);
}

export function deactivate(): void {
	// Nothing to clean up: every disposable lives in context.subscriptions.
}
