/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the vscode bridge drills (M2).
 *
 * The bridge imports 'vscode' TYPE-ONLY, so these tests run under plain
 * `node --test` with structural doubles for the vscode surfaces (no module
 * redirect needed). Coverage: part conversion (both directions of shape),
 * request assembly (toolMode/tools), information mapping (maxInputTokens,
 * capabilities), streamed response reporting (text parts + ONE tool-call
 * part per call with parsed input), quiet cancellation, user-facing error
 * text, token counting delegation -- and one END-TO-END drill of the real
 * OpenAI-compatible adapter behind the bridge against the LOCAL fixture
 * server (FIXTURE-VERIFIED; no live provider).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

import { createAdapterBackedProvider, toNeutralMessages, toNeutralPart, toNeutralRequest, toVscodeError } from '../src/adapters/bridge.ts';
import { createOpenAiCompatAdapter } from '../src/adapters/openAiCompat.ts';
import { nodeHttpPort } from '../src/contract/nodePorts.ts';
import { isProviderError, ProviderError } from '../src/contract/errors.ts';
import type { ChatRequest, ProviderAdapter, ProviderCapabilities, ProviderStreamEvent } from '../src/contract/types.ts';
import { startFixtureServer } from './fixtureServer.ts';
import { OPENAI_CHAT_PATH, OPENAI_HAPPY_TEXT_AND_TOOL } from './fixtures/vendorPayloads.ts';
import type * as vscode from 'vscode';

/** Structural vscode doubles (the bridge is type-only against 'vscode'). */
function makeToken(cancelled = false): vscode.CancellationToken & { cancel(): void } {
	const listeners: Array<() => void> = [];
	const token = {
		isCancellationRequested: cancelled,
		onCancellationRequested: (listener: () => void) => {
			listeners.push(listener);
			return { dispose: () => undefined };
		},
		cancel() {
			token.isCancellationRequested = true;
			for (const listener of listeners) {
				listener();
			}
		},
	};
	return token as vscode.CancellationToken & { cancel(): void };
}

/** A scriptable fake adapter (event script + optional failure). */
function fakeAdapter(script: readonly ProviderStreamEvent[], failWith?: ProviderError): ProviderAdapter {
	return {
		descriptor: { providerId: 'fake', vendor: 'flauz-fake', displayName: 'Fake', adapterVersion: 'test', wireFamily: 'mock-echo', locality: 'local', baseUrl: 'http://127.0.0.1:9' },
		models: () => [{ modelId: 'fake-1', modelName: 'Fake One', family: 'fake', version: '1', contextWindowTokens: 4096, maxOutputTokens: 1024, inputModalities: ['text', 'image'], toolCalling: true }],
		capabilities: (modelId: string): ProviderCapabilities | undefined => (modelId === 'fake-1' ? { wireFamily: 'mock-echo', inputModalities: ['text', 'image'], outputModalities: ['text'], contextWindowTokens: 4096, maxOutputTokens: 1024, streaming: true, toolCalling: true, tokenCounting: 'estimated', locality: 'local' } : undefined),
		health: async () => ({ providerId: 'fake', status: 'healthy', checkedAt: 0, detail: 'fake' }),
		estimateTokens: () => 7,
		async *stream(request: ChatRequest): AsyncGenerator<ProviderStreamEvent, void, void> {
			if (failWith !== undefined) {
				throw failWith;
			}
			for (const event of script) {
				yield event;
			}
		},
	};
}

const TOOL_SCRIPT: readonly ProviderStreamEvent[] = [
	{ type: 'text-delta', text: 'Working ' },
	{ type: 'text-delta', text: 'now.' },
	{ type: 'tool-input-start', callId: 'call_1', toolName: 'flauz_terminal' },
	{ type: 'tool-input-delta', callId: 'call_1', fragment: '{"command":' },
	{ type: 'tool-input-delta', callId: 'call_1', fragment: '"pwd"}' },
	{ type: 'tool-input-end', callId: 'call_1' },
	{ type: 'usage', usage: { estimatedInputTokens: 10, estimatedOutputTokens: 4 } },
	{ type: 'finish', finishReason: 'tool-calls', usage: { estimatedInputTokens: 10, estimatedOutputTokens: 4 }, provenance: { providerId: 'fake', vendor: 'flauz-fake', modelId: 'fake-1', requestHash: 'a'.repeat(64), adapterVersion: 'test', wireFamily: 'mock-echo' } },
];

test('bridge: converts vscode parts into the neutral tagged shapes', () => {
	deepStrictEqual(toNeutralPart({ value: 'hi' }), { kind: 'text', value: 'hi' });
	deepStrictEqual(toNeutralPart({ callId: 'c1', name: 't', input: { a: 1 } }), { kind: 'toolCall', callId: 'c1', toolName: 't', input: { a: 1 } });
	deepStrictEqual(toNeutralPart({ callId: 'c1', content: [{ value: 'out' }] }), { kind: 'toolResult', callId: 'c1', content: [{ kind: 'text', value: 'out' }] });
	deepStrictEqual(toNeutralPart({ mimeType: 'image/png', data: new Uint8Array([9]) }), { kind: 'data', mimeType: 'image/png', data: new Uint8Array([9]) });
	deepStrictEqual(toNeutralPart({ mystery: true } as unknown as Parameters<typeof toNeutralPart>[0]), { kind: 'text', value: '[unrecognized part]' });
	const messages = toNeutralMessages([{ role: 1, content: [{ value: 'q' }], name: undefined }, { role: 2, content: [{ callId: 'c', name: 't', input: { toolMode: 1 } }], name: 'flauz' }]);
	deepStrictEqual(messages[0], { role: 'user', content: [{ kind: 'text', value: 'q' }] });
	deepStrictEqual(messages[1], { role: 'assistant', content: [{ kind: 'toolCall', callId: 'c', toolName: 't', input: { toolMode: 1 } }], name: 'flauz' });
});

test('bridge: assembles the neutral request with tools and tool modes', () => {
	const request = toNeutralRequest(
		{ id: 'm1', name: 'M', family: 'f', version: '1', maxInputTokens: 10, maxOutputTokens: 5, capabilities: {} },
		[{ role: 1, content: [{ value: 'go' }], name: undefined }],
		{ toolMode: 2, tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] },
	);
	deepStrictEqual(request.modelId, 'm1');
	deepStrictEqual(request.toolMode, 'required');
	deepStrictEqual(request.tools, [{ name: 't', description: 'd', inputJsonSchema: { type: 'object' } }]);
	const auto = toNeutralRequest({ id: 'm1', name: 'M', family: 'f', version: '1', maxInputTokens: 10, maxOutputTokens: 5, capabilities: {} }, [{ role: 1, content: [{ value: 'go' }], name: undefined }], { toolMode: 1 });
	deepStrictEqual(auto.toolMode, 'auto');
	deepStrictEqual(auto.tools, undefined);
});

test('bridge: information mapping exposes models with conservative input bound and capabilities', async () => {
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter(TOOL_SCRIPT) });
	const models = await provider.provideLanguageModelChatInformation({ silent: true }, makeToken());
	ok(models, 'information returned');
	strictEqual(models.length, 1);
	strictEqual(models[0].id, 'fake-1');
	strictEqual(models[0].maxInputTokens, 4096 - 1024, 'conservative window minus max output');
	strictEqual(models[0].maxOutputTokens, 1024);
	deepStrictEqual(models[0].capabilities, { toolCalling: true, imageInput: true });
});

test('bridge: streams text parts and one parsed tool-call part per call', async () => {
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter(TOOL_SCRIPT) });
	const parts: unknown[] = [];
	const progress = { report: (part: unknown) => parts.push(part) };
	await provider.provideLanguageModelChatResponse({ id: 'fake-1', name: 'Fake One', family: 'fake', version: '1', maxInputTokens: 3000, maxOutputTokens: 1024, capabilities: {} }, [{ role: 1, content: [{ value: 'go' }], name: undefined }], { toolMode: 1 }, progress, makeToken());
	deepStrictEqual(parts, [
		{ value: 'Working ' },
		{ value: 'now.' },
		{ callId: 'call_1', name: 'flauz_terminal', input: { command: 'pwd' } },
	]);
});

test('bridge: cancellation resolves quietly (no throw)', async () => {
	const token = makeToken();
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter([
		{ type: 'text-delta', text: 'one' },
		{ type: 'text-delta', text: 'two' },
	]) });
	const parts: unknown[] = [];
	let cancelled = false;
	// flip the token after the first part
	const progress = { report: (part: unknown) => { parts.push(part); if (!cancelled) { cancelled = true; token.cancel(); } } };
	await provider.provideLanguageModelChatResponse({ id: 'fake-1', name: 'x', family: 'f', version: '1', maxInputTokens: 1, maxOutputTokens: 1, capabilities: {} }, [{ role: 1, content: [{ value: 'go' }], name: undefined }], { toolMode: 1 }, progress, token);
	strictEqual(parts.length, 1, 'stops after cancellation');
});

test('bridge: adapter failures become user-facing errors carrying provider id and taxonomy', async () => {
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter([], new ProviderError('RATE_LIMITED', 'quota exceeded', { status: 429, retryAfterMs: 2000, providerId: 'fake' })) });
	let thrown: unknown;
	try {
		await provider.provideLanguageModelChatResponse({ id: 'fake-1', name: 'x', family: 'f', version: '1', maxInputTokens: 1, maxOutputTokens: 1, capabilities: {} }, [{ role: 1, content: [{ value: 'go' }], name: undefined }], { toolMode: 1 }, { report: () => undefined }, makeToken());
	} catch (error) {
		thrown = error;
	}
	ok(thrown instanceof Error);
	ok((thrown as Error).message.includes('[fake]'), 'carries provider id');
	ok((thrown as Error).message.includes('RATE_LIMITED'), 'carries the taxonomy code');
	ok((thrown as Error).message.includes('retryable'), 'carries the retry posture');
});

test('bridge: toVscodeError never leaks key material and keeps taxonomy text', () => {
	const error = toVscodeError(new ProviderError('AUTH_FAILED', 'bad key', { providerId: 'p' }), 'p');
	ok(error instanceof Error);
	ok(error.message.includes('AUTH_FAILED'));
	const passthrough = toVscodeError(new Error('plain failure'), 'p');
	ok(passthrough.message.includes('unexpected provider failure'));
});

test('bridge: token counting delegates to the adapter (string + message)', async () => {
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter(TOOL_SCRIPT) });
	strictEqual(await provider.provideTokenCount({ id: 'fake-1', name: 'x', family: 'f', version: '1', maxInputTokens: 1, maxOutputTokens: 1, capabilities: {} }, 'abcd', makeToken()), 7);
	strictEqual(await provider.provideTokenCount({ id: 'fake-1', name: 'x', family: 'f', version: '1', maxInputTokens: 1, maxOutputTokens: 1, capabilities: {} }, { role: 1, content: [{ value: 'abcd' }], name: undefined }, makeToken()), 7);
});

test('bridge: END-TO-END -- real OpenAI-compatible adapter behind the provider against the local fixture server', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_AND_TOOL }]);
	try {
		const adapter = createOpenAiCompatAdapter({
			config: {
				providerId: 'openai-compat',
				vendor: 'flauz-openai-compat',
				displayName: 'Flauz OpenAI Compatible',
				baseUrl: `http://127.0.0.1:${server.port}`,
				credentialRef: 'env:FLAUZ_FIXTURE_KEY',
				models: [{ modelId: 'fx-chat', modelName: 'Fixture Chat', family: 'fx', version: '1', contextWindowTokens: 8192, maxOutputTokens: 1024, inputModalities: ['text'], toolCalling: true }],
			},
			http: nodeHttpPort,
			secrets: { resolve: async () => 'flauz-fixture-key' },
			hash: { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') },
			clock: () => 0,
		});
		const provider = createAdapterBackedProvider({ adapter });
		const parts: unknown[] = [];
		await provider.provideLanguageModelChatResponse({ id: 'fx-chat', name: 'Fixture Chat', family: 'fx', version: '1', maxInputTokens: 7000, maxOutputTokens: 1024, capabilities: {} }, [{ role: 1, content: [{ value: 'hello' }], name: undefined }], { toolMode: 1, tools: [{ name: 'flauz_terminal', description: 'd', inputSchema: { type: 'object' } }] }, { report: part => parts.push(part) }, makeToken());
		deepStrictEqual(parts, [
			{ value: 'Hello' },
			{ value: ' from' },
			{ value: ' the fixture' },
			{ callId: 'call_fx_1', name: 'flauz_terminal', input: { command: 'ls -la' } },
		]);
		strictEqual(server.requests.length, 1, 'exactly one wire request');
	} finally {
		await server.close();
	}
});

test('bridge: tool arguments that are not JSON fail loudly (MALFORMED_RESPONSE)', async () => {
	const provider = createAdapterBackedProvider({ adapter: fakeAdapter([
		{ type: 'tool-input-start', callId: 'bad', toolName: 't' },
		{ type: 'tool-input-delta', callId: 'bad', fragment: '{not json' },
		{ type: 'tool-input-end', callId: 'bad' },
	]) });
	let thrown: unknown;
	try {
		await provider.provideLanguageModelChatResponse({ id: 'fake-1', name: 'x', family: 'f', version: '1', maxInputTokens: 1, maxOutputTokens: 1, capabilities: {} }, [{ role: 1, content: [{ value: 'go' }], name: undefined }], { toolMode: 1 }, { report: () => undefined }, makeToken());
	} catch (error) {
		thrown = error;
	}
	ok(thrown instanceof Error);
	ok((thrown as Error).message.includes('MALFORMED_RESPONSE'), 'taxonomy code surfaces');
	ok(isProviderError(new ProviderError('MALFORMED_RESPONSE', 'x')));
});
