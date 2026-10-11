/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-008 presentation contract test suite (mocha tdd style, matching
 * build/flauz/inference/isolation/test/common/isolationContract.test.ts).
 *
 * Fixture policy: every provider id, adapter id, model id, scope id
 * and probe value below is SYNTHETIC (prefixed 'fixture.') and is NOT
 * an authority value. Closed-vocabulary members (the verification and
 * substitution states, the health and capacity states, the reset
 * classes, the rejection reasons, the version stamps) are the
 * contract's own values under test. Runtime-boundary probes are
 * injected as JSON-parsed values. The canonical-byte tests pin the
 * exact byte strings; the suites never read a clock; the in-suite
 * determinism greps pin the sources to law-comment lines only.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DECISION_VIEW_SIDES,
	INFERENCE_PRESENTATION_VERSION,
	PRESENTATION_DECISION_FAMILIES,
	PRESENTATION_REJECTION_REASONS,
	isCapacityView,
	isDecisionView,
	isLedgerLineView,
	isProvenanceView,
	isResetExpectationView,
	serializePresentationRecord,
} from '../../common/presentationContract.js';
import type {
	CapacityView,
	DecisionView,
	LedgerLineView,
	ProvenanceView,
	ResetExpectationView,
} from '../../common/presentationContract.js';

const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_RESET_AT_MS = 1_700_003_600_000;
const FIXTURE_PROVIDER = 'fixture.provider.healthy';
const FIXTURE_ADAPTER = 'fixture.view.healthy';
const FIXTURE_MODEL = 'fixture.model.healthy-main';
const FIXTURE_MODEL_ALT = 'fixture.model.healthy-alt';

function fixtureProvenanceView(): ProvenanceView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		verification: 'unverified',
		substitution: 'none',
		scopeLabel: FIXTURE_MODEL,
		requestedProviderId: FIXTURE_PROVIDER,
		requestedModelId: FIXTURE_MODEL,
		actualProviderId: FIXTURE_PROVIDER,
		actualModelId: FIXTURE_MODEL,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	};
}

/** The substituted fixture: a differing actual model, honestly labeled disclosed. */
function fixtureSubstitutedProvenanceView(): ProvenanceView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		verification: 'verified',
		substitution: 'disclosed',
		scopeLabel: FIXTURE_MODEL_ALT,
		requestedProviderId: FIXTURE_PROVIDER,
		requestedModelId: FIXTURE_MODEL,
		actualProviderId: FIXTURE_PROVIDER,
		actualModelId: FIXTURE_MODEL_ALT,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureCapacityView(): CapacityView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		providerId: FIXTURE_PROVIDER,
		health: 'healthy',
		verification: 'unverified',
		capacityState: 'available',
		cooldown: false,
		quotaRemaining: 1000,
		resetExpectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' },
		provenance: fixtureProvenanceView(),
		generatedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureCooldownCapacityView(): CapacityView {
	return {
		...fixtureCapacityView(),
		capacityState: 'cooldown',
		cooldown: true,
	};
}

function fixtureResetView(): ResetExpectationView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		resetClass: 'fixed-instant',
		expectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' },
		projectedAtEpochMs: FIXTURE_NOW_MS,
	};
}

/** The honest-unknown reset view: a stale fixed-instant reset (never a fabricated future). */
function fixtureUnknownResetView(): ResetExpectationView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		resetClass: 'fixed-instant',
		expectation: { kind: 'unknown' },
		projectedAtEpochMs: FIXTURE_NOW_MS,
	};
}

function fixtureDecisionView(): DecisionView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'isolation',
		side: 'selected',
		decidedAtEpochMs: FIXTURE_NOW_MS,
		adapterId: FIXTURE_ADAPTER,
		reasons: ['eligible'],
		provenance: fixtureProvenanceView(),
	};
}

/** The refused-side fixture: the no-routable-candidate class with its typed reasons verbatim. */
function fixtureRefusedDecisionView(): DecisionView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		family: 'routing',
		side: 'refused',
		decidedAtEpochMs: FIXTURE_NOW_MS,
		adapterId: 'none',
		reasons: ['rate-limited', 'quota-exhausted'],
		provenance: 'none',
	};
}

function fixtureLedgerLineView(): LedgerLineView {
	return {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		line: 1,
		family: 'isolation',
		canonicalBytes: '{"kind":"decided","contractVersion":"1.0.0","scopeId":"fixture.scope.healthy"}',
		decision: fixtureDecisionView(),
	};
}

/** The same view with its keys inserted in reverse order (the serializer's key-order independence probe). */
function reversed<T extends object>(view: T): T {
	const reversedView: Record<string, unknown> = {};
	for (const key of Object.keys(view).reverse()) {
		reversedView[key] = (view as Record<string, unknown>)[key];
	}
	return reversedView as T;
}

/** Runtime-boundary probe helper: the shape foreign input arrives in (JSON-parsed, untyped). */
function foreign(value: string): any {
	return JSON.parse(value);
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('INF-008 presentation contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('INFERENCE_PRESENTATION_VERSION is 1.0.0', () => {
			assert.equal(INFERENCE_PRESENTATION_VERSION, '1.0.0');
		});

		test('the presentation stamp and the landed vocabulary members are distinct roles', () => {
			const view = fixtureProvenanceView();
			assert.equal(isProvenanceView(view), true);
			assert.equal(view.contractVersion, INFERENCE_PRESENTATION_VERSION);
			// The landed vocabulary members ride the view's fields verbatim.
			assert.equal(view.verification, 'unverified');
			assert.equal(view.substitution, 'none');
		});
	});

	suite('PRESENTATION_REJECTION_REASONS (the frozen list)', () => {
		test('the exact eight reasons, in the frozen order', () => {
			assert.deepEqual(PRESENTATION_REJECTION_REASONS, [
				'not-an-object',
				'unknown-decision-family',
				'caller-supplied-label',
				'shape-law-violation',
				'unresolved-ledger-line',
				'malformed-ledger-line',
				'unresolved-decision-record',
				'unresolved-adapter-binding',
			]);
		});

		test('the reasons are unique', () => {
			assert.equal(new Set(PRESENTATION_REJECTION_REASONS).size, PRESENTATION_REJECTION_REASONS.length);
		});
	});

	suite('PRESENTATION_DECISION_FAMILIES and DECISION_VIEW_SIDES (the frozen lists)', () => {
		test('the families are routing/matching/isolation in the landed landing order', () => {
			assert.deepEqual(PRESENTATION_DECISION_FAMILIES, ['routing', 'matching', 'isolation']);
			assert.equal(new Set(PRESENTATION_DECISION_FAMILIES).size, 3);
		});

		test('the sides are selected/refused (the unified fold)', () => {
			assert.deepEqual(DECISION_VIEW_SIDES, ['selected', 'refused']);
		});
	});

	suite('isProvenanceView (the never-re-derive law made structural)', () => {
		test('the fixture provenance view admits', () => {
			assert.equal(isProvenanceView(fixtureProvenanceView()), true);
		});

		test('the substituted fixture (a differing actual model, honestly labeled disclosed) admits', () => {
			assert.equal(isProvenanceView(fixtureSubstitutedProvenanceView()), true);
		});

		test('a JSON-parsed fixture view admits at the runtime boundary', () => {
			assert.equal(isProvenanceView(foreign(JSON.stringify(fixtureProvenanceView()))), true);
		});

		test('a non-object is not a view', () => {
			assert.equal(isProvenanceView(null), false);
			assert.equal(isProvenanceView('fixture'), false);
			assert.equal(isProvenanceView(42), false);
		});

		test('the presentation stamp is required', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), contractVersion: '0.9.0' }), false);
		});

		test('a non-member verification state is rejected (the landed vocabulary only)', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), verification: 'trusted' }), false);
		});

		test('a non-member substitution label is rejected (the landed vocabulary only)', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), substitution: 'silent' }), false);
		});

		test('an empty id field is rejected', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), actualProviderId: '' }), false);
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), requestedModelId: '' }), false);
		});

		test('a re-derived scope label (scopeLabel differing from the actual model field) is rejected', () => {
			const view = { ...fixtureProvenanceView(), scopeLabel: 'fixture.display-label' };
			assert.equal(isProvenanceView(view), false);
		});

		test('an extra display-label field is rejected - the no-parallel-vocabulary pin', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), displayLabel: 'Healthy' }), false);
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), substitutionLabel: 'none' }), false);
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), provenanceLabel: 'x' }), false);
		});

		test('a hidden substitution (a differing actual model labeled none) is rejected - the landed law made structural', () => {
			const view: ProvenanceView = {
				...fixtureSubstitutedProvenanceView(),
				substitution: 'none',
			};
			assert.equal(isProvenanceView(view), false);
		});

		test('a mislabeled substitution (an equal selection labeled disclosed) is rejected', () => {
			const view: ProvenanceView = {
				...fixtureProvenanceView(),
				substitution: 'disclosed',
			};
			assert.equal(isProvenanceView(view), false);
		});

		test('a non-finite recording instant is rejected', () => {
			assert.equal(isProvenanceView({ ...fixtureProvenanceView(), recordedAtEpochMs: Number.NaN }), false);
		});
	});

	suite('isCapacityView (the projection over the landed disclosure)', () => {
		test('the fixture capacity view admits', () => {
			assert.equal(isCapacityView(fixtureCapacityView()), true);
		});

		test('the cooldown fixture (capacityState cooldown, cooldown true) admits', () => {
			assert.equal(isCapacityView(fixtureCooldownCapacityView()), true);
		});

		test('a non-object and a stamp mismatch are rejected', () => {
			assert.equal(isCapacityView(null), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), contractVersion: '0.9.0' }), false);
		});

		test('non-member health / verification / capacity-state values are rejected (the landed vocabulary only)', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), health: 'fine' }), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), verification: 'trusted' }), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), capacityState: 'plenty' }), false);
		});

		test('the cooldown fold pin: a cooldown capacity state requires the cooldown verdict true', () => {
			assert.equal(isCapacityView({ ...fixtureCooldownCapacityView(), cooldown: false }), false);
		});

		test('the cooldown fold pin: a non-cooldown capacity state requires the cooldown verdict false', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), cooldown: true }), false);
		});

		test('a quotaRemaining that is neither unknown nor a non-negative integer is rejected', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), quotaRemaining: -1 }), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), quotaRemaining: 1.5 }), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), quotaRemaining: 'many' }), false);
			assert.equal(isCapacityView({ ...fixtureCapacityView(), quotaRemaining: 'unknown' }), true);
		});

		test('a malformed reset expectation is rejected', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), resetExpectation: { kind: 'soon' } }), false);
			assert.equal(
				isCapacityView({
					...fixtureCapacityView(),
					resetExpectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'provider-discretion' },
				}),
				false,
			);
			assert.equal(
				isCapacityView({
					...fixtureCapacityView(),
					resetExpectation: { kind: 'known', nextResetEpochMs: Number.NaN, basis: 'fixed-instant' },
				}),
				false,
			);
		});

		test('a malformed provenance sub-view is rejected', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), provenance: 'none' }), false);
			assert.equal(
				isCapacityView({ ...fixtureCapacityView(), provenance: { ...fixtureProvenanceView(), scopeLabel: 're-derived' } }),
				false,
			);
		});

		test('an extra field is rejected - the no-parallel-vocabulary pin', () => {
			assert.equal(isCapacityView({ ...fixtureCapacityView(), displayState: 'green' }), false);
		});
	});

	suite('isResetExpectationView (the landed fold laws made structural)', () => {
		test('the known fixed-instant fixture admits', () => {
			assert.equal(isResetExpectationView(fixtureResetView()), true);
		});

		test('the honest-unknown stale-reset fixture admits (never a fabricated future)', () => {
			assert.equal(isResetExpectationView(fixtureUnknownResetView()), true);
		});

		test('the interval-aligned class with a known expectation admits', () => {
			const view: ResetExpectationView = {
				contractVersion: INFERENCE_PRESENTATION_VERSION,
				resetClass: 'interval-aligned',
				expectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'interval-aligned' },
				projectedAtEpochMs: FIXTURE_NOW_MS,
			};
			assert.equal(isResetExpectationView(view), true);
		});

		test('the provider-discretion and unknown classes carry the honest unknown expectation', () => {
			const discretion: ResetExpectationView = {
				contractVersion: INFERENCE_PRESENTATION_VERSION,
				resetClass: 'provider-discretion',
				expectation: { kind: 'unknown' },
				projectedAtEpochMs: FIXTURE_NOW_MS,
			};
			assert.equal(isResetExpectationView(discretion), true);
			const unknown: ResetExpectationView = {
				contractVersion: INFERENCE_PRESENTATION_VERSION,
				resetClass: 'unknown',
				expectation: { kind: 'unknown' },
				projectedAtEpochMs: FIXTURE_NOW_MS,
			};
			assert.equal(isResetExpectationView(unknown), true);
			assert.equal(
				isResetExpectationView({ ...discretion, expectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'fixed-instant' } }),
				false,
			);
		});

		test('a known expectation whose basis disagrees with the reset class is rejected', () => {
			assert.equal(
				isResetExpectationView({
					...fixtureResetView(),
					expectation: { kind: 'known', nextResetEpochMs: FIXTURE_RESET_AT_MS, basis: 'interval-aligned' },
				}),
				false,
			);
		});

		test('a non-member reset class is rejected (the landed vocabulary only)', () => {
			assert.equal(isResetExpectationView({ ...fixtureResetView(), resetClass: 'rolling' }), false);
		});

		test('a malformed expectation and a non-finite probe are rejected', () => {
			assert.equal(isResetExpectationView({ ...fixtureResetView(), expectation: { kind: 'soon' } }), false);
			assert.equal(isResetExpectationView({ ...fixtureResetView(), projectedAtEpochMs: Number.NaN }), false);
		});

		test('an extra field is rejected - the no-parallel-vocabulary pin', () => {
			assert.equal(isResetExpectationView({ ...fixtureResetView(), countdownLabel: '1h' }), false);
		});
	});

	suite('isDecisionView (the never-silent-empty law made structural)', () => {
		test('the fixture selected view admits', () => {
			assert.equal(isDecisionView(fixtureDecisionView()), true);
		});

		test('the fixture refused view admits (the reasons verbatim)', () => {
			assert.equal(isDecisionView(fixtureRefusedDecisionView()), true);
		});

		test('a non-object, a stamp mismatch, a non-member family and a non-member side are rejected', () => {
			assert.equal(isDecisionView(null), false);
			assert.equal(isDecisionView({ ...fixtureDecisionView(), contractVersion: '0.9.0' }), false);
			assert.equal(isDecisionView({ ...fixtureDecisionView(), family: 'catalog' }), false);
			assert.equal(isDecisionView({ ...fixtureDecisionView(), side: 'maybe' }), false);
		});

		test('the refused side carries the none adapter binding (nothing is fabricated)', () => {
			assert.equal(isDecisionView({ ...fixtureRefusedDecisionView(), adapterId: 'fixture.view.healthy' }), false);
		});

		test('the refused side carries the none provenance (nothing is fabricated)', () => {
			assert.equal(isDecisionView({ ...fixtureRefusedDecisionView(), provenance: fixtureProvenanceView() }), false);
		});

		test('the selected side carries a real provenance view', () => {
			assert.equal(isDecisionView({ ...fixtureDecisionView(), provenance: 'none' }), false);
		});

		test('the reasons are non-empty strings in the projection order', () => {
			assert.equal(isDecisionView({ ...fixtureRefusedDecisionView(), reasons: ['rate-limited', ''] }), false);
			assert.equal(isDecisionView({ ...fixtureRefusedDecisionView(), reasons: 'rate-limited' }), false);
			assert.equal(isDecisionView({ ...fixtureRefusedDecisionView(), reasons: [] }), true);
		});

		test('a non-finite decision instant and an empty adapter id are rejected', () => {
			assert.equal(isDecisionView({ ...fixtureDecisionView(), decidedAtEpochMs: Number.NaN }), false);
			assert.equal(isDecisionView({ ...fixtureDecisionView(), adapterId: '' }), false);
		});

		test('an extra field is rejected - the no-parallel-vocabulary pin', () => {
			assert.equal(isDecisionView({ ...fixtureDecisionView(), verdictLabel: 'ok' }), false);
		});
	});

	suite('isLedgerLineView (the canonical-bytes law made structural)', () => {
		test('the fixture ledger line view admits', () => {
			assert.equal(isLedgerLineView(fixtureLedgerLineView()), true);
		});

		test('the family agreement pin: a line whose family disagrees with the embedded decision is rejected', () => {
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), family: 'routing' }), false);
		});

		test('a non-1-based line index is rejected', () => {
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), line: 0 }), false);
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), line: 1.5 }), false);
		});

		test('a non-string canonicalBytes field and a malformed decision are rejected', () => {
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), canonicalBytes: 42 }), false);
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), decision: 'none' }), false);
		});

		test('an extra field is rejected - the no-parallel-vocabulary pin', () => {
			assert.equal(isLedgerLineView({ ...fixtureLedgerLineView(), rawLine: 'x' }), false);
		});
	});

	suite('serializePresentationRecord (the canonical bytes)', () => {
		test('the provenance view bytes are pinned exact', () => {
			assert.equal(
				serializePresentationRecord(fixtureProvenanceView()),
				'{"contractVersion":"1.0.0","verification":"unverified","substitution":"none","scopeLabel":"fixture.model.healthy-main","requestedProviderId":"fixture.provider.healthy","requestedModelId":"fixture.model.healthy-main","actualProviderId":"fixture.provider.healthy","actualModelId":"fixture.model.healthy-main","recordedAtEpochMs":1700000000000}',
			);
		});

		test('the substituted provenance view bytes are pinned exact (the disclosed label verbatim)', () => {
			assert.equal(
				serializePresentationRecord(fixtureSubstitutedProvenanceView()),
				'{"contractVersion":"1.0.0","verification":"verified","substitution":"disclosed","scopeLabel":"fixture.model.healthy-alt","requestedProviderId":"fixture.provider.healthy","requestedModelId":"fixture.model.healthy-main","actualProviderId":"fixture.provider.healthy","actualModelId":"fixture.model.healthy-alt","recordedAtEpochMs":1700000000000}',
			);
		});

		test('the capacity view bytes are pinned exact (the nested records canonicalized)', () => {
			assert.equal(
				serializePresentationRecord(fixtureCapacityView()),
				'{"contractVersion":"1.0.0","providerId":"fixture.provider.healthy","health":"healthy","verification":"unverified","capacityState":"available","cooldown":false,"quotaRemaining":1000,"resetExpectation":{"kind":"known","nextResetEpochMs":1700003600000,"basis":"fixed-instant"},"provenance":{"contractVersion":"1.0.0","verification":"unverified","substitution":"none","scopeLabel":"fixture.model.healthy-main","requestedProviderId":"fixture.provider.healthy","requestedModelId":"fixture.model.healthy-main","actualProviderId":"fixture.provider.healthy","actualModelId":"fixture.model.healthy-main","recordedAtEpochMs":1700000000000},"generatedAtEpochMs":1700000000000}',
			);
		});

		test('the unknown reset expectation bytes are pinned exact', () => {
			assert.equal(
				serializePresentationRecord(fixtureUnknownResetView()),
				'{"contractVersion":"1.0.0","resetClass":"fixed-instant","expectation":{"kind":"unknown"},"projectedAtEpochMs":1700000000000}',
			);
		});

		test('the selected decision view bytes are pinned exact', () => {
			assert.equal(
				serializePresentationRecord(fixtureDecisionView()),
				'{"contractVersion":"1.0.0","family":"isolation","side":"selected","decidedAtEpochMs":1700000000000,"adapterId":"fixture.view.healthy","reasons":["eligible"],"provenance":{"contractVersion":"1.0.0","verification":"unverified","substitution":"none","scopeLabel":"fixture.model.healthy-main","requestedProviderId":"fixture.provider.healthy","requestedModelId":"fixture.model.healthy-main","actualProviderId":"fixture.provider.healthy","actualModelId":"fixture.model.healthy-main","recordedAtEpochMs":1700000000000}}',
			);
		});

		test('the refused decision view bytes are pinned exact (the reasons verbatim, in order)', () => {
			assert.equal(
				serializePresentationRecord(fixtureRefusedDecisionView()),
				'{"contractVersion":"1.0.0","family":"routing","side":"refused","decidedAtEpochMs":1700000000000,"adapterId":"none","reasons":["rate-limited","quota-exhausted"],"provenance":"none"}',
			);
		});

		test('the ledger line view bytes are pinned exact (the canonical bytes carried verbatim)', () => {
			assert.equal(
				serializePresentationRecord(fixtureLedgerLineView()),
				'{"contractVersion":"1.0.0","line":1,"family":"isolation","canonicalBytes":"{\\"kind\\":\\"decided\\",\\"contractVersion\\":\\"1.0.0\\",\\"scopeId\\":\\"fixture.scope.healthy\\"}","decision":{"contractVersion":"1.0.0","family":"isolation","side":"selected","decidedAtEpochMs":1700000000000,"adapterId":"fixture.view.healthy","reasons":["eligible"],"provenance":{"contractVersion":"1.0.0","verification":"unverified","substitution":"none","scopeLabel":"fixture.model.healthy-main","requestedProviderId":"fixture.provider.healthy","requestedModelId":"fixture.model.healthy-main","actualProviderId":"fixture.provider.healthy","actualModelId":"fixture.model.healthy-main","recordedAtEpochMs":1700000000000}}}',
			);
		});

		test('double-run byte equality for every view kind', () => {
			const views = [
				fixtureProvenanceView(),
				fixtureSubstitutedProvenanceView(),
				fixtureCapacityView(),
				fixtureCooldownCapacityView(),
				fixtureResetView(),
				fixtureUnknownResetView(),
				fixtureDecisionView(),
				fixtureRefusedDecisionView(),
				fixtureLedgerLineView(),
			];
			for (const view of views) {
				assert.equal(serializePresentationRecord(view), serializePresentationRecord(view));
			}
		});

		test('key-insertion-order independence for every view kind', () => {
			assert.equal(serializePresentationRecord(reversed(fixtureProvenanceView())), serializePresentationRecord(fixtureProvenanceView()));
			assert.equal(serializePresentationRecord(reversed(fixtureCapacityView())), serializePresentationRecord(fixtureCapacityView()));
			assert.equal(serializePresentationRecord(reversed(fixtureResetView())), serializePresentationRecord(fixtureResetView()));
			assert.equal(serializePresentationRecord(reversed(fixtureDecisionView())), serializePresentationRecord(fixtureDecisionView()));
			assert.equal(serializePresentationRecord(reversed(fixtureLedgerLineView())), serializePresentationRecord(fixtureLedgerLineView()));
		});

		test('a shuffled nested provenance key order is canonicalized', () => {
			const shuffled = {
				...fixtureCapacityView(),
				provenance: reversed(fixtureProvenanceView()),
			};
			assert.equal(serializePresentationRecord(shuffled), serializePresentationRecord(fixtureCapacityView()));
		});

		test('a shuffled nested reset-expectation key order is canonicalized', () => {
			const shuffled = {
				...fixtureResetView(),
				expectation: {
					basis: 'fixed-instant',
					nextResetEpochMs: FIXTURE_RESET_AT_MS,
					kind: 'known',
				},
			};
			assert.equal(serializePresentationRecord(shuffled), serializePresentationRecord(fixtureResetView()));
		});

		test('a non-view is refused fail-closed (TypeError)', () => {
			assert.throws(() => serializePresentationRecord(null), /^TypeError: serializePresentationRecord:/);
			assert.throws(() => serializePresentationRecord('fixture'), /^TypeError: serializePresentationRecord:/);
		});

		test('a malformed view is refused fail-closed (TypeError) - no dishonest view ever gets canonical bytes', () => {
			const reDerived = { ...fixtureProvenanceView(), scopeLabel: 'fixture.display-label' };
			assert.throws(() => serializePresentationRecord(reDerived), /^TypeError: serializePresentationRecord:/);
			const extraField = { ...fixtureDecisionView(), verdictLabel: 'ok' };
			assert.throws(() => serializePresentationRecord(extraField), /^TypeError: serializePresentationRecord:/);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in presentationContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/presentationContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in presentationKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/presentationKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
