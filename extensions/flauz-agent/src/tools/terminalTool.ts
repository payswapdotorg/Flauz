/**
 * The Flauz terminal tool (`flauz_terminal`).
 *
 * Registered via the STABLE `vscode.lm.registerTool` (vscode.d.ts:20778)
 * against the `languageModelTools` package.json contribution. Every
 * invocation goes through `prepareInvocation` returning
 * `confirmationMessages` (vscode.d.ts:21184-21210) — the HumanApproval gate:
 * in a real editor the chat UI asks "Continue / Cancel" before `invoke`
 * runs (the agent-session approval model's WaitingForConfirmation
 * semantics). Execution uses the terminal shell-integration surface
 * (vscode.d.ts:7831-7996): `terminal.shellIntegration.executeCommand(line)`
 * and the `read()` async stream.
 *
 * The terminal factory is injected so tests can supply a fake terminal
 * (mocked exec) while production passes `vscode.window.createTerminal`.
 */

import type * as vscode from 'vscode';

export const TERMINAL_TOOL_ID = 'flauz_terminal';

/** Structural slice of vscode.TerminalShellExecution (read stream). */
export interface TerminalExecutionLike {
	read(): AsyncIterable<string>;
}

/** Structural slice of vscode.TerminalShellIntegration. */
export interface TerminalShellIntegrationLike {
	executeCommand(commandLine: string): TerminalExecutionLike;
}

/** Structural slice of vscode.Terminal. */
export interface TerminalLike {
	readonly name: string;
	readonly shellIntegration: TerminalShellIntegrationLike | undefined;
	show(preserveFocus?: boolean): void;
	dispose(): void;
}

/** Production: `vscode.window.createTerminal({ name })`; tests: fake. */
export type TerminalFactory = (name: string) => TerminalLike;

export interface TerminalToolDeps {
	terminalFactory: TerminalFactory;
	logger?: (message: string) => void;
}

export interface TerminalToolInput {
	command: string;
}

/** Build the LanguageModelTool implementation for `flauz_terminal`. */
export function createTerminalTool(
	deps: TerminalToolDeps,
): vscode.LanguageModelTool<TerminalToolInput> {
	return {
		async prepareInvocation(options): Promise<vscode.PreparedToolInvocation> {
			const command = options.input.command;
			return {
				invocationMessage: `Running \`${command}\` in the terminal`,
				confirmationMessages: {
					title: 'Flauz terminal command',
					message: `Allow Flauz Agent to run \`${command}\` in the integrated terminal?`,
				},
			};
		},
		async invoke(options, token): Promise<vscode.LanguageModelToolResult> {
			const command = options.input.command;
			const terminal = deps.terminalFactory('flauz');
			try {
				if (!terminal.shellIntegration) {
					deps.logger?.(`terminal has no shell integration; refusing to run: ${command}`);
					return {
						content: [
							{ value: `flauz-terminal: no shell integration available on this terminal; command NOT executed: ${command}` },
						],
					};
				}
				terminal.show(true);
				const execution = terminal.shellIntegration.executeCommand(command);
				let output = '';
				for await (const chunk of execution.read()) {
					output += chunk;
					if (token.isCancellationRequested) {
						break;
					}
				}
				return { content: [{ value: output.trim() }] };
			} finally {
				terminal.dispose();
			}
		},
	};
}

/** Structural slice of `vscode.lm.registerTool`. */
export type ToolRegistrar = <T>(
	name: string,
	tool: vscode.LanguageModelTool<T>,
) => { dispose(): void };

/** Register the terminal tool; returns a disposable-like handle. */
export function registerTerminalTool(
	register: ToolRegistrar,
	deps: TerminalToolDeps,
): { dispose(): void } {
	return register(TERMINAL_TOOL_ID, createTerminalTool(deps));
}
