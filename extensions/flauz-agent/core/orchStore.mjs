/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz orchestration store (TL2-001, M1) - the stateful G-side facade.
 *
 * Owns the .flauz/orchestration/ sibling artifacts of one workspace root:
 * the graphs envelope (definitions) and the hash-chained journal (one
 * global chain across all graphs, like the evidence ledger). Every state
 * change is ONE journal row appended through core/orchestration.mjs
 * deriveGraphState replay validation - a row that could not legally have
 * happened is rejected before it ever touches the disk.
 *
 * Crash discipline (the kill-safety contract):
 *  - rows are appended with a single appendFileSync of one canonical line -
 *    a crash mid-write leaves at most a TORN TAIL; loading drops an invalid
 *    FINAL line as a crash artifact (the transition never completed) and
 *    reports it; an invalid NON-final line is corruption and fails loudly;
 *  - the graphs envelope is rewritten atomically-ish (writeFileSync of the
 *    full canonical document); submitGraph rolls the record back if its
 *    graph-submitted row cannot be appended;
 *  - logical state is ALWAYS a replay projection - recovery re-derives it,
 *    it is never cached as a source of truth.
 *
 * The optional taskPort (the WorkspaceSeam in service wiring, a fake in
 * tests) links graphs into the flauz.tasks/v0 surfaces: submitGraph creates
 * the T-task, graph milestones mirror onto the task timeline as
 * observational events (the Code OSS-native Tasks view), and finishStep
 * mints ledger evidence rows for step evidence (E-ids into the journal
 * payload - the content-hash linkage between graph and ledger).
 *
 * Zero-dependency (node:fs + node:crypto via orchestration.mjs). Single
 * writer per workspace (the v0 ledger assumption, documented).
 */

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	ORCH_GRAPHS_SCHEMA,
	ORCH_GRAPHS_PATH,
	ORCH_JOURNAL_PATH,
	ORCH_DIR,
	ORCH_ACTORS,
	JOURNAL_EVENT_TYPES,
	rowIdOf,
	rowHashOf,
	contentHashOf,
	journalLine,
	validateJournalRow,
	validateJournalPayload,
	validateGraphRecord,
	deriveGraphState,
	summarizeState,
	idempotencyKeyOf,
	claimIdOf,
	leaseIdOf,
	isStepId,
	isGraphId,
	isAgentId,
	OrchestrationError,
	eventLevel,
} from './orchestration.mjs';
import { DEFAULT_RETRY_POLICY, planRetry, classifyFailure } from './policy.mjs';

const TASK_ID_PATTERN = /^T-\d{3,}$/;

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
	return typeof value === 'string' && value.length > 0;
}

/** The exact field order of a serialized graph record (stable bytes, DL-9). */
function serializeGraphRecord(graph) {
	return {
		graphId: graph.graphId,
		taskId: graph.taskId,
		title: graph.title,
		policy: graph.policy,
		steps: graph.steps.map((step) => {
			const record = {
				stepId: step.stepId,
				title: step.title,
				instruction: step.instruction,
			};
			if (step.tool !== undefined && step.tool !== null) {
				record.tool = step.tool;
			}
			if (step.toolInput !== undefined && step.toolInput !== null) {
				record.toolInput = step.toolInput;
			}
			if (step.gate !== undefined) {
				record.gate = step.gate;
			}
			if (step.dependsOn !== undefined) {
				record.dependsOn = [...step.dependsOn];
			}
			if (step.retryPolicy !== undefined && step.retryPolicy !== null) {
				record.retryPolicy = step.retryPolicy;
			}
			if (step.routing !== undefined && step.routing !== null) {
				record.routing = step.routing;
			}
			return record;
		}),
		createdAt: graph.createdAt,
		updatedAt: graph.updatedAt,
	};
}

/**
 * The orchestration store. Constructing it loads both artifacts STRICTLY
 * (unknown keys rejected, chain verified); a torn final journal line is
 * dropped as a crash artifact and surfaced via tornTail.
 */
export class OrchestrationStore {
	constructor(root, options = {}) {
		if (!isNonEmptyString(root)) {
			throw new OrchestrationError('OrchestrationStore requires a workspace root', 'invalid-params');
		}
		this.root = root;
		this.dir = join(root, ORCH_DIR);
		this.graphsPath = join(root, ORCH_GRAPHS_PATH);
		this.journalPath = join(root, ORCH_JOURNAL_PATH);
		this.taskPort = options.taskPort ?? null;
		this.clock = options.clock ?? (() => Date.now());
		this.graphs = [];
		this.journalRows = [];
		/** The raw torn tail dropped at load (a crash artifact; surfaced by recovery). */
		this.tornTail = null;
		this.load();
	}

	// ---------------------------------------------------------------------------
	// Load / persist
	// ---------------------------------------------------------------------------

	load() {
		if (existsSync(this.graphsPath)) {
			let envelope;
			try {
				envelope = JSON.parse(readFileSync(this.graphsPath, 'utf-8'));
			} catch (error) {
				throw new OrchestrationError(`graphs envelope is not valid JSON: ${error.message}`, 'corrupt-graphs');
			}
			if (!isPlainObject(envelope) || Object.keys(envelope).length !== 2 || envelope.$schema !== ORCH_GRAPHS_SCHEMA || !Array.isArray(envelope.graphs)) {
				throw new OrchestrationError(`graphs envelope must be exactly {$schema: '${ORCH_GRAPHS_SCHEMA}', graphs: [...]}`, 'corrupt-graphs');
			}
			const ids = new Set();
			for (const graph of envelope.graphs) {
				const verdict = validateGraphRecord(graph);
				if (!verdict.ok) {
					throw new OrchestrationError(verdict.error, 'corrupt-graphs');
				}
				if (ids.has(graph.graphId)) {
					throw new OrchestrationError(`duplicate graphId ${graph.graphId}`, 'corrupt-graphs');
				}
				ids.add(graph.graphId);
			}
			this.graphs = envelope.graphs;
		}
		if (existsSync(this.journalPath)) {
			const raw = readFileSync(this.journalPath, 'utf-8');
			const lines = raw.length === 0 ? [] : raw.split('\n').filter((line) => line.length > 0);
			this.journalRows = [];
			this.tornTail = null;
			for (let index = 0; index < lines.length; index += 1) {
				const line = lines[index];
				const seq = index + 1;
				const drop = (reason) => {
					if (index !== lines.length - 1) {
						throw new OrchestrationError(`journal line ${String(seq)} is malformed: ${reason} (only the FINAL line may be a crash-torn tail)`, 'corrupt-journal');
					}
					this.tornTail = { line, reason };
				};
				let row;
				try {
					row = JSON.parse(line);
				} catch {
					drop('not valid JSON');
					break;
				}
				const verdict = validateJournalRow(row);
				if (!verdict.ok) {
					drop(verdict.error);
					break;
				}
				if (row.seq !== seq) {
					drop(`seq ${String(row.seq)} at journal position ${String(seq)}`);
					break;
				}
				if (line !== journalLine(row)) {
					drop('not canonical (byte drift - rewrite via the store only)');
					break;
				}
				const previous = this.journalRows[seq - 2];
				const expectedPrev = previous === undefined ? null : rowHashOf(previous);
				if (row.prev !== expectedPrev) {
					drop('broken hash chain (prev does not carry the previous row hash)');
					break;
				}
				this.journalRows.push(row);
			}
		}
	}

	saveGraphs() {
		mkdirSync(this.dir, { recursive: true });
		const envelope = {
			$schema: ORCH_GRAPHS_SCHEMA,
			graphs: this.graphs.map(serializeGraphRecord),
		};
		writeFileSync(this.graphsPath, JSON.stringify(envelope, null, 2) + '\n');
	}

	// ---------------------------------------------------------------------------
	// Internal helpers
	// ---------------------------------------------------------------------------

	requireGraph(graphId) {
		const graph = this.graphs.find((candidate) => candidate.graphId === graphId);
		if (!graph) {
			throw new OrchestrationError(`unknown graph: ${String(graphId)}`, 'unknown-graph');
		}
		return graph;
	}

	requireStep(graph, stepId) {
		const step = graph.steps.find((candidate) => candidate.stepId === stepId);
		if (!step) {
			throw new OrchestrationError(`unknown step ${String(stepId)} in graph ${graph.graphId}`, 'unknown-step');
		}
		return step;
	}

	rowsFor(graphId) {
		return this.journalRows.filter((row) => row.graphId === graphId);
	}

	stateOf(graphId) {
		const graph = this.requireGraph(graphId);
		const verdict = deriveGraphState(graph, this.rowsFor(graphId));
		if (!verdict.ok) {
			throw new OrchestrationError(`graph ${graphId} journal replay failed: ${verdict.error}`, 'corrupt-journal');
		}
		return verdict.state;
	}

	headHash() {
		return this.journalRows.length === 0 ? null : rowHashOf(this.journalRows[this.journalRows.length - 1]);
	}

	/**
	 * Append one journal row (the ONLY write path). The candidate row is
	 * validated by a full replay of the graph's journal INCLUDING it - an
	 * illegal transition, a wrong attempt, a gated-step bypass, a fabricated
	 * completion all throw BEFORE any byte is written.
	 */
	appendRow(type, fields) {
		if (!JOURNAL_EVENT_TYPES.includes(type)) {
			throw new OrchestrationError(`unknown journal event type '${String(type)}'`, 'invalid-params');
		}
		if (!ORCH_ACTORS.includes(fields.actor)) {
			throw new OrchestrationError(`actor must be one of ${ORCH_ACTORS.join(' | ')}, got '${String(fields.actor)}'`, 'invalid-params');
		}
		if (!isNonEmptyString(fields.origin)) {
			throw new OrchestrationError('origin must be a non-empty provenance string (e.g. extension:flauz-agent, service:recovery, a2a:<agentId>)', 'invalid-params');
		}
		const graph = this.requireGraph(fields.graphId);
		if (fields.stepId !== undefined && fields.stepId !== null) {
			this.requireStep(graph, fields.stepId);
		}
		const level = eventLevel(type);
		if (level === 'graph' && fields.stepId != null) {
			throw new OrchestrationError(`${type} is graph-level (stepId must be null)`, 'invalid-params');
		}
		if (level === 'step' && !isStepId(fields.stepId)) {
			throw new OrchestrationError(`${type} is step-level (stepId required)`, 'invalid-params');
		}
		const payloadError = validateJournalPayload(type, fields.payload ?? {});
		if (payloadError !== undefined) {
			throw new OrchestrationError(`${type}: ${payloadError}`, 'invalid-params');
		}
		const seq = this.journalRows.length + 1;
		const row = {
			$schema: 'flauz.orch.journal/v1',
			seq,
			rowId: rowIdOf(seq),
			ts: typeof fields.ts === 'number' ? fields.ts : this.clock(),
			graphId: fields.graphId,
			stepId: fields.stepId ?? null,
			type,
			actor: fields.actor,
			origin: fields.origin,
			attempt: fields.attempt ?? null,
			idempotencyKey: fields.idempotencyKey ?? null,
			payload: fields.payload ?? {},
			contentHash: contentHashOf(fields.payload ?? {}),
			prev: this.headHash(),
		};
		const verdict = deriveGraphState(graph, [...this.rowsFor(fields.graphId), row]);
		if (!verdict.ok) {
			throw new OrchestrationError(`${type} rejected: ${verdict.error}`, 'illegal-transition');
		}
		mkdirSync(this.dir, { recursive: true });
		appendFileSync(this.journalPath, `${journalLine(row)}\n`);
		this.journalRows.push(row);
		return row;
	}

	/** The effective retry policy of a step (step override, else graph default, else house default). */
	policyFor(graph, step) {
		if (step.retryPolicy) {
			return step.retryPolicy;
		}
		if (graph.policy && graph.policy.defaultRetryPolicy) {
			return graph.policy.defaultRetryPolicy;
		}
		return DEFAULT_RETRY_POLICY;
	}

	/** Mint ledger evidence rows for step evidence (the taskPort linkage); without a port the items pass through un-minted. */
	async mintEvidence(taskId, items) {
		if (this.taskPort === null || taskId === null || !Array.isArray(items) || items.length === 0) {
			return (items ?? []).map((item) => ({ evidenceId: null, kind: item.kind, uri: item.uri, sha256: item.sha256 }));
		}
		const minted = [];
		for (const item of items) {
			const result = await this.taskPort.appendEvidence({ taskId, row: { kind: item.kind, uri: item.uri, sha256: item.sha256 } });
			minted.push({ evidenceId: result.evidenceId, kind: item.kind, uri: item.uri, sha256: item.sha256 });
		}
		return minted;
	}

	/** Mirror a graph milestone onto the flauz.tasks/v0 task timeline (observational event; the Tasks view surface). */
	async mirrorTaskEvent(taskId, event) {
		if (this.taskPort === null || taskId === null) {
			return;
		}
		await this.taskPort.appendEvent({ taskId, event });
	}

	// ---------------------------------------------------------------------------
	// Public operations (the runtime + service facade)
	// ---------------------------------------------------------------------------

	/**
	 * Submit a durable task graph: mint the T-task (taskPort), persist the
	 * definition, append graph-submitted. Steps: [{stepId, title,
	 * instruction, tool?, toolInput?, gate?, dependsOn?, retryPolicy?,
	 * routing?}] (validated by validateGraphRecord).
	 */
	async submitGraph(input) {
		if (!isPlainObject(input) || !isNonEmptyString(input.title)) {
			throw new OrchestrationError('submitGraph requires {title, steps, policy?, actor, origin}', 'invalid-params');
		}
		if (!Array.isArray(input.steps) || input.steps.length === 0) {
			throw new OrchestrationError('submitGraph requires a non-empty steps array', 'invalid-params');
		}
		let taskId = input.taskId ?? null;
		if (taskId !== null && !TASK_ID_PATTERN.test(taskId)) {
			throw new OrchestrationError('submitGraph taskId must match /^T-\\d{3,}$/ or be null', 'invalid-params');
		}
		if (taskId === null && this.taskPort !== null) {
			const created = await this.taskPort.createTask({ title: input.title });
			taskId = created.taskId;
		}
		const now = this.clock();
		let max = 0;
		for (const graph of this.graphs) {
			const match = /^G-(\d+)$/.exec(graph.graphId);
			if (match) {
				max = Math.max(max, Number.parseInt(match[1], 10));
			}
		}
		const graphId = `G-${String(max + 1).padStart(3, '0')}`;
		const steps = input.steps.map((step) => ({
			stepId: step.stepId,
			title: step.title,
			instruction: step.instruction,
			...(step.tool !== undefined ? { tool: step.tool } : {}),
			...(step.toolInput !== undefined ? { toolInput: step.toolInput } : {}),
			...(step.gate !== undefined ? { gate: step.gate } : {}),
			...(step.dependsOn !== undefined ? { dependsOn: [...step.dependsOn] } : {}),
			...(step.retryPolicy !== undefined ? { retryPolicy: step.retryPolicy } : {}),
			...(step.routing !== undefined ? { routing: step.routing } : {}),
		}));
		const record = {
			graphId,
			taskId,
			title: input.title,
			policy: input.policy ?? {},
			steps,
			createdAt: now,
			updatedAt: now,
		};
		const verdict = validateGraphRecord(record);
		if (!verdict.ok) {
			throw new OrchestrationError(verdict.error, 'invalid-params');
		}
		this.graphs.push(record);
		try {
			this.saveGraphs();
		} catch (error) {
			this.graphs.pop();
			throw new OrchestrationError(`graph envelope write failed: ${error.message}`, 'internal');
		}
		try {
			const row = this.appendRow('graph-submitted', {
				graphId,
				actor: input.actor ?? 'agent',
				origin: input.origin ?? 'extension:flauz-agent',
				payload: { title: input.title, stepCount: steps.length, taskId },
			});
			await this.mirrorTaskEvent(taskId, { ts: this.clock(), actor: input.actor ?? 'agent', type: 'graph-submitted', payload: { graphId, rowId: row.rowId } });
			return { graphId, taskId, stepIds: steps.map((step) => step.stepId), rowId: row.rowId };
		} catch (error) {
			// Roll the definition back so a failed submit leaves no orphan draft.
			const index = this.graphs.indexOf(record);
			if (index >= 0) {
				this.graphs.splice(index, 1);
				try {
					this.saveGraphs();
				} catch {
					// The journal row never landed; the rolled-back envelope is the
					// best-effort state (documented v0 single-writer limitation).
				}
			}
			throw error;
		}
	}

	approveGraph(input) {
		return this.appendRow('graph-approved', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	rejectGraph(input) {
		return this.appendRow('graph-rejected', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	completeGraph(input) {
		return this.appendRow('graph-completed', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { succeededCount: Object.keys(this.stateOf(input.graphId).steps).length },
		});
	}

	failGraph(input) {
		return this.appendRow('graph-failed', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { failedStepId: input.failedStepId },
		});
	}

	/**
	 * Start one step attempt: validates readiness (the replay gate), checks
	 * the active claim (a non-holder start records conflict-noticed FIRST -
	 * v0 enforcement is informational), mints the attempt + idempotency key.
	 */
	startStep(input) {
		const graph = this.requireGraph(input.graphId);
		const step = this.requireStep(graph, input.stepId);
		const state = this.stateOf(input.graphId);
		const active = state.claims[input.stepId];
		if (active !== undefined && active.holder !== input.runnerId) {
			this.appendRow('conflict-noticed', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: 'service',
				origin: input.origin,
				payload: {
					violation: 'claim',
					expectedHolder: active.holder,
					actualRunner: input.runnerId,
					note: 'v0 enforcement is informational (the hard enforcement hook is a recorded follow-up)',
				},
			});
		}
		const stepState = state.steps[input.stepId];
		const attempt = stepState.retrySameAttempt ?? (stepState.lastStartedAttempt + 1);
		const key = idempotencyKeyOf(input.graphId, input.stepId, attempt);
		const row = this.appendRow('step-started', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			attempt,
			idempotencyKey: key,
			payload: { runnerId: input.runnerId },
		});
		return { attempt, idempotencyKey: key, rowId: row.rowId };
	}

	/**
	 * Finish one step attempt. outcome 'succeeded' mints ledger evidence
	 * (taskPort); outcome 'failed' classifies the failure and (unless the
	 * caller pinned retryPlanned) applies the step's retry policy. The
	 * follow-up step-retry-scheduled row is appended by retryStep()/the
	 * runtime - crash between the two is recoverable (the runtime re-derives
	 * the pending retry from the failed row's retryPlanned).
	 */
	async finishStep(input) {
		const graph = this.requireGraph(input.graphId);
		const step = this.requireStep(graph, input.stepId);
		const state = this.stateOf(input.graphId);
		const stepState = state.steps[input.stepId];
		const attempt = input.attempt ?? stepState.lastStartedAttempt;
		if (input.outcome === 'succeeded') {
			const evidence = await this.mintEvidence(graph.taskId, input.evidence ?? []);
			return this.appendRow('step-succeeded', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: input.actor ?? 'agent',
				origin: input.origin,
				attempt,
				payload: { evidence, ...(input.output !== undefined ? { output: input.output } : {}) },
			});
		}
		if (input.outcome === 'failed') {
			const failureClass = input.failureClass ?? classifyFailure(input.error);
			const policy = this.policyFor(graph, step);
			const planned = input.retryPlanned ?? planRetry({ policy, attempt, failureClass, now: this.clock() }).retry;
			return this.appendRow('step-failed', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: input.actor ?? 'agent',
				origin: input.origin,
				attempt,
				payload: {
					failureClass,
					message: input.message ?? (input.error instanceof Error ? input.error.message : String(input.error ?? 'step failed')),
					retryPlanned: planned,
				},
			});
		}
		throw new OrchestrationError(`finishStep outcome must be 'succeeded' | 'failed' (got ${JSON.stringify(input.outcome)})`, 'invalid-params');
	}

	/** Schedule the retry of a failed step (policy backoff; nextAttempt = last + 1). */
	retryStep(input) {
		const graph = this.requireGraph(input.graphId);
		const step = this.requireStep(graph, input.stepId);
		const state = this.stateOf(input.graphId);
		const stepState = state.steps[input.stepId];
		if (stepState.status !== 'failed') {
			throw new OrchestrationError(`retryStep requires step status 'failed' (got '${String(stepState.status)}')`, 'illegal-transition');
		}
		const policy = this.policyFor(graph, step);
		const plan = planRetry({ policy, attempt: stepState.lastStartedAttempt, failureClass: stepState.failure?.class ?? 'unknown-default', now: this.clock() });
		if (!plan.retry) {
			throw new OrchestrationError(`retryStep: the retry policy refuses a retry (${plan.reason})`, 'illegal-transition');
		}
		return this.appendRow('step-retry-scheduled', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'service',
			origin: input.origin,
			payload: { nextAttempt: plan.nextAttempt, nextAttemptAt: plan.nextAttemptAt },
		});
	}

	/**
	 * Cancel a graph coherently: cancel-requested (human), one
	 * step-cancelled per non-terminal step (service, propagated), then
	 * graph-cancelled. The persisted cancellation record survives crashes -
	 * recovery continues an interrupted sweep (core/recovery.mjs).
	 */
	async cancelGraph(input) {
		const state = this.stateOf(input.graphId);
		this.appendRow('cancel-requested', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { reason: input.reason ?? 'user cancel' },
		});
		const cancelled = [];
		for (const stepId of Object.keys(state.steps).sort()) {
			const step = state.steps[stepId];
			if (step.status !== 'succeeded' && step.status !== 'cancelled') {
				this.appendRow('step-cancelled', {
					graphId: input.graphId,
					stepId,
					actor: 'service',
					origin: 'runtime:cancel-propagation',
					payload: { cause: 'user-cancel' },
				});
				cancelled.push(stepId);
			}
		}
		this.appendRow('graph-cancelled', {
			graphId: input.graphId,
			actor: 'service',
			origin: 'runtime:cancel-propagation',
			payload: { reason: input.reason ?? 'user cancel' },
		});
		const graph = this.requireGraph(input.graphId);
		await this.mirrorTaskEvent(graph.taskId, { ts: this.clock(), actor: input.actor, type: 'graph-cancelled', payload: { graphId: input.graphId, reason: input.reason ?? 'user cancel' } });
		return { cancelledSteps: cancelled };
	}

	approvalRequest(input) {
		return this.appendRow('approval-requested', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { reason: input.reason },
		});
	}

	approvalDecide(input) {
		const type = input.decision === 'granted' ? 'approval-granted' : 'approval-denied';
		if (input.decision !== 'granted' && input.decision !== 'denied') {
			throw new OrchestrationError(`approvalDecide decision must be 'granted' | 'denied' (got ${JSON.stringify(input.decision)})`, 'invalid-params');
		}
		return this.appendRow(type, {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	takeoverRequest(input) {
		return this.appendRow('takeover-requested', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.reason !== undefined ? { reason: input.reason } : {},
		});
	}

	takeoverAccept(input) {
		return this.appendRow('takeover-accepted', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	async takeoverComplete(input) {
		const graph = this.requireGraph(input.graphId);
		this.requireStep(graph, input.stepId);
		const evidence = await this.mintEvidence(graph.taskId, input.evidence ?? []);
		return this.appendRow('takeover-completed', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: { evidence, ...(input.summary !== undefined ? { output: input.summary } : {}) },
		});
	}

	acquireClaim(input) {
		if (!isAgentId(input.holder)) {
			throw new OrchestrationError(`acquireClaim holder must be an agent id (got ${JSON.stringify(input.holder)})`, 'invalid-params');
		}
		const claimId = claimIdOf(input.graphId, input.stepId);
		return this.appendRow('claim-acquired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { claimId, holder: input.holder },
		});
	}

	releaseClaim(input) {
		const state = this.stateOf(input.graphId);
		const active = state.claims[input.stepId];
		if (active === undefined) {
			throw new OrchestrationError(`releaseClaim: no active claim on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendRow('claim-released', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { claimId: active.claimId, holder: active.holder },
		});
	}

	acquireLease(input) {
		if (!isAgentId(input.holder)) {
			throw new OrchestrationError(`acquireLease holder must be an agent id (got ${JSON.stringify(input.holder)})`, 'invalid-params');
		}
		if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
			throw new OrchestrationError('acquireLease ttlMs must be a positive integer (epoch ms)', 'invalid-params');
		}
		const state = this.stateOf(input.graphId);
		const ordinal = (state.leasesSeen[input.stepId] ?? 0) + 1;
		const leaseId = leaseIdOf(input.graphId, input.stepId, ordinal);
		return this.appendRow('lease-acquired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId, holder: input.holder, expiresAt: this.clock() + input.ttlMs },
		});
	}

	renewLease(input) {
		if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
			throw new OrchestrationError('renewLease ttlMs must be a positive integer (epoch ms)', 'invalid-params');
		}
		const state = this.stateOf(input.graphId);
		const lease = state.leases[input.stepId];
		if (lease === undefined) {
			throw new OrchestrationError(`renewLease: no active lease on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendRow('lease-renewed', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId: lease.leaseId, holder: lease.holder, expiresAt: this.clock() + input.ttlMs },
		});
	}

	releaseLease(input) {
		const state = this.stateOf(input.graphId);
		const lease = state.leases[input.stepId];
		if (lease === undefined) {
			throw new OrchestrationError(`releaseLease: no active lease on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendRow('lease-released', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId: lease.leaseId, holder: lease.holder },
		});
	}

	noticeConflict(input) {
		return this.appendRow('conflict-noticed', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'service',
			origin: input.origin,
			payload: {
				violation: input.violation,
				expectedHolder: input.expectedHolder,
				actualRunner: input.actualRunner,
				...(input.note !== undefined ? { note: input.note } : {}),
			},
		});
	}

	routeDecide(input) {
		if (!isAgentId(input.targetAgent)) {
			throw new OrchestrationError(`routeDecide targetAgent must be an agent id (got ${JSON.stringify(input.targetAgent)})`, 'invalid-params');
		}
		return this.appendRow('route-decided', {
			graphId: input.graphId,
			stepId: input.stepId ?? null,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: {
				targetAgent: input.targetAgent,
				reason: input.reason,
				...(input.details !== undefined ? { details: input.details } : {}),
			},
		});
	}

	delegationSent(input) {
		return this.appendRow('delegation-sent', {
			graphId: input.graphId,
			stepId: input.stepId ?? null,
			actor: input.actor ?? 'service',
			origin: input.origin,
			payload: { decisionRowId: input.decisionRowId, messageId: input.messageId },
		});
	}

	/** Ingest an a2a result-report for a delegated step: the receipt row, then the step transition. */
	async receiveResult(input) {
		const receipt = this.appendRow('result-received', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: {
				messageId: input.messageId,
				outcome: input.outcome,
				summary: input.summary,
				evidenceIds: input.evidenceIds ?? [],
			},
		});
		if (input.outcome === 'ok') {
			const graph = this.requireGraph(input.graphId);
			const state = this.stateOf(input.graphId);
			const attempt = state.steps[input.stepId].lastStartedAttempt;
			await this.finishStep({
				graphId: input.graphId,
				stepId: input.stepId,
				attempt,
				outcome: 'succeeded',
				actor: input.actor ?? 'agent',
				origin: input.origin,
				output: input.summary,
				evidence: [],
			});
		} else if (input.outcome === 'failed') {
			const graph = this.requireGraph(input.graphId);
			const state = this.stateOf(input.graphId);
			const attempt = state.steps[input.stepId].lastStartedAttempt;
			await this.finishStep({
				graphId: input.graphId,
				stepId: input.stepId,
				attempt,
				outcome: 'failed',
				actor: input.actor ?? 'agent',
				origin: input.origin,
				message: input.summary,
				failureClass: 'unknown-default',
			});
		}
		// outcome 'cancelled': the receipt is the record; the step transition is
		// the caller's (cancel propagation already owns step-cancelled rows).
		return receipt;
	}

	// ---------------------------------------------------------------------------
	// Projections
	// ---------------------------------------------------------------------------

	getGraphState(graphId) {
		return summarizeState(this.stateOf(graphId));
	}

	listGraphs() {
		return this.graphs.map((graph) => {
			const state = this.stateOf(graph.graphId);
			return {
				graphId: graph.graphId,
				taskId: graph.taskId,
				title: graph.title,
				graphStatus: state.graphStatus,
				execution: state.derived,
			};
		});
	}

	verifyJournal() {
		let prevHash = null;
		for (let index = 0; index < this.journalRows.length; index += 1) {
			const row = this.journalRows[index];
			if (row.seq !== index + 1 || row.prev !== prevHash) {
				return { ok: false, rows: index, firstBadSeq: index + 1 };
			}
			prevHash = rowHashOf(row);
		}
		return { ok: true, rows: this.journalRows.length };
	}
}
