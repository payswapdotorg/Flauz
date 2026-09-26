/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.workflow.*` command surface (Wave 4, Lane K round-trip commands):
 *
 *   flauz.workflow.save(taskId, model?, rerunApprovals?) -> {workflowId, path}
 *       Save a run (after OR during - the distiller walks whatever the task
 *       timeline holds) as `.flauz/workflows/<id>.json`.
 *   flauz.workflow.run(workflowId, approvals?, executor?, ask?) -> WorkflowRunOutcome
 *       One command -> re-run: hydrate plan -> replay-approvals-or-ask ->
 *       execute tools -> new ledger rows linked to the ORIGINAL run's rows
 *       via derivedFrom (envelope.ts WorkflowService.run).
 *   flauz.workflow.list() -> {workflows: [...]}
 *
 * The executor / ask ports are wired by the extension layer (extension.ts) or
 * injected by tests; the command args never carry code.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import type { ApprovalPort, ToolExecutorPort, WorkflowFragment, WorkflowRunOutcome, WorkflowService } from './envelope.ts';
import { hasKey } from '../../flauz-workspace/src/ledger.ts';

export const COMMAND_IDS = [
	'flauz.workflow.save',
	'flauz.workflow.run',
	'flauz.workflow.list',
] as const;

export type WorkflowCommandId = (typeof COMMAND_IDS)[number];

export interface WorkflowCommandServices {
	readonly workflows: WorkflowService;
	/** Executes recorded tool steps (extension wires the terminal-command executor). */
	readonly executor: ToolExecutorPort;
	/** Human gate for 'ask' mode (extension wires a quick pick; optional in tests). */
	readonly ask?: ApprovalPort;
}

export type WorkflowHandler = (arg: unknown) => Promise<unknown>;

function requireArgs(arg: unknown, command: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
		throw new Error(`flauz.workflow.${command}: expected an argument object with keys ${keys.join(', ')}`);
	}
	const record = arg as Record<string, unknown>;
	for (const key of keys) {
		if (!hasKey(record, key)) {
			throw new Error(`flauz.workflow.${command}: missing required key '${key}'`);
		}
	}
	return record;
}

function requireString(value: unknown, command: string, key: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`flauz.workflow.${command}: '${key}' must be a non-empty string`);
	}
	return value;
}

function optionalApprovalMode(value: unknown): 'replay' | 'ask' | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value !== 'replay' && value !== 'ask') {
		throw new Error(`flauz.workflow.run: 'approvals' must be 'replay' or 'ask' (got ${JSON.stringify(value)})`);
	}
	return value;
}

export interface WorkflowSummary {
	readonly id: string;
	readonly title: string;
	readonly sourceTaskId: string;
	readonly tools: number;
	readonly evidenceRefs: number;
	readonly runs: number;
}

export function summarizeFragment(fragment: WorkflowFragment): WorkflowSummary {
	return {
		id: fragment.id,
		title: fragment.title,
		sourceTaskId: fragment.source.taskId,
		tools: fragment.tools.length,
		evidenceRefs: fragment.evidenceRefs.length,
		runs: fragment.history.length,
	};
}

export function createWorkflowCommandHandlers(services: WorkflowCommandServices): Record<WorkflowCommandId, WorkflowHandler> {
	return {
		'flauz.workflow.save': async arg => {
			const args = requireArgs(arg, 'save', ['taskId']);
			const taskId = requireString(args.taskId, 'save', 'taskId');
			if (args.model !== undefined && (typeof args.model !== 'object' || args.model === null || Array.isArray(args.model))) {
				throw new Error("flauz.workflow.save: 'model' must be an object {provider, model, params?}");
			}
			if (args.rerunApprovals !== undefined && args.rerunApprovals !== 'replay' && args.rerunApprovals !== 'ask') {
				throw new Error(`flauz.workflow.save: 'rerunApprovals' must be 'replay' or 'ask' (got ${JSON.stringify(args.rerunApprovals)})`);
			}
			const saved = await services.workflows.save({
				taskId,
				model: args.model as { provider: string; model: string; params?: Record<string, unknown> } | undefined,
				rerunApprovals: optionalApprovalMode(args.rerunApprovals),
			});
			return { workflowId: saved.workflowId, path: saved.path };
		},
		'flauz.workflow.run': async arg => {
			const args = requireArgs(arg, 'run', ['workflowId']);
			const workflowId = requireString(args.workflowId, 'run', 'workflowId');
			const approvals = optionalApprovalMode(args.approvals);
			const outcome: WorkflowRunOutcome = await services.workflows.run({
				workflowId,
				approvals,
				executor: services.executor,
				ask: services.ask,
			});
			return outcome;
		},
		'flauz.workflow.list': async () => {
			const fragments = await services.workflows.list();
			return { workflows: fragments.map(summarizeFragment) };
		},
	};
}

/** Registers all workflow commands against the ambient vscode (mock in tests). */
export function registerWorkflowCommands(services: WorkflowCommandServices): vscode.Disposable[] {
	const api = vscodeApi();
	const handlers = createWorkflowCommandHandlers(services);
	return COMMAND_IDS.map(id => api.commands.registerCommand(id, handlers[id]));
}
