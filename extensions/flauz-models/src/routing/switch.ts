/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-116 (A-PROD-003-W2.2) -- the provider-lane switch act + its ONE
 * canonical linking event.
 *
 * The finding (docs/FLAUZ-PROGRAM/findings/P2-FIX-116-provider-switch-no-linking-event.md):
 * switching a provider lane is durable in THREE places -- the providers file
 * (writeProviderOverrides), the routing-policy rewrite (saveRoutingPolicy)
 * and a durable ModelRouter decision (the decision ledger) -- with no single
 * linking event row; correlating "what switch happened, when, and what did
 * it change?" after the fact requires hand-correlating three artifacts by
 * shape and by time window.
 *
 * This module is the single seam that composes the act: ONE call performs
 * the three writes in the proven order (providers file -> routing policy ->
 * fresh registry load -> the selection probe whose decision is appended to
 * the decision ledger) and then mints ONE canonical typed event row --
 * `flauz.model-provider-switch/v0` in `.flauz/models/provider-switches.jsonl`
 * -- referencing all three artifacts it touches:
 *
 *   - the providers file: path + sha256 of the WRITTEN file (read back and
 *     hashed -- checked, never trusted) + the before/after enabled sets;
 *   - the routing policy: path + sha256 + the delta (every rule that was
 *     added, removed or changed, with its full before/after shape);
 *   - the decision: path + the decisionId (which EXISTS in the decision
 *     ledger -- the probe that verified the switch took) + what it selected.
 *
 * Minting follows the product's EXISTING append-only JSONL discipline
 * (`appendJsonlLine`: read + validate + extend + atomic rewrite; existing
 * bytes preserved) and the decision-ledger id discipline (ids derived from
 * the ledger length, `ps-000042`, unique across restarts without a
 * coordination service). NO new ledger authority is minted: the switch event
 * is an observational LINKING record that references the three authorities;
 * it authorizes nothing and its corruption cannot alter routing, enablement
 * or decisions.
 *
 * Fail-closed posture (the no-silent-fallback law): the probe must select
 * the target lane. A drift (or a target that is not enabled after the
 * write) throws a typed ProviderSwitchError WITHOUT minting the event --
 * the two file writes and the decision row are durable facts that remain,
 * but a fabricated "switched to X" row while the decision selected Y would
 * be worse than no row. The error names the decision and both providers.
 */

import type { Clock, FileSystemPort, HashPort } from '../contract/ports.ts';
import { canonicalJson } from '../contract/canonical.ts';
import { appendJsonlLine, joinStatePath, readJsonl, StateFileError } from '../discovery/stateFiles.ts';
import { loadProviderOverrides, writeProviderOverrides, type ProviderOverride } from '../discovery/configs.ts';
import { ModelCapabilityRegistry, MODELS_STATE_DIR } from '../discovery/registry.ts';
import { ModelRouter, loadRoutingPolicy, saveRoutingPolicy } from './store.ts';
import type { RouteRequest, RoutingPolicyFile, RoutingRule } from './policy.ts';

/** Schema id pinned into every provider-switch event row. */
export const PROVIDER_SWITCH_SCHEMA_ID = 'flauz.model-provider-switch/v0';

/** Workspace path of the switch event ledger. */
export const PROVIDER_SWITCHES_PATH = '.flauz/models/provider-switches.jsonl';

/** The switch event ledger file name (inside the `.flauz/models` state dir). */
export const PROVIDER_SWITCHES_FILE = 'provider-switches.jsonl';

/** Typed provider-switch failure. */
export class ProviderSwitchError extends Error {
	readonly code: 'BAD_TARGET' | 'SELECTION_DRIFT' | 'WRITE_FAILED';
	readonly path: string;

	constructor(code: 'BAD_TARGET' | 'SELECTION_DRIFT' | 'WRITE_FAILED', path: string, message: string) {
		super(message);
		this.name = 'ProviderSwitchError';
		this.code = code;
		this.path = path;
	}
}

/** One changed routing rule (the full before/after shape; null = absent on that side). */
export interface RoutingRuleDelta {
	readonly ruleId: string;
	readonly before: RoutingRule | null;
	readonly after: RoutingRule | null;
}

/** The canonical provider-lane switch event (ONE row per switch; schema-pinned). */
export interface ProviderSwitchEvent {
	readonly schema: typeof PROVIDER_SWITCH_SCHEMA_ID;
	readonly schemaVersion: 0;
	/** Derived from the ledger length (`ps-000042`), the rd- discipline. */
	readonly switchId: string;
	readonly at: number;
	/** The sole enabled providers-file lane before the switch (null: none/ambiguous). */
	readonly fromProviderId: string | null;
	/** The target lane of this act (validated: enabled after the write, selected by the probe). */
	readonly toProviderId: string;
	readonly providersFile: {
		readonly path: string;
		readonly sha256: string;
		readonly beforeEnabledProviderIds: readonly string[];
		readonly enabledProviderIds: readonly string[];
	};
	readonly routingPolicy: {
		readonly path: string;
		readonly sha256: string;
		readonly rulesBefore: readonly string[];
		readonly rulesAfter: readonly string[];
		readonly changedRules: readonly RoutingRuleDelta[];
	};
	readonly routingDecision: {
		readonly path: string;
		readonly decisionId: string;
		readonly selectedProviderId: string | null;
	};
	readonly explanation: string;
}

/** The deps of the switch act (every effect is a port; production wires node stdlib). */
export interface ProviderSwitchDeps {
	/** The workspace root (durable `.flauz/models` state is derived from it). */
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock: Clock;
	readonly hash: HashPort;
	/** The providers-file overrides AFTER the switch (the full written list). */
	readonly overrides: readonly ProviderOverride[];
	/** The routing policy AFTER the switch. */
	readonly policy: RoutingPolicyFile;
	/** The lane this switch enables (the act's target). */
	readonly targetProviderId: string;
	/** The selection probe request (default: purpose 'provider-switch', enabledOnly). */
	readonly routeRequest?: RouteRequest;
}

/** Rules are compared canonically (sorted keys), so key order never fabricates a delta. */
function ruleChanged(before: RoutingRule, after: RoutingRule): boolean {
	return canonicalJson(before) !== canonicalJson(after);
}

/** The delta of two policies by rule id (added / removed / changed). */
function policyDelta(before: RoutingPolicyFile, after: RoutingPolicyFile): { changedRules: RoutingRuleDelta[]; rulesBefore: string[]; rulesAfter: string[] } {
	const rulesBefore = before.rules.map(rule => rule.id);
	const rulesAfter = after.rules.map(rule => rule.id);
	const changedRules: RoutingRuleDelta[] = [];
	for (const ruleId of new Set([...rulesBefore, ...rulesAfter])) {
		const beforeRule = before.rules.find(rule => rule.id === ruleId) ?? null;
		const afterRule = after.rules.find(rule => rule.id === ruleId) ?? null;
		if (beforeRule === null || afterRule === null || ruleChanged(beforeRule, afterRule)) {
			changedRules.push({ ruleId, before: beforeRule, after: afterRule });
		}
	}
	changedRules.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
	return { changedRules, rulesBefore, rulesAfter };
}

/** The enabled override ids of a providers state (sorted). */
function enabledProviderIds(overrides: readonly ProviderOverride[]): string[] {
	return overrides.filter(override => override.enabled === true).map(override => override.providerId).sort();
}

/** The sole enabled lane (null when none or several are enabled -- the full set is on the event). */
function soleEnabledLane(overrides: readonly ProviderOverride[]): string | null {
	const enabled = enabledProviderIds(overrides);
	return enabled.length === 1 ? enabled[0] : null;
}

/**
 * Performs the provider-lane switch: the three writes in the proven order,
 * the fail-closed selection probe, and ONE canonical linking event row.
 */
export async function switchProviderLane(deps: ProviderSwitchDeps): Promise<ProviderSwitchEvent> {
	const stateDir = joinStatePath(deps.root, MODELS_STATE_DIR);
	const providersPath = joinStatePath(stateDir, 'providers.json');
	const policyPath = joinStatePath(stateDir, 'routing-policy.json');
	const decisionsPath = joinStatePath(stateDir, 'routing-decisions.jsonl');
	const switchLedgerPath = joinStatePath(stateDir, PROVIDER_SWITCHES_FILE);

	// BEFORE state (the providers file as it is; the policy -- materialized default on first run)
	const beforeOverrides = await loadProviderOverrides(deps.fs, stateDir);
	const beforePolicy = await loadRoutingPolicy(deps.fs, stateDir, deps.clock);

	// artifact 1: the providers file rewrite
	await writeProviderOverrides(deps.fs, stateDir, deps.overrides, deps.clock());
	// artifact 2: the routing-policy rewrite
	await saveRoutingPolicy(deps.fs, stateDir, deps.policy);

	// the fresh registry load (routing judges the enablement as written)
	const registry = new ModelCapabilityRegistry({ root: deps.root, fs: deps.fs, clock: deps.clock });
	await registry.load();

	// the fail-closed target validation: the lane must be enabled in the merged view
	const targetEnabled = registry.list().some(record => record.providerId === deps.targetProviderId && record.enabled);
	if (!targetEnabled) {
		throw new ProviderSwitchError('BAD_TARGET', switchLedgerPath, `provider switch refused: target '${deps.targetProviderId}' is not an enabled provider after the providers-file write (${providersPath}); the files and the policy were written, no switch event is minted for an act that did not enable its target`);
	}

	// artifact 3: the durable routing decision (the selection probe)
	const router = new ModelRouter({ stateDir, fs: deps.fs, clock: deps.clock, records: () => registry.list(), policy: deps.policy });
	const probe = await router.route(deps.routeRequest ?? { purpose: 'provider-switch', requirements: { enabledOnly: true } });
	if (probe.selected === null || probe.selected.providerId !== deps.targetProviderId) {
		throw new ProviderSwitchError('SELECTION_DRIFT', switchLedgerPath, `provider switch failed closed: the routing decision ${probe.decisionId} selected ${JSON.stringify(probe.selected)} instead of '${deps.targetProviderId}' (${probe.explanation}); the files and the decision are durable facts, no switch event is minted for a drifted act`);
	}

	// read both artifacts back and pin them (checked, never trusted)
	const providersText = await deps.fs.readFileUtf8(providersPath);
	const policyText = await deps.fs.readFileUtf8(policyPath);
	if (providersText === undefined || policyText === undefined) {
		throw new ProviderSwitchError('WRITE_FAILED', switchLedgerPath, `provider switch failed closed: a written artifact is not readable back (${providersText === undefined ? providersPath : policyPath})`);
	}

	const fromProviderId = soleEnabledLane(beforeOverrides.overrides);
	const enabledAfter = enabledProviderIds(deps.overrides);
	const delta = policyDelta(beforePolicy, deps.policy);
	const switchId = `ps-${String((await providerSwitchCount(deps.fs, stateDir)) + 1).padStart(6, '0')}`;
	const event: ProviderSwitchEvent = {
		schema: PROVIDER_SWITCH_SCHEMA_ID,
		schemaVersion: 0,
		switchId,
		at: deps.clock(),
		fromProviderId,
		toProviderId: deps.targetProviderId,
		providersFile: {
			path: joinStatePath(MODELS_STATE_DIR, 'providers.json'),
			sha256: deps.hash.sha256Hex(providersText),
			beforeEnabledProviderIds: enabledProviderIds(beforeOverrides.overrides),
			enabledProviderIds: enabledAfter,
		},
		routingPolicy: {
			path: joinStatePath(MODELS_STATE_DIR, 'routing-policy.json'),
			sha256: deps.hash.sha256Hex(policyText),
			rulesBefore: delta.rulesBefore,
			rulesAfter: delta.rulesAfter,
			changedRules: delta.changedRules,
		},
		routingDecision: {
			path: joinStatePath(MODELS_STATE_DIR, 'routing-decisions.jsonl'),
			decisionId: probe.decisionId,
			selectedProviderId: probe.selected.providerId,
		},
		explanation: `provider lane switch ${switchId}: ${fromProviderId ?? '(no enabled lane)'} -> ${deps.targetProviderId}; providers file ${joinStatePath(MODELS_STATE_DIR, 'providers.json')} rewritten (sha256 ${deps.hash.sha256Hex(providersText).slice(0, 12)}), routing policy delta ${delta.changedRules.length} changed rule(s) (${delta.changedRules.map(rule => rule.ruleId).join(', ') || 'none'}), verified by routing decision ${probe.decisionId}`,
	};
	await appendProviderSwitchEvent(deps.fs, stateDir, event);
	return event;
}

/** The number of switch event rows already in the ledger (id allocation base). */
export async function providerSwitchCount(fs: FileSystemPort, stateDir: string): Promise<number> {
	return (await readJsonl(fs, joinStatePath(stateDir, PROVIDER_SWITCHES_FILE))).length;
}

/** Reads the switch event ledger (oldest first; schema-filtered, the listDecisions discipline). */
export async function listProviderSwitches(fs: FileSystemPort, stateDir: string): Promise<ProviderSwitchEvent[]> {
	const records = await readJsonl(fs, joinStatePath(stateDir, PROVIDER_SWITCHES_FILE));
	return records.filter(record => record.schema === PROVIDER_SWITCH_SCHEMA_ID) as unknown as ProviderSwitchEvent[];
}

/** Appends one switch event row (the append-only discipline; existing bytes preserved). */
export async function appendProviderSwitchEvent(fs: FileSystemPort, stateDir: string, event: ProviderSwitchEvent): Promise<void> {
	try {
		await appendJsonlLine(fs, joinStatePath(stateDir, PROVIDER_SWITCHES_FILE), event as unknown as Record<string, unknown>);
	} catch (error) {
		if (error instanceof StateFileError) {
			throw new ProviderSwitchError('WRITE_FAILED', error.path, error.message);
		}
		throw new ProviderSwitchError('WRITE_FAILED', joinStatePath(stateDir, PROVIDER_SWITCHES_FILE), error instanceof Error ? error.message : String(error));
	}
}
