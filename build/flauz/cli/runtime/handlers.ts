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
 * - REFUSAL CENSUS (wave 1):
 *     approval.respond             headless-interactive-surface
 *     the remaining 24 paths       parity-projection-missing
 *     (approval.list, replay.*, capability-discovery.*, lab.*,
 *      workspace.*, evidence.*, background-agent mutations,
 *      workflow.advance)
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

const REFUSAL_CODES_BY_PATH: Readonly<Record<string, CliRefusalCode>> = {
	'workspace.status': 'parity-projection-missing',
	'workspace.list': 'parity-projection-missing',
	'workspace.focus': 'parity-projection-missing',
	'background-agent.launch': 'parity-projection-missing',
	'background-agent.message': 'parity-projection-missing',
	'background-agent.pause': 'parity-projection-missing',
	'background-agent.stop': 'parity-projection-missing',
	'background-agent.cancel': 'parity-projection-missing',
	'background-agent.resume': 'parity-projection-missing',
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
	return Object.keys(READ_HANDLERS).sort();
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