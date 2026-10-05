/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- tests for the verification contract (mocha tdd, mirroring the
// style of build/flauz/lab/test/common/labContracts.test.ts).
//
// SEAM: TEST-IMPORTS -- the assert import line below follows the order's test
// style ('assert', '.js' import suffixes, mocha tdd). If the lab suite uses a
// different import line or a file-level pragma, transcribe it verbatim.
//
// SEAM: MOCHA-RUNNER -- these suites assume the repository's existing
// mocha + TypeScript pipeline (the one that runs the lab suites) resolves
// '../../common/verification.js' beside this file.

import assert from 'assert';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION,
    CATALOG_ADMISSION_DECISIONS,
    VERIFICATION_MISMATCH_KINDS,
    VERIFICATION_RECEIPT_REJECTION_CODES,
    VERIFICATION_STATUSES,
    canAdmitToCatalog,
    isPackScope,
    isQuarantinedVerificationStatus,
    isVerificationCheck,
    isVerificationReceipt,
    isVerificationStatus,
    isVerificationSubject,
    validateVerificationReceipt,
    verificationStatusFor
} from '../../common/verification.js';
import type {
    VerificationCheck,
    VerificationOutcome,
    VerificationReceipt,
    VerificationSubject
} from '../../common/verification.js';
import {
    CAPABILITY_PACKS_CONTRACTS_VERSION as PACK_VERSION,
    REQUIRED_CAPABILITY_REF_KINDS,
    isCapabilityPack,
    isPackScope as isPackScopePack
} from '../../common/pack.js';
import type { CapabilityPack } from '../../common/pack.js';

function digestOf(char: string): string {
    return char.repeat(64);
}

function makeSubject(): VerificationSubject {
    return {
        scope: { workspaceId: 'ws-alpha', tenantId: 'tenant-alpha' },
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3'
    };
}

function subjectWith(overrides: Partial<VerificationSubject>): VerificationSubject {
    return { ...makeSubject(), ...overrides };
}

function makeCheck(name: string, passed: boolean): VerificationCheck {
    return { name, passed, evidenceDigest: digestOf('a') };
}

function makeReceipt(): VerificationReceipt {
    return {
        scope: { workspaceId: 'ws-alpha', tenantId: 'tenant-alpha' },
        contractVersion: CAPABILITY_PACKS_CONTRACTS_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3',
        status: 'verified',
        checks: [makeCheck('integrity', true)]
    };
}

function receiptWith(overrides: Partial<VerificationReceipt>): VerificationReceipt {
    return { ...makeReceipt(), ...overrides };
}

function receiptVariant(overrides: Record<string, unknown>): unknown {
    return { ...makeReceipt(), ...overrides };
}

function receiptCode(value: unknown): string | null {
    const result = validateVerificationReceipt(value);
    return result.ok ? null : result.code;
}

function outcomeKinds(outcome: VerificationOutcome): string[] {
    return outcome.mismatches.map((mismatch) => mismatch.kind);
}

interface DerivationRow {
    name: string;
    subject: unknown;
    receipt: unknown;
}

function derivationBattery(): DerivationRow[] {
    return [
        { name: 'all checks pass, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [makeCheck('integrity', true), makeCheck('permissions', true)] }) },
        { name: 'one check failed, claim verified-partial', subject: makeSubject(), receipt: receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', true), makeCheck('permissions', false)] }) },
        { name: 'scope mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, status: 'verification-failed' }) },
        { name: 'contract version mismatch, claim verification-failed', subject: subjectWith({ contractVersion: '2.0.0' }), receipt: receiptWith({ status: 'verification-failed' }) },
        { name: 'packId mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' }) },
        { name: 'version mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ version: '2.0.0', status: 'verification-failed' }) },
        { name: 'no checks, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ status: 'verification-failed', checks: [] }) },
        { name: 'no checks, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [] }) },
        { name: 'all checks pass, claim verified-partial', subject: makeSubject(), receipt: receiptWith({ status: 'verified-partial' }) },
        { name: 'one check failed, claim verified', subject: makeSubject(), receipt: receiptWith({ checks: [makeCheck('integrity', true), makeCheck('permissions', false)] }) },
        { name: 'scope and packId mismatch, claim verification-failed', subject: makeSubject(), receipt: receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, packId: 'flauz.pack.other', status: 'verification-failed' }) },
        { name: 'malformed subject', subject: { packId: 'x' }, receipt: makeReceipt() },
        { name: 'malformed receipt', subject: makeSubject(), receipt: { status: 'verified' } }
    ];
}

interface AdmissionRow {
    name: string;
    pack: unknown;
    receipt: unknown;
}

function admissionBattery(): AdmissionRow[] {
    return [
        { name: 'no receipt', pack: makeSubject(), receipt: null },
        { name: 'absent receipt', pack: makeSubject(), receipt: undefined },
        { name: 'matching verified receipt', pack: makeSubject(), receipt: makeReceipt() },
        { name: 'matching partial receipt', pack: makeSubject(), receipt: receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', true), makeCheck('permissions', false)] }) },
        { name: 'receipt from another scope', pack: makeSubject(), receipt: receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, status: 'verification-failed' }) },
        { name: 'receipt with no checks', pack: makeSubject(), receipt: receiptWith({ status: 'verification-failed', checks: [] }) },
        { name: 'claim above the evidence', pack: makeSubject(), receipt: receiptWith({ checks: [makeCheck('integrity', false)] }) },
        { name: 'malformed pack', pack: { packId: 'x' }, receipt: null },
        { name: 'pack from another contract version', pack: subjectWith({ contractVersion: '2.0.0' }), receipt: null },
        { name: 'malformed receipt', pack: makeSubject(), receipt: { status: 'verified' } },
        { name: 'receipt for another pack', pack: makeSubject(), receipt: receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' }) }
    ];
}

function makeFullPack(): CapabilityPack {
    return {
        scope: { workspaceId: 'ws-alpha', tenantId: 'tenant-alpha' },
        contractVersion: PACK_VERSION,
        packId: 'flauz.pack.example',
        version: '1.2.3',
        nameDigest: digestOf('a'),
        descriptionDigest: digestOf('b'),
        artifacts: [
            { kind: 'cli', artifactDigest: digestOf('c'), byteSize: 256, entrypointRef: './bin/cli' },
            { kind: 'skill-instructions', artifactDigest: digestOf('d'), byteSize: 128, entrypointRef: './skills/main.md' }
        ],
        requiredCapabilities: [{ kind: REQUIRED_CAPABILITY_REF_KINDS[0], refId: 'flauz.cap.example' }],
        declaredPermissions: ['read-files', 'write-workspace'],
        configuration: {
            fields: [{ name: 'verbosity', type: 'string', required: false }],
            defaults: { verbosity: 'normal' }
        },
        provenance: {
            origin: 'flauz-internal',
            sourceType: 'flauz-native',
            capturedAtIso: '2026-01-15T09:30:00Z',
            licenseSpdxId: 'MIT',
            licenseDigest: digestOf('e')
        },
        platformCompatibility: ['darwin-arm64', 'linux-x64'],
        integrity: { contentDigest: digestOf('f') }
    };
}

suite('verification contracts (zc006)', () => {

    suite('contract version and pinned mirrors', () => {
        test('pins the contract set version at 1.0.0', () => {
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, '1.0.0');
        });
        test('the version constant mirrors pack.ts (pinned mirror)', () => {
            assert.strictEqual(CAPABILITY_PACKS_CONTRACTS_VERSION, PACK_VERSION);
        });
        test('PackScope is the pinned mirror of pack.ts PackScope (the guards agree)', () => {
            const scopes: unknown[] = [
                { workspaceId: 'ws-1', tenantId: 'tenant-1' },
                { workspaceId: '', tenantId: 'tenant-1' },
                { workspaceId: 'ws-1', tenantId: '' },
                { workspaceId: 'ws-1' },
                null,
                'ws-1/tenant-1',
                { workspaceId: 'ws-1', tenantId: 'tenant-1', extra: true }
            ];
            for (const scope of scopes) {
                assert.strictEqual(isPackScope(scope), isPackScopePack(scope), 'the mirrored scope guards must agree');
            }
        });
        test('a pack.ts-shaped pack record satisfies isVerificationSubject', () => {
            const pack = makeFullPack();
            assert.strictEqual(isCapabilityPack(pack), true);
            assert.strictEqual(isVerificationSubject(pack), true);
            const broken: unknown = { ...pack, packId: '.bad' };
            assert.strictEqual(isVerificationSubject(broken), false);
        });
    });

    suite('frozen vocabularies', () => {
        test('pins the verification statuses', () => {
            assert.deepStrictEqual([...VERIFICATION_STATUSES], ['unverified', 'verified', 'verified-partial', 'verification-failed']);
        });
        test('the status guard accepts exactly the vocabulary', () => {
            for (const status of VERIFICATION_STATUSES) {
                assert.strictEqual(isVerificationStatus(status), true, status);
            }
            for (const value of ['unknown', 'VERIFIED', '', null, 1]) {
                assert.strictEqual(isVerificationStatus(value), false, String(value));
            }
        });
        test('pins the receipt rejection codes', () => {
            assert.deepStrictEqual([...VERIFICATION_RECEIPT_REJECTION_CODES], [
                'receipt-malformed',
                'receipt-scope-invalid',
                'receipt-contract-version-mismatch',
                'receipt-pack-id-invalid',
                'receipt-version-invalid',
                'receipt-status-unknown',
                'receipt-checks-invalid'
            ]);
        });
        test('pins the mismatch kinds', () => {
            assert.deepStrictEqual([...VERIFICATION_MISMATCH_KINDS], [
                'verification-subject-malformed',
                'verification-receipt-malformed',
                'receipt-scope-mismatch',
                'receipt-contract-version-mismatch',
                'receipt-pack-id-mismatch',
                'receipt-version-mismatch',
                'receipt-checks-empty',
                'receipt-status-claim-mismatch'
            ]);
        });
        test('pins the admission decision kinds', () => {
            assert.deepStrictEqual([...CATALOG_ADMISSION_DECISIONS], [
                'admission-rejected-pack-malformed',
                'admission-rejected-pack-contract-version-mismatch',
                'admission-rejected-receipt-malformed',
                'admitted-unverified-quarantined',
                'admitted-verified',
                'admitted-verified-partial-quarantined',
                'admitted-verification-failed-quarantined'
            ]);
        });
    });

    suite('verification checks', () => {
        test('accepts a valid check', () => {
            assert.strictEqual(isVerificationCheck({ name: 'integrity', passed: true, evidenceDigest: digestOf('a') }), true);
        });
        test('rejects an empty name', () => {
            assert.strictEqual(isVerificationCheck({ name: '', passed: true, evidenceDigest: digestOf('a') }), false);
        });
        test('rejects a non-boolean passed flag', () => {
            assert.strictEqual(isVerificationCheck({ name: 'integrity', passed: 'yes', evidenceDigest: digestOf('a') }), false);
        });
        test('rejects a malformed evidence digest', () => {
            assert.strictEqual(isVerificationCheck({ name: 'integrity', passed: true, evidenceDigest: 'short' }), false);
        });
        test('rejects a non-object', () => {
            assert.strictEqual(isVerificationCheck(null), false);
            assert.strictEqual(isVerificationCheck('check'), false);
        });
    });

    suite('validateVerificationReceipt', () => {
        test('accepts a valid receipt and returns it', () => {
            const receipt = makeReceipt();
            const result = validateVerificationReceipt(receipt);
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.deepStrictEqual(result.receipt, receipt);
            }
        });
        test('rejects a non-object with receipt-malformed', () => {
            assert.strictEqual(receiptCode(null), 'receipt-malformed');
            assert.strictEqual(receiptCode('receipt'), 'receipt-malformed');
        });
        test('rejects an invalid scope', () => {
            assert.strictEqual(receiptCode(receiptVariant({ scope: { workspaceId: '', tenantId: 't' } })), 'receipt-scope-invalid');
        });
        test('rejects a contract version mismatch', () => {
            assert.strictEqual(receiptCode(receiptVariant({ contractVersion: '0.9.0' })), 'receipt-contract-version-mismatch');
        });
        test('rejects an invalid packId', () => {
            assert.strictEqual(receiptCode(receiptVariant({ packId: '.bad' })), 'receipt-pack-id-invalid');
        });
        test('rejects a non-semver version', () => {
            assert.strictEqual(receiptCode(receiptVariant({ version: 'v1' })), 'receipt-version-invalid');
        });
        test('rejects an unknown status', () => {
            assert.strictEqual(receiptCode(receiptVariant({ status: 'unknown' })), 'receipt-status-unknown');
        });
        test('rejects a non-array checks list', () => {
            assert.strictEqual(receiptCode(receiptVariant({ checks: 'nope' })), 'receipt-checks-invalid');
        });
        test('rejects a malformed check inside the list', () => {
            assert.strictEqual(receiptCode(receiptVariant({ checks: [{ name: 'a', passed: true, evidenceDigest: 'short' }] })), 'receipt-checks-invalid');
        });
        test('rejects duplicate check names', () => {
            assert.strictEqual(receiptCode(receiptVariant({ checks: [makeCheck('a', true), makeCheck('a', false)] })), 'receipt-checks-invalid');
        });
        test('accepts an empty checks list structurally (the derived-status law fails it closed)', () => {
            assert.strictEqual(validateVerificationReceipt(receiptWith({ checks: [] })).ok, true);
        });
        test('isVerificationReceipt mirrors validateVerificationReceipt', () => {
            const receipts: unknown[] = [
                makeReceipt(),
                receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', false)] }),
                receiptWith({ checks: [] }),
                receiptVariant({ checks: 'nope' }),
                receiptVariant({ status: 'unknown' }),
                receiptVariant({ contractVersion: '0.9.0' }),
                receiptVariant({ packId: '.bad' }),
                receiptVariant({ version: 'v1' }),
                receiptVariant({ scope: { workspaceId: '', tenantId: 't' } }),
                receiptVariant({ checks: [makeCheck('a', true), makeCheck('a', false)] }),
                receiptVariant({ checks: [{ name: 'a', passed: true, evidenceDigest: 'short' }] }),
                null,
                'receipt',
                42
            ];
            for (const receipt of receipts) {
                assert.strictEqual(isVerificationReceipt(receipt), validateVerificationReceipt(receipt).ok, 'the guard and the validator must agree');
            }
        });
    });

    suite('verification subjects', () => {
        test('accepts a subject carrying scope, contractVersion, packId and version', () => {
            assert.strictEqual(isVerificationSubject(makeSubject()), true);
        });
        test('rejects a malformed subject', () => {
            assert.strictEqual(isVerificationSubject({ packId: 'x' }), false);
            assert.strictEqual(isVerificationSubject(null), false);
            assert.strictEqual(isVerificationSubject({ ...makeSubject(), version: 'v1' }), false);
            assert.strictEqual(isVerificationSubject({ ...makeSubject(), scope: { workspaceId: '', tenantId: 't' } }), false);
        });
    });

    suite('verificationStatusFor: the derived-status law', () => {
        test('derives verified when every declared check passed and the identity matches', () => {
            const receipt = receiptWith({ checks: [makeCheck('integrity', true), makeCheck('permissions', true)] });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verified');
            assert.strictEqual(outcome.claimedStatus, 'verified');
            assert.deepStrictEqual(outcome.mismatches, []);
            assert.deepStrictEqual([...outcome.passedCheckNames], ['integrity', 'permissions']);
            assert.deepStrictEqual([...outcome.failedCheckNames], []);
        });
        test('derives verified-partial carrying the failed check names', () => {
            const receipt = receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', true), makeCheck('permissions', false)] });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verified-partial');
            assert.deepStrictEqual(outcome.mismatches, []);
            assert.deepStrictEqual([...outcome.passedCheckNames], ['integrity']);
            assert.deepStrictEqual([...outcome.failedCheckNames], ['permissions']);
        });
        test('derives verified-partial when every check failed', () => {
            const receipt = receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', false), makeCheck('permissions', false)] });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verified-partial');
            assert.deepStrictEqual([...outcome.failedCheckNames], ['integrity', 'permissions']);
        });
        test('names a scope mismatch', () => {
            const receipt = receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, status: 'verification-failed' });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-scope-mismatch']);
            assert.strictEqual(outcome.mismatches[0].message.includes('scope'), true);
        });
        test('names a contract version mismatch', () => {
            const receipt = receiptWith({ status: 'verification-failed' });
            const outcome = verificationStatusFor(subjectWith({ contractVersion: '2.0.0' }), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-contract-version-mismatch']);
        });
        test('names a packId mismatch', () => {
            const receipt = receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-pack-id-mismatch']);
        });
        test('names a version mismatch', () => {
            const receipt = receiptWith({ version: '2.0.0', status: 'verification-failed' });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-version-mismatch']);
        });
        test('names an evidence-less receipt (no checks)', () => {
            const honest = receiptWith({ status: 'verification-failed', checks: [] });
            const honestOutcome = verificationStatusFor(makeSubject(), honest);
            assert.strictEqual(honestOutcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(honestOutcome), ['receipt-checks-empty']);
            const boasting = receiptWith({ checks: [] });
            const boastingOutcome = verificationStatusFor(makeSubject(), boasting);
            assert.strictEqual(boastingOutcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(boastingOutcome), ['receipt-checks-empty', 'receipt-status-claim-mismatch']);
        });
        test('names a claim above the evidence (claims verified while a check failed)', () => {
            const receipt = receiptWith({ checks: [makeCheck('integrity', true), makeCheck('permissions', false)] });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-status-claim-mismatch']);
            assert.deepStrictEqual([...outcome.failedCheckNames], ['permissions']);
        });
        test('names a claim below the evidence (claims partial while all checks passed)', () => {
            const receipt = receiptWith({ status: 'verified-partial' });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-status-claim-mismatch']);
        });
        test('names several mismatches in a fixed order', () => {
            const receipt = receiptWith({ scope: { workspaceId: 'ws-beta', tenantId: 'tenant-beta' }, packId: 'flauz.pack.other', status: 'verification-failed' });
            const outcome = verificationStatusFor(makeSubject(), receipt);
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.deepStrictEqual(outcomeKinds(outcome), ['receipt-scope-mismatch', 'receipt-pack-id-mismatch']);
        });
        test('fails closed on a malformed subject', () => {
            const outcome = verificationStatusFor({ packId: 'x' }, makeReceipt());
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.strictEqual(outcome.claimedStatus, null);
            assert.deepStrictEqual(outcomeKinds(outcome), ['verification-subject-malformed']);
        });
        test('fails closed on a malformed receipt', () => {
            const outcome = verificationStatusFor(makeSubject(), { status: 'verified' });
            assert.strictEqual(outcome.status, 'verification-failed');
            assert.strictEqual(outcome.claimedStatus, null);
            assert.deepStrictEqual(outcomeKinds(outcome), ['verification-receipt-malformed']);
        });
        test('never derives unverified (unverified is the no-receipt admission state)', () => {
            const receipts: unknown[] = [
                makeReceipt(),
                receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', false)] }),
                receiptWith({ status: 'verification-failed', checks: [] }),
                receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' }),
                null,
                { status: 'verified' }
            ];
            for (const receipt of receipts) {
                const outcome = verificationStatusFor(makeSubject(), receipt);
                assert.notStrictEqual(outcome.status, 'unverified');
            }
        });
        test('is deterministic: the same inputs derive the same outcome', () => {
            for (const row of derivationBattery()) {
                assert.deepStrictEqual(verificationStatusFor(row.subject, row.receipt), verificationStatusFor(row.subject, row.receipt), row.name);
            }
        });
    });

    suite('isQuarantinedVerificationStatus', () => {
        test('only verified is not quarantined', () => {
            assert.strictEqual(isQuarantinedVerificationStatus('verified'), false);
            assert.strictEqual(isQuarantinedVerificationStatus('unverified'), true);
            assert.strictEqual(isQuarantinedVerificationStatus('verified-partial'), true);
            assert.strictEqual(isQuarantinedVerificationStatus('verification-failed'), true);
        });
    });

    suite('canAdmitToCatalog: the fail-closed admission guard', () => {
        test('rejects a malformed pack', () => {
            const decision = canAdmitToCatalog({ packId: 'x' }, null);
            assert.strictEqual(decision.admitted, false);
            assert.strictEqual(decision.quarantined, false);
            assert.strictEqual(decision.status, null);
            assert.strictEqual(decision.decision, 'admission-rejected-pack-malformed');
        });
        test('rejects a pack from another contract version', () => {
            const decision = canAdmitToCatalog(subjectWith({ contractVersion: '2.0.0' }), null);
            assert.strictEqual(decision.admitted, false);
            assert.strictEqual(decision.quarantined, false);
            assert.strictEqual(decision.status, null);
            assert.strictEqual(decision.decision, 'admission-rejected-pack-contract-version-mismatch');
        });
        test('rejects a malformed receipt', () => {
            const decision = canAdmitToCatalog(makeSubject(), { status: 'verified' });
            assert.strictEqual(decision.admitted, false);
            assert.strictEqual(decision.quarantined, false);
            assert.strictEqual(decision.status, null);
            assert.strictEqual(decision.decision, 'admission-rejected-receipt-malformed');
        });
        test('admits an unverified pack quarantined when no receipt is present', () => {
            const decision = canAdmitToCatalog(makeSubject(), null);
            assert.strictEqual(decision.admitted, true);
            assert.strictEqual(decision.quarantined, true);
            assert.strictEqual(decision.status, 'unverified');
            assert.strictEqual(decision.decision, 'admitted-unverified-quarantined');
            assert.deepStrictEqual([...decision.mismatches], []);
        });
        test('admits an unverified pack quarantined when the receipt is absent', () => {
            const decision = canAdmitToCatalog(makeSubject(), undefined);
            assert.strictEqual(decision.admitted, true);
            assert.strictEqual(decision.quarantined, true);
            assert.strictEqual(decision.status, 'unverified');
            assert.strictEqual(decision.decision, 'admitted-unverified-quarantined');
        });
        test('admits a verified pack unquarantined', () => {
            const decision = canAdmitToCatalog(makeSubject(), makeReceipt());
            assert.strictEqual(decision.admitted, true);
            assert.strictEqual(decision.quarantined, false);
            assert.strictEqual(decision.status, 'verified');
            assert.strictEqual(decision.decision, 'admitted-verified');
        });
        test('admits a verified-partial pack quarantined, naming the failed checks', () => {
            const receipt = receiptWith({ status: 'verified-partial', checks: [makeCheck('integrity', true), makeCheck('permissions', false)] });
            const decision = canAdmitToCatalog(makeSubject(), receipt);
            assert.strictEqual(decision.admitted, true);
            assert.strictEqual(decision.quarantined, true);
            assert.strictEqual(decision.status, 'verified-partial');
            assert.strictEqual(decision.decision, 'admitted-verified-partial-quarantined');
            assert.strictEqual(decision.message.includes('permissions'), true);
        });
        test('admits a verification-failed pack quarantined, carrying the named mismatches', () => {
            const receipt = receiptWith({ packId: 'flauz.pack.other', status: 'verification-failed' });
            const decision = canAdmitToCatalog(makeSubject(), receipt);
            assert.strictEqual(decision.admitted, true);
            assert.strictEqual(decision.quarantined, true);
            assert.strictEqual(decision.status, 'verification-failed');
            assert.strictEqual(decision.decision, 'admitted-verification-failed-quarantined');
            assert.deepStrictEqual(decision.mismatches.map((mismatch) => mismatch.kind), ['receipt-pack-id-mismatch']);
        });
        test('admitted and unquarantined exactly when the status is verified (invariant over the battery)', () => {
            for (const row of admissionBattery()) {
                const decision = canAdmitToCatalog(row.pack, row.receipt);
                if (decision.admitted && !decision.quarantined) {
                    assert.strictEqual(decision.status, 'verified', row.name);
                }
                if (decision.status === 'verified') {
                    assert.strictEqual(decision.admitted, true, row.name);
                    assert.strictEqual(decision.quarantined, false, row.name);
                }
                if (!decision.admitted) {
                    assert.strictEqual(decision.status, null, row.name);
                }
                if (decision.admitted) {
                    assert.strictEqual(decision.quarantined, decision.status !== 'verified', row.name);
                }
            }
        });
        test('a rejected admission never carries a status', () => {
            const rejected = [
                canAdmitToCatalog({ packId: 'x' }, null),
                canAdmitToCatalog(subjectWith({ contractVersion: '2.0.0' }), null),
                canAdmitToCatalog(makeSubject(), { status: 'verified' })
            ];
            for (const decision of rejected) {
                assert.strictEqual(decision.admitted, false);
                assert.strictEqual(decision.quarantined, false);
                assert.strictEqual(decision.status, null);
            }
        });
    });

    suite('admission agreement with the derived-status law', () => {
        test('the admission status is the derived status whenever a receipt is present', () => {
            for (const row of admissionBattery()) {
                const decision = canAdmitToCatalog(row.pack, row.receipt);
                if (!decision.admitted) {
                    continue;  // a rejected admission never carries a status (pinned above)
                }
                if (row.receipt === null || row.receipt === undefined) {
                    assert.strictEqual(decision.status, 'unverified', row.name);
                    continue;
                }
                const derivation = verificationStatusFor(row.pack, row.receipt);
                assert.strictEqual(decision.status, derivation.status, row.name);
            }
        });
    });
});
