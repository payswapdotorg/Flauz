/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-009 wire contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: request fixtures use REAL frozen-grammar command
 * paths (pinned by a layering test via lookupGrammar); projections are
 * synthetic inputs over the frozen journey vocabulary and carry no
 * authority state.
 */
import { strict as assert } from 'node:assert';
import {
        CLI_JOURNEYS,
        CLI_PARITY_CONTRACTS_VERSION as GRAMMAR_VERSION,
        lookupGrammar,
} from '../../common/grammar.js';
import {
        CLI_OUTCOMES,
        CLI_PARITY_CONTRACTS_VERSION,
        CLI_REFUSAL_CODES,
        CLI_REFUSAL_TABLE,
        PROJECTION_COMPLETENESS,
        SERVICE_JOURNEY_SURFACES,
        SERVICE_PROJECTION_KINDS,
        WIRE_REJECTION_REASONS,
        isCliRequest,
        isCliScope,
        refusalFor,
        responseFor,
} from '../../common/wire.js';
import type {
        AbsentProjection,
        CliRefusalCode,
        CliRequest,
        CliResponse,
        CliResponseOutcome,
        ProjectedProjection,
        RefusedProjection,
        ResponseBuilt,
        ResponseRejected,
        ServiceJourney,
        ServiceProjection,
} from '../../common/wire.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const FIXTURE_PATHS = [
        'workspace.status',
        'lab.runs',
        'background-agent.message',
        'capability-discovery.search',
] as const;

function requestFixture(commandPath: string, args?: Record<string, string>): CliRequest {
        return {
                scope: FIXTURE_SCOPE,
                contractVersion: CLI_PARITY_CONTRACTS_VERSION,
                commandPath,
                args: args ?? {},
                requestId: 'req-fixture',
                issuedAtIso: '2025-01-02T00:00:00Z',
        };
}

function projected(
        journey: ServiceJourney,
        commandPath: string,
        completeness: 'full' | 'partial',
): ProjectedProjection {
        return {
                kind: 'projected',
                journey,
                commandPath,
                projectionDigest: 'projection-digest:fixture',
                completeness,
        };
}

function absent(journey: ServiceJourney, commandPath: string): AbsentProjection {
        return { kind: 'absent', journey, commandPath };
}

function refused(journey: ServiceJourney, commandPath: string, code: CliRefusalCode): RefusedProjection {
        return { kind: 'refused', journey, commandPath, refusalCode: code };
}

function builtResponse(outcome: CliResponseOutcome): CliResponse {
        assert.equal(outcome.built, true, `expected built response, got: ${JSON.stringify(outcome)}`);
        return (outcome as ResponseBuilt).response;
}

function rejectedResponse(outcome: CliResponseOutcome): ResponseRejected {
        assert.equal(outcome.built, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
        return outcome as ResponseRejected;
}

suite('ZC-009 wire contracts', () => {

        suite('constants, closed lists and the parity pin', () => {
                test('contract set version matches the grammar module copy (one versioned set)', () => {
                        assert.equal(CLI_PARITY_CONTRACTS_VERSION, GRAMMAR_VERSION);
                        assert.equal(CLI_PARITY_CONTRACTS_VERSION, '1.0.0');
                });

                test('outcomes are the closed ok/typed-refusal/not-found/partial list', () => {
                        assert.deepStrictEqual([...CLI_OUTCOMES], ['ok', 'typed-refusal', 'not-found', 'partial']);
                });

                test('refusal codes are the closed three-code list', () => {
                        assert.deepStrictEqual([...CLI_REFUSAL_CODES], [
                                'headless-interactive-surface',
                                'parity-projection-missing',
                                'scope-isolation-violated',
                        ]);
                });

                test('the frozen refusal table carries exactly the closed codes, in order', () => {
                        assert.deepStrictEqual(CLI_REFUSAL_TABLE.map((entry) => entry.code), [...CLI_REFUSAL_CODES]);
                });

                test('every refusal entry names its exact violated law', () => {
                        const expectedLawKeywords: Record<string, string> = {
                                'headless-interactive-surface': 'non-interactive law',
                                'parity-projection-missing': 'parity law',
                                'scope-isolation-violated': 'isolation law',
                        };
                        for (const entry of CLI_REFUSAL_TABLE) {
                                assert.ok(entry.violatedLaw.length > 0);
                                assert.ok(
                                        entry.violatedLaw.includes(expectedLawKeywords[entry.code]),
                                        `refusal '${entry.code}' must name its law`,
                                );
                        }
                });

                test('THE PARITY PIN: the service surface list equals the grammar journey list', () => {
                        assert.deepStrictEqual([...SERVICE_JOURNEY_SURFACES], [...CLI_JOURNEYS]);
                        assert.equal(SERVICE_JOURNEY_SURFACES.length, 8);
                });

                test('projection completeness is the closed full/partial list', () => {
                        assert.deepStrictEqual([...PROJECTION_COMPLETENESS], ['full', 'partial']);
                });

                test('service projection kinds are the closed projected/absent/refused list', () => {
                        assert.deepStrictEqual([...SERVICE_PROJECTION_KINDS], ['projected', 'absent', 'refused']);
                });

                test('wire rejection reasons are the closed twelve-reason list', () => {
                        assert.deepStrictEqual([...WIRE_REJECTION_REASONS], [
                                'invalid-scope',
                                'contract-version-mismatch',
                                'invalid-request-id',
                                'invalid-issued-at',
                                'invalid-command-path',
                                'invalid-args',
                                'unknown-journey',
                                'invalid-projection',
                                'unknown-refusal-code',
                                'projection-journey-mismatch',
                                'projection-path-mismatch',
                                'invalid-duration',
                        ]);
                });

                test('the request shape admits no prompt flag: exactly the six contract fields', () => {
                        const keys = Object.keys(requestFixture('workspace.status')).sort();
                        assert.deepStrictEqual(keys, [
                                'args',
                                'commandPath',
                                'contractVersion',
                                'issuedAtIso',
                                'requestId',
                                'scope',
                        ]);
                });
        });

        suite('pure shape guards', () => {
                test('isCliScope accepts a scope with non-empty ids and rejects junk', () => {
                        assert.ok(isCliScope(FIXTURE_SCOPE));
                        assert.ok(!isCliScope({ workspaceId: '', tenantId: 'tenant-fixture' }));
                        assert.ok(!isCliScope({ workspaceId: 'ws-fixture' }));
                        assert.ok(!isCliScope(null));
                        assert.ok(!isCliScope('ws-fixture'));
                });

                test('isCliRequest accepts a well-formed fixture request', () => {
                        assert.ok(isCliRequest(requestFixture('workspace.status', { workspaceId: 'ws-1' })));
                });

                test('isCliRequest rejects each malformed record field', () => {
                        const base = requestFixture('workspace.status');
                        const bad: unknown[] = [
                                { ...base, scope: { workspaceId: '', tenantId: 'tenant-fixture' } },
                                { ...base, contractVersion: '0.9.0' },
                                { ...base, requestId: '' },
                                { ...base, issuedAtIso: '' },
                                { ...base, commandPath: '' },
                                null,
                                'req-fixture',
                        ];
                        for (const candidate of bad) {
                                assert.ok(!isCliRequest(candidate));
                        }
                });

                test('isCliRequest rejects non-object args and non-string arg values', () => {
                        const base = requestFixture('workspace.status');
                        assert.ok(!isCliRequest({ ...base, args: ['not', 'a', 'map'] }));
                        assert.ok(!isCliRequest({ ...base, args: { workspaceId: 7 } }));
                        assert.ok(!isCliRequest({ ...base, args: null }));
                });

                test('isCliRequest accepts multi-arg maps with empty-string values (values are strings)', () => {
                        const request = requestFixture('background-agent.message', { agentId: 'agent-1', message: '' });
                        assert.ok(isCliRequest(request));
                });
        });

        suite('responseFor happy paths', () => {
                test('builds the full ok response: scope, version, ids echoed, digest carried, duration echoed', () => {
                        const built = builtResponse(
                                responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 12),
                        );
                        assert.deepStrictEqual(built, {
                                scope: FIXTURE_SCOPE,
                                contractVersion: CLI_PARITY_CONTRACTS_VERSION,
                                requestId: 'req-fixture',
                                commandPath: 'workspace.status',
                                durationMs: 12,
                                outcome: 'ok',
                                resultDigest: 'projection-digest:fixture',
                        });
                });

                test('a partial projection yields the partial outcome with its digest', () => {
                        const built = builtResponse(
                                responseFor(requestFixture('lab.runs', { limit: '10' }), projected('lab', 'lab.runs', 'partial'), 40),
                        );
                        assert.equal(built.outcome, 'partial');
                        if (built.outcome === 'partial') {
                                assert.equal(built.resultDigest, 'projection-digest:fixture');
                        }
                });

                test('an absent projection yields not-found with no digest channel', () => {
                        const built = builtResponse(
                                responseFor(requestFixture('workspace.focus', { workspaceId: 'ws-x' }), absent('workspace', 'workspace.focus'), 5),
                        );
                        assert.equal(built.outcome, 'not-found');
                        assert.ok(!('resultDigest' in built));
                });

                test('a refused projection yields the typed refusal with the code and the verbatim law', () => {
                        const built = builtResponse(
                                responseFor(
                                        requestFixture('approval.respond', { approvalId: 'ap-1', decision: 'approve' }),
                                        refused('approval', 'approval.respond', 'headless-interactive-surface'),
                                        7,
                                ),
                        );
                        assert.equal(built.outcome, 'typed-refusal');
                        if (built.outcome === 'typed-refusal') {
                                assert.equal(built.refusalCode, 'headless-interactive-surface');
                                assert.equal(built.violatedLaw, refusalFor('headless-interactive-surface')?.violatedLaw);
                        }
                });

                test('outcome channels are closed: ok carries no refusal fields, refusal carries no digest', () => {
                        const ok = builtResponse(
                                responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 1),
                        );
                        assert.ok(!('refusalCode' in ok));
                        assert.ok(!('violatedLaw' in ok));
                        const refusal = builtResponse(
                                responseFor(
                                        requestFixture('workspace.status'),
                                        refused('workspace', 'workspace.status', 'parity-projection-missing'),
                                        1,
                                ),
                        );
                        assert.ok(!('resultDigest' in refusal));
                });

                test('durationMs is echoed verbatim, never derived', () => {
                        const first = builtResponse(
                                responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 3),
                        );
                        const second = builtResponse(
                                responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 999),
                        );
                        assert.equal(first.durationMs, 3);
                        assert.equal(second.durationMs, 999);
                        assert.notEqual(first.durationMs, second.durationMs);
                });

                test('layering pin: every fixture request path resolves in the frozen grammar', () => {
                        for (const path of FIXTURE_PATHS) {
                                assert.ok(lookupGrammar(path) !== undefined, `fixture path '${path}' must be a real grammar path`);
                        }
                });
        });

        suite('responseFor fails closed', () => {
                test('rejects an invalid scope', () => {
                        const request = {
                                ...requestFixture('workspace.status'),
                                scope: { workspaceId: '', tenantId: 'tenant-fixture' },
                        } as CliRequest;
                        assert.equal(
                                rejectedResponse(responseFor(request, projected('workspace', 'workspace.status', 'full'), 1)).reason,
                                'invalid-scope',
                        );
                });

                test('rejects a contract-version mismatch', () => {
                        const request = { ...requestFixture('workspace.status'), contractVersion: '0.9.0' } as CliRequest;
                        assert.equal(
                                rejectedResponse(responseFor(request, projected('workspace', 'workspace.status', 'full'), 1)).reason,
                                'contract-version-mismatch',
                        );
                });

                test('rejects an empty requestId or issuedAtIso', () => {
                        const emptyId = { ...requestFixture('workspace.status'), requestId: '' } as CliRequest;
                        const emptyAt = { ...requestFixture('workspace.status'), issuedAtIso: '' } as CliRequest;
                        assert.equal(
                                rejectedResponse(responseFor(emptyId, projected('workspace', 'workspace.status', 'full'), 1)).reason,
                                'invalid-request-id',
                        );
                        assert.equal(
                                rejectedResponse(responseFor(emptyAt, projected('workspace', 'workspace.status', 'full'), 1)).reason,
                                'invalid-issued-at',
                        );
                });

                test('rejects an empty commandPath or non-string args values', () => {
                        const emptyPath = { ...requestFixture(''), commandPath: '' } as unknown as CliRequest;
                        const badArgs = { ...requestFixture('workspace.status'), args: { workspaceId: 7 } } as unknown as CliRequest;
                        assert.equal(
                                rejectedResponse(responseFor(emptyPath, projected('workspace', '', 'full'), 1)).reason,
                                'invalid-command-path',
                        );
                        assert.equal(
                                rejectedResponse(responseFor(badArgs, projected('workspace', 'workspace.status', 'full'), 1)).reason,
                                'invalid-args',
                        );
                });

                test('rejects a CLI-only journey as unrepresentable, naming it', () => {
                        const request = requestFixture('teleport.status');
                        const rejected = rejectedResponse(
                                responseFor(request, projected('workspace', 'teleport.status', 'full'), 1),
                        );
                        assert.equal(rejected.reason, 'unknown-journey');
                        assert.ok(rejected.detail.includes('teleport'));
                        assert.ok(rejected.detail.includes('unrepresentable'));
                });

                test('rejects a projection whose journey disagrees with the request', () => {
                        const rejected = rejectedResponse(
                                responseFor(requestFixture('workspace.status'), projected('lab', 'workspace.status', 'full'), 1),
                        );
                        assert.equal(rejected.reason, 'projection-journey-mismatch');
                        assert.ok(rejected.detail.includes('workspace'));
                        assert.ok(rejected.detail.includes('lab'));
                });

                test('rejects a projection whose command path disagrees with the request', () => {
                        const rejected = rejectedResponse(
                                responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.list', 'full'), 1),
                        );
                        assert.equal(rejected.reason, 'projection-path-mismatch');
                });

                test('rejects a refusal code outside the frozen table', () => {
                        const badCode = 'teleport-refused' as unknown as CliRefusalCode;
                        const rejected = rejectedResponse(
                                responseFor(requestFixture('workspace.status'), refused('workspace', 'workspace.status', badCode), 1),
                        );
                        assert.equal(rejected.reason, 'unknown-refusal-code');
                        assert.ok(rejected.detail.includes('teleport-refused'));
                });

                test('rejects a negative, non-finite or non-number duration', () => {
                        for (const badDuration of [-1, Number.NaN, 'fast' as unknown as number]) {
                                const rejected = rejectedResponse(
                                        responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), badDuration),
                                );
                                assert.equal(rejected.reason, 'invalid-duration');
                        }
                });

                test('rejects malformed projections: junk kind, junk journey, empty digest, bad completeness, empty path', () => {
                        const junkKind = { kind: 'teleport' } as unknown as ProjectedProjection;
                        assert.equal(
                                rejectedResponse(responseFor(requestFixture('workspace.status'), junkKind, 1)).reason,
                                'invalid-projection',
                        );
                        const junkJourney = projected('teleport' as unknown as ServiceJourney, 'workspace.status', 'full');
                        assert.equal(
                                rejectedResponse(responseFor(requestFixture('workspace.status'), junkJourney, 1)).reason,
                                'invalid-projection',
                        );
                        const emptyDigest = { ...projected('workspace', 'workspace.status', 'full'), projectionDigest: '' };
                        assert.equal(
                                rejectedResponse(responseFor(requestFixture('workspace.status'), emptyDigest, 1)).reason,
                                'invalid-projection',
                        );
                        const badCompleteness = { ...projected('workspace', 'workspace.status', 'full'), completeness: 'half' } as unknown as ServiceProjection;
                        assert.equal(
                                rejectedResponse(responseFor(requestFixture('workspace.status'), badCompleteness, 1)).reason,
                                'invalid-projection',
                        );
                        const emptyPath = absent('workspace', '');
                        assert.equal(
                                rejectedResponse(responseFor(requestFixture('workspace.status'), emptyPath, 1)).reason,
                                'invalid-projection',
                        );
                });
        });

        suite('purity and provenance of the law text', () => {
                test('never mutates the request or the projection', () => {
                        const request = requestFixture('background-agent.message', { agentId: 'agent-1', message: 'hello' });
                        const projection = projected('background-agent', 'background-agent.message', 'full');
                        const requestSnapshot = JSON.parse(JSON.stringify(request)) as CliRequest;
                        const projectionSnapshot = JSON.parse(JSON.stringify(projection)) as ProjectedProjection;
                        responseFor(request, projection, 9);
                        assert.deepStrictEqual(request, requestSnapshot);
                        assert.deepStrictEqual(projection, projectionSnapshot);
                });

                test('is deterministic: identical inputs yield deep-equal responses', () => {
                        const first = responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 8);
                        const second = responseFor(requestFixture('workspace.status'), projected('workspace', 'workspace.status', 'full'), 8);
                        assert.deepStrictEqual(first, second);
                });

                test('the violated law is always the frozen table text, never caller-supplied', () => {
                        const projection = refused('workspace', 'workspace.status', 'scope-isolation-violated');
                        assert.ok(!('violatedLaw' in projection));
                        const built = builtResponse(responseFor(requestFixture('workspace.status'), projection, 2));
                        assert.equal(built.outcome, 'typed-refusal');
                        if (built.outcome === 'typed-refusal') {
                                assert.equal(built.violatedLaw, refusalFor('scope-isolation-violated')?.violatedLaw);
                                assert.ok(built.violatedLaw.includes('isolation law'));
                        }
                });
        });
});
