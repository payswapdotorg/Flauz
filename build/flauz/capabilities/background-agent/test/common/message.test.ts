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
	PRE_LAUNCH_AGENT_TASK_STATES,
	MESSAGE_DELIVERABLE_STATES,
	type AgentMessageDirection,
	type AgentMessage,
	canDeliverMessage,
} from '../../common/message.js';

type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent message contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
	});

	test('MESSAGE_DELIVERABLE_STATES is the authority minus terminal minus pre-launch', () => {
		const terminal = new Set<string>(TERMINAL_AGENT_TASK_STATES);
		const preLaunch = new Set<string>(PRE_LAUNCH_AGENT_TASK_STATES);
		const expected = (LIFECYCLE_STATES as readonly string[]).filter((s) => !terminal.has(s) && !preLaunch.has(s));
		assert.deepStrictEqual([...MESSAGE_DELIVERABLE_STATES], expected);
		assert.deepStrictEqual([...MESSAGE_DELIVERABLE_STATES], [
			'created', 'starting', 'running', 'stopping', 'stopped', 'running/attached', 'stopped/attached',
		]);
	});

	test('canDeliverMessage: false for terminal states, both directions', () => {
		for (const s of TERMINAL_AGENT_TASK_STATES) {
			assert.ok(!canDeliverMessage(s as AgentTaskState, 'to-agent'), `to-agent ${s} must not deliver`);
			assert.ok(!canDeliverMessage(s as AgentTaskState, 'from-agent'), `from-agent ${s} must not deliver`);
		}
	});

	test('canDeliverMessage: false for pre-launch states, both directions', () => {
		for (const s of PRE_LAUNCH_AGENT_TASK_STATES) {
			assert.ok(!canDeliverMessage(s as AgentTaskState, 'to-agent'), `to-agent ${s} must not deliver`);
			assert.ok(!canDeliverMessage(s as AgentTaskState, 'from-agent'), `from-agent ${s} must not deliver`);
		}
	});

	test('canDeliverMessage: true for every deliverable state, both directions', () => {
		for (const s of MESSAGE_DELIVERABLE_STATES) {
			assert.ok(canDeliverMessage(s as AgentTaskState, 'to-agent'), `to-agent ${s} must deliver`);
			assert.ok(canDeliverMessage(s as AgentTaskState, 'from-agent'), `from-agent ${s} must deliver`);
		}
	});

	test('canDeliverMessage is TOTAL over the authority states: verdict matches the deliverable set for every state', () => {
		for (const s of LIFECYCLE_STATES) {
			const expected = (MESSAGE_DELIVERABLE_STATES as readonly string[]).includes(s);
			assert.strictEqual(canDeliverMessage(s as AgentTaskState, 'to-agent'), expected, `to-agent verdict mismatch for ${s}`);
			assert.strictEqual(canDeliverMessage(s as AgentTaskState, 'from-agent'), expected, `from-agent verdict mismatch for ${s}`);
		}
	});

	test('canDeliverMessage: the two directions admit the same set (law currently uniform)', () => {
		const toAgent = (LIFECYCLE_STATES as readonly string[]).filter((s) => canDeliverMessage(s as AgentTaskState, 'to-agent'));
		const fromAgent = (LIFECYCLE_STATES as readonly string[]).filter((s) => canDeliverMessage(s as AgentTaskState, 'from-agent'));
		assert.deepStrictEqual(toAgent, fromAgent);
		assert.deepStrictEqual(toAgent, [...MESSAGE_DELIVERABLE_STATES]);
	});

	test('minimal AgentMessage fixture compiles and fields read back', () => {
		const msg: AgentMessage = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			direction: 'to-agent' as AgentMessageDirection,
			sentAtIso: '2026-10-01T00:00:00.000Z',
			digest: 'sha256:msg-1',
		};
		assert.strictEqual(msg.direction, 'to-agent');
		assert.strictEqual(msg.digest, 'sha256:msg-1');
		assert.strictEqual(msg.contractVersion, BACKGROUND_AGENT_UX_VERSION);
	});
});
