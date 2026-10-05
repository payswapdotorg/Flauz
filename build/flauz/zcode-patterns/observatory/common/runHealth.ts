/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------- */

/**
 * ZC-004 Observatory - Run Health / Stall / Concurrency contracts.
 *
 * LAWS (violations are rejected):
 * - The journal is canonical. Every type here is a read-model or pure
 *   projection over the canonical Flauz journal. The per-task authority state
 *   is CARRIED, never interpreted: stall verdicts are derived only from
 *   injected plain-number event-time deltas.
 * - DETERMINISM: no Math.random, no Date.now, no new Date(). The clock enters
 *   ONLY as the injected nowMs plain number; event-time deltas are derived by
 *   pure subtraction. The projection never reads a clock and owns no counters.
 * - Stall thresholds are exported constants by law - never hidden.
 * - ZERO-DEPENDENCY: no import statements. Shared vocabulary is declared
 *   locally, mirroring build/flauz/lab/common/labContracts.ts.
 * - FAIL-CLOSED: missing heart evidence and input mismatch are typed verdicts
 *   carrying the exact violated law - never exceptions, never silent.
 *
 */

export const OBSERVATORY_CONTRACTS_VERSION = '1.0.0';

export interface ObservatoryScope {
    workspaceId: string;
    tenantId: string;
}

/** Stall thresholds are exported constants by law - never hidden. Draft values; ratify with the TL. */
export const stalledAfterMs = 90_000;
export const heartMissingAfterMs = 180_000;

export type StallVerdict = 'healthy' | 'stalled' | 'heart-missing';

export type ConcurrencySlot = 'in-use' | 'queued';

export interface ConcurrencyGauge {
    capacity: number;
    inUse: number;
    queued: number;
}

export interface RunHealthTaskRecord {
    scope: ObservatoryScope;
    contractVersion: string;
    taskRef: string;
    /** Projected authority AgentTaskState at observation time; opaque to this projection. */
    agentTaskState: string;
    /** Journal event time of the task's latest event, plain epoch-ms number. */
    lastEventAtMs: number;
    /** Journal event time of the latest heart evidence; null when none exists. */
    lastHeartAtMs: number | null;
    /** Slot occupancy projected from the authority state. */
    slot: ConcurrencySlot;
}

export interface RunHealthClockDeltas {
    /** Injected plain number: observation time. */
    nowMs: number;
    /** Injected plain number: total concurrency slot capacity. */
    concurrencyCapacity: number;
}

export interface RunHealthTaskView {
    taskRef: string;
    agentTaskState: string;
    slot: ConcurrencySlot;
    stallVerdict: StallVerdict;
}

export interface RunHealthView {
    scope: ObservatoryScope;
    contractVersion: string;
    taskRefs: readonly string[];
    tasks: readonly RunHealthTaskView[];
    concurrency: ConcurrencyGauge;
}

export type RunHealthProjectionVerdict =
    | RunHealthView
    | {
            kind: 'refused';
            violatedLaw:
                | 'run-health-empty-input'
                | 'run-health-scope-mismatch'
                | 'run-health-contract-version-mismatch';
            detail: string;
      };

export function projectRunHealth(
    taskRecords: readonly RunHealthTaskRecord[],
    clockDeltas: RunHealthClockDeltas
): RunHealthProjectionVerdict {
    const first = taskRecords[0];
    if (first === undefined) {
        return {
            kind: 'refused',
            violatedLaw: 'run-health-empty-input',
            detail: 'at least one task record is required to project a run health view'
        };
    }
    for (const record of taskRecords) {
        if (
            record.scope.workspaceId !== first.scope.workspaceId ||
            record.scope.tenantId !== first.scope.tenantId
        ) {
            return {
                kind: 'refused',
                violatedLaw: 'run-health-scope-mismatch',
                detail: 'all task records must share one ObservatoryScope'
            };
        }
        if (record.contractVersion !== OBSERVATORY_CONTRACTS_VERSION) {
            return {
                kind: 'refused',
                violatedLaw: 'run-health-contract-version-mismatch',
                detail: 'expected contractVersion ' + OBSERVATORY_CONTRACTS_VERSION
            };
        }
    }
    const tasks: RunHealthTaskView[] = taskRecords.map((record) => ({
        taskRef: record.taskRef,
        agentTaskState: record.agentTaskState,
        slot: record.slot,
        stallVerdict: stallVerdictFor(record, clockDeltas.nowMs)
    }));
    return {
        scope: first.scope,
        contractVersion: OBSERVATORY_CONTRACTS_VERSION,
        taskRefs: tasks.map((task) => task.taskRef),
        tasks: tasks,
        concurrency: {
            capacity: clockDeltas.concurrencyCapacity,
            inUse: countSlots(taskRecords, 'in-use'),
            queued: countSlots(taskRecords, 'queued')
        }
    };
}

/** Heart evidence is the stronger refusal: checked first. */
function stallVerdictFor(record: RunHealthTaskRecord, nowMs: number): StallVerdict {
    if (record.lastHeartAtMs === null || nowMs - record.lastHeartAtMs >= heartMissingAfterMs) {
        return 'heart-missing';
    }
    if (nowMs - record.lastEventAtMs >= stalledAfterMs) {
        return 'stalled';
    }
    return 'healthy';
}

function countSlots(records: readonly RunHealthTaskRecord[], slot: ConcurrencySlot): number {
    let count = 0;
    for (const record of records) {
        if (record.slot === slot) {
            count += 1;
        }
    }
    return count;
}

/** The frozen stall-verdict vocabulary (for totality pins in tests). */
export const STALL_VERDICTS = ['healthy', 'stalled', 'heart-missing'] as const;

/** The frozen concurrency-slot vocabulary (for totality pins in tests). */
export const CONCURRENCY_SLOTS = ['in-use', 'queued'] as const;

/**
 * The pure stall predicate over injected plain-number event-time deltas:
 * heart-missing (the heart evidence is older than heartMissingAfterMs)
 * outranks stalled (the last event is older than stalledAfterMs).
 */
export function stallVerdictForDeltas(
    msSinceLastEvent: number,
    msSinceLastHeart: number | null
): StallVerdict {
    if (msSinceLastHeart === null || msSinceLastHeart >= heartMissingAfterMs) {
        return 'heart-missing';
    }
    if (msSinceLastEvent >= stalledAfterMs) {
        return 'stalled';
    }
    return 'healthy';
}
