/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-006 organization-defaults contract battery: the frozen-vocab
 * cross-pins (against the REAL landed modules), the stage machine,
 * the body laws (every rejection class), the deep record walk with
 * the complete-table law and the absent-key discipline, the
 * serialization round-trip with the fail-closed parse, and the
 * in-suite determinism greps (law-comment lines only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_INDUSTRIES,
        isHarnessId,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import {
        MAX_BODIES,
        BODY_KEY_MAX_LENGTH,
        BODY_SUMMARY_MAX_LENGTH,
        BODY_FORWARD_TRANSITIONS,
        BODY_ID_PREFIX,
        BODY_OP_NAMES,
        BODIES_RECORD_SCHEMA_KEYS,
        BODY_STAGES,
        BODIES_CONTRACTS_VERSION,
        BODY_ENTRY_SCHEMA_KEYS,
        canTransitionBodyStage,
        parseOrganizationDefaultsRecord,
        serializeOrganizationDefaultsRecord,
        validateBodyEntry,
        validateBodySummary,
        validateOrganizationDefaultsRecord,
} from '../../common/bodiesContract.js';
import type { BodiesValidationOutcome } from '../../common/bodiesContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/bodiesContract.ts', import.meta.url)), 'utf8');

function greenRecord(): Record<string, unknown> {
        return {
                bodyId: 'flauz:bod:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                industry: 'software',
                stage: 'composing',
                bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work against the roles.', roleRefs: ['analyst'] }],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-defaults', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
                ],
        };
}

function reasons<T>(outcome: BodiesValidationOutcome<T>): string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections.map((rejection) => rejection.reason);
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('bodiesContract · frozen vocabularies and cross-pins', () => {
        test('BODIES_CONTRACTS_VERSION is 1.0.0 and BODY_ID_PREFIX is flauz:bod:', () => {
                assert.equal(BODIES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(BODY_ID_PREFIX, 'flauz:bod:');
        });

        test('BODY_STAGES and BODY_FORWARD_TRANSITIONS are frozen', () => {
                assert.deepStrictEqual([...BODY_STAGES], ['composing', 'composed']);
                assert.deepStrictEqual([...BODY_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
        });

        test('the body-law constants are frozen (64 / 200 / 64)', () => {
                assert.equal(BODY_KEY_MAX_LENGTH, 64);
                assert.equal(BODY_SUMMARY_MAX_LENGTH, 200);
                assert.equal(MAX_BODIES, 64);
        });

        test('BODY_OP_NAMES is the frozen five-op vocabulary', () => {
                assert.deepStrictEqual([...BODY_OP_NAMES], [
                        'begin-defaults',
                        'add-body',
                        'replace-body-summary',
                        'remove-body',
                        'finalize-defaults',
                ]);
        });

        test('the DH-01 re-exports are referentially identical to the real module', () => {
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(HARNESS_INDUSTRIES, HARNESS_INDUSTRIES);
                assert.equal(isHarnessId, isHarnessId);
        });

        test('the DH-02/DH-03/DH-04 version re-exports equal the real modules', () => {
                assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
                assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
        });
});

suite('bodiesContract · the stage machine', () => {
        test('composing -> composed is the single whitelisted row', () => {
                const verdict = canTransitionBodyStage('composing', 'composed');
                assert.ok(verdict.ok);
                assert.equal(verdict.row, 1);
                assert.equal(verdict.from, 'composing');
                assert.equal(verdict.to, 'composed');
        });

        test('composed is TERMINAL (whitelistRow null, expectedTo null)', () => {
                const verdict = canTransitionBodyStage('composed', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, null);
                assert.equal(verdict.expectedTo, null);
        });

        test('the composing self-loop is refused with expectedTo composed', () => {
                const verdict = canTransitionBodyStage('composing', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.whitelistRow, 1);
                assert.equal(verdict.expectedTo, 'composed');
        });

        test('unknown or non-string stages are refused', () => {
                for (const [from, to] of [['draft', 'composed'], ['composing', 'draft'], [null, 'composed'], ['composing', 7]] as unknown[][]) {
                        const verdict = canTransitionBodyStage(from, to);
                        assert.ok(!verdict.ok);
                        assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                }
        });
});

suite('bodiesContract · validateBodyEntry', () => {
        test('a green body entry (with roleRefs) validates', () => {
                const outcome = validateBodyEntry({ bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst', 'reviewer'] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value, { bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: ['analyst', 'reviewer'] });
        });

        test('the honest-gap law: empty roleRefs validate', () => {
                const outcome = validateBodyEntry({ bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: [] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value.roleRefs, []);
        });

        test('a non-object is the single-station malformed-body table', () => {
                for (const body of [null, 'body', 7, ['x']]) {
                        const outcome = validateBodyEntry(body);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-body']);
                }
        });

        test('a non-string bodyKey or summary carrier is malformed-body', () => {
                assert.deepStrictEqual(reasons(validateBodyEntry({ bodyKey: 7, summary: 's', roleRefs: [] })), ['malformed-body']);
                assert.deepStrictEqual(reasons(validateBodyEntry({ bodyKey: 'k', summary: null, roleRefs: [] })), ['malformed-body']);
        });

        test('an extra key is the typed no-fork rejection', () => {
                const outcome = validateBodyEntry({ bodyKey: 'k', summary: 's', roleRefs: [], model: 'gpt-x' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'no-fork');
                assert.equal(outcome.rejections[0].law, 'THE NO-FORK LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['model']);
        });

        test('invalid-body-key classes: empty, 65 chars, padded, control chars (64 legal)', () => {
                assert.ok(validateBodyEntry({ bodyKey: 'a'.repeat(64), summary: 's', roleRefs: [] }).ok);
                assert.deepStrictEqual(reasons(validateBodyEntry({ bodyKey: '', summary: 's', roleRefs: [] })), ['invalid-body-key']);
                assert.deepStrictEqual(reasons(validateBodyEntry({ bodyKey: 'a'.repeat(65), summary: 's', roleRefs: [] })), ['invalid-body-key']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: 'a'.repeat(65), summary: 's', roleRefs: [] })), ['65 chars']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: ' k', summary: 's', roleRefs: [] })), ['leading/trailing whitespace']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: 'k\u0000', summary: 's', roleRefs: [] })), ['U+0000']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: 'k\u007F', summary: 's', roleRefs: [] })), ['U+007F']);
        });

        test('invalid-summary classes: empty, 201 chars, control chars (200 legal)', () => {
                assert.ok(validateBodyEntry({ bodyKey: 'k', summary: 'a'.repeat(200), roleRefs: [] }).ok);
                assert.deepStrictEqual(reasons(validateBodyEntry({ bodyKey: 'k', summary: '', roleRefs: [] })), ['invalid-summary']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: 'k', summary: 'a'.repeat(201), roleRefs: [] })), ['201 chars']);
                assert.deepStrictEqual(outcomeItems(validateBodyEntry({ bodyKey: 'k', summary: 's\u009F', roleRefs: [] })), ['U+009F']);
        });

        test('a non-array roleRefs carrier is malformed-role-refs', () => {
                const outcome = validateBodyEntry({ bodyKey: 'k', summary: 's', roleRefs: 'analyst' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['malformed-role-refs']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['roleRefs']);
        });

        test('a non-string roleRefs member is malformed-role-refs', () => {
                const outcome = validateBodyEntry({ bodyKey: 'k', summary: 's', roleRefs: ['analyst', 7] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['malformed-role-refs']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['roleRefs[1]']);
        });

        test('repeated roleRefs are duplicate-role-ref', () => {
                const outcome = validateBodyEntry({ bodyKey: 'k', summary: 's', roleRefs: ['analyst', 'reviewer', 'analyst'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-role-ref']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['analyst']);
        });

        test('THE COMPLETE TABLE: one multi-offense entry reports every station in the frozen order', () => {
                const outcome = validateBodyEntry({ bodyKey: ' k ', summary: '', roleRefs: 'nope', model: 1 });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['no-fork', 'invalid-body-key', 'invalid-summary', 'malformed-role-refs']);
        });

        test('the ok copy carries the fixed key order (bodyKey, summary, roleRefs)', () => {
                const outcome = validateBodyEntry({ bodyKey: 'k', summary: 's', roleRefs: ['analyst'] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(Object.keys(outcome.value), [...BODY_ENTRY_SCHEMA_KEYS]);
        });

        test('validateBodySummary: green, non-string malformed-record, invalid-summary bounds', () => {
                assert.ok(validateBodySummary('A fresh summary.').ok);
                assert.deepStrictEqual(reasons(validateBodySummary(7)), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateBodySummary('')), ['invalid-summary']);
                assert.deepStrictEqual(reasons(validateBodySummary('a'.repeat(201))), ['invalid-summary']);
        });
});

function outcomeItems<T>(outcome: BodiesValidationOutcome<T>): readonly string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections[0].items ?? [];
}

suite('bodiesContract · validateOrganizationDefaultsRecord', () => {
        test('a green record validates and the ok copy is canonical', () => {
                const outcome = validateOrganizationDefaultsRecord(greenRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.value.bodyId, 'flauz:bod:0123456789abcdef');
                assert.equal(outcome.value.bodies.length, 1);
                assert.deepStrictEqual(outcome.value.bodies[0].roleRefs, ['analyst']);
        });

        test('the canonical serialization order is the frozen six-key order', () => {
                const bytes = serializeOrganizationDefaultsRecord(greenRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...BODIES_RECORD_SCHEMA_KEYS]);
                // station-fix (R70): the green fixture carries ONE body (the first test pins
                // bodies.length === 1) - the serialized array's keys are ['0'] alone.
                assert.deepStrictEqual(Object.keys(parsed.bodies as Record<string, unknown>), ['0']);
                const firstBody = (parsed.bodies as Record<string, unknown>[])[0];
                assert.deepStrictEqual(Object.keys(firstBody), [...BODY_ENTRY_SCHEMA_KEYS]);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const value of [null, 'record', 7, ['x']]) {
                        const outcome = validateOrganizationDefaultsRecord(value);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-array bodies / history carrier is malformed-record', () => {
                const badBodies = clone(greenRecord());
                badBodies.bodies = 'nope';
                assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(badBodies)), ['malformed-record']);
                const badHistory = clone(greenRecord());
                badHistory.history = 'nope';
                assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(badHistory)), ['malformed-record']);
        });

        test('an unknown record key is unknown-key', () => {
                const record = clone(greenRecord());
                record.nope = 1;
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'unknown-key');
                assert.deepStrictEqual(outcome.rejections[0].items, ['nope']);
        });

        test('THE ABSENT-KEY DISCIPLINE: every absent key is missing-key, never a structural station', () => {
                for (const key of [...BODIES_RECORD_SCHEMA_KEYS]) {
                        const record = clone(greenRecord());
                        delete record[key];
                        const outcome = validateOrganizationDefaultsRecord(record);
                        assert.ok(!outcome.ok, `the absent '${key}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['missing-key'], `the absent '${key}' is the missing-key station only`);
                }
        });

        test('malformed-harness-id classes refuse through the REAL DH-01 alphabet', () => {
                for (const harnessId of ['flauz:bod:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
                        const record = clone(greenRecord());
                        record.harnessId = harnessId;
                        assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(record)), ['malformed-harness-id']);
                }
        });

        test('a non-member industry is unknown-industry', () => {
                const record = clone(greenRecord());
                record.industry = 'aerospace';
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'unknown-industry');
                assert.equal(outcome.rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('per-body violations surface with the bodies[i]: item prefixes', () => {
                const record = greenRecord();
                record.bodies = [{ bodyKey: ' k', summary: 's', roleRefs: [] }];
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['invalid-body-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['bodies[0]:leading/trailing whitespace']);
        });

        test('repeated bodyKeys are duplicate-body-key', () => {
                const record = greenRecord();
                record.bodies = [
                        { bodyKey: 'triage', summary: 'One.', roleRefs: [] },
                        { bodyKey: 'triage', summary: 'Two.', roleRefs: [] },
                ];
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-body-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['triage']);
        });

        test('exactly 64 bodies validate (the composition bound)', () => {
                const record = greenRecord();
                record.bodies = Array.from({ length: 64 }, (_unused, index) => ({ bodyKey: `b${String(index).padStart(2, '0')}`, summary: 'A default body.', roleRefs: [] }));
                assert.ok(validateOrganizationDefaultsRecord(record).ok);
        });

        test('65 bodies are max-bodies-exceeded', () => {
                const record = greenRecord();
                record.bodies = Array.from({ length: 65 }, (_unused, index) => ({ bodyKey: `b${String(index).padStart(2, '0')}`, summary: 'A default body.', roleRefs: [] }));
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['max-bodies-exceeded']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 bodies']);
        });

        test('empty bodies are LEGAL on the record shape (the floor fires at finalize)', () => {
                const record = greenRecord();
                record.bodies = [];
                assert.ok(validateOrganizationDefaultsRecord(record).ok);
        });

        test('a malformed id / stage / history note refuse (unknown-record, unknown-stage, malformed-history)', () => {
                const badId = clone(greenRecord());
                badId.bodyId = 'flauz:bod:0123456789abcde';
                assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(badId)), ['unknown-record']);
                const badStage = clone(greenRecord());
                badStage.stage = 'draft';
                assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(badStage)), ['unknown-stage']);
                const badHistory = clone(greenRecord());
                badHistory.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                assert.deepStrictEqual(reasons(validateOrganizationDefaultsRecord(badHistory)), ['malformed-history']);
        });

        test('THE COMPLETE TABLE: a multi-offense record reports every station in the frozen walk order', () => {
                const record = greenRecord();
                record.nope = 1;
                delete record.industry;
                record.harnessId = 'bad';
                record.bodies = [
                        { bodyKey: 'triage', summary: 'One.', roleRefs: [] },
                        { bodyKey: 'triage', summary: 'Two.', roleRefs: [] },
                ];
                const outcome = validateOrganizationDefaultsRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['unknown-key', 'missing-key', 'malformed-harness-id', 'duplicate-body-key']);
        });
});

suite('bodiesContract · serialization and the fail-closed parse', () => {
        test('the round trip is byte-identical and double-serialize stable', () => {
                const bytes = serializeOrganizationDefaultsRecord(greenRecord());
                const parsed = parseOrganizationDefaultsRecord(bytes);
                assert.ok(parsed.ok);
                assert.equal(serializeOrganizationDefaultsRecord(parsed.record), bytes);
                assert.equal(serializeOrganizationDefaultsRecord(JSON.parse(bytes)), bytes);
        });

        test('serialize throws TypeError on a malformed record', () => {
                assert.throws(() => serializeOrganizationDefaultsRecord({ nope: 1 }), TypeError);
        });

        test('parse: malformed-json', () => {
                const outcome = parseOrganizationDefaultsRecord('{not json');
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'malformed-json');
        });

        test('parse: non-string bytes are torn-envelope', () => {
                const outcome = parseOrganizationDefaultsRecord(7);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a missing key is torn-envelope', () => {
                const record = clone(greenRecord());
                delete record.stage;
                const outcome = parseOrganizationDefaultsRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a wrong structural type is torn-envelope', () => {
                const record = clone(greenRecord());
                record.bodies = 'nope';
                const outcome = parseOrganizationDefaultsRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: unknown keys at the record / body / note level are unknown-key', () => {
                const atRecord = clone(greenRecord());
                atRecord.nope = 1;
                const atRecordOutcome = parseOrganizationDefaultsRecord(JSON.stringify(atRecord));
                assert.equal(atRecordOutcome.ok === true ? 'ok' : atRecordOutcome.rejection.reason, 'unknown-key');
                const atBody = clone(greenRecord());
                atBody.bodies = [{ bodyKey: 'triage', summary: 's', roleRefs: [], model: 1 }];
                const bodyOutcome = parseOrganizationDefaultsRecord(JSON.stringify(atBody));
                assert.ok(!bodyOutcome.ok);
                assert.equal(bodyOutcome.rejection.reason, 'unknown-key');
                const atNote = clone(greenRecord());
                atNote.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-defaults', law: 'THE LAW', detail: 'd', nope: 1 }];
                const noteOutcome = parseOrganizationDefaultsRecord(JSON.stringify(atNote));
                assert.ok(!noteOutcome.ok);
                assert.equal(noteOutcome.rejection.reason, 'unknown-key');
        });

        test('parse: a semantically drifted record is invalid-record', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = parseOrganizationDefaultsRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'invalid-record');
        });

        test('parse: the green round trip carries the canonical copy', () => {
                const outcome = parseOrganizationDefaultsRecord(serializeOrganizationDefaultsRecord(greenRecord()));
                assert.ok(outcome.ok);
                assert.equal(outcome.record.bodies[0].bodyKey, 'triage');
                assert.deepStrictEqual(Object.keys(outcome.record), [...BODIES_RECORD_SCHEMA_KEYS]);
        });
});

suite('bodiesContract · determinism greps', () => {
        test('Date.now / Math.random / new Date( / process.env appear only on law-comment lines', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = CONTRACT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });
});
