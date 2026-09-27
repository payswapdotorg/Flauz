/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The BrowserSessionDescriptor — ARCHITECTURE-LOCK section 5 contract family
 * member (schema `flauz.browser-session/v0`): the logical identity of a
 * Flauz-controlled browser session.
 *
 * `sessionId` is a LOGICAL id of the shape `flauz:browser:<16-hex>` — never a
 * URL, never a filesystem path, never a CDP target id. CDP target ids live on
 * the TAB records (`BrowserTabRecord.targetId`) and are reconciled against
 * transport drops; the session id survives reconnects and is the stable
 * handle for commands, evidence, and audit.
 *
 * Human vs agent separation is pinned at this layer: `initiator` is one of
 * 'human' | 'agent' and is carried on every policy consultation (mapped to
 * the engine's initiator classes: agent -> 'agent-tool' consults driver +
 * webRequest; human -> 'user' consults willNavigate + webRequest — the agent
 * allowlist NEVER gates humans; README "Semantics" item 3).
 */

import {
	type BrowserPolicyEngine,
	type Clock,
	type NavigationInitiator,
	serializePolicy,
	sha256Hex,
	WORKSPACE_HASH_LENGTH,
} from '../policy.ts';
import { randomBytes } from 'node:crypto';
import { toIsoStamp } from '../format.ts';

/** Schema id of the descriptor (the ARCHITECTURE-LOCK contract family name). */
export const BROWSER_SESSION_SCHEMA_ID = 'flauz.browser-session/v0';

/** The only schemaVersion this runtime understands (fail-closed on others). */
export const BROWSER_SESSION_SCHEMA_VERSION = 0;

/** Logical session id prefix: `flauz:browser:<16-hex>`. */
export const SESSION_ID_PREFIX = 'flauz:browser:';

/** Logical tab id prefix: `flauz:tab:<16-hex>`. */
export const TAB_ID_PREFIX = 'flauz:tab:';

export const SESSION_INITIATORS = ['human', 'agent'] as const;
export type SessionInitiator = (typeof SESSION_INITIATORS)[number];

export const BROWSER_SESSION_STATES = ['opening', 'active', 'suspended', 'closed', 'failed'] as const;
export type BrowserSessionState = (typeof BROWSER_SESSION_STATES)[number];

export const BROWSER_TAB_STATES = ['opening', 'active', 'suspended', 'closed', 'failed', 'lost'] as const;
export type BrowserTabState = (typeof BROWSER_TAB_STATES)[number];

/** A timestamped typed error record (session/tab failures; fail-closed surface). */
export interface BrowserSessionErrorRecord {
	readonly code: string;
	readonly message: string;
	readonly at: string;
}

/** One tab of a session: the logical record mirrors the CDP target lifecycle. */
export interface BrowserTabRecord {
	/** Logical tab id (`flauz:tab:<16-hex>`); stable across reconnects. */
	readonly tabId: string;
	/** The CDP target id (ephemeral; reconciled on recovery). */
	readonly targetId: string;
	/** Last known (committed) url. */
	url: string;
	state: BrowserTabState;
	readonly openedAt: string;
	closedAt?: string;
	error?: BrowserSessionErrorRecord;
	/** Set when this tab was replaced (e.g. wedged-tab recovery). */
	replacedByTabId?: string;
}

/**
 * The descriptor contract. `tabs` carries the per-tab records; everything
 * mutable (state/tabs/errors) is owned by the session manager and observed
 * externally via snapshots (deep clones).
 */
export interface BrowserSessionDescriptor {
	readonly schemaVersion: typeof BROWSER_SESSION_SCHEMA_VERSION;
	/** `flauz:browser:<16-hex>` — logical, never a URL or path. */
	readonly sessionId: string;
	readonly initiator: SessionInitiator;
	/** Present iff initiator is 'agent'. */
	readonly agentId?: string;
	/** The Flauz partition name (derivePartition: persist/memory scope, per-agent suffix). */
	readonly partition: string;
	/** Reference to the policy the session was opened under (see policySourceRefOf). */
	readonly policySourceRef: string;
	/** ISO timestamp. */
	readonly createdAt: string;
	state: BrowserSessionState;
	tabs: BrowserTabRecord[];
	error?: BrowserSessionErrorRecord;
}

const SESSION_ID_RE = /^flauz:browser:[0-9a-f]{16}$/;
const TAB_ID_RE = /^flauz:tab:[0-9a-f]{16}$/;

function randomHex16(): string {
	return randomBytes(8).toString('hex');
}

/** Mints a logical session id (`flauz:browser:<16-hex>`). */
export function mintSessionId(): string {
	return SESSION_ID_PREFIX + randomHex16();
}

/** Mints a logical tab id (`flauz:tab:<16-hex>`). */
export function mintTabId(): string {
	return TAB_ID_PREFIX + randomHex16();
}

export function isSessionId(value: string): boolean {
	return SESSION_ID_RE.test(value);
}

export function isTabId(value: string): boolean {
	return TAB_ID_RE.test(value);
}

/** Maps the descriptor's initiator class onto the engine's initiator enum. */
export function toEngineInitiator(initiator: SessionInitiator): NavigationInitiator {
	return initiator === 'agent' ? 'agent-tool' : 'user';
}

/**
 * Builds the `policySourceRef` recorded on the descriptor at open time:
 * `flauz:browser-policy/v0@<source>#<hash16>` where <hash16> is sha256 over
 * the serialized policy in effect — the audit handle for "which policy was
 * this session opened under" (live verdicts carry the CURRENT policy source;
 * recovery re-gates against the current engine, not this ref).
 */
export function policySourceRefOf(engine: BrowserPolicyEngine): string {
	const hash16 = sha256Hex(serializePolicy(engine.policyInEffect)).slice(0, WORKSPACE_HASH_LENGTH);
	return `flauz:browser-policy/v0@${engine.source}#${hash16}`;
}

/** ISO timestamp helper over the injectable clock — serialized through the shared module (PU6). */
export function isoAt(clock: Clock): string {
	return toIsoStamp(clock());

}

/** Deep-clones a descriptor (the externally observed snapshot). */
export function snapshotDescriptor(descriptor: BrowserSessionDescriptor): BrowserSessionDescriptor {
	return structuredClone(descriptor);
}
