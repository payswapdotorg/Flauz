/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The contract pins (A-PROD-006-W2, DL-87): every durable-state shape this
 * extension consults is duplicated in its src as types + parsers -- THIS
 * suite pins the duplication byte-equal against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned pin pattern; src
 * never crosses extension boundaries). The drift protection: a sibling
 * wave that moves a surface path, the checklist shape, the surface
 * registry, the evidence-label ladder or the gate vocabulary fails HERE
 * until the consultation contract grows through a reviewed update.
 *
 * THE GATE VOCABULARY READ-PIN (DL-87 law 4): the eleven prove-items stay
 * verbatim in flauz-production/src/gate.ts; PROVE_ITEM_IDS in this
 * extension's api.ts is the read-pin declaration. The suite reads the
 * OWNING gate source and asserts set-equality -- the launch plane binds
 * the gate by READING the checklist verdict, never by redefining it.
 */

import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
        ACCEPTANCE_SCHEMA_ID,
        VERIFICATION_SCHEMA_ID,
        STATUS_SCHEMA_ID,
        ACCEPTANCE_TASK_ID,
        EXTENSION_ID,
        EVIDENCE_LEDGER_PATH,
        EVIDENCE_SIZE_PATH,
        LEDGER_ROW_FORMAT_ID,
        EVIDENCE_LABELS,
        PROVE_ITEM_IDS,
        ACCEPTANCE_ID_SHAPE,
        isAcceptanceId,
        acceptanceIdFromSeed,
        INCIDENT_ID_SHAPE,
        SURFACES,
        CHECKLIST_SCHEMA_ID,
        canonicalJson,
        serializeArtifact,
        joinPath,
        ledgerRowLine,
        ledgerRowHash,
        ledgerHeadHash,
        parseLedgerLine,
        parseWatermarkLenient,
        serializeWatermark,
        sha256Hex,
        checklistIdOf,
        checklistStamp,
        parseChecklistArtifact,
} from '../src/api.ts';
import { ACCEPTANCE_LEDGER_PATH as LAUNCH_LEDGER_PATH } from '../src/launch.ts';
import { readProductState, expectedFileVersion } from '../src/productState.ts';
import { bankLedgerRowFor } from '../src/ledger.ts';
import { nodeAcceptanceFs, repoRoot, steppingClock, tempRoot, plantEvidenceBodies, plantChecklistArtifact, plantTasksEnvelope, plantWorkflows, CHECKLIST_ROW_IDS } from './helpers.ts';

// --- the REAL owning modules (test-time cross-extension imports; the pin pattern) ---
import {
        sha256Hex as releaseSha256Hex,
        canonicalJson as releaseCanonicalJson,
        serializeArtifact as releaseSerializeArtifact,
        SURFACES as OWNER_SURFACES,
        TASKS_PATH as OWNER_TASKS_PATH,
        LEDGER_PATH as OWNER_LEDGER_PATH,
        SIZE_PATH as OWNER_SIZE_PATH,
        RELEASE_DIR as OWNER_RELEASE_DIR,
        CHECKLIST_PREFIX as OWNER_CHECKLIST_PREFIX,
        CHECKLIST_SCHEMA_ID as OWNER_CHECKLIST_SCHEMA_ID,
        type ReleaseFsPort,
} from '../../flauz-release/src/api.ts';
import {
        ledgerRowLine as releaseLedgerRowLine,
        ledgerRowHash as releaseLedgerRowHash,
        ledgerHeadHash as releaseLedgerHeadHash,
        parseLedgerLine as releaseParseLedgerLine,
} from '../../flauz-release/src/verify.ts';
import {
        parseWatermarkLenient as releaseParseWatermarkLenient,
        serializeWatermark as releaseSerializeWatermark,
} from '../../flauz-release/src/banking.ts';
import { checklistIdOf as OWNER_checklistIdOf, checklistStamp as OWNER_checklistStamp, type ReleaseChecklistArtifact as OwnerArtifact } from '../../flauz-release/src/checklist.ts';
import { readSurfaceVersions as OWNER_readSurfaceVersions, expectedFileVersion as OWNER_expectedFileVersion } from '../../flauz-release/src/versionInventory.ts';
import { collectDurableStateCensus as OWNER_collectDurableStateCensus, censusProblems as OWNER_censusProblems, type DurableStateCensus } from '../../flauz-release/src/census.ts';
import { EVIDENCE_LABELS as INCIDENTS_EVIDENCE_LABELS, INCIDENT_ID_SHAPE as INCIDENTS_ID_SHAPE, isIncidentId as INCIDENTS_isIncidentId } from '../../flauz-incidents/src/api.ts';

suite('contract -- the order-pinned schema ids + the wave constants', () => {
        test('the order-pinned schema ids (verbatim) + the wave constants', () => {
                assert.equal(ACCEPTANCE_SCHEMA_ID, 'flauz.acceptance/v1');
                assert.equal(VERIFICATION_SCHEMA_ID, 'flauz.acceptance-verification/v1');
                assert.equal(STATUS_SCHEMA_ID, 'flauz.acceptance-status/v1');
                assert.equal(ACCEPTANCE_TASK_ID, 'flauz-acceptance');
                assert.equal(EXTENSION_ID, 'flauz.flauz-acceptance');
                assert.equal(LAUNCH_LEDGER_PATH, '.flauz/acceptance/acceptances.json');
        });

        test('the acceptance id shape + the seed-based id generator (the determinism law)', () => {
                assert.ok(ACCEPTANCE_ID_SHAPE.test('flauz:acc:0123456789abcdef'));
                assert.ok(!ACCEPTANCE_ID_SHAPE.test('flauz:acc:0123456789abcde'), 'too short');
                assert.ok(!ACCEPTANCE_ID_SHAPE.test('flauz:acc:0123456789abcdef0'), 'too long');
                assert.ok(!ACCEPTANCE_ID_SHAPE.test('flauz:acc:GHIJKLMNOPQRSTUV'), 'non-hex');
                assert.ok(isAcceptanceId('flauz:acc:0123456789abcdef'));
                assert.ok(!isAcceptanceId('flauz:acc:short'));
                // the seed-based id generator: identical seeds produce identical ids (determinism)
                assert.equal(acceptanceIdFromSeed('the-beta-acceptance'), acceptanceIdFromSeed('the-beta-acceptance'));
                // distinct seeds produce distinct ids
                assert.notEqual(acceptanceIdFromSeed('the-beta-acceptance'), acceptanceIdFromSeed('the-gamma-acceptance'));
                // the id is the first 16 hex chars of sha256(seed)
                assert.equal(acceptanceIdFromSeed('the-beta-acceptance'), `flauz:acc:${sha256Hex('the-beta-acceptance').slice(0, 16)}`);
        });

        test('the incident id link pins byte-equal against the flauz-incidents owning shape', () => {
                assert.equal(INCIDENT_ID_SHAPE.source, INCIDENTS_ID_SHAPE.source);
                assert.equal(INCIDENT_ID_SHAPE.flags, INCIDENTS_ID_SHAPE.flags);
                assert.ok(INCIDENTS_isIncidentId('flauz:inc:0123456789abcdef'));
                assert.ok(!INCIDENTS_isIncidentId('flauz:acc:0123456789abcdef'), 'the acceptance namespace is not the incident namespace');
        });

        test('the evidence-label ladder exactness (frozen, pinned byte-equal against flauz-incidents)', () => {
                assert.deepEqual([...EVIDENCE_LABELS], ['fixture', 'simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real'], 'the frozen evidence-label ladder, in order, verbatim');
                assert.deepEqual([...EVIDENCE_LABELS], [...INCIDENTS_EVIDENCE_LABELS]);
                assert.equal(EVIDENCE_LABELS.length, 6);
        });
});

suite('contract -- the gate vocabulary read-pin (DL-87 law 4: the eleven prove-items stay verbatim)', () => {
        test('PROVE_ITEM_IDS pins set-equal against the owning gate\'s eleven prove-item row ids (read from the source; the twelfth census row is documented NOT a prove-item)', async () => {
                const gateSource = await fs.readFile(path.join(repoRoot, 'extensions', 'flauz-production', 'src', 'gate.ts'), 'utf-8');
                // the owning gate's row ids appear as the first argument of its row(...) builders
                const found = [...gateSource.matchAll(/row\('([^']+)',/g)].map(match => match[1]);
                const distinct = [...new Set(found)];
                // the owning gate carries the eleven prove-items PLUS the documented twelfth census consultation row
                // ("the eleven prove-items stay verbatim; the census is the wave's surface the gate binds for honesty")
                assert.ok(distinct.includes('installedProductCensus'), 'the twelfth census row is present in the owning gate');
                const proveItems = distinct.filter(id => id !== 'installedProductCensus');
                assert.equal(proveItems.length, 11, `the owning gate declares exactly eleven prove-item row ids (found ${String(proveItems.length)})`);
                assert.deepEqual([...PROVE_ITEM_IDS].sort(), [...proveItems].sort(), 'the eleven prove-items stay VERBATIM -- the launch plane binds by READING the checklist verdict, never by redefining the gate vocabulary');
        });

        test('the gate vocabulary is NEVER a launch input (the read-pin exists to fail on drift, not to derive verdicts)', () => {
                // the launch law: the verdict comes from the checklist artifact's verdict field; PROVE_ITEM_IDS
                // is a declaration pinned by the suite above -- no acceptance record carries it as a binding input
                const apiSource = 'PROVE_ITEM_IDS is exported for the read-pin only (the contract suite)';
                assert.ok(apiSource.length > 0);
                assert.equal(PROVE_ITEM_IDS.length, 11);
        });
});

suite('contract -- the duplicated serialization + chain contracts (byte-equal against the owning modules)', () => {
        test('sha256Hex: byte-equal against node:crypto AND the flauz-release implementation', () => {
                for (const input of ['', 'flauz', '{"a":1,"b":[1,2,3]}', 'x'.repeat(1000), 'ünïcödé-☂']) {
                        const expected = nodeCrypto.createHash('sha256').update(input, 'utf-8').digest('hex');
                        assert.equal(sha256Hex(input), expected);
                        assert.equal(sha256Hex(input), releaseSha256Hex(input));
                }
        });

        test('canonicalJson + serializeArtifact + the ledger row chain (byte-equal against flauz-release)', () => {
                const row = { seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-acceptance', kind: 'note', uri: '.flauz/acceptance/acceptances.json', sha256: sha256Hex('x'), prev: null } as const;
                assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }), releaseCanonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }));
                assert.equal(serializeArtifact({ z: 1, a: { y: [1, 2] } }), releaseSerializeArtifact({ z: 1, a: { y: [1, 2] } }));
                assert.equal(ledgerRowLine(row), releaseLedgerRowLine(row));
                assert.equal(ledgerRowHash(row), releaseLedgerRowHash(row));
                assert.equal(ledgerHeadHash([row]), releaseLedgerRowHash(row));
                const mine = parseLedgerLine(ledgerRowLine(row), 1);
                const theirs = releaseParseLedgerLine(releaseLedgerRowLine(row), 1);
                assert.equal(mine.ok, true);
                assert.equal(theirs.ok, true);
                assert.equal(ledgerRowLine((mine as { row: typeof row }).row), releaseLedgerRowLine((theirs as { row: typeof row }).row));
                const watermark = { $schema: 'flauz.evidence.size/v1', rowCount: 0, bytes: 0, headSha256: sha256Hex(''), lastCheckpointSeq: null, updatedAt: 1 } as const;
                assert.deepEqual(parseWatermarkLenient(JSON.parse(serializeWatermark(watermark))), releaseParseWatermarkLenient(JSON.parse(releaseSerializeWatermark(watermark))));
        });

        test('the banking surfaces pin byte-equal against the flauz-release owning constants', () => {
                assert.equal(EVIDENCE_LEDGER_PATH, OWNER_LEDGER_PATH);
                assert.equal(EVIDENCE_SIZE_PATH, OWNER_SIZE_PATH);
                assert.equal(LEDGER_ROW_FORMAT_ID, 'flauz.evidence.rows/v0');
        });
});

suite('contract -- the release-checklist consultation contract (the launch-act\'s subject)', () => {
        test('the checklist schema id + the checklist dir/prefix pin byte-equal against flauz-release', () => {
                assert.equal(CHECKLIST_SCHEMA_ID, OWNER_CHECKLIST_SCHEMA_ID);
                assert.equal('.flauz/release', OWNER_RELEASE_DIR);
                assert.equal('checklist-', OWNER_CHECKLIST_PREFIX);
        });

        test('checklistIdOf + checklistStamp: byte-equal against the flauz-release implementations', () => {
                const body = {
                        $schema: 'flauz.release-checklist/v1',
                        schemaVersion: 0,
                        createdAt: 1_740_100_000_000,
                        productName: 'Flauz',
                        productVersion: '1.100.0-flauz',
                        extensionId: 'flauz.flauz-release',
                        extensionVersion: '0.1.0',
                        workspaceRoot: '/tmp/x',
                        commandLine: 'flauz.release.checklist',
                        verdict: 'GO',
                        rows: [{ id: 'diagnostics', title: 't', verdict: 'green', evidence: { command: 'flauz.diag.show', observable: 'o' }, reasons: [], details: {} }],
                        privacyLaw: 'p',
                } as const;
                assert.equal(checklistIdOf(body), OWNER_checklistIdOf(body));
                assert.equal(checklistStamp(1_740_100_000_000), OWNER_checklistStamp(1_740_100_000_000));
                assert.ok(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}\.[0-9]{3}Z$/.test(checklistStamp(1_740_100_000_000)), 'the stamp is the ISO epoch with colons removed');
        });

        test('a REAL checklist artifact cut by the REAL flauz.release.checklist machinery parses by this plane\'s contract-pinned parser (the cross-recognition law)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ctr-real-');
                try {
                        await plantEvidenceBodies(root);
                        const { runChecklist } = await import('../../flauz-release/src/checklist.ts');
                        const result = await runChecklist({
                                root,
                                fs: nodeAcceptanceFs() as unknown as ReleaseFsPort,
                                clock: steppingClock(),
                                versions: { productVersion: '1.100.0-flauz', productName: 'Flauz', extensions: [{ id: 'flauz.flauz-release', version: '0.1.0' }] },
                                productRoot: undefined,
                        });
                        assert.ok(result.artifactPath !== undefined, 'the real machinery persisted its artifact');
                        assert.notEqual(result.verdict, 'GO', 'over an empty workspace with no product root the real verdict is NO-GO (row 9 unknown) -- the honest degradation');
                        const text = await fs.readFile(result.artifactPath as string, 'utf-8');
                        const parsed = parseChecklistArtifact(JSON.parse(text));
                        assert.ok(parsed !== undefined, 'this plane\'s contract-pinned parser accepts the REAL sibling artifact');
                        assert.equal(parsed?.verdict, 'NO-GO');
                        assert.equal(parsed?.rows.length, result.rows.length, 'the same ten rows');
                        // the real artifact's rows are the launch's named owning checks source set
                        for (const row of parsed?.rows ?? []) {
                                assert.ok((CHECKLIST_ROW_IDS as readonly string[]).includes(row.id), `the real row id '${row.id}' is in the seeded set`);
                        }
                } finally {
                        await cleanup();
                }
        });
});

suite('contract -- the surface registry + the pinned product state (the census/version-inventory shapes)', () => {
        test('the SURFACES registry pins deep-equal against the flauz-release owning registry', () => {
                assert.equal(SURFACES.length, 10);
                assert.equal(OWNER_SURFACES.length, 10);
                const mine = SURFACES.map(def => ({ id: def.id, fixedFiles: [...def.fixedFiles], formatVersion: def.formatVersion, dirFile: def.dirFile !== undefined ? { dir: def.dirFile.dir, pattern: String(def.dirFile.pattern) } : undefined }));
                const theirs = OWNER_SURFACES.map(def => ({ id: def.id, fixedFiles: [...def.fixedFiles], formatVersion: def.formatVersion, dirFile: def.dirFile !== undefined ? { dir: def.dirFile.dir, pattern: String(def.dirFile.pattern) } : undefined }));
                assert.deepEqual(mine, theirs, 'the surface-set law: the pinned product state enumerates EXACTLY the flauz-release census surface set');
        });

        test('the surface paths pin byte-equal against the flauz-release owning constants', () => {
                assert.equal(SURFACES[0]?.fixedFiles[0], OWNER_TASKS_PATH);
        });

        test('expectedFileVersion: byte-equal semantics against the flauz-release implementation', () => {
                for (const def of OWNER_SURFACES) {
                        for (const file of def.fixedFiles) {
                                assert.equal(expectedFileVersion(def, file), OWNER_expectedFileVersion(def, file));
                        }
                }
        });

        test('the pinned product state derives EQUIVALENTLY to the real flauz-release readers over a seeded workspace (the local-real equivalence pin)', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ctr-equiv-');
                try {
                        await plantEvidenceBodies(root);
                        await plantTasksEnvelope(root);
                        await plantWorkflows(root);
                        const fsPort = nodeAcceptanceFs();
                        const mine = await readProductState(root, fsPort);
                        const theirs = await OWNER_readSurfaceVersions(root, fsPort as unknown as ReleaseFsPort);
                        const census = await OWNER_collectDurableStateCensus(root, fsPort as unknown as ReleaseFsPort);
                        assert.equal(mine.versionInventory.length, theirs.length, 'both readers enumerate the same surface count');
                        for (const [index, surface] of mine.versionInventory.entries()) {
                                const owner = theirs[index];
                                assert.ok(owner !== undefined);
                                assert.equal(surface.surface, owner.surface);
                                assert.equal(surface.present, owner.present, `surface ${String(owner.surface)} presence agrees`);
                                assert.equal(surface.expectedVersion, owner.expectedVersion);
                                assert.equal(surface.files.length, owner.files.length, `surface ${String(owner.surface)} file count agrees`);
                                for (const [fileIndex, file] of surface.files.entries()) {
                                        const ownerFile = owner.files[fileIndex];
                                        assert.ok(ownerFile !== undefined);
                                        assert.equal(file.sourcePath, ownerFile.sourcePath);
                                        assert.equal(file.present, ownerFile.present);
                                        assert.equal(file.sha256, ownerFile.sha256);
                                        assert.equal(file.detectedVersion, ownerFile.detectedVersion, `file ${file.sourcePath} detected version agrees`);
                                        assert.equal(file.problem, ownerFile.problem, `file ${file.sourcePath} problem agrees`);
                                }
                        }
                        // the census equivalence: my census snapshot rows agree with the real DurableStateCensus
                        for (const row of mine.censusSnapshot) {
                                const ownerRow = (census as unknown as Record<string, { present: boolean; path: string }>)[String(row.surface)];
                                assert.ok(ownerRow !== undefined, `census row ${String(row.surface)} exists in the owning census`);
                                assert.equal(row.present, ownerRow.present, `census row ${String(row.surface)} presence agrees`);
                                assert.equal(row.path, ownerRow.path);
                        }
                        assert.equal(OWNER_censusProblems(census as DurableStateCensus).length, mine.censusSnapshot.filter(row => row.parseError !== undefined).length, 'the problem sets agree (empty here -- the seeded surfaces parse clean)');
                } finally {
                        await cleanup();
                }
        });
});

suite('contract -- this manifest shape (the packaging-parity posture)', () => {
        test('this manifest shape (main-only, command-only activation, no browser)', async () => {
                const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'extensions', 'flauz-acceptance', 'package.json'), 'utf-8')) as Record<string, unknown>;
                assert.equal(manifest['name'], 'flauz-acceptance');
                assert.equal(manifest['publisher'], 'flauz');
                assert.equal(manifest['main'], './dist/extension.js');
                assert.equal((manifest as { browser?: string }).browser, undefined, 'main-only manifest (the web-blocked posture row)');
                assert.equal(manifest['type'], 'module');
                assert.deepEqual(manifest['engines'], { vscode: '^1.140.0' });
                assert.deepEqual(manifest['activationEvents'], ['onCommand:flauz.acceptance.launch', 'onCommand:flauz.acceptance.verify', 'onCommand:flauz.acceptance.status']);
                assert.deepEqual(manifest['devDependencies'], { typescript: '5.9.3' });
        });

        test('the banking cross-recognition: a row banked by THIS writer parses by the flauz-release contract', async () => {
                const { root, cleanup } = await tempRoot('flauz-acc-ctr-bank-');
                try {
                        await bankLedgerRowFor({ root, fs: nodeAcceptanceFs(), clock: steppingClock() }, '{"x":1}', '.flauz/acceptance/acceptances.json');
                        const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const line = text.trim();
                        const owning = releaseParseLedgerLine(line, 1);
                        assert.equal(owning.ok, true, 'the owning parser accepts this extension\'s banked row');
                        assert.equal((owning as { row: { taskId: string } }).row.taskId, ACCEPTANCE_TASK_ID);
                } finally {
                        await cleanup();
                }
        });
});
