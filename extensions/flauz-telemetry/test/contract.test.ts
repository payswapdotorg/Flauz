/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The contract suite (A-PROD-004-W4): pins every contract-duplicated surface
 * against the REAL owning modules (the DL-32 law's test-time pin pattern;
 * src never crosses extension boundaries):
 *
 *   - sha256Hex + canonicalJson byte-equal against node:crypto;
 *   - the evidence-ledger row parse/line against the REAL flauz-workspace
 *     ledger rows the fixture's real EvidenceLedger writes;
 *   - the privacy patterns against assembled secret-shaped canaries (the
 *     flauz-resources discipline: fragments at runtime, never literals here);
 *   - the taxonomy closure: every REAL ProviderErrorCode (imported from the
 *     real flauz-models contract) and every environment source code maps to
 *     exactly one taxonomy class, and every taxonomy class id IS a value of
 *     the declared schema's errorCode dimension;
 *   - the census visibility: a real record pass banks an evidence row the
 *     REAL flauz-diagnostics census (collectDiagnostics) genuinely reports.
 */

import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { canonicalJson, sha256Hex } from '../src/api.ts';
import { ledgerRowLine, parseLedgerLine } from '../src/evidence.ts';
import { looksSecretShaped } from '../src/privacy.ts';
import { EVENT_SCHEMA, eventSchemaDigest, isFailureClassId } from '../src/schema.ts';
import { FAILURE_CLASSES, classifyFailure, failureClassForCode, typedSourceCodes } from '../src/failures.ts';
import { parseTelemetryRow } from '../src/record.ts';
import { loadTelemetryConfig, telemetryRowLine } from '../src/config.ts';
import { runRecordPass } from '../src/record.ts';

// the REAL owning modules (test-time cross-extension imports: the sanctioned pin pattern)
import { RETRY_POLICY, ProviderError, isProviderError } from '../../flauz-models/src/contract/errors.ts';
import type { DiagFsPort, EnvironmentInfo, VersionsInfo } from '../../flauz-diagnostics/src/api.ts';
import { collectDiagnostics } from '../../flauz-diagnostics/src/census.ts';

import { bootFixtureWorkspace, readTelemetryLedgerText, type FixtureWorkspace } from './helpers.ts';

suite('contract: the duplicated primitives are byte-equal with the owners', () => {

        test('sha256Hex matches node:crypto over representative canonical payloads (the real ledger bytes class)', () => {
                for (const input of ['', '{"kind":"note","prev":null,"seq":1,"sha256":"a","taskId":"T-001","ts":1,"uri":"x"}', 'flauz telemetry contract fixture', JSON.stringify(EVENT_SCHEMA).repeat(3)]) {
                        assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'));
                }
        });

        test('canonicalJson is key-sorted, whitespace-free and stable (the chain byte input)', () => {
                const row = { seq: 2, ts: 99, taskId: 'flauz-telemetry', kind: 'note', uri: '.flauz/telemetry/ledger.jsonl', sha256: 'b' + '0'.repeat(63), prev: null };
                assert.equal(canonicalJson(row), '{"kind":"note","prev":null,"seq":2,"sha256":"' + 'b' + '0'.repeat(63) + '","taskId":"flauz-telemetry","ts":99,"uri":".flauz/telemetry/ledger.jsonl"}');
                assert.equal(canonicalJson(JSON.parse(canonicalJson(row))), canonicalJson(row));
        });
});

suite('contract: the evidence-ledger duplication matches the real flauz-workspace ledger', () => {

        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('parseLedgerLine accepts every REAL row the EvidenceLedger wrote, and the canonical line round-trips byte-equal', async () => {
                const text = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const lines = text.split('\n').filter(line => line !== '');
                assert.ok(lines.length >= 3, `expected the fixture ledger to carry rows (got ${String(lines.length)})`);
                for (const [index, line] of lines.entries()) {
                        const outcome = parseLedgerLine(line, index + 1);
                        assert.ok(outcome.ok, `real row ${String(index + 1)} must parse: ${'error' in outcome ? outcome.error : ''}`);
                        assert.equal(ledgerRowLine(outcome.row), line, `real row ${String(index + 1)} must round-trip byte-equal (the canonical line IS the stored line)`);
                }
        });

        test('parseLedgerLine refuses a foreign line with the owning grammar (exactly-7-fields law)', () => {
                const bad = JSON.stringify({ seq: 1, ts: 1, taskId: 'T-001', kind: 'note', uri: 'x', sha256: '0'.repeat(64) });
                const outcome = parseLedgerLine(bad, 1);
                assert.ok(!outcome.ok);
                assert.match('error' in outcome ? outcome.error : '', /must have exactly the 7 fields/);
        });
});

suite('contract: the privacy patterns catch the assembled canaries', () => {

        test('every planted secret shape is caught, every ordinary text passes (fragments assembled at runtime)', () => {
                const canaries = [
                        ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3'].join(''),
                        ['sk-', 'ant-abcdefghijklmnop'].join(''),
                        ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
                        ['xoxb-', '1234567890abcdef'].join(''),
                        ['Bearer ', 'asdfghjklqwertyu1'].join(''),
                        ['-----BEGIN RSA PRIVATE KEY-----'].join(''),
                        ['eyJ', 'abcdefghij', '.', 'klmn', '.', 'opqrstuvwxyzabcdefg1'].join(''),
                ];
                for (const canary of canaries) {
                        assert.equal(looksSecretShaped(canary), true, `the canary must be caught: ${canary.slice(0, 8)}...`);
                }
                for (const ordinary of ['ordinary explanation', 'provider lane-b', 'sess-1740000000000', '10-100ms', 'provider-unreachable']) {
                        assert.equal(looksSecretShaped(ordinary), false);
                }
        });
});

suite('contract: the taxonomy closure over the REAL provider vocabulary', () => {

        test('every REAL ProviderErrorCode (imported from the owning contract) is typed by exactly one taxonomy class', () => {
                const realCodes = Object.keys(RETRY_POLICY);
                assert.equal(realCodes.length, 14, 'the pinned base carries the 14-code taxonomy');
                for (const code of realCodes) {
                        const entry = failureClassForCode(code);
                        assert.ok(entry !== undefined, `the taxonomy must type the real code ${code}`);
                        assert.equal(entry.sourceCodes.filter(c => c === code).length, 1, `exactly one class claims ${code}`);
                }
        });

        test('typedSourceCodes covers every real code exactly once (surjective, no double claims)', () => {
                const typed = typedSourceCodes();
                assert.equal(typed.length, new Set(typed).size, 'no source code is claimed twice');
                for (const code of Object.keys(RETRY_POLICY)) {
                        assert.ok(typed.includes(code), `${code} must be in the typed set`);
                }
        });

        test('the six beta-gate classes are present with their named semantics', () => {
                const ids = FAILURE_CLASSES.map(entry => entry.id);
                for (const id of ['provider-unreachable', 'provider-auth-rejected', 'environment-validation-failed', 'provider-lane-capacity', 'model-timeout', 'environment-provider-incompatibility']) {
                        assert.ok(ids.includes(id), `the beta gate names the class ${id} verbatim`);
                }
                assert.deepEqual(failureClassForCode('NETWORK_ERROR')?.id, 'provider-unreachable');
                assert.deepEqual(failureClassForCode('AUTH_FAILED')?.id, 'provider-auth-rejected');
                assert.deepEqual(failureClassForCode('RATE_LIMITED')?.id, 'provider-lane-capacity');
                assert.deepEqual(failureClassForCode('TIMEOUT')?.id, 'model-timeout');
                assert.deepEqual(failureClassForCode('NO_CANDIDATE')?.id, 'environment-provider-incompatibility');
        });

        test('every taxonomy class id IS a value of the declared schema errorCode dimension (the schema-typology closure)', () => {
                const errorCodeDimension = EVENT_SCHEMA.dimensions.find(dimension => dimension.name === 'errorCode');
                assert.ok(errorCodeDimension !== undefined);
                for (const entry of FAILURE_CLASSES) {
                        assert.ok(errorCodeDimension.values.includes(entry.id), `the schema must declare the taxonomy class ${entry.id}`);
                        assert.ok(isFailureClassId(entry.id));
                }
                assert.deepEqual(errorCodeDimension.values.length, FAILURE_CLASSES.length, 'the errorCode dimension IS the taxonomy (no extras, no missing)');
        });

        test('every taxonomy entry carries a non-empty remediation hint and at least one surface', () => {
                for (const entry of FAILURE_CLASSES) {
                        assert.ok(entry.remediation.length > 40, `the remediation hint must be operator-facing (${entry.id})`);
                        assert.ok(entry.surfaces.length >= 1);
                }
        });

        test('classifyFailure refuses unknown codes loudly (the residue law, never an improvised class)', () => {
                assert.throws(() => classifyFailure({ code: 'SOMETHING_NEW', surface: 'flauz-models' }), /cannot type source code 'SOMETHING_NEW'/);
                assert.throws(() => classifyFailure({ code: 'AUTH_FAILED', surface: 'flauz-environments' }), /types surfaces \[flauz-models, flauz-agent\] -- a cross-surface leak or residue/);
        });

        test('the real ProviderError carries the retry posture this taxonomy describes (the seam pin)', () => {
                const err = new ProviderError('RATE_LIMITED', 'fixture: rate limited', { providerId: 'lane-b', modelId: 'm' });
                assert.equal(isProviderError(err), true);
                assert.equal(err.retryable, true);
                assert.equal(err.retryClass, 'long-backoff');
                assert.equal(failureClassForCode(err.code)?.id, 'provider-lane-capacity');
        });
});

suite('contract: the schema descriptor is the enumeration it claims to be', () => {

        test('every declared dimension carries a non-empty closed vocabulary', () => {
                for (const dimension of EVENT_SCHEMA.dimensions) {
                        assert.ok(dimension.values.length > 0);
                        assert.equal(new Set(dimension.values).size, dimension.values.length, `the ${dimension.name} vocabulary has no duplicates`);
                }
        });

        test('the neverRecorded list names the contents class explicitly', () => {
                const joined = EVENT_SCHEMA.neverRecorded.join(' ');
                assert.match(joined, /prompts/);
                assert.match(joined, /completions/);
                assert.match(joined, /provider payloads/);
                assert.match(joined, /credential-shaped/);
        });

        test('the schema digest is a stable sha256 over the canonical descriptor', () => {
                assert.equal(eventSchemaDigest(), sha256Hex(canonicalJson(EVENT_SCHEMA)));
                assert.equal(eventSchemaDigest().length, 64);
        });
});

suite('contract: census visibility through the REAL flauz-diagnostics census', () => {

        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        /** The DiagFsPort over node:fs (the diagnostics extension's own wiring shape). */
        function diagFs(): DiagFsPort {
                return {
                        readFileUtf8: async target => {
                                try {
                                        return await fs.readFile(target, { encoding: 'utf-8' });
                                } catch (err) {
                                        if ((err as { code?: string }).code === 'ENOENT') {
                                                return undefined;
                                        }
                                        throw err;
                                }
                        },
                        readdir: async target => {
                                try {
                                        return await fs.readdir(target);
                                } catch (err) {
                                        const code = (err as { code?: string }).code;
                                        if (code === 'ENOENT' || code === 'ENOTDIR') {
                                                return undefined;
                                        }
                                        throw err;
                                }
                        },
                        mkdir: target => fs.mkdir(target, { recursive: true }),
                        writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
                };
        }

        function versions(): VersionsInfo {
                return { productVersion: '0.1.0', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-telemetry', version: '0.1.0' }] };
        }

        function environment(): EnvironmentInfo {
                return { nodeVersion: process.versions.node, platform: process.platform, arch: process.arch };
        }

        test('a real record pass banks an evidence row the REAL census reports (rowCount + 1, kindCounts.note + 1)', async () => {
                // enable telemetry explicitly (the opt-in gate)
                const config = await loadTelemetryConfig(fixture.root, fixture.fs);
                await import('../src/config.ts').then(async mod => {
                        await mod.applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, config, { enable: true });
                });

                const before = await collectDiagnostics({ root: fixture.root, fs: diagFs(), clock: fixture.clock, versions: versions(), environment: environment() });
                const beforeRows = before.durableState.evidenceLedger.rowCount as number;
                const beforeNotes = ((before.durableState.evidenceLedger.kindCounts as Record<string, number>)?.note) ?? 0;

                const result = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-contract');
                assert.ok(result.rowsAppended > 0);
                assert.ok(result.bankedLedgerRowSeq !== undefined, 'the pass must bank a census-visible row');

                const after = await collectDiagnostics({ root: fixture.root, fs: diagFs(), clock: fixture.clock, versions: versions(), environment: environment() });
                const afterRows = after.durableState.evidenceLedger.rowCount as number;
                const afterNotes = ((after.durableState.evidenceLedger.kindCounts as Record<string, number>)?.note) ?? 0;
                assert.equal(afterRows, beforeRows + 1, 'the census row count grows by exactly the banked telemetry row');
                assert.equal(afterNotes, beforeNotes + 1, 'the census kind census reports the banked note row');
        });

        test('the banked row pins the telemetry tail (recoverable from the telemetry ledger itself)', async () => {
                const ledgerText = await readTelemetryLedgerText(fixture.root);
                assert.ok(ledgerText !== undefined);
                const lines = (ledgerText as string).split('\n').filter(line => line !== '');
                const evidenceText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const evidenceRows = evidenceText.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { taskId: string; kind: string; uri: string; sha256: string });
                const banked = evidenceRows.filter(row => row.taskId === 'flauz-telemetry');
                assert.ok(banked.length >= 1);
                for (const row of banked) {
                        assert.equal(row.uri, '.flauz/telemetry/ledger.jsonl');
                        // the pinned sha is the hash of SOME canonical telemetry line (the tail pin is recoverable)
                        const pinned = lines.some(line => sha256Hex(line) === row.sha256);
                        assert.equal(pinned, true, `the banked row's sha256 must pin a telemetry ledger line`);
                }
        });

        test('parseTelemetryRow accepts every row the real record pass wrote (the self-consistency pin)', async () => {
                const ledgerText = await readTelemetryLedgerText(fixture.root);
                assert.ok(ledgerText !== undefined);
                for (const [index, line] of (ledgerText as string).split('\n').filter(line => line !== '').entries()) {
                        const outcome = parseTelemetryRow(line, index + 1);
                        assert.ok(outcome.ok, `'error' in outcome ? outcome.error : ''`);
                        assert.equal(telemetryRowLine(outcome.row), line);
                }
        });
});
