/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- provider configuration (M3).
 *
 * Two layers, one record shape:
 *  1. CODE DEFAULTS: the built-in provider configs (OpenAI-compatible,
 *     Anthropic-compatible, Ollama-style local) + the flauz-mock pseudo
 *     provider (registry completeness + the zero-network default route).
 *     Remote vendors ship DISABLED and WITHOUT credentials: enabling them is
 *     an explicit act recorded in the workspace providers file.
 *  2. WORKSPACE OVERRIDES: `.flauz/models/providers.json`
 *     (`flauz.model-providers/v0`) -- enable/disable, base-url overrides
 *     (gateways, proxies), credential REFERENCES (`env:<NAME>` /
 *     `vault:<NAME>`; literal keys are rejected at validation, the same law
 *     as the environments registry) and additional model entries.
 *
 * The default model catalogs are configuration conveniences with public
 * reference pricing at authoring time; they are provenance-labeled
 * 'code-default' in the capability records and every routing decision
 * records which catalog entry fired. Verify pricing against the live vendor
 * before relying on cost ranking (see the delivery REPORT INTEGRATION-GAPS).
 */

import type { FileSystemPort } from '../contract/ports.ts';
import type { ModelDescriptor, WireFamily } from '../contract/types.ts';
import { atomicWrite, envelopeText, readEnvelope } from './stateFiles.ts';

/** Schema id pinned into the providers file. */
export const PROVIDERS_SCHEMA_ID = 'flauz.model-providers/v0';

/** Workspace path of the providers file. */
export const PROVIDERS_PATH = '.flauz/models/providers.json';

/** Default public endpoints of the three wire families. */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

/** One provider configuration (the merged view the registry compiles). */
export interface ProviderConfigRecord {
	readonly providerId: string;
	readonly vendor: string;
	readonly displayName: string;
	readonly wireFamily: WireFamily;
	readonly locality: 'local' | 'remote';
	readonly baseUrl: string;
	readonly credentialRef?: string;
	readonly enabled: boolean;
	readonly models: readonly ModelDescriptor[];
	readonly source: 'code-default' | 'providers-file';
}

/** The override/addition shape inside the providers file. */
export interface ProviderOverride {
	readonly providerId: string;
	readonly enabled?: boolean;
	readonly baseUrl?: string;
	readonly credentialRef?: string;
	readonly models?: readonly ModelDescriptor[];
}

/** Vault reference law: `env:<NAME>` or `vault:<NAME>`, nothing else. */
export function isCredentialRef(value: string): boolean {
	return /^(env|vault):[A-Za-z0-9_.-]+$/.test(value);
}

function openAiDefaultModel(): ModelDescriptor {
	return {
		modelId: 'gpt-4o-mini',
		modelName: 'GPT-4o mini',
		family: 'gpt-4o',
		version: '2024-07-18',
		contextWindowTokens: 128_000,
		maxOutputTokens: 16_384,
		inputModalities: ['text', 'image'],
		toolCalling: true,
		cost: { currency: 'USD', inputPerMillion: 0.15, outputPerMillion: 0.6 },
	};
}

function anthropicDefaultModel(): ModelDescriptor {
	return {
		modelId: 'claude-sonnet-4-5',
		modelName: 'Claude Sonnet 4.5',
		family: 'claude',
		version: '2025-09',
		contextWindowTokens: 200_000,
		maxOutputTokens: 64_000,
		inputModalities: ['text', 'image'],
		toolCalling: true,
		cost: { currency: 'USD', inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheWritePerMillion: 3.75 },
	};
}

/** The flauz-mock pseudo record (the zero-network default route target). */
export const MOCK_PROVIDER_RECORD: ProviderConfigRecord = {
	providerId: 'flauz-mock',
	vendor: 'flauz-mock',
	displayName: 'Flauz Mock',
	wireFamily: 'mock-echo',
	locality: 'local',
	baseUrl: 'in-process://flauz-mock',
	enabled: true,
	models: [
		{
			modelId: 'echo-1',
			modelName: 'Flauz Mock Echo',
			family: 'flauz-echo',
			version: '1',
			contextWindowTokens: 8192,
			maxOutputTokens: 4096,
			inputModalities: ['text'],
			toolCalling: false,
			cost: { currency: 'credits', inputPerMillion: 0, outputPerMillion: 0 },
		},
	],
	source: 'code-default',
};

/**
 * The code-default provider catalog. Remote vendors are DISABLED and carry
 * NO credential: a zero-network build never gains implicit network posture.
 * The Ollama-style local provider is enabled (localhost-only daemon; health
 * degrades gracefully when absent) but its model list is EMPTY by default --
 * local models exist only after the user pulls them and lists them in the
 * workspace providers file.
 */
export const DEFAULT_PROVIDER_CONFIGS: readonly ProviderConfigRecord[] = [
	MOCK_PROVIDER_RECORD,
	{
		providerId: 'openai-compat',
		vendor: 'flauz-openai-compat',
		displayName: 'Flauz OpenAI Compatible',
		wireFamily: 'openai-chat-completions',
		locality: 'remote',
		baseUrl: DEFAULT_OPENAI_BASE_URL,
		enabled: false,
		models: [openAiDefaultModel()],
		source: 'code-default',
	},
	{
		providerId: 'anthropic-compat',
		vendor: 'flauz-anthropic-compat',
		displayName: 'Flauz Anthropic Compatible',
		wireFamily: 'anthropic-messages',
		locality: 'remote',
		baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
		enabled: false,
		models: [anthropicDefaultModel()],
		source: 'code-default',
	},
	{
		providerId: 'ollama-local',
		vendor: 'flauz-ollama',
		displayName: 'Flauz Ollama Local',
		wireFamily: 'ollama-chat',
		locality: 'local',
		baseUrl: DEFAULT_OLLAMA_BASE_URL,
		enabled: true,
		models: [],
		source: 'code-default',
	},
];

function parseModelDescriptor(value: Record<string, unknown>, context: string): ModelDescriptor {
	const required = ['modelId', 'modelName', 'family', 'version', 'contextWindowTokens', 'maxOutputTokens'];
	for (const key of required) {
		if (typeof value[key] !== 'string' && typeof value[key] !== 'number') {
			throw new Error(`${context}: model entry field '${key}' is missing or has the wrong type`);
		}
	}
	const inputModalities: readonly ('text' | 'image')[] = Array.isArray(value.inputModalities) ? (value.inputModalities as unknown[]).filter((entry): entry is 'text' | 'image' => entry === 'text' || entry === 'image') : ['text'];
	const toolCallingRaw = value.toolCalling;
	const toolCalling = toolCallingRaw === undefined ? true : typeof toolCallingRaw === 'boolean' ? toolCallingRaw : typeof toolCallingRaw === 'number' ? toolCallingRaw : true;
	const costRaw = value.cost;
	const cost = costRaw !== null && typeof costRaw === 'object' && !Array.isArray(costRaw)
		? {
			currency: (costRaw as Record<string, unknown>).currency === 'credits' ? ('credits' as const) : ('USD' as const),
			...numberFields(costRaw as Record<string, unknown>, ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheWritePerMillion']),
		}
		: undefined;
	return {
		modelId: String(value.modelId),
		modelName: String(value.modelName),
		family: String(value.family),
		version: String(value.version),
		contextWindowTokens: Number(value.contextWindowTokens),
		maxOutputTokens: Number(value.maxOutputTokens),
		inputModalities,
		toolCalling,
		...(cost === undefined ? {} : { cost }),
	};
}

function numberFields(record: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
	const result: Record<string, number> = {};
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			result[key] = value;
		}
	}
	return result;
}

/**
 * Validates + parses the providers file body. STRICT: unknown top-level
 * keys, non-object providers, literal credential values (anything not
 * matching the vault-reference law) and malformed model entries are typed
 * failures. Never throws raw: callers get Error with a precise message.
 */
export function parseProvidersEnvelope(text: string): ProviderOverride[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`providers file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('providers file root is not an object');
	}
	const envelope = parsed as Record<string, unknown>;
	if (envelope.schema !== PROVIDERS_SCHEMA_ID) {
		throw new Error(`providers file carries schema '${String(envelope.schema)}' but '${PROVIDERS_SCHEMA_ID}' was expected`);
	}
	const providers = envelope.providers;
	if (!Array.isArray(providers)) {
		throw new Error('providers file field "providers" must be an array');
	}
	const overrides: ProviderOverride[] = [];
	for (const [index, entry] of providers.entries()) {
		if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error(`providers[${index}] is not an object`);
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.providerId !== 'string' || record.providerId.length === 0) {
			throw new Error(`providers[${index}].providerId must be a non-empty string`);
		}
		if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
			throw new Error(`providers[${index}].enabled must be a boolean`);
		}
		if (record.baseUrl !== undefined && (typeof record.baseUrl !== 'string' || !/^https?:\/\//.test(record.baseUrl))) {
			throw new Error(`providers[${index}].baseUrl must be an http(s) URL`);
		}
		if (record.credentialRef !== undefined && (typeof record.credentialRef !== 'string' || !isCredentialRef(record.credentialRef))) {
			throw new Error(`providers[${index}].credentialRef must be a vault reference (env:<NAME> or vault:<NAME>) -- literal key material is rejected`);
		}
		let models: ModelDescriptor[] | undefined;
		if (record.models !== undefined) {
			if (!Array.isArray(record.models)) {
				throw new Error(`providers[${index}].models must be an array`);
			}
			models = record.models.map((model, modelIndex) => {
				if (model === null || typeof model !== 'object' || Array.isArray(model)) {
					throw new Error(`providers[${index}].models[${modelIndex}] is not an object`);
				}
				return parseModelDescriptor(model as Record<string, unknown>, `providers[${index}].models[${modelIndex}]`);
			});
		}
		overrides.push({
			providerId: record.providerId,
			...(record.enabled === undefined ? {} : { enabled: record.enabled }),
			...(record.baseUrl === undefined ? {} : { baseUrl: record.baseUrl }),
			...(record.credentialRef === undefined ? {} : { credentialRef: record.credentialRef }),
			...(models === undefined ? {} : { models }),
		});
	}
	return overrides;
}

/**
 * Loads the workspace providers file. Returns { overrides, materialized }
 * where materialized marks that the file existed and parsed (first-run
 * absent file is NOT an error -- defaults simply apply).
 */
export async function loadProviderOverrides(fs: FileSystemPort, stateDir: string): Promise<{ overrides: ProviderOverride[]; materialized: boolean }> {
	const path = `${stateDir}/providers.json`;
	const envelope = await readEnvelope(fs, path, PROVIDERS_SCHEMA_ID);
	if (envelope === undefined) {
		return { overrides: [], materialized: false };
	}
	if (!Array.isArray(envelope.providers)) {
		throw new Error(`providers file '${path}' field "providers" must be an array`);
	}
	const text = JSON.stringify({ schema: envelope.schema, providers: envelope.providers });
	return { overrides: parseProvidersEnvelope(text), materialized: true };
}

/** Merges code defaults with workspace overrides (overrides win; unknown ids are additions). */
export function mergeProviderConfigs(defaults: readonly ProviderConfigRecord[], overrides: readonly ProviderOverride[]): ProviderConfigRecord[] {
	const merged = defaults.map(defaultRecord => {
		const override = overrides.find(candidate => candidate.providerId === defaultRecord.providerId);
		if (override === undefined) {
			return defaultRecord;
		}
		return {
			...defaultRecord,
			...(override.baseUrl === undefined ? {} : { baseUrl: override.baseUrl }),
			...(override.credentialRef === undefined ? {} : { credentialRef: override.credentialRef }),
			...(override.enabled === undefined ? {} : { enabled: override.enabled }),
			...(override.models === undefined ? {} : { models: override.models }),
			source: 'providers-file' as const,
		};
	});
	const knownIds = new Set(defaults.map(record => record.providerId));
	for (const override of overrides) {
		if (!knownIds.has(override.providerId)) {
			// additions require the full shape; baseUrl+models are the minimum
			merged.push({
				providerId: override.providerId,
				vendor: override.providerId,
				displayName: override.providerId,
				wireFamily: 'openai-chat-completions',
				locality: 'remote',
				baseUrl: override.baseUrl ?? 'https://example.invalid',
				enabled: override.enabled ?? false,
				models: override.models ?? [],
				source: 'providers-file',
				...(override.credentialRef === undefined ? {} : { credentialRef: override.credentialRef }),
			});
		}
	}
	return merged;
}

/** Writes the providers file (used when materializing a documented starter file). */
export async function writeProviderOverrides(fs: FileSystemPort, stateDir: string, overrides: readonly ProviderOverride[], updatedAt: number): Promise<void> {
	await atomicWrite(fs, `${stateDir}/providers.json`, envelopeText({ schema: PROVIDERS_SCHEMA_ID, schemaVersion: 0, updatedAt, providers: overrides }));
}
