/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The read-only state view semantics (A-PROD-005-W3): the status command
 * writes NOTHING (proven by the write-refusing fs port), resolves the
 * NEWEST records by the stamp sort, and degrades honestly when no record
 * exists.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { runStatus, renderStatus } from '../src/status.ts';
import { runAudit, persistAudit, auditStamp } from '../src/audit.ts';
import { runEnforce, persistEnforce, enforceStamp } from '../src/enforce.ts';
import { AUDIT_PREFIX, ENFORCE_PREFIX } from '../src/api.ts';
import {
	nodeIsolationFs,
	writeRefusingFs,
	steppingClock,
	tempRoot,
	plantFixtureProduct,
	plantFixtureWorkspace,
} from './helpers.ts';

const fsPort = nodeIsolationFs();

suite('flauz.isolation.status — the read-only law', () => {
	test('the status view writes NOTHING (the write-refusing fs port completes without a refusal)', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-sta-');
		try {
			await plantFixtureProduct(root);
			const clock = steppingClock();
			// write the records with the REAL port...
			await persistAudit({ root, fs: fsPort, clock }, (await runAudit({ root, productRoot: root, fs: fsPort, clock })).record);
			await persistEnforce({ root, fs: fsPort, clock }, (await runEnforce({ root, fs: fsPort, clock })).record);
			// ...then read the status through the write-refusing port: any write would throw
			const status = await runStatus({ root, fs: writeRefusingFs(fsPort) });
			assert.equal(status.audit.present, true);
			assert.equal(status.enforce.present, true);
			assert.ok(status.audit.counts !== undefined);
			assert.ok(status.enforce.counts !== undefined);
			const lines = renderStatus(status);
			assert.ok(lines.some(line => line.includes('read-only state view')));
		} finally {
			await cleanup();
		}
	});

	test('the newest-record resolution: the stamp sort picks the latest audit + enforce', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-sta-');
		try {
			await plantFixtureProduct(root);
			const early = 1_740_000_000_000;
			const late = 1_740_000_500_000;
			for (const at of [early, late]) {
				const clock = (): number => at;
				await persistAudit({ root, fs: fsPort, clock }, (await runAudit({ root, productRoot: root, fs: fsPort, clock })).record);
				await persistEnforce({ root, fs: fsPort, clock }, (await runEnforce({ root, fs: fsPort, clock })).record);
			}
			const status = await runStatus({ root, fs: fsPort });
			assert.equal(status.audit.recordPath, `.flauz/isolation/${AUDIT_PREFIX}${auditStamp(late)}.json`);
			assert.equal(status.enforce.recordPath, `.flauz/isolation/${ENFORCE_PREFIX}${enforceStamp(late)}.json`);
		} finally {
			await cleanup();
		}
	});

	test('no records: the honest typed degradation render (never a guessed summary)', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-sta-');
		try {
			await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
			const status = await runStatus({ root, fs: fsPort });
			assert.equal(status.audit.present, false);
			assert.equal(status.enforce.present, false);
			const lines = renderStatus(status);
			assert.ok(lines.some(line => line.includes('last audit: none')));
			assert.ok(lines.some(line => line.includes('last enforcement: none')));
		} finally {
			await cleanup();
		}
	});

	test('a torn record renders present-but-unreadable (honest, never a guessed summary)', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-sta-');
		try {
			await plantFixtureProduct(root);
			const clock = steppingClock();
			await persistAudit({ root, fs: fsPort, clock }, (await runAudit({ root, productRoot: root, fs: fsPort, clock })).record);
			// tear the newest record
			const dir = path.join(root, '.flauz', 'isolation');
			const names = (await fs.readdir(dir)).filter(name => name.startsWith(AUDIT_PREFIX)).sort();
			await fs.writeFile(path.join(dir, names[names.length - 1] as string), '{ torn', 'utf-8');
			const status = await runStatus({ root, fs: fsPort });
			assert.equal(status.audit.present, true);
			assert.equal(status.audit.counts, undefined, 'a torn record contributes no counts');
			const lines = renderStatus(status);
			assert.ok(lines.some(line => line.includes('torn')));
		} finally {
			await cleanup();
		}
	});
});
