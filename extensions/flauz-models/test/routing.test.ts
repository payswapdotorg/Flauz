/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- routing policy drills (M3): default policy
 * materialization, the EXPLICITLY LABELED zero-network default route to
 * flauz-mock, decision ledger persistence + durable decision ids, ranking
 * modes (prefer-order / cost / context-fit / locality), no-silent-fallback
 * exclusions with reasons, corrupt-policy fail-closed handling and restart
 * recovery of both policy and ledger.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';

import { DEFAULT_ROUTING_POLICY, evaluateRoutingPolicy, ROUTING_POLICY_SCHEMA_ID, type RouteRequest, type RoutingPolicyFile } from '../src/routing/policy.ts';
import { appendDecision, decisionCount, listDecisions, loadRoutingPolicy, ModelRouter, RoutingStoreError, saveRoutingPolicy } from '../src/routing/store.ts';
import { ModelCapabilityRegistry, type CapabilityRecord } from '../src/discovery/registry.ts';
import { makeTempFs } from './fsPort.ts';

function sequencedClock(start = 1000): () => number {
	let value = start;
	return () => (value += 1);
}

/** A policy with a user cost rule ahead of the default. */
function costAwarePolicy(): RoutingPolicyFile {
	return {
		schema: ROUTING_POLICY_SCHEMA_ID,
		schemaVersion: 0,
		updatedAt: 1,
		rules: [
			{ id: 'cheap-tools', description: 'Cheapest tool-capable enabled model wins.', priority: 10, match: { enabledOnly: true, requiresTools: true }, ranking: 'cost' },
			...DEFAULT_ROUTING_POLICY.rules,
		],
	};
}

test('routing: the default policy materializes on first run and is user-owned after', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const policy = await loadRoutingPolicy(temp.port, stateDir, () => 7);
		deepStrictEqual(policy.rules.map(rule => rule.id), ['zero-network-default']);
		const text = await temp.port.readFileUtf8(`${stateDir}/routing-policy.json`);
		ok(text !== undefined && text.includes('flauz.model-routing-policy/v0'));
		// a user-edited policy is loaded verbatim (never re-authored by Flauz)
		await saveRoutingPolicy(temp.port, stateDir, costAwarePolicy());
		const reloaded = await loadRoutingPolicy(temp.port, stateDir, () => 9);
		deepStrictEqual(reloaded.rules.map(rule => rule.id), ['cheap-tools', 'zero-network-default']);
	} finally {
		temp.cleanup();
	}
});

test('routing: default route goes to flauz-mock, explicitly labeled, with recorded provenance', async () => {
	const temp = makeTempFs();
	try {
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const router = new ModelRouter({ stateDir: `${temp.root}/.flauz/models`, fs: temp.port, clock: () => 42, records: () => registry.list(), policy: DEFAULT_ROUTING_POLICY });
		const decision = await router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
		strictEqual(decision.selected?.providerId, 'flauz-mock');
		strictEqual(decision.selected?.modelId, 'echo-1');
		strictEqual(decision.selectionBasis, 'rule-match');
		strictEqual(decision.ruleId, 'zero-network-default');
		ok(decision.ruleDescription?.includes('flauz-mock'));
		ok(decision.explanation.includes('zero-network-default'));
		strictEqual(decision.decisionId, 'rd-000001');
		// the ledger carries the decision; ids increment durably
		strictEqual(await decisionCount(temp.port, `${temp.root}/.flauz/models`), 1);
		const second = await router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
		strictEqual(second.decisionId, 'rd-000002');
		const stored = await listDecisions(temp.port, `${temp.root}/.flauz/models`);
		strictEqual(stored.length, 2);
		strictEqual(stored[1].decisionId, 'rd-000002');
	} finally {
		temp.cleanup();
	}
});

test('routing: decision candidates record every exclusion with a reason (no silent skips)', async () => {
	const temp = makeTempFs();
	try {
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const decision = evaluateRoutingPolicy({
			policy: DEFAULT_ROUTING_POLICY,
			request: { purpose: 'test', requirements: { enabledOnly: true } },
			records: registry.list(),
			decisionId: 'rd-000001',
			at: 1,
		});
		const excluded = decision.candidates.filter(candidate => !candidate.eligible);
		ok(excluded.length >= 2, 'the disabled remote vendors are listed as excluded');
		ok(excluded.every(candidate => candidate.exclusionReason === 'provider disabled'));
		const included = decision.candidates.filter(candidate => candidate.eligible);
		deepStrictEqual(included.map(candidate => `${candidate.providerId}/${candidate.modelId}`), ['flauz-mock/echo-1']);
	} finally {
		temp.cleanup();
	}
});

test('routing: cost ranking picks the cheapest tool-capable enabled candidate', async () => {
	const temp = makeTempFs();
	try {
		// enable both remote providers with credentials through the providers file
		await (async () => {
			const { ensureDir } = await import('../src/discovery/stateFiles.ts');
			await ensureDir(temp.port, `${temp.root}/.flauz/models`);
			await temp.port.writeFile(
				`${temp.root}/.flauz/models/providers.json`,
				`${JSON.stringify({
					schema: 'flauz.model-providers/v0',
					schemaVersion: 0,
					updatedAt: 1,
					providers: [
						{ providerId: 'openai-compat', enabled: true, credentialRef: 'env:FLAUZ_OPENAI_KEY' },
						{ providerId: 'anthropic-compat', enabled: true, credentialRef: 'env:FLAUZ_ANTHROPIC_KEY' },
					],
				}, null, 2)}\n`,
			);
		})();
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const router = new ModelRouter({ stateDir: `${temp.root}/.flauz/models`, fs: temp.port, clock: () => 10, records: () => registry.list(), policy: costAwarePolicy() });
		const decision = await router.route({ purpose: 'agent-tools', requirements: { enabledOnly: true, requiresTools: true } });
		strictEqual(decision.ruleId, 'cheap-tools');
		strictEqual(decision.selected?.providerId, 'openai-compat', 'gpt-4o-mini at 0.15/M beats sonnet at 3/M');
		strictEqual(decision.selected?.modelId, 'gpt-4o-mini');
		const ranked = decision.candidates.find(candidate => candidate.providerId === 'openai-compat');
		strictEqual(ranked?.rank, 1);
		// the mock is NOT tool-capable and is excluded by the rule with a reason
		const mock = decision.candidates.find(candidate => candidate.providerId === 'flauz-mock');
		strictEqual(mock?.eligible, false, 'the request requires tools; the mock echo model does not qualify');
		strictEqual(mock?.exclusionReason, 'model does not support tool calling');
		strictEqual(decision.explanation.includes('cheap-tools'), true);
	} finally {
		temp.cleanup();
	}
});

test('routing: context-fit ranking picks the smallest sufficient window; locality prefers local', async () => {
	const records: readonly CapabilityRecord[] = [
		{ providerId: 'a', vendor: 'a', modelId: 'huge', modelName: 'Huge', family: 'f', version: '1', wireFamily: 'openai-chat-completions', locality: 'remote', enabled: true, contextWindowTokens: 200_000, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: true, source: 'providers-file' as const, updatedAt: 1, cost: { currency: 'USD' as const, inputPerMillion: 5, outputPerMillion: 5 } },
		{ providerId: 'b', vendor: 'b', modelId: 'fit', modelName: 'Fit', family: 'f', version: '1', wireFamily: 'openai-chat-completions', locality: 'remote', enabled: true, contextWindowTokens: 32_000, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: true, source: 'providers-file' as const, updatedAt: 1, cost: { currency: 'USD' as const, inputPerMillion: 9, outputPerMillion: 9 } },
		{ providerId: 'c', vendor: 'c', modelId: 'local-fit', modelName: 'LocalFit', family: 'f', version: '1', wireFamily: 'ollama-chat', locality: 'local', enabled: true, contextWindowTokens: 32_000, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: false, source: 'discovered' as const, updatedAt: 1 },
	];
	const contextPolicy: RoutingPolicyFile = {
		schema: ROUTING_POLICY_SCHEMA_ID,
		schemaVersion: 0,
		updatedAt: 0,
		rules: [{ id: 'fit-window', description: 'smallest sufficient window', priority: 1, match: { enabledOnly: true, minContextWindowTokens: 16_000 }, ranking: 'context-fit' }],
	};
	const fitted = evaluateRoutingPolicy({ policy: contextPolicy, request: { purpose: 't', requirements: { enabledOnly: true } }, records, decisionId: 'rd-000001', at: 1 });
	strictEqual(fitted.selected?.modelId, 'fit', 'smallest window that satisfies the rule minimum');
	const localityPolicy: RoutingPolicyFile = {
		schema: ROUTING_POLICY_SCHEMA_ID,
		schemaVersion: 0,
		updatedAt: 0,
		rules: [{ id: 'prefer-local', description: 'local first', priority: 1, match: { enabledOnly: true }, ranking: 'locality' }],
	};
	const local = evaluateRoutingPolicy({ policy: localityPolicy, request: { purpose: 't', requirements: { enabledOnly: true } }, records, decisionId: 'rd-000001', at: 1 });
	strictEqual(local.selected?.providerId, 'c', 'local wins over remote regardless of cost');
});

test('routing: nothing matching yields a no-candidate decision, never a silent fallback', async () => {
	const records: readonly CapabilityRecord[] = [
		{ providerId: 'flauz-mock', vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Echo', family: 'f', version: '1', wireFamily: 'mock-echo', locality: 'local', enabled: false, contextWindowTokens: 8192, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: false, tokenCounting: 'estimated', streaming: true, credentialConfigured: false, source: 'code-default' as const, updatedAt: 1 },
	];
	const decision = evaluateRoutingPolicy({ policy: DEFAULT_ROUTING_POLICY, request: { purpose: 't', requirements: { enabledOnly: true } }, records, decisionId: 'rd-000001', at: 1 });
	strictEqual(decision.selected, null);
	strictEqual(decision.selectionBasis, 'no-candidate');
	ok(decision.explanation.includes('no routing rule matched'));
	const excluded = decision.candidates.find(candidate => candidate.providerId === 'flauz-mock');
	strictEqual(excluded?.exclusionReason, 'provider disabled');
});

test('routing: fail-closed cost ceilings exclude unpriced records with the reason recorded', () => {
	const records: readonly CapabilityRecord[] = [
		{ providerId: 'unpriced', vendor: 'u', modelId: 'm', modelName: 'M', family: 'f', version: '1', wireFamily: 'openai-chat-completions', locality: 'remote', enabled: true, contextWindowTokens: 8000, maxOutputTokens: 1000, inputModalities: ['text'], toolCalling: true, tokenCounting: 'both', streaming: true, credentialConfigured: true, source: 'discovered' as const, updatedAt: 1 },
	];
	const policy: RoutingPolicyFile = {
		schema: ROUTING_POLICY_SCHEMA_ID,
		schemaVersion: 0,
		updatedAt: 0,
		rules: [{ id: 'budget', description: 'cheap only', priority: 1, match: { enabledOnly: true, maxInputCostPerMillion: 1 }, ranking: 'prefer-order', prefer: ['unpriced'] }],
	};
	const decision = evaluateRoutingPolicy({ policy, request: { purpose: 't', requirements: { enabledOnly: true } }, records, decisionId: 'rd-000001', at: 1 });
	strictEqual(decision.selected, null, 'unpriced record cannot prove it is within the ceiling');
	strictEqual(decision.candidates[0]?.eligible, true, 'request-level eligibility is separate from rule-level exclusion');
	ok(decision.explanation.includes('input cost unknown'), 'the rule-level exclusion is recorded in the decision explanation');
});

test('routing: corrupt policy file fails closed with a typed error', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const { ensureDir } = await import('../src/discovery/stateFiles.ts');
		await ensureDir(temp.port, stateDir);
		await temp.port.writeFile(`${stateDir}/routing-policy.json`, '{"schema":"flauz.model-routing-policy/v0","rules":[{"id":5}]}');
		await loadRoutingPolicy(temp.port, stateDir, () => 0).then(
			() => {
				throw new Error('must not resolve');
			},
			(error: unknown) => {
				ok(error instanceof RoutingStoreError);
				strictEqual(error.code, 'STORE_CORRUPT');
			},
		);
	} finally {
		temp.cleanup();
	}
});

test('routing: restart recovers policy and ledger from disk', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: sequencedClock() });
		await registry.load();
		const first = new ModelRouter({ stateDir, fs: temp.port, clock: () => 1, records: () => registry.list(), policy: await loadRoutingPolicy(temp.port, stateDir, () => 1) });
		await first.route({ purpose: 'a', requirements: { enabledOnly: true } });
		await first.route({ purpose: 'b', requirements: { enabledOnly: true } });
		// restart: fresh router over the same disk state
		const second = new ModelRouter({ stateDir, fs: temp.port, clock: () => 2, records: () => registry.list(), policy: await loadRoutingPolicy(temp.port, stateDir, () => 2) });
		const decision = await second.route({ purpose: 'c', requirements: { enabledOnly: true } });
		strictEqual(decision.decisionId, 'rd-000003', 'decision ids continue across restarts');
		strictEqual((await listDecisions(temp.port, stateDir)).length, 3);
	} finally {
		temp.cleanup();
	}
});

test('routing: ledger preserves existing bytes (append-only discipline)', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const { ensureDir } = await import('../src/discovery/stateFiles.ts');
		await ensureDir(temp.port, stateDir);
		const decision = evaluateRoutingPolicy({
			policy: DEFAULT_ROUTING_POLICY,
			request: { purpose: 'seed', requirements: { enabledOnly: true } },
			records: [{ providerId: 'flauz-mock', vendor: 'flauz-mock', modelId: 'echo-1', modelName: 'Echo', family: 'f', version: '1', wireFamily: 'mock-echo' as const, locality: 'local' as const, enabled: true, contextWindowTokens: 8192, maxOutputTokens: 4096, inputModalities: ['text'], toolCalling: false, tokenCounting: 'estimated' as const, streaming: true, credentialConfigured: false, source: 'code-default' as const, updatedAt: 1 }],
			decisionId: 'rd-000001',
			at: 1,
		});
		await appendDecision(temp.port, stateDir, decision);
		const before = await temp.port.readFileUtf8(`${stateDir}/routing-decisions.jsonl`);
		ok(before !== undefined);
		const second = evaluateRoutingPolicy({ policy: DEFAULT_ROUTING_POLICY, request: { purpose: 'seed2', requirements: { enabledOnly: true } }, records: [], decisionId: 'rd-000002', at: 2 });
		await appendDecision(temp.port, stateDir, second);
		const after = await temp.port.readFileUtf8(`${stateDir}/routing-decisions.jsonl`);
		ok(after !== undefined);
		ok(after.startsWith(before ?? ''), 'previous bytes preserved verbatim');
		strictEqual(after.split('\n').filter(line => line.trim().length > 0).length, 2);
	} finally {
		temp.cleanup();
	}
});
