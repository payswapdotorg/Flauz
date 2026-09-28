/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- shared adapter plumbing (M2).
 *
 * Wire-format parsers (SSE framing, NDJSON lines), the incremental UTF-8
 * decoder wrapper, credential resolution (fail-closed, header-only usage),
 * the shared HTTP-failure mapping and the adapter config/deps shapes. Every
 * piece is vendor-neutral: vendor specifics live in the per-family adapter
 * modules and in the canned fixture data only.
 */

import { Buffer } from 'node:buffer';
import { ProviderError, isProviderError } from '../contract/errors.ts';
import { HttpPortAbortError, type Clock, type HashPort, type HttpPort, type HttpPortResponse, type SecretResolverPort } from '../contract/ports.ts';

import { collectBodyText } from '../contract/canonical.ts';
import type { AdapterDescriptor, ModelDescriptor, Modality, ProviderCapabilities, WireFamily } from '../contract/types.ts';

/** Adapter version stamped into every response provenance row (hard rule). */
export const ADAPTER_VERSION = 'tl2-002.1';

/** Default wall-clock budget for one streaming model request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

/** Default wall-clock budget for a health probe. */
export const DEFAULT_HEALTH_TIMEOUT_MS = 10_000;

/** Per-model + per-endpoint runtime config one adapter is built from. */
export interface AdapterConfig {
	readonly providerId: string;
	readonly vendor: string;
	readonly displayName: string;
	readonly baseUrl: string;
	/** Vault reference (`env:<NAME>` / `vault:<NAME>`); never key material. */
	readonly credentialRef?: string;
	readonly models: readonly ModelDescriptor[];
	readonly requestTimeoutMs?: number;
	readonly healthTimeoutMs?: number;
}

/** Every side-effecting surface an adapter uses, injected. */
export interface AdapterDeps {
	readonly config: AdapterConfig;
	readonly http: HttpPort;
	readonly secrets: SecretResolverPort;
	readonly hash: HashPort;
	readonly clock: Clock;
}

/** Builds the AdapterDescriptor (identity + endpoint posture) from a config. */
export function descriptorFrom(config: AdapterConfig, wireFamily: WireFamily, locality: 'local' | 'remote'): AdapterDescriptor {
	return {
		providerId: config.providerId,
		vendor: config.vendor,
		displayName: config.displayName,
		adapterVersion: ADAPTER_VERSION,
		wireFamily,
		locality,
		baseUrl: config.baseUrl,
		...(config.credentialRef === undefined ? {} : { credentialRef: config.credentialRef }),
	};
}

/** Joins a base URL and a path fragment without double slashes. */
export function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Uint8Array -> base64 (the data-part wire encoding for all three families). */
export function toBase64(data: Uint8Array): string {
	return Buffer.from(data).toString('base64');
}

/** One parsed SSE frame. */
export interface SseFrame {
	readonly event?: string;
	readonly data: string;
}

/**
 * Server-Sent Events framing parser (the OpenAI-compatible and
 * Anthropic-compatible streaming transport). Feed decoded text chunks; it
 * returns completed frames. Handles \n and \r\n line endings, `data:`/
 * `data: ` and `event:`/`event: ` prefixes, multi-line data (joined with \n),
 * comment lines (ignored) and event dispatch on blank lines.
 */
export class SseStreamParser {
	private buffer = '';
	private eventName: string | undefined;
	private dataLines: string[] = [];

	feed(chunk: string): SseFrame[] {
		this.buffer += chunk;
		const frames: SseFrame[] = [];
		while (true) {
			const newlineIndex = this.buffer.indexOf('\n');
			if (newlineIndex === -1) {
				break;
			}
			let line = this.buffer.slice(0, newlineIndex);
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.endsWith('\r')) {
				line = line.slice(0, -1);
			}
			if (line.length === 0) {
				if (this.dataLines.length > 0 || this.eventName !== undefined) {
					frames.push({ ...(this.eventName === undefined ? {} : { event: this.eventName }), data: this.dataLines.join('\n') });
				}
				this.eventName = undefined;
				this.dataLines = [];
				continue;
			}
			if (line.startsWith(':')) {
				continue;
			}
			if (line.startsWith('data:')) {
				this.dataLines.push(line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5));
				continue;
			}
			if (line.startsWith('event:')) {
				this.eventName = (line.slice(6).startsWith(' ') ? line.slice(7) : line.slice(6));
				continue;
			}
			// unknown field lines are ignored per the SSE spec
		}
		return frames;
	}
}

/**
 * Newline-delimited JSON framing parser (the Ollama-style streaming
 * transport). Feed decoded text chunks; it returns completed lines.
 */
export class NdjsonStreamParser {
	private buffer = '';

	feed(chunk: string): string[] {
		this.buffer += chunk;
		const lines: string[] = [];
		while (true) {
			const newlineIndex = this.buffer.indexOf('\n');
			if (newlineIndex === -1) {
				break;
			}
			const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.trim().length > 0) {
				lines.push(line);
			}
		}
		return lines;
	}
}

/** Incremental UTF-8 decode across chunk boundaries. */
export class IncrementalDecoder {
	private readonly decoder = new TextDecoder();

	push(bytes: Uint8Array): string {
		return this.decoder.decode(bytes, { stream: true });
	}

	flush(): string {
		return this.decoder.decode();
	}
}

/**
 * Resolves the credential for a request. Fail-closed: an unresolved vault
 * reference throws CREDENTIAL_UNRESOLVED BEFORE any HTTP traffic. The
 * resolved value is used by the caller strictly in the authorization header
 * and is never included in errors, logs, or artifacts.
 */
export async function resolveCredential(deps: AdapterDeps): Promise<string | undefined> {
	if (deps.config.credentialRef === undefined) {
		return undefined;
	}
	const resolved = await deps.secrets.resolve(deps.config.credentialRef);
	if (resolved === undefined || resolved.length === 0) {
		throw new ProviderError('CREDENTIAL_UNRESOLVED', `credential reference '${deps.config.credentialRef}' could not be resolved for provider '${deps.config.providerId}' (fail closed; no request was sent)`, { providerId: deps.config.providerId });
	}
	return resolved;
}

/** Maps an HttpPort failure into the typed taxonomy (abort vs network). */
export function mapTransportError(error: unknown, providerId: string, modelId: string | undefined): ProviderError {
	if (isProviderError(error)) {
		return error;
	}
	if (error instanceof HttpPortAbortError) {
		if (error.abortReason === 'signal') {
			return new ProviderError('CANCELLED', `request cancelled by caller (${providerId})`, { providerId, modelId, cause: error });
		}
		return new ProviderError('TIMEOUT', `request exceeded its wall-clock budget (${providerId})`, { providerId, modelId, cause: error });
	}
	return new ProviderError('NETWORK_ERROR', `network-level failure for provider '${providerId}': ${errorText(error)}`, { providerId, modelId, cause: error });
}

/** Error text without leaking stack internals into assertions. */
export function errorText(error: unknown): string {
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
}

/** Reads a full error body (drained) for classification. */
export async function readErrorBody(response: HttpPortResponse): Promise<string> {
	try {
		return await collectBodyText(response.bytes());
	} catch {
		return '';
	}
}

/**
 * Status-class mapping shared by all HTTP vendor families: 401/403 ->
 * AUTH_FAILED/PERMISSION_DENIED, 404 -> NOT_FOUND, 429 -> RATE_LIMITED
 * (Retry-After honored), 5xx -> PROVIDER_OVERLOADED, other 4xx -> caller
 * refines (BAD_REQUEST vs CONTEXT_OVERFLOW by message sniffing).
 */
export function classifyHttpStatus(status: number, retryAfterMs: number | undefined, providerId: string, modelId: string | undefined, message: string): ProviderError {
	if (status === 401) {
		return new ProviderError('AUTH_FAILED', message, { status, providerId, modelId });
	}
	if (status === 403) {
		return new ProviderError('PERMISSION_DENIED', message, { status, providerId, modelId });
	}
	if (status === 404) {
		return new ProviderError('NOT_FOUND', message, { status, providerId, modelId });
	}
	if (status === 429) {
		return new ProviderError('RATE_LIMITED', message, { status, retryAfterMs, providerId, modelId });
	}
	if (status >= 500) {
		return new ProviderError('PROVIDER_OVERLOADED', message, { status, providerId, modelId });
	}
	return new ProviderError('BAD_REQUEST', message, { status, providerId, modelId });
}

/** Detects context-window overflow wording across vendor families (message sniffing layer). */
export function looksLikeContextOverflow(message: string): boolean {
	return /context length|too long|too many tokens|prompt is too long|exceeds the context|maximum context|context window/i.test(message);
}

/** Throws CANCELLED when the caller's signal fired (checked between every event). */
export function throwIfCancelled(signal: AbortSignal | undefined, providerId: string): void {
	if (signal?.aborted === true) {
		throw new ProviderError('CANCELLED', `request cancelled by caller (${providerId}) before the next event`, { providerId });
	}
}

/** Assembles ProviderCapabilities from a model descriptor + provider posture. */
export function capabilitiesFor(model: ModelDescriptor, wireFamily: WireFamily, locality: 'local' | 'remote', tokenCounting: 'estimated' | 'provider-reported' | 'both'): ProviderCapabilities {
	return {
		wireFamily,
		inputModalities: model.inputModalities,
		outputModalities: ['text'] as readonly Modality[],
		contextWindowTokens: model.contextWindowTokens,
		maxOutputTokens: model.maxOutputTokens,
		streaming: true,
		toolCalling: model.toolCalling,
		tokenCounting,
		locality,
		...(model.cost === undefined ? {} : { cost: model.cost }),
	};
}

/** Health report helper: measures latency through the injected clock. */
export async function timedHealth(providerId: string, clock: Clock, probe: () => Promise<{ status: 'healthy' | 'degraded' | 'unavailable'; detail: string }>): Promise<{ providerId: string; status: 'healthy' | 'degraded' | 'unavailable'; checkedAt: number; latencyMs: number; detail: string }> {
	const startedAt = clock();
	const outcome = await probe();
	return {
		providerId,
		status: outcome.status,
		checkedAt: clock(),
		latencyMs: clock() - startedAt,
		detail: outcome.detail,
	};
}
