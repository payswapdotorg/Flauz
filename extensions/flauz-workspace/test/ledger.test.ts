/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — test/ledger.test.ts
 *
 *  Hash-chain integrity: canonical stored lines, sha256 cross-check against
 *  node:crypto, chain verification over a clean chain, tamper detection across five
 *  tamper classes (payload mutation x2, row deletion, forged append, broken genesis
 *  link), and input validation.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { FIXED_TS, bootWorkspace, type TestWorkspace } from './helpers.ts';
import { canonicalJson, sha256Hex, type LedgerRow } from '../src/api.ts';
import { rowHash, rowLine } from '../src/ledger.ts';

const HEX64 = 'a'.repeat(64);

function ledgerFile(ws: TestWorkspace): string {
	return path.join(ws.root, '.flauz', 'evidence', 'ledger.jsonl');
}

async function readLines(ws: TestWorkspace): Promise<string[]> {
	const text = await fs.readFile(ledgerFile(ws), { encoding: 'utf-8' });
	return text.split('\n').filter(line => line !== '');
}

async function writeLines(ws: TestWorkspace, lines: readonly string[]): Promise<void> {
	await fs.writeFile(ledgerFile(ws), lines.map(line => `${line}\n`).join(''), { encoding: 'utf-8' });
}

function parseLine(line: string): LedgerRow {
	return JSON.parse(line) as LedgerRow;
}

test('first append mints seq 1 with prev=null and stores a single line', async () => {
	const ws = await bootWorkspace();
	const appended = await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 });
	assert.equal(appended.seq, 1);
	assert.equal(appended.evidenceId, 'E-000001');
	assert.equal(appended.row.prev, null);
	const text = await fs.readFile(ledgerFile(ws), { encoding: 'utf-8' });
	assert.equal(text, `${rowLine(appended.row)}\n`);
});

test('second append chains prev to the sha256 of the first stored line', async () => {
	const ws = await bootWorkspace();
	const first = await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/1', sha256: HEX64 });
	const second = await ws.ledger.append('T-001', { kind: 'changeset', uri: 'file:///w/a.ts', sha256: 'b'.repeat(64) });
	assert.equal(second.seq, 2);
	assert.equal(second.evidenceId, 'E-000002');
	assert.equal(second.row.prev, rowHash(first.row));
	const lines = await readLines(ws);
	assert.equal(lines.length, 2);
});

test('stored line is canonical JSON: sorted keys, no whitespace', async () => {
	const ws = await bootWorkspace();
	const appended = await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 });
	const lines = await readLines(ws);
	assert.equal(lines[0], `{"kind":"note","prev":null,"seq":1,"sha256":"${HEX64}","taskId":"T-001","ts":${FIXED_TS},"uri":"flauz://e/x"}`);
	assert.equal(lines[0], canonicalJson(appended.row));
});

test('rowHash equals node:crypto sha256 over the stored line bytes (incl. unicode)', async () => {
	const ws = await bootWorkspace();
	const appended = await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/ünïcødé-✓', sha256: HEX64 });
	const line = rowLine(appended.row);
	assert.equal(rowHash(appended.row), crypto.createHash('sha256').update(line, 'utf8').digest('hex'));
	assert.equal(sha256Hex('flauz ✓ payload'), crypto.createHash('sha256').update('flauz ✓ payload', 'utf8').digest('hex'));
});

test('verify reports ok over a clean 5-row chain with mixed kinds', async () => {
	const ws = await bootWorkspace();
	await ws.tasks.createTask('t');
	for (const [kind, uri] of [['changeset', 'file:///w/a.ts'], ['screenshot', 'file:///w/s.png'], ['command-output', 'file:///w/out.txt'], ['note', 'flauz://e/n'], ['changeset', 'file:///w/b.ts']] as const) {
		await ws.ledger.append('T-001', { kind, uri, sha256: HEX64 });
	}
	const result = await ws.ledger.verify();
	assert.deepEqual(result, { ok: true, rows: 5 });
});

test('tamper class 1: mutated uri is detected with firstBadSeq at the mutated row', async () => {
	const ws = await bootWorkspace();
	for (let i = 1; i <= 3; i++) {
		await ws.ledger.append('T-001', { kind: 'note', uri: `flauz://e/${i}`, sha256: HEX64 });
	}
	const lines = await readLines(ws);
	const row = parseLine(lines[1] as string);
	row.uri = 'flauz://e/tampered';
	lines[1] = canonicalJson(row);
	await writeLines(ws, lines);
	const result = await ws.ledger.verify();
	assert.equal(result.ok, false);
	assert.equal(result.firstBadSeq, 3);
});

test('tamper class 2: mutated sha256 field is detected', async () => {
	const ws = await bootWorkspace();
	for (let i = 1; i <= 3; i++) {
		await ws.ledger.append('T-001', { kind: 'note', uri: `flauz://e/${i}`, sha256: HEX64 });
	}
	const lines = await readLines(ws);
	const row = parseLine(lines[0] as string);
	row.sha256 = 'c'.repeat(64);
	lines[0] = canonicalJson(row);
	await writeLines(ws, lines);
	const result = await ws.ledger.verify();
	assert.equal(result.ok, false);
	assert.equal(result.firstBadSeq, 2);
});

test('tamper class 3: deleted middle row is detected (seq contiguity break)', async () => {
	const ws = await bootWorkspace();
	for (let i = 1; i <= 4; i++) {
		await ws.ledger.append('T-001', { kind: 'note', uri: `flauz://e/${i}`, sha256: HEX64 });
	}
	const lines = await readLines(ws);
	lines.splice(1, 1);
	await writeLines(ws, lines);
	const result = await ws.ledger.verify();
	assert.equal(result.ok, false);
	assert.equal(result.firstBadSeq, 3);
});

test('tamper class 4: forged appended row with wrong prev is detected at its seq', async () => {
	const ws = await bootWorkspace();
	for (let i = 1; i <= 3; i++) {
		await ws.ledger.append('T-001', { kind: 'note', uri: `flauz://e/${i}`, sha256: HEX64 });
	}
	const forged: LedgerRow = { seq: 4, ts: FIXED_TS, taskId: 'T-001', kind: 'note', uri: 'flauz://e/forged', sha256: 'd'.repeat(64), prev: 'e'.repeat(64) };
	await fs.appendFile(ledgerFile(ws), `${canonicalJson(forged)}\n`, { encoding: 'utf-8' });
	const result = await ws.ledger.verify();
	assert.equal(result.ok, false);
	assert.equal(result.firstBadSeq, 4);
});

test('tamper class 5: genesis row with non-null prev is detected at seq 1', async () => {
	const ws = await bootWorkspace();
	await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/1', sha256: HEX64 });
	const lines = await readLines(ws);
	const row = parseLine(lines[0] as string);
	row.prev = 'f'.repeat(64);
	lines[0] = canonicalJson(row);
	await writeLines(ws, lines);
	const result = await ws.ledger.verify();
	assert.equal(result.ok, false);
	assert.equal(result.firstBadSeq, 1);
});

test('empty ledger (fresh workspace) verifies ok with zero rows', async () => {
	const ws = await bootWorkspace();
	assert.deepEqual(await ws.ledger.verify(), { ok: true, rows: 0 });
});

test('append rejects an unknown evidence kind', async () => {
	const ws = await bootWorkspace();
	await assert.rejects(
		ws.ledger.append('T-001', { kind: 'bogus', uri: 'flauz://e/x', sha256: HEX64 }),
		/kind must be one of changeset\|screenshot\|command-output\|note/,
	);
});

test('append rejects a malformed sha256 (not 64 lowercase hex)', async () => {
	const ws = await bootWorkspace();
	await assert.rejects(
		ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/x', sha256: 'XYZ' }),
		/sha256 must be 64 lowercase hex chars/,
	);
});

test('append rejects an empty taskId and an empty uri', async () => {
	const ws = await bootWorkspace();
	await assert.rejects(
		ws.ledger.append('', { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 }),
		/non-empty taskId/,
	);
	await assert.rejects(
		ws.ledger.append('T-001', { kind: 'note', uri: '', sha256: HEX64 }),
		/uri must be a non-empty string/,
	);
});
