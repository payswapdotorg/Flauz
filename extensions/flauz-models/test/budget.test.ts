/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- budget compiler drills (M4): default reserve
 * derivation, policy overrides (incl. typed OVERRUN failures), fitting
 * plans with the deterministic truncation priority (tool results ->
 * attachments -> tail-keep truncation -> conversation drops), protected
 * items (system / pinned / last turn), overflow reporting, determinism and
 * the bridge wiring of the input reserve.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';

import { BudgetError, compileBudget, compileFittingPlan, truncatedTokens, type BudgetItem, type ContextBudget } from '../src/budget/budget.ts';

function budget(windowTokens: number, maxOutput: number, override?: Parameters<typeof compileBudget>[0]['override']): ContextBudget {
	return compileBudget({ providerId: 'p', modelId: 'm', contextWindowTokens: windowTokens, maxOutputTokens: maxOutput, ...(override === undefined ? {} : { override }) });
}

test('budget: default reserves derive deterministically from the window', () => {
	const plan = budget(200_000, 64_000);
	strictEqual(plan.outputReserveTokens, 50_000, 'min(64000, floor(200000/4))');
	strictEqual(plan.toolReserveTokens, 20_000, 'floor(200000/10)');
	strictEqual(plan.inputReserveTokens, 130_000, 'window - output - tool');
	strictEqual(plan.source, 'capabilities-default');
	ok(plan.derivation.includes('floor(200000/4)'));
	const small = budget(8192, 4096);
	strictEqual(small.outputReserveTokens, 2048);
	strictEqual(small.toolReserveTokens, 819);
	strictEqual(small.inputReserveTokens, 8192 - 2048 - 819);
});

test('budget: policy overrides replace their piece and are labeled', () => {
	const plan = budget(100_000, 10_000, { outputReserveTokens: 8_000, toolReserveTokens: 2_000 });
	strictEqual(plan.source, 'policy-override');
	strictEqual(plan.outputReserveTokens, 8_000);
	strictEqual(plan.toolReserveTokens, 2_000);
	strictEqual(plan.inputReserveTokens, 90_000);
	ok(plan.derivation.startsWith('policy override'));
	const pinnedInput = budget(100_000, 10_000, { inputReserveTokens: 95_000 });
	strictEqual(pinnedInput.inputReserveTokens, 95_000);
	ok(pinnedInput.outputReserveTokens + pinnedInput.toolReserveTokens <= 5_000, 'complementary reserves shrink into the remainder');
});

test('budget: reserves beyond the window are typed OVERRUN failures, never silent clamps', () => {
	throws(() => budget(1_000, 400, { inputReserveTokens: 900, outputReserveTokens: 300 }), (error: unknown): boolean => error instanceof BudgetError && error.code === 'OVERRUN');
	throws(() => budget(2, 1), (error: unknown): boolean => error instanceof BudgetError && error.code === 'BAD_ITEM');
});

test('budget: small submissions fit without any shedding', () => {
	const plan = compileFittingPlan({
		budget: budget(8_192, 1_024),
		items: [
			{ id: 'sys', kind: 'system', tokens: 120, ordinal: 0 },
			{ id: 'u1', kind: 'conversation', tokens: 300, ordinal: 1 },
			{ id: 'a1', kind: 'conversation', tokens: 400, ordinal: 2 },
			{ id: 'u2', kind: 'conversation', tokens: 250, ordinal: 3 },
		],
	});
	strictEqual(plan.fits, true);
	deepStrictEqual(plan.actions.map(action => action.action), ['keep', 'keep', 'keep', 'keep']);
	strictEqual(plan.totals.headroomTokens, plan.budget.inputReserveTokens - plan.totals.requestedTokens);
	strictEqual(plan.totals.droppedTokens, 0);
});

test('budget: deterministic priority -- oldest tool results drop first, then attachments', () => {
	const items: readonly BudgetItem[] = [
		{ id: 'sys', kind: 'system', tokens: 100, ordinal: 0 },
		{ id: 'tr-old', kind: 'tool-result', tokens: 2_000, ordinal: 1 },
		{ id: 'att-old', kind: 'attachment', tokens: 1_500, ordinal: 2 },
		{ id: 'tr-new', kind: 'tool-result', tokens: 1_800, ordinal: 3 },
		{ id: 'u1', kind: 'conversation', tokens: 900, ordinal: 4 },
		{ id: 'u2', kind: 'conversation', tokens: 800, ordinal: 5 },
	];
	// input reserve: 8192 - 1024 - 819 = 6349; requested = 7100 -> shed 751+
	const plan = compileFittingPlan({ budget: budget(8_192, 1_024), items });
	strictEqual(plan.fits, true);
	const dropped = plan.actions.filter(action => action.action === 'drop').map(action => action.itemId);
	deepStrictEqual(dropped, ['tr-old'], 'only the oldest tool result is dropped (enough headroom)');
	ok(plan.actions.find(action => action.itemId === 'tr-old')?.reason.includes('priority 1'));
	strictEqual(plan.totals.plannedTokens, 7_100 - 2_000);
});

test('budget: tail-keep truncation applies to the oldest conversation turns before drops', () => {
	const items: readonly BudgetItem[] = [
		{ id: 'sys', kind: 'system', tokens: 50, ordinal: 0 },
		{ id: 'u1', kind: 'conversation', tokens: 3_000, ordinal: 1 },
		{ id: 'u2', kind: 'conversation', tokens: 2_500, ordinal: 2 },
		{ id: 'u3', kind: 'conversation', tokens: 100, ordinal: 3 },
	];
	// input reserve 6349; requested 5650 -> fits. Force shedding with a tighter override.
	const plan = compileFittingPlan({
		budget: budget(8_192, 1_024, { inputReserveTokens: 4_000 }),
		items,
	});
	const truncateActions = plan.actions.filter(action => action.action === 'truncate');
	ok(truncateActions.length >= 1, 'at least one truncation');
	strictEqual(truncateActions[0]?.itemId, 'u1', 'oldest conversation turn truncates first');
	strictEqual(truncateActions[0]?.tokens, Math.max(64, Math.floor(3_000 * 0.25)), 'tail-keep: newest quarter, floor 64');
	ok(plan.actions.find(action => action.itemId === 'u3')?.action === 'keep', 'the last turn is protected');
	ok(plan.actions.find(action => action.itemId === 'sys')?.action === 'keep', 'system items are protected');
});

test('budget: pinned items survive every stage; overflow is reported honestly', () => {
	const items: readonly BudgetItem[] = [
		{ id: 'sys', kind: 'system', tokens: 100, ordinal: 0 },
		{ id: 'pin', kind: 'attachment', tokens: 5_000, ordinal: 1, pinned: true },
		{ id: 'u1', kind: 'conversation', tokens: 2_000, ordinal: 2 },
		{ id: 'u2', kind: 'conversation', tokens: 100, ordinal: 3 },
	];
	const plan = compileFittingPlan({
		budget: budget(8_192, 1_024, { inputReserveTokens: 4_000 }),
		items,
	});
	// 7200 requested vs 4000 reserve: u1 truncates (2000 -> 500) -> 5700; u1 then drops
	// entirely -> survivors = 100 + 5000 + 100 = 5200 > 4000 -> overflow stays
	strictEqual(plan.fits, false);
	strictEqual(plan.totals.overflowTokens, 5_200 - 4_000, 'pinned survivors that cannot fit are reported, never silently dropped');
	const pinAction = plan.actions.find(action => action.itemId === 'pin');
	strictEqual(pinAction?.action, 'keep');
	ok(pinAction?.reason.includes('protected'));
});

test('budget: identical inputs produce identical plans (determinism)', () => {
	const items: readonly BudgetItem[] = [
		{ id: 'sys', kind: 'system', tokens: 40, ordinal: 0 },
		{ id: 'a', kind: 'conversation', tokens: 900, ordinal: 1 },
		{ id: 'b', kind: 'tool-result', tokens: 4_000, ordinal: 2 },
		{ id: 'c', kind: 'conversation', tokens: 700, ordinal: 3 },
	];
	const first = compileFittingPlan({ budget: budget(8_192, 1_024, { inputReserveTokens: 3_000 }), items });
	const second = compileFittingPlan({ budget: budget(8_192, 1_024, { inputReserveTokens: 3_000 }), items });
	deepStrictEqual(first, second);
	// invalid submissions fail typed
	throws(() => compileFittingPlan({ budget: budget(8_192, 1_024), items: [...items, { id: 'b', kind: 'conversation', tokens: 1, ordinal: 9 }] }), (error: unknown): boolean => error instanceof BudgetError && error.code === 'BAD_ITEM');
	throws(() => compileFittingPlan({ budget: budget(8_192, 1_024), items: [{ id: 'neg', kind: 'conversation', tokens: -5, ordinal: 1 }] }), (error: unknown): boolean => error instanceof BudgetError && error.code === 'BAD_ITEM');
});

test('budget: truncation math helper (tail-keep floor and fraction)', () => {
	strictEqual(truncatedTokens({ id: 'x', kind: 'conversation', tokens: 10_000, ordinal: 1 }), 2_500);
	strictEqual(truncatedTokens({ id: 'x', kind: 'conversation', tokens: 100, ordinal: 1 }), 64, 'floor 64');
	strictEqual(truncatedTokens({ id: 'x', kind: 'conversation', tokens: 30, ordinal: 1 }), 30, 'never grows');
});
