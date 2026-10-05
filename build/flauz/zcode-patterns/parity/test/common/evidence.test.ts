/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/test/common/evidence.test.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- evidence contracts tests
 * ----------------------------------------------------------------------------
 *
 * TDD pin suite for common/evidence.ts (mocha tdd, node:assert/strict, .js
 * import suffixes, tab indentation, ASCII only).
 *
 * Pins: the EVIDENCE_LABELS authority declaration (verbatim, frozen) and
 * its verbatim duplicate in matrix.ts; the PARITY_VERDICTS duplicate
 * against the matrix authority; the contract set version in lockstep; the
 * EvidenceRecord laws (label none carries no artifactRef, every other
 * label cites a non-empty one, capturedAtIso shape); the labelFor()
 * ladder; and the labelBacksVerdict() honesty relation.
 *
 * Two cross-module disciplines unique to the zero-dependency law:
 * - behavioral equality: evidence.ts's duplicated scope/label/verdict
 *   guards must behave identically to matrix.ts's originals across a
 *   shared input battery;
 * - coherence: for every (label, digest-pair) combination, the verdict
 *   verdictFor() emits is accepted by labelBacksVerdict() -- the dishonest
 *   pair (none, parity-confirmed) is unreachable, not merely forbidden.
 *
 * MIT License. Full text: LICENSE at the repository root.
 * ----------------------------------------------------------------------------
 */

import { deepEqual, strictEqual } from 'node:assert/strict';

import {
	EVIDENCE_LABELS,
	PARITY_VERDICTS,
	ZCODE_PARITY_CONTRACTS_VERSION,
	isEvidenceFacts,
	isEvidenceLabel,
	isEvidenceRecord,
	isIso8601UtcString,
	isParityScope,
	isParityVerdict,
	labelBacksVerdict,
	labelFor,
} from '../../common/evidence.js';
import {
	EVIDENCE_LABELS as EVIDENCE_LABELS_FROM_MATRIX,
	PARITY_VERDICTS as PARITY_VERDICTS_FROM_MATRIX,
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_MATRIX,
	isEvidenceLabel as isEvidenceLabelFromMatrix,
	isParityScope as isParityScopeFromMatrix,
	isParityVerdict as isParityVerdictFromMatrix,
	verdictFor,
} from '../../common/matrix.js';
import type { EvidenceFacts, EvidenceRecord, ParityScope } from '../../common/evidence.js';

// ---------------------------------------------------------------------------
// Fixtures (deterministic plain strings; timestamps are injected, never
// constructed -- no Date.now, no new Date() anywhere in this suite either).
// ---------------------------------------------------------------------------

const SCOPE: ParityScope = { workspaceId: 'ws-zc010', tenantId: 'tenant-flauz' };

const CAPTURED_AT = '2026-02-14T09:30:00Z';

/** One valid record per label -- the full vocabulary, honestly cited. */
const GREEN_RECORD: EvidenceRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	label: 'test-suite-green',
	artifactRef: 'build/flauz/zcode-patterns/parity/test/common/matrix.test.ts',
	capturedAtIso: CAPTURED_AT,
};

const PINNED_RECORD: EvidenceRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	label: 'contract-pinned',
	artifactRef: 'build/flauz/zcode-patterns/parity/common/matrix.ts',
	capturedAtIso: CAPTURED_AT,
};

const MIRRORED_RECORD: EvidenceRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	label: 'authority-mirrored',
	artifactRef: 'extensions/flauz-agent/src/types.ts',
	capturedAtIso: CAPTURED_AT,
};

const DOCUMENTED_RECORD: EvidenceRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	label: 'documented-comparison',
	artifactRef: 'build/flauz/zcode-patterns/parity/README.md',
	capturedAtIso: CAPTURED_AT,
};

const NONE_RECORD: EvidenceRecord = {
	scope: SCOPE,
	contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
	label: 'none',
	artifactRef: undefined,
	capturedAtIso: CAPTURED_AT,
};

/** Spread the green record and override fields with garbage: guard fodder. */
function variant(overrides: Record<string, unknown>): unknown {
	return { ...GREEN_RECORD, ...overrides };
}

/** Facts fixtures -- one per ladder rung, plus the empty observation. */
const NO_EVIDENCE: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: false,
	structuralMirrorPinnedByTests: false,
	structuralMirrorPresent: false,
	documentedComparisonPresent: false,
};

const GREEN_FACTS: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: true,
	structuralMirrorPinnedByTests: false,
	structuralMirrorPresent: false,
	documentedComparisonPresent: false,
};

const EVERYTHING_OBSERVED: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: true,
	structuralMirrorPinnedByTests: true,
	structuralMirrorPresent: true,
	documentedComparisonPresent: true,
};

const PINNED_MIRROR_FACTS: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: false,
	structuralMirrorPinnedByTests: true,
	structuralMirrorPresent: true,
	documentedComparisonPresent: true,
};

const PRESENT_MIRROR_FACTS: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: false,
	structuralMirrorPinnedByTests: false,
	structuralMirrorPresent: true,
	documentedComparisonPresent: true,
};

const DOCUMENTED_FACTS: EvidenceFacts = {
	greenTddSuitePinnedToAuthority: false,
	structuralMirrorPinnedByTests: false,
	structuralMirrorPresent: false,
	documentedComparisonPresent: true,
};

/** Every digest-presence combination the derivation can face. */
const DIGEST_CASES: ReadonlyArray<readonly [string | undefined, string | undefined]> = [
	['d1', 'd1'],
	['d1', 'd2'],
	['d1', undefined],
	[undefined, 'd2'],
	[undefined, undefined],
];

suite('zc010 parity evidence contracts', () => {
	suite('contract set version and lockstep', () => {
		test('ZCODE_PARITY_CONTRACTS_VERSION is pinned to 1.0.0', () => {
			strictEqual(ZCODE_PARITY_CONTRACTS_VERSION, '1.0.0');
		});

		test('common/matrix.ts exports the same contract set version (lockstep law)', () => {
			strictEqual(VERSION_FROM_MATRIX, ZCODE_PARITY_CONTRACTS_VERSION);
		});

		test('EVIDENCE_LABELS (authority) pins the five labels in canonical order', () => {
			deepEqual(EVIDENCE_LABELS, [
				'test-suite-green',
				'contract-pinned',
				'authority-mirrored',
				'documented-comparison',
				'none',
			]);
			strictEqual(EVIDENCE_LABELS.length, 5);
		});

		test('EVIDENCE_LABELS is frozen', () => {
			strictEqual(Object.isFrozen(EVIDENCE_LABELS), true);
		});

		test('common/matrix.ts EVIDENCE_LABELS is the verbatim zero-dependency duplicate', () => {
			deepEqual(EVIDENCE_LABELS_FROM_MATRIX, EVIDENCE_LABELS);
		});
	});

	suite('PARITY_VERDICTS -- the duplicated verdict vocabulary', () => {
		test('pins the four verdicts in canonical order (evidence duplicate)', () => {
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

		test('common/matrix.ts PARITY_VERDICTS (authority) is deep-equal to this duplicate', () => {
			deepEqual(PARITY_VERDICTS_FROM_MATRIX, PARITY_VERDICTS);
		});
	});

	suite('vocabulary guards', () => {
		test('isEvidenceLabel accepts the five labels and rejects everything else', () => {
			for (const label of EVIDENCE_LABELS) {
				strictEqual(isEvidenceLabel(label), true);
			}
			strictEqual(isEvidenceLabel('vibes-only'), false);
			strictEqual(isEvidenceLabel('NONE'), false);
			strictEqual(isEvidenceLabel(''), false);
			strictEqual(isEvidenceLabel(42), false);
			strictEqual(isEvidenceLabel(null), false);
			strictEqual(isEvidenceLabel(undefined), false);
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

		test('isParityScope accepts non-empty workspaceId and tenantId', () => {
			strictEqual(isParityScope(SCOPE), true);
			strictEqual(isParityScope({ workspaceId: 'w', tenantId: 't' }), true);
		});

		test('isParityScope rejects non-objects and malformed members', () => {
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
	});

	suite('isIso8601UtcString -- the injected timestamp shape guard', () => {
		test('accepts canonical UTC forms with optional fractional seconds', () => {
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00Z'), true);
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00.5Z'), true);
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00.123456Z'), true);
			strictEqual(isIso8601UtcString('1970-01-01T00:00:00Z'), true);
		});

		test('rejects non-canonical and malformed forms', () => {
			strictEqual(isIso8601UtcString('2026-02-14 09:30:00Z'), false); // space separator
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00+00:00'), false); // offset, not Z
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00'), false); // missing Z
			strictEqual(isIso8601UtcString('2026-02-14T09:30Z'), false); // missing seconds
			strictEqual(isIso8601UtcString('2026-2-14T09:30:00Z'), false); // not zero-padded
			strictEqual(isIso8601UtcString('2026-02-14T09:30:00.1234567Z'), false); // 7-digit fraction
			strictEqual(isIso8601UtcString(''), false);
			strictEqual(isIso8601UtcString(42), false);
			strictEqual(isIso8601UtcString(null), false);
			strictEqual(isIso8601UtcString(undefined), false);
		});

		test('shape only: calendar-invalid but shape-valid strings pass (caller\'s concern)', () => {
			strictEqual(isIso8601UtcString('2026-13-45T99:99:99Z'), true);
		});
	});

	suite('isEvidenceRecord -- the record guard', () => {
		test('accepts one valid record per label across the full vocabulary', () => {
			strictEqual(isEvidenceRecord(GREEN_RECORD), true);
			strictEqual(isEvidenceRecord(PINNED_RECORD), true);
			strictEqual(isEvidenceRecord(MIRRORED_RECORD), true);
			strictEqual(isEvidenceRecord(DOCUMENTED_RECORD), true);
			strictEqual(isEvidenceRecord(NONE_RECORD), true);
		});

		test('rejects non-objects', () => {
			strictEqual(isEvidenceRecord(null), false);
			strictEqual(isEvidenceRecord(undefined), false);
			strictEqual(isEvidenceRecord('record'), false);
			strictEqual(isEvidenceRecord(42), false);
			strictEqual(isEvidenceRecord([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isEvidenceRecord(variant({ scope: null })), false);
			strictEqual(isEvidenceRecord(variant({ scope: { workspaceId: '', tenantId: 't' } })), false);
			strictEqual(isEvidenceRecord(variant({ scope: { workspaceId: 'w' } })), false);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isEvidenceRecord(variant({ contractVersion: '0.9.0' })), false);
			strictEqual(isEvidenceRecord(variant({ contractVersion: '1.0.1' })), false);
			strictEqual(isEvidenceRecord(variant({ contractVersion: '2.0.0' })), false);
			strictEqual(isEvidenceRecord(variant({ contractVersion: '' })), false);
			strictEqual(isEvidenceRecord(variant({ contractVersion: undefined })), false);
		});

		test('rejects an unknown label', () => {
			strictEqual(isEvidenceRecord(variant({ label: 'gut-feeling' })), false);
			strictEqual(isEvidenceRecord(variant({ label: undefined })), false);
		});

		test('rejects label none WITH an artifactRef (honesty law: nothing to cite)', () => {
			strictEqual(isEvidenceRecord({ ...NONE_RECORD, artifactRef: 'build/flauz/somewhere' }), false);
		});

		test('rejects a non-none label with an undefined artifactRef', () => {
			strictEqual(isEvidenceRecord(variant({ artifactRef: undefined })), false);
		});

		test('rejects a non-none label with an empty-string artifactRef', () => {
			strictEqual(isEvidenceRecord(variant({ artifactRef: '' })), false);
		});

		test('rejects a non-none label with a non-string artifactRef', () => {
			strictEqual(isEvidenceRecord(variant({ artifactRef: 42 })), false);
			strictEqual(isEvidenceRecord(variant({ artifactRef: null })), false);
		});

		test('rejects a malformed capturedAtIso', () => {
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: '2026-02-14 09:30:00Z' })), false);
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: '2026-02-14T09:30:00+00:00' })), false);
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: 'yesterday' })), false);
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: '' })), false);
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: 42 })), false);
			strictEqual(isEvidenceRecord(variant({ capturedAtIso: undefined })), false);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isEvidenceRecord(variant({ capturedBy: 'probe', note: 'extra' })), true);
		});
	});

	suite('isEvidenceFacts -- the injected-facts guard', () => {
		test('accepts a complete facts object (all rungs false)', () => {
			strictEqual(isEvidenceFacts(NO_EVIDENCE), true);
		});

		test('rejects a facts object missing any field', () => {
			strictEqual(isEvidenceFacts({}), false);
			strictEqual(isEvidenceFacts({ greenTddSuitePinnedToAuthority: true }), false);
			strictEqual(
				isEvidenceFacts({
					greenTddSuitePinnedToAuthority: false,
					structuralMirrorPinnedByTests: false,
					structuralMirrorPresent: false,
				}),
				false,
			);
		});

		test('rejects non-boolean fact values', () => {
			strictEqual(
				isEvidenceFacts({
					greenTddSuitePinnedToAuthority: 'true',
					structuralMirrorPinnedByTests: false,
					structuralMirrorPresent: false,
					documentedComparisonPresent: false,
				}),
				false,
			);
			strictEqual(
				isEvidenceFacts({
					greenTddSuitePinnedToAuthority: false,
					structuralMirrorPinnedByTests: 1,
					structuralMirrorPresent: false,
					documentedComparisonPresent: false,
				}),
				false,
			);
		});

		test('rejects non-objects', () => {
			strictEqual(isEvidenceFacts(null), false);
			strictEqual(isEvidenceFacts(undefined), false);
			strictEqual(isEvidenceFacts('facts'), false);
			strictEqual(isEvidenceFacts(42), false);
		});
	});

	suite('labelFor -- the pure label derivation (strongest evidence wins)', () => {
		test('nothing observed -> none', () => {
			strictEqual(labelFor(NO_EVIDENCE), 'none');
		});

		test('green tdd suite pinned to the authority -> test-suite-green', () => {
			strictEqual(labelFor(GREEN_FACTS), 'test-suite-green');
		});

		test('everything observed -> test-suite-green (the strongest rung wins)', () => {
			strictEqual(labelFor(EVERYTHING_OBSERVED), 'test-suite-green');
		});

		test('mirror pinned by tests (with mirror present and prose) -> contract-pinned', () => {
			strictEqual(labelFor(PINNED_MIRROR_FACTS), 'contract-pinned');
		});

		test('mirror present but unpinned (with prose) -> authority-mirrored', () => {
			strictEqual(labelFor(PRESENT_MIRROR_FACTS), 'authority-mirrored');
		});

		test('prose comparison only -> documented-comparison', () => {
			strictEqual(labelFor(DOCUMENTED_FACTS), 'documented-comparison');
		});

		test('facts missing a field -> none (fail closed)', () => {
			strictEqual(labelFor({ greenTddSuitePinnedToAuthority: true } as unknown as EvidenceFacts), 'none');
		});

		test('facts with non-boolean values -> none (fail closed)', () => {
			strictEqual(
				labelFor({
					greenTddSuitePinnedToAuthority: 'yes',
					structuralMirrorPinnedByTests: false,
					structuralMirrorPresent: false,
					documentedComparisonPresent: false,
				} as unknown as EvidenceFacts),
				'none',
			);
		});

		test('non-object facts -> none (fail closed)', () => {
			strictEqual(labelFor(null as unknown as EvidenceFacts), 'none');
			strictEqual(labelFor(undefined as unknown as EvidenceFacts), 'none');
			strictEqual(labelFor('facts' as unknown as EvidenceFacts), 'none');
			strictEqual(labelFor(42 as unknown as EvidenceFacts), 'none');
		});
	});

	suite('labelBacksVerdict -- the honesty relation', () => {
		test('label none backs parity-unmeasured ONLY', () => {
			strictEqual(labelBacksVerdict('none', 'parity-unmeasured'), true);
			strictEqual(labelBacksVerdict('none', 'parity-confirmed'), false);
			strictEqual(labelBacksVerdict('none', 'parity-partial'), false);
			strictEqual(labelBacksVerdict('none', 'parity-divergent'), false);
		});

		test('every non-none label backs all four verdicts', () => {
			const carryingLabels = EVIDENCE_LABELS.filter((label) => label !== 'none');
			deepEqual(carryingLabels, [
				'test-suite-green',
				'contract-pinned',
				'authority-mirrored',
				'documented-comparison',
			]);
			for (const label of carryingLabels) {
				for (const verdict of PARITY_VERDICTS) {
					strictEqual(labelBacksVerdict(label, verdict), true, `label=${label} verdict=${verdict}`);
				}
			}
		});

		test('unknown label -> false (fail closed)', () => {
			strictEqual(labelBacksVerdict('gut-feeling' as never, 'parity-confirmed'), false);
			strictEqual(labelBacksVerdict('' as never, 'parity-unmeasured'), false);
			strictEqual(labelBacksVerdict(42 as never, 'parity-confirmed'), false);
			strictEqual(labelBacksVerdict(null as never, 'parity-unmeasured'), false);
		});

		test('unknown verdict -> false (fail closed)', () => {
			strictEqual(labelBacksVerdict('test-suite-green', 'parity-flawless' as never), false);
			strictEqual(labelBacksVerdict('none', 'parity-flawless' as never), false);
		});
	});

	suite('cross-module coherence (verdictFor x labelBacksVerdict)', () => {
		test('every verdict verdictFor can emit is backed by its label -- exhaustive grid', () => {
			for (const label of EVIDENCE_LABELS) {
				for (const [zcodeDigest, serviceDigest] of DIGEST_CASES) {
					const verdict = verdictFor('coding', zcodeDigest, serviceDigest, label);
					strictEqual(
						labelBacksVerdict(label, verdict),
						true,
						`label=${label} zcode=${String(zcodeDigest)} service=${String(serviceDigest)} verdict=${verdict}`,
					);
				}
			}
		});

		test('the dishonest pair (none, parity-confirmed) is unreachable, not merely forbidden', () => {
			// verdictFor never emits a confirmed verdict on label none...
			for (const [zcodeDigest, serviceDigest] of DIGEST_CASES) {
				strictEqual(verdictFor('coding', zcodeDigest, serviceDigest, 'none'), 'parity-unmeasured');
			}
			// ...and even a hand-built pair is rejected by the relation.
			strictEqual(labelBacksVerdict('none', 'parity-confirmed'), false);
		});
	});

	suite('duplicated guards behave identically across modules (zero-dependency law)', () => {
		const SCOPE_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			[SCOPE, true],
			[{ workspaceId: 'w', tenantId: 't' }, true],
			[null, false],
			[undefined, false],
			['ws/tenant', false],
			[42, false],
			[[], false],
			[{ workspaceId: '', tenantId: 't' }, false],
			[{ workspaceId: 'w', tenantId: '' }, false],
			[{ workspaceId: 'w' }, false],
			[{ workspaceId: 7, tenantId: 't' }, false],
		];

		const LABEL_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['test-suite-green', true],
			['contract-pinned', true],
			['authority-mirrored', true],
			['documented-comparison', true],
			['none', true],
			['vibes-only', false],
			['NONE', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		const VERDICT_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['parity-confirmed', true],
			['parity-partial', true],
			['parity-divergent', true],
			['parity-unmeasured', true],
			['parity-flawless', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		test('isParityScope: evidence.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of SCOPE_BATTERY) {
				strictEqual(isParityScope(input), expected, `input=${String(input)}`);
				strictEqual(isParityScopeFromMatrix(input), expected, `input=${String(input)}`);
			}
		});

		test('isEvidenceLabel: evidence.ts (authority) and matrix.ts (duplicate) agree', () => {
			for (const [input, expected] of LABEL_BATTERY) {
				strictEqual(isEvidenceLabel(input), expected, `input=${String(input)}`);
				strictEqual(isEvidenceLabelFromMatrix(input), expected, `input=${String(input)}`);
			}
		});

		test('isParityVerdict: evidence.ts (duplicate) and matrix.ts (authority) agree', () => {
			for (const [input, expected] of VERDICT_BATTERY) {
				strictEqual(isParityVerdict(input), expected, `input=${String(input)}`);
				strictEqual(isParityVerdictFromMatrix(input), expected, `input=${String(input)}`);
			}
		});
	});
});
