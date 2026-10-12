/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * INF-009 drill contract test suite (mocha tdd style, matching
 * build/flauz/inference/presentation/test/common/presentationKit.test.ts).
 *
 * Fixture policy: every scenario id, catalog/adapter/scope/matrix id,
 * model id and credential handle below is SYNTHETIC (prefixed
 * 'fixture.') and is NOT an authority value. Closed-vocabulary
 * members (the scenario kinds, the verdict families, the folds, the
 * rejection reasons, the version stamps, the landed presentation
 * view fields) are the contracts' own values under test. All
 * timestamps are injected plain-number epoch milliseconds; the suite
 * never reads a clock. NO live provider calls exist anywhere: the
 * drills are simulated-provider fixtures over the LANDED kits only.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DRILL_FOLDS,
	DRILL_REJECTION_REASONS,
	DRILL_SCENARIO_KINDS,
	DRILL_VERDICT_FAMILIES,
	INFERENCE_DRILLS_VERSION,
	admitDrillReceipt,
	admitDrillScenario,
	isDrillReceipt,
	serializeDrillReceipt,
} from '../../common/drillsContract.js';
import type { DrillReceipt, DrillScenario } from '../../common/drillsContract.js';
import { INFERENCE_DRILLS_VERSION as KIT_REEXPORT_INFERENCE_DRILLS_VERSION } from '../../common/drillsKit.js';
import { INFERENCE_PRESENTATION_VERSION, serializePresentationRecord } from '../../../presentation/common/presentationContract.js';
import type { ProvenanceView } from '../../../presentation/common/presentationContract.js';
import { INFERENCE_CATALOG_VERSION, unknownCapacityEntry } from '../../../catalog/common/providerCatalog.js';
import { INFERENCE_ADAPTER_VERSION } from '../../../adapters/common/providerAdapter.js';
import { INFERENCE_ISOLATION_VERSION } from '../../../isolation/common/isolationContract.js';
import { INFERENCE_CATALOG_VERSION as MATRIX_STAMP } from '../../../catalog/common/capabilityMatrix.js';
import { unknownSnapshot } from '../../../semantics/common/capacityDisclosure.js';

const FIXTURE_NOW_MS = 1_700_000_000_000;
const FIXTURE_PROVIDER_PERMITTED = 'fixture.provider.permitted';
const FIXTURE_PROVIDER_PROHIBITED = 'fixture.provider.prohibited';
const FIXTURE_PROVIDER_UNKNOWN_TERM = 'fixture.provider.unknown-term';
const FIXTURE_ADAPTER_ALPHA = 'fixture.adapter.alpha';
const FIXTURE_ADAPTER_BETA = 'fixture.adapter.beta';
const FIXTURE_ADAPTER_GAMMA = 'fixture.adapter.gamma';
const FIXTURE_CREDENTIAL_ALPHA = 'fixture.credential.handle.alpha';
const FIXTURE_CREDENTIAL_BETA = 'fixture.credential.handle.beta';
const FIXTURE_CREDENTIAL_GAMMA = 'fixture.credential.handle.gamma';
const FIXTURE_SCOPE_PERMITTED = 'fixture.scope.permitted';
const FIXTURE_SCOPE_PROHIBITED = 'fixture.scope.prohibited';
const FIXTURE_SCOPE_UNKNOWN_TERM = 'fixture.scope.unknown-term';
const FIXTURE_MODEL_MAIN = 'fixture.model.main';

function fixtureEntry(entryId: string, termsState: string): Record<string, unknown> {
	return {
		entryId,
		displayName: `Fixture Entry ${entryId}`,
		providerClass: 'third-party-free-tier',
		planClaims: [],
		capacitySnapshot: unknownSnapshot(entryId, FIXTURE_NOW_MS),
		metadataVerification: 'unverified',
		termsState,
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureCatalog(): Record<string, unknown> {
	return {
		catalogId: 'fixture.catalog.drills',
		entries: [
			fixtureEntry(FIXTURE_PROVIDER_PERMITTED, 'permitted'),
			fixtureEntry(FIXTURE_PROVIDER_PROHIBITED, 'prohibited'),
			fixtureEntry(FIXTURE_PROVIDER_UNKNOWN_TERM, 'unknown'),
		],
		contractVersion: INFERENCE_CATALOG_VERSION,
	};
}

function fixtureAdapters(): Record<string, unknown> {
	return {
		adapterSetId: 'fixture.adapter-set.drills',
		adapters: [
			{
				adapterId: FIXTURE_ADAPTER_ALPHA,
				displayName: 'Fixture Adapter Alpha',
				providerEntryId: FIXTURE_PROVIDER_PERMITTED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_ALPHA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_BETA,
				displayName: 'Fixture Adapter Beta',
				providerEntryId: FIXTURE_PROVIDER_PROHIBITED,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_BETA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
			{
				adapterId: FIXTURE_ADAPTER_GAMMA,
				displayName: 'Fixture Adapter Gamma',
				providerEntryId: FIXTURE_PROVIDER_UNKNOWN_TERM,
				transportKind: 'http-generic-json',
				capacityProvenance: 'third-party-free-tier',
				credentialHandle: FIXTURE_CREDENTIAL_GAMMA,
				contractVersion: INFERENCE_ADAPTER_VERSION,
			},
		],
		contractVersion: INFERENCE_ADAPTER_VERSION,
	};
}

function fixtureScopes(): Record<string, unknown> {
	return {
		scopeSetId: 'fixture.scope-set.drills',
		scopes: [
			{ id: FIXTURE_SCOPE_PERMITTED, adapterId: FIXTURE_ADAPTER_ALPHA, handleRef: FIXTURE_CREDENTIAL_ALPHA },
			{ id: FIXTURE_SCOPE_PROHIBITED, adapterId: FIXTURE_ADAPTER_BETA, handleRef: FIXTURE_CREDENTIAL_BETA },
			{ id: FIXTURE_SCOPE_UNKNOWN_TERM, adapterId: FIXTURE_ADAPTER_GAMMA, handleRef: FIXTURE_CREDENTIAL_GAMMA },
		],
		contractVersion: INFERENCE_ISOLATION_VERSION,
	};
}

function fixtureMatrix(): Record<string, unknown> {
	return {
		matrixId: 'fixture.matrix.drills',
		descriptors: [
			{
				modelId: FIXTURE_MODEL_MAIN,
				providerEntryId: FIXTURE_PROVIDER_PERMITTED,
				contextWindow: { minTokens: 256, maxTokens: 8192 },
				maxOutputTokens: 1024,
				modalities: ['text-in', 'text-out'],
				contractVersion: MATRIX_STAMP,
			},
		],
		contractVersion: MATRIX_STAMP,
	};
}

/** The honest scenario base: every fixture surface admitted, every id fixture-prefixed. */
function scenarioBase(): Record<string, unknown> {
	return {
		contractVersion: INFERENCE_DRILLS_VERSION,
		clockSeed: FIXTURE_NOW_MS,
		catalog: fixtureCatalog(),
		adapters: fixtureAdapters(),
		scopes: fixtureScopes(),
	};
}

function cooldownScenario(): Record<string, unknown> {
	return {
		...scenarioBase(),
		scenarioId: 'fixture.scenario.cooldown-hold',
		kind: 'cooldown-hold',
		expected: 'cooldown-hold',
	};
}

function eligibilityScenario(): Record<string, unknown> {
	return {
		...scenarioBase(),
		scenarioId: 'fixture.scenario.eligibility-prohibited',
		kind: 'eligibility-denial',
		expected: 'eligibility-ineligible',
		targetId: FIXTURE_SCOPE_PROHIBITED,
	};
}

/** A hand-built honest ProvenanceView plus its LANDED canonical bytes (the citation fixture). */
function fixtureProvenanceView(): { view: ProvenanceView; canonicalBytes: string } {
	const view: ProvenanceView = {
		contractVersion: INFERENCE_PRESENTATION_VERSION,
		verification: 'unverified',
		substitution: 'none',
		scopeLabel: FIXTURE_MODEL_MAIN,
		requestedProviderId: FIXTURE_PROVIDER_PERMITTED,
		requestedModelId: FIXTURE_MODEL_MAIN,
		actualProviderId: FIXTURE_PROVIDER_PERMITTED,
		actualModelId: FIXTURE_MODEL_MAIN,
		recordedAtEpochMs: FIXTURE_NOW_MS,
	};
	return { view, canonicalBytes: serializePresentationRecord(view) };
}

function fixtureReceipt(): DrillReceipt {
	const cited = fixtureProvenanceView();
	return {
		contractVersion: INFERENCE_DRILLS_VERSION,
		scenarioId: 'fixture.scenario.cooldown-hold',
		scenarioKind: 'cooldown-hold',
		expected: 'cooldown-hold',
		observed: 'cooldown-hold',
		passed: true,
		drillLog: [{ fold: 'route', verdict: 'skipped-cooldown' }],
		citation: [{ view: cited.view, canonicalBytes: cited.canonicalBytes }],
		auditLedgerPath: '/tmp/flauz-drills-audit-fixture/presentation-audits.jsonl',
	};
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

function rejected(admission: { admitted: boolean; reason?: string; detail?: string }, reason: string): void {
	assert.equal(admission.admitted, false, `expected the typed rejection '${reason}', got: ${JSON.stringify(admission).slice(0, 300)}`);
	assert.equal(admission.reason, reason);
	assert.equal(typeof admission.detail, 'string');
	assert.ok((admission.detail as string).length > 0, 'the rejection detail names the violation');
}

suite('INF-009 drill contracts', () => {
	suite('version stamping (the single declaration)', () => {
		test('the contract copy is 1.0.0', () => {
			assert.equal(INFERENCE_DRILLS_VERSION, '1.0.0');
		});
		test('the kit re-export equals the contract copy (the single-declaration law)', () => {
			assert.equal(KIT_REEXPORT_INFERENCE_DRILLS_VERSION, INFERENCE_DRILLS_VERSION);
		});
	});

	suite('the closed frozen vocabularies', () => {
		test('DRILL_SCENARIO_KINDS is frozen with the six honest members in order', () => {
			assert.deepEqual([...DRILL_SCENARIO_KINDS], [
				'cooldown-hold',
				'retry-schedule',
				'failover-walk',
				'eligibility-denial',
				'quota-exhaustion',
				'substitution-disclosure',
			]);
			assert.ok(Object.isFrozen(DRILL_SCENARIO_KINDS));
		});
		test('every scenario kind is a short kebab-case string', () => {
			for (const kind of DRILL_SCENARIO_KINDS) {
				assert.match(kind, /^[a-z]+(-[a-z]+)*$/);
			}
		});
		test('DRILL_VERDICT_FAMILIES is frozen with the honest observables and the unknown tail', () => {
			assert.deepEqual([...DRILL_VERDICT_FAMILIES], [
				'cooldown-hold',
				'cooldown-breach',
				'retry-schedule-byte-equal',
				'retry-schedule-diverged',
				'failover-walk-exhausted',
				'failover-walk-selected',
				'eligibility-ineligible',
				'eligibility-term-unknown',
				'eligibility-eligible',
				'quota-exhausted',
				'quota-available',
				'substitution-rejected',
				'substitution-admitted',
				'unknown',
			]);
			assert.ok(Object.isFrozen(DRILL_VERDICT_FAMILIES));
		});
		test('DRILL_FOLDS is frozen with the eleven landed folds in order', () => {
			assert.deepEqual([...DRILL_FOLDS], [
				'admitHonestPromise',
				'unverifiedProvenance',
				'route',
				'runWithFailover',
				'checkEligibility',
				'quotaWindowContains',
				'cooldownActive',
				'projectCapacityDisclosure',
				'projectProvenance',
				'projectReset',
				'projectDecision',
			]);
			assert.ok(Object.isFrozen(DRILL_FOLDS));
		});
		test('DRILL_REJECTION_REASONS is frozen with the ten members in the exact check order', () => {
			assert.deepEqual([...DRILL_REJECTION_REASONS], [
				'not-an-object',
				'version-mismatch',
				'scenario-malformed',
				'scenario-kind-unrunnable',
				'fixture-id-not-synthetic',
				'scenario-inputs-rejected',
				'scenario-target-malformed',
				'receipt-malformed',
				'receipt-citation-missing',
				'receipt-citation-rejected',
			]);
			assert.ok(Object.isFrozen(DRILL_REJECTION_REASONS));
		});
	});

	suite('admitDrillScenario (the fail-closed scenario walk)', () => {
		test('the cooldown-hold fixture scenario admits', () => {
			const admission = admitDrillScenario(cooldownScenario());
			assert.equal(admission.admitted, true);
			assert.equal((admission as { scenario: DrillScenario }).scenario.kind, 'cooldown-hold');
		});
		test('the eligibility-denial fixture scenario admits with its target binding', () => {
			const admission = admitDrillScenario(eligibilityScenario());
			assert.equal(admission.admitted, true);
			const scenario = (admission as { scenario: DrillScenario }).scenario;
			assert.equal(scenario.targetId, FIXTURE_SCOPE_PROHIBITED);
			assert.equal(scenario.expected, 'eligibility-ineligible');
		});
		test('every scenario kind admits over the honest fixture base (the kind coverage)', () => {
			for (const kind of DRILL_SCENARIO_KINDS) {
				const candidate: Record<string, unknown> = {
					...scenarioBase(),
					scenarioId: `fixture.scenario.${kind}`,
					kind,
					expected: 'unknown',
				};
				if (kind === 'eligibility-denial') {
					candidate.targetId = FIXTURE_SCOPE_PERMITTED;
				}
				assert.equal(admitDrillScenario(candidate).admitted, true, `kind '${kind}' must admit`);
			}
		});
		test('the optional matrix surface admits through the LANDED guard', () => {
			const admission = admitDrillScenario({ ...cooldownScenario(), matrix: fixtureMatrix() });
			assert.equal(admission.admitted, true);
		});
		test('a non-object candidate is the typed not-an-object rejection (null, number, string, boolean)', () => {
			rejected(admitDrillScenario(null), 'not-an-object');
			rejected(admitDrillScenario(42), 'not-an-object');
			rejected(admitDrillScenario('scenario'), 'not-an-object');
			rejected(admitDrillScenario(true), 'not-an-object');
		});
		test('an array candidate rides the landed isRecord idiom: the first failure is the version check', () => {
			rejected(admitDrillScenario([cooldownScenario()]), 'version-mismatch');
		});
		test('a wrong contractVersion is the typed version-mismatch rejection', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), contractVersion: '9.9.9' }), 'version-mismatch');
		});
		test('a field beyond the scenario shape is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), displayLabel: 'caller-supplied' }), 'scenario-malformed');
		});
		test('an empty scenarioId is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), scenarioId: '' }), 'scenario-malformed');
		});
		test('a non-finite clockSeed is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), clockSeed: Number.NaN }), 'scenario-malformed');
		});
		test('an expected outside the verdict-family vocabulary is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), expected: 'not-a-family' }), 'scenario-malformed');
		});
		test('an array catalog surface is scenario-malformed (the landed records are objects)', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), catalog: [fixtureCatalog()] }), 'scenario-malformed');
		});
		test('a null adapters surface is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), adapters: null }), 'scenario-malformed');
		});
		test('an array matrix surface is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), matrix: [fixtureMatrix()] }), 'scenario-malformed');
		});
		test('an empty-string targetId is scenario-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), targetId: '' }), 'scenario-malformed');
		});
		test('an unknown kind is the typed scenario-kind-unrunnable rejection', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), kind: 'route' }), 'scenario-kind-unrunnable');
		});
		test('the admitted scenario re-admits (the walk is deterministic)', () => {
			const admission = admitDrillScenario(eligibilityScenario());
			assert.equal(admission.admitted, true);
			assert.equal(admitDrillScenario((admission as { scenario: DrillScenario }).scenario).admitted, true);
		});
	});

	suite('the fixture-prefixed law (the authority-looking id walk)', () => {
		test('an authority-looking scenarioId is the typed rejection with the id named', () => {
			const admission = admitDrillScenario({ ...cooldownScenario(), scenarioId: 'openai-cooldown' });
			rejected(admission, 'fixture-id-not-synthetic');
			assert.match((admission as { detail: string }).detail, /openai-cooldown/);
		});
		test('an authority-looking catalog id is the typed rejection', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			catalog.catalogId = 'provider-catalog-production';
			rejected(admitDrillScenario({ ...cooldownScenario(), catalog }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking catalog entry id is the typed rejection', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[0].entryId = 'gpt-4-main';
			rejected(admitDrillScenario({ ...cooldownScenario(), catalog }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking adapter-set id is the typed rejection', () => {
			const adapters = fixtureAdapters() as Record<string, unknown>;
			adapters.adapterSetId = 'adapter-set-prod';
			rejected(admitDrillScenario({ ...cooldownScenario(), adapters }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking adapter id is the typed rejection', () => {
			const adapters = fixtureAdapters() as Record<string, unknown>;
			(adapters.adapters as Record<string, unknown>[])[1].adapterId = 'anthropic-main';
			rejected(admitDrillScenario({ ...cooldownScenario(), adapters }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking scope id is the typed rejection', () => {
			const scopes = fixtureScopes() as Record<string, unknown>;
			(scopes.scopes as Record<string, unknown>[])[0].id = 'scope-production';
			rejected(admitDrillScenario({ ...cooldownScenario(), scopes }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking matrix model id is the typed rejection', () => {
			const matrix = fixtureMatrix() as Record<string, unknown>;
			(matrix.descriptors as Record<string, unknown>[])[0].modelId = 'llama-3-main';
			rejected(admitDrillScenario({ ...cooldownScenario(), matrix }), 'fixture-id-not-synthetic');
		});
		test('an authority-looking eligibility target id is the typed rejection', () => {
			rejected(
				admitDrillScenario({ ...eligibilityScenario(), targetId: 'team-scope-real' }),
				'fixture-id-not-synthetic',
			);
		});
	});

	suite('the scenario-inputs walk (the LANDED guards, reasons cited verbatim)', () => {
		test('a catalog failing the LANDED guard is scenario-inputs-rejected with the landed reason cited', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[1].entryId = FIXTURE_PROVIDER_PERMITTED;
			const admission = admitDrillScenario({ ...cooldownScenario(), catalog });
			rejected(admission, 'scenario-inputs-rejected');
			assert.match((admission as { detail: string }).detail, /duplicate-entry-id/);
		});
		test('an adapter record with a dangling provider entry is scenario-inputs-rejected', () => {
			const adapters = fixtureAdapters() as Record<string, unknown>;
			(adapters.adapters as Record<string, unknown>[])[0].providerEntryId = 'fixture.provider.dangling';
			const admission = admitDrillScenario({ ...cooldownScenario(), adapters });
			rejected(admission, 'scenario-inputs-rejected');
			assert.match((admission as { detail: string }).detail, /unknown-provider-entry/);
		});
		test('a scope with a mismatched handleRef is scenario-inputs-rejected (the handle-equality law)', () => {
			const scopes = fixtureScopes() as Record<string, unknown>;
			(scopes.scopes as Record<string, unknown>[])[0].handleRef = 'fixture.credential.handle.other';
			const admission = admitDrillScenario({ ...cooldownScenario(), scopes });
			rejected(admission, 'scenario-inputs-rejected');
			assert.match((admission as { detail: string }).detail, /credential-handle-mismatch/);
		});
		test('a matrix with an unknown provider entry is scenario-inputs-rejected', () => {
			const matrix = fixtureMatrix() as Record<string, unknown>;
			(matrix.descriptors as Record<string, unknown>[])[0].providerEntryId = 'fixture.provider.dangling';
			rejected(admitDrillScenario({ ...cooldownScenario(), matrix }), 'scenario-inputs-rejected');
		});
	});

	suite('the target-binding walk', () => {
		test('an eligibility-denial scenario with no target is scenario-target-malformed', () => {
			const candidate = eligibilityScenario() as Record<string, unknown>;
			delete candidate.targetId;
			rejected(admitDrillScenario(candidate), 'scenario-target-malformed');
		});
		test('a dangling eligibility target is scenario-target-malformed', () => {
			rejected(
				admitDrillScenario({ ...eligibilityScenario(), targetId: 'fixture.scope.dangling' }),
				'scenario-target-malformed',
			);
		});
		test('a target on a non-targeting kind is scenario-target-malformed', () => {
			rejected(admitDrillScenario({ ...cooldownScenario(), targetId: FIXTURE_SCOPE_PERMITTED }), 'scenario-target-malformed');
		});
	});

	suite('the check-order pins (first-failure-is-the-verdict)', () => {
		test('version-mismatch precedes scenario-malformed', () => {
			const candidate = { ...cooldownScenario(), contractVersion: '0.0.1' } as Record<string, unknown>;
			candidate.displayLabel = 'also-malformed';
			rejected(admitDrillScenario(candidate), 'version-mismatch');
		});
		test('scenario-malformed precedes scenario-kind-unrunnable', () => {
			rejected(
				admitDrillScenario({ ...cooldownScenario(), kind: 'route', clockSeed: Number.NaN }),
				'scenario-malformed',
			);
		});
		test('scenario-kind-unrunnable precedes the fixture-prefixed walk', () => {
			const candidate = { ...cooldownScenario(), kind: 'route' } as Record<string, unknown>;
			candidate.scenarioId = 'openai-cooldown';
			rejected(admitDrillScenario(candidate), 'scenario-kind-unrunnable');
		});
		test('the fixture-prefixed walk precedes the LANDED inputs walk', () => {
			const catalog = fixtureCatalog() as Record<string, unknown>;
			(catalog.entries as Record<string, unknown>[])[1].entryId = FIXTURE_PROVIDER_PERMITTED;
			catalog.catalogId = 'provider-catalog-production';
			rejected(admitDrillScenario({ ...cooldownScenario(), catalog }), 'fixture-id-not-synthetic');
		});
		test('the LANDED inputs walk precedes the target-binding walk', () => {
			const scopes = fixtureScopes() as Record<string, unknown>;
			(scopes.scopes as Record<string, unknown>[])[0].handleRef = 'fixture.credential.handle.other';
			const candidate = { ...eligibilityScenario(), scopes, targetId: 'fixture.scope.dangling' };
			rejected(admitDrillScenario(candidate), 'scenario-inputs-rejected');
		});
	});

	suite('admitDrillReceipt + isDrillReceipt (the acceptance-view citation walk)', () => {
		test('the honest fixture receipt admits and isDrillReceipt holds', () => {
			const receipt = fixtureReceipt();
			assert.equal(admitDrillReceipt(receipt).admitted, true);
			assert.equal(isDrillReceipt(receipt), true);
		});
		test('a non-object receipt is the typed not-an-object rejection', () => {
			rejected(admitDrillReceipt(null), 'not-an-object');
			rejected(admitDrillReceipt('receipt'), 'not-an-object');
		});
		test('a wrong receipt version is the typed version-mismatch rejection', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), contractVersion: '0.9.0' }), 'version-mismatch');
		});
		test('a field beyond the receipt shape is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), note: 'extra' }), 'receipt-malformed');
		});
		test('an unknown scenarioKind is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), scenarioKind: 'route' }), 'receipt-malformed');
		});
		test('an expected outside the verdict families is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), expected: 'nope' }), 'receipt-malformed');
		});
		test('an observed outside the verdict families is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), observed: 'nope' }), 'receipt-malformed');
		});
		test('a lying passed flag is receipt-malformed (the structural pass law)', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), observed: 'cooldown-breach', passed: true }), 'receipt-malformed');
		});
		test('the structural pass law holds in the failing direction too', () => {
			const receipt = { ...fixtureReceipt(), observed: 'cooldown-breach', passed: false };
			assert.equal(admitDrillReceipt(receipt).admitted, true);
			rejected(admitDrillReceipt({ ...fixtureReceipt(), observed: 'cooldown-breach', passed: false, expected: 'cooldown-breach' }), 'receipt-malformed');
		});
		test('an empty drill log is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), drillLog: [] }), 'receipt-malformed');
		});
		test('a log row with an unknown fold is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), drillLog: [{ fold: 'somewhere', verdict: 'x' }] }), 'receipt-malformed');
		});
		test('a log row with an empty verdict is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), drillLog: [{ fold: 'route', verdict: '' }] }), 'receipt-malformed');
		});
		test('an empty auditLedgerPath is receipt-malformed', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), auditLedgerPath: '' }), 'receipt-malformed');
		});
		test('a receipt with NO citation field is receipt-citation-missing', () => {
			const candidate = fixtureReceipt() as unknown as Record<string, unknown>;
			delete candidate.citation;
			rejected(admitDrillReceipt(candidate), 'receipt-citation-missing');
		});
		test('a receipt with an EMPTY citation array is receipt-citation-missing', () => {
			rejected(admitDrillReceipt({ ...fixtureReceipt(), citation: [] }), 'receipt-citation-missing');
		});
		test('a cited view failing the LANDED shape guards is receipt-citation-rejected', () => {
			const receipt = fixtureReceipt() as unknown as Record<string, unknown>;
			const citation = [{ view: { contractVersion: INFERENCE_PRESENTATION_VERSION, fake: 'view' }, canonicalBytes: '{}'}];
			receipt.citation = citation;
			rejected(admitDrillReceipt(receipt), 'receipt-citation-rejected');
		});
		test('a citation whose bytes are not the LANDED canonical bytes is receipt-citation-rejected', () => {
			const cited = fixtureProvenanceView();
			const receipt = {
				...fixtureReceipt(),
				citation: [{ view: cited.view, canonicalBytes: cited.canonicalBytes.replace('unverified', 'verified') }],
			};
			rejected(admitDrillReceipt(receipt), 'receipt-citation-rejected');
		});
		test('a citation row with a caller-supplied field is receipt-citation-rejected', () => {
			const cited = fixtureProvenanceView();
			const receipt = {
				...fixtureReceipt(),
				citation: [{ view: cited.view, canonicalBytes: cited.canonicalBytes, label: 'caller-supplied' }],
			};
			rejected(admitDrillReceipt(receipt), 'receipt-citation-rejected');
		});
	});

	suite('serializeDrillReceipt (the canonical bytes)', () => {
		test('the honest receipt round-trips: serialize, parse, admit, re-serialize byte-equal', () => {
			const receipt = fixtureReceipt();
			const bytes = serializeDrillReceipt(receipt);
			const parsed = JSON.parse(bytes) as unknown;
			assert.equal(admitDrillReceipt(parsed).admitted, true);
			assert.equal(serializeDrillReceipt(parsed), bytes);
		});
		test('the emitted bytes carry the fixed key order', () => {
			const bytes = serializeDrillReceipt(fixtureReceipt());
			const keys = Object.keys(JSON.parse(bytes) as Record<string, unknown>);
			assert.deepEqual(keys, [
				'contractVersion',
				'scenarioId',
				'scenarioKind',
				'expected',
				'observed',
				'passed',
				'drillLog',
				'citation',
				'auditLedgerPath',
			]);
		});
		test('the cited view rides the LANDED serializer key order (re-parsed, never re-derived)', () => {
			const bytes = serializeDrillReceipt(fixtureReceipt());
			const receipt = JSON.parse(bytes) as { citation: { view: Record<string, unknown> }[] };
			const cited = fixtureProvenanceView();
			assert.deepEqual(
				Object.keys(receipt.citation[0].view),
				Object.keys(JSON.parse(cited.canonicalBytes) as Record<string, unknown>),
			);
		});
		test('double-run byte equality: two serializations of the same receipt are byte-equal', () => {
			const receipt = fixtureReceipt();
			assert.equal(serializeDrillReceipt(receipt), serializeDrillReceipt(receipt));
		});
		test('a key-reordered dishonest receipt still serializes to the same canonical bytes', () => {
			const receipt = fixtureReceipt();
			const reordered = {
				auditLedgerPath: receipt.auditLedgerPath,
				citation: receipt.citation,
				drillLog: receipt.drillLog,
				passed: receipt.passed,
				observed: receipt.observed,
				expected: receipt.expected,
				scenarioKind: receipt.scenarioKind,
				scenarioId: receipt.scenarioId,
				contractVersion: receipt.contractVersion,
			};
			assert.equal(serializeDrillReceipt(reordered), serializeDrillReceipt(receipt));
		});
		test('a dishonest receipt never gets canonical bytes (fail-closed TypeError)', () => {
			assert.throws(() => serializeDrillReceipt({ ...fixtureReceipt(), citation: [] }), TypeError);
			assert.throws(() => serializeDrillReceipt({ nope: true }), TypeError);
		});
	});

	suite('the determinism ban (in-suite source grep)', () => {
		test('every Date.now / Math.random / process.env hit in drillsContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/drillsContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
		test('every Date.now / Math.random / process.env hit in drillsKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/drillsKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
