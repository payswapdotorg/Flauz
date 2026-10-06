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
 * - WIRED (wave 2, CR-002 mutations over the bgAgent runtime):
 *     background-agent.launch / .message / .pause / .stop /
 *     .cancel / .resume             the runtime over the REAL
 *                                 OrchestrationStore + A2ABus
 *     (build/flauz/capabilities/background-agent/runtime/bgAgent.mjs;
 *     pause/resume are ADVISORY A2A control messages, cancel/stop
 *     are the ENFORCED store cancellation; results are digest
 *     projections like every wired path).
 * - WAVE-2 ARG NOTE (CR-002): the grammar's argSpec names for the six
 *   mutation paths were not re-pasted; the handlers read them through
 *   a documented preference list (argOf) pending grammar.ts
 *   verification -- a one-line fix per path if the names differ.
 *   A missing required argument at routeCommand level follows the
 *   wave-1 readAgentInspect precedent: the absent projection (the
 *   parse layer owns arg validation in the real bin flow).
 * - REFUSAL CENSUS (wave 2): approval.respond
 *     headless-interactive-surface; the remaining 18 paths
 *     parity-projection-missing (approval.list, replay.*,
 *     capability-discovery.*, lab.*, workspace.*, evidence.*,
 *     workflow.advance).
 * - SCOPE ISOLATION: a request whose scope does not match the
 *   root-derived scope is the typed scope-isolation-violated refusal.
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
                return edgeFailure('seam-unavailable', 'getGraphState failed: ' + describeError(error));
        }
        if (state === undefined || state === null) {
                return absent(request);
        }
        return projected(request, sha256Hex(canonicalJson(state)), 'full');
}

const READ_HANDLERS: Readonly<
        Record<string, (context: CliContext, request: CliRequest) => Promise<RoutedOutcome>>
> = {
        'background-agent.roster': readRoster,
        'background-agent.inspect': readAgentInspect,
        'workflow.phases': readGraphState,
        'workflow.view': readGraphState,
};

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

const REFUSAL_CODES_BY_PATH: Readonly<Record<string, CliRefusalCode>> = {
        'workspace.status': 'parity-projection-missing',
        'workspace.list': 'parity-projection-missing',
        'workspace.focus': 'parity-projection-missing',
        'workflow.advance': 'parity-projection-missing',
        'approval.list': 'parity-projection-missing',
        'approval.respond': 'headless-interactive-surface',
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
        'capability-discovery.search': 'parity-projection-missing',
};

export function wiredCommandPaths(): string[] {
        return [...Object.keys(READ_HANDLERS), ...Object.keys(BG_HANDLERS)].sort();
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
