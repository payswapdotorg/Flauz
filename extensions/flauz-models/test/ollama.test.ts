/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- Ollama-style local adapter drills (M2).
 *
 * FIXTURE-VERIFIED against a LOCAL node:http fixture server on 127.0.0.1:
 * request mapping (roles, images, tool_calls, tool results, num_predict),
 * NDJSON stream assembly, synthesized tool call ids, usage from the done
 * line, cancellation, error classes (404 / 500), malformed lines, health
 * probes and the no-credential-by-design posture. No live daemon is
 * contacted.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

import { createOllamaAdapter } from '../src/adapters/ollama.ts';
import { nodeHttpPort } from '../src/contract/nodePorts.ts';
import { isProviderError } from '../src/contract/errors.ts';
import type { ChatMessage, ChatRequest, ProviderStreamEvent } from '../src/contract/types.ts';
import { startFixtureServer } from './fixtureServer.ts';
import {
	OLLAMA_CHAT_PATH,
	OLLAMA_ERROR_404,
	OLLAMA_ERROR_500,
	OLLAMA_HAPPY_TEXT,
	OLLAMA_HAPPY_TOOL,
	OLLAMA_MALFORMED_LINE,
	OLLAMA_TAGS_PATH,
} from './fixtures/vendorPayloads.ts';

const fakeClock = (): number => 250;

function makeAdapter(port: number) {
	return createOllamaAdapter({
		config: {
			providerId: 'ollama-local',
			vendor: 'flauz-ollama',
			displayName: 'Flauz Ollama Local',
			baseUrl: `http://127.0.0.1:${port}`,
			models: [
				{ modelId: 'flauz-fixture-local', modelName: 'Fixture Local', family: 'local', version: '1', contextWindowTokens: 8192, maxOutputTokens: 2048, inputModalities: ['text', 'image'], toolCalling: true },
			],
		},
		http: nodeHttpPort,
		secrets: { resolve: async () => undefined },
		hash: { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') },
		clock: fakeClock,
	});
}

function userRequest(text: string): ChatRequest {
	return { modelId: 'flauz-fixture-local', messages: [{ role: 'user', content: [{ kind: 'text', value: text }] }] };
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

test('ollama: request mapping produces the exact api/chat wire shape', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, frames: OLLAMA_HAPPY_TEXT }]);
	try {
		const adapter = makeAdapter(server.port);
		const messages: readonly ChatMessage[] = [
			{ role: 'system', content: [{ kind: 'text', value: 'be terse' }] },
			{ role: 'user', content: [{ kind: 'text', value: 'describe this' }, { kind: 'data', mimeType: 'image/png', data: new Uint8Array([1, 2, 3]) }] },
			{ role: 'assistant', content: [{ kind: 'toolCall', callId: 'c1', toolName: 'flauz_terminal', input: { command: 'ls' } }] },
			{ role: 'user', content: [{ kind: 'toolResult', callId: 'c1', content: [{ kind: 'text', value: 'file-a' }] }] },
		];
		await collect(adapter.stream({ modelId: 'flauz-fixture-local', messages, tools: [{ name: 'flauz_terminal', description: 'run a command', inputJsonSchema: { type: 'object' } }], maxOutputTokens: 128, temperature: 0.1 }, { purpose: 'test' }));
		const wire = JSON.parse(server.requests[0].body) as Record<string, unknown>;
		deepStrictEqual(wire.model, 'flauz-fixture-local');
		strictEqual(wire.stream, true);
		deepStrictEqual(wire.tools, [{ type: 'function', function: { name: 'flauz_terminal', description: 'run a command', parameters: { type: 'object' } } }]);
		deepStrictEqual(wire.options, { temperature: 0.1, num_predict: 128 });
		const wireMessages = wire.messages as ReadonlyArray<Record<string, unknown>>;
		deepStrictEqual(wireMessages[0], { role: 'system', content: 'be terse' });
		deepStrictEqual(wireMessages[1], { role: 'user', content: 'describe this', images: ['AQID'] });
		deepStrictEqual(wireMessages[2], { role: 'assistant', content: '', tool_calls: [{ function: { name: 'flauz_terminal', arguments: { command: 'ls' } } }] });
		deepStrictEqual(wireMessages[3], { role: 'tool', content: 'file-a' });
		// local daemon: no authorization header by design
		strictEqual(server.requests[0].headers.authorization, undefined);
	} finally {
		await server.close();
	}
});

test('ollama: NDJSON stream assembles text, usage and stop finish', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, frames: OLLAMA_HAPPY_TEXT }]);
	try {
		const events = await collect(makeAdapter(server.port).stream(userRequest('hi')));
		const text = events.filter(event => event.type === 'text-delta').map(event => (event as { type: 'text-delta'; text: string }).text).join('');
		strictEqual(text, 'Local model answer.');
		const finish = events[events.length - 1];
		if (finish?.type !== 'finish') {
			throw new Error('expected finish');
		}
		strictEqual(finish.finishReason, 'stop');
		strictEqual(finish.usage.reportedInputTokens, 12);
		strictEqual(finish.usage.reportedOutputTokens, 5);
		ok(finish.usage.estimatedInputTokens > 0);
		strictEqual(finish.provenance.providerId, 'ollama-local');
		strictEqual(finish.provenance.wireFamily, 'ollama-chat');
		ok(/^[0-9a-f]{64}$/.test(finish.provenance.requestHash));
	} finally {
		await server.close();
	}
});

test('ollama: tool calls stream with synthesized deterministic call ids', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, frames: OLLAMA_HAPPY_TOOL }]);
	try {
		const events = await collect(makeAdapter(server.port).stream(userRequest('run pwd')));
		const toolStart = events.find(event => event.type === 'tool-input-start') as { type: 'tool-input-start'; callId: string; toolName: string } | undefined;
		deepStrictEqual(toolStart, { type: 'tool-input-start', callId: 'flauz_terminal#0', toolName: 'flauz_terminal' });
		const delta = events.find(event => event.type === 'tool-input-delta') as { type: 'tool-input-delta'; fragment: string } | undefined;
		ok(delta !== undefined, 'tool-input-delta present');
		deepStrictEqual(JSON.parse(delta.fragment), { command: 'pwd' });
		ok(events.some(event => event.type === 'tool-input-end' && (event as { callId: string }).callId === 'flauz_terminal#0'));
		const finish = events[events.length - 1];
		if (finish?.type !== 'finish') {
			throw new Error('expected finish');
		}
		strictEqual(finish.finishReason, 'tool-calls');
		const text = events.filter(event => event.type === 'text-delta').map(event => (event as { type: 'text-delta'; text: string }).text).join('');
		strictEqual(text, 'Running it.');
	} finally {
		await server.close();
	}
});

test('ollama: 404 model-not-found maps to NOT_FOUND; 500 to PROVIDER_OVERLOADED', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, status: 404, body: OLLAMA_ERROR_404 }]);
	try {
		await rejectsError(makeAdapter(server.port).stream({ ...userRequest('hi'), modelId: 'nope-model' }), 'NOT_FOUND', false, 'none');
	} finally {
		await server.close();
	}
	const server2 = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, status: 500, body: OLLAMA_ERROR_500 }]);
	try {
		await rejectsError(makeAdapter(server2.port).stream(userRequest('hi')), 'PROVIDER_OVERLOADED', true, 'short-backoff');
	} finally {
		await server2.close();
	}
});

test('ollama: malformed NDJSON line maps to MALFORMED_RESPONSE', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, frames: OLLAMA_MALFORMED_LINE }]);
	try {
		await rejectsError(makeAdapter(server.port).stream(userRequest('hi')), 'MALFORMED_RESPONSE', false, 'none');
	} finally {
		await server.close();
	}
});

test('ollama: caller cancellation mid-stream maps to CANCELLED', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_CHAT_PATH, frames: OLLAMA_HAPPY_TEXT, frameDelayMs: 30 }]);
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
		strictEqual(seen < 4, true, 'cancellation stops early');
	} finally {
		await server.close();
	}
});

test('ollama: health probe via /api/tags; unknown model fails closed locally', async () => {
	const server = await startFixtureServer([{ path: OLLAMA_TAGS_PATH, method: 'GET', body: '{"models":[]}' }]);
	try {
		const adapter = makeAdapter(server.port);
		strictEqual((await adapter.health()).status, 'healthy');
		strictEqual(adapter.descriptor.locality, 'local');
		server.setRoutes([]);
		strictEqual((await adapter.health()).status, 'unavailable');
		await rejectsError(adapter.stream({ ...userRequest('hi'), modelId: 'missing' }), 'NOT_FOUND', false, 'none');
		strictEqual(server.requests.filter(request => request.path === OLLAMA_CHAT_PATH).length, 0, 'no chat traffic for unknown model');
	} finally {
		await server.close();
	}
});
