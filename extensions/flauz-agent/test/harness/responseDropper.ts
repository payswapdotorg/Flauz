/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M4 test harness - a thin NDJSON proxy over the REAL core service
 * that makes response loss, mid-command death and malformed-input noise
 * DETERMINISTIC (the v0Service.ts frozen-stub precedent, higher fidelity:
 * the real service is still the real service; only the transport is
 * observed).
 *
 * Spawned exactly like the real service (the adapter/SeamClient cannot tell
 * the difference):
 *
 *   node responseDropper.ts <workspaceRoot>
 *
 * Behavior is configured by a SPEC FILE at `<workspaceRoot>.dropspec.json`
 * (a sibling of the workspace directory, never inside .flauz/):
 *
 *   {
 *     "drop": [{ "method": "flauz.workspace.createTask", "count": 1 }],
 *     "killOn": [{ "method": "flauz.a2a.post" }],
 *     "injectGarbageAfterReady": true
 *   }
 *
 *  - drop:    forward the request, then drop the FIRST <count> RESPONSE
 *             lines of that method (the request was delivered; the response
 *             is lost - the deterministic mid-command loss case).
 *  - killOn:  forward the request, then SIGKILL the real service (the
 *             response can never arrive - the deterministic mid-command
 *             death case).
 *  - injectGarbageAfterReady: after forwarding the ready line, send one
 *             unparseable line to the service as if from the client (the
 *             service answers a type:"error" line; the session must keep
 *             serving - SERVICE-SEAM section 2).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

interface DropSpec {
	drop?: Array<{ method: string; count: number }>;
	killOn?: Array<{ method: string }>;
	injectGarbageAfterReady?: boolean;
}

const SERVICE_PATH = fileURLToPath(new URL('../../core/service.mjs', import.meta.url));
const root = process.argv[2] ?? process.env.FLAUZ_WORKSPACE_ROOT;
if (!root) {
	process.stderr.write('usage: node responseDropper.ts <workspaceRoot>\n');
	process.exit(2);
}

const specPath = `${root}.dropspec.json`;
let spec: DropSpec = {};
try {
	spec = JSON.parse(readFileSync(specPath, 'utf-8')) as DropSpec;
} catch {
	spec = {};
}

/**
 * Consumption is ONE-SHOT ACROSS INSTANCES: every consumed drop/kill is
 * decremented BACK INTO the spec file, so a service re-spawned by recovery
 * (a fresh dropper reading the same spec path) does not replay the fault -
 * the fault fires exactly as many times as the spec says, never per spawn.
 */
function persistSpec(): void {
	try {
		writeFileSync(specPath, `${JSON.stringify(spec)}\n`);
	} catch {
		// The spec is best-effort persistent; the in-memory state still holds.
	}
}

const dropRemaining = new Map<string, number>((spec.drop ?? []).map((entry) => [entry.method, entry.count]));
const killOn = new Set((spec.killOn ?? []).map((entry) => entry.method));

/** Set when a killOn fault fired: service lines still in the pipe are dropped. */
let killed = false;

const service: ChildProcess = spawn(process.execPath, [SERVICE_PATH, root], { stdio: ['pipe', 'pipe', 'pipe'] });
service.stderr?.on('data', (chunk: { toString(encoding?: string): string }) => process.stderr.write(chunk.toString()));
service.on('close', (code: number | null) => {
	// Mirror the real service's exit; nothing more to say.
	process.exit(code ?? 0);
});

/** Request id -> method (so responses can be attributed deterministically). */
const idToMethod = new Map<number, string>();

const forwardToService = (line: string): void => {
	service.stdin?.write(`${line}\n`);
};

service.stdout?.setEncoding('utf-8');
service.stdout?.on('data', (chunk: { toString(encoding?: string): string }) => {
	let buffer = chunk.toString();
	let newline = buffer.indexOf('\n');
	while (newline !== -1) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		handleServiceLine(line);
		newline = buffer.indexOf('\n');
	}
});

function handleServiceLine(line: string): void {
	if (killed) {
		// The service died mid-command: a response that already sat in the
		// stdout pipe buffer must never reach the client (the harness's
		// deterministic-death contract).
		return;
	}
	if (line.trim().length === 0) {
		return;
	}
	let message: { type?: string; id?: number; ok?: boolean };
	try {
		message = JSON.parse(line) as { type?: string; id?: number; ok?: boolean };
	} catch {
		process.stdout.write(`${line}\n`);
		return;
	}
	if (typeof message.id === 'number' && message.ok !== undefined) {
		const method = idToMethod.get(message.id);
		if (method !== undefined && (dropRemaining.get(method) ?? 0) > 0) {
			dropRemaining.set(method, (dropRemaining.get(method) ?? 0) - 1);
			spec = { ...spec, drop: (spec.drop ?? []).map((entry) => ({ ...entry, count: Math.max(0, dropRemaining.get(entry.method) ?? 0) })) };
			persistSpec();
			idToMethod.delete(message.id);
			return; // the response is lost - exactly the deterministic loss case
		}
		idToMethod.delete(message.id);
	}
	if (message.type === 'ready' && spec.injectGarbageAfterReady === true) {
		process.stdout.write(`${line}\n`);
		// As if a broken client spoke right after the handshake.
		service.stdin?.write('this is not json\n');
		return;
	}
	process.stdout.write(`${line}\n`);
}

let clientBuffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: { toString(encoding?: string): string }) => {
	clientBuffer += chunk.toString();
	let newline = clientBuffer.indexOf('\n');
	while (newline !== -1) {
		const line = clientBuffer.slice(0, newline);
		clientBuffer = clientBuffer.slice(newline + 1);
		handleClientLine(line);
		newline = clientBuffer.indexOf('\n');
	}
});

function handleClientLine(line: string): void {
	if (line.trim().length === 0) {
		return;
	}
	try {
		const message = JSON.parse(line) as { id?: number; cmd?: string };
		if (typeof message.id === 'number' && typeof message.cmd === 'string') {
			idToMethod.set(message.id, message.cmd);
			forwardToService(line);
			if (killOn.has(message.cmd)) {
				// The request WAS delivered; the process dies before the
				// response can ever be written. Consume the fault so a
				// respawned dropper (recovery) does not kill again.
				killOn.delete(message.cmd);
				spec = { ...spec, killOn: [...killOn].map((method) => ({ method })) };
				persistSpec();
				// Suppress-and-kill (2026-09-29 race fix): the response line can
				// beat the SIGKILL through the pipe buffers on fast runners -
				// a raced-in success would resolve the pending request and
				// break the harness's deterministic-death contract. The kill
				// flag drops every service line still in flight; the death (or
				// the request timeout) is the only possible outcome.
				killed = true;
				service.kill('SIGKILL');
			}
			return;
		}
	} catch {
		// Not a request line: forward verbatim (hello, noise, ...).
	}
	forwardToService(line);
}

process.stdin.on('end', () => {
	service.stdin?.end();
});
