/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * CDP transport layer tests (TL3-001): message-id correlation (monotonic),
 * response/error correlation, command timeouts, event fan-out (incl.
 * session-scoped filtering), close semantics, and the wait helpers — all
 * against a scripted WebSocket (no network, no dependency).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
		CdpRemoteError,
		CdpTimeoutError,
		CdpTransportClosedError,
		commandTimeout,
		scopeToSession,
		settleWithTimeout,
		waitForCdpEvent,
		WebSocketCdpTransport,
		type WebSocketLike,
} from '../src/cdp/transport.ts';

/** A scripted WebSocket: records frames, lets the test push responses/events. */
class ScriptableSocket implements WebSocketLike {
		readonly frames: string[] = [];
		closed = false;
		opened = false;
		onopen: (() => void) | null = null;
		onmessage: ((event: { data: unknown }) => void) | null = null;
		onclose: ((event: unknown) => void) | null = null;
		onerror: ((event: unknown) => void) | null = null;

		send(data: string): void {
				this.frames.push(data);
		}

		close(): void {
				if (this.closed) {
						return;
				}
				this.closed = true;
				this.onclose?.({ code: 1006 });
		}

		// --- test scripting ---
		openNow(): void {
				this.opened = true;
				this.onopen?.();
		}

		respond(id: number, result: unknown): void {
				this.onmessage?.({ data: JSON.stringify({ id, result }) });
		}

		fail(id: number, code: number, message: string): void {
				this.onmessage?.({ data: JSON.stringify({ id, error: { code, message } }) });
		}

		event(method: string, params: unknown, sessionId?: string): void {
				this.onmessage?.({ data: JSON.stringify(sessionId === undefined ? { method, params } : { method, params, sessionId }) });
		}

		kill(): void {
				this.closed = true;
				this.onclose?.({ code: 1001, reason: 'killed' });
		}
}

function makeTransport(options: { commandTimeoutMs?: number } = {}): { socket: ScriptableSocket; transport: WebSocketCdpTransport } {
		const socket = new ScriptableSocket();
		const transport = new WebSocketCdpTransport('ws://127.0.0.1:9222/devtools/browser/fake', {
				socketFactory: () => socket,
				commandTimeoutMs: options.commandTimeoutMs,
		});
		return { socket, transport };
}

test('ready() resolves once the socket opens; frames carry monotonically increasing ids', async () => {
		const { socket, transport } = makeTransport();
		const ready = transport.ready();
		socket.openNow();
		await ready;
		const first = transport.send('Target.getTargets');
		const second = transport.send('Target.attachToTarget', { targetId: 't1', flatten: true });
		const frames = socket.frames.map(raw => JSON.parse(raw) as { id: number; method: string; params?: unknown });
		assert.equal(frames.length, 2);
		assert.equal(frames[0]?.id, 1);
		assert.equal(frames[0]?.method, 'Target.getTargets');
		assert.equal(frames[1]?.id, 2);
		assert.equal(frames[1]?.method, 'Target.attachToTarget');
		assert.deepEqual(frames[1]?.params, { targetId: 't1', flatten: true });
		socket.respond(1, { targetInfos: [] });
		socket.respond(2, { sessionId: 's1' });
		assert.deepEqual(await first, { targetInfos: [] });
		assert.deepEqual(await second, { sessionId: 's1' });
		transport.close();
});

test('responses correlate by id even when they arrive out of order', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const a = transport.send<{ tag: string }>('A.a');
		const b = transport.send<{ tag: string }>('B.b');
		socket.respond(2, { tag: 'b' });
		socket.respond(1, { tag: 'a' });
		assert.equal((await a).tag, 'a');
		assert.equal((await b).tag, 'b');
		transport.close();
});

test('a CDP error response rejects with CdpRemoteError (code + message)', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const pending = transport.send('Page.navigate', { url: 'https://example.com/' });
		socket.fail(1, -32000, 'Cannot navigate to invalid URL');
		await assert.rejects(pending, (error: unknown) => {
				assert.ok(error instanceof CdpRemoteError);
				assert.equal(error.code, -32000);
				assert.match(error.message, /Page\.navigate/);
				assert.match(error.message, /Cannot navigate/);
				return true;
		});
		transport.close();
});

test('commands time out (CdpTimeoutError) and late responses are ignored', async () => {
		const { socket, transport } = makeTransport({ commandTimeoutMs: 20 });
		socket.openNow();
		const pending = transport.send('Page.navigate', { url: 'https://example.com/' });
		await assert.rejects(pending, (error: unknown) => {
				assert.ok(error instanceof CdpTimeoutError);
				return true;
		});
		// a late response for the timed-out id is a no-op (must not throw):
		socket.respond(1, { frameId: 'f1' });
		// and the next command still works with a fresh id:
		const next = transport.send('Target.getTargets');
		const frames = socket.frames.map(raw => JSON.parse(raw) as { id: number });
		assert.equal(frames[1]?.id, 2);
		socket.respond(2, {});
		await next;
		transport.close();
});

test('events fan out to every subscriber of the method; dispose stops delivery', () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const seenA: string[] = [];
		const seenB: string[] = [];
		const subA = transport.on('Page.frameNavigated', params => {
				seenA.push(String(params['url']));
		});
		const subB = transport.on('Page.frameNavigated', params => {
				seenB.push(String(params['url']));
		});
		transport.on('Page.loadEventFired', () => {
				seenA.push('load');
		});
		socket.event('Page.frameNavigated', { url: 'https://example.com/' });
		assert.deepEqual(seenA, ['https://example.com/']);
		assert.deepEqual(seenB, ['https://example.com/']);
		subB.dispose();
		socket.event('Page.frameNavigated', { url: 'https://example.com/2' });
		assert.deepEqual(seenA, ['https://example.com/', 'https://example.com/2']);
		assert.deepEqual(seenB, ['https://example.com/']);
		subA.dispose();
		transport.close();
});

test('session-scoped events carry their sessionId; scopeToSession filters to one session', () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const scopedOne = scopeToSession(transport, 'sess-1');
		const scopedTwo = scopeToSession(transport, 'sess-2');
		const one: string[] = [];
		const two: string[] = [];
		const any: Array<string | undefined> = [];
		scopedOne.on('Page.frameNavigated', (params, sessionId) => {
				one.push(`${String(params['url'])}@${sessionId}`);
		});
		scopedTwo.on('Page.frameNavigated', (params, sessionId) => {
				two.push(`${String(params['url'])}@${sessionId}`);
		});
		transport.on('Page.frameNavigated', (_params, sessionId) => {
				any.push(sessionId);
		});
		socket.event('Page.frameNavigated', { url: 'https://one.example.com/' }, 'sess-1');
		socket.event('Page.frameNavigated', { url: 'https://two.example.com/' }, 'sess-2');
		assert.deepEqual(one, ['https://one.example.com/@sess-1']);
		assert.deepEqual(two, ['https://two.example.com/@sess-2']);
		assert.deepEqual(any, ['sess-1', 'sess-2']);
		// scoped sends stamp the sessionId on the frame:
		const pending = scopedOne.send('Page.enable');
		const frame = JSON.parse(socket.frames[0] ?? '{}') as { sessionId?: string; method?: string };
		assert.equal(frame.sessionId, 'sess-1');
		assert.equal(frame.method, 'Page.enable');
		socket.respond(1, {});
		void pending;
		transport.close();
});

test('close() rejects pending commands, fires onClose exactly once, and seals send()', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const pending = transport.send('Page.navigate', { url: 'https://example.com/' });
		const reasons: string[] = [];
		transport.onClose(reason => reasons.push(reason));
		transport.close();
		await assert.rejects(pending, (error: unknown) => {
				assert.ok(error instanceof CdpTransportClosedError);
				assert.equal(error.reason, 'closed-by-caller');
				return true;
		});
		assert.deepEqual(reasons, ['closed-by-caller']);
		await assert.rejects(transport.send('Target.getTargets'), (error: unknown) => {
				assert.ok(error instanceof CdpTransportClosedError);
				return true;
		});
		transport.close(); // idempotent
		assert.deepEqual(reasons, ['closed-by-caller']);
		assert.equal(socket.closed, true);
});

test('a socket close event seals the transport with the close reason', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const pending = transport.send('Target.getTargets');
		const reasons: string[] = [];
		transport.onClose(reason => reasons.push(reason));
		socket.kill();
		await assert.rejects(pending, (error: unknown) => {
				assert.ok(error instanceof CdpTransportClosedError);
				assert.match(error.reason, /socket-closed/);
				return true;
		});
		assert.equal(reasons.length, 1);
		assert.match(reasons[0] ?? '', /socket-closed/);
});

test('waitForCdpEvent resolves on the next matching event and honors predicates', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const waiting = waitForCdpEvent<{ frame?: { url?: string } }>(transport, 'Page.frameNavigated', { timeoutMs: 500 });
		socket.event('Page.frameNavigated', { frame: { url: 'https://match.example.com/' } });
		const params = await waiting;
		assert.equal(params.frame?.url, 'https://match.example.com/');

		const filtered = waitForCdpEvent(transport, 'Page.loadEventFired', {
				timeoutMs: 500,
				predicate: params => params['frameId'] === 'f-9',
		});
		socket.event('Page.loadEventFired', { frameId: 'f-1' });
		socket.event('Page.loadEventFired', { frameId: 'f-9' });
		await filtered;

		await assert.rejects(
				waitForCdpEvent(transport, 'Page.loadEventFired', { timeoutMs: 20 }),
				(error: unknown) => error instanceof CdpTimeoutError,
		);
		transport.close();
});

test('settleWithTimeout falls back on timeout and never rejects', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const never = new Promise<unknown>(() => undefined);
		assert.equal(await settleWithTimeout(never, 10, 'fallback'), 'fallback');
		const resolved = Promise.resolve('value');
		assert.equal(await settleWithTimeout(resolved, 10, 'fallback'), 'value');
		const rejected = Promise.reject(new Error('boom'));
		assert.equal(await settleWithTimeout(rejected, 10, 'fallback'), 'fallback');
		transport.close();
});

test('commandTimeout rejects with CdpTimeoutError after the budget and preserves rejections', async () => {
		const { socket, transport } = makeTransport();
		socket.openNow();
		const never = new Promise<unknown>(() => undefined);
		await assert.rejects(commandTimeout(never, 10, 'wedged-label'), (error: unknown) => {
				assert.ok(error instanceof CdpTimeoutError);
				assert.match(error.message, /wedged-label/);
				return true;
		});
		await assert.rejects(commandTimeout(Promise.reject(new Error('original')), 10, 'label'), /original/);
		transport.close();
});
