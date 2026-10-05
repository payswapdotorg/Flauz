/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * ZC-008 agent-native command facade contracts: bounded typed compound
 * commands (contract module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Bounded optimizations only: this module declares types, constants,
 *   pure guards and transition maps over the EXISTING Tool and Approval
 *   authorities. It declares no runtime, no executor, no cache engine,
 *   no storage. Compound commands exist only as bounded optimizations
 *   that preserve provenance and side-effect visibility.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; clock deltas
 *   are injected by callers.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   Shapes shared with sibling contract modules are re-declared here and
 *   pinned structurally by the test suite.
 * - Every persisted record carries scope (FacadeScope), contractVersion
 *   and plain-string ISO timestamps.
 */

/** Version of the command-facade contract set (all modules carry it). */
export const COMMAND_FACADE_CONTRACTS_VERSION = '1.0.0';

/**
 * THE BOUND LAW: compound commands are bounded. canAdmitCompound rejects
 * any compound with more steps than this constant, naming the bound in
 * the rejection detail. The value is a contract decision; changing it is
 * a contract change and requires a version bump.
 */
export const MAX_COMPOUND_STEPS = 16;

/** Isolation scope stamped on every persisted record. */
export interface FacadeScope {
    readonly workspaceId: string;
    readonly tenantId: string;
}

/** Pure guard: a scope with non-empty workspace and tenant ids. */
export function isFacadeScope(value: unknown): value is FacadeScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const scope = value as { workspaceId?: unknown; tenantId?: unknown };
    return isNonEmptyString(scope.workspaceId) && isNonEmptyString(scope.tenantId);
}

/** Closed list of side-effect kinds (a disclosure names exactly one). */
export const SIDE_EFFECT_KINDS = ['read', 'write', 'network', 'spawn'] as const;
export type SideEffectKind = (typeof SIDE_EFFECT_KINDS)[number];

/**
 * SIDE-EFFECT VISIBILITY LAW: side effects are always visible. The list
 * admits exactly one visibility, so the SideEffectDisclosure type admits
 * no invisible effect.
 */
export const SIDE_EFFECT_VISIBILITIES = ['visible'] as const;
export type SideEffectVisibility = (typeof SIDE_EFFECT_VISIBILITIES)[number];

/** Authority surface a side effect touches (authority-surface-shaped). */
export interface SideEffectSurfaceRef {
    readonly surfaceKind: string;
    readonly resourceId: string;
}

/** The shared disclosure shape: what a step touches, and how visibly. */
export interface SideEffectDisclosure {
    readonly surfaceRef: SideEffectSurfaceRef;
    readonly kind: SideEffectKind;
    /** Opaque provenance digest (authority digest format). */
    readonly provenanceDigest: string;
    readonly visibility: SideEffectVisibility;
}

/** Pure guard: a well-formed, visible side-effect disclosure. */
export function isSideEffectDisclosure(value: unknown): value is SideEffectDisclosure {
    return sideEffectViolation(value) === undefined;
}

/** Closed list of approval requirements for a compound step. */
export const APPROVAL_REQUIREMENTS = ['none', 'confirmation'] as const;
export type ApprovalRequirement = (typeof APPROVAL_REQUIREMENTS)[number];

/**
 * Typed reference to a tool of the agent Tool authority vocabulary.
 * This is a projection shape over the authority surface: it references
 * an existing tool; it never declares a new one.
 */
export interface ToolRef {
    /** Vocabulary name, spelled exactly as the Tool authority spells it. */
    readonly toolName: string;
}

/** Pure guard: a named tool reference. */
export function isToolRef(value: unknown): value is ToolRef {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const ref = value as { toolName?: unknown };
    return isNonEmptyString(ref.toolName);
}

/** One entry of the frozen tool-vocabulary projection. */
export interface ToolVocabularyEntry {
    readonly toolName: string;
    /** True iff the authority routes this tool through HumanApproval. */
    readonly confirmationGated: boolean;
}

/**
 * SEAM(TOOL_VOCABULARY) - repo-side transcription required.
 *
 * The frozen tool vocabulary table ships EMPTY by design. Before the
 * gates are run, transcribe the Tool authority into it:
 *
 *   Source of names: extensions/flauz-agent/src/types.ts (the tool
 *   vocabulary of the Tool authority).
 *   Source of gating: extensions/flauz-agent/src/orchestrator.ts and
 *   extensions/flauz-agent/src/tools/terminalTool.ts (the HumanApproval
 *   confirmation gate).
 *   Instruction: one ToolVocabularyEntry per tool in the authority
 *   vocabulary; toolName spelled EXACTLY as the authority spells it;
 *   confirmationGated true iff that tool routes through the HumanApproval
 *   confirmation gate. Do not invent, rename, merge or omit tools.
 *   Sibling copy: transcribe the IDENTICAL entries into
 *   FROZEN_TOOL_VOCABULARY in
 *   build/flauz/capabilities/commands/common/facade.ts; the facade test
 *   suite pins both copies deep-equal.
 *
 * Until the seam is transcribed, canAdmitCompound fails closed: no
 * toolRef resolves and every compound is rejected with 'unknown-tool'.
 */
export const FROZEN_TOOL_VOCABULARY: readonly ToolVocabularyEntry[] = freezeEntries([
    // SEAM(TOOL_VOCABULARY): CLOSED 2026-10-05 — transcribed from the Tool
    // authority (extensions/flauz-agent/src/tools/terminalTool.ts
    // TERMINAL_TOOL_ID = 'flauz_terminal'; the sole registered tool, via
    // vscode.lm.registerTool in extension.ts; routed through the
    // HumanApproval confirmation gate per orchestrator.ts).
    { toolName: 'flauz_terminal', confirmationGated: true },
]);

/** One step of a compound command. */
export interface CompoundStep {
    readonly stepId: string;
    /** Tool-authority reference for this step. */
    readonly toolRef: ToolRef;
    /** Opaque digest over this step's arguments (authority format). */
    readonly argsDigest: string;
    /** What this step will touch: side effects are always visible. */
    readonly expectedSideEffects: readonly SideEffectDisclosure[];
    /**
     * Approval routing for this step. A step whose toolRef resolves to a
     * confirmation-gated vocabulary entry MUST declare 'confirmation';
     * canAdmitCompound rejects anything else (side effects may never
     * silently escape approval). Over-declaring 'confirmation' on a
     * non-gated tool is permitted: over-approval is not a violation.
     */
    readonly approvalRequirement: ApprovalRequirement;
}

/** A bounded typed compound command over the existing authorities. */
export interface CompoundCommand {
    readonly scope: FacadeScope;
    readonly contractVersion: string;
    readonly commandId: string;
    /** Opaque digest of the command name (authority format). */
    readonly nameDigest: string;
    readonly steps: readonly CompoundStep[];
}

/** Closed list of compound admission rejection reasons. */
export const COMPOUND_REJECTION_REASONS = [
    'invalid-scope',
    'contract-version-mismatch',
    'invalid-command-id',
    'invalid-name-digest',
    'empty-steps',
    'too-many-steps',
    'duplicate-step-id',
    'invalid-step',
    'unknown-tool',
    'approval-requirement-mismatch',
] as const;
export type CompoundRejectionReason = (typeof COMPOUND_REJECTION_REASONS)[number];

export interface CompoundAdmitted {
    readonly admitted: true;
    readonly commandId: string;
    readonly stepCount: number;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface CompoundRejected {
    readonly admitted: false;
    readonly reason: CompoundRejectionReason;
    readonly detail: string;
}

export type CompoundAdmission = CompoundAdmitted | CompoundRejected;

/**
 * Pure admission guard for compound commands. Checks, in order: scope
 * shape, contract version, command identity digests, non-empty steps,
 * the bound (MAX_COMPOUND_STEPS), unique step ids, per-step shape
 * (toolRef, argsDigest, disclosures), tool resolution against the
 * vocabulary, and approval-requirement consistency (fail closed).
 *
 * The vocabulary defaults to FROZEN_TOOL_VOCABULARY; callers and tests
 * may inject their own read-only table. Guards never mutate inputs.
 */
export function canAdmitCompound(
    command: CompoundCommand,
    toolVocabulary: readonly ToolVocabularyEntry[] = FROZEN_TOOL_VOCABULARY,
): CompoundAdmission {
    if (!isFacadeScope(command.scope)) {
        return rejectAdmission('invalid-scope', 'scope must carry non-empty workspaceId and tenantId');
    }
    if (command.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
        return rejectAdmission(
            'contract-version-mismatch',
            `contractVersion must be '${COMMAND_FACADE_CONTRACTS_VERSION}', got '${command.contractVersion}'`,
        );
    }
    if (!isNonEmptyString(command.commandId)) {
        return rejectAdmission('invalid-command-id', 'commandId must be a non-empty string');
    }
    if (!isNonEmptyString(command.nameDigest)) {
        return rejectAdmission('invalid-name-digest', 'nameDigest must be a non-empty string');
    }
    if (!Array.isArray(command.steps) || command.steps.length === 0) {
        return rejectAdmission('empty-steps', 'a compound command must carry at least one step');
    }
    if (command.steps.length > MAX_COMPOUND_STEPS) {
        return rejectAdmission(
            'too-many-steps',
            `compound carries ${command.steps.length} steps; the bound is MAX_COMPOUND_STEPS=${MAX_COMPOUND_STEPS} (unbounded compounds are rejected by law)`,
        );
    }
    const seenStepIds = new Set<string>();
    for (const step of command.steps) {
        if (!isNonEmptyString(step.stepId)) {
            return rejectAdmission('invalid-step', 'every step must carry a non-empty stepId');
        }
        if (seenStepIds.has(step.stepId)) {
            return rejectAdmission('duplicate-step-id', `stepId '${step.stepId}' appears more than once`);
        }
        seenStepIds.add(step.stepId);
        if (!isToolRef(step.toolRef)) {
            return rejectAdmission('invalid-step', `step '${step.stepId}' carries an invalid toolRef`);
        }
        if (!isNonEmptyString(step.argsDigest)) {
            return rejectAdmission('invalid-step', `step '${step.stepId}' carries an empty argsDigest`);
        }
        if (!APPROVAL_REQUIREMENTS.includes(step.approvalRequirement)) {
            return rejectAdmission('invalid-step', `step '${step.stepId}' carries an unknown approvalRequirement`);
        }
        if (!Array.isArray(step.expectedSideEffects)) {
            return rejectAdmission('invalid-step', `step '${step.stepId}' must list its expected side effects`);
        }
        for (const disclosure of step.expectedSideEffects) {
            const violation = sideEffectViolation(disclosure);
            if (violation !== undefined) {
                return rejectAdmission('invalid-step', `step '${step.stepId}': ${violation}`);
            }
        }
        const vocabularyEntry = resolveToolEntry(step.toolRef, toolVocabulary);
        if (vocabularyEntry === undefined) {
            return rejectAdmission(
                'unknown-tool',
                `step '${step.stepId}' references tool '${step.toolRef.toolName}' which does not resolve in the tool vocabulary`,
            );
        }
        if (vocabularyEntry.confirmationGated && step.approvalRequirement !== 'confirmation') {
            return rejectAdmission(
                'approval-requirement-mismatch',
                `step '${step.stepId}' uses confirmation-gated tool '${vocabularyEntry.toolName}' with approvalRequirement 'none'; side effects may never silently escape approval`,
            );
        }
    }
    return { admitted: true, commandId: command.commandId, stepCount: command.steps.length };
}

/**
 * Per-step approval receipt: PROVENANCE for the step's routing through
 * the Approval authority. Steps with requirement 'none' still carry a
 * receipt documenting that no approval was required; steps with
 * 'confirmation' carry a receipt referencing the HumanApproval record.
 */
export interface StepApprovalReceipt {
    readonly stepId: string;
    readonly requirement: ApprovalRequirement;
    /** Opaque digest over the Approval-authority routing record. */
    readonly approvalRoutingDigest: string;
}

/** Per-step execution receipt: the provenance-bearing trail element. */
export interface CompoundStepReceipt {
    readonly stepId: string;
    readonly toolRef: ToolRef;
    readonly argsDigest: string;
    /** The effects this step disclosed at execution time. */
    readonly sideEffects: readonly SideEffectDisclosure[];
    readonly approvalReceipt: StepApprovalReceipt;
}

/**
 * THE PROVENANCE-BEARING RECORD: every executed compound leaves its full
 * step receipt trail. isCompleteExecutionRecord verifies a record
 * against its command (the command is presumed admitted; run
 * canAdmitCompound first).
 */
export interface CompoundExecutionRecord {
    readonly scope: FacadeScope;
    readonly contractVersion: string;
    readonly commandId: string;
    readonly stepReceipts: readonly CompoundStepReceipt[];
    /** ISO-8601 plain-string execution timestamp. */
    readonly executedAtIso: string;
}

/** Closed list of execution-record rejection reasons. */
export const EXECUTION_RECORD_REJECTION_REASONS = [
    'contract-version-mismatch',
    'command-id-mismatch',
    'scope-mismatch',
    'step-trail-mismatch',
    'approval-receipt-mismatch',
    'invalid-executed-at',
] as const;
export type ExecutionRecordRejectionReason = (typeof EXECUTION_RECORD_REJECTION_REASONS)[number];

export interface ExecutionRecordComplete {
    readonly complete: true;
    readonly commandId: string;
    readonly stepCount: number;
}

export interface ExecutionRecordIncomplete {
    readonly complete: false;
    readonly reason: ExecutionRecordRejectionReason;
    readonly detail: string;
}

export type ExecutionRecordCheck = ExecutionRecordComplete | ExecutionRecordIncomplete;

/**
 * Pure trail check: the record must cover its command exactly (same
 * command id, same scope, one receipt per step, matching tool names and
 * argument digests) with approval receipts consistent with the steps,
 * and fail closed: a confirmation-gated tool with a 'none' receipt is a
 * typed rejection even when the receipt matches the (inadmissible) step.
 * The vocabulary defaults to FROZEN_TOOL_VOCABULARY.
 */
export function isCompleteExecutionRecord(
    command: CompoundCommand,
    record: CompoundExecutionRecord,
    toolVocabulary: readonly ToolVocabularyEntry[] = FROZEN_TOOL_VOCABULARY,
): ExecutionRecordCheck {
    if (record.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
        return rejectRecord(
            'contract-version-mismatch',
            `record contractVersion must be '${COMMAND_FACADE_CONTRACTS_VERSION}', got '${record.contractVersion}'`,
        );
    }
    if (!isNonEmptyString(record.executedAtIso)) {
        return rejectRecord('invalid-executed-at', 'executedAtIso must be a non-empty ISO-8601 string');
    }
    if (record.commandId !== command.commandId) {
        return rejectRecord(
            'command-id-mismatch',
            `record claims command '${record.commandId}', command is '${command.commandId}'`,
        );
    }
    if (record.scope.workspaceId !== command.scope.workspaceId || record.scope.tenantId !== command.scope.tenantId) {
        return rejectRecord('scope-mismatch', 'record scope does not match the command scope');
    }
    const receiptCount = Array.isArray(record.stepReceipts) ? record.stepReceipts.length : -1;
    if (receiptCount !== command.steps.length) {
        return rejectRecord(
            'step-trail-mismatch',
            `record carries ${receiptCount} step receipts for ${command.steps.length} steps`,
        );
    }
    const receiptsByStepId = new Map<string, CompoundStepReceipt>();
    for (const receipt of record.stepReceipts) {
        if (!isNonEmptyString(receipt.stepId)) {
            return rejectRecord('step-trail-mismatch', 'every step receipt must carry a non-empty stepId');
        }
        if (receiptsByStepId.has(receipt.stepId)) {
            return rejectRecord('step-trail-mismatch', `duplicate step receipt for stepId '${receipt.stepId}'`);
        }
        receiptsByStepId.set(receipt.stepId, receipt);
    }
    for (const step of command.steps) {
        const receipt = receiptsByStepId.get(step.stepId);
        if (receipt === undefined) {
            return rejectRecord('step-trail-mismatch', `no step receipt for stepId '${step.stepId}'`);
        }
        if (receipt.toolRef.toolName !== step.toolRef.toolName) {
            return rejectRecord(
                'step-trail-mismatch',
                `receipt for step '${step.stepId}' names tool '${receipt.toolRef.toolName}', step names '${step.toolRef.toolName}'`,
            );
        }
        if (receipt.argsDigest !== step.argsDigest) {
            return rejectRecord('step-trail-mismatch', `receipt for step '${step.stepId}' carries a different argsDigest`);
        }
        const approvalReceipt = receipt.approvalReceipt;
        if (approvalReceipt.stepId !== step.stepId) {
            return rejectRecord(
                'approval-receipt-mismatch',
                `approval receipt inside step '${step.stepId}' carries stepId '${approvalReceipt.stepId}'`,
            );
        }
        if (!isNonEmptyString(approvalReceipt.approvalRoutingDigest)) {
            return rejectRecord(
                'approval-receipt-mismatch',
                `approval receipt for step '${step.stepId}' carries an empty approvalRoutingDigest`,
            );
        }
        if (!APPROVAL_REQUIREMENTS.includes(approvalReceipt.requirement)) {
            return rejectRecord(
                'approval-receipt-mismatch',
                `approval receipt for step '${step.stepId}' carries an unknown requirement`,
            );
        }
        if (approvalReceipt.requirement !== step.approvalRequirement) {
            return rejectRecord(
                'approval-receipt-mismatch',
                `approval receipt for step '${step.stepId}' says '${approvalReceipt.requirement}', the step declares '${step.approvalRequirement}'`,
            );
        }
        const vocabularyEntry = resolveToolEntry(step.toolRef, toolVocabulary);
        if (vocabularyEntry !== undefined && vocabularyEntry.confirmationGated && approvalReceipt.requirement !== 'confirmation') {
            return rejectRecord(
                'approval-receipt-mismatch',
                `step '${step.stepId}' used confirmation-gated tool '${vocabularyEntry.toolName}' with a 'none' approval receipt; side effects may never silently escape approval`,
            );
        }
    }
    return { complete: true, commandId: record.commandId, stepCount: record.stepReceipts.length };
}

function freezeEntries(entries: ToolVocabularyEntry[]): readonly ToolVocabularyEntry[] {
    return Object.freeze(entries);
}

function rejectAdmission(reason: CompoundRejectionReason, detail: string): CompoundRejected {
    return { admitted: false, reason, detail };
}

function rejectRecord(reason: ExecutionRecordRejectionReason, detail: string): ExecutionRecordIncomplete {
    return { complete: false, reason, detail };
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function resolveToolEntry(
    toolRef: ToolRef,
    vocabulary: readonly ToolVocabularyEntry[],
): ToolVocabularyEntry | undefined {
    for (const entry of vocabulary) {
        if (entry.toolName === toolRef.toolName) {
            return entry;
        }
    }
    return undefined;
}

/** Returns a precise violation message, or undefined when well-formed. */
function sideEffectViolation(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null) {
        return 'side-effect disclosure must be an object';
    }
    const disclosure = value as Record<string, unknown>;
    const surfaceRef = disclosure.surfaceRef;
    if (typeof surfaceRef !== 'object' || surfaceRef === null) {
        return 'side-effect disclosure must carry a surfaceRef object';
    }
    const surface = surfaceRef as Record<string, unknown>;
    if (!isNonEmptyString(surface.surfaceKind) || !isNonEmptyString(surface.resourceId)) {
        return 'surfaceRef must carry non-empty surfaceKind and resourceId';
    }
    if (!(SIDE_EFFECT_KINDS as readonly string[]).includes(disclosure.kind as string)) {
        return `side-effect kind must be one of read/write/network/spawn, got '${String(disclosure.kind)}'`;
    }
    if (!isNonEmptyString(disclosure.provenanceDigest)) {
        return 'side-effect disclosure must carry a non-empty provenanceDigest';
    }
    if (disclosure.visibility !== 'visible') {
        return `side-effect visibility must be 'visible' (side effects are always visible by law), got '${String(disclosure.visibility)}'`;
    }
    return undefined;
}