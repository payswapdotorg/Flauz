/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import {
	SCHEMA_ID,
	FLAUZ_DIR,
	EVIDENCE_DIR,
	ENVELOPE_PATH,
	type Actor,
	type Clock,
	type Envelope,
	type EvidenceKind,
	type FileSystemPort,
	type Task,
	type TaskEvent,
	type TaskStatus,
	type TransitionRule,
	clone,
	isActor,
	isTaskId,
	isTaskStatus,
	joinPath,
	serializeEnvelope,
	transitionRule,
} from './api.ts';
import { hasKey } from './ledger.ts';

interface MutableTask {
	id: string;
	title: string;
	status: TaskStatus;
	events: TaskEvent[];
	timing: { created: number; updatedAt: number };
	changes: { uri: string; checkpointRef: string | null }[];
}

interface MutableEnvelope {
	$schema: string;
	tasks: MutableTask[];
}

export interface TaskServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	if (actual.length !== keys.length) {
		return false;
	}
	return keys.every(key => hasKey(value, key));
}

export function validateEvent(event: unknown): TaskEvent {
	if (!isPlainObject(event) || !hasExactKeys(event, ['ts', 'actor', 'type', 'payload'])) {
		throw new Error('flauz.tasks/v0: invalid event: expected exactly the keys [actor, payload, ts, type]');
	}
	if (typeof event.ts !== 'number' || !Number.isSafeInteger(event.ts) || event.ts <= 0) {
		throw new Error('flauz.tasks/v0: invalid event: ts must be a positive integer (epoch ms)');
	}
	if (!isActor(event.actor)) {
		throw new Error(`flauz.tasks/v0: invalid event: actor must be one of agent|human|tool (got ${JSON.stringify(event.actor)})`);
	}
	if (typeof event.type !== 'string' || event.type.length === 0) {
		throw new Error('flauz.tasks/v0: invalid event: type must be a non-empty string');
	}
	if (!isPlainObject(event.payload)) {
		throw new Error('flauz.tasks/v0: invalid event: payload must be a plain object');
	}
	return event as unknown as TaskEvent;
}

function validateTask(value: unknown, index: number): MutableTask {
	if (!isPlainObject(value) || !hasExactKeys(value, ['id', 'title', 'status', 'events', 'timing', 'changes'])) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task #${index} must have exactly the keys [changes, events, id, status, timing, title]`);
	}
	if (!isTaskId(value.id)) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task #${index} id must match /^T-\\d{3,}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (typeof value.title !== 'string' || value.title.length === 0) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} title must be a non-empty string`);
	}
	if (!isTaskStatus(value.status)) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} has unknown status ${JSON.stringify(value.status)}`);
	}
	if (!Array.isArray(value.events)) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} events must be an array`);
	}
	const events = value.events.map((event, eventIndex) => {
		try {
			return validateEvent(event);
		} catch (err) {
			throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} event #${eventIndex}: ${(err as Error).message}`);
		}
	});
	if (!isPlainObject(value.timing) || !hasExactKeys(value.timing, ['created', 'updatedAt'])) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} timing must have exactly the keys [created, updatedAt]`);
	}
	const timing = value.timing;
	if (typeof timing.created !== 'number' || !Number.isSafeInteger(timing.created) || timing.created <= 0) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} timing.created must be a positive integer`);
	}
	if (typeof timing.updatedAt !== 'number' || !Number.isSafeInteger(timing.updatedAt) || timing.updatedAt <= 0) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} timing.updatedAt must be a positive integer`);
	}
	if (!Array.isArray(value.changes)) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} changes must be an array`);
	}
	const changes = value.changes.map((change, changeIndex) => {
		if (!isPlainObject(change) || !hasExactKeys(change, ['uri', 'checkpointRef'])) {
			throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} change #${changeIndex} must have exactly the keys [checkpointRef, uri]`);
		}
		if (typeof change.uri !== 'string' || change.uri.length === 0) {
			throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} change #${changeIndex} uri must be a non-empty string`);
		}
		if (change.checkpointRef !== null && typeof change.checkpointRef !== 'string') {
			throw new Error(`flauz.tasks/v0: envelope validation failed: task ${value.id} change #${changeIndex} checkpointRef must be a string or null`);
		}
		return { uri: change.uri, checkpointRef: change.checkpointRef };
	});
	return { id: value.id, title: value.title, status: value.status, events, timing: { created: timing.created, updatedAt: timing.updatedAt }, changes };
}

export function validateEnvelope(value: unknown): MutableEnvelope {
	if (!isPlainObject(value) || !hasExactKeys(value, ['$schema', 'tasks'])) {
		throw new Error('flauz.tasks/v0: envelope validation failed: expected exactly the keys [$schema, tasks]');
	}
	if (value.$schema !== SCHEMA_ID) {
		throw new Error(`flauz.tasks/v0: envelope validation failed: $schema must be '${SCHEMA_ID}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (!Array.isArray(value.tasks)) {
		throw new Error('flauz.tasks/v0: envelope validation failed: tasks must be an array');
	}
	return { $schema: SCHEMA_ID, tasks: value.tasks.map((task, index) => validateTask(task, index)) };
}

function allocateTaskId(tasks: readonly { readonly id: string }[]): string {
	let max = 0;
	for (const task of tasks) {
		const match = /^T-(\d+)$/.exec(task.id);
		if (match) {
			const numeric = Number.parseInt(match[1] ?? '0', 10);
			if (numeric > max) {
				max = numeric;
			}
		}
	}
	return `T-${String(max + 1).padStart(3, '0')}`;
}

export class TaskService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;

	constructor(options: TaskServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
	}

	private envelopePath(): string {
		return joinPath(this.root, ENVELOPE_PATH);
	}

	/** Creates `.flauz/` + `.flauz/evidence/` and the envelope if absent. Idempotent. */
	async bootstrap(): Promise<void> {
		await this.fs.mkdir(joinPath(this.root, FLAUZ_DIR));
		await this.fs.mkdir(joinPath(this.root, EVIDENCE_DIR));
		if (await this.fs.readFileUtf8(this.envelopePath()) === undefined) {
			await this.save({ $schema: SCHEMA_ID, tasks: [] });
		}
	}

	async createTask(title: string): Promise<Task> {
		if (typeof title !== 'string' || title.length === 0) {
			throw new Error('flauz.tasks/v0: task title must be a non-empty string');
		}
		const envelope = await this.load();
		const now = this.clock();
		const task: MutableTask = {
			id: allocateTaskId(envelope.tasks),
			title,
			status: 'plan',
			events: [],
			timing: { created: now, updatedAt: now },
			changes: [],
		};
		envelope.tasks.push(task);
		await this.save(envelope);
		return clone(task as Task);
	}

	async listTasks(): Promise<Task[]> {
		const envelope = await this.load();
		const sorted = [...envelope.tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
		return sorted.map(task => clone(task as Task));
	}

	async getTask(taskId: string): Promise<Task> {
		const envelope = await this.load();
		const task = envelope.tasks.find(candidate => candidate.id === taskId);
		if (task === undefined) {
			throw new Error(`flauz.tasks/v0: unknown task '${taskId}'`);
		}
		return clone(task as Task);
	}

	/**
	 * Appends an event. If `event.type` names a transition, the flauz.tasks/v0 state
	 * machine gates it first (actor + source status); on success the task status moves
	 * to the transition target. Any other type is appended verbatim (observational).
	 */
	async appendEvent(taskId: string, event: TaskEvent): Promise<Task> {
		validateEvent(event);
		const envelope = await this.load();
		const task = requireTask(envelope, taskId);
		const rule = transitionRule(event.type);
		if (rule !== undefined) {
			assertTransitionLegal(rule, task.status, event.actor);
			task.status = rule.to;
		}
		task.events.push(event);
		task.timing.updatedAt = this.clock();
		await this.save(envelope);
		return clone(task as Task);
	}

	/** Records an evidence append on the task timeline (and `changes` for changesets). */
	async recordEvidence(taskId: string, info: { evidenceId: string; seq: number; kind: EvidenceKind; uri: string; sha256: string; note?: string }): Promise<Task> {
		const envelope = await this.load();
		const task = requireTask(envelope, taskId);
		const payload: Record<string, unknown> = {
			evidenceId: info.evidenceId,
			seq: info.seq,
			kind: info.kind,
			uri: info.uri,
			sha256: info.sha256,
		};
		if (info.note !== undefined) {
			payload.note = info.note;
		}
		task.events.push({ ts: this.clock(), actor: 'tool', type: 'evidence', payload });
		if (info.kind === 'changeset') {
			task.changes.push({ uri: info.uri, checkpointRef: null });
		}
		task.timing.updatedAt = this.clock();
		await this.save(envelope);
		return clone(task as Task);
	}

	/** Records a checkpoint attempt (attested or blocked) on the task timeline. */
	async recordCheckpoint(taskId: string, info: { mode: 'attested' | 'blocked'; requestId: string; stopId?: string; gap?: { uri: string; seq: number } }): Promise<Task> {
		const envelope = await this.load();
		const task = requireTask(envelope, taskId);
		const payload: Record<string, unknown> = { mode: info.mode, requestId: info.requestId };
		if (info.stopId !== undefined) {
			payload.stopId = info.stopId;
		}
		if (info.gap !== undefined) {
			payload.gap = info.gap;
		}
		task.events.push({ ts: this.clock(), actor: 'tool', type: 'checkpoint', payload });
		if (info.mode === 'attested' && info.stopId !== undefined) {
			task.changes.push({ uri: `flauz-checkpoint://${info.stopId}`, checkpointRef: info.stopId });
		}
		task.timing.updatedAt = this.clock();
		await this.save(envelope);
		return clone(task as Task);
	}

	private async load(): Promise<MutableEnvelope> {
		const path = this.envelopePath();
		const raw = await this.fs.readFileUtf8(path);
		if (raw === undefined) {
			throw new Error(`flauz.tasks/v0: envelope not found at ${path} (bootstrap required)`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (err) {
			throw new Error(`flauz.tasks/v0: envelope at ${path} is not valid JSON: ${(err as Error).message}`);
		}
		return validateEnvelope(parsed);
	}

	private async save(envelope: MutableEnvelope): Promise<void> {
		const contents = serializeEnvelope(envelope as Envelope);
		const target = this.envelopePath();
		const tmp = `${target}.tmp`;
		await this.fs.writeFile(tmp, contents);
		await this.fs.rename(tmp, target);
	}
}

function requireTask(envelope: MutableEnvelope, taskId: string): MutableTask {
	const task = envelope.tasks.find(candidate => candidate.id === taskId);
	if (task === undefined) {
		throw new Error(`flauz.tasks/v0: unknown task '${taskId}'`);
	}
	return task;
}

function assertTransitionLegal(rule: TransitionRule, status: TaskStatus, actor: Actor): void {
	if (!rule.from.includes(status)) {
		throw new Error(`flauz.tasks/v0: transition '${rule.type}' is not legal from status '${status}' (allowed source statuses: ${rule.from.join(', ')})`);
	}
	if (!rule.actors.includes(actor)) {
		throw new Error(`flauz.tasks/v0: transition '${rule.type}' requires actor ${rule.actors.map(a => `'${a}'`).join(' | ')} (got '${actor}')`);
	}
}
