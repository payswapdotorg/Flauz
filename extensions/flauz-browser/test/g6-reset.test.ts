/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * G6 forced-reset EXECUTION tests (TL3-002 item 3.4, runtime side): the
 * narrow typed `reset` operation and the security.enforceReset policy key.
 *
 *   - resetTab is the narrow typed operation: it takes NO url and its only
 *     navigation target is the literal about:blank (pinned on the wire);
 *   - default (key absent / true): a post-commit violation EXECUTES the
 *     reset through the policy engine (violation.resetExecuted);
 *   - security.enforceReset=false: the explicit opt-out is RECORDED in the
 *     verdict, the execution is skipped, the tab stays on the violating URL;
 *   - the executed reset records its own evidence row.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

const WORKSPACE_ROOT = '/ws/acme';

function policyWith(security: string | undefined): string {
	return JSON.stringify({
		schemaVersion: 0,
		driver: { allow: ['*.example.com'] },
		webRequest: { allow: ['*.example.com'] },
		willNavigate: { allow: ['*.example.com'] },
		partitions: { scope: 'persist', perAgent: true },
		...(security === undefined ? {} : { security: JSON.parse(security) }),
	});
}

const ENFORCING_ABSENT = policyWith(undefined);
const OPTED_OUT = policyWith('{"enforceReset":false}');
const EXPLICITLY_ENFORCING = policyWith('{"enforceReset":true}');

interface ResetRig {
	state: FakeBrowserState;
	manager: BrowserSessionManager;
	transports: FakeCdpTransport[];
}

function rig(policyText: string): ResetRig {
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
			transports.push(transport);
			return transport;
		},
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(policyText),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return { state, manager, transports };
}

async function openNavigated(resetRig: ResetRig): Promise<string> {
	const opened = await resetRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
	assert.equal(opened.descriptor.state, 'active');
	return opened.descriptor.sessionId;
}

test('resetTab is the NARROW TYPED reset: no url parameter, and its only wire navigation is the literal about:blank', async () => {
	const resetRig = rig(ENFORCING_ABSENT);
	const sessionId = await openNavigated(resetRig);
	const first = await resetRig.manager.navigate(sessionId, 'https://docs.example.com/a');
	assert.ok(isNavigationOutcome(first) && first.sent);

	const reset = await resetRig.manager.resetTab(sessionId);
	assert.ok(isNavigationOutcome(reset), 'ForcedResetOutcome is a NavigationOutcome (isNavigationOutcome holds)');
	assert.equal(reset.resetTo, 'about:blank', 'the typed literal reset target');
	assert.equal(reset.requestedUrl, 'about:blank', 'a forced reset has NO free-form destination');
	assert.equal(reset.committedUrl, 'about:blank');
	assert.equal(reset.verdict.decision, 'allow');
	assert.match(reset.evidenceRow.note, /about:blank/);

	// THE narrowness pin — on the wire, the only navigation the reset ever
	// issued was about:blank (it structurally cannot navigate elsewhere):
	const navigations = resetRig.transports[0]?.pageNavigateCommands() ?? [];
	assert.deepEqual(navigations.map(command => command.params['url']), ['https://docs.example.com/a', 'about:blank']);
	assert.equal(resetRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank');
	await resetRig.manager.dispose();
});

test('default (key absent): a post-commit violation EXECUTES the reset through the policy engine (resetExecuted + own evidence row)', async () => {
	for (const [label, policy] of [['absent key', ENFORCING_ABSENT], ['explicit true', EXPLICITLY_ENFORCING]] as const) {
		const resetRig = rig(policy);
		resetRig.state.commitUrlMapper = requested => requested === 'https://docs.example.com/trap'
			? 'https://tracker.example.net/x'
			: requested;
		const sessionId = await openNavigated(resetRig);
		const outcome = await resetRig.manager.navigate(sessionId, 'https://docs.example.com/trap');
		assert.ok(isNavigationOutcome(outcome), label);
		assert.equal(outcome.committedUrl, 'https://tracker.example.net/x', `${label}: the violating commit is still observed + audited`);
		assert.equal(outcome.violation?.resetExecuted?.resetTo, 'about:blank', `${label}: the reset EXECUTED`);
		assert.equal(outcome.violation?.resetExecuted?.sent, true);
		assert.equal(outcome.violation?.resetExecuted?.committedUrl, 'about:blank');
		assert.match(outcome.violation?.resetExecuted?.evidenceRow.note ?? '', /about:blank/, `${label}: the executed reset records its own evidence row`);
		assert.equal(resetRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank');
		await resetRig.manager.dispose();
	}
});

test('security.enforceReset=false: the opt-out is RECORDED in the verdict; NO reset command hits the wire; the tab stays on the violating URL', async () => {
	const resetRig = rig(OPTED_OUT);
	resetRig.state.commitUrlMapper = requested => requested === 'https://docs.example.com/trap'
		? 'https://tracker.example.net/x'
		: requested;
	const sessionId = await openNavigated(resetRig);
	const outcome = await resetRig.manager.navigate(sessionId, 'https://docs.example.com/trap');
	assert.ok(isNavigationOutcome(outcome));
	assert.equal(outcome.sent, true);
	assert.equal(outcome.committedUrl, 'https://tracker.example.net/x');
	assert.notEqual(outcome.violation, undefined, 'the violation is still flagged');
	assert.equal(outcome.violation?.resetTo, 'about:blank', 'the recommendation still computes');
	assert.equal(outcome.violation?.resetExecuted, undefined, 'the EXECUTION is skipped (explicit opt-out)');
	assert.match(outcome.violation?.verdict.reason ?? '', /NOT executed: security\.enforceReset=false is an explicit opt-out/, 'the opt-out is recorded in the verdict');
	assert.match(outcome.evidenceRow.note, /post-commit violation/);
	// the tab keeps the violating committed URL (nothing navigated it away):
	assert.equal(resetRig.manager.getSession(sessionId)?.tabs[0]?.url, 'https://tracker.example.net/x');
	const navigations = resetRig.transports[0]?.pageNavigateCommands() ?? [];
	assert.deepEqual(navigations.map(command => command.params['url']), ['https://docs.example.com/trap'], 'only the requested navigation hit the wire — no reset');
	// resetTab REMAINS available as the explicit operator action (the narrow typed operation is not policy-gated away):
	const manual = await resetRig.manager.resetTab(sessionId);
	assert.ok(isNavigationOutcome(manual) && manual.committedUrl === 'about:blank');
	await resetRig.manager.dispose();
});

test('the executed reset cannot be re-targeted: about:blank is structurally allowed by every layer, even deny-all', async () => {
	// A deny-all policy denies everything except about:blank — the forced
	// reset still works (it can ONLY ever target the reset target).
	const resetRig = rig(JSON.stringify({ schemaVersion: 0, partitions: { scope: 'persist', perAgent: true } }));
	const sessionId = await openNavigated(resetRig);
	const denied = await resetRig.manager.navigate(sessionId, 'https://anything.example.com/');
	assert.ok(isNavigationOutcome(denied) && denied.sent === false, 'deny-all denies the navigation (ZERO commands)');
	const reset = await resetRig.manager.resetTab(sessionId);
	assert.ok(isNavigationOutcome(reset) && reset.sent === true && reset.committedUrl === 'about:blank', 'the forced reset navigates to the one structurally-allowed target');
	await resetRig.manager.dispose();
});
