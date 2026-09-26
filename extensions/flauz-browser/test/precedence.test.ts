/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Layered precedence: deny-at-any-layer wins; the driver-side allowlist is
 * AUTHORITATIVE for agent-initiated navigation (its deny wins over every
 * other layer, and its allow never overrides another layer's deny); the
 * willNavigate layer is only on the user path (B1c); kill-switch insurance;
 * fail-closed invariants; file roots; scheme policy; post-commit
 * reconciliation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserPolicyEngine, type BrowserPolicy, type LayerRules, type PolicyVerdict } from '../src/policy.ts';

const NO_PARTITION = undefined;
const NO_ROOT = undefined;

function layerRules(patch: Partial<LayerRules> = {}): LayerRules {
	return { enabled: true, allow: [], deny: [], fileRoots: [], ...patch };
}

function policy(patch: Partial<Record<'driver' | 'webRequest' | 'willNavigate', LayerRules>> = {}): BrowserPolicy {
	return {
		schemaVersion: 0,
		driver: patch.driver ?? layerRules(),
		webRequest: patch.webRequest ?? layerRules(),
		willNavigate: patch.willNavigate ?? layerRules(),
		partitions: { scope: 'persist', perAgent: false },
	};
}

function engineWith(rules: { driver?: Partial<LayerRules>; webRequest?: Partial<LayerRules>; willNavigate?: Partial<LayerRules> }): BrowserPolicyEngine {
	return new BrowserPolicyEngine({
		policy: policy({
			driver: layerRules(rules.driver),
			webRequest: layerRules(rules.webRequest),
			willNavigate: layerRules(rules.willNavigate),
		}),
	});
}

function agent(engine: BrowserPolicyEngine, url: string): PolicyVerdict {
	return engine.evaluate({ url, initiator: 'agent-tool', partition: NO_PARTITION, workspaceRoot: NO_ROOT }).final;
}

function user(engine: BrowserPolicyEngine, url: string): PolicyVerdict {
	return engine.evaluate({ url, initiator: 'user', partition: NO_PARTITION, workspaceRoot: NO_ROOT }).final;
}

// #region Deny-at-any-layer wins

test('deny at any layer wins: driver allows, webRequest denies -> deny at webRequest', () => {
	const engine = engineWith({ driver: { allow: ['*'] }, webRequest: { deny: ['tracker.example.net'] } });
	const verdict = agent(engine, 'https://tracker.example.net/pixel');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'webRequest');
	assert.equal(verdict.rule, 'tracker.example.net');
});

test('deny at any layer wins: willNavigate denies a user navigation the webRequest layer would allow', () => {
	const engine = engineWith({ webRequest: { allow: ['*'] }, willNavigate: { deny: ['phish.example.org'] } });
	const verdict = user(engine, 'https://phish.example.org/login');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'willNavigate');
});

test('driver deny is authoritative: wins even when both other layers allow everything', () => {
	const engine = engineWith({ driver: { allow: ['*'], deny: ['evil.example.com'] }, webRequest: { allow: ['*'] }, willNavigate: { allow: ['*'] } });
	const verdict = agent(engine, 'https://evil.example.com/exfil');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'driver');
});

test('driver ALLOW never overrides another layer deny (B1c insurance precondition)', () => {
	const engine = engineWith({ driver: { allow: ['*'] }, webRequest: { allow: [] } });
	const verdict = agent(engine, 'https://anything.example.org/');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'webRequest');
});

test('allow verdict requires every consulted layer to allow', () => {
	const engine = engineWith({ driver: { allow: ['*.example.com'] }, webRequest: { allow: ['*.example.com'] } });
	const verdict = agent(engine, 'https://docs.example.com/x');
	assert.equal(verdict.decision, 'allow');
	const { layers } = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', partition: NO_PARTITION, workspaceRoot: NO_ROOT });
	assert.ok(layers.every(l => l.decision === 'allow'));
});

// #endregion

// #region Layer firing model (B1c: which layers are on which path)

test('agent-tool path consults driver then webRequest (willNavigate is not on the CDP path)', () => {
	const engine = engineWith({ driver: { allow: ['*'] }, webRequest: { allow: ['*'] } });
	const { layers } = engine.evaluate({ url: 'https://x.example.com/', initiator: 'agent-tool', partition: NO_PARTITION, workspaceRoot: NO_ROOT });
	assert.deepEqual(layers.map(l => l.layer), ['driver', 'webRequest']);
});

test('user path consults willNavigate then webRequest (the driver allowlist does not gate humans)', () => {
	const engine = engineWith({ driver: { allow: [] }, webRequest: { allow: ['*'] }, willNavigate: { allow: ['*'] } });
	const { layers } = engine.evaluate({ url: 'https://x.example.com/', initiator: 'user', partition: NO_PARTITION, workspaceRoot: NO_ROOT });
	assert.deepEqual(layers.map(l => l.layer), ['willNavigate', 'webRequest']);
	assert.equal(user(engine, 'https://x.example.com/').decision, 'allow');
});

test('a navigation that skips will-navigate (CDP-initiated) is still denied by driver + webRequest', () => {
	// The exact B1c shape: willNavigate rules exist and would allow, but the
	// navigation is CDP-initiated and never fires them; driver + webRequest
	// must carry the deny on their own.
	const engine = engineWith({ driver: { allow: ['*.example.com'] }, webRequest: { allow: ['*.example.com'] }, willNavigate: { allow: ['*'] } });
	const verdict = agent(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'driver');
});

// #endregion

// #region Kill-switch insurance (B1c: each layer disabled, the others still deny)

test('insurance: driver kill-switched, non-allowlisted URL still denied by webRequest', () => {
	const engine = engineWith({ driver: { enabled: false, allow: ['*'] }, webRequest: { allow: ['*.example.com'] } });
	const verdict = agent(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'webRequest');
});

test('insurance: webRequest kill-switched, non-allowlisted URL still denied by driver', () => {
	const engine = engineWith({ driver: { allow: ['*.example.com'] }, webRequest: { enabled: false, allow: ['*'] } });
	const verdict = agent(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'driver');
});

test('insurance: willNavigate kill-switched (the live default for CDP navs), agent nav still denied by driver', () => {
	const engine = engineWith({ driver: { allow: ['*.example.com'] }, webRequest: { allow: ['*'] }, willNavigate: { enabled: false, allow: ['*'] } });
	const verdict = agent(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'driver');
});

test('insurance (user path): willNavigate kill-switched, non-allowlisted user nav still denied by webRequest', () => {
	const engine = engineWith({ webRequest: { allow: ['*.example.com'] }, willNavigate: { enabled: false, allow: ['*'] } });
	const verdict = user(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'webRequest');
});

test('insurance (user path): webRequest kill-switched, non-allowlisted user nav still denied by willNavigate', () => {
	const engine = engineWith({ webRequest: { enabled: false, allow: ['*'] }, willNavigate: { allow: ['*.example.com'] } });
	const verdict = user(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'willNavigate');
});

test('kill-switched layer verdict is an allow with the insurance reason recorded', () => {
	const engine = engineWith({ driver: { enabled: false } });
	const verdict = engine.checkLayer('driver', 'https://evil.org/');
	assert.equal(verdict.decision, 'allow');
	assert.match(verdict.reason, /layer kill-switched/);
});

// #endregion

// #region Fail-closed invariants

test('fail-closed: every gate on the path kill-switched -> deny attributed to policyFile', () => {
	const engine = engineWith({ driver: { enabled: false, allow: ['*'] }, webRequest: { enabled: false, allow: ['*'] } });
	const verdict = agent(engine, 'https://evil.org/pay');
	assert.equal(verdict.decision, 'deny');
	assert.equal(verdict.layer, 'policyFile');
	assert.match(verdict.reason, /no enabled gate|kill-switched/);
});

test('fail-closed: empty policy (deny-all) denies everything, both paths', () => {
	const engine = new BrowserPolicyEngine({ policy: policy() });
	for (const url of ['https://a.org/', 'https://b.net/x', 'http://127.0.0.1:3000/']) {
		assert.equal(agent(engine, url).decision, 'deny', url);
		assert.equal(user(engine, url).decision, 'deny', url);
	}
});

test('fail-closed: unparseable URL is denied at every layer', () => {
	const engine = engineWith({ driver: { allow: ['*'] }, webRequest: { allow: ['*'] }, willNavigate: { allow: ['*'] } });
	const verdict = agent(engine, 'not a url at all');
	assert.equal(verdict.decision, 'deny');
	assert.match(verdict.reason, /unparseable navigation URL/);
});

test('no implicit localhost exemption (documented divergence from the tunnel-rewrite helper)', () => {
	const engine = engineWith({ driver: { allow: ['*.example.com'] }, webRequest: { allow: ['*'] } });
	assert.equal(agent(engine, 'http://localhost:3000/').decision, 'deny');
	const permissive = engineWith({ driver: { allow: ['localhost'] }, webRequest: { allow: ['*'] } });
	assert.equal(agent(permissive, 'http://localhost:3000/').decision, 'allow');
});

// #endregion

// #region Scheme policy

test('driver layer denies non-drivable schemes (data:, chrome:, vscode-webview:) even with allow-all hosts', () => {
	const engine = engineWith({ driver: { allow: ['*'] }, webRequest: { allow: ['*'] } });
	for (const url of ['data:text/html,hello', 'chrome://version', 'vscode-webview://panel-x/index.html']) {
		const verdict = agent(engine, url);
		assert.equal(verdict.decision, 'deny', url);
		assert.match(verdict.reason, /not agent-drivable at the driver layer/);
	}
});

test('webRequest + willNavigate mirror the tree: no-authority schemes pass those layers', () => {
	const engine = engineWith({ webRequest: { allow: [] }, willNavigate: { allow: [] } });
	assert.equal(engine.checkLayer('webRequest', 'data:text/html,hello').decision, 'allow');
	assert.equal(engine.checkLayer('willNavigate', 'vscode-webview://panel-x/').decision, 'allow');
});

test('about:blank is always allowed on every layer and path', () => {
	const engine = new BrowserPolicyEngine({ policy: policy() });
	assert.equal(agent(engine, 'about:blank').decision, 'allow');
	assert.equal(user(engine, 'about:blank').decision, 'allow');
	assert.equal(engine.checkLayer('driver', 'about:blank').decision, 'allow');
});

// #endregion

// #region file:// roots (driver-layer trusted roots)

test('file:// under a trusted absolute root is allowed at the driver layer', () => {
	const engine = engineWith({ driver: { allow: ['*'], fileRoots: ['/tmp/trusted'] } });
	assert.equal(agent(engine, 'file:///tmp/trusted/report.png').decision, 'allow');
	assert.equal(agent(engine, 'file:///tmp/trusted/sub/dir/data.json').decision, 'allow');
});

test('file:// outside every trusted root is denied at the driver layer (traversal-proof)', () => {
	const engine = engineWith({ driver: { allow: ['*'], fileRoots: ['/tmp/trusted'] } });
	assert.equal(agent(engine, 'file:///etc/passwd').decision, 'deny');
	assert.equal(agent(engine, 'file:///tmp/trusted-secrets/keys').decision, 'deny', 'prefix match must not slide past a path boundary');
	assert.equal(agent(engine, 'file:///tmp/trustedor/../etc/passwd').decision, 'deny');
});

test('file:// with no configured roots is denied (deny-all default)', () => {
	const engine = engineWith({ driver: { allow: ['*'] } });
	const verdict = agent(engine, 'file:///tmp/anything');
	assert.equal(verdict.decision, 'deny');
	assert.match(verdict.reason, /no trusted fileRoots configured/);
});

test('workspace-relative fileRoots resolve against the workspace root', () => {
	const engine = engineWith({ driver: { allow: ['*'], fileRoots: ['.flauz'] } });
	const verdict = engine.evaluate({ url: 'file:///ws/acme/.flauz/artifacts/T-001/shot.png', initiator: 'agent-tool', partition: NO_PARTITION, workspaceRoot: '/ws/acme' }).final;
	assert.equal(verdict.decision, 'allow');
	const noRoot = engine.evaluate({ url: 'file:///ws/acme/.flauz/artifacts/T-001/shot.png', initiator: 'agent-tool', partition: NO_PARTITION, workspaceRoot: NO_ROOT }).final;
	assert.equal(noRoot.decision, 'deny');
	assert.match(noRoot.reason, /cannot be resolved without a workspaceRoot context/);
});

test('file URIs pass the webRequest and willNavigate layers (mirrors the in-tree filter)', () => {
	const engine = new BrowserPolicyEngine({ policy: policy() });
	assert.equal(engine.checkLayer('webRequest', 'file:///etc/passwd').decision, 'allow');
	assert.equal(engine.checkLayer('willNavigate', 'file:///etc/passwd').decision, 'allow');
});

test('file:// with a remote host is denied at the driver layer', () => {
	const engine = engineWith({ driver: { allow: ['*'], fileRoots: ['/', '/mnt/share'] } });
	assert.equal(agent(engine, 'file://server/share/doc.txt').decision, 'deny');
});

// #endregion

// #region Post-commit reconciliation (SECURITY-MODEL section 4 F2)

test('reconcileCommittedUrl flags a violating committed URL with the about:blank reset', () => {
	const engine = engineWith({ webRequest: { allow: ['*.example.com'] } });
	const result = engine.reconcileCommittedUrl('https://evil.org/pay');
	assert.equal(result.violation, true);
	assert.equal(result.resetTo, 'about:blank');
	assert.equal(result.verdict.decision, 'deny');
	assert.match(result.verdict.reason, /post-commit violation/);
	assert.match(result.verdict.reason, /force about:blank and ledger the attempt/);
});

test('reconcileCommittedUrl passes a clean committed URL with no reset', () => {
	const engine = engineWith({ webRequest: { allow: ['*.example.com'] } });
	const result = engine.reconcileCommittedUrl('https://docs.example.com/after');
	assert.equal(result.violation, false);
	assert.equal(result.resetTo, undefined);
	assert.equal(result.verdict.decision, 'allow');
});

// #endregion

// #region Verdict object shape (audit contract)

test('verdict objects carry allow/deny + layer + reason + audit context', () => {
	const engine = engineWith({ driver: { allow: ['*.example.com'] } });
	const verdict = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', partition: 'persist:flauz-0123456789abcdef', workspaceRoot: NO_ROOT, ts: 42 }).final;
	assert.equal(verdict.decision, 'deny', 'webRequest deny-all carries the deny');
	assert.equal(verdict.layer, 'webRequest');
	assert.ok(verdict.reason.length > 0);
	assert.equal(verdict.url, 'https://docs.example.com/x');
	assert.equal(verdict.partition, 'persist:flauz-0123456789abcdef');
	assert.equal(verdict.initiator, 'agent-tool');
	assert.equal(verdict.policyVersion, 0);
	assert.equal(verdict.policySource, 'builtin-default');
	assert.equal(verdict.ts, 42);
});

// #endregion
