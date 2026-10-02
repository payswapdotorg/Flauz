/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The installed-product census semantics (A-PROD-005-W1): the
 * installed-vs-repo parity over fixture installed-products constructed
 * through the product-root ports (real manifest trees), the five typed
 * check classes, the absent/empty-product typed degradations, the record
 * persistence + census-visible banking, and the REAL-REPO local-real
 * receipt.
 */

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import { runCensus, persistCensus, renderCensus, censusChecks, type CensusCheckClass } from '../src/census.ts';
import { nodeProductionFs, steppingClock, repoRoot, bootFixtureInstall, bootFixtureProduct, bootFixtureWorkspace, runtimePortFor, absentRuntimePort, emptyRuntimePort, explicitRuntimePort, fixtureVersions } from './helpers.ts';

const fs = nodeProductionFs();
const clock = steppingClock();

function verdictOf(checks: readonly { check: CensusCheckClass | string; verdict: string }[], check: string): string | undefined {
        return checks.find(entry => entry.check === check)?.verdict;
}

suite('A-PROD-005-W1 installed-product census: the five check classes', () => {
        test('a consistent fixture install over a matching fixture registry is GREEN across all five classes', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
                        assert.equal(result.degradation, undefined);
                        assert.equal(result.checks.length, 5);
                        assert.equal(verdictOf(result.checks, 'installed'), 'green');
                        assert.equal(verdictOf(result.checks, 'laws'), 'green');
                        assert.equal(verdictOf(result.checks, 'presence'), 'green');
                        assert.equal(verdictOf(result.checks, 'parity'), 'green');
                        assert.equal(verdictOf(result.checks, 'sbom'), 'green');
                        assert.deepEqual(result.installed?.extensions.map(extension => extension.id).sort(), ['flauz.flauz-alpha', 'flauz.flauz-beta']);
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a missing dist-tree manifest is the TORN installed class (an incomplete install)', async () => {
                const install = await bootFixtureInstall({ missingManifest: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'installed'), 'torn');
                        assert.ok(result.checks.find(entry => entry.check === 'installed')?.reasons.some(reason => reason.includes('flauz-beta')), 'the reason names the extension');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('an unparseable dist-tree manifest is the TORN installed class', async () => {
                const install = await bootFixtureInstall({ unparseableManifest: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'installed'), 'torn');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a runtime-vs-disk VERSION disagreement is the TAMPERED installed class (the runtime loaded 0.1.0, the tree declares 9.9.9)', async () => {
                const install = await bootFixtureInstall({ versionMismatch: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root, install.loadedVersions) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'installed'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'installed')?.reasons.some(reason => reason.includes('9.9.9')), 'the reason names the declared version');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a foreign publisher in the dist tree is the TAMPERED installed + laws classes', async () => {
                const install = await bootFixtureInstall({ publisherMismatch: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'installed'), 'tampered');
                        assert.equal(verdictOf(result.checks, 'laws'), 'tampered');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test("'*' activation in an installed manifest is the TAMPERED laws class (R1)", async () => {
                const install = await bootFixtureInstall({ wildcardActivation: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'laws'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'laws')?.reasons.some(reason => reason.includes("'*'")), "the reason names the '*' rule");
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a missing entrypoint in an installed manifest is the TAMPERED laws class', async () => {
                const install = await bootFixtureInstall({ missingMain: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'laws'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'laws')?.reasons.some(reason => reason.includes('no main and no browser')), 'the reason names the entrypoint law');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('an expected extension the runtime did NOT load is the TORN presence class (incomplete install)', async () => {
                const install = await bootFixtureInstall({ skipBeta: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'presence'), 'torn');
                        assert.equal(verdictOf(result.checks, 'parity'), 'torn'); // the parity surface has no installed extension either
                        assert.equal(verdictOf(result.checks, 'sbom'), 'torn');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('an installed extension named by NO registry surface is the TAMPERED presence class, disclosed with the exact id', async () => {
                const install = await bootFixtureInstall({ unknownExtension: true });
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        const presence = result.checks.find(entry => entry.check === 'presence');
                        assert.equal(presence?.verdict, 'tampered');
                        assert.ok(presence?.reasons.some(reason => reason.includes('flauz-gamma') && reason.includes('unknown extension')), 'the reason discloses the unknown id');
                        assert.equal(presence?.counts.unexpectedCount, 1);
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('an installed extension with no parity rows is the TAMPERED parity class (PP2)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ uncoveredExtension: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'parity'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'parity')?.reasons.some(reason => reason.includes('no packaging-parity rows')), 'the reason names PP2');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a posture row that no longer re-derives is the TAMPERED parity class (PP4 drift)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ postureDrift: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'parity'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'parity')?.reasons.some(reason => reason.includes('no longer re-derives')), 'the reason names the PP4 drift');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('an installed extension with no SBOM component row is the TAMPERED sbom class', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ sbomMissingComponent: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'sbom'), 'tampered');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('a component absent from the dependency graph is the TAMPERED sbom class', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ sbomMissingDependsOn: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'sbom'), 'tampered');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('the absent parity registry is the TORN parity class', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ noParity: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'parity'), 'torn');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });

        test('the absent SBOM is the TORN sbom class', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct({ noSbom: true });
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'sbom'), 'torn');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });
});

suite('A-PROD-005-W1 installed-product census: the typed degradations', () => {
        test('the ABSENT runtime surface degrades typed (no-installed-product), never silently green', async () => {
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: absentRuntimePort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.degradation?.kind, 'no-installed-product');
                        assert.ok(result.degradation?.reason.includes('ABSENT'), 'the reason names the absent surface');
                        assert.equal(result.checks.length, 0, 'no check classes run over a degraded census');
                        const lines = renderCensus(result);
                        assert.ok(lines.some(line => line.includes('DEGRADED (no-installed-product)')), 'the render carries the degradation');
                        assert.ok(lines.some(line => line.includes('never silently green')), 'the render carries the law');
                } finally {
                        await product.cleanup();
                }
        });

        test('the EMPTY runtime surface degrades typed (empty-installed-product)', async () => {
                const product = await bootFixtureProduct();
                try {
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: emptyRuntimePort() });
                        assert.equal(result.ok, false);
                        assert.equal(result.degradation?.kind, 'empty-installed-product');
                } finally {
                        await product.cleanup();
                }
        });

        test('an explicit runtime port drives the census (the seam a real install drives -- the id/version come from the port, the manifest from the tree)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct();
                try {
                        // the port reports a DIFFERENT version than the tree declares -> the tampered class fires
                        const port = explicitRuntimePort([
                                { id: 'flauz.flauz-alpha', version: '0.1.0', extensionPath: `${install.root}/extensions/flauz-alpha` },
                                { id: 'flauz.flauz-beta', version: '0.2.0', extensionPath: `${install.root}/extensions/flauz-beta` },
                        ]);
                        const result = await runCensus({ root: repoRoot, fs, clock, productRoot: product.root, installedProduct: port });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'installed'), 'tampered');
                        assert.ok(result.checks.find(entry => entry.check === 'installed')?.reasons.some(reason => reason.includes('0.2.0') && reason.includes('0.1.0')), 'the reason carries both versions');
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });
});

suite('A-PROD-005-W1 installed-product census: the record + the render', () => {
        test('persistCensus writes the swept record + banks it census-visible + re-reads byte-identical', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runCensus({ root: workspace.root, fs, clock, productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        const persisted = await persistCensus({ root: workspace.root, fs, clock }, fixtureVersions(), result);
                        assert.ok(persisted.recordPath.includes('.flauz/production/census-'), `the record lands in the production dir (${persisted.recordPath})`);
                        const reRead = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(reRead !== undefined && reRead.endsWith('\n'), 'the record carries exactly one trailing newline (DL-9)');
                        const parsed = JSON.parse(reRead as string) as Record<string, unknown>;
                        assert.equal(parsed.$schema, 'flauz.production-census/v1');
                        assert.equal(parsed.commandLine, 'flauz.production.census');
                        assert.equal(parsed.ok, true);
                        assert.equal(parsed.degraded, false);
                        assert.deepEqual(parsed.installedExtensionIds, ['flauz.flauz-alpha', 'flauz.flauz-beta']);
                        assert.equal(parsed.taskId, undefined); // the record body itself carries no taskId -- the LEDGER row does
                        // the census-visible banking: the ledger row with taskId 'flauz-production'
                        const ledgerText = await fs.readFileUtf8(`${workspace.root}/.flauz/evidence/ledger.jsonl`);
                        assert.ok(ledgerText !== undefined && ledgerText.includes('"taskId":"flauz-production"'), 'the banked ledger row carries the production taskId');
                        assert.equal(persisted.banking.recordAppended, true);
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the degraded census still persists its honest record (degraded=true, the degradation reason pinned)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runCensus({ root: workspace.root, fs, clock, productRoot: product.root, installedProduct: absentRuntimePort() });
                        const persisted = await persistCensus({ root: workspace.root, fs, clock }, fixtureVersions(), result);
                        const parsed = JSON.parse(await fs.readFileUtf8(persisted.recordPath) as string) as Record<string, unknown>;
                        assert.equal(parsed.ok, false);
                        assert.equal(parsed.degraded, true);
                        assert.equal((parsed.degradation as { kind: string }).kind, 'no-installed-product');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('censusChecks is exported pure (the fixture lane drives it directly)', async () => {
                const install = await bootFixtureInstall();
                const product = await bootFixtureProduct();
                try {
                        const { readProductState } = await import('../src/productState.ts');
                        const { readInstalledProduct } = await import('../src/installedProduct.ts');
                        const state = await readProductState(product.root, fs);
                        const installed = await readInstalledProduct(runtimePortFor(install.root), fs);
                        assert.ok(state !== undefined && installed !== undefined);
                        const checks = censusChecks(installed, state);
                        assert.equal(checks.length, 5);
                        assert.ok(checks.every(check => check.verdict === 'green'));
                } finally {
                        await install.cleanup();
                        await product.cleanup();
                }
        });
});
