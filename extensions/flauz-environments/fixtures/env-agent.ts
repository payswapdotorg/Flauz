/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * flauz-environments FIXED harness (TL3-003 local-real executor).
 *
 * This is the ONLY executable the LocalProcessExecutor ever spawns — a tiny
 * stdio-protocol sleeper/state-tracker. Descriptor-supplied execution is
 * FORBIDDEN (fail-closed against injection): environments can never carry
 * command/shell/script fields; the executor runs THIS file and nothing else,
 * with arguments it constructs itself.
 *
 * Protocol (stdio, one JSON line per event):
 *   stdout -> {"type":"ready","pid":N}              once the state file lands
 *            {"type":"beat","beat":N}              every heartbeat (state file rewritten)
 *            {"type":"pong","beat":N}              reply to a stdin ping
 *            {"type":"stopped","pid":N}            graceful shutdown (SIGTERM/SIGINT)
 *            {"type":"error","message":"..."}      argument/protocol failure (exit 1)
 *   stdin  <- {"cmd":"ping"}                       liveness probe
 *
 * State file (`<state-dir>/state.json`, canonical form: sorted keys, 2-space
 * indent, one trailing newline, atomic tmp+rename writes):
 *   { "beat": N, "environmentId": "...", "pid": N, "schema":
 *     "flauz.env-state/v0", "schemaVersion": 0, "startedAt": <epochMs>,
 *     "status": "running" | "stopped", "stoppedAt": <epochMs> }
 *
 * Run: node fixtures/env-agent.ts --state-dir <dir> --id <envId> [--heartbeat-ms <n>]
 * (Node >= 23.6 type stripping; zero dependencies.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface HarnessArgs {
	stateDir: string;
	envId: string;
	heartbeatMs: number;
	ignoreTermination: boolean;
}

function parseArgs(argv: readonly string[]): HarnessArgs {
	let stateDir: string | undefined;
	let envId: string | undefined;
	let heartbeatMs = 500;
	let ignoreTermination = false;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === '--state-dir') {
			stateDir = argv[++i];
		} else if (arg === '--id') {
			envId = argv[++i];
		} else if (arg === '--heartbeat-ms') {
			const raw = argv[++i];
			const parsed = raw === undefined ? Number.NaN : Number(raw);
			if (!Number.isSafeInteger(parsed) || parsed < 50 || parsed > 60_000) {
				fail(`--heartbeat-ms must be an integer in [50, 60000] (got ${JSON.stringify(raw)})`);
			}
			heartbeatMs = parsed;
		} else if (arg === '--ignore-termination') {
			// DRILL FLAG: refuse graceful termination so executors must exercise
			// the SIGKILL escalation path. Constructed by the executor/tests only.
			ignoreTermination = true;
		} else {
			fail(`unknown argument ${JSON.stringify(arg)} (expected --state-dir <dir> --id <envId> [--heartbeat-ms <n>] [--ignore-termination])`);
		}
	}
	if (stateDir === undefined || envId === undefined || stateDir.length === 0 || envId.length === 0) {
		fail('both --state-dir <dir> and --id <envId> are required');
	}
	return { stateDir, envId, heartbeatMs, ignoreTermination };
}

function emit(event: Record<string, unknown>): void {
	process.stdout.write(`${JSON.stringify(event)}\n`);
}

function fail(message: string): never {
	emit({ type: 'error', message });
	process.exit(1);
}

/** The state document (keys in the canonical sorted order). */
interface EnvState {
	beat: number;
	environmentId: string;
	pid: number;
	schema: string;
	schemaVersion: number;
	startedAt: number;
	status: string;
	stoppedAt?: number;
}

function statePath(stateDir: string): string {
	return path.join(stateDir, 'state.json');
}

/** Canonical serialization: sorted keys, 2-space indent, one trailing newline. */
function serializeState(state: EnvState): string {
	return `${JSON.stringify(state, null, 2)}\n`;
}

/** Atomic write: tmp + rename (the .flauz envelope discipline, DL-9/DL-32). */
function writeState(stateDir: string, state: EnvState): void {
	const target = statePath(stateDir);
	const tmp = `${target}.tmp`;
	fs.writeFileSync(tmp, serializeState(state), { encoding: 'utf-8' });
	fs.renameSync(tmp, target);
}

// -- main ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
fs.mkdirSync(args.stateDir, { recursive: true });

let beat = 0;
let shuttingDown = false;
const startedAt = Date.now();

const baseState = (): EnvState => ({
	beat,
	environmentId: args.envId,
	pid: process.pid,
	schema: 'flauz.env-state/v0',
	schemaVersion: 0,
	startedAt,
	status: 'running',
});

writeState(args.stateDir, baseState());

// 2026-09-27 station fix (merge-wave): arm the signal handlers BEFORE the
// ready line. The executor resolves `start` on ready — and the
// SIGKILL-escalation drill immediately stops — so a SIGTERM arriving
// before these registrations killed the --ignore-termination harness with
// its DEFAULT disposition (observed under CPU load: forcedSignal 'SIGTERM'
// instead of 'SIGKILL' — a load-sensitive race, not a logic bug). Ready
// now implies handlers armed; the protocol itself is unchanged.
process.on('SIGTERM', () => { if (!args.ignoreTermination) { shutdown('SIGTERM'); } });
process.on('SIGINT', () => { if (!args.ignoreTermination) { shutdown('SIGINT'); } });

emit({ type: 'ready', pid: process.pid });

const heartbeat = setInterval(() => {
	beat += 1;
	if (!shuttingDown) {
		writeState(args.stateDir, baseState());
		emit({ type: 'beat', beat });
	}
}, args.heartbeatMs);

function shutdown(signal: string): void {
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	try {
		clearInterval(heartbeat);
	} catch {
		// a signal raced the interval setup (handlers arm before ready) —
		// nothing to clear; the process is exiting anyway
	}
	const final: EnvState = { ...baseState(), status: 'stopped', stoppedAt: Date.now() };
	try {
		writeState(args.stateDir, final);
	} catch {
		// the state dir may already be gone (destroy raced the signal) — the
		// lifecycle ledger, not this file, is the source of truth for state
	}
	emit({ type: 'stopped', pid: process.pid, signal });
	process.exit(0);
}

// stdin protocol: ping -> pong (line-delimited JSON); stdin close -> exit
process.stdin.setEncoding('utf-8');
let buffer = '';
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	let newline = buffer.indexOf('\n');
	while (newline !== -1) {
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (line.length > 0) {
			try {
				const message = JSON.parse(line) as { cmd?: string };
				if (message.cmd === 'ping') {
					emit({ type: 'pong', beat });
				}
			} catch {
				// protocol noise is ignored (the executor speaks JSON lines only)
			}
		}
		newline = buffer.indexOf('\n');
	}
});
process.stdin.on('end', () => {
	// parent went away — no reaper will ever SIGTERM us; exit like a crash stop
	shutdown('stdin-closed');
});
