/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the model capability registry (M3).
 *
 * Discovery: the registry of available providers/models with capability
 * records, persisted under `.flauz/models/capabilities.json`
 * (`flauz.model-capabilities/v0`, canonical envelope, atomic writes) and
 * RECOVERED FROM DISK on restart -- no lost capability state. The compiled
 * snapshot merges three provenance layers, each labeled on the record:
 *
 *   - 'code-default'    the built-in provider catalog (src/discovery/configs.ts);
 *   - 'providers-file'  workspace overrides/additions (`.flauz/models/providers.json`);
 *   - 'discovered'      records added at runtime through recordDiscovery()
 *                       (e.g. a future live model-list probe), durable.
 *
 * `query()` is the capability-query seam the orchestration layer (Worker A)
 * and the routing policy consume; `toAdapterConfigs()` is the seam the
 * extension activation uses to build the real adapters.
 *
 * STRICT parsing: a corrupt capabilities file is a typed RegistryError --
 * never silently reinterpreted (the activation layer falls back to the
 * in-memory code defaults and reports the failure; the durable artifact is
 * NOT overwritten until it parses again).
 */

import type { Clock, FileSystemPort } from '../contract/ports.ts';
import type { AdapterConfig } from '../adapters/common.ts';
import type { Modality, WireFamily } from '../contract/types.ts';
import { DEFAULT_PROVIDER_CONFIGS, loadProviderOverrides, mergeProviderConfigs, type ProviderConfigRecord } from './configs.ts';
import { atomicWrite, envelopeText, joinStatePath, readEnvelope, StateFileError } from './stateFiles.ts';

/** Schema id pinned into the capabilities snapshot. */
export const CAPABILITIES_SCHEMA_ID = 'flauz.model-capabilities/v0';

/** Default workspace state dir for this extension's durable files. */
export const MODELS_STATE_DIR = '.flauz/models';

/** Typed registry failure. */
export class RegistryError extends Error {
	readonly code: 'STORE_CORRUPT' | 'WRITE_FAILED' | 'BAD_DISCOVERY';
	readonly path: string;

	constructor(code: 'STORE_CORRUPT' | 'WRITE_FAILED' | 'BAD_DISCOVERY', path: string, message: string) {
		super(message);
		this.name = 'RegistryError';
		this.code = code;
		this.path = path;
	}
}

/** One durable capability record (provider x model). */
export interface CapabilityRecord {
	readonly providerId: string;
	readonly vendor: string;
	readonly modelId: string;
	readonly modelName: string;
	readonly family: string;
	readonly version: string;
	readonly wireFamily: WireFamily;
	readonly locality: 'local' | 'remote';
	readonly enabled: boolean;
	readonly contextWindowTokens: number;
	readonly maxOutputTokens: number;
	readonly inputModalities: readonly Modality[];
	readonly toolCalling: boolean | number;
	readonly tokenCounting: 'estimated' | 'provider-reported' | 'both';
	readonly streaming: boolean;
	readonly credentialConfigured: boolean;
	readonly source: 'code-default' | 'providers-file' | 'discovered';
	readonly updatedAt: number;
	readonly cost?: { readonly currency: 'USD' | 'credits'; readonly inputPerMillion?: number; readonly outputPerMillion?: number; readonly cacheReadPerMillion?: number; readonly cacheWritePerMillion?: number };
}

/** The capability query (the discovery seam for orchestration + routing). */
export interface CapabilityQuery {
	readonly requiresTools?: boolean;
	readonly minContextWindowTokens?: number;
	readonly requiresImageInput?: boolean;
	readonly locality?: 'local' | 'remote';
	readonly providerId?: string;
	readonly maxInputCostPerMillion?: number;
	readonly enabledOnly?: boolean;
}

function recordFromConfig(config: ProviderConfigRecord, model: CapabilityRecordSourceModel, updatedAt: number): CapabilityRecord {
	return {
		providerId: config.providerId,
		vendor: config.vendor,
		modelId: model.modelId,
		modelName: model.modelName,
		family: model.family,
		version: model.version,
		wireFamily: config.wireFamily,
		locality: config.locality,
		enabled: config.enabled,
		contextWindowTokens: model.contextWindowTokens,
		maxOutputTokens: model.maxOutputTokens,
		inputModalities: model.inputModalities,
		toolCalling: model.toolCalling,
		tokenCounting: config.wireFamily === 'mock-echo' ? 'estimated' : 'both',
		streaming: true,
		credentialConfigured: config.credentialRef !== undefined,
		source: config.source,
		updatedAt,
		...(model.cost === undefined ? {} : { cost: model.cost }),
	};
}

/** The per-model fields a record is built from (a ModelDescriptor view). */
interface CapabilityRecordSourceModel {
	readonly modelId: string;
	readonly modelName: string;
	readonly family: string;
	readonly version: string;
	readonly contextWindowTokens: number;
	readonly maxOutputTokens: number;
	readonly inputModalities: readonly Modality[];
	readonly toolCalling: boolean | number;
	readonly cost?: CapabilityRecord['cost'];
}

function parseRecord(value: Record<string, unknown>, path: string): CapabilityRecord {
	const stringFields = ['providerId', 'vendor', 'modelId', 'modelName', 'family', 'version', 'wireFamily', 'locality', 'source', 'tokenCounting'];
	for (const field of stringFields) {
		if (typeof value[field] !== 'string' || (value[field] as string).length === 0) {
			throw new RegistryError('STORE_CORRUPT', path, `${path}: capability record field '${field}' is missing or not a string`);
		}
	}
	const numberFields = ['contextWindowTokens', 'maxOutputTokens', 'updatedAt'];
	for (const field of numberFields) {
		if (typeof value[field] !== 'number' || !Number.isFinite(value[field] as number)) {
			throw new RegistryError('STORE_CORRUPT', path, `${path}: capability record field '${field}' is missing or not a number`);
		}
	}
	if (typeof value.enabled !== 'boolean' || typeof value.credentialConfigured !== 'boolean' || typeof value.streaming !== 'boolean') {
		throw new RegistryError('STORE_CORRUPT', path, `${path}: capability record boolean fields are missing`);
	}
	const wireFamily = value.wireFamily as CapabilityRecord['wireFamily'];
	if (wireFamily !== 'openai-chat-completions' && wireFamily !== 'anthropic-messages' && wireFamily !== 'ollama-chat' && wireFamily !== 'mock-echo') {
		throw new RegistryError('STORE_CORRUPT', path, `${path}: capability record has unknown wireFamily '${wireFamily}'`);
	}
	const source = value.source as CapabilityRecord['source'];
	if (source !== 'code-default' && source !== 'providers-file' && source !== 'discovered') {
		throw new RegistryError('STORE_CORRUPT', path, `${path}: capability record has unknown source '${source}'`);
	}
	const toolCallingRaw = value.toolCalling;
	const toolCalling = typeof toolCallingRaw === 'boolean' || typeof toolCallingRaw === 'number' ? toolCallingRaw : false;
	const modalities = Array.isArray(value.inputModalities) ? (value.inputModalities as unknown[]).filter((entry): entry is 'text' | 'image' => entry === 'text' || entry === 'image') : [];
	const costRaw = value.cost;
	const cost = costRaw !== null && typeof costRaw === 'object' && !Array.isArray(costRaw)
		? {
			currency: (costRaw as Record<string, unknown>).currency === 'credits' ? ('credits' as const) : ('USD' as const),
			...numericSubset(costRaw as Record<string, unknown>),
		}
		: undefined;
	return {
		providerId: value.providerId as string,
		vendor: value.vendor as string,
		modelId: value.modelId as string,
		modelName: value.modelName as string,
		family: value.family as string,
		version: value.version as string,
		wireFamily,
		locality: value.locality === 'remote' ? 'remote' : 'local',
		enabled: value.enabled as boolean,
		contextWindowTokens: value.contextWindowTokens as number,
		maxOutputTokens: value.maxOutputTokens as number,
		inputModalities: modalities,
		toolCalling,
		tokenCounting: value.tokenCounting as CapabilityRecord['tokenCounting'],
		streaming: value.streaming as boolean,
		credentialConfigured: value.credentialConfigured as boolean,
		source,
		updatedAt: value.updatedAt as number,
		...(cost === undefined ? {} : { cost }),
	};
}

function numericSubset(record: Record<string, unknown>): { inputPerMillion?: number; outputPerMillion?: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number } {
	const result: { inputPerMillion?: number; outputPerMillion?: number; cacheReadPerMillion?: number; cacheWritePerMillion?: number } = {};
	for (const key of ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion'] as const) {
		const value = record[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * The durable model capability registry. `root` is the workspace root (or
 * undefined for an in-memory registry -- the no-workspace activation
 * posture, which is honest degraded state, never a silent one).
 */
export class ModelCapabilityRegistry {
	private readonly fs: FileSystemPort;
	private readonly clock: Clock;
	private readonly stateDir: string | undefined;
	private records: readonly CapabilityRecord[] = [];
	private mergedConfigs: readonly ProviderConfigRecord[] = DEFAULT_PROVIDER_CONFIGS;
	private loaded = false;

	constructor(deps: { readonly root: string | undefined; readonly fs: FileSystemPort; readonly clock: Clock }) {
		this.fs = deps.fs;
		this.clock = deps.clock;
		this.stateDir = deps.root === undefined ? undefined : joinStatePath(deps.root, MODELS_STATE_DIR);
	}

	/** Loads (and if needed materializes) the durable capability state. */
	async load(): Promise<void> {
		if (this.stateDir === undefined) {
			this.records = this.compileDefaults();
			this.mergedConfigs = [...DEFAULT_PROVIDER_CONFIGS];
			this.loaded = true;
			return;
		}
		const snapshotPath = joinStatePath(this.stateDir, 'capabilities.json');
		let overrides;
		try {
			overrides = await loadProviderOverrides(this.fs, this.stateDir);
		} catch (error) {
			throw new RegistryError('STORE_CORRUPT', joinStatePath(this.stateDir, 'providers.json'), error instanceof Error ? error.message : String(error));
		}
		const defaults = this.compileDefaults(overrides.overrides);
		this.mergedConfigs = mergeProviderConfigs(DEFAULT_PROVIDER_CONFIGS, overrides.overrides);
		let diskRecords: CapabilityRecord[] | undefined;
		try {
			const envelope = await readEnvelope(this.fs, snapshotPath, CAPABILITIES_SCHEMA_ID);
			if (envelope !== undefined) {
				if (!Array.isArray(envelope.records)) {
					throw new StateFileError('STORE_CORRUPT', snapshotPath, 'capabilities snapshot field "records" must be an array');
				}
				diskRecords = (envelope.records as unknown[]).map(entry => {
					if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
						throw new StateFileError('STORE_CORRUPT', snapshotPath, 'capabilities snapshot entry is not an object');
					}
					return parseRecord(entry as Record<string, unknown>, snapshotPath);
				});
			}
		} catch (error) {
			if (error instanceof StateFileError) {
				throw new RegistryError('STORE_CORRUPT', error.path, error.message);
			}
			throw error;
		}
		if (diskRecords === undefined) {
			// first run (or state was wiped): materialize the compiled defaults durably
			this.records = defaults;
			await this.persist();
			this.loaded = true;
			return;
		}
		// RECOVERY: disk is the source of truth for 'discovered' records; the
		// compiled config layer refreshes code-default/providers-file records
		// (defaults evolve with the product) and PRESERVES every discovered
		// record verbatim (discovery is runtime knowledge, never lost).
		const discovered = diskRecords.filter(record => record.source === 'discovered');
		this.records = [...defaults, ...discovered];
		await this.persist();
		this.loaded = true;
	}

	private compileDefaults(overrides: readonly import('./configs.ts').ProviderOverride[] = []): CapabilityRecord[] {
		const now = this.clock();
		const merged = mergeProviderConfigs(DEFAULT_PROVIDER_CONFIGS, overrides);
		const records: CapabilityRecord[] = [];
		for (const config of merged) {
			for (const model of config.models) {
				records.push(recordFromConfig(config, model, now));
			}
		}
		return records;
	}

	private async persist(): Promise<void> {
		if (this.stateDir === undefined) {
			return;
		}
		try {
			await atomicWrite(this.fs, joinStatePath(this.stateDir, 'capabilities.json'), envelopeText({ schema: CAPABILITIES_SCHEMA_ID, schemaVersion: 0, updatedAt: this.clock(), records: this.records }));
		} catch (error) {
			throw new RegistryError('WRITE_FAILED', joinStatePath(this.stateDir, 'capabilities.json'), error instanceof Error ? error.message : String(error));
		}
	}

	private ensureLoaded(): void {
		if (!this.loaded) {
			throw new RegistryError('BAD_DISCOVERY', '', 'registry used before load() -- call load() first');
		}
	}

	/** All capability records (stable order: providerId, modelId). */
	list(): readonly CapabilityRecord[] {
		this.ensureLoaded();
		return [...this.records].sort((a, b) => a.providerId.localeCompare(b.providerId) || a.modelId.localeCompare(b.modelId));
	}

	/** One record lookup. */
	get(providerId: string, modelId: string): CapabilityRecord | undefined {
		this.ensureLoaded();
		return this.records.find(record => record.providerId === providerId && record.modelId === modelId);
	}

	/** The capability query (the discovery seam). */
	query(query: CapabilityQuery): CapabilityRecord[] {
		this.ensureLoaded();
		return this.list().filter(record => {
			if (query.enabledOnly === true && !record.enabled) {
				return false;
			}
			if (query.providerId !== undefined && record.providerId !== query.providerId) {
				return false;
			}
			if (query.locality !== undefined && record.locality !== query.locality) {
				return false;
			}
			if (query.requiresTools === true && (record.toolCalling === false || record.toolCalling === 0)) {
				return false;
			}
			if (query.minContextWindowTokens !== undefined && record.contextWindowTokens < query.minContextWindowTokens) {
				return false;
			}
			if (query.requiresImageInput === true && !record.inputModalities.includes('image')) {
				return false;
			}
			if (query.maxInputCostPerMillion !== undefined) {
				const inputCost = record.cost?.inputPerMillion;
				// fail closed: an unpriced model cannot prove it is within the budget
				if (inputCost === undefined || inputCost > query.maxInputCostPerMillion) {
					return false;
				}
			}
			return true;
		});
	}

	/**
	 * Records a runtime discovery (durable; survives restart). Re-records of
	 * the same provider/model refresh the record and bump updatedAt.
	 */
	async recordDiscovery(record: Omit<CapabilityRecord, 'source' | 'updatedAt'>): Promise<void> {
		this.ensureLoaded();
		const entry: CapabilityRecord = { ...record, source: 'discovered', updatedAt: this.clock() };
		const next = this.records.filter(existing => !(existing.providerId === entry.providerId && existing.modelId === entry.modelId && existing.source !== 'discovered'));
		next.push(entry);
		this.records = next;
		await this.persist();
	}

	/** Adapter configs for the ENABLED providers (the activation seam). */
	toAdapterConfigs(): AdapterConfig[] {
		this.ensureLoaded();
		const byProvider = new Map<string, CapabilityRecord[]>();
		for (const record of this.records) {
			if (!record.enabled || record.wireFamily === 'mock-echo') {
				continue;
			}
			const existing = byProvider.get(record.providerId) ?? [];
			existing.push(record);
			byProvider.set(record.providerId, existing);
		}
		const configs: AdapterConfig[] = [];
		for (const [providerId, records] of byProvider) {
			const first = records[0];
			if (first === undefined) {
				continue;
			}
			configs.push({
				providerId,
				vendor: first.vendor,
				displayName: first.vendor,
				baseUrl: this.baseUrlFor(providerId),
				...(first.credentialConfigured ? { credentialRef: this.credentialRefFor(providerId) } : {}),
				models: records.map(record => ({
					modelId: record.modelId,
					modelName: record.modelName,
					family: record.family,
					version: record.version,
					contextWindowTokens: record.contextWindowTokens,
					maxOutputTokens: record.maxOutputTokens,
					inputModalities: record.inputModalities,
					toolCalling: record.toolCalling,
					...(record.cost === undefined ? {} : { cost: record.cost }),
				})),
			});
		}
		return configs;
	}

	private providerConfig(providerId: string): ProviderConfigRecord | undefined {
		return this.mergedConfigs.find(record => record.providerId === providerId);
	}

	private baseUrlFor(providerId: string): string {
		return this.providerConfig(providerId)?.baseUrl ?? 'https://example.invalid';
	}

	private credentialRefFor(providerId: string): string | undefined {
		return this.providerConfig(providerId)?.credentialRef;
	}
}
