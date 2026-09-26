/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Ledger-hardening suite (Wave 4, Lane K, M2) - the DL-20 Wave-4 hook:
 * signed checkpoints + size watermark + the extended verifyLedger.
 *
 * Covers: fixture keystore determinism; Ed25519 + HMAC sign/verify; the
 * hardened append flow (interval checkpoints, watermark refresh); tamper
 * classes 6 (watermark mismatch / truncated tail - closes the v0 last-row
 * limitation) and 7 (forged checkpoint / keyId mismatch / bad binding /
 * no-signer); the fixture files under test/fixtures/workflow/{keys,ledger};
 * cross-implementation parity with flauz-agent/core/contracts.mjs (the DL-21
 * seam); and the never-break pin: an unhardened ledger verifies with the
 * EXACT v0 result shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CheckpointSigner, FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { sha256Hex } from '../../flauz-workspace/src/api.ts';
import { EvidenceLedger, rowHash } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService } from '../src/envelope.ts';
import { createEd25519Signer, createFixtureSigner, createHmacSha256Signer, ed25519Supported, generateFixtureKeystore, loadCheckpointSigner } from '../src/keys.ts';
import { bootWorkflowWorkspace, goldenRun, steppingClock } from './helpers.ts';
import { rowHash as contractsRowHash, validateLedgerRows as contractsValidate } from '../../flauz-agent/core/contracts.mjs';

const FIXTURES = new URL('../../../test/fixtures/workflow/', import.meta.url).pathname;

function nodeFsPort(): FileSystemPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => fs.rename(from, to),
		mkdir: target => fs.mkdir(target, { recursive: true }),
	};
}

async function tempRoot(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'flauz-hardening-'));
}

async function readLedger(root: string): Promise<string> {
	return fs.readFile(path.join(root, '.flauz/evidence/ledger.jsonl'), { encoding: 'utf-8' });
}

async function writeLedger(root: string, text: string): Promise<void> {
	await fs.writeFile(path.join(root, '.flauz/evidence/ledger.jsonl'), text, { encoding: 'utf-8' });
}

interface HardenedBoot {
	readonly root: string;
	readonly ledger: EvidenceLedger;
	readonly signer: CheckpointSigner;
}

/** Boots a HARDENED ledger in a temp workspace (interval 4 by default). */
async function bootHardened(interval = 4, prefer: 'ed25519' | 'hmac-sha256' = 'ed25519'): Promise<HardenedBoot> {
	const root = await tempRoot();
	const signer = createFixtureSigner(prefer);
	const ledger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(1_740_000_000_000), signer, checkpointInterval: interval });
	await ledger.ensure();
	return { root, ledger, signer };
}

async function appendNote(ledger: EvidenceLedger, n: number): Promise<void> {
	await ledger.append('T-001', { kind: 'note', uri: `flauz://e/${String(n)}`, sha256: sha256Hex(`note-${String(n)}`), note: `row ${String(n)}` });
}

interface StoredRow {
	readonly seq: number;
	readonly kind: string;
	readonly checkpoint?: { readonly rowSeq: number };
}

function parseRows(text: string): StoredRow[] {
	return text.trimEnd().split('\n').map(line => JSON.parse(line) as StoredRow);
}

// ---------------------------------------------------------------------------
// Fixture keystore + signers
// ---------------------------------------------------------------------------

test('this runtime supports Ed25519 (preferred checkpoint posture available)', () => {
	assert.ok(ed25519Supported(), 'node:crypto Ed25519 expected on Node >= 20 with a full OpenSSL');
});

test('fixture keystore is deterministic: in-memory generation equals the committed files byte-for-byte', async () => {
	const keystore = generateFixtureKeystore();
	for (const [name, expected] of keystore.files) {
		const committed = await fs.readFile(path.join(FIXTURES, 'keys', name), { encoding: 'utf-8' });
		assert.equal(committed, expected, `fixture key file ${name} drifted from the seed-derived generation`);
	}
});

test('ed25519 signer: sign/verify roundtrip over signedPayload(rowSeq, headSha256)', async () => {
	const keystore = generateFixtureKeystore();
	const signer = createEd25519Signer('k-test', keystore.files.get('ed25519-private.pem') ?? '', keystore.files.get('ed25519-public.pem') ?? '');
	const signature = await signer.sign(4, 'a'.repeat(64));
	assert.match(signature, /^[0-9a-f]{128}$/);
	assert.equal(await signer.verify(4, 'a'.repeat(64), signature), true);
	assert.equal(await signer.verify(5, 'a'.repeat(64), signature), false, 'different rowSeq must not verify');
	assert.equal(await signer.verify(4, 'b'.repeat(64), signature), false, 'different head must not verify');
	assert.equal(await signer.verify(4, 'a'.repeat(64), '0'.repeat(128)), false, 'forged signature must not verify');
});

test('hmac-sha256 signer: roundtrip (documented downgrade posture - symmetric key))', async () => {
	const signer = createHmacSha256Signer('k-hmac', sha256Hex('any-secret'));
	const signature = await signer.sign(2, 'c'.repeat(64));
	assert.match(signature, /^[0-9a-f]{64}$/);
	assert.equal(await signer.verify(2, 'c'.repeat(64), signature), true);
	assert.equal(await signer.verify(2, 'c'.repeat(64), 'f'.repeat(64)), false);
});

test('loadCheckpointSigner: ed25519 from manifest; undefined without manifest; hmac fallback on demand', async () => {
	const read = async (target: string): Promise<string | undefined> => {
		try {
			return await fs.readFile(target, { encoding: 'utf-8' });
		} catch {
			return undefined;
		}
	};
	const signer = await loadCheckpointSigner(path.join(FIXTURES, 'keys'), read, (...parts: string[]) => path.join(...parts));
	assert.ok(signer, 'manifest present -> signer');
	assert.equal(signer.algorithm, 'ed25519');
	assert.equal(signer.keyId, 'flauz-fixture-ed25519-1');
	const absent = await loadCheckpointSigner(path.join(FIXTURES, 'no-such-keystore'), read, (...parts: string[]) => path.join(...parts));
	assert.equal(absent, undefined, 'no manifest -> unhardened posture');
	const hmac = createFixtureSigner('hmac-sha256');
	assert.equal(hmac.algorithm, 'hmac-sha256');
	assert.equal(await hmac.verify(1, 'd'.repeat(64), await hmac.sign(1, 'd'.repeat(64))), true);
});

// ---------------------------------------------------------------------------
// Hardened append flow
// ---------------------------------------------------------------------------

test('hardened append flow: interval checkpoints minted into the chain + watermark after every append', async () => {
	const { root, ledger } = await bootHardened(4);
	for (let i = 1; i <= 5; i++) {
		await appendNote(ledger, i);
	}
	const rows = parseRows(await readLedger(root));
	assert.equal(rows.length, 6, 'rows 1-4 + checkpoint row 5 + row 6');
	assert.equal((rows[4] as { kind: string }).kind, 'checkpoint');
	assert.equal((rows[4] as { checkpoint: { rowSeq: number } }).checkpoint.rowSeq, 4, 'checkpoint covers row 4');
	const sizeText = await fs.readFile(path.join(root, '.flauz/evidence/size.json'), { encoding: 'utf-8' });
	const size = JSON.parse(sizeText) as { $schema: string; rowCount: number; headSha256: string; lastCheckpointSeq: number | null };
	assert.equal(size.$schema, 'flauz.evidence.size/v1');
	assert.equal(size.rowCount, 6);
	assert.equal(size.lastCheckpointSeq, 5);
	const lastLine = (await readLedger(root)).trimEnd().split('\n').pop() as string;
	assert.equal(size.headSha256, rowHash(JSON.parse(lastLine) as Parameters<typeof rowHash>[0]), 'watermark head = rowHash of the final row');
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, true);
	assert.equal(verdict.rows, 6);
	assert.equal(verdict.checkpoints?.count, 1);
	assert.equal(verdict.checkpoints?.verified, 1);
	assert.equal(verdict.watermark?.status, 'ok');
});

test('append() refuses to mint checkpoint rows through the public append API', async () => {
	const { ledger } = await bootHardened();
	await assert.rejects(
		ledger.append('T-001', { kind: 'checkpoint', uri: 'flauz://x', sha256: sha256Hex('x') }),
		/cannot mint 'checkpoint' rows/,
	);
});

test('appendCheckpoint(): requires a signer, refuses an empty ledger, idempotent on a trailing checkpoint', async () => {
	const plainRoot = await tempRoot();
	const plain = new EvidenceLedger({ root: plainRoot, fs: nodeFsPort(), clock: steppingClock(1000) });
	await plain.ensure();
	await assert.rejects(plain.appendCheckpoint(), /require a CheckpointSigner/);
	await appendNote(plain, 1);
	await assert.rejects(plain.appendCheckpoint(), /require a CheckpointSigner/);

	const { ledger } = await bootHardened(0);
	await assert.rejects(ledger.appendCheckpoint(), /nothing to checkpoint/);
	await appendNote(ledger, 1);
	const first = await ledger.appendCheckpoint();
	assert.equal(first.row.kind, 'checkpoint');
	const second = await ledger.appendCheckpoint();
	assert.equal(second.seq, first.seq, 'trailing checkpoint -> idempotent no-op');
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, true, 'double appendCheckpoint does not create double coverage');
});

// ---------------------------------------------------------------------------
// Tamper class 7: signed checkpoints
// ---------------------------------------------------------------------------

test('tamper class 7 (forged checkpoint): flipped signature hex is a verdict', async () => {
	const { root, ledger } = await bootHardened(4);
	for (let i = 1; i <= 4; i++) {
		await appendNote(ledger, i);
	}
	const lines = (await readLedger(root)).trimEnd().split('\n');
	const checkpointRow = JSON.parse(lines[4] as string) as { checkpoint: { signature: string } };
	const flipped = (checkpointRow.checkpoint.signature.charAt(0) === '0' ? '1' : '0') + checkpointRow.checkpoint.signature.slice(1);
	lines[4] = (lines[4] as string).replace(checkpointRow.checkpoint.signature, flipped);
	await writeLedger(root, `${lines.join('\n')}\n`);
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.equal(verdict.firstBadSeq, 5);
	assert.match(verdict.reason ?? '', /checkpoint signature verification failed/);
});

test('tamper class 7 (keyId mismatch): verifying with the wrong key is a verdict', async () => {
	const { root, ledger } = await bootHardened(2);
	await appendNote(ledger, 1);
	await appendNote(ledger, 2);
	const wrongKeyLedger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(2_000), signer: createFixtureSigner('hmac-sha256') });
	const verdict = await wrongKeyLedger.verify();
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason ?? '', /keyId mismatch/);
});

test('tamper class 7 (no signer): checkpoint rows cannot be silently accepted unverifiable', async () => {
	const { root, ledger } = await bootHardened(2);
	await appendNote(ledger, 1);
	await appendNote(ledger, 2);
	const unsignedLedger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(3_000) });
	const verdict = await unsignedLedger.verify();
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason ?? '', /no signer supplied/);
});

// ---------------------------------------------------------------------------
// Tamper class 6: size watermark (truncated tail + the closed v0 last-row limitation)
// ---------------------------------------------------------------------------

test('tamper class 6 (truncated tail): dropped final rows vs the stale watermark', async () => {
	const { root, ledger } = await bootHardened(4);
	for (let i = 1; i <= 5; i++) {
		await appendNote(ledger, i);
	}
	const lines = (await readLedger(root)).trimEnd().split('\n');
	await writeLedger(root, `${lines.slice(0, lines.length - 1).join('\n')}\n`);
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.equal(verdict.truncated, true);
	assert.match(verdict.reason ?? '', /truncated tail/);
	assert.match(verdict.reason ?? '', /rowCount/);
});

test('tamper class 6 (v0 limitation CLOSED): last-row mutation in place is caught by the watermark head', async () => {
	const { root, ledger } = await bootHardened(4);
	for (let i = 1; i <= 5; i++) {
		await appendNote(ledger, i);
	}
	const lines = (await readLedger(root)).trimEnd().split('\n');
	lines[lines.length - 1] = (lines[lines.length - 1] as string).replace('flauz://e/5', 'flauz://e/X');
	await writeLedger(root, `${lines.join('\n')}\n`);
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false, 'the chain walk alone cannot see a last-row edit; the watermark must');
	assert.notEqual(verdict.truncated, true);
	assert.match(verdict.reason ?? '', /headSha256/);
});

test('tamper class 6 (rows beyond the watermark): a CHAIN-VALID row appended outside the hardened path', async () => {
	const { root, ledger } = await bootHardened(4);
	for (let i = 1; i <= 3; i++) {
		await appendNote(ledger, i);
	}
	const lines = (await readLedger(root)).trimEnd().split('\n');
	const prev = rowHash(JSON.parse(lines[lines.length - 1] as string) as Parameters<typeof rowHash>[0]);
	const smuggled = { seq: 4, ts: 99, taskId: 'T-001', kind: 'note', uri: 'flauz://e/smuggled', sha256: sha256Hex('smuggled'), prev };
	await writeLedger(root, `${lines.join('\n')}\n${JSON.stringify(smuggled)}\n`);
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.notEqual(verdict.truncated, true, 'actual rows EXCEED the watermark - mismatch, not truncation');
	assert.match(verdict.reason ?? '', /watermark mismatch/);
});

test('tamper class 6 (watermark deleted while checkpoints exist)', async () => {
	const { root, ledger } = await bootHardened(2);
	await appendNote(ledger, 1);
	await appendNote(ledger, 2);
	await fs.rm(path.join(root, '.flauz/evidence/size.json'));
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason ?? '', /watermark missing/);
});

test('tamper class 6 (corrupt watermark JSON)', async () => {
	const { root, ledger } = await bootHardened(2);
	await appendNote(ledger, 1);
	await fs.writeFile(path.join(root, '.flauz/evidence/size.json'), '{not json', { encoding: 'utf-8' });
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.match(verdict.reason ?? '', /size watermark is corrupt/);
});

test('empty ledger + surviving non-empty watermark = full-truncation verdict', async () => {
	const { root, ledger } = await bootHardened(2);
	await appendNote(ledger, 1);
	await writeLedger(root, '');
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, false);
	assert.equal(verdict.truncated, true);
	assert.match(verdict.reason ?? '', /empty but the size watermark records/);
});

// ---------------------------------------------------------------------------
// Never-break pin + workflow interop
// ---------------------------------------------------------------------------

test('never-break pin: an unhardened ledger verifies with the EXACT v0 result shape', async () => {
	const root = await tempRoot();
	const ledger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(1000) });
	await ledger.ensure();
	assert.deepStrictEqual(await ledger.verify(), { ok: true, rows: 0 });
	for (let i = 1; i <= 3; i++) {
		await appendNote(ledger, i);
	}
	assert.deepStrictEqual(await ledger.verify(), { ok: true, rows: 3 });
	await assert.rejects(fs.readFile(path.join(root, '.flauz/evidence/size.json'), { encoding: 'utf-8' }), /ENOENT/, 'unhardened ledgers never write size.json');
});

test('hmac downgrade posture: a fully hmac-hardened ledger verifies green end-to-end', async () => {
	const { ledger } = await bootHardened(2, 'hmac-sha256');
	for (let i = 1; i <= 3; i++) {
		await appendNote(ledger, i);
	}
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, true);
	assert.equal(verdict.rows, 5, '3 appends at interval 2 -> notes at 1,2,4 + checkpoints at 3,5');
	assert.equal(verdict.checkpoints?.verified, 2);
});

test('workflow interop: golden run + save + re-run through a HARDENED ledger stays green', async () => {
	const ws = await bootWorkflowWorkspace();
	const signer = createFixtureSigner('ed25519');
	const hardenedLedger = new EvidenceLedger({ root: ws.root, fs: ws.fs, clock: steppingClock(9_000_000), signer, checkpointInterval: 2 });
	const workflows = new WorkflowService({ root: ws.root, fs: ws.fs, tasks: ws.tasks, ledger: hardenedLedger, clock: steppingClock(9_500_000) });
	const run = await goldenRun(ws);
	const saved = await workflows.save({ taskId: run.taskId });
	const outcome = await workflows.run({ workflowId: saved.workflowId, executor: async () => ({ ok: true, output: 'rerun-ok' }) });
	assert.equal(outcome.stopped, 'completed', `re-run through the hardened ledger must complete (got ${String(outcome.status)})`);
	const verdict = await hardenedLedger.verify();
	assert.equal(verdict.ok, true);
	assert.ok(verdict.checkpoints && verdict.checkpoints.verified >= 1, 'the re-run minted at least one signed checkpoint');
	assert.equal(verdict.watermark?.status, 'ok');
	await ws.cleanup();
});

// ---------------------------------------------------------------------------
// Fixture files (test/fixtures/workflow/ledger + keys)
// ---------------------------------------------------------------------------

test('fixture good.jsonl verifies green against its watermark with the fixture key', async () => {
	const root = await tempRoot();
	await fs.mkdir(path.join(root, '.flauz/evidence'), { recursive: true });
	await fs.copyFile(path.join(FIXTURES, 'ledger/good.jsonl'), path.join(root, '.flauz/evidence/ledger.jsonl'));
	await fs.copyFile(path.join(FIXTURES, 'ledger/good-size.json'), path.join(root, '.flauz/evidence/size.json'));
	const ledger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(1000), signer: createFixtureSigner('ed25519') });
	const verdict = await ledger.verify();
	assert.equal(verdict.ok, true);
	assert.equal(verdict.rows, 6);
	assert.equal(verdict.checkpoints?.verified, 1);
	assert.equal(verdict.watermark?.status, 'ok');
});

test('fixture tamper cases: each bad ledger produces its expected verdict class', async () => {
	const cases: Array<{ name: string; expect: RegExp; truncated?: boolean }> = [
		{ name: 'forged-checkpoint', expect: /checkpoint signature verification failed/ },
		{ name: 'truncated-tail', expect: /truncated tail/, truncated: true },
		{ name: 'last-row-tamper', expect: /headSha256/ },
		{ name: 'watermark-mismatch', expect: /watermark mismatch/ },
	];
	for (const testCase of cases) {
		const root = await tempRoot();
		await fs.mkdir(path.join(root, '.flauz/evidence'), { recursive: true });
		await fs.copyFile(path.join(FIXTURES, `ledger/bad/${testCase.name}.jsonl`), path.join(root, '.flauz/evidence/ledger.jsonl'));
		await fs.copyFile(path.join(FIXTURES, `ledger/bad/${testCase.name}-size.json`), path.join(root, '.flauz/evidence/size.json'));
		const ledger = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(1000), signer: createFixtureSigner('ed25519') });
		const verdict = await ledger.verify();
		assert.equal(verdict.ok, false, `${testCase.name} must not verify`);
		assert.match(verdict.reason ?? '', testCase.expect, `${testCase.name} verdict class`);
		if (testCase.truncated !== undefined) {
			assert.equal(verdict.truncated, testCase.truncated, `${testCase.name} truncated flag`);
		}
	}
});

// ---------------------------------------------------------------------------
// Cross-implementation parity with the DL-21 seam (flauz-agent/core)
// ---------------------------------------------------------------------------

test('cross-implementation parity: the core seam accepts the hardened chain and hashes rows identically', async () => {
	const { root, ledger } = await bootHardened(2);
	for (let i = 1; i <= 3; i++) {
		await appendNote(ledger, i);
	}
	const lines = (await readLedger(root)).trimEnd().split('\n');
	const verdict = contractsValidate(lines);
	assert.equal(verdict.ok, true, `flauz-agent core validateLedgerRows must accept the hardened chain (firstBadSeq=${String(verdict.firstBadSeq)})`);

	for (const line of lines) {
		const row = JSON.parse(line) as Parameters<typeof rowHash>[0];
		assert.equal(contractsRowHash(row), rowHash(row), 'rowHash parity incl. checkpoint rows');
	}
	// A REGULAR (unhardened) chain still passes both sides unchanged.
	const plainRoot = await tempRoot();
	const plain = new EvidenceLedger({ root: plainRoot, fs: nodeFsPort(), clock: steppingClock(500) });
	await plain.ensure();
	await appendNote(plain, 1);
	await appendNote(plain, 2);
	const plainLines = (await readLedger(plainRoot)).trimEnd().split('\n');
	assert.equal(contractsValidate(plainLines).ok, true);
});

test('cross-implementation parity: structurally invalid checkpoint rows are rejected by BOTH sides', async () => {
	const contracts = { validate: contractsValidate };
	const smuggled = {
		seq: 1,
		ts: 1,
		taskId: 'T-001',
		kind: 'note',
		uri: 'u',
		sha256: sha256Hex('x'),
		prev: null,
		checkpoint: { rowSeq: 1, headSha256: 'a'.repeat(64), algorithm: 'ed25519', keyId: 'k', signature: 'b'.repeat(128) },
	} as unknown as Parameters<typeof rowHash>[0];
	// Local side: verify() rejects the checkpoint field on a non-checkpoint row.
	const root = await tempRoot();
	await fs.mkdir(path.join(root, '.flauz/evidence'), { recursive: true });
	await writeLedger(root, `${JSON.stringify(smuggled)}\n`);
	const local = new EvidenceLedger({ root, fs: nodeFsPort(), clock: steppingClock(1000), signer: createFixtureSigner('ed25519') });
	const localVerdict = await local.verify();
	assert.equal(localVerdict.ok, false);
	assert.match(localVerdict.reason ?? '', /only legal on kind 'checkpoint' rows/);
	// Core side: same rejection.
	assert.equal(contracts.validate([JSON.stringify(smuggled)]).ok, false);
	// kind 'checkpoint' WITHOUT the payload field: both sides must reject.
	const naked = { seq: 2, ts: 2, taskId: 'T-001', kind: 'checkpoint', uri: 'u', sha256: sha256Hex('x'), prev: null } as unknown as Parameters<typeof rowHash>[0];
	assert.equal(contracts.validate([JSON.stringify(naked)]).ok, false);
});
