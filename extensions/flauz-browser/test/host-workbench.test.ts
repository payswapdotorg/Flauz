/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * WorkbenchBrowserHost tests (TL3-001, posture P0): the in-workbench adapter
 * over the PROPOSED browser API surface (`window.openBrowserTab` +
 * `BrowserTab.startCDPSession`), driven through a structural fake that MODELS
 * the upstream workbench CDP routing (the CDPBrowserProxy semantics proven by
 * the first b-policy-boot-drill CI run, 2026-09-28 run 36423586593):
 *
 *  - the session endpoint is BROWSER-LEVEL: the ROOT session (no message
 *    sessionId) serves only the Browser and Target domains — any other
 *    method at root answers -32601 method-not-found (exactly the upstream
 *    handler map);
 *  - `Target.getTargets` lists the fake window's page targets;
 *  - `Target.attachToTarget {flatten:true}` mints a tracked sessionId;
 *  - page-level commands WITH a known sessionId are delivered to the test's
 *    manual response scripting (correlation stays explicit, as before).
 *
 * Pins: the attach dance (createTab finds its page target by URL and scopes
 * every send to the attached session), message correlation + event fan-out,
 * close semantics, the documented limitations (no focus surface, listTabs =
 * own tabs only), and the fail-closed no-matching-target error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkbenchBrowserHost, WorkbenchCdpSessionTransport, type WorkbenchBrowserTabLike, type WorkbenchCdpSessionLike } from '../src/runtime/host.ts';
import { CdpRemoteError } from '../src/cdp/transport.ts';

interface ScriptedSessionState {
		sent: Array<Record<string, unknown>>;
		closeCalls: number;
		messageListeners: Array<(message: unknown) => void>;
		closeListeners: Array<() => void>;
		disposed: boolean;
}

/** A page target the fake window exposes through `Target.getTargets`. */
interface FakePageTarget {
		targetId: string;
		url: string;
}

/**
 * The scripted BrowserCDPSession with the upstream proxy's routing model.
 * The window-level fake registers page targets; getTargets lists them,
 * attachToTarget mints sessions, root-level page commands fail -32601.
 */
class ScriptedCdpSession implements WorkbenchCdpSessionLike {
		readonly state: ScriptedSessionState = { sent: [], closeCalls: 0, messageListeners: [], closeListeners: [], disposed: false };
		private readonly sessions = new Set<string>();
		private readonly targets: FakePageTarget[];
		private nextSession = 1;

		constructor(targets: FakePageTarget[]) {
				this.targets = targets;
		}

		sendMessage(message: unknown): PromiseLike<void> {
				const record = message as Record<string, unknown>;
				this.state.sent.push(record);
				const method = typeof record.method === 'string' ? record.method : '';
				const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
				const id = typeof record.id === 'number' ? record.id : -1;
				if (sessionId === undefined) {
						// ROOT session: the upstream proxy serves Browser.*/Target.* only.
						if (method === 'Target.getTargets') {
								this.respond(id, { targetInfos: this.targets.map(t => ({ targetId: t.targetId, url: t.url, type: 'page' })) });
						} else if (method === 'Target.attachToTarget') {
								const sessionId2 = `sess-${this.nextSession++}`;
								this.sessions.add(sessionId2);
								this.respond(id, { sessionId: sessionId2 });
						} else if (method.startsWith('Target.') || method.startsWith('Browser.')) {
								this.respond(id, {});
						} else {
								this.fail(id, -32601, `'${method}' wasn't found`);
						}
						return Promise.resolve();
				}
				// Attached session: delivered for manual scripting (correlation tests).
				if (!this.sessions.has(sessionId)) {
						this.fail(id, -32000, `Session not found: ${sessionId}`);
				}
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

		/** The sessionId the most recent attachToTarget minted (test convenience). */
		get lastSessionId(): string | undefined {
				return this.sessions.size > 0 ? `sess-${this.sessions.size}` : undefined;
		}
}

class ScriptedBrowserTab implements WorkbenchBrowserTabLike {
		readonly url: string;
		closeCalls = 0;
		startCDPSessionCalls = 0;
		readonly session: ScriptedCdpSession;

		constructor(url: string, targets: FakePageTarget[]) {
				this.url = url;
				this.session = new ScriptedCdpSession(targets);
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
						// The window registers the new tab as a page target BEFORE the
						// session endpoint would list it (createSessionGroup activates
						// after the view exists — the upstream ordering).
						const targets: FakePageTarget[] = [{ targetId: `t-${tabs.length + 1}`, url }];
						const tab = new ScriptedBrowserTab(url, targets);
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

test('createTab performs the attach dance: getTargets -> URL match -> attachToTarget -> session-scoped transport', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		const handle = await host.createTab('https://docs.example.com/');
		const sent = windowApi.tabs[0]?.session.state.sent ?? [];
		assert.equal(sent.length, 2, 'the dance sends exactly getTargets + attachToTarget');
		assert.equal(sent[0]?.method, 'Target.getTargets');
		assert.equal(sent[1]?.method, 'Target.attachToTarget');
		assert.deepEqual(sent[1]?.params, { targetId: 't-1', flatten: true });
		assert.equal(sent[0]?.sessionId, undefined, 'the dance speaks at the root session');
		// A subsequent command is SESSION-SCOPED (the fix the drill forced):
		const pending = handle.transport.send('Page.enable');
		const scoped = windowApi.tabs[0]?.session.state.sent[2] as { id: number; method: string; sessionId?: string };
		assert.equal(scoped.method, 'Page.enable');
		assert.equal(scoped.sessionId, 'sess-1', 'every post-attach send carries the attached sessionId');
		windowApi.tabs[0]?.session.respond(scoped.id, {});
		await pending;
		await host.close();
});

test('REGRESSION (drill 36423586593): page-level commands at the ROOT session answer -32601 method-not-found', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		await host.createTab('https://docs.example.com/');
		// A transport that skips the dance (the pre-fix shape) hits the root:
		const raw = new WorkbenchCdpSessionTransport(windowApi.tabs[0]!.session);
		const failing = raw.send('Page.enable');
		await assert.rejects(failing, (error: unknown) => {
				assert.ok(error instanceof CdpRemoteError);
				assert.equal(error.code, -32601);
				return true;
		});
		await host.close();
});

test('createTab fails closed (typed) when no page target matches the tab URL', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		// Redact the target listing so the URL match cannot succeed: the tab's
		// session lists a DIFFERENT page than the one opened.
		const original = windowApi.openBrowserTab;
		windowApi.openBrowserTab = (url, options) => {
				const tab = new ScriptedBrowserTab(url, [{ targetId: 't-other', url: 'https://redirected.example.com/' }]);
				windowApi.tabs.push(tab);
				windowApi.openedUrls.push(`${url}|${options?.background === true ? 'bg' : 'fg'}`);
				return Promise.resolve(tab);
		};
		void original;
		await assert.rejects(host.createTab('https://docs.example.com/'), /no page target/);
		await host.close();
});

test('the session adapter correlates full CDP messages: send -> sendMessage({id, method, params, sessionId}), response -> resolve', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		const handle = await host.createTab('https://docs.example.com/');
		const pending = handle.transport.send<{ frameId: string }>('Page.getFrameTree');
		const session = windowApi.tabs[0]?.session.state;
		assert.equal(session?.sent.length, 3, 'dance (2) + this command');
		const message = session?.sent[2] as { id: number; method: string; params?: unknown; sessionId?: string };
		assert.equal(message.method, 'Page.getFrameTree');
		assert.equal(typeof message.sessionId, 'string', 'the command is session-scoped');
		assert.equal(typeof message.id, 'number');
		windowApi.tabs[0]?.session.respond(message.id, { frameId: 'f1' });
		assert.deepEqual(await pending, { frameId: 'f1' });
		// monotonically increasing ids:
		const second = handle.transport.send('Page.enable');
		const secondMessage = windowApi.tabs[0]?.session.state.sent[3] as { id: number };
		assert.equal(secondMessage.id, message.id + 1);
		windowApi.tabs[0]?.session.respond(secondMessage.id, {});
		await second;
		await host.close();
});

test('the session adapter rejects on CDP error responses and fans out session-scoped events', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		const handle = await host.createTab('https://docs.example.com/');
		const session = windowApi.tabs[0]?.session;
		assert.ok(session !== undefined);

		const failing = handle.transport.send('Page.navigate', { url: 'x' });
		const navMessage = session.state.sent[2] as { id: number };
		session.fail(navMessage.id, -32000, 'nav failed');
		await assert.rejects(failing, (error: unknown) => {
				assert.ok(error instanceof CdpRemoteError);
				assert.equal(error.code, -32000);
				return true;
		});

		const events: unknown[] = [];
		handle.transport.on('Page.frameNavigated', params => events.push(params));
		// Events fan out with the attached sessionId (the scope filter passes them);
		// a root-level event with NO sessionId must NOT reach the scoped transport.
		session.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'root', url: 'https://wrong.example.com/' } } });
		session.receive({ method: 'Page.frameNavigated', params: { frame: { id: 'f1', url: 'https://docs.example.com/' } }, sessionId: 'sess-1' });
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

test('attachTab re-attaches a known tab (fresh CDP session + fresh dance); unknown targetIds error', async () => {
		const windowApi = scriptedWindow();
		const host = new WorkbenchBrowserHost(windowApi);
		const handle = await host.createTab('https://docs.example.com/');
		const reattached = await host.attachTab(handle.targetId);
		assert.notEqual(reattached.transport, handle.transport, 'a re-attach mints a fresh CDP session adapter');
		assert.equal(windowApi.tabs[0]?.startCDPSessionCalls, 2);
		// The re-attach re-performed the dance on the fresh session:
		const sent = windowApi.tabs[0]?.session.state.sent ?? [];
		assert.equal(sent.filter(m => m.method === 'Target.attachToTarget').length, 2);
		await assert.rejects(host.attachTab('wb-999'), /no workbench tab/);
		await host.close();
});
