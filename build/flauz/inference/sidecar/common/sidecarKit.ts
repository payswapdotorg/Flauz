/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-004 Free Inference Fabric contracts: the typed OPTIONAL
 * FreeLLMAPI-compatible sidecar kit - the deterministic
 * registration/reporting kit over the sidecar contract (register
 * through the fail-closed guard, list/find/count lookups, the
 * honest-default capacity reporting and the delegated provenance
 * derivation; kit module, the labContracts discipline; binds the
 * landed INF-001 semantics family's capacityDisclosure vocabulary
 * ONLY, per the INF-001 README binder note: 'the snapshot +
 * provenance vocabulary; the sidecar is replaceable technology,
 * never an authority').
 *
 * LAWS (FRESH-CHAT-TL-B-HANDOFF.md 'Free Inference Fabric';
 * WORK-REGISTRY.md 'TL-B - INF: Free Inference Fabric'; the INF-001
 * semantics family laws are INHERITED and binding here):
 * - THE INJECTED-CLOCK LAW (binding): this kit never reads a
 *   clock. Every timestamp - fixture registration, snapshot
 *   observation times, provenance recording times - comes from the
 *   single injected now() function. No Date.now, no Math.random, no
 *   process.env in this module (law comments excepted).
 * - THE DUPLICATE LAW (documented addition): registering a sidecar
 *   id the kit already carries is a typed rejection with the
 *   dedicated 'sidecar-id-duplicate' reason - ADDED to the frozen
 *   contract list as SIDECAR_KIT_REJECTION_REASONS (the contract
 *   guard's nine reasons verbatim, in order, plus this one). A
 *   duplicate never silently overwrites. The contract guard runs
 *   FIRST: a candidate that is both malformed and a duplicate
 *   reports the contract reason, never the duplicate.
 * - THE HONEST-DEFAULT LAW (binding): reportSnapshot with no
 *   attached state source returns the landed unknownSnapshot for
 *   the sidecar's provider - UNKNOWN first-class, never a
 *   fabricated healthy state. An unknown id returns undefined. An
 *   attached state source that returns a malformed snapshot, or a
 *   snapshot misattributed to another provider, fails closed with a
 *   TypeError - never a silent default.
 * - THE DELEGATED-PROVENANCE LAW (binding): provenanceOf derives
 *   the landed unverifiedProvenance (unverified by construction,
 *   no substitution - the sidecar serves exactly its provider).
 *   Promotion is ONLY the INF-001 markProvenanceVerified one-way
 *   law, exercised BY THE CALLER on the returned record - the kit
 *   deliberately exposes no promotion mutator (never an authority)
 *   and never re-implements the promotion.
 * - THE OPTIONAL and REPLACEABLE laws are inherited verbatim from
 *   the contract module: every kit record is optional:true and
 *   replaceable:true by construction, admitted through the same
 *   fail-closed guard (the fixture sidecars are ordinary records -
 *   no special-cased admission path exists).
 * - Fixtures are disclosed: the ready-made sidecars carry
 *   'fixture.'-prefixed ids, synthetic provider ids and
 *   deterministic state sources - evidence label 'fixture', never
 *   authority values.
 * - Canonical bytes: kit state serializes through the contract's
 *   serializeSidecarRecord (fixed key order, double-run
 *   byte-equal); every record carries contractVersion.
 * - Zero external dependencies: node: builtins, the contract
 *   module and the landed sibling capacityDisclosure.js only.
 */
import { admitSidecar, SIDECAR_REJECTION_REASONS } from './sidecarContract.js';
import type { SidecarRecord } from './sidecarContract.js';
import {
	isProviderCapacitySnapshot,
	unknownSnapshot,
	unverifiedProvenance,
} from '../../semantics/common/capacityDisclosure.js';
import type {
	InferenceProvenance,
	ProviderCapacitySnapshot,
} from '../../semantics/common/capacityDisclosure.js';

/**
 * The kit module's own re-declared copy of the sidecar contract-set
 * version (the COMMAND_FACADE idiom: declared independently of
 * sidecarContract.ts's copy, pinned equal by the test suite). The
 * fixture builders stamp their candidates with THIS copy; the
 * contract guard stamps admitted records with ITS copy - if the two
 * ever drift, every fixture registration fails closed at kit
 * creation with 'contract-version-mismatch'.
 */
export const INFERENCE_SIDECAR_VERSION = '1.0.0';

/**
 * The kit-level frozen rejection list: the contract guard's nine
 * reasons verbatim, in order, plus the kit's own documented addition
 * 'sidecar-id-duplicate' (THE DUPLICATE LAW). Widening beyond this
 * is a contract change requiring a version bump.
 */
export const SIDECAR_KIT_REJECTION_REASONS = [
	...SIDECAR_REJECTION_REASONS,
	'sidecar-id-duplicate',
] as const;
export type SidecarKitRejectionReason = (typeof SIDECAR_KIT_REJECTION_REASONS)[number];

/**
 * The kit-level admission: the contract's SidecarAdmitted carried
 * verbatim, with the rejection side widened to the kit's reason
 * vocabulary (the documented 'sidecar-id-duplicate' addition). Every
 * contract reason surfaces verbatim through register - cited, never
 * re-worded.
 */
export interface SidecarKitAdmitted {
	readonly kind: 'admitted';
	readonly record: SidecarRecord;
}

export interface SidecarKitRejected {
	readonly kind: 'rejected';
	readonly reason: SidecarKitRejectionReason;
}

export type SidecarKitAdmission = SidecarKitAdmitted | SidecarKitRejected;

/**
 * The injected clock: THE INJECTED-CLOCK LAW. The kit reads no other
 * time source; a now() that cannot produce an admittable
 * registration time fails kit creation closed (TypeError).
 */
export interface SidecarKitOptions {
	readonly now: () => number;
}

/**
 * An attached fixture-state source: a PURE function of the injected
 * probe time returning a ProviderCapacitySnapshot in the landed
 * vocabulary. Deterministic by law: same probe time, same snapshot.
 */
export type SidecarStateSource = (atEpochMs: number) => ProviderCapacitySnapshot;

/**
 * The deterministic sidecar kit: register through the fail-closed
 * contract guard (with the duplicate law), list/find/count lookups,
 * honest-default capacity reporting and the delegated provenance
 * derivation. Pure vocabulary over injected values: no network, no
 * process management, no sidecar binary, no FreeLLMAPI code - the
 * kit is replaceable technology, never an authority.
 */
export interface SidecarKit {
	register(candidate: unknown): SidecarKitAdmission;
	list(): readonly SidecarRecord[];
	find(sidecarId: string): SidecarRecord | undefined;
	count(): number;
	reportSnapshot(sidecarId: string): ProviderCapacitySnapshot | undefined;
	provenanceOf(sidecarId: string): InferenceProvenance | undefined;
	attachFixtureState(sidecarId: string, source: SidecarStateSource): boolean;
}

/**
 * The provenance scope label for the sidecar vocabulary: the sidecar
 * record is provider-scoped and carries no model ids, so the
 * provenance of a capacity REPORT names the report scope for the
 * model fields - a scope label, never a model claim.
 */
export const SIDECAR_CAPACITY_REPORT_SCOPE = 'sidecar.capacity-report';

/** The disclosed fixture sidecar ids (evidence label 'fixture'). */
export const FIXTURE_SIDECAR_KNOWN_QUOTA_ID = 'fixture.sidecar.known-quota';
export const FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID = 'fixture.sidecar.active-cooldown';
export const FIXTURE_SIDECAR_NO_STATE_ID = 'fixture.sidecar.no-state';

const FIXTURE_PROVIDER_ALPHA_ID = 'fixture.provider.alpha';
const FIXTURE_PROVIDER_BETA_ID = 'fixture.provider.beta';
const FIXTURE_PROVIDER_GAMMA_ID = 'fixture.provider.gamma';
const FIXTURE_KNOWN_QUOTA_REMAINING = 42;
const FIXTURE_KNOWN_QUOTA_LIMIT = 100;
const FIXTURE_QUOTA_WINDOW_HALF_MS = 600000;
const FIXTURE_QUOTA_WINDOW_LENGTH_MS = 1200000;
const FIXTURE_COOLDOWN_HALF_MS = 60000;
const FIXTURE_HOURLY_RESET_INTERVAL_MS = 3600000;

/**
 * Creates a sidecar kit on the injected clock (fail-closed factory:
 * a missing or non-function now is a TypeError, and the fixture
 * sidecars must admit through the contract guard - an unadmittable
 * clock read fails creation closed). The kit starts with the three
 * disclosed fixture sidecars, registered through the SAME admission
 * path as every other record at one shared creation-instant read of
 * now(); the known-quota and active-cooldown fixtures carry their
 * deterministic state sources, the no-state fixture deliberately
 * carries none (demonstrating the honest-default law).
 */
export function createSidecarKit(options: SidecarKitOptions): SidecarKit {
	if (!isRecord(options) || typeof (options as Record<string, unknown>).now !== 'function') {
		throw new TypeError(
			'createSidecarKit: options.now must be a function returning epoch-ms numbers (the injected-clock law - the kit never reads a clock itself)',
		);
	}
	const now = (options as SidecarKitOptions).now;
	const registered = new Map<string, SidecarRecord>();
	const stateSources = new Map<string, SidecarStateSource>();
	const kit: SidecarKit = {
		register(candidate: unknown): SidecarKitAdmission {
			const admission = admitSidecar(candidate);
			if (admission.kind === 'rejected') {
				// The contract guard runs first: every contract rejection
				// surfaces verbatim, even for a duplicate id.
				return admission;
			}
			const record = admission.record;
			if (registered.has(record.sidecarId)) {
				// THE DUPLICATE LAW: a repeat is a typed rejection - the kit
				// never silently overwrites.
				return { kind: 'rejected', reason: 'sidecar-id-duplicate' };
			}
			registered.set(record.sidecarId, record);
			return { kind: 'admitted', record };
		},
		list(): readonly SidecarRecord[] {
			return [...registered.values()].sort(compareSidecarIds);
		},
		find(sidecarId: string): SidecarRecord | undefined {
			return registered.get(sidecarId);
		},
		count(): number {
			return registered.size;
		},
		reportSnapshot(sidecarId: string): ProviderCapacitySnapshot | undefined {
			const record = registered.get(sidecarId);
			if (record === undefined) {
				return undefined;
			}
			const source = stateSources.get(sidecarId);
			if (source === undefined) {
				// THE HONEST-DEFAULT LAW: no attached state source - the
				// landed unknownSnapshot, never a fabricated healthy state.
				return unknownSnapshot(record.providerId, now());
			}
			const snapshot = source(now());
			if (!isProviderCapacitySnapshot(snapshot)) {
				throw new TypeError(
					'reportSnapshot: the attached state source must return a ProviderCapacitySnapshot satisfying the landed vocabulary - never a silent default',
				);
			}
			if (snapshot.providerId !== record.providerId) {
				// NO DANGLING ATTRIBUTION: a capacity report may never be
				// misattributed - the snapshot names the sidecar's provider.
				throw new TypeError(
					`reportSnapshot: the attached snapshot names provider '${snapshot.providerId}' but the sidecar serves '${record.providerId}' - a capacity report may never be misattributed`,
				);
			}
			return snapshot;
		},
		provenanceOf(sidecarId: string): InferenceProvenance | undefined {
			const record = registered.get(sidecarId);
			if (record === undefined) {
				return undefined;
			}
			// THE DELEGATED-PROVENANCE LAW: the landed unverifiedProvenance
			// constructor - unverified by construction, no substitution (the
			// sidecar serves exactly its provider), the injected clock for
			// the recording time. Promotion is the caller's one-way
			// markProvenanceVerified copy; the kit never self-promotes.
			return unverifiedProvenance({
				requestedProviderId: record.providerId,
				requestedModelId: SIDECAR_CAPACITY_REPORT_SCOPE,
				actualProviderId: record.providerId,
				actualModelId: SIDECAR_CAPACITY_REPORT_SCOPE,
				recordedAtEpochMs: now(),
			});
		},
		attachFixtureState(sidecarId: string, source: SidecarStateSource): boolean {
			if (typeof source !== 'function') {
				throw new TypeError(
					'attachFixtureState: source must be a function of the injected probe time (atEpochMs) returning a ProviderCapacitySnapshot',
				);
			}
			if (!registered.has(sidecarId)) {
				return false;
			}
			// A later attachment replaces an earlier one (last attach wins).
			stateSources.set(sidecarId, source);
			return true;
		},
	};
	const fixtureRegisteredAtEpochMs = now();
	for (const candidate of fixtureSidecarCandidates(fixtureRegisteredAtEpochMs)) {
		const admission = kit.register(candidate);
		if (admission.kind === 'rejected') {
			throw new TypeError(
				`createSidecarKit: the fixture sidecars must admit through the contract guard (the injected clock must return finite epoch-ms numbers >= 0): '${admission.reason}'`,
			);
		}
	}
	attachOrFail(kit, FIXTURE_SIDECAR_KNOWN_QUOTA_ID, fixtureKnownQuotaState);
	attachOrFail(kit, FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID, fixtureActiveCooldownState);
	return kit;
}

function attachOrFail(kit: SidecarKit, sidecarId: string, source: SidecarStateSource): void {
	if (!kit.attachFixtureState(sidecarId, source)) {
		throw new TypeError(
			`createSidecarKit: the fixture sidecar '${sidecarId}' must be registered before its state source attaches`,
		);
	}
}

function compareSidecarIds(left: SidecarRecord, right: SidecarRecord): number {
	if (left.sidecarId < right.sidecarId) {
		return -1;
	}
	return left.sidecarId > right.sidecarId ? 1 : 0;
}

/**
 * The three disclosed fixture candidates: freellmapi-compatible,
 * optional, replaceable, unverified metadata (the honest default),
 * registered at one shared injected creation instant. The kit's own
 * INFERENCE_SIDECAR_VERSION copy stamps the candidates.
 */
function fixtureSidecarCandidates(registeredAtEpochMs: number): unknown[] {
	return [
		{
			sidecarId: FIXTURE_SIDECAR_KNOWN_QUOTA_ID,
			providerId: FIXTURE_PROVIDER_ALPHA_ID,
			interfaceProfile: 'freellmapi-compatible',
			optional: true,
			replaceable: true,
			metadataVerification: 'unverified',
			registeredAtEpochMs,
			contractVersion: INFERENCE_SIDECAR_VERSION,
		},
		{
			sidecarId: FIXTURE_SIDECAR_ACTIVE_COOLDOWN_ID,
			providerId: FIXTURE_PROVIDER_BETA_ID,
			interfaceProfile: 'freellmapi-compatible',
			optional: true,
			replaceable: true,
			metadataVerification: 'unverified',
			registeredAtEpochMs,
			contractVersion: INFERENCE_SIDECAR_VERSION,
		},
		{
			sidecarId: FIXTURE_SIDECAR_NO_STATE_ID,
			providerId: FIXTURE_PROVIDER_GAMMA_ID,
			interfaceProfile: 'freellmapi-compatible',
			optional: true,
			replaceable: true,
			metadataVerification: 'unverified',
			registeredAtEpochMs,
			contractVersion: INFERENCE_SIDECAR_VERSION,
		},
	];
}

/**
 * The known-quota fixture state: deterministic in the injected probe
 * time - healthy with a known quota (42 of 100 inside a rolling
 * window centered on the probe, boundaries inclusive through the
 * landed math) and an interval-aligned hourly reset from the epoch
 * anchor. Rides the landed unknownSnapshot base so every field it
 * does not override stays honestly defaulted.
 */
function fixtureKnownQuotaState(atEpochMs: number): ProviderCapacitySnapshot {
	return {
		...unknownSnapshot(FIXTURE_PROVIDER_ALPHA_ID, atEpochMs),
		health: 'healthy',
		quota: {
			state: 'known',
			remaining: FIXTURE_KNOWN_QUOTA_REMAINING,
			limit: FIXTURE_KNOWN_QUOTA_LIMIT,
			window: {
				kind: 'rolling',
				windowStartEpochMs: atEpochMs - FIXTURE_QUOTA_WINDOW_HALF_MS,
				windowLengthMs: FIXTURE_QUOTA_WINDOW_LENGTH_MS,
			},
		},
		resetSchedule: {
			kind: 'interval-aligned',
			anchorEpochMs: 0,
			intervalMs: FIXTURE_HOURLY_RESET_INTERVAL_MS,
		},
	};
}

/**
 * The active-cooldown fixture state: deterministic in the injected
 * probe time - cooldown health with an active 'rate-limited' cooldown
 * bracketing the probe (inclusive through the landed math); the
 * quota stays honestly unknown (the base default).
 */
function fixtureActiveCooldownState(atEpochMs: number): ProviderCapacitySnapshot {
	return {
		...unknownSnapshot(FIXTURE_PROVIDER_BETA_ID, atEpochMs),
		health: 'cooldown',
		cooldown: {
			state: 'active',
			reason: 'rate-limited',
			sinceEpochMs: atEpochMs - FIXTURE_COOLDOWN_HALF_MS,
			untilEpochMs: atEpochMs + FIXTURE_COOLDOWN_HALF_MS,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
