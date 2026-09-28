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
 * TL2-004 closure (M5): approval, takeover, claim/lease and conflict
 * operations are FIRST-CLASS transitions with EVIDENCE ROWS - each op
 * pre-validates the transition (a dry-run replay), mints ONE flauz.tasks/v0
 * ledger row (kind 'note', uri 'flauz-orch-transition://<rowId>', sha256
 * over the canonical transition facts) and embeds the minted evidenceId in
 * the journal payload. Order of guarantees:
 *   - NO ORPHANS: an illegal transition throws in the PREVIEW, before any
 *     evidence is minted (a rejected decision never lands a ledger row);
 *   - NO FABRICATION: the minted sha256 is recomputable from the journal
 *     row (payload minus evidenceId + the row's provenance fields);
 *   - NO SHIFTED LINKAGE: every evidence-bearing op runs inside the
 *     transition lock, so the rowId the evidence uri references is the
 *     rowId the append lands at (appendCandidate asserts it fail-closed);
 *   - AT LEAST ONCE: a crash between append and event sync loses at most
 *     the event, never the durable fact (the journal is primary).
 *
 * Zero-dependency (node:fs + node:crypto via orchestration.mjs). Single
 * writer per workspace (the v0 ledger assumption, documented; the async
 * public ops serialize through the transition lock so concurrent callers
 * cannot interleave a mint window).
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
	isTransitionType,
	OrchestrationError,
	eventLevel,
} from './orchestration.mjs';
import { DEFAULT_RETRY_POLICY, planRetry, classifyFailure } from './policy.mjs';

const TASK_ID_PATTERN = /^T-\d{3,}$/;

/**
 * The journal notation of a minted ledger evidence id. The flauz.tasks/v0
 * ledger identifies a row by its seq (the seam's string projection is
 * unpadded, e.g. 'E-3'); the orchestration journal records the SAME row in
 * the DL-21 E-NNNNNN discipline (evidenceIdOfLedgerSeq(3) === 'E-000003')
 * so every embedded evidence id satisfies the journal's closed pattern.
 */
function evidenceIdOfLedgerSeq(seq) {
	return `E-${String(seq).padStart(6, '0')}`;
}

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
			/** The transition-lock tail (serializes the async public ops). */
		this.lockTail = Promise.resolve();
			/** Ops INSIDE the lock body (re-entrancy signal for the appendRow guard). */
		this.lockDepth = 0;
			/** Ops WAITING to enter the lock body (contention signal for the appendRow guard). */
		this.lockWaiters = 0;
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
	 * Build one candidate row (validation + construction, NO write). Shared
	 * by appendRow, previewRow and the evidence-bearing ops - the seq/ts/
	 * rowId/prev are fixed HERE so a previewed candidate is byte-identical
	 * to the row that later lands.
	 */
	candidateRow(type, fields) {
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
		return {
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
	}

	/**
	 * Append one journal row (the ONLY write path). The candidate row is
	 * validated by a full replay of the graph's journal INCLUDING it - an
	 * illegal transition, a wrong attempt, a gated-step bypass, a fabricated
	 * completion all throw BEFORE any byte is written.
	 */
	appendRow(type, fields) {
		if (this.lockDepth > 0 || this.lockWaiters > 0) {
			throw new OrchestrationError(`${type} refused: the transition lock is held (${String(this.lockDepth)} in-flight, ${String(this.lockWaiters)} waiting) - a lock-free direct journal write is impossible while a serialized operation is in flight; route the append through the serialized store API (appendRowLocked / the locked public ops)`, 'lock-violation');
		}
		return this.appendRowInternal(type, fields);
	}

	/**
	 * The guard-free append half for callers that ALREADY hold the transition
	 * lock (the locked public ops and appendRowLocked). External code must
	 * never call this directly - the public appendRow enforces the DL-75
	 * lock-discipline guard.
	 */
	appendRowInternal(type, fields) {
		const row = this.candidateRow(type, fields);
		return this.appendCandidate(row);
	}

	/**
	 * The serialized append for async call sites (the recovery pass, the
	 * runtime drive, composed services): transition lock -> appendRow. The
	 * DL-75 discipline - no append call site writes around the lock.
	 */
	async appendRowLocked(type, fields) {
		return this.withTransitionLock(() => this.appendRowInternal(type, fields));
	}

	/**
	 * Dry-run the full appendRow validation WITHOUT writing: the candidate
	 * is replay-validated against the graph's journal (an illegal transition
	 * throws) and returned. The evidence-bearing ops preview FIRST so an
	 * illegal transition never mints an orphan ledger row.
	 */
	previewRow(type, fields) {
		const row = this.candidateRow(type, fields);
		const graph = this.requireGraph(row.graphId);
		this.assertNotStaleRun(graph, row, this.rowsFor(row.graphId));
		const verdict = deriveGraphState(graph, [...this.rowsFor(row.graphId), row]);
		if (!verdict.ok) {
			throw new OrchestrationError(`${type} rejected: ${verdict.error}`, 'illegal-transition');
		}
		return row;
	}

	/**
	 * Append one PREVIOUSLY BUILT candidate (the write half). Re-validates
	 * by replay (the payload may have gained its minted evidenceId since the
	 * preview) and asserts the seq is still the head+1 - a shifted seq means
	 * the single-writer discipline was violated and the write fails loudly
	 * instead of corrupting the chain.
	 */
	appendCandidate(candidate) {
		const graph = this.requireGraph(candidate.graphId);
		this.assertNotStaleRun(graph, candidate, this.rowsFor(candidate.graphId));
		const verdict = deriveGraphState(graph, [...this.rowsFor(candidate.graphId), candidate]);
		if (!verdict.ok) {
			throw new OrchestrationError(`${candidate.type} rejected: ${verdict.error}`, 'illegal-transition');
		}
		if (candidate.seq !== this.journalRows.length + 1 || candidate.prev !== this.headHash()) {
			throw new OrchestrationError(`${candidate.type} candidate ${candidate.rowId} no longer matches the journal head (the single-writer transition lock was violated)`, 'internal');
		}
		mkdirSync(this.dir, { recursive: true });
		appendFileSync(this.journalPath, `${journalLine(candidate)}\n`);
		this.journalRows.push(candidate);
		return candidate;
	}

	/**
	 * The typed stale-run detector (INV-3 level 3): throws the TYPED
	 * cancelled-observed outcome when `candidate` is a state-changing
	 * transition whose target graph (or step) is already terminal
	 * 'cancelled'. The replay error of the WITH-candidate derivation is
	 * embedded (the state-machine detail stays visible for diagnosis and
	 * for the pinned regression surfaces); every other illegal class is
	 * left to the caller's generic illegal-transition path.
	 */
	assertNotStaleRun(graph, candidate, rowsForGraph) {
		if (!isTransitionType(candidate.type)) {
			return;
		}
		const current = deriveGraphState(graph, rowsForGraph);
		if (!current.ok) {
			return;
		}
		const state = current.state;
		const stepCancelled = candidate.stepId !== null && state.steps[candidate.stepId] !== undefined && state.steps[candidate.stepId].status === 'cancelled';
		if (state.graphStatus !== 'cancelled' && !stepCancelled) {
			return;
		}
		const withCandidate = deriveGraphState(graph, [...rowsForGraph, candidate]);
		const detail = withCandidate.ok ? 'the transition is not applicable on a terminal cancelled target' : withCandidate.error;
		const where = stepCancelled ? `graph ${candidate.graphId} step ${String(candidate.stepId)}` : `graph ${candidate.graphId}`;
		throw new OrchestrationError(`${candidate.type} rejected: stale run observed terminal cancelled (${where}) - ${detail}; the in-flight run is stale, the recorded cancellation is the propagated terminal outcome`, 'stale-run-cancelled');
	}

	/**
	 * The transition lock: serializes the async public ops so the
	 * preview -> mint -> appendCandidate window of an evidence-bearing op
	 * can never interleave with another append (the rowId the evidence uri
	 * references is the rowId the append lands at). DL-75: waiters/depth
	 * are accounted so a lock-free direct write under contention is
	 * refused (see appendRow).
	 */
	async withTransitionLock(fn) {
		const previous = this.lockTail;
		let release;
		this.lockTail = new Promise((resolve) => {
			release = resolve;
		});
		this.lockWaiters += 1;
		await previous;
		this.lockWaiters -= 1;
		this.lockDepth += 1;
		try {
			return await fn();
		} finally {
			this.lockDepth -= 1;
			release();
		}
	}

	/**
	 * Mint the ledger evidence row of one transition (the TL2-004 linkage).
	 * The uri references the candidate's rowId; the sha256 covers the
	 * canonical transition facts WITHOUT the evidenceId (recomputable from
	 * the landed journal row). Returns null when there is no taskPort or no
	 * linked task - the journal row stays the primary record either way.
	 */
	async mintTransitionEvidence(candidate) {
		const graph = this.requireGraph(candidate.graphId);
		if (this.taskPort === null || graph.taskId === null) {
			return null;
		}
		const facts = {
			graphId: candidate.graphId,
			stepId: candidate.stepId,
			type: candidate.type,
			actor: candidate.actor,
			origin: candidate.origin,
			ts: candidate.ts,
			payload: candidate.payload,
		};
		const minted = await this.taskPort.appendEvidence({
			taskId: graph.taskId,
			row: { kind: 'note', uri: `flauz-orch-transition://${candidate.rowId}`, sha256: contentHashOf(facts) },
		});
		return evidenceIdOfLedgerSeq(minted.seq);
	}

	/**
	 * The evidence-bearing transition append: preview (no orphans) -> mint
	 * (the ledger row) -> append (the payload gains the minted evidenceId).
	 * Takes the transition lock.
	 */
	async appendEvidenceBearingRow(type, fields) {
		return this.withTransitionLock(() => this.appendEvidenceBearingRowLocked(type, fields));
	}

	/**
	 * The evidence-bearing append for a caller that ALREADY holds the
	 * transition lock (startStep's conflict notices, takeoverComplete, a
	 * composed op) - re-entering the lock would deadlock.
	 */
	async appendEvidenceBearingRowLocked(type, fields) {
		const candidate = this.previewRow(type, fields);
		const evidenceId = await this.mintTransitionEvidence(candidate);
		if (evidenceId !== null) {
			candidate.payload = { ...candidate.payload, evidenceId };
			candidate.contentHash = contentHashOf(candidate.payload);
		}
		return this.appendCandidate(candidate);
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
			minted.push({ evidenceId: evidenceIdOfLedgerSeq(result.seq), kind: item.kind, uri: item.uri, sha256: item.sha256 });
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
			// DL-75: submitGraph's journal append rides the transition lock like
			// every other append (the createTask await above opened an interleaving
			// window; the locked append closes it).
			const row = await this.withTransitionLock(() => this.appendRowInternal('graph-submitted', {
				graphId,
				actor: input.actor ?? 'agent',
				origin: input.origin ?? 'extension:flauz-agent',
				payload: { title: input.title, stepCount: steps.length, taskId },
			}));
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

	async approveGraph(input) {
		return this.withTransitionLock(() => this.appendRowInternal('graph-approved', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		}));
	}

	async rejectGraph(input) {
		return this.withTransitionLock(() => this.appendRowInternal('graph-rejected', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		}));
	}

	async completeGraph(input) {
		return this.withTransitionLock(() => this.appendRowInternal('graph-completed', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { succeededCount: Object.keys(this.stateOf(input.graphId).steps).length },
		}));
	}

	async failGraph(input) {
		return this.withTransitionLock(() => this.appendRowInternal('graph-failed', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { failedStepId: input.failedStepId },
		}));
	}

	/**
	 * Start one step attempt: validates readiness (the replay gate), checks
	 * the active claim AND the active lease (a non-holder start records
	 * conflict-noticed FIRST - v0 enforcement is informational, one notice
	 * per violation class, each with its evidence row), mints the attempt +
	 * idempotency key.
	 */
	async startStep(input) {
		return this.withTransitionLock(async () => {
			const graph = this.requireGraph(input.graphId);
			this.requireStep(graph, input.stepId);
			const state = this.stateOf(input.graphId);
			const activeClaim = state.claims[input.stepId];
			if (activeClaim !== undefined && activeClaim.holder !== input.runnerId) {
				await this.appendEvidenceBearingRowLocked('conflict-noticed', {
					graphId: input.graphId,
					stepId: input.stepId,
					actor: 'service',
					origin: input.origin,
					payload: {
						violation: 'claim',
						expectedHolder: activeClaim.holder,
						actualRunner: input.runnerId,
						note: 'v0 enforcement is informational (the hard enforcement hook is a recorded follow-up)',
					},
				});
			}
			const activeLease = state.leases[input.stepId];
			if (activeLease !== undefined && activeLease.holder !== input.runnerId) {
				await this.appendEvidenceBearingRowLocked('conflict-noticed', {
					graphId: input.graphId,
					stepId: input.stepId,
					actor: 'service',
					origin: input.origin,
					payload: {
						violation: 'lease',
						expectedHolder: activeLease.holder,
						actualRunner: input.runnerId,
						note: 'v0 enforcement is informational (the hard enforcement hook is a recorded follow-up)',
					},
				});
			}
			const stepState = state.steps[input.stepId];
			const attempt = stepState.retrySameAttempt ?? (stepState.lastStartedAttempt + 1);
			const key = idempotencyKeyOf(input.graphId, input.stepId, attempt);
			const row = this.appendRowInternal('step-started', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: input.actor ?? 'agent',
				origin: input.origin,
				attempt,
				idempotencyKey: key,
				payload: { runnerId: input.runnerId },
			});
			return { attempt, idempotencyKey: key, rowId: row.rowId };
		});
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
		return this.withTransitionLock(() => this.finishStepLocked(input));
	}

	/** The finishStep core (caller holds the transition lock). */
	async finishStepLocked(input) {
		const graph = this.requireGraph(input.graphId);
		const step = this.requireStep(graph, input.stepId);
		const state = this.stateOf(input.graphId);
		const stepState = state.steps[input.stepId];
		const attempt = input.attempt ?? stepState.lastStartedAttempt;
		if (input.outcome === 'succeeded') {
			const evidence = await this.mintEvidence(graph.taskId, input.evidence ?? []);
			return this.appendRowInternal('step-succeeded', {
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
			return this.appendRowInternal('step-failed', {
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
	async retryStep(input) {
		return this.withTransitionLock(() => this.retryStepLocked(input));
	}

	/** The retryStep core (caller holds the transition lock). */
	retryStepLocked(input) {
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
		return this.appendRowInternal('step-retry-scheduled', {
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
		return this.withTransitionLock(async () => {
			const state = this.stateOf(input.graphId);
		this.appendRowInternal('cancel-requested', {
			graphId: input.graphId,
			actor: input.actor,
			origin: input.origin,
			payload: { reason: input.reason ?? 'user cancel' },
		});
			const cancelled = [];
			for (const stepId of Object.keys(state.steps).sort()) {
				const step = state.steps[stepId];
				if (step.status !== 'succeeded' && step.status !== 'cancelled') {
					this.appendRowInternal('step-cancelled', {
						graphId: input.graphId,
						stepId,
						actor: 'service',
						origin: 'runtime:cancel-propagation',
						payload: { cause: 'user-cancel' },
					});
					cancelled.push(stepId);
				}
			}
			this.appendRowInternal('graph-cancelled', {
				graphId: input.graphId,
				actor: 'service',
				origin: 'runtime:cancel-propagation',
				payload: { reason: input.reason ?? 'user cancel' },
			});
			const graph = this.requireGraph(input.graphId);
			await this.mirrorTaskEvent(graph.taskId, { ts: this.clock(), actor: input.actor, type: 'graph-cancelled', payload: { graphId: input.graphId, reason: input.reason ?? 'user cancel' } });
			return { cancelledSteps: cancelled };
		});
	}

	/**
	 * Record an approval REQUEST (never a grant): a first-class transition
	 * with its evidence row. expiresAt (optional) arms the fail-closed
	 * timeout - only a request that carries a deadline can ever expire.
	 */
	async approvalRequest(input) {
		const payload = { reason: input.reason, ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}) };
		return this.appendEvidenceBearingRow('approval-requested', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload,
		});
	}

	/** The human decision (granted | denied) - HUMAN-ONLY by the transition table; evidence-bearing. */
	async approvalDecide(input) {
		if (input.decision !== 'granted' && input.decision !== 'denied') {
			throw new OrchestrationError(`approvalDecide decision must be 'granted' | 'denied' (got ${JSON.stringify(input.decision)})`, 'invalid-params');
		}
		const type = input.decision === 'granted' ? 'approval-granted' : 'approval-denied';
		return this.appendEvidenceBearingRow(type, {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	/**
	 * Expire a deadline-bearing pending approval (TL2-004, M5): the
	 * fail-closed timeout. SERVICE-ONLY by the transition table (a
	 * mechanical deadline observation, never a human-granted outcome): the
	 * step is CANCELLED with failure class 'approval-expired' - never
	 * auto-granted. Only a request that carries expiresAt can expire, and
	 * the observed expiry may never predate the deadline.
	 */
	async expireApproval(input) {
		const state = this.stateOf(input.graphId);
		const stepState = state.steps[input.stepId];
		const approval = stepState?.approval ?? null;
		if (approval === null || approval.state !== 'pending' || approval.expiresAt === undefined) {
			throw new OrchestrationError(`expireApproval requires a pending approval that carries expiresAt on step ${String(input.stepId)} (a request without a deadline never expires - a human must decide or the graph is cancelled)`, 'illegal-transition');
		}
		const expiredAt = input.expiredAt ?? approval.expiresAt;
		if (expiredAt < approval.expiresAt) {
			throw new OrchestrationError(`expireApproval expiredAt (${String(expiredAt)}) may not predate the request deadline (${String(approval.expiresAt)}) - the expiry must be an OBSERVED deadline passage`, 'invalid-params');
		}
		return this.appendEvidenceBearingRow('approval-expired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'service',
			origin: input.origin,
			payload: { expiredAt, ...(input.note !== undefined ? { note: input.note } : {}) },
		});
	}

	/** A takeover REQUEST (human or agent may suggest; only a human accepts) - evidence-bearing with full provenance. */
	async takeoverRequest(input) {
		return this.appendEvidenceBearingRow('takeover-requested', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.reason !== undefined ? { reason: input.reason } : {},
		});
	}

	/** The human acceptance of a takeover - HUMAN-ONLY by the transition table; evidence-bearing. */
	async takeoverAccept(input) {
		return this.appendEvidenceBearingRow('takeover-accepted', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor,
			origin: input.origin,
			payload: input.note !== undefined ? { note: input.note } : {},
		});
	}

	/** The human completion of a taken-over step: step evidence + the transition's own evidence row. */
	async takeoverComplete(input) {
		return this.withTransitionLock(async () => {
			const graph = this.requireGraph(input.graphId);
			this.requireStep(graph, input.stepId);
			const evidence = await this.mintEvidence(graph.taskId, input.evidence ?? []);
			return this.appendEvidenceBearingRowLocked('takeover-completed', {
				graphId: input.graphId,
				stepId: input.stepId,
				actor: input.actor,
				origin: input.origin,
				payload: { evidence, ...(input.summary !== undefined ? { output: input.summary } : {}) },
			});
		});
	}

	/** Acquire the exclusive step claim - the notice with its evidence row. */
	async acquireClaim(input) {
		if (!isAgentId(input.holder)) {
			throw new OrchestrationError(`acquireClaim holder must be an agent id (got ${JSON.stringify(input.holder)})`, 'invalid-params');
		}
		const claimId = claimIdOf(input.graphId, input.stepId);
		return this.appendEvidenceBearingRow('claim-acquired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { claimId, holder: input.holder },
		});
	}

	/** Release the active claim - the notice with its evidence row. */
	async releaseClaim(input) {
		const state = this.stateOf(input.graphId);
		const active = state.claims[input.stepId];
		if (active === undefined) {
			throw new OrchestrationError(`releaseClaim: no active claim on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendEvidenceBearingRow('claim-released', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { claimId: active.claimId, holder: active.holder },
		});
	}

	/** Acquire a TTL lease on the step - the notice with its evidence row. */
	async acquireLease(input) {
		if (!isAgentId(input.holder)) {
			throw new OrchestrationError(`acquireLease holder must be an agent id (got ${JSON.stringify(input.holder)})`, 'invalid-params');
		}
		if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
			throw new OrchestrationError('acquireLease ttlMs must be a positive integer (epoch ms)', 'invalid-params');
		}
		const state = this.stateOf(input.graphId);
		const ordinal = (state.leasesSeen[input.stepId] ?? 0) + 1;
		const leaseId = leaseIdOf(input.graphId, input.stepId, ordinal);
		return this.appendEvidenceBearingRow('lease-acquired', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId, holder: input.holder, expiresAt: this.clock() + input.ttlMs },
		});
	}

	/** Renew the active lease - the notice with its evidence row. */
	async renewLease(input) {
		if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0) {
			throw new OrchestrationError('renewLease ttlMs must be a positive integer (epoch ms)', 'invalid-params');
		}
		const state = this.stateOf(input.graphId);
		const lease = state.leases[input.stepId];
		if (lease === undefined) {
			throw new OrchestrationError(`renewLease: no active lease on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendEvidenceBearingRow('lease-renewed', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId: lease.leaseId, holder: lease.holder, expiresAt: this.clock() + input.ttlMs },
		});
	}

	/** Release the active lease - the notice with its evidence row. */
	async releaseLease(input) {
		const state = this.stateOf(input.graphId);
		const lease = state.leases[input.stepId];
		if (lease === undefined) {
			throw new OrchestrationError(`releaseLease: no active lease on step ${String(input.stepId)}`, 'illegal-transition');
		}
		return this.appendEvidenceBearingRow('lease-released', {
			graphId: input.graphId,
			stepId: input.stepId,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: { leaseId: lease.leaseId, holder: lease.holder },
		});
	}

	/** Record a claim/lease conflict notice (informational v0 enforcement) - evidence-bearing. */
	async noticeConflict(input) {
		return this.appendEvidenceBearingRow('conflict-noticed', {
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

	/** The durable routing decision record (WHY this agent) - locked, journal-provenance. */
	async routeDecide(input) {
		if (!isAgentId(input.targetAgent)) {
			throw new OrchestrationError(`routeDecide targetAgent must be an agent id (got ${JSON.stringify(input.targetAgent)})`, 'invalid-params');
		}
		return this.withTransitionLock(() => this.appendRowInternal('route-decided', {
			graphId: input.graphId,
			stepId: input.stepId ?? null,
			actor: input.actor ?? 'agent',
			origin: input.origin,
			payload: {
				targetAgent: input.targetAgent,
				reason: input.reason,
				...(input.details !== undefined ? { details: input.details } : {}),
			},
		}));
	}

	/** The delegation receipt linking the routing decision to the a2a message id - locked. */
	async delegationSent(input) {
		return this.withTransitionLock(() => this.appendRowInternal('delegation-sent', {
			graphId: input.graphId,
			stepId: input.stepId ?? null,
			actor: input.actor ?? 'service',
			origin: input.origin,
			payload: { decisionRowId: input.decisionRowId, messageId: input.messageId },
		}));
	}

	/** Ingest an a2a result-report for a delegated step: the receipt row, then the step transition. */
	async receiveResult(input) {
		return this.withTransitionLock(async () => {
		const receipt = this.appendRowInternal('result-received', {
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
			const state = this.stateOf(input.graphId);
			const attempt = state.steps[input.stepId].lastStartedAttempt;
			await this.finishStepLocked({
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
			const state = this.stateOf(input.graphId);
			const attempt = state.steps[input.stepId].lastStartedAttempt;
			await this.finishStepLocked({
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
		});
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
