/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Lab run engine - executes the L0/L1/L2 evaluation ladder over a candidate list
 * against the task world, producing frozen EvaluationReport shapes.
 *
 * DETERMINISM LAW: no Math.random, no Date.now / new Date() - the engine is pure
 * arithmetic over the seeded world generation; same request -> byte-identical result.
 *
 * The scorer is a replaceable CandidateScorer seam; one fixture response-model
 * implementation ships in this wave. Historical / learned models are later waves.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type OrganizationCandidate, type EvalScore, type EvalDimension, type LadderLevel, type LabEvidenceLevel, type EvaluationReport, type BaselineComparison } from './labContracts.js';
import { generateInstances, getScenario, type WorldInstance } from './taskWorlds.js';

// Local structural mirror of RobustnessReport (consumed via EvaluationReport.robustness;
// not imported to keep the import surface minimal per repo law).
interface RobustnessReportShape {
	seedsEvaluated: number;
	perturbations: string[];
	seedVariance: { dimension: EvalDimension; variance: number }[];
	worstCase: { dimension: EvalDimension; value: number }[];
	uncertainty: { dimension: EvalDimension; low: number; high: number; confidence: number }[];
}

/** Per-dimension candidate scores produced by a response model; the contract is stable across optimizers. */
export interface CandidateScorer {
	/** Stable engine identifier, e.g. 'fixture-response-model-v1'. */
	engineId: string;
	/** Semver-style version of the engine. */
	engineVersion: string;
	/** Honesty label for the evidence produced by this scorer. */
	evidenceLevel: LabEvidenceLevel;
	/** Score a candidate; returns 4 EvalScores (success/quality higher-better; latency/cost LOWER-better). */
	scoreCandidate(candidate: OrganizationCandidate, instances: WorldInstance[], difficultyBase: number): EvalScore[];
}

/** Clamp a value into 0..1. */
function clamp01(v: number): number {
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

/** Mean of a numeric array, 0 when empty. */
function mean(xs: number[]): number {
	if (xs.length === 0) return 0;
	let s = 0;
	for (const x of xs) s += x;
	return s / xs.length;
}

/** Population variance (denominator N), 0 when empty. */
function variance(xs: number[]): number {
	if (xs.length === 0) return 0;
	const m = mean(xs);
	let s = 0;
	for (const x of xs) s += (x - m) * (x - m);
	return s / xs.length;
}

/** Population standard deviation, 0 when empty. */
function stddev(xs: number[]): number {
	return Math.sqrt(variance(xs));
}

/** FNV-1a 32-bit hash of a string (ASCII), returned as 8-char lowercase hex. */
function fnv1a32(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	h = h >>> 0;
	return h.toString(16).padStart(8, '0');
}

/** Shipped fixture response model - a documented heuristic, honestly labeled 'fixture'. */
export const FIXTURE_RESPONSE_MODEL: CandidateScorer = {
	engineId: 'fixture-response-model-v1',
	engineVersion: '1.0.0',
	evidenceLevel: 'fixture',
	scoreCandidate(candidate: OrganizationCandidate, instances: WorldInstance[], difficultyBase: number): EvalScore[] {
		const nodes = candidate.nodes.length;
		const coverageFactor = Math.min(0.9, 0.35 + 0.06 * nodes);
		const avgInstanceDifficulty = mean(instances.map((i) => i.difficulty));
		const instanceBoost = instances.length > 0 ? 0.1 * (1 - avgInstanceDifficulty) : 0.05;
		const success = clamp01(coverageFactor - 0.3 * difficultyBase + instanceBoost);
		const topologyBoost = candidate.topology === 'pipeline' || candidate.topology === 'hierarchical' ? 0.1 : 0;
		const quality = clamp01(0.3 + 0.05 * nodes - 0.2 * difficultyBase + topologyBoost);
		const latencyInstanceBoost = instances.length > 0 ? 0.1 * avgInstanceDifficulty : 0;
		const latency = clamp01(0.2 + 0.12 * nodes + 0.15 * difficultyBase + latencyInstanceBoost);
		const cost = clamp01(0.15 + 0.13 * nodes + 0.1 * difficultyBase);
		return [
			{ dimension: 'success', value: success, unit: '' },
			{ dimension: 'quality', value: quality, unit: '' },
			{ dimension: 'latency', value: latency, unit: '' },
			{ dimension: 'cost', value: cost, unit: '' },
		];
	},
};

/** Caller-minted evaluation request: scope, ladder, seeds, weights, candidates, optional scorer. */
export interface EvaluationRequest {
	/** Lab scope; for the fixtures wave { workspaceId: 'lab-fixtures', tenantId: 'lab-fixtures' }. */
	scope: LabScope;
	/** Caller-minted run identifier. */
	runId: string;
	/** Must resolve via getScenario. */
	taskScenarioId: string;
	/** Ladder rung: 0 closed-form, 1 instance simulation, 2 multi-seed robustness. */
	ladderLevel: LadderLevel;
	/** L0/L1 use seeds[0]; L2 requires >= 2 seeds and uses all. */
	seeds: number[];
	/** L1/L2 instances per seed; L0 ignores (closed-form). */
	instanceCount: number;
	/** Non-negative weights for utility; sum 1. */
	utilityWeights: Record<'success' | 'quality' | 'latency' | 'cost', number>;
	/** candidates[0] IS the baseline (the lab law). */
	candidates: OrganizationCandidate[];
	/** Default FIXTURE_RESPONSE_MODEL (the replaceable seam). */
	scorer?: CandidateScorer;
}

/** The ladder outcome: one frozen EvaluationReport per candidate plus run-level facts. */
export interface LadderRunResult {
	/** Lab scope, verbatim from request. */
	scope: LabScope;
	/** Pinned to LAB_CONTRACTS_VERSION. */
	contractVersion: string;
	/** Verbatim from request. */
	runId: string;
	/** Verbatim request. */
	request: EvaluationRequest;
	/** One per candidate, in request order. */
	reports: EvaluationReport[];
	/** reports[0]; the baseline is a candidate like any other. */
	baselineReport: EvaluationReport;
	/** Max utility (ties -> first in request order). */
	bestReport: EvaluationReport;
	/** Dense 1-based trace: ladder -> candidate* -> aggregate. */
	trace: { step: number; kind: 'ladder' | 'candidate' | 'aggregate'; detail: string }[];
}

/** Run the L0/L1/L2 ladder over the candidate list; undefined iff the request is invalid. */
export function runLadder(request: EvaluationRequest): LadderRunResult | undefined {
	// Validate utility weights: non-negative, finite.
	const w = request.utilityWeights;
	const dims: EvalDimension[] = ['success', 'quality', 'latency', 'cost'];
	for (const d of dims) {
		const v = w[d];
		if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
	}
	// Sum to 1 within 1e-9.
	const sumW = w.success + w.quality + w.latency + w.cost;
	if (Math.abs(sumW - 1) > 1e-9) return undefined;
	// Candidates non-empty.
	if (!Array.isArray(request.candidates) || request.candidates.length === 0) return undefined;
	// Scenario resolvable.
	const scenario = getScenario(request.taskScenarioId);
	if (!scenario) return undefined;
	// Seeds non-empty (L0/L1 need seeds[0]; L2 needs >= 2).
	if (!Array.isArray(request.seeds) || request.seeds.length === 0) return undefined;
	// L2 requires >= 2 seeds.
	if (request.ladderLevel === 2 && request.seeds.length < 2) return undefined;
	// L1/L2 require instanceCount > 0.
	if (request.ladderLevel >= 1 && request.instanceCount <= 0) return undefined;

	const scorer = request.scorer ?? FIXTURE_RESPONSE_MODEL;
	const difficultyBase = scenario.difficultyBase;
	const ladderLevel = request.ladderLevel;
	// L0/L1 use seeds[0]; L2 uses all seeds.
	const seedsUsed: number[] = ladderLevel <= 1 ? [request.seeds[0]] : request.seeds.slice();

	// Per-candidate per-seed scores: scoresByCandidate[ci][si] = EvalScore[]
	const scoresByCandidate: EvalScore[][][] = [];
	// Per-candidate per-seed per-dimension values for L2 robustness.
	const seedUtilitiesByCandidate: { success: number[]; quality: number[]; latency: number[]; cost: number[] }[] = [];
	for (let ci = 0; ci < request.candidates.length; ci++) {
		scoresByCandidate.push([]);
		seedUtilitiesByCandidate.push({ success: [], quality: [], latency: [], cost: [] });
	}

	for (let si = 0; si < seedsUsed.length; si++) {
		const seed = seedsUsed[si];
		const instances: WorldInstance[] = ladderLevel === 0 ? [] : generateInstances(request.taskScenarioId, seed, request.instanceCount);
		for (let ci = 0; ci < request.candidates.length; ci++) {
			const candidate = request.candidates[ci];
			const scores = scorer.scoreCandidate(candidate, instances, difficultyBase);
			scoresByCandidate[ci].push(scores);
			seedUtilitiesByCandidate[ci].success.push(scores.find((s) => s.dimension === 'success')!.value);
			seedUtilitiesByCandidate[ci].quality.push(scores.find((s) => s.dimension === 'quality')!.value);
			seedUtilitiesByCandidate[ci].latency.push(scores.find((s) => s.dimension === 'latency')!.value);
			seedUtilitiesByCandidate[ci].cost.push(scores.find((s) => s.dimension === 'cost')!.value);
		}
	}

	// Aggregate per candidate: per-dimension MEAN across seeds.
	const aggregatedScoresByCandidate: EvalScore[][] = [];
	for (let ci = 0; ci < request.candidates.length; ci++) {
		const dimMeans: EvalScore[] = dims.map((d) => {
			const vals = scoresByCandidate[ci].map((seedScores) => seedScores.find((s) => s.dimension === d)!.value);
			return { dimension: d, value: mean(vals), unit: '' };
		});
		aggregatedScoresByCandidate.push(dimMeans);
	}

	// Build reports.
	const reports: EvaluationReport[] = [];
	for (let ci = 0; ci < request.candidates.length; ci++) {
		const candidate = request.candidates[ci];
		const scores = aggregatedScoresByCandidate[ci];
		const success = scores.find((s) => s.dimension === 'success')!.value;
		const quality = scores.find((s) => s.dimension === 'quality')!.value;
		const latency = scores.find((s) => s.dimension === 'latency')!.value;
		const cost = scores.find((s) => s.dimension === 'cost')!.value;
		const utility = w.success * success + w.quality * quality + w.latency * (1 - latency) + w.cost * (1 - cost);

		// Baseline comparison (vs candidates[0]); delta positive always means better.
		const comparison: BaselineComparison[] = [];
		const baselineScores = aggregatedScoresByCandidate[0];
		for (const d of dims) {
			const cv = scores.find((s) => s.dimension === d)!.value;
			const bv = baselineScores.find((s) => s.dimension === d)!.value;
			const delta = d === 'success' || d === 'quality' ? cv - bv : bv - cv;
			comparison.push({ dimension: d, candidateValue: cv, baselineValue: bv, delta });
		}

		// Robustness only at L2.
		let robustness: RobustnessReportShape | undefined;
		if (ladderLevel === 2) {
			const su = seedUtilitiesByCandidate[ci];
			const seedVariance: { dimension: EvalDimension; variance: number }[] = [];
			const worstCase: { dimension: EvalDimension; value: number }[] = [];
			const uncertainty: { dimension: EvalDimension; low: number; high: number; confidence: number }[] = [];
			const conf = clamp01(0.5 + 0.1 * seedsUsed.length);
			for (const d of dims) {
				const xs = su[d];
				const m = mean(xs);
				const sd = stddev(xs);
				seedVariance.push({ dimension: d, variance: variance(xs) });
				// worst: min for success/quality, max for latency/cost.
				let wc = xs.length > 0 ? xs[0] : 0;
				if (d === 'success' || d === 'quality') {
					for (const x of xs) if (x < wc) wc = x;
				} else {
					for (const x of xs) if (x > wc) wc = x;
				}
				worstCase.push({ dimension: d, value: wc });
				uncertainty.push({
					dimension: d,
					low: clamp01(m - 2 * sd),
					high: clamp01(m + 2 * sd),
					confidence: conf,
				});
			}
			robustness = {
				seedsEvaluated: seedsUsed.length,
				perturbations: scenario.perturbations,
				seedVariance,
				worstCase,
				uncertainty,
			};
		}

		// Reproducible: per seed, FNV-1a hash of the joined scores string.
		const reproducible = seedsUsed.map((seed, seedIdx) => {
			const seedScores = scoresByCandidate[ci][seedIdx];
			const joined = seedScores.map((s) => `${s.dimension}:${s.value}`).join('|');
			return { seed, artifactHash: fnv1a32(joined) };
		});

		// Fixture cost/latency formulas: costUsd in USD, latencyMs in ms.
		reports.push({
			scope: request.scope,
			contractVersion: LAB_CONTRACTS_VERSION,
			id: `eval-${request.runId}-${candidate.id}`,
			runId: request.runId,
			candidate,
			scores,
			utility,
			comparison,
			robustness,
			costUsd: 0.4 * candidate.nodes.length,
			latencyMs: 30000 * candidate.nodes.length + 10000,
			safetyCompliance: [
				{ check: 'baseline-present', passed: true },
				{ check: 'weights-valid', passed: true },
				{ check: 'deterministic-engine', passed: true },
			],
			reproducible,
			evidenceLevel: scorer.evidenceLevel,
		});
	}

	// Best report: max utility; ties resolved by request order (first wins).
	let bestIndex = 0;
	let bestUtility = reports[0].utility;
	for (let i = 1; i < reports.length; i++) {
		if (reports[i].utility > bestUtility) {
			bestUtility = reports[i].utility;
			bestIndex = i;
		}
	}

	// Dense 1-based trace: ladder -> candidate* -> aggregate.
	const trace: { step: number; kind: 'ladder' | 'candidate' | 'aggregate'; detail: string }[] = [];
	let step = 1;
	trace.push({
		step: step++,
		kind: 'ladder',
		detail: `level=${ladderLevel} seeds=${seedsUsed.length} instanceCount=${request.instanceCount}`,
	});
	for (const r of reports) {
		trace.push({
			step: step++,
			kind: 'candidate',
			detail: `candidate=${r.candidate.id} utility=${r.utility}`,
		});
	}
	trace.push({
		step: step++,
		kind: 'aggregate',
		detail: `best=${reports[bestIndex].candidate.id} reports=${reports.length}`,
	});

	return {
		scope: request.scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		runId: request.runId,
		request,
		reports,
		baselineReport: reports[0],
		bestReport: reports[bestIndex],
		trace,
	};
}
