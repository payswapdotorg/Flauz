/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import * as assert from 'node:assert/strict';
import {
    CONCURRENCY_SLOTS,
    OBSERVATORY_CONTRACTS_VERSION,
    STALL_VERDICTS,
    heartMissingAfterMs,
    projectRunHealth,
    stallVerdictForDeltas,
    stalledAfterMs,
    type RunHealthProjectionVerdict,
    type RunHealthTaskRecord,
    type RunHealthView
} from '../../common/runHealth.js';

const scope = { workspaceId: 'ws-zc004', tenantId: 'tenant-zc004' };

function taskRecord(overrides: Partial<RunHealthTaskRecord> = {}): RunHealthTaskRecord {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        taskRef: 'task-1',
        agentTaskState: 'opaque-authority-state',
        lastEventAtMs: 1_000_000,
        lastHeartAtMs: 1_000_000,
        slot: 'in-use',
        ...overrides
    };
}

function expectView(verdict: RunHealthProjectionVerdict): RunHealthView {
    assert.ok(!('kind' in verdict), 'expected a view, got a refusal: ' + JSON.stringify(verdict));
    return verdict as RunHealthView;
}

function expectRefusal(
    verdict: RunHealthProjectionVerdict
): Extract<RunHealthProjectionVerdict, { kind: 'refused' }> {
    assert.ok('kind' in verdict, 'expected a refusal, got a view');
    return verdict as Extract<RunHealthProjectionVerdict, { kind: 'refused' }>;
}

suite('runHealth contracts', () => {
    suite('thresholds', () => {
        test('stall thresholds are exported plain-number constants', () => {
            assert.strictEqual(typeof stalledAfterMs, 'number');
            assert.strictEqual(typeof heartMissingAfterMs, 'number');
            assert.ok(stalledAfterMs > 0);
            assert.ok(heartMissingAfterMs > 0);
        });

        test('the heart-missing threshold is stricter than the stall threshold', () => {
            assert.ok(heartMissingAfterMs > stalledAfterMs);
        });

        test('verdict and slot vocabularies are the frozen as-const lists', () => {
            assert.deepStrictEqual([...STALL_VERDICTS], ['healthy', 'stalled', 'heart-missing']);
            assert.deepStrictEqual([...CONCURRENCY_SLOTS], ['in-use', 'queued']);
        });
    });

    suite('stallVerdictForDeltas', () => {
        test('fresh event and heart deltas are healthy', () => {
            assert.strictEqual(stallVerdictForDeltas(1, 1), 'healthy');
            assert.strictEqual(stallVerdictForDeltas(stalledAfterMs - 1, heartMissingAfterMs - 1), 'healthy');
        });

        test('an event delta at the stall boundary is stalled', () => {
            assert.strictEqual(stallVerdictForDeltas(stalledAfterMs, 1), 'stalled');
        });

        test('an event delta beyond the stall threshold with a fresh heart is stalled', () => {
            assert.strictEqual(stallVerdictForDeltas(stalledAfterMs + 1, 1), 'stalled');
        });

        test('null heart evidence is heart-missing even with fresh events', () => {
            assert.strictEqual(stallVerdictForDeltas(1, null), 'heart-missing');
        });

        test('a heart delta at the heart-missing boundary is heart-missing', () => {
            assert.strictEqual(stallVerdictForDeltas(1, heartMissingAfterMs), 'heart-missing');
            assert.strictEqual(stallVerdictForDeltas(stalledAfterMs, heartMissingAfterMs - 1), 'stalled');
        });

        test('heart-missing wins over stalled', () => {
            assert.strictEqual(
                stallVerdictForDeltas(heartMissingAfterMs, heartMissingAfterMs),
                'heart-missing'
            );
        });
    });

    suite('projectRunHealth - view', () => {
        test('per-task views project state, slot, and verdict with taskRefs in input order', () => {
            const records = [
                taskRecord({ taskRef: 'a', agentTaskState: 'state-x', lastEventAtMs: 1_000_000, lastHeartAtMs: 1_000_000 }),
                taskRecord({ taskRef: 'b', agentTaskState: 'state-y', slot: 'queued', lastEventAtMs: 1_000_000 - stalledAfterMs, lastHeartAtMs: 1_000_000 })
            ];
            const view = expectView(projectRunHealth(records, { nowMs: 1_000_000, concurrencyCapacity: 4 }));
            assert.deepStrictEqual([...view.taskRefs], ['a', 'b']);
            assert.deepStrictEqual([...view.tasks], [
                { taskRef: 'a', agentTaskState: 'state-x', slot: 'in-use', stallVerdict: 'healthy' },
                { taskRef: 'b', agentTaskState: 'state-y', slot: 'queued', stallVerdict: 'stalled' }
            ]);
            assert.deepStrictEqual(view.scope, scope);
            assert.strictEqual(view.contractVersion, '1.0.0');
        });

        test('the concurrency gauge counts slots as plain numbers and passes capacity through', () => {
            const records = [
                taskRecord({ taskRef: 'a', slot: 'in-use' }),
                taskRecord({ taskRef: 'b', slot: 'in-use' }),
                taskRecord({ taskRef: 'c', slot: 'queued' })
            ];
            const view = expectView(projectRunHealth(records, { nowMs: 1_000_001, concurrencyCapacity: 5 }));
            assert.deepStrictEqual(view.concurrency, { capacity: 5, inUse: 2, queued: 1 });
            const single = expectView(projectRunHealth([taskRecord()], { nowMs: 1_000_001, concurrencyCapacity: 1 }));
            assert.deepStrictEqual(single.concurrency, { capacity: 1, inUse: 1, queued: 0 });
        });
    });

    suite('projectRunHealth - fail-closed refusals', () => {
        test('empty input refuses', () => {
            const refusal = expectRefusal(projectRunHealth([], { nowMs: 1_000_001, concurrencyCapacity: 4 }));
            assert.strictEqual(refusal.violatedLaw, 'run-health-empty-input');
        });

        test('scope mismatch refuses', () => {
            const refusal = expectRefusal(
                projectRunHealth(
                    [
                        taskRecord(),
                        taskRecord({ scope: { workspaceId: 'ws-other', tenantId: 'tenant-zc004' } })
                    ],
                    { nowMs: 1_000_001, concurrencyCapacity: 4 }
                )
            );
            assert.strictEqual(refusal.violatedLaw, 'run-health-scope-mismatch');
        });

        test('contract version mismatch refuses', () => {
            const refusal = expectRefusal(
                projectRunHealth([taskRecord({ contractVersion: '0.9.0' })], {
                    nowMs: 1_000_001,
                    concurrencyCapacity: 4
                })
            );
            assert.strictEqual(refusal.violatedLaw, 'run-health-contract-version-mismatch');
        });
    });

    suite('projectRunHealth - determinism', () => {
        test('the same records and observation input project the identical view', () => {
            const records = [
                taskRecord(),
                taskRecord({ taskRef: 'task-2', slot: 'queued', lastHeartAtMs: null })
            ];
            const clock = { nowMs: 1_000_045, concurrencyCapacity: 2 };
            assert.deepStrictEqual(projectRunHealth(records, clock), projectRunHealth(records, clock));
        });
    });
});
