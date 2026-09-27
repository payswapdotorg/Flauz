/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the vscode glue for adapter-backed providers (M2).
 *
 * Maps the neutral adapter contract ONTO the stable vscode language-model
 * surfaces (vendored vscode.d.ts): a ProviderAdapter becomes a
 * vscode.LanguageModelChatProvider. The native API stays authoritative --
 * this file only translates shapes:
 *
 *   vscode.LanguageModelChatRequestMessage -> neutral ChatMessage
 *     (role 1=User / 2=Assistant; parts {value} / {callId,name,input} /
 *      {callId,content} / {mimeType,data})
 *   vscode.LanguageModelChatTool -> neutral ChatToolDefinition
 *   ProviderStreamEvent -> vscode.ChatResponsePart reports
 *     (text-delta -> LanguageModelTextPart {value};
 *      tool-input-start/delta/end accumulate and emit ONE
 *      LanguageModelToolCallPart {callId, name, input} per call)
 *   CancellationToken -> AbortSignal (cooperative, honored between events
 *     and through the HTTP port; cancellation resolves quietly -- never a
 *     user-visible error)
 *
 * This module imports 'vscode' TYPE-ONLY (erasable), so the bridge is
 * testable under plain `node --test` without the module redirect harness.
 */

import type * as vscode from 'vscode';
import { ProviderError } from '../contract/errors.ts';
import type { ChatInputPart, ChatMessage, ChatRequest, ChatToolDefinition, ProviderAdapter, ProviderStreamEvent } from '../contract/types.ts';

/** vscode.LanguageModelChatMessageRole.User === 1 (vscode.d.ts:20135). */
const ROLE_USER = 1;
/** vscode.LanguageModelChatMessageRole.Assistant === 2 (vscode.d.ts:20140). */
const ROLE_ASSISTANT = 2;
/** vscode.LanguageModelChatToolMode.Required === 2 (vscode.d.ts:20909). */
const TOOL_MODE_REQUIRED = 2;

/** Structural slice of the vscode parts the bridge converts (they carry no discriminants). */
type VscodePartLike = { value?: unknown; callId?: unknown; name?: unknown; input?: unknown; content?: unknown; mimeType?: unknown; data?: unknown };

function isTextPart(part: VscodePartLike): part is { value: string } {
	return typeof part.value === 'string' && part.mimeType === undefined && part.callId === undefined;
}

function isToolCallPart(part: VscodePartLike): part is { callId: string; name: string; input: unknown } {
	return typeof part.callId === 'string' && typeof part.name === 'string';
}

function isToolResultPart(part: VscodePartLike): part is { callId: string; content: ReadonlyArray<{ value?: unknown; mimeType?: unknown; data?: unknown }> } {
	return typeof part.callId === 'string' && part.name === undefined && Array.isArray(part.content);
}

function isDataPart(part: VscodePartLike): part is { mimeType: string; data: Uint8Array } {
	return typeof part.mimeType === 'string' && part.data instanceof Uint8Array;
}

/** Converts one vscode message part into the neutral tagged shape (unknown parts become explicit markers). */
export function toNeutralPart(part: VscodePartLike): ChatInputPart {
	if (isTextPart(part)) {
		return { kind: 'text', value: part.value };
	}
	if (isToolCallPart(part)) {
		return { kind: 'toolCall', callId: part.callId, toolName: part.name, input: part.input };
	}
	if (isToolResultPart(part)) {
		return {
			kind: 'toolResult',
			callId: part.callId,
			content: part.content.map(content => {
				if (typeof (content as { value?: unknown }).value === 'string') {
					return { kind: 'text' as const, value: (content as { value: string }).value };
				}
				const data = content as { mimeType?: unknown; data?: unknown };
				if (typeof data.mimeType === 'string' && data.data instanceof Uint8Array) {
					return { kind: 'data' as const, mimeType: data.mimeType, data: data.data };
				}
				return { kind: 'text' as const, value: '[unrecognized tool result part]' };
			}),
		};
	}
	if (isDataPart(part)) {
		return { kind: 'data', mimeType: part.mimeType, data: part.data };
	}
	return { kind: 'text', value: '[unrecognized part]' };
}

/** Converts a vscode request-message list into the neutral ChatMessage list (exported for tests). */
export function toNeutralMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
	return messages.map(message => ({
		role: message.role === ROLE_ASSISTANT ? 'assistant' : 'user',
		content: (message.content as readonly VscodePartLike[]).map(toNeutralPart),
		...(message.name === undefined || message.name === '' ? {} : { name: message.name }),
	}));
}

/** Converts vscode tool declarations into neutral tool definitions (exported for tests). */
export function toNeutralTools(tools: readonly vscode.LanguageModelChatTool[] | undefined): ChatToolDefinition[] | undefined {
	if (tools === undefined) {
		return undefined;
	}
	return tools.map(tool => ({ name: tool.name, description: tool.description, inputJsonSchema: tool.inputSchema ?? { type: 'object' } }));
}

/** Builds the neutral ChatRequest from a vscode provider call (exported for tests). */
export function toNeutralRequest(model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], options: vscode.ProvideLanguageModelChatResponseOptions | undefined): ChatRequest {
	return {
		modelId: model.id,
		messages: toNeutralMessages(messages),
		tools: toNeutralTools(options?.tools),
		...(options === undefined || options.toolMode === undefined || options.toolMode === TOOL_MODE_REQUIRED ? {} : { toolMode: 'auto' as const }),
		...(options === undefined || options.toolMode === undefined ? {} : (options.toolMode === TOOL_MODE_REQUIRED ? { toolMode: 'required' as const } : { toolMode: 'auto' as const })),
	};
}

/** Accumulator for one streamed tool call (fragments arrive as JSON text). */
interface ToolCallAccumulator {
	readonly callId: string;
	toolName: string;
	fragments: string[];
}

/**
 * Creates the vscode.LanguageModelChatProvider backed by a ProviderAdapter.
 * All wire traffic flows through the adapter's injected ports; this glue only
 * translates. Failures throw (the chat UI surfaces provider errors);
 * cancellation resolves quietly per the provider contract.
 */
export function createAdapterBackedProvider(deps: { readonly adapter: ProviderAdapter; readonly logger?: (message: string) => void }): vscode.LanguageModelChatProvider {
	const { adapter, logger } = deps;
	return {
		async provideLanguageModelChatInformation(_options, _token) {
			return adapter.models().map(model => ({
				id: model.modelId,
				name: model.modelName,
				family: model.family,
				version: model.version,
				// Conservative documented input bound: window minus the declared
				// max output (the M4 budget compiler refines reservations per policy).
				maxInputTokens: Math.max(1, model.contextWindowTokens - model.maxOutputTokens),
				maxOutputTokens: model.maxOutputTokens,
				capabilities: {
					...(model.toolCalling === false ? {} : { toolCalling: model.toolCalling }),
					...(model.inputModalities.includes('image') ? { imageInput: true } : {}),
				},
			}));
		},
		async provideLanguageModelChatResponse(model, messages, options, progress, token) {
			const request = toNeutralRequest(model, messages, options);
			const controller = new AbortController();
			const cancelSubscription = token.onCancellationRequested(() => controller.abort());
			const toolCalls = new Map<string, ToolCallAccumulator>();
			try {
				for await (const event of adapter.stream(request, { signal: controller.signal, purpose: 'vscode-chat' })) {
					if (token.isCancellationRequested) {
						return;
					}
					reportEvent(event, progress, toolCalls, adapter.descriptor.providerId);
				}
			} catch (error) {
				if (error instanceof ProviderError && error.code === 'CANCELLED') {
					return; // cancellation resolves quietly per the provider contract
				}
				throw toVscodeError(error, adapter.descriptor.providerId);
			} finally {
				cancelSubscription.dispose();
			}
		},
		async provideTokenCount(_model, text, _token) {
			if (typeof text === 'string') {
				return adapter.estimateTokens(text);
			}
			return adapter.estimateTokens(toNeutralMessages([text]));
		},
	};
}

/** Maps one adapter event onto vscode progress reports (tool calls accumulate into one part). */
function reportEvent(event: ProviderStreamEvent, progress: vscode.Progress<vscode.LanguageModelResponsePart>, toolCalls: Map<string, ToolCallAccumulator>, providerId: string): void {
	if (event.type === 'text-delta') {
		progress.report({ value: event.text });
		return;
	}
	if (event.type === 'tool-input-start') {
		toolCalls.set(event.callId, { callId: event.callId, toolName: event.toolName, fragments: [] });
		return;
	}
	if (event.type === 'tool-input-delta') {
		const open = toolCalls.get(event.callId);
		if (open !== undefined) {
			open.fragments.push(event.fragment);
		}
		return;
	}
	if (event.type === 'tool-input-end') {
		const open = toolCalls.get(event.callId);
		if (open !== undefined) {
			toolCalls.delete(open.callId);
			const joined = open.fragments.join('');
			let parsed: unknown;
			try {
				parsed = joined.length === 0 ? {} : JSON.parse(joined);
			} catch {
				throw new ProviderError('MALFORMED_RESPONSE', `tool '${open.toolName}' streamed arguments that are not JSON: ${joined.slice(0, 120)}`, { providerId, modelId: undefined });
			}
			if (parsed === null || typeof parsed !== 'object') {
				throw new ProviderError('MALFORMED_RESPONSE', `tool '${open.toolName}' streamed a non-object input (vscode tool inputs are JSON objects)`, { providerId, modelId: undefined });
			}
			progress.report({ callId: open.callId, name: open.toolName, input: parsed });
		}
		return;
	}
	// usage + finish carry accounting/provenance; the vscode provider surface
	// has no part for them (they are consumed through the routing/budget seams)
}

/** Converts an adapter failure into the user-facing error the chat UI shows. */
export function toVscodeError(error: unknown, providerId: string): Error {
	if (error instanceof ProviderError) {
		const retry = error.retryable ? `retryable (${error.retryClass})` : 'not retryable';
		return new Error(`[${providerId}] ${error.code} -- ${retry}: ${error.message}`);
	}
	return new Error(`[${providerId}] unexpected provider failure: ${error instanceof Error ? error.message : String(error)}`);
}
