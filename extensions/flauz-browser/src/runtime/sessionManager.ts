/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * BrowserSessionManager (TL3-001): owns the BrowserSessionDescriptor
 * lifecycle — open/list/focus/close — and drives the tab pipeline.
 *
 * INVARIANTS (fail-closed, pinned by tests):
 *   - Missing policy -> the engine's builtin deny-all denies; a DENIED
 *     navigation sends ZERO CDP commands (the FakeCdpTransport sent-command
 *     log is the assertion surface).
 *   - Broken transport -> the session is `failed`, never an open; a denied
 *     startUrl fails the session BEFORE any host interaction.
 *   - Recovery NEVER bypasses policy: after a transport drop the manager
 *     reconnects (fresh transport), reconciles the tab list vs the
 *     descriptors (restoring what exists, marking lost tabs), re-checks the
 *     reconciled state against the CURRENT policy, and every further
 *     navigation is gated against the current engine again.
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
import type { BrowserHost, HostTabHandle } from './host.ts';
import {
	type BrowserSessionDescriptor,
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
	type LiveTab,
	runNavigation,
	runReset,
	runScreenshot,
	type NavigationOutcome,
	type TabPipelineDeps,
} from './tabs.ts';
import type {
	ArtifactWriterPort,
	ConsoleCaptureEntry,
	NetworkCaptureEntry,
	ScreenshotOutcome,
} from './capture.ts';

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
export function isSessionError<TResult>(result: TResult | SessionOperationError): result is SessionOperationError {
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
	readonly clock?: Clock;
	/** Wedged-tab detection timeout (default 5s). */
	readonly commandTimeoutMs?: number;
	/** Navigation commit/load wait (default 15s). */
	readonly navigationTimeoutMs?: number;
	/** Capture ring buffer size (default 500). */
	readonly bufferLimit?: number;
}

interface SessionEntry {
	descriptor: BrowserSessionDescriptor;
	live: Map<string, LiveTab>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000;
const DEFAULT_BUFFER_LIMIT = 500;

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
	private readonly clock: Clock;
	private readonly entries = new Map<string, SessionEntry>();
	private readonly recoveryHandlers: Array<(verdict: RecoveryVerdict) => void> = [];
	private readonly deps: TabPipelineDeps;
	private recoveryInFlight: Promise<RecoveryVerdict | undefined> | undefined;
	private recovering = false;

	constructor(options: BrowserSessionManagerOptions) {
		this.engineProvider = typeof options.engine === 'function' ? options.engine : () => options.engine as BrowserPolicyEngine;
		this.host = options.host;
		this.workspaceRoot = options.workspaceRoot;
		this.artifacts = options.artifacts;
		this.clock = options.clock ?? (() => Date.now());
		this.taskIdProvider = typeof options.taskId === 'function'
			? options.taskId
			: options.taskId === undefined
				? () => undefined
				: () => options.taskId as string;
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

	// #region Session lifecycle

	/**
	 * Opens a session: mint the descriptor, derive the partition, gate the
	 * startUrl (fail-closed: deny => session `failed` BEFORE any host
	 * interaction — zero CDP commands), activate the host transport, mint the
	 * initial tab at about:blank, then run the full navigation pipeline for
	 * the (allowed) startUrl.
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
				const failure = this.failOpen(descriptor, 'flauz.browser.policy.deny', verdictSummary(evaluation.final));
				return { ...failure, verdict: evaluation.final, evidenceRow: toEvidenceRow(evaluation.final, this.taskIdProvider(sessionId)) };
			}
		}

		// Activate the transport (fail-closed: broken transport => failed session, never an open).
		try {
			await this.host.open();
		} catch (err) {
			return this.failOpen(descriptor, 'flauz.browser.host.unavailable', err instanceof Error ? err.message : String(err));
		}

		const entry: SessionEntry = { descriptor, live: new Map() };
		this.entries.set(sessionId, entry);

		// Mint the initial tab at the reset target (about:blank — structurally allowed).
		let initialTab: LiveTab;
		try {
			initialTab = await this.mintTab(entry, RESET_URL);
		} catch (err) {
			return this.failOpen(descriptor, 'flauz.browser.tab.create', err instanceof Error ? err.message : String(err), entry);
		}
		descriptor.state = 'active';

		if (input.startUrl !== undefined) {
			const navigation = await runNavigation(this.deps, descriptor, initialTab, input.startUrl);
			return { descriptor: snapshotDescriptor(descriptor), navigation };
		}
		return { descriptor: snapshotDescriptor(descriptor) };
	}

	private failOpen(descriptor: BrowserSessionDescriptor, code: string, message: string, entry?: SessionEntry): OpenSessionResult {
		descriptor.state = 'failed';
		descriptor.error = { code, message, at: isoAt(this.clock) };
		if (entry !== undefined) {
			for (const tab of entry.live.values()) {
				tab.recorder.detach();
				tab.record.state = 'failed';
				tab.record.error = descriptor.error;
			}
			entry.live.clear();
		}
		return { descriptor: snapshotDescriptor(descriptor), error: { code, message } };
	}

	private async mintTab(entry: SessionEntry, url: string): Promise<LiveTab> {
		const handle: HostTabHandle = await this.host.createTab(url);
		const live = await activateLiveTab(this.deps, handle.transport, handle.targetId, url);
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
				try {
					await this.host.closeTab(tab.record.targetId);
				} catch {
					// Best-effort: the tab may already be gone (drop/external close).
				}
				this.closeTabRecord(tab.record);
			}
			entry.live.clear();
			entry.descriptor.state = 'closed';
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

	// #region Navigation + capture surfaces

	/** Policy-gated navigation (the pipeline; see src/runtime/tabs.ts). */
	async navigate(sessionId: string, url: string, options: { tabId?: string } = {}): Promise<NavigationOutcome | SessionOperationError> {
		const picked = this.pickTab(sessionId, options.tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		return runNavigation(this.deps, picked.entry.descriptor, picked.tab, url);
	}

	/** Executes the forced reset to about:blank (SECURITY-MODEL F2 recommendation). */
	async resetTab(sessionId: string, tabId?: string): Promise<NavigationOutcome | SessionOperationError> {
		const picked = this.pickTab(sessionId, tabId);
		if (isSessionError(picked)) {
			return picked;
		}
		return runReset(this.deps, picked.entry.descriptor, picked.tab);
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
	 * exists, mark lost tabs), and re-check the reconciled state against the
	 * CURRENT policy (violations surface as evidence rows; every further
	 * navigation is gated against the current engine again). Reconnect failure
	 * => the sessions are `failed` (never left half-open).
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
				}
				for (const tab of entry.live.values()) {
					tab.recorder.detach();
				}
			}
			let reconnected = false;
			try {
				await this.host.open();
				reconnected = true;
			} catch {
				reconnected = false;
			}
			const reports: RecoverySessionReportDraft[] = [];
			if (!reconnected) {
				// Fail-closed: sessions never stay half-open after a failed reconnect.
				for (const entry of this.entries.values()) {
					if (entry.descriptor.state !== 'suspended') {
						continue;
					}
					entry.descriptor.state = 'failed';
					entry.descriptor.error = { code: 'flauz.browser.transport-drop', message: `transport dropped (${reason}) and reconnect failed`, at: isoAt(this.clock) };
					const lostTabIds: string[] = [];
					for (const tab of entry.live.values()) {
						tab.record.state = 'failed';
						tab.record.error = entry.descriptor.error;
						lostTabIds.push(tab.record.tabId);
					}
					entry.live.clear();
					reports.push({ sessionId: entry.descriptor.sessionId, state: 'failed', recoveredTabIds: [], lostTabIds, policyViolations: [] });
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
						const info = liveTargets.get(record.targetId);
						if (info === undefined) {
							this.markTabLost(entry, tab, report);
							continue;
						}
						try {
							const handle = await this.host.attachTab(record.targetId);
							tab.transport = handle.transport;
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

	private markTabLost(entry: SessionEntry, tab: LiveTab, report: RecoverySessionReportDraft): void {
		tab.recorder.detach();
		entry.live.delete(tab.record.tabId);
		tab.record.state = 'lost';
		tab.record.error = { code: 'flauz.browser.tab.lost', message: 'target gone after transport drop', at: isoAt(this.clock) };
		report.lostTabIds.push(tab.record.tabId);
	}

	// #endregion

	/** Closes every session and the host (deactivate/dispose surface). */
	async dispose(): Promise<void> {
		for (const sessionId of [...this.entries.keys()]) {
			await this.close(sessionId);
		}
		await this.host.close();
	}
}
