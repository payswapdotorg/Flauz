/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL3-P2 PARTITION C audit suite — the regression tests for the product-readiness
 * findings (each fails on the untouched base c27de198 and passes after the fix)
 * plus the checklist evidence pins:
 *
 *   C1  identity survives handle invalidation (identity != access surface)
 *   C2  ancestry cycles are rejected at append, at load and by verify
 *   C3  mutations + ledger appends are STRICTLY serial (DL-77); torn tails refuse
 *   C4  plan generation is deterministic; evidence refs have a restoration family
 *   C6  ANY journal mutation is detected (prev-chain + digest chain + head anchor)
 *   C8  restart -> restore -> resume yields a byte-identical resource state
 *   C9  the journal + the environments registry are consumed READ-ONLY
 *   C10 canonical serialization is byte-identical across runs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GRAPH_PATH, OPS_PATH, canonicalJson, type FileSystemPort, type ResourceProvenance } from '../src/api.ts';
import { ResourceGraph, verifyEnvelope, verifyWorkspace } from '../src/graph.ts';
import { ProvenanceLedger, envelopeDigest, opRecordHash, type OpAppendInput } from '../src/provenance.ts';
import { ContinuityService } from '../src/continuity.ts';
import { BrowserSessionBridge, BROWSER_SESSION_JOURNAL_PATH } from '../src/journalBridge.ts';
import { AGENT, HUMAN, bootGraph, fixedClock, steppingClock } from './helpers.ts';

const FILE = 'flauz:file:4d5e6f708192a3b4';
const TASK = 'flauz:task:T-001';
const ENVIRONMENT = 'flauz:environment:env-staging';
const BROWSER = 'flauz:browser:9c8d7e6f5a4b3c2d';
const SNAPSHOT = 'flauz:artifact:1111222233334444';
const EVIDENCE = 'flauz:evidence:abcdef0123456789';
const SHA = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';

/** A port wrapper that records every mutating call (C9 evidence). */
function recordingPort(fsPort: FileSystemPort): FileSystemPort & { writes: string[] } {
	const writes: string[] = [];
	return {
		writes,
		readFileUtf8: p => fsPort.readFileUtf8(p),
		writeFile: async (p, c) => { writes.push(`write:${p}`); await fsPort.writeFile(p, c); },
		appendFile: async (p, c) => { writes.push(`append:${p}`); await fsPort.appendFile(p, c); },
		rename: async (a, b) => { writes.push(`rename:${a}->${b}`); await fsPort.rename(a, b); },
		mkdir: async p => { writes.push(`mkdir:${p}`); await fsPort.mkdir(p); },
	};
}

// ---------------------------------------------------------------------------
// C3 / DL-77 — serialized mutations + serialized ledger appends
// ---------------------------------------------------------------------------

test('REGRESSION (DL-77): concurrent graph mutations serialize — no crash, no lost mutation, chain green', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const results = await Promise.allSettled([
		t.graph.addRef({ kind: 'file', id: 'flauz:file:aaaaaaaaaaaaaaaa', provenance: AGENT }),
		t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN }),
		t.graph.addEdge({ kind: 'depends-on', from: TASK, to: 'flauz:file:aaaaaaaaaaaaaaaa' }, AGENT),
	]);
	for (const [index, result] of results.entries()) {
		assert.equal(result.status, 'fulfilled', `mutation ${index} resolved (serialized, not raced)`);
	}
	assert.equal(t.graph.envelope().nodes.length, 2, 'both refs persisted');
	assert.equal(t.graph.envelope().edges.length, 1, 'the edge persisted');
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops !== undefined && report.ops.ok, true, 'the ops chain stays green after concurrent mutations');
	await t.cleanup();
});

test('REGRESSION (DL-77): concurrent ledger appends serialize — every record lands, seqs stay contiguous', async () => {
	const t = await bootGraph();
	const ledger = new ProvenanceLedger({ root: t.root, fs: t.fs, clock: fixedClock() });
	await ledger.ensure();
	const input = (i: number): OpAppendInput => ({
		op: 'add-ref',
		refId: `flauz:file:${i.toString(16).padStart(16, '0')}`,
		provenance: { actor: 'agent' },
		beforeDigest: `${i}`.padEnd(64, '0'),
		afterDigest: `${i + 1}`.padEnd(64, '0'),
	});
	await Promise.all([ledger.append(input(1)), ledger.append(input(2)), ledger.append(input(3))]);
	const records = await ledger.readAll();
	assert.equal(records.length, 3, 'all three appends landed (no lost update)');
	assert.deepEqual(records.map(r => r.seq), [1, 2, 3], 'seq contiguity under concurrency');
	const report = await ledger.verifyChain();
	assert.equal(report.ok, true, 'the digest chain + prev chain verify');
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C6 — tamper detection of ANY journal mutation
// ---------------------------------------------------------------------------

test('REGRESSION (C6): an in-place metadata edit of a MIDDLE ops record is detected (prev chain)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.addRef({ kind: 'file', id: 'flauz:file:bbbbbbbbbbbbbbbb', provenance: { actor: 'tool' } });
	const opsPath = path.join(t.root, OPS_PATH);
	const text = await fs.readFile(opsPath, 'utf-8');
	const lines = text.split('\n').filter(line => line !== '');
	// flip the SECOND record's op kind (an audit lie) keeping seq + digests intact
	const rec2 = JSON.parse(lines[1]!);
	lines[1] = JSON.stringify({ ...rec2, op: 'remove-ref' });
	await fs.writeFile(opsPath, `${lines.join('\n')}\n`, 'utf-8');
	const ledger = new ProvenanceLedger({ root: t.root, fs: t.fs, clock: fixedClock() });
	const report = await ledger.verifyChain(envelopeDigest(t.graph.envelope()));
	assert.equal(report.ok, false, 'the metadata tamper is a verdict');
	assert.ok(report.problems.some(p => /prev does not match the previous record's line hash/.test(p.message)), 'the prev chain names the tamper');
	await t.cleanup();
});

test('REGRESSION (C6): erasing the whole ops ledger on a non-empty graph is detected', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await fs.writeFile(path.join(t.root, OPS_PATH), '', 'utf-8');
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops !== undefined && report.ops.ok, false, 'empty ledger + non-empty graph = erased history');
	assert.ok((report.ops?.problems ?? []).some(p => /history erased/.test(p.message)));
	await t.cleanup();
});

test('REGRESSION (C10/C3): a torn ops tail (missing trailing newline) is refused, never silently parsed', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	const opsPath = path.join(t.root, OPS_PATH);
	const text = await fs.readFile(opsPath, 'utf-8');
	await fs.writeFile(opsPath, text.slice(0, -1), 'utf-8');
	const ledger = new ProvenanceLedger({ root: t.root, fs: t.fs, clock: fixedClock() });
	await assert.rejects(() => ledger.readAll(), /torn/);
	// and the writer refuses to extend a torn ledger (fail-closed)
	await assert.rejects(() => ledger.append({ op: 'add-ref', refId: FILE, provenance: AGENT, beforeDigest: '0'.repeat(64), afterDigest: '1'.repeat(64) }), /torn/);
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C2 — forbidden ancestry cycles
// ---------------------------------------------------------------------------

test('REGRESSION (C2): mutual snapshot-of / restored-from / derived-from cycles are rejected at append', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const A = 'flauz:artifact:1111111111111111';
	const B = 'flauz:artifact:2222222222222222';
	await t.graph.addRef({ kind: 'artifact', id: A, provenance: TOOL_PROVENANCE() });
	await t.graph.addRef({ kind: 'artifact', id: B, provenance: TOOL_PROVENANCE() });
	await t.graph.addEdge({ kind: 'snapshot-of', from: A, to: B }, TOOL_PROVENANCE());
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'snapshot-of', from: B, to: A }, TOOL_PROVENANCE()),
		/closes a 'snapshot-of' cycle/,
	);
	// the designed restore pattern stays LEGAL: snapshot snapshot-of session + session restored-from snapshot
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addRef({ kind: 'artifact', id: SNAPSHOT, provenance: TOOL_PROVENANCE() });
	await t.graph.addEdge({ kind: 'snapshot-of', from: SNAPSHOT, to: BROWSER }, TOOL_PROVENANCE());
	await t.graph.addEdge({ kind: 'restored-from', from: BROWSER, to: SNAPSHOT }, AGENT);
	// but mutual restored-from is forbidden
	await assert.rejects(
		() => t.graph.addEdge({ kind: 'restored-from', from: SNAPSHOT, to: BROWSER }, AGENT),
		/closes a 'restored-from' cycle/,
	);
	// depends-on carries no ancestry semantics: a mutual depends-on stays representable
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.addRef({ kind: 'task', id: 'flauz:task:T-002', provenance: HUMAN });
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: 'flauz:task:T-002' }, HUMAN);
	await t.graph.addEdge({ kind: 'depends-on', from: 'flauz:task:T-002', to: TASK }, HUMAN);
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok && (report.ops === undefined || report.ops.ok), true);
	await t.cleanup();
});

function TOOL_PROVENANCE(): ResourceProvenance {
	return { actor: 'tool' };
}

test('REGRESSION (C2): a cyclic graph file is rejected at LOAD and flagged by verifyEnvelope', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const A = 'flauz:artifact:1111111111111111';
	const B = 'flauz:artifact:2222222222222222';
	await t.graph.addRef({ kind: 'artifact', id: A, provenance: TOOL_PROVENANCE() });
	await t.graph.addRef({ kind: 'artifact', id: B, provenance: TOOL_PROVENANCE() });
	await t.graph.addEdge({ kind: 'snapshot-of', from: A, to: B }, TOOL_PROVENANCE());
	// bypass the append guard: hand-craft the cyclic document on disk
	const raw = await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8');
	const envelope = JSON.parse(raw);
	const cyclicEdge = JSON.parse(JSON.stringify(envelope.edges[0]));
	cyclicEdge.from = B;
	cyclicEdge.to = A;
	cyclicEdge.createdAt = envelope.edges[0].createdAt + 1;
	envelope.edges.push(cyclicEdge);
	envelope.edges.sort((a: { kind: string; from: string; to: string }, b: { kind: string; from: string; to: string }) => `${a.kind}|${a.from}|${a.to}` < `${b.kind}|${b.from}|${b.to}` ? -1 : 1);
	const cyclicRaw = JSON.stringify(envelope, null, 2) + '\n';
	await fs.writeFile(path.join(t.root, GRAPH_PATH), cyclicRaw, 'utf-8');
	const reload = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	await assert.rejects(() => reload.bootstrap(), /carry a 'snapshot-of' cycle/);
	// verifyEnvelope flags the same defect without throwing
	const report = verifyEnvelope(JSON.parse(cyclicRaw));
	assert.equal(report.ok, false);
	assert.ok(report.problems.some(p => p.code === 'edge-cycle'));
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C4 — complete + deterministic plan generation
// ---------------------------------------------------------------------------

test('REGRESSION (C4): evidence refs (artifact-surface carriers) have a restoration family', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'evidence', id: EVIDENCE, provenance: AGENT });
	await t.graph.addSurface(EVIDENCE, { kind: 'artifact', uri: '.flauz/artifacts/T-001/verdict.json', sha256: SHA }, AGENT);
	const continuity = new ContinuityService({ graph: t.graph });
	const plan = await continuity.planRestoration(EVIDENCE);
	assert.equal(plan.family, 'file-artifact');
	if (plan.family !== 'file-artifact') {
		throw new Error('unreachable');
	}
	assert.deepEqual(plan.summary, { path: '.flauz/artifacts/T-001/verdict.json', contentSha256: SHA });
	await t.cleanup();
});

test('C4/C10: plan generation is deterministic — repeated calls yield deep-equal plans', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'environment', id: ENVIRONMENT, provenance: HUMAN });
	await t.graph.addSurface(ENVIRONMENT, { kind: 'environment', descriptorId: 'env-staging', providerKind: 'container' }, HUMAN);
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: 'a.ts', contentSha256: SHA }, AGENT);
	await fs.writeFile(path.join(t.root, '.flauz', 'environments.json'), JSON.stringify({
		$schema: 'flauz.environments/v0', activeId: 'env-staging',
		environments: [{ id: 'env-staging', enabled: true }],
	}), 'utf-8');
	const continuity = new ContinuityService({ graph: t.graph });
	for (const refId of [ENVIRONMENT, FILE]) {
		const first = await continuity.planRestoration(refId);
		const second = await continuity.planRestoration(refId);
		assert.deepEqual(first, second, `${refId} plans are deterministic`);
	}
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C1 — identity survives handle invalidation
// ---------------------------------------------------------------------------

test('C1: identity survives handle invalidation — the access surface moves, the ref does not', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const created = await t.graph.addRef({ kind: 'browser-session', id: BROWSER, displayName: 'login flow', provenance: AGENT });
	await t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/aaa', partition: 'persist:flauz-0123456789abcdef', tabIds: ['flauz:tab:0000000000000001'] }, AGENT);
	// the handle DIES (endpoint swap + tab churn): the surface re-versions, identity is untouched
	await t.graph.addSurface(BROWSER, { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9333/devtools/browser/bbb', partition: 'persist:flauz-0123456789abcdef' }, HUMAN);
	const after = t.graph.get(BROWSER);
	assert.equal(after?.id, created.id);
	assert.equal(after?.createdAt, created.createdAt, 'createdAt is immutable across surface churn');
	assert.deepEqual(after?.provenance, created.provenance, 'mint provenance is immutable');
	const record = t.graph.surfaceRecord(BROWSER, 'browser');
	assert.equal(record?.versions.length, 2, 'the dead handle is retained as a prior version');
	const current = record?.versions[record.versions.length - 1];
	assert.equal(current?.surface.kind, 'browser');
	if (current?.surface.kind === 'browser') {
		assert.equal(current.surface.cdpEndpoint, 'ws://127.0.0.1:9333/devtools/browser/bbb');
	}
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok && (report.ops === undefined || report.ops.ok), true);
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C8 — restart -> restore -> resume yields a byte-identical resource state
// ---------------------------------------------------------------------------

test('C8: restart -> restore -> resume — a second graph instance yields the byte-identical state', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'browser-session', id: BROWSER, provenance: AGENT });
	await t.graph.addSurface(BROWSER, { kind: 'browser', partition: 'persist:flauz-1' }, AGENT);
	await t.graph.addRef({ kind: 'artifact', id: SNAPSHOT, provenance: TOOL_PROVENANCE() });
	await t.graph.addEdge({ kind: 'snapshot-of', from: SNAPSHOT, to: BROWSER }, TOOL_PROVENANCE());
	const continuity = new ContinuityService({ graph: t.graph });
	await continuity.restore(BROWSER, { provenance: AGENT });
	const envelopeBefore = await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8');
	const opsBefore = await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8');
	// RESTART: a fresh instance over the same workspace (no shared state)
	const resumed = new ResourceGraph({ root: t.root, fs: t.fs, clock: fixedClock() });
	await resumed.bootstrap();
	assert.deepEqual(resumed.envelope(), t.graph.envelope(), 'the resumed state is semantically identical');
	assert.equal(await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8'), envelopeBefore, 'the envelope bytes are untouched by the restart');
	assert.equal(await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8'), opsBefore, 'the journal bytes are untouched by the restart');
	assert.deepEqual(await resumed.ops(), await t.graph.ops());
	// the restore() flow is resumable: the restored-from edge is visible + lineage works
	assert.equal(resumed.neighbors(BROWSER, 'restored-from').length, 1);
	assert.deepEqual(resumed.lineage(BROWSER).map(r => r.id), [BROWSER, SNAPSHOT]);
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok && (report.ops === undefined || report.ops.ok), true);
	await t.cleanup();
});

test('C8/C4: journal-sync is idempotent — re-running the sync leaves the state byte-identical', async () => {
	const record = { schemaVersion: 0, schema: 'flauz.browser-session-journal/v0', ts: 1, actor: 'agent', event: 'opened', descriptor: { schemaVersion: 0, sessionId: BROWSER, initiator: 'agent', partition: 'persist:flauz-1', policySourceRef: 'flauz:policy:main', createdAt: '2026-01-01T00:00:00.000Z', state: 'active', tabs: [] } };
	const journal = `${canonicalJson(record)}\n`;
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { '.flauz/browser-sessions.jsonl': journal } });
	const bridge = new BrowserSessionBridge({ graph: t.graph });
	const first = await bridge.sync({ provenance: { actor: 'agent' } });
	assert.equal(first.refsMinted.length, 1);
	const envelopeAfterFirst = await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8');
	const opsAfterFirst = await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8');
	// RESUME: re-run the sync on the same journal — a no-op, byte-identical
	const second = await bridge.sync({ provenance: { actor: 'agent' } });
	assert.deepEqual(second.refsMinted, []);
	assert.deepEqual(second.surfacesRefreshed, []);
	assert.equal(await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8'), envelopeAfterFirst);
	assert.equal(await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8'), opsAfterFirst, 'idempotent syncs append no ops');
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C9 — read-only consumption of the sibling journals/registries
// ---------------------------------------------------------------------------

test('C9: sync + planRestoration NEVER write the browser-session journal or the environments registry', async () => {
	const record = { schemaVersion: 0, schema: 'flauz.browser-session-journal/v0', ts: 1, actor: 'agent', event: 'opened', descriptor: { schemaVersion: 0, sessionId: BROWSER, initiator: 'agent', partition: 'persist:flauz-1', policySourceRef: 'flauz:policy:main', createdAt: '2026-01-01T00:00:00.000Z', state: 'active', tabs: [] } };
	const journal = `${canonicalJson(record)}\n`;
	const registry = JSON.stringify({ $schema: 'flauz.environments/v0', activeId: null, environments: [{ id: 'env-staging', enabled: true }] }, null, 2) + '\n';
	const t = await bootGraph({ clock: steppingClock(), seedFiles: { '.flauz/browser-sessions.jsonl': journal, '.flauz/environments.json': registry } });
	const recorder = recordingPort(t.fs);
	const recorded = new ResourceGraph({ root: t.root, fs: recorder, clock: steppingClock() });
	await recorded.bootstrap();
	const bridge = new BrowserSessionBridge({ graph: recorded });
	await bridge.sync({ provenance: { actor: 'agent' } });
	await recorded.addRef({ kind: 'environment', id: ENVIRONMENT, provenance: HUMAN });
	await recorded.addSurface(ENVIRONMENT, { kind: 'environment', descriptorId: 'env-staging', providerKind: 'container' }, HUMAN);
	const continuity = new ContinuityService({ graph: recorded });
	await continuity.planRestoration(ENVIRONMENT);
	const journalPath = path.join(t.root, BROWSER_SESSION_JOURNAL_PATH);
	const registryPath = path.join(t.root, '.flauz', 'environments.json');
	const mutating = recorder.writes.filter(entry => !entry.startsWith('rename:') || !entry.includes('.tmp'));
	assert.ok(mutating.every(entry => entry !== `write:${journalPath}` && entry !== `append:${journalPath}`), 'the journal is never written');
	assert.ok(mutating.every(entry => entry !== `write:${registryPath}` && entry !== `append:${registryPath}` && !entry.startsWith(`rename:${registryPath}`)), 'the registry is never written');
	assert.equal(await fs.readFile(journalPath, 'utf-8'), journal, 'journal bytes untouched');
	assert.equal(await fs.readFile(registryPath, 'utf-8'), registry, 'registry bytes untouched');
	await t.cleanup();
});

// ---------------------------------------------------------------------------
// C10 — byte-identical canonical serialization across runs
// ---------------------------------------------------------------------------

test('C10: serialization is byte-identical across runs (envelope + ops lines + digests)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, displayName: 'app.ts', provenance: AGENT });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: 'src/app.ts', contentSha256: SHA }, AGENT);
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, HUMAN);
	const raw1 = await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8');
	const ops1 = await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8');
	// RUN 2: replay the identical mutation sequence in a fresh workspace
	const t2 = await bootGraph({ clock: steppingClock() });
	await t2.graph.addRef({ kind: 'file', id: FILE, displayName: 'app.ts', provenance: AGENT });
	await t2.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: 'src/app.ts', contentSha256: SHA }, AGENT);
	await t2.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t2.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, HUMAN);
	const raw2 = await fs.readFile(path.join(t2.root, GRAPH_PATH), 'utf-8');
	const ops2 = await fs.readFile(path.join(t2.root, OPS_PATH), 'utf-8');
	assert.equal(raw1, raw2, 'the envelope serializes to identical bytes');
	assert.equal(ops1, ops2, 'the ops journal serializes to identical bytes (canonical JSONL, one trailing newline per record)');
	assert.ok(ops1.endsWith('\n') && !ops1.endsWith('\n\n'), 'exactly one trailing newline');
	// op record hashes are stable across runs
	const records1 = await t.graph.ops();
	const records2 = await t2.graph.ops();
	assert.deepEqual(records1.map(opRecordHash), records2.map(opRecordHash));
	await t.cleanup();
	await t2.cleanup();
});

// ---------------------------------------------------------------------------
// C5 — export surfaces can never carry secrets (schema-level rejection pin)
// ---------------------------------------------------------------------------

test('C5 pin: secret-shaped values can never enter the exported envelope (schema rejection)', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	const secretShaped = ['ghp_', 'Flauz', 'Audit', 'Canary', '0000', '1111', '2222', '3333'].join('');
	await assert.rejects(() => t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: secretShaped }, AGENT), /secret-shaped literal rejected/);
	await assert.rejects(() => t.graph.updateRef(FILE, { displayName: secretShaped }, HUMAN), /secret-shaped literal rejected/);
	await assert.rejects(() => t.graph.addRef({ kind: 'file', id: 'flauz:file:cccccccccccccccc', displayName: secretShaped, provenance: AGENT }), /secret-shaped literal rejected/);
	// therefore no export surface (envelope JSON, DOT, ops) can ever contain it
	const raw = await fs.readFile(path.join(t.root, GRAPH_PATH), 'utf-8');
	const ops = await fs.readFile(path.join(t.root, OPS_PATH), 'utf-8');
	assert.ok(!raw.includes(secretShaped) && !ops.includes(secretShaped), 'the canary never reached any persisted export surface');
	await t.cleanup();
});
