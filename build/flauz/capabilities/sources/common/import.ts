/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// ZC-007 - external capability-source adapter contracts (Phase C, TL-B lane).
// Module 3 of 3: import records, the import state machine, fail-closed
// admission and the Flauz-owned ImportedEntry.
// Contract set version: SOURCE_ADAPTERS_CONTRACTS_VERSION 1.0.0.
// ---------------------------------------------------------------------------
//
// DETERMINISM LAW: no Math.random, no Date.now, no new Date(...) may be used
// in this module. All timestamps are plain ISO-8601 strings supplied by
// callers. This module contains pure types, constants and functions only.
//
// ZERO-DEPENDENCY LAW: this contract module contains no import statements,
// mirroring build/flauz/lab/common/labContracts.ts. Shapes shared with the
// sibling modules are duplicated verbatim there; the test suites cross-pin
// the copies so drift fails.
//
// AUTHORITY LAW (ARCHITECTURE-LOCK section 11): imported entries become
// Flauz-owned records with hashes, licenses, declared permissions/endpoints
// and verification status. Verification is Flauz's own gate (the ZC-006
// receipt path), NEVER the source's claim: an imported entry ALWAYS enters
// as 'unverified'. External sources are replaceable import sources only;
// they never verify, execute or rank.
//
// FAIL-CLOSED ADMISSION LAW: canImport rejects with the violation named for
// a missing license (missing-license), a missing artifact digest
// (missing-artifact-digest) or out-of-table permissions
// (permission-out-of-table); invalid-artifact is the defensive structural
// disclosure so that garbage never passes and never crashes the guard.
// Admission check order is fixed: invalid-artifact, missing-license,
// missing-artifact-digest, permission-out-of-table.
//
// RECORD LAW: every persisted record carries scope: SourceScope and
// contractVersion: string, with plain-string ISO-8601 timestamps.

export const SOURCE_ADAPTERS_CONTRACTS_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// VERBATIM PROJECTION from ./source.ts (scope shape, ISO timestamp shape).
// ./source.ts is the authority; test suites cross-pin the copies.
// ---------------------------------------------------------------------------

export interface SourceScope {
    workspaceId: string;
    tenantId: string;
}

export function isSourceScope(value: unknown): value is SourceScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.workspaceId === 'string' &&
        typeof candidate.tenantId === 'string'
    );
}

export const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// SEAM(zc006-permission-table) - TWIN COPY B of 2 (this file and
// common/adapter.ts).
// The ZC-006 wave owns the frozen permission-table vocabulary
// (build/flauz/capabilities/packs/** at dispatch time; in flight and not
// readable from this lane). DO NOT fabricate authority values: the list below
// is an EXPLICIT PLACEHOLDER.
// TRANSCRIPTION INSTRUCTION (harvest time): copy the frozen permission-table
// list VERBATIM from the ZC-006 authority - same identifiers, same order,
// same casing - into CAPABILITY_PERMISSIONS here AND into the twin copy in
// common/adapter.ts, keeping both identical. Keep the exported names
// CAPABILITY_PERMISSIONS, CapabilityPermission and isCapabilityPermission
// unchanged. The tests use CAPABILITY_PERMISSIONS[0] for in-table cases (they
// are seam-agnostic and keep passing); do not add tests that pin the
// placeholder VALUES - after transcription, pin the authority verbatim per
// house law. test/common/adapter.test.ts cross-pins the twin copies.
// ---------------------------------------------------------------------------

export const CAPABILITY_PERMISSIONS = [
    'read-files',
    'execute-command',
    'network-access',
    'write-workspace'
] as const;

export type CapabilityPermission = (typeof CAPABILITY_PERMISSIONS)[number];

export function isCapabilityPermission(value: unknown): value is CapabilityPermission {
    return (
        typeof value === 'string' &&
        (CAPABILITY_PERMISSIONS as readonly string[]).includes(value)
    );
}

// ---------------------------------------------------------------------------
// SEAM(zc006-verification-statuses): CLOSED 2026-10-05 — the vocabulary below is
// transcribed VERBATIM from the landed ZC-006 authority (common/verification.ts
// VERIFICATION_STATUSES); imported entries still ALWAYS enter as 'unverified'
// (the original pin, kept by the entry-status law in makeImportedEntry). The
// original seam instruction was: this wave pins ONLY 'unverified' - the
// status every imported entry ENTERS with, by the authority law. The ZC-006
// receipt path owns verification transitions; this wave must not fabricate
// statuses it cannot read from the authority. When the receipt-path authority
// lands, transcribe its verification-status vocabulary VERBATIM here (same
// identifiers, order, casing), keeping 'unverified' as the entry status, and
// keep test/common/import.test.ts asserting that entries enter as
// 'unverified'.
// ---------------------------------------------------------------------------

export const IMPORTED_ENTRY_VERIFICATION_STATUSES = [
    'unverified',
    'verified',
    'verified-partial',
    'verification-failed'
] as const;

export type ImportedEntryVerificationStatus = (typeof IMPORTED_ENTRY_VERIFICATION_STATUSES)[number];

export function isImportedEntryVerificationStatus(
    value: unknown
): value is ImportedEntryVerificationStatus {
    return (
        typeof value === 'string' &&
        (IMPORTED_ENTRY_VERIFICATION_STATUSES as readonly string[]).includes(value)
    );
}

// Structural projection of the DiscoveredArtifact contract from ./adapter.ts.
// declaredPermissions is deliberately the loose readonly string[] here:
// canImport is the fail-closed runtime gate that enforces the frozen
// permission table on untrusted data. An adapter.ts DiscoveredArtifact is
// assignable to this shape; pinned at the type level by the test suite.
export interface ImportCandidateArtifact {
    scope: SourceScope;
    contractVersion: string;
    artifactId: string;
    sourceDescriptorRef: string;
    artifactDigest: string;
    licenseSpdxId: string;
    declaredPermissions: readonly string[];
    declaredEndpoints: readonly string[];
    rawMetadataDigest: string;
}

export function isImportCandidateArtifact(value: unknown): value is ImportCandidateArtifact {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.artifactId === 'string' &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.artifactDigest === 'string' &&
        typeof candidate.licenseSpdxId === 'string' &&
        typeof candidate.rawMetadataDigest === 'string' &&
        Array.isArray(candidate.declaredPermissions) &&
        (candidate.declaredPermissions as unknown[]).every(
            (permission) => typeof permission === 'string'
        ) &&
        Array.isArray(candidate.declaredEndpoints) &&
        (candidate.declaredEndpoints as unknown[]).every(
            (endpoint) => typeof endpoint === 'string'
        )
    );
}

// ---------------------------------------------------------------------------
// The import state machine: discovered -> fetched -> normalized -> registered.
// Forward transitions only; every transition is evidence-bearing (at least
// one non-empty digest).
// ---------------------------------------------------------------------------

export const IMPORT_STATES = ['discovered', 'fetched', 'normalized', 'registered'] as const;

export type ImportState = (typeof IMPORT_STATES)[number];

export function isImportState(value: unknown): value is ImportState {
    return (
        typeof value === 'string' &&
        (IMPORT_STATES as readonly string[]).includes(value)
    );
}

export const IMPORT_TRANSITION_KINDS = ['fetch', 'normalize', 'register'] as const;

export type ImportTransitionKind = (typeof IMPORT_TRANSITION_KINDS)[number];

export function isImportTransitionKind(value: unknown): value is ImportTransitionKind {
    return (
        typeof value === 'string' &&
        (IMPORT_TRANSITION_KINDS as readonly string[]).includes(value)
    );
}

export interface ImportTransitionEdge {
    kind: ImportTransitionKind;
    fromState: ImportState;
    toState: ImportState;
}

export const IMPORT_TRANSITION_EDGES: readonly ImportTransitionEdge[] = [
    { kind: 'fetch', fromState: 'discovered', toState: 'fetched' },
    { kind: 'normalize', fromState: 'fetched', toState: 'normalized' },
    { kind: 'register', fromState: 'normalized', toState: 'registered' }
];

export const IMPORT_TRANSITIONS: Readonly<Record<ImportState, readonly ImportState[]>> = {
    discovered: ['fetched'],
    fetched: ['normalized'],
    normalized: ['registered'],
    registered: []
};

export function isForwardImportTransition(fromState: ImportState, toState: ImportState): boolean {
    return IMPORT_TRANSITIONS[fromState].includes(toState);
}

// Evidence for one state transition. Stamped by the record law; the kind, the
// edge it traverses and the evidence digests are validated together.
export interface ImportTransitionEvidence {
    scope: SourceScope;
    contractVersion: string;
    importId: string;
    kind: ImportTransitionKind;
    fromState: ImportState;
    toState: ImportState;
    atIso: string;
    evidenceDigests: readonly string[];
}

export function isImportTransitionEvidence(value: unknown): value is ImportTransitionEvidence {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        typeof candidate.importId !== 'string' ||
        !isImportTransitionKind(candidate.kind) ||
        !isImportState(candidate.fromState) ||
        !isImportState(candidate.toState) ||
        !isIsoTimestamp(candidate.atIso) ||
        !Array.isArray(candidate.evidenceDigests) ||
        !(candidate.evidenceDigests as unknown[]).every(
            (digest) => typeof digest === 'string' && digest.length > 0
        )
    ) {
        return false;
    }
    const edge = IMPORT_TRANSITION_EDGES.find(
        (candidateEdge) => candidateEdge.kind === candidate.kind
    );
    if (edge === undefined) {
        return false;
    }
    return edge.fromState === candidate.fromState && edge.toState === candidate.toState;
}

// The import record. state and transitions are the state-machine projection
// of the same record: it is created in 'discovered' and advances
// forward-only, appending evidence-bearing transitions.
export interface ImportRecord {
    scope: SourceScope;
    contractVersion: string;
    importId: string;
    sourceDescriptorRef: string;
    adapterDescriptorRef: string;
    importedAtIso: string;
    state: ImportState;
    transitions: readonly ImportTransitionEvidence[];
}

export function isImportRecord(value: unknown): value is ImportRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        isSourceScope(candidate.scope) &&
        typeof candidate.contractVersion === 'string' &&
        typeof candidate.importId === 'string' &&
        candidate.importId.length > 0 &&
        typeof candidate.sourceDescriptorRef === 'string' &&
        typeof candidate.adapterDescriptorRef === 'string' &&
        isIsoTimestamp(candidate.importedAtIso) &&
        isImportState(candidate.state) &&
        Array.isArray(candidate.transitions) &&
        (candidate.transitions as unknown[]).every((entry) => isImportTransitionEvidence(entry))
    );
}

export type CreateImportRecordResult =
    | { outcome: 'created'; record: ImportRecord }
    | { outcome: 'invalid-scope' }
    | { outcome: 'invalid-import-id' }
    | { outcome: 'invalid-source-ref' }
    | { outcome: 'invalid-adapter-ref' }
    | { outcome: 'invalid-timestamp' };

// createImportRecord: lawful creation. The record enters in 'discovered'
// with an empty transition log, stamped with the current contract version.
// Check order is fixed: invalid-scope, invalid-import-id, invalid-source-ref,
// invalid-adapter-ref, invalid-timestamp, created.
export function createImportRecord(
    scope: SourceScope,
    importId: string,
    sourceDescriptorRef: string,
    adapterDescriptorRef: string,
    importedAtIso: string
): CreateImportRecordResult {
    if (!isSourceScope(scope)) {
        return { outcome: 'invalid-scope' };
    }
    if (typeof importId !== 'string' || importId.length === 0) {
        return { outcome: 'invalid-import-id' };
    }
    if (typeof sourceDescriptorRef !== 'string' || sourceDescriptorRef.length === 0) {
        return { outcome: 'invalid-source-ref' };
    }
    if (typeof adapterDescriptorRef !== 'string' || adapterDescriptorRef.length === 0) {
        return { outcome: 'invalid-adapter-ref' };
    }
    if (!isIsoTimestamp(importedAtIso)) {
        return { outcome: 'invalid-timestamp' };
    }
    return {
        outcome: 'created',
        record: {
            scope,
            contractVersion: SOURCE_ADAPTERS_CONTRACTS_VERSION,
            importId,
            sourceDescriptorRef,
            adapterDescriptorRef,
            importedAtIso,
            state: 'discovered',
            transitions: []
        }
    };
}

export interface ImportTransitionInput {
    kind: ImportTransitionKind;
    atIso: string;
    evidenceDigests: readonly string[];
}

export type AdvanceImportResult =
    | { outcome: 'advanced'; record: ImportRecord; transition: ImportTransitionEvidence }
    | { outcome: 'unknown-transition-kind'; record: ImportRecord }
    | { outcome: 'terminal-state'; record: ImportRecord }
    | { outcome: 'state-mismatch'; record: ImportRecord; expectedFrom: ImportState; foundFrom: ImportState }
    | { outcome: 'empty-evidence'; record: ImportRecord }
    | { outcome: 'invalid-timestamp'; record: ImportRecord }
    | { outcome: 'invalid-record'; record: ImportRecord };

// advanceImport: the forward-only, evidence-bearing transition applicator.
// The kind determines the edge; the record's state must be the edge's
// fromState; the evidence digests must be present and non-empty. Check order
// is fixed: invalid-record, unknown-transition-kind (also the disclosure for
// a missing or non-object input, since there is no valid kind to name),
// invalid-timestamp, terminal-state, state-mismatch, empty-evidence,
// advanced. The transition log is append-only.
export function advanceImport(
    record: ImportRecord,
    input: ImportTransitionInput
): AdvanceImportResult {
    if (!isImportRecord(record)) {
        return { outcome: 'invalid-record', record };
    }
    if (typeof input !== 'object' || input === null) {
        return { outcome: 'unknown-transition-kind', record };
    }
    const edge = IMPORT_TRANSITION_EDGES.find((candidate) => candidate.kind === input.kind);
    if (edge === undefined) {
        return { outcome: 'unknown-transition-kind', record };
    }
    if (!isIsoTimestamp(input.atIso)) {
        return { outcome: 'invalid-timestamp', record };
    }
    if (record.state === 'registered') {
        return { outcome: 'terminal-state', record };
    }
    if (record.state !== edge.fromState) {
        return {
            outcome: 'state-mismatch',
            record,
            expectedFrom: edge.fromState,
            foundFrom: record.state
        };
    }
    if (
        !Array.isArray(input.evidenceDigests) ||
        input.evidenceDigests.length === 0 ||
        input.evidenceDigests.some(
            (digest) => typeof digest !== 'string' || digest.length === 0
        )
    ) {
        return { outcome: 'empty-evidence', record };
    }
    const transition: ImportTransitionEvidence = {
        scope: record.scope,
        contractVersion: record.contractVersion,
        importId: record.importId,
        kind: edge.kind,
        fromState: edge.fromState,
        toState: edge.toState,
        atIso: input.atIso,
        evidenceDigests: [...input.evidenceDigests]
    };
    return {
        outcome: 'advanced',
        record: {
            ...record,
            state: edge.toState,
            transitions: [...record.transitions, transition]
        },
        transition
    };
}

// importTransitionsEqual: pure, order-sensitive, digest-sensitive structural
// comparison of two transition logs.
export function importTransitionsEqual(
    a: readonly ImportTransitionEvidence[],
    b: readonly ImportTransitionEvidence[]
): boolean {
    return (
        a.length === b.length &&
        a.every((left, index) => {
            const right = b[index];
            return (
                left.importId === right.importId &&
                left.kind === right.kind &&
                left.fromState === right.fromState &&
                left.toState === right.toState &&
                left.atIso === right.atIso &&
                left.contractVersion === right.contractVersion &&
                sameScope(left.scope, right.scope) &&
                digestsEqual(left.evidenceDigests, right.evidenceDigests)
            );
        })
    );
}

export type ImportAdmissionViolation =
    | { violation: 'invalid-artifact' }
    | { violation: 'missing-license' }
    | { violation: 'missing-artifact-digest' }
    | { violation: 'permission-out-of-table'; permissions: readonly string[] };

export type ImportAdmission =
    | { admission: 'admitted' }
    | { admission: 'rejected'; violation: ImportAdmissionViolation };

// canImport: THE fail-closed admission guard. The law-named violations are
// missing-license, missing-artifact-digest and permission-out-of-table (the
// offending permissions are named in the rejection); invalid-artifact is the
// defensive structural disclosure. An empty declared-permission set claims
// nothing and is admissible. The check order is fixed and part of the
// contract.
export function canImport(discovered: ImportCandidateArtifact): ImportAdmission {
    if (!isImportCandidateArtifact(discovered)) {
        return {
            admission: 'rejected',
            violation: { violation: 'invalid-artifact' }
        };
    }
    if (isMissingValue(discovered.licenseSpdxId)) {
        return {
            admission: 'rejected',
            violation: { violation: 'missing-license' }
        };
    }
    if (isMissingValue(discovered.artifactDigest)) {
        return {
            admission: 'rejected',
            violation: { violation: 'missing-artifact-digest' }
        };
    }
    const outOfTable = discovered.declaredPermissions.filter(
        (permission) => !isCapabilityPermission(permission)
    );
    if (outOfTable.length > 0) {
        return {
            admission: 'rejected',
            violation: { violation: 'permission-out-of-table', permissions: outOfTable }
        };
    }
    return { admission: 'admitted' };
}

// Provenance of an imported entry: the source and adapter ids plus the
// digests that identify what was imported. A singular embedded value, it
// rides inside its stamped parent record.
export interface ImportedEntryProvenance {
    sourceId: string;
    adapterId: string;
    artifactDigest: string;
    rawMetadataDigest: string;
}

export function isImportedEntryProvenance(value: unknown): value is ImportedEntryProvenance {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.sourceId === 'string' &&
        candidate.sourceId.length > 0 &&
        typeof candidate.adapterId === 'string' &&
        candidate.adapterId.length > 0 &&
        typeof candidate.artifactDigest === 'string' &&
        candidate.artifactDigest.length > 0 &&
        typeof candidate.rawMetadataDigest === 'string' &&
        candidate.rawMetadataDigest.length > 0
    );
}

// The FLAUZ-OWNED record the import produces. verificationStatus ALWAYS
// enters as 'unverified' (authority law): verification is Flauz's own gate
// (the ZC-006 receipt path), never the source's claim.
export interface ImportedEntry {
    scope: SourceScope;
    contractVersion: string;
    entryId: string;
    artifactDigest: string;
    licenseSpdxId: string;
    licenseDigest: string;
    declaredPermissions: readonly CapabilityPermission[];
    declaredEndpoints: readonly string[];
    verificationStatus: ImportedEntryVerificationStatus;
    provenance: ImportedEntryProvenance;
    registeredAtIso: string;
}

export function isImportedEntry(value: unknown): value is ImportedEntry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    if (
        !isSourceScope(candidate.scope) ||
        typeof candidate.contractVersion !== 'string' ||
        typeof candidate.entryId !== 'string' ||
        candidate.entryId.length <= 0 ||
        typeof candidate.artifactDigest !== 'string' ||
        typeof candidate.licenseSpdxId !== 'string' ||
        typeof candidate.licenseDigest !== 'string' ||
        !isImportedEntryVerificationStatus(candidate.verificationStatus) ||
        !isImportedEntryProvenance(candidate.provenance) ||
        !isIsoTimestamp(candidate.registeredAtIso) ||
        !Array.isArray(candidate.declaredEndpoints) ||
        !(candidate.declaredEndpoints as unknown[]).every(
            (endpoint) => typeof endpoint === 'string'
        )
    ) {
        return false;
    }
    return (
        Array.isArray(candidate.declaredPermissions) &&
        (candidate.declaredPermissions as unknown[]).every((permission) =>
            isCapabilityPermission(permission)
        )
    );
}

export type MakeImportedEntryResult =
    | { outcome: 'created'; entry: ImportedEntry }
    | { outcome: 'rejected'; violation: ImportAdmissionViolation }
    | { outcome: 'invalid-entry-id' }
    | { outcome: 'invalid-provenance' }
    | { outcome: 'missing-license-digest' }
    | { outcome: 'invalid-timestamp' };

// makeImportedEntry: the only lawful creation point of a Flauz-owned entry.
// Admission is checked FIRST (the authority law leads): a rejected artifact
// never produces an entry. The provenance must be well-formed AND coherent
// with the admitted artifact (same artifactDigest and rawMetadataDigest).
// Flauz-owned records carry hashes by law, so the license digest is required.
// The entry is re-stamped at the current contract version: it is a NEW
// Flauz-owned record, not a copy of the source's claim. Check order is
// fixed: admission, invalid-entry-id, invalid-provenance,
// missing-license-digest, invalid-timestamp, created.
export function makeImportedEntry(
    discovered: ImportCandidateArtifact,
    provenance: ImportedEntryProvenance,
    entryId: string,
    licenseDigest: string,
    registeredAtIso: string
): MakeImportedEntryResult {
    const admission = canImport(discovered);
    if (admission.admission === 'rejected') {
        return { outcome: 'rejected', violation: admission.violation };
    }
    if (typeof entryId !== 'string' || entryId.length === 0) {
        return { outcome: 'invalid-entry-id' };
    }
    if (
        !isImportedEntryProvenance(provenance) ||
        provenance.artifactDigest !== discovered.artifactDigest ||
        provenance.rawMetadataDigest !== discovered.rawMetadataDigest
    ) {
        return { outcome: 'invalid-provenance' };
    }
    if (isMissingValue(licenseDigest)) {
        return { outcome: 'missing-license-digest' };
    }
    if (!isIsoTimestamp(registeredAtIso)) {
        return { outcome: 'invalid-timestamp' };
    }
    return {
        outcome: 'created',
        entry: {
            scope: discovered.scope,
            contractVersion: SOURCE_ADAPTERS_CONTRACTS_VERSION,
            entryId,
            artifactDigest: discovered.artifactDigest,
            licenseSpdxId: discovered.licenseSpdxId,
            licenseDigest,
            // The cast is lawful here: canImport has just proven every
            // declared permission in-table.
            declaredPermissions: [...discovered.declaredPermissions] as readonly CapabilityPermission[],
            declaredEndpoints: [...discovered.declaredEndpoints],
            // AUTHORITY LAW: every imported entry enters as 'unverified'.
            // Verification is Flauz's own gate (the ZC-006 receipt path),
            // never the source's claim. This field is deliberately not a
            // parameter of this function.
            verificationStatus: 'unverified',
            provenance,
            registeredAtIso
        }
    };
}

function isMissingValue(value: string): boolean {
    return value.trim().length === 0;
}

function sameScope(a: SourceScope, b: SourceScope): boolean {
    return a.workspaceId === b.workspaceId && a.tenantId === b.tenantId;
}

function digestsEqual(a: readonly string[], b: readonly string[]): boolean {
    return (
        a.length === b.length &&
        a.every((digest, index) => digest === b[index])
    );
}
