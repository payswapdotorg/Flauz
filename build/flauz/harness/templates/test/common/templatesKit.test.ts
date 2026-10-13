/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-005 workflow-template kit battery: the fail-closed factories,
 * the staged op surface (begin/add/replace/remove/finalize/emit) with
 * every refusal class and the record-unchanged law, THE TERM-RESOLUTION
 * boundary against the caller-supplied ontology, THE CROSS-KIT
 * INTEGRATION PINS (the wave's crown: the REAL DH-01 harness kit, the
 * REAL DH-04 ontology kit, the REAL DH-02 review-composition
 * validator), the PIN-2 persistence family (ledger + envelope, torn
 * line, divergent envelope, restart replay, the multi-record ledger,
 * the fresh-kit guard, version drift, the tampered finalize payload),
 * the dispose law, and the in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { createOntologyKit } from '../../../ontology/common/ontologyKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	ONBOARDING_CONTRACTS_VERSION,
	ONTOLOGY_CONTRACTS_VERSION,
	ROLES_CONTRACTS_VERSION,
	TEMPLATES_CONTRACTS_VERSION,
	TEMPLATES_ENVELOPE_RELATIVE_PATH,
	TEMPLATES_KIT_REFUSAL_REASONS,
	TEMPLATES_LEDGER_RELATIVE_PATH,
	createTemplatesKit,
	loadTemplatesKit,
} from '../../common/templatesKit.js';
import { TEMPLATES_REJECTION_REASONS } from '../../common/templatesContract.js';
import type { HarnessFsPort, TemplatesKit, TemplatesKitRefusal } from '../../common/templatesKit.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/templatesKit.ts', import.meta.url)), 'utf8');

const HARNESS_ID = 'flauz:hrn:0123456789abcdef';

function makeSeams(): { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number } {
	let clockCount = 0;
	let rngCount = 0;
	return {
		clock: () => {
			clockCount += 1;
			return `2026-01-01T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
		},
		rng: () => {
			rngCount += 1;
			return rngCount.toString(16).padStart(16, '0');
		},
		clockReads: () => clockCount,
		rngReads: () => rngCount,
	};
}

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT). */
class MemoryFsPort {
	private readonly files = new Map<string, string>();
	async readFile(path: string, _encoding: 'utf8'): Promise<string> {
		if (!this.files.has(path)) {
			throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
		}
		return this.files.get(path) as string;
	}
	async writeFile(path: string, text: string): Promise<void> {
		this.files.set(path, text);
	}
	async appendFile(path: string, text: string): Promise<void> {
		this.files.set(path, (this.files.get(path) ?? '') + text);
	}
	async mkdir(_path: string, _options: { recursive: boolean }): Promise<void> {
		/* the in-memory port is flat - the mkdir is a no-op */
	}
	dump(path: string): string | undefined {
		return this.files.get(path);
	}
	overwrite(path: string, text: string): void {
		this.files.set(path, text);
	}
	remove(path: string): void {
		this.files.delete(path);
	}
}

function composedOntology(): Record<string, unknown> {
	return {
		ontologyId: 'flauz:ont:0123456789abcdef',
		harnessId: HARNESS_ID,
		industry: 'software',
		stage: 'composed',
		terms: [
			{ term: 'signal', definition: 'A measured quantity of interest.' },
			{ term: 'baseline', definition: 'The reference measurement.' },
		],
		history: [
			{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-ontology', law: 'THE FORWARD-ONLY LAW', detail: 'began the ontology' },
			{ at: '2026-01-01T00:00:01.000Z', fromStage: 'composing', toStage: 'composed', op: 'finalize-ontology', law: 'THE FORWARD-ONLY LAW', detail: 'finalized the ontology' },
		],
	};
}

async function beginGreen(kit: TemplatesKit, harnessId: string = HARNESS_ID): Promise<string> {
	const outcome = await kit.beginTemplate(harnessId, 'software');
	if (!outcome.ok) {
		throw new Error(`beginTemplate refused: ${outcome.refusal.reason}`);
	}
	assert.equal(outcome.record.stage, 'composing');
	return outcome.record.templateId;
}

async function addTaskGreen(kit: TemplatesKit, templateId: string, task: Record<string, unknown>): Promise<void> {
	const outcome = await kit.addTask(templateId, task);
	if (!outcome.ok) {
		throw new Error(`addTask refused: ${outcome.refusal.reason}`);
	}
}

function refusalOf(outcome: { ok: boolean; refusal?: TemplatesKitRefusal }): TemplatesKitRefusal {
	if (outcome.ok || outcome.refusal === undefined) {
		throw new Error('expected a refusal outcome');
	}
	return outcome.refusal;
}

suite('templatesKit · factories', () => {
	test('createTemplatesKit binds the injected seams (green, no persistence)', () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		assert.equal(typeof kit.dispose, 'function');
	});

	test('factory misuse throws TypeError: the options shape and the seam reads', () => {
		const seams = makeSeams();
		assert.throws(() => createTemplatesKit(null as never), /createTemplatesKit: options must be an object/);
		assert.throws(() => createTemplatesKit({ rng: seams.rng } as never), /options\.clock must be a function/);
		assert.throws(() => createTemplatesKit({ clock: seams.clock } as never), /options\.rng must be a function/);
		assert.throws(() => createTemplatesKit({ clock: () => '', rng: seams.rng } as never), /options\.clock\(\) must return a non-empty ISO string/);
		assert.throws(() => createTemplatesKit({ clock: seams.clock, rng: () => 'nope' } as never), /options\.rng\(\) must return exactly 16 lowercase hex chars/);
	});

	test('factory misuse throws TypeError: the fsPort / root pairing', () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		assert.throws(() => createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort } as never), /come together or not at all/);
		assert.throws(() => createTemplatesKit({ clock: seams.clock, rng: seams.rng, root: 'ws' } as never), /come together or not at all/);
		assert.throws(() => createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: {} as HarnessFsPort, root: 'ws' } as never), /options\.fsPort\.readFile must be a function/);
		assert.throws(() => createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: '' } as never), /options\.root must be a non-empty string/);
	});

	test('the factory consumes exactly ONE clock read and ONE rng read', () => {
		const seams = makeSeams();
		createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		assert.equal(seams.clockReads(), 1);
		assert.equal(seams.rngReads(), 1);
	});

	test('loadTemplatesKit requires BOTH fsPort and root', async () => {
		const seams = makeSeams();
		// station-fix (R70): loadTemplatesKit is ASYNC — its TypeError surfaces as a
		// rejected promise; assert.rejects is the correct channel.
		await assert.rejects(loadTemplatesKit({ clock: seams.clock, rng: seams.rng } as never), /loadTemplatesKit: options\.fsPort and options\.root are both required/);
	});

	test('a fresh root (no files) reopens as an empty kit', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(outcome.ok);
		const listed = await outcome.kit.listTemplates();
		assert.ok(listed.ok);
		assert.deepStrictEqual(listed.records, []);
	});

	test('the kit re-carries the five contract versions (the single-version pins)', () => {
		assert.equal(TEMPLATES_CONTRACTS_VERSION, TEMPLATES_CONTRACTS_VERSION);
		assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
		assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
		assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
		assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
	});

	test('TEMPLATES_KIT_REFUSAL_REASONS is the contract list plus the frozen extras', () => {
		const all = Array.from(TEMPLATES_KIT_REFUSAL_REASONS);
		assert.deepStrictEqual(all.slice(0, TEMPLATES_REJECTION_REASONS.length), Array.from(TEMPLATES_REJECTION_REASONS));
		assert.deepStrictEqual(all.slice(TEMPLATES_REJECTION_REASONS.length), ['DISPOSED', 'CORRUPT_SEAM', 'E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'TEMPLATES_IO', 'UNKNOWN_FILTER']);
	});
});

suite('templatesKit · beginTemplate', () => {
	test('green: mints flauz:tpl:<16-hex>, composing, ZERO tasks, the begin note', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const outcome = await kit.beginTemplate(HARNESS_ID, 'software');
		assert.ok(outcome.ok);
		assert.match(outcome.record.templateId, /^flauz:tpl:[0-9a-f]{16}$/);
		assert.equal(outcome.record.harnessId, HARNESS_ID);
		assert.equal(outcome.record.industry, 'software');
		assert.equal(outcome.record.stage, 'composing');
		assert.deepStrictEqual(outcome.record.tasks, []);
		assert.equal(outcome.record.history.length, 1);
		assert.equal(outcome.record.history[0].fromStage, null);
		assert.equal(outcome.record.history[0].toStage, 'composing');
		assert.equal(outcome.record.history[0].op, 'begin-template');
	});

	test('malformed-harness-id refuses (the REAL DH-01 alphabet)', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		for (const harnessId of ['flauz:tpl:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 7]) {
			const refusal = refusalOf(await kit.beginTemplate(harnessId, 'software'));
			assert.equal(refusal.reason, 'malformed-harness-id');
		}
	});

	test('unknown-industry refuses', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const refusal = refusalOf(await kit.beginTemplate(HARNESS_ID, 'aerospace'));
		assert.equal(refusal.reason, 'unknown-industry');
		assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
	});

	test('CORRUPT_SEAM: a non-16-hex rng read or a duplicate minted id', async () => {
		const bad = createTemplatesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => '0123456789abcdef' });
		const first = await bad.beginTemplate(HARNESS_ID, 'software');
		assert.ok(first.ok);
		const second = refusalOf(await bad.beginTemplate(HARNESS_ID, 'software'));
		assert.equal(second.reason, 'CORRUPT_SEAM');
		let call = 0;
		const flip = createTemplatesKit({ clock: () => '2026-01-01T00:00:00.000Z', rng: () => (call++ === 0 ? '0123456789abcdef' : 'zzz') });
		const refusal = refusalOf(await flip.beginTemplate(HARNESS_ID, 'software'));
		assert.equal(refusal.reason, 'CORRUPT_SEAM');
	});
});

suite('templatesKit · addTask', () => {
	test('green: the task lands with the add-task self-edge note', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		const outcome = await kit.addTask(templateId, { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] });
		assert.ok(outcome.ok);
		assert.equal(outcome.record.tasks.length, 1);
		assert.deepStrictEqual(outcome.record.tasks[0], { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['signal'] });
		const note = outcome.record.history[outcome.record.history.length - 1];
		assert.equal(note.op, 'add-task');
		assert.equal(note.fromStage, 'composing');
		assert.equal(note.toStage, 'composing');
	});

	test('the honest-gap law: empty termRefs land', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		const outcome = await kit.addTask(templateId, { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: [] });
		assert.ok(outcome.ok);
		assert.deepStrictEqual(outcome.record.tasks[0].termRefs, []);
	});

	test('THE TWO-PHASE LAW: a dangling termRef is LEGAL while composing', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		const outcome = await kit.addTask(templateId, { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['ghost-term'] });
		assert.ok(outcome.ok);
	});

	test('a payload refusal carries the COMPLETE rejection table and leaves the record unchanged', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		const before = await kit.inspectTemplate(templateId);
		const refusal = refusalOf(await kit.addTask(templateId, { taskKey: ' x ', summary: '', termRefs: 'nope', command: 1 }));
		assert.equal(refusal.reason, 'no-fork');
		assert.ok(refusal.rejections !== undefined);
		assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['no-fork', 'invalid-task-key', 'invalid-summary', 'malformed-term-refs']);
		const after = await kit.inspectTemplate(templateId);
		assert.deepStrictEqual(after, before);
	});

	test('duplicate-task-key refuses and leaves the record unchanged', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		const before = await kit.inspectTemplate(templateId);
		const refusal = refusalOf(await kit.addTask(templateId, { taskKey: 'survey', summary: 'Again.', termRefs: [] }));
		assert.equal(refusal.reason, 'duplicate-task-key');
		assert.deepStrictEqual(refusal.items, ['survey']);
		assert.deepStrictEqual(await kit.inspectTemplate(templateId), before);
	});

	test('exactly 128 tasks compose; the 129th refuses max-tasks-exceeded', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		for (let index = 0; index < 128; index += 1) {
			await addTaskGreen(kit, templateId, { taskKey: `t${String(index).padStart(3, '0')}`, summary: 'A task.', termRefs: [] });
		}
		const atBound = await kit.inspectTemplate(templateId);
		assert.ok(atBound.ok);
		assert.equal(atBound.record.tasks.length, 128);
		const refusal = refusalOf(await kit.addTask(templateId, { taskKey: 't128', summary: 'One too many.', termRefs: [] }));
		assert.equal(refusal.reason, 'max-tasks-exceeded');
	});

	test('unknown-record (malformed or unresolved id) and stale-stage refuse', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		assert.equal(refusalOf(await kit.addTask('nope', { taskKey: 'k', summary: 's', termRefs: [] })).reason, 'unknown-record');
		assert.equal(refusalOf(await kit.addTask('flauz:tpl:ffffffffffffffff', { taskKey: 'k', summary: 's', termRefs: [] })).reason, 'unknown-record');
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		const finalized = await kit.finalizeTemplate(templateId, composedOntology());
		assert.ok(finalized.ok);
		assert.equal(refusalOf(await kit.addTask(templateId, { taskKey: 'later', summary: 'Too late.', termRefs: [] })).reason, 'stale-stage');
	});
});

suite('templatesKit · replaceTaskSummary', () => {
	test('green: ONLY the summary changes (the taskKey and termRefs are immutable)', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey the signal.', termRefs: ['signal', 'baseline'] });
		const outcome = await kit.replaceTaskSummary(templateId, 'survey', 'Survey the incoming signal against its baseline.');
		assert.ok(outcome.ok);
		assert.equal(outcome.record.tasks[0].taskKey, 'survey');
		assert.deepStrictEqual(outcome.record.tasks[0].termRefs, ['signal', 'baseline']);
		assert.equal(outcome.record.tasks[0].summary, 'Survey the incoming signal against its baseline.');
	});

	test('unknown-task refuses (missing or malformed taskKey)', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		assert.equal(refusalOf(await kit.replaceTaskSummary(templateId, 'ghost', 's')).reason, 'unknown-task');
		assert.equal(refusalOf(await kit.replaceTaskSummary(templateId, 7, 's')).reason, 'unknown-task');
	});

	test('an invalid summary carries the COMPLETE table and leaves the record unchanged', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		const before = await kit.inspectTemplate(templateId);
		const refusal = refusalOf(await kit.replaceTaskSummary(templateId, 'survey', ''));
		assert.equal(refusal.reason, 'invalid-summary');
		assert.ok(refusal.rejections !== undefined);
		assert.deepStrictEqual(refusal.rejections.map((rejection) => rejection.reason), ['invalid-summary']);
		assert.deepStrictEqual(await kit.inspectTemplate(templateId), before);
	});

	test('stale-stage refuses on a composed record', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		assert.equal(refusalOf(await kit.replaceTaskSummary(templateId, 'survey', 'Late.')).reason, 'stale-stage');
	});
});

suite('templatesKit · removeTask', () => {
	test('green: the task leaves with the remove note', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		await addTaskGreen(kit, templateId, { taskKey: 'report', summary: 'Report.', termRefs: [] });
		const outcome = await kit.removeTask(templateId, 'survey');
		assert.ok(outcome.ok);
		assert.equal(outcome.record.tasks.length, 1);
		assert.equal(outcome.record.tasks[0].taskKey, 'report');
		assert.equal(outcome.record.history[outcome.record.history.length - 1].op, 'remove-task');
	});

	test('removing the LAST task is LEGAL while composing', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		const outcome = await kit.removeTask(templateId, 'survey');
		assert.ok(outcome.ok);
		assert.deepStrictEqual(outcome.record.tasks, []);
	});

	test('unknown-task refuses', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		assert.equal(refusalOf(await kit.removeTask(templateId, 'ghost')).reason, 'unknown-task');
	});

	test('THE REMOVE+RE-ADD LAW: a changed taskKey is a NEW task (remove, then re-add)', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.removeTask(templateId, 'survey')).ok);
		const outcome = await kit.addTask(templateId, { taskKey: 'deep-survey', summary: 'A different task.', termRefs: [] });
		assert.ok(outcome.ok);
		assert.equal(outcome.record.tasks[0].taskKey, 'deep-survey');
	});
});

suite('templatesKit · finalizeTemplate', () => {
	test('THE DH-01 FLOOR: an empty template refuses empty-tasks', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		const refusal = refusalOf(await kit.finalizeTemplate(templateId, composedOntology()));
		assert.equal(refusal.reason, 'empty-tasks');
		assert.deepStrictEqual(refusal.items, ['tasks']);
	});

	test('malformed-ontology refuses: a non-record or a record failing the REAL DH-04 walk', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		assert.equal(refusalOf(await kit.finalizeTemplate(templateId, null)).reason, 'malformed-ontology');
		assert.equal(refusalOf(await kit.finalizeTemplate(templateId, { nope: 1 })).reason, 'malformed-ontology');
		const broken = composedOntology() as Record<string, unknown>;
		broken.harnessId = 'bad';
		assert.equal(refusalOf(await kit.finalizeTemplate(templateId, broken)).reason, 'malformed-ontology');
	});

	test('malformed-ontology refuses: a composing (non-composed) ontology record', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		const composing = composedOntology() as Record<string, unknown>;
		composing.stage = 'composing';
		const refusal = refusalOf(await kit.finalizeTemplate(templateId, composing));
		assert.equal(refusal.reason, 'malformed-ontology');
	});

	test('THE NO-DANGLING-REF boundary refuses typed, naming every offending ref', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal', 'ghost'] });
		await addTaskGreen(kit, templateId, { taskKey: 'report', summary: 'Report.', termRefs: ['phantom', 'baseline'] });
		const refusal = refusalOf(await kit.finalizeTemplate(templateId, composedOntology()));
		assert.equal(refusal.reason, 'dangling-term-ref');
		assert.equal(refusal.law, 'THE TERM-RESOLUTION LAW');
		assert.deepStrictEqual(refusal.items, ['ghost', 'phantom']);
	});

	test('the refusal leaves the record unchanged (still composing)', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['ghost'] });
		const before = await kit.inspectTemplate(templateId);
		refusalOf(await kit.finalizeTemplate(templateId, composedOntology()));
		assert.deepStrictEqual(await kit.inspectTemplate(templateId), before);
	});

	test('green: composing -> composed, TERMINAL, tasks carried, the finalize note', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		const outcome = await kit.finalizeTemplate(templateId, composedOntology());
		assert.ok(outcome.ok);
		assert.equal(outcome.record.stage, 'composed');
		assert.equal(outcome.record.tasks.length, 1);
		const note = outcome.record.history[outcome.record.history.length - 1];
		assert.equal(note.op, 'finalize-template');
		assert.equal(note.fromStage, 'composing');
		assert.equal(note.toStage, 'composed');
		assert.equal(note.law, 'THE TERM-RESOLUTION LAW');
	});

	test('after compose: every mutating op refuses stale-stage', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		assert.equal(refusalOf(await kit.addTask(templateId, { taskKey: 'late', summary: 'Late.', termRefs: [] })).reason, 'stale-stage');
		assert.equal(refusalOf(await kit.replaceTaskSummary(templateId, 'survey', 'Late.')).reason, 'stale-stage');
		assert.equal(refusalOf(await kit.removeTask(templateId, 'survey')).reason, 'stale-stage');
		assert.equal(refusalOf(await kit.finalizeTemplate(templateId, composedOntology())).reason, 'stale-stage');
	});
});

suite('templatesKit · emitWorkflowRef', () => {
	test('premature-op on a composing record', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		const refusal = refusalOf(await kit.emitWorkflowRef(templateId));
		assert.equal(refusal.reason, 'premature-op');
		assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
	});

	test('green on a composed record: the workflowRef is the template id', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		const outcome = await kit.emitWorkflowRef(templateId);
		assert.ok(outcome.ok);
		assert.equal(outcome.workflowRef, templateId);
		assert.match(outcome.workflowRef, /^flauz:tpl:[0-9a-f]{16}$/);
	});

	test('unknown-record refuses', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		assert.equal(refusalOf(await kit.emitWorkflowRef('flauz:tpl:ffffffffffffffff')).reason, 'unknown-record');
	});
});

suite('templatesKit · THE CROSS-KIT INTEGRATION PINS (the wave crown)', () => {
	test('the crown: real harness kit -> real ontology kit -> template -> finalize -> emit -> the REAL review-composition validator passes', async () => {
		const seams = makeSeams();
		const harnessKit = createHarnessKit({
			clock: seams.clock,
			rng: seams.rng,
			catalog: { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] },
		});
		const minted = await harnessKit.mintHarness({
			industry: 'software',
			workTypes: ['analysis'],
			displayName: 'Crown Harness',
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(minted.ok);
		const harnessId = minted.record.harnessId;
		const ontologyKit = createOntologyKit({ clock: seams.clock, rng: seams.rng });
		const begun = await ontologyKit.beginOntology(harnessId, 'software');
		assert.ok(begun.ok);
		const ontologyId = begun.record.ontologyId;
		assert.ok((await ontologyKit.addTerm(ontologyId, { term: 'signal', definition: 'A measured quantity of interest.' })).ok);
		assert.ok((await ontologyKit.addTerm(ontologyId, { term: 'baseline', definition: 'The reference measurement.' })).ok);
		const finalizedOntology = await ontologyKit.finalizeOntology(ontologyId);
		assert.ok(finalizedOntology.ok);
		assert.equal(finalizedOntology.record.stage, 'composed');
		const templatesKit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const template = await templatesKit.beginTemplate(harnessId, 'software');
		assert.ok(template.ok);
		const templateId = template.record.templateId;
		const realTerms = finalizedOntology.record.terms.map((term) => term.term);
		assert.ok((await templatesKit.addTask(templateId, { taskKey: 'measure', summary: 'Measure the signal against the baseline.', termRefs: realTerms })).ok);
		const finalized = await templatesKit.finalizeTemplate(templateId, finalizedOntology.record);
		assert.ok(finalized.ok);
		assert.equal(finalized.record.stage, 'composed');
		const emitted = await templatesKit.emitWorkflowRef(templateId);
		assert.ok(emitted.ok);
		assert.equal(emitted.workflowRef, templateId);
		const composition = validateOnboardingReviewComposition({
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [emitted.workflowRef],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(composition.ok);
		assert.deepStrictEqual(composition.value.workflowRefs, [emitted.workflowRef]);
	});

	test('the crown boundary: a dangling termRef refuses against the REAL composed ontology', async () => {
		const seams = makeSeams();
		const harnessKit = createHarnessKit({
			clock: seams.clock,
			rng: seams.rng,
			catalog: { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] },
		});
		const minted = await harnessKit.mintHarness({
			industry: 'software',
			workTypes: ['analysis'],
			displayName: 'Crown Harness',
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(minted.ok);
		const ontologyKit = createOntologyKit({ clock: seams.clock, rng: seams.rng });
		const begun = await ontologyKit.beginOntology(minted.record.harnessId, 'software');
		assert.ok(begun.ok);
		assert.ok((await ontologyKit.addTerm(begun.record.ontologyId, { term: 'signal', definition: 'A measured quantity of interest.' })).ok);
		const finalizedOntology = await ontologyKit.finalizeOntology(begun.record.ontologyId);
		assert.ok(finalizedOntology.ok);
		const templatesKit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const template = await templatesKit.beginTemplate(minted.record.harnessId, 'software');
		assert.ok(template.ok);
		assert.ok((await templatesKit.addTask(template.record.templateId, { taskKey: 'measure', summary: 'Measure the ghost.', termRefs: ['signal', 'ghost'] })).ok);
		const refusal = refusalOf(await templatesKit.finalizeTemplate(template.record.templateId, finalizedOntology.record));
		assert.equal(refusal.reason, 'dangling-term-ref');
		assert.deepStrictEqual(refusal.items, ['ghost']);
	});

	test('the crown family form: the emitted ref rides workflowRefs; a duplicate or non-string member refuses the REAL validator', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		const emitted = await kit.emitWorkflowRef(templateId);
		assert.ok(emitted.ok);
		const green = validateOnboardingReviewComposition({
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [emitted.workflowRef],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(green.ok);
		const duplicated = validateOnboardingReviewComposition({
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [emitted.workflowRef, emitted.workflowRef],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(!duplicated.ok);
		assert.equal(duplicated.refusal.reason, 'duplicate-ref');
		const malformed = validateOnboardingReviewComposition({
			roles: [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }],
			capabilityRefs: [],
			workflowRefs: [emitted.workflowRef, 7],
			policyRefs: [],
			evidenceRefs: [],
		});
		assert.ok(!malformed.ok);
		assert.equal(malformed.refusal.reason, 'malformed-refs');
	});

	test('the crown honest gap: a task with zero termRefs finalizes green against the real ontology', async () => {
		const seams = makeSeams();
		const ontologyKit = createOntologyKit({ clock: seams.clock, rng: seams.rng });
		const begun = await ontologyKit.beginOntology(HARNESS_ID, 'software');
		assert.ok(begun.ok);
		assert.ok((await ontologyKit.addTerm(begun.record.ontologyId, { term: 'signal', definition: 'A measured quantity of interest.' })).ok);
		const finalizedOntology = await ontologyKit.finalizeOntology(begun.record.ontologyId);
		assert.ok(finalizedOntology.ok);
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'A task that names zero terms.', termRefs: [] });
		const finalized = await kit.finalizeTemplate(templateId, finalizedOntology.record);
		assert.ok(finalized.ok);
		assert.equal(finalized.record.stage, 'composed');
	});
});

suite('templatesKit · persistence (the PIN-2 mirror)', () => {
	test('the ledger and the envelope land lazily at the distinct family paths', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.equal(port.dump('ws/.flauz/harness/templates-ops.jsonl'), undefined);
		const templateId = await beginGreen(kit);
		const ledger = port.dump(`ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`);
		assert.ok(ledger !== undefined && ledger.endsWith('\n'));
		assert.equal(ledger.split('\n').length - 1, 1);
		const envelope = port.dump(`ws/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`);
		assert.ok(envelope !== undefined);
		const parsed = JSON.parse(envelope as string) as { contractVersion: string; seq: number; records: unknown[] };
		assert.equal(parsed.contractVersion, TEMPLATES_CONTRACTS_VERSION);
		assert.equal(parsed.seq, 1);
		assert.equal(parsed.records.length, 1);
	});

	test('restart replay is byte-identical and the seq continues', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		const first = await beginGreen(kit);
		await addTaskGreen(kit, first, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		const second = await beginGreen(kit);
		const beforeFirst = await kit.inspectTemplate(first);
		const reloaded = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(reloaded.ok);
		assert.deepStrictEqual(await reloaded.kit.inspectTemplate(first), beforeFirst);
		assert.ok((await reloaded.kit.addTask(second, { taskKey: 'report', summary: 'Report.', termRefs: [] })).ok);
		const ledger = port.dump(`ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`) as string;
		assert.equal(ledger.split('\n').length - 1, 4);
		const envelope = JSON.parse(port.dump(`ws/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`) as string) as { seq: number };
		assert.equal(envelope.seq, 4);
	});

	test('a torn ledger (no trailing newline) is E_LEDGER_TORN', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		const ledgerPath = `ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`;
		port.overwrite(ledgerPath, (port.dump(ledgerPath) as string).slice(0, -1));
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
	});

	test('a content-divergent envelope is E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		await addTaskGreen(kit, 'flauz:tpl:0000000000000002', { taskKey: 'survey', summary: 'Survey.', termRefs: [] }).catch(() => undefined);
		const listed = await kit.listTemplates();
		const templateId = listed.ok ? listed.records[0].templateId : '';
		const envelopePath = `ws/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`;
		const parsed = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: Record<string, unknown>[] };
		parsed.records[0].tasks = [];
		port.overwrite(envelopePath, JSON.stringify(parsed));
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
		assert.ok(templateId.length > 0);
	});

	test('a missing envelope while the ledger carries lines is E_ENVELOPE_MISMATCH', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		port.remove(`ws/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`);
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
	});

	test('an envelope seq ahead is E_LEDGER_TORN; behind is E_ENVELOPE_MISMATCH', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		await beginGreen(kit);
		const envelopePath = `ws/${TEMPLATES_ENVELOPE_RELATIVE_PATH}`;
		const ahead = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
		ahead.seq = 3;
		port.overwrite(envelopePath, JSON.stringify(ahead));
		const aheadOutcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!aheadOutcome.ok);
		assert.equal(aheadOutcome.refusal.reason, 'E_LEDGER_TORN');
		const behind = JSON.parse(port.dump(envelopePath) as string) as { contractVersion: string; seq: number; records: unknown[] };
		behind.seq = 1;
		port.overwrite(envelopePath, JSON.stringify(behind));
		const behindOutcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!behindOutcome.ok);
		assert.equal(behindOutcome.refusal.reason, 'E_ENVELOPE_MISMATCH');
	});

	test('the multi-record ledger replays both records in templateId order', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		const first = await beginGreen(kit);
		const second = await beginGreen(kit);
		await addTaskGreen(kit, first, { taskKey: 'survey', summary: 'Survey.', termRefs: [] });
		assert.ok((await kit.finalizeTemplate(first, composedOntology())).ok);
		const reloaded = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(reloaded.ok);
		const listed = await reloaded.kit.listTemplates();
		assert.ok(listed.ok);
		assert.equal(listed.records.length, 2);
		assert.deepStrictEqual(listed.records.map((record) => record.templateId), [first, second].sort());
		const composed = await reloaded.kit.inspectTemplate(first);
		assert.ok(composed.ok);
		assert.equal(composed.record.stage, 'composed');
	});

	test('a fresh kit never appends over a non-empty ledger (E_LEDGER_TORN)', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		const ledgerPath = `ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`;
		const lineCount = (port.dump(ledgerPath) as string).split('\n').length - 1;
		const fresh = createTemplatesKit({ clock: seams.clock, rng: makeSeams().rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		const refusal = refusalOf(await fresh.beginTemplate(HARNESS_ID, 'software'));
		assert.equal(refusal.reason, 'E_LEDGER_TORN');
		assert.equal((port.dump(ledgerPath) as string).split('\n').length - 1, lineCount);
	});

	test('a tampered contractVersion is the typed version-mismatch', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		await beginGreen(kit);
		const ledgerPath = `ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`;
		const lines = (port.dump(ledgerPath) as string).split('\n');
		const first = JSON.parse(lines[0]) as Record<string, unknown>;
		first.contractVersion = '9.9.9';
		lines[0] = JSON.stringify(first);
		port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.refusal.reason, 'version-mismatch');
	});

	test('a tampered finalize payload (a dangling resolution) is E_LEDGER_TORN - the replay re-proves THE TERM-RESOLUTION LAW', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		const ledgerPath = `ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`;
		const lines = (port.dump(ledgerPath) as string).split('\n');
		const last = JSON.parse(lines[lines.length - 2]) as { payload: { terms: { term: string }[] } };
		last.payload.terms[0].term = 'ghost';
		lines[lines.length - 2] = JSON.stringify(last);
		port.overwrite(ledgerPath, `${lines.join('\n')}\n`);
		const outcome = await loadTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		assert.ok(!outcome.ok);
		assert.equal(outcome.refusal.reason, 'E_LEDGER_TORN');
	});

	test('the finalize line carries the caller-supplied ontology AS IT STOOD', async () => {
		const seams = makeSeams();
		const port = new MemoryFsPort();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
		const templateId = await beginGreen(kit);
		await addTaskGreen(kit, templateId, { taskKey: 'survey', summary: 'Survey.', termRefs: ['signal'] });
		assert.ok((await kit.finalizeTemplate(templateId, composedOntology())).ok);
		const lines = (port.dump(`ws/${TEMPLATES_LEDGER_RELATIVE_PATH}`) as string).split('\n');
		const last = JSON.parse(lines[lines.length - 2]) as { op: string; payload: { ontologyId: string; stage: string; terms: unknown[] } };
		assert.equal(last.op, 'finalize-template');
		assert.equal(last.payload.ontologyId, 'flauz:ont:0123456789abcdef');
		assert.equal(last.payload.stage, 'composed');
		assert.equal(last.payload.terms.length, 2);
	});
});

suite('templatesKit · dispose and determinism', () => {
	test('THE DISPOSE LAW: every operation after dispose rejects', async () => {
		const seams = makeSeams();
		const kit = createTemplatesKit({ clock: seams.clock, rng: seams.rng });
		const templateId = await beginGreen(kit);
		kit.dispose();
		assert.equal(refusalOf(await kit.beginTemplate(HARNESS_ID, 'software')).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.addTask(templateId, { taskKey: 'k', summary: 's', termRefs: [] })).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.replaceTaskSummary(templateId, 'k', 's')).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.removeTask(templateId, 'k')).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.finalizeTemplate(templateId, composedOntology())).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.emitWorkflowRef(templateId)).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.inspectTemplate(templateId)).reason, 'DISPOSED');
		assert.equal(refusalOf(await kit.listTemplates()).reason, 'DISPOSED');
	});

	test('determinism greps over the kit module: law-comment lines only', () => {
		const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
		const matches = KIT_SOURCE.split('\n').filter((line) => pattern.test(line));
		assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
		const offending = matches.filter((line) => {
			const trimmed = line.trim();
			return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
		});
		assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
	});
});
