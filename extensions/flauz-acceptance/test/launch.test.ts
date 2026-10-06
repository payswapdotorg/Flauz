/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The launch-act suite (A-PROD-006-W2, DL-87 law 2): the fail-closed
 * refusal lattice (absent/torn/red/stale/not-found), the GO mint, the
 * unique-id/revision-append law, the incident binding (resolved +
 * disclosed-unresolvable), the named owning checks set, and the determinism
 * law. Evidence level: local-real over seeded workspace records (the
 * checklist artifacts are planted through the contract-duplicated shape --
 * fixture-labeled; one refusal path exercises the REAL flauz-release
 * machinery's NO-GO artifact -- local-real).
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { AcceptanceError, readAcceptanceLedger } from '../src/api.ts';
import { launchAcceptance, parseLaunchArgs, enumerateChecklistArtifacts, readChecklistArtifact, type LaunchArgs } from '../src/launch.ts';
import { nodeAcceptanceFs, steppingClock, tempRoot, plantEvidenceBodies, plantChecklistArtifact, plantIncidentsLedger, plantTasksEnvelope, acceptanceIdOfSeed, SEEDED_INCIDENT_ID, CHECKLIST_ROW_IDS } from './helpers.ts';

async function launch(root: string, args: Partial<LaunchArgs> & { seed: string; actor: string }): Promise<ReturnType<typeof launchAcceptance>> {
        return await launchAcceptance({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, parseLaunchArgs(args));
}

async function refuseCode(root: string, args: Partial<LaunchArgs> & { seed: string; actor: string }): Promise<string> {
        try {
                await launch(root, args);
        } catch (err) {
                assert.ok(err instanceof AcceptanceError, `the refusal is typed (got ${String(err)})`);
                return err.code;
        }
        assert.fail('the launch must refuse');
        return '';
}

suite('launch -- the fail-closed refusal lattice (never a silent green)', () => {
        test('ABSENT: no checklist artifact at all = the typed no-checklist refusal', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lno-');
                try {
                        await plantEvidenceBodies(root);
                        assert.equal(await refuseCode(root, { seed: 's', actor: 'operator' }), 'FLAUZ_ACCEPTANCE_NO_CHECKLIST');
                } finally {
                        await cleanup();
                }
        });

        test('TORN: a garbage newest artifact = the typed torn refusal', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ltorn-');
                try {
                        await plantEvidenceBodies(root);
                        await fs.mkdir(path.join(root, '.flauz', 'release'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'checklist-2026-10-05T120000.000Z.json'), '{not json', 'utf-8');
                        assert.equal(await refuseCode(root, { seed: 's', actor: 'operator' }), 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN');
                } finally {
                        await cleanup();
                }
        });

        test('TORN: a well-formed artifact whose checklistId does not re-derive over its own bytes = the typed torn refusal (the gate identity law)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ltornid-');
                try {
                        await plantEvidenceBodies(root);
                        const relPath = await plantChecklistArtifact(root, 'GO');
                        const text = await fs.readFile(path.join(root, relPath), 'utf-8');
                        const tampered = JSON.parse(text) as { checklistId: string };
                        tampered.checklistId = '0'.repeat(64);
                        await fs.writeFile(path.join(root, relPath), `${JSON.stringify(tampered, null, 2)}\n`, 'utf-8');
                        assert.equal(await refuseCode(root, { seed: 's', actor: 'operator' }), 'FLAUZ_ACCEPTANCE_CHECKLIST_TORN');
                } finally {
                        await cleanup();
                }
        });

        test('RED: a NO-GO newest artifact = the typed red refusal naming the failing rows', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lred-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'NO-GO');
                        try {
                                await launch(root, { seed: 's', actor: 'operator' });
                                assert.fail('the launch must refuse a NO-GO');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_CHECKLIST_RED');
                                assert.ok(err.message.includes('NO-GO'));
                                assert.ok(err.message.includes('diagnostics'), 'the refusal names the failing rows');
                        }
                } finally {
                        await cleanup();
                }
        });

        test('RED (local-real): a REAL artifact cut by the REAL flauz.release.checklist machinery over an empty workspace = the typed red refusal', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lreal-');
                try {
                        await plantEvidenceBodies(root);
                        const { runChecklist } = await import('../../flauz-release/src/checklist.ts');
                        const result = await runChecklist({
                                root,
                                fs: nodeAcceptanceFs(),
                                clock: steppingClock(),
                                versions: { productVersion: '1.100.0-flauz', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-release', version: '0.1.0' }] },
                                productRoot: undefined,
                        });
                        assert.notEqual(result.verdict, 'GO');
                        assert.equal(await refuseCode(root, { seed: 's', actor: 'operator' }), 'FLAUZ_ACCEPTANCE_CHECKLIST_RED');
                } finally {
                        await cleanup();
                }
        });

        test('STALE: an explicitly named OLDER artifact = the typed stale refusal (the freshness law)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lstale-');
                try {
                        await plantEvidenceBodies(root);
                        const older = await plantChecklistArtifact(root, 'GO', '2026-10-05T100000.000Z');
                        await plantChecklistArtifact(root, 'GO', '2026-10-05T120000.000Z');
                        try {
                                await launch(root, { seed: 's', actor: 'operator', checklistPath: older });
                                assert.fail('the launch must refuse a stale binding');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_CHECKLIST_STALE');
                                assert.ok(err.message.includes('FRESH'), 'the refusal names the freshness law');
                        }
                } finally {
                        await cleanup();
                }
        });

        test('NOT FOUND: an explicitly named path outside the enumerated set = the typed not-found refusal', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lnf-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        assert.equal(await refuseCode(root, { seed: 's', actor: 'operator', checklistPath: '.flauz/release/checklist-1999-01-01T000000.000Z.json' }), 'FLAUZ_ACCEPTANCE_CHECKLIST_NOT_FOUND');
                } finally {
                        await cleanup();
                }
        });

        test('BAD ARGS: the typed argument surface (missing seed / actor / bad incident shape)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-largs-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        assert.equal(await refuseCode(root, { seed: '', actor: 'operator' }), 'FLAUZ_ACCEPTANCE_BAD_ARGS');
                        assert.equal(await refuseCode(root, { seed: 's', actor: '' }), 'FLAUZ_ACCEPTANCE_BAD_ARGS');
                        try {
                                parseLaunchArgs({ seed: 's', actor: 'o', incident: { incidentId: 'not-an-id', regressionTestId: 't' } });
                                assert.fail('the bad incident shape must refuse');
                        } catch (err) {
                                assert.ok(err instanceof AcceptanceError);
                                assert.equal(err.code, 'FLAUZ_ACCEPTANCE_BAD_ARGS');
                        }
                } finally {
                        await cleanup();
                }
        });
});

suite('launch -- the GO mint (the record the loop carries)', () => {
        test('the mint: the id from the seed, the checklist path VERBATIM, the pinned product state, the named owning checks', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lgo-');
                try {
                        await plantEvidenceBodies(root);
                        await plantTasksEnvelope(root);
                        const relPath = await plantChecklistArtifact(root, 'GO');
                        const result = await launch(root, { seed: 'the-beta-launch', actor: 'operator' });
                        assert.equal(result.acceptanceId, acceptanceIdOfSeed('the-beta-launch'));
                        assert.equal(result.revised, false);
                        assert.equal(result.revision, 1);
                        assert.equal(result.checklistPath, relPath, 'the bound checklist path VERBATIM');
                        assert.ok(/^[0-9a-f]{64}$/.test(result.checklistId), 'the checklistId (the release identity)');
                        // the ledger persisted + re-reads as the flauz.acceptance/v1 shape
                        const ledger = await readAcceptanceLedger(root, nodeAcceptanceFs());
                        if (ledger.state !== 'resolved') {
                                assert.fail('the ledger must resolve');
                        }
                        assert.equal(ledger.record.acceptances.length, 1);
                        const record = ledger.record.acceptances[0];
                        assert.equal(record?.acceptanceId, acceptanceIdOfSeed('the-beta-launch'));
                        const revision = record?.revisions[0];
                        assert.equal(revision?.actor, 'operator');
                        assert.equal(revision?.checklistPath, relPath);
                        assert.equal(revision?.checklistVerdict, 'GO');
                        assert.equal(revision?.productName, 'Flauz');
                        // the pinned product state: the ten census surfaces, the tasks surface present
                        assert.equal(revision?.pinnedState.versionInventory.length, 10);
                        const tasks = revision?.pinnedState.versionInventory.find(surface => surface.surface === 'tasks');
                        assert.equal(tasks?.present, true, 'the seeded tasks envelope is pinned present');
                        assert.equal(tasks?.files[0]?.detectedVersion, 'flauz.tasks/v0');
                        assert.equal(revision?.pinnedState.censusSnapshot.length, 10);
                        // the named owning checks: the ten checklist row kinds, self-evaluable ONLY for the artifact row
                        assert.equal(revision?.owningChecks.length, 10);
                        assert.deepEqual(revision?.owningChecks.map(check => check.checkId), [...CHECKLIST_ROW_IDS]);
                        for (const check of revision?.owningChecks ?? []) {
                                assert.equal(check.source, 'checklist-row');
                                assert.equal(check.owningSurface, `flauz.owner.${check.checkId}`);
                                assert.equal(check.selfEvaluable, check.checkId === 'checklistArtifact');
                        }
                        // the census-visible banking: the evidence ledger got the flauz-acceptance row + the watermark re-synced
                        const ledgerText = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        assert.ok(ledgerText.includes('"taskId":"flauz-acceptance"'), 'the banked row carries the synthetic taskId');
                        assert.ok(result.persisted.banking.watermarkUpdated, 'the watermark re-synced');
                } finally {
                        await cleanup();
                }
        });

        test('the unique-id law: re-launching an id appends a NEW revision, never duplicates', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lrev-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        const first = await launch(root, { seed: 'the-same-seed', actor: 'operator' });
                        assert.equal(first.revised, false);
                        const second = await launch(root, { seed: 'the-same-seed', actor: 'operator-2' });
                        assert.equal(second.revised, true, 'the re-launch appends a revision');
                        assert.equal(second.revision, 2);
                        assert.equal(second.acceptanceCount, 1, 'still exactly one record for the id');
                        const ledger = await readAcceptanceLedger(root, nodeAcceptanceFs());
                        if (ledger.state !== 'resolved') {
                                assert.fail('the ledger must resolve');
                        }
                        assert.equal(ledger.record.acceptances.length, 1);
                        assert.equal(ledger.record.acceptances[0]?.revisions.length, 2);
                        assert.equal(ledger.record.acceptances[0]?.revisions[1]?.actor, 'operator-2');
                } finally {
                        await cleanup();
                }
        });

        test('the incident binding: resolved against the seeded incidents ledger, the named regression test in the owning checks set', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-linc-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        await plantIncidentsLedger(root, SEEDED_INCIDENT_ID);
                        const result = await launch(root, {
                                seed: 'the-incident-launch',
                                actor: 'operator',
                                incident: { incidentId: SEEDED_INCIDENT_ID, regressionTestId: 'test/regression/acceptance.test.ts::the named regression test' },
                        });
                        assert.equal(result.incidentBindingState, 'resolved');
                        assert.equal(result.owningCheckCount, 11, 'the ten checklist rows + the named regression test');
                        const ledger = await readAcceptanceLedger(root, nodeAcceptanceFs());
                        if (ledger.state !== 'resolved') {
                                assert.fail('the ledger must resolve');
                        }
                        const binding = ledger.record.acceptances[0]?.revisions[0]?.incidentBinding;
                        assert.equal(binding?.incidentId, SEEDED_INCIDENT_ID);
                        assert.equal(binding?.resolved, true);
                        assert.equal(binding?.disclosed, 'resolved');
                        const regressionCheck = ledger.record.acceptances[0]?.revisions[0]?.owningChecks.find(check => check.source === 'regression-test');
                        assert.ok(regressionCheck !== undefined);
                        assert.equal(regressionCheck.owningSurface, 'the repo test lane (the named regression test)');
                        assert.equal(regressionCheck.selfEvaluable, false);
                } finally {
                        await cleanup();
                }
        });

        test('the incident binding: unresolvable = the TYPED DISCLOSURE (never a fabricated link, never a dropped binding)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lincu-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        // no incidents ledger planted -- the binding cannot resolve
                        const result = await launch(root, {
                                seed: 'the-unresolvable-launch',
                                actor: 'operator',
                                incident: { incidentId: SEEDED_INCIDENT_ID, regressionTestId: 'test/x' },
                        });
                        assert.equal(result.incidentBindingState, 'disclosed-unresolvable');
                        const ledger = await readAcceptanceLedger(root, nodeAcceptanceFs());
                        if (ledger.state !== 'resolved') {
                                assert.fail('the ledger must resolve');
                        }
                        const binding = ledger.record.acceptances[0]?.revisions[0]?.incidentBinding;
                        assert.equal(binding?.resolved, false);
                        assert.equal(binding?.disclosed, 'disclosed-unresolvable');
                } finally {
                        await cleanup();
                }
        });

        test('the determinism law: identical seeds produce identical acceptance ids (no host random anywhere)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ldet-');
                try {
                        await plantEvidenceBodies(root);
                        await plantChecklistArtifact(root, 'GO');
                        const a = await launch(root, { seed: 'deterministic-seed', actor: 'operator' });
                        const b = await launch(root, { seed: 'deterministic-seed', actor: 'operator' });
                        assert.equal(a.acceptanceId, b.acceptanceId);
                        assert.equal(a.acceptanceId, acceptanceIdOfSeed('deterministic-seed'));
                } finally {
                        await cleanup();
                }
        });
});

suite('launch -- the enumeration + the contract-pinned reader', () => {
        test('enumerateChecklistArtifacts: only checklist-<stamp>.json files, sorted, the newest last', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lenum-');
                try {
                        await fs.mkdir(path.join(root, '.flauz', 'release'), { recursive: true });
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'checklist-2026-10-05T120000.000Z.json'), '{}', 'utf-8');
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'checklist-2026-10-05T100000.000Z.json'), '{}', 'utf-8');
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'checklist-not-a-stamp.json'), '{}', 'utf-8');
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'verify-2026-10-05T120000.000Z.json'), '{}', 'utf-8');
                        await fs.writeFile(path.join(root, '.flauz', 'release', 'notes.txt'), 'x', 'utf-8');
                        const candidates = await enumerateChecklistArtifacts(root, nodeAcceptanceFs());
                        assert.equal(candidates.length, 2, 'only the two true checklist artifacts (the stamp shape enforced)');
                        assert.equal(candidates[0]?.stamp, '2026-10-05T100000.000Z');
                        assert.equal(candidates[1]?.stamp, '2026-10-05T120000.000Z', 'the newest last (lexicographic stamp order IS chronological order)');
                } finally {
                        await cleanup();
                }
        });

        test('readChecklistArtifact: absent vs resolved (typed at every degradation)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-lread-');
                try {
                        const relPath = await plantChecklistArtifact(root, 'GO');
                        const resolved = await readChecklistArtifact(root, nodeAcceptanceFs(), relPath);
                        assert.equal(resolved.state, 'resolved');
                        const absent = await readChecklistArtifact(root, nodeAcceptanceFs(), '.flauz/release/checklist-1999-01-01T000000.000Z.json');
                        assert.equal(absent.state, 'absent');
                } finally {
                        await cleanup();
                }
        });
});
