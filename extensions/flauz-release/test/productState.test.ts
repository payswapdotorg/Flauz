/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the PRODUCT-STATE suite (local-real): the three product
 * check classes over fixture product states (green + each defect class) and
 * over the REAL repo root (the live product -- the strongest receipt).
 */

import assert from 'node:assert/strict';

import { activationLintReasons, checkExtensionCensus, checkParityContract, checkSbomCoverage, expectedExtensionNames, isProductRoot, productChecks, readProductState } from '../src/productState.ts';

import { bootFixtureProduct, nodeReleaseFs, repoRoot, type FixtureProduct } from './helpers.ts';

suite('A-PROD-004-W5 product state: the green fixture product verifies all three checks', () => {
        let product: FixtureProduct;

        suiteSetup(async () => {
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await product.cleanup();
        });

        test('the product state reads: 2 extensions + the parity registry + the SBOM', async () => {
                const state = await readProductState(product.root, product.fs);
                assert.ok(state);
                assert.equal(state.extensions.length, 2);
                assert.equal(state.parity.present, true);
                assert.equal(state.parity.rowCount, 6);
                assert.deepEqual(state.parity.extensionSurfaces, ['extensions/flauz-alpha', 'extensions/flauz-beta']);
                assert.equal(state.sbom.present, true);
                assert.equal(state.sbom.extensionComponents.length, 2);
        });

        test('the extension census is green (every packaged extension present + activation-lint clean)', async () => {
                const state = await readProductState(product.root, product.fs);
                assert.ok(state);
                const check = checkExtensionCensus(state);
                assert.deepEqual(check.reasons, []);
                assert.equal(check.verdict, 'green');
        });

        test('the parity contract is green (rows vs manifests, posture re-derives)', async () => {
                const state = await readProductState(product.root, product.fs);
                assert.ok(state);
                const check = checkParityContract(state);
                assert.deepEqual(check.reasons, []);
                assert.equal(check.verdict, 'green');
        });

        test('the SBOM coverage is green (components + dependency graph)', async () => {
                const state = await readProductState(product.root, product.fs);
                assert.ok(state);
                const check = checkSbomCoverage(state);
                assert.deepEqual(check.reasons, []);
                assert.equal(check.verdict, 'green');
        });
});

suite('A-PROD-004-W5 product state: the torn install classes', () => {
        test('a missing manifest is TORN in the extensions census; the registry classes stay green (the check-class separation: the census owns presence)', async () => {
                const product = await bootFixtureProduct({ missingManifest: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const checks = productChecks(state);
                        const extensions = checks.find(check => check.check === 'extensions');
                        assert.ok(extensions);
                        assert.equal(extensions.verdict, 'torn');
                        assert.ok(extensions.reasons.some(reason => reason.includes('extensions/flauz-beta/package.json is missing')));
                        const parity = checks.find(check => check.check === 'parity');
                        assert.ok(parity);
                        assert.equal(parity.verdict, 'green', 'the rows still match the live dirs (the manifest-missing defect is the census\'s)');
                        const sbom = checks.find(check => check.check === 'sbom');
                        assert.ok(sbom);
                        assert.equal(sbom.verdict, 'green');
                } finally {
                        await product.cleanup();
                }
        });

        test('an absent parity registry is TORN (the machine contract itself is incomplete)', async () => {
                const product = await bootFixtureProduct({ noParity: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkParityContract(state);
                        assert.equal(check.verdict, 'torn');
                        assert.ok(check.reasons.some(reason => reason.includes('packaging-parity.json') && reason.includes('absent')));
                } finally {
                        await product.cleanup();
                }
        });

        test('an absent SBOM is TORN (the component inventory itself is incomplete)', async () => {
                const product = await bootFixtureProduct({ noSbom: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkSbomCoverage(state);
                        assert.equal(check.verdict, 'torn');
                        assert.ok(check.reasons.some(reason => reason.includes('flauz-sbom.json') && reason.includes('absent')));
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-004-W5 product state: the tampered classes', () => {
        test('a wildcard activation manifest is TAMPERED in the extension census (the R1 mirror)', async () => {
                const product = await bootFixtureProduct({ wildcardActivation: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkExtensionCensus(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes("'*' activation is forbidden (R1)")));
                } finally {
                        await product.cleanup();
                }
        });

        test('a manifest without an entrypoint is TAMPERED (the entrypoint law)', async () => {
                const product = await bootFixtureProduct({ missingMain: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkExtensionCensus(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes('no main and no browser entrypoint')));
                } finally {
                        await product.cleanup();
                }
        });

        test('an extension without parity rows is TAMPERED (the PP2 mirror: unclassified surface)', async () => {
                const product = await bootFixtureProduct({ uncoveredExtension: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkParityContract(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes('extensions/flauz-gamma carries no packaging-parity rows')));
                } finally {
                        await product.cleanup();
                }
        });

        test('a posture row that no longer re-derives is TAMPERED (the PP4 mirror)', async () => {
                const product = await bootFixtureProduct({ postureDrift: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkParityContract(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes('posture row declares class') && reason.includes('web-blocked expected')));
                } finally {
                        await product.cleanup();
                }
        });

        test('a missing SBOM component row is TAMPERED (untracked component)', async () => {
                const product = await bootFixtureProduct({ sbomMissingComponent: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkSbomCoverage(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes('extensions/flauz-beta has no SBOM component row')));
                } finally {
                        await product.cleanup();
                }
        });

        test('a component missing from dependsOn is TAMPERED (ungraphed component)', async () => {
                const product = await bootFixtureProduct({ sbomMissingDependsOn: true });
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const check = checkSbomCoverage(state);
                        assert.equal(check.verdict, 'tampered');
                        assert.ok(check.reasons.some(reason => reason.includes('flauz-beta') && reason.includes("absent from the dependency graph's dependsOn")));
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-004-W5 product state: the activation-lint mirror + the expected set', () => {
        test('the whitelisted event shapes pass; the off-family shapes fail', async () => {
                const product = await bootFixtureProduct();
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        const alpha = state.extensions.find(extension => extension.name === 'flauz-alpha');
                        assert.ok(alpha);
                        assert.deepEqual(activationLintReasons(alpha), []);
                        assert.ok(activationLintReasons({ ...alpha, activationEvents: ['onCommand:flauz.thing', 'onView:flauz.panel'] }).length === 0);
                        assert.ok(activationLintReasons({ ...alpha, activationEvents: ['onCommand:other.thing'] }).some(reason => reason.includes('R2')));
                        assert.ok(activationLintReasons({ ...alpha, activationEvents: ['onStartupFinished'] }).some(reason => reason.includes('R3')));
                        assert.ok(activationLintReasons({ ...alpha, activationEvents: ['onCommand:flauz.thing', '*'] }).some(reason => reason.includes('R1')));
                        assert.ok(activationLintReasons({ ...alpha, id: 'flauz.flauz-agent', activationEvents: ['onStartupFinished'] }).length === 0);
                } finally {
                        await product.cleanup();
                }
        });

        test('the expected extension set is the union of the parity surfaces + the SBOM components', async () => {
                const product = await bootFixtureProduct();
                try {
                        const state = await readProductState(product.root, product.fs);
                        assert.ok(state);
                        assert.deepEqual(expectedExtensionNames(state), ['flauz-alpha', 'flauz-beta']);
                } finally {
                        await product.cleanup();
                }
        });

        test('isProductRoot probes the parity registry signature', async () => {
                const product = await bootFixtureProduct();
                try {
                        assert.equal(await isProductRoot(product.root, product.fs), true);
                        assert.equal(await isProductRoot('/nonexistent-definitely-not-a-product', product.fs), false);
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-004-W5 product state: the REAL repo root (the local-real receipt)', () => {

        test('the live repo-state product verifies all three checks green', async () => {
                const fs = nodeReleaseFs();
                assert.equal(await isProductRoot(repoRoot, fs), true);
                const state = await readProductState(repoRoot, fs);
                assert.ok(state, 'the repo root must read as a product state');
                // the live packaged set at the pinned base + this wave: the 14 flauz-* extensions
                const names = state.extensions.map(extension => extension.name);
                assert.ok(names.includes('flauz-release'), 'this wave\'s own extension is part of the live product');
                assert.ok(names.includes('flauz-diagnostics') && names.includes('flauz-backup') && names.includes('flauz-migration') && names.includes('flauz-telemetry'));
                for (const check of productChecks(state)) {
                        assert.deepEqual(check.reasons, [], `the live repo product carries a ${String(check.check)} defect: ${check.reasons.join('; ')}`);
                        assert.equal(check.verdict, 'green');
                }
        });
});
