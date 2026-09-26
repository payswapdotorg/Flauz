/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Registry lifecycle + envelope persistence tests.
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */
import { test } from 'node:test';
import { ok, strictEqual, notStrictEqual, deepStrictEqual, throws, match, rejects } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { EnvironmentRegistry } from '../src/registry.ts';
import { sshRegistrationInput, bootRegistry, fixedClock, steppingClock, readFixture } from './helpers.ts';

test('bootstrap creates the empty envelope at .flauz/environments.json', async () => {
	const t = await bootRegistry();
	try {
		strictEqual(t.registry.list().length, 0);
		strictEqual(t.registry.activeId(), null);
		const raw = await fs.readFile(path.join(t.root, '.flauz', 'environments.json'), { encoding: 'utf-8' });
		strictEqual(raw, '{\n  "$schema": "flauz.environments/v0",\n  "activeId": null,\n  "environments": []\n}\n', 'empty envelope is canonical 2-space + trailing newline');
	} finally {
		await t.cleanup();
	}
});

test('bootstrap is idempotent (second call returns same state)', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput() as never);
		const before = t.registry.serialize();
		await t.registry.bootstrap();
		strictEqual(t.registry.serialize(), before);
	} finally {
		await t.cleanup();
	}
});

test('register validates, mints timing, persists atomically, and lists sorted by id', async () => {
	const t = await bootRegistry({ clock: steppingClock() });
	try {
		await t.registry.register(sshRegistrationInput({ id: 'env-zulu' }) as never);
		await t.registry.register(sshRegistrationInput({ id: 'env-alpha', connection: { authorityPrefix: 'test' }, kind: 'workspace-remote' }) as never);
		deepStrictEqual(t.registry.list().map(d => d.id), ['env-alpha', 'env-zulu'], 'sorted by id for stable diffs');
		const zulu = t.registry.get('env-zulu')!;
		strictEqual(zulu.timing.created, 1000, 'clock minted');
		strictEqual(zulu.timing.updatedAt, 1000);
		ok(t.registry.get('env-zulu') !== t.registry.get('env-zulu'), 'get returns independent clones');
		// persisted + atomic: no .tmp residue, file parses
		const files = await fs.readdir(path.join(t.root, '.flauz'));
		deepStrictEqual(files, ['environments.json'], 'no tmp residue');
		await EnvironmentRegistry.parseEnvelope(await fs.readFile(path.join(t.root, '.flauz', 'environments.json'), { encoding: 'utf-8' }));
	} finally {
		await t.cleanup();
	}
});

test('register rejects duplicate ids and invalid descriptors with schema-prefixed errors', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput() as never);
		await rejects(t.registry.register(sshRegistrationInput() as never), /register rejected: environment 'env-test-ssh' already exists/);
		await rejects(t.registry.register(sshRegistrationInput({ id: 'BAD' }) as never), /flauz\.environments\/v0: register rejected:.*id must match/);
	} finally {
		await t.cleanup();
	}
});

test('register returns a clone -- mutating the result does not corrupt the registry', async () => {
	const t = await bootRegistry();
	try {
		const descriptor = await t.registry.register(sshRegistrationInput() as never);
		(descriptor as { label: string }).label = 'mutated';
		strictEqual(t.registry.get('env-test-ssh')!.label, 'Test SSH');
	} finally {
		await t.cleanup();
	}
});

test('unregister removes the descriptor and clears a dangling activeId', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput() as never);
		await t.registry.activate('env-test-ssh');
		strictEqual(t.registry.activeId(), 'env-test-ssh');
		await t.registry.unregister('env-test-ssh');
		strictEqual(t.registry.activeId(), null, 'activeId cleared');
		strictEqual(t.registry.list().length, 0);
		await rejects(t.registry.unregister('env-test-ssh'), /unregister rejected.*does not exist/);
	} finally {
		await t.cleanup();
	}
});

test('activate sets activeId, persists, and emits a connection plan (no live connection)', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput() as never);
		const plan = await t.registry.activate('env-test-ssh');
		strictEqual(t.registry.activeId(), 'env-test-ssh');
		strictEqual(plan.$schema, 'flauz.connectionPlan/v0');
		strictEqual(plan.authority, 'ssh-remote+test.example.internal');
		ok(plan.phases.length >= 4, 'phased plan');
		// state survives a reload (persistence is the continuity substrate)
		const reloaded = new EnvironmentRegistry({ root: t.root, fs: t.fs, clock: fixedClock() });
		await reloaded.bootstrap();
		strictEqual(reloaded.activeId(), 'env-test-ssh', 'activeId persisted across re-open');
		strictEqual(reloaded.list().length, 1);
	} finally {
		await t.cleanup();
	}
});

test('activate rejects unknown + disabled environments; deactivate clears', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput({ enabled: false }) as never);
		await rejects(t.registry.activate('env-test-ssh'), /activate rejected.*disabled/);
		await rejects(t.registry.activate('env-nope'), /activate rejected.*does not exist/);
		throws(() => t.registry.planFor('env-nope'), /plan rejected.*does not exist/);
	} finally {
		await t.cleanup();
	}
});

test('serialization is canonical: sorted keys, 2-space, single trailing newline, round-trip stable', async () => {
	const t = await bootRegistry({ clock: fixedClock() });
	try {
		await t.registry.register(sshRegistrationInput() as never);
		const once = t.registry.serialize();
		const twice = t.registry.serialize();
		strictEqual(once, twice, 'deterministic');
		ok(once.endsWith('\n') && !once.endsWith('\n\n'), 'exactly one trailing newline');
		match(once, /\n  "\$schema"/, '2-space indent');
		// sorted keys at top level: $schema < activeId < environments
		const schemaIdx = once.indexOf('"$schema"');
		const activeIdx = once.indexOf('"activeId"');
		const envIdx = once.indexOf('"environments"');
		ok(schemaIdx < activeIdx && activeIdx < envIdx, 'canonical key order');
		t.registry.verifyRoundTrip();
	} finally {
		await t.cleanup();
	}
});

test('parseEnvelope loads the good fixture registry and keeps sorted order + activeId', async () => {
	const envelope = EnvironmentRegistry.parseEnvelope(await readFixture('good', 'registry.json'));
	strictEqual(envelope.activeId, 'env-build-box');
	deepStrictEqual(
		envelope.environments.map(d => d.id),
		['env-bridge-host', 'env-build-box', 'env-dev-container', 'env-e2b-main', 'env-tunnel-remote'],
		'fixture registry sorted by id',
	);
});

test('parseEnvelope rejects malformed documents with schema-prefixed errors', () => {
	throws(() => EnvironmentRegistry.parseEnvelope('not json {{{'), /flauz\.environments\/v0: registry is not valid JSON/);
	throws(() => EnvironmentRegistry.parseEnvelope('{}'), /\$schema exactly/);
	throws(() => EnvironmentRegistry.parseEnvelope('{"$schema":"flauz.environments/v0"}'), /must carry activeId/);
	throws(() => EnvironmentRegistry.parseEnvelope('{"$schema":"flauz.environments/v0","activeId":null}'), /environments array/);
	throws(() => EnvironmentRegistry.parseEnvelope('{"$schema":"flauz.environments/v0","activeId":null,"environments":[{]}'), /not valid JSON/);
});

test('registry requires bootstrap before lifecycle calls', () => {
	const registry = new EnvironmentRegistry({ root: '/tmp/never', fs: {
		readFileUtf8: async () => undefined,
		writeFile: async () => undefined,
		rename: async () => undefined,
		mkdir: async () => undefined,
	} });
	throws(() => registry.list(), /not bootstrapped/);
});

test('unregister keeps other environments and their activation intact', async () => {
	const t = await bootRegistry();
	try {
		await t.registry.register(sshRegistrationInput() as never);
		await t.registry.register(sshRegistrationInput({ id: 'env-other', connection: { authorityPrefix: 'test' }, kind: 'workspace-remote' }) as never);
		await t.registry.activate('env-other');
		await t.registry.unregister('env-test-ssh');
		strictEqual(t.registry.activeId(), 'env-other', 'unrelated activeId preserved');
		strictEqual(t.registry.list().length, 1);
		notStrictEqual(t.registry.planFor('env-other'), undefined);
	} finally {
		await t.cleanup();
	}
});
