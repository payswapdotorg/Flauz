/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- Anthropic-compatible adapter drills (M2).
 *
 * FIXTURE-VERIFIED against a LOCAL node:http fixture server on 127.0.0.1:
 * request mapping (system extraction, tool_use/tool_result blocks,
 * input_schema), named-event stream assembly, tool-input fragments, usage
 * split across message_start/message_delta, cancellation, error classes
 * (401 / 429 / 529 / 400 prompt-too-long / in-stream error events),
 * malformed frames and health probes. No live provider is contacted.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

import { createAnthropicCompatAdapter, ANTHROPIC_VERSION_HEADER } from '../src/adapters/anthropicCompat.ts';
import { nodeHttpPort } from '../src/contract/nodePorts.ts';
import { isProviderError } from '../src/contract/errors.ts';
import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '../src/contract/types.ts';
import { startFixtureServer } from './fixtureServer.ts';
import {
	ANTHROPIC_CHAT_PATH,
	ANTHROPIC_ERROR_400_BAD,
	ANTHROPIC_ERROR_400_CONTEXT,
	ANTHROPIC_ERROR_401,
	ANTHROPIC_ERROR_404,
	ANTHROPIC_ERROR_429,
	ANTHROPIC_ERROR_529,
	ANTHROPIC_HAPPY_TEXT_AND_TOOL,
	ANTHROPIC_HAPPY_TEXT_ONLY,
	ANTHROPIC_MALFORMED_JSON_FRAME,
	ANTHROPIC_MODELS_PATH,
	ANTHROPIC_STREAM_ERROR_RATE_LIMIT,
	mockApiKey,
} from './fixtures/vendorPayloads.ts';

const fakeClock = (): number => 500;

function makeAdapter(port: number) {
	return createAnthropicCompatAdapter({
		config: {
			providerId: 'anthropic-compat',
			vendor: 'flauz-anthropic-compat',
			displayName: 'Flauz Anthropic Compatible',
			baseUrl: `http://127.0.0.1:${port}`,
			credentialRef: 'env:FLAUZ_FIXTURE_KEY',
			models: [
				{ modelId: 'fx-msg', modelName: 'Fixture Messages', family: 'fxm', version: '1', contextWindowTokens: 200_000, maxOutputTokens: 4096, inputModalities: ['text', 'image'], toolCalling: true },
			],
		},
		http: nodeHttpPort,
		secrets: { resolve: async ref => (ref === 'env:FLAUZ_FIXTURE_KEY' ? mockApiKey() : undefined) },
		hash: { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') },
		clock: fakeClock,
	});
}

function userRequest(text: string): ChatRequest {
	return { modelId: 'fx-msg', messages: [{ role: 'user', content: [{ kind: 'text', value: text }] }] };
}

async function collect(events: AsyncGenerator<ProviderStreamEvent, void, void>): Promise<ProviderStreamEvent[]> {
	const collected: ProviderStreamEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

async function rejectsError(stream: AsyncGenerator<ProviderStreamEvent, void, void>, code: string, retryable: boolean, retryClass: string): Promise<void> {
	await rejects(
		(async () => {
			for await (const _event of stream) {
				// drain until it throws
			}
		})(),
		(error: unknown): boolean => isProviderError(error) && error.code === code && error.retryable === retryable && error.retryClass === retryClass,
	);
}

test('anthropic-compat: request mapping extracts system, maps blocks, tools and max_tokens default', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_HAPPY_TEXT_ONLY }]);
	try {
		const adapter = makeAdapter(server.port);
		const messages: readonly ChatMessage[] = [
			{ role: 'system', content: [{ kind: 'text', value: 'be terse' }] },
			{ role: 'user', content: [{ kind: 'text', value: 'run pwd' }, { kind: 'data', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }] },
			{ role: 'assistant', content: [{ kind: 'toolCall', callId: 'toolu_a', toolName: 'flauz_terminal', input: { command: 'pwd' } }] },
			{ role: 'user', content: [{ kind: 'toolResult', callId: 'toolu_a', content: [{ kind: 'text', value: '/home/flauz' }] }] },
		];
		await collect(adapter.stream({ modelId: 'fx-msg', messages, tools: [{ name: 'flauz_terminal', description: 'run a command', inputJsonSchema: { type: 'object' } }], toolMode: 'required', temperature: 0.5 }, { purpose: 'test' }));
		const wire = JSON.parse(server.requests[0].body) as Record<string, unknown>;
		deepStrictEqual(wire.model, 'fx-msg');
		deepStrictEqual(wire.system, 'be terse');
		deepStrictEqual(wire.max_tokens, 4096, 'max_tokens defaults to the model max output');
		deepStrictEqual(wire.tool_choice, { type: 'any' });
		deepStrictEqual(wire.temperature, 0.5);
		strictEqual(wire.stream, true);
		deepStrictEqual(wire.tools, [{ name: 'flauz_terminal', description: 'run a command', input_schema: { type: 'object' } }]);
		const wireMessages = wire.messages as ReadonlyArray<{ role: string; content: ReadonlyArray<Record<string, unknown>> }>;
		strictEqual(wireMessages.length, 3);
		strictEqual(wireMessages[0].role, 'user');
		deepStrictEqual(wireMessages[0].content[0], { type: 'text', text: 'run pwd' });
		deepStrictEqual(wireMessages[0].content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AQID' } });
		deepStrictEqual(wireMessages[1].content[0], { type: 'tool_use', id: 'toolu_a', name: 'flauz_terminal', input: { command: 'pwd' } });
		deepStrictEqual(wireMessages[2].content[0], { type: 'tool_result', tool_use_id: 'toolu_a', content: '/home/flauz' });
		const headers = server.requests[0].headers;
		strictEqual(Array.isArray(headers['x-api-key']) ? headers['x-api-key'][0] : headers['x-api-key'], mockApiKey());
		strictEqual(Array.isArray(headers['anthropic-version']) ? headers['anthropic-version'][0] : headers['anthropic-version'], ANTHROPIC_VERSION_HEADER);
	} finally {
		await server.close();
	}
});

test('anthropic-compat: named-event stream assembles text, tool fragments, usage, provenance', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_HAPPY_TEXT_AND_TOOL }]);
	try {
		const events = await collect(makeAdapter(server.port).stream(userRequest('do it')));
		const text = events.filter(event => event.type === 'text-delta').map(event => (event as { type: 'text-delta'; text: string }).text).join('');
		strictEqual(text, 'Working on it.');
		const toolStart = events.find(event => event.type === 'tool-input-start') as { type: 'tool-input-start'; callId: string; toolName: string } | undefined;
		deepStrictEqual(toolStart, { type: 'tool-input-start', callId: 'toolu_fx_1', toolName: 'flauz_terminal' });
		const fragments = events.filter(event => event.type === 'tool-input-delta').map(event => (event as { type: 'tool-input-delta'; fragment: string }).fragment).join('');
		strictEqual(fragments, '{"command":"pwd"}');
		ok(events.some(event => event.type === 'tool-input-end' && (event as { callId: string }).callId === 'toolu_fx_1'));
		const finish = events[events.length - 1];
		if (finish?.type !== 'finish') {
			throw new Error('expected finish');
		}
		strictEqual(finish.finishReason, 'tool-calls');
		strictEqual(finish.usage.reportedInputTokens, 31);
		strictEqual(finish.usage.reportedOutputTokens, 17);
		strictEqual(finish.provenance.providerId, 'anthropic-compat');
		strictEqual(finish.provenance.modelId, 'fx-msg');
		strictEqual(finish.provenance.wireFamily, 'anthropic-messages');
		ok(/^[0-9a-f]{64}$/.test(finish.provenance.requestHash));
	} finally {
		await server.close();
	}
});

test('anthropic-compat: text-only stream ends with stop and survives ping frames', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_HAPPY_TEXT_ONLY }]);
	try {
		const events = await collect(makeAdapter(server.port).stream(userRequest('hi')));
		const finish = events[events.length - 1];
		if (finish?.type !== 'finish') {
			throw new Error('expected finish');
		}
		strictEqual(finish.finishReason, 'stop');
	} finally {
		await server.close();
	}
});

test('anthropic-compat: 401 AUTH_FAILED; 404 NOT_FOUND', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 401, body: ANTHROPIC_ERROR_401 }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'AUTH_FAILED', false, 'none');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 404, body: ANTHROPIC_ERROR_404 }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream({ ...userRequest('hi'), modelId: 'nope-model' }), 'NOT_FOUND', false, 'none');
	} finally {
		await server2.close();
	}
});

test('anthropic-compat: 429 RATE_LIMITED with Retry-After; 529 PROVIDER_OVERLOADED', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 429, headers: { 'Retry-After': '3' }, body: ANTHROPIC_ERROR_429 }]);
	try {
		const adapter = makeAdapter(server.port);
		let caught;
		try {
			await collect(adapter.stream(userRequest('hi')));
		} catch (error) {
			caught = error;
		}
		ok(isProviderError(caught) && caught.code === 'RATE_LIMITED' && caught.retryAfterMs === 3000 && caught.retryClass === 'long-backoff');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 529, body: ANTHROPIC_ERROR_529 }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream(userRequest('hi')), 'PROVIDER_OVERLOADED', true, 'short-backoff');
	} finally {
		await server2.close();
	}
});

test('anthropic-compat: 400 prompt-too-long maps to CONTEXT_OVERFLOW; other 400 stays BAD_REQUEST', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 400, body: ANTHROPIC_ERROR_400_CONTEXT }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('big')), 'CONTEXT_OVERFLOW', false, 'none');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, status: 400, body: ANTHROPIC_ERROR_400_BAD }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream(userRequest('hi')), 'BAD_REQUEST', false, 'none');
	} finally {
		await server2.close();
	}
});

test('anthropic-compat: in-stream rate_limit error event maps to RATE_LIMITED', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_STREAM_ERROR_RATE_LIMIT }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'RATE_LIMITED', true, 'long-backoff');
	} finally {
		await server.close();
	}
});

test('anthropic-compat: malformed event frame maps to MALFORMED_RESPONSE', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_MALFORMED_JSON_FRAME }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'MALFORMED_RESPONSE', false, 'none');
	} finally {
		await server.close();
	}
});

test('anthropic-compat: caller cancellation mid-stream maps to CANCELLED', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_CHAT_PATH, frames: ANTHROPIC_HAPPY_TEXT_AND_TOOL, frameDelayMs: 30 }]);
	try {
		const controller = new AbortController();
		let seen = 0;
		await rejects(
			(async () => {
				for await (const _event of makeAdapter(server.port).stream(userRequest('hi'), { signal: controller.signal })) {
					seen += 1;
					if (seen === 1) {
						controller.abort();
					}
				}
			})(),
			(error: unknown): boolean => isProviderError(error) && error.code === 'CANCELLED',
		);
	} finally {
		await server.close();
	}
});

test('anthropic-compat: health probe distinguishes healthy, degraded, unavailable', async () => {
	const server = await startFixtureServer([{ path: ANTHROPIC_MODELS_PATH, method: 'GET', body: '{"data":[]}' }]);
	try {
		strictEqual((await makeAdapter(server.port).health()).status, 'healthy');
		server.setRoutes([{ path: ANTHROPIC_MODELS_PATH, method: 'GET', status: 401, body: ANTHROPIC_ERROR_401 }]);
		strictEqual((await makeAdapter(server.port).health()).status, 'degraded');
		server.setRoutes([]);
		strictEqual((await makeAdapter(server.port).health()).status, 'unavailable');
	} finally {
		await server.close();
	}
});

test('anthropic-compat: descriptor, capabilities, estimateTokens', () => {
	const adapter = makeAdapter(1);
	strictEqual(adapter.descriptor.wireFamily, 'anthropic-messages');
	strictEqual(adapter.descriptor.locality, 'remote');
	const capabilities = adapter.capabilities('fx-msg');
	ok(capabilities !== undefined, 'capabilities present');
	strictEqual(capabilities.contextWindowTokens, 200_000);
	strictEqual(adapter.capabilities('missing'), undefined);
	strictEqual(adapter.estimateTokens('abcd'), 1);
});
