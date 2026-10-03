/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy suite (A-PROD-005-W4): the canary sweep -- NO secret-shaped
 * values in any durability record (the lane registry, the heartbeat
 * records, the status records, the banked evidence rows). The sweep is the
 * pre-write backstop (fail-closed: the whole operation refuses); the suite
 * additionally sweeps the WRITTEN bytes of every record kind produced by
 * the real flows (defense in depth).
 *
 * Secret-shaped fixtures are assembled from FRAGMENTS at runtime (the
 * flauz-resources discipline; no complete secret shape is ever spelled out
 * in this source file).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { DurabilityError } from '../src/api.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { registerLane, LANES_RECORD_PATH } from '../src/lanes.ts';
import { recordHeartbeat } from '../src/heartbeat.ts';
import { runStatus } from '../src/status.ts';
import { nodeDurabilityFs, steppingClock, tempRoot } from './helpers.ts';

const LANE = { laneId: 'lane-alpha', owner: 'flauz-workspace', heartbeatIntervalMs: 1000, stalenessThresholdMs: 5000, escalationPolicy: 'notify' as const };

/** Assembles a gh-shaped token from fragments (never a complete literal in source). */
function ghFragment(): string {
        return ['ghp_', 'Q3fKx9Zt2Lm8Vb5Nr7Wq4Xs'].join('');
}

suite('flauz.durability.privacy — the canary sweep (the metadata law)', () => {
        test('every known secret shape is recognized (the pattern battery)', () => {
                assert.ok(looksSecretShaped(ghFragment()));
                assert.ok(looksSecretShaped(['github_pat_', '11ABCDEFGH_abcdefghijk'].join('')));
                assert.ok(looksSecretShaped(['sk-', 'ant-1234567890abcdefg'].join('')));
                assert.ok(looksSecretShaped(['AKIA', 'ABCDEFGHIJKLMNOP'].join('')));
                assert.ok(looksSecretShaped(['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('')));
                assert.ok(looksSecretShaped(['Bearer ', 'abcdef1234567890abcd'].join('')));
                assert.ok(looksSecretShaped(['eyJ', 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c'].join('')));
                // ordinary lane-shaped strings are NOT secret-shaped
                assert.equal(looksSecretShaped('lane-alpha'), false);
                assert.equal(looksSecretShaped('flauz-workspace'), false);
                assert.equal(looksSecretShaped('supervised-green'), false);
        });

        test('a secret-shaped LANE ID refuses the whole registration (fail-closed, never a partial write)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-sec-');
                try {
                        // the sweep runs pre-write inside the banking composite; drive it through the register path
                        const secretLane = { ...LANE, laneId: ghFragment() };
                        const record = { $schema: 'flauz.durability-lanes/v1', lanes: [secretLane] };
                        assert.throws(
                                () => sweepArtifact(record, 'durability-record'),
                                (err: unknown) => err instanceof DurabilityError && err.code === 'FLAUZ_DURABILITY_SECRET_SHAPED',
                        );
                        assert.equal(await fs.readFile(path.join(root, LANES_RECORD_PATH), 'utf-8').then(() => 'exists', () => 'absent'), 'absent');
                } finally {
                        await cleanup();
                }
        });

        test('a secret-shaped OWNER refuses the sweep; deep structures are walked', () => {
                const record = {
                        $schema: 'flauz.durability-status/v1',
                        lanes: [{
                                laneId: 'lane-ok',
                                checkpointLaw: {
                                        stateSurfaces: [{
                                                id: 'tasks',
                                                note: ['nested ', ghFragment()].join(''),
                                        }],
                                },
                        }],
                };
                assert.throws(() => sweepArtifact(record, 'durability-record'), (err: unknown) => err instanceof DurabilityError);
        });

        test('the WRITTEN bytes of every record kind carry no secret-shaped values (the real flows, swept post-write)', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-flow-');
                try {
                        const fsPort = nodeDurabilityFs();
                        const clock = steppingClock();
                        await registerLane({ root, fs: fsPort, clock }, LANE);
                        await recordHeartbeat({ root, fs: fsPort, clock }, 'lane-alpha');
                        await runStatus({ root, fs: fsPort, clock });
                        const files = await fs.readdir(path.join(root, '.flauz', 'durability'));
                        assert.ok(files.length >= 3, 'the lanes registry + a heartbeat record + a status record');
                        for (const name of files) {
                                const text = await fs.readFile(path.join(root, '.flauz', 'durability', name), 'utf-8');
                                assert.equal(looksSecretShaped(text), false, `${name} carries no secret-shaped value`);
                        }
                        const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.equal(looksSecretShaped(ledger), false, 'the banked evidence rows carry no secret-shaped value');
                } finally {
                        await cleanup();
                }
        });
});
