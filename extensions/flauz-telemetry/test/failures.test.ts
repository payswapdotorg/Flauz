/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The failures suite (A-PROD-004-W4): the typed failure taxonomy semantics --
 * EVERY taxonomy class round-trips through a fixture failure into the ledger
 * AND the census (the round-trip law: drive a real durable failure -> record
 * -> ledger carries the class -> the census groups it).
 *
 * The round-trip legs drive the REAL owning surfaces (the sanctioned
 * local-real fixture construction): the provider classes ride the real
 * orchestration journal's provider-retry window (the closed DL-35 vocabulary,
 * written by the real OrchestrationStore.recordProviderRetry); the
 * environment classes ride the real registry states (the invalid descriptor,
 * and the activeId misconfigurations: missing reference, disabled reference,
 * untrusted posture); the incompatibility class rides the real routing
 * layer's no-candidate decision.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { applyConfigChange, loadTelemetryConfig } from '../src/config.ts';
import { runRecordPass, readTelemetryLedger } from '../src/record.ts';
import { FAILURE_CLASSES, classifyFailure, failureClassForCode, type FailureClassDef } from '../src/failures.ts';
import { collectFailureCensus, renderCensusLines } from '../src/failuresList.ts';

import { bootFixtureWorkspace, captureChannel, type FixtureWorkspace } from './helpers.ts';
import { registerTelemetryCommands } from '../src/commands.ts';
import { setVscodeApi } from '../src/globals.ts';

/** Enables telemetry on a fixture (the explicit operator action). */
async function enable(fixture: FixtureWorkspace): Promise<void> {
        const current = await loadTelemetryConfig(fixture.root, fixture.fs);
        await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { enable: true });
}

/** Reads + rewrites the fixture's environments registry (the env-leg vehicle). */
async function rewriteRegistry(root: string, mutate: (registry: { activeId?: string; environments: Record<string, unknown>[] }) => void): Promise<void> {
        const registryPath = path.join(root, '.flauz', 'environments.json');
        const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8')) as { activeId?: string; environments: Record<string, unknown>[] };
        mutate(registry);
        await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
}

suite('failures: the typed record shape', () => {

        test('classifyFailure returns the full typed record: class, surface, identity, remediation, telemetry dimension', () => {
                const typed = classifyFailure({ code: 'AUTH_FAILED', surface: 'flauz-models', identity: { providerId: 'lane-b' } });
                assert.equal(typed.failureClass, 'provider-auth-rejected');
                assert.equal(typed.surface, 'flauz-models');
                assert.deepEqual(typed.identity, { providerId: 'lane-b' });
                assert.match(typed.remediation, /vault/);
                assert.deepEqual(typed.telemetryDimension, { eventKind: 'failure', errorCode: 'provider-auth-rejected' });
        });

        test('every taxonomy entry types its source codes on its declared surfaces', () => {
                for (const entry of FAILURE_CLASSES) {
                        for (const code of entry.sourceCodes) {
                                for (const surface of entry.surfaces) {
                                        const typed = classifyFailure({ code, surface });
                                        assert.equal(typed.failureClass, entry.id);
                                }
                        }
                }
        });

        test('the environment-side codes type on the environments surface', () => {
                assert.equal(failureClassForCode('ENVIRONMENT_DISABLED')?.id, 'environment-disabled');
                assert.equal(failureClassForCode('ENVIRONMENT_UNKNOWN')?.id, 'environment-unknown');
                assert.equal(failureClassForCode('TRUST_POSTURE_REJECTED')?.id, 'environment-trust-rejected');
                assert.equal(failureClassForCode('STORE_CORRUPT')?.id, 'environment-validation-failed');
                assert.equal(failureClassForCode('DESCRIPTOR_INVALID')?.id, 'environment-validation-failed');
        });
});

suite('failures: the round-trip law (every taxonomy class through a fixture failure into the ledger)', () => {

        let fixture: FixtureWorkspace;

        suiteSetup(async () => {
                fixture = await bootFixtureWorkspace();
                await enable(fixture);
        });

        suiteTeardown(async () => {
                await fixture.cleanup();
        });

        test('every taxonomy class round-trips: drive a real fixture failure -> record -> the ledger carries the class', async () => {
                const driven: string[] = [];

                // --- the provider legs: the real journal's provider-retry window, one leg per class ---
                const journalLegged = new Set<string>();
                for (const entry of FAILURE_CLASSES) {
                        if (!entry.surfaces.includes('flauz-agent')) {
                                continue;
                        }
                        const code = entry.sourceCodes[0];
                        assert.ok(code !== undefined);
                        const store = fixture.orchestration;
                const submitted = await store.submitGraph({
                                title: `round-trip ${entry.id}`,
                                steps: [{ stepId: 'S-01', title: 'the class leg', instruction: 'drive the failure code' }],
                                actor: 'agent',
                                taskId: 'T-001',
                        });
                        await store.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:round-trip' });
                        const start = await store.startStep({ graphId: submitted.graphId, stepId: 'S-01', actor: 'agent', origin: 'test:round-trip', runnerId: 'rr' });
                        await store.recordProviderRetry({ graphId: submitted.graphId, stepId: 'S-01', attempt: start.attempt, idempotencyKey: start.idempotencyKey, attemptOrdinal: 1, outcome: 'retryable-failed', code, retryClass: 'short-backoff', waitAppliedMs: 0, maxAttempts: 3, nextAttemptOrdinal: 2 });
                        journalLegged.add(entry.id);
                }
                // the base fixture's real surfaces already carry these journal classes; the legs widen the coverage to every agent-surface class
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-rt-provider');
                driven.push(...journalLegged);

                // --- the routing leg: the incompatibility class rides the base fixture's no-candidate decision ---
                driven.push('environment-provider-incompatibility');

                // --- the environment legs: real registry states, one record pass per state ---
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-rt-invalid');
                driven.push('environment-validation-failed');

                await rewriteRegistry(fixture.root, registry => { registry.activeId = 'env-missing-ghost'; });
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-rt-unknown');
                driven.push('environment-unknown');

                await rewriteRegistry(fixture.root, registry => { registry.activeId = 'env-disabled-box'; });
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-rt-disabled');
                driven.push('environment-disabled');

                await rewriteRegistry(fixture.root, registry => {
                        registry.activeId = 'env-build-box';
                        const active = registry.environments.find(entry => entry.id === 'env-build-box');
                        assert.ok(active !== undefined);
                        (active.trust as Record<string, unknown>).posture = 'untrusted';
                });
                await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-rt-trust');
                driven.push('environment-trust-rejected');

                // --- the law: EVERY taxonomy class landed in the ledger ---
                assert.equal(driven.length, FAILURE_CLASSES.length, 'every taxonomy class has a round-trip leg');
                const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
                const recordedClasses = new Set(rows.filter(row => row.eventKind === 'failure').map(row => row.errorCode));
                for (const entry of FAILURE_CLASSES) {
                        assert.ok(recordedClasses.has(entry.id), `the ledger must carry the round-tripped class ${entry.id}`);
                }
                // every failure row's class IS a taxonomy class (closure both ways)
                for (const row of rows.filter(r => r.eventKind === 'failure')) {
                        assert.ok(FAILURE_CLASSES.some((entry: FailureClassDef) => entry.id === row.errorCode));
                }
        });

        test('the failure census groups EVERY observed class with remediation hints and the time distribution', async () => {
                const census = await collectFailureCensus({ root: fixture.root, fs: fixture.fs, clock: fixture.clock });
                assert.equal(census.classes.length, FAILURE_CLASSES.length, 'the census renders every round-tripped class');
                for (const group of census.classes) {
                        assert.ok(group.remediation.length > 40, `the remediation hint rides every group (${group.failureClass})`);
                        assert.ok(Object.keys(group.timeDistribution).length >= 1);
                        assert.ok(group.surfaces.length >= 1);
                        assert.ok(group.eventCount >= 1);
                }
                const capacity = census.classes.find(group => group.failureClass === 'provider-lane-capacity');
                assert.ok(capacity !== undefined);
                assert.ok(capacity.eventCount >= 3, 'the fixture + round-trip legs accumulate the capacity class');
                const unknown = census.classes.find(group => group.failureClass === 'environment-unknown');
                assert.ok(unknown !== undefined);
                assert.deepEqual(unknown.affectedIdentities, ['environmentId:env-missing-ghost']);
        });

        test('the census render is the grouped operator UX (class, surfaces, identities, distribution, remediation)', () => {
                const census = { $schema: 'flauz.telemetry-failures/v1', generatedAt: 1, windowDays: 30, totalFailures: 2, parseErrorCount: 0, classes: [
                        {
                                failureClass: 'provider-unreachable',
                                label: 'Provider unreachable',
                                surfaces: ['flauz-agent'],
                                affectedIdentities: ['graphId:G-001'],
                                eventCount: 2,
                                timeDistribution: { '2026-10-01': 1, '2026-10-02': 1 },
                                firstAt: 1,
                                lastAt: 2,
                                remediation: 'Check network egress from this machine and the provider endpoint reachability (DNS, proxy, TLS). The retry class is short-backoff: a later attempt may recover on its own; if the lane stays unreachable, switch the routing policy to a reachable lane.',
                        },
                ] };
                const text = renderCensusLines(census as never).join('\n');
                assert.match(text, /flauz\.failures\.list -- the recent failure census/);
                assert.match(text, /\[provider-unreachable\] Provider unreachable/);
                assert.match(text, /surfaces: flauz-agent/);
                assert.match(text, /affected identities \(ids only\): graphId:G-001/);
                assert.match(text, /time distribution: 2026-10-01=1 2026-10-02=1/);
                assert.match(text, /remediation: Check network egress/);
        });

        test('the failures.list command renders through the channel (the command surface integration)', async () => {
                const channel = captureChannel();
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
                const command = registered.find(entry => entry.id === 'flauz.failures.list');
                assert.ok(command !== undefined);
                const outcome = await command.handler(undefined);
                assert.equal((outcome as { ok: boolean }).ok, true);
                const text = channel.lines.join('\n');
                assert.match(text, /grouped by failure class/);
                assert.match(text, /remediation:/);
        });

        test('the census-visible evidence ledger carries the telemetry banking rows (the W1 diagnosability)', async () => {
                const evidenceText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                const rows = evidenceText.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as { taskId: string; kind: string; uri: string });
                const banked = rows.filter(row => row.taskId === 'flauz-telemetry');
                assert.ok(banked.length >= 5, 'every record pass with rows banked one census-visible note row');
                for (const row of banked) {
                        assert.equal(row.kind, 'note');
                        assert.equal(row.uri, '.flauz/telemetry/ledger.jsonl');
                }
        });
});
