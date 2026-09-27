/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tab lifecycle + the policy-gated navigation pipeline (TL3-001, posture P0:
 * the driver-side verdict is AUTHORITATIVE for agent navigations; hardened
 * by TL3-002: per-session UA/download discipline on activation, G6 forced-reset
 * EXECUTION on post-commit violations).
 *
 * THE NAVIGATION PIPELINE (the security heart of the runtime):
 *
 *   1. Compute the verdict via `engine.evaluate({ url, initiator, partition,
 *      workspaceRoot })` — with the SESSION's initiator class, so agent
 *      navigations consult driver+webRequest and human navigations consult
 *      willNavigate+webRequest (the agent allowlist NEVER gates humans).
 *   2. If DENY: NO CDP command is sent AT ALL. The verdict + evidence row
 *      come back (asserted in tests by inspecting FakeCdpTransport's
 *      sent-command log: `Page.navigate` was NEVER sent).
 *   3. If ALLOW: send `Page.navigate`, await the committed URL
 *      (Page.frameNavigated), then run `reconcileCommittedUrl` on it. On
 *      violation: the F2 recommendation is returned AND — since TL3-002 —
 *      EXECUTED on this runtime-owned tab when `security.enforceReset` is
 *      true (the default, fail-closed): the narrow typed `runForcedReset`
 *      navigates the tab to `about:blank` THROUGH this same pipeline (never
 *      around it) and the outcome records it (`violation.resetExecuted`).
 *      An explicit `security.enforceReset=false` opt-out is recorded in the
 *      reconciliation verdict; the execution is skipped.
 *
 * A wedged tab (command timeout on a LIVE transport) is replaced by the
 * manager (`deps.replaceTab`): the old tab is marked failed, a fresh
 * about:blank tab is minted, and the event is recorded on the tab records.
 */

import {
	commandTimeout,
	isCdpTimeoutError,
	isCdpTransportClosedError,
	settleWithTimeout,
	type CdpTransport,
	waitForCdpEvent,
} from '../cdp/transport.ts';
import {
	type BrowserPolicyEngine,
	type EvidenceRowInput,
	type PolicyVerdict,
	RESET_URL,
	toEvidenceRow,
	type Clock,
} from '../policy.ts';
import {
	type BrowserSessionDescriptor,
	type BrowserTabRecord,
	isoAt,
	mintTabId,
	toEngineInitiator,
} from './session.ts';
import { screenshotEvidenceRow, TabCaptureRecorder, decodeScreenshotBase64, type ScreenshotOutcome } from './capture.ts';
import { applySessionHardening } from './hardening.ts';

/** A live tab: the mutable record plus its session-scoped transport + capture recorder. */
export interface LiveTab {
	record: BrowserTabRecord;
	transport: CdpTransport;
	recorder: TabCaptureRecorder;
}

/** Everything the tab pipeline needs from the manager (dependency inversion). */
export interface TabPipelineDeps {
	/** The CURRENT engine (evaluated per navigation — recovery re-gates against it). */
	engine(): BrowserPolicyEngine;
	readonly workspaceRoot: string | undefined;
	readonly clock: Clock;
	/** Wedged-tab detection timeout (command timeout on a live transport). */
	readonly commandTimeoutMs: number;
	/** Commit/load event wait timeout. */
	readonly navigationTimeoutMs: number;
	readonly bufferLimit: number;
	/** Manager hook: replace a wedged tab, return the fresh live tab. */
	replaceTab(sessionId: string, tab: LiveTab, reason: string): Promise<LiveTab>;
	/** The task id for evidence rows/artifacts (session-scoped). */
	taskIdOf(sessionId: string): string | undefined;
}

/** The outcome of one navigation attempt (the command return + test surface). */
export interface NavigationOutcome {
	readonly sessionId: string;
	readonly tabId: string;
	/** False => the policy denied it and ZERO CDP commands were sent. */
	readonly sent: boolean;
	/** The authoritative gate verdict for the REQUESTED url. */
	readonly verdict: PolicyVerdict;
	readonly evidenceRow: EvidenceRowInput;
	readonly requestedUrl: string;
	/** The committed url (allow path only). */
	readonly committedUrl?: string;
	/** Post-commit violation: the reconciliation verdict + the about:blank reset target (F2). */
	readonly violation?: {
		readonly verdict: PolicyVerdict;
		readonly resetTo: typeof RESET_URL;
		/** Present when security.enforceReset executed the reset on this runtime-owned tab (G6 EXECUTION, TL3-002). */
		readonly resetExecuted?: ForcedResetOutcome;
	};
	/** Operational failure (transport loss, wedged tab, navigation error). */
	readonly error?: { readonly code: string; readonly message: string; readonly replacedByTabId?: string };
}

/**
 * The narrow typed forced-reset outcome (G6 EXECUTION, TL3-002): a reset can
 * ONLY navigate to `about:blank` — the operation takes no URL, and both its
 * `resetTo` and `requestedUrl` are the literal reset target. The navigation
 * itself goes through the full policy pipeline (`runNavigation`), never
 * around it.
 */
export interface ForcedResetOutcome extends NavigationOutcome {
	/** The ONLY destination a forced reset may navigate to (typed literal). */
	readonly resetTo: typeof RESET_URL;
	/** Overridden to the literal reset target (a forced reset has no free-form destination). */
	readonly requestedUrl: typeof RESET_URL;
}

const DOMAIN_ENABLE_COMMANDS = ['Page.enable', 'Runtime.enable', 'Network.enable', 'Log.enable'] as const;

/** The Page.frameNavigated params slice the pipeline consumes. */
interface FrameNavigatedParams {
	frame?: { id?: string; url?: string; loaderId?: string };
}

/**
 * Creates a live tab around a freshly minted host target: enables the
 * Page/Runtime/Network/Log domains, applies the TL3-002 per-session
 * hardening (download deny for every session; the Flauz agent UA override
 * for agent sessions — both fail-closed: a tab whose domains or hardening
 * cannot be applied never becomes active), and attaches the capture
 * recorder.
 */
export async function activateLiveTab(deps: TabPipelineDeps, session: BrowserSessionDescriptor, transport: CdpTransport, targetId: string, startUrl: string): Promise<LiveTab> {
	for (const command of DOMAIN_ENABLE_COMMANDS) {
		await transport.send(command);
	}
	await applySessionHardening(transport, session);
	const record: BrowserTabRecord = {
		tabId: mintTabId(),
		targetId,
		url: startUrl,
		state: 'active',
		openedAt: isoAt(deps.clock),
	};
	const recorder = new TabCaptureRecorder({ limit: deps.bufferLimit, clock: deps.clock });
	recorder.attach(transport);
	return { record, transport, recorder };
}

/**
 * The policy-gated navigation pipeline (see the module doc). `session.initiator`
 * selects the consulted layers; `session.partition` carries the containment
 * context; the engine is consulted at call time (CURRENT policy).
 */
export async function runNavigation(deps: TabPipelineDeps, session: BrowserSessionDescriptor, tab: LiveTab, url: string): Promise<NavigationOutcome> {
	const engine = deps.engine();
	const initiator = toEngineInitiator(session.initiator);
	const taskId = deps.taskIdOf(session.sessionId);

	// 1. The authoritative gate verdict (fail-closed: deny wins, missing policy denies).
	const evaluation = engine.evaluate({
		url,
		initiator,
		partition: session.partition,
		workspaceRoot: deps.workspaceRoot,
		ts: deps.clock(),
	});
	const verdict = evaluation.final;
	if (verdict.decision === 'deny') {
		// 2. DENY: no CDP command is sent AT ALL.
		return {
			sessionId: session.sessionId,
			tabId: tab.record.tabId,
			sent: false,
			verdict,
			evidenceRow: toEvidenceRow(verdict, taskId),
			requestedUrl: url,
		};
	}

	// 3. ALLOW: register the lifecycle waiters BEFORE the command, then navigate.
	const committedWaiter: Promise<FrameNavigatedParams | Error> = waitForCdpEvent<FrameNavigatedParams>(tab.transport, 'Page.frameNavigated', {
		timeoutMs: deps.navigationTimeoutMs,
	}).then(
		value => value,
		error => error instanceof Error ? error : new Error(String(error)),
	);
	const loadWaiter: Promise<unknown> = waitForCdpEvent(tab.transport, 'Page.loadEventFired', {
		timeoutMs: deps.navigationTimeoutMs,
	}).then(
		() => undefined,
		() => undefined,
	);

	try {
		await commandTimeout(tab.transport.send('Page.navigate', { url }), deps.commandTimeoutMs, `Page.navigate ${url}`);
	} catch (error) {
		return navigationFailure(deps, session, tab, url, verdict, taskId, error);
	}

	// The committed URL is the security-relevant fact (B1c: canceling content
	// does not roll the URL back — reconcile it whatever load did).
	const committed = await committedWaiter;
	await settleWithTimeout(loadWaiter, deps.commandTimeoutMs, undefined);

	if (committed instanceof Error) {
		return {
			sessionId: session.sessionId,
			tabId: tab.record.tabId,
			sent: true,
			verdict,
			evidenceRow: toEvidenceRow(verdict, taskId),
			requestedUrl: url,
			error: { code: 'flauz.browser.navigation.commit-timeout', message: committed.message },
		};
	}
	const committedUrl = typeof committed.frame?.url === 'string' ? committed.frame.url : url;
	tab.record.url = committedUrl;

	// Post-commit reconciliation (SECURITY-MODEL section 4 F2).
	const reconciliation = engine.reconcileCommittedUrl(committedUrl, {
		partition: session.partition,
		workspaceRoot: deps.workspaceRoot,
		ts: deps.clock(),
	});
	if (reconciliation.violation) {
		// G6 EXECUTION (TL3-002): enforce the recommended reset on this
		// runtime-owned tab THROUGH the policy engine (about:blank is
		// structurally allowed by every layer; the reset re-runs this
		// same pipeline). An explicit security.enforceReset=false
		// opt-out is recorded in the reconciliation verdict.
		let resetExecuted: ForcedResetOutcome | undefined;
		if (reconciliation.enforceReset) {
			resetExecuted = await runForcedReset(deps, session, tab);
		}
		return {
			sessionId: session.sessionId,
			tabId: tab.record.tabId,
			sent: true,
			verdict,
			evidenceRow: toEvidenceRow(reconciliation.verdict, taskId),
			requestedUrl: url,
			committedUrl,
			violation: { verdict: reconciliation.verdict, resetTo: RESET_URL, ...(resetExecuted === undefined ? {} : { resetExecuted }) },
		};
	}
	return {
		sessionId: session.sessionId,
		tabId: tab.record.tabId,
		sent: true,
		verdict,
		evidenceRow: toEvidenceRow(verdict, taskId),
		requestedUrl: url,
		committedUrl,
	};
}

/** Operational failure taxonomy: transport loss vs wedged tab vs CDP error. */
async function navigationFailure(
	deps: TabPipelineDeps,
	session: BrowserSessionDescriptor,
	tab: LiveTab,
	url: string,
	verdict: PolicyVerdict,
	taskId: string | undefined,
	error: unknown,
): Promise<NavigationOutcome> {
	const base = {
		sessionId: session.sessionId,
		tabId: tab.record.tabId,
		sent: true,
		verdict,
		evidenceRow: toEvidenceRow(verdict, taskId),
		requestedUrl: url,
	};
	if (isCdpTransportClosedError(error)) {
		return { ...base, error: { code: 'flauz.browser.transport-closed', message: error.message } };
	}
	if (isCdpTimeoutError(error) && !tab.transport.closed) {
		// WEDGED TAB: command timeout on a live transport -> replace the tab.
		const replacement = await deps.replaceTab(session.sessionId, tab, 'flauz.tab.wedged');
		return {
			...base,
			error: {
				code: 'flauz.browser.tab.wedged',
				message: `navigation to ${url} timed out; the wedged tab was replaced`,
				replacedByTabId: replacement.record.tabId,
			},
		};
	}
	return { ...base, error: { code: 'flauz.browser.navigation.error', message: error instanceof Error ? error.message : String(error) } };
}

/**
 * Executes the forced reset (G6 EXECUTION, SECURITY-MODEL F2): navigates the
 * tab to `about:blank`. This is the narrow typed reset operation — it takes
 * NO url (structurally unable to navigate anywhere except the reset target)
 * and is gated like every navigation THROUGH `runNavigation` (about:blank is
 * the reconciliation reset target — structurally allowed by every layer).
 */
export async function runForcedReset(deps: TabPipelineDeps, session: BrowserSessionDescriptor, tab: LiveTab): Promise<ForcedResetOutcome> {
	const outcome = await runNavigation(deps, session, tab, RESET_URL);
	return { ...outcome, resetTo: RESET_URL, requestedUrl: RESET_URL };
}

/**
 * Screenshot: `Page.captureScreenshot` + the evidence row for the tab's
 * (committed) URL under the CURRENT policy + optional artifact write.
 * Wedged tabs are replaced (same taxonomy as navigation).
 */
export async function runScreenshot(
	deps: TabPipelineDeps,
	session: BrowserSessionDescriptor,
	tab: LiveTab,
	writeArtifact: ((name: string, bytes: Uint8Array) => Promise<string>) | undefined,
): Promise<ScreenshotOutcome | { error: { code: string; message: string; replacedByTabId?: string } }> {
	const engine = deps.engine();
	const taskId = deps.taskIdOf(session.sessionId);
	let response: { data?: string };
	try {
		response = await commandTimeout(tab.transport.send<{ data?: string }>('Page.captureScreenshot', { format: 'png' }), deps.commandTimeoutMs, 'Page.captureScreenshot');
	} catch (error) {
		if (isCdpTimeoutError(error) && !tab.transport.closed) {
			const replacement = await deps.replaceTab(session.sessionId, tab, 'flauz.tab.wedged');
			return {
				error: {
					code: 'flauz.browser.tab.wedged',
					message: 'screenshot timed out; the wedged tab was replaced',
					replacedByTabId: replacement.record.tabId,
				},
			};
		}
		return { error: { code: 'flauz.browser.screenshot.error', message: error instanceof Error ? error.message : String(error) } };
	}
	const base64 = typeof response.data === 'string' ? response.data : '';
	const bytes = decodeScreenshotBase64(base64);
	// The evidence row: the CURRENT-policy verdict for the committed URL,
	// carrying the untrusted-content boundary marker (TL3-002 3.7: the
	// committed URL in the note is page-derived state — a BOUNDARY MARKER,
	// not content sanitization).
	const verdict = engine.evaluate({
		url: tab.record.url || RESET_URL,
		initiator: toEngineInitiator(session.initiator),
		partition: session.partition,
		workspaceRoot: deps.workspaceRoot,
		ts: deps.clock(),
	}).final;
	let artifactPath: string | undefined;
	if (writeArtifact !== undefined) {
		const stamp = deps.clock();
		artifactPath = await writeArtifact(`screenshot-${stamp}.png`, bytes);
	}
	return { bytes, byteLength: bytes.byteLength, evidenceRow: screenshotEvidenceRow(verdict, taskId), artifactPath, base64 };
}
