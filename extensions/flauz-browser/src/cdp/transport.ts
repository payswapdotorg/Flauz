/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * CDP client transport layer (TL3-001, Flauz browser runtime).
 *
 * The runtime talks Chromium DevTools Protocol over a promise-based port
 * (`CdpTransport`): commands are correlated by monotonically increasing message
 * ids, responses resolve/reject per-command with timeouts, and CDP events are
 * fanned out to `on(method, handler)` subscribers (session-scoped CDP events
 * carry the flat-protocol `sessionId` and are surfaced to the handler).
 *
 * Zero runtime dependencies: the WebSocket implementation uses the STABLE
 * global `WebSocket` (Node 22+; no `ws` package). Tests inject their own
 * `socketFactory` (cdp-transport.test.ts) so the framing, correlation, and
 * timeout logic is pinned without any network at all.
 *
 * The message shapes are the raw CDP JSON protocol:
 *   request  { id, method, params?, sessionId? }
 *   response { id, result?, error? }
 *   event    { method, params?, sessionId? }
 */

/** One CDP command's params object (arbitrary JSON object). */
export type CdpParams = Record<string, unknown>;

/** A CDP event handler; `sessionId` is set for session-scoped (flat protocol) events. */
export type CdpEventHandler = (params: CdpParams, sessionId: string | undefined) => void;

/** A registered handler/subscription; dispose to unsubscribe. */
export interface CdpSubscription {
	dispose(): void;
}

/** The CdpRemoteError object carried on a command response. */
export interface CdpRemoteErrorShape {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

/** The command-level CdpTransport port (implemented by WebSocket, workbench-session, and the test fake). */
export interface CdpTransport {
	/** Resolves once the underlying channel is usable; rejects if it died before opening. */
	ready(): Promise<void>;
	/**
	 * Sends a CDP command and returns its `result`. `sessionId` routes the
	 * command to a flat-protocol session (Target.attachToTarget). Rejects with
	 * {@link CdpRemoteError} on a CDP error response, {@link CdpTimeoutError}
	 * after `commandTimeoutMs`, and {@link CdpTransportClosedError} after close.
	 */
	send<T = CdpParams>(method: string, params?: CdpParams, sessionId?: string): Promise<T>;
	/** Subscribes to CDP events by `method` (e.g. `Page.frameNavigated`). */
	on(method: string, handler: CdpEventHandler): CdpSubscription;
	/** Subscribes to transport loss; fires at most once with the close reason. */
	onClose(handler: (reason: string) => void): CdpSubscription;
	/** True once the transport is closed (user-initiated or lost). */
	readonly closed: boolean;
	/** Closes the transport; rejects all pending commands, fires `onClose` once. */
	close(): void;
}

/** Default per-command timeout (ms). */
export const DEFAULT_CDP_COMMAND_TIMEOUT_MS = 10_000;

// #region Errors

/** A CDP error RESPONSE (the browser answered with `error`). */
export class CdpRemoteError extends Error {
	readonly code: number;
	readonly data: unknown;
	constructor(method: string, shape: CdpRemoteErrorShape) {
		super(`CDP command '${method}' failed (${shape.code}): ${shape.message}`);
		this.name = 'CdpRemoteError';
		this.code = shape.code;
		this.data = shape.data;
	}
}

/** A locally-detected command timeout (no response within commandTimeoutMs). */
export class CdpTimeoutError extends Error {
	constructor(method: string, timeoutMs: number) {
		super(`CDP command '${method}' timed out after ${timeoutMs}ms (no response)`);
		this.name = 'CdpTimeoutError';
	}
}

/** The transport is gone (dropped, socket error, or closed by the caller). */
export class CdpTransportClosedError extends Error {
	readonly reason: string;
	constructor(reason: string) {
		super(`CDP transport closed (${reason})`);
		this.name = 'CdpTransportClosedError';
		this.reason = reason;
	}
}

export function isCdpTimeoutError(error: unknown): error is CdpTimeoutError {
	return error instanceof CdpTimeoutError;
}

export function isCdpTransportClosedError(error: unknown): error is CdpTransportClosedError {
	return error instanceof CdpTransportClosedError;
}

// #endregion

// #region Correlation base

interface PendingEntry {
	method: string;
	resolve(value: unknown): void;
	reject(error: unknown): void;
	timer: { unref(): void } | undefined;
}

/**
 * Shared correlation machinery: id assignment, pending-command map with
 * per-command timeouts, event fan-out, and one-shot close semantics.
 * Subclasses implement `postMessage` (wire write) and `onTransportClosed`
 * (subclass cleanup on close).
 */
export abstract class CdpTransportBase implements CdpTransport {
	private nextMessageId = 1;
	private readonly pending = new Map<number, PendingEntry>();
	private readonly eventHandlers = new Map<string, Set<CdpEventHandler>>();
	private readonly closeHandlers = new Set<(reason: string) => void>();
	private readonly commandTimeoutMs: number;
	private closeInfo: { closed: boolean; reason: string } = { closed: false, reason: '' };
	private readyPromise: Promise<void>;
	private readySettled = false;
	private resolveReady: () => void = () => undefined;
	private rejectReady: (error: Error) => void = () => undefined;

	protected constructor(options: { commandTimeoutMs?: number } = {}) {
		this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_CDP_COMMAND_TIMEOUT_MS;
		this.readyPromise = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
	}

	get closed(): boolean {
		return this.closeInfo.closed;
	}

	/** The close reason once `closed` is true ('' before). */
	get closeReason(): string {
		return this.closeInfo.reason;
	}

	ready(): Promise<void> {
		return this.readyPromise;
	}

	/** Subclasses call this when the channel is usable. */
	protected markReady(): void {
		this.readySettled = true;
		this.resolveReady();
	}

	async send<T = CdpParams>(method: string, params?: CdpParams, sessionId?: string): Promise<T> {
		if (this.closeInfo.closed) {
			throw new CdpTransportClosedError(this.closeInfo.reason);
		}
		if (!this.readySettled) {
			// Only genuinely-unready channels pay the microtask hop; a ready
			// transport posts synchronously (deterministic command ordering).
			await this.readyPromise;
		}
		if (this.closeInfo.closed) {
			throw new CdpTransportClosedError(this.closeInfo.reason);
		}
		return new Promise<T>((resolve, reject) => {
			const id = this.nextMessageId++;
			const payload: Record<string, unknown> = { id, method };
			if (params !== undefined) {
				payload.params = params;
			}
			if (sessionId !== undefined) {
				payload.sessionId = sessionId;
			}
			let timer: { unref(): void } | undefined;
			if (this.commandTimeoutMs > 0) {
				timer = setTimeout(() => {
					this.pending.delete(id);
					reject(new CdpTimeoutError(method, this.commandTimeoutMs));
				}, this.commandTimeoutMs);
				timer.unref(); // long timeouts never block process exit
			}
			this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
			try {
				this.postMessage(payload);
			} catch (err) {
				this.pending.delete(id);
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});
	}

	/** Subclasses call this with each parsed incoming message (response or event). */
	protected handleIncomingMessage(message: unknown): void {
		if (message === null || typeof message !== 'object') {
			return;
		}
		const record = message as Record<string, unknown>;
		if (typeof record.id === 'number') {
			const entry = this.pending.get(record.id);
			if (entry === undefined) {
				return; // late response after a timeout: deliberately ignored
			}
			this.pending.delete(record.id);
			if (entry.timer !== undefined) {
				clearTimeout(entry.timer);
			}
			const error = record.error;
			if (error !== null && typeof error === 'object') {
				const shape = error as Partial<CdpRemoteErrorShape>;
				entry.reject(new CdpRemoteError(entry.method, {
					code: typeof shape.code === 'number' ? shape.code : -32000,
					message: typeof shape.message === 'string' ? shape.message : 'unknown CDP error',
					data: shape.data,
				}));
				return;
			}
			entry.resolve(record.result ?? {});
			return;
		}
		if (typeof record.method === 'string') {
			const params = (record.params ?? {}) as CdpParams;
			const sessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined;
			this.dispatchEvent(record.method, params, sessionId);
		}
	}

	private dispatchEvent(method: string, params: CdpParams, sessionId: string | undefined): void {
		const handlers = this.eventHandlers.get(method);
		if (handlers === undefined) {
			return;
		}
		for (const handler of [...handlers]) {
			try {
				handler(params, sessionId);
			} catch {
				// A misbehaving listener never breaks the transport.
			}
		}
	}

	on(method: string, handler: CdpEventHandler): CdpSubscription {
		let set = this.eventHandlers.get(method);
		if (set === undefined) {
			set = new Set<CdpEventHandler>();
			this.eventHandlers.set(method, set);
		}
		set.add(handler);
		return {
			dispose: () => {
				set?.delete(handler);
			},
		};
	}

	onClose(handler: (reason: string) => void): CdpSubscription {
		this.closeHandlers.add(handler);
		return { dispose: () => this.closeHandlers.delete(handler) };
	}

	close(): void {
		this.markClosed('closed-by-caller');
		this.onTransportClosed('closed-by-caller');
	}

	/**
	 * Seals the transport: rejects every pending command, fires `onClose`
	 * handlers exactly once, and settles `ready()` if it never opened.
	 */
	protected markClosed(reason: string): void {
		if (this.closeInfo.closed) {
			return;
		}
		this.closeInfo = { closed: true, reason };
		for (const entry of this.pending.values()) {
			if (entry.timer !== undefined) {
				clearTimeout(entry.timer);
			}
			entry.reject(new CdpTransportClosedError(reason));
		}
		this.pending.clear();
		for (const handler of [...this.closeHandlers]) {
			try {
				handler(reason);
			} catch {
				// Never let a close listener break shutdown.
			}
		}
		this.rejectReady(new CdpTransportClosedError(reason)); // no-op when already settled
	}

	/** Wire write; may throw synchronously (rejects just this command). */
	protected abstract postMessage(payload: Record<string, unknown>): void;

	/** Subclass cleanup on close (socket close, session release, ...). */
	protected abstract onTransportClosed(reason: string): void;
}

// #endregion

// #region WebSocket transport

/**
 * Minimal structural socket type (the stable global WebSocket of Node 22+ /
 * browsers satisfies it; tests provide scripted implementations).
 */
export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onopen: (() => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface WebSocketCdpTransportOptions {
	/** Injectable for tests (default: the stable global `WebSocket`). */
	socketFactory?: WebSocketFactory;
	/** Per-command timeout; 0 disables. Default 10s. */
	commandTimeoutMs?: number;
}

/**
 * A CDP transport over a DevTools WebSocket endpoint — the classic
 * browser-level endpoint (ws://host:port/devtools/browser/<id>) or a page
 * endpoint (/devtools/page/<id>). Session-scoped commands (flat protocol)
 * carry the `sessionId` in the frame; session-scoped events arrive tagged
 * with it and are delivered with that context.
 */
export class WebSocketCdpTransport extends CdpTransportBase {
	private readonly endpointUrl: string;
	private socket: WebSocketLike | undefined;

	constructor(endpointUrl: string, options: WebSocketCdpTransportOptions = {}) {
		super({ commandTimeoutMs: options.commandTimeoutMs });
		this.endpointUrl = endpointUrl;
		try {
			const factory = options.socketFactory ?? defaultWebSocketFactory();
			const socket = factory(endpointUrl);
			this.socket = socket;
			socket.onopen = () => {
				this.markReady();
			};
			socket.onmessage = (event) => {
				try {
					const text = typeof event.data === 'string' ? event.data : String(event.data);
					this.handleIncomingMessage(JSON.parse(text));
				} catch {
					// Malformed frames are dropped; the correlation layer keeps its invariants.
				}
			};
			socket.onclose = (event) => {
				this.markClosed(`socket-closed${socketCloseDetail(event)}`);
			};
			socket.onerror = () => {
				// Socket errors are fatal for the transport (the close event may or may not follow).
				this.markClosed('socket-error');
			};
		} catch (err) {
			this.socket = undefined;
			this.markClosed(`socket-factory-error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** The endpoint URL this transport connects to. */
	get endpoint(): string {
		return this.endpointUrl;
	}

	protected postMessage(payload: Record<string, unknown>): void {
		if (this.socket === undefined) {
			throw new CdpTransportClosedError(this.closeReason);
		}
		this.socket.send(JSON.stringify(payload));
	}

	protected onTransportClosed(_reason: string): void {
		const socket = this.socket;
		this.socket = undefined;
		try {
			socket?.close();
		} catch {
			// Best-effort socket teardown.
		}
	}
}

/** Type guard for close-event shapes carrying a code (upstream local/code-no-in-operator: `in` only in predicates). */
function carriesCloseCode(event: unknown): event is { code?: unknown } {
	return typeof event === 'object' && event !== null && 'code' in event;
}

function socketCloseDetail(event: unknown): string {
	if (carriesCloseCode(event)) {
		const code = event.code;
		if (typeof code === 'number') {
			return ` (code ${code})`;
		}
	}
	return '';
}

function defaultWebSocketFactory(): WebSocketFactory {
	return (url: string) => {
		const ctor = (globalThis as { WebSocket?: unknown }).WebSocket;
		if (typeof ctor !== 'function') {
			throw new Error('global WebSocket unavailable (Node >= 22 required); inject socketFactory in tests');
		}
		return new (ctor as new (url: string) => WebSocketLike)(url);
	};
}

// #endregion

// #region Session scoping + waiters

/**
 * A session-scoped VIEW of a (browser-level) transport: `send` stamps the
 * `sessionId`, `on` only delivers events tagged with it. Closing a view is a
 * no-op — the owner (host/manager) manages the underlying connection and
 * target lifecycle (Target.closeTarget / session detach).
 */
export function scopeToSession(transport: CdpTransport, sessionId: string): CdpTransport {
	return {
		get closed() {
			return transport.closed;
		},
		ready: () => transport.ready(),
		send: (method, params) => transport.send(method, params, sessionId),
		on: (method, handler) => transport.on(method, (params, sid) => {
			if (sid === sessionId) {
				handler(params, sid);
			}
		}),
		onClose: (handler) => transport.onClose(handler),
		close: () => {
			// Deliberate no-op: session views do not own the underlying connection.
		},
	};
}

export interface WaitForCdpEventOptions {
	/** Rejects with CdpTimeoutError after this long (0/undefined = no timeout). */
	timeoutMs?: number;
	/** Only settle on events matching this predicate. */
	predicate?: (params: CdpParams, sessionId: string | undefined) => boolean;
}

/**
 * Waits for the next CDP event of `method` (optionally filtered). Rejects on
 * timeout or transport loss; always disposes its subscriptions.
 */
export function waitForCdpEvent<T = CdpParams>(transport: CdpTransport, method: string, options: WaitForCdpEventOptions = {}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timer: { unref(): void } | undefined;
		const cleanup = () => {
			eventSub.dispose();
			closeSub.dispose();
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		};
		const eventSub = transport.on(method, (params, sessionId) => {
			if (options.predicate !== undefined && !options.predicate(params, sessionId)) {
				return;
			}
			cleanup();
			resolve(params as T);
		});
		const closeSub = transport.onClose((reason) => {
			cleanup();
			reject(new CdpTransportClosedError(reason));
		});
		if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
			timer = setTimeout(() => {
				cleanup();
				reject(new CdpTimeoutError(`event:${method}`, options.timeoutMs ?? 0));
			}, options.timeoutMs);
			timer.unref(); // long timeouts never block process exit
		}
	});
}

/**
 * Best-effort settle: resolves `fallback` if `ms` elapses (or `promise`
 * rejects) first; never rejects. Used for the load-event wait, which must not
 * wedge the security-critical commit reconciliation.
 */
export function settleWithTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
	return new Promise<T>((resolve) => {
		let done = false;
		let timer: { unref(): void } | undefined;
		if (ms > 0) {
			timer = setTimeout(() => {
				if (!done) {
					done = true;
					resolve(fallback);
				}
			}, ms);
			timer.unref(); // long timeouts never block process exit
		}
		const finish = (value: T) => {
			if (!done) {
				done = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resolve(value);
			}
		};
		promise.then(
			(value) => finish(value),
			() => finish(fallback),
		);
	});
}

/**
 * Manager-side command timeout: rejects with {@link CdpTimeoutError} after
 * `ms` while preserving the original rejection. This is the wedged-tab
 * detection signal (command timeout on a LIVE transport).
 */
export function commandTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let done = false;
		let timer: { unref(): void } | undefined;
		if (ms > 0) {
			timer = setTimeout(() => {
				if (!done) {
					done = true;
					reject(new CdpTimeoutError(label, ms));
				}
			}, ms);
			timer.unref(); // long timeouts never block process exit
		}
		const finish = (value: T) => {
			if (!done) {
				done = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resolve(value);
			}
		};
		promise.then(
			(value) => finish(value),
			(error) => {
				if (!done) {
					done = true;
					if (timer !== undefined) {
						clearTimeout(timer);
					}
					reject(error);
				}
			},
		);
	});
}

// #endregion
