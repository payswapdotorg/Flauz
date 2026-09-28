/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The FROZEN v0-only seam service, pinned from the TL1-003 base commit
 * (bfeb5e2df916ff220e750e93ae89e7412d109f19 `core/service.mjs`): it speaks
 * EXACTLY the v0 wire contract and nothing else. Spawned by
 * test/protocol.conformance.test.ts through the REAL SeamClient to prove the
 * backward-compat direction "v1-capable client against a v0-only service":
 *
 *   F -> G: {"type":"hello","client":"...","version":"0.1.0","globalStoragePath":"..."}
 *           (a v0 service IGNORES unknown hello fields such as `protocolVersions`)
 *   G -> F: {"type":"ready","service":"flauz-core-service","version":"0.1.0","schema":"flauz.tasks/v0"}
 *   F -> G: {"id":1,"cmd":"...","args":{...}}
 *   G -> F: {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":"<string>"}
 *
 * Minimal by design: it only needs to exercise the client paths that the
 * conformance suite asserts (handshake fallback, workspace method, ping,
 * string errors, clean shutdown). Run as a plain Node child process
 * (Node >= 23.6 type stripping — the package's own test discipline).
 */

const root = process.argv[2] ?? process.env.FLAUZ_WORKSPACE_ROOT;
if (!root) {
	process.stderr.write('usage: node v0Service.ts <workspaceRoot>\n');
	process.exit(2);
}

let exited = false;
const exitOnce = (code: number): void => {
	if (exited) {
		return;
	}
	exited = true;
	setImmediate(() => process.exit(code));
};

const send = (message: unknown): void => {
	process.stdout.write(`${JSON.stringify(message)}\n`);
};

interface V0Request {
	id?: unknown;
	cmd?: unknown;
	args?: unknown;
}

const handleLine = (line: string): void => {
	if (line.trim().length === 0) {
		return;
	}
	let message: V0Request & { type?: unknown; globalStoragePath?: unknown };
	try {
		message = JSON.parse(line) as V0Request & { type?: unknown; globalStoragePath?: unknown };
	} catch {
		send({ type: 'error', message: 'unparseable line' });
		return;
	}
	if (message.type === 'hello') {
		// The frozen v0 ready: exactly the four legacy keys, same order,
		// NO protocolVersion/capabilities — the v1 client must fall back.
		send({ type: 'ready', service: 'flauz-core-service', version: '0.1.0', schema: 'flauz.tasks/v0' });
		return;
	}
	if (typeof message.id === 'number' && typeof message.cmd === 'string') {
		if (message.cmd === 'ping') {
			send({ id: message.id, ok: true, result: { pong: true, ts: Date.now() } });
			return;
		}
		if (message.cmd === 'shutdown') {
			send({ id: message.id, ok: true, result: { ok: true } });
			exitOnce(0);
			return;
		}
		if (message.cmd === 'flauz.workspace.createTask') {
			const args = (message.args ?? {}) as { title?: unknown };
			if (typeof args.title !== 'string' || args.title.trim().length === 0) {
				send({ id: message.id, ok: false, error: 'createTask requires a non-empty string title' });
				return;
			}
			send({ id: message.id, ok: true, result: { taskId: 'T-001' } });
			return;
		}
		send({ id: message.id, ok: false, error: `unknown command: ${message.cmd}` });
		return;
	}
	send({ type: 'error', message: 'unrecognized message' });
};

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	let newline = buffer.indexOf('\n');
	while (newline !== -1) {
		const line = buffer.slice(0, newline);
		buffer = buffer.slice(newline + 1);
		handleLine(line);
		newline = buffer.indexOf('\n');
	}
});
process.stdin.on('end', () => {
	if (buffer.trim().length > 0) {
		handleLine(buffer);
		buffer = '';
	}
	exitOnce(0);
});
process.stdin.on('close', () => exitOnce(0));
process.on('SIGTERM', () => exitOnce(0));
process.stdin.resume();
