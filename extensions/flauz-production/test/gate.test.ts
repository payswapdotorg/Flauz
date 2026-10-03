/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The production gate semantics (A-PROD-005-W1): every prove-item's row
 * class (green / red / degraded / not-yet) with single-row failure
 * fixtures, the GO-FOR-BETA / NOT-PRODUCTION-READY verdict law, the
 * never-silently-green law, and the REAL-REPO local-real receipt (the gate
 * over the live product: green rows where surfaces exist, the one typed
 * not-yet row holding the verdict at NOT-PRODUCTION-READY -- the
 * signingIntegrity row flipped to the live machinery with A-PROD-005-W2
 * and dataIsolation with W3 (the station integrations: green over the
 * real product, degraded when the machinery is absent from the registry,
 * never a hardcoded claim).
 */

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import { runGate, persistGate, renderGate, type GateRow } from '../src/gate.ts';
import { nodeProductionFs, steppingClock, repoRoot, bootFixtureProduct, bootFixtureWorkspace, bootFixtureInstall, runtimePortFor, absentRuntimePort, fixtureVersions } from './helpers.ts';

const fs = nodeProductionFs();
const clock = steppingClock();

function rowOf(rows: readonly GateRow[], id: string): GateRow | undefined {
        return rows.find(entry => entry.id === id);
}

suite('A-PROD-005-W1 production gate: the row vocabulary', () => {
        test('the gate carries the ELEVEN prove-items verbatim + the census consultation row', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const ids = result.rows.map(entry => entry.id);
                        assert.deepEqual(ids, [
                                'reproducibleArtifacts',
                                'signingIntegrity',
                                'securityPosture',
                                'dataIsolation',
                                'secretHandling',
                                'workerDurability',
                                'observability',
                                'backupRecovery',
                                'failureRollback',
                                'upgradeCompatibility',
                                'documentedCapabilities',
                                'installedProductCensus',
                        ]);
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('the one not-yet row names its owning later wave and is never green; the signing + isolation rows degrade honestly when the machinery is absent (the station W2/W3 integrations)', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        for (const id of ['workerDurability']) {
                                const entry = rowOf(result.rows, id);
                                assert.ok(entry !== undefined, `${id} exists`);
                                assert.equal(entry.status, 'not-yet');
                                assert.ok(entry.reasons.some(reason => reason.includes('later A-PROD-005 wave')), `${id} names the owning later wave`);
                                assert.equal(entry.evidence.command, '(no owning command exists at this base)');
                        }
                        // the fixture product carries NO flauz-isolation extension either: the
                        // dataIsolation row must DEGRADE (the machinery-presence claim is
                        // derived from the live registry, never hardcoded)
                        const isolation = rowOf(result.rows, 'dataIsolation');
                        assert.ok(isolation !== undefined, 'dataIsolation exists');
                        assert.equal(isolation.status, 'degraded');
                        assert.ok(isolation.reasons.some(reason => reason.includes('does not carry the A-PROD-005-W3 isolation machinery')), 'the degraded row names the machinery absence');
                        assert.ok(isolation.evidence.command.includes('flauz.isolation.audit'), 'the row points at the real owning commands');
                        // the fixture product carries NO flauz-integrity extension: the
                        // signing row must DEGRADE (the machinery-presence claim is
                        // derived from the live registry, never hardcoded) -- never
                        // green, never not-yet (the W2 machinery exists in the real
                        // product; this fixture simply does not ship it)
                        const signing = rowOf(result.rows, 'signingIntegrity');
                        assert.ok(signing !== undefined, 'signingIntegrity exists');
                        assert.equal(signing.status, 'degraded');
                        assert.ok(signing.reasons.some(reason => reason.includes('does not carry the A-PROD-005-W2 signing machinery')), 'the degraded row names the machinery absence');
                        assert.ok(signing.evidence.command.includes('flauz.integrity.sign'), 'the row points at the real owning commands');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('GO-FOR-BETA requires EVERY row green; any not-yet/degraded/red row holds the verdict at NOT-PRODUCTION-READY', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        assert.equal(result.verdict, 'NOT-PRODUCTION-READY');
                        assert.ok(result.refusalRows.includes('signingIntegrity (degraded)'));
                        assert.ok(result.refusalRows.includes('dataIsolation (degraded)'));
                        assert.ok(result.refusalRows.includes('workerDurability (not-yet)'));
                        assert.ok(result.refusalRows.includes('installedProductCensus (degraded)'));
                        const lines = renderGate(result);
                        assert.ok(lines.some(line => line.includes('NOT-PRODUCTION-READY')));
                        assert.ok(lines.some(line => line.includes('never silently greens')), 'the render carries the law');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });
});

suite('A-PROD-005-W1 production gate: the single-row failure fixtures', () => {
        test('reproducibleArtifacts turns red when the pinned bundle manifest is absent', async () => {
                const product = await bootFixtureProduct({ noBundleManifest: true });
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        assert.equal(rowOf(result.rows, 'reproducibleArtifacts')?.status, 'red');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('reproducibleArtifacts is green over the bundle pins and discloses the STATION-PENDING doctrine', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const entry = rowOf(result.rows, 'reproducibleArtifacts');
                        assert.equal(entry?.status, 'green');
                        assert.ok(entry?.reasons.some(reason => reason.includes('STATION-PENDING')), 'the row discloses the station doctrine');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('securityPosture turns red when the SBOM is absent, the allowlists are missing, or coverage breaks', async () => {
                for (const defect of [{ noSbom: true }, { noSecretsAllowlist: true }, { noAuditAllowlist: true }, { sbomMissingComponent: true }] as const) {
                        const product = await bootFixtureProduct(defect);
                        const workspace = await bootFixtureWorkspace();
                        try {
                                const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                assert.equal(rowOf(result.rows, 'securityPosture')?.status, 'red', `the ${JSON.stringify(defect)} fixture turns the row red`);
                        } finally {
                                await product.cleanup();
                                await workspace.cleanup();
                        }
                }
        });

        test('observability is green on the absent (default-off) config, green on enabled, red on a corrupt config', async () => {
                const product = await bootFixtureProduct();
                try {
                        for (const [options, expected] of [
                                [{}, 'green'],
                                [{ enabledTelemetry: true }, 'green'],
                                [{ corruptTelemetry: true }, 'red'],
                        ] as const) {
                                const workspace = await bootFixtureWorkspace(options);
                                try {
                                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                        const entry = rowOf(result.rows, 'observability');
                                        assert.equal(entry?.status, expected, `the ${JSON.stringify(options)} fixture yields ${expected}`);
                                        if (expected === 'red') {
                                                assert.ok(entry?.reasons.some(reason => reason.includes('cannot be known')), 'the corrupt config refuses to guess');
                                        }
                                } finally {
                                        await workspace.cleanup();
                                }
                        }
                } finally {
                        await product.cleanup();
                }
        });

        test('backupRecovery degrades without a banked export and is green over one', async () => {
                const product = await bootFixtureProduct();
                try {
                        const none = await bootFixtureWorkspace();
                        try {
                                const result = await runGate({ root: none.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                const entry = rowOf(result.rows, 'backupRecovery');
                                assert.equal(entry?.status, 'degraded');
                                assert.ok(entry?.reasons.some(reason => reason.includes('no banked export exists')), 'the reason names the absent export');
                        } finally {
                                await none.cleanup();
                        }
                        const withExport = await bootFixtureWorkspace({ withExport: true });
                        try {
                                const result = await runGate({ root: withExport.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                assert.equal(rowOf(result.rows, 'backupRecovery')?.status, 'green');
                        } finally {
                                await withExport.cleanup();
                        }
                } finally {
                        await product.cleanup();
                }
        });

        test('failureRollback turns red on the torn-migration marker and on a stage leftover', async () => {
                const product = await bootFixtureProduct();
                try {
                        for (const options of [{ tornMarker: true }, { stageLeftover: true }] as const) {
                                const workspace = await bootFixtureWorkspace(options);
                                try {
                                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                        assert.equal(rowOf(result.rows, 'failureRollback')?.status, 'red', `the ${JSON.stringify(options)} fixture turns the row red`);
                                } finally {
                                        await workspace.cleanup();
                                }
                        }
                } finally {
                        await product.cleanup();
                }
        });

        test('upgradeCompatibility is green over honest-absent surfaces and red on a version refusal (the empty transform registry)', async () => {
                const product = await bootFixtureProduct();
                try {
                        const empty = await bootFixtureWorkspace();
                        try {
                                const result = await runGate({ root: empty.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                const entry = rowOf(result.rows, 'upgradeCompatibility');
                                assert.equal(entry?.status, 'green');
                                assert.equal(entry?.details.absentCount, 10, 'all ten surfaces honestly absent');
                        } finally {
                                await empty.cleanup();
                        }
                        const future = await bootFixtureWorkspace({ futureTasks: true });
                        try {
                                const result = await runGate({ root: future.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                                const entry = rowOf(result.rows, 'upgradeCompatibility');
                                assert.equal(entry?.status, 'red');
                                assert.ok(entry?.reasons.some(reason => reason.includes('tasks') && reason.includes('refuses')), 'the refusal names the surface and the empty-registry law');
                        } finally {
                                await future.cleanup();
                        }
                } finally {
                        await product.cleanup();
                }
        });

        test('documentedCapabilities evaluates THIS wave\'s matrix live: a drifted fixture product turns the row red', async () => {
                // the fixture product carries only fixture commands -> the real catalog drifts against it
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const entry = rowOf(result.rows, 'documentedCapabilities');
                        assert.equal(entry?.status, 'red');
                        assert.ok(entry?.reasons.some(reason => reason.includes('NOT-CLOSED')), 'the row carries the matrix verdict');
                        assert.equal(entry?.evidence.command, 'flauz.production.matrix');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('installedProductCensus is degraded on the absent port and green on a consistent fixture install', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                const install = await bootFixtureInstall();
                try {
                        const degraded = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        assert.equal(rowOf(degraded.rows, 'installedProductCensus')?.status, 'degraded');
                        assert.ok(rowOf(degraded.rows, 'installedProductCensus')?.reasons.some(reason => reason.includes('ABSENT')), 'the reason names the absent runtime surface');
                        const green = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: runtimePortFor(install.root) });
                        assert.equal(rowOf(green.rows, 'installedProductCensus')?.status, 'green');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                        await install.cleanup();
                }
        });
});

suite('A-PROD-005-W1 production gate: the record + the real-repo receipt', () => {
        test('persistGate writes the swept record + banks it census-visible', async () => {
                const product = await bootFixtureProduct();
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: product.root, installedProduct: absentRuntimePort() });
                        const persisted = await persistGate({ root: workspace.root, fs, clock }, fixtureVersions(), result);
                        assert.ok(persisted.recordPath.includes('.flauz/production/gate-'));
                        const reRead = await fs.readFileUtf8(persisted.recordPath);
                        assert.ok(reRead !== undefined);
                        const parsed = JSON.parse(reRead as string) as Record<string, unknown>;
                        assert.equal(parsed.$schema, 'flauz.production-gate/v1');
                        assert.equal(parsed.verdict, 'NOT-PRODUCTION-READY');
                        assert.ok(Array.isArray(parsed.rows) && parsed.rows.length === 12);
                        const ledgerText = await fs.readFileUtf8(`${workspace.root}/.flauz/evidence/ledger.jsonl`);
                        assert.ok(ledgerText !== undefined && ledgerText.includes('"taskId":"flauz-production"'));
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('THE REAL-REPO RECEIPT: over the live product every surfaced row is green (the signing + isolation rows flipped with W2/W3), the one not-yet row holds the verdict, the census row rides the fixture port', async () => {
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: repoRoot, installedProduct: runtimePortFor(repoRoot) });
                        for (const id of ['reproducibleArtifacts', 'signingIntegrity', 'dataIsolation', 'securityPosture', 'secretHandling', 'observability', 'backupRecovery', 'failureRollback', 'upgradeCompatibility', 'documentedCapabilities', 'installedProductCensus']) {
                                const entry = rowOf(result.rows, id);
                                assert.ok(entry !== undefined, `${id} exists`);
                                assert.equal(entry.status, 'green', `${id} is green over the real product (${JSON.stringify(entry.reasons)})`);
                        }
                        // the signing row's green carries BOTH honest disclosures (the
                        // local-dev key posture + the empty-by-design ledger)
                        const signing = rowOf(result.rows, 'signingIntegrity');
                        assert.ok(signing !== undefined && signing.reasons.some(reason => reason.includes('LOCAL-DEV')), 'the key-posture disclosure is carried');
                        assert.ok(signing !== undefined && signing.reasons.some(reason => reason.includes('EMPTY by design')), 'the empty-ledger disclosure is carried');
                        // the isolation row's green carries the workspace-vs-host boundary
                        // disclosure (the honest boundary law)
                        const isolation = rowOf(result.rows, 'dataIsolation');
                        assert.ok(isolation !== undefined && isolation.reasons.some(reason => reason.includes('isolatable unit this product owns')), 'the workspace-boundary disclosure is carried');
                        assert.ok(isolation !== undefined && isolation.reasons.some(reason => reason.includes('outside this plane')), 'the host-posture disclosure is carried');
                        assert.equal(result.verdict, 'NOT-PRODUCTION-READY');
                        assert.deepEqual(result.refusalRows, ['workerDurability (not-yet)'], 'exactly the one remaining not-yet row holds the verdict (signingIntegrity flipped with W2, dataIsolation with W3)');
                } finally {
                        await workspace.cleanup();
                }
        });

        test('THE REAL-REPO RECEIPT: the degraded census row is the honest worker-sandbox state (the port absent over the real product)', async () => {
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runGate({ root: workspace.root, fs, clock, versions: fixtureVersions(), productRoot: repoRoot, installedProduct: absentRuntimePort() });
                        assert.equal(rowOf(result.rows, 'installedProductCensus')?.status, 'degraded');
                        assert.equal(result.verdict, 'NOT-PRODUCTION-READY');
                        assert.deepEqual(result.refusalRows, ['workerDurability (not-yet)', 'installedProductCensus (degraded)']);
                } finally {
                        await workspace.cleanup();
                }
        });
});
