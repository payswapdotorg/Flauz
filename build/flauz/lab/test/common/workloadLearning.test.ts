/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * LAB-002 (fixture lane) unit tests for the deterministic workload learner.
 *
 * EVIDENCE HONESTY: the in-repo gate (mocha-based VS Code test runner) is NOT available in the
 * authoring sandbox — these tests were authored here and executed only against a minimal
 * mocha-compatible shim plus a reconstructed labContracts stub (see the completion report);
 * TL-B runs the real gate. Every expected value below is hand-computed from the documented
 * formulas and the literal fixture corpus.
 */

import assert from 'assert';

import {
	type LabActivityRecord,
	type WorkloadLearningControls,
	deriveSignals,
	deriveTaskMix,
	inferTaskTypeId,
	learnWorkloadProfile,
	separateLearningState,
} from '../../common/workloadLearning.js';

// --- fixture corpus (deterministic: written literally, no generation) --------------------------

// Fixed "now" for every learner call — caller-supplied per the determinism law.
const NOW_ISO = '2024-06-30T12:00:00Z';

// First fixture scope (workspace/tenant pair).
const SCOPE_ALPHA = { workspaceId: 'ws-alpha', tenantId: 'tenant-one' };

// Second fixture scope (workspace/tenant pair).
const SCOPE_BETA = { workspaceId: 'ws-beta', tenantId: 'tenant-two' };

// 18 records, 5 task families, 2 scopes, fixed ISO timestamps, literal values.
// The 30-day retention window ending at NOW_ISO cuts at 2024-05-31T12:00:00Z:
// A1..A10 and B1..B4 are inside it; A11, A12, B5, B6 are outside it.
const FIXTURE_RECORDS: LabActivityRecord[] = [
	// --- scope ws-alpha / tenant-one (12 records) ---
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'shell', 'vcs', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 150,
		complexityHint: 0.8,
		parallelThreads: 2,
		humanInterventions: 1,
		requiredReview: false,
		qualitySensitivity: 0.9,
		costSensitivity: 0.3,
		latencySensitivity: 0.4,
		occurredAt: '2024-06-28T09:15:00Z', // A1
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'vcs', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 120,
		complexityHint: 0.7,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.8,
		costSensitivity: 0.2,
		latencySensitivity: 0.3,
		occurredAt: '2024-06-25T14:30:00Z', // A2
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: true,
		durationMinutes: 90,
		complexityHint: 0.6,
		parallelThreads: 1,
		humanInterventions: 1,
		requiredReview: false,
		qualitySensitivity: 0.7,
		costSensitivity: 0.4,
		latencySensitivity: 0.5,
		occurredAt: '2024-06-20T10:00:00Z', // A3
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'bugfix',
		toolKinds: ['editor', 'shell', 'vcs'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 60,
		complexityHint: 0.5,
		parallelThreads: 1,
		humanInterventions: 2,
		requiredReview: true,
		qualitySensitivity: 0.8,
		costSensitivity: 0.5,
		latencySensitivity: 0.7,
		occurredAt: '2024-06-27T16:45:00Z', // A4
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'bugfix',
		toolKinds: ['editor', 'shell'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 45,
		complexityHint: 0.4,
		parallelThreads: 1,
		humanInterventions: 1,
		requiredReview: true,
		qualitySensitivity: 0.7,
		costSensitivity: 0.4,
		latencySensitivity: 0.6,
		occurredAt: '2024-06-22T11:20:00Z', // A5
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'bugfix',
		toolKinds: ['editor', 'vcs', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 75,
		complexityHint: 0.5,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.6,
		costSensitivity: 0.3,
		latencySensitivity: 0.5,
		occurredAt: '2024-06-10T08:05:00Z', // A6
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'refactor',
		toolKinds: ['editor', 'vcs'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 55,
		complexityHint: 0.35,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.5,
		costSensitivity: 0.2,
		latencySensitivity: 0.2,
		occurredAt: '2024-06-18T13:10:00Z', // A7
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'refactor',
		toolKinds: ['editor'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 40,
		complexityHint: 0.3,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.4,
		costSensitivity: 0.1,
		latencySensitivity: 0.1,
		occurredAt: '2024-06-05T15:40:00Z', // A8
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'investigation',
		toolKinds: ['shell', 'browser'],
		usedBrowser: true,
		usedEnvironment: false,
		durationMinutes: 200,
		complexityHint: 0.75,
		parallelThreads: 2,
		humanInterventions: 3,
		requiredReview: false,
		qualitySensitivity: 0.6,
		costSensitivity: 0.3,
		latencySensitivity: 0.8,
		occurredAt: '2024-06-26T10:30:00Z', // A9
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'investigation',
		toolKinds: ['shell', 'browser', 'editor'],
		usedBrowser: true,
		usedEnvironment: true,
		durationMinutes: 240,
		complexityHint: 0.85,
		parallelThreads: 2,
		humanInterventions: 4,
		requiredReview: false,
		qualitySensitivity: 0.5,
		costSensitivity: 0.4,
		latencySensitivity: 0.9,
		occurredAt: '2024-06-12T17:55:00Z', // A10
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'review',
		toolKinds: ['vcs'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 30,
		complexityHint: 0.25,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: true,
		qualitySensitivity: 0.9,
		costSensitivity: 0.2,
		latencySensitivity: 0.3,
		occurredAt: '2024-04-15T09:00:00Z', // A11 (outside the 30-day window)
	},
	{
		scope: SCOPE_ALPHA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'vcs'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 100,
		complexityHint: 0.65,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.6,
		costSensitivity: 0.2,
		latencySensitivity: 0.4,
		occurredAt: '2024-03-20T10:30:00Z', // A12 (outside the 30-day window)
	},
	// --- scope ws-beta / tenant-two (6 records) ---
	{
		scope: SCOPE_BETA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'shell', 'vcs', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 180,
		complexityHint: 0.9,
		parallelThreads: 3,
		humanInterventions: 2,
		requiredReview: false,
		qualitySensitivity: 0.9,
		costSensitivity: 0.6,
		latencySensitivity: 0.5,
		occurredAt: '2024-06-29T08:00:00Z', // B1
	},
	{
		scope: SCOPE_BETA,
		taskFamily: 'feature',
		toolKinds: ['editor', 'test-runner'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 100,
		complexityHint: 0.6,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.7,
		costSensitivity: 0.3,
		latencySensitivity: 0.4,
		occurredAt: '2024-06-15T12:30:00Z', // B2
	},
	{
		scope: SCOPE_BETA,
		taskFamily: 'bugfix',
		toolKinds: ['editor', 'shell'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 50,
		complexityHint: 0.45,
		parallelThreads: 1,
		humanInterventions: 1,
		requiredReview: true,
		qualitySensitivity: 0.8,
		costSensitivity: 0.5,
		latencySensitivity: 0.8,
		occurredAt: '2024-06-24T09:45:00Z', // B3
	},
	{
		scope: SCOPE_BETA,
		taskFamily: 'investigation',
		toolKinds: ['shell', 'browser'],
		usedBrowser: true,
		usedEnvironment: false,
		durationMinutes: 160,
		complexityHint: 0.7,
		parallelThreads: 1,
		humanInterventions: 2,
		requiredReview: false,
		qualitySensitivity: 0.5,
		costSensitivity: 0.2,
		latencySensitivity: 0.9,
		occurredAt: '2024-06-08T14:20:00Z', // B4
	},
	{
		scope: SCOPE_BETA,
		taskFamily: 'refactor',
		toolKinds: ['editor', 'vcs'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 35,
		complexityHint: 0.25,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: false,
		qualitySensitivity: 0.4,
		costSensitivity: 0.1,
		latencySensitivity: 0.1,
		occurredAt: '2024-02-10T16:00:00Z', // B5 (outside the 30-day window)
	},
	{
		scope: SCOPE_BETA,
		taskFamily: 'review',
		toolKinds: ['vcs', 'editor'],
		usedBrowser: false,
		usedEnvironment: false,
		durationMinutes: 25,
		complexityHint: 0.2,
		parallelThreads: 1,
		humanInterventions: 0,
		requiredReview: true,
		qualitySensitivity: 0.9,
		costSensitivity: 0.3,
		latencySensitivity: 0.2,
		occurredAt: '2024-01-05T11:10:00Z', // B6 (outside the 30-day window)
	},
];

// --- helpers and shared controls ----------------------------------------------------------------

/** Records belonging to the given scope (structural match on workspaceId + tenantId). */
function recordsForScope(records: LabActivityRecord[], scope: { workspaceId: string; tenantId: string }): LabActivityRecord[] {
	return records.filter(record => record.scope.workspaceId === scope.workspaceId && record.scope.tenantId === scope.tenantId);
}

/** Look up a derived signal by kind (fails the test when the kind is missing). */
function signalByKind(signals: { kind: string; label: string; weight: number; value: number }[], kind: string): { kind: string; label: string; weight: number; value: number } {
	const signal = signals.find(candidate => candidate.kind === kind);
	assert.ok(signal, `expected a '${kind}' signal`);
	return signal;
}

// Opted-in controls with a 30-day retention window (no delete cutoff).
const CONTROLS_OPTED_IN_30D: WorkloadLearningControls = { optIn: true, retentionDays: 30, exportable: true };

// Opted-in controls with a 365-day retention window (no delete cutoff).
const CONTROLS_OPTED_IN_365D: WorkloadLearningControls = { optIn: true, retentionDays: 365, exportable: true };

// The 12 ws-alpha records of the corpus.
const ALPHA_RECORDS: LabActivityRecord[] = recordsForScope(FIXTURE_RECORDS, SCOPE_ALPHA);

// --- tests --------------------------------------------------------------------------------------

suite('workloadLearning', () => {

	test('opt-in gate: returns null when optIn is false, even with records', () => {
		const optedOut: WorkloadLearningControls = { optIn: false, retentionDays: 30, exportable: true };
		assert.strictEqual(learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, optedOut, 'profile-alpha', NOW_ISO), null);
		// the gate holds even when a delete cutoff is set and records are plentiful
		const optedOutWithDelete: WorkloadLearningControls = { optIn: false, retentionDays: 365, exportable: false, deleteAllBefore: '2024-06-01T00:00:00Z' };
		assert.strictEqual(learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, optedOutWithDelete, 'profile-alpha', NOW_ISO), null);
	});

	test('retention window: old records are excluded before any derivation and the counts move', () => {
		const last30Days = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_30D, 'profile-alpha', NOW_ISO);
		const last365Days = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_365D, 'profile-alpha', NOW_ISO);
		assert.ok(last30Days);
		assert.ok(last365Days);
		// A11 (2024-04-15) and A12 (2024-03-20) fall outside the 30-day window ending 2024-05-31T12:00:00Z
		assert.strictEqual(last30Days.retainedRecordCount, 10);
		assert.strictEqual(last30Days.excludedRecordCount, 2);
		assert.strictEqual(last365Days.retainedRecordCount, 12);
		assert.strictEqual(last365Days.excludedRecordCount, 0);
		// 10 retained records are enough history — only the fixture-evidence marker remains
		assert.strictEqual(last30Days.warnings.includes('insufficient-history'), false);
		assert.strictEqual(last30Days.warnings.includes('fixture-evidence'), true);
		// the old review-family record is excluded, so the 30-day mix has no tt-review-* entry;
		// feature and bugfix tie at 3/10 -> id asc puts bugfix first
		assert.deepStrictEqual(last30Days.profile.taskMix.map(entry => entry.taskTypeId), [
			'tt-bugfix-review',
			'tt-feature-tests',
			'tt-investigation-runtime-check',
			'tt-refactor-diff-inspection',
		]);
		assert.strictEqual(last30Days.profile.taskMix.find(entry => entry.taskTypeId === 'tt-feature-tests')?.share, 0.3);
	});

	test('retention boundary is strict: a record exactly at nowIso - retentionDays is excluded', () => {
		const atBoundary: LabActivityRecord = {
			scope: SCOPE_ALPHA,
			taskFamily: 'feature',
			toolKinds: ['editor'],
			usedBrowser: false,
			usedEnvironment: false,
			durationMinutes: 30,
			complexityHint: 0.5,
			parallelThreads: 1,
			humanInterventions: 0,
			requiredReview: false,
			qualitySensitivity: 0.5,
			costSensitivity: 0.5,
			latencySensitivity: 0.5,
			occurredAt: '2024-05-31T12:00:00Z', // exactly nowIso - 30d
		};
		const justInside: LabActivityRecord = {
			scope: SCOPE_ALPHA,
			taskFamily: 'feature',
			toolKinds: ['editor'],
			usedBrowser: false,
			usedEnvironment: false,
			durationMinutes: 30,
			complexityHint: 0.5,
			parallelThreads: 1,
			humanInterventions: 0,
			requiredReview: false,
			qualitySensitivity: 0.5,
			costSensitivity: 0.5,
			latencySensitivity: 0.5,
			occurredAt: '2024-05-31T12:01:00Z', // one minute inside the window
		};
		const result = learnWorkloadProfile(SCOPE_ALPHA, [atBoundary, justInside], CONTROLS_OPTED_IN_30D, 'profile-boundary', NOW_ISO);
		assert.ok(result);
		assert.strictEqual(result.retainedRecordCount, 1); // strictly-newer-than only
		assert.strictEqual(result.excludedRecordCount, 1); // exactly-at-boundary loses
	});

	test('deleteAllBefore: records at/after the cutoff are excluded (boundary-equal record goes)', () => {
		// the cutoff equals A5's occurredAt exactly
		const controls: WorkloadLearningControls = { optIn: true, retentionDays: 365, exportable: true, deleteAllBefore: '2024-06-22T11:20:00Z' };
		const result = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, controls, 'profile-alpha', NOW_ISO);
		assert.ok(result);
		// excluded: A1 (06-28), A2 (06-25), A4 (06-27), A5 (06-22T11:20 — exactly at the cutoff), A9 (06-26)
		assert.strictEqual(result.retainedRecordCount, 7);
		assert.strictEqual(result.excludedRecordCount, 5);
		// retained: A3, A6, A7, A8, A10, A11, A12 -> feature 2, refactor 2, bugfix 1, investigation 1, review 1
		assert.deepStrictEqual(result.profile.taskMix.map(entry => entry.taskTypeId), [
			'tt-feature-tests',
			'tt-refactor-diff-inspection',
			'tt-bugfix-tests',
			'tt-investigation-runtime-check',
			'tt-review-review',
		]);
		// with the review-required bugfixes A4/A5 deleted, the surviving bugfix A6 (test runner)
		// derives 'tests' instead of 'review' — the delete support demonstrably changes derivation
		assert.strictEqual(result.profile.taskMix.find(entry => entry.taskTypeId === 'tt-bugfix-tests')?.share, 0.1429); // 1/7
	});

	test('determinism: identical inputs produce deep-equal results across runs', () => {
		const controls: WorkloadLearningControls = { optIn: true, retentionDays: 365, exportable: true, deleteAllBefore: '2024-06-01T00:00:00Z' };
		const first = learnWorkloadProfile(SCOPE_ALPHA, FIXTURE_RECORDS, controls, 'profile-alpha', NOW_ISO);
		const second = learnWorkloadProfile(SCOPE_ALPHA, FIXTURE_RECORDS, controls, 'profile-alpha', NOW_ISO);
		assert.ok(first);
		assert.ok(second);
		assert.deepStrictEqual(first, second);
		assert.deepStrictEqual(deriveSignals(ALPHA_RECORDS), deriveSignals(ALPHA_RECORDS));
		assert.deepStrictEqual(deriveTaskMix(ALPHA_RECORDS), deriveTaskMix(ALPHA_RECORDS));
		assert.strictEqual(inferTaskTypeId('Feature Work', 'Runtime Check'), inferTaskTypeId('Feature Work', 'Runtime Check'));
	});

	test('taskMix: shares sum to ~1 and are sorted descending with a deterministic tie-break', () => {
		const mix = deriveTaskMix(ALPHA_RECORDS);
		// 12 records: feature 4, bugfix 3, investigation 2, refactor 2, review 1;
		// investigation/refactor tie at 2/12 -> id asc puts investigation first
		assert.deepStrictEqual(mix.map(entry => entry.taskTypeId), [
			'tt-feature-tests',
			'tt-bugfix-review',
			'tt-investigation-runtime-check',
			'tt-refactor-diff-inspection',
			'tt-review-review',
		]);
		assert.deepStrictEqual(mix.map(entry => entry.share), [0.3333, 0.25, 0.1667, 0.1667, 0.0833]);
		const sum = mix.reduce((total, entry) => total + entry.share, 0);
		assert.ok(Math.abs(sum - 1) < 1e-6, `shares must sum to ~1, got ${sum}`);
		for (let i = 1; i < mix.length; i++) {
			assert.ok(mix[i - 1].share >= mix[i].share, 'shares must be sorted descending');
		}
	});

	test('inferTaskTypeId: deterministic tt-<family>-<style> slug', () => {
		assert.strictEqual(inferTaskTypeId('feature', 'tests'), 'tt-feature-tests');
		assert.strictEqual(inferTaskTypeId('bugfix', 'diff-inspection'), 'tt-bugfix-diff-inspection');
		assert.strictEqual(inferTaskTypeId('Code Review', 'runtime-check'), 'tt-code-review-runtime-check');
		assert.strictEqual(inferTaskTypeId('bug  fix', 'review'), 'tt-bug-fix-review'); // non-alphanumeric runs collapse to one dash
	});

	test('verification styles: strict-majority review, any test-runner, browser/environment, fallback', () => {
		const result = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_365D, 'profile-alpha', NOW_ISO);
		assert.ok(result);
		const styles = new Map(result.taskTypes.map(taskType => [taskType.descriptor.name, taskType.descriptor.verificationStyle] as const));
		// corpus branches: bugfix 2/3 requiredReview -> review; feature used a test runner -> tests;
		// investigation used the browser -> runtime-check; refactor only inspects diffs -> diff-inspection;
		// the review family is 1/1 requiredReview -> review
		assert.strictEqual(styles.get('Feature work'), 'tests');
		assert.strictEqual(styles.get('Bug fixing'), 'review');
		assert.strictEqual(styles.get('Refactoring'), 'diff-inspection');
		assert.strictEqual(styles.get('Investigation'), 'runtime-check');
		assert.strictEqual(styles.get('Code review'), 'review');
		const families = new Map(result.taskTypes.map(taskType => [taskType.descriptor.name, taskType.descriptor.family] as const));
		assert.strictEqual(families.get('Feature work'), 'implementation');
		assert.strictEqual(families.get('Bug fixing'), 'implementation');
		assert.strictEqual(families.get('Refactoring'), 'implementation');
		assert.strictEqual(families.get('Investigation'), 'investigation');
		assert.strictEqual(families.get('Code review'), 'review');

		// strict-majority boundary: exactly 50% requiredReview is NOT >50%, so it falls through
		// to the test-runner branch ('tests', not 'review')
		const halfReview: LabActivityRecord[] = [
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'bugfix',
				toolKinds: ['editor', 'test-runner'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 30,
				complexityHint: 0.5,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: false,
				qualitySensitivity: 0.5,
				costSensitivity: 0.5,
				latencySensitivity: 0.5,
				occurredAt: '2024-06-29T09:00:00Z',
			},
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'bugfix',
				toolKinds: ['editor'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 30,
				complexityHint: 0.5,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: true,
				qualitySensitivity: 0.5,
				costSensitivity: 0.5,
				latencySensitivity: 0.5,
				occurredAt: '2024-06-28T09:00:00Z',
			},
		];
		assert.deepStrictEqual(deriveTaskMix(halfReview), [{ taskTypeId: 'tt-bugfix-tests', share: 1 }]);

		// environment use (no browser, no test runner) also derives 'runtime-check'
		const environmentOnly: LabActivityRecord = {
			scope: SCOPE_ALPHA,
			taskFamily: 'feature',
			toolKinds: ['editor'],
			usedBrowser: false,
			usedEnvironment: true,
			durationMinutes: 45,
			complexityHint: 0.5,
			parallelThreads: 1,
			humanInterventions: 0,
			requiredReview: false,
			qualitySensitivity: 0.5,
			costSensitivity: 0.5,
			latencySensitivity: 0.5,
			occurredAt: '2024-06-27T09:00:00Z',
		};
		assert.deepStrictEqual(deriveTaskMix([environmentOnly]), [{ taskTypeId: 'tt-feature-runtime-check', share: 1 }]);
	});

	test('unknown task families map to the maintenance template', () => {
		const choreRecords: LabActivityRecord[] = [
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'chore',
				toolKinds: ['shell'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 20,
				complexityHint: 0.3,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: false,
				qualitySensitivity: 0.4,
				costSensitivity: 0.2,
				latencySensitivity: 0.2,
				occurredAt: '2024-06-29T08:00:00Z',
			},
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'chore',
				toolKinds: ['shell'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 25,
				complexityHint: 0.3,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: false,
				qualitySensitivity: 0.4,
				costSensitivity: 0.2,
				latencySensitivity: 0.2,
				occurredAt: '2024-06-28T08:00:00Z',
			},
		];
		const result = learnWorkloadProfile(SCOPE_ALPHA, choreRecords, CONTROLS_OPTED_IN_30D, 'profile-chore', NOW_ISO);
		assert.ok(result);
		assert.strictEqual(result.taskTypes.length, 1);
		const descriptor = result.taskTypes[0].descriptor;
		assert.strictEqual(descriptor.id, 'tt-chore-diff-inspection');
		assert.strictEqual(descriptor.family, 'maintenance');
		assert.strictEqual(descriptor.name, 'Maintenance');
	});

	test('contractVersion and scope propagate to every persisted record', () => {
		const result = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_365D, 'profile-alpha', NOW_ISO);
		assert.ok(result);
		assert.deepStrictEqual(result.profile.scope, SCOPE_ALPHA);
		assert.strictEqual(result.profile.contractVersion, '1.0.0'); // LAB_CONTRACTS_VERSION (frozen)
		assert.strictEqual(result.profile.id, 'profile-alpha');
		assert.strictEqual(result.profile.source, 'learned');
		assert.deepStrictEqual(result.profile.learning, { optIn: true, retentionDays: 365, exportable: true });
		for (const taskType of result.taskTypes) {
			assert.deepStrictEqual(taskType.descriptor.scope, SCOPE_ALPHA);
			assert.strictEqual(taskType.descriptor.contractVersion, '1.0.0');
			assert.strictEqual(taskType.descriptor.id, taskType.taskTypeId);
			assert.ok(/^tt-[a-z0-9]+(-[a-z0-9]+)*$/.test(taskType.descriptor.id), `id must be a tt- slug: ${taskType.descriptor.id}`);
		}
	});

	test('separateLearningState: raw counts only, derived profile + descriptors, controls verbatim', () => {
		const result = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_30D, 'profile-alpha', NOW_ISO);
		assert.ok(result);
		const separated = separateLearningState(result);
		// raw: counts ONLY — exactly two numeric fields, no record payloads
		assert.deepStrictEqual(Object.keys(separated.raw).sort(), ['recordCount', 'retainedRecordCount']);
		assert.deepStrictEqual(separated.raw, { recordCount: 12, retainedRecordCount: 10 });
		// derived: the profile plus bare descriptors
		assert.deepStrictEqual(separated.derived.profile, result.profile);
		assert.deepStrictEqual(separated.derived.taskTypes, result.taskTypes.map(taskType => taskType.descriptor));
		// controls: the durable controls echo verbatim; the delete cutoff is ephemeral input state
		assert.deepStrictEqual(separated.controls, { optIn: true, retentionDays: 30, exportable: true });
		assert.strictEqual(separated.controls.deleteAllBefore, undefined);
	});

	test('insufficient-history: empty retained set still learns an (empty) profile, never null', () => {
		const empty = learnWorkloadProfile(SCOPE_ALPHA, [], CONTROLS_OPTED_IN_30D, 'profile-empty', NOW_ISO);
		assert.ok(empty); // null is ONLY the opt-out
		assert.strictEqual(empty.retainedRecordCount, 0);
		assert.strictEqual(empty.excludedRecordCount, 0);
		assert.deepStrictEqual(empty.warnings, ['fixture-evidence', 'insufficient-history']);
		assert.deepStrictEqual(empty.profile.signals, []);
		assert.deepStrictEqual(empty.profile.taskMix, []);
		assert.deepStrictEqual(empty.taskTypes, []);
		assert.strictEqual(empty.profile.source, 'learned');
		// documented neutral defaults: no records -> sensitivity averages are the 0.5 midpoint
		assert.strictEqual(empty.profile.budgetUsdPerTask, 1.3); // round1(0.5 + 0.5 * 1.5)
		assert.strictEqual(empty.profile.latencySlaMinutes, 32.5); // round1(5 + (1 - 0.5) * 55)

		// the same warning fires when every record is excluded by the retention window
		const staleControls: WorkloadLearningControls = { optIn: true, retentionDays: 1, exportable: true };
		const stale = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, staleControls, 'profile-stale', NOW_ISO);
		assert.ok(stale);
		assert.strictEqual(stale.retainedRecordCount, 0);
		assert.strictEqual(stale.excludedRecordCount, 12);
		assert.ok(stale.warnings.includes('insufficient-history'));
		assert.deepStrictEqual(stale.profile.signals, []);
	});

	test('budget and SLA formulas match the documented constants on a controlled input', () => {
		const controlled: LabActivityRecord[] = [
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'feature',
				toolKinds: ['editor'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 60,
				complexityHint: 0.5,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: false,
				qualitySensitivity: 0.5,
				costSensitivity: 0.2,
				latencySensitivity: 0.0,
				occurredAt: '2024-06-29T10:00:00Z',
			},
			{
				scope: SCOPE_ALPHA,
				taskFamily: 'feature',
				toolKinds: ['editor'],
				usedBrowser: false,
				usedEnvironment: false,
				durationMinutes: 60,
				complexityHint: 0.5,
				parallelThreads: 1,
				humanInterventions: 0,
				requiredReview: false,
				qualitySensitivity: 0.5,
				costSensitivity: 0.6,
				latencySensitivity: 0.4,
				occurredAt: '2024-06-28T10:00:00Z',
			},
		];
		const result = learnWorkloadProfile(SCOPE_ALPHA, controlled, CONTROLS_OPTED_IN_30D, 'profile-budget', NOW_ISO);
		assert.ok(result);
		// avgCostSensitivity = (0.2 + 0.6) / 2 = 0.4 -> budget = round1(0.5 + 0.4 * 1.5) = 1.1 USD
		assert.strictEqual(result.profile.budgetUsdPerTask, 1.1);
		// avgLatencySensitivity = (0.0 + 0.4) / 2 = 0.2 -> sla = round1(5 + (1 - 0.2) * 55) = 49.0 minutes
		assert.strictEqual(result.profile.latencySlaMinutes, 49);
	});

	test('scope discipline: foreign-scope records are ignored entirely', () => {
		const alphaWithForeign = learnWorkloadProfile(SCOPE_ALPHA, FIXTURE_RECORDS, CONTROLS_OPTED_IN_365D, 'profile-alpha', NOW_ISO);
		const alphaOnly = learnWorkloadProfile(SCOPE_ALPHA, recordsForScope(FIXTURE_RECORDS, SCOPE_ALPHA), CONTROLS_OPTED_IN_365D, 'profile-alpha', NOW_ISO);
		assert.ok(alphaWithForeign);
		assert.ok(alphaOnly);
		// the 6 ws-beta records neither contribute to learning nor to governance counts
		assert.deepStrictEqual(alphaWithForeign, alphaOnly);
		assert.strictEqual(alphaWithForeign.retainedRecordCount, 12);
		assert.strictEqual(alphaWithForeign.excludedRecordCount, 0);

		const betaWithForeign = learnWorkloadProfile(SCOPE_BETA, FIXTURE_RECORDS, CONTROLS_OPTED_IN_365D, 'profile-beta', NOW_ISO);
		const betaOnly = learnWorkloadProfile(SCOPE_BETA, recordsForScope(FIXTURE_RECORDS, SCOPE_BETA), CONTROLS_OPTED_IN_365D, 'profile-beta', NOW_ISO);
		assert.ok(betaWithForeign);
		assert.ok(betaOnly);
		assert.deepStrictEqual(betaWithForeign, betaOnly);
		assert.strictEqual(betaWithForeign.retainedRecordCount, 6);
	});

	test('deriveSignals: fixed kinds/weights and hand-computed normalized values', () => {
		const result = learnWorkloadProfile(SCOPE_ALPHA, ALPHA_RECORDS, CONTROLS_OPTED_IN_30D, 'profile-alpha', NOW_ISO);
		assert.ok(result);
		const signals = result.profile.signals; // deriveSignals over the 10 retained records A1..A10
		assert.deepStrictEqual(signals.map(signal => signal.kind), [
			'family-mix',
			'avg-duration',
			'avg-complexity',
			'tool-use',
			'browser-use',
			'environment-use',
			'parallelism',
			'human-intervention',
			'review-requirement',
			'sensitivity-mix',
		]);
		const weightSum = signals.reduce((total, signal) => total + signal.weight, 0);
		assert.ok(Math.abs(weightSum - 1) < 1e-9, `weights must sum to 1, got ${weightSum}`);
		for (const signal of signals) {
			assert.ok(signal.weight >= 0 && signal.weight <= 1, `weight out of range: ${signal.kind}`);
			assert.ok(signal.value >= 0 && signal.value <= 1, `value out of range: ${signal.kind}`);
		}
		// hand-computed over A1..A10:
		assert.strictEqual(signalByKind(signals, 'family-mix').value, 0.3); // 3 feature records of 10
		assert.strictEqual(signalByKind(signals, 'avg-duration').value, 0.4479); // avg 107.5 min / 240
		assert.strictEqual(signalByKind(signals, 'avg-complexity').value, 0.575); // mean hint = 0.575
		assert.strictEqual(signalByKind(signals, 'tool-use').value, 0.625); // avg 2.5 tool kinds / 4
		assert.strictEqual(signalByKind(signals, 'browser-use').value, 0.2); // A9, A10
		assert.strictEqual(signalByKind(signals, 'environment-use').value, 0.2); // A3, A10
		assert.strictEqual(signalByKind(signals, 'parallelism').value, 0.325); // avg 1.3 threads / 4
		assert.strictEqual(signalByKind(signals, 'human-intervention').value, 0.24); // avg 1.2 / 5
		assert.strictEqual(signalByKind(signals, 'review-requirement').value, 0.2); // A4, A5
		assert.strictEqual(signalByKind(signals, 'sensitivity-mix').value, 0.4867); // 14.6 / 30
	});
});
