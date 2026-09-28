/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Deterministic generator for the flauz-memory fixtures at the repo-root
 * test/fixtures/memory/ (TL2-003 M1).
 *
 * Run from the repo root:
 *
 *   node extensions/flauz-memory/test/generateMemoryFixtures.ts
 *
 * The GOOD fixtures are valid shapes by construction (typed literals below);
 * every BAD fixture violates exactly one validation rule (consumed by
 * extensions/flauz-memory/test/fixtures.test.ts with an expected-rule map,
 * rot-protected). Inputs are fixed, so regeneration is byte-identical.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const FIXTURE_ROOT = path.resolve(new URL('../../../test/fixtures/memory/', import.meta.url).pathname);

const GOOD_RECORD = {
	id: 'MEM-S-000001',
	tier: 'session',
	taskId: 'T-001',
	agentId: 'flauz.agent',
	kind: 'observation',
	content: 'build passes on node 24',
	tags: ['build', 'ci'],
	pinned: false,
	timing: { created: 1_740_000_000_000, updatedAt: 1_740_000_000_000 },
	provenance: {
		actor: 'agent',
		origin: 'task-event',
		contentHash: '1111111111111111111111111111111111111111111111111111111111111111',
		ts: 1_740_000_000_000,
		evidenceId: null,
	},
};

const GOOD_PROMOTION = {
	id: 'P-000001',
	action: 'promote',
	ts: 1_740_000_000_000,
	actor: 'agent',
	humanApproved: false,
	recordId: 'MEM-S-000001',
	resultRecordId: 'MEM-T-001-000001',
	journal: null,
	fromTier: 'session',
	toTier: 'task',
	reason: 'task ended - persist the finding',
	droppedRecordIds: [],
};

const GOOD_SHARE = {
	id: 'SH-000001',
	action: 'grant',
	recordId: 'MEM-T-001-000001',
	fromAgent: 'flauz.agent.worker-1',
	toAgent: 'flauz.agent',
	actor: 'agent',
	ts: 1_740_000_000_000,
	reason: 'parent needs the finding',
};

const GOOD_INDEX = {
	$schema: 'flauz.memory.index/v1',
	journals: ['P', 'S', 'T-001'],
	entries: [
		{
			id: 'MEM-T-001-000001',
			tier: 'task',
			taskId: 'T-001',
			agentId: null,
			kind: 'summary',
			tags: ['build'],
			tokens: 5,
			created: 1_740_000_000_000,
			updatedAt: 1_740_000_000_000,
			pinned: false,
			evidenceId: null,
		},
	],
	generatedAt: 1_740_000_000_000,
};

type Mutation = { name: string; mutate: (value: Record<string, unknown>) => void };

const RECORD_MUTATIONS: Mutation[] = [
	{ name: '01-record-extra-key.json', mutate: v => { v.extra = 'no'; } },
	{ name: '02-record-bad-id.json', mutate: v => { v.id = 'MEM-9-000001'; } },
	{ name: '03-record-id-journal-mismatch.json', mutate: v => { v.id = 'MEM-P-000001'; } },
	{ name: '04-record-bad-tier.json', mutate: v => { v.tier = 'ephemeral'; } },
	{ name: '05-record-bad-kind.json', mutate: v => { v.kind = 'vibe'; } },
	{ name: '06-record-empty-content.json', mutate: v => { v.content = ''; } },
	{ name: '07-record-bad-tag.json', mutate: v => { v.tags = ['Build!']; } },
	{ name: '08-record-pinned-not-bool.json', mutate: v => { v.pinned = 'yes'; } },
	{ name: '09-record-session-no-agent.json', mutate: v => { v.agentId = null; } },
	{ name: '10-record-task-no-taskid.json', mutate: v => { v.tier = 'task'; v.id = 'MEM-T-001-000001'; v.agentId = null; v.taskId = null; } },
	{ name: '11-record-project-with-taskid.json', mutate: v => { v.tier = 'project'; v.id = 'MEM-P-000001'; v.agentId = null; } },
	{ name: '12-record-authorization-origin.json', mutate: v => { v.kind = 'authorization'; v.provenance = { ...v.provenance as object, origin: 'human-note' }; } },
	{ name: '13-record-ledger-row-no-evidence.json', mutate: v => { v.provenance = { ...v.provenance as object, origin: 'ledger-row' }; } },
	{ name: '14-record-bad-content-hash.json', mutate: v => { v.provenance = { ...v.provenance as object, contentHash: 'zzzz' }; } },
	{ name: '15-record-provenance-extra-key.json', mutate: v => { v.provenance = { ...v.provenance as object, extra: 1 }; } },
];

const PROMOTION_MUTATIONS: Mutation[] = [
	{ name: '16-promotion-bad-action.json', mutate: v => { v.action = 'teleport'; } },
	{ name: '17-promotion-no-result.json', mutate: v => { v.resultRecordId = null; } },
	{ name: '18-promotion-compact-no-drops.json', mutate: v => { v.action = 'compact'; v.recordId = null; v.resultRecordId = null; v.journal = 'session'; v.fromTier = null; v.toTier = null; v.droppedRecordIds = []; } },
	{ name: '19-promotion-empty-reason.json', mutate: v => { v.reason = ''; } },
];

const SHARE_MUTATIONS: Mutation[] = [
	{ name: '20-share-self.json', mutate: v => { v.toAgent = 'flauz.agent.worker-1'; } },
	{ name: '21-share-bad-action.json', mutate: v => { v.action = 'lend'; } },
];

const INDEX_MUTATIONS: Mutation[] = [
	{ name: '22-index-wrong-schema.json', mutate: v => { v.$schema = 'flauz.memory/v0'; } },
	{ name: '23-index-unregistered-task.json', mutate: v => { v.journals = ['P', 'S']; } },
	{ name: '24-index-bad-tokens.json', mutate: v => { (v.entries as Array<{ tokens: number }>)[0].tokens = 0; } },
];

async function writeJson(relative: string, value: unknown): Promise<void> {
	const target = path.join(FIXTURE_ROOT, relative);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, `${JSON.stringify(value, null, '\t')}\n`);
}

async function main(): Promise<void> {
	await writeJson('record-good.json', GOOD_RECORD);
	await writeJson('promotion-good.json', GOOD_PROMOTION);
	await writeJson('share-good.json', GOOD_SHARE);
	await writeJson('index-good.json', GOOD_INDEX);
	for (const mutation of [...RECORD_MUTATIONS, ...PROMOTION_MUTATIONS, ...SHARE_MUTATIONS, ...INDEX_MUTATIONS]) {
		const value = JSON.parse(JSON.stringify(mutation.name.startsWith('16') || mutation.name.startsWith('17') || mutation.name.startsWith('18') || mutation.name.startsWith('19') ? GOOD_PROMOTION : mutation.name.startsWith('20') || mutation.name.startsWith('21') ? GOOD_SHARE : mutation.name.startsWith('22') || mutation.name.startsWith('23') || mutation.name.startsWith('24') ? GOOD_INDEX : GOOD_RECORD));
		mutation.mutate(value);
		await writeJson(`bad/${mutation.name}`, value);
	}
	console.log(`flauz-memory fixtures written to ${FIXTURE_ROOT}`);
}

await main();
