/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Fixture-matrix test: consumes test/fixtures/workflow/ - every GOOD fixture
 * validates against the real validators, every BAD fixture is rejected with
 * the expected rule (a gate that cannot fail is not a gate). Rot protection:
 * if a fixture stops exercising its rule, this suite fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkflowFragment } from '../src/envelope.ts';
import { validateEnvelope } from '../../flauz-workspace/src/taskService.ts';

const FIXTURES = new URL('../../../test/fixtures/workflow/', import.meta.url).pathname;

/** One entry per bad fixture: the substring its validation error must carry. */
const EXPECTED_RULES: Record<string, string> = {
	'01-wrong-schema.json': '$schema must be',
	'02-bad-id.json': 'id must match',
	'03-empty-title.json': 'title must be a non-empty string',
	'04-bad-source-taskid.json': 'taskId must match',
	'05-bad-source-evidenceid.json': 'evidenceIds[0] must match',
	'06-noninteger-createdat.json': 'createdAt must be a positive integer',
	'07-empty-plan-text.json': 'plan.text must be a non-empty string',
	'08-missing-plan-key.json': 'plan must have exactly the keys',
	'09-empty-provider.json': 'model.provider must be a non-empty string',
	'10-params-not-object.json': 'model.params must be a plain object',
	'11-tool-approval-mode.json': "approval must be 'recorded' or 'ask'",
	'12-tool-outcome.json': "outcome must be 'ok' or 'failed'",
	'13-tool-seq-gap.json': 'tool seq must be contiguous from 1',
	'14-tool-evidenceid.json': 'evidenceId must match',
	'15-approval-type.json': "type must be 'approve' or 'request-changes'",
	'16-evidence-kind.json': 'kind must be one of changeset|screenshot|command-output|note',
	'17-evidence-sha256.json': 'sha256 must be 64 lowercase hex chars',
	'18-evidence-derivedfrom.json': 'derivedFrom must match',
	'19-rerun-mode.json': "rerun.approvals must be 'replay' or 'ask'",
	'20-extra-top-key.json': 'expected exactly the keys',
	'21-history-taskid.json': 'taskId must match',
};

test('envelope-good.json validates as a flauz.tasks/v0 envelope', () => {
	const envelope = validateEnvelope(JSON.parse(readFileSync(join(FIXTURES, 'envelope-good.json'), { encoding: 'utf-8' })));
	assert.equal(envelope.$schema, 'flauz.tasks/v0');
	assert.equal(envelope.tasks.length, 1);
	assert.equal(envelope.tasks[0]?.status, 'done');
});

test('workflow-good.json validates as a flauz.workflows/v1 fragment', () => {
	const fragment = validateWorkflowFragment(JSON.parse(readFileSync(join(FIXTURES, 'workflow-good.json'), { encoding: 'utf-8' })));
	assert.equal(fragment.id, 'W-001');
	assert.equal(fragment.tools.length, 1);
	assert.equal(fragment.source.taskId, 'T-001');
});

test('every bad fixture is rejected with its expected rule', () => {
	const files = readdirSync(join(FIXTURES, 'bad')).filter(name => name.endsWith('.json')).sort();
	assert.deepEqual(files, Object.keys(EXPECTED_RULES).sort());
	for (const [name, expected] of Object.entries(EXPECTED_RULES)) {
		const raw = readFileSync(join(FIXTURES, 'bad', name), { encoding: 'utf-8' });
		assert.throws(
			() => validateWorkflowFragment(JSON.parse(raw)),
			new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
			`fixture ${name} must be rejected with rule '${expected}'`,
		);
	}
});
