/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The sign suite (A-PROD-005-W2): the round-trip through the REAL ports
 * (real node:crypto ed25519, real fixture artifact bytes, pins re-derived at
 * fixture boot), the re-derivation law (the live hash is computed, never
 * trusted from the manifest -- proven by doctored-pin + post-boot-tamper
 * refusals), the fail-closed batch law (missing artifacts), the key lifecycle
 * (generated on first sign, loaded after), the determinism law (byte-identical
 * ledgers modulo the injected clock), and the census-visible banking.
 */

import * as assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import { suite, test } from 'mocha';

import { IntegrityError, KEY_STORE_PATH, base64ToBytes, joinPath, parseLedgerLine, ledgerRowLine } from '../src/api.ts';
import { runSign, persistLedger, ledgerStamp } from '../src/ledger.ts';
import { parseLedgerRecord } from '../src/verify.ts';

import { nodeIntegrityFs, steppingClock, realNodeKeyPort, deterministicKeyPort, bootFixtureProduct, bootFixtureWorkspace, readAllFiles, nodeSha256Hex, flipOneByte } from './helpers.ts';

const fs = nodeIntegrityFs();

suite('A-PROD-005-W2 sign: the round-trip through the real ports', () => {
        test('a fixture product signs: the ledger record binds path + RE-DERIVED hash + algorithm + fingerprint + signature + stamp', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, true);
                        assert.equal(result.artifactCount, 3);
                        const ledger = result.ledger;
                        assert.equal(ledger.$schema, 'flauz.integrity-ledger/v1');
                        assert.equal(ledger.schemaVersion, 0);
                        assert.equal(ledger.kind, 'flauz-integrity-ledger');
                        assert.equal(ledger.algorithm, 'ed25519');
                        assert.equal(ledger.keyPosture, 'local-dev');
                        assert.equal(ledger.manifestStatus, 'PINNED');
                        assert.equal(ledger.entries.length, 3);
                        // the entries are sorted (bundle-major, artifact sorted -- the deterministic enumeration)
                        assert.deepEqual(ledger.entries.map(entry => entry.artifactPath), [
                                'extensions/flauz-alpha/dist/extension.js',
                                'extensions/flauz-beta/dist/extension.js',
                                'extensions/flauz-gamma/dist/extension.js',
                        ]);
                        for (const entry of ledger.entries) {
                                // the re-derivation law: the entry hash is the LIVE hash of the real bytes (pinned against node:crypto independently)
                                const bytes = await fs.readFileBytes(joinPath(product.root, entry.artifactPath));
                                assert.ok(bytes !== undefined);
                                assert.equal(entry.sha256, nodeSha256Hex(bytes));
                                assert.equal(entry.pinnedSha256, entry.sha256, 'the fixture pins are the real hashes of the real bytes');
                                // the signature is a real ed25519 detached signature (64 bytes -> 88 base64 chars)
                                const sig = base64ToBytes(entry.signature);
                                assert.equal(sig.length, 64);
                                assert.equal(entry.signature.length, 88);
                        }
                        assert.match(ledger.publicKey, /^[0-9a-f]{64}$/);
                        assert.match(ledger.keyFingerprint, /^[0-9a-f]{64}$/);
                        assert.match(ledger.chain.ledgerSha256, /^[0-9a-f]{64}$/);
                        assert.equal(base64ToBytes(ledger.chain.signature).length, 64);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the persisted ledger file round-trips: DL-9 serialization on disk + the strict parser accepts it', async () => {
                const product = await bootFixtureProduct({ extraBundle: true });
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        const persisted = await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, result.ledger);
                        assert.ok(persisted.recordPath.endsWith(`ledger-${ledgerStamp(result.ledger.createdAt)}.json`));
                        const text = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(text !== undefined);
                        // the strict parser accepts the on-disk body
                        const parsed = parseLedgerRecord(JSON.parse(text));
                        assert.ok(parsed !== undefined, 'the persisted ledger parses back through the strict parser');
                        // DL-9: sorted keys, 2-space indent, exactly one trailing newline
                        assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
                        assert.match(text, /^\{\n {2}"\$schema"/);
                        // byte-identical re-serialization through the owning serializer (the canonical round-trip)
                        const { serializeArtifact } = await import('../src/api.ts');
                        assert.equal(serializeArtifact(JSON.parse(text)), text);
                        const roundTrip = JSON.parse(text) as Record<string, unknown>;
                        const keys = Object.keys(roundTrip);
                        assert.deepEqual([...keys].sort(), keys, 'the record keys are serialized in sorted order');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the manifest digest binds the manifest bytes actually read', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        const manifestBytes = await fs.readFileBytes(joinPath(product.root, 'build/flauz/security/bundle-manifest.json'));
                        assert.ok(manifestBytes !== undefined);
                        assert.equal(result.ledger.manifestDigest, nodeSha256Hex(manifestBytes));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the self-chain verifies and catches any ledger edit (the tamper-evident chain)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        // green: the self-signature verifies against the ledger's public key through the port
                        const { canonicalJson, utf8Bytes, sha256Hex } = await import('../src/api.ts');
                        const chainFree = canonicalJson({
                                $schema: result.ledger.$schema, schemaVersion: result.ledger.schemaVersion, kind: result.ledger.kind,
                                createdAt: result.ledger.createdAt, extensionId: result.ledger.extensionId, manifestPath: result.ledger.manifestPath,
                                manifestDigest: result.ledger.manifestDigest, manifestStatus: result.ledger.manifestStatus, algorithm: result.ledger.algorithm,
                                keyPosture: result.ledger.keyPosture, keyFingerprint: result.ledger.keyFingerprint, publicKey: result.ledger.publicKey,
                                entries: result.ledger.entries,
                        });
                        assert.equal(sha256Hex(chainFree), result.ledger.chain.ledgerSha256, 'the self-hash re-derives over the chain-free canonical bytes');
                        assert.equal(await keys.verifyBytes(utf8Bytes(chainFree), base64ToBytes(result.ledger.chain.signature), result.ledger.publicKey), true, 'the self-signature verifies');
                        // tampered: one flipped character in an entry's signature breaks the chain
                        const doctored = JSON.parse(JSON.stringify(result.ledger)) as { entries: { signature: string }[]; chain: { ledgerSha256: string } };
                        const sig = doctored.entries[0]?.signature as string;
                        doctored.entries[0].signature = (sig.slice(0, 4) + (sig[4] === 'A' ? 'B' : 'A') + sig.slice(5));
                        const doctoredFree = canonicalJson({ ...doctored, chain: undefined });
                        assert.notEqual(sha256Hex(doctoredFree), doctored.chain.ledgerSha256, 'any ledger edit breaks the self-hash (the chain catches it)');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W2 sign: the re-derivation law (never trust the manifest)', () => {
        test('a doctored pin = the typed PIN_MISMATCH refusal (the signing plane never signs unpinned bytes)', async () => {
                const product = await bootFixtureProduct({ wrongPin: true });
                const workspace = await bootFixtureWorkspace();
                try {
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() }),
                                (err: unknown) => {
                                        assert.ok(err instanceof IntegrityError);
                                        assert.equal(err.code, 'FLAUZ_INTEGRITY_PIN_MISMATCH');
                                        assert.ok(err.message.includes('flauz-beta'));
                                        return true;
                                },
                        );
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('an artifact tampered AFTER fixture boot = the typed PIN_MISMATCH refusal (the live hash is computed, not trusted)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const bytes = await fs.readFileBytes(joinPath(product.root, 'extensions/flauz-gamma/dist/extension.js'));
                        assert.ok(bytes !== undefined);
                        await nodeFs.writeFile(path.join(product.root, 'extensions/flauz-gamma/dist/extension.js'), flipOneByte(bytes));
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() }),
                                (err: unknown) => {
                                        assert.ok(err instanceof IntegrityError);
                                        assert.equal(err.code, 'FLAUZ_INTEGRITY_PIN_MISMATCH');
                                        assert.ok(err.message.includes('flauz-gamma'));
                                        return true;
                                },
                        );
                        // and NOTHING was written: the fail-closed batch law (no partial ledger)
                        const files = await readAllFiles(joinPath(workspace.root, '.flauz'));
                        assert.equal(files.filter(file => file.path.includes('ledger-')).length, 0, 'a refused sign writes no ledger');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a pinned artifact with no bytes = the typed ARTIFACT_MISSING refusal (the pre-install tree truth)', async () => {
                const product = await bootFixtureProduct({ missingArtifact: true });
                const workspace = await bootFixtureWorkspace();
                try {
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() }),
                                (err: unknown) => {
                                        assert.ok(err instanceof IntegrityError);
                                        assert.equal(err.code, 'FLAUZ_INTEGRITY_ARTIFACT_MISSING');
                                        assert.ok(err.message.includes('extensions/flauz-beta/dist/extension.js'));
                                        return true;
                                },
                        );
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('no manifest / unparseable manifest = the typed NO_MANIFEST / MANIFEST_FORMAT refusals', async () => {
                const noManifest = await bootFixtureProduct({ noManifest: true });
                const torn = await bootFixtureProduct({ unparseableManifest: true });
                const workspace = await bootFixtureWorkspace();
                try {
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: noManifest.root, fs, clock: steppingClock(), keys: realNodeKeyPort() }),
                                (err: unknown) => err instanceof IntegrityError && err.code === 'FLAUZ_INTEGRITY_NO_MANIFEST',
                        );
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: torn.root, fs, clock: steppingClock(), keys: realNodeKeyPort() }),
                                (err: unknown) => err instanceof IntegrityError && err.code === 'FLAUZ_INTEGRITY_MANIFEST_FORMAT',
                        );
                } finally {
                        await noManifest.cleanup();
                        await torn.cleanup();
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W2 sign: the key lifecycle + the determinism law', () => {
        test('the key is GENERATED on first sign and LOADED on the second (same fingerprint, the store is the port\'s)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        const first = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        assert.equal(first.keyStatus, 'generated');
                        const second = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        assert.equal(second.keyStatus, 'loaded');
                        assert.equal(second.ledger.keyFingerprint, first.ledger.keyFingerprint);
                        assert.equal(second.ledger.publicKey, first.ledger.publicKey);
                        // the store exists at the port-owned path
                        const storeText = await fs.readFileUtf8(joinPath(workspace.root, KEY_STORE_PATH));
                        assert.ok(storeText !== undefined, 'the key store was written at the port-owned path');
                        const store = JSON.parse(storeText) as Record<string, unknown>;
                        assert.equal(store.$schema, 'flauz.integrity-keystore/v1');
                        assert.equal(store.publicKeyHex, first.ledger.publicKey);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a torn key store = the typed KEY_STORE refusal (never a silent regeneration over a suspect store)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const keys = realNodeKeyPort();
                        await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys });
                        await nodeFs.writeFile(path.join(workspace.root, KEY_STORE_PATH), '{ torn store', 'utf-8');
                        await assert.rejects(
                                runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys }),
                                (err: unknown) => err instanceof IntegrityError && err.code === 'FLAUZ_INTEGRITY_KEY_STORE',
                        );
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the determinism law: identical inputs -> BYTE-IDENTICAL ledgers (modulo the injected clock)', async () => {
                const productA = await bootFixtureProduct();
                const productB = await bootFixtureProduct();
                const workspaceA = await bootFixtureWorkspace();
                const workspaceB = await bootFixtureWorkspace();
                try {
                        // identical deterministic keys + identical clock sequences
                        const resultA = await runSign({ root: workspaceA.root, productRoot: productA.root, fs, clock: steppingClock(), keys: deterministicKeyPort('determinism-law') });
                        const resultB = await runSign({ root: workspaceB.root, productRoot: productB.root, fs, clock: steppingClock(), keys: deterministicKeyPort('determinism-law') });
                        const persistedA = await persistLedger({ root: workspaceA.root, fs, clock: steppingClock() }, resultA.ledger);
                        const persistedB = await persistLedger({ root: workspaceB.root, fs, clock: steppingClock() }, resultB.ledger);
                        const textA = await fs.readFileUtf8(persistedA.recordPath);
                        const textB = await fs.readFileUtf8(persistedB.recordPath);
                        assert.ok(textA !== undefined && textB !== undefined);
                        assert.equal(textA, textB, 'byte-identical ledger records (ed25519 is deterministic; the clock sequence was identical)');
                        // a DIFFERENT clock = only the timestamps + the chain (whose input embeds them) differ
                        const resultC = await runSign({ root: workspaceA.root, productRoot: productA.root, fs, clock: steppingClock(1_740_200_000_000), keys: deterministicKeyPort('determinism-law') });
                        const strip = (record: typeof resultA.ledger): string => {
                                const copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
                                copy.createdAt = 0;
                                delete copy.chain; // the chain's hash + signature embed createdAt by construction (the self-hash input); its determinism rides the identical-clock proof above
                                const entries = copy.entries as Record<string, unknown>[];
                                for (const entry of entries) {
                                        entry.signedAt = 0;
                                }
                                return JSON.stringify(copy);
                        };
                        assert.equal(strip(resultC.ledger), strip(resultA.ledger), 'modulo the injected clock, the chain-free records are identical');
                        // the entry signatures themselves are timestamp-free inputs -- identical across clocks
                        assert.deepEqual(resultC.ledger.entries.map(entry => entry.signature), resultA.ledger.entries.map(entry => entry.signature));
                } finally {
                        await productA.cleanup();
                        await productB.cleanup();
                        await workspaceA.cleanup();
                        await workspaceB.cleanup();
                }
        });
});

suite('A-PROD-005-W2 sign: the census-visible banking', () => {
        test('the persisted ledger banks an evidence row (taskId flauz-integrity, uri = the record path) + resyncs the watermark', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace({ withEvidence: true });
                try {
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        const persisted = await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, result.ledger);
                        assert.equal(persisted.banking.recordAppended, true);
                        assert.equal(persisted.banking.watermarkUpdated, true);
                        const ledgerText = await fs.readFileUtf8(joinPath(workspace.root, '.flauz/evidence/ledger.jsonl'));
                        assert.ok(ledgerText !== undefined);
                        const lines = ledgerText.split('\n').filter(line => line !== '');
                        assert.equal(lines.length, 2, 'the pre-existing row + the banked integrity row');
                        const banked = parseLedgerLine(lines[1] as string, 2);
                        assert.equal(banked.ok, true);
                        if (banked.ok) {
                                assert.equal(banked.row.taskId, 'flauz-integrity');
                                assert.equal(banked.row.kind, 'note');
                                assert.equal(banked.row.uri, `.flauz/integrity/ledger-${ledgerStamp(result.ledger.createdAt)}.json`);
                                assert.equal(ledgerRowLine(banked.row), lines[1], 'the banked row round-trips canonically');
                        }
                        const watermarkText = await fs.readFileUtf8(joinPath(workspace.root, '.flauz/evidence/size.json'));
                        assert.ok(watermarkText !== undefined);
                        const watermark = JSON.parse(watermarkText) as Record<string, unknown>;
                        assert.equal(watermark.rowCount, 2);
                        assert.equal(watermark.$schema, 'flauz.evidence.size/v1');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('without a pre-existing watermark the banking appends but does not invent one', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        const persisted = await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, result.ledger);
                        assert.equal(persisted.banking.recordAppended, true);
                        assert.equal(persisted.banking.watermarkUpdated, false);
                        const watermarkText = await fs.readFileUtf8(joinPath(workspace.root, '.flauz/evidence/size.json'));
                        assert.equal(watermarkText, undefined, 'no watermark existed; none was invented');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});
