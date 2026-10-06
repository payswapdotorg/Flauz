/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The contract pins (A-PROD-005-W3, DL-32): every durable-state shape this
 * extension consults is duplicated in its src as types + parsers -- THIS
 * suite pins the duplication byte-equal against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned pin pattern; src
 * never crosses extension boundaries). The drift protection: a sibling
 * wave that moves a surface path, a record prefix, the census set or the
 * stamp convention fails HERE until the isolation law table grows through
 * a reviewed update -- and a registry-grown extension surfaces as the
 * audit's typed UNKNOWN disclosure, never a guessed classification.
 */

import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
        sha256Hex,
        canonicalJson,
        serializeArtifact,
        joinPath,
        ledgerRowLine,
        ledgerRowHash,
        ledgerHeadHash,
        parseLedgerLine,
        parseWatermarkLenient,
        serializeWatermark,
        splitJsonl,
        utf8ByteLength,
        readProductRegistry,
        isProductRoot,
        LEDGER_PATH as MY_EVIDENCE_LEDGER_PATH,
        SIZE_PATH as MY_EVIDENCE_SIZE_PATH,
} from '../src/api.ts';
import { AUDIT_SCHEMA_ID, ENFORCE_SCHEMA_ID, ISOLATION_TASK_ID } from '../src/api.ts';
import {
        LAW_SURFACES,
        KNOWN_EXTENSIONS,
        lawRecordPrefixes,
        lawDirPrefixes,
        STAMP_SHAPE,
        isLawRecordName,
        isLawDirName,
} from '../src/law.ts';
import { bankLedgerRowFor } from '../src/banking.ts';
import { nodeIsolationFs, repoRoot, steppingClock, tempRoot } from './helpers.ts';

// --- the REAL owning modules (test-time cross-extension imports; the pin pattern) ---
import { sha256Hex as integritySha256Hex, canonicalJson as integrityCanonicalJson, serializeArtifact as integritySerializeArtifact, ledgerRowLine as integrityLedgerRowLine, ledgerRowHash as integrityLedgerRowHash, parseLedgerLine as integrityParseLedgerLine, parseWatermarkLenient as integrityParseWatermarkLenient, serializeWatermark as integritySerializeWatermark, INTEGRITY_DIR as OWNER_INTEGRITY_DIR, LEDGER_PREFIX as OWNER_INTEGRITY_LEDGER_PREFIX, VERIFY_PREFIX as OWNER_INTEGRITY_VERIFY_PREFIX, KEY_STORE_PATH as OWNER_KEY_STORE_PATH } from '../../flauz-integrity/src/api.ts';
import { ENVELOPE_PATH as OWNER_TASKS_PATH, LEDGER_PATH as OWNER_EVIDENCE_LEDGER_PATH, SIZE_PATH as OWNER_EVIDENCE_SIZE_PATH } from '../../flauz-workspace/src/api.ts';
import { GRAPH_PATH as OWNER_RESOURCES_GRAPH_PATH, OPS_PATH as OWNER_RESOURCES_OPS_PATH } from '../../flauz-resources/src/api.ts';
import { ENVIRONMENTS_PATH as OWNER_ENVIRONMENTS_PATH } from '../../flauz-environments/src/api.ts';
import { BROWSER_SESSIONS_PATH as OWNER_BROWSER_SESSIONS_PATH } from '../../flauz-diagnostics/src/api.ts';
import { POLICY_PATH as OWNER_BROWSER_POLICY_PATH } from '../../flauz-browser/src/policy.ts';
import { WORKFLOW_INDEX_PATH as OWNER_WORKFLOW_INDEX_PATH } from '../../flauz-workflow/src/envelope.ts';
import { WORKFLOWS_DIR as OWNER_WORKFLOWS_DIR } from '../../flauz-diagnostics/src/api.ts';
import { EXEC_SPECS_DIR as OWNER_WORKFLOW_EXEC_DIR, RUNS_DIR as OWNER_WORKFLOW_RUNS_DIR } from '../../flauz-workflow/src/executable.ts';
import { CONTRACTS_DIR as OWNER_A2A_CONTRACTS_DIR } from '../../flauz-workflow/src/coordination.ts';
import { ORCH_GRAPHS_PATH as OWNER_ORCH_GRAPHS_PATH, ORCH_JOURNAL_PATH as OWNER_ORCH_JOURNAL_PATH, PROVIDERS_PATH as OWNER_PROVIDERS_PATH, ROUTING_POLICY_PATH as OWNER_ROUTING_POLICY_PATH, ROUTING_DECISIONS_PATH as OWNER_ROUTING_DECISIONS_PATH, PROVIDER_SWITCHES_PATH as OWNER_PROVIDER_SWITCHES_PATH, MODELS_DIR as OWNER_MODELS_DIR } from '../../flauz-diagnostics/src/api.ts';
import { MEMORY_DIR as OWNER_MEMORY_DIR, MEMORY_TASKS_DIR as OWNER_MEMORY_TASKS_DIR, SESSION_JOURNAL_PATH as OWNER_MEMORY_SESSION_PATH, PROJECT_JOURNAL_PATH as OWNER_MEMORY_PROJECT_PATH, PROMOTIONS_PATH as OWNER_MEMORY_PROMOTIONS_PATH, SHARES_PATH as OWNER_MEMORY_SHARES_PATH, INDEX_PATH as OWNER_MEMORY_INDEX_PATH } from '../../flauz-memory/src/api.ts';
import { WATERMARKS_PATH as OWNER_MEMORY_WATERMARKS_PATH } from '../../flauz-memory/src/watermarks.ts';
import { CONFIG_PATH as OWNER_TELEMETRY_CONFIG_PATH, LEDGER_PATH as OWNER_TELEMETRY_LEDGER_PATH } from '../../flauz-telemetry/src/api.ts';
import { PLAN_PATH as OWNER_MIGRATION_PLAN_PATH, MARKER_PATH as OWNER_MIGRATION_MARKER_PATH, MIGRATION_LOG_PATH as OWNER_MIGRATION_LOG_PATH, ROLLBACK_LOG_PATH as OWNER_MIGRATION_ROLLBACK_PATH } from '../../flauz-migration/src/api.ts';
import { RECOVERY_LOG_PATH as OWNER_BACKUP_RECOVERY_LOG_PATH, EXPORTS_DIR as OWNER_EXPORTS_DIR, EXPORT_DIR_PREFIX as OWNER_EXPORT_DIR_PREFIX } from '../../flauz-backup/src/api.ts';
import { BUNDLE_DIR_PREFIX as OWNER_BUNDLE_DIR_PREFIX } from '../../flauz-diagnostics/src/api.ts';
import { RELEASE_DIR as OWNER_RELEASE_DIR, VERIFY_RECORD_PREFIX as OWNER_RELEASE_VERIFY_PREFIX, CHECKLIST_PREFIX as OWNER_RELEASE_CHECKLIST_PREFIX } from '../../flauz-release/src/api.ts';
import { PRODUCTION_DIR as OWNER_PRODUCTION_DIR, CENSUS_RECORD_PREFIX as OWNER_PRODUCTION_CENSUS_PREFIX, MATRIX_PREFIX as OWNER_PRODUCTION_MATRIX_PREFIX, GATE_RECORD_PREFIX as OWNER_PRODUCTION_GATE_PREFIX, SURFACES as PRODUCTION_SURFACES } from '../../flauz-production/src/api.ts';

/** The law table as an id-keyed map (the pin vehicle). */
function lawById(id: string): { files: string[]; dirs: string[]; classification: string } {
        const surface = LAW_SURFACES.find(candidate => candidate.id === id);
        if (surface === undefined) {
                throw new Error(`flauz-isolation/test: no law surface '${id}'`);
        }
        return { files: [...surface.files].sort(), dirs: [...surface.dirs].sort(), classification: surface.classification };
}

suite('contract — the canonical cores are byte-equal to the owning implementations', () => {
        test('sha256Hex + canonicalJson + serializeArtifact match flauz-integrity AND node:crypto', () => {
                const samples = ['', 'flauz', '.flauz/evidence/ledger.jsonl', 'ó font — em-dash'];
                for (const sample of samples) {
                        assert.equal(sha256Hex(sample), integritySha256Hex(sample));
                        assert.equal(sha256Hex(sample), nodeCrypto.createHash('sha256').update(Buffer.from(sample, 'utf-8')).digest('hex'));
                }
                const value = { $schema: 'flauz-isolation-audit/v1', createdAt: 1, paths: ['.flauz/x', '.flauz/y'], nested: { b: 1, a: [2, 3] } };
                const roundTripped = JSON.parse(JSON.stringify(value));
                assert.equal(canonicalJson(value), integrityCanonicalJson(roundTripped));
                assert.equal(serializeArtifact(value), integritySerializeArtifact(roundTripped));
                // DL-9: fully canonical (sorted) key order + 2-space indent + exactly one trailing newline
                const artifact = serializeArtifact(value);
                assert.ok(artifact.startsWith('{\n  "$schema": "flauz-isolation-audit/v1"'));
                assert.ok(artifact.indexOf('"createdAt"') < artifact.indexOf('"nested"') && artifact.indexOf('"nested"') < artifact.indexOf('"paths"'), 'keys sort deep');
                assert.ok(artifact.endsWith('\n') && !artifact.endsWith('\n\n'));
        });

        test('the ledger-row contract: parse + canonical line + chain hashes match flauz-integrity', () => {
                const row = { seq: 7, ts: 1_740_000_000_000, taskId: 'flauz-isolation', kind: 'note' as const, uri: '.flauz/isolation/audit-x.json', sha256: 'a'.repeat(64), prev: 'b'.repeat(64) };
                assert.equal(ledgerRowLine(row), integrityLedgerRowLine(row));
                assert.equal(ledgerRowHash(row), integrityLedgerRowHash(row));
                assert.equal(ledgerHeadHash([row]), integrityLedgerRowHash(row));
                assert.equal(ledgerHeadHash([]), sha256Hex(''));
                const mine = parseLedgerLine(ledgerRowLine(row), 1);
                const owning = integrityParseLedgerLine(integrityLedgerRowLine(row), 1);
                assert.deepEqual(mine, owning);
                assert.equal(mine.ok, true);
                // the failure classes agree too
                for (const bad of ['{ not json', '{}', JSON.stringify({ seq: 0, ts: 1, taskId: 'x', kind: 'note', uri: 'u', sha256: 'a'.repeat(64), prev: null })]) {
                        assert.equal(parseLedgerLine(bad, 1).ok, integrityParseLedgerLine(bad, 1).ok);
                }
        });

        test('the watermark contract: lenient parse + serialization match flauz-integrity', () => {
                const watermark = { $schema: 'flauz.evidence.size/v1', rowCount: 3, bytes: 99, headSha256: 'c'.repeat(64), lastCheckpointSeq: null, updatedAt: 1_740_000_000_000 };
                assert.deepEqual(parseWatermarkLenient(watermark), integrityParseWatermarkLenient(watermark));
                assert.equal(serializeWatermark(watermark), integritySerializeWatermark(watermark));
                assert.equal(parseWatermarkLenient({ ...watermark, headSha256: 'x' }), undefined);
        });

        test('the small helpers match the owning shapes (splitJsonl + utf8ByteLength + joinPath)', () => {
                assert.deepEqual(splitJsonl('a\nb\n'), ['a', 'b']);
                assert.deepEqual(splitJsonl('a\nb'), ['a', 'b']);
                assert.equal(utf8ByteLength('flauz'), 5);
                assert.equal(utf8ByteLength('é'), 2);
                assert.equal(joinPath('root', '.flauz', 'isolation'), 'root/.flauz/isolation');
                assert.equal(joinPath('root', '', '.flauz'), 'root/.flauz');
        });
});

suite('contract — the isolation law table is pinned byte-equal to the REAL owning constants', () => {
        test('the workspace + census surfaces (flauz-workspace + flauz-resources + flauz-environments + flauz-diagnostics)', () => {
                assert.ok(lawById('tasks').files.includes(OWNER_TASKS_PATH));
                assert.ok(lawById('evidenceLedger').files.includes(OWNER_EVIDENCE_LEDGER_PATH));
                assert.ok(lawById('evidenceLedger').files.includes(MY_EVIDENCE_LEDGER_PATH));
                assert.ok(lawById('evidenceWatermark').files.includes(OWNER_EVIDENCE_SIZE_PATH));
                assert.ok(lawById('evidenceWatermark').files.includes(MY_EVIDENCE_SIZE_PATH));
                assert.ok(lawById('resourcesGraph').files.includes(OWNER_RESOURCES_GRAPH_PATH));
                assert.ok(lawById('opsChain').files.includes(OWNER_RESOURCES_OPS_PATH));
                assert.ok(lawById('environmentsRegistry').files.includes(OWNER_ENVIRONMENTS_PATH));
                assert.ok(lawById('browserSessions').files.includes(OWNER_BROWSER_SESSIONS_PATH));
                assert.ok(lawById('browserPolicy').files.includes(OWNER_BROWSER_POLICY_PATH));
                assert.ok(lawById('orchestration').files.includes(OWNER_ORCH_GRAPHS_PATH));
                assert.ok(lawById('orchestration').files.includes(OWNER_ORCH_JOURNAL_PATH));
                assert.ok(lawById('providerLanesState').files.includes(OWNER_PROVIDERS_PATH));
                assert.ok(lawById('providerLanesState').files.includes(OWNER_ROUTING_POLICY_PATH));
                assert.ok(lawById('providerLanesState').files.includes(OWNER_ROUTING_DECISIONS_PATH));
                assert.ok(lawById('providerLanesState').files.includes(OWNER_PROVIDER_SWITCHES_PATH));
                assert.ok(lawById('providerLanesState').dirs.includes(OWNER_MODELS_DIR));
        });

        test('the workflow surfaces (flauz-workflow: the envelopes + exec specs + runs + a2a contracts)', () => {
                assert.ok(lawById('workflows').files.includes(OWNER_WORKFLOW_INDEX_PATH));
                assert.ok(lawById('workflows').dirs.includes(OWNER_WORKFLOWS_DIR));
                assert.ok(lawById('workflowExec').dirs.includes(OWNER_WORKFLOW_EXEC_DIR));
                assert.ok(lawById('workflowRuns').dirs.includes(OWNER_WORKFLOW_RUNS_DIR));
                assert.ok(lawById('a2aContracts').dirs.includes(OWNER_A2A_CONTRACTS_DIR));
        });

        test('the memory tiers + watermarks (flauz-memory)', () => {
                const tiers = lawById('memoryTiers');
                assert.ok(tiers.dirs.includes(OWNER_MEMORY_DIR));
                assert.ok(tiers.dirs.includes(OWNER_MEMORY_TASKS_DIR));
                assert.ok(tiers.files.includes(OWNER_MEMORY_SESSION_PATH));
                assert.ok(tiers.files.includes(OWNER_MEMORY_PROJECT_PATH));
                assert.ok(tiers.files.includes(OWNER_MEMORY_PROMOTIONS_PATH));
                assert.ok(tiers.files.includes(OWNER_MEMORY_SHARES_PATH));
                assert.ok(tiers.files.includes(OWNER_MEMORY_INDEX_PATH));
                assert.ok(lawById('memoryWatermarks').files.includes(OWNER_MEMORY_WATERMARKS_PATH));
        });

        test('the telemetry + migration + backup + diagnostics surfaces', () => {
                assert.ok(lawById('telemetryState').files.includes(OWNER_TELEMETRY_CONFIG_PATH));
                assert.ok(lawById('telemetryLedger').files.includes(OWNER_TELEMETRY_LEDGER_PATH));
                const migration = lawById('migrationState');
                assert.ok(migration.files.includes(OWNER_MIGRATION_PLAN_PATH));
                assert.ok(migration.files.includes(OWNER_MIGRATION_MARKER_PATH));
                assert.ok(migration.files.includes(OWNER_MIGRATION_LOG_PATH));
                assert.ok(migration.files.includes(OWNER_MIGRATION_ROLLBACK_PATH));
                assert.ok(lawById('backupRecoveryLog').files.includes(OWNER_BACKUP_RECOVERY_LOG_PATH));
                assert.ok(lawById('backupExports').dirs.includes(OWNER_EXPORTS_DIR));
                assert.ok(lawById('releaseSelfExports').dirs.includes(OWNER_EXPORTS_DIR));
                assert.ok(lawById('supportBundles').dirs.includes('.flauz'));
        });

        test('the record-producing surfaces (release + production + integrity + isolation itself)', () => {
                assert.ok(lawById('releaseRecords').dirs.includes(OWNER_RELEASE_DIR));
                assert.ok(lawById('releaseRecords').files.length === 0, 'the release surface is dir-shaped (its records are stamp-prefixed)');
                assert.ok(lawById('productionRecords').dirs.includes(OWNER_PRODUCTION_DIR));
                assert.ok(lawById('integrityRecords').dirs.includes(OWNER_INTEGRITY_DIR));
                const keyStore = lawById('integrityKeyStore');
                assert.deepEqual(keyStore.files, [OWNER_KEY_STORE_PATH]);
                assert.equal(keyStore.classification, 'port-owned');
                assert.ok(lawById('isolationRecords').dirs.includes('.flauz/isolation'));
        });

        test('the census-id pin: the W1 census keys are law surfaces with the owning fixedFiles (the flauz-production SURFACES registry)', () => {
                for (const surface of PRODUCTION_SURFACES) {
                        const law = lawById(surface.id);
                        assert.deepEqual(law.files, [...surface.fixedFiles].sort(), `the census surface ${surface.id} carries the owning fixedFiles`);
                }
                assert.equal(PRODUCTION_SURFACES.length, 10);
        });

        test('the record-prefix pins: the law stamp shapes ARE the owning prefixes (never a second list)', () => {
                // note: release + integrity SHARE the 'verify-' prefix (both lawfully own verify-<stamp>.json
                // records under their own dirs) -- the derived set is the DEDUPED union, sorted
                assert.deepEqual(lawRecordPrefixes(), [
                        'acceptance-',
                        'audit-',
                        OWNER_PRODUCTION_CENSUS_PREFIX,
                        OWNER_RELEASE_CHECKLIST_PREFIX,
                        'enforce-',
                        OWNER_PRODUCTION_GATE_PREFIX,
                        'heartbeat-',
                        OWNER_INTEGRITY_LEDGER_PREFIX,
                        'loop-',
                        OWNER_PRODUCTION_MATRIX_PREFIX,
                        'receipt-',
                        'status-',
                        'verify-',
                ]);
                assert.deepEqual(lawDirPrefixes(), [OWNER_EXPORT_DIR_PREFIX, OWNER_BUNDLE_DIR_PREFIX].sort());
        });

        test('the stamp shape: the export-stamp convention (ISO-8601 UTC, colons removed)', () => {
                const at = 1_740_051_234_567;
                const stamp = new Date(at).toISOString().replaceAll(':', '');
                assert.match(stamp, STAMP_SHAPE);
                assert.ok(isLawRecordName(`ledger-${stamp}.json`));
                assert.ok(!isLawRecordName('ledger-not-a-stamp.json'));
                assert.ok(!isLawRecordName(`ledger-${stamp}.json.bak`));
                assert.ok(isLawDirName(`export-${stamp}`));
                assert.ok(isLawDirName(`support-bundle-${stamp}`));
                assert.ok(!isLawDirName('export-latest'));
        });
});

suite('contract — the registry derivation over the REAL repo tree (local-real, station-stable)', () => {
        test('the real registry: every extension is KNOWN (the derivation never discloses UNKNOWN at this base)', async () => {
                assert.equal(await isProductRoot(repoRoot, nodeIsolationFs()), true, 'the real repo root is the repo-state product');
                const registry = await readProductRegistry(repoRoot, nodeIsolationFs());
                assert.ok(registry !== undefined);
                assert.ok((registry?.extensions.length ?? 0) >= 18, 'the real tree carries the 18-extension registry (17 + this wave)');
                for (const name of registry?.extensions ?? []) {
                        assert.ok(KNOWN_EXTENSIONS.includes(name), `the real registry extension ${name} is known to the isolation law`);
                }
                for (const name of KNOWN_EXTENSIONS) {
                        assert.ok((registry?.extensions ?? []).includes(name), `the law's known extension ${name} exists in the real registry (no stale law rows)`);
                }
                assert.ok((registry?.parityRowCount ?? 0) > 0, 'the real parity registry resolves');
                assert.ok((registry?.sbomComponentCount ?? 0) > 0, 'the real SBOM resolves');
        });

        test('the banking cross-recognition: a row banked by THIS writer parses by the flauz-integrity contract', async () => {
                const { root, cleanup } = await tempRoot('flauz-iso-ctr-');
                try {
                        await bankLedgerRowFor({ root, fs: nodeIsolationFs(), clock: steppingClock() }, '{"x":1}', '.flauz/isolation/audit-fixture.json');
                        const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
                        const line = text.trim();
                        const owning = integrityParseLedgerLine(line, 1);
                        assert.equal(owning.ok, true, 'the owning parser accepts this extension\'s banked row');
                        assert.equal((owning as { row: { taskId: string } }).row.taskId, ISOLATION_TASK_ID);
                } finally {
                        await cleanup();
                }
        });

        test('the order-pinned schema ids + this manifest shape (the packaging-parity posture)', async () => {
                assert.equal(AUDIT_SCHEMA_ID, 'flauz-isolation-audit/v1');
                assert.equal(ENFORCE_SCHEMA_ID, 'flauz-isolation-enforce/v1');
                assert.equal(ISOLATION_TASK_ID, 'flauz-isolation');
                const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'extensions', 'flauz-isolation', 'package.json'), 'utf-8')) as Record<string, unknown>;
                assert.equal(manifest['name'], 'flauz-isolation');
                assert.equal(manifest['publisher'], 'flauz');
                assert.equal(manifest['main'], './dist/extension.js');
                assert.equal((manifest as { browser?: string }).browser, undefined, 'main-only manifest (the web-blocked posture row)');
                assert.deepEqual(manifest['activationEvents'], ['onCommand:flauz.isolation.audit', 'onCommand:flauz.isolation.enforce', 'onCommand:flauz.isolation.status']);
        });
});
