/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	AUTHORITY_ACTIVE_TASK_STATUSES,
	AUTHORITY_TASK_STATUSES,
	PLAN_STEP_STATUSES,
	PLAN_STEP_STATUSES as ALL_STEP_STATUSES,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	canTransitionPlanStepStatus,
	isVersionedApprovedPlanRecord,
	pinnedPlanStepMayProceed,
	planStepMayProceed,
	planStepStatusTransitions,
	type ApprovedPlanRecord,
	type ApprovedPlanStep,
	type PlanStepStatus,
	type ZcodeScope,
} from '../../common/planContinuity.js';
import { AUTHORITY_TASK_STATUSES as BACKGROUND_AGENT_AUTHORITY_TASK_STATUSES } from '../../common/backgroundAgent.js';
import { TASK_STATUSES, ACTIVE_STATUSES } from '../../../../../extensions/flauz-workspace/src/api.js';
import { type TaskStatus } from '../../../../../extensions/flauz-agent/src/types.js';

// Compile-time pins (both directions, so the duplicated vocabulary is exactly the
// authority union; erased at runtime under verbatimModuleSyntax):
const pinToAgentAuthority: readonly TaskStatus[] = AUTHORITY_TASK_STATUSES;
const pinFromWorkspaceAuthority: readonly (typeof AUTHORITY_TASK_STATUSES)[number][] = TASK_STATUSES;

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

const STEP_STATUSES_UNDER_TEST: readonly PlanStepStatus[] = ALL_STEP_STATUSES;

function step(status: PlanStepStatus, pinned: boolean): ApprovedPlanStep {
	return { stepId: 'S-01', seq: 1, title: 'reproduce the failure', status, pinned };
}

suite('planContinuity', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('AUTHORITY_TASK_STATUSES equals the flauz-workspace authority TaskStatus list exactly (runtime and type pins)', () => {
		assert.deepStrictEqual(AUTHORITY_TASK_STATUSES, TASK_STATUSES);
		assert.deepStrictEqual(pinToAgentAuthority, TASK_STATUSES);
		assert.deepStrictEqual(AUTHORITY_TASK_STATUSES, pinFromWorkspaceAuthority);
	});

	test('the duplicated vocabulary is identical in planContinuity.ts and backgroundAgent.ts (drift protection)', () => {
		assert.deepStrictEqual(AUTHORITY_TASK_STATUSES, BACKGROUND_AGENT_AUTHORITY_TASK_STATUSES);
	});

	test('AUTHORITY_ACTIVE_TASK_STATUSES equals the flauz-workspace authority ACTIVE_STATUSES list exactly', () => {
		assert.deepStrictEqual(AUTHORITY_ACTIVE_TASK_STATUSES, ACTIVE_STATUSES);
	});

	test('PLAN_STEP_STATUSES pins the exact step status set', () => {
		assert.deepStrictEqual(PLAN_STEP_STATUSES, ['pending', 'in-progress', 'completed', 'failed', 'skipped']);
	});

	test('planStepStatusTransitions pins the exact legal transition map', () => {
		assert.deepStrictEqual(planStepStatusTransitions, {
			pending: ['in-progress', 'skipped'],
			'in-progress': ['completed', 'failed'],
			completed: [],
			failed: [],
			skipped: [],
		});
	});

	test('legal step transitions: pending->in-progress, pending->skipped, in-progress->completed, in-progress->failed', () => {
		assert.ok(canTransitionPlanStepStatus('pending', 'in-progress'));
		assert.ok(canTransitionPlanStepStatus('pending', 'skipped'));
		assert.ok(canTransitionPlanStepStatus('in-progress', 'completed'));
		assert.ok(canTransitionPlanStepStatus('in-progress', 'failed'));
	});

	test('illegal step transitions: completed->pending, failed->in-progress, skipped->pending, pending->completed', () => {
		assert.ok(!canTransitionPlanStepStatus('completed', 'pending'));
		assert.ok(!canTransitionPlanStepStatus('failed', 'in-progress'));
		assert.ok(!canTransitionPlanStepStatus('skipped', 'pending'));
		assert.ok(!canTransitionPlanStepStatus('pending', 'completed'));
	});

	test('terminal step statuses completed/failed/skipped have empty transition lists', () => {
		assert.deepStrictEqual(planStepStatusTransitions.completed, []);
		assert.deepStrictEqual(planStepStatusTransitions.failed, []);
		assert.deepStrictEqual(planStepStatusTransitions.skipped, []);
	});

	test('CONTINUITY LAW: planStepMayProceed truth table over every (step status, task status) pair', () => {
		for (const taskStatus of TASK_STATUSES) {
			const taskIsActive = (ACTIVE_STATUSES as readonly string[]).includes(taskStatus);
			for (const stepStatus of PLAN_STEP_STATUSES) {
				const expected = taskIsActive && (stepStatus === 'pending' || stepStatus === 'in-progress');
				assert.strictEqual(
					planStepMayProceed(stepStatus, taskStatus),
					expected,
					`planStepMayProceed(${stepStatus}, ${taskStatus}) must be ${expected}`,
				);
			}
		}
	});

	test('CONTINUITY LAW: nothing proceeds under failed, cancelled, or done authority tasks', () => {
		for (const taskStatus of ['failed', 'cancelled', 'done'] as const) {
			for (const stepStatus of PLAN_STEP_STATUSES) {
				assert.ok(!planStepMayProceed(stepStatus, taskStatus), `${stepStatus} must not proceed under ${taskStatus}`);
			}
		}
	});

	test('PINNED LAW: pinned steps never proceed under a failed authority task (exhaustive over step statuses)', () => {
		for (const stepStatus of PLAN_STEP_STATUSES) {
			assert.ok(!pinnedPlanStepMayProceed(step(stepStatus, true), 'failed'), `pinned ${stepStatus} must not proceed under failed`);
		}
	});

	test('PINNED LAW: pinned steps never proceed under a cancelled authority task (exhaustive over step statuses)', () => {
		for (const stepStatus of PLAN_STEP_STATUSES) {
			assert.ok(!pinnedPlanStepMayProceed(step(stepStatus, true), 'cancelled'), `pinned ${stepStatus} must not proceed under cancelled`);
		}
	});

	test('PINNED LAW: under active authority tasks the pinned guard agrees with the general guard', () => {
		for (const taskStatus of ACTIVE_STATUSES) {
			for (const stepStatus of PLAN_STEP_STATUSES) {
				assert.strictEqual(
					pinnedPlanStepMayProceed(step(stepStatus, true), taskStatus),
					planStepMayProceed(stepStatus, taskStatus),
					`pinned guard must agree with the general guard under active task ${taskStatus}`,
				);
			}
		}
	});

	test('PINNED LAW: under done tasks the pinned guard stays shut (a finished task is not a resurrection)', () => {
		for (const stepStatus of PLAN_STEP_STATUSES) {
			assert.ok(!pinnedPlanStepMayProceed(step(stepStatus, true), 'done'));
		}
	});

	test('minimal ApprovedPlanRecord fixture compiles and fields read back', () => {
		const record: ApprovedPlanRecord = {
			scope: SCOPE,
			contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
			planId: 'plan-0001',
			owningTaskId: 'T-001',
			sessionLineage: ['session-0001', 'session-0002'],
			approvedAtIso: '2026-10-04T00:00:00.000Z',
			steps: [
				{ stepId: 'S-01', seq: 1, title: 'reproduce the failure', status: 'completed', pinned: false },
				{ stepId: 'S-02', seq: 2, title: 'write the regression test', status: 'in-progress', pinned: true },
				{ stepId: 'S-03', seq: 3, title: 'land the fix', status: 'pending', pinned: false },
			],
		};
		assert.strictEqual(record.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(record.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(record.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
		assert.strictEqual(record.planId, 'plan-0001');
		assert.strictEqual(record.owningTaskId, 'T-001');
		assert.deepStrictEqual(record.sessionLineage, ['session-0001', 'session-0002']);
		assert.strictEqual(record.approvedAtIso, '2026-10-04T00:00:00.000Z');
		assert.strictEqual(record.steps.length, 3);
		assert.strictEqual(record.steps[1].pinned, true);
		assert.strictEqual(record.steps[1].status, 'in-progress');
		assert.ok(isVersionedApprovedPlanRecord(record));
	});

	test('isVersionedApprovedPlanRecord: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedApprovedPlanRecord({ contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION }));
		assert.ok(!isVersionedApprovedPlanRecord({ contractVersion: '0.9.0' }));
		assert.ok(!isVersionedApprovedPlanRecord({}));
	});
});
