/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Fixture-matrix test: consumes test/fixtures/memory/ - every GOOD fixture
 * validates against the real validators, every BAD fixture is rejected with
 * the expected rule (a gate that cannot fail is not a gate). Rot protection:
 * if a fixture stops exercising its rule, this suite fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMemoryIndex, validateMemoryRecord, validatePromotionRecord, validateShareRecord } from '../src/api.ts';

const FIXTURES = new URL('../../../test/fixtures/memory/', import.meta.url).pathname;

/** One entry per bad fixture: the substring its validation error must carry. */
const EXPECTED_RULES: Record<string, { validate: (value: unknown) => unknown; rule: string }> = {
	'01-record-extra-key.json': { validate: validateMemoryRecord, rule: 'expected exactly the keys' },
	'02-record-bad-id.json': { validate: validateMemoryRecord, rule: 'id must match' },
	'03-record-id-journal-mismatch.json': { validate: validateMemoryRecord, rule: 'does not match its tier' },
	'04-record-bad-tier.json': { validate: validateMemoryRecord, rule: 'tier must be one of session|task|project' },
	'05-record-bad-kind.json': { validate: validateMemoryRecord, rule: 'kind must be one of' },
	'06-record-empty-content.json': { validate: validateMemoryRecord, rule: 'content must be a non-empty string' },
	'07-record-bad-tag.json': { validate: validateMemoryRecord, rule: 'tags must be an array of' },
	'08-record-pinned-not-bool.json': { validate: validateMemoryRecord, rule: 'pinned must be a boolean' },
	'09-record-session-no-agent.json': { validate: validateMemoryRecord, rule: 'session tier is the LIVE task tier' },
	'10-record-task-no-taskid.json': { validate: validateMemoryRecord, rule: 'task tier requires taskId' },
	'11-record-project-with-taskid.json': { validate: validateMemoryRecord, rule: 'project tier is cross-task' },
	'12-record-authorization-origin.json': { validate: validateMemoryRecord, rule: 'authorization-bearing records may only be minted' },
	'13-record-ledger-row-no-evidence.json': { validate: validateMemoryRecord, rule: "origin 'ledger-row' requires the evidence row" },
	'14-record-bad-content-hash.json': { validate: validateMemoryRecord, rule: 'contentHash must be 64 lowercase hex chars' },
	'15-record-provenance-extra-key.json': { validate: validateMemoryRecord, rule: 'provenance must have exactly the keys' },
	'16-promotion-bad-action.json': { validate: validatePromotionRecord, rule: 'action must be one of' },
	'17-promotion-no-result.json': { validate: validatePromotionRecord, rule: 'requires recordId AND resultRecordId' },
	'18-promotion-compact-no-drops.json': { validate: validatePromotionRecord, rule: 'compact must list the droppedRecordIds' },
	'19-promotion-empty-reason.json': { validate: validatePromotionRecord, rule: 'reason must be a non-empty string' },
	'20-share-self.json': { validate: validateShareRecord, rule: 'fromAgent and toAgent must differ' },
	'21-share-bad-action.json': { validate: validateShareRecord, rule: 'action must be one of' },
	'22-index-wrong-schema.json': { validate: validateMemoryIndex, rule: '$schema must be' },
	'23-index-unregistered-task.json': { validate: validateMemoryIndex, rule: 'not in the journals registry' },
	'24-index-bad-tokens.json': { validate: validateMemoryIndex, rule: 'tokens must be a positive integer' },
};

test('record-good.json validates as a flauz.memory/v1 record', () => {
	const record = validateMemoryRecord(JSON.parse(readFileSync(join(FIXTURES, 'record-good.json'), { encoding: 'utf-8' })));
	assert.equal(record.id, 'MEM-S-000001');
	assert.equal(record.tier, 'session');
});

test('promotion-good.json validates as a promotion record', () => {
	const promotion = validatePromotionRecord(JSON.parse(readFileSync(join(FIXTURES, 'promotion-good.json'), { encoding: 'utf-8' })));
	assert.equal(promotion.action, 'promote');
	assert.equal(promotion.resultRecordId, 'MEM-T-001-000001');
});

test('share-good.json validates as a share record', () => {
	const share = validateShareRecord(JSON.parse(readFileSync(join(FIXTURES, 'share-good.json'), { encoding: 'utf-8' })));
	assert.equal(share.action, 'grant');
});

test('index-good.json validates as a flauz.memory.index/v1 envelope', () => {
	const index = validateMemoryIndex(JSON.parse(readFileSync(join(FIXTURES, 'index-good.json'), { encoding: 'utf-8' })));
	assert.equal(index.journals.length, 3);
	assert.equal(index.entries.length, 1);
});

test('every bad fixture is rejected with its expected rule', () => {
	const files = readdirSync(join(FIXTURES, 'bad')).filter(name => name.endsWith('.json')).sort();
	assert.deepEqual(files, Object.keys(EXPECTED_RULES).sort());
	for (const [name, expected] of Object.entries(EXPECTED_RULES)) {
		const raw = readFileSync(join(FIXTURES, 'bad', name), { encoding: 'utf-8' });
		assert.throws(
			() => expected.validate(JSON.parse(raw)),
			new RegExp(expected.rule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
			`fixture ${name} must be rejected with rule '${expected.rule}'`,
		);
	}
});
