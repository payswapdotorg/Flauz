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
 * ZC-003 Hook Bus - hook registration contracts (contract set version 1.0.0).
 *
 * PROJECTIONS, NOT AUTHORITIES: every type here is a read-model, request
 * shape, or pure transition law projected over the agent and execution
 * authorities (READ ONLY, never edited by this wave):
 *   - extensions/flauz-agent/src/types.ts: TaskStatus (including
 *     awaiting-approval and awaiting-signoff), Task, TaskEvent, TaskEnvelope,
 *     EvidenceKind, SeamEventEnvelope (session/task/event semantics)
 *   - extensions/flauz-agent/src/orchestrator.ts: the orchestration loop
 *     whose terminal-tool invocation runs through the HumanApproval
 *     confirmation gate (the existing approval behavior a hook may REQUEST)
 *   - extensions/flauz-agent/src/tools/terminalTool.ts: vscode.lm.registerTool
 *     plus HumanApproval (the approval authority surface)
 *   - extensions/flauz-execution/src/contracts.ts: the 26-state AgentTaskState
 *     machine and LIFECYCLE_STATES (execution-side session/task semantics)
 * There is no runtime bus, scheduler, executor, dispatcher, event emitter, or
 * persistence engine here: types, constants, pure guards, and pure
 * registry-to-registry transition functions only.
 *
 * IMPORT LAW: this module contains no import statements. It is
 * zero-dependency, exactly like build/flauz/lab/common/labContracts.ts, and
 * stands alone over the authorities.
 *
 * DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) inside this
 * module. Every timestamp is a plain ISO-8601 string supplied by the caller,
 * and every exported function is a pure function of its arguments.
 *
 * HOOK-EFFECT LAW: a hook may context-enrich or request-approval. It can
 * never grant permissions, bypass policy, bypass leases, or auto-approve;
 * those effects are unrepresentable in the declared effect vocabulary below
 * and are re-guarded by the policy module (policy.ts).
 */

export const HOOK_BUS_CONTRACTS_VERSION = '1.0.0';

/** The contract version of persisted hook registry records. */
export const HOOK_REGISTRY_VERSION = '1.0.0';

/** The scope stamped on every persisted hook-bus record. */
export interface HookBusScope {
    readonly workspaceId: string;
    readonly tenantId: string;
}

/** The six frozen hook kinds (as const list, derived union). */
export const HOOK_KINDS = [
    'session',
    'prompt',
    'tool',
    'approval',
    'post-tool',
    'finalization'
] as const;

export type HookKind = typeof HOOK_KINDS[number];

/**
 * The frozen digest of the authority event vocabulary this contract set
 * projects over (TaskEvent / AgentTaskState semantics reduced to the event
 * names the hook bus can observe). Task-state digests are pinned to the
 * authority TaskStatus vocabulary (awaiting-approval, awaiting-signoff).
 */
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

/** The authority event digests each hook kind can observe. */
export const KIND_EVENT_DIGESTS: Readonly<Record<HookKind, readonly AuthorityEventDigest[]>> = {
    session: ['session.opened', 'session.closed'],
    prompt: ['prompt.submitted'],
    tool: ['tool.invoked'],
    'post-tool': ['post-tool.observed'],
    approval: ['approval.requested', 'approval.resolved', 'task.awaiting-approval'],
    finalization: ['finalization.requested', 'finalization.recorded', 'task.awaiting-signoff']
};

/** The two legal hook effect kinds (the fail-closed HookEffect union digest). */
export const HOOK_EFFECT_KINDS = [
    'context-enrichment',
    'approval-request'
] as const;

export type HookEffectKind = typeof HOOK_EFFECT_KINDS[number];

/**
 * The effect lanes each hook kind may declare. Only hooks that observe the
 * approval routing surfaces (tool invocations that run through the
 * HumanApproval confirmation gate, and the approval-family events) may
 * declare approval-request; every kind may declare context-enrichment.
 */
export const KIND_EFFECT_LANES: Readonly<Record<HookKind, readonly HookEffectKind[]>> = {
    session: ['context-enrichment'],
    prompt: ['context-enrichment'],
    tool: ['context-enrichment', 'approval-request'],
    approval: ['context-enrichment', 'approval-request'],
    'post-tool': ['context-enrichment'],
    finalization: ['context-enrichment']
};

/** Which authority events a hook fires on (typed match shape). */
export interface HookMatchSpec {
    readonly kinds: readonly HookKind[];
    readonly events: readonly AuthorityEventDigest[];
}

/** A registered hook (persisted record: scope, contractVersion, ISO stamp). */
export interface HookDescriptor {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly hookId: string;
    readonly kind: HookKind;
    readonly effectKind: HookEffectKind;
    readonly matchSpec: HookMatchSpec;
    readonly priority: number;
    readonly enabled: boolean;
    readonly registeredAtIso: string;
}

/**
 * The persisted registered set. The order of `hooks` is the registration
 * order; it is part of the persisted record and drives deterministic
 * dispatch tie-breaking.
 */
export interface HookRegistry {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly hooks: readonly HookDescriptor[];
}

const HOOK_KIND_LIST: readonly string[] = HOOK_KINDS;
const AUTHORITY_EVENT_DIGEST_LIST: readonly string[] = AUTHORITY_EVENT_DIGEST;
const HOOK_EFFECT_KIND_LIST: readonly string[] = HOOK_EFFECT_KINDS;

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

export function isHookEffectKind(value: unknown): value is HookEffectKind {
    return typeof value === 'string' && HOOK_EFFECT_KIND_LIST.includes(value);
}

/** True iff the digest belongs to the kind's observable vocabulary. */
export function kindCoversEventDigest(kind: HookKind, eventDigest: AuthorityEventDigest): boolean {
    return KIND_EVENT_DIGESTS[kind].includes(eventDigest);
}

/**
 * Match-spec validity: a nonempty, duplicate-free list of known kinds and a
 * nonempty, duplicate-free list of known digests, mutually covering (every
 * claimed kind observes at least one claimed digest, and every claimed
 * digest belongs to at least one claimed kind).
 */
export function isHookMatchSpec(value: unknown): value is HookMatchSpec {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    const kinds = candidate.kinds;
    const events = candidate.events;
    if (!Array.isArray(kinds) || !Array.isArray(events)) {
        return false;
    }
    if (kinds.length === 0 || events.length === 0) {
        return false;
    }
    const seenKinds: string[] = [];
    for (const kind of kinds) {
        if (!isHookKind(kind) || seenKinds.includes(kind)) {
            return false;
        }
        seenKinds.push(kind);
    }
    const seenEvents: string[] = [];
    for (const eventDigest of events) {
        if (!isAuthorityEventDigest(eventDigest) || seenEvents.includes(eventDigest)) {
            return false;
        }
        seenEvents.push(eventDigest);
    }
    const narrowedKinds: readonly HookKind[] = kinds;
    const narrowedEvents: readonly AuthorityEventDigest[] = events;
    for (const kind of narrowedKinds) {
        if (!narrowedEvents.some((eventDigest) => kindCoversEventDigest(kind, eventDigest))) {
            return false;
        }
    }
    for (const eventDigest of narrowedEvents) {
        if (!narrowedKinds.some((kind) => kindCoversEventDigest(kind, eventDigest))) {
            return false;
        }
    }
    return true;
}

export function isHookDescriptor(value: unknown): value is HookDescriptor {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isHookBusScope(candidate.scope)
        && candidate.contractVersion === HOOK_BUS_CONTRACTS_VERSION
        && isNonEmptyString(candidate.hookId)
        && isHookKind(candidate.kind)
        && isHookEffectKind(candidate.effectKind)
        && isHookMatchSpec(candidate.matchSpec)
        && typeof candidate.priority === 'number'
        && Number.isInteger(candidate.priority)
        && typeof candidate.enabled === 'boolean'
        && isIsoTimestamp(candidate.registeredAtIso);
}

export function isHookRegistry(value: unknown): value is HookRegistry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (!isHookBusScope(candidate.scope) || candidate.contractVersion !== HOOK_REGISTRY_VERSION) {
        return false;
    }
    if (!Array.isArray(candidate.hooks)) {
        return false;
    }
    for (const hook of candidate.hooks) {
        if (!isHookDescriptor(hook)) {
            return false;
        }
    }
    return true;
}

/** The empty registry for a scope (pure constructor). */
export function emptyHookRegistry(scope: HookBusScope): HookRegistry {
    return {
        scope: scope,
        contractVersion: HOOK_REGISTRY_VERSION,
        hooks: []
    };
}

/** The frozen registration violation vocabulary. */
export const REGISTRATION_VIOLATIONS = [
    'invalid-descriptor',
    'invalid-hook-kind',
    'invalid-match-spec',
    'illegal-effect',
    'duplicate-hook-id'
] as const;

export type RegistrationViolation = typeof REGISTRATION_VIOLATIONS[number];

export interface RegistrationVerdict {
    readonly ok: boolean;
    readonly violations: readonly RegistrationViolation[];
}

function declaredEffectIsLegal(candidate: Record<string, unknown>): boolean {
    if (!isHookEffectKind(candidate.effectKind)) {
        return false;
    }
    if (!isHookKind(candidate.kind)) {
        // kind legality is reported separately as invalid-hook-kind; a legal
        // declared effect kind on an illegal kind is attributed to the kind.
        return true;
    }
    return KIND_EFFECT_LANES[candidate.kind].includes(candidate.effectKind);
}

/**
 * The registration law: id uniqueness, kind validity, match-spec validity
 * (including that the spec covers the hook's own kind), and effect legality.
 * Pure; returns every violated law by exact name.
 */
export function canRegister(descriptor: unknown, registry: HookRegistry): RegistrationVerdict {
    const violations: RegistrationViolation[] = [];
    if (typeof descriptor !== 'object' || descriptor === null) {
        return { ok: false, violations: ['invalid-descriptor'] };
    }
    const candidate = descriptor as Record<string, unknown>;
    const shellValid = isHookBusScope(candidate.scope)
        && candidate.contractVersion === HOOK_BUS_CONTRACTS_VERSION
        && isNonEmptyString(candidate.hookId)
        && typeof candidate.priority === 'number'
        && Number.isInteger(candidate.priority)
        && typeof candidate.enabled === 'boolean'
        && isIsoTimestamp(candidate.registeredAtIso);
    if (!shellValid) {
        violations.push('invalid-descriptor');
    }
    if (!isHookKind(candidate.kind)) {
        violations.push('invalid-hook-kind');
    }
    const matchSpec = candidate.matchSpec;
    if (!isHookMatchSpec(matchSpec) || !isHookKind(candidate.kind) || !matchSpec.kinds.includes(candidate.kind)) {
        violations.push('invalid-match-spec');
    }
    if (!declaredEffectIsLegal(candidate)) {
        violations.push('illegal-effect');
    }
    if (registry.hooks.some((registered) => registered.hookId === candidate.hookId)) {
        violations.push('duplicate-hook-id');
    }
    return { ok: violations.length === 0, violations: violations };
}

export type RegisterResult =
    | { readonly ok: true; readonly registry: HookRegistry }
    | { readonly ok: false; readonly registry: HookRegistry; readonly violations: readonly RegistrationViolation[] };

/**
 * Pure registry-to-registry transition: appends the descriptor in
 * registration order. Never mutates in place; on failure the input registry
 * is returned by reference (proof of no mutation).
 */
export function register(descriptor: HookDescriptor, registry: HookRegistry): RegisterResult {
    const verdict = canRegister(descriptor, registry);
    if (!verdict.ok) {
        return { ok: false, registry: registry, violations: verdict.violations };
    }
    return {
        ok: true,
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            hooks: [...registry.hooks, descriptor]
        }
    };
}

/** The frozen withdraw violation vocabulary. */
export const WITHDRAW_VIOLATIONS = ['unknown-hook-id'] as const;

export type WithdrawViolation = typeof WITHDRAW_VIOLATIONS[number];

export type WithdrawResult =
    | { readonly ok: true; readonly registry: HookRegistry }
    | { readonly ok: false; readonly registry: HookRegistry; readonly violations: readonly WithdrawViolation[] };

/**
 * Pure registry-to-registry transition: removes the hook by id and preserves
 * the registration order of the remaining hooks. Never mutates in place.
 */
export function withdraw(hookId: string, registry: HookRegistry): WithdrawResult {
    const remaining = registry.hooks.filter((hook) => hook.hookId !== hookId);
    if (remaining.length === registry.hooks.length) {
        return { ok: false, registry: registry, violations: ['unknown-hook-id'] };
    }
    return {
        ok: true,
        registry: {
            scope: registry.scope,
            contractVersion: registry.contractVersion,
            hooks: remaining
        }
    };
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

export function hookMatchSpecsEqual(a: HookMatchSpec, b: HookMatchSpec): boolean {
    return stringArraysEqual(a.kinds, b.kinds) && stringArraysEqual(a.events, b.events);
}

export function hookDescriptorsEqual(a: HookDescriptor, b: HookDescriptor): boolean {
    if (a === b) {
        return true;
    }
    return a.hookId === b.hookId
        && a.kind === b.kind
        && a.effectKind === b.effectKind
        && a.priority === b.priority
        && a.enabled === b.enabled
        && a.contractVersion === b.contractVersion
        && a.registeredAtIso === b.registeredAtIso
        && hookScopesEqual(a.scope, b.scope)
        && hookMatchSpecsEqual(a.matchSpec, b.matchSpec);
}

/**
 * Transition equality: two registries are the same transition state iff
 * scope, contractVersion, and the full ordered hook list match (registration
 * order included).
 */
export function registryTransitionsEqual(a: HookRegistry, b: HookRegistry): boolean {
    if (a === b) {
        return true;
    }
    if (!hookScopesEqual(a.scope, b.scope) || a.contractVersion !== b.contractVersion) {
        return false;
    }
    if (a.hooks.length !== b.hooks.length) {
        return false;
    }
    for (let index = 0; index < a.hooks.length; index += 1) {
        if (!hookDescriptorsEqual(a.hooks[index], b.hooks[index])) {
            return false;
        }
    }
    return true;
}
