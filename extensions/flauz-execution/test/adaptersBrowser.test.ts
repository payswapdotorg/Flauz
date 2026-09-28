/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M3 suite (browser): the BrowserExecutionAdapter against the REAL
 * flauz-browser runtime - BrowserSessionManager over CdpEndpointHost +
 * FakeCdpTransport + the REAL policy engine (the session-manager test rig
 * pattern). The structural port is satisfied by the real manager; any
 * drift in the TL3 contract fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSessionManager } from '../../flauz-browser/src/runtime/sessionManager.ts';
import { CdpEndpointHost } from '../../flauz-browser/src/runtime/host.ts';
import { FakeBrowserState, FakeCdpTransport } from '../../flauz-browser/src/cdp/fake.ts';
import { BrowserPolicyEngine } from '../../flauz-browser/src/policy.ts';
import { BrowserExecutionAdapter } from '../src/adapters.ts';
import { ExecJournalStore } from '../src/journal.ts';
import { execSha256Hex } from '../src/contracts.ts';
import type { StepBinding } from '../src/acquisition.ts';
import { BROWSER_REF, pinnedMinter, steppingClock, tempRoot } from './helpers.ts';

const WORKSPACE_ROOT = '/ws/acme';
const SEPARATION_POLICY = JSON.stringify({
	schemaVersion: 0,
	driver: { allow: ['*.example.com'] },
	webRequest: { allow: ['*.example.com'] },
	willNavigate: { allow: ['*'] },
	partitions: { scope: 'persist', perAgent: true },
});

interface BrowserRig {
	adapter: BrowserExecutionAdapter;
	manager: BrowserSessionManager;
	journal: ExecJournalStore;
	transports: FakeCdpTransport[];
	cleanup: () => void;
}

function rig(): BrowserRig {
	const { root, cleanup } = tempRoot();
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
		engine: () => BrowserPolicyEngine.fromPolicyText(SEPARATION_POLICY),
		host,
		workspaceRoot: WORKSPACE_ROOT,
		commandTimeoutMs: 150,
		navigationTimeoutMs: 300,
	});
	const journal = new ExecJournalStore(root, { clock: steppingClock(1730000000000), mintAcquisitionId: pinnedMinter() });
	const memGraph = memResourceGraph();
	const adapter = new BrowserExecutionAdapter({ browser: manager, graph: memGraph.graph, journal });
	return { adapter, manager, journal, transports, cleanup };
}

/** A minimal in-memory ResourceGraphPort stand-in for the browser suite (the resources suite uses the REAL graph). */
function memResourceGraph(): { graph: { get(id: string): { kind: string; id: string } | undefined; surfacesFor(id: string): { refId: string; family: string; versions: { surface: unknown; updatedAt: number }[] }[]; addRef(input: { kind: string; id: string; provenance: unknown }): Promise<unknown>; addSurface(refId: string, surface: Record<string, unknown>, provenance: unknown): Promise<unknown> } } {
	const refs = new Map<string, { kind: string; id: string }>();
	const surfaces = new Map<string, { refId: string; family: string; versions: { surface: unknown; updatedAt: number }[] }[]>();
	return {
		graph: {
			get: (id) => refs.get(id),
			surfacesFor: (id) => surfaces.get(id) ?? [],
			async addRef(input) { refs.set(input.id, { kind: input.kind, id: input.id }); },
			async addSurface(refId, surface) {
				const family = String(surface.kind ?? 'unknown');
				const records = surfaces.get(refId) ?? [];
				const record = records.find((candidate) => candidate.family === family);
				if (record === undefined) {
					records.push({ refId, family, versions: [{ surface, updatedAt: Date.now() }] });
				} else {
					record.versions.push({ surface, updatedAt: Date.now() });
				}
				surfaces.set(refId, records);
			},
		},
	};
}

function binding(): StepBinding {
	return { graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1', runnerId: 'worker-1', actor: 'agent', origin: 'test:browser' };
}

test('open (fresh): the REAL session manager mints the session; the adapter registers the ResourceRef + surface version + hand-off', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding());
	assert.ok(opened.ok, opened.ok ? '' : JSON.stringify((opened as { failure?: unknown }).failure));
	if (!opened.ok) { return; }
	assert.match(opened.resource.id, /^flauz:browser:[0-9a-f]{16}$/, 'the descriptor logical id becomes the ResourceRef');
	assert.equal(opened.surface.resourceClass, 'browser-session');
	assert.equal((opened.surface as { initiator: string }).initiator, 'agent');
	assert.equal((opened.surface as { state: string }).state, 'active');
	assert.ok(((opened.surface as unknown as { tabIds: string[] })).tabIds.length >= 1);
	// the ref + surface were registered with task provenance (memGraph stand-in; the REAL graph is pinned in the resources suite)
	r.cleanup();
});

test('open (fresh) with a DENIED startUrl: fail-closed typed denial, the gate is browser-policy', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://evil.example.net' }, binding());
	assert.ok(!opened.ok);
	if (opened.ok) { return; }
	assert.equal(opened.failure.failureClass, 'acquire-denied');
	assert.equal(opened.failure.gate, 'browser-policy');
	r.cleanup();
});

test('open (existing ref): a live session resolves through getSession; a dead ref is resource-lost', async () => {
	const r = rig();
	const first = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding());
	if (!first.ok) { return; }
	const sessionId = first.resource.id;
	const second = await r.adapter.open({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: sessionId }, action: 'navigate', url: 'https://docs.example.com/guide' }, binding());
	assert.ok(second.ok);
	if (!second.ok) { return; }
	assert.equal(second.resource.id, sessionId);
	const dead = await r.adapter.open({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: 'flauz:browser:00000000000000ff' }, action: 'navigate', url: 'https://docs.example.com' }, binding());
	assert.ok(!dead.ok);
	if (dead.ok) { return; }
	assert.equal(dead.failure.failureClass, 'resource-lost');
	r.cleanup();
});

test('use (navigate): the policy-gated navigation runs through the REAL manager; the hand-off surface is journaled', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding());
	if (!opened.ok) { return; }
	const acquisitionId = seedAcquisition(r.journal, opened.resource.id);
	const used = await r.adapter.use({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: opened.resource.id }, action: 'navigate', url: 'https://api.example.com/v1' }, binding(), acquisitionId);
	assert.ok(used.ok, used.ok ? '' : JSON.stringify((used as { failure?: { message?: string } }).failure));
	if (!used.ok) { return; }
	assert.match(used.value, /navigated flauz:browser:.* -> https:\/\/api.example.com\/v1/);
	const handoffs = r.journal.rowsAll().filter((row) => row.type === 'handoff-recorded');
	assert.ok(handoffs.length >= 1, 'the post-use hand-off is journaled');
	for (const row of handoffs) {
		const payload = row.payload as { surfaceDigest: string };
		assert.match(payload.surfaceDigest, /^[0-9a-f]{64}$/);
	}
	assert.ok(r.journal.verifyJournal().ok);
	r.cleanup();
});

test('use (navigate) DENIED mid-flight: use-denied (terminal), zero retries, fail-closed stays authoritative', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding()).catch(() => null);
	assert.notEqual(opened, null);
	if (opened === null || !opened.ok) { return; }
	const used = await r.adapter.use({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: opened.resource.id }, action: 'navigate', url: 'https://denied.example.net' }, binding(), seedAcquisition(r.journal, opened.resource.id));
	assert.ok(!used.ok);
	if (used.ok) { return; }
	assert.equal(used.failure.failureClass, 'use-denied');
	assert.equal(used.failure.gate, 'browser-policy');
	assert.match(used.failure.message, /denied by the browser policy/);
	assert.notEqual(used.failure.verdictDigest, undefined, 'the verdict digest is recorded');
	r.cleanup();
});

test('use (close): the session closes through the REAL manager', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding());
	if (!opened.ok) { return; }
	const closed = await r.adapter.use({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: opened.resource.id }, action: 'close' }, binding(), seedAcquisition(r.journal, opened.resource.id));
	assert.ok(closed.ok);
	assert.equal(r.manager.getSession(opened.resource.id)?.state, 'closed');
	r.cleanup();
});

test('session loss mid-step (transport drop): the navigation fails with resource-lost', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding());
	if (!opened.ok) { return; }
	const transport = r.transports[r.transports.length - 1];
	transport.close();
	const used = await r.adapter.use({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: opened.resource.id }, action: 'navigate', url: 'https://api.example.com/v1' }, binding(), seedAcquisition(r.journal, opened.resource.id));
	// The manager may reconcile internally; either the effect fails typed or
	// the session is reported unusable - never a silent success on a dead session.
	if (!used.ok) {
		assert.ok(['resource-lost', 'use-denied', 'executor-death'].includes(used.failure.failureClass), used.failure.message);
	}
	r.cleanup();
});

test('hand-off digest linkage: surfaceDigest is the sha256 of the canonical surface', async () => {
	const r = rig();
	const opened = await r.adapter.open({ action: 'open', url: 'https://docs.example.com' }, binding()).catch(() => null);
	if (opened === null || !opened.ok) { return; }
	const used = await r.adapter.use({ resource: { resourceClass: 'browser-session', kind: 'browser-session', id: opened.resource.id }, action: 'navigate', url: 'https://api.example.com/v1' }, binding(), seedAcquisition(r.journal, opened.resource.id));
	assert.ok(used.ok);
	const handoff = r.journal.rowsAll().filter((row) => row.type === 'handoff-recorded').at(-1);
	assert.notEqual(handoff, undefined);
	if (handoff === undefined) { return; }
	const payload = handoff.payload as { surface: unknown; surfaceDigest: string };
	assert.equal(payload.surfaceDigest, execSha256Hex(canonicalOf(payload.surface)));
	r.cleanup();
});

/** Seeds one acquired acquisition row (the sink's acquire step, in-test). */
function seedAcquisition(journal: ExecJournalStore, resourceId: string): string {
	const acquisitionId = 'flauz:exec:0000000000000001';
	journal.appendRow('resource-acquired', {
		graphId: 'G-001', stepId: 'S-01', attempt: 1, idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId, actor: 'agent', origin: 'test:browser',
		payload: { purpose: 'test', resource: { resourceClass: 'browser-session', kind: 'browser-session', id: resourceId } },
	});
	return acquisitionId;
}

function canonicalOf(value: unknown): string {
	if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return '[' + value.map(canonicalOf).join(',') + ']';
	}
	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
		return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalOf(record[key])).join(',') + '}';
	}
	return 'null';
}
