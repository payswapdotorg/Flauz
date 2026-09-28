/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the activation fabric (M2-M5 integration seam).
 *
 * Bootstraps the whole model/provider fabric for one extension activation:
 *  - loads the durable capability registry (recovering from disk) and
 *    materializes the routing + tool policies (`.flauz/models` family);
 *  - exposes per-vendor vscode providers (type-only import; the native API
 *    stays authoritative) whose model lists arrive when the registry is
 *    ready -- registration itself is synchronous so activation never races
 *    model resolution;
 *  - a DISABLED provider reports zero models (the honest zero-network
 *    default posture: nothing appears until the workspace providers file
 *    enables it);
 *  - degrades explicitly: a failed durable load keeps the in-memory code
 *    defaults and records the reason (never a silent reinterpretation).
 *
 * No workspace root => in-memory registry (documented degraded posture for
 * the no-folder workspace case, identical to the test harness).
 */

import type * as vscode from 'vscode';
import type { Clock, FileSystemPort, HashPort, HttpPort, SecretResolverPort } from './contract/ports.ts';
import { nodeHttpPort } from './contract/nodePorts.ts';
import type { AdapterConfig } from './adapters/common.ts';
import { createOpenAiCompatAdapter } from './adapters/openAiCompat.ts';
import { createAnthropicCompatAdapter } from './adapters/anthropicCompat.ts';
import { createOllamaAdapter } from './adapters/ollama.ts';
import { createAdapterBackedProvider } from './adapters/bridge.ts';
import { ModelCapabilityRegistry, type CapabilityRecord } from './discovery/registry.ts';
import { joinStatePath } from './discovery/stateFiles.ts';
import { DEFAULT_ROUTING_POLICY, type RoutingPolicyFile } from './routing/policy.ts';
import { loadRoutingPolicy } from './routing/store.ts';
import { DEFAULT_TOOL_POLICY, type ToolPolicyFile, loadToolPolicy } from './mcp/policy.ts';

import type { WireFamily } from './contract/types.ts';

/** The adapter-backed vendor registrations activation contributes. */
export interface FabricVendor {
	readonly vendor: string;
	readonly providerId: string;
	readonly wireFamily: WireFamily;
}

/** Vendors registered at activation (model lists gated by the enabled state). */
export const FABRIC_VENDORS: readonly FabricVendor[] = [
	{ vendor: 'flauz-openai-compat', providerId: 'openai-compat', wireFamily: 'openai-chat-completions' },
	{ vendor: 'flauz-anthropic-compat', providerId: 'anthropic-compat', wireFamily: 'anthropic-messages' },
	{ vendor: 'flauz-ollama', providerId: 'ollama-local', wireFamily: 'ollama-chat' },
];

/** Everything the fabric loaded (or degraded to). */
export interface FabricLoaded {
	readonly registry: ModelCapabilityRegistry;
	readonly records: readonly CapabilityRecord[];
	readonly routingPolicy: RoutingPolicyFile;
	readonly toolPolicy: ToolPolicyFile;
	/** Present only when a durable artifact failed to load (in-memory defaults active). */
	readonly degraded?: string;
	/** True when no workspace root existed (in-memory posture, no durable files). */
	readonly inMemory: boolean;
}

/** The view-facing summary (pure data). */
export interface FabricViewInfo {
	readonly records: readonly CapabilityRecord[];
	readonly routingDefault: string;
	readonly toolPolicy: string;
	readonly degraded?: string;
	readonly inMemory: boolean;
}

/** Injected effects for the fabric bootstrap. */
export interface FabricDeps {
	readonly root: string | undefined;
	readonly fs: FileSystemPort;
	readonly clock: Clock;
	readonly secrets: SecretResolverPort;
	readonly hash: HashPort;
	readonly http?: HttpPort;
	readonly log?: (message: string) => void;
}

function buildAdapter(config: AdapterConfig, deps: FabricDeps): ReturnType<typeof createOpenAiCompatAdapter> | ReturnType<typeof createAnthropicCompatAdapter> | ReturnType<typeof createOllamaAdapter> {
	const shared = { config, http: deps.http ?? nodeHttpPort, secrets: deps.secrets, hash: deps.hash, clock: deps.clock };
	if (config.providerId === 'openai-compat') {
		return createOpenAiCompatAdapter(shared);
	}
	if (config.providerId === 'anthropic-compat') {
		return createAnthropicCompatAdapter(shared);
	}
	return createOllamaAdapter(shared);
}

function routingDefaultSummary(policy: RoutingPolicyFile): string {
	const fallbackRule = [...policy.rules].sort((a, b) => a.priority - b.priority).find(rule => rule.fallback === true) ?? policy.rules[0];
	if (fallbackRule === undefined) {
		return 'no rules';
	}
	const target = fallbackRule.prefer?.[0] ?? '(ranking)';
	return `default rule '${fallbackRule.id}' -> ${target} (priority ${fallbackRule.priority})`;
}

function toolPolicySummary(policy: ToolPolicyFile): string {
	const agents = Object.keys(policy.agents);
	const allDeny = Object.values(policy.agents).every(entry => entry.default === 'deny');
	return `${agents.length} agent ${agents.length === 1 ? 'entry' : 'entries'}${allDeny ? ' · default deny' : ''} · .flauz/models/tool-policy.json`;
}

/** Bootstraps the fabric; returns the ready promise plus per-vendor providers and the view summary. */
export function bootstrapFabric(deps: FabricDeps): {
	readonly ready: Promise<FabricLoaded>;
	providerFor(entry: FabricVendor): vscode.LanguageModelChatProvider;
	summary(): Promise<FabricViewInfo>;
} {
	const stateDir = deps.root === undefined ? undefined : joinStatePath(deps.root, '.flauz', 'models');
	const ready: Promise<FabricLoaded> = (async (): Promise<FabricLoaded> => {
		const degradedReasons: string[] = [];
		let registry = new ModelCapabilityRegistry({ root: deps.root, fs: deps.fs, clock: deps.clock });
		try {
			await registry.load();
		} catch (error) {
			degradedReasons.push(`capability registry: ${error instanceof Error ? error.message : String(error)}`);
			registry = new ModelCapabilityRegistry({ root: undefined, fs: deps.fs, clock: deps.clock });
			await registry.load();
			deps.log?.(`[flauz-models] durable capability state failed to load; running on in-memory defaults (${degradedReasons[degradedReasons.length - 1]})`);
		}
		let routingPolicy: RoutingPolicyFile = DEFAULT_ROUTING_POLICY;
		if (stateDir !== undefined) {
			try {
				routingPolicy = await loadRoutingPolicy(deps.fs, stateDir, deps.clock);
			} catch (error) {
				degradedReasons.push(`routing policy: ${error instanceof Error ? error.message : String(error)}`);
				deps.log?.(`[flauz-models] routing policy failed to load; using the in-memory default (${degradedReasons[degradedReasons.length - 1]})`);
			}
		}
		let toolPolicy: ToolPolicyFile = DEFAULT_TOOL_POLICY;
		if (stateDir !== undefined) {
			try {
				toolPolicy = await loadToolPolicy(deps.fs, stateDir, deps.clock);
			} catch (error) {
				degradedReasons.push(`tool policy: ${error instanceof Error ? error.message : String(error)}`);
				deps.log?.(`[flauz-models] tool policy failed to load; using the in-memory default (${degradedReasons[degradedReasons.length - 1]})`);
			}
		}
		return {
			registry,
			records: registry.list(),
			routingPolicy,
			toolPolicy,
			...(degradedReasons.length === 0 ? {} : { degraded: degradedReasons.join('; ') }),
			inMemory: stateDir === undefined,
		};
	})();
	const providerCache = new Map<string, vscode.LanguageModelChatProvider>();
	const providerCacheKeys = new Map<string, string>();
	const providerFor = (entry: FabricVendor): vscode.LanguageModelChatProvider => {
		const resolve = async (): Promise<vscode.LanguageModelChatProvider | undefined> => {
			const loaded = await ready;
			const config = loaded.registry.toAdapterConfigs().find(candidate => candidate.providerId === entry.providerId);
			if (config === undefined) {
				return undefined; // disabled: zero models, honest
			}
			const cacheKey = `${config.baseUrl}|${config.credentialRef ?? ''}|${config.models.map(model => model.modelId).join(',')}`;
			const existing = providerCache.get(entry.providerId);
			if (existing !== undefined && providerCacheKeys.get(entry.providerId) === cacheKey) {
				return existing;
			}
			const provider = createAdapterBackedProvider({ adapter: buildAdapter(config, deps) });
			providerCache.set(entry.providerId, provider);
			providerCacheKeys.set(entry.providerId, cacheKey);
			return provider;
		};
		return {
			async provideLanguageModelChatInformation(options, token) {
				const provider = await resolve();
				if (provider === undefined) {
					return []; // disabled provider: no models (the zero-network default)
				}
				return provider.provideLanguageModelChatInformation(options, token);
			},
			async provideLanguageModelChatResponse(model, messages, options, progress, token) {
				const provider = await resolve();
				if (provider === undefined) {
					throw new Error(`[flauz-models] vendor '${entry.vendor}' is not enabled (model '${model.id}' cannot be served; enable it in .flauz/models/providers.json)`);
				}
				return provider.provideLanguageModelChatResponse(model, messages, options, progress, token);
			},
			async provideTokenCount(model, text, token) {
				const provider = await resolve();
				if (provider === undefined) {
					throw new Error(`[flauz-models] vendor '${entry.vendor}' is not enabled (no tokenizer for '${model.id}'; enable it in .flauz/models/providers.json)`);
				}
				return provider.provideTokenCount(model, text, token);
			},
		};
	};
	const summary = async (): Promise<FabricViewInfo> => {
		const loaded = await ready;
		return {
			records: loaded.records,
			routingDefault: routingDefaultSummary(loaded.routingPolicy),
			toolPolicy: toolPolicySummary(loaded.toolPolicy),
			...(loaded.degraded === undefined ? {} : { degraded: loaded.degraded }),
			inMemory: loaded.inMemory,
		};
	};
	return { ready, providerFor, summary };
}
