/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

// Tests for build/flauz/capabilities/sources/common/import.ts (ZC-007).
// Style: mocha tdd (suite/test), assert, .js import suffixes.

import assert from 'assert';
import * as importContracts from '../../common/import.js';
import * as adapterContracts from '../../common/adapter.js';

const SCOPE_A: importContracts.SourceScope = { workspaceId: 'ws-1', tenantId: 'tenant-1' };
const AT_ISO = '2025-06-01T12:00:00.000Z';
const AT_ISO_LATER = '2025-06-02T12:00:00.000Z';

function makeCandidate(
    overrides: Partial<importContracts.ImportCandidateArtifact> = {}
): importContracts.ImportCandidateArtifact {
    return {
        scope: SCOPE_A,
        contractVersion: importContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
        artifactId: 'artifact-1',
        sourceDescriptorRef: 'source-printing-press-1',
        artifactDigest: 'sha256-artifact-1',
        licenseSpdxId: 'MIT',
        declaredPermissions: [importContracts.CAPABILITY_PERMISSIONS[0]],
        declaredEndpoints: ['https://press.example.test/api/v1'],
        rawMetadataDigest: 'sha256-metadata-1',
        ...overrides
    };
}

function makeProvenance(
    overrides: Partial<importContracts.ImportedEntryProvenance> = {}
): importContracts.ImportedEntryProvenance {
    return {
        sourceId: 'source-printing-press-1',
        adapterId: 'adapter-printing-press-1',
        artifactDigest: 'sha256-artifact-1',
        rawMetadataDigest: 'sha256-metadata-1',
        ...overrides
    };
}

function mustCreateRecord(): importContracts.ImportRecord {
    const result = importContracts.createImportRecord(
        SCOPE_A,
        'import-1',
        'source-printing-press-1',
        'adapter-printing-press-1',
        AT_ISO
    );
    if (result.outcome !== 'created') {
        throw new Error('expected created, got ' + result.outcome);
    }
    return result.record;
}

function mustAdvance(
    record: importContracts.ImportRecord,
    input: importContracts.ImportTransitionInput
): importContracts.ImportRecord {
    const result = importContracts.advanceImport(record, input);
    if (result.outcome !== 'advanced') {
        throw new Error('expected advanced, got ' + result.outcome);
    }
    return result.record;
}

suite('zc007 import contracts: the state machine', () => {
    test('IMPORT_STATES is the frozen forward order', () => {
        assert.deepStrictEqual(importContracts.IMPORT_STATES, [
            'discovered',
            'fetched',
            'normalized',
            'registered'
        ]);
    });

    test('IMPORT_TRANSITIONS admits exactly the forward edges and nothing else', () => {
        assert.deepStrictEqual(importContracts.IMPORT_TRANSITIONS.discovered, ['fetched']);
        assert.deepStrictEqual(importContracts.IMPORT_TRANSITIONS.fetched, ['normalized']);
        assert.deepStrictEqual(importContracts.IMPORT_TRANSITIONS.normalized, ['registered']);
        assert.deepStrictEqual(importContracts.IMPORT_TRANSITIONS.registered, []);
        assert.strictEqual(importContracts.isForwardImportTransition('discovered', 'fetched'), true);
        assert.strictEqual(importContracts.isForwardImportTransition('fetched', 'normalized'), true);
        assert.strictEqual(importContracts.isForwardImportTransition('normalized', 'registered'), true);
        assert.strictEqual(importContracts.isForwardImportTransition('discovered', 'discovered'), false);
        assert.strictEqual(importContracts.isForwardImportTransition('fetched', 'discovered'), false);
        assert.strictEqual(importContracts.isForwardImportTransition('registered', 'fetched'), false);
    });

    test('every transition edge moves strictly forward in the frozen order', () => {
        for (const edge of importContracts.IMPORT_TRANSITION_EDGES) {
            const fromIndex = importContracts.IMPORT_STATES.indexOf(edge.fromState);
            const toIndex = importContracts.IMPORT_STATES.indexOf(edge.toState);
            assert.ok(toIndex > fromIndex, edge.kind);
            assert.strictEqual(
                importContracts.isForwardImportTransition(edge.fromState, edge.toState),
                true
            );
        }
        assert.strictEqual(importContracts.IMPORT_TRANSITION_EDGES.length, 3);
    });
});

suite('zc007 import contracts: createImportRecord', () => {
    test('creates a record in the discovered state with an empty transition log', () => {
        const result = importContracts.createImportRecord(
            SCOPE_A,
            'import-1',
            'source-printing-press-1',
            'adapter-printing-press-1',
            AT_ISO
        );
        assert.strictEqual(result.outcome, 'created');
        if (result.outcome === 'created') {
            assert.strictEqual(result.record.state, 'discovered');
            assert.deepStrictEqual(result.record.transitions, []);
            assert.strictEqual(result.record.contractVersion, '1.0.0');
            assert.strictEqual(result.record.importedAtIso, AT_ISO);
            assert.strictEqual(importContracts.isImportRecord(result.record), true);
        }
    });

    test('rejects invalid ids, refs, scopes and timestamps with typed disclosures', () => {
        assert.strictEqual(
            importContracts.createImportRecord(SCOPE_A, '', 'src', 'adapter', AT_ISO).outcome,
            'invalid-import-id'
        );
        assert.strictEqual(
            importContracts.createImportRecord(SCOPE_A, 'import-1', '', 'adapter', AT_ISO).outcome,
            'invalid-source-ref'
        );
        assert.strictEqual(
            importContracts.createImportRecord(SCOPE_A, 'import-1', 'src', '', AT_ISO).outcome,
            'invalid-adapter-ref'
        );
        assert.strictEqual(
            importContracts.createImportRecord(SCOPE_A, 'import-1', 'src', 'adapter', 'nope').outcome,
            'invalid-timestamp'
        );
        assert.strictEqual(
            importContracts.createImportRecord(
                'garbage' as unknown as importContracts.SourceScope,
                'import-1',
                'src',
                'adapter',
                AT_ISO
            ).outcome,
            'invalid-scope'
        );
    });
});

suite('zc007 import contracts: advanceImport', () => {
    test('advances discovered -> fetched -> normalized -> registered with evidence', () => {
        const record = mustCreateRecord();
        const fetched = mustAdvance(record, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        assert.strictEqual(fetched.state, 'fetched');
        assert.strictEqual(fetched.transitions.length, 1);
        assert.strictEqual(fetched.transitions[0].kind, 'fetch');
        assert.strictEqual(fetched.transitions[0].fromState, 'discovered');
        assert.strictEqual(fetched.transitions[0].toState, 'fetched');
        assert.deepStrictEqual(fetched.transitions[0].evidenceDigests, ['sha256-bytes-1']);
        const normalized = mustAdvance(fetched, {
            kind: 'normalize',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-native-1']
        });
        assert.strictEqual(normalized.state, 'normalized');
        const registered = mustAdvance(normalized, {
            kind: 'register',
            atIso: AT_ISO_LATER,
            evidenceDigests: ['sha256-entry-1']
        });
        assert.strictEqual(registered.state, 'registered');
        assert.strictEqual(registered.transitions.length, 3);
        assert.strictEqual(importContracts.isImportRecord(registered), true);
    });

    test('every advanced transition carries its evidence digests and stamps', () => {
        const record = mustCreateRecord();
        const fetched = mustAdvance(record, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        const evidence = fetched.transitions[0];
        assert.strictEqual(evidence.importId, 'import-1');
        assert.strictEqual(evidence.contractVersion, '1.0.0');
        assert.deepStrictEqual(evidence.scope, SCOPE_A);
        assert.strictEqual(evidence.atIso, AT_ISO);
        assert.strictEqual(importContracts.isImportTransitionEvidence(evidence), true);
    });

    test('a transition without evidence digests is rejected (evidence-bearing law)', () => {
        const record = mustCreateRecord();
        assert.strictEqual(
            importContracts.advanceImport(record, {
                kind: 'fetch',
                atIso: AT_ISO,
                evidenceDigests: []
            }).outcome,
            'empty-evidence'
        );
        assert.strictEqual(
            importContracts.advanceImport(record, {
                kind: 'fetch',
                atIso: AT_ISO,
                evidenceDigests: ['']
            }).outcome,
            'empty-evidence'
        );
        assert.strictEqual(
            importContracts.advanceImport(record, {
                kind: 'fetch',
                atIso: AT_ISO,
                evidenceDigests: ['sha256-ok', '']
            }).outcome,
            'empty-evidence'
        );
    });

    test('a transition from the wrong state is the state-mismatch disclosure', () => {
        const record = mustCreateRecord();
        const result = importContracts.advanceImport(record, {
            kind: 'normalize',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-native-1']
        });
        assert.strictEqual(result.outcome, 'state-mismatch');
        if (result.outcome === 'state-mismatch') {
            assert.strictEqual(result.expectedFrom, 'fetched');
            assert.strictEqual(result.foundFrom, 'discovered');
        }
    });

    test('a registered record is terminal: no further transitions', () => {
        const record = mustCreateRecord();
        const fetched = mustAdvance(record, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        const normalized = mustAdvance(fetched, {
            kind: 'normalize',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-native-1']
        });
        const registered = mustAdvance(normalized, {
            kind: 'register',
            atIso: AT_ISO_LATER,
            evidenceDigests: ['sha256-entry-1']
        });
        assert.strictEqual(
            importContracts.advanceImport(registered, {
                kind: 'fetch',
                atIso: AT_ISO_LATER,
                evidenceDigests: ['sha256-bytes-2']
            }).outcome,
            'terminal-state'
        );
    });

    test('the transition log is append-only: prior entries are a prefix after advancing', () => {
        const record = mustCreateRecord();
        const fetched = mustAdvance(record, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        const normalized = mustAdvance(fetched, {
            kind: 'normalize',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-native-1']
        });
        assert.strictEqual(normalized.transitions.length, 2);
        assert.deepStrictEqual(normalized.transitions[0], fetched.transitions[0]);
        assert.deepStrictEqual(normalized.transitions.slice(0, 1), fetched.transitions);
    });
});

suite('zc007 import contracts: importTransitionsEqual', () => {
    test('equal logs compare equal (pure comparison)', () => {
        const left = mustCreateRecord();
        const leftAdvanced = mustAdvance(left, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        const right = mustCreateRecord();
        const rightAdvanced = mustAdvance(right, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        assert.strictEqual(
            importContracts.importTransitionsEqual(leftAdvanced.transitions, rightAdvanced.transitions),
            true
        );
        assert.strictEqual(importContracts.importTransitionsEqual([], []), true);
    });

    test('logs differing in length, order, digests or timestamps compare unequal', () => {
        const record = mustCreateRecord();
        const fetched = mustAdvance(record, {
            kind: 'fetch',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-bytes-1']
        });
        const normalized = mustAdvance(fetched, {
            kind: 'normalize',
            atIso: AT_ISO,
            evidenceDigests: ['sha256-native-1']
        });
        const other = mustCreateRecord();
        const otherFetched = mustAdvance(other, {
            kind: 'fetch',
            atIso: AT_ISO_LATER,
            evidenceDigests: ['sha256-bytes-2']
        });
        assert.strictEqual(
            importContracts.importTransitionsEqual(normalized.transitions, fetched.transitions),
            false
        );
        assert.strictEqual(
            importContracts.importTransitionsEqual(fetched.transitions, otherFetched.transitions),
            false
        );
        assert.strictEqual(
            importContracts.importTransitionsEqual(normalized.transitions, [
                normalized.transitions[1],
                normalized.transitions[0]
            ]),
            false
        );
    });
});

suite('zc007 import contracts: canImport (fail-closed admission)', () => {
    test('admits an artifact with license, digest and in-table permissions', () => {
        const admission = importContracts.canImport(makeCandidate());
        assert.deepStrictEqual(admission, { admission: 'admitted' });
    });

    test('rejects a missing license with the missing-license violation', () => {
        const admission = importContracts.canImport(makeCandidate({ licenseSpdxId: '' }));
        assert.strictEqual(admission.admission, 'rejected');
        if (admission.admission === 'rejected') {
            assert.strictEqual(admission.violation.violation, 'missing-license');
        }
        const whitespace = importContracts.canImport(makeCandidate({ licenseSpdxId: '   ' }));
        assert.strictEqual(whitespace.admission, 'rejected');
    });

    test('rejects a missing artifact digest with the missing-artifact-digest violation', () => {
        const admission = importContracts.canImport(makeCandidate({ artifactDigest: '' }));
        assert.strictEqual(admission.admission, 'rejected');
        if (admission.admission === 'rejected') {
            assert.strictEqual(admission.violation.violation, 'missing-artifact-digest');
        }
    });

    test('rejects out-of-table permissions, naming the violating permissions', () => {
        const admission = importContracts.canImport(
            makeCandidate({
                declaredPermissions: [
                    importContracts.CAPABILITY_PERMISSIONS[0],
                    'not-a-table-permission'
                ]
            })
        );
        assert.strictEqual(admission.admission, 'rejected');
        if (admission.admission === 'rejected') {
            assert.strictEqual(admission.violation.violation, 'permission-out-of-table');
            if (admission.violation.violation === 'permission-out-of-table') {
                assert.deepStrictEqual(admission.violation.permissions, ['not-a-table-permission']);
            }
        }
    });

    test('rejects structurally invalid artifacts with the invalid-artifact disclosure, never a crash', () => {
        assert.strictEqual(
            importContracts.canImport(null as unknown as importContracts.ImportCandidateArtifact)
                .admission,
            'rejected'
        );
        const garbage = importContracts.canImport({
            nope: true
        } as unknown as importContracts.ImportCandidateArtifact);
        assert.strictEqual(garbage.admission, 'rejected');
        if (garbage.admission === 'rejected') {
            assert.strictEqual(garbage.violation.violation, 'invalid-artifact');
        }
    });

    test('an adapter.ts DiscoveredArtifact is admissible input (type-level projection pin)', () => {
        const discovered: adapterContracts.DiscoveredArtifact = {
            scope: SCOPE_A,
            contractVersion: adapterContracts.SOURCE_ADAPTERS_CONTRACTS_VERSION,
            artifactId: 'artifact-1',
            sourceDescriptorRef: 'source-printing-press-1',
            artifactDigest: 'sha256-artifact-1',
            licenseSpdxId: 'MIT',
            declaredPermissions: [adapterContracts.CAPABILITY_PERMISSIONS[0]],
            declaredEndpoints: ['https://press.example.test/api/v1'],
            rawMetadataDigest: 'sha256-metadata-1'
        };
        const candidate: importContracts.ImportCandidateArtifact = discovered;
        assert.deepStrictEqual(importContracts.canImport(candidate), { admission: 'admitted' });
    });
});

suite('zc007 import contracts: makeImportedEntry (authority law)', () => {
    test('creates a Flauz-owned entry with hashes, license, declarations and provenance', () => {
        const result = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance(),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        assert.strictEqual(result.outcome, 'created');
        if (result.outcome === 'created') {
            const entry = result.entry;
            assert.strictEqual(entry.entryId, 'entry-1');
            assert.strictEqual(entry.artifactDigest, 'sha256-artifact-1');
            assert.strictEqual(entry.licenseSpdxId, 'MIT');
            assert.strictEqual(entry.licenseDigest, 'sha256-license-1');
            assert.deepStrictEqual(entry.declaredPermissions, [
                importContracts.CAPABILITY_PERMISSIONS[0]
            ]);
            assert.deepStrictEqual(entry.declaredEndpoints, ['https://press.example.test/api/v1']);
            assert.deepStrictEqual(entry.provenance, makeProvenance());
            assert.strictEqual(entry.contractVersion, '1.0.0');
            assert.strictEqual(entry.registeredAtIso, AT_ISO);
            assert.strictEqual(importContracts.isImportedEntry(entry), true);
        }
    });

    test('the entry ALWAYS enters as unverified: verification is Flauz-owned (ZC-006 receipt path)', () => {
        // SEAM(zc006-verification-statuses): this wave pins 'unverified' only;
        // after the ZC-006 authority lands, keep asserting the entry status.
        const result = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance(),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        assert.strictEqual(result.outcome, 'created');
        if (result.outcome === 'created') {
            assert.strictEqual(result.entry.verificationStatus, 'unverified');
        }
        assert.ok(importContracts.IMPORTED_ENTRY_VERIFICATION_STATUSES.includes('unverified'));
    });

    test('delegates admission: a rejected artifact never produces an entry', () => {
        const result = importContracts.makeImportedEntry(
            makeCandidate({ licenseSpdxId: '' }),
            makeProvenance(),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        assert.strictEqual(result.outcome, 'rejected');
        if (result.outcome === 'rejected') {
            assert.strictEqual(result.violation.violation, 'missing-license');
        }
    });

    test('requires a license digest: Flauz-owned records carry hashes', () => {
        const result = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance(),
            'entry-1',
            '',
            AT_ISO
        );
        assert.strictEqual(result.outcome, 'missing-license-digest');
    });

    test('rejects incoherent provenance (digest mismatch with the admitted artifact)', () => {
        const wrongArtifact = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance({ artifactDigest: 'sha256-different' }),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        assert.strictEqual(wrongArtifact.outcome, 'invalid-provenance');
        const wrongMetadata = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance({ rawMetadataDigest: 'sha256-different' }),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        assert.strictEqual(wrongMetadata.outcome, 'invalid-provenance');
    });
});

suite('zc007 import contracts: guards', () => {
    test('isImportedEntry rejects out-of-table permissions and foreign statuses', () => {
        const created = importContracts.makeImportedEntry(
            makeCandidate(),
            makeProvenance(),
            'entry-1',
            'sha256-license-1',
            AT_ISO
        );
        if (created.outcome !== 'created') {
            throw new Error('expected created, got ' + created.outcome);
        }
        assert.strictEqual(
            importContracts.isImportedEntry({
                ...created.entry,
                verificationStatus: 'verified'
            } as unknown as importContracts.ImportedEntry),
            false
        );
        assert.strictEqual(
            importContracts.isImportedEntry({
                ...created.entry,
                declaredPermissions: ['bogus']
            } as unknown as importContracts.ImportedEntry),
            false
        );
        assert.strictEqual(importContracts.isImportedEntry(null), false);
    });

    test('isImportRecord validates the record and its evidence log', () => {
        const record = mustCreateRecord();
        assert.strictEqual(importContracts.isImportRecord(record), true);
        assert.strictEqual(
            importContracts.isImportRecord({
                ...record,
                state: 'verified'
            } as unknown as importContracts.ImportRecord),
            false
        );
        assert.strictEqual(importContracts.isImportRecord(null), false);
    });
});
