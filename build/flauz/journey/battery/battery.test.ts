/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-011 / CR-010b -- the journey battery suite (mocha tdd).
 *
 * Coverage: the seven-journey manifest pins, the honest-status laws
 * (labels only on runnable steps; owners only on pending steps), the
 * driver-leg RUN GREEN assertion, the reload drill byte-equality,
 * the in-process CLI legs, the CR-010b journey-4 capability legs
 * (five runnable local-real legs over the real registry pipeline,
 * four still pending under CR-006/CR-008), receipt scope/version
 * stamps, the determinism double-run modulo runId, and the
 * no-write-outside-root containment audit. No Date.now, no
 * Math.random.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
        BATTERY_VERSION,
        JOURNEYS,
        runBattery,
        type DriverRunRecord,
        type DriverRunner,
} from './battery.ts';
import { sha256Hex } from '../../cli/runtime/context.ts';

const EXPECTED_IDS = [
        'journey-1-coding',
        'journey-2-research',
        'journey-3-multi-agent',
        'journey-4-capability',
        'journey-5-recovery',
        'journey-6-cli',
        'journey-7-unsafe-capability',
];

function stubDriver(root: string): DriverRunner {
        return async () =>
                ({
                        invocation: ['stub'],
                        exitCode: 0,
                        outDir: join(root, 'dogfood-records'),
                        exercises: ['agent-delegation', 'tools-exploration'],
                        verdictGreen: true,
                        runGreenText: true,
                }) satisfies DriverRunRecord;
}

function stepsOf(journeyId: string) {
        const journey = JOURNEYS.find((candidate) => candidate.id === journeyId);
        assert.notEqual(journey, undefined);
        return journey!.steps;
}

suite('flauz journey battery: the manifest', () => {
        test('there are exactly seven journeys', () => {
                assert.equal(JOURNEYS.length, 7);
        });

        test('the journey ids are stable', () => {
                assert.deepEqual(
                        JOURNEYS.map((journey) => journey.id),
                        EXPECTED_IDS,
                );
        });

        test('every runnable-now step carries an evidence label and no pending owner', () => {
                for (const journey of JOURNEYS) {
                        for (const step of journey.steps) {
                                if (step.status === 'runnable-now') {
                                        assert.ok(step.evidenceLabel !== undefined, journey.id + '/' + step.stepId);
                                        assert.equal(step.pendingOwner, undefined);
                                }
                        }
                }
        });

        test('every pending-wiring step carries a pending owner and NO label', () => {
                for (const journey of JOURNEYS) {
                        for (const step of journey.steps) {
                                if (step.status === 'pending-wiring') {
                                        assert.ok(step.pendingOwner !== undefined, journey.id + '/' + step.stepId);
                                        assert.equal(step.evidenceLabel, undefined);
                                }
                        }
                }
        });

        test('labels stay inside the frozen vocabulary', () => {
                for (const journey of JOURNEYS) {
                        for (const step of journey.steps) {
                                if (step.evidenceLabel !== undefined) {
                                        assert.ok(step.evidenceLabel === 'simulated' || step.evidenceLabel === 'local-real');
                                }
                        }
                }
        });

        test('surfaces stay inside the frozen vocabulary', () => {
                for (const journey of JOURNEYS) {
                        for (const step of journey.steps) {
                                assert.ok(
                                        step.surface === 'desktop' ||
                                                step.surface === 'web' ||
                                                step.surface === 'cli' ||
                                                step.surface === 'headless',
                                );
                        }
                }
        });

        test('journey-1: eight runnable simulated steps', () => {
                const steps = stepsOf('journey-1-coding');
                assert.equal(steps.length, 8);
                assert.ok(steps.every((step) => step.status === 'runnable-now' && step.evidenceLabel === 'simulated'));
        });

        test('journey-2: seven runnable simulated steps plus the CR-005 memory leg', () => {
                const steps = stepsOf('journey-2-research');
                assert.equal(steps.length, 8);
                const memory = steps.find((step) => step.stepId === 'j2-s7-persist-memory');
                assert.equal(memory?.status, 'pending-wiring');
                assert.equal(memory?.pendingOwner, 'CR-005');
                assert.equal(steps.filter((step) => step.status === 'runnable-now').length, 7);
        });

        test('journey-3: seven runnable simulated steps', () => {
                const steps = stepsOf('journey-3-multi-agent');
                assert.equal(steps.length, 7);
                assert.ok(steps.every((step) => step.status === 'runnable-now'));
        });

        test('journey-4: five runnable local-real steps plus four pending owned by CR-006/CR-008', () => {
                const steps = stepsOf('journey-4-capability');
                assert.equal(steps.length, 9);
                const runnableSteps = steps.filter((step) => step.status === 'runnable-now');
                assert.equal(runnableSteps.length, 5);
                assert.ok(runnableSteps.every((step) => step.evidenceLabel === 'local-real'));
                const pendingSteps = steps.filter((step) => step.status === 'pending-wiring');
                assert.equal(pendingSteps.length, 4);
                assert.deepEqual([...new Set(pendingSteps.map((step) => step.pendingOwner))].sort(), ['CR-006', 'CR-008']);
        });

        test('journey-4: the capability journey is an in-process journey', () => {
                const journey = JOURNEYS.find((candidate) => candidate.id === 'journey-4-capability');
                assert.equal(journey?.execution, 'in-process');
        });

        test('journey-5: seven runnable local-real steps (the CR-004 cold-replay leg graduated)', () => {
                const steps = stepsOf('journey-5-recovery');
                assert.equal(steps.length, 7);
                const replay = steps.find((step) => step.stepId === 'j5-s4-replay');
                assert.equal(replay?.status, 'runnable-now');
                assert.equal(replay?.evidenceLabel, 'local-real');
                assert.equal(replay?.pendingOwner, undefined);
                assert.equal(steps.filter((step) => step.status === 'runnable-now').length, 7);
                assert.ok(
                        steps
                                .filter((step) => step.status === 'runnable-now')
                                .every((step) => step.evidenceLabel === 'local-real'),
                );
        });

        test('journey-6: eight runnable local-real steps', () => {
                const steps = stepsOf('journey-6-cli');
                assert.equal(steps.length, 8);
                assert.ok(steps.every((step) => step.status === 'runnable-now' && step.evidenceLabel === 'local-real'));
        });

        test('journey-7: five pending steps, all owned by CR-008', () => {
                const steps = stepsOf('journey-7-unsafe-capability');
                assert.equal(steps.length, 5);
                assert.ok(steps.every((step) => step.status === 'pending-wiring' && step.pendingOwner === 'CR-008'));
        });
});

suite('flauz journey battery: the runner (stubbed driver)', () => {
        test('runnable journeys produce receipts; pending-only journeys produce none', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                assert.equal(record.batteryVersion, BATTERY_VERSION);
                assert.ok(record.scope.workspaceId.length > 0);
                assert.ok(record.scope.tenantId.length > 0);
                const byId = new Map(record.journeys.map((receipt) => [receipt.journeyId, receipt]));
                for (const id of ['journey-1-coding', 'journey-2-research', 'journey-3-multi-agent', 'journey-4-capability', 'journey-5-recovery', 'journey-6-cli']) {
                        const receipt = byId.get(id);
                        assert.notEqual(receipt, undefined, id);
                        assert.ok(receipt!.executed.length > 0, id);
                        assert.ok(receipt!.executed.every((step) => step.evidenceLabel !== undefined));
                }
                const j4 = byId.get('journey-4-capability');
                assert.equal(j4?.executed.length, 5);
                assert.equal(j4?.pending.length, 4);
                for (const id of ['journey-7-unsafe-capability']) {
                        const receipt = byId.get(id);
                        assert.equal(receipt?.executed.length, 0, id);
                        assert.ok(receipt!.pending.length > 0);
                        assert.ok(receipt!.pending.every((step) => step.status === 'pending-wiring'));
                }
        });

        test('the J5 reload drill is byte-equal', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                assert.equal(record.reloadDrill.byteEqual, true);
                assert.equal(record.reloadDrill.loadedFirst, true);
                assert.equal(record.reloadDrill.loadedSecond, true);
        });

        test('the J5 cold-replay leg executes green through the CR-004 observatory runtime', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const j5 = record.journeys.find((receipt) => receipt.journeyId === 'journey-5-recovery');
                assert.equal(j5?.executed.length, 7);
                assert.equal(j5?.pending.length, 0);
                const replay = j5!.executed.find((step) => step.stepId === 'j5-s4-replay');
                assert.notEqual(replay, undefined);
                assert.equal(replay!.evidenceLabel, 'local-real');
                assert.equal(replay!.verdict, 'green');
                assert.ok(replay!.detail.includes('cold replay pinned at X-000002'), replay!.detail);
                assert.ok(record.coldReplay.admissionOk);
                assert.ok(record.coldReplay.restartEqual);
                assert.equal(record.coldReplay.journalRows, 2);
                assert.match(record.coldReplay.journalDigest, /^[0-9a-f]{8}$/);
        });

        test('the J5 cold-replay drill is restart-deterministic and reuses the journal over the same root', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const first = await runBattery({ root, runId: 'run-a', driverRunner: stubDriver(root) });
                const second = await runBattery({ root, runId: 'run-b', driverRunner: stubDriver(root) });
                assert.deepEqual(second.coldReplay, first.coldReplay);
                assert.equal(first.coldReplay.journalRows, 2, 'the drill journal is seeded exactly once and reused');
                assert.equal(first.coldReplay.restartJournalDigest, first.coldReplay.journalDigest);
        });

        test('the J6 CLI legs execute with the typed refusal legs exact', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const j6 = record.journeys.find((receipt) => receipt.journeyId === 'journey-6-cli');
                assert.equal(j6?.executed.length, 8);
                const byStep = new Map(j6!.executed.map((step) => [step.stepId, step]));
                assert.equal(byStep.get('j6-s1-cli')?.exitCode, 2);
                assert.equal(byStep.get('j6-s2-task')?.exitCode, 2);
                assert.equal(byStep.get('j6-s4-approval')?.exitCode, 3);
                assert.equal(byStep.get('j6-s5-evidence')?.exitCode, 1);
                assert.equal(byStep.get('j6-s8-resume')?.exitCode, 3);
                assert.equal(byStep.get('j6-s4-approval')?.verdict, 'green');
        });

        test('determinism: two runs over the same root are byte-identical modulo runId', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const first = await runBattery({ root, runId: 'run-a', driverRunner: stubDriver(root) });
                const second = await runBattery({ root, runId: 'run-b', driverRunner: stubDriver(root) });
                const strip = (value: unknown) =>
                        JSON.stringify(value).replaceAll('run-a', 'RUNID').replaceAll('run-b', 'RUNID');
                assert.equal(strip(first), strip(second));
        });

        test('the parity view over the receipts pins the deterministic verdicts', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const verdicts = new Map(record.parity.map((entry) => [entry.journey, entry.verdict]));
                assert.equal(verdicts.get('background-agent'), 'par-partial');
                assert.equal(verdicts.get('approval'), 'par-partial');
                assert.equal(verdicts.get('evidence'), 'par-partial');
                assert.equal(verdicts.get('workspace'), 'par-absent');
        });

        test('the battery writes nothing outside its given root', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const parent = dirname(root);
                const before = new Set((await readdir(parent)).sort());
                await runBattery({ root, driverRunner: stubDriver(root) });
                const after = new Set((await readdir(parent)).sort());
                assert.deepEqual([...after].filter((name) => !before.has(name)), []);
        });
});

suite('flauz journey battery: the journey-4 capability legs (CR-010b)', () => {
        test('the J4 capability legs execute green with the fixture-source disclosure', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const j4 = record.journeys.find((receipt) => receipt.journeyId === 'journey-4-capability');
                assert.equal(j4?.executed.length, 5);
                const byStep = new Map(j4!.executed.map((step) => [step.stepId, step]));
                for (const stepId of ['j4-s2-discover', 'j4-s3-inspect', 'j4-s4-import', 'j4-s5-verify', 'j4-s6-approval']) {
                        const step = byStep.get(stepId);
                        assert.notEqual(step, undefined, stepId);
                        assert.equal(step!.verdict, 'green', stepId);
                        assert.equal(step!.evidenceLabel, 'local-real', stepId);
                        assert.ok(step!.detail.includes('fixture source, real registry pipeline'), stepId);
                }
        });

        test('the J4 discover receipt names the imported entry', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const j4 = record.journeys.find((receipt) => receipt.journeyId === 'journey-4-capability');
                const discover = j4!.executed.find((step) => step.stepId === 'j4-s2-discover');
                assert.ok(discover!.detail.includes(record.capability.entryId));
        });

        test('the J4 registry pipeline leaves real journal and snapshot files under the battery root', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                assert.ok(record.capability.registryRoot.startsWith(root));
                const journal = await readFile(join(record.capability.registryRoot, 'registry-journal.jsonl'), 'utf8');
                const snapshot = await readFile(join(record.capability.registryRoot, 'registry-state.json'), 'utf8');
                assert.ok(journal.length > 0);
                assert.ok(snapshot.length > 0);
                assert.equal(sha256Hex(journal), record.capability.journalDigest);
                assert.equal(sha256Hex(snapshot), record.capability.snapshotDigest);
        });

        test('the J4 entry reaches the approved state through the ruled gates', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                assert.ok(record.capability.entryId.length > 0);
                assert.equal(record.capability.entryState, 'approved');
        });

        test('the J4 journal carries the approval record and the acknowledged permissions', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const journal = await readFile(join(record.capability.registryRoot, 'registry-journal.jsonl'), 'utf8');
                assert.ok(journal.includes('operator-1'));
                assert.ok(journal.includes('read-files'));
                assert.ok(journal.includes('demo-capability'));
        });

        test('the J4 legs contribute no CLI parity projection (in-process, not CLI commands)', async function () {
                this.timeout(60000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-'));
                const record = await runBattery({ root, driverRunner: stubDriver(root) });
                const verdicts = new Map(record.parity.map((entry) => [entry.journey, entry.verdict]));
                assert.equal(verdicts.get('capability-discovery'), 'par-absent');
        });
});

suite('flauz journey battery: the real driver leg', () => {
        test('the driver runs GREEN and both mapped exercises are banked', async function () {
                this.timeout(600000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-battery-real-'));
                const parent = dirname(root);
                const before = new Set((await readdir(parent)).sort());
                const record = await runBattery({ root });
                assert.equal(record.driver?.exitCode, 0);
                assert.equal(record.driver?.verdictGreen, true);
                assert.ok(record.driver!.exercises.includes('agent-delegation'));
                assert.ok(record.driver!.exercises.includes('tools-exploration'));
                const j1 = record.journeys.find((receipt) => receipt.journeyId === 'journey-1-coding');
                assert.ok(j1!.executed.every((step) => step.evidenceLabel === 'simulated'));
                const after = new Set((await readdir(parent)).sort());
                assert.deepEqual([...after].filter((name) => !before.has(name)), []);
        });
});
