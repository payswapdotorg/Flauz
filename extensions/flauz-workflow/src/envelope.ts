/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz workflow envelope v1 (Wave 4, Lane K).
 *
 * A saved RUN = the task envelope (`.flauz/tasks.json`, `flauz.tasks/v0` - owned by
 * extensions/flauz-workspace) PLUS a workflow fragment at `.flauz/workflows/<id>.json`
 * (git-diffable, DL-9/DL-10). The fragment captures, per the work order:
 *
 *   - the run's plan                (plan.prompt = originating prompt, plan.text = submitted plan)
 *   - the tool sequence             (tools[]: ordered steps with input + approval mode + outcome)
 *   - the approval decisions        (approvals[]: the human-gate outcomes of the original run)
 *   - the evidence refs             (evidenceRefs[]: the original run's ledger rows)
 *   - model/provider + params       (model: the provider/model the run used)
 *   - the re-run recipe             (rerun.approvals: 'replay' recorded decisions | 'ask' fresh)
 *
 * Re-run semantics (`flauz.workflow.run`, one command): hydrate the plan into a fresh
 * task (flauz.tasks/v0 state machine, all 9 transitions enforced by TaskService),
 * replay-approvals-or-ask at the human gates, execute the recorded tool sequence
 * through the injected ToolExecutorPort, append NEW evidence rows for the new outputs,
 * and link every new row to the ORIGINAL run's row via `derivedFrom` (DL-29 candidate:
 * derivedFrom linking semantics). The fragment's `history` array records each re-run.
 *
 * Node-free core: all IO goes through the FileSystemPort / TaskService / EvidenceLedger
 * ports (same discipline as flauz-workspace src - typechecks without @types/node, runs
 * under plain `node --test` via type-stripping).
 */

import {
	type Clock,
	type Envelope as TaskEnvelope,
	type EvidenceKind,
	type FileSystemPort,
	type Task,
	type TaskEvent,
	clone,
	deepSorted,
	isEvidenceKind,
	isSha256Hex,
	isTaskId,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';
import type { TaskService } from '../../flauz-workspace/src/taskService.ts';
import type { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { hasKey } from '../../flauz-workspace/src/ledger.ts';

/** Schema identifier pinned into every workflow fragment. */
export const WORKFLOW_SCHEMA = 'flauz.workflows/v1';

/** Directory (relative to the workspace root) holding workflow fragments. */
export const WORKFLOWS_DIR = '.flauz/workflows';

const WORKFLOW_ID_PATTERN = /^W-\d{3,}$/;
const EVIDENCE_ID_PATTERN = /^E-\d{6,}$/;

/** v0 default model attribution: the flauz-models deterministic mock provider. */
export const DEFAULT_WORKFLOW_MODEL: Readonly<WorkflowModel> = Object.freeze({
	provider: 'flauz-mock',
	model: 'flauz-mock-1',
	params: Object.freeze({}) as Record<string, unknown>,
});

export type RerunApprovalMode = 'replay' | 'ask';
export type ToolApprovalMode = 'recorded' | 'ask';
export type ToolOutcome = 'ok' | 'failed';

export interface WorkflowPlan {
	readonly prompt: string;
	readonly text: string;
}

export interface WorkflowModel {
	readonly provider: string;
	readonly model: string;
	readonly params?: Record<string, unknown>;
}

export interface WorkflowToolStep {
	readonly seq: number;
	readonly toolId: string;
	readonly name: string | null;
	readonly input: Record<string, unknown>;
	readonly approval: ToolApprovalMode;
	readonly outcome: ToolOutcome;
	readonly evidenceId: string | null;
}

export interface WorkflowApprovalStep {
	readonly type: 'approve' | 'request-changes';
	readonly ts: number;
	readonly note: string | null;
}

export interface WorkflowEvidenceRef {
	readonly evidenceId: string;
	readonly seq: number;
	readonly kind: EvidenceKind;
	readonly uri: string;
	readonly sha256: string;
	readonly derivedFrom: string | null;
}

export interface WorkflowRerunRecipe {
	readonly approvals: RerunApprovalMode;
}

export interface WorkflowRunRecord {
	readonly taskId: string;
	readonly ts: number;
	readonly derivedFrom: WorkflowDerivation;
}

export interface WorkflowDerivation {
	readonly taskId: string;
	readonly evidenceIds: readonly string[];
}

export interface WorkflowFragment {
	readonly $schema: string;
	readonly id: string;
	readonly title: string;
	readonly source: WorkflowDerivation;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly plan: WorkflowPlan;
	readonly model: WorkflowModel;
	readonly tools: readonly WorkflowToolStep[];
	readonly approvals: readonly WorkflowApprovalStep[];
	readonly evidenceRefs: readonly WorkflowEvidenceRef[];
	readonly rerun: WorkflowRerunRecipe;
	readonly history: readonly WorkflowRunRecord[];
}

// ---------------------------------------------------------------------------
// Validation (strict, mirrors the flauz.tasks/v0 discipline: exact key sets,
// explicit error messages that the bad fixtures violate one rule at a time).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	if (actual.length !== required.length + optional.length) {
		return false;
	}
	for (const key of required) {
		if (!hasKey(value, key)) {
			return false;
		}
	}
	for (const key of actual) {
		if (!required.includes(key) && !optional.includes(key)) {
			return false;
		}
	}
	return true;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isStringOrNull(value: unknown): value is string | null {
	return value === null || typeof value === 'string';
}

export function isWorkflowId(value: unknown): value is string {
	return typeof value === 'string' && WORKFLOW_ID_PATTERN.test(value);
}

export function isEvidenceId(value: unknown): value is string {
	return typeof value === 'string' && EVIDENCE_ID_PATTERN.test(value);
}

function validateDerivation(value: unknown, label: string): WorkflowDerivation {
	if (!isPlainObject(value) || !hasKeys(value, ['taskId', 'evidenceIds'])) {
		throw new Error(`${label}: derivedFrom/source must have exactly the keys [evidenceIds, taskId]`);
	}
	if (!isTaskId(value.taskId)) {
		throw new Error(`${label}: taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(value.taskId)})`);
	}
	if (!Array.isArray(value.evidenceIds)) {
		throw new Error(`${label}: evidenceIds must be an array`);
	}
	const evidenceIds = value.evidenceIds.map((id, index) => {
		if (!isEvidenceId(id)) {
			throw new Error(`${label}: evidenceIds[${String(index)}] must match /^E-\\d{6,}$/ (got ${JSON.stringify(id)})`);
		}
		return id as string;
	});
	return { taskId: value.taskId, evidenceIds };
}

function validatePlan(value: unknown, label: string): WorkflowPlan {
	if (!isPlainObject(value) || !hasKeys(value, ['prompt', 'text'])) {
		throw new Error(`${label}: plan must have exactly the keys [prompt, text]`);
	}
	if (typeof value.prompt !== 'string') {
		throw new Error(`${label}: plan.prompt must be a string`);
	}
	if (!isNonEmptyString(value.text)) {
		throw new Error(`${label}: plan.text must be a non-empty string`);
	}
	return { prompt: value.prompt, text: value.text };
}

function validateModel(value: unknown, label: string): WorkflowModel {
	if (!isPlainObject(value) || !hasKeys(value, ['provider', 'model'], ['params'])) {
		throw new Error(`${label}: model must have exactly the keys [model, params?, provider]`);
	}
	if (!isNonEmptyString(value.provider)) {
		throw new Error(`${label}: model.provider must be a non-empty string`);
	}
	if (!isNonEmptyString(value.model)) {
		throw new Error(`${label}: model.model must be a non-empty string`);
	}
	if (value.params !== undefined && !isPlainObject(value.params)) {
		throw new Error(`${label}: model.params must be a plain object when present`);
	}
	const model: WorkflowModel = value.params !== undefined
		? { provider: value.provider, model: value.model, params: value.params }
		: { provider: value.provider, model: value.model };
	return model;
}

function validateToolStep(value: unknown, label: string): WorkflowToolStep {
	if (!isPlainObject(value) || !hasKeys(value, ['seq', 'toolId', 'name', 'input', 'approval', 'outcome', 'evidenceId'])) {
		throw new Error(`${label}: tool step must have exactly the keys [approval, evidenceId, input, name, outcome, seq, toolId]`);
	}
	if (!isPositiveInteger(value.seq)) {
		throw new Error(`${label}: seq must be a positive integer`);
	}
	if (!isNonEmptyString(value.toolId)) {
		throw new Error(`${label}: toolId must be a non-empty string`);
	}
	if (!isStringOrNull(value.name)) {
		throw new Error(`${label}: name must be a string or null`);
	}
	if (!isPlainObject(value.input)) {
		throw new Error(`${label}: input must be a plain object`);
	}
	if (value.approval !== 'recorded' && value.approval !== 'ask') {
		throw new Error(`${label}: approval must be 'recorded' or 'ask' (got ${JSON.stringify(value.approval)})`);
	}
	if (value.outcome !== 'ok' && value.outcome !== 'failed') {
		throw new Error(`${label}: outcome must be 'ok' or 'failed' (got ${JSON.stringify(value.outcome)})`);
	}
	if (value.evidenceId !== null && !isEvidenceId(value.evidenceId)) {
		throw new Error(`${label}: evidenceId must match /^E-\\d{6,}$/ or be null (got ${JSON.stringify(value.evidenceId)})`);
	}
	return {
		seq: value.seq,
		toolId: value.toolId,
		name: value.name,
		input: value.input,
		approval: value.approval,
		outcome: value.outcome,
		evidenceId: value.evidenceId,
	};
}

function validateApprovalStep(value: unknown, label: string): WorkflowApprovalStep {
	if (!isPlainObject(value) || !hasKeys(value, ['type', 'ts', 'note'])) {
		throw new Error(`${label}: approval step must have exactly the keys [note, ts, type]`);
	}
	if (value.type !== 'approve' && value.type !== 'request-changes') {
		throw new Error(`${label}: type must be 'approve' or 'request-changes' (got ${JSON.stringify(value.type)})`);
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error(`${label}: ts must be a positive integer (epoch ms)`);
	}
	if (!isStringOrNull(value.note)) {
		throw new Error(`${label}: note must be a string or null`);
	}
	return { type: value.type, ts: value.ts, note: value.note };
}

function validateEvidenceRef(value: unknown, label: string): WorkflowEvidenceRef {
	if (!isPlainObject(value) || !hasKeys(value, ['evidenceId', 'seq', 'kind', 'uri', 'sha256', 'derivedFrom'])) {
		throw new Error(`${label}: evidence ref must have exactly the keys [derivedFrom, evidenceId, kind, seq, sha256, uri]`);
	}
	if (!isEvidenceId(value.evidenceId)) {
		throw new Error(`${label}: evidenceId must match /^E-\\d{6,}$/ (got ${JSON.stringify(value.evidenceId)})`);
	}
	if (!isPositiveInteger(value.seq)) {
		throw new Error(`${label}: seq must be a positive integer`);
	}
	if (!isEvidenceKind(value.kind)) {
		throw new Error(`${label}: kind must be one of changeset|screenshot|command-output|note (got ${JSON.stringify(value.kind)})`);
	}
	if (!isNonEmptyString(value.uri)) {
		throw new Error(`${label}: uri must be a non-empty string`);
	}
	if (!isSha256Hex(value.sha256)) {
		throw new Error(`${label}: sha256 must be 64 lowercase hex chars`);
	}
	if (value.derivedFrom !== null && !isEvidenceId(value.derivedFrom)) {
		throw new Error(`${label}: derivedFrom must match /^E-\\d{6,}$/ or be null (got ${JSON.stringify(value.derivedFrom)})`);
	}
	return {
		evidenceId: value.evidenceId,
		seq: value.seq,
		kind: value.kind,
		uri: value.uri,
		sha256: value.sha256,
		derivedFrom: value.derivedFrom,
	};
}

/** Strict validation of a workflow fragment (throws with the offending rule). */
export function validateWorkflowFragment(value: unknown): WorkflowFragment {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'id', 'title', 'source', 'createdAt', 'updatedAt', 'plan', 'model', 'tools', 'approvals', 'evidenceRefs', 'rerun', 'history'])) {
		throw new Error('flauz.workflows/v1: fragment validation failed: expected exactly the keys [$schema, approvals, createdAt, evidenceRefs, history, id, model, plan, rerun, source, title, tools, updatedAt]');
	}
	if (value.$schema !== WORKFLOW_SCHEMA) {
		throw new Error(`flauz.workflows/v1: fragment validation failed: $schema must be '${WORKFLOW_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (!isWorkflowId(value.id)) {
		throw new Error(`flauz.workflows/v1: fragment validation failed: id must match /^W-\\d{3,}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (!isNonEmptyString(value.title)) {
		throw new Error(`flauz.workflows/v1: fragment validation failed: title must be a non-empty string`);
	}
	const source = validateDerivation(value.source, `flauz.workflows/v1: fragment ${String(value.id)} source`);
	if (!isPositiveInteger(value.createdAt)) {
		throw new Error('flauz.workflows/v1: fragment validation failed: createdAt must be a positive integer (epoch ms)');
	}
	if (!isPositiveInteger(value.updatedAt)) {
		throw new Error('flauz.workflows/v1: fragment validation failed: updatedAt must be a positive integer (epoch ms)');
	}
	const plan = validatePlan(value.plan, `flauz.workflows/v1: fragment ${String(value.id)}`);
	const model = validateModel(value.model, `flauz.workflows/v1: fragment ${String(value.id)}`);
	if (!Array.isArray(value.tools)) {
		throw new Error(`flauz.workflows/v1: fragment ${String(value.id)} tools must be an array`);
	}
	const tools = value.tools.map((step, index) => validateToolStep(step, `flauz.workflows/v1: fragment ${String(value.id)} tool #${String(index)}`));
	let expectedSeq = 1;
	for (const step of tools) {
		if (step.seq !== expectedSeq) {
			throw new Error(`flauz.workflows/v1: fragment validation failed: tool seq must be contiguous from 1 (tool #${String(step.seq - 1)} followed by ${String(step.seq)})`);
		}
		expectedSeq += 1;
	}
	if (!Array.isArray(value.approvals)) {
		throw new Error(`flauz.workflows/v1: fragment ${String(value.id)} approvals must be an array`);
	}
	const approvals = value.approvals.map((step, index) => validateApprovalStep(step, `flauz.workflows/v1: fragment ${String(value.id)} approval #${String(index)}`));
	if (!Array.isArray(value.evidenceRefs)) {
		throw new Error(`flauz.workflows/v1: fragment ${String(value.id)} evidenceRefs must be an array`);
	}
	const evidenceRefs = value.evidenceRefs.map((ref, index) => validateEvidenceRef(ref, `flauz.workflows/v1: fragment ${String(value.id)} evidenceRef #${String(index)}`));
	if (!isPlainObject(value.rerun) || !hasKeys(value.rerun, ['approvals'])) {
		throw new Error(`flauz.workflows/v1: fragment ${String(value.id)} rerun must have exactly the keys [approvals]`);
	}
	if (value.rerun.approvals !== 'replay' && value.rerun.approvals !== 'ask') {
		throw new Error(`flauz.workflows/v1: fragment validation failed: rerun.approvals must be 'replay' or 'ask' (got ${JSON.stringify(value.rerun.approvals)})`);
	}
	if (!Array.isArray(value.history)) {
		throw new Error(`flauz.workflows/v1: fragment ${String(value.id)} history must be an array`);
	}
	const history = value.history.map((record, index) => {
		const label = `flauz.workflows/v1: fragment ${String(value.id)} history #${String(index)}`;
		if (!isPlainObject(record) || !hasKeys(record, ['taskId', 'ts', 'derivedFrom'])) {
			throw new Error(`${label}: must have exactly the keys [derivedFrom, taskId, ts]`);
		}
		if (!isTaskId(record.taskId)) {
			throw new Error(`${label}: taskId must match /^T-\\d{3,}$/`);
		}
		if (!isPositiveInteger(record.ts)) {
			throw new Error(`${label}: ts must be a positive integer`);
		}
		return { taskId: record.taskId, ts: record.ts, derivedFrom: validateDerivation(record.derivedFrom, label) };
	});
	return {
		$schema: WORKFLOW_SCHEMA,
		id: value.id,
		title: value.title,
		source,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
		plan,
		model,
		tools,
		approvals,
		evidenceRefs,
		rerun: { approvals: value.rerun.approvals },
		history,
	};
}

/** Canonical serialization (DL-9 git-diffability discipline: sorted keys, 2-space, one trailing newline). */
export function serializeWorkflowFragment(fragment: WorkflowFragment): string {
	return JSON.stringify(deepSorted(fragment), null, 2) + '\n';
}

/** Workspace-relative POSIX path of a fragment file. */
export function workflowPath(id: string): string {
	return joinPath(WORKFLOWS_DIR, `${id}.json`);
}

/** Workspace-relative POSIX path of the fragment registry (the FileSystemPort has no readdir). */
export const WORKFLOW_INDEX_PATH = `${WORKFLOWS_DIR}/index.json`;

function allocateWorkflowId(existing: readonly { readonly id: string }[]): string {
	let max = 0;
	for (const fragment of existing) {
		const match = /^W-(\d+)$/.exec(fragment.id);
		if (match) {
			const numeric = Number.parseInt(match[1] ?? '0', 10);
			if (numeric > max) {
				max = numeric;
			}
		}
	}
	return `W-${String(max + 1).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Distillation: task (flauz.tasks/v0) -> workflow fragment.
// ---------------------------------------------------------------------------

export interface DistillOptions {
	/** Model attribution for the fragment (v0: not carried in task events; caller supplies). */
	readonly model?: WorkflowModel;
	/** Re-run recipe (default 'replay'). */
	readonly rerunApprovals?: RerunApprovalMode;
	readonly id?: string;
	readonly clock?: Clock;
}

/** Terminal tool id of the Wave-3 golden path (extensions/flauz-agent/src/tools/terminalTool.ts). */
export const TERMINAL_TOOL_ID = 'flauz_terminal';

/**
 * Distills a task (any status - save works after OR during a run) into a workflow
 * fragment by walking the task timeline:
 *
 *   - 'created' event payload.title (or the task title)  -> plan.prompt
 *   - 'submit-plan' event payload.plan                   -> plan.text
 *   - 'approve' / 'request-changes' events               -> approvals[]
 *   - 'evidence' events                                  -> evidenceRefs[]; command-output
 *                                                          rows with a note (the command)
 *                                                          additionally become tool steps
 *   - 'fail' event                                       -> last tool step outcome 'failed'
 */
export function distillTaskToFragment(task: Task, options: DistillOptions = {}): WorkflowFragment {
	const clock = options.clock ?? (() => Date.now());
	const now = clock();
	const created = task.events.find(event => event.type === 'created');
	const planEvent = task.events.find(event => event.type === 'submit-plan');
	const prompt = typeof created?.payload.title === 'string' ? created.payload.title : task.title;
	const planText = typeof planEvent?.payload.plan === 'string' && planEvent.payload.plan.length > 0
		? planEvent.payload.plan
		: `## Flauz workflow - ${task.id}\n\n${task.title}`;
	const approvals: WorkflowApprovalStep[] = [];
	const evidenceRefs: WorkflowEvidenceRef[] = [];
	const tools: WorkflowToolStep[] = [];
	for (const event of task.events) {
		if (event.type === 'approve') {
			approvals.push({ type: 'approve', ts: event.ts, note: typeof event.payload.note === 'string' ? event.payload.note : null });
		} else if (event.type === 'request-changes') {
			approvals.push({ type: 'request-changes', ts: event.ts, note: typeof event.payload.note === 'string' ? event.payload.note : null });
		} else if (event.type === 'evidence') {
			const payload = event.payload as Record<string, unknown>;
			const evidenceId = typeof payload.evidenceId === 'string' ? payload.evidenceId : '';
			const seq = typeof payload.seq === 'number' ? payload.seq : 0;
			const kind = payload.kind;
			const uri = typeof payload.uri === 'string' ? payload.uri : '';
			const sha256 = typeof payload.sha256 === 'string' ? payload.sha256 : '';
			if (isEvidenceId(evidenceId) && isPositiveInteger(seq) && isEvidenceKind(kind) && isNonEmptyString(uri) && isSha256Hex(sha256)) {
				evidenceRefs.push({ evidenceId, seq, kind, uri, sha256, derivedFrom: null });
				if (kind === 'command-output') {
					const note = typeof payload.note === 'string' ? payload.note : '';
					tools.push({
						seq: tools.length + 1,
						toolId: TERMINAL_TOOL_ID,
						name: note.length > 0 ? note : null,
						input: { command: note },
						approval: 'recorded',
						outcome: 'ok',
						evidenceId,
					});
				}
			}
		}
	}
	if (task.events.some(event => event.type === 'fail') && tools.length > 0) {
		const last = tools[tools.length - 1] as WorkflowToolStep;
		tools[tools.length - 1] = { ...last, outcome: 'failed' };
	}
	return {
		$schema: WORKFLOW_SCHEMA,
		id: options.id ?? 'W-001',
		title: task.title,
		source: { taskId: task.id, evidenceIds: evidenceRefs.map(ref => ref.evidenceId) },
		createdAt: now,
		updatedAt: now,
		plan: { prompt, text: planText },
		model: clone(options.model ?? DEFAULT_WORKFLOW_MODEL),
		tools,
		approvals,
		evidenceRefs,
		rerun: { approvals: options.rerunApprovals ?? 'replay' },
		history: [],
	};
}

// ---------------------------------------------------------------------------
// Re-run engine: ports + the WorkflowService.
// ---------------------------------------------------------------------------

/** Executes one recorded tool step (v0: the extension wires the terminal tool; tests inject fakes). */
export type ToolExecutorPort = (step: WorkflowToolStep) => Promise<{ ok: boolean; output: string }>;

/** Human gate for 'ask' mode (v0: quick-pick in the extension; injected in tests). */
export type ApprovalPort = (gate: 'approval' | 'sign-off', fragment: WorkflowFragment) => Promise<'approve' | 'request-changes' | 'cancel' | 'sign-off' | 'skip'>;

export interface WorkflowRunOutcome {
	readonly workflowId: string;
	readonly taskId: string;
	readonly status: string;
	readonly evidenceIds: readonly string[];
	readonly ledger: { readonly ok: boolean; readonly rows: number; readonly firstBadSeq?: number };
	readonly stopped: 'completed' | 'request-changes' | 'cancelled' | 'tool-failed' | 'verify-fail' | 'awaiting-signoff';
}

export interface WorkflowSaveOptions {
	readonly taskId: string;
	readonly model?: WorkflowModel;
	readonly rerunApprovals?: RerunApprovalMode;
}

export interface WorkflowRunOptions {
	readonly workflowId: string;
	readonly executor: ToolExecutorPort;
	/** Overrides the fragment's recorded recipe ('replay' | 'ask'). */
	readonly approvals?: RerunApprovalMode;
	/** Required when the effective mode is 'ask'. */
	readonly ask?: ApprovalPort;
}

export interface WorkflowServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly clock?: Clock;
}

export class WorkflowService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly tasks: TaskService;
	private readonly ledger: EvidenceLedger;
	private readonly clock: Clock;

	constructor(options: WorkflowServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.tasks = options.tasks;
		this.ledger = options.ledger;
		this.clock = options.clock ?? (() => Date.now());
	}

	private fragmentPath(id: string): string {
		return joinPath(this.root, workflowPath(id));
	}

	/** Saves a run (any task status) as a new workflow fragment; records the save on the task timeline. */
	async save(options: WorkflowSaveOptions): Promise<{ workflowId: string; path: string }> {
		const task = await this.tasks.getTask(options.taskId);
		const existing = await this.list();
		const id = allocateWorkflowId(existing);
		const fragment = distillTaskToFragment(task, {
			model: options.model,
			rerunApprovals: options.rerunApprovals,
			id,
			clock: this.clock,
		});
		await this.write(fragment);
		await this.tasks.appendEvent(task.id, {
			ts: this.clock(),
			actor: 'tool',
			type: 'workflow-saved',
			payload: { workflowId: id, path: workflowPath(id), evidenceCount: fragment.evidenceRefs.length },
		});
		return { workflowId: id, path: workflowPath(id) };
	}

	private async write(fragment: WorkflowFragment): Promise<void> {
		const target = this.fragmentPath(fragment.id);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, serializeWorkflowFragment(fragment));
		await this.fs.rename(tmp, target);
		await this.addToIndex(fragment.id);
	}

	/** index.json is the registry (the FileSystemPort has no readdir); sequential scan is the legacy fallback. */
	private async addToIndex(id: string): Promise<void> {
		const ids = await this.indexIds();
		if (!ids.includes(id)) {
			ids.push(id);
		}
		const index = { $schema: WORKFLOW_SCHEMA, workflows: ids };
		const target = joinPath(this.root, WORKFLOW_INDEX_PATH);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(deepSorted(index), null, 2)}\n`);
		await this.fs.rename(tmp, target);
	}

	private async indexIds(): Promise<string[]> {
		const raw = await this.fs.readFileUtf8(joinPath(this.root, WORKFLOW_INDEX_PATH));
		if (raw !== undefined) {
			const parsed = JSON.parse(raw) as { workflows?: unknown };
			if (Array.isArray(parsed.workflows)) {
				return parsed.workflows.filter((id): id is string => typeof id === 'string');
			}
		}
		// Legacy / hand-authored workspace: sequential scan until the first miss.
		const ids: string[] = [];
		for (let n = 1; n <= 999; n++) {
			const id = `W-${String(n).padStart(3, '0')}`;
			if (await this.fs.readFileUtf8(this.fragmentPath(id)) === undefined) {
				break;
			}
			ids.push(id);
		}
		return ids;
	}

	async list(): Promise<WorkflowFragment[]> {
		const fragments: WorkflowFragment[] = [];
		for (const id of await this.indexIds()) {
			const raw = await this.fs.readFileUtf8(this.fragmentPath(id));
			if (raw !== undefined) {
				fragments.push(this.parse(raw, id));
			}
		}
		return fragments;
	}

	async load(id: string): Promise<WorkflowFragment> {
		if (!isWorkflowId(id)) {
			throw new Error(`flauz.workflows/v1: unknown workflow id '${id}' (must match /^W-\\d{3,}$/)`);
		}
		const raw = await this.fs.readFileUtf8(this.fragmentPath(id));
		if (raw === undefined) {
			throw new Error(`flauz.workflows/v1: workflow '${id}' not found at ${workflowPath(id)}`);
		}
		return this.parse(raw, id);
	}

	private parse(raw: string, id: string): WorkflowFragment {
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.workflows/v1: workflow '${id}' is not valid JSON: ${(err as Error).message}`);
		}
		return validateWorkflowFragment(parsed);
	}

	/**
	 * The one-command re-run (work order section 3): hydrate plan -> replay-approvals-or-ask
	 * -> execute tools -> new ledger rows linked to the ORIGINAL run's rows via derivedFrom.
	 *
	 * Every state change goes through TaskService.appendEvent, so the flauz.tasks/v0
	 * 9-transition machine (actor gates included) governs the replay exactly as it
	 * governed the original run.
	 */
	async run(options: WorkflowRunOptions): Promise<WorkflowRunOutcome> {
		const fragment = await this.load(options.workflowId);
		const mode = options.approvals ?? fragment.rerun.approvals;
		if (mode === 'ask' && options.ask === undefined) {
			throw new Error('flauz.workflow.run: approvals mode is \'ask\' but no ask port was supplied');
		}
		const ask = options.ask ?? (async () => 'approve' as const);
		const created = await this.tasks.createTask(fragment.title);
		const taskId = created.id;
		const newEvidenceIds: string[] = [];
		const derivedFrom = { taskId: fragment.source.taskId, evidenceIds: fragment.source.evidenceIds };

		await this.tasks.appendEvent(taskId, {
			ts: this.clock(),
			actor: 'agent',
			type: 'workflow-start',
			payload: { workflowId: fragment.id, derivedFrom },
		});
		await this.tasks.appendEvent(taskId, {
			ts: this.clock(),
			actor: 'agent',
			type: 'submit-plan',
			payload: { plan: fragment.plan.text, requestId: `flauz-workflow-${fragment.id}-${taskId}` },
		});

		// --- human gate 1: approval ---
		if (mode === 'ask') {
			const decision = await ask('approval', fragment);
			if (decision === 'cancel') {
				await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'cancel', payload: { gate: 'approval' } });
				await this.recordHistory(fragment, taskId, newEvidenceIds);
				return this.outcome(fragment.id, taskId, 'cancelled', newEvidenceIds, 'cancelled');
			}
			if (decision === 'request-changes') {
				await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'request-changes', payload: { gate: 'approval' } });
				await this.recordHistory(fragment, taskId, newEvidenceIds);
				return this.outcome(fragment.id, taskId, 'plan', newEvidenceIds, 'request-changes');
			}
			if (decision !== 'approve' && decision !== 'sign-off' && decision !== 'skip') {
				throw new Error(`flauz.workflow.run: ask port returned an invalid approval decision '${String(decision)}'`);
			}
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'approve', payload: { gate: 'approval', asked: true } });
		} else {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'approve', payload: { gate: 'approval', replayed: true, workflowId: fragment.id } });
		}

		// --- tool sequence ---
		let toolIndex = 0;
		for (const step of fragment.tools) {
			if (step.approval === 'ask') {
				const decision = await ask('approval', fragment);
				if (decision !== 'approve') {
					await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'cancel', payload: { gate: 'tool', toolSeq: step.seq } });
					await this.recordHistory(fragment, taskId, newEvidenceIds);
					return this.outcome(fragment.id, taskId, 'cancelled', newEvidenceIds, 'cancelled');
				}
			}
			const result = await options.executor(step);
			toolIndex += 1;
			const artifact = await this.writeArtifact(taskId, toolIndex, result.output);
			const appended = await this.ledger.append(taskId, {
				kind: 'command-output',
				uri: artifact.uri,
				sha256: artifact.sha256,
				note: typeof step.input.command === 'string' ? step.input.command : '',
			});
			newEvidenceIds.push(appended.evidenceId);
			await this.tasks.appendEvent(taskId, {
				ts: this.clock(),
				actor: 'tool',
				type: 'evidence',
				payload: {
					evidenceId: appended.evidenceId,
					seq: appended.seq,
					kind: 'command-output',
					uri: artifact.uri,
					sha256: artifact.sha256,
					note: typeof step.input.command === 'string' ? step.input.command : '',
					derivedFrom: step.evidenceId,
				},
			});
			if (!result.ok) {
				await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'fail', payload: { workflowId: fragment.id, toolSeq: step.seq } });
				await this.recordHistory(fragment, taskId, newEvidenceIds);
				return this.outcome(fragment.id, taskId, 'failed', newEvidenceIds, 'tool-failed');
			}
		}

		await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'report', payload: { workflowId: fragment.id, tools: fragment.tools.length } });

		// --- verification (replay = verification by re-deriving, DL-20 posture) ---
		const verdict = await this.ledger.verify();
		if (verdict.ok) {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'tool', type: 'verify-pass', payload: { rows: verdict.rows, workflowId: fragment.id } });
		} else {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'verify-fail', payload: { rows: verdict.rows, firstBadSeq: verdict.firstBadSeq ?? null, workflowId: fragment.id } });
			await this.recordHistory(fragment, taskId, newEvidenceIds);
			return this.outcome(fragment.id, taskId, 'execute', newEvidenceIds, 'verify-fail');
		}

		// --- human gate 2: sign-off ---
		if (mode === 'ask') {
			const decision = await ask('sign-off', fragment);
			if (decision === 'skip') {
				await this.recordHistory(fragment, taskId, newEvidenceIds);
				return this.outcome(fragment.id, taskId, 'awaiting-signoff', newEvidenceIds, 'awaiting-signoff');
			}
			if (decision !== 'sign-off') {
				throw new Error(`flauz.workflow.run: ask port returned an invalid sign-off decision '${String(decision)}'`);
			}
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'sign-off', payload: { gate: 'sign-off', asked: true } });
		} else {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'sign-off', payload: { gate: 'sign-off', replayed: true, workflowId: fragment.id } });
		}

		await this.recordHistory(fragment, taskId, newEvidenceIds);
		return this.outcome(fragment.id, taskId, 'done', newEvidenceIds, 'completed');
	}

	private outcome(workflowId: string, taskId: string, status: string, evidenceIds: readonly string[], stopped: WorkflowRunOutcome['stopped']): WorkflowRunOutcome {
		return { workflowId, taskId, status, evidenceIds, ledger: { ok: true, rows: 0 }, stopped };
	}

	private async recordHistory(fragment: WorkflowFragment, taskId: string, evidenceIds: readonly string[]): Promise<void> {
		const verdict = await this.ledger.verify();
		const updated: WorkflowFragment = {
			...fragment,
			updatedAt: this.clock(),
			history: [...fragment.history, { taskId, ts: this.clock(), derivedFrom: { taskId: fragment.source.taskId, evidenceIds: [...evidenceIds] } }],
		};
		await this.write(updated);
		void verdict;
	}

	private async writeArtifact(taskId: string, seq: number, output: string): Promise<{ uri: string; sha256: string }> {
		const relative = `.flauz/artifacts/${taskId}/command-output-${String(seq)}.txt`;
		await this.fs.mkdir(joinPath(this.root, `.flauz/artifacts/${taskId}`));
		await this.fs.writeFile(joinPath(this.root, relative), output);
		return { uri: relative, sha256: sha256Hex(output) };
	}
}

/** Read a task's evidence events back as a task envelope projection (test/fixture helper). */
export function evidenceEventsOf(task: Task): TaskEvent[] {
	return task.events.filter(event => event.type === 'evidence');
}

/** Convenience re-export so command wiring can read the whole task envelope. */
export type { Task, TaskEnvelope, TaskEvent };
