/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.memory.*` command surface (TL2-003 M1 round-trip commands).
 *
 * Commands carry DATA only - ports (executor/approval) are wired by the
 * extension layer or injected by tests; command args never carry code.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import type { MemoryTier } from './api.ts';
import type { MemoryStore } from './memory.ts';

export const COMMAND_IDS = [
	'flauz.memory.record',
	'flauz.memory.list',
	'flauz.memory.move',
	'flauz.memory.compact',
	'flauz.memory.verify',
	'flauz.memory.index',
] as const;

export type MemoryCommandId = (typeof COMMAND_IDS)[number];

export interface MemoryCommandServices {
	readonly store: MemoryStore;
}

export type MemoryHandler = (arg: unknown) => Promise<unknown>;

function requireArgs(arg: unknown, command: string, keys: readonly string[]): Record<string, unknown> {
	if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
		throw new Error(`flauz.memory.${command}: expected an argument object with keys ${keys.join(', ')}`);
	}
	const record = arg as Record<string, unknown>;
	for (const key of keys) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) {
			throw new Error(`flauz.memory.${command}: missing required key '${key}'`);
		}
	}
	return record;
}

function requireTier(value: unknown, command: string): MemoryTier {
	if (value !== 'session' && value !== 'task' && value !== 'project') {
		throw new Error(`flauz.memory.${command}: tier must be one of session|task|project (got ${JSON.stringify(value)})`);
	}
	return value;
}

function requireActor(value: unknown, command: string): 'agent' | 'human' | 'tool' {
	if (value !== 'agent' && value !== 'human' && value !== 'tool') {
		throw new Error(`flauz.memory.${command}: actor must be one of agent|human|tool (got ${JSON.stringify(value)})`);
	}
	return value;
}

export function registerMemoryCommands(services: MemoryCommandServices): vscode.Disposable[] {
	const api = vscodeApi();
	const handlers: Record<MemoryCommandId, MemoryHandler> = {
		'flauz.memory.record': async arg => {
			const args = requireArgs(arg, 'record', ['tier', 'kind', 'content', 'provenance']);
			const provenance = requireArgs(args.provenance, 'record', ['actor', 'origin', 'ts']);
			const tags = args.tags === undefined ? undefined : args.tags;
			const kind = args.kind;
			if (typeof kind !== 'string') {
				throw new Error('flauz.memory.record: kind must be a string');
			}
			const content = args.content;
			if (typeof content !== 'string') {
				throw new Error('flauz.memory.record: content must be a string');
			}
			return services.store.record(requireTier(args.tier, 'record'), {
				kind: kind as never,
				content,
				...(tags !== undefined ? { tags: tags as readonly string[] } : {}),
				...(Object.prototype.hasOwnProperty.call(args, 'taskId') ? { taskId: args.taskId as string | null } : {}),
				...(Object.prototype.hasOwnProperty.call(args, 'agentId') ? { agentId: args.agentId as string | null } : {}),
				...(Object.prototype.hasOwnProperty.call(args, 'pinned') ? { pinned: args.pinned as boolean } : {}),
				provenance: {
					actor: requireActor(provenance.actor, 'record'),
					origin: provenance.origin as never,
					ts: provenance.ts as number,
					...(Object.prototype.hasOwnProperty.call(provenance, 'evidenceId') ? { evidenceId: provenance.evidenceId as string | null } : {}),
				},
			});
		},
		'flauz.memory.list': async arg => {
			const args = requireArgs(arg === undefined ? {} : arg, 'list', []);
			if (args.tier === undefined) {
				return { records: await services.store.listAll() };
			}
			return { records: await services.store.list(requireTier(args.tier, 'list')) };
		},
		'flauz.memory.move': async arg => {
			const args = requireArgs(arg, 'move', ['recordId', 'toTier', 'reason', 'actor', 'humanApproved']);
			return services.store.move(String(args.recordId), requireTier(args.toTier, 'move'), {
				reason: String(args.reason),
				actor: requireActor(args.actor, 'move'),
				humanApproved: args.humanApproved === true,
			});
		},
		'flauz.memory.compact': async arg => {
			const args = requireArgs(arg, 'compact', ['journal']);
			const promotion = await services.store.compact(String(args.journal));
			return promotion === undefined ? { compacted: false } : { compacted: true, promotion };
		},
		'flauz.memory.verify': async () => services.store.verify(),
		'flauz.memory.index': async () => ({ index: await services.store.index() }),
	};
	const disposables: vscode.Disposable[] = [];
	for (const id of COMMAND_IDS) {
		disposables.push(api.commands.registerCommand(id, handlers[id]));
	}
	return disposables;
}
