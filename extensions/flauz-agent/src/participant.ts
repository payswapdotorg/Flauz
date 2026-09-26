/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.agent` chat participant (DL-3: Flauz's own participant, not a
 * Copilot fork). The participant itself is contributed STATICALLY in
 * package.json (contributes.chatParticipants with isDefault — the default-
 * agent mechanism, gated on the defaultChatParticipant proposal force-enabled
 * via the product overlay per DL-4); this module provides the runtime
 * handler through the STABLE `vscode.chat.createChatParticipant`
 * (vscode.d.ts:20124).
 */

import type * as vscode from 'vscode';
import { Orchestrator } from './orchestrator.ts';
import type { ModelSelection } from './models.ts';

export const PARTICIPANT_ID = 'flauz.agent';

export interface ParticipantRequest {
	prompt: string;
	requestId: string;
	toolInvocationToken: unknown;
}

export interface ParticipantDeps {
	orchestrator: Orchestrator;
	getModelSelection: () => ModelSelection;
	logger?: (message: string) => void;
}

let requestCounter = 0;

function nextRequestId(): string {
	requestCounter += 1;
	return `req-${String(requestCounter).padStart(4, '0')}`;
}

/** Build the ChatRequestHandler that routes turns to the orchestrator. */
export function createParticipantHandler(deps: ParticipantDeps): vscode.ChatRequestHandler {
	return async (request, _context, stream, _token) => {
		const participantRequest: ParticipantRequest = {
			prompt: request.prompt,
			requestId: nextRequestId(),
			toolInvocationToken: request.toolInvocationToken,
		};
		if (typeof request.command === 'string' && request.command.length > 0) {
			await deps.orchestrator.handleCommand(request.command, participantRequest, stream);
		} else {
			await deps.orchestrator.handlePrompt(participantRequest, stream);
		}
		return {};
	};
}

/** Structural slice of `vscode.chat.createChatParticipant`. */
export type ParticipantRegistrar = (
	id: string,
	handler: vscode.ChatRequestHandler,
) => {
	followupProvider?: vscode.ChatFollowupProvider;
	dispose(): void;
};

/** Register the participant with followups for the four human gates. */
export function registerParticipant(
	register: ParticipantRegistrar,
	deps: ParticipantDeps,
): { dispose(): void } {
	const participant = register(PARTICIPANT_ID, createParticipantHandler(deps));
	participant.followupProvider = {
		provideFollowups() {
			return [
				{ prompt: 'approve', command: 'approve', label: 'Approve plan' },
				{ prompt: 'request changes', command: 'request-changes', label: 'Request changes' },
				{ prompt: 'sign off', command: 'sign-off', label: 'Sign off' },
				{ prompt: 'cancel', command: 'cancel', label: 'Cancel task' },
			];
		},
	};
	return { dispose: () => participant.dispose() };
}
