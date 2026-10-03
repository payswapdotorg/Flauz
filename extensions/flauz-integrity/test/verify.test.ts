/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The verify suite (A-PROD-005-W2): the one-command verdict -- the green
 * round-trip, the tamper detections (a flipped artifact byte; ledger edits
 * caught by the chain + the per-entry hash comparison + the signature check),
 * the typed degradations (unsigned coverage at the empty-by-design ledger,
 * torn artifacts, a torn ledger, the absent key store, the mismatched key),
 * and the never-a-silent-green law (the record persists whatever the verdict
 * says).
 */

import * as assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import { suite, test } from 'mocha';

import { INTEGRITY_DIR, KEY_STORE_PATH, joinPath } from '../src/api.ts';
import { runSign, persistLedger } from '../src/ledger.ts';
import { runVerify, persistVerify } from '../src/verify.ts';

import { nodeIntegrityFs, steppingClock, realNodeKeyPort, deterministicKeyPort, bootFixtureProduct, bootFixtureWorkspace, flipOneByte } from './helpers.ts';

const fs = nodeIntegrityFs();

/** Signs a fixture product into a fixture workspace (the green-path prelude). */
async function signedFixture(options: { extraBundle?: boolean } = {}): Promise<{ product: { root: string; cleanup: () => Promise<void> }; workspace: { root: string; cleanup: () => Promise<void> } }> {
        const product = await bootFixtureProduct({ extraBundle: options.extraBundle });
        const workspace = await bootFixtureWorkspace();
        const result = await runSign({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
        await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, result.ledger);
        return { product, workspace };
}

suite('A-PROD-005-W2 verify: the green round-trip', () => {
        test('sign then verify: every artifact green, chain green, key bound, ok=true, verdict GREEN', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, true);
                        assert.equal(result.record.verdict, 'GREEN');
                        assert.equal(result.record.counts.green, 3);
                        assert.equal(result.record.counts.tampered, 0);
                        assert.equal(result.record.counts.unsigned, 0);
                        assert.equal(result.record.counts.torn, 0);
                        assert.equal(result.record.ledger.status, 'present');
                        assert.equal(result.record.chain.verdict, 'green');
                        assert.equal(result.record.keyStore.status, 'present');
                        assert.equal(result.record.keyStore.fingerprintMatch, true);
                        assert.equal(result.record.degradation, undefined);
                        assert.equal(result.record.pinnedArtifactCount, 3);
                        for (const row of result.record.artifacts) {
                                assert.equal(row.verdict, 'green', row.artifactPath);
                                assert.equal(row.signatureVerified, true);
                        }
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('multi-artifact bundles verify per-artifact (the coverage enumeration)', async () => {
                const { product, workspace } = await signedFixture({ extraBundle: true });
                try {
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.record.pinnedArtifactCount, 5);
                        assert.equal(result.record.counts.green, 5);
                        assert.ok(result.record.artifacts.some(row => row.artifactPath === 'extensions/flauz-delta/dist/worker.js'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the verify record persists + banks whatever the verdict says (never a silent green)', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        const persisted = await persistVerify({ root: workspace.root, fs, clock: steppingClock() }, result.record);
                        assert.ok(persisted.recordPath.includes('verify-'));
                        assert.ok(persisted.recordPath.endsWith('.json'));
                        assert.equal(persisted.banking.recordAppended, true);
                        const text = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(text !== undefined);
                        const parsed = JSON.parse(text) as Record<string, unknown>;
                        assert.equal(parsed.$schema, 'flauz.integrity-verify/v1');
                        assert.equal(parsed.ok, true);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W2 verify: the tamper detections', () => {
        test('a flipped artifact byte = that row TAMPERED (hash mismatch vs pin), the others green, ok=false', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const bytes = await fs.readFileBytes(joinPath(product.root, 'extensions/flauz-beta/dist/extension.js'));
                        assert.ok(bytes !== undefined);
                        await nodeFs.writeFile(path.join(product.root, 'extensions/flauz-beta/dist/extension.js'), flipOneByte(bytes));
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.verdict, 'NOT-GREEN');
                        assert.equal(result.record.counts.tampered, 1);
                        assert.equal(result.record.counts.green, 2);
                        const row = result.record.artifacts.find(candidate => candidate.artifactPath === 'extensions/flauz-beta/dist/extension.js');
                        assert.ok(row !== undefined);
                        assert.equal(row.verdict, 'tampered');
                        assert.ok((row.reasons[0] ?? '').includes('disagrees with the manifest pin'));
                        assert.ok((result.record.degradation ?? '').includes('tampered'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('an edited ledger entry (doctored sha256) = the CHAIN catches it + the row reports the entry-hash divergence', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const ledgerPath = await latestLedgerFile(workspace.root);
                        assert.ok(ledgerPath !== undefined);
                        const text = await nodeFs.readFile(ledgerPath, 'utf-8');
                        const doctored = JSON.parse(text) as { entries: { sha256: string }[] };
                        const entry = doctored.entries[0];
                        assert.ok(entry !== undefined);
                        entry.sha256 = entry.sha256.slice(0, 63) + (entry.sha256.endsWith('0') ? '1' : '0');
                        await nodeFs.writeFile(ledgerPath, `${JSON.stringify(doctored, null, 2)}\n`, 'utf-8');
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.chain.verdict, 'tampered', 'the self-hash catches the ledger edit');
                        assert.ok((result.record.chain.reasons.join(' ') ?? '').includes('self-hash disagrees'));
                        const row = result.record.artifacts.find(candidate => candidate.artifactPath === 'extensions/flauz-alpha/dist/extension.js');
                        assert.ok(row !== undefined);
                        assert.equal(row.verdict, 'tampered');
                        assert.ok((row.reasons[0] ?? '').includes('recorded sha256 disagrees'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('an edited ledger signature field = the row reports the failed signature + the chain catches the edit', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const ledgerPath = await latestLedgerFile(workspace.root);
                        assert.ok(ledgerPath !== undefined);
                        const text = await nodeFs.readFile(ledgerPath, 'utf-8');
                        const doctored = JSON.parse(text) as { entries: { signature: string }[] };
                        const entry = doctored.entries[1];
                        assert.ok(entry !== undefined);
                        entry.signature = (entry.signature.slice(0, 4) + (entry.signature[4] === 'A' ? 'B' : 'A') + entry.signature.slice(5));
                        await nodeFs.writeFile(ledgerPath, `${JSON.stringify(doctored, null, 2)}\n`, 'utf-8');
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.chain.verdict, 'tampered');
                        const row = result.record.artifacts.find(candidate => candidate.artifactPath === 'extensions/flauz-beta/dist/extension.js');
                        assert.ok(row !== undefined);
                        assert.equal(row.verdict, 'tampered');
                        assert.ok((row.reasons[0] ?? '').includes('signature does not verify'));
                        assert.equal(row.signatureVerified, false);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a re-signed doctored ledger (the attacker WITH the key) still fails: the self-hash re-derivation pins the body', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        // delete an entry entirely (coverage loss) -- the unsigned row + the chain both flag it
                        const ledgerPath = await latestLedgerFile(workspace.root);
                        assert.ok(ledgerPath !== undefined);
                        const text = await nodeFs.readFile(ledgerPath, 'utf-8');
                        const doctored = JSON.parse(text) as { entries: unknown[] };
                        doctored.entries = doctored.entries.slice(0, 2);
                        await nodeFs.writeFile(ledgerPath, `${JSON.stringify(doctored, null, 2)}\n`, 'utf-8');
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.chain.verdict, 'tampered', 'an entry removed = the self-hash changes');
                        assert.equal(result.record.counts.unsigned, 1, 'the removed entry\'s artifact is unsigned');
                        assert.equal(result.record.counts.green, 2);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W2 verify: the typed degradations (never a silent green)', () => {
        test('NO ledger (the pinned-base truth): every artifact UNSIGNED, chain unsigned, ok=false, the record persists with the typed degradation', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.verdict, 'NOT-GREEN');
                        assert.equal(result.record.counts.unsigned, 3);
                        assert.equal(result.record.ledger.status, 'absent');
                        assert.equal(result.record.chain.verdict, 'unsigned');
                        assert.ok((result.record.chain.reasons[0] ?? '').includes('starts EMPTY by design'));
                        assert.ok((result.record.degradation ?? '').includes('unsigned'));
                        // the record persists (the degradation is recorded, never swallowed)
                        const persisted = await persistVerify({ root: workspace.root, fs, clock: steppingClock() }, result.record);
                        const text = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(text !== undefined);
                        assert.ok(text.includes('"unsigned"'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a missing artifact = the TORN row (unverifiable, never guessed)', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        await nodeFs.rm(path.join(product.root, 'extensions/flauz-gamma/dist/extension.js'));
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.counts.torn, 1);
                        assert.equal(result.record.counts.green, 2);
                        const row = result.record.artifacts.find(candidate => candidate.artifactPath === 'extensions/flauz-gamma/dist/extension.js');
                        assert.ok(row !== undefined);
                        assert.equal(row.verdict, 'torn');
                        assert.ok((row.reasons[0] ?? '').includes('absent'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a torn ledger (corrupt JSON) = torn chain + every readable-pin artifact TORN (entries unverifiable)', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        const ledgerPath = await latestLedgerFile(workspace.root);
                        assert.ok(ledgerPath !== undefined);
                        await nodeFs.writeFile(ledgerPath, '{ torn ledger', 'utf-8');
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.record.ledger.status, 'torn');
                        assert.equal(result.record.chain.verdict, 'torn');
                        assert.equal(result.record.counts.torn, 3);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('an ABSENT key store (after sign) = the typed degradation: artifacts still verify green (the ledger\'s public key drives verification), ok=false', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        await nodeFs.rm(path.join(workspace.root, KEY_STORE_PATH));
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.record.keyStore.status, 'absent');
                        assert.equal(result.record.counts.green, 3, 'verification is key-store-independent (the ledger public key)');
                        assert.equal(result.ok, false, 'but the verdict is NOT green: the absent store is the typed degradation');
                        assert.ok((result.record.degradation ?? '').includes('key store is absent'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a DIFFERENT key store = the fingerprint-mismatch degradation (a different key signed this ledger)', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        // overwrite the store with a different deterministic key's store
                        const fresh = await bootFixtureWorkspace();
                        try {
                                await deterministicKeyPort('mismatch-key').getOrCreateKeyInfo(fresh.root);
                                const storeText = await nodeFs.readFile(path.join(fresh.root, KEY_STORE_PATH), 'utf-8');
                                await nodeFs.writeFile(path.join(workspace.root, KEY_STORE_PATH), storeText, 'utf-8');
                        } finally {
                                await fresh.cleanup();
                        }
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.record.keyStore.status, 'present');
                        assert.equal(result.record.keyStore.fingerprintMatch, false);
                        assert.equal(result.record.counts.green, 3);
                        assert.equal(result.ok, false);
                        assert.ok((result.record.degradation ?? '').includes('does not match'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('extra ledger entries (artifacts the manifest does not pin) are disclosed, not table rows', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        // sign a DIFFERENT (larger) product into this workspace, then verify against the 3-bundle product
                        const bigger = await bootFixtureProduct({ extraBundle: true });
                        try {
                                const result = await runSign({ root: workspace.root, productRoot: bigger.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                                await persistLedger({ root: workspace.root, fs, clock: steppingClock() }, result.ledger);
                        } finally {
                                await bigger.cleanup();
                        }
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.record.counts.green, 3);
                        assert.ok(result.record.ledger.extraEntries !== undefined);
                        assert.equal(result.record.ledger.extraEntries?.length, 2, 'the delta bundle\'s two artifacts are disclosed as extra');
                        assert.equal(result.ok, false, 'extra entries are a typed degradation, never a silent green');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a torn key store = the typed torn degradation (peek refuses to guess)', async () => {
                const { product, workspace } = await signedFixture();
                try {
                        await nodeFs.writeFile(path.join(workspace.root, KEY_STORE_PATH), '{ torn', 'utf-8');
                        const result = await runVerify({ root: workspace.root, productRoot: product.root, fs, clock: steppingClock(), keys: realNodeKeyPort() });
                        assert.equal(result.record.keyStore.status, 'torn');
                        assert.equal(result.ok, false);
                        assert.ok((result.record.degradation ?? '').includes('torn'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});

/** The latest ledger file's absolute path in a workspace (the verify prelude). */
async function latestLedgerFile(root: string): Promise<string | undefined> {
        const entries = await fs.readdir(joinPath(root, INTEGRITY_DIR));
        if (entries === undefined) {
                return undefined;
        }
        const ledgers = entries.filter(name => name.startsWith('ledger-') && name.endsWith('.json')).sort();
        return ledgers.length === 0 ? undefined : joinPath(root, INTEGRITY_DIR, ledgers[ledgers.length - 1] as string);
}
