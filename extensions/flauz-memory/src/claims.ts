/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Claims ledger + decision records (TL2-005/M5, Worker C): the DECISION-LOG
 * posture the program already uses, as DURABLE, QUERYABLE,
 * PROVENANCE-COMPLETE state.
 *
 * Claims (ARCHITECTURE-LOCK section 3 "Evidence"): every claim distinguishes
 * claimed | observed | verified | contradicted | stale | unknown. The claims
 * journal `.flauz/claims.jsonl` is append-only: each line is one REVISION of
 * a claim; the current state is derived by replay (last revision wins) -
 * restart-safe with zero extra state.
 *
 *   record()        -> revision 1 in state 'claimed'   (an actor asserts)
 *   observe()       -> 'observed'   (evidence rows linked)
 *   verify()        -> 'verified'   (the audit-heavy promotion)
 *   contradict()    -> 'contradicted' (evidence against)
 *   markStale()     -> 'stale'      (age/no-longer-current)
 *   reopen()        -> 'unknown'    (the honest reset)
 *
 * Decision records `.flauz/decisions.jsonl`: {title, context, options,
 * decision, consequences} + provenance - the shape the program's
 * DECISION-LOG documents use, machine-checkable and queryable.
 *
 * Every row carries provenance: actor, origin, contentHash (sha256 over the
 * canonical content), ts. No fabricated rows: rows exist only when a caller
 * recorded a real assertion/transition.
 *
 * Node-free core: IO through FileSystemPort/Clock only.
 */

import {
	type Actor,
	type Clock,
	type FileSystemPort,
	canonicalJson,
	joinPath,
	sha256Hex,
} from '../../flauz-workspace/src/api.ts';

/** Schema pinned into every claim revision row. */
export const CLAIMS_SCHEMA = 'flauz.claims/v1';

/** Schema pinned into every decision record row. */
export const DECISIONS_SCHEMA = 'flauz.decisions/v1';

/** Journal paths, relative to the workspace root. */
export const CLAIMS_PATH = '.flauz/claims.jsonl';
export const DECISIONS_PATH = '.flauz/decisions.jsonl';

export const CLAIM_STATES = ['claimed', 'observed', 'verified', 'contradicted', 'stale', 'unknown'] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** The legal state transitions (the claim lifecycle law). */
export const CLAIM_TRANSITIONS: Readonly<Record<ClaimState, readonly ClaimState[]>> = {
	'claimed': ['observed', 'contradicted', 'stale', 'unknown'],
	'observed': ['verified', 'contradicted', 'stale', 'unknown'],
	'verified': ['contradicted', 'stale'],
	'contradicted': ['unknown', 'stale'],
	'stale': ['unknown'],
	'unknown': ['claimed'],
};

/** Where a claim/decision came from. */
export const CLAIM_ORIGINS = ['task-event', 'ledger-row', 'a2a-message', 'human-note', 'verification', 'recovery'] as const;
export type ClaimOrigin = (typeof CLAIM_ORIGINS)[number];

export interface ClaimProvenance {
	readonly actor: Actor;
	readonly origin: ClaimOrigin;
	readonly contentHash: string;
	readonly ts: number;
	/** Optional note carrying the transition reason. */
	readonly note: string | null;
}

export interface ClaimRevision {
	readonly $schema: string;
	readonly id: string;
	readonly revision: number;
	readonly taskId: string | null;
	readonly statement: string;
	readonly state: ClaimState;
	readonly evidenceIds: readonly string[];
	readonly provenance: ClaimProvenance;
	readonly ts: number;
}

export interface DecisionOption {
	readonly label: string;
	readonly chosen: boolean;
}

export interface DecisionRecord {
	readonly $schema: string;
	readonly id: string;
	readonly title: string;
	readonly context: string;
	readonly options: readonly DecisionOption[];
	readonly decision: string;
	readonly consequences: string;
	readonly provenance: ClaimProvenance;
	readonly ts: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isActor(value: unknown): value is Actor {
	return value === 'agent' || value === 'human' || value === 'tool';
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateProvenance(value: unknown, label: string): ClaimProvenance {
	if (!isPlainObject(value) || Object.keys(value).length !== 5 || !Object.prototype.hasOwnProperty.call(value, 'actor') || !Object.prototype.hasOwnProperty.call(value, 'origin') || !Object.prototype.hasOwnProperty.call(value, 'contentHash') || !Object.prototype.hasOwnProperty.call(value, 'ts') || !Object.prototype.hasOwnProperty.call(value, 'note')) {
		throw new Error(`${label}: provenance must have exactly the keys [actor, contentHash, note, origin, ts]`);
	}
	if (!isActor(value.actor)) {
		throw new Error(`${label}: provenance.actor must be one of agent|human|tool`);
	}
	if (typeof value.origin !== 'string' || !(CLAIM_ORIGINS as readonly string[]).includes(value.origin)) {
		throw new Error(`${label}: provenance.origin must be one of ${CLAIM_ORIGINS.join('|')}`);
	}
	if (typeof value.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(value.contentHash)) {
		throw new Error(`${label}: provenance.contentHash must be 64 lowercase hex chars`);
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error(`${label}: provenance.ts must be a positive integer (epoch ms)`);
	}
	if (value.note !== null && !isNonEmptyString(value.note)) {
		throw new Error(`${label}: provenance.note must be a non-empty string or null`);
	}
	return { actor: value.actor, origin: value.origin as ClaimOrigin, contentHash: value.contentHash, ts: value.ts, note: value.note };
}

/** Strict validation of a claim revision row. */
export function validateClaimRevision(value: unknown): ClaimRevision {
	if (!isPlainObject(value) || Object.keys(value).length !== 9 || !Object.prototype.hasOwnProperty.call(value, '$schema') || !Object.prototype.hasOwnProperty.call(value, 'id') || !Object.prototype.hasOwnProperty.call(value, 'revision') || !Object.prototype.hasOwnProperty.call(value, 'taskId') || !Object.prototype.hasOwnProperty.call(value, 'statement') || !Object.prototype.hasOwnProperty.call(value, 'state') || !Object.prototype.hasOwnProperty.call(value, 'evidenceIds') || !Object.prototype.hasOwnProperty.call(value, 'provenance') || !Object.prototype.hasOwnProperty.call(value, 'ts')) {
		throw new Error('flauz.claims/v1: revision validation failed: expected exactly the keys [$schema, evidenceIds, id, provenance, revision, state, statement, taskId, ts]');
	}
	if (value.$schema !== CLAIMS_SCHEMA) {
		throw new Error(`flauz.claims/v1: $schema must be '${CLAIMS_SCHEMA}'`);
	}
	if (typeof value.id !== 'string' || !/^CL-\d{6,}$/.test(value.id)) {
		throw new Error(`flauz.claims/v1: id must match /^CL-\\d{6,}$/ (got ${JSON.stringify(value.id)})`);
	}
	if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
		throw new Error('flauz.claims/v1: revision must be a positive integer');
	}
	if (value.taskId !== null && (typeof value.taskId !== 'string' || !/^T-\d{3,}$/.test(value.taskId))) {
		throw new Error('flauz.claims/v1: taskId must match /^T-\\d{3,}$/ or be null');
	}
	if (!isNonEmptyString(value.statement)) {
		throw new Error('flauz.claims/v1: statement must be a non-empty string');
	}
	if (typeof value.state !== 'string' || !(CLAIM_STATES as readonly string[]).includes(value.state)) {
		throw new Error(`flauz.claims/v1: state must be one of ${CLAIM_STATES.join('|')}`);
	}
	if (!Array.isArray(value.evidenceIds) || !value.evidenceIds.every(id => typeof id === 'string' && /^E-\d{6,}$/.test(id as string))) {
		throw new Error('flauz.claims/v1: evidenceIds must be an array of E-NNNNNN ids');
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error('flauz.claims/v1: ts must be a positive integer (epoch ms)');
	}
	const provenance = validateProvenance(value.provenance, 'flauz.claims/v1: revision');
	return {
		$schema: CLAIMS_SCHEMA,
		id: value.id,
		revision: value.revision,
		taskId: value.taskId,
		statement: value.statement,
		state: value.state as ClaimState,
		evidenceIds: [...value.evidenceIds as string[]],
		provenance,
		ts: value.ts,
	};
}

/** Strict validation of a decision record row. */
export function validateDecisionRecord(value: unknown): DecisionRecord {
	if (!isPlainObject(value) || Object.keys(value).length !== 9 || !Object.prototype.hasOwnProperty.call(value, '$schema') || !Object.prototype.hasOwnProperty.call(value, 'id') || !Object.prototype.hasOwnProperty.call(value, 'title') || !Object.prototype.hasOwnProperty.call(value, 'context') || !Object.prototype.hasOwnProperty.call(value, 'options') || !Object.prototype.hasOwnProperty.call(value, 'decision') || !Object.prototype.hasOwnProperty.call(value, 'consequences') || !Object.prototype.hasOwnProperty.call(value, 'provenance') || !Object.prototype.hasOwnProperty.call(value, 'ts')) {
		throw new Error('flauz.decisions/v1: record validation failed: expected exactly the keys [$schema, consequences, context, decision, id, options, provenance, title, ts]');
	}
	if (value.$schema !== DECISIONS_SCHEMA) {
		throw new Error(`flauz.decisions/v1: $schema must be '${DECISIONS_SCHEMA}'`);
	}
	if (typeof value.id !== 'string' || !/^D-\d{6,}$/.test(value.id)) {
		throw new Error(`flauz.decisions/v1: id must match /^D-\\d{6,}$/`);
	}
	if (!isNonEmptyString(value.title)) {
		throw new Error('flauz.decisions/v1: title must be a non-empty string');
	}
	if (!isNonEmptyString(value.context)) {
		throw new Error('flauz.decisions/v1: context must be a non-empty string');
	}
	if (!Array.isArray(value.options) || value.options.length === 0) {
		throw new Error('flauz.decisions/v1: options must be a non-empty array');
	}
	let chosen = 0;
	const options = value.options.map((option: unknown) => {
		if (!isPlainObject(option) || Object.keys(option).length !== 2 || !Object.prototype.hasOwnProperty.call(option, 'label') || !Object.prototype.hasOwnProperty.call(option, 'chosen')) {
			throw new Error('flauz.decisions/v1: each option must have exactly the keys [chosen, label]');
		}
		if (!isNonEmptyString(option.label)) {
			throw new Error('flauz.decisions/v1: option label must be a non-empty string');
		}
		if (typeof option.chosen !== 'boolean') {
			throw new Error('flauz.decisions/v1: option chosen must be a boolean');
		}
		if (option.chosen) {
			chosen += 1;
		}
		return { label: option.label, chosen: option.chosen };
	});
	if (chosen !== 1) {
		throw new Error(`flauz.decisions/v1: exactly one option must be chosen (got ${String(chosen)})`);
	}
	if (!isNonEmptyString(value.decision)) {
		throw new Error('flauz.decisions/v1: decision must be a non-empty string (the chosen label)');
	}
	if (!options.some(option => option.label === value.decision && option.chosen)) {
		throw new Error(`flauz.decisions/v1: decision '${String(value.decision)}' must be the chosen option label`);
	}
	if (!isNonEmptyString(value.consequences)) {
		throw new Error('flauz.decisions/v1: consequences must be a non-empty string');
	}
	if (!isPositiveInteger(value.ts)) {
		throw new Error('flauz.decisions/v1: ts must be a positive integer (epoch ms)');
	}
	const provenance = validateProvenance(value.provenance, 'flauz.decisions/v1: record');
	return {
		$schema: DECISIONS_SCHEMA,
		id: value.id,
		title: value.title,
		context: value.context,
		options,
		decision: value.decision,
		consequences: value.consequences,
		provenance,
		ts: value.ts,
	};
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

export interface ClaimsServiceOptions {
	readonly root: string;
	readonly fs: FileSystemPort;
	readonly clock?: Clock;
}

export interface ClaimQuery {
	readonly state?: ClaimState;
	readonly taskId?: string;
	readonly actor?: Actor;
}

export interface DecisionQuery {
	readonly titleContains?: string;
	readonly taskId?: string | null;
}

export class ClaimsService {
	private readonly root: string;
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;

	constructor(options: ClaimsServiceOptions) {
		this.root = options.root;
		this.fs = options.fs;
		this.clock = options.clock ?? (() => Date.now());
	}

	private claimsPath(): string {
		return joinPath(this.root, CLAIMS_PATH);
	}

	private decisionsPath(): string {
		return joinPath(this.root, DECISIONS_PATH);
	}

	/** Creates the empty journals when absent. Idempotent. */
	async ensure(): Promise<void> {
		for (const path of [this.claimsPath(), this.decisionsPath()]) {
			if (await this.fs.readFileUtf8(path) === undefined) {
				await this.fs.writeFile(path, '');
			}
		}
	}

	// -- claims ---------------------------------------------------------------

	/** Records a NEW claim (revision 1, state 'claimed'). */
	async record(input: { statement: string; taskId?: string; actor: Actor; origin: ClaimOrigin; note?: string }): Promise<ClaimRevision> {
		if (!isNonEmptyString(input.statement)) {
			throw new Error('flauz.claims: statement must be a non-empty string');
		}
		const revisions = await this.readClaimRows();
		const taken = new Set(revisions.map(row => row.id));
		let n = revisions.length + 1;
		let id = `CL-${String(n).padStart(6, '0')}`;
		while (taken.has(id)) {
			n += 1;
			id = `CL-${String(n).padStart(6, '0')}`;
		}
		const now = this.clock();
		const revision: ClaimRevision = {
			$schema: CLAIMS_SCHEMA,
			id,
			revision: 1,
			taskId: input.taskId ?? null,
			statement: input.statement,
			state: 'claimed',
			evidenceIds: [],
			provenance: { actor: input.actor, origin: input.origin, contentHash: sha256Hex(input.statement), ts: now, note: input.note ?? null },
			ts: now,
		};
		await this.appendClaim(revision);
		return revision;
	}

	/** Transitions a claim (the lifecycle law enforces legality). */
	async transition(id: string, to: ClaimState, options: { actor: Actor; origin: ClaimOrigin; evidenceIds?: readonly string[]; note?: string }): Promise<ClaimRevision> {
		const current = await this.currentOf(id);
		if (current === undefined) {
			throw new Error(`flauz.claims: unknown claim '${id}'`);
		}
		const legal = CLAIM_TRANSITIONS[current.state];
		if (!legal.includes(to)) {
			throw new Error(`flauz.claims: claim ${id} cannot move '${current.state}' -> '${to}' (legal: ${legal.join(' | ')})`);
		}
		const now = this.clock();
		const revision: ClaimRevision = {
			$schema: CLAIMS_SCHEMA,
			id,
			revision: current.revision + 1,
			taskId: current.taskId,
			statement: current.statement,
			state: to,
			evidenceIds: options.evidenceIds !== undefined ? [...options.evidenceIds] : [...current.evidenceIds],
			provenance: { actor: options.actor, origin: options.origin, contentHash: current.provenance.contentHash, ts: now, note: options.note ?? null },
			ts: now,
		};
		await this.appendClaim(revision);
		return revision;
	}

	/** claim -> observed (evidence linked). */
	async observe(id: string, evidenceIds: readonly string[], options: { actor: Actor; note?: string }): Promise<ClaimRevision> {
		if (evidenceIds.length === 0) {
			throw new Error('flauz.claims: observing requires at least one evidence row (an observation without evidence stays claimed)');
		}
		return this.transition(id, 'observed', { actor: options.actor, origin: 'ledger-row', evidenceIds, note: options.note });
	}

	/** observed -> verified (the audit-heavy promotion). */
	async verify(id: string, options: { actor: Actor; note?: string }): Promise<ClaimRevision> {
		const current = await this.currentOf(id);
		if (current === undefined) {
			throw new Error(`flauz.claims: unknown claim '${id}'`);
		}
		if (current.evidenceIds.length === 0) {
			throw new Error(`flauz.claims: claim ${id} has no linked evidence - verifying requires an observed claim with evidence rows`);
		}
		return this.transition(id, 'verified', { actor: options.actor, origin: 'verification', note: options.note });
	}

	/** -> contradicted (evidence against). */
	async contradict(id: string, evidenceIds: readonly string[], options: { actor: Actor; note?: string }): Promise<ClaimRevision> {
		return this.transition(id, 'contradicted', { actor: options.actor, origin: 'ledger-row', evidenceIds, note: options.note });
	}

	/** -> stale. */
	async markStale(id: string, options: { actor: Actor; note?: string }): Promise<ClaimRevision> {
		return this.transition(id, 'stale', { actor: options.actor, origin: 'human-note', note: options.note });
	}

	/** -> unknown (the honest reset). */
	async reopen(id: string, options: { actor: Actor; note?: string }): Promise<ClaimRevision> {
		return this.transition(id, 'unknown', { actor: options.actor, origin: 'recovery', note: options.note });
	}

	/** The current revision of every claim (replay: last revision wins). */
	async listClaims(): Promise<ClaimRevision[]> {
		const rows = await this.readClaimRows();
		const latest = new Map<string, ClaimRevision>();
		for (const row of rows) {
			const existing = latest.get(row.id);
			if (existing === undefined || row.revision > existing.revision) {
				latest.set(row.id, row);
			}
		}
		return [...latest.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	/** Queryable: filter by state/taskId/actor (provenance-complete rows). */
	async queryClaims(query: ClaimQuery): Promise<ClaimRevision[]> {
		return (await this.listClaims()).filter(claim => {
			if (query.state !== undefined && claim.state !== query.state) {
				return false;
			}
			if (query.taskId !== undefined && claim.taskId !== query.taskId) {
				return false;
			}
			if (query.actor !== undefined && claim.provenance.actor !== query.actor) {
				return false;
			}
			return true;
		});
	}

	async currentOf(id: string): Promise<ClaimRevision | undefined> {
		return (await this.listClaims()).find(claim => claim.id === id);
	}

	private async readClaimRows(): Promise<ClaimRevision[]> {
		const text = await this.fs.readFileUtf8(this.claimsPath()) ?? '';
		return splitLines(text).map((line, index) => {
			try {
				return validateClaimRevision(JSON.parse(line));
			} catch (err) {
				throw new Error(`flauz.claims: journal line ${String(index + 1)}: ${(err as Error).message}`);
			}
		});
	}

	private async appendClaim(revision: ClaimRevision): Promise<void> {
		validateClaimRevision(revision);
		await this.fs.appendFile(this.claimsPath(), `${canonicalJson(revision)}\n`);
	}

	// -- decisions ------------------------------------------------------------

	/** Records a decision (the DECISION-LOG posture as durable state). */
	async decide(input: { title: string; context: string; options: readonly { label: string; chosen: boolean }[]; decision: string; consequences: string; actor: Actor; note?: string }): Promise<DecisionRecord> {
		const now = this.clock();
		const rows = await this.readDecisionRows();
		const id = `D-${String(rows.length + 1).padStart(6, '0')}`;
		const record: DecisionRecord = {
			$schema: DECISIONS_SCHEMA,
			id,
			title: input.title,
			context: input.context,
			options: input.options.map(option => ({ label: option.label, chosen: option.chosen })),
			decision: input.decision,
			consequences: input.consequences,
			provenance: { actor: input.actor, origin: 'human-note', contentHash: sha256Hex(`${input.title}\n${input.decision}`), ts: now, note: input.note ?? null },
			ts: now,
		};
		validateDecisionRecord(record);
		await this.fs.appendFile(this.decisionsPath(), `${canonicalJson(record)}\n`);
		return record;
	}

	async listDecisions(): Promise<DecisionRecord[]> {
		return (await this.readDecisionRows()).sort((a, b) => (a.id < b.id ? -1 : 1));
	}

	async queryDecisions(query: DecisionQuery): Promise<DecisionRecord[]> {
		return (await this.listDecisions()).filter(decision => {
			if (query.titleContains !== undefined && !decision.title.toLowerCase().includes(query.titleContains.toLowerCase())) {
				return false;
			}
			return true;
		});
	}

	private async readDecisionRows(): Promise<DecisionRecord[]> {
		const text = await this.fs.readFileUtf8(this.decisionsPath()) ?? '';
		return splitLines(text).map((line, index) => {
			try {
				return validateDecisionRecord(JSON.parse(line));
			} catch (err) {
				throw new Error(`flauz.decisions: journal line ${String(index + 1)}: ${(err as Error).message}`);
			}
		});
	}
}
