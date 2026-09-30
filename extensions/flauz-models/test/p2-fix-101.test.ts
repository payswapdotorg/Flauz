/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-101 -- regression guards for the fabric's cross-extension
 * typecheck seam (model-fabric test surface).
 *
 * The finding: the flauz-models src surface (discovery/registry.ts,
 * routing/store.ts, routing/policy.ts and the contract/ + adapters/
 * sources they pull in) was not statically importable from a sibling
 * extension's default tsconfig (TS6133 on an unused import in the routing
 * store; TS2304/TS2307 on ambient TextDecoder/AbortSignal/'node:buffer'
 * the consumer's shims do not declare). The fix dropped the unused
 * CapabilityQuery import in routing/store.ts and moved the src surface's
 * ambient needs into src/ambient.d.ts, triple-slash-referenced by the src
 * files that use them, so the declarations travel with the compiled
 * sources.
 *
 * The acceptance receipt itself lives on the consumer side (the
 * flauz-workflow default tsconfig typechecks the journey test's static
 * imports of ModelCapabilityRegistry / ModelRouter / listDecisions /
 * DEFAULT_ROUTING_POLICY). These guards pin the fabric half of the
 * contract: the acceptance surface composes and behaves at runtime, and
 * the runtime reality keeps matching the structural claims of
 * src/ambient.d.ts (if Node's shapes drifted, those declarations would be
 * lying to every consumer config that compiles these sources).
 */

import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';

import { Buffer } from 'node:buffer';
import { ModelCapabilityRegistry } from '../src/discovery/registry.ts';
import { DEFAULT_ROUTING_POLICY } from '../src/routing/policy.ts';
import { listDecisions, ModelRouter } from '../src/routing/store.ts';
import { IncrementalDecoder, throwIfCancelled } from '../src/adapters/common.ts';
import { ProviderError } from '../src/contract/errors.ts';
import { makeTempFs } from './fsPort.ts';

test('P2-FIX-101: the acceptance surface (registry + router + policy + decision ledger) imports statically and behaves', async () => {
	const temp = makeTempFs('flauz-models-p2-fix-101-');
	try {
		const registry = new ModelCapabilityRegistry({ root: temp.root, fs: temp.port, clock: () => 1 });
		await registry.load();
		const router = new ModelRouter({ stateDir: `${temp.root}/.flauz/models`, fs: temp.port, clock: () => 42, records: () => registry.list(), policy: DEFAULT_ROUTING_POLICY });
		const decision = await router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
		strictEqual(decision.selected?.providerId, 'flauz-mock');
		strictEqual(decision.selected?.modelId, 'echo-1');
		strictEqual(decision.ruleId, 'zero-network-default');
		strictEqual(decision.selectionBasis, 'rule-match');
		const stored = await listDecisions(temp.port, `${temp.root}/.flauz/models`);
		strictEqual(stored.length, 1);
		strictEqual(stored[0]?.decisionId, decision.decisionId);
		strictEqual(stored[0]?.decisionId, 'rd-000001');
	} finally {
		temp.cleanup();
	}
});

test('P2-FIX-101: the src/ambient.d.ts claims hold at runtime (node:buffer base64, stream-aware TextDecoder, AbortSignal)', () => {
	// node:buffer: the declared Buffer subset round-trips base64 <-> utf-8
	const encoded = Buffer.from('p2-fix-101', 'utf-8').toString('base64');
	ok(encoded.length > 0);
	strictEqual(Buffer.from(encoded, 'base64').toString('utf-8'), 'p2-fix-101');
	// TextDecoder: stream-aware decode reassembles a multi-byte code point split across chunks
	const decoder = new IncrementalDecoder();
	const first = decoder.push(new Uint8Array([0x41, 0xc3]));
	const second = decoder.push(new Uint8Array([0xa9, 0x42]));
	strictEqual(first + second + decoder.flush(), 'AéB');
	// AbortSignal: the declared members exist and behave on the real global
	const timeout = AbortSignal.timeout(60_000);
	strictEqual(timeout.aborted, false);
	const controller = new AbortController();
	controller.abort();
	strictEqual(controller.signal.aborted, true);
	strictEqual(AbortSignal.any([timeout, controller.signal]).aborted, true);
});

test('P2-FIX-101: throwIfCancelled honors a real aborted AbortSignal (the CANCELLED contract)', () => {
	const controller = new AbortController();
	controller.abort();
	throws(
		() => throwIfCancelled(controller.signal, 'flauz-mock'),
		(error: unknown) => error instanceof ProviderError && error.code === 'CANCELLED' && error.providerId === 'flauz-mock',
	);
	// no signal (or a live one) never throws
	throwIfCancelled(undefined, 'flauz-mock');
	throwIfCancelled(AbortSignal.timeout(60_000), 'flauz-mock');
});
