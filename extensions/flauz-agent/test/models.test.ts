/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for model selection (vendor preference + graceful no-models state).
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual } from 'node:assert';
import { selectPreferredModels, modelAttribution, NO_MODELS_MESSAGE, PREFERRED_VENDORS } from '../src/models.ts';

function fakeModel(vendor: string, id: string) {
	return { vendor, id, family: `${vendor}-family`, version: '1', name: id, maxInputTokens: 1, maxOutputTokens: 1, sendRequest: async () => { throw new Error('not used'); }, countTokens: async () => 0 };
}

test('selectPreferredModels ranks flauz-mock first and keeps the rest stable', async () => {
	const models = [fakeModel('copilot', 'gpt-x'), fakeModel('flauz-mock', 'echo-1'), fakeModel('openai', 'gpt-4o'), fakeModel('flauz-mock', 'echo-2')];
	const selection = await selectPreferredModels(async () => models);
	strictEqual(selection.status, 'ready');
	deepStrictEqual(selection.models.map((model) => `${model.vendor}/${model.id}`), ['flauz-mock/echo-1', 'flauz-mock/echo-2', 'copilot/gpt-x', 'openai/gpt-4o']);
	strictEqual(PREFERRED_VENDORS[0], 'flauz-mock');
});

test('empty model list degrades gracefully to the no-models state', async () => {
	const selection = await selectPreferredModels(async () => []);
	strictEqual(selection.status, 'no-models');
	deepStrictEqual(selection.models, []);
	ok(selection.message?.includes('flauz-models'), 'message points at the vendor pack');
	strictEqual(modelAttribution(selection), NO_MODELS_MESSAGE);
	ok(modelAttribution({ models: [fakeModel('flauz-mock', 'echo-1')], status: 'ready' }).startsWith('Model in scope: flauz-mock/'));
});
