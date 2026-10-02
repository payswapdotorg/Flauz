/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for build/flauz/lab/common/calibration.ts (LAB-008, Flauz, TL-B lane).
 *
 * Deterministic by construction: frozen literal fixtures, injected ISO timestamps,
 * no clock or random sources. The station gate (scoped strict tsc + mocha tdd over the
 * merged lab tree) is the execution authority.
 */

import assert from 'assert';
import {
	FACTOR_MAX,
	FACTOR_MIN,
	MIN_FACTORS_OBSERVATIONS,
	buildCalibrationModel,
	correctScores,
	observeBridgeOutcome,
	type BridgeObservationInput,
	type CalibrationModelResult,
} from '../../common/calibration.js';
import type { CalibrationRecord, EvaluationReport, LabRecommendation, LabScope, TaskOutcome } from '../../common/labContracts.js';

type RecommendationFixture = LabRecommendation;
type EvaluationFixture = EvaluationReport;
type OutcomeFixture = TaskOutcome;

const SCOPE: LabScope = { workspaceId: 'ws-cal-lab', tenantId: 'tenant-cal' };
const OBSERVED_AT = '2026-03-01T12:00:00.000Z';
const COMPUTED_AT = '2026-03-02T08:00:00.000Z';
const BRIDGE_ENTRY_ID = 'bridge-1a2b3c4d';

const recommendation: RecommendationFixture = {
	scope: SCOPE,
	contractVersion: '1.0.0',
	id: 'rec-cal-001',
	runId: 'run-cal-007',
	organization: {
		scope: SCOPE,
		contractVersion: '1.0.0',
		id: 'org-cal-001',
		name: 'Calibration fixture organization',
		topology: 'pipeline',
		nodes: [
			{ id: 'node-a', bodyId: 'body-implementer', role: 'implementer' },
			{ id: 'node-b', bodyId: 'body-code-reviewer', role: 'reviewer', reportsTo: 'node-a' },
		],
		edges: [{ from: 'node-a', to: 'node-b', kind: 'review' }],
		occupancy: [
			{ nodeId: 'node-a', modelId: 'fixture-model-a' },
			{ nodeId: 'node-b', modelId: 'fixture-model-b' },
		],
		capabilities: [
			{ nodeId: 'node-a', toolIds: ['flauz.workspace.createTask'] },
			{ nodeId: 'node-b', toolIds: ['flauz.workspace.appendEvidence'] },
		],
	},
	rationale: 'Calibration wave fixture: a two-node pipeline with known prediction error.',
	expectedGains: [],
	confidence: 0.75,
	caveats: ['Fixture-only evidence.'],
	reversible: true,
	auditTrail: ['run-cal-007 issued rec-cal-001 for the calibration wave'],
	status: 'issued',
	createdAt: '2026-02-20T09:00:00.000Z',
};

const evaluation: EvaluationFixture = {
	scope: SCOPE,
	contractVersion: '1.0.0',
	id: 'eval-run-cal-007-org-cal-001',
	runId: 'run-cal-007',
	candidate: recommendation.organization,
	scores: [
		{ dimension: 'success', value: 0.8, unit: '' },
		{ dimension: 'quality', value: 0.6, unit: '' },
		{ dimension: 'latency', value: 0.4, unit: '' },
		{ dimension: 'cost', value: 0.3, unit: '' },
	],
	utility: 0.5,
	comparison: [],
	costUsd: 1.2,
	latencyMs: 30000,
	safetyCompliance: [{ check: 'fixture', passed: true }],
	reproducible: [{ seed: 7 }],
	evidenceLevel: 'fixture',
};

const outcome: OutcomeFixture = {
	success: true,
	quality: 0.9,
	latencyMs: 36000,
	costUsd: 0.96,
	verification: [{ check: 'fixture-outcome', passed: true }],
};

function observationInput(): BridgeObservationInput {
	return { recommendation, evaluation, outcome, bridgeEntryId: BRIDGE_ENTRY_ID, observedAt: OBSERVED_AT };
}

/** Hand-write a calibration row (model-builder fixtures stay independent of the adapter). */
function row(dimension: CalibrationRecord['dimension'], predicted: number, observed: number, id: string): CalibrationRecord {
	return {
		scope: SCOPE,
		contractVersion: '1.0.0',
		id,
		recommendationId: 'rec-cal-001',
		dimension,
		predicted,
		observed,
		factor: 1,
		observedAt: OBSERVED_AT,
	};
}

suite('calibration', () => {

	suite('observeBridgeOutcome gates', () => {

		test('refuses a recommendation stamped with a foreign contract version', () => {
			const input = observationInput();
			input.recommendation = { ...recommendation, contractVersion: '0.9.0' };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses an evaluation stamped with a foreign contract version', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, contractVersion: '2.0.0' };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses a workspace mismatch between recommendation and evaluation', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, scope: { workspaceId: 'ws-other', tenantId: 'tenant-cal' } };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses a tenant mismatch between recommendation and evaluation', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, scope: { workspaceId: 'ws-cal-lab', tenantId: 'tenant-other' } };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses an evaluation from a different run (the linkage must match)', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, runId: 'run-cal-999' };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses an evaluation without a success score (not calibratable)', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, scores: evaluation.scores.filter((s) => s.dimension !== 'success') };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});

		test('refuses an evaluation without a quality score (not calibratable)', () => {
			const input = observationInput();
			input.evaluation = { ...evaluation, scores: evaluation.scores.filter((s) => s.dimension !== 'quality') };
			assert.strictEqual(observeBridgeOutcome(input), undefined);
		});
	});

	suite('observeBridgeOutcome rows', () => {

		test('mints exactly 4 rows, one per dimension, in canonical order', () => {
			const records = observeBridgeOutcome(observationInput());
			assert.ok(records);
			assert.deepStrictEqual(records.map((r) => r.dimension), ['success', 'quality', 'latency', 'cost']);
		});

		test('prediction sources: success/quality from scores, latency/cost from the report fields', () => {
			const records = observeBridgeOutcome(observationInput());
			assert.ok(records);
			assert.strictEqual(records[0].predicted, 0.8);
			assert.strictEqual(records[1].predicted, 0.6);
			assert.strictEqual(records[2].predicted, 30000);
			assert.strictEqual(records[3].predicted, 1.2);
		});

		test('observed success folds the boolean to 1; other observed values pass through', () => {
			const records = observeBridgeOutcome(observationInput());
			assert.ok(records);
			assert.strictEqual(records[0].observed, 1);
			assert.strictEqual(records[1].observed, 0.9);
			assert.strictEqual(records[2].observed, 36000);
			assert.strictEqual(records[3].observed, 0.96);
		});

		test('factor is observed/predicted, rounded to 3 decimals (hand-computed)', () => {
			const records = observeBridgeOutcome(observationInput());
			assert.ok(records);
			assert.strictEqual(records[0].factor, 1.25); // 1 / 0.8
			assert.strictEqual(records[1].factor, 1.5); // 0.9 / 0.6
			assert.strictEqual(records[2].factor, 1.2); // 36000 / 30000
			assert.strictEqual(records[3].factor, 0.8); // 0.96 / 1.2
		});

		test('clamps the factor at FACTOR_MAX when the real run far overshot the prediction', () => {
			const input = observationInput();
			input.outcome = { ...outcome, latencyMs: 75000 };
			const records = observeBridgeOutcome(input);
			assert.ok(records);
			assert.strictEqual(records[2].factor, FACTOR_MAX); // 75000/30000 = 2.5 -> 2
		});

		test('clamps the factor at FACTOR_MIN when the observed success is false', () => {
			const input = observationInput();
			input.outcome = { ...outcome, success: false };
			const records = observeBridgeOutcome(input);
			assert.ok(records);
			assert.strictEqual(records[0].factor, FACTOR_MIN); // 0/0.8 = 0 -> 0.5
		});

		test('records carry the recommendation scope, version, id and observedAt verbatim', () => {
			const records = observeBridgeOutcome(observationInput());
			assert.ok(records);
			for (const record of records) {
				assert.deepStrictEqual(record.scope, SCOPE);
				assert.strictEqual(record.contractVersion, '1.0.0');
				assert.strictEqual(record.recommendationId, 'rec-cal-001');
				assert.strictEqual(record.observedAt, OBSERVED_AT);
			}
		});

		test('record ids are deterministic and differ per dimension', () => {
			const a = observeBridgeOutcome(observationInput());
			const b = observeBridgeOutcome(observationInput());
			assert.ok(a && b);
			assert.deepStrictEqual(a.map((r) => r.id), b.map((r) => r.id));
			assert.strictEqual(new Set(a.map((r) => r.id)).size, 4);
			assert.ok(a.every((r) => /^cal-[0-9a-f]{8}$/.test(r.id)));
		});

		test('record ids change when the observation timestamp changes', () => {
			const a = observeBridgeOutcome(observationInput());
			const input = observationInput();
			input.observedAt = '2026-03-05T12:00:00.000Z';
			const b = observeBridgeOutcome(input);
			assert.ok(a && b);
			assert.notDeepStrictEqual(a.map((r) => r.id), b.map((r) => r.id));
		});
	});

	suite('buildCalibrationModel', () => {

		test('empty corpus: factors all 1, empty curve, observationCount 0', () => {
			const model = buildCalibrationModel([], SCOPE, COMPUTED_AT);
			assert.deepStrictEqual(model.factors, { success: 1, quality: 1, latency: 1, cost: 1 });
			assert.deepStrictEqual(model.reliabilityCurve, []);
			assert.strictEqual(model.observationCount, 0);
		});

		test('below the trust floor the factors stay 1 but the curve still computes', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-a1'),
				row('success', 0.8, 1.0, 'cal-a2'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(rows.length < MIN_FACTORS_OBSERVATIONS, true);
			assert.deepStrictEqual(model.factors, { success: 1, quality: 1, latency: 1, cost: 1 });
			assert.strictEqual(model.reliabilityCurve.length, 1);
			assert.strictEqual(model.observationCount, 2);
		});

		test('at the trust floor the factor is the clamped mean ratio, rounded to 3 decimals', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-b1'), // ratio 1.125
				row('success', 0.8, 1.0, 'cal-b2'), // ratio 1.25
				row('success', 0.8, 0.7, 'cal-b3'), // ratio 0.875
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.factors.success, 1.083); // mean(1.125, 1.25, 0.875) = 1.0833...
		});

		test('dimensions without usable rows keep factor 1 even above the trust floor', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-c1'),
				row('success', 0.8, 1.0, 'cal-c2'),
				row('success', 0.8, 0.7, 'cal-c3'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.factors.quality, 1);
			assert.strictEqual(model.factors.latency, 1);
			assert.strictEqual(model.factors.cost, 1);
		});

		test('the factor mean clamps into [FACTOR_MIN, FACTOR_MAX]', () => {
			const rows = [
				row('cost', 1.0, 2.4, 'cal-d1'), // ratio 2.4
				row('cost', 1.0, 2.2, 'cal-d2'), // ratio 2.2
				row('cost', 1.0, 2.6, 'cal-d3'), // ratio 2.6
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.factors.cost, FACTOR_MAX); // mean 2.4 -> 2
		});

		test('scope discipline: foreign-scope rows are ignored entirely', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-e1'),
				{ ...row('success', 0.5, 0.5, 'cal-e2'), scope: { workspaceId: 'ws-other', tenantId: 'tenant-cal' } },
				row('success', 0.8, 1.0, 'cal-e3'),
				row('success', 0.8, 0.7, 'cal-e4'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.observationCount, 3);
			assert.strictEqual(model.factors.success, 1.083);
		});

		test('version discipline: foreign-version rows are ignored entirely', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-f1'),
				{ ...row('success', 0.5, 0.5, 'cal-f2'), contractVersion: '0.9.0' },
				row('success', 0.8, 1.0, 'cal-f3'),
				row('success', 0.8, 0.7, 'cal-f4'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.observationCount, 3);
		});

		test('the reliability curve buckets predicted success and skips empty buckets', () => {
			const rows = [
				row('success', 0.15, 0.1, 'cal-g1'), // bucket 0-0.2
				row('success', 0.25, 0.3, 'cal-g2'), // bucket 0.2-0.4
				row('success', 0.35, 0.4, 'cal-g3'), // bucket 0.2-0.4
				row('success', 0.9, 0.85, 'cal-g4'), // bucket 0.8-1 (last edge inclusive)
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.deepStrictEqual(model.reliabilityCurve.map((r) => r.bucket), ['0-0.2', '0.2-0.4', '0.8-1']);
		});

		test('the reliability curve carries mean predicted, mean observed and the row count', () => {
			const rows = [
				row('success', 0.25, 0.3, 'cal-h1'),
				row('success', 0.35, 0.5, 'cal-h2'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			const bucket = model.reliabilityCurve.find((r) => r.bucket === '0.2-0.4');
			assert.ok(bucket);
			assert.strictEqual(bucket.predicted, 0.3); // mean(0.25, 0.35)
			assert.strictEqual(bucket.observed, 0.4); // mean(0.3, 0.5)
			assert.strictEqual(bucket.count, 2);
		});

		test('non-success rows never land in the reliability curve', () => {
			const rows = [
				row('quality', 0.6, 0.9, 'cal-i1'),
				row('cost', 1.2, 0.96, 'cal-i2'),
			];
			const model = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.deepStrictEqual(model.reliabilityCurve, []);
		});

		test('the model pins the contract version, the scope and the injected computedAt', () => {
			const model = buildCalibrationModel([row('success', 0.8, 0.9, 'cal-j1')], SCOPE, COMPUTED_AT);
			assert.strictEqual(model.contractVersion, '1.0.0');
			assert.deepStrictEqual(model.scope, SCOPE);
			assert.strictEqual(model.computedAt, COMPUTED_AT);
		});

		test('the corpus evidence label is caller-supplied and defaults to fixture', () => {
			const rows = [row('success', 0.8, 0.9, 'cal-k1')];
			assert.strictEqual(buildCalibrationModel(rows, SCOPE, COMPUTED_AT).evidenceLevel, 'fixture');
			assert.strictEqual(buildCalibrationModel(rows, SCOPE, COMPUTED_AT, 'local-real').evidenceLevel, 'local-real');
		});

		test('deterministic: the same corpus yields a byte-identical model', () => {
			const rows = [
				row('success', 0.8, 0.9, 'cal-l1'),
				row('quality', 0.6, 0.9, 'cal-l2'),
				row('latency', 30000, 36000, 'cal-l3'),
			];
			const a = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			const b = buildCalibrationModel(rows, SCOPE, COMPUTED_AT);
			assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
		});
	});

	suite('correctScores', () => {

		function modelWith(factors: CalibrationModelResult['factors']): CalibrationModelResult {
			return {
				scope: SCOPE,
				contractVersion: '1.0.0',
				factors,
				reliabilityCurve: [],
				observationCount: 3,
				evidenceLevel: 'fixture',
				computedAt: COMPUTED_AT,
			};
		}

		test('multiplies every dimension by its factor, rounded to 3 decimals', () => {
			const model = modelWith({ success: 1.25, quality: 1.5, latency: 1.2, cost: 0.8 });
			const corrected = correctScores(evaluation.scores, model);
			assert.deepStrictEqual(
				corrected.map((s) => s.value),
				[1, 0.9, 0.48, 0.24],
			);
		});

		test('clamps corrected values into 0..1 (success cannot exceed 1)', () => {
			const model = modelWith({ success: 1.5, quality: 1, latency: 1, cost: 1 });
			const corrected = correctScores(evaluation.scores, model);
			assert.strictEqual(corrected[0].value, 1); // 0.8 * 1.5 = 1.2 -> 1
			assert.strictEqual(corrected[2].value, 0.4); // unchanged
		});

		test('a latency factor above 1 makes the corrected latency WORSE (honest direction)', () => {
			const model = modelWith({ success: 1, quality: 1, latency: 1.2, cost: 1 });
			const corrected = correctScores(evaluation.scores, model);
			assert.strictEqual(corrected[2].value, 0.48); // 0.4 * 1.2 - higher normalized latency = worse
		});

		test('factor 1 dimensions pass through unchanged', () => {
			const model = modelWith({ success: 1, quality: 1, latency: 1, cost: 1 });
			const corrected = correctScores(evaluation.scores, model);
			assert.deepStrictEqual(
				corrected.map((s) => s.value),
				evaluation.scores.map((s) => s.value),
			);
		});

		test('preserves the dimension order and the unit strings verbatim', () => {
			const model = modelWith({ success: 1.1, quality: 1, latency: 1, cost: 1 });
			const corrected = correctScores(evaluation.scores, model);
			assert.deepStrictEqual(
				corrected.map((s) => s.dimension),
				['success', 'quality', 'latency', 'cost'],
			);
			assert.ok(corrected.every((s, i) => s.unit === evaluation.scores[i].unit));
		});

		test('deterministic: the same scores and model yield a byte-identical correction', () => {
			const model = modelWith({ success: 1.25, quality: 1.5, latency: 1.2, cost: 0.8 });
			assert.strictEqual(
				JSON.stringify(correctScores(evaluation.scores, model)),
				JSON.stringify(correctScores(evaluation.scores, model)),
			);
		});
	});

	suite('closed-lane smoke (adapter -> model -> correction)', () => {

		test('three observed executions fold into a model whose factors correct the next prediction', () => {
			// Three bridge executions with the same prediction error profile:
			// success 0.8 predicted / 1.0 observed (ratio 1.25) on every execution.
			const outcomes: OutcomeFixture[] = [
				{ ...outcome, quality: 0.9 },
				{ ...outcome, quality: 0.9 },
				{ ...outcome, quality: 0.9 },
			];
			const corpus: CalibrationRecord[] = [];
			for (let i = 0; i < outcomes.length; i++) {
				const input = observationInput();
				input.outcome = outcomes[i];
				input.observedAt = `2026-03-0${i + 1}T12:00:00.000Z`;
				const records = observeBridgeOutcome(input);
				assert.ok(records);
				corpus.push(...records);
			}
			const model = buildCalibrationModel(corpus, SCOPE, COMPUTED_AT);
			assert.strictEqual(model.observationCount, 12); // 4 rows per execution
			assert.strictEqual(model.factors.success, 1.25); // mean(1.25, 1.25, 1.25)
			assert.strictEqual(model.factors.latency, 1.2);
			const corrected = correctScores(evaluation.scores, model);
			assert.strictEqual(corrected[0].value, 1); // 0.8 * 1.25 = 1.0
			assert.strictEqual(corrected[2].value, 0.48); // 0.4 * 1.2
		});
	});
});
