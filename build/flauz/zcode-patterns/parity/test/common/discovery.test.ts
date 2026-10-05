/**
 * ----------------------------------------------------------------------------
 * build/flauz/zcode-patterns/parity/test/common/discovery.test.ts
 * ZC-010 -- ZCode Parity and Quality Gate (Phase C) -- discovery contracts tests
 * ----------------------------------------------------------------------------
 *
 * TDD pin suite for common/discovery.ts (mocha tdd, node:assert/strict, .js
 * import suffixes, tab indentation, ASCII only).
 *
 * Pins: the discovery/a11y check table and the outcome vocabulary
 * (authorities -- verbatim, frozen); the contract set version in lockstep
 * with matrix.ts, evidence.ts, and gate.ts; the duplicated gate-check
 * status vocabulary deep-equal against the gate authority; the duplicated
 * guards behaviorally identical to their originals; the DiscoveryCheckRecord
 * artifact law (evidence both ways -- a pass cites its proof, a fail cites
 * where the failure was observed); the discoveryStatusFor() fail-closed
 * derivation (a missing artifact is unmeasured on either outcome, never
 * green); and the discoveryStatusTable() projection -- canonical table
 * order, first-valid-wins placement, absence derived as unmeasured and
 * never guessed -- together with the documented fold law: the repo-side
 * discovery-a11y gate check is green only when all four entries are green.
 *
 * MIT License. Full text: LICENSE at the repository root.
 * ----------------------------------------------------------------------------
 */

import { deepEqual, strictEqual } from 'node:assert/strict';

import {
	DISCOVERY_CHECKS,
	DISCOVERY_OUTCOMES,
	GATE_CHECK_STATUSES,
	ZCODE_PARITY_CONTRACTS_VERSION,
	discoveryStatusFor,
	discoveryStatusTable,
	isDiscoveryCheckId,
	isDiscoveryCheckRecord,
	isDiscoveryOutcome,
	isGateCheckStatus,
	isParityScope,
} from '../../common/discovery.js';
import {
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_MATRIX,
	isParityScope as isParityScopeFromMatrix,
} from '../../common/matrix.js';
import { ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_EVIDENCE } from '../../common/evidence.js';
import {
	GATE_CHECK_STATUSES as STATUSES_FROM_GATE,
	ZCODE_PARITY_CONTRACTS_VERSION as VERSION_FROM_GATE,
	isGateCheckStatus as isGateCheckStatusFromGate,
} from '../../common/gate.js';
import type {
	DiscoveryCheckId,
	DiscoveryCheckRecord,
	DiscoveryOutcome,
	DiscoveryStatusEntry,
	ParityScope,
} from '../../common/discovery.js';

// ---------------------------------------------------------------------------
// Fixtures (deterministic plain strings; outcomes and artifacts are injected,
// never established -- no Date.now, no new Date() anywhere in this suite).
// ---------------------------------------------------------------------------

const SCOPE: ParityScope = { workspaceId: 'ws-zc010', tenantId: 'tenant-flauz' };

/** A valid observation factory: scope + version + injected outcome + artifact. */
function observed(
	checkId: DiscoveryCheckId,
	outcome: DiscoveryOutcome,
	artifactRef: string = `artifact-${checkId}`,
): DiscoveryCheckRecord {
	return {
		scope: SCOPE,
		contractVersion: ZCODE_PARITY_CONTRACTS_VERSION,
		checkId,
		observedOutcome: outcome,
		artifactRef,
	};
}

const PASSING: DiscoveryCheckRecord = observed(
	'surface-indexed',
	'pass',
	'build/flauz/zcode-patterns/parity/README.md',
);

const FAILING: DiscoveryCheckRecord = observed(
	'a11y-law-annotated',
	'fail',
	'docs/FLAUZ-PROGRAM/ARCHITECTURE-LOCK.md',
);

/** Spread the passing record and override fields with garbage: guard fodder. */
function variant(overrides: Record<string, unknown>): unknown {
	return { ...PASSING, ...overrides };
}

/** All four frozen checks observed as passing. */
const ALL_PASSING: ReadonlyArray<DiscoveryCheckRecord> = DISCOVERY_CHECKS.map((checkId) =>
	observed(checkId, 'pass'),
);

suite('zc010 parity discovery contracts', () => {
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

		test('common/gate.ts exports the same contract set version (lockstep law)', () => {
			strictEqual(VERSION_FROM_GATE, ZCODE_PARITY_CONTRACTS_VERSION);
		});
	});

	suite('DISCOVERY_CHECKS -- the frozen discovery/a11y table (authority)', () => {
		test('pins the four checks in canonical order', () => {
			deepEqual(DISCOVERY_CHECKS, [
				'surface-indexed',
				'contract-discoverable',
				'journey-documented',
				'a11y-law-annotated',
			]);
			strictEqual(DISCOVERY_CHECKS.length, 4);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(DISCOVERY_CHECKS), true);
		});

		test('isDiscoveryCheckId accepts the four checks and rejects everything else', () => {
			for (const checkId of DISCOVERY_CHECKS) {
				strictEqual(isDiscoveryCheckId(checkId), true);
			}
			strictEqual(isDiscoveryCheckId('surface-index'), false);
			strictEqual(isDiscoveryCheckId(''), false);
			strictEqual(isDiscoveryCheckId(42), false);
			strictEqual(isDiscoveryCheckId(null), false);
			strictEqual(isDiscoveryCheckId(undefined), false);
		});

		test('narrows arrays via its type predicate', () => {
			const narrowed: readonly DiscoveryCheckId[] = ['surface-indexed', 'not-a-check', 'a11y-law-annotated'].filter(isDiscoveryCheckId);
			deepEqual(narrowed, ['surface-indexed', 'a11y-law-annotated']);
		});
	});

	suite('DISCOVERY_OUTCOMES -- the frozen outcome vocabulary (authority)', () => {
		test('pins the two outcomes in canonical order', () => {
			deepEqual(DISCOVERY_OUTCOMES, ['pass', 'fail']);
			strictEqual(DISCOVERY_OUTCOMES.length, 2);
		});

		test('is frozen', () => {
			strictEqual(Object.isFrozen(DISCOVERY_OUTCOMES), true);
		});

		test('isDiscoveryOutcome accepts the two outcomes and rejects everything else', () => {
			strictEqual(isDiscoveryOutcome('pass'), true);
			strictEqual(isDiscoveryOutcome('fail'), true);
			strictEqual(isDiscoveryOutcome('maybe'), false);
			strictEqual(isDiscoveryOutcome('PASS'), false);
			strictEqual(isDiscoveryOutcome(''), false);
			strictEqual(isDiscoveryOutcome(42), false);
			strictEqual(isDiscoveryOutcome(null), false);
			strictEqual(isDiscoveryOutcome(undefined), false);
		});
	});

	suite('duplicated vocabularies and guards pin against their authorities (zero-dependency law)', () => {
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

		const STATUS_BATTERY: ReadonlyArray<readonly [unknown, boolean]> = [
			['green', true],
			['red', true],
			['unmeasured', true],
			['amber', false],
			['GREEN', false],
			['', false],
			[42, false],
			[null, false],
			[undefined, false],
		];

		test('GATE_CHECK_STATUSES equals the gate.ts authority verbatim', () => {
			deepEqual(GATE_CHECK_STATUSES, STATUSES_FROM_GATE);
		});

		test('isGateCheckStatus: discovery.ts and gate.ts agree on the whole battery', () => {
			for (const [input, expected] of STATUS_BATTERY) {
				strictEqual(isGateCheckStatus(input), expected, `input=${String(input)}`);
				strictEqual(isGateCheckStatusFromGate(input), expected, `input=${String(input)}`);
			}
		});

		test('isParityScope: discovery.ts and matrix.ts agree on the whole battery', () => {
			for (const [input, expected] of SCOPE_BATTERY) {
				strictEqual(isParityScope(input), expected, `input=${String(input)}`);
				strictEqual(isParityScopeFromMatrix(input), expected, `input=${String(input)}`);
			}
		});
	});

suite('isDiscoveryCheckRecord -- the record guard', () => {
		test('accepts a passing record and a failing record (evidence both ways)', () => {
			strictEqual(isDiscoveryCheckRecord(PASSING), true);
			strictEqual(isDiscoveryCheckRecord(FAILING), true);
			for (const checkId of DISCOVERY_CHECKS) {
				strictEqual(isDiscoveryCheckRecord(observed(checkId, 'pass')), true);
				strictEqual(isDiscoveryCheckRecord(observed(checkId, 'fail')), true);
			}
		});

		test('rejects non-objects', () => {
			strictEqual(isDiscoveryCheckRecord(null), false);
			strictEqual(isDiscoveryCheckRecord(undefined), false);
			strictEqual(isDiscoveryCheckRecord('record'), false);
			strictEqual(isDiscoveryCheckRecord(42), false);
			strictEqual(isDiscoveryCheckRecord([]), false);
		});

		test('rejects a malformed scope', () => {
			strictEqual(isDiscoveryCheckRecord(variant({ scope: null })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ scope: { workspaceId: '', tenantId: 't' } })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ scope: { workspaceId: 'w' } })), false);
		});

		test('rejects a foreign contractVersion', () => {
			strictEqual(isDiscoveryCheckRecord(variant({ contractVersion: '0.9.0' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ contractVersion: '1.0.1' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ contractVersion: '' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ contractVersion: undefined })), false);
		});

		test('rejects an unknown checkId or outcome', () => {
			strictEqual(isDiscoveryCheckRecord(variant({ checkId: 'surface-index' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ checkId: undefined })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ observedOutcome: 'maybe' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ observedOutcome: undefined })), false);
		});

		test('rejects a missing, empty, or non-string artifactRef on a PASS (an unbacked claim)', () => {
			strictEqual(isDiscoveryCheckRecord(variant({ artifactRef: undefined })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ artifactRef: '' })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ artifactRef: 42 })), false);
			strictEqual(isDiscoveryCheckRecord(variant({ artifactRef: null })), false);
		});

		test('rejects a missing or empty artifactRef on a FAIL (an unlocatable failure)', () => {
			strictEqual(isDiscoveryCheckRecord({ ...FAILING, artifactRef: undefined }), false);
			strictEqual(isDiscoveryCheckRecord({ ...FAILING, artifactRef: '' }), false);
		});

		test('tolerates extra properties (structural guard)', () => {
			strictEqual(isDiscoveryCheckRecord(variant({ observedBy: 'probe', note: 'extra' })), true);
		});
	});

	suite('discoveryStatusFor -- the fail-closed derivation', () => {
		test('a valid record derives green on pass and red on fail, for every frozen check', () => {
			for (const checkId of DISCOVERY_CHECKS) {
				strictEqual(discoveryStatusFor(observed(checkId, 'pass')), 'green');
				strictEqual(discoveryStatusFor(observed(checkId, 'fail')), 'red');
			}
		});

		test('THE LAW: a missing or empty artifactRef derives unmeasured on either outcome -- never green', () => {
			for (const outcome of DISCOVERY_OUTCOMES) {
				strictEqual(
					discoveryStatusFor(variant({ observedOutcome: outcome, artifactRef: undefined }) as DiscoveryCheckRecord),
					'unmeasured',
				);
				strictEqual(discoveryStatusFor(observed('surface-indexed', outcome, '')), 'unmeasured');
			}
		});

		test('a malformed shape (scope, version) derives unmeasured', () => {
			strictEqual(discoveryStatusFor(variant({ scope: null }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ scope: { workspaceId: '', tenantId: 't' } }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ contractVersion: '0.9.0' }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ contractVersion: undefined }) as DiscoveryCheckRecord), 'unmeasured');
		});

		test('an unknown checkId or outcome derives unmeasured', () => {
			strictEqual(discoveryStatusFor(variant({ checkId: 'surface-index' }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ checkId: undefined }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ observedOutcome: 'maybe' }) as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(variant({ observedOutcome: undefined }) as DiscoveryCheckRecord), 'unmeasured');
		});

		test('non-records derive unmeasured (fail closed)', () => {
			strictEqual(discoveryStatusFor(null as unknown as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(undefined as unknown as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor('record' as unknown as DiscoveryCheckRecord), 'unmeasured');
			strictEqual(discoveryStatusFor(42 as unknown as DiscoveryCheckRecord), 'unmeasured');
		});

		test('the truth table is exhaustive over outcome x artifact presence for every frozen check', () => {
			for (const checkId of DISCOVERY_CHECKS) {
				for (const outcome of DISCOVERY_OUTCOMES) {
					const withArtifact = observed(checkId, outcome);
					strictEqual(discoveryStatusFor(withArtifact), outcome === 'pass' ? 'green' : 'red');
					const withoutArtifact = observed(checkId, outcome, '');
					strictEqual(discoveryStatusFor(withoutArtifact), 'unmeasured');
				}
			}
		});

		test('the derivation is pure: identical input, identical output, input unmutated', () => {
			const snapshot = { ...PASSING };
			const first = discoveryStatusFor(PASSING);
			const second = discoveryStatusFor(PASSING);
			strictEqual(first, second);
			strictEqual(first, 'green');
			deepEqual(PASSING, snapshot);
		});
	});

	suite('discoveryStatusTable -- the projection and the fold law', () => {
		test('empty input: exactly one entry per frozen check, all unmeasured, in table order', () => {
			deepEqual(discoveryStatusTable([]), DISCOVERY_CHECKS.map((checkId) => ({ checkId, status: 'unmeasured' })));
			strictEqual(discoveryStatusTable([]).length, DISCOVERY_CHECKS.length);
		});

		test('all four passing: exactly one green entry per frozen check, in table order, inputs unmutated', () => {
			const snapshot = ALL_PASSING.map((record) => ({ ...record }));
			const table: ReadonlyArray<DiscoveryStatusEntry> = discoveryStatusTable(ALL_PASSING);
			deepEqual(table, DISCOVERY_CHECKS.map((checkId) => ({ checkId, status: 'green' })));
			strictEqual(table.length, DISCOVERY_CHECKS.length);
			deepEqual(ALL_PASSING, snapshot);
		});

		test('one failing among passing: that entry is red, the rest green', () => {
			const records = DISCOVERY_CHECKS.map((checkId) =>
				observed(checkId, checkId === 'journey-documented' ? 'fail' : 'pass'),
			);
			const table = discoveryStatusTable(records);
			const failing = table.find((entry) => entry.checkId === 'journey-documented');
			strictEqual(failing?.status, 'red');
			strictEqual(table.filter((entry) => entry.status === 'green').length, 3);
		});

		test('absence is never guessed: a check with no valid record derives unmeasured', () => {
			const records = ALL_PASSING.filter((record) => record.checkId !== 'contract-discoverable');
			const table = discoveryStatusTable(records);
			const absent = table.find((entry) => entry.checkId === 'contract-discoverable');
			strictEqual(absent?.status, 'unmeasured');
			strictEqual(table.filter((entry) => entry.status === 'green').length, 3);
		});

		test('placement discipline: first-valid-wins on duplicates, malformed records never place', () => {
			// A duplicate valid record does not displace the first placement.
			const passThenFail = discoveryStatusTable([...ALL_PASSING, observed('surface-indexed', 'fail')]);
			deepEqual(passThenFail, discoveryStatusTable(ALL_PASSING));
			// The FIRST outcome wins, in either order.
			const failThenPass = discoveryStatusTable([
				observed('a11y-law-annotated', 'fail'),
				...ALL_PASSING.filter((record) => record.checkId !== 'a11y-law-annotated'),
				observed('a11y-law-annotated', 'pass'),
			]);
			const a11y = failThenPass.find((entry) => entry.checkId === 'a11y-law-annotated');
			strictEqual(a11y?.status, 'red');
			// Malformed candidates never place and never disturb valid ones.
			const withGarbage: ReadonlyArray<unknown> = [
				...ALL_PASSING,
				variant({ checkId: 'surface-index' }),
				variant({ scope: null }),
				variant({ contractVersion: '0.9.0' }),
				42,
				'junk',
				null,
			];
			deepEqual(discoveryStatusTable(withGarbage), discoveryStatusTable(ALL_PASSING));
		});

		test('the fold law: the table is all-green only when every entry is green', () => {
			// The repo-side harvester folds this table into the discovery-a11y
			// gate check: green only when all four entries are green. A single
			// red -- or a single unmeasured -- breaks the fold.
			const allGreen = discoveryStatusTable(ALL_PASSING);
			strictEqual(allGreen.every((entry) => entry.status === 'green'), true);
			const oneFailing = discoveryStatusTable(
				DISCOVERY_CHECKS.map((checkId) => observed(checkId, checkId === 'journey-documented' ? 'fail' : 'pass')),
			);
			strictEqual(oneFailing.every((entry) => entry.status === 'green'), false);
			const withAbsence = discoveryStatusTable(
				ALL_PASSING.filter((record) => record.checkId !== 'contract-discoverable'),
			);
			strictEqual(withAbsence.every((entry) => entry.status === 'green'), false);
		});
	});
});
