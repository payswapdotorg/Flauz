/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The flauz-execution extension wiring (TL2-S2). Minimal by design: the
 * PRIMARY consumer of this module is the durable orchestration runtime
 * (extensions/flauz-agent) at the effect-sink boundary; these commands are
 * the operator surface over the additive execution journal.
 *
 * No views (ia-gate clean by construction), no startup activation
 * (activation-lint R3: onCommand only), no proposed APIs.
 */

import * as vscode from 'vscode';
import { ExecJournalStore } from './journal.ts';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspaceRoot === undefined) {
		vscode.window.showWarningMessage('flauz-execution: no workspace folder open - the execution journal stays inactive.');
		return;
	}

	const openStore = (): ExecJournalStore | undefined => {
		try {
			return new ExecJournalStore(workspaceRoot);
		} catch (error) {
			vscode.window.showErrorMessage(`flauz-execution: journal load failed (fail-closed): ${(error as Error).message}`);
			return undefined;
		}
	};

	const status = vscode.commands.registerCommand('flauz.exec.status', () => {
		const store = openStore();
		if (store === undefined) {
			return;
		}
		const acquisitions = [...store.acquisitions().values()];
		const held = acquisitions.filter((acquisition) => acquisition.state === 'acquired');
		const lines = [
			`flauz.execution-journal/v0: ${String(store.rowsAll().length)} row(s), ${String(acquisitions.length)} acquisition(s)`,
			`held: ${String(held.length)} | lost: ${String(acquisitions.filter((a) => a.state === 'lost').length)} | released: ${String(acquisitions.filter((a) => a.state === 'released').length)} | expired: ${String(acquisitions.filter((a) => a.state === 'expired').length)}`,
			store.tornTail === null ? 'no torn tail' : `torn tail dropped at load: ${store.tornTail.reason}`,
		];
		vscode.window.showInformationMessage(lines.join(' - '));
	});

	const verify = vscode.commands.registerCommand('flauz.exec.verify', () => {
		const store = openStore();
		if (store === undefined) {
			return;
		}
		const report = store.verifyJournal();
		if (report.ok) {
			vscode.window.showInformationMessage(`flauz-execution: journal verified (${String(report.rows)} rows, hash chain intact).`);
		} else {
			vscode.window.showErrorMessage(`flauz-execution: journal BROKEN at seq ${String(report.firstBadSeq)} (fail-closed).`);
		}
	});

	context.subscriptions.push(status, verify);
}
