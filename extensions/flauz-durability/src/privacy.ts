/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy gate of the long-running worker supervision plane
 * (A-PROD-005-W4).
 *
 * THE METADATA LAW (this wave's privacy posture, the W1/W2/W3/W5 posture
 * applied to the durability surfaces): the lane registry, the heartbeat
 * records, the status records, the command renders and the banked evidence
 * rows legitimately enumerate surface SHAPES -- lane ids, owning extension
 * names, heartbeat stamps, liveness classes, verdicts, counts, interval
 * statistics, escalation policies -- and NEVER CONTENTS and never
 * credentials. What may NEVER carry a secret-shaped value is every metadata
 * surface this extension produces; the sweep below deep-walks each one
 * before a single byte is written and refuses the whole operation on any
 * hit (fail-closed).
 *
 * Pattern text only -- no complete secret shape is ever spelled out in this
 * source file; test fixtures assemble secret-shaped strings from fragments
 * at runtime (the flauz-resources discipline).
 */

import { DurabilityError, isPlainObject } from './api.ts';

/**
 * Known credential shapes (contract-duplicated from
 * flauz-resources/src/api.ts -- the vault-only policy, SECURITY-MODEL 3.5
 * discipline; pinned by the canary tests). A string matching one of these is
 * never written into a metadata-class artifact.
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
                        throw new DurabilityError(
                                'FLAUZ_DURABILITY_SECRET_SHAPED',
                                `flauz.durability/v1: ${path}: secret-shaped literal refused -- a metadata surface (the lane registry, the heartbeat records, the status records, the command renders, the banked evidence rows) may carry only lane ids, owning extension names, heartbeat stamps, liveness classes, verdicts, counts and interval statistics, never credential-shaped values and never contents`,
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

/** Sweeps a whole assembled metadata artifact (the pre-write backstop). */
export function sweepArtifact(artifact: unknown, artifactName: string): void {
        assertNoSecretShapedValues(artifact, artifactName);
}
