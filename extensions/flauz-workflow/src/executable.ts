/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Executable reusable workflows (TL2-005, Worker C - M3).
 *
 * Promotes the workflow envelope (save/re-run fragments) into EXECUTABLE
 * reusable workflows:
 *
 *   - VALIDATION: schema (strict unknown-keys-rejected) + SEMANTIC (tool
 *     refs exist in the ToolRegistryPort, input templates reference only
 *     declared params, steps contiguous from 1);
 *   - VERSIONING: flauz.workflows.exec/v1 evolves via explicit version bumps
 *     + migration stubs - NEVER in-place reinterpretation (a spec whose
 *     envelopeVersion exceeds the supported one is a typed error; lower ones
 *     must route through the declared migrations);
 *   - TYPED INPUTS: a workflow takes typed parameters (string/number/
 *     boolean/json) resolved into step input templates at run time;
 *   - RECOVERY: a run interrupted at ANY step recovers to a coherent state.
 *     The run envelope (`.flauz/workflow-runs/<WR-NNN>.json`) IS the durable
 *     graph projection - every step row is a GraphRowRef (the Worker A
 *     durable-graph seam shape; the TL reconciles the shared type). Step
 *     rows persist 'running' BEFORE execution and 'done'/'failed' AFTER, so
 *     a crash between leaves exactly the step to re-run. Recovery is
 *     at-least-once per interrupted step (the ledger is append-only;
 *     interrupted-attempt evidence rows remain as history - documented).
 *   - RE-RUN LINKAGE: run envelopes carry derivedFrom (the house pattern).
 *
 * Node-free core: IO through the flauz-workspace FileSystemPort/Clock ports.
 */

import {
	type Clock,
	type FileSystemPort,
	type Task,
	deepSorted,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';
import type { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { hasKey, type EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { type WorkflowFragment, type WorkflowModel, type WorkflowService, isWorkflowId } from './envelope.ts';

/** Schema of the executable workflow spec envelope. */
export const EXEC_SCHEMA = 'flauz.workflows.exec/v1';

/** Schema of the durable run envelope. */
export const RUN_SCHEMA = 'flauz.workflow.runs/v1';

/** Directory (relative to the workspace root) holding executable specs. */
export const EXEC_SPECS_DIR = '.flauz/workflow-exec';

/** Directory (relative to the workspace root) holding durable run envelopes. */
export const RUNS_DIR = '.flauz/workflow-runs';

/** The CURRENT envelope version this code understands. */
export const SUPPORTED_ENVELOPE_VERSION = 1;

const SPEC_ID_PATTERN = /^WS-\d{3,}$/;
const RUN_ID_PATTERN = /^WR-\d{3,}$/;
const PARAM_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]{0,31}$/;

export const PARAM_TYPES = ['string', 'number', 'boolean', 'json'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

export const STEP_APPROVAL_MODES = ['recorded', 'ask'] as const;
export type StepApprovalMode = (typeof STEP_APPROVAL_MODES)[number];

export const STEP_ON_FAIL = ['abort', 'continue'] as const;
export type StepOnFail = (typeof STEP_ON_FAIL)[number];

export interface WorkflowParam {
	readonly name: string;
	readonly type: ParamType;
	readonly required: boolean;
	readonly description: string;
	readonly defaultValue?: unknown;
}

export interface WorkflowSpecStep {
	readonly seq: number;
	readonly toolId: string;
	readonly name: string | null;
	/** Input template: values may embed {$param: 'name'} refs (resolved recursively at run time). */
	readonly inputTemplate: Record<string, unknown>;
	readonly approval: StepApprovalMode;
	readonly onFail: StepOnFail;
}

export interface SpecMigration {
	readonly fromVersion: number;
	readonly toVersion: number;
	readonly note: string;
}

export interface WorkflowSpec {
	readonly $schema: string;
	readonly id: string;
	readonly title: string;
	/** The W-NNN fragment this spec was distilled from (null for authored specs). */
	readonly sourceFragmentId: string | null;
	/** The ENVELOPE schema version (migration target; explicit bumps only). */
	readonly envelopeVersion: number;
	/** The SPEC version - explicit bumps only, never in-place reinterpretation. */
	readonly version: number;
	readonly inputs: readonly WorkflowParam[];
	readonly steps: readonly WorkflowSpecStep[];
	readonly migrations: readonly SpecMigration[];
	readonly model: WorkflowModel;
	readonly timing: { readonly created: number; readonly updatedAt: number };
}

// ---------------------------------------------------------------------------
// The durable-graph seam (Worker A consumption - the TL reconciles the shape)
// ---------------------------------------------------------------------------

/** One row of the durable execution graph, as both Worker A's graph and the run envelope speak it. */
export interface GraphRowRef {
	readonly rowKind: 'workflow-step';
	readonly runId: string;
	readonly seq: number;
	readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
	readonly updatedAt: number;
}

/** The run envelope AS graph rows (the shared-state projection for A2A + the durable graph). */
export function graphRowsOf(run: WorkflowRun): GraphRowRef[] {
	return run.steps.map(step => ({ rowKind: 'workflow-step', runId: run.runId, seq: step.seq, status: step.status, updatedAt: step.updatedAt }));
}

// ---------------------------------------------------------------------------
// The durable run envelope
// ---------------------------------------------------------------------------

export const RUN_STATUSES = ['running', 'completed', 'failed', 'cancelled', 'interrupted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STEP_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

export interface RunStepRow {
	readonly seq: number;
	readonly status: RunStepStatus;
	readonly updatedAt: number;
	readonly evidenceId: string | null;
	readonly attempt: number;
}

export interface WorkflowRun {
	readonly $schema: string;
	readonly runId: string;
	readonly specId: string;
	readonly specVersion: number;
	readonly taskId: string;
	readonly inputs: Record<string, unknown>;
	readonly status: RunStatus;
	readonly steps: readonly RunStepRow[];
	readonly derivedFrom: { readonly taskId: string; readonly evidenceIds: readonly string[] };
	readonly startedAt: number;
	readonly updatedAt: number;
	readonly recoveryCount: number;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	if (actual.length < required.length || actual.length > required.length + optional.length) {
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

export function isSpecId(value: unknown): value is string {
	return typeof value === 'string' && SPEC_ID_PATTERN.test(value);
}

export function isRunId(value: unknown): value is string {
	return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}

function validateParam(value: unknown, label: string): WorkflowParam {
	if (!isPlainObject(value) || !hasKeys(value, ['name', 'type', 'required', 'description'], ['defaultValue'])) {
		throw new Error(`${label}: param must have exactly the keys [defaultValue?, description, name, required, type]`);
	}
	const name = value.name;
	if (typeof name !== 'string' || !PARAM_NAME_PATTERN.test(name)) {
		throw new Error(`${label}: param name must match /^[a-z][a-zA-Z0-9_]{0,31}$/ (got ${JSON.stringify(name)})`);
	}
	const type = value.type;
	if (typeof type !== 'string' || !(PARAM_TYPES as readonly string[]).includes(type)) {
		throw new Error(`${label}: param type must be one of ${PARAM_TYPES.join('|')} (got ${JSON.stringify(type)})`);
	}
	const required = value.required;
	if (typeof required !== 'boolean') {
		throw new Error(`${label}: param required must be a boolean`);
	}
	const description = value.description;
	if (!isNonEmptyString(description)) {
		throw new Error(`${label}: param description must be a non-empty string`);
	}
	return value.defaultValue === undefined
		? { name, type: type as ParamType, required, description }
		: { name, type: type as ParamType, required, description, defaultValue: value.defaultValue };
}

function collectParamRefs(value: unknown, out: string[]): void {
	if (isPlainObject(value)) {
		if (Object.keys(value).length === 1 && hasKey(value, '$param') && typeof value.$param === 'string') {
			out.push(value.$param);
			return;
		}
		for (const key of Object.keys(value)) {
			collectParamRefs(value[key], out);
		}
	} else if (Array.isArray(value)) {
		for (const item of value) {
			collectParamRefs(item, out);
		}
	}
}

function validateStep(value: unknown, label: string): WorkflowSpecStep {
	if (!isPlainObject(value) || !hasKeys(value, ['seq', 'toolId', 'name', 'inputTemplate', 'approval', 'onFail'])) {
		throw new Error(`${label}: step must have exactly the keys [approval, inputTemplate, name, onFail, seq, toolId]`);
	}
	const seq = value.seq;
	if (!isPositiveInteger(seq)) {
		throw new Error(`${label}: seq must be a positive integer`);
	}
	const toolId = value.toolId;
	if (!isNonEmptyString(toolId)) {
		throw new Error(`${label}: toolId must be a non-empty string`);
	}
	const name = value.name;
	if (name !== null && typeof name !== 'string') {
		throw new Error(`${label}: name must be a string or null`);
	}
	const inputTemplate = value.inputTemplate;
	if (!isPlainObject(inputTemplate)) {
		throw new Error(`${label}: inputTemplate must be a plain object`);
	}
	const approval = value.approval;
	if (typeof approval !== 'string' || !(STEP_APPROVAL_MODES as readonly string[]).includes(approval)) {
		throw new Error(`${label}: approval must be 'recorded' or 'ask' (got ${JSON.stringify(approval)})`);
	}
	const onFail = value.onFail;
	if (typeof onFail !== 'string' || !(STEP_ON_FAIL as readonly string[]).includes(onFail)) {
		throw new Error(`${label}: onFail must be 'abort' or 'continue' (got ${JSON.stringify(onFail)})`);
	}
	return { seq, toolId, name, inputTemplate, approval: approval as StepApprovalMode, onFail: onFail as StepOnFail };
}

/** Schema validation of a spec (throws with the offending rule). */
export function validateWorkflowSpec(value: unknown): WorkflowSpec {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'id', 'title', 'sourceFragmentId', 'envelopeVersion', 'version', 'inputs', 'steps', 'migrations', 'model', 'timing'])) {
		throw new Error('flauz.workflows.exec/v1: spec validation failed: expected exactly the keys [$schema, envelopeVersion, id, inputs, migrations, model, sourceFragmentId, steps, timing, title, version]');
	}
	if (value.$schema !== EXEC_SCHEMA) {
		throw new Error(`flauz.workflows.exec/v1: spec validation failed: $schema must be '${EXEC_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (!isSpecId(value.id)) {
		throw new Error(`flauz.workflows.exec/v1: spec id must match /^WS-\\d{3,}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (!isNonEmptyString(value.title)) {
		throw new Error('flauz.workflows.exec/v1: spec validation failed: title must be a non-empty string');
	}
	if (value.sourceFragmentId !== null && !isWorkflowId(value.sourceFragmentId)) {
		throw new Error(`flauz.workflows.exec/v1: sourceFragmentId must match /^W-\\d{3,}$/ or be null (got ${JSON.stringify(value.sourceFragmentId)})`);
	}
	if (!isPositiveInteger(value.envelopeVersion)) {
		throw new Error('flauz.workflows.exec/v1: envelopeVersion must be a positive integer');
	}
	if (value.envelopeVersion > SUPPORTED_ENVELOPE_VERSION) {
		throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} carries envelopeVersion ${String(value.envelopeVersion)} but this code supports ${String(SUPPORTED_ENVELOPE_VERSION)} - an explicit version bump + migration is required (never in-place reinterpretation)`);
	}
	if (!isPositiveInteger(value.version)) {
		throw new Error('flauz.workflows.exec/v1: version must be a positive integer (explicit bumps only)');
	}
	if (!Array.isArray(value.inputs)) {
		throw new Error('flauz.workflows.exec/v1: inputs must be an array of typed params');
	}
	const inputs = value.inputs.map((param, index) => validateParam(param, `flauz.workflows.exec/v1: spec ${String(value.id)} input #${String(index)}`));
	const names = new Set<string>();
	for (const param of inputs) {
		if (names.has(param.name)) {
			throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} declares param '${param.name}' twice`);
		}
		names.add(param.name);
	}
	if (!Array.isArray(value.steps)) {
		throw new Error('flauz.workflows.exec/v1: steps must be an array');
	}
	const steps = value.steps.map((step, index) => validateStep(step, `flauz.workflows.exec/v1: spec ${String(value.id)} step #${String(index)}`));
	let expectedSeq = 1;
	for (const step of steps) {
		if (step.seq !== expectedSeq) {
			throw new Error(`flauz.workflows.exec/v1: spec validation failed: step seq must be contiguous from 1 (step ${String(step.seq)} after ${String(expectedSeq - 1)})`);
		}
		expectedSeq += 1;
	}
	if (!Array.isArray(value.migrations)) {
		throw new Error('flauz.workflows.exec/v1: migrations must be an array of stubs {fromVersion, toVersion, note}');
	}
	const migrations = value.migrations.map((migration, index) => {
		if (!isPlainObject(migration) || !hasKeys(migration, ['fromVersion', 'toVersion', 'note'])) {
			throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} migration #${String(index)} must have exactly the keys [fromVersion, note, toVersion]`);
		}
		if (!isPositiveInteger(migration.fromVersion) || !isPositiveInteger(migration.toVersion)) {
			throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} migration #${String(index)} fromVersion/toVersion must be positive integers`);
		}
		if (migration.toVersion !== migration.fromVersion + 1) {
			throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} migration #${String(index)} must bump exactly one version (fromVersion ${String(migration.fromVersion)} -> toVersion ${String(migration.toVersion)})`);
		}
		if (!isNonEmptyString(migration.note)) {
			throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} migration #${String(index)} note must be a non-empty string`);
		}
		return { fromVersion: migration.fromVersion, toVersion: migration.toVersion, note: migration.note };
	});
	const model = value.model;
	if (!isPlainObject(model) || !hasKeys(model, ['provider', 'model'], ['params'])) {
		throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} model must have exactly the keys [model, params?, provider]`);
	}
	if (!isPlainObject(value.timing) || !hasKeys(value.timing, ['created', 'updatedAt'])) {
		throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} timing must have exactly the keys [created, updatedAt]`);
	}
	if (!isPositiveInteger(value.timing.created) || !isPositiveInteger(value.timing.updatedAt)) {
		throw new Error(`flauz.workflows.exec/v1: spec ${String(value.id)} timing.created/updatedAt must be positive integers`);
	}
	return {
		$schema: EXEC_SCHEMA,
		id: value.id,
		title: value.title,
		sourceFragmentId: value.sourceFragmentId,
		envelopeVersion: value.envelopeVersion,
		version: value.version,
		inputs,
		steps,
		migrations,
		model: model as unknown as WorkflowModel,
		timing: { created: value.timing.created, updatedAt: value.timing.updatedAt },
	};
}

/** The registry port answering "which tool ids exist" (semantic validation). */
export interface ToolRegistryPort {
	toolIds(): readonly string[];
}

/** Semantic validation: tool refs exist, template refs resolve to declared params, plan well-formed. */
export function validateSemantics(spec: WorkflowSpec, registry: ToolRegistryPort): void {
	const known = new Set(registry.toolIds());
	for (const step of spec.steps) {
		if (!known.has(step.toolId)) {
			throw new Error(`flauz.workflows.exec/v1: spec ${spec.id} step ${String(step.seq)} references unknown tool '${step.toolId}' (registry: ${[...known].sort().join(', ') || '(empty)'})`);
		}
		const refs: string[] = [];
		collectParamRefs(step.inputTemplate, refs);
		for (const ref of refs) {
			if (!spec.inputs.some(param => param.name === ref)) {
				throw new Error(`flauz.workflows.exec/v1: spec ${spec.id} step ${String(step.seq)} inputTemplate references undeclared param '${ref}'`);
			}
		}
	}
	if (spec.steps.length === 0) {
		throw new Error(`flauz.workflows.exec/v1: spec ${spec.id} has no steps (a workflow must do something)`);
	}
}

// ---------------------------------------------------------------------------
// Input resolution
// ---------------------------------------------------------------------------

/** Validates run inputs against the spec params (type + required; defaults fill). */
export function resolveInputs(spec: WorkflowSpec, provided: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const param of spec.inputs) {
		const has = Object.prototype.hasOwnProperty.call(provided, param.name);
		if (!has) {
			if (param.defaultValue !== undefined) {
				out[param.name] = param.defaultValue;
				continue;
			}
			if (param.required) {
				throw new Error(`flauz.workflow.exec: run of ${spec.id} missing required input '${param.name}' (${param.type}): ${param.description}`);
			}
			continue;
		}
		const value = provided[param.name];
		if (!valueMatchesType(value, param.type)) {
			throw new Error(`flauz.workflow.exec: run of ${spec.id} input '${param.name}' must be of type ${param.type} (got ${JSON.stringify(value)})`);
		}
		out[param.name] = value;
	}
	for (const key of Object.keys(provided)) {
		if (!spec.inputs.some(param => param.name === key)) {
			throw new Error(`flauz.workflow.exec: run of ${spec.id} received undeclared input '${key}' (specs take exactly their declared params)`);
		}
	}
	return out;
}

function valueMatchesType(value: unknown, type: ParamType): boolean {
	if (type === 'string') {
		return typeof value === 'string';
	}
	if (type === 'number') {
		return typeof value === 'number' && Number.isFinite(value);
	}
	if (type === 'boolean') {
		return typeof value === 'boolean';
	}
	return value !== undefined && (value === null || ['string', 'number', 'boolean', 'object'].includes(typeof value));
}

/** Resolves {$param: name} refs in a template against the resolved inputs (recursive). */
export function resolveTemplate(template: unknown, inputs: Record<string, unknown>): unknown {
	if (isPlainObject(template)) {
		if (Object.keys(template).length === 1 && hasKey(template, '$param') && typeof template.$param === 'string') {
			if (!Object.prototype.hasOwnProperty.call(inputs, template.$param)) {
				throw new Error(`flauz.workflow.exec: template references param '${template.$param}' which resolved to no value`);
			}
			return inputs[template.$param];
		}
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(template)) {
			out[key] = resolveTemplate(template[key], inputs);
		}
		return out;
	}
	if (Array.isArray(template)) {
		return template.map(item => resolveTemplate(item, inputs));
	}
	return template;
}

// ---------------------------------------------------------------------------
// The run service
// ---------------------------------------------------------------------------

export type ExecToolPort = (step: { seq: number; toolId: string; input: Record<string, unknown> }) => Promise<{ ok: boolean; output: string }>;

export interface RunOptions {
	readonly executor: ExecToolPort;
	/** Replay-approvals-or-ask at the human gates (default replay of recorded approvals). */
	readonly approvalMode?: 'replay' | 'ask';
	/** Required when approvalMode is 'ask'. */
	readonly ask?: (gate: 'approval' | 'sign-off' | 'tool', spec: WorkflowSpec, stepSeq?: number) => Promise<'approve' | 'cancel'>;
	/**
	 * Run under an EXISTING task instead of a fresh one - the A2A shared-task
	 * state case (the worker executes the delegated work on the task both
	 * agents see). The task must exist and be in a state the machine can
	 * drive (appendEvent gates the transitions).
	 */
	readonly taskId?: string;
}

export interface RunOutcome {
	readonly runId: string;
	readonly taskId: string;
	readonly status: RunStatus;
	readonly evidenceIds: readonly string[];
	readonly completedSteps: number;
	readonly recoveryCount: number;
}

export interface ExecServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly clock?: Clock;
	/** Fragment loader (derivedFrom linking of distilled specs; optional). */
	readonly fragments?: WorkflowService;
}

export class WorkflowRunService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly tasks: TaskService;
	private readonly ledger: EvidenceLedger;
	private readonly clock: Clock;
	private readonly fragments: WorkflowService | undefined;

	constructor(options: ExecServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.tasks = options.tasks;
		this.ledger = options.ledger;
		this.clock = options.clock ?? (() => Date.now());
		this.fragments = options.fragments;
	}

	private specPath(id: string): string {
		return joinPath(this.root, EXEC_SPECS_DIR, `${id}.json`);
	}

	private runPath(runId: string): string {
		return joinPath(this.root, RUNS_DIR, `${runId}.json`);
	}

	// -- spec lifecycle ------------------------------------------------------

	/** Distills an existing fragment (W-NNN) into an executable spec (typed inputs v0: none). */
	async distillSpec(fragment: WorkflowFragment, options: { toolRegistry?: ToolRegistryPort } = {}): Promise<WorkflowSpec> {
		const now = this.clock();
		const existing = await this.listSpecs();
		let max = 0;
		for (const spec of existing) {
			const match = /^WS-(\d+)$/.exec(spec.id);
			if (match) {
				max = Math.max(max, Number.parseInt(match[1] ?? '0', 10));
			}
		}
		const spec: WorkflowSpec = {
			$schema: EXEC_SCHEMA,
			id: `WS-${String(max + 1).padStart(3, '0')}`,
			title: fragment.title,
			sourceFragmentId: fragment.id,
			envelopeVersion: SUPPORTED_ENVELOPE_VERSION,
			version: 1,
			inputs: [],
			steps: fragment.tools.map(tool => ({
				seq: tool.seq,
				toolId: tool.toolId,
				name: tool.name,
				inputTemplate: cloneRecord(tool.input),
				approval: tool.approval,
				onFail: 'abort' as const,
			})),
			migrations: [],
			model: fragment.model,
			timing: { created: now, updatedAt: now },
		};
		validateWorkflowSpec(spec);
		if (options.toolRegistry !== undefined) {
			validateSemantics(spec, options.toolRegistry);
		}
		await this.writeSpec(spec);
		return spec;
	}

	/** Persists an authored/validated spec (explicit version discipline is the caller's). */
	async saveSpec(spec: WorkflowSpec): Promise<void> {
		validateWorkflowSpec(spec);
		await this.writeSpec(spec);
	}

	/**
	 * Explicit version bump: version+1 with a declared migration stub. Never
	 * an in-place reinterpretation - the old spec stays on disk as history?
	 * No: v0 persists the bumped spec in place AT the new version, with the
	 * migration stub RECORDED in migrations[] (the audit trail).
	 */
	async bumpSpec(id: string, note: string): Promise<WorkflowSpec> {
		const spec = await this.loadSpec(id);
		const now = this.clock();
		const bumped: WorkflowSpec = {
			...spec,
			version: spec.version + 1,
			migrations: [...spec.migrations, { fromVersion: spec.version, toVersion: spec.version + 1, note }],
			timing: { ...spec.timing, updatedAt: now },
		};
		await this.writeSpec(bumped);
		return bumped;
	}

	async loadSpec(id: string): Promise<WorkflowSpec> {
		if (!isSpecId(id)) {
			throw new Error(`flauz.workflows.exec: unknown spec id '${id}' (must match /^WS-\\d{3,}$/)`);
		}
		const raw = await this.fs.readFileUtf8(this.specPath(id));
		if (raw === undefined) {
			throw new Error(`flauz.workflows.exec: spec '${id}' not found at ${joinPath(EXEC_SPECS_DIR, `${id}.json`)}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.workflows.exec: spec '${id}' is not valid JSON: ${(err as Error).message}`);
		}
		return validateWorkflowSpec(parsed);
	}

	async listSpecs(): Promise<WorkflowSpec[]> {
		const indexRaw = await this.fs.readFileUtf8(joinPath(this.root, EXEC_SPECS_DIR, 'index.json'));
		const ids: string[] = [];
		if (indexRaw !== undefined) {
			const parsed = JSON.parse(indexRaw) as { specs?: unknown };
			if (Array.isArray(parsed.specs)) {
				for (const id of parsed.specs) {
					if (isSpecId(id)) {
						ids.push(id);
					}
				}
			}
		}
		const specs: WorkflowSpec[] = [];
		for (const id of ids) {
			const raw = await this.fs.readFileUtf8(this.specPath(id));
			if (raw !== undefined) {
				specs.push(validateWorkflowSpec(JSON.parse(raw)));
			}
		}
		return specs;
	}

	private async writeSpec(spec: WorkflowSpec): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, EXEC_SPECS_DIR));
		const target = this.specPath(spec.id);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(deepSortedSpec(spec), null, 2)}\n`);
		await this.fs.rename(tmp, target);
		const indexRaw = await this.fs.readFileUtf8(joinPath(this.root, EXEC_SPECS_DIR, 'index.json'));
		const ids = new Set<string>();
		if (indexRaw !== undefined) {
			const parsed = JSON.parse(indexRaw) as { specs?: unknown };
			if (Array.isArray(parsed.specs)) {
				for (const id of parsed.specs) {
					if (isSpecId(id)) {
						ids.add(id);
					}
				}
			}
		}
		ids.add(spec.id);
		const index = { $schema: EXEC_SCHEMA, specs: [...ids].sort() };
		const indexTarget = joinPath(this.root, EXEC_SPECS_DIR, 'index.json');
		await this.fs.writeFile(`${indexTarget}.tmp`, `${JSON.stringify(index, null, 2)}\n`);
		await this.fs.rename(`${indexTarget}.tmp`, indexTarget);
	}

	// -- run lifecycle -------------------------------------------------------

	/** Starts a run of a spec with typed inputs; persists the envelope before/after every step. */
	async run(specId: string, inputs: Record<string, unknown>, options: RunOptions): Promise<RunOutcome> {
		const spec = await this.loadSpec(specId);
		const resolved = resolveInputs(spec, inputs);
		return this.execute(spec, resolved, options, undefined);
	}

	/**
	 * Recovers an interrupted run to a coherent state: done/failed/skipped
	 * steps are never re-executed; a 'running' step (crash mid-execution) is
	 * re-run (at-least-once); pending steps execute normally. Idempotent -
	 * recovering a completed run is a no-op.
	 */
	async recover(runId: string, options: RunOptions): Promise<RunOutcome> {
		if (!isRunId(runId)) {
			throw new Error(`flauz.workflow.runs: unknown run id '${runId}' (must match /^WR-\\d{3,}$/)`);
		}
		const run = await this.loadRun(runId);
		if (run.status !== 'running') {
			return { runId: run.runId, taskId: run.taskId, status: run.status, evidenceIds: evidenceIdsOf(run), completedSteps: run.steps.filter(step => step.status === 'done').length, recoveryCount: run.recoveryCount };
		}
		const spec = await this.loadSpec(run.specId);
		if (run.specVersion !== spec.version) {
			throw new Error(`flauz.workflow.runs: run ${runId} started against ${run.specId} v${String(run.specVersion)} but the spec is now v${String(spec.version)} - recovery is pinned to the version it started with (re-run for the new version; never in-place reinterpretation)`);
		}
		const bumped: WorkflowRun = { ...run, recoveryCount: run.recoveryCount + 1, updatedAt: this.clock() };
		await this.tasks.appendEvent(run.taskId, { ts: this.clock(), actor: 'tool', type: 'workflow-recovered', payload: { runId, specId: run.specId, fromStatus: run.status, recoveryCount: bumped.recoveryCount } });
		return this.execute(spec, run.inputs, options, bumped);
	}

	private async execute(spec: WorkflowSpec, inputs: Record<string, unknown>, options: RunOptions, existing: WorkflowRun | undefined): Promise<RunOutcome> {
		const mode = options.approvalMode ?? 'replay';
		if (mode === 'ask' && options.ask === undefined) {
			throw new Error("flauz.workflow.exec: approvalMode 'ask' requires an ask port");
		}
		const ask = options.ask ?? (async () => 'approve' as const);
		const isRecovery = existing !== undefined;
		let run: WorkflowRun;
		let taskId: string;
		if (isRecovery) {
			run = existing;
			taskId = run.taskId;
		} else {
			if (options.taskId !== undefined) {
				// The shared-task case: run under the delegated task (both
				// agents see these graph rows through sharedState()).
				taskId = options.taskId;
				await this.tasks.getTask(taskId);
			} else {
				taskId = (await this.tasks.createTask(spec.title)).id;
			}
			const runId = await this.allocateRunId();
			// derivedFrom (the house pattern): a distilled run links to its
			// source fragment's task + evidence rows; an authored run links
			// to itself (nothing to derive from).
			let derivedFrom: WorkflowRun['derivedFrom'] = { taskId, evidenceIds: [] };
			if (spec.sourceFragmentId !== null && this.fragments !== undefined) {
				try {
					const fragment = await this.fragments.load(spec.sourceFragmentId);
					derivedFrom = { taskId: fragment.source.taskId, evidenceIds: [...fragment.source.evidenceIds] };
				} catch {
					// Fragment unreadable: keep the self-link (never fabricate).
				}
			}
			run = {
				$schema: RUN_SCHEMA,
				runId,
				specId: spec.id,
				specVersion: spec.version,
				taskId,
				inputs,
				status: 'running',
				steps: spec.steps.map(step => ({ seq: step.seq, status: 'pending', updatedAt: this.clock(), evidenceId: null, attempt: 0 })),
				derivedFrom,
				startedAt: this.clock(),
				updatedAt: this.clock(),
				recoveryCount: 0,
			};
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'workflow-start', payload: { workflowId: spec.id, runId: run.runId, executable: true } });
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'submit-plan', payload: { plan: `## ${spec.title}\n\nExecutable workflow ${spec.id} v${String(spec.version)} (${String(spec.steps.length)} steps).`, requestId: `flauz-exec-${spec.id}-${run.runId}` } });
			if (mode === 'ask') {
				const decision = await ask('approval', spec);
				if (decision === 'cancel') {
					await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'cancel', payload: { gate: 'approval' } });
					const cancelled: WorkflowRun = { ...run, status: 'cancelled', updatedAt: this.clock() };
					await this.persistRun(cancelled);
					return this.outcomeOf(cancelled);
				}
			}
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'approve', payload: { gate: 'approval', replayed: mode === 'replay', workflowId: spec.id } });
			await this.persistRun(run);
		}

		for (const step of spec.steps) {
			const row = run.steps.find(candidate => candidate.seq === step.seq);
			if (row === undefined) {
				throw new Error(`flauz.workflow.runs: run ${run.runId} is missing step row ${String(step.seq)} (corrupt envelope)`);
			}
			if (row.status === 'done' || row.status === 'failed' || row.status === 'skipped') {
				continue;
			}
			if (step.approval === 'ask') {
				const decision = await ask('tool', spec, step.seq);
				if (decision === 'cancel') {
					await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'cancel', payload: { gate: 'tool', toolSeq: step.seq } });
					const cancelled: WorkflowRun = { ...run, status: 'cancelled', updatedAt: this.clock(), steps: run.steps.map(candidate => candidate.seq === step.seq ? { ...candidate, status: 'skipped' as const } : candidate) };
					await this.persistRun(cancelled);
					return this.outcomeOf(cancelled);
				}
			}
			// Persist 'running' BEFORE execution (crash-safe: the row is the
			// recovery point).
			run = { ...run, steps: run.steps.map(candidate => candidate.seq === step.seq ? { ...candidate, status: 'running' as const, attempt: candidate.attempt + 1, updatedAt: this.clock() } : candidate) };
			await this.persistRun(run);
			const input = resolveTemplate(step.inputTemplate, inputs) as Record<string, unknown>;
			if (!isPlainObject(input)) {
				throw new Error(`flauz.workflow.exec: step ${String(step.seq)} resolved input is not an object`);
			}
			const result = await options.executor({ seq: step.seq, toolId: step.toolId, input });
			const artifact = await this.writeArtifact(taskId, step.seq, result.output);
			const appended = await this.ledger.append(taskId, {
				kind: 'command-output',
				uri: artifact.uri,
				sha256: artifact.sha256,
				note: typeof input.command === 'string' ? input.command : '',
			});
			await this.tasks.appendEvent(taskId, {
				ts: this.clock(),
				actor: 'tool',
				type: 'evidence',
				payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifact.uri, sha256: artifact.sha256, runId: run.runId, stepSeq: step.seq },
			});
			if (!result.ok) {
				if (step.onFail === 'continue') {
					run = { ...run, steps: run.steps.map(candidate => candidate.seq === step.seq ? { ...candidate, status: 'skipped' as const, evidenceId: appended.evidenceId, updatedAt: this.clock() } : candidate) };
					await this.persistRun(run);
					continue;
				}
				await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'fail', payload: { workflowId: spec.id, runId: run.runId, toolSeq: step.seq } });
				run = { ...run, status: 'failed', steps: run.steps.map(candidate => candidate.seq === step.seq ? { ...candidate, status: 'failed' as const, evidenceId: appended.evidenceId, updatedAt: this.clock() } : candidate), updatedAt: this.clock() };
				await this.persistRun(run);
				return this.outcomeOf(run);
			}
			run = { ...run, steps: run.steps.map(candidate => candidate.seq === step.seq ? { ...candidate, status: 'done' as const, evidenceId: appended.evidenceId, updatedAt: this.clock() } : candidate) };
			await this.persistRun(run);
		}

		await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'report', payload: { workflowId: spec.id, runId: run.runId, steps: spec.steps.length } });
		const verdict = await this.ledger.verify();
		if (verdict.ok) {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'tool', type: 'verify-pass', payload: { rows: verdict.rows, workflowId: spec.id, runId: run.runId } });
		} else {
			await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'agent', type: 'verify-fail', payload: { rows: verdict.rows, firstBadSeq: verdict.firstBadSeq ?? null, workflowId: spec.id, runId: run.runId } });
		}
		if (mode === 'ask') {
			const decision = await ask('sign-off', spec);
			if (decision === 'cancel') {
				await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'cancel', payload: { gate: 'sign-off' } });
				const cancelled: WorkflowRun = { ...run, status: 'cancelled', updatedAt: this.clock() };
				await this.persistRun(cancelled);
				return this.outcomeOf(cancelled);
			}
		}
		await this.tasks.appendEvent(taskId, { ts: this.clock(), actor: 'human', type: 'sign-off', payload: { gate: 'sign-off', replayed: mode === 'replay', workflowId: spec.id } });
		run = { ...run, status: 'completed', updatedAt: this.clock() };
		await this.persistRun(run);
		return this.outcomeOf(run);
	}

	private outcomeOf(run: WorkflowRun): RunOutcome {
		return {
			runId: run.runId,
			taskId: run.taskId,
			status: run.status,
			evidenceIds: evidenceIdsOf(run),
			completedSteps: run.steps.filter(step => step.status === 'done').length,
			recoveryCount: run.recoveryCount,
		};
	}

	async loadRun(runId: string): Promise<WorkflowRun> {
		if (!isRunId(runId)) {
			throw new Error(`flauz.workflow.runs: unknown run id '${runId}' (must match /^WR-\\d{3,}$/)`);
		}
		const raw = await this.fs.readFileUtf8(this.runPath(runId));
		if (raw === undefined) {
			throw new Error(`flauz.workflow.runs: run '${runId}' not found at ${joinPath(RUNS_DIR, `${runId}.json`)}`);
		}
		return validateWorkflowRun(JSON.parse(raw));
	}

	async listRuns(): Promise<WorkflowRun[]> {
		const indexRaw = await this.fs.readFileUtf8(joinPath(this.root, RUNS_DIR, 'index.json'));
		const ids: string[] = [];
		if (indexRaw !== undefined) {
			const parsed = JSON.parse(indexRaw) as { runs?: unknown };
			if (Array.isArray(parsed.runs)) {
				for (const id of parsed.runs) {
					if (isRunId(id)) {
						ids.push(id);
					}
				}
			}
		}
		const runs: WorkflowRun[] = [];
		for (const id of ids) {
			const raw = await this.fs.readFileUtf8(this.runPath(id));
			if (raw !== undefined) {
				runs.push(validateWorkflowRun(JSON.parse(raw)));
			}
		}
		return runs;
	}

	private async allocateRunId(): Promise<string> {
		const existing = await this.listRuns();
		let max = 0;
		for (const run of existing) {
			const match = /^WR-(\d+)$/.exec(run.runId);
			if (match) {
				max = Math.max(max, Number.parseInt(match[1] ?? '0', 10));
			}
		}
		return `WR-${String(max + 1).padStart(3, '0')}`;
	}

	private async persistRun(run: WorkflowRun): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, RUNS_DIR));
		const target = this.runPath(run.runId);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(deepSortedRun(run), null, 2)}\n`);
		await this.fs.rename(tmp, target);
		const indexTarget = joinPath(this.root, RUNS_DIR, 'index.json');
		const indexRaw = await this.fs.readFileUtf8(indexTarget);
		const ids = new Set<string>();
		if (indexRaw !== undefined) {
			const parsed = JSON.parse(indexRaw) as { runs?: unknown };
			if (Array.isArray(parsed.runs)) {
				for (const id of parsed.runs) {
					if (isRunId(id)) {
						ids.add(id);
					}
				}
			}
		}
		ids.add(run.runId);
		await this.fs.writeFile(`${indexTarget}.tmp`, `${JSON.stringify({ $schema: RUN_SCHEMA, runs: [...ids].sort() }, null, 2)}\n`);
		await this.fs.rename(`${indexTarget}.tmp`, indexTarget);
	}

	private async writeArtifact(taskId: string, seq: number, output: string): Promise<{ uri: string; sha256: string }> {
		const relative = `.flauz/artifacts/${taskId}/exec-step-${String(seq)}.txt`;
		await this.fs.mkdir(joinPath(this.root, `.flauz/artifacts/${taskId}`));
		await this.fs.writeFile(joinPath(this.root, relative), output);
		return { uri: relative, sha256: sha256Hex(output) };
	}
}

function evidenceIdsOf(run: WorkflowRun): string[] {
	return run.steps.map(step => step.evidenceId).filter((id): id is string => id !== null);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function deepSortedSpec(spec: WorkflowSpec): unknown {
	return deepSorted(spec);
}

function deepSortedRun(run: WorkflowRun): unknown {
	return deepSorted(run);
}

/** Strict validation of a durable run envelope. */
export function validateWorkflowRun(value: unknown): WorkflowRun {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'runId', 'specId', 'specVersion', 'taskId', 'inputs', 'status', 'steps', 'derivedFrom', 'startedAt', 'updatedAt', 'recoveryCount'])) {
		throw new Error('flauz.workflow.runs/v1: run validation failed: expected exactly the keys [$schema, derivedFrom, inputs, recoveryCount, runId, specId, specVersion, startedAt, status, steps, taskId, updatedAt]');
	}
	if (value.$schema !== RUN_SCHEMA) {
		throw new Error(`flauz.workflow.runs/v1: run validation failed: $schema must be '${RUN_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	const runId = value.runId;
	if (!isRunId(runId)) {
		throw new Error(`flauz.workflow.runs/v1: runId must match /^WR-\\d{3,}$/ (got ${JSON.stringify(value.runId)})`);
	}
	if (!isSpecId(value.specId)) {
		throw new Error(`flauz.workflow.runs/v1: specId must match /^WS-\\d{3,}$/`);
	}
	if (!isPositiveInteger(value.specVersion)) {
		throw new Error('flauz.workflow.runs/v1: specVersion must be a positive integer');
	}
	if (typeof value.taskId !== 'string' || !/^T-\d{3,}$/.test(value.taskId)) {
		throw new Error(`flauz.workflow.runs/v1: taskId must match /^T-\\d{3,}$/`);
	}
	if (!isPlainObject(value.inputs)) {
		throw new Error('flauz.workflow.runs/v1: inputs must be a plain object');
	}
	const status = value.status;
	if (typeof status !== 'string' || !(RUN_STATUSES as readonly string[]).includes(status)) {
		throw new Error(`flauz.workflow.runs/v1: status must be one of ${RUN_STATUSES.join('|')} (got ${JSON.stringify(value.status)})`);
	}
	if (!Array.isArray(value.steps)) {
		throw new Error('flauz.workflow.runs/v1: steps must be an array of step rows');
	}
	const steps = value.steps.map((step, index) => {
		if (!isPlainObject(step) || !hasKeys(step, ['seq', 'status', 'updatedAt', 'evidenceId', 'attempt'])) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} must have exactly the keys [attempt, evidenceId, seq, status, updatedAt]`);
		}
		const seq = step.seq;
		if (!isPositiveInteger(seq)) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} seq must be a positive integer`);
		}
		const stepStatus = step.status;
		if (typeof stepStatus !== 'string' || !(RUN_STEP_STATUSES as readonly string[]).includes(stepStatus)) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} status must be one of ${RUN_STEP_STATUSES.join('|')}`);
		}
		const updatedAt = step.updatedAt;
		if (!isPositiveInteger(updatedAt)) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} updatedAt must be a positive integer`);
		}
		const evidenceId = step.evidenceId;
		if (step.evidenceId !== null && (typeof step.evidenceId !== 'string' || !/^E-\d{6,}$/.test(step.evidenceId))) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} evidenceId must be E-NNNNNN or null`);
		}
		const attempt = step.attempt;
		if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) {
			throw new Error(`flauz.workflow.runs/v1: step #${String(index)} attempt must be a non-negative integer`);
		}
		return { seq, status: stepStatus as RunStepStatus, updatedAt, evidenceId: evidenceId as string | null, attempt };
	});
	let expectedSeq = 1;
	for (const step of steps) {
		if (step.seq !== expectedSeq) {
			throw new Error(`flauz.workflow.runs/v1: step seq must be contiguous from 1 (got ${String(step.seq)} where ${String(expectedSeq)} was expected)`);
		}
		expectedSeq += 1;
	}
	if (!isPlainObject(value.derivedFrom) || !hasKeys(value.derivedFrom, ['taskId', 'evidenceIds'])) {
		throw new Error('flauz.workflow.runs/v1: derivedFrom must have exactly the keys [evidenceIds, taskId]');
	}
	if (typeof value.derivedFrom.taskId !== 'string' || !/^T-\d{3,}$/.test(value.derivedFrom.taskId)) {
		throw new Error('flauz.workflow.runs/v1: derivedFrom.taskId must match /^T-\\d{3,}$/');
	}
	if (!Array.isArray(value.derivedFrom.evidenceIds) || !value.derivedFrom.evidenceIds.every((id: unknown) => typeof id === 'string' && /^E-\d{6,}$/.test(id as string))) {
		throw new Error('flauz.workflow.runs/v1: derivedFrom.evidenceIds must be an array of E-NNNNNN ids');
	}
	if (!isPositiveInteger(value.startedAt) || !isPositiveInteger(value.updatedAt)) {
		throw new Error('flauz.workflow.runs/v1: startedAt/updatedAt must be positive integers');
	}
	const recoveryCount = value.recoveryCount;
	if (typeof recoveryCount !== 'number' || !Number.isSafeInteger(recoveryCount) || recoveryCount < 0) {
		throw new Error('flauz.workflow.runs/v1: recoveryCount must be a non-negative integer');
	}
	return {
		$schema: RUN_SCHEMA,
		runId,
		specId: value.specId,
		specVersion: value.specVersion,
		taskId: value.taskId,
		inputs: value.inputs,
		status: status as RunStatus,
		steps,
		derivedFrom: { taskId: value.derivedFrom.taskId, evidenceIds: [...value.derivedFrom.evidenceIds] },
		startedAt: value.startedAt,
		updatedAt: value.updatedAt,
		recoveryCount,
	};
}

/** Read a task's exec-run events (test/fixture helper). */
export function execEventsOf(task: Task): { runIds: string[]; recovered: number } {
	const runIds = new Set<string>();
	let recovered = 0;
	for (const event of task.events) {
		if (event.type === 'workflow-start' && typeof event.payload.runId === 'string') {
			runIds.add(event.payload.runId);
		}
		if (event.type === 'workflow-recovered') {
			recovered += 1;
		}
	}
	return { runIds: [...runIds], recovered };
}
