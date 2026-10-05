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
	TERMINAL_DISPOSITIONS,
	type AgentDisposition,
	type AgentOutcome,
	type ArtifactHandoff,
	OUTCOME_FROM_TERMINAL_STATE,
	outcomeFromTerminalState,
	isTerminalDisposition,
	isTerminalOutcome,
} from '../../common/outcome.js';

type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent outcome contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
	});

	test('TERMINAL_AGENT_TASK_STATES is exactly destroyed/failed', () => {
		assert.deepStrictEqual([...TERMINAL_AGENT_TASK_STATES], ['destroyed', 'failed']);
	});

	test('OUTCOME_FROM_TERMINAL_STATE maps every terminal state to exactly one disposition (TOTAL)', () => {
		assert.deepStrictEqual(OUTCOME_FROM_TERMINAL_STATE, { destroyed: 'cancelled', failed: 'failed' });
		for (const s of TERMINAL_AGENT_TASK_STATES) {
			const d = OUTCOME_FROM_TERMINAL_STATE[s as (typeof TERMINAL_AGENT_TASK_STATES)[number]];
			assert.ok(d, `terminal ${s} must map to a disposition`);
			assert.ok((TERMINAL_DISPOSITIONS as readonly string[]).includes(d), `${s} -> ${d} not a terminal disposition`);
		}
		assert.strictEqual(Object.keys(OUTCOME_FROM_TERMINAL_STATE).length, TERMINAL_AGENT_TASK_STATES.length);
	});

	test('outcomeFromTerminalState is TOTAL: non-null for terminal, null for non-terminal, never throws', () => {
		for (const s of LIFECYCLE_STATES) {
			let result: AgentDisposition | null = 'sentinel' as AgentDisposition | null;
			assert.doesNotThrow(() => { result = outcomeFromTerminalState(s as AgentTaskState); });
			if ((TERMINAL_AGENT_TASK_STATES as readonly string[]).includes(s)) {
				assert.notStrictEqual(result, null, `terminal ${s} must yield a disposition`);
			} else {
				assert.strictEqual(result, null, `non-terminal ${s} must yield null`);
			}
		}
	});

	test('outcomeFromTerminalState: destroyed -> cancelled (fail-closed), failed -> failed', () => {
		assert.strictEqual(outcomeFromTerminalState('destroyed'), 'cancelled');
		assert.strictEqual(outcomeFromTerminalState('failed'), 'failed');
	});

	test('outcomeFromTerminalState: every non-terminal state yields null', () => {
		const terminal = new Set<string>(TERMINAL_AGENT_TASK_STATES);
		for (const s of LIFECYCLE_STATES) {
			if (!terminal.has(s)) {
				assert.strictEqual(outcomeFromTerminalState(s as AgentTaskState), null);
			}
		}
	});

	test('isTerminalDisposition: all four dispositions are terminal', () => {
		assert.ok(isTerminalDisposition('completed'));
		assert.ok(isTerminalDisposition('failed'));
		assert.ok(isTerminalDisposition('lost'));
		assert.ok(isTerminalDisposition('cancelled'));
	});

	test('isTerminalOutcome: true iff terminalTaskState is terminal', () => {
		const base: AgentOutcome = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			disposition: 'failed',
			terminalTaskState: 'failed',
			evidenceDigest: 'sha256:evid',
			artifacts: [],
		};
		assert.ok(isTerminalOutcome(base));
		assert.ok(isTerminalOutcome({ ...base, terminalTaskState: 'destroyed', disposition: 'cancelled' }));
		assert.ok(!isTerminalOutcome({ ...base, terminalTaskState: 'running' }));
		assert.ok(!isTerminalOutcome({ ...base, terminalTaskState: 'stopped' }));
	});

	test('minimal AgentOutcome fixture compiles and fields read back', () => {
		const artifact: ArtifactHandoff = { kind: 'changeset', digest: 'sha256:diff', byteSize: 1234 };
		const outcome: AgentOutcome = {
			scope: { workspaceId: 'ws-1', tenantId: 'tenant-1' },
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			disposition: 'cancelled',
			terminalTaskState: 'destroyed',
			evidenceDigest: null,
			artifacts: [artifact],
		};
		assert.strictEqual(outcome.disposition, 'cancelled');
		assert.strictEqual(outcome.terminalTaskState, 'destroyed');
		assert.strictEqual(outcome.artifacts.length, 1);
		assert.strictEqual(outcome.artifacts[0].byteSize, 1234);
		assert.ok(isTerminalOutcome(outcome));
		assert.strictEqual(outcomeFromTerminalState(outcome.terminalTaskState), 'cancelled');
	});
});
