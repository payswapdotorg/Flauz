/**
 * Fidelity-mapped mock of the (small) vscode API surface this extension uses.
 *
 * Types come from the vendored vscode.d.ts via `import type` (erased at
 * runtime by Node's type stripping); the values here are hand-rolled test
 * doubles. Nothing in this file touches the real editor.
 */

import type * as vscode from 'vscode';

/** A no-op vscode.Disposable. */
function noopDisposable(): vscode.Disposable {
	return { dispose(): void { /* intentional no-op */ } };
}

/** A recorded `lm.registerLanguageModelChatProvider` call. */
export interface MockRegistration {
	readonly vendor: string;
	readonly provider: vscode.LanguageModelChatProvider;
	disposed: boolean;
}

/**
 * Structural mock of `vscode.lm` — only `registerLanguageModelChatProvider`
 * is used by flauz-models v0. Registrations are recorded (most recent last)
 * and the returned disposable flips `disposed` instead of deleting the
 * record, so tests can observe both registration and disposal.
 */
export interface MockLm {
	registerLanguageModelChatProvider(vendor: string, provider: vscode.LanguageModelChatProvider): vscode.Disposable;
	/** Test-harness only: recorded registrations, most recent last. */
	readonly registrations: readonly MockRegistration[];
	/** Test-harness only: clears the recorded registrations. */
	reset(): void;
}

export function createMockLm(): MockLm {
	const registrations: MockRegistration[] = [];
	return {
		registrations,
		reset() {
			registrations.length = 0;
		},
		registerLanguageModelChatProvider(vendor, provider) {
			const registration: MockRegistration = { vendor, provider, disposed: false };
			registrations.push(registration);
			return {
				dispose() {
					registration.disposed = true;
				},
			};
		},
	};
}

/**
 * Deterministic CancellationToken double. Tests flip `isCancellationRequested`
 * by hand (directly, or from collectStream's onPart probe) — no timers, no
 * races. `onCancellationRequested` is a no-op event for interface fidelity.
 */
export class MockCancellationToken implements vscode.CancellationToken {
	isCancellationRequested = false;
	readonly onCancellationRequested: vscode.Event<any> = () => noopDisposable();
}

/** Deterministic CancellationTokenSource double (mirrors vscode.CancellationTokenSource). */
export class MockCancellationTokenSource implements vscode.CancellationTokenSource {
	readonly token: MockCancellationToken = new MockCancellationToken();
	cancel(): void {
		this.token.isCancellationRequested = true;
	}
	dispose(): void { /* intentional no-op */ }
}

/** The ExtensionContext slice that activate() uses. */
export interface MockExtensionContext {
	subscriptions: Array<{ dispose(): void }>;
}

export function createMockContext(): MockExtensionContext {
	return { subscriptions: [] };
}

/**
 * LanguageModelChatMessageRole.User === 1 and .Assistant === 2
 * (vscode.d.ts:20130-20140), as erasable-syntax constants.
 */
const ROLE_USER: vscode.LanguageModelChatMessageRole = 1;
const ROLE_ASSISTANT: vscode.LanguageModelChatMessageRole = 2;

/** Builds a User-role request message carrying a single text part. */
export function userMessage(text: string): vscode.LanguageModelChatRequestMessage {
	return { role: ROLE_USER, content: [{ value: text }], name: undefined };
}

/** Builds an Assistant-role request message carrying a single text part. */
export function assistantMessage(text: string): vscode.LanguageModelChatRequestMessage {
	return { role: ROLE_ASSISTANT, content: [{ value: text }], name: undefined };
}

/** LanguageModelChatToolMode.Auto === 1 (vscode.d.ts:20904), as an erasable-syntax constant. */
const TOOL_MODE_AUTO: vscode.LanguageModelChatToolMode = 1;

/**
 * Drives `provideLanguageModelChatResponse` with a Progress that collects the
 * text of every LanguageModelTextPart-shaped part and returns the
 * concatenated stream. The model is taken from the provider's own
 * `provideLanguageModelChatInformation`. `onPart` (optional) is invoked
 * synchronously after each reported part — tests use it to flip a
 * cancellation token mid-stream deterministically.
 */
export async function collectStream(
	provider: vscode.LanguageModelChatProvider,
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	token: vscode.CancellationToken,
	onPart?: (part: vscode.LanguageModelResponsePart) => void,
): Promise<string> {
	const models = (await provider.provideLanguageModelChatInformation({ silent: true }, token)) ?? [];
	const model = models[0];
	if (!model) {
		throw new Error('collectStream: provider did not report any model');
	}
	const text: string[] = [];
	const progress: vscode.Progress<vscode.LanguageModelResponsePart> = {
		report(part) {
			// Same structural text-part check the mock provider uses (no discriminant).
			if (typeof (part as { value?: unknown }).value === 'string') {
				text.push((part as { value: string }).value);
			}
			onPart?.(part);
		},
	};
	await provider.provideLanguageModelChatResponse(model, messages, { toolMode: TOOL_MODE_AUTO }, progress, token);
	return text.join('');
}
