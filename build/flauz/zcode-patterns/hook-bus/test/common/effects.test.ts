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
 * ZC-003 Hook Bus - effect contracts tests.
 * Style: mocha tdd (suite/test), node assert, .js import suffixes.
 */

import { strict as assert } from 'node:assert';
import * as effects from '../../common/effects.js';
import * as registration from '../../common/registration.js';
import * as dispatch from '../../common/dispatch.js';

const ISO = '2025-06-03T09:30:00.000Z';

suite('zc003 hook bus effect contracts', () => {

    suite('frozen vocabulary parity', () => {

        test('pins the two legal effect kinds across modules', () => {
            assert.deepEqual([...effects.HOOK_EFFECT_KINDS], ['context-enrichment', 'approval-request']);
            assert.deepEqual([...effects.HOOK_EFFECT_KINDS], [...registration.HOOK_EFFECT_KINDS]);
        });

        test('pins the authority vocabulary shared with the other contract modules', () => {
            assert.deepEqual([...effects.AUTHORITY_EVENT_DIGEST], [...registration.AUTHORITY_EVENT_DIGEST]);
            assert.deepEqual([...effects.AUTHORITY_EVENT_DIGEST], [...dispatch.AUTHORITY_EVENT_DIGEST]);
            assert.deepEqual([...effects.HOOK_KINDS], [...registration.HOOK_KINDS]);
        });

        test('pins the contract set version', () => {
            assert.equal(effects.HOOK_BUS_CONTRACTS_VERSION, '1.0.0');
            assert.equal(effects.HOOK_BUS_CONTRACTS_VERSION, registration.HOOK_BUS_CONTRACTS_VERSION);
        });
    });

    suite('the fail-closed effect union', () => {

        test('accepts the two legal effect shapes', () => {
            assert.ok(effects.isLegalHookEffect({ effectKind: 'context-enrichment', entries: [{ key: 'doc', digest: 'sha:abc' }] }));
            assert.ok(effects.isLegalHookEffect({ effectKind: 'approval-request', approvalTargetDigest: 'terminal-tool:rm-rf', reason: 'destructive command needs human confirmation' }));
        });

        test('rejects every bypass-granting shape: permission grant, policy override, lease bypass, auto-approval', () => {
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'permission-grant', permission: 'terminal' }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'policy-override', policy: 'allow-all' }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'lease-bypass', lease: 'write' }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'auto-approve', target: 'terminal-tool' }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'approval-decision', approved: true }));
            assert.ok(!effects.isLegalHookEffect(null));
            assert.ok(!effects.isLegalHookEffect('enrich'));
        });

        test('rejects malformed legal-kind shapes (no silent passes)', () => {
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'context-enrichment', entries: [] }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'context-enrichment', entries: [{ key: 'a', digest: 'x' }, { key: 'a', digest: 'y' }] }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'context-enrichment', entries: [{ key: '', digest: 'x' }] }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'approval-request', approvalTargetDigest: '', reason: 'needs review' }));
            assert.ok(!effects.isLegalHookEffect({ effectKind: 'approval-request', approvalTargetDigest: 'terminal-tool', reason: '' }));
        });

        test('an approval request carries a target and a reason, never a decision or permission', () => {
            const request = { effectKind: 'approval-request', approvalTargetDigest: 'terminal-tool:delete', reason: 'human sign-off required' } as const;
            assert.ok(effects.isApprovalRequest(request));
            const keys = Object.keys(request).sort();
            assert.deepEqual(keys, ['approvalTargetDigest', 'effectKind', 'reason']);
        });
    });

    suite('the enrichment merge law', () => {

        test('merges disjoint entries into one additive effect, normalized by key', () => {
            const a = { effectKind: 'context-enrichment', entries: [{ key: 'zeta', digest: 'sha:z' }, { key: 'alpha', digest: 'sha:a' }] };
            const b = { effectKind: 'context-enrichment', entries: [{ key: 'mid', digest: 'sha:m' }] };
            const merged = effects.mergeEnrichments(a, b);
            assert.equal(merged.ok, true);
            if (merged.ok) {
                assert.deepEqual([...merged.effect.entries], [
                    { key: 'alpha', digest: 'sha:a' },
                    { key: 'mid', digest: 'sha:m' },
                    { key: 'zeta', digest: 'sha:z' }
                ]);
            }
        });

        test('the merge is commutative', () => {
            const a = { effectKind: 'context-enrichment', entries: [{ key: 'zeta', digest: 'sha:z' }, { key: 'alpha', digest: 'sha:a' }] };
            const b = { effectKind: 'context-enrichment', entries: [{ key: 'mid', digest: 'sha:m' }] };
            const forward = effects.mergeEnrichments(a, b);
            const backward = effects.mergeEnrichments(b, a);
            assert.equal(forward.ok, true);
            assert.equal(backward.ok, true);
            if (forward.ok && backward.ok) {
                assert.ok(effects.contextEnrichmentsEqual(forward.effect, backward.effect));
            }
        });

        test('duplicate keys reject with the typed failure, never last-wins', () => {
            const a = { effectKind: 'context-enrichment', entries: [{ key: 'alpha', digest: 'sha:a' }] };
            const b = { effectKind: 'context-enrichment', entries: [{ key: 'alpha', digest: 'sha:a' }, { key: 'beta', digest: 'sha:b' }] };
            const merged = effects.mergeEnrichments(a, b);
            assert.equal(merged.ok, false);
            if (!merged.ok) {
                assert.equal(merged.failure, 'duplicate-enrichment-key');
                assert.deepEqual([...merged.duplicateKeys], ['alpha']);
            }
        });

        test('identical duplicate keys still reject (no overwrite, even idempotent ones)', () => {
            const a = { effectKind: 'context-enrichment', entries: [{ key: 'alpha', digest: 'sha:same' }] };
            const b = { effectKind: 'context-enrichment', entries: [{ key: 'alpha', digest: 'sha:same' }] };
            const merged = effects.mergeEnrichments(a, b);
            assert.equal(merged.ok, false);
            if (!merged.ok) {
                assert.equal(merged.failure, 'duplicate-enrichment-key');
            }
        });

        test('rejects invalid enrichment inputs with the typed failure', () => {
            const merged = effects.mergeEnrichments({ effectKind: 'context-enrichment', entries: [] }, { effectKind: 'context-enrichment', entries: [{ key: 'a', digest: 'x' }] });
            assert.equal(merged.ok, false);
            if (!merged.ok) {
                assert.equal(merged.failure, 'invalid-enrichment-effect');
            }
            const poisoned = effects.mergeEnrichments({ effectKind: 'permission-grant' }, { effectKind: 'context-enrichment', entries: [{ key: 'a', digest: 'x' }] });
            assert.equal(poisoned.ok, false);
        });
    });

    suite('effect application records', () => {

        test('accepts a persisted application of a legal effect under a plan reference', () => {
            const application = {
                scope: { workspaceId: 'workspace-zc003', tenantId: 'tenant-zc003' },
                contractVersion: effects.HOOK_BUS_CONTRACTS_VERSION,
                planRef: { eventKind: 'tool', eventDigest: 'tool.invoked', occurredAtIso: ISO, orderedHookIds: ['hook-terminal-guard'] },
                effect: { effectKind: 'approval-request', approvalTargetDigest: 'terminal-tool:rm', reason: 'destructive command' },
                appliedAtIso: ISO
            };
            assert.ok(effects.isEffectApplication(application));
        });

        test('rejects applications with wrong versions, illegal effects, or broken plan references', () => {
            const application = {
                scope: { workspaceId: 'workspace-zc003', tenantId: 'tenant-zc003' },
                contractVersion: effects.HOOK_BUS_CONTRACTS_VERSION,
                planRef: { eventKind: 'tool', eventDigest: 'tool.invoked', occurredAtIso: ISO, orderedHookIds: ['hook-terminal-guard'] },
                effect: { effectKind: 'approval-request', approvalTargetDigest: 'terminal-tool:rm', reason: 'destructive command' },
                appliedAtIso: ISO
            };
            assert.ok(!effects.isEffectApplication({ ...application, contractVersion: '0.9.0' }));
            assert.ok(!effects.isEffectApplication({ ...application, effect: { effectKind: 'auto-approve', target: 'terminal-tool' } }));
            assert.ok(!effects.isEffectApplication({ ...application, planRef: { ...application.planRef, eventDigest: 'session.opened' } }));
            assert.ok(!effects.isEffectApplication({ ...application, appliedAtIso: 'later' }));
        });

        test('equality helpers distinguish effects', () => {
            const a = { effectKind: 'context-enrichment', entries: [{ key: 'k', digest: 'd' }] } as const;
            const b = { effectKind: 'context-enrichment', entries: [{ key: 'k', digest: 'd' }] } as const;
            const c = { effectKind: 'context-enrichment', entries: [{ key: 'k', digest: 'other' }] } as const;
            assert.ok(effects.contextEnrichmentsEqual(a, b));
            assert.ok(!effects.contextEnrichmentsEqual(a, c));
            const requestA = { effectKind: 'approval-request', approvalTargetDigest: 't', reason: 'r' } as const;
            const requestB = { effectKind: 'approval-request', approvalTargetDigest: 't', reason: 'r' } as const;
            const requestC = { effectKind: 'approval-request', approvalTargetDigest: 't', reason: 'other' } as const;
            assert.ok(effects.approvalRequestsEqual(requestA, requestB));
            assert.ok(!effects.approvalRequestsEqual(requestA, requestC));
            assert.ok(effects.hookEffectsEqual(requestA, requestB));
            assert.ok(!effects.hookEffectsEqual(requestA, requestC));
            assert.ok(!effects.hookEffectsEqual(a, requestA));
        });
    });
});
