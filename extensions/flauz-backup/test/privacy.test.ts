/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W2 -- the CANARY SWEEP suite (G8, the split-sided privacy law).
 *
 * Secret-shaped canaries are assembled from FRAGMENTS at runtime (no complete
 * secret shape is ever spelled out in this source file) and planted in the
 * REAL durable state through its owning services' own free-form fields (a
 * task event payload, an orchestration step output). THE LAW UNDER TEST:
 *
 *   - a planted secret IS faithfully inside the state copy (a backup's
 *     honesty -- contents are the job);
 *   - the planted secret NEVER appears in any metadata surface (export.json,
 *     MANIFEST.json, integrity.json), in the banked recovery record, or in
 *     any command render (counts, hashes, paths and ids only);
 *   - the fail-closed backstop: a secret-shaped value that WOULD reach a
 *     metadata artifact refuses the whole operation with the typed error.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type * as vscode from 'vscode';
import { BackupError } from '../src/api.ts';
import { createExport } from '../src/export.ts';
import { restoreExport } from '../src/restore.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { registerBackupCommands, type BackupCommandServices } from '../src/commands.ts';
import { setVscodeApi } from '../src/globals.ts';
import { bootFixtureWorkspace, fixtureVersions, readAllFiles, type FixtureWorkspace } from './helpers.ts';

/** Assembles a GitHub-token-shaped canary from fragments (never a complete literal in source). */
function ghCanary(): string {
        return ['ghp_', 'FlauzCanary', 'NeverShips0011223344'].join('');
}

/** Assembles an OpenAI-key-shaped canary from fragments. */
function skCanary(): string {
        return ['sk-', 'flauz', '-canary-000111222333444'].join('');
}

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

suite('privacy: the split-sided canary sweep over the real durable state', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                // both canaries are planted in real free-form fields at construction time
                fixture = await bootFixtureWorkspace({ canaries: [ghCanary(), skCanary()] });
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('G8: a secret planted in the durable state IS in the state copy (a backup\'s honesty) and NEVER in any metadata surface', async () => {
                const result = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });

                // the canaries ARE in the durable state (the plant took, through the real services)
                const durableFiles = await readAllFiles(path.join(fixture.root, '.flauz'));
                const durableBytes = durableFiles.filter(file => !file.path.includes('.flauz-exports')).map(file => file.text).join('\n');
                assert.ok(durableBytes.includes(ghCanary()), 'the gh-shaped canary is really in the durable state (task event payload)');
                assert.ok(durableBytes.includes(skCanary()), 'the sk-shaped canary is really in the durable state (step output)');

                // ...and they ARE faithfully inside the state copy (the backup did its job)
                const stateFiles = await readAllFiles(path.join(result.exportDir, 'state'));
                const stateBytes = stateFiles.map(file => file.text).join('\n');
                assert.ok(stateBytes.includes(ghCanary()), 'the gh-shaped canary IS inside the state copy (honesty)');
                assert.ok(stateBytes.includes(skCanary()), 'the sk-shaped canary IS inside the state copy (honesty)');

                // ...but NEVER in the metadata surfaces
                for (const metadataFile of ['export.json', 'MANIFEST.json', 'integrity.json'] as const) {
                        const text = await fs.readFile(path.join(result.exportDir, metadataFile), 'utf-8');
                        assert.ok(!text.includes(ghCanary()), `${metadataFile} leaks the gh-shaped canary`);
                        assert.ok(!text.includes(skCanary()), `${metadataFile} leaks the sk-shaped canary`);
                }
        });

        test('the banked recovery record + the restore result never carry the canaries either', async () => {
                // export, corrupt a surface, restore with consent -- the banking path runs
                const good = await createExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() });
                const tasksPath = path.join(fixture.root, '.flauz', 'tasks.json');
                await fs.writeFile(tasksPath, (await fs.readFile(tasksPath, 'utf-8')).slice(0, 40), 'utf-8');
                const result = await restoreExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, good.exportDirName, { overwrite: true });

                const recoveryLog = await fs.readFile(path.join(fixture.root, '.flauz', 'backup', 'recovery-log.jsonl'), 'utf-8');
                assert.ok(!recoveryLog.includes(ghCanary()), 'the recovery record never carries the gh canary');
                assert.ok(!recoveryLog.includes(skCanary()), 'the recovery record never carries the sk canary');
                const resultText = JSON.stringify(result);
                assert.ok(!resultText.includes(ghCanary()) && !resultText.includes(skCanary()), 'the restore result never carries either canary');
        });

        test('the command renders never carry the canaries (the metadata law extends to logs)', async () => {
                const lines: string[] = [];
                const services: BackupCommandServices = {
                        fs: fixture.fs,
                        clock: fixture.clock,
                        channel: { appendLine: line => { lines.push(line); } },
                        getWorkspaceRoot: () => fixture.root,
                        versions: () => fixtureVersions(),
                };
                const { registered } = vscodeShim();
                registerBackupCommands(services);
                await (registered.get('flauz.backup.export') as (arg: unknown) => Promise<unknown>)(undefined);
                await (registered.get('flauz.backup.verify') as (arg: unknown) => Promise<unknown>)(undefined);
                await (registered.get('flauz.backup.restore') as (arg: unknown) => Promise<unknown>)({ overwrite: true });
                const rendered = lines.join('\n');
                assert.ok(!rendered.includes(ghCanary()), 'the channel renders never carry the gh canary');
                assert.ok(!rendered.includes(skCanary()), 'the channel renders never carry the sk canary');
        });

        test('the fail-closed backstop: a secret-shaped value that WOULD reach a metadata artifact refuses the operation with the typed error', async () => {
                assert.throws(
                        () => sweepArtifact({ note: `token ${ghCanary()} was here` }, 'poisoned.json'),
                        (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_SECRET_SHAPED');
                                assert.match(err.message, /secret-shaped literal refused/);
                                return true;
                        },
                );
        });

        test('a secret-shaped WORKSPACE PATH would ride export.json -- the sweep refuses the whole export (typed, nothing written)', async () => {
                // export.json honestly records the workspace root path; when a path segment is
                // secret-shaped (a token-named checkout dir -- a real-world shape), the pre-write
                // sweep refuses the ENTIRE export rather than let it ride the metadata
                const poisonBase = await fs.mkdtemp(path.join(os.tmpdir(), `${ghCanary()}-`));
                const poisoned = await bootFixtureWorkspace({ rootDir: poisonBase });
                try {
                        await assert.rejects(createExport({ root: poisoned.root, fs: poisoned.fs, clock: poisoned.clock, versions: fixtureVersions() }), (err: unknown) => {
                                assert.ok(err instanceof BackupError);
                                assert.strictEqual(err.code, 'FLAUZ_BACKUP_SECRET_SHAPED');
                                assert.match(err.message, /export\.json/);
                                return true;
                        });
                        // the refusal created no export directory
                        const exports = await fs.readdir(path.join(poisoned.root, '.flauz-exports')).catch(() => []);
                        assert.deepStrictEqual(exports, [], 'the refusal wrote nothing');
                } finally {
                        await poisoned.cleanup();
                        await fs.rm(poisonBase, { recursive: true, force: true });
                }
        });

        test('a secret inside a MALFORMED ledger line stays in the state copy and never rides the metadata (the shape-safe capture discipline)', async () => {
                // Node's JSON.parse error text is POSITION-ONLY (no source snippet on this V8),
                // and the parse-error captures the census/manifest paths embed exactly that
                // message -- so a secret inside a malformed line cannot ride the metadata; this
                // test PINS that discipline (if a future V8 ever embeds source, the sweep flips
                // this to a typed refusal and this test forces a conscious re-adjudication)
                const poisoned = await bootFixtureWorkspace();
                try {
                        const ledgerPath = path.join(poisoned.root, '.flauz', 'evidence', 'ledger.jsonl');
                        const text = await fs.readFile(ledgerPath, 'utf-8');
                        await fs.writeFile(ledgerPath, `${text}{"seq":"${ghCanary()}"\n`, 'utf-8');
                        const result = await createExport({ root: poisoned.root, fs: poisoned.fs, clock: poisoned.clock, versions: fixtureVersions() });
                        // the malformed secret-carrying line IS faithfully inside the state copy (a backup's honesty)
                        const ledgerCopy = await fs.readFile(path.join(result.exportDir, 'state/.flauz/evidence/ledger.jsonl'), 'utf-8');
                        assert.ok(ledgerCopy.includes(ghCanary()), 'the malformed secret-carrying line IS in the state copy');
                        // ...and never in any metadata surface
                        for (const metadataFile of ['export.json', 'MANIFEST.json', 'integrity.json'] as const) {
                                const metaText = await fs.readFile(path.join(result.exportDir, metadataFile), 'utf-8');
                                assert.ok(!metaText.includes(ghCanary()), `${metadataFile} never carries the canary`);
                        }
                        // the manifest's ledger counts honestly record the parse error -- position text only
                        const manifest = JSON.parse(await fs.readFile(path.join(result.exportDir, 'MANIFEST.json'), 'utf-8')) as { surfaces: { surface: string; counts: { parseError?: string } }[] };
                        const ledgerCounts = manifest.surfaces.find(entry => entry.surface === 'evidenceLedger')?.counts;
                        assert.ok(ledgerCounts?.parseError !== undefined, 'the manifest honestly records the ledger parse error');
                        assert.ok(!ledgerCounts.parseError.includes(ghCanary()), 'the parse-error capture is shape-safe (position text only)');
                } finally {
                        await poisoned.cleanup();
                }
        });

        test('the sweep is deep: nested arrays and objects are walked, and every known credential shape is caught', () => {
                // the pattern list parity: every shape class the flauz-resources discipline names
                const shapes: string[] = [
                        ghCanary(), // ghp_ classic
                        ['github_pat_', 'FlauzCanaryNeverShips', '_0011223344556677'].join(''), // github fine-grained
                        skCanary(), // OpenAI-style
                        ['sk-ant-', 'flauzcanary', 'never-ships-000111'].join(''), // Anthropic-style
                        ['AKIA', 'FLAUZCANARY00011'].join(''), // AWS access key (16 uppercase/digit chars after the prefix)
                        ['xoxb-', 'flauz-canary-00011122'].join(''), // Slack token
                        ['-----BEGIN', ' RSA PRIVATE KEY-----'].join(''), // PEM private key
                        ['Bearer ', 'flauz-canary-00011122233344'].join(''), // bearer header
                        ['eyJ', 'flauz-canary', '.', '000111222aaabbbccc', '.', 'dddeeefff000111222333'].join(''), // JWT
                ];
                for (const shape of shapes) {
                        assert.ok(looksSecretShaped(shape), `the shape class of ${String(shape.slice(0, 12))}... is detected`);
                        assert.throws(() => sweepArtifact({ deep: { list: [shape] } }, 'deep.json'), /secret-shaped literal refused/);
                }
                // and benign strings never trip it (no false-positive wall)
                for (const benign of ['ordinary note', 'sha256:5d41402abc4b2a76b9719d911017c592', 'https://example.invalid/search?q=flauz', 'bearer of good news', 'sk-small']) {
                        assert.ok(!looksSecretShaped(benign), `${benign} is not secret-shaped`);
                }
        });
});
