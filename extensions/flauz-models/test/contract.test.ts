/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- M1 contract tests: canonical serialization, the
 * error taxonomy (terminal vs retryable is a fixed table, not a mood),
 * deterministic token estimation, and the production node HTTP port against
 * the LOCAL fixture server (streaming order, header casing, timeout abort,
 * caller-signal abort, network failure classification).
 *
 * FIXTURE-VERIFIED: all HTTP evidence here runs against 127.0.0.1 fixture
 * servers; no live provider is ever contacted.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, rejects, strictEqual } from 'node:assert';

import { buildProvenance, canonicalJson, estimateMessageTokens, estimateTextTokens, estimateRequestTokens, serializeDocument, isProviderError, HttpPortAbortError, parseRetryAfterSeconds, ProviderError, RETRY_POLICY, nodeHttpPort, type ChatMessage, type ChatRequest } from '../src/contract/index.ts';
import { startFixtureServer } from './fixtureServer.ts';


/** Deterministic sha256 double for tests (identity-preserving fake). */
const fakeHash = { sha256Hex: (input: string): string => `sha256:${input.length}:${input.slice(0, 12)}` };

test('canonicalJson sorts keys at every depth, deterministically', () => {
	const value = { b: 1, a: { d: [3, { z: 1, c: 2 }], a: undefined }, c: 'x' };
	const first = canonicalJson(value);
	const second = canonicalJson({ c: 'x', a: { a: undefined, d: [3, { c: 2, z: 1 }] }, b: 1 });
	strictEqual(first, second, 'key order must not matter');
	strictEqual(first, '{"a":{"d":[3,{"c":2,"z":1}]},"b":1,"c":"x"}', 'sorted compact form, undefined dropped');
});

test('serializeDocument is the envelope form: 2-space indent + one trailing newline', () => {
	const text = serializeDocument({ b: 2, a: 1 });
	strictEqual(text, '{\n  "a": 1,\n  "b": 2\n}\n');
});

test('error taxonomy: every code has a fixed retry posture and terminal classes stay terminal', () => {
	const terminal: ReadonlyArray<keyof typeof RETRY_POLICY> = ['AUTH_FAILED', 'PERMISSION_DENIED', 'NOT_FOUND', 'BAD_REQUEST', 'CONTEXT_OVERFLOW', 'CANCELLED', 'MALFORMED_RESPONSE', 'CREDENTIAL_UNRESOLVED', 'PROTOCOL_ERROR', 'NO_CANDIDATE'];
	for (const code of terminal) {
		strictEqual(RETRY_POLICY[code].retryable, false, `${code} must be terminal`);
		strictEqual(RETRY_POLICY[code].retryClass, 'none', `${code} must have retryClass none`);
	}
	for (const code of ['RATE_LIMITED', 'PROVIDER_OVERLOADED', 'NETWORK_ERROR', 'TIMEOUT'] as const) {
		strictEqual(RETRY_POLICY[code].retryable, true, `${code} must be retryable`);
	}
	strictEqual(RETRY_POLICY.RATE_LIMITED.retryClass, 'long-backoff');
	strictEqual(RETRY_POLICY.PROVIDER_OVERLOADED.retryClass, 'short-backoff');
});

test('ProviderError carries code, retry posture, status, retryAfterMs and provider identity', () => {
	const error = new ProviderError('RATE_LIMITED', 'quota exceeded', { status: 429, retryAfterMs: 2500, providerId: 'openai-compat', modelId: 'gpt-test' });
	ok(isProviderError(error));
	strictEqual(error.code, 'RATE_LIMITED');
	strictEqual(error.retryable, true);
	strictEqual(error.retryClass, 'long-backoff');
	strictEqual(error.status, 429);
	strictEqual(error.retryAfterMs, 2500);
	strictEqual(error.providerId, 'openai-compat');
	strictEqual(error.modelId, 'gpt-test');
	ok(!isProviderError(new Error('plain')));
});

test('parseRetryAfterSeconds accepts integer seconds and rejects garbage', () => {
	strictEqual(parseRetryAfterSeconds('2'), 2000);
	strictEqual(parseRetryAfterSeconds('0'), 0);
	strictEqual(parseRetryAfterSeconds(undefined), undefined);
	strictEqual(parseRetryAfterSeconds('soon'), undefined);
	strictEqual(parseRetryAfterSeconds('-3'), undefined);
});

test('token estimation is deterministic and covers all part kinds', () => {
	strictEqual(estimateTextTokens('abcdefgh'), 2, '4 chars per token, ceiling');
	strictEqual(estimateTextTokens(''), 0);
	const messages: readonly ChatMessage[] = [
		{ role: 'system', content: [{ kind: 'text', value: 'you are a test' }] },
		{ role: 'user', content: [{ kind: 'text', value: 'hello' }, { kind: 'data', mimeType: 'image/png', data: new Uint8Array(8) }] },
		{ role: 'assistant', content: [{ kind: 'toolCall', callId: 'c1', toolName: 'flauz_terminal', input: { command: 'ls' } }] },
		{ role: 'user', content: [{ kind: 'toolResult', callId: 'c1', content: [{ kind: 'text', value: 'file-a file-b' }] }] },
	];
	const first = estimateMessageTokens(messages);
	strictEqual(first, estimateMessageTokens(messages), 'identical input -> identical estimate');
	ok(first > 0);
	const request: ChatRequest = { modelId: 'm', messages, tools: [{ name: 'flauz_terminal', inputJsonSchema: { type: 'object' } }] };
	ok(estimateRequestTokens(request) > first, 'tool declarations add tokens');
});

test('buildProvenance hashes the canonical request and carries the hard-rule fields', () => {
	const request: ChatRequest = { modelId: 'model-x', messages: [{ role: 'user', content: [{ kind: 'text', value: 'hi' }] }] };
	const provenance = buildProvenance({ providerId: 'p1', vendor: 'v1', modelId: 'model-x', adapterVersion: 'tl2-002.1', wireFamily: 'openai-chat-completions', request, hash: fakeHash });
	strictEqual(provenance.providerId, 'p1');
	strictEqual(provenance.modelId, 'model-x');
	strictEqual(provenance.adapterVersion, 'tl2-002.1');
	strictEqual(provenance.requestHash.startsWith('sha256:'), true, 'hash port is actually used');
	// same logical request in a different key order hashes identically
	const reordered: ChatRequest = { messages: request.messages, modelId: 'model-x' };
	const other = buildProvenance({ providerId: 'p1', vendor: 'v1', modelId: 'model-x', adapterVersion: 'tl2-002.1', wireFamily: 'openai-chat-completions', request: reordered, hash: fakeHash });
	strictEqual(other.requestHash, provenance.requestHash, 'canonical hash is order-independent');
});

test('nodeHttpPort streams body bytes in order against the local fixture server', async () => {
	const server = await startFixtureServer([{ path: '/stream', frames: ['aaa', 'bbb', 'ccc'] }]);
	try {
		const response = await nodeHttpPort.request({ method: 'GET', url: `http://127.0.0.1:${server.port}/stream` });
		strictEqual(response.status, 200);
		const chunks: string[] = [];
		for await (const chunk of response.bytes()) {
			chunks.push(new TextDecoder().decode(chunk));
		}
		ok(chunks.length >= 1, 'body arrives as chunks');
		strictEqual(chunks.join(''), 'aaabbbccc', 'chunk order is preserved');
		strictEqual(server.requests.length, 1);
		strictEqual(server.requests[0].path, '/stream');
	} finally {
		await server.close();
	}
});

test('nodeHttpPort lower-cases response header keys', async () => {
	const server = await startFixtureServer([{ path: '/h', body: '{}', headers: { 'X-Custom': 'yes', 'Retry-After': '7' } }]);
	try {
		const response = await nodeHttpPort.request({ method: 'GET', url: `http://127.0.0.1:${server.port}/h` });
		strictEqual(response.headers['x-custom'], 'yes');
		strictEqual(response.headers['retry-after'], '7');
	} finally {
		await server.close();
	}
});

test('nodeHttpPort maps wall-clock expiry to HttpPortAbortError(timeout)', async () => {
	const server = await startFixtureServer([{ path: '/slow', frames: ['a', 'b'], initialDelayMs: 500 }]);
	try {
		await rejects(
			nodeHttpPort.request({ method: 'GET', url: `http://127.0.0.1:${server.port}/slow`, timeoutMs: 40 }),
			(error: unknown): boolean => error instanceof HttpPortAbortError && error.abortReason === 'timeout',
		);
	} finally {
		await server.close();
	}
});

test('nodeHttpPort maps caller abort to HttpPortAbortError(signal)', async () => {
	const controller = new AbortController();
	const server = await startFixtureServer([{ path: '/slow', frames: ['a', 'b'], initialDelayMs: 400 }]);
	try {
		const pending = nodeHttpPort.request({ method: 'GET', url: `http://127.0.0.1:${server.port}/slow`, signal: controller.signal });
		setTimeout(() => controller.abort(), 20);
		await rejects(
			pending,
			(error: unknown): boolean => error instanceof HttpPortAbortError && error.abortReason === 'signal',
		);
	} finally {
		await server.close();
	}
});

test('nodeHttpPort passes connection failures through for NETWORK_ERROR classification', async () => {
	// port 1 on loopback: reserved, nothing listens there in the sandbox
	await rejects(
		nodeHttpPort.request({ method: 'GET', url: 'http://127.0.0.1:1/nope', timeoutMs: 2000 }),
		(error: unknown): boolean => !(error instanceof HttpPortAbortError),
	);
});

test('fixture server captures method, path, headers and body; unmatched routes 404 loudly', async () => {
	const server = await startFixtureServer([{ path: '/echo', method: 'POST', body: '{"ok":true}' }]);
	try {
		const response = await nodeHttpPort.request({ method: 'POST', url: `http://127.0.0.1:${server.port}/echo`, headers: { 'Content-Type': 'application/json' }, body: '{"ping":1}' });
		strictEqual(response.status, 200);
		deepStrictEqual(JSON.parse(server.requests[0].body), { ping: 1 });
		strictEqual(server.requests[0].method, 'POST');
		strictEqual((server.requests[0].headers['content-type'] ?? '') !== '', true);
		const missed = await nodeHttpPort.request({ method: 'GET', url: `http://127.0.0.1:${server.port}/nope` });
		strictEqual(missed.status, 404);
	} finally {
		await server.close();
	}
});
