/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz agent-to-agent messaging v0, orchestration layer (Wave 4, Lane K, M3).
 *
 * C-26 (wave1/c matrix, row 'Agent-to-agent messaging'): the tree has steering
 * signals and subagent signals but NO agent-to-agent message bus - the ruling
 * is that Flauz adds it at the ORCHESTRATION layer. Concretely (DL-5 + DL-21):
 * agents never reference each other directly; the Flauz Core service is the
 * single mediator, and this module is the typed message layer spoken over the
 * core service seam (stdio JSONL, `flauz.a2a.*` commands wired in
 * extensions/flauz-agent/core/service.mjs against core/a2a.mjs).
 *
 * NO src/vs or chat-transport changes - the C-26 boundary is honored by
 * construction: everything here rides the DL-21 seam and workspace-committed
 * `.flauz/` artifacts (DL-9).
 *
 * Schema v0 ('flauz.a2a/v0') - exactly four typed kinds:
 *
 *   task-delegation  parent -> worker. Payload mirrors the AHP subagent spawn
 *                   surface (src/vs/platform/agentHost/common/agent.ts:998
 *                   IAgentSubagentStartedSignal): taskDescription = the short
 *                   per-task label, prompt = the full delegated instruction
 *                   (taskPrompt), optional workflowId = a flauz.workflows/v1
 *                   fragment id the worker re-runs via WorkflowService.run.
 *   result-report   worker -> parent. outcome + the ledger evidence ids the
 *                   work produced. TRUST ANCHOR: the bus itself is not
 *                   tamper-evident (no hash chain, v0) - verifiable facts ride
 *                   the DL-20 hardened ledger and are referenced here BY ID;
 *                   the bus carries routing, not proof.
 *   steering-relay  parent -> worker, mid-run steering (the
 *                   IAgentSubagentResumedSignal.message analog, agent.ts:1046;
 *                   consumed-steering surfaces as IAgentSteeringConsumedSignal).
 *   resource-claim  any -> watchers. Claim+Lease notices on shared resources
 *                   (AGENT-INTEGRATION section 5: mutation of a shared
 *                   resource requires Claim+Lease from Core). acquire MUST
 *                   carry leaseUntil (a claim IS a lease); release/expire
 *                   MUST NOT. v0 notices are informational - enforcement is a
 *                   recorded follow-up (REPORT DECISION-LOG-PROPOSALS).
 *
 * Persistence (DL-9/DL-20 house style): the bus journal is append-only
 * `.flauz/a2a/messages.jsonl` (one canonical-compact JSON message per line);
 * the mailbox of an agent is a PROJECTION of the journal (messages `to` the
 * agent id); delivery cursors (`.flauz/a2a/cursors.json`) are the only other
 * persisted fact. Replay = re-derivation.
 *
 * DELIVERED-TO-THE-PARTICIPANT BRIDGE (v0 spec; F-side wiring is a later wave):
 *   1. IDENTITY - an A2A agent id is the chat participant id of the agent
 *      runtime ('flauz.agent' for the Wave-3 bridge; spawned worker agents
 *      append a stable suffix, e.g. 'flauz.agent.worker-1'). C-23 spawned
 *      chats / subagent chats key off the root session + spawning tool id
 *      (agent.ts parentToolCallId) - the bridge maps that key to the agent id.
 *   2. OUTBOX - the participant's orchestrator posts every outgoing message
 *      through the seam command `flauz.a2a.post` (the A2aPort below); it
 *      never writes the journal directly.
 *   3. INBOX - at every chat turn start, the bridge drains
 *      `flauz.a2a.collect({agentId})` and dispatches by kind:
 *      task-delegation -> hydrate the delegated prompt into a fresh task
 *      (payload.workflowId present: WorkflowService.run(fragment id));
 *      steering-relay -> queue as mid-turn steering (the C-24 surface);
 *      result-report -> surface the worker's outcome to the user/parent turn;
 *      resource-claim -> update the shared-resource claim view.
 *   4. CURSOR - collect is the ONLY cursor writer (idempotent drain; restart
 *      replays nothing already drained).
 *
 * Node-free core: all IO goes through the A2aPort (the seam client /
 * core service implement it); this module typechecks without @types/node and
 * runs under plain `node --test` via type-stripping, like envelope.ts.
 */

import { type Clock, canonicalJson, isTaskId } from '../../flauz-workspace/src/api.ts';
import { isEvidenceId, isWorkflowId } from './envelope.ts';

/** Schema identifier pinned into every A2A message. */
export const A2A_SCHEMA = 'flauz.a2a/v0';

/** Journal path, relative to the workspace root (DL-9: workspace-committed). */
export const A2A_MESSAGES_PATH = '.flauz/a2a/messages.jsonl';

/** Delivery-cursor path, relative to the workspace root. */
export const A2A_CURSORS_PATH = '.flauz/a2a/cursors.json';

/** The four typed message kinds of v0. */
export const A2A_MESSAGE_KINDS = ['task-delegation', 'result-report', 'steering-relay', 'resource-claim'] as const;
export type A2aMessageKind = (typeof A2A_MESSAGE_KINDS)[number];

/** Result-report outcomes (aligned with the terminal intent of the task machine). */
export const A2A_REPORT_OUTCOMES = ['ok', 'failed', 'cancelled'] as const;
export type A2aReportOutcome = (typeof A2A_REPORT_OUTCOMES)[number];

/** Resource-claim actions (Claim+Lease lifecycle notices). */
export const A2A_CLAIM_ACTIONS = ['acquire', 'release', 'expire'] as const;
export type A2aClaimAction = (typeof A2A_CLAIM_ACTIONS)[number];

export interface A2aTaskDelegation {
	readonly taskId: string;
	readonly taskDescription: string;
	readonly prompt: string;
	readonly workflowId?: string;
}

export interface A2aResultReport {
	readonly taskId: string;
	readonly outcome: A2aReportOutcome;
	readonly evidenceIds: readonly string[];
	readonly summary: string;
}

export interface A2aSteeringRelay {
	readonly taskId: string;
	readonly message: string;
}

export interface A2aResourceClaim {
	readonly action: A2aClaimAction;
	readonly resource: string;
	/** Epoch-ms lease expiry; REQUIRED on acquire, MUST be null otherwise. */
	readonly leaseUntil: number | null;
}

export type A2aPayload = A2aTaskDelegation | A2aResultReport | A2aSteeringRelay | A2aResourceClaim;

/** The stored journal message (seq/id are bus-minted; the id is derived from seq). */
export interface A2aMessage {
	readonly $schema: typeof A2A_SCHEMA;
	readonly seq: number;
	readonly id: string;
	readonly kind: A2aMessageKind;
	readonly from: string;
	readonly to: string;
	readonly ts: number;
	readonly inReplyTo: string | null;
	readonly payload: A2aPayload;
}

/** Caller-side input (seq/id/$schema minted by the bus; ts/inReplyTo defaulted). */
export interface A2aMessageInput {
	readonly kind: A2aMessageKind;
	readonly from: string;
	readonly to: string;
	readonly ts?: number;
	readonly inReplyTo?: string | null;
	readonly payload: A2aPayload;
}

// ---------------------------------------------------------------------------
// Validation (strict, mirrors core/a2a.mjs validateMessage - parity pinned by
// test; every rule is violated by exactly one bad fixture).
// ---------------------------------------------------------------------------

const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MESSAGE_ID_PATTERN = /^M-\d{6,}$/;

export function isAgentId(value: unknown): value is string {
	return typeof value === 'string' && AGENT_ID_PATTERN.test(value);
}

export function isMessageId(value: unknown): value is string {
	return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value);
}

/** Journal message id of a seq (the E-NNNNNN discipline, DL-21 clause 4). */
export function messageIdOf(seq: number): string {
	return `M-${String(seq).padStart(6, '0')}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
	const actual = Object.keys(value);
	if (actual.length !== required.length + optional.length) {
		return false;
	}
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
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

function validatePayload(value: Record<string, unknown>, kind: A2aMessageKind, label: string): A2aPayload {
	if (kind === 'task-delegation') {
		if (!isPlainObject(value) || !hasKeys(value, ['taskId', 'taskDescription', 'prompt'], ['workflowId'])) {
			throw new Error(`${label}: task-delegation payload must have exactly the keys [prompt, taskDescription, taskId, workflowId?]`);
		}
		if (!isTaskId(value.taskId)) {
			throw new Error(`${label}: task-delegation taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(value.taskId)})`);
		}
		if (!isNonEmptyString(value.taskDescription)) {
			throw new Error(`${label}: task-delegation taskDescription must be a non-empty string`);
		}
		if (!isNonEmptyString(value.prompt)) {
			throw new Error(`${label}: task-delegation prompt must be a non-empty string`);
		}
		if (value.workflowId !== undefined && !isWorkflowId(value.workflowId)) {
			throw new Error(`${label}: task-delegation workflowId must match /^W-\\d{3,}$/ (got ${JSON.stringify(value.workflowId)})`);
		}
		return value.workflowId === undefined
			? { taskId: value.taskId, taskDescription: value.taskDescription, prompt: value.prompt }
			: { taskId: value.taskId, taskDescription: value.taskDescription, prompt: value.prompt, workflowId: value.workflowId };
	}
	if (kind === 'result-report') {
		if (!isPlainObject(value) || !hasKeys(value, ['taskId', 'outcome', 'evidenceIds', 'summary'])) {
			throw new Error(`${label}: result-report payload must have exactly the keys [evidenceIds, outcome, summary, taskId]`);
		}
		if (!isTaskId(value.taskId)) {
			throw new Error(`${label}: result-report taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(value.taskId)})`);
		}
		if (!(A2A_REPORT_OUTCOMES as readonly string[]).includes(value.outcome as string)) {
			throw new Error(`${label}: result-report outcome must be one of ${A2A_REPORT_OUTCOMES.join(' | ')} (got ${JSON.stringify(value.outcome)})`);
		}
		if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(id => isEvidenceId(id))) {
			throw new Error(`${label}: result-report evidenceIds must be an array of E-NNNNNN ids`);
		}
		if (!isNonEmptyString(value.summary)) {
			throw new Error(`${label}: result-report summary must be a non-empty string`);
		}
		return { taskId: value.taskId, outcome: value.outcome as A2aReportOutcome, evidenceIds: value.evidenceIds as string[], summary: value.summary };
	}
	if (kind === 'steering-relay') {
		if (!isPlainObject(value) || !hasKeys(value, ['taskId', 'message'])) {
			throw new Error(`${label}: steering-relay payload must have exactly the keys [message, taskId]`);
		}
		if (!isTaskId(value.taskId)) {
			throw new Error(`${label}: steering-relay taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(value.taskId)})`);
		}
		if (!isNonEmptyString(value.message)) {
			throw new Error(`${label}: steering-relay message must be a non-empty string`);
		}
		return { taskId: value.taskId, message: value.message };
	}
	// kind === 'resource-claim'
	if (!isPlainObject(value) || !hasKeys(value, ['action', 'resource', 'leaseUntil'])) {
		throw new Error(`${label}: resource-claim payload must have exactly the keys [action, leaseUntil, resource]`);
	}
	if (!(A2A_CLAIM_ACTIONS as readonly string[]).includes(value.action as string)) {
		throw new Error(`${label}: resource-claim action must be one of ${A2A_CLAIM_ACTIONS.join(' | ')} (got ${JSON.stringify(value.action)})`);
	}
	if (!isNonEmptyString(value.resource)) {
		throw new Error(`${label}: resource-claim resource must be a non-empty string`);
	}
	if (value.action === 'acquire') {
		if (!isPositiveInteger(value.leaseUntil)) {
			throw new Error(`${label}: resource-claim acquire requires leaseUntil (a positive integer epoch ms - a claim IS a lease, AGENT-INTEGRATION section 5)`);
		}
	} else if (value.leaseUntil !== null) {
		throw new Error(`${label}: resource-claim ${String(value.action)} requires leaseUntil null (only acquire carries a lease)`);
	}
	return { action: value.action as A2aClaimAction, resource: value.resource, leaseUntil: value.leaseUntil as number | null };
}

/** Strict validation of a complete journal message (throws with the offending rule). */
export function validateA2aMessage(value: unknown): A2aMessage {
	if (!isPlainObject(value) || !hasKeys(value, ['$schema', 'seq', 'id', 'kind', 'from', 'to', 'ts', 'inReplyTo', 'payload'])) {
		throw new Error('flauz.a2a/v0: message validation failed: expected exactly the 9 keys [$schema, from, id, inReplyTo, kind, payload, seq, to, ts]');
	}
	const label = `flauz.a2a/v0: message ${String(value.id)}`;
	if (value.$schema !== A2A_SCHEMA) {
		throw new Error(`${label}: $schema must be '${A2A_SCHEMA}' (got ${JSON.stringify(value.$schema)})`);
	}
	if (!isPositiveInteger(value.seq)) {
		throw new Error(`${label}: seq must be a positive integer`);
	}
	if (value.id !== messageIdOf(value.seq)) {
		throw new Error(`${label}: id must be '${messageIdOf(value.seq)}' (derived from seq)`);
	}
	if (!(A2A_MESSAGE_KINDS as readonly string[]).includes(value.kind as string)) {
		throw new Error(`${label}: kind must be one of ${A2A_MESSAGE_KINDS.join(' | ')} (got ${JSON.stringify(value.kind)})`);
	}
	if (!isAgentId(value.from)) {
		throw new Error(`${label}: from must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} (got ${JSON.stringify(value.from)})`);
	}
	if (!isAgentId(value.to)) {
		throw new Error(`${label}: to must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} (got ${JSON.stringify(value.to)})`);
	}
	if (value.from === value.to) {
		throw new Error(`${label}: from and to must differ (an agent does not message itself through the bus)`);
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error(`${label}: ts must be a positive integer (epoch ms)`);
	}
	if (value.inReplyTo !== null && !isMessageId(value.inReplyTo)) {
		throw new Error(`${label}: inReplyTo must be an M-NNNNNN id or null (got ${JSON.stringify(value.inReplyTo)})`);
	}
	const kind = value.kind as A2aMessageKind;
	const payload = validatePayload(value.payload as Record<string, unknown>, kind, label);
	return {
		$schema: A2A_SCHEMA,
		seq: value.seq,
		id: value.id,
		kind,
		from: value.from,
		to: value.to,
		ts: value.ts,
		inReplyTo: value.inReplyTo,
		payload,
	};
}

/** Canonical compact JSON of a message (the exact journal line bytes; parity with core/a2a.mjs messageLine). */
export function serializeA2aMessage(message: A2aMessage): string {
	return canonicalJson(message);
}

// ---------------------------------------------------------------------------
// Mailbox projection (pure)
// ---------------------------------------------------------------------------

/** The mailbox of an agent = every journaled message addressed to it. */
export function projectMailbox(messages: readonly A2aMessage[], agentId: string): A2aMessage[] {
	return messages.filter(message => message.to === agentId);
}

/** All agent ids the journal has ever seen (senders and receivers). */
export function knownAgents(messages: readonly A2aMessage[]): string[] {
	const ids = new Set<string>();
	for (const message of messages) {
		ids.add(message.from);
		ids.add(message.to);
	}
	return [...ids].sort();
}

// ---------------------------------------------------------------------------
// The A2aPort + the orchestration facade
// ---------------------------------------------------------------------------

/**
 * The transport port. The production implementation rides the DL-21 seam
 * (`flauz.a2a.post` / `flauz.a2a.collect` on the core service); tests inject
 * fakes. The bridge spec (module header) is the delivered-to-the-participant
 * contract for wiring this into the chat participants.
 */
export interface A2aPort {
	post(input: A2aMessageInput): Promise<{ id: string; seq: number; message: A2aMessage }>;
	collect(agentId: string, consume?: boolean): Promise<A2aMessage[]>;
}

export interface AgentMessengerOptions {
	/** The agent id this messenger speaks FOR (the participant's own id). */
	readonly self: string;
	readonly port: A2aPort;
	readonly clock?: Clock;
}

/**
 * Orchestrator-facing facade over the bus (AGENT-INTEGRATION section 5: the
 * Core is the single mediator - every helper validates and posts through the
 * port; nothing here writes the journal directly).
 */
export class AgentMessenger {
	private readonly self: string;
	private readonly port: A2aPort;
	private readonly clock: Clock;

	constructor(options: AgentMessengerOptions) {
		if (!isAgentId(options.self)) {
			throw new Error(`flauz.a2a: invalid self agent id ${JSON.stringify(options.self)}`);
		}
		this.self = options.self;
		this.port = options.port;
		this.clock = options.clock ?? (() => Date.now());
	}

	/** Parent -> worker: delegate one task (the full instruction + optional workflow re-run recipe). */
	async delegate(to: string, payload: A2aTaskDelegation, inReplyTo?: string | null): Promise<{ id: string; seq: number }> {
		const posted = await this.port.post({ kind: 'task-delegation', from: this.self, to, ts: this.clock(), inReplyTo: inReplyTo ?? null, payload });
		return { id: posted.id, seq: posted.seq };
	}

	/** Worker -> parent: report a completed/failed/cancelled task with its evidence refs. */
	async reportBack(to: string, payload: A2aResultReport, inReplyTo?: string | null): Promise<{ id: string; seq: number }> {
		const posted = await this.port.post({ kind: 'result-report', from: this.self, to, ts: this.clock(), inReplyTo: inReplyTo ?? null, payload });
		return { id: posted.id, seq: posted.seq };
	}

	/** Parent -> worker: relay mid-run steering (the C-24 surface). */
	async relaySteering(to: string, payload: A2aSteeringRelay): Promise<{ id: string; seq: number }> {
		const posted = await this.port.post({ kind: 'steering-relay', from: this.self, to, ts: this.clock(), payload });
		return { id: posted.id, seq: posted.seq };
	}

	/** Any -> watchers: a Claim+Lease notice on a shared resource. */
	async notifyClaim(to: string, payload: A2aResourceClaim): Promise<{ id: string; seq: number }> {
		const posted = await this.port.post({ kind: 'resource-claim', from: this.self, to, ts: this.clock(), payload });
		return { id: posted.id, seq: posted.seq };
	}

	/** Drain this agent's own mailbox (bridge step 3 of the spec). */
	async drain(): Promise<A2aMessage[]> {
		return this.port.collect(this.self);
	}

	/** Peek this agent's own mailbox without advancing the delivery cursor. */
	async peek(): Promise<A2aMessage[]> {
		return this.port.collect(this.self, false);
	}
}
