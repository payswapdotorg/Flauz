/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The typed failure taxonomy for provider/environment failures
 * (A-PROD-004-W4) -- the UX half of this wave.
 *
 * THE TAXONOMY LAW: every failure mode the prior waves' surfaces can produce
 * gets a TYPED failure record with (a) the failure class, (b) the exact
 * surface + provider/environment identity, (c) the operator-facing
 * remediation hint, and (d) the telemetry dimension it maps to. Failures
 * become FIRST-CLASS queryable state (flauz.failures.list), not scattered
 * logs.
 *
 * The taxonomy is derived from the REAL owning vocabularies (read-only
 * survey; contract-duplicated here, pinned by test/contract.test.ts against
 * the owning modules):
 *
 *   - flauz-models `ProviderErrorCode` (src/contract/errors.ts, 14 codes,
 *     each with its fixed retry posture) -- the provider-call failure modes;
 *   - flauz-environments `LIFECYCLE_ERROR_CODES` (src/lifecycle/types.ts)
 *     -- the environment validation failure modes;
 *   - the routing layer's `no-candidate` selection basis -- the
 *     environment/provider incompatibility (no lane satisfies the request's
 *     requirements).
 *
 * SURFACE LAW: the provider-call classes type on BOTH the flauz-models
 * surface (where the call-time failures originate) and the flauz-agent
 * surface (whose orchestration journal's provider-retry rows are the DURABLE
 * failure records, carrying the full DL-35 code vocabulary); the
 * environment classes type on the flauz-environments surface (the registry
 * state and its lifecycle validation).
 *
 * Every source code maps to EXACTLY ONE taxonomy class (surjective by
 * construction: a code this table cannot type is a programming error caught
 * by the closure test, and a failure mode found on another extension's
 * surface that the taxonomy cannot type is RESIDUE -- reported to the TL for
 * a later wave, never improvised here).
 */

import type { SurfaceId } from './schema.ts';

// ---------------------------------------------------------------------------
// The source vocabularies (contract-duplicated, read-only)
// ---------------------------------------------------------------------------

/**
 * The flauz-models provider error codes (contract-duplicated from
 * extensions/flauz-models/src/contract/errors.ts -- the typed ProviderError
 * taxonomy every adapter maps vendor failures onto).
 */
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

/**
 * The environment-side source codes this taxonomy types: the
 * flauz-environments lifecycle validation codes (contract-duplicated from
 * LIFECYCLE_ERROR_CODES -- only the validation-shaped subset is typed here;
 * the orchestration-shaped codes, actor/OP machinery, are not
 * provider/environment failure modes) plus the registry's descriptor-level
 * validation failure (an entry that fails validateDescriptor).
 */
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

// ---------------------------------------------------------------------------
// The taxonomy
// ---------------------------------------------------------------------------

/** One typed failure class. */
export interface FailureClassDef {
        /** The class id -- ALSO the telemetry errorCode dimension value (the closed vocabulary). */
        readonly id: string;
        /** The human label (rendered in the failure census). */
        readonly label: string;
        /** The surfaces whose failure modes this class types. */
        readonly surfaces: readonly SurfaceId[];
        /** The REAL owning source codes this class types (surjective: every source code maps to exactly one class). */
        readonly sourceCodes: readonly FailureSourceCode[];
        /** The operator-facing remediation hint. */
        readonly remediation: string;
}

/**
 * The typed failure taxonomy. The six classes the beta gate names verbatim --
 * provider unreachable, provider auth rejected, environment validation
 * failed, provider lane capacity, model timeout, the environment/provider
 * incompatibility -- are all present; the remaining classes type the REST of
 * the real vocabularies honestly (every ProviderErrorCode and every
 * environment validation code is typed).
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

/** The taxonomy class ids -- the telemetry errorCode dimension vocabulary (schema.ts consumes this). */
export const FAILURE_CLASS_IDS: readonly string[] = FAILURE_CLASSES.map(entry => entry.id);
export type FailureClassId = string & { readonly __brand: 'FailureClassId' };

/** The class-definition lookup by id. */
const CLASS_BY_ID = new Map<string, FailureClassDef>(FAILURE_CLASSES.map(entry => [entry.id, entry]));

/** The source-code -> class map (surjective by construction; closure pinned by tests). */
const CLASS_BY_SOURCE_CODE = new Map<FailureSourceCode, FailureClassDef>();
for (const entry of FAILURE_CLASSES) {
        for (const code of entry.sourceCodes) {
                const existing = CLASS_BY_SOURCE_CODE.get(code);
                if (existing !== undefined && existing.id !== entry.id) {
                        throw new Error(`flauz.telemetry/v1: taxonomy construction error -- source code '${code}' is claimed by both '${existing.id}' and '${entry.id}' (every source code maps to exactly one class)`);
                }
                CLASS_BY_SOURCE_CODE.set(code, entry);
        }
}

// ---------------------------------------------------------------------------
// The typed failure record
// ---------------------------------------------------------------------------

/** The subject identity of a typed failure record (ids only -- the metadata allowlist). */
export interface FailureIdentity {
        readonly providerId?: string;
        readonly environmentId?: string;
        readonly graphId?: string;
        readonly workflowId?: string;
}

/**
 * One TYPED failure record: the failure class, the exact surface + identity,
 * the remediation hint and the telemetry dimension it maps to. This is the
 * in-memory shape the observers produce and the failure census renders; the
 * durable telemetry form is the aggregate ledger row (eventKind 'failure',
 * errorCode = the class id -- never the free-form text).
 */
export interface TypedFailureRecord {
        readonly failureClass: string;
        readonly surface: SurfaceId;
        readonly identity: FailureIdentity;
        readonly remediation: string;
        /** The telemetry dimension mapping (the declared dimension this failure records under). */
        readonly telemetryDimension: {
                readonly eventKind: 'failure';
                readonly errorCode: string;
        };
}

/**
 * Types one observed failure into the taxonomy. Unknown codes are a typed
 * refusal (never improvised): a failure mode the taxonomy cannot type is a
 * programming error on the observing surface or RESIDUE for a later wave --
 * both surface loudly, neither is silently bucketed.
 */
export function classifyFailure(source: {
        readonly code: string;
        readonly surface: SurfaceId;
        readonly identity?: FailureIdentity;
}): TypedFailureRecord {
        const entry = CLASS_BY_SOURCE_CODE.get(source.code as FailureSourceCode);
        if (entry === undefined) {
                throw new Error(
                        `flauz.telemetry/v1: the failure taxonomy cannot type source code '${source.code}' observed on surface '${source.surface}' -- this is residue for a later wave (report it; never improvise a class here)`,
                );
        }
        if (!entry.surfaces.includes(source.surface)) {
                throw new Error(
                        `flauz.telemetry/v1: source code '${source.code}' was observed on surface '${source.surface}' but its class '${entry.id}' types surfaces [${entry.surfaces.join(', ')}] -- a cross-surface leak or residue; report it`,
                );
        }
        return {
                failureClass: entry.id,
                surface: source.surface,
                identity: source.identity ?? {},
                remediation: entry.remediation,
                telemetryDimension: { eventKind: 'failure', errorCode: entry.id },
        };
}

/** The class definition by id (undefined when the id is not a taxonomy class). */
export function failureClassOf(id: string): FailureClassDef | undefined {
        return CLASS_BY_ID.get(id);
}

/** The class definition a source code maps to (undefined when untyped -- residue). */
export function failureClassForCode(code: string): FailureClassDef | undefined {
        return CLASS_BY_SOURCE_CODE.get(code as FailureSourceCode);
}

/** Every source code the taxonomy types (the closure surface for the tests). */
export function typedSourceCodes(): readonly string[] {
        return [...CLASS_BY_SOURCE_CODE.keys()].sort();
}
