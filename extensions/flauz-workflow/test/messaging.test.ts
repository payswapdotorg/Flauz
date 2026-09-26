/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Wave 4 Lane K, M3 - A2A messaging tests (TS side + G/TS parity).
 *
 * Coverage:
 *   - the good journal fixture validates line-by-line in BOTH the TS validator
 *     (validateA2aMessage) and the G validator (core/a2a.mjs validateMessage),
 *     and serializes back to the exact journal bytes on both sides;
 *   - the cursor fixture is the drained end-state of the good journal;
 *   - every bad fixture is rejected by BOTH validators carrying its expected
 *     rule substring (rot protection: a gate that cannot fail is not a gate);
 *   - the pure mailbox projection (projectMailbox / knownAgents);
 *   - AgentMessenger: every helper posts the right typed shape through the
 *     A2aPort (fake port; the port contract is what the DL-21 seam client
 *     implements) and drain/peek speak the collect cursor discipline.
 *
 * The G-side bus behavior itself (journal canonicality enforcement, drain
 * semantics across restarts, seam round-trips) lives in
 * extensions/flauz-agent/test/a2a.test.ts next to the real service.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	validateA2aMessage,
	serializeA2aMessage,
	projectMailbox,
	knownAgents,
	messageIdOf,
	AgentMessenger,
	A2A_SCHEMA,
	A2A_MESSAGE_KINDS,
	A2A_REPORT_OUTCOMES,
	A2A_CLAIM_ACTIONS,
	type A2aMessage,
	type A2aPort,
	type A2aMessageInput,
} from '../src/messaging.ts';
import {
	validateMessage,
	messageLine,
	messageIdOf as gMessageIdOf,
	MESSAGE_KINDS,
	REPORT_OUTCOMES,
	CLAIM_ACTIONS,
	A2A_SCHEMA as G_A2A_SCHEMA,
	A2A_CURSORS_SCHEMA,
} from '../../flauz-agent/core/a2a.mjs';

const FIXTURES = new URL('../../../test/fixtures/workflow/a2a/', import.meta.url).pathname;

function goodJournal(): { lines: string[]; messages: A2aMessage[] } {
	const raw = readFileSync(join(FIXTURES, 'good.jsonl'), { encoding: 'utf-8' });
	const lines = raw.split('\n').filter(line => line.length > 0);
	return { lines, messages: lines.map(line => validateA2aMessage(JSON.parse(line))) };
}

/** One entry per bad fixture: the substring BOTH validators' errors must carry. */
const EXPECTED_RULES: Record<string, string> = {
	'01-wrong-schema.json': '$schema must be',
	'02-bad-seq.json': 'seq must be a positive integer',
	'03-id-seq-mismatch.json': 'id must be',
	'04-unknown-kind.json': 'kind must be one of',
	'05-bad-from.json': 'from must be an agent id',
	'06-bad-to.json': 'to must be an agent id',
	'07-self-send.json': 'from and to must differ',
	'08-bad-ts.json': 'ts must be a positive integer',
	'09-bad-inreplyto.json': 'inReplyTo must be an M-NNNNNN id or null',
	'10-delegation-missing-prompt.json': 'task-delegation payload must have exactly the keys',
	'11-delegation-bad-taskid.json': 'task-delegation taskId must match',
	'12-delegation-bad-workflowid.json': 'task-delegation workflowId must match',
	'13-report-bad-outcome.json': 'result-report outcome must be one of',
	'14-report-bad-evidenceid.json': 'result-report evidenceIds must be an array of E-NNNNNN ids',
	'15-report-empty-summary.json': 'result-report summary must be a non-empty string',
	'16-steering-missing-message.json': 'steering-relay payload must have exactly the keys',
	'17-claim-bad-action.json': 'resource-claim action must be one of',
	'18-claim-acquire-without-lease.json': 'resource-claim acquire requires leaseUntil',
	'19-claim-release-with-lease.json': 'requires leaseUntil null',
	'20-extra-payload-key.json': 'task-delegation payload must have exactly the keys',
	'21-extra-top-key.json': 'exactly the 9 keys',
	'22-delegation-empty-taskdescription.json': 'task-delegation taskDescription must be a non-empty string',
};

test('good.jsonl validates in BOTH validators and is byte-canonical on both sides', () => {
	const { lines, messages } = goodJournal();
	assert.equal(lines.length, 4, 'one message per kind');
	assert.deepEqual(messages.map(message => message.kind), ['task-delegation', 'steering-relay', 'result-report', 'resource-claim'], 'the delegation story in seq order');
	for (const [index, line] of lines.entries()) {
		const parsed = JSON.parse(line);
		const ts = validateA2aMessage(parsed);
		assert.equal(ts.id, messageIdOf(index + 1), `line ${index + 1} id derives from seq`);
		assert.equal(serializeA2aMessage(ts), line, 'TS serialization reproduces the journal bytes');
		const g = validateMessage(parsed);
		assert.ok(g.ok === true, `G validator accepts line ${index + 1}`);
		assert.equal(messageLine(g.message), line, 'G serialization reproduces the journal bytes');
	}
});

test('cursors-good.json is the drained end-state of the good journal', () => {
	const cursors = JSON.parse(readFileSync(join(FIXTURES, 'cursors-good.json'), { encoding: 'utf-8' }));
	assert.equal(cursors.$schema, A2A_CURSORS_SCHEMA);
	assert.deepEqual(cursors.cursors, { 'flauz.agent': 5, 'flauz.agent.worker-1': 5 }, 'both agents drained to journal high-water + 1');
});

test('every bad fixture is rejected by BOTH validators with its expected rule', () => {
	const files = readdirSync(join(FIXTURES, 'bad')).filter(name => name.endsWith('.json')).sort();
	assert.deepEqual(files, Object.keys(EXPECTED_RULES).sort(), 'fixture set and rule map are in lockstep (no untested fixtures, no dead rules)');
	for (const name of files) {
		const value = JSON.parse(readFileSync(join(FIXTURES, 'bad', name), { encoding: 'utf-8' }));
		const expected = EXPECTED_RULES[name];
		let tsError: unknown;
		try {
			validateA2aMessage(value);
		} catch (error) {
			tsError = error;
		}
		assert.ok(tsError instanceof Error, `${name}: TS validator must reject`);
		assert.ok((tsError as Error).message.includes(expected), `${name}: TS error must carry the rule (got: ${(tsError as Error).message})`);
		const g = validateMessage(value);
		assert.ok(g.ok === false, `${name}: G validator must reject`);
		assert.ok(g.error.includes(expected), `${name}: G error must carry the rule (got: ${g.error})`);
	}
});

test('G/TS parity: schema id, kind/outcome/action vocabularies, and id derivation agree', () => {
	assert.equal(A2A_SCHEMA, G_A2A_SCHEMA);
	assert.deepEqual([...A2A_MESSAGE_KINDS], MESSAGE_KINDS);
	assert.deepEqual([...A2A_REPORT_OUTCOMES], REPORT_OUTCOMES);
	assert.deepEqual([...A2A_CLAIM_ACTIONS], CLAIM_ACTIONS);
	for (const seq of [1, 2, 12, 123456]) {
		assert.equal(messageIdOf(seq), gMessageIdOf(seq), `id derivation agrees at seq ${seq}`);
	}
});

test('projectMailbox is the to-projection of the journal; knownAgents is sorted and complete', () => {
	const { messages } = goodJournal();
	const workerMail = projectMailbox(messages, 'flauz.agent.worker-1');
	assert.deepEqual(workerMail.map(message => message.kind), ['task-delegation', 'steering-relay'], 'the worker received the delegation and the steering');
	const parentMail = projectMailbox(messages, 'flauz.agent');
	assert.deepEqual(parentMail.map(message => message.kind), ['result-report', 'resource-claim'], 'the parent received the report and the claim notice');
	assert.deepEqual(projectMailbox(messages, 'flauz.agent.worker-2'), [], 'an unaddressed agent has an empty mailbox');
	assert.deepEqual(knownAgents(messages), ['flauz.agent', 'flauz.agent.worker-1']);
});

test('AgentMessenger posts the right typed shape through the port and speaks the cursor discipline', async () => {
	const posted: A2aMessageInput[] = [];
	const collected: Array<{ agentId: string; consume?: boolean }> = [];
	let nextSeq = 1;
	const port: A2aPort = {
		post: async input => {
			posted.push(input);
			const seq = nextSeq++;
			const message = {
				$schema: A2A_SCHEMA,
				seq,
				id: messageIdOf(seq),
				kind: input.kind,
				from: input.from,
				to: input.to,
				ts: input.ts ?? 0,
				inReplyTo: input.inReplyTo ?? null,
				payload: input.payload,
			} as A2aMessage;
			return { id: message.id, seq, message };
		},
		collect: async (agentId, consume) => {
			collected.push({ agentId, consume });
			return [];
		},
	};
	const messenger = new AgentMessenger({ self: 'flauz.agent', port, clock: () => 42 });
	const delegation = await messenger.delegate('flauz.agent.worker-1', { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review it.', workflowId: 'W-001' });
	assert.equal(delegation.id, 'M-000001');
	await messenger.reportBack('flauz.agent.worker-1', { taskId: 'T-001', outcome: 'ok', evidenceIds: ['E-000001'], summary: 'done' }, 'M-000001');
	await messenger.relaySteering('flauz.agent.worker-1', { taskId: 'T-001', message: 'focus' });
	await messenger.notifyClaim('flauz.agent.worker-1', { action: 'acquire', resource: '.flauz/artifacts/T-001/command-output-1.txt', leaseUntil: 1740000001000 });
	assert.deepEqual(posted.map(input => input.kind), ['task-delegation', 'result-report', 'steering-relay', 'resource-claim']);
	assert.ok(posted.every(input => input.from === 'flauz.agent'), 'every post speaks for self');
	assert.ok(posted.every(input => input.ts === 42), 'every post stamps the injected clock');
	assert.equal(posted[1]?.inReplyTo, 'M-000001', 'reportBack threads inReplyTo');
	assert.equal(posted[2]?.inReplyTo, undefined, 'relaySteering leaves inReplyTo unset (the bus defaults it to null)');
	await messenger.drain();
	await messenger.peek();
	assert.deepEqual(collected, [
		{ agentId: 'flauz.agent', consume: undefined },
		{ agentId: 'flauz.agent', consume: false },
	], 'drain consumes; peek does not');
});

test('AgentMessenger rejects an invalid self agent id up front', () => {
	assert.throws(() => new AgentMessenger({ self: 'not an agent id!', port: { post: async () => { throw new Error('unreachable'); }, collect: async () => [] } }), /invalid self agent id/);
});

test('optional keys are truly optional (regression: workflowId absent must validate)', () => {
	const minimal = {
		$schema: 'flauz.a2a/v0',
		seq: 7,
		id: 'M-000007',
		kind: 'task-delegation',
		from: 'flauz.agent',
		to: 'flauz.agent.worker-1',
		ts: 42,
		inReplyTo: null,
		payload: { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review it.' },
	};
	const ts = validateA2aMessage(minimal);
	assert.equal('workflowId' in ts.payload, false, 'TS: delegation without workflowId validates');

	const line = serializeA2aMessage(ts);
	const roundTrip = validateA2aMessage(JSON.parse(line));
	assert.ok('prompt' in roundTrip.payload && roundTrip.payload.prompt === minimal.payload.prompt, 'TS: canonical round-trip is lossless');
	const g = validateMessage(minimal);
	assert.ok(g.ok === true, `G: delegation without workflowId validates (got: ${g.ok === false ? g.error : 'ok'})`);
});
