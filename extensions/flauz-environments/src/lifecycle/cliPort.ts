/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 — the `CliPort` seam (3.1).
 *
 * EVERY process the real remote executors (`SshCliExecutor`, `DockerCliExecutor`)
 * spawn goes through this ONE port — the local-real executor keeps its own
 * `ProcessPort` (TL3-003; a long-lived child handle for the fixed harness),
 * while the CLI executors drive SYSTEM binaries through short-lived bounded
 * invocations. This is both the TEST seam (`FakeCli` scripts argv + canned
 * results, so every failure class is provable without real binaries) and the
 * DISCIPLINE POINT: audits can grep for `spawnCli(` to find every place a
 * provider process comes from, and the injection law stays one-port-wide —
 * argv arrays are ALWAYS executor-constructed from validated descriptor DATA
 * fields (host/port/user/image are data; command/shell/script fields do not
 * exist in `flauz.environments/v0` and never reach argv).
 *
 * Semantics (typed results, never raw throws):
 *   - `exitCode`   : the child's exit status, or null when the process was
 *                    killed by a signal / never started.
 *   - `timedOut`   : true when the wall-clock budget expired; the child is
 *                    SIGKILLed and whatever stdout/stderr was collected so
 *                    far is returned (the kill IS the escalation).
 *   - `spawnError` : set when the BINARY ITSELF could not be spawned (the
 *                    common dev-box ENOENT case) — the executor's capability
 *                    probe maps this to the typed `CLI_NOT_AVAILABLE`
 *                    fail-closed error class. Never a crash, never a silent
 *                    fallback.
 *   - `stdin`      : bytes written to the child's stdin before close — this
 *                    is how the FIXED harness (`fixtures/env-agent.ts`)
 *                    ships to `ssh <target> node -` (script-on-stdin, the
 *                    command-free pipe).
 *
 * Production implementation `NodeCliPort` wraps `node:child_process.spawn`
 * (Node stdlib only; zero runtime dependencies). Output is capped at
 * `MAX_OUTPUT_CHARS` per stream as a defensive bound.
 */
import { spawn } from 'node:child_process';

/** Result of one bounded CLI invocation. */
export interface CliRunResult {
	readonly stdout: string;
	readonly stderr: string;
	/** Child exit status; null when killed by a signal or never started. */
	readonly exitCode: number | null;
	/** True when `timeoutMs` expired (the child was SIGKILLed). */
	readonly timedOut: boolean;
	/** Present when the binary itself could not be spawned (ENOENT class). */
	readonly spawnError?: string;
}

/** Options for one CLI invocation. */
export interface CliRunOptions {
	/** Bytes written to the child's stdin (then closed — the harness ship). */
	readonly stdin?: string;
	/** Wall-clock budget; expiry SIGKILLs the child and returns `timedOut`. */
	readonly timeoutMs?: number;
	/** Extra env merged over the parent env (the ProcessPort pattern). */
	readonly env?: Record<string, string | undefined>;
}

/** The process seam: every real provider CLI invocation comes from here. */
export interface CliPort {
	spawnCli(argv: readonly string[], options?: CliRunOptions): Promise<CliRunResult>;
}

/** Defensive cap on collected output per stream (8 MB of UTF-16 chars). */
const MAX_OUTPUT_CHARS = 8 * 1024 * 1024;

/**
 * The Node-stdlib implementation (the extension host and the live tests wire
 * this; `FakeCli` stands in for the scripted suites).
 */
export class NodeCliPort implements CliPort {
	spawnCli(argv: readonly string[], options?: CliRunOptions): Promise<CliRunResult> {
		return new Promise(resolve => {
			if (argv.length === 0 || typeof argv[0] !== 'string' || argv[0].length === 0) {
				resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, spawnError: 'empty argv' });
				return;
			}
			const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
			let child;
			try {
				child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env });
			} catch (err) {
				resolve({ stdout: '', stderr: '', exitCode: null, timedOut: false, spawnError: err instanceof Error ? err.message : String(err) });
				return;
			}
			let stdout = '';
			let stderr = '';
			let settled = false;
			let timedOut = false;
			const finish = (exitCode: number | null, spawnError?: string): void => {
				if (settled) {
					return;
				}
				settled = true;
				if (timer !== undefined) {
					clearTimeout(timer);
				}
				resolve({ stdout, stderr, exitCode, timedOut, ...(spawnError === undefined ? {} : { spawnError }) });
			};
			const timer = options?.timeoutMs === undefined ? undefined : setTimeout(() => {
				timedOut = true;
				try { child.kill('SIGKILL'); } catch { /* already gone */ }
			}, options?.timeoutMs);
			child.on('error', err => finish(null, err.message));
			child.on('close', code => finish(code));
			if (child.stdout !== null) {
				child.stdout.on('data', (chunk: { toString(encoding?: string): string }) => {
					if (stdout.length < MAX_OUTPUT_CHARS) {
						stdout += chunk.toString('utf-8');
					}
				});
			}
			if (child.stderr !== null) {
				child.stderr.on('data', (chunk: { toString(encoding?: string): string }) => {
					if (stderr.length < MAX_OUTPUT_CHARS) {
						stderr += chunk.toString('utf-8');
					}
				});
			}
			if (child.stdin !== null) {
				if (options?.stdin !== undefined) {
					try {
						child.stdin.write(options.stdin);
					} catch {
						// the child may have exited already; surfaced via close
					}
				}
				try {
					child.stdin.end();
				} catch {
					// already closed
				}
			}
		});
	}
}

// ---------------------------------------------------------------------------
// The FIXED-harness stdio protocol reader (shared by the CLI executors)
// ---------------------------------------------------------------------------

/**
 * Parses the fixed harness's stdio protocol out of captured output (the
 * `node -` script's stdout: one JSON line per event). Returns the pid from
 * the FIRST `ready` event, or the first `error` message — the same protocol
 * the local-real executor reads off its child's stdout.
 */
export function parseHarnessStdio(text: string): { readyPid?: number; error?: string } {
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim();
		if (line.length === 0) {
			continue;
		}
		try {
			const event = JSON.parse(line) as { type?: unknown; pid?: unknown; message?: unknown };
			if (event.type === 'ready' && typeof event.pid === 'number') {
				return { readyPid: event.pid };
			}
			if (event.type === 'error' && typeof event.message === 'string') {
				return { error: event.message };
			}
		} catch {
			// non-JSON noise is ignored (the harness speaks JSON lines only)
		}
	}
	return {};
}

/** Truncates a stderr excerpt for typed error messages (no wall-of-noise). */
export function excerpt(text: string, max = 200): string {
	const cleaned = text.trim().replace(/\s+/g, ' ');
	return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 1)}…`;
}
