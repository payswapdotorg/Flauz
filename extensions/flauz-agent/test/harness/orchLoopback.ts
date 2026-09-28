/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The orchestration stdio loopback driver (TL2-001 M4) - the local transport
 * fixture that carries the orchestration protocol contract over a REAL stdio
 * session, composed with the TL1-003 service seam.
 *
 * WHAT THIS PROVES: the orchestration protocol needs NO transport of its
 * own. The seam DEFINITIONS are imported and reused verbatim -
 * negotiateProtocolVersion (the versioning discipline), capabilitiesForVersion
 * (the capability advertisement), seamError + SEAM_ERROR_CODES (the
 * structured error envelope), seamEvent (the wire event envelope) - and the
 * orchestration layer adds only its domain: the additive
 * `orchProtocolVersions` hello key, the additive ready fields
 * (`orchProtocolVersion` + the 'flauz.orch' capability), the
 * `flauz.orch.*` dispatch through the in-process mediator, and the typed
 * failure projection of mediator failures onto the seam error envelope.
 * The ~100 lines of framing below (NDJSON stdin/stdout, serial async
 * processing, deferred exit) are exactly the thin seam the real core service
 * owns when the TL2-S1 secondment wires flauz.orch.* into SEAM_METHODS -
 * nothing here is protocol logic.
 *
 * Wire behavior (seam-compatible by construction):
 *  - handshake-first: nothing dispatchable before hello except the legacy
 *    ping/shutdown; hello re-runs the whole handshake (a re-hello resets the
 *    session, the seam v0-carried behavior);
 *  - version mismatch on the SEAM list: one structured
 *    flauz.err.unsupported-version line + exit 4 (SEAM_EXIT_PROTOCOL_MISMATCH);
 *    an orch-only mismatch (seam versions match, orch versions do not) NEVER
 *    kills the session: the service answers the plain seam ready without
 *    orch fields and the CLIENT surfaces the typed orch failure from the
 *    absent orchProtocolVersion (orchSessionOf) - the domain layer degrades,
 *    the transport survives;
 *  - unparseable lines answer a {type:'error'} line and the session
 *    continues; unknown or non-negotiable methods answer
 *    flauz.err.unknown-method;
 *  - events: under a v1 session the mediator's event stream is wrapped in
 *    seamEvent envelopes and interleaved on stdout; v0 stdout carries
 *    ready/error/response lines only (byte compatibility);
 *  - shutdown ordering: pipelined requests complete in order; after a
 *    shutdown command the session enters draining - further ORCH requests
 *    answer flauz.orch.err.shutting-down (typed, mapped onto the seam error
 *    envelope) while the seam's own commands keep their landed behavior;
 *    repeat shutdowns are all answered; exit 0 after the drain.
 */

import { join } from 'node:path';
import {
	SEAM_PROTOCOL_V1,
	SEAM_EXIT_PROTOCOL_MISMATCH,
	negotiateProtocolVersion,
	capabilitiesForVersion,
	seamError,
	seamEvent,
	isSeamEvent,
	SEAM_ERROR_CODES,
} from '../../core/protocol.mjs';
import {
	ORCH_FAILURE_CODES,
	negotiateOrchVersion,
	orchHelloOffer,
	composeOrchReady,
	orchMethodDispatchable,
	orchFailure,
	orchFailureOf,
} from '../../core/orchProtocol.mjs';
import { OrchestrationMediator } from '../../core/orchMediator.mjs';

const SERVICE_NAME = 'flauz-orch-loopback';
const SERVICE_VERSION = '0.1.0';
const TASKS_SCHEMA = 'flauz.tasks/v0';

interface Session {
	negotiatedSeam: string | null;
	negotiatedOrch: string | null;
	mediator: OrchestrationMediator | null;
	draining: boolean;
}

async function main(): Promise<void> {
	const root = process.argv[2];
	if (typeof root !== 'string' || root.length === 0) {
		process.stderr.write('usage: node orchLoopback.ts <workspaceRoot>\n');
		process.exit(2);
	}

	let session: Session = { negotiatedSeam: null, negotiatedOrch: null, mediator: null, draining: false };
	let exited = false;
	const exitOnce = (code: number): void => {
		if (exited) {
			return;
		}
		exited = true;
		// Defer one macrotask so the final stdout writes flush through the pipe
		// (the service.mjs discipline) AND the drain can settle.
		setImmediate(() => process.exit(code));
	};

	const send = (message: unknown): void => {
		process.stdout.write(`${JSON.stringify(message)}\n`);
	};

	const sendError = (id: number, structured: { code: string; message: string; details?: unknown }, v0String: string): void => {
		if (session.negotiatedSeam === SEAM_PROTOCOL_V1) {
			send({ id, ok: false, error: structured });
		} else {
			send({ id, ok: false, error: v0String });
		}
	};

	/** The orch failure projected onto the seam error envelope (code passthrough: the flauz.orch.err.* codes ride the structured error shape additively). */
	const orchErrorEnvelope = (failure: { code: string; message: string; details?: unknown }): { code: string; message: string; details?: unknown } => {
		const envelope: { code: string; message: string; details?: unknown } = { code: failure.code, message: failure.message };
		if (failure.details !== undefined) {
			envelope.details = failure.details;
		}
		return envelope;
	};

	// The serial line processor: every line's handling awaits the previous
	// one, so in-flight requests complete before a later shutdown answers
	// (the shutdown-ordering contract, made structural).
	let chain: Promise<void> = Promise.resolve();
	const enqueue = (work: () => Promise<void>): void => {
		chain = chain.then(work, work);
	};

	const handleLine = async (line: string): Promise<void> => {
		if (line.trim().length === 0) {
			return;
		}
		let message: Record<string, unknown>;
		try {
			message = JSON.parse(line) as Record<string, unknown>;
		} catch {
			if (session.negotiatedSeam === SEAM_PROTOCOL_V1) {
				send({ type: 'error', ...seamError(SEAM_ERROR_CODES.INVALID_PARAMS, 'unparseable line') });
			} else {
				send({ type: 'error', message: 'unparseable line' });
			}
			return;
		}
		if (message.type === 'hello') {
			const negotiation = negotiateProtocolVersion(message.protocolVersions);
			if (!negotiation.ok) {
				send({ type: 'error', ...negotiation.error });
				exitOnce(SEAM_EXIT_PROTOCOL_MISMATCH);
				return;
			}
			// The orchestration layer negotiates ON TOP of the seam session:
			// additive hello key (ignored by non-orch services), additive
			// ready fields, and an orch mismatch NEVER kills the session.
			const orchOffer = orchHelloOffer(message);
			const orchNegotiation = negotiateOrchVersion(orchOffer);
			const orchVersion = orchNegotiation.offered && orchNegotiation.ok ? orchNegotiation.version : null;
			try {
				const mediator = new OrchestrationMediator(root);
				mediator.subscribe((event) => {
					if (session.negotiatedSeam === SEAM_PROTOCOL_V1) {
						const envelope = seamEvent(event.event, event.payload, event.ts);
						if (isSeamEvent(envelope)) {
							send(envelope);
						}
					}
					// v0 sessions never receive wire events (byte compatibility).
				});
				session = { negotiatedSeam: negotiation.version, negotiatedOrch: orchVersion, mediator, draining: false };
			} catch (error) {
				send({ type: 'error', message: `workspace init failed: ${error instanceof Error ? error.message : String(error)}` });
				exitOnce(3);
				return;
			}
			if (negotiation.version === SEAM_PROTOCOL_V1) {
				const base = { type: 'ready', service: SERVICE_NAME, version: SERVICE_VERSION, schema: TASKS_SCHEMA, protocolVersion: negotiation.version, capabilities: capabilitiesForVersion(negotiation.version) };
				send(composeOrchReady(base, orchVersion));
			} else {
				// v0 byte compatibility: exactly the four legacy keys, same order -
				// and never any orch field (the orch layer rides v1 only).
				send({ type: 'ready', service: SERVICE_NAME, version: SERVICE_VERSION, schema: TASKS_SCHEMA });
			}
			return;
		}
		if (typeof message.id === 'number' && typeof message.cmd === 'string') {
			const cmd = message.cmd;
			const id = message.id;
			const args = (message.args ?? {}) as Record<string, unknown>;
			if (session.mediator === null && cmd !== 'ping' && cmd !== 'shutdown') {
				sendError(id, seamError(SEAM_ERROR_CODES.INVALID_PARAMS, 'service not ready: send hello first', { reason: 'handshake-required' }), 'service not ready: send hello first');
				return;
			}
			if (cmd === 'ping') {
				send({ id, ok: true, result: { pong: true, ts: Date.now() } });
				return;
			}
			if (cmd === 'shutdown') {
				send({ id, ok: true, result: { ok: true } });
				if (session.mediator !== null) {
					session.draining = true;
					void session.mediator.shutdown().then(() => exitOnce(0));
				} else {
					exitOnce(0);
				}
				return;
			}
			if (cmd === 'flauz.lifecycle.shutdown') {
				if (session.negotiatedSeam !== SEAM_PROTOCOL_V1) {
					const unknown = seamError(SEAM_ERROR_CODES.UNKNOWN_METHOD, `unknown command: ${cmd}`, { method: cmd });
					sendError(id, unknown, `unknown command: ${cmd}`);
					return;
				}
				send({ id, ok: true, result: { ok: true, shuttingDown: true } });
				if (session.mediator !== null) {
					session.draining = true;
					void session.mediator.shutdown().then(() => exitOnce(0));
				} else {
					exitOnce(0);
				}
				return;
			}
			// The orchestration dispatch gate: registry + negotiated versions
			// (an unregistered name and a registered name outside its
			// negotiated versions both answer unknown-method, the seam
			// discipline derived from the ORCH_METHODS registry).
			if (!orchMethodDispatchable(cmd, session.negotiatedSeam ?? '', session.negotiatedOrch)) {
				const unknown = seamError(SEAM_ERROR_CODES.UNKNOWN_METHOD, `unknown command: ${cmd}`, { method: cmd });
				sendError(id, unknown, `unknown command: ${cmd}`);
				return;
			}
			if (session.draining) {
				// The drain window: new orchestration work is refused with the
				// typed shutting-down failure (mapped onto the seam error shape).
				const failure = orchFailure(ORCH_FAILURE_CODES.SHUTTING_DOWN, 'the orchestration session is draining after a shutdown command', { method: cmd });
				sendError(id, orchErrorEnvelope(failure), `${failure.code}: ${failure.message}`);
				return;
			}
			try {
				const result = await session.mediator?.dispatch(cmd, args);
				send({ id, ok: true, result });
			} catch (error) {
				const failure = orchFailureOf(error);
				sendError(id, orchErrorEnvelope(failure), `${failure.code}: ${failure.message}`);
			}
			return;
		}
		if (session.negotiatedSeam === SEAM_PROTOCOL_V1) {
			send({ type: 'error', ...seamError(SEAM_ERROR_CODES.INVALID_PARAMS, 'unrecognized message') });
		} else {
			send({ type: 'error', message: 'unrecognized message' });
		}
	};

	let buffer = '';
	process.stdin.setEncoding('utf-8');
	process.stdin.on('data', (chunk: string) => {
		buffer += chunk;
		let newline = buffer.indexOf('\n');
		while (newline !== -1) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			enqueue(() => handleLine(line));
			newline = buffer.indexOf('\n');
		}
	});
	const finish = (): void => {
		if (buffer.trim().length > 0) {
			enqueue(() => handleLine(buffer));
			buffer = '';
		}
		enqueue(() => {
			if (session.mediator !== null) {
				session.draining = true;
				void session.mediator.shutdown().then(() => exitOnce(0));
			} else {
				exitOnce(0);
			}
			return Promise.resolve();
		});
	};
	process.stdin.on('end', finish);
	process.stdin.on('close', () => {
		if (!exited) {
			finish();
		}
	});
	process.on('SIGTERM', () => exitOnce(0));

	// Nothing happens until hello arrives (handshake-first protocol).
	process.stdin.resume();
}

void main();
