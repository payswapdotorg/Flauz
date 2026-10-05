/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { LIFECYCLE_STATES, type LifecycleState } from '../../../../../../extensions/flauz-execution/src/contracts.js';
import {
	BACKGROUND_AGENT_UX_VERSION,
	AGENT_TASK_STATES,
	type AgentTaskState,
	INITIAL_AGENT_TASK_STATE,
	TERMINAL_AGENT_TASK_STATES,
	PRE_LAUNCH_AGENT_TASK_STATES,
	type CapabilityScope,
	type AgentLaunchRequest,
	type AgentLaunchAcceptance,
	type LeaseGrantSummary,
	canAcceptLaunch,
	buildLaunchAcceptance,
	rejectionReasonFor,
} from '../../common/launch.js';

// Type-level pin: the contract-duplicated AgentTaskState union MUST be identical
// to the authority LifecycleState union. Both directions must hold; if either
// narrows, the matching `const ... = true` fails to compile.
type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent launch contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
		assert.strictEqual(AGENT_TASK_STATES.length, LIFECYCLE_STATES.length);
		assert.strictEqual(AGENT_TASK_STATES.length, 10);
	});

	test('INITIAL_AGENT_TASK_STATE is the authority initial state', () => {
		assert.strictEqual(INITIAL_AGENT_TASK_STATE, 'registered');
		assert.strictEqual(LIFECYCLE_STATES[0], 'registered');
	});

	test('TERMINAL_AGENT_TASK_STATES and PRE_LAUNCH_AGENT_TASK_STATES are disjoint and within the authority', () => {
		for (const s of TERMINAL_AGENT_TASK_STATES) {
			assert.ok((LIFECYCLE_STATES as readonly string[]).includes(s), `terminal ${s} not in authority`);
		}
		for (const s of PRE_LAUNCH_AGENT_TASK_STATES) {
			assert.ok((LIFECYCLE_STATES as readonly string[]).includes(s), `pre-launch ${s} not in authority`);
			assert.ok(!(TERMINAL_AGENT_TASK_STATES as readonly string[]).includes(s), `pre-launch ${s} must not be terminal`);
		}
	});

	const scope: CapabilityScope = { workspaceId: 'ws-1', tenantId: 'tenant-1' };
	const goodLease: LeaseGrantSummary = { leaseId: 'L-001-01-1', grantedAtIso: '2026-10-01T00:00:00.000Z', expiresAtIso: '2026-10-01T00:10:00.000Z' };

	function goodRequest(overrides: Partial<AgentLaunchRequest> = {}): AgentLaunchRequest {
		return {
			scope,
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			sessionDescriptorSummary: { sessionId: 'sess-1', agentBodyId: 'body-coder', modelId: 'model-a', environmentId: 'env-1' },
			initialInstructionDigest: 'sha256:abc',
			budgetHints: { maxCostUsd: 1.5, maxLatencyMs: 60000, maxSteps: 50 },
			requestedAtIso: '2026-10-01T00:00:00.000Z',
			...overrides,
		};
	}

	test('canAcceptLaunch: true when well-formed and roster has room', () => {
		assert.ok(canAcceptLaunch(goodRequest(), 0, 1));
		assert.ok(canAcceptLaunch(goodRequest(), 3, 5));
	});

	test('canAcceptLaunch: false when the roster is full (currentRosterCount >= maxConcurrent)', () => {
		assert.ok(!canAcceptLaunch(goodRequest(), 1, 1));
		assert.ok(!canAcceptLaunch(goodRequest(), 5, 5));
		assert.ok(!canAcceptLaunch(goodRequest(), 6, 5));
	});

	test('canAcceptLaunch: false on contract-version mismatch', () => {
		assert.ok(!canAcceptLaunch(goodRequest({ contractVersion: '0.9.0' }), 0, 1));
	});

	test('canAcceptLaunch: false on invalid scope', () => {
		assert.ok(!canAcceptLaunch(goodRequest({ scope: { workspaceId: '', tenantId: 't' } }), 0, 1));
		assert.ok(!canAcceptLaunch(goodRequest({ scope: { workspaceId: 'ws', tenantId: '' } }), 0, 1));
	});

	test('canAcceptLaunch: false on missing session id / instruction digest', () => {
		assert.ok(!canAcceptLaunch(goodRequest({ sessionDescriptorSummary: { sessionId: '' } }), 0, 1));
		assert.ok(!canAcceptLaunch(goodRequest({ initialInstructionDigest: '' }), 0, 1));
	});

	test('canAcceptLaunch: false on negative / non-finite budget hints', () => {
		assert.ok(!canAcceptLaunch(goodRequest({ budgetHints: { maxCostUsd: -1 } }), 0, 1));
		assert.ok(!canAcceptLaunch(goodRequest({ budgetHints: { maxLatencyMs: Number.POSITIVE_INFINITY } }), 0, 1));
		assert.ok(!canAcceptLaunch(goodRequest({ budgetHints: { maxSteps: NaN } }), 0, 1));
	});

	test('canAcceptLaunch: true with empty budget hints (all optional)', () => {
		assert.ok(canAcceptLaunch(goodRequest({ budgetHints: {} }), 0, 1));
	});

	test('canAcceptLaunch: false on invalid roster arguments', () => {
		assert.ok(!canAcceptLaunch(goodRequest(), -1, 5));
		assert.ok(!canAcceptLaunch(goodRequest(), 0, -1));
		assert.ok(!canAcceptLaunch(goodRequest(), NaN, 5));
	});

	test('buildLaunchAcceptance: accepted carries leaseGrant + projected initial state', () => {
		const acceptance: AgentLaunchAcceptance = buildLaunchAcceptance(goodRequest(), 0, 2, goodLease);
		assert.strictEqual(acceptance.accepted, true);
		assert.strictEqual(acceptance.projectedInitialTaskState, INITIAL_AGENT_TASK_STATE);
		assert.strictEqual(acceptance.projectedInitialTaskState, 'registered');
		assert.strictEqual(acceptance.contractVersion, BACKGROUND_AGENT_UX_VERSION);
		assert.deepStrictEqual(acceptance.leaseGrant, goodLease);
		assert.strictEqual(acceptance.rejectionReason, undefined);
	});

	test('buildLaunchAcceptance: rejected drops leaseGrant and sets a reason', () => {
		const acceptance = buildLaunchAcceptance(goodRequest(), 2, 2, goodLease);
		assert.strictEqual(acceptance.accepted, false);
		assert.strictEqual(acceptance.leaseGrant, null);
		assert.strictEqual(acceptance.rejectionReason, 'roster-full');
	});

	test('rejectionReasonFor: deterministic, fail-closed reasons', () => {
		assert.strictEqual(rejectionReasonFor(goodRequest({ contractVersion: '0.9.0' }), 0, 1), 'contract-version-mismatch');
		assert.strictEqual(rejectionReasonFor(goodRequest(), 2, 2), 'roster-full');
		assert.strictEqual(rejectionReasonFor(goodRequest({ initialInstructionDigest: '' }), 0, 1), 'missing-initial-instruction-digest');
	});

	test('minimal AgentLaunchRequest fixture compiles and fields read back', () => {
		const req = goodRequest();
		assert.strictEqual(req.scope.workspaceId, 'ws-1');
		assert.strictEqual(req.contractVersion, BACKGROUND_AGENT_UX_VERSION);
		assert.strictEqual(req.sessionDescriptorSummary.sessionId, 'sess-1');
		assert.strictEqual(req.initialInstructionDigest, 'sha256:abc');
		assert.strictEqual(req.budgetHints.maxSteps, 50);
		assert.strictEqual(req.requestedAtIso, '2026-10-01T00:00:00.000Z');
	});
});
