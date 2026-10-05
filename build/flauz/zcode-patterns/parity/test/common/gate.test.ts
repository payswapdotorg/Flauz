/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/test/common/gate.test.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- gate contracts tests
 * ----------------------------------------------------------------------------
 *
 * TDD pin suite for common/gate.ts (mocha tdd, node:assert/strict, .js
 * import suffixes, tab indentation, ASCII only).
 *
 * Pins: the gate-check table, check-status vocabulary, and overall-verdict
 * vocabulary (authorities -- verbatim, frozen); gate.ts's duplicated
 * domain/verdict/label vocabularies deep-equal against the matrix and
 * evidence authorities; the duplicated guards behaviorally identical to
 * the originals; the DomainComparisonSummary and GateCheckRecord guards;
 * aggregateVerdict() across the complete run, the absence derivation,
 * failure naming, first-wins duplicates, malformed counting, and the
 * unmeasured-check fail-closed law; and isPhaseCVerdictRecord -- the
 * never-fabricate guard -- against genuine aggregates and every lying
 * mutation of them this suite can construct.
 *
 * Integration (projection law): real matrix.ts DomainComparisonRecord
 * values -- verdicts derived by matrix.ts's own verdictFor() -- pass the
 * gate summary reader and aggregate to phase-c-complete under four green
 * checks; the impossible record (label none, verdict parity-confirmed)
 * is rejected by BOTH the matrix guard and the gate reader.
 *
 * MIT License. Full text: LICENSE at the repository root.
 * ----------------------------------------------------------------------------
 */

import { deepEqual, strictEqual } from 'node:assert/strict';

import {
	EVIDENCE_LABELS,
	GATE_CHECK_IDS,
	GATE_CHECK_STATUSES,
	PARITY_DOMAINS,
	PARITY_VERDICTS,
	PHASE_C_OVERALL_VERDICTS,
	ZCODE_PARITY_CONTRACTS_VERSION,
	aggregateVerdict,
	isDomainComparisonSummary,
	isEvidenceLabel,
	isGateCheckId,
	isGateCheckRecord,
	isGateCheckStatus,
	isParityDomain,
	isParityScope,
	isParityVerdict,
	isPhaseCOverallVerdict,
	isPhaseCVerdictRecord,
} from '../../common/gate.js';
import {
	EVIDENCE_LABELS as LABELS_FROM_MATRIX,
	PARITY_DOMAINS as DOMAINS_FROM_MATRIX,
	PARITY_VERDICTS as VERDICTS_FROM_MATRIX,
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_MATRIX,
	isDomainComparisonRecord,
	isEvidenceLabel as isEvidenceLabelFromMatrix,
	isParityDomain as isParityDomainFromMatrix,
	isParityScope as isParityScopeFromMatrix,
	isParityVerdict as isParityVerdictFromMatrix,
	verdictFor,
} from '../../common/matrix.js';
import {
	EVIDENCE_LABELS as LABELS_FROM_EVIDENCE,
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_EVIDENCE,
} from '../../common/evidence.js';
import type {
	DomainComparisonSummary,
	EvidenceLabel,
	GateCheckId,
	GateCheckRecord,
	GateCheckStatus,
	ParityDomain,
	ParityScope,
	ParityVerdict,
	PhaseCVerdictRecord,
} from '../../common/gate.js';
import type { DomainComparisonRecord } from '../../common/matrix.js';

// ---------------------------------------------------------------------------
// Fixtures (deterministic plain strings; digests and statuses are injected,
// never computed -- no Date.now, no new Date() anywhere in this suite).
// ---------------------------------------------------------------------------

const SCOPE: ParityScope = { workspaceId: 'ws-zc010', tenantId: 'tenant-flauz' };
const OTHER_SCOPE: ParityScope = { workspaceId: 'ws-other', tenantId: 'tenant-flauz' };

/** The two domains carried as parity-partial in the perfect-run fixture. */
const PARTIAL_DOMAINS: ReadonlyArray<ParityDomain> = ['exploration', 'memory'];

function qualifyingRow(domain: ParityDomain): DomainComparisonSummary {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		domain,
		verdict: 'parity-confirmed',
		evidenceLabel: 'test-suite-green',
	};
}

function partialRow(domain: ParityDomain): DomainComparisonSummary {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		domain,
		verdict: 'parity-partial',
		evidenceLabel: 'authority-mirrored',
	};
}

function divergentRow(domain: ParityDomain): DomainComparisonSummary {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		domain,
		verdict: 'parity-divergent',
		evidenceLabel: 'authority-mirrored',
	};
}

function unmeasuredRow(domain: ParityDomain): DomainComparisonSummary {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		domain,
		verdict: 'parity-unmeasured',
		evidenceLabel: 'none',
	};
}

/** A structurally garbage domain row (unknown domain): malformed-count fodder. */
function garbageDomainRow(): unknown {
	return { ...qualifyingRow('coding'), domain: 'time-travel' };
}

function checkWithStatus(checkId: GateCheckId, status: GateCheckStatus): GateCheckRecord {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		checkId,
		status,
		detailDigest: `detail-${checkId}-${status}`,
	};
}

function allGreenChecks(): GateCheckRecord[] {
	return GATE_CHECK_IDS.map((checkId) => checkWithStatus(checkId, 'green'));
}

/** One full ten-domain qualifying row set (eight confirmed, two partial). */
function perfectRows(): DomainComparisonSummary[] {
	return PARITY_DOMAINS.map((domain) =>
		PARTIAL_DOMAINS.includes(domain) ? partialRow(domain) : qualifyingRow(domain),
	);
}

/** A real matrix.ts record: verdict derived by matrix.ts's own verdictFor(). */
function matrixRow(
	domain: ParityDomain,
	zcodeDigest: string | undefined,
	serviceDigest: string | undefined,
	evidence: EvidenceLabel,
): DomainComparisonRecord {
	return {
		scope: SCOPE,
		contractVersion: VERSION_FROM_MATRIX,
		domain,
		zcodeSurfaceDigest: zcodeDigest,
		serviceSurfaceDigest: serviceDigest,
		evidenceLabel: evidence,
		verdict: verdictFor(domain, zcodeDigest, serviceDigest, evidence),
	};
}

const MATRIX_ROWS: ReadonlyArray<DomainComparisonRecord> = PARITY_DOMAINS.map((domain) =>
	PARTIAL_DOMAINS.includes(domain)
		? matrixRow(domain, `digest-zc-${domain}`, undefined, 'authority-mirrored')
		: matrixRow(domain, `digest-both-${domain}`, `digest-both-${domain}`, 'test-suite-green'),
);

// -- Genuine aggregates (built once; reused by the guard battery). --------

const PERFECT_ROWS = perfectRows();
const GREEN_CHECKS = allGreenChecks();

const PERFECT = aggregateVerdict(SCOPE, PERFECT_ROWS, GREEN_CHECKS);
const EMPTY = aggregateVerdict(SCOPE, [], []);
const MISSING_DOMAIN_AGG = aggregateVerdict(
	SCOPE,
	PERFECT_ROWS.filter((row) => row.domain !== 'browser-computer-use'),
	GREEN_CHECKS,
);
const DIVERGENT_AGG = aggregateVerdict(
	SCOPE,
	PERFECT_ROWS.map((row) => (row.domain === 'memory' ? divergentRow('memory') : row)),
	GREEN_CHECKS,
);
const RED_CHECK_AGG = aggregateVerdict(
	SCOPE,
	PERFECT_ROWS,
	GREEN_CHECKS.map((check) =>
		check.checkId === 'evidence-labels' ? checkWithStatus('evidence-labels', 'red') : check,
	),
);
const UNMEASURED_CHECK_AGG = aggregateVerdict(
	SCOPE,
	PERFECT_ROWS,
	GREEN_CHECKS.map((check) =>
		check.checkId === 'discovery-a11y' ? checkWithStatus('discovery-a11y', 'unmeasured') : check,
	),
);
const MISSING_CHECK_AGG = aggregateVerdict(
	SCOPE,
	PERFECT_ROWS,
	GREEN_CHECKS.filter((check) => check.checkId !== 'existing-gates'),
);
const DUP_DOMAIN_AGG = aggregateVerdict(SCOPE, [...PERFECT_ROWS, divergentRow('memory')], GREEN_CHECKS);
const MALFORMED_AGG = aggregateVerdict(SCOPE, [...PERFECT_ROWS, garbageDomainRow()], GREEN_CHECKS);

/** Spread the perfect aggregate and override fields: guard fodder. */
function verdictVariant(overrides: Record<string, unknown>): unknown {
	return { ...PERFECT, ...overrides };
}

/** Rebuild a verdict record with one domainVerdicts entry overridden. */
function withDomainVerdictAt(record: PhaseCVerdictRecord, rank: number, verdict: ParityVerdict): unknown {
	const domainVerdicts = record.domainVerdicts.map((entry, index) =>
		index === rank ? { domain: entry.domain, verdict } : { ...entry },
	);
	return { ...record, domainVerdicts };
}

/** Rebuild a verdict record with one checkStatuses entry overridden. */
function withCheckStatusAt(record: PhaseCVerdictRecord, rank: number, status: GateCheckStatus): unknown {
	const checkStatuses = record.checkStatuses.map((entry, index) =>
		index === rank ? { checkId: entry.checkId, status } : { ...entry },
	);
	return { ...record, checkStatuses };
}

suite('zc010 parity gate contracts', () => {
	suite('contract set version and lockstep', () => {
		test('ZCODE_PARITY_CONTRACTS_VERSION is pinned to 1.0.0', () => {
			strictEqual(ZCODE_PARITY_CONTRACTS_VERSION, '1.0.0');
		});

		test('common/matrix.ts exports the same contract set version (lockstep law)', () => {
			strictEqual(VERSION_FROM_MATRIX, ZCODE_PARITY_CONTRACTS_VERSION);
		});

		test('common/evidence.ts exports the same contract set version (lockstep law)', () => {
			strictEqual(VERSION_FROM_EVIDENCE, ZCODE_PARITY_CONTRACTS_VERSION);
		});
	});

	suite('GATE_CHECK_IDS -- the frozen gate-check table (authority)', () => {
		test('pins the four checks in canonical order', () => {
			deepEqual(GATE_CHECK_IDS, ['targeted-tests', 'evidence-labels', 'discovery-a11y', 'existing-gates']);
			strictEqual(GATE_CHECK_IDS.length, 4);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(GATE_CHECK_IDS), true);
		});

		test('isGateCheckId accepts the four checks and rejects everything else', () => {
			for (const checkId of GATE_CHECK_IDS) {
				strictEqual(isGateCheckId(checkId), true);
			}
			strictEqual(isGateCheckId('smoke-tests'), false);
			strictEqual(isGateCheckId(''), false);
			strictEqual(isGateCheckId(42), false);
			strictEqual(isGateCheckId(null), false);
			strictEqual(isGateCheckId(undefined), false);
		});

		test('narrows arrays via its type predicate', () => {
			const narrowed: readonly GateCheckId[] = ['targeted-tests', 'not-a-check', 'existing-gates'].filter(isGateCheckId);
			deepEqual(narrowed, ['targeted-tests', 'existing-gates']);
		});
	});

	suite('GATE_CHECK_STATUSES -- the frozen status vocabulary (authority)', () => {
		test('pins the three statuses in canonical order', () => {
			deepEqual(GATE_CHECK_STATUSES, ['green', 'red', 'unmeasured']);
			strictEqual(GATE_CHECK_STATUSES.length, 3);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(GATE_CHECK_STATUSES), true);
		});

		test('isGateCheckStatus accepts the three statuses and rejects everything else', () => {
			for (const status of GATE_CHECK_STATUSES) {
				strictEqual(isGateCheckStatus(status), true);
			}
			strictEqual(isGateCheckStatus('amber'), false);
			strictEqual(isGateCheckStatus('GREEN'), false);
			strictEqual(isGateCheckStatus(''), false);
			strictEqual(isGateCheckStatus(42), false);
			strictEqual(isGateCheckStatus(null), false);
			strictEqual(isGateCheckStatus(undefined), false);
		});
	});

	suite('PHASE_C_OVERALL_VERDICTS -- the frozen overall vocabulary (authority)', () => {
		test('pins the two overall verdicts', () => {
			deepEqual(PHASE_C_OVERALL_VERDICTS, ['phase-c-complete', 'phase-c-incomplete']);
			strictEqual(PHASE_C_OVERALL_VERDICTS.length, 2);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(PHASE_C_OVERALL_VERDICTS), true);
		});

		test('isPhaseCOverallVerdict accepts the two verdicts and rejects everything else', () => {
			strictEqual(isPhaseCOverallVerdict('phase-c-complete'), true);
			strictEqual(isPhaseCOverallVerdict('phase-c-incomplete'), true);
			strictEqual(isPhaseCOverallVerdict('phase-c-flawless'), false);
			strictEqual(isPhaseCOverallVerdict(''), false);
			strictEqual(isPhaseCOverallVerdict(42), false);
			strictEqual(isPhaseCOverallVerdict(null), false);
			strictEqual(isPhaseCOverallVerdict(undefined), false);
		});
	});

	suite('duplicated vocabularies pin against their authorities (zero-dependency law)', () => {
		test('PARITY_DOMAINS equals the matrix authority verbatim', () => {
			deepEqual(PARITY_DOMAINS, DOMAINS_FROM_MATRIX);
		});

		test('PARITY_VERDICTS equals the matrix authority verbatim', () => {
			deepEqual(PARITY_VERDICTS, VERDICTS_FROM_MATRIX);
		});

		test('EVIDENCE_LABELS equals both the matrix duplicate and the evidence authority', () => {
			deepEqual(EVIDENCE_LABELS, LABELS_FROM_MATRIX);
			deepEqual(EVIDENCE_LABELS, LABELS_FROM_EVIDENCE);
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

		const DOMAIN_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['coding', true],
			['capability-discovery', true],
			['time-travel', false],
			['Coding', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		const VERDICT_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['parity-confirmed', true],
			['parity-unmeasured', true],
			['parity-flawless', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		const LABEL_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['test-suite-green', true],
			['none', true],
			['vibes-only', false],
			['NONE', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		test('isParityScope: gate.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of SCOPE_BATTERY) {
				strictEqual(isParityScope(input), expected, `input=${String(input)}`);
				strictEqual(isParityScopeFromMatrix(input), expected, `input=${String(input)}`);
			}
		});

		test('isParityDomain: gate.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of DOMAIN_BATTERY) {
				strictEqual(isParityDomain(input), expected, `input=${String(input)}`);
				strictEqual(isParityDomainFromMatrix(input), expected, `input=${String(input)}`);
			}
		});

		test('isParityVerdict: gate.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of VERDICT_BATTERY) {
				strictEqual(isParityVerdict(input), expected, `input=${String(input)}`);
				strictEqual(isParityVerdictFromMatrix(input), expected, `input=${String(input)}`);
			}
		});

		test('isEvidenceLabel: gate.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of LABEL_BATTERY) {
				strictEqual(isEvidenceLabel(input), expected, `input=${String(input)}`);
				strictEqual(isEvidenceLabelFromMatrix(input), expected, `input=${String(input)}`);
			}
		});
	});
	suite('isDomainComparisonSummary -- the aggregation reader guard', () => {
		test('accepts rows across the verdict space, including unmeasured with real evidence', () => {
			strictEqual(isDomainComparisonSummary(qualifyingRow('coding')), true);
			strictEqual(isDomainComparisonSummary(partialRow('exploration')), true);
			strictEqual(isDomainComparisonSummary(divergentRow('memory')), true);
			strictEqual(isDomainComparisonSummary(unmeasuredRow('hooks')), true);
			// An unmeasured verdict with real evidence present is honest
			// (labelBacksVerdict semantics: non-none labels back all verdicts).
			strictEqual(
				isDomainComparisonSummary({ ...unmeasuredRow('hooks'), evidenceLabel: 'contract-pinned' }),
				true,
			);
		});

		test('accepts a full matrix.ts record (extra digest fields tolerated)', () => {
			strictEqual(isDomainComparisonSummary(matrixRow('coding', 'd1', 'd1', 'test-suite-green')), true);
		});

		test('rejects non-objects', () => {
			strictEqual(isDomainComparisonSummary(null), false);
			strictEqual(isDomainComparisonSummary(undefined), false);
			strictEqual(isDomainComparisonSummary('row'), false);
			strictEqual(isDomainComparisonSummary(42), false);
			strictEqual(isDomainComparisonSummary([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), scope: null }), false);
			strictEqual(
				isDomainComparisonSummary({ ...qualifyingRow('coding'), scope: { workspaceId: '', tenantId: 't' } }),
				false,
			);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), contractVersion: '0.9.0' }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), contractVersion: '1.0.1' }), false);
		});

		test('rejects unknown domain, verdict, or label', () => {
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), domain: 'time-travel' }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), domain: undefined }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), verdict: 'parity-flawless' }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), verdict: undefined }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), evidenceLabel: 'gut-feeling' }), false);
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), evidenceLabel: undefined }), false);
		});

		test('rejects the honesty violation: label none with any measured verdict', () => {
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), evidenceLabel: 'none' }), false);
			strictEqual(isDomainComparisonSummary({ ...partialRow('exploration'), evidenceLabel: 'none' }), false);
			strictEqual(isDomainComparisonSummary({ ...divergentRow('memory'), evidenceLabel: 'none' }), false);
			// none + parity-unmeasured is the only honest pairing.
			strictEqual(isDomainComparisonSummary(unmeasuredRow('hooks')), true);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isDomainComparisonSummary({ ...qualifyingRow('coding'), capturedBy: 'probe' }), true);
		});
	});

	suite('isGateCheckRecord -- the check record guard', () => {
		test('accepts records across the status vocabulary', () => {
			for (const status of GATE_CHECK_STATUSES) {
				strictEqual(isGateCheckRecord(checkWithStatus('existing-gates', status)), true);
			}
		});

		test('rejects non-objects', () => {
			strictEqual(isGateCheckRecord(null), false);
			strictEqual(isGateCheckRecord(undefined), false);
			strictEqual(isGateCheckRecord('check'), false);
			strictEqual(isGateCheckRecord(42), false);
			strictEqual(isGateCheckRecord([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), scope: null }), false);
			strictEqual(
				isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), scope: { workspaceId: 'w' } }),
				false,
			);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), contractVersion: '2.0.0' }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), contractVersion: '' }), false);
		});

		test('rejects an unknown checkId or status', () => {
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), checkId: 'smoke-tests' }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), status: 'amber' }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), checkId: undefined }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), status: undefined }), false);
		});

		test('rejects an empty or non-string detailDigest (an unbacked check backs nothing)', () => {
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), detailDigest: '' }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), detailDigest: 42 }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), detailDigest: null }), false);
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), detailDigest: undefined }), false);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isGateCheckRecord({ ...checkWithStatus('targeted-tests', 'green'), runBy: 'tl' }), true);
		});
	});

	suite('aggregateVerdict -- the complete run', () => {
		test('all ten domains qualifying and all four checks green -> phase-c-complete', () => {
			strictEqual(PERFECT.overall, 'phase-c-complete');
			deepEqual(PERFECT.missingDomains, []);
			deepEqual(PERFECT.duplicateDomains, []);
			deepEqual(PERFECT.failingDomains, []);
			deepEqual(PERFECT.missingChecks, []);
			deepEqual(PERFECT.duplicateChecks, []);
			deepEqual(PERFECT.failingChecks, []);
			strictEqual(PERFECT.malformedDomainRecords, 0);
			strictEqual(PERFECT.malformedCheckRecords, 0);
		});

		test('domainVerdicts cover exactly the ten frozen domains in table order', () => {
			deepEqual(
				PERFECT.domainVerdicts,
				PARITY_DOMAINS.map((domain) => ({
					domain,
					verdict: PARTIAL_DOMAINS.includes(domain) ? 'parity-partial' : 'parity-confirmed',
				})),
			);
		});

		test('checkStatuses cover exactly the four frozen checks in table order', () => {
			deepEqual(PERFECT.checkStatuses, GATE_CHECK_IDS.map((checkId) => ({ checkId, status: 'green' })));
		});

		test('parity-partial qualifies: an all-partial row set still completes', () => {
			const allPartial = aggregateVerdict(SCOPE, PARITY_DOMAINS.map((domain) => partialRow(domain)), GREEN_CHECKS);
			strictEqual(allPartial.overall, 'phase-c-complete');
		});

		test('the perfect run passes isPhaseCVerdictRecord', () => {
			strictEqual(isPhaseCVerdictRecord(PERFECT), true);
		});

		test('pure function: identical inputs give identical output, inputs unmutated', () => {
			const rows = perfectRows();
			const snapshot = rows.map((row) => ({ ...row }));
			const first = aggregateVerdict(SCOPE, rows, allGreenChecks());
			const second = aggregateVerdict(SCOPE, rows, allGreenChecks());
			deepEqual(first, second);
			deepEqual(rows, snapshot);
			strictEqual(first.overall, 'phase-c-complete');
		});

		test('shuffled input order yields the identical canonical output', () => {
			const shuffled = aggregateVerdict(SCOPE, [...PERFECT_ROWS].reverse(), [...GREEN_CHECKS].reverse());
			deepEqual(shuffled, PERFECT);
		});
	});

	suite('aggregateVerdict -- absence derivation and failure naming', () => {
		test('empty inputs: every domain unmeasured-and-named, every check unmeasured-and-named', () => {
			strictEqual(EMPTY.overall, 'phase-c-incomplete');
			deepEqual(EMPTY.missingDomains, [...PARITY_DOMAINS]);
			deepEqual(
				EMPTY.domainVerdicts,
				PARITY_DOMAINS.map((domain) => ({ domain, verdict: 'parity-unmeasured' })),
			);
			deepEqual(EMPTY.missingChecks, [...GATE_CHECK_IDS]);
			deepEqual(EMPTY.checkStatuses, GATE_CHECK_IDS.map((checkId) => ({ checkId, status: 'unmeasured' })));
			deepEqual(EMPTY.failingDomains, []);
			deepEqual(EMPTY.failingChecks, []);
			deepEqual(EMPTY.duplicateDomains, []);
			deepEqual(EMPTY.duplicateChecks, []);
			strictEqual(EMPTY.malformedDomainRecords, 0);
			strictEqual(EMPTY.malformedCheckRecords, 0);
		});

		test('one absent domain: named in missingDomains, verdict parity-unmeasured, never guessed', () => {
			strictEqual(MISSING_DOMAIN_AGG.overall, 'phase-c-incomplete');
			deepEqual(MISSING_DOMAIN_AGG.missingDomains, ['browser-computer-use']);
			const entry = MISSING_DOMAIN_AGG.domainVerdicts.find(
				(candidate) => candidate.domain === 'browser-computer-use',
			);
			strictEqual(entry?.verdict, 'parity-unmeasured');
			deepEqual(MISSING_DOMAIN_AGG.failingDomains, []);
		});

		test('a present unmeasured row is FAILING, not missing (present but non-qualifying)', () => {
			const rows = PERFECT_ROWS.map((row) => (row.domain === 'memory' ? unmeasuredRow('memory') : row));
			const agg = aggregateVerdict(SCOPE, rows, GREEN_CHECKS);
			strictEqual(agg.overall, 'phase-c-incomplete');
			deepEqual(agg.missingDomains, []);
			deepEqual(agg.failingDomains, ['memory']);
		});

		test('a divergent row is named in failingDomains', () => {
			strictEqual(DIVERGENT_AGG.overall, 'phase-c-incomplete');
			deepEqual(DIVERGENT_AGG.failingDomains, ['memory']);
			deepEqual(DIVERGENT_AGG.missingDomains, []);
		});

		test('one absent check: named in missingChecks, status unmeasured, never fabricated green', () => {
			strictEqual(MISSING_CHECK_AGG.overall, 'phase-c-incomplete');
			deepEqual(MISSING_CHECK_AGG.missingChecks, ['existing-gates']);
			const entry = MISSING_CHECK_AGG.checkStatuses.find((candidate) => candidate.checkId === 'existing-gates');
			strictEqual(entry?.status, 'unmeasured');
			deepEqual(MISSING_CHECK_AGG.failingChecks, []);
		});

		test('a red check is named in failingChecks and reported verbatim', () => {
			strictEqual(RED_CHECK_AGG.overall, 'phase-c-incomplete');
			deepEqual(RED_CHECK_AGG.failingChecks, ['evidence-labels']);
			deepEqual(RED_CHECK_AGG.missingChecks, []);
			const entry = RED_CHECK_AGG.checkStatuses.find((candidate) => candidate.checkId === 'evidence-labels');
			strictEqual(entry?.status, 'red');
		});

		test('THE LAW: an unmeasured check fails closed -- incomplete, reported verbatim, never green', () => {
			strictEqual(UNMEASURED_CHECK_AGG.overall, 'phase-c-incomplete');
			deepEqual(UNMEASURED_CHECK_AGG.failingChecks, ['discovery-a11y']);
			deepEqual(UNMEASURED_CHECK_AGG.missingChecks, []);
			const entry = UNMEASURED_CHECK_AGG.checkStatuses.find((candidate) => candidate.checkId === 'discovery-a11y');
			strictEqual(entry?.status, 'unmeasured');
		});
	});

	suite('aggregateVerdict -- duplicates and malformed counting', () => {
		test('a duplicate domain row flags the domain; the FIRST record wins, deterministically', () => {
			strictEqual(DUP_DOMAIN_AGG.overall, 'phase-c-incomplete');
			deepEqual(DUP_DOMAIN_AGG.duplicateDomains, ['memory']);
			deepEqual(DUP_DOMAIN_AGG.missingDomains, []);
			deepEqual(DUP_DOMAIN_AGG.failingDomains, []);
			const entry = DUP_DOMAIN_AGG.domainVerdicts.find((candidate) => candidate.domain === 'memory');
			strictEqual(entry?.verdict, 'parity-partial');
		});

		test('a duplicate check record flags the check; the FIRST status wins', () => {
			const agg = aggregateVerdict(SCOPE, PERFECT_ROWS, [...GREEN_CHECKS, checkWithStatus('targeted-tests', 'red')]);
			strictEqual(agg.overall, 'phase-c-incomplete');
			deepEqual(agg.duplicateChecks, ['targeted-tests']);
			const entry = agg.checkStatuses.find((candidate) => candidate.checkId === 'targeted-tests');
			strictEqual(entry?.status, 'green');
		});

		test('an unknown-domain row is counted malformed and appears in NO list', () => {
			strictEqual(MALFORMED_AGG.overall, 'phase-c-incomplete');
			strictEqual(MALFORMED_AGG.malformedDomainRecords, 1);
			deepEqual(MALFORMED_AGG.missingDomains, []);
			deepEqual(MALFORMED_AGG.failingDomains, []);
		});

		test('a foreign-versioned row is counted malformed', () => {
			const agg = aggregateVerdict(
				SCOPE,
				[...PERFECT_ROWS, { ...qualifyingRow('coding'), contractVersion: '0.9.0' }],
				GREEN_CHECKS,
			);
			strictEqual(agg.malformedDomainRecords, 1);
			strictEqual(agg.overall, 'phase-c-incomplete');
		});

		test('a scope-mismatched row is counted malformed and leaves its domain MISSING', () => {
			const rows = PERFECT_ROWS.map((row) => (row.domain === 'hooks' ? { ...row, scope: OTHER_SCOPE } : row));
			const agg = aggregateVerdict(SCOPE, rows, GREEN_CHECKS);
			strictEqual(agg.malformedDomainRecords, 1);
			deepEqual(agg.missingDomains, ['hooks']);
			strictEqual(agg.overall, 'phase-c-incomplete');
		});

		test('a dishonest row (label none, verdict confirmed) is counted malformed, never placed', () => {
			const rows = [...PERFECT_ROWS, { ...qualifyingRow('memory'), evidenceLabel: 'none' }];
			const agg = aggregateVerdict(SCOPE, rows, GREEN_CHECKS);
			strictEqual(agg.malformedDomainRecords, 1);
			deepEqual(agg.missingDomains, []);
			const entry = agg.domainVerdicts.find((candidate) => candidate.domain === 'memory');
			strictEqual(entry?.verdict, 'parity-partial');
		});

		test('a check with an empty detailDigest is counted malformed and never places', () => {
			const checks = [...GREEN_CHECKS, { ...checkWithStatus('targeted-tests', 'green'), detailDigest: '' }];
			const agg = aggregateVerdict(SCOPE, PERFECT_ROWS, checks);
			strictEqual(agg.malformedCheckRecords, 1);
			deepEqual(agg.duplicateChecks, []);
			strictEqual(agg.overall, 'phase-c-incomplete');
		});
	});

	suite('aggregateVerdict -- integration with matrix.ts records (projection law)', () => {
		test('matrix.ts records pass BOTH the matrix guard and the gate summary reader', () => {
			for (const row of MATRIX_ROWS) {
				strictEqual(isDomainComparisonRecord(row), true);
				strictEqual(isDomainComparisonSummary(row), true);
			}
		});

		test('ten matrix records + four green checks aggregate to phase-c-complete', () => {
			const agg = aggregateVerdict(SCOPE, MATRIX_ROWS, GREEN_CHECKS);
			strictEqual(agg.overall, 'phase-c-complete');
			strictEqual(isPhaseCVerdictRecord(agg), true);
		});

		test('a matrix unmeasured row (label none, verdict unmeasured) is failing, not missing', () => {
			const rows = MATRIX_ROWS.map((row) =>
				row.domain === 'exploration' ? matrixRow('exploration', undefined, undefined, 'none') : row,
			);
			const agg = aggregateVerdict(SCOPE, rows, GREEN_CHECKS);
			strictEqual(agg.overall, 'phase-c-incomplete');
			deepEqual(agg.missingDomains, []);
			deepEqual(agg.failingDomains, ['exploration']);
		});

		test('the impossible record (label none, verdict parity-confirmed) is rejected by BOTH guards', () => {
			const impossible = { ...matrixRow('coding', 'd1', 'd1', 'test-suite-green'), evidenceLabel: 'none' };
			strictEqual(isDomainComparisonRecord(impossible), false);
			strictEqual(isDomainComparisonSummary(impossible), false);
		});
	});

	suite('isPhaseCVerdictRecord -- the never-fabricate guard', () => {
		const GENUINE_AGGREGATES: ReadonlyArray<PhaseCVerdictRecord> = [
			PERFECT,
			EMPTY,
			MISSING_DOMAIN_AGG,
			DIVERGENT_AGG,
			RED_CHECK_AGG,
			UNMEASURED_CHECK_AGG,
			MISSING_CHECK_AGG,
			DUP_DOMAIN_AGG,
			MALFORMED_AGG,
		];

		test('accepts every genuine aggregate this suite constructs (complete and incomplete)', () => {
			for (const agg of GENUINE_AGGREGATES) {
				strictEqual(isPhaseCVerdictRecord(agg), true);
			}
		});

		test('rejects non-objects', () => {
			strictEqual(isPhaseCVerdictRecord(null), false);
			strictEqual(isPhaseCVerdictRecord(undefined), false);
			strictEqual(isPhaseCVerdictRecord('verdict'), false);
			strictEqual(isPhaseCVerdictRecord(42), false);
			strictEqual(isPhaseCVerdictRecord([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ scope: null })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ scope: { workspaceId: '', tenantId: 't' } })), false);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ contractVersion: '0.9.0' })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ contractVersion: undefined })), false);
		});

		test('rejects an overall outside the frozen vocabulary', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ overall: 'phase-c-flawless' })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ overall: 42 })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ overall: undefined })), false);
		});

		test('rejects invalid malformed counters', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ malformedDomainRecords: -1 })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ malformedDomainRecords: 1.5 })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ malformedCheckRecords: '1' })), false);
		});

		test('rejects domainVerdicts of the wrong length', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ domainVerdicts: PERFECT.domainVerdicts.slice(0, 9) })), false);
		});

		test('rejects domainVerdicts out of table order', () => {
			const [first, second, ...rest] = PERFECT.domainVerdicts;
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ domainVerdicts: [second, first, ...rest] })), false);
		});

		test('rejects a missing domain whose verdict is not parity-unmeasured', () => {
			strictEqual(isPhaseCVerdictRecord(withDomainVerdictAt(EMPTY, 0, 'parity-partial')), false);
			strictEqual(isPhaseCVerdictRecord(withDomainVerdictAt(EMPTY, 3, 'parity-confirmed')), false);
		});

		test('rejects a missing domain also listed in failingDomains', () => {
			strictEqual(isPhaseCVerdictRecord({ ...EMPTY, failingDomains: ['coding'] }), false);
		});

		test('rejects a qualifying domain listed in failingDomains', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingDomains: ['coding'] })), false);
		});

		test('rejects a failing domain silently dropped from failingDomains (never silent)', () => {
			strictEqual(isPhaseCVerdictRecord({ ...DIVERGENT_AGG, failingDomains: [] }), false);
		});

		test('rejects a missing check whose status is not unmeasured', () => {
			strictEqual(isPhaseCVerdictRecord(withCheckStatusAt(EMPTY, 0, 'green')), false);
			strictEqual(isPhaseCVerdictRecord(withCheckStatusAt(EMPTY, 3, 'red')), false);
		});

		test('rejects a green check listed in failingChecks', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingChecks: ['targeted-tests'] })), false);
		});

		test('rejects a red check silently dropped from failingChecks (never silent)', () => {
			strictEqual(isPhaseCVerdictRecord({ ...RED_CHECK_AGG, failingChecks: [] }), false);
		});

		test('rejects a table entry listed as both missing and duplicate', () => {
			strictEqual(isPhaseCVerdictRecord({ ...EMPTY, duplicateDomains: ['coding'] }), false);
		});

		test('rejects non-canonical failure lists (out of order, duplicated, foreign, non-array)', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingDomains: ['memory', 'coding'] })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingDomains: ['coding', 'coding'] })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingDomains: ['time-travel'] })), false);
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ failingDomains: 'coding' })), false);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ evaluatedBy: 'tl', runId: 'zc010' })), true);
		});

		test('rejects FABRICATED completion: incomplete aggregates flipped to phase-c-complete', () => {
			strictEqual(isPhaseCVerdictRecord({ ...DIVERGENT_AGG, overall: 'phase-c-complete' }), false);
			strictEqual(isPhaseCVerdictRecord({ ...EMPTY, overall: 'phase-c-complete' }), false);
			strictEqual(isPhaseCVerdictRecord({ ...UNMEASURED_CHECK_AGG, overall: 'phase-c-complete' }), false);
		});

		test('rejects LYING incompleteness: the clean aggregate flipped to phase-c-incomplete', () => {
			strictEqual(isPhaseCVerdictRecord(verdictVariant({ overall: 'phase-c-incomplete' })), false);
		});
	});
});
