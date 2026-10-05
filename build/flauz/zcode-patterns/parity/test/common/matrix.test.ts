/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/test/common/matrix.test.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- matrix contracts tests
 * ----------------------------------------------------------------------------
 *
 * TDD pin suite for common/matrix.ts (mocha tdd, node:assert/strict, .js
 * import suffixes, tab indentation, ASCII only).
 *
 * Pins, verbatim and in canonical order: the ten Phase C domains, the four
 * parity verdicts, the five evidence labels, and the contract set version --
 * including the cross-module lockstep pin: common/evidence.ts must export
 * the same ZCODE_PARITY_CONTRACTS_VERSION and the same EVIDENCE_LABELS
 * table as the verbatim zero-dependency duplicate (common/ modules may not
 * import each other; the test suites enforce the duplication discipline).
 *
 * Then it exercises every pure guard and the full verdictFor() truth table,
 * including the fail-closed law (unknown inputs -> parity-unmeasured) and
 * the honesty law (evidence none can never carry a confirmed verdict).
 *
 * MIT License. Full text: LICENSE at the repository root.
 * ----------------------------------------------------------------------------
 */

import { deepEqual, strictEqual } from 'node:assert/strict';

import {
	EVIDENCE_LABELS,
	PARITY_DOMAINS,
	PARITY_VERDICTS,
	ZCODE_PARITY_CONTRACTS_VERSION,
	isDomainComparisonRecord,
	isEvidenceLabel,
	isParityDomain,
	isParityScope,
	isParityVerdict,
	isSurfaceDigest,
	verdictFor,
} from '../../common/matrix.js';
import {
	EVIDENCE_LABELS as EVIDENCE_LABELS_FROM_EVIDENCE,
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_EVIDENCE,
} from '../../common/evidence.js';
import type {
	DomainComparisonRecord,
	EvidenceLabel,
	ParityDomain,
	ParityScope,
} from '../../common/matrix.js';

// ---------------------------------------------------------------------------
// Fixtures (deterministic plain strings; digests are injected, never computed).
// ---------------------------------------------------------------------------

const SCOPE: ParityScope = { workspaceId: 'ws-zc010', tenantId: 'tenant-flauz' };

/** Valid records across the full verdict space. */
const CONFIRMED: DomainComparisonRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	domain: 'coding',
	zcodeSurfaceDigest: 'digest-zc-coding-a1',
	serviceSurfaceDigest: 'digest-zc-coding-a1',
	evidenceLabel: 'test-suite-green',
	verdict: 'parity-confirmed',
};

const DIVERGENT: DomainComparisonRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	domain: 'memory',
	zcodeSurfaceDigest: 'digest-zc-memory-a1',
	serviceSurfaceDigest: 'digest-journey-memory-9f',
	evidenceLabel: 'authority-mirrored',
	verdict: 'parity-divergent',
};

const PARTIAL: DomainComparisonRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	domain: 'hooks',
	zcodeSurfaceDigest: 'digest-zc-hooks-a1',
	serviceSurfaceDigest: undefined,
	evidenceLabel: 'contract-pinned',
	verdict: 'parity-partial',
};

const UNMEASURED: DomainComparisonRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	domain: 'replay-recovery',
	zcodeSurfaceDigest: undefined,
	serviceSurfaceDigest: undefined,
	evidenceLabel: 'none',
	verdict: 'parity-unmeasured',
};

/** Spread the confirmed record and override fields with garbage: guard fodder. */
function variant(overrides: Record<string, unknown>): unknown {
	return { ...CONFIRMED, ...overrides };
}

/** Fail-closed fodder: values outside the frozen vocabularies. */
const UNKNOWN_DOMAIN = 'time-travel' as unknown as ParityDomain;
const UNKNOWN_LABEL = 'gut-feeling' as unknown as EvidenceLabel;

suite('zc010 parity matrix contracts', () => {
	suite('contract set version and lockstep', () => {
		test('ZCODE_PARITY_CONTRACTS_VERSION is pinned to 1.0.0', () => {
			strictEqual(ZCODE_PARITY_CONTRACTS_VERSION, '1.0.0');
		});

		test('common/evidence.ts exports the same contract set version (lockstep law)', () => {
			strictEqual(VERSION_FROM_EVIDENCE, ZCODE_PARITY_CONTRACTS_VERSION);
		});

		test('common/evidence.ts EVIDENCE_LABELS is the verbatim zero-dependency duplicate', () => {
			deepEqual(EVIDENCE_LABELS_FROM_EVIDENCE, EVIDENCE_LABELS);
			deepEqual(EVIDENCE_LABELS, [
				'test-suite-green',
				'contract-pinned',
				'authority-mirrored',
				'documented-comparison',
				'none',
			]);
			strictEqual(EVIDENCE_LABELS.length, 5);
		});
	});

	suite('PARITY_DOMAINS -- the frozen comparison matrix rows', () => {
		test('pins the ten Phase C domains in canonical order', () => {
			deepEqual(PARITY_DOMAINS, [
				'coding',
				'exploration',
				'background-delegation',
				'plan-execute',
				'browser-computer-use',
				'memory',
				'hooks',
				'workflow-monitoring',
				'replay-recovery',
				'capability-discovery',
			]);
			strictEqual(PARITY_DOMAINS.length, 10);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(PARITY_DOMAINS), true);
		});

		test('isParityDomain accepts every frozen domain', () => {
			for (const domain of PARITY_DOMAINS) {
				strictEqual(isParityDomain(domain), true);
			}
		});

		test('isParityDomain rejects unknown, empty, and non-string values', () => {
			strictEqual(isParityDomain('time-travel'), false);
			strictEqual(isParityDomain(''), false);
			strictEqual(isParityDomain('Coding'), false); // case-sensitive vocabulary
			strictEqual(isParityDomain(7), false);
			strictEqual(isParityDomain(null), false);
			strictEqual(isParityDomain(undefined), false);
			strictEqual(isParityDomain(['coding']), false);
		});

		test('isParityDomain narrows arrays via its type predicate', () => {
			const narrowed: readonly ParityDomain[] = ['coding', 'not-a-domain', 'memory'].filter(isParityDomain);
			deepEqual(narrowed, ['coding', 'memory']);
		});
	});

	suite('PARITY_VERDICTS -- the frozen verdict vocabulary', () => {
		test('pins the four verdicts in canonical order', () => {
			deepEqual(PARITY_VERDICTS, [
				'parity-confirmed',
				'parity-partial',
				'parity-divergent',
				'parity-unmeasured',
			]);
			strictEqual(PARITY_VERDICTS.length, 4);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(PARITY_VERDICTS), true);
		});

		test('isParityVerdict accepts the four verdicts and rejects everything else', () => {
			for (const verdict of PARITY_VERDICTS) {
				strictEqual(isParityVerdict(verdict), true);
			}
			strictEqual(isParityVerdict('parity-flawless'), false);
			strictEqual(isParityVerdict(''), false);
			strictEqual(isParityVerdict(42), false);
			strictEqual(isParityVerdict(null), false);
			strictEqual(isParityVerdict(undefined), false);
		});
	});

	suite('EVIDENCE_LABELS -- the frozen label vocabulary (matrix duplicate)', () => {
		test('pins the five labels in canonical order', () => {
			deepEqual(EVIDENCE_LABELS, [
				'test-suite-green',
				'contract-pinned',
				'authority-mirrored',
				'documented-comparison',
				'none',
			]);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(EVIDENCE_LABELS), true);
		});

		test('isEvidenceLabel accepts the five labels and rejects everything else', () => {
			for (const label of EVIDENCE_LABELS) {
				strictEqual(isEvidenceLabel(label), true);
			}
			strictEqual(isEvidenceLabel('vibes-only'), false);
			strictEqual(isEvidenceLabel('NONE'), false); // case-sensitive vocabulary
			strictEqual(isEvidenceLabel(''), false);
			strictEqual(isEvidenceLabel(null), false);
			strictEqual(isEvidenceLabel(undefined), false);
		});
	});

	suite('isParityScope -- the scope guard', () => {
		test('accepts non-empty workspaceId and tenantId', () => {
			strictEqual(isParityScope(SCOPE), true);
			strictEqual(isParityScope({ workspaceId: 'w', tenantId: 't' }), true);
		});

		test('rejects non-objects and malformed members', () => {
			strictEqual(isParityScope(null), false);
			strictEqual(isParityScope(undefined), false);
			strictEqual(isParityScope('ws/tenant'), false);
			strictEqual(isParityScope(42), false);
			strictEqual(isParityScope([]), false);
			strictEqual(isParityScope({ workspaceId: '', tenantId: 't' }), false);
			strictEqual(isParityScope({ workspaceId: 'w', tenantId: '' }), false);
			strictEqual(isParityScope({ workspaceId: 'w' }), false);
			strictEqual(isParityScope({ workspaceId: 7, tenantId: 't' }), false);
		});

		test('narrows arrays via its type predicate', () => {
			const narrowed: readonly ParityScope[] = [SCOPE, { workspaceId: '', tenantId: 'kept' }].filter(isParityScope);
			deepEqual(narrowed, [SCOPE]);
		});
	});

	suite('isSurfaceDigest -- the injected digest guard', () => {
		test('accepts any non-empty string', () => {
			strictEqual(isSurfaceDigest('a'), true);
			strictEqual(isSurfaceDigest('sha256:abc123'), true);
		});

		test('rejects empty strings and non-strings', () => {
			strictEqual(isSurfaceDigest(''), false);
			strictEqual(isSurfaceDigest(undefined), false);
			strictEqual(isSurfaceDigest(null), false);
			strictEqual(isSurfaceDigest(42), false);
			strictEqual(isSurfaceDigest({ digest: 'x' }), false);
		});
	});

	suite('verdictFor -- the pure derivation', () => {
		test('both digests present and equal -> parity-confirmed', () => {
			strictEqual(verdictFor('coding', 'd1', 'd1', 'test-suite-green'), 'parity-confirmed');
		});

		test('both digests present and different -> parity-divergent', () => {
			strictEqual(verdictFor('memory', 'd1', 'd2', 'authority-mirrored'), 'parity-divergent');
		});

		test('zcode digest only -> parity-partial', () => {
			strictEqual(verdictFor('hooks', 'd1', undefined, 'contract-pinned'), 'parity-partial');
		});

		test('service digest only -> parity-partial', () => {
			strictEqual(verdictFor('exploration', undefined, 'd2', 'documented-comparison'), 'parity-partial');
		});

		test('neither digest present -> parity-unmeasured', () => {
			strictEqual(verdictFor('plan-execute', undefined, undefined, 'contract-pinned'), 'parity-unmeasured');
		});

		test('evidence none forces parity-unmeasured regardless of the digests (honesty law)', () => {
			strictEqual(verdictFor('coding', 'd1', 'd1', 'none'), 'parity-unmeasured');
			strictEqual(verdictFor('coding', 'd1', 'd2', 'none'), 'parity-unmeasured');
			strictEqual(verdictFor('coding', 'd1', undefined, 'none'), 'parity-unmeasured');
			strictEqual(verdictFor('coding', undefined, undefined, 'none'), 'parity-unmeasured');
		});

		test('unknown domain -> parity-unmeasured (fail closed)', () => {
			strictEqual(verdictFor(UNKNOWN_DOMAIN, 'd1', 'd1', 'test-suite-green'), 'parity-unmeasured');
		});

		test('unknown evidence label -> parity-unmeasured (fail closed)', () => {
			strictEqual(verdictFor('coding', 'd1', 'd1', UNKNOWN_LABEL), 'parity-unmeasured');
		});

		test('empty-string digests count as absent (documented derivation edge)', () => {
			strictEqual(verdictFor('coding', '', 'd2', 'contract-pinned'), 'parity-partial');
			strictEqual(verdictFor('coding', 'd1', '', 'contract-pinned'), 'parity-partial');
			strictEqual(verdictFor('coding', '', '', 'contract-pinned'), 'parity-unmeasured');
		});

		test('label strength does not change the derivation -- only none forces unmeasured', () => {
			const carryingLabels = EVIDENCE_LABELS.filter((label) => label !== 'none');
			deepEqual(carryingLabels, [
				'test-suite-green',
				'contract-pinned',
				'authority-mirrored',
				'documented-comparison',
			]);
			for (const label of carryingLabels) {
				strictEqual(verdictFor('coding', 'd1', 'd1', label), 'parity-confirmed');
				strictEqual(verdictFor('coding', 'd1', 'd2', label), 'parity-divergent');
				strictEqual(verdictFor('coding', 'd1', undefined, label), 'parity-partial');
				strictEqual(verdictFor('coding', undefined, undefined, label), 'parity-unmeasured');
			}
		});

		test('the derivation holds across all ten frozen domains', () => {
			for (const domain of PARITY_DOMAINS) {
				strictEqual(verdictFor(domain, 'd1', 'd1', 'test-suite-green'), 'parity-confirmed');
				strictEqual(verdictFor(domain, 'd1', 'd2', 'contract-pinned'), 'parity-divergent');
				strictEqual(verdictFor(domain, undefined, 'd2', 'authority-mirrored'), 'parity-partial');
				strictEqual(verdictFor(domain, undefined, undefined, 'none'), 'parity-unmeasured');
			}
		});
	});

	suite('isDomainComparisonRecord -- the record guard', () => {
		test('accepts valid records across the full verdict space', () => {
			strictEqual(isDomainComparisonRecord(CONFIRMED), true);
			strictEqual(isDomainComparisonRecord(DIVERGENT), true);
			strictEqual(isDomainComparisonRecord(PARTIAL), true);
			strictEqual(isDomainComparisonRecord(UNMEASURED), true);
		});

		test('rejects non-objects', () => {
			strictEqual(isDomainComparisonRecord(null), false);
			strictEqual(isDomainComparisonRecord(undefined), false);
			strictEqual(isDomainComparisonRecord('record'), false);
			strictEqual(isDomainComparisonRecord(42), false);
			strictEqual(isDomainComparisonRecord([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isDomainComparisonRecord(variant({ scope: null })), false);
			strictEqual(isDomainComparisonRecord(variant({ scope: { workspaceId: '', tenantId: 't' } })), false);
			strictEqual(isDomainComparisonRecord(variant({ scope: { workspaceId: 'w' } })), false);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isDomainComparisonRecord(variant({ contractVersion: '0.9.0' })), false);
			strictEqual(isDomainComparisonRecord(variant({ contractVersion: '1.0.1' })), false);
			strictEqual(isDomainComparisonRecord(variant({ contractVersion: '' })), false);
		});

		test('rejects an unknown domain', () => {
			strictEqual(isDomainComparisonRecord(variant({ domain: 'time-travel' })), false);
			strictEqual(isDomainComparisonRecord(variant({ domain: undefined })), false);
		});

		test('rejects empty-string digests (absent or non-empty only)', () => {
			strictEqual(isDomainComparisonRecord(variant({ zcodeSurfaceDigest: '' })), false);
			strictEqual(isDomainComparisonRecord(variant({ serviceSurfaceDigest: '' })), false);
		});

		test('rejects an unknown evidence label', () => {
			strictEqual(isDomainComparisonRecord(variant({ evidenceLabel: 'gut-feeling' })), false);
			strictEqual(isDomainComparisonRecord(variant({ evidenceLabel: undefined })), false);
		});

		test('rejects an unknown verdict', () => {
			strictEqual(isDomainComparisonRecord(variant({ verdict: 'parity-flawless' })), false);
			strictEqual(isDomainComparisonRecord(variant({ verdict: undefined })), false);
		});

		test('rejects a verdict that contradicts verdictFor over the record\'s own fields (derivation law)', () => {
			// CONFIRMED carries equal digests; any verdict other than
			// parity-confirmed is unrepresentable on this record.
			strictEqual(isDomainComparisonRecord(variant({ verdict: 'parity-divergent' })), false);
			strictEqual(isDomainComparisonRecord(variant({ verdict: 'parity-partial' })), false);
			strictEqual(isDomainComparisonRecord(variant({ verdict: 'parity-unmeasured' })), false);
		});

		test('rejects evidence none with a parity-confirmed verdict (honesty law)', () => {
			strictEqual(isDomainComparisonRecord(variant({ evidenceLabel: 'none' })), false);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isDomainComparisonRecord(variant({ capturedBy: 'probe', note: 'extra' })), true);
		});
	});
});
