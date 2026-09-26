/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz seam contract v0 — pure, zero-dependency logic shared by the core
 * service (G side) and the test harness. Imported at runtime only by Node
 * (extension source imports the TYPES from `contracts.d.mts`, never the code).
 *
 * Contract (Wave 3 Lane F work order section H, implemented verbatim):
 *  - task envelope `.flauz/tasks.json`: { $schema: 'flauz.tasks/v0', tasks: [...] }
 *  - task: { id, title, status, events[], timing{created,updatedAt}, changes[] }
 *  - evidence ledger `.flauz/evidence/ledger.jsonl`: append-only, one JSON
 *    object per line with the seven fields seq/ts/taskId/kind/uri/sha256/prev.
 *  - row hash (not stored) = sha256 over the canonical JSON of those seven
 *    fields (keys sorted, no whitespace); the NEXT row's `prev` carries it;
 *    seq 1 has prev === null. v0 is hash-chain only (Wave 4 adds signatures).
 *
 * Wave 4 Lane K additive extension (DL-20 hardening interop): rows MAY be
 * SIGNED CHECKPOINT rows - kind 'checkpoint' plus exactly one 8th field
 * `checkpoint` = {rowSeq, headSha256, algorithm, keyId, signature}. The row
 * hash covers the checkpoint field too (hash parity with
 * extensions/flauz-workspace/src/ledger.ts rowHash - pinned by Lane K's
 * cross-implementation parity test). This module validates checkpoint rows
 * STRUCTURALLY only; signature verification requires the user-keystore key
 * (the user owns the chain, SECURITY-MODEL section 3.3) and stays with
 * callers that hold keys - the core service never holds keystore material.
 */

import { createHash } from 'node:crypto';

export const TASKS_SCHEMA = 'flauz.tasks/v0';
export const SERVICE_NAME = 'flauz-core-service';
export const SERVICE_VERSION = '0.1.0';

export const TASK_STATUSES = [
	'plan',
	'awaiting-approval',
	'execute',
	'verify',
	'awaiting-signoff',
	'failed',
	'done',
	'cancelled',
];

/** Statuses from which `cancel` is legal ("any active" in the contract). */
export const ACTIVE_STATUSES = ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff'];
export const TERMINAL_STATUSES = ['failed', 'done', 'cancelled'];

export const EVIDENCE_KINDS = ['changeset', 'screenshot', 'command-output', 'note', 'checkpoint'];
export const EVENT_ACTORS = ['agent', 'human', 'tool'];

/** Signature algorithms of the DL-20 signed-checkpoint fixture keystore. */
export const CHECKPOINT_ALGORITHMS = ['ed25519', 'hmac-sha256'];

const CHECKPOINT_PAYLOAD_FIELDS = ['algorithm', 'headSha256', 'keyId', 'rowSeq', 'signature'];

/**
 * Legal transitions. `from: null` means "from any active status".
 * Everything not listed here is rejected with an Error that names the allowed
 * source statuses for the event type.
 */
export const TRANSITIONS = [
	{ type: 'submit-plan', from: 'plan', actors: ['agent'], to: 'awaiting-approval' },
	{ type: 'approve', from: 'awaiting-approval', actors: ['human'], to: 'execute' },
	{ type: 'request-changes', from: 'awaiting-approval', actors: ['human'], to: 'plan' },
	{ type: 'report', from: 'execute', actors: ['agent'], to: 'verify' },
	{ type: 'verify-pass', from: 'verify', actors: ['agent', 'tool'], to: 'awaiting-signoff' },
	{ type: 'verify-fail', from: 'verify', actors: ['agent'], to: 'execute' },
	{ type: 'fail', from: 'execute', actors: ['agent'], to: 'failed' },
	{ type: 'sign-off', from: 'awaiting-signoff', actors: ['human'], to: 'done' },
	{ type: 'cancel', from: null, actors: ['human'], to: 'cancelled' },
];

export const TRANSITION_TYPES = TRANSITIONS.map((rule) => rule.type);

export function transitionsForType(type) {
	return TRANSITIONS.filter((rule) => rule.type === type);
}

/** The source statuses from which `type` may fire (for error messages). */
export function allowedSourceStatuses(type) {
	const statuses = new Set();
	for (const rule of transitionsForType(type)) {
		if (rule.from === null) {
			for (const status of ACTIVE_STATUSES) {
				statuses.add(status);
			}
		} else {
			statuses.add(rule.from);
		}
	}
	return [...statuses];
}

/**
 * Validate an event against the transition table and compute the next status.
 *
 * Ordering (documented in REPORT section CONTRACT-DEVIATIONS): a rule matching the
 * current status is required BEFORE the actor is validated, so an event with
 * a wrong actor but a valid source status reports the actor error, and an
 * event from an invalid source status reports the allowed sources.
 *
 * Event types that are not transition verbs (e.g. `created`) append freely
 * without changing status.
 *
 * @returns {{ status: string, error?: string }}
 */
export function applyTransition(status, event) {
	if (!TRANSITION_TYPES.includes(event.type)) {
		return { status };
	}
	const rules = transitionsForType(event.type).filter((rule) =>
		rule.from === null ? ACTIVE_STATUSES.includes(status) : rule.from === status
	);
	if (rules.length === 0) {
		const allowed = allowedSourceStatuses(event.type).join(', ');
		return { status, error: `transition ${event.type} is not allowed from status ${status} (allowed source statuses: ${allowed})` };
	}
	const rule = rules[0];
	if (!rule.actors.includes(event.actor)) {
		return { status, error: `transition ${event.type} from ${rule.from === null ? 'any active status' : rule.from} requires actor ${rule.actors.join(' | ')}, got '${event.actor}'` };
	}
	return { status: rule.to };
}

/** Canonical JSON: object keys sorted recursively, no whitespace. */
export function canonicalJson(value) {
	return JSON.stringify(sortValue(value));
}

function sortValue(value) {
	if (Array.isArray(value)) {
		return value.map(sortValue);
	}
	if (value !== null && typeof value === 'object') {
		const out = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortValue(value[key]);
		}
		return out;
	}
	return value;
}

const LEDGER_FIELDS = ['seq', 'ts', 'taskId', 'kind', 'uri', 'sha256', 'prev'];

/**
 * sha256 (hex) of the canonical JSON of the ledger fields of `row`. Regular
 * rows project exactly the seven contract fields; signed-checkpoint rows
 * (DL-20 Wave-4 additive) additionally project their `checkpoint` payload -
 * hash parity with extensions/flauz-workspace/src/ledger.ts is pinned by test.
 */
export function rowHash(row) {
	const projected = {};
	for (const field of LEDGER_FIELDS) {
		projected[field] = row[field];
	}
	if (row.checkpoint !== undefined) {
		projected.checkpoint = row.checkpoint;
	}
	return createHash('sha256').update(canonicalJson(projected), 'utf8').digest('hex');
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SIGNATURE_HEX = /^[0-9a-f]{64,}$/;

/** Structural validation of a signed-checkpoint payload (no keys held here - see module header). */
function isStructurallyValidCheckpoint(row) {
	const cp = row.checkpoint;
	if (cp === null || typeof cp !== 'object' || Array.isArray(cp)) {
		return false;
	}
	const keys = Object.keys(cp).sort();
	if (keys.length !== 5 || !CHECKPOINT_PAYLOAD_FIELDS.every((k) => keys.includes(k))) {
		return false;
	}
	return CHECKPOINT_ALGORITHMS.includes(cp.algorithm)
		&& typeof cp.headSha256 === 'string' && SHA256_HEX.test(cp.headSha256)
		&& typeof cp.keyId === 'string' && cp.keyId.length > 0
		&& typeof cp.rowSeq === 'number' && Number.isSafeInteger(cp.rowSeq) && cp.rowSeq >= 1 && cp.rowSeq < row.seq
		&& typeof cp.signature === 'string' && SIGNATURE_HEX.test(cp.signature);
}

/**
 * Verify a ledger (array of raw lines). Checks, per row, in order:
 *  1. the line parses as JSON;
 *  2. it has EXACTLY the seven fields (regular rows) or the seven fields +
 *     `checkpoint` (kind 'checkpoint' rows - DL-20 Wave-4 additive; the two
 *     must appear together, never one without the other);
 *  3. seq is the 1-based position and kinds/actors/sha shapes are valid;
 *  4. prev === rowHash(previous row) (null for seq 1).
 *
 * Tampering with row N's content is detected at row N+1's `prev` mismatch
 * (row N's hash is recomputed here, never stored) — the last row's own
 * content tampering is therefore only detectable via the caller's knowledge
 * of its sha256 (v0 limitation, documented; the size watermark of the
 * flauz-workspace hardening closes it on that side).
 *
 * @returns {{ ok: boolean, rows: object[], firstBadSeq?: number }}
 */
export function validateLedgerRows(lines) {
	const rows = [];
	let prevHash = null;
	let firstBadSeq;
	const bad = (seq) => {
		if (firstBadSeq === undefined) {
			firstBadSeq = seq;
		}
	};
	let index = 0;
	for (const line of lines) {
		index += 1;
		if (typeof line !== 'string' || line.length === 0) {
			bad(index);
			continue;
		}
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			bad(index);
			continue;
		}
		const keys = Object.keys(row).sort();
		const hasCheckpointField = keys.includes('checkpoint');
		const expectedCount = hasCheckpointField ? LEDGER_FIELDS.length + 1 : LEDGER_FIELDS.length;
		const hasAllLedgerFields = LEDGER_FIELDS.every((key) => keys.includes(key));
		if (keys.length !== expectedCount || !hasAllLedgerFields) {
			bad(index);
			continue;
		}
		if (row.seq !== index || typeof row.ts !== 'number' || typeof row.taskId !== 'string' || !EVIDENCE_KINDS.includes(row.kind) || typeof row.uri !== 'string' || typeof row.sha256 !== 'string' || !SHA256_HEX.test(row.sha256) || !(row.prev === null || (typeof row.prev === 'string' && SHA256_HEX.test(row.prev)))) {
			bad(index);
			continue;
		}
		if ((row.kind === 'checkpoint') !== hasCheckpointField) {
			bad(index);
			continue;
		}
		if (hasCheckpointField && !isStructurallyValidCheckpoint(row)) {
			bad(index);
			continue;
		}
		if (row.prev !== prevHash) {
			bad(index);
			continue;
		}
		prevHash = rowHash(row);
		rows.push(row);
	}
	return firstBadSeq === undefined ? { ok: true, rows } : { ok: false, rows, firstBadSeq };
}
