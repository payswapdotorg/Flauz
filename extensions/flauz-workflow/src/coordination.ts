/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Agent-to-agent coordination, real (TL2-006, Worker C - M4).
 *
 * Extends the A2A messaging seam (messaging.ts, flauz.a2a/v0) into actual
 * multi-agent coordination:
 *
 *   - DELEGATION CONTRACTS: goal + typed inputs + constraints + result
 *     schema, persisted at `.flauz/a2a/contracts/` and carried by the
 *     task-delegation message (the contract rides the SAME typed bus);
 *   - SHARED TASK STATE: the task envelope + the durable-graph run rows +
 *     the contract are the graph rows BOTH agents see (`sharedState()`);
 *   - PRIVATE CONTEXT: per-agent memory scoping - an agent's private tier is
 *     NOT readable by peers without an explicit share record. The boundary
 *     itself is enforced in flauz-memory's pure retrieval; this module owns
 *     the share lifecycle through the ContextSharePort (the MemoryStore
 *     satisfies it structurally - no implementation coupling);
 *   - RESULT VERIFICATION: result-report rows link evidence; verification
 *     resolves the ids in the DL-20 ledger AND re-hashes the artifact bytes -
 *     unverified results are labeled 'reported-not-verified', never passed
 *     off as verified;
 *   - STEERING: mid-flight steering-relay semantics with provenance (actor,
 *     ts, message id recorded on the contract; steering after submission is
 *     a typed error - the contract is closed).
 *
 * Transport stays the in-process mediator / A2aPort (the stdio loopback in
 * tests rides the real core service through the same port - TL1's service
 * transport arrives later; this protocol contract is the fixture).
 *
 * Node-free core: IO through the flauz-workspace FileSystemPort/Clock ports.
 */

import {
	type Clock,
	type FileSystemPort,
	type Task,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';
import type { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { hasKey, type EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { type A2aMessage, type A2aPort, type A2aResultReport, isAgentId, messageIdOf } from './messaging.ts';
import type { ParamType } from './executable.ts';

/** Schema of the delegation contract envelope. */
export const CONTRACT_SCHEMA = 'flauz.a2a.contracts/v1';

/** Directory (relative to the workspace root) holding delegation contracts. */
export const CONTRACTS_DIR = '.flauz/a2a/contracts';

export const CONTRACT_STATUSES = ['delegated', 'accepted', 'submitted', 'verified', 'failed', 'cancelled'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** Statuses from which steering is legal (mid-flight: before submission closes the contract). */
export const STEERABLE_STATUSES: readonly ContractStatus[] = ['delegated', 'accepted'];

const CONTRACT_ID_PATTERN = /^C-\d{6,}$/;

export interface ContractField {
	readonly name: string;
	readonly type: ParamType;
	readonly required: boolean;
}

export interface ContractConstraints {
	/** Max workflow steps the worker may take (recorded; enforcement is Worker A's durable-graph lane). */
	readonly maxSteps: number | null;
	/** Deadline epoch ms (recorded; informational for the worker in v0). */
	readonly deadline: number | null;
	/** Allowed tool ids (recorded; the worker validates its spec against these). */
	readonly tools: readonly string[] | null;
}

export interface SteeringRecord {
	readonly messageId: string;
	readonly from: string;
	readonly message: string;
	readonly ts: number;
}

export interface ContractResult {
	readonly outcome: 'ok' | 'failed' | 'cancelled';
	/** Must match the contract's resultSchema fields (validated at submission). */
	readonly values: Record<string, unknown>;
	/** The ledger rows the worker claims prove the result. */
	readonly evidenceIds: readonly string[];
	/** 'verified' only when every evidence row resolved AND its artifact bytes re-hashed equal. */
	readonly verification: 'verified' | 'reported-not-verified';
	readonly summary: string;
	readonly submittedAt: number;
	readonly verifiedAt: number | null;
	/** Why verification failed, when it did (the honest label's reason). */
	readonly verificationNote: string | null;
}

export interface DelegationContract {
	readonly $schema: string;
	readonly id: string;
	readonly parent: string;
	readonly worker: string;
	/** The shared task both agents see (the task envelope IS shared state). */
	readonly taskId: string;
	readonly goal: string;
	readonly inputs: readonly ContractField[];
	/** Resolved input values supplied at delegation time. */
	readonly inputValues: Record<string, unknown>;
	readonly constraints: ContractConstraints;
	readonly resultSchema: { readonly fields: readonly ContractField[] };
	readonly status: ContractStatus;
	/** The task-delegation message that carried this contract (provenance). */
	readonly messageId: string | null;
	readonly steering: readonly SteeringRecord[];
	readonly result: ContractResult | null;
	readonly timing: { readonly created: number; readonly updatedAt: number };
}

// ---------------------------------------------------------------------------
// The context-share port (the private-context boundary lifecycle; the
// flauz-memory MemoryStore satisfies this structurally)
// ---------------------------------------------------------------------------

export interface ContextSharePort {
	share(recordId: string, toAgent: string, options: { reason: string; actor: 'agent' | 'human' | 'tool' }): Promise<unknown>;
	revokeShare(recordId: string, toAgent: string, options: { reason: string; actor: 'agent' | 'human' | 'tool' }): Promise<unknown>;
	shares(): Promise<readonly { action: 'grant' | 'revoke'; recordId: string; fromAgent: string; toAgent: string }[]>;
}

// ---------------------------------------------------------------------------
// The shared-state port (durable-graph run rows; WorkflowRunService satisfies
// this structurally)
// ---------------------------------------------------------------------------

export interface RunRowsPort {
	listRuns(): Promise<readonly { readonly runId: string; readonly taskId: string; readonly status: string; readonly steps: readonly { readonly seq: number; readonly status: string }[] }[]>;
}

// ---------------------------------------------------------------------------
// Validation
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

function validateField(value: unknown, label: string): ContractField {
	if (!isPlainObject(value) || !hasKeys(value, ['name', 'type', 'required'])) {
		throw new Error(`${label}: field must have exactly the keys [name, required, type]`);
	}
	const name = value.name;
	if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9_]{0,31}$/.test(name)) {
		throw new Error(`${label}: field name must match /^[a-z][a-zA-Z0-9_]{0,31}$/`);
	}
	const type = value.type;
	if (typeof type !== 'string' || !['string', 'number', 'boolean', 'json'].includes(type)) {
		throw new Error(`${label}: field type must be one of string|number|boolean|json`);
	}
	if (typeof value.required !== 'boolean') {
		throw new Error(`${label}: field required must be a boolean`);
	}
	return { name, type: type as ParamType, required: value.required };
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
	return value !== undefined;
}

function validateConstraints(value: unknown, label: string): ContractConstraints {
	if (!isPlainObject(value) || !hasKeys(value, ['maxSteps', 'deadline', 'tools'])) {
		throw new Error(`${label}: constraints must have exactly the keys [deadline, maxSteps, tools]`);
	}
	if (value.maxSteps !== null && !isPositiveInteger(value.maxSteps)) {
		throw new Error(`${label}: constraints.maxSteps must be a positive integer or null`);
	}
	if (value.deadline !== null && !isPositiveInteger(value.deadline)) {
		throw new Error(`${label}: constraints.deadline must be a positive integer (epoch ms) or null`);
	}
	if (value.tools !== null && (!Array.isArray(value.tools) || !value.tools.every(tool => isNonEmptyString(tool)))) {
		throw new Error(`${label}: constraints.tools must be an array of non-empty tool ids or null`);
	}
	return { maxSteps: value.maxSteps, deadline: value.deadline, tools: value.tools === null ? null : [...value.tools as string[]] };
}

/** Strict validation of a delegation contract (throws with the offending rule). */
export function validateDelegationContract(value: unknown): DelegationContract {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'id', 'parent', 'worker', 'taskId', 'goal', 'inputs', 'inputValues', 'constraints', 'resultSchema', 'status', 'messageId', 'steering', 'result', 'timing'])) {
		throw new Error('flauz.a2a.contracts/v1: contract validation failed: expected exactly the keys [$schema, constraints, goal, id, inputs, inputValues, messageId, parent, result, resultSchema, status, steering, taskId, timing, worker]');
	}
	if (value.$schema !== CONTRACT_SCHEMA) {
		throw new Error(`flauz.a2a.contracts/v1: contract validation failed: $schema must be '${CONTRACT_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (typeof value.id !== 'string' || !CONTRACT_ID_PATTERN.test(value.id)) {
		throw new Error(`flauz.a2a.contracts/v1: id must match /^C-\\d{6,}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (!isAgentId(value.parent) || !isAgentId(value.worker)) {
		throw new Error('flauz.a2a.contracts/v1: parent/worker must be agent ids');
	}
	if (value.parent === value.worker) {
		throw new Error('flauz.a2a.contracts/v1: parent and worker must differ (an agent does not delegate to itself)');
	}
	if (typeof value.taskId !== 'string' || !/^T-\d{3,}$/.test(value.taskId)) {
		throw new Error(`flauz.a2a.contracts/v1: taskId must match /^T-\\d{3,}$/`);
	}
	if (!isNonEmptyString(value.goal)) {
		throw new Error('flauz.a2a.contracts/v1: goal must be a non-empty string');
	}
	if (!Array.isArray(value.inputs)) {
		throw new Error('flauz.a2a.contracts/v1: inputs must be an array of typed fields');
	}
	const inputs = value.inputs.map((field, index) => validateField(field, `flauz.a2a.contracts/v1: contract ${String(value.id)} input #${String(index)}`));
	if (!isPlainObject(value.inputValues)) {
		throw new Error('flauz.a2a.contracts/v1: inputValues must be a plain object');
	}
	const inputValues = value.inputValues;
	for (const key of Object.keys(inputValues)) {
		if (!inputs.some(field => field.name === key)) {
			throw new Error(`flauz.a2a.contracts/v1: inputValues carries undeclared input '${key}'`);
		}
	}
	for (const field of inputs) {
		if (field.required && !Object.prototype.hasOwnProperty.call(inputValues, field.name)) {
			throw new Error(`flauz.a2a.contracts/v1: required input '${field.name}' has no value`);
		}
		if (Object.prototype.hasOwnProperty.call(inputValues, field.name) && !valueMatchesType(inputValues[field.name], field.type)) {
			throw new Error(`flauz.a2a.contracts/v1: input '${field.name}' must be of type ${field.type}`);
		}
	}
	const constraints = validateConstraints(value.constraints, `flauz.a2a.contracts/v1: contract ${String(value.id)}`);
	if (!isPlainObject(value.resultSchema) || !hasKeys(value.resultSchema, ['fields'])) {
		throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} resultSchema must have exactly the keys [fields]`);
	}
	if (!Array.isArray(value.resultSchema.fields)) {
		throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} resultSchema.fields must be an array`);
	}
	const fields = value.resultSchema.fields.map((field: unknown, index: number) => validateField(field, `flauz.a2a.contracts/v1: contract ${String(value.id)} result field #${String(index)}`));
	if (fields.length === 0) {
		throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} resultSchema must declare at least one field (a delegation contract promises a typed result)`);
	}
	const status = value.status;
	if (typeof status !== 'string' || !(CONTRACT_STATUSES as readonly string[]).includes(status)) {
		throw new Error(`flauz.a2a.contracts/v1: status must be one of ${CONTRACT_STATUSES.join('|')} (got ${JSON.stringify(value.status)})`);
	}
	const messageId = value.messageId;
	if (messageId !== null && (typeof messageId !== 'string' || !/^M-\d{6,}$/.test(messageId))) {
		throw new Error(`flauz.a2a.contracts/v1: messageId must be M-NNNNNN or null`);
	}
	if (!Array.isArray(value.steering)) {
		throw new Error(`flauz.a2a.contracts/v1: steering must be an array of steering records`);
	}
	const steering = value.steering.map((entry: unknown, index: number) => {
		if (!isPlainObject(entry) || !hasKeys(entry, ['messageId', 'from', 'message', 'ts'])) {
			throw new Error(`flauz.a2a.contracts/v1: steering #${String(index)} must have exactly the keys [from, message, messageId, ts]`);
		}
		if (typeof entry.messageId !== 'string' || !/^M-\d{6,}$/.test(entry.messageId)) {
			throw new Error(`flauz.a2a.contracts/v1: steering #${String(index)} messageId must be M-NNNNNN`);
		}
		if (!isAgentId(entry.from)) {
			throw new Error(`flauz.a2a.contracts/v1: steering #${String(index)} from must be an agent id`);
		}
		if (!isNonEmptyString(entry.message)) {
			throw new Error(`flauz.a2a.contracts/v1: steering #${String(index)} message must be a non-empty string`);
		}
		if (!isPositiveInteger(entry.ts)) {
			throw new Error(`flauz.a2a.contracts/v1: steering #${String(index)} ts must be a positive integer`);
		}
		return { messageId: entry.messageId, from: entry.from, message: entry.message, ts: entry.ts };
	});
	if (value.result !== null) {
		const result = value.result;
		if (!isPlainObject(result) || !hasKeys(result, ['outcome', 'values', 'evidenceIds', 'verification', 'summary', 'submittedAt', 'verifiedAt', 'verificationNote'])) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result must have exactly the keys [evidenceIds, outcome, submittedAt, values, verification, verificationNote, verifiedAt]`);
		}
		const outcome = result.outcome;
		if (typeof outcome !== 'string' || !['ok', 'failed', 'cancelled'].includes(outcome)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.outcome must be ok|failed|cancelled`);
		}
		if (!isPlainObject(result.values)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.values must be a plain object`);
		}
		if (!Array.isArray(result.evidenceIds) || !result.evidenceIds.every((id: unknown) => typeof id === 'string' && /^E-\d{6,}$/.test(id as string))) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.evidenceIds must be an array of E-NNNNNN ids`);
		}
		if (result.verification !== 'verified' && result.verification !== 'reported-not-verified') {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.verification must be 'verified' or 'reported-not-verified'`);
		}
		if (!isNonEmptyString(result.summary)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.summary must be a non-empty string`);
		}
		if (!isPositiveInteger(result.submittedAt)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.submittedAt must be a positive integer`);
		}
		if (result.verifiedAt !== null && !isPositiveInteger(result.verifiedAt)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.verifiedAt must be a positive integer or null`);
		}
		if (result.verificationNote !== null && !isNonEmptyString(result.verificationNote)) {
			throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} result.verificationNote must be a non-empty string or null`);
		}
	}
	if (!isPlainObject(value.timing) || !hasKeys(value.timing, ['created', 'updatedAt'])) {
		throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} timing must have exactly the keys [created, updatedAt]`);
	}
	if (!isPositiveInteger(value.timing.created) || !isPositiveInteger(value.timing.updatedAt)) {
		throw new Error(`flauz.a2a.contracts/v1: contract ${String(value.id)} timing.created/updatedAt must be positive integers`);
	}
	return {
		$schema: CONTRACT_SCHEMA,
		id: value.id,
		parent: value.parent,
		worker: value.worker,
		taskId: value.taskId,
		goal: value.goal,
		inputs,
		inputValues,
		constraints,
		resultSchema: { fields },
		status: status as ContractStatus,
		messageId,
		steering,
		result: value.result as ContractResult | null,
		timing: { created: value.timing.created, updatedAt: value.timing.updatedAt },
	};
}

// ---------------------------------------------------------------------------
// The coordination service
// ---------------------------------------------------------------------------

export interface DelegateOptions {
	readonly parent: string;
	readonly worker: string;
	readonly taskId: string;
	readonly goal: string;
	readonly inputs?: readonly ContractField[];
	readonly inputValues?: Record<string, unknown>;
	readonly constraints?: Partial<ContractConstraints>;
	readonly resultSchema: { readonly fields: readonly ContractField[] };
}

export interface CoordinationOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly port: A2aPort;
	readonly clock?: Clock;
	/** The durable-graph run rows port (WorkflowRunService satisfies this structurally). */
	readonly runs?: RunRowsPort;
	/** The private-context share port (flauz-memory MemoryStore satisfies this structurally). */
	readonly shares?: ContextSharePort;
}

export interface SharedState {
	readonly task: Task;
	readonly contract: DelegationContract | null;
	/** Durable-graph run rows for the task (the rows both agents see). */
	readonly runRows: readonly { readonly runId: string; readonly seq: number; readonly status: string }[];
}

export class CoordinationService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly tasks: TaskService;
	private readonly ledger: EvidenceLedger;
	private readonly port: A2aPort;
	private readonly clock: Clock;
	private readonly runs: RunRowsPort | undefined;
	private readonly shares: ContextSharePort | undefined;

	constructor(options: CoordinationOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.tasks = options.tasks;
		this.ledger = options.ledger;
		this.port = options.port;
		this.clock = options.clock ?? (() => Date.now());
		this.runs = options.runs;
		this.shares = options.shares;
	}

	private contractPath(id: string): string {
		return joinPath(this.root, CONTRACTS_DIR, `${id}.json`);
	}

	private indexPath(): string {
		return joinPath(this.root, CONTRACTS_DIR, 'index.json');
	}

	/**
	 * Parent -> worker: delegate a task under a typed contract. Persists the
	 * contract FIRST (crash-safe), then posts the task-delegation message
	 * carrying the goal; the worker resolves the contract by task id.
	 */
	async delegate(options: DelegateOptions): Promise<{ contract: DelegationContract; messageId: string; seq: number }> {
		if (options.parent === options.worker) {
			throw new Error('flauz.a2a.contracts: parent and worker must differ');
		}
		const task = await this.tasks.getTask(options.taskId);
		void task;
		const now = this.clock();
		const index = await this.readIndex();
		let max = 0;
		for (const id of index.all) {
			const match = /^C-(\d+)$/.exec(id);
			if (match) {
				max = Math.max(max, Number.parseInt(match[1] ?? '0', 10));
			}
		}
		const id = `C-${String(max + 1).padStart(6, '0')}`;
		const contract: DelegationContract = {
			$schema: CONTRACT_SCHEMA,
			id,
			parent: options.parent,
			worker: options.worker,
			taskId: options.taskId,
			goal: options.goal,
			inputs: options.inputs ?? [],
			inputValues: options.inputValues ?? {},
			constraints: {
				maxSteps: options.constraints?.maxSteps ?? null,
				deadline: options.constraints?.deadline ?? null,
				tools: options.constraints?.tools ?? null,
			},
			resultSchema: options.resultSchema,
			status: 'delegated',
			messageId: null,
			steering: [],
			result: null,
			timing: { created: now, updatedAt: now },
		};
		validateDelegationContract(contract);
		await this.writeContract(contract);
		const posted = await this.port.post({
			kind: 'task-delegation',
			from: options.parent,
			to: options.worker,
			ts: now,
			inReplyTo: null,
			payload: { taskId: options.taskId, taskDescription: `Contract ${id}`, prompt: `${options.goal}\n\nDelegation contract ${id} (result schema: ${options.resultSchema.fields.map(field => `${field.name}:${field.type}`).join(', ')}).` },
		});
		const withMessage: DelegationContract = { ...contract, messageId: posted.message.id };
		await this.writeContract(withMessage);
		return { contract: withMessage, messageId: posted.message.id, seq: posted.seq };
	}

	/** Worker accepts the contract (the shared task state becomes binding). */
	async accept(taskId: string, worker: string): Promise<DelegationContract> {
		const contract = await this.contractFor(taskId);
		if (contract.worker !== worker) {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} is delegated to '${contract.worker}', not '${worker}'`);
		}
		if (contract.status !== 'delegated') {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} is '${contract.status}' (accept is legal only from 'delegated')`);
		}
		return this.updateContract(contract, { status: 'accepted' });
	}

	/**
	 * The shared task state - the graph rows BOTH agents see: the task
	 * envelope, the delegation contract and the durable-graph run rows.
	 */
	async sharedState(taskId: string): Promise<SharedState> {
		const task = await this.tasks.getTask(taskId);
		const contract = await this.tryContractFor(taskId);
		const runRows: { runId: string; seq: number; status: string }[] = [];
		if (this.runs !== undefined) {
			for (const run of await this.runs.listRuns()) {
				if (run.taskId !== taskId) {
					continue;
				}
				for (const step of run.steps) {
					runRows.push({ runId: run.runId, seq: step.seq, status: step.status });
				}
			}
		}
		return { task, contract, runRows };
	}

	/**
	 * Worker -> parent: submit the contract result. Values are validated
	 * against the result schema; evidence ids are verified against the
	 * ledger + artifact bytes; unverified results are labeled
	 * 'reported-not-verified' (never passed off as verified); a
	 * result-report message rides the bus either way.
	 */
	async submitResult(taskId: string, worker: string, result: { outcome: 'ok' | 'failed' | 'cancelled'; values: Record<string, unknown>; evidenceIds: readonly string[]; summary: string }): Promise<{ contract: DelegationContract; messageId: string; seq: number }> {
		const contract = await this.contractFor(taskId);
		if (contract.worker !== worker) {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} is delegated to '${contract.worker}', not '${worker}'`);
		}
		if (contract.status !== 'accepted' && contract.status !== 'delegated') {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} is '${contract.status}' (submission is legal only while the contract is open)`);
		}
		if (!isNonEmptyString(result.summary)) {
			throw new Error('flauz.a2a.contracts: result summary must be a non-empty string');
		}
		for (const field of contract.resultSchema.fields) {
			const has = Object.prototype.hasOwnProperty.call(result.values, field.name);
			if (field.required && !has) {
				throw new Error(`flauz.a2a.contracts: result missing required field '${field.name}' (${field.type})`);
			}
			if (has && !valueMatchesType(result.values[field.name], field.type)) {
				throw new Error(`flauz.a2a.contracts: result field '${field.name}' must be of type ${field.type}`);
			}
		}
		for (const key of Object.keys(result.values)) {
			if (!contract.resultSchema.fields.some(field => field.name === key)) {
				throw new Error(`flauz.a2a.contracts: result carries undeclared field '${key}'`);
			}
		}
		const now = this.clock();
		const verification = await this.verifyEvidence(result.evidenceIds);
		const contractResult: ContractResult = {
			outcome: result.outcome,
			values: result.values,
			evidenceIds: [...result.evidenceIds],
			verification: verification.verification,
			summary: result.summary,
			submittedAt: now,
			verifiedAt: verification.verification === 'verified' ? now : null,
			verificationNote: verification.note,
		};
		const status: ContractStatus = result.outcome === 'ok'
			? (verification.verification === 'verified' ? 'verified' : 'submitted')
			: (result.outcome === 'failed' ? 'failed' : 'cancelled');
		const updated = await this.updateContract(contract, { status, result: contractResult });
		const posted = await this.port.post({
			kind: 'result-report',
			from: worker,
			to: contract.parent,
			ts: now,
			inReplyTo: contract.messageId,
			payload: { taskId, outcome: result.outcome, evidenceIds: [...result.evidenceIds], summary: result.summary } satisfies A2aResultReport,
		});
		return { contract: updated, messageId: posted.message.id, seq: posted.seq };
	}

	/**
	 * Evidence verification: every id must resolve in the ledger AND, when the
	 * row's uri is a workspace-relative artifact, its bytes must re-hash to
	 * the row's sha256. Anything less is 'reported-not-verified'.
	 */
	private async verifyEvidence(evidenceIds: readonly string[]): Promise<{ verification: 'verified' | 'reported-not-verified'; note: string | null }> {
		if (evidenceIds.length === 0) {
			return { verification: 'reported-not-verified', note: 'the result claims no evidence rows at all' };
		}
		for (const evidenceId of evidenceIds) {
			const row = await this.ledger.rowByEvidenceId(evidenceId);
			if (row === undefined) {
				return { verification: 'reported-not-verified', note: `evidence row ${evidenceId} does not resolve in the ledger` };
			}
			const uri = typeof row.uri === 'string' ? row.uri : String(row.uri);
			const content = await this.fs.readFileUtf8(joinPath(this.root, uri));
			if (content === undefined) {
				return { verification: 'reported-not-verified', note: `evidence row ${evidenceId} artifact ${uri} is unreadable` };
			}
			if (sha256Hex(content) !== row.sha256) {
				return { verification: 'reported-not-verified', note: `evidence row ${evidenceId} artifact ${uri} bytes do not re-hash to the row sha256` };
			}
		}
		return { verification: 'verified', note: null };
	}

	/** Parent -> worker: mid-flight steering with provenance (recorded on the contract). */
	async steer(taskId: string, message: string): Promise<{ contract: DelegationContract; messageId: string; seq: number }> {
		const contract = await this.contractFor(taskId);
		if (!STEERABLE_STATUSES.includes(contract.status)) {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} is '${contract.status}' - steering is mid-flight only (the contract closed at submission)`);
		}
		if (!isNonEmptyString(message)) {
			throw new Error('flauz.a2a.contracts: steering message must be a non-empty string');
		}
		const now = this.clock();
		const posted = await this.port.post({
			kind: 'steering-relay',
			from: contract.parent,
			to: contract.worker,
			ts: now,
			inReplyTo: contract.messageId,
			payload: { taskId, message },
		});
		const steering: SteeringRecord = { messageId: posted.message.id, from: contract.parent, message, ts: now };
		const updated = await this.updateContract(contract, { steering: [...contract.steering, steering] });
		return { contract: updated, messageId: posted.message.id, seq: posted.seq };
	}

	/** Parent cancels the contract (while open). */
	async cancel(taskId: string): Promise<DelegationContract> {
		const contract = await this.contractFor(taskId);
		if (contract.status === 'verified' || contract.status === 'failed' || contract.status === 'cancelled') {
			throw new Error(`flauz.a2a.contracts: contract ${contract.id} already closed ('${contract.status}')`);
		}
		return this.updateContract(contract, { status: 'cancelled' });
	}

	// -- private context (the M4 boundary lifecycle over the share port) ----

	/** Grants a peer read access to one private memory record (explicit share record). */
	async grantContextAccess(recordId: string, toAgent: string, reason: string): Promise<void> {
		if (this.shares === undefined) {
			throw new Error('flauz.a2a.contracts: no ContextSharePort wired (the flauz-memory MemoryStore implements it)');
		}
		await this.shares.share(recordId, toAgent, { reason, actor: 'human' });
	}

	/** Revokes a previously granted share. */
	async revokeContextAccess(recordId: string, toAgent: string, reason: string): Promise<void> {
		if (this.shares === undefined) {
			throw new Error('flauz.a2a.contracts: no ContextSharePort wired (the flauz-memory MemoryStore implements it)');
		}
		await this.shares.revokeShare(recordId, toAgent, { reason, actor: 'human' });
	}

	/** The share records (the private-context boundary state). */
	async contextShares(): Promise<readonly { action: 'grant' | 'revoke'; recordId: string; fromAgent: string; toAgent: string }[]> {
		if (this.shares === undefined) {
			throw new Error('flauz.a2a.contracts: no ContextSharePort wired (the flauz-memory MemoryStore implements it)');
		}
		return this.shares.shares();
	}

	// -- persistence ----------------------------------------------------------

	async contractFor(taskId: string): Promise<DelegationContract> {
		const contract = await this.tryContractFor(taskId);
		if (contract === null) {
			throw new Error(`flauz.a2a.contracts: no delegation contract for task '${taskId}'`);
		}
		return contract;
	}

	/** The LATEST contract for a task (index resolves task -> contract id). */
	async tryContractFor(taskId: string): Promise<DelegationContract | null> {
		const index = await this.readIndex();
		const id = index.byTask[taskId];
		if (id === undefined) {
			return null;
		}
		return this.loadContract(id);
	}

	async loadContract(id: string): Promise<DelegationContract> {
		const raw = await this.fs.readFileUtf8(this.contractPath(id));
		if (raw === undefined) {
			throw new Error(`flauz.a2a.contracts: contract '${id}' not found at ${joinPath(CONTRACTS_DIR, `${id}.json`)}`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.a2a.contracts: contract '${id}' is not valid JSON: ${(err as Error).message}`);
		}
		return validateDelegationContract(parsed);
	}

	private async updateContract(contract: DelegationContract, patch: Partial<DelegationContract>): Promise<DelegationContract> {
		const updated: DelegationContract = { ...contract, ...patch, timing: { ...contract.timing, updatedAt: this.clock() } };
		validateDelegationContract(updated);
		await this.writeContract(updated);
		return updated;
	}

	private async writeContract(contract: DelegationContract): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, CONTRACTS_DIR));
		const target = this.contractPath(contract.id);
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, `${JSON.stringify(sortDeep(contract), null, 2)}\n`);
		await this.fs.rename(tmp, target);
		const index = await this.readIndex();
		const all = [...new Set([...index.all, contract.id])].sort();
		const byTask = { ...index.byTask, [contract.taskId]: contract.id };
		await this.fs.writeFile(`${this.indexPath()}.tmp`, `${JSON.stringify({ $schema: CONTRACT_SCHEMA, all, byTask }, null, 2)}\n`);
		await this.fs.rename(`${this.indexPath()}.tmp`, this.indexPath());
	}

	private async readIndex(): Promise<{ all: string[]; byTask: Record<string, string> }> {
		const raw = await this.fs.readFileUtf8(this.indexPath());
		if (raw === undefined) {
			return { all: [], byTask: {} };
		}
		const parsed = JSON.parse(raw) as { all?: unknown; byTask?: unknown };
		const all = Array.isArray(parsed.all) ? parsed.all.filter((id): id is string => typeof id === 'string' && CONTRACT_ID_PATTERN.test(id)) : [];
		const byTask: Record<string, string> = {};
		if (isPlainObject(parsed.byTask)) {
			for (const [taskId, id] of Object.entries(parsed.byTask)) {
				if (typeof id === 'string' && CONTRACT_ID_PATTERN.test(id) && /^T-\d{3,}$/.test(taskId)) {
					byTask[taskId] = id;
				}
			}
		}
		return { all, byTask };
	}
}

function sortDeep(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(sortDeep);
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			result[key] = sortDeep(record[key]);
		}
		return result;
	}
	return value;
}

/** The A2aPort over the in-process mediator journal (tests + the v0 host). */
export function inMemoryA2aPort(clock: Clock): A2aPort & { messages(): readonly A2aMessage[] } {
	const messages: A2aMessage[] = [];
	const cursors = new Map<string, number>();
	return {
		messages: () => [...messages],
		post: async input => {
			const seq = messages.length + 1;
			const message: A2aMessage = {
				$schema: 'flauz.a2a/v0',
				seq,
				id: messageIdOf(seq),
				kind: input.kind,
				from: input.from,
				to: input.to,
				ts: input.ts ?? clock(),
				inReplyTo: input.inReplyTo ?? null,
				payload: input.payload,
			};
			messages.push(message);
			return { id: message.id, seq, message };
		},
		collect: async (agentId, consume) => {
			const upto = cursors.get(agentId) ?? 1;
			const inbox = messages.filter(message => message.to === agentId && message.seq >= upto);
			if (consume !== false) {
				const highWater = inbox.length > 0 ? (inbox[inbox.length - 1]?.seq ?? 0) + 1 : upto;
				cursors.set(agentId, highWater);
			}
			return inbox;
		},
	};
}
