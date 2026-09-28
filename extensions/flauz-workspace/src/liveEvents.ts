/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H2 -- live file events for the Flauz workspace trees (the promoted
 * TL4-002 follow-up; docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md section 14).
 *
 * The flauz.home / flauz.tasks surfaces previously refreshed only on
 * command. This module wires a REAL `vscode.workspace.createFileSystemWatcher`
 * over the workspace root's `.flauz/` state tree (tasks.json, the evidence
 * ledger, the peer artifacts Home summarizes) so task/evidence changes on
 * disk refresh the trees live.
 *
 * Contract (premium-UX law, docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md):
 *   - Refresh rides the EXISTING refresh() path -- the providers'
 *     onDidChangeTreeData fire and the tree re-queries getChildren. There is
 *     no parallel loading path; a failed re-read keeps the last-known-good
 *     rows below the unified error row exactly as a manual Refresh does
 *     (state templates, section 4). Nothing here fabricates state -- the tree
 *     always renders OBSERVED state (the sessionsView law from flauz-agent
 *     is the precedent).
 *   - Debounce: a burst of writes coalesces into ONE refresh
 *     (trailing-edge -- the refresh always reads post-burst state). The
 *     300ms interval cites the perceived-performance rules (section 8): a
 *     flauz.tasks/v0 save is a tmp-write + rename burst (2-3 inotify
 *     events), rows are plain data objects re-read asynchronously off the
 *     critical path ("cheap by construction", "never blocks the composer"),
 *     and 300ms stays below the ~1s instantaneous-perception threshold
 *     while the last-known-good rows cover the gap (never blank).
 *   - Guard: no workspace folder open -> no watcher is created (logged) --
 *     the same posture as the flauz-agent connect guard.
 *   - Disposal: the watcher, its three event subscriptions and any pending
 *     debounce timer all ride the returned disposables (pushed onto
 *     context.subscriptions by the activation wiring). No unbounded
 *     buffers: the only retained state is a single timer handle.
 */
import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import { FLAUZ_DIR } from './api.ts';

/**
 * Trailing-edge debounce window. Documented decision (premium spec section
 * 8): coalesces one flauz.tasks/v0 atomic save burst (tmp write + rename)
 * or one ledger append burst into a single tree refresh.
 */
export const LIVE_EVENTS_DEBOUNCE_MS = 300;

/** The watched surface: everything under the workspace root's `.flauz/` state tree. */
export const LIVE_EVENTS_WATCH_PATTERN = `${FLAUZ_DIR}/**`;

export interface LiveEventsOptions {
	/** Workspace root resolver; undefined means "no workspace folder open". */
	readonly getWorkspaceRoot: () => string | undefined;
	/**
	 * The EXISTING refresh path (the WorkspaceViews.refresh callback -- fires
	 * both providers' change events). This is the only reload path live
	 * events ever trigger.
	 */
	readonly refresh: () => void;
	/** Debounce window override (tests use small windows; default 300ms). */
	readonly debounceMs?: number;
	/** Optional activation log (the Flauz Workspace output channel). */
	readonly log?: (message: string) => void;
}

/** Registered live-events wiring + the disposables to push onto context.subscriptions. */
export interface LiveEventsWiring {
	readonly disposables: readonly vscode.Disposable[];
	/** True when a real watcher was created (workspace root present). */
	readonly watching: boolean;
}

/**
 * Subscribes the live file-events watcher over `.flauz/` and returns the
 * disposable wiring. When no workspace folder is open the watcher is NOT
 * created and the skip is logged (the flauz-agent connect-guard posture).
 */
export function registerLiveEvents(options: LiveEventsOptions): LiveEventsWiring {
	const api = vscodeApi();
	const root = options.getWorkspaceRoot();
	if (root === undefined) {
		options.log?.('flauz-workspace: no workspace folder open; live .flauz/ file events inactive (watcher not created)');
		return { disposables: [], watching: false };
	}
	const debounceMs = options.debounceMs ?? LIVE_EVENTS_DEBOUNCE_MS;
	// The watcher bases on the WORKSPACE ROOT (which always exists when a
	// folder is open) with the `.flauz/**` pattern, NOT on `.flauz/` itself:
	// the state directory may not exist yet at activation time (bootstrap
	// runs after), and a recursive watcher over a missing directory would
	// never fire. Over the root the globstar still scopes the events to the
	// `.flauz/` tree -- every path the trees render: tasks.json, the evidence
	// ledger, environments.json, browser-policy.json and the workflow index
	// -- and the real watcher service reuses the workspace-root recursive
	// watcher it already maintains, so no new OS watch tree is added.
	const watcher = api.workspace.createFileSystemWatcher(
		new api.RelativePattern(api.Uri.file(root), LIVE_EVENTS_WATCH_PATTERN),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	// Trailing-edge debounce: every change/create/delete event (re)arms one
	// timer; the refresh runs only after the burst settles, so it always
	// reads OBSERVED post-burst state.
	const schedule = (): void => {
		if (disposed) {
			return;
		}
		if (timer !== undefined) {
			clearTimeout(timer);
		}
		timer = setTimeout(() => {
			timer = undefined;
			options.refresh();
		}, debounceMs);
	};
	options.log?.(`flauz-workspace: live .flauz/ file events active (watching ${LIVE_EVENTS_WATCH_PATTERN} under the workspace root, debounce ${debounceMs}ms)`);
	const disposables: vscode.Disposable[] = [
		watcher,
		watcher.onDidChange(schedule),
		watcher.onDidCreate(schedule),
		watcher.onDidDelete(schedule),
		{
			dispose: () => {
				// Flip the guard FIRST so an event racing the disposal window
				// cannot re-arm the timer, then cancel any pending debounced
				// refresh -- a disposed wiring never fires another refresh.
				disposed = true;
				if (timer !== undefined) {
					clearTimeout(timer);
					timer = undefined;
				}
			},
		},
	];
	return {
		disposables,
		watching: true,
	};
}
