/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-013 -- the acceptance runner suite (mocha tdd). v2 (station gate round 3: the 40+ bar closed).
 *
 * Coverage: the map census (verbatim-carry pins, resolver cross-pins,
 * the per-authority differential cross-pin, invariant instrumentation
 * incl. synthetic lawbreakers), the J-leg census (the confirmed
 * manifest arithmetic), the exercise census + closure verdicts
 * (deference-to-the-map proofs, pending-exercises-nothing, the
 * still-gap shape consistency), the suite inventory (receipt echo,
 * no-receipt-yet, unknown-receipt disclosure, receipt isolation),
 * purity + determinism (no-mutation over the LIVE arrays, double-run
 * equality, the mutated-tree double-run, byte-identical emission
 * across roots, root-independent content, containment), and the
 * README row pin. No clock, no randomness; nothing executes.
 *
 * TEST CENSUS (auditable, per-suite — the round-3 discipline after
 * two author miscounts, 44 -> 39 -> the station's true 38):
 *   map census 11 · leg census 7 · exercise census 9 ·
 *   suite inventory 6 · purity/determinism/emission 8 · readme pin 1
 *   = 42 tests total (38 held green + 4 added this round).
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ACTIVATION_CONTRACTS_VERSION, WIRING } from '../../zcode-patterns/activation/common/wiring.ts';
import type { WiringEntry } from '../../zcode-patterns/activation/common/wiring.ts';
import { allContractModules, wiringInvariant } from '../../zcode-patterns/activation/common/coverage.ts';
import { BATTERY_VERSION, JOURNEYS } from '../battery/battery.ts';
import { canonicalJson, sha256Hex } from '../../cli/runtime/context.ts';
import {
        ACCEPTANCE_REPORT_NAME,
        ACCEPTANCE_REPORT_VERSION,
        EXERCISE_NEVER_PROMOTES,
        buildAcceptanceReport,
        emitAcceptanceReport,
        runAcceptance,
        type AcceptanceReport,
        type StationGateReceipt
} from './acceptanceRunner.ts';

const REPO_ROOT = process.cwd();
const BATTERY_README_PATH = 'build/flauz/journey/battery/README.md';

const BATTERY_RECEIPT: StationGateReceipt = {
        suite: 'build/flauz/journey/battery/battery.test.ts',
        command: 'node_modules/.bin/mocha --ui tdd build/flauz/journey/battery/battery.test.ts',
        result: '29 passing, 0 failing'
};

/** The ZC-003 hook-bus receipt, grounded in the map's own bytes ("54/54 local-real"). */
const HOOKBUS_RECEIPT: StationGateReceipt = {
        suite: 'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.test.ts',
        command: 'node_modules/.bin/mocha --ui tdd build/flauz/zcode-patterns/hook-bus/runtime/hookBus.test.ts',
        result: '54 passing, 0 failing'
};

function reportWith(receipts: readonly StationGateReceipt[] = []): AcceptanceReport {
        return buildAcceptanceReport({ wiringEntries: WIRING, journeys: JOURNEYS, gateReceipts: receipts });
}

function entryOf(report: AcceptanceReport, capabilityId: string) {
        const entry = report.entries.find((row) => row.capabilityId === capabilityId);
        assert.notEqual(entry, undefined, capabilityId);
        return entry!;
}

function exercisedOf(report: AcceptanceReport, capabilityId: string, legKind: string) {
        const record = entryOf(report, capabilityId).exercisedBy.find((row) => row.legKind === legKind);
        assert.notEqual(record, undefined, capabilityId + '/' + legKind);
        return record!;
}

function cloneWiring(): WiringEntry[] {
        return JSON.parse(JSON.stringify(WIRING)) as WiringEntry[];
}

suite('flauz acceptance: the map census', () => {
        test('exactly ten entries, ZC-001 through ZC-010, in the map\'s own order', () => {
                const report = reportWith();
                assert.equal(report.mapCensus.total, 10);
                assert.deepEqual(report.entries.map((row) => row.capabilityId), WIRING.map((entry) => entry.capabilityId));
        });

        test('wired is exactly ZC-003/ZC-004/ZC-005/ZC-008/ZC-009; gap is exactly the other five', () => {
                const report = reportWith();
                assert.deepEqual(report.mapCensus.wiredCapabilityIds, ['ZC-003', 'ZC-004', 'ZC-005', 'ZC-008', 'ZC-009']);
                assert.deepEqual(report.mapCensus.gapCapabilityIds, ['ZC-001', 'ZC-002', 'ZC-006', 'ZC-007', 'ZC-010']);
        });

        test('evidence census: five fixture gaps, five local-real wired', () => {
                const report = reportWith();
                assert.deepEqual(report.mapCensus.byEvidence, { fixture: 5, 'local-real': 5 });
        });

        test('gap-owner census: CR-002 owns two; CR-006/007/010 own one each', () => {
                const report = reportWith();
                assert.deepEqual(report.mapCensus.byGapOwner, { 'CR-002': 2, 'CR-006': 1, 'CR-007': 1, 'CR-010': 1 });
        });

        test('authority census partitions all ten entries', () => {
                const report = reportWith();
                assert.deepEqual(report.mapCensus.byAuthority, {
                        ACCEPTANCE: { total: 1, wired: 0, gaps: 1 },
                        AGENT_OS: { total: 4, wired: 2, gaps: 2 },
                        CAPABILITY_EXCHANGE: { total: 2, wired: 0, gaps: 2 },
                        EXECUTION: { total: 1, wired: 1, gaps: 0 },
                        MEMORY: { total: 1, wired: 1, gaps: 0 },
                        RESOURCES: { total: 1, wired: 1, gaps: 0 }
                });
                const totals = Object.values(report.mapCensus.byAuthority).reduce((sum, row) => sum + row.total, 0);
                assert.equal(totals, 10);
        });

        test('the per-authority census cross-pins the live map (differential derivation, not a literal)', () => {
                const report = reportWith();
                const expected: Record<string, { total: number; wired: number; gaps: number }> = {};
                for (const entry of WIRING) {
                        const row = expected[entry.authority] ?? { total: 0, wired: 0, gaps: 0 };
                        row.total += 1;
                        if (entry.state === 'wired') {
                                row.wired += 1;
                        } else {
                                row.gaps += 1;
                        }
                        expected[entry.authority] = row;
                }
                assert.deepEqual(report.mapCensus.byAuthority, expected);
                const wiredByAuthority = new Map<string, string[]>();
                for (const entry of WIRING) {
                        if (entry.state === 'wired') {
                                const list = wiredByAuthority.get(entry.authority) ?? [];
                                list.push(entry.capabilityId);
                                wiredByAuthority.set(entry.authority, list);
                        }
                }
                assert.deepEqual(wiredByAuthority.get('AGENT_OS'), ['ZC-003', 'ZC-009']);
                assert.deepEqual(wiredByAuthority.get('EXECUTION'), ['ZC-004']);
                assert.deepEqual(wiredByAuthority.get('MEMORY'), ['ZC-005']);
                assert.deepEqual(wiredByAuthority.get('RESOURCES'), ['ZC-008']);
        });

        test('contract-module census equals the coverage resolver over the live map', () => {
                const report = reportWith();
                assert.equal(report.mapCensus.contractModules, allContractModules(WIRING).length);
                assert.equal(report.mapCensus.contractModules, 50);
        });

        test('the five wired entry points are carried verbatim (path, exportName, role)', () => {
                const report = reportWith();
                for (const capabilityId of ['ZC-003', 'ZC-004', 'ZC-005', 'ZC-008', 'ZC-009']) {
                        const carried = entryOf(report, capabilityId).entryPoints;
                        const declared = WIRING.find((entry) => entry.capabilityId === capabilityId)!.entryPoints;
                        assert.equal(carried.length, declared.length, capabilityId);
                        for (let index = 0; index < declared.length; index += 1) {
                                assert.equal(carried[index]!.path, declared[index]!.path, capabilityId);
                                assert.equal(carried[index]!.exportName, declared[index]!.exportName ?? null, capabilityId);
                                assert.equal(carried[index]!.role, declared[index]!.role, capabilityId);
                        }
                }
                const facade = entryOf(report, 'ZC-008').entryPoints[0]!;
                assert.equal(facade.path, 'build/flauz/capabilities/commands/runtime/commandFacade.ts');
                assert.equal(facade.exportName, 'CommandFacadeRuntime');
        });

        test('gap owner and note are carried VERBATIM from the map\'s own fields', () => {
                const report = reportWith();
                for (const wiring of WIRING) {
                        const carried = entryOf(report, wiring.capabilityId);
                        assert.equal(carried.gapOwner, wiring.gapOwner ?? null, wiring.capabilityId);
                        assert.equal(carried.gapNote, wiring.gapNote ?? null, wiring.capabilityId);
                }
                assert.equal(entryOf(report, 'ZC-001').gapOwner, 'CR-002');
                assert.equal(entryOf(report, 'ZC-001').gapNote, WIRING.find((entry) => entry.capabilityId === 'ZC-001')!.gapNote);
        });

        test('invariant findings are empty at the pinned base (all ten pass the map\'s own law-checker)', () => {
                const report = reportWith();
                assert.deepEqual(report.mapCensus.invariantFindings, []);
                for (const entry of WIRING) {
                        assert.equal(wiringInvariant(entry).ok, true, entry.capabilityId);
                }
        });

        test('invariant instrumentation is honest, not throwing: a synthetic lawbreaker surfaces as a finding', () => {
                const doctored = cloneWiring();
                const target = doctored.find((entry) => entry.capabilityId === 'ZC-001')!;
                target.gapOwner = undefined;
                const report = buildAcceptanceReport({ wiringEntries: doctored, journeys: JOURNEYS, gateReceipts: [] });
                assert.equal(report.mapCensus.invariantFindings.length, 1);
                const finding = report.mapCensus.invariantFindings[0]!;
                assert.equal(finding.capabilityId, 'ZC-001');
                assert.ok(finding.violations.some((violation) => violation.includes('gapOwner')));
                assert.ok(entryOf(report, 'ZC-001').disclosures.length > 0);
        });
});

suite('flauz acceptance: the leg census', () => {
        test('seven journeys, fifty-two steps, forty-two runnable, ten pending', () => {
                const report = reportWith();
                const summary = report.legCensus.summary;
                assert.equal(summary.journeys, 7);
                assert.equal(summary.steps, 52);
                assert.equal(summary.runnable, 42);
                assert.equal(summary.pending, 10);
                assert.equal(summary.simulated, 22);
                assert.equal(summary.localReal, 20);
        });

        test('the pending census by owner: CR-005 x1, CR-006 x2, CR-008 x7', () => {
                const report = reportWith();
                assert.deepEqual(report.legCensus.summary.pendingByOwner, { 'CR-005': 1, 'CR-006': 2, 'CR-008': 7 });
        });

        test('per-journey arithmetic matches the manifest (j1/j2/j3 driver lanes)', () => {
                const report = reportWith();
                const byId = new Map(report.legCensus.journeys.map((row) => [row.journeyId, row]));
                const j1 = byId.get('journey-1-coding')!;
                assert.equal(j1.steps, 8);
                assert.equal(j1.runnable, 8);
                assert.equal(j1.simulated, 8);
                assert.equal(j1.pending, 0);
                const j2 = byId.get('journey-2-research')!;
                assert.equal(j2.steps, 8);
                assert.equal(j2.runnable, 7);
                assert.deepEqual(j2.pendingByOwner, { 'CR-005': 1 });
                assert.deepEqual(j2.pendingSteps.map((step) => step.stepId), ['j2-s7-persist-memory']);
                const j3 = byId.get('journey-3-multi-agent')!;
                assert.equal(j3.steps, 7);
                assert.equal(j3.runnable, 7);
                assert.equal(j3.simulated, 7);
        });

        test('journey-4: five runnable local-real legs plus four pending (CR-006 x2, CR-008 x2)', () => {
                const report = reportWith();
                const j4 = report.legCensus.journeys.find((row) => row.journeyId === 'journey-4-capability')!;
                assert.equal(j4.steps, 9);
                assert.equal(j4.runnable, 5);
                assert.equal(j4.localReal, 5);
                assert.equal(j4.pending, 4);
                assert.deepEqual(j4.pendingByOwner, { 'CR-006': 2, 'CR-008': 2 });
                assert.deepEqual(
                        j4.pendingSteps.map((step) => step.stepId),
                        ['j4-s1-need', 'j4-s7-register', 'j4-s8-execute', 'j4-s9-evidence']
                );
        });

        test('journey-5: seven runnable local-real legs including the graduated cold-replay leg', () => {
                const report = reportWith();
                const j5 = report.legCensus.journeys.find((row) => row.journeyId === 'journey-5-recovery')!;
                assert.equal(j5.steps, 7);
                assert.equal(j5.runnable, 7);
                assert.equal(j5.localReal, 7);
                assert.equal(j5.pending, 0);
        });

        test('journey-6: eight runnable local-real legs; journey-7: five pending, all CR-008', () => {
                const report = reportWith();
                const j6 = report.legCensus.journeys.find((row) => row.journeyId === 'journey-6-cli')!;
                assert.equal(j6.steps, 8);
                assert.equal(j6.runnable, 8);
                assert.equal(j6.localReal, 8);
                const j7 = report.legCensus.journeys.find((row) => row.journeyId === 'journey-7-unsafe-capability')!;
                assert.equal(j7.steps, 5);
                assert.equal(j7.runnable, 0);
                assert.equal(j7.pending, 5);
                assert.deepEqual(j7.pendingByOwner, { 'CR-008': 5 });
        });

        test('journey rows carry the battery\'s own titles and execution kinds verbatim', () => {
                const report = reportWith();
                const byId = new Map(report.legCensus.journeys.map((row) => [row.journeyId, row]));
                for (const journey of JOURNEYS) {
                        const row = byId.get(journey.id)!;
                        assert.equal(row.title, journey.title, journey.id);
                        assert.equal(row.execution, journey.execution, journey.id);
                }
        });
});

suite('flauz acceptance: the exercise census and closure verdicts', () => {
        test('the verdict summary is five closed, three exercised-still-gap, two unexercised-still-gap', () => {
                const report = reportWith();
                assert.equal(report.summary.total, 10);
                assert.equal(report.summary.closed, 5);
                assert.equal(report.summary.exercisedStillGap, 3);
                assert.equal(report.summary.unexercisedStillGap, 2);
                assert.deepEqual(report.summary.byGapOwner, { 'CR-002': 2, 'CR-006': 1, 'CR-007': 1, 'CR-010': 1 });
        });

        test('closed is exactly ZC-003/ZC-004/ZC-005/ZC-008/ZC-009; unexercised is exactly ZC-007/ZC-010', () => {
                const report = reportWith();
                assert.deepEqual(
                        report.entries.filter((row) => row.closureVerdict === 'closed').map((row) => row.capabilityId),
                        ['ZC-003', 'ZC-004', 'ZC-005', 'ZC-008', 'ZC-009']
                );
                assert.deepEqual(
                        report.entries.filter((row) => row.closureVerdict === 'unexercised-still-gap').map((row) => row.capabilityId),
                        ['ZC-007', 'ZC-010']
                );
                assert.deepEqual(report.summary.exercisedCapabilityIds, ['ZC-001', 'ZC-002', 'ZC-004', 'ZC-006', 'ZC-009']);
        });

        test('ZC-001 is exercised by the driver lane (22 simulated legs) and the store drills (8 local-real legs)', () => {
                const report = reportWith();
                const driver = exercisedOf(report, 'ZC-001', 'driver-lane');
                assert.equal(driver.evidenceLabel, 'simulated');
                assert.equal(driver.stepIds.length, 22);
                assert.deepEqual(driver.journeys, ['journey-1-coding', 'journey-2-research', 'journey-3-multi-agent']);
                const store = exercisedOf(report, 'ZC-001', 'store-drill');
                assert.equal(store.evidenceLabel, 'local-real');
                assert.equal(store.stepIds.length, 8);
                assert.deepEqual(store.journeys, ['journey-5-recovery', 'journey-6-cli']);
        });

        test('ZC-002 is exercised by the store drills, the roster leg, and the bg-runtime leg; ZC-006 by the registry pipeline', () => {
                const report = reportWith();
                assert.equal(exercisedOf(report, 'ZC-002', 'store-drill').stepIds.length, 8);
                assert.deepEqual(exercisedOf(report, 'ZC-002', 'roster').stepIds, ['j6-s3-agent']);
                assert.deepEqual(exercisedOf(report, 'ZC-002', 'bg-runtime').stepIds, ['j6-s8-resume']);
                const registry = exercisedOf(report, 'ZC-006', 'registry-pipeline');
                assert.deepEqual(
                        registry.stepIds,
                        ['j4-s2-discover', 'j4-s3-inspect', 'j4-s4-import', 'j4-s5-verify', 'j4-s6-approval']
                );
        });

        test('ZC-009 is exercised by the CLI lane (the seven runCli legs); j6-s6-restart is a store drill, not a CLI leg', () => {
                const report = reportWith();
                const cli = exercisedOf(report, 'ZC-009', 'cli-lane');
                assert.deepEqual(
                        cli.stepIds,
                        ['j6-s1-cli', 'j6-s2-task', 'j6-s3-agent', 'j6-s4-approval', 'j6-s5-evidence', 'j6-s7-inspect', 'j6-s8-resume']
                );
                assert.ok(!cli.stepIds.includes('j6-s6-restart'));
                assert.ok(exercisedOf(report, 'ZC-001', 'store-drill').stepIds.includes('j6-s6-restart'));
        });

        test('ZC-004 is exercised by the graduated cold-replay leg', () => {
                const report = reportWith();
                assert.deepEqual(exercisedOf(report, 'ZC-004', 'cold-replay').stepIds, ['j5-s4-replay']);
        });

        test('pending legs exercise nothing: no pending stepId appears in any exercisedBy record', () => {
                const report = reportWith();
                const pendingIds = new Set<string>();
                for (const journey of JOURNEYS) {
                        for (const step of journey.steps) {
                                if (step.status === 'pending-wiring') {
                                        pendingIds.add(step.stepId);
                                }
                        }
                }
                assert.equal(pendingIds.size, 10);
                for (const entry of report.entries) {
                        for (const record of entry.exercisedBy) {
                                for (const stepId of record.stepIds) {
                                        assert.ok(!pendingIds.has(stepId), stepId + ' is pending and must not exercise anything');
                                }
                        }
                }
                assert.deepEqual(entryOf(report, 'ZC-007').exercisedBy, []);
                assert.deepEqual(entryOf(report, 'ZC-010').exercisedBy, []);
        });

        test('verdicts defer to the map, never to exercise: a synthetic wired flip closes ZC-009 without changing any leg', () => {
                const doctored = cloneWiring();
                const target = doctored.find((entry) => entry.capabilityId === 'ZC-009')!;
                target.state = 'wired';
                target.gapOwner = undefined;
                target.gapNote = undefined;
                const report = buildAcceptanceReport({ wiringEntries: doctored, journeys: JOURNEYS, gateReceipts: [] });
                assert.equal(entryOf(report, 'ZC-009').closureVerdict, 'closed');
                assert.equal(exercisedOf(report, 'ZC-009', 'cli-lane').stepIds.length, 7); /* the legs are unchanged */
                assert.equal(report.summary.closed, 5);
        });

        test('every exercised-still-gap entry carries its owner, a non-empty note, and at least one exercise record; the unexercised carry none', () => {
                const report = reportWith();
                const exercised = report.entries.filter((row) => row.closureVerdict === 'exercised-still-gap');
                assert.deepEqual(
                        exercised.map((row) => row.capabilityId),
                        ['ZC-001', 'ZC-002', 'ZC-006']
                );
                for (const row of exercised) {
                        assert.notEqual(row.gapOwner, null, row.capabilityId);
                        assert.notEqual(row.gapNote, null, row.capabilityId);
                        assert.ok(row.gapNote!.length > 0, row.capabilityId);
                        assert.ok(row.exercisedBy.length > 0, row.capabilityId);
                }
                const unexercised = report.entries.filter((row) => row.closureVerdict === 'unexercised-still-gap');
                assert.deepEqual(
                        unexercised.map((row) => row.capabilityId),
                        ['ZC-007', 'ZC-010']
                );
                for (const row of unexercised) {
                        assert.deepEqual(row.exercisedBy, [], row.capabilityId);
                        assert.notEqual(row.gapOwner, null, row.capabilityId);
                        assert.ok(row.gapNote!.length > 0, row.capabilityId);
                }
        });
});

suite('flauz acceptance: the suite inventory', () => {
        test('the expected inventory is the ten frozen suites, each with its byte-grounded source of expectation', () => {
                const report = reportWith();
                assert.equal(report.suiteInventory.rows.length, 10);
                const suites = report.suiteInventory.rows.map((row) => row.suite);
                assert.ok(suites.includes('build/flauz/zcode-patterns/activation/test/common/wiring.test.ts'));
                assert.ok(suites.includes('build/flauz/capabilities/commands/runtime/commandFacade.test.ts'));
                assert.ok(suites.includes('build/flauz/cli/compound.test.ts'));
                assert.ok(suites.includes('build/flauz/journey/simulation/simulation.test.ts'));
                assert.ok(suites.includes('build/flauz/journey/acceptance/acceptanceRunner.test.ts'));
                for (const row of report.suiteInventory.rows) {
                        assert.ok(row.sourceOfExpectation.length > 0, row.suite);
                }
        });

        test('with no injected receipts, every expected suite is honestly no-receipt-yet', () => {
                const report = reportWith();
                assert.deepEqual(report.suiteInventory.summary, { expected: 10, withReceipt: 0, noReceiptYet: 10, unknownReceipts: [] });
                assert.ok(report.suiteInventory.rows.every((row) => row.receipt === null));
        });

        test('injected receipts are echoed verbatim (suite, command, result)', () => {
                const report = reportWith([BATTERY_RECEIPT]);
                const row = report.suiteInventory.rows.find((candidate) => candidate.suite === BATTERY_RECEIPT.suite)!;
                assert.deepEqual(row.receipt, { command: BATTERY_RECEIPT.command, result: BATTERY_RECEIPT.result });
                assert.equal(report.suiteInventory.summary.withReceipt, 1);
                assert.equal(report.suiteInventory.summary.noReceiptYet, 9);
        });

        test('an injected receipt outside the expected list is disclosed as unknown, never dropped', () => {
                const stray: StationGateReceipt = {
                        suite: 'build/flauz/nowhere/stray.test.ts',
                        command: 'node_modules/.bin/mocha --ui tdd build/flauz/nowhere/stray.test.ts',
                        result: '1 passing, 0 failing'
                };
                const report = reportWith([BATTERY_RECEIPT, stray]);
                assert.deepEqual(report.suiteInventory.summary.unknownReceipts, ['build/flauz/nowhere/stray.test.ts']);
                assert.equal(report.suiteInventory.rows.length, 10); /* the stray never adds or mutates a row */
        });

        test('the battery gate receipt carries the station-ruled shape end to end', () => {
                const report = reportWith([BATTERY_RECEIPT]);
                const row = report.suiteInventory.rows.find((candidate) => candidate.suite === BATTERY_RECEIPT.suite)!;
                assert.equal(row.receipt!.result, '29 passing, 0 failing');
                assert.equal(row.sourceOfExpectation, 'the station ls-files + the pasted suite (Batch 5)');
                assert.equal(report.generatedFrom.gateReceiptCount, 1);
        });

        test('gate receipts touch exactly one section: injecting receipts changes nothing but the suite inventory', () => {
                const bare = reportWith();
                const withReceipts = reportWith([BATTERY_RECEIPT, HOOKBUS_RECEIPT]);
                assert.deepEqual(withReceipts.mapCensus, bare.mapCensus);
                assert.deepEqual(withReceipts.legCensus, bare.legCensus);
                assert.deepEqual(withReceipts.entries, bare.entries);
                assert.deepEqual(withReceipts.summary, bare.summary);
                assert.deepEqual(withReceipts.disclosures, bare.disclosures);
                assert.equal(withReceipts.generatedFrom.gateReceiptCount, 2);
                assert.equal(withReceipts.suiteInventory.summary.expected, 10);
                assert.equal(withReceipts.suiteInventory.summary.withReceipt, 2);
                assert.equal(withReceipts.suiteInventory.summary.noReceiptYet, 8);
                assert.deepEqual(withReceipts.suiteInventory.summary.unknownReceipts, []);
                assert.equal(
                        withReceipts.suiteInventory.summary.withReceipt + withReceipts.suiteInventory.summary.noReceiptYet,
                        withReceipts.suiteInventory.summary.expected
                );
                const hookbusRow = withReceipts.suiteInventory.rows.find((row) => row.suite === HOOKBUS_RECEIPT.suite)!;
                assert.equal(hookbusRow.receipt!.result, '54 passing, 0 failing');
        });
});

suite('flauz acceptance: purity, determinism, and the emission', () => {
        test('the builder never mutates the LIVE map or manifest arrays', () => {
                const wiringSnapshot = JSON.stringify(WIRING);
                const journeysSnapshot = JSON.stringify(JOURNEYS);
                reportWith([BATTERY_RECEIPT]);
                assert.equal(JSON.stringify(WIRING), wiringSnapshot);
                assert.equal(JSON.stringify(JOURNEYS), journeysSnapshot);
        });

        test('two builds over equal inputs produce deep-equal reports', () => {
                assert.deepEqual(reportWith([BATTERY_RECEIPT]), reportWith([BATTERY_RECEIPT]));
        });

        test('the emission writes acceptance-report.json under the root as canonical JSON plus a trailing newline', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-acceptance-emit-'));
                const report = reportWith([BATTERY_RECEIPT]);
                const emission = await emitAcceptanceReport(root, report);
                assert.equal(emission.ok, true);
                assert.ok(emission.path.endsWith(ACCEPTANCE_REPORT_NAME));
                const written = await readFile(join(root, ACCEPTANCE_REPORT_NAME), 'utf8');
                assert.equal(written, canonicalJson(report) + '\n');
                assert.equal(emission.digest, sha256Hex(canonicalJson(report)));
                assert.equal(emission.bytes, canonicalJson(report).length + 1);
        });

        test('root-independence: the same report emitted to two roots is byte-identical and carries no root path', async function () {
                this.timeout(30000);
                const rootA = await mkdtemp(join(tmpdir(), 'flauz-acceptance-roota-'));
                const rootB = await mkdtemp(join(tmpdir(), 'flauz-acceptance-rootb-'));
                const report = reportWith([BATTERY_RECEIPT]);
                await emitAcceptanceReport(rootA, report);
                await emitAcceptanceReport(rootB, report);
                const bytesA = await readFile(join(rootA, ACCEPTANCE_REPORT_NAME), 'utf8');
                const bytesB = await readFile(join(rootB, ACCEPTANCE_REPORT_NAME), 'utf8');
                assert.equal(bytesA, bytesB);
                assert.ok(!bytesA.includes(rootA));
                assert.ok(!bytesA.includes(rootB));
        });

        test('runAcceptance over the live authorities equals the manual build and writes only under the given root', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-acceptance-run-'));
                const parent = dirname(root);
                const before = new Set((await readdir(parent)).sort());
                const outcome = await runAcceptance({ root, gateReceipts: [BATTERY_RECEIPT] });
                assert.deepEqual(outcome.report, reportWith([BATTERY_RECEIPT]));
                assert.ok(outcome.emission.path.startsWith(root));
                const after = new Set((await readdir(parent)).sort());
                assert.deepEqual([...after].filter((name) => !before.has(name)), []);
        });

        test('version pins: the report carries its own version plus the authorities\' versions', () => {
                const report = reportWith();
                assert.equal(report.version, ACCEPTANCE_REPORT_VERSION);
                assert.equal(ACCEPTANCE_REPORT_VERSION, '1.0.0');
                assert.equal(report.generatedFrom.activationContractsVersion, ACTIVATION_CONTRACTS_VERSION);
                assert.equal(report.generatedFrom.batteryVersion, BATTERY_VERSION);
        });

        test('the frozen instrument-law disclosures ride every report', () => {
                const report = reportWith();
                assert.ok(report.disclosures.includes(EXERCISE_NEVER_PROMOTES));
                assert.equal(report.disclosures.length, 4);
                for (const disclosure of report.disclosures) {
                        assert.ok(typeof disclosure === 'string' && disclosure.length > 0);
                }
        });

        test('determinism over a mutated tree: two builds over a doctored clone are deep-equal and differ from the live report exactly where doctored', () => {
                const doctored = cloneWiring();
                const target = doctored.find((entry) => entry.capabilityId === 'ZC-010')!;
                target.state = 'wired';
                target.gapOwner = undefined;
                target.gapNote = undefined;
                const first = buildAcceptanceReport({ wiringEntries: doctored, journeys: JOURNEYS, gateReceipts: [BATTERY_RECEIPT] });
                const second = buildAcceptanceReport({ wiringEntries: doctored, journeys: JOURNEYS, gateReceipts: [BATTERY_RECEIPT] });
                assert.deepEqual(first, second);
                assert.equal(first.summary.closed, 6);
                assert.equal(first.summary.exercisedStillGap, 3);
                assert.equal(first.summary.unexercisedStillGap, 1);
                assert.equal(entryOf(first, 'ZC-010').closureVerdict, 'closed');
                assert.equal(entryOf(first, 'ZC-010').gapOwner, null);
                /* the doctored builds leak nothing into the live map */
                assert.equal(reportWith().summary.closed, 5);
        });
});

suite('flauz acceptance: the readme row pin', () => {
        test('the battery README carries the landed CR-012 sibling row AND the new CR-013 acceptance row, unmutated in form', async () => {
                const readme = await readFile(join(REPO_ROOT, BATTERY_README_PATH), 'utf8');
                assert.ok(readme.includes('Sibling index: `../simulation/`'), 'the landed CR-012 row must remain');
                assert.ok(readme.includes('Sibling index: `../acceptance/`'), 'the CR-013 row must be present');
                assert.ok(readme.includes('CR-013'));
                assert.ok(readme.includes('acceptanceRunner.ts'));
        });
});
