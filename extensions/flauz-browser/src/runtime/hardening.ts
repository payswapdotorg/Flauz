/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Per-session hardening applied to every tab the runtime activates
 * (TL3-002, items 3.1 + 3.2). FAIL-CLOSED: any command failure fails the
 * tab/session activation with a typed error -- never a silently unhardened
 * session.
 *
 *  3.1 User-agent discipline (distinguishable agent sessions): agent-initiator
 *      sessions override the user agent via `Emulation.setUserAgentOverride`
 *      with the browser's own UA plus the appended product token
 *      `FlauzAgent/<v>` (the base UA is read live from the target via
 *      `Runtime.evaluate navigator.userAgent`, so the override is the real
 *      browser identity + the Flauz agent token -- deterministic for a given
 *      target). HUMAN sessions are NEVER sent the override command: they keep
 *      the browser default (pinned both directions by tests).
 *
 *  3.2 Download policy (deny by default): every session -- human AND agent --
 *      sets `Browser.setDownloadBehavior {behavior:'deny'}` on open, scoped to
 *      the session's tabs. v0 has NO allow surface: an allow surface would be
 *      a future policy decision (documented in README), NOT implemented here.
 */

import type { CdpTransport } from '../cdp/transport.ts';
import type { BrowserSessionDescriptor } from './session.ts';

/** The Flauz agent product token appended to agent-session user agents. */
export const FLAUZ_AGENT_UA_PRODUCT = 'FlauzAgent';

/**
 * Version segment of the agent UA token. Tied to the runtime security surface
 * (the `flauz.browser-session/v0` family), not the package version: UA tokens
 * are long-lived observability contracts.
 */
export const FLAUZ_AGENT_UA_VERSION = '0';

/** The full product token: `FlauzAgent/0`. */
export const FLAUZ_AGENT_UA_TOKEN = `${FLAUZ_AGENT_UA_PRODUCT}/${FLAUZ_AGENT_UA_VERSION}`;

/** The download behavior every Flauz session enforces (v0: deny, no allow surface). */
export const FLAUZ_DOWNLOAD_BEHAVIOR = 'deny' as const;

/** Typed hardening error (fail-closed session-error taxonomy). */
export class BrowserHardeningError extends Error {
	readonly step: 'download-policy' | 'user-agent';
	constructor(step: 'download-policy' | 'user-agent', message: string) {
		super(message);
		this.name = 'BrowserHardeningError';
		this.step = step;
	}
}

/** What one hardening pass applied (audit shape; surfaced in tests via the sent-command log). */
export interface SessionHardeningReport {
	/** Always 'deny' (3.2; v0 has no allow surface). */
	readonly downloadBehavior: typeof FLAUZ_DOWNLOAD_BEHAVIOR;
	/** The UA override applied (agent sessions only; undefined for human sessions). */
	readonly userAgentOverride: string | undefined;
}

/**
 * Derives the agent-session user agent: the browser's own UA with the
 * `FlauzAgent/<v>` product token appended (deterministic function of the
 * target's base UA; no workspace/agent identity is embedded -- the partition
 * never leaks into a request header).
 */
export function flauzAgentUserAgent(baseUserAgent: string): string {
	const trimmed = baseUserAgent.trim();
	if (trimmed === '') {
		return FLAUZ_AGENT_UA_TOKEN;
	}
	return `${trimmed} ${FLAUZ_AGENT_UA_TOKEN}`;
}

/** True when a UA string carries the Flauz agent token (machine-checkable distinguishability). */
export function isFlauzAgentUserAgent(userAgent: string): boolean {
	return userAgent.split(' ').includes(FLAUZ_AGENT_UA_TOKEN);
}

/** Reads the target's current user agent via `Runtime.evaluate navigator.userAgent`. */
async function queryBaseUserAgent(transport: CdpTransport): Promise<string> {
	let response: { result?: { type?: string; value?: unknown } };
	try {
		response = await transport.send<{ result?: { type?: string; value?: unknown } }>('Runtime.evaluate', { expression: 'navigator.userAgent', returnByValue: true });
	} catch (err) {
		throw new BrowserHardeningError('user-agent', `reading the base user agent failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	const value = response.result?.value;
	if (typeof value !== 'string' || value === '') {
		throw new BrowserHardeningError('user-agent', `the target did not return a usable navigator.userAgent (got ${JSON.stringify(value)})`);
	}
	return value;
}

/**
 * Applies the per-session hardening to one tab transport. Callers wrap this in
 * the fail-closed activation path: a thrown {@link BrowserHardeningError}
 * fails the session/tab activation (never a half-hardened open).
 */
export async function applySessionHardening(transport: CdpTransport, descriptor: BrowserSessionDescriptor): Promise<SessionHardeningReport> {
	// 3.2: downloads denied for EVERY session (human + agent), fail-closed.
	try {
		await transport.send('Browser.setDownloadBehavior', { behavior: FLAUZ_DOWNLOAD_BEHAVIOR });
	} catch (err) {
		throw new BrowserHardeningError('download-policy', `Browser.setDownloadBehavior {behavior:'${FLAUZ_DOWNLOAD_BEHAVIOR}'} failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	// 3.1: agent sessions only. Human sessions are never sent the override
	// (pinned by tests: zero Emulation.setUserAgentOverride commands on the
	// human path).
	if (descriptor.initiator !== 'agent') {
		return { downloadBehavior: FLAUZ_DOWNLOAD_BEHAVIOR, userAgentOverride: undefined };
	}
	const base = await queryBaseUserAgent(transport);
	const userAgent = flauzAgentUserAgent(base);
	try {
		await transport.send('Emulation.setUserAgentOverride', { userAgent });
	} catch (err) {
		throw new BrowserHardeningError('user-agent', `Emulation.setUserAgentOverride failed: ${err instanceof Error ? err.message : String(err)}`);
	}
	return { downloadBehavior: FLAUZ_DOWNLOAD_BEHAVIOR, userAgentOverride: userAgent };
}
