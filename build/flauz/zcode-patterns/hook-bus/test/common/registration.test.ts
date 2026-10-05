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
 * ZC-003 Hook Bus - registration contracts tests.
 * Style: mocha tdd (suite/test), node assert, .js import suffixes.
 */

import { strict as assert } from 'node:assert';
import * as registration from '../../common/registration.js';
import type { HookBusScope, HookDescriptor, HookRegistry } from '../../common/registration.js';

const SCOPE: HookBusScope = { workspaceId: 'workspace-zc003', tenantId: 'tenant-zc003' };
const ISO = '2025-06-01T00:00:00.000Z';

function makeDescriptor(overrides?: Partial<HookDescriptor>): HookDescriptor {
    return {
        scope: SCOPE,
        contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
        hookId: 'hook-a',
        kind: 'session',
        effectKind: 'context-enrichment',
        matchSpec: { kinds: ['session'], events: ['session.opened'] },
        priority: 100,
        enabled: true,
        registeredAtIso: ISO,
        ...overrides
    };
}

suite('zc003 hook bus registration contracts', () => {

    suite('frozen vocabulary', () => {

        test('pins the six frozen hook kinds', () => {
            assert.deepEqual([...registration.HOOK_KINDS], ['session', 'prompt', 'tool', 'approval', 'post-tool', 'finalization']);
        });

        test('pins the version constants', () => {
            assert.equal(registration.HOOK_BUS_CONTRACTS_VERSION, '1.0.0');
            assert.equal(registration.HOOK_REGISTRY_VERSION, '1.0.0');
        });

        test('every kind observes a nonempty set of authority event digests inside the vocabulary', () => {
            for (const kind of registration.HOOK_KINDS) {
                const digests = registration.KIND_EVENT_DIGESTS[kind];
                assert.ok(digests.length > 0, `kind ${kind} must observe at least one digest`);
                for (const digest of digests) {
                    assert.ok(registration.isAuthorityEventDigest(digest), `digest ${digest} must be in the vocabulary`);
                }
            }
        });

        test('every vocabulary digest is covered by at least one kind', () => {
            for (const digest of registration.AUTHORITY_EVENT_DIGEST) {
                const covered = registration.HOOK_KINDS.some((kind) => registration.kindCoversEventDigest(kind, digest));
                assert.ok(covered, `digest ${digest} must be covered`);
            }
        });

        test('pins the two legal effect kinds and the per-kind effect lanes', () => {
            assert.deepEqual([...registration.HOOK_EFFECT_KINDS], ['context-enrichment', 'approval-request']);
            for (const kind of registration.HOOK_KINDS) {
                const lanes = registration.KIND_EFFECT_LANES[kind];
                assert.ok(lanes.includes('context-enrichment'), `kind ${kind} must allow context-enrichment`);
            }
            assert.ok(registration.KIND_EFFECT_LANES.tool.includes('approval-request'));
            assert.ok(registration.KIND_EFFECT_LANES.approval.includes('approval-request'));
            assert.ok(!registration.KIND_EFFECT_LANES.session.includes('approval-request'));
        });
    });

    suite('guards', () => {

        test('isHookKind accepts the six kinds and rejects everything else', () => {
            for (const kind of registration.HOOK_KINDS) {
                assert.ok(registration.isHookKind(kind));
            }
            assert.ok(!registration.isHookKind('banana'));
            assert.ok(!registration.isHookKind(42));
            assert.ok(!registration.isHookKind(undefined));
        });

        test('isAuthorityEventDigest accepts the vocabulary and rejects unknown digests', () => {
            assert.ok(registration.isAuthorityEventDigest('session.opened'));
            assert.ok(registration.isAuthorityEventDigest('task.awaiting-approval'));
            assert.ok(registration.isAuthorityEventDigest('task.awaiting-signoff'));
            assert.ok(!registration.isAuthorityEventDigest('session.exploded'));
            assert.ok(!registration.isAuthorityEventDigest(null));
        });

        test('isHookMatchSpec rejects empty, unknown, duplicate, and orphan shapes', () => {
            assert.ok(registration.isHookMatchSpec({ kinds: ['session'], events: ['session.opened'] }));
            assert.ok(registration.isHookMatchSpec({ kinds: ['session', 'tool'], events: ['session.opened', 'tool.invoked'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: [], events: ['session.opened'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session'], events: [] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['banana'], events: ['session.opened'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session'], events: ['session.exploded'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session', 'session'], events: ['session.opened'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session'], events: ['session.opened', 'session.opened'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session', 'tool'], events: ['session.opened'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session'], events: ['session.opened', 'tool.invoked'] }));
            assert.ok(!registration.isHookMatchSpec({ kinds: ['session', 'approval'], events: ['session.opened'] }));
            assert.ok(!registration.isHookMatchSpec(null));
        });

        test('isHookDescriptor accepts a valid descriptor and rejects malformed records', () => {
            assert.ok(registration.isHookDescriptor(makeDescriptor()));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ contractVersion: '0.9.0' })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ hookId: '' })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ priority: 1.5 })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ priority: Number.NaN })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ enabled: 'yes' as unknown as boolean })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ registeredAtIso: 'yesterday' })));
            assert.ok(!registration.isHookDescriptor(makeDescriptor({ scope: { workspaceId: '', tenantId: 't' } })));
            assert.ok(!registration.isHookDescriptor(null));
        });

        test('isHookRegistry accepts the empty registry and rejects malformed ones', () => {
            const registry = registration.emptyHookRegistry(SCOPE);
            assert.ok(registration.isHookRegistry(registry));
            assert.ok(!registration.isHookRegistry({ scope: SCOPE, contractVersion: '0.9.0', hooks: [] }));
            assert.ok(!registration.isHookRegistry({ scope: SCOPE, contractVersion: registration.HOOK_REGISTRY_VERSION, hooks: [makeDescriptor({ contractVersion: '0.9.0' })] }));
            assert.ok(!registration.isHookRegistry(null));
        });
    });

    suite('canRegister', () => {

        test('accepts a valid descriptor into an empty registry', () => {
            const verdict = registration.canRegister(makeDescriptor(), registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, true);
            assert.deepEqual(verdict.violations, []);
        });

        test('accepts a valid approval-request descriptor on a tool hook', () => {
            const descriptor = makeDescriptor({
                hookId: 'hook-terminal-guard',
                kind: 'tool',
                effectKind: 'approval-request',
                matchSpec: { kinds: ['tool'], events: ['tool.invoked'] }
            });
            const verdict = registration.canRegister(descriptor, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, true);
        });

        test('rejects a duplicate hook id with the exact violation name', () => {
            const base = registration.emptyHookRegistry(SCOPE);
            const added = registration.register(makeDescriptor(), base);
            assert.equal(added.ok, true);
            const verdict = registration.canRegister(makeDescriptor(), added.registry);
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['duplicate-hook-id']);
        });

        test('rejects an unknown hook kind with the exact violation names', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-x',
                kind: 'banana',
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['banana'], events: ['session.opened'] },
                priority: 1,
                enabled: true,
                registeredAtIso: ISO
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['invalid-hook-kind', 'invalid-match-spec']);
        });

        test('rejects an orphan match spec with the exact violation name', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-x',
                kind: 'session',
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['session'], events: ['session.opened', 'tool.invoked'] },
                priority: 1,
                enabled: true,
                registeredAtIso: ISO
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['invalid-match-spec']);
        });

        test('rejects a match spec that does not cover the hook own kind', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-x',
                kind: 'prompt',
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['session'], events: ['session.opened'] },
                priority: 1,
                enabled: true,
                registeredAtIso: ISO
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['invalid-match-spec']);
        });

        test('rejects a permission-grant effect kind with the exact violation name', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-x',
                kind: 'tool',
                effectKind: 'permission-grant',
                matchSpec: { kinds: ['tool'], events: ['tool.invoked'] },
                priority: 1,
                enabled: true,
                registeredAtIso: ISO
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['illegal-effect']);
        });

        test('rejects an approval-request effect outside its lane with the exact violation name', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-x',
                kind: 'session',
                effectKind: 'approval-request',
                matchSpec: { kinds: ['session'], events: ['session.opened'] },
                priority: 1,
                enabled: true,
                registeredAtIso: ISO
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['illegal-effect']);
        });

        test('rejects a non-object descriptor', () => {
            const verdict = registration.canRegister('not-a-descriptor', registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['invalid-descriptor']);
        });

        test('rejects a malformed descriptor shell with the exact violation name', () => {
            const verdict = registration.canRegister({
                scope: SCOPE,
                contractVersion: '0.0.1',
                hookId: 'hook-x',
                kind: 'session',
                effectKind: 'context-enrichment',
                matchSpec: { kinds: ['session'], events: ['session.opened'] },
                priority: 1,
                enabled: true,
                registeredAtIso: 'not-a-timestamp'
            }, registration.emptyHookRegistry(SCOPE));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['invalid-descriptor']);
        });
    });

    suite('register and withdraw transitions', () => {

        test('register appends the descriptor and never mutates the source registry', () => {
            const base = registration.emptyHookRegistry(SCOPE);
            const added = registration.register(makeDescriptor(), base);
            assert.equal(added.ok, true);
            assert.equal(base.hooks.length, 0);
            assert.equal(added.registry.hooks.length, 1);
            assert.notEqual(added.registry, base);
            assert.ok(registration.isHookRegistry(added.registry));
        });

        test('registration order is append order', () => {
            let registry = registration.emptyHookRegistry(SCOPE);
            for (const hookId of ['hook-a', 'hook-b', 'hook-c']) {
                const result = registration.register(makeDescriptor({ hookId: hookId }), registry);
                assert.equal(result.ok, true);
                registry = result.registry;
            }
            assert.deepEqual(registry.hooks.map((hook) => hook.hookId), ['hook-a', 'hook-b', 'hook-c']);
        });

        test('register fail-closes on an illegal descriptor and returns the same registry reference', () => {
            const base = registration.emptyHookRegistry(SCOPE);
            const first = registration.register(makeDescriptor(), base);
            assert.equal(first.ok, true);
            const second = registration.register(makeDescriptor(), first.registry);
            assert.equal(second.ok, false);
            assert.equal(second.registry, first.registry);
            assert.equal(first.registry.hooks.length, 1);
        });

        test('withdraw removes a hook and preserves the registration order of the rest', () => {
            let registry = registration.emptyHookRegistry(SCOPE);
            for (const hookId of ['hook-a', 'hook-b', 'hook-c']) {
                const result = registration.register(makeDescriptor({ hookId: hookId }), registry);
                assert.equal(result.ok, true);
                registry = result.registry;
            }
            const withdrawn = registration.withdraw('hook-b', registry);
            assert.equal(withdrawn.ok, true);
            assert.deepEqual(withdrawn.registry.hooks.map((hook) => hook.hookId), ['hook-a', 'hook-c']);
            assert.equal(registry.hooks.length, 3);
        });

        test('withdraw fail-closes on an unknown hook id', () => {
            const base = registration.emptyHookRegistry(SCOPE);
            const result = registration.withdraw('hook-missing', base);
            assert.equal(result.ok, false);
            assert.equal(result.registry, base);
            assert.deepEqual(result.violations, ['unknown-hook-id']);
        });

        test('withdraw(register(descriptor)) returns to the original transition state', () => {
            const base = registration.emptyHookRegistry(SCOPE);
            const added = registration.register(makeDescriptor(), base);
            assert.equal(added.ok, true);
            const removed = registration.withdraw('hook-a', added.registry);
            assert.equal(removed.ok, true);
            assert.ok(registration.registryTransitionsEqual(removed.registry, base));
        });
    });

    suite('registryTransitionsEqual', () => {

        test('structurally rebuilt registries are the same transition state', () => {
            const a = registration.emptyHookRegistry(SCOPE);
            const b: HookRegistry = { scope: { workspaceId: SCOPE.workspaceId, tenantId: SCOPE.tenantId }, contractVersion: registration.HOOK_REGISTRY_VERSION, hooks: [] };
            assert.ok(registration.registryTransitionsEqual(a, b));
        });

        test('registration order distinguishes transition states', () => {
            let forward = registration.emptyHookRegistry(SCOPE);
            for (const hookId of ['hook-a', 'hook-b']) {
                const result = registration.register(makeDescriptor({ hookId: hookId, priority: 50 }), forward);
                forward = result.registry;
            }
            let reverse = registration.emptyHookRegistry(SCOPE);
            for (const hookId of ['hook-b', 'hook-a']) {
                const result = registration.register(makeDescriptor({ hookId: hookId, priority: 50 }), reverse);
                reverse = result.registry;
            }
            assert.ok(!registration.registryTransitionsEqual(forward, reverse));
        });

        test('descriptor field differences distinguish transition states', () => {
            const a = registration.register(makeDescriptor({ priority: 10 }), registration.emptyHookRegistry(SCOPE));
            const b = registration.register(makeDescriptor({ priority: 20 }), registration.emptyHookRegistry(SCOPE));
            assert.ok(!registration.registryTransitionsEqual(a.registry, b.registry));
        });
    });
});
