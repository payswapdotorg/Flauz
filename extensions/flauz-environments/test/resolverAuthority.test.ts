/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-H1 rung 2 — the authority grammar pins (test/resolver types):
 *
 *   authority := "flauz-env" "+" <kind> "+" <envId>
 *
 * Every well-formed kind + the id grammar round-trip, and EVERY malformed
 * class (EMPTY / NOT_A_STRING / WRONG_PREFIX / PAYLOAD_MISSING /
 * SEGMENTS_EXTRA / KIND_UNKNOWN / ID_MISSING / ID_INVALID / NESTED_TRANSIT).
 * The grammar is STABLE CONTRACT: a change here is a workbench-facing
 * contract change (windows open on these authorities).
 */
import { test } from 'node:test';
import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { AUTHORITY_MALFORM_CLASSES, formatFlauzEnvAuthority, isFlauzEnvAuthority, parseFlauzEnvAuthority, authorityFailure, FLAUZ_ENV_AUTHORITY_PREFIX } from '../src/resolver/index.ts';
import { ENVIRONMENT_KINDS } from '../src/api.ts';

test('grammar: every v0 kind round-trips through format -> parse', () => {
	for (const kind of ENVIRONMENT_KINDS) {
		const authority = formatFlauzEnvAuthority(kind, 'env-round-trip');
		strictEqual(authority, `flauz-env+${kind}+env-round-trip`);
		const parsed = parseFlauzEnvAuthority(authority);
		ok(parsed.ok, `${authority} must parse`);
		strictEqual(parsed.kind, kind);
		strictEqual(parsed.envId, 'env-round-trip');
		ok(isFlauzEnvAuthority(authority));
	}
});

test('grammar: the id grammar follows the descriptor registry pattern (env-[a-z0-9][a-z0-9-]{0,47})', () => {
	for (const envId of ['env-a', 'env-0', 'env-with-dashes-and-0123', 'env-a'.padEnd(51, 'x'), 'env-a'.padEnd(52, 'x')]) {
		const parsed = parseFlauzEnvAuthority(formatFlauzEnvAuthority('ssh-local', envId));
		ok(parsed.ok, envId);
		strictEqual(parsed.envId, envId);
	}
});

test('grammar: the prefix check and the exact prefix constant', () => {
	strictEqual(FLAUZ_ENV_AUTHORITY_PREFIX, 'flauz-env');
	ok(isFlauzEnvAuthority('flauz-env+ssh-local+env-a'));
	ok(!isFlauzEnvAuthority('ssh-remote+host01'));
	ok(!isFlauzEnvAuthority('flauz-envv+ssh-local+env-a'));
	ok(!isFlauzEnvAuthority('flauz-env'));
});

test('grammar: malformed class EMPTY', () => {
	const parsed = parseFlauzEnvAuthority('');
	ok(!parsed.ok);
	strictEqual(parsed.reason, 'EMPTY');
});

test('grammar: malformed class NOT_A_STRING (numbers, objects, undefined)', () => {
	for (const bad of [undefined, null, 42, {}, ['flauz-env+ssh-local+env-a']]) {
		const parsed = parseFlauzEnvAuthority(bad as unknown);
		ok(!parsed.ok, JSON.stringify(bad));
		strictEqual(parsed.reason, 'NOT_A_STRING');
	}
});

test('grammar: malformed class WRONG_PREFIX (other resolvers are not ours)', () => {
	for (const bad of ['ssh-remote+host01', 'dev-container+box', 'e2b+env-x', 'flauz-local', 'flauz+ssh-local+env-a', 'FLAUZ-ENV+ssh-local+env-a']) {
		const parsed = parseFlauzEnvAuthority(bad);
		ok(!parsed.ok, bad);
		strictEqual(parsed.reason, 'WRONG_PREFIX', bad);
	}
});

test('grammar: malformed class PAYLOAD_MISSING (bare prefix+ only)', () => {
	for (const bad of ['flauz-env+']) {
		const parsed = parseFlauzEnvAuthority(bad);
		ok(!parsed.ok, bad);
		strictEqual(parsed.reason, 'PAYLOAD_MISSING', bad);
	}
});

test('grammar: malformed class SEGMENTS_EXTRA (more than kind+id)', () => {
	const parsed = parseFlauzEnvAuthority('flauz-env+ssh-local+env-a+extra');
	ok(!parsed.ok);
	strictEqual(parsed.reason, 'SEGMENTS_EXTRA');
});

test('grammar: malformed class KIND_UNKNOWN (outside the v0 vocabulary)', () => {
	for (const bad of ['flauz-env+ssh+env-a', 'flauz-env+dev-container+env-a', 'flauz-env+Kubernetes+env-a', 'flauz-env++env-a', 'flauz-env++']) {
		const parsed = parseFlauzEnvAuthority(bad);
		ok(!parsed.ok, bad);
		strictEqual(parsed.reason, 'KIND_UNKNOWN', bad);
	}
});

test('grammar: malformed class ID_MISSING (trailing plus)', () => {
	const parsed = parseFlauzEnvAuthority('flauz-env+ssh-local+');
	ok(!parsed.ok);
	strictEqual(parsed.reason, 'ID_MISSING');
});

test('grammar: malformed class ID_INVALID (id grammar violations)', () => {
	for (const bad of ['Env-A', 'env-', 'a', 'env_underscore', 'env-A-upper', 'env-a'.padEnd(53, 'x'), 'env space']) {
		const parsed = parseFlauzEnvAuthority(`flauz-env+container+${bad}`);
		ok(!parsed.ok, bad);
		strictEqual(parsed.reason, 'ID_INVALID', bad);
	}
});

test('grammar: malformed class NESTED_TRANSIT (the a@b form is not v0)', () => {
	const parsed = parseFlauzEnvAuthority('flauz-env+ssh-local+env-a@other-authority');
	ok(!parsed.ok);
	strictEqual(parsed.reason, 'NESTED_TRANSIT');
});

test('grammar: the malform class catalogue is closed and maps to AUTHORITY_MALFORMED', () => {
	deepStrictEqual(AUTHORITY_MALFORM_CLASSES, ['EMPTY', 'NOT_A_STRING', 'WRONG_PREFIX', 'PAYLOAD_MISSING', 'SEGMENTS_EXTRA', 'KIND_UNKNOWN', 'ID_MISSING', 'ID_INVALID', 'NESTED_TRANSIT']);
	const parsed = parseFlauzEnvAuthority('garbage');
	ok(!parsed.ok);
	const failure = authorityFailure(parsed);
	strictEqual(failure.code, 'AUTHORITY_MALFORMED');
	ok(failure.message.includes('WRONG_PREFIX'));
	ok(failure.message.startsWith('flauz.env-resolver/v0: '));
	// the failure is a typed Error subclass, never a raw throw at the boundary
	ok(failure instanceof Error);
	notStrictEqual((failure as { detail?: unknown }).detail, 'CLI_NOT_AVAILABLE');
});
