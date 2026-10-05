/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 exit-code/output-format contracts test suite (mocha tdd style,
 * matching build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: responses are built through wire.ts's responseFor
 * over real frozen-grammar command paths; the projections are
 * synthetic inputs carrying no authority state. The approval.respond
 * fixture in the headless-law test is a WIRING demonstration (the
 * projection input declares the refusal), not a claim that the
 * authority marks that surface interactive-only - which surfaces are
 * interactive-only is authority knowledge, unreadable in this lane.
 *
 * STRUCTURAL PIN: wire-built responses are passed directly into
 * exitCodeFor and renderSpec (typed with this module's sibling-copy
 * shapes). That compiles only because the re-declared shapes are
 * structurally identical - the zero-import law's compile-time pin.
 */
import { strict as assert } from 'node:assert';
import { CLI_PARITY_CONTRACTS_VERSION as GRAMMAR_VERSION } from '../../common/grammar.js';
import {
	CLI_OUTCOMES as WIRE_OUTCOMES,
	CLI_PARITY_CONTRACTS_VERSION as WIRE_VERSION,
	CLI_REFUSAL_CODES,
	responseFor,
} from '../../common/wire.js';
import type {
	AbsentProjection as WireAbsentProjection,
	CliOutcome as WireOutcome,
	CliRefusalCode as WireRefusalCode,
	CliRequest as WireCliRequest,
	CliResponse as WireCliResponse,
	CliResponseOutcome as WireResponseOutcome,
	ProjectedProjection as WireProjectedProjection,
	RefusedProjection as WireRefusedProjection,
	ResponseBuilt as WireResponseBuilt,
	ServiceJourney as WireServiceJourney,
} from '../../common/wire.js';
import {
	CLI_MODES,
	CLI_OUTCOMES,
	CLI_PARITY_CONTRACTS_VERSION,
	EXIT_CODE_BY_OUTCOME,
	EXIT_CODES,
	EXIT_NOT_FOUND,
	EXIT_OK,
	EXIT_PARTIAL,
	EXIT_TYPED_REFUSAL,
	EXIT_USAGE_ERROR,
	HEADLESS_INTERACTIVE_REFUSAL_CODE,
	OUTPUT_FORMATS,
	RENDER_FIELDS,
	RENDER_REJECTION_REASONS,
	admitsInteractiveSurfaces,
	exitCodeFor,
	interactiveRefusalCodeFor,
	isHeadlessMode,
	renderSpec,
} from '../../common/exitcodes.js';
import type {
	CliResponse,
	RenderField,
	RenderSpecBuilt,
	RenderSpecOutcome,
} from '../../common/exitcodes.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const EXIT_CODE_BY_OUTCOME_EXPECTED: Record<WireOutcome, number> = {
	ok: EXIT_OK,
	'typed-refusal': EXIT_TYPED_REFUSAL,
	'not-found': EXIT_NOT_FOUND,
	partial: EXIT_PARTIAL,
};

function wireRequest(commandPath: string): WireCliRequest {
	return {
		scope: FIXTURE_SCOPE,
		contractVersion: WIRE_VERSION,
		commandPath,
		args: {},
		requestId: 'req-fixture',
		issuedAtIso: '2025-01-02T00:00:00Z',
	};
}

function projectedFull(
	journey: WireServiceJourney,
	commandPath: string,
): WireProjectedProjection {
	return {
		kind: 'projected',
		journey,
		commandPath,
		projectionDigest: 'projection-digest:fixture',
		completeness: 'full',
	};
}

function projectedPartial(
	journey: WireServiceJourney,
	commandPath: string,
): WireProjectedProjection {
	return {
		kind: 'projected',
		journey,
		commandPath,
		projectionDigest: 'projection-digest:fixture',
		completeness: 'partial',
	};
}

function absent(journey: WireServiceJourney, commandPath: string): WireAbsentProjection {
	return { kind: 'absent', journey, commandPath };
}

function refused(
	journey: WireServiceJourney,
	commandPath: string,
	code: WireRefusalCode,
): WireRefusedProjection {
	return { kind: 'refused', journey, commandPath, refusalCode: code };
}

function builtResponse(outcome: WireResponseOutcome): WireCliResponse {
	assert.equal(outcome.built, true, `expected built response, got: ${JSON.stringify(outcome)}`);
	return (outcome as WireResponseBuilt).response;
}

/** Builds one real wire response per outcome, over a real grammar path. */
function responseOf(outcome: WireOutcome): WireCliResponse {
	const request = wireRequest('workspace.status');
	switch (outcome) {
		case 'ok':
			return builtResponse(responseFor(request, projectedFull('workspace', 'workspace.status'), 10));
		case 'typed-refusal':
			return builtResponse(
				responseFor(request, refused('workspace', 'workspace.status', 'parity-projection-missing'), 10),
			);
		case 'not-found':
			return builtResponse(responseFor(request, absent('workspace', 'workspace.status'), 10));
		case 'partial':
			return builtResponse(responseFor(request, projectedPartial('workspace', 'workspace.status'), 10));
	}
}

function builtSpec(outcome: RenderSpecOutcome): RenderSpecBuilt {
	assert.equal(outcome.built, true, `expected built spec, got: ${JSON.stringify(outcome)}`);
	return outcome as RenderSpecBuilt;
}

function specFields(format: string, response: CliResponse): readonly string[] {
	return builtSpec(renderSpec(format as never, response)).spec.requiredFields;
}

suite('ZC-009 exit-code and output-format contracts', () => {

	suite('constants and closed lists', () => {
		test('contract set version matches the grammar and wire module copies (one versioned set)', () => {
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, GRAMMAR_VERSION);
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, WIRE_VERSION);
			assert.equal(CLI_PARITY_CONTRACTS_VERSION, '1.0.0');
		});

		test('exit codes are the frozen 0/1/2/3/4 vocabulary, with the named constants', () => {
			assert.deepStrictEqual([...EXIT_CODES], [0, 1, 2, 3, 4]);
			assert.equal(EXIT_OK, 0);
			assert.equal(EXIT_TYPED_REFUSAL, 1);
			assert.equal(EXIT_USAGE_ERROR, 2);
			assert.equal(EXIT_NOT_FOUND, 3);
			assert.equal(EXIT_PARTIAL, 4);
		});

		test('the outcome sibling copy equals the wire module copy', () => {
			assert.deepStrictEqual([...CLI_OUTCOMES], [...WIRE_OUTCOMES]);
		});

		test('output formats are the closed json/table/digest list', () => {
			assert.deepStrictEqual([...OUTPUT_FORMATS], ['json', 'table', 'digest']);
		});

		test('render fields are the closed nine-field list', () => {
			assert.deepStrictEqual([...RENDER_FIELDS], [
				'scope',
				'contractVersion',
				'requestId',
				'commandPath',
				'outcome',
				'durationMs',
				'resultDigest',
				'refusalCode',
				'violatedLaw',
			]);
		});

		test('render rejection reasons are the closed two-reason list', () => {
			assert.deepStrictEqual([...RENDER_REJECTION_REASONS], ['invalid-format', 'invalid-response']);
		});

		test('CLI modes are the closed headless/interactive list', () => {
			assert.deepStrictEqual([...CLI_MODES], ['headless', 'interactive']);
		});

		test('EXIT_CODE_BY_OUTCOME covers exactly the four outcomes with in-vocabulary values', () => {
			assert.deepStrictEqual(
				Object.keys(EXIT_CODE_BY_OUTCOME).sort(),
				[...CLI_OUTCOMES].sort(),
			);
			for (const code of Object.values(EXIT_CODE_BY_OUTCOME)) {
				assert.ok((EXIT_CODES as readonly number[]).includes(code));
			}
		});

		test('the headless refusal code sibling copy equals the wire refusal-table member', () => {
			assert.ok((CLI_REFUSAL_CODES as readonly string[]).includes(HEADLESS_INTERACTIVE_REFUSAL_CODE));
		});
	});

	suite('exitCodeFor total mapping', () => {
		test('every CliResponse outcome maps to exactly one exit code (iterating the frozen outcome set)', () => {
			for (const outcome of CLI_OUTCOMES) {
				const response = responseOf(outcome);
				assert.equal(
					exitCodeFor(response),
					EXIT_CODE_BY_OUTCOME_EXPECTED[outcome],
					`outcome '${outcome}' must map to its frozen code`,
				);
			}
		});

		test('the four outcome codes are pairwise distinct', () => {
			const codes = Object.values(EXIT_CODE_BY_OUTCOME);
			assert.equal(new Set(codes).size, codes.length);
		});

		test('usage-error is the parse-layer code: never the image of an outcome', () => {
			const image = Object.values(EXIT_CODE_BY_OUTCOME);
			assert.ok(!image.includes(EXIT_USAGE_ERROR));
			assert.ok((EXIT_CODES as readonly number[]).includes(EXIT_USAGE_ERROR));
		});

		test('fails closed: a corrupt outcome channel maps to usage-error', () => {
			const ok = responseOf('ok');
			const junk = { ...ok, outcome: 'teleport' } as unknown as CliResponse;
			assert.equal(exitCodeFor(junk), EXIT_USAGE_ERROR);
			assert.equal(exitCodeFor({} as unknown as CliResponse), EXIT_USAGE_ERROR);
		});

		test('never mutates the response', () => {
			const response = responseOf('typed-refusal');
			const snapshot = JSON.parse(JSON.stringify(response)) as CliResponse;
			exitCodeFor(response);
			assert.deepStrictEqual(response, snapshot);
		});

		test('is deterministic: identical responses yield identical codes', () => {
			for (const outcome of CLI_OUTCOMES) {
				assert.equal(exitCodeFor(responseOf(outcome)), exitCodeFor(responseOf(outcome)));
			}
		});
	});

	suite('renderSpec shape contract', () => {
		test('json ok: the full canonical record - six base fields plus resultDigest', () => {
			assert.deepStrictEqual(specFields('json', responseOf('ok')), [
				'scope',
				'contractVersion',
				'requestId',
				'commandPath',
				'outcome',
				'durationMs',
				'resultDigest',
			]);
		});

		test('json typed-refusal: six base fields plus refusalCode and violatedLaw', () => {
			assert.deepStrictEqual(specFields('json', responseOf('typed-refusal')), [
				'scope',
				'contractVersion',
				'requestId',
				'commandPath',
				'outcome',
				'durationMs',
				'refusalCode',
				'violatedLaw',
			]);
		});

		test('json not-found: exactly the six base fields', () => {
			assert.deepStrictEqual(specFields('json', responseOf('not-found')), [
				'scope',
				'contractVersion',
				'requestId',
				'commandPath',
				'outcome',
				'durationMs',
			]);
		});

		test('json partial: six base fields plus resultDigest', () => {
			assert.deepStrictEqual(specFields('json', responseOf('partial')), [
				'scope',
				'contractVersion',
				'requestId',
				'commandPath',
				'outcome',
				'durationMs',
				'resultDigest',
			]);
		});

		test('table: the human scan line across all four outcomes (iteration)', () => {
			const expected: Record<string, readonly string[]> = {
				ok: ['commandPath', 'outcome', 'durationMs', 'resultDigest'],
				'typed-refusal': ['commandPath', 'outcome', 'durationMs', 'refusalCode'],
				'not-found': ['commandPath', 'outcome', 'durationMs'],
				partial: ['commandPath', 'outcome', 'durationMs', 'resultDigest'],
			};
			for (const outcome of CLI_OUTCOMES) {
				assert.deepStrictEqual(
					[...specFields('table', responseOf(outcome))],
					[...expected[outcome]],
					`table spec for outcome '${outcome}'`,
				);
			}
		});

		test('digest: the provenance-minimal line across all four outcomes (iteration)', () => {
			const expected: Record<string, readonly string[]> = {
				ok: ['resultDigest'],
				'typed-refusal': ['refusalCode'],
				'not-found': ['commandPath', 'outcome'],
				partial: ['resultDigest'],
			};
			for (const outcome of CLI_OUTCOMES) {
				assert.deepStrictEqual(
					[...specFields('digest', responseOf(outcome))],
					[...expected[outcome]],
					`digest spec for outcome '${outcome}'`,
				);
			}
		});

		test('invariants across every format x outcome: closed fields, non-empty, digest/refusal presence', () => {
			for (const format of OUTPUT_FORMATS) {
				for (const outcome of CLI_OUTCOMES) {
					const spec = builtSpec(renderSpec(format, responseOf(outcome))).spec;
					assert.equal(spec.format, format);
					assert.equal(spec.outcome, outcome);
					assert.ok(spec.requiredFields.length > 0, `${format}/${outcome} must render something`);
					for (const field of spec.requiredFields) {
						assert.ok(
							(RENDER_FIELDS as readonly string[]).includes(field),
							`${format}/${outcome} names unknown field '${String(field)}'`,
						);
					}
					if (outcome === 'ok' || outcome === 'partial') {
						assert.ok(
							(spec.requiredFields as readonly string[]).includes('resultDigest'),
							`${format}/${outcome} must carry the digest`,
						);
					}
					if (outcome === 'typed-refusal') {
						assert.ok(
							(spec.requiredFields as readonly string[]).includes('refusalCode'),
							`${format}/${outcome} must carry the refusal code`,
						);
					}
				}
			}
		});

		test('fails closed: junk format and junk responses are typed rejections naming the violation', () => {
			const badFormat = renderSpec('yaml' as never, responseOf('ok'));
			assert.equal(badFormat.built, false);
			if (!badFormat.built) {
				assert.equal(badFormat.reason, 'invalid-format');
				assert.ok(badFormat.detail.includes('yaml'));
			}
			const junkKind = renderSpec('json', {} as unknown as CliResponse);
			assert.equal(junkKind.built, false);
			if (!junkKind.built) {
				assert.equal(junkKind.reason, 'invalid-response');
			}
			const ok = responseOf('ok');
			const junkOutcome = renderSpec('json', { ...ok, outcome: 'teleport' } as unknown as CliResponse);
			assert.equal(junkOutcome.built, false);
			if (!junkOutcome.built) {
				assert.equal(junkOutcome.reason, 'invalid-response');
				assert.ok(junkOutcome.detail.includes('teleport'));
			}
		});

		test('never mutates the response', () => {
			const response = responseOf('partial');
			const snapshot = JSON.parse(JSON.stringify(response)) as CliResponse;
			renderSpec('json', response);
			renderSpec('table', response);
			renderSpec('digest', response);
			assert.deepStrictEqual(response, snapshot);
		});

		test('is deterministic: identical inputs yield deep-equal specs', () => {
			const response = responseOf('ok');
			assert.deepStrictEqual(renderSpec('json', response), renderSpec('json', response));
			assert.deepStrictEqual(renderSpec('digest', response), renderSpec('digest', response));
		});
	});

	suite('HeadlessMode and the non-interactive law', () => {
		test('isHeadlessMode accepts the two modes and rejects junk', () => {
			assert.ok(isHeadlessMode('headless'));
			assert.ok(isHeadlessMode('interactive'));
			assert.ok(!isHeadlessMode('teleport'));
			assert.ok(!isHeadlessMode(null));
			assert.ok(!isHeadlessMode(1));
		});

		test('only interactive mode admits interactive surfaces', () => {
			assert.equal(admitsInteractiveSurfaces('headless'), false);
			assert.equal(admitsInteractiveSurfaces('interactive'), true);
		});

		test('interactiveRefusalCodeFor: the frozen code in headless mode, none in interactive mode', () => {
			assert.equal(interactiveRefusalCodeFor('headless'), HEADLESS_INTERACTIVE_REFUSAL_CODE);
			assert.equal(interactiveRefusalCodeFor('headless'), 'headless-interactive-surface');
			assert.equal(interactiveRefusalCodeFor('interactive'), undefined);
		});

		test('the non-interactive law, end to end: an interactive-only surface in headless mode is a disclosed typed refusal', () => {
			const code = interactiveRefusalCodeFor('headless');
			assert.ok(code !== undefined);
			const response = builtResponse(
				responseFor(
					wireRequest('approval.respond'),
					refused('approval', 'approval.respond', code),
					5,
				),
			);
			assert.equal(response.outcome, 'typed-refusal');
			if (response.outcome === 'typed-refusal') {
				assert.equal(response.refusalCode, code);
				assert.ok(response.violatedLaw.includes('non-interactive law'));
				assert.ok(response.violatedLaw.includes('disclosed'));
			}
			assert.equal(exitCodeFor(response), EXIT_TYPED_REFUSAL);
		});
	});
});
