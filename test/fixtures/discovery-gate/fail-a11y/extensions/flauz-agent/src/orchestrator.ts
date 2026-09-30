// Fixture source: the orchestrator's post-action recovery contract (DA20) —
// a failed verification returns the task to an approvable state and says
// how to retry; an execution failure appends a fail event.
export class Orchestrator {
	private async verify(stream: { markdown(value: string): void }): Promise<void> {
		stream.markdown(
			'Verification failed. Task is back in **execute** — reply `/approve` to retry.',
		);
	}

	private async fail(stream: { markdown(value: string): void }, message: string): Promise<void> {
		await this.appendEvent('agent', { type: 'fail', payload: { error: message } });
		stream.markdown(`Execution failed: ${message}`);
	}

	private async appendEvent(actor: string, event: object): Promise<void> {
		// journaled
	}
}
