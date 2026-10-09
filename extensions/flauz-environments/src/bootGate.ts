/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The activation bootstrap gate (the C-ENV CI bootstrap-race root-cause repair).
 *
 * activate() fires the workspace bootstrap (registry + lifecycle managers)
 * DETACHED so activation returns immediately; a registry-dependent command or
 * a remote window resolving a flauz-env authority can therefore arrive while
 * the bootstrap is still in flight. Before this gate those callers failed
 * with the misleading 'no workspace folder or failed bootstrap' error even
 * though the bootstrap was about to succeed -- the C-ENV CI flake family
 * (PRs #172/#176: the registry-inactive mode; PR #171: the slow-boot sibling
 * mode, cured by the report-timeout headroom in flauz-environments.yml).
 *
 * Laws:
 *  - settled() resolves when the in-flight bootstrap (if any) has settled;
 *    it NEVER fabricates readiness -- callers re-read their own state after
 *    the wait and keep their fail-closed behavior when nothing booted or the
 *    boot failed;
 *  - a FAILED bootstrap also settles (the owner records the failure in its
 *    own error state; waiters see exactly the fail-closed world they would
 *    see without the wait);
 *  - run() returns the work's settle promise and never rejects (the owner's
 *    own try/catch is the error authority);
 *  - a second run while one is in flight REPLACES the tracked promise (the
 *    retry path); the earlier promise still settles its own waiters.
 */

export interface BootGate {
	/** Tracks one bootstrap run; the returned promise settles when the run settles. */
	run(work: () => Promise<void>): Promise<void>;
	/** Resolves once the tracked bootstrap (if any) has settled. */
	settled(): Promise<void>;
	/** True while a tracked bootstrap is in flight. */
	isRunning(): boolean;
}

export function createBootGate(): BootGate {
	let inFlight: Promise<void> | undefined;
	return {
		run(work) {
			const gate: Promise<void> = (async () => {
				await work();
			})().then(() => undefined, () => undefined).finally(() => {
				if (inFlight === gate) {
					inFlight = undefined;
				}
			});
			inFlight = gate;
			return gate;
		},
		settled() {
			const pending = inFlight;
			return pending !== undefined ? pending : Promise.resolve();
		},
		isRunning() {
			return inFlight !== undefined;
		},
	};
}
