/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Capture + evidence tests (TL3-001): console/network capture from CDP
 * events, screenshots, the EXISTING toEvidenceRow mapping (shape unchanged),
 * and the artifact-writer port (in-memory for tests + the real
 * FileSystemArtifactWriter under a temp dir).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { BrowserPolicyEngine } from '../src/policy.ts';
import { CdpEndpointHost } from '../src/runtime/host.ts';
import {BrowserSessionManager, isSessionError} from '../src/runtime/sessionManager.ts';
import {
	captureEvidenceRow,
	decodeScreenshotBase64,
	FileSystemArtifactWriter,
	InMemoryArtifactWriter,
	TabCaptureRecorder,
} from '../src/runtime/capture.ts';
import { FakeBrowserState, FakeCdpTransport } from '../src/cdp/fake.ts';
import { scopeToSession } from '../src/cdp/transport.ts';

const WORKSPACE_ROOT = '/ws/acme';
const CAPTURE_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*.example.com'] },
	partitions: { scope: 'persist', perAgent: true },
});

function freshRig(): { state: FakeBrowserState; manager: BrowserSessionManager; transports: FakeCdpTransport[]; artifacts: InMemoryArtifactWriter } {
	const state = new FakeBrowserState();
	const transports: FakeCdpTransport[] = [];
	const artifacts = new InMemoryArtifactWriter();
	const host = new CdpEndpointHost('ws://127.0.0.1:9222/devtools/browser/fake', {
		transportFactory: () => {
			const transport = new FakeCdpTransport({ state, commandTimeoutMs: 500 });
			transports.push(transport);
			return transport;
		},
	});
	const manager = new BrowserSessionManager({
		engine: () => BrowserPolicyEngine.fromPolicyText(CAPTURE_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		artifacts,
		taskId: 'task-42',
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	return { state, manager, transports, artifacts };
}

test('console capture: Runtime.consoleAPICalled + Log.entryAdded land in the buffer with tail limits', async () => {
	const transport = new FakeCdpTransport();
	const created = await transport.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
	const attached = await transport.send<{ sessionId: string }>('Target.attachToTarget', { targetId: created.targetId, flatten: true });
	const sessionId = attached.sessionId;
	const recorder = new TabCaptureRecorder({ limit: 100, clock: () => 1000 });
	recorder.attach(scopeToSession(transport, sessionId));

	transport.emitConsoleApiCall(sessionId, { type: 'error', args: [{ type: 'string', value: 'boom' }, { type: 'number', value: 42 }] });
	transport.emitConsoleApiCall(sessionId, { type: 'log', args: [{ type: 'object', description: 'HTMLDocument' }] });
	transport.emitLogEntry(sessionId, { level: 'warning', text: 'mixed content', url: 'https://docs.example.com/x', lineNumber: 12 });

	assert.equal(recorder.console.length, 3);
	assert.deepEqual(recorder.console.map(entry => entry.source), ['Runtime.consoleAPICalled', 'Runtime.consoleAPICalled', 'Log.entryAdded']);
	assert.equal(recorder.console[0]?.level, 'error');
	assert.equal(recorder.console[0]?.text, 'boom 42');
	assert.equal(recorder.console[1]?.text, 'HTMLDocument');
	assert.equal(recorder.console[2]?.level, 'warning');
	assert.equal(recorder.console[2]?.url, 'https://docs.example.com/x');
	assert.equal(recorder.console[2]?.line, 12);
	assert.equal(recorder.console[0]?.at, 1000);
	// tail:
	assert.equal(recorder.consoleTail(2).length, 2);
	assert.deepEqual(recorder.consoleTail(2).map(entry => entry.text), ['HTMLDocument', 'mixed content']);
	recorder.detach();
	transport.emitConsoleApiCall(sessionId, { type: 'log', args: [] });
	assert.equal(recorder.console.length, 3, 'detached: no further capture');
	transport.close();
});

test('network capture: request/response/failed phases in order, with tail limits and ring-buffer bound', () => {
	const transport = new FakeCdpTransport();
	const recorder = new TabCaptureRecorder({ limit: 3, clock: () => 5 });
	// attach without a session (events without sessionId tag still flow through `on`):
	recorder.attach(transport);
	transport.emitRequestWillBeSent('s', { requestId: 'r1', request: { url: 'https://docs.example.com/a', method: 'GET' } });
	transport.emitResponseReceived('s', { requestId: 'r1', response: { url: 'https://docs.example.com/a', status: 200 } });
	transport.emitRequestWillBeSent('s', { requestId: 'r2', request: { url: 'https://tracker.example.net/b', method: 'POST' } });
	transport.emitLoadingFailed('s', { requestId: 'r2', errorText: 'net::ERR_BLOCKED_BY_CLIENT' });
	assert.equal(recorder.network.length, 3, 'ring buffer capped at limit 3');
	assert.deepEqual(recorder.network.map(entry => entry.phase), ['response', 'request', 'failed']);
	assert.equal(recorder.network[0]?.requestId, 'r1');
	assert.equal(recorder.network[0]?.url, 'https://docs.example.com/a');
	assert.equal(recorder.network[0]?.status, 200);
	assert.equal(recorder.network[2]?.errorText, 'net::ERR_BLOCKED_BY_CLIENT');
	assert.deepEqual(recorder.networkTail(1).map(entry => entry.requestId), ['r2']);
	transport.close();
});

test('screenshot: bytes + evidence row + artifact written through the port under .flauz/artifacts/<taskId>/', async () => {
	const rigInstance = freshRig();
	const opened = await rigInstance.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/shot' });
	const sessionId = opened.descriptor.sessionId;
	const tabId = opened.descriptor.tabs[0]?.tabId ?? '';
	const result = await rigInstance.manager.screenshot(sessionId, tabId);
	assert.ok(!isSessionError(result), 'screenshot succeeded');
	assert.ok(result.byteLength > 0);
	assert.equal(result.bytes.byteLength, result.byteLength);
	assert.equal(atob(result.base64), `flauz-fake-screenshot:${rigInstance.manager.getSession(sessionId)?.tabs[0]?.targetId ?? ''}:1`);
	// artifact under the configured taskId:
	assert.equal(rigInstance.artifacts.entries.length, 1);
	assert.equal(rigInstance.artifacts.entries[0]?.taskId, 'task-42');
	assert.match(rigInstance.artifacts.entries[0]?.path ?? '', /^\.flauz\/artifacts\/task-42\/screenshot-\d+\.png$/);
	assert.equal(result.artifactPath, rigInstance.artifacts.entries[0]?.path);
	assert.equal(rigInstance.artifacts.entries[0]?.bytes.byteLength, result.byteLength);
	// evidence row: the CURRENT-policy verdict for the committed URL, exact toEvidenceRow shape:
	assert.equal(result.evidenceRow.kind, 'note');
	assert.match(result.evidenceRow.sha256, /^[0-9a-f]{64}$/);
	assert.match(result.evidenceRow.uri, /^\.flauz\/artifacts\/task-42\/browser-verdict-[0-9a-f]{16}\.json$/);
	assert.match(result.evidenceRow.note, /https:\/\/docs\.example\.com\/shot/);
	await rigInstance.manager.dispose();
});

test('consoleTail/networkLog through the manager: session + tab scoped', async () => {
	const rigInstance = freshRig();
	const opened = await rigInstance.manager.open({ initiator: 'agent', agentId: 'worker-1', startUrl: 'https://docs.example.com/log' });
	const sessionId = opened.descriptor.sessionId;
	const tabId = opened.descriptor.tabs[0]?.tabId ?? '';
	const transport = rigInstance.transports[0];
	// find the live CDP session id of the tab (fake test helper):
	const targetId = rigInstance.manager.getSession(sessionId)?.tabs[0]?.targetId ?? '';
	const cdpSessionId = transport?.sessionIdOf(targetId);
	assert.ok(cdpSessionId !== undefined, 'the tab has a live CDP session on the transport');
	transport?.emitConsoleApiCall(cdpSessionId, { type: 'info', args: [{ type: 'string', value: 'hello' }] });
	transport?.emitRequestWillBeSent(cdpSessionId, { requestId: 'r9', request: { url: 'https://docs.example.com/log', method: 'GET' } });

	const tail = rigInstance.manager.consoleTail(sessionId, tabId, 10);
	assert.ok(!isSessionError(tail));
	assert.equal(tail.length, 1);
	assert.equal(tail[0]?.text, 'hello');
	const network = rigInstance.manager.networkLog(sessionId, tabId, 10);
	assert.ok(!isSessionError(network));
	assert.equal(network.length, 1);
	assert.equal(network[0]?.url, 'https://docs.example.com/log');
	// unknown session errors:
	assert.ok(isSessionError(rigInstance.manager.consoleTail('flauz:browser:0000000000000000') ?? {}));
	await rigInstance.manager.dispose();
});

test('captureEvidenceRow maps ANY policy verdict onto the EXISTING EvidenceRowInput shape', () => {
	const engine = BrowserPolicyEngine.fromPolicyText(CAPTURE_POLICY);
	const verdict = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', ts: 7 }).final;
	const withTask = captureEvidenceRow(verdict, 'task-7');
	assert.equal(withTask.kind, 'note');
	assert.match(withTask.uri, /^\.flauz\/artifacts\/task-7\/browser-verdict-[0-9a-f]{16}\.json$/);
	assert.match(withTask.sha256, /^[0-9a-f]{64}$/);
	assert.match(withTask.note, /^allow\//);
	const withoutTask = captureEvidenceRow(verdict, undefined);
	assert.match(withoutTask.uri, /^flauz-policy:\/\/verdicts\/[0-9a-f]{16}$/);
	// same verdict -> same row (idempotent evidence hashing, ts dropped):
	assert.deepEqual(captureEvidenceRow(verdict, 'task-7'), withTask);
});

test('FileSystemArtifactWriter writes real files under <root>/.flauz/artifacts/<taskId>/', async () => {
	const root = mkdtempSync(path.join(tmpdir(), 'flauz-capture-'));
	const writer = new FileSystemArtifactWriter(root);
	const bytes = new TextEncoder().encode('flauz-fake-screenshot:fake-target-1:1');
	const artifactPath = await writer.writeArtifact('task-9', 'screenshot-1.png', bytes);
	assert.equal(artifactPath, path.join(root, '.flauz', 'artifacts', 'task-9', 'screenshot-1.png'));
	assert.equal(readFileSync(artifactPath, 'utf-8'), 'flauz-fake-screenshot:fake-target-1:1');
	// path traversal is rejected (fail-closed artifact hygiene):
	await assert.rejects(writer.writeArtifact('../escape', 'x.png', bytes));
	await assert.rejects(writer.writeArtifact('ok-task', '../escape.png', bytes));
	await assert.rejects(writer.writeArtifact('ok-task', '.hidden.png', bytes));
});

test('decodeScreenshotBase64 round-trips binary-ish payloads', () => {
	const payload = 'flauz-fake-screenshot:fake-target-2:3';
	const bytes = decodeScreenshotBase64(btoa(payload));
	assert.equal(new TextDecoder().decode(bytes), payload);
});
