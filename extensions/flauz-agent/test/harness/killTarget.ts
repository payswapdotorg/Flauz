/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The kill-matrix target (TL2-001 M1). Spawned by
 * test/orchestration.killRecover.test.ts via process.execPath; executes a
 * scripted scenario op-by-op against a real OrchestrationStore with a
 * phase-gate protocol so the parent can SIGKILL at an EXACT point:
 *
 *   target -> parent:  READY\t<opIndex>\t<opName>     (paused BEFORE the op)
 *   parent -> target:  go\n                           (release one op)
 *   target -> parent:  DONE\t<opIndex>                 (op's rows are on disk)
 *   target -> parent:  SCENARIO-COMPLETE              (all ops done; exits)
 *
 * The plan file (argv[3]) carries {ops, clockBase}; the effect sink log
 * lives at <root>/effect-sink.jsonl and survives the kill.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OrchestrationStore } from '../../core/orchStore.mjs';
import { executeOp, freshContext, FileEffectSink, makeClock, type ScenarioOp } from './orchWorkspace.ts';

interface Plan {
	ops: ScenarioOp[];
	clockBase: number;
}

async function main(): Promise<void> {
	const root = process.argv[2];
	const planFile = process.argv[3];
	if (typeof root !== 'string' || typeof planFile !== 'string') {
		process.stderr.write('usage: node killTarget.ts <workspaceRoot> <planFile>\n');
		process.exit(2);
	}
	const plan = JSON.parse(readFileSync(planFile, 'utf-8')) as Plan;
	const { clock } = makeClock(plan.clockBase);
	const store = new OrchestrationStore(root, { clock });
	const sink = new FileEffectSink(join(root, 'effect-sink.jsonl'));
	const ctx = freshContext();

	const send = (line: string): void => {
		process.stdout.write(`${line}\n`);
	};

	let buffer = '';
	let released = false;
	let resolveGate: (() => void) | undefined;

	const waitForGo = async (): Promise<void> => {
		if (released) {
			released = false;
			return;
		}
		await new Promise<void>((resolve) => {
			resolveGate = resolve;
		});
	};

	process.stdin.setEncoding('utf-8');
	process.stdin.on('data', (chunk: string) => {
		buffer += chunk;
		let newline = buffer.indexOf('\n');
		while (newline !== -1) {
			const line = buffer.slice(0, newline).trim();
			buffer = buffer.slice(newline + 1);
			if (line === 'go' && resolveGate !== undefined) {
				const resolve = resolveGate;
				resolveGate = undefined;
				resolve();
			}
			newline = buffer.indexOf('\n');
		}
	});

	for (let index = 0; index < plan.ops.length; index += 1) {
		const op = plan.ops[index];
		send(`READY\t${String(index)}\t${op.op}`);
		await waitForGo();
		await executeOp(store, sink, op, ctx);
		send(`DONE\t${String(index)}`);
	}
	send('SCENARIO-COMPLETE');
	process.stdin.resume();
	// Give the parent a moment, then exit cleanly (it may also SIGKILL us).
	setTimeout(() => process.exit(0), 50).unref?.();
	process.stdin.on('end', () => process.exit(0));
}

main().catch((error: unknown) => {
	process.stderr.write(`killTarget failed: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
});
