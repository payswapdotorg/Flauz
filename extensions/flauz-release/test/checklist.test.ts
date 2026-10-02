/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the CHECKLIST suite (local-real): the go/no-go semantics
 * (all-green = GO; each single-row failure = NO-GO with the exact row; the
 * artifact persisted + re-readable; the unknown row class), and the command
 * surface.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type * as vscode from 'vscode';
import { setVscodeApi } from '../src/globals.ts';
import { COMMAND_IDS, registerReleaseCommands, type ReleaseCommandServices } from '../src/commands.ts';
import { checklistIdOf, renderChecklist, runChecklist, type ChecklistRow, type ReleaseChecklistResult } from '../src/checklist.ts';
import { collectIntegrity } from '../src/verify.ts';
import { bootFixtureProduct, bootFixtureWorkspace, corruptSurfaces, fixtureVersions, tamperLedgerRow, writeFutureVersionedTasks, writeTelemetryConfig, type FixtureProduct, type FixtureWorkspace } from './helpers.ts';

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

function rowOf(rows: readonly ChecklistRow[], id: string): ChecklistRow {
        const found = rows.find(entry => entry.id === id);
        assert.ok(found, `the checklist must carry the '${id}' row`);
        return found;
}

async function ledgerRowCount(root: string): Promise<number> {
        const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
        return text.split('\n').filter(line => line !== '').length;
}

suite('A-PROD-004-W5 checklist: the all-green GO', () => {
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

        test('all ten rows are green and the verdict is GO', async () => {
                const rowsBefore = await ledgerRowCount(fixture.root);
                const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.equal(result.verdict, 'GO');
                assert.deepEqual(result.refusalRows, []);
                assert.equal(result.rows.length, 10);
                for (const entry of result.rows) {
                        assert.equal(entry.verdict, 'green', `the '${entry.id}' row must be green: ${entry.reasons.join('; ')}`);
                        assert.ok(entry.evidence.command.length > 0);
                        assert.ok(entry.evidence.observable.length > 0);
                }
                // every row's evidence pointer is a REAL owning command
                const commands = result.rows.map(entry => entry.evidence.command);
                assert.ok(commands.includes('flauz.diag.show'));
                assert.ok(commands.includes('flauz.backup.export + flauz.backup.verify'));
                assert.ok(commands.includes('flauz.backup.restore'));
                assert.ok(commands.includes('flauz.migration.plan'));
                assert.ok(commands.includes('flauz.telemetry.config'));
                assert.ok(commands.includes('flauz.failures.list'));
                assert.ok(commands.includes('flauz.release.verify'));
                assert.ok(commands.includes('flauz.release.checklist'));
                // the artifact persisted + re-readable + the ledger banked census-visible
                assert.ok(result.artifactPath);
                assert.ok(result.artifactPath.includes('.flauz/release/checklist-'));
                assert.ok(result.checklistId);
                assert.equal(result.artifactReReadable, true);
                assert.equal(await ledgerRowCount(fixture.root), rowsBefore + 1);
                // the banking kept the chains GREEN
                const verdicts = await collectIntegrity(fixture.root, fixture.fs);
                assert.equal(verdicts.evidenceLedger.ok, true);
                assert.equal(verdicts.opsChain.ok, true);
        });

        test('the artifact parses, carries the schema + verdict + rows, and its checklistId re-derives', async () => {
                const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.ok(result.artifactPath);
                const text = await fs.readFile(result.artifactPath, 'utf-8');
                const parsed = JSON.parse(text) as Record<string, unknown> & { rows: ChecklistRow[]; checklistId: string; $schema: string; verdict: string; commandLine: string };
                assert.equal(parsed.$schema, 'flauz.release-checklist/v1');
                assert.equal(parsed.commandLine, 'flauz.release.checklist');
                assert.equal(parsed.verdict, 'GO');
                assert.equal(parsed.rows.length, 10);
                const { checklistId, ...body } = parsed;
                assert.equal(checklistId, result.checklistId);
                assert.equal(checklistIdOf(body as unknown as Parameters<typeof checklistIdOf>[0]), checklistId);
        });

        test('the render carries the go/no-go table with every row + the evidence pointers', async () => {
                const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const lines = renderChecklist(result);
                assert.ok(lines.some(line => line.includes('flauz.release.checklist: the beta gate go/no-go -- verdict GO')));
                for (const id of ['diagnostics', 'backup', 'crashRecovery', 'migration', 'telemetry', 'failureTyping', 'rollback', 'supportBundle', 'installVerification', 'checklistArtifact']) {
                        assert.ok(lines.some(line => line.includes(id)), `the render must carry the '${id}' row`);
                }
                assert.ok(lines.some(line => line.includes('evidence: flauz.diag.show')));
                assert.ok(lines.some(line => line.includes('overall: GO (all ten rows green)')));
                assert.ok(lines.some(line => line.includes('artifact:')));
        });

        test('the crash-recovery drill enumerates the restorable surfaces + the consent requirement', async () => {
                const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                const drill = rowOf(result.rows, 'crashRecovery');
                assert.equal(drill.verdict, 'green');
                const details = drill.details as { restorableSurfaces: string[]; consentRequired: string[]; recoveryLogPath: string };
                assert.ok(details.restorableSurfaces.includes('tasks'));
                assert.ok(details.restorableSurfaces.includes('evidenceLedger'));
                // every restorable surface is present in the fixture workspace -> restore would need overwrite consent (the W2 law)
                assert.deepEqual(details.consentRequired, details.restorableSurfaces);
                assert.equal(details.recoveryLogPath, '.flauz/backup/recovery-log.jsonl');
        });
});

suite('A-PROD-004-W5 checklist: each single-row failure is NO-GO with the exact row', () => {

        test('a torn workspace (truncated tasks + torn ledger tail) -> diagnostics + supportBundle + installVerification RED', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        await corruptSurfaces(fixture.root);
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.equal(rowOf(result.rows, 'diagnostics').verdict, 'red');
                        assert.ok(rowOf(result.rows, 'diagnostics').reasons.some(reason => reason.includes('tasks')));
                        assert.equal(rowOf(result.rows, 'supportBundle').verdict, 'red');
                        assert.equal(rowOf(result.rows, 'installVerification').verdict, 'red');
                        assert.ok(result.refusalRows.includes('diagnostics (red)'));
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('a future-versioned surface -> migration RED (the single-row case: the census stays clean)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        await writeFutureVersionedTasks(fixture.root);
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.deepEqual(result.refusalRows, ['migration (red)']);
                        assert.equal(rowOf(result.rows, 'diagnostics').verdict, 'green');
                        assert.equal(rowOf(result.rows, 'backup').verdict, 'green');
                        assert.equal(rowOf(result.rows, 'migration').verdict, 'red');
                        assert.ok(rowOf(result.rows, 'migration').reasons.some(reason => reason.includes('tasks cannot migrate safely')));
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('a corrupt telemetry config -> the telemetry row UNKNOWN (the opt-in state cannot be known)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        await writeTelemetryConfig(fixture.root, { $schema: 'flauz.telemetry-config/v1', schemaVersion: 0, enabled: 'yes', retentionDays: 30, schemaDigest: 'a'.repeat(64) });
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.deepEqual(result.refusalRows, ['telemetry (unknown)']);
                        assert.equal(rowOf(result.rows, 'telemetry').verdict, 'unknown');
                        assert.ok(rowOf(result.rows, 'telemetry').reasons.some(reason => reason.includes('opt-in state may never be guessed')));
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('a valid enabled telemetry config -> the telemetry row GREEN (the state is known)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        await writeTelemetryConfig(fixture.root, { $schema: 'flauz.telemetry-config/v1', schemaVersion: 0, enabled: true, retentionDays: 14, schemaDigest: 'a'.repeat(64) });
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(rowOf(result.rows, 'telemetry').verdict, 'green');
                        const details = rowOf(result.rows, 'telemetry').details as { enabled: boolean; retentionDays: number };
                        assert.equal(details.enabled, true);
                        assert.equal(details.retentionDays, 14);
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('a tampered ledger -> installVerification RED (integrity class) + backup stays green (the export faithfully copies)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        await tamperLedgerRow(fixture.root);
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.equal(rowOf(result.rows, 'backup').verdict, 'green');
                        assert.equal(rowOf(result.rows, 'installVerification').verdict, 'red');
                        assert.ok(rowOf(result.rows, 'installVerification').reasons.some(reason => reason.includes('integrity')));
                        assert.ok(result.refusalRows.includes('installVerification (red)'));
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('a product-state defect -> installVerification RED alone (the workspace rows stay green)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct({ uncoveredExtension: true });
                try {
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.deepEqual(result.refusalRows, ['installVerification (red)']);
                        assert.equal(rowOf(result.rows, 'diagnostics').verdict, 'green');
                        assert.equal(rowOf(result.rows, 'installVerification').verdict, 'red');
                        assert.ok(rowOf(result.rows, 'installVerification').reasons.some(reason => reason.includes('parity')));
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });

        test('NO product state in the workspace -> the installVerification row UNKNOWN (this wave\'s evidence law, honestly)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        const result = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: undefined });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.deepEqual(result.refusalRows, ['installVerification (unknown)']);
                        assert.equal(rowOf(result.rows, 'installVerification').verdict, 'unknown');
                        assert.ok(rowOf(result.rows, 'installVerification').reasons.some(reason => reason.includes('no repo-state product')));
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a failing artifact write -> the checklistArtifact row RED + NO-GO (the prediction is verified, never assumed)', async () => {
                const fixture = await bootFixtureWorkspace();
                const product = await bootFixtureProduct();
                try {
                        // the saboteur: every writeFile under .flauz/release/ fails (the artifact persist cycle)
                        const failing = {
                                readFileUtf8: fixture.fs.readFileUtf8,
                                readdir: fixture.fs.readdir,
                                mkdir: fixture.fs.mkdir,
                                appendFile: fixture.fs.appendFile,
                                writeFile: async (target: string, contents: string) => {
                                        if (target.includes('.flauz/release/')) {
                                                throw new Error('sabotaged artifact write');
                                        }
                                        return fixture.fs.writeFile(target, contents);
                                },
                        };
                        const result = await runChecklist({ root: fixture.root, fs: failing, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                        assert.equal(result.verdict, 'NO-GO');
                        assert.equal(rowOf(result.rows, 'checklistArtifact').verdict, 'red');
                        assert.ok(rowOf(result.rows, 'checklistArtifact').reasons.some(reason => reason.includes('persist/re-read cycle failed')));
                        assert.equal(result.artifactReReadable, false);
                        assert.equal(result.checklistId, undefined);
                } finally {
                        await fixture.cleanup();
                        await product.cleanup();
                }
        });
});

suite('A-PROD-004-W5 checklist: the command surface', () => {
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

        test('flauz.release.checklist renders the disclosure + the table + returns the GO', async () => {
                const { registered } = vscodeShim();
                registerReleaseCommands(services());
                const result = await registered.get('flauz.release.checklist')?.(undefined);
                const value = result as { ok: boolean; verdict: string; artifactPath: string; rows: ChecklistRow[] };
                assert.equal(value.ok, true);
                assert.equal(value.verdict, 'GO');
                assert.equal(value.rows.length, 10);
                assert.ok(value.artifactPath.includes('.flauz/release/checklist-'));
                assert.ok(lines.some(line => line.includes('cutting a fresh self-export')));
                assert.ok(lines.some(line => line.includes('flauz.release.checklist: the beta gate go/no-go -- verdict GO')));
                assert.ok(lines.some(line => line.includes('census-visible: the banked evidence row')));
        });

        test('no workspace is the honest typed degradation', async () => {
                const { registered } = vscodeShim();
                registerReleaseCommands({ ...services(), getWorkspaceRoot: () => undefined });
                const result = await registered.get('flauz.release.checklist')?.(undefined);
                assert.deepEqual(result, { ok: false, code: 'FLAUZ_RELEASE_NO_WORKSPACE' });
        });
});

suite('A-PROD-004-W5 checklist: the ten-row binding inventory', () => {
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

        test('the rows are exactly the ten beta capabilities in the gate order', async () => {
                const result: ReleaseChecklistResult = await runChecklist({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions(), productRoot: product.root });
                assert.deepEqual(result.rows.map(entry => entry.id), [
                        'diagnostics', 'backup', 'crashRecovery', 'migration', 'telemetry',
                        'failureTyping', 'rollback', 'supportBundle', 'installVerification', 'checklistArtifact',
                ]);
                // the rollback row pins the fresh export as the anchor (cross-recognizable by the W3 law)
                const rollback = rowOf(result.rows, 'rollback');
                const details = rollback.details as { anchorDirName: string; verified: boolean; anchorFeasible: boolean };
                assert.equal(details.verified, true);
                assert.equal(details.anchorFeasible, true);
                assert.ok(details.anchorDirName.startsWith('export-'));
                // the telemetry row on a clean workspace: the absent config is the KNOWN default-off state
                assert.deepEqual(rowOf(result.rows, 'telemetry').details, { state: 'absent-default-off', enabled: false });
                // the failure-typing row: 14 classes over 19 source codes
                assert.deepEqual(rowOf(result.rows, 'failureTyping').details, { classCount: 14, sourceCodeCount: 19 });
        });
});
