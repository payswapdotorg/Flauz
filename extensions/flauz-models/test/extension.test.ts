/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/extension.ts activation (TL2-002 fabric posture).
 *
 * src/extension.ts value-imports 'vscode', so it is loaded through the
 * module-redirect harness (test/harness/vscode-redirect.ts). The default
 * (no workspace root) activation is the ZERO-NETWORK posture: the mock
 * vendor registers, the three adapter vendors register with EMPTY model
 * lists (disabled providers report zero models), nothing durable is
 * written. With a workspace root pinned, the durable `.flauz/models` state
 * materializes and an ENABLED provider (via the workspace providers file)
 * serves its models through the vscode provider surface.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { importWithVscodeMock } from './harness/vscode-redirect.ts';
import { lm, __resetViewState, __viewState, __setWorkspaceRoot } from './harness/vscode-mock-module.ts';
import { createMockContext, MockCancellationToken } from './harness/vscode-mock.ts';

/** The slice of src/extension.ts's public surface the tests exercise. */
interface TestableExtensionModule {
	activate(context: { subscriptions: Array<{ dispose(): void }>; secrets?: { get(key: string): Promise<string | undefined> } }): void;
	deactivate(): void;
}

const EXTENSION_URL = new URL('../src/extension.ts', import.meta.url);

const ALL_VENDORS = ['flauz-anthropic-compat', 'flauz-mock', 'flauz-ollama', 'flauz-openai-compat'];

test('activate registers the mock vendor plus the three adapter-backed vendors', async () => {
	lm.reset();
	__resetViewState();
	__setWorkspaceRoot(undefined);
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	await extension.activate(createMockContext());
	deepStrictEqual(lm.registrations.map(registration => registration.vendor).sort(), ALL_VENDORS, 'mock + three adapter vendors, all contributed in package.json');
});

test('activate pushes every disposable onto context.subscriptions (4 providers + view)', async () => {
	lm.reset();
	__resetViewState();
	__setWorkspaceRoot(undefined);
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	const context = createMockContext();
	await extension.activate(context);
	// 4 provider registrations + tree data provider + 2 view commands
	strictEqual(context.subscriptions.length, 7, '4 providers + view provider + 2 view commands');
	for (const disposable of context.subscriptions) {
		ok(typeof disposable.dispose === 'function', 'every pushed value is a Disposable');
	}
	strictEqual(__viewState.treeViews.length, 1, 'the flauz.models view registers');
	strictEqual(__viewState.treeViews[0]?.viewId, 'flauz.models');
	deepStrictEqual(__viewState.commands.map(record => record.command).sort(), ['flauz.focusView.models', 'flauz.models.refreshView']);
});

test('zero-network default: adapter vendors register but report ZERO models (honest disabled posture)', async () => {
	lm.reset();
	__resetViewState();
	__setWorkspaceRoot(undefined);
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	await extension.activate(createMockContext());
	const token = new MockCancellationToken();
	for (const vendor of ['flauz-openai-compat', 'flauz-anthropic-compat', 'flauz-ollama']) {
		const registration = lm.registrations.find(entry => entry.vendor === vendor);
		ok(registration !== undefined, `${vendor} registered`);
		const models = (await registration.provider.provideLanguageModelChatInformation({ silent: true }, token)) ?? [];
		deepStrictEqual(models, [], `${vendor} reports zero models while disabled (no network posture gained implicitly)`);
	}
	const mockRegistration = lm.registrations.find(entry => entry.vendor === 'flauz-mock');
	ok(mockRegistration !== undefined);
	const mockModels = (await mockRegistration.provider.provideLanguageModelChatInformation({ silent: true }, token)) ?? [];
	strictEqual(mockModels.length, 1, 'the mock still serves echo-1');
	strictEqual(mockModels[0].id, 'echo-1');
});

test('durable posture: a workspace root materializes the .flauz/models state', async () => {
	lm.reset();
	__resetViewState();
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-models-activate-'));
	try {
		__setWorkspaceRoot(root);
		const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
		await extension.activate(createMockContext());
		// the fabric loads asynchronously; poll briefly for the durable files
		const expected = ['.flauz/models/capabilities.json', '.flauz/models/routing-policy.json', '.flauz/models/tool-policy.json'];
		const deadline = Date.now() + 5000;
		let allPresent = false;
		while (Date.now() < deadline) {
			allPresent = expected.every(relative => fs.existsSync(path.join(root, relative)));
			if (allPresent) {
				break;
			}
			await new Promise<void>(resolve => setTimeout(resolve, 25));
		}
		strictEqual(allPresent, true, 'capabilities + routing policy + tool policy materialize under .flauz/models');
		const capabilities = JSON.parse(fs.readFileSync(path.join(root, '.flauz/models/capabilities.json'), 'utf-8')) as { schema: string; records: ReadonlyArray<{ providerId: string; enabled: boolean }> };
		strictEqual(capabilities.schema, 'flauz.model-capabilities/v0');
		ok(capabilities.records.some(record => record.providerId === 'flauz-mock' && record.enabled));
		ok(capabilities.records.some(record => record.providerId === 'openai-compat' && !record.enabled), 'remote vendors stay disabled by default');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		__setWorkspaceRoot(undefined);
	}
});

test('enabling a provider through the workspace providers file surfaces its models through the vscode provider', async () => {
	lm.reset();
	__resetViewState();
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-models-enable-'));
	try {
		fs.mkdirSync(path.join(root, '.flauz/models'), { recursive: true });
		fs.writeFileSync(
			path.join(root, '.flauz/models/providers.json'),
			JSON.stringify({ schema: 'flauz.model-providers/v0', schemaVersion: 0, updatedAt: 1, providers: [{ providerId: 'ollama-local', enabled: true, models: [{ modelId: 'llama3.1:8b', modelName: 'Llama 3.1 8B', family: 'llama3.1', version: '1', contextWindowTokens: 4096, maxOutputTokens: 512, inputModalities: ['text'], toolCalling: false }] }] }, null, 2) + '\n',
			'utf-8',
		);
		__setWorkspaceRoot(root);
		const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
		await extension.activate(createMockContext());
		const registration = lm.registrations.find(entry => entry.vendor === 'flauz-ollama');
		ok(registration !== undefined, 'flauz-ollama registered');
		const deadline = Date.now() + 5000;
		let models: ReadonlyArray<{ id: string; maxInputTokens: number }> = [];
		while (Date.now() < deadline) {
			models = ((await registration.provider.provideLanguageModelChatInformation({ silent: true }, new MockCancellationToken())) ?? []) as ReadonlyArray<{ id: string; maxInputTokens: number }>;
			if (models.length > 0) {
				break;
			}
			await new Promise<void>(resolve => setTimeout(resolve, 25));
		}
		strictEqual(models.length, 1, 'the enabled local model surfaces through the provider');
		strictEqual(models[0].id, 'llama3.1:8b');
		strictEqual(models[0].maxInputTokens, 4096 - 512 - 409, 'M4 budget input reserve: 4096 - 512 output - 409 tool');
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		__setWorkspaceRoot(undefined);
	}
});

test('deactivate is exported as a no-op', async () => {
	__setWorkspaceRoot(undefined);
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	ok(typeof extension.deactivate === 'function', 'deactivate must be an exported function');
	strictEqual(extension.deactivate(), undefined, 'deactivate must return nothing and throw nothing');
});
