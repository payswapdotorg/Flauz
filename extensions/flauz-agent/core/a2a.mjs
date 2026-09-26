/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz agent-to-agent message bus, G side (Wave 4, Lane K, M3).
 *
 * C-26 boundary ruling (wave1/c matrix): agent-to-agent messaging has NO
 * stable upstream API -- Flauz adds it at the ORCHESTRATION layer (the Flauz
 * Core service seam, DL-21), never in src/vs chat transport. This module is
 * that bus: a typed message journal plus per-agent mailboxes, spoken over the
 * same stdio JSONL seam as the `flauz.workspace.*` commands.
 *
 * House style (DL-9/DL-20): the journal is an append-only JSONL file under
 * workspace-committed `.flauz/` (git-diffable, canonical line bytes); mailbox
 * state is a PROJECTION of the journal (replay = re-derivation), and delivery
 * cursors are the only separately persisted fact. Nothing secret ever enters
 * the journal.
 *
 * Message schema v0 ('flauz.a2a/v0') -- exactly one typed payload per kind:
 *   - task-delegation   parent -> worker: the delegated instruction
 *                       (IAgentSubagentStartedSignal.taskPrompt/.taskDescription
 *                       analogs, src/vs/platform/agentHost/common/agent.ts:998)
 *   - result-report     worker -> parent: outcome + produced evidence refs
 *   - steering-relay    parent -> worker: mid-run steering
 *                       (IAgentSubagentResumedSignal.message analog, agent.ts:1046)
 *   - resource-claim    any -> watchers: Claim+Lease notices on shared
 *                       resources (AGENT-INTEGRATION section 5: mutation of a
 *                       shared resource requires Claim+Lease from Core)
 *
 * Pure, zero-dependency (node:fs only), imported at runtime by core/service.mjs
 * and by the Lane K parity tests; the typed TypeScript mirror + the
 * delivered-to-the-participant bridge spec live in
 * extensions/flauz-workflow/src/messaging.ts.
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const A2A_SCHEMA = 'flauz.a2a/v0';
export const A2A_DIR = '.flauz/a2a';
export const A2A_MESSAGES_PATH = '.flauz/a2a/messages.jsonl';
export const A2A_CURSORS_PATH = '.flauz/a2a/cursors.json';
export const A2A_CURSORS_SCHEMA = 'flauz.a2a.cursors/v1';

export const MESSAGE_KINDS = ['task-delegation', 'result-report', 'steering-relay', 'resource-claim'];
export const REPORT_OUTCOMES = ['ok', 'failed', 'cancelled'];
export const CLAIM_ACTIONS = ['acquire', 'release', 'expire'];

const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MESSAGE_ID = /^M-\d{6,}$/;

export function isAgentId(value) {
	return typeof value === 'string' && AGENT_ID.test(value);
}

export function isMessageId(value) {
	return typeof value === 'string' && MESSAGE_ID.test(value);
}

/** Journal message id of a seq (the E-NNNNNN discipline, DL-21 clause 4). */
export function messageIdOf(seq) {
	return `M-${String(seq).padStart(6, '0')}`;
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, required, optional = []) {
	const keys = Object.keys(value);
	if (keys.length < required.length || keys.length > required.length + optional.length) {
		return false;
	}
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			return false;
		}
	}
	for (const key of keys) {
		if (!required.includes(key) && !optional.includes(key)) {
			return false;
		}
	}
	return true;
}

function isPositiveInteger(value) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

function isTaskId(value) {
	return typeof value === 'string' && /^T-\d{3,}$/.test(value);
}

function isEvidenceId(value) {
	return typeof value === 'string' && /^E-\d{6,}$/.test(value);
}

function isWorkflowId(value) {
	return typeof value === 'string' && /^W-\d{3,}$/.test(value);
}

/**
 * Structural validation of a COMPLETE journal message (the seq/id fields are
 * bus-minted; `post` validates the caller input separately and then calls
 * this via the constructed row). Mirrors validateA2aMessage in
 * extensions/flauz-workflow/src/messaging.ts -- parity is pinned by test.
 *
 * @returns {{ ok: boolean, message?: object, error?: string }}
 */
export function validateMessage(value) {
	if (!isPlainObject(value)) {
		return { ok: false, error: 'a2a message must be a JSON object' };
	}
	if (!hasExactKeys(value, ['$schema', 'seq', 'id', 'kind', 'from', 'to', 'ts', 'inReplyTo', 'payload'])) {
		return { ok: false, error: 'a2a message must have exactly the 9 keys [$schema, from, id, inReplyTo, kind, payload, seq, to, ts]' };
	}
	if (value.$schema !== A2A_SCHEMA) {
		return { ok: false, error: `a2a message $schema must be '${A2A_SCHEMA}' (got ${JSON.stringify(value.$schema)})` };
	}
	if (!isPositiveInteger(value.seq)) {
		return { ok: false, error: 'a2a message seq must be a positive integer' };
	}
	if (value.id !== messageIdOf(value.seq)) {
		return { ok: false, error: `a2a message id must be '${messageIdOf(value.seq)}' (derived from seq; got ${JSON.stringify(value.id)})` };
	}
	if (!MESSAGE_KINDS.includes(value.kind)) {
		return { ok: false, error: `a2a message kind must be one of ${MESSAGE_KINDS.join(' | ')}, got '${String(value.kind)}'` };
	}
	if (!isAgentId(value.from)) {
		return { ok: false, error: `a2a message from must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} (got ${JSON.stringify(value.from)})` };
	}
	if (!isAgentId(value.to)) {
		return { ok: false, error: `a2a message to must be an agent id [A-Za-z0-9][A-Za-z0-9._-]{0,63} (got ${JSON.stringify(value.to)})` };
	}
	if (value.from === value.to) {
		return { ok: false, error: 'a2a message from and to must differ (an agent does not message itself through the bus)' };
	}
	if (!isPositiveInteger(value.ts)) {
		return { ok: false, error: 'a2a message ts must be a positive integer (epoch ms)' };
	}
	if (value.inReplyTo !== null && !isMessageId(value.inReplyTo)) {
		return { ok: false, error: `a2a message inReplyTo must be an M-NNNNNN id or null (got ${JSON.stringify(value.inReplyTo)})` };
	}
	const payloadError = validatePayload(value.kind, value.payload);
	if (payloadError !== undefined) {
		return { ok: false, error: payloadError };
	}
	return { ok: true, message: value };
}

function validatePayload(kind, payload) {
	if (!isPlainObject(payload)) {
		return `a2a ${kind} payload must be a JSON object`;
	}
	if (kind === 'task-delegation') {
		if (!hasExactKeys(payload, ['taskId', 'taskDescription', 'prompt'], ['workflowId'])) {
			return 'a2a task-delegation payload must have exactly the keys [prompt, taskDescription, taskId, workflowId?]';
		}
		if (!isTaskId(payload.taskId)) {
			return `a2a task-delegation taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(payload.taskId)})`;
		}
		if (!isNonEmptyString(payload.taskDescription)) {
			return 'a2a task-delegation taskDescription must be a non-empty string';
		}
		if (!isNonEmptyString(payload.prompt)) {
			return 'a2a task-delegation prompt must be a non-empty string';
		}
		if (payload.workflowId !== undefined && !isWorkflowId(payload.workflowId)) {
			return `a2a task-delegation workflowId must match /^W-\\d{3,}$/ (got ${JSON.stringify(payload.workflowId)})`;
		}
		return undefined;
	}
	if (kind === 'result-report') {
		if (!hasExactKeys(payload, ['taskId', 'outcome', 'evidenceIds', 'summary'])) {
			return 'a2a result-report payload must have exactly the keys [evidenceIds, outcome, summary, taskId]';
		}
		if (!isTaskId(payload.taskId)) {
			return `a2a result-report taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(payload.taskId)})`;
		}
		if (!REPORT_OUTCOMES.includes(payload.outcome)) {
			return `a2a result-report outcome must be one of ${REPORT_OUTCOMES.join(' | ')}, got '${String(payload.outcome)}'`;
		}
		if (!Array.isArray(payload.evidenceIds) || !payload.evidenceIds.every((id) => isEvidenceId(id))) {
			return 'a2a result-report evidenceIds must be an array of E-NNNNNN ids';
		}
		if (!isNonEmptyString(payload.summary)) {
			return 'a2a result-report summary must be a non-empty string';
		}
		return undefined;
	}
	if (kind === 'steering-relay') {
		if (!hasExactKeys(payload, ['taskId', 'message'])) {
			return 'a2a steering-relay payload must have exactly the keys [message, taskId]';
		}
		if (!isTaskId(payload.taskId)) {
			return `a2a steering-relay taskId must match /^T-\\d{3,}$/ (got ${JSON.stringify(payload.taskId)})`;
		}
		if (!isNonEmptyString(payload.message)) {
			return 'a2a steering-relay message must be a non-empty string';
		}
		return undefined;
	}
	// kind === 'resource-claim'
	if (!hasExactKeys(payload, ['action', 'resource', 'leaseUntil'])) {
		return 'a2a resource-claim payload must have exactly the keys [action, leaseUntil, resource]';
	}
	if (!CLAIM_ACTIONS.includes(payload.action)) {
		return `a2a resource-claim action must be one of ${CLAIM_ACTIONS.join(' | ')}, got '${String(payload.action)}'`;
	}
	if (!isNonEmptyString(payload.resource)) {
		return 'a2a resource-claim resource must be a non-empty string';
	}
	if (payload.action === 'acquire') {
		if (!isPositiveInteger(payload.leaseUntil)) {
			return 'a2a resource-claim acquire requires leaseUntil (a positive integer epoch ms -- a claim IS a lease, AGENT-INTEGRATION section 5)';
		}
	} else if (payload.leaseUntil !== null) {
		return `a2a resource-claim ${payload.action} requires leaseUntil null (only acquire carries a lease)`;
	}
	return undefined;
}

/** Canonical compact JSON of a message (the exact journal line bytes). */
export function messageLine(message) {
	const sorted = {};
	for (const key of Object.keys(message).sort()) {
		sorted[key] = message[key];
	}
	sorted.payload = sortDeep(message.payload);
	return JSON.stringify(sorted);
}

function sortDeep(value) {
	if (Array.isArray(value)) {
		return value.map(sortDeep);
	}
	if (value !== null && typeof value === 'object') {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortDeep(value[key]);
		}
		return out;
	}
	return value;
}

function parseCursors(raw) {
	const parsed = JSON.parse(raw);
	if (!isPlainObject(parsed) || parsed.$schema !== A2A_CURSORS_SCHEMA || !isPlainObject(parsed.cursors)) {
		throw new Error(`a2a cursors file must be {'$schema': '${A2A_CURSORS_SCHEMA}', cursors: {<agentId>: <nextSeq>}}`);
	}
	const cursors = new Map();
	for (const [agentId, nextSeq] of Object.entries(parsed.cursors)) {
		if (!isAgentId(agentId) || typeof nextSeq !== 'number' || !Number.isSafeInteger(nextSeq) || nextSeq < 1) {
			throw new Error(`a2a cursors file has a malformed entry for '${agentId}'`);
		}
		cursors.set(agentId, nextSeq);
	}
	return cursors;
}

function serializeCursors(cursors) {
	const sorted = {};
	for (const agentId of [...cursors.keys()].sort()) {
		sorted[agentId] = cursors.get(agentId);
	}
	return `${JSON.stringify({ $schema: A2A_CURSORS_SCHEMA, cursors: sorted }, null, 2)}\n`;
}

/**
 * The file-backed A2A bus. One instance per workspace root, owned by the
 * core service (core/service.mjs wires it into the seam commands).
 */
export class A2ABus {
	constructor(root) {
		this.root = root;
		this.dir = join(root, A2A_DIR);
		this.messagesPath = join(root, A2A_MESSAGES_PATH);
		this.cursorsPath = join(root, A2A_CURSORS_PATH);
		this.messages = [];
		this.cursors = new Map();
		this.load();
	}

	load() {
		if (existsSync(this.messagesPath)) {
			const raw = readFileSync(this.messagesPath, 'utf-8');
			const lines = raw.length === 0 ? [] : raw.split('\n').filter((line) => line.length > 0);
			this.messages = [];
			for (const [index, line] of lines.entries()) {
				const seq = index + 1;
				let row;
				try {
					row = JSON.parse(line);
				} catch {
					throw new Error(`a2a journal line ${String(seq)} is not valid JSON`);
				}
				const verdict = validateMessage(row);
				if (!verdict.ok) {
					throw new Error(`a2a journal line ${String(seq)} is malformed: ${verdict.error}`);
				}
				if (row.seq !== seq) {
					throw new Error(`a2a journal line ${String(seq)} carries seq ${String(row.seq)} (seq must be the 1-based journal position)`);
				}
				if (line !== messageLine(row)) {
					throw new Error(`a2a journal line ${String(seq)} is not canonical (byte drift -- rewrite via the bus only)`);
				}
				this.messages.push(row);
			}
		}
		if (existsSync(this.cursorsPath)) {
			this.cursors = parseCursors(readFileSync(this.cursorsPath, 'utf-8'));
		}
	}

	saveCursors() {
		mkdirSync(this.dir, { recursive: true });
		writeFileSync(this.cursorsPath, serializeCursors(this.cursors));
	}

	/**
	 * Appends one message. Caller input: {kind, from, to, ts?, inReplyTo?,
	 * payload} -- seq/id/$schema are minted here. Returns the stored message.
	 */
	post({ message }) {
		if (!isPlainObject(message)) {
			throw new Error('a2a post requires a message object');
		}
		if (message.$schema !== undefined && message.$schema !== A2A_SCHEMA) {
			throw new Error(`a2a post $schema must be '${A2A_SCHEMA}' (got ${JSON.stringify(message.$schema)})`);
		}
		const row = {
			$schema: A2A_SCHEMA,
			seq: this.messages.length + 1,
			id: messageIdOf(this.messages.length + 1),
			kind: message.kind,
			from: message.from,
			to: message.to,
			ts: typeof message.ts === 'number' ? message.ts : Date.now(),
			inReplyTo: message.inReplyTo === undefined ? null : message.inReplyTo,
			payload: message.payload,
		};
		if (row.inReplyTo !== null && !this.messages.some((existing) => existing.id === row.inReplyTo)) {
			throw new Error(`a2a post inReplyTo '${row.inReplyTo}' does not reference a journaled message`);
		}
		const verdict = validateMessage(row);
		if (!verdict.ok) {
			throw new Error(verdict.error);
		}
		mkdirSync(this.dir, { recursive: true });
		appendFileSync(this.messagesPath, `${messageLine(row)}\n`);
		this.messages.push(row);
		return { id: row.id, seq: row.seq, message: row };
	}

	/**
	 * Delivers the agent's mailbox: every message TO the agent whose journal
	 * seq is at/after the agent's delivery cursor. consume=true (default)
	 * drains (cursor advances to the journal high-water mark -- every future
	 * message to this agent still arrives); consume=false peeks.
	 */
	collect({ agentId, consume }) {
		if (!isAgentId(agentId)) {
			throw new Error(`a2a collect agentId must be an agent id (got ${JSON.stringify(agentId)})`);
		}
		const drain = consume !== false;
		const cursor = this.cursors.get(agentId) ?? 1;
		const messages = this.messages.filter((message) => message.to === agentId && message.seq >= cursor);
		if (drain) {
			this.cursors.set(agentId, this.messages.length + 1);
			this.saveCursors();
		}
		return { messages };
	}

	/** Known agents (every from/to observed) with pending mailbox counts. */
	list() {
		const ids = new Set();
		for (const message of this.messages) {
			ids.add(message.from);
			ids.add(message.to);
		}
		const agents = [...ids].sort().map((agentId) => ({
			agentId,
			pending: this.messages.filter((message) => message.to === agentId && message.seq >= (this.cursors.get(agentId) ?? 1)).length,
		}));
		return { agents };
	}
}
