/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Deterministic memory retrieval (TL2-003 M2).
 *
 * Retrieval is a PURE FUNCTION over the memory index (+ the effective share
 * set): same inputs, same outputs, byte-for-byte. Ranking is explicit and
 * RECORDED - every applied rule is returned with the result so the compiled
 * context can carry its own ranking provenance (the work order: "ranking
 * rules recorded with the compiled context").
 *
 * No model-vendor coupling: no embeddings, no vendor tokenizers - the
 * deterministic estimate of api.ts estimateTokens is the only token source.
 *
 * Scope semantics:
 *   - task tier: ONLY the queried task's journals (task memory is scoped to
 *     its task; other tasks' memory is invisible);
 *   - session tier: ONLY the live task's working memory;
 *   - project tier: cross-task, always retrievable;
 *   - private context (agentId set): readable ONLY by the owner or through an
 *     effective grant share record (M4's boundary - enforced HERE, in the
 *     pure function, so no consumer can bypass it).
 */

import { type MemoryIndex, type MemoryIndexEntry } from './api.ts';

/** The reader's scope + filters. All fields optional except the reader. */
export interface RetrievalQuery {
	/** The task whose memory is being compiled (scope for task/session tiers). */
	readonly taskId?: string;
	/** The agent reading (the private-context boundary anchor). */
	readonly agentId: string;
	/** Interest tags (the tag-overlap ranking rule). */
	readonly tags?: readonly string[];
	/** Restrict to these record kinds (optional filter). */
	readonly kinds?: readonly string[];
	/** Restrict to one tier (optional; default: all three). */
	readonly tier?: 'session' | 'task' | 'project';
	/** Maximum entries returned (after ranking; default 50). */
	readonly limit?: number;
}

/** An effective share grant (M4 boundary input): recordId -> readable-by agent. */
export interface EffectiveShare {
	readonly recordId: string;
	readonly toAgent: string;
}

/** One applied ranking rule (returned with every ranked entry). */
export interface RankingRule {
	readonly ruleId: 'scope-match' | 'recency-decay' | 'tag-overlap' | 'kind-weight' | 'pin-boost';
	readonly weight: number;
	readonly description: string;
}

export interface RankedEntry {
	readonly entry: MemoryIndexEntry;
	readonly score: number;
	/** The rules that contributed non-zero score, in application order. */
	readonly applied: readonly RankingRule[];
}

export interface RetrievalResult {
	readonly entries: readonly RankedEntry[];
	/** Every rule available to this query (recorded with compiled contexts). */
	readonly rules: readonly RankingRule[];
	/** Entries excluded by the private-context boundary (ids only - never content). */
	readonly excludedPrivate: readonly string[];
}

export const RANKING_RULES: readonly RankingRule[] = [
	{ ruleId: 'scope-match', weight: 50, description: '+50 when the record is scoped to the queried task (task memory of THIS task)' },
	{ ruleId: 'recency-decay', weight: 20, description: '+20 decaying by 2/day down to 0 after 10 days (updatedAt vs now)' },
	{ ruleId: 'tag-overlap', weight: 8, description: '+8 per tag shared with the query tags' },
	{ ruleId: 'kind-weight', weight: 10, description: '+N by kind: authorization 10, instruction 6, decision-ref 5, summary 4, observation 3, evidence-ref 2' },
	{ ruleId: 'pin-boost', weight: 4, description: '+4 when the record is pinned (explicitly marked important)' },
];

const KIND_WEIGHTS: Record<string, number> = {
	'authorization': 10,
	'instruction': 6,
	'decision-ref': 5,
	'summary': 4,
	'observation': 3,
	'evidence-ref': 2,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function kindWeightOf(kind: string): number {
	return KIND_WEIGHTS[kind] ?? 0;
}

/**
 * Pure retrieval: rank the index entries for the query. Deterministic -
 * ties break by id ascending, so the same (index, query, shares, nowMs)
 * always produces the same order. `shares` is the effective grant set for
 * the READING agent (effectiveShares() derives it from the share journal).
 */
export function retrieve(index: MemoryIndex, query: RetrievalQuery, nowMs: number, shares: readonly EffectiveShare[] = []): RetrievalResult {
	const readable = new Set<string>(shares.map(share => share.recordId));
	const limit = query.limit ?? 50;
	const excludedPrivate: string[] = [];
	const ranked: RankedEntry[] = [];
	for (const entry of index.entries) {
		if (query.tier !== undefined && entry.tier !== query.tier) {
			continue;
		}
		if (query.kinds !== undefined && !query.kinds.includes(entry.kind)) {
			continue;
		}
		// Tier scope laws.
		if (entry.tier === 'task' && query.taskId !== undefined && entry.taskId !== query.taskId) {
			continue;
		}
		if (entry.tier === 'session' && query.taskId !== undefined && entry.taskId !== query.taskId) {
			continue;
		}
		// Private-context boundary: an agent-scoped record is readable only by
		// its owner or through an effective share grant.
		if (entry.agentId !== null && entry.agentId !== query.agentId && !readable.has(entry.id)) {
			excludedPrivate.push(entry.id);
			continue;
		}
		const applied: RankingRule[] = [];
		let score = 0;
		if (query.taskId !== undefined && entry.taskId === query.taskId) {
			const rule = ruleOf('scope-match');
			applied.push(rule);
			score += rule.weight;
		}
		const ageDays = Math.max(0, (nowMs - entry.updatedAt) / DAY_MS);
		const recency = Math.max(0, 20 - 2 * ageDays);
		if (recency > 0) {
			applied.push({ ...ruleOf('recency-decay'), weight: Math.round(recency * 10) / 10 });
			score += recency;
		}
		if (query.tags !== undefined) {
			const overlap = query.tags.filter(tag => entry.tags.includes(tag)).length;
			if (overlap > 0) {
				const rule = ruleOf('tag-overlap');
				applied.push({ ...rule, weight: rule.weight * overlap });
				score += rule.weight * overlap;
			}
		}
		const kindWeight = kindWeightOf(entry.kind);
		if (kindWeight > 0) {
			applied.push({ ruleId: 'kind-weight', weight: kindWeight, description: ruleOf('kind-weight').description });
			score += kindWeight;
		}
		if (entry.pinned) {
			const rule = ruleOf('pin-boost');
			applied.push(rule);
			score += rule.weight;
		}
		ranked.push({ entry, score: Math.round(score * 10) / 10, applied });
	}
	// Deterministic order: score DESC, then id ASC.
	ranked.sort((a, b) => (b.score - a.score) || (a.entry.id < b.entry.id ? -1 : 1));
	return {
		entries: ranked.slice(0, limit),
		rules: RANKING_RULES,
		excludedPrivate,
	};
}

function ruleOf(ruleId: RankingRule['ruleId']): RankingRule {
	const rule = RANKING_RULES.find(candidate => candidate.ruleId === ruleId);
	if (rule === undefined) {
		throw new Error(`flauz.memory: ranking rule '${ruleId}' missing from RANKING_RULES`);
	}
	return rule;
}

/**
 * Effective share ids for the querying agent, derived from the grant/revoke
 * share journal (last record wins per recordId+toAgent). Pure.
 */
export function effectiveShares(shares: readonly { action: 'grant' | 'revoke'; recordId: string; toAgent: string }[], agentId: string): EffectiveShare[] {
	const effective = new Map<string, EffectiveShare>();
	for (const share of shares) {
		if (share.toAgent !== agentId) {
			continue;
		}
		if (share.action === 'grant') {
			effective.set(share.recordId, { recordId: share.recordId, toAgent: share.toAgent });
		} else {
			effective.delete(share.recordId);
		}
	}
	return [...effective.values()].sort((a, b) => (a.recordId < b.recordId ? -1 : 1));
}

