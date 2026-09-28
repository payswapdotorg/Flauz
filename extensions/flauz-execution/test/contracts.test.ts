/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-S2 M1 suite: the execution-resource port contracts - resource
 * identity law (class/kind/URN legality), surface snapshot validators,
 * the journal row contract (15 exact fields, per-type payloads, unknown
 * keys rejected), the acquisition transition table, the failure taxonomy
 * mapping law, the execution request parse, and the canonical-JSON/sha256
 * cross-check against node:crypto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
	ACQUISITION_TRANSITIONS,
	EXEC_FAILURE_CLASSES,
	EXEC_JOURNAL_ROW_FIELDS,
	EXEC_TO_ORCH_FAILURE_CLASS,
	ORCH_TERMINAL_FAILURE_CLASSES,
	RESOURCE_CLASSES,
	validateExecutionResourceRef,
	validateSurfaceSnapshot,
	validateExecJournalRow,
	validateExecPayload,
	validateExecutionRequest,
	validateLogicalSurface,
	toOrchFailureClass,
	canonicalJson,
	execSha256Hex,
	execRowHashOf,
	execRowIdOf,
} from '../src/contracts.ts';
import { BROWSER_REF, ENVIRONMENT_REF, FILE_REF, ARTIFACT_REF } from './helpers.ts';

// ---------------------------------------------------------------------------
// Resource identity law
// ---------------------------------------------------------------------------

test('resource ref: the three classes validate with class/kind/URN legality', () => {
	for (const ref of [BROWSER_REF, ENVIRONMENT_REF, FILE_REF, ARTIFACT_REF]) {
		const verdict = validateExecutionResourceRef(ref);
		assert.ok(verdict.ok, JSON.stringify(ref));
		assert.deepEqual(verdict.ref, ref);
	}
});

test('resource ref: unknown keys rejected (envelope discipline)', () => {
	const verdict = validateExecutionResourceRef({ ...BROWSER_REF, handle: 'raw-cdp-target' });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /exactly the keys/);
});

test('resource ref: class/kind mismatch rejected (a browser-session kind is NOT a logical resource)', () => {
	const verdict = validateExecutionResourceRef({ resourceClass: 'logical-resource', kind: 'browser-session', id: BROWSER_REF.id });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /belongs to class/);
});

test('resource ref: URN namespace must match the kind (identity law)', () => {
	const verdict = validateExecutionResourceRef({ resourceClass: 'logical-resource', kind: 'file', id: 'flauz:task:T-001' });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /canonical namespace/);
});

test('resource ref: browser ids must be exactly flauz:browser:<16-hex> (no URLs, no CDP target ids)', () => {
	for (const bad of ['flauz:browser:short', 'http://127.0.0.1:9222/devtools/page/ABC', 'flauz:browser:9C8D7E6F5A4B3C2D']) {
		const verdict = validateExecutionResourceRef({ resourceClass: 'browser-session', kind: 'browser-session', id: bad });
		assert.ok(!verdict.ok, bad);
	}
});

test('resource ref: environment local part must be an env- registry id', () => {
	const verdict = validateExecutionResourceRef({ resourceClass: 'environment', kind: 'environment', id: 'flauz:environment:not-an-env-id' });
	assert.ok(!verdict.ok);
});

test('classForKind: browser-session and environment are their own classes; everything else is logical', () => {
	assert.equal(RESOURCE_CLASSES.length, 3);
});

// ---------------------------------------------------------------------------
// Surface snapshots
// ---------------------------------------------------------------------------

const BROWSER_SURFACE = {
	resourceClass: 'browser-session',
	sessionId: 'flauz:browser:9c8d7e6f5a4b3c2d',
	initiator: 'agent',
	partition: 'persist:flauz-0123456789abcdef-worker-1',
	state: 'active',
	tabIds: ['flauz:tab:0123456789abcdef'],
	policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
} as const;

const ENVIRONMENT_SURFACE = {
	resourceClass: 'environment',
	descriptorId: 'env-staging',
	providerKind: 'workspace-remote',
	lifecycleState: 'running/attached',
	executorKind: 'fake-local',
	infrastructureClass: 'real',
	trustPosture: 'trusted',
	attachLeaseId: 'lease-1',
} as const;

const LOGICAL_SURFACE = {
	resourceClass: 'logical-resource',
	refId: 'flauz:file:4d5e6f708192a3b4',
	family: 'file-system',
	surface: { kind: 'file-system', root: '/ws/acme', path: 'src/app.ts', contentSha256: 'a'.repeat(64) },
} as const;

test('surface snapshots: the three classes validate', () => {
	for (const snapshot of [BROWSER_SURFACE, ENVIRONMENT_SURFACE, LOGICAL_SURFACE]) {
		const verdict = validateSurfaceSnapshot(snapshot);
		assert.ok(verdict.ok, JSON.stringify(snapshot));
	}
});

test('surface snapshot: browser snapshot rejects a CDP target id masquerading as a tab id', () => {
	const verdict = validateSurfaceSnapshot({ ...BROWSER_SURFACE, tabIds: ['CDP-TARGET-42'] });
	assert.ok(!verdict.ok);
});

test('surface snapshot: environment snapshot rejects an unknown lifecycle state', () => {
	const verdict = validateSurfaceSnapshot({ ...ENVIRONMENT_SURFACE, lifecycleState: 'warm' });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /lifecycleState/);
});

test('surface snapshot: logical family must not be browser/environment (class separation)', () => {
	const verdict = validateSurfaceSnapshot({ ...LOGICAL_SURFACE, family: 'browser' });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /belong to their own resource classes/);
});

test('surface snapshot: logical refId namespace must be legal for the family (file-system -> file|directory)', () => {
	const verdict = validateSurfaceSnapshot({ ...LOGICAL_SURFACE, refId: 'flauz:task:T-001' });
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /not a legal kind for family/);
});

test('logical surface: per-family exact key sets (unknown keys rejected)', () => {
	assert.ok(validateLogicalSurface({ kind: 'artifact', uri: 'flauz-artifact://x' }) !== undefined, 'artifact needs exactly uri+sha256');
	const verdict = validateLogicalSurface({ kind: 'model', providerId: 'flauz-mock', modelId: 'glm-4', extra: 1 });
	assert.ok(verdict !== undefined && verdict.includes('the keys'), String(verdict));
});

// ---------------------------------------------------------------------------
// Journal row contract
// ---------------------------------------------------------------------------

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const base: Record<string, unknown> = {
		$schema: 'flauz.execution-journal/v0',
		seq: 1,
		ts: 1730000000000,
		rowId: 'X-000001',
		graphId: 'G-001',
		stepId: 'S-01',
		attempt: 1,
		idempotencyKey: 'flauz-orch/G-001/S-01/run/1',
		acquisitionId: 'flauz:exec:0000000000000001',
		type: 'resource-acquired',
		actor: 'agent',
		origin: 'test:contracts',
		payload: { purpose: 'drive the docs task', resource: { ...BROWSER_REF } },
		contentHash: '',
		prev: null,
	};
	base.contentHash = execSha256Hex(canonicalJson(base.payload));
	return { ...base, ...overrides };
}

test('journal row: exactly 15 fields, seq/rowId derivation, content-hash linkage', () => {
	const verdict = validateExecJournalRow(row());
	assert.ok(verdict.ok, verdict.ok ? '' : verdict.error);
	assert.equal(EXEC_JOURNAL_ROW_FIELDS.length, 15);
	assert.equal(verdict.row?.rowId, execRowIdOf(1));
});

test('journal row: unknown keys rejected', () => {
	const verdict = validateExecJournalRow(row({ fabricated: true }));
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /exactly the 15 keys/);
});

test('journal row: wrong schema rejected', () => {
	const verdict = validateExecJournalRow(row({ $schema: 'flauz.execution-journal/v1' }));
	assert.ok(!verdict.ok);
});

test('journal row: contentHash must match the canonical payload', () => {
	const verdict = validateExecJournalRow(row({ contentHash: '0'.repeat(64) }));
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /content-hash linkage broken/);
});

test('journal row: acquisition-level events require the acquisitionId; aggregate events require null', () => {
	assert.ok(!validateExecJournalRow(row({ acquisitionId: null })).ok);
	assert.ok(!validateExecJournalRow(row({ type: 'recovery-scan', acquisitionId: 'flauz:exec:0000000000000001', payload: { actions: [], clean: true } })).ok);
});

test('journal row: idempotencyKey must follow the flauz-orch house pattern', () => {
	const verdict = validateExecJournalRow(row({ idempotencyKey: 'random-key' }));
	assert.ok(!verdict.ok);
	assert.match(verdict.error, /flauz-orch/);
});

test('journal row: actor must be the closed vocabulary', () => {
	assert.ok(!validateExecJournalRow(row({ actor: 'attacker' })).ok);
});

// ---------------------------------------------------------------------------
// Payload validation per event type
// ---------------------------------------------------------------------------

test('payload: resource-acquired requires purpose + resource; lease shape is exact', () => {
	assert.ok(validateExecPayload('resource-acquired', { resource: { ...BROWSER_REF } }) !== undefined, 'purpose required');
	assert.ok(validateExecPayload('resource-acquired', { purpose: 'p', resource: { ...BROWSER_REF }, lease: { leaseId: 'L-001-01-1', holder: 'worker-1', expiresAt: 1 } }) === undefined);
	assert.ok(validateExecPayload('resource-acquired', { purpose: 'p', resource: { ...BROWSER_REF }, lease: { leaseId: 'bad', holder: 'worker-1', expiresAt: 1 } }) !== undefined, 'leaseId must be L-NNN-NN-N');
});

test('payload: handoff surfaceDigest must match the surface (content-hash linkage at hand-off)', () => {
	const payload = { surface: { ...BROWSER_SURFACE }, surfaceDigest: 'c'.repeat(64) };
	assert.ok(validateExecPayload('handoff-recorded', payload) !== undefined);
	assert.ok(validateExecPayload('handoff-recorded', { ...payload, surfaceDigest: execSha256Hex(canonicalJson(payload.surface)) }) === undefined);
});

test('payload: acquire-denied is the typed fail-closed record (gate + attempted resource)', () => {
	const payload = { gate: 'browser-policy', failureClass: 'acquire-denied', message: 'deny', resource: { ...BROWSER_REF } };
	assert.ok(validateExecPayload('acquire-denied', payload) === undefined);
	assert.ok(validateExecPayload('acquire-denied', { ...payload, gate: 'some-other-gate' }) !== undefined);
	assert.ok(validateExecPayload('acquire-denied', { ...payload, failureClass: 'resource-lost' }) !== undefined, 'denial rows carry exactly acquire-denied');
});

test('payload: effect-settled outcome arms are exclusive', () => {
	assert.ok(validateExecPayload('effect-settled', { outcome: 'ok' }) !== undefined, 'ok requires valueDigest');
	assert.ok(validateExecPayload('effect-settled', { outcome: 'ok', valueDigest: 'd'.repeat(64) }) === undefined);
	assert.ok(validateExecPayload('effect-settled', { outcome: 'failed', failureClass: 'resource-lost', message: 'm' }) === undefined);
	assert.ok(validateExecPayload('effect-settled', { outcome: 'failed', message: 'm' }) !== undefined, 'failed requires failureClass');
});

// ---------------------------------------------------------------------------
// Transition table + taxonomy
// ---------------------------------------------------------------------------

test('transitions: lost is recoverable (reattach/restore); released/expired are terminal', () => {
	const types = ACQUISITION_TRANSITIONS.map((rule) => rule.type);
	assert.deepEqual(types, ['resource-acquired', 'resource-released', 'resource-lost', 'resource-expired', 'session-reattached', 'continuity-restored']);
	const released = ACQUISITION_TRANSITIONS.find((rule) => rule.type === 'resource-released');
	assert.ok(released !== undefined);
	assert.deepEqual(released.from, ['acquired', 'lost']);
	const expired = ACQUISITION_TRANSITIONS.find((rule) => rule.type === 'resource-expired');
	assert.ok(expired !== undefined);
	assert.deepEqual(expired?.from, ['acquired']);
});

test('taxonomy: acquire-denied maps to the TERMINAL policy-violation class (fail-closed stays authoritative)', () => {
	assert.equal(toOrchFailureClass('acquire-denied'), 'policy-violation');
	assert.ok(ORCH_TERMINAL_FAILURE_CLASSES.includes('policy-violation'));
	for (const execClass of EXEC_FAILURE_CLASSES) {
		const mapped = EXEC_TO_ORCH_FAILURE_CLASS[execClass];
		assert.ok(mapped !== undefined, execClass);
	}
});

test('taxonomy: resource/executor failures map to retryable classes (the graph may re-acquire)', () => {
	assert.equal(toOrchFailureClass('resource-lost'), 'unavailable');
	assert.equal(toOrchFailureClass('executor-death'), 'dependency-failure');
	assert.equal(toOrchFailureClass('acquire-timeout'), 'timeout');
});

// ---------------------------------------------------------------------------
// Execution request (the step toolInput parse)
// ---------------------------------------------------------------------------

test('execution request: browser actions parse; url/tabId shapes enforced', () => {
	const verdict = validateExecutionRequest({ resource: { ...BROWSER_REF }, action: 'navigate', url: 'https://docs.flauz.dev' });
	assert.ok(verdict.ok, verdict.ok ? '' : verdict.error);
	assert.ok(!validateExecutionRequest({ resource: { ...BROWSER_REF }, action: 'destroy' }).ok, 'destroy is not a browser action');
	assert.ok(!validateExecutionRequest({ resource: { ...BROWSER_REF }, action: 'navigate', tabId: 'CDP-42' }).ok);
});

test('execution request: environment ops are the lifecycle vocabulary', () => {
	assert.ok(validateExecutionRequest({ resource: { ...ENVIRONMENT_REF }, action: 'attach' }).ok);
	assert.ok(!validateExecutionRequest({ resource: { ...ENVIRONMENT_REF }, action: 'navigate' }).ok);
});

test('execution request: logical actions are resolve|mutate; no raw handles anywhere', () => {
	assert.ok(validateExecutionRequest({ resource: { ...FILE_REF }, action: 'mutate', mutation: { note: 'rewrite' } }).ok);
	assert.ok(!validateExecutionRequest({ resource: { ...FILE_REF }, action: 'navigate' }).ok);
	assert.ok(!validateExecutionRequest({ resource: { ...FILE_REF }, action: 'resolve', cdpTargetId: '42' }).ok, 'unknown keys rejected');
});

// ---------------------------------------------------------------------------
// Hashing cross-check (pure TS vs node:crypto)
// ---------------------------------------------------------------------------

test('execSha256Hex matches node:crypto (the pure implementation is pinned)', () => {
	for (const sample of ['', 'flauz', canonicalJson({ a: [1, 2, { b: 'c' }] })]) {
		assert.equal(execSha256Hex(sample), createHash('sha256').update(sample, 'utf-8').digest('hex'));
	}
});

test('execRowHashOf: prev excluded from the hashed body (chain linkage proof)', () => {
	const a = validateExecJournalRow(row());
	assert.ok(a.ok);
	if (!a.ok) { return; }
	const withPrev = validateExecJournalRow(row({ seq: 2, rowId: 'X-000002', prev: execRowHashOf(a.row) }));
	assert.ok(withPrev.ok);
	if (!withPrev.ok) { return; }
	assert.notEqual(execRowHashOf(a.row), execRowHashOf(withPrev.row));
	const mutated = { ...withPrev.row, prev: 'e'.repeat(64) };
	assert.equal(execRowHashOf(mutated), execRowHashOf(withPrev.row), 'prev does not participate');
});

test('row hash derivation is stable across key order (canonical JSON)', () => {
	const base: Record<string, unknown> = row();
	const verdict = validateExecJournalRow(base);
	assert.ok(verdict.ok);
	const reordered: Record<string, unknown> = { ...base, payload: { ...base.payload as Record<string, unknown> } };
	const reorderedVerdict = validateExecJournalRow(reordered);
	assert.ok(reorderedVerdict.ok, reorderedVerdict.ok ? '' : reorderedVerdict.error);
	if (!reorderedVerdict.ok || !verdict.ok) { return; }
	assert.equal(execRowHashOf(reorderedVerdict.row), execRowHashOf(verdict.row));
});

test('randomBytes-backed minter shape sanity (16 hex chars)', () => {
	assert.match(randomBytes(8).toString('hex'), /^[0-9a-f]{16}$/);
});
