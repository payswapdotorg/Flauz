/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Activation-wiring tests for src/extension.ts, driven against the redirected
 * 'vscode' mock (the Wave-3 flauz-agent harness pattern): command registration,
 * .flauz/workflows bootstrap, no-workspace degradation, and the shell executor.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importWithVscodeMock } from './vscodeRedirect.ts';
import { __configure, __reset, __state } from './vscodeMockModule.ts';

const EXTENSION_URL = new URL('../src/extension.ts', import.meta.url);

interface ExtensionModule {
	activate(context: { subscriptions: Array<{ dispose(): void }> }): Promise<void>;
	deactivate(): void;
	shellExecutor(root: string): (step: { input: { command?: unknown } }) => Promise<{ ok: boolean; output: string }>;
}

test('activate registers the three workflow commands and bootstraps .flauz/workflows', async () => {
	__reset();
	const root = mkdtempSync(join(tmpdir(), 'flauz-wf-ext-'));
	__configure({ workspaceFolders: [{ uri: { fsPath: root } }] });
	const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
	const context = { subscriptions: [] as Array<{ dispose(): void }> };
	await extension.activate(context);
	try {
		assert.deepEqual(__state().registeredCommands.slice().sort(), ['flauz.workflow.list', 'flauz.workflow.run', 'flauz.workflow.save']);
		await new Promise<void>(resolve => { setTimeout(resolve, 250); });
		const index = readFileSync(join(root, '.flauz', 'workflows', 'index.json'), { encoding: 'utf-8' });
		assert.equal(index, '{\n  "$schema": "flauz.workflows/v1",\n  "workflows": []\n}\n');
	} finally {
		for (const disposable of context.subscriptions) {
			disposable.dispose();
		}
	}
});

test('activate without a workspace folder degrades gracefully (warning, no throw)', async () => {
	__reset();
	const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
	const context = { subscriptions: [] as Array<{ dispose(): void }> };
	await extension.activate(context);
	assert.equal(__state().registeredCommands.length, 0);
	assert.equal(__state().messages.length, 1);
	assert.match(__state().messages[0] as string, /no workspace folder open/);
});

test('shellExecutor runs a recorded command in the workspace root and captures output', async () => {
	__reset();
	const root = mkdtempSync(join(tmpdir(), 'flauz-wf-sh-'));
	const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
	const executor = extension.shellExecutor(root);
	const ok = await executor({ input: { command: 'echo flauz-canary-ok' } });
	assert.equal(ok.ok, true);
	assert.equal(ok.output, 'flauz-canary-ok');
	const failed = await executor({ input: { command: 'exit 3' } });
	assert.equal(failed.ok, false);
	const noCommand = await executor({ input: {} });
	assert.equal(noCommand.ok, false);
	assert.match(noCommand.output, /no recorded command/);
});
