/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import {
    type MemoryLevel,
    EVIDENCE_KINDS,
    MEMORY_ENTRY_KINDS,
    MEMORY_PROVENANCE_ORIGINS,
    REVISION_CHAIN_GENESIS,
    SCOPED_MEMORY_CONTRACTS_VERSION,
    SECRET_PATTERN_FAMILIES,
    SECRET_PATTERNS,
    admitEntry,
    canAdmitEntry,
    contentDigestOf,
    detectSecretShape,
    digestOf,
    isDigest,
    isEvidenceKind,
    isMemoryEntry,
    isMemoryEntryKind,
    isMemoryProvenance,
    isSecretShaped,
    provenanceDigestPart,
    reviseEntry,
    verifyRevisionChain
} from '../../common/entry.js';
import type {
    EntryAdmissionOutcome,
    EntryAdmissionRequest,
    EntryAdmissionVerdict,
    EntryRefusal,
    EntryRevisionOutcome,
    EntryRevisionRequest,
    MemoryEntry,
    MemoryEntryKind,
    MemoryProvenance,
    MemoryProvenanceOrigin,
    MemoryRecordScope,
    SecretPatternFamily
} from '../../common/entry.js';

const SCOPE: MemoryRecordScope = { tenantId: 'tenant-1', workspaceId: 'ws-1' };
const T0 = '2025-01-01T00:00:00Z';
const T1 = '2025-01-02T00:00:00Z';
const T2 = '2025-01-03T00:00:00Z';
const T3 = '2025-01-04T00:00:00Z';

function makeAdmissionRequest(overrides: Partial<EntryAdmissionRequest> = {}): EntryAdmissionRequest {
    return {
        scope: SCOPE,
        level: 'user',
        projectRef: undefined,
        entryId: 'entry-1',
        kind: 'fact',
        content: 'The user prefers tabs over spaces.',
        provenance: { origin: 'operator-entry', capturedAtIso: T0 },
        admittedAtIso: T0,
        ...overrides
    };
}

function expectAdmitted(outcome: EntryAdmissionOutcome): MemoryEntry {
    if (outcome.kind === 'admitted') {
        return outcome.entry;
    }
    throw new Error(`expected an admitted entry, received refusal: ${JSON.stringify(outcome)}`);
}

function expectRevised(outcome: EntryRevisionOutcome): MemoryEntry {
    if (outcome.kind === 'revised') {
        return outcome.entry;
    }
    throw new Error(`expected a revised entry, received refusal: ${JSON.stringify(outcome)}`);
}

function expectEntryRefusal(outcome: EntryAdmissionOutcome | EntryRevisionOutcome): EntryRefusal {
    if (outcome.kind === 'refusal') {
        return outcome;
    }
    throw new Error(`expected an entry refusal, received: ${JSON.stringify(outcome)}`);
}

function expectVerdictRefusal(verdict: EntryAdmissionVerdict): EntryRefusal {
    if (verdict.kind === 'refusal') {
        return verdict;
    }
    throw new Error(`expected a verdict refusal, received: ${JSON.stringify(verdict)}`);
}

const SAMPLE_PROVENANCE: Record<MemoryProvenanceOrigin, MemoryProvenance> = {
    'task-evidence': { origin: 'task-evidence', evidenceKind: 'changeset', evidenceRef: 'task-1/changeset-9', capturedAtIso: T0 },
    'operator-entry': { origin: 'operator-entry', capturedAtIso: T0 },
    derived: { origin: 'derived', inputDigests: [digestOf('input', 'a')], capturedAtIso: T0 }
};

interface SecretCanary {
    readonly content: string;
    readonly family: SecretPatternFamily;
    readonly matchedPattern: string;
    readonly marker: string;
}

const SECRET_CANARIES: readonly SecretCanary[] = [
    { content: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1xW\n-----END RSA PRIVATE KEY-----', family: 'private-key-header', matchedPattern: 'pem-private-key-header', marker: 'MIIEowIBAAKCAQEA1xW' },
    { content: 'password: hunter2', family: 'credential-shaped-key', matchedPattern: 'credential-key-assignment', marker: 'hunter2' },
    { content: 'API_KEY="abc123def456ghi789"', family: 'credential-shaped-key', matchedPattern: 'credential-key-assignment', marker: 'abc123def456ghi789' },
    { content: 'the client_secret = 9f8e7d6c5b4a3210 for staging', family: 'credential-shaped-key', matchedPattern: 'credential-key-assignment', marker: '9f8e7d6c5b4a3210' },
    { content: 'the header carried eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c across services', family: 'token-shaped-value', matchedPattern: 'jwt-value', marker: 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
    { content: 'deploy role AKIAIOSFODNN7EXAMPLE is rotated weekly', family: 'token-shaped-value', matchedPattern: 'aws-access-key-id-value', marker: 'AKIAIOSFODNN7EXAMPLE' },
    { content: 'ci pull token ghp_16C7e42F292c6912E7710c838347Ae178B4a leaked', family: 'token-shaped-value', matchedPattern: 'github-token-value', marker: 'ghp_16C7e42F292c6912E7710c838347Ae178B4a' },
    { content: 'sk-abcdefghijklmnopqrstuvwxyz123456 leaked in logs', family: 'token-shaped-value', matchedPattern: 'sk-prefixed-token-value', marker: 'abcdefghijklmnopqrstuvwxyz123456' },
    { content: 'xo' + 'xb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx found in the archive', family: 'token-shaped-value', matchedPattern: 'slack-token-value', marker: 'abcdefghijklmnopqrstuvwx' },
    { content: 'Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ= on the staging box', family: 'token-shaped-value', matchedPattern: 'authorization-credential-value', marker: 'dXNlcm5hbWU6cGFzc3dvcmQ=' }
];

const BENIGN_CONTENTS: readonly string[] = [
    'The user prefers tabs over spaces and a light theme.',
    'Procedure: run the deploy script, then verify the health endpoint returns 200.',
    'The secret ingredient in the runbook is the rollback step.',
    'Rotate the password quarterly and never reuse old ones.',
    'Reference: the deployment runbook lives at docs/deployment.md.',
    '-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIE=\n-----END CERTIFICATE-----'
];

const INVALID_REQUESTS: readonly EntryAdmissionRequest[] = [
    makeAdmissionRequest({ scope: null as unknown as MemoryRecordScope }),
    makeAdmissionRequest({ level: 'team' as unknown as MemoryLevel }),
    makeAdmissionRequest({ level: 'project', projectRef: undefined }),
    makeAdmissionRequest({ projectRef: 'proj-1' }),
    makeAdmissionRequest({ entryId: '' }),
    makeAdmissionRequest({ kind: 'opinion' as unknown as MemoryEntryKind }),
    makeAdmissionRequest({ provenance: null as unknown as MemoryProvenance }),
    makeAdmissionRequest({ provenance: { origin: 'rumor', capturedAtIso: T0 } as unknown as MemoryProvenance }),
    makeAdmissionRequest({ provenance: { origin: 'derived', inputDigests: [], capturedAtIso: T0 } }),
    makeAdmissionRequest({ admittedAtIso: 'yesterday' }),
    makeAdmissionRequest({ content: 42 as unknown as string })
];

suite('zc005 entry: kind and evidence vocabularies', () => {
    test('MEMORY_ENTRY_KINDS is exactly the four frozen entry kinds', () => {
        assert.deepEqual(MEMORY_ENTRY_KINDS, ['fact', 'preference', 'procedure', 'reference']);
    });

    test('isMemoryEntryKind accepts exactly the frozen kinds and rejects everything else', () => {
        for (const kind of MEMORY_ENTRY_KINDS) {
            assert.ok(isMemoryEntryKind(kind), kind);
        }
        assert.ok(!isMemoryEntryKind('opinion'));
        assert.ok(!isMemoryEntryKind('fact-ish'));
        assert.ok(!isMemoryEntryKind(7));
        assert.ok(!isMemoryEntryKind(null));
    });

    test('EVIDENCE_KINDS projects the flauz-agent evidence vocabulary exactly', () => {
        assert.deepEqual(EVIDENCE_KINDS, ['changeset', 'screenshot', 'command-output', 'note']);
        for (const kind of EVIDENCE_KINDS) {
            assert.ok(isEvidenceKind(kind), kind);
        }
        assert.ok(!isEvidenceKind('log'));
        assert.ok(!isEvidenceKind('note-ish'));
        assert.ok(!isEvidenceKind(undefined));
    });
});

suite('zc005 entry: provenance disclosure', () => {
    test('isMemoryProvenance accepts every disclosed origin (iterated)', () => {
        for (const origin of MEMORY_PROVENANCE_ORIGINS) {
            const provenance = SAMPLE_PROVENANCE[origin];
            assert.strictEqual(provenance.origin, origin, origin);
            assert.ok(isMemoryProvenance(provenance), origin);
        }
        assert.ok(!isMemoryProvenance(null));
        assert.ok(!isMemoryProvenance({ origin: 'rumor', capturedAtIso: T0 }));
    });

    test('task-evidence provenance requires a projected evidence kind and a non-empty evidence ref', () => {
        assert.ok(!isMemoryProvenance({ origin: 'task-evidence', evidenceKind: 'log', evidenceRef: 'task-1/out-1', capturedAtIso: T0 }));
        assert.ok(!isMemoryProvenance({ origin: 'task-evidence', evidenceKind: 'changeset', evidenceRef: '', capturedAtIso: T0 }));
        assert.ok(!isMemoryProvenance({ origin: 'task-evidence', evidenceKind: 'changeset', evidenceRef: 'task-1/changeset-9', capturedAtIso: 'now' }));
        assert.ok(!isMemoryProvenance({ origin: 'task-evidence', evidenceRef: 'task-1/changeset-9', capturedAtIso: T0 }));
    });

    test('operator-entry provenance is disclosed as manual on the admitted entry', () => {
        const entry = expectAdmitted(admitEntry(makeAdmissionRequest({ provenance: SAMPLE_PROVENANCE['operator-entry'] })));
        assert.strictEqual(entry.provenance.origin, 'operator-entry');
        if (entry.provenance.origin === 'operator-entry') {
            assert.strictEqual(entry.provenance.capturedAtIso, T0);
        }
        assert.ok(!isMemoryProvenance({ origin: 'operator-entry', capturedAtIso: 'today' }));
    });

    test('derived provenance carries its derivation input digests and is disclosed as derived', () => {
        const derivedProvenance: MemoryProvenance = { origin: 'derived', inputDigests: [digestOf('a'), digestOf('b')], capturedAtIso: T1 };
        const entry = expectAdmitted(admitEntry(makeAdmissionRequest({ provenance: derivedProvenance, kind: 'procedure' })));
        assert.strictEqual(entry.provenance.origin, 'derived');
        if (entry.provenance.origin === 'derived') {
            assert.deepEqual(entry.provenance.inputDigests, [digestOf('a'), digestOf('b')]);
        }
        assert.ok(!isMemoryProvenance({ origin: 'derived', inputDigests: [], capturedAtIso: T1 }));
        assert.ok(!isMemoryProvenance({ origin: 'derived', inputDigests: [''], capturedAtIso: T1 }));
        assert.ok(!isMemoryProvenance({ origin: 'derived', capturedAtIso: T1 }));
    });

    test('provenanceDigestPart canonicalizes derived input digest order', () => {
        const unordered: MemoryProvenance = { origin: 'derived', inputDigests: [digestOf('b'), digestOf('a')], capturedAtIso: T0 };
        const ordered: MemoryProvenance = { origin: 'derived', inputDigests: [digestOf('a'), digestOf('b')], capturedAtIso: T0 };
        assert.strictEqual(provenanceDigestPart(unordered), provenanceDigestPart(ordered));
        assert.strictEqual(provenanceDigestPart(SAMPLE_PROVENANCE['operator-entry']), 'operator-entry');
        assert.strictEqual(provenanceDigestPart(SAMPLE_PROVENANCE['task-evidence']), 'task-evidence:changeset:task-1/changeset-9');
    });
});

suite('zc005 entry: the secret-exclusion law (fail-closed)', () => {
    test('SECRET_PATTERN_FAMILIES is exactly the three exported families; pattern ids are unique and unflagged', () => {
        assert.deepEqual(SECRET_PATTERN_FAMILIES, ['credential-shaped-key', 'token-shaped-value', 'private-key-header']);
        assert.strictEqual(SECRET_PATTERNS.length, 8);
        const ids = SECRET_PATTERNS.map((secretPattern) => secretPattern.id);
        assert.strictEqual(new Set(ids).size, ids.length);
        for (const secretPattern of SECRET_PATTERNS) {
            assert.ok((SECRET_PATTERN_FAMILIES as readonly string[]).includes(secretPattern.family), secretPattern.id);
            assert.ok(!secretPattern.pattern.global, `${secretPattern.id} must not carry the global flag`);
        }
    });

    test('isSecretShaped is true for every canary in the battery (iterated)', () => {
        for (const canary of SECRET_CANARIES) {
            assert.strictEqual(isSecretShaped(canary.content), true, canary.matchedPattern);
        }
    });

    test('canAdmitEntry rejects every canary with a typed refusal naming the family and pattern id - and never echoes the content', () => {
        for (const canary of SECRET_CANARIES) {
            const verdict = canAdmitEntry(makeAdmissionRequest({ content: canary.content }));
            const refusal = expectVerdictRefusal(verdict);
            if (refusal.reason !== 'secret-shaped-content') {
                assert.fail(`expected secret-shaped-content, received: ${refusal.reason}`);
            } else {
                assert.strictEqual(refusal.family, canary.family, canary.matchedPattern);
                assert.strictEqual(refusal.matchedPattern, canary.matchedPattern, canary.content);
            }
            assert.ok(!JSON.stringify(refusal).includes(canary.marker), 'the refusal must never echo the secret');
        }
    });

    test('CANARY: a secret-shaped entry is unrepresentable through the admission guard', () => {
        for (const canary of SECRET_CANARIES) {
            const outcome = admitEntry(makeAdmissionRequest({ content: canary.content }));
            assert.strictEqual(outcome.kind, 'refusal', canary.matchedPattern);
            assert.strictEqual(isSecretShaped(canary.content), true, canary.matchedPattern);
        }
    });

    test('benign content is admissible: the legitimate memory battery (iterated)', () => {
        for (const content of BENIGN_CONTENTS) {
            const verdict = canAdmitEntry(makeAdmissionRequest({ content }));
            assert.strictEqual(verdict.kind, 'admissible', content);
            const outcome = admitEntry(makeAdmissionRequest({ content }));
            assert.strictEqual(outcome.kind, 'admitted', content);
        }
    });

    test('detection is deterministic and reports the first matching pattern in list order', () => {
        const dualSecret = '-----BEGIN PRIVATE KEY-----\neyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c\n-----END PRIVATE KEY-----';
        const first = detectSecretShape(dualSecret);
        const second = detectSecretShape(dualSecret);
        assert.ok(first !== undefined);
        assert.ok(second !== undefined);
        assert.deepStrictEqual(first, second);
        assert.strictEqual(first.family, 'private-key-header');
        assert.strictEqual(first.matchedPattern, 'pem-private-key-header');
    });

    test('a detection match carries only the family and pattern id - never matched text', () => {
        const match = detectSecretShape('password: hunter2');
        assert.ok(match !== undefined);
        assert.deepEqual(Object.keys(match).sort(), ['family', 'matchedPattern']);
        assert.ok(!JSON.stringify(match).includes('hunter2'));
    });
});

suite('zc005 entry: admission', () => {
    test('admitEntry builds a genesis entry satisfying the every-record law', () => {
        const entry = expectAdmitted(admitEntry(makeAdmissionRequest()));
        assert.ok(isMemoryEntry(entry));
        assert.deepEqual(entry.scope, SCOPE);
        assert.strictEqual(entry.contractVersion, SCOPED_MEMORY_CONTRACTS_VERSION);
        assert.strictEqual(entry.entryId, 'entry-1');
        assert.strictEqual(entry.level, 'user');
        assert.strictEqual(entry.projectRef, undefined);
        assert.strictEqual(entry.kind, 'fact');
        assert.strictEqual(entry.createdAtIso, T0);
        assert.strictEqual(entry.provenance.origin, 'operator-entry');
        assert.ok(isDigest(entry.contentDigest));
        assert.ok(isDigest(entry.revisionDigest));
    });

    test('contentDigestOf and digestOf are deterministic and length-prefix separated', () => {
        assert.strictEqual(contentDigestOf('alpha'), contentDigestOf('alpha'));
        assert.notStrictEqual(contentDigestOf('alpha'), contentDigestOf('beta'));
        assert.ok(isDigest(contentDigestOf('alpha')));
        assert.strictEqual(digestOf('a', 'b'), digestOf('a', 'b'));
        assert.notStrictEqual(digestOf('a', 'b'), digestOf('b', 'a'));
        assert.notStrictEqual(digestOf('ab'), digestOf('a', 'b'));
    });

    test('admitEntry refuses invalid requests typedly (battery)', () => {
        for (const request of INVALID_REQUESTS) {
            const verdict = canAdmitEntry(request);
            assert.strictEqual(verdict.kind, 'refusal', JSON.stringify(request));
            const outcome = admitEntry(request);
            assert.strictEqual(outcome.kind, 'refusal', JSON.stringify(request));
            const refusal = expectEntryRefusal(outcome);
            assert.strictEqual(refusal.reason, 'invalid-request');
        }
    });

    test('canAdmitEntry mirrors admitEntry exactly across benign, canary, and invalid batteries', () => {
        for (const content of BENIGN_CONTENTS) {
            const request = makeAdmissionRequest({ content });
            assert.strictEqual(canAdmitEntry(request).kind, 'admissible', content);
            assert.strictEqual(admitEntry(request).kind, 'admitted', content);
        }
        for (const canary of SECRET_CANARIES) {
            const request = makeAdmissionRequest({ content: canary.content });
            const verdict = canAdmitEntry(request);
            const outcome = admitEntry(request);
            assert.strictEqual(verdict.kind, 'refusal', canary.matchedPattern);
            assert.strictEqual(outcome.kind, 'refusal', canary.matchedPattern);
            if (verdict.kind === 'refusal' && outcome.kind === 'refusal') {
                assert.strictEqual(verdict.reason, outcome.reason);
                if (verdict.reason === 'secret-shaped-content' && outcome.reason === 'secret-shaped-content') {
                    assert.strictEqual(verdict.family, outcome.family);
                    assert.strictEqual(verdict.matchedPattern, outcome.matchedPattern);
                }
            }
        }
        for (const request of INVALID_REQUESTS) {
            assert.strictEqual(canAdmitEntry(request).kind, 'refusal');
            assert.strictEqual(admitEntry(request).kind, 'refusal');
        }
    });
});

suite('zc005 entry: the revision-append law', () => {
    test('reviseEntry appends a new immutable record and never mutates the prior record', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const genesisSnapshot = JSON.stringify(genesis);
        const revision = expectRevised(reviseEntry(genesis, { content: 'The user prefers spaces over tabs.', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 }));
        assert.strictEqual(revision.entryId, genesis.entryId);
        assert.strictEqual(revision.kind, genesis.kind);
        assert.strictEqual(revision.level, genesis.level);
        assert.strictEqual(revision.projectRef, genesis.projectRef);
        assert.deepEqual(revision.scope, genesis.scope);
        assert.notStrictEqual(revision.contentDigest, genesis.contentDigest);
        assert.notStrictEqual(revision.revisionDigest, genesis.revisionDigest);
        assert.strictEqual(revision.createdAtIso, T1);
        assert.strictEqual(JSON.stringify(genesis), genesisSnapshot);
    });

    test('the revision digest chains from the prior revision: same payload, different prior, different digest', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const payload: EntryRevisionRequest = { content: 'The user prefers spaces over tabs.', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 };
        const revision = expectRevised(reviseEntry(genesis, payload));
        const otherGenesis = expectAdmitted(admitEntry(makeAdmissionRequest({ entryId: 'entry-2', content: 'Another baseline.' })));
        const revisionOfOther = expectRevised(reviseEntry(otherGenesis, payload));
        assert.notStrictEqual(revisionOfOther.revisionDigest, revision.revisionDigest);
        assert.strictEqual(verifyRevisionChain([genesis, revision]), true);
    });

    test('the genesis record chains from the literal genesis marker; a tampered genesis fails', () => {
        assert.strictEqual(REVISION_CHAIN_GENESIS, 'genesis');
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        assert.strictEqual(verifyRevisionChain([genesis]), true);
        const tampered: MemoryEntry = { ...genesis, createdAtIso: '2025-06-01T00:00:00Z' };
        assert.strictEqual(verifyRevisionChain([tampered]), false);
    });

    test('verifyRevisionChain rejects broken chains (empty, foreign entryId, tampered revision)', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const revision = expectRevised(reviseEntry(genesis, { content: 'The user prefers spaces over tabs.', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 }));
        assert.strictEqual(verifyRevisionChain([]), false);
        const foreign = expectAdmitted(admitEntry(makeAdmissionRequest({ entryId: 'entry-2' })));
        assert.strictEqual(verifyRevisionChain([genesis, foreign]), false);
        const tamperedRevision: MemoryEntry = { ...revision, contentDigest: digestOf('tampered', 'content') };
        assert.strictEqual(verifyRevisionChain([genesis, tamperedRevision]), false);
    });

    test('reviseEntry refuses secret-shaped revisions typedly - the chain is never extended with a secret', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const outcome = reviseEntry(genesis, { content: 'password: hunter2', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 });
        const refusal = expectEntryRefusal(outcome);
        if (refusal.reason !== 'secret-shaped-content') {
            assert.fail(`expected secret-shaped-content, received: ${refusal.reason}`);
        } else {
            assert.strictEqual(refusal.family, 'credential-shaped-key');
            assert.ok(!JSON.stringify(refusal).includes('hunter2'));
        }
        assert.strictEqual(verifyRevisionChain([genesis]), true);
    });

    test('reviseEntry refuses invalid entries and invalid revision requests typedly (battery)', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const badPayloads: readonly EntryRevisionRequest[] = [
            { content: 'Fine content.', provenance: null as unknown as MemoryProvenance, revisedAtIso: T1 },
            { content: 'Fine content.', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: 'soon' },
            { content: 7 as unknown as string, provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 }
        ];
        for (const payload of badPayloads) {
            const refusal = expectEntryRefusal(reviseEntry(genesis, payload));
            assert.strictEqual(refusal.reason, 'invalid-request');
        }
        const badEntryRefusal = expectEntryRefusal(reviseEntry({} as unknown as MemoryEntry, badPayloads[0]));
        assert.strictEqual(badEntryRefusal.reason, 'invalid-request');
    });

    test('a three-revision chain with mixed provenance verifies end to end', () => {
        const genesis = expectAdmitted(admitEntry(makeAdmissionRequest()));
        const r1 = expectRevised(reviseEntry(genesis, { content: 'Revision one.', provenance: { origin: 'operator-entry', capturedAtIso: T1 }, revisedAtIso: T1 }));
        const r2 = expectRevised(reviseEntry(r1, { content: 'Revision two.', provenance: { origin: 'task-evidence', evidenceKind: 'command-output', evidenceRef: 'task-7/output-3', capturedAtIso: T2 }, revisedAtIso: T2 }));
        const r3 = expectRevised(reviseEntry(r2, { content: 'Revision three.', provenance: { origin: 'derived', inputDigests: [genesis.contentDigest, r1.contentDigest, r2.contentDigest], capturedAtIso: T3 }, revisedAtIso: T3 }));
        assert.strictEqual(r3.provenance.origin, 'derived');
        if (r3.provenance.origin === 'derived') {
            assert.strictEqual(r3.provenance.inputDigests.length, 3);
        }
        assert.strictEqual(verifyRevisionChain([genesis, r1, r2, r3]), true);
    });
});
