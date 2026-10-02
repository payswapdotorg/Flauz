/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The capability matrix semantics (A-PROD-005-W1): the rows DERIVE from the
 * real registry surfaces (the live manifests' contributed commands), the
 * unknown/drift disclosure fixtures, the unsupported-boundary honesty
 * assertions (the three statements the work order names verbatim), the
 * artifact persistence, and the REAL-REPO local-real receipt (the catalog
 * closed over the live 15-extension product).
 */

import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';

import { runMatrix, persistMatrix, renderMatrix, deriveMatrix, type MatrixRow } from '../src/matrix.ts';
import { CAPABILITY_CATALOG, catalogClosure } from '../src/capabilities.ts';
import { readProductState } from '../src/productState.ts';
import { nodeProductionFs, steppingClock, repoRoot, bootFixtureProduct, bootFixtureWorkspace, fixtureVersions } from './helpers.ts';

const fs = nodeProductionFs();
const clock = steppingClock();

suite('A-PROD-005-W1 capability matrix: the derivation law', () => {
        test('the catalog hygiene is closed: unique ids, every command claimed exactly once, non-empty statements', () => {
                const closure = catalogClosure();
                assert.deepEqual(closure.problems, [], 'the catalog carries no hygiene problems');
                assert.ok(closure.closed);
                assert.ok(closure.capabilityCount >= 25, `a real product catalog (got ${String(closure.capabilityCount)} entries)`);
                assert.ok(closure.commandCount >= 60, `the catalog claims the product's command surface (got ${String(closure.commandCount)} commands)`);
        });

        test('rows derive from the registry: a fixture product carrying catalog-claimed commands yields documented rows', async () => {
                // the fixture product's flauz-alpha contributes the backup/export + telemetry commands the catalog claims
                const product = await bootFixtureProduct({ alphaCommands: ['flauz.backup.export', 'flauz.backup.verify', 'flauz.telemetry.config'] });
                try {
                        const state = await readProductState(product.root, fs);
                        assert.ok(state !== undefined);
                        const matrix = deriveMatrix(state);
                        assert.equal(matrix.ok, false, 'the fixture carries only a slice of the catalog -> drift rows exist');
                        const backupRow = matrix.rows.find(row => row.id === 'backup-export');
                        assert.ok(backupRow !== undefined);
                        assert.equal(backupRow.status, 'documented', 'the backup-export entry matches its live commands');
                        assert.deepEqual(backupRow.commands, ['flauz.backup.export', 'flauz.backup.verify']);
                        const telemetryRow = matrix.rows.find(row => row.id === 'telemetry-config');
                        assert.equal(telemetryRow?.status, 'documented');
                        // a catalog entry whose commands are NOT in the fixture = drift
                        const driftRows = matrix.rows.filter(row => row.status === 'drift');
                        assert.ok(driftRows.length > 0, 'the absent slice of the catalog drifts');
                        assert.ok(driftRows.every(row => row.reason !== undefined && row.reason.includes('absent from the live product surface')));
                } finally {
                        await product.cleanup();
                }
        });

        test('an unknown live command is a typed UNKNOWN disclosure and holds the verdict NOT-CLOSED', async () => {
                // flauz-beta carries a catalog-claimed command so the ONLY unknown
                // live command is the mystery one (exactly one disclosure)
                const product = await bootFixtureProduct({ alphaCommands: ['flauz.backup.export', 'flauz.mystery.unknownThing'], betaCommands: ['flauz.backup.verify'] });
                try {
                        const state = await readProductState(product.root, fs);
                        assert.ok(state !== undefined);
                        const matrix = deriveMatrix(state);
                        assert.equal(matrix.ok, false);
                        assert.equal(matrix.counts.unknownCount, 1);
                        const unknownRow = matrix.rows.find(row => row.status === 'unknown');
                        assert.ok(unknownRow !== undefined);
                        assert.equal(unknownRow.id, 'undocumented:flauz-alpha');
                        assert.deepEqual(unknownRow.commands, ['flauz.mystery.unknownThing']);
                        assert.ok(unknownRow.reason?.includes('NO catalog entry claims'), 'the reason names the disclosure');
                        assert.ok(unknownRow.reason?.includes('flauz.mystery.unknownThing'), 'the reason names the exact command');
                        assert.ok(unknownRow.unsupported.includes('refuses to guess'), 'the unknown row refuses to guess a boundary');
                        const lines = renderMatrix(matrix);
                        assert.ok(lines.some(line => line.includes('[UNKNOWN  ]')), 'the render marks the unknown row');
                } finally {
                        await product.cleanup();
                }
        });

        test('an unparseable manifest contributes NO commands (the reader never guesses a surface)', async () => {
                const product = await bootFixtureProduct({ alphaCommands: ['flauz.backup.export'] });
                try {
                        const state = await readProductState(product.root, fs);
                        assert.ok(state !== undefined);
                        // corrupt flauz-alpha's manifest after the fact
                        const fsx = await import('node:fs/promises');
                        await fsx.writeFile(`${product.root}/extensions/flauz-alpha/package.json`, '{ not json', 'utf-8');
                        const corrupted = await readProductState(product.root, fs);
                        assert.ok(corrupted !== undefined);
                        const matrix = deriveMatrix(corrupted);
                        const backupRow = matrix.rows.find(row => row.id === 'backup-export');
                        assert.equal(backupRow?.status, 'drift', 'the command vanished from the live surface -> drift');
                } finally {
                        await product.cleanup();
                }
        });
});

suite('A-PROD-005-W1 capability matrix: the honesty law (the unsupported boundaries)', () => {
        test('every catalog entry carries a non-empty supported envelope AND a non-empty unsupported boundary', () => {
                for (const entry of CAPABILITY_CATALOG) {
                        assert.ok(entry.supported.length > 20, `${entry.id}: the supported envelope is substantive`);
                        assert.ok(entry.unsupported.length > 20, `${entry.id}: the unsupported boundary is substantive`);
                }
        });

        test('the three named honest boundaries are stated verbatim-class: restores are drill-suite-only; the transform registry is empty; telemetry is local-only', () => {
                const restore = CAPABILITY_CATALOG.find(entry => entry.id === 'backup-restore');
                assert.ok(restore !== undefined);
                assert.ok(restore.unsupported.includes('DRILL-SUITE-ONLY'), 'the restore boundary names the drill-suite-only posture');
                const migration = CAPABILITY_CATALOG.find(entry => entry.id === 'migration-plan');
                assert.ok(migration !== undefined);
                assert.ok(migration.unsupported.includes('TRANSFORM REGISTRY IS EMPTY'), 'the migration boundary names the empty transform registry');
                assert.ok(migration.unsupported.includes('mismatch is a REFUSAL'), 'the migration boundary names the refusal semantics');
                const telemetry = CAPABILITY_CATALOG.find(entry => entry.id === 'telemetry-local-record');
                assert.ok(telemetry !== undefined);
                assert.ok(telemetry.unsupported.includes('LOCAL-ONLY AND NEVER LEAVES THE MACHINE'), 'the telemetry boundary names the local-only law');
                const updateCheck = CAPABILITY_CATALOG.find(entry => entry.id === 'release-update-check');
                assert.ok(updateCheck !== undefined);
                assert.ok(updateCheck.unsupported.includes('NEVER performs the update'), 'the update-check boundary names the never-updates law');
        });

        test('this wave\'s own rows state their honest boundaries (the census degradation, the matrix derivation, the gate\'s never-green-silent law)', () => {
                const census = CAPABILITY_CATALOG.find(entry => entry.id === 'production-census');
                assert.ok(census?.unsupported.includes('DEGRADES TYPED, never silently green'));
                const matrix = CAPABILITY_CATALOG.find(entry => entry.id === 'production-matrix');
                assert.ok(matrix?.unsupported.includes('refuses to guess'));
                const gate = CAPABILITY_CATALOG.find(entry => entry.id === 'production-gate');
                assert.ok(gate?.unsupported.includes('NEVER silently greens'));
        });
});

suite('A-PROD-005-W1 capability matrix: the artifact + the real-repo receipt', () => {
        test('persistMatrix writes the machine-readable artifact + banks it census-visible', async () => {
                const product = await bootFixtureProduct({ alphaCommands: ['flauz.backup.export'] });
                const workspace = await bootFixtureWorkspace();
                try {
                        const result = await runMatrix({ root: workspace.root, fs, clock, productRoot: product.root });
                        const persisted = await persistMatrix({ root: workspace.root, fs, clock }, fixtureVersions(), result);
                        assert.ok(persisted.artifactPath.includes('.flauz/production/matrix-'), `the artifact lands in the production dir (${persisted.artifactPath})`);
                        const reRead = await fs.readFileUtf8(persisted.artifactPath);
                        assert.ok(reRead !== undefined);
                        const parsed = JSON.parse(reRead as string) as Record<string, unknown>;
                        assert.equal(parsed.$schema, 'flauz.production-matrix/v1');
                        assert.equal(parsed.commandLine, 'flauz.production.matrix');
                        assert.ok(Array.isArray(parsed.rows) && (parsed.rows as MatrixRow[]).length === result.rows.length);
                        const ledgerText = await fs.readFileUtf8(`${workspace.root}/.flauz/evidence/ledger.jsonl`);
                        assert.ok(ledgerText !== undefined && ledgerText.includes('"taskId":"flauz-production"'), 'the banked ledger row carries the production taskId');
                } finally {
                        await product.cleanup();
                        await workspace.cleanup();
                }
        });

        test('THE REAL-REPO RECEIPT: the matrix over the live repo product is CLOSED -- every live capability documented, every documented capability live', async () => {
                const state = await readProductState(repoRoot, fs);
                assert.ok(state !== undefined, 'the repo root is a repo-state product registry');
                const matrix = deriveMatrix(state);
                assert.deepEqual(matrix.catalogProblems, [], 'the catalog hygiene is closed');
                assert.equal(matrix.counts.unknownCount, 0, `no undocumented live commands (unknown rows: ${JSON.stringify(matrix.rows.filter(row => row.status === 'unknown'))})`);
                assert.equal(matrix.counts.driftCount, 0, `no drifted catalog entries (drift rows: ${JSON.stringify(matrix.rows.filter(row => row.status === 'drift').map(row => row.id))})`);
                assert.equal(matrix.counts.documentedCount, CAPABILITY_CATALOG.length);
                assert.equal(matrix.ok, true, 'the matrix over the real product closes');
                const lines = renderMatrix(matrix);
                assert.ok(lines.some(line => line.includes('CLOSED (every live capability documented')));
        });

        test('THE REAL-REPO RECEIPT: the matrix counts the live command surface (the derivation reads the manifests, not the catalog)', async () => {
                const state = await readProductState(repoRoot, fs);
                assert.ok(state !== undefined);
                const liveCommands = new Set<string>();
                for (const extension of state.extensions) {
                        for (const command of extension.commands) {
                                liveCommands.add(command);
                        }
                }
                const matrix = deriveMatrix(state);
                const claimedCommands = new Set<string>();
                for (const entry of CAPABILITY_CATALOG) {
                        for (const command of entry.commands) {
                                claimedCommands.add(command);
                        }
                }
                assert.equal(matrix.counts.unknownCount, 0);
                // the closure over both directions is exactly the set equality
                assert.deepEqual([...liveCommands].sort(), [...claimedCommands].sort(), 'the live command surface and the catalog claims are equal (both directions)');
        });
});
