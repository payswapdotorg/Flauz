/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the declarative routing policy + decision records (M3).
 *
 * Rules are DATA, not code: a prioritized list where each rule declares the
 * capability requirements its candidates must satisfy and how to rank the
 * survivors (explicit provider order, cost, context fit, or locality).
 * Evaluation produces a RoutingDecision -- a PROVENANCE record: which rule
 * fired, which candidates were considered, why each excluded candidate was
 * excluded, and what the selection basis was. NO SILENT FALLBACKS: the
 * shipped default rule routes to the deterministic flauz-mock vendor and is
 * EXPLICITLY LABELED as the zero-network default; if nothing matches and no
 * rule fires, the decision records selected: null with the reason.
 *
 * The default policy file is materialized on first run under
 * `.flauz/models/routing-policy.json` (flauz.model-routing-policy/v0);
 * decisions append to `.flauz/models/routing-decisions.jsonl`
 * (flauz.model-routing-decision/v0) through the append-only ledger
 * discipline (existing bytes preserved).
 */

import type { CapabilityQuery, CapabilityRecord } from '../discovery/registry.ts';

/** Schema id pinned into the policy file. */
export const ROUTING_POLICY_SCHEMA_ID = 'flauz.model-routing-policy/v0';

/** Schema id pinned into every decision ledger line. */
export const ROUTING_DECISION_SCHEMA_ID = 'flauz.model-routing-decision/v0';

/** How eligible candidates are ordered within a rule. */
export type RankingMode = 'prefer-order' | 'cost' | 'context-fit' | 'locality';

/** One declarative routing rule. */
export interface RoutingRule {
	readonly id: string;
	readonly description: string;
	/** Lower numbers evaluate first. */
	readonly priority: number;
	/** Capability requirements a candidate must satisfy for this rule to match. */
	readonly match: CapabilityQuery;
	readonly ranking: RankingMode;
	/** providerIds in preference order (ranking 'prefer-order'). */
	readonly prefer?: readonly string[];
	/**
	 * Whether this rule may serve as the labeled default (the zero-network
	 * fallback). Non-fallback rules are skipped when they match nothing.
	 */
	readonly fallback?: boolean;
}

/** The policy file envelope. */
export interface RoutingPolicyFile {
	readonly schema: typeof ROUTING_POLICY_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly updatedAt: number;
	readonly rules: readonly RoutingRule[];
}

/**
 * The shipped policy: ONE labeled default rule. The zero-network default is
 * the LAST rule (priority 100): any user rule with a lower priority that
 * matches wins first; when nothing else matches, flauz-mock serves the
 * request and the decision says so.
 */
export const DEFAULT_ROUTING_POLICY: RoutingPolicyFile = {
	schema: ROUTING_POLICY_SCHEMA_ID,
	schemaVersion: 0,
	updatedAt: 0,
	rules: [
		{
			id: 'zero-network-default',
			description: 'Zero-network default: route to the deterministic flauz-mock echo vendor (labeled mock; no live provider is contacted).',
			priority: 100,
			match: { enabledOnly: true },
			ranking: 'prefer-order',
			prefer: ['flauz-mock'],
			fallback: true,
		},
	],
};

/** A route request (what the orchestration layer asks for). */
export interface RouteRequest {
	readonly purpose: string;
	readonly requirements: CapabilityQuery;
	readonly correlationId?: string;
}

/** One candidate as recorded in the decision (eligible or excluded, with the reason). */
export interface RoutingCandidateRecord {
	readonly providerId: string;
	readonly modelId: string;
	readonly eligible: boolean;
	readonly exclusionReason?: string;
	readonly contextWindowTokens: number;
	readonly locality: 'local' | 'remote';
	readonly inputCostPerMillion?: number;
	readonly rank?: number;
}

/** The durable routing decision (provenance for every route). */
export interface RoutingDecision {
	readonly schema: typeof ROUTING_DECISION_SCHEMA_ID;
	readonly schemaVersion: 0;
	readonly decisionId: string;
	readonly at: number;
	readonly purpose: string;
	readonly correlationId?: string;
	readonly requirements: CapabilityQuery;
	readonly ruleId?: string;
	readonly ruleDescription?: string;
	readonly selected: { readonly providerId: string; readonly modelId: string } | null;
	readonly candidates: readonly RoutingCandidateRecord[];
	readonly selectionBasis: 'rule-match' | 'no-candidate';
	readonly explanation: string;
}

/** Why a registry record fails a rule's requirements (deterministic order). */
function exclusionReason(record: CapabilityRecord, query: CapabilityQuery): string | undefined {
	if (!record.enabled) {
		return 'provider disabled';
	}
	if (query.providerId !== undefined && record.providerId !== query.providerId) {
		return `rule pins provider '${query.providerId}'`;
	}
	if (query.locality !== undefined && record.locality !== query.locality) {
		return `locality ${record.locality} does not satisfy ${query.locality}`;
	}
	if (query.requiresTools === true && (record.toolCalling === false || record.toolCalling === 0)) {
		return 'model does not support tool calling';
	}
	if (query.minContextWindowTokens !== undefined && record.contextWindowTokens < query.minContextWindowTokens) {
		return `context window ${record.contextWindowTokens} < required ${query.minContextWindowTokens}`;
	}
	if (query.requiresImageInput === true && !record.inputModalities.includes('image')) {
		return 'model has no image input';
	}
	if (query.maxInputCostPerMillion !== undefined) {
		const inputCost = record.cost?.inputPerMillion;
		if (inputCost === undefined) {
			return 'input cost unknown (fail closed under a cost ceiling)';
		}
		if (inputCost > query.maxInputCostPerMillion) {
			return `input cost ${inputCost}/M exceeds ${query.maxInputCostPerMillion}/M`;
		}
	}
	return undefined;
}

/** Effective cost score for ranking (missing cost sorts last). */
function costScore(record: CapabilityRecord): number | undefined {
	if (record.cost?.inputPerMillion === undefined) {
		return undefined;
	}
	return record.cost.inputPerMillion + 0.25 * (record.cost.outputPerMillion ?? 0);
}

/**
 * Evaluates the policy against the registry snapshot. Pure: persistence and
 * id allocation live in the router/store layer. Returns the decision or a
 * no-candidate decision -- never a silent pick.
 */
export function evaluateRoutingPolicy(input: {
	readonly policy: RoutingPolicyFile;
	readonly request: RouteRequest;
	readonly records: readonly CapabilityRecord[];
	readonly decisionId: string;
	readonly at: number;
}): RoutingDecision {
	const { policy, request, records, decisionId, at } = input;
	const candidates: RoutingCandidateRecord[] = records.map(record => {
		const reason = exclusionReason(record, request.requirements);
		return {
			providerId: record.providerId,
			modelId: record.modelId,
			eligible: reason === undefined,
			...(reason === undefined ? {} : { exclusionReason: reason }),
			contextWindowTokens: record.contextWindowTokens,
			locality: record.locality,
			...(record.cost?.inputPerMillion === undefined ? {} : { inputCostPerMillion: record.cost.inputPerMillion }),
		};
	});
	// candidate eligibility is judged against the REQUEST requirements; each
	// rule additionally filters by its own match before ranking
	const eligibleForRequest = candidates.filter(candidate => candidate.eligible);
	const sortedRules = [...policy.rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
	for (const rule of sortedRules) {
		const satisfying = eligibleForRequest.filter(candidate => {
			const record = records.find(entry => entry.providerId === candidate.providerId && entry.modelId === candidate.modelId);
			if (record === undefined) {
				return false;
			}
			return exclusionReason(record, rule.match) === undefined;
		});
		if (satisfying.length === 0) {
			if (rule.fallback === true) {
				continue; // a fallback rule that matches nothing is skipped, not forced
			}
			continue;
		}
		const selected = rankCandidates(rule, satisfying, records);
		if (selected === undefined) {
			continue; // rule matched but could not rank (e.g. cost ranking without cost metadata)
		}
		const ranked = selected.ranked;
		return {
			schema: ROUTING_DECISION_SCHEMA_ID,
			schemaVersion: 0,
			decisionId,
			at,
			purpose: request.purpose,
			...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
			requirements: request.requirements,
			ruleId: rule.id,
			ruleDescription: rule.description,
			selected: { providerId: selected.choice.providerId, modelId: selected.choice.modelId },
			candidates: candidates.map(candidate => (ranked.has(`${candidate.providerId}/${candidate.modelId}`) ? { ...candidate, rank: [...ranked.keys()].indexOf(`${candidate.providerId}/${candidate.modelId}`) + 1 } : candidate)),
			selectionBasis: 'rule-match',
			explanation: `rule '${rule.id}' (${rule.ranking}) selected ${selected.choice.providerId}/${selected.choice.modelId}; ${satisfying.length} of ${candidates.length} candidates satisfied the rule; excluded: ${summarizeExclusions(candidates)}.`,
		};
	}
	const ruleNotes = sortedRules.map(rule => {
		const failed = eligibleForRequest
			.map(candidate => ({ candidate, record: records.find(entry => entry.providerId === candidate.providerId && entry.modelId === candidate.modelId) }))
			.filter((entry): entry is { candidate: RoutingCandidateRecord; record: CapabilityRecord } => entry.record !== undefined)
			.map(entry => ({ candidate: entry.candidate, reason: exclusionReason(entry.record, rule.match) }))
			.filter(entry => entry.reason !== undefined);
		return `rule '${rule.id}' matched 0 of ${eligibleForRequest.length} request-eligible candidates${failed.length === 0 ? '' : ` (${failed.map(entry => `${entry.candidate.providerId}/${entry.candidate.modelId}: ${entry.reason}`).join('; ')})`}`;
	});
	return {
		schema: ROUTING_DECISION_SCHEMA_ID,
		schemaVersion: 0,
		decisionId,
		at,
		purpose: request.purpose,
		...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
		requirements: request.requirements,
		selected: null,
		candidates,
		selectionBasis: 'no-candidate',
		explanation: `no routing rule matched: ${candidates.length} candidates considered, ${eligibleForRequest.length} eligible for the request; excluded: ${summarizeExclusions(candidates)}; ${ruleNotes.join(' | ')}.`,
	};
}

function rankCandidates(rule: RoutingRule, satisfying: readonly RoutingCandidateRecord[], records: readonly CapabilityRecord[]): { choice: RoutingCandidateRecord; ranked: Map<string, unknown> } | undefined {
	const recordOf = (candidate: RoutingCandidateRecord): CapabilityRecord | undefined => records.find(entry => entry.providerId === candidate.providerId && entry.modelId === candidate.modelId);
	if (rule.ranking === 'prefer-order') {
		for (const providerId of rule.prefer ?? []) {
			const choice = satisfying.find(candidate => candidate.providerId === providerId);
			if (choice !== undefined) {
				return { choice, ranked: new Map([[`${choice.providerId}/${choice.modelId}`, null]]) };
			}
		}
		return undefined;
	}
	const withRecords = satisfying
		.map(candidate => ({ candidate, record: recordOf(candidate) }))
		.filter((entry): entry is { candidate: RoutingCandidateRecord; record: CapabilityRecord } => entry.record !== undefined);
	if (rule.ranking === 'cost') {
		const priced = withRecords
			.filter(entry => costScore(entry.record) !== undefined)
			.sort((a, b) => (costScore(a.record) ?? Number.POSITIVE_INFINITY) - (costScore(b.record) ?? Number.POSITIVE_INFINITY) || a.candidate.providerId.localeCompare(b.candidate.providerId) || a.candidate.modelId.localeCompare(b.candidate.modelId));
		if (priced.length === 0) {
			return undefined;
		}
		const ranked = new Map(priced.map(entry => [`${entry.candidate.providerId}/${entry.candidate.modelId}`, null]));
		return { choice: priced[0].candidate, ranked };
	}
	if (rule.ranking === 'context-fit') {
		const minimum = rule.match.minContextWindowTokens ?? 0;
		const fitted = [...withRecords].sort((a, b) => a.record.contextWindowTokens - b.record.contextWindowTokens || b.record.contextWindowTokens - a.record.contextWindowTokens || a.candidate.providerId.localeCompare(b.candidate.providerId));
		const sufficient = fitted.filter(entry => entry.record.contextWindowTokens >= minimum);
		const pool = sufficient.length > 0 ? sufficient : fitted;
		if (pool.length === 0) {
			return undefined;
		}
		const ranked = new Map(pool.map(entry => [`${entry.candidate.providerId}/${entry.candidate.modelId}`, null]));
		return { choice: pool[0].candidate, ranked };
	}
	// locality: local first, then cheapest, then name order
	const byLocality = [...withRecords].sort((a, b) => (a.candidate.locality === b.candidate.locality ? (costScore(a.record) ?? Number.POSITIVE_INFINITY) - (costScore(b.record) ?? Number.POSITIVE_INFINITY) : a.candidate.locality === 'local' ? -1 : 1) || a.candidate.providerId.localeCompare(b.candidate.providerId));
	if (byLocality.length === 0) {
		return undefined;
	}
	const ranked = new Map(byLocality.map(entry => [`${entry.candidate.providerId}/${entry.candidate.modelId}`, null]));
	return { choice: byLocality[0].candidate, ranked };
}

function summarizeExclusions(candidates: readonly RoutingCandidateRecord[]): string {
	const excluded = candidates.filter(candidate => !candidate.eligible);
	if (excluded.length === 0) {
		return 'none';
	}
	return excluded.map(candidate => `${candidate.providerId}/${candidate.modelId} (${candidate.exclusionReason ?? 'unknown'})`).join('; ');
}
