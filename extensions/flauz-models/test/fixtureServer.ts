/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the zero-dependency fixture server (M2 test infra).
 *
 * A local node:http server on 127.0.0.1:0 that REPLAYS canned vendor routes:
 * single bodies, sequential frame writes (SSE / NDJSON) with per-frame
 * delays, arbitrary statuses, and arbitrary headers. It captures every
 * incoming request (method, path, headers, body) so adapter tests can assert
 * the exact vendor wire shapes the adapters produce.
 *
 * NO external network: everything stays on loopback. All evidence produced
 * through this server is FIXTURE-VERIFIED -- it says the adapter speaks the
 * vendor wire shape correctly, never that a live provider was contacted
 * (live-provider verification is a recorded future integration gap).
 */

import * as http from 'node:http';

/** One request captured by the fixture server (most recent last). */
export interface CapturedRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: Record<string, string | string[] | undefined>;
	readonly body: string;
}

/** A canned route the server replays. */
export interface FixtureRoute {
	/** Exact path to match (e.g. '/v1/chat/completions'); '' matches any path. */
	readonly path: string;
	/** HTTP method to match (default: any method). */
	readonly method?: string;
	/** Response status (default 200). */
	readonly status?: number;
	/** Response headers (default: Content-Type application/json). */
	readonly headers?: Readonly<Record<string, string>>;
	/** Single-shot response body. */
	readonly body?: string;
	/**
	 * Sequential raw frame writes (each string written verbatim -- SSE frames
	 * carry their own terminators in the canned data). Writes are separated
	 * by frameDelayMs so cancellation and mid-stream aborts are exercisable.
	 */
	readonly frames?: readonly string[];
	/** Delay before the first byte (connection + scheduling realism). */
	readonly initialDelayMs?: number;
	/** Delay between frame writes (default 1ms so streaming is observable). */
	readonly frameDelayMs?: number;
}

/** The running fixture server handle. */
export interface FixtureServer {
	readonly port: number;
	/** Captured requests, most recent last (never cleared). */
	readonly requests: readonly CapturedRequest[];
	/** Replace the route table (tests swap scenarios without a new server). */
	setRoutes(routes: readonly FixtureRoute[]): void;
	/** Last-resort failure injection applied before route matching. */
	setOverride(override: ((request: CapturedRequest) => { readonly status: number; readonly body?: string } | undefined) | undefined): void;
	close(): Promise<void>;
}

function write(res: http.ServerResponse, status: number, headers: Record<string, string>, body: string): void {
	res.writeHead(status, headers);
	res.end(body);
}

/**
 * Starts the fixture server on 127.0.0.1:0 with the given routes. The server
 * responds 404 `{"error":"fixture: no route"}` for unmatched requests so a
 * mis-wired adapter shows up as a loud NOT_FOUND rather than a hang.
 */
export function startFixtureServer(routes: readonly FixtureRoute[]): Promise<FixtureServer> {
	const captured: CapturedRequest[] = [];
	let routeTable: readonly FixtureRoute[] = routes;
	let override: ((request: CapturedRequest) => { readonly status: number; readonly body?: string } | undefined) | undefined;
	const server = http.createServer((req, res) => {
		const chunks: Array<{ toString(encoding?: string): string }> = [];
		req.on('data', (chunk: { toString(encoding?: string): string }) => chunks.push(chunk));
		req.on('end', () => {
			const body = chunks.map(chunk => chunk.toString('utf-8')).join('');
			const request: CapturedRequest = { method: req.method ?? '', path: req.url ?? '', headers: { ...req.headers }, body };
			captured.push(request);
			const injected = override?.(request);
			if (injected !== undefined) {
				write(res, injected.status, { 'Content-Type': 'application/json' }, injected.body ?? '');
				return;
			}
			const route = routeTable.find(candidate => (candidate.path === '' || candidate.path === request.path) && (candidate.method === undefined || candidate.method === request.method));
			if (route === undefined) {
				write(res, 404, { 'Content-Type': 'application/json' }, JSON.stringify({ error: 'fixture: no route', path: request.path }));
				return;
			}
			const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(route.headers ?? {}) };
			res.writeHead(route.status ?? 200, headers);
			if (route.body !== undefined) {
				res.end(route.body);
				return;
			}
			const frames = route.frames ?? [];
			const frameDelayMs = route.frameDelayMs ?? 1;
			if (frames.length === 0) {
				res.end('');
				return;
			}
			const initialDelayMs = route.initialDelayMs ?? 0;
			setTimeout(() => {
				let index = 0;
				const writeNext = (): void => {
					if (index >= frames.length) {
						res.end();
						return;
					}
					const frame = frames[index];
					index += 1;
					res.write(frame);
					setTimeout(writeNext, frameDelayMs);
				};
				writeNext();
			}, initialDelayMs);
		});
	});
	return new Promise<FixtureServer>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const port = server.address().port;
			resolve({
				port,
				requests: captured,
				setRoutes(next: readonly FixtureRoute[]): void {
					routeTable = next;
				},
				setOverride(next: ((request: CapturedRequest) => { readonly status: number; readonly body?: string } | undefined) | undefined): void {
					override = next;
				},
				close(): Promise<void> {
					return new Promise((resolveClose, rejectClose) => {
						server.closeAllConnections?.();
						server.close((error?: Error) => (error === undefined ? resolveClose() : rejectClose(error)));
					});
				},
			});
		});
	});
}
