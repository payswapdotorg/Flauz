/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Schema-validation suite: the ResourceRef identity law (URN ids, never
 * paths/URLs), provenance fail-closedness, per-family surface shapes, edge
 * legality, the vault-only secret policy (secret-shaped literals REJECTED,
 * assembled from fragments at runtime), canonical serialization and the
 * sha256 cross-check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import {
	EDGE_KINDS,
	KIND_NAMESPACES,
	RESOURCE_KINDS,
	ResourceGraphError,
	validateEdge,
	validateProvenance,
	validateResourceRef,
	validateSurface,
	validateSurfaceRecord,
	canonicalJson,
	deepSorted,
	serializeEnvelope,
	sha256Hex,
	isResourceUrnForKind,
	isBrowserSessionId,
	isTaskId,
	isEnvironmentId,
	isSecretRef,
	looksSecretShaped,
	assertNoSecretShapedValues,
	isEdgeLegalForKinds,
	edgeLegalityError,
} from '../src/api.ts';
import { runtimeSecretFixture } from './helpers.ts';

const TS = 1730000000000;

function goodRef(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		schemaVersion: 0,
		kind: 'file',
		id: 'flauz:file:4d5e6f708192a3b4',
		displayName: 'app.ts',
		provenance: { actor: 'agent', actorId: 'flauz-agent' },
		createdAt: TS,
		...overrides,
	};
}

test('every v0 kind maps to a canonical URN namespace and round-trips validation', () => {
	for (const kind of RESOURCE_KINDS) {
		const local = kind === 'browser-session' ? '3f9a2b1c8d7e4f60' : 'example-slug';
		const id = `flauz:${KIND_NAMESPACES[kind]}:${local}`;
		assert.ok(isResourceUrnForKind(id, kind), `${id} must be a valid URN for ${kind}`);
		const ref = validateResourceRef(goodRef({ kind, id }), `ref(${kind})`);
		assert.equal(ref.id, id);
	}
});

test('browser-session ids are exactly Worker A\'s pinned flauz:browser:<16-hex> shape', () => {
	assert.ok(isBrowserSessionId('flauz:browser:3f9a2b1c8d7e4f60'));
	assert.equal(isBrowserSessionId('flauz:browser:short'), false);
	assert.equal(isBrowserSessionId('flauz:browser:3F9A2B1C8D7E4F60'), false); // uppercase hex rejected
	assert.equal(isBrowserSessionId('flauz:task:3f9a2b1c8d7e4f60'), false);
});

test('a filesystem path is NEVER a legal ref id (the identity law)', () => {
	for (const bad of ['/work/acme/src/app.ts', 'src/app.ts', './app.ts', '../app.ts', 'C:\\work\\app.ts', '/tmp/x']) {
		assert.throws(
			() => validateResourceRef(goodRef({ id: bad })),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SCHEMA' && /NEVER carries a filesystem path/.test(err.message),
			`id ${JSON.stringify(bad)} must be rejected as a path`,
		);
	}
});

test('a URL is NEVER a legal ref id (the identity law)', () => {
	for (const bad of ['https://example.com/res', 'http://localhost:9222/json', 'file:///work/acme/app.ts', 'ws://127.0.0.1:9222/devtools/browser/abc']) {
		assert.throws(
			() => validateResourceRef(goodRef({ id: bad })),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SCHEMA',
			`id ${JSON.stringify(bad)} must be rejected as a URL`,
		);
	}
});

test('the URN namespace must match the ref kind', () => {
	assert.throws(
		() => validateResourceRef(goodRef({ kind: 'file', id: 'flauz:task:T-001' })),
		/namespace matches the ref kind/,
	);
	assert.throws(
		() => validateResourceRef(goodRef({ kind: 'browser-session', id: 'flauz:browser-session:3f9a2b1c8d7e4f60' })),
		/namespace matches the ref kind/,
	);
});

test('malformed URNs are rejected (prefix, slug charset, slug length, slug start)', () => {
	for (const bad of ['task:T-001', 'flauz:task:', 'flauz:task:T-001/x', 'flauz:task:-bad-start', `flauz:task:${'a'.repeat(65)}`, 'flauz:task:bad slash']) {
		assert.throws(() => validateResourceRef(goodRef({ kind: 'task', id: bad })), ResourceGraphError, `id ${JSON.stringify(bad)}`);
	}
});

test('unknown kinds and unknown extra keys are rejected', () => {
	assert.throws(() => validateResourceRef(goodRef({ kind: 'container' })), /kind must be one of/);
	assert.throws(() => validateResourceRef(goodRef({ extra: 1 })), /exactly the keys/);
	assert.throws(() => validateResourceRef(goodRef({ schemaVersion: 1 })), /schemaVersion must be exactly 0/);
	assert.throws(() => validateResourceRef(goodRef({ schemaVersion: '0' })), /schemaVersion must be exactly 0/);
});

test('displayName must be non-empty and bounded when present', () => {
	assert.throws(() => validateResourceRef(goodRef({ displayName: '' })), /displayName/);
	assert.throws(() => validateResourceRef(goodRef({ displayName: 'x'.repeat(201) })), /displayName/);
	const ok = validateResourceRef(goodRef({ displayName: 'app.ts' }));
	assert.equal(ok.displayName, 'app.ts');
	const omitted = validateResourceRef((() => { const r = goodRef(); delete (r as Record<string, unknown>).displayName; return r; })());
	assert.equal(omitted.displayName, undefined);
});

test('provenance is fail-closed: a missing or unknown actor is a schema rejection', () => {
	assert.throws(
		() => validateResourceRef(goodRef({ provenance: {} })),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_PROVENANCE' && /actor is MISSING.*MANDATORY/.test(err.message),
	);
	assert.throws(
		() => validateResourceRef(goodRef({ provenance: { actor: 'system' } })),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_PROVENANCE' && /actor must be one of agent\|human\|tool.*MANDATORY/.test(err.message),
	);
	assert.throws(() => validateProvenance({ actor: 'agent', bogus: 1 }, 'x'), /exactly the keys/);
	for (const actor of ['agent', 'human', 'tool'] as const) {
		assert.equal(validateProvenance({ actor }, 'x').actor, actor);
	}
});

test('createdAt must be a positive integer epoch-ms', () => {
	for (const bad of [0, -1, 1.5, '1730000000000', null]) {
		assert.throws(() => validateResourceRef(goodRef({ createdAt: bad })), /createdAt/, `createdAt ${JSON.stringify(bad)}`);
	}
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

function fsSurface(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { kind: 'file-system', root: '/work/acme', path: 'src/app.ts', contentSha256: '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a', ...overrides };
}

test('each surface family validates its pinned shape (exact keys, per-family rules)', () => {
	const cases: Array<[Record<string, unknown>, string]> = [
		[{ kind: 'file-system', root: '/work/acme', path: 'src/app.ts' }, 'file-system'],
		[{ kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc', partition: 'persist:flauz-0123456789abcdef', tabIds: ['tab-1'] }, 'browser'],
		[{ kind: 'environment', descriptorId: 'env-staging', providerKind: 'container', attachTarget: 'devcontainer:acme' }, 'environment'],
		[{ kind: 'model', providerId: 'flauz:provider:zai', modelId: 'glm-4.7' }, 'model'],
		[{ kind: 'task', envelopePath: '.flauz/tasks.json', taskId: 'T-001' }, 'task'],
		[{ kind: 'artifact', uri: '.flauz/artifacts/T-001/shot.png', sha256: '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a' }, 'artifact'],
		[{ kind: 'workspace', root: '/work/acme' }, 'workspace'],
	];
	for (const [surface, family] of cases) {
		const parsed = validateSurface(surface, 's');
		assert.equal(parsed.kind, family);
	}
});

test('surface-shape rejections: unknown family, missing keys, bad values', () => {
	assert.throws(() => validateSurface({ kind: 'database', host: 'x' }, 's'), /surface.kind must be one of/);
	assert.throws(() => validateSurface({ kind: 'file-system', root: '/w' }, 's'), /exactly the keys/); // missing path
	assert.throws(() => validateSurface({ kind: 'file-system', root: '/w', path: 'p', extra: 1 }, 's'), /exactly the keys/);
	assert.throws(() => validateSurface(fsSurface({ contentSha256: 'deadbeef' }), 's'), /contentSha256/);
	assert.throws(() => validateSurface({ kind: 'artifact', uri: 'u' }, 's'), /exactly the keys/); // missing sha256
	assert.throws(() => validateSurface({ kind: 'artifact', uri: 'u', sha256: 'zz' }, 's'), /sha256 must be 64/);
	assert.throws(() => validateSurface({ kind: 'environment', descriptorId: 'staging', providerKind: 'container' }, 's'), /descriptorId must be a flauz-environments registry id/);
	assert.throws(() => validateSurface({ kind: 'environment', descriptorId: 'env-staging', providerKind: 'kubernetes' }, 's'), /providerKind must be one of/);
	assert.throws(() => validateSurface({ kind: 'task', envelopePath: '.flauz/tasks.json', taskId: 'T-1' }, 's'), /taskId must match the flauz-workspace task-id pattern/);
	assert.throws(() => validateSurface({ kind: 'model', providerId: 'p' }, 's'), /exactly the keys/);
	assert.throws(() => validateSurface({ kind: 'workspace' }, 's'), /exactly the keys/);
	assert.throws(() => validateSurface({ kind: 'browser', tabIds: 'tab-1' }, 's'), /tabIds must be an array/);
	assert.throws(() => validateSurface({ kind: 'browser', tabIds: [''] }, 's'), /tabIds must be an array/);
});

test('task and environment id patterns match the sibling contracts (duplicated, DL-32)', () => {
	assert.ok(isTaskId('T-001'));
	assert.ok(isTaskId('T-123456'));
	assert.equal(isTaskId('T-1'), false);
	assert.equal(isTaskId('t-001'), false);
	assert.ok(isEnvironmentId('env-staging'));
	assert.ok(isEnvironmentId('env-a1'));
	assert.equal(isEnvironmentId('staging'), false);
	assert.equal(isEnvironmentId('ENV-staging'), false);
	assert.equal(isEnvironmentId('env-' + 'x'.repeat(49)), false); // 48 after the prefix is the cap (1 + 47)
});

test('surface records: versions required non-empty, family must match version kinds', () => {
	const version = { surface: { kind: 'workspace', root: '/w' }, provenance: { actor: 'human' }, updatedAt: TS };
	const record = validateSurfaceRecord({ refId: 'flauz:workspace:acme', family: 'workspace', versions: [version] }, 'r');
	assert.equal(record.versions.length, 1);
	assert.throws(() => validateSurfaceRecord({ refId: 'x', family: 'workspace' }, 'r'), /exactly the keys/);
	assert.throws(() => validateSurfaceRecord({ refId: 'x', family: 'workspace', versions: [] }, 'r'), /versions must be a non-empty array/);
	assert.throws(
		() => validateSurfaceRecord({ refId: 'x', family: 'workspace', versions: [{ ...version, surface: { kind: 'browser' } }] }, 'r'),
		/surface.kind must equal the record family/,
	);
	assert.throws(() => validateSurfaceRecord({ refId: 'x', family: 'workspace', versions: [{ ...version, provenance: {} }] }, 'r'), ResourceGraphError);
});

// ---------------------------------------------------------------------------
// Secret-shape policy (vault-only): secret-shaped literals are REJECTED.
// The secret-shaped fixtures are ASSEMBLED FROM FRAGMENTS AT RUNTIME.
// ---------------------------------------------------------------------------

test('a secret-shaped literal in a surface is REJECTED at the schema level (vault-only policy)', () => {
	for (const secret of [runtimeSecretFixture('github-pat'), runtimeSecretFixture('api-key'), runtimeSecretFixture('aws-key'), runtimeSecretFixture('jwt')]) {
		assert.throws(
			() => validateSurface({ kind: 'browser', partition: secret }, 's'),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SECRET' && /vault-style references/.test(err.message),
			`secret-shaped value must be rejected`,
		);
		assert.throws(
			() => validateSurface({ kind: 'browser', cdpEndpoint: `ws://host/${secret}` }, 's'),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SECRET',
			'embedded secret-shaped substrings are rejected too',
		);
	}
});

test('vault-style references are the ONLY legal secret carrier and pass validation', () => {
	assert.ok(isSecretRef('vault:openai-api-key'));
	assert.ok(isSecretRef('env:MY_TOKEN'));
	assert.equal(isSecretRef('vault:'), false);
	const parsed = validateSurface({ kind: 'browser', partition: 'vault:browser-session-token' }, 's');
	assert.equal(parsed.kind, 'browser');
});

test('looksSecretShaped detects each credential class; ordinary strings pass', () => {
	assert.equal(looksSecretShaped(runtimeSecretFixture('github-pat')), true);
	assert.equal(looksSecretShaped(runtimeSecretFixture('api-key')), true);
	assert.equal(looksSecretShaped(runtimeSecretFixture('aws-key')), true);
	assert.equal(looksSecretShaped(runtimeSecretFixture('jwt')), true);
	assert.equal(looksSecretShaped(['-----BEGIN RSA ', 'PRIVATE KEY-----'].join('')), true); // assembled at runtime (vault-only fixture discipline)
	assert.equal(looksSecretShaped('Bearer abcdefghijklmnopqr'), true);
	for (const fine of ['persist:flauz-0123456789abcdef', 'flauz:browser:3f9a2b1c8d7e4f60', 'ws://127.0.0.1:9222/devtools/browser/abc', 'src/app.ts', 'flauz.resources/v0', 'glm-4.7', 'T-001']) {
		assert.equal(looksSecretShaped(fine), false, `${fine} must not be flagged`);
	}
});

test('assertNoSecretShapedValues deep-walks objects and arrays with paths', () => {
	const secret = runtimeSecretFixture('github-pat');
	assert.throws(
		() => assertNoSecretShapedValues({ a: { b: [{ c: secret }] } }, 'root'),
		(err: unknown) => err instanceof ResourceGraphError && /root.a.b\[0\].c/.test(err.message),
	);
	assert.doesNotThrow(() => assertNoSecretShapedValues({ a: { b: [{ c: 'vault:key' }] }, n: 1, s: 'plain' }, 'root'));
});

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

function goodEdge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		kind: 'depends-on',
		from: 'flauz:task:T-001',
		to: 'flauz:file:4d5e6f708192a3b4',
		provenance: { actor: 'agent' },
		createdAt: TS,
		...overrides,
	};
}

test('edge validation: closed kind set, exact keys, provenance mandatory', () => {
	const edge = validateEdge(goodEdge(), 'e');
	assert.equal(edge.kind, 'depends-on');
	assert.equal(EDGE_KINDS.length, 6);
	assert.throws(() => validateEdge(goodEdge({ kind: 'parent-of' }), 'e'), /edge kind must be one of/);
	assert.throws(() => validateEdge(goodEdge({ extra: 1 }), 'e'), /exactly the keys/);
	assert.throws(() => validateEdge(goodEdge({ provenance: {} }), 'e'), ResourceGraphError);
	assert.throws(() => validateEdge(goodEdge({ createdAt: 0 }), 'e'), /createdAt/);
});

test('edge legality matrix: illegal endpoint-kind combinations are rejected with the matrix in the message', () => {
	const modelProducesFile = isEdgeLegalForKinds('produced', 'model', 'file');
	assert.equal(modelProducesFile, false);
	assert.match(edgeLegalityError('produced', 'model', 'file'), /produced.*not legal.*model -> file/);
	assert.equal(isEdgeLegalForKinds('produced', 'task', 'artifact'), true);
	assert.equal(isEdgeLegalForKinds('produced', 'agent-session', 'evidence'), true);
	assert.equal(isEdgeLegalForKinds('depends-on', 'task', 'model'), true);
	assert.equal(isEdgeLegalForKinds('depends-on', 'file', 'model'), false); // files are leaves
	assert.equal(isEdgeLegalForKinds('bound-to', 'browser-session', 'environment'), true);
	assert.equal(isEdgeLegalForKinds('bound-to', 'artifact', 'task'), false); // bind targets are env/workspace
	assert.equal(isEdgeLegalForKinds('restored-from', 'browser-session', 'artifact'), true);
	assert.equal(isEdgeLegalForKinds('restored-from', 'provider', 'artifact'), false);
	assert.equal(isEdgeLegalForKinds('snapshot-of', 'artifact', 'environment'), true);
	assert.equal(isEdgeLegalForKinds('derived-from', 'evidence', 'file'), true); // derived-from is any -> any
});

test('an edge carrying a secret-shaped value is rejected', () => {
	const secret = runtimeSecretFixture('api-key');
	assert.throws(
		() => validateEdge(goodEdge({ from: secret }), 'e'),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SECRET',
	);
});

test('a ref carrying a secret-shaped displayName is rejected', () => {
	assert.throws(
		() => validateResourceRef(goodRef({ displayName: runtimeSecretFixture('jwt') })),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_SECRET',
	);
});

// ---------------------------------------------------------------------------
// Canonical serialization + sha256
// ---------------------------------------------------------------------------

test('canonicalJson sorts keys recursively, drops undefined, is byte-stable', () => {
	const a = { b: 2, a: 1, c: { z: 1, y: [3, { q: 1, p: 2 }] } };
	const b = { c: { y: [3, { p: 2, q: 1 }], z: 1 }, a: 1, b: 2 };
	assert.equal(canonicalJson(a), canonicalJson(b));
	assert.equal(canonicalJson(a), '{"a":1,"b":2,"c":{"y":[3,{"p":2,"q":1}],"z":1}}');
	assert.equal(canonicalJson({ u: undefined, k: 1 }), '{"k":1}');
});

test('serializeEnvelope: sorted, 2-space indent, exactly one trailing newline', () => {
	const text = serializeEnvelope({ $schema: 'flauz.resources/v0', nodes: [], edges: [], surfaces: [] });
	assert.equal(text, '{\n  "$schema": "flauz.resources/v0",\n  "edges": [],\n  "nodes": [],\n  "surfaces": []\n}\n');
	assert.equal(text.endsWith('}\n'), true);
	assert.deepEqual(deepSorted({ b: 1, a: { d: 2, c: 3 } }), { a: { c: 3, d: 2 }, b: 1 });
});

test('sha256Hex matches node:crypto over ascii + unicode payloads', () => {
	for (const input of ['', 'flauz.resources/v0', 'flauz ✓ éarth 🌍 payload', JSON.stringify({ a: [1, 2, 3] })]) {
		const expected = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
		assert.equal(sha256Hex(input), expected);
	}
});

test('the typed error carries its code and details', () => {
	const err = new ResourceGraphError('FLAUZ_RESOURCES_REF_IN_USE', 'ref in use', { edges: [{ kind: 'produced' }] });
	assert.equal(err.code, 'FLAUZ_RESOURCES_REF_IN_USE');
	assert.deepEqual(err.details, { edges: [{ kind: 'produced' }] });
	assert.match(err.message, /^FLAUZ_RESOURCES_REF_IN_USE:/);
});

test('ResourceKind vocabulary is the closed v0 set (12 kinds)', () => {
	assert.equal(RESOURCE_KINDS.length, 12);
	assert.deepEqual([...RESOURCE_KINDS].sort(), [
		'agent-session', 'artifact', 'browser-session', 'directory', 'environment', 'evidence',
		'file', 'model', 'provider', 'task', 'workflow', 'workspace',
	]);
});
