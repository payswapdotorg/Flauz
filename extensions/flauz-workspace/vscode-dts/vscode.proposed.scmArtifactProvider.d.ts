/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// PROVENANCE: copied verbatim from src/vscode-dts/vscode.proposed.scmArtifactProvider.d.ts @ 9bf9ae764da438b1234a8243dc9e47173ef58ee7 (mirror: github.com/payswapdotorg/Flauz). This PROVENANCE line is the only addition; byte-identity of the remainder is verified via diff (receipt in REPORT.md). Registry entry: src/vs/platform/extensions/common/extensionsApiProposals.ts:414. Proposal enabled for built-ins via product.json extensionEnabledApiProposals (proposed to Worker F, REPORT DL-16).

declare module 'vscode' {
	// https://github.com/microsoft/vscode/issues/253665

	export interface SourceControl {
		artifactProvider?: SourceControlArtifactProvider;
	}

	export interface SourceControlArtifactProvider {
		readonly onDidChangeArtifacts: Event<string[]>;

		provideArtifactGroups(token: CancellationToken): ProviderResult<SourceControlArtifactGroup[]>;
		provideArtifacts(group: string, token: CancellationToken): ProviderResult<SourceControlArtifact[]>;
	}

	export interface SourceControlArtifactGroup {
		readonly id: string;
		readonly name: string;
		readonly icon?: IconPath;
		readonly supportsFolders?: boolean;
	}

	export interface SourceControlArtifact {
		readonly id: string;
		readonly name: string;
		readonly description?: string;
		readonly icon?: IconPath;
		readonly timestamp?: number;
		readonly command?: Command;
	}
}
