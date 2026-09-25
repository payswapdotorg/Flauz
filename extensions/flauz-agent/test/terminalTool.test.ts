/**
 * Tests for the flauz_terminal tool: registration, HumanApproval
 * confirmation gate, shell-integration execution, and degraded paths.
 */

import { test } from 'node:test';
import { ok, strictEqual, match } from 'node:assert';
import {
	TERMINAL_TOOL_ID,
	createTerminalTool,
	registerTerminalTool,
	type TerminalLike,
	type TerminalFactory,
} from '../src/tools/terminalTool.ts';
import { createMockVscode } from './harness/vscode-mock.ts';

function fakeTerminalFactory(output: string): { factory: TerminalFactory; commands: string[]; disposed: number[]; withShellIntegration: boolean } {
	const commands: string[] = [];
	const disposed: number[] = [];
	let counter = 0;
	const factory: TerminalFactory = (name) => {
		counter += 1;
		const serial = counter;
		const terminal: TerminalLike = {
			name,
			get shellIntegration() {
				return {
					executeCommand(commandLine: string) {
						commands.push(commandLine);
						return {
							read() {
								return (async function* stream() {
									yield output;
								})();
							},
						};
					},
				};
			},
			show() { /* noop */ },
			dispose() {
				disposed.push(serial);
			},
		};
		return terminal;
	};
	return { factory, commands, disposed, withShellIntegration: true };
}

test('registerTerminalTool registers under flauz_terminal via the registrar', () => {
	const { vscode: api, state } = createMockVscode();
	const handle = registerTerminalTool((name, tool) => api.lm.registerTool(name, tool), { terminalFactory: fakeTerminalFactory('x').factory });
	strictEqual(state.tools.length, 1);
	strictEqual(state.tools[0].name, TERMINAL_TOOL_ID);
	ok(!state.tools[0].disposed);
	handle.dispose();
	ok(state.tools[0].disposed, 'dispose unregisters');
});

test('prepareInvocation returns confirmationMessages naming the command (HumanApproval gate)', async () => {
	const tool = createTerminalTool({ terminalFactory: fakeTerminalFactory('').factory });
	const prepared = await tool.prepareInvocation?.({ input: { command: 'echo hi' } }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) });
	ok(prepared && typeof prepared === 'object');
	const confirmation = (prepared as { confirmationMessages?: { title: string; message: string } }).confirmationMessages;
	ok(confirmation, 'confirmationMessages must be present');
	match(confirmation.title, /Flauz terminal command/);
	match(confirmation.message, /echo hi/);
	match(String((prepared as { invocationMessage?: string }).invocationMessage), /Running `echo hi`/);
});

test('invoke executes via shell integration, captures output, disposes the terminal', async () => {
	const fake = fakeTerminalFactory('flauz-golden-path-ok\n');
	const tool = createTerminalTool({ terminalFactory: fake.factory });
	const result = await tool.invoke(
		{ toolInvocationToken: undefined, input: { command: 'echo flauz-golden-path-ok' } },
		{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose() { /* noop */ } }) },
	);
	deepStrictEqualText(result, 'flauz-golden-path-ok');
	strictEqual(fake.commands.length, 1, 'one command executed');
	strictEqual(fake.commands[0], 'echo flauz-golden-path-ok');
	strictEqual(fake.disposed.length, 1, 'terminal disposed after invoke');
});

test('no shell integration -> diagnostic result, command NOT executed; denied confirmation -> rejection', async () => {
	const commands: string[] = [];
	const noShellFactory: TerminalFactory = (name) => ({
		name,
		shellIntegration: undefined,
		show() { /* noop */ },
		dispose() { /* noop */ },
	});
	void commands;
	const tool = createTerminalTool({ terminalFactory: noShellFactory });
	const result = await tool.invoke({ toolInvocationToken: undefined, input: { command: 'rm -rf /' } }, {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose() { /* noop */ } }),
	});
	ok(extractValue(result).includes('no shell integration'), 'diagnostic text');
	ok(extractValue(result).includes('NOT executed'), 'explicitly not executed');

	// Confirmation denial via the mock's invokeTool gate.
	const { vscode: api } = createMockVscode({
		confirmationPolicy: () => false,
	});
	registerTerminalTool((name, candidate) => api.lm.registerTool(name, candidate), { terminalFactory: fakeTerminalFactory('nope').factory });
	let rejected: unknown;
	try {
		await api.lm.invokeTool(TERMINAL_TOOL_ID, { toolInvocationToken: { opaque: true }, input: { command: 'echo nope' } });
	} catch (error) {
		rejected = error;
	}
	ok(rejected instanceof Error);
	match((rejected as Error).message, /rejected by user/);
});

function extractValue(result: unknown): string {
	const content = (result as { content?: Array<{ value?: unknown }> }).content ?? [];
	return content.filter((part) => typeof part.value === 'string').map((part) => String(part.value)).join('');
}

function deepStrictEqualText(result: unknown, expected: string): void {
	strictEqual(extractValue(result), expected);
}
