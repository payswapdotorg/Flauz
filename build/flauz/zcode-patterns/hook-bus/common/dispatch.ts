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
 * ZC-003 Hook Bus - bus composition / dispatch pipeline contracts (contract
 * set version 1.0.0).
 *
 * PROJECTIONS, NOT AUTHORITIES: this module projects the dispatch pipeline
 * CONTRACT over the agent and execution authorities (READ ONLY, never edited
 * by this wave): extensions/flauz-agent/src/types.ts (TaskEvent, TaskEnvelope,
 * SeamEventEnvelope session/task/event semantics),
 * extensions/flauz-agent/src/orchestrator.ts (the orchestration loop whose
 * terminal-tool invocation runs through the HumanApproval confirmation gate),
 * extensions/flauz-agent/src/tools/terminalTool.ts (vscode.lm.registerTool
 * plus HumanApproval), and extensions/flauz-execution/src/contracts.ts (the
 * 26-state AgentTaskState machine and LIFECYCLE_STATES). There is no runtime
 * bus, scheduler, executor, dispatcher, or event emitter here: types,
 * constants, pure guards, and one pure composition function only.
 *
 * IMPORT LAW: this module contains no import statements. It is
 * zero-dependency, exactly like build/flauz/lab/common/labContracts.ts, and
 * stands alone over the authorities. The registry types below are the
 * dispatch-side structural projections of the registration contracts; tests
 * pin the shared frozen vocabularies equal across modules.
 *
 * DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) inside this
 * module. Every timestamp is a plain ISO-8601 string supplied by the caller,
 * and every exported function is a pure function of its arguments.
 *
 * TOTAL ORDER LAW: composeDispatchPlan is deterministic and total. The same
 * registry and the same event always compose the same plan. Firing order is
 * priority ascending, then registration order; the comparator never returns
 * 0 for distinct hooks (hook ids are unique), so the order is a strict total
 * order and every engine's sort yields the same result.
 */

export const HOOK_BUS_CONTRACTS_VERSION = '1.0.0';

/** The scope stamped on every persisted hook-bus record. */
export interface HookBusScope {
    readonly workspaceId: string;
    readonly tenantId: string;
}

/** The six frozen hook kinds (identical to the registration contracts). */
export const HOOK_KINDS = [
    'session',
    'prompt',
    'tool',
    'approval',
    'post-tool',
    'finalization'
] as const;

export type HookKind = typeof HOOK_KINDS[number];

/** The frozen authority event vocabulary digest (identical to the registration contracts). */
export const AUTHORITY_EVENT_DIGEST = [
    'session.opened',
    'session.closed',
    'prompt.submitted',
    'tool.invoked',
    'post-tool.observed',
    'approval.requested',
    'approval.resolved',
    'task.awaiting-approval',
    'task.awaiting-signoff',
    'finalization.requested',
    'finalization.recorded'
] as const;

export type AuthorityEventDigest = typeof AUTHORITY_EVENT_DIGEST[number];

/** The authority event digests each hook kind can observe (identical to the registration contracts). */
export const KIND_EVENT_DIGESTS: Readonly<Record<HookKind, readonly AuthorityEventDigest[]>> = {
    session: ['session.opened', 'session.closed'],
    prompt: ['prompt.submitted'],
    tool: ['tool.invoked'],
    'post-tool': ['post-tool.observed'],
    approval: ['approval.requested', 'approval.resolved', 'task.awaiting-approval'],
    finalization: ['finalization.requested', 'finalization.recorded', 'task.awaiting-signoff']
};

/** The typed match shape as seen by dispatch composition. */
export interface HookMatchSpec {
    readonly kinds: readonly HookKind[];
    readonly events: readonly AuthorityEventDigest[];
}

/** A registered hook as seen by dispatch composition (structural projection of HookDescriptor). */
export interface DispatchableHook {
    readonly hookId: string;
    readonly kind: HookKind;
    readonly matchSpec: HookMatchSpec;
    readonly priority: number;
    readonly enabled: boolean;
}

/** The registered set as seen by dispatch composition (hooks order = registration order). */
export interface HookRegistry {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly hooks: readonly DispatchableHook[];
}

/** A typed reference to the firing authority event. */
export interface HookEventRef {
    readonly kind: HookKind;
    readonly eventDigest: AuthorityEventDigest;
    readonly occurredAtIso: string;
}

/** The dispatch plan: the deterministic firing order for one authority event. */
export interface HookDispatchPlan {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly eventRef: HookEventRef;
    readonly orderedHookIds: readonly string[];
    readonly composedAtIso: string;
}

const HOOK_KIND_LIST: readonly string[] = HOOK_KINDS;
const AUTHORITY_EVENT_DIGEST_LIST: readonly string[] = AUTHORITY_EVENT_DIGEST;

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

export function isHookBusScope(value: unknown): value is HookBusScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isNonEmptyString(candidate.workspaceId) && isNonEmptyString(candidate.tenantId);
}

export function isHookKind(value: unknown): value is HookKind {
    return typeof value === 'string' && HOOK_KIND_LIST.includes(value);
}

export function isAuthorityEventDigest(value: unknown): value is AuthorityEventDigest {
    return typeof value === 'string' && AUTHORITY_EVENT_DIGEST_LIST.includes(value);
}

export function kindCoversEventDigest(kind: HookKind, eventDigest: AuthorityEventDigest): boolean {
    return KIND_EVENT_DIGESTS[kind].includes(eventDigest);
}

/** A valid event reference: known kind, known digest, kind covers digest, plain ISO timestamp. */
export function isValidHookEventRef(value: unknown): value is HookEventRef {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isHookKind(candidate.kind)
        && isAuthorityEventDigest(candidate.eventDigest)
        && kindCoversEventDigest(candidate.kind, candidate.eventDigest)
        && isIsoTimestamp(candidate.occurredAtIso);
}

/** True iff the hook's match spec covers the event kind and digest. */
export function matchSpecCoversEvent(matchSpec: HookMatchSpec, eventRef: HookEventRef): boolean {
    return matchSpec.kinds.includes(eventRef.kind) && matchSpec.events.includes(eventRef.eventDigest);
}

interface FiringEntry {
    readonly hookId: string;
    readonly priority: number;
    readonly registrationIndex: number;
}

function byPriorityThenRegistration(a: FiringEntry, b: FiringEntry): number {
    if (a.priority !== b.priority) {
        return a.priority < b.priority ? -1 : 1;
    }
    if (a.registrationIndex !== b.registrationIndex) {
        return a.registrationIndex < b.registrationIndex ? -1 : 1;
    }
    return 0;
}

function orderedFiringHookIds(registry: HookRegistry, eventRef: HookEventRef): readonly string[] {
    const firing: FiringEntry[] = [];
    for (let registrationIndex = 0; registrationIndex < registry.hooks.length; registrationIndex += 1) {
        const hook = registry.hooks[registrationIndex];
        if (!hook.enabled) {
            continue;
        }
        if (!matchSpecCoversEvent(hook.matchSpec, eventRef)) {
            continue;
        }
        firing.push({ hookId: hook.hookId, priority: hook.priority, registrationIndex: registrationIndex });
    }
    // The comparator is a strict total order over the entries (unique hook
    // ids imply unique registration indexes), so the sorted result is the
    // same on every engine: deterministic.
    firing.sort(byPriorityThenRegistration);
    return firing.map((entry) => entry.hookId);
}

/**
 * Compose the dispatch plan for one authority event. PURE and deterministic:
 * the same registry and the same event always compose the same plan. The
 * firing order is priority ascending, then registration order.
 *
 * Fail-closed: an event reference that is not a valid authority event
 * composes an empty firing order (nothing fires on an event that cannot
 * exist), even when some hook's match spec would textually match it.
 * composedAtIso is derived from eventRef.occurredAtIso so the plan is a pure
 * function of the event.
 */
export function composeDispatchPlan(registry: HookRegistry, eventRef: unknown): HookDispatchPlan {
    const ref = eventRef as HookEventRef;
    const orderedHookIds = isValidHookEventRef(eventRef)
        ? orderedFiringHookIds(registry, ref)
        : [];
    const occurredAtIso = typeof ref.occurredAtIso === 'string' ? ref.occurredAtIso : '';
    return {
        scope: registry.scope,
        contractVersion: HOOK_BUS_CONTRACTS_VERSION,
        eventRef: ref,
        orderedHookIds: orderedHookIds,
        composedAtIso: occurredAtIso
    };
}

function hookIdsAreDistinct(hookIds: readonly string[]): boolean {
    const seen: string[] = [];
    for (const hookId of hookIds) {
        if (seen.includes(hookId)) {
            return false;
        }
        seen.push(hookId);
    }
    return true;
}

export function isHookDispatchPlan(value: unknown): value is HookDispatchPlan {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (!isHookBusScope(candidate.scope) || candidate.contractVersion !== HOOK_BUS_CONTRACTS_VERSION) {
        return false;
    }
    if (!isValidHookEventRef(candidate.eventRef)) {
        return false;
    }
    if (!Array.isArray(candidate.orderedHookIds)) {
        return false;
    }
    const orderedHookIds: readonly string[] = candidate.orderedHookIds;
    if (!orderedHookIds.every((hookId) => isNonEmptyString(hookId)) || !hookIdsAreDistinct(orderedHookIds)) {
        return false;
    }
    return isIsoTimestamp(candidate.composedAtIso);
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return false;
        }
    }
    return true;
}

export function hookScopesEqual(a: HookBusScope, b: HookBusScope): boolean {
    return a.workspaceId === b.workspaceId && a.tenantId === b.tenantId;
}

export function hookEventRefsEqual(a: HookEventRef, b: HookEventRef): boolean {
    return a.kind === b.kind && a.eventDigest === b.eventDigest && a.occurredAtIso === b.occurredAtIso;
}

/** Plan equality: same scope, version, event, firing order, composition timestamp. */
export function dispatchPlansEqual(a: HookDispatchPlan, b: HookDispatchPlan): boolean {
    if (a === b) {
        return true;
    }
    return hookScopesEqual(a.scope, b.scope)
        && a.contractVersion === b.contractVersion
        && hookEventRefsEqual(a.eventRef, b.eventRef)
        && stringArraysEqual(a.orderedHookIds, b.orderedHookIds)
        && a.composedAtIso === b.composedAtIso;
}
