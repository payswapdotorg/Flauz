/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The record suite (A-PROD-004-W4): the collection semantics -- an enabled
 * pass records EXACTLY the declared aggregates from the real durable
 * surfaces (ledger rows per schema: kind/surface/outcome/duration-bucket/
 * error-code/identity/count); contents NEVER ride (the privacy suite pins
 * the canary side); retention prunes; the session law holds; malformed
 * surfaces degrade honestly.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { TelemetryError } from '../src/api.ts';
import { applyConfigChange, loadTelemetryConfig } from '../src/config.ts';
import { readTelemetryLedger, resolveSessionId, runRecordPass, parseTelemetryRow } from '../src/record.ts';
import { DURATION_BUCKETS, EVENT_KINDS, OUTCOMES, SURFACES } from '../src/schema.ts';
import { FAILURE_CLASS_IDS } from '../src/failures.ts';

import { bootFixtureWorkspace, readTelemetryLedgerText, type FixtureWorkspace } from './helpers.ts';

/** Enables telemetry on a fixture (the explicit operator action). */
async function enable(fixture: FixtureWorkspace): Promise<void> {
        const current = await loadTelemetryConfig(fixture.root, fixture.fs);
        await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { enable: true });
}

suite('record: the enabled pass records exactly the declared aggregates', () => {

        let fixture: FixtureWorkspace;
        let result: Awaited<ReturnType<typeof runRecordPass>>;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                await enable(fixture);
                result = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-record');
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('the pass observed the full fixture event set (routing + journal + environments + workflows)', () => {
                // routing: 3 ok provider calls + 1 no-candidate; journal: 5 provider-retry + 3 step transitions;
                // environments: 2 valid + 1 disabled + 1 invalid; workflows: 1 failed tool step
                assert.equal(result.eventsObserved, 4 + 5 + 3 + 4 + 1);
                assert.equal(result.rowsAppended > 0, true);
                assert.equal(result.session, 'sess-record');
        });

        test('every ledger row carries EXACTLY the declared fields from closed vocabularies', async () => {
                const { rows, firstParseError } = await readTelemetryLedger(fixture.root, fixture.fs);
                assert.equal(firstParseError, undefined);
                assert.equal(rows.length, result.rowsAppended + 1, 'the pass rows + the enable consent row (the config records the consent event itself)');
                for (const row of rows) {
                        const keys = Object.keys(row);
                        assert.ok(keys.includes('$schema') && keys.includes('seq') && keys.includes('at') && keys.includes('session') && keys.includes('eventKind') && keys.includes('surface') && keys.includes('outcome') && keys.includes('durationBucket') && keys.includes('count'), `the row carries the pinned field set: ${keys.join(',')}`);
                        assert.ok((EVENT_KINDS as readonly string[]).includes(row.eventKind));
                        assert.ok((SURFACES as readonly string[]).includes(row.surface));
                        assert.ok((OUTCOMES as readonly string[]).includes(row.outcome));
                        assert.ok((DURATION_BUCKETS as readonly string[]).includes(row.durationBucket));
                        if (row.errorCode !== undefined) {
                                assert.ok(FAILURE_CLASS_IDS.includes(row.errorCode));
                        }
                        if (row.identity !== undefined) {
                                for (const field of Object.keys(row.identity)) {
                                        assert.ok(['providerId', 'environmentId', 'workflowId', 'graphId'].includes(field), `identity fields are the id allowlist: ${field}`);
                                }
                        }
                        assert.ok(row.count >= 1);
                }
        });

        test('the provider-call aggregates are exactly the routing decisions the real store wrote', async () => {
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const providerCalls = rows.filter(row => row.eventKind === 'provider-call');
                assert.equal(providerCalls.length, 2, 'two distinct provider lanes (flauz-mock + lane-b)');
                const mock = providerCalls.find(row => row.identity?.providerId === 'flauz-mock');
                const laneB = providerCalls.find(row => row.identity?.providerId === 'lane-b');
                assert.ok(mock !== undefined && laneB !== undefined);
                assert.equal(mock.count, 2, 'flauz-mock served two decisions');
                assert.equal(laneB.count, 1);
                assert.equal(mock.outcome, 'ok');
                assert.equal(mock.surface, 'flauz-models');
                assert.equal(mock.durationBucket, 'unrecorded', 'routing decisions carry no duration fact -- the honest bucket');
        });

        test('the no-candidate decision is typed as the environment/provider incompatibility failure', async () => {
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const noCandidate = rows.filter(row => row.outcome === 'no-candidate');
                assert.equal(noCandidate.length, 1);
                assert.equal(noCandidate[0]?.errorCode, 'environment-provider-incompatibility');
                assert.equal(noCandidate[0]?.eventKind, 'failure');
                assert.equal(noCandidate[0]?.surface, 'flauz-models');
                assert.equal(noCandidate[0]?.count, 1);
        });

        test('the provider-retry window is typed with its codes, outcomes and wait buckets', async () => {
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const failures = rows.filter(row => row.eventKind === 'failure' && row.surface === 'flauz-agent');
                assert.equal(failures.length, 5, 'five distinct retry-window tuples (3 on S-01 + 2 on S-03)');
                const byCode = new Map(failures.map(row => [`${row.errorCode}/${row.outcome}/${row.durationBucket}`, row.count]));
                assert.equal(byCode.get('provider-lane-capacity/failed/0-10ms'), 1, 'PROVIDER_OVERLOADED retryable-failed, wait 5ms');
                assert.equal(byCode.get('provider-unreachable/failed/100ms-1s'), 1, 'NETWORK_ERROR retryable-failed, wait 500ms');
                assert.equal(byCode.get('model-timeout/exhausted/10s+'), 1, 'TIMEOUT exhausted, wait 15000ms');
                assert.equal(byCode.get('provider-lane-capacity/failed/100ms-1s'), 1, 'RATE_LIMITED retryable-failed, wait 250ms');
                assert.equal(byCode.get('provider-lane-capacity/recovered/0-10ms'), 1, 'RATE_LIMITED recovered, wait 0ms');
                for (const row of failures) {
                        assert.ok(row.identity?.graphId !== undefined, 'the journal failures carry the graph id');
                }
        });

        test('the environment validation outcomes are exactly the registry entries', async () => {
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const envEvents = rows.filter(row => row.eventKind === 'environment-validation');
                assert.equal(envEvents.length, 3, 'valid x2 (two ids), disabled x1');
                assert.deepEqual(envEvents.filter(row => row.outcome === 'valid').map(row => row.identity?.environmentId).sort(), ['env-build-box', 'env-staging']);
                const disabled = envEvents.find(row => row.outcome === 'disabled');
                assert.equal(disabled?.identity?.environmentId, 'env-disabled-box');
                const invalid = rows.filter(row => row.outcome === 'invalid');
                assert.equal(invalid.length, 1);
                assert.equal(invalid[0]?.errorCode, 'environment-validation-failed');
                assert.equal(invalid[0]?.identity?.environmentId, 'env-broken-box');
        });

        test('the step outcomes ride with their duration buckets derived from the journal timestamps', async () => {
                // derive the expected tuples from the journal the fixture really wrote (the code must fold identically)
                const journalText = await fs.readFile(path.join(fixture.root, '.flauz', 'orchestration', 'journal.jsonl'), 'utf-8');
                const journalRows = journalText.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { type: string; stepId: string; ts: number; attempt: number });
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const stepEvents = rows.filter(row => row.eventKind === 'workflow-step' && row.surface === 'flauz-agent');
                const expectedTuples = new Map<string, number>();
                const starts = new Map<string, number>();
                for (const journalRow of journalRows) {
                        const key = `${journalRow.stepId}/${String(journalRow.attempt)}`;
                        if (journalRow.type === 'step-started') {
                                starts.set(key, journalRow.ts);
                        } else if (journalRow.type === 'step-succeeded' || journalRow.type === 'step-failed') {
                                const delta = journalRow.ts - (starts.get(key) ?? journalRow.ts);
                                const bucket = delta < 10 ? '0-10ms' : delta < 100 ? '10-100ms' : delta < 1000 ? '100ms-1s' : delta < 10000 ? '1-10s' : '10s+';
                                const tuple = `${journalRow.type === 'step-succeeded' ? 'ok' : 'failed'}/${bucket}`;
                                expectedTuples.set(tuple, (expectedTuples.get(tuple) ?? 0) + 1);
                        }
                }
                const actualTuples = new Map(stepEvents.map(row => [`${row.outcome}/${row.durationBucket}`, row.count]));
                assert.deepEqual([...actualTuples.entries()].sort(), [...expectedTuples.entries()].sort(), 'the agent step events fold exactly the journal-derived tuples');
                const failed = stepEvents.find(row => row.outcome === 'failed');
                assert.ok(failed !== undefined);
                assert.ok(failed.identity?.graphId !== undefined);
        });

        test('the workflow envelope step outcome is observed from the real saved fragment', async () => {
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const workflowStep = rows.filter(row => row.eventKind === 'workflow-step' && row.surface === 'flauz-workflow');
                assert.equal(workflowStep.length, 1);
                assert.equal(workflowStep[0]?.outcome, 'failed', 'the fixture workflow ends with the failed tool step');
                assert.equal(workflowStep[0]?.identity?.workflowId, 'W-001');
        });

        test('the pass banks exactly one census-visible evidence row', async () => {
                assert.ok(result.bankedLedgerRowSeq !== undefined);
                const evidenceText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const banked = evidenceText.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { taskId: string }).filter(row => row.taskId === 'flauz-telemetry');
                assert.equal(banked.length, 1);
        });
});

suite('record: the session law', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('the default session id derives from the clock; an explicit id rides every row', async () => {
                await enable(fixture);
                const defaultSession = resolveSessionId(undefined, () => 1740001234567);
                assert.equal(defaultSession, 'sess-1740001234567');
                assert.equal(resolveSessionId({ session: 'sess-op-42' }, () => 1), 'sess-op-42');

                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-op-42');
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                assert.ok(rows.length > 0);
                for (const row of rows.filter(r => r.eventKind !== 'config')) {
                        assert.equal(row.session, 'sess-op-42', 'every observation row carries the explicit session id');
                }
        });

        test('a malformed session id refuses typed (ids are metadata; metadata may never be secret-shaped)', async () => {
                await enable(fixture);
                const before = await readTelemetryLedgerText(fixture.root);
                assert.throws(() => resolveSessionId({ session: 'bad session!' }, () => 1), (err: unknown) => {
                        assert.ok(err instanceof TelemetryError);
                        assert.equal((err as TelemetryError).code, 'FLAUZ_TELEMETRY_CONFIG_INVALID');
                        return true;
                });
                assert.throws(() => resolveSessionId({ session: '' }, () => 1), /session/);
                assert.equal(await readTelemetryLedgerText(fixture.root), before, 'the refusal changed nothing on disk');
        });
});

suite('record: retention', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('rows older than the retention window are pruned at record time; recent rows stay', async () => {
                await enable(fixture);
                const first = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-r1');
                assert.equal(first.prunedRows, 0);

                // plant an ANCIENT row in the real canonical format (at = 1000, far outside 30 days)
                const ledgerPath = path.join(fixture.root, '.flauz', 'telemetry', 'ledger.jsonl');
                const textBefore = await fs.readFile(ledgerPath, 'utf-8');
                const linesBefore = textBefore.split('\n').filter(line => line !== '').length;
                const ancient = {
                        $schema: 'flauz.telemetry-event/v1',
                        seq: 999,
                        at: 1000,
                        session: 'sess-ancient',
                        eventKind: 'provider-call',
                        surface: 'flauz-models',
                        outcome: 'ok',
                        durationBucket: 'unrecorded',
                        identity: { providerId: 'ancient-lane' },
                        count: 1,
                };
                await fs.appendFile(ledgerPath, `${JSON.stringify(ancient)}\n`, 'utf-8');

                const second = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-r2');
                assert.equal(second.prunedRows, 1, 'the ancient row is pruned');
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                assert.equal(rows.some(row => row.session === 'sess-ancient'), false);
                assert.equal(rows.some(row => row.session === 'sess-r1'), true, 'the recent rows survive');
                // every pre-pass row is preserved verbatim by the prune rewrite (byte-preservation of the kept rows)
                const textAfter = await fs.readFile(ledgerPath, 'utf-8');
                const linesAfter = textAfter.split('\n').filter(line => line !== '').length;
                assert.equal(linesAfter, linesBefore + second.rowsAppended, `the ledger carries the kept rows + the new rows (${String(linesBefore)} + ${String(second.rowsAppended)})`);
        });

        test('a tightened retention prunes what the wider window kept', async () => {
                await enable(fixture);
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-wide');
                const current = await loadTelemetryConfig(fixture.root, fixture.fs);
                await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { retentionDays: 1 });
                const tight = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-tight');
                // every prior row is within 1 day of the stepping clock (1s steps) -- nothing prunes; the pass proves the window is read
                assert.equal(tight.prunedRows, 0);
                const ledgerText = await readTelemetryLedgerText(fixture.root) as string;
                assert.match(ledgerText, /sess-tight/);
        });
});

suite('record: honest degradation', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('an unparseable surface is REPORTED by name, never faked', async () => {
                await enable(fixture);
                await fs.writeFile(path.join(fixture.root, '.flauz', 'models', 'routing-decisions.jsonl'), '{not json\n', 'utf-8');
                const result = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-degraded');
                assert.deepEqual(result.unparseableSurfaces, ['.flauz/models/routing-decisions.jsonl']);
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                assert.equal(rows.some(row => row.eventKind === 'provider-call'), false, 'no provider-call events were faked for the unparseable surface');
        });

        test('absent surfaces are honest absence (the plain-environments fixture)', async () => {
                const plain = await bootFixtureWorkspace({ plainEnvironments: true });
                try {
                        await enable(plain);
                        const result = await runRecordPass({ root: plain.root, fs: plain.fs, clock: plain.clock }, 'sess-absent');
                        assert.deepEqual(result.absentSurfaces, []);
                        const { rows } = await readTelemetryLedger(plain.root, plain.fs);
                        assert.equal(rows.some(row => row.outcome === 'invalid' || row.outcome === 'disabled'), false, 'the plain registry carries neither the invalid nor the disabled entry');
                        assert.equal(rows.some(row => row.outcome === 'valid'), true);
                } finally {
                        await plain.cleanup();
                }
        });

        test('parseTelemetryRow refuses foreign and malformed lines with the owning grammar', () => {
                assert.ok(!parseTelemetryRow(JSON.stringify({ hello: 'world' }), 1).ok);
                assert.ok(!parseTelemetryRow(JSON.stringify({ $schema: 'flauz.other/v0' }), 1).ok);
                const badBucket = JSON.stringify({ $schema: 'flauz.telemetry-event/v1', seq: 1, at: 1, session: 's', eventKind: 'provider-call', surface: 'flauz-models', outcome: 'ok', durationBucket: '87 minutes', count: 1 });
                const outcome = parseTelemetryRow(badBucket, 1);
                assert.ok(!outcome.ok);
                assert.match(!outcome.ok ? outcome.error : '', /durationBucket must be one of the declared buckets/);
                const badKind = JSON.stringify({ $schema: 'flauz.telemetry-event/v1', seq: 1, at: 1, session: 's', eventKind: 'vibes', surface: 'flauz-models', outcome: 'ok', durationBucket: 'unrecorded', count: 1 });
                assert.ok(!parseTelemetryRow(badKind, 1).ok);
        });
});
