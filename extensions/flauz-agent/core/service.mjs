/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz workspace seam service — G side of the Lane F vertical slice.
 *
 * Zero-dependency Node service. The Agent Bridge extension (F side, see
 * `src/seamClient.ts`) spawns this file and speaks newline-delimited JSON
 * over stdio:
 *
 *   F -> G: {"type":"hello","client":"flauz-agent","version":"0.1.0","globalStoragePath":"..."}
 *   G -> F: {"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0"}
 *   F -> G: {"id":1,"cmd":"flauz.workspace.createTask","args":{"title":"..."}}
 *   G -> F: {"id":1,"ok":true,"result":{"taskId":"T-001"}}
 *   F -> G: {"id":2,"cmd":"ping"}
 *   G -> F: {"id":2,"ok":true,"result":{"pong":true,"ts":1234}}
 *
 * Commands (seam contract section H): createTask / appendEvent / listTasks / getTask /
 * appendEvidence / createCheckpoint / verifyLedger, all under the
 * `flauz.workspace.*` namespace. State lives in the workspace:
 *   <root>/.flauz/tasks.json            — task envelope (stable key order,
 *                                         2-space indent, trailing newline)
 *   <root>/.flauz/evidence/ledger.jsonl — append-only evidence rows
 * Every task event and evidence row is also relayed (append-only JSONL) to
 * the extension globalStorage path supplied in the handshake, v0 event-relay.
 *
 * Disposal note: stdin EOF (or SIGTERM) exits 0 exactly once (single exit
 * path guarded by `exited`; the eager exit-promise race found in the first
 * iteration is fixed by that guard plus the setImmediate flush deferral).
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
		TASKS_SCHEMA,
		SERVICE_NAME,
		SERVICE_VERSION,
		TERMINAL_STATUSES,
		EVIDENCE_KINDS,
		EVENT_ACTORS,
		applyTransition,
		canonicalJson,
		rowHash,
		validateLedgerRows,
} from './contracts.mjs';

const SHA256_HEX = /^[0-9a-f]{64}$/;

class SeamError extends Error {
		constructor(message) {
				super(message);
				this.name = 'SeamError';
		}
}

function sha256Hex(input) {
		return createHash('sha256').update(input, 'utf-8').digest('hex');
}

/** Workspace-backed implementation of the `flauz.workspace.*` command seam. */
export class WorkspaceSeam {
		constructor(root) {
				this.root = root;
				this.flauzDir = join(root, '.flauz');
				this.tasksPath = join(this.flauzDir, 'tasks.json');
				this.ledgerDir = join(this.flauzDir, 'evidence');
				this.ledgerPath = join(this.ledgerDir, 'ledger.jsonl');
				this.relayPath = undefined;
				this.tasks = [];
				this.ledgerLines = [];
				this.load();
		}

		load() {
				if (existsSync(this.tasksPath)) {
						const envelope = JSON.parse(readFileSync(this.tasksPath, 'utf-8'));
						if (envelope.$schema !== TASKS_SCHEMA) {
								throw new SeamError(`unsupported tasks schema: ${envelope.$schema}`);
						}
						this.tasks = envelope.tasks;
				}
				if (existsSync(this.ledgerPath)) {
						const raw = readFileSync(this.ledgerPath, 'utf-8');
						this.ledgerLines = raw.length === 0 ? [] : raw.split('\n').filter((line) => line.length > 0);
				}
		}

		/** Persist the task envelope with stable key order, 2-space indent, trailing newline. */
		saveTasks() {
				const envelope = { $schema: TASKS_SCHEMA, tasks: this.tasks };
				mkdirSync(this.flauzDir, { recursive: true });
				writeFileSync(this.tasksPath, JSON.stringify(envelope, null, 2) + '\n');
		}

		relay(topic, payload) {
				if (!this.relayPath) {
						return;
				}
				appendFileSync(this.relayPath, JSON.stringify({ ts: Date.now(), topic, ...payload }) + '\n');
		}

		findTask(taskId) {
				return this.tasks.find((task) => task.id === taskId);
		}

		requireTask(taskId) {
				const task = this.findTask(taskId);
				if (!task) {
						throw new SeamError(`unknown task: ${taskId}`);
				}
				return task;
		}

		nextTaskId() {
				let max = 0;
				for (const task of this.tasks) {
						const match = /^T-(\d+)$/.exec(task.id);
						if (match) {
								max = Math.max(max, Number.parseInt(match[1], 10));
						}
				}
				return `T-${String(max + 1).padStart(3, '0')}`;
		}

		createTask({ title }) {
				if (typeof title !== 'string' || title.trim().length === 0) {
						throw new SeamError('createTask requires a non-empty string title');
				}
				const now = Date.now();
				const task = {
						id: this.nextTaskId(),
						title,
						status: 'plan',
						events: [{ ts: now, actor: 'agent', type: 'created', payload: { title } }],
						timing: { created: now, updatedAt: now },
						changes: [],
				};
				this.tasks.push(task);
				this.saveTasks();
				this.relay('task-created', { taskId: task.id });
				return { taskId: task.id };
		}

		appendEvent({ taskId, event }) {
				const task = this.requireTask(taskId);
				if (!event || typeof event !== 'object') {
						throw new SeamError('appendEvent requires an event object');
				}
				const actor = event.actor;
				const type = event.type;
				if (!EVENT_ACTORS.includes(actor)) {
						throw new SeamError(`event actor must be one of ${EVENT_ACTORS.join(' | ')}, got '${String(actor)}'`);
				}
				if (typeof type !== 'string' || type.length === 0) {
						throw new SeamError('event type must be a non-empty string');
				}
				const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
				const verdict = applyTransition(task.status, { actor, type });
				if (verdict.error) {
						throw new SeamError(verdict.error);
				}
				task.status = verdict.status;
				task.events.push({ ts: typeof event.ts === 'number' ? event.ts : Date.now(), actor, type, payload });
				task.timing.updatedAt = Date.now();
				this.saveTasks();
				this.relay('task-event', { taskId, type, actor, status: task.status });
				return { task };
		}

		listTasks() {
				const tasks = [...this.tasks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
				return { tasks };
		}

		getTask({ taskId }) {
				return { task: this.requireTask(taskId) };
		}

		appendEvidence({ taskId, row }) {
				const task = this.requireTask(taskId);
				if (!row || typeof row !== 'object') {
						throw new SeamError('appendEvidence requires a row object');
				}
				if (!EVIDENCE_KINDS.includes(row.kind)) {
						throw new SeamError(`evidence kind must be one of ${EVIDENCE_KINDS.join(' | ')}, got '${String(row.kind)}'`);
				}
				if (typeof row.uri !== 'string' || row.uri.length === 0) {
						throw new SeamError('evidence uri must be a non-empty string');
				}
				if (typeof row.sha256 !== 'string' || !SHA256_HEX.test(row.sha256)) {
						throw new SeamError('evidence sha256 must be a 64-character lowercase hex string');
				}
				// `note` is accepted per the seam contract but intentionally NOT persisted
				// in v0 ledger rows (documented deviation, REPORT section CONTRACT-DEVIATIONS).
				const seq = this.ledgerLines.length + 1;
				const previous = seq === 1 ? null : JSON.parse(this.ledgerLines[seq - 2]);
				const line = {
						seq,
						ts: Date.now(),
						taskId: task.id,
						kind: row.kind,
						uri: row.uri,
						sha256: row.sha256,
						prev: seq === 1 ? null : rowHash(previous),
				};
				mkdirSync(this.ledgerDir, { recursive: true });
				appendFileSync(this.ledgerPath, JSON.stringify(line) + '\n');
				this.ledgerLines.push(JSON.stringify(line));
				this.relay('evidence-row', { taskId: task.id, seq, kind: row.kind });
				return { evidenceId: `E-${seq}`, seq };
		}

		createCheckpoint({ taskId, requestId, stopId }) {
				const task = this.requireTask(taskId);
				if (typeof requestId !== 'string' || requestId.length === 0) {
						throw new SeamError('createCheckpoint requires a non-empty requestId');
				}
				if (TERMINAL_STATUSES.includes(task.status)) {
						return { checkpointRef: null };
				}
				const digest = sha256Hex(canonicalJson(task) + '\u0000' + requestId + '\u0000' + String(stopId ?? ''));
				const ref = `flauz-ckpt-${digest.slice(0, 12)}`;
				task.changes.push({ uri: `flauz-checkpoint://${taskId}/${requestId}`, checkpointRef: ref });
				task.timing.updatedAt = Date.now();
				this.saveTasks();
				this.relay('checkpoint', { taskId, checkpointRef: ref });
				return { checkpointRef: ref };
		}

		verifyLedger() {
				const verdict = validateLedgerRows(this.ledgerLines);
				const result = { ok: verdict.ok, rows: verdict.rows.length };
				if (!verdict.ok) {
						result.firstBadSeq = verdict.firstBadSeq;
				}
				return result;
		}
}

function main() {
		const root = process.argv[2] ?? process.env.FLAUZ_WORKSPACE_ROOT;
		if (!root) {
				process.stderr.write('usage: node service.mjs <workspaceRoot>\n');
				process.exit(2);
		}

		let seam = null;
		let exited = false;
		const exitOnce = (code) => {
				if (exited) {
						return;
				}
				exited = true;
				// Defer one macrotask so the final stdout write can flush through the pipe.
				setImmediate(() => process.exit(code));
		};

		const send = (message) => {
				process.stdout.write(JSON.stringify(message) + '\n');
		};

		let buffer = '';

		const commands = {
				'flauz.workspace.createTask': (args) => seam.createTask(args),
				'flauz.workspace.appendEvent': (args) => seam.appendEvent(args),
				'flauz.workspace.listTasks': () => seam.listTasks(),
				'flauz.workspace.getTask': (args) => seam.getTask(args),
				'flauz.workspace.appendEvidence': (args) => seam.appendEvidence(args),
				'flauz.workspace.createCheckpoint': (args) => seam.createCheckpoint(args),
				'flauz.workspace.verifyLedger': () => seam.verifyLedger(),
				ping: () => ({ pong: true, ts: Date.now() }),
				shutdown: () => ({ ok: true }),
		};

		const handleLine = (line) => {
				if (line.trim().length === 0) {
						return;
				}
				let message;
				try {
						message = JSON.parse(line);
				} catch {
						send({ type: 'error', message: 'unparseable line' });
						return;
				}
				if (message.type === 'hello') {
						try {
								seam = new WorkspaceSeam(root);
								if (typeof message.globalStoragePath === 'string' && message.globalStoragePath.length > 0) {
										mkdirSync(message.globalStoragePath, { recursive: true });
										seam.relayPath = join(message.globalStoragePath, 'relay.jsonl');
								}
						} catch (error) {
								send({ type: 'error', message: `workspace init failed: ${error.message}` });
								exitOnce(3);
								return;
						}
						send({ type: 'ready', service: SERVICE_NAME, version: SERVICE_VERSION, schema: TASKS_SCHEMA });
						return;
				}
				if (typeof message.id === 'number' && typeof message.cmd === 'string') {
						if (!seam && message.cmd !== 'ping' && message.cmd !== 'shutdown') {
								send({ id: message.id, ok: false, error: 'service not ready: send hello first' });
								return;
						}
						const handler = commands[message.cmd];
						if (!handler) {
								send({ id: message.id, ok: false, error: `unknown command: ${message.cmd}` });
								return;
						}
						try {
								const result = handler(message.args ?? {});
								send({ id: message.id, ok: true, result });
								if (message.cmd === 'shutdown') {
										exitOnce(0);
								}
						} catch (error) {
								send({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
						}
						return;
				}
				send({ type: 'error', message: 'unrecognized message' });
		};

		process.stdin.setEncoding('utf-8');
		process.stdin.on('data', (chunk) => {
				buffer += chunk;
				let newline = buffer.indexOf('\n');
				while (newline !== -1) {
						const line = buffer.slice(0, newline);
						buffer = buffer.slice(newline + 1);
						handleLine(line);
						newline = buffer.indexOf('\n');
				}
		});
		const finish = () => {
				if (buffer.trim().length > 0) {
						handleLine(buffer);
						buffer = '';
				}
				exitOnce(0);
		};
		process.stdin.on('end', finish);
		process.stdin.on('close', finish);
		process.on('SIGTERM', () => exitOnce(0));

		// Nothing happens until hello arrives (handshake-first protocol).
		process.stdin.resume();
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
		main();
}
