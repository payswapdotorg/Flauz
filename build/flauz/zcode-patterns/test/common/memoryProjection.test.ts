/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	MEMORY_ENTRY_SOURCE_KINDS,
	MEMORY_SCOPE_LEVELS,
	MEMORY_SECRET_EXCLUSION,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	isExportableMemoryEntry,
	isVersionedMemoryEntryRecord,
	memoryScopeAllowsPersistence,
	type MemoryEntryRecord,
	type MemoryEntrySourceKind,
	type MemoryScopeLevel,
	type ZcodeScope,
} from '../../common/memoryProjection.js';

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

function entry(overrides?: Partial<MemoryEntryRecord>): MemoryEntryRecord {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
		entryId: 'mem-0001',
		level: 'project',
		enablementRequired: true,
		retentionDays: 30,
		provenance: { sourceKind: 'agent-observation', retrievedAtIso: '2026-10-04T00:00:00.000Z' },
		secretExclusion: 'enforced',
		...overrides,
	};
}

/** Boundary data arrives as parsed JSON; JSON.parse returns `any`, so degraded records
 * (unknown source kinds, empty stamps, missing markers) feed the guard exactly as a
 * persistence edge would deliver them, with no type-system lies. */
function asBoundaryRecord(value: Record<string, unknown>): MemoryEntryRecord {
	return JSON.parse(JSON.stringify(value)) as MemoryEntryRecord;
}

suite('memoryProjection', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('MEMORY_SCOPE_LEVELS pins the exact level set', () => {
		assert.deepStrictEqual(MEMORY_SCOPE_LEVELS, ['user', 'project', 'workspace-local']);
	});

	test('MEMORY_ENTRY_SOURCE_KINDS pins the exact closed source-kind set', () => {
		assert.deepStrictEqual(MEMORY_ENTRY_SOURCE_KINDS, [
			'user-note',
			'agent-observation',
			'task-outcome',
			'workflow-summary',
			'context-compilation',
		]);
	});

	test('MEMORY_SECRET_EXCLUSION has exactly one legal value', () => {
		assert.strictEqual(MEMORY_SECRET_EXCLUSION, 'enforced');
	});

	test('minimal MemoryEntryRecord fixture compiles and fields read back (policy fields only, no content)', () => {
		const record = entry();
		assert.strictEqual(record.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(record.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(record.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
		assert.strictEqual(record.entryId, 'mem-0001');
		assert.strictEqual(record.level, 'project');
		assert.strictEqual(record.enablementRequired, true);
		assert.strictEqual(record.retentionDays, 30);
		assert.strictEqual(record.provenance.sourceKind, 'agent-observation');
		assert.strictEqual(record.provenance.retrievedAtIso, '2026-10-04T00:00:00.000Z');
		assert.strictEqual(record.secretExclusion, 'enforced');
		assert.ok(isVersionedMemoryEntryRecord(record));
		const level: MemoryScopeLevel = record.level;
		const sourceKind: MemoryEntrySourceKind = record.provenance.sourceKind;
		assert.strictEqual(level, 'project');
		assert.strictEqual(sourceKind, 'agent-observation');
	});

	test('isExportableMemoryEntry: true for a well-formed current entry at every level', () => {
		for (const level of MEMORY_SCOPE_LEVELS) {
			assert.ok(isExportableMemoryEntry(entry({ level })), `a well-formed ${level} entry is exportable`);
		}
	});

	test('isExportableMemoryEntry: false for a stale contract version', () => {
		assert.ok(!isExportableMemoryEntry(entry({ contractVersion: '0.9.0' })));
	});

	test('isExportableMemoryEntry: false for an unknown source kind (boundary data, fail-closed)', () => {
		const garbage = asBoundaryRecord({
			...entry(),
			provenance: { sourceKind: 'session-observation', retrievedAtIso: '2026-10-04T00:00:00.000Z' },
		});
		assert.ok(!isExportableMemoryEntry(garbage));
	});

	test('isExportableMemoryEntry: false for an empty retrieval stamp (no fabricated provenance)', () => {
		const garbage = asBoundaryRecord({
			...entry(),
			provenance: { sourceKind: 'agent-observation', retrievedAtIso: '' },
		});
		assert.ok(!isExportableMemoryEntry(garbage));
	});

	test('isExportableMemoryEntry: false for a non-positive or non-integer retention window', () => {
		assert.ok(!isExportableMemoryEntry(entry({ retentionDays: 0 })));
		assert.ok(!isExportableMemoryEntry(entry({ retentionDays: -7 })));
		const fractional = asBoundaryRecord({ ...entry(), retentionDays: 1.5 });
		assert.ok(!isExportableMemoryEntry(fractional));
	});

	test('isExportableMemoryEntry: false when secret exclusion is not enforced (boundary data, fail-closed)', () => {
		const garbage = asBoundaryRecord({ ...entry(), secretExclusion: 'best-effort' });
		assert.ok(!isExportableMemoryEntry(garbage));
	});

	test('isExportableMemoryEntry: false when the enablement marker is absent (boundary data, fail-closed)', () => {
		const garbage = asBoundaryRecord({ ...entry(), enablementRequired: undefined });
		assert.ok(!isExportableMemoryEntry(garbage));
	});

	test('memoryScopeAllowsPersistence: tenant policy always governs (empty tenantId forbids every level)', () => {
		for (const level of MEMORY_SCOPE_LEVELS) {
			assert.ok(!memoryScopeAllowsPersistence(level, 'ws-fixtures', ''), `tenantId must be required at level ${level}`);
		}
	});

	test('memoryScopeAllowsPersistence truth table over every level', () => {
		assert.ok(memoryScopeAllowsPersistence('user', 'ws-fixtures', 'tenant-fixtures'));
		assert.ok(memoryScopeAllowsPersistence('user', '', 'tenant-fixtures'));
		assert.ok(!memoryScopeAllowsPersistence('user', 'ws-fixtures', ''));
		assert.ok(memoryScopeAllowsPersistence('project', 'ws-fixtures', 'tenant-fixtures'));
		assert.ok(!memoryScopeAllowsPersistence('project', '', 'tenant-fixtures'));
		assert.ok(memoryScopeAllowsPersistence('workspace-local', 'ws-fixtures', 'tenant-fixtures'));
		assert.ok(!memoryScopeAllowsPersistence('workspace-local', '', 'tenant-fixtures'));
	});

	test('isVersionedMemoryEntryRecord: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedMemoryEntryRecord({ contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION }));
		assert.ok(!isVersionedMemoryEntryRecord({ contractVersion: '2.0.0' }));
		assert.ok(!isVersionedMemoryEntryRecord({}));
	});
});
