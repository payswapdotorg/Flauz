/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for src/extension.ts activation.
 *
 * src/extension.ts value-imports 'vscode', so it is loaded through the
 * module-redirect harness (test/harness/vscode-redirect.ts), which maps the
 * 'vscode' specifier to test/harness/vscode-mock-module.ts at runtime. The
 * mock module's `lm` singleton is imported directly here to observe what
 * activate() registered (same URL => same instance the redirect serves).
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { importWithVscodeMock } from './harness/vscode-redirect.ts';
import { lm } from './harness/vscode-mock-module.ts';
import { __resetViewState, __viewState } from './harness/vscode-mock-module.ts';
import { createMockContext, type MockExtensionContext } from './harness/vscode-mock.ts';

/** The slice of src/extension.ts's public surface the tests exercise. */
interface TestableExtensionModule {
	activate(context: MockExtensionContext): void;
	deactivate(): void;
}

const EXTENSION_URL = new URL('../src/extension.ts', import.meta.url);

test('activate registers exactly one language model chat provider for vendor flauz-mock', async () => {
	lm.reset();
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	await extension.activate(createMockContext());
	strictEqual(lm.registrations.length, 1, 'activate must register exactly one provider');
	strictEqual(lm.registrations[0].vendor, 'flauz-mock', 'the provider must be registered under the flauz-mock vendor');
});

test('activate pushes the provider disposable onto context.subscriptions', async () => {
	lm.reset();
	__resetViewState();
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	const context = createMockContext();
	await extension.activate(context);
	// TL4-001: the provider disposable FIRST, then the view disposables
	// (tree data provider + the two view commands).
	strictEqual(context.subscriptions.length, 4, 'provider + view provider + 2 view commands');
	const disposable = context.subscriptions[0];
	ok(disposable, 'subscriptions[0] must exist');
	ok(typeof disposable.dispose === 'function', 'the pushed value must be a Disposable');
	disposable.dispose();
	strictEqual(lm.registrations[0].disposed, true, 'disposing the pushed disposable unregisters the provider');
	// the view wired through the redirect mock records its registration
	strictEqual(__viewState.treeViews.length, 1, 'the flauz.models view registers');
	strictEqual(__viewState.treeViews[0]?.viewId, 'flauz.models');
	deepStrictEqual(__viewState.commands.map(record => record.command).sort(), ['flauz.focusView.models', 'flauz.models.refreshView']);
});

test('deactivate is exported as a no-op', async () => {
	const extension = await importWithVscodeMock<TestableExtensionModule>(EXTENSION_URL);
	ok(typeof extension.deactivate === 'function', 'deactivate must be an exported function');
	strictEqual(extension.deactivate(), undefined, 'deactivate must return nothing and throw nothing');
});
