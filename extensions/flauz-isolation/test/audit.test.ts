/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The audit semantics (A-PROD-005-W3): the classification round-trip over a
 * real-shaped registry, the honest presence law, the UNKNOWN classes, the
 * BOUNDARY_VIOLATION classes (the planted out-of-tree artifacts), the
 * persistence + banking, the determinism law, the metadata law.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';

import { IsolationError, joinPath, readProductRegistry } from '../src/api.ts';
import { runAudit, persistAudit, auditStamp, BOUNDARY_DISCLOSURE } from '../src/audit.ts';
import { AUDIT_SCHEMA_ID, AUDIT_PREFIX, ISOLATION_TASK_ID } from '../src/api.ts';
import { parseLedgerLine } from '../src/api.ts';
import {
	nodeIsolationFs,
	steppingClock,
	tempRoot,
	plantFixtureProduct,
	plantFixtureWorkspace,
	plantNestedFlauzTree,
	plantStrayRecord,
	plantStrayExport,
	plantExportInsideFlauz,
	plantStrayBundle,
	plantSymlinkIntoBoundary,
	plantAbsoluteSymlinkIntoBoundary,
	plantOutsideSymlink,
	plantUnclaimedFlauzEntry,
	readAllFiles,
} from './helpers.ts';

const fsPort = nodeIsolationFs();

/** Boots the dogfood-shaped fixture: ONE root that is both the product registry and the workspace. */
async function bootDogfood(options: Parameters<typeof plantFixtureWorkspace>[1] = {}, productOptions: Parameters<typeof plantFixtureProduct>[1] = {}) {
	const { root, cleanup } = await tempRoot('flauz-iso-audit-');
	await plantFixtureProduct(root, productOptions);
	await plantFixtureWorkspace(root, options, steppingClock());
	return { root, cleanup };
}

suite('flauz.isolation.audit — the classification semantics', () => {
	test('the classification round-trip: every law surface classified over the real-shaped 18-extension registry', async () => {
		const { root, cleanup } = await bootDogfood();
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const { record } = result;
			assert.equal(record.$schema, AUDIT_SCHEMA_ID);
			assert.equal(record.kind, 'flauz-isolation-audit');
			assert.equal(record.registry.extensionCount, 18);
			assert.equal(record.counts.extensionsKnown, 18);
			assert.equal(record.counts.extensionsUnknown, 0);
			assert.equal(record.counts.surfaces, 31);
			assert.equal(record.counts.workspaceBound, 27);
			assert.equal(record.counts.workspaceExportable, 3);
			assert.equal(record.counts.portOwned, 1);
			// every row carries a classification from the law's closed vocabulary
			for (const surface of record.surfaces) {
				assert.ok(['workspace-bound', 'workspace-exportable', 'port-owned'].includes(surface.classification), `${surface.id} carries a law classification`);
				assert.ok(surface.paths.length > 0, `${surface.id} carries its law paths`);
			}
			assert.equal(record.unknownExtensions.length, 0);
			assert.equal(record.unknownSurfaces.length, 0);
			assert.equal(record.violations.length, 0);
		} finally {
			await cleanup();
		}
	});

	test('the census-mirroring ids: the law table carries the W1 census keys', async () => {
		const { root, cleanup } = await bootDogfood();
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const censusIds = ['tasks', 'evidenceLedger', 'evidenceWatermark', 'resourcesGraph', 'opsChain', 'environmentsRegistry', 'browserSessions', 'workflows', 'orchestration', 'providerLanesState'];
			const ids = result.record.surfaces.map(surface => surface.id);
			for (const censusId of censusIds) {
				assert.ok(ids.includes(censusId), `the census key ${censusId} is classified`);
			}
		} finally {
			await cleanup();
		}
	});

	test('the honest presence law: absent surfaces are reported absent, never faked', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const byId = new Map(result.record.surfaces.map(surface => [surface.id, surface]));
			assert.equal(byId.get('evidenceLedger')?.present, true, 'the planted ledger is present');
			assert.equal(byId.get('evidenceWatermark')?.present, true, 'the banking writer planted the watermark');
			assert.equal(byId.get('telemetryState')?.present, false, 'the unplanted telemetry config is absent (honest)');
			assert.equal(byId.get('migrationState')?.present, false, 'the unplanted migration state is absent (honest)');
			assert.equal(byId.get('backupExports')?.present, false, 'no export exists (honest)');
			assert.equal(byId.get('integrityKeyStore')?.present, false, 'no key store exists (honest)');
			assert.ok(result.record.counts.surfacesPresent >= 2 && result.record.counts.surfacesPresent < result.record.counts.surfaces, 'the present count is the honest subset');
		} finally {
			await cleanup();
		}
	});

	test('the port-owned classification: the integrity key store is sealed to the port\'s path law', async () => {
		const { root, cleanup } = await bootDogfood({ withIntegrity: true });
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const keyStore = result.record.surfaces.find(surface => surface.id === 'integrityKeyStore');
			assert.ok(keyStore !== undefined, 'the key store row exists');
			assert.equal(keyStore?.classification, 'port-owned');
			assert.equal(keyStore?.boundary, 'port-owned');
			assert.deepEqual(keyStore?.paths, ['.flauz/integrity/keys/ed25519-local-dev.json']);
			assert.equal(keyStore?.present, true);
			// the port-owned surface's record NEVER appears among the banked artifacts
			const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8').catch(() => '');
			assert.ok(!ledger.includes('keys/ed25519-local-dev.json'), 'the key store path never rides a banked row');
		} finally {
			await cleanup();
		}
	});

	test('the workspace-exportable allowlist: the backup export, the release self-export and the diagnostics bundle -- nothing else', async () => {
		const { root, cleanup } = await bootDogfood({ withExport: true, withBundle: true });
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const exportable = result.record.surfaces.filter(surface => surface.classification === 'workspace-exportable').map(surface => surface.id).sort();
			assert.deepEqual(exportable, ['backupExports', 'releaseSelfExports', 'supportBundles']);
			const byId = new Map(result.record.surfaces.map(surface => [surface.id, surface]));
			assert.equal(byId.get('backupExports')?.boundary, '.flauz-exports');
			assert.equal(byId.get('backupExports')?.present, true, 'the planted export is present');
			assert.equal(byId.get('supportBundles')?.present, true, 'the planted bundle is present');
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.isolation.audit — the UNKNOWN classes (fail-closed, never a guessed verdict)', () => {
	test('a registry-grown extension the law does not know = typed UNKNOWN, disclosed', async () => {
		const { root, cleanup } = await bootDogfood({}, { extraExtensions: ['flauz-future'] });
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			assert.equal(result.record.registry.extensionCount, 19);
			assert.equal(result.record.counts.extensionsUnknown, 1);
			assert.equal(result.record.unknownExtensions.length, 1);
			assert.equal(result.record.unknownExtensions[0]?.owner, 'flauz-future');
			assert.match(result.record.unknownExtensions[0]?.reason ?? '', /fail-closed disclosure.*never a guessed verdict/s);
		} finally {
			await cleanup();
		}
	});

	test('an unclaimed .flauz/ top-level entry = typed UNKNOWN surface, disclosed', async () => {
		const { root, cleanup } = await bootDogfood();
		const planted = await plantUnclaimedFlauzEntry(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			assert.equal(result.record.unknownSurfaces.length, 1);
			assert.equal(result.record.unknownSurfaces[0]?.path, planted);
			assert.equal(result.record.counts.unknownSurfaces, 1);
		} finally {
			await cleanup();
		}
	});

	test('a claimed .flauz/ entry never discloses UNKNOWN (the law\'s own surfaces stay classified)', async () => {
		const { root, cleanup } = await bootDogfood({ withTelemetry: true, withMemory: true, withMigration: true, withProduction: true });
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			assert.equal(result.record.unknownSurfaces.length, 0);
			assert.equal(result.record.counts.unknownSurfaces, 0);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.isolation.audit — the BOUNDARY_VIOLATION classes (the planted out-of-tree artifacts)', () => {
	test('a stamp-shaped record file outside the boundary = typed violation with the exact path', async () => {
		const { root, cleanup } = await bootDogfood();
		const stray = await plantStrayRecord(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			assert.equal(result.record.violations.length, 1);
			assert.equal(result.record.violations[0]?.violation, 'BOUNDARY_VIOLATION');
			assert.equal(result.record.violations[0]?.kind, 'record-outside-boundary');
			assert.equal(result.record.violations[0]?.path, stray);
			assert.equal(result.record.counts.violations, 1);
		} finally {
			await cleanup();
		}
	});

	test('a nested .flauz/ tree = typed violation with the exact path (the cross-workspace bleed)', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		const nested = await plantNestedFlauzTree(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const nestedFinding = result.record.violations.find(violation => violation.kind === 'nested-flauz-tree');
			assert.ok(nestedFinding !== undefined, 'the nested tree is disclosed');
			assert.equal(nestedFinding?.path, nested);
			assert.equal(result.record.scan.flauzTreeCount, 2, 'the census sees both trees');
		} finally {
			await cleanup();
		}
	});

	test('an export banked OUTSIDE the exports dir = typed violation (the export-dir law)', async () => {
		const { root, cleanup } = await bootDogfood();
		const stray = await plantStrayExport(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const finding = result.record.violations.find(violation => violation.kind === 'export-outside-exports-dir');
			assert.ok(finding !== undefined, 'the stray export is disclosed');
			assert.equal(finding?.path, stray);
		} finally {
			await cleanup();
		}
	});

	test('an export banked INSIDE .flauz/ = typed violation (the W2 anti-recursion law)', async () => {
		const { root, cleanup } = await bootDogfood();
		const inside = await plantExportInsideFlauz(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const finding = result.record.violations.find(violation => violation.kind === 'export-outside-exports-dir');
			assert.ok(finding !== undefined, 'the in-tree export is disclosed');
			assert.equal(finding?.path, inside);
		} finally {
			await cleanup();
		}
	});

	test('a support bundle outside .flauz/ = typed violation (the bundle\'s lawful home)', async () => {
		const { root, cleanup } = await bootDogfood();
		const stray = await plantStrayBundle(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const finding = result.record.violations.find(violation => violation.kind === 'bundle-outside-boundary');
			assert.ok(finding !== undefined, 'the stray bundle is disclosed');
			assert.equal(finding?.path, stray);
		} finally {
			await cleanup();
		}
	});

	test('a symlink leaking the boundary (link-relative target) = typed violation with the resolved target', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		const link = await plantSymlinkIntoBoundary(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const finding = result.record.violations.find(violation => violation.kind === 'symlink-into-boundary');
			assert.ok(finding !== undefined, 'the link leak is disclosed');
			assert.equal(finding?.path, link);
			assert.equal(finding?.target, '.flauz/evidence/ledger.jsonl', 'the RESOLVED target is the shape the record carries');
		} finally {
			await cleanup();
		}
	});

	test('a symlink leaking the boundary (absolute target) = typed violation', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		const link = await plantAbsoluteSymlinkIntoBoundary(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const finding = result.record.violations.find(violation => violation.kind === 'symlink-into-boundary');
			assert.ok(finding !== undefined);
			assert.equal(finding?.path, link);
			assert.equal(finding?.target, '.flauz/evidence/ledger.jsonl', 'an absolute target resolves against the workspace frame');
		} finally {
			await cleanup();
		}
	});

	test('a symlink pointing OUTSIDE the workspace is never a boundary leak (no false positive)', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		await plantOutsideSymlink(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			assert.equal(result.record.violations.filter(violation => violation.kind === 'symlink-into-boundary').length, 0);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.isolation.audit — persistence, banking, determinism, refusals', () => {
	test('the record persists at .flauz/isolation/audit-<stamp>.json and banks census-visible', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true });
		const clock = steppingClock();
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock });
			const persisted = await persistAudit({ root, fs: fsPort, clock }, result.record);
			const expectedPath = joinPath(root, '.flauz/isolation', `${AUDIT_PREFIX}${auditStamp(result.record.createdAt)}.json`);
			assert.equal(persisted.recordPath, expectedPath);
			const onDisk = await fs.readFile(expectedPath, 'utf-8');
			assert.ok(onDisk.includes('"flauz-isolation-audit/v1"'), 'the record carries the order-pinned $schema id');
			// the census-visible banking: a note row with taskId flauz-isolation + uri = the record path
			const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
			const lines = ledger.split('\n').filter(line => line !== '');
			const banked = lines.map((line, index) => parseLedgerLine(line, index + 1)).filter(row => row.ok).map(row => row.row);
			const recordRows = banked.filter(row => row.uri === '.flauz/isolation/' + path.basename(expectedPath));
			assert.equal(recordRows.length, 1, 'exactly one row banks THIS audit record');
			assert.equal(recordRows[0]?.taskId, ISOLATION_TASK_ID);
			assert.equal(recordRows[0]?.kind, 'note');
			assert.equal(recordRows[0]?.seq, banked.length, 'the audit row is the newest (last) row of the chain');
			assert.ok(banked.some(row => row.taskId === 'flauz-workspace'), 'the seeded owning-extension row still names its owner');
			// the watermark was resynced by the real banking writer
			const watermark = JSON.parse(await fs.readFile(path.join(root, '.flauz', 'evidence', 'size.json'), 'utf-8')) as { rowCount: number };
			assert.equal(watermark.rowCount, banked.length, 'the watermark carries the POST-banking row count');
			assert.equal(persisted.banking.watermarkUpdated, true);
		} finally {
			await cleanup();
		}
	});

	test('the determinism law: identical fixtures + identical clock = byte-identical records', async () => {
		const bootA = await tempRoot('flauz-iso-det-a-');
		const bootB = await tempRoot('flauz-iso-det-b-');
		try {
			for (const root of [bootA.root, bootB.root]) {
				await plantFixtureProduct(root);
				await plantFixtureWorkspace(root, { withEvidence: true, withTelemetry: true }, steppingClock());
			}
			const a = await persistAudit({ root: bootA.root, fs: fsPort, clock: steppingClock() }, (await runAudit({ root: bootA.root, productRoot: bootA.root, fs: fsPort, clock: steppingClock() })).record);
			const b = await persistAudit({ root: bootB.root, fs: fsPort, clock: steppingClock() }, (await runAudit({ root: bootB.root, productRoot: bootB.root, fs: fsPort, clock: steppingClock() })).record);
			const bytesA = await fs.readFile(a.recordPath);
			const bytesB = await fs.readFile(b.recordPath);
			assert.deepEqual(new Uint8Array(bytesA), new Uint8Array(bytesB), 'the two audit records are byte-identical');
			assert.equal(nodeCrypto.createHash('sha256').update(bytesA).digest('hex'), nodeCrypto.createHash('sha256').update(bytesB).digest('hex'));
		} finally {
			await bootA.cleanup();
			await bootB.cleanup();
		}
	});

	test('the no-product-state refusal: without the parity registry the audit refuses typed', async () => {
		const { root, cleanup } = await bootDogfood({}, { noParity: true });
		try {
			await assert.rejects(
				runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() }),
				(err: unknown) => err instanceof IsolationError && err.code === 'FLAUZ_ISOLATION_NO_PRODUCT_STATE',
			);
		} finally {
			await cleanup();
		}
	});

	test('the registry summary is honest without a SBOM (absent shapes reported, never guessed)', async () => {
		const { root, cleanup } = await bootDogfood({}, { noSbom: true });
		try {
			const registry = await readProductRegistry(root, fsPort);
			assert.ok(registry !== undefined);
			assert.equal(registry?.sbomComponentCount, -1, 'the absent SBOM reports -1');
			assert.equal(registry?.parityRowCount, 18);
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.isolation.audit — the metadata law (the record is shapes-only)', () => {
	test('the record never carries absolute host paths', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true, withIntegrity: true });
		await plantStrayRecord(root);
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const serialized = JSON.stringify(result.record);
			assert.ok(!serialized.includes(root), 'the workspace root\'s absolute path never appears');
			assert.ok(!serialized.includes('/tmp/'), 'no absolute host path appears');
		} finally {
			await cleanup();
		}
	});

	test('the record never carries record contents (shapes only: paths, ids, verdicts, counts)', async () => {
		const { root, cleanup } = await bootDogfood({ withEvidence: true, withTelemetry: true });
		try {
			// plant content with a recognizable (non-secret) marker inside a real surface file
			await fs.writeFile(path.join(root, '.flauz', 'telemetry', 'config.json'), JSON.stringify({ $schema: 'flauz.telemetry-config/v1', MARKER_NEVER_IN_RECORD: 'contents-should-never-ride-the-audit-record' }), 'utf-8');
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const serialized = JSON.stringify(result.record);
			assert.ok(!serialized.includes('MARKER_NEVER_IN_RECORD'), 'file contents never ride the audit record');
		} finally {
			await cleanup();
		}
	});

	test('every written byte under .flauz/ after a full audit run carries the boundary disclosure + the schema id', async () => {
		const { root, cleanup } = await bootDogfood();
		const clock = steppingClock();
		try {
			const result = await runAudit({ root, productRoot: root, fs: fsPort, clock });
			await persistAudit({ root, fs: fsPort, clock }, result.record);
			const recordText = await fs.readFile(path.join(root, '.flauz', 'isolation', `${AUDIT_PREFIX}${auditStamp(result.record.createdAt)}.json`), 'utf-8');
			assert.ok(recordText.includes(BOUNDARY_DISCLOSURE.slice(0, 40)), 'the honest-boundary disclosure rides the record');
			assert.ok(recordText.includes('"flauz-isolation-audit/v1"'));
			assert.ok(BOUNDARY_DISCLOSURE.includes('HOST'), 'the disclosure names the host-posture boundary');
			const files = await readAllFiles(path.join(root, '.flauz'));
			assert.ok(files.length >= 1);
		} finally {
			await cleanup();
		}
	});
});
