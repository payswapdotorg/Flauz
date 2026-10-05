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
 * ZC-003 Hook Bus - policy contracts tests.
 * Style: mocha tdd (suite/test), node assert, .js import suffixes.
 */

import { strict as assert } from 'node:assert';
import * as policy from '../../common/policy.js';
import * as registration from '../../common/registration.js';
import * as dispatch from '../../common/dispatch.js';
import * as effects from '../../common/effects.js';
import type { HookBusScope, HookDescriptor } from '../../common/registration.js';

const SCOPE: HookBusScope = { workspaceId: 'workspace-zc003', tenantId: 'tenant-zc003' };
const ISO = '2025-06-04T18:00:00.000Z';

function descriptorWith(effectKind: string): Record<string, unknown> {
    return {
        scope: SCOPE,
        contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
        hookId: 'hook-under-test',
        kind: 'tool',
        effectKind: effectKind,
        matchSpec: { kinds: ['tool'], events: ['tool.invoked'] },
        priority: 1,
        enabled: true,
        registeredAtIso: ISO
    };
}

suite('zc003 hook bus policy contracts', () => {

    suite('the frozen invariant vocabulary', () => {

        test('pins the six invariants by exact name', () => {
            assert.deepEqual([...policy.HOOK_POLICY_INVARIANTS], [
                'no-permission-grant',
                'no-policy-override',
                'no-lease-bypass',
                'no-auto-approval',
                'enrichment-additive-only',
                'approval-request-only'
            ]);
        });

        test('every invariant has a frozen statement', () => {
            for (const invariant of policy.HOOK_POLICY_INVARIANTS) {
                assert.equal(typeof policy.HOOK_POLICY[invariant], 'string');
                assert.ok(policy.HOOK_POLICY[invariant].length > 0);
            }
        });

        test('pins the legal effect vocabulary and version shared with the other contract modules', () => {
            assert.deepEqual([...policy.HOOK_EFFECT_KINDS], [...registration.HOOK_EFFECT_KINDS]);
            assert.deepEqual([...policy.HOOK_EFFECT_KINDS], [...effects.HOOK_EFFECT_KINDS]);
            assert.equal(policy.HOOK_BUS_CONTRACTS_VERSION, '1.0.0');
        });
    });

    suite('checkPolicyInvariants over descriptors', () => {

        test('a legal context-enrichment descriptor passes every invariant, none silently', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('context-enrichment'));
            assert.equal(verdict.ok, true);
            assert.deepEqual(verdict.violations, []);
            assert.equal(verdict.checks.length, policy.HOOK_POLICY_INVARIANTS.length);
            for (const check of verdict.checks) {
                assert.equal(check.passed, true);
                assert.ok(check.detail.length > 0);
            }
        });

        test('a legal approval-request descriptor passes every invariant', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('approval-request'));
            assert.equal(verdict.ok, true);
            assert.deepEqual(verdict.violations, []);
        });

        test('a permission-grant effect violates the exact named invariant plus the exhaustive law', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('permission-grant'));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['no-permission-grant', 'enrichment-additive-only', 'approval-request-only']);
        });

        test('a policy-override effect violates the exact named invariant', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('policy-override'));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['no-policy-override', 'enrichment-additive-only', 'approval-request-only']);
        });

        test('a lease-bypass effect violates the exact named invariant', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('lease-bypass'));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['no-lease-bypass', 'enrichment-additive-only', 'approval-request-only']);
        });

        test('an auto-approval effect violates the exact named invariant', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('auto-approve'));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['no-auto-approval', 'enrichment-additive-only', 'approval-request-only']);
        });

        test('an unknown effect kind violates the exhaustive effect law', () => {
            const verdict = policy.checkPolicyInvariants(descriptorWith('banana'));
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['enrichment-additive-only', 'approval-request-only']);
        });

        test('a descriptor with no readable declared effect fails every invariant (fail-closed)', () => {
            const verdict = policy.checkPolicyInvariants({ scope: SCOPE });
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, [...policy.HOOK_POLICY_INVARIANTS]);
            const notAnObject = policy.checkPolicyInvariants('nope');
            assert.equal(notAnObject.ok, false);
            assert.deepEqual(notAnObject.violations, [...policy.HOOK_POLICY_INVARIANTS]);
        });
    });

    suite('checkPlanPolicy over plans and registries', () => {

        function registryWith(hooks: Record<string, unknown>[]): Record<string, unknown> {
            return { scope: SCOPE, contractVersion: registration.HOOK_REGISTRY_VERSION, hooks: hooks };
        }

        function planWith(orderedHookIds: string[], scope: registration.HookBusScope = SCOPE): Record<string, unknown> {
            return {
                scope: scope,
                contractVersion: dispatch.HOOK_BUS_CONTRACTS_VERSION,
                eventRef: { kind: 'tool', eventDigest: 'tool.invoked', occurredAtIso: ISO },
                orderedHookIds: orderedHookIds,
                composedAtIso: ISO
            };
        }

        test('a plan firing only legal hooks passes every invariant', () => {
            const registry = registryWith([
                descriptorWith('context-enrichment'),
                { ...descriptorWith('approval-request'), hookId: 'hook-guard' }
            ]);
            const verdict = policy.checkPlanPolicy(planWith(['hook-under-test', 'hook-guard']), registry);
            assert.equal(verdict.ok, true);
            assert.deepEqual(verdict.violations, []);
            assert.equal(verdict.checks.length, policy.HOOK_POLICY_INVARIANTS.length);
        });

        test('a plan firing a poison hook denies with the exact violated invariants', () => {
            const registry = registryWith([descriptorWith('permission-grant')]);
            const verdict = policy.checkPlanPolicy(planWith(['hook-under-test']), registry);
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, ['no-permission-grant', 'enrichment-additive-only', 'approval-request-only']);
        });

        test('a plan referencing an unregistered hook fails every invariant (fail-closed)', () => {
            const registry = registryWith([descriptorWith('context-enrichment')]);
            const verdict = policy.checkPlanPolicy(planWith(['hook-ghost']), registry);
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, [...policy.HOOK_POLICY_INVARIANTS]);
        });

        test('a plan whose scope does not match the registry fails every invariant', () => {
            const registry = registryWith([descriptorWith('context-enrichment')]);
            const verdict = policy.checkPlanPolicy(planWith(['hook-under-test'], { workspaceId: 'workspace-other', tenantId: 'tenant-zc003' }), registry);
            assert.equal(verdict.ok, false);
            assert.deepEqual(verdict.violations, [...policy.HOOK_POLICY_INVARIANTS]);
        });

        test('an empty plan passes every invariant vacuously but explicitly', () => {
            const registry = registryWith([descriptorWith('context-enrichment')]);
            const verdict = policy.checkPlanPolicy(planWith([]), registry);
            assert.equal(verdict.ok, true);
            assert.equal(verdict.checks.length, policy.HOOK_POLICY_INVARIANTS.length);
            for (const check of verdict.checks) {
                assert.equal(check.passed, true);
                assert.ok(check.detail.length > 0);
            }
        });

        test('malformed plans and registries fail every invariant (fail-closed)', () => {
            const verdict = policy.checkPlanPolicy('nope', registryWith([]));
            assert.equal(verdict.ok, false);
            const verdictTwo = policy.checkPlanPolicy({ scope: SCOPE, orderedHookIds: 'hook-under-test' }, registryWith([]));
            assert.equal(verdictTwo.ok, false);
            const verdictThree = policy.checkPlanPolicy({ scope: SCOPE, orderedHookIds: [] }, 'nope');
            assert.equal(verdictThree.ok, false);
        });

        test('certifies plans composed by the dispatch contracts over registered hooks', () => {
            const descriptor: HookDescriptor = {
                scope: SCOPE,
                contractVersion: registration.HOOK_BUS_CONTRACTS_VERSION,
                hookId: 'hook-terminal-guard',
                kind: 'tool',
                effectKind: 'approval-request',
                matchSpec: { kinds: ['tool'], events: ['tool.invoked'] },
                priority: 10,
                enabled: true,
                registeredAtIso: ISO
            };
            const added = registration.register(descriptor, registration.emptyHookRegistry(SCOPE));
            assert.equal(added.ok, true);
            const plan = dispatch.composeDispatchPlan(added.registry, { kind: 'tool', eventDigest: 'tool.invoked', occurredAtIso: ISO });
            const verdict = policy.checkPlanPolicy(plan, added.registry);
            assert.equal(verdict.ok, true);
        });
    });
});
