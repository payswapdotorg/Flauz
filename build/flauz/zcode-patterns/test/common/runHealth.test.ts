/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	RUN_HEALTH_STATUSES,
	STALL_AFTER_MS,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	classifyRunHealth,
	isVersionedRunHealthSnapshot,
	type AgentInFlightCount,
	type RunHealthSnapshot,
	type RunHealthStatus,
	type ZcodeScope,
} from '../../common/runHealth.js';

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

function snapshot(overrides: Partial<RunHealthSnapshot>): RunHealthSnapshot {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
		runId: 'run-0001',
		lastEventAtIso: '2026-10-04T00:00:00.000Z',
		silentForMs: 1000,
		concurrencyRoster: [{ agentId: 'agent-lead', inFlight: 2 }, { agentId: 'agent-worker-1', inFlight: 1 }],
		...overrides,
	};
}

suite('runHealth', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('RUN_HEALTH_STATUSES pins the exact status union set', () => {
		assert.deepStrictEqual(RUN_HEALTH_STATUSES, ['healthy', 'stalled', 'unknown']);
	});

	test('STALL_AFTER_MS is an exported named threshold (no hidden magic numbers)', () => {
		assert.strictEqual(STALL_AFTER_MS, 120000);
	});

	test('classifyRunHealth: healthy below the stall threshold', () => {
		assert.strictEqual(classifyRunHealth(snapshot({ silentForMs: 0 })), 'healthy');
		assert.strictEqual(classifyRunHealth(snapshot({ silentForMs: STALL_AFTER_MS - 1 })), 'healthy');
	});

	test('classifyRunHealth: stalled at and beyond the stall threshold', () => {
		assert.strictEqual(classifyRunHealth(snapshot({ silentForMs: STALL_AFTER_MS })), 'stalled');
		assert.strictEqual(classifyRunHealth(snapshot({ silentForMs: STALL_AFTER_MS + 1 })), 'stalled');
		assert.strictEqual(classifyRunHealth(snapshot({ silentForMs: 10 * STALL_AFTER_MS })), 'stalled');
	});

	test('classifyRunHealth: unknown when the run has no events yet', () => {
		assert.strictEqual(classifyRunHealth(snapshot({ lastEventAtIso: '' })), 'unknown');
	});

	test('classifyRunHealth: unknown on a malformed stall signal (fail-closed)', () => {
		const negative = snapshot({ silentForMs: -1 });
		assert.strictEqual(classifyRunHealth(negative), 'unknown');
		const fractional = snapshot({ silentForMs: Number.NaN });
		assert.strictEqual(classifyRunHealth(fractional), 'unknown');
		const infinite = snapshot({ silentForMs: Number.POSITIVE_INFINITY });
		assert.strictEqual(classifyRunHealth(infinite), 'unknown');
	});

	test('classifyRunHealth: unknown on a malformed roster row (fail-closed)', () => {
		const emptyAgentId: AgentInFlightCount = { agentId: '', inFlight: 1 };
		assert.strictEqual(classifyRunHealth(snapshot({ concurrencyRoster: [emptyAgentId] })), 'unknown');
		const negativeInFlight: AgentInFlightCount = { agentId: 'agent-lead', inFlight: -1 };
		assert.strictEqual(classifyRunHealth(snapshot({ concurrencyRoster: [negativeInFlight] })), 'unknown');
		const fractionalInFlight: AgentInFlightCount = { agentId: 'agent-lead', inFlight: 1.5 };
		assert.strictEqual(classifyRunHealth(snapshot({ concurrencyRoster: [fractionalInFlight] })), 'unknown');
	});

	test('classifyRunHealth: a valid roster never flips a healthy verdict (the roster is carried observability data)', () => {
		const emptyRoster = snapshot({ concurrencyRoster: [] });
		assert.strictEqual(classifyRunHealth(emptyRoster), 'healthy');
		const busyRoster = snapshot({ concurrencyRoster: [{ agentId: 'agent-lead', inFlight: 0 }, { agentId: 'agent-worker-1', inFlight: 7 }] });
		assert.strictEqual(classifyRunHealth(busyRoster), 'healthy');
	});

	test('classifyRunHealth is pure: the same snapshot always yields the same verdict', () => {
		const stalled = snapshot({ silentForMs: STALL_AFTER_MS + 5000 });
		const first: RunHealthStatus = classifyRunHealth(stalled);
		const second: RunHealthStatus = classifyRunHealth(stalled);
		assert.strictEqual(first, second);
		assert.strictEqual(first, 'stalled');
	});

	test('minimal RunHealthSnapshot fixture compiles and fields read back', () => {
		const snap: RunHealthSnapshot = snapshot({});
		assert.strictEqual(snap.scope.workspaceId, 'ws-fixtures');
		assert.strictEqual(snap.scope.tenantId, 'tenant-fixtures');
		assert.strictEqual(snap.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
		assert.strictEqual(snap.runId, 'run-0001');
		assert.strictEqual(snap.lastEventAtIso, '2026-10-04T00:00:00.000Z');
		assert.strictEqual(snap.silentForMs, 1000);
		assert.deepStrictEqual(snap.concurrencyRoster, [{ agentId: 'agent-lead', inFlight: 2 }, { agentId: 'agent-worker-1', inFlight: 1 }]);
		assert.ok(isVersionedRunHealthSnapshot(snap));
	});

	test('isVersionedRunHealthSnapshot: true for current version, false for stale or missing', () => {
		assert.ok(isVersionedRunHealthSnapshot({ contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION }));
		assert.ok(!isVersionedRunHealthSnapshot({ contractVersion: '1.1.0' }));
		assert.ok(!isVersionedRunHealthSnapshot({}));
	});
});
