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
 *     (hasAutoAttach); `openPopupFrom` simulates a page opening a popup and
 *     delivers `Target.attachedToTarget` to auto-attached sessions (the
 *     popup-gate drill surface); `failCommand` scripts per-method command
 *     failures (fail-closed drills).
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
        private counters = { target: 0, session: 0, frame: 0, loader: 0, screenshot: 0 };
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

        /** Test helper: the CDP session id THIS connection attached for a target. */
        sessionIdOf(targetId: string): string | undefined {
                for (const [sessionId, target] of this.sessions) {
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
         * Simulates a page opening a POPUP (window.open / target=_blank -- the
         * B1c bypass class for popups): creates a new page target in the shared
         * state and delivers `Target.attachedToTarget` to every session of THIS
         * connection that has auto-attach enabled for the opener target (tagged
         * with the PARENT session id so session-scoped views deliver it).
         * Returns the popup target id (or undefined when nothing observed it).
         */
        openPopupFrom(openerTargetId: string, url: string): string | undefined {
                const popupTargetId = this.browser.createTarget(url);
                let observed = false;
                for (const [sessionId, targetId] of [...this.sessions]) {
                        if (targetId !== openerTargetId) {
                                continue;
                        }
                        const config = this.autoAttach.get(sessionId);
                        if (config?.autoAttach !== true) {
                                continue;
                        }
                        const childSessionId = this.browser.nextSessionId();
                        this.sessions.set(childSessionId, popupTargetId);
                        this.handleIncomingMessage({
                                method: 'Target.attachedToTarget',
                                params: {
                                        sessionId: childSessionId,
                                        targetInfo: this.browser.targetInfo(popupTargetId),
                                        waitingForDebugger: config.waitForDebuggerOnStart,
                                },
                                sessionId, // tag with the PARENT session: scoped views deliver it
                        });
                        observed = true;
                }
                return observed ? popupTargetId : undefined;
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
                                const url = asString(params['url']) ?? 'about:blank';
                                const targetId = this.browser.createTarget(url);
                                return { result: { targetId }, events: [{ method: 'Target.targetCreated', params: { targetInfo: this.browser.targetInfo(targetId) } }] };
                        }
                        case 'Target.attachToTarget': {
                                const targetId = asString(params['targetId']);
                                if (targetId === undefined || !this.browser.hasTarget(targetId)) {
                                        throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
                                }
                                const newSessionId = this.browser.nextSessionId();
                                this.sessions.set(newSessionId, targetId);
                                return { result: { sessionId: newSessionId }, events: [{ method: 'Target.attachedToTarget', params: { sessionId: newSessionId, targetInfo: this.browser.targetInfo(targetId) } }] };
                        }
                        case 'Target.detachFromTarget': {
                                const sid = asString(params['sessionId']);
                                if (sid === undefined || !this.sessions.has(sid)) {
                                        throw new FakeCommandFault(-32602, `no such session: ${sid ?? '(none)'}`);
                                }
                                this.sessions.delete(sid);
                                return { result: {} };
                        }
                        case 'Target.closeTarget': {
                                const targetId = asString(params['targetId']);
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
                                const targetId = asString(params['targetId']);
                                const info = targetId === undefined ? undefined : this.browser.targetInfo(targetId);
                                if (info === undefined) {
                                        throw new FakeCommandFault(-32602, `no such target: ${targetId ?? '(none)'}`);
                                }
                                return { result: { targetInfo: info } };
                        }
                        case 'Target.activateTarget': {
                                const targetId = asString(params['targetId']);
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
                                this.requireSessionTarget(sessionId);
                                if (typeof params['autoAttach'] !== 'boolean') {
                                        throw new FakeCommandFault(-32602, 'Target.setAutoAttach requires a boolean autoAttach');
                                }
                                const filter = Array.isArray(params['filter'])
                                        ? params['filter'].map(entry => (entry !== null && typeof entry === 'object' ? String((entry as CdpParams)['type'] ?? '') : '')).filter(type => type !== '')
                                        : [];
                                if (params['autoAttach']) {
                                        this.autoAttach.set(sessionId as string, {
                                                autoAttach: true,
                                                waitForDebuggerOnStart: params['waitForDebuggerOnStart'] === true,
                                                filter,
                                        });
                                } else {
                                        this.autoAttach.delete(sessionId as string);
                                }
                                return { result: {} };
                        }
                        case 'Runtime.run': {
                                this.requireSessionTarget(sessionId);
                                return { result: {} };
                        }
                        case 'Emulation.setUserAgentOverride': {
                                const targetId = this.requireSessionTarget(sessionId);
                                const userAgent = asString(params['userAgent']);
                                if (userAgent === undefined || userAgent === '') {
                                        throw new FakeCommandFault(-32602, 'Emulation.setUserAgentOverride requires a non-empty params.userAgent');
                                }
                                this.browser.setUserAgentOverride(targetId, userAgent);
                                return { result: {} };
                        }
                        case 'Browser.setDownloadBehavior': {
                                const targetId = this.requireSessionTarget(sessionId);
                                const behavior = asString(params['behavior']);
                                if (behavior === undefined || !['deny', 'allow', 'allowAndName', 'default'].includes(behavior)) {
                                        throw new FakeCommandFault(-32602, `Browser.setDownloadBehavior requires behavior in deny|allow|allowAndName|default (got ${JSON.stringify(params['behavior'])})`);
                                }
                                this.browser.setDownloadBehavior(targetId, behavior);
                                return { result: {} };
                        }
                        case 'Page.navigate': {
                                const targetId = this.requireSessionTarget(sessionId);
                                const url = asString(params['url']);
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
                                const expression = asString(params['expression']) ?? '';
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
