/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ZC-006 -- the verification contract (Phase C, TL-B partition B2).
//
// Verification is the authority gate: a catalog entry never changes its
// verification status without a matching verification receipt, and every
// mismatch is a NAMED failure, never silent. This module owns the frozen
// verification vocabulary, the receipt record, the derived-status law
// (verificationStatusFor) and the fail-closed admission guard
// (canAdmitToCatalog). It is a description surface: no runtime verifier.
//
// Zero-dependency law (labContracts discipline): this module declares no module
// dependencies of any kind. PackScope is a pinned mirror of pack.ts and is
// pinned structurally equal by the cross-module tests.
//
// Determinism law: this module is pure and clock-free. It contains no
// Math.random, no Date.now and no new Date() invocation; the only occurrences
// of those tokens are inside this law comment. Every timestamp on every record
// is a plain ISO-8601 string supplied by the caller.
//
// Record law: every persisted record carries scope: PackScope and
// contractVersion: string.

export const CAPABILITY_PACKS_CONTRACTS_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Module-local shape helpers.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

const SHA256_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PACK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isSha256Digest(value: unknown): value is string {
    return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

function isSemverString(value: unknown): value is string {
    return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

function isPackIdString(value: unknown): value is string {
    return typeof value === 'string' && PACK_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Scope: pinned mirror of pack.ts's PackScope. The zero-import law forbids
// sharing the declaration through an import; the cross-module tests pin both
// declarations structurally equal.
// ---------------------------------------------------------------------------

export interface PackScope {
    workspaceId: string;
    tenantId: string;
}

export function isPackScope(value: unknown): value is PackScope {
    if (!isPlainObject(value)) {
        return false;
    }
    return isNonEmptyString(value.workspaceId) && isNonEmptyString(value.tenantId);
}

// ---------------------------------------------------------------------------
// The frozen verification vocabulary.
// ---------------------------------------------------------------------------

export const VERIFICATION_STATUSES = ['unverified', 'verified', 'verified-partial', 'verification-failed'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export function isVerificationStatus(value: unknown): value is VerificationStatus {
    return typeof value === 'string' && (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Checks and receipts.
// ---------------------------------------------------------------------------

export interface VerificationCheck {
    name: string;
    passed: boolean;
    evidenceDigest: string;
}

export function isVerificationCheck(value: unknown): value is VerificationCheck {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isNonEmptyString(value.name) &&
        typeof value.passed === 'boolean' &&
        isSha256Digest(value.evidenceDigest)
    );
}

export interface VerificationReceipt {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
    status: VerificationStatus;
    checks: readonly VerificationCheck[];
}

export const VERIFICATION_RECEIPT_REJECTION_CODES = [
    'receipt-malformed',
    'receipt-scope-invalid',
    'receipt-contract-version-mismatch',
    'receipt-pack-id-invalid',
    'receipt-version-invalid',
    'receipt-status-unknown',
    'receipt-checks-invalid'
] as const;
export type VerificationReceiptRejectionCode = (typeof VERIFICATION_RECEIPT_REJECTION_CODES)[number];

export interface VerificationReceiptRejection {
    ok: false;
    code: VerificationReceiptRejectionCode;
    message: string;
}

export type VerificationReceiptValidationResult =
    | { ok: true; receipt: VerificationReceipt }
    | VerificationReceiptRejection;

export function isVerificationReceiptRejectionCode(value: unknown): value is VerificationReceiptRejectionCode {
    return typeof value === 'string' && (VERIFICATION_RECEIPT_REJECTION_CODES as readonly string[]).includes(value);
}

function receiptRejection(code: VerificationReceiptRejectionCode, message: string): VerificationReceiptRejection {
    return { ok: false, code, message };
}

/**
 * Structural validation of a receipt. An empty checks list is STRUCTURALLY
 * valid here: the derived-status law (verificationStatusFor) is what fails it
 * closed ('receipt-checks-empty') -- a receipt with no checks proves nothing.
 */
export function validateVerificationReceipt(value: unknown): VerificationReceiptValidationResult {
    if (!isPlainObject(value)) {
        return receiptRejection('receipt-malformed', 'a verification receipt must be a plain object');
    }
    if (!isPackScope(value.scope)) {
        return receiptRejection('receipt-scope-invalid', 'scope must carry non-empty workspaceId and tenantId strings');
    }
    if (value.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return receiptRejection('receipt-contract-version-mismatch', `contractVersion must be '${CAPABILITY_PACKS_CONTRACTS_VERSION}'`);
    }
    if (!isPackIdString(value.packId)) {
        return receiptRejection('receipt-pack-id-invalid', 'packId must match the pack id pattern');
    }
    if (!isSemverString(value.version)) {
        return receiptRejection('receipt-version-invalid', 'version must be a semver-shaped plain string');
    }
    if (!isVerificationStatus(value.status)) {
        return receiptRejection('receipt-status-unknown', 'status must be one of the frozen verification statuses');
    }
    const checks = value.checks;
    if (!Array.isArray(checks)) {
        return receiptRejection('receipt-checks-invalid', 'checks must be an array of verification checks');
    }
    const seen: Set<string> = new Set();
    for (const check of checks) {
        if (!isVerificationCheck(check)) {
            return receiptRejection('receipt-checks-invalid', 'each check needs a non-empty name, a passed boolean and a sha-256 shaped evidenceDigest');
        }
        if (seen.has(check.name)) {
            return receiptRejection('receipt-checks-invalid', `check name '${check.name}' appears more than once`);
        }
        seen.add(check.name);
    }
    return { ok: true, receipt: value as unknown as VerificationReceipt };
}

export function isVerificationReceipt(value: unknown): value is VerificationReceipt {
    return validateVerificationReceipt(value).ok;
}

// ---------------------------------------------------------------------------
// The verification subject: the minimal structural projection of a
// CapabilityPack that verification consumes (pack.ts's full record is
// structurally assignable to it; pinned by the cross-module tests).
// ---------------------------------------------------------------------------

export interface VerificationSubject {
    scope: PackScope;
    contractVersion: string;
    packId: string;
    version: string;
}

export function isVerificationSubject(value: unknown): value is VerificationSubject {
    if (!isPlainObject(value)) {
        return false;
    }
    return (
        isPackScope(value.scope) &&
        isNonEmptyString(value.contractVersion) &&
        isPackIdString(value.packId) &&
        isSemverString(value.version)
    );
}

// ---------------------------------------------------------------------------
// Named mismatches. Every failure of the derived-status law is one of these;
// nothing is ever silent.
//
// The mismatch-kind strings in catalog.ts's mirror are VERBATIM copies of
// these; the cross-module tests pin both lists set-equal.
// ---------------------------------------------------------------------------

export const VERIFICATION_MISMATCH_KINDS = [
    'verification-subject-malformed',
    'verification-receipt-malformed',
    'receipt-scope-mismatch',
    'receipt-contract-version-mismatch',
    'receipt-pack-id-mismatch',
    'receipt-version-mismatch',
    'receipt-checks-empty',
    'receipt-status-claim-mismatch'
] as const;
export type VerificationMismatchKind = (typeof VERIFICATION_MISMATCH_KINDS)[number];

export interface VerificationMismatch {
    kind: VerificationMismatchKind;
    expected: string;
    actual: string;
    message: string;
}

export function isVerificationMismatchKind(value: unknown): value is VerificationMismatchKind {
    return typeof value === 'string' && (VERIFICATION_MISMATCH_KINDS as readonly string[]).includes(value);
}

function verificationMismatch(kind: VerificationMismatchKind, expected: string, actual: string, message: string): VerificationMismatch {
    return { kind, expected, actual, message };
}

// ---------------------------------------------------------------------------
// The derived-status law.
// ---------------------------------------------------------------------------

export interface VerificationOutcome {
    status: VerificationStatus;
    claimedStatus: VerificationStatus | null;
    mismatches: readonly VerificationMismatch[];
    passedCheckNames: readonly string[];
    failedCheckNames: readonly string[];
}

/**
 * The derived-status law. The receipt's `status` field is a CLAIM; this
 * function derives the status from the evidence and fails closed on any
 * disagreement between claim and evidence (a receipt may never assert more,
 * or less, than its checks prove).
 *
 * - every declared check passed AND the receipt matches the subject exactly
 *   (scope, contractVersion, packId, version) AND the receipt carries at least
 *   one check AND the claim agrees  ->  'verified'
 * - some declared checks failed (with the identity matched and the claim in
 *   agreement)  ->  'verified-partial', carrying the failed check names
 * - any mismatch (malformed subject or receipt, scope, contractVersion, packId,
 *   version, an evidence-less receipt, or a claim that disagrees with the
 *   evidence)  ->  'verification-failed', every mismatch named
 *
 * 'unverified' is never derived here: it is the no-receipt admission state
 * (see canAdmitToCatalog). Deterministic: same inputs, same output.
 */
export function verificationStatusFor(pack: unknown, receipt: unknown): VerificationOutcome {
    if (!isVerificationSubject(pack)) {
        return {
            status: 'verification-failed',
            claimedStatus: null,
            mismatches: [
                verificationMismatch('verification-subject-malformed', 'a verification subject', 'a malformed value', 'the verification subject must carry scope, contractVersion, packId and version')
            ],
            passedCheckNames: [],
            failedCheckNames: []
        };
    }
    if (!isVerificationReceipt(receipt)) {
        return {
            status: 'verification-failed',
            claimedStatus: null,
            mismatches: [
                verificationMismatch('verification-receipt-malformed', 'a verification receipt', 'a malformed value', 'the verification receipt must pass validateVerificationReceipt')
            ],
            passedCheckNames: [],
            failedCheckNames: []
        };
    }
    const subject = pack;
    const rcpt = receipt;
    const mismatches: VerificationMismatch[] = [];
    if (subject.scope.workspaceId !== rcpt.scope.workspaceId || subject.scope.tenantId !== rcpt.scope.tenantId) {
        mismatches.push(verificationMismatch('receipt-scope-mismatch', `${subject.scope.workspaceId}/${subject.scope.tenantId}`, `${rcpt.scope.workspaceId}/${rcpt.scope.tenantId}`, 'the receipt was issued for a different scope'));
    }
    if (subject.contractVersion !== rcpt.contractVersion) {
        mismatches.push(verificationMismatch('receipt-contract-version-mismatch', subject.contractVersion, rcpt.contractVersion, 'the receipt was issued for a different contract version'));
    }
    if (subject.packId !== rcpt.packId) {
        mismatches.push(verificationMismatch('receipt-pack-id-mismatch', subject.packId, rcpt.packId, 'the receipt was issued for a different pack'));
    }
    if (subject.version !== rcpt.version) {
        mismatches.push(verificationMismatch('receipt-version-mismatch', subject.version, rcpt.version, 'the receipt was issued for a different pack version'));
    }
    const passedCheckNames: string[] = [];
    const failedCheckNames: string[] = [];
    for (const check of rcpt.checks) {
        if (check.passed) {
            passedCheckNames.push(check.name);
        } else {
            failedCheckNames.push(check.name);
        }
    }
    if (rcpt.checks.length === 0) {
        mismatches.push(verificationMismatch('receipt-checks-empty', 'at least one check', '0 checks', 'a receipt with no checks proves nothing'));
    }
    let status: VerificationStatus;
    if (mismatches.length > 0) {
        status = 'verification-failed';
    } else if (failedCheckNames.length === 0) {
        status = 'verified';
    } else {
        status = 'verified-partial';
    }
    if (rcpt.status !== status) {
        mismatches.push(verificationMismatch('receipt-status-claim-mismatch', status, rcpt.status, `the receipt claims '${rcpt.status}' but its evidence derives '${status}'`));
        status = 'verification-failed';
    }
    return { status, claimedStatus: rcpt.status, mismatches, passedCheckNames, failedCheckNames };
}

/**
 * Quarantine law: every status except 'verified' is a quarantined status.
 * Invariant (tested): a pack is admitted and NOT quarantined if and only if
 * its derived status is 'verified'.
 */
export function isQuarantinedVerificationStatus(status: VerificationStatus): boolean {
    return status !== 'verified';
}

// ---------------------------------------------------------------------------
// The fail-closed admission guard.
//
// Fail-closed means: the guard never yields an unquarantined admission without
// a matching receipt proving 'verified'. It rejects only MALFORMED inputs
// (a pack that is not even a verification subject, or a receipt that fails
// structural validation). A well-formed receipt that does not match the pack
// does NOT block registration: the pack is admitted quarantined, carrying the
// derived 'verification-failed' status with the mismatch named in the
// derivation -- the catalog records the truth, it never silently upgrades it.
// ---------------------------------------------------------------------------

export const CATALOG_ADMISSION_DECISIONS = [
    'admission-rejected-pack-malformed',
    'admission-rejected-pack-contract-version-mismatch',
    'admission-rejected-receipt-malformed',
    'admitted-unverified-quarantined',
    'admitted-verified',
    'admitted-verified-partial-quarantined',
    'admitted-verification-failed-quarantined'
] as const;
export type CatalogAdmissionDecisionKind = (typeof CATALOG_ADMISSION_DECISIONS)[number];

export interface CatalogAdmissionDecision {
    admitted: boolean;
    quarantined: boolean;
    status: VerificationStatus | null;
    decision: CatalogAdmissionDecisionKind;
    message: string;
    mismatches: readonly VerificationMismatch[];
}

export function isCatalogAdmissionDecisionKind(value: unknown): value is CatalogAdmissionDecisionKind {
    return typeof value === 'string' && (CATALOG_ADMISSION_DECISIONS as readonly string[]).includes(value);
}

/**
 * The admission guard. Invariants (tested):
 *   admitted && !quarantined  <=>  status === 'verified'
 *   !admitted                 =>  status === null
 *   admitted                  =>  quarantined <=> status !== 'verified'
 * A null receipt admits the pack unverified and quarantined.
 */
export function canAdmitToCatalog(pack: unknown, receipt: unknown): CatalogAdmissionDecision {
    if (!isVerificationSubject(pack)) {
        return {
            admitted: false,
            quarantined: false,
            status: null,
            decision: 'admission-rejected-pack-malformed',
            message: 'the pack must carry scope, contractVersion, packId and version',
            mismatches: []
        };
    }
    if (pack.contractVersion !== CAPABILITY_PACKS_CONTRACTS_VERSION) {
        return {
            admitted: false,
            quarantined: false,
            status: null,
            decision: 'admission-rejected-pack-contract-version-mismatch',
            message: `the pack contractVersion must be '${CAPABILITY_PACKS_CONTRACTS_VERSION}'`,
            mismatches: []
        };
    }
    if (receipt === null || receipt === undefined) {
        return {
            admitted: true,
            quarantined: true,
            status: 'unverified',
            decision: 'admitted-unverified-quarantined',
            message: 'no receipt: the pack registers as unverified and is quarantined',
            mismatches: []
        };
    }
    const receiptValidation = validateVerificationReceipt(receipt);
    if (!receiptValidation.ok) {
        return {
            admitted: false,
            quarantined: false,
            status: null,
            decision: 'admission-rejected-receipt-malformed',
            message: `the receipt is not structurally valid: ${receiptValidation.message}`,
            mismatches: []
        };
    }
    const outcome = verificationStatusFor(pack, receipt);
    if (outcome.status === 'verified') {
        return {
            admitted: true,
            quarantined: false,
            status: 'verified',
            decision: 'admitted-verified',
            message: 'every declared check passed against a matching receipt',
            mismatches: []
        };
    }
    if (outcome.status === 'verified-partial') {
        return {
            admitted: true,
            quarantined: true,
            status: 'verified-partial',
            decision: 'admitted-verified-partial-quarantined',
            message: `failed checks: ${outcome.failedCheckNames.join(', ')}`,
            mismatches: []
        };
    }
    return {
        admitted: true,
        quarantined: true,
        status: 'verification-failed',
        decision: 'admitted-verification-failed-quarantined',
        message: `verification failed: ${outcome.mismatches.map((entry) => entry.kind).join(', ')}`,
        mismatches: outcome.mismatches
    };
}