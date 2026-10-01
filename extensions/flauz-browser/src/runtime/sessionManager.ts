/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * BrowserSessionManager (TL3-001): owns the BrowserSessionDescriptor
 * lifecycle — open/list/focus/close — and drives the tab pipeline.
 * Hardened by TL3-002 (browser session security):
 *
 *   - Per-session hardening on every tab activation (src/runtime/hardening.ts):
 *     downloads denied for EVERY session; agent sessions carry the FlauzAgent
 *     user-agent token. Fail-closed.
 *   - Popup / new-target gate (item 3.3; P2-FIX-106 / DL-79 browser-level
 *     placement): the gate sits on BROWSER-level auto-attach
 *     (Target.setAutoAttach, flatten, waitForDebuggerOnStart, at the
 *     browser scope — the only placement real Chromium delivers
 *     window.open targets to; drill finding F-DELIVERY). A held target is
 *     attributed by targetInfo.openerId; a session opener's popup has its
 *     pending destination observed PRE-USE through the Fetch domain (the
 *     FIRST Fetch.requestPaused carries the URL — targetInfo.url is EMPTY
 *     at attach on real Chromium, an accepted fact, not worked around;
 *     drill finding F-POPUP-URL) and policy-checked with the OPENER
 *     session's initiator class: denied => Fetch.failRequest (abort BEFORE
 *     the wire — zero committed loads, zero bytes to the denied host) +
 *     Target.closeTarget (destroyed before use) + an evidence row;
 *     allowed => Fetch.disable + the target attaches as a tab of the SAME
 *     session. No-URL popups (window.open() with no destination) and
 *     non-session openers are released immediately on opener attribution
 *     (no indefinite hold is lawful — drill finding F-OPENER-BLOCK). The
 *     per-tab page-session auto-attach stays for tab-scoped session work
 *     (the DL-79 scope guard). This closes the window.open/target=_blank
 *     bypass of the navigation gate.
 *   - Credential isolation (item 3.5): tabs belong to exactly one
 *     session/partition — cross-partition tab use is a TYPED error
 *     (`flauz.browser.tab.cross-partition`), same-partition foreign-session
 *     use is a typed error too, and recovery re-attach only re-attaches
 *     targets the ownership registry attributes to THIS session+partition.
 *     (Electron-side partition MINTING remains product-side gap G5.)
 *   - Session journal (item 3.6, CROSS-WORKER CONTRACT PIN-1): every
 *     open/state transition/close/failure — and, since P2-FIX-105, every
 *     navigation attempt (allow OR deny, via the manager's navigation
 *     surfaces: open startUrl / navigate / forced reset) — appends a canonical
 *     record to `.flauz/browser-sessions.jsonl` (src/runtime/journal.ts). The
 *     actor is MANDATORY: an unknown initiator fails the journal write loudly,
 *     and a journal failure at OPEN fails the session (fail-closed — a session
 *     that cannot be journaled never opens half-way). A navigation row is
 *     written from the DECISION-path outcome (a deny row records that ZERO
 *     wire commands were sent); a navigation-path journal write failure is
 *     captured in journalErrors (never silent), mirroring the close path.
 *
 * INVARIANTS (fail-closed, pinned by tests):
 *   - Missing policy -> the engine's builtin deny-all denies; a DENIED
 *     navigation sends ZERO CDP commands (the FakeCdpTransport sent-command
 *     log is the assertion surface).
 *   - Broken transport -> the session is `failed`, never an open; a denied
 *     startUrl fails the session BEFORE any host interaction.
 *   - Recovery NEVER bypasses policy: after a transport drop the manager
 *     reconnects (fresh transport), re-arms the BROWSER-level popup gate on
 *     the fresh connection (P2-FIX-106: a reconnection that cannot re-arm
 *     the gate never resumes sessions half-governed), reconciles the tab
 *     list vs the descriptors (restoring what exists, marking lost tabs),
 *     re-applies the per-session hardening + the per-tab auto-attach to
 *     every re-attached tab, re-checks the reconciled state against the
 *     CURRENT policy, and every further navigation is gated against the
 *     current engine again.
 *
 * HUMAN vs AGENT SEPARATION (README "Semantics" item 3, pinned BOTH
 * directions in session-manager.test.ts): the session's `initiator` selects
 * the engine's initiator class — 'agent' -> 'agent-tool' (driver +
 * webRequest; the driver allowlist is AUTHORITATIVE), 'human' -> 'user'
 * (willNavigate + webRequest; the agent allowlist NEVER gates humans).
 */

import {
	type BrowserPolicyEngine,
	type Clock,
	type EvidenceRowInput,
	type PolicyVerdict,
	RESET_URL,
	toEvidenceRow,
	verdictSummary,
} from '../policy.ts';
import { type CdpParams, type CdpSubscription, type CdpTransport, scopeToSession } from '../cdp/transport.ts';
import type { BrowserHost, HostTabHandle } from './host.ts';
import {
	type BrowserSessionDescriptor,
	type BrowserSessionErrorRecord,
	type BrowserSessionState,
	type BrowserTabRecord,
	isoAt,
	mintSessionId,
	policySourceRefOf,
	snapshotDescriptor,
	toEngineInitiator,
	type SessionInitiator,
} from './session.ts';
import {
	activateLiveTab,
	enableTabDomains,
	type ForcedResetOutcome,
	type LiveTab,
	runNavigation,
	runForcedReset,
	runScreenshot,
	type NavigationOutcome,
	type TabPipelineDeps,
} from './tabs.ts';
import { applySessionHardening, BrowserHardeningError } from './hardening.ts';
import {
	type ArtifactWriterPort,
	type ConsoleCaptureEntry,
	type NetworkCaptureEntry,
	type ScreenshotOutcome,
	untrustedContentNote,
} from './capture.ts';
import {
	type SessionJournalEvent,
	type SessionJournalNavigation,
	type SessionJournalPort,
	buildSessionJournalRecord,
	journalActorOf,
} from './journal.ts';
import { redactSecretShapedQueryValues } from './urlRedaction.ts';

// #region Public result shapes

export interface OpenSessionInput {
	readonly initiator: SessionInitiator;
	readonly agentId?: string;
	readonly startUrl?: string;
}

export interface OpenSessionResult {
	readonly descriptor: BrowserSessionDescriptor;
	/** The gate verdict when the startUrl was denied (fail-closed: session failed). */
	readonly verdict?: PolicyVerdict;
	readonly evidenceRow?: EvidenceRowInput;
	/** The initial navigation outcome when a startUrl was allowed. */
	readonly navigation?: NavigationOutcome;
	readonly error?: { readonly code: string; readonly message: string };
}

/** Session-level operational error (unknown/closed session, no active tab, ...). */
export interface SessionOperationError {
	readonly error: { readonly code: string; readonly message: string };
}

/** Type guard for the error arm of manager results (upstream local/code-no-in-operator: `in` only inside predicates). */
export function isSessionError<TResult extends object>(result: TResult | SessionOperationError): result is SessionOperationError {
	return 'error' in result;
}

export function isNavigationOutcome(result: NavigationOutcome | SessionOperationError): result is NavigationOutcome {
	return typeof (result as NavigationOutcome).sent === 'boolean';
}

export interface RecoverySessionReport {
	readonly sessionId: string;
	readonly state: BrowserSessionState;
	readonly recoveredTabIds: readonly string[];
	readonly lostTabIds: readonly string[];
	/** CURRENT-policy re-check of recovered tabs (agent separation: the reconciled state never silently reopens). */
	readonly policyViolations: readonly EvidenceRowInput[];
}

export interface RecoveryVerdict {
	readonly reason: string;
	readonly at: number;
	readonly reconnected: boolean;
	readonly sessions: readonly RecoverySessionReport[];
}

/** Mutable accumulator for one session's recovery report (freezes into RecoveryVerdict). */
interface RecoverySessionReportDraft {
	sessionId: string;
	state: BrowserSessionState;
	recoveredTabIds: string[];
	lostTabIds: string[];
	policyViolations: EvidenceRowInput[];
}

// #region Popup / new-target gate (TL3-002 item 3.3; P2-FIX-106 DL-79 browser-level placement)

/**
 * One popup-gate decision (P2-FIX-106 / DL-79): the policy verdict for a
 * target created by a session tab (window.open / target=_blank), with the
 * pending destination OBSERVED PRE-USE at FIRST-REQUEST time (the first
 * `Fetch.requestPaused` on the released hold — `targetInfo.url` is EMPTY at
 * attach on real Chromium, a pinned fact the gate accepts rather than works
 * around) and evaluated with the OPENER session's initiator class. The
 * evidence row carries the untrusted-content boundary marker (the observed
 * URL is page-derived).
 */
export interface PopupGateEvent {
	readonly sessionId: string;
	/** The tab whose page created the target (the openerId's owner). */
	readonly sourceTabId: string;
	readonly targetId: string;
	/**
	 * The observed destination (== {@link observedUrl}; the legacy field
	 * now carries the OBSERVED URL per DL-79 — empty-at-attach is
	 * documented on {@link observedUrl}). Page-derived; treat as untrusted.
	 * P2-FIX-107 / DL-80 (the two-layer redaction law's AT-RECORD layer): the
	 * url persisted on the RECORD (the popup-gate audit log + subscribers) is
	 * the at-record redacted form -- URL structure and param NAMES preserved,
	 * secret-shaped query-param VALUES redacted (the flauz-resources
	 * SECRET_SHAPED_PATTERNS class, imported). The gate's RUNTIME decisions
	 * (deny/close, allow/release) ran on the REAL URL -- only the RECORD is
	 * redacted; the verdict and its evidence row keep their structure verbatim
	 * (DL-80 scope guard: secret-shaped fragments inside verdict notes are the
	 * resources-lane detector's beat where they surface).
	 */
	readonly url: string;
	/**
	 * P2-FIX-106 (additive, DL-79): the URL observed at FIRST-request time
	 * (the first `Fetch.requestPaused` on the held target) — the gate's
	 * URL input. EMPTY at attach on real Chromium (drill finding
	 * F-POPUP-URL): the pending destination is simply not available at
	 * gate-arm time.
	 */
	readonly observedUrl: string;
	/** P2-FIX-106 (additive, DL-79): the opener target id (provenance attribution at attach). */
	readonly openerId: string;
	readonly decision: 'allow' | 'deny';
	readonly verdict: PolicyVerdict;
	readonly evidenceRow: EvidenceRowInput;
	/** When the gate closed the target (deny path, or an allow whose attach failed). */
	readonly closed?: boolean;
	readonly closeError?: string;
	/** allow path: the attach failure when the target could not become a tab (closed for safety instead). */
	readonly attachError?: string;
	/** allow path: the logical tab id of the attached popup tab. */
	readonly attachedTabId?: string;
	/** FIRST-REQUEST time (P2-FIX-106: evidence timing moved from attach-time to first-request-time). */
	readonly at: string;
}

// #endregion

// #endregion

export interface BrowserSessionManagerOptions {
	/** The engine to consult; a provider keeps hot-reloaded policy CURRENT (recovery re-gates). */
	readonly engine: BrowserPolicyEngine | (() => BrowserPolicyEngine);
	readonly host: BrowserHost;
	/** Partitions need a workspace root; without it open() fails closed. */
	readonly workspaceRoot?: string;
	/** Evidence-row task id (the Agent Bridge's task); default: identity uris, no file claim. */
	readonly taskId?: string | ((sessionId: string) => string | undefined);
	/** Artifact writer (production: FileSystemArtifactWriter at the workspace root). */
	readonly artifacts?: ArtifactWriterPort;
	/**
	 * Session journal (TL3-002 item 3.6): every open/state transition/close/failure
	 * appends a record. Production: FileSystemSessionJournal at the workspace root.
	 */
	readonly journal?: SessionJournalPort;
	readonly clock?: Clock;
	/** Wedged-tab detection timeout (default 5s). */
	readonly commandTimeoutMs?: number;
	/** Navigation commit/load wait (default 15s). */
	readonly navigationTimeoutMs?: number;
	/** Capture ring buffer size (default 500). */
	readonly bufferLimit?: number;
	/**
	 * P2-FIX-106 (DL-79 decisiveness): the bounded no-request observation
	 * window. The held popup is released immediately on opener
	 * attribution (arming Fetch first); a popup WITH a destination sees
	 * its first request pause within milliseconds, while a no-destination
	 * popup (`window.open()`) fires no request ever — the window expiring
	 * disarms interception (no indefinite hold is lawful). Default 1500ms.
	 */
	readonly noUrlPopupWindowMs?: number;
}

interface SessionEntry {
	descriptor: BrowserSessionDescriptor;
	live: Map<string, LiveTab>;
}

/** Ownership registry entry: a CDP target belongs to exactly one session/partition. */
interface TargetOwnership {
	readonly sessionId: string;
	readonly partition: string;
	readonly tabId: string;
}

/** The held popup's identity at the browser-level gate (P2-FIX-106 / DL-79). */
interface HeldPopup {
	readonly targetId: string;
	readonly heldSessionId: string;
	readonly openerId: string;
}

/** The first `Fetch.requestPaused` on a held popup: the gate's URL input (P2-FIX-106 / DL-79). */
interface PausedRequest {
	readonly requestId: string;
	readonly url: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_BUFFER_LIMIT = 500;
const DEFAULT_NO_URL_POPUP_WINDOW_MS = 1_500;

/**
 * The manager. Construct once per host; `dispose()` closes every session and
 * the host. The host's drop signal triggers recovery automatically.
 */
export class BrowserSessionManager {
	private readonly engineProvider: () => BrowserPolicyEngine;
	private readonly host: BrowserHost;
	private readonly workspaceRoot: string | undefined;
	private readonly taskIdProvider: (sessionId: string) => string | undefined;
	private readonly artifacts: ArtifactWriterPort | undefined;
	private readonly journal: SessionJournalPort | undefined;
	private readonly clock: Clock;
	private readonly entries = new Map<string, SessionEntry>();
	private readonly recoveryHandlers: Array<(verdict: RecoveryVerdict) => void> = [];
	private readonly deps: TabPipelineDeps;
	/** The BROWSER-level popup gate (P2-FIX-106): subscription + transport per live connection. */
	private browserGate: { transport: CdpTransport; subscription: CdpSubscription } | undefined;
	/** The bounded no-request observation window (DL-79 decisiveness). */
	private readonly noUrlPopupWindowMs: number;
	/** Popup-gate audit log (forensic surface; surfaced via popupGateEvents()). */
	private readonly popupGateLog: PopupGateEvent[] = [];
	private readonly popupGateHandlers: Array<(event: PopupGateEvent) => void> = [];
	/** Popup-gate work chain (serialized; awaitPopupGate() is the test/drill surface). */
	private gateChain: Promise<void> = Promise.resolve();
	/** TL3-002 item 3.5: targetId -> owning session/partition/tab (exactly one owner). */
	private readonly targetOwnership = new Map<string, TargetOwnership>();
	/** Journal write failures on the best-effort paths (never silent; open failures fail the session instead). */
	private readonly journalErrorRecords: BrowserSessionErrorRecord[] = [];
	private recoveryInFlight: Promise<RecoveryVerdict | undefined> | undefined;
	private recovering = false;

	constructor(options: BrowserSessionManagerOptions) {
		this.engineProvider = typeof options.engine === 'function' ? options.engine : () => options.engine as BrowserPolicyEngine;
		this.host = options.host;
		this.workspaceRoot = options.workspaceRoot;
		this.artifacts = options.artifacts;
		this.journal = options.journal;
		this.clock = options.clock ?? (() => Date.now());
		this.taskIdProvider = typeof options.taskId === 'function'
			? options.taskId
			: options.taskId === undefined
				? () => undefined
				: () => options.taskId as string;
		this.noUrlPopupWindowMs = options.noUrlPopupWindowMs ?? DEFAULT_NO_URL_POPUP_WINDOW_MS;
		this.deps = {
			engine: () => this.engineProvider(),
			workspaceRoot: this.workspaceRoot,
			clock: this.clock,
			commandTimeoutMs: options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
			navigationTimeoutMs: options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS,
			bufferLimit: options.bufferLimit ?? DEFAULT_BUFFER_LIMIT,
			replaceTab: (sessionId, tab, reason) => this.replaceTabInternal(sessionId, tab, reason),
			taskIdOf: sessionId => this.taskIdProvider(sessionId),
		};
		this.host.onDrop(reason => {
			this.recoveryInFlight = this.recoverFromDrop(reason);
			void this.recoveryInFlight.catch(() => undefined);
		});
	}

	// #region Session journal (TL3-002 item 3.6)

	/**
	 * Appends one journal record. Throws on validation (unknown initiator —
	 * the actor is MANDATORY) and on writer I/O failure: callers on the
	 * OPEN path fail the session (fail-closed); the close/recovery paths
	 * capture the failure in {@link journalErrors} instead of breaking
	 * teardown (their state transition is already the fail-closed
	 * direction).
	 */
	private async journalEvent(descriptor: BrowserSessionDescriptor, event: SessionJournalEvent): Promise<void> {
		if (this.journal === undefined) {
			return;
		}
		const record = buildSessionJournalRecord(journalActorOf(descriptor.initiator), event, descriptor, this.clock());
		await this.journal.append(record);
	}

	private async journalEventBestEffort(descriptor: BrowserSessionDescriptor, event: SessionJournalEvent): Promise<void> {
		try {
			await this.journalEvent(descriptor, event);
		} catch (err) {
			this.journalErrorRecords.push({
				code: 'flauz.browser.journal',
				message: `journal ${event} event for ${descriptor.sessionId} failed: ${err instanceof Error ? err.message : String(err)}`,
				at: isoAt(this.clock),
			});
		}
	}

	/**
	 * P2-FIX-105 — the navigation-facts projection of one decision-path
	 * outcome onto the journal contract ({@link SessionJournalNavigation}).
	 * Sourced EXCLUSIVELY from the decision path's own return value: a deny
	 * outcome carries `sent:false` BY CONSTRUCTION (the pipeline sent zero
	 * commands), an allow outcome carries the committed URL — never from a
	 * wire-command observation (there is none on deny).
	 */
	private navigationFactsOf(outcome: NavigationOutcome): SessionJournalNavigation {
		return {
			decision: outcome.verdict.decision,
			requestedUrl: outcome.requestedUrl,
			sent: outcome.sent,
			...(outcome.committedUrl === undefined ? {} : { committedUrl: outcome.committedUrl }),
		};
	}

	/**
	 * P2-FIX-105 — appends one 'navigated' journal record (the navigation
	 * verdict as durable on-disk session evidence). Best-effort with a
	 * captured, never-silent failure (the {@link journalErrors} audit
	 * surface): the navigation itself already happened (or was denied) —
	 * failing it AFTER the fact would fabricate an outcome that did not
	 * occur, so the write failure is recorded instead, mirroring the
	 * close-path discipline.
	 */
	private async journalNavigationBestEffort(descriptor: BrowserSessionDescriptor, outcome: NavigationOutcome): Promise<void> {
		if (this.journal === undefined) {
			return;
		}
		try {
			const record = buildSessionJournalRecord(journalActorOf(descriptor.initiator), 'navigated', descriptor, this.clock(), this.navigationFactsOf(outcome));
			await this.journal.append(record);
		} catch (err) {
			this.journalErrorRecords.push({
				code: 'flauz.browser.journal',
				message: `journal navigated event for ${descriptor.sessionId} failed: ${err instanceof Error ? err.message : String(err)}`,
				at: isoAt(this.clock),
			});
		}
	}

	/** Journal write failures captured on the best-effort paths (audit surface; never silent). */
	journalErrors(): readonly BrowserSessionErrorRecord[] {
		return this.journalErrorRecords;
	}

	// #endregion

	// #region Session lifecycle

	/**
	 * Opens a session: mint the descriptor, derive the partition, gate the
	 * startUrl (fail-closed: deny => session `failed` BEFORE any host
	 * interaction — zero CDP commands), activate the host transport, mint the
	 * initial tab at about:blank (hardened: downloads denied, agent UA
	 * override; gated by the popup gate), then run the full navigation
	 * pipeline for the (allowed) startUrl. The 'opened' journal record is
	 * the session's forensic birth certificate: a journal failure fails the
	 * session (never a half-open, unjournaled session).
	 */
	async open(input: OpenSessionInput): Promise<OpenSessionResult> {
		const engine = this.engineProvider();
		const sessionId = mintSessionId();

		// Partition derivation (persist/memory scope, per-agent suffix) — fail-closed.
		let partition: string;
		let partitionError: string | undefined;
		try {
			partition = engine.derivePartition(this.workspaceRoot ?? '', input.initiator === 'agent' ? input.agentId : undefined);
		} catch (err) {
			partition = '';
			partitionError = err instanceof Error ? err.message : String(err);
		}
		const descriptor: BrowserSessionDescriptor = {
			schemaVersion: 0,
			sessionId,
			initiator: input.initiator,
			agentId: input.initiator === 'agent' ? input.agentId : undefined,
			partition,
			policySourceRef: policySourceRefOf(engine),
			createdAt: isoAt(this.clock),
			state: 'opening',
			tabs: [],
		};
		if (partitionError !== undefined) {
			return this.failOpen(descriptor, 'flauz.browser.partition', partitionError);
		}

		// Gate the startUrl with the correct initiator class (deny => NO host interaction at all).
		if (input.startUrl !== undefined) {
			const evaluation = engine.evaluate({
				url: input.startUrl,
				initiator: toEngineInitiator(input.initiator),
				partition,
				workspaceRoot: this.workspaceRoot,
				ts: this.clock(),
			});
			if (evaluation.final.decision === 'deny') {
				const failure = await this.failOpen(descriptor, 'flauz.browser.policy.deny', verdictSummary(evaluation.final));
				return { ...failure, verdict: evaluation.final, evidenceRow: toEvidenceRow(evaluation.final, this.taskIdProvider(sessionId)) };
			}
		}

		// Activate the transport (fail-closed: broken transport => failed session, never an open).
		try {
			await this.host.open();
		} catch (err) {
			return this.failOpen(descriptor, 'flauz.browser.host.unavailable', err instanceof Error ? err.message : String(err));
		}

		// P2-FIX-106 (DL-79): arm the BROWSER-level popup gate on the live
		// connection BEFORE any tab exists (a popup can arrive with the
		// first tab). Fail-closed: a session without the browser-level
		// gate never opens.
		try {
			await this.attachBrowserGate();
		} catch (err) {
			return this.failOpen(descriptor, 'flauz.browser.popup-gate', `browser-level popup gate could not be armed: ${err instanceof Error ? err.message : String(err)}`);
		}

		const entry: SessionEntry = { descriptor, live: new Map() };
		this.entries.set(sessionId, entry);

		// Mint the initial tab at the reset target (about:blank — structurally allowed).
		let initialTab: LiveTab;
		try {
			initialTab = await this.mintTab(entry, RESET_URL);
		} catch (err) {
			const code = err instanceof BrowserHardeningError ? 'flauz.browser.tab.hardening' : 'flauz.browser.tab.create';
			return this.failOpen(descriptor, code, err instanceof Error ? err.message : String(err), entry);
		}
		descriptor.state = 'active';

		let navigation: NavigationOutcome | undefined;
		if (input.startUrl !== undefined) {
			navigation = await runNavigation(this.deps, descriptor, initialTab, input.startUrl);
		}

		// The 'opened' journal record: fail-closed (a session that cannot be
		// journaled never opens half-way).
		try {
			await this.journalEvent(descriptor, 'opened');
		} catch (err) {
			return this.failOpen(descriptor, 'flauz.browser.journal', err instanceof Error ? err.message : String(err), entry);
		}

		if (navigation !== undefined) {
			// P2-FIX-105: the (allowed) startUrl navigation is durable
			// session evidence too — journaled AFTER the 'opened' birth
			// certificate so the session's first row stays 'opened'.
			await this.journalNavigationBestEffort(descriptor, navigation);
			return { descriptor: snapshotDescriptor(descriptor), navigation };
		}
		return { descriptor: snapshotDescriptor(descriptor) };
	}

	private async failOpen(descriptor: BrowserSessionDescriptor, code: string, message: string, entry?: SessionEntry): Promise<OpenSessionResult> {
		descriptor.state = 'failed';
		descriptor.error = { code, message, at: isoAt(this.clock) };
		if (entry !== undefined) {
			for (const tab of entry.live.values()) {
				tab.recorder.detach();
				tab.record.state = 'failed';
				tab.record.error = descriptor.error;
				this.releaseTargetOwnership(tab.record.targetId);
				void this.host.closeTab(tab.record.targetId).catch(() => undefined);
			}
			entry.live.clear();
		}
		// The failure itself is journaled best-effort (when the journal is the
		// failure's cause, this write fails too and is captured, not thrown).
		await this.journalEventBestEffort(descriptor, 'failed');
		return { descriptor: snapshotDescriptor(descriptor), error: { code, message } };
	}

	/**
	 * Mints a live tab: creates the host target, activates it (domain
	 * enables + TL3-002 per-session hardening — downloads denied, agent UA
	 * override — both fail-closed) and re-asserts the per-tab page-session
	 * auto-attach (tab-scoped session work — the DL-79 scope guard). A
	 * failure at any step closes the target browser-level immediately:
	 * never a half-open, ungoverned target. (The BROWSER-level popup gate
	 * holds + releases the minted target itself — P2-FIX-106: a
	 * browser-scope auto-attach intercepts runtime-minted tabs too; the
	 * gate releases them on opener attribution — no opener, not ours to
	 * gate.)
	 */
	private async mintTab(entry: SessionEntry, url: string): Promise<LiveTab> {
		const handle: HostTabHandle = await this.host.createTab(url);
		let live: LiveTab;
		try {
			live = await activateLiveTab(this.deps, entry.descriptor, handle.transport, handle.targetId, url);
			await this.enableTabScopedAutoAttach(live.transport);
		} catch (err) {
			// FAIL-CLOSED: a target whose activation or auto-attach failed
			// is closed browser-level immediately.
			try {
				await this.host.closeTab(handle.targetId);
			} catch {
				// Already gone; the activation error is the surfaced failure.
			}
			throw err;
		}
		this.registerTargetOwnership(entry.descriptor, live.record);
		entry.descriptor.tabs.push(live.record);
		entry.live.set(live.record.tabId, live);
		return live;
	}

	/** Snapshots of every descriptor (audit surface: includes closed/failed sessions). */
	list(): BrowserSessionDescriptor[] {
		return [...this.entries.values()].map(entry => snapshotDescriptor(entry.descriptor));
	}

	getSession(sessionId: string): BrowserSessionDescriptor | undefined {
		const entry = this.entries.get(sessionId);
		return entry === undefined ? undefined : snapshotDescriptor(entry.descriptor);
	}

	/** Closes a session: closes every live tab (best-effort) and seals the descriptor. */
	async close(sessionId: string): Promise<BrowserSessionDescriptor | SessionOperationError> {
		const entry = this.entries.get(sessionId);
		if (entry === undefined) {
			return { error: { code: 'flauz.browser.session.unknown', message: `no session ${sessionId}` } };
		}
		if (entry.descriptor.state !== 'closed') {
			for (const tab of entry.live.values()) {
				tab.recorder.detach();
				this.releaseTargetOwnership(tab.record.targetId);
				try {
					await this.host.closeTab(tab.record.targetId);
				} catch {
					// Best-effort: the tab may already be gone (drop/external close).
				}
				this.closeTabRecord(tab.record);
			}
			entry.live.clear();
			entry.descriptor.state = 'closed';
			await this.journalEventBestEffort(entry.descriptor, 'closed');
		}
		return snapshotDescriptor(entry.descriptor);
	}

	private closeTabRecord(record: BrowserTabRecord): void {
		record.state = 'closed';
		record.closedAt = isoAt(this.clock);
	}

	/** Focuses a tab by logical tab id (host surface; workbench hosts have none). */
	async focus(tabId: string): Promise<boolean | SessionOperationError> {
		for (const entry of this.entries.values()) {
			const tab = entry.live.get(tabId);
			if (tab !== undefined) {
				if (entry.descriptor.state !== 'active') {
					return { error: { code: 'flauz.browser.session.not-active', message: `session ${entry.descriptor.sessionId} is ${entry.descriptor.state}` } };
				}
				return this.host.focusTab(tab.record.targetId);
			}
		}
		return { error: { code: 'flauz.browser.tab.unknown', message: `no tab ${tabId}` } };
	}

	// #endregion

	// #region Tab ownership (TL3-002 item 3.5 — credential isolation)

	/** Registers a target to exactly one session/partition; a cross-session registration is a loud invariant violation. */
	private registerTargetOwnership(descriptor: BrowserSessionDescriptor, record: BrowserTabRecord): void {
		const existing = this.targetOwnership.get(record.targetId);
		if (existing !== undefined && existing.sessionId !== descriptor.sessionId) {
			throw new Error(`flauz.browser: target ${record.targetId} is already owned by session ${existing.sessionId} (partition ${existing.partition}); tabs belong to exactly one session/partition`);
		}
		this.targetOwnership.set(record.targetId, { sessionId: descriptor.sessionId, partition: descriptor.partition, tabId: record.tabId });
	}

	private releaseTargetOwnership(targetId: string): void {
		this.targetOwnership.delete(targetId);
	}

	// #endregion

	// #region Navigation + capture surfaces

	/**
	 * Policy-gated navigation (the pipeline; see src/runtime/tabs.ts).
	 * P2-FIX-105: every navigation attempt — ALLOWED or DENIED — appends a
	 * 'navigated' journal record (the verdict + requested/committed URLs +
	 * the zero-wire-commands fact), written from the DECISION-path outcome.
	 */
	async navigate(sessionId: string, url: string, options: { tabId?: string } = {}): Promise<NavigationOutcome | SessionOperationError> {
		const picked = this.pickTab(sessionId, options.tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		const outcome = await runNavigation(this.deps, picked.entry.descriptor, picked.tab, url);
		await this.journalNavigationBestEffort(picked.entry.descriptor, outcome);
		return outcome;
	}

	/**
	 * Executes the forced reset to about:blank (G6 EXECUTION; the narrow
	 * typed reset operation — see runForcedReset). Also executed
	 * automatically on post-commit violations when security.enforceReset
	 * is true (the default).
	 */
	async resetTab(sessionId: string, tabId?: string): Promise<ForcedResetOutcome | SessionOperationError> {
		const picked = this.pickTab(sessionId, tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		const outcome = await runForcedReset(this.deps, picked.entry.descriptor, picked.tab);
		// P2-FIX-105: a forced reset IS a navigation through the full
		// policy pipeline (about:blank) — its verdict is journal evidence.
		await this.journalNavigationBestEffort(picked.entry.descriptor, outcome);
		return outcome;
	}

	/** Screenshot: bytes + evidence row (+ artifact when a writer is configured). */
	async screenshot(sessionId: string, tabId?: string): Promise<ScreenshotOutcome | SessionOperationError> {
		const picked = this.pickTab(sessionId, tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		const artifacts = this.artifacts;
		const writeArtifact = artifacts === undefined
			? undefined
			: (name: string, bytes: Uint8Array) => artifacts.writeArtifact(this.artifactDirectoryOf(sessionId), name, bytes);
		return runScreenshot(this.deps, picked.entry.descriptor, picked.tab, writeArtifact);
	}

	consoleTail(sessionId: string, tabId?: string, limit: number = 50): ConsoleCaptureEntry[] | SessionOperationError {
		const picked = this.pickTab(sessionId, tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		return picked.tab.recorder.consoleTail(limit);
	}

	networkLog(sessionId: string, tabId?: string, limit: number = 50): NetworkCaptureEntry[] | SessionOperationError {
		const picked = this.pickTab(sessionId, tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		return picked.tab.recorder.networkTail(limit);
	}

	private pickTab(sessionId: string, tabId?: string): { entry: SessionEntry; tab: LiveTab } | SessionOperationError {
		const entry = this.entries.get(sessionId);
		if (entry === undefined) {
			return { error: { code: 'flauz.browser.session.unknown', message: `no session ${sessionId}` } };
		}
		const state = entry.descriptor.state;
		if (state !== 'active' && state !== 'suspended') {
			return { error: { code: 'flauz.browser.session.not-active', message: `session ${sessionId} is ${state}` } };
		}
		if (tabId !== undefined) {
			const tab = entry.live.get(tabId);
			if (tab === undefined) {
				// TL3-002 item 3.5: a tab of ANOTHER session is a typed
				// credential-isolation error, never silently "unknown".
				for (const other of this.entries.values()) {
					if (other === entry || !other.live.has(tabId)) {
						continue;
					}
					if (other.descriptor.partition !== entry.descriptor.partition) {
						return {
							error: {
								code: 'flauz.browser.tab.cross-partition',
								message: `tab ${tabId} belongs to session ${other.descriptor.sessionId} in partition ${other.descriptor.partition}; cross-partition tab use is denied (credential isolation; session ${sessionId} is in partition ${entry.descriptor.partition})`,
							},
						};
					}
					return {
						error: {
							code: 'flauz.browser.tab.foreign-session',
							message: `tab ${tabId} belongs to session ${other.descriptor.sessionId} (tabs are owned by exactly one session; partition ${entry.descriptor.partition})`,
						},
					};
				}
				return { error: { code: 'flauz.browser.tab.unknown', message: `no live tab ${tabId} in session ${sessionId}` } };
			}
			return { entry, tab };
		}
		for (const tab of entry.live.values()) {
			if (tab.record.state === 'active' || tab.record.state === 'suspended') {
				return { entry, tab };
			}
		}
		return { error: { code: 'flauz.browser.tab.none-active', message: `session ${sessionId} has no active tab` } };
	}

	// #endregion

	// #region Popup / new-target gate (TL3-002 item 3.3)

	/** Subscribes to popup-gate events (fired for every gated target, allow or deny). */
	onPopupGate(handler: (event: PopupGateEvent) => void): void {
		this.popupGateHandlers.push(handler);
	}

	/** The popup-gate audit log (every decision, in order). */
	popupGateEvents(): readonly PopupGateEvent[] {
		return this.popupGateLog;
	}

	/** Awaits all in-flight + queued popup-gate work (test/drill surface). */
	async awaitPopupGate(): Promise<void> {
		await this.gateChain;
	}

	private recordPopupGateEvent(event: PopupGateEvent): void {
		// P2-FIX-107 / DL-80: the at-record normalization at the popup-gate
		// write boundary -- every record this audit surface persists (and every
		// subscriber it broadcasts to) carries the URL with its structure and
		// param names intact and secret-shaped query-param VALUES redacted.
		const record: PopupGateEvent = { ...event, url: redactSecretShapedQueryValues(event.url) };
		this.popupGateLog.push(record);
		for (const handler of [...this.popupGateHandlers]) {
			try {
				handler(record);
			} catch {
				// Listener errors never break the gate.
			}
		}
	}

	private disposeBrowserGate(): void {
		this.browserGate?.subscription.dispose();
		this.browserGate = undefined;
	}

	/**
	 * P2-FIX-106 (DL-79) — arms the popup/new-target gate at BROWSER level:
	 * `Target.setAutoAttach` with `waitForDebuggerOnStart` at the browser
	 * scope, the only placement real Chromium delivers `window.open`
	 * targets to (drill finding F-DELIVERY: page-session auto-attach
	 * receives NOTHING for browser-level popups). The handler subscribes
	 * BEFORE the command (no attach window). FAIL-CLOSED: when the command
	 * fails, the subscription is disposed and the error propagates (the
	 * caller fails the open/recovery — an ungated session is never
	 * accepted). Idempotent per connection; the recovery reconnect re-arms
	 * on the fresh transport.
	 */
	private async attachBrowserGate(): Promise<void> {
		const root = await this.host.rootTransport();
		if (root === undefined || root.closed) {
			throw new Error('no browser-level transport available for the popup gate (DL-79 browser-scope placement)');
		}
		if (this.browserGate !== undefined && this.browserGate.transport === root) {
			return; // already armed on this connection
		}
		this.disposeBrowserGate();
		const subscription = root.on('Target.attachedToTarget', params => {
			this.queueGateWork(() => this.handleBrowserAttachedTarget(root, params));
		});
		this.browserGate = { transport: root, subscription };
		try {
			await root.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });
		} catch (err) {
			this.disposeBrowserGate();
			throw err;
		}
	}

	private queueGateWork(work: () => Promise<void>): void {
		this.gateChain = this.gateChain.then(work).catch(() => undefined);
	}

	/**
	 * Page-session auto-attach per live tab — UNCHANGED placement per the
	 * DL-79 scope guard ("page-session auto-attach stays for tab-scoped
	 * session work"): the command keeps its landed shape (flatten +
	 * waitForDebuggerOnStart, page filter) on every minted/re-attached tab.
	 * The POPUP GATE no longer rides here (it moved to browser level —
	 * real Chromium delivers no window.open targets at page scope; drill
	 * finding F-DELIVERY, pinned).
	 */
	private async enableTabScopedAutoAttach(transport: CdpTransport): Promise<void> {
		await transport.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page' }] });
	}

	/** Releases a held (waitForDebuggerOnStart) target — the not-ours-to-gate path. */
	private async releaseHeldTarget(root: CdpTransport, heldSessionId: string): Promise<void> {
		await scopeToSession(root, heldSessionId).send('Runtime.runIfWaitingForDebugger');
	}

	/**
	 * The browser-level gate (P2-FIX-106 / DL-79): every held
	 * (waitForDebuggerOnStart) target delivered at browser scope. OPENER
	 * ATTRIBUTION first — `targetInfo.openerId` names the opener: a target
	 * with NO opener (the runtime's own minted tabs, browser-internal
	 * targets) or a NON-SESSION opener is NOT the runtime's to gate and is
	 * released immediately (also what unblocks the runtime's own
	 * createTab targets, which the browser-scope auto-attach holds).
	 * Explicit `Target.attachToTarget` echoes (not waiting) are ignored —
	 * they are not holds.
	 */
	private async handleBrowserAttachedTarget(root: CdpTransport, params: CdpParams): Promise<void> {
		let owner: { entry: SessionEntry; sourceTab: LiveTab } | undefined;
		try {
			const targetInfo = (params.targetInfo ?? undefined) as { targetId?: unknown; openerId?: unknown } | undefined;
			const heldSessionId = typeof params.sessionId === 'string' ? params.sessionId : undefined;
			const targetId = typeof targetInfo?.targetId === 'string' ? targetInfo.targetId : undefined;
			if (targetId === undefined || heldSessionId === undefined) {
				return; // no target identity: nothing to gate or release
			}
			if (params.waitingForDebugger !== true) {
				return; // an explicit attachToTarget echo, not a gate hold
			}
			const openerId = typeof targetInfo?.openerId === 'string' ? targetInfo.openerId : undefined;
			const ownership = openerId === undefined ? undefined : this.targetOwnership.get(openerId);
			const entry = ownership === undefined ? undefined : this.entries.get(ownership.sessionId);
			const sourceTab = ownership === undefined ? undefined : entry?.live.get(ownership.tabId);
			if (entry === undefined || sourceTab === undefined || openerId === undefined) {
				// No opener, a dead opener, or a NON-SESSION opener: not
				// the runtime's to gate — release immediately (DL-79).
				await this.releaseHeldTarget(root, heldSessionId);
				return;
			}
			const descriptor = entry.descriptor;
			if (descriptor.state !== 'active' && descriptor.state !== 'suspended') {
				// A dying session gates nothing (its tabs are being torn down) — release.
				await this.releaseHeldTarget(root, heldSessionId);
				return;
			}
			owner = { entry, sourceTab };
			await this.gateHeldPopup(root, entry, sourceTab, { targetId, heldSessionId, openerId });
		} catch (err) {
			// The gate itself must never throw into the transport fan-out; a
			// gate failure fails the OPENER's session (fail-closed). An
			// unowned hold (the runtime's own mint target) has no session to
			// fail here — its mint flow shares the same transport and fails
			// closed on the same breakage through its own surfaces.
			if (owner === undefined) {
				return;
			}
			const descriptor = owner.entry.descriptor;
			descriptor.state = 'failed';
			descriptor.error = {
				code: 'flauz.browser.popup-gate',
				message: `popup gate error on target handling: ${err instanceof Error ? err.message : String(err)}; session failed (fail-closed)`,
				at: isoAt(this.clock),
			};
			await this.journalEventBestEffort(descriptor, 'failed');
		}
	}

	/**
	 * P2-FIX-106 (DL-79) — Fetch-domain PRE-USE URL observation on the held
	 * popup. `targetInfo.url` is EMPTY at attach on real Chromium (drill
	 * finding F-POPUP-URL — accepted as a real-Chromium fact, not worked
	 * around), and a debugger-held target starts NO request, so the pending
	 * destination is observed at the network layer: interception is armed
	 * on the held session FIRST (`Fetch.enable`), the hold is then released
	 * (`Runtime.runIfWaitingForDebugger` — arming first matters: released
	 * before arming, the destination would slip past ungated; the FIRST
	 * `Fetch.requestPaused` pauses BEFORE the wire and carries the request
	 * URL — the gate's URL input; real-Chromium-verified sequencing).
	 * DECISIVENESS IS LAW (drill finding F-OPENER-BLOCK: a held popup blocks
	 * the opener's JS): the release happens immediately on opener
	 * attribution (no indefinite hold), and the verdict is reached on the
	 * FIRST paused request and acted on immediately. The bounded no-request
	 * window ({@link BrowserSessionManagerOptions.noUrlPopupWindowMs})
	 * covers the no-destination popup (`window.open()` — no request ever
	 * pauses; real-Chromium-pinned): when it expires, interception is
	 * disarmed (nothing may wedge the released popup at the network layer)
	 * and no gate event is recorded (no destination was gated).
	 */
	private async gateHeldPopup(root: CdpTransport, entry: SessionEntry, sourceTab: LiveTab, held: HeldPopup): Promise<void> {
		const descriptor = entry.descriptor;
		const heldTransport = scopeToSession(root, held.heldSessionId);

		// Subscribe BEFORE arming (the lost-event race discipline).
		let settlePaused: ((pause: PausedRequest) => void) | undefined;
		const pausedPromise = new Promise<PausedRequest>(resolve => {
			settlePaused = resolve;
		});
		const pauseSubscription = heldTransport.on('Fetch.requestPaused', params => {
			const requestId = typeof params.requestId === 'string' ? params.requestId : undefined;
			const request = params.request as { url?: unknown } | undefined;
			const url = typeof request?.url === 'string' ? request.url : undefined;
			if (requestId === undefined || url === undefined || settlePaused === undefined) {
				return;
			}
			const settle = settlePaused;
			settlePaused = undefined; // only the FIRST paused request is the gate's input
			settle({ requestId, url });
		});
		let noUrlTimer: { unref(): void } | undefined;
		const noUrlWindow = new Promise<undefined>(resolve => {
			const timer = setTimeout(() => resolve(undefined), this.noUrlPopupWindowMs);
			timer.unref();
			noUrlTimer = timer;
		});
		try {
			await heldTransport.send('Fetch.enable', {});
			await heldTransport.send('Runtime.runIfWaitingForDebugger');
		} catch (err) {
			pauseSubscription.dispose();
			if (noUrlTimer !== undefined) {
				clearTimeout(noUrlTimer);
			}
			// FAIL-CLOSED: a popup whose destination cannot be observed
			// pre-use must never be used — close it for safety (best-effort)
			// and fail the opener's session (an ungovernable target never
			// persists).
			try {
				await this.host.closeTab(held.targetId);
			} catch {
				// The session failure below is the fail-closed act.
			}
			descriptor.state = 'failed';
			descriptor.error = {
				code: 'flauz.browser.popup-gate',
				message: `popup gate could not observe held target ${held.targetId} (Fetch arm/release failed: ${err instanceof Error ? err.message : String(err)}); session failed (fail-closed)`,
				at: isoAt(this.clock),
			};
			await this.journalEventBestEffort(descriptor, 'failed');
			return;
		}
		const paused = await Promise.race([pausedPromise, noUrlWindow]);
		pauseSubscription.dispose();
		if (noUrlTimer !== undefined) {
			clearTimeout(noUrlTimer);
		}
		if (paused === undefined) {
			// No-URL popup (window.open() with no destination — no request
			// ever pauses): already released at arming (decisiveness);
			// disarm interception so nothing can wedge at the network layer
			// and stop listening. No gate event: no destination was gated.
			try {
				await heldTransport.send('Fetch.disable');
			} catch {
				// The popup is released; a broken transport surfaces through
				// its own failure paths (drop recovery / command timeouts).
			}
			return;
		}

		// The FIRST paused request carries the pending destination — the
		// gate's URL input. Evidence timing is FIRST-REQUEST time (DL-79:
		// moved from attach-time), and the verdict is computed with the
		// OPENER session's initiator class.
		const firstRequestTs = this.clock();
			const engine = this.engineProvider();
			const verdict = engine.evaluate({
			url: paused.url,
				initiator: toEngineInitiator(descriptor.initiator),
				partition: descriptor.partition,
				workspaceRoot: this.workspaceRoot,
			ts: firstRequestTs,
			}).final;
			const taskId = this.taskIdProvider(descriptor.sessionId);
		// The observed URL is page-derived: the evidence row carries the
			// untrusted-content boundary marker (a MARKER, not sanitization).
			const evidenceRow: EvidenceRowInput = { ...toEvidenceRow(verdict, taskId), note: untrustedContentNote(verdictSummary(verdict)) };
		const at = isoAt(() => firstRequestTs);

			if (verdict.decision === 'deny') {
			// DENY (DL-79): abort the paused request BEFORE the wire
			// (Fetch.failRequest — zero committed loads, zero bytes to the
			// denied host; a failed abort is not fatal: the request is
			// PAUSED, zero bytes sent, and the close below is the hard
			// guarantee) + destroy the target before use
			// (Target.closeTarget) + the DENY event.
			try {
				await heldTransport.send('Fetch.failRequest', { requestId: paused.requestId, errorReason: 'BlockedByClient' });
			} catch {
				// Zero bytes left the pause point; the close destroys the target before use.
			}
				let closed = true;
				let closeError: string | undefined;
				try {
				await this.host.closeTab(held.targetId);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (/no such target/i.test(message)) {
						closed = true; // already gone: the deny outcome holds
					} else {
						closed = false;
						closeError = message;
					}
				}
				this.recordPopupGateEvent({
					sessionId: descriptor.sessionId,
					sourceTabId: sourceTab.record.tabId,
				targetId: held.targetId,
				url: paused.url,
				observedUrl: paused.url,
				openerId: held.openerId,
					decision: 'deny',
					verdict,
					evidenceRow,
					...(closeError === undefined ? {} : { closeError }),
					closed,
				at,
				});
				if (!closed) {
					// FAIL-CLOSED: a denied target we cannot close must not persist.
					descriptor.state = 'failed';
					descriptor.error = {
						code: 'flauz.browser.popup-gate',
					message: `popup gate could not close denied target ${held.targetId} (${closeError ?? 'unknown error'}); session failed (fail-closed)`,
						at: isoAt(this.clock),
					};
					await this.journalEventBestEffort(descriptor, 'failed');
				}
				return;
			}

		// ALLOW (DL-79): disarm interception (the paused destination
		// resumes and commits) + the ALLOW event, then attach the target
		// as a tab of the SAME session per the landed contract (the
		// target was never used before the verdict; the hold was released
		// at arming).
			try {
			await heldTransport.send('Fetch.disable');
			const handle = await this.host.attachTab(held.targetId);
			const live = await activateLiveTab(this.deps, descriptor, handle.transport, held.targetId, paused.url);
			await this.enableTabScopedAutoAttach(live.transport);
				this.registerTargetOwnership(descriptor, live.record);
				descriptor.tabs.push(live.record);
				entry.live.set(live.record.tabId, live);
				this.recordPopupGateEvent({
					sessionId: descriptor.sessionId,
					sourceTabId: sourceTab.record.tabId,
				targetId: held.targetId,
				url: paused.url,
				observedUrl: paused.url,
				openerId: held.openerId,
					decision: 'allow',
					verdict,
					evidenceRow,
					attachedTabId: live.record.tabId,
				at,
				});
			} catch (err) {
			// The policy allowed the target but the disarm/attach failed:
			// close it for safety (an ungoverned allowed target must not
			// run untracked) and record the truth; a close failure fails
			// the session (same fail-closed rule as the deny path).
				const attachError = err instanceof Error ? err.message : String(err);
				let closed = false;
				let closeError: string | undefined;
				try {
				await this.host.closeTab(held.targetId);
					closed = true;
				} catch (closeErr) {
					const message = closeErr instanceof Error ? closeErr.message : String(closeErr);
					if (/no such target/i.test(message)) {
						closed = true;
					} else {
						closeError = message;
					}
				}
				this.recordPopupGateEvent({
					sessionId: descriptor.sessionId,
					sourceTabId: sourceTab.record.tabId,
				targetId: held.targetId,
				url: paused.url,
				observedUrl: paused.url,
				openerId: held.openerId,
					decision: 'allow',
					verdict,
					evidenceRow,
					attachError,
					...(closeError === undefined ? {} : { closeError }),
					closed,
				at,
				});
				if (!closed) {
					descriptor.state = 'failed';
					descriptor.error = {
						code: 'flauz.browser.popup-gate',
					message: `popup gate could not attach or close allowed target ${held.targetId} (attach: ${attachError}; close: ${closeError ?? 'unknown error'}); session failed (fail-closed)`,
						at: isoAt(this.clock),
					};
					await this.journalEventBestEffort(descriptor, 'failed');
				}
			}
		}

	// #endregion

	// #region Recovery (transport drop) + wedged tabs

	/** Subscribe to recovery verdicts (one per transport drop). */
	onRecovery(handler: (verdict: RecoveryVerdict) => void): void {
		this.recoveryHandlers.push(handler);
	}

	/** Awaits the in-flight recovery (test/drill surface; resolves immediately when idle). */
	async awaitRecovery(): Promise<RecoveryVerdict | undefined> {
		return this.recoveryInFlight ?? undefined;
	}

	/**
	 * The artifact directory id for a session: the explicit task id when the
	 * manager was given one (the Agent Bridge flow), else the deterministic
	 * session-derived id (screenshot artifacts still land under
	 * `.flauz/artifacts/` rather than being dropped).
	 */
	private artifactDirectoryOf(sessionId: string): string {
		const explicit = this.taskIdProvider(sessionId);
		if (explicit !== undefined) {
			return explicit;
		}
		return sessionId.replace(/[^A-Za-z0-9._-]/g, '-');
	}

	/** Wedged tab: close the target best-effort, mark failed, mint a replacement at about:blank. */
	private async replaceTabInternal(sessionId: string, tab: LiveTab, reason: string): Promise<LiveTab> {
		const entry = this.entries.get(sessionId);
		if (entry === undefined) {
			throw new Error(`flauz.browser: replaceTab on unknown session ${sessionId}`);
		}
		try {
			await this.host.closeTab(tab.record.targetId);
		} catch {
			// The wedged renderer's target may already be gone; browser-level close is best-effort.
		}
		tab.recorder.detach();
		this.releaseTargetOwnership(tab.record.targetId);
		entry.live.delete(tab.record.tabId);
		tab.record.state = 'failed';
		tab.record.error = { code: reason, message: 'tab replaced: command timeout on a live transport', at: isoAt(this.clock) };
		const replacement = await this.mintTab(entry, RESET_URL);
		tab.record.replacedByTabId = replacement.record.tabId;
		return replacement;
	}

	/**
	 * Transport-drop recovery: suspend live sessions, reconnect (fresh
	 * transport), reconcile the tab list vs the descriptors (restore what
	 * exists, mark lost tabs), re-apply the FULL mint-time activation to
	 * every re-attached tab (domain enables + per-session hardening + the
	 * per-tab auto-attach — the domain re-enable is the TL3-P2 fix for drill
	 * finding F-RECOVERY-DOMAINS: without it, post-recovery commit
	 * observation timed out on real Chromium and the post-commit
	 * reconciliation was skipped), and re-check the reconciled state
	 * against the CURRENT policy (violations surface as evidence rows;
	 * every further navigation is gated against the current engine again).
	 * Re-attach only touches targets the ownership registry attributes to
	 * THIS session+partition (credential isolation, item 3.5). Reconnect
	 * failure => the sessions are `failed` (never left half-open). Every
	 * state transition is journaled (item 3.6).
	 */
	private async recoverFromDrop(reason: string): Promise<RecoveryVerdict | undefined> {
		if (this.recovering) {
			return undefined; // single flight: a second drop during recovery merges into the running one
		}
		this.recovering = true;
		try {
			const at = this.clock();
			for (const entry of this.entries.values()) {
				if (entry.descriptor.state === 'active') {
					entry.descriptor.state = 'suspended';
					await this.journalEventBestEffort(entry.descriptor, 'state-changed');
				}
				for (const tab of entry.live.values()) {
					tab.recorder.detach();
				}
			}
			let reconnected = false;
			let browserGateArmed = false;
			try {
				await this.host.open();
				reconnected = true;
			} catch {
				reconnected = false;
			}
			if (reconnected) {
				// P2-FIX-106 (DL-79): re-arm the BROWSER-level popup gate
				// on the FRESH connection before any tab is re-attached — a
				// reconnection that cannot re-arm the gate never resumes
				// sessions half-governed (fail-closed below).
				try {
					await this.attachBrowserGate();
					browserGateArmed = true;
				} catch {
					browserGateArmed = false;
				}
			}
			const reports: RecoverySessionReportDraft[] = [];
			const reconnectFailure: { code: string; message: string } | undefined = !reconnected
				? { code: 'flauz.browser.transport-drop', message: `transport dropped (${reason}) and reconnect failed` }
				: browserGateArmed
					? undefined
					: { code: 'flauz.browser.popup-gate', message: `transport dropped (${reason}) and the browser-level popup gate could not be re-armed on reconnect (P2-FIX-106/DL-79)` };
			if (reconnectFailure !== undefined) {
				// Fail-closed: sessions never stay half-open after a failed
				// reconnect — or after a reconnect that cannot re-arm the
				// browser-level popup gate (P2-FIX-106).
				for (const entry of this.entries.values()) {
					if (entry.descriptor.state !== 'suspended') {
						continue;
					}
					entry.descriptor.state = 'failed';
					entry.descriptor.error = { code: reconnectFailure.code, message: reconnectFailure.message, at: isoAt(this.clock) };
					const lostTabIds: string[] = [];
					for (const tab of entry.live.values()) {
						tab.record.state = 'failed';
						tab.record.error = entry.descriptor.error;
						lostTabIds.push(tab.record.tabId);
					}
					entry.live.clear();
					reports.push({ sessionId: entry.descriptor.sessionId, state: 'failed', recoveredTabIds: [], lostTabIds, policyViolations: [] });
					await this.journalEventBestEffort(entry.descriptor, 'failed');
				}
			} else {
				const liveTargets = new Map((await this.host.listTabs()).map(info => [info.targetId, info]));
				const engine = this.engineProvider();
				for (const entry of this.entries.values()) {
					if (entry.descriptor.state !== 'suspended') {
						continue;
					}
					const report: RecoverySessionReportDraft = {
						sessionId: entry.descriptor.sessionId,
						state: 'active',
						recoveredTabIds: [],
						lostTabIds: [],
						policyViolations: [],
					};
					for (const tab of [...entry.live.values()]) {
						const record = tab.record;
						const owner = this.targetOwnership.get(record.targetId);
						if (owner === undefined || owner.sessionId !== entry.descriptor.sessionId || owner.partition !== entry.descriptor.partition) {
							// Credential isolation: a target not owned by THIS
							// session/partition is never re-attached (typed loss).
							this.markTabLost(entry, tab, report, 'flauz.browser.tab.foreign-target', `recovery re-attach denied: target ${record.targetId} is not owned by session ${entry.descriptor.sessionId}/partition ${entry.descriptor.partition} (credential isolation)`);
							continue;
						}
						const info = liveTargets.get(record.targetId);
						if (info === undefined) {
							this.markTabLost(entry, tab, report);
							continue;
						}
						try {
							const handle = await this.host.attachTab(record.targetId);
							tab.transport = handle.transport;
							// Re-apply the FULL mint-time activation on the FRESH
							// session (fail-closed: a tab that cannot be activated
							// is lost, not silently re-opened): domain enables (the
							// TL3-P2 fix for drill finding F-RECOVERY-DOMAINS — real
							// Chromium delivers Page events only to sessions with the
							// domain enabled, so without the re-enable every
							// post-recovery commit observation timed out and the
							// post-commit reconciliation was skipped), then the
							// per-session hardening, then the per-tab auto-attach
							// (the popup gate itself re-arms at BROWSER level on the
							// fresh connection — P2-FIX-106).
							await enableTabDomains(handle.transport);
							await applySessionHardening(handle.transport, entry.descriptor);
							await this.enableTabScopedAutoAttach(tab.transport);
							tab.recorder.attach(handle.transport);
							record.url = info.url;
							record.state = 'active';
							report.recoveredTabIds.push(record.tabId);
							// Policy-safe recheck: the reconciled URL vs the CURRENT policy.
							const recheck = engine.evaluate({
								url: info.url,
								initiator: toEngineInitiator(entry.descriptor.initiator),
								partition: entry.descriptor.partition,
								workspaceRoot: this.workspaceRoot,
								ts: this.clock(),
							}).final;
							if (recheck.decision === 'deny') {
								report.policyViolations.push(toEvidenceRow(recheck, this.taskIdProvider(entry.descriptor.sessionId)));
							}
						} catch {
							this.markTabLost(entry, tab, report);
						}
					}
					entry.descriptor.state = 'active';
					reports.push(report);
					await this.journalEventBestEffort(entry.descriptor, 'state-changed');
				}
			}
			const verdict: RecoveryVerdict = { reason, at, reconnected, sessions: reports };
			for (const handler of [...this.recoveryHandlers]) {
				try {
					handler(verdict);
				} catch {
					// Listener errors never break recovery.
				}
			}
			return verdict;
		} finally {
			this.recovering = false;
		}
	}

	private markTabLost(entry: SessionEntry, tab: LiveTab, report: RecoverySessionReportDraft, code: string = 'flauz.browser.tab.lost', message: string = 'target gone after transport drop'): void {
		tab.recorder.detach();
		this.releaseTargetOwnership(tab.record.targetId);
		entry.live.delete(tab.record.tabId);
		tab.record.state = 'lost';
		tab.record.error = { code, message, at: isoAt(this.clock) };
		report.lostTabIds.push(tab.record.tabId);
	}

	// #endregion

	/** Closes every session and the host (deactivate/dispose surface). */
	async dispose(): Promise<void> {
		for (const sessionId of [...this.entries.keys()]) {
			await this.close(sessionId);
		}
		this.disposeBrowserGate();
		await this.host.close();
	}
}
