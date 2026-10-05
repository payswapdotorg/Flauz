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
	TERMINAL_AGENT_TASK_STATES,
	ACTIVE_AGENT_TASK_STATES,
	IDLE_AGENT_TASK_STATES,
	HEALTH_PROJECTION,
	type HealthProjection,
	type BackgroundAgentRosterEntry,
	type RosterTaskRecord,
	healthOf,
	rosterFromTaskRecords,
} from '../../common/registryView.js';

type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent registry-view contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
	});

	test('HEALTH_PROJECTION is TOTAL over the authority states (every state classified exactly once)', () => {
		assert.strictEqual(Object.keys(HEALTH_PROJECTION).length, LIFECYCLE_STATES.length);
		const seen = new Set<string>();
		for (const s of LIFECYCLE_STATES) {
			assert.ok(Object.prototype.hasOwnProperty.call(HEALTH_PROJECTION, s), `missing health for ${s}`);
			const h = HEALTH_PROJECTION[s as AgentTaskState];
			assert.ok(h === 'active' || h === 'idle' || h === 'terminal', `bad health ${h} for ${s}`);
			seen.add(`${s}=${h}`);
		}
		assert.strictEqual(seen.size, LIFECYCLE_STATES.length);
	});

	test('HEALTH_PROJECTION partitions the authority: active ∪ idle ∪ terminal = all, disjoint', () => {
		const active = new Set<string>(ACTIVE_AGENT_TASK_STATES);
		const idle = new Set<string>(IDLE_AGENT_TASK_STATES);
		const terminal = new Set<string>(TERMINAL_AGENT_TASK_STATES);
		for (const s of LIFECYCLE_STATES) {
			const count = (active.has(s) ? 1 : 0) + (idle.has(s) ? 1 : 0) + (terminal.has(s) ? 1 : 0);
			assert.strictEqual(count, 1, `${s} classified ${count} times`);
		}
		// the three buckets together cover exactly the authority
		const union = new Set<string>([...active, ...idle, ...terminal]);
		assert.deepStrictEqual([...union].sort(), [...LIFECYCLE_STATES].sort());
	});

	test('active = running-shape, idle = waiting-shape, terminal = destroyed/failed', () => {
		assert.deepStrictEqual([...ACTIVE_AGENT_TASK_STATES], ['running', 'running/attached']);
		assert.deepStrictEqual([...IDLE_AGENT_TASK_STATES], ['registered', 'created', 'starting', 'stopping', 'stopped', 'stopped/attached']);
		assert.deepStrictEqual([...TERMINAL_AGENT_TASK_STATES], ['destroyed', 'failed']);
		for (const s of ACTIVE_AGENT_TASK_STATES) { assert.strictEqual(HEALTH_PROJECTION[s as AgentTaskState], 'active'); }
		for (const s of IDLE_AGENT_TASK_STATES) { assert.strictEqual(HEALTH_PROJECTION[s as AgentTaskState], 'idle'); }
		for (const s of TERMINAL_AGENT_TASK_STATES) { assert.strictEqual(HEALTH_PROJECTION[s as AgentTaskState], 'terminal'); }
	});

	test('healthOf agrees with HEALTH_PROJECTION for every authority state', () => {
		for (const s of LIFECYCLE_STATES) {
			assert.strictEqual(healthOf(s as AgentTaskState), HEALTH_PROJECTION[s as AgentTaskState]);
		}
	});

	function record(taskId: string, currentState: AgentTaskState): RosterTaskRecord {
		return {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			taskId,
			currentState,
			sessionSummary: { sessionId: `sess-${taskId}` },
		};
	}

	test('rosterFromTaskRecords: projects each record with the correct health projection', () => {
		const roster = rosterFromTaskRecords([
			record('task-1', 'running'),
			record('task-2', 'registered'),
			record('task-3', 'failed'),
			record('task-4', 'stopped/attached'),
		]);
		assert.strictEqual(roster.length, 4);
		assert.strictEqual(roster[0].healthProjection, 'active');
		assert.strictEqual(roster[1].healthProjection, 'idle');
		assert.strictEqual(roster[2].healthProjection, 'terminal');
		assert.strictEqual(roster[3].healthProjection, 'idle');
		for (const e of roster) {
			assert.strictEqual(e.contractVersion, BACKGROUND_AGENT_UX_VERSION);
		}
	});

	test('rosterFromTaskRecords: empty input -> empty roster', () => {
		assert.deepStrictEqual(rosterFromTaskRecords([]), []);
		assert.deepStrictEqual(rosterFromTaskRecords([] as RosterTaskRecord[]), []);
	});

	test('rosterFromTaskRecords: skips malformed records (no scope, empty taskId) and preserves order', () => {
		const roster = rosterFromTaskRecords([
			{ scope: { workspaceId: '', tenantId: 't' }, taskId: 'task-x', currentState: 'running', sessionSummary: { sessionId: 's' } },
			record('task-1', 'running'),
			{ scope: { workspaceId: 'ws', tenantId: 't' }, taskId: '', currentState: 'running', sessionSummary: { sessionId: 's' } },
			record('task-2', 'destroyed'),
		]);
		assert.strictEqual(roster.length, 2);
		assert.strictEqual(roster[0].taskId, 'task-1');
		assert.strictEqual(roster[1].taskId, 'task-2');
		assert.strictEqual(roster[1].healthProjection, 'terminal');
	});

	test('rosterFromTaskRecords: every authority state yields the expected health projection (TOTALITY)', () => {
		const roster = rosterFromTaskRecords(LIFECYCLE_STATES.map((s, i) => record(`task-${i}`, s as AgentTaskState)));
		assert.strictEqual(roster.length, LIFECYCLE_STATES.length);
		for (let i = 0; i < LIFECYCLE_STATES.length; i++) {
			assert.strictEqual(roster[i].currentState, LIFECYCLE_STATES[i]);
			assert.strictEqual(roster[i].healthProjection, HEALTH_PROJECTION[LIFECYCLE_STATES[i] as AgentTaskState]);
		}
	});

	test('minimal BackgroundAgentRosterEntry fixture compiles and fields read back', () => {
		const entry: BackgroundAgentRosterEntry = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			sessionSummary: { sessionId: 'sess-1', agentBodyId: 'body-coder' },
			currentState: 'running/attached',
			healthProjection: 'active' as HealthProjection,
		};
		assert.strictEqual(entry.currentState, 'running/attached');
		assert.strictEqual(entry.healthProjection, healthOf('running/attached'));
	});
});
