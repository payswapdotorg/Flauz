/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import { suite, test } from 'mocha';
import * as assert from 'node:assert/strict';
import {
    OBSERVATORY_CONTRACTS_VERSION,
    PHASE_STATE_COUNT_EXPECTED,
    PHASE_STATE_ORDER,
    PHASE_STATE_RANK,
    canTransitionPhase,
    phaseEnvelopeAdmissible,
    phaseForwardStates,
    type AgentTaskState,
    type PhaseDescriptor,
    type PhaseEnvelopeVerdict,
    type PhaseTransition,
    type PhaseTransitionVerdict,
    type SubagentPhaseEnvelope
} from '../../common/phases.js';
// The authority pin (READ ONLY). LIFECYCLE_STATES is named by ZC-004 as an
// export of the execution authority. If this import does not resolve
// repo-side, keep the test and pin PHASE_STATE_ORDER against a verbatim
// transcribed fixture instead - never delete the pin.
import { LIFECYCLE_STATES } from '../../../../../../extensions/flauz-execution/src/contracts.js';

const scope = { workspaceId: 'ws-zc004', tenantId: 'tenant-zc004' };

// Fails closed until the PHASE_STATE_ORDER seam in common/phases.ts is
// transcribed verbatim from the authority (see the seam comment there).
const SEAM_FILLED = PHASE_STATE_ORDER.length === PHASE_STATE_COUNT_EXPECTED;

// Typed as a plain array (not the tuple) so every test below compiles both
// before the seam is filled (AgentTaskState is never) and after.
const STATES: readonly AgentTaskState[] = PHASE_STATE_ORDER;

function expectTransitionRefusal(
    verdict: PhaseTransitionVerdict
): Extract<PhaseTransitionVerdict, { admissible: false }> {
    assert.strictEqual(verdict.admissible, false, 'expected a refusal, got: ' + JSON.stringify(verdict));
    return verdict as Extract<PhaseTransitionVerdict, { admissible: false }>;
}

function expectEnvelopeRefusal(
    verdict: PhaseEnvelopeVerdict
): Extract<PhaseEnvelopeVerdict, { admissible: false }> {
    assert.strictEqual(verdict.admissible, false, 'expected a refusal, got: ' + JSON.stringify(verdict));
    return verdict as Extract<PhaseEnvelopeVerdict, { admissible: false }>;
}

function transition(from: AgentTaskState, to: AgentTaskState): PhaseTransition {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        phaseId: 'phase-1',
        from: from,
        to: to,
        evidenceDigest: 'phase-evidence',
        observedAtIso: '2026-01-01T00:00:00.000Z'
    };
}

function descriptor(state: AgentTaskState): PhaseDescriptor {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        phaseId: 'phase-1',
        parentTaskRef: 'parent-task-1',
        agentTaskState: state,
        entryEvidenceDigest: 'entry-evidence',
        exitEvidenceDigest: null
    };
}

function envelope(
    state: AgentTaskState,
    overrides: Partial<SubagentPhaseEnvelope> = {}
): SubagentPhaseEnvelope {
    return {
        scope: scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        phaseId: 'phase-1',
        parentTaskRef: 'parent-task-1',
        agentTaskState: state,
        stateDigest: 'state-digest-1',
        artifactsDigest: 'artifacts-digest-1',
        reportedAtIso: '2026-01-01T00:00:00.000Z',
        ...overrides
    };
}

suite('phases contracts', () => {
    test('SEAM: PHASE_STATE_ORDER is the verbatim authority lifecycle projection', () => {
        assert.strictEqual(
            PHASE_STATE_ORDER.length,
            PHASE_STATE_COUNT_EXPECTED,
            'SEAM UNFILLED: common/phases.ts ships PHASE_STATE_ORDER EMPTY. Transcribe the '
                + PHASE_STATE_COUNT_EXPECTED
                + ' AgentTaskState values VERBATIM, in authority order, from LIFECYCLE_STATES in '
                + 'extensions/flauz-execution/src/contracts.ts. Fabricating authority state names '
                + 'would violate the projection law.'
        );
        assert.deepStrictEqual([...PHASE_STATE_ORDER], [...LIFECYCLE_STATES]);
    });

    suite('phase-local order', () => {
        test('every authority state has a rank and the ranks are exactly 0..N-1', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const ranks: number[] = [];
            for (const state of STATES) {
                const rank = PHASE_STATE_RANK[state];
                assert.ok(rank !== undefined, 'missing rank for state: ' + state);
                ranks.push(rank);
            }
            ranks.sort((left, right) => left - right);
            const expected: number[] = [];
            for (let index = 0; index < STATES.length; index += 1) {
                expected.push(index);
            }
            assert.deepStrictEqual(ranks, expected);
        });

        test('phaseForwardStates returns exactly the strictly-later states', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            for (let index = 0; index < STATES.length; index += 1) {
                assert.deepStrictEqual([...phaseForwardStates(STATES[index])], STATES.slice(index + 1));
            }
        });
    });

    suite('canTransitionPhase', () => {
        test('every adjacent forward step is admissible with evidence', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            for (let index = 0; index + 1 < STATES.length; index += 1) {
                const verdict = canTransitionPhase(transition(STATES[index], STATES[index + 1]));
                assert.ok(
                    verdict.admissible,
                    STATES[index] + '->' + STATES[index + 1] + ' must be admissible: ' + JSON.stringify(verdict)
                );
            }
        });

        test('backward transitions are refused as not-forward', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            for (let index = 0; index + 1 < STATES.length; index += 1) {
                const refusal = expectTransitionRefusal(
                    canTransitionPhase(transition(STATES[index + 1], STATES[index]))
                );
                assert.strictEqual(refusal.violatedLaw, 'phase-transition-not-forward');
            }
        });

        test('lateral self-transitions are refused as not-forward', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            for (const state of STATES) {
                const refusal = expectTransitionRefusal(canTransitionPhase(transition(state, state)));
                assert.strictEqual(refusal.violatedLaw, 'phase-transition-not-forward');
            }
        });

        test('unknown states are refused fail-closed at the runtime boundary', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            // Runtime inputs are untyped at the wire boundary; the guard must
            // refuse unknown states instead of guessing (hence the one cast).
            const forged: PhaseTransition = {
                ...transition(STATES[0], STATES[STATES.length - 1]),
                from: 'definitely-not-an-authority-state' as unknown as AgentTaskState
            };
            const refusal = expectTransitionRefusal(canTransitionPhase(forged));
            assert.strictEqual(refusal.violatedLaw, 'phase-state-unknown');
        });

        test('evidence-free transitions are refused', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const evidenceFree: PhaseTransition = {
                ...transition(STATES[0], STATES[1]),
                evidenceDigest: ''
            };
            const refusal = expectTransitionRefusal(canTransitionPhase(evidenceFree));
            assert.strictEqual(refusal.violatedLaw, 'phase-evidence-missing');
        });
    });

    suite('phaseEnvelopeAdmissible', () => {
        test('an envelope holding the descriptor state is admissible', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            assert.deepStrictEqual(phaseEnvelopeAdmissible(envelope(STATES[0]), descriptor(STATES[0])), {
                admissible: true
            });
        });

        test('an envelope advancing the state is admissible', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            assert.ok(phaseEnvelopeAdmissible(envelope(STATES[2]), descriptor(STATES[0])).admissible);
        });

        test('an envelope regressing the state is refused', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const refusal = expectEnvelopeRefusal(phaseEnvelopeAdmissible(envelope(STATES[0]), descriptor(STATES[2])));
            assert.strictEqual(refusal.violatedLaw, 'phase-envelope-state-regressed');
        });

        test('envelopes from another phase or parent are refused', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const otherPhase = expectEnvelopeRefusal(
                phaseEnvelopeAdmissible(envelope(STATES[0], { phaseId: 'phase-other' }), descriptor(STATES[0]))
            );
            assert.strictEqual(otherPhase.violatedLaw, 'phase-envelope-phase-mismatch');
            const otherParent = expectEnvelopeRefusal(
                phaseEnvelopeAdmissible(envelope(STATES[0], { parentTaskRef: 'parent-other' }), descriptor(STATES[0]))
            );
            assert.strictEqual(otherParent.violatedLaw, 'phase-envelope-parent-mismatch');
        });

        test('envelopes with a foreign scope or contract version are refused', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const foreignScope = expectEnvelopeRefusal(
                phaseEnvelopeAdmissible(
                    envelope(STATES[0], { scope: { workspaceId: 'ws-other', tenantId: 'tenant-zc004' } }),
                    descriptor(STATES[0])
                )
            );
            assert.strictEqual(foreignScope.violatedLaw, 'phase-envelope-scope-mismatch');
            const foreignVersion = expectEnvelopeRefusal(
                phaseEnvelopeAdmissible(envelope(STATES[0], { contractVersion: '0.9.0' }), descriptor(STATES[0]))
            );
            assert.strictEqual(foreignVersion.violatedLaw, 'phase-envelope-contract-version-mismatch');
        });

        test('digest-less envelopes are refused', function (this: Mocha.Context) {
            if (!SEAM_FILLED) {
                this.skip();
            }
            const refusal = expectEnvelopeRefusal(
                phaseEnvelopeAdmissible(envelope(STATES[0], { stateDigest: '' }), descriptor(STATES[0]))
            );
            assert.strictEqual(refusal.violatedLaw, 'phase-envelope-digest-missing');
        });
    });
});
