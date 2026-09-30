/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- canonical serialization + token estimation (M1).
 *
 * `canonicalJson` produces the deterministic sorted-keys compact JSON used
 * for request hashing (ResponseProvenance.requestHash) and for the durable
 * `.flauz/models` envelopes (sorted keys, 2-space indent, exactly one
 * trailing newline -- the same discipline as the environments extension).
 *
 * `estimateTokens` is the deterministic heuristic every adapter shares:
 * ceil(characters / 4) for text (plus per-message framing overhead). It is
 * an ESTIMATE and is labeled as one everywhere it surfaces; it is never
 * presented as a tokenizer.
 */

/// <reference path="../ambient.d.ts" />

import type { ChatInputPart, ChatMessage, ChatRequest, ResponseProvenance, WireFamily } from './types.ts';

/** Characters per estimated token (heuristic: ~4 chars/token for code-ish text). */
export const ESTIMATE_CHARS_PER_TOKEN = 4;

/** Framing overhead attributed to each message (prompt-format dependent; heuristic constant). */
export const ESTIMATE_MESSAGE_OVERHEAD_TOKENS = 4;

/** Deterministic estimate for a text string. */
export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / ESTIMATE_CHARS_PER_TOKEN);
}

function estimateInputPartTokens(part: ChatInputPart): number {
	if (part.kind === 'text') {
		return estimateTextTokens(part.value);
	}
	if (part.kind === 'data') {
		// binary data: estimate on the byte count (vendors charge tokens per encoded payload)
		return Math.ceil(part.data.byteLength / ESTIMATE_CHARS_PER_TOKEN);
	}
	if (part.kind === 'toolCall') {
		const serialized = safeJsonStringify(part.input);
		return estimateTextTokens(serialized) + estimateTextTokens(part.toolName);
	}
	// toolResult: sum of content parts
	let total = 0;
	for (const content of part.content) {
		total += content.kind === 'text' ? estimateTextTokens(content.value) : Math.ceil(content.data.byteLength / ESTIMATE_CHARS_PER_TOKEN);
	}
	return total;
}

/** Deterministic estimate for a message list (per-message framing overhead included). */
export function estimateMessageTokens(messages: readonly ChatMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += ESTIMATE_MESSAGE_OVERHEAD_TOKENS;
		for (const part of message.content) {
			total += estimateInputPartTokens(part);
		}
		if (message.name !== undefined) {
			total += estimateTextTokens(message.name);
		}
	}
	return total;
}

/** Deterministic estimate for a whole request (messages + tool declarations). */
export function estimateRequestTokens(request: ChatRequest): number {
	let total = estimateMessageTokens(request.messages);
	for (const tool of request.tools ?? []) {
		total += estimateTextTokens(tool.name) + estimateTextTokens(tool.description ?? '');
		total += estimateTextTokens(safeJsonStringify(tool.inputJsonSchema));
	}
	return total;
}

/** JSON.stringify that never throws on cyclic input (returns a placeholder marker instead). */
export function safeJsonStringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? 'null';
	} catch {
		return '"<unserializable>"';
	}
}

/** Recursively sorted plain-data view (arrays keep order, object keys sort). */
export function deepSorted(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(deepSorted);
	}
	if (value !== null && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) {
			result[key] = deepSorted(record[key]);
		}
		return result;
	}
	return value;
}

/** Canonical compact JSON (sorted keys) -- the request-hash input. */
export function canonicalJson(value: unknown): string {
	return JSON.stringify(deepSorted(value));
}

/** Canonical pretty document (sorted keys, 2-space indent, one trailing newline) -- the envelope format. */
export function serializeDocument(value: unknown): string {
	return `${JSON.stringify(deepSorted(value), null, 2)}\n`;
}

/**
 * Consumes a streaming byte body into text. Chunks are decoded with the
 * stream-aware TextDecoder so multi-byte UTF-8 code points split across
 * chunk boundaries survive.
 */
export async function collectBodyText(bytes: AsyncGenerator<Uint8Array, void, void>): Promise<string> {
	const decoder = new TextDecoder();
	let text = '';
	for await (const chunk of bytes) {
		text += decoder.decode(chunk, { stream: true });
	}
	text += decoder.decode();
	return text;
}

/**
 * Builds the response provenance record (hard rule: provider id, model id,
 * request hash, adapter version -- plus vendor and wire family for routing
 * audits). The request hash covers model id, messages, tools and options in
 * canonical form; tool input JSON is canonicalized so identical logical
 * requests hash identically regardless of key order.
 */
export function buildProvenance(input: {
	readonly providerId: string;
	readonly vendor: string;
	readonly modelId: string;
	readonly adapterVersion: string;
	readonly wireFamily: WireFamily;
	readonly request: ChatRequest;
	readonly hash: { sha256Hex(input: string): string };
}): ResponseProvenance {
	const hashInput = canonicalJson({
		messages: input.request.messages,
		maxOutputTokens: input.request.maxOutputTokens,
		modelId: input.request.modelId,
		stopSequences: input.request.stopSequences,
		temperature: input.request.temperature,
		toolMode: input.request.toolMode,
		tools: input.request.tools,
	});
	return {
		providerId: input.providerId,
		vendor: input.vendor,
		modelId: input.modelId,
		requestHash: input.hash.sha256Hex(hashInput),
		adapterVersion: input.adapterVersion,
		wireFamily: input.wireFamily,
	};
}
