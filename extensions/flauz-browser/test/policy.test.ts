/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Policy-file schema, error classes, defaults, canonical serialization, and
 * the host-pattern matcher. Fixture-driven: every file under
 * test/fixtures/browser-policy/{good,bad} is asserted (bad fixtures each
 * violate one rule class; the engine must reject them with the typed error).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	BrowserPolicyEngine,
	DEFAULT_POLICY,
	POLICY_SCHEMA_ID,
	POLICY_SCHEMA_VERSION,
	PolicyError,
	canonicalJson,
	hostMatches,
	isDomainAllowed,
	normalizeHostPattern,
	parsePolicyText,
	policyTemplate,
	resolvePolicyText,
	serializePolicy,
	sha256Hex,
	verdictCore,
	toEvidenceRow,
	formatVerdictLine,
} from '../src/policy.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures', 'browser-policy');

function readFixture(relative: string): string {
	return readFileSync(path.join(FIXTURES, relative), 'utf-8');
}

// Explicit fixture manifests (asserted complete against the directory
// listing below -- a gate that cannot fail is not a gate):
const GOOD_FIXTURES = [
	'good/policy-minimal.json',
	'good/policy-full.json',
	'good/policy-killswitch-driver.json',
	'good/policy-deny-only.json',
] as const;

const BAD_FIXTURES: ReadonlyArray<{ file: string; code: string; path: string }> = [
	{ file: 'bad/01-bad-json.json', code: 'FLAUZ_POLICY_PARSE', path: '' },
	{ file: 'bad/02-root-array.json', code: 'FLAUZ_POLICY_SCHEMA', path: '' },
	{ file: 'bad/03-version-missing.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'schemaVersion' },
	{ file: 'bad/04-version-unsupported.json', code: 'FLAUZ_POLICY_VERSION', path: 'schemaVersion' },
	{ file: 'bad/05-version-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'schemaVersion' },
	{ file: 'bad/06-unknown-key.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'unknownKey' },
	{ file: 'bad/07-driver-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver' },
	{ file: 'bad/08-layer-unknown-key.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.unknownRule' },
	{ file: 'bad/09-enabled-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.enabled' },
	{ file: 'bad/10-allow-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.allow' },
	{ file: 'bad/11-allow-bad-pattern.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.allow[1]' },
	{ file: 'bad/12-deny-bad-pattern.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.deny[0]' },
	{ file: 'bad/13-fileroots-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.fileRoots[0]' },
	{ file: 'bad/14-fileroots-dotdot.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'driver.fileRoots[0]' },
	{ file: 'bad/15-fileroots-on-webrequest.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'webRequest.fileRoots' },
	{ file: 'bad/16-partitions-type.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'partitions' },
	{ file: 'bad/17-partitions-scope.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'partitions.scope' },
	{ file: 'bad/18-partitions-peragent.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'partitions.perAgent' },
	{ file: 'bad/19-partitions-unknown.json', code: 'FLAUZ_POLICY_SCHEMA', path: 'partitions.ephemeral' },
];

// #region Defaults

test('default policy is deny-all with every layer enabled and persist workspace partitions', () => {
	assert.equal(DEFAULT_POLICY.schemaVersion, POLICY_SCHEMA_VERSION);
	for (const layer of ['driver', 'webRequest', 'willNavigate'] as const) {
		assert.equal(DEFAULT_POLICY[layer].enabled, true, `${layer} enabled`);
		assert.deepEqual(DEFAULT_POLICY[layer].allow, []);
		assert.deepEqual(DEFAULT_POLICY[layer].deny, []);
	}
	assert.deepEqual(DEFAULT_POLICY.partitions, { scope: 'persist', perAgent: false });
});

test('schema id and version are pinned', () => {
	assert.equal(POLICY_SCHEMA_ID, 'flauz.browser-policy/v0');
	assert.equal(POLICY_SCHEMA_VERSION, 0);
});

// #endregion

// #region Parsing + error classes

test('minimal policy (schemaVersion only) fills every default', () => {
	const { policy, warnings } = parsePolicyText(readFixture('good/policy-minimal.json'));
	assert.equal(policy.schemaVersion, 0);
	assert.deepEqual(policy.driver, DEFAULT_POLICY.driver);
	assert.deepEqual(policy.webRequest, DEFAULT_POLICY.webRequest);
	assert.deepEqual(policy.willNavigate, DEFAULT_POLICY.willNavigate);
	assert.deepEqual(policy.partitions, DEFAULT_POLICY.partitions);
	assert.deepEqual(warnings, []);
});

test('full policy parses every rule class and normalizes patterns at load', () => {
	const { policy, warnings } = parsePolicyText(readFixture('good/policy-full.json'));
	assert.deepEqual(policy.driver.allow, ['*.example.com', 'docs.flauz.dev', 'api.example.com', 'plain.example.org', 'credentials.example.net', '[::1]', '*']);
	assert.deepEqual(policy.driver.deny, ['evil.example.com', 'tracker.example.net']);
	assert.deepEqual(policy.driver.fileRoots, ['/tmp/trusted-exports', '.flauz']);
	assert.deepEqual(policy.webRequest.allow, ['*.example.com']);
	assert.deepEqual(policy.willNavigate.deny, ['phishing.example.org']);
	assert.deepEqual(policy.partitions, { scope: 'persist', perAgent: true });
	assert.deepEqual(warnings, []);
});

test('kill-switched layer parses with a warning (B1c insurance advisory)', () => {
	const { policy, warnings } = parsePolicyText(readFixture('good/policy-killswitch-driver.json'));
	assert.equal(policy.driver.enabled, false);
	assert.equal(warnings.length, 1);
	assert.match(warnings[0] ?? '', /driver layer kill-switched/);
});

test('deny-only policy parses (allowed-empty semantics: allow anything not denied)', () => {
	const { policy } = parsePolicyText(readFixture('good/policy-deny-only.json'));
	assert.deepEqual(policy.partitions, { scope: 'memory', perAgent: false });
	const engine = new BrowserPolicyEngine({ policy });
	// allow-list empty + deny-list set -> non-denied hosts allowed:
	assert.equal(engine.checkLayer('driver', 'https://fine.example.org/').decision, 'allow');
	assert.equal(engine.checkLayer('driver', 'https://evil.example.com/').decision, 'deny');
});

test('every good fixture parses cleanly', () => {
	for (const file of GOOD_FIXTURES) {
		const { policy } = parsePolicyText(readFixture(file));
		assert.equal(policy.schemaVersion, 0, file);
	}
});

test('every bad fixture is rejected with the typed error, code, and JSON path', () => {
	for (const { file, code, path: jsonPath } of BAD_FIXTURES) {
		let thrown: unknown;
		try {
			parsePolicyText(readFixture(file));
		} catch (err) {
			thrown = err;
		}
		assert.ok(thrown instanceof PolicyError, `${file}: expected PolicyError, got ${String(thrown)}`);
		const error = thrown as PolicyError;
		assert.equal(error.code, code, `${file}: code`);
		assert.equal(error.path, jsonPath, `${file}: JSON path`);
		assert.match(error.message, new RegExp(`\\[${code}\\]`), `${file}: message carries the code`);
	}
});

test('bad fixtures violate every rule class at least once (completeness guard)', () => {
	const codes = new Set(BAD_FIXTURES.map(f => f.code));
	assert.ok(codes.has('FLAUZ_POLICY_PARSE'));
	assert.ok(codes.has('FLAUZ_POLICY_VERSION'));
	assert.ok(codes.has('FLAUZ_POLICY_SCHEMA'));
	const violatedKeys = new Set(BAD_FIXTURES.map(f => f.path.split('.')[0] ?? '').filter(k => k !== ''));
	assert.ok(violatedKeys.has('schemaVersion'));
	assert.ok(violatedKeys.has('driver'));
	assert.ok(violatedKeys.has('webRequest'));
	assert.ok(violatedKeys.has('partitions'));
});

test('resolvePolicyText: missing file -> builtin deny-all default with warning', () => {
	const resolved = resolvePolicyText(undefined);
	assert.equal(resolved.source, 'builtin-default');
	assert.equal(resolved.error, undefined);
	assert.equal(resolved.warnings.length, 1);
	assert.match(resolved.warnings[0] ?? '', /no \.flauz\/browser-policy\.json found/);
});

test('resolvePolicyText: broken file -> fail-closed default with the carried typed error', () => {
	const resolved = resolvePolicyText('{ not json');
	assert.equal(resolved.source, 'builtin-default');
	assert.ok(resolved.error instanceof PolicyError);
	assert.equal(resolved.error?.code, 'FLAUZ_POLICY_PARSE');
	assert.match(resolved.warnings[0] ?? '', /deny-all builtin default in effect/);
});

test('engine from broken text still denies everything and annotates reasons with the error code', () => {
	const engine = BrowserPolicyEngine.fromPolicyText(readFixture('bad/06-unknown-key.json'));
	const verdict = engine.evaluate({ url: 'https://anything.example.com/', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined });
	assert.equal(verdict.final.decision, 'deny');
	assert.match(verdict.final.reason, /policy file invalid: FLAUZ_POLICY_SCHEMA/);
});

// #endregion

// #region Host pattern matcher (mirrors the in-tree filter semantics)

test('normalizeHostPattern accepts the supported pattern forms', () => {
	assert.equal(normalizeHostPattern('example.com'), 'example.com');
	assert.equal(normalizeHostPattern('  EXAMPLE.com  '), 'example.com');
	assert.equal(normalizeHostPattern('*.example.com'), '*.example.com');
	assert.equal(normalizeHostPattern('*'), '*');
	assert.equal(normalizeHostPattern('example.com:8443'), 'example.com');
	assert.equal(normalizeHostPattern('user@example.com'), 'example.com');
	assert.equal(normalizeHostPattern('https://Sub.Example.com/path'), 'sub.example.com');
	assert.equal(normalizeHostPattern('example.com.'), 'example.com');
	assert.equal(normalizeHostPattern('[::1]'), '[::1]');
});

test('normalizeHostPattern rejects invalid patterns', () => {
	assert.equal(normalizeHostPattern(''), undefined);
	assert.equal(normalizeHostPattern('not a host!'), undefined);
	assert.equal(normalizeHostPattern('example.com/path'), undefined);
	assert.equal(normalizeHostPattern('..'), undefined);
	assert.equal(normalizeHostPattern('::1'), undefined, 'bare IPv6 must be bracketed in policy patterns');
	assert.equal(normalizeHostPattern('*.exa mple.com'), undefined);
	assert.equal(normalizeHostPattern('bad..host'), undefined);
	assert.equal(normalizeHostPattern('http://bad host/'), undefined);
});

test('hostMatches: exact, wildcard-suffix, and bare-star semantics', () => {
	assert.ok(hostMatches('example.com', 'example.com'));
	assert.ok(!hostMatches('sub.example.com', 'example.com'), 'exact pattern must not match subdomains');
	assert.ok(hostMatches('sub.example.com', '*.example.com'));
	assert.ok(hostMatches('example.com', '*.example.com'), 'wildcard suffix matches the suffix itself');
	assert.ok(!hostMatches('notexample.com', '*.example.com'));
	assert.ok(hostMatches('anything.at.all', '*'));
	assert.ok(hostMatches('[::1]', '[::1]'));
});

test('isDomainAllowed mirrors the upstream algorithm exactly', () => {
	// Both empty -> deny (the restrictive default, networkFilterService.ts:26-35).
	assert.equal(isDomainAllowed('example.com', [], []), false);
	// Denied always wins, even when also allowed.
	assert.equal(isDomainAllowed('example.com', ['example.com'], ['example.com']), false);
	// Denied list only -> allow anything not denied.
	assert.equal(isDomainAllowed('other.org', [], ['evil.com']), true);
	assert.equal(isDomainAllowed('evil.com', [], ['evil.com']), false);
	// Allowed list set -> must match one.
	assert.equal(isDomainAllowed('docs.example.com', ['*.example.com'], []), true);
	assert.equal(isDomainAllowed('other.org', ['*.example.com'], []), false);
});

// #endregion

// #region Canonical serialization + hashing + evidence seam

test('canonicalJson: sorted keys, no whitespace, undefined dropped (byte-stable)', () => {
	assert.equal(canonicalJson({ b: 1, a: [2, { d: true, c: null }] }), '{"a":[2,{"c":null,"d":true}],"b":1}');
	assert.equal(canonicalJson({ u: undefined, k: 'v' }), '{"k":"v"}');
	assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test('sha256Hex matches node:crypto over ascii and unicode inputs', () => {
	for (const input of ['flauz', 'https://example.com/p a t h?q=1', '\u00fcn\u00efc\u00f8d\u00e9-\u2713 payload', 'x'.repeat(1000)]) {
		assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'));
	}
});

test('serializePolicy: sorted keys, 2-space indent, one trailing newline; template parses back to the default', () => {
	const text = serializePolicy(DEFAULT_POLICY);
	assert.equal(text, JSON.stringify({ driver: {}, partitions: { perAgent: false, scope: 'persist' }, schemaVersion: 0, webRequest: {}, willNavigate: {} }, null, 2) + '\n');
	assert.equal(text, policyTemplate());
	const round = parsePolicyText(text);
	assert.deepEqual(round.policy, DEFAULT_POLICY);
	assert.deepEqual(round.warnings, []);
});

test('toEvidenceRow: ledger row shape with sha256 over the canonical verdict core', () => {
	const engine = BrowserPolicyEngine.fromPolicyText('{"schemaVersion":0}', { clock: () => 1700000000000 });
	const verdict = engine.evaluate({ url: 'https://evil.org/', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined }).final;
	const row = toEvidenceRow(verdict, undefined);
	assert.equal(row.kind, 'note');
	assert.match(row.uri, /^flauz-policy:\/\/verdicts\/[0-9a-f]{16}$/);
	assert.equal(row.sha256, createHash('sha256').update(canonicalJson(verdictCore(verdict)), 'utf8').digest('hex'));
	assert.match(row.note, /^deny\/driver agent-tool https:\/\/evil\.org\//);
	const rowWithTask = toEvidenceRow(verdict, 'T-001');
	assert.equal(rowWithTask.uri, `.flauz/artifacts/T-001/browser-verdict-${row.sha256.slice(0, 16)}.json`);
});

test('verdict core drops ts so identical outcomes hash identically (idempotent evidence)', () => {
	const text = '{"schemaVersion":0,"driver":{"allow":["example.com"]}}';
	const a = BrowserPolicyEngine.fromPolicyText(text, { clock: () => 1 }).evaluate({ url: 'https://example.com/', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined }).final;
	const b = BrowserPolicyEngine.fromPolicyText(text, { clock: () => 999 }).evaluate({ url: 'https://example.com/', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined }).final;
	assert.notEqual(a.ts, b.ts);
	assert.equal(toEvidenceRow(a, undefined).sha256, toEvidenceRow(b, undefined).sha256);
});

test('formatVerdictLine renders decision/layer/url/reason for canary log greps', () => {
	const engine = BrowserPolicyEngine.fromPolicyText('{"schemaVersion":0}');
	const verdict = engine.evaluate({ url: 'https://evil.org/', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined }).final;
	const line = formatVerdictLine(verdict);
	assert.match(line, /^deny driver https:\/\/evil\.org\//);
	assert.match(line, /\[v0 workspace-file\]$/);
});

// #endregion

test('fixture manifest completeness: every file on disk is enumerated (good and bad)', () => {
	const goodOnDisk = readdirSync(path.join(FIXTURES, 'good')).filter(name => name.endsWith('.json')).sort();
	const badOnDisk = readdirSync(path.join(FIXTURES, 'bad')).filter(name => name.endsWith('.json')).sort();
	assert.deepEqual(goodOnDisk, [...GOOD_FIXTURES].map(f => f.split('/')[1] ?? '').sort());
	assert.deepEqual(badOnDisk, BAD_FIXTURES.map(f => f.file.split('/')[1] ?? '').sort());
});
