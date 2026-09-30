// Fixture source: the terminal tool's HumanApproval confirmation (DA15) —
// the message names the exact command being approved.
export const TERMINAL_TOOL_ID = 'flauz_terminal';

export function createTerminalTool(): object {
	return {
		async prepareInvocation(options: { input: { command: string } }): Promise<object> {
			const command = options.input.command;
			return {
				invocationMessage: `Running \`${command}\` in the terminal`,
				confirmationMessages: {
					title: 'Flauz terminal command',
					message: `Allow Flauz Agent to run \`${command}\` in the integrated terminal?`,
				},
			};
		},
	};
}
