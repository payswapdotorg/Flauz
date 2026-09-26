/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Unit tests for the pure seam-contract logic (core/contracts.mjs).
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */

import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, match } from 'node:assert';
import {
	TASKS_SCHEMA,
	TRANSITIONS,
	TRANSITION_TYPES,
	applyTransition,
	allowedSourceStatuses,
	canonicalJson,
	rowHash,
	validateLedgerRows,
} from '../core/contracts.mjs';

test('canonicalJson sorts keys recursively and emits no whitespace', () => {
	const input = { b: 1, a: { d: [3, { z: true, c: null }], c: 'x' } };
	strictEqual(canonicalJson(input), '{"a":{"c":"x","d":[3,{"c":null,"z":true}]},"b":1}');
	// Numbers, strings, booleans, null pass through untouched.
	strictEqual(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
});

test('rowHash chains: seq 1 has prev null, seq 2 prev = hash of row 1', () => {
	const row1 = { seq: 1, ts: 1_000, taskId: 'T-001', kind: 'note', uri: 'flauz://a', sha256: 'a'.repeat(64), prev: null };
	const row2 = { seq: 2, ts: 2_000, taskId: 'T-001', kind: 'command-output', uri: 'flauz://b', sha256: 'b'.repeat(64), prev: rowHash(row1) };
	const lines = [JSON.stringify(row1), JSON.stringify(row2)];
	const verdict = validateLedgerRows(lines);
	ok(verdict.ok, 'hash chain must verify');
	strictEqual(verdict.rows.length, 2);
	// The hash is over the CANONICAL projection of exactly the 7 fields.
	strictEqual(rowHash(row1), rowHash({ ...row1, extra: 'ignored' } as never), 'extra fields are not hashed');
});

test('all nine legal transitions apply from their documented source statuses', () => {
	const cases: Array<[string, string, string, string]> = [
		['plan', 'agent', 'submit-plan', 'awaiting-approval'],
		['awaiting-approval', 'human', 'approve', 'execute'],
		['awaiting-approval', 'human', 'request-changes', 'plan'],
		['execute', 'agent', 'report', 'verify'],
		['verify', 'agent', 'verify-pass', 'awaiting-signoff'],
		['verify', 'tool', 'verify-pass', 'awaiting-signoff'],
		['verify', 'agent', 'verify-fail', 'execute'],
		['execute', 'agent', 'fail', 'failed'],
		['awaiting-signoff', 'human', 'sign-off', 'done'],
	];
	for (const [from, actor, type, to] of cases) {
		const verdict = applyTransition(from, { actor, type });
		ok(!verdict.error, `${type} from ${from} as ${actor} must be legal`);
		strictEqual(verdict.status, to, `${type} from ${from} as ${actor} -> ${to}`);
	}
	// cancel is legal from every ACTIVE status, only from human.
	for (const from of ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff']) {
		strictEqual(applyTransition(from, { actor: 'human', type: 'cancel' }).status, 'cancelled');
	}
	strictEqual(TRANSITIONS.length, 9, 'exactly the nine contract transitions');
	strictEqual(TASKS_SCHEMA, 'flauz.tasks/v0');
});

test('illegal transitions are rejected with the allowed source statuses listed', () => {
	const verdict = applyTransition('plan', { actor: 'human', type: 'approve' });
	ok(verdict.error, 'approve from plan must be rejected');
	match(verdict.error as string, /approve is not allowed from status plan/);
	match(verdict.error as string, /allowed source statuses: awaiting-approval/);
	// fail is execute-only (documented contract interpretation).
	const failVerdict = applyTransition('verify', { actor: 'agent', type: 'fail' });
	ok(failVerdict.error, 'fail from verify must be rejected');
	match(failVerdict.error as string, /allowed source statuses: execute/);
	// cancel from a terminal status is rejected and lists the active statuses.
	const cancelVerdict = applyTransition('done', { actor: 'human', type: 'cancel' });
	ok(cancelVerdict.error, 'cancel from done must be rejected');
	deepStrictEqual(allowedSourceStatuses('cancel'), ['plan', 'awaiting-approval', 'execute', 'verify', 'awaiting-signoff']);
	deepStrictEqual(TRANSITION_TYPES, [
		'submit-plan', 'approve', 'request-changes', 'report', 'verify-pass', 'verify-fail', 'fail', 'sign-off', 'cancel',
	]);
});

test('actor validation runs after state validation and names the allowed actors', () => {
	// Valid source status, wrong actor: actor error (not a source-status error).
	const verdict = applyTransition('awaiting-approval', { actor: 'agent', type: 'approve' });
	ok(verdict.error, 'approve as agent must be rejected');
	match(verdict.error as string, /requires actor human, got 'agent'/);
	strictEqual(verdict.status, 'awaiting-approval', 'status unchanged on actor rejection');
	// verify-pass accepts agent | tool; verify-fail only agent.
	ok(!applyTransition('verify', { actor: 'tool', type: 'verify-fail' }).error === false);
	ok(applyTransition('verify', { actor: 'tool', type: 'verify-fail' }).error, 'verify-fail as tool rejected');
	// Non-transition event types append freely (no status change, no error).
	const note = applyTransition('plan', { actor: 'human', type: 'created-followup' });
	ok(!note.error, 'non-transition event types are plain appends');
	strictEqual(note.status, 'plan');
});

test('ledger tampering is detected at the NEXT row prev, and valid chains pass', () => {
	const row1 = { seq: 1, ts: 1, taskId: 'T-001', kind: 'note', uri: 'u1', sha256: '1'.repeat(64), prev: null };
	const row2 = { seq: 2, ts: 2, taskId: 'T-001', kind: 'note', uri: 'u2', sha256: '2'.repeat(64), prev: rowHash(row1) };
	const row3 = { seq: 3, ts: 3, taskId: 'T-001', kind: 'note', uri: 'u3', sha256: '3'.repeat(64), prev: rowHash(row2) };

	// Clean chain.
	ok(validateLedgerRows([JSON.stringify(row1), JSON.stringify(row2), JSON.stringify(row3)]).ok);

	// Tamper row 2's uri: its hash changes, so row 3's prev no longer matches.
	const tampered2 = { ...row2, uri: 'tampered' };
	const verdict = validateLedgerRows([JSON.stringify(row1), JSON.stringify(tampered2), JSON.stringify(row3)]);
	ok(!verdict.ok, 'tamper must be detected');
	strictEqual(verdict.firstBadSeq, 3, 'detection lands on the next row whose prev no longer matches');

	// Structural failures: bad seq, missing field, bad kind, bad sha, wrong first prev.
	ok(!validateLedgerRows(['not json']).ok);
	ok(!validateLedgerRows([JSON.stringify({ ...row1, seq: 7 })]).ok);
	ok(!validateLedgerRows([JSON.stringify({ seq: 1, ts: 1, taskId: 'T-001', kind: 'note', uri: 'u', sha256: 'zz', prev: null })]).ok);
	ok(!validateLedgerRows([JSON.stringify({ ...row1, prev: 'f'.repeat(64) })]).ok);
	const extraField = { ...row1, note: 'v0 rows carry exactly seven fields' };
	ok(!validateLedgerRows([JSON.stringify(extraField)]).ok, 'extra fields make a row invalid');
});
