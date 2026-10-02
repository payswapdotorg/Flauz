/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The observers (A-PROD-004-W4) -- the local-real collection surface.
 *
 * Each observer reads a REAL durable-state surface produced by a prior
 * wave's extension (contract-duplicated parsers, the DL-32 law) and derives
 * OBSERVATION EVENTS from it: closed-vocabulary facts only -- kind, surface,
 * outcome, duration bucket, taxonomy error-code, ids. Free-form fields on
 * the source surfaces (explanations, messages, notes, outputs, labels) are
 * NEVER read into an event: they are the contents class.
 *
 * Observed surfaces:
 *   - `.flauz/models/routing-decisions.jsonl` (flauz-models) -- the
 *     per-provider-lane call outcomes (ok / no-candidate);
 *   - `.flauz/orchestration/journal.jsonl` (flauz-agent core) -- the
 *     provider-retry failure rows (the DL-35 typed codes) + the step
 *     start/succeed/fail transitions (the step outcomes WITH durations,
 *     derived from the row timestamps);
 *   - `.flauz/environments.json` (flauz-environments) -- the per-environment
 *     validation outcomes (valid / disabled / invalid);
 *   - `.flauz/workflows/W-NNN.json` (flauz-workflow) -- the per-workflow
 *     step outcomes (ok / failed).
 *
 * Unparseable surfaces degrade honestly: the surface's name joins the pass's
 * `unparseableSurfaces` list (names only -- metadata), no events are faked.
 */

import {
        ENVIRONMENTS_REGISTRY_PATH,
        ORCH_JOURNAL_PATH,
        ROUTING_DECISIONS_PATH,
        WORKFLOWS_DIR,
        TelemetryError,
        hasKey,
        isPlainObject,
        joinPath,
        splitJsonl,
        type TelemetryFsPort,
} from './api.ts';
import {
        bucketOfDuration,
        type DurationBucket,
        type EventKind,
        type Outcome,
        type SurfaceId,
} from './schema.ts';
import { classifyFailure, type TypedFailureRecord } from './failures.ts';

// ---------------------------------------------------------------------------
// The observation event (the in-memory closed-vocabulary fact)
// ---------------------------------------------------------------------------

/** One observed event -- every field drawn from a closed vocabulary (schema.ts) or the id allowlist. */
export interface ObservationEvent {
        readonly eventKind: EventKind;
        readonly surface: SurfaceId;
        readonly outcome: Outcome;
        readonly durationBucket: DurationBucket;
        /** The taxonomy class id (failures only). */
        readonly errorCode?: string;
        /** The subject identity (ids only -- providerId/environmentId/workflowId/graphId). */
        readonly identity?: Record<string, string>;
}

/** The observer outcome for one surface: its events + the honest parse report. */
export interface SurfaceObservation {
        readonly surfacePath: string;
        readonly events: readonly ObservationEvent[];
        /** True when the surface was present but did not parse (no events faked; the name surfaces in the pass result). */
        readonly unparseable: boolean;
        /** True when the surface is absent in this workspace (honest absence, not an error). */
        readonly absent: boolean;
}

// ---------------------------------------------------------------------------
// Observer 1: the provider-lane routing decisions (flauz-models)
// ---------------------------------------------------------------------------

/**
 * The routing-decision row (contract-duplicated from
 * flauz-models/src/routing/policy.ts RoutingDecision -- only the fields the
 * observation consumes; explanations/rule descriptions are the contents
 * class and are never read).
 */
interface RoutingDecisionRow {
        readonly selectionBasis: 'rule-match' | 'no-candidate';
        readonly selected: { readonly providerId: string } | null;
}

function parseRoutingDecisionLine(line: string, lineNo: number): RoutingDecisionRow | { readonly error: string } {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { error: `routing-decision line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { error: `routing-decision line ${String(lineNo)} is not a JSON object` };
        }
        if (parsed.selectionBasis !== 'rule-match' && parsed.selectionBasis !== 'no-candidate') {
                return { error: `routing-decision line ${String(lineNo)}: selectionBasis must be rule-match | no-candidate` };
        }
        if (parsed.selected === null) {
                return { selectionBasis: parsed.selectionBasis, selected: null };
        }
        if (isPlainObject(parsed.selected) && typeof parsed.selected.providerId === 'string' && parsed.selected.providerId.length > 0) {
                return { selectionBasis: parsed.selectionBasis, selected: { providerId: parsed.selected.providerId } };
        }
        return { error: `routing-decision line ${String(lineNo)}: selected must be null or carry a non-empty providerId` };
}

/**
 * Observes the routing decisions: one provider-call event per decision -- ok
 * on the selected lane (identity = the provider id), or the typed
 * environment/provider incompatibility failure on a no-candidate decision.
 */
export async function observeRoutingDecisions(root: string, fs: TelemetryFsPort): Promise<SurfaceObservation> {
        const text = await fs.readFileUtf8(joinPath(root, ROUTING_DECISIONS_PATH));
        if (text === undefined) {
                return { surfacePath: ROUTING_DECISIONS_PATH, events: [], unparseable: false, absent: true };
        }
        const events: ObservationEvent[] = [];
        let unparseable = false;
        for (const [index, line] of splitJsonl(text).entries()) {
                if (line === '') {
                        unparseable = true;
                        continue;
                }
                const outcome = parseRoutingDecisionLine(line, index + 1);
                if ('error' in outcome) {
                        unparseable = true;
                        continue;
                }
                if (outcome.selectionBasis === 'rule-match' && outcome.selected !== null) {
                        events.push({
                                eventKind: 'provider-call',
                                surface: 'flauz-models',
                                outcome: 'ok',
                                durationBucket: 'unrecorded',
                                identity: { providerId: outcome.selected.providerId },
                        });
                } else {
                        // the environment/provider incompatibility: no lane satisfied the request
                        const typed: TypedFailureRecord = classifyFailure({ code: 'NO_CANDIDATE', surface: 'flauz-models' });
                        events.push({
                                eventKind: 'failure',
                                surface: 'flauz-models',
                                outcome: 'no-candidate',
                                durationBucket: 'unrecorded',
                                errorCode: typed.telemetryDimension.errorCode,
                        });
                }
        }
        return { surfacePath: ROUTING_DECISIONS_PATH, events, unparseable, absent: false };
}

// ---------------------------------------------------------------------------
// Observer 2: the orchestration journal (flauz-agent core)
// ---------------------------------------------------------------------------

/**
 * The orchestration journal row (contract-duplicated from
 * flauz-agent/core/orchestration.mjs -- only the fields the observation
 * consumes; payloads are the contents class EXCEPT the closed-vocabulary
 * fields the provider-retry rows pin by contract). Graph-level rows
 * (graph-submitted, graph-approved) carry no stepId/attempt -- those fields
 * are OPTIONAL here and are only consumed on the step-scoped row types
 * (which pin them by contract).
 */
interface JournalRow {
        readonly seq: number;
        readonly ts: number;
        readonly graphId: string;
        readonly stepId?: string;
        readonly attempt?: number;
        readonly type: string;
        readonly payload: Record<string, unknown>;
}

function parseJournalLine(line: string, lineNo: number): JournalRow | { readonly error: string } {
        let parsed: unknown;
        try {
                parsed = JSON.parse(line);
        } catch (err) {
                return { error: `journal line ${String(lineNo)} is not valid JSON: ${(err as Error).message}` };
        }
        if (!isPlainObject(parsed)) {
                return { error: `journal line ${String(lineNo)} is not a JSON object` };
        }
        if (typeof parsed.seq !== 'number' || typeof parsed.ts !== 'number' || typeof parsed.graphId !== 'string' || typeof parsed.type !== 'string') {
                return { error: `journal line ${String(lineNo)}: the structural fields [seq, ts, graphId, type] must carry their pinned types` };
        }
        const stepId = typeof parsed.stepId === 'string' ? parsed.stepId : undefined;
        const attempt = typeof parsed.attempt === 'number' ? parsed.attempt : undefined;
        const payload = isPlainObject(parsed.payload) ? parsed.payload : {};
        return { seq: parsed.seq, ts: parsed.ts, graphId: parsed.graphId, ...(stepId !== undefined ? { stepId } : {}), ...(attempt !== undefined ? { attempt } : {}), type: parsed.type, payload };
}

/** The provider-retry window outcomes (contract-duplicated from orchestration.mjs PROVIDER_RETRY_OUTCOMES). */
const PROVIDER_RETRY_OUTCOMES = ['retryable-failed', 'exhausted', 'recovered'] as const;
type ProviderRetryOutcome = (typeof PROVIDER_RETRY_OUTCOMES)[number];

function telemetryOutcomeOfRetry(outcome: ProviderRetryOutcome): Outcome {
        if (outcome === 'recovered') { return 'recovered'; }
        if (outcome === 'exhausted') { return 'exhausted'; }
        return 'failed';
}

/**
 * Observes the orchestration journal: (a) the provider-retry rows -- the
 * DL-35 typed provider failure records (code + retry window outcome + the
 * wait applied before the attempt, bucketed); (b) the step transitions --
 * step-started paired with step-succeeded/step-failed yields the step
 * outcome + the duration bucket derived from the row timestamps. Step
 * failure messages and outputs (payload text) are never read.
 */
export async function observeOrchestrationJournal(root: string, fs: TelemetryFsPort): Promise<SurfaceObservation> {
        const text = await fs.readFileUtf8(joinPath(root, ORCH_JOURNAL_PATH));
        if (text === undefined) {
                return { surfacePath: ORCH_JOURNAL_PATH, events: [], unparseable: false, absent: true };
        }
        const events: ObservationEvent[] = [];
        let unparseable = false;
        // step-start bookmarks: graphId/stepId/attempt -> the start ts (for durations)
        const starts = new Map<string, number>();
        for (const [index, line] of splitJsonl(text).entries()) {
                if (line === '') {
                        unparseable = true;
                        continue;
                }
                const outcome = parseJournalLine(line, index + 1);
                if ('error' in outcome) {
                        unparseable = true;
                        continue;
                }
                const row = outcome;
                const key = `${row.graphId}/${row.stepId ?? '-'}/${String(row.attempt ?? 0)}`;
                if (row.type === 'step-started') {
                        starts.set(key, row.ts);
                        continue;
                }
                if (row.type === 'provider-retry') {
                        const retryOutcome = row.payload.outcome;
                        const code = row.payload.code;
                        if (typeof retryOutcome !== 'string' || !(PROVIDER_RETRY_OUTCOMES as readonly string[]).includes(retryOutcome) || typeof code !== 'string' || code.length === 0) {
                                // a provider-retry row that violates its own pinned payload contract: honest unparseable, never faked
                                unparseable = true;
                                continue;
                        }
                        const waitAppliedMs = typeof row.payload.waitAppliedMs === 'number' ? row.payload.waitAppliedMs : undefined;
                        const typed: TypedFailureRecord = classifyFailure({ code, surface: 'flauz-agent', identity: { graphId: row.graphId } });
                        events.push({
                                eventKind: 'failure',
                                surface: 'flauz-agent',
                                outcome: telemetryOutcomeOfRetry(retryOutcome as ProviderRetryOutcome),
                                durationBucket: bucketOfDuration(waitAppliedMs),
                                errorCode: typed.telemetryDimension.errorCode,
                                identity: { graphId: row.graphId },
                        });
                        continue;
                }
                if (row.type === 'step-succeeded' || row.type === 'step-failed') {
                        const startedAt = starts.get(key);
                        const durationBucket = startedAt !== undefined ? bucketOfDuration(row.ts - startedAt) : 'unrecorded';
                        events.push({
                                eventKind: 'workflow-step',
                                surface: 'flauz-agent',
                                outcome: row.type === 'step-succeeded' ? 'ok' : 'failed',
                                durationBucket,
                                identity: { graphId: row.graphId },
                        });
                }
        }
        return { surfacePath: ORCH_JOURNAL_PATH, events, unparseable, absent: false };
}

// ---------------------------------------------------------------------------
// Observer 3: the environments registry (flauz-environments)
// ---------------------------------------------------------------------------

/**
 * Observes the environments registry: one environment-validation event per
 * entry -- valid (parses + enabled), disabled (parses, not enabled), or
 * invalid (fails the descriptor shape: a typed environment-validation-failed
 * failure). A registry that exists but does not parse yields ONE invalid
 * event with no identity (the registry itself failed validation).
 *
 * The ACTIVE-REFERENCE failures (the real misconfiguration states the
 * registry carries): the envelope's `activeId` referencing a MISSING entry
 * types environment-unknown; referencing a DISABLED entry types
 * environment-disabled; referencing an UNTRUSTED-posture entry types
 * environment-trust-rejected (operations on the active environment fail
 * their trust gate). An absent activeId is honest absence (nothing is
 * selected -- no failure).
 */
export async function observeEnvironments(root: string, fs: TelemetryFsPort): Promise<SurfaceObservation> {
        const text = await fs.readFileUtf8(joinPath(root, ENVIRONMENTS_REGISTRY_PATH));
        if (text === undefined) {
                return { surfacePath: ENVIRONMENTS_REGISTRY_PATH, events: [], unparseable: false, absent: true };
        }
        const events: ObservationEvent[] = [];
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch {
                const typed: TypedFailureRecord = classifyFailure({ code: 'DESCRIPTOR_INVALID', surface: 'flauz-environments' });
                events.push({
                        eventKind: 'failure',
                        surface: 'flauz-environments',
                        outcome: 'invalid',
                        durationBucket: 'unrecorded',
                        errorCode: typed.telemetryDimension.errorCode,
                });
                return { surfacePath: ENVIRONMENTS_REGISTRY_PATH, events, unparseable: false, absent: false };
        }
        if (!isPlainObject(parsed) || !Array.isArray(parsed.environments)) {
                const typed: TypedFailureRecord = classifyFailure({ code: 'DESCRIPTOR_INVALID', surface: 'flauz-environments' });
                events.push({
                        eventKind: 'failure',
                        surface: 'flauz-environments',
                        outcome: 'invalid',
                        durationBucket: 'unrecorded',
                        errorCode: typed.telemetryDimension.errorCode,
                });
                return { surfacePath: ENVIRONMENTS_REGISTRY_PATH, events, unparseable: false, absent: false };
        }
        let unparseable = false;
        const entriesById = new Map<string, Record<string, unknown>>();
        for (const entry of parsed.environments) {
                if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id.length === 0) {
                        // an entry without a usable id: the honest invalid outcome, no identity faked
                        const typed: TypedFailureRecord = classifyFailure({ code: 'DESCRIPTOR_INVALID', surface: 'flauz-environments' });
                        events.push({
                                eventKind: 'failure',
                                surface: 'flauz-environments',
                                outcome: 'invalid',
                                durationBucket: 'unrecorded',
                                errorCode: typed.telemetryDimension.errorCode,
                        });
                        unparseable = true;
                        continue;
                }
                entriesById.set(entry.id, entry);
                const environmentId = entry.id;
                const shapeOk = typeof entry.kind === 'string'
                        && entry.kind.length > 0
                        && isPlainObject(entry.connection)
                        && isPlainObject(entry.trust)
                        && typeof entry.trust.posture === 'string'
                        && isPlainObject(entry.capabilities);
                if (!shapeOk) {
                        const typed: TypedFailureRecord = classifyFailure({ code: 'DESCRIPTOR_INVALID', surface: 'flauz-environments', identity: { environmentId } });
                        events.push({
                                eventKind: 'failure',
                                surface: 'flauz-environments',
                                outcome: 'invalid',
                                durationBucket: 'unrecorded',
                                errorCode: typed.telemetryDimension.errorCode,
                                identity: { environmentId },
                        });
                        continue;
                }
                if (entry.enabled === true) {
                        events.push({
                                eventKind: 'environment-validation',
                                surface: 'flauz-environments',
                                outcome: 'valid',
                                durationBucket: 'unrecorded',
                                identity: { environmentId },
                        });
                } else {
                        events.push({
                                eventKind: 'environment-validation',
                                surface: 'flauz-environments',
                                outcome: 'disabled',
                                durationBucket: 'unrecorded',
                                identity: { environmentId },
                        });
                }
        }
        // --- the active-reference failures (the registry's real misconfiguration states) ---
        if (typeof parsed.activeId === 'string' && parsed.activeId.length > 0) {
                const active = entriesById.get(parsed.activeId);
                if (active === undefined) {
                        const typed: TypedFailureRecord = classifyFailure({ code: 'ENVIRONMENT_UNKNOWN', surface: 'flauz-environments' });
                        events.push({
                                eventKind: 'failure',
                                surface: 'flauz-environments',
                                outcome: 'failed',
                                durationBucket: 'unrecorded',
                                errorCode: typed.telemetryDimension.errorCode,
                                identity: { environmentId: parsed.activeId },
                        });
                } else {
                        if (active.enabled !== true) {
                                const typed: TypedFailureRecord = classifyFailure({ code: 'ENVIRONMENT_DISABLED', surface: 'flauz-environments', identity: { environmentId: parsed.activeId } });
                                events.push({
                                        eventKind: 'failure',
                                        surface: 'flauz-environments',
                                        outcome: 'failed',
                                        durationBucket: 'unrecorded',
                                        errorCode: typed.telemetryDimension.errorCode,
                                        identity: { environmentId: parsed.activeId },
                                });
                        }
                        if (active.trust !== undefined && isPlainObject(active.trust) && active.trust.posture === 'untrusted') {
                                const typed: TypedFailureRecord = classifyFailure({ code: 'TRUST_POSTURE_REJECTED', surface: 'flauz-environments', identity: { environmentId: parsed.activeId } });
                                events.push({
                                        eventKind: 'failure',
                                        surface: 'flauz-environments',
                                        outcome: 'failed',
                                        durationBucket: 'unrecorded',
                                        errorCode: typed.telemetryDimension.errorCode,
                                        identity: { environmentId: parsed.activeId },
                                });
                        }
                }
        }
        return { surfacePath: ENVIRONMENTS_REGISTRY_PATH, events, unparseable, absent: false };
}

// ---------------------------------------------------------------------------
// Observer 4: the workflow envelopes (flauz-workflow)
// ---------------------------------------------------------------------------

/** The workflow-envelope file pattern (contract-duplicated: W-NNN.json, the census/migration rule). */
const WORKFLOW_ENVELOPE_PATTERN = /^W-\d{3,}\.json$/;

/**
 * Observes the workflow envelopes: one workflow-step event per tool step
 * (outcome ok/failed, identity = the workflow id). Envelope texts are never
 * read beyond the outcome field; a present-but-unparseable envelope degrades
 * honestly (unparseable flag, no faked events).
 */
export async function observeWorkflows(root: string, fs: TelemetryFsPort): Promise<SurfaceObservation> {
        const entries = await fs.readdir(joinPath(root, WORKFLOWS_DIR));
        if (entries === undefined) {
                return { surfacePath: WORKFLOWS_DIR, events: [], unparseable: false, absent: true };
        }
        const events: ObservationEvent[] = [];
        let unparseable = false;
        for (const name of entries.filter(entry => WORKFLOW_ENVELOPE_PATTERN.test(entry)).sort()) {
                const workflowId = name.replace(/\.json$/, '');
                const text = await fs.readFileUtf8(joinPath(root, WORKFLOWS_DIR, name));
                if (text === undefined) {
                        unparseable = true;
                        continue;
                }
                let parsed: unknown;
                try {
                        parsed = JSON.parse(text);
                } catch {
                        unparseable = true;
                        continue;
                }
                if (!isPlainObject(parsed) || !Array.isArray(parsed.tools)) {
                        unparseable = true;
                        continue;
                }
                for (const step of parsed.tools) {
                        if (!isPlainObject(step) || !hasKey(step, 'outcome')) {
                                unparseable = true;
                                continue;
                        }
                        if (step.outcome !== 'ok' && step.outcome !== 'failed') {
                                unparseable = true;
                                continue;
                        }
                        events.push({
                                eventKind: 'workflow-step',
                                surface: 'flauz-workflow',
                                outcome: step.outcome,
                                durationBucket: 'unrecorded',
                                identity: { workflowId },
                        });
                }
        }
        return { surfacePath: WORKFLOWS_DIR, events, unparseable, absent: false };
}

// ---------------------------------------------------------------------------
// The full observation pass
// ---------------------------------------------------------------------------

/** The observation pass outcome: every surface's events + the honest parse report. */
export interface ObservationPass {
        readonly observations: readonly SurfaceObservation[];
        readonly events: readonly ObservationEvent[];
        /** The surface names (paths) that were present but did not parse -- names only, metadata. */
        readonly unparseableSurfaces: readonly string[];
        /** The surface names (paths) absent in this workspace -- honest absence. */
        readonly absentSurfaces: readonly string[];
}

/** Runs every observer over the real durable state. */
export async function observeAllSurfaces(root: string, fs: TelemetryFsPort): Promise<ObservationPass> {
        const observations = [
                await observeRoutingDecisions(root, fs),
                await observeOrchestrationJournal(root, fs),
                await observeEnvironments(root, fs),
                await observeWorkflows(root, fs),
        ];
        const events = observations.flatMap(observation => observation.events);
        return {
                observations,
                events,
                unparseableSurfaces: observations.filter(observation => observation.unparseable).map(observation => observation.surfacePath),
                absentSurfaces: observations.filter(observation => observation.absent).map(observation => observation.surfacePath),
        };
}

/** Guard re-export (the observers' typed-refusal surface for untypable codes). */
export const observeGuards = {
        assertKnownFailureCode(code: string, surface: SurfaceId): void {
                classifyFailure({ code, surface });
        },
};

/** The typed error re-export for observer callers. */
export { TelemetryError };
