/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import * as assert from 'node:assert/strict';
import {
    OBSERVATORY_CONTRACTS_VERSION,
    coldReplayAdmissible,
    replayDigest,
    replayEventCovered,
    replayPlanAdmissible,
    selectReplaySlice,
    type ReplayCursor,
    type ReplayDigest,
    type ReplayDigestVerdict,
    type ReplayFilter,
    type ReplayJournalEvent,
    type ReplayPlan,
    type ReplayPlanVerdict,
    type ReplaySliceVerdict
} from '../../common/replay.js';

const scope = { workspaceId: 'ws-zc004', tenantId: 'tenant-zc004' };
const EMPTY_FILTER: ReplayFilter = { agentTaskStates: [], eventKinds: [] };

/** The pinned fixture journal (kinds/states are opaque to the projection). */
function journalEvent(
    position: number,
    kind: string,
    agentTaskState: string,
    eventDigest: string
): ReplayJournalEvent {
    return {
        position: position,
        kind: kind,
        agentTaskState: agentTaskState,
        eventDigest: eventDigest,
        emittedAtIso: '2026-01-01T00:00:0' + position + '.000Z'
    };
}

const FIXTURE_JOURNAL: readonly ReplayJournalEvent[] = [
    journalEvent(0, 'kind-a', 'state-1', 'evt-0000'),
    journalEvent(1, 'kind-b', 'state-1', 'evt-0001'),
    journalEvent(2, 'kind-a', 'state-2', 'evt-0002'),
    journalEvent(3, 'kind-c', 'state-2', 'evt-0003'),
    journalEvent(4, 'kind-b', 'state-3', 'evt-0004'),
    journalEvent(5, 'kind-a', 'state-2', 'evt-0005')
];

function cursor(position: number, pinnedEventDigest: string): ReplayCursor {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        journalPosition: position,
        pinnedEventDigest: pinnedEventDigest
    };
}

function replayPlanFor(startPosition: number, endPosition: number, filter: ReplayFilter): ReplayPlan {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        startCursor: cursor(startPosition, 'evt-000' + startPosition),
        endCursor: cursor(endPosition, 'evt-000' + endPosition),
        filter: filter
    };
}

function expectDigest(verdict: ReplayDigestVerdict): ReplayDigest {
    assert.ok(!('kind' in verdict), 'expected a digest, got a refusal: ' + JSON.stringify(verdict));
    return verdict as ReplayDigest;
}

function expectDigestRefusal(
    verdict: ReplayDigestVerdict
): Extract<ReplayDigestVerdict, { kind: 'refused' }> {
    assert.ok('kind' in verdict, 'expected a refusal, got a digest');
    return verdict as Extract<ReplayDigestVerdict, { kind: 'refused' }>;
}

function expectPlanRefusal(
    verdict: ReplayPlanVerdict
): Extract<ReplayPlanVerdict, { admissible: false }> {
    assert.strictEqual(verdict.admissible, false, 'expected a refusal, got: ' + JSON.stringify(verdict));
    return verdict as Extract<ReplayPlanVerdict, { admissible: false }>;
}

function expectSelected(verdict: ReplaySliceVerdict): readonly ReplayJournalEvent[] {
    assert.strictEqual(verdict.kind, 'selected', 'expected a selection, got: ' + JSON.stringify(verdict));
    return verdict.kind === 'selected' ? verdict.events : [];
}

function expectSliceRefusal(
    verdict: ReplaySliceVerdict
): Extract<ReplaySliceVerdict, { kind: 'refused' }> {
    assert.strictEqual(verdict.kind, 'refused', 'expected a refusal, got a selection');
    return verdict as Extract<ReplaySliceVerdict, { kind: 'refused' }>;
}

suite('replay contracts', () => {
    suite('replayPlanAdmissible', () => {
        test('a well-formed plan is admissible', () => {
            assert.deepStrictEqual(replayPlanAdmissible(replayPlanFor(1, 4, EMPTY_FILTER)), {
                admissible: true
            });
        });

        test('an end cursor before the start cursor is refused', () => {
            const refusal = expectPlanRefusal(replayPlanAdmissible(replayPlanFor(4, 1, EMPTY_FILTER)));
            assert.strictEqual(refusal.violatedLaw, 'replay-plan-cursor-order');
        });

        test('a scope mismatch between plan and cursors is refused', () => {
            const base = replayPlanFor(1, 4, EMPTY_FILTER);
            const mismatched = {
                ...base,
                endCursor: { ...base.endCursor, scope: { workspaceId: 'ws-other', tenantId: 'tenant-zc004' } }
            };
            const refusal = expectPlanRefusal(replayPlanAdmissible(mismatched));
            assert.strictEqual(refusal.violatedLaw, 'replay-plan-scope-mismatch');
        });

        test('a contract version mismatch is refused', () => {
            const base = replayPlanFor(1, 4, EMPTY_FILTER);
            const refusal = expectPlanRefusal(replayPlanAdmissible({ ...base, contractVersion: '0.9.0' }));
            assert.strictEqual(refusal.violatedLaw, 'replay-plan-contract-version-mismatch');
        });

        test('a cursor with a negative position or an empty pinned digest is refused', () => {
            const base = replayPlanFor(1, 4, EMPTY_FILTER);
            const negative = expectPlanRefusal(
                replayPlanAdmissible({ ...base, startCursor: { ...base.startCursor, journalPosition: -1 } })
            );
            assert.strictEqual(negative.violatedLaw, 'replay-plan-cursor-invalid');
            const unpinned = expectPlanRefusal(
                replayPlanAdmissible({ ...base, startCursor: { ...base.startCursor, pinnedEventDigest: '' } })
            );
            assert.strictEqual(unpinned.violatedLaw, 'replay-plan-cursor-invalid');
        });
    });

    suite('replayEventCovered', () => {
        test('empty filter lists cover every authority event', () => {
            const plan = replayPlanFor(0, 5, EMPTY_FILTER);
            for (const event of FIXTURE_JOURNAL) {
                assert.ok(replayEventCovered(event, plan), 'event ' + event.position + ' must be covered');
            }
        });

        test('state filters cover only the selected authority states', () => {
            const plan = replayPlanFor(0, 5, { agentTaskStates: ['state-2'], eventKinds: [] });
            const covered = FIXTURE_JOURNAL.filter((event) => replayEventCovered(event, plan));
            assert.deepStrictEqual(covered.map((event) => event.position), [2, 3, 5]);
        });

        test('kind filters cover only the selected event kinds', () => {
            const plan = replayPlanFor(0, 5, { agentTaskStates: [], eventKinds: ['kind-a'] });
            const covered = FIXTURE_JOURNAL.filter((event) => replayEventCovered(event, plan));
            assert.deepStrictEqual(covered.map((event) => event.position), [0, 2, 5]);
        });

        test('events outside the cursor window are not covered', () => {
            const plan = replayPlanFor(2, 4, EMPTY_FILTER);
            assert.strictEqual(replayEventCovered(FIXTURE_JOURNAL[0], plan), false);
            assert.strictEqual(replayEventCovered(FIXTURE_JOURNAL[5], plan), false);
            assert.strictEqual(replayEventCovered(FIXTURE_JOURNAL[3], plan), true);
        });
    });

    suite('selectReplaySlice', () => {
        test('selects exactly the in-window, filter-covered events in order', () => {
            const stateFiltered = replayPlanFor(1, 4, { agentTaskStates: ['state-2'], eventKinds: [] });
            const events = expectSelected(selectReplaySlice(FIXTURE_JOURNAL, stateFiltered));
            assert.deepStrictEqual(events.map((event) => event.position), [2, 3]);
        });

        test('events after the end cursor are excluded by the plan bound', () => {
            const events = expectSelected(selectReplaySlice(FIXTURE_JOURNAL, replayPlanFor(0, 2, EMPTY_FILTER)));
            assert.deepStrictEqual(events.map((event) => event.position), [0, 1, 2]);
            assert.ok(!events.some((event) => event.position > 2));
        });

        test('events before the start cursor are refused, never silently dropped', () => {
            const refusal = expectSliceRefusal(selectReplaySlice(FIXTURE_JOURNAL, replayPlanFor(2, 5, EMPTY_FILTER)));
            assert.strictEqual(refusal.violatedLaw, 'replay-event-before-cursor');
        });

        test('unordered input is refused', () => {
            const unordered: readonly ReplayJournalEvent[] = [
                journalEvent(3, 'kind-c', 'state-2', 'evt-0003'),
                journalEvent(2, 'kind-a', 'state-2', 'evt-0002')
            ];
            const refusal = expectSliceRefusal(selectReplaySlice(unordered, replayPlanFor(2, 4, EMPTY_FILTER)));
            assert.strictEqual(refusal.violatedLaw, 'replay-slice-not-ordered');
        });

        test('an inadmissible plan refuses the selection', () => {
            const refusal = expectSliceRefusal(
                selectReplaySlice(FIXTURE_JOURNAL, replayPlanFor(4, 1, EMPTY_FILTER))
            );
            assert.strictEqual(refusal.violatedLaw, 'replay-plan-inadmissible');
        });
    });

    suite('replayDigest - the determinism law', () => {
        test('the same journal slice and cursor produce the same digest, always', () => {
            const start = cursor(0, 'evt-0000');
            assert.deepStrictEqual(replayDigest(FIXTURE_JOURNAL, start), replayDigest(FIXTURE_JOURNAL, start));
        });

        test('repeated evaluation is byte-stable across a JSON round trip', () => {
            const start = cursor(2, 'evt-0002');
            const slice = FIXTURE_JOURNAL.slice(2);
            assert.strictEqual(
                JSON.stringify(replayDigest(slice, start)),
                JSON.stringify(replayDigest(slice, start))
            );
        });

        test('different cursors fold different applied lists and digests', () => {
            const whole = expectDigest(replayDigest(FIXTURE_JOURNAL, cursor(0, 'evt-0000')));
            const tail = expectDigest(replayDigest(FIXTURE_JOURNAL.slice(2), cursor(2, 'evt-0002')));
            assert.deepStrictEqual([...whole.appliedEventDigests], [
                'evt-0000',
                'evt-0001',
                'evt-0002',
                'evt-0003',
                'evt-0004',
                'evt-0005'
            ]);
            assert.deepStrictEqual([...tail.appliedEventDigests], ['evt-0002', 'evt-0003', 'evt-0004', 'evt-0005']);
            assert.notStrictEqual(whole.journalDigest, tail.journalDigest);
        });

        test('the journal digest is a stable 8-character lowercase hex fold', () => {
            const digest = expectDigest(replayDigest(FIXTURE_JOURNAL, cursor(0, 'evt-0000')));
            assert.match(digest.journalDigest, /^[0-9a-f]{8}$/);
        });

        test('selecting then digesting a plan is deterministic end to end', () => {
            const selectedPlan = replayPlanFor(1, 4, { agentTaskStates: ['state-2'], eventKinds: [] });
            const first = replayDigest(
                expectSelected(selectReplaySlice(FIXTURE_JOURNAL, selectedPlan)),
                selectedPlan.startCursor
            );
            const second = replayDigest(
                expectSelected(selectReplaySlice(FIXTURE_JOURNAL, selectedPlan)),
                selectedPlan.startCursor
            );
            assert.deepStrictEqual(first, second);
            assert.deepStrictEqual([...expectDigest(first).appliedEventDigests], ['evt-0002', 'evt-0003']);
        });
    });

    suite('replayDigest - fail-closed', () => {
        test('a slice containing events before the cursor is refused', () => {
            const refusal = expectDigestRefusal(replayDigest(FIXTURE_JOURNAL, cursor(2, 'evt-0002')));
            assert.strictEqual(refusal.violatedLaw, 'replay-event-before-cursor');
        });

        test('unordered slices are refused', () => {
            const unordered: readonly ReplayJournalEvent[] = [
                journalEvent(3, 'kind-c', 'state-2', 'evt-0003'),
                journalEvent(2, 'kind-a', 'state-2', 'evt-0002')
            ];
            const refusal = expectDigestRefusal(replayDigest(unordered, cursor(2, 'evt-0002')));
            assert.strictEqual(refusal.violatedLaw, 'replay-slice-not-ordered');
        });

        test('duplicate positions are refused', () => {
            const duplicated: readonly ReplayJournalEvent[] = [
                journalEvent(2, 'kind-a', 'state-2', 'evt-0002'),
                journalEvent(2, 'kind-a', 'state-2', 'evt-0002')
            ];
            const refusal = expectDigestRefusal(replayDigest(duplicated, cursor(2, 'evt-0002')));
            assert.strictEqual(refusal.violatedLaw, 'replay-slice-not-ordered');
        });

        test('an invalid cursor is refused', () => {
            assert.strictEqual(
                expectDigestRefusal(replayDigest(FIXTURE_JOURNAL, cursor(-1, 'evt-0000'))).violatedLaw,
                'replay-cursor-invalid'
            );
            assert.strictEqual(
                expectDigestRefusal(replayDigest(FIXTURE_JOURNAL, cursor(0, ''))).violatedLaw,
                'replay-cursor-invalid'
            );
        });
    });

    suite('coldReplayAdmissible', () => {
        test('a cursor pinned at the journal head is admissible', () => {
            assert.deepStrictEqual(coldReplayAdmissible(cursor(5, 'evt-0005'), 'evt-0005'), {
                admissible: true
            });
        });

        test('a cursor not at the journal head refuses, carrying both digests', () => {
            assert.deepStrictEqual(coldReplayAdmissible(cursor(4, 'evt-0004'), 'evt-0005'), {
                admissible: false,
                violatedLaw: 'cold-replay-cursor-not-at-journal-head',
                cursorPinnedEventDigest: 'evt-0004',
                journalHeadDigest: 'evt-0005'
            });
        });
    });
});
