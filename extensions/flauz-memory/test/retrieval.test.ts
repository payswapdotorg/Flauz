/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Retrieval tests (TL2-003 M2): deterministic ranking, scope laws, the
 * private-context boundary and share grants.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexFromRecords } from '../src/context.ts';
import { effectiveShares, retrieve, type EffectiveShare } from '../src/retrieval.ts';
import type { MemoryRecord } from '../src/api.ts';

const NOW = 1_740_100_000_000;

function record(overrides: Partial<MemoryRecord> & { id: string; tier: MemoryRecord['tier'] }): MemoryRecord {
	return {
		taskId: null,
		agentId: null,
		kind: 'observation',
		content: `content of ${overrides.id}`,
		tags: [],
		pinned: false,
		timing: { created: NOW - 1000, updatedAt: NOW - 1000 },
		provenance: { actor: 'agent', origin: 'task-event', contentHash: '0'.repeat(64), ts: NOW - 1000, evidenceId: null },
		...overrides,
	};
}

test('retrieve is deterministic: same inputs, same result', () => {
	const records = [
		record({ id: 'MEM-S-000001', tier: 'session', taskId: 'T-001', agentId: 'flauz.agent' }),
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const index = indexFromRecords(records, NOW);
	const first = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW);
	const second = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW);
	assert.deepEqual(first, second);
	assert.equal(first.entries.length, 3);
});

test('scope-match boosts the queried task over cross-task project memory', () => {
	const records = [
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW);
	assert.equal(result.entries[0]?.entry.id, 'MEM-T-001-000001');
	const scope = result.entries[0]?.applied.find(rule => rule.ruleId === 'scope-match');
	assert.equal(scope?.weight, 50);
});

test(`another task's task-tier memory is invisible (scope law)`, () => {
	const records = [
		record({ id: 'MEM-T-002-000001', tier: 'task', taskId: 'T-002' }),
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001' }),
	];
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW);
	assert.deepEqual(result.entries.map(ranked => ranked.entry.id), ['MEM-T-001-000001']);
});

test('recency decay: a fresh entry outranks an old one', () => {
	const records = [
		record({ id: 'MEM-P-000001', tier: 'project', timing: { created: NOW - 20 * 24 * 60 * 60 * 1000, updatedAt: NOW - 20 * 24 * 60 * 60 * 1000 } }),
		record({ id: 'MEM-P-000002', tier: 'project', timing: { created: NOW - 1000, updatedAt: NOW - 1000 } }),
	];
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent' }, NOW);
	assert.equal(result.entries[0]?.entry.id, 'MEM-P-000002');
	assert.equal(result.entries[1]?.entry.id, 'MEM-P-000001');
	assert.ok((result.entries[0]?.score ?? 0) > (result.entries[1]?.score ?? 0));
});

test('tag overlap and kind weights contribute to the score', () => {
	const records = [
		record({ id: 'MEM-P-000001', tier: 'project', tags: ['build'] }),
		record({ id: 'MEM-P-000002', tier: 'project', tags: ['build', 'security'], kind: 'instruction' }),
	];
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent', tags: ['build', 'security'] }, NOW);
	assert.equal(result.entries[0]?.entry.id, 'MEM-P-000002');
	const tags = result.entries[0]?.applied.find(rule => rule.ruleId === 'tag-overlap');
	assert.equal(tags?.weight, 16);
	const kind = result.entries[0]?.applied.find(rule => rule.ruleId === 'kind-weight');
	assert.equal(kind?.weight, 6);
});

test('ties break by id ascending (determinism law)', () => {
	const records = [
		record({ id: 'MEM-P-000002', tier: 'project' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent' }, NOW);
	assert.deepEqual(result.entries.map(ranked => ranked.entry.id), ['MEM-P-000001', 'MEM-P-000002']);
});

test('private records: owner reads, peers excluded, grants read, revokes exclude', () => {
	const records = [
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001', agentId: 'flauz.agent.worker-1' }),
	];
	const index = indexFromRecords(records, NOW);
	// Owner reads.
	const owner = retrieve(index, { agentId: 'flauz.agent.worker-1', taskId: 'T-001' }, NOW);
	assert.equal(owner.entries.length, 1);
	// Peer excluded.
	const peer = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW);
	assert.equal(peer.entries.length, 0);
	assert.deepEqual(peer.excludedPrivate, ['MEM-T-001-000001']);
	// Effective grant reads.
	const grant: EffectiveShare = { recordId: 'MEM-T-001-000001', toAgent: 'flauz.agent' };
	const granted = retrieve(index, { agentId: 'flauz.agent', taskId: 'T-001' }, NOW, [grant]);
	assert.equal(granted.entries.length, 1);
});

test('effectiveShares: last record wins per recordId', () => {
	const shares = effectiveShares([
		{ action: 'grant', recordId: 'MEM-T-001-000001', toAgent: 'flauz.agent' },
		{ action: 'grant', recordId: 'MEM-T-001-000002', toAgent: 'flauz.agent' },
		{ action: 'revoke', recordId: 'MEM-T-001-000001', toAgent: 'flauz.agent' },
	], 'flauz.agent');
	assert.deepEqual(shares.map(share => share.recordId), ['MEM-T-001-000002']);
	// Shares for OTHER agents are ignored.
	const others = effectiveShares([
		{ action: 'grant', recordId: 'MEM-T-001-000001', toAgent: 'flauz.agent.other' },
	], 'flauz.agent');
	assert.equal(others.length, 0);
});

test('limit caps the result length (most relevant first)', () => {
	const records: MemoryRecord[] = [];
	for (let n = 1; n <= 10; n++) {
		records.push(record({ id: `MEM-P-${String(n).padStart(6, '0')}`, tier: 'project', pinned: n > 7 }));
	}
	const index = indexFromRecords(records, NOW);
	const result = retrieve(index, { agentId: 'flauz.agent', limit: 3 }, NOW);
	assert.equal(result.entries.length, 3);
	assert.ok(result.entries.every(ranked => ranked.entry.pinned));
});
