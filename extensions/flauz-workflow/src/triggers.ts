/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Wave 4 Lane K, M4 - AHP automation-trigger interop surface (v0: mapping only).
 *
 * C-40 (wave1/c matrix, row 'AHP automation triggers'): the AHP automation
 * channels are host-owned surfaces; Flauz consumes them from the workflow
 * extension. This module is the v0 of that consumption: it maps a validated
 * flauz.workflows/v1 fragment onto the AHP automation definition grammar and
 * drafts the two emission messages (create + manual run). There is NO live
 * AHP dependency - nothing here imports or spawns the agent host; the host
 * evaluates every schedule (tree rule: 'Clients never run a fallback
 * scheduler for a host-owned definition').
 *
 * Tree surfaces this maps onto (byte-stable at Wave-4 clone time):
 *   - src/vs/platform/agentHost/common/state/protocol/channels-automation/state.ts
 *     AutomationDefinition {title, message, session, enabled, triggers, _meta?},
 *     AutomationScheduleTrigger {id, kind 'schedule', schedule {expression,
 *     timeZone}, misfirePolicy?}, the five-field cron grammar documented on
 *     AutomationSchedule, AutomationMisfirePolicy {skip | runOnce};
 *   - .../channels-automation/actions.ts AutomationCreateRequestedAction
 *     {type 'automation/createRequested', resource, definition} - the create
 *     emission (host validates, normalizes, publishes automation/set);
 *   - .../channels-automation/commands.ts RunAutomationParams {channel
 *     'ahp-automations://', automation, requestId} - the manual-run emission
 *     (durable client idempotency key: same key + automation = same run URI);
 *   - .../channels-automation-run/state.ts AutomationRunStatus {pending,
 *     running, completed, failed} + origins {manual, trigger} - the result
 *     surface the orchestrator watches to record runs (v0: watched, not
 *     consumed; the flauz.tasks/v0 machine records outcomes).
 *
 * The v0 structural projection is DELIBERATELY minimal: every draft type below
 * documents which tree type it is a subset of. Widening follows demand; the
 * tree doc rules (five-field cron, no seconds/macros/Quartz, both-day
 * restricted = Unix OR semantics) are enforced at authoring time by
 * validateCronExpression so a malformed schedule can never leave Flauz.
 *
 * EMISSION POINTS (v0 spec; the F-side wiring rides later waves):
 *   1. CREATE  - after a workflow save, the orchestrator dispatches the
 *      automationCreateRequested draft on the ahp-automations:// channel with
 *      a client-chosen ahp-automation:<id> resource; the _meta binding
 *      (below) is what ties the resulting automation back to the fragment.
 *   2. RUN     - a manual re-run requests RunAutomationParams; the
 *      requestId is the deterministic workflowRunRequestId key, so a retry
 *      after a transport loss returns the ORIGINAL run instead of spawning a
 *      duplicate.
 *   3. RECORD  - when the run channel reports a terminal AutomationRunStatus,
 *      the orchestrator appends the outcome to the fragment history via
 *      WorkflowService.save (already the M1 surface).
 */

import type { WorkflowFragment } from './envelope.ts';

// ---------------------------------------------------------------------------
// The AHP five-field cron grammar (authoring-time validation; host evaluates)
// ---------------------------------------------------------------------------

/**
 * Field order of the AHP cron expression (tree: AutomationSchedule doc). The
 * day-of-week names are ordered MON..SUN so that (index + 1) % 7 yields the
 * numeric bound (SUN wraps to 0); 7 also means Sunday as a numeric bound.
 */
const CRON_FIELDS: ReadonlyArray<{ name: string; min: number; max: number; names?: readonly string[] }> = Object.freeze([
	Object.freeze({ name: 'minute', min: 0, max: 59 }),
	Object.freeze({ name: 'hour', min: 0, max: 23 }),
	Object.freeze({ name: 'day of month', min: 1, max: 31 }),
	Object.freeze({ name: 'month', min: 1, max: 12, names: Object.freeze(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']) }),
	Object.freeze({ name: 'day of week', min: 0, max: 7, names: Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) }),
] as const);

export interface CronValidation {
	readonly ok: boolean;
	readonly error?: string;
	/** Per-field normalized token lists (present only when ok). */
	readonly fields?: readonly (readonly string[])[];
}

function parseCronToken(token: string, field: { name: string; min: number; max: number; names?: readonly string[] }): string[] | Error {
	// '*' stands alone or carries a step ('*/15'); it is never a list element
	// or a range bound.
	if (token.startsWith('*')) {
		const rest = token.slice(1);
		if (rest.length === 0) {
			return ['*'];
		}
		if (rest.startsWith('/') && /^[1-9][0-9]*$/.test(rest.slice(1))) {
			return [token];
		}
		return new Error(`field ${field.name}: '*' stands alone or as '*/<step>' (got '${token}')`);
	}
	// A step is only valid applied to a range ('1-30/2').
	const stepSplit = token.split('/');
	if (stepSplit.length > 2) {
		return new Error(`field ${field.name}: at most one step ('/') is allowed`);
	}
	const step = stepSplit[1];
	if (step !== undefined && !/^[1-9][0-9]*$/.test(step)) {
		return new Error(`field ${field.name}: step must be a positive integer (got '${step}')`);
	}
	const values: string[] = [];
	for (const part of stepSplit[0]?.split(',') ?? []) {
		if (part.length === 0) {
			return new Error(`field ${field.name}: empty list element`);
		}
		const range = part.split('-');
		if (range.length > 2) {
			return new Error(`field ${field.name}: at most one range dash is allowed (got '${part}')`);
		}
		const bounds = range.map((bound) => resolveCronBound(bound, field));
		for (const bound of bounds) {
			if (bound instanceof Error) {
				return bound;
			}
		}
		if (range.length === 2 && (bounds[0] as number) > (bounds[1] as number)) {
			return new Error(`field ${field.name}: range start must not exceed its end (got '${part}')`);
		}
		if (step !== undefined && range.length !== 2) {
			return new Error(`field ${field.name}: a step may only be applied to '*' or a range (got '${token}')`);
		}
		values.push(part);
	}
	return values;
}

function resolveCronBound(bound: string, field: { name: string; min: number; max: number; names?: readonly string[] }): number | Error {
	if (field.names !== undefined) {
		const index = field.names.indexOf(bound.toUpperCase());
		if (index >= 0) {
			// Month names map to 1-12; day names map to 0-6 (MON=1 .. SUN=0);
			// numeric 7 also means Sunday and is accepted below.
			return field.name === 'month' ? index + 1 : (index + 1) % 7;
		}
	}
	if (!/^[0-9]+$/.test(bound)) {
		return new Error(`field ${field.name}: '${bound}' is not a value, range, '*', or an ASCII ${field.name} name`);
	}
	const numeric = Number(bound);
	if (numeric < field.min || numeric > field.max) {
		return new Error(`field ${field.name}: value ${bound} is out of range ${field.min}-${field.max}`);
	}
	return numeric;
}

/**
 * Strict authoring-time validation of an AHP cron expression: exactly five
 * whitespace-separated fields; each accepts '*', single values, inclusive
 * ranges, comma lists, and steps on '*' or ranges; month/day-of-week accept
 * their ASCII names (case-insensitive); day-of-week 0 and 7 both mean Sunday;
 * seconds, years, macros ('@daily'), and Quartz extensions ('?', 'L', 'W',
 * '#') are rejected. Mirrors the tree grammar documented on
 * AutomationSchedule (channels-automation/state.ts).
 */
export function validateCronExpression(expression: string): CronValidation {
	if (typeof expression !== 'string' || expression.length === 0) {
		return { ok: false, error: 'cron expression must be a non-empty string' };
	}
	if (expression.includes('@')) {
		return { ok: false, error: "cron expression must not use macros such as '@daily' (AHP supports none)" };
	}
	for (const quartz of ['?', 'L', 'W', '#'] as const) {
		if (expression.includes(quartz)) {
			return { ok: false, error: `cron expression must not use the Quartz extension '${quartz}'` };
		}
	}
	const rawFields = expression.trim().split(/\s+/);
	if (rawFields.length !== 5) {
		return { ok: false, error: `cron expression must have exactly 5 fields (minute hour day-of-month month day-of-week; got ${String(rawFields.length)})` };
	}
	const fields: string[][] = [];
	for (const [index, raw] of rawFields.entries()) {
		const field = CRON_FIELDS[index];
		const parsed = parseCronToken(raw, field);
		if (parsed instanceof Error) {
			return { ok: false, error: parsed.message };
		}
		fields.push(parsed);
	}
	return { ok: true, fields };
}

export function isCronExpression(expression: string): boolean {
	return validateCronExpression(expression).ok;
}

// ---------------------------------------------------------------------------
// Fragment -> AHP automation definition (the v0 structural projection)
// ---------------------------------------------------------------------------

/** Tree: AutomationMisfirePolicy (channels-automation/state.ts). */
export type MisfirePolicy = 'skip' | 'runOnce';

/** Tree: AutomationScheduleTrigger (subset: the whole v0 trigger surface). */
export interface ScheduleTriggerDraft {
	readonly id: string;
	readonly kind: 'schedule';
	readonly schedule: {
		readonly expression: string;
		readonly timeZone: string;
	};
	readonly misfirePolicy?: MisfirePolicy;
}

/**
 * Tree: AutomationSessionTemplate (subset). The fragment's WorkflowModel maps
 * to provider + a ModelSelection by id; workingDirectories/config stay
 * host-default in v0.
 */
export interface SessionTemplateDraft {
	readonly provider: string;
	readonly model: {
		readonly id: string;
	};
}

/**
 * The _meta binding that ties a host-created automation back to its workflow
 * fragment. Tree rule: '_meta is opaque to the host; clients MUST preserve
 * unknown entries' - so Flauz owns this key.
 */
export interface WorkflowAutomationBinding {
	readonly 'flauz.workflow': {
		readonly $schema: 'flauz.workflows/v1';
		readonly id: string;
		readonly rerun: {
			readonly approvals: 'replay' | 'ask';
		};
	};
}

/** Tree: AutomationDefinition (v0 subset; message/session projected minimally). */
export interface AutomationDefinitionDraft {
	readonly title: string;
	readonly message: {
		/** Tree rule: the definition message origin kind MUST be 'automation'. */
		readonly origin: 'automation';
		readonly text: string;
	};
	readonly session: SessionTemplateDraft;
	readonly enabled: boolean;
	readonly triggers: readonly ScheduleTriggerDraft[];
	readonly _meta: WorkflowAutomationBinding;
}

export interface AutomationFromFragmentOptions {
	/** Schedule triggers to attach (every expression is validated). */
	readonly schedules: ReadonlyArray<{
		readonly id: string;
		readonly expression: string;
		readonly timeZone: string;
		readonly misfirePolicy?: MisfirePolicy;
	}>;
	/** Whether automatic triggers may create runs (manual runs stay available). Default true. */
	readonly enabled?: boolean;
}

/**
 * Maps a validated workflow fragment onto an AHP automation definition draft.
 * The initial message text is the fragment's plan prompt (what a run session
 * receives); the session template carries the fragment's model attribution;
 * _meta binds the automation to the fragment for the F-side runner.
 */
export function automationFromFragment(fragment: WorkflowFragment, options: AutomationFromFragmentOptions): AutomationDefinitionDraft {
	if (!Array.isArray(options.schedules)) {
		throw new Error('flauz.triggers: schedules must be an array');
	}
	const seen = new Set<string>();
	const triggers: ScheduleTriggerDraft[] = [];
	for (const schedule of options.schedules) {
		if (typeof schedule.id !== 'string' || schedule.id.length === 0) {
			throw new Error('flauz.triggers: every schedule trigger needs a non-empty id (stable within the definition)');
		}
		if (seen.has(schedule.id)) {
			throw new Error(`flauz.triggers: duplicate schedule trigger id '${schedule.id}' (ids must be unique within the definition)`);
		}
		seen.add(schedule.id);
		if (typeof schedule.timeZone !== 'string' || schedule.timeZone.length === 0) {
			throw new Error(`flauz.triggers: schedule '${schedule.id}' needs a non-empty IANA time zone id (e.g. 'UTC')`);
		}
		const cron = validateCronExpression(schedule.expression);
		if (!cron.ok) {
			throw new Error(`flauz.triggers: schedule '${schedule.id}' has an invalid AHP cron expression: ${cron.error}`);
		}
		triggers.push(schedule.misfirePolicy === undefined
			? { id: schedule.id, kind: 'schedule', schedule: { expression: schedule.expression, timeZone: schedule.timeZone } }
			: { id: schedule.id, kind: 'schedule', schedule: { expression: schedule.expression, timeZone: schedule.timeZone }, misfirePolicy: schedule.misfirePolicy });
	}
	return {
		title: `${fragment.id}: ${fragment.title}`,
		message: { origin: 'automation', text: fragment.plan.prompt },
		session: { provider: fragment.model.provider, model: { id: fragment.model.model } },
		enabled: options.enabled !== false,
		triggers,
		_meta: {
			'flauz.workflow': {
				$schema: 'flauz.workflows/v1',
				id: fragment.id,
				rerun: { approvals: fragment.rerun.approvals },
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Emission drafts (create + manual run)
// ---------------------------------------------------------------------------

/**
 * Tree: AutomationCreateRequestedAction. Dispatched on the ahp-automations://
 * channel after a workflow save; the host validates, persists, and publishes
 * the authoritative entry via automation/set.
 */
export function automationCreateAction(resource: string, definition: AutomationDefinitionDraft): { type: 'automation/createRequested'; resource: string; definition: AutomationDefinitionDraft } {
	if (!resource.startsWith('ahp-automation:')) {
		throw new Error(`flauz.triggers: automation resource must use the ahp-automation: scheme (got '${resource}')`);
	}
	return { type: 'automation/createRequested', resource, definition };
}

/**
 * Deterministic RunAutomationParams requestId for a manual fragment re-run:
 * the same fragment + attempt always produces the same key, so a transport
 * retry returns the original run instead of creating a duplicate (tree rule:
 * 'Retrying with the same key and automation MUST return the original run
 * URI'). The attempt counter is owned by the caller (the orchestrator bumps
 * it only after a CONFIRMED terminal outcome, not after a transport error).
 */
export function workflowRunRequestId(fragmentId: string, attempt: number): string {
	if (!/^[Ww]-\d{3,}$/.test(fragmentId)) {
		throw new Error(`flauz.triggers: fragment id must match W-NNN+ (got '${fragmentId}')`);
	}
	if (!Number.isSafeInteger(attempt) || attempt < 1) {
		throw new Error(`flauz.triggers: attempt must be a positive integer (got ${String(attempt)})`);
	}
	return `flauz.workflow/${fragmentId}/run/${String(attempt)}`;
}

/**
 * Tree: RunAutomationParams. The manual-run emission for a fragment-bound
 * automation; the returned resource (RunAutomationResult) is the run channel
 * to watch for the terminal AutomationRunStatus.
 */
export function runAutomationRequest(automation: string, requestId: string): { channel: 'ahp-automations://'; automation: string; requestId: string } {
	if (!automation.startsWith('ahp-automation:')) {
		throw new Error(`flauz.triggers: automation must be an ahp-automation: URI (got '${automation}')`);
	}
	if (typeof requestId !== 'string' || requestId.length === 0) {
		throw new Error('flauz.triggers: requestId must be a non-empty string (use workflowRunRequestId for fragment re-runs)');
	}
	return { channel: 'ahp-automations://', automation, requestId };
}
