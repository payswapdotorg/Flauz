/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-001 M4 protocol conformance: the orchestration service protocol
 * contract (core/orchProtocol.mjs + core/orch-protocol.schema.json) proven
 * against BOTH fixtures - the in-process mediator (core/orchMediator.mjs)
 * and the REAL stdio loopback driver (test/harness/orchLoopback.ts spawned
 * as a child process, the protocol.conformance.test.ts pattern).
 *
 * Every rule has a firing case:
 *  - schema <-> module parity (bidirectional enums + per-method key lists);
 *  - request-envelope validation (minimal-good / each-required-removed /
 *    unknown-key per method + the type-violation table);
 *  - negotiation variants (pure table + both wire directions + the
 *    additive orchProtocolVersions composition + the never-kill-the-session
 *    orch mismatch rule);
 *  - event delivery (mediator stream in journal order; wire events as seam
 *    envelopes under v1; NO wire events under v0);
 *  - failure mapping closure (every seam flauz.err.* and every
 *    OrchestrationError code maps to a typed orchestration failure; unknown
 *    codes fail closed to internal) + the fired-code coverage collector
 *    (every ORCH_FAILURE_CODES value is fired from a real path);
 *  - shutdown ordering (in-flight completion before drain, draining refusal,
 *    idempotent shutdown, pipelined wire ordering, batched shutdowns,
 *    exit-code discipline);
 *  - the human authorization boundary through the protocol (a non-human
 *    approval decision is rejected by the durable graph and surfaces as a
 *    typed flauz.orch.err.illegal-transition failure).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	ORCH_FAILURE_CODES,
	ORCH_FAILURE_CODE_VALUES,
	ORCH_METHOD_NAMES,
	ORCH_METHODS,
	ORCH_REQUEST_KEYS,
	ORCH_EVENTS,
	ORCH_EVENT_NAMES,
	ORCH_PROTOCOL_V1,
	ORCH_PROTOCOL_VERSIONS,
	ORCH_ROW_EVENT_OF,
	SEAM_FAILURE_CODE_MAP,
	ORCHESTRATION_ERROR_CODE_MAP,
	OrchProtocolFailure,
	assertOrchSession,
	composeOrchReady,
	journalRowEventOf,
	mapOrchestrationError,
	mapSeamFailure,
	negotiateOrchVersion,
	orchEventOfRow,
	orchFailure,
	orchFailureOf,
	orchHelloOffer,
	orchMethodDispatchable,
	orchSessionOf,
	validateOrchEventPayload,
	validateOrchRequest,
	validateOrchResult,
	type OrchFailure,
} from '../core/orchProtocol.mjs';
import { SEAM_ERROR_CODES, SEAM_PROTOCOL_V0, SEAM_PROTOCOL_V1, isSeamEvent, seamEvent } from '../core/protocol.mjs';
import { OrchestrationMediator } from '../core/orchMediator.mjs';
import { OrchestrationError } from '../core/orchestration.mjs';

const LOOPBACK_PATH = fileURLToPath(new URL('./harness/orchLoopback.ts', import.meta.url));
const SCHEMA_PATH = fileURLToPath(new URL('../core/orch-protocol.schema.json', import.meta.url));
const WAIT_MS = 5_000;

/** The fired-failure coverage collector (every code must fire from a real path). */
const firedCodes = new Set<string>();
function fired(code: string): void {
	firedCodes.add(code);
}

function failureOf(error: unknown): OrchFailure {
	assert.ok(error instanceof OrchProtocolFailure, `expected OrchProtocolFailure, got ${String(error)}`);
	return error.orchFailure;
}

function makeRoot(prefix: string): string {
	return mkdtempSync(join(tmpdir(), `flauz-orch-proto-${prefix}-`));
}

/** A deterministic clock (the makeClock harness pattern, local copy for suite isolation). */
function makeClock(base: number): { clock(): number } {
	let value = base;
	return {
		clock() {
			value += 1000;
			return value;
		},
	};
}

const GOOD_STEPS = [{ stepId: 'S-01', title: 'first', instruction: 'run the first step' }];

/** The minimal good request of every method (exactly the required keys). */
const MINIMAL_GOOD: Record<string, Record<string, unknown>> = {
	'flauz.orch.submitGraph': { actor: 'agent', origin: 'test:proto', steps: GOOD_STEPS, title: 'proto graph' },
	'flauz.orch.approveGraph': { actor: 'human', graphId: 'G-001', origin: 'test:proto' },
	'flauz.orch.rejectGraph': { actor: 'human', graphId: 'G-001', origin: 'test:proto' },
	'flauz.orch.cancelGraph': { actor: 'human', graphId: 'G-001', origin: 'test:proto' },
	'flauz.orch.getGraph': { graphId: 'G-001' },
	'flauz.orch.listGraphs': {},
	'flauz.orch.verifyJournal': {},
	'flauz.orch.startStep': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', runnerId: 'runner-a', stepId: 'S-01' },
	'flauz.orch.finishStep': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', outcome: 'succeeded', stepId: 'S-01' },
	'flauz.orch.retryStep': { actor: 'service', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.requestApproval': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', reason: 'gate', stepId: 'S-01' },
	'flauz.orch.decideApproval': { actor: 'human', decision: 'granted', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.expireApproval': { actor: 'service', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.requestTakeover': { actor: 'human', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.acceptTakeover': { actor: 'human', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.completeTakeover': { actor: 'human', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.acquireClaim': { actor: 'agent', graphId: 'G-001', holder: 'agent-a', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.releaseClaim': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.acquireLease': { actor: 'agent', graphId: 'G-001', holder: 'agent-a', origin: 'test:proto', stepId: 'S-01', ttlMs: 1000 },
	'flauz.orch.renewLease': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01', ttlMs: 1000 },
	'flauz.orch.releaseLease': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01' },
	'flauz.orch.noticeConflict': { actor: 'service', actualRunner: 'runner-b', expectedHolder: 'agent-a', graphId: 'G-001', origin: 'test:proto', stepId: 'S-01', violation: 'claim' },
	'flauz.orch.routeStep': { actor: 'agent', graphId: 'G-001', origin: 'test:proto', reason: 'capability-match', targetAgent: 'worker-1' },
	'flauz.orch.recoveryScan': { actor: 'service', origin: 'test:proto' },
};

// ---------------------------------------------------------------------------
// Schema <-> module parity
// ---------------------------------------------------------------------------

test('the versioned JSON schema is valid, tab-indented, and pinned to the module id', () => {
	const raw = readFileSync(SCHEMA_PATH, 'utf-8');
	const doc = JSON.parse(raw) as { $id: string; definitions: Record<string, unknown> };
	assert.equal(doc.$id, 'flauz.orch.protocol/v1');
	assert.ok(raw.includes('\n\t"'), 'the schema file is tab-indented');
	assert.ok(!/(^|\n)  "/.test(raw), 'no space-indented lines');
});

test('schema parity: methods, events and failure codes agree bidirectionally', () => {
	const doc = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as { definitions: { methodName: { enum: string[] }; eventName: { enum: string[] }; failureCode: { enum: string[] }; orchProtocolVersion: { enum: string[] }; requests: Record<string, unknown>; events: Record<string, unknown>; results: Record<string, unknown> } };
	assert.deepEqual([...doc.definitions.methodName.enum].sort(), [...ORCH_METHOD_NAMES].sort());
	assert.deepEqual([...doc.definitions.eventName.enum].sort(), [...ORCH_EVENT_NAMES].sort());
	assert.deepEqual([...doc.definitions.failureCode.enum].sort(), [...ORCH_FAILURE_CODE_VALUES].sort());
	assert.deepEqual([...doc.definitions.orchProtocolVersion.enum].sort(), [...ORCH_PROTOCOL_VERSIONS].sort());
	// every method has a request AND result shape; every event a payload shape
	for (const method of ORCH_METHOD_NAMES) {
		assert.ok(doc.definitions.requests[method] !== undefined, `schema requests missing ${method}`);
		assert.ok(doc.definitions.results[method] !== undefined, `schema results missing ${method}`);
	}
	for (const event of ORCH_EVENT_NAMES) {
		assert.ok(doc.definitions.events[event] !== undefined, `schema events missing ${event}`);
	}
});

test('schema parity: per-method required/optional request keys agree exactly', () => {
	const doc = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as { definitions: { requests: Record<string, { required: string[]; properties: Record<string, unknown> }> } };
	for (const method of ORCH_METHOD_NAMES) {
		const spec = ORCH_REQUEST_KEYS[method];
		const schemaRequired = [...doc.definitions.requests[method].required].sort();
		assert.deepEqual(schemaRequired, [...spec.required].sort(), `${method} required keys`);
		const schemaProperties = Object.keys(doc.definitions.requests[method].properties).sort();
		assert.deepEqual(schemaProperties, [...spec.required, ...spec.optional].sort(), `${method} property keys`);
	}
});

// ---------------------------------------------------------------------------
// Request-envelope validation (minimal good / required-removed / unknown key)
// ---------------------------------------------------------------------------

test('every method accepts its minimal good request (exactly the required keys)', () => {
	for (const method of ORCH_METHOD_NAMES) {
		const spec = ORCH_REQUEST_KEYS[method];
		assert.deepEqual(Object.keys(MINIMAL_GOOD[method]).sort(), [...spec.required].sort(), `${method} minimal fixture matches the required keys`);
		assert.equal(validateOrchRequest(method, MINIMAL_GOOD[method]), undefined, method);
	}
});

test('removing any required key or adding an unknown key fails every method', () => {
	for (const method of ORCH_METHOD_NAMES) {
		for (const key of ORCH_REQUEST_KEYS[method].required) {
			const broken = { ...MINIMAL_GOOD[method] };
			delete broken[key];
			assert.ok(validateOrchRequest(method, broken) !== undefined, `${method} without ${key} must fail`);
		}
		const extra = { ...MINIMAL_GOOD[method], nonsense: true };
		assert.ok(validateOrchRequest(method, extra) !== undefined, `${method} with an unknown key must fail`);
	}
	assert.ok(validateOrchRequest('flauz.orch.nope', {}) !== undefined, 'an unregistered method name fails');
	assert.ok(validateOrchRequest('flauz.orch.listGraphs', null) !== undefined, 'non-object args fail');
});

test('type-violation table: every structural rule has a firing bad fixture', () => {
	const cases: Array<[string, Record<string, unknown>, RegExp]> = [
		['flauz.orch.submitGraph', { ...MINIMAL_GOOD['flauz.orch.submitGraph'], title: '' }, /title must be a non-empty string/],
		['flauz.orch.submitGraph', { ...MINIMAL_GOOD['flauz.orch.submitGraph'], steps: [] }, /steps must be a non-empty array/],
		['flauz.orch.submitGraph', { ...MINIMAL_GOOD['flauz.orch.submitGraph'], taskId: 'T-1' }, /taskId must match/],
		['flauz.orch.approveGraph', { ...MINIMAL_GOOD['flauz.orch.approveGraph'], graphId: 'G-1' }, /graphId must match/],
		['flauz.orch.startStep', { ...MINIMAL_GOOD['flauz.orch.startStep'], stepId: 'S-1' }, /stepId must match/],
		['flauz.orch.startStep', { ...MINIMAL_GOOD['flauz.orch.startStep'], runnerId: '' }, /runnerId must be a non-empty string/],
		['flauz.orch.finishStep', { ...MINIMAL_GOOD['flauz.orch.finishStep'], outcome: 'exploded' }, /outcome must be 'succeeded' \| 'failed'/],
		['flauz.orch.finishStep', { ...MINIMAL_GOOD['flauz.orch.finishStep'], attempt: 0 }, /attempt must be a positive integer/],
		['flauz.orch.finishStep', { ...MINIMAL_GOOD['flauz.orch.finishStep'], evidence: [{ kind: 'nope', uri: 'u', sha256: 'a'.repeat(64) }] }, /evidence item kind/],
		['flauz.orch.finishStep', { ...MINIMAL_GOOD['flauz.orch.finishStep'], evidence: [{ kind: 'note', uri: 'u', sha256: 'x' }] }, /sha256 must be 64 lowercase hex/],
		['flauz.orch.finishStep', { ...MINIMAL_GOOD['flauz.orch.finishStep'], retryPlanned: 'yes' }, /retryPlanned must be a boolean/],
		['flauz.orch.requestApproval', { ...MINIMAL_GOOD['flauz.orch.requestApproval'], reason: '' }, /reason must be a non-empty string/],
		['flauz.orch.requestApproval', { ...MINIMAL_GOOD['flauz.orch.requestApproval'], expiresAt: 0 }, /expiresAt must be a positive integer/],
		['flauz.orch.decideApproval', { ...MINIMAL_GOOD['flauz.orch.decideApproval'], decision: 'maybe' }, /decision must be 'granted' \| 'denied'/],
		['flauz.orch.expireApproval', { ...MINIMAL_GOOD['flauz.orch.expireApproval'], expiredAt: 0 }, /expiredAt must be a positive integer/],
		['flauz.orch.acquireLease', { ...MINIMAL_GOOD['flauz.orch.acquireLease'], ttlMs: 0 }, /ttlMs must be a positive integer/],
		['flauz.orch.acquireLease', { ...MINIMAL_GOOD['flauz.orch.acquireLease'], holder: '!bad' }, /holder must be an agent id/],
		['flauz.orch.noticeConflict', { ...MINIMAL_GOOD['flauz.orch.noticeConflict'], violation: 'blob' }, /violation must be 'claim' \| 'lease'/],
		['flauz.orch.routeStep', { ...MINIMAL_GOOD['flauz.orch.routeStep'], reason: 'vibes' }, /reason must be one of/],
		['flauz.orch.routeStep', { ...MINIMAL_GOOD['flauz.orch.routeStep'], targetAgent: '!bad' }, /targetAgent must be an agent id/],
		['flauz.orch.recoveryScan', { ...MINIMAL_GOOD['flauz.orch.recoveryScan'], record: 'yes' }, /record must be a boolean/],
		['flauz.orch.recoveryScan', { ...MINIMAL_GOOD['flauz.orch.recoveryScan'], now: -1 }, /now must be a positive integer/],
		['flauz.orch.submitGraph', { ...MINIMAL_GOOD['flauz.orch.submitGraph'], actor: 'robot' }, /actor must be one of/],
		['flauz.orch.submitGraph', { ...MINIMAL_GOOD['flauz.orch.submitGraph'], origin: '' }, /origin must be a non-empty/],
	];
	for (const [method, args, pattern] of cases) {
		const error = validateOrchRequest(method, args);
		assert.ok(error !== undefined, `${method}: expected a validation error`);
		assert.match(error as string, pattern);
	}
});

// ---------------------------------------------------------------------------
// Event payload validation (the a2a bad-fixture discipline)
// ---------------------------------------------------------------------------

test('event payload validation: every catalog event has a good and a bad fixture', () => {
	const good: Record<string, Record<string, unknown>> = {
		'orch-journal-row': { actor: 'agent', graphId: 'G-001', rowId: 'R-000001', seq: 1, stepId: null, type: 'graph-submitted' },
		'orch-approval-requested': { graphId: 'G-001', reason: 'gate', stepId: 'S-01' },
		'orch-approval-decided': { decision: 'granted', graphId: 'G-001', stepId: 'S-01' },
		'orch-approval-expired': { expiredAt: 1700000009000, graphId: 'G-001', stepId: 'S-01' },
		'orch-takeover-requested': { graphId: 'G-001', requestedBy: 'human', stepId: 'S-01' },
		'orch-takeover-accepted': { graphId: 'G-001', stepId: 'S-01' },
		'orch-takeover-completed': { graphId: 'G-001', stepId: 'S-01' },
		'orch-claim-acquired': { claimId: 'C-001-01', graphId: 'G-001', holder: 'agent-a', stepId: 'S-01' },
		'orch-claim-released': { claimId: 'C-001-01', graphId: 'G-001', holder: 'agent-a', stepId: 'S-01' },
		'orch-lease-acquired': { expiresAt: 1700000001000, graphId: 'G-001', holder: 'agent-a', leaseId: 'L-001-01-1', stepId: 'S-01' },
		'orch-lease-renewed': { expiresAt: 1700000002000, graphId: 'G-001', holder: 'agent-a', leaseId: 'L-001-01-1', stepId: 'S-01' },
		'orch-lease-released': { graphId: 'G-001', holder: 'agent-a', leaseId: 'L-001-01-1', stepId: 'S-01' },
		'orch-lease-expired': { expiredAt: 1700000003000, graphId: 'G-001', holder: 'agent-a', leaseId: 'L-001-01-1', stepId: 'S-01' },
		'orch-conflict-noticed': { actualRunner: 'runner-b', expectedHolder: 'agent-a', graphId: 'G-001', stepId: 'S-01', violation: 'claim' },
		'orch-recovery-scan': { actions: ['step-interrupted:S-01'], clean: false, graphId: 'G-001' },
	};
	for (const event of ORCH_EVENT_NAMES) {
		assert.equal(validateOrchEventPayload(event, good[event]), undefined, event);
		// dropping a key and adding an unknown key both fail
		const firstKey = Object.keys(good[event])[0];
		const dropped = { ...good[event] };
		delete dropped[firstKey];
		assert.ok(validateOrchEventPayload(event, dropped) !== undefined, `${event} without ${firstKey}`);
		const extra = { ...good[event], nonsense: true };
		assert.ok(validateOrchEventPayload(event, extra) !== undefined, `${event} with an unknown key`);
	}
	assert.ok(validateOrchEventPayload('orch-nonsense', {}) !== undefined, 'an uncataloged event fails');
});

test('journal-row projection: every mapped row type projects onto its domain event with persisted facts', () => {
	const row = (type: string, payload: Record<string, unknown>): Record<string, unknown> => ({
		graphId: 'G-001', stepId: 'S-01', type, actor: 'service', rowId: 'R-000001', seq: 1, payload,
	});
	for (const type of Object.keys(ORCH_ROW_EVENT_OF)) {
		const payload = type === 'recovery-scan'
			? { actions: [], clean: true }
			: type === 'takeover-accepted' || type === 'takeover-completed'
				? (type === 'takeover-completed' ? { evidence: [] } : {})
				: type === 'approval-granted' || type === 'approval-denied'
					? {}
					: type === 'claim-acquired' || type === 'claim-released'
						? { claimId: 'C-001-01', holder: 'agent-a' }
						: type === 'lease-acquired' || type === 'lease-renewed'
							? { leaseId: 'L-001-01-1', holder: 'agent-a', expiresAt: 1700000001000 }
							: type === 'lease-released'
								? { leaseId: 'L-001-01-1', holder: 'agent-a' }
								: type === 'lease-expired'
									? { leaseId: 'L-001-01-1', holder: 'agent-a', expiredAt: 1700000003000 }
									: type === 'approval-expired'
										? { expiredAt: 1700000009000 }
										: type === 'approval-requested'
										? { reason: 'gate' }
										: type === 'conflict-noticed'
											? { violation: 'claim', expectedHolder: 'agent-a', actualRunner: 'runner-b' }
											: { reason: 'gate' };
		const projected = orchEventOfRow(row(type, payload));
		assert.ok(projected !== null, type);
		assert.equal(projected?.event, ORCH_ROW_EVENT_OF[type], type);
		assert.equal(validateOrchEventPayload(projected!.event, projected!.payload), undefined, `${type} payload validates`);
	}
	// unmapped types project to null (they surface only through orch-journal-row)
	assert.equal(orchEventOfRow(row('graph-submitted', {})), null);
	assert.equal(orchEventOfRow('not a row'), null);
	const stream = journalRowEventOf(row('graph-submitted', {}));
	assert.equal(stream.event, 'orch-journal-row');
	assert.equal(validateOrchEventPayload('orch-journal-row', stream.payload), undefined);
});

// ---------------------------------------------------------------------------
// Negotiation (pure)
// ---------------------------------------------------------------------------

test('negotiateOrchVersion: no offer means inert; empty/unknown offers mismatch; order is insignificant', () => {
	assert.deepEqual(negotiateOrchVersion(undefined), { offered: false });
	assert.deepEqual(negotiateOrchVersion(null), { offered: false });
	assert.deepEqual(negotiateOrchVersion('flauz.orch/v1'), { offered: false });
	const mismatch = negotiateOrchVersion(['flauz.orch/v9']);
	assert.equal(mismatch.offered, true);
	assert.ok(mismatch.offered && mismatch.ok === false);
	assert.equal(mismatch.failure.code, 'flauz.orch.err.unsupported-version');
	fired('flauz.orch.err.unsupported-version');
	const ok = negotiateOrchVersion(['flauz.orch/v9', 'flauz.orch/v1', 42, null]);
	assert.deepEqual(ok, { offered: true, ok: true, version: 'flauz.orch/v1' });
	assert.deepEqual(negotiateOrchVersion(['flauz.orch/v1', 'flauz.orch/v9']), { offered: true, ok: true, version: 'flauz.orch/v1' });
});

test('orchHelloOffer extracts the additive hello key; unknown shapes answer null', () => {
	assert.deepEqual(orchHelloOffer({ orchProtocolVersions: ['flauz.orch/v1'] }), ['flauz.orch/v1']);
	assert.equal(orchHelloOffer({}), null);
	assert.equal(orchHelloOffer({ orchProtocolVersions: 'flauz.orch/v1' }), null);
	assert.equal(orchHelloOffer(null), null);
});

test('composeOrchReady adds the orch fields additively; the plain ready is untouched without a version', () => {
	const plain = { type: 'ready', service: 's', version: '0.1.0', schema: 'flauz.tasks/v0', protocolVersion: SEAM_PROTOCOL_V1, capabilities: ['flauz.a2a', 'flauz.health'] };
	assert.equal(composeOrchReady(plain, null), plain);
	const composed = composeOrchReady(plain, ORCH_PROTOCOL_V1) as Record<string, unknown>;
	assert.notEqual(composed, plain);
	assert.equal(composed.orchProtocolVersion, 'flauz.orch/v1');
	assert.deepEqual(composed.capabilities, ['flauz.a2a', 'flauz.health', 'flauz.orch']);
	// the v1 prefix keys keep their order and the original object is never mutated
	assert.deepEqual(Object.keys(plain), ['type', 'service', 'version', 'schema', 'protocolVersion', 'capabilities']);
	assert.equal(plain.capabilities.includes('flauz.orch'), false);
});

test('orchSessionOf: offered+answered -> active; offered+absent -> typed failure; not offered -> not an error', () => {
	const active = orchSessionOf(['flauz.orch/v1'], { orchProtocolVersion: 'flauz.orch/v1' });
	assert.deepEqual(active, { orch: true, version: 'flauz.orch/v1', failure: null });
	const silent = orchSessionOf(undefined, {});
	assert.deepEqual(silent, { orch: false, version: null, failure: null });
	const refused = orchSessionOf(['flauz.orch/v9'], { protocolVersion: SEAM_PROTOCOL_V1 });
	assert.equal(refused.orch, false);
	assert.equal(refused.failure?.code, 'flauz.orch.err.unsupported-version');
	assert.deepEqual(refused.failure?.details?.supported, ['flauz.orch/v1']);
	fired('flauz.orch.err.unsupported-version');
});

test('orchMethodDispatchable: registry + v1 seam + negotiated orch, all three required', () => {
	assert.equal(orchMethodDispatchable('flauz.orch.requestApproval', SEAM_PROTOCOL_V1, ORCH_PROTOCOL_V1), true);
	assert.equal(orchMethodDispatchable('flauz.orch.requestApproval', SEAM_PROTOCOL_V0, ORCH_PROTOCOL_V1), false);
	assert.equal(orchMethodDispatchable('flauz.orch.requestApproval', SEAM_PROTOCOL_V1, null), false);
	assert.equal(orchMethodDispatchable('flauz.orch.requestApproval', SEAM_PROTOCOL_V1, 'flauz.orch/v9'), false);
	assert.equal(orchMethodDispatchable('flauz.orch.nope', SEAM_PROTOCOL_V1, ORCH_PROTOCOL_V1), false);
});

test('assertOrchSession: an orch call without a negotiated session fails fast (not-ready)', () => {
	const failure = assertOrchSession({ orch: false, version: null }, 'flauz.orch.listGraphs');
	assert.ok(failure !== null);
	assert.equal(failure.code, 'flauz.orch.err.not-ready');
	fired('flauz.orch.err.not-ready');
	assert.equal(assertOrchSession({ orch: true, version: 'flauz.orch/v1' }, 'flauz.orch.listGraphs'), null);
});

// ---------------------------------------------------------------------------
// Failure-mapping closure (every flauz.err.* and every domain code maps)
// ---------------------------------------------------------------------------

test('mapSeamFailure: every seam error code maps to a typed orchestration failure', () => {
	for (const seamCode of Object.values(SEAM_ERROR_CODES)) {
		const mapped = mapSeamFailure({ code: seamCode, message: `fired ${seamCode}` });
		assert.ok(ORCH_FAILURE_CODE_VALUES.includes(mapped.code), `${seamCode} -> ${mapped.code}`);
		assert.equal(mapped.message, `fired ${seamCode}`);
		assert.equal(mapped.seamCode, seamCode);
		fired(mapped.code);
	}
	// the closed set: an unknown flauz.err.* fails closed to internal
	const unknown = mapSeamFailure({ code: 'flauz.err.from-the-future', message: 'boom' });
	assert.equal(unknown.code, 'flauz.orch.err.internal');
	assert.equal(unknown.seamCode, 'flauz.err.from-the-future');
	fired('flauz.orch.err.internal');
	// garbage input never throws
	const garbage = mapSeamFailure(null);
	assert.equal(garbage.code, 'flauz.orch.err.internal');
	assert.deepEqual(mapSeamFailure({ code: SEAM_ERROR_CODES.INVALID_PARAMS, message: 'x', details: { a: 1 } }).details, { a: 1 });
});

test('mapOrchestrationError: every domain code maps; unknowns and foreign errors fail closed', () => {
	for (const domainCode of Object.keys(ORCHESTRATION_ERROR_CODE_MAP)) {
		const mapped = mapOrchestrationError(new OrchestrationError(`fired ${domainCode}`, domainCode));
		assert.equal(mapped.code, ORCHESTRATION_ERROR_CODE_MAP[domainCode], domainCode);
		assert.equal(mapped.domainCode, domainCode);
		fired(mapped.code);
	}
	const foreign = mapOrchestrationError(new Error('plain'));
	assert.equal(foreign.code, 'flauz.orch.err.internal');
	assert.equal(foreign.domainCode, undefined);
	const carrier = new OrchProtocolFailure(orchFailure(ORCH_FAILURE_CODES.SHUTTING_DOWN, 'carried'));
	assert.equal(orchFailureOf(carrier).code, 'flauz.orch.err.shutting-down');
	assert.equal(orchFailureOf(new Error('x')).code, 'flauz.orch.err.internal');
});

test('SEAM_FAILURE_CODE_MAP and ORCHESTRATION_ERROR_CODE_MAP are closed over their enums', () => {
	const seamCodes = new Set(Object.values(SEAM_ERROR_CODES));
	for (const key of Object.keys(SEAM_FAILURE_CODE_MAP)) {
		assert.ok(seamCodes.has(key), `unexpected seam code ${key}`);
	}
	for (const value of Object.values(SEAM_FAILURE_CODE_MAP)) {
		assert.ok(ORCH_FAILURE_CODE_VALUES.includes(value), `unexpected orch code ${value}`);
	}
	for (const value of Object.values(ORCHESTRATION_ERROR_CODE_MAP)) {
		assert.ok(ORCH_FAILURE_CODE_VALUES.includes(value), `unexpected orch code ${value}`);
	}
});

// ---------------------------------------------------------------------------
// The in-process mediator (fixture 1)
// ---------------------------------------------------------------------------

interface MedEvent {
	event: string;
	payload: Record<string, unknown>;
	ts: number;
}

function makeMediator(prefix: string, base = 1700000000000): { mediator: OrchestrationMediator; events: MedEvent[] } {
	const { clock } = makeClock(base);
	const mediator = new OrchestrationMediator(makeRoot(prefix), { clock });
	const events: MedEvent[] = [];
	mediator.subscribe((event) => events.push(event));
	return { mediator, events };
}

async function submitApproved(mediator: OrchestrationMediator, steps: Array<Record<string, unknown>> = GOOD_STEPS): Promise<string> {
	const submitted = await mediator.dispatch('flauz.orch.submitGraph', { actor: 'agent', origin: 'test:proto', steps, title: 'proto graph' }) as { graphId: string };
	await mediator.dispatch('flauz.orch.approveGraph', { graphId: submitted.graphId, actor: 'human', origin: 'test:proto' });
	return submitted.graphId;
}

test('mediator: golden dispatch flow with the event stream in journal order', async () => {
	const { mediator, events } = makeMediator('golden');
	const graphId = await submitApproved(mediator);
	const approval = await mediator.dispatch('flauz.orch.requestApproval', { graphId, stepId: 'S-01', reason: 'gate', actor: 'agent', origin: 'test:proto' }) as { rowId: string };
	assert.match(approval.rowId, /^R-\d{6,}$/);
	// the human gate: an agent decision is refused by the durable graph
	await assert.rejects(() => mediator.dispatch('flauz.orch.decideApproval', { graphId, stepId: 'S-01', decision: 'granted', actor: 'agent', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.illegal-transition');
		assert.equal(failure.domainCode, 'illegal-transition');
		fired(failure.code);
		return true;
	});
	await mediator.dispatch('flauz.orch.decideApproval', { graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'test:proto' });
	const started = await mediator.dispatch('flauz.orch.startStep', { graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:proto' }) as { attempt: number; idempotencyKey: string };
	assert.equal(started.idempotencyKey, `flauz-orch/${graphId}/S-01/run/${String(started.attempt)}`);
	await mediator.dispatch('flauz.orch.finishStep', { graphId, stepId: 'S-01', attempt: started.attempt, outcome: 'succeeded', output: 'done', evidence: [{ kind: 'note', uri: 'flauz-test://proto', sha256: 'a'.repeat(64) }], actor: 'agent', origin: 'test:proto' });
	const state = await mediator.dispatch('flauz.orch.getGraph', { graphId }) as { graphStatus: string; steps: Record<string, { status: string }> };
	assert.equal(state.graphStatus, 'approved');
	assert.equal(state.steps['S-01'].status, 'succeeded');
	const verify = await mediator.dispatch('flauz.orch.verifyJournal', {}) as { ok: boolean; rows: number };
	assert.deepEqual(verify, { ok: true, rows: 6 });
	// the event stream: one orch-journal-row per row + the domain events, in order
	const stream = events.filter((event) => event.event === 'orch-journal-row');
	assert.equal(stream.length, 6);
	assert.deepEqual(stream.map((event) => event.payload.type), ['graph-submitted', 'graph-approved', 'approval-requested', 'approval-granted', 'step-started', 'step-succeeded']);
	assert.deepEqual(stream.map((event) => event.payload.seq), [1, 2, 3, 4, 5, 6]);
	const domainEvents = events.filter((event) => event.event !== 'orch-journal-row').map((event) => event.event);
	assert.deepEqual(domainEvents, ['orch-approval-requested', 'orch-approval-decided']);
	// events carry persisted facts only: rowIds match the journal
	for (const event of stream) {
		const row = mediator.store.journalRows[(event.payload.seq as number) - 1];
		assert.equal(event.payload.rowId, row.rowId);
	}
});

test('mediator: lease and claim operations with notices, and the informational conflict posture', async () => {
	const { mediator } = makeMediator('lease');
	const graphId = await submitApproved(mediator);
	const claim = await mediator.dispatch('flauz.orch.acquireClaim', { graphId, stepId: 'S-01', holder: 'agent-a', actor: 'agent', origin: 'test:proto' }) as { claimId: string };
	assert.equal(claim.claimId, 'C-001-01');
	const lease = await mediator.dispatch('flauz.orch.acquireLease', { graphId, stepId: 'S-01', holder: 'agent-a', ttlMs: 5000, actor: 'agent', origin: 'test:proto' }) as { leaseId: string };
	assert.match(lease.leaseId, /^L-001-01-1$/);
	await mediator.dispatch('flauz.orch.renewLease', { graphId, stepId: 'S-01', ttlMs: 5000, actor: 'agent', origin: 'test:proto' });
	// a non-holder start records conflict-noticed FIRST (informational v0), then proceeds
	const started = await mediator.dispatch('flauz.orch.startStep', { graphId, stepId: 'S-01', runnerId: 'runner-b', actor: 'agent', origin: 'test:proto' });
	assert.ok((started as { attempt: number }).attempt >= 1);
	// the M5 posture: one informational notice PER VIOLATION CLASS (the claim AND the lease are both held by agent-a)
	const conflicts = mediator.store.journalRows.filter((row) => row.type === 'conflict-noticed');
	assert.equal(conflicts.length, 2);
	assert.deepEqual(conflicts.map((row) => row.payload.violation), ['claim', 'lease']);
	assert.equal(conflicts[0].payload.expectedHolder, 'agent-a');
	assert.equal(conflicts[0].payload.actualRunner, 'runner-b');
	const conflict = await mediator.dispatch('flauz.orch.noticeConflict', { graphId, stepId: 'S-01', violation: 'lease', expectedHolder: 'agent-a', actualRunner: 'runner-b', note: 'informational', actor: 'service', origin: 'test:proto' });
	assert.match((conflict as { rowId: string }).rowId, /^R-\d{6,}$/);
	// double acquire while the lease is STILL ACTIVE is a structural exclusivity violation (illegal-transition)
	await assert.rejects(() => mediator.dispatch('flauz.orch.acquireLease', { graphId, stepId: 'S-01', holder: 'agent-z', ttlMs: 5000, actor: 'agent', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.illegal-transition');
		fired(failure.code);
		return true;
	});
	await mediator.dispatch('flauz.orch.releaseLease', { graphId, stepId: 'S-01', actor: 'agent', origin: 'test:proto' });
	// after the release a fresh acquire is legal again (the exclusivity is per active lease)
	const reacquired = await mediator.dispatch('flauz.orch.acquireLease', { graphId, stepId: 'S-01', holder: 'agent-z', ttlMs: 5000, actor: 'agent', origin: 'test:proto' }) as { leaseId: string };
	assert.equal(reacquired.leaseId, 'L-001-01-2');
});

test('mediator: approval expiry through the protocol (fail-closed; never auto-granted)', async () => {
	const { mediator, events } = makeMediator('expiry');
	const graphId = await submitApproved(mediator);
	await mediator.dispatch('flauz.orch.requestApproval', { graphId, stepId: 'S-01', reason: 'gate', expiresAt: 1700000900000, actor: 'agent', origin: 'test:proto' });
	// before the deadline the expiry is refused (the human still owns the decision)
	await assert.rejects(() => mediator.dispatch('flauz.orch.expireApproval', { graphId, stepId: 'S-01', expiredAt: 1700000000000, actor: 'service', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.invalid-params');
		fired(failure.code);
		return true;
	});
	// an expiry by a non-service actor is refused by the durable graph (actor gate)
	await assert.rejects(() => mediator.dispatch('flauz.orch.expireApproval', { graphId, stepId: 'S-01', expiredAt: 1700000900000, actor: 'human', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.illegal-transition');
		fired(failure.code);
		return true;
	});
	const expired = await mediator.dispatch('flauz.orch.expireApproval', { graphId, stepId: 'S-01', actor: 'service', origin: 'test:proto' }) as { rowId: string };
	assert.match(expired.rowId, /^R-\d{6,}$/);
	const state = await mediator.dispatch('flauz.orch.getGraph', { graphId }) as { steps: Record<string, { status: string; approval: { state: string } | null; failure: { class: string } | null }> };
	assert.equal(state.steps['S-01'].status, 'cancelled');
	assert.equal(state.steps['S-01'].approval?.state, 'expired');
	assert.equal(state.steps['S-01'].failure?.class, 'approval-expired');
	const domain = events.filter((event) => event.event === 'orch-approval-expired');
	assert.equal(domain.length, 1);
	assert.equal((domain[0].payload as { expiredAt: number }).expiredAt, 1700000900000);
	// a request WITHOUT a deadline never expires (a human must decide or the graph is cancelled)
	const graphId2 = await submitApproved(mediator);
	await mediator.dispatch('flauz.orch.requestApproval', { graphId: graphId2, stepId: 'S-01', reason: 'no deadline', actor: 'agent', origin: 'test:proto' });
	await assert.rejects(() => mediator.dispatch('flauz.orch.expireApproval', { graphId: graphId2, stepId: 'S-01', actor: 'service', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.illegal-transition');
		fired(failure.code);
		return true;
	});
});

test('mediator: unknown method, unknown graph/step, invalid params surface as typed failures', async () => {
	const { mediator } = makeMediator('failures');
	await assert.rejects(() => mediator.dispatch('flauz.orch.nope', {}), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.unknown-method');
		fired(failure.code);
		return true;
	});
	await assert.rejects(() => mediator.dispatch('flauz.orch.getGraph', { graphId: 'G-999' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.unknown-graph');
		assert.equal(failure.domainCode, 'unknown-graph');
		fired(failure.code);
		return true;
	});
	const graphId = await submitApproved(mediator);
	await assert.rejects(() => mediator.dispatch('flauz.orch.startStep', { graphId, stepId: 'S-99', runnerId: 'r', actor: 'agent', origin: 'test:proto' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.unknown-step');
		fired(failure.code);
		return true;
	});
	await assert.rejects(() => mediator.dispatch('flauz.orch.submitGraph', { actor: 'agent', origin: 'test:proto', steps: [], title: 'x' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.invalid-params');
		fired(failure.code);
		return true;
	});
});

test('mediator: a taskPort failure surfaces as internal (the fail-closed default)', async () => {
	const root = makeRoot('internal');
	const taskPort = {
		createTask: async (): Promise<{ taskId: string }> => {
			throw new Error('ledger exploded');
		},
	};
	const mediator = new OrchestrationMediator(root, { taskPort, clock: makeClock(1700000000000).clock });
	await assert.rejects(() => mediator.dispatch('flauz.orch.submitGraph', { actor: 'agent', origin: 'test:proto', steps: GOOD_STEPS, title: 'x' }), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.internal');
		fired(failure.code);
		return true;
	});
});

test('mediator shutdown ordering: in-flight completes before the drain; new work refused; idempotent', async () => {
	const root = makeRoot('drain');
	let releaseCreate: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		releaseCreate = resolve;
	});
	const taskPort = {
		createTask: async (): Promise<{ taskId: string }> => {
			await gate;
			return { taskId: 'T-001' };
		},
		appendEvent: async (): Promise<{ task: unknown }> => ({ task: null }),
		appendEvidence: async (): Promise<{ evidenceId: string; seq: number }> => ({ evidenceId: 'E-000001', seq: 1 }),
	};
	const mediator = new OrchestrationMediator(root, { taskPort, clock: makeClock(1700000000000).clock });
	const pending = mediator.dispatch('flauz.orch.submitGraph', { actor: 'agent', origin: 'test:proto', steps: GOOD_STEPS, title: 'drain me' });
	await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
	const shutdownPromise = mediator.shutdown();
	let settled = false;
	void pending.then(() => {
		settled = true;
	});
	await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
	// while the createTask gate holds, neither the dispatch nor the drain settles
	assert.equal(settled, false);
	assert.equal(mediator.state, 'draining');
	await assert.rejects(() => mediator.dispatch('flauz.orch.listGraphs', {}), (error: unknown) => {
		const failure = failureOf(error);
		assert.equal(failure.code, 'flauz.orch.err.shutting-down');
		fired(failure.code);
		return true;
	});
	releaseCreate!();
	const submitted = await pending as { graphId: string };
	assert.equal(submitted.graphId, 'G-001');
	const shutdown = await shutdownPromise;
	assert.deepEqual(shutdown, { ok: true, state: 'drained', replay: false });
	assert.equal(settled, true);
	const again = await mediator.shutdown();
	assert.deepEqual(again, { ok: true, state: 'drained', replay: true });
});

test('mediator: recoveryScan dispatch records the scan and emits its events', async () => {
	const { mediator, events } = makeMediator('recovery');
	const graphId = await submitApproved(mediator);
	const started = await mediator.dispatch('flauz.orch.startStep', { graphId, stepId: 'S-01', runnerId: 'runner-a', actor: 'agent', origin: 'test:proto' }) as { attempt: number };
	// leave the step running (no finish): the scan must notice the interruption
	const report = await mediator.dispatch('flauz.orch.recoveryScan', { actor: 'service', origin: 'test:recovery', now: 1893456000000 }) as { clean: boolean; actions: string[] };
	assert.equal(report.clean, false);
	assert.ok(report.actions.includes(`${graphId}:step-interrupted:S-01`));
	const scanEvents = events.filter((event) => event.event === 'orch-recovery-scan');
	assert.equal(scanEvents.length, 1);
	const interrupted = events.filter((event) => event.event === 'orch-journal-row' && event.payload.type === 'step-interrupted');
	assert.equal(interrupted.length, 1);
	// a second scan of the now-clean state reports clean
	const second = await mediator.dispatch('flauz.orch.recoveryScan', { actor: 'service', origin: 'test:recovery', now: 1893456000000 }) as { clean: boolean };
	assert.equal(second.clean, true);
	// record=false computes without appending
	const rowsBefore = mediator.store.journalRows.length;
	const third = await mediator.dispatch('flauz.orch.recoveryScan', { actor: 'service', origin: 'test:recovery', record: false, now: 1893456000000 }) as { clean: boolean };
	assert.equal(third.clean, true);
	assert.equal(mediator.store.journalRows.length, rowsBefore);
});

test('mediator: a re-constructed mediator reloads the durable state (logical state survives restart)', async () => {
	const root = makeRoot('restart');
	const first = new OrchestrationMediator(root, { clock: makeClock(1700000000000).clock });
	const graphId = await submitApproved(first);
	await first.dispatch('flauz.orch.requestApproval', { graphId, stepId: 'S-01', reason: 'gate', actor: 'agent', origin: 'test:proto' });
	await first.shutdown();
	// a fresh mediator over the same root replays the same logical state
	const second = new OrchestrationMediator(root, { clock: makeClock(1750000000000).clock });
	const state = await second.dispatch('flauz.orch.getGraph', { graphId }) as { graphStatus: string; steps: Record<string, { status: string; approval: { state: string } | null }> };
	assert.equal(state.graphStatus, 'approved');
	assert.equal(state.steps['S-01'].status, 'awaiting-approval');
	assert.equal(state.steps['S-01'].approval?.state, 'pending');
	const verify = await second.dispatch('flauz.orch.verifyJournal', {}) as { ok: boolean; rows: number };
	assert.equal(verify.ok, true);
});

// ---------------------------------------------------------------------------
// The stdio loopback driver (fixture 2 - the real wire)
// ---------------------------------------------------------------------------

interface DeliveredLine {
	raw: string;
	message: Record<string, unknown>;
}

class LoopbackProcess {
	private readonly child: ChildProcess;
	private readonly pending: DeliveredLine[] = [];
	private readonly waiters: Array<{ predicate: (message: Record<string, unknown>) => boolean; resolve: (line: DeliveredLine) => void; timer: ReturnType<typeof setTimeout> }> = [];
	private readonly exitWaiters: Array<(code: number | null) => void> = [];
	readonly delivered: Record<string, unknown>[] = [];
	exitCode: number | null | undefined;
	private buffer = '';

	constructor(root: string) {
		this.child = spawn(process.execPath, [LOOPBACK_PATH, root], { stdio: ['pipe', 'pipe', 'pipe'] });
		this.child.stdout.setEncoding('utf-8');
		this.child.stdout.on('data', (chunk: { toString(encoding?: string): string }) => {
			this.buffer += chunk;
			let newline = this.buffer.indexOf('\n');
			while (newline !== -1) {
				const line = this.buffer.slice(0, newline);
				this.buffer = this.buffer.slice(newline + 1);
				if (line.trim().length > 0) {
					this.deliver({ raw: line, message: JSON.parse(line) as Record<string, unknown> });
				}
				newline = this.buffer.indexOf('\n');
			}
		});
		this.child.stderr.setEncoding('utf-8');
		this.child.stderr.on('data', (chunk: { toString(encoding?: string): string }) => process.stderr.write(`[loopback] ${chunk.toString()}`));
		this.child.on('close', (code) => {
			this.exitCode = code ?? null;
			for (const waiter of this.exitWaiters) {
				waiter(this.exitCode);
			}
			this.exitWaiters.length = 0;
		});
	}

	private deliver(line: DeliveredLine): void {
		this.delivered.push(line.message);
		const index = this.waiters.findIndex((waiter) => waiter.predicate(line.message));
		if (index !== -1) {
			const [waiter] = this.waiters.splice(index, 1);
			clearTimeout(waiter.timer);
			waiter.resolve(line);
		} else {
			this.pending.push(line);
		}
	}

	send(value: unknown): void {
		this.child.stdin.write(`${JSON.stringify(value)}\n`);
	}

	sendRaw(text: string): void {
		this.child.stdin.write(text);
	}

	async next(predicate: (message: Record<string, unknown>) => boolean, label: string): Promise<DeliveredLine> {
		const index = this.pending.findIndex((line) => predicate(line.message));
		if (index !== -1) {
			return this.pending.splice(index, 1)[0];
		}
		return new Promise<DeliveredLine>((resolve, reject) => {
			const timer = setTimeout(() => {
				const indexToRemove = this.waiters.findIndex((waiter) => waiter.timer === timer);
				if (indexToRemove !== -1) {
					this.waiters.splice(indexToRemove, 1);
				}
				reject(new Error(`timed out after ${WAIT_MS}ms waiting for: ${label}`));
			}, WAIT_MS);
			this.waiters.push({ predicate, resolve, timer });
		});
	}

	async exit(): Promise<number | null> {
		if (this.exitCode !== undefined) {
			return this.exitCode;
		}
		return new Promise((resolve) => {
			this.exitWaiters.push(resolve);
		});
	}

	kill(): void {
		this.child.kill('SIGKILL');
	}

	endStdin(): void {
		this.child.stdin.end();
	}
}

const V1_ORCH_HELLO = { type: 'hello', client: 'flauz-agent', version: '0.1.0', protocolVersions: [SEAM_PROTOCOL_V1, SEAM_PROTOCOL_V0], orchProtocolVersions: [ORCH_PROTOCOL_V1] };
const V1_PLAIN_HELLO = { type: 'hello', client: 'flauz-agent', version: '0.1.0', protocolVersions: [SEAM_PROTOCOL_V1, SEAM_PROTOCOL_V0] };
const V0_HELLO = { type: 'hello', client: 'flauz-agent', version: '0.1.0' };
const PLAIN_V1_READY = { type: 'ready', service: 'flauz-orch-loopback', version: '0.1.0', schema: 'flauz.tasks/v0', protocolVersion: SEAM_PROTOCOL_V1, capabilities: ['flauz.a2a', 'flauz.health', 'flauz.lifecycle', 'flauz.workspace'] };
const V0_READY_LINE = '{"type":"ready","service":"flauz-orch-loopback","version":"0.1.0","schema":"flauz.tasks/v0"}';

test('loopback: v1+orch handshake, full dispatch flow, wire events, graceful shutdown', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-golden'));
	try {
		loop.send(V1_ORCH_HELLO);
		const ready = await loop.next((message) => message.type === 'ready', 'ready');
		assert.deepEqual(ready.message, { ...PLAIN_V1_READY, orchProtocolVersion: 'flauz.orch/v1', capabilities: [...(PLAIN_V1_READY.capabilities as string[]), 'flauz.orch'] });
		// the ready line is the plain v1 shape + the two additive orch fields, in order
		assert.deepEqual(Object.keys(ready.message), ['type', 'service', 'version', 'schema', 'protocolVersion', 'capabilities', 'orchProtocolVersion']);
		// the client-side session outcome is active
		const session = orchSessionOf([ORCH_PROTOCOL_V1], ready.message);
		assert.equal(session.orch, true);
		// the golden flow over the wire
		loop.send({ id: 1, cmd: 'flauz.orch.submitGraph', args: { actor: 'agent', origin: 'test:wire', steps: GOOD_STEPS, title: 'wire graph' } });
		const submitted = await loop.next((message) => message.id === 1, 'submit');
		assert.equal(submitted.message.ok, true);
		const graphId = (submitted.message.result as { graphId: string }).graphId;
		const journalRow = await loop.next((message) => isSeamEvent(message) && message.event === 'orch-journal-row', 'journal-row event');
		assert.equal((journalRow.message.payload as { type: string }).type, 'graph-submitted');
		loop.send({ id: 2, cmd: 'flauz.orch.approveGraph', args: { graphId, actor: 'human', origin: 'test:wire' } });
		await loop.next((message) => message.id === 2, 'approve');
		loop.send({ id: 3, cmd: 'flauz.orch.requestApproval', args: { graphId, stepId: 'S-01', reason: 'gate', actor: 'agent', origin: 'test:wire' } });
		await loop.next((message) => message.id === 3, 'requestApproval');
		const approvalEvent = await loop.next((message) => isSeamEvent(message) && message.event === 'orch-approval-requested', 'approval event');
		assert.equal((approvalEvent.message.payload as { reason: string }).reason, 'gate');
		// the human gate over the wire: an agent decision is a typed failure on the structured envelope
		loop.send({ id: 4, cmd: 'flauz.orch.decideApproval', args: { graphId, stepId: 'S-01', decision: 'granted', actor: 'agent', origin: 'test:wire' } });
		const refused = await loop.next((message) => message.id === 4, 'agent grant refused');
		assert.equal(refused.message.ok, false);
		const refusal = refused.message.error as { code: string; message: string };
		assert.equal(refusal.code, 'flauz.orch.err.illegal-transition');
		fired(refusal.code);
		assert.match(refusal.message, /requires actor human/);
		loop.send({ id: 5, cmd: 'flauz.orch.decideApproval', args: { graphId, stepId: 'S-01', decision: 'granted', actor: 'human', origin: 'test:wire' } });
		await loop.next((message) => message.id === 5, 'human grant');
		loop.send({ id: 6, cmd: 'flauz.orch.verifyJournal', args: {} });
		const verify = await loop.next((message) => message.id === 6, 'verify');
		assert.deepEqual(verify.message.result, { ok: true, rows: 4 });
		// graceful shutdown: the bare v0 command works under a v1 session too
		loop.send({ id: 7, cmd: 'shutdown' });
		const shutdown = await loop.next((message) => message.id === 7, 'shutdown answer');
		assert.equal(shutdown.message.ok, true);
		const code = await loop.exit();
		assert.equal(code, 0);
	} finally {
		loop.kill();
	}
});

test('loopback: plain v1 client (no orch offer) - plain ready, no orch capability, orch methods unknown', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-plain'));
	try {
		loop.send(V1_PLAIN_HELLO);
		const ready = await loop.next((message) => message.type === 'ready', 'ready');
		assert.deepEqual(ready.message, PLAIN_V1_READY);
		assert.equal('orchProtocolVersion' in ready.message, false);
		// the orch method gate: unknown-method (the registry-derived seam discipline)
		loop.send({ id: 1, cmd: 'flauz.orch.listGraphs', args: {} });
		const refused = await loop.next((message) => message.id === 1, 'orch unknown');
		assert.equal(refused.message.ok, false);
		const failure = refused.message.error as { code: string };
		assert.equal(failure.code, 'flauz.err.unknown-method');
		fired('flauz.orch.err.unknown-method');
		// the seam surface itself keeps working
		loop.send({ id: 2, cmd: 'ping' });
		const ping = await loop.next((message) => message.id === 2, 'ping');
		assert.equal(ping.message.ok, true);
		loop.send({ id: 3, cmd: 'shutdown' });
		await loop.next((message) => message.id === 3, 'shutdown');
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

test('loopback: orch-mismatch offer never kills the session; the client detects the absence', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-mismatch'));
	try {
		loop.send({ ...V1_PLAIN_HELLO, orchProtocolVersions: ['flauz.orch/v9'] });
		const ready = await loop.next((message) => message.type === 'ready', 'ready');
		// the plain v1 ready: no orch fields, no orch capability, session alive
		assert.deepEqual(ready.message, PLAIN_V1_READY);
		const session = orchSessionOf(['flauz.orch/v9'], ready.message);
		assert.equal(session.orch, false);
		assert.equal(session.failure?.code, 'flauz.orch.err.unsupported-version');
		fired('flauz.orch.err.unsupported-version');
		// the seam surface still serves the client
		loop.send({ id: 1, cmd: 'ping' });
		const ping = await loop.next((message) => message.id === 1, 'ping');
		assert.equal(ping.message.ok, true);
		loop.send({ id: 2, cmd: 'shutdown' });
		await loop.next((message) => message.id === 2, 'shutdown');
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

test('loopback: v0 client - byte-exact v0 ready, string errors, no wire events, bare shutdown exit 0', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-v0'));
	try {
		loop.send(V0_HELLO);
		const ready = await loop.next((message) => message.type === 'ready', 'ready');
		assert.equal(ready.raw, V0_READY_LINE);
		// an orch method under v0 answers the v0 string projection
		loop.send({ id: 1, cmd: 'flauz.orch.listGraphs', args: {} });
		const refused = await loop.next((message) => message.id === 1, 'orch unknown v0');
		assert.equal(refused.message.ok, false);
		assert.equal(refused.message.error, 'unknown command: flauz.orch.listGraphs');
		loop.send({ id: 2, cmd: 'shutdown' });
		const shutdown = await loop.next((message) => message.id === 2, 'shutdown');
		assert.equal(shutdown.message.ok, true);
		// no event envelope ever hit stdout
		assert.equal(loop.delivered.filter((message) => isSeamEvent(message)).length, 0);
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

test('loopback: seam version mismatch -> one structured error line + exit 4', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-seam-mismatch'));
	try {
		loop.send({ ...V0_HELLO, protocolVersions: ['flauz.seam/v9'] });
		const error = await loop.next((message) => message.type === 'error', 'mismatch error');
		assert.equal((error.message as { code: string }).code, 'flauz.err.unsupported-version');
		assert.equal(await loop.exit(), 4);
	} finally {
		loop.kill();
	}
});

test('loopback: handshake-first (pre-hello requests refused), malformed lines tolerated, re-hello reloads durable state', { timeout: 30000 }, async () => {
	const root = makeRoot('wire-discipline');
	const loop = new LoopbackProcess(root);
	try {
		loop.send({ id: 1, cmd: 'flauz.orch.listGraphs', args: {} });
		const notReady = await loop.next((message) => message.id === 1, 'pre-hello refusal');
		assert.equal(notReady.message.ok, false);
		assert.equal(notReady.message.error, 'service not ready: send hello first');
		loop.sendRaw('this is not json\n');
		const malformed = await loop.next((message) => message.type === 'error', 'malformed line');
		assert.equal((malformed.message as { message: string }).message, 'unparseable line');
		// the session continues after the malformed line
		loop.send(V1_ORCH_HELLO);
		const ready = await loop.next((message) => message.type === 'ready', 'ready');
		assert.equal((ready.message as { orchProtocolVersion: string }).orchProtocolVersion, 'flauz.orch/v1');
		loop.send({ id: 2, cmd: 'flauz.orch.submitGraph', args: { actor: 'agent', origin: 'test:wire', steps: GOOD_STEPS, title: 'first life' } });
		const submitted = await loop.next((message) => message.id === 2, 'submit');
		assert.equal(submitted.message.ok, true);
		// a re-hello resets the session AND reloads the durable state from disk
		loop.send(V1_ORCH_HELLO);
		await loop.next((message) => message.type === 'ready', 're-hello ready');
		loop.send({ id: 3, cmd: 'flauz.orch.listGraphs', args: {} });
		const listed = await loop.next((message) => message.id === 3, 'list after re-hello');
		const graphs = (listed.message.result as { graphs: Array<{ graphId: string; title: string }> }).graphs;
		assert.equal(graphs.length, 1);
		assert.equal(graphs[0].title, 'first life');
		loop.send({ id: 4, cmd: 'flauz.orch.verifyJournal', args: {} });
		const verify = await loop.next((message) => message.id === 4, 'verify after re-hello');
		assert.equal((verify.message.result as { rows: number }).rows, 1);
		loop.send({ id: 5, cmd: 'shutdown' });
		await loop.next((message) => message.id === 5, 'shutdown');
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

test('loopback: shutdown ordering - pipelined requests answer in order, post-shutdown orch work refuses, batched shutdowns answered, exit 0', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-ordering'));
	try {
		loop.send(V1_ORCH_HELLO);
		await loop.next((message) => message.type === 'ready', 'ready');
		// one write, three pipelined lines: an orch request, the shutdown, another orch request
		loop.sendRaw(`${JSON.stringify({ id: 1, cmd: 'flauz.orch.submitGraph', args: { actor: 'agent', origin: 'test:wire', steps: GOOD_STEPS, title: 'ordering' } })}\n${JSON.stringify({ id: 2, cmd: 'shutdown' })}\n${JSON.stringify({ id: 3, cmd: 'flauz.orch.listGraphs', args: {} })}\n${JSON.stringify({ id: 4, cmd: 'shutdown' })}\n`);
		const first = await loop.next((message) => message.id === 1, 'pipelined submit');
		assert.equal(first.message.ok, true);
		// the submit's event was delivered before the shutdown answers (in-order processing)
		assert.ok(loop.delivered.some((message) => isSeamEvent(message) && message.event === 'orch-journal-row'));
		const shutdown1 = await loop.next((message) => message.id === 2, 'first shutdown');
		assert.equal(shutdown1.message.ok, true);
		const refused = await loop.next((message) => message.id === 3, 'drain refusal');
		assert.equal(refused.message.ok, false);
		const typed = refused.message.error as { code: string };
		assert.equal(typed.code, 'flauz.orch.err.shutting-down');
		fired('flauz.orch.err.shutting-down');
		const shutdown2 = await loop.next((message) => message.id === 4, 'batched second shutdown');
		assert.equal(shutdown2.message.ok, true);
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

test('loopback: stdin end after orch work drains and exits 0 (EOF shutdown)', { timeout: 30000 }, async () => {
	const loop = new LoopbackProcess(makeRoot('wire-eof'));
	try {
		loop.send(V1_ORCH_HELLO);
		await loop.next((message) => message.type === 'ready', 'ready');
		loop.send({ id: 1, cmd: 'flauz.orch.submitGraph', args: { actor: 'agent', origin: 'test:wire', steps: GOOD_STEPS, title: 'eof' } });
		const submitted = await loop.next((message) => message.id === 1, 'submit');
		assert.equal(submitted.message.ok, true);
		loop.endStdin();
		assert.equal(await loop.exit(), 0);
	} finally {
		loop.kill();
	}
});

// ---------------------------------------------------------------------------
// Coverage closure + result-validation self-checks
// ---------------------------------------------------------------------------

test('validateOrchResult: the good shapes pass, malformed shapes fail', () => {
	assert.equal(validateOrchResult('flauz.orch.submitGraph', { graphId: 'G-001', taskId: null, stepIds: ['S-01'], rowId: 'R-000001' }), undefined);
	assert.ok(validateOrchResult('flauz.orch.submitGraph', { graphId: 'G-001' }) !== undefined);
	assert.ok(validateOrchResult('flauz.orch.submitGraph', { graphId: 'G-001', taskId: null, stepIds: ['S-01'], rowId: 'R-000001', extra: 1 }) !== undefined);
	assert.equal(validateOrchResult('flauz.orch.requestApproval', { rowId: 'R-000003' }), undefined);
	assert.equal(validateOrchResult('flauz.orch.requestApproval', { rowId: 'R-000003', evidenceId: 'E-000002' }), undefined);
	assert.ok(validateOrchResult('flauz.orch.requestApproval', { rowId: 'R-000003', evidenceId: 'E-2' }) !== undefined);
	assert.equal(validateOrchResult('flauz.orch.startStep', { attempt: 1, idempotencyKey: 'k', rowId: 'R-000001' }), undefined);
	assert.ok(validateOrchResult('flauz.orch.startStep', { attempt: 1, idempotencyKey: 'k' }) !== undefined);
	assert.ok(validateOrchResult('flauz.orch.nope', {}) !== undefined);
});

test('failure-code coverage: every ORCH_FAILURE_CODES value fired from a real path', () => {
	const missing = ORCH_FAILURE_CODE_VALUES.filter((code) => !firedCodes.has(code));
	assert.deepEqual(missing, [], `unfired failure codes: ${missing.join(', ')}`);
});

test('the seam event envelope wraps orch events without reshaping them (composition, not duplication)', () => {
	const wrapped = seamEvent('orch-lease-acquired', { graphId: 'G-001', stepId: 'S-01', leaseId: 'L-001-01-1', holder: 'agent-a', expiresAt: 1700000001000 }, 1700000000000);
	assert.ok(isSeamEvent(wrapped));
	assert.deepEqual(Object.keys(wrapped), ['type', 'event', 'payload', 'ts']);
	assert.equal((wrapped as { event: string }).event, 'orch-lease-acquired');
	// every catalog event name is a legal seam event name payload-wise (namespaced, additive)
	for (const event of ORCH_EVENT_NAMES) {
		assert.ok(event.startsWith('orch-'), event);
	}
	assert.equal(Object.keys(ORCH_METHODS).every((method) => method.startsWith('flauz.orch.')), true);
	// the catalog is exactly the unique row-type projections + the orch-journal-row stream event
	assert.equal(Object.keys(ORCH_EVENTS).length, new Set(Object.values(ORCH_ROW_EVENT_OF)).size + 1);
	for (const name of Object.values(ORCH_ROW_EVENT_OF)) {
		assert.ok(ORCH_EVENT_NAMES.includes(name), name);
	}
});
