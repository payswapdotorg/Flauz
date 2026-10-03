/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The contract pins (A-PROD-005-W4, DL-32): every durable-state shape this
 * extension consults is duplicated in its src as types + parsers -- THIS
 * suite pins the duplication byte-equal against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned pin pattern; src
 * never crosses extension boundaries). The drift protection: a sibling
 * wave that moves a surface path, a record prefix, the export-anchor shape
 * or the stamp convention fails HERE until the consultation contract grows
 * through a reviewed update.
 */

import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
        LANES_SCHEMA_ID,
        HEARTBEAT_SCHEMA_ID,
        STATUS_SCHEMA_ID,
        DURABILITY_TASK_ID,
        EXTENSION_ID,
        BEAT_RING_CAP,
        LEDGER_PATH,
        SIZE_PATH,
        canonicalJson,
        serializeArtifact,
        joinPath,
        ledgerRowLine,
        ledgerRowHash,
        ledgerHeadHash,
        parseLedgerLine,
        parseWatermarkLenient,
        serializeWatermark,
        consultIsolationAudit,
        resolveExportAnchor,
        sha256Hex,
} from '../src/api.ts';
import { bankLedgerRowFor } from '../src/banking.ts';
import { nodeDurabilityFs, repoRoot, steppingClock, tempRoot, plantFixtureProduct, plantEvidenceBodies, plantIsolationAuditRecord, plantBackupExport } from './helpers.ts';

// --- the REAL owning modules (test-time cross-extension imports; the pin pattern) ---
import {
        sha256Hex as isolationSha256Hex,
        canonicalJson as isolationCanonicalJson,
        serializeArtifact as isolationSerializeArtifact,
        ledgerRowLine as isolationLedgerRowLine,
        ledgerRowHash as isolationLedgerRowHash,
        ledgerHeadHash as isolationLedgerHeadHash,
        parseLedgerLine as isolationParseLedgerLine,
        parseWatermarkLenient as isolationParseWatermarkLenient,
        serializeWatermark as isolationSerializeWatermark,
        LEDGER_PATH as OWNER_EVIDENCE_LEDGER_PATH,
        SIZE_PATH as OWNER_EVIDENCE_SIZE_PATH,
        AUDIT_SCHEMA_ID as OWNER_ISOLATION_AUDIT_SCHEMA_ID,
        ISOLATION_DIR as OWNER_ISOLATION_DIR,
        AUDIT_PREFIX as OWNER_ISOLATION_AUDIT_PREFIX,
        readProductRegistry,
        isProductRoot,
} from '../../flauz-isolation/src/api.ts';
import { parseLedgerLine as integrityParseLedgerLine } from '../../flauz-integrity/src/api.ts';
import { LEDGER_PATH as WORKSPACE_LEDGER_PATH, SIZE_PATH as WORKSPACE_SIZE_PATH } from '../../flauz-workspace/src/api.ts';
import { EXPORTS_DIR as OWNER_EXPORTS_DIR, EXPORT_DIR_PREFIX as OWNER_EXPORT_DIR_PREFIX, EXPORT_SCHEMA_ID as OWNER_EXPORT_SCHEMA_ID } from '../../flauz-backup/src/api.ts';

suite('contract — the duplicated serialization + chain contracts (byte-equal against the owning modules)', () => {
        test('sha256Hex: byte-equal against node:crypto AND the flauz-isolation implementation', () => {
                for (const input of ['', 'flauz', '{"a":1,"b":[1,2,3]}', 'x'.repeat(1000), 'ünïcödé-☂']) {
                        const expected = nodeCrypto.createHash('sha256').update(input, 'utf-8').digest('hex');
                        assert.equal(sha256Hex(input), expected);
                        assert.equal(sha256Hex(input), isolationSha256Hex(input));
                }
        });

        test('canonicalJson + serializeArtifact + the ledger row chain (byte-equal)', () => {
                const row = { seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-durability', kind: 'note', uri: '.flauz/durability/lanes.json', sha256: sha256Hex('x'), prev: null } as const;
                assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }), isolationCanonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }));
                assert.equal(serializeArtifact({ z: 1, a: { y: [1, 2] } }), isolationSerializeArtifact({ z: 1, a: { y: [1, 2] } }));
                assert.equal(ledgerRowLine(row), isolationLedgerRowLine(row));
                assert.equal(ledgerRowHash(row), isolationLedgerRowHash(row));
                assert.equal(ledgerHeadHash([row]), isolationLedgerRowHash(row));
                const mine = parseLedgerLine(ledgerRowLine(row), 1);
                const theirs = isolationParseLedgerLine(isolationLedgerRowLine(row), 1);
                assert.equal(mine.ok, true);
                assert.equal(theirs.ok, true);
                assert.equal(ledgerRowLine((mine as { row: typeof row }).row), isolationLedgerRowLine((theirs as { row: typeof row }).row));
                const watermark = { $schema: 'flauz.evidence.size/v1', rowCount: 0, bytes: 0, headSha256: sha256Hex(''), lastCheckpointSeq: null, updatedAt: 1 } as const;
                assert.deepEqual(parseWatermarkLenient(JSON.parse(serializeWatermark(watermark))), isolationParseWatermarkLenient(JSON.parse(isolationSerializeWatermark(watermark))));
        });

        test('the banking surfaces pin byte-equal against the flauz-workspace owning constants', () => {
                assert.equal(LEDGER_PATH, OWNER_EVIDENCE_LEDGER_PATH);
                assert.equal(SIZE_PATH, OWNER_EVIDENCE_SIZE_PATH);
                assert.equal(LEDGER_PATH, WORKSPACE_LEDGER_PATH);
                assert.equal(SIZE_PATH, WORKSPACE_SIZE_PATH);
        });
});

suite('contract — the W3 isolation audit consultation (the derivation surfaces, read-only)', () => {
        test('the consulted paths + schema id pin byte-equal against the flauz-isolation owning constants', () => {
                assert.equal(joinPath('.flauz/isolation'), OWNER_ISOLATION_DIR);
                assert.equal('audit-', OWNER_ISOLATION_AUDIT_PREFIX);
                assert.equal('flauz-isolation-audit/v1', OWNER_ISOLATION_AUDIT_SCHEMA_ID);
        });

        test('the consultation round-trip: MY parser consumes a REAL audit record produced by the REAL machinery', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-ctr-');
                try {
                        const fsPort = nodeDurabilityFs();
                        await plantFixtureProduct(root);
                        await plantEvidenceBodies(root, { withTasks: true });
                        await plantIsolationAuditRecord(root, fsPort, steppingClock());
                        const consultation = await consultIsolationAudit(root, fsPort);
                        assert.equal(consultation.state, 'resolved');
                        if (consultation.state === 'resolved') {
                                assert.ok(consultation.consultation.consultedRecord.startsWith('.flauz/isolation/audit-'));
                                assert.ok(consultation.consultation.surfaces.length >= 20, 'the REAL audit record carries the full law table');
                                const tasks = consultation.consultation.surfaces.find(surface => surface.id === 'tasks');
                                assert.ok(tasks !== undefined);
                                assert.equal(tasks.owner, 'flauz-workspace');
                                assert.equal(tasks.classification, 'workspace-bound');
                                assert.equal(tasks.present, true, 'the planted tasks surface resolves through the real derivation');
                        }
                } finally {
                        await cleanup();
                }
        });
});

suite('contract — the W2 backup export anchor (the banked export the workspace resolves)', () => {
        test('the anchor paths + schema id pin byte-equal against the flauz-backup owning constants', () => {
                assert.equal('.flauz-exports', OWNER_EXPORTS_DIR);
                assert.equal('export-', OWNER_EXPORT_DIR_PREFIX);
                assert.equal('flauz.backup-export/v1', OWNER_EXPORT_SCHEMA_ID);
        });

        test('the anchor round-trip: MY resolver consumes a REAL export produced through the REAL W2 ports', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-ctr2-');
                try {
                        const fsPort = nodeDurabilityFs();
                        await plantEvidenceBodies(root);
                        await plantBackupExport(root, fsPort, steppingClock());
                        const anchor = await resolveExportAnchor(root, fsPort);
                        assert.equal(anchor.state, 'present');
                        if (anchor.state === 'present') {
                                assert.ok(anchor.anchor.exportDirName?.startsWith('export-'));
                                assert.equal(typeof anchor.anchor.createdAt, 'number');
                        }
                } finally {
                        await cleanup();
                }
        });
});

suite('contract — the order-pinned schema ids + this manifest shape + the real-tree derivation', () => {
        test('the order-pinned schema ids (verbatim) + the wave constants', () => {
                assert.equal(LANES_SCHEMA_ID, 'flauz.durability-lanes/v1');
                assert.equal(HEARTBEAT_SCHEMA_ID, 'flauz.durability-heartbeat/v1');
                assert.equal(STATUS_SCHEMA_ID, 'flauz.durability-status/v1');
                assert.equal(DURABILITY_TASK_ID, 'flauz-durability');
                assert.equal(EXTENSION_ID, 'flauz.flauz-durability');
                assert.equal(BEAT_RING_CAP, 32, 'the bounded ring: the last 32 stamps');
        });

        test('this manifest shape (the packaging-parity posture)', async () => {
                const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'extensions', 'flauz-durability', 'package.json'), 'utf-8')) as Record<string, unknown>;
                assert.equal(manifest['name'], 'flauz-durability');
                assert.equal(manifest['publisher'], 'flauz');
                assert.equal(manifest['main'], './dist/extension.js');
                assert.equal((manifest as { browser?: string }).browser, undefined, 'main-only manifest (the web-blocked posture row)');
                assert.deepEqual(manifest['activationEvents'], ['onCommand:flauz.durability.register', 'onCommand:flauz.durability.heartbeat', 'onCommand:flauz.durability.status']);
        });

        test('the real repo tree: the product root resolves + THIS extension is present (the 19th)', async () => {
                assert.equal(await isProductRoot(repoRoot, nodeDurabilityFs()), true, 'the real repo root is the repo-state product');
                const registry = await readProductRegistry(repoRoot, nodeDurabilityFs());
                assert.ok(registry !== undefined);
                assert.ok((registry?.extensions ?? []).includes('flauz-durability'), 'this wave\'s extension lives in the real registry');
                assert.ok((registry?.extensions.length ?? 0) >= 19, 'the real tree carries the 19-extension registry (18 + this wave)');
                assert.ok((registry?.parityRowCount ?? 0) > 0, 'the real parity registry resolves');
                assert.ok((registry?.sbomComponentCount ?? 0) > 0, 'the real SBOM resolves');
        });

        test('the banking cross-recognition: a row banked by THIS writer parses by the flauz-integrity contract', async () => {
                const { root, cleanup } = await tempRoot('flauz-dur-ctr3-');
                try {
                        await bankLedgerRowFor({ root, fs: nodeDurabilityFs(), clock: steppingClock() }, '{"x":1}', '.flauz/durability/lanes.json');
                        const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const line = text.trim();
                        const owning = integrityParseLedgerLine(line, 1);
                        assert.equal(owning.ok, true, 'the owning parser accepts this extension\'s banked row');
                        assert.equal((owning as { row: { taskId: string } }).row.taskId, DURABILITY_TASK_ID);
                } finally {
                        await cleanup();
                }
        });
});
