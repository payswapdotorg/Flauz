/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * FakeCdpTransport tests (TL3-001): the scriptable Chromium simulator must
 * behave like Chromium for every supported domain (Target lifecycle,
 * Page.navigate lifecycle with committed URLs, screenshots, evaluate,
 * console/log/network event emission on cue), and support the recovery drills
 * (`drop()`, `wedged`, shared browser state across connections).
 *
 * NOTE: FakeCdpTransport is TEST INFRASTRUCTURE (documented as such in
 * src/cdp/fake.ts) — these tests pin the simulator itself so the runtime
 * suites built on it are trustworthy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CdpRemoteError, scopeToSession } from '../src/cdp/transport.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

async function attachFreshTarget(transport: FakeCdpTransport, url = 'about:blank'): Promise<{ targetId: string; sessionId: string }> {
	const created = await transport.send<{ targetId: string }>('Target.createTarget', { url });
	const attached = await transport.send<{ sessionId: string }>('Target.attachToTarget', { targetId: created.targetId, flatten: true });
	return { targetId: created.targetId, sessionId: attached.sessionId };
}

test('Target lifecycle: createTarget/getTargets/attachToTarget/closeTarget roundtrip', async () => {
	const transport = new FakeCdpTransport();
	const { targetId, sessionId } = await attachFreshTarget(transport, 'https://start.example.com/');
	assert.match(targetId, /^fake-target-\d+$/);
	assert.match(sessionId, /^fake-session-\d+$/);
	const targets = await transport.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
	assert.equal(targets.targetInfos.length, 1);
	assert.equal(targets.targetInfos[0]?.targetId, targetId);
	assert.equal(targets.targetInfos[0]?.url, 'https://start.example.com/');
	assert.equal(targets.targetInfos[0]?.type, 'page');
	const info = await transport.send<{ targetInfo: { url: string } }>('Target.getTargetInfo', { targetId });
	assert.equal(info.targetInfo.url, 'https://start.example.com/');
	const closed = await transport.send<{ success: boolean }>('Target.closeTarget', { targetId });
	assert.equal(closed.success, true);
	const after = await transport.send<{ targetInfos: unknown[] }>('Target.getTargets');
	assert.equal(after.targetInfos.length, 0);
	// the session for a closed target is gone too:
	await assert.rejects(
		transport.send('Page.enable', {}, sessionId),
		(error: unknown) => error instanceof CdpRemoteError && /no such session/.test(error.message),
	);
	transport.close();
});

test('Target.createTarget emits targetCreated; closeTarget emits targetDestroyed (browser-level, unscoped)', async () => {
	const transport = new FakeCdpTransport();
	const events: string[] = [];
	transport.on('Target.targetCreated', () => events.push('created'));
	transport.on('Target.targetDestroyed', () => events.push('destroyed'));
	const { targetId } = await attachFreshTarget(transport);
	assert.deepEqual(events, ['created']);
	await transport.send('Target.closeTarget', { targetId });
	assert.deepEqual(events, ['created', 'destroyed']);
	transport.close();
});

test('Page.navigate: command recorded, plausible lifecycle emitted, committed URL tagged with the sessionId', async () => {
	const transport = new FakeCdpTransport();
	const { sessionId } = await attachFreshTarget(transport);
	const lifecycle: Array<{ method: string; sessionId: string | undefined; url?: string }> = [];
	transport.on('Page.frameStartedLoading', (_params, sid) => lifecycle.push({ method: 'loading', sessionId: sid }));
	transport.on('Page.frameNavigated', (params, sid) => lifecycle.push({ method: 'navigated', sessionId: sid, url: (params['frame'] as { url?: string } | undefined)?.url }));
	transport.on('Page.loadEventFired', (_params, sid) => lifecycle.push({ method: 'load', sessionId: sid }));
	const response = await transport.send<{ frameId: string; loaderId: string }>('Page.navigate', { url: 'https://docs.example.com/x' }, sessionId);
	assert.match(response.frameId, /^fake-frame-\d+$/);
	assert.match(response.loaderId, /^fake-loader-\d+$/);
	await new Promise<void>(resolve => queueMicrotask(() => resolve()));
	assert.deepEqual(lifecycle.map(entry => entry.method), ['loading', 'navigated', 'load']);
	assert.equal(lifecycle[1]?.url, 'https://docs.example.com/x');
	assert.ok(lifecycle.every(entry => entry.sessionId === sessionId));
	// the command log is the policy-gating assertion surface:
	assert.equal(transport.pageNavigateCommands().length, 1);
	assert.deepEqual(transport.pageNavigateCommands()[0]?.params, { url: 'https://docs.example.com/x' });
	assert.equal(transport.pageNavigateCommands()[0]?.sessionId, sessionId);
	// and the target's committed URL (navigation history) updated:
	const history = await transport.send<{ entries: Array<{ url: string }> }>('Page.getNavigationHistory', {}, sessionId);
	assert.equal(history.entries[history.entries.length - 1]?.url, 'https://docs.example.com/x');
	transport.close();
});

test('commitUrlMapper: a navigation request can commit somewhere else (redirect/violation drills)', async () => {
	const state = new FakeBrowserState();
	state.commitUrlMapper = requested => requested === 'https://docs.example.com/' ? 'https://tracker.example.net/x' : requested;
	const transport = new FakeCdpTransport({ state });
	const { sessionId } = await attachFreshTarget(transport);
	let committed: string | undefined;
	transport.on('Page.frameNavigated', params => {
		committed = (params['frame'] as { url?: string } | undefined)?.url;
	});
	await transport.send('Page.navigate', { url: 'https://docs.example.com/' }, sessionId);
	await new Promise<void>(resolve => queueMicrotask(() => resolve()));
	assert.equal(committed, 'https://tracker.example.net/x');
	assert.equal(state.urlOf((state.targetInfos()[0] as { targetId: string }).targetId), 'https://tracker.example.net/x');
	transport.close();
});

test('Page.captureScreenshot returns deterministic fake bytes; Runtime.evaluate round-trips', async () => {
	const transport = new FakeCdpTransport();
	const { targetId, sessionId } = await attachFreshTarget(transport);
	const first = await transport.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, sessionId);
	const second = await transport.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, sessionId);
	assert.ok(first.data.length > 0);
	assert.notEqual(first.data, second.data, 'successive screenshots differ (sequence number)');
	const decoded = atob(first.data);
	assert.equal(decoded, `flauz-fake-screenshot:${targetId}:1`);
	const evaluated = await transport.send<{ result: { type: string; value: string } }>('Runtime.evaluate', { expression: '1+1' }, sessionId);
	assert.equal(evaluated.result.value, 'flauz-fake-eval:1+1');
	transport.close();
});

test('domain enable commands respond; unknown methods fail with -32601; missing sessions fail with -32602', async () => {
	const transport = new FakeCdpTransport();
	const { sessionId } = await attachFreshTarget(transport);
	for (const command of ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'] as const) {
		await transport.send(command, {}, sessionId);
	}
	await assert.rejects(
		transport.send('Emulation.setDeviceMetricsOverride', {}, sessionId),
		(error: unknown) => error instanceof CdpRemoteError && error.code === -32601,
	);
	await assert.rejects(
		transport.send('Page.enable'),
		(error: unknown) => error instanceof CdpRemoteError && error.code === -32602,
	);
	transport.close();
});

test('console/log/network events emit ON CUE, session-scoped', async () => {
	const transport = new FakeCdpTransport();
	const { sessionId } = await attachFreshTarget(transport);
	const other = await attachFreshTarget(transport);
	const consoleEvents: unknown[] = [];
	const logEvents: unknown[] = [];
	const networkEvents: string[] = [];
	const scoped = scopeToSession(transport, sessionId);
	scoped.on('Runtime.consoleAPICalled', params => consoleEvents.push(params));
	scoped.on('Log.entryAdded', params => logEvents.push(params));
	scoped.on('Network.requestWillBeSent', () => networkEvents.push('request'));
	scoped.on('Network.responseReceived', () => networkEvents.push('response'));
	scoped.on('Network.loadingFailed', () => networkEvents.push('failed'));

	transport.emitConsoleApiCall(sessionId, { type: 'error', args: [{ type: 'string', value: 'boom' }] });
	transport.emitConsoleApiCall(other.sessionId, { type: 'log', args: [{ type: 'string', value: 'other tab' }] });
	transport.emitLogEntry(sessionId, { level: 'warning', text: 'cert expired' });
	transport.emitRequestWillBeSent(sessionId, { requestId: 'r1', request: { url: 'https://a.example.com/', method: 'GET' } });
	transport.emitResponseReceived(sessionId, { requestId: 'r1', response: { url: 'https://a.example.com/', status: 200 } });
	transport.emitLoadingFailed(sessionId, { requestId: 'r2', errorText: 'net::ERR_BLOCKED_BY_CLIENT' });

	assert.equal(consoleEvents.length, 1, 'only the session-scoped handler sees its own console events');
	assert.deepEqual((consoleEvents[0] as { type?: string }).type, 'error');
	assert.equal(logEvents.length, 1);
	assert.deepEqual((logEvents[0] as { entry?: { level?: string } }).entry?.level, 'warning');
	assert.deepEqual(networkEvents, ['request', 'response', 'failed']);
	transport.close();
});

test('drop(): pending commands reject, onClose fires once, sent-command log survives, shared browser state survives', async () => {
	const state = new FakeBrowserState();
	const transport = new FakeCdpTransport({ state });
	const { targetId } = await attachFreshTarget(transport, 'https://keep.example.com/');
	const closeReasons: string[] = [];
	transport.onClose(reason => closeReasons.push(reason));
	transport.wedged = true;
	const pending = transport.send('Page.navigate', { url: 'https://any.example.com/' }, 'whatever-session');
	transport.wedged = false;
	transport.drop();
	await assert.rejects(pending, (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.match((error as Error).message, /dropped/);
		return true;
	});
	assert.deepEqual(closeReasons, ['dropped']);
	assert.equal(transport.sentCommands.length, 3, 'createTarget + attachToTarget + the wedged navigate are all recorded');
	assert.equal(state.hasTarget(targetId), true, 'browser state survives the connection drop (recovery drills)');
	// a fresh transport sharing the state sees the same target:
	const next = new FakeCdpTransport({ state });
	const targets = await next.send<{ targetInfos: Array<{ targetId: string; url: string }> }>('Target.getTargets');
	assert.equal(targets.targetInfos.length, 1);
	assert.equal(targets.targetInfos[0]?.url, 'https://keep.example.com/');
	next.close();
});

test('wedged mode: session-scoped commands never answer (timeout), browser-level Target.* still respond', async () => {
	const transport = new FakeCdpTransport({ commandTimeoutMs: 25 });
	const { sessionId } = await attachFreshTarget(transport);
	transport.wedged = true;
	await assert.rejects(
		transport.send('Page.navigate', { url: 'https://wedge.example.com/' }, sessionId),
		(error: unknown) => /timed out/.test((error as Error).message),
	);
	// the wedged command WAS recorded (it was sent — the renderer just never answered):
	assert.equal(transport.pageNavigateCommands().length, 1);
	// browser-level commands still work (the browser process is healthy):
	const targets = await transport.send<{ targetInfos: unknown[] }>('Target.getTargets');
	assert.equal(targets.targetInfos.length, 1);
	transport.close();
});

test('every sent command is recorded in order with its id, params, and sessionId', async () => {
	const transport = new FakeCdpTransport();
	const { sessionId } = await attachFreshTarget(transport);
	await transport.send('Page.navigate', { url: 'https://a.example.com/' }, sessionId);
	await transport.send('Page.captureScreenshot', { format: 'png' }, sessionId);
	const commands = transport.sentCommands;
	assert.deepEqual(commands.map(command => command.method), [
		'Target.createTarget',
		'Target.attachToTarget',
		'Page.navigate',
		'Page.captureScreenshot',
	]);
	assert.deepEqual(commands.map(command => command.id), [1, 2, 3, 4]);
	assert.deepEqual(commands.map(command => command.seq), [1, 2, 3, 4]);
	assert.equal(commands[0]?.sessionId, undefined, 'browser-level command: no sessionId');
	assert.equal(commands[2]?.sessionId, sessionId);
	transport.close();
});
