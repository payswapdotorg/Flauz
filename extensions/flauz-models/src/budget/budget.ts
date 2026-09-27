/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- model-aware context budgets (M4).
 *
 * SHARED SEAM (Worker C consumes these types; the TL reconciles the
 * boundary): `ContextBudget` is the per-model reservation plan for a
 * model's window (input / output / tool), and `compileFittingPlan` is the
 * budget compiler that turns a conversation + tool results into a FITTING
 * PLAN against that budget with DETERMINISTIC truncation priority --
 * what gets dropped first is fixed data-driven policy, every action is
 * recorded with a reason, and the same input always produces the same plan.
 *
 * Reserve semantics:
 * - outputReserveTokens: held for generation (clamped to the model's max
 *   output; default min(maxOutput, window/4));
 * - toolReserveTokens: held INSIDE the window for tool results that arrive
 *   during the agentic loop AFTER this compile (Worker C never fills it);
 * - inputReserveTokens: everything else -- the budget the conversation +
 *   existing tool results must fit into.
 *
 * Drop/truncate priority (first to last, deterministic):
 *   1. drop the OLDEST non-pinned tool-result items;
 *   2. drop the OLDEST non-pinned attachments;
 *   3. truncate the OLDEST non-pinned conversation items (tail-keep: the
 *      newest fraction survives, floor 64 tokens);
 *   4. drop the OLDEST non-pinned conversation items entirely.
 * System items, pinned items and the LAST item are never dropped. If the
 * survivors still overflow the input reserve, the plan says so
 * (fits: false, overflowTokens > 0) -- the caller decides (re-route to a
 * larger window; the routing seam accepts minContextWindowTokens).
 */

/** Typed budget failure (nonsensical overrides fail loudly, never silently clamped). */
export class BudgetError extends Error {
	readonly code: 'OVERRUN' | 'BAD_ITEM';

	constructor(code: 'OVERRUN' | 'BAD_ITEM', message: string) {
		super(message);
		this.name = 'BudgetError';
		this.code = code;
	}
}

/** The per-model reservation plan. */
export interface ContextBudget {
	readonly providerId: string;
	readonly modelId: string;
	readonly contextWindowTokens: number;
	readonly inputReserveTokens: number;
	readonly outputReserveTokens: number;
	readonly toolReserveTokens: number;
	readonly source: 'capabilities-default' | 'policy-override';
	/** Human-readable derivation (the math, recorded with every plan). */
	readonly derivation: string;
}

/** Policy overrides for one model's budget (routing-policy rule payloads). */
export interface BudgetPolicyOverride {
	readonly outputReserveTokens?: number;
	readonly toolReserveTokens?: number;
	readonly inputReserveTokens?: number;
}

/** One unit of context submitted for fitting (Worker C's input shape). */
export interface BudgetItem {
	/** Stable id within the submission (referenced by every action). */
	readonly id: string;
	readonly kind: 'system' | 'conversation' | 'tool-result' | 'attachment';
	/** Estimated token cost of the item. */
	readonly tokens: number;
	/** Conversation position (oldest first; ties break by id). */
	readonly ordinal: number;
	/** Never dropped (mandated context, the current turn, ...). */
	readonly pinned?: boolean;
}

/** One recorded action on one item. */
export interface FittingAction {
	readonly action: 'keep' | 'truncate' | 'drop';
	readonly itemId: string;
	readonly tokens: number;
	readonly tokensBefore: number;
	readonly reason: string;
}

/** The compiled plan (the seam Worker C's context compilation consumes). */
export interface FittingPlan {
	readonly budget: ContextBudget;
	/** Actions in deterministic order (conversation order; drops and truncations recorded inline). */
	readonly actions: readonly FittingAction[];
	readonly totals: {
		readonly requestedTokens: number;
		readonly plannedTokens: number;
		readonly droppedTokens: number;
		readonly truncatedTokens: number;
		readonly headroomTokens: number;
		/** Positive when even maximal shedding cannot fit the pinned survivors. */
		readonly overflowTokens: number;
	};
	readonly fits: boolean;
}

/** Tail-keep truncation floor: a truncated item never shrinks below this. */
export const TRUNCATION_FLOOR_TOKENS = 64;

/** A truncated item keeps the newest quarter of itself (never below the floor). */
export const TRUNCATION_KEEP_FRACTION = 0.25;

function clampMinimum(value: number): number {
	return Math.max(1, value);
}

/**
 * Compiles the per-model budget. Defaults: output = min(maxOutputTokens,
 * floor(window/4)); tool = floor(window/10); input = window - output -
 * tool. Overrides replace their piece and are re-derived (input may also be
 * pinned directly; the remaining reserve then goes to the complementary
 * sides). Reserve sums beyond the window are typed OVERRUN failures.
 */
export function compileBudget(input: {
	readonly providerId: string;
	readonly modelId: string;
	readonly contextWindowTokens: number;
	readonly maxOutputTokens: number;
	readonly override?: BudgetPolicyOverride;
}): ContextBudget {
	const window = input.contextWindowTokens;
	if (!Number.isFinite(window) || window < 3) {
		throw new BudgetError('BAD_ITEM', `context window must be >= 3 tokens (got ${window})`);
	}
	const defaultOutput = Math.min(input.maxOutputTokens, Math.floor(window / 4));
	const defaultTool = Math.floor(window / 10);
	let outputReserve = input.override?.outputReserveTokens ?? defaultOutput;
	let toolReserve = input.override?.toolReserveTokens ?? defaultTool;
	let inputReserve = input.override?.inputReserveTokens ?? window - outputReserve - toolReserve;
	const overridden = input.override !== undefined && (input.override.outputReserveTokens !== undefined || input.override.toolReserveTokens !== undefined || input.override.inputReserveTokens !== undefined);
	if (input.override?.inputReserveTokens !== undefined && input.override.outputReserveTokens === undefined && input.override.toolReserveTokens === undefined) {
		// input pinned directly: the complementary default reserves shrink into the
		// remainder (halved; zero reserves are legitimate under an explicit pin)
		const remainder = Math.max(0, window - inputReserve);
		outputReserve = Math.min(defaultOutput, Math.floor(remainder / 2));
		toolReserve = Math.min(defaultTool, remainder - outputReserve);
	} else {
		outputReserve = clampMinimum(outputReserve);
		toolReserve = clampMinimum(toolReserve);
	}
	inputReserve = clampMinimum(inputReserve);
	if (inputReserve + outputReserve + toolReserve > window) {
		throw new BudgetError('OVERRUN', `reserves exceed the context window: input ${inputReserve} + output ${outputReserve} + tool ${toolReserve} > window ${window}`);
	}
	return {
		providerId: input.providerId,
		modelId: input.modelId,
		contextWindowTokens: window,
		inputReserveTokens: inputReserve,
		outputReserveTokens: outputReserve,
		toolReserveTokens: toolReserve,
		source: overridden ? 'policy-override' : 'capabilities-default',
		derivation: overridden
			? `policy override: input ${inputReserve} + output ${outputReserve} + tool ${toolReserve} = ${inputReserve + outputReserve + toolReserve} of window ${window}`
			: `defaults: output min(${input.maxOutputTokens}, floor(${window}/4)) = ${outputReserve}; tool floor(${window}/10) = ${toolReserve}; input ${window} - ${outputReserve} - ${toolReserve} = ${inputReserve}`,
	};
}

/** Order key for deterministic processing (ordinal, then id). */
function orderKey(item: BudgetItem): string {
	return `${String(item.ordinal).padStart(10, '0')}|${item.id}`;
}

/** The truncation size for one item (tail-keep: newest quarter, floor 64). */
export function truncatedTokens(item: BudgetItem): number {
	return Math.max(Math.min(TRUNCATION_FLOOR_TOKENS, item.tokens), Math.floor(item.tokens * TRUNCATION_KEEP_FRACTION));
}

/**
 * The budget compiler: fits a conversation + tool results against a
 * ContextBudget with deterministic truncation priority. Pure -- no clock,
 * no randomness; identical inputs produce identical plans.
 */
export function compileFittingPlan(input: {
	readonly budget: ContextBudget;
	readonly items: readonly BudgetItem[];
}): FittingPlan {
	const seen = new Set<string>();
	for (const item of input.items) {
		if (item.tokens < 0 || !Number.isFinite(item.tokens)) {
			throw new BudgetError('BAD_ITEM', `item '${item.id}' has a negative or non-finite token count`);
		}
		if (seen.has(item.id)) {
			throw new BudgetError('BAD_ITEM', `duplicate item id '${item.id}'`);
		}
		seen.add(item.id);
	}
	const sorted = [...input.items].sort((a, b) => orderKey(a).localeCompare(orderKey(b)));
	const lastItem = sorted.length === 0 ? undefined : sorted[sorted.length - 1];
	const isProtected = (item: BudgetItem): boolean => item.pinned === true || item.kind === 'system' || (lastItem !== undefined && item.id === lastItem.id);
	const requestedTokens = sorted.reduce((total, item) => total + item.tokens, 0);
	const budget = input.budget.inputReserveTokens;

	// nothing to shed: keep everything
	if (requestedTokens <= budget) {
		return {
			budget: input.budget,
			actions: sorted.map(item => ({ action: 'keep' as const, itemId: item.id, tokens: item.tokens, tokensBefore: item.tokens, reason: 'fits within the input reserve' })),
			totals: { requestedTokens, plannedTokens: requestedTokens, droppedTokens: 0, truncatedTokens: 0, headroomTokens: budget - requestedTokens, overflowTokens: 0 },
			fits: true,
		};
	}

	const actions: FittingAction[] = [];
	const survivors = new Map<string, number>(sorted.map(item => [item.id, item.tokens]));
	const dropStages: readonly { kinds: readonly BudgetItem['kind'][]; label: string }[] = [
		{ kinds: ['tool-result'], label: 'oldest non-pinned tool results are dropped first (deterministic priority 1)' },
		{ kinds: ['attachment'], label: 'oldest non-pinned attachments are dropped next (deterministic priority 2)' },
	];
	for (const stage of dropStages) {
		for (const item of sorted) {
			if (survivors.get(item.id) === undefined || isProtected(item) || !stage.kinds.includes(item.kind)) {
				continue;
			}
			if (currentTotal(survivors) <= budget) {
				break;
			}
			survivors.delete(item.id);
			actions.push({ action: 'drop', itemId: item.id, tokens: 0, tokensBefore: item.tokens, reason: stage.label });
		}
	}
	// priority 3: truncate oldest non-pinned conversation items (tail-keep)
	for (const item of sorted) {
		if (survivors.get(item.id) === undefined || isProtected(item) || item.kind !== 'conversation') {
			continue;
		}
		if (currentTotal(survivors) <= budget) {
			break;
		}
		const after = truncatedTokens(item);
		if (after < (survivors.get(item.id) ?? after)) {
			survivors.set(item.id, after);
			actions.push({ action: 'truncate', itemId: item.id, tokens: after, tokensBefore: item.tokens, reason: `oldest non-pinned conversation turns are truncated next (tail-keep: newest ${Math.round(TRUNCATION_KEEP_FRACTION * 100)}%, floor ${TRUNCATION_FLOOR_TOKENS}; deterministic priority 3)` });
		}
	}
	// priority 4: drop oldest non-pinned conversation items entirely
	for (const item of sorted) {
		if (survivors.get(item.id) === undefined || isProtected(item) || item.kind !== 'conversation') {
			continue;
		}
		if (currentTotal(survivors) <= budget) {
			break;
		}
		survivors.delete(item.id);
		actions.push({ action: 'drop', itemId: item.id, tokens: 0, tokensBefore: item.tokens, reason: 'oldest non-pinned conversation turns are dropped last (deterministic priority 4)' });
	}

	// record keeps for the survivors (conversation order)
	for (const item of sorted) {
		const tokens = survivors.get(item.id);
		if (tokens === undefined) {
			continue;
		}
		const action = actions.find(entry => entry.itemId === item.id);
		if (action === undefined) {
			actions.push({ action: 'keep', itemId: item.id, tokens, tokensBefore: item.tokens, reason: 'fits after shedding (protected or within reserve)' });
		}
	}
	// stable order: conversation order regardless of when the action was recorded
	actions.sort((a, b) => orderKey(itemById(sorted, a.itemId)).localeCompare(orderKey(itemById(sorted, b.itemId))));
	const plannedTokens = currentTotal(survivors);
	const overflowTokens = Math.max(0, plannedTokens - budget);
	const droppedTokens = actions.filter(action => action.action === 'drop').reduce((total, action) => total + action.tokensBefore, 0);
	const truncatedAwayTokens = actions.filter(action => action.action === 'truncate').reduce((total, action) => total + (action.tokensBefore - action.tokens), 0);
	return {
		budget: input.budget,
		actions,
		totals: {
			requestedTokens,
			plannedTokens,
			droppedTokens,
			truncatedTokens: truncatedAwayTokens,
			headroomTokens: Math.max(0, budget - plannedTokens),
			overflowTokens,
		},
		fits: overflowTokens === 0,
	};
}

function currentTotal(survivors: Map<string, number>): number {
	let total = 0;
	for (const tokens of survivors.values()) {
		total += tokens;
	}
	return total;
}

function itemById(sorted: readonly BudgetItem[], id: string): BudgetItem {
	const item = sorted.find(entry => entry.id === id);
	if (item === undefined) {
		throw new BudgetError('BAD_ITEM', `internal: item '${id}' vanished during compilation`);
	}
	return item;
}
