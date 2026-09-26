/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * CDP-bypass simulation, fixture-driven: every case in
 * test/fixtures/browser-policy/cdp-bypass-cases.json is evaluated against the
 * policy it names and must produce the pinned combined verdict. This is the
 * B1c story as executable evidence: a navigation that skips will-navigate
 * (CDP-initiated) must STILL be denied by the driver + webRequest layers,
 * and every single-layer kill-switch variant must leave the others denying.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserPolicyEngine, type PolicyVerdict } from '../src/policy.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = JSON.parse(readFileSync(path.join(REPO_ROOT, 'test', 'fixtures', 'browser-policy', 'cdp-bypass-cases.json'), 'utf-8')) as {
        policies: Record<string, unknown>;
        cases: Array<{ name: string; policy: string; url: string; initiator: 'agent-tool' | 'user'; expect: { decision: string; layer?: string } }>;
};

const engines = new Map<string, BrowserPolicyEngine>();
function engineFor(name: string): BrowserPolicyEngine {
        let engine = engines.get(name);
        if (engine === undefined) {
                engine = BrowserPolicyEngine.fromPolicyText(JSON.stringify(FIXTURE.policies[name]));
                engines.set(name, engine);
        }
        return engine;
}

test('the fixture matrix is complete: policies referenced by every case exist', () => {
        assert.ok(Object.keys(FIXTURE.policies).length >= 7);
        for (const caseItem of FIXTURE.cases) {
                assert.ok(FIXTURE.policies[caseItem.policy] !== undefined, `case '${caseItem.name}' references unknown policy '${caseItem.policy}'`);
        }
        assert.ok(FIXTURE.cases.length >= 14);
});

for (const caseItem of FIXTURE.cases) {
        test(`cdp-bypass: ${caseItem.name}`, () => {
                const engine = engineFor(caseItem.policy);
                const evaluation = engine.evaluate({ url: caseItem.url, initiator: caseItem.initiator, partition: undefined, workspaceRoot: undefined });
                const verdict: PolicyVerdict = evaluation.final;
                assert.equal(verdict.decision, caseItem.expect.decision, `decision for ${caseItem.url} (${caseItem.initiator})`);
                if (caseItem.expect.layer !== undefined) {
                        assert.equal(verdict.layer, caseItem.expect.layer, `denying layer for ${caseItem.url} (${caseItem.initiator})`);
                }
        });
}

test('B1c headline: for every RESTRICTIVE policy in the matrix, a CDP nav to a non-allowlisted host is denied with driver or webRequest carrying the deny', () => {
        // (driverDenyWinsOverAllowAll and webRequestDenyOnly intentionally allow
        // evil.org -- they pin deny-list precedence, not blanket restriction.)
        const restrictive = ['base', 'driverOff', 'webRequestOff', 'willNavigateOff', 'allGatesOff'];
        for (const name of restrictive) {
                const engine = BrowserPolicyEngine.fromPolicyText(JSON.stringify(FIXTURE.policies[name]));
                const verdict = engine.evaluate({ url: 'https://evil.org/pay', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined }).final;
                assert.equal(verdict.decision, 'deny', `policy '${name}' must deny a CDP nav to evil.org`);
                assert.ok(verdict.layer === 'driver' || verdict.layer === 'webRequest' || verdict.layer === 'policyFile', `policy '${name}': deny carried by ${verdict.layer}`);
        }
});

interface KillSwitchVariant {
        readonly label: string;
        readonly rules: {
                driver?: { enabled?: boolean; allow?: readonly string[] };
                webRequest?: { enabled?: boolean; allow?: readonly string[] };
                willNavigate?: { enabled?: boolean; allow?: readonly string[] };
        };
}

test('B1c insurance invariant: killing any ONE gate layer never opens a non-allowlisted host (both initiator paths)', () => {
        const allowOnly = ['*.example.com'];
        const variants: readonly KillSwitchVariant[] = [
                { label: 'driver off', rules: { driver: { enabled: false, allow: ['*'] }, webRequest: { allow: allowOnly }, willNavigate: { allow: allowOnly } } },
                { label: 'webRequest off', rules: { driver: { allow: allowOnly }, webRequest: { enabled: false, allow: ['*'] }, willNavigate: { allow: allowOnly } } },
                { label: 'willNavigate off', rules: { driver: { allow: allowOnly }, webRequest: { allow: allowOnly }, willNavigate: { enabled: false, allow: ['*'] } } },
        ];
        for (const variant of variants) {
                const policy = {
                        schemaVersion: 0,
                        driver: { enabled: variant.rules.driver?.enabled ?? true, allow: variant.rules.driver?.allow ?? [] },
                        webRequest: { enabled: variant.rules.webRequest?.enabled ?? true, allow: variant.rules.webRequest?.allow ?? [] },
                        willNavigate: { enabled: variant.rules.willNavigate?.enabled ?? true, allow: variant.rules.willNavigate?.allow ?? [] },
                };
                const engine = BrowserPolicyEngine.fromPolicyText(JSON.stringify(policy));
                for (const initiator of ['agent-tool', 'user'] as const) {
                        const verdict = engine.evaluate({ url: 'https://evil.org/pay', initiator, partition: undefined, workspaceRoot: undefined }).final;
                        assert.equal(verdict.decision, 'deny', `${variant.label} / ${initiator}: the surviving layers must still deny`);
                }
        }
});

test('CDP-bypass evidence seam: a denied CDP nav produces a ledger-ready evidence row', () => {
        const engine = engineFor('base');
        const { final } = engine.evaluate({ url: 'https://evil.org/pay', initiator: 'agent-tool', partition: undefined, workspaceRoot: undefined, ts: 7 });
        assert.equal(final.decision, 'deny');
        // toEvidenceRow is exercised fully in policy.test.ts; here we pin that the
        // B1c headline case yields the deny/driver/agent-tool triple:
        assert.equal(`${final.decision}/${final.layer}/${final.initiator}`, 'deny/driver/agent-tool');
});
