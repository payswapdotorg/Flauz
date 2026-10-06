/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W7 (dogfood harness) -- EXERCISE 3: browser work (the
 * agent-with-tools lane, first leg: browser policy + session runtime).
 *
 * The scenario machinery drives the REAL browser seams over the REAL
 * FakeBrowserState fake CDP transport:
 *
 *   - a REAL BrowserPolicyEngine built from a fixture policy file
 *     (parsePolicyText -- flauz.browser-policy/v0), plus a SECOND engine
 *     built from a REJECTED policy text (resolvePolicyText -> the
 *     deny-all builtin default -- the policyFile failure class);
 *   - scripted navigations through the REAL tab pipeline
 *     (CdpEndpointHost -> FakeCdpTransport -> activateLiveTab ->
 *     runNavigation), one per layer class: allow (n1), driver deny (n2),
 *     webRequest deny (n3), willNavigate deny (n4), partition deny (n5,
 *     a session descriptor whose partition is derived from a DIFFERENT
 *     workspace root -- containment fails), policyFile deny (n6, the
 *     rejected-file deny-all default), and an allowed navigation with a
 *     secret-shaped query param (n7 -- the journal record carries the
 *     at-record redacted urlRedaction form);
 *   - a mid-session transport drop + recovery drill (the live transport
 *     closed, a fresh transport re-attached to the SAME shared
 *     FakeBrowserState -- the recovery posture the options document:
 *     "Share browser state across connections (recovery drills)");
 *   - a screenshot capture command through the real transport.
 *
 * THE ASK (P2-FIX-119 doctrine): the exercise carries the browser-session
 * facts IN the prompt (computed at ask time from the same real state --
 * engine verdicts, the FakeBrowserState.sentCommands record, the journal
 * rows) and asks the model to report the session's outcome map faithfully.
 * BOTH lanes answer from the prompt-carried facts.
 *
 * THE INDEPENDENT VERIFIER (the dogfood law): deriveBrowserPolicyGroundTruth
 * re-derives the ground truth from the primitives -- a fresh engine.evaluate
 * per scripted target, a scan of state.sentCommands for Page.navigate
 * commands, and a read of the journal records -- and verifyBrowserPolicyAnswer
 * checks the model's answer 100% (every claimed entry re-verified = sound;
 * every ground-truth entry claimed = complete). PASS only at 100%.
 *
 * Evidence label: SIMULATED (the fake CDP transport) -- stated in the
 * receipt notes, never promoted by wording.
 *
 * Dogfood dimensions exercised: browser work, policy layering, failure/
 * recovery (drop/re-attach), artifacts/evidence, URL redaction.
 */

import * as nodeFs from 'node:fs/promises';
import * as nodePath from 'node:path';
import { sha256Hex } from '../../../../extensions/flauz-workspace/src/api.ts';
import { fenceTolerantParseBody, type AnswerParseOptions } from '../answerFence.ts';
import { answerParseFailDetail } from '../liveBudget.mjs';
import type { DogfoodExercise, DogfoodHarness, ExerciseCheck, ExerciseReceipt, EvidenceItem, AskOutcome } from '../harnessTypes.ts';

import {
	BrowserPolicyEngine,
	parsePolicyText,
	resolvePolicyText,
	serializePolicy,
	derivePartition,
	type Clock,
} from '../../../../extensions/flauz-browser/src/policy.ts';
import { FakeBrowserState, FakeCdpTransport, type FakeSentCommand } from '../../../../extensions/flauz-browser/src/cdp/fake.ts';
import { redactSecretShapedQueryValues } from '../../../../extensions/flauz-browser/src/runtime/urlRedaction.ts';
import { CdpEndpointHost } from '../../../../extensions/flauz-browser/src/runtime/host.ts';
import { activateLiveTab, runNavigation, type LiveTab, type NavigationOutcome, type TabPipelineDeps } from '../../../../extensions/flauz-browser/src/runtime/tabs.ts';
import { buildSessionJournalRecord, InMemorySessionJournal, type SessionJournalRecord } from '../../../../extensions/flauz-browser/src/runtime/journal.ts';
import { isoAt, policySourceRefOf, type BrowserSessionDescriptor, type SessionInitiator } from '../../../../extensions/flauz-browser/src/runtime/session.ts';

/** The answer document's pinned schema id. */
export const BROWSER_POLICY_ANSWER_SCHEMA = 'flauz.dogfood-browser-policy-answer/v1';

// ---------------------------------------------------------------------------
// The fixture policy + the scripted scenario (deterministic: fixed ids, injected clock)
// ---------------------------------------------------------------------------

/** The fixture workspace policy (flauz.browser-policy/v0) the scenario runs under. */
export const FIXTURE_POLICY_TEXT = `${JSON.stringify({
	schemaVersion: 0,
	driver: { enabled: true, allow: ['*.example.com', '*.example.org', 'example.org'], deny: ['blocked-driver.example.com'], fileRoots: [] },
	webRequest: { enabled: true, allow: ['*.example.com', 'example.org'], deny: ['blocked-webreq.example.org'] },
	willNavigate: { enabled: true, allow: ['*.example.com', 'example.org'], deny: ['blocked-nav.example.com'] },
	partitions: { scope: 'persist', perAgent: false },
	security: { enforceReset: true },
}, null, 2)}\n`;

/** A REJECTED policy text (the policyFile failure class: the deny-all builtin default). */
export const REJECTED_POLICY_TEXT = `{"schemaVersion": 0, "driver": {}}`;

/** The fixed, deterministic session/tab ids (16-hex, mintSessionId-shaped; no Date.now/Math.random here). */
export const FIXTURE_SESSION_ID = 'flauz:browser:0123456789abcdef';
export const FIXTURE_AGENT_ID = 'w7-dogfood';

/** One scripted navigation: which engine evaluates it, which partition the session claims, which initiator path fires. */
export interface ScriptedNavigation {
	readonly id: string;
	readonly url: string;
	readonly engineId: 'primary' | 'rejected-policy-file';
	/** 'matching' = derived from the scenario workspace root; 'foreign' = a different root (partition containment fails). */
	readonly partition: 'matching' | 'foreign';
	/**
	 * The firing path (the B1c model, policy.ts applicableLayers): 'agent-tool'
	 * navigations run through the tab pipeline (driver + webRequest gates);
	 * 'user' navigations are the USER path (willNavigate + webRequest) —
	 * evaluated directly by the engine, NEVER executed through the agent
	 * pipeline (no tab, no Page.navigate, no journal row: the honest
	 * user-path drill).
	 */
	readonly initiator: 'agent-tool' | 'user';
}

/** The approved W7 scenario matrix (n1..n7), verbatim. */
export const SCRIPTED_NAVIGATIONS: readonly ScriptedNavigation[] = [
	{ id: 'n1', url: 'https://ok.example.com/page', engineId: 'primary', partition: 'matching', initiator: 'agent-tool' },
	{ id: 'n2', url: 'https://blocked-driver.example.com/x', engineId: 'primary', partition: 'matching', initiator: 'agent-tool' },
	{ id: 'n3', url: 'https://blocked-webreq.example.org/y', engineId: 'primary', partition: 'matching', initiator: 'agent-tool' },
	{ id: 'n4', url: 'https://blocked-nav.example.com/z', engineId: 'primary', partition: 'matching', initiator: 'user' },
	{ id: 'n5', url: 'https://ok.example.com/partitioned', engineId: 'primary', partition: 'foreign', initiator: 'agent-tool' },
	{ id: 'n6', url: 'https://ok.example.com/after-rejected-policy', engineId: 'rejected-policy-file', partition: 'matching', initiator: 'agent-tool' },
	{ id: 'n7', url: 'https://ok.example.com/secret?token=sk-live-abcdefghijklmnop&x=1', engineId: 'primary', partition: 'matching' , initiator: 'agent-tool' },
];

/** The scripted re-attach navigation (the recovery drill's proof). */
export const REATTACH_URL = 'https://ok.example.com/after-reattach';

// ---------------------------------------------------------------------------
// The answer contract (checked, never trusted)
// ---------------------------------------------------------------------------

export interface BrowserPolicyAnswerNavigation {
	readonly id: string;
	readonly targetUrl: string;
	readonly verdict: 'allow' | 'deny';
	readonly decidingLayer: string;
	readonly navigateCommandReachedTransport: boolean;
	readonly committedUrl?: string;
	readonly journalRequestedUrl: string;
	readonly journalSent: boolean;
}

export interface BrowserPolicyAnswer {
	readonly schema: string;
	readonly navigations: readonly BrowserPolicyAnswerNavigation[];
	readonly dropRecovery: {
		readonly journalRowsBeforeDrop: number;
		readonly journalRowsAfterReattach: number;
		readonly reattachedNavigation: {
			readonly targetUrl: string;
			readonly verdict: 'allow' | 'deny';
			readonly navigateCommandReachedTransport: boolean;
		};
	};
}

export type ParseBrowserPolicyOutcome =
	| { readonly ok: true; readonly answer: BrowserPolicyAnswer; readonly fenceStripped: boolean }
	| { readonly ok: false; readonly error: string };

/** Parses the browser-policy answer document (fence-tolerant on the LIVE lanes, per P2-FIX-118). */
export function parseBrowserPolicyAnswer(text: string, options?: AnswerParseOptions): ParseBrowserPolicyOutcome {
	const strip = fenceTolerantParseBody(text, options);
	let parsed: unknown;
	try {
		parsed = JSON.parse(strip.body);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return { ok: false, error: strip.fenced ? `the completion is not valid JSON inside the stripped markdown fence: ${reason}` : `the completion is not valid JSON: ${reason}` };
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		return { ok: false, error: 'the answer document is not a JSON object' };
	}
	const record = parsed as Record<string, unknown>;
	if (record.schema !== BROWSER_POLICY_ANSWER_SCHEMA) {
		return { ok: false, error: `the answer schema is ${JSON.stringify(record.schema)} but ${JSON.stringify(BROWSER_POLICY_ANSWER_SCHEMA)} was expected` };
	}
	if (!Array.isArray(record.navigations)) {
		return { ok: false, error: 'the answer field "navigations" must be an array' };
	}
	const navigations: BrowserPolicyAnswerNavigation[] = [];
	for (const entry of record.navigations) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			return { ok: false, error: 'each navigations entry must be a JSON object' };
		}
		const nav = entry as Record<string, unknown>;
		if (typeof nav.id !== 'string' || typeof nav.targetUrl !== 'string') {
			return { ok: false, error: 'a navigations entry is missing a string "id"/"targetUrl"' };
		}
		if (nav.verdict !== 'allow' && nav.verdict !== 'deny') {
			return { ok: false, error: `navigations entry ${nav.id}: "verdict" must be "allow" or "deny" (got ${JSON.stringify(nav.verdict)})` };
		}
		if (typeof nav.decidingLayer !== 'string' || nav.decidingLayer.length === 0) {
			return { ok: false, error: `navigations entry ${nav.id}: "decidingLayer" must be a non-empty string` };
		}
		if (typeof nav.navigateCommandReachedTransport !== 'boolean') {
			return { ok: false, error: `navigations entry ${nav.id}: "navigateCommandReachedTransport" must be a boolean` };
		}
		if (nav.committedUrl !== undefined && typeof nav.committedUrl !== 'string') {
			return { ok: false, error: `navigations entry ${nav.id}: "committedUrl", when present, must be a string` };
		}
		if (typeof nav.journalRequestedUrl !== 'string' || typeof nav.journalSent !== 'boolean') {
			return { ok: false, error: `navigations entry ${nav.id}: "journalRequestedUrl" (string) and "journalSent" (boolean) are required` };
		}
		navigations.push({
			id: nav.id,
			targetUrl: nav.targetUrl,
			verdict: nav.verdict,
			decidingLayer: nav.decidingLayer,
			navigateCommandReachedTransport: nav.navigateCommandReachedTransport,
			...(nav.committedUrl === undefined ? {} : { committedUrl: nav.committedUrl }),
			journalRequestedUrl: nav.journalRequestedUrl,
			journalSent: nav.journalSent,
		});
	}
	const drop = record.dropRecovery;
	if (drop === null || typeof drop !== 'object' || Array.isArray(drop)) {
		return { ok: false, error: 'the answer field "dropRecovery" must be a JSON object' };
	}
	const d = drop as Record<string, unknown>;
	if (typeof d.journalRowsBeforeDrop !== 'number' || !Number.isInteger(d.journalRowsBeforeDrop) || d.journalRowsBeforeDrop < 0) {
		return { ok: false, error: 'the answer field "dropRecovery.journalRowsBeforeDrop" must be a non-negative integer' };
	}
	if (typeof d.journalRowsAfterReattach !== 'number' || !Number.isInteger(d.journalRowsAfterReattach) || d.journalRowsAfterReattach < 0) {
		return { ok: false, error: 'the answer field "dropRecovery.journalRowsAfterReattach" must be a non-negative integer' };
	}
	const rn = d.reattachedNavigation;
	if (rn === null || typeof rn !== 'object' || Array.isArray(typeof rn === 'object' ? rn : null)) {
		return { ok: false, error: 'the answer field "dropRecovery.reattachedNavigation" must be a JSON object' };
	}
	const r = (rn ?? {}) as Record<string, unknown>;
	if (typeof r.targetUrl !== 'string' || (r.verdict !== 'allow' && r.verdict !== 'deny') || typeof r.navigateCommandReachedTransport !== 'boolean') {
		return { ok: false, error: 'the answer field "dropRecovery.reattachedNavigation" must carry { targetUrl, verdict, navigateCommandReachedTransport }' };
	}
	return {
		ok: true,
		answer: {
			schema: BROWSER_POLICY_ANSWER_SCHEMA,
			navigations,
			dropRecovery: {
				journalRowsBeforeDrop: d.journalRowsBeforeDrop as number,
				journalRowsAfterReattach: d.journalRowsAfterReattach as number,
				reattachedNavigation: {
					targetUrl: r.targetUrl as string,
					verdict: r.verdict as 'allow' | 'deny',
					navigateCommandReachedTransport: r.navigateCommandReachedTransport as boolean,
				},
			},
		},
		fenceStripped: strip.fenced,
	};
}

// ---------------------------------------------------------------------------
// The INDEPENDENT ground-truth derivation (driver-side, from the primitives)
// ---------------------------------------------------------------------------

export interface GroundTruthNavigation {
	readonly id: string;
	readonly targetUrl: string;
	readonly verdict: 'allow' | 'deny';
	readonly decidingLayer: string;
	readonly navigateCommandReachedTransport: boolean;
	readonly committedUrl: string | null;
	readonly journalRequestedUrl: string;
	readonly journalSent: boolean;
	readonly journalRowPresent: boolean;
}

export interface GroundTruth {
	readonly navigations: readonly GroundTruthNavigation[];
	readonly dropRecovery: {
		readonly journalRowsBeforeDrop: number;
		readonly journalRowsAfterReattach: number;
		readonly preDropRowsSurvived: boolean;
		readonly reattachedNavigation: {
			readonly targetUrl: string;
			readonly verdict: 'allow' | 'deny';
			readonly navigateCommandReachedTransport: boolean;
		};
	};
}

export interface GroundTruthDeps {
	/** The engines, re-evaluated HERE (never the scenario's cached verdicts). */
	readonly engines: Readonly<Record<'primary' | 'rejected-policy-file', BrowserPolicyEngine>>;
	readonly workspaceRoot: string;
	readonly matchingPartition: string;
	readonly foreignPartition: string;
	readonly sentCommands: readonly FakeSentCommand[];
	readonly journalRecords: readonly SessionJournalRecord[];
	/** The journal row count frozen at drop time (the drill's checkpoint). */
	readonly journalRowsBeforeDrop: number;
}

function pageNavigateReached(sentCommands: readonly FakeSentCommand[], url: string): boolean {
	return sentCommands.some(command => command.method === 'Page.navigate' && command.params !== null && typeof command.params === 'object' && (command.params as Record<string, unknown>).url === url);
}

/**
 * Re-derives the full ground truth from the primitives: a FRESH
 * engine.evaluate per scripted target, a scan of the fake transport's
 * sentCommands record for Page.navigate commands, and a read of the
 * journal records (order-matched to the script). Nothing here consults
 * the scenario's cached outcomes, the prompt, or the ask lane.
 */
export function deriveBrowserPolicyGroundTruth(deps: GroundTruthDeps): GroundTruth {
	const navigatedRows = deps.journalRecords.filter(row => row.event === 'navigated');
	const navigations: GroundTruthNavigation[] = SCRIPTED_NAVIGATIONS.map(script => {
		const engine = deps.engines[script.engineId];
		const evaluation = engine.evaluate({
			url: script.url,
			initiator: script.initiator,
			partition: script.partition === 'matching' ? deps.matchingPartition : deps.foreignPartition,
			workspaceRoot: deps.workspaceRoot,
		});
		const verdict = evaluation.final;
		// by REQUESTED URL, raw OR at-record-redacted (the user-path script
		// produces no row; n7's row carries the redacted form)
		const acceptableUrls = new Set([script.url, redactSecretShapedQueryValues(script.url)]);
		const journalRow = navigatedRows.find(row => row.navigation?.requestedUrl !== undefined && acceptableUrls.has(row.navigation.requestedUrl));
		return {
			id: script.id,
			targetUrl: script.url,
			verdict: verdict.decision,
			decidingLayer: verdict.layer,
			navigateCommandReachedTransport: pageNavigateReached(deps.sentCommands, script.url),
			committedUrl: journalRow?.navigation?.committedUrl ?? null,
			journalRequestedUrl: journalRow?.navigation?.requestedUrl ?? '',
			journalSent: journalRow?.navigation?.sent ?? false,
			journalRowPresent: journalRow !== undefined,
		};
	});
	const reattachRow = navigatedRows.find(row => row.navigation?.requestedUrl === REATTACH_URL);
	return {
		navigations,
		dropRecovery: {
			journalRowsBeforeDrop: deps.journalRowsBeforeDrop,
			journalRowsAfterReattach: deps.journalRecords.length,
			preDropRowsSurvived: deps.journalRowsBeforeDrop <= deps.journalRecords.length && deps.journalRecords.slice(0, deps.journalRowsBeforeDrop).every(row => navigatedRows.includes(row) || row.event !== 'navigated'),
			reattachedNavigation: reattachRow === undefined
				? { targetUrl: REATTACH_URL, verdict: 'deny', navigateCommandReachedTransport: false }
				: {
					targetUrl: REATTACH_URL,
					verdict: (reattachRow.navigation?.decision ?? 'deny') as 'allow' | 'deny',
					navigateCommandReachedTransport: pageNavigateReached(deps.sentCommands, REATTACH_URL),
				},
		},
	};
}

export type VerificationOutcome = { readonly ok: boolean; readonly problems: readonly string[]; readonly soundnessViolations: number; readonly completenessViolations: number };

/**
 * Checks the model's answer against the derived ground truth, 100%:
 * soundness = every claimed entry matches ground truth; completeness =
 * every ground-truth entry is claimed. PASS only when both are 100%.
 */
export function verifyBrowserPolicyAnswer(answer: BrowserPolicyAnswer, groundTruth: GroundTruth): VerificationOutcome {
	const problems: string[] = [];
	let soundnessViolations = 0;
	let completenessViolations = 0;
	if (answer.navigations.length !== groundTruth.navigations.length) {
		completenessViolations += 1;
		problems.push(`navigations: claimed ${String(answer.navigations.length)} entries but the ground truth carries ${String(groundTruth.navigations.length)}`);
	}
	for (const truth of groundTruth.navigations) {
		const claimed = answer.navigations.find(entry => entry.id === truth.id);
		if (claimed === undefined) {
			completenessViolations += 1;
			problems.push(`navigations ${truth.id}: MISSING from the answer (ground truth: ${truth.verdict}/${truth.decidingLayer})`);
			continue;
		}
		if (claimed.targetUrl !== truth.targetUrl) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: targetUrl claimed ${JSON.stringify(claimed.targetUrl)} but the script says ${JSON.stringify(truth.targetUrl)}`);
		}
		if (claimed.verdict !== truth.verdict) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: verdict claimed ${claimed.verdict} but the policy engine re-derives ${truth.verdict}`);
		}
		if (claimed.decidingLayer !== truth.decidingLayer) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: decidingLayer claimed ${JSON.stringify(claimed.decidingLayer)} but the engine re-derives ${JSON.stringify(truth.decidingLayer)}`);
		}
		if (claimed.navigateCommandReachedTransport !== truth.navigateCommandReachedTransport) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: navigateCommandReachedTransport claimed ${String(claimed.navigateCommandReachedTransport)} but the sentCommands record says ${String(truth.navigateCommandReachedTransport)}`);
		}
		const claimedCommitted = claimed.committedUrl ?? null;
		if (claimedCommitted !== truth.committedUrl) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: committedUrl claimed ${JSON.stringify(claimedCommitted)} but the journal row says ${JSON.stringify(truth.committedUrl)}`);
		}
		if (claimed.journalRequestedUrl !== truth.journalRequestedUrl) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: journalRequestedUrl claimed ${JSON.stringify(claimed.journalRequestedUrl)} but the journal row carries ${JSON.stringify(truth.journalRequestedUrl)}`);
		}
		if (claimed.journalSent !== truth.journalSent) {
			soundnessViolations += 1;
			problems.push(`navigations ${truth.id}: journalSent claimed ${String(claimed.journalSent)} but the journal row says ${String(truth.journalSent)}`);
		}
	}
	for (const claimed of answer.navigations) {
		if (!groundTruth.navigations.some(truth => truth.id === claimed.id)) {
			soundnessViolations += 1;
			problems.push(`navigations ${claimed.id}: FABRICATED entry (no such scripted navigation)`);
		}
	}
	const dr = answer.dropRecovery;
	const gtd = groundTruth.dropRecovery;
	if (dr.journalRowsBeforeDrop !== gtd.journalRowsBeforeDrop) {
		soundnessViolations += 1;
		problems.push(`dropRecovery.journalRowsBeforeDrop claimed ${String(dr.journalRowsBeforeDrop)} but the journal checkpoint says ${String(gtd.journalRowsBeforeDrop)}`);
	}
	if (dr.journalRowsAfterReattach !== gtd.journalRowsAfterReattach) {
		soundnessViolations += 1;
		problems.push(`dropRecovery.journalRowsAfterReattach claimed ${String(dr.journalRowsAfterReattach)} but the journal carries ${String(gtd.journalRowsAfterReattach)}`);
	}
	if (dr.reattachedNavigation.targetUrl !== gtd.reattachedNavigation.targetUrl
		|| dr.reattachedNavigation.verdict !== gtd.reattachedNavigation.verdict
		|| dr.reattachedNavigation.navigateCommandReachedTransport !== gtd.reattachedNavigation.navigateCommandReachedTransport) {
		soundnessViolations += 1;
		problems.push(`dropRecovery.reattachedNavigation claimed ${JSON.stringify(dr.reattachedNavigation)} but the ground truth says ${JSON.stringify(gtd.reattachedNavigation)}`);
	}
	return { ok: problems.length === 0, problems, soundnessViolations, completenessViolations };
}

/** THE LAW (checked, not trusted): a denied navigation must NEVER produce a Page.navigate command. */
export function denyNeverNavigatesLaw(sentCommands: readonly FakeSentCommand[], deniedUrls: readonly string[]): { readonly ok: boolean; readonly violations: readonly string[] } {
	const violations: string[] = [];
	for (const url of deniedUrls) {
		if (pageNavigateReached(sentCommands, url)) {
			violations.push(`a Page.navigate command reached the transport for the DENIED target ${url}`);
		}
	}
	return { ok: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// The prompt (P2-FIX-119: the browser-session facts carried IN the ask, at ask time)
// ---------------------------------------------------------------------------

export const BROWSER_POLICY_FACTS_BEGIN = '=== BROWSER-SESSION FACT: the scripted outcome map, computed at ask time from the real state (policy engine verdicts + the CDP sentCommands record + the session journal) ===';
export const BROWSER_POLICY_FACTS_END = '=== END browser-session facts ===';

/** The reportable view of the ground truth (exactly the answer shape; the prompt embeds it verbatim). */
export function reportableView(groundTruth: GroundTruth): BrowserPolicyAnswer {
	return {
		schema: BROWSER_POLICY_ANSWER_SCHEMA,
		navigations: groundTruth.navigations.map(nav => ({
			id: nav.id,
			targetUrl: nav.targetUrl,
			verdict: nav.verdict,
			decidingLayer: nav.decidingLayer,
			navigateCommandReachedTransport: nav.navigateCommandReachedTransport,
			...(nav.committedUrl === null ? {} : { committedUrl: nav.committedUrl }),
			journalRequestedUrl: nav.journalRequestedUrl,
			journalSent: nav.journalSent,
		})),
		dropRecovery: {
			journalRowsBeforeDrop: groundTruth.dropRecovery.journalRowsBeforeDrop,
			journalRowsAfterReattach: groundTruth.dropRecovery.journalRowsAfterReattach,
			reattachedNavigation: groundTruth.dropRecovery.reattachedNavigation,
		},
	};
}

/**
 * Builds the full browser-policy question with the session facts embedded.
 * Called AT ASK TIME (inside the ask window). The excerpt doctrine
 * (P2-FIX-122 pattern): when the full ground-truth JSON exceeds the
 * live lane's budget, an EXCERPT is embedded and the scoped-100% bar
 * applies; the excerpt's sha256 is pinned in the receipt either way.
 */
export function buildBrowserPolicyQuestion(groundTruth: GroundTruth, options?: { readonly excerptMaxChars?: number }): { readonly prompt: string; readonly excerpted: boolean; readonly groundTruthSha256: string } {
	const full = JSON.stringify(reportableView(groundTruth), null, 2);
	const groundTruthSha256 = sha256Hex(full);
	const budget = options?.excerptMaxChars ?? Number.MAX_SAFE_INTEGER;
	const body = full.length <= budget
		? full
		: `${JSON.stringify(reportableView(groundTruth).navigations.slice(0, 3), null, 2)}\n(excerpt: the full outcome map exceeds the prompt budget; report ONLY the entries above -- the excerpt carries ${String(3)} of ${String(groundTruth.navigations.length)} navigations)`;
	const excerpted = full.length > budget;
	const prompt = [
		'Report the browser session\'s outcome map for the scripted navigation scenario that just ran under the real Flauz browser policy runtime (a fake CDP transport: simulated evidence).',
		'You are a bare chat completion with NO tool or file access, so the session facts are embedded below, computed at ask time from the real state (the policy engine verdicts, the CDP sentCommands record, the session journal rows).',
		'',
		BROWSER_POLICY_FACTS_BEGIN,
		body,
		BROWSER_POLICY_FACTS_END,
		'',
		`Report the facts above faithfully. Answer with exactly one JSON document of shape { "schema": "${BROWSER_POLICY_ANSWER_SCHEMA}", "navigations": [{ "id": "n1", "targetUrl": "...", "verdict": "allow"|"deny", "decidingLayer": "...", "navigateCommandReachedTransport": true|false, "committedUrl": "..." (allow only), "journalRequestedUrl": "...", "journalSent": true|false }], "dropRecovery": { "journalRowsBeforeDrop": N, "journalRowsAfterReattach": N, "reattachedNavigation": { "targetUrl": "...", "verdict": "allow"|"deny", "navigateCommandReachedTransport": true|false } } } and nothing else.`,
		excerpted ? 'The embedded facts are an EXCERPT: report only the excerpt\'s entries; the verification bar is scoped to the excerpt.' : '',
	]
		.filter(line => line !== '')
		.join('\n');
	return { prompt, excerpted, groundTruthSha256 };
}

// ---------------------------------------------------------------------------
// The exercise
// ---------------------------------------------------------------------------

class Recorder {
	readonly checks: ExerciseCheck[] = [];

	check(id: string, ok: boolean, detail: string): boolean {
		this.checks.push({ id, ok, detail });
		return ok;
	}
}

async function mintArtifact(harness: DogfoodHarness, uri: string, contents: string, note: string): Promise<{ item: EvidenceItem; evidenceId: string }> {
	const absolute = nodePath.join(harness.root, uri);
	await nodeFs.mkdir(nodePath.dirname(absolute), { recursive: true });
	await nodeFs.writeFile(absolute, contents, { encoding: 'utf-8' });
	const sha = sha256Hex(contents);
	const appended = await harness.ledger.append(harness.taskId, { kind: 'note', uri, sha256: sha, note });
	await harness.tasks.recordEvidence(harness.taskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri, sha256: sha, note });
	return { item: { kind: 'note', uri, sha256: sha }, evidenceId: appended.evidenceId };
}

function fixtureDescriptor(partition: string, engine: BrowserPolicyEngine, clock: Clock, initiator: SessionInitiator): BrowserSessionDescriptor {
	return {
		schemaVersion: 0,
		sessionId: FIXTURE_SESSION_ID,
		initiator,
		agentId: initiator === 'agent' ? FIXTURE_AGENT_ID : undefined,
		partition,
		policySourceRef: policySourceRefOf(engine),
		createdAt: isoAt(clock),
		state: 'active',
		tabs: [],
	};
}

export const BROWSER_POLICY_EXERCISE: DogfoodExercise = {
	id: 'browser-policy',
	title: 'browser work: layered policy verdicts, deny-never-navigates, drop/recovery over the fake CDP transport',
	prompt: 'Report the browser session\'s outcome map (verdict + deciding layer per navigation, whether Page.navigate reached the transport, journal/capture rows, and the drop/recovery outcome).',
	dimensions: ['browser work', 'policy layering', 'failure/recovery', 'artifacts/evidence', 'url redaction'],
	async run(harness: DogfoodHarness): Promise<ExerciseReceipt> {
		const recorder = new Recorder();
		const evidenceIds: string[] = [];
		const evidenceItems: EvidenceItem[] = [];
		const notes: string[] = [];
		const clock: Clock = harness.clock;
		const commandTimeoutMs = 2_000;
		const navigationTimeoutMs = 2_000;

		// 1. The REAL policy engines: the fixture file + the rejected-file default.
		const fixturePolicy = parsePolicyText(FIXTURE_POLICY_TEXT).policy;
		const enginePrimary = new BrowserPolicyEngine({ policy: fixturePolicy, source: 'workspace-file', clock });
		const resolvedRejected = resolvePolicyText(REJECTED_POLICY_TEXT);
		const engineRejected = new BrowserPolicyEngine({ policy: resolvedRejected.policy, source: resolvedRejected.source, clock });
		const matchingPartition = derivePartition(harness.root, undefined, fixturePolicy.partitions);
		const foreignPartition = derivePartition(`${harness.root}/foreign-workspace`, undefined, fixturePolicy.partitions);

		// 2. The REAL fake browser: shared FakeBrowserState over the REAL host.
		const state = new FakeBrowserState();
		// sentCommands live on EACH transport (per connection) — the factory
		// collects every transport it mints so the ground truth can read them all.
		const transports: FakeCdpTransport[] = [];
		const transportFactory = () => {
			const transport = new FakeCdpTransport({ state, commandTimeoutMs });
			transports.push(transport);
			return transport;
		};
		const host = new CdpEndpointHost('fake://dogfood-browser', { transportFactory, commandTimeoutMs });
		await host.open();
		const handle = await host.createTab('about:blank');

		const journal = new InMemorySessionJournal();
		const session = fixtureDescriptor(matchingPartition, enginePrimary, clock, 'agent');

		const deps: TabPipelineDeps = {
			engine: () => enginePrimary,
			workspaceRoot: harness.root,
			clock,
			commandTimeoutMs,
			navigationTimeoutMs,
			bufferLimit: 100,
			replaceTab: async (_sessionId, tab, reason) => {
				throw new Error(`unexpected wedged-tab replacement in the W7 drill: ${reason} (tab ${tab.record.tabId})`);
			},
			taskIdOf: () => harness.taskId,
		};
		await journal.append(buildSessionJournalRecord('agent', 'opened', session, clock()));

		let tab: LiveTab = await activateLiveTab(deps, session, handle.transport, handle.targetId, 'about:blank');
		const outcomes: NavigationOutcome[] = [];
		for (const script of SCRIPTED_NAVIGATIONS) {
			// n4 is the USER-path drill (willNavigate + webRequest): evaluated
			// directly by the engine — never executed through the agent tab
			// pipeline (no Page.navigate, no journal row; the honest user path).
			if (script.initiator === 'user') {
				continue;
			}
			// n6 evaluates under the REJECTED-file engine; n5 runs with the FOREIGN partition.
			const activeDeps: TabPipelineDeps = script.engineId === 'rejected-policy-file' ? { ...deps, engine: () => engineRejected } : deps;
			const activeSession = script.partition === 'foreign'
				? { ...session, partition: foreignPartition, policySourceRef: policySourceRefOf(enginePrimary) }
				: session;
			const outcome = await runNavigation(activeDeps, activeSession, tab, script.url);
			outcomes.push(outcome);
			await journal.append(buildSessionJournalRecord('agent', 'navigated', activeSession, clock(), {
				decision: outcome.verdict.decision,
				requestedUrl: script.url,
				...(outcome.committedUrl === undefined ? {} : { committedUrl: outcome.committedUrl }),
				sent: outcome.sent,
			}));
		}

		// 3. The screenshot capture (a real CDP command through the fake transport).
		let screenshotBytes = 0;
		try {
			const shot = await tab.transport.send('Page.captureScreenshot', {});
			screenshotBytes = typeof shot.data === 'string' ? shot.data.length : 0;
		} catch {
			screenshotBytes = 0;
		}

		// 4. The drop + recovery drill: close the live transport, re-attach a
		//    FRESH transport to the SAME shared FakeBrowserState, re-activate,
		//    navigate again. The journal (in-memory) survives the drop.
		const journalRowsBeforeDrop = journal.records.length;
		handle.transport.close();
		const host2 = new CdpEndpointHost('fake://dogfood-browser-reattach', { transportFactory, commandTimeoutMs });
		await host2.open();
		const reattached = await host2.attachTab(handle.targetId);
		session.state = 'suspended';
		await journal.append(buildSessionJournalRecord('agent', 'state-changed', session, clock()));
		session.state = 'active';
		tab = await activateLiveTab(deps, session, reattached.transport, reattached.targetId, 'about:blank');
		const reattachOutcome = await runNavigation(deps, session, tab, REATTACH_URL);
		await journal.append(buildSessionJournalRecord('agent', 'navigated', session, clock(), {
			decision: reattachOutcome.verdict.decision,
			requestedUrl: REATTACH_URL,
			...(reattachOutcome.committedUrl === undefined ? {} : { committedUrl: reattachOutcome.committedUrl }),
			sent: reattachOutcome.sent,
		}));
		const reattachStartedAt = Date.now();
		await host2.close();
		await host.close();

		// the scripted drop friction row (browser-env-failure WITH its recovery account)
		await harness.friction.friction({
			phase: 'browser-policy:drop-drill',
			kind: 'browser-env-failure',
			detail: 'the live CDP transport was dropped mid-session (scripted drill): pending state on the transport was lost',
			recovery: `a fresh transport re-attached to the SAME shared FakeBrowserState (target ${handle.targetId}); the session journal survived intact (${String(journalRowsBeforeDrop)} rows) and the re-attach navigation ran through the full policy pipeline`,
		});
		await harness.friction.timing({ phase: 'browser-policy:reattach', durationMs: Math.max(0, Date.now() - reattachStartedAt) });

		// 5. The INDEPENDENT ground truth: re-derived from the primitives.
		const groundTruth = deriveBrowserPolicyGroundTruth({
			engines: { primary: enginePrimary, 'rejected-policy-file': engineRejected },
			workspaceRoot: harness.root,
			matchingPartition,
			foreignPartition,
			sentCommands: transports.flatMap(transport => [...transport.sentCommands]),
			journalRecords: journal.records,
			journalRowsBeforeDrop,
		});

		// 6. THE ASK (P2-FIX-119: facts embedded at ask time; excerpt doctrine on overflow).
		const askPromptHolder: { prompt: string; excerpted: boolean; groundTruthSha256: string } = { prompt: '', excerpted: false, groundTruthSha256: '' };
		const ask: AskOutcome = await harness.provider.ask(() => {
			const built = buildBrowserPolicyQuestion(groundTruth);
			askPromptHolder.prompt = built.prompt;
			askPromptHolder.excerpted = built.excerpted;
			askPromptHolder.groundTruthSha256 = built.groundTruthSha256;
			return built.prompt;
		});

		let answerProblems: string[] = [];
		let verification: VerificationOutcome = { ok: false, problems: ['no answer was produced'], soundnessViolations: 0, completenessViolations: 0 };
		let parsedAnswer: BrowserPolicyAnswer | undefined;
		if (ask.kind === 'ok') {
			const parsed = parseBrowserPolicyAnswer(ask.text, { fenceTolerant: harness.mode === 'live-provider' });
			if (!parsed.ok) {
				answerProblems.push(answerParseFailDetail(parsed.error, ask.finishReason));
			} else {
				parsedAnswer = parsed.answer;
				verification = verifyBrowserPolicyAnswer(parsed.answer, groundTruth);
				answerProblems.push(...verification.problems);
			}
		} else {
			answerProblems.push(`the ask surfaced a typed provider failure: ${ask.code} ${ask.message}`);
			await harness.friction.friction({
				phase: 'browser-policy:ask',
				kind: 'provider-failure',
				detail: `the browser-policy ask surfaced the TYPED provider failure ${ask.code} (retryable=${String(ask.retryable)}, retryClass=${ask.retryClass}) after ${String(ask.attempts)} attempt(s): ${ask.message}`,
				recovery: '',
			});
		}

		// 7. THE CHECKS (the G-receipts; every law is checked against the real state).
		const executedScripted = SCRIPTED_NAVIGATIONS.filter(script => script.initiator === 'agent-tool');
		recorder.check('bp.scenario-executed', outcomes.length === executedScripted.length, `all ${String(executedScripted.length)} agent-path scripted navigations executed through the real tab pipeline (+ ${String(SCRIPTED_NAVIGATIONS.length - executedScripted.length)} user-path drill evaluated directly, per the B1c firing model)`);
		const deniedUrls = groundTruth.navigations.filter(nav => nav.verdict === 'deny').map(nav => nav.targetUrl);
		const law = denyNeverNavigatesLaw(transports.flatMap(transport => [...transport.sentCommands]), deniedUrls);
		recorder.check('bp.deny-never-navigates', law.ok, law.ok ? `zero Page.navigate commands in sentCommands for the ${String(deniedUrls.length)} denied targets` : law.violations.join('; '));
		const allowedAllSent = groundTruth.navigations.filter(nav => nav.verdict === 'allow').every(nav => nav.navigateCommandReachedTransport);
		recorder.check('bp.allow-navigates', allowedAllSent, 'every allowed navigation produced a Page.navigate command in sentCommands');
		const layerExpectations: Readonly<Record<string, string>> = { n2: 'driver', n3: 'webRequest', n4: 'willNavigate', n5: 'partition' };
		const layerProblems: string[] = [];
		for (const [id, expectedLayer] of Object.entries(layerExpectations)) {
			const truth = groundTruth.navigations.find(nav => nav.id === id);
			if (truth === undefined || truth.verdict !== 'deny' || truth.decidingLayer !== expectedLayer) {
				layerProblems.push(`${id} denied at ${truth?.decidingLayer ?? 'n/a'} but the script pins ${expectedLayer}`);
			}
		}
		recorder.check('bp.verdict-layers', layerProblems.length === 0, layerProblems.length === 0 ? 'each scripted denial decided at its pinned layer (driver/webRequest/willNavigate/partition)' : layerProblems.join('; '));
		const n6 = groundTruth.navigations.find(nav => nav.id === 'n6');
		recorder.check('bp.policy-file-rejected', n6 !== undefined && n6.verdict === 'deny', n6 === undefined ? 'the rejected-policy-file navigation did not run' : `the rejected policy file left the deny-all default in effect: n6 -> ${n6.verdict} (layer ${n6.decidingLayer}, source ${resolvedRejected.source}${resolvedRejected.error === undefined ? '' : `; error ${resolvedRejected.error.code}`})`);
		const n7 = groundTruth.navigations.find(nav => nav.id === 'n7');
		const redactedOk = n7 !== undefined && n7.journalRequestedUrl.includes('[redacted]') && !n7.journalRequestedUrl.includes('sk-live-abcdefghijklmnop');
		recorder.check('bp.url-redaction', redactedOk, redactedOk ? `the journal row for n7 carries the at-record redacted url (${JSON.stringify(n7?.journalRequestedUrl)})` : `the journal row for n7 does not carry the redacted form (got ${JSON.stringify(n7?.journalRequestedUrl)})`);
		const drop = groundTruth.dropRecovery;
		recorder.check('bp.drop-recovery', drop.preDropRowsSurvived && drop.journalRowsAfterReattach > drop.journalRowsBeforeDrop && drop.reattachedNavigation.verdict === 'allow' && drop.reattachedNavigation.navigateCommandReachedTransport, `the journal survived the drop (${String(drop.journalRowsBeforeDrop)} rows intact), the re-attach appended ${String(drop.journalRowsAfterReattach - drop.journalRowsBeforeDrop)} row(s), and the re-attach navigation allowed + navigated (${drop.reattachedNavigation.targetUrl})`);
		recorder.check('bp.screenshot-capture-command', screenshotBytes > 0, screenshotBytes > 0 ? `a Page.captureScreenshot command ran through the transport (${String(screenshotBytes)} base64 chars)` : 'the Page.captureScreenshot command produced no capture (the fake transport may not implement it -- honest FAIL)');
		recorder.check('bp.answer-verified-100', verification.ok, verification.ok
			? `the model's answer matched the independently re-derived ground truth 100% (sound + complete${askPromptHolder.excerpted ? '; scoped to the embedded excerpt' : ''}; ground-truth sha256 ${askPromptHolder.groundTruthSha256})`
			: `answer verification FAILED: ${String(verification.soundnessViolations)} soundness violation(s), ${String(verification.completenessViolations)} completeness violation(s): ${verification.problems.join('; ')}`);
		recorder.check('bp.ask-prompt-carries-facts', askPromptHolder.prompt.includes(BROWSER_POLICY_FACTS_BEGIN) && askPromptHolder.prompt.includes(BROWSER_POLICY_FACTS_END), 'the ask prompt embedded the browser-session facts at ask time (P2-FIX-119 doctrine)');

		// 8. The report artifact + the records-dir receipt.
		const report = {
			schema: 'flauz.dogfood-browser-policy-report/v1',
			exerciseId: 'browser-policy',
			mode: harness.mode,
			scenarioHash: sha256Hex(`${FIXTURE_POLICY_TEXT}\n${JSON.stringify(SCRIPTED_NAVIGATIONS)}\n${FIXTURE_SESSION_ID}`),
			ask: ask.kind === 'ok'
				? { kind: 'ok', decisionId: ask.decisionId, finishReason: ask.finishReason, fenceStripped: harness.mode === 'live-provider', text: ask.text }
				: { kind: 'provider-failure', decisionId: ask.decisionId, code: ask.code, retryClass: ask.retryClass, attempts: ask.attempts, message: ask.message },
			askPromptExcerpt: askPromptHolder.prompt.slice(0, 2_000),
			excerpted: askPromptHolder.excerpted,
			groundTruthSha256: askPromptHolder.groundTruthSha256,
			groundTruth,
			answerProblems,
			verification: { ok: verification.ok, soundnessViolations: verification.soundnessViolations, completenessViolations: verification.completenessViolations },
		};
		const reportUri = `.flauz/artifacts/${harness.taskId}/browser-policy-report.json`;
		const artifact = await mintArtifact(harness, reportUri, `${JSON.stringify(report, null, '\t')}\n`, 'the browser-policy exercise report (layered verdicts, deny-never-navigates, drop/recovery)');
		evidenceItems.push(artifact.item);
		evidenceIds.push(artifact.evidenceId);
		await nodeFs.mkdir(harness.recordsDir, { recursive: true });
		await nodeFs.writeFile(nodePath.join(harness.recordsDir, 'browser-policy.report.json'), `${JSON.stringify(report, null, '\t')}\n`, { encoding: 'utf-8' });
		recorder.check('bp.report-evidence-minted', artifact.evidenceId.length > 0, `the browser-policy report is hash-pinned into the evidence ledger (${artifact.evidenceId})`);

		notes.push('evidence: SIMULATED (the fake CDP transport + the in-memory journal); the policy engine, tab pipeline, host, journal record builder and redaction are the REAL product seams');
		notes.push('the verifier re-derives ground truth from the primitives (fresh engine.evaluate per target, the sentCommands record, the journal rows) and checks the answer 100% sound+complete; PASS only at 100%');
		notes.push('P2-FIX-119 doctrine: both lanes answer from the prompt-carried session facts (embedded at ask time); the excerpt doctrine (P2-FIX-122 pattern) scopes the live bar when the outcome map exceeds the prompt budget');
		notes.push(`the rejected-policy-file engine runs the deny-all builtin default (source ${resolvedRejected.source}${resolvedRejected.error === undefined ? '' : `, error ${resolvedRejected.error.code}`}); the n6 deciding layer is recorded VERBATIM from the real verdict, never assumed`);
		notes.push('honest seams (station must confirm): the FakeBrowserState/FakeCdpTransport/attachTab internals and the BrowserPolicyEngine body were digest-elided -- the drill closes the live transport (CdpTransport.close) and re-attaches a fresh transport sharing the state; if FakeBrowserState exposes a dedicated drop(reason) the station should prefer it; the fake provider lane\'s recognition of this question marker was not verifiable from the provided digests (the prompt-carried-facts posture makes both lanes answer from the prompt)');

		const failCount = recorder.checks.filter(check => !check.ok).length;
		const frictionRows = await harness.friction.readAll();
		return {
			schema: 'flauz.dogfood-exercise-receipt/v1',
			exerciseId: 'browser-policy',
			title: 'browser work: layered policy verdicts, deny-never-navigates, drop/recovery over the fake CDP transport',
			dimensions: ['browser work', 'policy layering', 'failure/recovery', 'artifacts/evidence', 'url redaction'],
			verdict: failCount === 0 ? 'PASS' : 'FAIL',
			checks: recorder.checks,
			evidenceIds,
			evidenceItems,
			frictionLogPath: harness.friction.path,
			frictionRows: {
				friction: frictionRows.filter(row => row.type === 'friction').length,
				timing: frictionRows.filter(row => row.type === 'timing').length,
				recovery: frictionRows.filter(row => row.type === 'friction' && typeof row.recovery === 'string' && row.recovery.length > 0).length,
			},
			evidenceLevels: { seams: 'simulated', modelIntelligence: 'fixture' },
			notes,
		};
	},
};