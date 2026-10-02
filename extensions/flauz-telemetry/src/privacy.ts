/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy gate of the telemetry plane (A-PROD-004-W4).
 *
 * THE SWEEP LAW (the W2 canary discipline, narrowed to this wave's posture):
 * telemetry records AGGREGATES ONLY -- every value in every telemetry surface
 * (the ledger rows, the config artifact, the report aggregates, the failure
 * census, every command render) must come from a CLOSED VOCABULARY plus ids.
 * What may NEVER appear anywhere is a secret-shaped value: the sweep below
 * deep-walks every would-be-written artifact BEFORE a single byte is written
 * and refuses the whole batch on any hit (fail-closed). The batch posture is
 * the W1 bundle law: one poisoned row refuses the entire pass, never a
 * partial write.
 *
 * Pattern text only -- no complete secret shape is ever spelled out in this
 * source file; test fixtures assemble secret-shaped strings from fragments at
 * runtime (the flauz-resources discipline).
 */

import { TelemetryError, isPlainObject } from './api.ts';

/**
 * Known credential shapes (contract-duplicated from
 * flauz-resources/src/api.ts -- the vault-only policy, SECURITY-MODEL 3.5
 * discipline; pinned by the canary tests). A string matching one of these is
 * never written into any telemetry surface.
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
			throw new TelemetryError(
				'FLAUZ_TELEMETRY_SECRET_SHAPED',
				`flauz.telemetry/v1: ${path}: secret-shaped literal refused -- a telemetry surface (the ledger rows, the config, the report aggregates, the failure census, every render) may carry only closed-vocabulary aggregates and ids, never credential-shaped values (the whole batch is refused: fail-closed, never a partial write)`,
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
