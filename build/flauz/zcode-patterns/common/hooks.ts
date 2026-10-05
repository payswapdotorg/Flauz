/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * ZC-001 family 2: Hook event contracts. Versioned data contracts, constants, and
 * pure guards for typed session/prompt/tool/approval/post-tool/finalization hook
 * events and their wire envelope. Zero-dependency by law: this module imports nothing.
 *
 * DETERMINISM LAW: no `Math.random`, no `Date.now`, no `new Date()` inside this module.
 * Timestamps are plain ISO strings set only at persistence edges (occurredAtIso is the
 * ISO-string projection of the authority TaskEvent/SeamEventEnvelope epoch-ms stamps).
 *
 * SCOPING LAW: every persisted record carries `scope: ZcodeScope` and
 * `contractVersion: string`.
 *
 * PROJECTION LAW: this module is a REQUEST/READ-MODEL shape over existing authorities,
 * never a new authority. Hook events project the task/session/event semantics of
 * extensions/flauz-agent/src/types.ts (TaskEvent, SeamEventEnvelope); approval requests
 * route into the EXISTING approval authority (the stable HumanApproval contract
 * family). No hook bus, no scheduler, no permission broker may appear here: types,
 * constants, pure guards only.
 *
 * HOOK-EFFECT LAW (fail-closed typing): a hook effect may be `context-enrichment` or
 * `approval-request`. The HookEffect union admits exactly those two shapes, so a
 * bypass-granting effect (a permission grant, a policy override, a lease bypass) is
 * UNREPRESENTABLE in the type; the exported guard re-checks the law at boundaries.
 */

/**
 * Version of the ZC-001 pattern contract set; a record is current only when its
 * `contractVersion` matches exactly. Re-declared in every zcode-patterns contract
 * module because the zero-import law forbids a shared base module; tests pin all
 * declarations to this exact value.
 */
export const ZCODE_PATTERNS_CONTRACTS_VERSION = '1.0.0';

/**
 * Workspace/tenant scoping tuple attached to every persisted zcode-patterns record.
 */
export interface ZcodeScope {
	workspaceId: string;
	tenantId: string;
}

/**
 * The closed set of hook event kinds (ZC-003 pattern): session lifecycle, prompt
 * submission, pre-tool invocation, approval gates, post-tool outcomes, and run
 * finalization.
 */
export const HOOK_EVENT_KINDS = ['session', 'prompt', 'tool', 'approval', 'post-tool', 'finalization'] as const;
export type HookEventKind = (typeof HOOK_EVENT_KINDS)[number];

/**
 * Payload of a session-lifecycle hook.
 */
export interface SessionHookPayload {
	readonly kind: 'session';
	readonly phase: 'started' | 'ended';
}

/**
 * Payload of a prompt-submission hook.
 */
export interface PromptHookPayload {
	readonly kind: 'prompt';
	readonly promptId: string;
}

/**
 * Payload of a pre-tool-invocation hook.
 */
export interface ToolHookPayload {
	readonly kind: 'tool';
	readonly toolId: string;
}

/**
 * Payload of an approval-gate hook.
 */
export interface ApprovalHookPayload {
	readonly kind: 'approval';
	readonly requestId: string;
}

/**
 * Payload of a post-tool-outcome hook.
 */
export interface PostToolHookPayload {
	readonly kind: 'post-tool';
	readonly toolId: string;
	readonly outcome: 'ok' | 'failed';
}

/**
 * Payload of a run-finalization hook.
 */
export interface FinalizationHookPayload {
	readonly kind: 'finalization';
	readonly taskId: string;
}

/**
 * The kind-discriminated payload union. The `kind` field of the payload and the
 * `kind` field of the carrying event are correlated by the HookEvent union below,
 * making a mismatched (kind, payload) pair unrepresentable.
 */
export type HookEventPayload =
	| SessionHookPayload
	| PromptHookPayload
	| ToolHookPayload
	| ApprovalHookPayload
	| PostToolHookPayload
	| FinalizationHookPayload;

/**
 * One hook event record. The intersection correlates `kind` with the payload
 * discriminator, so (for example) a `kind: 'tool'` event carrying a prompt payload
 * is unrepresentable.
 */
export type HookEvent = {
	scope: ZcodeScope;
	contractVersion: string;
	eventId: string;
	sessionId: string;
	occurredAtIso: string;
} & (
	| { kind: 'session'; payload: SessionHookPayload }
	| { kind: 'prompt'; payload: PromptHookPayload }
	| { kind: 'tool'; payload: ToolHookPayload }
	| { kind: 'approval'; payload: ApprovalHookPayload }
	| { kind: 'post-tool'; payload: PostToolHookPayload }
	| { kind: 'finalization'; payload: FinalizationHookPayload }
);

/**
 * Schema identifier of the hook event wire envelope (the additive ZC-001 wire
 * shape; distinct from and subordinate to the authority seam envelopes).
 */
export const HOOK_EVENTS_SCHEMA_ID = 'flauz.hook-events/v1';

/**
 * The wire shape: one hook event traveling to hook handlers. Carries the schema id
 * for fail-closed boundary checks; the record itself carries the contract version.
 */
export interface HookEventEnvelope {
	readonly schemaId: typeof HOOK_EVENTS_SCHEMA_ID;
	readonly event: HookEvent;
}

/**
 * The closed set of legal hook effect kinds. Exactly two: hooks may enrich context
 * or request existing approval behavior. Anything else (a permission grant, a
 * policy override, a lease bypass) is outside the law.
 */
export const HOOK_EFFECT_KINDS = ['context-enrichment', 'approval-request'] as const;
export type HookEffectKind = (typeof HOOK_EFFECT_KINDS)[number];

/**
 * Effect: enrich the agent context with a note. Pure content; grants nothing.
 */
export interface ContextEnrichmentEffect {
	readonly kind: 'context-enrichment';
	readonly note: string;
}

/**
 * Effect: request that the EXISTING approval authority (the stable HumanApproval
 * contract family) surface decision `requestId`. The hook never decides; the
 * authority does.
 */
export interface ApprovalRequestEffect {
	readonly kind: 'approval-request';
	readonly requestId: string;
	readonly reason: string;
}

/**
 * The hook-effect law as a type: the union admits exactly context-enrichment and
 * approval-request, so a bypass-granting effect is unrepresentable.
 */
export type HookEffect = ContextEnrichmentEffect | ApprovalRequestEffect;

/**
 * Guard: true iff `value` is one of the closed HookEventKind set.
 */
export function isHookEventKind(value: unknown): value is HookEventKind {
	return typeof value === 'string' && (HOOK_EVENT_KINDS as readonly string[]).includes(value);
}

/**
 * Guard: true iff `value` is a structurally valid HookEvent (fail-closed: exact
 * scope/version/id fields, a legal kind, and a payload whose discriminator matches
 * the event kind and whose per-kind fields are well formed).
 */
export function isHookEvent(value: unknown): value is HookEvent {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const event = value as Record<string, unknown>;
	if (typeof event.scope !== 'object' || event.scope === null || Array.isArray(event.scope)) {
		return false;
	}
	const scope = event.scope as Record<string, unknown>;
	if (typeof scope.workspaceId !== 'string' || typeof scope.tenantId !== 'string') {
		return false;
	}
	if (typeof event.contractVersion !== 'string' || typeof event.eventId !== 'string') {
		return false;
	}
	if (typeof event.sessionId !== 'string' || typeof event.occurredAtIso !== 'string') {
		return false;
	}
	if (event.eventId === '' || event.sessionId === '' || event.occurredAtIso === '') {
		return false;
	}
	if (!isHookEventKind(event.kind)) {
		return false;
	}
	const payload = event.payload;
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		return false;
	}
	const p = payload as Record<string, unknown>;
	if (p.kind !== event.kind) {
		return false;
	}
	switch (event.kind) {
		case 'session':
			return p.phase === 'started' || p.phase === 'ended';
		case 'prompt':
			return typeof p.promptId === 'string' && p.promptId !== '';
		case 'tool':
			return typeof p.toolId === 'string' && p.toolId !== '';
		case 'approval':
			return typeof p.requestId === 'string' && p.requestId !== '';
		case 'post-tool':
			return (p.outcome === 'ok' || p.outcome === 'failed') && typeof p.toolId === 'string' && p.toolId !== '';
		case 'finalization':
			return typeof p.taskId === 'string' && p.taskId !== '';
	}
	return false;
}

/**
 * Guard: true iff `value` is a structurally valid HookEventEnvelope (fail-closed:
 * the exact schema id plus a valid inner event).
 */
export function isHookEventEnvelope(value: unknown): value is HookEventEnvelope {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const envelope = value as Record<string, unknown>;
	if (envelope.schemaId !== HOOK_EVENTS_SCHEMA_ID) {
		return false;
	}
	return isHookEvent(envelope.event);
}

/**
 * Guard: true iff `value` is one of the closed HookEffectKind set.
 */
export function isHookEffectKind(value: unknown): value is HookEffectKind {
	return typeof value === 'string' && (HOOK_EFFECT_KINDS as readonly string[]).includes(value);
}

/**
 * Guard: true iff `value` is a legal HookEffect (fail-closed). Rejects every
 * bypass-shaped effect (a permission grant, a policy override, a lease bypass)
 * because their kinds are not in the closed set.
 */
export function isHookEffect(value: unknown): value is HookEffect {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return false;
	}
	const effect = value as Record<string, unknown>;
	if (!isHookEffectKind(effect.kind)) {
		return false;
	}
	if (effect.kind === 'context-enrichment') {
		return typeof effect.note === 'string' && effect.note !== '';
	}
	if (effect.kind === 'approval-request') {
		return typeof effect.requestId === 'string' && effect.requestId !== '' && typeof effect.reason === 'string' && effect.reason !== '';
	}
	return false;
}

/**
 * Guard: true iff the record pins the exact current ZCODE_PATTERNS_CONTRACTS_VERSION.
 */
export function isVersionedHookEvent(record: { contractVersion?: string }): boolean {
	return record.contractVersion === ZCODE_PATTERNS_CONTRACTS_VERSION;
}
