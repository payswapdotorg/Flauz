/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-008 agent-native command facade contracts: safe local mirrors and
 * caches (contract module, the labContracts discipline).
 *
 * LAWS (ARCHITECTURE-LOCK.md 5, 10.2, 11; MASTER-ROADMAP.md Phase C):
 * - Bounded optimizations only: this module declares types, constants,
 *   pure guards and transition maps over the EXISTING Resource
 *   authority. It declares no cache engine, no storage, no mirror
 *   runtime. Mirrors exist only as bounded optimizations that preserve
 *   provenance and side-effect visibility.
 * - THE SAFE-MIRROR LAW: mirrors are READ-ONLY projections of authority
 *   resource surfaces. The mirrorable-surface table is frozen and
 *   closed; write-shaped or approval-shaped surfaces never mirror.
 * - Determinism: no Math.random, no Date.now, no new Date( ... ) calls
 *   in this module. Timestamps are plain ISO-8601 strings; clock deltas
 *   are injected by callers.
 * - Zero-dependency: this module pulls in nothing from other modules.
 *   Shapes shared with sibling contract modules are re-declared here and
 *   pinned structurally by the test suite.
 * - Every persisted record carries scope (FacadeScope), contractVersion
 *   and plain-string ISO timestamps.
 */

/** Version of the command-facade contract set (all modules carry it). */
export const COMMAND_FACADE_CONTRACTS_VERSION = '1.0.0';

/**
 * Freshness windows, exported as plain-number constants (the order fixes
 * the law, not the numbers; these are contract decisions and changing
 * them is a contract change requiring a version bump):
 * - MIRROR_FRESH_WINDOW_MS: age at or below which a mirror is 'fresh'.
 * - MIRROR_STALE_WINDOW_MS: age at or below which an unfresh mirror is
 *   'stale' (re-route to a direct read, disclosed); beyond it, expired.
 */
export const MIRROR_FRESH_WINDOW_MS = 60_000;
export const MIRROR_STALE_WINDOW_MS = 300_000;

/** Closed verdict vocabulary for mirror freshness. */
export const MIRROR_VERDICTS = ['fresh', 'stale', 'expired'] as const;
export type MirrorVerdict = (typeof MIRROR_VERDICTS)[number];

/** Isolation scope stamped on every persisted record. */
export interface FacadeScope {
	readonly workspaceId: string;
	readonly tenantId: string;
}

/** Pure guard: a scope with non-empty workspace and tenant ids. */
export function isFacadeScope(value: unknown): value is FacadeScope {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const scope = value as { workspaceId?: unknown; tenantId?: unknown };
	return isNonEmptyString(scope.workspaceId) && isNonEmptyString(scope.tenantId);
}

/** Authority surface reference (the resource surface a mirror projects). */
export interface AuthoritySurfaceRef {
	readonly surfaceKind: string;
	readonly resourceId: string;
}

/** Pure guard: a surface reference with non-empty kind and resource id. */
export function isAuthoritySurfaceRef(value: unknown): value is AuthoritySurfaceRef {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const ref = value as { surfaceKind?: unknown; resourceId?: unknown };
	return isNonEmptyString(ref.surfaceKind) && isNonEmptyString(ref.resourceId);
}

/** Freshness policy: two injected plain-number thresholds. */
export interface FreshnessPolicy {
	/** Age at or below this many milliseconds: 'fresh'. */
	readonly maxAgeMs: number;
	/** Age above maxAgeMs but at or below this: 'stale'; above: 'expired'. */
	readonly staleMaxAgeMs: number;
}

/** Default policy, frozen, built from the exported window constants. */
export const DEFAULT_FRESHNESS_POLICY: Readonly<FreshnessPolicy> = Object.freeze({
	maxAgeMs: MIRROR_FRESH_WINDOW_MS,
	staleMaxAgeMs: MIRROR_STALE_WINDOW_MS,
});

/** Pure guard: finite, non-negative, integral thresholds, stale at least fresh. */
export function isFreshnessPolicy(value: unknown): value is FreshnessPolicy {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const policy = value as { maxAgeMs?: unknown; staleMaxAgeMs?: unknown };
	if (typeof policy.maxAgeMs !== 'number' || typeof policy.staleMaxAgeMs !== 'number') {
		return false;
	}
	if (!Number.isInteger(policy.maxAgeMs) || !Number.isInteger(policy.staleMaxAgeMs)) {
		return false;
	}
	if (policy.maxAgeMs < 0 || policy.staleMaxAgeMs < 0) {
		return false;
	}
	return policy.staleMaxAgeMs >= policy.maxAgeMs;
}

/** One entry of the frozen mirrorable-surface table. */
export interface MirrorableSurfaceEntry {
	/** READ-ONLY resource surface kind, spelled as the Resource authority spells it. */
	readonly surfaceKind: string;
}

/**
 * SEAM(MIRRORABLE_SURFACES) - repo-side transcription required.
 *
 * The frozen mirrorable-surface table ships EMPTY by design. Before the
 * gates are run, transcribe the Resource authority into it:
 *
 *   Source of kinds: extensions/flauz-execution/src/contracts.ts - the
 *   READ-ONLY resource surfaces of the Resource authority
 *   (ExecutionResourceRef read projections, e.g. task state and task
 *   log read surfaces).
 *   Cross-check: extensions/flauz-isolation/ - confirm every candidate
 *   kind names a surface observable read-only within exactly one
 *   workspace boundary (that is what 'local' means for mirrors here).
 *   Instruction: one MirrorableSurfaceEntry per read-only resource
 *   surface kind; surfaceKind spelled EXACTLY as the authority spells
 *   it; include ONLY read-projection surfaces - a write-shaped or
 *   approval-shaped surface kind must NEVER be entered. Do not invent,
 *   rename, merge or omit authority kinds.
 *   Sibling copy: transcribe the IDENTICAL entries into
 *   FROZEN_MIRRORABLE_SURFACES in
 *   build/flauz/capabilities/commands/common/facade.ts; the facade test
 *   suite pins both copies deep-equal.
 *
 * Until the seam is transcribed, canMirror fails closed: no surface
 * resolves and every surfaceRef is rejected 'surface-not-mirrorable'.
 */
export const FROZEN_MIRRORABLE_SURFACES: readonly MirrorableSurfaceEntry[] = Object.freeze([
	// SEAM(MIRRORABLE_SURFACES): CLOSED 2026-10-05 — transcribed from the
	// Resource authority (extensions/flauz-execution/src/contracts.ts
	// RESOURCE_KINDS), cross-checked against flauz-isolation: the
	// workspace-scoped record kinds whose surfaces are pure read
	// projections (task state + task log reads — the seam's own example;
	// immutable artifacts; the per-workspace evidence ledger rows;
	// workflow run-state reads). Excluded by the read-only law: file,
	// directory, agent-session, browser-session, environment, workspace
	// (write-shaped content surfaces, live control surfaces, exec
	// surfaces, the boundary container itself).
	{ surfaceKind: 'task' },
	{ surfaceKind: 'artifact' },
	{ surfaceKind: 'evidence' },
	{ surfaceKind: 'workflow' },
]);

/** Closed list of mirror-admission rejection reasons. */
export const MIRROR_REJECTION_REASONS = ['invalid-surface-ref', 'surface-not-mirrorable'] as const;
export type MirrorRejectionReason = (typeof MIRROR_REJECTION_REASONS)[number];

/** A local mirror: a read-only projection of one authority surface. */
export interface LocalMirror {
	readonly scope: FacadeScope;
	readonly contractVersion: string;
	readonly mirrorId: string;
	/** The READ-ONLY authority surface this mirror projects. */
	readonly surfaceRef: AuthoritySurfaceRef;
	/** Opaque digest of the mirrored content (authority digest format). */
	readonly contentDigest: string;
	/** Size of the mirrored content in bytes. */
	readonly byteSize: number;
	/** ISO-8601 plain-string mirroring timestamp. */
	readonly mirroredAtIso: string;
	readonly freshnessPolicy: FreshnessPolicy;
}

/** Pure guard: a well-formed local mirror record. */
export function isLocalMirror(value: unknown): value is LocalMirror {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const mirror = value as Record<string, unknown>;
	if (!isFacadeScope(mirror.scope)) {
		return false;
	}
	if (mirror.contractVersion !== COMMAND_FACADE_CONTRACTS_VERSION) {
		return false;
	}
	if (!isNonEmptyString(mirror.mirrorId)) {
		return false;
	}
	if (!isAuthoritySurfaceRef(mirror.surfaceRef)) {
		return false;
	}
	if (!isNonEmptyString(mirror.contentDigest)) {
		return false;
	}
	if (typeof mirror.byteSize !== 'number' || !Number.isInteger(mirror.byteSize) || mirror.byteSize < 0) {
		return false;
	}
	if (!isNonEmptyString(mirror.mirroredAtIso)) {
		return false;
	}
	return isFreshnessPolicy(mirror.freshnessPolicy);
}

export interface MirrorableSurface {
	readonly mirrorable: true;
	readonly surfaceKind: string;
}

/** Typed rejection: closed reason, detail names the violation. */
export interface UnmirrorableSurface {
	readonly mirrorable: false;
	readonly reason: MirrorRejectionReason;
	readonly detail: string;
}

export type MirrorAdmission = MirrorableSurface | UnmirrorableSurface;

/**
 * Pure admission guard for mirroring a surface. A surface is mirrorable
 * iff its surfaceKind resolves in the frozen mirrorable-surface table
 * (read-only resource surfaces only). A write-shaped or
 * approval-shaped surface does not resolve and is rejected with the
 * violation named. The table defaults to FROZEN_MIRRORABLE_SURFACES;
 * callers and tests may inject their own read-only table. The guard
 * never mutates its inputs.
 */
export function canMirror(
	surfaceRef: AuthoritySurfaceRef,
	mirrorableSurfaces: readonly MirrorableSurfaceEntry[] = FROZEN_MIRRORABLE_SURFACES,
): MirrorAdmission {
	if (!isAuthoritySurfaceRef(surfaceRef)) {
		return rejectMirror(
			'invalid-surface-ref',
			'surfaceRef must carry non-empty surfaceKind and resourceId',
		);
	}
	for (const entry of mirrorableSurfaces) {
		if (entry.surfaceKind === surfaceRef.surfaceKind) {
			return { mirrorable: true, surfaceKind: entry.surfaceKind };
		}
	}
	return rejectMirror(
		'surface-not-mirrorable',
		`surfaceKind '${surfaceRef.surfaceKind}' does not resolve in the frozen mirrorable-surface table; mirrors are READ-ONLY projections of resource surfaces - write-shaped or approval-shaped surfaces never mirror (safe-mirror law)`,
	);
}

/**
 * Pure freshness verdict. clockDeltaMs is the INJECTED age of the mirror
 * in milliseconds (callers compute now minus mirroredAtIso; this module
 * never reads a clock). Boundary semantics are inclusive:
 *   delta <= maxAgeMs                -> 'fresh'
 *   delta <= staleMaxAgeMs           -> 'stale'
 *   otherwise                        -> 'expired'
 * Fail-closed rules: a negative delta clamps to zero (clock-skew
 * tolerance); a non-finite delta or a malformed policy yields
 * 'expired' - a broken policy can never produce 'fresh'.
 */
export function mirrorVerdict(mirror: LocalMirror, clockDeltaMs: number): MirrorVerdict {
	if (!Number.isFinite(clockDeltaMs)) {
		return 'expired';
	}
	if (!policyIsWellFormed(mirror.freshnessPolicy)) {
		return 'expired';
	}
	const deltaMs = clockDeltaMs < 0 ? 0 : clockDeltaMs;
	if (deltaMs <= mirror.freshnessPolicy.maxAgeMs) {
		return 'fresh';
	}
	if (deltaMs <= mirror.freshnessPolicy.staleMaxAgeMs) {
		return 'stale';
	}
	return 'expired';
}

/** Closed list of invalidation kinds (typed receipts, each with evidence). */
export const MIRROR_INVALIDATION_KINDS = [
	'source-digest-drift',
	'ttl-expiry',
	'operator-invalidation',
] as const;
export type MirrorInvalidationKind = (typeof MIRROR_INVALIDATION_KINDS)[number];

/**
 * A typed invalidation receipt: the provenance-bearing record that one
 * mirror ceased to be trustworthy, and why. Evidence is carried as an
 * opaque digest; the recorded content digest is captured at
 * invalidation time so the receipt is self-contained.
 */
export interface MirrorInvalidation {
	readonly scope: FacadeScope;
	readonly contractVersion: string;
	readonly mirrorId: string;
	readonly surfaceRef: AuthoritySurfaceRef;
	/** contentDigest of the mirror at invalidation time. */
	readonly recordedContentDigest: string;
	/** source-digest drift | TTL expiry | explicit operator invalidation. */
	readonly kind: MirrorInvalidationKind;
	/** Opaque digest over the evidence (authority digest format). */
	readonly evidenceDigest: string;
	/** ISO-8601 plain-string invalidation timestamp (injected). */
	readonly invalidatedAtIso: string;
}

/** Closed list of invalidation rejection reasons. */
export const MIRROR_INVALIDATION_REJECTION_REASONS = [
	'invalid-mirror',
	'unknown-invalidation-kind',
	'invalid-evidence',
	'invalid-invalidated-at',
] as const;
export type MirrorInvalidationRejectionReason =
	(typeof MIRROR_INVALIDATION_REJECTION_REASONS)[number];

export interface MirrorInvalidated {
	readonly invalidated: true;
	readonly receipt: MirrorInvalidation;
}

export interface MirrorInvalidationRejected {
	readonly invalidated: false;
	readonly reason: MirrorInvalidationRejectionReason;
	readonly detail: string;
}

export type MirrorInvalidationOutcome = MirrorInvalidated | MirrorInvalidationRejected;

/**
 * Pure invalidation transition: derive a typed receipt for invalidating
 * a mirror, without mutating the mirror. The invalidatedAtIso timestamp
 * is injected (determinism law: this module never reads a clock).
 * Rejections are typed and name the violation:
 *   invalid-mirror          - the mirror fails isLocalMirror
 *   unknown-invalidation-kind
 *   invalid-evidence        - empty evidence digest
 *   invalid-invalidated-at  - empty timestamp
 */
export function invalidateMirror(
	mirror: LocalMirror,
	kind: MirrorInvalidationKind,
	evidenceDigest: string,
	invalidatedAtIso: string,
): MirrorInvalidationOutcome {
	if (!isLocalMirror(mirror)) {
		return rejectInvalidation(
			'invalid-mirror',
			'mirror must satisfy isLocalMirror before it can be invalidated',
		);
	}
	if (!(MIRROR_INVALIDATION_KINDS as readonly string[]).includes(kind)) {
		return rejectInvalidation(
			'unknown-invalidation-kind',
			`invalidation kind must be one of source-digest-drift/ttl-expiry/operator-invalidation, got '${String(kind)}'`,
		);
	}
	if (!isNonEmptyString(evidenceDigest)) {
		return rejectInvalidation('invalid-evidence', 'evidenceDigest must be a non-empty string');
	}
	if (!isNonEmptyString(invalidatedAtIso)) {
		return rejectInvalidation('invalid-invalidated-at', 'invalidatedAtIso must be a non-empty ISO-8601 string');
	}
	return {
		invalidated: true,
		receipt: {
			scope: mirror.scope,
			contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
			mirrorId: mirror.mirrorId,
			surfaceRef: mirror.surfaceRef,
			recordedContentDigest: mirror.contentDigest,
			kind,
			evidenceDigest,
			invalidatedAtIso,
		},
	};
}

function policyIsWellFormed(policy: FreshnessPolicy): boolean {
	return (
		Number.isFinite(policy.maxAgeMs) &&
		Number.isFinite(policy.staleMaxAgeMs) &&
		policy.maxAgeMs >= 0 &&
		policy.staleMaxAgeMs >= policy.maxAgeMs
	);
}

function rejectMirror(reason: MirrorRejectionReason, detail: string): UnmirrorableSurface {
	return { mirrorable: false, reason, detail };
}

function rejectInvalidation(
	reason: MirrorInvalidationRejectionReason,
	detail: string,
): MirrorInvalidationRejected {
	return { invalidated: false, reason, detail };
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
