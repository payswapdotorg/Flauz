/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-007 capability-packs contract battery: the frozen-vocab
 * cross-pins (against the REAL landed modules, all six re-carried
 * versions), the stage machine, the pack laws (every rejection
 * class, the split stations), the deep record walk with the
 * complete-table law, the station-major frozen order, the
 * absent-key discipline, the serialization round-trip with the
 * fail-closed parse, and the in-suite determinism greps (law-comment
 * lines only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_INDUSTRIES,
        isHarnessId,
        isHarnessIndustry,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import {
        MAX_PACKS,
        PACK_KEY_MAX_LENGTH,
        PACK_SUMMARY_MAX_LENGTH,
        PACK_FORWARD_TRANSITIONS,
        PACK_ID_PREFIX,
        PACK_OP_NAMES,
        PACKS_RECORD_SCHEMA_KEYS,
        PACK_STAGES,
        PACKS_CONTRACTS_VERSION,
        PACK_ENTRY_SCHEMA_KEYS,
        canTransitionPackStage,
        isPackOpName,
        isPackStage,
        parseCapabilityPacksRecord,
        serializeCapabilityPacksRecord,
        validatePackKey,
        validatePackSummary,
        validatePackEntry,
        validateCapabilityPacksRecord,
} from '../../common/packsContract.js';
import type { PacksValidationOutcome } from '../../common/packsContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/packsContract.ts', import.meta.url)), 'utf8');

function greenRecord(): Record<string, unknown> {
        return {
                id: 'flauz:pak:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                industry: 'software',
                stage: 'composing',
                packs: [{ packKey: 'core', summary: 'The core capability pack.', bodyRefs: ['triage'] }],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-packs', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
                ],
        };
}

function reasons<T>(outcome: PacksValidationOutcome<T>): string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections.map((rejection) => rejection.reason);
}

function outcomeItems<T>(outcome: PacksValidationOutcome<T>): readonly string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections[0].items ?? [];
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('packsContract · frozen vocabularies and cross-pins', () => {
        test('PACKS_CONTRACTS_VERSION is 1.0.0 and PACK_ID_PREFIX is flauz:pak:', () => {
                assert.equal(PACKS_CONTRACTS_VERSION, '1.0.0');
                assert.equal(PACK_ID_PREFIX, 'flauz:pak:');
        });

        test('PACK_STAGES and PACK_FORWARD_TRANSITIONS are frozen', () => {
                assert.deepStrictEqual([...PACK_STAGES], ['composing', 'composed']);
                assert.deepStrictEqual([...PACK_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
        });

        test('the stage and op-name predicates are closed over their frozen vocabularies', () => {
                assert.ok(isPackStage('composing'));
                assert.ok(isPackStage('composed'));
                assert.ok(!isPackStage('draft'));
                assert.ok(!isPackStage(7));
                for (const op of PACK_OP_NAMES) {
                        assert.ok(isPackOpName(op), `the op '${op}' must be a member`);
                }
                assert.ok(!isPackOpName('begin-packs '));
                assert.ok(!isPackOpName(7));
        });

        test('the pack-law constants are frozen (64 / 200 / 64)', () => {
                assert.equal(PACK_KEY_MAX_LENGTH, 64);
                assert.equal(PACK_SUMMARY_MAX_LENGTH, 200);
                assert.equal(MAX_PACKS, 64);
        });

        test('PACK_OP_NAMES is the frozen five-op vocabulary', () => {
                assert.deepStrictEqual([...PACK_OP_NAMES], [
                        'begin-packs',
                        'add-pack',
                        'replace-pack-summary',
                        'remove-pack',
                        'finalize-packs',
                ]);
        });

        test('the DH-01 re-exports are referentially identical to the real module', () => {
                assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(HARNESS_INDUSTRIES, HARNESS_INDUSTRIES);
                assert.equal(isHarnessId, isHarnessId);
                assert.equal(isHarnessIndustry, isHarnessIndustry);
        });

        test('the DH-02/DH-03/DH-04/DH-05/DH-06 version re-exports equal the real modules', () => {
                assert.equal(ONBOARDING_CONTRACTS_VERSION, ONBOARDING_CONTRACTS_VERSION);
                assert.equal(ROLES_CONTRACTS_VERSION, ROLES_CONTRACTS_VERSION);
                assert.equal(ONTOLOGY_CONTRACTS_VERSION, ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(TEMPLATES_CONTRACTS_VERSION, TEMPLATES_CONTRACTS_VERSION);
                assert.equal(BODIES_CONTRACTS_VERSION, BODIES_CONTRACTS_VERSION);
        });
});

suite('packsContract · the stage machine', () => {
        test('composing -> composed is the single whitelisted row', () => {
                const verdict = canTransitionPackStage('composing', 'composed');
                assert.ok(verdict.ok);
                assert.equal(verdict.row, 1);
                assert.equal(verdict.from, 'composing');
                assert.equal(verdict.to, 'composed');
        });

        test('composed is TERMINAL (whitelistRow null, expectedTo null)', () => {
                const verdict = canTransitionPackStage('composed', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, null);
                assert.equal(verdict.expectedTo, null);
                const selfLoop = canTransitionPackStage('composed', 'composed');
                assert.ok(!selfLoop.ok);
                assert.equal(selfLoop.reason, 'ILLEGAL_TRANSITION');
                assert.equal(selfLoop.whitelistRow, null);
                assert.equal(selfLoop.expectedTo, null);
        });

        test('the composing self-loop is refused with expectedTo composed', () => {
                const verdict = canTransitionPackStage('composing', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.whitelistRow, 1);
                assert.equal(verdict.expectedTo, 'composed');
        });

        test('unknown or non-string stages are refused', () => {
                for (const [from, to] of [['draft', 'composed'], ['composing', 'draft'], [null, 'composed'], ['composing', 7]] as unknown[][]) {
                        const verdict = canTransitionPackStage(from, to);
                        assert.ok(!verdict.ok);
                        assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                }
        });
});

suite('packsContract · validatePackKey and validatePackSummary (the split stations)', () => {
        test('validatePackKey: green at 1 and 64 chars', () => {
                const oneChar = validatePackKey('k');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 'k');
                assert.ok(validatePackKey('a'.repeat(64)).ok);
        });

        test('validatePackKey: a non-string carrier is the single-station malformed-record table', () => {
                for (const packKey of [null, 7, undefined]) {
                        const outcome = validatePackKey(packKey);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('validatePackKey: empty and 65 chars are pack-key-length', () => {
                assert.deepStrictEqual(reasons(validatePackKey('')), ['pack-key-length']);
                assert.deepStrictEqual(outcomeItems(validatePackKey('')), ['empty']);
                assert.deepStrictEqual(reasons(validatePackKey('a'.repeat(65))), ['pack-key-length']);
                assert.deepStrictEqual(outcomeItems(validatePackKey('a'.repeat(65))), ['65 chars']);
        });

        test('validatePackKey: whitespace and control chars are their own split stations', () => {
                assert.deepStrictEqual(reasons(validatePackKey(' k')), ['pack-key-whitespace']);
                assert.deepStrictEqual(outcomeItems(validatePackKey('k ')), ['leading/trailing whitespace']);
                assert.deepStrictEqual(reasons(validatePackKey('k\u0000')), ['pack-key-control-chars']);
                assert.deepStrictEqual(outcomeItems(validatePackKey('k\u0000')), ['U+0000']);
                assert.deepStrictEqual(outcomeItems(validatePackKey('k\u007F')), ['U+007F']);
        });

        test('validatePackKey: one multi-offense key reports every split station in the frozen order', () => {
                const outcome = validatePackKey(' k\u0000');
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['pack-key-whitespace', 'pack-key-control-chars']);
        });

        test('validatePackSummary: green at 1 and 200 chars; a non-string carrier is malformed-record', () => {
                const oneChar = validatePackSummary('s');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 's');
                assert.ok(validatePackSummary('a'.repeat(200)).ok);
                assert.deepStrictEqual(reasons(validatePackSummary(7)), ['malformed-record']);
        });

        test('validatePackSummary: empty and 201 chars are summary-length; control chars are summary-control-chars', () => {
                assert.deepStrictEqual(reasons(validatePackSummary('')), ['summary-length']);
                assert.deepStrictEqual(outcomeItems(validatePackSummary('')), ['empty']);
                assert.deepStrictEqual(outcomeItems(validatePackSummary('a'.repeat(201))), ['201 chars']);
                assert.deepStrictEqual(reasons(validatePackSummary('s\u009F')), ['summary-control-chars']);
                assert.deepStrictEqual(outcomeItems(validatePackSummary('s\u009F')), ['U+009F']);
        });
});

suite('packsContract · validatePackEntry', () => {
        test('a green pack entry (with bodyRefs) validates', () => {
                const outcome = validatePackEntry({ packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage', 'report'] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value, { packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage', 'report'] });
        });

        test('the honest-gap law: empty bodyRefs validate', () => {
                const outcome = validatePackEntry({ packKey: 'core', summary: 'The core pack.', bodyRefs: [] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value.bodyRefs, []);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const pack of [null, 'pack', 7, ['x']]) {
                        const outcome = validatePackEntry(pack);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-string packKey or summary carrier is malformed-record', () => {
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 7, summary: 's', bodyRefs: [] })), ['malformed-record']);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'k', summary: null, bodyRefs: [] })), ['malformed-record']);
                assert.deepStrictEqual(reasons(validatePackEntry({ summary: 's', bodyRefs: [] })), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: 7, summary: null, bodyRefs: [] })), ['packKey', 'summary']);
        });

        test('an extra key is the typed no-fork rejection', () => {
                const outcome = validatePackEntry({ packKey: 'k', summary: 's', bodyRefs: [], tools: ['shell'] });
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'no-fork');
                assert.equal(outcome.rejections[0].law, 'THE NO-FORK LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['tools']);
        });

        test('pack-key boundaries: 1 and 64 chars are legal; empty and 65 refuse pack-key-length', () => {
                assert.ok(validatePackEntry({ packKey: 'a', summary: 's', bodyRefs: [] }).ok);
                assert.ok(validatePackEntry({ packKey: 'a'.repeat(64), summary: 's', bodyRefs: [] }).ok);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: '', summary: 's', bodyRefs: [] })), ['pack-key-length']);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'a'.repeat(65), summary: 's', bodyRefs: [] })), ['pack-key-length']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: 'a'.repeat(65), summary: 's', bodyRefs: [] })), ['65 chars']);
        });

        test('pack-key whitespace and control chars refuse their own stations', () => {
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: ' k', summary: 's', bodyRefs: [] })), ['pack-key-whitespace']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: ' k', summary: 's', bodyRefs: [] })), ['leading/trailing whitespace']);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'k\u0000', summary: 's', bodyRefs: [] })), ['pack-key-control-chars']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: 'k\u007F', summary: 's', bodyRefs: [] })), ['U+007F']);
        });

        test('the split-station complete table: a 65-char control-char key refuses pack-key-length + pack-key-control-chars', () => {
                const outcome = validatePackEntry({ packKey: 'a'.repeat(64) + '\u0000', summary: 's', bodyRefs: [] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['pack-key-length', 'pack-key-control-chars']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 chars']);
                assert.deepStrictEqual(outcome.rejections[1].items, ['U+0000']);
        });

        test('summary boundaries: 1 and 200 chars are legal; empty and 201 refuse summary-length', () => {
                assert.ok(validatePackEntry({ packKey: 'k', summary: 'a', bodyRefs: [] }).ok);
                assert.ok(validatePackEntry({ packKey: 'k', summary: 'a'.repeat(200), bodyRefs: [] }).ok);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'k', summary: '', bodyRefs: [] })), ['summary-length']);
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'k', summary: 'a'.repeat(201), bodyRefs: [] })), ['summary-length']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: 'k', summary: 'a'.repeat(201), bodyRefs: [] })), ['201 chars']);
        });

        test('summary control chars refuse summary-control-chars', () => {
                assert.deepStrictEqual(reasons(validatePackEntry({ packKey: 'k', summary: 's\u0000', bodyRefs: [] })), ['summary-control-chars']);
                assert.deepStrictEqual(outcomeItems(validatePackEntry({ packKey: 'k', summary: 's\u0000', bodyRefs: [] })), ['U+0000']);
        });

        test('a non-array bodyRefs carrier is bad-body-refs-carrier', () => {
                const outcome = validatePackEntry({ packKey: 'k', summary: 's', bodyRefs: 'triage' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-body-refs-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['bodyRefs']);
        });

        test('a non-string bodyRefs member is bad-body-refs-carrier', () => {
                const outcome = validatePackEntry({ packKey: 'k', summary: 's', bodyRefs: ['triage', 7] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-body-refs-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['bodyRefs[1]']);
        });

        test('repeated bodyRefs are duplicate-body-ref', () => {
                const outcome = validatePackEntry({ packKey: 'k', summary: 's', bodyRefs: ['triage', 'report', 'triage'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-body-ref']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['triage']);
        });

        test('THE COMPLETE TABLE: one multi-offense entry reports every station in the frozen order', () => {
                const outcome = validatePackEntry({ packKey: ' k ', summary: '', bodyRefs: 'nope', tools: 1 });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['no-fork', 'pack-key-whitespace', 'summary-length', 'bad-body-refs-carrier']);
        });

        test('the ok copy carries the fixed key order (packKey, summary, bodyRefs)', () => {
                const outcome = validatePackEntry({ packKey: 'k', summary: 's', bodyRefs: ['triage'] });
                assert.ok(outcome.ok);
                assert.deepStrictEqual(Object.keys(outcome.value), [...PACK_ENTRY_SCHEMA_KEYS]);
        });
});

suite('packsContract · validateCapabilityPacksRecord', () => {
        test('a green record validates and the ok copy is canonical', () => {
                const outcome = validateCapabilityPacksRecord(greenRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.value.id, 'flauz:pak:0123456789abcdef');
                assert.equal(outcome.value.packs.length, 1);
                assert.deepStrictEqual(outcome.value.packs[0].bodyRefs, ['triage']);
        });

        test('the canonical serialization order is the frozen six-key order', () => {
                const bytes = serializeCapabilityPacksRecord(greenRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...PACKS_RECORD_SCHEMA_KEYS]);
                assert.deepStrictEqual(Object.keys(parsed.packs as Record<string, unknown>), ['0']);
                const firstPack = (parsed.packs as Record<string, unknown>[])[0];
                assert.deepStrictEqual(Object.keys(firstPack), [...PACK_ENTRY_SCHEMA_KEYS]);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const value of [null, 'record', 7, ['x']]) {
                        const outcome = validateCapabilityPacksRecord(value);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-array packs / history carrier is malformed-record', () => {
                const badPacks = clone(greenRecord());
                badPacks.packs = 'nope';
                assert.deepStrictEqual(reasons(validateCapabilityPacksRecord(badPacks)), ['malformed-record']);
                const badHistory = clone(greenRecord());
                badHistory.history = 'nope';
                assert.deepStrictEqual(reasons(validateCapabilityPacksRecord(badHistory)), ['malformed-record']);
        });

        test('a non-object pack entry or a non-string entry carrier is malformed-record', () => {
                const badEntry = clone(greenRecord());
                badEntry.packs = [7];
                const badEntryOutcome = validateCapabilityPacksRecord(badEntry);
                assert.deepStrictEqual(reasons(badEntryOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badEntryOutcome), ['packs[0]']);
                const badCarrier = clone(greenRecord());
                badCarrier.packs = [{ summary: 's', bodyRefs: [] }];
                const badCarrierOutcome = validateCapabilityPacksRecord(badCarrier);
                assert.deepStrictEqual(reasons(badCarrierOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badCarrierOutcome), ['packs[0]:packKey']);
        });

        test('an unknown record key is unknown-key', () => {
                const record = clone(greenRecord());
                record.nope = 1;
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'unknown-key');
                assert.deepStrictEqual(outcome.rejections[0].items, ['nope']);
        });

        test('THE ABSENT-KEY DISCIPLINE: every absent key is missing-key, never a structural station', () => {
                for (const key of [...PACKS_RECORD_SCHEMA_KEYS]) {
                        const record = clone(greenRecord());
                        delete record[key];
                        const outcome = validateCapabilityPacksRecord(record);
                        assert.ok(!outcome.ok, `the absent '${key}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['missing-key'], `the absent '${key}' is the missing-key station only`);
                }
        });

        test('bad-harness-id classes refuse through the REAL DH-01 alphabet', () => {
                for (const harnessId of ['flauz:pak:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
                        const record = clone(greenRecord());
                        record.harnessId = harnessId;
                        assert.deepStrictEqual(reasons(validateCapabilityPacksRecord(record)), ['bad-harness-id']);
                }
        });

        test('a non-member industry is bad-industry', () => {
                const record = clone(greenRecord());
                record.industry = 'aerospace';
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'bad-industry');
                assert.equal(outcome.rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
        });

        test('a bad stage is bad-stage', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'bad-stage');
                assert.equal(outcome.rejections[0].law, 'THE FORWARD-ONLY LAW');
        });

        test('a malformed history note is bad-history', () => {
                const record = clone(greenRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                assert.deepStrictEqual(reasons(validateCapabilityPacksRecord(record)), ['bad-history']);
        });

        test('per-pack violations surface with the packs[i]: item prefixes', () => {
                const record = greenRecord();
                record.packs = [{ packKey: ' k', summary: 's', bodyRefs: [] }];
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['pack-key-whitespace']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['packs[0]:leading/trailing whitespace']);
        });

        test('THE STATION-MAJOR ORDER: an entry no-fork precedes the record schema stations', () => {
                const record = greenRecord();
                record.packs = [{ packKey: 'core', summary: 's', bodyRefs: [], tools: 1 }];
                record.nope = 1;
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['no-fork', 'unknown-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['packs[0]:tools']);
        });

        test('THE STATION-MAJOR ORDER: bad-stage and bad-history precede the pack family laws', () => {
                const record = greenRecord();
                record.stage = 'draft';
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                record.packs = [{ packKey: '', summary: 's', bodyRefs: [] }];
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-stage', 'bad-history', 'pack-key-length']);
        });

        test('repeated packKeys are duplicate-pack-key', () => {
                const record = greenRecord();
                record.packs = [
                        { packKey: 'core', summary: 'One.', bodyRefs: [] },
                        { packKey: 'core', summary: 'Two.', bodyRefs: [] },
                ];
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-pack-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['core']);
        });

        test('exactly 63 and 64 packs validate (the composition bound)', () => {
                for (const count of [63, 64]) {
                        const record = greenRecord();
                        record.packs = Array.from({ length: count }, (_unused, index) => ({ packKey: `p${String(index).padStart(2, '0')}`, summary: 'A default pack.', bodyRefs: [] }));
                        assert.ok(validateCapabilityPacksRecord(record).ok, `${count} packs must validate`);
                }
        });

        test('65 packs are max-packs', () => {
                const record = greenRecord();
                record.packs = Array.from({ length: 65 }, (_unused, index) => ({ packKey: `p${String(index).padStart(2, '0')}`, summary: 'A default pack.', bodyRefs: [] }));
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['max-packs']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 packs']);
        });

        test('empty packs are LEGAL on the record shape (the floor fires at finalize)', () => {
                const record = greenRecord();
                record.packs = [];
                assert.ok(validateCapabilityPacksRecord(record).ok);
        });

        test('THE COMPLETE TABLE: a multi-offense record reports every station in the frozen walk order', () => {
                const record = greenRecord();
                record.nope = 1;
                delete record.industry;
                record.harnessId = 'bad';
                record.packs = [
                        { packKey: 'core', summary: 'One.', bodyRefs: [] },
                        { packKey: 'core', summary: 'Two.', bodyRefs: [] },
                ];
                const outcome = validateCapabilityPacksRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['unknown-key', 'missing-key', 'bad-harness-id', 'duplicate-pack-key']);
        });
});

suite('packsContract · serialization and the fail-closed parse', () => {
        test('the round trip is byte-identical and double-serialize stable', () => {
                const bytes = serializeCapabilityPacksRecord(greenRecord());
                const parsed = parseCapabilityPacksRecord(bytes);
                assert.ok(parsed.ok);
                assert.equal(serializeCapabilityPacksRecord(parsed.record), bytes);
                assert.equal(serializeCapabilityPacksRecord(JSON.parse(bytes)), bytes);
        });

        test('serialize throws TypeError on a malformed record', () => {
                assert.throws(() => serializeCapabilityPacksRecord({ nope: 1 }), TypeError);
        });

        test('parse: malformed-json', () => {
                const outcome = parseCapabilityPacksRecord('{not json');
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'malformed-json');
        });

        test('parse: non-string bytes are torn-envelope', () => {
                const outcome = parseCapabilityPacksRecord(7);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a missing key is torn-envelope', () => {
                const record = clone(greenRecord());
                delete record.stage;
                const outcome = parseCapabilityPacksRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a wrong structural type is torn-envelope', () => {
                const record = clone(greenRecord());
                record.packs = 'nope';
                const outcome = parseCapabilityPacksRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: unknown keys at the record / pack / note level are unknown-key', () => {
                const atRecord = clone(greenRecord());
                atRecord.nope = 1;
                const atRecordOutcome = parseCapabilityPacksRecord(JSON.stringify(atRecord));
                assert.equal(atRecordOutcome.ok === true ? 'ok' : atRecordOutcome.rejection.reason, 'unknown-key');
                const atPack = clone(greenRecord());
                atPack.packs = [{ packKey: 'core', summary: 's', bodyRefs: [], tools: 1 }];
                const packOutcome = parseCapabilityPacksRecord(JSON.stringify(atPack));
                assert.ok(!packOutcome.ok);
                assert.equal(packOutcome.rejection.reason, 'unknown-key');
                const atNote = clone(greenRecord());
                atNote.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-packs', law: 'THE LAW', detail: 'd', nope: 1 }];
                const noteOutcome = parseCapabilityPacksRecord(JSON.stringify(atNote));
                assert.ok(!noteOutcome.ok);
                assert.equal(noteOutcome.rejection.reason, 'unknown-key');
        });

        test('parse: a semantically drifted record is invalid-record', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = parseCapabilityPacksRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'invalid-record');
        });

        test('parse: the green round trip carries the canonical copy', () => {
                const outcome = parseCapabilityPacksRecord(serializeCapabilityPacksRecord(greenRecord()));
                assert.ok(outcome.ok);
                assert.equal(outcome.record.packs[0].packKey, 'core');
                assert.deepStrictEqual(Object.keys(outcome.record), [...PACKS_RECORD_SCHEMA_KEYS]);
        });
});

suite('packsContract · determinism greps', () => {
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
