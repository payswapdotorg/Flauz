/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The register semantics (A-PROD-005-W4): the uniqueness law (a lane id is
 * unique -- re-registering refreshes its policy, never duplicates), the
 * policy-refresh survival (the ring + escalation state survive a refresh),
 * the typed refusals (bad args refuse the whole operation; a torn registry
 * refuses rather than erasing the torn evidence), the persistence + banking
 * discipline (lanes.json swept + the census-visible ledger row taskId
 * 'flauz-durability'), determinism (byte-identical registry for identical
 * inputs through the injected clock).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DurabilityError } from '../src/api.ts';
import { registerLane, parseRegisterArgs, LANES_RECORD_PATH } from '../src/lanes.ts';
import { nodeDurabilityFs, steppingClock, tempRoot } from './helpers.ts';

const GOOD_LANE = { laneId: 'lane-alpha', owner: 'flauz-workspace', heartbeatIntervalMs: 1000, stalenessThresholdMs: 5000, escalationPolicy: 'notify' as const };

suite('flauz.durability.register — the uniqueness + refresh law', () => {
        test('a first registration creates the lane + persists the registry + banks the census-visible row', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-reg-');
                try {
                        const clock = steppingClock();
                        const result = await registerLane({ root, fs: nodeDurabilityFs(), clock }, GOOD_LANE);
                        assert.equal(result.ok, true);
                        assert.equal(result.refreshed, false);
                        assert.equal(result.laneCount, 1);
                        const text = await fs.readFile(path.join(root, LANES_RECORD_PATH), 'utf-8');
                        const parsed = JSON.parse(text) as { $schema: string; lanes: unknown[] };
                        assert.equal(parsed.$schema, 'flauz.durability-lanes/v1');
                        assert.equal(parsed.lanes.length, 1);
                        // the census-visible banking: the ledger row names THIS extension (the taskId law)
                        const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const row = JSON.parse(ledger.trim()) as { taskId: string; kind: string; uri: string };
                        assert.equal(row.taskId, 'flauz-durability');
                        assert.equal(row.kind, 'note');
                        assert.equal(row.uri, LANES_RECORD_PATH);
                } finally {
                        await cleanup();
                }
        });

        test('re-registering an id REFRESHES its policy, never duplicates (the ring + escalation state survive)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-reg-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, GOOD_LANE);
                        // a beat + an escalation demand happen between the registrations
                        const { recordHeartbeat } = await import('../src/heartbeat.ts');
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const refreshed = await registerLane({ root, fs: fsPort, clock }, { ...GOOD_LANE, heartbeatIntervalMs: 2000, stalenessThresholdMs: 9000, escalationPolicy: 'checkpoint-and-restart' });
                        assert.equal(refreshed.refreshed, true);
                        assert.equal(refreshed.laneCount, 1, 'a lane id is unique -- never a duplicate');
                        const lane = refreshed.record.lanes[0];
                        assert.equal(lane?.heartbeatIntervalMs, 2000, 'the policy refreshed');
                        assert.equal(lane?.stalenessThresholdMs, 9000);
                        assert.equal(lane?.escalationPolicy, 'checkpoint-and-restart');
                        assert.equal(lane?.beats.length, 1, 'the ring survived the refresh');
                        assert.equal(lane?.totalBeats, 1);
                        assert.ok(lane?.registeredAt < lane?.updatedAt, 'registeredAt survives, updatedAt refreshes');
                } finally {
                        await cleanup();
                }
        });

        test('two DISTINCT lane ids coexist, sorted by id in the registry', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-reg-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, GOOD_LANE);
                        await registerLane({ root, fs: fsPort, clock }, { ...GOOD_LANE, laneId: 'lane-beta', owner: 'flauz-lab' });
                        const text = await fs.readFile(path.join(root, LANES_RECORD_PATH), 'utf-8');
                        const parsed = JSON.parse(text) as { lanes: { laneId: string }[] };
                        assert.deepEqual(parsed.lanes.map(lane => lane.laneId), ['lane-alpha', 'lane-beta']);
                } finally {
                        await cleanup();
                }
        });

        test('determinism: identical inputs through the injected clock produce byte-identical registries', async () => {
                const runs: string[] = [];
                for (let index = 0; index < 2; index++) {
                        const { root, cleanup } = await tempRoot('flauz-dur-det-');
                        try {
                                await registerLane({ root, fs: nodeDurabilityFs(), clock: steppingClock() }, GOOD_LANE);
                                runs.push(await fs.readFile(path.join(root, LANES_RECORD_PATH), 'utf-8'));
                        } finally {
                                await cleanup();
                        }
                }
                assert.equal(runs[0], runs[1]);
        });
});

suite('flauz.durability.register — the typed refusals', () => {
        test('bad args refuse the whole operation (the registry is never partially written)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-ref-');
                try {
                        for (const bad of [undefined, null, 'lane', 42, {}, { ...GOOD_LANE, laneId: '' }, { ...GOOD_LANE, owner: '' }, { ...GOOD_LANE, heartbeatIntervalMs: 0 }, { ...GOOD_LANE, stalenessThresholdMs: -1 }, { ...GOOD_LANE, escalationPolicy: 'explode' }]) {
                                assert.throws(
                                        () => parseRegisterArgs(bad),
                                        (err: unknown) => err instanceof DurabilityError && err.code === 'FLAUZ_DURABILITY_BAD_ARGS',
                                        `the bad arg ${JSON.stringify(bad) ?? String(bad)} refuses typed`,
                                );
                        }
                        // the command path parses BEFORE any registry write; a refused parse never reaches the writer
                        assert.equal(await fs.readFile(path.join(root, LANES_RECORD_PATH), 'utf-8').then(() => 'exists', () => 'absent'), 'absent', 'a refused registration writes nothing');
                } finally {
                        await cleanup();
                }
        });

        test('a TORN registry refuses a refresh rather than silently erasing the torn evidence', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-torn-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'durability'), { recursive: true });
                        await fs.writeFile(path.join(root, LANES_RECORD_PATH), '{not json', 'utf-8');
                        await assert.rejects(
                                registerLane({ root, fs: nodeDurabilityFs(), clock: steppingClock() }, GOOD_LANE),
                                (err: unknown) => err instanceof DurabilityError && err.code === 'FLAUZ_DURABILITY_FORMAT',
                        );
                } finally {
                        await cleanup();
                }
        });
});
