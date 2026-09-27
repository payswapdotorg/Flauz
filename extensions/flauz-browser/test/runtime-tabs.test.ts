/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The policy-gated navigation pipeline tests (TL3-001, posture P0): the
 * driver-side verdict is AUTHORITATIVE for agent navigations.
 *
 *   - DENY  => ZERO `Page.navigate` commands are sent AT ALL (asserted on the
 *              FakeCdpTransport sent-command log — the pinned invariant).
 *   - ALLOW => `Page.navigate` sent + the committed URL is reconciled
 *              (`reconcileCommittedUrl`).
 *   - post-commit VIOLATION (a redirect to a webRequest-denied host) => the
 *              forced-reset recommendation (`about:blank`) + evidence row
 *              (SECURITY-MODEL section 4 F2 semantics).
 *   - resetTab executes the forced reset; evidence rows carry the exact
 *              toEvidenceRow shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';

const WORKSPACE_ROOT = '/ws/acme';

const PIPELINE_POLICY = JSON.stringify({
        schemaVersion: 0,
        driver: { allow: ['*.example.com'] },
        webRequest: { allow: ['*.example.com'] },
        willNavigate: { allow: ['*.example.com'] },
        partitions: { scope: 'persist', perAgent: true },
});

interface TabRig {
        state: FakeBrowserState;
        manager: BrowserSessionManager;
        transports: FakeCdpTransport[];
}

function rig(policyText: string = PIPELINE_POLICY): TabRig {
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

async function openAgentSession(rigInstance: TabRig): Promise<string> {
        const opened = await rigInstance.manager.open({ initiator: 'agent', agentId: 'worker-1' });
        assert.equal(opened.descriptor.state, 'active');
        return opened.descriptor.sessionId;
}

test('DENY => ZERO Page.navigate commands (the pinned invariant), verdict + evidence row returned, tab untouched', async () => {
        const tabRig = rig();
        const sessionId = await openAgentSession(tabRig);
        const navigateCommandsBefore = tabRig.transports[0]?.pageNavigateCommands().length ?? 0;
        assert.equal(navigateCommandsBefore, 0, 'session open (about:blank tab) sends no Page.navigate');

        const outcome = await tabRig.manager.navigate(sessionId, 'https://evil.org/pay');
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, false, 'the pipeline never sent the navigation');
        assert.equal(outcome.verdict.decision, 'deny');
        assert.equal(outcome.verdict.layer, 'driver');
        assert.equal(outcome.verdict.initiator, 'agent-tool');
        assert.equal(outcome.verdict.partition, tabRig.manager.getSession(sessionId)?.partition);
        // THE invariant — no CDP navigation command AT ALL was sent for the denied URL:
        assert.equal(tabRig.transports[0]?.pageNavigateCommands().length, 0, 'ZERO Page.navigate commands after the deny');
        assert.ok(tabRig.transports.every(transport => transport.sentCommands.every(command => command.method !== 'Page.navigate')));
        // the evidence row has the exact toEvidenceRow shape:
        assert.equal(outcome.evidenceRow.kind, 'note');
        assert.match(outcome.evidenceRow.sha256, /^[0-9a-f]{64}$/);
        assert.match(outcome.evidenceRow.note, /^deny\/driver agent-tool https:\/\/evil\.org\/pay/);
        // the tab stays on about:blank:
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank');
        await tabRig.manager.dispose();
});

test('ALLOW => Page.navigate sent, committed URL recorded + reconciled clean, evidence row returned', async () => {
        const tabRig = rig();
        const sessionId = await openAgentSession(tabRig);
        const outcome = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/guide');
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, true);
        assert.equal(outcome.verdict.decision, 'allow');
        assert.equal(outcome.committedUrl, 'https://docs.example.com/guide');
        assert.equal(outcome.violation, undefined);
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'https://docs.example.com/guide');
        const navigations = tabRig.transports[0]?.pageNavigateCommands() ?? [];
        assert.equal(navigations.length, 1);
        assert.deepEqual(navigations[0]?.params, { url: 'https://docs.example.com/guide' });
        // allow evidence: the gate verdict for the requested URL:
        assert.match(outcome.evidenceRow.note, /^allow\/[a-zA-Z]+ agent-tool https:\/\/docs\.example\.com\/guide/);
        await tabRig.manager.dispose();
});

test('post-commit VIOLATION (redirect drill): committed URL re-checked => about:blank reset recommendation + evidence row', async () => {
        const tabRig = rig();
        // request a driver-allowed URL that COMMITs to a webRequest-denied host
        // (the B1c residual: canceling content does not roll the URL back):
        tabRig.state.commitUrlMapper = requested => requested === 'https://docs.example.com/trap'
                ? 'https://tracker.example.net/x'
                : requested;
        const sessionId = await openAgentSession(tabRig);
        const outcome = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/trap');
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, true);
        assert.equal(outcome.committedUrl, 'https://tracker.example.net/x', 'the pipeline observed the COMMITTED url, not the request');
        assert.notEqual(outcome.violation, undefined, 'post-commit violation flagged');
        assert.equal(outcome.violation?.resetTo, 'about:blank', 'SECURITY-MODEL F2 forced-reset recommendation');
        assert.equal(outcome.violation?.verdict.decision, 'deny');
        assert.equal(outcome.violation?.verdict.layer, 'webRequest');
        assert.match(outcome.evidenceRow.note, /post-commit violation/, 'the evidence row is the reconciliation verdict');
        // TL3-002 G6 EXECUTION (security.enforceReset defaults true): the reset
        // is EXECUTED on the runtime-owned tab THROUGH the policy engine — the
        // tab lands on about:blank and the outcome records the execution. The
        // violating URL stays on the audit surfaces (committedUrl + evidence row).
        assert.equal(outcome.violation?.resetExecuted?.resetTo, 'about:blank', 'the executed reset is the narrow typed operation');
        assert.equal(outcome.violation?.resetExecuted?.sent, true);
        assert.equal(outcome.violation?.resetExecuted?.committedUrl, 'about:blank');
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank', 'the offending tab was reset to about:blank');
        const navigations = tabRig.transports[0]?.pageNavigateCommands() ?? [];
        assert.deepEqual(navigations.map(command => command.params['url']), ['https://docs.example.com/trap', 'about:blank'], 'the violating navigation + the enforced reset both hit the wire, nothing else');
        await tabRig.manager.dispose();
});

test('resetTab: executes the forced reset to about:blank (gated like every navigation; structurally allowed)', async () => {
        const tabRig = rig();
        const sessionId = await openAgentSession(tabRig);
        const first = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/a');
        assert.ok(isNavigationOutcome(first) && first.sent);
        const reset = await tabRig.manager.resetTab(sessionId);
        assert.ok(isNavigationOutcome(reset));
        assert.equal(reset.sent, true);
        assert.equal(reset.committedUrl, 'about:blank');
        assert.equal(reset.verdict.decision, 'allow');
        const navigations = tabRig.transports[0]?.pageNavigateCommands() ?? [];
        assert.deepEqual(navigations.map(command => command.params['url']), ['https://docs.example.com/a', 'about:blank']);
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank');
        await tabRig.manager.dispose();
});

test('a navigation DENIED mid-session never advances the tab (sequential deny/allow/deny)', async () => {
        const tabRig = rig();
        const sessionId = await openAgentSession(tabRig);
        const denied = await tabRig.manager.navigate(sessionId, 'https://evil.org/1');
        assert.ok(isNavigationOutcome(denied) && denied.sent === false);
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'about:blank');
        const allowed = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/ok');
        assert.ok(isNavigationOutcome(allowed) && allowed.sent === true);
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'https://docs.example.com/ok');
        const deniedAgain = await tabRig.manager.navigate(sessionId, 'https://evil.org/2');
        assert.ok(isNavigationOutcome(deniedAgain) && deniedAgain.sent === false);
        assert.equal(tabRig.manager.getSession(sessionId)?.tabs[0]?.url, 'https://docs.example.com/ok', 'deny leaves the committed URL untouched');
        const urls = (tabRig.transports[0]?.pageNavigateCommands() ?? []).map(command => command.params['url']);
        assert.deepEqual(urls, ['https://docs.example.com/ok'], 'only the allowed navigation ever hit the wire');
        await tabRig.manager.dispose();
});

test('navigation with an explicit tabId targets THAT tab; unknown tabId errors', async () => {
        const tabRig = rig();
        const sessionId = await openAgentSession(tabRig);
        const tabId = tabRig.manager.getSession(sessionId)?.tabs[0]?.tabId ?? '';
        const outcome = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/x', { tabId });
        assert.ok(isNavigationOutcome(outcome) && outcome.tabId === tabId);
        const missed = await tabRig.manager.navigate(sessionId, 'https://docs.example.com/x', { tabId: 'flauz:tab:0000000000000000' });
        assert.ok(!isNavigationOutcome(missed));
        assert.equal((missed as { error: { code: string } }).error.code, 'flauz.browser.tab.unknown');
        await tabRig.manager.dispose();
});

test('human path through the same pipeline: allowed where the agent path is denied (B1c firing model)', async () => {
        const tabRig = rig();
        const human = await tabRig.manager.open({ initiator: 'human' });
        assert.equal(human.descriptor.state, 'active');
        // *.example.com is in willNavigate + webRequest, so the human path allows it;
        // the agent path would also allow it here — the DENY asymmetry is pinned in
        // session-manager.test.ts; here we pin the human path plumbing end-to-end:
        const outcome = await tabRig.manager.navigate(human.descriptor.sessionId, 'https://docs.example.com/human');
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, true);
        assert.equal(outcome.verdict.initiator, 'user');
        assert.equal(outcome.committedUrl, 'https://docs.example.com/human');
        await tabRig.manager.dispose();
});
