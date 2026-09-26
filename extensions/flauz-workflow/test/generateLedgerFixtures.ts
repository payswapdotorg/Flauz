/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Deterministic generator for the Wave-4 Lane K ledger-hardening fixtures at
 * the REPO-ROOT test/fixtures/workflow/{keys,ledger}.
 *
 * Run from the repo root:
 *
 *   node extensions/flauz-workflow/test/generateLedgerFixtures.ts
 *
 * Everything is derived from fixed inputs (a stepping clock, fixed evidence
 * sha256 values, and the seed-derived fixture keystore of src/keys.ts), so
 * regeneration is byte-identical - the committed fixtures ARE its output
 * (receipt: two runs -> identical sha256s, see REPORT VERIFICATION-RECEIPTS).
 * Tamper variants are derived in-place from the good ledger:
 *   - bad/forged-checkpoint:  one hex char of row 5's checkpoint signature
 *                             flipped (still well-formed hex; the signature
 *                             check must fail - tamper class 7).
 *   - bad/truncated-tail:     the final row removed; the STALE good watermark
 *                             survives (rowCount/bytes/head mismatch - the
 *                             DL-20 truncated-tail class, tamper class 6).
 *   - bad/last-row-tamper:    the final row's uri mutated IN PLACE (same byte
 *                             length, chain still walks clean - only the
 *                             watermark head catches it: the v0 last-row
 *                             limitation, closed).
 *   - bad/watermark-mismatch: good rows + a watermark whose headSha256 has one
 *                             hex char flipped (mismatch without truncation).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { sha256Hex } from '../../flauz-workspace/src/api.ts';
import { EvidenceLedger, rowHash } from '../../flauz-workspace/src/ledger.ts';
import type { LedgerWatermark } from '../../flauz-workspace/src/hardening.ts';
import { createFixtureSigner, generateFixtureKeystore } from '../src/keys.ts';

/** Repo-root fixture directories (this script's output home). */
const FIXTURE_ROOT = path.resolve(new URL('../../../test/fixtures/workflow/', import.meta.url).pathname);
const KEYS_DIR = path.join(FIXTURE_ROOT, 'keys');
const LEDGER_DIR = path.join(FIXTURE_ROOT, 'ledger');
const BAD_DIR = path.join(LEDGER_DIR, 'bad');

const nodeFs: FileSystemPort = {
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

/** Deterministic stepping clock (epoch ms; +1000 per call, fixed origin). */
function steppingClock(): () => number {
	let current = 1_740_000_000_000;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/** Repo fixtures are tab-indented per hygiene; runtime watermarks serialize 2-space (DL-9). */
function fixtureJson(value: unknown): string {
	return `${JSON.stringify(value, null, '\t')}\n`;
}

async function main(): Promise<void> {
	// --- 1. fixture keystore (seed-derived, byte-reproducible) ---
	const keystore = generateFixtureKeystore();
	await fs.mkdir(KEYS_DIR, { recursive: true });
	for (const [name, contents] of keystore.files) {
		await fs.writeFile(path.join(KEYS_DIR, name), contents, { encoding: 'utf-8' });
	}

	// --- 2. good hardened ledger: interval 4, five appends -> rows 1-4,
	//        checkpoint row 5 (covers row 4), row 6 (watermark rowCount 6) ---
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-fixture-gen-'));
	try {
		const ledger = new EvidenceLedger({
			root,
			fs: nodeFs,
			clock: steppingClock(),
			signer: createFixtureSigner('ed25519'),
			checkpointInterval: 4,
		});
		await ledger.ensure();
		for (let i = 1; i <= 5; i++) {
			await ledger.append('T-001', {
				kind: 'note',
				uri: `flauz://e/${String(i)}`,
				sha256: sha256Hex(`flauz-fixture-evidence-${String(i)}`),
				note: `fixture row ${String(i)}`,
			});
		}
		const goodLines = (await fs.readFile(path.join(root, '.flauz/evidence/ledger.jsonl'), { encoding: 'utf-8' })).trimEnd().split('\n');
		const goodSizeRaw = await fs.readFile(path.join(root, '.flauz/evidence/size.json'), { encoding: 'utf-8' });
		const goodSize = JSON.parse(goodSizeRaw) as LedgerWatermark;

		await fs.mkdir(BAD_DIR, { recursive: true });
		await fs.writeFile(path.join(LEDGER_DIR, 'good.jsonl'), `${goodLines.join('\n')}\n`, { encoding: 'utf-8' });
		await fs.writeFile(path.join(LEDGER_DIR, 'good-size.json'), fixtureJson(goodSize), { encoding: 'utf-8' });

		// bad/forged-checkpoint: flip one hex char of row 5's checkpoint signature,
		// then RE-LINK row 6's prev to the tampered row 5's hash - a real forger
		// recomputes the chain; only the SIGNATURE can catch this (class 7).
		const forged = goodLines.slice();
		const row5 = JSON.parse(forged[4] as string) as { checkpoint: { signature: string } };
		const sig = row5.checkpoint.signature;
		const flipped = (sig.charAt(0) === '0' ? '1' : '0') + sig.slice(1);
		forged[4] = (forged[4] as string).replace(sig, flipped);
		const tamperedRow5 = JSON.parse(forged[4] as string) as Parameters<typeof rowHash>[0];
		const row6 = JSON.parse(forged[5] as string) as { prev: string };
		row6.prev = rowHash(tamperedRow5);
		forged[5] = JSON.stringify(row6);
		await fs.writeFile(path.join(BAD_DIR, 'forged-checkpoint.jsonl'), `${forged.join('\n')}\n`, { encoding: 'utf-8' });
		await fs.writeFile(path.join(BAD_DIR, 'forged-checkpoint-size.json'), fixtureJson(goodSize), { encoding: 'utf-8' });

		// bad/truncated-tail: drop the final row; keep the STALE good watermark.
		const truncated = goodLines.slice(0, goodLines.length - 1);
		await fs.writeFile(path.join(BAD_DIR, 'truncated-tail.jsonl'), `${truncated.join('\n')}\n`, { encoding: 'utf-8' });
		await fs.writeFile(path.join(BAD_DIR, 'truncated-tail-size.json'), fixtureJson(goodSize), { encoding: 'utf-8' });

		// bad/last-row-tamper: mutate the final row's uri IN PLACE (same byte length).
		const tampered = goodLines.slice();
		tampered[tampered.length - 1] = (tampered[tampered.length - 1] as string).replace('flauz://e/5', 'flauz://e/X');
		await fs.writeFile(path.join(BAD_DIR, 'last-row-tamper.jsonl'), `${tampered.join('\n')}\n`, { encoding: 'utf-8' });
		await fs.writeFile(path.join(BAD_DIR, 'last-row-tamper-size.json'), fixtureJson(goodSize), { encoding: 'utf-8' });

		// bad/watermark-mismatch: good rows + headSha256 with one hex char flipped.
		const mismatched: LedgerWatermark = {
			...goodSize,
			headSha256: (goodSize.headSha256.charAt(0) === '0' ? '1' : '0') + goodSize.headSha256.slice(1),
		};
		await fs.writeFile(path.join(BAD_DIR, 'watermark-mismatch.jsonl'), `${goodLines.join('\n')}\n`, { encoding: 'utf-8' });
		await fs.writeFile(path.join(BAD_DIR, 'watermark-mismatch-size.json'), fixtureJson(mismatched), { encoding: 'utf-8' });

		console.log(`fixtures written to ${FIXTURE_ROOT}: ${String(goodLines.length)} rows (1 checkpoint), watermark rowCount=${String(goodSize.rowCount)}`);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

await main();
