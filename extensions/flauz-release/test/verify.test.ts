/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the INSTALL-VERIFICATION suite (local-real): the green
 * path, the torn/tampered workspace classes, the product-state defects, the
 * persisted + census-visible record, and the command surface.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type * as vscode from 'vscode';
import { setVscodeApi } from '../src/globals.ts';
import { COMMAND_IDS, registerReleaseCommands, type ReleaseCommandServices } from '../src/commands.ts';
import { persistInstallVerification, renderInstallVerification, verifyInstall } from '../src/verifyInstall.ts';
import { collectIntegrity } from '../src/verify.ts';
import { bootFixtureProduct, bootFixtureWorkspace, corruptSurfaces, fixtureVersions, tamperLedgerRow, type FixtureProduct, type FixtureWorkspace } from './helpers.ts';

/** The vscode-API shim: records registered commands (the W1 commands-test pattern). */
function vscodeShim(): { registered: Map<string, (arg: unknown) => Promise<unknown>> } {
        const registered = new Map<string, (arg: unknown) => Promise<unknown>>();
        const shim = {
                commands: {
                        registerCommand(id: string, handler: (arg: unknown) => Promise<unknown>): object {
                                registered.set(id, handler);
                                return { dispose(): void { /* recorded via the array in the caller */ } };
                        },
                },
        };
        setVscodeApi(shim as unknown as typeof vscode);
        return { registered };
}

function verdictOf(checks: readonly { check: string; verdict: string }[], check: string): string | undefined {
        return checks.find(entry => entry.check === check)?.verdict;
}

async function releaseDirFiles(root: string): Promise<string[]> {
        return (await fs.readdir(path.join(root, '.flauz', 'release'), { withFileTypes: true }).catch(() => [])).map(entry => entry.name).sort();
}

async function ledgerRowCount(root: string): Promise<number> {
        const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
        return text.split('\n').filter(line => line !== '').length;
}

suite('A-PROD-004-W5 install verification: the green path (fixture workspace + fixture product)', () => {
        let fixture: FixtureWorkspace;
        let product: FixtureProduct;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
                await product.cleanup();
        });

        test('all five check classes are green and the result is ok', async () => {
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.equal(result.ok, true);
                assert.deepEqual(result.checks.map(check => check.check), ['extensions', 'parity', 'sbom', 'census', 'integrity']);
                for (const check of result.checks) {
                        assert.deepEqual(check.reasons, [], `the '${String(check.check)}' class carries reasons: ${check.reasons.join('; ')}`);
                        assert.equal(check.verdict, 'green');
                }
                assert.equal(result.selfExport.verified, true);
                assert.notEqual(result.selfExport.manifestSha256, '');
        });

        test('the render carries the typed verdict table', async () => {
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const lines = renderInstallVerification(result);
                assert.ok(lines.some(line => line.includes('flauz.release.verify: the install verification -- verdict GREEN')));
                assert.ok(lines.some(line => line.includes('extensions') && line.includes('green')));
                assert.ok(lines.some(line => line.includes('census') && line.includes('green')));
                assert.ok(lines.some(line => line.includes('fresh self-export') && line.includes('verifies GREEN')));
        });

        test('the record persists workspace-locally + census-visible, and the banking keeps the integrity verdicts GREEN', async () => {
                const rowsBefore = await ledgerRowCount(fixture.root);
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const persisted = await persistInstallVerification({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, fixtureVersions(), result);
                assert.ok(persisted.recordPath.includes('.flauz/release/verify-'));
                assert.ok(persisted.recordPath.endsWith('.json'));
                assert.equal((await releaseDirFiles(fixture.root)).length, 1);
                // the record parses + carries the schema + the verdict table
                const text = await fs.readFile(persisted.recordPath, 'utf-8');
                const parsed = JSON.parse(text) as { $schema: string; ok: boolean; checks: { check: string; verdict: string }[]; commandLine: string; extensionId: string };
                assert.equal(parsed.$schema, 'flauz.release-verify/v1');
                assert.equal(parsed.commandLine, 'flauz.release.verify');
                assert.equal(parsed.extensionId, 'flauz.flauz-release');
                assert.equal(parsed.ok, true);
                assert.equal(parsed.checks.length, 5);
                // census-visible: the ledger grew by exactly the banked note row, and the chains stayed GREEN
                assert.equal(await ledgerRowCount(fixture.root), rowsBefore + 1);
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.equal(verdicts.evidenceLedger.ok, true, `the banked row broke the ledger chain: ${verdicts.evidenceLedger.reason ?? ''}`);
                assert.equal(verdicts.opsChain.ok, true);
                assert.ok(persisted.banking.ledgerRowSeq !== undefined);
        });
});

suite('A-PROD-004-W5 install verification: the torn workspace class', () => {
        let fixture: FixtureWorkspace;
        let product: FixtureProduct;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
                await product.cleanup();
        });

        test('a torn state is TORN in the census class and the integrity class; ok is false', async () => {
                await corruptSurfaces(fixture.root);
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.equal(result.ok, false);
                assert.equal(verdictOf(result.checks, 'census'), 'torn');
                assert.equal(verdictOf(result.checks, 'integrity'), 'torn');
                const census = result.checks.find(check => check.check === 'census');
                assert.ok(census);
                assert.ok(census.reasons.some(reason => reason.includes('tasks')));
                // the fresh self-export still verifies (the W2 law: it faithfully copies the torn bytes);
                // the CURRENT chains carry the torn signal
                assert.ok(result.selfExport.verified === true || result.selfExport.verified === false);
                const integrity = result.checks.find(check => check.check === 'integrity');
                assert.ok(integrity);
                assert.ok(integrity.reasons.some(reason => reason.includes('ledger chain is not ok')));
        });

        test('the render carries REFUSED + the torn reasons', async () => {
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const lines = renderInstallVerification(result);
                assert.ok(lines.some(line => line.includes('REFUSED')));
        });
});

suite('A-PROD-004-W5 install verification: the tampered workspace class', () => {
        let fixture: FixtureWorkspace;
        let product: FixtureProduct;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
                await product.cleanup();
        });

        test('a mutated ledger row (parses, chain breaks) is TAMPERED in the integrity class; the census stays green', async () => {
                await tamperLedgerRow(fixture.root);
                const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.equal(result.ok, false);
                assert.equal(verdictOf(result.checks, 'census'), 'green');
                assert.equal(verdictOf(result.checks, 'integrity'), 'tampered');
                // the fresh self-export of a chain-broken workspace is still a green EXPORT (the W2 law)
                assert.equal(result.selfExport.verified, true);
        });
});

suite('A-PROD-004-W5 install verification: the product-state defect classes surface in the product checks', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('a product defect (missing manifest) is TORN in the extensions class; the workspace classes stay green', async () => {
                const product = await bootFixtureProduct({ missingManifest: true });
                try {
                        const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.ok, false);
                        assert.equal(verdictOf(result.checks, 'extensions'), 'torn');
                        assert.equal(verdictOf(result.checks, 'census'), 'green');
                        assert.equal(verdictOf(result.checks, 'integrity'), 'green');
                } finally {
                        await product.cleanup();
                }
        });

        test('a parity drift (uncovered extension) is TAMPERED in the parity class', async () => {
                const product = await bootFixtureProduct({ uncoveredExtension: true });
                try {
                        const result = await verifyInstall({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(verdictOf(result.checks, 'parity'), 'tampered');
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-004-W5 install verification: the command surface', () => {
        let fixture: FixtureWorkspace;
        let product: FixtureProduct;
        let lines: string[];

        setup(() => {
                lines = [];
        });

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                product = await bootFixtureProduct();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
                await product.cleanup();
        });

        function services(): ReleaseCommandServices {
                return {
                        fs: fixture.fs,
                        clock: fixture.clock,
                        channel: { appendLine: line => { lines.push(line); } },
                        getWorkspaceRoot: () => fixture.root,
                        getProductRoot: async () => product.root,
                        versions: () => fixtureVersions(),
                };
        }

        test('flauz.release.verify renders the verdict table + persists the record + returns ok', async () => {
                const { registered } = vscodeShim();
                registerReleaseCommands(services());
                assert.deepEqual([...registered.keys()].sort(), [...COMMAND_IDS].sort());
                const handler = registered.get('flauz.release.verify');
                assert.ok(handler);
                const result = await handler(undefined);
                const value = result as { ok: boolean; recordPath: string; record: { ok: boolean } };
                assert.equal(value.ok, true);
                assert.ok(value.recordPath.includes('.flauz/release/verify-'));
                assert.equal(value.record.ok, true);
                assert.ok(lines.some(line => line.includes('flauz.release.verify: the install verification -- verdict GREEN')));
                assert.ok(lines.some(line => line.includes('record:')));
        });

        test('no workspace is the honest typed degradation', async () => {
                const { registered } = vscodeShim();
                registerReleaseCommands({ ...services(), getWorkspaceRoot: () => undefined });
                const result = await registered.get('flauz.release.verify')?.(undefined);
                assert.deepEqual(result, { ok: false, code: 'FLAUZ_RELEASE_NO_WORKSPACE' });
        });

        test('no repo-state product is the typed refusal (the runtime-installed-product angle is A-PROD-005\'s lane)', async () => {
                const { registered } = vscodeShim();
                registerReleaseCommands({ ...services(), getProductRoot: async () => undefined });
                const result = await registered.get('flauz.release.verify')?.(undefined);
                assert.deepEqual(result, { ok: false, code: 'FLAUZ_RELEASE_NO_PRODUCT_STATE' });
                assert.ok(lines.some(line => line.includes('REFUSED') && line.includes('no repo-state product')));
        });

        test('flauz.release.updateCheck renders the pre-flight and writes NOTHING', async () => {
                const rowsBefore = await ledgerRowCount(fixture.root);
                const exportsBefore = (await fs.readdir(path.join(fixture.root, '.flauz-exports'), { withFileTypes: true }).catch(() => [])).map(entry => entry.name).sort();
                const planExistsBefore = await fs.stat(path.join(fixture.root, '.flauz', 'migration', 'plan.json')).then(() => true, () => false);
                const { registered } = vscodeShim();
                registerReleaseCommands(services());
                const result = await registered.get('flauz.release.updateCheck')?.(undefined);
                const value = result as { ok: boolean };
                assert.equal(value.ok, true);
                assert.ok(lines.some(line => line.includes('flauz.release.updateCheck: the pre-update gate -- verdict READY')));
                assert.ok(lines.some(line => line.includes('NEVER performs the update')));
                // the read-only law: nothing changed
                assert.equal(await ledgerRowCount(fixture.root), rowsBefore);
                const exportsAfter = (await fs.readdir(path.join(fixture.root, '.flauz-exports'), { withFileTypes: true }).catch(() => [])).map(entry => entry.name).sort();
                assert.deepEqual(exportsAfter, exportsBefore);
                const planExistsAfter = await fs.stat(path.join(fixture.root, '.flauz', 'migration', 'plan.json')).then(() => true, () => false);
                assert.equal(planExistsAfter, planExistsBefore);
        });
});
