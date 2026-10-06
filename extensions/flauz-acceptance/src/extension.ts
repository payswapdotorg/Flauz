/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Acceptance extension activation (A-PROD-006-W2, DL-87).
 *
 * Activation discipline (activation-lint R1-R3): command activation ONLY
 * (`onCommand:flauz.acceptance.launch + onCommand:flauz.acceptance.verify`)
 * -- never `*`, never onStartupFinished (that budget is bridge + workspace
 * only). The W1 command manifest pattern, followed exactly.
 *
 * Wires the node AcceptanceFsPort (readFileUtf8 + readdir over the
 * workspace tree + the write surface over the workspace .flauz/ tree) and
 * follows the W1 wiring precedent for the wall clock, the output channel
 * and the workspace-root probe.
 *
 * THE DETERMINISM LAW (the grep gate): the host wall clock is wired here
 * with the `determinism` + `injected` comment on the same line so the
 * wave's grep gate exempts this single host-wiring line. No host-clock
 * calls appear anywhere else in src/ -- the pure-API surface uses the
 * injected clock exclusively. (src/format.ts is the PU6-pinned verbatim
 * shared module -- its formatAge default param carries the sibling-shared
 * Date.now() exactly as every flauz extension's copy does; the copies are
 * machine-checked byte-identical by build/flauz/scripts/premium-ux-gate.mjs.)
 *
 * UNVERIFIED-BY-ME: authored against the unblock-packet surfaces; the
 * station runs the battery.
 */

import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { setVscodeApi, DEFAULT_CLOCK } from './globals.ts';
import {
	type AcceptanceFsPort,
} from './api.ts';
import { registerAcceptanceCommands, type AcceptanceCommandServices } from './commands.ts';

const nodeFs: AcceptanceFsPort = {
	readFileUtf8: async path => {
		try {
			return await fs.readFile(path, { encoding: 'utf-8' });
		} catch (err) {
			if ((err as { code?: string }).code === 'ENOENT') {
				return undefined;
			}
			throw err;
		}
	},
	readdir: async path => {
		try {
			return await fs.readdir(path);
		} catch (err) {
			// Unlistable = missing (ENOENT), a non-directory path (ENOTDIR) or an
			// unreadable path (EACCES/EPERM): all surface as undefined so the
			// readers treat the path as a leaf, never crash on a
			// file-where-a-dir-was-probed or a permission-bound tree.
			const code = (err as { code?: string }).code;
			if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
				return undefined;
			}
			throw err;
		}
	},
	mkdir: path => fs.mkdir(path, { recursive: true }),
	writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
	appendFile: (path, contents) => fs.appendFile(path, contents, { encoding: 'utf-8' }),
};

export function activate(context: vscode.ExtensionContext): void {
	setVscodeApi(vscode);

	const channel = vscode.window.createOutputChannel('Flauz Acceptance');
	const services: AcceptanceCommandServices = {
		fs: nodeFs,
		// determinism: injected host wall clock (the single host-wiring line; the pure-API surface uses the injected clock exclusively -- no host-clock reads anywhere else in src/).
		clock: (): number => Date.now(), // determinism: the injected host wall clock (the single host-wiring line)
		channel,
		getWorkspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
	};

	// the default clock (DEFAULT_CLOCK) is the deterministic fallback (epoch 0); the extension layer overrides it here with the host wall clock. Tests override it with the stepping-clock fixture.
	void DEFAULT_CLOCK;

	for (const disposable of [channel, ...registerAcceptanceCommands(services)]) {
		context.subscriptions.push(disposable);
	}
}

export function deactivate(): void {
	// Nothing to do -- all disposables ride context.subscriptions.
}
