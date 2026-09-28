/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Agent-activity checkpoints (TL2-005/M5, Worker C): signed, hash-chained
 * checkpoints tied to GRAPH MILESTONES - beyond the existing evidence-ledger
 * checkpoints (which cover ledger rows), these cover AGENT ACTIVITY: plan
 * approved, step completed, task reported, contract verified.
 *
 * NEVER FABRICATED: a checkpoint row is minted ONLY when its milestone truly
 * completed - the caller wires a MilestoneVerifier that checks the real
 * state (task envelope events, durable run envelopes, contracts), and the
 * service REFUSES to mint when the verification fails. The signature covers
 * the milestone fact {seq, milestone, taskId, agentId, payloadRef}.
 *
 * Chain discipline (DL-20 house style): rows are canonical-compact JSONL at
 * `.flauz/checkpoints.jsonl`; each row's `prev` carries the previous row's
 * hash; the user-keystore CheckpointSigner (flauz-workspace api.ts port,
 * keys.ts implementations) signs each row. verify() recomputes the whole
 * chain + every signature.
 *
 * Node-free core: IO through FileSystemPort/Clock only.
 */

import {
	type CheckpointSigner,
	type Clock,
	type FileSystemPort,
	canonicalJson,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';

/** Schema pinned into every checkpoint row. */
export const CHECKPOINTS_SCHEMA = 'flauz.checkpoints/v1';

/** Journal path, relative to the workspace root. */
export const CHECKPOINTS_PATH = '.flauz/checkpoints.jsonl';

/** The graph milestones an agent-activity checkpoint can cover. */
export const MILESTONES = ['task-created', 'plan-approved', 'step-completed', 'task-reported', 'task-signed-off', 'contract-verified'] as const;
export type Milestone = (typeof MILESTONES)[number];

export interface AgentCheckpointRow {
	readonly $schema: string;
	readonly seq: number;
	readonly id: string;
	readonly ts: number;
	readonly milestone: Milestone;
	readonly taskId: string;
	readonly agentId: string;
	/** Reference to the milestone's durable proof (event index, run id + step seq, contract id...). */
	readonly payloadRef: string;
	readonly prev: string | null;
	readonly signature: string;
}

/**
 * The no-fabrication gate: verifies that a milestone TRULY completed before
 * a checkpoint may be minted. Implementations check the real state (task
 * envelope events, durable run envelopes, delegation contracts).
 */
export interface MilestoneVerifier {
	verify(milestone: Milestone, taskId: string, payloadRef: string): Promise<boolean>;
}

export interface CheckpointOutcome {
	readonly row: AgentCheckpointRow;
	readonly id: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Canonical stored line (no trailing newline). */
export function checkpointLine(row: AgentCheckpointRow): string {
	return canonicalJson(row);
}

/** sha256 over the canonical line - the chain link value. */
export function checkpointHash(row: AgentCheckpointRow): string {
	return sha256Hex(checkpointLine(row));
}

/** Checkpoint id of a seq (the E-NNNNNN discipline). */
export function checkpointIdOf(seq: number): string {
	return `CP-${String(seq).padStart(6, '0')}`;
}

/** The signed payload bytes of a milestone fact. */
export function signedMilestoneFact(seq: number, milestone: Milestone, taskId: string, agentId: string, payloadRef: string): string {
	return canonicalJson({ agentId, milestone, payloadRef, seq, taskId });
}

function splitLines(text: string): string[] {
	if (text === '') {
		return [];
	}
	const lines = text.split('\n');
	if (lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

export interface CheckpointServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	/** The user-keystore signer (mandatory: agent-activity checkpoints are ALWAYS signed). */
	readonly signer: CheckpointSigner;
	/** The no-fabrication gate (mandatory: a checkpoint exists only when its milestone truly completed). */
	readonly verifier: MilestoneVerifier;
	readonly clock?: Clock;
}

export interface CheckpointVerifyResult {
	readonly ok: boolean;
	readonly rows: number;
	readonly firstBadSeq?: number;
	readonly reason?: string;
}

/**
 * The agent-activity checkpoint chain. Every mint goes through the
 * MilestoneVerifier; every row is signed; the chain is hash-linked.
 */
export class CheckpointService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly signer: CheckpointSigner;
	private readonly verifier: MilestoneVerifier;
	private readonly clock: Clock;

	constructor(options: CheckpointServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.signer = options.signer;
		this.verifier = options.verifier;
		this.clock = options.clock ?? (() => Date.now());
	}

	private path(): string {
		return joinPath(this.root, CHECKPOINTS_PATH);
	}

	/** Creates `.flauz/` + an empty chain when absent. Idempotent. */
	async ensure(): Promise<void> {
		if (await this.fs.readFileUtf8(this.path()) === undefined) {
			await this.fs.writeFile(this.path(), '');
		}
	}

	/**
	 * Mints a signed checkpoint for a completed milestone. REFUSES to mint
	 * when the milestone verifier cannot prove completion (no fabricated
	 * checkpoints - the hard rule).
	 */
	async checkpoint(input: { milestone: Milestone; taskId: string; agentId: string; payloadRef: string }): Promise<CheckpointOutcome> {
		if (!(MILESTONES as readonly string[]).includes(input.milestone)) {
			throw new Error(`flauz.checkpoints: milestone must be one of ${MILESTONES.join('|')} (got ${JSON.stringify(input.milestone)})`);
		}
		const verified = await this.verifier.verify(input.milestone, input.taskId, input.payloadRef);
		if (!verified) {
			throw new Error(`flauz.checkpoints: refusing to mint a '${input.milestone}' checkpoint for task ${input.taskId} (ref ${input.payloadRef}) - the milestone has NOT verifiably completed (no fabricated checkpoints)`);
		}
		const rows = await this.readRows();
		const seq = rows.length + 1;
		const prev = rows.length === 0 ? null : checkpointHash(rows[rows.length - 1] as AgentCheckpointRow);
		const signature = await this.signer.sign(seq, signedMilestoneFact(seq, input.milestone, input.taskId, input.agentId, input.payloadRef));
		const row: AgentCheckpointRow = {
			$schema: CHECKPOINTS_SCHEMA,
			seq,
			id: checkpointIdOf(seq),
			ts: this.clock(),
			milestone: input.milestone,
			taskId: input.taskId,
			agentId: input.agentId,
			payloadRef: input.payloadRef,
			prev,
			signature,
		};
		await this.fs.appendFile(this.path(), `${checkpointLine(row)}\n`);
		return { row, id: row.id };
	}

	async readRows(): Promise<AgentCheckpointRow[]> {
		const text = await this.fs.readFileUtf8(this.path()) ?? '';
		return splitLines(text).map((line, index) => this.parseRow(line, index + 1));
	}

	private parseRow(line: string, lineNo: number): AgentCheckpointRow {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (err) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)} is not valid JSON: ${(err as Error).message}`);
		}
		return this.validateRow(parsed, lineNo);
	}

	private validateRow(value: unknown, lineNo: number): AgentCheckpointRow {
		if (!isPlainObject(value)) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)} is not a JSON object`);
		}
		const required = ['$schema', 'seq', 'id', 'ts', 'milestone', 'taskId', 'agentId', 'payloadRef', 'prev', 'signature'];
		const keys = Object.keys(value);
		if (keys.length !== required.length || !required.every(key => Object.prototype.hasOwnProperty.call(value, key))) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)} must have exactly the keys [\$schema, agentId, id, milestone, payloadRef, prev, seq, signature, taskId, ts]`);
		}
		if (value.$schema !== CHECKPOINTS_SCHEMA) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: $schema must be '${CHECKPOINTS_SCHEMA}'`);
		}
		if (typeof value.seq !== 'number' || !Number.isSafeInteger(value.seq) || value.seq < 1) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: seq must be a positive integer`);
		}
		if (value.id !== checkpointIdOf(value.seq)) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: id must be '${checkpointIdOf(value.seq)}' (derived from seq)`);
		}
		const ts = value.ts;
		if (typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts <= 0) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: ts must be a positive integer`);
		}
		const milestone = value.milestone;
		if (typeof milestone !== 'string' || !(MILESTONES as readonly string[]).includes(milestone)) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: milestone must be one of ${MILESTONES.join('|')}`);
		}
		if (typeof value.taskId !== 'string' || value.taskId.length === 0) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: taskId must be a non-empty string`);
		}
		if (typeof value.agentId !== 'string' || value.agentId.length === 0) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: agentId must be a non-empty string`);
		}
		if (typeof value.payloadRef !== 'string' || value.payloadRef.length === 0) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: payloadRef must be a non-empty string`);
		}
		if (value.prev !== null && (typeof value.prev !== 'string' || !/^[0-9a-f]{64}$/.test(value.prev))) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: prev must be 64 lowercase hex or null`);
		}
		if (typeof value.signature !== 'string' || value.signature.length === 0) {
			throw new Error(`flauz.checkpoints: line ${String(lineNo)}: signature must be a non-empty string`);
		}
		return {
			$schema: CHECKPOINTS_SCHEMA,
			seq: value.seq,
			id: value.id,
			ts,
			milestone: milestone as Milestone,
			taskId: value.taskId,
			agentId: value.agentId,
			payloadRef: value.payloadRef,
			prev: value.prev,
			signature: value.signature,
		};
	}

	/** Full chain + signature recompute; reports the first bad seq. */
	async verify(): Promise<CheckpointVerifyResult> {
		const rows = await this.readRows();
		let prevHash: string | null = null;
		for (const row of rows) {
			if (row.prev !== prevHash) {
				return { ok: false, rows: rows.length, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: prev hash mismatch (chain broken or payload mutated upstream)` };
			}
			const fact = signedMilestoneFact(row.seq, row.milestone, row.taskId, row.agentId, row.payloadRef);
			const valid = await this.signer.verify(row.seq, fact, row.signature);
			if (!valid) {
				return { ok: false, rows: rows.length, firstBadSeq: row.seq, reason: `row ${String(row.seq)}: signature verification failed (forged or wrong key)` };
			}
			prevHash = checkpointHash(row);
		}
		return { ok: true, rows: rows.length };
	}
}
