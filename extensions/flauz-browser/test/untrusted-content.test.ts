/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Untrusted-content boundary tests (TL3-002 item 3.7): capture-derived
 * evidence rows that embed PAGE-DERIVED strings (console text, network URLs,
 * screenshot/tab URLs, popup URLs) carry the machine-checkable
 * `untrusted-content:` marker in the row note.
 *
 * This is a BOUNDARY MARKER, NOT CONTENT SANITIZATION: the raw page-derived
 * string stays in the note (forensically useful); consumers must treat
 * everything after the marker as untrusted. No sanitization claim is made —
 * pinned explicitly below (the marker does NOT alter the payload).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import { BrowserSessionManager, isNavigationOutcome } from '../src/runtime/sessionManager.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import {
        UNTRUSTED_CONTENT_MARKER,
        consoleEvidenceRow,
        isUntrustedContentNote,
        networkEvidenceRow,
        screenshotEvidenceRow,
        untrustedContentNote,
} from '../src/runtime/capture.ts';
import { canonicalJson, verdictCore } from '../src/policy.ts';

const WORKSPACE_ROOT = '/ws/acme';

const MARKER_POLICY = JSON.stringify({
        schemaVersion: 0,
        driver: { allow: ['*.example.com'] },
        webRequest: { allow: ['*.example.com'] },
        willNavigate: { allow: ['*.example.com'] },
        partitions: { scope: 'persist', perAgent: true },
});

interface MarkerRig {
        state: FakeBrowserState;
        manager: BrowserSessionManager;
        transports: FakeCdpTransport[];
        artifacts: { entries: unknown[] };
}

function rig(): MarkerRig {
        const state = new FakeBrowserState();
        const transports: FakeCdpTransport[] = [];
        const artifacts = { entries: [] as unknown[] };
        const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
                transportFactory: () => {
                        const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
                        transports.push(transport);
                        return transport;
                },
        });
        const manager = new BrowserSessionManager({
                engine: () => BrowserPolicyEngine.fromPolicyText(MARKER_POLICY),
                host,
                workspaceRoot: WORKSPACE_ROOT,
                taskId: 'task-7',
                commandTimeoutMs: 150,
                navigationTimeoutMs: 300,
        });
        return { state, manager, transports, artifacts };
}

test('the marker helpers: constant, idempotent prefix, machine-checkable predicate', () => {
        assert.equal(UNTRUSTED_CONTENT_MARKER, 'untrusted-content:');
        assert.equal(untrustedContentNote('console log: hello'), 'untrusted-content: console log: hello');
        assert.equal(untrustedContentNote(untrustedContentNote('x')), 'untrusted-content: x', 'idempotent');
        assert.equal(untrustedContentNote(''), 'untrusted-content: ');
        assert.ok(isUntrustedContentNote('untrusted-content: anything'));
        assert.ok(!isUntrustedContentNote('untrusted-content (no colon suffix)'));
        assert.ok(!isUntrustedContentNote('safe note'));
});

test('consoleEvidenceRow: page-derived console text behind the marker; content-addressed {capture, verdict} identity', () => {
        const engine = BrowserPolicyEngine.fromPolicyText(MARKER_POLICY, { clock: () => 42 });
        const verdict = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', ts: 7 }).final;
        const entry = { at: 100, source: 'Runtime.consoleAPICalled' as const, level: 'error', text: 'page says: exfil https://evil.example.net/c2' };
        const row = consoleEvidenceRow(entry, verdict, 'task-7');
        assert.equal(row.kind, 'note');
        assert.ok(isUntrustedContentNote(row.note), 'console rows carry the marker');
        assert.match(row.note, /error/);
        assert.match(row.note, /exfil https:\/\/evil\.example\.net\/c2/, 'the marker is a BOUNDARY MARKER, not sanitization: the payload is intact');
        assert.match(row.uri, /^\.flauz\/artifacts\/task-7\/browser-capture-[0-9a-f]{16}\.json$/);
        const expectedCore = canonicalJson({ capture: { at: 100, level: 'error', line: undefined, source: 'Runtime.consoleAPICalled', text: entry.text, url: undefined }, verdict: verdictCore(verdict) });
        assert.equal(row.sha256, createHash('sha256').update(expectedCore, 'utf8').digest('hex'), 'sha256 over the canonical {capture, verdict} pair');
        // distinct events stay distinct rows (same verdict, different text):
        const other = consoleEvidenceRow({ ...entry, text: 'different text' }, verdict, 'task-7');
        assert.notEqual(other.sha256, row.sha256);
});

test('networkEvidenceRow: page-derived request URLs behind the marker', () => {
        const engine = BrowserPolicyEngine.fromPolicyText(MARKER_POLICY, { clock: () => 42 });
        const verdict = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', ts: 7 }).final;
        const row = networkEvidenceRow({ at: 101, phase: 'request', requestId: 'r1', url: 'https://tracker.example.net/beacon', method: 'POST' }, verdict, undefined);
        assert.ok(isUntrustedContentNote(row.note));
        assert.match(row.note, /network request: POST https:\/\/tracker\.example\.net\/beacon/);
        assert.match(row.uri, /^flauz-policy:\/\/captures\/[0-9a-f]{16}$/);
        const failed = networkEvidenceRow({ at: 102, phase: 'failed', requestId: 'r2', url: '', errorText: 'net::ERR_BLOCKED' }, verdict, undefined);
        assert.ok(isUntrustedContentNote(failed.note));
        assert.match(failed.note, /network failed: \(net::ERR_BLOCKED\)/);
});

test('screenshot rows through the REAL pipeline carry the marker (live wiring, runScreenshot)', async () => {
        const markerRig = rig();
        const opened = await markerRig.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/shot' });
        const sessionId = opened.descriptor.sessionId;
        const result = await markerRig.manager.screenshot(sessionId);
        assert.ok(!('error' in result));
        assert.ok(isUntrustedContentNote(result.evidenceRow.note), 'the screenshot row note is marked (the committed URL is page-derived state)');
        assert.match(result.evidenceRow.note, /^untrusted-content: screenshot: /);
        assert.match(result.evidenceRow.note, /https:\/\/docs\.example\.com\/shot/, 'the verdict summary (with the URL) is intact behind the marker');
        assert.equal(result.evidenceRow.kind, 'note');
        assert.match(result.evidenceRow.sha256, /^[0-9a-f]{64}$/);
        await markerRig.manager.dispose();
});

test('plain navigation verdict rows do NOT carry the marker (engine-derived; the requested URL is caller input, not page state)', async () => {
        const markerRig = rig();
        const opened = await markerRig.manager.open({ initiator: 'agent', agentId: 'worker-1' });
        const outcome = await markerRig.manager.navigate(opened.descriptor.sessionId, 'https://evil.org/pay');
        assert.ok(isNavigationOutcome(outcome));
        assert.equal(outcome.sent, false);
        assert.ok(!isUntrustedContentNote(outcome.evidenceRow.note), 'navigation rows keep the unmarked toEvidenceRow note');
        assert.match(outcome.evidenceRow.note, /^deny\/driver agent-tool https:\/\/evil\.org\/pay/);
        // the screenshotEvidenceRow builder is the verdict-identity-preserving variant:
        const engine = BrowserPolicyEngine.fromPolicyText(MARKER_POLICY, { clock: () => 42 });
        const verdict = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', ts: 7 }).final;
        const marked = screenshotEvidenceRow(verdict, undefined);
        assert.ok(isUntrustedContentNote(marked.note));
        assert.equal(marked.sha256, createHash('sha256').update(canonicalJson(verdictCore(verdict)), 'utf8').digest('hex'), 'identity identical to the unmarked verdict row (only the note differs)');
        await markerRig.manager.dispose();
});
