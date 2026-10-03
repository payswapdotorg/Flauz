/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-008 calibration model: folds predicted-vs-observed pairs into a multiplicative
 * correction model, plus the bridge-outcome observation adapter that mints the
 * CalibrationRecord rows the model consumes.
 *
 * DETERMINISM LAW: no Math.random, no Date.now / new Date() anywhere in this module;
 * the only time values are caller-supplied strings passed through verbatim
 * (observedAt / computedAt are injected at persistence edges). The same inputs
 * always produce a byte-identical result.
 *
 * Factor semantics (every dimension is observed / predicted over rows with
 * predicted > 0, clamped to [FACTOR_MIN, FACTOR_MAX], rounded to 3 decimals):
 *  - success / quality: factor > 1 means the Lab UNDER-predicted (real outcomes
 *    scored better than the prediction).
 *  - latency / cost: the ratio is also observed / predicted - consumers interpret
 *    the direction (factor < 1 means the real run was FASTER / CHEAPER than
 *    predicted).
 * With fewer than MIN_FACTORS_OBSERVATIONS rows the factors stay at 1 (the
 * estimate is too thin to trust); the reliability curve is still computed.
 *
 * Curve: predicted-success buckets [0,0.2), [0,0.2..0.4), [0.4..0.6), [0.6..0.8),
 * [0.8..1] -> mean predicted and mean observed success per bucket (empty buckets
 * skipped). This is the classic reliability diagram: if the Lab is calibrated,
 * observed ~= predicted per bucket.
 */

import { LAB_CONTRACTS_VERSION, type LabScope, type EvalScore, type EvalDimension, type LabEvidenceLevel, type CalibrationRecord, type EvaluationReport, type LabRecommendation, type TaskOutcome } from './labContracts.js';

/** Minimum usable rows before per-dimension factors are trusted (below: all 1). */
export const MIN_FACTORS_OBSERVATIONS = 3;

/** Factor clamp floor - corrections below 0.5x are treated as noise. */
export const FACTOR_MIN = 0.5;

/** Factor clamp ceiling - corrections beyond 2x are treated as noise. */
export const FACTOR_MAX = 2.0;

/** Decimal places used for every persisted factor / curve mean. */
const FACTOR_DECIMALS = 3;
const CURVE_DECIMALS = 4;

/** Bucket edges on predicted success: [0,0.2), [0.2,0.4), [0.4,0.6), [0.6,0.8), [0.8,1]. */
const BUCKET_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1];

/** Canonical bucket labels, index-aligned with BUCKET_EDGES intervals. */
const BUCKET_LABELS = ['0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1'];

const DIMENSIONS: EvalDimension[] = ['success', 'quality', 'latency', 'cost'];

/** FNV-1a 32-bit hash rendered as exactly 8 lowercase hex chars (deterministic; module-private). */
function fnv1a32hex(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/** Clamp a value into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
	if (v < lo) return lo;
	if (v > hi) return hi;
	return v;
}

/** Round to n decimal places (fixed-point, deterministic). */
function roundTo(value: number, decimals: number): number {
	const f = Math.pow(10, decimals);
	return Math.round(value * f) / f;
}

/** Mean of a numeric array, 0 when empty. */
function mean(xs: number[]): number {
	if (xs.length === 0) return 0;
	let s = 0;
	for (const x of xs) s += x;
	return s / xs.length;
}

/** True iff both scopes name the same workspace and tenant. */
function sameScope(a: LabScope, b: LabScope): boolean {
	return a.workspaceId === b.workspaceId && a.tenantId === b.tenantId;
}

/** True iff the record pins the exact current contract version. */
function versioned(record: { contractVersion?: string }): boolean {
	return record.contractVersion === LAB_CONTRACTS_VERSION;
}

// ---------------------------------------------------------------------------------------------
// The bridge-outcome observation adapter (the real-task observation half of LAB-008).
// ---------------------------------------------------------------------------------------------

/** One observed bridge execution folded into the calibration corpus. */
export interface BridgeObservationInput {
	/** The issued recommendation whose execution was observed (scope + linkage source). */
	recommendation: LabRecommendation;
	/** The evaluation that produced the predictions (runId linkage + predicted values). */
	evaluation: EvaluationReport;
	/** The real observed task outcome (from the LAB-010 bridge's execution lane). */
	outcome: TaskOutcome;
	/** The bridge entry the execution flowed through (linkage; the expectations note names it). */
	bridgeEntryId: string;
	/** Injected observation timestamp (ISO string; persistence edges own the clock). */
	observedAt: string;
}

/**
 * Mint the CalibrationRecord rows for one observed bridge execution: exactly 4 rows,
 * one per dimension, or undefined when a linkage gate refuses the observation.
 *
 * Prediction sources (per dimension): success/quality from evaluation.scores (0..1),
 * latency from evaluation.latencyMs, cost from evaluation.costUsd.
 * Observed sources: outcome.success (boolean -> 1/0), outcome.quality (0..1),
 * outcome.latencyMs, outcome.costUsd.
 */
export function observeBridgeOutcome(input: BridgeObservationInput): CalibrationRecord[] | undefined {
	const { recommendation, evaluation, outcome, bridgeEntryId, observedAt } = input;
	// Linkage gates - the adapter never guesses a corpus row.
	if (!versioned(recommendation) || !versioned(evaluation)) {
		return undefined;
	}
	if (!sameScope(recommendation.scope, evaluation.scope)) {
		return undefined;
	}
	if (recommendation.runId !== evaluation.runId) {
		return undefined;
	}
	const successScore = evaluation.scores.find((s) => s.dimension === 'success')?.value;
	const qualityScore = evaluation.scores.find((s) => s.dimension === 'quality')?.value;
	if (successScore === undefined || qualityScore === undefined) {
		return undefined; // a prediction row without success/quality is not calibratable
	}

	const predictedByDimension: Record<EvalDimension, number> = {
		success: successScore,
		quality: qualityScore,
		latency: evaluation.latencyMs,
		cost: evaluation.costUsd,
	};
	const observedByDimension: Record<EvalDimension, number> = {
		success: outcome.success ? 1 : 0,
		quality: outcome.quality,
		latency: outcome.latencyMs,
		cost: outcome.costUsd,
	};

	const records: CalibrationRecord[] = [];
	for (const dimension of DIMENSIONS) {
		const predicted = predictedByDimension[dimension];
		const observed = observedByDimension[dimension];
		const rawFactor = predicted > 0 && Number.isFinite(predicted) && Number.isFinite(observed)
			? observed / predicted
			: 1;
		records.push({
			scope: recommendation.scope,
			contractVersion: LAB_CONTRACTS_VERSION,
			id: `cal-${fnv1a32hex(`${recommendation.id}|${bridgeEntryId}|${dimension}|${observedAt}`)}`,
			recommendationId: recommendation.id,
			dimension,
			predicted: roundTo(predicted, FACTOR_DECIMALS),
			observed: roundTo(observed, FACTOR_DECIMALS),
			factor: roundTo(clamp(rawFactor, FACTOR_MIN, FACTOR_MAX), FACTOR_DECIMALS),
			observedAt,
		});
	}
	return records;
}

// ---------------------------------------------------------------------------------------------
// The calibration model builder (the correction half of LAB-008).
// ---------------------------------------------------------------------------------------------

/** One reliability-curve row: mean predicted vs mean observed success inside a bucket. */
export interface CalibrationCurveRow {
	/** Canonical bucket label, e.g. '0.4-0.6'. */
	bucket: string;
	/** Mean predicted success of the rows in this bucket (rounded to 4 decimals). */
	predicted: number;
	/** Mean observed success of the rows in this bucket (rounded to 4 decimals). */
	observed: number;
	/** Number of calibration rows in this bucket. */
	count: number;
}

/** The folded correction model over one calibration corpus. */
export interface CalibrationModelResult {
	/** Lab scope, copied from the first record (the corpus is single-scope by law). */
	scope: LabScope;
	/** Pinned to LAB_CONTRACTS_VERSION. */
	contractVersion: string;
	/** Per-dimension multiplicative correction (observed / predicted mean, clamped, rounded). */
	factors: Record<EvalDimension, number>;
	/** Reliability diagram on predicted-success buckets (empty buckets skipped). */
	reliabilityCurve: CalibrationCurveRow[];
	/** Total rows folded into this model. */
	observationCount: number;
	/** Honesty label for the corpus this model folds; the builder never upgrades it. */
	evidenceLevel: LabEvidenceLevel;
	/** Injected computation timestamp (ISO string; the builder itself never reads a clock). */
	computedAt: string;
}

/** Bucket index for a predicted-success value (clamped to [0,1]; the last edge is inclusive). */
function bucketIndex(predictedSuccess: number): number {
	const clamped = clamp(predictedSuccess, 0, 1);
	// Largest k in 1..4 with clamped >= BUCKET_EDGES[k]; values below the first
	// interior edge land in bucket 0. Bucket k covers [edges[k], edges[k+1]).
	for (let k = BUCKET_EDGES.length - 2; k > 0; k--) {
		if (clamped >= BUCKET_EDGES[k]) {
			return k;
		}
	}
	return 0;
}

/**
 * Fold calibration rows into the correction model. Deterministic and pure: the same
 * rows always yield the byte-identical model. Rows stamped with a foreign contract
 * version or a foreign scope are ignored entirely (scope discipline: no cross-
 * workspace/tenant leakage, ever). An empty corpus yields factors all 1, an empty
 * curve and observationCount 0. The corpus evidence label is caller-supplied and
 * defaults to 'fixture' - the builder never upgrades evidence.
 */
export function buildCalibrationModel(records: CalibrationRecord[], scope: LabScope, computedAt: string, corpusEvidenceLevel: LabEvidenceLevel = 'fixture'): CalibrationModelResult {
	// Scope + version discipline: fold only rows that match the requested scope and
	// pin the exact current contract version.
	const usable: CalibrationRecord[] = [];
	for (const record of records) {
		if (versioned(record) && sameScope(record.scope, scope)) {
			usable.push(record);
		}
	}

	// --- Factors: mean observed / predicted per dimension over rows with predicted > 0.
	const factors: Record<EvalDimension, number> = {
		success: 1,
		quality: 1,
		latency: 1,
		cost: 1,
	};
	const enoughRows = usable.length >= MIN_FACTORS_OBSERVATIONS;
	if (enoughRows) {
		for (const dimension of DIMENSIONS) {
			const ratios: number[] = [];
			for (const record of usable) {
				if (record.dimension !== dimension) continue;
				if (record.predicted > 0 && Number.isFinite(record.predicted) && Number.isFinite(record.observed)) {
					ratios.push(record.observed / record.predicted);
				}
			}
			if (ratios.length > 0) {
				factors[dimension] = roundTo(clamp(mean(ratios), FACTOR_MIN, FACTOR_MAX), FACTOR_DECIMALS);
			}
		}
	}

	// --- Reliability curve on predicted-success buckets (always computed, even below
	// the factor trust floor - the curve is descriptive, not corrective).
	const bucketPredicted: number[][] = BUCKET_LABELS.map(() => []);
	const bucketObserved: number[][] = BUCKET_LABELS.map(() => []);
	for (const record of usable) {
		if (record.dimension !== 'success') continue;
		if (!Number.isFinite(record.predicted) || !Number.isFinite(record.observed)) continue;
		const index = bucketIndex(record.predicted);
		bucketPredicted[index].push(clamp(record.predicted, 0, 1));
		bucketObserved[index].push(clamp(record.observed, 0, 1));
	}
	const reliabilityCurve: CalibrationCurveRow[] = [];
	for (let i = 0; i < BUCKET_LABELS.length; i++) {
		const count = bucketPredicted[i].length;
		if (count === 0) continue; // skip empty buckets
		reliabilityCurve.push({
			bucket: BUCKET_LABELS[i],
			predicted: roundTo(mean(bucketPredicted[i]), CURVE_DECIMALS),
			observed: roundTo(mean(bucketObserved[i]), CURVE_DECIMALS),
			count,
		});
	}

	return {
		scope,
		contractVersion: LAB_CONTRACTS_VERSION,
		factors,
		reliabilityCurve,
		observationCount: usable.length,
		evidenceLevel: corpusEvidenceLevel,
		computedAt,
	};
}

// ---------------------------------------------------------------------------------------------
// Corrected predictions (the improved-recommendation seam LAB-011 consumes).
// ---------------------------------------------------------------------------------------------

/**
 * Apply the model's factors to one prediction score set: every dimension's value is
 * multiplied by its factor and clamped into 0..1 (roundTo 3 decimals). Direction
 * interpretation stays with the consumer: success/quality higher-better, latency/cost
 * lower-better (a latency factor > 1 makes the corrected latency WORSE, which is the
 * honest outcome when real runs were slower than predicted).
 */
export function correctScores(scores: EvalScore[], model: CalibrationModelResult): EvalScore[] {
	const corrected: EvalScore[] = [];
	for (const score of scores) {
		const factor = model.factors[score.dimension] ?? 1;
		const value = roundTo(clamp(score.value * factor, 0, 1), FACTOR_DECIMALS);
		corrected.push({ dimension: score.dimension, value, unit: score.unit });
	}
	return corrected;
}
