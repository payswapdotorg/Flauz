/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Deterministic generator for the Wave-4 Lane K A2A-messaging fixtures at the
 * REPO-ROOT test/fixtures/workflow/a2a/.
 *
 * Run from the repo root:
 *
 *   node extensions/flauz-workflow/test/generateA2aFixtures.ts
 *
 * The good journal is produced by the REAL G-side bus (core/a2a.mjs A2ABus)
 * against a temp workspace, so every line is byte-canonical by construction;
 * inputs are fixed (deterministic ts values, fixed ids), so regeneration is
 * byte-identical - the committed fixtures ARE its output (receipt: two runs
 * -> identical sha256s, see REPORT VERIFICATION-RECEIPTS).
 *
 * Contents:
 *   - good.jsonl        four messages, one per kind, telling one delegation
 *                       story: parent flauz.agent delegates T-001 to worker
 *                       flauz.agent.worker-1 (the tree's own subagent example
 *                       task, 'Review package.json structure'), steers it
 *                       mid-run, the worker reports back with an evidence ref,
 *                       and acquires a lease on the artifact it produced.
 *   - cursors-good.json the matching delivery-cursor state (both agents fully
 *                       drained: cursor 5, i.e. journal high-water + 1).
 *   - bad/*.json        one violated validation rule per file (consumed by
 *                       extensions/flauz-workflow/test/messaging.test.ts with
 *                       an expected-rule map, rot-protected).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { A2ABus, messageLine } from '../../flauz-agent/core/a2a.mjs';

/** Repo-root fixture directory (this script's output home). */
const FIXTURE_ROOT = path.resolve(new URL('../../../test/fixtures/workflow/', import.meta.url).pathname);
const A2A_DIR = path.join(FIXTURE_ROOT, 'a2a');
const BAD_DIR = path.join(A2A_DIR, 'bad');

/** The good delegation story (fixed inputs - byte-stable regeneration). */
const GOOD_MESSAGES = [
	{
		kind: 'task-delegation',
		from: 'flauz.agent',
		to: 'flauz.agent.worker-1',
		ts: 1000,
		inReplyTo: null,
		payload: { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review the package.json structure and report the findings as evidence.', workflowId: 'W-001' },
	},
	{
		kind: 'steering-relay',
		from: 'flauz.agent',
		to: 'flauz.agent.worker-1',
		ts: 2000,
		inReplyTo: null,
		payload: { taskId: 'T-001', message: 'Focus on the dependency section only; skip scripts.' },
	},
	{
		kind: 'result-report',
		from: 'flauz.agent.worker-1',
		to: 'flauz.agent',
		ts: 3000,
		inReplyTo: 'M-000001',
		payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: ['E-000001'], summary: 'Dependency section reviewed; three findings recorded as command-output evidence.' },
	},
	{
		kind: 'resource-claim',
		from: 'flauz.agent.worker-1',
		to: 'flauz.agent',
		ts: 4000,
		inReplyTo: null,
		payload: { action: 'acquire', resource: '.flauz/artifacts/T-001/command-output-1.txt', leaseUntil: 1740000001000 },
	},
] as const;

/** Base good message every bad fixture derives from (one rule violated each). */
const BASE = {
	$schema: 'flauz.a2a/v0',
	seq: 1,
	id: 'M-000001',
	kind: 'task-delegation',
	from: 'flauz.agent',
	to: 'flauz.agent.worker-1',
	ts: 1000,
	inReplyTo: null,
	payload: { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review the package.json structure.', workflowId: 'W-001' },
} as const;

function variant(mutate: (base: Record<string, unknown>) => void): string {
	const copy = JSON.parse(JSON.stringify(BASE)) as Record<string, unknown>;
	mutate(copy);
	return `${JSON.stringify(copy, null, '\t')}\n`;
}

const BAD_FIXTURES: Record<string, string> = {
	'01-wrong-schema.json': variant(base => {
		base.$schema = 'flauz.a2a/v1';
	}),
	'02-bad-seq.json': variant(base => {
		base.seq = 0;
		base.id = 'M-000000';
	}),
	'03-id-seq-mismatch.json': variant(base => {
		base.id = 'M-000999';
	}),
	'04-unknown-kind.json': variant(base => {
		base.kind = 'gossip';
	}),
	'05-bad-from.json': variant(base => {
		base.from = '@not an agent!';
	}),
	'06-bad-to.json': variant(base => {
		base.to = 'has spaces';
	}),
	'07-self-send.json': variant(base => {
		base.to = 'flauz.agent';
	}),
	'08-bad-ts.json': variant(base => {
		base.ts = 'soon';
	}),
	'09-bad-inreplyto.json': variant(base => {
		base.inReplyTo = 'X-000001';
	}),
	'10-delegation-missing-prompt.json': variant(base => {
		delete (base.payload as Record<string, unknown>).prompt;
	}),
	'11-delegation-bad-taskid.json': variant(base => {
		(base.payload as Record<string, unknown>).taskId = 'T-1';
	}),
	'12-delegation-bad-workflowid.json': variant(base => {
		(base.payload as Record<string, unknown>).workflowId = 'W-1';
	}),
	'13-report-bad-outcome.json': variant(base => {
		base.kind = 'result-report';
		base.payload = { taskId: 'T-001', outcome: 'meh', evidenceIds: ['E-000001'], summary: 'partial' };
	}),
	'14-report-bad-evidenceid.json': variant(base => {
		base.kind = 'result-report';
		base.payload = { taskId: 'T-001', outcome: 'ok', evidenceIds: ['E-1'], summary: 'partial' };
	}),
	'15-report-empty-summary.json': variant(base => {
		base.kind = 'result-report';
		base.payload = { taskId: 'T-001', outcome: 'ok', evidenceIds: [], summary: '' };
	}),
	'16-steering-missing-message.json': variant(base => {
		base.kind = 'steering-relay';
		base.payload = { taskId: 'T-001' };
	}),
	'17-claim-bad-action.json': variant(base => {
		base.kind = 'resource-claim';
		base.payload = { action: 'steal', resource: 'file:///etc/hosts', leaseUntil: null };
	}),
	'18-claim-acquire-without-lease.json': variant(base => {
		base.kind = 'resource-claim';
		base.payload = { action: 'acquire', resource: 'file:///etc/hosts', leaseUntil: null };
	}),
	'19-claim-release-with-lease.json': variant(base => {
		base.kind = 'resource-claim';
		base.payload = { action: 'release', resource: 'file:///etc/hosts', leaseUntil: 1740000001000 };
	}),
	'20-extra-payload-key.json': variant(base => {
		(base.payload as Record<string, unknown>).priority = 'high';
	}),
	'21-extra-top-key.json': variant(base => {
		base.priority = 'high';
	}),
	'22-delegation-empty-taskdescription.json': variant(base => {
		(base.payload as Record<string, unknown>).taskDescription = '';
	}),
};

async function main(): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-a2a-fixtures-'));
	const bus = new A2ABus(root);
	for (const message of GOOD_MESSAGES) {
		bus.post({ message: { ...message } });
	}
	// Drain both mailboxes so the committed cursor state is 'everything delivered'.
	bus.collect({ agentId: 'flauz.agent' });
	bus.collect({ agentId: 'flauz.agent.worker-1' });

	await fs.mkdir(A2A_DIR, { recursive: true });
	await fs.mkdir(BAD_DIR, { recursive: true });
	const journal = await fs.readFile(path.join(root, '.flauz/a2a/messages.jsonl'), { encoding: 'utf-8' });
	await fs.writeFile(path.join(A2A_DIR, 'good.jsonl'), journal);
	const cursors = await fs.readFile(path.join(root, '.flauz/a2a/cursors.json'), { encoding: 'utf-8' });
	await fs.writeFile(path.join(A2A_DIR, 'cursors-good.json'), `${JSON.stringify(JSON.parse(cursors), null, '\t')}\n`);
	for (const [name, contents] of Object.entries(BAD_FIXTURES)) {
		await fs.writeFile(path.join(BAD_DIR, name), contents);
	}
	// Canonicality receipt on stderr for the run log.
	const lines = journal.split('\n').filter(line => line.length > 0);
	for (const [index, line] of lines.entries()) {
		const parsed = JSON.parse(line) as Record<string, unknown>;
		if (line !== messageLine(parsed as never)) {
			throw new Error(`generator bug: line ${String(index + 1)} is not canonical`);
		}
	}
	console.log(`flauz a2a fixtures: ${String(lines.length)} good lines + ${String(Object.keys(BAD_FIXTURES).length)} bad fixtures -> ${A2A_DIR}`);
	await fs.rm(root, { recursive: true, force: true });
}

await main();
