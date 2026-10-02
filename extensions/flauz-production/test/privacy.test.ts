/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The canary sweep (A-PROD-005-W1): no secret-shaped value in ANY metadata
 * surface this extension produces -- the census record, the matrix
 * artifact, the gate record, the banked ledger rows, the command renders.
 *
 * The fixtures plant secret-shaped values (assembled from fragments at
 * runtime, the no-literal law) into (a) record-shaped objects directly
 * (the sweep refuses), (b) a fixture product's manifest description (the
 * readers must PROJECT SHAPES ONLY -- the planted canary must never reach a
 * record), and (c) a full census/matrix/gate run whose every written byte
 * is scanned.
 */

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { ProductionError } from '../src/api.ts';
import { runCensus, persistCensus, renderCensus } from '../src/census.ts';
import { runMatrix, persistMatrix } from '../src/matrix.ts';
import { runGate, persistGate, renderGate } from '../src/gate.ts';

import { nodeProductionFs, steppingClock, bootFixtureProduct, bootFixtureWorkspace, bootFixtureInstall, runtimePortFor, absentRuntimePort, fixtureVersions, readAllFiles, canaryToken } from './helpers.ts';

const fs = nodeProductionFs();
const clock = steppingClock();

suite('A-PROD-005-W1 canary sweep: the pattern battery', () => {
        test('every known credential shape is detected (assembled from fragments at runtime)', () => {
                assert.equal(looksSecretShaped(canaryToken('github')), true);
                assert.equal(looksSecretShaped(canaryToken('openai')), true);
                assert.equal(looksSecretShaped(canaryToken('aws')), true);
                assert.equal(looksSecretShaped(canaryToken('bearer')), true);
                assert.equal(looksSecretShaped(`-----BEGIN RSA PRIVATE KEY-----`), true);
        });

        test('ordinary metadata values are NOT secret-shaped (paths, hashes, versions, verdicts)', () => {
                assert.equal(looksSecretShaped('.flauz/production/census-20260101T000000.000Z.json'), false);
                assert.equal(looksSecretShaped('a'.repeat(64)), false);
                assert.equal(looksSecretShaped('0.1.0'), false);
                assert.equal(looksSecretShaped('flauz.flauz-production'), false);
                assert.equal(looksSecretShaped('extensions/flauz-beta/package.json'), false);
        });
});

suite('A-PROD-005-W1 canary sweep: the fail-closed refusal', () => {
        test('a census record carrying a secret-shaped value is refused (typed FLAUZ_PRODUCTION_SECRET_SHAPED)', () => {
                const record = { $schema: 'flauz.production-census/v1', ok: true, installedExtensionIds: ['flauz.flauz-alpha'], checks: [{ check: 'installed', verdict: 'green', reasons: [canaryToken('github')], counts: {} }] };
                assert.throws(() => sweepArtifact(record, 'census-record'), (err: unknown) => {
                        assert.ok(err instanceof ProductionError);
                        assert.equal(err.code, 'FLAUZ_PRODUCTION_SECRET_SHAPED');
                        assert.ok(err.message.includes('census-record'));
                        return true;
                });
        });

        test('a matrix artifact + a gate record carrying secret-shaped values are refused', () => {
                assert.throws(() => sweepArtifact({ rows: [{ id: 'backup-export', unsupported: canaryToken('openai') }] }, 'matrix-artifact'), /FLAUZ_PRODUCTION_SECRET_SHAPED|secret-shaped/);
                assert.throws(() => sweepArtifact({ rows: [{ id: 'secretHandling', reasons: [canaryToken('aws')] }] }, 'gate-record'), /FLAUZ_PRODUCTION_SECRET_SHAPED|secret-shaped/);
        });

        test('the sweep deep-walks nested structures (a canary inside counts, inside arrays, inside keys\' values)', () => {
                assert.throws(() => sweepArtifact({ counts: { detail: [canaryToken('bearer')] } }, 'x'), /secret-shaped/);
                assert.throws(() => sweepArtifact({ a: { b: { c: { d: canaryToken('github') } } } }, 'x'), /secret-shaped/);
                sweepArtifact({ a: { b: { c: { d: 'ordinary' } } }, e: [1, 2, 3] }, 'x'); // ordinary values pass clean
        });
});

suite('A-PROD-005-W1 canary sweep: the full-run byte scan (the metadata law over real runs)', () => {
        test('a canary planted in the product manifests NEVER reaches the census record (the readers project shapes only)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ canaryInManifest: ` token ${canaryToken('github')} ends` });
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runCensus({ root: workspace.root, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        const persisted = await persistCensus({ root: workspace.root, fs, clock }, fixtureVersions(), result);
                        const recordText = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(recordText !== undefined);
                        assert.ok(!recordText.includes(canaryToken('github')), 'the census record never carries the manifest-description canary');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('a full census + matrix + gate run over a canary-bearing product writes ZERO secret-shaped bytes (every artifact + the ledger + the renders scanned)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ canaryInManifest: ` token ${canaryToken('openai')} ends` });
                const workspace = await bootFixtureWorkspace();
                try {
                        const census = await runCensus({ root: workspace.root, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        const persistedCensus = await persistCensus({ root: workspace.root, fs, clock }, fixtureVersions(), census);
                        const matrix = await runMatrix({ root: workspace.root, fs, clock, productRoot: product.root });
                        const persistedMatrix = await persistMatrix({ root: workspace.root, fs, clock }, fixtureVersions(), matrix);
                        const gate = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const persistedGate = await persistGate({ root: workspace.root, fs, clock }, fixtureVersions(), gate);

                        // the renders (the command-surface byte scan: the channel lines are produced from the same data)
                        const renderedLines = [...renderCensus(census), ...renderGate(gate)];
                        for (const line of renderedLines) {
                                assert.ok(!looksSecretShaped(line), `a render line is never secret-shaped (${line.slice(0, 80)})`);
                                assert.ok(!line.includes(canaryToken('openai')), 'a render line never carries the planted canary');
                        }

                        // every written byte under .flauz/ (the records + the ledger + the watermark)
                        const files = await readAllFiles(`${workspace.root}/.flauz`);
                        assert.ok(files.length >= 3, `the run wrote its artifacts + the banked ledger (${String(files.length)} files)`);
                        for (const file of files) {
                                assert.ok(!file.text.includes(canaryToken('openai')), `${file.path} carries no secret-shaped value`);
                                assert.ok(!looksSecretShaped(file.text), `${file.path} as a whole is not secret-shaped`);
                        }
                        // the three artifacts exist and are swept-clean by construction (the sweep ran pre-write; the byte scan proves it)
                        assert.ok(persistedCensus.recordPath.endsWith('.json'));
                        assert.ok(persistedMatrix.artifactPath.endsWith('.json'));
                        assert.ok(persistedGate.recordPath.endsWith('.json'));
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the gate\'s red rows (the failure fixtures\' reasons) stay canary-clean too', async () => {
                const product = await bootFixtureProduct({ noBundleManifest: true });
                const workspace = await bootFixtureWorkspace({ corruptTelemetry: true, tornMarker: true, futureTasks: true });
                try {
                        const gate = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const persisted = await persistGate({ root: workspace.root, fs, clock }, fixtureVersions(), gate);
                        const text = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(text !== undefined);
                        assert.ok(!looksSecretShaped(text), 'the failing gate record is canary-clean');
                        assert.equal(persisted.record.verdict, 'NOT-PRODUCTION-READY');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});
