/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The DL-32 contract pins (A-PROD-005-W2): this extension's
 * contract-duplicated shapes pinned against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned session-battery
 * pattern; src never crosses extension boundaries).
 *
 *   - api.ts           vs extensions/flauz-release/src/api.ts AND
 *                      extensions/flauz-production/src/api.ts (sha256
 *                      byte-equal vs node:crypto -- string AND this wave's
 *                      bytes core; canonical JSON + artifact serialization
 *                      byte-equal);
 *   - the ledger row   vs extensions/flauz-production/src/verify.ts (the row
 *     contract           parsers + chain hashes agree on valid + invalid
 *                      inputs; a banked integrity row parses under the REAL
 *                      owning parser -- the cross-recognition law);
 *   - isProductRoot    vs extensions/flauz-release/src/productState.ts (the
 *                      product-root probe seam);
 *   - the bundle       vs the REAL committed bundle-manifest.json (shape
 *     manifest parser    invariants ONLY -- count-free, membership-free:
 *                      station-stable by design, the flauz-lab catalog
 *                      drift at the W1 station is the exact brittleness
 *                      this suite refuses to repeat);
 *   - the codecs       vs node:crypto + Buffer (base64/hex round-trips).
 */

import * as assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { suite, test } from 'mocha';

import {
        sha256Hex,
        sha256HexBytes,
        canonicalJson,
        serializeArtifact,
        parseLedgerLine,
        ledgerRowHash,
        ledgerRowLine,
        isProductRoot,
        parseBundleManifest,
        pinnedArtifacts,
        bytesToBase64,
        base64ToBytes,
        bytesToHex,
        hexToBytes,
        joinPath,
} from '../src/api.ts';
import { bankLedgerRowFor } from '../src/banking.ts';

import { sha256Hex as releaseSha256Hex, canonicalJson as releaseCanonicalJson, serializeArtifact as releaseSerializeArtifact } from '../../flauz-release/src/api.ts';
import { sha256Hex as productionSha256Hex, serializeArtifact as productionSerializeArtifact } from '../../flauz-production/src/api.ts';
import { parseLedgerLine as productionParseLedgerLine, ledgerRowHash as productionLedgerRowHash, ledgerRowLine as productionLedgerRowLine } from '../../flauz-production/src/verify.ts';
import { isProductRoot as releaseIsProductRoot } from '../../flauz-release/src/productState.ts';

import { nodeIntegrityFs, steppingClock, repoRoot, bootFixtureProduct, bootFixtureWorkspace } from './helpers.ts';

const fs = nodeIntegrityFs();

suite('A-PROD-005-W2 contract pins: the sha256 family vs node:crypto + the owning modules', () => {
        test('sha256Hex (string) is byte-equal to node:crypto, flauz-release AND flauz-production', () => {
                const payloads = ['', 'flauz', '{"a":1,"b":[2,3]}', 'x'.repeat(1000), 'ünïcödé ✓ snowman ☃'];
                for (const payload of payloads) {
                        const expected = createHash('sha256').update(payload, 'utf8').digest('hex');
                        assert.equal(sha256Hex(payload), expected);
                        assert.equal(sha256Hex(payload), releaseSha256Hex(payload));
                        assert.equal(sha256Hex(payload), productionSha256Hex(payload));
                }
        });

        test('sha256HexBytes (this wave\'s artifact-hashing core) is byte-equal to node:crypto over raw bytes', () => {
                const bytePayloads: Uint8Array[] = [
                        new Uint8Array(0),
                        new Uint8Array([0x00]),
                        new TextEncoder().encode('flauz integrity artifact bytes'),
                        new Uint8Array(55),                      // one under a block boundary
                        new Uint8Array(56),                      // exactly one block
                        new Uint8Array(57),                      // one over
                        new Uint8Array(1000).map((_, i) => (i * 7 + 3) & 0xff),
                        new Uint8Array(1024).fill(0xff),
                ];
                for (const payload of bytePayloads) {
                        const expected = createHash('sha256').update(payload).digest('hex');
                        assert.equal(sha256HexBytes(payload), expected);
                }
                // the string variant delegates to the bytes core (consistency by construction)
                assert.equal(sha256Hex('delegate'), sha256HexBytes(new TextEncoder().encode('delegate')));
        });

        test('canonicalJson + serializeArtifact are byte-equal to the W5/W1 owning implementations', () => {
                const values = [
                        { b: 1, a: [2, { z: null, y: undefined, w: 's' }] },
                        { rows: [{ seq: 1, ts: 2, taskId: 'flauz-integrity', kind: 'note', uri: 'u', sha256: 'a'.repeat(64), prev: null }] },
                        [],
                        'plain',
                ];
                for (const value of values) {
                        assert.equal(canonicalJson(value), releaseCanonicalJson(value));
                        assert.equal(serializeArtifact(value), releaseSerializeArtifact(value));
                        assert.equal(serializeArtifact(value), productionSerializeArtifact(value));
                }
        });
});

suite('A-PROD-005-W2 contract pins: the evidence-ledger row contract (the cross-recognition law)', () => {
        test('parseLedgerLine + the chain hashes agree with the flauz-production owning parser', () => {
                const validLedger = '{"kind":"note","prev":null,"seq":1,"sha256":"' + 'a'.repeat(64) + '","taskId":"flauz-integrity","ts":100,"uri":"u"}';
                const mine = parseLedgerLine(validLedger, 1);
                const owning = productionParseLedgerLine(validLedger, 1);
                assert.equal(mine.ok, true);
                assert.equal(owning.ok, true);
                if (mine.ok && owning.ok) {
                        assert.equal(ledgerRowHash(mine.row), productionLedgerRowHash(owning.row));
                        assert.equal(ledgerRowLine(mine.row), productionLedgerRowLine(owning.row));
                }
                for (const bad of ['', '{', '[]', '{"seq":0}', `{"kind":"note","prev":null,"seq":1,"sha256":"short","taskId":"t","ts":100,"uri":"u"}`]) {
                        assert.equal(parseLedgerLine(bad, 1).ok, false);
                        assert.equal(parseLedgerLine(bad, 1).ok, productionParseLedgerLine(bad, 1).ok);
                }
        });

        test('a banked flauz-integrity row parses under the REAL W1 owning parser (the cross-recognition law)', async () => {
                const workspace = await bootFixtureWorkspace();
                try {
                        const recordLine = '{"$schema":"flauz.integrity-ledger/v1","ok":true}';
                        const banking = await bankLedgerRowFor({ root: workspace.root, fs, clock: steppingClock() }, recordLine, '.flauz/integrity/ledger-fixture.json');
                        assert.equal(banking.recordAppended, true);
                        const text = await nodeFs.readFile(`${workspace.root}/.flauz/evidence/ledger.jsonl`, 'utf-8');
                        const lines = text.split('\n').filter(line => line !== '');
                        assert.equal(lines.length, 1);
                        const mine = parseLedgerLine(lines[0] as string, 1);
                        const owning = productionParseLedgerLine(lines[0] as string, 1);
                        assert.equal(mine.ok, true);
                        assert.equal(owning.ok, true, `the W1 owning parser accepts the banked integrity row (${lines[0]})`);
                        if (mine.ok) {
                                assert.equal(mine.row.taskId, 'flauz-integrity');
                                assert.equal(mine.row.uri, '.flauz/integrity/ledger-fixture.json');
                                assert.equal(ledgerRowLine(mine.row), lines[0]);
                        }
                } finally {
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W2 contract pins: the product-root probe seam', () => {
        test('isProductRoot agrees with the W5 flauz-release probe on the real repo root and on a non-product root', async () => {
                assert.equal(await isProductRoot(repoRoot, fs), true);
                assert.equal(await releaseIsProductRoot(repoRoot, fs), true);
                const workspace = await bootFixtureWorkspace();
                try {
                        assert.equal(await isProductRoot(workspace.root, fs), false);
                        assert.equal(await releaseIsProductRoot(workspace.root, fs), false);
                } finally {
                        await workspace.cleanup();
                }
                const product = await bootFixtureProduct();
                try {
                        assert.equal(await isProductRoot(product.root, fs), true);
                        assert.equal(await releaseIsProductRoot(product.root, fs), true);
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-005-W2 contract pins: the bundle-manifest parser vs the REAL committed registry', () => {
        test('the REAL committed bundle-manifest parses: PINNED, manifestVersion 1, >= 16 bundles, every pin 64-hex (station-stable shape invariants)', async () => {
                const text = await nodeFs.readFile(joinPath(repoRoot, 'build/flauz/security/bundle-manifest.json'), 'utf-8');
                const parsed = parseBundleManifest(text);
                assert.equal(parsed.ok, true, `the real manifest parses (${parsed.ok ? '' : parsed.error})`);
                if (!parsed.ok) {
                        return;
                }
                assert.equal(parsed.manifest.status, 'PINNED');
                assert.ok(parsed.manifest.baseCommit !== null);
                const names = Object.keys(parsed.manifest.bundles);
                assert.ok(names.length >= 16, `the pinned set at this base carries at least the 16 integrated bundles (${String(names.length)} present; the station's post-landing regeneration adds this wave's own)`);
                const artifacts = pinnedArtifacts(parsed.manifest);
                assert.ok(artifacts.length >= 16);
                for (const artifact of artifacts) {
                        assert.match(artifact.pinnedSha256, /^[0-9a-f]{64}$/);
                        assert.ok(artifact.artifactPath.startsWith('extensions/'));
                }
                // the artifact enumeration is deterministic (sorted bundle-major, artifact sorted)
                const paths = artifacts.map(artifact => artifact.artifactPath);
                assert.deepEqual(paths, [...paths].sort());
        });

        test('the parser refuses the drift classes (wrong schema, wrong version, no bundles, bad pin, zero bundles)', () => {
                assert.equal(parseBundleManifest('{}').ok, false);
                assert.equal(parseBundleManifest('{ not json').ok, false);
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v2', manifestVersion: 1, status: 'PINNED', bundles: { a: { version: '0.1.0', artifacts: { 'dist/extension.js': 'a'.repeat(64) } } } })).ok, false);
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 2, status: 'PINNED', bundles: { a: { version: '0.1.0', artifacts: { 'dist/extension.js': 'a'.repeat(64) } } } })).ok, false);
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'PINNED', bundles: {} })).ok, false);
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'PINNED', bundles: { a: { version: '0.1.0', artifacts: { 'dist/extension.js': 'not-hex' } } } })).ok, false);
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'PINNED', bundles: { a: { version: '0.1.0', artifacts: {} } } })).ok, false);
                // the STATION-PENDING status parses (the worker-branch posture the station may carry)
                assert.equal(parseBundleManifest(JSON.stringify({ $schema: 'flauz.bundle-manifest/v1', manifestVersion: 1, status: 'STATION-PENDING', bundles: { a: { version: '0.1.0', artifacts: { 'dist/extension.js': 'a'.repeat(64) } } } })).ok, true);
        });
});

suite('A-PROD-005-W2 contract pins: the byte codecs', () => {
        test('base64 + hex round-trip against node:Buffer over varied payloads', () => {
                const payloads = [
                        new Uint8Array(0),
                        new Uint8Array([0x00, 0xff, 0x10]),
                        new TextEncoder().encode('flauz integrity'),
                        new Uint8Array(64).map((_, i) => (i * 13 + 5) & 0xff),  // an ed25519-signature-shaped payload
                ];
                for (const payload of payloads) {
                        assert.equal(bytesToBase64(payload), Buffer.from(payload).toString('base64'));
                        assert.deepEqual(base64ToBytes(bytesToBase64(payload)), payload);
                        assert.equal(bytesToHex(payload), Buffer.from(payload).toString('hex'));
                        assert.deepEqual(hexToBytes(bytesToHex(payload)), payload);
                }
                // the ed25519 signature encoding shape (64 bytes -> 88 base64 chars)
                assert.equal(bytesToBase64(new Uint8Array(64)).length, 88);
        });
});
