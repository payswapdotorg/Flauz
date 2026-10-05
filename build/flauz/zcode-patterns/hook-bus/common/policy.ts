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
 * ZC-003 Hook Bus - policy invariant contracts (contract set version 1.0.0).
 *
 * PROJECTIONS, NOT AUTHORITIES: this module is the policy re-check layer of
 * the hook-effect law over the agent and execution authorities (READ ONLY,
 * never edited by this wave): extensions/flauz-agent/src/types.ts,
 * extensions/flauz-agent/src/orchestrator.ts (the HumanApproval confirmation
 * gate the law protects), extensions/flauz-agent/src/tools/terminalTool.ts,
 * and extensions/flauz-execution/src/contracts.ts. The approval authority
 * itself is never modeled here; the bus only fail-closes against attempts to
 * route around it.
 *
 * HOOK-EFFECT LAW: a hook may context-enrich or request-approval. It can
 * never grant permissions, bypass policy, bypass leases, or auto-approve.
 * Those effects are unrepresentable in the HookEffect union (effects.ts);
 * this module re-checks the law at boundaries over the declared effect
 * vocabulary of descriptors and of firing plans, and returns typed verdicts
 * that carry the exact violated invariant name. The bus contract fail-closes
 * on ANY violation; nothing passes silently.
 *
 * IMPORT LAW: this module contains no import statements. It is
 * zero-dependency, exactly like build/flauz/lab/common/labContracts.ts, and
 * stands alone over the authorities.
 *
 * DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) inside this
 * module. Every exported function is a pure function of its arguments.
 */

export const HOOK_BUS_CONTRACTS_VERSION = '1.0.0';

/** The scope stamped on every persisted hook-bus record. */
export interface HookBusScope {
    readonly workspaceId: string;
    readonly tenantId: string;
}

/** The frozen policy invariant vocabulary (the hook bus law). */
export const HOOK_POLICY_INVARIANTS = [
    'no-permission-grant',
    'no-policy-override',
    'no-lease-bypass',
    'no-auto-approval',
    'enrichment-additive-only',
    'approval-request-only'
] as const;

export type HookPolicyInvariant = typeof HOOK_POLICY_INVARIANTS[number];

/** The frozen statements of the invariants. */
export const HOOK_POLICY: Readonly<Record<HookPolicyInvariant, string>> = {
    'no-permission-grant': 'A hook may never grant permissions; permission grants are unrepresentable in the HookEffect union.',
    'no-policy-override': 'A hook may never override policy; policy overrides are unrepresentable in the HookEffect union.',
    'no-lease-bypass': 'A hook may never bypass leases; lease bypasses are unrepresentable in the HookEffect union.',
    'no-auto-approval': 'A hook may never auto-approve; approval decisions belong to the existing approval authority alone.',
    'enrichment-additive-only': 'A hook effect that enriches context must be purely additive; duplicate keys reject, never last-wins.',
    'approval-request-only': 'A hook effect that touches approval must be a request routed to the existing approval authority; never a decision, never a permission.'
};

/** The two legal hook effect kinds (identical to the registration and effects contracts). */
export const HOOK_EFFECT_KINDS = [
    'context-enrichment',
    'approval-request'
] as const;

export type HookEffectKind = typeof HOOK_EFFECT_KINDS[number];

/**
 * Recognizable bypass-granting effect kinds. They are unrepresentable in
 * the HookEffect union; these frozen lists exist so the policy re-check can
 * attribute a violation to the exact broken invariant when such a shape
 * arrives at a boundary anyway.
 */
export const PERMISSION_GRANT_EFFECT_KINDS = ['permission-grant', 'grant-permission', 'permission-elevation'] as const;
export const POLICY_OVERRIDE_EFFECT_KINDS = ['policy-override', 'override-policy', 'policy-exemption'] as const;
export const LEASE_BYPASS_EFFECT_KINDS = ['lease-bypass', 'bypass-lease', 'lease-exemption'] as const;
export const AUTO_APPROVAL_EFFECT_KINDS = ['auto-approve', 'auto-approval', 'approval-decision', 'approve-on-behalf'] as const;

const LEGAL_EFFECT_KIND_LIST: readonly string[] = HOOK_EFFECT_KINDS;
const PERMISSION_GRANT_LIST: readonly string[] = PERMISSION_GRANT_EFFECT_KINDS;
const POLICY_OVERRIDE_LIST: readonly string[] = POLICY_OVERRIDE_EFFECT_KINDS;
const LEASE_BYPASS_LIST: readonly string[] = LEASE_BYPASS_EFFECT_KINDS;
const AUTO_APPROVAL_LIST: readonly string[] = AUTO_APPROVAL_EFFECT_KINDS;

export interface HookPolicyCheck {
    readonly invariant: HookPolicyInvariant;
    readonly passed: boolean;
    readonly detail: string;
}

export interface HookPolicyVerdict {
    readonly ok: boolean;
    readonly violations: readonly HookPolicyInvariant[];
    readonly checks: readonly HookPolicyCheck[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) {
        return null;
    }
    return value as Record<string, unknown>;
}

function quotedList(values: readonly string[]): string {
    if (values.length === 0) {
        return 'none';
    }
    return values.map((value) => `'${value}'`).join(', ');
}

function readScopeFields(value: unknown): HookBusScope | null {
    const record = asRecord(value);
    if (record === null) {
        return null;
    }
    if (typeof record.workspaceId !== 'string' || record.workspaceId.length === 0) {
        return null;
    }
    if (typeof record.tenantId !== 'string' || record.tenantId.length === 0) {
        return null;
    }
    return { workspaceId: record.workspaceId, tenantId: record.tenantId };
}

/**
 * Fail-closed verdict used when the evidence itself is unreadable: no
 * invariant can be certified, so every invariant fails with the reason.
 */
function unverifiableVerdict(reason: string): HookPolicyVerdict {
    const checks: HookPolicyCheck[] = [];
    for (const invariant of HOOK_POLICY_INVARIANTS) {
        checks.push({ invariant: invariant, passed: false, detail: `fail-closed: ${reason}` });
    }
    return { ok: false, violations: [...HOOK_POLICY_INVARIANTS], checks: checks };
}

function recordCheck(checks: HookPolicyCheck[], violations: HookPolicyInvariant[], invariant: HookPolicyInvariant, passed: boolean, passDetail: string, failDetail: string): void {
    if (!passed) {
        violations.push(invariant);
    }
    checks.push({ invariant: invariant, passed: passed, detail: passed ? passDetail : failDetail });
}

function offenders(effectKinds: readonly string[], poisonList: readonly string[]): string[] {
    return effectKinds.filter((effectKind) => poisonList.includes(effectKind));
}

/**
 * Evaluate the six invariants over a set of declared effect kinds (the
 * effect vocabulary a descriptor or a firing plan exposes). Every invariant
 * is reported pass or fail with its exact name; nothing passes silently.
 * The last two invariants jointly re-state the exhaustive effect law: the
 * only legal effects are additive context enrichment and approval requests.
 */
function verdictOverEffectKinds(effectKinds: readonly string[]): HookPolicyVerdict {
    const checks: HookPolicyCheck[] = [];
    const violations: HookPolicyInvariant[] = [];

    const grants = offenders(effectKinds, PERMISSION_GRANT_LIST);
    recordCheck(checks, violations, 'no-permission-grant', grants.length === 0,
        'no permission-granting effect kind is declared',
        `permission-granting effect kind declared: ${quotedList(grants)}`);

    const overrides = offenders(effectKinds, POLICY_OVERRIDE_LIST);
    recordCheck(checks, violations, 'no-policy-override', overrides.length === 0,
        'no policy-override effect kind is declared',
        `policy-override effect kind declared: ${quotedList(overrides)}`);

    const bypasses = offenders(effectKinds, LEASE_BYPASS_LIST);
    recordCheck(checks, violations, 'no-lease-bypass', bypasses.length === 0,
        'no lease-bypass effect kind is declared',
        `lease-bypass effect kind declared: ${quotedList(bypasses)}`);

    const autoApprovals = offenders(effectKinds, AUTO_APPROVAL_LIST);
    recordCheck(checks, violations, 'no-auto-approval', autoApprovals.length === 0,
        'no auto-approval effect kind is declared',
        `auto-approval effect kind declared: ${quotedList(autoApprovals)}`);

    const additive = effectKinds.filter((effectKind) => !LEGAL_EFFECT_KIND_LIST.includes(effectKind));
    recordCheck(checks, violations, 'enrichment-additive-only', additive.length === 0,
        'declared effects are additive context enrichment or declare no enrichment',
        `effect kind outside the additive-enrichment vocabulary declared: ${quotedList(additive)}`);

    const requestOnly = effectKinds.filter((effectKind) => !LEGAL_EFFECT_KIND_LIST.includes(effectKind));
    recordCheck(checks, violations, 'approval-request-only', requestOnly.length === 0,
        'declared effects are approval requests or declare no approval behavior',
        `effect kind outside the approval-request vocabulary declared: ${quotedList(requestOnly)}`);

    return { ok: violations.length === 0, violations: violations, checks: checks };
}

/**
 * The descriptor policy law: evaluate the six invariants over the
 * descriptor's declared effect. Fail-closed: a descriptor whose declared
 * effect is absent or unreadable fails every invariant.
 */
export function checkPolicyInvariants(descriptor: unknown): HookPolicyVerdict {
    const record = asRecord(descriptor);
    if (record === null || typeof record.effectKind !== 'string') {
        return unverifiableVerdict('declared hook effect is absent or unreadable');
    }
    return verdictOverEffectKinds([record.effectKind]);
}

function readRegisteredEffectKind(hooks: readonly unknown[], hookId: string): string | null {
    for (const hook of hooks) {
        const record = asRecord(hook);
        if (record === null) {
            continue;
        }
        if (record.hookId === hookId) {
            return typeof record.effectKind === 'string' ? record.effectKind : null;
        }
    }
    return null;
}

/**
 * The plan policy law: evaluate the six invariants over every hook the plan
 * fires, resolved against the registry. Fail-closed: a plan or registry that
 * is structurally unreadable, a scope mismatch, or a plan referencing a hook
 * that is not registered (or declares no effect) fails every invariant.
 */
export function checkPlanPolicy(plan: unknown, registry: unknown): HookPolicyVerdict {
    const planRecord = asRecord(plan);
    const registryRecord = asRecord(registry);
    if (planRecord === null || registryRecord === null) {
        return unverifiableVerdict('plan or registry is not an object');
    }
    const orderedHookIds = planRecord.orderedHookIds;
    if (!Array.isArray(orderedHookIds)) {
        return unverifiableVerdict('plan orderedHookIds is not a list');
    }
    const hookIds: readonly string[] = orderedHookIds;
    if (!hookIds.every((hookId) => typeof hookId === 'string' && hookId.length > 0)) {
        return unverifiableVerdict('plan orderedHookIds contains a non-hook-id entry');
    }
    const planScope = readScopeFields(planRecord.scope);
    const registryScope = readScopeFields(registryRecord.scope);
    if (planScope === null || registryScope === null) {
        return unverifiableVerdict('plan or registry scope is unreadable');
    }
    if (planScope.workspaceId !== registryScope.workspaceId || planScope.tenantId !== registryScope.tenantId) {
        return unverifiableVerdict('plan scope does not match registry scope');
    }
    const hooks = registryRecord.hooks;
    if (!Array.isArray(hooks)) {
        return unverifiableVerdict('registry hooks is not a list');
    }
    const effectKinds: string[] = [];
    for (const hookId of hookIds) {
        const effectKind = readRegisteredEffectKind(hooks, hookId);
        if (effectKind === null) {
            return unverifiableVerdict(`plan references hook '${hookId}' that is not registered or declares no effect`);
        }
        effectKinds.push(effectKind);
    }
    return verdictOverEffectKinds(effectKinds);
}
