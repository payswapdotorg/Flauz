/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-004 rung 1 test infrastructure — `FakeCli`: a scriptable `CliPort`.
 *
 * Records every argv (and the stdin payload + timeout the executor passed),
 * returns canned results — either from a FIFO queue (precise call-by-call
 * scripts) or from a test-supplied handler (stateful/command-driven doubles:
 * "make `docker inspect` say it's running", "make the harness log contain a
 * ready line", ...). This is what proves the CLI executors' happy paths AND
 * every failure class (probe failure, launch failure, timeout+kill
 * escalation, readiness-window expiry, never-signal-foreign-pids) WITHOUT
 * real binaries — the live binaries get their own skip-gated suite
 * (liveRemote.test.ts).
 */
import type { CliPort, CliRunOptions, CliRunResult } from '../src/lifecycle/cliPort.ts';

/** A canned or computed result (partial — defaults filled in). */
export type FakeCliResult = Partial<CliRunResult>;

/** One recorded invocation. */
export interface FakeCliCall {
	readonly argv: readonly string[];
	readonly stdin?: string;
	readonly timeoutMs?: number;
}

function normalize(result: FakeCliResult): CliRunResult {
	return {
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		exitCode: result.exitCode === undefined ? 0 : result.exitCode,
		timedOut: result.timedOut ?? false,
		...(result.spawnError === undefined ? {} : { spawnError: result.spawnError }),
	};
}

export class FakeCli implements CliPort {
	/** Every invocation in order (the audit surface the tests assert on). */
	readonly calls: FakeCliCall[] = [];
	/** Handler consulted when the FIFO queue is empty (stateful doubles). */
	handler?: (argv: readonly string[], options?: CliRunOptions) => FakeCliResult;

	private readonly queue: FakeCliResult[] = [];

	/** Queues the result for the NEXT spawnCli call (FIFO). */
	queueResult(result: FakeCliResult): this {
		this.queue.push(result);
		return this;
	}

	/** Convenience: queue several results in order. */
	queueResults(results: readonly FakeCliResult[]): this {
		for (const result of results) {
			this.queue.push(result);
		}
		return this;
	}

	async spawnCli(argv: readonly string[], options?: CliRunOptions): Promise<CliRunResult> {
		this.calls.push({
			argv: [...argv],
			...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
			...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
		});
		const queued = this.queue.shift();
		if (queued !== undefined) {
			return normalize(queued);
		}
		if (this.handler !== undefined) {
			return normalize(this.handler(argv, options));
		}
		return normalize({});
	}

	/** Calls whose argv contains the token (e.g. 'run', 'inspect', 'kill'). */
	callsWith(token: string): FakeCliCall[] {
		return this.calls.filter(call => call.argv.includes(token));
	}

	/** The recorded stdin payloads (harness-shipping assertions). */
	stdins(): string[] {
		return this.calls.map(call => call.stdin).filter((stdin): stdin is string => stdin !== undefined);
	}

	/** True when any recorded argv contains the exact token. */
	everCalledWith(token: string): boolean {
		return this.calls.some(call => call.argv.includes(token));
	}
}
