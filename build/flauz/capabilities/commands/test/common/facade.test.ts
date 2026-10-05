/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * ZC-008 facade contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: the tool vocabulary and mirrorable-surface table
 * below are SYNTHETIC (every name prefixed 'fixture.') and are NOT
 * authority values. Authority values are pinned separately, after
 * repo-side seam transcription, by the SEAM-PIN suite at the bottom of
 * this file. The agreement suite pins the facade's duplicated
 * admission logic against compound.ts's canAdmitCompound; the
 * sibling-copy suite pins the zero-import re-declarations deep-equal
 * across modules.
 */
import { strict as assert } from 'node:assert';
import {
        canAdmitCompound,
        COMMAND_FACADE_CONTRACTS_VERSION as COMPOUND_VERSION,
        FROZEN_TOOL_VOCABULARY as COMPOUND_VOCABULARY,
        MAX_COMPOUND_STEPS as COMPOUND_MAX_STEPS,
} from '../../common/compound.js';
import type {
        CompoundCommand as LabCompoundCommand,
        CompoundRejected as LabCompoundRejected,
        CompoundStep as LabCompoundStep,
} from '../../common/compound.js';
import {
        COMMAND_FACADE_CONTRACTS_VERSION as MIRROR_VERSION,
        FROZEN_MIRRORABLE_SURFACES as MIRROR_SURFACES,
} from '../../common/mirror.js';
import {
        COMMAND_FACADE_CONTRACTS_VERSION,
        FACADE_RECEIPT_REJECTION_REASONS,
        FACADE_REQUEST_KINDS,
        FACADE_ROUTING_REJECTION_REASONS,
        FROZEN_MIRRORABLE_SURFACES,
        FROZEN_TOOL_VOCABULARY,
        MAX_COMPOUND_STEPS,
        buildFacadeReceipt,
        deriveFacadeReceiptsDigest,
        routeFor,
} from '../../common/facade.js';
import type {
        CommandFacadeRequest,
        CompoundCommand,
        CompoundFacadeRequest,
        CompoundRouting,
        CompoundStep,
        DirectToolFacadeRequest,
        DirectToolRouting,
        FacadeReceipt,
        FacadeReceiptOutcome,
        FacadeRouting,
        FreshnessPolicy,
        LocalMirror,
        MirrorableSurfaceEntry,
        MirrorRedirectRouting,
        MirrorServeRouting,
        MirroredReadFacadeRequest,
        MirroredReadRouting,
        ReceiptBuilt,
        ReceiptRejected,
        RoutingContext,
        RoutingOutcome,
        RoutingRejected,
        Routed,
        SideEffectDisclosure,
        ToolRef,
        ToolVocabularyEntry,
} from '../../common/facade.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const FIXTURE_VOCABULARY: readonly ToolVocabularyEntry[] = [
        { toolName: 'fixture.fs.readFile', confirmationGated: false },
        { toolName: 'fixture.fs.writeFile', confirmationGated: false },
        { toolName: 'fixture.shell.exec', confirmationGated: true },
];

const FIXTURE_SURFACE_TABLE: readonly MirrorableSurfaceEntry[] = [
        { surfaceKind: 'fixture.execution.task-state-read' },
        { surfaceKind: 'fixture.execution.task-log-read' },
];

const FIXTURE_POLICY: FreshnessPolicy = { maxAgeMs: 60_000, staleMaxAgeMs: 300_000 };

const READ_DISCLOSURE_A: SideEffectDisclosure = {
        surfaceRef: { surfaceKind: 'fixture.execution.task-log-read', resourceId: 'res-log' },
        kind: 'read',
        provenanceDigest: 'prov-digest:s-read',
        visibility: 'visible',
};

const WRITE_DISCLOSURE_B: SideEffectDisclosure = {
        surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-state' },
        kind: 'write',
        provenanceDigest: 'prov-digest:s-exec',
        visibility: 'visible',
};

const HIDDEN_DISCLOSURE = {
        surfaceRef: { surfaceKind: 'fixture.execution.task-log-read', resourceId: 'res-log' },
        kind: 'read',
        provenanceDigest: 'prov-digest:hidden',
        visibility: 'hidden',
} as unknown as SideEffectDisclosure;

function fixtureSteps(): CompoundStep[] {
        return [
                {
                        stepId: 's-read',
                        toolRef: { toolName: 'fixture.fs.readFile' },
                        argsDigest: 'args-digest:s-read',
                        expectedSideEffects: [READ_DISCLOSURE_A],
                        approvalRequirement: 'none',
                },
                {
                        stepId: 's-exec',
                        toolRef: { toolName: 'fixture.shell.exec' },
                        argsDigest: 'args-digest:s-exec',
                        expectedSideEffects: [WRITE_DISCLOSURE_B],
                        approvalRequirement: 'confirmation',
                },
        ];
}

function fixtureCompound(): CompoundCommand {
        return {
                scope: FIXTURE_SCOPE,
                contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                commandId: 'cmd-fixture',
                nameDigest: 'name-digest:cmd-fixture',
                steps: fixtureSteps(),
        };
}

function fixtureMirror(): LocalMirror {
        return {
                scope: FIXTURE_SCOPE,
                contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                mirrorId: 'mirror-fixture',
                surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-fixture' },
                contentDigest: 'content-digest:fixture',
                byteSize: 2048,
                mirroredAtIso: '2025-01-01T00:00:00Z',
                freshnessPolicy: FIXTURE_POLICY,
        };
}

function compoundRequest(commandId: string): CompoundFacadeRequest {
        return {
                kind: 'compound',
                scope: FIXTURE_SCOPE,
                contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                facadeId: 'fac-fixture',
                commandRef: { commandId },
                requestedAtIso: '2025-01-02T00:00:00Z',
        };
}

function mirrorRequest(mirrorId: string): MirroredReadFacadeRequest {
        return {
                kind: 'mirrored-read',
                scope: FIXTURE_SCOPE,
                contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                facadeId: 'fac-fixture',
                mirrorRef: { mirrorId },
                requestedAtIso: '2025-01-02T00:00:00Z',
        };
}

function directToolRequest(toolName: string): DirectToolFacadeRequest {
        return {
                kind: 'direct-tool',
                scope: FIXTURE_SCOPE,
                contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
                facadeId: 'fac-fixture',
                toolRef: { toolName },
                argsDigest: 'args-digest:direct',
                expectedSideEffects: [READ_DISCLOSURE_A],
                requestedAtIso: '2025-01-02T00:00:00Z',
        };
}

function contextWith(overrides?: Partial<RoutingContext>): RoutingContext {
        return {
                toolVocabulary: FIXTURE_VOCABULARY,
                mirrorableSurfaces: FIXTURE_SURFACE_TABLE,
                ...overrides,
        };
}

function routedOutcome(outcome: RoutingOutcome): FacadeRouting {
        assert.equal(outcome.routed, true, `expected routing, got: ${JSON.stringify(outcome)}`);
        return (outcome as Routed).routing;
}

function rejectedOutcome(outcome: RoutingOutcome): RoutingRejected {
        assert.equal(outcome.routed, false, `expected rejection, got: ${JSON.stringify(outcome)}`);
        return outcome as RoutingRejected;
}

function asCompoundRouting(routing: FacadeRouting): CompoundRouting {
        assert.equal(routing.kind, 'compound', `expected compound routing, got: ${JSON.stringify(routing)}`);
        return routing as CompoundRouting;
}

function asMirrorServe(routing: FacadeRouting): MirrorServeRouting {
        assert.equal(routing.kind, 'mirrored-read', `expected mirrored-read routing, got: ${JSON.stringify(routing)}`);
        const mirroredRead = routing as MirroredReadRouting;
        assert.equal(mirroredRead.routeTarget, 'mirror', 'expected a mirror-served routing');
        return mirroredRead as MirrorServeRouting;
}

function asMirrorRedirect(routing: FacadeRouting): MirrorRedirectRouting {
        assert.equal(routing.kind, 'mirrored-read', `expected mirrored-read routing, got: ${JSON.stringify(routing)}`);
        const mirroredRead = routing as MirroredReadRouting;
        assert.equal(mirroredRead.routeTarget, 'direct-read', 'expected a redirected routing');
        return mirroredRead as MirrorRedirectRouting;
}

function asDirectToolRouting(routing: FacadeRouting): DirectToolRouting {
        assert.equal(routing.kind, 'direct-tool', `expected direct-tool routing, got: ${JSON.stringify(routing)}`);
        return routing as DirectToolRouting;
}

function builtReceipt(outcome: FacadeReceiptOutcome): FacadeReceipt {
        assert.equal(outcome.built, true, `expected built receipt, got: ${JSON.stringify(outcome)}`);
        return (outcome as ReceiptBuilt).receipt;
}

function rejectedReceipt(outcome: FacadeReceiptOutcome): ReceiptRejected {
        assert.equal(outcome.built, false, `expected rejected receipt, got: ${JSON.stringify(outcome)}`);
        return outcome as ReceiptRejected;
}

suite('ZC-008 facade contracts', () => {

        suite('constants and sibling-copy pins', () => {
                test('the facade version matches the compound and mirror module copies (one versioned set)', () => {
                        assert.equal(COMMAND_FACADE_CONTRACTS_VERSION, COMPOUND_VERSION);
                        assert.equal(COMMAND_FACADE_CONTRACTS_VERSION, MIRROR_VERSION);
                        assert.equal(COMMAND_FACADE_CONTRACTS_VERSION, '1.0.0');
                });

                test('request kinds are the closed compound/mirrored-read/direct-tool list', () => {
                        assert.deepStrictEqual([...FACADE_REQUEST_KINDS], ['compound', 'mirrored-read', 'direct-tool']);
                });

                test('the facade bound copy equals the compound module bound (MAX_COMPOUND_STEPS)', () => {
                        assert.equal(MAX_COMPOUND_STEPS, COMPOUND_MAX_STEPS);
                        assert.ok(Number.isInteger(MAX_COMPOUND_STEPS) && MAX_COMPOUND_STEPS > 0);
                });

                test('the facade tool-vocabulary seam copy is deep-equal to the compound module copy', () => {
                        assert.deepStrictEqual(FROZEN_TOOL_VOCABULARY, COMPOUND_VOCABULARY);
                });

                test('the facade mirrorable-surface seam copy is deep-equal to the mirror module copy', () => {
                        assert.deepStrictEqual(FROZEN_MIRRORABLE_SURFACES, MIRROR_SURFACES);
                });

                test('routing rejection reasons are the closed thirteen-reason list', () => {
                        assert.deepStrictEqual([...FACADE_ROUTING_REJECTION_REASONS], [
                                'invalid-scope',
                                'contract-version-mismatch',
                                'invalid-facade-id',
                                'invalid-requested-at',
                                'invalid-request',
                                'unknown-request-kind',
                                'unknown-compound',
                                'compound-admission-failed',
                                'scope-mismatch',
                                'unknown-mirror',
                                'mirror-admission-failed',
                                'missing-clock-delta',
                                'unknown-tool',
                        ]);
                });

                test('receipt rejection reasons are the closed four-reason list', () => {
                        assert.deepStrictEqual([...FACADE_RECEIPT_REJECTION_REASONS], [
                                'invalid-scope',
                                'invalid-facade-id',
                                'invalid-routing',
                                'invalid-completed-at',
                        ]);
                });
        });

        suite('routeFor base validation', () => {
                test('rejects an invalid scope', () => {
                        const request = {
                                ...compoundRequest('cmd-fixture'),
                                scope: { workspaceId: '', tenantId: 'tenant-fixture' },
                        } as CommandFacadeRequest;
                        const rejected = rejectedOutcome(routeFor(request, [fixtureCompound()], [], contextWith()));
                        assert.equal(rejected.reason, 'invalid-scope');
                });

                test('rejects a contract-version mismatch', () => {
                        const request = {
                                ...compoundRequest('cmd-fixture'),
                                contractVersion: '0.9.0',
                        } as CommandFacadeRequest;
                        const rejected = rejectedOutcome(routeFor(request, [fixtureCompound()], [], contextWith()));
                        assert.equal(rejected.reason, 'contract-version-mismatch');
                });

                test('rejects an empty facadeId or requestedAtIso', () => {
                        const emptyFacadeId = {
                                ...compoundRequest('cmd-fixture'),
                                facadeId: '',
                        } as CommandFacadeRequest;
                        const emptyRequestedAt = {
                                ...compoundRequest('cmd-fixture'),
                                requestedAtIso: '',
                        } as CommandFacadeRequest;
                        assert.equal(rejectedOutcome(routeFor(emptyFacadeId, [fixtureCompound()], [], contextWith())).reason, 'invalid-facade-id');
                        assert.equal(rejectedOutcome(routeFor(emptyRequestedAt, [fixtureCompound()], [], contextWith())).reason, 'invalid-requested-at');
                });

                test('rejects an unknown request kind (runtime junk fails closed)', () => {
                        const junk = { kind: 'teleport' } as unknown as CommandFacadeRequest;
                        const rejected = rejectedOutcome(routeFor(junk, [], [], contextWith()));
                        assert.equal(rejected.reason, 'unknown-request-kind');
                        assert.ok(rejected.detail.includes('teleport'));
                });

                test('rejects a missing compound or mirror reference as invalid-request', () => {
                        const badCommandRef = {
                                ...compoundRequest(''),
                        } as CommandFacadeRequest;
                        const badMirrorRef = {
                                ...mirrorRequest(''),
                        } as CommandFacadeRequest;
                        assert.equal(
                                rejectedOutcome(routeFor(badCommandRef, [fixtureCompound()], [], contextWith())).reason,
                                'invalid-request',
                        );
                        assert.equal(
                                rejectedOutcome(routeFor(badMirrorRef, [], [fixtureMirror()], contextWith())).reason,
                                'invalid-request',
                        );
                });
        });

        suite('routeFor compound routing', () => {
                test('routes a two-step compound step-by-step through the Tool and Approval authorities', () => {
                        const routing = asCompoundRouting(
                                routedOutcome(routeFor(compoundRequest('cmd-fixture'), [fixtureCompound()], [], contextWith())),
                        );
                        assert.equal(routing.commandId, 'cmd-fixture');
                        assert.equal(routing.nameDigest, 'name-digest:cmd-fixture');
                        assert.equal(routing.stepRoutings.length, 2);
                        assert.deepStrictEqual(routing.stepRoutings[0], {
                                stepId: 's-read',
                                toolName: 'fixture.fs.readFile',
                                routesThroughApprovalAuthority: false,
                                expectedSideEffects: [READ_DISCLOSURE_A],
                        });
                        assert.deepStrictEqual(routing.stepRoutings[1], {
                                stepId: 's-exec',
                                toolName: 'fixture.shell.exec',
                                routesThroughApprovalAuthority: true,
                                expectedSideEffects: [WRITE_DISCLOSURE_B],
                        });
                });

                test('carries the union of every step disclosure, in step order', () => {
                        const routing = asCompoundRouting(
                                routedOutcome(routeFor(compoundRequest('cmd-fixture'), [fixtureCompound()], [], contextWith())),
                        );
                        assert.deepStrictEqual(routing.sideEffects, [READ_DISCLOSURE_A, WRITE_DISCLOSURE_B]);
                });

                test('rejects an unknown compound, naming the commandId', () => {
                        const rejected = rejectedOutcome(routeFor(compoundRequest('cmd-missing'), [fixtureCompound()], [], contextWith()));
                        assert.equal(rejected.reason, 'unknown-compound');
                        assert.ok(rejected.detail.includes('cmd-missing'));
                });

                test('rejects a compound registered under a different scope (isolation boundary)', () => {
                        const foreignCompound: CompoundCommand = {
                                ...fixtureCompound(),
                                scope: { workspaceId: 'ws-other', tenantId: 'tenant-fixture' },
                        };
                        const rejected = rejectedOutcome(
                                routeFor(compoundRequest('cmd-fixture'), [foreignCompound], [], contextWith()),
                        );
                        assert.equal(rejected.reason, 'scope-mismatch');
                        assert.ok(rejected.detail.includes('isolation boundary'));
                });

                test('re-checks admission: exceeding the bound fails with the bound named', () => {
                        const steps: CompoundStep[] = [];
                        for (let index = 0; index <= MAX_COMPOUND_STEPS; index += 1) {
                                steps.push({
                                        stepId: `s-${index}`,
                                        toolRef: { toolName: 'fixture.fs.readFile' },
                                        argsDigest: `args-digest:s-${index}`,
                                        expectedSideEffects: [READ_DISCLOSURE_A],
                                        approvalRequirement: 'none',
                                });
                        }
                        const overflowing: CompoundCommand = { ...fixtureCompound(), steps };
                        const rejected = rejectedOutcome(
                                routeFor(compoundRequest('cmd-fixture'), [overflowing], [], contextWith()),
                        );
                        assert.equal(rejected.reason, 'compound-admission-failed');
                        assert.ok(rejected.detail.includes('too-many-steps'));
                        assert.ok(rejected.detail.includes('MAX_COMPOUND_STEPS'));
                });

                test('re-checks admission: a gated tool declared none fails, naming the escape', () => {
                        const escaping: CompoundCommand = {
                                ...fixtureCompound(),
                                steps: [
                                        {
                                                stepId: 's-exec',
                                                toolRef: { toolName: 'fixture.shell.exec' },
                                                argsDigest: 'args-digest:s-exec',
                                                expectedSideEffects: [WRITE_DISCLOSURE_B],
                                                approvalRequirement: 'none',
                                        },
                                ],
                        };
                        const rejected = rejectedOutcome(routeFor(compoundRequest('cmd-fixture'), [escaping], [], contextWith()));
                        assert.equal(rejected.reason, 'compound-admission-failed');
                        assert.ok(rejected.detail.includes('approval-requirement-mismatch'));
                        assert.ok(rejected.detail.includes('never silently escape approval'));
                });

                test('re-checks admission: an unresolvable tool fails with unknown-tool', () => {
                        const unresolvable: CompoundCommand = {
                                ...fixtureCompound(),
                                steps: [
                                        {
                                                stepId: 's-x',
                                                toolRef: { toolName: 'fixture.fs.chmod' },
                                                argsDigest: 'args-digest:s-x',
                                                expectedSideEffects: [READ_DISCLOSURE_A],
                                                approvalRequirement: 'none',
                                        },
                                ],
                        };
                        const rejected = rejectedOutcome(
                                routeFor(compoundRequest('cmd-fixture'), [unresolvable], [], contextWith()),
                        );
                        assert.equal(rejected.reason, 'compound-admission-failed');
                        assert.ok(rejected.detail.includes('unknown-tool'));
                });

                test('agrees with canAdmitCompound on every fixture variant (duplicated-logic pin)', () => {
                        // Built with compound.ts's OWN types: passing them into
                        // routeFor (facade types) compiles only because the
                        // re-declared shapes are structurally identical - the
                        // zero-import law's compile-time pin.
                        const valid: LabCompoundCommand = {
                                scope: FIXTURE_SCOPE,
                                contractVersion: COMPOUND_VERSION,
                                commandId: 'cmd-agree',
                                nameDigest: 'name-digest:cmd-agree',
                                steps: fixtureSteps() as LabCompoundStep[],
                        };
                        const overflowSteps: LabCompoundStep[] = [];
                        for (let index = 0; index <= COMPOUND_MAX_STEPS; index += 1) {
                                overflowSteps.push({
                                        stepId: `s-${index}`,
                                        toolRef: { toolName: 'fixture.fs.readFile' },
                                        argsDigest: `args-digest:s-${index}`,
                                        expectedSideEffects: [READ_DISCLOSURE_A],
                                        approvalRequirement: 'none',
                                });
                        }
                        const overflow: LabCompoundCommand = { ...valid, steps: overflowSteps };
                        const duplicated: LabCompoundCommand = {
                                ...valid,
                                steps: [...valid.steps, valid.steps[0]],
                        };
                        const unknownTool: LabCompoundCommand = {
                                ...valid,
                                steps: [
                                        {
                                                stepId: 's-x',
                                                toolRef: { toolName: 'fixture.fs.chmod' },
                                                argsDigest: 'args-digest:s-x',
                                                expectedSideEffects: [READ_DISCLOSURE_A],
                                                approvalRequirement: 'none',
                                        },
                                ],
                        };
                        const approvalEscape: LabCompoundCommand = {
                                ...valid,
                                steps: [
                                        {
                                                stepId: 's-exec',
                                                toolRef: { toolName: 'fixture.shell.exec' },
                                                argsDigest: 'args-digest:s-exec',
                                                expectedSideEffects: [WRITE_DISCLOSURE_B],
                                                approvalRequirement: 'none',
                                        },
                                ],
                        };
                        const variants: readonly LabCompoundCommand[] = [
                                valid,
                                overflow,
                                duplicated,
                                unknownTool,
                                approvalEscape,
                        ];
                        for (const command of variants) {
                                const admission = canAdmitCompound(command, FIXTURE_VOCABULARY);
                                const outcome = routeFor(
                                        compoundRequest(command.commandId),
                                        [command],
                                        [],
                                        contextWith(),
                                );
                                assert.equal(outcome.routed, admission.admitted, `variant '${command.commandId}' must agree`);
                                if (!admission.admitted) {
                                        const rejected = rejectedOutcome(outcome);
                                        assert.equal(rejected.reason, 'compound-admission-failed');
                                        const labRejection = admission as LabCompoundRejected;
                                        assert.ok(
                                                rejected.detail.includes(labRejection.reason),
                                                `routing detail must name the compound-module reason '${labRejection.reason}'`,
                                        );
                                }
                        }
                });
        });

        suite('routeFor mirrored-read routing', () => {
                test('serves a fresh mirror: routeTarget mirror, freshness fresh, no bypass', () => {
                        const routing = asMirrorServe(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 0 }))),
                        );
                        assert.equal(routing.mirrorId, 'mirror-fixture');
                        assert.equal(routing.freshness, 'fresh');
                        assert.ok(!('bypass' in routing), 'a served mirror carries no bypass');
                });

                test('boundary: delta at maxAgeMs is fresh; delta at staleMaxAgeMs is stale', () => {
                        const atFreshBoundary = asMirrorServe(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 60_000 }))),
                        );
                        assert.equal(atFreshBoundary.freshness, 'fresh');
                        const atStaleBoundary = asMirrorRedirect(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 300_000 }))),
                        );
                        assert.equal(atStaleBoundary.freshness, 'stale');
                });

                test('re-routes a stale mirror to a direct read with the bypass disclosure (never silent)', () => {
                        const routing = asMirrorRedirect(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 60_001 }))),
                        );
                        assert.equal(routing.freshness, 'stale');
                        assert.equal(routing.routeTarget, 'direct-read');
                        assert.deepStrictEqual(routing.bypass, {
                                mirrorId: 'mirror-fixture',
                                surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-fixture' },
                                recordedContentDigest: 'content-digest:fixture',
                                freshness: 'stale',
                                redirectedTo: 'direct-read',
                        });
                });

                test('re-routes an expired mirror with the same disclosed shape', () => {
                        const routing = asMirrorRedirect(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 300_001 }))),
                        );
                        assert.equal(routing.freshness, 'expired');
                        assert.equal(routing.routeTarget, 'direct-read');
                        assert.equal(routing.bypass.freshness, 'expired');
                        assert.equal(routing.bypass.recordedContentDigest, 'content-digest:fixture');
                });

                test('attaches the read disclosure: visible read effect provenance-anchored to the mirror content digest', () => {
                        const routing = asMirrorServe(
                                routedOutcome(routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 0 }))),
                        );
                        assert.deepStrictEqual(routing.sideEffects, [
                                {
                                        surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-fixture' },
                                        kind: 'read',
                                        provenanceDigest: 'content-digest:fixture',
                                        visibility: 'visible',
                                },
                        ]);
                });

                test('rejects an unknown mirror or a scope-mismatched mirror', () => {
                        const unknown = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-missing'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 0 })),
                        );
                        assert.equal(unknown.reason, 'unknown-mirror');
                        assert.ok(unknown.detail.includes('mirror-missing'));
                        const foreignMirror: LocalMirror = {
                                ...fixtureMirror(),
                                scope: { workspaceId: 'ws-other', tenantId: 'tenant-fixture' },
                        };
                        const foreign = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [foreignMirror], contextWith({ clockDeltaMs: 0 })),
                        );
                        assert.equal(foreign.reason, 'scope-mismatch');
                });

                test('rejects a write-surface or malformed mirror via the admission re-check', () => {
                        const writeSurfaceMirror: LocalMirror = {
                                ...fixtureMirror(),
                                surfaceRef: { surfaceKind: 'fixture.execution.task-state-write', resourceId: 'res-fixture' },
                        };
                        const writeSurface = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [writeSurfaceMirror], contextWith({ clockDeltaMs: 0 })),
                        );
                        assert.equal(writeSurface.reason, 'mirror-admission-failed');
                        assert.ok(writeSurface.detail.includes('READ-ONLY'));
                        assert.ok(writeSurface.detail.includes('never mirror'));
                        const malformedMirror: LocalMirror = {
                                ...fixtureMirror(),
                                contentDigest: '',
                        };
                        const malformed = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [malformedMirror], contextWith({ clockDeltaMs: 0 })),
                        );
                        assert.equal(malformed.reason, 'mirror-admission-failed');
                        assert.ok(malformed.detail.includes('contentDigest'));
                });

                test('rejects a missing or non-finite clock delta (determinism law)', () => {
                        const missing = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: undefined })),
                        );
                        assert.equal(missing.reason, 'missing-clock-delta');
                        const nonFinite = rejectedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: Number.NaN })),
                        );
                        assert.equal(nonFinite.reason, 'missing-clock-delta');
                });
        });

        suite('routeFor direct-tool routing', () => {
                test('routes a non-gated tool without the Approval authority, exactly as the Tool authority would', () => {
                        const routing = asDirectToolRouting(
                                routedOutcome(routeFor(directToolRequest('fixture.fs.readFile'), [], [], contextWith())),
                        );
                        assert.equal(routing.toolName, 'fixture.fs.readFile');
                        assert.equal(routing.routesThroughApprovalAuthority, false);
                        assert.equal(routing.argsDigest, 'args-digest:direct');
                });

                test('routes a confirmation-gated tool through the Approval authority regardless of the caller', () => {
                        const routing = asDirectToolRouting(
                                routedOutcome(routeFor(directToolRequest('fixture.shell.exec'), [], [], contextWith())),
                        );
                        assert.equal(routing.routesThroughApprovalAuthority, true);
                });

                test('rejects an unresolvable tool: the facade never bypasses the Tool authority', () => {
                        const rejected = rejectedOutcome(routeFor(directToolRequest('fixture.fs.chmod'), [], [], contextWith()));
                        assert.equal(rejected.reason, 'unknown-tool');
                        assert.ok(rejected.detail.includes('never bypasses'));
                });

                test('rejects malformed toolRef, argsDigest or disclosures as invalid-request', () => {
                        const badToolRef = {
                                ...directToolRequest('fixture.fs.readFile'),
                                toolRef: {} as ToolRef,
                        } as CommandFacadeRequest;
                        assert.equal(
                                rejectedOutcome(routeFor(badToolRef, [], [], contextWith())).reason,
                                'invalid-request',
                        );
                        const emptyArgs = {
                                ...directToolRequest('fixture.fs.readFile'),
                                argsDigest: '',
                        } as CommandFacadeRequest;
                        assert.equal(
                                rejectedOutcome(routeFor(emptyArgs, [], [], contextWith())).reason,
                                'invalid-request',
                        );
                        const hiddenEffect = {
                                ...directToolRequest('fixture.fs.readFile'),
                                expectedSideEffects: [HIDDEN_DISCLOSURE],
                        } as CommandFacadeRequest;
                        const rejected = rejectedOutcome(routeFor(hiddenEffect, [], [], contextWith()));
                        assert.equal(rejected.reason, 'invalid-request');
                        assert.ok(rejected.detail.includes('always visible'));
                });

                test('carries the declared side effects verbatim', () => {
                        const routing = asDirectToolRouting(
                                routedOutcome(routeFor(directToolRequest('fixture.fs.readFile'), [], [], contextWith())),
                        );
                        assert.deepStrictEqual(routing.sideEffects, [READ_DISCLOSURE_A]);
                });
        });

        suite('deriveFacadeReceiptsDigest', () => {
                test('is deterministic and independent of key insertion order', () => {
                        const oneWay: CompoundRouting = {
                                kind: 'compound',
                                commandId: 'cmd-digest',
                                nameDigest: 'name-digest:cmd-digest',
                                stepRoutings: [
                                        {
                                                stepId: 's-read',
                                                toolName: 'fixture.fs.readFile',
                                                routesThroughApprovalAuthority: false,
                                                expectedSideEffects: [READ_DISCLOSURE_A],
                                        },
                                ],
                                sideEffects: [READ_DISCLOSURE_A],
                        };
                        const otherWay: CompoundRouting = {
                                sideEffects: [READ_DISCLOSURE_A],
                                stepRoutings: [
                                        {
                                                expectedSideEffects: [READ_DISCLOSURE_A],
                                                routesThroughApprovalAuthority: false,
                                                toolName: 'fixture.fs.readFile',
                                                stepId: 's-read',
                                        },
                                ],
                                nameDigest: 'name-digest:cmd-digest',
                                commandId: 'cmd-digest',
                                kind: 'compound',
                        };
                        assert.equal(deriveFacadeReceiptsDigest(oneWay), deriveFacadeReceiptsDigest(oneWay));
                        assert.equal(deriveFacadeReceiptsDigest(oneWay), deriveFacadeReceiptsDigest(otherWay));
                });

                test('distinguishes serve from redirect, and stale from expired', () => {
                        const serve = routedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 0 })),
                        );
                        const stale = routedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 60_001 })),
                        );
                        const expired = routedOutcome(
                                routeFor(mirrorRequest('mirror-fixture'), [], [fixtureMirror()], contextWith({ clockDeltaMs: 300_001 })),
                        );
                        const serveDigest = deriveFacadeReceiptsDigest(serve);
                        const staleDigest = deriveFacadeReceiptsDigest(stale);
                        const expiredDigest = deriveFacadeReceiptsDigest(expired);
                        assert.notEqual(serveDigest, staleDigest);
                        assert.notEqual(staleDigest, expiredDigest);
                        assert.notEqual(serveDigest, expiredDigest);
                });

                test('changes when a step routing changes', () => {
                        const base: CompoundRouting = {
                                kind: 'compound',
                                commandId: 'cmd-digest',
                                nameDigest: 'name-digest:cmd-digest',
                                stepRoutings: [
                                        {
                                                stepId: 's-read',
                                                toolName: 'fixture.fs.readFile',
                                                routesThroughApprovalAuthority: false,
                                                expectedSideEffects: [READ_DISCLOSURE_A],
                                        },
                                ],
                                sideEffects: [READ_DISCLOSURE_A],
                        };
                        const changed: CompoundRouting = {
                                ...base,
                                stepRoutings: [
                                        {
                                                ...base.stepRoutings[0],
                                                stepId: 's-read-changed',
                                        },
                                ],
                        };
                        assert.notEqual(deriveFacadeReceiptsDigest(base), deriveFacadeReceiptsDigest(changed));
                });
        });

        suite('buildFacadeReceipt', () => {
                test('builds the receipt with the contract version forced and the digest derived', () => {
                        const routing = routedOutcome(
                                routeFor(compoundRequest('cmd-fixture'), [fixtureCompound()], [], contextWith()),
                        );
                        const receipt = builtReceipt(buildFacadeReceipt(FIXTURE_SCOPE, 'fac-fixture', routing, '2025-01-02T00:00:01Z'));
                        assert.deepStrictEqual(receipt.scope, FIXTURE_SCOPE);
                        assert.equal(receipt.contractVersion, COMMAND_FACADE_CONTRACTS_VERSION);
                        assert.equal(receipt.facadeId, 'fac-fixture');
                        assert.deepStrictEqual(receipt.routingVerdict, routing);
                        assert.equal(receipt.receiptsDigest, deriveFacadeReceiptsDigest(routing));
                        assert.equal(receipt.completedAtIso, '2025-01-02T00:00:01Z');
                });

                test('rejects an invalid scope, empty facadeId or empty completedAtIso', () => {
                        const routing = routedOutcome(
                                routeFor(compoundRequest('cmd-fixture'), [fixtureCompound()], [], contextWith()),
                        );
                        assert.equal(
                                rejectedReceipt(buildFacadeReceipt({ workspaceId: '', tenantId: 'tenant-fixture' }, 'fac-fixture', routing, '2025-01-02T00:00:01Z')).reason,
                                'invalid-scope',
                        );
                        assert.equal(
                                rejectedReceipt(buildFacadeReceipt(FIXTURE_SCOPE, '', routing, '2025-01-02T00:00:01Z')).reason,
                                'invalid-facade-id',
                        );
                        assert.equal(
                                rejectedReceipt(buildFacadeReceipt(FIXTURE_SCOPE, 'fac-fixture', routing, '')).reason,
                                'invalid-completed-at',
                        );
                });

                test('rejects junk routing kinds as invalid-routing', () => {
                        const junk = { kind: 'teleport' } as unknown as FacadeRouting;
                        const rejected = rejectedReceipt(buildFacadeReceipt(FIXTURE_SCOPE, 'fac-fixture', junk, '2025-01-02T00:00:01Z'));
                        assert.equal(rejected.reason, 'invalid-routing');
                        assert.ok(rejected.detail.includes('teleport'));
                });

                test('rejects a redirected routing missing its bypass disclosure (never-silent at the receipt boundary)', () => {
                        const silentStale = {
                                kind: 'mirrored-read',
                                mirrorId: 'mirror-fixture',
                                surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-fixture' },
                                freshness: 'stale',
                                routeTarget: 'direct-read',
                                sideEffects: [],
                        } as unknown as FacadeRouting;
                        const missingBypass = rejectedReceipt(
                                buildFacadeReceipt(FIXTURE_SCOPE, 'fac-fixture', silentStale, '2025-01-02T00:00:01Z'),
                        );
                        assert.equal(missingBypass.reason, 'invalid-routing');
                        assert.ok(missingBypass.detail.includes('never a silent stale serve'));
                        const servedStale = {
                                kind: 'mirrored-read',
                                mirrorId: 'mirror-fixture',
                                surfaceRef: { surfaceKind: 'fixture.execution.task-state-read', resourceId: 'res-fixture' },
                                freshness: 'stale',
                                routeTarget: 'mirror',
                                sideEffects: [],
                        } as unknown as FacadeRouting;
                        const badServe = rejectedReceipt(
                                buildFacadeReceipt(FIXTURE_SCOPE, 'fac-fixture', servedStale, '2025-01-02T00:00:01Z'),
                        );
                        assert.equal(badServe.reason, 'invalid-routing');
                        assert.ok(badServe.detail.includes('never a silent stale serve'));
                });
        });

        suite('SEAM-PIN: facade seam copies (activates after repo-side transcription)', () => {
                test('tool-vocabulary copy is transcribed, frozen and name-unique', () => {
                        assert.ok(
                                FROZEN_TOOL_VOCABULARY.length > 0,
                                'SEAM(TOOL_VOCABULARY) pending: transcribe the Tool authority vocabulary repo-side, into BOTH copies',
                        );
                        assert.ok(Object.isFrozen(FROZEN_TOOL_VOCABULARY));
                        const names = FROZEN_TOOL_VOCABULARY.map((entry) => entry.toolName);
                        assert.equal(new Set(names).size, names.length);
                });

                test('mirrorable-surface copy is transcribed, frozen and kind-unique', () => {
                        assert.ok(
                                FROZEN_MIRRORABLE_SURFACES.length > 0,
                                'SEAM(MIRRORABLE_SURFACES) pending: transcribe the Resource authority read-only surface kinds repo-side, into BOTH copies',
                        );
                        assert.ok(Object.isFrozen(FROZEN_MIRRORABLE_SURFACES));
                        const kinds = FROZEN_MIRRORABLE_SURFACES.map((entry) => entry.surfaceKind);
                        assert.equal(new Set(kinds).size, kinds.length);
                });

                test('both copies remain identical to their module-of-record copies', () => {
                        assert.deepStrictEqual(FROZEN_TOOL_VOCABULARY, COMPOUND_VOCABULARY);
                        assert.deepStrictEqual(FROZEN_MIRRORABLE_SURFACES, MIRROR_SURFACES);
                });
        });
});
