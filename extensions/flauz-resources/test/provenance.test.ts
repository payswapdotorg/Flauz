/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Provenance suite: every mutation appends exactly one ops record; the actor
 * is MANDATORY (fail-closed); before/after digests match the persisted state;
 * the digest chain detects truncation + tampering.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GRAPH_PATH, OPS_PATH, type ResourceProvenance } from '../src/api.ts';
import { verifyWorkspace } from '../src/graph.ts';
import { ProvenanceLedger, envelopeDigest, opLine, opRecordHash, parseOpRecord, type OpAppendInput, type ResourceOpRecord } from '../src/provenance.ts';
import { AGENT, HUMAN, TOOL, bootGraph, fixedClock, runtimeSecretFixture, steppingClock } from './helpers.ts';

const FILE = 'flauz:file:4d5e6f708192a3b4';
const TASK = 'flauz:task:T-001';

test('every graph mutation appends exactly one ops record, in order, with the right op kind', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	await t.graph.updateRef(FILE, { displayName: 'renamed' }, TOOL);
	await t.graph.addEdge({ kind: 'depends-on', from: TASK, to: FILE }, AGENT);
	await t.graph.removeEdge('depends-on', TASK, FILE, HUMAN);
	await t.graph.removeRef(FILE, HUMAN);
	const ops = await t.graph.ops();
	assert.deepEqual(ops.map(record => record.op), ['add-ref', 'add-ref', 'update-ref', 'add-edge', 'remove-edge', 'remove-ref']);
	assert.deepEqual(ops.map(record => record.seq), [1, 2, 3, 4, 5, 6]);
	// the agent-vs-human(-vs-tool) distinction rides on every record
	assert.deepEqual(ops.map(record => record.actor), ['agent', 'human', 'tool', 'agent', 'human', 'human']);
	// refId is the primary ref of each mutation
	assert.deepEqual(ops.map(record => record.refId), [FILE, TASK, FILE, TASK, TASK, FILE]);
	await t.cleanup();
});

test('addSurface appends ops with prior-version notes; actorId/session/task context rides along', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: 'a.ts' }, { actor: 'agent', actorId: 'flauz-agent', taskId: 'T-001' });
	await t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: 'b.ts' }, HUMAN);
	const ops = await t.graph.ops();
	assert.deepEqual(ops.map(record => record.op), ['add-ref', 'add-surface', 'add-surface']);
	assert.match(ops[1]?.note ?? '', /surface file-system bound/);
	assert.match(ops[2]?.note ?? '', /re-versioned \(prior retained\)/);
	assert.equal(ops[1]?.actorId, 'flauz-agent');
	assert.equal(ops[1]?.taskId, 'T-001');
	assert.equal(ops[2]?.actor, 'human');
	await t.cleanup();
});

test('before/after digests are the sha256 of the canonical envelope states', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	const emptyDigest = envelopeDigest(t.graph.envelope());
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	const afterFirst = envelopeDigest(t.graph.envelope());
	const ops = await t.graph.ops();
	const first = ops[0] as ResourceOpRecord;
	assert.equal(first.beforeDigest, emptyDigest);
	assert.equal(first.afterDigest, afterFirst);
	assert.match(first.beforeDigest, /^[0-9a-f]{64}$/);
	// envelope() clones through canonical JSON, so JSON.stringify(envelope())
	// is already canonical -- the digest is reproducible from the public shape
	assert.equal(first.afterDigest, envelopeDigest(JSON.parse(JSON.stringify(t.graph.envelope()))));
	await t.cleanup();
});

test('a missing actor is a schema rejection in the ops parser (fail-closed provenance)', () => {
	const base = {
		ts: 1730000000000, op: 'add-ref', refId: FILE, prev: null as string | null,
		beforeDigest: '0'.repeat(64), afterDigest: '1'.repeat(64),
	};
	assert.throws(() => parseOpRecord(base, 'x'), /actor is MISSING.*MANDATORY/);
	assert.throws(() => parseOpRecord({ ...base, seq: 1, actor: 'system' }, 'x'), /actor must be one of agent\|human\|tool.*mandatory/);
	assert.throws(() => parseOpRecord({ ...base, seq: 1, actor: 'agent', bogus: 1 }, 'x'), /unknown key/);
	assert.throws(() => parseOpRecord({ ...base, seq: 0, actor: 'agent' }, 'x'), /seq must be a positive integer/);
	assert.throws(() => parseOpRecord({ ...base, seq: 1, actor: 'agent', beforeDigest: 'xyz' }, 'x'), /beforeDigest/);
	assert.throws(() => parseOpRecord({ ...base, seq: 1, actor: 'agent', ts: 0 }, 'x'), /ts must be a positive integer/);
	assert.throws(() => parseOpRecord({ ...base, seq: 1, actor: 'agent', prev: 'not-hex' }, 'x'), /prev must be null/);
	assert.equal(parseOpRecord({ ...base, seq: 1, actor: 'human' }, 'x').actor, 'human');
});

test('opLine is canonical JSON (sorted keys, compact) and carries the prev chain link', () => {
	const genesis: ResourceOpRecord = {
		seq: 1, ts: 5, op: 'add-ref', refId: FILE, actor: 'agent',
		beforeDigest: '0'.repeat(64), afterDigest: '1'.repeat(64), prev: null,
	};
	const line = opLine(genesis);
	assert.ok(line.startsWith('{"actor":"agent",'), 'keys sorted: actor first');
	assert.equal(line, `{"actor":"agent","afterDigest":"${'1'.repeat(64)}","beforeDigest":"${'0'.repeat(64)}","op":"add-ref","prev":null,"refId":"${FILE}","seq":1,"ts":5}`);
	// the chain link value is the sha256 of the canonical line (including its own prev)
	assert.equal(opRecordHash(genesis), opRecordHash(JSON.parse(opLine(genesis)) as ResourceOpRecord));
	const chained: ResourceOpRecord = { ...genesis, seq: 2, prev: opRecordHash(genesis) };
	assert.equal(opLine(chained).includes(`"prev":"${opRecordHash(genesis)}"`), true, 'the successor carries the predecessor line hash');
});

test('the ledger writer refuses to append a record with an invalid actor (nothing is written)', async () => {
	const t = await bootGraph();
	const ledger = new ProvenanceLedger({ root: t.root, fs: t.fs, clock: fixedClock() });
	await ledger.ensure();
	const bad: OpAppendInput = {
		op: 'add-ref',
		refId: FILE,
		provenance: { actor: 'system' } as unknown as ResourceProvenance,
		beforeDigest: '0'.repeat(64),
		afterDigest: '1'.repeat(64),
	};
	await assert.rejects(() => ledger.append(bad), /actor must be one of/);
	assert.deepEqual(await ledger.readAll(), []);
	await t.cleanup();
});

test('the digest chain detects a truncated tail and a tampered digest', async () => {
	const t = await bootGraph({ clock: steppingClock() });
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await t.graph.addRef({ kind: 'task', id: TASK, provenance: HUMAN });
	const opsPath = path.join(t.root, OPS_PATH);
	const text = await fs.readFile(opsPath, 'utf-8');
	const ledger = new ProvenanceLedger({ root: t.root, fs: t.fs, clock: fixedClock() });
	const head = envelopeDigest(t.graph.envelope());

	// (a) truncated tail: the final afterDigest no longer covers the envelope
	const lines = text.split('\n').filter(line => line !== '');
	await fs.writeFile(opsPath, `${lines[0]}\n`, 'utf-8');
	let report = await ledger.verifyChain(head);
	assert.equal(report.ok, false);
	assert.match(report.problems[0]?.message ?? '', /final afterDigest does not match the persisted envelope digest/);

	// (b) tampered digest: record 2's beforeDigest no longer chains to record 1
	await fs.writeFile(opsPath, text.replace(`"beforeDigest":"${(JSON.parse(lines[1] ?? '{}') as ResourceOpRecord).beforeDigest}"`, `"beforeDigest":"${'f'.repeat(64)}"`), 'utf-8');
	report = await ledger.verifyChain(head);
	assert.equal(report.ok, false);
	assert.match(report.problems[0]?.message ?? '', /does not match the previous record's afterDigest/);

	// (c) pristine: green
	await fs.writeFile(opsPath, text, 'utf-8');
	report = await ledger.verifyChain(head);
	assert.equal(report.ok, true);
	assert.equal(report.records, 2);
	await t.cleanup();
});

test('verifyWorkspace: ops absent on a seeded fixture workspace is a note, not a failure', async () => {
	const t = await bootGraph();
	const seedEnvelope = JSON.stringify({ $schema: 'flauz.resources/v0', nodes: [], edges: [], surfaces: [] }, null, 2) + '\n';
	await fs.writeFile(path.join(t.root, GRAPH_PATH), seedEnvelope, 'utf-8');
	await fs.rm(path.join(t.root, OPS_PATH), { force: true });
	const report = await verifyWorkspace(t.root, t.fs);
	assert.equal(report.envelope.ok, true);
	assert.equal(report.ops, undefined);
	assert.match(report.opsNote ?? '', /no ops ledger present/);
	await t.cleanup();
});

test('ops never carry credentials: the graph rejects a secret-shaped surface before any op exists', async () => {
	const t = await bootGraph();
	await t.graph.addRef({ kind: 'file', id: FILE, provenance: AGENT });
	await assert.rejects(
		() => t.graph.addSurface(FILE, { kind: 'file-system', root: '/w', path: runtimeSecretFixture('api-key') }, AGENT),
		/secret-shaped literal rejected/,
	);
	assert.equal((await t.graph.ops()).length, 1, 'only the add-ref op was recorded');
	await t.cleanup();
});
