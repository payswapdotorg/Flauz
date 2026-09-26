/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tests for the deterministic flauz-mock echo provider (src/mockProvider.ts).
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual } from 'node:assert';

import { buildEchoResponse, createMockProvider, ECHO_MODEL_INFO } from '../src/mockProvider.ts';
import { assistantMessage, collectStream, MockCancellationToken, userMessage } from './harness/vscode-mock.ts';

const PROMPT = 'the quick brown fox jumps over the lazy dog and keeps running';

test('buildEchoResponse is deterministic: same input, identical chunk array', () => {
	const first = buildEchoResponse(PROMPT);
	const second = buildEchoResponse(PROMPT);
	deepStrictEqual(second, first, 'repeated calls must return the identical chunk array');
	deepStrictEqual(buildEchoResponse(''), buildEchoResponse(''), 'empty prompts are deterministic too');
	// Deterministic AND lossless: chunks concatenate back to the exact echo string.
	strictEqual(first.join(''), `flauz-mock echo: ${PROMPT}`);
	strictEqual(buildEchoResponse('').join(''), 'flauz-mock echo: (empty prompt)');
});

test('echo responses carry the flauz-mock echo: prefix', () => {
	const chunks = buildEchoResponse(PROMPT);
	ok(chunks.length > 0, 'there is always at least one chunk');
	ok(chunks[0].startsWith('flauz-mock echo:'), 'the first chunk starts with the echo prefix');
	ok(chunks.every((chunk) => chunk.length > 0), 'no empty chunks');
	const empty = buildEchoResponse('');
	ok(empty.join('').startsWith('flauz-mock echo: (empty prompt)'), 'the no-user-text placeholder is echoed');
});

test('multi-word prompts stream in three or more chunks', () => {
	const chunks = buildEchoResponse(PROMPT);
	ok(chunks.length >= 3, `expected at least 3 chunks, got ${chunks.length}`);
	ok(buildEchoResponse('one two three four five six seven').length >= 3, 'a plain multi-word prompt also yields >= 3 chunks');
});

test('provideLanguageModelChatInformation returns exactly the documented echo-1 model', async () => {
	const provider = createMockProvider();
	const models = (await provider.provideLanguageModelChatInformation({ silent: true }, new MockCancellationToken())) ?? [];
	strictEqual(models.length, 1, 'exactly one model is served');
	deepStrictEqual(models[0], {
		id: 'echo-1',
		name: 'Flauz Mock Echo',
		family: 'flauz-echo',
		version: '1',
		maxInputTokens: 8192,
		maxOutputTokens: 4096,
		capabilities: {},
	}, 'the model carries the documented metadata');
	strictEqual(models[0], ECHO_MODEL_INFO, 'the served model is the canonical ECHO_MODEL_INFO');
});

test('streaming concatenates to the full echo of the LAST user message', async () => {
	const provider = createMockProvider();
	const token = new MockCancellationToken();
	const messages = [
		userMessage('ignored earlier prompt'),
		assistantMessage('ignored earlier answer'),
		userMessage(PROMPT),
	];
	const text = await collectStream(provider, messages, token);
	strictEqual(text, `flauz-mock echo: ${PROMPT}`, 'only the last user message is echoed, chunk concatenation included');
	// And a request without any user message gets the fixed placeholder.
	const empty = await collectStream(provider, [assistantMessage('only an assistant turn')], token);
	strictEqual(empty, 'flauz-mock echo: (empty prompt)');
});

test('cancellation stops the stream early and deterministically', async () => {
	const provider = createMockProvider();
	const token = new MockCancellationToken();
	const chunks = buildEchoResponse(PROMPT);
	ok(chunks.length >= 3, 'test premise: the echo for this prompt has multiple chunks');
	let reported = 0;
	const text = await collectStream(provider, [userMessage(PROMPT)], token, () => {
		reported += 1;
		if (reported >= 1) {
			token.isCancellationRequested = true; // flip after the first chunk — deterministic
		}
	});
	strictEqual(reported, 1, 'only the first chunk is reported once cancellation is requested');
	strictEqual(text, chunks[0], 'the collected stream stops at the first chunk');
	ok(text.length < `flauz-mock echo: ${PROMPT}`.length, 'the cancelled stream is shorter than the full echo');
});
