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
	TIMELINE_DIGEST_MAX,
	type CapabilityScope,
	type AgentInspectView,
	type InspectTaskRecord,
	type AgentTimelineDigestEntry,
	projectInspectView,
	inspectViewsEqual,
} from '../../common/inspect.js';

type _DupExtendsAuth = AgentTaskState extends LifecycleState ? true : false;
type _AuthExtendsDup = LifecycleState extends AgentTaskState ? true : false;
const _pinDupExtendsAuth: _DupExtendsAuth = true;
const _pinAuthExtendsDup: _AuthExtendsDup = true;
void _pinDupExtendsAuth;
void _pinAuthExtendsDup;

suite('background-agent inspect contracts', () => {

	test('BACKGROUND_AGENT_UX_VERSION is 1.0.0', () => {
		assert.strictEqual(BACKGROUND_AGENT_UX_VERSION, '1.0.0');
	});

	test('AGENT_TASK_STATES pins the authority LIFECYCLE_STATES (runtime equality + type pin)', () => {
		assert.deepStrictEqual([...AGENT_TASK_STATES], [...LIFECYCLE_STATES]);
	});

	test('TIMELINE_DIGEST_MAX bounds the digest', () => {
		assert.strictEqual(TIMELINE_DIGEST_MAX, 10);
	});

	const scope: CapabilityScope = { workspaceId: 'ws-1', tenantId: 'tenant-1' };

	function entry(i: number): AgentTimelineDigestEntry {
		return { atIso: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`, kind: 'journal', digest: `sha256:${i}` };
	}

	function record(overrides: Partial<InspectTaskRecord> = {}): InspectTaskRecord {
		return {
			scope,
			taskId: 'task-1',
			currentState: 'running',
			lastEvidenceDigest: 'sha256:evid-1',
			leaseRemainingMs: 30000,
			timeline: [entry(0)],
			...overrides,
		};
	}

	test('projectInspectView: projects a minimal record with contractVersion', () => {
		const view = projectInspectView(record());
		assert.strictEqual(view.scope.workspaceId, 'ws-1');
		assert.strictEqual(view.contractVersion, BACKGROUND_AGENT_UX_VERSION);
		assert.strictEqual(view.taskId, 'task-1');
		assert.strictEqual(view.currentState, 'running');
		assert.strictEqual(view.lastEvidenceDigest, 'sha256:evid-1');
		assert.strictEqual(view.leaseRemaining, 30000);
		assert.strictEqual(view.timelineDigest.length, 1);
	});

	test('projectInspectView: bounds timeline to the last TIMELINE_DIGEST_MAX entries', () => {
		const long = record({ timeline: Array.from({ length: 12 }, (_, i) => entry(i)) });
		const view = projectInspectView(long);
		assert.strictEqual(view.timelineDigest.length, TIMELINE_DIGEST_MAX);
		assert.strictEqual(view.timelineDigest[0].digest, 'sha256:2');
		assert.strictEqual(view.timelineDigest[view.timelineDigest.length - 1].digest, 'sha256:11');
	});

	test('projectInspectView: empty timeline stays empty', () => {
		const view = projectInspectView(record({ timeline: [] }));
		assert.strictEqual(view.timelineDigest.length, 0);
	});

	test('projectInspectView: clamps negative / non-finite leaseRemaining to 0', () => {
		assert.strictEqual(projectInspectView(record({ leaseRemainingMs: -5 })).leaseRemaining, 0);
		assert.strictEqual(projectInspectView(record({ leaseRemainingMs: NaN })).leaseRemaining, 0);
		assert.strictEqual(projectInspectView(record({ leaseRemainingMs: Number.POSITIVE_INFINITY })).leaseRemaining, 0);
	});

	test('projectInspectView: null lastEvidenceDigest passes through', () => {
		const view = projectInspectView(record({ lastEvidenceDigest: null }));
		assert.strictEqual(view.lastEvidenceDigest, null);
	});

	test('inspectViewsEqual: true for identical views', () => {
		const a = projectInspectView(record());
		const b = projectInspectView(record());
		assert.ok(inspectViewsEqual(a, b));
		assert.ok(inspectViewsEqual(a, a));
	});

	test('inspectViewsEqual: false on any differing field', () => {
		const base = projectInspectView(record());
		assert.ok(!inspectViewsEqual(base, { ...base, taskId: 'task-2' }));
		assert.ok(!inspectViewsEqual(base, { ...base, currentState: 'stopped' }));
		assert.ok(!inspectViewsEqual(base, { ...base, lastEvidenceDigest: 'sha256:other' }));
		assert.ok(!inspectViewsEqual(base, { ...base, leaseRemaining: 9999 }));
		assert.ok(!inspectViewsEqual(base, { ...base, scope: { workspaceId: 'ws-2', tenantId: 'tenant-1' } }));
		assert.ok(!inspectViewsEqual(base, { ...base, contractVersion: '0.9.0' }));
	});

	test('inspectViewsEqual: false on differing timeline length or entry', () => {
		const base = projectInspectView(record());
		const more = projectInspectView(record({ timeline: [entry(0), entry(1)] }));
		assert.ok(!inspectViewsEqual(base, more));
		const diffEntry = projectInspectView(record({ timeline: [{ atIso: '2026-10-01T00:00:00.000Z', kind: 'journal', digest: 'sha256:other' }] }));
		assert.ok(!inspectViewsEqual(base, diffEntry));
	});

	test('minimal AgentInspectView fixture compiles and fields read back', () => {
		const view: AgentInspectView = {
			scope,
			contractVersion: BACKGROUND_AGENT_UX_VERSION,
			taskId: 'task-1',
			currentState: 'running/attached',
			lastEvidenceDigest: null,
			leaseRemaining: 0,
			timelineDigest: [],
		};
		assert.strictEqual(view.currentState, 'running/attached');
		assert.strictEqual(view.leaseRemaining, 0);
		assert.ok(inspectViewsEqual(view, view));
	});
});
