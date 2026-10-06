/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The determinism law (A-PROD-006-W2): the injected clock is the only
 * timestamp source; identical inputs produce byte-identical artifacts; the
 * ids are pure arithmetic. UNVERIFIED-BY-ME: the station runs the battery.
 *
 * THE GREP CONTRACT (mirrored here as documentation for the station's
 * receipt): the wave's grep gate is
 *   grep -rn "Date\.now\|Math\.random\|new Date()" src/
 * and must show comments only. The two sanctioned exceptions, exactly as in
 * the W1 sibling: (a) src/format.ts -- the PU6-pinned VERBATIM shared module
 * (its formatAge default param carries Date.now() and toIsoStamp carries
 * new Date(); every flauz extension's byte-identical copy does); (b)
 * src/extension.ts -- the single host-wiring line carrying the determinism
 * + injected exemption comment. No other src/ file may match.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { launchReleaseAcceptance } from '../src/acceptance.ts';
import { verifyPostRelease } from '../src/verify.ts';
import { toIsoStamp } from '../src/format.ts';
import { serializeArtifact } from '../src/api.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklist } from './helpers.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const SRC_DIR = path.join(REPO_ROOT, 'extensions', 'flauz-acceptance', 'src');

suite('flauz.acceptance/v1 -- the determinism law', () => {
	test('identical workspaces + identical injected clocks produce byte-identical acceptance records', async () => {
		const { root: rootA, cleanup: cleanupA } = await tempRoot('flauz-acc-det1-');
		const { root: rootB, cleanup: cleanupB } = await tempRoot('flauz-acc-det2-');
		try {
			for (const root of [rootA, rootB]) {
				await plantEvidenceBodies(root);
				await plantChecklist(root, '/workspace/determinism-pin', { stamp: '2026-10-04T210000.000Z' });
			}
			const a = await launchReleaseAcceptance({ root: rootA, fs: nodeAcceptanceFs(), clock: steppingClock() }, { actor: 'operator-1' });
			const b = await launchReleaseAcceptance({ root: rootB, fs: nodeAcceptanceFs(), clock: steppingClock() }, { actor: 'operator-1' });
			assert.equal(serializeArtifact(a.record), serializeArtifact(b.record));
			// and byte-identical on disk
			const textA = await fs.readFile(path.join(rootA, '.flauz', 'acceptance', `acceptance-${a.acceptanceId}.json`), 'utf-8');
			const textB = await fs.readFile(path.join(rootB, '.flauz', 'acceptance', `acceptance-${b.acceptanceId}.json`), 'utf-8');
			assert.equal(textA, textB);
		} finally {
			await cleanupA();
			await cleanupB();
		}
	});

	test('identical verify inputs produce byte-identical receipts (the receipt id derives from the bound content)', async () => {
		const { root: rootA, cleanup: cleanupA } = await tempRoot('flauz-acc-det3-');
		const { root: rootB, cleanup: cleanupB } = await tempRoot('flauz-acc-det4-');
		try {
			const ids: string[] = [];
			for (const root of [rootA, rootB]) {
				await plantEvidenceBodies(root);
				await plantChecklist(root, "/workspace/determinism-pin");
				const launched = await launchReleaseAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, { actor: 'operator-1' });
				ids.push(launched.acceptanceId);
			}
			const a = await verifyPostRelease({ root: rootA, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId: ids[0] as string, actor: 'operator-1' });
			const b = await verifyPostRelease({ root: rootB, fs: nodeAcceptanceFs(), clock: steppingClock() }, { acceptanceId: ids[1] as string, actor: 'operator-1' });
			assert.equal(a.receipt.receiptId, b.receipt.receiptId);
			assert.equal(serializeArtifact(a.receipt), serializeArtifact(b.receipt));
		} finally {
			await cleanupA();
			await cleanupB();
		}
	});

	test('a different injected clock produces a different record (the clock genuinely flows through)', async () => {
		const { root: rootA, cleanup: cleanupA } = await tempRoot('flauz-acc-det5-');
		const { root: rootB, cleanup: cleanupB } = await tempRoot('flauz-acc-det6-');
		try {
			for (const root of [rootA, rootB]) {
				await plantEvidenceBodies(root);
				await plantChecklist(root, "/workspace/determinism-pin");
			}
			const a = await launchReleaseAcceptance({ root: rootA, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_100_000_000) }, { actor: 'operator-1' });
			const b = await launchReleaseAcceptance({ root: rootB, fs: nodeAcceptanceFs(), clock: steppingClock(1_740_100_500_000) }, { actor: 'operator-1' });
			assert.notEqual(a.record.createdAt, b.record.createdAt);
			assert.equal(a.record.createdAtIso, toIsoStamp(1_740_100_000_000));
		} finally {
			await cleanupA();
			await cleanupB();
		}
	});

	test('the grep contract: src/ carries no unsanctioned Date.now/Math.random/new Date() (comments + the two sanctioned files only)', async () => {
		const entries = await fs.readdir(SRC_DIR);
		const offenders: string[] = [];
		for (const name of entries.filter(entry => entry.endsWith('.ts'))) {
			const text = await fs.readFile(path.join(SRC_DIR, name), 'utf-8');
			const lines = text.split('\n');
			for (const [index, line] of lines.entries()) {
				if (/Date\.now\(\)|Math\.random\(\)|new Date\(\)/.test(line)) {
					const sanctionedFile = name === 'format.ts';
					const sanctionedComment = /determinism|injected/.test(line);
					const isComment = line.trim().startsWith('*') || line.trim().startsWith('//');
				if (!sanctionedFile && !isComment && !sanctionedComment) {
						offenders.push(`${name}:${String(index + 1)}: ${line.trim()}`);
					}
				}
			}
		}
		assert.deepEqual(offenders, [], `the determinism law: unsanctioned host-clock/random lines in src/ (expected comments + the format.ts/extension.ts sanctioned lines only): ${offenders.join(' | ')}`);
	});
});
