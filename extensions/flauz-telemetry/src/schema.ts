/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The declared event schema (A-PROD-004-W4) -- the ENUMERATED CONTRACT of
 * everything telemetry CAN record, rendered to the operator BEFORE any
 * enabling can happen (the inspect-before-enable law).
 *
 * THE CLOSED-VOCABULARY LAW: a telemetry ledger row may carry values for
 * EXACTLY these dimensions and NOTHING else -- event kind, surface, outcome,
 * duration-bucket, error-code (a taxonomy class id) and the identity ids
 * (providerId/environmentId/workflowId/graphId: ids are metadata, the beta
 * gate's explicit allowlist). Event CONTENTS (prompts, completions, provider
 * payloads, message texts, free-form notes) are NEVER recorded -- not
 * redacted-then-recorded, NEVER recorded. Durations are recorded as BUCKETS,
 * never raw millisecond values (a bucket is a shape, a raw duration is a
 * fingerprint).
 *
 * The schema descriptor object below is what `flauz.telemetry.config` renders
 * and what the config's `schemaDigest` pins (sha256 over its canonical JSON):
 * if the vocabulary ever changes, the digest changes with it, and an operator
 * who enabled against the old digest sees the typed SCHEMA_DRIFT refusal
 * until they consciously re-inspect and re-enable.
 */

import {
	TELEMETRY_SCHEMA_DESCRIPTOR_ID,
	canonicalJson,
	sha256Hex,
} from './api.ts';
import { FAILURE_CLASS_IDS, type FailureClassId } from './failures.ts';

// ---------------------------------------------------------------------------
// The dimensions (each a closed vocabulary)
// ---------------------------------------------------------------------------

/** The event kinds telemetry can record. */
export const EVENT_KINDS = ['provider-call', 'environment-validation', 'workflow-step', 'failure', 'config'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The surfaces whose events telemetry can record (the Flauz extension ids). */
export const SURFACES = ['flauz-models', 'flauz-environments', 'flauz-workflow', 'flauz-agent', 'flauz-telemetry'] as const;
export type SurfaceId = (typeof SURFACES)[number];

/** The outcomes telemetry can record (per event kind, the union is closed). */
export const OUTCOMES = [
	'ok', 'no-candidate',
	'failed', 'recovered', 'exhausted',
	'valid', 'invalid', 'disabled',
	'enabled',
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/**
 * The duration buckets (shapes, never raw durations). `unrecorded` is the
 * honest bucket for observations whose source surface carries no duration
 * fact (e.g. a routing decision has no elapsed-time field).
 */
export const DURATION_BUCKETS = ['unrecorded', '0-10ms', '10-100ms', '100ms-1s', '1-10s', '10s+'] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/** The identity fields telemetry can record (ids only -- the metadata allowlist). */
export const IDENTITY_FIELDS = ['providerId', 'environmentId', 'workflowId', 'graphId'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** The never-recorded list (rendered with the schema; the contents class). */
export const NEVER_RECORDED: readonly string[] = [
	'prompts (the user text sent to a model)',
	'completions (the model text that came back)',
	'provider payloads (request/response bodies, tool calls, wire fragments)',
	'message texts and free-form notes (task events, step outputs, explanations)',
	'raw duration values (buckets only -- a raw duration is a fingerprint)',
	'credential-shaped values (the canary sweep refuses the whole batch, fail-closed)',
];

// ---------------------------------------------------------------------------
// The descriptor (the renderable, hash-pinnable artifact)
// ---------------------------------------------------------------------------

/** One declared dimension: its name and its closed value vocabulary. */
export interface SchemaDimension {
	readonly name: string;
	readonly values: readonly string[];
	readonly note: string;
}

/** The declared event schema descriptor (the inspect-before-enable artifact). */
export interface EventSchemaDescriptor {
	readonly $schema: typeof TELEMETRY_SCHEMA_DESCRIPTOR_ID;
	readonly schemaVersion: 1;
	readonly dimensions: readonly SchemaDimension[];
	readonly neverRecorded: readonly string[];
	readonly collectionPosture: readonly string[];
}

/** The collection posture lines (the opt-in/local-first/aggregate laws, rendered with the schema). */
const COLLECTION_POSTURE: readonly string[] = [
	'opt-in by default: zero collection until the operator explicitly enables telemetry (flauz.telemetry.config with enable: true)',
	'local-first: aggregates persist workspace-locally under .flauz/telemetry/; no network egress exists in v0 (no fetch, no http, no socket); nothing leaves the machine',
	'aggregates only: rows are per-dimension-tuple counts over closed vocabularies; event contents are never recorded',
	'retention: rows older than the configured retention (default 30 days) are pruned at record time',
];

/** The declared event schema -- THE enumeration (single source of truth for this module's vocabularies). */
export const EVENT_SCHEMA: EventSchemaDescriptor = {
	$schema: TELEMETRY_SCHEMA_DESCRIPTOR_ID,
	schemaVersion: 1,
	dimensions: [
		{ name: 'eventKind', values: [...EVENT_KINDS], note: 'what kind of thing happened' },
		{ name: 'surface', values: [...SURFACES], note: 'which Flauz surface the event was observed on' },
		{ name: 'outcome', values: [...OUTCOMES], note: 'the closed outcome vocabulary across all event kinds' },
		{ name: 'durationBucket', values: [...DURATION_BUCKETS], note: 'duration shapes, never raw durations' },
		{ name: 'errorCode', values: [...FAILURE_CLASS_IDS], note: 'the typed failure-taxonomy class id (failures.ts), when the event is a failure' },
		{ name: 'identity', values: [...IDENTITY_FIELDS], note: 'the id fields that may identify the subject (ids are metadata; labels and names are not recorded)' },
	],
	neverRecorded: NEVER_RECORDED,
	collectionPosture: COLLECTION_POSTURE,
};

/** The digest of the declared schema (pinned into the config at enable time). */
export function eventSchemaDigest(): string {
	return sha256Hex(canonicalJson(EVENT_SCHEMA));
}

// ---------------------------------------------------------------------------
// Vocabulary guards + bucketing
// ---------------------------------------------------------------------------

export function isEventKind(value: unknown): value is EventKind {
	return typeof value === 'string' && (EVENT_KINDS as readonly string[]).includes(value);
}

export function isSurfaceId(value: unknown): value is SurfaceId {
	return typeof value === 'string' && (SURFACES as readonly string[]).includes(value);
}

export function isOutcome(value: unknown): value is Outcome {
	return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value);
}

export function isDurationBucket(value: unknown): value is DurationBucket {
	return typeof value === 'string' && (DURATION_BUCKETS as readonly string[]).includes(value);
}

export function isIdentityField(value: unknown): value is IdentityField {
	return typeof value === 'string' && (IDENTITY_FIELDS as readonly string[]).includes(value);
}

/** The taxonomy-class guard (re-exported shape check for the errorCode dimension). */
export function isFailureClassId(value: unknown): value is FailureClassId {
	return typeof value === 'string' && (FAILURE_CLASS_IDS as readonly string[]).includes(value);
}

/**
 * Buckets a duration in milliseconds into the declared bucket vocabulary.
 * Negative inputs (a data error on the source surface) return `unrecorded` --
 * the honest bucket, never a fabricated one.
 */
export function bucketOfDuration(durationMs: number | undefined): DurationBucket {
	if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
		return 'unrecorded';
	}
	if (durationMs < 10) { return '0-10ms'; }
	if (durationMs < 100) { return '10-100ms'; }
	if (durationMs < 1000) { return '100ms-1s'; }
	if (durationMs < 10000) { return '1-10s'; }
	return '10s+';
}

/** Renders the schema as the inspect-before-enable disclosure lines. */
export function renderSchemaLines(): string[] {
	const lines: string[] = [];
	lines.push('flauz.telemetry -- the DECLARED EVENT SCHEMA (v1): every dimension telemetry CAN record, enumerated before any enabling:');
	for (const dimension of EVENT_SCHEMA.dimensions) {
		lines.push(`  ${dimension.name}: ${dimension.values.join(' | ')} -- ${dimension.note}`);
	}
	lines.push('  NEVER recorded (the contents class):');
	for (const item of EVENT_SCHEMA.neverRecorded) {
		lines.push(`    - ${item}`);
	}
	lines.push('  collection posture:');
	for (const item of EVENT_SCHEMA.collectionPosture) {
		lines.push(`    - ${item}`);
	}
	lines.push(`  schema digest (pinned into the config at enable time): ${eventSchemaDigest()}`);
	return lines;
}
