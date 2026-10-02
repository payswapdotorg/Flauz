/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W2 -- the VERIFY-VERDICT suite (local-real): a good export
 * passes; a tampered file, a truncated/torn export, a swapped surface file
 * and an edited manifest each fail with the RIGHT per-surface verdict.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type * as vscode from 'vscode';
import { setVscodeApi } from '../src/globals.ts';
import { BackupError } from '../src/api.ts';
import { createExport } from '../src/export.ts';
import { renderVerdictTable, verifyExport, type ExportVerification, type SurfaceVerdict } from '../src/inspect.ts';
import { COMMAND_IDS, registerBackupCommands, type BackupCommandServices } from '../src/commands.ts';
import { bootFixtureWorkspace, fixtureVersions, type FixtureWorkspace } from './helpers.ts';

/** The vscode-API shim: records registered commands (the W1 commands-test pattern). */
function vscodeShim(): { registered: Map<string, (arg: unknown) => Promise<unknown>> } {
        const registered = new Map<string, (arg: unknown) => Promise<unknown>>();
        const shim = {
                commands: {
                        registerCommand(id: string, handler: (arg: unknown) => Promise<unknown>): object {
                                registered.set(id, handler);
                                return { dispose(): void { /* recorded via the array below */ } };
                        },
                },
        };
        setVscodeApi(shim as unknown as typeof vscode);
        return { registered };
}

interface Exported {
        readonly fixture: FixtureWorkspace;
        readonly exportDir: string;
        readonly exportDirName: string;
}

async function bootAndExport(): Promise<Exported> {
        const fixture = await bootFixtureWorkspace();
        const result = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
        return { fixture, exportDir: result.exportDir, exportDirName: result.exportDirName };
}

function verdictOf(verification: ExportVerification, surface: string): SurfaceVerdict | undefined {
        return verification.surfaces.find(entry => entry.surface === surface)?.verdict;
}

async function writeStateFile(exported: Exported, exportPath: string, text: string): Promise<void> {
        await fs.writeFile(path.join(exported.exportDir, exportPath), text, 'utf-8');
}

async function readStateFile(exported: Exported, exportPath: string): Promise<string> {
        return await fs.readFile(path.join(exported.exportDir, exportPath), 'utf-8');
}

suite('verify: the verdict table over the real exported state', () => {

        test('a good export verifies GREEN on every surface + the metadata + the chain re-run', async () => {
                const exported = await bootAndExport();
                try {
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, true);
                        assert.strictEqual(verification.metadata.verdict, 'green');
                        for (const surface of verification.surfaces) {
                                assert.strictEqual(surface.verdict, 'green', `${String(surface.surface)} is green`);
                                assert.strictEqual(surface.countsMatch, true, `${String(surface.surface)} counts match`);
                        }
                        assert.strictEqual(verification.extras.length, 0);
                        // the chain re-run on the COPIED state agrees with the export-time verdicts
                        assert.strictEqual(verification.verdictsConsistent, true);
                        assert.strictEqual(verification.chainVerdicts.evidenceLedger.ok, true);
                        assert.strictEqual(verification.chainVerdicts.opsChain.ok, true);
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('a TAMPERED file (edited bytes) fails with the tampered verdict on its surface only', async () => {
                const exported = await bootAndExport();
                try {
                        const text = await readStateFile(exported, 'state/.flauz/environments.json');
                        await writeStateFile(exported, 'state/.flauz/environments.json', text.replace('env-build-box', 'env-tampered'));
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.strictEqual(verdictOf(verification, 'environmentsRegistry'), 'tampered');
                        for (const surface of verification.surfaces) {
                                if (surface.surface !== 'environmentsRegistry') {
                                        assert.strictEqual(surface.verdict, 'green', `${String(surface.surface)} stays green`);
                                }
                        }
                        assert.ok(verification.surfaces.find(entry => entry.surface === 'environmentsRegistry')?.reasons.join(' ').includes('no longer matches its receipt'), 'the reason names the sha mismatch');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('a TORN export (a manifest-listed file deleted) fails with the torn verdict', async () => {
                const exported = await bootAndExport();
                try {
                        await fs.rm(path.join(exported.exportDir, 'state/.flauz/workflows/W-001.json'));
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.strictEqual(verdictOf(verification, 'workflows'), 'torn');
                        assert.ok(verification.surfaces.find(entry => entry.surface === 'workflows')?.reasons.join(' ').includes('missing from the export'), 'the reason names the missing file');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('a TRUNCATED file (shorter than its recorded size) fails with the torn verdict (the interrupted-copy class)', async () => {
                const exported = await bootAndExport();
                try {
                        const text = await readStateFile(exported, 'state/.flauz/tasks.json');
                        await writeStateFile(exported, 'state/.flauz/tasks.json', text.slice(0, Math.floor(text.length / 2)));
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.strictEqual(verdictOf(verification, 'tasks'), 'torn');
                        assert.ok(verification.surfaces.find(entry => entry.surface === 'tasks')?.reasons.join(' ').includes('shorter than the recorded'), 'the reason names the truncation');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('a SWAPPED surface file (the ledger replaced by the orchestration journal bytes) fails with the tampered verdict + the swap reason', async () => {
                const exported = await bootAndExport();
                try {
                        const journal = await readStateFile(exported, 'state/.flauz/orchestration/journal.jsonl');
                        await writeStateFile(exported, 'state/.flauz/evidence/ledger.jsonl', journal);
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.strictEqual(verdictOf(verification, 'evidenceLedger'), 'tampered');
                        const reasons = verification.surfaces.find(entry => entry.surface === 'evidenceLedger')?.reasons.join(' ') ?? '';
                        assert.ok(reasons.includes('ANOTHER manifest entry'), 'the reason names the swap');
                        // the chain re-run ALSO catches it: the copied bytes parse as NO ledger
                        // rows, so the re-run verdict diverges from the export-time verdict
                        // pinned in integrity.json (same bytes must produce the same verdict)
                        assert.strictEqual(verification.verdictsConsistent, false, 'the re-run chain verdict diverges from the export-time verdict');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('an EDITED MANIFEST (metadata tampering) fails the metadata receipt check even when the state copy is intact', async () => {
                const exported = await bootAndExport();
                try {
                        const manifestPath = path.join(exported.exportDir, 'MANIFEST.json');
                        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as { totalBytes: number };
                        manifest.totalBytes += 1;
                        await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.strictEqual(verification.metadata.verdict, 'tampered');
                        assert.ok(verification.metadata.reasons.join(' ').includes('no longer matches its export.json receipt'), 'the metadata receipt names the drift');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('an UNEXPECTED state file (not in the manifest) fails with the tampered verdict', async () => {
                const exported = await bootAndExport();
                try {
                        await fs.writeFile(path.join(exported.exportDir, 'state/.flauz/extra-injected.json'), '{"injected": true}\n', 'utf-8');
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        assert.strictEqual(verification.ok, false);
                        assert.deepStrictEqual(verification.extras, ['state/.flauz/extra-injected.json']);
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('the newest-export default resolution + the not-found + format refusals', async () => {
                const exported = await bootAndExport();
                try {
                        // a second, newer export exists -> the default verifies the NEWEST
                        const second = await createExport({ root: exported.fixture.root, fs: exported.fixture.fs, clock: exported.fixture.clock, versions: fixtureVersions() });
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, undefined);
                        assert.strictEqual(verification.exportDirName, second.exportDirName, 'the lexicographically-last stamp is the newest');
                        // a bogus reference is the typed not-found refusal
                        await assert.rejects(verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, 'export-does-not-exist'), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_EXPORT_NOT_FOUND');
                                return true;
                        });
                        // an unknown format version is the typed format refusal
                        const metadataPath = path.join(second.exportDir, 'export.json');
                        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as { formatVersion: number };
                        metadata.formatVersion = 99;
                        await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
                        await assert.rejects(verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, second.exportDirName), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_FORMAT');
                                return true;
                        });
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('the command surface: flauz.backup.verify renders the verdict table; no-workspace degrades honestly; the activation contract', async () => {
                const exported = await bootAndExport();
                try {
                        const lines: string[] = [];
                        const services = (): BackupCommandServices => ({
                                fs: exported.fixture.fs,
                                clock: exported.fixture.clock,
                                channel: { appendLine: line => { lines.push(line); } },
                                getWorkspaceRoot: () => exported.fixture.root,
                                versions: () => fixtureVersions(),
                        });
                        const { registered } = vscodeShim();
                        registerBackupCommands(services());
                        assert.deepStrictEqual([...registered.keys()].sort(), [...COMMAND_IDS].sort(), 'the three contributed commands register');
                        const handler = registered.get('flauz.backup.verify') as (arg: unknown) => Promise<unknown>;
                        const result = await handler(undefined) as { ok: boolean; verification: ExportVerification };
                        assert.strictEqual(result.ok, true);
                        assert.ok(lines.some(line => line.includes('GREEN (the export matches its manifest)')), 'the header renders');
                        assert.ok(lines.some(line => line.includes('evidenceLedger')), 'the surface rows render');
                        assert.ok(lines.some(line => line.includes('chain verdicts re-run on the copied state')), 'the chain re-run renders');
                        // the no-workspace degradation
                        const degraded = vscodeShim();
                        registerBackupCommands({ ...services(), getWorkspaceRoot: () => undefined });
                        const degradedResult = await (degraded.registered.get('flauz.backup.verify') as (arg: unknown) => Promise<unknown>)(undefined) as { ok: boolean; code: string };
                        assert.strictEqual(degradedResult.ok, false);
                        assert.strictEqual(degradedResult.code, 'FLAUZ_BACKUP_NO_WORKSPACE');
                        // the render never carries file contents (counts, hashes, paths, ids only)
                        const rendered = lines.join('\n');
                        assert.ok(!rendered.includes('Diagnose the flaky provider lane'), 'task titles never render');
                        assert.ok(!rendered.includes('ordinary step output'), 'step outputs never render');
                } finally {
                        await exported.fixture.cleanup();
                }
        });

        test('the verdict table render names the verdict vocabulary honestly', async () => {
                const exported = await bootAndExport();
                try {
                        const verification = await verifyExport({ root: exported.fixture.root, fs: exported.fixture.fs }, exported.exportDirName);
                        const rendered = renderVerdictTable(verification).join('\n');
                        assert.ok(rendered.includes('green   tasks'), 'the green marker + census id render');
                        assert.ok(rendered.includes('counts match'), 'the counts verdict renders');
                } finally {
                        await exported.fixture.cleanup();
                }
        });
});
