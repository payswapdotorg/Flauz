/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * ZC-008 compound contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: the tool vocabulary below is SYNTHETIC (every name
 * prefixed 'fixture.') and is NOT an authority value. Authority values
 * are pinned separately, after repo-side seam transcription, by the
 * SEAM-PIN suite at the bottom of this file.
 */

import { strict as assert } from 'node:assert';
import {
    APPROVAL_REQUIREMENTS,
    COMMAND_FACADE_CONTRACTS_VERSION,
    FROZEN_TOOL_VOCABULARY,
    MAX_COMPOUND_STEPS,
    SIDE_EFFECT_KINDS,
    SIDE_EFFECT_VISIBILITIES,
    canAdmitCompound,
    isCompleteExecutionRecord,
    isFacadeScope,
    isSideEffectDisclosure,
    isToolRef,
} from '../../common/compound.js';
import type {
    CompoundAdmission,
    CompoundAdmitted,
    CompoundCommand,
    CompoundExecutionRecord,
    CompoundRejected,
    CompoundStep,
    CompoundStepReceipt,
    SideEffectDisclosure,
    ToolVocabularyEntry,
} from '../../common/compound.js';

const FIXTURE_SCOPE = { workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' };

const FIXTURE_VOCABULARY: readonly ToolVocabularyEntry[] = [
    { toolName: 'fixture.fs.readFile', confirmationGated: false },
    { toolName: 'fixture.fs.writeFile', confirmationGated: false },
    { toolName: 'fixture.shell.exec', confirmationGated: true },
];

const VISIBLE_DISCLOSURE = {
    surfaceRef: { surfaceKind: 'fixture.execution.task-log', resourceId: 'res-fixture' },
    kind: 'read',
    provenanceDigest: 'prov-digest:fixture',
    visibility: 'visible',
} as const;

// Runtime-shape fixture (typed via double cast on purpose): a JS
// consumer could hand the guard a hidden visibility; the type forbids
// it, the guard still fails closed.
const HIDDEN_DISCLOSURE = {
    surfaceRef: { surfaceKind: 'fixture.execution.task-log', resourceId: 'res-fixture' },
    kind: 'read',
    provenanceDigest: 'prov-digest:hidden',
    visibility: 'hidden',
} as unknown as SideEffectDisclosure;

function fixtureStep(stepId: string, toolName: string, approvalRequirement: 'none' | 'confirmation'): CompoundStep {
    return {
        stepId,
        toolRef: { toolName },
        argsDigest: `args-digest:${stepId}`,
        expectedSideEffects: [VISIBLE_DISCLOSURE],
        approvalRequirement,
    };
}

function fixtureCommand(steps: readonly CompoundStep[]): CompoundCommand {
    return {
        scope: FIXTURE_SCOPE,
        contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
        commandId: 'cmd-fixture',
        nameDigest: 'name-digest:cmd-fixture',
        steps,
    };
}

function fixtureStepReceipt(step: CompoundStep): CompoundStepReceipt {
    return {
        stepId: step.stepId,
        toolRef: step.toolRef,
        argsDigest: step.argsDigest,
        sideEffects: step.expectedSideEffects,
        approvalReceipt: {
            stepId: step.stepId,
            requirement: step.approvalRequirement,
            approvalRoutingDigest: `approval-digest:${step.stepId}`,
        },
    };
}

function fixtureExecutionRecord(
    command: CompoundCommand,
    stepReceipts: readonly CompoundStepReceipt[],
): CompoundExecutionRecord {
    return {
        scope: command.scope,
        contractVersion: COMMAND_FACADE_CONTRACTS_VERSION,
        commandId: command.commandId,
        stepReceipts,
        executedAtIso: '2025-01-01T00:00:00Z',
    };
}

function makeOverflowSteps(): CompoundStep[] {
    const steps: CompoundStep[] = [];
    for (let index = 0; index <= MAX_COMPOUND_STEPS; index += 1) {
        steps.push(fixtureStep(`s-${index}`, 'fixture.fs.readFile', 'none'));
    }
    return steps;
}

function admittedCommand(admission: CompoundAdmission): CompoundAdmitted {
    assert.equal(admission.admitted, true, `expected admission, got: ${JSON.stringify(admission)}`);
    return admission as CompoundAdmitted;
}

function rejectedAdmission(admission: CompoundAdmission): CompoundRejected {
    assert.equal(admission.admitted, false, `expected rejection, got: ${JSON.stringify(admission)}`);
    return admission as CompoundRejected;
}

suite('ZC-008 compound command contracts', () => {

    suite('constants and closed lists', () => {
        test('contract set version is 1.0.0', () => {
            assert.equal(COMMAND_FACADE_CONTRACTS_VERSION, '1.0.0');
        });

        test('MAX_COMPOUND_STEPS is a positive integer bound', () => {
            assert.ok(Number.isInteger(MAX_COMPOUND_STEPS));
            assert.ok(MAX_COMPOUND_STEPS > 0);
        });

        test('side-effect kinds are the closed read/write/network/spawn list', () => {
            assert.deepStrictEqual([...SIDE_EFFECT_KINDS], ['read', 'write', 'network', 'spawn']);
        });

        test('the only admitted side-effect visibility is visible', () => {
            assert.deepStrictEqual([...SIDE_EFFECT_VISIBILITIES], ['visible']);
        });

        test('approval requirements are none or confirmation', () => {
            assert.deepStrictEqual([...APPROVAL_REQUIREMENTS], ['none', 'confirmation']);
        });
    });

    suite('pure shape guards', () => {
        test('isFacadeScope accepts a scope with non-empty workspace and tenant ids', () => {
            assert.ok(isFacadeScope({ workspaceId: 'ws-fixture', tenantId: 'tenant-fixture' }));
        });

        test('isFacadeScope rejects empty ids, missing fields and non-objects', () => {
            assert.ok(!isFacadeScope({ workspaceId: '', tenantId: 'tenant-fixture' }));
            assert.ok(!isFacadeScope({ workspaceId: 'ws-fixture', tenantId: '' }));
            assert.ok(!isFacadeScope({ workspaceId: 'ws-fixture' }));
            assert.ok(!isFacadeScope(null));
            assert.ok(!isFacadeScope('ws-fixture'));
        });

        test('isSideEffectDisclosure accepts visible disclosures and rejects hidden ones, bad kinds and empty digests', () => {
            assert.ok(isSideEffectDisclosure(VISIBLE_DISCLOSURE));
            assert.ok(!isSideEffectDisclosure(HIDDEN_DISCLOSURE));
            assert.ok(!isSideEffectDisclosure({ ...VISIBLE_DISCLOSURE, provenanceDigest: '' }));
            assert.ok(!isSideEffectDisclosure({ ...VISIBLE_DISCLOSURE, kind: 'teleport' }));
            assert.ok(!isSideEffectDisclosure(null));
        });

        test('isToolRef accepts a named reference and rejects junk', () => {
            assert.ok(isToolRef({ toolName: 'fixture.fs.readFile' }));
            assert.ok(!isToolRef({}));
            assert.ok(!isToolRef(null));
            assert.ok(!isToolRef({ toolName: '' }));
        });
    });

    suite('canAdmitCompound admission guard', () => {
        test('admits a bounded well-formed compound against the fixture vocabulary', () => {
            const command = fixtureCommand([
                fixtureStep('s-read', 'fixture.fs.readFile', 'none'),
                fixtureStep('s-exec', 'fixture.shell.exec', 'confirmation'),
            ]);
            const admission = canAdmitCompound(command, FIXTURE_VOCABULARY);
            assert.deepStrictEqual(admittedCommand(admission), {
                admitted: true,
                commandId: 'cmd-fixture',
                stepCount: 2,
            });
        });

        test('rejects the empty compound as incoherent', () => {
            const rejected = rejectedAdmission(canAdmitCompound(fixtureCommand([]), FIXTURE_VOCABULARY));
            assert.equal(rejected.reason, 'empty-steps');
        });

        test('rejects a compound that exceeds MAX_COMPOUND_STEPS and names the bound', () => {
            const rejected = rejectedAdmission(
                canAdmitCompound(fixtureCommand(makeOverflowSteps()), FIXTURE_VOCABULARY),
            );
            assert.equal(rejected.reason, 'too-many-steps');
            assert.ok(rejected.detail.includes('MAX_COMPOUND_STEPS'));
        });

        test('rejects duplicate step ids and names the duplicated id', () => {
            const rejected = rejectedAdmission(
                canAdmitCompound(
                    fixtureCommand([
                        fixtureStep('s-dup', 'fixture.fs.readFile', 'none'),
                        fixtureStep('s-dup', 'fixture.fs.writeFile', 'none'),
                    ]),
                    FIXTURE_VOCABULARY,
                ),
            );
            assert.equal(rejected.reason, 'duplicate-step-id');
            assert.ok(rejected.detail.includes('s-dup'));
        });

        test('rejects an unresolvable toolRef and names the step and the tool', () => {
            const rejected = rejectedAdmission(
                canAdmitCompound(fixtureCommand([fixtureStep('s-x', 'fixture.fs.chmod', 'none')]), FIXTURE_VOCABULARY),
            );
            assert.equal(rejected.reason, 'unknown-tool');
            assert.ok(rejected.detail.includes('s-x'));
            assert.ok(rejected.detail.includes('fixture.fs.chmod'));
        });

        test('fails closed by default: fixture tools do not resolve in the frozen vocabulary', () => {
            const command = fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'none')]);
            const rejected = rejectedAdmission(canAdmitCompound(command));
            assert.equal(rejected.reason, 'unknown-tool');
        });

        test('rejects a confirmation-gated tool declared none: side effects never silently escape approval', () => {
            const rejected = rejectedAdmission(
                canAdmitCompound(fixtureCommand([fixtureStep('s-exec', 'fixture.shell.exec', 'none')]), FIXTURE_VOCABULARY),
            );
            assert.equal(rejected.reason, 'approval-requirement-mismatch');
            assert.ok(rejected.detail.includes('never silently escape approval'));
        });

        test('permits confirmation on a non-gated tool: over-approval is not a violation', () => {
            const admission = canAdmitCompound(
                fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'confirmation')]),
                FIXTURE_VOCABULARY,
            );
            assert.equal(admittedCommand(admission).stepCount, 1);
        });

        test('rejects an invalid scope', () => {
            const command: CompoundCommand = {
                ...fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'none')]),
                scope: { workspaceId: '', tenantId: 'tenant-fixture' },
            };
            const rejected = rejectedAdmission(canAdmitCompound(command, FIXTURE_VOCABULARY));
            assert.equal(rejected.reason, 'invalid-scope');
        });

        test('rejects a contract-version mismatch', () => {
            const command: CompoundCommand = {
                ...fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'none')]),
                contractVersion: '0.9.0',
            };
            const rejected = rejectedAdmission(canAdmitCompound(command, FIXTURE_VOCABULARY));
            assert.equal(rejected.reason, 'contract-version-mismatch');
        });

        test('rejects empty commandId, nameDigest or argsDigest', () => {
            const base = fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'none')]);
            assert.equal(
                rejectedAdmission(canAdmitCompound({ ...base, commandId: '' }, FIXTURE_VOCABULARY)).reason,
                'invalid-command-id',
            );
            assert.equal(
                rejectedAdmission(canAdmitCompound({ ...base, nameDigest: '' }, FIXTURE_VOCABULARY)).reason,
                'invalid-name-digest',
            );
            const emptyArgsStep: CompoundStep = {
                ...fixtureStep('s-read', 'fixture.fs.readFile', 'none'),
                argsDigest: '',
            };
            assert.equal(
                rejectedAdmission(canAdmitCompound(fixtureCommand([emptyArgsStep]), FIXTURE_VOCABULARY)).reason,
                'invalid-step',
            );
        });

        test('rejects a step carrying a malformed side-effect disclosure', () => {
            const stepWithHiddenEffect: CompoundStep = {
                stepId: 's-hidden',
                toolRef: { toolName: 'fixture.fs.readFile' },
                argsDigest: 'args-digest:s-hidden',
                expectedSideEffects: [HIDDEN_DISCLOSURE],
                approvalRequirement: 'none',
            };
            const rejected = rejectedAdmission(
                canAdmitCompound(fixtureCommand([stepWithHiddenEffect]), FIXTURE_VOCABULARY),
            );
            assert.equal(rejected.reason, 'invalid-step');
            assert.ok(rejected.detail.includes('always visible'));
        });
    });

    suite('isCompleteExecutionRecord provenance trail', () => {
        const twoStepCommand = fixtureCommand([
            fixtureStep('s-read', 'fixture.fs.readFile', 'none'),
            fixtureStep('s-exec', 'fixture.shell.exec', 'confirmation'),
        ]);

        test('accepts a record whose receipt trail covers the command exactly', () => {
            const record = fixtureExecutionRecord(twoStepCommand, twoStepCommand.steps.map(fixtureStepReceipt));
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete, true);
            assert.equal(check.complete === true ? check.stepCount : -1, 2);
        });

        test('rejects a record missing a step receipt', () => {
            const record = fixtureExecutionRecord(twoStepCommand, [fixtureStepReceipt(twoStepCommand.steps[0])]);
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete, false);
            assert.equal(check.complete === false ? check.reason : '', 'step-trail-mismatch');
        });

        test('rejects a record with an unexpected extra receipt', () => {
            const oneStepCommand = fixtureCommand([fixtureStep('s-read', 'fixture.fs.readFile', 'none')]);
            const extraReceipt = fixtureStepReceipt(fixtureStep('s-extra', 'fixture.fs.readFile', 'none'));
            const record = fixtureExecutionRecord(oneStepCommand, [
                fixtureStepReceipt(oneStepCommand.steps[0]),
                extraReceipt,
            ]);
            const check = isCompleteExecutionRecord(oneStepCommand, record);
            assert.equal(check.complete, false);
            assert.equal(check.complete === false ? check.reason : '', 'step-trail-mismatch');
        });

        test('rejects a command-id mismatch', () => {
            const record: CompoundExecutionRecord = {
                ...fixtureExecutionRecord(twoStepCommand, twoStepCommand.steps.map(fixtureStepReceipt)),
                commandId: 'cmd-other',
            };
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete === false ? check.reason : '', 'command-id-mismatch');
        });

        test('rejects a scope mismatch (a record from another workspace)', () => {
            const record: CompoundExecutionRecord = {
                ...fixtureExecutionRecord(twoStepCommand, twoStepCommand.steps.map(fixtureStepReceipt)),
                scope: { workspaceId: 'ws-other', tenantId: 'tenant-fixture' },
            };
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete === false ? check.reason : '', 'scope-mismatch');
        });

        test('rejects an approval receipt contradicting its step', () => {
            const receipts = twoStepCommand.steps.map(fixtureStepReceipt);
            const contradiction: CompoundStepReceipt = {
                ...receipts[1],
                approvalReceipt: { ...receipts[1].approvalReceipt, requirement: 'none' },
            };
            const record = fixtureExecutionRecord(twoStepCommand, [receipts[0], contradiction]);
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete === false ? check.reason : '', 'approval-receipt-mismatch');
        });

        test('fails closed: a confirmation-gated tool with a none receipt is rejected (fixture vocabulary)', () => {
            // The step itself is inadmissible (gated tool, 'none'); the
            // receipt agrees with the step; the trail check still fails
            // closed when a vocabulary is supplied that resolves the tool.
            const inadmissibleCommand = fixtureCommand([fixtureStep('s-exec', 'fixture.shell.exec', 'none')]);
            const record = fixtureExecutionRecord(inadmissibleCommand, inadmissibleCommand.steps.map(fixtureStepReceipt));
            const check = isCompleteExecutionRecord(inadmissibleCommand, record, FIXTURE_VOCABULARY);
            assert.equal(check.complete === false ? check.reason : '', 'approval-receipt-mismatch');
        });

        test('rejects an empty executedAtIso', () => {
            const record: CompoundExecutionRecord = {
                ...fixtureExecutionRecord(twoStepCommand, twoStepCommand.steps.map(fixtureStepReceipt)),
                executedAtIso: '',
            };
            const check = isCompleteExecutionRecord(twoStepCommand, record);
            assert.equal(check.complete === false ? check.reason : '', 'invalid-executed-at');
        });
    });

    suite('SEAM-PIN: frozen tool vocabulary (activates after repo-side transcription)', () => {
        test('is transcribed: non-empty and frozen', () => {
            assert.ok(
                FROZEN_TOOL_VOCABULARY.length > 0,
                'SEAM(TOOL_VOCABULARY) pending: transcribe the Tool authority vocabulary repo-side',
            );
            assert.ok(Object.isFrozen(FROZEN_TOOL_VOCABULARY));
        });

        test('is closed: tool names are unique', () => {
            const names = FROZEN_TOOL_VOCABULARY.map((entry) => entry.toolName);
            assert.equal(new Set(names).size, names.length);
        });

        test('carries at least one confirmation-gated tool (HumanApproval routing exists in the authority)', () => {
            assert.ok(
                FROZEN_TOOL_VOCABULARY.some((entry) => entry.confirmationGated),
                'the Tool authority routes at least terminalTool through the HumanApproval confirmation gate',
            );
        });
    });
});