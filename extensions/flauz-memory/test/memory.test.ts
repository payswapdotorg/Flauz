/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Tiered memory store tests (TL2-003 M1): recording with provenance, strict
 * validation, tier scoping, write policies (promote/demote/pin), retention +
 * compaction, the human gate on authorization-bearing records, restart
 * durability and the verify() integrity verdicts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { bootMemoryWorkspace, contentHashOf, nodeFsPort, steppingClock } from './helpers.ts';
import { memoryRecordId, taskJournalPath } from '../src/api.ts';
import { MemoryStore } from '../src/memory.ts';

test('record appends to the session tier with provenance and a derivable id', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const outcome = await ws.store.record('session', {
			kind: 'observation',
			content: 'build passes on node 24',
			tags: ['build', 'ci'],
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1_740_000_000_100 },
		});
		assert.equal(outcome.record.id, 'MEM-S-000001');
		assert.equal(outcome.record.tier, 'session');
		assert.equal(outcome.record.provenance.contentHash, contentHashOf('build passes on node 24'));
		assert.deepEqual(outcome.record.tags, ['build', 'ci']);
		const verify = await ws.store.verify();
		assert.equal(verify.ok, true, JSON.stringify(verify.problems));
	} finally {
		await ws.cleanup();
	}
});

test('session tier records require taskId AND agentId (the live task scope)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await assert.rejects(() => ws.store.record('session', {
			kind: 'observation',
			content: 'x',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		}), /session tier records require taskId AND agentId/);
	} finally {
		await ws.cleanup();
	}
});

test('task tier records persist per task id under .flauz/memory/tasks/', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('task', {
			kind: 'summary',
			content: 'login flow fixed via token refresh',
			taskId: 'T-007',
			provenance: { actor: 'agent', origin: 'task-event', ts: 100 },
		});
		const raw = await ws.fs.readFileUtf8(`${ws.root}/${taskJournalPath('T-007')}`);
		assert.ok(raw !== undefined && raw.includes('MEM-T-007-000001'));
		const listed = await ws.store.list('task');
		assert.equal(listed.length, 1);
		assert.equal(listed[0]?.id, 'MEM-T-007-000001');
	} finally {
		await ws.cleanup();
	}
});

test('project tier is cross-task (taskId rejected) and retrievable across tasks', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await assert.rejects(() => ws.store.record('project', {
			kind: 'instruction',
			content: 'prefer tabs in this repo',
			taskId: 'T-001',
			provenance: { actor: 'human', origin: 'human-note', ts: 1 },
		}), /project tier records are cross-task/);
		await ws.store.record('project', {
			kind: 'instruction',
			content: 'prefer tabs in this repo',
			provenance: { actor: 'human', origin: 'human-note', ts: 1 },
		});
		const listed = await ws.store.list('project');
		assert.equal(listed.length, 1);
	} finally {
		await ws.cleanup();
	}
});

test('origin ledger-row requires the evidence row it derived from (no fabricated memory)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await assert.rejects(() => ws.store.record('task', {
			kind: 'evidence-ref',
			content: 'the command output row',
			taskId: 'T-001',
			provenance: { actor: 'tool', origin: 'ledger-row', ts: 1 },
		}), /origin 'ledger-row' requires provenance.evidenceId/);
		await ws.store.record('task', {
			kind: 'evidence-ref',
			content: 'the command output row',
			taskId: 'T-001',
			provenance: { actor: 'tool', origin: 'ledger-row', ts: 1, evidenceId: 'E-000001' },
		});
		const got = await ws.store.get('MEM-T-001-000001');
		assert.equal(got?.provenance.evidenceId, 'E-000001');
	} finally {
		await ws.cleanup();
	}
});

test('authorization-bearing records only mint from real task events', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await assert.rejects(() => ws.store.record('task', {
			kind: 'authorization',
			content: 'approved by the user',
			taskId: 'T-001',
			provenance: { actor: 'human', origin: 'human-note', ts: 1 },
		}), /authorization-bearing records may only be minted from real task timeline events/);
		const outcome = await ws.store.record('task', {
			kind: 'authorization',
			content: 'approved by the user',
			taskId: 'T-001',
			provenance: { actor: 'human', origin: 'task-event', ts: 1 },
		});
		assert.equal(outcome.record.kind, 'authorization');
	} finally {
		await ws.cleanup();
	}
});

test('move promotes session working memory into the task tier with a recorded promotion row', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('session', {
			kind: 'observation',
			content: 'root cause: stale cache key',
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 100 },
		});
		const moved = await ws.store.move('MEM-S-000001', 'task', {
			reason: 'task ended - persist the finding',
			actor: 'agent',
			humanApproved: false,
		});
		assert.equal(moved.record.id, 'MEM-T-001-000001');
		assert.equal(moved.record.tier, 'task');
		assert.equal(moved.record.provenance.origin, 'promotion');
		assert.equal(moved.promotion.action, 'promote');
		assert.equal(moved.promotion.recordId, 'MEM-S-000001');
		assert.equal(moved.promotion.resultRecordId, 'MEM-T-001-000001');
		assert.equal(await ws.store.get('MEM-S-000001'), undefined);
		const promotions = await ws.store.promotions();
		assert.equal(promotions.length, 1);
		const verify = await ws.store.verify();
		assert.equal(verify.ok, true, JSON.stringify(verify.problems));
	} finally {
		await ws.cleanup();
	}
});

test('authorization records never auto-promote: the human gate throws without explicit approval', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('task', {
			kind: 'authorization',
			content: 'user approved the deploy',
			taskId: 'T-001',
			provenance: { actor: 'human', origin: 'task-event', ts: 1 },
		});
		await assert.rejects(() => ws.store.move('MEM-T-001-000001', 'project', {
			reason: 'promote to long-term',
			actor: 'agent',
			humanApproved: false,
		}), /authorization-bearing records never auto-promote/);
		const approved = await ws.store.move('MEM-T-001-000001', 'project', {
			reason: 'promote to long-term',
			actor: 'human',
			humanApproved: true,
		});
		assert.equal(approved.record.tier, 'project');
		assert.equal(approved.promotion.humanApproved, true);
	} finally {
		await ws.cleanup();
	}
});

test('retention: compaction evicts oldest unpinned records and records the audit row', async () => {
	const ws = await bootMemoryWorkspace({ caps: { session: 3 } });
	try {
		for (let n = 1; n <= 3; n++) {
			await ws.store.record('session', {
				kind: 'observation',
				content: `observation ${String(n)}`,
				taskId: 'T-001',
				agentId: 'flauz.agent',
				provenance: { actor: 'agent', origin: 'task-event', ts: n },
			});
		}
		// Pin #2 and record #4 as authorization-bearing: both survive the
		// retention pass; oldest-first eviction takes #1 (the oldest
		// unpinned, non-authorization record).
		await ws.store.setPinned('MEM-S-000002', true, { reason: 'keep', actor: 'human' });
		const fourth = await ws.store.record('session', {
			kind: 'authorization',
			content: 'approved the sign-off',
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'human', origin: 'task-event', ts: 4 },
		});
		assert.equal(fourth.compaction?.action, 'compact');
		assert.deepEqual(fourth.compaction?.droppedRecordIds, ['MEM-S-000001']);
		const remaining = await ws.store.list('session');
		assert.deepEqual(remaining.map(record => record.id).sort(), ['MEM-S-000002', 'MEM-S-000003', 'MEM-S-000004']);
		const promotions = await ws.store.promotions();
		assert.equal(promotions.some(row => row.action === 'compact'), true);
		const verify = await ws.store.verify();
		assert.equal(verify.ok, true, JSON.stringify(verify.problems));
	} finally {
		await ws.cleanup();
	}
});

test('compaction refuses to evict when everything is pinned or authorization-bearing', async () => {
	const ws = await bootMemoryWorkspace({ caps: { session: 1 } });
	try {
		await ws.store.record('session', {
			kind: 'observation',
			content: 'pinned observation',
			pinned: true,
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		});
		// The record() call itself must NOT fail post-write (data preservation).
		const second = await ws.store.record('session', {
			kind: 'observation',
			content: 'also pinned observation',
			pinned: true,
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 2 },
		});
		assert.equal(second.record.id, 'MEM-S-000002');
		// Nothing evictable: record() still succeeds (data preservation beats
		// the cap) and no compaction row is minted.
		assert.equal(second.compaction, undefined);
		const verify = await ws.store.verify();
		assert.equal(verify.ok, false);
		assert.ok(verify.problems.some(problem => problem.includes('over its retention cap')));
	} finally {
		await ws.cleanup();
	}
});

test('restart durability: a fresh store over the same root recovers every tier and index parity', async () => {
	const clock = steppingClock(5_000);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-mem-restart-'));
	const fsPort = nodeFsPort();
	try {
		const first = new MemoryStore({ root, fs: fsPort, clock });
		await first.ensure();
		await first.record('session', {
			kind: 'observation',
			content: 'session observation',
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		});
		await first.record('task', {
			kind: 'summary',
			content: 'task summary',
			taskId: 'T-001',
			provenance: { actor: 'agent', origin: 'task-event', ts: 2 },
		});
		await first.record('project', {
			kind: 'instruction',
			content: 'project instruction',
			provenance: { actor: 'human', origin: 'human-note', ts: 3 },
		});
		const before = await first.listAll();
		assert.equal(before.length, 3);

		// "Kill" the instance - files persist on disk.
		const second = new MemoryStore({ root, fs: fsPort, clock });
		const after = await second.listAll();
		assert.equal(after.length, 3);
		assert.ok(after.some(record => record.id === 'MEM-S-000001'));
		assert.ok(after.some(record => record.id === 'MEM-T-001-000001'));
		assert.ok(after.some(record => record.id === 'MEM-P-000001'));
		const verify = await second.verify();
		assert.equal(verify.ok, true, JSON.stringify(verify.problems));
		// Index parity across restart (no drift, no loss).
		const indexBefore = await first.index();
		const indexAfter = await second.index();
		assert.deepEqual(indexAfter.entries, indexBefore.entries);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});

test('verify flags mutated content (contentHash mismatch) and a stale index', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('session', {
			kind: 'observation',
			content: 'integrity baseline',
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		});
		const journal = `${ws.root}/.flauz/memory/session.jsonl`;
		const raw = await ws.fs.readFileUtf8(journal) ?? '';
		const mutated = raw.replace('integrity baseline', 'integrity tampered');
		assert.notEqual(raw, mutated);
		await ws.fs.writeFile(journal, mutated);
		const verdict = await ws.store.verify();
		assert.equal(verdict.ok, false);
		// Content mutation fires the contentHash verdict (index entries carry
		// no content bytes, so parity alone cannot catch it - the two verdict
		// classes are complementary).
		assert.ok(verdict.problems.some(problem => problem.includes('does not match sha256(content)')));
	} finally {
		await ws.cleanup();
	}
});

test('verify flags a crash-mid-append journal line as a stale index', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const first = await ws.store.record('session', {
			kind: 'observation',
			content: 'indexed observation',
			taskId: 'T-001',
			agentId: 'flauz.agent',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		});
		// Crash between journal append and index rebuild: clone the line behind
		// the store's back with a new position id.
		const journal = `${ws.root}/.flauz/memory/session.jsonl`;
		const cloned = JSON.parse(JSON.stringify(first.record));
		cloned.id = 'MEM-S-000002';
		cloned.content = 'crash-mid-append record';
		cloned.provenance.contentHash = contentHashOf(cloned.content);
		await ws.fs.appendFile(journal, `${JSON.stringify(cloned)}\n`);
		const verdict = await ws.store.verify();
		assert.equal(verdict.ok, false);
		assert.ok(verdict.problems.some(problem => problem.includes('does not match the journals')), JSON.stringify(verdict.problems));
		// rebuildIndex() restores parity.
		await ws.store.rebuildIndex();
		const recovered = await ws.store.verify();
		assert.equal(recovered.ok, true, JSON.stringify(recovered.problems));
	} finally {
		await ws.cleanup();
	}
});

test('record ids are journal-scoped and derivable (the id law)', () => {
	assert.equal(memoryRecordId('S', 1), 'MEM-S-000001');
	assert.equal(memoryRecordId('P', 42), 'MEM-P-000042');
	assert.equal(memoryRecordId('T-001', 7), 'MEM-T-001-000007');
});

test('shares: grant/revoke rows enforce the private-context boundary data', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('task', {
			kind: 'observation',
			content: 'worker-1 private note',
			taskId: 'T-001',
			agentId: 'flauz.agent.worker-1',
			provenance: { actor: 'agent', origin: 'task-event', ts: 1 },
		});
		const grant = await ws.store.share('MEM-T-001-000001', 'flauz.agent', { reason: 'parent needs the finding', actor: 'agent' });
		assert.equal(grant.action, 'grant');
		assert.equal(grant.fromAgent, 'flauz.agent.worker-1');
		assert.equal(grant.toAgent, 'flauz.agent');
		const revoke = await ws.store.revokeShare('MEM-T-001-000001', 'flauz.agent', { reason: 'done', actor: 'human' });
		assert.equal(revoke.action, 'revoke');
		const rows = await ws.store.shares();
		assert.equal(rows.length, 2);
		await assert.rejects(() => ws.store.share('MEM-T-001-000001', 'flauz.agent.worker-1', { reason: 'self', actor: 'agent' }), /already owned by/);
	} finally {
		await ws.cleanup();
	}
});

test('project tier records carry no task scope in the index (retrieval input shape)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		await ws.store.record('project', {
			kind: 'instruction',
			content: 'never commit secrets',
			tags: ['security'],
			provenance: { actor: 'human', origin: 'human-note', ts: 1 },
		});
		const index = await ws.store.index();
		assert.equal(index.entries.length, 1);
		assert.equal(index.entries[0]?.taskId, null);
		assert.equal(index.entries[0]?.tokens, 3);
	} finally {
		await ws.cleanup();
	}
});
