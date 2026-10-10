/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-004 Free Inference Fabric contracts: the typed OPTIONAL
 * FreeLLMAPI-compatible sidecar contract - the closed vocabulary for
 * what a local sidecar IS and MAY claim, the fail-closed admission
 * guard and the canonical fixed-key-order serialization (contract
 * module, the labContracts discipline; binds the landed INF-001
 * semantics family's capacityDisclosure vocabulary ONLY, per the
 * INF-001 README binder note: 'the snapshot + provenance vocabulary;
 * the sidecar is replaceable technology, never an authority').
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the INF-001
 * semantics family laws are INHERITED and binding here):
 * - THE MASTER SAFETY LAW (binding, verbatim from the roadmap): 'Use
 *   the tactics demonstrated by tashfeenahmed/freellmapi as a
 *   reference/optional integration path... FreeLLMAPI is
 *   reference/optional adapter technology, not an authority or
 *   required dependency.' This family enforces that law IN THE
 *   TYPES: the sidecar is optional, replaceable and never an
 *   authority - nothing in Flauz may ever require it, and its
 *   claims never outweigh Flauz's own honest-promise vocabulary.
 * - THE OPTIONAL LAW (binding): the sidecar is never a required
 *   dependency. 'optional: true' is the ONLY representable value of
 *   SidecarRecord - a record claiming optional:false is
 *   unrepresentable in the types AND rejected by the admission
 *   guard with the dedicated 'sidecar-not-optional' reason (the
 *   required-dependency lie, banned).
 * - THE REPLACEABLE LAW (binding): the sidecar is replaceable
 *   technology, never an authority. 'replaceable: true' is the ONLY
 *   representable value; a record claiming replaceable:false is
 *   unrepresentable AND rejected with the dedicated
 *   'sidecar-not-replaceable' reason (the authority lie, banned). No
 *   sidecar record carries authority semantics; its claims route
 *   THROUGH the landed INF-001 disclosure vocabulary, never around
 *   it.
 * - THE INJECTED-CLOCK LAW (binding): this contract never reads a
 *   clock. registeredAtEpochMs is a caller-injected finite epoch-ms
 *   number >= 0. No Date.now, no Math.random, no process.env in
 *   this module (law comments excepted).
 * - Fail-closed admission: admitSidecar checks every field in the
 *   frozen SIDECAR_REJECTION_REASONS order; the FIRST failure is
 *   the verdict, and every rejection names its reason.
 * - THE HONEST-DEFAULT LAW is delegated: metadataVerification rides
 *   the landed PROVIDER_METADATA_VERIFICATIONS vocabulary verbatim
 *   ('unverified' is the default; 'verified' only through the
 *   landed one-way promotion) - bound by relative import, never
 *   re-implemented, never widened here.
 * - Canonical bytes: serializeSidecarRecord emits fixed-key-order
 *   deterministic bytes (double-run byte-equal); every record
 *   carries contractVersion.
 * - Zero external dependencies: node: builtins and the landed
 *   sibling capacityDisclosure.js only.
 */
import { PROVIDER_METADATA_VERIFICATIONS } from '../../semantics/common/capacityDisclosure.js';
import type { ProviderMetadataVerification } from '../../semantics/common/capacityDisclosure.js';

/**
 * Version of the inference-sidecar contract set (all modules carry
 * it; the sibling sidecarKit module re-declares the same value and
 * the test suite pins both copies equal - the COMMAND_FACADE
 * zero-dependency idiom).
 */
export const INFERENCE_SIDECAR_VERSION = '1.0.0';

/**
 * The closed frozen interface-profile vocabulary: the minimal honest
 * set today - ONE profile, the reference shape demonstrated by
 * tashfeenahmed/freellmapi (a compatibility SHAPE, never a package
 * name, never a dependency, never an endpoint). Widening the set
 * (new profiles) is a separately versioned contract decision, never
 * a silent addition.
 */
export const SIDECAR_INTERFACE_PROFILES = ['freellmapi-compatible'] as const;
export type SidecarInterfaceProfile = (typeof SIDECAR_INTERFACE_PROFILES)[number];

/**
 * The typed sidecar record: what a FreeLLMAPI-compatible local
 * sidecar IS and MAY claim. optional and replaceable are LITERAL
 * true (the optional law, the replaceable law - the lies are
 * unrepresentable in the types and rejected at the runtime
 * boundary). metadataVerification rides the landed INF-001
 * vocabulary verbatim. registeredAtEpochMs is an injected finite
 * epoch-ms number >= 0 (the injected-clock law). Carries the sidecar
 * contract-set version stamp.
 */
export interface SidecarRecord {
	readonly sidecarId: string;
	readonly providerId: string;
	readonly interfaceProfile: SidecarInterfaceProfile;
	readonly optional: true;
	readonly replaceable: true;
	readonly metadataVerification: ProviderMetadataVerification;
	readonly registeredAtEpochMs: number;
	readonly contractVersion: string;
}

/**
 * Closed frozen list of admission rejection reasons, in the exact
 * check order: the guard walks this list top to bottom and the
 * FIRST failure is the verdict.
 */
export const SIDECAR_REJECTION_REASONS = [
	'not-an-object',
	'sidecar-id-empty',
	'provider-id-empty',
	'interface-profile-unknown',
	'sidecar-not-optional',
	'sidecar-not-replaceable',
	'metadata-verification-unknown',
	'registered-at-malformed',
	'contract-version-mismatch',
] as const;
export type SidecarRejectionReason = (typeof SIDECAR_REJECTION_REASONS)[number];

export interface SidecarAdmitted {
	readonly kind: 'admitted';
	readonly record: SidecarRecord;
}

export interface SidecarRejected {
	readonly kind: 'rejected';
	readonly reason: SidecarRejectionReason;
}

export type SidecarAdmission = SidecarAdmitted | SidecarRejected;

/**
 * Pure fail-closed admission guard: admits only records with
 * non-empty string sidecar/provider ids, an interfaceProfile drawn
 * from the closed SIDECAR_INTERFACE_PROFILES vocabulary, the
 * LITERAL true optional and replaceable flags (the required-
 * dependency lie and the authority lie are typed rejections), a
 * metadataVerification drawn from the landed
 * PROVIDER_METADATA_VERIFICATIONS vocabulary, an injected finite
 * epoch-ms registeredAtEpochMs >= 0, and the exact contract version.
 * Check order = the SIDECAR_REJECTION_REASONS list order; the FIRST
 * failure is the verdict. Deterministic: same candidate, same
 * verdict, same reason. Never mutates its input; never reads a
 * clock.
 */
export function admitSidecar(candidate: unknown): SidecarAdmission {
	if (!isRecord(candidate)) {
		return { kind: 'rejected', reason: 'not-an-object' };
	}
	const record = candidate as Record<string, unknown>;
	const sidecarId = record.sidecarId;
	if (!isNonEmptyString(sidecarId)) {
		return { kind: 'rejected', reason: 'sidecar-id-empty' };
	}
	const providerId = record.providerId;
	if (!isNonEmptyString(providerId)) {
		return { kind: 'rejected', reason: 'provider-id-empty' };
	}
	const interfaceProfile = record.interfaceProfile;
	if (!isSidecarInterfaceProfile(interfaceProfile)) {
		return { kind: 'rejected', reason: 'interface-profile-unknown' };
	}
	if (record.optional !== true) {
		// THE OPTIONAL LAW: optional !== true (false, absent, the string
		// 'true', anything) is the required-dependency lie - banned.
		return { kind: 'rejected', reason: 'sidecar-not-optional' };
	}
	if (record.replaceable !== true) {
		// THE REPLACEABLE LAW: replaceable !== true is the authority lie -
		// banned; the sidecar is never an authority.
		return { kind: 'rejected', reason: 'sidecar-not-replaceable' };
	}
	const metadataVerification = record.metadataVerification;
	if (!isProviderMetadataVerification(metadataVerification)) {
		return { kind: 'rejected', reason: 'metadata-verification-unknown' };
	}
	const registeredAtEpochMs = record.registeredAtEpochMs;
	if (!isRegisteredAtEpochMs(registeredAtEpochMs)) {
		return { kind: 'rejected', reason: 'registered-at-malformed' };
	}
	if (record.contractVersion !== INFERENCE_SIDECAR_VERSION) {
		return { kind: 'rejected', reason: 'contract-version-mismatch' };
	}
	return {
		kind: 'admitted',
		record: {
			sidecarId,
			providerId,
			interfaceProfile,
			optional: true,
			replaceable: true,
			metadataVerification,
			registeredAtEpochMs,
			contractVersion: INFERENCE_SIDECAR_VERSION,
		},
	};
}

/** Pure shape predicate: an admitted, well-formed sidecar record. */
export function isSidecarRecord(value: unknown): value is SidecarRecord {
	return admitSidecar(value).kind === 'admitted';
}

/**
 * Canonical serialization of a sidecar record: fixed key order (the
 * interface declaration order), deterministic bytes regardless of
 * the input record's key insertion order. Refuses non-admitted
 * records fail-closed (TypeError) - no dishonest sidecar record
 * ever gets canonical bytes. This canonical form is the
 * persistence/audit shape for the INF-005..009 binders.
 */
export function serializeSidecarRecord(record: SidecarRecord): string {
	if (!isSidecarRecord(record)) {
		throw new TypeError(
			'serializeSidecarRecord: record must satisfy isSidecarRecord - no dishonest sidecar record ever gets canonical bytes',
		);
	}
	return JSON.stringify({
		sidecarId: record.sidecarId,
		providerId: record.providerId,
		interfaceProfile: record.interfaceProfile,
		optional: record.optional,
		replaceable: record.replaceable,
		metadataVerification: record.metadataVerification,
		registeredAtEpochMs: record.registeredAtEpochMs,
		contractVersion: record.contractVersion,
	});
}

function isSidecarInterfaceProfile(value: unknown): value is SidecarInterfaceProfile {
	return (SIDECAR_INTERFACE_PROFILES as readonly string[]).includes(value as string);
}

/**
 * The landed provider-metadata verification membership check, riding
 * the imported PROVIDER_METADATA_VERIFICATIONS list verbatim - never
 * a re-implementation.
 */
function isProviderMetadataVerification(value: unknown): value is ProviderMetadataVerification {
	return (PROVIDER_METADATA_VERIFICATIONS as readonly string[]).includes(value as string);
}

/** Injected registration time: a finite epoch-ms number >= 0. */
function isRegisteredAtEpochMs(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
