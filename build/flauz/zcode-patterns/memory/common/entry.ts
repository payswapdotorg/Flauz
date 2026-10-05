
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Flauz ZC-005 - Scoped Persistent Agent Memory contracts (Phase C): memory entries.
 *
 * Part of the SCOPED_MEMORY_CONTRACTS_VERSION '1.0.0' contract set: the memory entry record
 * with provenance disclosure, the SECRET-EXCLUSION law at the admission boundary, and the
 * revision-append law.
 *
 * SUBORDINATION LAW: memory is subordinate to Workspace OS and tenant policy. Entries are
 * REQUEST/READ-MODEL records; the provenance vocabulary projects the flauz-agent task
 * surface. Admission does not re-derive enablement (it cannot import it under the
 * zero-import law): the caller authorizes the level with the enablement contract first.
 *
 * ZERO-IMPORT LAW: this module imports nothing (exactly like build/flauz/lab/common/
 * labContracts.ts). Shared foundations are restated locally; structural typing keeps the
 * restatements interchangeable with the sibling modules. See memory/README.md.
 *
 * DETERMINISM LAW: Math.random, Date.now, and new Date(...) are forbidden in this module; every timestamp
 * is a plain ISO-8601 UTC string supplied by the caller, and every exported function is a
 * pure mapping over its inputs.
 */

export const SCOPED_MEMORY_CONTRACTS_VERSION = '1.0.0';

/** The three frozen memory levels (as const; the union is derived, never hand-written). */
export const MEMORY_LEVELS = ['user', 'project', 'workspace'] as const;
export type MemoryLevel = (typeof MEMORY_LEVELS)[number];

export function isMemoryLevel(value: unknown): value is MemoryLevel {
    return typeof value === 'string' && (MEMORY_LEVELS as readonly string[]).includes(value);
}

/** The tenant/workspace anchor every persisted memory record carries. */
export interface MemoryRecordScope {
    readonly tenantId: string;
    readonly workspaceId: string;
}

export function isMemoryRecordScope(value: unknown): value is MemoryRecordScope {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { tenantId?: unknown; workspaceId?: unknown };
    return (
        typeof candidate.tenantId === 'string' &&
        candidate.tenantId.length > 0 &&
        typeof candidate.workspaceId === 'string' &&
        candidate.workspaceId.length > 0
    );
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** The timestamp law of this contract set: plain ISO-8601 UTC strings with a Z suffix. */
export function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value);
}

/*
 * Deterministic dependency-free digest: FNV-1a 32-bit over a length-prefixed canonical part
 * list, computed on two seeded lanes and rendered as 'fnv1a64:' + 16 hex characters. NOT
 * cryptographic: it pins integrity within this contract set (tamper-evidence for revisions,
 * bundles, and receipts), not adversarial security.
 */
const FNV1A_OFFSET_BASIS = 0x811c9dc5;
const FNV1A_PRIME = 0x01000193;

function fnv1a32Lane(input: string, seed: number): string {
    let hash = seed >>> 0;
    for (let index = 0; index < input.length; index++) {
        hash = (hash ^ input.charCodeAt(index)) >>> 0;
        hash = Math.imul(hash, FNV1A_PRIME) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function digestOf(...parts: string[]): string {
    let canonical = '';
    for (const part of parts) {
        canonical += `${part.length}:${part};`;
    }
    const laneA = fnv1a32Lane(canonical, FNV1A_OFFSET_BASIS);
    const laneB = fnv1a32Lane(canonical, (FNV1A_OFFSET_BASIS ^ 0x9e3779b9) >>> 0);
    return `fnv1a64:${laneA}${laneB}`;
}

const DIGEST_PATTERN = /^fnv1a64:[0-9a-f]{16}$/;

/** Pure shape guard for digests produced by digestOf. */
export function isDigest(value: unknown): value is string {
    return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/** The frozen entry kinds (as const; the union is derived, never hand-written). */
export const MEMORY_ENTRY_KINDS = ['fact', 'preference', 'procedure', 'reference'] as const;
export type MemoryEntryKind = (typeof MEMORY_ENTRY_KINDS)[number];

export function isMemoryEntryKind(value: unknown): value is MemoryEntryKind {
    return typeof value === 'string' && (MEMORY_ENTRY_KINDS as readonly string[]).includes(value);
}

/*
 * PROJECTION (read-only authority: extensions/flauz-agent/src/types.ts): the EvidenceKind
 * vocabulary of the flauz-agent task surface, re-declared here because contract modules
 * import nothing. Pinned by tests to the four frozen kinds.
 */
export const EVIDENCE_KINDS = ['changeset', 'screenshot', 'command-output', 'note'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(value: unknown): value is EvidenceKind {
    return typeof value === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(value);
}

export const MEMORY_PROVENANCE_ORIGINS = ['task-evidence', 'operator-entry', 'derived'] as const;
export type MemoryProvenanceOrigin = (typeof MEMORY_PROVENANCE_ORIGINS)[number];

/**
 * PROVENANCE DISCLOSURE LAW: nothing presents as original evidence that is not.
 * task-evidence entries cite the projected flauz-agent evidence vocabulary; operator-entry
 * entries are disclosed as manual; derived entries carry their derivation inputs' digests
 * and are disclosed as derived, never as original.
 */
export type MemoryProvenance =
    | {
            readonly origin: 'task-evidence';
            readonly evidenceKind: EvidenceKind;
            readonly evidenceRef: string;
            readonly capturedAtIso: string;
      }
    | {
            readonly origin: 'operator-entry';
            readonly capturedAtIso: string;
      }
    | {
            readonly origin: 'derived';
            readonly inputDigests: readonly string[];
            readonly capturedAtIso: string;
      };

export function isMemoryProvenance(value: unknown): value is MemoryProvenance {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        origin?: unknown;
        evidenceKind?: unknown;
        evidenceRef?: unknown;
        inputDigests?: unknown;
        capturedAtIso?: unknown;
    };
    if (typeof candidate.origin !== 'string' || !(MEMORY_PROVENANCE_ORIGINS as readonly string[]).includes(candidate.origin)) {
        return false;
    }
    if (!isIsoTimestamp(candidate.capturedAtIso)) {
        return false;
    }
    if (candidate.origin === 'task-evidence') {
        return isEvidenceKind(candidate.evidenceKind) && typeof candidate.evidenceRef === 'string' && candidate.evidenceRef.length > 0;
    }
    if (candidate.origin === 'derived') {
        if (!Array.isArray(candidate.inputDigests) || candidate.inputDigests.length === 0) {
            return false;
        }
        return candidate.inputDigests.every((digest) => typeof digest === 'string' && digest.length > 0);
    }
    return true;
}

/** Canonical digest input for a provenance record (derived input digests are order-canonicalized). */
export function provenanceDigestPart(provenance: MemoryProvenance): string {
    if (provenance.origin === 'task-evidence') {
        return `task-evidence:${provenance.evidenceKind}:${provenance.evidenceRef}`;
    }
    if (provenance.origin === 'operator-entry') {
        return 'operator-entry';
    }
    const inputDigests = provenance.inputDigests.slice().sort();
    return `derived:${inputDigests.join(',')}`;
}

/*
 * SECRET-EXCLUSION LAW (fail-closed): secret-shaped content is unrepresentable through the
 * admission guard. The pattern families are exported constants; detection reports only the
 * family and the pattern id and never echoes the matched text back; when in doubt the
 * detector over-matches rather than under-matches. No pattern carries the stateful global
 * flag (a global flag would make repeated tests non-deterministic).
 */
export const SECRET_PATTERN_FAMILIES = ['credential-shaped-key', 'token-shaped-value', 'private-key-header'] as const;
export type SecretPatternFamily = (typeof SECRET_PATTERN_FAMILIES)[number];

export interface SecretPattern {
    readonly id: string;
    readonly family: SecretPatternFamily;
    readonly pattern: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
    {
        id: 'pem-private-key-header',
        family: 'private-key-header',
        pattern: /-----BEGIN[A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/
    },
    {
        id: 'credential-key-assignment',
        family: 'credential-shaped-key',
        pattern: /(?:^|[^A-Za-z0-9])(?:passwords?|passwds?|pwd|secrets?|api[_-]?keys?|access[_-]?keys?|secret[_-]?keys?|client[_-]?secrets?|private[_-]?keys?|auth[_-]?tokens?|access[_-]?tokens?|tokens?|credentials?)(?=[^A-Za-z0-9]|$)\s*["']?\s*[:=]/i
    },
    {
        id: 'jwt-value',
        family: 'token-shaped-value',
        pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/
    },
    {
        id: 'aws-access-key-id-value',
        family: 'token-shaped-value',
        pattern: /(?:^|[^A-Za-z0-9])AKIA[0-9A-Z]{16}(?:[^0-9A-Z]|$)/
    },
    {
        id: 'github-token-value',
        family: 'token-shaped-value',
        pattern: /(?:^|[^A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}(?:[^A-Za-z0-9]|$)/
    },
    {
        id: 'sk-prefixed-token-value',
        family: 'token-shaped-value',
        pattern: /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{16,}(?:[^A-Za-z0-9]|$)/
    },
    {
        id: 'slack-token-value',
        family: 'token-shaped-value',
        pattern: /(?:^|[^A-Za-z0-9])xox[abprs]-[A-Za-z0-9-]{10,}(?:[^A-Za-z0-9-]|$)/
    },
    {
        id: 'authorization-credential-value',
        family: 'token-shaped-value',
        pattern: /authorization\s*:\s*(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i
    }
];

/** A detection result: the matched family and pattern id. Never the matched text. */
export interface SecretShapeMatch {
    readonly family: SecretPatternFamily;
    readonly matchedPattern: string;
}

/**
 * Pure fail-closed detector: the first matching pattern in SECRET_PATTERNS order wins, so the
 * reported family is deterministic for any content.
 */
export function detectSecretShape(content: string): SecretShapeMatch | undefined {
    for (const secretPattern of SECRET_PATTERNS) {
        if (secretPattern.pattern.test(content)) {
            return { family: secretPattern.family, matchedPattern: secretPattern.id };
        }
    }
    return undefined;
}

export function isSecretShaped(content: string): boolean {
    return detectSecretShape(content) !== undefined;
}

function projectRefMatchesLevel(level: MemoryLevel, projectRef: unknown): boolean {
    if (level === 'project') {
        return typeof projectRef === 'string' && projectRef.length > 0;
    }
    return projectRef === undefined;
}

/**
 * One immutable revision of a logical memory entry. Each record carries the every-record law
 * (scope + contractVersion + ISO timestamps) plus the memory-level scope (level and, at the
 * project level, the projectRef anchor). contentDigest pins the content; revisionDigest pins
 * the revision and chains from the prior revision's digest (the genesis record chains from
 * the literal 'genesis' marker), so the append-only history is tamper-evident.
 */
export interface MemoryEntry {
    readonly scope: MemoryRecordScope;
    readonly contractVersion: string;
    readonly entryId: string;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
    readonly kind: MemoryEntryKind;
    readonly contentDigest: string;
    readonly provenance: MemoryProvenance;
    readonly createdAtIso: string;
    readonly revisionDigest: string;
}

export function isMemoryEntry(value: unknown): value is MemoryEntry {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        contractVersion?: unknown;
        entryId?: unknown;
        level?: unknown;
        projectRef?: unknown;
        kind?: unknown;
        contentDigest?: unknown;
        provenance?: unknown;
        createdAtIso?: unknown;
        revisionDigest?: unknown;
    };
    return (
        isMemoryRecordScope(candidate.scope) &&
        candidate.contractVersion === SCOPED_MEMORY_CONTRACTS_VERSION &&
        typeof candidate.entryId === 'string' &&
        candidate.entryId.length > 0 &&
        isMemoryLevel(candidate.level) &&
        projectRefMatchesLevel(candidate.level, candidate.projectRef) &&
        isMemoryEntryKind(candidate.kind) &&
        isDigest(candidate.contentDigest) &&
        isMemoryProvenance(candidate.provenance) &&
        isIsoTimestamp(candidate.createdAtIso) &&
        isDigest(candidate.revisionDigest)
    );
}

/**
 * A memory entry admission request: everything the admission boundary needs to build the
 * genesis record. The request itself is not a persisted record; the MemoryEntry it yields is.
 */
export interface EntryAdmissionRequest {
    readonly scope: MemoryRecordScope;
    readonly level: MemoryLevel;
    readonly projectRef: string | undefined;
    readonly entryId: string;
    readonly kind: MemoryEntryKind;
    readonly content: string;
    readonly provenance: MemoryProvenance;
    readonly admittedAtIso: string;
}

export function isEntryAdmissionRequest(value: unknown): value is EntryAdmissionRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as {
        scope?: unknown;
        level?: unknown;
        projectRef?: unknown;
        entryId?: unknown;
        kind?: unknown;
        content?: unknown;
        provenance?: unknown;
        admittedAtIso?: unknown;
    };
    return (
        isMemoryRecordScope(candidate.scope) &&
        isMemoryLevel(candidate.level) &&
        projectRefMatchesLevel(candidate.level, candidate.projectRef) &&
        typeof candidate.entryId === 'string' &&
        candidate.entryId.length > 0 &&
        isMemoryEntryKind(candidate.kind) &&
        typeof candidate.content === 'string' &&
        isMemoryProvenance(candidate.provenance) &&
        isIsoTimestamp(candidate.admittedAtIso)
    );
}

/** Typed admission refusals: never a silent empty result, never an exception. */
export type EntryRefusal =
    | { readonly kind: 'refusal'; readonly reason: 'secret-shaped-content'; readonly family: SecretPatternFamily; readonly matchedPattern: string }
    | { readonly kind: 'refusal'; readonly reason: 'invalid-request' };

export type EntryAdmissionVerdict = { readonly kind: 'admissible' } | EntryRefusal;

/**
 * Pure admission verdict: the CONTRACT boundary of the SECRET-EXCLUSION LAW. Shape validation
 * first (a malformed request is an 'invalid-request' refusal), then the fail-closed secret
 * sweep (secret-shaped content is a 'secret-shaped-content' refusal naming the matched
 * pattern family and pattern id - never the matched text). A secret-shaped entry is therefore
 * unrepresentable through this guard.
 */
export function canAdmitEntry(request: EntryAdmissionRequest): EntryAdmissionVerdict {
    if (!isEntryAdmissionRequest(request)) {
        return { kind: 'refusal', reason: 'invalid-request' };
    }
    const secretMatch = detectSecretShape(request.content);
    if (secretMatch !== undefined) {
        return { kind: 'refusal', reason: 'secret-shaped-content', family: secretMatch.family, matchedPattern: secretMatch.matchedPattern };
    }
    return { kind: 'admissible' };
}

/** Pure content digest: pins the entry content, length-prefixed and deterministic. */
export function contentDigestOf(content: string): string {
    return digestOf('content', content);
}

export type EntryAdmissionOutcome =
    | { readonly kind: 'admitted'; readonly entry: MemoryEntry }
    | EntryRefusal;

/** The literal chain anchor: the genesis record's revision digest chains from this marker. */
export const REVISION_CHAIN_GENESIS = 'genesis';

function genesisDigest(
    entryId: string,
    level: MemoryLevel,
    projectRef: string | undefined,
    kind: MemoryEntryKind,
    contentDigest: string,
    provenance: MemoryProvenance,
    createdAtIso: string
): string {
    return digestOf('revision', REVISION_CHAIN_GENESIS, entryId, level, projectRef ?? '', kind, contentDigest, provenanceDigestPart(provenance), createdAtIso);
}

function chainedRevisionDigest(priorRevisionDigest: string, contentDigest: string, provenance: MemoryProvenance, createdAtIso: string): string {
    return digestOf('revision', priorRevisionDigest, contentDigest, provenanceDigestPart(provenance), createdAtIso);
}

/**
 * Pure transition: builds the genesis record (revision 0) of a logical entry, chaining from
 * the literal REVISION_CHAIN_GENESIS marker. Refuses exactly as canAdmitEntry does.
 */
export function admitEntry(request: EntryAdmissionRequest): EntryAdmissionOutcome {
    const verdict = canAdmitEntry(request);
    if (verdict.kind !== 'admissible') {
        return verdict;
    }
    const contentDigest = contentDigestOf(request.content);
    const entry: MemoryEntry = {
        scope: request.scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        entryId: request.entryId,
        level: request.level,
        projectRef: request.projectRef,
        kind: request.kind,
        contentDigest,
        provenance: request.provenance,
        createdAtIso: request.admittedAtIso,
        revisionDigest: genesisDigest(request.entryId, request.level, request.projectRef, request.kind, contentDigest, request.provenance, request.admittedAtIso)
    };
    return { kind: 'admitted', entry };
}

/** The payload of a revision: the new content, its provenance, and the revision instant. */
export interface EntryRevisionRequest {
    readonly content: string;
    readonly provenance: MemoryProvenance;
    readonly revisedAtIso: string;
}

export function isEntryRevisionRequest(value: unknown): value is EntryRevisionRequest {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value as { content?: unknown; provenance?: unknown; revisedAtIso?: unknown };
    return (
        typeof candidate.content === 'string' &&
        isMemoryProvenance(candidate.provenance) &&
        isIsoTimestamp(candidate.revisedAtIso)
    );
}

export type EntryRevisionOutcome =
    | { readonly kind: 'revised'; readonly entry: MemoryEntry }
    | EntryRefusal;

/**
 * Pure transition: appends the next revision of a logical entry. REVISION-APPEND LAW: the
 * prior record is never mutated and the new record chains its revisionDigest from the prior
 * revision's digest; entryId, scope, level, projectRef, and kind are immutable across the
 * chain (a revision changes content and provenance only). The new record's createdAtIso is
 * the revision instant; the logical entry's origin instant lives on the genesis record. The
 * new content passes the same fail-closed secret sweep - a secret-shaped revision is refused
 * and the chain is never extended with it.
 */
export function reviseEntry(entry: MemoryEntry, request: EntryRevisionRequest): EntryRevisionOutcome {
    if (!isMemoryEntry(entry) || !isEntryRevisionRequest(request)) {
        return { kind: 'refusal', reason: 'invalid-request' };
    }
    const secretMatch = detectSecretShape(request.content);
    if (secretMatch !== undefined) {
        return { kind: 'refusal', reason: 'secret-shaped-content', family: secretMatch.family, matchedPattern: secretMatch.matchedPattern };
    }
    const contentDigest = contentDigestOf(request.content);
    const revision: MemoryEntry = {
        scope: entry.scope,
        contractVersion: SCOPED_MEMORY_CONTRACTS_VERSION,
        entryId: entry.entryId,
        level: entry.level,
        projectRef: entry.projectRef,
        kind: entry.kind,
        contentDigest,
        provenance: request.provenance,
        createdAtIso: request.revisedAtIso,
        revisionDigest: chainedRevisionDigest(entry.revisionDigest, contentDigest, request.provenance, request.revisedAtIso)
    };
    return { kind: 'revised', entry: revision };
}

/**
 * Pure tamper-evidence check over an ordered chain of revisions of one logical entry: every
 * record must be a valid entry, the first must re-derive from the genesis marker, and every
 * later record must re-derive from its predecessor's digest with an identical logical
 * identity (entryId, scope, level, projectRef, kind). An empty sequence is not a chain.
 * Returns false on any break - never throws.
 */
export function verifyRevisionChain(revisions: readonly MemoryEntry[]): boolean {
    if (revisions.length === 0) {
        return false;
    }
    const first = revisions[0];
    if (!isMemoryEntry(first) || genesisDigest(first.entryId, first.level, first.projectRef, first.kind, first.contentDigest, first.provenance, first.createdAtIso) !== first.revisionDigest) {
        return false;
    }
    let prior = first;
    for (let index = 1; index < revisions.length; index++) {
        const current = revisions[index];
        if (!isMemoryEntry(current)) {
            return false;
        }
        if (
            current.entryId !== prior.entryId ||
            current.kind !== prior.kind ||
            current.level !== prior.level ||
            current.projectRef !== prior.projectRef ||
            current.scope.tenantId !== prior.scope.tenantId ||
            current.scope.workspaceId !== prior.scope.workspaceId
        ) {
            return false;
        }
        if (chainedRevisionDigest(prior.revisionDigest, current.contentDigest, current.provenance, current.createdAtIso) !== current.revisionDigest) {
            return false;
        }
        prior = current;
    }
    return true;
}
