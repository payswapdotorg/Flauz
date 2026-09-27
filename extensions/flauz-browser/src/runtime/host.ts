/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Browser host adapters (TL3-001): the `BrowserHost` port mints real tabs and
 * transports for the session manager. Two implementations:
 *
 *  - `CdpEndpointHost` — connects to an EXTERNAL Chromium over a CDP
 *    WebSocket endpoint (env `FLAUZ_CDP_ENDPOINT`). This is how the runtime
 *    runs outside the workbench (tests, headless, the future sidecar
 *    service — ARCHITECTURE-LOCK section 3 browser v2 posture). Uses
 *    {@link WebSocketCdpTransport}; the transport factory is injectable so
 *    tests drive it with FakeCdpTransport sharing a FakeBrowserState.
 *
 *  - `WorkbenchBrowserHost` — the in-workbench integration (posture P0,
 *    INTEGRATION-GAP.md section 4): opens tabs via the PROPOSED browser API
 *    (`window.openBrowserTab` + `BrowserTab.startCDPSession`) and adapts each
 *    `BrowserCDPSession` onto the CdpTransport port. This file goes through
 *    STRUCTURAL PORTS ONLY (the shapes below transcribe the vendored
 *    vscode-dts/vscode.proposed.browser.d.ts surface); no source file
 *    references the proposed API's types directly.
 */

import {
	CdpTransportBase,
	type CdpTransport,
	scopeToSession,
	WebSocketCdpTransport,
} from '../cdp/transport.ts';

// #region The BrowserHost port

export type BrowserHostKind = 'workbench' | 'cdp-endpoint';

/** A tab the host minted: the CDP target id plus its session-scoped transport. */
export interface HostTabHandle {
	readonly targetId: string;
	readonly transport: CdpTransport;
}

export interface HostTabInfo {
	readonly targetId: string;
	readonly url: string;
}

/** Raised when the host is disconnected and a tab operation was attempted. */
export class BrowserHostError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BrowserHostError';
	}
}

/**
 * The host port. `open()` is idempotent when connected and is ALSO the
 * reconnect entry point (after a drop, the manager calls `open()` again and
 * the host builds a fresh transport). `onDrop` fires on transport loss, never
 * on intentional `close()`.
 */
export interface BrowserHost {
	readonly kind: BrowserHostKind;
	open(): Promise<void>;
	/** Creates a page target and attaches a flat-protocol session to it. */
	createTab(url: string): Promise<HostTabHandle>;
	/** (Re-)attaches a session to an existing target (recovery reconcile). */
	attachTab(targetId: string): Promise<HostTabHandle>;
	closeTab(targetId: string): Promise<void>;
	listTabs(): Promise<HostTabInfo[]>;
	/** Focuses a tab; resolves false when the host kind has no focus surface. */
	focusTab(targetId: string): Promise<boolean>;
	close(): Promise<void>;
	onDrop(handler: (reason: string) => void): void;
	/** True when the host currently holds a live transport connection. */
	readonly connected: boolean;
}

// #endregion

// #region CdpEndpointHost

export interface CdpEndpointHostOptions {
	/** Injectable transport factory (tests: FakeCdpTransport over shared state). */
	transportFactory?: (endpointUrl: string) => CdpTransport;
	commandTimeoutMs?: number;
}

/** Host over an external Chromium CDP WebSocket endpoint (`FLAUZ_CDP_ENDPOINT`). */
export class CdpEndpointHost implements BrowserHost {
	readonly kind: 'cdp-endpoint' = 'cdp-endpoint';
	private readonly endpointUrl: string;
	private readonly transportFactory: (endpointUrl: string) => CdpTransport;
	private transport: CdpTransport | undefined;
	private dropHandlers: Array<(reason: string) => void> = [];
	private intentionalClose = false;

	constructor(endpointUrl: string, options: CdpEndpointHostOptions = {}) {
		this.endpointUrl = endpointUrl;
		this.transportFactory = options.transportFactory ?? ((url: string) => new WebSocketCdpTransport(url, { commandTimeoutMs: options.commandTimeoutMs }));
	}

	get connected(): boolean {
		return this.transport !== undefined && !this.transport.closed;
	}

	/** The endpoint URL this host dials. */
	get endpoint(): string {
		return this.endpointUrl;
	}

	async open(): Promise<void> {
		if (this.connected) {
			return;
		}
		this.intentionalClose = false;
		const transport = this.transportFactory(this.endpointUrl);
		this.transport = transport;
		transport.onClose(reason => {
			if (this.transport !== transport) {
				return; // a stale connection from before a reconnect
			}
			this.transport = undefined;
			if (!this.intentionalClose) {
				for (const handler of [...this.dropHandlers]) {
					try {
						handler(reason);
					} catch {
						// Listener errors never break the drop fan-out.
					}
				}
			}
		});
		try {
			await transport.ready();
		} catch (err) {
			this.transport = undefined;
			throw new BrowserHostError(`CDP endpoint unreachable (${this.endpointUrl}): ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private requireTransport(): CdpTransport {
		if (this.transport === undefined || this.transport.closed) {
			throw new BrowserHostError(`CDP endpoint host is not connected (${this.endpointUrl})`);
		}
		return this.transport;
	}

	async createTab(url: string): Promise<HostTabHandle> {
		const transport = this.requireTransport();
		const created = await transport.send<{ targetId: string }>('Target.createTarget', { url });
		return this.attachToTarget(transport, created.targetId);
	}

	async attachTab(targetId: string): Promise<HostTabHandle> {
		return this.attachToTarget(this.requireTransport(), targetId);
	}

	private async attachToTarget(transport: CdpTransport, targetId: string): Promise<HostTabHandle> {
		const attached = await transport.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
		return { targetId, transport: scopeToSession(transport, attached.sessionId) };
	}

	async closeTab(targetId: string): Promise<void> {
		const transport = this.requireTransport();
		await transport.send('Target.closeTarget', { targetId });
	}

	async listTabs(): Promise<HostTabInfo[]> {
		const transport = this.requireTransport();
		const result = await transport.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
		return result.targetInfos
			.filter(info => info.type === 'page')
			.map(info => ({ targetId: info.targetId, url: info.url }));
	}

	async focusTab(targetId: string): Promise<boolean> {
		const transport = this.requireTransport();
		await transport.send('Target.activateTarget', { targetId });
		return true;
	}

	async close(): Promise<void> {
		this.intentionalClose = true;
		const transport = this.transport;
		this.transport = undefined;
		transport?.close();
	}

	onDrop(handler: (reason: string) => void): void {
		this.dropHandlers.push(handler);
	}
}

// #endregion

// #region Workbench host (proposed browser API, structural ports only)

/**
 * Structural transcription of the proposed `BrowserCDPSession`
 * (vscode.proposed.browser.d.ts): `sendMessage` takes the FULL CDP message
 * object and returns a thenable for the SEND (responses arrive on
 * `onDidReceiveMessage` — correlation is transport-side, exactly like the
 * WebSocket path).
 */
export interface WorkbenchCdpSessionLike {
	sendMessage(message: unknown): PromiseLike<void>;
	onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void };
	onDidClose(listener: () => void): { dispose(): void };
	close(): PromiseLike<void>;
}

/** Structural transcription of the proposed `BrowserTab`. */
export interface WorkbenchBrowserTabLike {
	readonly url: string;
	startCDPSession(): PromiseLike<WorkbenchCdpSessionLike>;
	close(): PromiseLike<void>;
}

/** Structural transcription of `window.openBrowserTab` (+ optional surfaces). */
export interface WorkbenchBrowserWindowLike {
	openBrowserTab(url: string, options?: { viewColumn?: number; preserveFocus?: boolean; background?: boolean }): PromiseLike<WorkbenchBrowserTabLike>;
}

/** Adapts a workbench BrowserCDPSession onto the CdpTransport port. */
export class WorkbenchCdpSessionTransport extends CdpTransportBase {
	private readonly session: WorkbenchCdpSessionLike;

	constructor(session: WorkbenchCdpSessionLike, options: { commandTimeoutMs?: number } = {}) {
		super({ commandTimeoutMs: options.commandTimeoutMs });
		this.session = session;
		session.onDidReceiveMessage(message => {
			this.handleIncomingMessage(message);
		});
		session.onDidClose(() => {
			this.markClosed('workbench-cdp-session-closed');
		});
		this.markReady();
	}

	protected postMessage(payload: Record<string, unknown>): void {
		void Promise.resolve(this.session.sendMessage(payload)).catch(() => {
			// The workbench session rejects the SEND (detaching/...); the command
			// will surface via the session-close path instead. Swallowing here
			// keeps the correlation state consistent.
		});
	}

	protected onTransportClosed(_reason: string): void {
		void Promise.resolve(this.session.close()).catch(() => undefined);
	}
}

/**
 * The in-workbench host (posture P0). Tab identity: the proposed BrowserTab
 * surface has no id property, so this host mints a synthetic `targetId`
 * (`wb-<n>`) per opened tab and tracks the handles. Limitations vs the
 * endpoint host (documented, by proposal surface): `focusTab` resolves false
 * (no activation surface), `listTabs` reports only tabs THIS host opened,
 * and there is no host-level drop event (per-session closes are surfaced on
 * the per-tab transports).
 */
export class WorkbenchBrowserHost implements BrowserHost {
	readonly kind: 'workbench' = 'workbench';
	private readonly windowApi: WorkbenchBrowserWindowLike;
	private readonly commandTimeoutMs: number | undefined;
	private readonly tabs = new Map<string, WorkbenchBrowserTabLike>();
	private counter = 0;
	private closed = false;

	constructor(windowApi: WorkbenchBrowserWindowLike, options: { commandTimeoutMs?: number } = {}) {
		this.windowApi = windowApi;
		this.commandTimeoutMs = options.commandTimeoutMs;
	}

	get connected(): boolean {
		return !this.closed;
	}

	async open(): Promise<void> {
		// The workbench is always "connected"; open() validates we are not closed.
		if (this.closed) {
			throw new BrowserHostError('workbench browser host is closed');
		}
	}

	private requireOpen(): void {
		if (this.closed) {
			throw new BrowserHostError('workbench browser host is closed');
		}
	}

	async createTab(url: string): Promise<HostTabHandle> {
		this.requireOpen();
		const tab = await this.windowApi.openBrowserTab(url);
		this.counter += 1;
		const targetId = `wb-${this.counter}`;
		this.tabs.set(targetId, tab);
		return this.attach(targetId, tab);
	}

	async attachTab(targetId: string): Promise<HostTabHandle> {
		this.requireOpen();
		const tab = this.tabs.get(targetId);
		if (tab === undefined) {
			throw new BrowserHostError(`no workbench tab for targetId ${targetId}`);
		}
		return this.attach(targetId, tab);
	}

	private async attach(targetId: string, tab: WorkbenchBrowserTabLike): Promise<HostTabHandle> {
		const cdpSession = await tab.startCDPSession();
		return { targetId, transport: new WorkbenchCdpSessionTransport(cdpSession, { commandTimeoutMs: this.commandTimeoutMs }) };
	}

	async closeTab(targetId: string): Promise<void> {
		this.requireOpen();
		const tab = this.tabs.get(targetId);
		if (tab === undefined) {
			return; // already gone
		}
		this.tabs.delete(targetId);
		await tab.close();
	}

	async listTabs(): Promise<HostTabInfo[]> {
		return [...this.tabs.entries()].map(([targetId, tab]) => ({ targetId, url: tab.url }));
	}

	async focusTab(_targetId: string): Promise<boolean> {
		// The proposed surface has no tab activation method (only
		// activeBrowserTab change events); documented limitation.
		return false;
	}

	async close(): Promise<void> {
		this.closed = true;
		for (const tab of [...this.tabs.values()]) {
			try {
				await tab.close();
			} catch {
				// Best-effort close of every minted tab.
			}
		}
		this.tabs.clear();
	}

	onDrop(_handler: (reason: string) => void): void {
		// No host-level drop surface on the workbench proposal: per-tab CDP
		// sessions close individually (surfaced on the tab transports).
	}
}

// #endregion
