/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-116 (A-PROD-003-W2.2) — the provider-lane switch linking event.
 *
 * The finding (docs/FLAUZ-PROGRAM/findings/P2-FIX-116-provider-switch-no-linking-event.md):
 * a provider lane switch is durable in three places (writeProviderOverrides
 * providers file, routing-policy rewrite, decision ledger) with no single
 * linking event row; the dogfood harness had to mint its OWN evidence row per
 * switch — a workaround, not a fix.
 *
 * The acceptance under test: a provider-lane switch mints ONE canonical typed
 * event referencing the three artifacts it touches (before/after provider
 * ids, the policy delta, the decision id), through the product's own
 * append-only JSONL minting discipline.
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { createHash } from 'node:crypto';

import {
	PROVIDER_SWITCH_SCHEMA_ID,
	listProviderSwitches,
	providerSwitchCount,
	switchProviderLane,
	ProviderSwitchError,
} from '../src/routing/switch.ts';
import { listDecisions } from '../src/routing/store.ts';
import { ROUTING_POLICY_SCHEMA_ID, type RoutingPolicyFile } from '../src/routing/policy.ts';
import type { ProviderOverride } from '../src/discovery/configs.ts';
import type { HashPort } from '../src/contract/ports.ts';
import { makeTempFs } from './fsPort.ts';

const hashPort: HashPort = { sha256Hex: input => createHash('sha256').update(input, 'utf-8').digest('hex') };

function sequencedClock(start = 1000): () => number {
	let value = start;
	return () => (value += 1);
}

/** One lane's override entry (the providers-file shape). */
function laneOverride(providerId: string, enabled: boolean, port: number): ProviderOverride {
	return {
		providerId,
		enabled,
		baseUrl: `http://127.0.0.1:${String(port)}`,
		models: [{
			modelId: `${providerId}-model`,
			modelName: `${providerId} model`,
			family: providerId,
			version: '1',
			contextWindowTokens: 8192,
			maxOutputTokens: 1024,
			inputModalities: ['text'],
			toolCalling: false,
		}],
	};
}

/** The lane's routing policy (prefer-order on the named lane). */
function lanePolicy(prefer: string): RoutingPolicyFile {
	return {
		schema: ROUTING_POLICY_SCHEMA_ID,
		schemaVersion: 0,
		updatedAt: 42,
		rules: [{ id: 'lane-primary', description: `prefer ${prefer}`, priority: 1, match: { enabledOnly: true }, ranking: 'prefer-order', prefer: [prefer] }],
	};
}

test('P2-FIX-116: a lane switch mints ONE linking event row referencing the three artifacts', async () => {
	const temp = makeTempFs();
	try {
		// the BEFORE state: lane-a enabled (seeded through the product's own write path)
		await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-a',
			overrides: [laneOverride('lane-a', true, 9101)],
			policy: lanePolicy('lane-a'),
		});
		const beforeEventCount = await providerSwitchCount(temp.port, `${temp.root}/.flauz/models`);
		strictEqual(beforeEventCount, 1, 'the seeding switch minted its own event (the first switch from a virgin file)');
		const seed = (await listProviderSwitches(temp.port, `${temp.root}/.flauz/models`))[0];
		strictEqual(seed.fromProviderId, null, 'a virgin providers file has no enabled lane before');

		// THE SWITCH: lane-a -> lane-b (the act under test)
		const event = await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-b',
			overrides: [laneOverride('lane-a', false, 9101), laneOverride('lane-b', true, 9102)],
			policy: lanePolicy('lane-b'),
		});

		// the event row itself
		strictEqual(event.schema, PROVIDER_SWITCH_SCHEMA_ID);
		strictEqual(event.schemaVersion, 0);
		strictEqual(event.switchId, 'ps-000002', 'switch ids continue the rd- length-derived discipline');
		strictEqual(event.fromProviderId, 'lane-a');
		strictEqual(event.toProviderId, 'lane-b');

		// artifact 1: the providers file (path + sha256 of the WRITTEN file + the enabled set)
		strictEqual(event.providersFile.path, '.flauz/models/providers.json');
		const providersText = await temp.port.readFileUtf8(`${temp.root}/.flauz/models/providers.json`);
		ok(providersText !== undefined);
		strictEqual(event.providersFile.sha256, hashPort.sha256Hex(providersText), 'the sha256 pins the written bytes (checked, never trusted)');
		deepStrictEqual(event.providersFile.enabledProviderIds, ['lane-b']);
		deepStrictEqual(event.providersFile.beforeEnabledProviderIds, ['lane-a']);

		// artifact 2: the routing policy (path + sha256 + the delta)
		strictEqual(event.routingPolicy.path, '.flauz/models/routing-policy.json');
		const policyText = await temp.port.readFileUtf8(`${temp.root}/.flauz/models/routing-policy.json`);
		ok(policyText !== undefined);
		strictEqual(event.routingPolicy.sha256, hashPort.sha256Hex(policyText));
		deepStrictEqual(event.routingPolicy.rulesBefore, ['lane-primary']);
		deepStrictEqual(event.routingPolicy.rulesAfter, ['lane-primary']);
		strictEqual(event.routingPolicy.changedRules.length, 1, 'the same rule id changed its prefer target');
		strictEqual(event.routingPolicy.changedRules[0]?.ruleId, 'lane-primary');
		strictEqual(event.routingPolicy.changedRules[0]?.before?.prefer?.[0], 'lane-a');
		strictEqual(event.routingPolicy.changedRules[0]?.after?.prefer?.[0], 'lane-b');

		// artifact 3: the durable routing decision the switch minted (referenced by id)
		const decisions = await listDecisions(temp.port, `${temp.root}/.flauz/models`);
		const referenced = decisions.find(decision => decision.decisionId === event.routingDecision.decisionId);
		ok(referenced !== undefined, 'the referenced decision id EXISTS in the decision ledger');
		strictEqual(referenced.selected?.providerId, 'lane-b');
		strictEqual(event.routingDecision.selectedProviderId, 'lane-b');
		strictEqual(event.routingDecision.path, '.flauz/models/routing-decisions.jsonl');

		// ONE canonical event row per switch (the linking identity)
		strictEqual(await providerSwitchCount(temp.port, `${temp.root}/.flauz/models`), 2);
		const stored = await listProviderSwitches(temp.port, `${temp.root}/.flauz/models`);
		deepStrictEqual(stored.map(row => row.switchId), ['ps-000001', 'ps-000002']);
		ok(event.explanation.includes('lane-a') && event.explanation.includes('lane-b'));
	} finally {
		temp.cleanup();
	}
});

test('P2-FIX-116: the switch ledger is append-only (existing bytes preserved)', async () => {
	const temp = makeTempFs();
	try {
		const deps = {
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
		} as const;
		await switchProviderLane({ ...deps, targetProviderId: 'lane-a', overrides: [laneOverride('lane-a', true, 9101)], policy: lanePolicy('lane-a') });
		await switchProviderLane({ ...deps, targetProviderId: 'lane-b', overrides: [laneOverride('lane-a', false, 9101), laneOverride('lane-b', true, 9102)], policy: lanePolicy('lane-b') });
		const ledgerPath = `${temp.root}/.flauz/models/provider-switches.jsonl`;
		const afterFirst = (await temp.port.readFileUtf8(ledgerPath)) ?? '';
		const lines = afterFirst.split('\n').filter(line => line.trim().length > 0);
		strictEqual(lines.length, 2);
		// each stored line parses as the schema-pinned event
		for (const line of lines) {
			const parsed = JSON.parse(line) as { schema?: string };
			strictEqual(parsed.schema, PROVIDER_SWITCH_SCHEMA_ID);
		}
		// a third switch preserves the first two rows verbatim
		await switchProviderLane({ ...deps, targetProviderId: 'lane-a', overrides: [laneOverride('lane-a', true, 9101), laneOverride('lane-b', false, 9102)], policy: lanePolicy('lane-a') });
		const afterThird = (await temp.port.readFileUtf8(ledgerPath)) ?? '';
		ok(afterThird.startsWith(afterFirst), 'previous bytes preserved verbatim (the appendJsonlLine discipline)');
		strictEqual((await listProviderSwitches(temp.port, `${temp.root}/.flauz/models`)).length, 3);
	} finally {
		temp.cleanup();
	}
});

test('P2-FIX-116: a drifted switch fails closed (typed error, NO event minted)', async () => {
	const temp = makeTempFs();
	try {
		// seed lane-a
		await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-a',
			overrides: [laneOverride('lane-a', true, 9101)],
			policy: lanePolicy('lane-a'),
		});
		const countBefore = await providerSwitchCount(temp.port, `${temp.root}/.flauz/models`);
		// the drifted act: the target is lane-b but the policy still prefers lane-a
		await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-b',
			overrides: [laneOverride('lane-a', true, 9101), laneOverride('lane-b', true, 9102)],
			policy: lanePolicy('lane-a'),
		}).then(
			() => {
				throw new Error('must not resolve');
			},
			(error: unknown) => {
				ok(error instanceof ProviderSwitchError, 'the drift is a typed failure');
				strictEqual(error.code, 'SELECTION_DRIFT');
				ok(error.message.includes('lane-a'), 'the error names what the decision actually selected');
				ok(error.message.includes('lane-b'), 'the error names the intended target');
			},
		);
		// the drifted act minted NO event (a fabricated switch row would be worse than none)
		strictEqual(await providerSwitchCount(temp.port, `${temp.root}/.flauz/models`), countBefore);
	} finally {
		temp.cleanup();
	}
});

test('P2-FIX-116: a target that is not enabled after the write fails closed (BAD_TARGET)', async () => {
	const temp = makeTempFs();
	try {
		await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-c',
			overrides: [laneOverride('lane-a', true, 9101)],
			policy: lanePolicy('lane-a'),
		}).then(
			() => {
				throw new Error('must not resolve');
			},
			(error: unknown) => {
				ok(error instanceof ProviderSwitchError);
				strictEqual(error.code, 'BAD_TARGET');
			},
		);
		strictEqual(await providerSwitchCount(temp.port, `${temp.root}/.flauz/models`), 0, 'no event row');
	} finally {
		temp.cleanup();
	}
});

test('P2-FIX-116: the three artifacts are genuinely durable after a switch', async () => {
	const temp = makeTempFs();
	try {
		const event = await switchProviderLane({
			root: temp.root,
			fs: temp.port,
			clock: sequencedClock(),
			hash: hashPort,
			targetProviderId: 'lane-b',
			overrides: [laneOverride('lane-a', false, 9101), laneOverride('lane-b', true, 9102)],
			policy: lanePolicy('lane-b'),
		});
		// artifact 1 on disk: the providers file carries the new enablement
		const providersText = await temp.port.readFileUtf8(`${temp.root}/.flauz/models/providers.json`);
		ok(providersText !== undefined);
		const parsed = JSON.parse(providersText) as { providers: Array<{ providerId: string; enabled?: boolean }> };
		const laneB = parsed.providers.find(entry => entry.providerId === 'lane-b');
		const laneA = parsed.providers.find(entry => entry.providerId === 'lane-a');
		strictEqual(laneB?.enabled, true);
		strictEqual(laneA?.enabled, false);
		// artifact 2 on disk: the policy file prefers the new lane
		const policyText = await temp.port.readFileUtf8(`${temp.root}/.flauz/models/routing-policy.json`);
		ok(policyText !== undefined && policyText.includes('lane-b'));
		// artifact 3 on disk: the decision ledger row exists and selected the lane
		const decisions = await listDecisions(temp.port, `${temp.root}/.flauz/models`);
		ok(decisions.some(decision => decision.decisionId === event.routingDecision.decisionId && decision.selected?.providerId === 'lane-b'));
	} finally {
		temp.cleanup();
	}
});
