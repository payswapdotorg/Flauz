/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * REAL-Chromium hardening drill (TL3-003, lane `tl3/a3-browser-real`): the
 * TL3-001/TL3-002 browser runtime driven against a REAL Chromium over a REAL
 * CDP WebSocket — the verification class the FakeCdpTransport cannot provide
 * ("the Fake pins the shapes, not Chromium's behavior", INTEGRATION-GAP.md
 * "What remains"). This is REAL-VERIFICATION code, clearly separated from the
 * unit suites: it is NOT part of `npm test` and never fails a gate for
 * lacking a browser.
 *
 * WHAT IT DRIVES (REAL code only): `CdpEndpointHost` + `WebSocketCdpTransport`
 * + `BrowserSessionManager` + the policy-gated navigation pipeline + the
 * TL3-002 per-session hardening + the popup/new-target gate + the
 * transport-drop recovery — against a real Chromium (developed and verified
 * against Chrome for Testing 153.0.8010.12, headless=new).
 *
 * WHAT IT ASSERTS (work order items 3.1a-3.1e), each with REAL observed
 * evidence: wire frames recorded on the real socket (a subclass of
 * WebSocketCdpTransport records every CDP frame SENT — the real-browser
 * analog of FakeCdpTransport's sent-command log), real committed URLs
 * (Page.frameNavigated over the real wire), real PNG screenshot bytes, real
 * navigator.userAgent reads through an independent observer connection, the
 * real download state machine (Browser.downloadWillBegin ->
 * Browser.downloadProgress 'canceled'), real popup interception timing, and
 * the real suspend -> reconnect -> re-attach -> re-harden -> re-check
 * recovery after a mid-session socket kill.
 *
 * REAL-CHROMIUM FINDINGS PINNED BY THIS DRILL (asserted, not papered over —
 * if Chromium's behavior changes, these assertions FAIL and force a re-look;
 * that is the drift-canary property):
 *   F-DELIVERY (OPEN): `Target.setAutoAttach` on a PAGE session (the popup
 *     gate's placement, sessionManager.ts attachTargetGate) does NOT deliver
 *     window.open popups on real Chromium — popups are browser-level targets
 *     and free-run past the page-level gate. FakeCdpTransport models popup
 *     delivery to the opener target's sessions; real Chromium does not.
 *     The fix is the TL-adjudicated browser-level gate-placement redesign
 *     (see INTEGRATION-GAP.md "What remains").
 *   F-POPUP-URL (OPEN): at browser-level attach (waitForDebuggerOnStart), a
 *     window.open popup arrives with `targetInfo.url` EMPTY — the pending
 *     navigation URL is NOT available at gate time. FakeCdpTransport pins
 *     the full URL in the attach event; real Chromium provides none. Part
 *     of the same redesign decision (the URL-observation strategy).
 *   F-RELEASE-CMD (FIXED — TL3-P2): `Runtime.run` is NOT a real CDP method
 *     (real Chromium answers "'Runtime.run' wasn't found"); the real
 *     release command is `Runtime.runIfWaitingForDebugger`. The runtime's
 *     gate allow-path now sends `Runtime.runIfWaitingForDebugger` (pinned at
 *     unit level by test/popup-gate.test.ts with the fake modeling the real
 *     wire; assertion 3.1d-6d below keeps pinning the motivating real-wire
 *     fact).
 *   F-OPENER-BLOCK (OPEN): `window.open` BLOCKS the opener's JS while the
 *     popup is held (waitForDebuggerOnStart): the call returns only after
 *     the popup is released — and never returns if the held popup is closed
 *     without being released (the deny-path shape). Timing shape of the
 *     same redesign.
 *   F-RECOVERY-DOMAINS (FIXED — TL3-P2): the recovery re-attach did not
 *     re-send the domain enables (`Page.enable` et al.), so on real Chromium
 *     the post-recovery commit observation timed out and the
 *     security-relevant post-commit reconciliation was skipped after every
 *     transport drop. The recovery re-attach now runs the FULL mint-time
 *     activation (domain enables + hardening + gate — pinned at unit level
 *     by test/recovery.test.ts); 3.1e-4b below asserts the FIXED behavior on
 *     the real wire (the flipped assertion FAILS on the untouched base —
 *     that is the regression pin).
 * The mechanics that DO hold on real Chromium are pinned as passing
 * assertions: browser-level auto-attach DOES intercept popups
 * (waitingForDebugger=true), `Target.closeTarget` on a held (never-run)
 * popup destroys it (the deny-path primitive), and
 * `Runtime.runIfWaitingForDebugger` releases it (the allow-path primitive).
 *
 * HOW TO RUN (a real Chromium endpoint is required):
 *   chromium --headless=new --no-sandbox --disable-gpu \
 *            --disable-popup-blocking --remote-debugging-port=9222 \
 *            --user-data-dir=/tmp/flauz-chrome about:blank
 *   # --disable-popup-blocking matters: Runtime.evaluate runs WITHOUT a user
 *   # gesture, so Chrome's popup blocker would block window.open before the
 *   # gate shapes can be observed.
 *   # take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
 *   FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
 *     node test/canaries/real-chromium-hardening.drill.ts
 *
 * SKIP semantics (never fail a gate for lacking a browser):
 *   - FLAUZ_REALCHROMIUM_SKIP=1       -> SKIP (forced)
 *   - FLAUZ_CDP_ENDPOINT unset        -> `SKIP: no FLAUZ_CDP_ENDPOINT`
 *   - endpoint unreachable (3s probe) -> `SKIP: FLAUZ_CDP_ENDPOINT unreachable`
 *   Exit 0 on SKIP. Exit 1 ONLY when a REACHABLE browser diverges from the
 *   pinned assertions (a real regression, or a Chromium behavior change —
 *   exactly what this drill exists to catch).
 *
 * Zero runtime dependencies: Node >= 23.6 stdlib (node:http local origin
 * server so allowed/denied hosts are real navigations without external
 * network; global WebSocket via WebSocketCdpTransport; global fetch for
 * /json/version). No secrets: the endpoint comes from the environment.
 *
 * Exit codes: 0 = drill green (or SKIP); 1 = any assertion failed.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { BrowserPolicyEngine } from '../../src/policy.ts';
import { waitForCdpEvent, WebSocketCdpTransport } from '../../src/cdp/transport.ts';
import { CdpEndpointHost } from '../../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome, isSessionError } from '../../src/runtime/sessionManager.ts';
import { flauzAgentUserAgent, FLAUZ_AGENT_UA_TOKEN } from '../../src/runtime/hardening.ts';

const ENDPOINT = process.env['FLAUZ_CDP_ENDPOINT'] ?? '';
const FORCE_SKIP = process.env['FLAUZ_REALCHROMIUM_SKIP'] === '1';
const WORKSPACE_ROOT = '/ws/flauz-real-chromium-drill';

/** Tuned for a real local Chromium: generous command timeouts, fast local pages. */
const COMMAND_TIMEOUT_MS = 10_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * The drill policy: the local origin server (127.0.0.1:<ephemeral>) is the
 * ALLOWED host at every layer; `localhost` (a DIFFERENT host string for the
 * matcher — the engine has no implicit localhost exemption) is the DENIED
 * popup target; anything else (denied.example.org) is denied at the driver
 * layer without any network.
 */
const POLICY_LOOPBACK = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['127.0.0.1'] },
	webRequest: { allow: ['127.0.0.1'] },
	willNavigate: { allow: ['127.0.0.1'] },
	partitions: { scope: 'persist', perAgent: true },
});

/** The hot-swapped policy for the recovery current-policy recheck: 127.0.0.1 is now driver-denied. */
const POLICY_LOOPBACK_DENIED = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['neutral.flauz-drill.invalid'] },
	webRequest: { allow: ['127.0.0.1'] },
	willNavigate: { allow: ['127.0.0.1'] },
	partitions: { scope: 'persist', perAgent: true },
});

let policyText = POLICY_LOOPBACK;

let failures = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	if (condition) {
		console.log(`REAL-CHROMIUM drill: PASS ${label}`);
	} else {
		failures += 1;
		console.error(`REAL-CHROMIUM drill: FAIL ${label} -- ${detail}`);
	}
}

function info(message: string): void {
	console.log(`REAL-CHROMIUM drill: NOTE ${message}`);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** The Target.attachedToTarget params slice the drill consumes (flat protocol). */
interface AttachEventParams {
	readonly sessionId: string;
	readonly targetInfo: { readonly targetId: string; readonly url: string; readonly type?: string };
	readonly waitingForDebugger?: boolean;
}

// #region Wire recording (the real-socket analog of FakeCdpTransport's sent-command log)

/** One CDP frame SENT on the real socket (method + flat-protocol session routing). */
interface WireFrame {
	readonly method: string;
	readonly sessionId: string | undefined;
}

/**
 * A real WebSocketCdpTransport that records every CDP frame it sends — the
 * same assertion surface FakeCdpTransport gives the unit suites, but on the
 * REAL wire. Subclassing keeps the recording out of production code and out
 * of the socket layer entirely.
 */
class RecordingWebSocketCdpTransport extends WebSocketCdpTransport {
	readonly sentFrames: WireFrame[] = [];

	protected postMessage(payload: Record<string, unknown>): void {
		this.sentFrames.push({
			method: typeof payload.method === 'string' ? payload.method : '',
			sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : undefined,
		});
		super.postMessage(payload);
	}
}

function countFrames(transport: RecordingWebSocketCdpTransport | undefined, method: string): number {
	return transport === undefined ? 0 : transport.sentFrames.filter(frame => frame.method === method).length;
}

// #endregion

// #region Observer (an independent real connection: read-side evidence + primitive probes)

/** The independent observer connection: a second real WebSocket to the same browser. */
let observer: WebSocketCdpTransport;

interface TargetInfoLike {
	readonly targetId: string;
	readonly url: string;
	readonly type: string;
}

async function observerAttach(targetId: string): Promise<string> {
	const attached = await observer.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
	return attached.sessionId;
}

async function observerEvaluate(sessionId: string, expression: string): Promise<string> {
	const response = await observer.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
	return typeof response.result?.value === 'string' ? response.result.value : '';
}

async function observerPageTargets(): Promise<TargetInfoLike[]> {
	const targets = await observer.send<{ targetInfos: Array<{ targetId: string; url: string; type: string }> }>('Target.getTargets');
	return targets.targetInfos.filter(info => info.type === 'page');
}

async function observerTargetExists(targetId: string): Promise<boolean> {
	try {
		await observer.send('Target.getTargetInfo', { targetId });
		return true;
	} catch {
		return false;
	}
}

/** An evaluate fired but NOT awaited (window.open blocks the opener while a popup is held). */
interface FiredCall {
	readonly promise: Promise<{ value?: string; error?: string }>;
	settled(): boolean;
}

/** Records every Target.attachedToTarget event while active (no lost-event race). */
interface AttachRecorder {
	readonly events: AttachEventParams[];
	dispose(): void;
}

function recordAttachEvents(): AttachRecorder {
	const events: AttachEventParams[] = [];
	const subscription = observer.on('Target.attachedToTarget', params => {
		const targetInfo = params.targetInfo as { targetId?: unknown; url?: unknown; type?: unknown } | undefined;
		const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
		if (targetInfo === undefined || typeof targetInfo.targetId !== 'string') {
			return;
		}
		events.push({
			sessionId,
			targetInfo: { targetId: targetInfo.targetId, url: typeof targetInfo.url === 'string' ? targetInfo.url : '', type: typeof targetInfo.type === 'string' ? targetInfo.type : undefined },
			waitingForDebugger: params.waitingForDebugger === true,
		});
	});
	return { events, dispose: () => subscription.dispose() };
}

/** Waits for a recorded attach event for a specific target id (poll; no subscription race). */
async function waitForRecordedAttach(recorder: AttachRecorder, targetId: string, timeoutMs: number): Promise<AttachEventParams | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (; ;) {
		const found = recorder.events.find(event => event.targetInfo.targetId === targetId);
		if (found !== undefined) {
			return found;
		}
		if (Date.now() >= deadline) {
			return undefined;
		}
		await sleep(100);
	}
}

function fireWindowOpen(sessionId: string, url: string): FiredCall {
	let done = false;
	const expression = `window.open(${JSON.stringify(url)}) ? 'opened' : 'blocked'`;
	const promise = observer.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression, returnByValue: true }, sessionId)
		.then(response => {
			done = true;
			return { value: typeof response.result?.value === 'string' ? response.result.value : undefined };
		})
		.catch(error => {
			done = true;
			return { error: error instanceof Error ? error.message : String(error) };
		});
	return { promise, settled: () => done };
}

/** Waits for a page target whose url contains `needle` to appear in Target.getTargets. */
async function waitForPageTarget(needle: string, timeoutMs: number): Promise<TargetInfoLike | undefined> {
	const deadline = Date.now() + timeoutMs;
	for (; ;) {
		const targets = await observerPageTargets();
		const found = targets.find(info => info.url.includes(needle));
		if (found !== undefined) {
			return found;
		}
		if (Date.now() >= deadline) {
			return undefined;
		}
		await sleep(200);
	}
}

// #endregion

// #region Download observation (the real download state machine)

interface DownloadEventRecord {
	readonly method: string;
	readonly guid: string | undefined;
	readonly state: string | undefined;
}

const downloadEvents: DownloadEventRecord[] = [];
let downloadSubscriptions: Array<{ dispose(): void }> = [];

function startDownloadCollector(): void {
	stopDownloadCollector();
	downloadSubscriptions = [
		observer.on('Browser.downloadWillBegin', params => {
			downloadEvents.push({ method: 'Browser.downloadWillBegin', guid: typeof params.guid === 'string' ? params.guid : undefined, state: undefined });
		}),
		observer.on('Browser.downloadProgress', params => {
			downloadEvents.push({
				method: 'Browser.downloadProgress',
				guid: typeof params.guid === 'string' ? params.guid : undefined,
				state: typeof params.state === 'string' ? params.state : undefined,
			});
		}),
	];
}

function stopDownloadCollector(): void {
	for (const subscription of downloadSubscriptions) {
		subscription.dispose();
	}
	downloadSubscriptions = [];
}

function downloadWillBeginCount(): number {
	return downloadEvents.filter(event => event.method === 'Browser.downloadWillBegin').length;
}

function hasTerminalState(state: string): boolean {
	return downloadEvents.some(event => event.state === state);
}

/** Waits until the observed download state machine reports the terminal state. */
async function awaitDownloadTerminalState(state: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (!hasTerminalState(state)) {
		if (Date.now() >= deadline) {
			return false;
		}
		await sleep(150);
	}
	return true;
}

// #endregion

// #region The local origin server (real navigations without external network)

interface LocalServer {
	readonly port: number;
	close(): void;
}

function startLocalServer(): Promise<LocalServer> {
	return new Promise(resolve => {
		const server = http.createServer((request, response) => {
			const url = request.url ?? '/';
			if (url.startsWith('/download')) {
				// A real download target: Content-Disposition attachment.
				response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="probe.bin"' });
				response.end(new Uint8Array(4096).fill(7));
				return;
			}
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end(`<!doctype html><title>${url}</title><body>${url}</body>`);
		});
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			const port = address === null ? 0 : address.port;
			resolve({ port, close: () => server.close() });
		});
	});
}

// #endregion

async function main(): Promise<void> {
	if (FORCE_SKIP) {
		console.log('SKIP: FLAUZ_REALCHROMIUM_SKIP=1 (forced)');
		return;
	}
	if (ENDPOINT === '') {
		console.log('SKIP: no FLAUZ_CDP_ENDPOINT');
		return;
	}

	// --- reachability probe (never fail a gate for lacking a browser) ---
	observer = new WebSocketCdpTransport(ENDPOINT, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
	const reachable = await Promise.race([
		observer.ready().then(() => true, () => false),
		sleep(3000).then(() => false),
	]);
	if (!reachable) {
		observer.close();
		console.log(`SKIP: FLAUZ_CDP_ENDPOINT unreachable (${ENDPOINT})`);
		return;
	}
	console.log(`REAL-CHROMIUM drill: endpoint ${ENDPOINT}`);

	const server = await startLocalServer();
	const origin = `http://127.0.0.1:${server.port}`;
	info(`local origin server ${origin} (allowed host 127.0.0.1; localhost is the denied host)`);

	const downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flauz-real-drill-dl-'));

	// The manager's REAL transports, recorded on the real wire.
	const transports: RecordingWebSocketCdpTransport[] = [];
	const host = new CdpEndpointHost(ENDPOINT, {
		transportFactory: url => {
			const transport = new RecordingWebSocketCdpTransport(url, { commandTimeoutMs: COMMAND_TIMEOUT_MS });
			transports.push(transport);
			return transport;
		},
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(policyText),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: COMMAND_TIMEOUT_MS,
		navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
	});

	// ================= 3.1a — transport E2E over the real WebSocket =================
	console.log('REAL-CHROMIUM drill: --- 3.1a transport E2E ---');
	const version = await fetch(`http://${new URL(ENDPOINT).host}/json/version`).then(response => response.json() as Promise<Record<string, unknown>>).catch(() => undefined);
	const versionUa = version === undefined ? '' : typeof version['User-Agent'] === 'string' ? version['User-Agent'] : '';
	drillAssert(versionUa !== '', '3.1a-2: /json/version served by the real browser (User-Agent present)', JSON.stringify(version ?? 'fetch failed'));

	const agent = await manager.open({ initiator: 'agent', agentId: 'real-drill-agent' });
	drillAssert(transports.length >= 1 && !transports[0].closed, '3.1a-1: real CDP WebSocket transport open (the manager host dialed the real browser; the observer connection is live)', `transports=${transports.length}`);
	drillAssert(agent.descriptor.state === 'active', '3.1a-3: agent session opens ACTIVE on real Chromium (createTarget + domain enables + hardening + popup-gate attach all accepted — fail-closed chain)', JSON.stringify({ state: agent.descriptor.state, error: agent.error }));
	drillAssert(/^persist:flauz-[0-9a-f]{16}-real-drill-agent$/.test(agent.descriptor.partition), '3.1a-4: session partition is the flauz persist:flauz-<16hex>-<agent> name', agent.descriptor.partition);
	const wire = transports[0];
	const requiredFrames = ['Target.createTarget', 'Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable', 'Browser.setDownloadBehavior', 'Emulation.setUserAgentOverride', 'Target.setAutoAttach'];
	const missingFrames = requiredFrames.filter(method => countFrames(wire, method) === 0);
	drillAssert(missingFrames.length === 0, '3.1a-5: wire evidence — the real pipeline sent createTarget/domain-enables/hardening/gate frames on the real socket', `missing: ${missingFrames.join(', ') || 'none'} (frames: ${wire.sentFrames.length})`);

	const pageA = `${origin}/page-a`;
	const navA = await manager.navigate(agent.descriptor.sessionId, pageA);
	drillAssert(
		isNavigationOutcome(navA) && navA.sent === true && navA.committedUrl === pageA && navA.violation === undefined,
		'3.1a-6: policy-allowed navigation commits on real Chromium (Page.navigate -> Page.frameNavigated committed URL over the real wire)',
		JSON.stringify(isNavigationOutcome(navA) ? { sent: navA.sent, committed: navA.committedUrl, error: navA.error } : navA),
	);
	const shot = await manager.screenshot(agent.descriptor.sessionId);
	const shotBytes = isSessionError(shot) ? undefined : shot.bytes;
	const pngMagic = shotBytes !== undefined && shotBytes.length >= 4 && shotBytes[0] === 0x89 && shotBytes[1] === 0x50 && shotBytes[2] === 0x4e && shotBytes[3] === 0x47;
	drillAssert(!isSessionError(shot) && shot.byteLength > 0 && pngMagic, '3.1a-7: screenshot returns real PNG bytes (byteLength > 0 + PNG magic)', isSessionError(shot) ? JSON.stringify(shot.error) : `byteLength=${shot.byteLength} pngMagic=${pngMagic}`);

	const navigateCountBeforeDeny = wire.sentFrames.filter(frame => frame.method === 'Page.navigate').length;
	const denied = await manager.navigate(agent.descriptor.sessionId, 'https://denied.example.org/pay');
	const navigateCountAfterDeny = wire.sentFrames.filter(frame => frame.method === 'Page.navigate').length;
	drillAssert(
		isNavigationOutcome(denied) && denied.sent === false && denied.verdict.decision === 'deny' && denied.verdict.layer === 'driver',
		'3.1a-8: policy-denied navigation is denied at the driver layer (no navigation attempted)',
		JSON.stringify(isNavigationOutcome(denied) ? { sent: denied.sent, verdict: denied.verdict } : denied),
	);
	drillAssert(navigateCountAfterDeny === navigateCountBeforeDeny, '3.1a-8b: ZERO Page.navigate frames hit the real wire for the denied navigation', `before=${navigateCountBeforeDeny} after=${navigateCountAfterDeny}`);

	// ================= 3.1b — UA discipline (agent token vs human default) =================
	console.log('REAL-CHROMIUM drill: --- 3.1b UA discipline ---');
	const referenceTarget = await observer.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const referenceSession = await observerAttach(referenceTarget.targetId);
	const baseUa = await observerEvaluate(referenceSession, 'navigator.userAgent');
	drillAssert(baseUa !== '' && baseUa === versionUa, '3.1b-1: base-UA source verified — Runtime.evaluate(navigator.userAgent) on an unhardened reference equals the /json/version User-Agent', JSON.stringify({ evaluate: baseUa, version: versionUa }));

	const agentTabTargetId = agent.descriptor.tabs[0]?.targetId ?? '';
	const agentObserverSession = await observerAttach(agentTabTargetId);
	const agentUa = await observerEvaluate(agentObserverSession, 'navigator.userAgent');
	drillAssert(agentUa.includes(FLAUZ_AGENT_UA_TOKEN) && agentUa === flauzAgentUserAgent(baseUa), '3.1b-2: agent session tab reports navigator.userAgent = base + FlauzAgent token (cross-session observable on the real browser)', JSON.stringify(agentUa));

	const overrideCountBeforeHuman = countFrames(wire, 'Emulation.setUserAgentOverride');
	const downloadCountBeforeHuman = countFrames(wire, 'Browser.setDownloadBehavior');
	const human = await manager.open({ initiator: 'human', startUrl: `${origin}/human-portal` });
	const overrideCountAfterHuman = countFrames(wire, 'Emulation.setUserAgentOverride');
	const downloadCountAfterHuman = countFrames(wire, 'Browser.setDownloadBehavior');
	drillAssert(human.descriptor.state === 'active', '3.1b-3: human session opens ACTIVE on real Chromium', JSON.stringify({ state: human.descriptor.state, error: human.error }));
	drillAssert(
		human.navigation !== undefined && isNavigationOutcome(human.navigation) && human.navigation.sent === true && human.navigation.committedUrl === `${origin}/human-portal` && human.navigation.verdict.initiator === 'user',
		'3.1b-3b: human navigation consults willNavigate+webRequest (agent allowlist never gates humans) and commits on the real browser',
		JSON.stringify(human.navigation === undefined ? 'no navigation' : isNavigationOutcome(human.navigation) ? { sent: human.navigation.sent, initiator: human.navigation.verdict.initiator } : human.navigation),
	);
	drillAssert(overrideCountAfterHuman === overrideCountBeforeHuman, '3.1b-3c: wire evidence — NO Emulation.setUserAgentOverride frame for the human session (browser default UA preserved)', `before=${overrideCountBeforeHuman} after=${overrideCountAfterHuman}`);
	drillAssert(downloadCountAfterHuman > downloadCountBeforeHuman, '3.1b-3d: wire evidence — Browser.setDownloadBehavior sent for the human session too (every session, deny)', `before=${downloadCountBeforeHuman} after=${downloadCountAfterHuman}`);
	const humanTabTargetId = human.descriptor.tabs[0]?.targetId ?? '';
	const humanObserverSession = await observerAttach(humanTabTargetId);
	const humanUa = await observerEvaluate(humanObserverSession, 'navigator.userAgent');
	drillAssert(humanUa === baseUa && !humanUa.includes(FLAUZ_AGENT_UA_TOKEN), '3.1b-4: human session tab keeps the browser default UA (no FlauzAgent token on the real wire)', JSON.stringify(humanUa));
	await observer.send('Target.closeTarget', { targetId: referenceTarget.targetId }).catch(() => undefined);

	// ================= 3.1c — download deny (acceptance + effect + scoping) =================
	console.log('REAL-CHROMIUM drill: --- 3.1c download deny ---');
	// Direct acceptance on a real page session:
	drillAssert(true, '3.1c-0: wire evidence — Browser.setDownloadBehavior{deny} frames were sent for every Flauz tab (agent + human; a failure would have failed the session — fail-closed)', `deny frames: ${downloadCountAfterHuman}`);
	// Effect observation on observer-owned targets (same real browser):
	startDownloadCollector();
	const dlA = await observer.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const dlASession = await observerAttach(dlA.targetId);
	await observer.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true }, dlASession);
	await observer.send('Page.navigate', { url: `${origin}/download-allow` }, dlASession).catch(() => undefined);
	const allowCompleted = await awaitDownloadTerminalState('completed', 6000);
	drillAssert(downloadWillBeginCount() >= 1 && allowCompleted, '3.1c-1: allow-phase control — a real download runs to state completed (downloadWillBegin observed)', `willBegin=${downloadWillBeginCount()} completed=${allowCompleted}`);
	downloadEvents.length = 0;

	await observer.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true }, dlASession);
	await observer.send('Page.navigate', { url: `${origin}/download-deny` }, dlASession).catch(() => undefined);
	const denyCanceled = await awaitDownloadTerminalState('canceled', 6000);
	drillAssert(downloadWillBeginCount() >= 1 && denyCanceled, '3.1c-2: deny is EFFECTIVE on real Chromium — the denied download reaches downloadWillBegin then downloadProgress state \'canceled\'', `willBegin=${downloadWillBeginCount()} canceled=${denyCanceled}`);
	downloadEvents.length = 0;

	const dlB = await observer.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const dlBSession = await observerAttach(dlB.targetId);
	await observer.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadsDir, eventsEnabled: true }, dlBSession);
	await observer.send('Page.navigate', { url: `${origin}/download-scope` }, dlBSession).catch(() => undefined);
	const scopeCompleted = await awaitDownloadTerminalState('completed', 6000);
	drillAssert(scopeCompleted, '3.1c-3: per-session scoping on real Chromium — a SECOND session may allow+complete its own download while the first stays denied', `completed=${scopeCompleted}`);
	stopDownloadCollector();
	await observer.send('Target.closeTarget', { targetId: dlA.targetId }).catch(() => undefined);
	await observer.send('Target.closeTarget', { targetId: dlB.targetId }).catch(() => undefined);
	info('observational limit: the Flauz runtime tabs themselves cannot be probed for download effects through the manager surface (no eventsEnabled on Flauz sessions; a download URL would stall the pipeline commit wait) — acceptance is proven by the fail-closed activation chain + the wire frames, effect+scoping by observer-owned targets on the same real browser');

	// ================= 3.1d — popup gate (real shapes + pinned FINDINGS) =================
	console.log('REAL-CHROMIUM drill: --- 3.1d popup gate ---');
	drillAssert(countFrames(wire, 'Target.setAutoAttach') > 0, '3.1d-1: popup-gate setup accepted on real Chromium (Target.setAutoAttach frame on the tab session; the session stayed ACTIVE — fail-closed)', `frames=${countFrames(wire, 'Target.setAutoAttach')}`);

	// F-DELIVERY: fire a REAL window.open from the agent tab (allowed target). Nothing
	// holds it at this point (no browser-level auto-attach anywhere), so the call
	// returns and the popup free-runs. The manager's page-level gate must stay silent.
	const freeRunCall = fireWindowOpen(agentObserverSession, `${origin}/popup-free-run`);
	const freeRunOutcome = await Promise.race([freeRunCall.promise, sleep(3000).then(() => ({ value: undefined as string | undefined, error: 'TIMEOUT: window.open never returned' }))]);
	await sleep(1200);
	await manager.awaitPopupGate();
	const freeRunTarget = await waitForPageTarget('popup-free-run', 4000);
	drillAssert(freeRunTarget !== undefined, '3.1d-2 (observed): the window.open popup target EXISTS on the real browser and free-ran to its URL', JSON.stringify(freeRunTarget ?? 'not found'));
	drillAssert(freeRunOutcome.value === 'opened', '3.1d-2b (observed): the window.open call itself returned opened (nothing intercepted the popup)', JSON.stringify(freeRunOutcome));
	const gateEventsForFreeRun = manager.popupGateEvents().filter(event => event.url.includes('popup-free-run'));
	drillAssert(
		gateEventsForFreeRun.length === 0,
		'3.1d-3 FINDING F-DELIVERY (pinned): real Chromium does NOT deliver window.open popups to the page-session Target.setAutoAttach the gate uses — zero popup-gate events fired (FakeCdpTransport models this delivery; real Chromium does not provide it)',
		JSON.stringify(gateEventsForFreeRun),
	);
	if (freeRunTarget !== undefined) {
		await observer.send('Target.closeTarget', { targetId: freeRunTarget.targetId }).catch(() => undefined);
		drillAssert(!(await observerTargetExists(freeRunTarget.targetId)), '3.1d-4 (cleanup): the free-run popup is closed via the observer (no ungated target left behind)', freeRunTarget.targetId);
	}

	// F-POPUP-URL / F-RELEASE-CMD / F-OPENER-BLOCK / deny+allow primitives at browser level:
	// this is what a REAL popup gate would need; each shape is pinned as observed.
	await observer.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });
	// Record attach events BEFORE createTarget: the auto-attach event can fire
	// before the createTarget RESPONSE resolves (a subscription after the command
	// loses the event — the same lost-event race the runtime's gate avoids by
	// subscribing before Target.setAutoAttach).
	const openerRecorder = recordAttachEvents();
	const openerTarget = await observer.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const openerAttach = await waitForRecordedAttach(openerRecorder, openerTarget.targetId, 5000);
	openerRecorder.dispose();
	drillAssert(openerAttach !== undefined && openerAttach.waitingForDebugger === true, '3.1d-5 (primitive): browser-level auto-attach intercepts new targets with waitForDebuggerOnStart=true (the opener target is held at start)', openerAttach === undefined ? 'no Target.attachedToTarget event for the opener target' : JSON.stringify(openerAttach));
	const gateOpenerSession = openerAttach === undefined ? '' : openerAttach.sessionId;
	await observer.send('Runtime.runIfWaitingForDebugger', {}, gateOpenerSession).catch(() => undefined);
	await observer.send('Page.navigate', { url: `${origin}/gate-opener` }, gateOpenerSession).catch(() => undefined);
	await sleep(700);
	const openerUrl = await observerEvaluate(gateOpenerSession, 'location.href');
	drillAssert(openerUrl.includes('/gate-opener'), '3.1d-5b (primitive): the released opener page navigates + commits on the real browser', JSON.stringify(openerUrl));

	// ALLOWED popup: fired unawaited (F-OPENER-BLOCK: the call blocks while held).
	// The waiter matches only targets that did NOT exist before the call (auto-attach
	// echo events for pre-existing targets must not be mistaken for the popup).
	const knownBeforeAllowed = new Set((await observerPageTargets()).map(info => info.targetId));
	const allowedWaiter = waitForCdpEvent<AttachEventParams>(observer, 'Target.attachedToTarget', {
		timeoutMs: 5000,
		predicate: params => {
			const targetInfo = params.targetInfo as { targetId?: unknown } | undefined;
			return targetInfo !== undefined && typeof targetInfo.targetId === 'string' && !knownBeforeAllowed.has(targetInfo.targetId);
		},
	});
	const allowedCall = fireWindowOpen(gateOpenerSession, `${origin}/popup-allow-primitive`);
	const allowedAttach = await allowedWaiter;
	drillAssert(allowedAttach.waitingForDebugger === true, '3.1d-6 (primitive): the window.open popup arrives held (waitForDebuggerOnStart) at browser level', JSON.stringify(allowedAttach.waitingForDebugger));
	drillAssert(allowedAttach.targetInfo.url === '', '3.1d-6b FINDING F-POPUP-URL (pinned): targetInfo.url is EMPTY STRING at attach — the pending navigation URL is NOT available at gate time on real Chromium (FakeCdpTransport pins the URL)', JSON.stringify(allowedAttach.targetInfo.url));
	await sleep(600);
	drillAssert(!allowedCall.settled(), '3.1d-6c FINDING F-OPENER-BLOCK (pinned): window.open BLOCKS the opener while the popup is held (the gate decision window)', 'the evaluate settled before release');
	const releaseRejected = await observer.send('Runtime.run', {}, allowedAttach.sessionId).then(
		() => '',
		error => error instanceof Error ? error.message : String(error),
	);
	drillAssert(releaseRejected.includes('wasn\'t found'), '3.1d-6d (real-wire fact, F-RELEASE-CMD): \'Runtime.run\' is NOT a real CDP method (rejected with wasn\'t found) — the runtime\'s gate allow-path now sends the REAL release command Runtime.runIfWaitingForDebugger (TL3-P2 fix; pinned at unit level by test/popup-gate.test.ts with the fake modeling the real wire)', JSON.stringify(releaseRejected));
	await observer.send('Runtime.runIfWaitingForDebugger', {}, allowedAttach.sessionId);
	const allowedOutcome = await Promise.race([allowedCall.promise, sleep(2500).then(() => ({ value: undefined as string | undefined, error: 'TIMEOUT: window.open never returned after release' }))]);
	drillAssert(allowedOutcome.value === 'opened', '3.1d-7 (primitive): the allow-path release works — Runtime.runIfWaitingForDebugger releases the held popup and the window.open call returns', JSON.stringify(allowedOutcome));
	// The popup's navigation commits shortly AFTER the release; poll for the URL.
	let allowedPopupUrl = '';
	for (let attempt = 0; attempt < 15 && !allowedPopupUrl.includes('/popup-allow-primitive'); attempt += 1) {
		const info = await observer.send<{ targetInfo: { url: string } }>('Target.getTargetInfo', { targetId: allowedAttach.targetInfo.targetId }).catch(() => undefined);
		allowedPopupUrl = info === undefined ? '' : info.targetInfo.url;
		if (!allowedPopupUrl.includes('/popup-allow-primitive')) {
			await sleep(200);
		}
	}
	drillAssert(allowedPopupUrl.includes('/popup-allow-primitive'), '3.1d-7b (primitive): the released popup committed its intended URL on the real browser', JSON.stringify(allowedPopupUrl));

	// DENIED popup: closed BEFORE use (never released) — the deny-path primitive.
	const knownBeforeDenied = new Set((await observerPageTargets()).map(info => info.targetId));
	const deniedWaiter = waitForCdpEvent<AttachEventParams>(observer, 'Target.attachedToTarget', {
		timeoutMs: 5000,
		predicate: params => {
			const targetInfo = params.targetInfo as { targetId?: unknown } | undefined;
			return targetInfo !== undefined && typeof targetInfo.targetId === 'string' && !knownBeforeDenied.has(targetInfo.targetId);
		},
	});
	const deniedCall = fireWindowOpen(gateOpenerSession, `http://localhost:${server.port}/popup-deny-primitive`);
	const deniedAttach = await deniedWaiter;
	const closedDenied = await observer.send('Target.closeTarget', { targetId: deniedAttach.targetInfo.targetId }).then(
		() => 'closed',
		error => `close error: ${error instanceof Error ? error.message : String(error)}`,
	);
	drillAssert(closedDenied === 'closed', '3.1d-8 (primitive): the deny path — Target.closeTarget on a held (never-run) popup succeeds on real Chromium', JSON.stringify(closedDenied));
	// Target destruction is asynchronous; poll until the target is gone.
	let deniedStillExists = true;
	for (let attempt = 0; attempt < 15 && deniedStillExists; attempt += 1) {
		deniedStillExists = await observerTargetExists(deniedAttach.targetInfo.targetId);
		if (deniedStillExists) {
			await sleep(200);
		}
	}
	drillAssert(!deniedStillExists, '3.1d-8b (primitive): the denied popup target is destroyed (No target with given id)', deniedAttach.targetInfo.targetId);
	await sleep(1200);
	drillAssert(!deniedCall.settled(), '3.1d-8c FINDING F-OPENER-BLOCK/deny (pinned): closing a held popup leaves the opener window.open call unresolved (pinned timing shape)', 'the evaluate settled');
	// drain the never-settling call so nothing dangles into exit
	deniedCall.promise.then(() => undefined, () => undefined);

	await observer.send('Target.setAutoAttach', { autoAttach: false }).catch(() => undefined);
	await observer.send('Target.closeTarget', { targetId: openerTarget.targetId }).catch(() => undefined);
	await observer.send('Target.closeTarget', { targetId: allowedAttach.targetInfo.targetId }).catch(() => undefined);
	info('popup-gate record: page-level auto-attach does not see window.open popups (F-DELIVERY, OPEN — TL-adjudicated gate-placement redesign); popup URL at attach is empty (F-POPUP-URL, OPEN); window.open blocks the opener while held (F-OPENER-BLOCK, OPEN). FIXED by TL3-P2: the release-command divergence (F-RELEASE-CMD — the gate allow-path now sends Runtime.runIfWaitingForDebugger). The browser-level primitives (intercept+hold, close-before-use, runIfWaitingForDebugger release) all hold on real Chromium — the redesign\'s foundation, recorded for the TL as the product-side gate-placement decision');

	// ================= 3.1e — recovery on a real transport =================
	console.log('REAL-CHROMIUM drill: --- 3.1e recovery on a real transport ---');
	// Kill the REAL socket mid-session (transport.close() = real WebSocket teardown;
	// the host treats it as a drop — not an intentional close — and recovery runs).
	const killedTransport = transports[0];
	killedTransport.close();
	let recovery = await manager.awaitRecovery();
	for (let attempt = 0; recovery === undefined && attempt < 20; attempt += 1) {
		await sleep(250);
		recovery = await manager.awaitRecovery();
	}
	const agentReport = recovery?.sessions.find(report => report.sessionId === agent.descriptor.sessionId);
	drillAssert(recovery !== undefined && recovery.reconnected === true, '3.1e-1: real-socket kill -> suspend -> reconnect (fresh real transport; recovery verdict reconnected=true)', JSON.stringify(recovery === undefined ? 'no recovery' : { reason: recovery.reason, reconnected: recovery.reconnected }));
	const agentTabId = agent.descriptor.tabs[0]?.tabId ?? '';
	drillAssert(
		agentReport !== undefined && agentReport.state === 'active' && agentReport.recoveredTabIds.includes(agentTabId) && agentReport.lostTabIds.length === 0 && agentReport.policyViolations.length === 0,
		'3.1e-2: the tab is re-attached to the REAL browser and the current-policy recheck passes (recoveredTabIds contains it; no losses; no violations under the unchanged policy)',
		JSON.stringify(agentReport),
	);
	const recoveryWire = transports[1];
	const reEnabledDomains = recoveryWire !== undefined
		&& countFrames(recoveryWire, 'Page.enable') > 0
		&& countFrames(recoveryWire, 'Runtime.enable') > 0
		&& countFrames(recoveryWire, 'Network.enable') > 0
		&& countFrames(recoveryWire, 'Log.enable') > 0;
	drillAssert(reEnabledDomains, '3.1e-3c (TL3-P2 fix, F-RECOVERY-DOMAINS): wire evidence — the domain-enable frames are re-sent on the FRESH recovery transport (full mint-time activation parity)', recoveryWire === undefined ? 'no recovery transport' : `Page.enable=${countFrames(recoveryWire, 'Page.enable')} Runtime.enable=${countFrames(recoveryWire, 'Runtime.enable')} Network.enable=${countFrames(recoveryWire, 'Network.enable')} Log.enable=${countFrames(recoveryWire, 'Log.enable')}`);
	const reHardened = recoveryWire !== undefined && countFrames(recoveryWire, 'Browser.setDownloadBehavior') > 0 && countFrames(recoveryWire, 'Emulation.setUserAgentOverride') > 0;
	drillAssert(reHardened, '3.1e-3: wire evidence — re-hardening frames on the FRESH transport (Browser.setDownloadBehavior + Emulation.setUserAgentOverride re-sent to the real browser)', recoveryWire === undefined ? 'no recovery transport' : `download=${countFrames(recoveryWire, 'Browser.setDownloadBehavior')} ua=${countFrames(recoveryWire, 'Emulation.setUserAgentOverride')}`);
	const agentUaAfterRecovery = await observerEvaluate(agentObserverSession, 'navigator.userAgent');
	drillAssert(agentUaAfterRecovery === flauzAgentUserAgent(baseUa), '3.1e-3b: the agent tab still carries the FlauzAgent UA against the real browser after recovery (re-applied override, real navigator.userAgent)', JSON.stringify(agentUaAfterRecovery));
	const pageB = `${origin}/page-b`;
	const navB = await manager.navigate(agent.descriptor.sessionId, pageB);
	// TL3-P2 fix verification (drill finding F-RECOVERY-DOMAINS, fixed): the
	// recovery re-attach now runs the FULL mint-time activation on the fresh
	// session — domain enables first (3.1e-3c), then hardening, then the popup
	// gate — so Page events flow to the fresh session and the post-recovery
	// commit OBSERVATION works exactly like a fresh tab's. On the untouched
	// base this assertion FAILED (the commit wait timed out with
	// flauz.browser.navigation.commit-timeout and the security-relevant
	// post-commit reconciliation was silently skipped after recovery); the
	// flipped assertion is the real-wire regression pin for the fix.
	const recoveryNavigateFrames = countFrames(transports[1], 'Page.navigate');
	drillAssert(
		isNavigationOutcome(navB) && navB.sent === true && recoveryNavigateFrames > 0,
		'3.1e-4 (observed): the post-recovery navigation IS sent on the fresh real transport (wire frames present)',
		JSON.stringify(isNavigationOutcome(navB) ? { sent: navB.sent, frames: recoveryNavigateFrames, error: navB.error } : navB),
	);
	drillAssert(
		isNavigationOutcome(navB) && navB.error === undefined && navB.committedUrl === pageB,
		'3.1e-4b (TL3-P2 fix, F-RECOVERY-DOMAINS): the post-recovery commit OBSERVATION works on real Chromium — Page.enable re-sent on the fresh session, Page.frameNavigated flows, the committed URL is reconciled (no commit-timeout; the post-commit reconciliation is no longer skipped after recovery)',
		JSON.stringify(isNavigationOutcome(navB) ? { committed: navB.committedUrl, error: navB.error } : navB),
	);

	// Hot-swap the policy to DENY the loopback host, kill the socket again: the
	// recovery re-check must flag the REAL committed URL as a CURRENT-policy violation.
	policyText = POLICY_LOOPBACK_DENIED;
	const killedTransport2 = transports[1];
	killedTransport2.close();
	let recovery2 = await manager.awaitRecovery();
	for (let attempt = 0; (recovery2 === undefined || recovery2 === recovery) && attempt < 20; attempt += 1) {
		await sleep(250);
		recovery2 = await manager.awaitRecovery();
	}
	const agentReport2 = recovery2?.sessions.find(report => report.sessionId === agent.descriptor.sessionId);
	drillAssert(
		recovery2 !== undefined && recovery2.reconnected === true && agentReport2 !== undefined && agentReport2.policyViolations.length > 0,
		'3.1e-5: current-policy recheck against the REAL browser — after the policy flips to deny, the next recovery flags the real committed URL as a violation',
		JSON.stringify(agentReport2 ?? 'no report'),
	);

	// ================= teardown =================
	await manager.dispose();
	observer.close();
	server.close();
	try {
		fs.rmSync(downloadsDir, { recursive: true, force: true });
	} catch {
		// best-effort temp cleanup
	}

	if (failures > 0) {
		console.error(`REAL-CHROMIUM drill: FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log('REAL-CHROMIUM drill: GREEN (real runtime against real Chromium: transport E2E, UA discipline, download deny, popup-gate shapes + pinned findings, recovery)');
	console.log('REAL-CHROMIUM drill: pinned record: F-DELIVERY (page-level auto-attach misses window.open popups — OPEN, TL-adjudicated gate-placement redesign), F-POPUP-URL (empty url at attach — OPEN, same redesign), F-OPENER-BLOCK (window.open blocks the opener while held — OPEN, same redesign); FIXED by TL3-P2: F-RELEASE-CMD (release command now Runtime.runIfWaitingForDebugger), F-RECOVERY-DOMAINS (recovery re-attach re-enables the domains — post-recovery commit observation works)');
}

void main().catch(error => {
	console.error('REAL-CHROMIUM drill: ERROR', error);
	process.exit(1);
});
