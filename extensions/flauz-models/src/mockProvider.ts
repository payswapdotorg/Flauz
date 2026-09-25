/**
 * flauz-mock: a deterministic, CI-friendly echo language model provider.
 *
 * Serves exactly one model (`echo-1`) under the `flauz-mock` vendor. Every
 * response is the fixed string `flauz-mock echo: <last user text>` streamed
 * in deterministic word-grouped chunks. No network, no entitlement, no
 * wall-clock and no randomness: identical requests always produce identical
 * streams, so tests and the golden path can assert exact outputs.
 *
 * API ground truth (vendored vscode-dts/vscode.d.ts @ 9bf9ae764da):
 * - LanguageModelChatProvider<T> ................ vscode.d.ts:20687-20722
 * - LanguageModelChatInformation ................. vscode.d.ts:20584-20633
 * - LanguageModelChatRequestMessage .............. vscode.d.ts:20652-20671
 * - LanguageModelTextPart ....................... vscode.d.ts:20967-20981
 * - LanguageModelChatMessageRole.User = 1 ........ vscode.d.ts:20130-20134
 */

import type * as vscode from 'vscode';

/** Vendor id this provider is registered under. Must match the `languageModelChatProviders` contribution in package.json. */
export const MOCK_VENDOR_ID = 'flauz-mock';

/** The single model served by this provider (documented metadata, asserted by tests). */
export const ECHO_MODEL_INFO: vscode.LanguageModelChatInformation = {
	id: 'echo-1',
	name: 'Flauz Mock Echo',
	family: 'flauz-echo',
	version: '1',
	maxInputTokens: 8192,
	maxOutputTokens: 4096,
	capabilities: {},
};

/**
 * Maximum number of words packed into one streamed chunk. Kept small (3) so
 * even modest prompts exercise multi-chunk streaming in tests and CI; any
 * positive value preserves the contract (deterministic, >= 1 chunk,
 * concatenation reproduces the full echo string).
 */
const WORDS_PER_CHUNK = 3;

/**
 * LanguageModelChatMessageRole.User === 1 (vscode.d.ts:20134). Declared as a
 * number constant because this repo's .ts sources are limited to erasable
 * syntax (Node type stripping) and therefore never reference enum VALUES.
 */
const ROLE_USER: vscode.LanguageModelChatMessageRole = 1;

/**
 * Builds the deterministic chunk list the echo model streams for a prompt.
 * Chunks are word groups; concatenating them reproduces the full echo string
 * byte-for-byte (whitespace is preserved, never normalized). An empty prompt
 * echoes the fixed placeholder text `(empty prompt)`.
 */
export function buildEchoResponse(prompt: string): string[] {
	const full = `flauz-mock echo: ${prompt.length > 0 ? prompt : '(empty prompt)'}`;
	// Split into "word + following whitespace" pieces so that joining all
	// chunks reproduces `full` exactly. The full string always starts with
	// the non-whitespace "flauz-mock", so no leading whitespace is dropped.
	const pieces = full.match(/\S+\s*/g) ?? [];
	const chunks: string[] = [];
	for (let i = 0; i < pieces.length; i += WORDS_PER_CHUNK) {
		chunks.push(pieces.slice(i, i + WORDS_PER_CHUNK).join(''));
	}
	return chunks;
}

/**
 * Structural check for LanguageModelTextPart. Text parts carry `value: string`
 * and — unlike tool call parts (callId/name/input), tool result parts
 * (callId/content) and data parts (mimeType/data) — no other marker
 * (vscode.d.ts:20967-20981). Prompt-tsx parts also carry a `value`, but as a
 * non-string renderElementJSON result in practice, so the string check
 * excludes them.
 */
function isTextPart(part: unknown): part is { value: string } {
	return typeof part === 'object' && part !== null && typeof (part as { value?: unknown }).value === 'string';
}

/**
 * Extracts the concatenated text of the LAST User-role message (empty string
 * when there is no user message).
 */
function lastUserText(messages: readonly vscode.LanguageModelChatRequestMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== ROLE_USER) {
			continue;
		}
		let text = '';
		for (const part of message.content) {
			if (isTextPart(part)) {
				text += part.value;
			}
		}
		return text;
	}
	return '';
}

/**
 * Creates the deterministic flauz-mock echo provider (stable API surface
 * `vscode.LanguageModelChatProvider`, vscode.d.ts:20687-20722).
 *
 * - `provideLanguageModelChatInformation` always returns the single echo-1
 *   model, regardless of `options.silent`.
 * - `provideLanguageModelChatResponse` streams `flauz-mock echo: <last user
 *   text>` in deterministic chunks, yielding a microtask between reports and
 *   stopping early once the token is cancelled. Unknown model ids still echo
 *   (deterministic, never throws in v0).
 * - `provideTokenCount` returns a deterministic character-count approximation
 *   (a real tokenizer is model-specific and out of scope for a mock vendor).
 */
export function createMockProvider(): vscode.LanguageModelChatProvider {
	return {
		provideLanguageModelChatInformation(_options, _token) {
			return [ECHO_MODEL_INFO];
		},
		async provideLanguageModelChatResponse(_model, messages, _options, progress, token) {
			const chunks = buildEchoResponse(lastUserText(messages));
			for (const chunk of chunks) {
				if (token.isCancellationRequested) {
					return; // cancelled — stop streaming early
				}
				// LanguageModelTextPart-shaped part: plain `{ value }`, no discriminant.
				progress.report({ value: chunk });
				await Promise.resolve(); // yield between chunks so cancellation is observable
			}
		},
		async provideTokenCount(_model, text, _token) {
			// Deterministic approximation: one "token" per character (see doc comment above).
			if (typeof text === 'string') {
				return text.length;
			}
			let total = 0;
			for (const part of text.content) {
				if (isTextPart(part)) {
					total += part.value.length;
				}
			}
			return total;
		},
	};
}
