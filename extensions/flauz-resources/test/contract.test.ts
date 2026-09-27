/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Cross-worker contract fixtures (the DL-32 sibling convention: duplicated
 * types + literal JSON pins, never cross-extension imports).
 *
 * The literal fixtures under test/fixtures/resources/contracts/ pin:
 *   - Worker A's BrowserSessionDescriptor summary shape (sessionId,
 *     initiator, partition, state) -- produced by our restoration planner and
 *     compared byte-for-byte (canonical JSON) against the fixture;
 *   - the flauz-environments registry descriptor + our EnvironmentSummary
 *     (the environments registry keys environments by descriptor id; our env
 *     refs carry THAT id);
 *   - the flauz-browser evidence-row seam (toEvidenceRow output: kind note +
 *     uri + sha256 + note) bindable as an evidence ref + artifact surface;
 *   - the URN id contract (flauz:browser:<16-hex>; flauz:environment:env-*).
 *
 * Integration drift between the parallel TL3 branches shows up HERE first:
 * if Worker A lands a different descriptor shape, the literal fixture and the
 * duplicated type disagree loudly instead of silently.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ENVIRONMENT_PROVIDER_KINDS,
	canonicalJson,
	isBrowserSessionId,
	isEnvironmentId,
	isResourceUrnForKind,
	isTaskId,
	validateSurface,
	type Surface,
} from '../src/api.ts';
import { ResourceGraph } from '../src/graph.ts';
import { ContinuityService } from '../src/continuity.ts';
import { bootGraph, readFixture, readFixtureJson, steppingClock } from './helpers.ts';

const BROWSER = 'flauz:browser:9c8d7e6f5a4b3c2d';
const ENVIRONMENT = 'flauz:environment:env-staging';
const ARTIFACT = 'flauz:artifact:a1b2c3d4e5f60718';

test('the pinned BrowserSessionDescriptor summary fixture matches the restoration planner output exactly', async () => {
	const good = await readFixture('good', 'graph.json');
	const t = await bootGraph({ clock: steppingClock(), seedGraph: good, seedFiles: { '.flauz/environments.json': await readFixture('contracts', 'environments-registry.json') } });
	const continuity = new ContinuityService({ graph: t.graph });
	const plan = await continuity.planRestoration(BROWSER);
	const fixture = await readFixtureJson('contracts', 'browser-session-descriptor.json');
	// byte-for-byte on canonical JSON: ANY field/type drift fails here
	assert.equal(canonicalJson(plan.summary), canonicalJson(fixture));
	await t.cleanup();
});

test('the pinned EnvironmentSummary fixture matches the restoration planner output exactly (registry present)', async () => {
	const good = await readFixture('good', 'graph.json');
	const t = await bootGraph({ clock: steppingClock(), seedGraph: good, seedFiles: { '.flauz/environments.json': await readFixture('contracts', 'environments-registry.json') } });
	const continuity = new ContinuityService({ graph: t.graph });
	const plan = await continuity.planRestoration(ENVIRONMENT);
	const fixture = await readFixtureJson('contracts', 'environment-descriptor.json');
	assert.equal(canonicalJson(plan.summary), canonicalJson(fixture));
	// the fixture's environmentId must BE a flauz-environments registry id
	assert.ok(isEnvironmentId((fixture as { environmentId: string }).environmentId));
	// ...and the graph's env ref id carries that descriptor id as the URN local part
	assert.ok(isResourceUrnForKind(ENVIRONMENT, 'environment'));
	assert.equal(ENVIRONMENT.split(':')[2], (fixture as { environmentId: string }).environmentId);
	await t.cleanup();
});

test('the environments-registry contract fixture is a valid flauz.environments/v0 envelope for our probe', async () => {
	const registry = await readFixtureJson('contracts', 'environments-registry.json') as {
		$schema: string;
		activeId: string | null;
		environments: Array<{ id: string; kind: string; enabled: boolean }>;
	};
	assert.equal(registry.$schema, 'flauz.environments/v0');
	const staging = registry.environments.find(entry => entry.id === 'env-staging');
	assert.ok(staging !== undefined);
	assert.equal(staging.kind, 'container');
	assert.ok((ENVIRONMENT_PROVIDER_KINDS as readonly string[]).includes(staging.kind), 'providerKind vocabulary is the contract-duplicated set');
});

test('the evidence-row seam fixture binds as an evidence ref + artifact surface (flauz-browser toEvidenceRow shape)', async () => {
	const row = await readFixtureJson('contracts', 'evidence-row.json') as { kind: string; uri: string; sha256: string; note: string };
	// the seam shape: kind 'note', uri, sha256, note (flauz-browser policy.ts toEvidenceRow)
	assert.equal(row.kind, 'note');
	assert.match(row.sha256, /^[0-9a-f]{64}$/);
	// bindable: an evidence ref with an artifact surface carrying the row's uri + sha256
	const surface = validateSurface({ kind: 'artifact', uri: row.uri, sha256: row.sha256 }, 'row') as Surface;
	assert.equal(surface.kind, 'artifact');
	if (surface.kind === 'artifact') {
		assert.equal(surface.uri, row.uri);
		assert.equal(surface.sha256, row.sha256);
	}
	// the taskSurface of the producing task validates against the duplicated T-\d{3,} pattern
	const taskSurface = validateSurface({ kind: 'task', envelopePath: '.flauz/tasks.json', taskId: 'T-001' }, 'ts');
	assert.ok(isTaskId(taskSurface.kind === 'task' ? taskSurface.taskId : ''));
});

test('the URN id contract: Worker A browser ids + registry descriptor ids (fixture-pinned)', async () => {
	const urns = await readFixtureJson('contracts', 'urn-ids.json') as {
		browserSessionId: string;
		agentSessionId: string;
		environmentRefId: string;
		taskRefId: string;
		invalid: string[];
	};
	assert.ok(isBrowserSessionId(urns.browserSessionId), 'browser session id is exactly flauz:browser:<16-hex>');
	assert.ok(isResourceUrnForKind(urns.browserSessionId, 'browser-session'));
	assert.ok(isResourceUrnForKind(urns.agentSessionId, 'agent-session'), 'agent sessions use the flauz:agent: namespace');
	assert.ok(isResourceUrnForKind(urns.environmentRefId, 'environment'));
	assert.ok(isEnvironmentId(urns.environmentRefId.split(':')[2] ?? ''), 'env ref local part is the registry descriptor id');
	assert.ok(isResourceUrnForKind(urns.taskRefId, 'task'));
	for (const bad of urns.invalid) {
		assert.equal(isResourceUrnForKind(bad, 'file'), false, `${bad} must not validate`);
	}
});

test('the good fixture graph carries the browser session bound to the environment (Worker A + Worker B composition story)', async () => {
	const good = await readFixture('good', 'graph.json');
	const graph = new ResourceGraph({ root: '/fixture', fs: {
		readFileUtf8: async () => good,
		writeFile: async () => undefined,
		appendFile: async () => undefined,
		rename: async () => undefined,
		mkdir: async () => undefined,
	} });
	await graph.bootstrap();
	const bound = graph.neighbors(BROWSER, 'bound-to');
	assert.deepEqual(bound.map(link => link.ref.id), [ENVIRONMENT]);
	const snapshot = graph.neighbors(BROWSER, 'snapshot-of').map(link => ({ edge: link.edgeKind, other: link.ref.id }));
	assert.deepEqual(snapshot, [{ edge: 'snapshot-of', other: ARTIFACT }]);
});
