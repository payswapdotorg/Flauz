/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 parity contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: the grammar under test is the REAL frozen grammar
 * (order-given vocabulary; passing it straight into projectParity is
 * the zero-import law's compile-time structural pin). Registry
 * fixtures are synthetic inputs over real grammar paths; the custom
 * grammar fixtures are synthetic 'workspace.*' entries. Nothing here
 * is presented as authority state.
 */
import { strict as assert } from 'node:assert';
import {
	CLI_COMMAND_GRAMMAR,
	CLI_JOURNEYS as GRAMMAR_JOURNEYS,
	CLI_PARITY_CONTRACTS_VERSION as GRAMMAR_VERSION,
} from '../../common/grammar.js';
import {
	CLI_OUTCOMES as WIRE_OUTCOMES,
	CLI_PARITY_CONTRACTS_VERSION as WIRE_VERSION,
} from '../../common/wire.js';
import {
	CLI_OUTCOMES as EXITCODES_OUTCOMES,
	CLI_PARITY_CONTRACTS_VERSION as EXITCODES_VERSION,
} from '../../common/exitcodes.js';
import {
	CLI_JOURNEYS,
	CLI_OUTCOMES,
	CLI_PARITY_CONTRACTS_VERSION,
	PARITY_REJECTION_REASONS,
	PARITY_VERDICTS,
	isParityVerdict,
	parityDrift,
	projectParity,
} from '../../common/parity.js';
import type {
	CliGrammarEntry,
	CliOutcome as ParityCliOutcome,
	ExpectedParityMap,
	JourneyParityEntry,
	JourneyParityView,
	ParityDrift as DriftResult,
	ParityOutcome,
	ParityVerdict,
	ParityViewBuilt,
	ParityViewRejected,
	RegisteredProjection,
} from '../../common/parity.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const ALL_PAR_FULL: ExpectedParityMap = {
	'workspace': 'par-full',
	'background-agent': 'par-full',
	'workflow': 'par-full',
	'approval': 'par-full',
	'evidence': 'par-full',
	'replay': 'par-full',
	'lab': 'par-full',
	'capability-discovery': 'par-full',
};

const EXPECTED_COVERAGE: Record<string, number> = {
	'workspace': 3,
	'background-agent': 8,
	'workflow': 3,
	'approval': 2,
	'evidence': 3,
	'replay': 3,
	'lab': 4,
	'capability-discovery': 3,
};

function registryEntry(commandPath: string, lastOutcome: ParityCliOutcome): RegisteredProjection {
	return { commandPath, lastOutcome };
}

function registryOf(
	paths: readonly string[],
	lastOutcome: ParityCliOutcome = 'ok',
): RegisteredProjection[] {
	return paths.map((path) => registryEntry(path, lastOutcome));
}

function fullRegistry(): RegisteredProjection[] {
	return registryOf(CLI_COMMAND_GRAMMAR.map((entry) => entry.path));
}

function customWorkspaceGrammar(): CliGrammarEntry[] {
	return ['status', 'list', 'focus'].map((command) => ({
		journey: 'workspace' as const,
		command,
		path: `workspace.${command}`,
		argSpec: [],
		summaryDigest: `summary-digest:workspace.${command}`,
	}));
}

function builtView(outcome: ParityOutcome): JourneyParityView {
	assert.equal(outcome.built, true, `expected built view, got: ${JSON.stringify(outcome)}`);
	return (outcome as ParityViewBuilt).view;
}

function rejectedView(outcome: ParityOutcome): ParityViewRejected {
	assert.equal(outcome.built, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
	return outcome as ParityViewRejected;
}

function viewFrom(
	grammar: readonly CliGrammarEntry[],
	projections: readonly RegisteredProjection[],
): JourneyParityView {
	return builtView(projectParity(grammar, projections, FIXTURE_SCOPE));
}

function entryFor(view: JourneyParityView, journey: string): JourneyParityEntry {
	const entry = view.journeys.find((candidate) => candidate.journey === journey);
	assert.ok(entry !== undefined, `view must carry an entry for journey '${journey}'`);
	return entry;
}

suite('ZC-009 parity contracts', () => {

	suite('constants, closed lists and sibling-copy pins', () => {
		test('contract set version matches the grammar, wire and exitcodes copies (one versioned set)', () => {
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, GRAMMAR_VERSION);
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, WIRE_VERSION);
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, EXITCODES_VERSION);
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, '1.0.0');
		});

		test('parity verdicts are the closed par-full/par-partial/par-absent list', () => {
			assert.deepStrictEqual([...PARITY_VERDICTS], ['par-full', 'par-partial', 'par-absent']);
		});

		test('parity rejection reasons are the closed five-reason list', () => {
			assert.deepStrictEqual([...PARITY_REJECTION_REASONS], [
				'invalid-scope',
				'invalid-grammar',
				'unknown-journey',
				'invalid-projection',
				'unknown-outcome',
			]);
		});

		test('the journey sibling copy equals the grammar module list (the parity pin, again)', () => {
			assert.deepStrictEqual([...CLI_JOURNEYS], [...GRAMMAR_JOURNEYS]);
			assert.equal(CLI_JOURNEYS.length, 8);
		});

		test('the outcome sibling copy equals the wire module list', () => {
			assert.deepStrictEqual([...CLI_OUTCOMES], [...WIRE_OUTCOMES]);
			assert.deepStrictEqual([...CLI_OUTCOMES], [...EXITCODES_OUTCOMES]);
		});

		test('isParityVerdict accepts the three verdicts and rejects junk', () => {
			assert.ok(isParityVerdict('par-full'));
			assert.ok(isParityVerdict('par-partial'));
			assert.ok(isParityVerdict('par-absent'));
			assert.ok(!isParityVerdict('teleport'));
			assert.ok(!isParityVerdict(null));
			assert.ok(!isParityVerdict(1));
		});
	});

	suite('projectParity: view shape and the record law', () => {
		test('stamps the scope, forces the contract version and carries exactly eight journeys', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			assert.deepStrictEqual(view.scope, FIXTURE_SCOPE);
			assert.equal(view.contractVersion, CLI_PARITY_CONTRACTS_VERSION);
			assert.equal(view.journeys.length, 8);
			assert.deepStrictEqual(Object.keys(view).sort(), ['contractVersion', 'journeys', 'scope']);
		});

		test('journeys appear in the frozen list order', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, []);
			assert.deepStrictEqual(
				view.journeys.map((entry) => entry.journey),
				[...CLI_JOURNEYS],
			);
		});

		test('every entry carries coverage, matched count, distribution and verdict', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			const workspace = entryFor(view, 'workspace');
			assert.equal(workspace.grammarCoverage, 3);
			assert.equal(workspace.registeredProjections, 3);
			assert.deepStrictEqual(workspace.outcomeDistribution, {
				ok: 3,
				'typed-refusal': 0,
				'not-found': 0,
				partial: 0,
			});
			assert.equal(workspace.verdict, 'par-full');
		});
	});

	suite('projectParity: verdict rules', () => {
		test('a full registry over the frozen grammar: every journey par-full, coverage per group, sum 29', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			let sum = 0;
			for (const entry of view.journeys) {
				assert.equal(entry.verdict, 'par-full', `journey '${entry.journey}'`);
				assert.equal(entry.grammarCoverage, EXPECTED_COVERAGE[entry.journey]);
				assert.equal(entry.registeredProjections, entry.grammarCoverage);
				sum += entry.grammarCoverage;
			}
			assert.equal(sum, 29);
		});

		test('an empty registry: every journey par-absent with zero distributions', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, []);
			for (const entry of view.journeys) {
				assert.equal(entry.verdict, 'par-absent', `journey '${entry.journey}'`);
				assert.equal(entry.registeredProjections, 0);
				assert.deepStrictEqual(entry.outcomeDistribution, {
					ok: 0,
					'typed-refusal': 0,
					'not-found': 0,
					partial: 0,
				});
			}
		});

		test('a workspace-only registry: workspace par-full, the other seven par-absent', () => {
			const view = viewFrom(
				CLI_COMMAND_GRAMMAR,
				registryOf(['workspace.status', 'workspace.list', 'workspace.focus']),
			);
			assert.equal(entryFor(view, 'workspace').verdict, 'par-full');
			for (const entry of view.journeys) {
				if (entry.journey !== 'workspace') {
					assert.equal(entry.verdict, 'par-absent', `journey '${entry.journey}'`);
				}
			}
		});

		test('seven of eight background-agent paths: par-partial with registeredProjections 7', () => {
			const agentPaths = CLI_COMMAND_GRAMMAR
				.filter((entry) => entry.journey === 'background-agent')
				.map((entry) => entry.path)
				.slice(0, 7);
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registryOf(agentPaths));
			const agent = entryFor(view, 'background-agent');
			assert.equal(agent.verdict, 'par-partial');
			assert.equal(agent.grammarCoverage, 8);
			assert.equal(agent.registeredProjections, 7);
		});

		test('one of three workspace paths: par-partial', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registryOf(['workspace.status']));
			const workspace = entryFor(view, 'workspace');
			assert.equal(workspace.verdict, 'par-partial');
			assert.equal(workspace.registeredProjections, 1);
		});

		test('a custom grammar with an empty journey group: that journey is par-absent, its registry paths unmatched', () => {
			const view = viewFrom(customWorkspaceGrammar(), fullRegistry());
			assert.equal(entryFor(view, 'workspace').verdict, 'par-full');
			const lab = entryFor(view, 'lab');
			assert.equal(lab.grammarCoverage, 0);
			assert.equal(lab.verdict, 'par-absent');
			assert.ok(lab.unmatchedProjectionPaths.includes('lab.runs'));
		});

		test('unmatched registry paths are recorded without changing the verdict (never silent)', () => {
			const registry = [...fullRegistry(), registryEntry('lab.teleport', 'ok')];
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registry);
			const lab = entryFor(view, 'lab');
			assert.equal(lab.verdict, 'par-full');
			assert.deepStrictEqual(lab.unmatchedProjectionPaths, ['lab.teleport']);
		});
	});

	suite('projectParity: outcome distribution', () => {
		test('mixed outcomes are counted exactly, per journey, over every registry entry', () => {
			const registry: RegisteredProjection[] = [
				registryEntry('workspace.status', 'ok'),
				registryEntry('workspace.list', 'partial'),
				registryEntry('workspace.focus', 'not-found'),
				registryEntry('background-agent.launch', 'typed-refusal'),
			];
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registry);
			assert.deepStrictEqual(entryFor(view, 'workspace').outcomeDistribution, {
				ok: 1,
				'typed-refusal': 0,
				'not-found': 1,
				partial: 1,
			});
			assert.deepStrictEqual(entryFor(view, 'background-agent').outcomeDistribution, {
				ok: 0,
				'typed-refusal': 1,
				'not-found': 0,
				partial: 0,
			});
		});

		test('duplicate registry entries: matched counts distinct paths, the distribution counts every entry', () => {
			const registry: RegisteredProjection[] = [
				registryEntry('approval.list', 'ok'),
				registryEntry('approval.list', 'ok'),
			];
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registry);
			const approval = entryFor(view, 'approval');
			assert.equal(approval.registeredProjections, 1);
			assert.equal(approval.grammarCoverage, 2);
			assert.equal(approval.verdict, 'par-partial');
			assert.equal(approval.outcomeDistribution.ok, 2);
		});
	});

	suite('projectParity: fail-closed', () => {
		test('rejects an invalid scope', () => {
			const rejected = rejectedView(
				projectParity(CLI_COMMAND_GRAMMAR, [], { workspaceId: '', tenantId: 'tenant-fixture' }),
			);
			assert.equal(rejected.reason, 'invalid-scope');
		});

		test('rejects a grammar entry whose journey is outside the frozen list', () => {
			const junkGrammar = [
				{
					journey: 'teleport' as unknown as CliGrammarEntry['journey'],
					command: 'status',
					path: 'teleport.status',
					argSpec: [],
					summaryDigest: 'summary-digest:teleport.status',
				},
			];
			const rejected = rejectedView(projectParity(junkGrammar, [], FIXTURE_SCOPE));
			assert.equal(rejected.reason, 'unknown-journey');
			assert.ok(rejected.detail.includes('teleport'));
		});

		test('rejects a grammar entry with an empty path', () => {
			const junkGrammar = [
				{ ...customWorkspaceGrammar()[0], path: '' },
			];
			const rejected = rejectedView(projectParity(junkGrammar, [], FIXTURE_SCOPE));
			assert.equal(rejected.reason, 'invalid-grammar');
		});

		test('rejects duplicate grammar paths, naming the path', () => {
			const grammar = [...customWorkspaceGrammar(), customWorkspaceGrammar()[0]];
			const rejected = rejectedView(projectParity(grammar, [], FIXTURE_SCOPE));
			assert.equal(rejected.reason, 'invalid-grammar');
			assert.ok(rejected.detail.includes('workspace.status'));
		});

		test('rejects a grammar entry whose path disagrees with its journey', () => {
			const junkGrammar = [
				{ ...customWorkspaceGrammar()[0], path: 'lab.runs' },
			];
			const rejected = rejectedView(projectParity(junkGrammar, [], FIXTURE_SCOPE));
			assert.equal(rejected.reason, 'invalid-grammar');
			assert.ok(rejected.detail.includes('lab.runs'));
		});

		test('rejects a registry entry with an empty commandPath', () => {
			const rejected = rejectedView(
				projectParity(CLI_COMMAND_GRAMMAR, [registryEntry('', 'ok')], FIXTURE_SCOPE),
			);
			assert.equal(rejected.reason, 'invalid-projection');
		});

		test('rejects a registry entry with a junk outcome', () => {
			const junk = [registryEntry('workspace.status', 'teleport' as unknown as ParityCliOutcome)];
			const rejected = rejectedView(projectParity(CLI_COMMAND_GRAMMAR, junk, FIXTURE_SCOPE));
			assert.equal(rejected.reason, 'unknown-outcome');
			assert.ok(rejected.detail.includes('workspace.status'));
		});

		test('rejects a registry entry whose journey segment is unknown', () => {
			const rejected = rejectedView(
				projectParity(CLI_COMMAND_GRAMMAR, [registryEntry('teleport.status', 'ok')], FIXTURE_SCOPE),
			);
			assert.equal(rejected.reason, 'unknown-journey');
			assert.ok(rejected.detail.includes('teleport.status'));
		});
	});

	suite('projectParity: purity', () => {
		test('never mutates the grammar or the registry', () => {
			const grammar = [...customWorkspaceGrammar()];
			const registry = registryOf(['workspace.status', 'workspace.list']);
			const grammarSnapshot = JSON.parse(JSON.stringify(grammar)) as CliGrammarEntry[];
			const registrySnapshot = JSON.parse(JSON.stringify(registry)) as RegisteredProjection[];
			projectParity(grammar, registry, FIXTURE_SCOPE);
			assert.deepStrictEqual(grammar, grammarSnapshot);
			assert.deepStrictEqual(registry, registrySnapshot);
		});

		test('is deterministic: identical inputs yield deep-equal views', () => {
			const first = projectParity(CLI_COMMAND_GRAMMAR, fullRegistry(), FIXTURE_SCOPE);
			const second = projectParity(CLI_COMMAND_GRAMMAR, fullRegistry(), FIXTURE_SCOPE);
			assert.deepStrictEqual(first, second);
		});
	});

	suite('parityDrift', () => {
		test('in sync when the expected map matches the view', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			const drift = parityDrift(view, ALL_PAR_FULL);
			assert.equal(drift.inSync, true);
			assert.deepStrictEqual(drift.missingJourneys, []);
			assert.deepStrictEqual(drift.extraJourneys, []);
			assert.deepStrictEqual(drift.verdictMismatches, []);
		});

		test('missing journeys are named: expected keys absent from the view', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, []);
			const expected: ExpectedParityMap = { ...ALL_PAR_FULL, teleport: 'par-full' };
			const drift = parityDrift(view, expected);
			assert.ok(drift.missingJourneys.includes('teleport'));
			assert.equal(drift.inSync, false);
		});

		test('extra journeys are named: view journeys absent from expected', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			const expected: ExpectedParityMap = { ...ALL_PAR_FULL };
			delete (expected as Record<string, ParityVerdict>)['lab'];
			const drift = parityDrift(view, expected);
			assert.ok(drift.extraJourneys.includes('lab'));
			assert.equal(drift.inSync, false);
		});

		test('verdict mismatches are named with expected and actual', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registryOf(['workspace.status']));
			const expected: ExpectedParityMap = { ...ALL_PAR_FULL };
			const drift = parityDrift(view, expected);
			assert.equal(drift.inSync, false);
			const workspaceMismatch = drift.verdictMismatches.find(
				(mismatch) => mismatch.journey === 'workspace',
			);
			assert.ok(workspaceMismatch !== undefined);
			assert.equal(workspaceMismatch.expected, 'par-full');
			assert.equal(workspaceMismatch.actual, 'par-partial');
		});

		test('combined drift: all three channels populated, nothing silent', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registryOf(['workspace.status']));
			const expected: ExpectedParityMap = { ...ALL_PAR_FULL, teleport: 'par-full' };
			delete (expected as Record<string, ParityVerdict>)['lab'];
			const drift = parityDrift(view, expected);
			assert.equal(drift.inSync, false);
			assert.ok(drift.missingJourneys.length > 0);
			assert.ok(drift.extraJourneys.length > 0);
			assert.ok(drift.verdictMismatches.length > 0);
		});

		test('a single divergence anywhere flips inSync to false', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			const missingOnly = parityDrift(view, { ...ALL_PAR_FULL, teleport: 'par-full' });
			assert.equal(missingOnly.inSync, false);
			const extraOnlyExpected: ExpectedParityMap = { ...ALL_PAR_FULL };
			delete (extraOnlyExpected as Record<string, ParityVerdict>)['evidence'];
			const extraOnly = parityDrift(view, extraOnlyExpected);
			assert.equal(extraOnly.inSync, false);
			const mismatchOnly = parityDrift(view, { ...ALL_PAR_FULL, lab: 'par-absent' });
			assert.equal(mismatchOnly.inSync, false);
		});

		test('is pure and deterministic', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, registryOf(['workspace.status']));
			const expected: ExpectedParityMap = { workspace: 'par-full' };
			const viewSnapshot = JSON.parse(JSON.stringify(view)) as JourneyParityView;
			const first: DriftResult = parityDrift(view, expected);
			const second: DriftResult = parityDrift(view, expected);
			assert.deepStrictEqual(first, second);
			assert.deepStrictEqual(view, viewSnapshot);
		});
	});

	suite('end-to-end parity chain', () => {
		test('frozen grammar + full registry + all-par-full expectation: full everywhere, drift in sync', () => {
			const view = viewFrom(CLI_COMMAND_GRAMMAR, fullRegistry());
			for (const entry of view.journeys) {
				assert.equal(entry.verdict, 'par-full', `journey '${entry.journey}'`);
				assert.equal(entry.unmatchedProjectionPaths.length, 0);
			}
			const drift = parityDrift(view, ALL_PAR_FULL);
			assert.equal(drift.inSync, true);
		});
	});
});
