/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * WorkbenchBrowserHost tests (TL3-001, posture P0): the in-workbench adapter
 * over the PROPOSED browser API surface (`window.openBrowserTab` +
 * `BrowserTab.startCDPSession`), driven through a scripted structural fake
 * (the shapes transcribe vscode.proposed.browser.d.ts; no proposed-API type
 * is referenced by this file). Pins: tab minting, the CDP session adapter's
 * message correlation + event fan-out, close semantics, and the documented
 * limitations (no focus surface, listTabs = own tabs only).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchBrowserHost, type WorkbenchBrowserTabLike, type WorkbenchCdpSessionLike } from '../src/runtime/host.ts';
import { CdpRemoteError } from '../src/cdp/transport.ts';

interface ScriptedSessionState {
	sent: Array<Record<string, unknown>>;
	closeCalls: number;
	messageListeners: Array<(message: unknown) => void>;
	closeListeners: Array<() => void>;
	disposed: boolean;
}

class ScriptedCdpSession implements WorkbenchCdpSessionLike {
	readonly state: ScriptedSessionState = { sent: [], closeCalls: 0, messageListeners: [], closeListeners: [], disposed: false };

	sendMessage(message: unknown): PromiseLike<void> {
		this.state.sent.push(message as Record<string, unknown>);
		return Promise.resolve();
	}

	onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void } {
		this.state.messageListeners.push(listener);
		return { dispose: () => this.state.messageListeners.splice(this.state.messageListeners.indexOf(listener), 1) };
	}

	onDidClose(listener: () => void): { dispose(): void } {
		this.state.closeListeners.push(listener);
		return { dispose: () => this.state.closeListeners.splice(this.state.closeListeners.indexOf(listener), 1) };
	}

	close(): PromiseLike<void> {
		this.state.closeCalls += 1;
		this.state.disposed = true;
		for (const listener of [...this.state.closeListeners]) {
			listener();
		}
		return Promise.resolve();
	}

	// --- scripting ---
	receive(message: unknown): void {
		for (const listener of [...this.state.messageListeners]) {
			listener(message);
		}
	}

	respond(id: number, result: unknown): void {
		this.receive({ id, result });
	}

	fail(id: number, code: number, message: string): void {
		this.receive({ id, error: { code, message } });
	}
}

class ScriptedBrowserTab implements WorkbenchBrowserTabLike {
	readonly url: string;
	closeCalls = 0;
	startCDPSessionCalls = 0;
	readonly session = new ScriptedCdpSession();

	constructor(url: string) {
		this.url = url;
	}

	startCDPSession(): PromiseLike<WorkbenchCdpSessionLike> {
		this.startCDPSessionCalls += 1;
		return Promise.resolve(this.session);
	}

	close(): PromiseLike<void> {
		this.closeCalls += 1;
		return Promise.resolve();
	}
}

function scriptedWindow(): { openBrowserTab: (url: string, options?: { viewColumn?: number; preserveFocus?: boolean; background?: boolean }) => PromiseLike<WorkbenchBrowserTabLike>; tabs: ScriptedBrowserTab[]; openedUrls: string[] } {
	const tabs: ScriptedBrowserTab[] = [];
	const openedUrls: string[] = [];
	return {
		openBrowserTab: (url, options) => {
			openedUrls.push(`${url}|${options?.background === true ? 'bg' : 'fg'}`);
			const tab = new ScriptedBrowserTab(url);
			tabs.push(tab);
			return Promise.resolve(tab);
		},
		tabs,
		openedUrls,
	};
}

test('createTab: openBrowserTab is called, a CDP session is started, and the transport is ready', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	await host.open();
	const handle = await host.createTab('https://docs.example.com/');
	assert.match(handle.targetId, /^wb-\d+$/);
	assert.equal(windowApi.tabs[0]?.url, 'https://docs.example.com/');
	assert.equal(windowApi.tabs[0]?.startCDPSessionCalls, 1);
	await handle.transport.ready();
	assert.equal(handle.transport.closed, false);
	await host.close();
});

test('the session adapter correlates full CDP messages: send -> sendMessage({id, method, params}), response -> resolve', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	const handle = await host.createTab('https://docs.example.com/');
	const pending = handle.transport.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const session = windowApi.tabs[0]?.session.state;
	assert.equal(session?.sent.length, 1);
	const message = session?.sent[0] as { id: number; method: string; params?: unknown };
	assert.equal(message.method, 'Target.createTarget');
	assert.deepEqual(message.params, { url: 'about:blank' });
	assert.equal(message.id, 1);
	windowApi.tabs[0]?.session.respond(message.id, { targetId: 'wb-1' });
	assert.deepEqual(await pending, { targetId: 'wb-1' });
	// monotonically increasing ids:
	const second = handle.transport.send('Page.enable');
	assert.equal((session?.sent[1] as { id: number }).id, 2);
	windowApi.tabs[0]?.session.respond(2, {});
	await second;
	await host.close();
});

test('the session adapter rejects on CDP error responses and fans out events', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	const handle = await host.createTab('https://docs.example.com/');
	const session = windowApi.tabs[0]?.session;
	assert.ok(session !== undefined);

	const failing = handle.transport.send('Page.navigate', { url: 'x' });
	session.fail(1, -32000, 'nav failed');
	await assert.rejects(failing, (error: unknown) => {
		assert.ok(error instanceof CdpRemoteError);
		assert.equal(error.code, -32000);
		return true;
	});

	const events: unknown[] = [];
	handle.transport.on('Page.frameNavigated', params => events.push(params));
	session.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'f1', url: 'https://docs.example.com/' } } });
	assert.deepEqual(events, [{ frame: { id: 'f1', url: 'https://docs.example.com/' } }]);
	await host.close();
});

test('session onDidClose seals the transport (per-tab drop surface); closeTab closes the tab', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	const handle = await host.createTab('https://docs.example.com/');
	const closeReasons: string[] = [];
	handle.transport.onClose(reason => closeReasons.push(reason));
	windowApi.tabs[0]?.session.close();
	assert.equal(handle.transport.closed, true);
	assert.deepEqual(closeReasons, ['workbench-cdp-session-closed']);
	await assert.rejects(handle.transport.send('Page.enable'), /closed/);

	await host.closeTab(handle.targetId);
	assert.equal(windowApi.tabs[0]?.closeCalls, 1);
	await host.close();
});

test('documented limitations: focusTab resolves false; listTabs reports only this host\'s tabs', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	const first = await host.createTab('https://one.example.com/');
	await host.createTab('https://two.example.com/');
	assert.equal(await host.focusTab(first.targetId), false, 'the proposed surface has no activation method');
	const tabs = await host.listTabs();
	assert.deepEqual(tabs.map(tab => tab.url), ['https://one.example.com/', 'https://two.example.com/']);
	await host.close();
	assert.equal(windowApi.tabs[0]?.closeCalls, 1);
	assert.equal(windowApi.tabs[1]?.closeCalls, 1);
});

test('attachTab re-attaches a known tab (fresh CDP session); unknown targetIds error', async () => {
	const windowApi = scriptedWindow();
	const host = new WorkbenchBrowserHost(windowApi);
	const handle = await host.createTab('https://docs.example.com/');
	const reattached = await host.attachTab(handle.targetId);
	assert.notEqual(reattached.transport, handle.transport, 'a re-attach mints a fresh CDP session adapter');
	assert.equal(windowApi.tabs[0]?.startCDPSessionCalls, 2);
	await assert.rejects(host.attachTab('wb-999'), /no workbench tab/);
	await host.close();
});
