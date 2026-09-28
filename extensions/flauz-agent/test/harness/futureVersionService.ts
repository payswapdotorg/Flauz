/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S1 M4 test harness - a service that answers the v1 handshake with a
 * FUTURE protocol version ('flauz.seam/v99') the boundary does not know.
 * Pins the adapter's fail-closed negotiated-version guard: a service the
 * boundary cannot reason about is a protocol mismatch, never a guess.
 */

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

function handleLine(line: string): void {
	if (line.trim().length === 0) {
		return;
	}
	let message: { type?: string; id?: number; cmd?: string };
	try {
		message = JSON.parse(line) as { type?: string; id?: number; cmd?: string };
	} catch {
		send({ type: 'error', message: 'unparseable line' });
		return;
	}
	if (message.type === 'hello') {
		send({ type: 'ready', service: 'flauz-core-service', version: '0.1.0', schema: 'flauz.tasks/v0', protocolVersion: 'flauz.seam/v99', capabilities: ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace'] });
		return;
	}
	if (typeof message.id === 'number' && typeof message.cmd === 'string') {
		send({ id: message.id, ok: false, error: { code: 'flauz.err.unknown-method', message: `unknown command: ${message.cmd}` } });
		return;
	}
	send({ type: 'error', message: 'unrecognized message' });
}

process.stdin.on('end', () => exitOnce(0));
process.stdin.on('close', () => exitOnce(0));
process.on('SIGTERM', () => exitOnce(0));
process.stdin.resume();
