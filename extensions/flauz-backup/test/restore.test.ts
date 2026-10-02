/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W2 -- the RESTORE-SEMANTICS suite (local-real): the crash
 * fixture (a corrupted surface) recovers byte-identical from the last good
 * export; tampered exports refused; non-empty targets refused without
 * consent; the recovery record banked (and the next diagnostics census
 * reports it).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type * as vscode from 'vscode';
import { BackupError, RECOVERY_LOG_PATH, RECOVERY_TASK_ID, joinPath } from '../src/api.ts';
import { createExport } from '../src/export.ts';
import { restoreExport, serializeWatermark, type RestoreResult } from '../src/restore.ts';
import { verifyLedgerChain, parseLedgerLine, ledgerRowHash } from '../src/verify.ts';
import { registerBackupCommands, type BackupCommandServices } from '../src/commands.ts';
import { setVscodeApi } from '../src/globals.ts';
import { collectDiagnostics } from '../../flauz-diagnostics/src/census.ts';
import { parseWatermark, type LedgerWatermark } from '../../flauz-workspace/src/hardening.ts';
import { bootFixtureWorkspace, corruptSurfaces, fixtureVersions, readAllFiles, type FixtureWorkspace } from './helpers.ts';

function vscodeShim(): { registered: Map<string, (arg: unknown) => Promise<unknown>> } {
        const registered = new Map<string, (arg: unknown) => Promise<unknown>>();
        const shim = {
                commands: {
                        registerCommand(id: string, handler: (arg: unknown) => Promise<unknown>): object {
                                registered.set(id, handler);
                                return { dispose(): void { /* noop */ } };
                        },
                },
        };
        setVscodeApi(shim as unknown as typeof vscode);
        return { registered };
}

async function snapshotState(root: string): Promise<Map<string, string>> {
        const files = await readAllFiles(path.join(root, '.flauz'));
        return new Map(files.map(file => [path.relative(root, file.path).split(path.sep).join('/'), file.text]));
}

async function censusOver(fsPort: FixtureWorkspace['fs'], root: string): Promise<Record<string, Record<string, unknown>> & { durableState: Record<string, Record<string, unknown>> }> {
        const diagnostics = await collectDiagnostics({
                root,
                fs: fsPort,
                clock: () => 1_740_000_000_000,
                versions: fixtureVersions(),
                environment: { nodeVersion: '24.21.0', platform: 'linux', arch: 'x64' },
        });
        return JSON.parse(JSON.stringify(diagnostics.durableState)) as never;
}

suite('restore: the crash-recovery path over the real durable state', () => {

        test('THE CRASH FIXTURE: a corrupted surface recovers byte-identical from the last good export + the recovery record is banked', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        // the last good export, taken while healthy
                        const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                        const goodTasks = await fs.readFile(path.join(good.exportDir, 'state/.flauz/tasks.json'), 'utf-8');
                        const goodLedger = await fs.readFile(path.join(good.exportDir, 'state/.flauz/evidence/ledger.jsonl'), 'utf-8');
                        const preCrashCensus = await censusOver(fixture.fs, fixture.root);
                        // the crash: the tasks envelope truncated mid-JSON, the ledger tail torn
                        await corruptSurfaces(fixture.root);
                        const corruptedTasks = await fs.readFile(path.join(fixture.root, '.flauz', 'tasks.json'), 'utf-8');
                        assert.notStrictEqual(corruptedTasks, goodTasks, 'the corruption really changed the bytes');

                        // restore WITH consent (the corrupted targets are non-empty)
                        const result = await restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName, { overwrite: true });

                        // the corrupted surface is byte-identical again
                        assert.strictEqual(await fs.readFile(path.join(fixture.root, '.flauz', 'tasks.json'), 'utf-8'), goodTasks, 'tasks.json recovered byte-identical');
                        // the ledger: the export's bytes + EXACTLY ONE banked recovery row (prefix identity)
                        const restoredLedger = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.ok(restoredLedger.startsWith(goodLedger), 'the restored ledger is the exported ledger (prefix identity)');
                        const lines = restoredLedger.split('\n').filter(line => line !== '');
                        assert.strictEqual(lines.length, goodLedger.split('\n').filter(line => line !== '').length + 1, 'exactly one recovery row was banked');
                        // the recovery row chains: parsed by the OWNING-format parser, prev = the exported head
                        const recoveryRowOutcome = parseLedgerLine(lines[lines.length - 1] as string, lines.length);
                        assert.ok(recoveryRowOutcome.ok, 'the recovery row parses as a real owning-format row');
                        const recoveryRow = recoveryRowOutcome.ok ? recoveryRowOutcome.row : null;
                        assert.strictEqual(recoveryRow?.taskId, RECOVERY_TASK_ID, 'the synthetic flauz-backup taskId (the flauz.ledger precedent)');
                        assert.strictEqual(recoveryRow?.kind, 'note');
                        assert.strictEqual(recoveryRow?.uri, RECOVERY_LOG_PATH, 'the row points at the recovery log');
                        assert.strictEqual(recoveryRow?.prev, await onDiskLedgerHeadFrom(goodLedger), 'the row chains onto the exported head');

                        // the durable recovery record landed
                        const recoveryLog = await fs.readFile(path.join(fixture.root, RECOVERY_LOG_PATH), 'utf-8');
                        const record = JSON.parse(recoveryLog.split('\n').filter(line => line !== '')[0] as string) as { $schema: string; exportDir: string; surfaces: string[]; commandLine: string };
                        assert.strictEqual(record.$schema, 'flauz.backup-recovery/v0');
                        assert.strictEqual(record.exportDir, good.exportDirName);
                        assert.strictEqual(record.commandLine, 'flauz.backup.restore');
                        assert.ok(record.surfaces.includes('tasks') && record.surfaces.includes('evidenceLedger'));

                        // THE CENSUS-REPORT LAW: the next diagnostics census reports the recovery
                        const postCensus = await censusOver(fixture.fs, fixture.root);
                        const pre = preCrashCensus.evidenceLedger as Record<string, unknown>;
                        const post = postCensus.evidenceLedger as Record<string, unknown>;
                        assert.strictEqual(post.rowCount, (pre.rowCount as number) + 1, 'census rowCount moved');
                        assert.deepStrictEqual(post.kindCounts, { ...(pre.kindCounts as Record<string, number>), note: ((pre.kindCounts as Record<string, number>).note ?? 0) + 1 }, 'census kindCounts reports the banked note');
                        assert.notStrictEqual(post.headSha256, pre.headSha256, 'census head moved');
                        assert.strictEqual(result.banked.ledgerRowSeq, lines.length, 'the result carries the banked seq');

                        // post-restore integrity: the ledger chain is GREEN over the recovered + banked state
                        const verdict = await verifyLedgerChain(fixture.root, fixture.fs);
                        assert.strictEqual(verdict.ok, true, 'the post-restore ledger chain verifies clean');
                        assert.strictEqual(verdict.rows, lines.length);
                } finally {
                        await fixture.cleanup();
                }
        });

        test('THE HARDENED VARIANT: a workspace with a size watermark restores + banks with the watermark resynced (verdicts stay GREEN)', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        // write the DL-20 hardening watermark by hand (the owning unsigned format) over the healthy ledger
                        const ledgerText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const rows = [];
                        for (const [index, line] of ledgerText.split('\n').filter(line => line !== '').entries()) {
                                const outcome = parseLedgerLine(line, index + 1);
                                if (outcome.ok) {
                                        rows.push(outcome.row);
                                }
                        }
                        const head = rows.length === 0 ? null : ledgerRowHash(rows[rows.length - 1] as never);
                        const watermark: LedgerWatermark = {
                                $schema: 'flauz.evidence.size/v1',
                                rowCount: rows.length,
                                bytes: Buffer.byteLength(ledgerText, 'utf-8'),
                                headSha256: head ?? '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a',
                                lastCheckpointSeq: null,
                                updatedAt: fixture.clock(),
                        };
                        await fs.writeFile(path.join(fixture.root, '.flauz', 'evidence', 'size.json'), serializeWatermark(watermark), 'utf-8');

                        const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                        // the crash DESTROYS the whole .flauz/ tree
                        await fs.rm(path.join(fixture.root, '.flauz'), { recursive: true });

                        // restore into the now-empty workspace (no consent needed: every target is absent)
                        const result = await restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName, {});
                        assert.strictEqual(result.nonEmptyTargets.length, 0, 'an emptied target needs no consent');
                        assert.strictEqual(result.banked.watermarkUpdated, true, 'the watermark was resynced');

                        // the restored watermark parses with the OWNING strict parser and describes the post-banking ledger
                        const restoredWatermark = parseWatermark(JSON.parse(await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'size.json'), 'utf-8')));
                        const restoredLedger = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.strictEqual(restoredWatermark.rowCount, rows.length + 1, 'rowCount + the banked recovery row');
                        assert.strictEqual(restoredWatermark.bytes, Buffer.byteLength(restoredLedger, 'utf-8'), 'the resynced byte count matches the on-disk ledger');

                        // and the chain verdict (watermark comparison included) is GREEN
                        const verdict = await verifyLedgerChain(fixture.root, fixture.fs);
                        assert.strictEqual(verdict.ok, true, 'the hardened post-restore ledger verifies clean (watermark ok)');
                        assert.strictEqual(verdict.watermark?.status, 'ok');

                        // the census reports both the watermark and the banked row
                        const census = await censusOver(fixture.fs, fixture.root);
                        assert.strictEqual((census.evidenceWatermark as Record<string, unknown>).recordedRowCount, rows.length + 1);
                        assert.strictEqual((census.evidenceLedger as Record<string, unknown>).rowCount, rows.length + 1);
                } finally {
                        await fixture.cleanup();
                }
        });

        test('a TAMPERED export is refused with the typed error and NOTHING is written to the target', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                        // the tamper: edit a copied state file after creation
                        const graphPath = path.join(good.exportDir, 'state/.flauz/resources.json');
                        const graph = JSON.parse(await fs.readFile(graphPath, 'utf-8')) as { nodes: unknown[] };
                        graph.nodes.push({ kind: 'task', id: 'flauz:task:T-999' });
                        await fs.writeFile(graphPath, `${JSON.stringify(graph, null, 2)}\n`, 'utf-8');
                        const before = await snapshotState(fixture.root);
                        await assert.rejects(restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName, { overwrite: true }), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_TAMPERED');
                                assert.match(err.message, /restore REFUSED/);
                                return true;
                        });
                        const after = await snapshotState(fixture.root);
                        assert.deepStrictEqual([...after.entries()].sort(), [...before.entries()].sort(), 'the target is untouched (no partial restore, no banking)');
                } finally {
                        await fixture.cleanup();
                }
        });

        test('NON-EMPTY targets are refused without the explicit consent (and nothing is written); consent proceeds', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                        const before = await snapshotState(fixture.root);
                        // no consent -> the typed refusal
                        await assert.rejects(restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_TARGET_NOT_EMPTY');
                                assert.match(err.message, /\.flauz\/tasks\.json/);
                                assert.match(err.message, /overwrite/);
                                return true;
                        });
                        const after = await snapshotState(fixture.root);
                        assert.deepStrictEqual([...after.entries()].sort(), [...before.entries()].sort(), 'nothing was written by the refusal');
                        // consent -> the restore proceeds
                        const result = await restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName, { overwrite: true });
                        assert.ok(result.restoredFileCount >= 14);
                        assert.ok(result.nonEmptyTargets.includes('.flauz/tasks.json'), 'the result reports the overwritten targets');
                } finally {
                        await fixture.cleanup();
                }
        });

        test('surfaces ABSENT in the export are left untouched in the target (reported, never faked, never deleted)', async () => {
                // workspace A: no browser sessions, no workflows dir
                const a = await bootFixtureWorkspace();
                // workspace B (the target): the full state
                const b = await bootFixtureWorkspace();
                try {
                        await fs.rm(path.join(a.root, '.flauz', 'browser-sessions.jsonl'));
                        await fs.rm(path.join(a.root, '.flauz', 'workflows'), { recursive: true });
                        const exportResult = await createExport({ root: a.root, fs: a.fs, clock: a.clock, versions: fixtureVersions() });
                        const bBrowserBefore = await fs.readFile(path.join(b.root, '.flauz', 'browser-sessions.jsonl'), 'utf-8');
                        const bWorkflowsBefore = new Map<string, string>();
                        for (const name of (await fs.readdir(path.join(b.root, '.flauz', 'workflows'))).sort()) {
                                bWorkflowsBefore.set(name, await fs.readFile(path.join(b.root, '.flauz', 'workflows', name), 'utf-8'));
                        }

                        const result = await restoreExport({ root: b.root, fs: b.fs, clock: b.clock }, exportResult.exportDir, { overwrite: true });

                        // the absent-in-export surface SURVIVED byte-identical
                        assert.strictEqual(await fs.readFile(path.join(b.root, '.flauz', 'browser-sessions.jsonl'), 'utf-8'), bBrowserBefore, 'browser-sessions.jsonl was left untouched');
                        // the report says so
                        const absentBrowser = result.leftAbsent.find(entry => entry.surface === 'browserSessions');
                        assert.ok(absentBrowser !== undefined, 'the result reports the left-untouched surface');
                        assert.deepStrictEqual(absentBrowser?.absentFiles, ['.flauz/browser-sessions.jsonl']);
                        // the workflows surface (absent in the export) was left untouched too: B's own
                        // envelopes survive byte-identical (never deleted, never replaced, never faked)
                        const bWorkflowsAfter = (await fs.readdir(path.join(b.root, '.flauz', 'workflows'))).sort();
                        assert.deepStrictEqual(bWorkflowsAfter, [...bWorkflowsBefore.keys()], 'B\'s own workflows files survive untouched (never deleted)');
                        for (const [name, text] of bWorkflowsBefore.entries()) {
                                assert.strictEqual(await fs.readFile(path.join(b.root, '.flauz', 'workflows', name), 'utf-8'), text, `workflows/${name} is byte-identical (left untouched, never faked)`);
                        }
                        const absentWorkflows = result.leftAbsent.find(entry => entry.surface === 'workflows');
                        assert.ok(absentWorkflows !== undefined, 'the result reports the left-untouched workflows surface');
                        assert.deepStrictEqual(absentWorkflows?.absentFiles, ['.flauz/workflows/index.json'], 'the workflows surface reports its absent fixed file');
                        // and the restored surfaces carry A's bytes
                        const aTasks = await fs.readFile(path.join(a.root, '.flauz', 'tasks.json'), 'utf-8');
                        assert.strictEqual(await fs.readFile(path.join(b.root, '.flauz', 'tasks.json'), 'utf-8'), aTasks, 'the target tasks.json is A\'s byte-identical copy');
                } finally {
                        await a.cleanup();
                        await b.cleanup();
                }
        });

        test('a FRESH empty workspace restores without consent; an export WITHOUT a ledger banks row 1 (created) and the census reports it', async () => {
                // workspace A: no evidence ledger at all
                const a = await bootFixtureWorkspace();
                const fresh = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-fresh-'));
                try {
                        await fs.rm(path.join(a.root, '.flauz', 'evidence'), { recursive: true });
                        const exportResult = await createExport({ root: a.root, fs: a.fs, clock: a.clock, versions: fixtureVersions() });
                        const manifest = JSON.parse(await fs.readFile(path.join(exportResult.exportDir, 'MANIFEST.json'), 'utf-8')) as { surfaces: { surface: string; present: boolean }[] };
                        assert.strictEqual(manifest.surfaces.find(surface => surface.surface === 'evidenceLedger')?.present, false, 'the export honestly records the absent ledger');

                        const result = await restoreExport({ root: fresh, fs: a.fs, clock: a.clock }, exportResult.exportDir, {});
                        assert.strictEqual(result.nonEmptyTargets.length, 0, 'a fresh target needs no consent');
                        assert.strictEqual(result.banked.ledgerRowSeq, 1, 'banking created the ledger with row 1');
                        assert.strictEqual(result.banked.watermarkUpdated, false, 'no watermark existed to resync');

                        // the created ledger parses + the census reports the banked recovery row
                        const created = await fs.readFile(path.join(fresh, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const outcome = parseLedgerLine(created.split('\n')[0] as string, 1);
                        assert.ok(outcome.ok, 'the created ledger row parses as owning-format');
                        assert.strictEqual(outcome.ok ? outcome.row.prev : undefined, null, 'the genesis row carries prev === null');
                        const census = await censusOver(a.fs, fresh);
                        assert.strictEqual((census.evidenceLedger as Record<string, unknown>).rowCount, 1);
                        assert.deepStrictEqual((census.evidenceLedger as Record<string, unknown>).kindCounts, { note: 1 }, 'the census reports the banked recovery note');
                } finally {
                        await a.cleanup();
                        await fs.rm(fresh, { recursive: true, force: true });
                }
        });

        test('the command surface: flauz.backup.restore renders the plan, the typed refusals surface in the channel, and no-workspace degrades honestly', async () => {
                const fixture = await bootFixtureWorkspace();
                try {
                        const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                        const lines: string[] = [];
                        const services = (): BackupCommandServices => ({
                                fs: fixture.fs,
                                clock: fixture.clock,
                                channel: { appendLine: line => { lines.push(line); } },
                                getWorkspaceRoot: () => fixture.root,
                                versions: () => fixtureVersions(),
                        });
                        const { registered } = vscodeShim();
                        registerBackupCommands(services());
                        const handler = registered.get('flauz.backup.restore') as (arg: unknown) => Promise<unknown>;

                        // the no-consent refusal renders (typed error + channel notice)
                        await assert.rejects(handler({ exportDir: good.exportDirName }), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_TARGET_NOT_EMPTY');
                                return true;
                        });
                        assert.ok(lines.some(line => line.includes('REFUSED') && line.includes('overwrite')), 'the refusal renders the consent gate');

                        // the consented restore renders the result + the banking notice
                        lines.length = 0;
                        const result = await handler({ exportDir: good.exportDirName, overwrite: true }) as { ok: boolean; result: RestoreResult };
                        assert.strictEqual(result.ok, true);
                        assert.ok(lines.some(line => line.includes('flauz.backup.restore: restored')), 'the restore notice renders');
                        assert.ok(lines.some(line => line.includes('the next diagnostics census reports it')), 'the banking notice renders');
                        assert.ok(lines.some(line => line.includes('restored  tasks')), 'the per-surface restore rows render');
                        assert.ok(lines.some(line => line.includes('untouched')), 'the left-untouched surfaces render');

                        // the no-workspace degradation
                        const degraded = vscodeShim();
                        registerBackupCommands({ ...services(), getWorkspaceRoot: () => undefined });
                        const degradedResult = await (degraded.registered.get('flauz.backup.restore') as (arg: unknown) => Promise<unknown>)(undefined) as { ok: boolean; code: string };
                        assert.strictEqual(degradedResult.ok, false);
                        assert.strictEqual(degradedResult.code, 'FLAUZ_BACKUP_NO_WORKSPACE');

                        // the export command disclosure law: the enumeration renders BEFORE the created-at notice
                        lines.length = 0;
                        const exportHandler = registered.get('flauz.backup.export') as (arg: unknown) => Promise<unknown>;
                        await exportHandler(undefined);
                        const disclosureIndex = lines.findIndex(line => line.includes('it will contain'));
                        const createdIndex = lines.findIndex(line => line.includes('export created at'));
                        assert.ok(disclosureIndex >= 0, 'the disclosure header renders');
                        assert.ok(createdIndex > disclosureIndex, 'the disclosure precedes the creation notice');
                        for (const marker of ['MANIFEST.json', 'integrity.json', 'export.json', 'state/', 'privacy law', 'evidenceLedger', 'providerLanesState']) {
                                assert.ok(lines.some(line => line.includes(marker)), `the disclosure names ${marker}`);
                        }
                        assert.ok(lines.some(line => line.includes('[present ] tasks')), 'the surface inventory renders presence');
                } finally {
                        await fixture.cleanup();
                }
        });
});

/** The ledger head hash over an in-memory ledger text (the exported-bytes prefix check). */
async function onDiskLedgerHeadFrom(ledgerText: string): Promise<string> {
        const rows = [];
        for (const [index, line] of ledgerText.split('\n').filter(line => line !== '').entries()) {
                const outcome = parseLedgerLine(line, index + 1);
                if (outcome.ok) {
                        rows.push(outcome.row);
                }
        }
        return rows.length === 0 ? '' : ledgerRowHash(rows[rows.length - 1] as never);
}
