/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-010 -- THE HANDLER TABLE: every grammar command routes.
 *
 * LAWS:
 * - EXHAUSTIVE over the frozen 29-command grammar: every path is
 *   either a wired read handler or a TYPED refusal. Grammar/handler
 *   drift fails closed to an edge failure (never an unhandled path).
 * - NEVER FAKE SUCCESS: an unwired command is a RefusedProjection
 *   carrying a code from wire.ts's frozen refusal table; the violated
 *   law is copied verbatim by the wire builder (no free-form strings).
 * - WIRED (wave 1, read-only over the real seams):
 *     background-agent.roster      a2a list() -- the roster view
 *     background-agent.inspect      a2 list() scoped to one agent
 *     workflow.phases / .view       orchStore getGraphState(id)
 * - WIRED (wave 2, CR-010b):
 *     approval.list                the pending-approval derivation over
 *                                  the store journal (disclosed in every
 *                                  projection document; the store owns ALL
 *                                  approval state -- the CLI derives, it
 *                                  never invents)
 *     approval.respond             the grant/deny act through the store's
 *                                  approvalDecide; past expiresAt the
 *                                  FAIL-CLOSED leg through expireApproval
 *                                  (the step is CANCELLED, never
 *                                  auto-granted)
 *     capability-discovery.search  registry load() + query() -- READ-ONLY
 *                                  over the live CR-006 registry; the CLI
 *                                  never mutates the registry
 * - REFUSAL CENSUS (wave 2): 7 wired + 22 typed refusals over the 29
 *   grammar paths. capability-discovery.inspect is NOT a grammar path
 *   (sources/packs/search only); the registry's inspect() is exercised
 *   in-process by the journey battery, never as a CLI command.
 * - SCOPE ISOLATION: a request whose scope does not match the
 *   root-derived scope is the typed scope-isolation-violated refusal.
 * - DETERMINISM: no wall-clock reads, no random. The only clock read is
 *   the injected issuedAtIso (Date.parse of a plain ISO string).
 */

import type {
        CliRefusalCode,
        CliRequest,
        ServiceJourney,
        ServiceProjection,
} from '../../zcode-patterns/cli/common/wire.ts';
import {
        canonicalJson,
        describeError,
        deriveScope,
        sha256Hex,
        type CliContext,
        type OrchestrationStoreBinding,
        type RegistryReadBinding,
} from './context.ts';
import {
        BgAgentError,
        loadBgAgentRuntime,
} from '../../capabilities/background-agent/runtime/bgAgent.mjs';
import type {
        BgAgentLaunchSpec,
        BgAgentRuntime,
} from '../../capabilities/background-agent/runtime/bgAgent.mjs';


export type RoutedOutcome =
        | { kind: 'projection'; projection: ServiceProjection }
        | { kind: 'edge-failure'; reason: string; detail: string };

function journeySegment(commandPath: string): ServiceJourney {
        return commandPath.slice(0, commandPath.indexOf('.')) as ServiceJourney;
}

function refused(request: CliRequest, refusalCode: CliRefusalCode): RoutedOutcome {
        return {
                kind: 'projection',
                projection: {
                        kind: 'refused',
                        journey: journeySegment(request.commandPath),
                        commandPath: request.commandPath,
                        refusalCode,
                },
        };
}

function projected(
        request: CliRequest,
        projectionDigest: string,
        completeness: 'full' | 'partial',
): RoutedOutcome {
        return {
                kind: 'projection',
                projection: {
                        kind: 'projected',
                        journey: journeySegment(request.commandPath),
                        commandPath: request.commandPath,
                        projectionDigest,
                        completeness,
                },
        };
}

function absent(request: CliRequest): RoutedOutcome {
        return {
                kind: 'projection',
                projection: {
                        kind: 'absent',
                        journey: journeySegment(request.commandPath),
                        commandPath: request.commandPath,
                },
        };
}

function edgeFailure(reason: string, detail: string): RoutedOutcome {
        return { kind: 'edge-failure', reason, detail };
}

/** Shape-agnostic membership scan (the roster's on-disk shape is the seam's, not ours). */
export function jsonContainsValue(value: unknown, needle: string): boolean {
        if (value === needle) {
                return true;
        }
        if (Array.isArray(value)) {
                return value.some((item) => jsonContainsValue(item, needle));
        }
        if (typeof value === 'object' && value !== null) {
                const record = value as Record<string, unknown>;
                return Object.keys(record).some((key) => jsonContainsValue(record[key], needle));
        }
        return false;
}

async function readRoster(context: CliContext, _request: CliRequest): Promise<RoutedOutcome> {
        const bus = await context.readBus();
        if (!bus.bound) {
                return edgeFailure('seam-unavailable', 'a2a bus: ' + bus.detail);
        }
        let roster: unknown;
        try {
                roster = bus.binding.list();
        } catch (error) {
                return edgeFailure('seam-unavailable', 'a2a list failed: ' + describeError(error));
        }
        return projected(_request, sha256Hex(canonicalJson(roster)), 'full');
}

async function readAgentInspect(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const agentId = request.args['agentId'] ?? '';
        const bus = await context.readBus();
        if (!bus.bound) {
                return edgeFailure('seam-unavailable', 'a2a bus: ' + bus.detail);
        }
        let roster: unknown;
        try {
                roster = bus.binding.list();
        } catch (error) {
                return edgeFailure('seam-unavailable', 'a2a list failed: ' + describeError(error));
        }
        if (agentId.length === 0 || !jsonContainsValue(roster, agentId)) {
                return absent(request);
        }
        return projected(request, sha256Hex(canonicalJson({ agentId, roster })), 'full');
}

async function readGraphState(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const workflowId = request.args['workflowId'] ?? '';
        const store = await context.readStore();
        if (!store.bound) {
                return edgeFailure('seam-unavailable', 'orchestration store: ' + store.detail);
        }
        let state: unknown;
        try {
                state = store.binding.getGraphState(workflowId);
        } catch (error) {
                /* The typed not-found law (A-PROD-006-W4 audit find): the store throws
                 * OrchestrationError('unknown graph', code 'unknown-graph') for an absent
                 * graph -- a PREDICTABLE typed condition, not a seam failure. The CLI's
                 * exit-code contract classes not-found as 3 (the battery's j6-s7 leg and
                 * the bg runtime's NOT_FOUND -> absent mapping establish the pattern);
                 * classing it seam-unavailable (exit 2, no response) broke the typed
                 * refusal discipline. Shape-based code check -- the structural law. */
                if (error instanceof Error && (error as { code?: unknown }).code === 'unknown-graph') {
                        return absent(request);
                }
                return edgeFailure('seam-unavailable', 'getGraphState failed: ' + describeError(error));
        }
        if (state === undefined || state === null) {
                return absent(request);
        }
        return projected(request, sha256Hex(canonicalJson(state)), 'full');
}

// ---------------------------------------------------------------------------
// CR-010b wave 2: the approval family (the store is the approval authority)
// ---------------------------------------------------------------------------

/**
 * The pending-approval derivation, disclosed verbatim inside every
 * approval.list projection document. The store exposes no
 * pending-approval query; the CLI derives the pending set from the
 * journal and never pretends the store served it.
 */
export const APPROVAL_DERIVATION =
        'derived: approval-requested journal rows whose (graphId, stepId) carries no later approval decision row';

/** A journal row read shape-agnostically (the row shape is the store's, not ours). */
interface JournalRowLike {
        seq?: unknown;
        rowId?: unknown;
        ts?: unknown;
        graphId?: unknown;
        stepId?: unknown;
        type?: unknown;
        actor?: unknown;
        origin?: unknown;
        payload?: unknown;
}

function rowText(row: JournalRowLike, key: string): string | null {
        const value = (row as Record<string, unknown>)[key];
        return typeof value === 'string' ? value : null;
}

function rowNumber(row: JournalRowLike, key: string): number | null {
        const value = (row as Record<string, unknown>)[key];
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function payloadField(row: JournalRowLike, key: string): unknown {
        const payload = row.payload;
        if (payload === null || typeof payload !== 'object') {
                return undefined;
        }
        return (payload as Record<string, unknown>)[key];
}

/** Step-level approval rows only (graph-level approvals carry a null stepId). */
function isStepApprovalRow(row: JournalRowLike): boolean {
        return (
                typeof row.type === 'string' &&
                row.type.includes('approval') &&
                typeof row.stepId === 'string' &&
                row.stepId.length > 0
        );
}

function isApprovalRequestRow(row: JournalRowLike): boolean {
        return isStepApprovalRow(row) && (row.type as string).includes('request');
}

function rowSeq(row: JournalRowLike): number {
        return typeof row.seq === 'number' ? row.seq : 0;
}

interface PendingApprovalView {
        approvalId: string;
        graphId: string;
        stepId: string;
        reason: string | null;
        expiresAt: number | null;
        requestedAt: number | null;
        actor: string | null;
        origin: string | null;
}

function pendingApprovalView(row: JournalRowLike): PendingApprovalView {
        const reason = payloadField(row, 'reason');
        const expiresAt = payloadField(row, 'expiresAt');
        return {
                approvalId: rowText(row, 'rowId') ?? '',
                graphId: rowText(row, 'graphId') ?? '',
                stepId: rowText(row, 'stepId') ?? '',
                reason: typeof reason === 'string' ? reason : null,
                expiresAt: typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? expiresAt : null,
                requestedAt: rowNumber(row, 'ts'),
                actor: rowText(row, 'actor'),
                origin: rowText(row, 'origin'),
        };
}

/**
 * The honest derivation: group the step-level approval rows by
 * (graphId, stepId); a step is pending exactly when its LAST approval
 * row (by journal sequence) is a request row -- any later decision row
 * (granted / denied / expired / ...) resolves it.
 */
function derivePendingApprovals(rows: JournalRowLike[]): PendingApprovalView[] {
        const byStep = new Map<string, JournalRowLike[]>();
        for (const row of rows) {
                if (!isStepApprovalRow(row)) {
                        continue;
                }
                const graphId = rowText(row, 'graphId') ?? '';
                const stepId = rowText(row, 'stepId') ?? '';
                const key = graphId + '\u0000' + stepId;
                const bucket = byStep.get(key);
                if (bucket === undefined) {
                        byStep.set(key, [row]);
                } else {
                        bucket.push(row);
                }
        }
        const pending: PendingApprovalView[] = [];
        for (const bucket of byStep.values()) {
                bucket.sort((a, b) => rowSeq(a) - rowSeq(b));
                const last = bucket[bucket.length - 1];
                if (last !== undefined && isApprovalRequestRow(last)) {
                        pending.push(pendingApprovalView(last));
                }
        }
        pending.sort((a, b) => (a.graphId + '\u0000' + a.stepId < b.graphId + '\u0000' + b.stepId ? -1 : 1));
        return pending;
}

function findPendingApproval(rows: JournalRowLike[], approvalId: string): PendingApprovalView | undefined {
        for (const view of derivePendingApprovals(rows)) {
                if (view.approvalId === approvalId) {
                        return view;
                }
        }
        return undefined;
}

type JournalScan =
        | { bound: true; binding: OrchestrationStoreBinding; rows: JournalRowLike[] }
        | { bound: false; outcome: RoutedOutcome };

/**
 * The journal scan behind the approval family: rowsFor per session
 * graph over the real seam (raw.listGraphs + rowsFor(graphId)); the
 * ref-less rowsFor() over the harness fixture (the whole fixture
 * journal). One store load per command; no second runtime.
 */
async function scanJournal(context: CliContext): Promise<JournalScan> {
        const store = await context.readStore();
        if (!store.bound) {
                return { bound: false, outcome: edgeFailure('seam-unavailable', 'orchestration store: ' + store.detail) };
        }
        const raw = store.binding.raw as { listGraphs?: unknown } | undefined;
        if (raw !== undefined && typeof raw.listGraphs === 'function') {
                const rows: JournalRowLike[] = [];
                try {
                        // Method call ON raw (never detached): listGraphs reads `this`.
                        for (const graph of (raw.listGraphs as () => Array<{ graphId: string }>).call(raw)) {
                                const graphRows = store.binding.rowsFor(graph.graphId);
                                if (Array.isArray(graphRows)) {
                                        rows.push(...(graphRows as JournalRowLike[]));
                                }
                        }
                } catch (error) {
                        return {
                                bound: false,
                                outcome: edgeFailure('seam-unavailable', 'journal scan failed: ' + describeError(error)),
                        };
                }
                return { bound: true, binding: store.binding, rows };
        }
        const rows = store.binding.rowsFor();
        return { bound: true, binding: store.binding, rows: Array.isArray(rows) ? (rows as JournalRowLike[]) : [] };
}

async function listApprovals(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const scan = await scanJournal(context);
        if (!scan.bound) {
                return scan.outcome;
        }
        const approvals = derivePendingApprovals(scan.rows);
        const document = {
                kind: 'pending-approvals',
                derivation: APPROVAL_DERIVATION,
                count: approvals.length,
                approvals,
        };
        return projected(request, sha256Hex(canonicalJson(document)), 'full');
}

/**
 * The approval act through the store's EXISTING raw write API -- the
 * runReloadDrill precedent (raw.submitGraph/approveGraph), not a new
 * seam. The store is the authority; a typed store refusal surfaces as
 * an edge failure carrying the store's message.
 */
async function approvalAct(
        binding: OrchestrationStoreBinding,
        method: 'approvalDecide' | 'expireApproval',
        input: Record<string, unknown>,
): Promise<unknown> {
        const raw = binding.raw as Record<string, unknown> | undefined;
        if (raw === undefined || typeof raw[method] !== 'function') {
                throw new Error('the bound store does not expose the raw approval API (' + method + ')');
        }
        return await (raw[method] as (value: Record<string, unknown>) => Promise<unknown>)(input);
}

async function respondApproval(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const approvalId = request.args['approvalId'] ?? '';
        const decision = request.args['decision'] ?? '';
        if (approvalId.length === 0) {
                return absent(request);
        }
        const scan = await scanJournal(context);
        if (!scan.bound) {
                return scan.outcome;
        }
        const target = findPendingApproval(scan.rows, approvalId);
        if (target === undefined) {
                return absent(request);
        }
        const nowMs = Date.parse(context.issuedAtIso);
        if (target.expiresAt !== null && nowMs > target.expiresAt) {
                // FAIL-CLOSED (the store's TL2-004 law): a request past its expiresAt
                // is expired through expireApproval and the step is CANCELLED --
                // never auto-granted, whatever the requested decision says. The
                // expiry check precedes the decision validation on purpose.
                let expiredRow: unknown;
                try {
                        expiredRow = await approvalAct(scan.binding, 'expireApproval', {
                                graphId: target.graphId,
                                stepId: target.stepId,
                                expiredAt: nowMs,
                                note: 'fail-closed expiry at respond time',
                                // The transition table: expiry is SERVICE-ONLY (a mechanical
                                // deadline observation, never a human-granted outcome).
                                actor: 'service',
                                origin: 'flauz-cli',
                        });
                } catch (error) {
                        return edgeFailure('seam-unavailable', 'expireApproval refused: ' + describeError(error));
                }
                const document = {
                        kind: 'approval-responded',
                        approvalId,
                        decision,
                        outcome: 'expired',
                        failClosed: true,
                        stepDisposition: 'cancelled',
                        row: expiredRow,
                };
                return projected(request, sha256Hex(canonicalJson(document)), 'full');
        }
        if (decision !== 'granted' && decision !== 'denied') {
                return edgeFailure(
                        'seam-unavailable',
                        "approval.respond requires decision 'granted' or 'denied', got '" + decision + "'",
                );
        }
        let decidedRow: unknown;
        try {
                decidedRow = await approvalAct(scan.binding, 'approvalDecide', {
                        graphId: target.graphId,
                        stepId: target.stepId,
                        decision,
                        actor: 'human',
                        origin: 'flauz-cli',
                });
        } catch (error) {
                return edgeFailure('seam-unavailable', 'approvalDecide refused: ' + describeError(error));
        }
        const document = {
                kind: 'approval-responded',
                approvalId,
                decision,
                outcome: decision,
                row: decidedRow,
        };
        return projected(request, sha256Hex(canonicalJson(document)), 'full');
}

// ---------------------------------------------------------------------------
// CR-010b wave 2: the capability-discovery search (READ-ONLY over the
// live CR-006 registry; the CLI never mutates the registry)
// ---------------------------------------------------------------------------

function registryRefusalText(refusal: unknown): string {
        const record = refusal as { code?: unknown; law?: unknown; detail?: unknown };
        const code = typeof record.code === 'string' ? record.code : 'unknown-refusal';
        const law = typeof record.law === 'string' ? ' (' + record.law + ')' : '';
        const detail = typeof record.detail === 'string' && record.detail.length > 0 ? ': ' + record.detail : '';
        return code + law + detail;
}

/**
 * The query text -> predicate mapping over the frozen registry predicate
 * surface (state / artifactKind / platform / permissionTier):
 * space-separated 'key:value' tokens. Validation is DELEGATED to the
 * registry (an unknown key or malformed value is the registry's typed
 * E_QUERY_MALFORMED refusal) -- the CLI mints no validation vocabulary
 * of its own (not a second runtime).
 */
function predicateFromQueryText(text: string): Record<string, string> {
        const predicate: Record<string, string> = {};
        for (const token of text.split(' ')) {
                if (token.length === 0) {
                        continue;
                }
                const separator = token.indexOf(':');
                if (separator <= 0) {
                        predicate[token] = '';
                        continue;
                }
                predicate[token.slice(0, separator)] = token.slice(separator + 1);
        }
        return predicate;
}

async function capabilitySearch(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const registry = context.readRegistry(context.root);
        let loaded: Awaited<ReturnType<RegistryReadBinding['load']>>;
        try {
                loaded = await registry.load();
        } catch (error) {
                return edgeFailure('seam-unavailable', 'registry load failed: ' + describeError(error));
        }
        if (!loaded.ok) {
                return edgeFailure('seam-unavailable', 'registry load refused: ' + registryRefusalText(loaded.refusal));
        }
        const predicate = predicateFromQueryText(request.args['query'] ?? '');
        let queried: Awaited<ReturnType<RegistryReadBinding['query']>>;
        try {
                queried = await registry.query(predicate);
        } catch (error) {
                return edgeFailure('seam-unavailable', 'registry query failed: ' + describeError(error));
        }
        if (!queried.ok) {
                return edgeFailure('seam-unavailable', 'registry query refused: ' + registryRefusalText(queried.refusal));
        }
        // The grammar validates the limit token as a number at parse time; the
        // limit is applied client-side over the registry's stable entry-id
        // ordering and disclosed in the projection document.
        const limitToken = request.args['limit'];
        const limit = limitToken !== undefined && limitToken.length > 0 ? Number(limitToken) : null;
        const entries = [...queried.entries];
        const limited =
                limit !== null && Number.isFinite(limit) && limit >= 0 ? entries.slice(0, Math.floor(limit)) : entries;
        const document = {
                kind: 'capability-search',
                predicate,
                limit,
                count: queried.count,
                returned: limited.length,
                entries: limited,
        };
        return projected(request, sha256Hex(canonicalJson(document)), 'full');
}

// ---------------------------------------------------------------------------
// the tables (7 wired + 22 typed refusals over the frozen 29)
// ---------------------------------------------------------------------------

/*
 * CR-002 wave 2 -- the background-agent mutation handlers over the
 * bgAgent runtime (the REAL OrchestrationStore + A2ABus at the
 * request's root).
 */

/**
 * Wire-conformant JSON-arg decode (station seam-completion): the ZC-009
 * wire delivers argKind:'json' values as JSON-encoded STRINGS (the wire
 * validates `args` as a plain string map); programmatic callers may pass
 * the object form directly. Both decode to the same object here.
 */
function parseJsonObjectArg(raw: unknown):
        | { kind: 'object'; value: Record<string, unknown> }
        | { kind: 'invalid' }
        | { kind: 'absent' } {
        if (raw === undefined) {
                return { kind: 'absent' };
        }
        let value: unknown = raw;
        if (typeof raw === 'string') {
                try {
                        value = JSON.parse(raw);
                } catch {
                        return { kind: 'invalid' };
                }
        }
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                return { kind: 'invalid' };
        }
        return { kind: 'object', value: value as Record<string, unknown> };
}

/** JSON-value decode: strings parse to their JSON value (plain text stays a string). */
function parseJsonValueArg(raw: unknown): unknown {
        if (typeof raw !== 'string') {
                return raw;
        }
        try {
                return JSON.parse(raw);
        } catch {
                return raw;
        }
}

function argOf(request: CliRequest, names: readonly string[]): unknown {
        for (const name of names) {
                const value = request.args[name];
                if (value !== undefined) {
                        return value;
                }
        }
        return undefined;
}

function runIdOf(request: CliRequest): string | null {
        const value = argOf(request, ['runId', 'id', 'graphId']);
        return typeof value === 'string' && value.length > 0 ? value : null;
}

type BgLoad = { ok: true; runtime: BgAgentRuntime } | { ok: false; outcome: RoutedOutcome };

async function loadBgRuntime(context: CliContext): Promise<BgLoad> {
        const loaded = await loadBgAgentRuntime({ root: context.root });
        if (!loaded.bound) {
                return { ok: false, outcome: edgeFailure('seam-unavailable', 'bg runtime: ' + loaded.detail) };
        }
        return { ok: true, runtime: loaded.runtime };
}

function bgErrorOutcome(request: CliRequest, error: unknown): RoutedOutcome {
        if (error instanceof BgAgentError) {
                if (error.code === 'NOT_FOUND') {
                        return absent(request);
                }
                if (error.code === 'INVALID_TRANSITION') {
                        return edgeFailure('invalid-state', 'bg: ' + error.message);
                }
                if (error.code === 'DISPOSED') {
                        return edgeFailure('runtime-disposed', 'bg: ' + error.message);
                }
                return edgeFailure('invalid-argument', 'bg: ' + error.message);
        }
        return edgeFailure('seam-unavailable', 'bg runtime: ' + describeError(error));
}

async function bgLaunch(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const spec = parseJsonObjectArg(argOf(request, ['agentSpec', 'spec', 'input', 'launch', 'request', 'payload']));
        if (spec.kind === 'absent') {
                return absent(request);
        }
        if (spec.kind === 'invalid') {
                return edgeFailure('invalid-argument', 'background-agent.launch: the spec argument must be a JSON object');
        }
        const loaded = await loadBgRuntime(context);
        if (!loaded.ok) {
                return loaded.outcome;
        }
        try {
                const result = await loaded.runtime.launch(spec.value as unknown as BgAgentLaunchSpec);
                return projected(request, sha256Hex(canonicalJson(result)), 'full');
        } catch (error) {
                return bgErrorOutcome(request, error);
        }
}

async function bgMessage(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const runId = runIdOf(request);
        if (runId === null) {
                return absent(request);
        }
        const payload = parseJsonValueArg(argOf(request, ['payload', 'message', 'body', 'input']));
        if (payload === undefined) {
                return absent(request);
        }
        const typeRaw = argOf(request, ['type', 'kind']);
        const loaded = await loadBgRuntime(context);
        if (!loaded.ok) {
                return loaded.outcome;
        }
        try {
                const result = await loaded.runtime.message(runId, {
                        type: typeof typeRaw === 'string' && typeRaw.length > 0 ? typeRaw : undefined,
                        payload,
                });
                return projected(request, sha256Hex(canonicalJson(result)), 'full');
        } catch (error) {
                return bgErrorOutcome(request, error);
        }
}

function bgControlHandler(command: 'pause' | 'resume' | 'cancel') {
        return async (context: CliContext, request: CliRequest): Promise<RoutedOutcome> => {
                const runId = runIdOf(request);
                if (runId === null) {
                        return absent(request);
                }
                const loaded = await loadBgRuntime(context);
                if (!loaded.ok) {
                        return loaded.outcome;
                }
                try {
                        const reasonRaw = argOf(request, ['reason', 'note']);
                        const result = await loaded.runtime.control(
                                runId,
                                command,
                                typeof reasonRaw === 'string' && reasonRaw.length > 0 ? { reason: reasonRaw } : {},
                        );
                        return projected(request, sha256Hex(canonicalJson(result)), 'full');
                } catch (error) {
                        return bgErrorOutcome(request, error);
                }
        };
}

const BG_HANDLERS: Readonly<
        Record<string, (context: CliContext, request: CliRequest) => Promise<RoutedOutcome>>
> = {
        'background-agent.launch': bgLaunch,
        'background-agent.message': bgMessage,
        'background-agent.pause': bgControlHandler('pause'),
        'background-agent.stop': bgControlHandler('cancel'),
        'background-agent.cancel': bgControlHandler('cancel'),
        'background-agent.resume': bgControlHandler('resume'),
};

const READ_HANDLERS: Readonly<
        Record<string, (context: CliContext, request: CliRequest) => Promise<RoutedOutcome>>
> = {
        'background-agent.roster': readRoster,
        'background-agent.inspect': readAgentInspect,
        'workflow.phases': readGraphState,
        'workflow.view': readGraphState,
        'approval.list': listApprovals,
        'capability-discovery.search': capabilitySearch,
};

/** The ONE CLI write surface of wave 2: the approval act through the store's own authority. */
const WRITE_HANDLERS: Readonly<
        Record<string, (context: CliContext, request: CliRequest) => Promise<RoutedOutcome>>
> = {
        'approval.respond': respondApproval,
};

const REFUSAL_CODES_BY_PATH: Readonly<Record<string, CliRefusalCode>> = {
        'workspace.status': 'parity-projection-missing',
        'workspace.list': 'parity-projection-missing',
        'workspace.focus': 'parity-projection-missing',
        'workflow.advance': 'parity-projection-missing',
        'evidence.attach': 'parity-projection-missing',
        'evidence.list': 'parity-projection-missing',
        'evidence.verify': 'parity-projection-missing',
        'replay.plan': 'parity-projection-missing',
        'replay.run': 'parity-projection-missing',
        'replay.verify': 'parity-projection-missing',
        'lab.runs': 'parity-projection-missing',
        'lab.catalog': 'parity-projection-missing',
        'lab.calibration': 'parity-projection-missing',
        'lab.recommendations': 'parity-projection-missing',
        'capability-discovery.sources': 'parity-projection-missing',
        'capability-discovery.packs': 'parity-projection-missing',
};

export function wiredCommandPaths(): string[] {
        return [...Object.keys(READ_HANDLERS), ...Object.keys(WRITE_HANDLERS), ...Object.keys(BG_HANDLERS)].sort();
}

export function refusedCommandPaths(): string[] {
        return Object.keys(REFUSAL_CODES_BY_PATH).sort();
}

export async function routeCommand(context: CliContext, request: CliRequest): Promise<RoutedOutcome> {
        const derived = deriveScope(context.root);
        if (
                request.scope.workspaceId !== derived.workspaceId ||
                request.scope.tenantId !== derived.tenantId
        ) {
                return refused(request, 'scope-isolation-violated');
        }
        const reader = READ_HANDLERS[request.commandPath];
        if (reader !== undefined) {
                return await reader(context, request);
        }
        const writer = WRITE_HANDLERS[request.commandPath];
        if (writer !== undefined) {
                return await writer(context, request);
        }
        const bgHandler = BG_HANDLERS[request.commandPath];
        if (bgHandler !== undefined) {
                return await bgHandler(context, request);
        }
        const code = REFUSAL_CODES_BY_PATH[request.commandPath];
        if (code !== undefined) {
                return refused(request, code);
        }
        return edgeFailure(
                'seam-unavailable',
                'no handler registered for command path ' +
                        request.commandPath +
                        ' (grammar/handler drift; fail closed)',
        );
}
