/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the production HTTP port implementation (M1).
 *
 * `nodeHttpPort` is the Node-stdlib wiring of the HttpPort contract: the
 * global fetch with an AbortSignal composition for the wall-clock budget and
 * the caller's cancellation signal, and a streaming byte body read from the
 * fetch ReadableStream. Zero runtime dependencies; the SAME implementation
 * serves production (real endpoints) and the fixture drills (local
 * node:http servers on 127.0.0.1) -- which is exactly what makes the
 * fixture evidence meaningful for the production code path.
 *
 * Abort semantics: a request aborted by the wall-clock budget rejects with
 * HttpPortAbortError('timeout'); one aborted by the caller's signal rejects
 * with HttpPortAbortError('signal'); both during connect AND during body
 * streaming. Any other rejection (connection refused, DNS failure, TLS
 * error) passes through as-is -- adapters classify those as NETWORK_ERROR.
 */

import { type HttpPort, type HttpPortRequest, type HttpPortResponse, HttpPortAbortError } from './ports.ts';


/** True when the error looks like a fetch abort (DOMException name AbortError, or TimeoutError from AbortSignal.timeout). */
function isAbortLike(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) {
		return false;
	}
	const name = (error as { name?: unknown }).name;
	return name === 'AbortError' || name === 'TimeoutError';
}

/** The Node-stdlib HttpPort (global fetch; zero dependencies). */
export const nodeHttpPort: HttpPort = {
	async request(request: HttpPortRequest): Promise<HttpPortResponse> {
		const timeoutSignal = request.timeoutMs === undefined ? undefined : AbortSignal.timeout(request.timeoutMs);
		const signal = timeoutSignal === undefined ? request.signal : request.signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, request.signal]);
		const abortReason = (): 'timeout' | 'signal' => (request.signal?.aborted === true ? 'signal' : 'timeout');
		let response: Awaited<ReturnType<typeof fetch>>;
		try {
			response = await fetch(request.url, {
				method: request.method,
				...(request.headers === undefined ? {} : { headers: request.headers }),
				...(request.body === undefined ? {} : { body: request.body }),
				...(signal === undefined ? {} : { signal }),
			});
		} catch (error) {
			if (isAbortLike(error)) {
				throw new HttpPortAbortError(abortReason(), `request aborted (${abortReason()}): ${request.method} ${redactUrl(request.url)}`);
			}
			throw error;
		}
		const headers: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
		return {
			status: response.status,
			statusText: response.statusText,
			headers,
			async *bytes(): AsyncGenerator<Uint8Array, void, void> {
				const reader = response.body?.getReader();
				if (reader === undefined || reader === null) {
					return;
				}
				while (true) {
					let read: { done: boolean; value?: Uint8Array };
					try {
						read = await reader.read();
					} catch (error) {
						if (isAbortLike(error)) {
							throw new HttpPortAbortError(abortReason(), `body stream aborted (${abortReason()}): ${request.method} ${redactUrl(request.url)}`);
						}
						throw error;
					}
					if (read.done) {
						return;
					}
					if (read.value !== undefined) {
						yield read.value;
					}
				}
			},
		};
	},
};

/**
 * URL redaction for error text: keeps the origin + path, strips the query
 * (some vendors put hints there) and any credentials. Error messages are the
 * one place request data could leak into logs -- they never carry key
 * material here because keys live only in headers.
 */
export function redactUrl(url: string): string {
	const withoutQuery = url.split('?')[0] ?? url;
	return withoutQuery.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^@/]+@/, (scheme) => `${scheme.split('://')[0]}://<redacted>@`);
}
