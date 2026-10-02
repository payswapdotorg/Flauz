/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-004-W5 -- the CONTRACT-PIN suite (the DL-32 teeth): every
 * contract-duplicated shape in this extension's src is pinned against the
 * REAL owning module at test time (test-time cross-extension imports are
 * the sanctioned pattern; src never crosses extension boundaries).
 *
 * Pins:
 *   - sha256Hex + canonicalJson + serializeArtifact byte-equal vs node:crypto
 *     and vs the real flauz-workspace/src/api.ts primitives;
 *   - SURFACES == the W1 census enumeration (ids + format versions + order)
 *     and == the real flauz-backup surface registry;
 *   - format.ts byte-identical across the flauz extensions (the PU6 law);
 *   - the census rows + the integrity verdicts equal the REAL
 *     flauz-diagnostics census/verifiers on the same fixture workspace;
 *   - the version inventory equal the REAL flauz-migration machinery;
 *   - the torn detection equal the REAL flauz-migration machinery;
 *   - the fresh self-export CROSS-RECOGNIZABLE in both directions: this
 *     extension's self-export verifies GREEN under the REAL flauz-backup
 *     verifier, and a REAL flauz-backup export verifies GREEN under this
 *     extension's verifier (the W3 anchor cross-recognition precedent);
 *   - the failure taxonomy class-for-class equal the REAL flauz-telemetry
 *     module (ids, labels, surfaces, sourceCodes, remediation);
 *   - the telemetry config state resolution agrees with the REAL
 *     flauz-telemetry loadTelemetryConfig semantics (absent = default-off;
 *     valid = known; corrupt = the typed refusal there, the unknown state
 *     here);
 *   - the banking watermark serialization byte-equal the real
 *     flauz-migration machinery.
 */

import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { canonicalJson, deepSorted, serializeArtifact, sha256Hex, SURFACES, LEDGER_ROW_FORMAT_ID } from '../src/api.ts';
import { collectDurableStateCensus } from '../src/census.ts';
import { collectIntegrity } from '../src/verify.ts';
import { readSurfaceVersions } from '../src/versionInventory.ts';
import { detectTornState } from '../src/torn.ts';
import { createSelfExport } from '../src/selfExport.ts';
import { verifySelfExport } from '../src/selfVerify.ts';
import { readTelemetryConfigState, FAILURE_CLASSES, FAILURE_CLASS_IDS, PROVIDER_ERROR_CODES, ENVIRONMENT_SOURCE_CODES } from '../src/telemetryState.ts';
import { serializeWatermark, type LedgerWatermarkShape } from '../src/banking.ts';

import { canonicalJson as workspaceCanonicalJson, sha256Hex as workspaceSha256Hex } from '../../flauz-workspace/src/api.ts';
import { collectDiagnostics } from '../../flauz-diagnostics/src/census.ts';
import { collectIntegrity as realCollectIntegrity } from '../../flauz-diagnostics/src/verify.ts';
import { readSurfaceVersions as realReadSurfaceVersions } from '../../flauz-migration/src/versionInventory.ts';
import { detectTornState as realDetectTornState } from '../../flauz-migration/src/torn.ts';
import { createExport as realCreateExport, EXPORT_COMMAND_LINE } from '../../flauz-backup/src/export.ts';
import { verifyExport as realVerifyExport } from '../../flauz-backup/src/inspect.ts';
import { loadTelemetryConfig } from '../../flauz-telemetry/src/config.ts';
import { FAILURE_CLASSES as realFailureClasses, FAILURE_CLASS_IDS as realFailureClassIds } from '../../flauz-telemetry/src/failures.ts';
import { serializeWatermark as realSerializeWatermark } from '../../flauz-migration/src/banking.ts';

import { bootFixtureWorkspace, fixtureVersions, plantTornMarker, writeTelemetryConfig, type FixtureWorkspace } from './helpers.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The structural-compat shim: the real migration/backup/telemetry machines' FsPorts carry rename/remove this extension's read-only consultation never performs; the adapter satisfies the shapes without inventing effects (the W3 contract-suite precedent). */
function withSiblingShape(fs: import('../src/api.ts').ReleaseFsPort): { readFileUtf8(path: string): Promise<string | undefined>; readdir(path: string): Promise<readonly string[] | undefined>; mkdir(path: string): Promise<void>; writeFile(path: string, contents: string): Promise<void>; appendFile(path: string, contents: string): Promise<void>; rename(from: string, to: string): Promise<void>; remove(path: string): Promise<void> } {
        return {
                readFileUtf8: path => fs.readFileUtf8(path),
                readdir: path => fs.readdir(path),
                mkdir: path => fs.mkdir(path),
                writeFile: (path, contents) => fs.writeFile(path, contents),
                appendFile: (path, contents) => fs.appendFile(path, contents),
                rename: async () => { throw new Error('the contract shim never renames (the read-only consultation)'); },
                remove: async () => { throw new Error('the contract shim never removes (the read-only consultation)'); },
        };
}

suite('A-PROD-004-W5 contract pins: the duplicated primitives are byte-equal with the owning modules', () => {

        test('sha256Hex is byte-equal with node:crypto over the canonical fixtures', () => {
                for (const input of ['', 'a', 'flauz.release/v1', JSON.stringify({ b: 2, a: 1 }), 'ünïcödé ✓', 'x'.repeat(1000)]) {
                        assert.equal(sha256Hex(input), crypto.createHash('sha256').update(input, 'utf8').digest('hex'), `sha256Hex diverges from node:crypto on ${JSON.stringify(input.slice(0, 20))}`);
                }
        });

        test('sha256Hex + canonicalJson + serializeArtifact are byte-equal with the real flauz-workspace primitives', () => {
                const samples: unknown[] = [
                        { b: [3, 1, 2], a: 'x', nested: { z: null, y: true, u: undefined } },
                        'plain string',
                        42,
                        [{ q: 1 }, { p: 2 }],
                        null,
                ];
                for (const sample of samples) {
                        assert.equal(sha256Hex(canonicalJson(sample)), workspaceSha256Hex(workspaceCanonicalJson(sample)));
                        assert.equal(canonicalJson(sample), workspaceCanonicalJson(sample));
                        assert.equal(serializeArtifact(sample), JSON.stringify(deepSorted(sample), null, 2) + '\n');
                }
        });
});

suite('A-PROD-004-W5 contract pins: the surface registry is the census enumeration', () => {

        test('SURFACES ids are exactly the DurableStateCensus keys, in order', () => {
                assert.deepEqual(SURFACES.map(def => def.id), [
                        'tasks', 'evidenceLedger', 'evidenceWatermark', 'resourcesGraph', 'opsChain',
                        'environmentsRegistry', 'browserSessions', 'workflows', 'orchestration', 'providerLanesState',
                ]);
        });

        test('SURFACES format versions are pinned against the owning schema ids (never invented)', () => {
                const byId = new Map(SURFACES.map(def => [def.id, def] as const));
                assert.equal(byId.get('tasks')?.formatVersion, 'flauz.tasks/v0');
                assert.equal(byId.get('evidenceLedger')?.formatVersion, LEDGER_ROW_FORMAT_ID);
                assert.equal(byId.get('evidenceLedger')?.formatVersion, 'flauz.evidence.rows/v0');
                assert.equal(byId.get('evidenceWatermark')?.formatVersion, 'flauz.evidence.size/v1');
                assert.equal(byId.get('resourcesGraph')?.formatVersion, 'flauz.resources/v0');
                assert.equal(byId.get('opsChain')?.formatVersion, 'flauz.resources-ops/v0');
                assert.equal(byId.get('environmentsRegistry')?.formatVersion, 'flauz.environments/v0');
                assert.equal(byId.get('browserSessions')?.formatVersion, 'flauz.browser-session-journal/v0');
                assert.equal(byId.get('workflows')?.formatVersion, 'flauz.workflows/v1');
                assert.equal(byId.get('orchestration')?.formatVersion, 'flauz.orch.graphs/v1 + flauz.orch.journal/v1');
                assert.equal(byId.get('providerLanesState')?.formatVersion, 'flauz.model-providers/v0 + flauz.model-routing-policy/v0 + flauz.model-routing-decision/v0 + flauz.model-provider-switch/v0');
        });

        test('format.ts is byte-identical across the flauz extensions (the PU6 law)', async () => {
                const own = await fs.readFile(path.join(REPO_ROOT, 'extensions', 'flauz-release', 'src', 'format.ts'), 'utf-8');
                for (const sibling of ['flauz-diagnostics', 'flauz-backup', 'flauz-migration', 'flauz-telemetry']) {
                        const theirs = await fs.readFile(path.join(REPO_ROOT, 'extensions', sibling, 'src', 'format.ts'), 'utf-8');
                        assert.equal(own, theirs, `format.ts diverges from ${sibling}`);
                }
        });
});

suite('A-PROD-004-W5 contract pins: the census + integrity + inventory equal the real machinery on the same fixture', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the census rows deep-equal the REAL flauz-diagnostics census (counts + hashes + presence)', async () => {
                const own = await collectDurableStateCensus(fixture.root, fixture.fs);
                const real = await collectDiagnostics({
                        root: fixture.root,
                        fs: {
                                readFileUtf8: async p => fixture.fs.readFileUtf8(p),
                                readdir: async p => fixture.fs.readdir(p),
                                mkdir: async () => { throw new Error('the census never writes'); },
                                writeFile: async () => { throw new Error('the census never writes'); },
                        },
                        clock: () => 0,
                        versions: fixtureVersions(),
                        environment: { nodeVersion: 'test', platform: 'test', arch: 'test' },
                });
                assert.deepEqual(own, real.durableState);
        });

        test('the integrity verdicts deep-equal the REAL flauz-diagnostics verifiers', async () => {
                const own = await collectIntegrity(fixture.root, fixture.fs);
                const real = await realCollectIntegrity(fixture.root, fixture.fs);
                assert.deepEqual(own, real);
        });

        test('the version inventory deep-equals the REAL flauz-migration machinery', async () => {
                const own = await readSurfaceVersions(fixture.root, fixture.fs);
                const real = await realReadSurfaceVersions(fixture.root, withSiblingShape(fixture.fs));
                assert.deepEqual(own, real);
        });

        test('the torn detection deep-equals the REAL flauz-migration machinery (clean + torn)', async () => {
                assert.deepEqual(await detectTornState(fixture.root, fixture.fs), await realDetectTornState(fixture.root, withSiblingShape(fixture.fs)));
                await plantTornMarker(fixture.root, 'export-2100-01-01T00-00-00-000Z');
                assert.deepEqual(await detectTornState(fixture.root, fixture.fs), await realDetectTornState(fixture.root, withSiblingShape(fixture.fs)));
        });
});

suite('A-PROD-004-W5 contract pins: the fresh self-export is cross-recognizable in BOTH directions', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('this extension\'s self-export verifies GREEN under the REAL flauz-backup verifier', async () => {
                const own = await createSelfExport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock, versions: fixtureVersions() }, 'flauz.release.verify');
                const verification = await realVerifyExport({ root: fixture.root, fs: withSiblingShape(fixture.fs) }, own.exportDirName);
                assert.equal(verification.ok, true, `the real verifier refused the release self-export: ${verification.metadata.reasons.join('; ')}`);
                const metadata = JSON.parse(await fs.readFile(path.join(own.exportDir, 'export.json'), 'utf-8')) as { commandLine: string; extensionId: string };
                assert.equal(metadata.commandLine, 'flauz.release.verify');
                assert.equal(metadata.extensionId, 'flauz.flauz-release');
        });

        test('a REAL flauz-backup export verifies GREEN under this extension\'s verifier', async () => {
                const real = await realCreateExport({ root: fixture.root, fs: withSiblingShape(fixture.fs), clock: fixture.clock, versions: fixtureVersions() });
                assert.equal(real.surfaces.length, 10);
                const verification = await verifySelfExport({ root: fixture.root, fs: fixture.fs }, real.exportDirName);
                assert.equal(verification.ok, true, `this extension's verifier refused the real backup export: ${verification.metadata.reasons.join('; ')}`);
                const metadata = JSON.parse(await fs.readFile(path.join(real.exportDir, 'export.json'), 'utf-8')) as { commandLine: string };
                assert.equal(metadata.commandLine, EXPORT_COMMAND_LINE);
        });
});

suite('A-PROD-004-W5 contract pins: the W4 telemetry + failure-taxonomy consultation', () => {
        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });
        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the telemetry config state agrees with the REAL loadTelemetryConfig semantics (absent / known / corrupt)', async () => {
                // absent = default-off (the W4 law)
                const absent = await readTelemetryConfigState(fixture.root, fixture.fs);
                assert.equal(absent.state, 'absent-default-off');
                const realAbsent = await loadTelemetryConfig(fixture.root, withSiblingShape(fixture.fs));
                assert.equal(realAbsent.enabled, false);

                // a valid enabled config = known
                await writeTelemetryConfig(fixture.root, {
                        $schema: 'flauz.telemetry-config/v1',
                        schemaVersion: 0,
                        enabled: true,
                        retentionDays: 30,
                        schemaDigest: 'a'.repeat(64),
                        consent: { at: 1_740_000_100_000, action: 'enable' },
                });
                const known = await readTelemetryConfigState(fixture.root, fixture.fs);
                assert.equal(known.state, 'known');
                if (known.state === 'known') {
                        assert.equal(known.enabled, true);
                        assert.equal(known.retentionDays, 30);
                        assert.equal(known.consentAction, 'enable');
                }
                const realKnown = await loadTelemetryConfig(fixture.root, withSiblingShape(fixture.fs));
                assert.equal(realKnown.enabled, true);

                // corrupt = the unknown state here; the typed refusal there (the same law, two honest surfaces)
                await writeTelemetryConfig(fixture.root, { $schema: 'flauz.telemetry-config/v1', schemaVersion: 0, enabled: 'yes' });
                const corrupt = await readTelemetryConfigState(fixture.root, fixture.fs);
                assert.equal(corrupt.state, 'corrupt');
                await assert.rejects(() => loadTelemetryConfig(fixture.root, withSiblingShape(fixture.fs)), /FLAUZ_TELEMETRY_CONFIG_CORRUPT|retentionDays|enabled/);
        });

        test('the failure taxonomy is class-for-class equal the REAL flauz-telemetry module', () => {
                assert.equal(FAILURE_CLASSES.length, realFailureClasses.length);
                assert.deepEqual(FAILURE_CLASS_IDS, realFailureClassIds);
                for (const [index, own] of FAILURE_CLASSES.entries()) {
                        const real = realFailureClasses[index];
                        assert.ok(real);
                        assert.equal(own.id, real.id);
                        assert.equal(own.label, real.label);
                        assert.deepEqual(own.surfaces, real.surfaces);
                        assert.deepEqual(own.sourceCodes, real.sourceCodes);
                        assert.equal(own.remediation, real.remediation);
                }
                assert.equal(FAILURE_CLASSES.length, 14);
                assert.equal(PROVIDER_ERROR_CODES.length, 14);
                assert.equal(ENVIRONMENT_SOURCE_CODES.length, 5);
        });
});

suite('A-PROD-004-W5 contract pins: the banking watermark serialization is byte-equal with the W3 machinery', () => {

        test('serializeWatermark matches the real flauz-migration banking serialization', () => {
                const watermark: LedgerWatermarkShape = {
                        $schema: 'flauz.evidence.size/v1',
                        rowCount: 7,
                        bytes: 1234,
                        headSha256: 'a'.repeat(64),
                        lastCheckpointSeq: null,
                        updatedAt: 1_740_000_000_000,
                };
                assert.equal(serializeWatermark(watermark), realSerializeWatermark(watermark));
                assert.ok(serializeWatermark(watermark).endsWith('\n'));
        });
});
