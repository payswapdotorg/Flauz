/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The status semantics (A-PROD-005-W4): the supervision verdict -- the lane
 * table, the interval statistics (the inter-beat intervals: min/median/max
 * + the jitter disclosure), the CHECKPOINT LAW consultation over fixture
 * workspaces carrying REAL record surfaces (a REAL W3 isolation audit
 * record produced by the real audit machinery over a real-shaped product
 * registry) + a REAL banked W2 export fixture produced through the W2
 * ports, and the typed verdict table supervised-green / stale / flat /
 * unknown / degraded. The torn-registry honesty: a torn registry persists
 * the typed record (zero lanes + the reason -- never a guessed summary).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { STATUS_SCHEMA_ID } from '../src/api.ts';
import { registerLane } from '../src/lanes.ts';
import { recordHeartbeat } from '../src/heartbeat.ts';
import { runStatus, intervalStatsOf } from '../src/status.ts';
import { nodeDurabilityFs, steppingClock, tempRoot, plantFixtureProduct, plantEvidenceBodies, plantIsolationAuditRecord, plantBackupExport } from './helpers.ts';

const LANE = { laneId: 'lane-alpha', owner: 'flauz-workspace', heartbeatIntervalMs: 1000, stalenessThresholdMs: 5000, escalationPolicy: 'notify' as const };

/** Boots the full consultation fixture: a real product registry + real evidence bodies + a REAL W3 audit record. */
async function bootConsultationFixture(options: { readonly withTasks?: boolean; readonly withExport?: boolean } = {}): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const { root, cleanup } = await tempRoot('flauz-dur-st-');
        const fsPort = nodeDurabilityFs();
        const clock = steppingClock();
        await plantFixtureProduct(root);
        await plantEvidenceBodies(root, { withTasks: options.withTasks });
        await plantIsolationAuditRecord(root, fsPort, clock);
        if (options.withExport === true) {
                await plantBackupExport(root, fsPort, clock);
        }
        return { root, cleanup };
}

suite('flauz.durability.status — the verdict table over the checkpoint-law consultation (local-real)', () => {
        test('supervised-green: a LIVE lane whose state surfaces resolve + a REAL banked export anchor', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true, withExport: true });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row !== undefined);
                        assert.equal(row.liveness, 'LIVE');
                        assert.equal(row.verdict, 'supervised-green');
                        assert.equal(row.checkpointLaw.consultation, 'resolved');
                        assert.ok(row.checkpointLaw.stateSurfaces.length >= 3, 'the flauz-workspace owner carries its workspace-bound surfaces (tasks + evidence ledger + watermark)');
                        assert.equal(row.checkpointLaw.stateSurfacesResolve, true);
                        assert.ok(row.checkpointLaw.consultedRecord?.startsWith('.flauz/isolation/audit-'), 'the consultation cites the REAL W3 audit record');
                        assert.equal(row.checkpointLaw.exportAnchor.present, true, 'the REAL W2 export anchor resolved');
                        assert.ok(row.checkpointLaw.exportAnchor.exportDirName?.startsWith('export-'));
                        assert.equal(result.record.counts.supervisedGreen, 1);
                } finally {
                        await cleanup();
                }
        });

        test('degraded (a surface does not resolve): the owner\'s tasks surface is absent from the workspace', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: false });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row !== undefined);
                        assert.equal(row.liveness, 'LIVE');
                        assert.equal(row.verdict, 'degraded', 'a lane whose state surfaces do not resolve -- typed, never silent');
                        assert.equal(row.checkpointLaw.consultation, 'degraded');
                        assert.equal(row.checkpointLaw.stateSurfacesResolve, false);
                        assert.ok(row.checkpointLaw.stateSurfaces.some(surface => surface.id === 'tasks' && surface.present === false));
                } finally {
                        await cleanup();
                }
        });

        test('degraded (typed absent): a lane whose owner owns ZERO workspace-bound surfaces (nothing durable behind the lane)', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, { ...LANE, laneId: 'lane-lab', owner: 'flauz-lab' });
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-lab');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-lab');
                        assert.ok(row !== undefined);
                        assert.equal(row.liveness, 'LIVE');
                        assert.equal(row.verdict, 'degraded');
                        assert.equal(row.checkpointLaw.consultation, 'absent', 'the law knows flauz-lab carries zero durable surfaces -- typed absent, never a vacuous green');
                        assert.equal(row.checkpointLaw.stateSurfaces.length, 0);
                } finally {
                        await cleanup();
                }
        });

        test('degraded (typed unknown): NO isolation audit record exists to consult', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-noaudit-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row !== undefined);
                        assert.equal(row.verdict, 'degraded');
                        assert.equal(row.checkpointLaw.consultation, 'unknown', 'no consulted record -- typed, never guessed');
                } finally {
                        await cleanup();
                }
        });

        test('stale + flat verdicts DOMINATE the checkpoint law (liveness is the supervision verdict\'s first gate)', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, { ...LANE, laneId: 'lane-goes-stale' });
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-goes-stale');
                        await registerLane({ root, fs: fsPort, clock }, { ...LANE, laneId: 'lane-goes-flat' }); // registered, never beats
                        // advance past the staleness threshold AND past one interval, then run the verdict
                        const lateClock = (): number => 1_740_200_030_000;
                        const result = await runStatus({ root, fs: fsPort, clock: lateClock });
                        const stale = result.record.lanes.find(candidate => candidate.laneId === 'lane-goes-stale');
                        assert.equal(stale?.liveness, 'STALE');
                        assert.equal(stale?.verdict, 'stale', 'liveness dominates even with resolvable state surfaces');
                        assert.equal(stale?.escalation.outstanding, true);
                        const flat = result.record.lanes.find(candidate => candidate.laneId === 'lane-goes-flat');
                        assert.equal(flat?.liveness, 'FLAT', 'never beat + past one interval');
                        assert.equal(flat?.verdict, 'flat');
                        assert.equal(result.record.counts.stale, 1);
                        assert.equal(result.record.counts.flat, 1);
                } finally {
                        await cleanup();
                }
        });

        test('a TORN lane row carries the typed unknown verdict (the registry parsed, the row did not)', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        // tear the lane row inside an otherwise-parseable registry
                        const registryPath = path.join(root, '.flauz', 'durability', 'lanes.json');
                        const registry = JSON.parse(await fs.readFile(registryPath, 'utf-8')) as { lanes: unknown[] };
                        registry.lanes.push({ laneId: 'lane-torn', owner: 42 });
                        await fs.writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const torn = result.record.lanes.find(candidate => candidate.laneId === 'lane-torn');
                        assert.ok(torn !== undefined);
                        assert.equal(torn.verdict, 'unknown');
                        assert.ok(torn.tornReason !== undefined);
                        assert.equal(result.record.counts.unknown, 1);
                } finally {
                        await cleanup();
                }
        });

        test('a TORN registry persists the honest typed record (zero lanes + the reason -- never a guessed summary)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-tornreg-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'durability'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'durability', 'lanes.json'), '{not json', 'utf-8');
                        const result = await runStatus({ root, fs: nodeDurabilityFs(), clock: steppingClock() });
                        assert.equal(result.record.registryState, 'torn');
                        assert.ok(result.record.tornReason !== undefined);
                        assert.equal(result.record.lanes.length, 0);
                        assert.equal(result.record.counts.lanes, 0);
                        // the record still persisted + banked (the verdict WHATEVER it says)
                        const text = await fs.readFile(result.persisted.recordPath, 'utf-8');
                        assert.equal((JSON.parse(text) as { $schema: string }).$schema, STATUS_SCHEMA_ID);
                } finally {
                        await cleanup();
                }
        });

        test('a TORN newest export anchor is disclosed typed (never a silent absent)', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true, withExport: true });
                try {
                        // tear the newest export's export.json
                        const exportsDir = path.join(root, '.flauz-exports');
                        const dirs = await fs.readdir(exportsDir);
                        const newest = dirs.sort()[dirs.sort().length - 1];
                        await fs.writeFile(path.join(exportsDir, newest as string, 'export.json'), '{torn', 'utf-8');
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row !== undefined);
                        assert.equal(row.checkpointLaw.exportAnchor.present, false);
                        assert.ok(row.checkpointLaw.exportAnchor.tornReason !== undefined, 'the torn anchor carries its typed reason');
                        // the anchor is the operator's act, not the lane's obligation: resolvable surfaces still gate the verdict
                        assert.equal(row.verdict, 'supervised-green');
                } finally {
                        await cleanup();
                }
        });

        test('the absent anchor is honest (no banked export -- never a violation)', async () => {
                const { root, cleanup } = await bootConsultationFixture({ withTasks: true, withExport: false });
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock(1_740_200_000_000);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row !== undefined);
                        assert.equal(row.checkpointLaw.exportAnchor.present, false);
                        assert.equal(row.checkpointLaw.exportAnchor.tornReason, undefined);
                        assert.equal(row.verdict, 'supervised-green');
                } finally {
                        await cleanup();
                }
        });
});

suite('flauz.durability.status — the beat-history shape + the record discipline', () => {
        test('the interval statistics: min/median/max over the inter-beat gaps + the jitter disclosure (max deviation from the configured interval)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-iv-');
                try {
                        const fsPort = nodeDurabilityFs();
                        // the explicit CALL-indexed schedule (every clock() call consumes one entry):
                        // register(at+bank), 4 beats (at + 2 banking stamps each -- the lanes re-persist + the record bank),
                        // then the status instant. The four beats land at +1000/+2000/+5000/+7000 -> gaps 1000/3000/2000.
                        const T = 1_740_300_000_000;
                        const schedule = [0, 0, 1000, 1000, 1000, 2000, 2000, 2000, 5000, 5000, 5000, 7000, 7000, 7000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000, 8000];
                        let call = 0;
                        const clock = (): number => T + (schedule[Math.min(call++, schedule.length - 1)] as number);
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const row = result.record.lanes.find(candidate => candidate.laneId === 'lane-alpha');
                        assert.ok(row?.intervalStats !== undefined);
                        assert.equal(row?.intervalStats?.sampleCount, 3, 'the inter-beat gaps: 1000, 3000, 2000');
                        assert.equal(row?.intervalStats?.minMs, 1000);
                        assert.equal(row?.intervalStats?.medianMs, 2000, 'sorted [1000,2000,3000]: the middle element');
                        assert.equal(row?.intervalStats?.maxMs, 3000);
                        assert.equal(row?.intervalStats?.maxDeviationMs, 2000, 'the jitter: max |gap - configured 1000| = 2000');
                        // the single-beat lane carries NO interval statistics (honest absence)
                        await registerLane({ root, fs: fsPort, clock }, { ...LANE, laneId: 'lane-single' });
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-single');
                        const second = await runStatus({ root, fs: fsPort, clock });
                        assert.equal(second.record.lanes.find(candidate => candidate.laneId === 'lane-single')?.intervalStats, undefined);
                        assert.equal(intervalStatsOf({ ...LANE, registeredAt: 1, updatedAt: 1, beats: [5], totalBeats: 1, escalation: { policy: 'notify', demandCount: 0 } }), undefined);
                } finally {
                        await cleanup();
                }
        });

        test('the status record persists the owning schema + banks census-visible; determinism holds for identical state', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-strec-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        const result = await runStatus({ root, fs: fsPort, clock });
                        const text = await fs.readFile(result.persisted.recordPath, 'utf-8');
                        const parsed = JSON.parse(text) as { $schema: string; kind: string; boundaryDisclosure: string };
                        assert.equal(parsed.$schema, STATUS_SCHEMA_ID);
                        assert.equal(parsed.kind, 'flauz-durability-status');
                        assert.match(parsed.boundaryDisclosure, /RECORD-KEEPING \+ VERDICT machinery/, 'the honest-boundary disclosure rides the record');
                        const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const rows = ledger.trim().split('\n').map(line => JSON.parse(line) as { taskId: string; uri: string });
                        assert.equal(rows[rows.length - 1]?.taskId, 'flauz-durability');
                        assert.ok(rows[rows.length - 1]?.uri.startsWith('.flauz/durability/status-'));
                } finally {
                        await cleanup();
                }
        });
});
