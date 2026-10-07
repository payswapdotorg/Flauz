/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-003 -- THE LIVE HOOK-BUS RUNTIME (Phase C-R, B1, wave 3).
 *
 * LAWS:
 * - OVER THE REAL SEAMS, ONLY: every observation goes through a REAL
 *   OrchestrationStore and a REAL A2ABus constructed over a workspace root
 *   (non-literal dynamic seam imports, structural validation at bind, the
 *   cli/runtime/context.ts discipline). The runtime is READ-ONLY over both
 *   seams: it never appends to the orchestration journal and never posts to
 *   the a2a bus. The store's journal is the ONLY event authority; this
 *   runtime's receipts journal is delivery evidence, never a second event
 *   store. A torn journal tail is dropped by the store's own strict load
 *   (the transition never completed) and never dispatches.
 * - THE CONTRACT IS THE COMPOSITION AUTHORITY: dispatch composes every plan
 *   by CALLING common/dispatch.ts composeDispatchPlan. This module never
 *   sorts, filters, or orders hooks itself and never re-implements a frozen
 *   table: registration laws come from common/registration.ts
 *   (canRegister/register/isHookDescriptor), policy laws from
 *   common/policy.ts (checkPolicyInvariants/checkPlanPolicy + HOOK_POLICY).
 * - THE HONEST DIGEST MAPPING: exactly five journal row types translate
 *   (approval-requested -> approval.requested AND task.awaiting-approval;
 *   approval-granted/denied/expired -> approval.resolved;
 *   graph-completed -> finalization.recorded). Every other row type and
 *   every a2a message kind is UNMAPPED: counted in the disclosed census,
 *   never invented into a digest. The mapping is validated at bind against
 *   the loaded seam vocabulary and the contract guards.
 * - THE HOOK-EFFECT LAW: a hook effect carrying a dangerous effect kind
 *   (the four policy poison vocabularies) is recorded
 *   flagged-for-approval and NEVER executed. This runtime executes no
 *   effects at all -- delivery IS the durable receipt.
 * - REGISTRATION IS DURABLE: hooks persist at
 *   <root>/.flauz/hooks/registry.json (registration order = file order);
 *   loadHookBus serves the same root after a restart.
 * - CURSORS ARE DURABLE, DELIVERY IS AT-LEAST-ONCE: the journal + a2a
 *   cursors persist at <root>/.flauz/hooks/cursors.json; receipts append
 *   BEFORE the cursor advance, so a crash between them re-delivers on the
 *   next run and never silently drops.
 * - FAIL TYPED, NEVER SILENTLY: operations throw typed HookBusError codes
 *   and name violated laws verbatim from the frozen registration-violation
 *   and policy tables; the bind is a typed { bound: false, detail }
 *   verdict -- never a throw, never a fake.
 * - DETERMINISM BY INJECTION: an injected clock (epoch-ms numbers) drives
 *   every runtime timestamp; epoch-ms -> ISO conversion is pure arithmetic.
 *   No wall-clock reads and no randomness primitives appear anywhere in
 *   this module.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as DispatchContract from '../common/dispatch.ts';
import * as PolicyContract from '../common/policy.ts';
import * as RegistrationContract from '../common/registration.ts';

// ---------------------------------------------------------------------------
// Seam specifiers (non-literal dynamic imports; resolved at runtime only)
// ---------------------------------------------------------------------------

const ORCH_STORE_SEAM = '../../../../../extensions/flauz-agent/core/orchStore.mjs';
const A2A_BUS_SEAM = '../../../../../extensions/flauz-agent/core/a2a.mjs';
const ORCH_PROTOCOL_SEAM = '../../../../../extensions/flauz-agent/core/orchestration.mjs';

// ---------------------------------------------------------------------------
// Own persistence (the .flauz house style; runtime-assembled constants only)
// ---------------------------------------------------------------------------

const HOOKS_DIR = '.flauz/hooks';
const REGISTRY_SCHEMA = 'flauz.hook-bus.registry/v1';
const CURSORS_SCHEMA = 'flauz.hook-bus.cursors/v1';
const RECEIPT_SCHEMA = 'flauz.hook-bus.receipt/v1';

function registryPath(root: string): string {
    return join(root, HOOKS_DIR, 'registry.json');
}
function receiptsPath(root: string): string {
    return join(root, HOOKS_DIR, 'journal.jsonl');
}
function cursorsPath(root: string): string {
    return join(root, HOOKS_DIR, 'cursors.json');
}

// ---------------------------------------------------------------------------
// The honest digest mapping (CR-003 law; validated at bind, never invented)
// ---------------------------------------------------------------------------

export interface MappedEventRefSpec {
    readonly kind: DispatchContract.HookKind;
    readonly eventDigest: DispatchContract.AuthorityEventDigest;
}

/**
 * The ONLY journal-row-type -> eventRef translation table. Exactly five row
 * types translate; approval-requested carries the order's dual ref (the
 * approval kind covers both digests). Every other row type is censused.
 */
export const JOURNAL_ROW_EVENT_REF_MAPPING: Readonly<Record<string, readonly MappedEventRefSpec[]>> = {
    'approval-requested': [
        { kind: 'approval', eventDigest: 'approval.requested' },
        { kind: 'approval', eventDigest: 'task.awaiting-approval' },
    ],
    'approval-granted': [{ kind: 'approval', eventDigest: 'approval.resolved' }],
    'approval-denied': [{ kind: 'approval', eventDigest: 'approval.resolved' }],
    'approval-expired': [{ kind: 'approval', eventDigest: 'approval.resolved' }],
    'graph-completed': [{ kind: 'finalization', eventDigest: 'finalization.recorded' }],
};

// ---------------------------------------------------------------------------
// Clock + pure ISO conversion
// ---------------------------------------------------------------------------

/** The injected clock: returns epoch-ms numbers (the store's own convention). */
export type HookBusClock = () => number;

function pad2(value: number): string {
    return value < 10 ? `0${String(value)}` : String(value);
}

function pad4(value: number): string {
    const text = String(value);
    return text.length >= 4 ? text : `${'0'.repeat(4 - text.length)}${text}`;
}

/**
 * Pure epoch-ms -> ISO-8601 UTC conversion (civil-from-days arithmetic; no
 * runtime calendar object is constructed anywhere in this module). Emits
 * exactly YYYY-MM-DDTHH:MM:SSZ -- the contract's ISO_TIMESTAMP_PATTERN
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
// Typed errors (the BgAgentError discipline, in TypeScript)
// ---------------------------------------------------------------------------

export type HookBusErrorCode =
    | 'invalid-params'
    | 'registration-refused'
    | 'registry-corrupt'
    | 'registry-scope-mismatch'
    | 'cursor-corrupt'
    | 'registry-write-failed'
    | 'receipt-journal-write-failed'
    | 'cursor-write-failed'
    | 'seam-error';

export class HookBusError extends Error {
    readonly code: HookBusErrorCode;
    readonly violations: readonly string[] | undefined;
    readonly policyStatements: readonly string[] | undefined;

    constructor(
        code: HookBusErrorCode,
        message: string,
        details?: { violations?: readonly string[]; policyStatements?: readonly string[] },
    ) {
        super(message);
        this.name = 'HookBusError';
        this.code = code;
        this.violations = details?.violations;
        this.policyStatements = details?.policyStatements;
    }
}

function need(condition: unknown, code: HookBusErrorCode, message: string, details?: { violations?: readonly string[]; policyStatements?: readonly string[] }): void {
    if (!condition) {
        throw new HookBusError(code, message, details);
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

/** Canonical JSON: recursively key-sorted, compact, deterministic (the context.ts serializer pattern). */
function stableStringify(value: unknown): string {
    if (value === undefined) {
        return 'null';
    }
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value) ?? 'null';
    }
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(record[key])).join(',') + '}';
}

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export type HookBusScope = RegistrationContract.HookBusScope;

export interface HookRegistrationInput {
    readonly hookId: string;
    readonly kind: RegistrationContract.HookKind;
    readonly effectKind: string;
    readonly matchSpec: RegistrationContract.HookMatchSpec;
    readonly priority: number;
    readonly enabled: boolean;
}

export interface LoadedHook {
    readonly hookId: string;
    readonly kind: RegistrationContract.HookKind;
    readonly effectKind: string;
    readonly matchSpec: RegistrationContract.HookMatchSpec;
    readonly priority: number;
    readonly enabled: boolean;
    readonly registeredAtIso: string;
    readonly flagged: boolean;
    readonly raw: Record<string, unknown>;
}

export interface LoadedHookRegistry {
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly hooks: readonly LoadedHook[];
    readonly flaggedHookIds: readonly string[];
}

export interface DeliveryReceipt {
    readonly $schema: string;
    readonly scope: HookBusScope;
    readonly contractVersion: string;
    readonly hookId: string;
    readonly eventKind: DispatchContract.HookKind;
    readonly eventDigest: DispatchContract.AuthorityEventDigest;
    readonly occurredAtIso: string;
    readonly sourceRowSeq: number;
    readonly status: 'delivered' | 'flagged-for-approval';
    readonly effectKind: string;
    readonly deliveredAtIso: string;
    readonly violatedInvariants?: readonly string[];
    readonly policyStatements?: readonly string[];
}

export interface DispatchReport {
    readonly eventRefs: readonly DispatchContract.HookEventRef[];
    readonly plans: readonly DispatchContract.HookDispatchPlan[];
    readonly planPolicyVerdicts: readonly PolicyContract.HookPolicyVerdict[];
    readonly receipts: readonly DeliveryReceipt[];
    readonly unmappedRowTypes: Readonly<Record<string, number>>;
    readonly unmappedMessageKinds: Readonly<Record<string, number>>;
    readonly journalSeqObserved: number;
    readonly a2aSeqObserved: number;
}

export interface HookBusVocabulary {
    readonly journalEventTypes: readonly string[];
    readonly journalEventTypesResolved: boolean;
    readonly messageKinds: readonly string[];
    readonly messageKindsResolved: boolean;
}

/** The structurally validated read surface of the bound OrchestrationStore. */
export interface HookBusStoreBinding {
    load(): unknown;
    listGraphs(): unknown;
    rowsFor(graphId: string): unknown;
}

/** The structurally validated read surface of the bound A2ABus. */
export interface HookBusBusBinding {
    load(): unknown;
    readonly messages: readonly unknown[];
}

export interface HookBusRuntime {
    readonly root: string;
    readonly scope: HookBusScope;
    readonly vocabulary: HookBusVocabulary;
    registerHook(input: HookRegistrationInput): RegistrationContract.HookDescriptor;
    dispatch(): DispatchReport;
    registry(): LoadedHookRegistry;
}

export type HookBusBindVerdict =
    | { bound: true; runtime: HookBusRuntime; store: HookBusStoreBinding; bus: HookBusBusBinding; vocabulary: HookBusVocabulary }
    | { bound: false; detail: string };

export interface HookBusBindOptions {
    readonly clock: HookBusClock;
    readonly scope?: HookBusScope;
}

// ---------------------------------------------------------------------------
// The dangerous effect vocabulary (assembled from the policy contract only)
// ---------------------------------------------------------------------------

const DANGEROUS_EFFECT_KINDS: readonly string[] = [
    ...PolicyContract.PERMISSION_GRANT_EFFECT_KINDS,
    ...PolicyContract.POLICY_OVERRIDE_EFFECT_KINDS,
    ...PolicyContract.LEASE_BYPASS_EFFECT_KINDS,
    ...PolicyContract.AUTO_APPROVAL_EFFECT_KINDS,
];

// ---------------------------------------------------------------------------
// Registry persistence + the load classification law
// ---------------------------------------------------------------------------

function toLoadedHook(raw: Record<string, unknown>, flagged: boolean): LoadedHook {
    return {
        hookId: raw.hookId as string,
        kind: raw.kind as RegistrationContract.HookKind,
        effectKind: raw.effectKind as string,
        matchSpec: raw.matchSpec as RegistrationContract.HookMatchSpec,
        priority: raw.priority as number,
        enabled: raw.enabled as boolean,
        registeredAtIso: raw.registeredAtIso as string,
        flagged,
        raw,
    };
}

/**
 * The flagged-hook classification: a record whose declared effect kind is a
 * poison kind (the policy contract's own lists -- the shapes policy.ts says
 * "arrive at a boundary anyway"), otherwise well-formed under the
 * registration laws. Such a hook COMPOSES (composition reads matchSpec
 * only) but every receipt is flagged-for-approval and nothing ever executes.
 */
function classifyFlaggedHookRecord(raw: Record<string, unknown>, scope: HookBusScope, seenHookIds: ReadonlySet<string>): boolean {
    const hookId = raw.hookId;
    if (!isNonEmptyString(hookId) || seenHookIds.has(hookId)) {
        return false;
    }
    if (typeof raw.effectKind !== 'string' || !DANGEROUS_EFFECT_KINDS.includes(raw.effectKind)) {
        return false;
    }
    const kind = raw.kind;
    if (!RegistrationContract.isHookKind(kind)) {
        return false;
    }
    const matchSpec = raw.matchSpec;
    if (!RegistrationContract.isHookMatchSpec(matchSpec) || !matchSpec.kinds.includes(kind)) {
        return false;
    }
    if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority)) {
        return false;
    }
    if (typeof raw.enabled !== 'boolean') {
        return false;
    }
    if (!RegistrationContract.isIsoTimestamp(raw.registeredAtIso)) {
        return false;
    }
    if (!RegistrationContract.isHookBusScope(raw.scope) || !RegistrationContract.hookScopesEqual(raw.scope, scope)) {
        return false;
    }
    if (raw.contractVersion !== RegistrationContract.HOOK_BUS_CONTRACTS_VERSION) {
        return false;
    }
    return true;
}

/**
 * Read + classify the persisted registry. The disk is the truth: every hook
 * in file order is either a registrable descriptor (the contract's own
 * isHookDescriptor + a canRegister replay against the hooks before it --
 * duplicate ids and hand-edited lane violations fail closed), a flaggable
 * dangerous-effect record, or the registry is corrupt. The raw JSON record
 * view (`raw`) is the canonical carrier: the contract's interfaces carry no
 * implicit index signature, so the guard-confirmed descriptor view travels
 * in the parallel `cleanDescriptors` array while `raw` persists verbatim.
 */
function readRegistryFile(root: string, expectedScope: HookBusScope | undefined): LoadedHookRegistry {
    const path = registryPath(root);
    if (!existsSync(path)) {
        if (expectedScope === undefined) {
            throw new HookBusError('invalid-params', 'a scope is required on a root with no persisted hook registry');
        }
        return { scope: expectedScope, contractVersion: RegistrationContract.HOOK_REGISTRY_VERSION, hooks: [], flaggedHookIds: [] };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
        throw new HookBusError('registry-corrupt', `the hook registry is not valid JSON: ${describeError(error)}`);
    }
    if (!isRecord(parsed) || parsed.$schema !== REGISTRY_SCHEMA || !isRecord(parsed.registry)) {
        throw new HookBusError('registry-corrupt', `the hook registry must be the envelope {'$schema': '${REGISTRY_SCHEMA}', registry: {scope, contractVersion, hooks}}`);
    }
    const registryRecord = parsed.registry;
    if (!RegistrationContract.isHookBusScope(registryRecord.scope)) {
        throw new HookBusError('registry-corrupt', 'the hook registry scope is unreadable');
    }
    const scope = registryRecord.scope;
    if (registryRecord.contractVersion !== RegistrationContract.HOOK_REGISTRY_VERSION) {
        throw new HookBusError('registry-corrupt', `the hook registry contractVersion must be '${RegistrationContract.HOOK_REGISTRY_VERSION}'`);
    }
    if (!Array.isArray(registryRecord.hooks)) {
        throw new HookBusError('registry-corrupt', 'the hook registry hooks must be a list');
    }
    if (expectedScope !== undefined && !RegistrationContract.hookScopesEqual(scope, expectedScope)) {
        throw new HookBusError(
            'registry-scope-mismatch',
            `registry-scope-mismatch: the persisted registry scope {workspaceId: '${scope.workspaceId}', tenantId: '${scope.tenantId}'} does not match the requested scope {workspaceId: '${expectedScope.workspaceId}', tenantId: '${expectedScope.tenantId}'} (hookScopesEqual is the contract's scope law)`,
        );
    }
    const hooks: LoadedHook[] = [];
    const cleanDescriptors: RegistrationContract.HookDescriptor[] = [];
    const flaggedHookIds: string[] = [];
    const seenHookIds = new Set<string>();
    for (const entry of registryRecord.hooks) {
        if (!isRecord(entry)) {
            throw new HookBusError('registry-corrupt', 'a hook registry entry is not a JSON object');
        }
        const raw = entry;
        if (
            RegistrationContract.isHookDescriptor(entry)
            && !seenHookIds.has(entry.hookId)
            && RegistrationContract.canRegister(entry, { scope, contractVersion: RegistrationContract.HOOK_REGISTRY_VERSION, hooks: cleanDescriptors }).ok
        ) {
            seenHookIds.add(entry.hookId);
            cleanDescriptors.push(entry);
            hooks.push(toLoadedHook(raw, false));
            continue;
        }
        if (classifyFlaggedHookRecord(raw, scope, seenHookIds)) {
            seenHookIds.add(String(raw.hookId));
            flaggedHookIds.push(String(raw.hookId));
            hooks.push(toLoadedHook(raw, true));
            continue;
        }
        throw new HookBusError('registry-corrupt', `the hook registry entry '${String(raw.hookId)}' is neither a registrable descriptor (the registration laws) nor a flaggable dangerous-effect record (the policy poison vocabularies)`);
    }
    return { scope, contractVersion: RegistrationContract.HOOK_REGISTRY_VERSION, hooks, flaggedHookIds };
}

function writeRegistryFile(root: string, registry: LoadedHookRegistry): void {
    try {
        mkdirSync(join(root, HOOKS_DIR), { recursive: true });
        const envelope = {
            $schema: REGISTRY_SCHEMA,
            registry: {
                scope: registry.scope,
                contractVersion: registry.contractVersion,
                hooks: registry.hooks.map((hook) => hook.raw),
            },
        };
        writeFileSync(registryPath(root), JSON.stringify(envelope, null, 2) + '\n');
    } catch (error) {
        throw new HookBusError('registry-write-failed', `the hook registry could not be persisted: ${describeError(error)}`);
    }
}

/** The clean (non-flagged) descriptors of a loaded registry, re-confirmed through the contract's own guard. */
function cleanDescriptorsOf(loaded: LoadedHookRegistry): RegistrationContract.HookDescriptor[] {
    const cleanHooks: RegistrationContract.HookDescriptor[] = [];
    for (const hook of loaded.hooks) {
        if (!hook.flagged && RegistrationContract.isHookDescriptor(hook.raw)) {
            cleanHooks.push(hook.raw);
        }
    }
    return cleanHooks;
}

// ---------------------------------------------------------------------------
// Cursors persistence
// ---------------------------------------------------------------------------

interface HookBusCursors {
    readonly journalSeq: number;
    readonly a2aSeq: number;
}

function readCursorsFile(root: string): HookBusCursors {
    const path = cursorsPath(root);
    if (!existsSync(path)) {
        return { journalSeq: 0, a2aSeq: 0 };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (error) {
        throw new HookBusError('cursor-corrupt', `the hook-bus cursors file is not valid JSON: ${describeError(error)}`);
    }
    if (!isRecord(parsed) || parsed.$schema !== CURSORS_SCHEMA) {
        throw new HookBusError('cursor-corrupt', `the hook-bus cursors file must be {'$schema': '${CURSORS_SCHEMA}', journalSeq, a2aSeq}`);
    }
    const journalSeq = parsed.journalSeq;
    const a2aSeq = parsed.a2aSeq;
    if (typeof journalSeq !== 'number' || !Number.isSafeInteger(journalSeq) || journalSeq < 0
        || typeof a2aSeq !== 'number' || !Number.isSafeInteger(a2aSeq) || a2aSeq < 0) {
        throw new HookBusError('cursor-corrupt', 'the hook-bus cursors must be non-negative integers');
    }
    return { journalSeq, a2aSeq };
}

function writeCursorsFile(root: string, cursors: HookBusCursors): void {
    try {
        mkdirSync(join(root, HOOKS_DIR), { recursive: true });
        writeFileSync(cursorsPath(root), JSON.stringify({ $schema: CURSORS_SCHEMA, journalSeq: cursors.journalSeq, a2aSeq: cursors.a2aSeq }, null, 2) + '\n');
    } catch (error) {
        throw new HookBusError('cursor-write-failed', `the hook-bus cursors could not be persisted: ${describeError(error)}`);
    }
}

function appendReceipts(root: string, receipts: readonly DeliveryReceipt[]): void {
    if (receipts.length === 0) {
        return;
    }
    try {
        mkdirSync(join(root, HOOKS_DIR), { recursive: true });
        appendFileSync(receiptsPath(root), receipts.map((receipt) => stableStringify(receipt)).join('\n') + '\n');
    } catch (error) {
        throw new HookBusError('receipt-journal-write-failed', `delivery receipts could not be appended: ${describeError(error)}`);
    }
}

// ---------------------------------------------------------------------------
// The runtime
// ---------------------------------------------------------------------------

interface TranslatedEvent {
    readonly ref: DispatchContract.HookEventRef;
    readonly sourceRowSeq: number;
}

interface JournalRowView {
    readonly seq: number;
    readonly ts: number;
    readonly type: string;
}

interface BusMessageView {
    readonly seq: number;
    readonly kind: string;
}

function toDispatchRegistry(loaded: LoadedHookRegistry): DispatchContract.HookRegistry {
    return {
        scope: loaded.scope,
        contractVersion: DispatchContract.HOOK_BUS_CONTRACTS_VERSION,
        hooks: loaded.hooks.map((hook) => ({
            hookId: hook.hookId,
            kind: hook.kind,
            matchSpec: hook.matchSpec,
            priority: hook.priority,
            enabled: hook.enabled,
        })),
    };
}

function createRuntime(deps: {
    readonly root: string;
    readonly clock: HookBusClock;
    readonly scope: HookBusScope;
    readonly storeLoad: () => unknown;
    readonly storeListGraphs: () => unknown;
    readonly storeRowsFor: (graphId: string) => unknown;
    readonly busLoad: () => unknown;
    readonly busMessages: () => readonly unknown[];
    readonly vocabulary: HookBusVocabulary;
}): HookBusRuntime {
    const { root, clock, scope, storeLoad, storeListGraphs, storeRowsFor, busLoad, busMessages, vocabulary } = deps;

    function registry(): LoadedHookRegistry {
        return readRegistryFile(root, scope);
    }

    function registerHook(input: HookRegistrationInput): RegistrationContract.HookDescriptor {
        need(isRecord(input), 'invalid-params', 'registerHook: the registration input must be an object {hookId, kind, effectKind, matchSpec, priority, enabled}');
        need(typeof input.hookId === 'string', 'invalid-params', 'registerHook: hookId must be a string');
        need(typeof input.effectKind === 'string', 'invalid-params', 'registerHook: effectKind must be a string (the policy law is evaluated over it verbatim)');
        need(isRecord(input.matchSpec), 'invalid-params', 'registerHook: matchSpec must be an object {kinds, events}');
        need(typeof input.priority === 'number', 'invalid-params', 'registerHook: priority must be a number');
        need(typeof input.enabled === 'boolean', 'invalid-params', 'registerHook: enabled must be a boolean');
        // The runtime stamps scope/contractVersion/registeredAtIso itself: the
        // registry is scoped by the bind, timestamps by the injected clock.
        const candidate: Record<string, unknown> = {
            scope,
            contractVersion: RegistrationContract.HOOK_BUS_CONTRACTS_VERSION,
            hookId: input.hookId,
            kind: input.kind,
            effectKind: input.effectKind,
            matchSpec: input.matchSpec,
            priority: input.priority,
            enabled: input.enabled,
            registeredAtIso: epochMsToIsoUtc(clock()),
        };
        // The policy law FIRST: a dangerous effect kind is refused with the
        // violated invariants and their verbatim HOOK_POLICY statements.
        const policyVerdict = PolicyContract.checkPolicyInvariants(candidate);
        if (!policyVerdict.ok) {
            throw new HookBusError(
                'registration-refused',
                `registration refused: the hook-effect law is violated (${policyVerdict.violations.join(', ')}) -- the runtime never registers a dangerous effect kind`,
                {
                    violations: [...policyVerdict.violations],
                    policyStatements: policyVerdict.violations.map((invariant) => PolicyContract.HOOK_POLICY[invariant]),
                },
            );
        }
        const loaded = readRegistryFile(root, scope);
        const cleanHooks = cleanDescriptorsOf(loaded);
        // The registration laws: the contract's own canRegister, verbatim.
        const verdict = RegistrationContract.canRegister(candidate, { scope: loaded.scope, contractVersion: loaded.contractVersion, hooks: cleanHooks });
        if (!verdict.ok) {
            throw new HookBusError(
                'registration-refused',
                `registration refused: ${verdict.violations.join(', ')} (the frozen registration violation vocabulary)`,
                { violations: [...verdict.violations] },
            );
        }
        // Duplicate ids are also refused against flagged hooks (canRegister's
        // replay sees only the clean set; the seen-set law is the runtime's).
        if (loaded.hooks.some((hook) => hook.hookId === input.hookId)) {
            throw new HookBusError(
                'registration-refused',
                `registration refused: duplicate-hook-id (hook id '${input.hookId}' is already registered)`,
                { violations: ['duplicate-hook-id'] },
            );
        }
        // The contract's own pure transition, then durable persistence.
        const transition = RegistrationContract.register(candidate as unknown as RegistrationContract.HookDescriptor, { scope: loaded.scope, contractVersion: loaded.contractVersion, hooks: cleanHooks });
        if (!transition.ok) {
            throw new HookBusError(
                'registration-refused',
                `registration refused: the contract register transition refused (${transition.violations.join(', ')})`,
                { violations: [...transition.violations] },
            );
        }
        writeRegistryFile(root, { scope: loaded.scope, contractVersion: loaded.contractVersion, hooks: [...loaded.hooks, toLoadedHook(candidate, false)], flaggedHookIds: [...loaded.flaggedHookIds] }); /* station seam-fix: the LoadedHookRegistry persistence shape requires flaggedHookIds — carried through unchanged on register */
        return candidate as unknown as RegistrationContract.HookDescriptor;
    }

    function collectJournalRows(): JournalRowView[] {
        const graphs = storeListGraphs();
        if (!Array.isArray(graphs)) {
            throw new HookBusError('seam-error', 'orchStore listGraphs() did not return a list');
        }
        const rows: JournalRowView[] = [];
        for (const graph of graphs) {
            if (!isRecord(graph) || !isNonEmptyString(graph.graphId)) {
                throw new HookBusError('seam-error', 'orchStore listGraphs() returned a non-graph entry');
            }
            const graphRows = storeRowsFor(graph.graphId);
            if (!Array.isArray(graphRows)) {
                throw new HookBusError('seam-error', `orchStore rowsFor('${String(graph.graphId)}') did not return a list`);
            }
            for (const row of graphRows) {
                if (!isRecord(row)) {
                    throw new HookBusError('seam-error', 'the orchestration journal yielded a non-object row');
                }
                const seq = row.seq;
                const ts = row.ts;
                const type = row.type;
                if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
                    throw new HookBusError('seam-error', 'a journal row seq is not a positive integer');
                }
                if (typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts < 1) {
                    throw new HookBusError('seam-error', 'a journal row ts is not a positive integer');
                }
                if (!isNonEmptyString(type)) {
                    throw new HookBusError('seam-error', 'a journal row type is not a non-empty string');
                }
                rows.push({ seq, ts, type });
            }
        }
        // One global chain across all graphs: seq is unique and load-enforced,
        // so the seq-ascending merge is the deterministic global order.
        rows.sort((a, b) => a.seq - b.seq);
        return rows;
    }

    function collectBusMessages(): BusMessageView[] {
        const messages = busMessages();
        if (!Array.isArray(messages)) {
            throw new HookBusError('seam-error', 'the a2a bus messages projection is not a list');
        }
        const views: BusMessageView[] = [];
        for (const message of messages) {
            if (!isRecord(message)) {
                throw new HookBusError('seam-error', 'the a2a journal yielded a non-object message');
            }
            const seq = message.seq;
            const kind = message.kind;
            if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) {
                throw new HookBusError('seam-error', 'an a2a message seq is not a positive integer');
            }
            if (!isNonEmptyString(kind)) {
                throw new HookBusError('seam-error', 'an a2a message kind is not a non-empty string');
            }
            views.push({ seq, kind });
        }
        return views;
    }

    function dispatch(): DispatchReport {
        const loadedRegistry = readRegistryFile(root, scope);
        const cursors = readCursorsFile(root);
        // Fresh observation: reload both seams from disk (the disk is the truth).
        let storeLoaded: unknown;
        try {
            storeLoaded = storeLoad();
        } catch (error) {
            throw new HookBusError('seam-error', `orchStore reload failed: ${describeError(error)}`);
        }
        if (storeLoaded !== undefined && typeof (storeLoaded as { then?: unknown }).then === 'function') {
            throw new HookBusError('seam-error', 'orchStore load() returned a promise: the sync read surface contract is violated');
        }
        let busLoaded: unknown;
        try {
            busLoaded = busLoad();
        } catch (error) {
            throw new HookBusError('seam-error', `a2a bus reload failed: ${describeError(error)}`);
        }
        if (busLoaded !== undefined && typeof (busLoaded as { then?: unknown }).then === 'function') {
            throw new HookBusError('seam-error', 'a2a bus load() returned a promise: the sync read surface contract is violated');
        }
        const rows = collectJournalRows();
        const messages = collectBusMessages();
        // The honest translation: post-cursor rows only; mapped types
        // translate, everything else is censused -- a digest is never invented.
        const translated: TranslatedEvent[] = [];
        const unmappedRowTypesMap = new Map<string, number>();
        for (const row of rows) {
            if (row.seq <= cursors.journalSeq) {
                continue;
            }
            const specs: readonly MappedEventRefSpec[] | undefined = JOURNAL_ROW_EVENT_REF_MAPPING[row.type];
            if (specs === undefined) {
                unmappedRowTypesMap.set(row.type, (unmappedRowTypesMap.get(row.type) ?? 0) + 1);
                continue;
            }
            for (const spec of specs) {
                translated.push({ ref: { kind: spec.kind, eventDigest: spec.eventDigest, occurredAtIso: epochMsToIsoUtc(row.ts) }, sourceRowSeq: row.seq });
            }
        }
        // The a2a census: NONE of the message kinds maps to a digest (they are
        // delegation traffic, not authority events) -- disclosed, never mapped.
        const unmappedMessageKindsMap = new Map<string, number>();
        for (const message of messages) {
            if (message.seq <= cursors.a2aSeq) {
                continue;
            }
            unmappedMessageKindsMap.set(message.kind, (unmappedMessageKindsMap.get(message.kind) ?? 0) + 1);
        }
        // Compose through the CONTRACT -- never sorted or filtered here.
        const dispatchRegistry = toDispatchRegistry(loadedRegistry);
        const plans = translated.map((entry) => DispatchContract.composeDispatchPlan(dispatchRegistry, entry.ref));
        // Defense-in-depth: the plan policy law over every composed plan.
        const policyRegistry = { scope: loadedRegistry.scope, contractVersion: loadedRegistry.contractVersion, hooks: loadedRegistry.hooks.map((hook) => hook.raw) };
        const planPolicyVerdicts = plans.map((plan) => PolicyContract.checkPlanPolicy(plan, policyRegistry));
        // Deliver in plan order: delivery IS the durable receipt (no effect is
        // ever executed; dangerous effect kinds are flagged, never run).
        const receipts: DeliveryReceipt[] = [];
        for (let index = 0; index < plans.length; index += 1) {
            const plan = plans[index];
            const sourceRowSeq = translated[index].sourceRowSeq;
            for (const hookId of plan.orderedHookIds) {
                const hook = loadedRegistry.hooks.find((candidate) => candidate.hookId === hookId);
                if (hook === undefined) {
                    throw new HookBusError('seam-error', `the composed plan references hook '${hookId}' that is not in the loaded registry`);
                }
                const verdict = PolicyContract.checkPolicyInvariants(hook.raw);
                const base = {
                    $schema: RECEIPT_SCHEMA,
                    scope,
                    contractVersion: RegistrationContract.HOOK_BUS_CONTRACTS_VERSION,
                    hookId,
                    eventKind: plan.eventRef.kind,
                    eventDigest: plan.eventRef.eventDigest,
                    occurredAtIso: plan.eventRef.occurredAtIso,
                    sourceRowSeq,
                    status: verdict.ok ? ('delivered' as const) : ('flagged-for-approval' as const),
                    effectKind: hook.effectKind,
                    deliveredAtIso: epochMsToIsoUtc(clock()),
                };
                receipts.push(
                    verdict.ok
                        ? base
                        : {
                              ...base,
                              violatedInvariants: [...verdict.violations],
                              policyStatements: verdict.violations.map((invariant) => PolicyContract.HOOK_POLICY[invariant]),
                          },
                );
            }
        }
        // At-least-once: receipts land BEFORE the cursor advance (a failed
        // append leaves the cursors untouched so a re-run re-delivers).
        appendReceipts(root, receipts);
        let journalSeqObserved = 0;
        for (const row of rows) {
            if (row.seq > journalSeqObserved) {
                journalSeqObserved = row.seq;
            }
        }
        let a2aSeqObserved = 0;
        for (const message of messages) {
            if (message.seq > a2aSeqObserved) {
                a2aSeqObserved = message.seq;
            }
        }
        writeCursorsFile(root, { journalSeq: Math.max(cursors.journalSeq, journalSeqObserved), a2aSeq: Math.max(cursors.a2aSeq, a2aSeqObserved) });
        const unmappedRowTypes: Record<string, number> = {};
        for (const [rowType, count] of unmappedRowTypesMap) {
            unmappedRowTypes[rowType] = count;
        }
        const unmappedMessageKinds: Record<string, number> = {};
        for (const [kind, count] of unmappedMessageKindsMap) {
            unmappedMessageKinds[kind] = count;
        }
        return { eventRefs: translated.map((entry) => entry.ref), plans, planPolicyVerdicts, receipts, unmappedRowTypes, unmappedMessageKinds, journalSeqObserved, a2aSeqObserved };
    }

    return { root, scope, vocabulary, registerHook, dispatch, registry };
}

// ---------------------------------------------------------------------------
// Bind (the loadBgAgentRuntime / loadOrchestrationStore discipline)
// ---------------------------------------------------------------------------

async function importSeamModule(specifier: string): Promise<unknown> {
    // Non-literal on purpose: the seam contract is validated at runtime (the
    // cli/runtime/context.ts discipline); tsc must not resolve or reject it.
    return await import(specifier);
}

function resolveVocabulary(orchProtocolModule: Record<string, unknown> | null, a2aModule: Record<string, unknown> | null): HookBusVocabulary {
    const journalEventTypesRaw = orchProtocolModule === null ? undefined : orchProtocolModule.JOURNAL_EVENT_TYPES;
    const journalEventTypes = Array.isArray(journalEventTypesRaw) && journalEventTypesRaw.every((entry) => typeof entry === 'string')
        ? [...(journalEventTypesRaw as string[])]
        : [];
    const messageKindsRaw = a2aModule === null ? undefined : a2aModule.MESSAGE_KINDS;
    const messageKinds = Array.isArray(messageKindsRaw) && messageKindsRaw.every((entry) => typeof entry === 'string')
        ? [...(messageKindsRaw as string[])]
        : [];
    return { journalEventTypes, journalEventTypesResolved: journalEventTypes.length > 0, messageKinds, messageKindsResolved: messageKinds.length > 0 };
}

/** Never invent: every mapping key must be an authority row type; every mapped spec must be a contract-valid eventRef shape. */
function validateMappingAgainstVocabulary(vocabulary: HookBusVocabulary): string | null {
    for (const [rowType, specs] of Object.entries(JOURNAL_ROW_EVENT_REF_MAPPING)) {
        if (vocabulary.journalEventTypesResolved && !vocabulary.journalEventTypes.includes(rowType)) {
            return `the digest mapping row type '${rowType}' is not in the authority journal vocabulary (JOURNAL_EVENT_TYPES): a digest mapping is never invented`;
        }
        for (const spec of specs) {
            if (!DispatchContract.isHookKind(spec.kind) || !DispatchContract.isAuthorityEventDigest(spec.eventDigest) || !DispatchContract.kindCoversEventDigest(spec.kind, spec.eventDigest)) {
                return `the digest mapping entry ${spec.kind}/${spec.eventDigest} for row type '${rowType}' is not a contract-valid HookEventRef shape`;
            }
        }
    }
    return null;
}

async function bindInternal(root: string, options: HookBusBindOptions, requireScope: boolean): Promise<HookBusBindVerdict> {
    if (typeof root !== 'string' || root.length === 0) {
        return { bound: false, detail: 'a non-empty workspace root is required' };
    }
    if (!isRecord(options)) {
        return { bound: false, detail: 'bind options {clock, scope} are required' };
    }
    if (typeof options.clock !== 'function') {
        return { bound: false, detail: 'an injected clock (() => epoch-ms number) is required: the runtime never reads a wall clock' };
    }
    const suppliedScope = options.scope;
    if (suppliedScope !== undefined && !RegistrationContract.isHookBusScope(suppliedScope)) {
        return { bound: false, detail: 'the supplied scope must be {workspaceId, tenantId} with non-empty strings (isHookBusScope)' };
    }
    if (requireScope && suppliedScope === undefined) {
        return { bound: false, detail: 'bindHookBus requires a scope {workspaceId, tenantId}: it stamps the scope of a fresh registry' };
    }

    let orchStoreModule: Record<string, unknown> | null = null;
    try {
        orchStoreModule = (await importSeamModule(ORCH_STORE_SEAM)) as Record<string, unknown>;
    } catch (error) {
        return { bound: false, detail: `orchStore seam import failed: ${describeError(error)}` };
    }
    let a2aModule: Record<string, unknown> | null = null;
    try {
        a2aModule = (await importSeamModule(A2A_BUS_SEAM)) as Record<string, unknown>;
    } catch (error) {
        return { bound: false, detail: `a2a seam import failed: ${describeError(error)}` };
    }
    let orchProtocolModule: Record<string, unknown> | null = null;
    try {
        orchProtocolModule = (await importSeamModule(ORCH_PROTOCOL_SEAM)) as Record<string, unknown>;
    } catch {
        // Non-fatal (the bgAgent ORCH_PROTOCOL_SEAM pattern): the census
        // denominator degrades to observed types only, disclosed via the
        // vocabulary's journalEventTypesResolved flag.
        orchProtocolModule = null;
    }

    const StoreCtor = orchStoreModule.OrchestrationStore;
    if (typeof StoreCtor !== 'function') {
        return { bound: false, detail: 'orchStore seam does not export the OrchestrationStore class' };
    }
    let storeRecord: Record<string, unknown>;
    try {
        storeRecord = new (StoreCtor as unknown as new (root: string, options?: Record<string, unknown>) => Record<string, unknown>)(root, { clock: options.clock });
    } catch (error) {
        return { bound: false, detail: `orchStore load failed: ${describeError(error)}` };
    }
    for (const method of ['load', 'listGraphs', 'rowsFor']) {
        if (typeof storeRecord[method] !== 'function') {
            return { bound: false, detail: `orchStore binding lacks ${method}()` };
        }
    }

    const BusCtor = a2aModule.A2ABus;
    if (typeof BusCtor !== 'function') {
        return { bound: false, detail: 'a2a seam does not export the A2ABus class' };
    }
    let busRecord: Record<string, unknown>;
    try {
        busRecord = new (BusCtor as unknown as new (root: string) => Record<string, unknown>)(root);
    } catch (error) {
        return { bound: false, detail: `a2a bus construction failed: ${describeError(error)}` };
    }
    if (typeof busRecord.load !== 'function') {
        return { bound: false, detail: 'a2a binding lacks load()' };
    }
    if (!Array.isArray(busRecord.messages)) {
        return { bound: false, detail: 'a2a binding lacks the messages journal projection' };
    }

    const vocabulary = resolveVocabulary(orchProtocolModule, a2aModule);
    const mappingProblem = validateMappingAgainstVocabulary(vocabulary);
    if (mappingProblem !== null) {
        return { bound: false, detail: mappingProblem };
    }

    // Scope resolution: a persisted registry's scope is authoritative; a
    // supplied mismatched scope is a typed refusal; a fresh root needs one.
    let resolvedScope = suppliedScope;
    if (existsSync(registryPath(root))) {
        try {
            const loaded = readRegistryFile(root, suppliedScope);
            resolvedScope = loaded.scope;
        } catch (error) {
            if (error instanceof HookBusError) {
                return { bound: false, detail: `${error.code}: ${error.message}` };
            }
            return { bound: false, detail: `the hook registry could not be read: ${describeError(error)}` };
        }
    } else if (resolvedScope === undefined) {
        return { bound: false, detail: 'invalid-params: a scope is required on a root with no persisted hook registry (loadHookBus serves a persisted registry; bindHookBus stamps a fresh one)' };
    }

    const runtime = createRuntime({
        root,
        clock: options.clock,
        scope: resolvedScope,
        storeLoad: () => (storeRecord as { load: () => unknown }).load(),
        storeListGraphs: () => (storeRecord as { listGraphs: () => unknown }).listGraphs(),
        storeRowsFor: (graphId: string) => (storeRecord as { rowsFor: (id: string) => unknown }).rowsFor(graphId),
        busLoad: () => (busRecord as { load: () => unknown }).load(),
        busMessages: () => (busRecord as { messages: unknown[] }).messages,
        vocabulary,
    });
    return { bound: true, runtime, store: storeRecord as unknown as HookBusStoreBinding, bus: busRecord as unknown as HookBusBusBinding, vocabulary };
}

/** Bind the live hook-bus runtime over the REAL seams at a root. Never throws: a typed verdict. */
export async function bindHookBus(root: string, options: { readonly clock: HookBusClock; readonly scope: HookBusScope }): Promise<HookBusBindVerdict> {
    return bindInternal(root, options, true);
}

/** Serve the persisted registry of a root after a restart (the scope is the persisted one). */
export async function loadHookBus(root: string, options: { readonly clock: HookBusClock; readonly scope?: HookBusScope }): Promise<HookBusBindVerdict> {
    return bindInternal(root, options, false);
}