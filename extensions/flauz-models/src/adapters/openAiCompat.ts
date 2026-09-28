/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the OpenAI-compatible chat-completions adapter (M2).
 *
 * Speaks the OpenAI chat-completions wire shape (POST {base}/chat/completions,
 * SSE streaming, `data: {...}` frames terminated by the `[DONE]` sentinel,
 * incremental tool_calls accumulated by index, usage on the final frame when
 * `stream_options: {include_usage: true}` is honored) through the injected
 * HttpPort. "OpenAI-compatible" means the wire CONTRACT this adapter speaks;
 * it is verified against LOCAL fixture servers (FIXTURE-VERIFIED) and any
 * endpoint that implements the same shapes (OpenAI itself, or any
 * compatible gateway) is a live integration to be verified separately
 * (INTEGRATION-GAPS in the delivery REPORT).
 *
 * Health probe: GET {base}/models.
 *
 * Auth: `Authorization: Bearer <key>` resolved from the config's
 * credentialRef through the SecretResolverPort (fail-closed before any
 * traffic; the key never appears in errors, artifacts or logs).
 */

import { parseRetryAfterSeconds, ProviderError } from '../contract/errors.ts';
import { buildProvenance, estimateMessageTokens, estimateRequestTokens, estimateTextTokens } from '../contract/canonical.ts';
import type { HttpPortResponse } from '../contract/ports.ts';
import type { ChatDataPart, ChatInputPart, ChatMessage, ChatRequest, ChatToolDefinition, FinishReason, HealthReport, ModelDescriptor, ProviderCapabilities, ProviderStreamEvent, RequestContext } from '../contract/types.ts';
import {
	ADAPTER_VERSION,
	classifyHttpStatus,
	DEFAULT_HEALTH_TIMEOUT_MS,
	DEFAULT_REQUEST_TIMEOUT_MS,
	descriptorFrom,
	IncrementalDecoder,
	joinUrl,
	looksLikeContextOverflow,
	mapTransportError,
	readErrorBody,
	resolveCredential,
	SseStreamParser,
	throwIfCancelled,
	timedHealth,
	toBase64,
	type AdapterConfig,
	type AdapterDeps,
} from './common.ts';
import type { ProviderAdapter } from '../contract/types.ts';

/** The OpenAI wire message shape this adapter emits (subset it consumes back). */
export interface OpenAiWireMessage {
	readonly role: 'system' | 'user' | 'assistant' | 'tool';
	readonly content: string | readonly OpenAiWireContentPart[];
	readonly tool_calls?: readonly OpenAiWireToolCall[];
	readonly tool_call_id?: string;
	readonly name?: string;
}

export interface OpenAiWireContentPart {
	readonly type: 'text' | 'image_url';
	readonly text?: string;
	readonly image_url?: { readonly url: string };
}

export interface OpenAiWireToolCall {
	readonly id: string;
	readonly type: 'function';
	readonly function: { readonly name: string; readonly arguments: string };
}

export interface OpenAiWireTool {
	readonly type: 'function';
	readonly function: { readonly name: string; readonly description?: string; readonly parameters: unknown };
}

/** The request body this adapter POSTs (exported pure mapping for fixture assertions). */
export interface OpenAiWireRequestBody {
	readonly model: string;
	readonly messages: readonly OpenAiWireMessage[];
	readonly tools?: readonly OpenAiWireTool[];
	readonly tool_choice?: string;
	readonly max_tokens?: number;
	readonly temperature?: number;
	readonly stop?: readonly string[];
	readonly stream: true;
	readonly stream_options?: { readonly include_usage: true };
}

/** Maps neutral data parts into OpenAI content parts (images inline as data URLs). */
function mapUserContent(parts: readonly ChatInputPart[]): string | readonly OpenAiWireContentPart[] {
	let sawNonText = false;
	const mapped: OpenAiWireContentPart[] = [];
	for (const part of parts) {
		if (part.kind === 'text') {
			mapped.push({ type: 'text', text: part.value });
			continue;
		}
		if (part.kind === 'data' && part.mimeType.startsWith('image/')) {
			sawNonText = true;
			mapped.push({ type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${toBase64(part.data)}` } });
			continue;
		}
		// non-image binary data has no chat-completions home: an explicit, honest marker
		sawNonText = true;
		mapped.push({ type: 'text', text: `[unsupported data part: ${part.kind === 'data' ? part.mimeType : part.kind}]` });
	}
	return sawNonText ? mapped : mapped.map(part => part.text ?? '').join('');
}

/**
 * Maps a neutral ChatRequest into the chat-completions wire body. Pure and
 * exported: fixture tests assert the exact wire shape here.
 */
export function buildOpenAiRequestBody(request: ChatRequest): OpenAiWireRequestBody {
	const messages: OpenAiWireMessage[] = [];
	for (const message of request.messages) {
		if (message.role === 'system') {
			messages.push({ role: 'system', content: message.content.filter(isTextual).map(textOf).join('') });
			continue;
		}
		if (message.role === 'assistant') {
			const toolCalls: OpenAiWireToolCall[] = [];
			for (const part of message.content) {
				if (part.kind === 'toolCall') {
					toolCalls.push({ id: part.callId, type: 'function', function: { name: part.toolName, arguments: JSON.stringify(part.input ?? null) } });
				}
			}
			const text = message.content.filter(isTextual).map(textOf).join('');
			messages.push({
				role: 'assistant',
				content: text,
				...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
			});
			continue;
		}
		// user message: tool results become role:'tool' messages; the rest is content
		const contentParts: ChatInputPart[] = [];
		for (const part of message.content) {
			if (part.kind === 'toolResult') {
				messages.push({ role: 'tool', content: part.content.filter(isTextual).map(textOf).join(''), tool_call_id: part.callId });
				continue;
			}
			contentParts.push(part);
		}
		if (contentParts.length > 0) {
			messages.push({ role: 'user', content: mapUserContent(contentParts) });
		}
	}
	const tools: OpenAiWireTool[] | undefined = request.tools === undefined ? undefined : request.tools.map((tool: ChatToolDefinition) => ({
		type: 'function',
		function: { name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), parameters: tool.inputJsonSchema },
	}));
	return {
		model: request.modelId,
		messages,
		...(tools === undefined ? {} : { tools }),
		...(tools === undefined ? {} : { tool_choice: request.toolMode === 'required' ? 'required' : 'auto' }),
		...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
		...(request.temperature === undefined ? {} : { temperature: request.temperature }),
		...(request.stopSequences === undefined || request.stopSequences.length === 0 ? {} : { stop: request.stopSequences }),
		stream: true,
		stream_options: { include_usage: true },
	};
}

function isTextual(part: ChatInputPart): part is { kind: 'text'; value: string } {
	return part.kind === 'text';
}

function textOf(part: { kind: 'text'; value: string }): string {
	return part.value;
}

/** One accumulated tool-call across delta chunks (keyed by wire index). */
interface AccumulatedToolCall {
	callId: string;
	toolName: string;
	argumentFragments: string[];
}

function mapFinishReason(reason: string | undefined): FinishReason {
	if (reason === 'stop') {
		return 'stop';
	}
	if (reason === 'length') {
		return 'length';
	}
	if (reason === 'tool_calls' || reason === 'function_call') {
		return 'tool-calls';
	}
	if (reason === 'content_filter') {
		return 'content-filter';
	}
	return 'other';
}

/** Builds the adapter. All effects arrive through the injected deps. */
export function createOpenAiCompatAdapter(deps: AdapterDeps): ProviderAdapter {
	const descriptor = descriptorFrom(deps.config, 'openai-chat-completions', 'remote');
	const requestTimeoutMs = deps.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const healthTimeoutMs = deps.config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
	const modelIndex = new Map<string, ModelDescriptor>(deps.config.models.map(model => [model.modelId, model]));

	async function authorizationHeaders(): Promise<Record<string, string>> {
		const key = await resolveCredential(deps);
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (key !== undefined) {
			headers.Authorization = `Bearer ${key}`;
		}
		return headers;
	}

	async function issueError(response: HttpPortResponse, modelId: string | undefined): Promise<ProviderError> {
		const bodyText = await readErrorBody(response);
		const message = extractOpenAiErrorMessage(bodyText) || `openai-compat: HTTP ${response.status}`;
		const retryAfterMs = parseRetryAfterSeconds(response.headers['retry-after']);
		if (response.status === 400 && looksLikeContextOverflow(message)) {
			return new ProviderError('CONTEXT_OVERFLOW', message, { status: response.status, providerId: deps.config.providerId, modelId });
		}
		return classifyHttpStatus(response.status, retryAfterMs, deps.config.providerId, modelId, message);
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
				wireFamily: 'openai-chat-completions',
				inputModalities: model.inputModalities,
				outputModalities: ['text'],
				contextWindowTokens: model.contextWindowTokens,
				maxOutputTokens: model.maxOutputTokens,
				streaming: true,
				toolCalling: model.toolCalling,
				tokenCounting: 'both',
				locality: 'remote',
				...(model.cost === undefined ? {} : { cost: model.cost }),
			};
		},
		async health(context?: RequestContext): Promise<HealthReport> {
			return timedHealth(deps.config.providerId, deps.clock, async () => {
				try {
					const response = await deps.http.request({ method: 'GET', url: joinUrl(deps.config.baseUrl, '/models'), headers: await authorizationHeaders(), timeoutMs: healthTimeoutMs, ...(context?.signal === undefined ? {} : { signal: context.signal }) });
					if (response.status === 200) {
						return { status: 'healthy', detail: 'GET /models returned 200' };
					}
					if (response.status === 401 || response.status === 403) {
						return { status: 'degraded', detail: `endpoint reachable but authorization failed (HTTP ${response.status})` };
					}
					return { status: 'unavailable', detail: `GET /models returned HTTP ${response.status}` };
				} catch (error) {
					return { status: 'unavailable', detail: `health probe failed: ${mapTransportError(error, deps.config.providerId, undefined).message}` };
				}
			});
		},
		async *stream(request: ChatRequest, context?: RequestContext): AsyncGenerator<ProviderStreamEvent, void, void> {
			if (!modelIndex.has(request.modelId)) {
				throw new ProviderError('NOT_FOUND', `model '${request.modelId}' is not served by provider '${deps.config.providerId}'`, { providerId: deps.config.providerId, modelId: request.modelId });
			}
			const body = buildOpenAiRequestBody(request);
			const provenance = buildProvenance({ providerId: deps.config.providerId, vendor: deps.config.vendor, modelId: request.modelId, adapterVersion: ADAPTER_VERSION, wireFamily: 'openai-chat-completions', request, hash: deps.hash });
			const estimatedInputTokens = estimateRequestTokens(request);
			let response;
			try {
				response = await deps.http.request({
					method: 'POST',
					url: joinUrl(deps.config.baseUrl, '/chat/completions'),
					headers: await authorizationHeaders(),
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
			const parser = new SseStreamParser();
			const decoder = new IncrementalDecoder();
			const toolCalls = new Map<number, AccumulatedToolCall>();
			let finishReason: FinishReason = 'other';
			let reportedInput: number | undefined;
			let reportedOutput: number | undefined;
			let outputText = '';
			let done = false;
			try {
				for await (const chunk of response.bytes()) {
					throwIfCancelled(context?.signal, deps.config.providerId);
					for (const frame of parser.feed(decoder.push(chunk))) {
						if (frame.data === '[DONE]') {
							done = true;
							continue;
						}
						if (frame.data.trim().length === 0) {
							continue;
						}
						let parsed: unknown;
						try {
							parsed = JSON.parse(frame.data);
						} catch {
							throw new ProviderError('MALFORMED_RESPONSE', `openai-compat: SSE frame is not JSON: ${frame.data.slice(0, 120)}`, { providerId: deps.config.providerId, modelId: request.modelId });
						}
						const record = parsed as {
							choices?: ReadonlyArray<{ delta?: { content?: string; tool_calls?: ReadonlyArray<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
							usage?: { prompt_tokens?: number; completion_tokens?: number };
						};
						for (const choice of record.choices ?? []) {
							if (choice.delta?.content !== undefined) {
								outputText += choice.delta.content;
								yield { type: 'text-delta', text: choice.delta.content };
							}
							for (const call of choice.delta?.tool_calls ?? []) {
								let accumulated = toolCalls.get(call.index);
								if (accumulated === undefined && call.id !== undefined) {
									accumulated = { callId: call.id, toolName: call.function?.name ?? '', argumentFragments: [] };
									toolCalls.set(call.index, accumulated);
									if (accumulated.toolName !== '') {
										yield { type: 'tool-input-start', callId: accumulated.callId, toolName: accumulated.toolName };
									}
								}
								if (accumulated === undefined) {
									continue;
								}
								if (call.function?.name !== undefined && call.id === undefined && accumulated.toolName === '') {
									// name arrives on a later delta than the id for some vendors
									accumulated.toolName = call.function.name;
									yield { type: 'tool-input-start', callId: accumulated.callId, toolName: accumulated.toolName };
								}
								if (call.function?.arguments !== undefined) {
									accumulated.argumentFragments.push(call.function.arguments);
									yield { type: 'tool-input-delta', callId: accumulated.callId, fragment: call.function.arguments };
								}
							}
							if (choice.finish_reason !== undefined) {
								finishReason = mapFinishReason(choice.finish_reason);
							}
						}
						if (record.usage !== undefined) {
							reportedInput = record.usage.prompt_tokens ?? reportedInput;
							reportedOutput = record.usage.completion_tokens ?? reportedOutput;
						}
					}
					if (done) {
						break;
					}
				}
			} catch (error) {
				throw mapTransportError(error, deps.config.providerId, request.modelId);
			}
			throwIfCancelled(context?.signal, deps.config.providerId);
			if (toolCalls.size > 0) {
				finishReason = 'tool-calls';
				for (const [, call] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
					yield { type: 'tool-input-end', callId: call.callId };
				}
			}
			const usage = {
				estimatedInputTokens,
				estimatedOutputTokens: estimateTextTokens(outputText) + [...toolCalls.values()].reduce((total, call) => total + estimateTextTokens(call.argumentFragments.join('')), 0),
				...(reportedInput === undefined ? {} : { reportedInputTokens: reportedInput }),
				...(reportedOutput === undefined ? {} : { reportedOutputTokens: reportedOutput }),
			};
			yield { type: 'usage', usage };
			yield { type: 'finish', finishReason, usage, provenance };
		},
		estimateTokens(text: string | readonly ChatMessage[]): number {
			return typeof text === 'string' ? estimateTextTokens(text) : estimateMessageTokens(text);
		},
	};
}

/** Extracts `error.message` from an OpenAI-style error body; '' when absent. */
export function extractOpenAiErrorMessage(bodyText: string): string {
	if (bodyText.trim().length === 0) {
		return '';
	}
	try {
		const parsed = JSON.parse(bodyText) as { error?: { message?: string } | string };
		if (typeof parsed.error === 'string') {
			return parsed.error;
		}
		return parsed.error?.message ?? '';
	} catch {
		return bodyText.slice(0, 200);
	}
}
