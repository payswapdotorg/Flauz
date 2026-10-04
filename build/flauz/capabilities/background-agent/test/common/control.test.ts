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
	CONTROL_VERBS,
	type ControlVerb,
	type ControlRequest,
	type PauseRequest,
	type StopRequest,
	type CancelRequest,
	type ResumeRequest,
	CONTROL_ADMISSIBILITY,
	controlAdmissible,
	admissibleControlVerbs,
	isWellFormedControlRequest,
} from '../../common/control.js';

type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent control contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
	});

	test('CONTROL_VERBS is exactly pause/stop/cancel/resume', () => {
		assert.deepStrictEqual([...CONTROL_VERBS], ['pause', 'stop', 'cancel', 'resume']);
	});

	test('CONTROL_ADMISSIBILITY is TOTAL over the authority states (every state has an entry)', () => {
		for (const s of LIFECYCLE_STATES) {
			assert.ok(Object.prototype.hasOwnProperty.call(CONTROL_ADMISSIBILITY, s), `missing admissibility for ${s}`);
			assert.ok(Array.isArray(CONTROL_ADMISSIBILITY[s as AgentTaskState]));
		}
		assert.strictEqual(Object.keys(CONTROL_ADMISSIBILITY).length, LIFECYCLE_STATES.length);
	});

	test('controlAdmissible is TOTAL: verdict matches the map for every (state, verb) pair', () => {
		for (const s of LIFECYCLE_STATES) {
			for (const v of CONTROL_VERBS) {
				const expected = (CONTROL_ADMISSIBILITY[s as AgentTaskState] as readonly ControlVerb[]).includes(v);
				assert.strictEqual(controlAdmissible(s as AgentTaskState, v), expected, `${v} from ${s}`);
			}
		}
	});

	test('pause admitted only from running-shape states', () => {
		const admitted = (LIFECYCLE_STATES as readonly string[]).filter((s) => controlAdmissible(s as AgentTaskState, 'pause'));
		assert.deepStrictEqual(admitted, ['running', 'running/attached']);
	});

	test('stop admitted from starting and running-shape states', () => {
		const admitted = (LIFECYCLE_STATES as readonly string[]).filter((s) => controlAdmissible(s as AgentTaskState, 'stop'));
		assert.deepStrictEqual(admitted, ['starting', 'running', 'running/attached']);
	});

	test('cancel admitted from every non-terminal state', () => {
		const admitted = (LIFECYCLE_STATES as readonly string[]).filter((s) => controlAdmissible(s as AgentTaskState, 'cancel'));
		const terminal = new Set<string>(TERMINAL_AGENT_TASK_STATES);
		const nonTerminal = (LIFECYCLE_STATES as readonly string[]).filter((s) => !terminal.has(s));
		assert.deepStrictEqual(admitted, nonTerminal);
		assert.strictEqual(admitted.length, LIFECYCLE_STATES.length - TERMINAL_AGENT_TASK_STATES.length);
	});

	test('resume admitted only from stopped-shape states', () => {
		const admitted = (LIFECYCLE_STATES as readonly string[]).filter((s) => controlAdmissible(s as AgentTaskState, 'resume'));
		assert.deepStrictEqual(admitted, ['stopped', 'stopped/attached']);
	});

	test('terminal states admit no control verbs', () => {
		for (const s of TERMINAL_AGENT_TASK_STATES) {
			assert.deepStrictEqual(admissibleControlVerbs(s as AgentTaskState), []);
			for (const v of CONTROL_VERBS) {
				assert.ok(!controlAdmissible(s as AgentTaskState, v), `${v} must not be admissible from terminal ${s}`);
			}
		}
	});

	test('admissibleControlVerbs returns a defensive copy', () => {
		const a = admissibleControlVerbs('running');
		const b = admissibleControlVerbs('running');
		assert.deepStrictEqual(a, b);
		assert.notStrictEqual(a, CONTROL_ADMISSIBILITY['running']);
	});

	function req(verb: ControlVerb, overrides: Partial<ControlRequest> = {}): ControlRequest {
		const base = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			reason: 'operator-request',
			requestedAtIso: '2026-10-01T00:00:00.000Z',
		};
		switch (verb) {
			case 'pause': return { ...base, verb: 'pause', ...overrides } as PauseRequest;
			case 'stop': return { ...base, verb: 'stop', ...overrides } as StopRequest;
			case 'cancel': return { ...base, verb: 'cancel', ...overrides } as CancelRequest;
			case 'resume': return { ...base, verb: 'resume', ...overrides } as ResumeRequest;
		}
	}

	test('isWellFormedControlRequest: true for each well-formed verb request', () => {
		assert.ok(isWellFormedControlRequest(req('pause')));
		assert.ok(isWellFormedControlRequest(req('stop')));
		assert.ok(isWellFormedControlRequest(req('cancel')));
		assert.ok(isWellFormedControlRequest(req('resume')));
	});

	test('isWellFormedControlRequest: false on version mismatch, empty scope/task/reason/timestamp', () => {
		assert.ok(!isWellFormedControlRequest(req('pause', { contractVersion: '0.9.0' })));
		assert.ok(!isWellFormedControlRequest(req('pause', { scope: { workspaceId: '', tenantId: 't' } })));
		assert.ok(!isWellFormedControlRequest(req('pause', { taskId: '' })));
		assert.ok(!isWellFormedControlRequest(req('pause', { reason: '' })));
		assert.ok(!isWellFormedControlRequest(req('pause', { requestedAtIso: '' })));
	});

	test('minimal PauseRequest fixture compiles with verb literal pinned', () => {
		const pause: PauseRequest = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			reason: 'operator-request',
			requestedAtIso: '2026-10-01T00:00:00.000Z',
			verb: 'pause',
		};
		assert.strictEqual(pause.verb, 'pause');
	});
});
