/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The config suite (A-PROD-004-W4): the opt-in semantics -- default-off,
 * explicit-enable with the consent event, the schema enumeration before
 * enabling, the retention policy, and the typed refusals (corrupt config,
 * invalid args, schema drift under an active consent).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { TelemetryError } from '../src/api.ts';
import {
        applyConfigChange,
        loadTelemetryConfig,
        parseConfigArg,
        renderConfigLines,
} from '../src/config.ts';
import { eventSchemaDigest } from '../src/schema.ts';
import { runRecordPass } from '../src/record.ts';

import { bootFixtureWorkspace, readConfigText, readTelemetryLedgerText, type FixtureWorkspace } from './helpers.ts';

suite('config: the opt-in law (default OFF)', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('an absent config loads as DISABLED with the default retention and the live schema digest', async () => {
                const config = await loadTelemetryConfig(fixture.root, fixture.fs);
                assert.equal(config.enabled, false);
                assert.equal(config.retentionDays, 30);
                assert.equal(config.schemaDigest, eventSchemaDigest());
                assert.equal(config.consent, undefined);
                assert.equal(await readConfigText(fixture.root), undefined, 'nothing is persisted before any operator action');
        });

        test('a record pass while DISABLED is a TYPED REFUSAL, never a silent no-op', async () => {
                await assert.rejects(
                        () => runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-disabled'),
                        (err: unknown) => {
                                assert.ok(err instanceof TelemetryError);
                                assert.equal(err.code, 'FLAUZ_TELEMETRY_DISABLED');
                                assert.match(err.message, /telemetry is DISABLED/);
                                assert.match(err.message, /flauz\.telemetry\.config/);
                                return true;
                        },
                );
                // and nothing was written anywhere
                assert.equal(await readConfigText(fixture.root), undefined);
                assert.equal(await readTelemetryLedgerText(fixture.root), undefined);
        });
});

suite('config: the explicit enable (the consent event)', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('enable: true persists the config with the consent block AND banks the consent ledger row', async () => {
                const current = await loadTelemetryConfig(fixture.root, fixture.fs);
                const beforeEnable = fixture.clock();
                const next = await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { enable: true });
                assert.equal(next.enabled, true);
                assert.ok(next.consent !== undefined && next.consent.action === 'enable' && next.consent.at > 0 && next.consent.at >= beforeEnable);
                assert.equal(next.schemaDigest, eventSchemaDigest(), 'the enable pins the CURRENT schema digest');

                const persisted = JSON.parse(await readConfigText(fixture.root) as string) as Record<string, unknown>;
                assert.equal(persisted.enabled, true);
                assert.equal(persisted.$schema, 'flauz.telemetry-config/v1');
                assert.deepEqual(persisted.consent, { action: 'enable', at: next.consent?.at });

                const ledgerText = await readTelemetryLedgerText(fixture.root);
                assert.ok(ledgerText !== undefined, 'the consent event itself is recorded as a ledger row');
                const rows = (ledgerText as string).split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Record<string, unknown>);
                assert.equal(rows.length, 1);
                assert.equal(rows[0]?.eventKind, 'config');
                assert.equal(rows[0]?.surface, 'flauz-telemetry');
                assert.equal(rows[0]?.outcome, 'enabled');
                assert.equal(rows[0]?.count, 1);
                assert.equal(rows[0]?.durationBucket, 'unrecorded');
        });

        test('disable after enable records the disable consent event (the honest audit pair)', async () => {
                const initial = await loadTelemetryConfig(fixture.root, fixture.fs);
                await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, initial, { enable: true });
                const enabled = await loadTelemetryConfig(fixture.root, fixture.fs);
                const disabled = await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, enabled, { enable: false });
                assert.equal(disabled.enabled, false);
                assert.ok(disabled.consent !== undefined && disabled.consent.action === 'disable');
                assert.ok((disabled.consent?.at ?? 0) > (enabled.consent?.at ?? 0), 'the disable consent follows the enable consent in time');

                const ledgerText = await readTelemetryLedgerText(fixture.root) as string;
                const rows = ledgerText.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as Record<string, unknown>);
                assert.equal(rows.length, 2);
                assert.equal(rows[0]?.outcome, 'enabled');
                assert.equal(rows[1]?.outcome, 'disabled');
                assert.equal(rows[1]?.seq, 2, 'the seq discipline continues across consent rows');
        });

        test('a retention-only change persists without consent rows (it is not a collection-state change)', async () => {
                const initial = await loadTelemetryConfig(fixture.root, fixture.fs);
                const next = await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, initial, { retentionDays: 7 });
                assert.equal(next.retentionDays, 7);
                assert.equal(next.enabled, false);
                assert.equal(next.consent, undefined);
                assert.equal(await readTelemetryLedgerText(fixture.root), undefined, 'no consent row without an enable/disable action');
        });

        test('a no-arg call is pure inspection: nothing persists', async () => {
                const current = await loadTelemetryConfig(fixture.root, fixture.fs);
                const next = await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, {});
                assert.deepEqual(next, current);
                assert.equal(await readConfigText(fixture.root), undefined);
        });
});

suite('config: the disclosure render (inspect BEFORE enabling)', () => {

        test('the render carries the FULL schema enumeration, the never-recorded list, the posture and the digest', () => {
                const lines = renderConfigLines({ enabled: false, retentionDays: 30, schemaDigest: eventSchemaDigest() });
                const text = lines.join('\n');
                assert.match(text, /DECLARED EVENT SCHEMA/);
                assert.match(text, /eventKind:/);
                assert.match(text, /surface:/);
                assert.match(text, /outcome:/);
                assert.match(text, /durationBucket:/);
                assert.match(text, /errorCode:/);
                assert.match(text, /identity:/);
                assert.match(text, /NEVER recorded/);
                assert.match(text, /prompts/);
                assert.match(text, /completions/);
                assert.match(text, /provider payloads/);
                assert.match(text, /opt-in by default/);
                assert.match(text, /local-first/);
                assert.match(text, /no network egress/);
                assert.match(text, new RegExp(eventSchemaDigest()));
                assert.match(text, /enabled = FALSE/);
        });

        test('the render of an enabled config says so and carries the consent event', () => {
                const lines = renderConfigLines({ enabled: true, retentionDays: 14, schemaDigest: eventSchemaDigest(), consent: { at: 1740000000000, action: 'enable' } });
                const text = lines.join('\n');
                assert.match(text, /enabled = TRUE/);
                assert.match(text, /retention: 14 day/);
                assert.match(text, /ENABLE at 1740000000000/);
        });
});

suite('config: the typed refusals', () => {

        let fixture: FixtureWorkspace;

        setup(async () => {
                fixture = await bootFixtureWorkspace();
        });

        teardown(async () => {
                await fixture.cleanup();
        });

        test('a corrupt config (bad JSON) refuses typed, never guessed', async () => {
                await fs.mkdir(path.join(fixture.root, '.flauz', 'telemetry'), { recursive: true });
                await fs.writeFile(path.join(fixture.root, '.flauz', 'telemetry', 'config.json'), '{not json', 'utf-8');
                await assert.rejects(
                        () => loadTelemetryConfig(fixture.root, fixture.fs),
                        (err: unknown) => {
                                assert.ok(err instanceof TelemetryError);
                                assert.equal(err.code, 'FLAUZ_TELEMETRY_CONFIG_CORRUPT');
                                return true;
                        },
                );
        });

        test('a foreign artifact in the config path refuses typed', async () => {
                await fs.mkdir(path.join(fixture.root, '.flauz', 'telemetry'), { recursive: true });
                await fs.writeFile(path.join(fixture.root, '.flauz', 'telemetry', 'config.json'), JSON.stringify({ $schema: 'flauz.something-else/v0' }), 'utf-8');
                await assert.rejects(
                        () => loadTelemetryConfig(fixture.root, fixture.fs),
                        (err: unknown) => {
                                assert.ok(err instanceof TelemetryError);
                                assert.equal(err.code, 'FLAUZ_TELEMETRY_CONFIG_CORRUPT');
                                assert.match(err.message, /foreign artifact/);
                                return true;
                        },
                );
        });

        test('malformed arguments refuse typed (enable not boolean, retention out of bounds, unknown keys)', () => {
                assert.throws(() => parseConfigArg({ enable: 'yes' }), (err: unknown) => {
                        assert.ok(err instanceof TelemetryError);
                        assert.equal((err as TelemetryError).code, 'FLAUZ_TELEMETRY_CONFIG_INVALID');
                        return true;
                });
                assert.throws(() => parseConfigArg({ retentionDays: 0 }), /retentionDays.*must be an integer/);
                assert.throws(() => parseConfigArg({ retentionDays: 4000 }), /retentionDays.*must be an integer/);
                assert.throws(() => parseConfigArg({ surprise: 1 }), /unknown argument key 'surprise'/);
                assert.throws(() => parseConfigArg('enable'), /must be an object/);
                assert.deepEqual(parseConfigArg(undefined), {});
                assert.deepEqual(parseConfigArg({ enable: true }), { enable: true });
                assert.deepEqual(parseConfigArg({ retentionDays: 45 }), { retentionDays: 45 });
        });

        test('schema drift under an active consent refuses the record pass typed', async () => {
                const initial = await loadTelemetryConfig(fixture.root, fixture.fs);
                await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, initial, { enable: true });
                // tamper the pinned digest (simulating a vocabulary change under consent)
                const configPath = path.join(fixture.root, '.flauz', 'telemetry', 'config.json');
                const persisted = JSON.parse(await fs.readFile(configPath, 'utf-8')) as Record<string, unknown>;
                persisted.schemaDigest = '0'.repeat(64);
                await fs.writeFile(configPath, JSON.stringify(persisted, null, 2) + '\n', 'utf-8');

                await assert.rejects(
                        () => runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-drift'),
                        (err: unknown) => {
                                assert.ok(err instanceof TelemetryError);
                                assert.equal(err.code, 'FLAUZ_TELEMETRY_SCHEMA_DRIFT');
                                assert.match(err.message, /drifted from the digest pinned at enable time/);
                                return true;
                        },
                );
        });
});
