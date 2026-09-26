/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// ---------------------------------------------------------------------------------------------
// Flauz Wave 4 - Lane K canary: C-WORKFLOW (build/flauz/canaries/C-WORKFLOW.md)
//
// c-workflow-canary.mjs - the scripted save -> re-run round trip plus the
// ledger-hardening, A2A-bus, trigger-mapping, and lane-hygiene assertions.
// Node-only and zero-dep: no IDE boot, no xvfb, no npm install (type-stripped
// imports of the real extension sources - the same discipline as the suites).
//
// Run: node build/flauz/scripts/c-workflow-canary.mjs
// Exit: 0 with a receipt per assertion (A1-A5); 1 on the first failure.
// ----------------------------------------------------------------------------------------------

import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '../../../extensions/flauz-workspace/src/api.ts';
import { TaskService } from '../../../extensions/flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../../extensions/flauz-workspace/src/ledger.ts';
import { WorkflowService } from '../../../extensions/flauz-workflow/src/envelope.ts';
import { createFixtureSigner } from '../../../extensions/flauz-workflow/src/keys.ts';
import { automationFromFragment, validateCronExpression, workflowRunRequestId } from '../../../extensions/flauz-workflow/src/triggers.ts';
import { A2ABus } from '../../../extensions/flauz-agent/core/a2a.mjs';

const REPO_ROOT = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');
const RECEIPTS = [];

function pass(label) {
	RECEIPTS.push(label);
	console.log(`PASS ${label}`);
}

function fail(label, detail) {
	console.error(`FAIL ${label}`);
	if (detail !== undefined && detail !== '') {
		console.error(`  ${detail}`);
	}
	process.exit(1);
}

function check(condition, label, detail) {
	if (!condition) {
		fail(label, detail);
	}
}

function fsPort() {
	return {
		readFileUtf8: async (target) => {
			try {
				return readFileSync(target, 'utf-8');
			} catch (err) {
				if (err && err.code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: async (target, contents) => writeFileSync(target, contents, 'utf-8'),
		appendFile: async (target, contents) => {
			let current = '';
			try {
				current = readFileSync(target, 'utf-8');
			} catch {
				current = '';
			}
			writeFileSync(target, current + contents, 'utf-8');
		},
		rename: async (from, to) => {
			writeFileSync(to, readFileSync(from, 'utf-8'), 'utf-8');
			rmSync(from, { force: true });
		},
		mkdir: async (target) => mkdirSync(target, { recursive: true }),
	};
}

let clockValue = 1_000;
const clock = () => (clockValue += 1);

// The golden task run (the same event shape the Wave-3 orchestrator produces;
// mirrors extensions/flauz-workflow/test/helpers.ts goldenRun on purpose - see
// C-WORKFLOW.md Notes).
async function goldenRun(root, tasks, ledger, fs) {
	const prompt = 'ship the flauz wave 4 lane';
	const created = await tasks.createTask(prompt);
	const taskId = created.id;
	const plan = `## Flauz plan - ${taskId}\n\n**Request:** ${prompt}\n\n1. Run \`echo flauz-golden-path-ok\`.`;
	await tasks.appendEvent(taskId, { ts: 1, actor: 'agent', type: 'submit-plan', payload: { plan, requestId: 'req-1' } });
	await tasks.appendEvent(taskId, { ts: 2, actor: 'human', type: 'approve', payload: {} });
	const output = 'echo flauz-golden-path-ok\nflauz-golden-path-ok';
	const artifactUri = `.flauz/artifacts/${taskId}/command-output-1.txt`;
	await fs.mkdir(join(root, '.flauz/artifacts', taskId));
	await fs.writeFile(join(root, artifactUri), output);
	const artifactSha256 = sha256Hex(output);
	const appended = await ledger.append(taskId, { kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: 'echo flauz-golden-path-ok' });
	await tasks.appendEvent(taskId, { ts: 3, actor: 'tool', type: 'evidence', payload: { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'command-output', uri: artifactUri, sha256: artifactSha256, note: 'echo flauz-golden-path-ok' } });
	await tasks.appendEvent(taskId, { ts: 4, actor: 'agent', type: 'report', payload: { commandEvidenceId: appended.evidenceId } });
	await tasks.appendEvent(taskId, { ts: 5, actor: 'tool', type: 'verify-pass', payload: { rows: 1 } });
	await tasks.appendEvent(taskId, { ts: 6, actor: 'human', type: 'sign-off', payload: {} });
	return { taskId, evidenceId: appended.evidenceId, artifactUri, artifactSha256 };
}

// ---------------------------------------------------------------------------
// A1 - save -> re-run round trip (the headline)
// ---------------------------------------------------------------------------

async function a1RoundTrip() {
	const root = mkdtempSync(join(tmpdir(), 'c-workflow-a1-'));
	try {
		const fs = fsPort();
		const tasks = new TaskService({ root, fs, clock });
		const ledger = new EvidenceLedger({ root, fs, clock, signer: createFixtureSigner('ed25519') });
		const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
		await tasks.bootstrap();
		await ledger.ensure();
		await fs.mkdir(join(root, '.flauz/workflows'));

		const golden = await goldenRun(root, tasks, ledger, fs);
		check(golden.taskId === 'T-001', 'A1: golden run mints T-001', `got ${golden.taskId}`);

		const saved = await workflows.save({ taskId: golden.taskId, rerunApprovals: 'replay' });
		check(saved.workflowId === 'W-001', 'A1: save allocates W-001', `got ${saved.workflowId}`);
		const loaded = await workflows.load('W-001');
		check(loaded.tools.length === 1 && loaded.tools[0].toolId === 'flauz_terminal', 'A1: distilled fragment carries the tool step');

		const outcome = await workflows.run({
			workflowId: 'W-001',
			executor: async () => ({ ok: true, output: 'echo flauz-golden-path-ok\nflauz-golden-path-ok' }),
		});
		check(outcome.status === 'done' && outcome.stopped === 'completed', 'A1: re-run completes done', JSON.stringify({ status: outcome.status, stopped: outcome.stopped }));
		check(outcome.ledger.ok, 'A1: re-run ledger verifies', `firstBadSeq=${String(outcome.ledger.firstBadSeq)}`);
		check(outcome.evidenceIds.length >= 1 && outcome.evidenceIds[0] !== golden.evidenceId, 'A1: re-run appends NEW evidence rows');

		const rerunTask = await tasks.getTask(outcome.taskId);
		const started = rerunTask.events.find((event) => event.type === 'workflow-start');
		check(started !== undefined && started.payload.derivedFrom.taskId === golden.taskId, 'A1: new task links back via derivedFrom');

		const reloaded = await workflows.load('W-001');
		check(reloaded.history.length === 1 && reloaded.history[0].taskId === outcome.taskId, 'A1: fragment history records the derivation');

		const artifactBytes = readFileSync(join(root, golden.artifactUri), 'utf-8');
		check(sha256Hex(artifactBytes) === golden.artifactSha256, 'A1: original artifact hashes to its recorded sha256');
		pass('A1: envelope save -> load -> re-run round trip (derivedFrom + history + artifact hash)');
		return { root, fragment: reloaded };
	} catch (err) {
		fail('A1: envelope save -> load -> re-run round trip', err && err.stack ? err.stack : String(err));
	}
}

// ---------------------------------------------------------------------------
// A2 - ledger hardening stays in the loop (checkpoint + watermark tamper)
// ---------------------------------------------------------------------------

async function a2Hardening(a1) {
	try {
		const root = a1.root;
		const fs = fsPort();
		const ledger = new EvidenceLedger({ root, fs, clock, signer: createFixtureSigner('ed25519') });
		await ledger.appendCheckpoint();
		const verified = await ledger.verify();
		check(verified.ok, 'A2: signed checkpoint verifies clean', JSON.stringify(verified).slice(0, 400));

		const ledgerPath = join(root, '.flauz/evidence/ledger.jsonl');
		const lines = readFileSync(ledgerPath, 'utf-8').split('\n').filter((line) => line.length > 0);
		check(lines.length >= 3, 'A2: journal has rows to truncate');
		writeFileSync(ledgerPath, `${lines.slice(0, -2).join('\n')}\n`, 'utf-8');
		const tampered = await ledger.verify();
		check(tampered.ok === false, 'A2: truncated tail is flagged (watermark tamper class 6)', 'verify unexpectedly still ok');
		pass('A2: checkpoint verifies; truncation flagged (DL-20 hardening live)');
	} catch (err) {
		fail('A2: ledger hardening', err && err.stack ? err.stack : String(err));
	}
}

// ---------------------------------------------------------------------------
// A3 - A2A bus round trip + restart no-replay
// ---------------------------------------------------------------------------

async function a3A2a() {
	const root = mkdtempSync(join(tmpdir(), 'c-workflow-a3-'));
	try {
		const bus = new A2ABus(root);
		bus.post({ message: { kind: 'task-delegation', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: { taskId: 'T-001', taskDescription: 'Review package.json structure', prompt: 'Review it.' } } });
		bus.post({ message: { kind: 'steering-relay', from: 'flauz.agent', to: 'flauz.agent.worker-1', payload: { taskId: 'T-001', message: 'Focus on dependencies.' } } });
		const drained = bus.collect({ agentId: 'flauz.agent.worker-1' });
		check(drained.messages.length === 2, 'A3: mailbox drains both messages');
		check(bus.collect({ agentId: 'flauz.agent.worker-1' }).messages.length === 0, 'A3: drained mailbox stays empty');
		const restarted = new A2ABus(root);
		check(restarted.collect({ agentId: 'flauz.agent.worker-1' }).messages.length === 0, 'A3: restart replays nothing');
		restarted.post({ message: { kind: 'result-report', from: 'flauz.agent.worker-1', to: 'flauz.agent', inReplyTo: 'M-000001', payload: { taskId: 'T-001', outcome: 'ok', evidenceIds: ['E-000001'], summary: 'Reviewed.' } } });
		const fresh = restarted.collect({ agentId: 'flauz.agent' });
		check(fresh.messages.length === 1 && fresh.messages[0].kind === 'result-report', 'A3: post-restart message arrives exactly once');
		rmSync(root, { recursive: true, force: true });
		pass('A3: A2A bus post/collect + restart no-replay');
	} catch (err) {
		fail('A3: A2A bus', err && err.stack ? err.stack : String(err));
	}
}

// ---------------------------------------------------------------------------
// A4 - trigger mapping smoke
// ---------------------------------------------------------------------------

function a4Triggers(a1) {
	const draft = automationFromFragment(a1.fragment, {
		schedules: [{ id: 'weekday-morning', expression: '30 9 * * 1-5', timeZone: 'UTC' }],
	});
	check(draft._meta['flauz.workflow'].id === a1.fragment.id, 'A4: _meta binds the fragment id');
	check(draft.message.origin === 'automation' && draft.message.text === a1.fragment.plan.prompt, 'A4: run message = plan prompt, automation origin');
	check(validateCronExpression('30 9 * * 1-5').ok === true, 'A4: tree cron example validates');
	check(validateCronExpression('30 9 * * 1-5 *').ok === false, 'A4: 6-field expression rejected');
	check(workflowRunRequestId(a1.fragment.id, 1) === `flauz.workflow/${a1.fragment.id}/run/1`, 'A4: deterministic run idempotency key');
	pass('A4: AHP trigger mapping + cron gates + idempotency key');
}

// ---------------------------------------------------------------------------
// A5 - lane hygiene (the binding rules, mechanically)
// ---------------------------------------------------------------------------

const HEADER_LINES = [
	'/*---------------------------------------------------------------------------------------------',
	' *  Copyright (c) Microsoft Corporation. All rights reserved.',
	' *  Licensed under the MIT License. See License.txt in the project root for license information.',
	' *--------------------------------------------------------------------------------------------*/',
];

function collectFiles(dir, into) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFiles(path, into);
		} else {
			into.push(path);
		}
	}
	return into;
}

function a5Hygiene() {
	const targets = [
		...collectFiles(`${REPO_ROOT}/extensions/flauz-workflow/src`, []),
		...collectFiles(`${REPO_ROOT}/extensions/flauz-workflow/test`, []),
		`${REPO_ROOT}/extensions/flauz-workflow/shims/node.d.ts`,
		`${REPO_ROOT}/extensions/flauz-agent/core/a2a.mjs`,
		`${REPO_ROOT}/extensions/flauz-agent/core/a2a.d.mts`,
		`${REPO_ROOT}/extensions/flauz-agent/test/a2a.test.ts`,
		...collectFiles(`${REPO_ROOT}/test/fixtures/workflow/a2a`, []),
		`${REPO_ROOT}/build/flauz/scripts/c-workflow-canary.mjs`,
	];
	const allowlist = readFileSync(`${REPO_ROOT}/.eslint-allowed-javascript-files`, 'utf-8');
	let checked = 0;
	for (const path of targets) {
		const bytes = readFileSync(path);
		check(!bytes.includes(13), `A5: no CR bytes in ${path}`);
		const text = bytes.toString('utf-8');
		for (let i = 0; i < text.length; i++) {
			check(text.charCodeAt(i) < 128, `A5: ASCII-only violation at offset ${String(i)} of ${path}`, `byte ${String(text.charCodeAt(i))}`);
		}
		const lines = text.split('\n');
		const codeFile = /\.(ts|mts|mjs)$/.test(path);
		if (codeFile && lines.length >= 4) {
			for (let i = 0; i < 4; i++) {
				check(lines[i] === HEADER_LINES[i], `A5: header line ${String(i + 1)} byte-exact in ${path}`, `got: ${lines[i]}`);
			}
		}
		if (path.endsWith('.mjs')) {
			const relative = path.slice(REPO_ROOT.length + 1);
			check(allowlist.includes(relative), `A5: ${relative} is in .eslint-allowed-javascript-files`);
		}
		for (const [index, line] of lines.entries()) {
			if (/^ +/.test(line) && !/^ \*/.test(line)) {
				check(false, `A5: TAB indent violated at line ${String(index + 1)} of ${path}`, `space-led: ${line.slice(0, 60)}`);
			}
		}
		checked++;
	}
	pass(`A5: lane hygiene over ${String(checked)} files (headers, tabs, ASCII, CR, allowlist)`);
}

// ---------------------------------------------------------------------------

const a1 = await a1RoundTrip();
await a2Hardening(a1);
await a3A2a();
a4Triggers(a1);
a5Hygiene();
try {
	rmSync(a1.root, { recursive: true, force: true });
} catch {
	// best-effort cleanup
}
console.log(`c-workflow-canary: ${String(RECEIPTS.length)}/5 assertions green (A1-A5)`);
