/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The report suite (A-PROD-004-W4): the inspection semantics -- the aggregate
 * view (per-surface event counts, outcome distributions, duration
 * histograms, the error-code census) is EXACT on fixtures, reads the local
 * ledger only, and sweeps the assembled report (the fail-closed backstop).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { TelemetryError } from '../src/api.ts';
import { applyConfigChange, loadTelemetryConfig } from '../src/config.ts';
import { runRecordPass } from '../src/record.ts';
import { buildReport, collectReport, renderReportLines, type TelemetryReport } from '../src/report.ts';
import { collectFailureCensus } from '../src/failuresList.ts';
import type { TelemetryRow } from '../src/config.ts';

import { bootFixtureWorkspace, captureChannel, type FixtureWorkspace } from './helpers.ts';
import { registerTelemetryCommands } from '../src/commands.ts';
import { setVscodeApi } from '../src/globals.ts';

/** Enables telemetry on a fixture (the explicit operator action). */
async function enable(fixture: FixtureWorkspace): Promise<void> {
        const current = await loadTelemetryConfig(fixture.root, fixture.fs);
        await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { enable: true });
}

/** Three deterministic aggregate rows (the exactness fixture). */
function fixtureRows(): TelemetryRow[] {
        return [
                { $schema: 'flauz.telemetry-event/v1', seq: 1, at: 1000, session: 's1', eventKind: 'provider-call', surface: 'flauz-models', outcome: 'ok', durationBucket: 'unrecorded', identity: { providerId: 'lane-a' }, count: 3 },
                { $schema: 'flauz.telemetry-event/v1', seq: 2, at: 2000, session: 's1', eventKind: 'failure', surface: 'flauz-agent', outcome: 'failed', durationBucket: '10-100ms', errorCode: 'provider-unreachable', identity: { graphId: 'G-001' }, count: 2 },
                { $schema: 'flauz.telemetry-event/v1', seq: 3, at: 9000, session: 's2', eventKind: 'failure', surface: 'flauz-agent', outcome: 'failed', durationBucket: '10-100ms', errorCode: 'provider-unreachable', identity: { graphId: 'G-001' }, count: 5 },
        ];
}

suite('report: the aggregation is exact on fixtures', () => {

        test('buildReport folds counts, distributions, histograms and the error-code census exactly', () => {
                const report: TelemetryReport = buildReport(fixtureRows(), 42000, 0);
                assert.equal(report.rowCount, 3);
                assert.equal(report.totalEvents, 10);
                assert.deepEqual(report.outcomeDistribution, { failed: 7, ok: 3 });
                assert.deepEqual(report.durationHistogram, { '10-100ms': 7, unrecorded: 3 });
                assert.deepEqual(report.errorCodeCensus, { 'provider-unreachable': 7 });
                assert.equal(report.perSurface.length, 2);
                const models = report.perSurface.find(aggregate => aggregate.surface === 'flauz-models');
                const agent = report.perSurface.find(aggregate => aggregate.surface === 'flauz-agent');
                assert.ok(models !== undefined && agent !== undefined);
                assert.equal(models.eventCount, 3);
                assert.deepEqual(models.outcomeCounts, { ok: 3 });
                assert.deepEqual(models.errorCodeCounts, {});
                assert.equal(agent.eventCount, 7);
                assert.deepEqual(agent.errorCodeCounts, { 'provider-unreachable': 7 });
                assert.equal(report.firstRowAt, 1000);
                assert.equal(report.lastRowAt, 9000);
        });

        test('the render carries every aggregate block and the taxonomy label on the census lines', () => {
                const report = buildReport(fixtureRows(), 42000, 0);
                const text = renderReportLines(report).join('\n');
                assert.match(text, /LOCAL telemetry ledger/);
                assert.match(text, /flauz-models: 3 event\(s\)/);
                assert.match(text, /flauz-agent: 7 event\(s\)/);
                assert.match(text, /outcomes: failed=7/);
                assert.match(text, /outcomes: ok=3/);
                assert.match(text, /durations: 10-100ms=7/);
                assert.match(text, /durations: unrecorded=3/);
                assert.match(text, /outcome distribution \(all surfaces\): failed=7 ok=3/);
                assert.match(text, /duration histogram \(all surfaces\): 10-100ms=7 unrecorded=3/);
                assert.match(text, /provider-unreachable: 7 \(Provider unreachable\)/);
                assert.match(text, /no network, no export/);
        });
});

suite('report: the local-ledger pass (over the real fixture)', () => {

        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                await enable(fixture);
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-report');
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('collectReport reproduces the record pass exactly (counts/distributions/census, consent row included)', async () => {
                const report = await collectReport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock });
                assert.equal(report.parseErrorCount, 0);
                assert.equal(report.totalEvents, 4 + 5 + 3 + 4 + 1 + 1, 'the observation events + the enable consent event');
                assert.deepEqual(report.outcomeDistribution, {
                        disabled: 1,
                        enabled: 1,
                        exhausted: 1,
                        failed: 5,
                        invalid: 1,
                        'no-candidate': 1,
                        ok: 5,
                        recovered: 1,
                        valid: 2,
                }, '3 retry-failed + the S-01 step + the workflow step = failed 5; 3 routed calls + 2 succeeded steps = ok 5');
                assert.deepEqual(report.errorCodeCensus, {
                        'environment-provider-incompatibility': 1,
                        'environment-validation-failed': 1,
                        'model-timeout': 1,
                        'provider-lane-capacity': 3,
                        'provider-unreachable': 1,
                });
                const agent = report.perSurface.find(aggregate => aggregate.surface === 'flauz-agent');
                assert.ok(agent !== undefined);
                assert.equal(agent.eventCount, 8, '5 retry-window failures + 3 step transitions');
        });

        test('the report command renders through the channel (the command surface integration)', async () => {
                const channel = captureChannel();
                // the vscode shim the commands module needs (register-only surface)
                const registered: { id: string; handler: (arg: unknown) => Promise<unknown> }[] = [];
                setVscodeApi({
                        commands: {
                                registerCommand: (id: string, handler: (arg: unknown) => Promise<unknown>) => {
                                        registered.push({ id, handler });
                                        return { dispose: () => undefined };
                                },
                        },
                } as never);
                registerTelemetryCommands({ fs: fixture.fs, clock: fixture.clock, channel, getWorkspaceRoot: () => fixture.root });
                const report = registered.find(entry => entry.id === 'flauz.telemetry.report');
                assert.ok(report !== undefined);
                const outcome = (await report.handler(undefined)) as { ok: boolean; report: TelemetryReport };
                assert.equal(outcome.ok, true);
                assert.equal(outcome.report.totalEvents, 4 + 5 + 3 + 4 + 1 + 1);
                assert.deepEqual(outcome.report.errorCodeCensus, {
                        'environment-provider-incompatibility': 1,
                        'environment-validation-failed': 1,
                        'model-timeout': 1,
                        'provider-lane-capacity': 3,
                        'provider-unreachable': 1,
                });
                const text = channel.lines.join('\n');
                assert.match(text, /flauz\.telemetry\.report: the inspection plane/);
                assert.match(text, /error-code census/);
        });

        test('a poisoned identity in the ledger can NEVER surface in the report (structural cleanliness: the report renders only closed vocabularies)', async () => {
                const ledgerPath = path.join(fixture.root, '.flauz', 'telemetry', 'ledger.jsonl');
                const text = await fs.readFile(ledgerPath, 'utf-8');
                const secret = ['ghp_', 'ReportCanaryZ9y8X7w6V5u4'].join('');
                const poisoned = `${text}{"$schema":"flauz.telemetry-event/v1","seq":999,"at":1,"session":"poison","eventKind":"provider-call","surface":"flauz-models","outcome":"ok","durationBucket":"unrecorded","identity":{"providerId":"${secret}"},"count":1}\n`;
                await fs.writeFile(ledgerPath, poisoned, 'utf-8');
                try {
                        const report = await collectReport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock });
                        const rendered = renderReportLines(report).join('\n');
                        assert.equal(rendered.includes(secret), false, 'the report render carries only closed-vocabulary aggregates -- a poisoned identity cannot surface through it');
                        assert.equal(JSON.stringify(report).includes(secret), false, 'the report OBJECT carries no identity strings at all');
                } finally {
                        // restore the clean ledger for the suite's teardown
                        await fs.writeFile(ledgerPath, text, 'utf-8');
                }
        });

        test('the failure CENSUS refuses a poisoned identity (the fail-closed backstop sweeps the assembled artifact)', async () => {
                const ledgerPath = path.join(fixture.root, '.flauz', 'telemetry', 'ledger.jsonl');
                const text = await fs.readFile(ledgerPath, 'utf-8');
                const secret = ['ghp_', 'CensusCanaryZ9y8X7w6V5u4'].join('');
                const poisoned = `${text}{"$schema":"flauz.telemetry-event/v1","seq":999,"at":1,"session":"poison","eventKind":"failure","surface":"flauz-models","outcome":"no-candidate","durationBucket":"unrecorded","errorCode":"environment-provider-incompatibility","identity":{"providerId":"${secret}"},"count":1}\n`;
                await fs.writeFile(ledgerPath, poisoned, 'utf-8');
                try {
                        await assert.rejects(
                                () => collectFailureCensus({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }),
                                (err: unknown) => {
                                        assert.ok(err instanceof TelemetryError);
                                        assert.equal(err.code, 'FLAUZ_TELEMETRY_SECRET_SHAPED');
                                        return true;
                                },
                        );
                } finally {
                        await fs.writeFile(ledgerPath, text, 'utf-8');
                }
        });
});
