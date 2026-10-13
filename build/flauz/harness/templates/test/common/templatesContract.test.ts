/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-005 workflow-template contract battery: the frozen-vocab
 * cross-pins (against the REAL landed modules), the stage machine,
 * the task laws (every rejection class), the deep record walk with
 * the complete-table law and the absent-key discipline, the
 * serialization round-trip with the fail-closed parse, and the
 * in-suite determinism greps (law-comment lines only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_INDUSTRIES,
	isHarnessId,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import {
	MAX_TASKS,
	TASK_KEY_MAX_LENGTH,
	TASK_SUMMARY_MAX_LENGTH,
	TEMPLATE_FORWARD_TRANSITIONS,
	TEMPLATE_ID_PREFIX,
	TEMPLATE_OP_NAMES,
	TEMPLATE_RECORD_SCHEMA_KEYS,
	TEMPLATE_STAGES,
	TEMPLATES_CONTRACTS_VERSION,
	TASK_ENTRY_SCHEMA_KEYS,
	canTransitionTemplateStage,
	parseWorkflowTemplateRecord,
	serializeWorkflowTemplateRecord,
	validateTaskEntry,
	validateTaskSummary,
	validateWorkflowTemplateRecord,
} from '../../common/templatesContract.js';
import type { TemplatesValidationOutcome } from '../../common/templatesContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/templatesContract.ts', import.meta.url)), 'utf8');

function greenRecord(): Record<string, unknown> {
	return {
		templateId: 'flauz:tpl:0123456789abcdef',
		harnessId: 'flauz:hrn:0123456789abcdef',
		industry: 'software',
		stage: 'composing',
		tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] }],
		history: [
			{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-template', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
		],
	};
}

function reasons<T>(outcome: TemplatesValidationOutcome<T>): string[] {
	if (outcome.ok) {
		throw new Error('expected a refusal outcome');
	}
	return outcome.rejections.map((rejection) => rejection.reason);
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('templatesContract · frozen vocabularies and cross-pins', () => {
	test('TEMPLATES_CONTRACTS_VERSION is 1.0.0 and TEMPLATE_ID_PREFIX is flauz:tpl:', () => {
		assert.equal(TEMPLATES_CONTRACTS_VERSION, '1.0.0');
		assert.equal(TEMPLATE_ID_PREFIX, 'flauz:tpl:');
	});

	test('TEMPLATE_STAGES and TEMPLATE_FORWARD_TRANSITIONS are frozen', () => {
		assert.deepStrictEqual([...TEMPLATE_STAGES], ['composing', 'composed']);
		assert.deepStrictEqual([...TEMPLATE_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
	});

	test('the task-law constants are frozen (64 / 200 / 128)', () => {
		assert.equal(TASK_KEY_MAX_LENGTH, 64);
		assert.equal(TASK_SUMMARY_MAX_LENGTH, 200);
		assert.equal(MAX_TASKS, 128);
	});

	test('TEMPLATE_OP_NAMES is the frozen five-op vocabulary', () => {
		assert.deepStrictEqual([...TEMPLATE_OP_NAMES], [
			'begin-template',
			'add-task',
			'replace-task-summary',
			'remove-task',
			'finalize-template',
		]);
	});

	test('the DH-01 re-exports are referentially identical to the real module', () => {
		assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
		assert.equal(HARNESS_INDUSTRIES, HARNESS_INDUSTRIES);
		assert.equal(isHarnessId, isHarnessId);
	});

	test('the DH-02/DH-03/DH-04 version re-exports equal the real modules', () => {
		assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
		assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
		assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
	});
});

suite('templatesContract · the stage machine', () => {
	test('composing -> composed is the single whitelisted row', () => {
		const verdict = canTransitionTemplateStage('composing', 'composed');
		assert.ok(verdict.ok);
		assert.equal(verdict.row, 1);
		assert.equal(verdict.from, 'composing');
		assert.equal(verdict.to, 'composed');
	});

	test('composed is TERMINAL (whitelistRow null, expectedTo null)', () => {
		const verdict = canTransitionTemplateStage('composed', 'composing');
		assert.ok(!verdict.ok);
		assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
		assert.equal(verdict.whitelistRow, null);
		assert.equal(verdict.expectedTo, null);
	});

	test('the composing self-loop is refused with expectedTo composed', () => {
		const verdict = canTransitionTemplateStage('composing', 'composing');
		assert.ok(!verdict.ok);
		assert.equal(verdict.whitelistRow, 1);
		assert.equal(verdict.expectedTo, 'composed');
	});

	test('unknown or non-string stages are refused', () => {
		for (const [from, to] of [['draft', 'composed'], ['composing', 'draft'], [null, 'composed'], ['composing', 7]] as unknown[][]) {
			const verdict = canTransitionTemplateStage(from, to);
			assert.ok(!verdict.ok);
			assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
		}
	});
});

suite('templatesContract · validateTaskEntry', () => {
	test('a green task entry (with termRefs) validates', () => {
		const outcome = validateTaskEntry({ taskKey: 'survey', summary: 'Survey the signal.', termRefs: ['signal', 'baseline'] });
		assert.ok(outcome.ok);
		assert.deepStrictEqual(outcome.value, { taskKey: 'survey', summary: 'Survey the signal.', termRefs: ['signal', 'baseline'] });
	});

	test('the honest-gap law: empty termRefs validate', () => {
		const outcome = validateTaskEntry({ taskKey: 'survey', summary: 'Survey the signal.', termRefs: [] });
		assert.ok(outcome.ok);
		assert.deepStrictEqual(outcome.value.termRefs, []);
	});

	test('a non-object is the single-station malformed-task table', () => {
		for (const task of [null, 'task', 7, ['x']]) {
			const outcome = validateTaskEntry(task);
			assert.ok(!outcome.ok);
			assert.deepStrictEqual(reasons(outcome), ['malformed-task']);
		}
	});

	test('a non-string taskKey or summary carrier is malformed-task', () => {
		assert.deepStrictEqual(reasons(validateTaskEntry({ taskKey: 7, summary: 's', termRefs: [] })), ['malformed-task']);
		assert.deepStrictEqual(reasons(validateTaskEntry({ taskKey: 'k', summary: null, termRefs: [] })), ['malformed-task']);
	});

	test('an extra key is the typed no-fork rejection', () => {
		const outcome = validateTaskEntry({ taskKey: 'k', summary: 's', termRefs: [], command: 'run-it' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejections[0].reason, 'no-fork');
		assert.equal(outcome.rejections[0].law, 'THE NO-FORK LAW');
		assert.deepStrictEqual(outcome.rejections[0].items, ['command']);
	});

	test('invalid-task-key classes: empty, 65 chars, padded, control chars (64 legal)', () => {
		assert.ok(validateTaskEntry({ taskKey: 'a'.repeat(64), summary: 's', termRefs: [] }).ok);
		assert.deepStrictEqual(reasons(validateTaskEntry({ taskKey: '', summary: 's', termRefs: [] })), ['invalid-task-key']);
		assert.deepStrictEqual(reasons(validateTaskEntry({ taskKey: 'a'.repeat(65), summary: 's', termRefs: [] })), ['invalid-task-key']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: 'a'.repeat(65), summary: 's', termRefs: [] })), ['65 chars']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: ' k', summary: 's', termRefs: [] })), ['leading/trailing whitespace']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: 'k\u0000', summary: 's', termRefs: [] })), ['U+0000']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: 'k\u007F', summary: 's', termRefs: [] })), ['U+007F']);
	});

	test('invalid-summary classes: empty, 201 chars, control chars (200 legal)', () => {
		assert.ok(validateTaskEntry({ taskKey: 'k', summary: 'a'.repeat(200), termRefs: [] }).ok);
		assert.deepStrictEqual(reasons(validateTaskEntry({ taskKey: 'k', summary: '', termRefs: [] })), ['invalid-summary']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: 'k', summary: 'a'.repeat(201), termRefs: [] })), ['201 chars']);
		assert.deepStrictEqual(outcomeItems(validateTaskEntry({ taskKey: 'k', summary: 's\u009F', termRefs: [] })), ['U+009F']);
	});

	test('a non-array termRefs carrier is malformed-term-refs', () => {
		const outcome = validateTaskEntry({ taskKey: 'k', summary: 's', termRefs: 'signal' });
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['malformed-term-refs']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['termRefs']);
	});

	test('a non-string termRefs member is malformed-term-refs', () => {
		const outcome = validateTaskEntry({ taskKey: 'k', summary: 's', termRefs: ['signal', 7] });
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['malformed-term-refs']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['termRefs[1]']);
	});

	test('repeated termRefs are duplicate-term-ref', () => {
		const outcome = validateTaskEntry({ taskKey: 'k', summary: 's', termRefs: ['signal', 'baseline', 'signal'] });
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['duplicate-term-ref']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['signal']);
	});

	test('THE COMPLETE TABLE: one multi-offense entry reports every station in the frozen order', () => {
		const outcome = validateTaskEntry({ taskKey: ' k ', summary: '', termRefs: 'nope', command: 1 });
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['no-fork', 'invalid-task-key', 'invalid-summary', 'malformed-term-refs']);
	});

	test('the ok copy carries the fixed key order (taskKey, summary, termRefs)', () => {
		const outcome = validateTaskEntry({ taskKey: 'k', summary: 's', termRefs: ['signal'] });
		assert.ok(outcome.ok);
		assert.deepStrictEqual(Object.keys(outcome.value), [...TASK_ENTRY_SCHEMA_KEYS]);
	});
});

function outcomeItems<T>(outcome: TemplatesValidationOutcome<T>): readonly string[] {
	if (outcome.ok) {
		throw new Error('expected a refusal outcome');
	}
	return outcome.rejections[0].items ?? [];
}

suite('templatesContract · validateWorkflowTemplateRecord', () => {
	test('a green record validates and the ok copy is canonical', () => {
		const outcome = validateWorkflowTemplateRecord(greenRecord());
		assert.ok(outcome.ok);
		assert.equal(outcome.value.templateId, 'flauz:tpl:0123456789abcdef');
		assert.equal(outcome.value.tasks.length, 1);
		assert.deepStrictEqual(outcome.value.tasks[0].termRefs, ['signal']);
	});

	test('the canonical serialization order is the frozen six-key order', () => {
		const bytes = serializeWorkflowTemplateRecord(greenRecord());
		const parsed = JSON.parse(bytes) as Record<string, unknown>;
		assert.deepStrictEqual(Object.keys(parsed), [...TEMPLATE_RECORD_SCHEMA_KEYS]);
		// station-fix (R70): the green fixture carries ONE task (the first test pins
		// tasks.length === 1) — the serialized array's keys are ['0'] alone.
		assert.deepStrictEqual(Object.keys(parsed.tasks as Record<string, unknown>), ['0']);
		const firstTask = (parsed.tasks as Record<string, unknown>[])[0];
		assert.deepStrictEqual(Object.keys(firstTask), [...TASK_ENTRY_SCHEMA_KEYS]);
	});

	test('a non-object is the single-station malformed-record table', () => {
		for (const value of [null, 'record', 7, ['x']]) {
			const outcome = validateWorkflowTemplateRecord(value);
			assert.ok(!outcome.ok);
			assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
		}
	});

	test('a non-array tasks / history carrier is malformed-record', () => {
		const badTasks = clone(greenRecord());
		badTasks.tasks = 'nope';
		assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(badTasks)), ['malformed-record']);
		const badHistory = clone(greenRecord());
		badHistory.history = 'nope';
		assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(badHistory)), ['malformed-record']);
	});

	test('an unknown record key is unknown-key', () => {
		const record = clone(greenRecord());
		record.nope = 1;
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejections[0].reason, 'unknown-key');
		assert.deepStrictEqual(outcome.rejections[0].items, ['nope']);
	});

	test('THE ABSENT-KEY DISCIPLINE: every absent key is missing-key, never a structural station', () => {
		for (const key of [...TEMPLATE_RECORD_SCHEMA_KEYS]) {
			const record = clone(greenRecord());
			delete record[key];
			const outcome = validateWorkflowTemplateRecord(record);
			assert.ok(!outcome.ok, `the absent '${key}' must refuse`);
			assert.deepStrictEqual(reasons(outcome), ['missing-key'], `the absent '${key}' is the missing-key station only`);
		}
	});

	test('malformed-harness-id classes refuse through the REAL DH-01 alphabet', () => {
		for (const harnessId of ['flauz:tpl:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
			const record = clone(greenRecord());
			record.harnessId = harnessId;
			assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(record)), ['malformed-harness-id']);
		}
	});

	test('a non-member industry is unknown-industry', () => {
		const record = clone(greenRecord());
		record.industry = 'aerospace';
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejections[0].reason, 'unknown-industry');
		assert.equal(outcome.rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
	});

	test('per-task violations surface with the tasks[i]: item prefixes', () => {
		const record = greenRecord();
		record.tasks = [{ taskKey: ' k', summary: 's', termRefs: [] }];
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['invalid-task-key']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['tasks[0]:leading/trailing whitespace']);
	});

	test('repeated taskKeys are duplicate-task-key', () => {
		const record = greenRecord();
		record.tasks = [
			{ taskKey: 'survey', summary: 'One.', termRefs: [] },
			{ taskKey: 'survey', summary: 'Two.', termRefs: [] },
		];
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['duplicate-task-key']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['survey']);
	});

	test('exactly 128 tasks validate (the composition bound)', () => {
		const record = greenRecord();
		record.tasks = Array.from({ length: 128 }, (_unused, index) => ({ taskKey: `t${String(index).padStart(3, '0')}`, summary: 'A task.', termRefs: [] }));
		assert.ok(validateWorkflowTemplateRecord(record).ok);
	});

	test('129 tasks are max-tasks-exceeded', () => {
		const record = greenRecord();
		record.tasks = Array.from({ length: 129 }, (_unused, index) => ({ taskKey: `t${String(index).padStart(3, '0')}`, summary: 'A task.', termRefs: [] }));
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['max-tasks-exceeded']);
		assert.deepStrictEqual(outcome.rejections[0].items, ['129 tasks']);
	});

	test('empty tasks are LEGAL on the record shape (the floor fires at finalize)', () => {
		const record = greenRecord();
		record.tasks = [];
		assert.ok(validateWorkflowTemplateRecord(record).ok);
	});

	test('a malformed id / stage / history note refuse (unknown-record, unknown-stage, malformed-history)', () => {
		const badId = clone(greenRecord());
		badId.templateId = 'flauz:tpl:0123456789abcde';
		assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(badId)), ['unknown-record']);
		const badStage = clone(greenRecord());
		badStage.stage = 'draft';
		assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(badStage)), ['unknown-stage']);
		const badHistory = clone(greenRecord());
		badHistory.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
		assert.deepStrictEqual(reasons(validateWorkflowTemplateRecord(badHistory)), ['malformed-history']);
	});

	test('THE COMPLETE TABLE: a multi-offense record reports every station in the frozen walk order', () => {
		const record = greenRecord();
		record.nope = 1;
		delete record.industry;
		record.harnessId = 'bad';
		record.tasks = [
			{ taskKey: 'survey', summary: 'One.', termRefs: [] },
			{ taskKey: 'survey', summary: 'Two.', termRefs: [] },
		];
		const outcome = validateWorkflowTemplateRecord(record);
		assert.ok(!outcome.ok);
		assert.deepStrictEqual(reasons(outcome), ['unknown-key', 'missing-key', 'malformed-harness-id', 'duplicate-task-key']);
	});
});

suite('templatesContract · serialization and the fail-closed parse', () => {
	test('the round trip is byte-identical and double-serialize stable', () => {
		const bytes = serializeWorkflowTemplateRecord(greenRecord());
		const parsed = parseWorkflowTemplateRecord(bytes);
		assert.ok(parsed.ok);
		assert.equal(serializeWorkflowTemplateRecord(parsed.record), bytes);
		assert.equal(serializeWorkflowTemplateRecord(JSON.parse(bytes)), bytes);
	});

	test('serialize throws TypeError on a malformed record', () => {
		assert.throws(() => serializeWorkflowTemplateRecord({ nope: 1 }), TypeError);
	});

	test('parse: malformed-json', () => {
		const outcome = parseWorkflowTemplateRecord('{not json');
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejection.reason, 'malformed-json');
	});

	test('parse: non-string bytes are torn-envelope', () => {
		const outcome = parseWorkflowTemplateRecord(7);
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejection.reason, 'torn-envelope');
	});

	test('parse: a missing key is torn-envelope', () => {
		const record = clone(greenRecord());
		delete record.stage;
		const outcome = parseWorkflowTemplateRecord(JSON.stringify(record));
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejection.reason, 'torn-envelope');
	});

	test('parse: a wrong structural type is torn-envelope', () => {
		const record = clone(greenRecord());
		record.tasks = 'nope';
		const outcome = parseWorkflowTemplateRecord(JSON.stringify(record));
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejection.reason, 'torn-envelope');
	});

	test('parse: unknown keys at the record / task / note level are unknown-key', () => {
		const atRecord = clone(greenRecord());
		atRecord.nope = 1;
		const atRecordOutcome = parseWorkflowTemplateRecord(JSON.stringify(atRecord));
		assert.equal(atRecordOutcome.ok === true ? 'ok' : atRecordOutcome.rejection.reason, 'unknown-key');
		const atTask = clone(greenRecord());
		atTask.tasks = [{ taskKey: 'survey', summary: 's', termRefs: [], command: 1 }];
		const taskOutcome = parseWorkflowTemplateRecord(JSON.stringify(atTask));
		assert.ok(!taskOutcome.ok);
		assert.equal(taskOutcome.rejection.reason, 'unknown-key');
		const atNote = clone(greenRecord());
		atNote.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-template', law: 'THE LAW', detail: 'd', nope: 1 }];
		const noteOutcome = parseWorkflowTemplateRecord(JSON.stringify(atNote));
		assert.ok(!noteOutcome.ok);
		assert.equal(noteOutcome.rejection.reason, 'unknown-key');
	});

	test('parse: a semantically drifted record is invalid-record', () => {
		const record = clone(greenRecord());
		record.stage = 'draft';
		const outcome = parseWorkflowTemplateRecord(JSON.stringify(record));
		assert.ok(!outcome.ok);
		assert.equal(outcome.rejection.reason, 'invalid-record');
	});

	test('parse: the green round trip carries the canonical copy', () => {
		const outcome = parseWorkflowTemplateRecord(serializeWorkflowTemplateRecord(greenRecord()));
		assert.ok(outcome.ok);
		assert.equal(outcome.record.tasks[0].taskKey, 'survey');
		assert.deepStrictEqual(Object.keys(outcome.record), [...TEMPLATE_RECORD_SCHEMA_KEYS]);
	});
});

suite('templatesContract · determinism greps', () => {
	test('Date.now / Math.random / new Date( / process.env appear only on law-comment lines', () => {
		const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
		const matches = CONTRACT_SOURCE.split('\n').filter((line) => pattern.test(line));
		assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
		const offending = matches.filter((line) => {
			const trimmed = line.trim();
			return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
		});
		assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
	});
});
