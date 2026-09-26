/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Env-switch continuity model tests (N-8): artifact classification, switch
 * state machine, switch-plan emission, PERF 5.5 overhead accounting.
 *
 * Run: node --test test/ (Node >= 23.6 type stripping, zero dependencies).
 */
import { test } from 'node:test';
import { ok, strictEqual, deepStrictEqual, throws } from 'node:assert';

import {
	CONTINUITY_ARTIFACTS,
	classifyWorkspaceState,
	applySwitchEvent,
	canApplyEvent,
	SWITCH_TRANSITIONS,
	planSwitch,
	checkOverhead,
	SWITCH_MARKS,
	WARM_SWITCH_BUDGET_MS,
	CHOREOGRAPHY_BUDGET_MS,
	PERSIST_PHASE_BUDGET_MS,
	REHYDRATE_PHASE_BUDGET_MS,
	artifactFor,
} from '../src/continuity.ts';
import { validateDescriptor } from '../src/providers/index.ts';
import { readFixtureJson } from './helpers.ts';

async function loadDescriptor(...segments: readonly string[]): Promise<Parameters<typeof planSwitch>[1]> {
	return validateDescriptor(await readFixtureJson('good', ...segments));
}

test('the canon classifies all three continuity classes with tree citations', () => {
	strictEqual(CONTINUITY_ARTIFACTS.length, 16);
	const persists = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'persists').map(a => a.id);
	const rehydrates = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'rehydrates').map(a => a.id);
	const lost = CONTINUITY_ARTIFACTS.filter(a => a.continuityClass === 'lost').map(a => a.id);
	deepStrictEqual(persists, ['flauz-tasks-envelope', 'flauz-evidence-ledger', 'flauz-evidence-artifacts', 'flauz-environments-registry', 'scm-working-tree']);
	deepStrictEqual(rehydrates, ['chat-sessions', 'chat-editing-checkpoints', 'edit-sessions', 'agent-sessions', 'flauz-task-state-machine', 'persisted-approvals']);
	deepStrictEqual(lost, ['terminal-scrollback', 'browser-pane-state', 'inflight-chat-streams', 'window-layout', 'resolver-connection-state']);
	for (const artifact of CONTINUITY_ARTIFACTS) {
		ok(artifact.treeRef.length > 10, `${artifact.id}: treeRef cited`);
	}
});

test('classification pins the contract: .flauz/ state + git persist; sessions re-hydrate; renderer-local is lost', async () => {
	const report = classifyWorkspaceState({ surfaces: (await readFixtureJson('continuity', 'snapshot-all.json') as { surfaces: string[] }).surfaces });
	strictEqual(report.persists.length, 5);
	strictEqual(report.rehydrates.length, 6);
	strictEqual(report.lost.length, 5);
	ok(report.persists.some(a => a.id === 'flauz-environments-registry'), 'the registry itself persists (re-open continuity substrate)');
	ok(report.rehydrates.some(a => a.id === 'chat-sessions'), 'chat sessions re-hydrate (IChatSessionsService)');
	ok(report.lost.some(a => a.id === 'terminal-scrollback'), 'terminal scrollback is lost');
});

test('classification rejects unknown + duplicate surfaces (the canon is closed)', () => {
	throws(() => classifyWorkspaceState({ surfaces: ['coffee-machine-state'] }), /unknown continuity artifact/);
	throws(() => classifyWorkspaceState({ surfaces: ['flauz-tasks-envelope', 'flauz-tasks-envelope'] }), /duplicate surface/);
	throws(() => artifactFor('nope'), /unknown continuity artifact/);
});

test('switch state machine: full golden path idle -> active, and fail from every in-flight state', () => {
	let state = 'idle' as never as ReturnType<typeof applySwitchEvent>;
	state = applySwitchEvent(state, 'begin-switch');
	strictEqual(state, 'persisting');
	state = applySwitchEvent(state, 'persist-complete');
	strictEqual(state, 'persisted');
	state = applySwitchEvent(state, 'reopen');
	strictEqual(state, 'reopening');
	state = applySwitchEvent(state, 'reconnect');
	strictEqual(state, 'reconnecting');
	state = applySwitchEvent(state, 'resolver-ready');
	strictEqual(state, 'rehydrating');
	state = applySwitchEvent(state, 'rehydrate-complete');
	strictEqual(state, 'active');
	for (const from of ['persisting', 'persisted', 'reopening', 'reconnecting', 'rehydrating'] as const) {
		strictEqual(applySwitchEvent(from, 'fail'), 'idle', `fail from ${from} returns to idle`);
	}
});

test('switch state machine rejects illegal events (N-8: no skipping the re-open pivot)', () => {
	throws(() => applySwitchEvent('idle', 'persist-complete'), /illegal from state 'idle'/);
	throws(() => applySwitchEvent('persisting', 'reopen'), /illegal from state 'persisting'/);
	throws(() => applySwitchEvent('idle', 'rehydrate-complete'), /illegal from state 'idle'/);
	throws(() => applySwitchEvent('active', 'begin-switch'), /illegal from state 'active'/);
	strictEqual(canApplyEvent('idle', 'begin-switch'), true);
	strictEqual(canApplyEvent('idle', 'reopen'), false);
	strictEqual(SWITCH_TRANSITIONS.filter(rule => rule.type === 'fail')[0]!.from.length, 5, 'fail legal from all 5 in-flight states');
});

test('switch plan: re-open mechanism, phases chained with the connection plan, budgets, artifact classes', async () => {
	const from = await loadDescriptor('descriptor-ssh.json');
	const to = await loadDescriptor('descriptor-cloud-sandbox.json');
	const plan = planSwitch(from, to);
	strictEqual(plan.$schema, 'flauz.switchPlan/v0');
	strictEqual(plan.fromEnvironmentId, 'env-build-box');
	strictEqual(plan.toEnvironmentId, 'env-e2b-main');
	strictEqual(plan.toAuthority, 'e2b+env-e2b-main');
	strictEqual(plan.mechanism, 're-open', 'N-8: continuity is re-open-based');
	deepStrictEqual(plan.phases.map(p => p.id), ['persist', 'reopen', 'reconnect', 'rehydrate']);
	deepStrictEqual(plan.budgets, { warmSwitchMs: WARM_SWITCH_BUDGET_MS, choreographyMs: CHOREOGRAPHY_BUDGET_MS });
	strictEqual(plan.phases[0]!.budgetMs, PERSIST_PHASE_BUDGET_MS);
	strictEqual(plan.phases[3]!.budgetMs, REHYDRATE_PHASE_BUDGET_MS);
	strictEqual(plan.phases[0]!.budgetMs + plan.phases[3]!.budgetMs, CHOREOGRAPHY_BUDGET_MS, 'persist + rehydrate = the choreography budget');
	deepStrictEqual(plan.phases[0]!.artifactIds.filter(id => id !== undefined).length, 5, 'persist phase covers all persists artifacts');
	strictEqual(plan.phases[3]!.artifactIds.length, 6, 'rehydrate phase covers all rehydrates artifacts');
	deepStrictEqual(plan.phases[0]!.marks, [SWITCH_MARKS.willPersist, SWITCH_MARKS.didPersist]);
	deepStrictEqual(plan.phases[3]!.marks, [SWITCH_MARKS.willRehydrate, SWITCH_MARKS.didRehydrate]);
	strictEqual(plan.artifacts.lost.length, 5, 'lost artifacts listed so UX can warn');
});

test('switch plan from local (null) is legal -- first environment activation', async () => {
	const to = await loadDescriptor('descriptor-workspace-remote.json');
	const plan = planSwitch(null, to);
	strictEqual(plan.fromEnvironmentId, null);
	strictEqual(plan.toAuthority, 'test+env-tunnel-remote');
});

test('overhead accounting: PERF 5.5 budgets + mark pairs + verdicts', () => {
	strictEqual(WARM_SWITCH_BUDGET_MS, 1500, 'PERF 5.5 warm switch budget');
	strictEqual(CHOREOGRAPHY_BUDGET_MS, 500, 'PERF 5.5 choreography budget');
	deepStrictEqual(SWITCH_MARKS, {
		willPersist: 'code/flauz/willPersistEnvSwitch',
		didPersist: 'code/flauz/didPersistEnvSwitch',
		willRehydrate: 'code/flauz/willRehydrateEnvSwitch',
		didRehydrate: 'code/flauz/didRehydrateEnvSwitch',
	}, 'code/flauz/* mark pairs (DL-23 forwarding posture)');
	ok(checkOverhead('persist', 199).withinBudget);
	ok(!checkOverhead('persist', 201).withinBudget);
	ok(checkOverhead('rehydrate', 300).withinBudget);
	ok(!checkOverhead('rehydrate', 301).withinBudget);
	ok(checkOverhead('warm-switch', 1500).withinBudget);
	ok(!checkOverhead('warm-switch', 1501).withinBudget);
	const verdict = checkOverhead('persist', 42);
	deepStrictEqual(verdict.markPair, [SWITCH_MARKS.willPersist, SWITCH_MARKS.didPersist]);
	throws(() => checkOverhead('persist', -1), /non-negative finite/);
	throws(() => checkOverhead('persist', Number.NaN), /non-negative finite/);
});
