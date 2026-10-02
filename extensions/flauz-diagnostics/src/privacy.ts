/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy gate of the support bundle (A-PROD-004-W1).
 *
 * Three laws, one module:
 *
 *   1. THE REDACTION LAW -- every projected event surface keeps STRUCTURE
 *      only: ids, enums, counts, paths, digests. Free-form text (notes,
 *      outputs, titles, causes, explanations) is DROPPED -- it is the
 *      contents class; the surviving digests (contentHash, prev, before/
 *      afterDigest) preserve tamper-evidence without content.
 *
 *   2. THE SECRET-SHAPE SWEEP (fail-closed) -- every artifact object is
 *      deep-walked before it is written; a secret-shaped string ANYWHERE in
 *      an artifact refuses the whole bundle with a typed error. This is the
 *      defense-in-depth behind the redaction law (the redaction should have
 *      dropped it; the sweep guarantees it). Pattern text only -- no
 *      complete secret shape is ever spelled out in this source file; test
 *      fixtures assemble secret-shaped strings from fragments at runtime
 *      (the flauz-resources discipline).
 *
 *   3. THE CONTENTS-CLASS REFUSAL -- `contents` bundles do not exist in v0;
 *      the refusal with its future-decision list lives in api.ts + commands.
 */

import { CONTENTS_FUTURE_DECISIONS, DiagnosticsError, hasKey, isPlainObject } from './api.ts';
import type { LedgerRowShape, OpsRecordShape } from './verify.ts';

/**
 * Known credential shapes (contract-duplicated from
 * flauz-resources/src/api.ts -- the vault-only policy, SECURITY-MODEL 3.5
 * discipline; pinned by the canary tests). A string matching one of these is
 * never written into a bundle.
 */
const SECRET_SHAPED_PATTERNS: readonly RegExp[] = [
	/\bghp_[A-Za-z0-9]{20,}\b/,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
	/\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/,
	/\bAKIA[0-9A-Z]{16}\b/,
	/\bASIA[0-9A-Z]{16}\b/,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/\bBearer [A-Za-z0-9._-]{16,}\b/,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{16,}\b/,
];

/** True when the string itself looks like a credential literal. */
export function looksSecretShaped(value: string): boolean {
	return SECRET_SHAPED_PATTERNS.some(pattern => pattern.test(value));
}

/**
 * Deep-walks a JSON value and refuses (typed, fail-closed) any secret-shaped
 * string. `path` is a JSON-path-ish location for the error message.
 */
export function assertNoSecretShapedValues(value: unknown, path: string): void {
	if (typeof value === 'string') {
		if (looksSecretShaped(value)) {
			throw new DiagnosticsError(
				'FLAUZ_DIAG_SECRET_SHAPED',
				`flauz.diagnostics/v0: ${path}: secret-shaped literal refused -- a support bundle may carry only counts, hashes, paths and ids, never credential-shaped values (the redaction sweep should have dropped it; this refusal is the fail-closed backstop)`,
			);
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			assertNoSecretShapedValues(item, `${path}[${String(index)}]`);
		}
		return;
	}
	if (isPlainObject(value)) {
		for (const key of Object.keys(value)) {
			assertNoSecretShapedValues(value[key], `${path}.${key}`);
		}
	}
}

/** Sweeps a whole assembled artifact (the pre-write backstop). */
export function sweepArtifact(artifact: unknown, artifactName: string): void {
	assertNoSecretShapedValues(artifact, artifactName);
}

// ---------------------------------------------------------------------------
// The redaction projections (law 1)
// ---------------------------------------------------------------------------

/** The contents-class marker replacing a dropped payload object. */
export const PAYLOAD_REDACTED = { redacted: 'contents-class' } as const;

/**
 * One redacted orchestration-journal row (flauz-agent core, the execution
 * journal). Kept: the 13 structural fields (ids, actor, origin, attempt,
 * idempotencyKey, hashes). Dropped: the payload object -- payloads carry
 * titles, notes, outputs and evidence uris of arbitrary shape; the
 * contentHash preserves the tamper-evidence link without content.
 */
export interface RedactedJournalRow {
	readonly seq: number;
	readonly rowId: unknown;
	readonly ts: number;
	readonly graphId: unknown;
	readonly stepId: unknown;
	readonly type: string;
	readonly actor: string;
	readonly origin: string;
	readonly attempt: number;
	readonly idempotencyKey: string;
	readonly contentHash: string;
	readonly prev: string | null;
	readonly payload: typeof PAYLOAD_REDACTED;
}

/** Redacts one parsed orchestration journal row (unknown rows pass as `{unparsed: true}`). */
export function redactJournalRow(value: unknown): RedactedJournalRow | { readonly unparsed: true } {
	if (!isPlainObject(value) || typeof value.seq !== 'number' || typeof value.type !== 'string' || typeof value.contentHash !== 'string') {
		return { unparsed: true };
	}
	return {
		seq: value.seq,
		rowId: value.rowId,
		ts: typeof value.ts === 'number' ? value.ts : 0,
		graphId: value.graphId,
		stepId: value.stepId,
		type: value.type,
		actor: typeof value.actor === 'string' ? value.actor : '',
		origin: typeof value.origin === 'string' ? value.origin : '',
		attempt: typeof value.attempt === 'number' ? value.attempt : 0,
		idempotencyKey: typeof value.idempotencyKey === 'string' ? value.idempotencyKey : '',
		contentHash: value.contentHash,
		prev: typeof value.prev === 'string' ? value.prev : null,
		payload: PAYLOAD_REDACTED,
	};
}

/**
 * One redacted ops record (flauz-resources). Kept: op, refId, actor, the
 * session/task ids, both digests, prev. Dropped: cause + note (free-form).
 */
export interface RedactedOpsRecord {
	readonly seq: number;
	readonly ts: number;
	readonly op: string;
	readonly refId: string;
	readonly actor: string;
	readonly beforeDigest: string;
	readonly afterDigest: string;
	readonly prev: string | null;
	readonly freeTextRedacted: true;
}

/** Redacts one parsed ops record (unknown rows pass as `{unparsed: true}`). */
export function redactOpsRecord(record: OpsRecordShape): RedactedOpsRecord {
	return {
		seq: record.seq,
		ts: record.ts,
		op: record.op,
		refId: record.refId,
		actor: record.actor,
		beforeDigest: record.beforeDigest,
		afterDigest: record.afterDigest,
		prev: record.prev,
		freeTextRedacted: true,
	};
}

/**
 * One redacted provider-switch linking event (flauz-models, the P2-FIX-116
 * event). Kept: the ids, the three artifact references (paths + digests +
 * decisionId + selectedProviderId) and the changed rule IDS. Dropped: the
 * explanation (free-form) and the full before/after rule shapes (rule
 * descriptions are free-form text).
 */
export interface RedactedProviderSwitch {
	readonly switchId: unknown;
	readonly at: number;
	readonly fromProviderId: unknown;
	readonly toProviderId: unknown;
	readonly providersFile: { readonly path: unknown; readonly sha256: unknown };
	readonly routingPolicy: { readonly path: unknown; readonly sha256: unknown; readonly changedRuleIds: readonly unknown[] };
	readonly routingDecision: { readonly path: unknown; readonly decisionId: unknown; readonly selectedProviderId: unknown };
	readonly explanationRedacted: true;
}

/** Redacts one parsed provider-switch event (unknown rows pass as `{unparsed: true}`). */
export function redactProviderSwitch(value: unknown): RedactedProviderSwitch | { readonly unparsed: true } {
	if (!isPlainObject(value)) {
		return { unparsed: true };
	}
	const policy = isPlainObject(value.routingPolicy) ? value.routingPolicy : {};
	const changedRules = Array.isArray(policy.changedRules) ? policy.changedRules : [];
	return {
		switchId: value.switchId,
		at: typeof value.at === 'number' ? value.at : 0,
		fromProviderId: value.fromProviderId,
		toProviderId: value.toProviderId,
		providersFile: isPlainObject(value.providersFile)
			? { path: value.providersFile.path, sha256: value.providersFile.sha256 }
			: { path: undefined, sha256: undefined },
		routingPolicy: {
			path: policy.path,
			sha256: policy.sha256,
			changedRuleIds: changedRules.map(rule => isPlainObject(rule) && hasKey(rule, 'ruleId') ? rule.ruleId : undefined),
		},
		routingDecision: isPlainObject(value.routingDecision)
			? { path: value.routingDecision.path, decisionId: value.routingDecision.decisionId, selectedProviderId: value.routingDecision.selectedProviderId }
			: { path: undefined, decisionId: undefined, selectedProviderId: undefined },
		explanationRedacted: true,
	};
}

/**
 * The ledger rows need no projection (the stored 7-field shape is all
 * metadata: ids, kinds, paths, digests); the sweep still runs over them.
 * Exported for the bundle builder + tests as the explicit class decision.
 */
export function redactLedgerRow(row: LedgerRowShape): LedgerRowShape {
	return row;
}

/** The future-decision list surfaced by the contents refusal (re-exported for the command surface). */
export { CONTENTS_FUTURE_DECISIONS };
