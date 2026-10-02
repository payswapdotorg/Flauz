/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The W4 telemetry consultation (A-PROD-004-W5): the release checklist's
 * telemetry row (the opt-in state must be KNOWABLE) and failure-typing row
 * (the typed provider/environment failure taxonomy must be loaded + closed).
 *
 * BOTH surfaces are consulted read-only through their CONTRACT-DUPLICATED
 * shapes (DL-32 -- never imported from flauz-telemetry at src time; pinned
 * against the real modules by test/contract.test.ts):
 *
 *   - the telemetry config artifact (.flauz/telemetry/config.json,
 *     flauz.telemetry-config/v1): ABSENT = the default-off state (a KNOWN
 *     state -- telemetry ships disabled); PRESENT + parseable = the known
 *     enabled/disabled state; PRESENT-but-malformed = the state CANNOT be
 *     known (the W4 law: "the opt-in state may never be guessed") -- the
 *     checklist row turns UNKNOWN, the exact go/no-go vocabulary the beta
 *     gate demands;
 *
 *   - the failure taxonomy (the 14 FAILURE_CLASSES over the real
 *     flauz-models ProviderErrorCode + flauz-environments validation
 *     vocabularies): loaded + closed when every source code maps to exactly
 *     one class and every class carries its label/surfaces/remediation.
 */

import {
        TELEMETRY_CONFIG_PATH,
        isPlainObject,
        joinPath,
        type ReleaseFsPort,
} from './api.ts';

// ---------------------------------------------------------------------------
// The telemetry config state (the opt-in plane, consulted read-only)
// ---------------------------------------------------------------------------

/** The telemetry opt-in state as the checklist sees it. */
export type TelemetryConfigState =
        | { readonly state: 'absent-default-off' }
        | { readonly state: 'known'; readonly enabled: boolean; readonly retentionDays: number; readonly consentAction?: 'enable' | 'disable' }
        | { readonly state: 'corrupt'; readonly problem: string };

/**
 * Resolves the telemetry opt-in state (the W4 loadTelemetryConfig semantics,
 * contract-duplicated -- reported, never thrown: the checklist row carries
 * the unknown verdict itself).
 */
export async function readTelemetryConfigState(root: string, fs: ReleaseFsPort): Promise<TelemetryConfigState> {
        const text = await fs.readFileUtf8(joinPath(root, TELEMETRY_CONFIG_PATH));
        if (text === undefined) {
                return { state: 'absent-default-off' };
        }
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH} is not valid JSON (${(err as Error).message})` };
        }
        if (!isPlainObject(parsed)) {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH} is not a JSON object` };
        }
        if (parsed.$schema !== 'flauz.telemetry-config/v1') {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH} carries $schema ${JSON.stringify(parsed.$schema)} (expected 'flauz.telemetry-config/v1') -- a foreign artifact is not a telemetry config` };
        }
        if (parsed.schemaVersion !== 0) {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH} carries schemaVersion ${JSON.stringify(parsed.schemaVersion)} (expected 0)` };
        }
        if (typeof parsed.enabled !== 'boolean') {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH}: 'enabled' must be a boolean (the opt-in state)` };
        }
        if (typeof parsed.retentionDays !== 'number' || !Number.isSafeInteger(parsed.retentionDays) || parsed.retentionDays < 1 || parsed.retentionDays > 3650) {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH}: 'retentionDays' must be an integer in [1, 3650]` };
        }
        if (typeof parsed.schemaDigest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.schemaDigest)) {
                return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH}: 'schemaDigest' must be 64 lowercase hex chars` };
        }
        let consentAction: 'enable' | 'disable' | undefined;
        if (parsed.consent !== undefined) {
                const consent = parsed.consent;
                if (!isPlainObject(consent) || typeof consent.at !== 'number' || (consent.action !== 'enable' && consent.action !== 'disable')) {
                        return { state: 'corrupt', problem: `${TELEMETRY_CONFIG_PATH}: 'consent' must be { at: positive integer, action: enable | disable }` };
                }
                consentAction = consent.action;
        }
        return consentAction === undefined
                ? { state: 'known', enabled: parsed.enabled, retentionDays: parsed.retentionDays }
                : { state: 'known', enabled: parsed.enabled, retentionDays: parsed.retentionDays, consentAction };
}

// ---------------------------------------------------------------------------
// The failure taxonomy (the W4 typing, contract-duplicated read-only)
// ---------------------------------------------------------------------------

/** The flauz-models provider error codes (contract-duplicated from flauz-telemetry's contract-duplication of flauz-models src/contract/errors.ts). */
export const PROVIDER_ERROR_CODES = [
        'AUTH_FAILED',
        'PERMISSION_DENIED',
        'NOT_FOUND',
        'BAD_REQUEST',
        'CONTEXT_OVERFLOW',
        'RATE_LIMITED',
        'PROVIDER_OVERLOADED',
        'NETWORK_ERROR',
        'TIMEOUT',
        'CANCELLED',
        'MALFORMED_RESPONSE',
        'CREDENTIAL_UNRESOLVED',
        'PROTOCOL_ERROR',
        'NO_CANDIDATE',
] as const;
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

/** The environment-side source codes (contract-duplicated from the flauz-environments lifecycle/validation vocabularies). */
export const ENVIRONMENT_SOURCE_CODES = [
        'ENVIRONMENT_UNKNOWN',
        'ENVIRONMENT_DISABLED',
        'TRUST_POSTURE_REJECTED',
        'STORE_CORRUPT',
        'DESCRIPTOR_INVALID',
] as const;
export type EnvironmentSourceCode = (typeof ENVIRONMENT_SOURCE_CODES)[number];

/** Every source code the taxonomy accepts (provider + environment sides). */
export const FAILURE_SOURCE_CODES = [...PROVIDER_ERROR_CODES, ...ENVIRONMENT_SOURCE_CODES] as const;
export type FailureSourceCode = (typeof FAILURE_SOURCE_CODES)[number];

/** One typed failure class (the W4 shape, contract-duplicated; remediation text duplicated verbatim for the operator surface). */
export interface FailureClassDef {
        readonly id: string;
        readonly label: string;
        readonly surfaces: readonly string[];
        readonly sourceCodes: readonly FailureSourceCode[];
        readonly remediation: string;
}

/**
 * The typed failure taxonomy (the W4 14-class table, contract-duplicated
 * from flauz-telemetry/src/failures.ts; pinned class-for-class by
 * test/contract.test.ts against the real module).
 */
export const FAILURE_CLASSES: readonly FailureClassDef[] = [
        {
                id: 'provider-unreachable',
                label: 'Provider unreachable',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['NETWORK_ERROR'],
                remediation: 'Check network egress from this machine and the provider endpoint reachability (DNS, proxy, TLS). The retry class is short-backoff: a later attempt may recover on its own; if the lane stays unreachable, switch the routing policy to a reachable lane.',
        },
        {
                id: 'provider-auth-rejected',
                label: 'Provider auth rejected',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['AUTH_FAILED', 'CREDENTIAL_UNRESOLVED'],
                remediation: 'Re-enter the provider credential through the Flauz vault (never a raw key in config), and check the key is active and scoped for the models this lane requests. Auth failures are terminal per request -- retrying identical bytes will not clear them.',
        },
        {
                id: 'provider-permission-denied',
                label: 'Provider permission denied',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['PERMISSION_DENIED'],
                remediation: 'The credential authenticates but is not entitled to this model/operation. Check the provider-side entitlements for the lane, or route the request to a lane whose credential covers it.',
        },
        {
                id: 'provider-not-found',
                label: 'Provider or model not found',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['NOT_FOUND'],
                remediation: 'The requested provider id or model id no longer resolves (renamed or removed upstream). Refresh the provider registry and update the routing policy to a live model id.',
        },
        {
                id: 'provider-lane-capacity',
                label: 'Provider lane capacity',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['RATE_LIMITED', 'PROVIDER_OVERLOADED'],
                remediation: 'The lane is rate-limited or overloaded. Honor the vendor Retry-After hint (long-backoff class), widen the retry window, or spread load across other enabled lanes via the routing policy.',
        },
        {
                id: 'model-timeout',
                label: 'Model timeout',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['TIMEOUT'],
                remediation: 'The call exceeded its timeout budget. Raise the request timeout for the lane, reduce the request size, or switch to a faster model on another lane.',
        },
        {
                id: 'model-request-rejected',
                label: 'Model request rejected',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['BAD_REQUEST', 'CONTEXT_OVERFLOW'],
                remediation: 'The provider rejected the request shape or size. For CONTEXT_OVERFLOW, reduce the context (trim history or split the task) or route to a model with a larger context window.',
        },
        {
                id: 'model-response-malformed',
                label: 'Model response malformed',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['MALFORMED_RESPONSE', 'PROTOCOL_ERROR'],
                remediation: 'The response violated the wire contract. These are terminal for the response they belong to -- capture the request id and check for a provider incident or an adapter version mismatch.',
        },
        {
                id: 'provider-call-cancelled',
                label: 'Provider call cancelled',
                surfaces: ['flauz-models', 'flauz-agent'],
                sourceCodes: ['CANCELLED'],
                remediation: 'The call was cancelled by intent (operator or orchestration). No remediation needed unless cancellations are unexpected: then check the cancellation provenance on the step.',
        },
        {
                id: 'environment-provider-incompatibility',
                label: 'Environment/provider incompatibility (no candidate)',
                surfaces: ['flauz-models'],
                sourceCodes: ['NO_CANDIDATE'],
                remediation: 'No provider lane satisfies the request requirements (capability, context window, locality, cost bound or enabled-only filters). Widen the routing policy match, enable a compatible lane, or relax the requirement that excluded every candidate.',
        },
        {
                id: 'environment-validation-failed',
                label: 'Environment validation failed',
                surfaces: ['flauz-environments'],
                sourceCodes: ['DESCRIPTOR_INVALID', 'STORE_CORRUPT'],
                remediation: 'The environment entry failed descriptor validation (shape drift) or the PIN-2 store failed re-validation. Fix the named registry fields; a corrupt store needs the flauz-backup restore path before the environment can run again.',
        },
        {
                id: 'environment-disabled',
                label: 'Environment disabled',
                surfaces: ['flauz-environments'],
                sourceCodes: ['ENVIRONMENT_DISABLED'],
                remediation: 'The environment is registered but not enabled. Enable it in the environments registry, or re-run against an enabled environment.',
        },
        {
                id: 'environment-unknown',
                label: 'Environment unknown',
                surfaces: ['flauz-environments'],
                sourceCodes: ['ENVIRONMENT_UNKNOWN'],
                remediation: 'The referenced environment id is not in the registry (renamed or removed). Re-register the environment or update the reference.',
        },
        {
                id: 'environment-trust-rejected',
                label: 'Environment trust rejected',
                surfaces: ['flauz-environments'],
                sourceCodes: ['TRUST_POSTURE_REJECTED'],
                remediation: 'The environment trust posture did not satisfy the operation. Raise the environment trust posture in the registry, or run the operation from a workspace posture it accepts.',
        },
];

/** The taxonomy class ids -- the telemetry errorCode dimension vocabulary. */
export const FAILURE_CLASS_IDS: readonly string[] = FAILURE_CLASSES.map(entry => entry.id);

/** The taxonomy closure check result. */
export interface TaxonomyClosure {
        readonly closed: boolean;
        readonly classCount: number;
        readonly sourceCodeCount: number;
        readonly problems: readonly string[];
}

/**
 * The taxonomy closure check (the checklist failure-typing row's semantics):
 * the taxonomy is LOADED and CLOSED when the class ids are unique, every
 * source code is claimed by exactly one class, the classes' source codes
 * cover the combined real vocabulary exactly, and every class carries its
 * label/surfaces/remediation (the operator-facing surface).
 */
export function taxonomyClosure(): TaxonomyClosure {
        const problems: string[] = [];
        const ids = new Set<string>();
        for (const entry of FAILURE_CLASSES) {
                if (ids.has(entry.id)) {
                        problems.push(`duplicate failure class id '${entry.id}'`);
                }
                ids.add(entry.id);
                if (entry.label.length === 0 || entry.remediation.length === 0 || entry.surfaces.length === 0 || entry.sourceCodes.length === 0) {
                        problems.push(`failure class '${entry.id}' is incomplete (label/surfaces/sourceCodes/remediation must all be non-empty)`);
                }
        }
        const claimed = new Map<string, string>();
        for (const entry of FAILURE_CLASSES) {
                for (const code of entry.sourceCodes) {
                        const owner = claimed.get(code);
                        if (owner !== undefined && owner !== entry.id) {
                                problems.push(`source code '${code}' is claimed by both '${owner}' and '${entry.id}' (every source code maps to exactly one class)`);
                        }
                        claimed.set(code, entry.id);
                }
        }
        for (const code of FAILURE_SOURCE_CODES) {
                if (!claimed.has(code)) {
                        problems.push(`source code '${code}' is typed by no failure class (the taxonomy must be surjective over the real vocabularies)`);
                }
        }
        return {
                closed: problems.length === 0,
                classCount: FAILURE_CLASSES.length,
                sourceCodeCount: FAILURE_SOURCE_CODES.length,
                problems,
        };
}
