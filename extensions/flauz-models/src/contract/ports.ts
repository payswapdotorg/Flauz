/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the injected side-effecting ports (M1).
 *
 * Every adapter and every durable store in this extension receives its
 * effects as PORTS: HTTP, secrets, filesystem, clock, hashing. This is what
 * keeps vendor coupling at zero (adapters speak HTTP shapes, never SDKs),
 * keeps credentials out of code and artifacts (SecretResolverPort holds
 * references only), and lets the whole fabric run under `node --test`
 * against LOCAL fixture servers with deterministic clocks.
 *
 * The shapes follow the discipline already established by
 * extensions/flauz-environments (its lifecycle HttpPort / SecretResolverPort
 * / FileSystemPort / Clock) so the two extensions read as one fabric.
 */

/** One HTTP request through the port. */
export interface HttpPortRequest {
	readonly method: 'GET' | 'POST' | 'DELETE';
	readonly url: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly body?: string;
	/** Wall-clock budget for the whole request. */
	readonly timeoutMs?: number;
	/** Cooperative cancellation; aborting rejects with HttpPortAbortError. */
	readonly signal?: AbortSignal;
}

/** One HTTP response: status + headers + a STREAMING byte body. */
export interface HttpPortResponse {
	readonly status: number;
	readonly statusText: string;
	/** Response headers, keys lower-cased. */
	readonly headers: Readonly<Record<string, string>>;
	/** Sequential body bytes (SSE/NDJSON chunks arrive here as they are sent). */
	bytes(): AsyncGenerator<Uint8Array, void, void>;
}

/**
 * The fetch-like HTTP port. Production wiring is `nodeHttpPort` (the Node
 * stdlib global fetch); tests use the same implementation against LOCAL
 * fixture servers. Non-2xx statuses are RETURNED, not thrown -- status
 * interpretation is adapter logic.
 */
export interface HttpPort {
	request(request: HttpPortRequest): Promise<HttpPortResponse>;
}

/**
 * Thrown by an HttpPort when a request is aborted, either by its wall-clock
 * budget (`timeout`) or by the caller's signal (`signal`). Adapters map
 * these to TIMEOUT / CANCELLED respectively.
 */
export class HttpPortAbortError extends Error {
	readonly abortReason: 'timeout' | 'signal';

	constructor(abortReason: 'timeout' | 'signal', message: string) {
		super(message);
		this.name = 'HttpPortAbortError';
		this.abortReason = abortReason;
	}
}

/**
 * Vault-reference resolver port. Production wiring resolves `env:<NAME>`
 * from the process environment and `vault:<NAME>` from the workspace secret
 * surface; tests inject a stub. Returns undefined when the reference cannot
 * be resolved -- adapters map that to CREDENTIAL_UNRESOLVED (fail closed)
 * and never see key material they were not handed. The resolved value is
 * used ONLY in the authorization header of the in-flight request: never
 * logged, never persisted, never echoed in error text.
 */
export interface SecretResolverPort {
	resolve(ref: string): Promise<string | undefined>;
}

/**
 * Filesystem port for the durable `.flauz/models` state (same shape as the
 * environments extension's port: readFileUtf8 returns undefined for ENOENT,
 * writeFile + rename give atomic tmp-then-replace writes).
 */
export interface FileSystemPort {
	readFileUtf8(path: string): Promise<string | undefined>;
	writeFile(path: string, contents: string): Promise<void>;
	rename(fromPath: string, toPath: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/** Injectable clock (epoch ms; deterministic in tests, Date.now in the host). */
export type Clock = () => number;

/** Injectable sha256 (production: node:crypto; the request-hash provenance source). */
export interface HashPort {
	sha256Hex(input: string): string;
}
