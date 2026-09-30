/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-H1 -- the live-provider drill CONTRACT test.
 *
 * Verifies the drill harness itself -- OFFLINE, zero network by
 * construction:
 *   - the env contract (the five pinned variable names),
 *   - the SKIP law (missing/malformed env -> typed skips, never failures,
 *     never traffic -- proven here with a TRIPWIRE HttpPort that throws if
 *     anything dares to request),
 *   - the envelope law (exact key order, single-line JSONL, ISO startedAt,
 *     integer durationMs),
 *   - the redaction law (a synthetic fake key never reaches any serialized
 *     row; a hit suppresses the detail and fails the row),
 *   - the row semantics (routing / auth-failure / retry / provenance) driven
 *     through the REAL row runners and the REAL adapter seam over
 *     in-memory stub HttpPorts,
 *   - the pinned retry primitives imported from the environments lifecycle
 *     contract (the semantic source of truth the retry row rides),
 *   - the structural law (the drill reads no files, imports no node:fs,
 *     calls no fetch -- its only inputs are the five env variables).
 *
 * HONEST SCOPE: no live provider is contacted and none of the evidence here
 * is live evidence. The synthetic key below is fake by construction. This
 * test pins the harness; `node test/canaries/live-provider-runtime.drill.ts`
 * against real env is the live drill.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';

import {
	DRILL_ENVELOPE_ID,
	DRILL_ROWS,
	LIVE_PROVIDER_ENV,
	REDACTION_SUPPRESSED_DETAIL,
	buildEnvelope,
	finalizeRow,
	modelEchoMatches,
	parseHeaderJson,
	planRows,
	readDrillEnv,
	runAuthFailureRow,
	runDrill,
	runProvenanceRow,
	runRetryRow,
	runRoutingRow,
	serializeDrillRow,
	type RowRunPorts,
} from './canaries/live-provider-runtime.drill.ts';

import { PROVIDER_RETRY_AFTER_CAP_MS, PROVIDER_RETRY_FIXED_DELAY_MS, PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, isRetryableProviderStatus, providerRetryWaitMs, resolveRetryBound } from '../../flauz-environments/src/lifecycle/providerRetry.ts';

import { HttpPortAbortError } from '../src/contract/ports.ts';
import type { HttpPort, HttpPortRequest, HttpPortResponse } from '../src/contract/ports.ts';

// ---------------------------------------------------------------------------
// In-memory machinery (no sockets, no fetch, no fs -- readFileSync is used
// ONLY to scan the drill's own source in the structural test below).
// ---------------------------------------------------------------------------

/** A synthetic, obviously-fake key (never a credential; the redaction probe). */
const FAKE_KEY = 'sk-flauz-contract-fake-key-000000000000';
const DRILL_MODEL = 'drill-model';
const FAKE_BASE_URL = 'http://drill.invalid/v1';

function textChunk(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function httpResponse(status: number, headers: Record<string, string>, chunks: readonly string[]): HttpPortResponse {
	return {
		status,
		statusText: '',
		headers,
		async *bytes(): AsyncGenerator<Uint8Array, void, void> {
			for (const chunk of chunks) {
				yield textChunk(chunk);
			}
		},
	};
}

/** An OpenAI-shaped SSE completion body (the wire shape the adapter parses). */
function openAiSse(options: { model?: string; id?: string; deltas?: readonly string[] }): string {
	const model = options.model ?? DRILL_MODEL;
	const id = options.id ?? 'chatcmpl-drill-contract-1';
	const deltas = options.deltas ?? ['fl', 'auz'];
	const lines: string[] = [];
	lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1750000000, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}`, '');
	for (const delta of deltas) {
		lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1750000000, model, choices: [{ index: 0, delta: { content: delta }, finish_reason: null }] })}`, '');
	}
	lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1750000000, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}`, '');
	lines.push(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1750000000, model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 5 } })}`, '');
	lines.push('data: [DONE]', '', '');
	return lines.join('\n');
}

/** Splits a body across two chunks so the tee's incremental path is exercised. */
function chunked(body: string): string[] {
	return [body.slice(0, 37), body.slice(37)];
}

function errorBody(message: string): string {
	return JSON.stringify({ error: { message } });
}

/** A recording in-memory HttpPort: every request (post-merge) is captured. */
function recordingPort(respond: (request: HttpPortRequest) => HttpPortResponse | Promise<HttpPortResponse>): { readonly port: HttpPort; readonly seen: readonly HttpPortRequest[] } {
	const seen: HttpPortRequest[] = [];
	return {
		seen,
		port: {
			async request(request: HttpPortRequest): Promise<HttpPortResponse> {
				seen.push(request);
				return await respond(request);
			},
		},
	};
}

/** Row ports over a stub port: instant waits (never a real sleep on the test path). */
function rowPorts(port: HttpPort, invalidHeaders: Record<string, string> = {}, extraHeaders: Record<string, string> = {}): RowRunPorts {
	return {
		baseUrl: FAKE_BASE_URL,
		model: DRILL_MODEL,
		secrets: { resolve: async ref => (ref === `env:${LIVE_PROVIDER_ENV.apiKey}` ? FAKE_KEY : undefined) },
		http: port,
		wait: async () => undefined,
		extraHeaders,
		invalidHeaders,
	};
}

/** The tripwire port: any request is a contract violation (offline proof). */
function tripwirePort(counter: { fired: number }): HttpPort {
	return {
		async request(): Promise<HttpPortResponse> {
			counter.fired++;
			throw new Error('tripwire: the offline contract test must never issue network traffic');
		},
	};
}

/** Happy-path SSE response used by the row tests. */
function happySse(options?: { model?: string }): HttpPortResponse {
	return httpResponse(200, { 'content-type': 'text/event-stream', 'x-request-id': 'req-drill-1' }, chunked(openAiSse({ model: options?.model })));
}

// ---------------------------------------------------------------------------
// The env contract + the SKIP law (7 tests).
// ---------------------------------------------------------------------------

test('env contract: the five pinned variable names, and readDrillEnv maps them', () => {
	deepStrictEqual(LIVE_PROVIDER_ENV, {
		baseUrl: 'FLAUZ_LIVE_PROVIDER_BASE_URL',
		apiKey: 'FLAUZ_LIVE_PROVIDER_API_KEY',
		model: 'FLAUZ_LIVE_PROVIDER_MODEL',
		headersJson: 'FLAUZ_LIVE_PROVIDER_HEADERS_JSON',
		invalidHeadersJson: 'FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON',
	});
	const env = readDrillEnv({
		FLAUZ_LIVE_PROVIDER_BASE_URL: 'https://provider.example/v1',
		FLAUZ_LIVE_PROVIDER_API_KEY: 'k',
		FLAUZ_LIVE_PROVIDER_MODEL: 'm',
		FLAUZ_LIVE_PROVIDER_HEADERS_JSON: '{"X-A":"1"}',
		FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON: '{"X-B":"2"}',
	});
	deepStrictEqual(env, {
		baseUrl: 'https://provider.example/v1',
		apiKey: 'k',
		model: 'm',
		headersJson: '{"X-A":"1"}',
		invalidHeadersJson: '{"X-B":"2"}',
	});
});

test('skip law: empty env -> all four rows skip, reasons name all three required variables', () => {
	const plan = planRows({});
	deepStrictEqual(plan.map(entry => entry.row), DRILL_ROWS);
	for (const entry of plan) {
		strictEqual(entry.status, 'skip');
		ok(entry.reason !== undefined);
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_BASE_URL'), 'reason names BASE_URL');
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'), 'reason names API_KEY');
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'), 'reason names MODEL');
	}
});

test('skip law: partial provisioning names exactly the still-missing variables', () => {
	const onlyBase = planRows({ baseUrl: 'https://provider.example/v1' });
	for (const entry of onlyBase) {
		strictEqual(entry.status, 'skip');
		ok(entry.reason !== undefined);
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'), 'reason names API_KEY');
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'), 'reason names MODEL');
		ok(!entry.reason.includes('FLAUZ_LIVE_PROVIDER_BASE_URL'), 'the reason never claims BASE_URL is missing');
	}
	const withoutModel = planRows({ baseUrl: 'https://provider.example/v1', apiKey: 'k' });
	for (const entry of withoutModel) {
		strictEqual(entry.status, 'skip');
		ok(entry.reason !== undefined);
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'), 'reason names MODEL');
		ok(!entry.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'), 'API_KEY is provisioned');
	}
});

test('skip law: whitespace-only required values count as missing', () => {
	const plan = planRows({ baseUrl: '   ', apiKey: '\t', model: '' });
	for (const entry of plan) {
		strictEqual(entry.status, 'skip');
		ok(entry.reason !== undefined);
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_BASE_URL'));
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'));
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'));
	}
});

test('skip law: fully provisioned without INVALID_HEADERS_JSON -> only the auth-failure row skips', () => {
	const plan = planRows({ baseUrl: 'https://provider.example/v1', apiKey: 'k', model: 'm' });
	deepStrictEqual(plan.map(entry => entry.row), DRILL_ROWS);
	for (const entry of plan) {
		if (entry.row === 'auth-failure') {
			strictEqual(entry.status, 'skip');
			ok(entry.reason !== undefined);
			ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON'), 'reason names the optional variable');
			continue;
		}
		strictEqual(entry.status, 'run', `${entry.row} must run`);
		ok(entry.reason === undefined, 'run rows carry no reason');
	}
});

test('skip law: malformed or empty-object INVALID_HEADERS_JSON -> only the auth-failure row skips, raw value never echoed', () => {
	for (const rawValue of ['{oops', '{"a":1}', '{}']) {
		const plan = planRows({ baseUrl: 'https://provider.example/v1', apiKey: 'k', model: 'm', invalidHeadersJson: rawValue });
		for (const entry of plan) {
			if (entry.row === 'auth-failure') {
				strictEqual(entry.status, 'skip');
				ok(entry.reason !== undefined);
				ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_INVALID_HEADERS_JSON'), 'reason names the variable');
				ok(!entry.reason.includes(rawValue), 'the raw (possibly secret-bearing) value is never echoed');
				continue;
			}
			strictEqual(entry.status, 'run', `${entry.row} must still run`);
		}
	}
});

test('skip law: malformed HEADERS_JSON -> every row skips, naming the variable', () => {
	const plan = planRows({ baseUrl: 'https://provider.example/v1', apiKey: 'k', model: 'm', headersJson: 'not json' });
	for (const entry of plan) {
		strictEqual(entry.status, 'skip');
		ok(entry.reason !== undefined);
		ok(entry.reason.includes('FLAUZ_LIVE_PROVIDER_HEADERS_JSON'), 'reason names the variable');
		ok(!entry.reason.includes('not json'), 'the raw value is never echoed');
	}
});

// ---------------------------------------------------------------------------
// The header parser, the envelope law, the redaction law, the model-echo law
// (7 tests).
// ---------------------------------------------------------------------------

test('header json: absent/ok/malformed table', () => {
	deepStrictEqual(parseHeaderJson(undefined), { status: 'absent', headers: {} });
	deepStrictEqual(parseHeaderJson(''), { status: 'absent', headers: {} });
	deepStrictEqual(parseHeaderJson('   '), { status: 'absent', headers: {} });
	deepStrictEqual(parseHeaderJson('{}'), { status: 'ok', headers: {} });
	deepStrictEqual(parseHeaderJson('{"X-A":"1","X-B":"2"}'), { status: 'ok', headers: { 'X-A': '1', 'X-B': '2' } });
	deepStrictEqual(parseHeaderJson('oops'), { status: 'malformed', headers: {} });
	deepStrictEqual(parseHeaderJson('[1]'), { status: 'malformed', headers: {} });
	deepStrictEqual(parseHeaderJson('"str"'), { status: 'malformed', headers: {} });
	deepStrictEqual(parseHeaderJson('null'), { status: 'malformed', headers: {} });
	deepStrictEqual(parseHeaderJson('{"x":1}'), { status: 'malformed', headers: {} });
});

test('envelope: exact key order, pinned version id, pass/fail/skip domain', () => {
	for (const status of ['pass', 'fail', 'skip'] as const) {
		const envelope = buildEnvelope('routing', status, { some: 'detail' }, '2025-01-01T00:00:00.000Z', 42);
		deepStrictEqual(Object.keys(envelope), ['envelope', 'row', 'status', 'detail', 'startedAt', 'durationMs']);
		strictEqual(envelope.envelope, DRILL_ENVELOPE_ID);
		strictEqual(DRILL_ENVELOPE_ID, 'flauz.live-provider-drill/v1');
		strictEqual(envelope.status, status);
	}
	deepStrictEqual(DRILL_ROWS, ['routing', 'auth-failure', 'retry', 'provenance']);
});

test('envelope: serializeDrillRow emits one parseable single-line JSON row with ISO startedAt and integer durationMs', () => {
	const serialized = serializeDrillRow(buildEnvelope('provenance', 'pass', { a: 1, nested: { b: [1, 2] } }, '2025-08-06T12:00:00.000Z', 17), []);
	strictEqual(serialized.leaked, false);
	strictEqual(serialized.line.indexOf('\n'), -1, 'single line');
	const parsed = JSON.parse(serialized.line) as { envelope: string; row: string; status: string; detail: unknown; startedAt: string; durationMs: number };
	strictEqual(parsed.envelope, 'flauz.live-provider-drill/v1');
	strictEqual(parsed.row, 'provenance');
	strictEqual(parsed.status, 'pass');
	deepStrictEqual(parsed.detail, { a: 1, nested: { b: [1, 2] } });
	ok(!Number.isNaN(Date.parse(parsed.startedAt)), 'startedAt is ISO 8601');
	ok(Number.isInteger(parsed.durationMs) && parsed.durationMs >= 0, 'durationMs is a non-negative integer');
	strictEqual(buildEnvelope('retry', 'skip', undefined, '2025-08-06T12:00:00.000Z', -3).durationMs, 0, 'negative durations clamp to 0');
});

test('redaction: a synthetic key (or header value) inside detail flags the leak', () => {
	for (const leakyDetail of [{ responseId: `id-${FAKE_KEY}` }, { note: `Bearer ${FAKE_KEY}` }, { headers: { 'x-extra': `value-${FAKE_KEY}` } }]) {
		const serialized = serializeDrillRow(buildEnvelope('provenance', 'pass', leakyDetail, '2025-08-06T12:00:00.000Z', 5), [FAKE_KEY]);
		strictEqual(serialized.leaked, true, 'the leak is detected');
	}
	const clean = serializeDrillRow(buildEnvelope('provenance', 'pass', { responseId: 'resp-1' }, '2025-08-06T12:00:00.000Z', 5), [FAKE_KEY]);
	strictEqual(clean.leaked, false);
	strictEqual(serializeDrillRow(buildEnvelope('routing', 'pass', { x: 1 }, '2025-08-06T12:00:00.000Z', 1), []).leaked, false, 'no secrets -> no leak');
});

test('redaction: finalizeRow on a leak forces fail, replaces detail with the suppressed marker, leaves no trace', () => {
	const finalized = finalizeRow('provenance', 'pass', { responseId: `id-${FAKE_KEY}`, secret: FAKE_KEY }, '2025-08-06T12:00:00.000Z', 9, [FAKE_KEY]);
	strictEqual(finalized.status, 'fail', 'a leak fails the row');
	ok(!finalized.line.includes(FAKE_KEY), 'the emitted line contains no trace of the leaked value');
	strictEqual(finalized.line.indexOf('\n'), -1);
	const parsed = JSON.parse(finalized.line) as { status: string; detail: unknown };
	strictEqual(parsed.status, 'fail');
	strictEqual(parsed.detail, REDACTION_SUPPRESSED_DETAIL);
});

test('redaction: finalizeRow on a clean detail preserves the status and the full detail', () => {
	const finalized = finalizeRow('auth-failure', 'skip', { reason: 'missing optional env' }, '2025-08-06T12:00:00.000Z', 3, [FAKE_KEY]);
	strictEqual(finalized.status, 'skip');
	const parsed = JSON.parse(finalized.line) as { status: string; detail: unknown };
	strictEqual(parsed.status, 'skip');
	deepStrictEqual(parsed.detail, { reason: 'missing optional env' });
	ok(!finalized.line.includes(REDACTION_SUPPRESSED_DETAIL), 'no suppression on clean rows');
});

test('model echo law: exact ids pass, dated-snapshot suffixes pass, sibling ids do not', () => {
	ok(modelEchoMatches('drill-model', 'drill-model'));
	ok(modelEchoMatches('drill-model-2024-08-06', 'drill-model'));
	ok(!modelEchoMatches('drill-model-mini', 'drill-model'));
	ok(!modelEchoMatches('drill-model.1', 'drill-model'));
	ok(!modelEchoMatches('drill-model-5-sonnet', 'drill-model'));
	ok(!modelEchoMatches('drill-model-2024-8-6', 'drill-model'));
	ok(!modelEchoMatches('other-model', 'drill-model'));
	ok(!modelEchoMatches(undefined, 'drill-model'));
	ok(!modelEchoMatches('', 'drill-model'));
});

// ---------------------------------------------------------------------------
// Row semantics through the real runners over in-memory stub ports
// (13 tests).
// ---------------------------------------------------------------------------

test('routing row: happy stub -> pass with 2xx, served-model echo and non-empty output; adapter Bearer wins, extras merged under', async () => {
	const stub = recordingPort(() => happySse());
	const outcome = await runRoutingRow(rowPorts(stub.port, {}, { 'x-extra-header': 'extra-under' }));
	strictEqual(outcome.status, 'pass', JSON.stringify(outcome.detail));
	const detail = outcome.detail as { httpStatus: number; servedModel: string; modelEcho: boolean; outputChars: number; finishReason: string };
	strictEqual(detail.httpStatus, 200);
	strictEqual(detail.servedModel, DRILL_MODEL);
	strictEqual(detail.modelEcho, true);
	ok(detail.outputChars > 0);
	strictEqual(detail.finishReason, 'stop');
	const sent = stub.seen[0];
	ok(sent !== undefined);
	strictEqual(sent.headers?.Authorization, `Bearer ${FAKE_KEY}`, 'the env-resolved Bearer key rides the wire');
	strictEqual(sent.headers?.['Content-Type'], 'application/json', 'adapter headers survive the merge');
	strictEqual(sent.headers?.['x-extra-header'], 'extra-under', 'extras merge under adapter headers');
	strictEqual(sent.url, `${FAKE_BASE_URL}/chat/completions`);
});

test('routing row: a dated-snapshot served model still echoes the requested model', async () => {
	const stub = recordingPort(() => happySse({ model: `${DRILL_MODEL}-2025-08-06` }));
	const outcome = await runRoutingRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'pass');
	const detail = outcome.detail as { servedModel: string; modelEcho: boolean };
	strictEqual(detail.servedModel, `${DRILL_MODEL}-2025-08-06`);
	strictEqual(detail.modelEcho, true);
});

test('routing row: a sibling served model (-mini) fails the echo check', async () => {
	const stub = recordingPort(() => happySse({ model: `${DRILL_MODEL}-mini` }));
	const outcome = await runRoutingRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { servedModel: string; modelEcho: boolean };
	strictEqual(detail.servedModel, `${DRILL_MODEL}-mini`);
	strictEqual(detail.modelEcho, false);
});

test('routing row: empty output text fails the row', async () => {
	const stub = recordingPort(() => httpResponse(200, { 'content-type': 'text/event-stream' }, chunked(openAiSse({ deltas: [] }))));
	const outcome = await runRoutingRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { outcome: string; outputChars: number };
	strictEqual(detail.outcome, 'routing-check-failed');
	strictEqual(detail.outputChars, 0);
});

test('routing row: HTTP 500 fails with the typed PROVIDER_OVERLOADED facts and no vendor body text in the detail', async () => {
	const stub = recordingPort(() => httpResponse(500, { 'content-type': 'application/json' }, [errorBody(`vendor exploded ${FAKE_KEY}`)]));
	const outcome = await runRoutingRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { outcome: string; error: { code: string; name: string; status?: number } };
	strictEqual(detail.outcome, 'request-failed');
	strictEqual(detail.error.code, 'PROVIDER_OVERLOADED');
	strictEqual(detail.error.name, 'ProviderError');
	strictEqual(detail.error.status, 500);
	ok(!JSON.stringify(outcome.detail).includes(FAKE_KEY), 'the vendor body text (and any key material) never reaches the detail');
	ok(!JSON.stringify(outcome.detail).includes('vendor exploded'), 'error messages are never emitted');
});

test('auth-failure row: 401 -> typed AUTH_FAILED, 403 -> typed PERMISSION_DENIED (both pass)', async () => {
	const unauthorized = recordingPort(() => httpResponse(401, {}, [errorBody('bad key')]));
	const unauthorizedOutcome = await runAuthFailureRow(rowPorts(unauthorized.port, { Authorization: 'Bearer deliberately-invalid' }));
	strictEqual(unauthorizedOutcome.status, 'pass', JSON.stringify(unauthorizedOutcome.detail));
	const unauthorizedDetail = unauthorizedOutcome.detail as { outcome: string; code: string; httpStatus: number };
	strictEqual(unauthorizedDetail.outcome, 'auth-rejected');
	strictEqual(unauthorizedDetail.code, 'AUTH_FAILED');
	strictEqual(unauthorizedDetail.httpStatus, 401);
	ok(!JSON.stringify(unauthorizedOutcome.detail).includes('bad key'), 'error messages are never emitted');

	const forbidden = recordingPort(() => httpResponse(403, {}, [errorBody('forbidden')]));
	const forbiddenOutcome = await runAuthFailureRow(rowPorts(forbidden.port, { Authorization: 'Bearer deliberately-invalid' }));
	strictEqual(forbiddenOutcome.status, 'pass');
	strictEqual((forbiddenOutcome.detail as { code: string }).code, 'PERMISSION_DENIED');
});

test('auth-failure row: a 2xx under the invalid credential fails (no-silent-success law)', async () => {
	const stub = recordingPort(() => happySse());
	const outcome = await runAuthFailureRow(rowPorts(stub.port, { Authorization: 'Bearer deliberately-invalid' }));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { outcome: string; httpStatus: number };
	strictEqual(detail.outcome, 'silent-success');
	strictEqual(detail.httpStatus, 200);
});

test('auth-failure row: an untyped throw at the port seam is mapped by the adapter (NETWORK_ERROR) and fails as an unexpected class, leaking nothing', async () => {
	const stub = recordingPort(() => {
		throw new Error(`untyped boom ${FAKE_KEY}`);
	});
	const outcome = await runAuthFailureRow(rowPorts(stub.port, { Authorization: 'Bearer deliberately-invalid' }));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { outcome: string; code?: string; error?: { name: string } };
	strictEqual(detail.outcome, 'unexpected-error-class');
	strictEqual(detail.code, 'NETWORK_ERROR', 'the adapter maps untyped transport failures to the typed taxonomy');
	ok(!JSON.stringify(outcome.detail).includes(FAKE_KEY), 'the untyped error message (with the synthetic key) never reaches the detail');
});

test('auth-failure row: INVALID_HEADERS_JSON rides OVER the adapter Authorization header on the wire', async () => {
	const invalidValue = 'Bearer deliberately-invalid-drill-key';
	const stub = recordingPort(() => httpResponse(401, {}, [errorBody('nope')]));
	const outcome = await runAuthFailureRow(rowPorts(stub.port, { Authorization: invalidValue }));
	strictEqual(outcome.status, 'pass');
	const sent = stub.seen[0];
	ok(sent !== undefined);
	strictEqual(sent.headers?.Authorization, invalidValue, 'the invalid override wins over the adapter credential');
});

test('retry row: every attempt typed-aborts -> bounded typed exhaustion at the default bound, no real sleep', async () => {
	const stub = recordingPort(() => {
		throw new HttpPortAbortError('timeout', 'request aborted (timeout)');
	});
	const waits: number[] = [];
	const outcome = await runRetryRow({ ...rowPorts(stub.port), wait: async (ms: number) => { waits.push(ms); } });
	strictEqual(outcome.status, 'pass', JSON.stringify(outcome.detail));
	const detail = outcome.detail as { bound: number; attempts: number; attemptCodes: string[]; waitsAppliedMs: number[]; wallClockAbortBudgetMs: number };
	strictEqual(detail.bound, 3);
	strictEqual(PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, 3);
	strictEqual(detail.attempts, 3);
	strictEqual(detail.attempts <= PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, true, 'attempts never exceed the bound');
	deepStrictEqual(detail.attemptCodes, ['TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
	deepStrictEqual(detail.waitsAppliedMs, [25, 25]);
	strictEqual(detail.wallClockAbortBudgetMs, 1);
	deepStrictEqual(waits, [25, 25], 'waits flow through the injected wait port (the policy delay, never a test sleep)');
	strictEqual(stub.seen.length, 3, 'exactly the bounded number of wire attempts');
});

test('retry row: a recovery under the abort budget fails (success is never silent)', async () => {
	let calls = 0;
	const stub = recordingPort(() => {
		calls++;
		if (calls === 1) {
			throw new HttpPortAbortError('timeout', 'request aborted (timeout)');
		}
		return happySse();
	});
	const outcome = await runRetryRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'fail');
	const detail = outcome.detail as { outcome: string; attempts: number };
	strictEqual(detail.outcome, 'success-under-abort-budget');
	strictEqual(detail.attempts, 2);
});

test('retry row: an untyped port throw is mapped by the adapter to the typed retryable NETWORK_ERROR class and still bounded-exhausts', async () => {
	const stub = recordingPort(() => {
		throw new Error('garbage transport failure');
	});
	const outcome = await runRetryRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'pass', JSON.stringify(outcome.detail));
	const detail = outcome.detail as { attempts: number; attemptCodes: string[] };
	strictEqual(detail.attempts, 3);
	deepStrictEqual(detail.attemptCodes, ['NETWORK_ERROR', 'NETWORK_ERROR', 'NETWORK_ERROR']);
});

test('provenance row: happy stub -> pass; response id, request-id header, served model, request hash and usage captured', async () => {
	const stub = recordingPort(() => httpResponse(200, { 'content-type': 'text/event-stream', 'x-request-id': 'req-drill-1' }, chunked(openAiSse({ id: 'chatcmpl-drill-prov-1' }))));
	const outcome = await runProvenanceRow(rowPorts(stub.port));
	strictEqual(outcome.status, 'pass', JSON.stringify(outcome.detail));
	const detail = outcome.detail as {
		responseId: string;
		requestIdHeaders: Record<string, string>;
		servedModel: string;
		modelEcho: boolean;
		provenance: { requestHash: string; adapterVersion: string; wireFamily: string };
		usage: { estimatedInputTokens: number; estimatedOutputTokens: number; reportedInputTokens?: number; reportedOutputTokens?: number };
		wireUsage?: { promptTokens?: number; completionTokens?: number };
		httpStatus: number;
		sseFrameCount: number;
	};
	strictEqual(detail.responseId, 'chatcmpl-drill-prov-1');
	deepStrictEqual(detail.requestIdHeaders, { 'x-request-id': 'req-drill-1' });
	strictEqual(detail.servedModel, DRILL_MODEL);
	strictEqual(detail.modelEcho, true);
	ok(typeof detail.provenance.requestHash === 'string' && detail.provenance.requestHash.length === 64, 'the request hash is captured');
	strictEqual(detail.provenance.adapterVersion, 'tl2-002.1');
	strictEqual(detail.provenance.wireFamily, 'openai-chat-completions');
	ok(detail.usage.estimatedInputTokens >= 0 && detail.usage.estimatedOutputTokens >= 0);
	strictEqual(detail.usage.reportedInputTokens, 11, 'the wire-reported input usage surfaces through the adapter');
	strictEqual(detail.usage.reportedOutputTokens, 5);
	strictEqual(detail.wireUsage?.promptTokens, 11, 'the wire-level usage is captured by the observing tee');
	strictEqual(detail.wireUsage?.completionTokens, 5);
	strictEqual(detail.httpStatus, 200);
	ok(detail.sseFrameCount >= 4, 'SSE frames were counted');
	ok(!JSON.stringify(outcome.detail).includes(FAKE_KEY), 'no key material in the provenance detail');
});

// ---------------------------------------------------------------------------
// The pinned retry primitives (the semantic source of truth) (1 test).
// ---------------------------------------------------------------------------

test('retry primitives pinned: bound 3, transient classes 429/5xx only, fixed delay 25 ms, retry-after capped', () => {
	strictEqual(PROVIDER_RETRY_MAX_ATTEMPTS_DEFAULT, 3);
	strictEqual(resolveRetryBound(undefined), 3);
	strictEqual(resolveRetryBound(null), 3);
	strictEqual(resolveRetryBound({}), 3);
	strictEqual(resolveRetryBound({ maxAttempts: 1 }), 1);
	strictEqual(isRetryableProviderStatus(429), true);
	strictEqual(isRetryableProviderStatus(500), true);
	strictEqual(isRetryableProviderStatus(503), true);
	strictEqual(isRetryableProviderStatus(400), false);
	strictEqual(isRetryableProviderStatus(401), false);
	strictEqual(isRetryableProviderStatus(403), false);
	strictEqual(isRetryableProviderStatus(404), false);
	strictEqual(PROVIDER_RETRY_FIXED_DELAY_MS, 25);
	strictEqual(providerRetryWaitMs({ status: 503 }), 25);
	strictEqual(providerRetryWaitMs({ status: 429, retryAfterMs: 5000 }), 5000);
	strictEqual(PROVIDER_RETRY_AFTER_CAP_MS, 30_000);
	strictEqual(providerRetryWaitMs({ status: 429, retryAfterMs: 999_999 }), 30_000);
});

// ---------------------------------------------------------------------------
// The structural law (1 test).
// ---------------------------------------------------------------------------

test('structure: the drill imports the providerRetry contract cross-extension, reads no files and calls no fetch', () => {
	const drillPath = decodeURIComponent(new URL('./canaries/live-provider-runtime.drill.ts', import.meta.url).pathname);
	const source = readFileSync(drillPath, 'utf-8');
	ok(source.includes('flauz-environments/src/lifecycle/providerRetry.ts'), 'the retry primitives come from the environments lifecycle contract (single source of truth)');
	ok(!source.includes('node:fs'), 'the drill reads no files (its only inputs are the five env variables)');
	ok(!/\bfetch\(/.test(source), 'the drill never bypasses the HttpPort seam');
	ok(!source.includes('node:http') && !source.includes('node:https'), 'no raw server/socket imports');
});

// ---------------------------------------------------------------------------
// The offline SKIP-law proofs through the real runDrill driver (1 test).
// ---------------------------------------------------------------------------

test('offline proofs: runDrill with a tripwire port -> no env = 4 skip lines + exit 0 + zero traffic; BASE_URL-only names API_KEY', async () => {
	const none = { fired: 0 };
	const empty = await runDrill({ env: {}, http: tripwirePort(none), wait: async () => undefined });
	strictEqual(empty.exitCode, 0, 'the all-SKIP run exits 0');
	strictEqual(empty.lines.length, 4);
	strictEqual(none.fired, 0, 'zero network traffic');
	const emptyRows = empty.lines.map(line => JSON.parse(line) as { row: string; status: string; detail: { reason?: string } });
	deepStrictEqual(emptyRows.map(row => row.row), ['routing', 'auth-failure', 'retry', 'provenance']);
	for (const row of emptyRows) {
		strictEqual(row.status, 'skip');
		ok(row.detail.reason !== undefined);
		ok(row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_BASE_URL'));
		ok(row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'));
		ok(row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'));
	}

	const partial = await runDrill({ env: { FLAUZ_LIVE_PROVIDER_BASE_URL: 'https://provider.example/v1' }, http: tripwirePort(none), wait: async () => undefined });
	strictEqual(partial.exitCode, 0);
	strictEqual(partial.lines.length, 4);
	strictEqual(none.fired, 0, 'still zero network traffic');
	const partialRows = partial.lines.map(line => JSON.parse(line) as { status: string; detail: { reason?: string } });
	for (const row of partialRows) {
		strictEqual(row.status, 'skip');
		ok(row.detail.reason !== undefined);
		ok(row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_API_KEY'), 'the reason names the missing API key');
		ok(row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_MODEL'), 'the reason names the missing model');
		ok(!row.detail.reason.includes('FLAUZ_LIVE_PROVIDER_BASE_URL is'), 'BASE_URL is provisioned and never claimed missing');
	}
});
