/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	AUTHORITY_TASK_STATUSES,
	BACKGROUND_RUN_PHASES,
	BACKGROUND_RUN_PHASE_OF_TASK_STATUS,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	backgroundRunPhaseTransitions,
	canTransitionBackgroundRunPhase,
	isVersionedBackgroundAgentRunRecord,
	toBackgroundRunPhase,
	type AuthorityTaskStatus,
	type BackgroundAgentRunRecord,
	type BackgroundRunPhase,
	type ZcodeScope,
} from '../../common/backgroundAgent.js';
import { TASK_STATUSES, TRANSITIONS, ACTIVE_STATUSES } from '../../../../../extensions/flauz-workspace/src/api.js';
import { type TaskStatus } from '../../../../../extensions/flauz-agent/src/types.js';

// Compile-time pins (both directions, so the duplicated vocabulary is exactly the
// authority union; erased at runtime under verbatimModuleSyntax):
const pinToAgentAuthority: readonly TaskStatus[] = AUTHORITY_TASK_STATUSES;
const pinFromWorkspaceAuthority: readonly AuthorityTaskStatus[] = TASK_STATUSES;

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

suite('backgroundAgent', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('AUTHORITY_TASK_STATUSES equals the flauz-workspace authority TaskStatus list exactly (runtime and type pins)', () => {
		assert.deepStrictEqual(AUTHORITY_TASK_STATUSES, TASK_STATUSES);
		assert.deepStrictEqual(pinToAgentAuthority, TASK_STATUSES);
		assert.deepStrictEqual(AUTHORITY_TASK_STATUSES, pinFromWorkspaceAuthority);
	});

	test('BACKGROUND_RUN_PHASES pins the exact projected phase set', () => {
		assert.deepStrictEqual(BACKGROUND_RUN_PHASES, [
			'planning',
			'awaiting-input',
			'executing',
			'verifying',
			'awaiting-signoff',
			'failed',
			'completed',
			'cancelled',
		]);
	});

	test('toBackgroundRunPhase is total: every authority TaskStatus maps to exactly one projected phase', () => {
		const seen = new Set<string>();
		for (const status of TASK_STATUSES) {
			const phase = toBackgroundRunPhase(status);
			assert.ok((BACKGROUND_RUN_PHASES as readonly string[]).includes(phase), `status ${status} mapped out of the phase set`);
			seen.add(phase);
		}
		assert.strictEqual(seen.size, TASK_STATUSES.length, 'the mapping is one-to-one over the authority states');
	});

	test('BACKGROUND_RUN_PHASE_OF_TASK_STATUS pins the exact mapping table', () => {
		assert.deepStrictEqual(BACKGROUND_RUN_PHASE_OF_TASK_STATUS, {
			plan: 'planning',
			'awaiting-approval': 'awaiting-input',
			execute: 'executing',
			verify: 'verifying',
			'awaiting-signoff': 'awaiting-signoff',
			failed: 'failed',
			done: 'completed',
			cancelled: 'cancelled',
		});
	});

	test('backgroundRunPhaseTransitions pins the exact legal transition map', () => {
		assert.deepStrictEqual(backgroundRunPhaseTransitions, {
			planning: ['awaiting-input', 'cancelled'],
			'awaiting-input': ['planning', 'executing', 'cancelled'],
			executing: ['verifying', 'failed', 'cancelled'],
			verifying: ['awaiting-signoff', 'executing', 'cancelled'],
			'awaiting-signoff': ['completed', 'cancelled'],
			failed: [],
			completed: [],
			cancelled: [],
		});
	});

	test('legal transitions: planning->awaiting-input, awaiting-input->executing, executing->verifying, verifying->awaiting-signoff, awaiting-signoff->completed', () => {
		assert.ok(canTransitionBackgroundRunPhase('planning', 'awaiting-input'));
		assert.ok(canTransitionBackgroundRunPhase('awaiting-input', 'executing'));
		assert.ok(canTransitionBackgroundRunPhase('executing', 'verifying'));
		assert.ok(canTransitionBackgroundRunPhase('verifying', 'awaiting-signoff'));
		assert.ok(canTransitionBackgroundRunPhase('awaiting-signoff', 'completed'));
	});

	test('legal transitions mirror the authority verify-fail and request-changes loops: verifying->executing, awaiting-input->planning', () => {
		assert.ok(canTransitionBackgroundRunPhase('verifying', 'executing'));
		assert.ok(canTransitionBackgroundRunPhase('awaiting-input', 'planning'));
	});

	test('illegal transitions: planning->completed, executing->planning, failed->executing, completed->planning, cancelled->awaiting-input', () => {
		assert.ok(!canTransitionBackgroundRunPhase('planning', 'completed'));
		assert.ok(!canTransitionBackgroundRunPhase('executing', 'planning'));
		assert.ok(!canTransitionBackgroundRunPhase('failed', 'executing'));
		assert.ok(!canTransitionBackgroundRunPhase('completed', 'planning'));
		assert.ok(!canTransitionBackgroundRunPhase('cancelled', 'awaiting-input'));
	});

	test('terminal phases failed/completed/cancelled have empty transition lists', () => {
		assert.deepStrictEqual(backgroundRunPhaseTransitions.failed, []);
		assert.deepStrictEqual(backgroundRunPhaseTransitions.completed, []);
		assert.deepStrictEqual(backgroundRunPhaseTransitions.cancelled, []);
	});

	test('PROJECTION LAW: every authority TRANSITIONS rule projects to a legal phase transition', () => {
		for (const rule of TRANSITIONS) {
			for (const from of rule.from) {
				const projectedFrom = toBackgroundRunPhase(from);
				const projectedTo = toBackgroundRunPhase(rule.to);
				assert.ok(
					canTransitionBackgroundRunPhase(projectedFrom, projectedTo),
					`authority transition ${from} -> ${rule.to} (${rule.type}) projected to illegal ${projectedFrom} -> ${projectedTo}`,
				);
			}
		}
	});

	test('PROJECTION LAW: cancel is legal from every active authority status (the any-active cancel rule)', () => {
		assert.deepStrictEqual(ACTIVE_STATUSES, ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff']);
		for (const status of ACTIVE_STATUSES) {
			assert.ok(canTransitionBackgroundRunPhase(toBackgroundRunPhase(status), 'cancelled'), `cancel must be legal from ${status}`);
		}
	});

	test('minimal BackgroundAgentRunRecord fixture compiles and fields read back', () => {
		const record: BackgroundAgentRunRecord = {
			scope: SCOPE,
			contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
			id: 'bg-run-0001',
			sessionId: 'session-0001',
			taskEnvelopeId: 'envelope-tasks-0001',
			lifecycle: 'planning',
			createdAt: '2026-10-04T00:00:00.000Z',
			updatedAt: '2026-10-04T00:05:00.000Z',
		};
		assert.strictEqual(record.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(record.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(record.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
		assert.strictEqual(record.id, 'bg-run-0001');
		assert.strictEqual(record.sessionId, 'session-0001');
		assert.strictEqual(record.taskEnvelopeId, 'envelope-tasks-0001');
		assert.strictEqual(record.lifecycle, 'planning');
		assert.strictEqual(record.createdAt, '2026-10-04T00:00:00.000Z');
		assert.strictEqual(record.updatedAt, '2026-10-04T00:05:00.000Z');
		assert.ok(isVersionedBackgroundAgentRunRecord(record));
		const phase: BackgroundRunPhase = record.lifecycle;
		assert.strictEqual(phase, 'planning');
	});

	test('isVersionedBackgroundAgentRunRecord: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedBackgroundAgentRunRecord({ contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION }));
		assert.ok(!isVersionedBackgroundAgentRunRecord({ contractVersion: '0.9.0' }));
		assert.ok(!isVersionedBackgroundAgentRunRecord({}));
	});

	test('lifecycle accepts every projected phase (compile-time totality exercised at runtime)', () => {
		for (const phase of BACKGROUND_RUN_PHASES) {
			const record: BackgroundAgentRunRecord = {
				scope: SCOPE,
				contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
				id: 'bg-run-0002',
				sessionId: 'session-0001',
				taskEnvelopeId: 'envelope-tasks-0001',
				lifecycle: phase,
				createdAt: '2026-10-04T00:00:00.000Z',
				updatedAt: '2026-10-04T00:05:00.000Z',
			};
			assert.strictEqual(record.lifecycle, phase);
		}
	});
});
