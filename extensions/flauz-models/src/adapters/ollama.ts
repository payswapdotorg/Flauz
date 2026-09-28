/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the Ollama-style local-model adapter (M2).
 *
 * Speaks the Ollama chat wire shape (POST {base}/api/chat, NDJSON streaming
 * -- one JSON object per line, `done: true` terminator carrying
 * prompt_eval_count / eval_count usage; tools as function declarations;
 * images as base64 `images` fields) through the injected HttpPort.
 * "Ollama-style" is the wire CONTRACT this adapter speaks: FIXTURE-VERIFIED
 * against local fixture servers; a real local daemon (or any
 * NDJSON-compatible endpoint) is a live integration to verify separately.
 *
 * Ollama tool calls carry NO call ids on the wire; this adapter synthesizes
 * deterministic ones (`<toolName>#<ordinal>`) so the neutral contract (and
 * the vscode tool surfaces it maps onto) keep their callId discipline. The
 * ordinal is the position of the call within the response, so identical
 * wire responses produce identical call ids.
 *
 * No credential by design (local daemon); health probe: GET {base}/api/tags.
 */

import { ProviderError } from '../contract/errors.ts';
import type { HttpPortResponse } from '../contract/ports.ts';
import { buildProvenance, estimateMessageTokens, estimateRequestTokens, estimateTextTokens } from '../contract/canonical.ts';
import type { ChatInputPart, ChatMessage, ChatRequest, ChatToolDefinition, FinishReason, HealthReport, ModelDescriptor, ProviderCapabilities, ProviderStreamEvent, RequestContext } from '../contract/types.ts';
import type { ProviderAdapter } from '../contract/types.ts';
import {
	ADAPTER_VERSION,
	classifyHttpStatus,
	DEFAULT_HEALTH_TIMEOUT_MS,
	DEFAULT_REQUEST_TIMEOUT_MS,
	descriptorFrom,
	IncrementalDecoder,
	joinUrl,
	mapTransportError,
	NdjsonStreamParser,
	readErrorBody,
	throwIfCancelled,
	timedHealth,
	toBase64,
	type AdapterDeps,
} from './common.ts';

export interface OllamaWireToolCall {
	readonly function: { readonly name: string; readonly arguments: unknown };
}

export interface OllamaWireMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string;
	readonly images?: readonly string[];
	readonly tool_calls?: readonly OllamaWireToolCall[];
	readonly tool_name?: string;
}

export interface OllamaWireTool {
	readonly type: 'function';
	readonly function: { readonly name: string; readonly description?: string; readonly parameters: unknown };
}

/** The request body this adapter POSTs (exported pure mapping for fixture assertions). */
export interface OllamaWireRequestBody {
	readonly model: string;
	readonly messages: readonly OllamaWireMessage[];
	readonly tools?: readonly OllamaWireTool[];
	readonly stream: true;
	readonly options?: { readonly temperature?: number; readonly num_predict?: number };
	readonly stop?: readonly string[];
}

/** Maps neutral message content into the Ollama message shape. */
function mapMessage(message: ChatMessage): OllamaWireMessage {
	if (message.role === 'assistant') {
		const toolCalls: OllamaWireToolCall[] = [];
		let text = '';
		const images: string[] = [];
		for (const part of message.content) {
			if (part.kind === 'text') {
				text += part.value;
			} else if (part.kind === 'data' && part.mimeType.startsWith('image/')) {
				images.push(toBase64(part.data));
			} else if (part.kind === 'toolCall') {
				toolCalls.push({ function: { name: part.toolName, arguments: part.input ?? {} } });
			}
		}
		return { role: 'assistant', content: text, ...(images.length === 0 ? {} : { images }), ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }) };
	}
	if (message.role === 'user') {
		let text = '';
		const images: string[] = [];
		const toolResults: string[] = [];
		const toolNames: string[] = [];
		for (const part of message.content) {
			if (part.kind === 'text') {
				text += part.value;
			} else if (part.kind === 'data' && part.mimeType.startsWith('image/')) {
				images.push(toBase64(part.data));
			} else if (part.kind === 'toolResult') {
				// role:'tool' messages carry one result each on this wire
				toolResults.push(part.content.map(content => (content.kind === 'text' ? content.value : `[data part: ${content.mimeType}]`)).join(''));
			}
		}
		if (toolResults.length > 0) {
			// a user message with tool results maps to one tool message per result;
			// callers keep 1:1 by construction (the bridge sends one result per message)
			return { role: 'tool', content: toolResults.join('\n'), ...(images.length === 0 ? {} : { images }), ...(toolNames.length === 0 ? {} : { tool_name: toolNames[0] }) };
		}
		return { role: 'user', content: text, ...(images.length === 0 ? {} : { images }) };
	}
	// system
	let text = '';
	for (const part of message.content) {
		if (part.kind === 'text') {
			text += part.value;
		}
	}
	return { role: 'system', content: text };
}

/**
 * Maps a neutral ChatRequest into the Ollama chat wire body. Multi-result
 * user messages split into consecutive role:'tool' messages (one per tool
 * result part); plain user content stays one message.
 */
export function buildOllamaRequestBody(request: ChatRequest): OllamaWireRequestBody {
	const messages: OllamaWireMessage[] = [];
	for (const message of request.messages) {
		const toolResultCount = message.content.filter((part: ChatInputPart) => part.kind === 'toolResult').length;
		if (message.role === 'user' && toolResultCount > 0) {
			let pendingText = '';
			for (const part of message.content) {
				if (part.kind === 'text') {
					pendingText += part.value;
				}
			}
			for (const part of message.content) {
				if (part.kind === 'toolResult') {
					const contentText = part.content.map(content => (content.kind === 'text' ? content.value : `[data part: ${content.mimeType}]`)).join('');
					messages.push({ role: 'tool', content: contentText });
				}
			}
			if (pendingText.length > 0) {
				messages.push({ role: 'user', content: pendingText });
			}
			continue;
		}
		messages.push(mapMessage(message));
	}
	const tools: OllamaWireTool[] | undefined = request.tools === undefined ? undefined : request.tools.map((tool: ChatToolDefinition) => ({
		type: 'function',
		function: { name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), parameters: tool.inputJsonSchema },
	}));
	return {
		model: request.modelId,
		messages,
		...(tools === undefined ? {} : { tools }),
		stream: true,
		...(request.temperature === undefined && request.maxOutputTokens === undefined ? {} : { options: { ...(request.temperature === undefined ? {} : { temperature: request.temperature }), ...(request.maxOutputTokens === undefined ? {} : { num_predict: request.maxOutputTokens }) } }),
		...(request.stopSequences === undefined || request.stopSequences.length === 0 ? {} : { stop: request.stopSequences }),
	};
}

function mapDoneReason(reason: string | undefined, sawToolCalls: boolean): FinishReason {
	if (sawToolCalls) {
		return 'tool-calls';
	}
	if (reason === 'stop' || reason === undefined) {
		return 'stop';
	}
	if (reason === 'length') {
		return 'length';
	}
	return 'other';
}

/** Builds the adapter. All effects arrive through the injected deps. */
export function createOllamaAdapter(deps: AdapterDeps): ProviderAdapter {
	const descriptor = descriptorFrom(deps.config, 'ollama-chat', 'local');
	const requestTimeoutMs = deps.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const healthTimeoutMs = deps.config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
	const modelIndex = new Map<string, ModelDescriptor>(deps.config.models.map(model => [model.modelId, model]));

	async function issueError(response: HttpPortResponse, modelId: string | undefined): Promise<ProviderError> {
		const bodyText = await readErrorBody(response);
		const message = extractOllamaErrorMessage(bodyText) || `ollama: HTTP ${response.status}`;
		return classifyHttpStatus(response.status, undefined, deps.config.providerId, modelId, message);
	}

	return {
		descriptor,
		models(): readonly ModelDescriptor[] {
			return deps.config.models;
		},
		capabilities(modelId: string): ProviderCapabilities | undefined {
			const model = modelIndex.get(modelId);
			if (model === undefined) {
				return undefined;
			}
			return {
				wireFamily: 'ollama-chat',
				inputModalities: model.inputModalities,
				outputModalities: ['text'],
				contextWindowTokens: model.contextWindowTokens,
				maxOutputTokens: model.maxOutputTokens,
				streaming: true,
				toolCalling: model.toolCalling,
				tokenCounting: 'both',
				locality: 'local',
				...(model.cost === undefined ? {} : { cost: model.cost }),
			};
		},
		async health(context?: RequestContext): Promise<HealthReport> {
			return timedHealth(deps.config.providerId, deps.clock, async () => {
				try {
					const response = await deps.http.request({ method: 'GET', url: joinUrl(deps.config.baseUrl, '/api/tags'), headers: { 'Content-Type': 'application/json' }, timeoutMs: healthTimeoutMs, ...(context?.signal === undefined ? {} : { signal: context.signal }) });
					if (response.status === 200) {
						return { status: 'healthy', detail: 'GET /api/tags returned 200' };
					}
					return { status: 'unavailable', detail: `GET /api/tags returned HTTP ${response.status}` };
				} catch (error) {
					return { status: 'unavailable', detail: `health probe failed: ${mapTransportError(error, deps.config.providerId, undefined).message}` };
				}
			});
		},
		async *stream(request: ChatRequest, context?: RequestContext): AsyncGenerator<ProviderStreamEvent, void, void> {
			if (!modelIndex.has(request.modelId)) {
				throw new ProviderError('NOT_FOUND', `model '${request.modelId}' is not served by provider '${deps.config.providerId}'`, { providerId: deps.config.providerId, modelId: request.modelId });
			}
			const body = buildOllamaRequestBody(request);
			const provenance = buildProvenance({ providerId: deps.config.providerId, vendor: deps.config.vendor, modelId: request.modelId, adapterVersion: ADAPTER_VERSION, wireFamily: 'ollama-chat', request, hash: deps.hash });
			const estimatedInputTokens = estimateRequestTokens(request);
			let response;
			try {
				response = await deps.http.request({
					method: 'POST',
					url: joinUrl(deps.config.baseUrl, '/api/chat'),
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
					timeoutMs: requestTimeoutMs,
					...(context?.signal === undefined ? {} : { signal: context.signal }),
				});
			} catch (error) {
				throw mapTransportError(error, deps.config.providerId, request.modelId);
			}
			if (response.status < 200 || response.status >= 300) {
				throw await issueError(response, request.modelId);
			}
			const parser = new NdjsonStreamParser();
			const decoder = new IncrementalDecoder();
			let sawToolCalls = false;
			let doneReason: string | undefined;
			let reportedInput: number | undefined;
			let reportedOutput: number | undefined;
			let outputText = '';
			try {
				for await (const chunk of response.bytes()) {
					throwIfCancelled(context?.signal, deps.config.providerId);
					for (const line of parser.feed(decoder.push(chunk))) {
						let parsed: unknown;
						try {
							parsed = JSON.parse(line);
						} catch {
							throw new ProviderError('MALFORMED_RESPONSE', `ollama: NDJSON line is not JSON: ${line.slice(0, 120)}`, { providerId: deps.config.providerId, modelId: request.modelId });
						}
						const record = parsed as {
							message?: { content?: string; tool_calls?: ReadonlyArray<{ function?: { name?: string; arguments?: unknown } }> };
							done?: boolean;
							done_reason?: string;
							prompt_eval_count?: number;
							eval_count?: number;
						};
						if (record.message?.content !== undefined && record.message.content.length > 0) {
							outputText += record.message.content;
							yield { type: 'text-delta', text: record.message.content };
						}
						const toolCalls = record.message?.tool_calls ?? [];
						for (const [ordinal, call] of toolCalls.entries()) {
							if (call.function?.name === undefined) {
								continue;
							}
							sawToolCalls = true;
							// Ollama wire tool calls are complete objects: one start, the
							// serialized arguments as one fragment, then one end.
							const callId = `${call.function.name}#${ordinal}`;
							yield { type: 'tool-input-start', callId, toolName: call.function.name };
							const fragment = JSON.stringify(call.function.arguments ?? {});
							yield { type: 'tool-input-delta', callId, fragment };
							yield { type: 'tool-input-end', callId };
						}
						if (record.done === true) {
							doneReason = record.done_reason;
							reportedInput = record.prompt_eval_count ?? reportedInput;
							reportedOutput = record.eval_count ?? reportedOutput;
						}
					}
				}
			} catch (error) {
				throw mapTransportError(error, deps.config.providerId, request.modelId);
			}
			throwIfCancelled(context?.signal, deps.config.providerId);
			const usage = {
				estimatedInputTokens,
				estimatedOutputTokens: estimateTextTokens(outputText),
				...(reportedInput === undefined ? {} : { reportedInputTokens: reportedInput }),
				...(reportedOutput === undefined ? {} : { reportedOutputTokens: reportedOutput }),
			};
			yield { type: 'usage', usage };
			yield { type: 'finish', finishReason: mapDoneReason(doneReason, sawToolCalls), usage, provenance };
		},
		estimateTokens(text: string | readonly ChatMessage[]): number {
			return typeof text === 'string' ? estimateTextTokens(text) : estimateMessageTokens(text);
		},
	};
}

/** Extracts `error` from an Ollama-style error body; '' when absent. */
export function extractOllamaErrorMessage(bodyText: string): string {
	if (bodyText.trim().length === 0) {
		return '';
	}
	try {
		const parsed = JSON.parse(bodyText) as { error?: string };
		return parsed.error ?? '';
	} catch {
		return bodyText.slice(0, 200);
	}
}
