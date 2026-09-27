/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the vendor-neutral model/provider adapter contract (M1).
 *
 * This module defines the NEUTRAL chat shapes, capability records, response
 * provenance and the `ProviderAdapter` port that every real adapter in this
 * extension implements. The shapes deliberately MIRROR the stable vscode
 * language-model surfaces (vendored vscode.d.ts: LanguageModelChatRequestMessage
 * 20652-20671, LanguageModelInputPart 20680-20685, LanguageModelChatTool,
 * LanguageModelChatInformation 20584-20633) so the vscode glue
 * (src/adapters/bridge.ts) is a thin structural mapper and never a
 * re-implementation. Unlike the vscode surfaces, the neutral parts are TAGGED
 * (`kind`) so wire mapping and fixture assertions are explicit.
 *
 * NO vendor SDK and NO model-vendor coupling: adapters speak vendor HTTP
 * shapes (OpenAI-compatible chat-completions, Anthropic-compatible messages,
 * Ollama-style local chat) through the injected `HttpPort`
 * (src/contract/ports.ts). Tests run against LOCAL fixture servers; the
 * adapter code paths are production-shaped and every fixture-driven result in
 * this extension's tests is FIXTURE-VERIFIED (live-provider verification is
 * an explicit future integration gap, see the delivery REPORT).
 */

/** Chat roles on the neutral wire (mirrors vscode.LanguageModelChatMessageRole values 1/2 + system). */
export type ChatRole = 'system' | 'user' | 'assistant';

/** Tool-selection mode (mirrors vscode.LanguageModelChatToolMode: Auto = 1). */
export type ChatToolMode = 'auto' | 'required';

/** Plain text content (mirrors vscode.LanguageModelTextPart). */
export interface ChatTextPart {
	readonly kind: 'text';
	readonly value: string;
}

/** Binary data content (mirrors vscode.LanguageModelDataPart; base64 on vendor wires). */
export interface ChatDataPart {
	readonly kind: 'data';
	readonly mimeType: string;
	readonly data: Uint8Array;
}

/** A model-requested tool invocation (mirrors vscode.LanguageModelToolCallPart). */
export interface ChatToolCallPart {
	readonly kind: 'toolCall';
	readonly callId: string;
	readonly toolName: string;
	/** Parsed tool input (a JSON value; adapters parse vendor argument fragments). */
	readonly input: unknown;
}

/** A tool result returned to the model (mirrors vscode.LanguageModelToolResultPart). */
export interface ChatToolResultPart {
	readonly kind: 'toolResult';
	readonly callId: string;
	readonly content: readonly (ChatTextPart | ChatDataPart)[];
}

export type ChatInputPart = ChatTextPart | ChatDataPart | ChatToolCallPart | ChatToolResultPart;

/** One neutral chat message (mirrors vscode.LanguageModelChatRequestMessage). */
export interface ChatMessage {
	readonly role: ChatRole;
	readonly content: readonly ChatInputPart[];
	/** Optional participant name (mirrors the vscode `name` field). */
	readonly name?: string;
}

/** A tool offered to the model (mirrors vscode.LanguageModelChatTool: name + description + inputSchema). */
export interface ChatToolDefinition {
	readonly name: string;
	readonly description?: string;
	/** JSON Schema describing the tool input (an `unknown` JSON value by design). */
	readonly inputJsonSchema: unknown;
}

/** A model request on the neutral contract. */
export interface ChatRequest {
	readonly modelId: string;
	readonly messages: readonly ChatMessage[];
	readonly tools?: readonly ChatToolDefinition[];
	readonly toolMode?: ChatToolMode;
	readonly maxOutputTokens?: number;
	readonly temperature?: number;
	readonly stopSequences?: readonly string[];
}

/** Why the model stopped generating. */
export type FinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'other';

/**
 * Token accounting for one response: a deterministic ESTIMATE plus the
 * PROVIDER-REPORTED numbers when the vendor wire carries them. Both are kept
 * side by side on purpose -- the estimate is always present (honest
 * heuristic, never claimed to be a tokenizer), the reported numbers are only
 * present when the wire actually reported them.
 */
export interface TokenUsage {
	readonly estimatedInputTokens: number;
	readonly estimatedOutputTokens: number;
	readonly reportedInputTokens?: number;
	readonly reportedOutputTokens?: number;
}

/**
 * Provenance carried by every model response (hard rule: provider id, model
 * id, request hash, adapter version). `requestHash` is the sha256 of the
 * canonical JSON of the neutral request (src/contract/canonical.ts).
 */
export interface ResponseProvenance {
	readonly providerId: string;
	readonly vendor: string;
	readonly modelId: string;
	readonly requestHash: string;
	readonly adapterVersion: string;
	readonly wireFamily: WireFamily;
}

/**
 * Stream events yielded by an adapter. Text deltas, incremental tool-input
 * fragments (vendors stream partial JSON arguments), usage when reported,
 * and exactly one terminal `finish` event on success. Failures throw the
 * typed ProviderError (src/contract/errors.ts) -- never a bare Error.
 */
export type ProviderStreamEvent =
	| { readonly type: 'text-delta'; readonly text: string }
	| { readonly type: 'tool-input-start'; readonly callId: string; readonly toolName: string }
	| { readonly type: 'tool-input-delta'; readonly callId: string; readonly fragment: string }
	| { readonly type: 'tool-input-end'; readonly callId: string }
	| { readonly type: 'usage'; readonly usage: TokenUsage }
	| { readonly type: 'finish'; readonly finishReason: FinishReason; readonly usage: TokenUsage; readonly provenance: ResponseProvenance };

/** The vendor wire families adapters speak (the mock vendor records itself as mock-echo). */
export type WireFamily = 'openai-chat-completions' | 'anthropic-messages' | 'ollama-chat' | 'mock-echo';

/** Content modalities a model can accept / emit. */
export type Modality = 'text' | 'image';

/** Cost metadata (per-million prices; same envelope discipline as the vendor plan pricing stubs). */
export interface CostMetadata {
	readonly currency: 'USD' | 'credits';
	readonly inputPerMillion?: number;
	readonly outputPerMillion?: number;
	readonly cacheReadPerMillion?: number;
	readonly cacheWritePerMillion?: number;
}

/**
 * The declared capability record of one provider. `contextWindowTokens` is
 * the full window; input/output/tool reservations are derived by the budget
 * compiler (src/budget/budget.ts), never by the adapter.
 */
export interface ProviderCapabilities {
	readonly wireFamily: WireFamily;
	readonly inputModalities: readonly Modality[];
	readonly outputModalities: readonly Modality[];
	readonly contextWindowTokens: number;
	readonly maxOutputTokens: number;
	readonly streaming: boolean;
	/** Mirror of vscode toolCalling: boolean, or max tool count. */
	readonly toolCalling: boolean | number;
	readonly tokenCounting: 'estimated' | 'provider-reported' | 'both';
	readonly locality: 'local' | 'remote';
	readonly cost?: CostMetadata;
}

/**
 * Static adapter identity + endpoint config. `credentialRef` is a VAULT
 * REFERENCE (`env:<NAME>` / `vault:<NAME>`) resolved per request through the
 * injected SecretResolverPort -- key material is NEVER stored here, logged,
 * or persisted (fail-closed CREDENTIAL_UNRESOLVED when a ref cannot be
 * resolved).
 */
export interface AdapterDescriptor {
	readonly providerId: string;
	readonly vendor: string;
	readonly displayName: string;
	readonly adapterVersion: string;
	readonly wireFamily: WireFamily;
	readonly locality: 'local' | 'remote';
	readonly baseUrl: string;
	readonly credentialRef?: string;
}

/** Per-call context: cancellation signal + provenance hints. */
export interface RequestContext {
	readonly signal?: AbortSignal;
	readonly purpose?: string;
	readonly correlationId?: string;
}

/** Result of a provider health probe. */
export interface HealthReport {
	readonly providerId: string;
	readonly status: 'healthy' | 'degraded' | 'unavailable';
	readonly checkedAt: number;
	readonly latencyMs?: number;
	readonly detail: string;
}

/**
 * The provider adapter port (M1, BINDING for every adapter implementation):
 * capability declaration, health probe, streaming request/response mapping,
 * cancellation and token estimation. Adapters receive ALL side-effecting
 * surfaces (HTTP, secrets, hashing, clock) as injected ports so tests run
 * against LOCAL fixture servers with zero network and zero nondeterminism.
 */
export interface ProviderAdapter {
	readonly descriptor: AdapterDescriptor;
	/** Static capability declaration for this provider. */
	capabilities(): ProviderCapabilities;
	/** Cheap liveness/authorization probe against the configured endpoint. */
	health(context?: RequestContext): Promise<HealthReport>;
	/**
	 * Streams a chat completion. Yields ProviderStreamEvent values; throws
	 * the typed ProviderError on failure; honors context.signal between
	 * events (cancellation is cooperative per chunk).
	 */
	stream(request: ChatRequest, context?: RequestContext): AsyncGenerator<ProviderStreamEvent, void, void>;
	/** Deterministic token estimate (heuristic; never claimed to be a tokenizer). */
	estimateTokens(text: string | readonly ChatMessage[]): number;
}
