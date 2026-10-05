/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------- */

/**
 * ZC-004 Observatory - Workflow / Subagent Phase contracts.
 *
 * LAWS (violations are rejected):
 * - The journal is canonical. Every type here is a read-model, request shape,
 *   or pure projection over the canonical Flauz journal and the execution
 *   authority (extensions/flauz-execution/src/contracts.ts: the 26-state
 *   AgentTaskState machine, LIFECYCLE_STATES, journal/event semantics). This
 *   module is never a second authority, and PHASE_STATE_ORDER is a projection
 *   order - NEVER the authority's own transition map.
 * - DETERMINISM: no Math.random, no Date.now, no new Date(). Timestamps are
 *   plain ISO-8601 strings; digests are injected or derived purely.
 * - ZERO-DEPENDENCY: no import statements. Shared vocabulary (contract
 *   version, ObservatoryScope) is declared locally, mirroring
 *   build/flauz/lab/common/labContracts.ts.
 * - FAIL-CLOSED: inadmissible envelopes and transitions are typed verdicts
 *   carrying the exact violated law - never exceptions, never silent.
 *
 */

export const OBSERVATORY_CONTRACTS_VERSION = '1.0.0';

export interface ObservatoryScope {
    workspaceId: string;
    tenantId: string;
}

/**
 * SEAM (transcribed repo-side by the TL at application time): the
 * authority AgentTaskState values verbatim from
 * extensions/flauz-execution/src/contracts.ts LIFECYCLE_STATES, in the
 * phase-local forward order. HONEST RECORD: the ZC-004 work order called
 * this "the 26-state AgentTaskState machine", but the authority exports
 * LIFECYCLE_STATES with TEN members — the projection follows the REAL
 * authority (the projection law); the 26-state figure was a packet-belief
 * correction recorded here, not a fabrication license.
 */
export const PHASE_STATE_ORDER = [
    'registered',
    'created',
    'starting',
    'running',
    'stopping',
    'stopped',
    'destroyed',
    'failed',
    'running/attached',
    'stopped/attached'
] as const;

/** The authority's own member count (10) — pins the transcription. */
export const PHASE_STATE_COUNT_EXPECTED = 10;

export type AgentTaskState = (typeof PHASE_STATE_ORDER)[number];

export interface PhaseDescriptor {
    scope: ObservatoryScope;
    contractVersion: string;
    phaseId: string;
    parentTaskRef: string;
    /** The authority AgentTaskState this phase projects from. */
    agentTaskState: AgentTaskState;
    entryEvidenceDigest: string;
    /** null while the phase is open */
    exitEvidenceDigest: string | null;
}

export interface PhaseTransition {
    scope: ObservatoryScope;
    contractVersion: string;
    phaseId: string;
    from: AgentTaskState;
    to: AgentTaskState;
    evidenceDigest: string;
    observedAtIso: string;
}

export type PhaseTransitionVerdict =
    | { admissible: true }
    | {
            admissible: false;
            violatedLaw:
                | 'phase-state-unknown'
                | 'phase-transition-not-forward'
                | 'phase-evidence-missing';
            detail: string;
      };

const PHASE_STATE_INDEX: Readonly<Record<string, number | undefined>> = (() => {
    const index: Record<string, number | undefined> = {};
    PHASE_STATE_ORDER.forEach((state, position) => {
        index[state] = position;
    });
    return index;
})();

/** Rank of each authority state in the projected order (0-based). */
export const PHASE_STATE_RANK: Readonly<Record<string, number | undefined>> = PHASE_STATE_INDEX;

/** The strictly-later states in the projected order (forward window). */
export function phaseForwardStates(state: AgentTaskState): readonly AgentTaskState[] {
    const rank = PHASE_STATE_INDEX[state];
    if (rank === undefined) {
        return [];
    }
    return PHASE_STATE_ORDER.slice(rank + 1);
}

/** Forward-only, phase-local: strictly increasing in the projected order. */
export function canTransitionPhase(transition: PhaseTransition): PhaseTransitionVerdict {
    const fromIndex = PHASE_STATE_INDEX[transition.from];
    const toIndex = PHASE_STATE_INDEX[transition.to];
    if (fromIndex === undefined || toIndex === undefined) {
        return {
            admissible: false,
            violatedLaw: 'phase-state-unknown',
            detail: 'phase transitions cover the authority LIFECYCLE_STATES values only'
        };
    }
    if (toIndex <= fromIndex) {
        return {
            admissible: false,
            violatedLaw: 'phase-transition-not-forward',
            detail: transition.from + ' -> ' + transition.to + ' is not phase-forward'
        };
    }
    if (!isNonEmptyDigest(transition.evidenceDigest)) {
        return {
            admissible: false,
            violatedLaw: 'phase-evidence-missing',
            detail: 'every phase transition is evidence-bearing'
        };
    }
    return { admissible: true };
}

export interface SubagentPhaseEnvelope {
    scope: ObservatoryScope;
    contractVersion: string;
    phaseId: string;
    parentTaskRef: string;
    agentTaskState: AgentTaskState;
    stateDigest: string;
    artifactsDigest: string;
    reportedAtIso: string;
}

export type PhaseEnvelopeVerdict =
    | { admissible: true }
    | {
            admissible: false;
            violatedLaw:
                | 'phase-envelope-contract-version-mismatch'
                | 'phase-envelope-scope-mismatch'
                | 'phase-envelope-phase-mismatch'
                | 'phase-envelope-parent-mismatch'
                | 'phase-envelope-state-regressed'
                | 'phase-envelope-digest-missing';
            detail: string;
      };

/**
 * Pure guard: a phase report is admissible only against its own phase AND
 * only when it reports a state AT OR AFTER the phase's projected state (a
 * subagent may advance; it may never regress). Foreign scopes, versions,
 * phases, or parents are refused; digests are required.
 */
export function phaseEnvelopeAdmissible(
    envelope: SubagentPhaseEnvelope,
    phaseDescriptor: PhaseDescriptor
): PhaseEnvelopeVerdict {
    if (envelope.contractVersion !== phaseDescriptor.contractVersion) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-contract-version-mismatch',
            detail: 'envelope and descriptor must share one contract version'
        };
    }
    if (
        envelope.scope.workspaceId !== phaseDescriptor.scope.workspaceId ||
        envelope.scope.tenantId !== phaseDescriptor.scope.tenantId
    ) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-scope-mismatch',
            detail: 'envelope and descriptor must share one ObservatoryScope'
        };
    }
    if (envelope.phaseId !== phaseDescriptor.phaseId) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-phase-mismatch',
            detail: 'envelope phaseId ' + envelope.phaseId + ' does not report phase ' + phaseDescriptor.phaseId
        };
    }
    if (envelope.parentTaskRef !== phaseDescriptor.parentTaskRef) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-parent-mismatch',
            detail: 'envelope parent ' + envelope.parentTaskRef + ' is not the phase parent ' + phaseDescriptor.parentTaskRef
        };
    }
    const envelopeRank = PHASE_STATE_INDEX[envelope.agentTaskState];
    const descriptorRank = PHASE_STATE_INDEX[phaseDescriptor.agentTaskState];
    if (envelopeRank === undefined || descriptorRank === undefined) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-state-regressed',
            detail: 'envelope state ' + envelope.agentTaskState + ' is not an authority lifecycle state'
        };
    }
    if (envelopeRank < descriptorRank) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-state-regressed',
            detail: 'envelope state ' + envelope.agentTaskState +
                ' regresses behind the phase projected state ' + phaseDescriptor.agentTaskState
        };
    }
    if (!isNonEmptyDigest(envelope.stateDigest) || !isNonEmptyDigest(envelope.artifactsDigest)) {
        return {
            admissible: false,
            violatedLaw: 'phase-envelope-digest-missing',
            detail: 'a phase report carries both a stateDigest and an artifactsDigest'
        };
    }
    return { admissible: true };
}

function isNonEmptyDigest(digest: string): boolean {
    return typeof digest === 'string' && digest.length > 0;
}
