/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Minimal ambient 'vscode' module surface for the flauz-acceptance extension
 * (UNVERIFIED-BY-ME: the W1 sibling's vscode-dts copy was not in the unblock
 * packet; this authored shim declares exactly the surface this extension
 * consumes -- command registration, the output channel, the workspace-root
 * probe and the extension-context subscriptions -- and may be reconciled
 * with the sibling's copy by the station).
 */

declare module 'vscode' {
	export interface Disposable {
		dispose(): void;
	}

	export interface ExtensionContext {
		readonly subscriptions: { push(disposable: Disposable): void };
	}

	export interface OutputChannel extends Disposable {
		appendLine(line: string): void;
	}

	export interface WorkspaceFolder {
		readonly uri: { readonly fsPath: string };
	}

	export namespace window {
		export function createOutputChannel(name: string): OutputChannel;
	}

	export namespace workspace {
		export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
	}

	export namespace commands {
		export function registerCommand(command: string, handler: (...args: any[]) => any): Disposable;
	}
}
