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
 * ZC-003 Hook Bus - effect application law contracts (contract set version
 * 1.0.0).
 *
 * PROJECTIONS, NOT AUTHORITIES: the ApprovalRequest effect ROUTES TO THE
 * EXISTING APPROVAL AUTHORITY and never replaces it: the HumanApproval
 * tool-confirmation gate (extensions/flauz-agent/src/tools/terminalTool.ts,
 * reached through the orchestration loop in
 * extensions/flauz-agent/src/orchestrator.ts) and the awaiting-approval task
 * states of the agent/execution authorities
 * (extensions/flauz-agent/src/types.ts,
 * extensions/flauz-execution/src/contracts.ts). The resolution of a request
 * flows only through that existing behavior; this module never models a
 * decision, a permission, or any runtime execution of it.
 *
 * HOOK-EFFECT LAW (fail-closed typing): a hook may context-enrich or
 * request-approval. It can NEVER grant permissions, bypass policy, bypass
 * leases, or auto-approve: those effects are UNREPRESENTABLE in the
 * HookEffect union below, and isLegalHookEffect re-checks the law at
 * boundaries.
 *
 * IMPORT LAW: this module contains no import statements. It is
 * zero-dependency, exactly like build/flauz/lab/common/labContracts.ts, and
 * stands alone over the authorities.
 *
 * DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) inside this
 * module. Every timestamp is a plain ISO-8601 string supplied by the caller,
 * and every exported function is a pure function of its arguments.
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

/** The two legal hook effect kinds (the fail-closed union digest). */
export const HOOK_EFFECT_KINDS = [
    'context-enrichment',
    'approval-request'
] as const;

export type HookEffectKind = typeof HOOK_EFFECT_KINDS[number];

/** A typed context enrichment entry: key to digest, purely additive. */
export interface EnrichmentEntry {
    readonly key: string;
    readonly digest: string;
}

/**
 * The additive context enrichment effect: typed key-to-digest entries with
 * distinct keys. Merging rejects duplicate keys; there is never a
 * last-wins overwrite.
 */
export interface ContextEnrichment {
    readonly effectKind: 'context-enrichment';
    readonly entries: readonly EnrichmentEntry[];
}

/**
 * The approval request effect. ROUTES TO THE EXISTING APPROVAL AUTHORITY:
 * the HumanApproval tool-confirmation gate and the awaiting-approval task
 * states. It carries an approval target digest and a reason. It is NEVER an
 * approval decision and NEVER a permission.
 */
export interface ApprovalRequest {
    readonly effectKind: 'approval-request';
    readonly approvalTargetDigest: string;
    readonly reason: string;
}

/**
 * The fail-closed hook effect union with EXACTLY two shapes. Permission
 * grants, policy overrides, lease bypasses, and auto-approval are
 * unrepresentable here; isLegalHookEffect re-checks the law at boundaries.
 */
export type HookEffect = ContextEnrichment | ApprovalRequest;

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

export function isEnrichmentEntry(value: unknown): value is EnrichmentEntry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isNonEmptyString(candidate.key) && isNonEmptyString(candidate.digest);
}

export function isContextEnrichment(value: unknown): value is ContextEnrichment {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (candidate.effectKind !== 'context-enrichment') {
        return false;
    }
    if (!Array.isArray(candidate.entries) || candidate.entries.length === 0) {
        return false;
    }
    const seenKeys: string[] = [];
    for (const entry of candidate.entries) {
        if (!isEnrichmentEntry(entry)) {
            return false;
        }
        if (seenKeys.includes(entry.key)) {
            return false; // duplicate keys are invalid; never last-wins
        }
        seenKeys.push(entry.key);
    }
    return true;
}

export function isApprovalRequest(value: unknown): value is ApprovalRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return candidate.effectKind === 'approval-request'
        && isNonEmptyString(candidate.approvalTargetDigest)
        && isNonEmptyString(candidate.reason);
}

/**
 * The boundary re-check of the hook-effect law. Fail-closed: any shape that
 * is not exactly one of the two legal effect shapes is rejected, including
 * every bypass-granting shape (permission grant, policy override, lease
 * bypass, auto-approval), which are unrepresentable in the union.
 */
export function isLegalHookEffect(value: unknown): value is HookEffect {
    return isContextEnrichment(value) || isApprovalRequest(value);
}

/** The frozen enrichment merge failure vocabulary. */
export const ENRICHMENT_MERGE_FAILURES = [
    'invalid-enrichment-effect',
    'duplicate-enrichment-key'
] as const;

export type EnrichmentMergeFailure = typeof ENRICHMENT_MERGE_FAILURES[number];

export type EnrichmentMergeResult =
    | { readonly ok: true; readonly effect: ContextEnrichment }
    | { readonly ok: false; readonly failure: EnrichmentMergeFailure; readonly duplicateKeys: readonly string[] };

function byEnrichmentKey(a: EnrichmentEntry, b: EnrichmentEntry): number {
    if (a.key === b.key) {
        return 0;
    }
    return a.key < b.key ? -1 : 1;
}

/**
 * The enrichment merge law: pure and commutative. Disjoint entries merge
 * into one additive effect whose entries are normalized by key (so
 * merge(a, b) equals merge(b, a)). Duplicate keys REJECT with the typed
 * failure carrying the offending keys; there is no last-wins overwrite,
 * not even for identical digests.
 */
export function mergeEnrichments(a: unknown, b: unknown): EnrichmentMergeResult {
    if (!isContextEnrichment(a) || !isContextEnrichment(b)) {
        return { ok: false, failure: 'invalid-enrichment-effect', duplicateKeys: [] };
    }
    const keyCounts = new Map<string, number>();
    for (const entry of a.entries) {
        keyCounts.set(entry.key, (keyCounts.get(entry.key) ?? 0) + 1);
    }
    for (const entry of b.entries) {
        keyCounts.set(entry.key, (keyCounts.get(entry.key) ?? 0) + 1);
    }
    const duplicateKeys: string[] = [];
    for (const key of keyCounts.keys()) {
        if ((keyCounts.get(key) ?? 0) > 1) {
            duplicateKeys.push(key);
        }
    }
    if (duplicateKeys.length > 0) {
        duplicateKeys.sort();
        return { ok: false, failure: 'duplicate-enrichment-key', duplicateKeys: duplicateKeys };
    }
    const mergedEntries = [...a.entries, ...b.entries].sort(byEnrichmentKey);
    return {
        ok: true,
        effect: { effectKind: 'context-enrichment', entries: mergedEntries }
    };
}

export function contextEnrichmentsEqual(a: ContextEnrichment, b: ContextEnrichment): boolean {
    if (a === b) {
        return true;
    }
    if (a.entries.length !== b.entries.length) {
        return false;
    }
    for (let index = 0; index < a.entries.length; index += 1) {
        if (a.entries[index].key !== b.entries[index].key || a.entries[index].digest !== b.entries[index].digest) {
            return false;
        }
    }
    return true;
}

export function approvalRequestsEqual(a: ApprovalRequest, b: ApprovalRequest): boolean {
    return a.approvalTargetDigest === b.approvalTargetDigest && a.reason === b.reason;
}

export function hookEffectsEqual(a: HookEffect, b: HookEffect): boolean {
    if (a.effectKind !== b.effectKind) {
        return false;
    }
    if (a.effectKind === 'context-enrichment' && b.effectKind === 'context-enrichment') {
        return contextEnrichmentsEqual(a, b);
    }
    if (a.effectKind === 'approval-request' && b.effectKind === 'approval-request') {
        return approvalRequestsEqual(a, b);
    }
    return false;
}

/** A typed reference to the dispatch plan an effect was applied under. */
export interface HookPlanRef {
    readonly eventKind: HookKind;
    readonly eventDigest: AuthorityEventDigest;
    readonly occurredAtIso: string;
    readonly orderedHookIds: readonly string[];
}

/** The persisted application record: scope, contractVersion, plan reference, legal effect, ISO stamp. */
export interface EffectApplication {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly planRef: HookPlanRef;
    readonly effect: HookEffect;
    readonly appliedAtIso: string;
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

export function isHookPlanRef(value: unknown): value is HookPlanRef {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (!isHookKind(candidate.eventKind) || !isAuthorityEventDigest(candidate.eventDigest)) {
        return false;
    }
    if (!kindCoversEventDigest(candidate.eventKind, candidate.eventDigest)) {
        return false;
    }
    if (!isIsoTimestamp(candidate.occurredAtIso)) {
        return false;
    }
    if (!Array.isArray(candidate.orderedHookIds)) {
        return false;
    }
    const orderedHookIds: readonly string[] = candidate.orderedHookIds;
    return orderedHookIds.every((hookId) => isNonEmptyString(hookId)) && hookIdsAreDistinct(orderedHookIds);
}

export function isEffectApplication(value: unknown): value is EffectApplication {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return isHookBusScope(candidate.scope)
        && candidate.contractVersion === HOOK_BUS_CONTRACTS_VERSION
        && isHookPlanRef(candidate.planRef)
        && isLegalHookEffect(candidate.effect)
        && isIsoTimestamp(candidate.appliedAtIso);
}
