/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- routing policy file + decision ledger persistence (M3).
 *
 * The policy file (`.flauz/models/routing-policy.json`) is materialized from
 * the shipped default on first run and then USER-OWNED: Flauz never rewrites
 * a policy it did not author in a session. The decision ledger
 * (`.flauz/models/routing-decisions.jsonl`) is append-only: every decision
 * is one canonical compact line, existing bytes are preserved, and decision
 * ids are derived from the ledger length (`rd-000042`) so they stay unique
 * across restarts without a coordination service.
 */

import type { Clock, FileSystemPort } from '../contract/ports.ts';
import { atomicWrite, appendJsonlLine, envelopeText, joinStatePath, readEnvelope, readJsonl, StateFileError } from '../discovery/stateFiles.ts';
import { DEFAULT_ROUTING_POLICY, ROUTING_DECISION_SCHEMA_ID, ROUTING_POLICY_SCHEMA_ID, evaluateRoutingPolicy, type RouteRequest, type RoutingDecision, type RoutingPolicyFile, type RoutingRule } from './policy.ts';

/** Typed routing-store failure. */
export class RoutingStoreError extends Error {
	readonly code: 'STORE_CORRUPT' | 'WRITE_FAILED';
	readonly path: string;

	constructor(code: 'STORE_CORRUPT' | 'WRITE_FAILED', path: string, message: string) {
		super(message);
		this.name = 'RoutingStoreError';
		this.code = code;
		this.path = path;
	}
}

function parseRule(value: Record<string, unknown>, path: string, index: number): RoutingRule {
	if (typeof value.id !== 'string' || value.id.length === 0) {
		throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].id must be a non-empty string`);
	}
	if (typeof value.description !== 'string') {
		throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].description must be a string`);
	}
	if (typeof value.priority !== 'number' || !Number.isFinite(value.priority)) {
		throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].priority must be a number`);
	}
	const ranking = value.ranking;
	if (ranking !== 'prefer-order' && ranking !== 'cost' && ranking !== 'context-fit' && ranking !== 'locality') {
		throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].ranking must be one of prefer-order|cost|context-fit|locality`);
	}
	const match: { requiresTools?: boolean; minContextWindowTokens?: number; requiresImageInput?: boolean; locality?: 'local' | 'remote'; providerId?: string; maxInputCostPerMillion?: number; enabledOnly?: boolean } = {};
	const matchRaw = value.match;
	if (matchRaw !== null && typeof matchRaw === 'object' && !Array.isArray(matchRaw)) {
		const record = matchRaw as Record<string, unknown>;
		if (record.requiresTools !== undefined) {
			if (typeof record.requiresTools !== 'boolean') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.requiresTools must be a boolean`);
			}
			match.requiresTools = record.requiresTools;
		}
		if (record.minContextWindowTokens !== undefined) {
			if (typeof record.minContextWindowTokens !== 'number') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.minContextWindowTokens must be a number`);
			}
			match.minContextWindowTokens = record.minContextWindowTokens;
		}
		if (record.requiresImageInput !== undefined) {
			if (typeof record.requiresImageInput !== 'boolean') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.requiresImageInput must be a boolean`);
			}
			match.requiresImageInput = record.requiresImageInput;
		}
		if (record.locality !== undefined) {
			if (record.locality !== 'local' && record.locality !== 'remote') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.locality must be local|remote`);
			}
			match.locality = record.locality;
		}
		if (record.providerId !== undefined) {
			if (typeof record.providerId !== 'string') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.providerId must be a string`);
			}
			match.providerId = record.providerId;
		}
		if (record.maxInputCostPerMillion !== undefined) {
			if (typeof record.maxInputCostPerMillion !== 'number') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.maxInputCostPerMillion must be a number`);
			}
			match.maxInputCostPerMillion = record.maxInputCostPerMillion;
		}
		if (record.enabledOnly !== undefined) {
			if (typeof record.enabledOnly !== 'boolean') {
				throw new RoutingStoreError('STORE_CORRUPT', path, `rules[${index}].match.enabledOnly must be a boolean`);
			}
			match.enabledOnly = record.enabledOnly;
		}
	}
	const prefer = Array.isArray(value.prefer) ? (value.prefer as unknown[]).filter((entry): entry is string => typeof entry === 'string') : undefined;
	return {
		id: value.id,
		description: value.description,
		priority: value.priority,
		match,
		ranking,
		...(prefer === undefined ? {} : { prefer }),
		...(value.fallback === undefined ? {} : { fallback: value.fallback === true }),
	};
}

/**
 * Loads the routing policy; materializes the shipped default on first run.
 * A present-but-corrupt file is a typed failure (never reinterpreted).
 */
export async function loadRoutingPolicy(fs: FileSystemPort, stateDir: string, clock: Clock): Promise<RoutingPolicyFile> {
	const path = joinStatePath(stateDir, 'routing-policy.json');
	try {
		const envelope = await readEnvelope(fs, path, ROUTING_POLICY_SCHEMA_ID);
		if (envelope === undefined) {
			const materialized: RoutingPolicyFile = { ...DEFAULT_ROUTING_POLICY, updatedAt: clock() };
			await atomicWrite(fs, path, envelopeText(materialized));
			return materialized;
		}
		if (!Array.isArray(envelope.rules)) {
			throw new StateFileError('STORE_CORRUPT', path, 'routing policy field "rules" must be an array');
		}
		const rules = (envelope.rules as unknown[]).map((entry, index) => {
			if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
				throw new StateFileError('STORE_CORRUPT', path, `rules[${index}] is not an object`);
			}
			return parseRule(entry as Record<string, unknown>, path, index);
		});
		return { schema: ROUTING_POLICY_SCHEMA_ID, schemaVersion: 0, updatedAt: typeof envelope.updatedAt === 'number' ? envelope.updatedAt : clock(), rules };
	} catch (error) {
		if (error instanceof RoutingStoreError) {
			throw error;
		}
		if (error instanceof StateFileError) {
			throw new RoutingStoreError(error.code, error.path, error.message);
		}
		throw new RoutingStoreError('WRITE_FAILED', path, error instanceof Error ? error.message : String(error));
	}
}

/** Writes a policy file (explicit authoring; the default materialization uses the same path). */
export async function saveRoutingPolicy(fs: FileSystemPort, stateDir: string, policy: RoutingPolicyFile): Promise<void> {
	await atomicWrite(fs, joinStatePath(stateDir, 'routing-policy.json'), envelopeText(policy));
}

/** The number of decisions already in the ledger (id allocation base). */
export async function decisionCount(fs: FileSystemPort, stateDir: string): Promise<number> {
	return (await readJsonl(fs, joinStatePath(stateDir, 'routing-decisions.jsonl'))).length;
}

/** Appends a decision to the ledger (append-only; existing bytes preserved). */
export async function appendDecision(fs: FileSystemPort, stateDir: string, decision: RoutingDecision): Promise<void> {
	try {
		await appendJsonlLine(fs, joinStatePath(stateDir, 'routing-decisions.jsonl'), decision as unknown as Record<string, unknown>);
	} catch (error) {
		if (error instanceof StateFileError) {
			throw new RoutingStoreError(error.code, error.path, error.message);
		}
		throw new RoutingStoreError('WRITE_FAILED', joinStatePath(stateDir, 'routing-decisions.jsonl'), error instanceof Error ? error.message : String(error));
	}
}

/** Reads the decision ledger (most recent last). */
export async function listDecisions(fs: FileSystemPort, stateDir: string): Promise<RoutingDecision[]> {
	const records = await readJsonl(fs, joinStatePath(stateDir, 'routing-decisions.jsonl'));
	return records
		.filter(record => record.schema === ROUTING_DECISION_SCHEMA_ID)
		.map(record => record as unknown as RoutingDecision);
}

/**
 * The model router: evaluates the policy against the registry, allocates a
 * durable decision id, persists the decision and returns it. Every route is
 * explained; there are no silent fallbacks (the shipped default rule IS the
 * labeled fallback).
 */
export class ModelRouter {
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly stateDir: string | undefined;
	private readonly records: () => readonly import('../discovery/registry.ts').CapabilityRecord[];
	private readonly policy: RoutingPolicyFile;

	constructor(deps: {
		readonly stateDir: string | undefined;
		readonly fs: FileSystemPort;
		readonly clock: Clock;
		readonly records: () => readonly import('../discovery/registry.ts').CapabilityRecord[];
		readonly policy: RoutingPolicyFile;
	}) {
		this.fs = deps.fs;
		this.clock = deps.clock;
		this.stateDir = deps.stateDir;
		this.records = deps.records;
		this.policy = deps.policy;
	}

	/** Routes one request: decision is evaluated, persisted and returned. */
	async route(request: RouteRequest): Promise<RoutingDecision> {
		const count = this.stateDir === undefined ? 0 : await decisionCount(this.fs, this.stateDir);
		const decision = evaluateRoutingPolicy({
			policy: this.policy,
			request,
			records: this.records(),
			decisionId: `rd-${String(count + 1).padStart(6, '0')}`,
			at: this.clock(),
		});
		if (this.stateDir !== undefined) {
			await appendDecision(this.fs, this.stateDir, decision);
		}
		return decision;
	}
}
