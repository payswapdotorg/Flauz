/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The context compiler (TL2-003 M2).
 *
 * Given (task, agent, model budget, memory records, shares, resource
 * fragments) produce the context-window content DETERMINISTICALLY:
 *
 *   - retrieval: relevance-ranked memory (retrieval.ts - pure, recorded rules);
 *   - assembly priority: system/task-brief -> working memory -> task memory
 *     -> project memory -> resource fragments;
 *   - truncation records: what was dropped and why (budget enforcement);
 *   - provenance preserved INTO the prompt: every line carries its
 *     [record MEM-id] [evidence E-id] [ref refId] tags.
 *
 * MODEL-AGNOSTIC BY CONSTRUCTION (the hard rule): budgets arrive as DATA
 * through the ContextBudget seam (the Worker B budget-seam shape, consumed
 * here as a fixture contract - the TL reconciles the shared type). No vendor
 * tokenizer, no vendor quota logic: estimateTokens() is the single token
 * accounting function and the budget is only compared against its output.
 *
 * Determinism proof: compileContext is pure over its inputs; the result
 * carries contentHash = sha256(canonicalJson(context minus the hash)) - same
 * inputs, same hash, byte-for-byte.
 */

import { canonicalJson, sha256Hex } from '../../flauz-workspace/src/api.ts';
import { type MemoryIndex, type MemoryIndexEntry, type MemoryRecord, estimateTokens } from './api.ts';
import { type EffectiveShare, retrieve } from './retrieval.ts';

// ---------------------------------------------------------------------------
// The budget seam (Worker B consumption - fixture contract, TL-reconciled)
// ---------------------------------------------------------------------------

/**
 * A model-agnostic context budget. This is the SHAPE Worker B's budget seam
 * emits; flauz-memory consumes it as data (no vendor coupling: `model.id` is
 * a label for provenance, never a branch).
 */
export interface ContextBudget {
	readonly model: { readonly id: string };
	readonly window: {
		/** Total input-token budget the compiled context must fit into. */
		readonly inputTokens: number;
		/** Reserved output tokens (never counted against the input budget). */
		readonly outputTokens: number;
	};
	/** Optional per-section caps (keys are section roles). */
	readonly sectionCaps?: Readonly<Record<string, number>>;
}

// ---------------------------------------------------------------------------
// Resource fragments (the Workspace OS dimension; descriptors arrive as
// fixture-shaped data - BrowserSessionDescriptor / EnvironmentDescriptor)
// ---------------------------------------------------------------------------

export const RESOURCE_FRAGMENT_KINDS = ['file', 'evidence', 'environment', 'browser-session', 'workflow'] as const;
export type ResourceFragmentKind = (typeof RESOURCE_FRAGMENT_KINDS)[number];

export interface ResourceFragment {
	/** Logical ref id (ResourceRef-shaped identity). */
	readonly refId: string;
	readonly kind: ResourceFragmentKind;
	readonly uri: string;
	readonly content: string;
	/** Provenance tags carried into the prompt (e.g. ['environment:T-001', 'agent:flauz.agent']). */
	readonly provenanceTags: readonly string[];
	/** Precomputed token estimate (defaults to estimateTokens(content)). */
	readonly tokens?: number;
}

// ---------------------------------------------------------------------------
// The compiled context
// ---------------------------------------------------------------------------

export const SECTION_ROLES = ['system', 'working', 'task-memory', 'project-memory', 'resources'] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export interface SectionProvenance {
	/** The memory record this line came from (when applicable). */
	readonly recordId?: string;
	/** The evidence row the record derived from (when applicable). */
	readonly evidenceId?: string | null;
	/** The resource fragment ref (when applicable). */
	readonly refId?: string;
}

export interface CompiledSection {
	readonly role: SectionRole;
	readonly content: string;
	readonly tokens: number;
	readonly provenance: readonly SectionProvenance[];
}

export interface TruncationRecord {
	readonly section: SectionRole;
	/** The record id / fragment ref id that was dropped ('(header)' never drops). */
	readonly droppedId: string;
	readonly reason: 'budget-exceeded' | 'section-cap';
	readonly reclaimedTokens: number;
}

export interface CompiledContext {
	readonly taskId: string | null;
	readonly agentId: string;
	readonly budget: ContextBudget;
	readonly sections: readonly CompiledSection[];
	/** What was dropped and why (the truncation audit). */
	readonly truncations: readonly TruncationRecord[];
	/** The ranking rules that produced the memory sections (recorded with the context). */
	readonly rankingRules: readonly { ruleId: string; weight: number; description: string }[];
	/** Entries excluded by the private-context boundary (ids only - never content). */
	readonly excludedPrivate: readonly string[];
	readonly generatedAt: number;
	/** sha256 over the canonical compilation - the determinism proof. */
	readonly contentHash: string;
}

// ---------------------------------------------------------------------------
// Index derivation from records (pure; the same law as MemoryStore.rebuildIndex)
// ---------------------------------------------------------------------------

function entryOf(record: MemoryRecord): MemoryIndexEntry {
	return {
		id: record.id,
		tier: record.tier,
		taskId: record.taskId,
		agentId: record.agentId,
		kind: record.kind,
		tags: [...record.tags],
		tokens: estimateTokens(record.content),
		created: record.timing.created,
		updatedAt: record.timing.updatedAt,
		pinned: record.pinned,
		evidenceId: record.provenance.evidenceId,
	};
}

/** Pure index derivation from full records (the compiler's retrieval input). */
export function indexFromRecords(records: readonly MemoryRecord[], generatedAt: number): MemoryIndex {
	const entries = records.map(entryOf).sort((a, b) => (a.id < b.id ? -1 : 1));
	return { $schema: 'flauz.memory.index/v1', journals: [...new Set(entries.map(entry => entry.tier === 'task' && entry.taskId !== null ? entry.taskId : '').filter(id => id.length > 0).concat(['S', 'P']))].sort(), entries, generatedAt };
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

export interface CompileContextInput {
	readonly taskId?: string;
	readonly agentId: string;
	readonly budget: ContextBudget;
	/** The full memory records (content + provenance; MemoryStore.listAll()). */
	readonly records: readonly MemoryRecord[];
	/** Effective share grants for the reading agent. */
	readonly shares?: readonly EffectiveShare[];
	/** Interest tags for the retrieval query. */
	readonly tags?: readonly string[];
	readonly resourceFragments?: readonly ResourceFragment[];
	/** The task brief (title/status) - omitted when the task is unknown. */
	readonly taskBrief?: { readonly title: string; readonly status: string };
	readonly nowMs: number;
}

export interface CompileResult {
	readonly context: CompiledContext;
	/** Input budget vs. what the compiled context actually consumed. */
	readonly accounting: {
		readonly inputBudget: number;
		readonly consumed: number;
		readonly reservedOutput: number;
	};
}

/** One renderable line of a section (header or body). */
interface SectionLine {
	readonly text: string;
	readonly tokens: number;
	readonly provenance: SectionProvenance | null;
}

/** Drop order under budget pressure: resources first; system NEVER drops. */
const DROP_ORDER: readonly SectionRole[] = ['resources', 'project-memory', 'task-memory', 'working'];

const HEADERS: Readonly<Record<SectionRole, string>> = {
	'system': '## Flauz context',
	'working': '## Working memory (live task)',
	'task-memory': '## Task memory',
	'project-memory': '## Project memory (long-term)',
	'resources': '## Resources',
};

function systemLines(input: CompileContextInput, taskId: string | null): SectionLine[] {
	const brief = input.taskBrief === undefined
		? 'No task brief available.'
		: `Task: ${input.taskBrief.title} [status: ${input.taskBrief.status}]`;
	const text = [
		HEADERS.system,
		brief,
		taskId === null ? 'Task id: (none)' : `Task id: ${taskId}`,
		`Agent: ${input.agentId}`,
		'Memory lines carry provenance tags: [record MEM-id] [evidence E-id] [ref refId].',
	].join('\n');
	return [{ text, tokens: estimateTokens(text), provenance: null }];
}

function memoryLinesOf(records: readonly MemoryRecord[]): SectionLine[] {
	return records.map(record => {
		const evidence = record.provenance.evidenceId === null ? '' : ` [evidence ${record.provenance.evidenceId}]`;
		const text = `- ${record.content} [record ${record.id}]${evidence}`;
		return { text, tokens: estimateTokens(record.content), provenance: { recordId: record.id, evidenceId: record.provenance.evidenceId } };
	});
}

function fragmentLinesOf(fragments: readonly ResourceFragment[]): SectionLine[] {
	return fragments.map(fragment => {
		const tags = fragment.provenanceTags.map(tag => `[${tag}]`).join(' ');
		const text = `- ${fragment.content} [ref ${fragment.refId}] ${tags}`.trim();
		return { text, tokens: fragment.tokens ?? estimateTokens(fragment.content), provenance: { refId: fragment.refId } };
	});
}

function sectionOf(role: SectionRole, lines: readonly SectionLine[]): CompiledSection {
	return {
		role,
		content: lines.map(line => line.text).join('\n'),
		tokens: lines.reduce((sum, line) => sum + line.tokens, 0),
		provenance: lines.map(line => line.provenance).filter((p): p is SectionProvenance => p !== null),
	};
}

/**
 * Deterministic context compilation. Same inputs -> same contentHash.
 *
 * Truncation policy (recorded, never silent): optional per-section caps drop
 * trailing (least-relevant - retrieval is relevance-DESC) lines first; the
 * whole-context budget then drops from the END of the lowest-priority
 * section (resources -> project -> task -> working as the last resort); the
 * system preamble NEVER drops (it is the task identity). Every drop appends a
 * truncation record.
 */
export function compileContext(input: CompileContextInput): CompileResult {
	const taskId = input.taskId ?? null;
	const shares = input.shares ?? [];
	const nowMs = input.nowMs;
	const index = indexFromRecords(input.records, nowMs);
	const contentById = new Map(input.records.map(record => [record.id, record] as const));
	const query = {
		agentId: input.agentId,
		...(taskId !== null ? { taskId } : {}),
		...(input.tags !== undefined ? { tags: [...input.tags] } : {}),
	};
	const workingRank = retrieve(index, { ...query, tier: 'session' }, nowMs, shares);
	const taskRank = retrieve(index, { ...query, tier: 'task' }, nowMs, shares);
	const projectRank = retrieve(index, { ...query, tier: 'project' }, nowMs, shares);
	const excludedPrivate = [...new Set([...workingRank.excludedPrivate, ...taskRank.excludedPrivate, ...projectRank.excludedPrivate])].sort();

	const lines: Record<SectionRole, SectionLine[]> = {
		'system': systemLines(input, taskId),
		'working': [headerOf('working'), ...memoryLinesOf(workingRank.entries.map(ranked => contentById.get(ranked.entry.id)).filter((record): record is MemoryRecord => record !== undefined))],
		'task-memory': [headerOf('task-memory'), ...memoryLinesOf(taskRank.entries.map(ranked => contentById.get(ranked.entry.id)).filter((record): record is MemoryRecord => record !== undefined))],
		'project-memory': [headerOf('project-memory'), ...memoryLinesOf(projectRank.entries.map(ranked => contentById.get(ranked.entry.id)).filter((record): record is MemoryRecord => record !== undefined))],
		'resources': [headerOf('resources'), ...fragmentLinesOf(input.resourceFragments ?? [])],
	};

	const truncations: TruncationRecord[] = [];

	// Per-section caps (drop trailing lines until within cap; headers survive).
	for (const role of SECTION_ROLES) {
		const cap = input.budget.sectionCaps?.[role];
		if (cap === undefined) {
			continue;
		}
		while (tokensOf(lines[role]) > cap && lines[role].length > 1) {
			const dropped = lines[role][lines[role].length - 1];
			lines[role] = lines[role].slice(0, -1);
			if (dropped === undefined) {
				break;
			}
			truncations.push({ section: role, droppedId: dropped.provenance === null ? '(header)' : (dropped.provenance.recordId ?? dropped.provenance.refId ?? '(unknown)'), reason: 'section-cap', reclaimedTokens: dropped.tokens });
		}
	}

	// Whole-context input budget.
	while (totalTokens(lines) > input.budget.window.inputTokens) {
		let droppedOne = false;
		for (const role of DROP_ORDER) {
			if (lines[role].length <= 1) {
				continue;
			}
			const dropped = lines[role][lines[role].length - 1];
			lines[role] = lines[role].slice(0, -1);
			if (dropped === undefined) {
				continue;
			}
			truncations.push({ section: role, droppedId: dropped.provenance === null ? '(header)' : (dropped.provenance.recordId ?? dropped.provenance.refId ?? '(unknown)'), reason: 'budget-exceeded', reclaimedTokens: dropped.tokens });
			droppedOne = true;
			break;
		}
		if (!droppedOne) {
			// Only the never-dropping core remains and the budget is still
			// exceeded: emit as-is (the truncation records explain the state;
			// the caller sees consumed > budget in the accounting row).
			break;
		}
	}

	const sections = SECTION_ROLES.map(role => sectionOf(role, lines[role]));
	const consumed = sections.reduce((sum, section) => sum + section.tokens, 0);
	const context: Omit<CompiledContext, 'contentHash'> = {
		taskId,
		agentId: input.agentId,
		budget: input.budget,
		sections,
		truncations,
		rankingRules: workingRank.rules,
		excludedPrivate,
		generatedAt: nowMs,
	};
	return {
		context: { ...context, contentHash: sha256Hex(canonicalJson(context)) },
		accounting: {
			inputBudget: input.budget.window.inputTokens,
			consumed,
			reservedOutput: input.budget.window.outputTokens,
		},
	};
}

function headerOf(role: SectionRole): SectionLine {
	return { text: HEADERS[role], tokens: estimateTokens(HEADERS[role]), provenance: null };
}

function tokensOf(sectionLines: readonly SectionLine[]): number {
	return sectionLines.reduce((sum, line) => sum + line.tokens, 0);
}

function totalTokens(lines: Record<SectionRole, SectionLine[]>): number {
	return SECTION_ROLES.reduce((sum, role) => sum + tokensOf(lines[role]), 0);
}
