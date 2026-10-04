/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	JOURNAL_SUBJECT,
	REPLAY_WINDOW_ROWS,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	deriveResumePlan,
	isVersionedReplayCursorRecord,
	type ReplayCursorRecord,
	type ReplayStep,
	type ResumePlan,
	type ZcodeScope,
} from '../../common/replayResume.js';
import { EXEC_JOURNAL_SCHEMA_ID } from '../../../../../extensions/flauz-execution/src/contracts.js';

// Compile-time pin: the projected journal subject is exactly the authority constant
// (the literal type makes drift a compile error):
const pinJournalSubject: typeof EXEC_JOURNAL_SCHEMA_ID = JOURNAL_SUBJECT;

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

function cursor(lastSequenceNumber: number, cold: boolean): ReplayCursorRecord {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
		journalSubject: JOURNAL_SUBJECT,
		lastSequenceNumber,
		resumedAtIso: '2026-10-04T00:00:00.000Z',
		cold,
	};
}

function planOf(cursorRecord: ReplayCursorRecord, journalLength: number): Extract<ResumePlan, { kind: 'resumable' }> {
	const plan = deriveResumePlan(cursorRecord, journalLength);
	assert.strictEqual(plan.kind, 'resumable', 'expected a resumable plan');
	return plan;
}

suite('replayResume', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('JOURNAL_SUBJECT equals the execution journal authority schema id (runtime and type pins)', () => {
		assert.strictEqual(JOURNAL_SUBJECT, 'flauz.execution-journal/v0');
		assert.strictEqual(pinJournalSubject, EXEC_JOURNAL_SCHEMA_ID);
		assert.strictEqual(JOURNAL_SUBJECT, EXEC_JOURNAL_SCHEMA_ID);
	});

	test('REPLAY_WINDOW_ROWS is an exported named bound (no hidden magic numbers)', () => {
		assert.strictEqual(REPLAY_WINDOW_ROWS, 500);
	});

	test('minimal ReplayCursorRecord fixture compiles and fields read back', () => {
		const record = cursor(42, true);
		assert.strictEqual(record.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(record.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(record.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
		assert.strictEqual(record.journalSubject, 'flauz.execution-journal/v0');
		assert.strictEqual(record.lastSequenceNumber, 42);
		assert.strictEqual(record.resumedAtIso, '2026-10-04T00:00:00.000Z');
		assert.strictEqual(record.cold, true);
		assert.ok(isVersionedReplayCursorRecord(record));
	});

	test('deriveResumePlan: a cursor at the journal head is resumable with zero pending steps', () => {
		const plan = planOf(cursor(100, false), 100);
		assert.strictEqual(plan.pendingCount, 0);
		assert.deepStrictEqual(plan.steps, []);
		assert.strictEqual(plan.lastSequenceNumber, 100);
		assert.strictEqual(plan.journalLength, 100);
		assert.strictEqual(plan.cold, false);
	});

	test('deriveResumePlan: a grown journal yields one step covering exactly the pending rows', () => {
		const plan = planOf(cursor(3, false), 10);
		assert.strictEqual(plan.pendingCount, 7);
		assert.deepStrictEqual<readonly ReplayStep[]>(plan.steps, [{ fromSequence: 4, toSequence: 10 }]);
	});

	test('deriveResumePlan: a fresh cold consumer replays the whole journal', () => {
		const plan = planOf(cursor(0, true), 250);
		assert.strictEqual(plan.pendingCount, 250);
		assert.deepStrictEqual<readonly ReplayStep[]>(plan.steps, [{ fromSequence: 1, toSequence: 250 }]);
		assert.strictEqual(plan.cold, true);
	});

	test('deriveResumePlan: windows are bounded by REPLAY_WINDOW_ROWS and cover every row exactly once', () => {
		const plan = planOf(cursor(0, false), 1201);
		assert.strictEqual(plan.pendingCount, 1201);
		assert.deepStrictEqual<readonly ReplayStep[]>(plan.steps, [
			{ fromSequence: 1, toSequence: 500 },
			{ fromSequence: 501, toSequence: 1000 },
			{ fromSequence: 1001, toSequence: 1201 },
		]);
		for (const step of plan.steps) {
			assert.ok(step.toSequence - step.fromSequence + 1 <= REPLAY_WINDOW_ROWS, 'window exceeds the bound');
		}
	});

	test('deriveResumePlan: the window boundary lands exactly on multiples of REPLAY_WINDOW_ROWS', () => {
		const plan = planOf(cursor(0, false), 1000);
		assert.deepStrictEqual<readonly ReplayStep[]>(plan.steps, [
			{ fromSequence: 1, toSequence: 500 },
			{ fromSequence: 501, toSequence: 1000 },
		]);
	});

	test('deriveResumePlan: steps are ordered, non-overlapping, and contiguous from the cursor', () => {
		const plan = planOf(cursor(7, false), 1700);
		let expectedFrom = 8;
		for (const step of plan.steps) {
			assert.strictEqual(step.fromSequence, expectedFrom);
			assert.ok(step.toSequence >= step.fromSequence);
			expectedFrom = step.toSequence + 1;
		}
		assert.strictEqual(expectedFrom, 1701);
	});

	test('DIVERGENCE LAW: a journal behind the cursor is a typed divergence, never an exception', () => {
		const plan = deriveResumePlan(cursor(50, true), 40);
		assert.strictEqual(plan.kind, 'divergence');
		assert.strictEqual(plan.reason, 'journal-behind-cursor');
		assert.strictEqual(plan.lastSequenceNumber, 50);
		assert.strictEqual(plan.journalLength, 40);
		assert.strictEqual(plan.cold, true);
	});

	test('DIVERGENCE LAW: malformed inputs are typed divergences, never exceptions', () => {
		const negativeCursor = deriveResumePlan(cursor(-1, false), 10);
		assert.strictEqual(negativeCursor.kind, 'divergence');
		assert.strictEqual(negativeCursor.reason, 'invalid-input');
		const negativeLength = deriveResumePlan(cursor(5, false), -3);
		assert.strictEqual(negativeLength.kind, 'divergence');
		assert.strictEqual(negativeLength.reason, 'invalid-input');
		const fractionalCursor: ReplayCursorRecord = { ...cursor(5, false), lastSequenceNumber: 5.5 };
		const fractional = deriveResumePlan(fractionalCursor, 10);
		assert.strictEqual(fractional.kind, 'divergence');
		assert.strictEqual(fractional.reason, 'invalid-input');
		const fractionalLength = deriveResumePlan(cursor(5, false), 10.5);
		assert.strictEqual(fractionalLength.kind, 'divergence');
		assert.strictEqual(fractionalLength.reason, 'invalid-input');
	});

	test('DIVERGENCE LAW: the derivation is total (never throws) across a sweep of inputs', () => {
		const lengths = [-5, 0, 1, 5, 50, 500, 1000];
		const cursors = [-2, 0, 1, 10, 600, 1200];
		for (const last of cursors) {
			for (const journalLength of lengths) {
				const plan = deriveResumePlan(cursor(last, false), journalLength);
				assert.ok(plan.kind === 'resumable' || plan.kind === 'divergence');
			}
		}
	});

	test('deriveResumePlan is pure: identical inputs yield byte-identical plans', () => {
		const first = deriveResumePlan(cursor(10, true), 1600);
		const second = deriveResumePlan(cursor(10, true), 1600);
		assert.deepStrictEqual(first, second);
	});

	test('deriveResumePlan propagates the cold flag into every outcome', () => {
		assert.strictEqual(planOf(cursor(10, true), 20).cold, true);
		assert.strictEqual(planOf(cursor(10, false), 20).cold, false);
		const coldDivergence = deriveResumePlan(cursor(30, true), 20);
		assert.strictEqual(coldDivergence.cold, true);
		const warmDivergence = deriveResumePlan(cursor(30, false), 20);
		assert.strictEqual(warmDivergence.cold, false);
	});

	test('isVersionedReplayCursorRecord: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedReplayCursorRecord({ contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION }));
		assert.ok(!isVersionedReplayCursorRecord({ contractVersion: '0.9.0' }));
		assert.ok(!isVersionedReplayCursorRecord({}));
	});
});
