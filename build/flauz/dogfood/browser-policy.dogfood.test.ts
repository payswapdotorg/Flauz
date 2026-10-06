/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * A-PROD-003-W7 -- the browser-policy dogfood exercise tests (sibling suite
 * to dogfood.test.ts, following the repo's mocha runner convention).
 *
 * The mutation law: a swapped verdict, a missing denied-navigation entry,
 * and a fabricated navigate-command claim must EACH FAIL the verification.
 * The deny-never-navigates law, the drop/recovery ground truth, and the
 * frictionlog validation are pinned.
 */

import assert from 'node:assert/strict';
import {
	BROWSER_POLICY_ANSWER_SCHEMA,
	FIXTURE_POLICY_TEXT,
	REJECTED_POLICY_TEXT,
	SCRIPTED_NAVIGATIONS,
	REATTACH_URL,
	buildBrowserPolicyQuestion,
	deriveBrowserPolicyGroundTruth,
	denyNeverNavigatesLaw,
	parseBrowserPolicyAnswer,
	verifyBrowserPolicyAnswer,
	type BrowserPolicyAnswer,
	type GroundTruth,
} from './exercises/browser-policy.task.ts';
import { parsePolicyText, resolvePolicyText, BrowserPolicyEngine, derivePartition } from '../../../extensions/flauz-browser/src/policy.ts';
import { validateFrictionLine, parseFrictionLog, FRICTION_SCHEMA } from './frictionlog.mjs';

/** A deterministic clock (no Date.now/Math.random: the determinism law). */
const fixedClock = () => 1_700_000_000_000;

function buildEngines() {
	const policy = parsePolicyText(FIXTURE_POLICY_TEXT).policy;
	const rejected = resolvePolicyText(REJECTED_POLICY_TEXT);
	return {
		engines: {
			primary: new BrowserPolicyEngine({ policy, source: 'workspace-file', clock: fixedClock }),
			'rejected-policy-file': new BrowserPolicyEngine({ policy: rejected.policy, source: rejected.source, clock: fixedClock }),
		},
		policy,
	};
}

/** A fabricated-but-shape-true command/journal backdrop for the pure verifier tests. */
function fabricatedBackdrop() {
	const { engines, policy } = buildEngines();
	const matchingPartition = derivePartition('/workspace/w7', undefined, policy.partitions);
	const foreignPartition = derivePartition('/workspace/other', undefined, policy.partitions);
	// sentCommands: Page.navigate ONLY for the targets the real pipeline would have sent.
	const allowedUrls = ['https://ok.example.com/page', 'https://ok.example.com/secret?token=sk-live-abcdefghijklmnop&x=1', REATTACH_URL];
	const sentCommands = allowedUrls.map((url, index) => ({ id: index + 1, seq: index + 1, method: 'Page.navigate', params: { url }, sessionId: undefined as string | undefined }));
	const journalRecords = SCRIPTED_NAVIGATIONS.map((script, index) => ({
		schemaVersion: 0 as const,
		schema: 'flauz.browser-session-journal/v0' as const,
		ts: 1_700_000_000_000 + index,
		actor: 'agent' as const,
		event: 'navigated' as const,
		descriptor: {} as never,
		navigation: {
			decision: (allowedUrls.includes(script.url) && script.engineId === 'primary' && script.partition === 'matching' && !script.url.includes('blocked-') ? 'allow' : 'deny') as 'allow' | 'deny',
			requestedUrl: script.url.includes('sk-live-') ? 'https://ok.example.com/secret?token=[redacted]&x=1' : script.url,
			sent: allowedUrls.includes(script.url) && script.engineId === 'primary' && script.partition === 'matching' && !script.url.includes('blocked-'),
		},
	}));
	return { engines, matchingPartition, foreignPartition, sentCommands, journalRecords };
}

function groundTruthOf(overrides?: Partial<Parameters<typeof deriveBrowserPolicyGroundTruth>[0]>): GroundTruth {
	const b = fabricatedBackdrop();
	return deriveBrowserPolicyGroundTruth({
		engines: b.engines,
		workspaceRoot: '/workspace/w7',
		matchingPartition: b.matchingPartition,
		foreignPartition: b.foreignPartition,
		sentCommands: b.sentCommands,
		journalRecords: b.journalRecords,
		journalRowsBeforeDrop: b.journalRecords.length,
		...overrides,
	});
}

function faithfulAnswer(gt: GroundTruth): BrowserPolicyAnswer {
	return {
		schema: BROWSER_POLICY_ANSWER_SCHEMA,
		navigations: gt.navigations.map(nav => ({
			id: nav.id,
			targetUrl: nav.targetUrl,
			verdict: nav.verdict,
			decidingLayer: nav.decidingLayer,
			navigateCommandReachedTransport: nav.navigateCommandReachedTransport,
			...(nav.committedUrl === null ? {} : { committedUrl: nav.committedUrl }),
			journalRequestedUrl: nav.journalRequestedUrl,
			journalSent: nav.journalSent,
		})),
		dropRecovery: {
			journalRowsBeforeDrop: gt.dropRecovery.journalRowsBeforeDrop,
			journalRowsAfterReattach: gt.dropRecovery.journalRowsAfterReattach,
			reattachedNavigation: gt.dropRecovery.reattachedNavigation,
		},
	};
}

suite('A-PROD-003-W7 browser-policy dogfood exercise', () => {

	suite('the independent verifier', () => {

		test('PASSES a faithful answer at 100%', () => {
			const gt = groundTruthOf();
			const verification = verifyBrowserPolicyAnswer(faithfulAnswer(gt), gt);
			assert.equal(verification.ok, true, verification.problems.join('; '));
			assert.equal(verification.soundnessViolations, 0);
			assert.equal(verification.completenessViolations, 0);
		});

		test('FAILS a swapped verdict (mutation: n1 allow -> deny)', () => {
			const gt = groundTruthOf();
			const answer = faithfulAnswer(gt);
			const n1 = answer.navigations.find(nav => nav.id === 'n1');
			assert.notEqual(n1, undefined);
			const mutated = answer.navigations.map(nav => ({ ...nav }));
			mutated.find(nav => nav.id === 'n1')!.verdict = n1!.verdict === 'allow' ? 'deny' : 'allow';
			const verification = verifyBrowserPolicyAnswer({ ...answer, navigations: mutated }, gt);
			assert.equal(verification.ok, false);
			assert.ok(verification.soundnessViolations >= 1);
			assert.ok(verification.problems.some(problem => problem.includes('n1') && problem.includes('verdict')));
		});

		test('FAILS a missing denied-navigation entry (mutation: drop n2 — completeness)', () => {
			const gt = groundTruthOf();
			const answer = faithfulAnswer(gt);
			(answer.navigations as unknown[]).splice(answer.navigations.findIndex(nav => nav.id === 'n2'), 1);
			const verification = verifyBrowserPolicyAnswer(answer, gt);
			assert.equal(verification.ok, false);
			assert.ok(verification.completenessViolations >= 1);
			assert.ok(verification.problems.some(problem => problem.includes('n2') && problem.includes('MISSING')));
		});

		test('FAILS a fabricated navigate-command claim for a denied target (mutation: n2 sent=true — soundness)', () => {
			const gt = groundTruthOf();
			const n2 = gt.navigations.find(nav => nav.id === 'n2');
			assert.equal(n2?.verdict, 'deny');
			const answer = faithfulAnswer(gt);
			const mutated = answer.navigations.map(nav => ({ ...nav }));
			mutated.find(nav => nav.id === 'n2')!.navigateCommandReachedTransport = true;
			const verification = verifyBrowserPolicyAnswer({ ...answer, navigations: mutated }, gt);
			assert.equal(verification.ok, false);
			assert.ok(verification.soundnessViolations >= 1);
			assert.ok(verification.problems.some(problem => problem.includes('n2') && problem.includes('navigateCommandReachedTransport')));
		});

		test('FAILS a fabricated navigation entry (no such scripted id)', () => {
			const gt = groundTruthOf();
			const answer = faithfulAnswer(gt);
			const mutated = [...answer.navigations.map(nav => ({ ...nav })), { id: 'n99', targetUrl: 'https://fabricated.example.com/', verdict: 'allow' as const, decidingLayer: 'driver', navigateCommandReachedTransport: true, journalRequestedUrl: 'https://fabricated.example.com/', journalSent: true }];
			const verification = verifyBrowserPolicyAnswer({ ...answer, navigations: mutated }, gt);
			assert.equal(verification.ok, false);
			assert.ok(verification.problems.some(problem => problem.includes('FABRICATED')));
		});

		test('FAILS a wrong deciding layer (mutation: n3 webRequest -> driver)', () => {
			const gt = groundTruthOf();
			const answer = faithfulAnswer(gt);
			const mutated = answer.navigations.map(nav => ({ ...nav }));
			mutated.find(nav => nav.id === 'n3')!.decidingLayer = 'driver';
			const verification = verifyBrowserPolicyAnswer({ ...answer, navigations: mutated }, gt);
			assert.equal(verification.ok, false);
			assert.ok(verification.problems.some(problem => problem.includes('n3') && problem.includes('decidingLayer')));
		});
	});

	suite('the deny-never-navigates law', () => {

		test('holds when no denied target produced a Page.navigate', () => {
			const gt = groundTruthOf();
			const denied = gt.navigations.filter(nav => nav.verdict === 'deny').map(nav => nav.targetUrl);
			const law = denyNeverNavigatesLaw(fabricatedBackdrop().sentCommands, denied);
			assert.equal(law.ok, true, law.violations.join('; '));
		});

		test('catches a leaked Page.navigate for a denied target', () => {
			const law = denyNeverNavigatesLaw(
				[{ id: 1, seq: 1, method: 'Page.navigate', params: { url: 'https://blocked-driver.example.com/x' }, sessionId: undefined }],
				['https://blocked-driver.example.com/x'],
			);
			assert.equal(law.ok, false);
			assert.equal(law.violations.length, 1);
		});
	});

	suite('the scenario ground truth', () => {

		test('derives the pinned layer denials (n2 driver, n3 webRequest, n4 willNavigate, n5 partition)', () => {
			const gt = groundTruthOf();
			const pinned: Readonly<Record<string, string>> = { n2: 'driver', n3: 'webRequest', n4: 'willNavigate', n5: 'partition' };
			for (const [id, layer] of Object.entries(pinned)) {
				const nav = gt.navigations.find(entry => entry.id === id);
				assert.equal(nav?.verdict, 'deny', `${id} must deny`);
				assert.equal(nav?.decidingLayer, layer, `${id} must decide at ${layer} (got ${nav?.decidingLayer})`);
				assert.equal(nav?.navigateCommandReachedTransport, false, `${id} (denied) must never produce a Page.navigate`);
			}
		});

		test('derives the policyFile class: the rejected file leaves deny-all in effect (n6)', () => {
			const gt = groundTruthOf();
			const n6 = gt.navigations.find(nav => nav.id === 'n6');
			assert.equal(n6?.verdict, 'deny');
			assert.equal(n6?.navigateCommandReachedTransport, false);
		});

		test('derives the redacted journal url for the secret-shaped query (n7)', () => {
			const gt = groundTruthOf();
			const n7 = gt.navigations.find(nav => nav.id === 'n7');
			assert.equal(n7?.verdict, 'allow');
			assert.ok(n7?.journalRequestedUrl.includes('[redacted]'), `expected the redacted form, got ${n7?.journalRequestedUrl}`);
			assert.ok(!n7?.journalRequestedUrl.includes('sk-live-abcdefghijklmnop'));
		});

		test('derives the drop/recovery ground truth: journal survives, re-attach appends, re-attach navigation allows', () => {
			const b = fabricatedBackdrop();
			const reattachRow = {
				...b.journalRecords[b.journalRecords.length - 1]!,
				ts: 1_700_000_999_000,
				navigation: { decision: 'allow' as const, requestedUrl: REATTACH_URL, committedUrl: REATTACH_URL, sent: true },
			};
			const gt = deriveBrowserPolicyGroundTruth({
				engines: b.engines,
				workspaceRoot: '/workspace/w7',
				matchingPartition: b.matchingPartition,
				foreignPartition: b.foreignPartition,
				sentCommands: [...b.sentCommands],
				journalRecords: [...b.journalRecords, reattachRow],
				journalRowsBeforeDrop: b.journalRecords.length,
			});
			assert.equal(gt.dropRecovery.journalRowsBeforeDrop, b.journalRecords.length);
			assert.equal(gt.dropRecovery.journalRowsAfterReattach, b.journalRecords.length + 1);
			assert.equal(gt.dropRecovery.preDropRowsSurvived, true);
			assert.equal(gt.dropRecovery.reattachedNavigation.verdict, 'allow');
			assert.equal(gt.dropRecovery.reattachedNavigation.navigateCommandReachedTransport, true);
		});
	});

	suite('the answer parse + the prompt', () => {

		test('parses a faithful document and rejects a wrong schema', () => {
			const gt = groundTruthOf();
			const text = JSON.stringify(faithfulAnswer(gt));
			const parsed = parseBrowserPolicyAnswer(text);
			assert.equal(parsed.ok, true);
			if (parsed.ok) {
				assert.equal(parsed.answer.navigations.length, gt.navigations.length);
			}
			assert.equal(parseBrowserPolicyAnswer('{"schema":"wrong"}').ok, false);
			assert.equal(parseBrowserPolicyAnswer('not json').ok, false);
		});

		test('builds the question with the facts embedded and the ground-truth hash pinned', () => {
			const gt = groundTruthOf();
			const built = buildBrowserPolicyQuestion(gt);
			assert.ok(built.prompt.includes('=== BROWSER-SESSION FACT'));
			assert.ok(built.prompt.includes('=== END browser-session facts ==='));
			assert.equal(built.excerpted, false);
			assert.match(built.groundTruthSha256, /^[0-9a-f]{64}$/);
		});

		test('applies the excerpt doctrine when the outcome map exceeds the budget', () => {
			const gt = groundTruthOf();
			const built = buildBrowserPolicyQuestion(gt, { excerptMaxChars: 200 });
			assert.equal(built.excerpted, true);
			assert.ok(built.prompt.includes('EXCERPT'));
		});
	});

	suite('the frictionlog validation (W7 pins)', () => {

		test('validates the drop-drill friction row shape', () => {
			const row = { schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'browser-policy:drop-drill', kind: 'browser-env-failure', detail: 'the transport was dropped', recovery: 'a fresh transport re-attached' };
			assert.deepEqual(validateFrictionLine(row), { ok: true });
		});

		test('rejects an invalid kind and a foreign schema', () => {
			assert.equal(validateFrictionLine({ schema: FRICTION_SCHEMA, type: 'friction', ts: 1, phase: 'p', kind: 'not-a-kind', detail: 'd', recovery: '' }).ok, false);
			assert.equal(validateFrictionLine({ schema: 'other/v9', type: 'friction', ts: 1, phase: 'p', kind: 'slow-path', detail: 'd', recovery: '' }).ok, false);
		});

		test('parses a whole log body and rejects a corrupt line', () => {
			const good = `${JSON.stringify({ schema: FRICTION_SCHEMA, type: 'timing', ts: 1, phase: 'p', durationMs: 5 })}\n`;
			assert.equal(parseFrictionLog(good).ok, true);
			assert.equal(parseFrictionLog(`${good}{not json\n`).ok, false);
		});
	});
});