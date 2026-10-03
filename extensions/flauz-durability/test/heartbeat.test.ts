/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The heartbeat semantics (A-PROD-005-W4): the liveness classes with the
 * injected clock -- LIVE / STALE / FLAT / UNKNOWN -- the bounded ring (the
 * last 32 stamps), the escalation-demand records (a STALE/FLAT PRE-BEAT
 * observation triggers the lane's policy demand -- recorded, never
 * executed), the persistence + banking discipline, and the UNKNOWN typed
 * refusal (lane not registered: never a guessed verdict).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DurabilityError, BEAT_RING_CAP, HEARTBEAT_SCHEMA_ID } from '../src/api.ts';
import { registerLane } from '../src/lanes.ts';
import { recordHeartbeat, classifyLiveness, parseHeartbeatArgs, BOUNDARY_DISCLOSURE } from '../src/heartbeat.ts';
import { nodeDurabilityFs, steppingClock, tempRoot } from './helpers.ts';

const LANE = { laneId: 'lane-alpha', owner: 'flauz-workspace', heartbeatIntervalMs: 1000, stalenessThresholdMs: 5000, escalationPolicy: 'checkpoint-and-restart' as const };

suite('flauz.durability.heartbeat — the liveness classes (the injected clock)', () => {
        test('the FIRST beat inside the startup grace window observes LIVE (the disclosed complement)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-hb-');
                try {
                        const fsPort = nodeDurabilityFs();
                        // a constant clock: the register and the beat share the instant (gap 0 <= interval)
                        const T = 1_740_100_000_000;
                        const clock = (): number => T;
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        const result = await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        assert.equal(result.record.liveness, 'LIVE', 'a beatless lane still inside its first interval is LIVE -- the startup grace window, disclosed');
                        assert.equal(result.record.escalation, undefined, 'LIVE never triggers an escalation demand');
                        assert.equal(result.record.beatCount, 1);
                        assert.deepEqual(result.record.ring, [T]);
                } finally {
                        await cleanup();
                }
        });

        test('a fresh follow-up beat observes LIVE; a beat past the staleness threshold observes STALE + RECORDS the escalation demand', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-hb-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const T = 1_740_100_000_000;
                        const clock = (): number => T;
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha'); // gap 0: LIVE
                        const fresh = await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha'); // gap 0 <= 5000: LIVE
                        assert.equal(fresh.record.liveness, 'LIVE');

                        // advance the clock PAST the staleness threshold (the injected clock is the only time source)
                        const lateClock = (): number => T + 8000;
                        const stale = await recordHeartbeat({ root, fs: fsPort, clock: lateClock }, 'lane-alpha');
                        assert.equal(stale.record.liveness, 'STALE', 'the gap since the last beat (8000ms) is past the threshold (5000ms)');
                        assert.ok(stale.record.escalation !== undefined, 'the STALE observation triggers the escalation policy record');
                        assert.equal(stale.record.escalation?.policy, 'checkpoint-and-restart');
                        assert.equal(stale.record.escalation?.demandedAt, stale.record.beatAt);
                        assert.match(stale.record.escalation?.executionBoundary ?? '', /routes through the owning task's own machinery/, 'the execution boundary is disclosed in the demand record');
                        // the lane's escalation state updated in the registry
                        const lane = stale.lanes.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.equal(lane?.escalation.demandCount, 1);
                        assert.equal(lane?.escalation.lastDemandAt, stale.record.beatAt);
                } finally {
                        await cleanup();
                }
        });

        test('the FIRST beat arriving past one interval observes FLAT + RECORDS the escalation demand', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-hb-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const T = 1_740_100_000_000;
                        const clock = (): number => T;
                        await registerLane({ root, fs: fsPort, clock }, LANE); // registered at T
                        // advance past one interval since registration (1000ms) with NO beat ever
                        const lateClock = (): number => T + 2000;
                        const flat = await recordHeartbeat({ root, fs: fsPort, clock: lateClock }, 'lane-alpha');
                        assert.equal(flat.record.liveness, 'FLAT', 'no beat ever + past one interval since registration');
                        assert.ok(flat.record.escalation !== undefined, 'the FLAT observation triggers the escalation policy record');
                        assert.equal(flat.record.escalation?.policy, 'checkpoint-and-restart');
                } finally {
                        await cleanup();
                }
        });

        test('UNKNOWN: a heartbeat for an UNREGISTERED lane is a typed refusal -- no record, never a guessed verdict', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-unk-');
                try {
                        await assert.rejects(
                                recordHeartbeat({ root, fs: nodeDurabilityFs(), clock: steppingClock() }, 'lane-ghost'),
                                (err: unknown) => err instanceof DurabilityError && err.code === 'FLAUZ_DURABILITY_UNKNOWN_LANE',
                        );
                        const entries = await fs.readdir(path.join(root, '.flauz', 'durability')).then(list => list, () => [] as string[]);
                        assert.equal(entries.length, 0, 'the refusal wrote nothing');
                } finally {
                        await cleanup();
                }
        });

        test('the classifyLiveness law: FLAT/STALE/LIVE boundaries hold exactly at the thresholds', () => {
                const lane = { ...LANE, registeredAt: 1000, updatedAt: 1000, beats: [3000], totalBeats: 1, escalation: { policy: 'notify' as const, demandCount: 0 } };
                assert.equal(classifyLiveness(lane, 7000), 'LIVE', 'gap 4000 <= 5000 threshold -> LIVE');
                assert.equal(classifyLiveness(lane, 8000), 'LIVE', 'gap 5000 is NOT past the threshold (strictly greater)');
                assert.equal(classifyLiveness(lane, 8001), 'STALE', 'gap 5001 is past the threshold');
                const beatless = { ...LANE, registeredAt: 1000, updatedAt: 1000, beats: [], totalBeats: 0, escalation: { policy: 'notify' as const, demandCount: 0 } };
                assert.equal(classifyLiveness(beatless, 2000), 'LIVE', 'inside the first interval: the startup grace window');
                assert.equal(classifyLiveness(beatless, 2001), 'FLAT', 'past one interval with no beat ever');
        });
});

suite('flauz.durability.heartbeat — the bounded ring + the records', () => {
        test('the ring holds the last N stamps only (BEAT_RING_CAP); the total count keeps counting', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-ring-');
                try {
                        const fsPort = nodeDurabilityFs();
                        // a linear call-counter clock: every clock() call (record stamps AND banking stamps) advances 100ms,
                        // so beat i lands at T + (2 + 3*i)*100 (register consumes 2 calls; each beat 3)
                        const T = 1_740_100_000_000;
                        let calls = 0;
                        const clock = (): number => T + calls++ * 100;
                        await registerLane({ root, fs: fsPort, clock }, { ...LANE, heartbeatIntervalMs: 1000, stalenessThresholdMs: 100_000 });
                        let last;
                        for (let index = 0; index < BEAT_RING_CAP + 5; index++) {
                                last = await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        }
                        assert.equal(last?.record.ring.length, BEAT_RING_CAP, 'the ring is bounded at the cap');
                        assert.equal(last?.record.beatCount, BEAT_RING_CAP + 5, 'the total beats keep counting past the cap');
                        // beat 5 (0-based) is the oldest kept: T + (2 + 3*5)*100
                        assert.equal(last?.record.ring[0], T + 1700, 'the oldest 5 stamps fell off the ring');
                } finally {
                        await cleanup();
                }
        });

        test('every heartbeat record persists the owning schema + the boundary disclosure + banks census-visible', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-rec-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        const result = await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const text = await fs.readFile(result.persisted.recordPath, 'utf-8');
                        const parsed = JSON.parse(text) as { $schema: string; kind: string; boundaryDisclosure: string; laneId: string };
                        assert.equal(parsed.$schema, HEARTBEAT_SCHEMA_ID);
                        assert.equal(parsed.kind, 'flauz-durability-heartbeat');
                        assert.equal(parsed.boundaryDisclosure, BOUNDARY_DISCLOSURE, 'the honest-boundary disclosure rides every record');
                        assert.equal(parsed.laneId, 'lane-alpha');
                        // banked census-visible: the newest ledger row's uri names THIS record
                        const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const rows = ledger.trim().split('\n').map(line => JSON.parse(line) as { taskId: string; uri: string });
                        assert.equal(rows[rows.length - 1]?.taskId, 'flauz-durability');
                        assert.ok(rows[rows.length - 1]?.uri.startsWith('.flauz/durability/heartbeat-'));
                } finally {
                        await cleanup();
                }
        });

        test('the heartbeat argument parses typed (the bad shapes refuse)', () => {
                for (const bad of [undefined, null, 'lane', 42, {}, { laneId: '' }]) {
                        assert.throws(() => parseHeartbeatArgs(bad), (err: unknown) => err instanceof DurabilityError && err.code === 'FLAUZ_DURABILITY_BAD_ARGS');
                }
                assert.equal(parseHeartbeatArgs({ laneId: 'lane-alpha' }), 'lane-alpha');
        });
});
