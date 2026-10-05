/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import * as assert from 'node:assert/strict';
import {
    OBSERVATORY_CONTRACTS_VERSION as PLANMODE_VERSION,
    PLAN_MODE_FORWARD_TRANSITIONS,
    PLAN_MODE_STATES,
    canTransitionPlanMode,
    planContinuityVerdict,
    planModeEvidenceKindOf,
    planModeFromTaskStatus,
    planModeTargets,
    type PlanContinuityRecord,
    type PlanModeTransitionVerdict
} from '../../common/planMode.js';
import { OBSERVATORY_CONTRACTS_VERSION as PHASES_VERSION } from '../../common/phases.js';
import { OBSERVATORY_CONTRACTS_VERSION as RUN_HEALTH_VERSION } from '../../common/runHealth.js';
import { OBSERVATORY_CONTRACTS_VERSION as REPLAY_VERSION } from '../../common/replay.js';

const scope = { workspaceId: 'ws-zc004', tenantId: 'tenant-zc004' };

// SEAM (task-status transcription): mirror every TaskStatus member VERBATIM
// from extensions/flauz-agent/src/types.ts here (the five below are the
// members quoted by ZC-004; the authority union has more). If the authority
// exports a runtime list, import it and delete this local transcription.
// Then set TASK_STATUS_TRANSCRIPTION_COMPLETE to true.
const AUTHORITY_TASK_STATUSES: readonly string[] = [
    'plan',
    'awaiting-approval',
    'execute',
    'verify',
    'awaiting-signoff',
    'failed',
    'done',
    'cancelled'
];
const TASK_STATUS_TRANSCRIPTION_COMPLETE = true;

function expectRefusal(
    verdict: PlanModeTransitionVerdict
): Extract<PlanModeTransitionVerdict, { admissible: false }> {
    assert.strictEqual(verdict.admissible, false, 'expected a refusal, got: ' + JSON.stringify(verdict));
    return verdict as Extract<PlanModeTransitionVerdict, { admissible: false }>;
}

suite('planMode contracts', () => {
    suite('contract set', () => {
        test('all observatory contract modules declare one contract version', () => {
            assert.strictEqual(PLANMODE_VERSION, '1.0.0');
            assert.strictEqual(PHASES_VERSION, PLANMODE_VERSION);
            assert.strictEqual(RUN_HEALTH_VERSION, PLANMODE_VERSION);
            assert.strictEqual(REPLAY_VERSION, PLANMODE_VERSION);
        });
    });

    suite('lifecycle', () => {
        test('states are exactly the frozen plan lifecycle', () => {
            assert.deepStrictEqual([...PLAN_MODE_STATES], [
                'draft',
                'awaiting-approval',
                'approved',
                'executing',
                'superseded'
            ]);
        });

        test('superseded is terminal', () => {
            assert.strictEqual(planModeTargets('superseded').length, 0);
        });

        test('non-supersede edges advance the frozen lifecycle order', () => {
            for (const from of PLAN_MODE_STATES) {
                for (const to of planModeTargets(from)) {
                    if (to === 'superseded') {
                        continue;
                    }
                    assert.ok(
                        PLAN_MODE_STATES.indexOf(to) > PLAN_MODE_STATES.indexOf(from),
                        'edge must advance the lifecycle: ' + from + '->' + to
                    );
                }
            }
        });

        test('every non-terminal state may supersede', () => {
            for (const state of PLAN_MODE_STATES) {
                if (state === 'superseded') {
                    continue;
                }
                assert.ok(
                    planModeTargets(state).includes('superseded'),
                    state + ' must be able to supersede'
                );
            }
        });
    });

    suite('evidence map', () => {
        test('every forward edge carries exactly one evidence kind', () => {
            for (const from of PLAN_MODE_STATES) {
                for (const to of planModeTargets(from)) {
                    const evidenceKind = planModeEvidenceKindOf(from, to);
                    assert.ok(evidenceKind !== undefined, 'missing evidence kind for ' + from + '->' + to);
                }
            }
        });

        test('non-edges carry no evidence kind', () => {
            assert.strictEqual(planModeEvidenceKindOf('executing', 'approved'), undefined);
            assert.strictEqual(planModeEvidenceKindOf('draft', 'executing'), undefined);
            assert.strictEqual(planModeEvidenceKindOf('superseded', 'draft'), undefined);
        });
    });

    suite('canTransitionPlanMode', () => {
        test('every non-supersede forward edge is admissible and evidence-bearing', () => {
            for (const from of PLAN_MODE_STATES) {
                for (const to of planModeTargets(from)) {
                    if (to === 'superseded') {
                        continue;
                    }
                    const verdict = canTransitionPlanMode({ from: from, to: to, evidenceDigest: 'ev-1' });
                    assert.ok(verdict.admissible, from + '->' + to + ' must be admissible: ' + JSON.stringify(verdict));
                }
            }
        });

        test('the ONE demotion law: supersede without a successor digest is refused', () => {
            for (const from of PLAN_MODE_STATES) {
                if (from === 'superseded') {
                    continue;
                }
                const refusal = expectRefusal(
                    canTransitionPlanMode({ from: from, to: 'superseded', evidenceDigest: 'ev-1' })
                );
                assert.strictEqual(refusal.violatedLaw, 'plan-mode-supersede-requires-successor-digest');
            }
        });

        test('supersede with the successor digest is admissible', () => {
            assert.deepStrictEqual(
                canTransitionPlanMode({
                    from: 'executing',
                    to: 'superseded',
                    evidenceDigest: 'ev-1',
                    successorPlanRevisionDigest: 'plan-rev-2'
                }),
                { admissible: true, evidenceKind: 'plan-superseded' }
            );
        });

        test('backward and non-lateral jumps are refused as not-forward', () => {
            for (const from of PLAN_MODE_STATES) {
                for (const to of PLAN_MODE_STATES) {
                    if (to === from || planModeTargets(from).includes(to)) {
                        continue;
                    }
                    const refusal = expectRefusal(
                        canTransitionPlanMode({ from: from, to: to, evidenceDigest: 'ev-1' })
                    );
                    assert.strictEqual(refusal.violatedLaw, 'plan-mode-transition-not-forward');
                }
            }
        });

        test('lateral self-transitions are refused as not-forward', () => {
            for (const state of PLAN_MODE_STATES) {
                const refusal = expectRefusal(
                    canTransitionPlanMode({ from: state, to: state, evidenceDigest: 'ev-1' })
                );
                assert.strictEqual(refusal.violatedLaw, 'plan-mode-transition-not-forward');
            }
        });

        test('evidence-free transitions are refused', () => {
            const refusal = expectRefusal(
                canTransitionPlanMode({ from: 'draft', to: 'awaiting-approval', evidenceDigest: '' })
            );
            assert.strictEqual(refusal.violatedLaw, 'plan-mode-evidence-missing');
        });
    });

    suite('planContinuityVerdict', () => {
        const record: PlanContinuityRecord = {
            scope: scope,
            contractVersion: '1.0.0',
            planId: 'plan-1',
            taskRef: 'task-1',
            pinnedRevisionDigest: 'rev-1',
            pinnedAtIso: '2026-01-01T00:00:00.000Z'
        };

        test('pinned digest match is current', () => {
            assert.deepStrictEqual(planContinuityVerdict(record, 'rev-1'), {
                kind: 'current',
                planRevisionDigest: 'rev-1'
            });
        });

        test('digest drift is a typed drifted verdict, never an exception', () => {
            assert.deepStrictEqual(planContinuityVerdict(record, 'rev-2'), {
                kind: 'drifted',
                violatedLaw: 'plan-revision-drift',
                pinnedRevisionDigest: 'rev-1',
                observedRevisionDigest: 'rev-2'
            });
        });
    });

    suite('planModeFromTaskStatus', () => {
        test('the five ZC-004-quoted authority statuses project by the rule', () => {
            assert.deepStrictEqual(planModeFromTaskStatus('plan'), { planMode: 'draft' });
            assert.deepStrictEqual(planModeFromTaskStatus('awaiting-approval'), {
                planMode: 'awaiting-approval'
            });
            assert.deepStrictEqual(planModeFromTaskStatus('execute'), { planMode: 'executing' });
            assert.deepStrictEqual(planModeFromTaskStatus('verify'), { planMode: 'executing' });
            assert.deepStrictEqual(planModeFromTaskStatus('awaiting-signoff'), { planMode: 'executing' });
        });

        test('unmapped statuses fail closed with the violated law', () => {
            assert.deepStrictEqual(planModeFromTaskStatus('not-a-task-status'), {
                violatedLaw: 'task-status-unmapped',
                taskStatus: 'not-a-task-status'
            });
        });

        test('SEAM: the authority TaskStatus transcription is complete', () => {
            assert.strictEqual(
                TASK_STATUS_TRANSCRIPTION_COMPLETE,
                true,
                'SEAM UNFILLED: transcribe every TaskStatus member VERBATIM from ' +
                    'extensions/flauz-agent/src/types.ts into PLAN_MODE_BY_TASK_STATUS ' +
                    '(common/planMode.ts) using the documented rule, mirror them in ' +
                    'AUTHORITY_TASK_STATUSES above, then set ' +
                    'TASK_STATUS_TRANSCRIPTION_COMPLETE = true. ZC-004 requires a TOTAL projection.'
            );
        });

        test('the projection is total over the transcribed authority TaskStatus list', () => {
            for (const taskStatus of AUTHORITY_TASK_STATUSES) {
                const verdict = planModeFromTaskStatus(taskStatus);
                assert.ok('planMode' in verdict, 'unmapped TaskStatus: ' + taskStatus);
            }
        });
    });
});
