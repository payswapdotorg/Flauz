/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the Anthropic-compatible messages adapter (M2).
 *
 * Speaks the Anthropic messages wire shape (POST {base}/v1/messages, SSE
 * with named events: message_start / content_block_start /
 * content_block_delta / content_block_stop / message_delta / message_stop /
 * ping / error; tool_use blocks assembled from input_json_delta fragments;
 * usage split across message_start (input) and message_delta (output))
 * through the injected HttpPort. "Anthropic-compatible" is the wire CONTRACT
 * this adapter speaks: FIXTURE-VERIFIED against local fixture servers;
 * contacting a live Anthropic-compatible endpoint is a recorded future
 * integration gap.
 *
 * Auth: `x-api-key: <key>` + `anthropic-version: <pinned>` headers resolved
 * from the config's credentialRef through the SecretResolverPort
 * (fail-closed before any traffic).
 *
 * Health probe: GET {base}/v1/models.
 */

import { parseRetryAfterSeconds, ProviderError } from '../contract/errors.ts';
import type { HttpPortResponse } from '../contract/ports.ts';
import { buildProvenance, estimateMessageTokens, estimateRequestTokens, estimateTextTokens } from '../contract/canonical.ts';
import type { ChatInputPart, ChatMessage, ChatRequest, ChatToolDefinition, FinishReason, HealthReport, ModelDescriptor, ProviderCapabilities, ProviderStreamEvent, RequestContext, ProviderAdapter } from '../contract/types.ts';

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
	type AdapterDeps,
} from './common.ts';

/** The pinned protocol version header (part of the wire contract this adapter speaks). */
export const ANTHROPIC_VERSION_HEADER = '2023-06-01';

export interface AnthropicWireBlock {
	readonly type: 'text' | 'image' | 'tool_use' | 'tool_result';
	readonly text?: string;
	readonly source?: { readonly type: 'base64'; readonly media_type: string; readonly data: string };
	readonly id?: string;
	readonly name?: string;
	readonly input?: unknown;
	readonly tool_use_id?: string;
	readonly content?: string | readonly { readonly type: 'text'; readonly text: string }[];
}

export interface AnthropicWireMessage {
	readonly role: 'user' | 'assistant';
	readonly content: string | readonly AnthropicWireBlock[];
}

export interface AnthropicWireTool {
	readonly name: string;
	readonly description?: string;
	readonly input_schema: unknown;
}

/** The request body this adapter POSTs (exported pure mapping for fixture assertions). */
export interface AnthropicWireRequestBody {
	readonly model: string;
	readonly max_tokens: number;
	readonly system?: string;
	readonly messages: readonly AnthropicWireMessage[];
	readonly tools?: readonly AnthropicWireTool[];
	readonly tool_choice?: { readonly type: 'auto' | 'any' };
	readonly temperature?: number;
	readonly stop_sequences?: readonly string[];
	readonly stream: true;
}

function textOf(part: { kind: 'text'; value: string }): string {
	return part.value;
}

function isText(part: ChatInputPart): part is { kind: 'text'; value: string } {
	return part.kind === 'text';
}

/** Maps neutral message content into Anthropic content blocks. */
function mapContentBlocks(parts: readonly ChatInputPart[]): readonly AnthropicWireBlock[] {
	const blocks: AnthropicWireBlock[] = [];
	for (const part of parts) {
		if (part.kind === 'text') {
			blocks.push({ type: 'text', text: part.value });
		} else if (part.kind === 'data') {
			if (part.mimeType.startsWith('image/')) {
				blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mimeType, data: toBase64(part.data) } });
			} else {
				blocks.push({ type: 'text', text: `[unsupported data part: ${part.mimeType}]` });
			}
		} else if (part.kind === 'toolCall') {
			blocks.push({ type: 'tool_use', id: part.callId, name: part.toolName, input: part.input ?? {} });
		} else {
			blocks.push({
				type: 'tool_result',
				tool_use_id: part.callId,
				content: part.content.map(content => (content.kind === 'text' ? content.value : `[data part: ${content.mimeType}]`)).join(''),
			});
		}
	}
	return blocks;
}

/**
 * Maps a neutral ChatRequest into the messages wire body. System messages
 * are extracted to the top-level `system` field (the Anthropic shape); user
 * tool results become tool_result blocks inside user messages (the Anthropic
 * placement); assistant tool calls become tool_use blocks. `max_tokens` is
 * REQUIRED by the wire and defaults to the model's declared max output.
 */
export function buildAnthropicRequestBody(request: ChatRequest, defaultMaxOutputTokens: number): AnthropicWireRequestBody {
	const systemParts: string[] = [];
	const messages: AnthropicWireMessage[] = [];
	for (const message of request.messages) {
		if (message.role === 'system') {
			systemParts.push(message.content.filter(isText).map(textOf).join(''));
			continue;
		}
		messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: mapContentBlocks(message.content) });
	}
	const tools: AnthropicWireTool[] | undefined = request.tools === undefined ? undefined : request.tools.map((tool: ChatToolDefinition) => ({
		name: tool.name,
		...(tool.description === undefined ? {} : { description: tool.description }),
		input_schema: tool.inputJsonSchema,
	}));
	return {
		model: request.modelId,
		max_tokens: request.maxOutputTokens ?? defaultMaxOutputTokens,
		...(systemParts.length === 0 ? {} : { system: systemParts.join('\n\n') }),
		messages,
		...(tools === undefined ? {} : { tools }),
		...(tools === undefined ? {} : { tool_choice: { type: request.toolMode === 'required' ? 'any' : 'auto' } }),
		...(request.temperature === undefined ? {} : { temperature: request.temperature }),
		...(request.stopSequences === undefined || request.stopSequences.length === 0 ? {} : { stop_sequences: request.stopSequences }),
		stream: true,
	};
}

function mapStopReason(reason: string | undefined): FinishReason {
	if (reason === 'end_turn' || reason === 'stop_sequence') {
		return 'stop';
	}
	if (reason === 'max_tokens') {
		return 'length';
	}
	if (reason === 'tool_use') {
		return 'tool-calls';
	}
	return 'other';
}

/** Builds the adapter. All effects arrive through the injected deps. */
export function createAnthropicCompatAdapter(deps: AdapterDeps): ProviderAdapter {
	const descriptor = descriptorFrom(deps.config, 'anthropic-messages', 'remote');
	const requestTimeoutMs = deps.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const healthTimeoutMs = deps.config.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
	const modelIndex = new Map<string, ModelDescriptor>(deps.config.models.map(model => [model.modelId, model]));

	async function authHeaders(): Promise<Record<string, string>> {
		const key = await resolveCredential(deps);
		const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': ANTHROPIC_VERSION_HEADER };
		if (key !== undefined) {
			headers['x-api-key'] = key;
		}
		return headers;
	}

	async function issueError(response: HttpPortResponse, modelId: string | undefined): Promise<ProviderError> {
		const bodyText = await readErrorBody(response);
		const message = extractAnthropicErrorMessage(bodyText) || `anthropic-compat: HTTP ${response.status}`;
		const retryAfterMs = parseRetryAfterSeconds(response.headers['retry-after']);
		if ((response.status === 400 || response.status === 413) && looksLikeContextOverflow(message)) {
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
				wireFamily: 'anthropic-messages',
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
					const response = await deps.http.request({ method: 'GET', url: joinUrl(deps.config.baseUrl, '/v1/models'), headers: await authHeaders(), timeoutMs: healthTimeoutMs, ...(context?.signal === undefined ? {} : { signal: context.signal }) });
					if (response.status === 200) {
						return { status: 'healthy', detail: 'GET /v1/models returned 200' };
					}
					if (response.status === 401 || response.status === 403) {
						return { status: 'degraded', detail: `endpoint reachable but authorization failed (HTTP ${response.status})` };
					}
					return { status: 'unavailable', detail: `GET /v1/models returned HTTP ${response.status}` };
				} catch (error) {
					return { status: 'unavailable', detail: `health probe failed: ${mapTransportError(error, deps.config.providerId, undefined).message}` };
				}
			});
		},
		async *stream(request: ChatRequest, context?: RequestContext): AsyncGenerator<ProviderStreamEvent, void, void> {
			const model = modelIndex.get(request.modelId);
			if (model === undefined) {
				throw new ProviderError('NOT_FOUND', `model '${request.modelId}' is not served by provider '${deps.config.providerId}'`, { providerId: deps.config.providerId, modelId: request.modelId });
			}
			const body = buildAnthropicRequestBody(request, model.maxOutputTokens);
			const provenance = buildProvenance({ providerId: deps.config.providerId, vendor: deps.config.vendor, modelId: request.modelId, adapterVersion: ADAPTER_VERSION, wireFamily: 'anthropic-messages', request, hash: deps.hash });
			const estimatedInputTokens = estimateRequestTokens(request);
			let response;
			try {
				response = await deps.http.request({
					method: 'POST',
					url: joinUrl(deps.config.baseUrl, '/v1/messages'),
					headers: await authHeaders(),
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
			// tool_use blocks keyed by their block index; start events carry the id+name
			const openToolBlocks = new Map<number, { callId: string; fragments: string[] }>();
			const closedToolBlocks = new Set<string>();
			let finishReason: FinishReason = 'other';
			let reportedInput: number | undefined;
			let reportedOutput: number | undefined;
			let outputText = '';
			let sawToolUse = false;
			let stopped = false;
			try {
				for await (const chunk of response.bytes()) {
					throwIfCancelled(context?.signal, deps.config.providerId);
					for (const frame of parser.feed(decoder.push(chunk))) {
						if (frame.data.trim().length === 0) {
							continue;
						}
						let parsed: unknown;
						try {
							parsed = JSON.parse(frame.data);
						} catch {
							throw new ProviderError('MALFORMED_RESPONSE', `anthropic-compat: SSE frame is not JSON: ${frame.data.slice(0, 120)}`, { providerId: deps.config.providerId, modelId: request.modelId });
						}
						const record = parsed as {
							type?: string;
							message?: { usage?: { input_tokens?: number; output_tokens?: number } };
							index?: number;
							content_block?: { type?: string; id?: string; name?: string };
							delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
							usage?: { input_tokens?: number; output_tokens?: number };
							error?: { type?: string; message?: string };
						};
						const frameType = frame.event ?? record.type;
						if (frameType === 'error') {
							const message = record.error?.message ?? 'anthropic-compat: stream error event';
							throw classifyAnthropicStreamError(record.error?.type, message, deps.config.providerId, request.modelId);
						}
						if (frameType === 'message_start') {
							reportedInput = record.message?.usage?.input_tokens ?? reportedInput;
							continue;
						}
						if (frameType === 'content_block_start') {
							if (record.content_block?.type === 'tool_use' && record.index !== undefined && record.content_block.id !== undefined) {
								openToolBlocks.set(record.index, { callId: record.content_block.id, fragments: [] });
								yield { type: 'tool-input-start', callId: record.content_block.id, toolName: record.content_block.name ?? '' };
							}
							continue;
						}
						if (frameType === 'content_block_delta') {
							if (record.delta?.type === 'text_delta' && record.delta.text !== undefined) {
								outputText += record.delta.text;
								yield { type: 'text-delta', text: record.delta.text };
							} else if (record.delta?.type === 'input_json_delta' && record.delta.partial_json !== undefined && record.index !== undefined) {
								const open = openToolBlocks.get(record.index);
								if (open !== undefined) {
									open.fragments.push(record.delta.partial_json);
									yield { type: 'tool-input-delta', callId: open.callId, fragment: record.delta.partial_json };
								}
							}
							continue;
						}
						if (frameType === 'content_block_stop') {
							if (record.index !== undefined) {
								const open = openToolBlocks.get(record.index);
								if (open !== undefined) {
									openToolBlocks.delete(record.index);
									closedToolBlocks.add(open.callId);
									sawToolUse = true;
									yield { type: 'tool-input-end', callId: open.callId };
								}
							}
							continue;
						}
						if (frameType === 'message_delta') {
							if (record.delta?.stop_reason !== undefined) {
								finishReason = mapStopReason(record.delta.stop_reason);
							}
							reportedOutput = record.usage?.output_tokens ?? reportedOutput;
							continue;
						}
						if (frameType === 'message_stop') {
							stopped = true;
							continue;
						}
						// ping and unknown events are ignored
					}
					if (stopped) {
						break;
					}
				}
			} catch (error) {
				throw mapTransportError(error, deps.config.providerId, request.modelId);
			}
			throwIfCancelled(context?.signal, deps.config.providerId);
			// unterminated tool blocks (truncated streams): close them so the
			// caller sees a complete event sequence before finish
			for (const [, open] of [...openToolBlocks.entries()].sort((a, b) => a[0] - b[0])) {
				sawToolUse = true;
				yield { type: 'tool-input-end', callId: open.callId };
			}
			if (sawToolUse) {
				finishReason = 'tool-calls';
			}
			const usage = {
				estimatedInputTokens,
				estimatedOutputTokens: estimateTextTokens(outputText),
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

/** Maps in-stream Anthropic error types onto the taxonomy. */
export function classifyAnthropicStreamError(errorType: string | undefined, message: string, providerId: string, modelId: string | undefined): ProviderError {
	if (errorType === 'rate_limit_error') {
		return new ProviderError('RATE_LIMITED', message, { providerId, modelId });
	}
	if (errorType === 'overloaded_error' || errorType === 'api_error') {
		return new ProviderError('PROVIDER_OVERLOADED', message, { providerId, modelId });
	}
	return new ProviderError('MALFORMED_RESPONSE', message, { providerId, modelId });
}

/** Extracts `error.message` from an Anthropic-style error body; '' when absent. */
export function extractAnthropicErrorMessage(bodyText: string): string {
	if (bodyText.trim().length === 0) {
		return '';
	}
	try {
		const parsed = JSON.parse(bodyText) as { error?: { type?: string; message?: string } };
		return parsed.error?.message ?? '';
	} catch {
		return bodyText.slice(0, 200);
	}
}
