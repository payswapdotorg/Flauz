// Fixture source: the participant followups (the four human-gate buttons — DA15).
export const PARTICIPANT_ID = 'flauz.agent';

export function registerParticipant(register: (id: string, handler: unknown) => { followupProvider?: object; dispose(): void }): { dispose(): void } {
	const participant = register(PARTICIPANT_ID, {});
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
