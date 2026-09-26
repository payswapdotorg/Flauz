/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Wave 4 Lane K, M4 - AHP trigger-mapping tests.
 *
 * Coverage:
 *   - the AHP five-field cron grammar: the tree-documented shapes accepted
 *     (steps on '*', ranges, lists, ASCII month/day names, day 7 = Sunday),
 *     and the tree-documented rejections (field count, seconds, macros,
 *     Quartz extensions, out-of-range bounds, inverted ranges, steps on
 *     single values, '*' as a list element, lowercase names = accepted);
 *   - fragment -> AutomationDefinitionDraft mapping (title, message text =
 *     plan prompt, session = model attribution, enabled default, the
 *     flauz.workflow _meta binding with the rerun recipe);
 *   - authoring gates: duplicate/empty trigger ids, empty time zone, invalid
 *     expression surfacing with the trigger id;
 *   - emission drafts: automationCreateAction scheme gate, the deterministic
 *     workflowRunRequestId idempotency key, runAutomationRequest shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateWorkflowFragment } from '../src/envelope.ts';
import {
	validateCronExpression,
	isCronExpression,
	automationFromFragment,
	automationCreateAction,
	workflowRunRequestId,
	runAutomationRequest,
} from '../src/triggers.ts';

const FIXTURES = new URL('../../../test/fixtures/workflow/', import.meta.url).pathname;

function goodFragment() {
	return validateWorkflowFragment(JSON.parse(readFileSync(join(FIXTURES, 'workflow-good.json'), { encoding: 'utf-8' })));
}

test('cron: the tree-documented expression shapes validate', () => {
	const accepted = [
		'30 9 * * 1-5',            // the AutomationSchedule doc example: 09:30 every weekday
		'*/15 * * * *',            // step on '*'
		'1-30/2 * * * *',          // step on a range
		'0 0 1 1 *',               // single values
		'1,3,8-10 * * * *',        // list of values and ranges
		'0 22 * * 1-5',            // range in day of week
		'0 0 25 12 *',             // day of month + month
		'0 0 * JAN-DEC *',         // ASCII month names
		'0 12 * * MON-FRI',        // ASCII day names
		'0 12 * * mon-fri',        // case-insensitive
		'0 0 * * SUN',             // day name
		'0 0 * * 7',               // numeric 7 also means Sunday
		'59 23 31 12 FRI',         // boundary values everywhere
	];
	for (const expression of accepted) {
		const verdict = validateCronExpression(expression);
		assert.equal(verdict.ok, true, `${expression} must validate (got: ${verdict.error ?? ''})`);
		assert.equal(verdict.fields?.length, 5, `${expression} normalizes into 5 field lists`);
	}
	assert.equal(isCronExpression('30 9 * * 1-5'), true);
});

test('cron: malformed expressions are rejected with the tree rule', () => {
	const rejected: Array<[string, string]> = [
		['30 9 * * 1-5 *', 'exactly 5 fields'],
		['30 9 * *', 'exactly 5 fields'],
		['* * * * * *', 'exactly 5 fields'],
		['@daily * * * *', "macros such as '@daily'"],
		['*/15 * * * * *', 'exactly 5 fields'],
		['0 12 ? * *', "Quartz extension '?'"],
		['0 12 L * *', "Quartz extension 'L'"],
		['0 12 15 W *', "Quartz extension 'W'"],
		['0 12 * * 5#2', "Quartz extension '#'"],
		['60 * * * *', 'out of range 0-59'],
		['* 24 * * *', 'out of range 0-23'],
		['* * 0 * *', 'out of range 1-31'],
		['* * 32 * *', 'out of range 1-31'],
		['* * * 0 *', 'out of range 1-12'],
		['* * * 13 *', 'out of range 1-12'],
		['* * * * 8', 'out of range 0-7'],
		['5-3 * * * *', 'start must not exceed its end'],
		['*/0 * * * *', "stands alone or as '*/<step>'"],
		['1/2 * * * *', "applied to '*' or a range"],
		['1,* * * * *', 'is not a value'],
		['*-5 * * * *', "stands alone"],
		['1-2/3/4 * * * *', "at most one step"],
		['1-2-3 * * * *', 'at most one range dash'],
		['* FEBX * * *', 'is not a value'],
		['', 'non-empty string'],
	];
	for (const [expression, rule] of rejected) {
		const verdict = validateCronExpression(expression);
		assert.equal(verdict.ok, false, `${JSON.stringify(expression)} must be rejected`);
		assert.ok(verdict.error !== undefined && verdict.error.includes(rule), `${JSON.stringify(expression)} error must carry '${rule}' (got: ${verdict.error})`);
	}
	assert.equal(isCronExpression('nope'), false);
});

test('automationFromFragment maps the fragment onto the AHP definition grammar', () => {
	const fragment = goodFragment();
	const draft = automationFromFragment(fragment, {
		schedules: [
			{ id: 'weekday-morning', expression: '30 9 * * 1-5', timeZone: 'UTC' },
			{ id: 'weekly-audit', expression: '0 6 * * MON', timeZone: 'Europe/Berlin', misfirePolicy: 'skip' },
		],
	});
	assert.equal(draft.title, `W-001: ${fragment.title}`);
	assert.deepEqual(draft.message, { origin: 'automation', text: fragment.plan.prompt }, 'the run session receives the plan prompt; origin kind is automation per the tree rule');
	assert.deepEqual(draft.session, { provider: fragment.model.provider, model: { id: fragment.model.model } });
	assert.equal(draft.enabled, true, 'enabled defaults to true');
	assert.equal(draft.triggers.length, 2);
	assert.deepEqual(draft.triggers[0], { id: 'weekday-morning', kind: 'schedule', schedule: { expression: '30 9 * * 1-5', timeZone: 'UTC' } }, 'omitted misfirePolicy stays omitted (tree: omission = runOnce)');
	assert.deepEqual(draft.triggers[1], { id: 'weekly-audit', kind: 'schedule', schedule: { expression: '0 6 * * MON', timeZone: 'Europe/Berlin' }, misfirePolicy: 'skip' });
	assert.deepEqual(draft._meta, {
		'flauz.workflow': {
			$schema: 'flauz.workflows/v1',
			id: 'W-001',
			rerun: { approvals: fragment.rerun.approvals },
		},
	}, '_meta binds the automation back to the fragment (host-opaque, Flauz-owned key)');
});

test('automationFromFragment: enabled=false and zero schedules (manual-only automation)', () => {
	const fragment = goodFragment();
	const manual = automationFromFragment(fragment, { schedules: [], enabled: false });
	assert.equal(manual.enabled, false);
	assert.deepEqual(manual.triggers, [], 'an empty trigger list means manual-only (tree rule)');
});

test('automationFromFragment gates authoring errors', () => {
	const fragment = goodFragment();
	assert.throws(() => automationFromFragment(fragment, {
		schedules: [
			{ id: 'a', expression: '30 9 * * 1-5', timeZone: 'UTC' },
			{ id: 'a', expression: '0 6 * * MON', timeZone: 'UTC' },
		],
	}), /duplicate schedule trigger id 'a'/);
	assert.throws(() => automationFromFragment(fragment, { schedules: [{ id: '', expression: '* * * * *', timeZone: 'UTC' }] }), /non-empty id/);
	assert.throws(() => automationFromFragment(fragment, { schedules: [{ id: 'a', expression: '* * * * *', timeZone: '' }] }), /non-empty IANA time zone/);
	assert.throws(() => automationFromFragment(fragment, { schedules: [{ id: 'a', expression: 'nope', timeZone: 'UTC' }] }), /schedule 'a' has an invalid AHP cron expression/);
	assert.throws(() => automationFromFragment(fragment, { schedules: [{ id: 'a', expression: '* * * * * *', timeZone: 'UTC' }] }), /schedule 'a'.*exactly 5 fields/);
});

test('emission drafts: create action, idempotency key, run request', () => {
	const fragment = goodFragment();
	const draft = automationFromFragment(fragment, { schedules: [{ id: 'daily', expression: '0 9 * * *', timeZone: 'UTC' }] });
	const create = automationCreateAction('ahp-automation:flauz-w001', draft);
	assert.deepEqual(create, { type: 'automation/createRequested', resource: 'ahp-automation:flauz-w001', definition: draft });
	assert.throws(() => automationCreateAction('flauz-automation:w001', draft), /must use the ahp-automation: scheme/);

	assert.equal(workflowRunRequestId('W-001', 1), 'flauz.workflow/W-001/run/1');
	assert.equal(workflowRunRequestId('W-001', 1), 'flauz.workflow/W-001/run/1', 'deterministic: same fragment + attempt = same idempotency key');
	assert.equal(workflowRunRequestId('W-001', 2), 'flauz.workflow/W-001/run/2');
	assert.throws(() => workflowRunRequestId('X-1', 1), /fragment id must match/);
	assert.throws(() => workflowRunRequestId('W-001', 0), /positive integer/);

	assert.deepEqual(runAutomationRequest('ahp-automation:flauz-w001', workflowRunRequestId('W-001', 1)), {
		channel: 'ahp-automations://',
		automation: 'ahp-automation:flauz-w001',
		requestId: 'flauz.workflow/W-001/run/1',
	}, 'RunAutomationParams shape (channel + automation + requestId)');
	assert.throws(() => runAutomationRequest('not-a-uri', 'x'), /ahp-automation: URI/);
	assert.throws(() => runAutomationRequest('ahp-automation:flauz-w001', ''), /non-empty string/);
});
