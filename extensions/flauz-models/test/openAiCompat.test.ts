/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- OpenAI-compatible adapter drills (M2).
 *
 * FIXTURE-VERIFIED against a LOCAL node:http fixture server on 127.0.0.1:
 * request mapping (exact wire shapes), streaming assembly, tool-call
 * accumulation, token accounting (reported + estimated), cancellation,
 * every error class incl. 429 Retry-After, malformed frames, fail-closed
 * credentials, health probes, and the no-key-outside-the-header rule.
 * No live provider is contacted.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

import { createOpenAiCompatAdapter, buildOpenAiRequestBody } from '../src/adapters/openAiCompat.ts';

import { nodeHttpPort } from '../src/contract/nodePorts.ts';
import { type ProviderError, isProviderError } from '../src/contract/errors.ts';

import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '../src/contract/types.ts';
import { startFixtureServer, type FixtureServer } from './fixtureServer.ts';
import {
	OPENAI_CHAT_PATH,
	OPENAI_ERROR_400_BAD,
	OPENAI_ERROR_400_CONTEXT,
	OPENAI_ERROR_401,
	OPENAI_ERROR_404,
	OPENAI_ERROR_429,
	OPENAI_ERROR_500,
	OPENAI_HAPPY_TEXT_AND_TOOL,
	OPENAI_HAPPY_TEXT_ONLY,
	OPENAI_MALFORMED_JSON_FRAME,
	OPENAI_MODELS_PATH,
	mockApiKey,
} from './fixtures/vendorPayloads.ts';

/** Deterministic clock double (health latency assertions stay stable). */
const fakeClock = (): number => 1000;

function makeAdapter(port: number, credentialRef = 'env:FLAUZ_FIXTURE_KEY') {
	return createOpenAiCompatAdapter({
		config: {
			providerId: 'openai-compat',
			vendor: 'flauz-openai-compat',
			displayName: 'Flauz OpenAI Compatible',
			baseUrl: `http://127.0.0.1:${port}`,
			...(credentialRef === undefined ? {} : { credentialRef }),
			models: [
				{ modelId: 'fx-chat', modelName: 'Fixture Chat', family: 'fx', version: '1', contextWindowTokens: 8192, maxOutputTokens: 1024, inputModalities: ['text', 'image'], toolCalling: true },
			],
		},
		http: nodeHttpPort,
		secrets: { resolve: async ref => (ref === 'env:FLAUZ_FIXTURE_KEY' ? mockApiKey() : undefined) },
		hash: { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') },
		clock: fakeClock,
	});
}

function userRequest(text: string): ChatRequest {
	return { modelId: 'fx-chat', messages: [{ role: 'user', content: [{ kind: 'text', value: text }] }] };
}

async function collect(events: AsyncGenerator<ProviderStreamEvent, void, void>): Promise<ProviderStreamEvent[]> {
	const collected: ProviderStreamEvent[] = [];
	for await (const event of events) {
		collected.push(event);
	}
	return collected;
}

test('openai-compat: request mapping produces the exact chat-completions wire shape', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_ONLY }]);
	try {
		const adapter = makeAdapter(server.port);
		const messages: readonly ChatMessage[] = [
			{ role: 'system', content: [{ kind: 'text', value: 'be terse' }] },
			{ role: 'user', content: [{ kind: 'text', value: 'list files' }] },
			{ role: 'assistant', content: [{ kind: 'toolCall', callId: 'call_a', toolName: 'flauz_terminal', input: { command: 'ls' } }] },
			{ role: 'user', content: [{ kind: 'toolResult', callId: 'call_a', content: [{ kind: 'text', value: 'file-a' }] }, { kind: 'text', value: 'now summarize' }] },
		];
		await collect(adapter.stream({ modelId: 'fx-chat', messages, tools: [{ name: 'flauz_terminal', description: 'run a command', inputJsonSchema: { type: 'object' } }], toolMode: 'required', maxOutputTokens: 64, temperature: 0.2, stopSequences: ['\n'] }, { purpose: 'test' }));
		const wire = JSON.parse(server.requests[0].body) as ReturnType<typeof buildOpenAiRequestBody>;
		deepStrictEqual(wire.model, 'fx-chat');
		deepStrictEqual(wire.messages, [
			{ role: 'system', content: 'be terse' },
			{ role: 'user', content: 'list files' },
			{ role: 'assistant', content: '', tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'flauz_terminal', arguments: '{"command":"ls"}' } }] },
			{ role: 'tool', content: 'file-a', tool_call_id: 'call_a' },
			{ role: 'user', content: 'now summarize' },
		]);
		deepStrictEqual(wire.tools, [{ type: 'function', function: { name: 'flauz_terminal', description: 'run a command', parameters: { type: 'object' } } }]);
		deepStrictEqual(wire.tool_choice, 'required');
		deepStrictEqual(wire.max_tokens, 64);
		deepStrictEqual(wire.temperature, 0.2);
		deepStrictEqual(wire.stop, ['\n']);
		strictEqual(wire.stream, true);
		deepStrictEqual(wire.stream_options, { include_usage: true });
	} finally {
		await server.close();
	}
});

test('openai-compat: happy stream assembles text, tool calls, usage and provenance', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_AND_TOOL }]);
	try {
		const adapter = makeAdapter(server.port);
		const events = await collect(adapter.stream(userRequest('hello'), { purpose: 'test' }));
		const text = events.filter(event => event.type === 'text-delta').map(event => (event as { type: 'text-delta'; text: string }).text).join('');
		strictEqual(text, 'Hello from the fixture');
		const toolStart = events.find(event => event.type === 'tool-input-start') as { type: 'tool-input-start'; callId: string; toolName: string } | undefined;
		deepStrictEqual(toolStart, { type: 'tool-input-start', callId: 'call_fx_1', toolName: 'flauz_terminal' });
		const fragments = events.filter(event => event.type === 'tool-input-delta').map(event => (event as { type: 'tool-input-delta'; fragment: string }).fragment).join('');
		strictEqual(fragments, '{"command":"ls -la"}');
		ok(events.some(event => event.type === 'tool-input-end' && (event as { callId: string }).callId === 'call_fx_1'));
		const finish = events[events.length - 1];
		if (finish?.type !== 'finish') {
			throw new Error(`expected finish event, got ${JSON.stringify(finish)}`);
		}
		strictEqual(finish.finishReason, 'tool-calls');
		strictEqual(finish.usage.reportedInputTokens, 25);
		strictEqual(finish.usage.reportedOutputTokens, 9);
		ok(finish.usage.estimatedInputTokens > 0);
		ok(finish.usage.estimatedOutputTokens > 0);
		strictEqual(finish.provenance.providerId, 'openai-compat');
		strictEqual(finish.provenance.vendor, 'flauz-openai-compat');
		strictEqual(finish.provenance.modelId, 'fx-chat');
		strictEqual(finish.provenance.adapterVersion.length > 0, true);
		ok(/^[0-9a-f]{64}$/.test(finish.provenance.requestHash), 'request hash is sha256 hex');
		strictEqual(finish.provenance.wireFamily, 'openai-chat-completions');
		// the request carried the bearer resolved from the vault reference
		const auth = server.requests[0].headers.authorization;
		strictEqual(Array.isArray(auth) ? auth[0] : auth, `Bearer ${mockApiKey()}`);
	} finally {
		await server.close();
	}
});

test('openai-compat: text-only stream finishes with stop', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_ONLY }]);
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

test('openai-compat: 401 maps to terminal AUTH_FAILED', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, status: 401, body: OPENAI_ERROR_401 }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'AUTH_FAILED', false, 'none');
	} finally {
		await server.close();
	}
});

test('openai-compat: 429 maps to retryable RATE_LIMITED with retryAfterMs and long-backoff', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, status: 429, headers: { 'Retry-After': '2' }, body: OPENAI_ERROR_429 }]);
	try {
		const adapter = makeAdapter(server.port);
		let caught: ProviderError | undefined;
		try {
			await collect(adapter.stream(userRequest('hi')));
		} catch (error) {
			if (isProviderError(error)) {
				caught = error;
			}
		}
		ok(caught !== undefined, 'must throw ProviderError');
		const providerError: ProviderError = caught;
		strictEqual(providerError.code, 'RATE_LIMITED');
		strictEqual(providerError.retryable, true);
		strictEqual(providerError.retryClass, 'long-backoff');
		strictEqual(providerError.retryAfterMs, 2000);
		strictEqual(caught.status, 429);
		// no key material leaks into the error text
		ok(!providerError.message.includes(mockApiKey()), 'error text must not contain the key');
	} finally {
		await server.close();
	}
});

test('openai-compat: 5xx maps to retryable PROVIDER_OVERLOADED; 400 context-length to terminal CONTEXT_OVERFLOW', async () => {
	const server = await startFixtureServer([
		{ path: OPENAI_CHAT_PATH, status: 500, body: OPENAI_ERROR_500 },
	]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'PROVIDER_OVERLOADED', true, 'short-backoff');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: OPENAI_CHAT_PATH, status: 400, body: OPENAI_ERROR_400_CONTEXT }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream(userRequest('big')), 'CONTEXT_OVERFLOW', false, 'none');
	} finally {
		await server2.close();
	}
});

test('openai-compat: other 400 stays BAD_REQUEST; 404 NOT_FOUND', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, status: 400, body: OPENAI_ERROR_400_BAD }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'BAD_REQUEST', false, 'none');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: OPENAI_CHAT_PATH, status: 404, body: OPENAI_ERROR_404 }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream({ ...userRequest('hi'), modelId: 'nope-model' }), 'NOT_FOUND', false, 'none');
	} finally {
		await server2.close();
	}
});

test('openai-compat: malformed SSE frame maps to terminal MALFORMED_RESPONSE', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_MALFORMED_JSON_FRAME }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'MALFORMED_RESPONSE', false, 'none');
	} finally {
		await server.close();
	}
});

test('openai-compat: unknown model fails closed before any HTTP traffic', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_ONLY }]);
	try {
		await rejectsError(makeAdapter(server.port).stream({ ...userRequest('hi'), modelId: 'unknown-model' }), 'NOT_FOUND', false, 'none');
		strictEqual(server.requests.length, 0, 'no request may be sent for an unknown model');
	} finally {
		await server.close();
	}
});

test('openai-compat: unresolved credential fails closed with zero requests', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_ONLY }]);
	try {
		const adapter = createOpenAiCompatAdapter({
			config: { providerId: 'openai-compat', vendor: 'flauz-openai-compat', displayName: 'x', baseUrl: `http://127.0.0.1:${server.port}`, credentialRef: 'vault:DOES_NOT_EXIST', models: [{ modelId: 'fx-chat', modelName: 'n', family: 'f', version: '1', contextWindowTokens: 8, maxOutputTokens: 4, inputModalities: ['text'], toolCalling: true }] },
			http: nodeHttpPort,
			secrets: { resolve: async () => undefined },
			hash: { sha256Hex: input => input.length.toString(16) },
			clock: fakeClock,
		});
		await rejectsError(adapter.stream(userRequest('hi')), 'CREDENTIAL_UNRESOLVED', false, 'none');
		strictEqual(server.requests.length, 0, 'fail closed: nothing was sent');
	} finally {
		await server.close();
	}
});

test('openai-compat: caller cancellation mid-stream maps to CANCELLED', async () => {
	const server = await startFixtureServer([{ path: OPENAI_CHAT_PATH, frames: OPENAI_HAPPY_TEXT_AND_TOOL, frameDelayMs: 30 }]);
	try {
		const controller = new AbortController();
		const adapter = makeAdapter(server.port);
		const collected: ProviderStreamEvent[] = [];
		await rejects(
			(async () => {
				for await (const event of adapter.stream(userRequest('hello'), { signal: controller.signal })) {
					collected.push(event);
					if (collected.length === 1) {
						controller.abort();
					}
				}
			})(),
			(error: unknown): boolean => isProviderError(error) && error.code === 'CANCELLED',
		);
		strictEqual(collected.length < 12, true, 'cancellation stops the event flow early');
	} finally {
		await server.close();
	}
});

test('openai-compat: health probe distinguishes healthy, degraded, unavailable', async () => {
	const server: FixtureServer = await startFixtureServer([{ path: OPENAI_MODELS_PATH, method: 'GET', body: '{"data":[]}' }]);
	try {
		const healthy = await makeAdapter(server.port).health();
		strictEqual(healthy.status, 'healthy');
		strictEqual(healthy.providerId, 'openai-compat');
		ok(healthy.latencyMs !== undefined);
		server.setRoutes([{ path: OPENAI_MODELS_PATH, method: 'GET', status: 401, body: OPENAI_ERROR_401 }]);
		const degraded = await makeAdapter(server.port).health();
		strictEqual(degraded.status, 'degraded');
		server.setRoutes([]);
		const unavailable = await makeAdapter(server.port).health();
		strictEqual(unavailable.status, 'unavailable');
	} finally {
		await server.close();
	}
});

test('openai-compat: capabilities and model listing come from the config', () => {
	const adapter = makeAdapter(1, undefined);
	strictEqual(adapter.descriptor.wireFamily, 'openai-chat-completions');
	strictEqual(adapter.descriptor.locality, 'remote');
	strictEqual(adapter.models().length, 1);
	const capabilities = adapter.capabilities('fx-chat');
	ok(capabilities !== undefined, 'capabilities present');
	strictEqual(capabilities.contextWindowTokens, 8192);
	strictEqual(capabilities.toolCalling, true);
	strictEqual(adapter.capabilities('other'), undefined);
	strictEqual(adapter.estimateTokens('abcdefgh'), 2);
	strictEqual(adapter.estimateTokens([{ role: 'user', content: [{ kind: 'text', value: 'abcd' }] }]), 5, '4 overhead + 1');
});

/** Asserts a stream rejects with the given taxonomy posture. */
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
