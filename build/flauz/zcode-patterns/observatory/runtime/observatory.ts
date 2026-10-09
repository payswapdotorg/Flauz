/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-004 -- THE LIVE OBSERVATORY RUNTIME (Phase C-R, B1, wave 5).
 *
 * LAWS:
 * - THE JOURNAL IS CANONICAL: this runtime adds NO second journal, NO event
 *   store, NO poller, NO scheduler, and NO dashboard (the observatory
 *   README's out-of-scope law binds the runtime wave too). Every projection
 *   is a read-model over the REAL authorities: the agent task authority
 *   (extensions/flauz-workspace/src/taskService.ts TaskService, bound with
 *   this runtime's injected fs port + clock and bootstrapped through its
 *   own surface) and the execution journal authority
 *   (extensions/flauz-execution/src/journal.ts ExecJournalStore, bound with
 *   this runtime's injected clock + a deterministic id minter). The
 *   ExecJournalStore owns its own node-stdlib sync-fs boundary (its
 *   documented law); the runtime's optional fs port serves the TaskService
 *   only and defaults to a node-backed port.
 * - THE CONTRACT IS THE COMPOSITION AUTHORITY: every table, predicate, and
 *   guard rides the four frozen contract modules --
 *   common/planMode.ts (PLAN_MODE_BY_TASK_STATUS, canTransitionPlanMode,
 *   planContinuityVerdict), common/phases.ts (PHASE_STATE_ORDER,
 *   canTransitionPhase), common/runHealth.ts (projectRunHealth,
 *   stalledAfterMs, heartMissingAfterMs), common/replay.ts (replayDigest,
 *   coldReplayAdmissible) -- namespace-imported with .ts specifiers so the
 *   suite runs directly under type stripping (the memoryRuntime.ts
 *   discipline). This module never re-implements a frozen table it can
 *   call; the two bridge tables it DOES own (the task-transition ->
 *   plan-mode-edge bridge, the acquisition-event -> phase-state bridge)
 *   are disclosed frozen mappings in the memoryRuntime.ts SCOPE_TIER_BRIDGE
 *   class: the bridge proposes, the contract's own guards dispose, and
 *   every bridged edge is validated through the contract at projection
 *   time -- never silently trusted.
 * - FAIL-CLOSED TYPED: every refusal is a typed verdict or a typed
 *   ObservatoryRuntimeError naming the violated law (the contract's own
 *   law vocabulary wherever the contract has one); no silent successes, no
 *   partial projections, no swallowed authority errors. An unclassable
 *   journal row, an unmapped task status, a cursor that does not match the
 *   journal head, and a superseded plan are all VERDICTS, never exceptions.
 * - DETERMINISM BY INJECTION: the injected clock (an epoch-ms () => number)
 *   drives every timestamp this runtime stamps (the TaskService timing, the
 *   journal row ts through the store's own clock seam, the runHealth nowMs)
 *   and the default acquisition-id minter is derived purely from the
 *   injected clock (the epoch-ms word doubled into the 16-hex id grammar;
 *   inject a ticking clock -- a clock that repeats a value mints a repeat
 *   id). No Math.random, no Date.now, and no new Date(...) appear anywhere
 *   in this module (the suite's law-comment greps pin this: matches live
 *   in comment lines only). epoch-ms -> ISO-8601 conversion is pure civil
 *   calendar arithmetic restated locally from the memoryRuntime/hookBus
 *   discipline (no calendar object is constructed).
 * - PROJECTION-ONLY WRITES: the runtime persists NOTHING of its own. The
 *   only writes that can happen through this runtime are (a) the task
 *   authority's own bootstrap/envelope writes through TaskService, and (b)
 *   journal rows a CALLER appends through the bound store's public
 *   appendRow. Every record this runtime RETURNS that a caller may persist
 *   carries `scope: ObservatoryScope` and
 *   `contractVersion: OBSERVATORY_CONTRACTS_VERSION` (the contract's own
 *   record shapes enforce this).
 * - SEAM HONESTY: only the real surfaces named by the work order are
 *   targeted. The plan-revision digest convention (the
 *   `planRevisionDigest` payload key on plan-bearing task events) and the
 *   derived plan id (`<taskRef>-plan`) are the runtime's DISCLOSED payload
 *   conventions over the task authority's open payload vocabulary -- they
 *   extend no authority table and fabricate no authority surface.
 */

import {
    ACTIVE_STATUSES,
    canonicalJson,
    type Clock,
    type FileSystemPort,
    sha256Hex,
    type Task,
    type TaskEvent,
    type TaskStatus,
    transitionRule,
} from '../../../../../extensions/flauz-workspace/src/api.ts';
import { TaskService } from '../../../../../extensions/flauz-workspace/src/taskService.ts';
import { ExecJournalStore } from '../../../../../extensions/flauz-execution/src/journal.ts';
import { type ExecEventType, type ExecJournalRow, execRowHashOf } from '../../../../../extensions/flauz-execution/src/contracts.ts';
import * as PlanModeContract from '../common/planMode.ts';
import * as PhasesContract from '../common/phases.ts';
import * as RunHealthContract from '../common/runHealth.ts';
import * as ReplayContract from '../common/replay.ts';

// ---------------------------------------------------------------------------
// Pure epoch-ms -> ISO conversion (civil-calendar arithmetic; no calendar
// object is constructed anywhere in this module -- the memoryRuntime/
// hookBus discipline, restated locally so the observatory runtime stays
// free of cross-subtree runtime imports)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
    return value < 10 ? `0${String(value)}` : String(value);
}

function pad4(value: number): string {
    const text = String(value);
    return text.length >= 4 ? text : '0'.repeat(4 - text.length) + text;
}

/**
 * Pure epoch-ms -> ISO-8601 UTC conversion. Emits exactly
 * YYYY-MM-DDTHH:MM:SSZ -- the observatory contract set's ISO timestamp
 * shape; sub-second precision is truncated by design.
 */
export function epochMsToIsoUtc(epochMs: number): string {
    const secondsTotal = Math.floor(epochMs / 1000);
    const days = Math.floor(secondsTotal / 86400);
    let secondsOfDay = secondsTotal - days * 86400;
    const hours = Math.floor(secondsOfDay / 3600);
    secondsOfDay -= hours * 3600;
    const minutes = Math.floor(secondsOfDay / 60);
    const seconds = secondsOfDay - minutes * 60;
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const dayOfEra = z - era * 146097;
    const yearOfEra = Math.floor(
        (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
    );
    const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
    const monthPattern = Math.floor((5 * dayOfYear + 2) / 153);
    const day = dayOfYear - Math.floor((153 * monthPattern + 2) / 5) + 1;
    const month = monthPattern < 10 ? monthPattern + 3 : monthPattern - 9;
    let year = yearOfEra + era * 400;
    if (month <= 2) {
        year += 1;
    }
    return `${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}Z`;
}

// ---------------------------------------------------------------------------
// Typed errors (the MemoryRuntimeError/HookBusError discipline)
// ---------------------------------------------------------------------------

export type ObservatoryRuntimeErrorCode =
    | 'DISPOSED'
    | 'INVALID-PARAMS'
    | 'TASK-NOT-FOUND'
    | 'TASK-AUTHORITY-REFUSED'
    | 'JOURNAL-REFUSED';

/** A typed refusal: the code names the violated law; details carry the authority's own refusal. */
export class ObservatoryRuntimeError extends Error {
    readonly code: ObservatoryRuntimeErrorCode;
    readonly taskRef?: string;
    readonly refusal?: unknown;

    constructor(
        code: ObservatoryRuntimeErrorCode,
        message: string,
        details?: { taskRef?: string; refusal?: unknown },
    ) {
        super(message);
        this.name = 'ObservatoryRuntimeError';
        this.code = code;
        this.taskRef = details?.taskRef;
        this.refusal = details?.refusal;
    }
}

/** The typed assertion helper: throws ObservatoryRuntimeError when the condition fails. */
function need(condition: unknown, code: ObservatoryRuntimeErrorCode, message: string): asserts condition {
    if (!condition) {
        throw new ObservatoryRuntimeError(code, message);
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

// ---------------------------------------------------------------------------
// THE PLAN-REVISION DIGEST CONVENTION (disclosed; over the task authority's
// open payload vocabulary -- the plan document identity rides the events)
// ---------------------------------------------------------------------------

/**
 * The payload key a plan-bearing task event carries: the digest of the plan
 * revision it submits/approves/observes. The PINNED plan revision is the
 * digest on the task's approval event (execution start); the OBSERVED plan
 * revision is the last digest any event carries. A later differing observed
 * digest is the typed drift verdict (the plan is superseded -- a verdict,
 * never an exception).
 */
export const PLAN_REVISION_DIGEST_PAYLOAD_KEY = 'planRevisionDigest';

/** The derived plan document id of a task: `<taskRef>-plan` (one plan lane per task). */
export function planIdOfTask(taskRef: string): string {
    return `${taskRef}-plan`;
}

/** The digest of one task event: sha256 over the canonical event (the ledger's own digest discipline). */
export function taskEventDigest(event: TaskEvent): string {
    return sha256Hex(canonicalJson(event));
}

// ---------------------------------------------------------------------------
// THE TASK-TRANSITION -> PLAN-MODE-EDGE BRIDGE (the disclosed frozen table)
// ---------------------------------------------------------------------------

export interface PlanModeBridgeEdge {
    readonly from: PlanModeContract.PlanModeState;
    readonly to: PlanModeContract.PlanModeState;
}

export interface TaskTransitionPlanModeBridgeRow {
    readonly transitionType: string;
    readonly edges: readonly PlanModeBridgeEdge[];
    readonly rationale: string;
}

/**
 * THE TASK-TRANSITION -> PLAN-MODE-EDGE BRIDGE: the frozen table mapping the
 * task authority's transition verbs (TRANSITIONS in
 * extensions/flauz-workspace/src/api.ts) onto the plan-mode contract's
 * forward edges. The bridge PROPOSES edges; the contract's
 * canTransitionPlanMode guard disposes (evidence digests, forward law, the
 * supersede successor law) -- no bridged edge is ever trusted past the
 * guard. RATIONALE (per authority verb):
 * - submit-plan crosses draft -> awaiting-approval (the approval request).
 * - approve crosses TWO plan-mode edges: awaiting-approval -> approved (the
 *   human approval evidence) and approved -> executing (the execution
 *   start) -- the task authority has no approved-but-not-executing status,
 *   so its single `approve` event is the evidence for both contract edges
 *   (the contract's mapping rule: every post-approval status projects to
 *   'executing').
 * - request-changes supersedes the submitted revision (awaiting-approval ->
 *   superseded, with the revised plan's digest as the successor); the next
 *   submit-plan then opens a FRESH plan-mode cycle at draft.
 * - report / verify-pass / verify-fail / sign-off / fail / cancel cross NO
 *   plan-mode edge: post-approval statuses all project to 'executing' (the
 *   plan stays pinned until superseded -- the contract's own mapping rule).
 */
export const TASK_TRANSITION_PLAN_MODE_BRIDGE: readonly TaskTransitionPlanModeBridgeRow[] = [
    {
        transitionType: 'submit-plan',
        edges: [{ from: 'draft', to: 'awaiting-approval' }],
        rationale: 'the plan is submitted for approval (evidence kind approval-requested)',
    },
    {
        transitionType: 'approve',
        edges: [
            { from: 'awaiting-approval', to: 'approved' },
            { from: 'approved', to: 'executing' },
        ],
        rationale: 'the human approval is the evidence for BOTH the plan-approved and the execution-start edges',
    },
    {
        transitionType: 'request-changes',
        edges: [{ from: 'awaiting-approval', to: 'superseded' }],
        rationale: 'the submitted revision is superseded by the revision being drafted (the successor digest rides the event payload)',
    },
    { transitionType: 'report', edges: [], rationale: 'execution continues: post-approval statuses project to executing' },
    { transitionType: 'verify-pass', edges: [], rationale: 'execution continues: post-approval statuses project to executing' },
    { transitionType: 'verify-fail', edges: [], rationale: 'execution continues: post-approval statuses project to executing' },
    { transitionType: 'sign-off', edges: [], rationale: 'execution concludes: the plan stays pinned until superseded' },
    { transitionType: 'fail', edges: [], rationale: 'execution fails: the plan stays pinned until superseded' },
    { transitionType: 'cancel', edges: [], rationale: 'the run is cancelled: the plan stays pinned until superseded' },
];

const PLAN_MODE_BRIDGE_BY_TYPE: Readonly<Record<string, TaskTransitionPlanModeBridgeRow | undefined>> = (() => {
    const index: Record<string, TaskTransitionPlanModeBridgeRow | undefined> = {};
    for (const row of TASK_TRANSITION_PLAN_MODE_BRIDGE) {
        index[row.transitionType] = row;
    }
    return index;
})();

// ---------------------------------------------------------------------------
// THE ACQUISITION-EVENT -> PHASE-STATE BRIDGE (the disclosed frozen table)
// ---------------------------------------------------------------------------

export interface AcquisitionPhaseBridgeRow {
    readonly eventType: ExecEventType;
    /** null: the row class is honestly unclassable onto the projected phase order. */
    readonly agentTaskState: PhasesContract.AgentTaskState | null;
    readonly rowId: string;
    readonly rationale: string;
}

/**
 * THE ACQUISITION-EVENT -> PHASE-STATE BRIDGE: the frozen table mapping the
 * execution journal's event types onto the contract's PHASE_STATE_ORDER
 * (the authority LIFECYCLE_STATES projection). The bridge PROPOSES a phase
 * state per row class; the contract's canTransitionPhase guard disposes over
 * the per-acquisition fold (forward-only, evidence-bearing) -- and a row
 * class with no honest phase state (agentTaskState null) is the typed
 * UNCLASSABLE verdict ('phase-state-unknown'), never a silent skip.
 * RATIONALE (per row class):
 * - resource-acquired -> running (the acquired resource enters use).
 * - handoff-recorded -> running (a mid-use surface hand-off; the phase
 *   HOLDS at running -- the fold's transition verdict discloses the lateral
 *   hold honestly as not-forward).
 * - session-reattached / continuity-restored -> running/attached (a lost
 *   surface re-attached to live use).
 * - resource-released -> stopped (the resource left use gracefully).
 * - resource-expired -> destroyed (the lease expired: the destruction path).
 * - resource-lost / acquire-denied -> failed (loss is the failure path; a
 *   denied acquisition never opens).
 * - effect-settled -> unclassable (an idempotency outcome record, not a
 *   lifecycle phase).
 * - continuity-exported / rollback-recorded / recovery-scan -> unclassable
 *   (AGGREGATE rows: the journal's own replay law says they change NO
 *   acquisition state, so no acquisition phase projects from them).
 */
export const ACQUISITION_PHASE_BRIDGE: readonly AcquisitionPhaseBridgeRow[] = [
    { eventType: 'resource-acquired', agentTaskState: 'running', rowId: 'resource-acquired->running', rationale: 'the acquired resource enters use' },
    { eventType: 'handoff-recorded', agentTaskState: 'running', rowId: 'handoff-recorded->running', rationale: 'a mid-use surface hand-off holds the phase at running' },
    { eventType: 'session-reattached', agentTaskState: 'running/attached', rowId: 'session-reattached->running-attached', rationale: 'a lost session surface re-attached to live use' },
    { eventType: 'continuity-restored', agentTaskState: 'running/attached', rowId: 'continuity-restored->running-attached', rationale: 'a restored surface re-attached to live use' },
    { eventType: 'resource-released', agentTaskState: 'stopped', rowId: 'resource-released->stopped', rationale: 'the resource left use gracefully' },
    { eventType: 'resource-expired', agentTaskState: 'destroyed', rowId: 'resource-expired->destroyed', rationale: 'the lease expired on the destruction path' },
    { eventType: 'resource-lost', agentTaskState: 'failed', rowId: 'resource-lost->failed', rationale: 'loss is the failure path' },
    { eventType: 'acquire-denied', agentTaskState: 'failed', rowId: 'acquire-denied->failed', rationale: 'a denied acquisition never opens (the failure path)' },
    { eventType: 'effect-settled', agentTaskState: null, rowId: 'effect-settled->unclassable', rationale: 'an idempotency outcome record, not a lifecycle phase' },
    { eventType: 'continuity-exported', agentTaskState: null, rowId: 'continuity-exported->unclassable', rationale: 'aggregate row: changes no acquisition state (the journal replay law)' },
    { eventType: 'rollback-recorded', agentTaskState: null, rowId: 'rollback-recorded->unclassable', rationale: 'aggregate row: changes no acquisition state (the journal replay law)' },
    { eventType: 'recovery-scan', agentTaskState: null, rowId: 'recovery-scan->unclassable', rationale: 'aggregate row: changes no acquisition state (the journal replay law)' },
];

const PHASE_BRIDGE_BY_TYPE: Readonly<Record<string, AcquisitionPhaseBridgeRow | undefined>> = (() => {
    const index: Record<string, AcquisitionPhaseBridgeRow | undefined> = {};
    for (const row of ACQUISITION_PHASE_BRIDGE) {
        index[row.eventType] = row;
    }
    return index;
})();

// ---------------------------------------------------------------------------
// The projection record shapes (every returned record the caller may persist
// carries scope + contractVersion -- the contract's own record laws)
// ---------------------------------------------------------------------------

export type ObservatoryScope = PlanModeContract.ObservatoryScope;

/** One admissible plan-mode edge crossing, evidenced by a real task event. */
export interface PlanModeEvidenceRow {
    readonly scope: ObservatoryScope;
    readonly contractVersion: string;
    readonly taskRef: string;
    readonly edge: string;
    readonly evidenceKind: PlanModeContract.PlanModeEvidenceKind;
    readonly evidenceDigest: string;
    readonly taskEventIndex: number;
    readonly taskEventType: string;
    readonly observedAtIso: string;
}

/** One refused plan-mode edge crossing: the typed verdict naming the violated law. */
export interface PlanModeRefusalRow {
    readonly kind: 'refused';
    readonly violatedLaw:
        | 'plan-mode-transition-not-forward'
        | 'plan-mode-evidence-missing'
        | 'plan-mode-supersede-requires-successor-digest';
    readonly taskEventIndex: number;
    readonly taskEventType: string;
    readonly detail: string;
}

export type PlanModeEvidenceTrailRow =
    | { kind: 'evidence'; row: PlanModeEvidenceRow }
    | PlanModeRefusalRow;

export interface PlanModeTaskView {
    readonly scope: ObservatoryScope;
    readonly contractVersion: string;
    readonly taskRef: string;
    readonly taskStatus: TaskStatus;
    /** The projected plan-mode state (the status table composed with the drift verdict). */
    readonly planMode: PlanModeContract.PlanModeState;
    readonly eventsProjected: number;
    readonly evidence: readonly PlanModeEvidenceTrailRow[];
    /** Null while no approved plan is pinned (the honest pre-approval gap). */
    readonly continuity: PlanModeContract.PlanContinuityVerdict | null;
}

export type PlanModeTaskViewVerdict =
    | { kind: 'projected'; view: PlanModeTaskView }
    | {
        kind: 'refused';
        violatedLaw: 'task-status-unmapped';
        taskStatus: string;
        detail: string;
    };

export type PlanContinuityOutcome =
    | {
        kind: 'pinned';
        scope: ObservatoryScope;
        contractVersion: string;
        taskRef: string;
        record: PlanModeContract.PlanContinuityRecord;
        observedRevisionDigest: string;
        verdict: PlanModeContract.PlanContinuityVerdict;
    }
    | {
        kind: 'unpinned';
        violatedLaw: 'plan-continuity-unpinned';
        scope: ObservatoryScope;
        contractVersion: string;
        taskRef: string;
        detail: string;
    };

export type PhaseRowProjection =
    | {
        kind: 'phase';
        rowId: string;
        seq: number;
        eventType: string;
        descriptor: PhasesContract.PhaseDescriptor;
        /** Null when this row opens the phase (the first classed row of its acquisition). */
        transition: PhasesContract.PhaseTransitionVerdict | null;
    }
    | {
        kind: 'unclassable';
        rowId: string;
        seq: number;
        eventType: string;
        violatedLaw: 'phase-state-unknown';
        detail: string;
    };

export interface PhasesGraphView {
    readonly scope: ObservatoryScope;
    readonly contractVersion: string;
    readonly graphId: string;
    readonly rows: number;
    readonly rowsProjected: readonly PhaseRowProjection[];
}

/** The stall/concurrency observation deltas (nowMs defaults to the injected clock). */
export interface RunHealthDeltas {
    readonly concurrencyCapacity: number;
    readonly nowMs?: number;
}

export interface ColdReplayDrillResult {
    readonly scope: ObservatoryScope;
    readonly contractVersion: string;
    readonly journalRows: number;
    readonly headRowId: string;
    readonly headHash: string;
    /** The journal's own chain verification over the loaded rows (disclosed fact; the store fails closed at load). */
    readonly journalVerify: { ok: boolean; rows: number };
    readonly cursor: ReplayContract.ReplayCursor;
    readonly replay: ReplayContract.ReplayDigest;
}

export type ColdReplayDrillVerdict =
    | { kind: 'drilled'; result: ColdReplayDrillResult }
    | {
        kind: 'refused';
        violatedLaw:
            | 'cold-replay-cursor-not-at-journal-head'
            | 'replay-cursor-invalid'
            | 'replay-slice-not-ordered'
            | 'replay-event-before-cursor';
        scope: ObservatoryScope;
        contractVersion: string;
        cursorPinnedEventDigest: string;
        journalHeadDigest: string | null;
        detail: string;
    };

// ---------------------------------------------------------------------------
// THE RUNTIME
// ---------------------------------------------------------------------------

export interface ObservatoryRuntimeOptions {
    readonly root: string;
    /** The fs port for the task authority (defaults to a node-backed port). */
    readonly fs?: FileSystemPort;
    /** The injected clock: drives every timestamp; REQUIRED (the runtime never reads a wall clock). */
    readonly clock: Clock;
    /** Optional acquisition-id minter passthrough (default: derived purely from the injected clock). */
    readonly mintAcquisitionId?: () => string;
}

/** The default node-backed fs port (the task service's own hermetic test port, restated). */
function nodeFsPort(): FileSystemPort {
    return {
        readFileUtf8: async (target: string): Promise<string | undefined> => {
            try {
                return await (await import('node:fs/promises')).readFile(target, { encoding: 'utf-8' });
            } catch (error) {
                if ((error as { code?: string }).code === 'ENOENT') {
                    return undefined;
                }
                throw error;
            }
        },
        writeFile: async (target: string, contents: string): Promise<void> => {
            await (await import('node:fs/promises')).writeFile(target, contents, { encoding: 'utf-8' });
        },
        appendFile: async (target: string, contents: string): Promise<void> => {
            await (await import('node:fs/promises')).appendFile(target, contents, { encoding: 'utf-8' });
        },
        rename: async (fromPath: string, toPath: string): Promise<void> => {
            await (await import('node:fs/promises')).rename(fromPath, toPath);
        },
        mkdir: async (target: string): Promise<void> => {
            await (await import('node:fs/promises')).mkdir(target, { recursive: true });
        },
    };
}

/**
 * The default acquisition-id minter: derived purely from the injected clock
 * (the epoch-ms word as 8 hex chars, doubled into the 16-hex grammar).
 * Deterministic across identically-built roots; inject a ticking clock.
 */
function clockDerivedAcquisitionIdMinter(clock: Clock): () => string {
    return () => {
        const word = (clock() >>> 0).toString(16).padStart(8, '0');
        return `flauz:exec:${word}${word}`;
    };
}

export class ObservatoryRuntime {
    readonly root: string;
    /** The bound REAL agent task authority (the binding-disclosure pattern; seeding goes through its own public APIs). */
    readonly tasks: TaskService;
    /** The bound REAL execution journal authority (append-only; replay projection is the acquisition state). */
    readonly journal: ExecJournalStore;

    private readonly fs: FileSystemPort;
    private readonly clock: Clock;
    private disposed = false;
    private ensured = false;

    constructor(options: ObservatoryRuntimeOptions) {
        need(isRecord(options), 'INVALID-PARAMS', 'ObservatoryRuntime: options {root, fs?, clock, mintAcquisitionId?} are required');
        need(isNonEmptyString(options.root), 'INVALID-PARAMS', 'ObservatoryRuntime: a non-empty workspace root is required');
        need(typeof options.clock === 'function', 'INVALID-PARAMS', 'ObservatoryRuntime: an injected clock (() => epoch-ms number) is required: the runtime never reads a wall clock');
        if (options.fs !== undefined) {
            need(
                isRecord(options.fs)
                && ['readFileUtf8', 'writeFile', 'appendFile', 'rename', 'mkdir'].every(
                    (method) => typeof options.fs![method as keyof FileSystemPort] === 'function',
                ),
                'INVALID-PARAMS',
                'ObservatoryRuntime: the fs port must implement FileSystemPort {readFileUtf8, writeFile, appendFile, rename, mkdir}',
            );
        }
        if (options.mintAcquisitionId !== undefined) {
            need(typeof options.mintAcquisitionId === 'function', 'INVALID-PARAMS', 'ObservatoryRuntime: mintAcquisitionId must be a () => string');
        }
        this.root = options.root;
        this.fs = options.fs ?? nodeFsPort();
        this.clock = options.clock;
        this.tasks = new TaskService({ root: this.root, fs: this.fs, clock: this.clock });
        try {
            this.journal = new ExecJournalStore(this.root, {
                clock: this.clock,
                mintAcquisitionId: options.mintAcquisitionId ?? clockDerivedAcquisitionIdMinter(this.clock),
            });
        } catch (error) {
            throw new ObservatoryRuntimeError('JOURNAL-REFUSED', `the execution journal authority refused to load: ${describeError(error)}`, { refusal: error });
        }
    }

    /**
     * Bootstraps the task authority's own envelope (the TaskService
     * bootstrap: `.flauz/` + the evidence dir + tasks.json). Idempotent; the
     * task-facing views ensure lazily. The journal authority needs no
     * bootstrap (its appendRow creates its own directory).
     */
    async ensure(): Promise<void> {
        if (this.ensured) {
            return;
        }
        this.assertLive();
        try {
            await this.tasks.bootstrap();
        } catch (error) {
            throw new ObservatoryRuntimeError('TASK-AUTHORITY-REFUSED', `the task authority bootstrap failed: ${describeError(error)}`, { refusal: error });
        }
        this.ensured = true;
    }

    private assertLive(): void {
        need(!this.disposed, 'DISPOSED', 'the observatory runtime has been disposed');
    }

    private async ensureReady(): Promise<void> {
        await this.ensure();
    }

    private async loadTask(taskId: string): Promise<Task> {
        this.assertLive();
        await this.ensureReady();
        need(isNonEmptyString(taskId), 'INVALID-PARAMS', 'a non-empty task id is required');
        try {
            return await this.tasks.getTask(taskId);
        } catch (error) {
            const message = describeError(error);
            if (message.includes(`unknown task '${taskId}'`)) {
                throw new ObservatoryRuntimeError('TASK-NOT-FOUND', message, { taskRef: taskId, refusal: error });
            }
            throw new ObservatoryRuntimeError('TASK-AUTHORITY-REFUSED', `the task authority refused the read: ${message}`, { taskRef: taskId, refusal: error });
        }
    }

    // ---------------------------------------------------------------------------
    // The planMode view (over the REAL TaskService)
    // ---------------------------------------------------------------------------

    /**
     * The plan-mode projection of one task: the current plan-mode state from
     * the contract's PLAN_MODE_BY_TASK_STATUS (via planModeFromTaskStatus,
     * fail-closed on an unmapped status), composed with the approved-plan
     * continuity verdict (a drifted plan projects 'superseded' -- a verdict,
     * never an exception), plus the evidence-edge trail folded from the
     * task's own events through the contract's canTransitionPlanMode guard.
     */
    async planModeForTask(scope: ObservatoryScope, taskId: string): Promise<PlanModeTaskViewVerdict> {
        const task = await this.loadTask(taskId);
        const statusVerdict = PlanModeContract.planModeFromTaskStatus(task.status);
        if ('violatedLaw' in statusVerdict) {
            return {
                kind: 'refused',
                violatedLaw: statusVerdict.violatedLaw,
                taskStatus: statusVerdict.taskStatus,
                detail: `the task authority status '${statusVerdict.taskStatus}' has no plan-mode projection (the contract table is total over the authority vocabulary)`,
            };
        }
        const continuity = this.deriveContinuity(scope, task);
        const evidence = this.foldPlanModeEvidence(scope, task);
        const drifted = continuity.kind === 'pinned' && continuity.verdict.kind === 'drifted';
        const planMode: PlanModeContract.PlanModeState = drifted ? 'superseded' : statusVerdict.planMode;
        return {
            kind: 'projected',
            view: {
                scope: scope,
                contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
                taskRef: task.id,
                taskStatus: task.status,
                planMode: planMode,
                eventsProjected: task.events.length,
                evidence: evidence,
                continuity: continuity.kind === 'pinned' ? continuity.verdict : null,
            },
        };
    }

    /**
     * The approved-plan continuity of one task: the PlanContinuityRecord
     * pinned at execution start (the approval event's planRevisionDigest)
     * and the contract's planContinuityVerdict over the observed revision.
     * A task with no approval evidence, or an approval event carrying no
     * digest, is the typed UNPINNED verdict (the honest pre-approval gap)
     * -- never a fabricated anchor.
     */
    async planContinuityForTask(scope: ObservatoryScope, taskId: string): Promise<PlanContinuityOutcome> {
        const task = await this.loadTask(taskId);
        return this.deriveContinuity(scope, task);
    }

    private deriveContinuity(scope: ObservatoryScope, task: Task): PlanContinuityOutcome {
        let approval: TaskEvent | undefined;
        for (let index = task.events.length - 1; index >= 0; index -= 1) {
            if (task.events[index]!.type === 'approve') {
                approval = task.events[index];
                break;
            }
        }
        if (approval === undefined) {
            return {
                kind: 'unpinned',
                violatedLaw: 'plan-continuity-unpinned',
                scope: scope,
                contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
                taskRef: task.id,
                detail: 'the task has no approval evidence: no plan revision is pinned at execution start',
            };
        }
        const pinnedRaw = (approval.payload as Record<string, unknown>)[PLAN_REVISION_DIGEST_PAYLOAD_KEY];
        if (!isNonEmptyString(pinnedRaw)) {
            return {
                kind: 'unpinned',
                violatedLaw: 'plan-continuity-unpinned',
                scope: scope,
                contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
                taskRef: task.id,
                detail: `the approval event carries no ${PLAN_REVISION_DIGEST_PAYLOAD_KEY} payload: no plan revision is pinned (the fail-closed payload convention)`,
            };
        }
        const observed = lastPlanRevisionDigest(task.events) ?? pinnedRaw;
        const record: PlanModeContract.PlanContinuityRecord = {
            scope: scope,
            contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
            planId: planIdOfTask(task.id),
            taskRef: task.id,
            pinnedRevisionDigest: pinnedRaw,
            pinnedAtIso: epochMsToIsoUtc(approval.ts),
        };
        return {
            kind: 'pinned',
            scope: scope,
            contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
            taskRef: task.id,
            record: record,
            observedRevisionDigest: observed,
            verdict: PlanModeContract.planContinuityVerdict(record, observed),
        };
    }

    /**
     * The evidence-edge trail: folds the task's own events, walking the
     * task-transition -> plan-mode-edge bridge; every bridged edge is
     * validated through the contract's canTransitionPlanMode guard (the
     * evidence digest is the sha256 of the canonical event, and a supersede
     * edge requires the successor digest the superseding event carries).
     * Non-transition events carry no plan-mode edge (the authority's own
     * discipline: only transition events move the state machine -- the
     * eventsProjected census keeps the walk honest). A refused edge is the
     * typed verdict row naming the violated law -- never a silent skip.
     */
    private foldPlanModeEvidence(scope: ObservatoryScope, task: Task): readonly PlanModeEvidenceTrailRow[] {
        const rows: PlanModeEvidenceTrailRow[] = [];
        let cycleState: PlanModeContract.PlanModeState | null = 'draft';
        for (const [index, event] of task.events.entries()) {
            if (transitionRule(event.type) === undefined) {
                continue;
            }
            const bridged = PLAN_MODE_BRIDGE_BY_TYPE[event.type];
            const edges = bridged?.edges ?? [];
            for (const edge of edges) {
                if (cycleState === null) {
                    if (edge.from !== 'draft') {
                        rows.push({
                            kind: 'refused',
                            violatedLaw: 'plan-mode-transition-not-forward',
                            taskEventIndex: index,
                            taskEventType: event.type,
                            detail: `the plan-mode cycle is closed (superseded) and the edge ${edge.from} -> ${edge.to} does not open a fresh cycle at draft`,
                        });
                        continue;
                    }
                    cycleState = 'draft';
                } else if (edge.from !== cycleState) {
                    rows.push({
                        kind: 'refused',
                        violatedLaw: 'plan-mode-transition-not-forward',
                        taskEventIndex: index,
                        taskEventType: event.type,
                        detail: `the edge ${edge.from} -> ${edge.to} does not continue the open plan-mode cycle (open: ${cycleState})`,
                    });
                    continue;
                }
                const successor = edge.to === 'superseded' ? planRevisionDigestOf(event) : undefined;
                const verdict = PlanModeContract.canTransitionPlanMode({
                    from: edge.from,
                    to: edge.to,
                    evidenceDigest: taskEventDigest(event),
                    ...(successor !== undefined ? { successorPlanRevisionDigest: successor } : {}),
                });
                if (!verdict.admissible) {
                    rows.push({
                        kind: 'refused',
                        violatedLaw: verdict.violatedLaw,
                        taskEventIndex: index,
                        taskEventType: event.type,
                        detail: verdict.detail,
                    });
                    continue;
                }
                rows.push({
                    kind: 'evidence',
                    row: {
                        scope: scope,
                        contractVersion: PlanModeContract.OBSERVATORY_CONTRACTS_VERSION,
                        taskRef: task.id,
                        edge: `${edge.from}->${edge.to}`,
                        evidenceKind: verdict.evidenceKind,
                        evidenceDigest: taskEventDigest(event),
                        taskEventIndex: index,
                        taskEventType: event.type,
                        observedAtIso: epochMsToIsoUtc(event.ts),
                    },
                });
                cycleState = edge.to === 'superseded' ? null : edge.to;
            }
        }
        return rows;
    }

    // ---------------------------------------------------------------------------
    // The phases view (over the REAL ExecJournalStore)
    // ---------------------------------------------------------------------------

    /**
     * The phase projection of one graph: phase descriptors for the graph's
     * rows through the acquisition-event -> phase-state bridge and the
     * contract's PHASE_STATE_ORDER (each descriptor's entryEvidenceDigest is
     * the JOURNAL'S OWN row hash, execRowHashOf); the per-acquisition fold
     * validates every successive transition through the contract's
     * canTransitionPhase guard (forward-only). A row the bridge cannot
     * class (aggregate rows, effect settlements) is the typed
     * 'phase-state-unknown' verdict -- never a silent skip. Honest
     * disclosure: the phase-local order is a PROJECTION order, never the
     * authority's own transition map, so an authority-legal sequence may
     * project as not-forward and is disclosed as the typed verdict.
     */
    phasesForGraph(scope: ObservatoryScope, graphId: string): PhasesGraphView {
        this.assertLive();
        need(isNonEmptyString(graphId), 'INVALID-PARAMS', 'a non-empty graph id is required');
        const rows = this.journal.rowsForGraph(graphId);
        const phaseStateByAcquisition = new Map<string, PhasesContract.AgentTaskState>();
        const rowsProjected: PhaseRowProjection[] = [];
        for (const row of rows) {
            const bridged = PHASE_BRIDGE_BY_TYPE[row.type];
            if (bridged === undefined || bridged.agentTaskState === null || row.acquisitionId === null) {
                rowsProjected.push({
                    kind: 'unclassable',
                    rowId: row.rowId,
                    seq: row.seq,
                    eventType: row.type,
                    violatedLaw: 'phase-state-unknown',
                    detail: bridged === undefined
                        ? `journal event type '${row.type}' has no acquisition-phase bridge row`
                        : (bridged.agentTaskState === null
                            ? bridged.rationale
                            : `${row.type} row ${row.rowId} carries no acquisitionId (the acquisition phase cannot be identified)`),
                });
                continue;
            }
            const descriptor: PhasesContract.PhaseDescriptor = {
                scope: scope,
                contractVersion: PhasesContract.OBSERVATORY_CONTRACTS_VERSION,
                phaseId: row.acquisitionId,
                parentTaskRef: graphId,
                agentTaskState: bridged.agentTaskState,
                entryEvidenceDigest: execRowHashOf(row),
                exitEvidenceDigest: null,
            };
            const previous = phaseStateByAcquisition.get(row.acquisitionId);
            const transition: PhasesContract.PhaseTransitionVerdict | null = previous === undefined
                ? null
                : PhasesContract.canTransitionPhase({
                    scope: scope,
                    contractVersion: PhasesContract.OBSERVATORY_CONTRACTS_VERSION,
                    phaseId: row.acquisitionId,
                    from: previous,
                    to: bridged.agentTaskState,
                    evidenceDigest: execRowHashOf(row),
                    observedAtIso: epochMsToIsoUtc(row.ts),
                });
            phaseStateByAcquisition.set(row.acquisitionId, bridged.agentTaskState);
            rowsProjected.push({
                kind: 'phase',
                rowId: row.rowId,
                seq: row.seq,
                eventType: row.type,
                descriptor: descriptor,
                transition: transition,
            });
        }
        return {
            scope: scope,
            contractVersion: PhasesContract.OBSERVATORY_CONTRACTS_VERSION,
            graphId: graphId,
            rows: rows.length,
            rowsProjected: rowsProjected,
        };
    }

    // ---------------------------------------------------------------------------
    // The runHealth view (over the REAL TaskService's live task records)
    // ---------------------------------------------------------------------------

    /**
     * The stall/concurrency gauge over the live task records: derives one
     * RunHealthTaskRecord per task (the authority state CARRIED opaque; the
     * last event time from the task timing; the heart evidence from the
     * latest event; the slot projected from the authority's own
     * ACTIVE_STATUSES vocabulary -- active tasks occupy 'in-use' slots and
     * every other status lands on 'queued', the closed vocabulary's honest
     * residual) and projects through the contract's projectRunHealth with
     * the INJECTED nowMs (defaults to the injected clock). The contract's
     * own refusal verdicts (empty input, scope mismatch, version mismatch)
     * pass through typed.
     */
    async runHealthView(scope: ObservatoryScope, deltas: RunHealthDeltas): Promise<RunHealthContract.RunHealthProjectionVerdict> {
        this.assertLive();
        await this.ensureReady();
        need(isRecord(deltas), 'INVALID-PARAMS', 'runHealthView requires {concurrencyCapacity, nowMs?}');
        need(
            typeof deltas.concurrencyCapacity === 'number' && Number.isSafeInteger(deltas.concurrencyCapacity) && deltas.concurrencyCapacity >= 0,
            'INVALID-PARAMS',
            'concurrencyCapacity must be a non-negative safe integer (the injected gauge capacity)',
        );
        const tasks = await this.tasks.listTasks();
        const records: RunHealthContract.RunHealthTaskRecord[] = tasks.map((task) => ({
            scope: scope,
            contractVersion: RunHealthContract.OBSERVATORY_CONTRACTS_VERSION,
            taskRef: task.id,
            agentTaskState: task.status,
            lastEventAtMs: task.timing.updatedAt,
            lastHeartAtMs: task.events.length === 0 ? null : task.events[task.events.length - 1]!.ts,
            slot: (ACTIVE_STATUSES as readonly string[]).includes(task.status) ? 'in-use' : 'queued',
        }));
        return RunHealthContract.projectRunHealth(records, {
            nowMs: deltas.nowMs ?? this.clock(),
            concurrencyCapacity: deltas.concurrencyCapacity,
        });
    }

    // ---------------------------------------------------------------------------
    // The cold-replay drill (over the REAL ExecJournalStore)
    // ---------------------------------------------------------------------------

    /**
     * The deterministic cold-replay drill: pins a ReplayCursor to the
     * journal's OWN head hash (ExecJournalStore.headHash(), which IS
     * execRowHashOf of the last row -- the journal's digest law, never a
     * re-derived competing digest), folds the contract's replayDigest over
     * the covered slice (the rows at or after the cursor position, each
     * event's digest being the journal's own row hash), and gates the
     * replay with the contract's coldReplayAdmissible. A cursor that does
     * not match the journal head is the typed refusal carrying BOTH digests
     * (the contract's fail-closed law); an empty journal refuses typedly
     * (no head event to pin). The cursor may be overridden (a resumed drill
     * re-pins its stored cursor); the default is a freshly pinned head
     * cursor, and a FRESH runtime over the same root re-derives the
     * identical drill (the restart-determinism pin).
     */
    coldReplayDrill(scope: ObservatoryScope, cursor?: ReplayContract.ReplayCursor): ColdReplayDrillVerdict {
        this.assertLive();
        const rows = this.journal.rowsAll();
        const headHash = this.journal.headHash();
        if (rows.length === 0 || headHash === null) {
            return {
                kind: 'refused',
                violatedLaw: 'replay-cursor-invalid',
                scope: scope,
                contractVersion: ReplayContract.OBSERVATORY_CONTRACTS_VERSION,
                cursorPinnedEventDigest: '',
                journalHeadDigest: null,
                detail: 'the journal is empty: no head event exists to pin a replay cursor to',
            };
        }
        const pinned: ReplayContract.ReplayCursor = cursor ?? {
            scope: scope,
            contractVersion: ReplayContract.OBSERVATORY_CONTRACTS_VERSION,
            journalPosition: rows.length,
            pinnedEventDigest: headHash,
        };
        const admission = ReplayContract.coldReplayAdmissible(pinned, headHash);
        if (!admission.admissible) {
            return {
                kind: 'refused',
                violatedLaw: admission.violatedLaw,
                scope: scope,
                contractVersion: ReplayContract.OBSERVATORY_CONTRACTS_VERSION,
                cursorPinnedEventDigest: admission.cursorPinnedEventDigest,
                journalHeadDigest: admission.journalHeadDigest,
                detail: `the replay cursor is not pinned at the journal head (cursor digest ${admission.cursorPinnedEventDigest} vs journal head ${admission.journalHeadDigest}) -- the fail-closed cold-replay law carries both digests`,
            };
        }
        const covered = rows
            .filter((row) => row.seq >= pinned.journalPosition)
            .map((row) => toReplayJournalEvent(row));
        const folded = ReplayContract.replayDigest(covered, pinned);
        if ('kind' in folded) {
            return {
                kind: 'refused',
                violatedLaw: folded.violatedLaw,
                scope: scope,
                contractVersion: ReplayContract.OBSERVATORY_CONTRACTS_VERSION,
                cursorPinnedEventDigest: pinned.pinnedEventDigest,
                journalHeadDigest: headHash,
                detail: `the replay digest fold refused: ${folded.detail}`,
            };
        }
        return {
            kind: 'drilled',
            result: {
                scope: scope,
                contractVersion: ReplayContract.OBSERVATORY_CONTRACTS_VERSION,
                journalRows: rows.length,
                headRowId: rows[rows.length - 1]!.rowId,
                headHash: headHash,
                journalVerify: this.journal.verifyJournal(),
                cursor: pinned,
                replay: folded,
            },
        };
    }

    dispose(): void {
        this.disposed = true;
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** The last planRevisionDigest any event carries (the observed revision), or undefined. */
function lastPlanRevisionDigest(events: readonly TaskEvent[]): string | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const digest = planRevisionDigestOf(events[index]!);
        if (digest !== undefined) {
            return digest;
        }
    }
    return undefined;
}

function planRevisionDigestOf(event: TaskEvent): string | undefined {
    const raw = (event.payload as Record<string, unknown>)[PLAN_REVISION_DIGEST_PAYLOAD_KEY];
    return isNonEmptyString(raw) ? raw : undefined;
}

/**
 * Maps one journal row onto the contract's ReplayJournalEvent: the event
 * digest is the JOURNAL'S OWN row hash (execRowHashOf -- never a competing
 * digest); the agentTaskState carries the row's bridged phase state (the
 * authority LIFECYCLE_STATES vocabulary) with the disclosed 'unclassable'
 * marker for row classes the bridge cannot class; the emitted instant is
 * the pure ISO conversion of the row's own ts.
 */
function toReplayJournalEvent(row: ExecJournalRow): ReplayContract.ReplayJournalEvent {
    const bridged = PHASE_BRIDGE_BY_TYPE[row.type];
    return {
        position: row.seq,
        kind: row.type,
        agentTaskState: bridged?.agentTaskState ?? 'unclassable',
        eventDigest: execRowHashOf(row),
        emittedAtIso: epochMsToIsoUtc(row.ts),
    };
}
