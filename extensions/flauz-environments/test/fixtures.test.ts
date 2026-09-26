/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Repo fixture matrix tests (test/fixtures/environments/): good descriptors +
 * registry parse; EVERY bad fixture is rejected with a schema-prefixed error
 * (each validation rule violated at least once -- see bad/README coverage
 * table); plan golden pins; continuity fixtures classify as expected.
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws } from 'node:assert';

import { canonicalJson } from '../src/api.ts';
import { EnvironmentRegistry } from '../src/registry.ts';
import { validateDescriptor, buildConnectionPlan } from '../src/providers/index.ts';
import { classifyWorkspaceState } from '../src/continuity.ts';
import { listFixtureFiles, readFixture, readFixtureJson } from './helpers.ts';

const BAD_DESCRIPTOR_PREFIX = /flauz\.environments\/v0:/;

test('every good descriptor fixture validates', async () => {
	const files = await listFixtureFiles('good');
	deepStrictEqual(files, [
		'descriptor-cloud-sandbox.json',
		'descriptor-container.json',
		'descriptor-ssh-bridged.json',
		'descriptor-ssh.json',
		'descriptor-workspace-remote.json',
		'registry.json',
	]);
	for (const file of files.filter(f => f.startsWith('descriptor-'))) {
		const descriptor = validateDescriptor(await readFixtureJson('good', file));
		ok(descriptor.id.startsWith('env-'));
	}
});

test('good registry fixture parses, round-trips through canonical serialization, and activates every environment', async () => {
	const raw = await readFixture('good', 'registry.json');
	const envelope = EnvironmentRegistry.parseEnvelope(raw);
	// canonical round-trip: parse(serialize(parsed)) === parsed
	strictEqual(canonicalJson(EnvironmentRegistry.parseEnvelope(JSON.stringify(envelope))), canonicalJson(envelope));
	// every environment produces a connection plan (activation-ready)
	for (const descriptor of envelope.environments) {
		const plan = buildConnectionPlan(descriptor);
		strictEqual(plan.environmentId, descriptor.id);
		strictEqual(plan.kind, descriptor.kind);
	}
	strictEqual(envelope.environments.length, 5, 'four kinds + the bridged ssh variant');
});

test('every bad descriptor fixture is rejected (each carries a distinct violation)', async () => {
	const files = (await listFixtureFiles('bad')).filter(f => !f.startsWith('19-registry-not-json'));
	// every numbered bad descriptor/envelope fixture except the raw-text one
	ok(files.length >= 40, `bad fixture matrix covers all rules (found ${files.length})`);
	for (const file of files) {
		const raw = await readFixture('bad', file);
		let value: unknown;
		try {
			value = JSON.parse(raw);
		} catch (err) {
			throw new Error(`bad fixture ${file} must be valid JSON to reach the validator (use 19- for raw text): ${err instanceof Error ? err.message : String(err)}`);
		}
		if (file.startsWith('2')) {
			// envelope-level fixtures (20-registry-*, 21-...): parseEnvelope must reject
			throws(() => EnvironmentRegistry.parseEnvelope(raw), BAD_DESCRIPTOR_PREFIX, `${file} must be rejected by parseEnvelope`);
		} else {
			// descriptor-level fixtures: validateDescriptor (via parseEnvelope path) must reject
			throws(() => validateDescriptor(value), BAD_DESCRIPTOR_PREFIX, `${file} must be rejected by validateDescriptor`);
			// and the full envelope path rejects it too (with index context)
			const wrapped = JSON.stringify({ $schema: 'flauz.environments/v0', activeId: null, environments: [value] });
			throws(() => EnvironmentRegistry.parseEnvelope(wrapped), /flauz\.environments\/v0: environments\[0\]:/, `${file} must be rejected with index context in an envelope`);
		}
	}
});

test('the raw-text registry fixture (19-) is rejected as invalid JSON', async () => {
	const raw = await readFixture('bad', '19-registry-not-json.json');
	throws(() => EnvironmentRegistry.parseEnvelope(raw), /registry is not valid JSON/);
});

test('the duplicate-id fixture is rejected by the envelope (not descriptor) validator', async () => {
	const raw = await readFixture('bad', '24-registry-duplicate-ids.json');
	throws(() => EnvironmentRegistry.parseEnvelope(raw), /duplicate environment id/);
});

test('plan fixtures are golden pins: generated plans match the committed fixtures semantically', async () => {
	const pairs: readonly (readonly [string, string])[] = [
		['descriptor-ssh.json', 'expected-plan-ssh.json'],
		['descriptor-ssh-bridged.json', 'expected-plan-ssh-bridged.json'],
		['descriptor-container.json', 'expected-plan-container.json'],
		['descriptor-cloud-sandbox.json', 'expected-plan-cloud-sandbox.json'],
		['descriptor-workspace-remote.json', 'expected-plan-workspace-remote.json'],
	];
	for (const [descriptorFile, planFile] of pairs) {
		const descriptor = validateDescriptor(await readFixtureJson('good', descriptorFile));
		const plan = buildConnectionPlan(descriptor);
		const expected = await readFixtureJson('plans', planFile);
		strictEqual(canonicalJson(plan), canonicalJson(expected), `${planFile} pins the generated plan for ${descriptorFile}`);
	}
});

test('continuity fixtures: full snapshot classifies 5/6/5; minimal matches its expected report; bad ones rejected', async () => {
	const all = classifyWorkspaceState(await readFixtureJson('continuity', 'snapshot-all.json') as { surfaces: string[] });
	strictEqual(all.persists.length, 5);
	strictEqual(all.rehydrates.length, 6);
	strictEqual(all.lost.length, 5);

	const minimal = classifyWorkspaceState(await readFixtureJson('continuity', 'snapshot-minimal.json') as { surfaces: string[] });
	const expected = await readFixtureJson('continuity', 'expected-report-minimal.json') as { persists: string[]; rehydrates: string[]; lost: string[] };
	deepStrictEqual(
		{
			persists: minimal.persists.map(a => a.id),
			rehydrates: minimal.rehydrates.map(a => a.id),
			lost: minimal.lost.map(a => a.id),
		},
		expected,
	);

	const unknownSurfaces = (await readFixtureJson('continuity', 'bad-snapshot-unknown-surface.json') as { surfaces: string[] }).surfaces;
	throws(() => classifyWorkspaceState({ surfaces: unknownSurfaces }), /unknown continuity artifact 'coffee-machine-state'/);
	const duplicateSurfaces = (await readFixtureJson('continuity', 'bad-snapshot-duplicate-surface.json') as { surfaces: string[] }).surfaces;
	throws(() => classifyWorkspaceState({ surfaces: duplicateSurfaces }), /duplicate surface 'flauz-evidence-ledger'/);
});
