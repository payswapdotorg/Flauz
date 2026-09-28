/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * M5 tests: agent-activity checkpoints (signed, hash-chained, never
 * fabricated), watermark evolution (incremental catch-up after restart),
 * claims ledger + decision records (provenance-complete, queryable).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootMemoryWorkspace, steppingClock } from './helpers.ts';
import { CheckpointService, MILESTONES, type MilestoneVerifier } from '../src/checkpoints.ts';
import { WatermarkService, type StreamJournalPort, type StreamRow } from '../src/watermarks.ts';
import { CLAIM_TRANSITIONS, ClaimsService } from '../src/claims.ts';
import { createEd25519Signer, ed25519Supported } from '../../flauz-workflow/src/keys.ts';

const KEYS = new URL('../../../test/fixtures/workflow/keys/', import.meta.url).pathname;

function fixtureSigner() {
	const privatePem = readFileSync(join(KEYS, 'ed25519-private.pem'), { encoding: 'utf-8' });
	const publicPem = readFileSync(join(KEYS, 'ed25519-public.pem'), { encoding: 'utf-8' });
	return createEd25519Signer('flauz-fixture-ed25519-1', privatePem, publicPem);
}

function makeVerifier(completed: { milestone: string; taskId: string; payloadRef: string }[]): MilestoneVerifier {
	return {
		verify: async (milestone, taskId, payloadRef) => completed.some(entry => entry.milestone === milestone && entry.taskId === taskId && entry.payloadRef === payloadRef),
	};
}

test('checkpoints: minted only for verifiably-completed milestones (no fabrication)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const signer = fixtureSigner();
		assert.ok(ed25519Supported(), 'ed25519 available in this runtime');
		const completed = [{ milestone: 'plan-approved', taskId: 'T-001', payloadRef: 'event:2' }];
		const service = new CheckpointService({ root: ws.root, fs: ws.fs, signer, verifier: makeVerifier(completed), clock: steppingClock(1_740_005_000_000) });
		await service.ensure();
		// The completed milestone mints.
		const ok = await service.checkpoint({ milestone: 'plan-approved', taskId: 'T-001', agentId: 'flauz.agent', payloadRef: 'event:2' });
		assert.equal(ok.id, 'CP-000001');
		// An UNcompleted milestone is refused - no fabricated checkpoints.
		await assert.rejects(() => service.checkpoint({ milestone: 'step-completed', taskId: 'T-001', agentId: 'flauz.agent', payloadRef: 'run:WR-001:2' }), /refusing to mint a 'step-completed' checkpoint .* the milestone has NOT verifiably completed/);
		// An unknown milestone is refused.
		await assert.rejects(() => service.checkpoint({ milestone: 'bogus' as never, taskId: 'T-001', agentId: 'a', payloadRef: 'x' }), /milestone must be one of/);
		const verdict = await service.verify();
		assert.equal(verdict.ok, true, JSON.stringify(verdict));
		assert.equal(verdict.rows, 1);
	} finally {
		await ws.cleanup();
	}
});

test('checkpoints: the chain is hash-linked and tamper-evident; forged signatures fail verify', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const completed = [
			{ milestone: 'plan-approved', taskId: 'T-001', payloadRef: 'event:2' },
			{ milestone: 'task-reported', taskId: 'T-001', payloadRef: 'event:5' },
		];
		const service = new CheckpointService({ root: ws.root, fs: ws.fs, signer: fixtureSigner(), verifier: makeVerifier(completed), clock: steppingClock(1_740_006_000_000) });
		await service.ensure();
		await service.checkpoint({ milestone: 'plan-approved', taskId: 'T-001', agentId: 'flauz.agent', payloadRef: 'event:2' });
		await service.checkpoint({ milestone: 'task-reported', taskId: 'T-001', agentId: 'flauz.agent', payloadRef: 'event:5' });
		assert.equal((await service.verify()).ok, true);
		// Tamper with row 1's milestone: the chain breaks at row 2 (prev mismatch).
		const journal = `${ws.root}/.flauz/checkpoints.jsonl`;
		const raw = await ws.fs.readFileUtf8(journal) ?? '';
		const lines = raw.split('\n').filter(line => line.length > 0);
		const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
		first.milestone = 'task-signed-off';
		lines[0] = JSON.stringify(first);
		await ws.fs.writeFile(journal, `${lines.join('\n')}\n`);
		const tampered = await service.verify();
		assert.equal(tampered.ok, false);
		assert.ok(tampered.reason?.includes('prev hash mismatch') || tampered.reason?.includes('signature verification failed'));
	} finally {
		await ws.cleanup();
	}
});

test('checkpoints: a DIFFERENT key does not verify (the keystore owns the chain)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const completed = [{ milestone: 'task-created', taskId: 'T-001', payloadRef: 'task' }];
		const signer = fixtureSigner();
		const service = new CheckpointService({ root: ws.root, fs: ws.fs, signer, verifier: makeVerifier(completed), clock: steppingClock(1_740_007_000_000) });
		await service.ensure();
		await service.checkpoint({ milestone: 'task-created', taskId: 'T-001', agentId: 'flauz.agent', payloadRef: 'task' });
		// A verifier with a DIFFERENT key id rejects every row.
		const { createHmacSha256Signer } = await import('../../flauz-workflow/src/keys.ts');
		const hmac = createHmacSha256Signer('flauz-other-key', 'ab'.repeat(32));
		const other = new CheckpointService({ root: ws.root, fs: ws.fs, signer: hmac, verifier: makeVerifier(completed), clock: steppingClock(1) });
		const verdict = await other.verify();
		assert.equal(verdict.ok, false);
		assert.ok(verdict.reason?.includes('signature verification failed'));
	} finally {
		await ws.cleanup();
	}
});

test('watermarks: monotonic, never regressing, incremental catch-up after restart', async () => {
	const rows: StreamRow[] = [];
	for (let n = 1; n <= 5; n++) {
		rows.push({ position: n, line: `memory-write-${String(n)}` });
	}
	const journals: StreamJournalPort = {
		read: async (streamId, from) => {
			assert.equal(streamId, 'memory-writes');
			return rows.filter(row => row.position >= from);
		},
	};
	const ws = await bootMemoryWorkspace();
	const root = ws.root;
	const fs = ws.fs;
	try {
		const first = new WatermarkService({ root, fs, journals, clock: steppingClock(1_740_008_000_000) });
		await first.ensure();
		const catch1 = await first.catchUp('memory-writes');
		assert.equal(catch1.rows.length, 5);
		assert.equal(catch1.fromHighWater, 0);
		assert.equal(catch1.toHighWater, 5);
		// Idempotent: nothing new.
		const catch2 = await first.catchUp('memory-writes');
		assert.equal(catch2.rows.length, 0);
		// Regression is a typed error.
		await assert.rejects(() => first.record('memory-writes', 3), /never regresses/);
		// New rows arrive incrementally.
		rows.push({ position: 6, line: 'memory-write-6' });
		const catch3 = await first.catchUp('memory-writes');
		assert.deepEqual(catch3.rows.map(row => row.position), [6]);
		// "Kill": a fresh instance over the same files replays NOTHING already consumed.
		const second = new WatermarkService({ root, fs, journals, clock: steppingClock(1_740_009_000_000) });
		const catch4 = await second.catchUp('memory-writes');
		assert.equal(catch4.rows.length, 0);
		rows.push({ position: 7, line: 'memory-write-7' });
		const catch5 = await second.catchUp('memory-writes');
		assert.deepEqual(catch5.rows.map(row => row.position), [7]);
		assert.equal(catch5.fromHighWater, 6);
	} finally {
		await ws.cleanup();
	}
});

test('watermarks: per-stream independence (task-events vs a2a-mailbox)', async () => {
	const journals: StreamJournalPort = {
		read: async (streamId, from) => streamId === 'task-events'
			? [{ position: from, line: `event-${String(from)}` }]
			: [],
	};
	const ws = await bootMemoryWorkspace();
	try {
		const service = new WatermarkService({ root: ws.root, fs: ws.fs, journals, clock: steppingClock(1_740_010_000_000) });
		await service.ensure();
		await service.record('a2a-mailbox', 4);
		assert.equal(await service.highWater('task-events'), 0);
		assert.equal(await service.highWater('a2a-mailbox'), 4);
		const catchUp = await service.catchUp('task-events');
		assert.equal(catchUp.rows.length, 1);
		assert.equal(await service.highWater('task-events'), 1);
	} finally {
		await ws.cleanup();
	}
});

test('claims: the full lifecycle claimed -> observed -> verified, with query filters', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const service = new ClaimsService({ root: ws.root, fs: ws.fs, clock: steppingClock(1_740_011_000_000) });
		await service.ensure();
		const claim = await service.record({ statement: 'the login fix resolves the token refresh bug', taskId: 'T-001', actor: 'agent', origin: 'task-event' });
		assert.equal(claim.id, 'CL-000001');
		assert.equal(claim.state, 'claimed');
		await service.observe('CL-000001', ['E-000001'], { actor: 'tool', note: 'command output row' });
		await service.verify('CL-000001', { actor: 'tool', note: 'ledger verify-pass' });
		const current = await service.currentOf('CL-000001');
		assert.equal(current?.state, 'verified');
		assert.equal(current?.revision, 3);
		assert.deepEqual(current?.evidenceIds, ['E-000001']);
		// Query filters.
		assert.equal((await service.queryClaims({ state: 'verified' })).length, 1);
		assert.equal((await service.queryClaims({ state: 'claimed' })).length, 0);
		assert.equal((await service.queryClaims({ taskId: 'T-001' })).length, 1);
		assert.equal((await service.queryClaims({ taskId: 'T-002' })).length, 0);
		assert.equal((await service.queryClaims({ actor: 'tool' })).length, 1);
	} finally {
		await ws.cleanup();
	}
});

test('claims: transition law (illegal moves are typed errors; contradiction reopens)', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const service = new ClaimsService({ root: ws.root, fs: ws.fs, clock: steppingClock(1_740_012_000_000) });
		await service.ensure();
		await service.record({ statement: 'claim A', actor: 'agent', origin: 'task-event' });
		// claimed -> verified is ILLEGAL (must observe first).
		await assert.rejects(() => service.transition('CL-000001', 'verified', { actor: 'agent', origin: 'verification' }), /cannot move 'claimed' -> 'verified'/);
		await service.observe('CL-000001', ['E-000001'], { actor: 'tool' });
		// verified -> contradicted is legal (the audit-heavy path).
		await service.contradict('CL-000001', ['E-000002'], { actor: 'tool', note: 'counter-evidence' });
		// contradicted -> unknown (the honest reset) -> claimed again.
		await service.reopen('CL-000001', { actor: 'human' });
		await service.transition('CL-000001', 'claimed', { actor: 'agent', origin: 'task-event' });
		const current = await service.currentOf('CL-000001');
		assert.equal(current?.state, 'claimed');
		assert.equal(current?.revision, 5);
		// The lifecycle law table is complete for every state.
		for (const state of Object.keys(CLAIM_TRANSITIONS)) {
			assert.ok(Array.isArray(CLAIM_TRANSITIONS[state as keyof typeof CLAIM_TRANSITIONS]));
		}
	} finally {
		await ws.cleanup();
	}
});

test('claims: verifying without evidence is refused; restart replays the current state', async () => {
	const ws = await bootMemoryWorkspace();
	const root = ws.root;
	const fs = ws.fs;
	try {
		const service = new ClaimsService({ root, fs, clock: steppingClock(1_740_013_000_000) });
		await service.ensure();
		await service.record({ statement: 'claim B', taskId: 'T-009', actor: 'agent', origin: 'task-event' });
		await assert.rejects(() => service.verify('CL-000001', { actor: 'tool' }), /verifying requires an observed claim with evidence rows/);
		// "Kill": a fresh instance over the same journal replays the same current state.
		const second = new ClaimsService({ root, fs, clock: steppingClock(1_740_014_000_000) });
		const claims = await second.listClaims();
		assert.equal(claims.length, 1);
		assert.equal(claims[0]?.state, 'claimed');
		assert.equal(claims[0]?.taskId, 'T-009');
	} finally {
		await ws.cleanup();
	}
});

test('decisions: recorded with the DECISION-LOG posture, queryable, provenance-complete', async () => {
	const ws = await bootMemoryWorkspace();
	try {
		const service = new ClaimsService({ root: ws.root, fs: ws.fs, clock: steppingClock(1_740_015_000_000) });
		await service.ensure();
		const decision = await service.decide({
			title: 'Private tier default for promoted records',
			context: 'Promoting session memory to the task tier: does the record stay agent-private?',
			options: [
				{ label: 'keep agentId (privacy-preserving default)', chosen: true },
				{ label: 'drop agentId (task-shared)', chosen: false },
			],
			decision: 'keep agentId (privacy-preserving default)',
			consequences: 'Promoted records remain invisible to peers unless explicitly shared; safer default for the M4 boundary.',
			actor: 'human',
			note: 'TL2-C M1 design decision',
		});
		assert.equal(decision.id, 'D-000001');
		assert.equal(decision.provenance.actor, 'human');
		assert.equal(decision.provenance.contentHash.length, 64);
		// Exactly one chosen option; the decision must BE the chosen label.
		await assert.rejects(() => service.decide({ title: 'x', context: 'x', options: [{ label: 'a', chosen: false }], decision: 'a', consequences: 'x', actor: 'human' }), /exactly one option must be chosen/);
		await assert.rejects(() => service.decide({ title: 'x', context: 'x', options: [{ label: 'a', chosen: true }], decision: 'wrong', consequences: 'x', actor: 'human' }), /must be the chosen option label/);
		const found = await service.queryDecisions({ titleContains: 'private tier' });
		assert.equal(found.length, 1);
		assert.equal((await service.queryDecisions({ titleContains: 'nothing' })).length, 0);
	} finally {
		await ws.cleanup();
	}
});

test('MILESTONES is the closed set (the checkpoint surface)', () => {
	assert.deepEqual([...MILESTONES], ['task-created', 'plan-approved', 'step-completed', 'task-reported', 'task-signed-off', 'contract-verified']);
});
