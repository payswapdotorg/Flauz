/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-008 mirror contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: the mirrorable-surface table below is SYNTHETIC (every
 * kind prefixed 'fixture.') and is NOT an authority value. Authority
 * values are pinned separately, after repo-side seam transcription, by
 * the SEAM-PIN suite at the bottom of this file.
 *
 * CANONICAL NOTE: this copy folds in corrections-ledger item #1 - the
 * type import aliases the module's actual export, UnmirrorableSurface
 * (an early emission named a non-existent 'MirrorUnmirrorable' and
 * carried the fix as a separate prose correction). This block is the
 * ledger-resolved canonical form; no other line differs.
 */
import { strict as assert } from 'node:assert';
import {
	COMMAND_FACADE_CONTRACTS_VERSION,
	isFacadeScope as isFacadeScopeCompound,
} from '../../common/compound.js';
import {
	COMMAND_FACADE_CONTRACTS_VERSION as MIRROR_CONTRACT_VERSION,
	DEFAULT_FRESHNESS_POLICY,
	FROZEN_MIRRORABLE_SURFACES,
	MIRROR_FRESH_WINDOW_MS,
	MIRROR_INVALIDATION_KINDS,
	MIRROR_REJECTION_REASONS,
	MIRROR_STALE_WINDOW_MS,
	MIRROR_VERDICTS,
	canMirror,
	invalidateMirror,
	isAuthoritySurfaceRef,
	isFacadeScope as isFacadeScopeMirror,
	isFreshnessPolicy,
	isLocalMirror,
	mirrorVerdict,
} from '../../common/mirror.js';
import type {
	LocalMirror,
	MirrorableSurfaceEntry,
	MirrorInvalidationKind,
	MirrorInvalidationOutcome,
	MirrorInvalidationRejected,
	MirrorAdmission,
	UnmirrorableSurface as UnmirrorableAlias,
} from '../../common/mirror.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const FIXTURE_SURFACE_TABLE: readonly MirrorableSurfaceEntry[] = [
	{ surfaceKind: 'fixture.execution.task-state-read' },
	{ surfaceKind: 'fixture.execution.task-log-read' },
];

const READ_SURFACE_REF = {
	surfaceKind: 'fixture.execution.task-state-read',
	resourceId: 'res-fixture',
} as const;

// Write-shaped and approval-shaped fixture surfaces: well-formed
// references, but never members of any mirrorable table by law.
const WRITE_SURFACE_REF = {
	surfaceKind: 'fixture.execution.task-state-write',
	resourceId: 'res-fixture',
} as const;

const APPROVAL_SURFACE_REF = {
	surfaceKind: 'fixture.agent.human-approval-queue',
	resourceId: 'res-fixture',
} as const;

function fixtureMirror(): LocalMirror {
	return {
		scope: FIXTURE_SCOPE,
		contractVersion: MIRROR_CONTRACT_VERSION,
		mirrorId: 'mirror-fixture',
		surfaceRef: READ_SURFACE_REF,
		contentDigest: 'content-digest:fixture',
		byteSize: 1024,
		mirroredAtIso: '2025-01-01T00:00:00Z',
		freshnessPolicy: DEFAULT_FRESHNESS_POLICY,
	};
}

function unmirrorable(admission: MirrorAdmission): UnmirrorableAlias {
	assert.equal(admission.mirrorable, false, `expected rejection, got: ${JSON.stringify(admission)}`);
	return admission as UnmirrorableAlias;
}

function rejectedInvalidation(outcome: MirrorInvalidationOutcome): MirrorInvalidationRejected {
	assert.equal(outcome.invalidated, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
	return outcome as MirrorInvalidationRejected;
}

suite('ZC-008 mirror contracts', () => {

	suite('constants, closed lists and cross-module pins', () => {
		test('contract version matches the compound module copy (one versioned set)', () => {
			assert.equal(MIRROR_CONTRACT_VERSION, COMMAND_FACADE_CONTRACTS_VERSION);
			assert.equal(MIRROR_CONTRACT_VERSION, '1.0.0');
		});

		test('FacadeScope guards agree across modules (structural pin)', () => {
			const goodScope = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };
			const badScopes = [
				{ workspaceId: '', tenantId: 'tenant-fixture' },
				{ workspaceId: 'ws-fixture' },
				null,
				'ws-fixture',
			];
			assert.equal(isFacadeScopeMirror(goodScope), isFacadeScopeCompound(goodScope));
			for (const bad of badScopes) {
				assert.equal(isFacadeScopeMirror(bad), isFacadeScopeCompound(bad));
			}
		});

		test('mirror verdicts are the closed fresh/stale/expired list', () => {
			assert.deepStrictEqual([...MIRROR_VERDICTS], ['fresh', 'stale', 'expired']);
		});

		test('freshness windows are positive integers with fresh strictly below stale', () => {
			assert.ok(Number.isInteger(MIRROR_FRESH_WINDOW_MS));
			assert.ok(Number.isInteger(MIRROR_STALE_WINDOW_MS));
			assert.ok(MIRROR_FRESH_WINDOW_MS > 0);
			assert.ok(MIRROR_STALE_WINDOW_MS > MIRROR_FRESH_WINDOW_MS);
		});

		test('default freshness policy is frozen and built from the exported constants', () => {
			assert.ok(Object.isFrozen(DEFAULT_FRESHNESS_POLICY));
			assert.equal(DEFAULT_FRESHNESS_POLICY.maxAgeMs, MIRROR_FRESH_WINDOW_MS);
			assert.equal(DEFAULT_FRESHNESS_POLICY.staleMaxAgeMs, MIRROR_STALE_WINDOW_MS);
		});

		test('invalidation kinds are the closed three-receipt list', () => {
			assert.deepStrictEqual([...MIRROR_INVALIDATION_KINDS], [
				'source-digest-drift',
				'ttl-expiry',
				'operator-invalidation',
			]);
		});

		test('mirror rejection reasons are the closed two-reason list', () => {
			assert.deepStrictEqual([...MIRROR_REJECTION_REASONS], ['invalid-surface-ref', 'surface-not-mirrorable']);
		});
	});

	suite('pure shape guards', () => {
		test('isAuthoritySurfaceRef accepts well-formed refs and rejects junk', () => {
			assert.ok(isAuthoritySurfaceRef(READ_SURFACE_REF));
			assert.ok(!isAuthoritySurfaceRef({ surfaceKind: '', resourceId: 'res-fixture' }));
			assert.ok(!isAuthoritySurfaceRef({ surfaceKind: 'fixture.execution.task-state-read' }));
			assert.ok(!isAuthoritySurfaceRef(null));
			assert.ok(!isAuthoritySurfaceRef('res-fixture'));
		});

		test('isFreshnessPolicy accepts the default and custom policies, rejects malformed ones', () => {
			assert.ok(isFreshnessPolicy(DEFAULT_FRESHNESS_POLICY));
			assert.ok(isFreshnessPolicy({ maxAgeMs: 0, staleMaxAgeMs: 0 }));
			assert.ok(isFreshnessPolicy({ maxAgeMs: 1000, staleMaxAgeMs: 1000 }));
			assert.ok(!isFreshnessPolicy({ maxAgeMs: 2000, staleMaxAgeMs: 1000 }));
			assert.ok(!isFreshnessPolicy({ maxAgeMs: -1, staleMaxAgeMs: 1000 }));
			assert.ok(!isFreshnessPolicy({ maxAgeMs: 1.5, staleMaxAgeMs: 1000 }));
			assert.ok(!isFreshnessPolicy({ maxAgeMs: 1000 }));
			assert.ok(!isFreshnessPolicy(null));
		});

		test('isLocalMirror accepts a well-formed fixture mirror', () => {
			assert.ok(isLocalMirror(fixtureMirror()));
		});

		test('isLocalMirror rejects each malformed field', () => {
			const base = fixtureMirror();
			const bad: unknown[] = [
				{ ...base, scope: { workspaceId: '', tenantId: 'tenant-fixture' } },
				{ ...base, contractVersion: '0.9.0' },
				{ ...base, mirrorId: '' },
				{ ...base, surfaceRef: { surfaceKind: '', resourceId: 'res-fixture' } },
				{ ...base, contentDigest: '' },
				{ ...base, byteSize: -1 },
				{ ...base, byteSize: 1.5 },
				{ ...base, byteSize: '1024' },
				{ ...base, mirroredAtIso: '' },
				{ ...base, freshnessPolicy: { maxAgeMs: 2000, staleMaxAgeMs: 1000 } },
				null,
				'mirror-fixture',
			];
			for (const candidate of bad) {
				assert.ok(!isLocalMirror(candidate));
			}
		});
	});

	suite('mirrorVerdict freshness', () => {
		test('fresh at delta zero and exactly at maxAgeMs (inclusive boundary)', () => {
			assert.equal(mirrorVerdict(fixtureMirror(), 0), 'fresh');
			assert.equal(mirrorVerdict(fixtureMirror(), MIRROR_FRESH_WINDOW_MS), 'fresh');
		});

		test('stale just past maxAgeMs and exactly at staleMaxAgeMs (inclusive boundary)', () => {
			assert.equal(mirrorVerdict(fixtureMirror(), MIRROR_FRESH_WINDOW_MS + 1), 'stale');
			assert.equal(mirrorVerdict(fixtureMirror(), MIRROR_STALE_WINDOW_MS), 'stale');
		});

		test('expired past staleMaxAgeMs', () => {
			assert.equal(mirrorVerdict(fixtureMirror(), MIRROR_STALE_WINDOW_MS + 1), 'expired');
		});

		test('a negative clock delta clamps to fresh (clock-skew tolerance)', () => {
			assert.equal(mirrorVerdict(fixtureMirror(), -5000), 'fresh');
		});

		test('a non-finite clock delta fails closed to expired', () => {
			assert.equal(mirrorVerdict(fixtureMirror(), Number.NaN), 'expired');
			assert.equal(mirrorVerdict(fixtureMirror(), Number.POSITIVE_INFINITY), 'expired');
		});

		test('a malformed policy fails closed to expired, never fresh', () => {
			const mirror: LocalMirror = {
				...fixtureMirror(),
				freshnessPolicy: { maxAgeMs: MIRROR_STALE_WINDOW_MS, staleMaxAgeMs: MIRROR_FRESH_WINDOW_MS },
			};
			assert.equal(mirrorVerdict(mirror, 0), 'expired');
		});
	});

	suite('canMirror safe-mirror admission', () => {
		test('admits a fixture read-only surface and echoes its kind', () => {
			const admission = canMirror(READ_SURFACE_REF, FIXTURE_SURFACE_TABLE);
			assert.equal(admission.mirrorable, true);
			assert.equal(admission.mirrorable === true ? admission.surfaceKind : '', 'fixture.execution.task-state-read');
		});

		test('rejects a write-shaped surface, naming the kind and the safe-mirror law', () => {
			const rejected = unmirrorable(canMirror(WRITE_SURFACE_REF, FIXTURE_SURFACE_TABLE));
			assert.equal(rejected.reason, 'surface-not-mirrorable');
			assert.ok(rejected.detail.includes('fixture.execution.task-state-write'));
			assert.ok(rejected.detail.includes('READ-ONLY'));
			assert.ok(rejected.detail.includes('never mirror'));
		});

		test('rejects an approval-shaped surface with the same typed rejection', () => {
			const rejected = unmirrorable(canMirror(APPROVAL_SURFACE_REF, FIXTURE_SURFACE_TABLE));
			assert.equal(rejected.reason, 'surface-not-mirrorable');
			assert.ok(rejected.detail.includes('fixture.agent.human-approval-queue'));
		});

		test('rejects a malformed surfaceRef as invalid-surface-ref', () => {
			const rejected = unmirrorable(canMirror({ surfaceKind: '', resourceId: '' }, FIXTURE_SURFACE_TABLE));
			assert.equal(rejected.reason, 'invalid-surface-ref');
		});

		test('fails closed by default: nothing resolves before seam transcription', () => {
			const rejected = unmirrorable(canMirror(READ_SURFACE_REF));
			assert.equal(rejected.reason, 'surface-not-mirrorable');
		});
	});

	suite('invalidateMirror typed transition', () => {
		test('source-digest drift produces the full provenance receipt', () => {
			const outcome = invalidateMirror(
				fixtureMirror(),
				'source-digest-drift',
				'evidence-digest:drift',
				'2025-01-02T00:00:00Z',
			);
			assert.equal(outcome.invalidated, true);
			if (outcome.invalidated) {
				assert.deepStrictEqual(outcome.receipt, {
					scope: FIXTURE_SCOPE,
					contractVersion: MIRROR_CONTRACT_VERSION,
					mirrorId: 'mirror-fixture',
					surfaceRef: READ_SURFACE_REF,
					recordedContentDigest: 'content-digest:fixture',
					kind: 'source-digest-drift',
					evidenceDigest: 'evidence-digest:drift',
					invalidatedAtIso: '2025-01-02T00:00:00Z',
				});
			}
		});

		test('ttl expiry produces a receipt with the same shape', () => {
			const outcome = invalidateMirror(
				fixtureMirror(),
				'ttl-expiry',
				'evidence-digest:ttl',
				'2025-01-02T00:00:00Z',
			);
			assert.equal(outcome.invalidated, true);
			if (outcome.invalidated) {
				assert.equal(outcome.receipt.kind, 'ttl-expiry');
				assert.equal(outcome.receipt.evidenceDigest, 'evidence-digest:ttl');
			}
		});

		test('explicit operator invalidation produces a receipt with the same shape', () => {
			const outcome = invalidateMirror(
				fixtureMirror(),
				'operator-invalidation',
				'evidence-digest:operator',
				'2025-01-02T00:00:00Z',
			);
			assert.equal(outcome.invalidated, true);
			if (outcome.invalidated) {
				assert.equal(outcome.receipt.kind, 'operator-invalidation');
			}
		});

		test('is a pure transition: the input mirror is not mutated', () => {
			const mirror = fixtureMirror();
			const snapshot = JSON.parse(JSON.stringify(mirror)) as LocalMirror;
			invalidateMirror(mirror, 'ttl-expiry', 'evidence-digest:ttl', '2025-01-02T00:00:00Z');
			assert.deepStrictEqual(mirror, snapshot);
		});

		test('rejects malformed inputs with typed reasons naming the violation', () => {
			const badKind = 'teleport' as unknown as MirrorInvalidationKind;
			assert.equal(
				rejectedInvalidation(invalidateMirror(fixtureMirror(), badKind, 'e', '2025-01-02T00:00:00Z')).reason,
				'unknown-invalidation-kind',
			);
			assert.equal(
				rejectedInvalidation(invalidateMirror(fixtureMirror(), 'ttl-expiry', '', '2025-01-02T00:00:00Z')).reason,
				'invalid-evidence',
			);
			assert.equal(
				rejectedInvalidation(invalidateMirror(fixtureMirror(), 'ttl-expiry', 'e', '')).reason,
				'invalid-invalidated-at',
			);
		});

		test('rejects a malformed mirror as invalid-mirror', () => {
			const broken = { ...fixtureMirror(), mirrorId: '' } as unknown as LocalMirror;
			const rejected = rejectedInvalidation(
				invalidateMirror(broken, 'ttl-expiry', 'evidence-digest:ttl', '2025-01-02T00:00:00Z'),
			);
			assert.equal(rejected.reason, 'invalid-mirror');
		});
	});

	suite('SEAM-PIN: frozen mirrorable surfaces (activates after repo-side transcription)', () => {
		test('is transcribed: non-empty and frozen', () => {
			assert.ok(
				FROZEN_MIRRORABLE_SURFACES.length > 0,
				'SEAM(MIRRORABLE_SURFACES) pending: transcribe the Resource authority read-only surface kinds repo-side',
			);
			assert.ok(Object.isFrozen(FROZEN_MIRRORABLE_SURFACES));
		});

		test('is closed: surface kinds are unique and non-empty', () => {
			const kinds = FROZEN_MIRRORABLE_SURFACES.map((entry) => entry.surfaceKind);
			assert.equal(new Set(kinds).size, kinds.length);
			for (const kind of kinds) {
				assert.ok(typeof kind === 'string' && kind.length > 0);
			}
		});

		test('every transcribed kind stays admitted by canMirror against the frozen table', () => {
			for (const entry of FROZEN_MIRRORABLE_SURFACES) {
				const admission = canMirror(
					{ surfaceKind: entry.surfaceKind, resourceId: 'res-seam-pin' },
					FROZEN_MIRRORABLE_SURFACES,
				);
				assert.equal(
					admission.mirrorable,
					true,
					`transcribed kind '${entry.surfaceKind}' must resolve in the frozen table`,
				);
			}
		});
	});
});
