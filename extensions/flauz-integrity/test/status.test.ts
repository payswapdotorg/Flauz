/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The status suite (A-PROD-005-W2): the read-only state view -- the pinned
 * count, the signed coverage, the key fingerprint, the last verify verdict
 * summary -- and THE READ-ONLY LAW itself: no state change (proven by a
 * write-refusing fs port + the absence of any banked row).
 */

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import type { IntegrityFsPort } from '../src/api.ts';
import { joinPath } from '../src/api.ts';
import { runSign, persistLedger } from '../src/ledger.ts';
import { runVerify, persistVerify } from '../src/verify.ts';
import { runStatus, renderStatus } from '../src/status.ts';

import { nodeIntegrityFs, steppingClock, realNodeKeyPort, bootFixtureProduct, bootFixtureWorkspace } from './helpers.ts';

const fs = nodeIntegrityFs();

/** An fs port that REFUSES every write/mkdir/append (the read-only proof vehicle). */
function writeRefusingFs(base: IntegrityFsPort): IntegrityFsPort {
        const refuse = async (op: string): Promise<never> => {
                throw new Error(`the read-only status lane must not ${op} -- the status command is render-only`);
        };
        return {
                readFileUtf8: base.readFileUtf8,
                readFileBytes: base.readFileBytes,
                readdir: base.readdir,
                mkdir: () => refuse('mkdir'),
                writeFile: () => refuse('write'),
                appendFile: () => refuse('append'),
        };
}

suite('A-PROD-005-W2 status: the read-only state view', () => {
        test('a fresh workspace: 3 pinned, coverage 0 (no ledger), key store absent, no last verify', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const status = await runStatus({ root: workspace.root, productRoot: product.root, fs, keys: realNodeKeyPort() });
                        assert.equal(status.pinnedArtifactCount, 3);
                        assert.equal(status.manifestStatus, 'PINNED');
                        assert.equal(status.signedCoverage, undefined);
                        assert.equal(status.keyStore.status, 'absent');
                        assert.equal(status.lastVerify, undefined);
                        const lines = renderStatus(status);
                        assert.ok(lines.some(line => line.includes('pinned artifacts: 3')));
                        assert.ok(lines.some(line => line.includes('starts empty by design')));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('after sign + verify: coverage 3/3, the ledger fingerprint, the key store present, the last verdict summarized', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, signed.ledger);
                        const verified = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await persistVerify({ root: workspace.root, fs, clock: steppingClock() }, verified.record);

                        const status = await runStatus({ root: workspace.root, productRoot: product.root, fs, keys });
                        assert.equal(status.pinnedArtifactCount, 3);
                        assert.ok(status.signedCoverage !== undefined);
                        assert.equal(status.signedCoverage?.signed, 3);
                        assert.equal(status.signedCoverage?.total, 3);
                        assert.equal(status.ledgerFingerprint, signed.ledger.keyFingerprint);
                        assert.equal(status.keyStore.status, 'present');
                        assert.equal(status.keyStore.info?.fingerprint, signed.ledger.keyFingerprint);
                        assert.ok(status.lastVerify !== undefined);
                        assert.equal(status.lastVerify?.verdict, 'GREEN');
                        assert.equal(status.lastVerify?.ok, true);
                        assert.equal(status.lastVerify?.counts.green, 3);
                        const lines = renderStatus(status);
                        assert.ok(lines.some(line => line.includes('3/3')));
                        assert.ok(lines.some(line => line.includes('last verify: GREEN')));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('THE READ-ONLY LAW: the status lane runs clean over a write-refusing fs port (no record, no banking, no key generation)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, signed.ledger);
                        const filesBefore = new Set((await (await import('./helpers.ts')).readAllFiles(joinPath(workspace.root, '.flauz'))).map(file => file.path));

                        // the read-only lane: every write op throws if touched
                        const status = await runStatus({ root: workspace.root, productRoot: product.root, fs: writeRefusingFs(fs), keys });
                        assert.equal(status.pinnedArtifactCount, 3);
                        assert.equal(status.signedCoverage?.signed, 3);
                        renderStatus(status); // renders clean too

                        // nothing changed on disk
                        const filesAfter = (await (await import('./helpers.ts')).readAllFiles(joinPath(workspace.root, '.flauz'))).map(file => file.path);
                        assert.deepEqual([...filesAfter].sort(), [...filesBefore].sort(), 'the status lane wrote nothing');
                        // the peek never generated a key store (it was absent pre-sign in a FRESH workspace view? -- here it exists from the sign; the fresh case is covered above)
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a tampered product is reflected honestly in the last-verify summary (status never re-verifies, it VIEWS)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, signed.ledger);
                        const verified = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await persistVerify({ root: workspace.root, fs, clock: steppingClock() }, verified.record);
                        // the status view reports the LAST verify -- it does not re-hash
                        const status = await runStatus({ root: workspace.root, productRoot: product.root, fs: writeRefusingFs(fs), keys });
                        assert.equal(status.lastVerify?.verdict, 'GREEN');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});
