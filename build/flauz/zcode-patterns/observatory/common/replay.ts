/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------- */

/**
 * ZC-004 Observatory - Deterministic Cold Replay contracts.
 *
 * LAWS (violations are rejected):
 * - The journal is canonical. Every type here is a read-model, request shape,
 *   or pure projection over the canonical Flauz journal's event-sequence
 *   semantics (extensions/flauz-execution/src/contracts.ts). There is NO
 *   replay engine here - cursors, plans, and pure digest functions only.
 * - DETERMINISM LAW: replayDigest(journalSlice, cursor) is PURE and TOTAL.
 *   The same journal slice + the same cursor produce the SAME digest, always.
 *   No Math.random, no Date.now, no new Date(); timestamps are plain
 *   ISO-8601 strings; the digest is a pure fold (FNV-1a) over the slice.
 * - FAIL-CLOSED: a replay whose cursor digest does not match the journal head
 *   is refused with both digests carried - never a partial silent replay.
 * - ZERO-DEPENDENCY: no import statements. Shared vocabulary is declared
 *   locally, mirroring build/flauz/lab/common/labContracts.ts.
 *
 */

export const OBSERVATORY_CONTRACTS_VERSION = '1.0.0';

export interface ObservatoryScope {
    workspaceId: string;
    tenantId: string;
}

export interface ReplayCursor {
    scope: ObservatoryScope;
    contractVersion: string;
    /** Event-sequence ordinal into the canonical journal. */
    journalPosition: number;
    /** Digest of the journal event at journalPosition (the pinned head). */
    pinnedEventDigest: string;
}

export interface ReplayFilter {
    /** Authority AgentTaskState values the replay covers; empty list = all states. */
    agentTaskStates: readonly string[];
    /** Authority journal event kinds the replay covers; empty list = all kinds. */
    eventKinds: readonly string[];
}

export interface ReplayPlan {
    scope: ObservatoryScope;
    contractVersion: string;
    startCursor: ReplayCursor;
    endCursor: ReplayCursor;
    filter: ReplayFilter;
}

export interface ReplayJournalEvent {
    position: number;
    kind: string;
    agentTaskState: string;
    eventDigest: string;
    emittedAtIso: string;
}

export interface ReplayDigest {
    scope: ObservatoryScope;
    contractVersion: string;
    journalDigest: string;
    cursor: ReplayCursor;
    appliedEventDigests: readonly string[];
}

export type ReplayDigestVerdict =
    | ReplayDigest
    | {
            kind: 'refused';
            violatedLaw:
                | 'replay-cursor-invalid'
                | 'replay-slice-not-ordered'
                | 'replay-event-before-cursor';
            detail: string;
      };

const REPLAY_DIGEST_DOMAIN = 'flauz-observatory-replay-v1';

/**
 * Pure and total. Applies the slice (events at or after the cursor, in
 * strictly increasing position order) and folds it into a deterministic
 * journalDigest. Same inputs => same digest, always.
 */
export function replayDigest(
    journalSlice: readonly ReplayJournalEvent[],
    cursor: ReplayCursor
): ReplayDigestVerdict {
    if (cursor.journalPosition < 0 || !isNonEmptyDigest(cursor.pinnedEventDigest)) {
        return {
            kind: 'refused',
            violatedLaw: 'replay-cursor-invalid',
            detail: 'cursor position must be a non-negative ordinal with a pinned event digest'
        };
    }
    let previousPosition = -1;
    for (const event of journalSlice) {
        if (event.position <= previousPosition) {
            return {
                kind: 'refused',
                violatedLaw: 'replay-slice-not-ordered',
                detail: 'journal slice positions must strictly increase (duplicate or backward at ' + event.position + ')'
            };
        }
        if (event.position < cursor.journalPosition) {
            return {
                kind: 'refused',
                violatedLaw: 'replay-event-before-cursor',
                detail: 'event at ' + event.position + ' precedes cursor position ' + cursor.journalPosition
            };
        }
        previousPosition = event.position;
    }
    let journalDigest = fnv1a32(REPLAY_DIGEST_DOMAIN);
    const appliedEventDigests: string[] = [];
    for (const event of journalSlice) {
        journalDigest = fnv1a32(journalDigest + '|' + event.position + ':' + event.eventDigest);
        appliedEventDigests.push(event.eventDigest);
    }
    return {
        scope: cursor.scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        journalDigest: journalDigest,
        cursor: cursor,
        appliedEventDigests: appliedEventDigests
    };
}

export type ColdReplayVerdict =
    | { admissible: true }
    | {
            admissible: false;
            violatedLaw: 'cold-replay-cursor-not-at-journal-head';
            cursorPinnedEventDigest: string;
            journalHeadDigest: string;
      };

/** Fail-closed: never a partial silent replay. */
export function coldReplayAdmissible(
    cursor: ReplayCursor,
    journalHeadDigest: string
): ColdReplayVerdict {
    if (cursor.pinnedEventDigest === journalHeadDigest) {
        return { admissible: true };
    }
    return {
        admissible: false,
        violatedLaw: 'cold-replay-cursor-not-at-journal-head',
        cursorPinnedEventDigest: cursor.pinnedEventDigest,
        journalHeadDigest: journalHeadDigest
    };
}

function fnv1a32(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
        hash = Math.imul(hash ^ input.charCodeAt(index), 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function isNonEmptyDigest(digest: string): boolean {
    return typeof digest === 'string' && digest.length > 0;
}

export type ReplayPlanVerdict =
    | { admissible: true }
    | {
            admissible: false;
            violatedLaw:
                | 'replay-plan-cursor-order'
                | 'replay-plan-scope-mismatch'
                | 'replay-plan-contract-version-mismatch'
                | 'replay-plan-cursor-invalid';
            detail: string;
      };

/** A plan is admissible when its cursors are valid, co-scoped, ordered. */
export function replayPlanAdmissible(plan: ReplayPlan): ReplayPlanVerdict {
    for (const cursor of [plan.startCursor, plan.endCursor]) {
        if (
            cursor.journalPosition < 0 ||
            !isNonEmptyDigest(cursor.pinnedEventDigest)
        ) {
            return {
                admissible: false,
                violatedLaw: 'replay-plan-cursor-invalid',
                detail: 'cursor position must be a non-negative ordinal with a pinned event digest'
            };
        }
    }
    if (
        plan.startCursor.scope.workspaceId !== plan.scope.workspaceId ||
        plan.startCursor.scope.tenantId !== plan.scope.tenantId ||
        plan.endCursor.scope.workspaceId !== plan.scope.workspaceId ||
        plan.endCursor.scope.tenantId !== plan.scope.tenantId
    ) {
        return {
            admissible: false,
            violatedLaw: 'replay-plan-scope-mismatch',
            detail: 'the plan and both cursors must share one ObservatoryScope'
        };
    }
    if (
        plan.contractVersion !== OBSERVATORY_CONTRACTS_VERSION ||
        plan.startCursor.contractVersion !== plan.contractVersion ||
        plan.endCursor.contractVersion !== plan.contractVersion
    ) {
        return {
            admissible: false,
            violatedLaw: 'replay-plan-contract-version-mismatch',
            detail: 'the plan and both cursors must declare the observatory contract version ' +
                OBSERVATORY_CONTRACTS_VERSION
        };
    }
    if (plan.endCursor.journalPosition < plan.startCursor.journalPosition) {
        return {
            admissible: false,
            violatedLaw: 'replay-plan-cursor-order',
            detail: 'the end cursor position must not precede the start cursor position'
        };
    }
    return { admissible: true };
}

/**
 * Coverage query: is this authority event inside the plan's cursor window
 * AND matched by its filter (empty filter lists cover everything)?
 */
export function replayEventCovered(event: ReplayJournalEvent, plan: ReplayPlan): boolean {
    if (event.position < plan.startCursor.journalPosition) {
        return false;
    }
    if (event.position > plan.endCursor.journalPosition) {
        return false;
    }
    if (
        plan.filter.agentTaskStates.length > 0 &&
        !plan.filter.agentTaskStates.includes(event.agentTaskState)
    ) {
        return false;
    }
    if (
        plan.filter.eventKinds.length > 0 &&
        !plan.filter.eventKinds.includes(event.kind)
    ) {
        return false;
    }
    return true;
}

export type ReplaySliceVerdict =
    | { kind: 'selected'; events: readonly ReplayJournalEvent[] }
    | {
            kind: 'refused';
            violatedLaw:
                | 'replay-plan-inadmissible'
                | 'replay-slice-not-ordered'
                | 'replay-event-before-cursor';
            detail: string;
      };

/**
 * The deterministic subset selection: exactly the in-window, filter-covered
 * events, in order. Fail-closed laws (mirroring replayDigest): unordered
 * input is refused; an event before the start cursor is refused, never
 * silently dropped; events after the end cursor are excluded by the plan
 * bound.
 */
export function selectReplaySlice(
    journalSlice: readonly ReplayJournalEvent[],
    plan: ReplayPlan
): ReplaySliceVerdict {
    const planVerdict = replayPlanAdmissible(plan);
    if (!planVerdict.admissible) {
        return {
            kind: 'refused',
            violatedLaw: 'replay-plan-inadmissible',
            detail: 'the replay plan is inadmissible: ' + planVerdict.detail
        };
    }
    let previousPosition = -1;
    for (const event of journalSlice) {
        if (event.position <= previousPosition) {
            return {
                kind: 'refused',
                violatedLaw: 'replay-slice-not-ordered',
                detail: 'journal slice positions must strictly increase (duplicate or backward at ' +
                    event.position + ')'
            };
        }
        if (
            filterMatched(event, plan.filter) &&
            event.position < plan.startCursor.journalPosition
        ) {
            return {
                kind: 'refused',
                violatedLaw: 'replay-event-before-cursor',
                detail: 'filter-matched event at ' + event.position +
                    ' precedes the plan start cursor position ' +
                    plan.startCursor.journalPosition +
                    ' - pass the post-cursor journal slice instead, never silently drop wanted events'
            };
        }
        previousPosition = event.position;
    }
    const selected: ReplayJournalEvent[] = [];
    for (const event of journalSlice) {
        if (
            filterMatched(event, plan.filter) &&
            event.position <= plan.endCursor.journalPosition
        ) {
            selected.push(event);
        }
    }
    return { kind: 'selected', events: selected };
}

/** Filter-only match (no window): does the plan WANT this event kind/state? */
function filterMatched(event: ReplayJournalEvent, filter: ReplayFilter): boolean {
    if (
        filter.agentTaskStates.length > 0 &&
        !filter.agentTaskStates.includes(event.agentTaskState)
    ) {
        return false;
    }
    if (
        filter.eventKinds.length > 0 &&
        !filter.eventKinds.includes(event.kind)
    ) {
        return false;
    }
    return true;
}
