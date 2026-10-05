/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	HOOK_EFFECT_KINDS,
	HOOK_EVENT_KINDS,
	HOOK_EVENTS_SCHEMA_ID,
	ZCODE_PATTERNS_CONTRACTS_VERSION,
	isHookEffect,
	isHookEffectKind,
	isHookEvent,
	isHookEventEnvelope,
	isHookEventKind,
	isVersionedHookEvent,
	type HookEffect,
	type HookEvent,
	type HookEventEnvelope,
	type HookEventKind,
	type ZcodeScope,
} from '../../common/hooks.js';

const SCOPE: ZcodeScope = { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' };

/** Untyped factory for boundary-guard inputs only (spread keeps it unknown-shaped). */
function rawEvent(): Record<string, unknown> {
	return {
		scope: { workspaceId: 'ws-fixtures', tenantId: 'tenant-fixtures' },
		contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION,
		eventId: 'hook-0001',
		sessionId: 'session-0001',
		occurredAtIso: '2026-10-04T00:00:00.000Z',
	};
}

suite('hooks', () => {

	test('ZCODE_PATTERNS_CONTRACTS_VERSION equals 1.0.0', () => {
		assert.strictEqual(ZCODE_PATTERNS_CONTRACTS_VERSION, '1.0.0');
	});

	test('HOOK_EVENT_KINDS pins the exact closed kind set', () => {
		assert.deepStrictEqual(HOOK_EVENT_KINDS, ['session', 'prompt', 'tool', 'approval', 'post-tool', 'finalization']);
	});

	test('one well-formed HookEvent fixture per kind compiles and fields read back', () => {
		const events: HookEvent[] = [
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0001', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:00:00.000Z', kind: 'session', payload: { kind: 'session', phase: 'started' } },
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0002', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:01:00.000Z', kind: 'prompt', payload: { kind: 'prompt', promptId: 'prompt-0001' } },
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0003', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:02:00.000Z', kind: 'tool', payload: { kind: 'tool', toolId: 'tool-read-file' } },
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0004', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:03:00.000Z', kind: 'approval', payload: { kind: 'approval', requestId: 'approval-0001' } },
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0005', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:04:00.000Z', kind: 'post-tool', payload: { kind: 'post-tool', toolId: 'tool-read-file', outcome: 'ok' } },
			{ scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0006', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:05:00.000Z', kind: 'finalization', payload: { kind: 'finalization', taskId: 'T-001' } },
		];
		assert.strictEqual(events.length, (HOOK_EVENT_KINDS as readonly string[]).length);
		for (const event of events) {
			assert.strictEqual(event.scope.workspaceId, 'ws-fixtures');
			assert.strictEqual(event.scope.tenantId, 'tenant-fixtures');
			assert.strictEqual(event.contractVersion, ZCODE_PATTERNS_CONTRACTS_VERSION);
			assert.strictEqual(event.sessionId, 'session-0001');
			assert.ok(event.occurredAtIso.length > 0);
			assert.strictEqual(event.payload.kind, event.kind);
			assert.ok(isHookEvent(event));
			assert.ok(isVersionedHookEvent(event));
		}
		const kind: HookEventKind = events[0].kind;
		assert.strictEqual(kind, 'session');
	});

	test('isHookEventKind: true for every closed kind, false for anything else', () => {
		for (const kind of HOOK_EVENT_KINDS) {
			assert.ok(isHookEventKind(kind));
		}
		assert.ok(!isHookEventKind('permission-grant'));
		assert.ok(!isHookEventKind(''));
		assert.ok(!isHookEventKind(42));
		assert.ok(!isHookEventKind(null));
	});

	test('HOOK_EVENTS_SCHEMA_ID and a minimal HookEventEnvelope fixture read back', () => {
		assert.strictEqual(HOOK_EVENTS_SCHEMA_ID, 'flauz.hook-events/v1');
		const envelope: HookEventEnvelope = {
			schemaId: HOOK_EVENTS_SCHEMA_ID,
			event: { scope: SCOPE, contractVersion: ZCODE_PATTERNS_CONTRACTS_VERSION, eventId: 'hook-0002', sessionId: 'session-0001', occurredAtIso: '2026-10-04T00:01:00.000Z', kind: 'prompt', payload: { kind: 'prompt', promptId: 'prompt-0001' } },
		};
		assert.strictEqual(envelope.schemaId, 'flauz.hook-events/v1');
		assert.strictEqual(envelope.event.kind, 'prompt');
		assert.ok(isHookEventEnvelope(envelope));
	});

	test('isHookEventEnvelope: false for wrong schema id, non-object, or invalid inner event', () => {
		assert.ok(!isHookEventEnvelope({ schemaId: 'flauz.hook-events/v0', event: rawEvent() }));
		assert.ok(!isHookEventEnvelope(null));
		assert.ok(!isHookEventEnvelope('flauz.hook-events/v1'));
		assert.ok(!isHookEventEnvelope({ schemaId: HOOK_EVENTS_SCHEMA_ID, event: 'not-an-event' }));
	});

	test('isHookEvent is fail-closed: rejects mismatched kind/payload pairs', () => {
		const mismatched = { ...rawEvent(), kind: 'tool', payload: { kind: 'prompt', promptId: 'prompt-0001' } };
		assert.ok(!isHookEvent(mismatched));
		const missingPayload = { ...rawEvent(), kind: 'tool' };
		assert.ok(!isHookEvent(missingPayload));
	});

	test('isHookEvent is fail-closed: rejects malformed records (empty ids, bad scope, bad payload fields)', () => {
		assert.ok(!isHookEvent(null));
		assert.ok(!isHookEvent('nope'));
		assert.ok(!isHookEvent({ ...rawEvent(), eventId: '' }));
		assert.ok(!isHookEvent({ ...rawEvent(), sessionId: '' }));
		assert.ok(!isHookEvent({ ...rawEvent(), occurredAtIso: '' }));
		assert.ok(!isHookEvent({ ...rawEvent(), scope: null }));
		assert.ok(!isHookEvent({ ...rawEvent(), scope: { workspaceId: 1, tenantId: 'tenant-fixtures' } }));
		assert.ok(!isHookEvent({ ...rawEvent(), kind: 'session', payload: { kind: 'session', phase: 'nope' } }));
		assert.ok(!isHookEvent({ ...rawEvent(), kind: 'prompt', payload: { kind: 'prompt', promptId: '' } }));
		assert.ok(!isHookEvent({ ...rawEvent(), kind: 'post-tool', payload: { kind: 'post-tool', toolId: 'tool-read-file', outcome: 'exploded' } }));
	});

	test('HOOK-EFFECT LAW: the union admits exactly context-enrichment and approval-request', () => {
		assert.deepStrictEqual(HOOK_EFFECT_KINDS, ['context-enrichment', 'approval-request']);
	});

	test('isHookEffect: true for both legal effect shapes', () => {
		const enrichment: HookEffect = { kind: 'context-enrichment', note: 'prefer tabs in this repository' };
		const approval: HookEffect = { kind: 'approval-request', requestId: 'approval-0001', reason: 'write outside the workspace root' };
		assert.ok(isHookEffect(enrichment));
		assert.ok(isHookEffect(approval));
	});

	test('HOOK-EFFECT LAW (fail-closed): bypass-granting effects are rejected by the guard', () => {
		assert.ok(!isHookEffect({ kind: 'permission-grant', permission: 'fs.write' }));
		assert.ok(!isHookEffect({ kind: 'policy-override', policy: 'allow-all' }));
		assert.ok(!isHookEffect({ kind: 'lease-bypass', leaseId: 'lease-0001' }));
		assert.ok(!isHookEffect({ kind: 'approval-bypass', requestId: 'approval-0001' }));
	});

	test('isHookEffect: false for malformed legal kinds (empty note, empty requestId, missing reason)', () => {
		assert.ok(!isHookEffect(null));
		assert.ok(!isHookEffect('context-enrichment'));
		assert.ok(!isHookEffect({ kind: 'context-enrichment', note: '' }));
		assert.ok(!isHookEffect({ kind: 'context-enrichment' }));
		assert.ok(!isHookEffect({ kind: 'approval-request', requestId: '', reason: 'why' }));
		assert.ok(!isHookEffect({ kind: 'approval-request', requestId: 'approval-0001' }));
	});

	test('isHookEffectKind: true for the two legal kinds, false for bypass-shaped kinds', () => {
		assert.ok(isHookEffectKind('context-enrichment'));
		assert.ok(isHookEffectKind('approval-request'));
		assert.ok(!isHookEffectKind('permission-grant'));
		assert.ok(!isHookEffectKind('policy-override'));
	});
});
