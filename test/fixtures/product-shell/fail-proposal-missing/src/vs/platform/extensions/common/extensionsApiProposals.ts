/*---------------------------------------------------------------------------------------------
 *  Fixture copy of the proposal registry shape (real file:
 *  src/vs/platform/extensions/common/extensionsApiProposals.ts — generated TS
 *  object literal; the gate parses the keys of _allApiProposals).
 *--------------------------------------------------------------------------------------------*/

const _allApiProposals = {
	browser: {
		proposal: 'https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.browser.d.ts',
	},
	defaultChatParticipant: {
		proposal: 'https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.defaultChatParticipant.d.ts',
	},
	chatParticipantAdditions: {
		proposal: 'https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.chatParticipantAdditions.d.ts',
	},
	scmArtifactProvider: {
		proposal: 'https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.scmArtifactProvider.d.ts',
	},
	aiTextSearchProvider: {
		proposal: 'https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.aiTextSearchProvider.d.ts',
	}
};
export const allApiProposals = Object.freeze<{ [proposalName: string]: Readonly<{ proposal: string }> }>(_allApiProposals);
export type ApiProposalName = keyof typeof _allApiProposals;
