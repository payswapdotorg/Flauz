/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Continuity suite: restoration plans per family (browser-session summary
 * contract-aligned with Worker A; environment summary contract-aligned with
 * the flauz-environments registry; file/artifact path + hash); restored-from
 * edge recording on successful restoration; the no-origin fail-closed rule;
 * the no-credentials invariant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ResourceGraphError } from '../src/api.ts';
import { verifyWorkspace } from '../src/graph.ts';
import { ContinuityService, planCarriesNoCredentials, type RestorationPlan } from '../src/continuity.ts';
import { AGENT, HUMAN, TOOL, bootGraph, readFixture, steppingClock } from './helpers.ts';

const FILE = 'flauz:file:4d5e6f708192a3b4';
const ARTIFACT = 'flauz:artifact:a1b2c3d4e5f60718';
const ENVIRONMENT = 'flauz:environment:env-staging';
const BROWSER = 'flauz:browser:9c8d7e6f5a4b3c2d';
const SNAPSHOT = 'flauz:artifact:1111222233334444';
const TASK = 'flauz:task:T-001';
const SHA = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';

async function continuityFixture() {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, displayName: 'login flow session', provenance: AGENT });
	await t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc', partition: 'persist:flauz-0123456789abcdef' }, AGENT);
	await t.graph.addRef({ kind: 'environment', id: ENVIRONMENT, provenance: HUMAN });
	await t.graph.addSurface(ENVIRONMENT, { kind: 'environment', descriptorId: 'env-staging', providerKind: 'container', attachTarget: 'devcontainer:acme' }, HUMAN);
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/app.ts', contentSha256: SHA }, AGENT);
	await t.graph.addRef({ kind: 'artifact', id: ARTIFACT, provenance: TOOL });
	await t.graph.addSurface(ARTIFACT, { kind: 'artifact', uri: '.flauz/artifacts/T-001/shot.png', sha256: SHA }, TOOL);
	await t.graph.addRef({ kind: 'artifact', id: SNAPSHOT, displayName: 'session snapshot', provenance: TOOL });
	await t.graph.addEdge({ kind: 'snapshot-of', from: SNAPSHOT, to: BROWSER }, TOOL);
	const continuity = new ContinuityService({ graph: t.graph });
	return { ...t, continuity };
}

test('browser-session restoration plan carries the pinned descriptor summary + recovery hint', async () => {
	const t = await continuityFixture();
	const plan = await t.continuity.planRestoration(BROWSER);
	assert.equal(plan.family, 'browser-session');
	assert.equal(plan.refId, BROWSER);
	if (plan.family !== 'browser-session') {
		throw new Error('unreachable');
	}
	assert.deepEqual(plan.summary, {
		sessionId: BROWSER,                     // Worker A's pinned session-id shape: the ref id IS flauz:browser:<16-hex>
		initiator: 'agent-tool',                // derived from ref provenance (actor agent)
		partition: 'persist:flauz-0123456789abcdef',
		state: 'unknown',                       // v0: no live runtime; the FIELD is pinned, vocabulary arrives with the browser lane
	});
	assert.match(plan.hint, /re-attach the session through the browser runtime/);
	assert.match(plan.hint, /persist:flauz-0123456789abcdef/);
	await t.cleanup();
});

test('browser-session initiator derives from provenance: human -> user', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const humanSession = 'flauz:browser:aaaabbbbccccdddd';
	await t.graph.addRef({ kind: 'browser-session', id: humanSession, provenance: HUMAN });
	await t.graph.addSurface(humanSession, { kind: 'browser' }, HUMAN);
	const continuity = new ContinuityService({ graph: t.graph });
	const plan = await continuity.planRestoration(humanSession);
	if (plan.family !== 'browser-session') {
		throw new Error('unreachable');
	}
	assert.equal(plan.summary.initiator, 'user');
	assert.equal(plan.summary.partition, null); // no partition recorded on the surface
	await t.cleanup();
});

test('environment restoration plan carries the registry summary + plan re-execution hint', async () => {
	const t = await continuityFixture();
	// registry ABSENT in the temp workspace: degraded-but-honest summary
	const plan = await t.continuity.planRestoration(ENVIRONMENT);
	if (plan.family !== 'environment') {
		throw new Error('unreachable');
	}
	assert.deepEqual(plan.summary, {
		environmentId: 'env-staging',
		providerKind: 'container',
		registryState: 'absent',
		enabled: null,
		active: null,
	});
	assert.match(plan.hint, /re-execute the connection plan: flauz\.env\.activate env-staging/);
	await t.cleanup();
});

test('environment summary reads the sibling registry when present (contract file, read-only)', async () => {
	const t = await continuityFixture();
	const registry = JSON.stringify({
		$schema: 'flauz.environments/v0',
		activeId: null,
		environments: [{
			id: 'env-staging',
			kind: 'container',
			label: 'Staging',
			connection: { workspaceFolder: '/work/acme', name: 'acme' },
			trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
			capabilities: { browser: false, exec: true, agentHost: true, terminal: true },
			enabled: true,
			timing: { created: 1, updatedAt: 2 },
		}],
	}, null, 2);
	await fs.writeFile(path.join(t.root, '.flauz', 'environments.json'), registry, { encoding: 'utf-8' });
	const plan = await t.continuity.planRestoration(ENVIRONMENT);
	if (plan.family !== 'environment') {
		throw new Error('unreachable');
	}
	assert.deepEqual(plan.summary, {
		environmentId: 'env-staging',
		providerKind: 'container',
		registryState: 'present',
		enabled: true,
		active: false,
	});
	// unreadable registry degrades instead of failing
	await fs.writeFile(path.join(t.root, '.flauz', 'environments.json'), '{broken', { encoding: 'utf-8' });
	const degraded = await t.continuity.planRestoration(ENVIRONMENT);
	if (degraded.family !== 'environment') {
		throw new Error('unreachable');
	}
	assert.equal(degraded.summary.registryState, 'unreadable');
	await t.cleanup();
});

test('file/artifact restoration plans carry path + content hash', async () => {
	const t = await continuityFixture();
	const filePlan = await t.continuity.planRestoration(FILE);
	if (filePlan.family !== 'file-artifact') {
		throw new Error('unreachable');
	}
	assert.deepEqual(filePlan.summary, { path: '/work/acme/src/app.ts', contentSha256: SHA });
	assert.match(filePlan.hint, /verify sha256/);

	const artifactPlan = await t.continuity.planRestoration(ARTIFACT);
	if (artifactPlan.family !== 'file-artifact') {
		throw new Error('unreachable');
	}
	assert.deepEqual(artifactPlan.summary, { path: '.flauz/artifacts/T-001/shot.png', contentSha256: SHA });

	// a file-system surface without contentSha256 yields null (documented)
	const t2 = await bootGraph({ clock: steppingClock() });
	await t2.graph.addRef({ kind: 'directory', id: 'flauz:directory:src', provenance: AGENT });
	await t2.graph.addSurface('flauz:directory:src', { kind: 'file-system', root: '/work/acme', path: 'src' }, AGENT);
	const dirPlan = await new ContinuityService({ graph: t2.graph }).planRestoration('flauz:directory:src');
	if (dirPlan.family !== 'file-artifact') {
		throw new Error('unreachable');
	}
	assert.deepEqual(dirPlan.summary, { path: '/work/acme/src', contentSha256: null });
	await t2.cleanup();
	await t.cleanup();
});

test('restore() records the restored-from edge (default: newest snapshot-of ancestor)', async () => {
	const t = await continuityFixture();
	const outcome = await t.continuity.restore(BROWSER, { provenance: AGENT });
	assert.equal(outcome.edge.kind, 'restored-from');
	assert.equal(outcome.edge.from, BROWSER);
	assert.equal(outcome.edge.to, SNAPSHOT, 'origin defaulted to the snapshot-of ancestor');
	assert.equal(outcome.plan.refId, BROWSER);
	// the edge is in the graph and participates in lineage
	assert.equal(t.graph.neighbors(BROWSER, 'restored-from').length, 1);
	assert.deepEqual(t.graph.lineage(BROWSER).map(r => r.id), [BROWSER, SNAPSHOT]);
	// the ops log recorded BOTH the add-edge and the dedicated restore op
	const ops = await t.graph.ops();
	assert.deepEqual(ops.map(o => o.op).slice(-2), ['add-edge', 'restore']);
	const restoreOp = ops[ops.length - 1];
	assert.equal(restoreOp?.op, 'restore');
	assert.equal(restoreOp?.refId, BROWSER);
	await t.cleanup();
});

test('restore() with an explicit fromRefId uses it; a missing origin is a typed rejection', async () => {
	const t = await continuityFixture();
	const outcome = await t.continuity.restore(FILE, { provenance: HUMAN, fromRefId: ARTIFACT });
	assert.equal(outcome.edge.to, ARTIFACT);

	// ENVIRONMENT has no snapshot ancestor and no fromRefId -> fail-closed
	// (the task kind has NO v0 restoration family -- a different typed error)
	await assert.rejects(
		() => t.continuity.restore(ENVIRONMENT, { provenance: AGENT }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_RESTORE' && /no restoration origin/.test(err.message),
	);
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: AGENT });
	await assert.rejects(
		() => t.continuity.restore(TASK, { provenance: AGENT }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_RESTORE' && /no v0 restoration family/.test(err.message),
	);
	// unknown origin ref -> typed rejection
	await assert.rejects(
		() => t.continuity.restore(FILE, { provenance: AGENT, fromRefId: 'flauz:artifact:eeeeeeeeeeeeeeee' }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_RESTORE' && /origin ref .* does not exist/.test(err.message),
	);
	// self-origin -> typed rejection
	await assert.rejects(
		() => t.continuity.restore(FILE, { provenance: AGENT, fromRefId: FILE }),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_RESTORE' && /self-edges are illegal/.test(err.message),
	);
	await t.cleanup();
});

test('restore() rejections: unknown ref, non-restorable kind, missing family surface', async () => {
	const t = await continuityFixture();
	await assert.rejects(
		() => t.continuity.restore('flauz:file:0000000000000000', { provenance: AGENT }),
		/does not exist/,
	);
	const t2 = await bootGraph({ clock: steppingClock() });
	await t2.graph.addRef({ kind: 'model', id: 'flauz:model:glm-4-7', provenance: AGENT });
	await assert.rejects(
		() => new ContinuityService({ graph: t2.graph }).restore('flauz:model:glm-4-7', { provenance: AGENT }),
		(err: unknown) => err instanceof ResourceGraphError && /no v0 restoration family/.test(err.message),
	);
	// browser-session WITHOUT a browser surface
	await t2.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await assert.rejects(
		() => new ContinuityService({ graph: t2.graph }).planRestoration(BROWSER),
		/no current browser surface/,
	);
	await t2.cleanup();
	await t.cleanup();
});

test('the no-credentials invariant: plans never carry secret-shaped values', async () => {
	const t = await continuityFixture();
	const plans: RestorationPlan[] = [
		await t.continuity.planRestoration(BROWSER),
		await t.continuity.planRestoration(ENVIRONMENT),
		await t.continuity.planRestoration(FILE),
		await t.continuity.planRestoration(ARTIFACT),
	];
	for (const plan of plans) {
		assert.equal(planCarriesNoCredentials(plan), true, `${plan.refId} plan must carry no credentials`);
	}
	// and the guarantee is enforced at construction time: a surface whose
	// endpoint looks like a credential can never produce a plan
	const t2 = await bootGraph({ clock: steppingClock() });
	await t2.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await assert.rejects(
		() => t2.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: `ws://127.0.0.1:9222/${'ghp_' + 'x'.repeat(30)}` }, AGENT),
		/secret-shaped literal rejected/,
	);
	await t2.cleanup();
	await t.cleanup();
});

test('restore() on the good fixture: the browser session + snapshot story works end to end', async () => {
	// seed a workspace from the good fixture and restore the browser session
	const good = await readFixture('good', 'graph.json');
	const t = await bootGraph({ clock: steppingClock(), seedGraph: good });
	const continuity = new ContinuityService({ graph: t.graph });
	const outcome = await continuity.restore('flauz:browser:9c8d7e6f5a4b3c2d', { provenance: { actor: 'agent', actorId: 'flauz-agent' } });
	assert.equal(outcome.edge.to, 'flauz:artifact:a1b2c3d4e5f60718'); // the fixture's screenshot snapshot
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops !== undefined && report.ops.ok, true);
	await t.cleanup();
});
