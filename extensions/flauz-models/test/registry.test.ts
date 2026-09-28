/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- capability registry drills (M3): default
 * materialization, durable recovery across restart, workspace provider
 * overrides (enable / base url / credential references / model additions),
 * the strict credential-reference law, the capability query seam, runtime
 * discovery durability and fail-closed corrupt-state handling.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';

import { ModelCapabilityRegistry, CAPABILITIES_SCHEMA_ID, RegistryError, type CapabilityRecord } from '../src/discovery/registry.ts';
import { ensureDir } from '../src/discovery/stateFiles.ts';
import { isCredentialRef, parseProvidersEnvelope, PROVIDERS_SCHEMA_ID } from '../src/discovery/configs.ts';
import { makeTempFs } from './fsPort.ts';

/** Deterministic clock sequence (each call advances by exactly 1). */
function sequencedClock(start = 1000): () => number {
	let value = start;
	return () => (value += 1);
}

test('registry: first run materializes the durable capability snapshot', async () => {
	const temp = makeTempFs();
	try {
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const records = registry.list();
		strictEqual(records.length, 3, 'mock + openai + anthropic defaults (ollama ships no models)');
		const mock = registry.get('flauz-mock', 'echo-1');
		ok(mock !== undefined);
		strictEqual(mock.enabled, true);
		strictEqual(mock.wireFamily, 'mock-echo');
		strictEqual(mock.toolCalling, false);
		strictEqual(mock.tokenCounting, 'estimated');
		strictEqual(mock.source, 'code-default');
		const openai = registry.get('openai-compat', 'gpt-4o-mini');
		ok(openai !== undefined);
		strictEqual(openai.enabled, false, 'remote vendors ship disabled (zero-network default)');
		strictEqual(openai.credentialConfigured, false, 'no credential reference by default');
		strictEqual(openai.contextWindowTokens, 128_000);
		const anthropic = registry.get('anthropic-compat', 'claude-sonnet-4-5');
		ok(anthropic !== undefined);
		strictEqual(anthropic.cost?.inputPerMillion, 3);
		const ollama = registry.get('ollama-local', 'anything');
		strictEqual(ollama, undefined, 'ollama ships with an empty model catalog');
		// the snapshot is durable + canonical
		const text = await temp.port.readFileUtf8(`${temp.root}/.flauz/models/capabilities.json`);
		ok(text !== undefined, 'snapshot written');
		ok(text.endsWith('}\n'), 'trailing newline');
		const parsed = JSON.parse(text) as { schema: string; records: unknown[] };
		strictEqual(parsed.schema, CAPABILITIES_SCHEMA_ID);
		strictEqual(parsed.records.length, records.length);
	} finally {
		temp.cleanup();
	}
});

test('registry: recovers capability state from disk across restart', async () => {
	const temp = makeTempFs();
	try {
		const first = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await first.load();
		await first.recordDiscovery({
			providerId: 'ollama-local',
			vendor: 'flauz-ollama',
			modelId: 'llama3.1:8b',
			modelName: 'Llama 3.1 8B',
			family: 'llama3.1',
			version: '1',
			wireFamily: 'ollama-chat',
			locality: 'local',
			enabled: true,
			contextWindowTokens: 131_072,
			maxOutputTokens: 4096,
			inputModalities: ['text'],
			toolCalling: true,
			tokenCounting: 'both',
			streaming: true,
			credentialConfigured: false,
		});
		// restart: a NEW registry instance over the same root
		const second = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock(5000) });
		await second.load();
		const discovered = second.get('ollama-local', 'llama3.1:8b');
		ok(discovered !== undefined, 'discovered record survives restart');
		strictEqual(discovered.source, 'discovered');
		strictEqual(discovered.contextWindowTokens, 131_072);
		ok(second.get('flauz-mock', 'echo-1') !== undefined, 'defaults still present after restart');
	} finally {
		temp.cleanup();
	}
});

test('registry: workspace providers file overrides enable, base url, credentials and models', async () => {
	const temp = makeTempFs();
	try {
		await ensureDir(temp.port, `${temp.root}/.flauz/models`);
		await temp.port.writeFile(
			`${temp.root}/.flauz/models/providers.json`,
			`${JSON.stringify({
				schema: PROVIDERS_SCHEMA_ID,
				schemaVersion: 0,
				updatedAt: 1,
				providers: [
					{ providerId: 'openai-compat', enabled: true, baseUrl: 'http://127.0.0.1:9999/v1', credentialRef: 'env:FLAUZ_OPENAI_KEY' },
					{ providerId: 'ollama-local', enabled: true, models: [{ modelId: 'llama3.1:8b', modelName: 'Llama 3.1 8B', family: 'llama3.1', version: '1', contextWindowTokens: 131072, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: true }] },
				],
			}, null, 2)}\n`,
		);
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const openai = registry.get('openai-compat', 'gpt-4o-mini');
		ok(openai !== undefined);
		strictEqual(openai.enabled, true);
		strictEqual(openai.credentialConfigured, true);
		strictEqual(openai.source, 'providers-file');
		const adapterConfigs = registry.toAdapterConfigs();
		const openaiConfig = adapterConfigs.find(config => config.providerId === 'openai-compat');
		ok(openaiConfig !== undefined, 'enabled provider yields an adapter config');
		strictEqual(openaiConfig.baseUrl, 'http://127.0.0.1:9999/v1', 'base url override flows into the adapter config');
		strictEqual(openaiConfig.credentialRef, 'env:FLAUZ_OPENAI_KEY');
		strictEqual(openaiConfig.models[0].modelId, 'gpt-4o-mini');
		const local = registry.get('ollama-local', 'llama3.1:8b');
		ok(local !== undefined, 'model additions through the providers file');
		strictEqual(local.source, 'providers-file');
		// disabled providers yield no adapter config
		const anthropicConfig = adapterConfigs.find(config => config.providerId === 'anthropic-compat');
		strictEqual(anthropicConfig, undefined);
	} finally {
		temp.cleanup();
	}
});

test('registry: literal key material is rejected (credential-reference law)', () => {
	strictEqual(isCredentialRef('env:FLAUZ_KEY'), true);
	strictEqual(isCredentialRef('vault:MY_KEY_2'), true);
	strictEqual(isCredentialRef('sk-proj-abcdefgh'), false, 'literal key rejected');
	strictEqual(isCredentialRef(''), false);
	throws(
		() => parseProvidersEnvelope(JSON.stringify({ schema: PROVIDERS_SCHEMA_ID, providers: [{ providerId: 'x', credentialRef: 'sk-1234567890abcdef' }] })),
		/vault reference/,
	);
	throws(
		() => parseProvidersEnvelope('{not json'),
		/not valid JSON/,
	);
});

test('registry: corrupt capability snapshot fails closed with a typed error', async () => {
	const temp = makeTempFs();
	try {
		const first = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await first.load();
		await temp.port.writeFile(`${temp.root}/.flauz/models/capabilities.json`, '{"schema":"flauz.model-capabilities/v0","records":[{"broken":true}]}');
		const second = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await second.load().then(
			() => {
				throw new Error('must not resolve');
			},
			(error: unknown) => {
				ok(error instanceof RegistryError);
				strictEqual(error.code, 'STORE_CORRUPT');
				ok(error.message.includes('capabilities.json'));
			},
		);
	} finally {
		temp.cleanup();
	}
});

test('registry: the capability query seam filters by requirement', async () => {
	const temp = makeTempFs();
	try {
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		deepStrictEqual(
			registry.query({ providerId: 'flauz-mock' }).map(record => record.modelId),
			['echo-1'],
		);
		strictEqual(registry.query({ requiresTools: true, enabledOnly: false }).every(record => record.toolCalling !== false), true);
		deepStrictEqual(registry.query({ requiresTools: true, enabledOnly: true }), [], 'nothing tool-capable is enabled by default');
		strictEqual(registry.query({ minContextWindowTokens: 150_000 }).length, 1, 'only the anthropic default window is >= 150k');
		deepStrictEqual(
			registry.query({ minContextWindowTokens: 150_000 }).map(record => `${record.providerId}/${record.modelId}`),
			['anthropic-compat/claude-sonnet-4-5'],
		);
		strictEqual(registry.query({ locality: 'remote', enabledOnly: false }).every(record => record.locality === 'remote'), true);
		strictEqual(registry.query({ requiresImageInput: true, enabledOnly: false }).every(record => record.inputModalities.includes('image')), true);
		deepStrictEqual(
			registry.query({ maxInputCostPerMillion: 1, enabledOnly: false }).map(record => `${record.providerId}/${record.modelId}`),
			['flauz-mock/echo-1', 'openai-compat/gpt-4o-mini'],
			'priced-within-ceiling records only (mock is explicitly free)',
		);
	} finally {
		temp.cleanup();
	}
});

test('registry: in-memory posture when no workspace root is available', async () => {
	const registry = new ModelCapabilityRegistry({ root: undefined, fs: {
		readFileUtf8: async () => undefined,
		writeFile: async () => undefined,
		rename: async () => undefined,
		mkdir: async () => undefined,
	}, clock: () => 42 });
	await registry.load();
	ok(registry.get('flauz-mock', 'echo-1') !== undefined);
	const records: readonly CapabilityRecord[] = registry.list();
	strictEqual(records.every(record => record.updatedAt === 42), true);
	// recordDiscovery persists nowhere (no state dir) but stays queryable in-process
	await registry.recordDiscovery({
		providerId: 'p', vendor: 'v', modelId: 'm', modelName: 'M', family: 'f', version: '1',
		wireFamily: 'openai-chat-completions', locality: 'remote', enabled: true, contextWindowTokens: 100, maxOutputTokens: 10,
		inputModalities: ['text'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: true,
	});
	ok(registry.get('p', 'm') !== undefined);
});
