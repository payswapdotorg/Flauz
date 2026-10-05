/*
 * MIT License
 *
 * Copyright (c) 2025 Flauz contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify, merge,
 * publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 * to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE
 * OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * ZC-003 Hook Bus - dispatch contracts tests.
 * Style: mocha tdd (suite/test), node assert, .js import suffixes.
 */

import { strict as assert } from 'node:assert';
import * as dispatch from '../../common/dispatch.js';
import * as registration from '../../common/registration.js';
import type { HookBusScope } from '../../common/dispatch.js';

const SCOPE: HookBusScope = { workspaceId: 'workspace-zc003', tenantId: 'tenant-zc003' };
const ISO = '2025-06-02T12:00:00.000Z';

function seededRegistry(): dispatch.HookRegistry {
    return {
        scope: SCOPE,
        contractVersion: dispatch.HOOK_BUS_CONTRACTS_VERSION,
        hooks: [
            { hookId: 'hook-disabled', kind: 'session', matchSpec: { kinds: ['session'], events: ['session.opened'] }, priority: 50, enabled: false },
            { hookId: 'hook-high', kind: 'session', matchSpec: { kinds: ['session'], events: ['session.opened'] }, priority: 100, enabled: true },
            { hookId: 'hook-approval', kind: 'approval', matchSpec: { kinds: ['approval'], events: ['approval.requested'] }, priority: 100, enabled: true },
            { hookId: 'hook-mid-a', kind: 'session', matchSpec: { kinds: ['session'], events: ['session.opened'] }, priority: 200, enabled: true },
            { hookId: 'hook-mid-b', kind: 'session', matchSpec: { kinds: ['session'], events: ['session.opened'] }, priority: 200, enabled: true },
            { hookId: 'hook-low', kind: 'tool', matchSpec: { kinds: ['tool'], events: ['tool.invoked'] }, priority: 300, enabled: true }
        ]
    };
}

suite('zc003 hook bus dispatch contracts', () => {

    suite('frozen vocabulary parity with the registration contracts', () => {

        test('pins the same six frozen hook kinds', () => {
            assert.deepEqual([...dispatch.HOOK_KINDS], [...registration.HOOK_KINDS]);
        });

        test('pins the same authority event vocabulary', () => {
            assert.deepEqual([...dispatch.AUTHORITY_EVENT_DIGEST], [...registration.AUTHORITY_EVENT_DIGEST]);
        });

        test('pins the same kind-to-digest map', () => {
            for (const kind of dispatch.HOOK_KINDS) {
                assert.deepEqual([...dispatch.KIND_EVENT_DIGESTS[kind]], [...registration.KIND_EVENT_DIGESTS[kind]]);
            }
        });

        test('pins the contract set version', () => {
            assert.equal(dispatch.HOOK_BUS_CONTRACTS_VERSION, '1.0.0');
            assert.equal(dispatch.HOOK_BUS_CONTRACTS_VERSION, registration.HOOK_BUS_CONTRACTS_VERSION);
        });
    });

    suite('event references', () => {

        test('accepts a kind-consistent authority event', () => {
            assert.ok(dispatch.isValidHookEventRef({ kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO }));
        });

        test('rejects kind-inconsistent, unknown, and malformed events', () => {
            assert.ok(!dispatch.isValidHookEventRef({ kind: 'tool', eventDigest: 'session.opened', occurredAtIso: ISO }));
            assert.ok(!dispatch.isValidHookEventRef({ kind: 'banana', eventDigest: 'session.opened', occurredAtIso: ISO }));
            assert.ok(!dispatch.isValidHookEventRef({ kind: 'session', eventDigest: 'session.exploded', occurredAtIso: ISO }));
            assert.ok(!dispatch.isValidHookEventRef({ kind: 'session', eventDigest: 'session.opened', occurredAtIso: 'now' }));
            assert.ok(!dispatch.isValidHookEventRef(null));
        });

        test('matchSpecCoversEvent matches kind and digest', () => {
            const spec: dispatch.HookMatchSpec = { kinds: ['session', 'tool'], events: ['session.opened', 'tool.invoked'] };
            assert.ok(dispatch.matchSpecCoversEvent(spec, { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO }));
            assert.ok(!dispatch.matchSpecCoversEvent(spec, { kind: 'prompt', eventDigest: 'prompt.submitted', occurredAtIso: ISO }));
        });
    });

    suite('composeDispatchPlan', () => {

        test('orders by priority ascending, then registration order, and skips disabled hooks', () => {
            const plan = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.deepEqual([...plan.orderedHookIds], ['hook-high', 'hook-mid-a', 'hook-mid-b']);
        });

        test('pins the full plan for the seeded fixture (determinism)', () => {
            const plan = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.deepEqual(plan, {
                scope: SCOPE,
                contractVersion: '1.0.0',
                eventRef: { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO },
                orderedHookIds: ['hook-high', 'hook-mid-a', 'hook-mid-b'],
                composedAtIso: ISO
            });
        });

        test('same registry and same event compose the same plan', () => {
            const eventRef = { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO };
            const first = dispatch.composeDispatchPlan(seededRegistry(), eventRef);
            const second = dispatch.composeDispatchPlan(seededRegistry(), eventRef);
            assert.ok(dispatch.dispatchPlansEqual(first, second));
            const rebuilt = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.ok(dispatch.dispatchPlansEqual(first, rebuilt));
        });

        test('a different event composes a different plan', () => {
            const first = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            const second = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.closed', occurredAtIso: ISO });
            assert.ok(!dispatch.dispatchPlansEqual(first, second));
        });

        test('filters by match spec: only matching hooks fire', () => {
            const plan = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'tool', eventDigest: 'tool.invoked', occurredAtIso: ISO });
            assert.deepEqual([...plan.orderedHookIds], ['hook-low']);
        });

        test('composes an empty plan for an empty registry', () => {
            const plan = dispatch.composeDispatchPlan({ scope: SCOPE, contractVersion: dispatch.HOOK_BUS_CONTRACTS_VERSION, hooks: [] }, { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.deepEqual([...plan.orderedHookIds], []);
        });

        test('fail-closes: an invalid event reference composes an empty firing order even when a hook would match', () => {
            const registry: dispatch.HookRegistry = {
                scope: SCOPE,
                contractVersion: dispatch.HOOK_BUS_CONTRACTS_VERSION,
                hooks: [
                    { hookId: 'hook-greedy', kind: 'session', matchSpec: { kinds: ['session', 'tool'], events: ['session.opened', 'tool.invoked'] }, priority: 1, enabled: true }
                ]
            };
            const plan = dispatch.composeDispatchPlan(registry, { kind: 'tool', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.deepEqual([...plan.orderedHookIds], []);
            const garbage = dispatch.composeDispatchPlan(registry, 'not-an-event');
            assert.deepEqual([...garbage.orderedHookIds], []);
        });

        test('is total over the six frozen kinds', () => {
            const hooks: dispatch.HookRegistry['hooks'] = dispatch.HOOK_KINDS.map((kind) => ({
                hookId: `hook-${kind}`,
                kind: kind,
                matchSpec: { kinds: [kind], events: dispatch.KIND_EVENT_DIGESTS[kind] },
                priority: 10,
                enabled: true
            }));
            const registry: dispatch.HookRegistry = { scope: SCOPE, contractVersion: dispatch.HOOK_BUS_CONTRACTS_VERSION, hooks: hooks };
            for (const kind of dispatch.HOOK_KINDS) {
                for (const eventDigest of dispatch.KIND_EVENT_DIGESTS[kind]) {
                    const plan = dispatch.composeDispatchPlan(registry, { kind: kind, eventDigest: eventDigest, occurredAtIso: ISO });
                    assert.deepEqual([...plan.orderedHookIds], [`hook-${kind}`], `kind ${kind} digest ${eventDigest} must fire its hook`);
                }
            }
        });
    });

    suite('plan records and cross-module projection', () => {

        test('isHookDispatchPlan accepts a composed plan and rejects tampered plans', () => {
            const plan = dispatch.composeDispatchPlan(seededRegistry(), { kind: 'session', eventDigest: 'session.opened', occurredAtIso: ISO });
            assert.ok(dispatch.isHookDispatchPlan(plan));
            assert.ok(!dispatch.isHookDispatchPlan({ ...plan, contractVersion: '0.9.0' }));
            assert.ok(!dispatch.isHookDispatchPlan({ ...plan, orderedHookIds: ['hook-high', 'hook-high'] }));
            assert.ok(!dispatch.isHookDispatchPlan({ ...plan, composedAtIso: 'whenever' }));
            assert.ok(!dispatch.isHookDispatchPlan(null));
        });

        test('composes plans over a registry built through the registration transitions', () => {
            const descriptor: registration.HookDescriptor = {
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-flow',
                kind: 'prompt',
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['prompt'], events: ['prompt.submitted'] },
                priority: 5,
                enabled: true,
                registeredAtIso: ISO
            };
            const base = registration.emptyHookRegistry(SCOPE);
            const added = registration.register(descriptor, base);
            assert.equal(added.ok, true);
            const plan = dispatch.composeDispatchPlan(added.registry, { kind: 'prompt', eventDigest: 'prompt.submitted', occurredAtIso: ISO });
            assert.deepEqual([...plan.orderedHookIds], ['hook-flow']);
        });
    });
});
