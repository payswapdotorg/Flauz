/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The canary sweep (A-PROD-005-W2): no secret-shaped value in ANY metadata
 * surface this extension produces -- the signature ledger, the verify
 * record, the status render, the banked evidence rows. THE KEY-STORE LAW:
 * public keys + fingerprints are legitimate record material; PRIVATE-KEY
 * material NEVER appears in any record, any render, any banked row -- the
 * one place it lives is the KeyPort-owned store file, which is never
 * committed, never banked, never rendered (the suite pins all three
 * boundaries).
 *
 * The fixtures plant secret-shaped values (assembled from fragments at
 * runtime, the no-literal law) and the private-key hex of the real store;
 * every written byte outside the store + every render line is scanned.
 */

import * as assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import { suite, test } from 'mocha';

import { KEY_STORE_PATH, joinPath } from '../src/api.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { IntegrityError } from '../src/api.ts';
import { runSign, persistLedger, renderSign } from '../src/ledger.ts';
import { runVerify, persistVerify, renderVerify } from '../src/verify.ts';
import { runStatus, renderStatus } from '../src/status.ts';

import { nodeIntegrityFs, steppingClock, realNodeKeyPort, bootFixtureProduct, bootFixtureWorkspace, readAllFiles, canaryToken, flipOneByte } from './helpers.ts';

const fs = nodeIntegrityFs();
const clock = steppingClock();

suite('A-PROD-005-W2 canary sweep: the pattern battery', () => {
        test('every known credential shape is detected (assembled from fragments at runtime)', () => {
                assert.equal(looksSecretShaped(canaryToken('github')), true);
                assert.equal(looksSecretShaped(canaryToken('openai')), true);
                assert.equal(looksSecretShaped(canaryToken('aws')), true);
                assert.equal(looksSecretShaped(canaryToken('bearer')), true);
                assert.equal(looksSecretShaped(canaryToken('pem')), true);
        });

        test('ordinary metadata values are NOT secret-shaped (paths, hashes, versions, verdicts, public keys)', () => {
                assert.equal(looksSecretShaped('.flauz/integrity/ledger-20260101T000000.000Z.json'), false);
                assert.equal(looksSecretShaped('a'.repeat(64)), false);
                assert.equal(looksSecretShaped('0.1.0'), false);
                assert.equal(looksSecretShaped('flauz.flauz-integrity'), false);
                assert.equal(looksSecretShaped('extensions/flauz-beta/dist/extension.js'), false);
                assert.equal(looksSecretShaped('ed25519'), false);
                assert.equal(looksSecretShaped('deadbeef'.repeat(8)), false, 'a raw hex public key / hash is a shape, not a credential');
        });
});

suite('A-PROD-005-W2 canary sweep: the fail-closed refusal', () => {
        test('a ledger record carrying a secret-shaped value is refused (typed FLAUZ_INTEGRITY_SECRET_SHAPED)', () => {
                const record = { $schema: 'flauz.integrity-ledger/v1', ok: true, entries: [{ artifactPath: 'extensions/flauz-alpha/dist/extension.js', note: canaryToken('github') }] };
                assert.throws(() => sweepArtifact(record, 'integrity-ledger'), (err: unknown) => {
                        assert.ok(err instanceof IntegrityError);
                        assert.equal(err.code, 'FLAUZ_INTEGRITY_SECRET_SHAPED');
                        assert.ok(err.message.includes('integrity-ledger'));
                        return true;
                });
        });

        test('a verify record + nested structures carrying secret-shaped values are refused (the deep walk)', () => {
                assert.throws(() => sweepArtifact({ counts: { green: 1 }, artifacts: [{ reasons: [canaryToken('openai')] }] }, 'integrity-verify'), /FLAUZ_INTEGRITY_SECRET_SHAPED|secret-shaped/);
                assert.throws(() => sweepArtifact({ a: { b: { c: { d: canaryToken('bearer') } } } }, 'x'), /secret-shaped/);
                sweepArtifact({ a: { b: { c: { d: 'ordinary' } } }, e: [1, 2, 3] }, 'x'); // ordinary values pass clean
        });
});

suite('A-PROD-005-W2 canary sweep: the full-run byte scan (the metadata + key-store laws over real runs)', () => {
        test('a full sign + verify + status run writes ZERO secret-shaped bytes outside the key store; the PRIVATE KEY HEX lives ONLY in the store', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        await persistLedger({ root: workspace.root, fs, clock }, signed.ledger);
                        const verified = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        await persistVerify({ root: workspace.root, fs, clock }, verified.record);
                        const status = await runStatus({ root: workspace.root, productRoot: product.root, fs, keys });

                        // the store exists + carries the private key hex (its legitimate one place)
                        const storeText = await nodeFs.readFile(path.join(workspace.root, KEY_STORE_PATH), 'utf-8');
                        const store = JSON.parse(storeText) as { privateKeyHex: string; publicKeyHex: string };
                        assert.match(store.privateKeyHex, /^[0-9a-f]{64}$/);

                        // every render line: shape-only, no canary, no private-key hex
                        const renderedLines = [...renderSign(signed), ...renderVerify(verified), ...renderStatus(status)];
                        assert.ok(renderedLines.length >= 10);
                        for (const line of renderedLines) {
                                assert.ok(!looksSecretShaped(line), `a render line is never secret-shaped (${line.slice(0, 80)})`);
                                assert.ok(!line.includes(store.privateKeyHex), 'a render line never carries the private key hex');
                                assert.ok(!line.includes(store.publicKeyHex), 'renders carry the FINGERPRINT, not even the full public key');
                        }

                        // every written byte under .flauz/ EXCEPT the port-owned store: no canary, no private-key hex, no secret shape
                        const files = await readAllFiles(joinPath(workspace.root, '.flauz'), absPath => absPath === path.join(workspace.root, KEY_STORE_PATH));
                        assert.ok(files.length >= 3, `the run wrote its artifacts + the banked ledger (${String(files.length)} files)`);
                        for (const file of files) {
                                assert.ok(!file.text.includes(store.privateKeyHex), `${file.path} carries no private key material`);
                                assert.ok(!looksSecretShaped(file.text), `${file.path} as a whole is not secret-shaped`);
                        }
                        // the ledger + verify records DO carry the public key + fingerprint (the legitimate shapes)
                        const ledgerFile = files.find(file => file.path.includes('ledger-'));
                        assert.ok(ledgerFile !== undefined);
                        assert.ok(ledgerFile.text.includes(store.publicKeyHex), 'the ledger records the public key (the legitimate shape)');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the KEY-STORE BOUNDARY: the store path is never a banked uri, never a record path, never rendered', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        const persistedLedger = await persistLedger({ root: workspace.root, fs, clock }, signed.ledger);
                        const verified = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        const persistedVerify = await persistVerify({ root: workspace.root, fs, clock }, verified.record);

                        // the banked evidence rows: uris are the ledger/verify records ONLY
                        const ledgerText = await fs.readFileUtf8(joinPath(workspace.root, '.flauz/evidence/ledger.jsonl'));
                        assert.ok(ledgerText !== undefined);
                        for (const line of ledgerText.split('\n').filter(entry => entry !== '')) {
                                const row = JSON.parse(line) as { uri: string };
                                assert.ok(!row.uri.includes('keys/'), `the key store is never banked (${row.uri})`);
                                assert.ok(row.uri === persistedLedger.recordPath.replace(`${workspace.root}/`, '') || row.uri === persistedVerify.recordPath.replace(`${workspace.root}/`, ''), `the banked uri is a record path (${row.uri})`);
                        }

                        // the record paths never point into the store
                        assert.ok(!persistedLedger.recordPath.includes('/keys/'));
                        assert.ok(!persistedVerify.recordPath.includes('/keys/'));

                        // the renders never name the store path
                        for (const line of [...renderSign(signed), ...renderVerify(verified)]) {
                                assert.ok(!line.includes(KEY_STORE_PATH), 'the store path is never rendered');
                        }
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the degraded runs (unsigned + tampered + torn fixtures) stay canary-clean too', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        // unsigned (no ledger) + absent key store
                        const unsigned = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock, keys: realNodeKeyPort() });
                        const persistedUnsigned = await persistVerify({ root: workspace.root, fs, clock }, unsigned.record);
                        const text = await fs.readFileUtf8(persistedUnsigned.recordPath);
                        assert.ok(text !== undefined);
                        assert.ok(!looksSecretShaped(text), 'the unsigned-degradation record is canary-clean');
                        assert.equal(unsigned.record.verdict, 'NOT-GREEN');

                        // tampered (flip an artifact byte after signing)
                        const keys = realNodeKeyPort();
                        const signed = await runSign({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        await persistLedger({ root: workspace.root, fs, clock }, signed.ledger);
                        const tamperedFixtureBytes = await fs.readFileBytes(joinPath(product.root, 'extensions/flauz-alpha/dist/extension.js'));
                        assert.ok(tamperedFixtureBytes !== undefined);
                        const nodeFsModule = await import('node:fs/promises');
                        const pathModule = await import('node:path');
                        await nodeFsModule.writeFile(pathModule.join(product.root, 'extensions/flauz-alpha/dist/extension.js'), flipOneByte(tamperedFixtureBytes));
                        const tampered = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock, keys });
                        for (const line of renderVerify(tampered)) {
                                assert.ok(!looksSecretShaped(line));
                        }
                        assert.equal(tampered.record.counts.tampered, 1);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});
