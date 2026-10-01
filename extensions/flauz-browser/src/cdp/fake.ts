/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * FakeCdpTransport — a scriptable Chromium simulator for TESTS.
 *
 * *** TEST INFRASTRUCTURE — NOT PRODUCTION CODE. *** It speaks just enough
 * CDP (Target / Page / Runtime / Log / Network domains) for the browser
 * runtime's unit suites and driver drills to exercise the REAL pipeline code
 * (transport correlation, policy gating, capture, recovery) without any
 * browser, network, or dependency. It makes no claim about real Chromium
 * behavior beyond the shapes asserted here.
 *
 * Simulation model:
 *   - The browser STATE (targets/pages) lives in a shareable
 *     {@link FakeBrowserState}; the SESSIONS (flat-protocol session ids) are
 *     per-connection, exactly like a real DevTools connection — after a drop,
 *     a fresh transport to the "same browser" sees the same targets but must
 *     re-attach.
 *   - EVERY command is recorded in `sentCommands` (per connection). This is
 *     THE assertion surface for policy gating: the runtime tests assert that
 *     a denied navigation NEVER produced a `Page.navigate` command.
 *   - `Page.navigate` responds with frameId/loaderId, then emits a plausible
 *     main-frame lifecycle: frameStartedLoading -> frameNavigated (carrying
 *     the COMMITTED url, mapped through `commitUrlMapper` for redirect
 *     drills) -> loadEventFired — all tagged with the sessionId.
 *   - `Page.captureScreenshot` returns deterministic fake image bytes
 *     (base64 of `flauz-fake-screenshot:<targetId>:<seq>`).
 *   - `drop()` abruptly kills the connection (pending commands reject; the
 *     shared browser state survives — recovery drills reconnect with a fresh
 *     transport sharing the state).
 *   - `wedged` mode: SESSION-scoped commands are recorded but never answer
 *     (a wedged renderer); BROWSER-level `Target.*` commands still respond,
 *     so the runtime can close the wedged target and mint a replacement.
 *   - Console/log/network events are emitted ON CUE by the test
 *     (emitConsoleApiCall / emitLogEntry / emitRequestWillBeSent / ...).
 *   - TL3-002 surfaces: `Emulation.setUserAgentOverride` /
 *     `Browser.setDownloadBehavior` are recorded per target on the shared
 *     state (userAgentOverrideOf / downloadBehaviorOf — the hardening
 *     assertion surface); `Target.setAutoAttach` is recorded per session
 *     (hasAutoAttach) AND at BROWSER scope (hasBrowserAutoAttach — the
 *     P2-FIX-106/DL-79 gate placement, with the pre-existing-target attach
 *     echoes real Chromium fires when it is armed); `openPopupFrom`
 *     simulates a page opening a popup with REAL browser-level delivery
 *     (P2-FIX-106 re-model: delivered ONLY to a browser-level auto-attach,
 *     root-scoped, `targetInfo.url` EMPTY + `openerId` set at attach —
 *     drill findings F-DELIVERY/F-POPUP-URL; the pending destination is
 *     observed pre-use through the Fetch domain: `Fetch.enable` arms, the
 *     RELEASE (`Runtime.runIfWaitingForDebugger`) starts the pending
 *     navigation which pauses at `Fetch.requestPaused` carrying the URL —
 *     real-Chromium-verified sequencing; `Fetch.failRequest` aborts before
 *     the wire, `Fetch.disable` resumes and commits); `failCommand` scripts
 *     per-method command failures (fail-closed drills). The held-target
 *     release is modeled with the REAL CDP method
 *     (`Runtime.runIfWaitingForDebugger`); `Runtime.run` is deliberately NOT
 *     modeled — real Chromium rejects it with "wasn't found" (drill finding
 *     F-RELEASE-CMD), so the fake fails any regression to the wrong release
 *     command exactly like the real browser.
 */

import { CdpTransportBase, type CdpParams, type CdpTransport } from './transport.ts';

/** One recorded outgoing command (the policy-gating assertion surface). */
export interface FakeSentCommand {
	readonly id: number;
	readonly seq: number;
	readonly method: string;
	readonly params: CdpParams;
	readonly sessionId: string | undefined;
}

export interface FakeTargetInfo {
	readonly targetId: string;
	readonly url: string;
	readonly type: 'page';
	/** P2-FIX-106: opener attribution for popup targets (browser-level provenance). */
	readonly openerId?: string;
}

/**
 * The (connection-independent) simulated browser: targets survive transport
 * drops so recovery drills can reconnect and reconcile.
 */
export class FakeBrowserState {
	private readonly targets = new Map<string, FakeTargetInfo>();
	/** TL3-002 assertion surface: per-target UA overrides (Emulation.setUserAgentOverride). */
	private readonly userAgentOverrides = new Map<string, string>();
	/** TL3-002 assertion surface: per-target download behaviors (Browser.setDownloadBehavior). */
	private readonly downloadBehaviors = new Map<string, string>();
	/** P2-FIX-106: pending popup navigations — a held popup's destination, observed pre-use via Fetch. */
	private readonly pendingNavigations = new Map<string, string>();
	private counters = { target: 0, session: 0, frame: 0, loader: 0, screenshot: 0, fetch: 0 };
	/**
	 * Optional requested->committed URL mapper (redirect / violation drills):
	 * return the URL the "browser" actually commits for a navigation request.
	 */
	public commitUrlMapper: ((requested: string, targetId: string) => string) | undefined;

	/** Creates a page target; returns its target id. */
	createTarget(url: string): string {
		this.counters.target += 1;
		const targetId = `fake-target-${this.counters.target}`;
		this.targets.set(targetId, { targetId, url, type: 'page' });
		return targetId;
	}

	hasTarget(targetId: string): boolean {
		return this.targets.has(targetId);
	}

	/** Removes a target (host close OR an external kill for lost-tab drills). */
	closeTarget(targetId: string): boolean {
		this.userAgentOverrides.delete(targetId);
		this.downloadBehaviors.delete(targetId);
		this.pendingNavigations.delete(targetId); // P2-FIX-106: a destroyed popup's pending navigation dies with it
		return this.targets.delete(targetId);
	}

	urlOf(targetId: string): string | undefined {
		return this.targets.get(targetId)?.url;
	}

	targetInfo(targetId: string): FakeTargetInfo | undefined {
		return this.targets.get(targetId);
	}

	targetInfos(): FakeTargetInfo[] {
		return [...this.targets.values()];
	}

	/** Records a UA override for a target (Emulation.setUserAgentOverride). */
	setUserAgentOverride(targetId: string, userAgent: string): void {
		this.userAgentOverrides.set(targetId, userAgent);
	}

	/** The UA override in effect for a target (undefined = browser default). */
	userAgentOverrideOf(targetId: string): string | undefined {
		return this.userAgentOverrides.get(targetId);
	}

	/** Records the download behavior for a target (Browser.setDownloadBehavior). */
	setDownloadBehavior(targetId: string, behavior: string): void {
		this.downloadBehaviors.set(targetId, behavior);
	}

	/** The download behavior in effect for a target (undefined = browser default). */
	downloadBehaviorOf(targetId: string): string | undefined {
		return this.downloadBehaviors.get(targetId);
	}

	/** Applies the commit mapper (if any) and updates the target's url. */
	commitUrl(requested: string, targetId: string): string {
		const committed = this.commitUrlMapper !== undefined ? this.commitUrlMapper(requested, targetId) : requested;
		const target = this.targets.get(targetId);
		if (target !== undefined) {
			this.targets.set(targetId, { ...target, url: committed });
		}
		return committed;
	}

	nextSessionId(): string {
		this.counters.session += 1;
		return `fake-session-${this.counters.session}`;
	}

	// --- P2-FIX-106: the popup navigation model (real-Chromium shapes) ---

	/**
	 * Creates a popup target attributed to its opener: about:blank at
	 * first (the pending destination is NOT the target's url until it
	 * commits — mirroring the real empty-at-attach fact), with the
	 * destination (if any) recorded as the PENDING navigation the gate
	 * observes pre-use through the Fetch domain.
	 */
	createPopupTarget(openerTargetId: string, destination: string | undefined): string {
		const targetId = this.createTarget('about:blank');
		const target = this.targets.get(targetId);
		if (target !== undefined) {
			this.targets.set(targetId, { ...target, openerId: openerTargetId });
		}
		if (destination !== undefined && destination !== '') {
			this.pendingNavigations.set(targetId, destination);
		}
		return targetId;
	}

	/** The held popup's pending destination (undefined = no destination / already settled). */
	pendingDestinationOf(targetId: string): string | undefined {
		return this.pendingNavigations.get(targetId);
	}

	/**
	 * The pending navigation COMMITS (a released popup without interception,
	 * or `Fetch.disable` resuming a paused request — the allow path): the
	 * target takes the destination URL. Returns the committed URL.
	 */
	commitPopupNavigation(targetId: string): string {
		const destination = this.pendingNavigations.get(targetId) ?? 'about:blank';
		this.pendingNavigations.delete(targetId);
		const target = this.targets.get(targetId);
		if (target !== undefined) {
			this.targets.set(targetId, { ...target, url: destination });
		}
		return destination;
	}

	/** The pending navigation ABORTS before the wire (`Fetch.failRequest` — the deny path): it never loads. */
	abortPopupNavigation(targetId: string): void {
		this.pendingNavigations.delete(targetId);
	}

	/** P2-FIX-106: mints a Fetch request id for a paused pending navigation. */
	nextFetchRequestId(): string {
		this.counters.fetch += 1;
		return `fake-fetch-${this.counters.fetch}`;
	}

	nextFrameId(): string {
		this.counters.frame += 1;
		return `fake-frame-${this.counters.frame}`;
	}

	nextLoaderId(): string {
		this.counters.loader += 1;
		return `fake-loader-${this.counters.loader}`;
	}

	/** Deterministic fake screenshot payload: base64 of a stable ASCII string. */
	nextScreenshotB64(targetId: string): string {
		this.counters.screenshot += 1;
		return btoa(`flauz-fake-screenshot:${targetId}:${this.counters.screenshot}`);
	}
}

export interface FakeCdpTransportOptions {
	/** Share browser state across connections (recovery drills). */
	state?: FakeBrowserState;
	/** Per-command timeout (default 10s; tests use small values). */
	commandTimeoutMs?: number;
}

/** Thrown for malformed/unknown session-scoped commands; surfaces as a CDP error response. */
class FakeCommandFault extends Error {
	readonly code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/** The auto-attach configuration recorded per session (Target.setAutoAttach). */
interface FakeAutoAttach {
	readonly autoAttach: boolean;
	readonly waitForDebuggerOnStart: boolean;
	readonly filter: readonly string[];
}


/** Type guard for the error arm of scripted outcomes (upstream local/code-no-in-operator: `in` only inside predicates). */
function isFakeCommandError(outcome: FakeCommandOutcome): outcome is { readonly error: { readonly code: number; readonly message: string } } {
	return 'error' in outcome;
}
type FakeCommandOutcome =
	| { readonly result: CdpParams; readonly events?: readonly Record<string, unknown>[] }
	| { readonly error: { readonly code: number; readonly message: string } };

/**
 * The scriptable Chromium simulator transport. Implements the full
 * {@link CdpTransport} port (real correlation/timeouts/fan-out code from
 * CdpTransportBase) so the runtime under test behaves exactly as against a
 * live endpoint.
 */
export class FakeCdpTransport extends CdpTransportBase {
	private readonly browser: FakeBrowserState;
	private readonly sessions = new Map<string, string>(); // sessionId -> targetId (per connection)
	private readonly autoAttach = new Map<string, FakeAutoAttach>(); // sessionId -> config (per connection)
	/** P2-FIX-106: BROWSER-scope (root) auto-attach config — the popup gate's placement. */
	private browserAutoAttachConfig: FakeAutoAttach | undefined;
	/** P2-FIX-106: sessions with Fetch interception armed (Fetch.enable). */
	private readonly fetchIntercepted = new Set<string>();
	/** P2-FIX-106: paused requests by id (requestId -> targetId) — held at the network layer. */
	private readonly pausedRequests = new Map<string, string>();
	private readonly faultedMethods = new Set<string>();
	private readonly sentLog: FakeSentCommand[] = [];
	private wedgedMode = false;
	private readonly wedgedTargets = new Set<string>();
	private seqCounter = 0;

	constructor(options: FakeCdpTransportOptions = {}) {
		super({ commandTimeoutMs: options.commandTimeoutMs });
		this.browser = options.state ?? new FakeBrowserState();
		this.markReady();
	}

	/** The shared simulated browser state (targets survive drops). */
	get browserState(): FakeBrowserState {
		return this.browser;
	}

	/** Every command sent on THIS connection, in order (assertion surface). */
	get sentCommands(): readonly FakeSentCommand[] {
		return this.sentLog;
	}

	/** Wedged-renderer mode (whole connection): session-scoped commands never answer. */
	get wedged(): boolean {
		return this.wedgedMode;
	}

	set wedged(value: boolean) {
		this.wedgedMode = value;
	}

	/** Wedges ONE target (a hung renderer): its session commands never answer; other targets stay healthy. */
	wedgeTarget(targetId: string): void {
		this.wedgedTargets.add(targetId);
	}

	/** Un-wedges one target. */
	unwedgeTarget(targetId: string): void {
		this.wedgedTargets.delete(targetId);
	}

	/** Scripted failure injection (fail-closed drills): every command of `method` answers with an error. */
	failCommand(method: string): void {
		this.faultedMethods.add(method);
	}

	/** Clears a scripted command failure. */
	unfailCommand(method: string): void {
		this.faultedMethods.delete(method);
	}

	/** True when the session has auto-attach enabled for the given target (drill surface). */
	hasAutoAttach(sessionId: string): boolean {
		return this.autoAttach.get(sessionId)?.autoAttach === true;
	}

	/** P2-FIX-106: True when BROWSER-scope (root) auto-attach is armed — the popup gate's placement (drill surface). */
	hasBrowserAutoAttach(): boolean {
		return this.browserAutoAttachConfig?.autoAttach === true;
	}

	commandsOf(method: string): FakeSentCommand[] {
		return this.sentLog.filter(command => command.method === method);
	}

	/** Every `Page.navigate` sent on this connection (the policy-gating assertion). */
	pageNavigateCommands(): FakeSentCommand[] {
		return this.commandsOf('Page.navigate');
	}

	/** Abrupt connection kill: pending commands reject, close handlers fire, state survives. */
	drop(): void {
		this.markClosed('dropped');
	}

	/**
	 * Test helper: the CDP session id THIS connection attached for a target.
	 * P2-FIX-106: with browser-scope auto-attach a target legitimately
	 * carries MULTIPLE sessions (the auto-attach held session + the
	 * runtime's explicit attach); the MOST RECENT attach is the runtime's
	 * working session (the one the recorder/pipeline are scoped to).
	 */
	sessionIdOf(targetId: string): string | undefined {
		for (const [sessionId, target] of [...this.sessions].reverse()) {
			if (target === targetId) {
				return sessionId;
			}
		}
		return undefined;
	}

	// --- on-cue event emission (test scripting surface) ---

	emitConsoleApiCall(sessionId: string, params: CdpParams): void {
		this.handleIncomingMessage({ method: 'Runtime.consoleAPICalled', params, sessionId });
	}

	emitLogEntry(sessionId: string, entry: CdpParams): void {
		this.handleIncomingMessage({ method: 'Log.entryAdded', params: { entry }, sessionId });
	}

	emitRequestWillBeSent(sessionId: string, params: CdpParams): void {
		this.handleIncomingMessage({ method: 'Network.requestWillBeSent', params, sessionId });
	}

	emitResponseReceived(sessionId: string, params: CdpParams): void {
		this.handleIncomingMessage({ method: 'Network.responseReceived', params, sessionId });
	}

	emitLoadingFailed(sessionId: string, params: CdpParams): void {
		this.handleIncomingMessage({ method: 'Network.loadingFailed', params, sessionId });
	}

	/**
	 * Simulates a page opening a POPUP (window.open / target=_blank — the
	 * B1c bypass class for popups) — RE-MODELED (P2-FIX-106) to REAL
	 * browser-level delivery: popups are BROWSER-level targets, delivered
	 * ONLY to a connection with BROWSER-scope auto-attach armed (real
	 * Chromium delivers NOTHING to page sessions — drill finding
	 * F-DELIVERY; the old page-session delivery model is gone), and the
	 * attach event carries the target ROOT-scoped with `url` EMPTY and
	 * `openerId` set (drill finding F-POPUP-URL: the pending destination
	 * is NOT available at attach — it is observed pre-use through the
	 * Fetch domain once the hold is released; see `Fetch.enable` /
	 * `Runtime.runIfWaitingForDebugger`). With no browser-level
	 * auto-attach armed the popup free-runs (nothing observed it — the
	 * F-DELIVERY shape with the gate unarmed). Returns the popup target id
	 * when the browser-level attach fired, undefined when it free-ran.
	 */
	openPopupFrom(openerTargetId: string, url: string): string | undefined {
		const popupTargetId = this.browser.createPopupTarget(openerTargetId, url === '' ? undefined : url);
		if (this.browserAutoAttachConfig?.autoAttach !== true) {
			// Free-run: the popup navigates to its destination ungated.
			if (url !== '') {
				this.browser.commitPopupNavigation(popupTargetId);
			}
			return undefined;
			}
			const childSessionId = this.browser.nextSessionId();
			this.sessions.set(childSessionId, popupTargetId);
			this.handleIncomingMessage({
				method: 'Target.attachedToTarget',
				params: {
					sessionId: childSessionId,
				targetInfo: { targetId: popupTargetId, url: '', type: 'page', openerId: openerTargetId },
				waitingForDebugger: this.browserAutoAttachConfig.waitForDebuggerOnStart,
				},
			// Browser-level delivery: NO top-level sessionId (root scope).
			});
		return popupTargetId;
	}

	// --- CdpTransportBase wiring ---

	protected postMessage(payload: Record<string, unknown>): void {
		const id = payload.id as number;
		const method = payload.method as string;
		const params = (payload.params ?? {}) as CdpParams;
		const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId as string : undefined;
		this.seqCounter += 1;
		this.sentLog.push({ id, seq: this.seqCounter, method, params, sessionId });

		if (this.faultedMethods.has(method)) {
			// Scripted failure (fail-closed drills): the command answers with an error.
			this.handleIncomingMessage({ id, error: { code: -32000, message: `scripted failure: ${method}` } });
			return;
		}

		const targetOfSession = sessionId !== undefined ? this.sessions.get(sessionId) : undefined;
		if ((this.wedgedMode || (targetOfSession !== undefined && this.wedgedTargets.has(targetOfSession))) && sessionId !== undefined) {
			// Wedged renderer (whole connection, or one target): recorded, never answered.
			// Browser-level Target.* still respond, and OTHER targets stay healthy.
			return;
		}
		let outcome: FakeCommandOutcome;
		try {
			outcome = this.handleCommand(method, params, sessionId);
		} catch (err) {
			if (err instanceof FakeCommandFault) {
				this.handleIncomingMessage({ id, error: { code: err.code, message: err.message } });
				return;
			}
			throw err;
		}
		if (isFakeCommandError(outcome)) {
			this.handleIncomingMessage({ id, error: outcome.error });
			return;
		}
		this.handleIncomingMessage({ id, result: outcome.result });
		if (outcome.events !== undefined && outcome.events.length > 0) {
			queueMicrotask(() => {
				for (const event of outcome.events ?? []) {
					this.handleIncomingMessage(event);
				}
			});
		}
	}

	protected onTransportClosed(_reason: string): void {
		// Nothing to tear down: the fake holds no external resources.
	}

	private handleCommand(method: string, params: CdpParams, sessionId: string | undefined): FakeCommandOutcome {
		switch (method) {
			case 'Target.createTarget': {
				const url = asString(params.url) ?? 'about:blank';
				const targetId = this.browser.createTarget(url);
				const events: Record<string, unknown>[] = [{ method: 'Target.targetCreated', params: { targetInfo: this.browser.targetInfo(targetId) } }];
				// P2-FIX-106: browser-level auto-attach intercepts NEW targets
				// (held when waitForDebuggerOnStart — the runtime's own minted
				// tabs included; the gate releases them on opener attribution:
				// no opener, not ours to gate). Root-scoped delivery.
				const browserAttach = this.browserAutoAttachConfig;
				if (browserAttach?.autoAttach === true && (browserAttach.filter.length === 0 || browserAttach.filter.includes('page'))) {
					const heldSessionId = this.browser.nextSessionId();
					this.sessions.set(heldSessionId, targetId);
					events.push({
						method: 'Target.attachedToTarget',
						params: { sessionId: heldSessionId, targetInfo: this.browser.targetInfo(targetId), waitingForDebugger: browserAttach.waitForDebuggerOnStart },
					});
			}
				return { result: { targetId }, events };
			}
			case 'Target.attachToTarget': {
				const targetId = asString(params.targetId);
				if (targetId === undefined || !this.browser.hasTarget(targetId)) {
					throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
				}
				const newSessionId = this.browser.nextSessionId();
				this.sessions.set(newSessionId, targetId);
				return { result: { sessionId: newSessionId }, events: [{ method: 'Target.attachedToTarget', params: { sessionId: newSessionId, targetInfo: this.browser.targetInfo(targetId) } }] };
			}
			case 'Target.detachFromTarget': {
				const sid = asString(params.sessionId);
				if (sid === undefined || !this.sessions.has(sid)) {
					throw new FakeCommandFault(-32602, `no such session: ${sid ?? '(none)'}`);
				}
				this.sessions.delete(sid);
				return { result: {} };
			}
			case 'Target.closeTarget': {
				const targetId = asString(params.targetId);
				if (targetId === undefined || !this.browser.closeTarget(targetId)) {
					throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
				}
				for (const [sid, target] of [...this.sessions]) {
					if (target === targetId) {
						this.sessions.delete(sid);
					}
				}
				return { result: { success: true }, events: [{ method: 'Target.targetDestroyed', params: { targetId } }] };
			}
			case 'Target.getTargets': {
				return { result: { targetInfos: this.browser.targetInfos() } };
			}
			case 'Target.getTargetInfo': {
				const targetId = asString(params.targetId);
				const info = targetId === undefined ? undefined : this.browser.targetInfo(targetId);
				if (info === undefined) {
					throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
				}
				return { result: { targetInfo: info } };
			}
			case 'Target.activateTarget': {
				const targetId = asString(params.targetId);
				if (targetId === undefined || !this.browser.hasTarget(targetId)) {
					throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
				}
				return { result: {} };
			}
			case 'Page.enable':
			case 'Page.disable':
			case 'Runtime.enable':
			case 'Runtime.disable':
			case 'Network.enable':
			case 'Network.disable':
			case 'Log.enable':
			case 'Log.disable': {
				this.requireSessionTarget(sessionId);
				return { result: {} };
			}
			case 'Target.setAutoAttach': {
				if (typeof params.autoAttach !== 'boolean') {
					throw new FakeCommandFault(-32602, 'Target.setAutoAttach requires a boolean autoAttach');
				}
				const filter = Array.isArray(params.filter)
					? params.filter.map(entry => (entry !== null && typeof entry === 'object' ? String((entry as CdpParams).type ?? '') : '')).filter(type => type !== '')
					: [];
				if (sessionId === undefined) {
					// P2-FIX-106: BROWSER-scope auto-attach (the popup gate's
					// DL-79 placement). Real Chromium fires attach echoes for
					// PRE-EXISTING matching targets when it is armed (they
					// already started — not waiting); model that too.
					const events: Record<string, unknown>[] = [];
				if (params.autoAttach) {
						this.browserAutoAttachConfig = { autoAttach: true, waitForDebuggerOnStart: params.waitForDebuggerOnStart === true, filter };
						for (const info of this.browser.targetInfos()) {
							if (filter.length !== 0 && !filter.includes(info.type)) {
								continue;
							}
							const echoSessionId = this.browser.nextSessionId();
							this.sessions.set(echoSessionId, info.targetId);
							events.push({ method: 'Target.attachedToTarget', params: { sessionId: echoSessionId, targetInfo: info, waitingForDebugger: false } });
						}
					} else {
						this.browserAutoAttachConfig = undefined;
					}
					return { result: {}, events };
				}
				this.requireSessionTarget(sessionId);
				if (params.autoAttach) {
					this.autoAttach.set(sessionId, {
						autoAttach: true,
						waitForDebuggerOnStart: params.waitForDebuggerOnStart === true,
						filter,
					});
				} else {
					this.autoAttach.delete(sessionId);
				}
				return { result: {} };
			}
			case 'Fetch.enable': {
				// P2-FIX-106 (DL-79): arm request interception on the held
				// target's session. NO pause yet — a debugger-held target
				// starts no request (real-Chromium-verified); the pending
				// navigation pauses at the network layer only once the hold
				// is RELEASED (see Runtime.runIfWaitingForDebugger), and the
				// FIRST `Fetch.requestPaused` carries the destination (the
				// gate's URL input — the empty-at-attach fact worked around
				// by the gate, not here).
				this.requireSessionTarget(sessionId);
				this.fetchIntercepted.add(sessionId as string);
				return { result: {} };
			}
			case 'Fetch.disable': {
				// Disarming interception RESUMES a paused pending request
				// (the allow path's release shape — real-Chromium-verified):
				// the navigation commits.
				const targetId = this.requireSessionTarget(sessionId);
				this.fetchIntercepted.delete(sessionId as string);
				for (const [requestId, pausedTarget] of [...this.pausedRequests]) {
					if (pausedTarget === targetId) {
						this.pausedRequests.delete(requestId);
						this.browser.commitPopupNavigation(targetId);
					}
				}
				return { result: {} };
			}
			case 'Fetch.failRequest': {
				// The deny path: the paused request aborts BEFORE the wire —
				// the pending navigation never loads (zero committed loads,
				// zero bytes to the denied host).
				const targetId = this.requireSessionTarget(sessionId);
				const requestId = asString(params.requestId);
				if (requestId === undefined || this.pausedRequests.get(requestId) !== targetId) {
					throw new FakeCommandFault(-32602, `no such paused request: ${requestId ?? '(none)'}`);
				}
				this.pausedRequests.delete(requestId);
				this.browser.abortPopupNavigation(targetId);
				return { result: {} };
			}
			case 'Runtime.runIfWaitingForDebugger': {
				// The REAL CDP release command (real Chromium rejects
				// `Runtime.run` with "'Runtime.run' wasn't found" — pinned by
				// the real-Chromium drill as finding F-RELEASE-CMD, fixed in
				// the runtime by TL3-P2: the gate allow-path releases held
				// targets with THIS method; `Runtime.run` stays unmodeled so
				// any regression to it fails like the real browser).
				// P2-FIX-106: a RELEASED target proceeds with its pending
				// navigation — with interception armed it PAUSES at the
				// network layer (the first Fetch.requestPaused carries the
				// destination); without interception it simply navigates.
				const targetId = this.requireSessionTarget(sessionId);
				for (const [requestId, pausedTarget] of [...this.pausedRequests]) {
					if (pausedTarget === targetId) {
						this.pausedRequests.delete(requestId); // a re-release cannot double-pause
					}
				}
				const destination = this.browser.pendingDestinationOf(targetId);
				if (destination === undefined) {
				return { result: {} };
			}
				if (this.fetchIntercepted.has(sessionId as string)) {
					const requestId = this.browser.nextFetchRequestId();
					this.pausedRequests.set(requestId, targetId);
					return {
						result: {},
						events: [{ method: 'Fetch.requestPaused', params: { requestId, request: { url: destination }, frameId: this.browser.nextFrameId(), resourceType: 'Document' }, sessionId }],
					};
				}
				this.browser.commitPopupNavigation(targetId);
				return { result: {} };
			}
			case 'Emulation.setUserAgentOverride': {
				const targetId = this.requireSessionTarget(sessionId);
				const userAgent = asString(params.userAgent);
				if (userAgent === undefined || userAgent === '') {
					throw new FakeCommandFault(-32602, 'Emulation.setUserAgentOverride requires a non-empty params.userAgent');
				}
				this.browser.setUserAgentOverride(targetId, userAgent);
				return { result: {} };
			}
			case 'Browser.setDownloadBehavior': {
				const targetId = this.requireSessionTarget(sessionId);
				const behavior = asString(params.behavior);
				if (behavior === undefined || !['deny', 'allow', 'allowAndName', 'default'].includes(behavior)) {
					throw new FakeCommandFault(-32602, `Browser.setDownloadBehavior requires behavior in deny|allow|allowAndName|default (got ${JSON.stringify(params.behavior)})`);
				}
				this.browser.setDownloadBehavior(targetId, behavior);
				return { result: {} };
			}
			case 'Page.navigate': {
				const targetId = this.requireSessionTarget(sessionId);
				const url = asString(params.url);
				if (url === undefined) {
					throw new FakeCommandFault(-32602, 'Page.navigate requires params.url');
				}
				const committed = this.browser.commitUrl(url, targetId);
				const frameId = this.browser.nextFrameId();
				const loaderId = this.browser.nextLoaderId();
				return {
					result: { frameId, loaderId },
					events: [
						{ method: 'Page.frameStartedLoading', params: { frameId }, sessionId },
						{ method: 'Page.frameNavigated', params: { frame: { id: frameId, url: committed, loaderId } }, sessionId },
						{ method: 'Page.loadEventFired', params: {}, sessionId },
					],
				};
			}
			case 'Page.getNavigationHistory': {
				const targetId = this.requireSessionTarget(sessionId);
				const url = this.browser.urlOf(targetId) ?? 'about:blank';
				return { result: { currentIndex: 0, entries: [{ id: 1, url }] } };
			}
			case 'Page.captureScreenshot': {
				const targetId = this.requireSessionTarget(sessionId);
				return { result: { data: this.browser.nextScreenshotB64(targetId) } };
			}
			case 'Runtime.evaluate': {
				this.requireSessionTarget(sessionId);
				const expression = asString(params.expression) ?? '';
				return { result: { result: { type: 'string', value: `flauz-fake-eval:${expression}` } } };
			}
			default:
				return { error: { code: -32601, message: `Method not found: ${method}` } };
		}
	}

	/** Resolves the target a session-scoped command addresses; faults when unknown. */
	private requireSessionTarget(sessionId: string | undefined): string {
		if (sessionId === undefined) {
			throw new FakeCommandFault(-32602, `${'command'} requires a sessionId`);
		}
		const targetId = this.sessions.get(sessionId);
		if (targetId === undefined || !this.browser.hasTarget(targetId)) {
			throw new FakeCommandFault(-32602, `no such session: ${sessionId}`);
		}
		return targetId;
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}
