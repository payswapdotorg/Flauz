/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * DL-82 convergence suite (P2-FIX-111) -- the restrict-the-matrix law's
 * acceptance gate.
 *
 * The asymmetry (observed on the pinned base 3928b0eeeba): EDGE_LEGALITY's
 * RESTORABLE_KINDS admitted task/agent-session/workflow as restored-from/
 * snapshot-of from-kinds while ContinuityService's FAMILY_BY_KIND has no v0
 * restoration family for them -- restorable in the graph grammar,
 * unexecutable in the service. DL-82 (the decided law, WORK-REGISTRY.md
 * "TL-A decision record -- DL-82") converges RESTORABLE_KINDS to exactly
 * the kinds with v0 restoration families; the owning lanes re-admit their
 * kinds in their own waves when they mint their restoration families.
 *
 * LEGS:
 *   - REGRESSION legs FAIL on the untouched base and PASS on the fix (the
 *     acceptance gate: a restoration from-kind outside the converged set is
 *     rejected by the legality check, at append, at load and by verify).
 *   - guard legs pin the no-regression surface: converged kinds (incl. a
 *     file-kind ref) still restore through the real families; the typed
 *     restore error's closed-set message matches the converged set; the
 *     derived-from wildcard rows, the depends-on/produced/bound-to rows and
 *     the good fixture are untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	ResourceGraphError,
	edgeLegalityError,
	isEdgeLegalForKinds,
	type ResourceKind,
} from '../src/api.ts';
import { ResourceGraph, verifyEnvelope, verifyWorkspace } from '../src/graph.ts';
import { ContinuityService } from '../src/continuity.ts';
import { AGENT, HUMAN, TOOL, bootGraph, readFixture, steppingClock } from './helpers.ts';

const FILE = 'flauz:file:4d5e6f708192a3b4';
const ARTIFACT = 'flauz:artifact:a1b2c3d4e5f60718';
const SNAPSHOT = 'flauz:artifact:1111222233334444';
const TASK = 'flauz:task:T-001';
const AGENT_SESSION = 'flauz:agent:3f9a2b1c8d7e4f60';
const WORKFLOW = 'flauz:workflow:release-pipeline';
const SHA = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';

/** The converged restorable vocabulary (DL-82): exactly the kinds with v0 restoration families. */
const CONVERGED_RESTORABLE: readonly ResourceKind[] = [
	'file', 'directory', 'artifact', 'evidence', 'browser-session', 'environment',
];

/** The plan kinds that left the restorable from-kinds (the owning lanes re-admit them in their own waves). */
const PLAN_KINDS: readonly ResourceKind[] = ['task', 'agent-session', 'workflow'];

// ---------------------------------------------------------------------------
// REGRESSION legs (fail on base, pass on fix) -- the acceptance gate
// ---------------------------------------------------------------------------

test('REGRESSION (DL-82): restoration from-kinds outside the converged set are rejected by the legality check', () => {
	for (const kind of PLAN_KINDS) {
		assert.equal(isEdgeLegalForKinds('restored-from', kind, 'file'), false, `restored-from from ${kind} must be illegal`);
		assert.equal(isEdgeLegalForKinds('snapshot-of', kind, 'file'), false, `snapshot-of from ${kind} must be illegal`);
	}
	// snapshot-of shares the same constant on its to side: the plan kinds leave there too
	for (const kind of PLAN_KINDS) {
		assert.equal(isEdgeLegalForKinds('snapshot-of', 'file', kind), false, `snapshot-of to ${kind} must be illegal`);
	}
	// every converged kind stays restorable (from side; snapshot-of both sides)
	for (const kind of CONVERGED_RESTORABLE) {
		assert.equal(isEdgeLegalForKinds('restored-from', kind, 'file'), true, `restored-from from ${kind} stays legal`);
	}
	for (const from of CONVERGED_RESTORABLE) {
		for (const to of CONVERGED_RESTORABLE) {
			assert.equal(isEdgeLegalForKinds('snapshot-of', from, to), true, `snapshot-of ${from} -> ${to} stays legal`);
		}
	}
	// scope guard: restored-from's to side stays the wildcard origin row (any kind may be an origin)
	for (const kind of PLAN_KINDS) {
		assert.equal(isEdgeLegalForKinds('restored-from', 'file', kind), true, `restored-from to ${kind} stays legal (origin wildcard untouched)`);
	}
});

test('REGRESSION (DL-82): the matrix rejection message lists the converged restorable set', () => {
	assert.equal(isEdgeLegalForKinds('restored-from', 'task', 'file'), false);
	const message = edgeLegalityError('restored-from', 'task', 'file');
	assert.match(message, /edge 'restored-from' is not legal for endpoint kinds task -> file/);
	assert.match(message, /legal: from \[file\|directory\|artifact\|evidence\|browser-session\|environment\] to \[any\]/);
	// the from-LIST itself admits none of the plan kinds (the endpoint kinds in the header name the rejected pair)
	const fromList = /\(legal: from \[([^\]]+)\] to/.exec(message)?.[1] ?? '';
	assert.equal(fromList, CONVERGED_RESTORABLE.join('|'));
	for (const kind of PLAN_KINDS) {
		assert.equal(fromList.includes(kind), false, `the converged from-list must not admit ${kind}`);
	}
	const snapshotMessage = edgeLegalityError('snapshot-of', 'agent-session', 'file');
	assert.match(snapshotMessage, /edge 'snapshot-of' is not legal for endpoint kinds agent-session -> file/);
	assert.match(snapshotMessage, /legal: from \[file\|directory\|artifact\|evidence\|browser-session\|environment\] to \[file\|directory\|artifact\|evidence\|browser-session\|environment\]/);
});

test('REGRESSION (DL-82): addEdge rejects restored-from/snapshot-of edges from the plan kinds (append-time gate)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.addRef({ kind: 'agent-session', id: AGENT_SESSION, provenance: AGENT });
	await t.graph.addRef({ kind: 'workflow', id: WORKFLOW, provenance: HUMAN });
	for (const from of [TASK, AGENT_SESSION, WORKFLOW]) {
		await assert.rejects(
			() => t.graph.addEdge({ kind: 'restored-from', from, to: FILE }, AGENT),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /not legal for endpoint kinds .* -> file/.test(err.message),
			`restored-from from ${from} must be rejected`,
		);
	}
	for (const from of [TASK, AGENT_SESSION, WORKFLOW]) {
		await assert.rejects(
			() => t.graph.addEdge({ kind: 'snapshot-of', from, to: FILE }, AGENT),
			(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /not legal for endpoint kinds .* -> file/.test(err.message),
			`snapshot-of from ${from} must be rejected`,
		);
	}
	// the snapshot-of to side converged with the same constant
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'snapshot-of', from: FILE, to: WORKFLOW }, AGENT),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /not legal for endpoint kinds file -> workflow/.test(err.message),
		'snapshot-of to workflow must be rejected',
	);
	await t.cleanup();
});

test('REGRESSION (DL-82): the 69 bad fixture (restored-from from a task) is rejected at load and flagged by verify', async () => {
	const raw = await readFixture('bad', '69-edge-illegal-restored-from-task-kind.json');
	assert.throws(
		() => ResourceGraph.parseEnvelope(raw),
		(err: unknown) => err instanceof ResourceGraphError && err.code === 'FLAUZ_RESOURCES_EDGE_ILLEGAL' && /not legal for endpoint kinds task -> file/.test(err.message),
		'the plan-kind restoration edge must be rejected at load',
	);
	const report = verifyEnvelope(JSON.parse(raw));
	assert.equal(report.ok, false, 'verifyEnvelope flags the plan-kind restoration edge');
	assert.ok(
		report.problems.some(p => p.code === 'edge-illegal' && /restored-from/.test(p.message)),
		'the problem names the restoration edge kind',
	);
});

// ---------------------------------------------------------------------------
// Guard legs (pin the no-regression surface)
// ---------------------------------------------------------------------------

test('DL-82 guard: a restored-from edge on a file-kind ref still resolves to the real file-artifact family', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/work/acme', path: 'src/app.ts', contentSha256: SHA }, AGENT);
	await t.graph.addRef({ kind: 'artifact', id: ARTIFACT, provenance: TOOL });
	await t.graph.addRef({ kind: 'artifact', id: SNAPSHOT, displayName: 'file snapshot', provenance: TOOL });
	await t.graph.addEdge({ kind: 'snapshot-of', from: SNAPSHOT, to: FILE }, TOOL);
	const continuity = new ContinuityService({ graph: t.graph });
	// explicit origin
	const explicit = await continuity.restore(FILE, { provenance: HUMAN, fromRefId: ARTIFACT });
	assert.equal(explicit.plan.family, 'file-artifact');
	if (explicit.plan.family !== 'file-artifact') {
		throw new Error('unreachable');
	}
	assert.deepEqual(explicit.plan.summary, { path: '/work/acme/src/app.ts', contentSha256: SHA });
	assert.equal(explicit.edge.kind, 'restored-from');
	assert.equal(explicit.edge.from, FILE);
	assert.equal(explicit.edge.to, ARTIFACT);
	// default origin: the newest snapshot-of ancestor
	const defaulted = await continuity.restore(FILE, { provenance: HUMAN });
	assert.equal(defaulted.edge.to, SNAPSHOT, 'origin defaulted to the snapshot-of ancestor');
	assert.equal(defaulted.plan.family, 'file-artifact');
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops !== undefined && report.ops.ok, true);
	await t.cleanup();
});

test('DL-82 guard: the typed restore error\'s closed-set message matches the converged set', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.addRef({ kind: 'agent-session', id: AGENT_SESSION, provenance: AGENT });
	await t.graph.addRef({ kind: 'workflow', id: WORKFLOW, provenance: HUMAN });
	const continuity = new ContinuityService({ graph: t.graph });
	for (const refId of [TASK, AGENT_SESSION, WORKFLOW]) {
		await assert.rejects(
			() => continuity.restore(refId, { provenance: AGENT }),
			(err: unknown) => err instanceof ResourceGraphError
				&& err.code === 'FLAUZ_RESOURCES_RESTORE'
				&& /has no v0 restoration family \(restorable: file, directory, artifact, evidence, browser-session, environment\)/.test(err.message),
			`${refId} must fail with the converged closed-set message`,
		);
	}
	await t.cleanup();
});

test('DL-82 guard: the derived-from wildcard and the depends-on/produced/bound-to rows are untouched', () => {
	// derived-from stays any -> any (the wildcard rows are untouched)
	assert.equal(isEdgeLegalForKinds('derived-from', 'task', 'file'), true);
	assert.equal(isEdgeLegalForKinds('derived-from', 'workflow', 'provider'), true);
	// depends-on / produced / bound-to keep their rows exactly
	assert.equal(isEdgeLegalForKinds('depends-on', 'task', 'model'), true);
	assert.equal(isEdgeLegalForKinds('depends-on', 'file', 'model'), false);
	assert.equal(isEdgeLegalForKinds('produced', 'task', 'artifact'), true);
	assert.equal(isEdgeLegalForKinds('produced', 'agent-session', 'evidence'), true);
	assert.equal(isEdgeLegalForKinds('produced', 'model', 'file'), false);
	assert.equal(isEdgeLegalForKinds('bound-to', 'browser-session', 'environment'), true);
	assert.equal(isEdgeLegalForKinds('bound-to', 'artifact', 'task'), false);
	// the plan kinds keep every NON-restoration edge (the plan vocabulary itself is untouched)
	assert.equal(isEdgeLegalForKinds('depends-on', 'workflow', 'file'), true);
	assert.equal(isEdgeLegalForKinds('produced', 'workflow', 'artifact'), true);
});

test('DL-82 guard: the good fixture still loads + verifies clean (graphs never using plan-kind restoration edges are unaffected)', async () => {
	const good = ResourceGraph.parseEnvelope(await readFixture('good', 'graph.json'));
	const report = verifyEnvelope(good);
	assert.equal(report.ok, true);
	assert.deepEqual(report.problems, []);
});
