/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-008 profiles contract battery: the frozen-vocabulary cross-pins
 * (against the REAL authority modules - the ZC-006 catalog permission
 * table and risk tiers, the lab evidence ladder and eval dimensions -
 * plus the seven landed family versions re-carried by reference), the
 * stage machine, the profile laws (every rejection class, the split
 * stations, the authority-binding stations), the deep record walk
 * with the complete-table law, the station-major frozen order, the
 * absent-key discipline, the serialization round-trip (the canonical
 * fixed-key-order bytes, the entries sorted by profileKey) with the
 * fail-closed parse (torn, mismatched, unknown keys, non-canonical
 * order), and the in-suite determinism greps (law-comment lines
 * only).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_DOMAIN_HARNESS_CONTRACTS_VERSION,
        HARNESS_INDUSTRIES as REAL_HARNESS_INDUSTRIES,
        isHarnessId as REAL_isHarnessId,
} from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_CONTRACTS_VERSION } from '../../../onboarding/common/onboardingContract.js';
import { ROLES_CONTRACTS_VERSION as REAL_ROLES_CONTRACTS_VERSION } from '../../../roles/common/rolesContract.js';
import { ONTOLOGY_CONTRACTS_VERSION as REAL_ONTOLOGY_CONTRACTS_VERSION } from '../../../ontology/common/ontologyContract.js';
import { TEMPLATES_CONTRACTS_VERSION as REAL_TEMPLATES_CONTRACTS_VERSION } from '../../../templates/common/templatesContract.js';
import { BODIES_CONTRACTS_VERSION as REAL_BODIES_CONTRACTS_VERSION } from '../../../bodies/common/bodiesContract.js';
import { PACKS_CONTRACTS_VERSION as REAL_PACKS_CONTRACTS_VERSION } from '../../../packs/common/packsContract.js';
import {
        CATALOG_PERMISSION_IDS as REAL_CATALOG_PERMISSION_IDS,
        CATALOG_PERMISSION_RISK_TIERS as REAL_CATALOG_PERMISSION_RISK_TIERS,
        CATALOG_PERMISSION_TABLE as REAL_CATALOG_PERMISSION_TABLE,
        isCatalogPermissionId as REAL_isCatalogPermissionId,
        isCatalogPermissionRiskTier as REAL_isCatalogPermissionRiskTier,
} from '../../../../capabilities/packs/common/catalog.js';
import {
        MAX_PROFILES,
        PROFILE_KEY_MAX_LENGTH,
        PROFILE_SUMMARY_MAX_LENGTH,
        PROFILES_FORWARD_TRANSITIONS,
        PROFILES_ID_PREFIX,
        PROFILES_OP_NAMES,
        PROFILES_RECORD_SCHEMA_KEYS,
        PROFILE_ENTRY_SCHEMA_KEYS,
        PROFILES_NOTE_SCHEMA_KEYS,
        PROFILES_STAGES,
        PROFILES_CONTRACTS_VERSION,
        PROFILES_REJECTION_REASONS,
        PROFILES_PARSE_REJECTION_REASONS,
        PROFILES_EVIDENCE_LADDER,
        PROFILES_EVAL_DIMENSIONS,
        canTransitionProfilesStage,
        isProfilesOpName,
        isProfilesStage,
        isProfilesId,
        isProfilesRejectionReason,
        isProfilesParseRejectionReason,
        isLabEvidenceLevel,
        isEvalDimension,
        parseProfilesRecord,
        serializeProfilesRecord,
        validateProfileKey,
        validateProfileSummary,
        validateProfileEntry,
        validateProfilesRecord,
} from '../../common/profilesContract.js';
import type { ProfilesValidationOutcome } from '../../common/profilesContract.js';

const CONTRACT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/profilesContract.ts', import.meta.url)), 'utf8');

function greenProfile(): Record<string, unknown> {
        return {
                profileKey: 'core',
                summary: 'The core policy profile.',
                permissionRefs: ['read-files', 'network-access'],
                approvalTiers: ['high'],
                evidenceFloor: 'local-real',
                kpiDimensions: ['success', 'cost'],
        };
}

function greenRecord(): Record<string, unknown> {
        return {
                profilesId: 'flauz:prf:0123456789abcdef',
                harnessId: 'flauz:hrn:0123456789abcdef',
                stage: 'composing',
                profiles: [greenProfile()],
                history: [
                        { at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-profiles', law: 'THE FORWARD-ONLY LAW', detail: 'began the record' },
                ],
        };
}

function reasons<T>(outcome: ProfilesValidationOutcome<T>): string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections.map((rejection) => rejection.reason);
}

function outcomeItems<T>(outcome: ProfilesValidationOutcome<T>): readonly string[] {
        if (outcome.ok) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.rejections[0].items ?? [];
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

suite('profilesContract · frozen vocabularies and cross-pins', () => {
        test('PROFILES_CONTRACTS_VERSION is 1.0.0 and PROFILES_ID_PREFIX is flauz:prf:', () => {
                assert.equal(PROFILES_CONTRACTS_VERSION, '1.0.0');
                assert.equal(PROFILES_ID_PREFIX, 'flauz:prf:');
        });

        test('PROFILES_STAGES and PROFILES_FORWARD_TRANSITIONS are frozen', () => {
                assert.deepStrictEqual([...PROFILES_STAGES], ['composing', 'composed']);
                assert.deepStrictEqual([...PROFILES_FORWARD_TRANSITIONS], [{ from: 'composing', to: 'composed' }]);
        });

        test('the stage and op-name predicates are closed over their frozen vocabularies', () => {
                assert.ok(isProfilesStage('composing'));
                assert.ok(isProfilesStage('composed'));
                assert.ok(!isProfilesStage('draft'));
                assert.ok(!isProfilesStage(7));
                for (const op of PROFILES_OP_NAMES) {
                        assert.ok(isProfilesOpName(op), `the op '${op}' must be a member`);
                }
                assert.ok(!isProfilesOpName('begin-profiles '));
                assert.ok(!isProfilesOpName(7));
        });

        test('the profile-law constants are frozen (64 / 200 / 64)', () => {
                assert.equal(PROFILE_KEY_MAX_LENGTH, 64);
                assert.equal(PROFILE_SUMMARY_MAX_LENGTH, 200);
                assert.equal(MAX_PROFILES, 64);
        });

        test('PROFILES_OP_NAMES is the frozen five-op vocabulary', () => {
                assert.deepStrictEqual([...PROFILES_OP_NAMES], [
                        'begin-profiles',
                        'add-profile',
                        'replace-profile-summary',
                        'remove-profile',
                        'finalize-profiles',
                ]);
        });

        test('PROFILES_REJECTION_REASONS is the frozen twenty-four-station walk order', () => {
                assert.deepStrictEqual([...PROFILES_REJECTION_REASONS], [
                        'malformed-record',
                        'no-fork',
                        'unknown-key',
                        'missing-key',
                        'bad-harness-id',
                        'bad-stage',
                        'bad-history',
                        'profile-key-length',
                        'profile-key-whitespace',
                        'profile-key-control-chars',
                        'summary-length',
                        'summary-control-chars',
                        'duplicate-profile-key',
                        'max-profiles',
                        'bad-permission-refs-carrier',
                        'bad-permission-ref',
                        'duplicate-permission-ref',
                        'bad-approval-tiers-carrier',
                        'bad-approval-tier',
                        'duplicate-approval-tier',
                        'bad-evidence-floor',
                        'bad-kpi-dimensions-carrier',
                        'bad-kpi-dimension',
                        'duplicate-kpi-dimension',
                ]);
                for (const reason of PROFILES_REJECTION_REASONS) {
                        assert.ok(isProfilesRejectionReason(reason), `the reason '${reason}' must be a member`);
                }
                assert.ok(!isProfilesRejectionReason('bad-industry'));
        });

        test('PROFILES_PARSE_REJECTION_REASONS is the frozen six-reason parse shape', () => {
                assert.deepStrictEqual([...PROFILES_PARSE_REJECTION_REASONS], [
                        'malformed-json',
                        'torn-envelope',
                        'unknown-contract-version',
                        'unknown-key',
                        'invalid-record',
                        'non-canonical',
                ]);
                for (const reason of PROFILES_PARSE_REJECTION_REASONS) {
                        assert.ok(isProfilesParseRejectionReason(reason), `the reason '${reason}' must be a member`);
                }
                assert.ok(!isProfilesParseRejectionReason('non-canonical-order'));
        });

        test('the record / entry / note schema keys are frozen in the canonical fixed-key order', () => {
                assert.deepStrictEqual([...PROFILES_RECORD_SCHEMA_KEYS], ['profilesId', 'harnessId', 'stage', 'profiles', 'history']);
                assert.deepStrictEqual([...PROFILE_ENTRY_SCHEMA_KEYS], ['profileKey', 'summary', 'permissionRefs', 'approvalTiers', 'evidenceFloor', 'kpiDimensions']);
                assert.deepStrictEqual([...PROFILES_NOTE_SCHEMA_KEYS], ['at', 'fromStage', 'toStage', 'op', 'law', 'detail']);
        });

        test('isProfilesId is the flauz:prf:<16-hex> form law', () => {
                assert.ok(isProfilesId('flauz:prf:0123456789abcdef'));
                assert.ok(!isProfilesId('flauz:pak:0123456789abcdef'));
                assert.ok(!isProfilesId('flauz:prf:0123456789ABCDEF'));
                assert.ok(!isProfilesId('flauz:prf:0123456789abcde'));
                assert.ok(!isProfilesId(7));
        });

        test('the DH-01 re-exports are referentially identical to the real module', async () => {
                const module = await import('../../common/profilesContract.js');
                assert.equal(module.isHarnessId, REAL_isHarnessId);
                assert.equal(module.DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_DOMAIN_HARNESS_CONTRACTS_VERSION);
                assert.equal(module.HARNESS_INDUSTRIES, REAL_HARNESS_INDUSTRIES);
                assert.deepStrictEqual([...module.HARNESS_INDUSTRIES], [...REAL_HARNESS_INDUSTRIES]);
        });

        test('the six prior family versions (DH-02..DH-07) re-carried here equal the real modules (DH-01 pinned above)', async () => {
                const module = await import('../../common/profilesContract.js');
                assert.equal(module.ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_CONTRACTS_VERSION);
                assert.equal(module.ROLES_CONTRACTS_VERSION, REAL_ROLES_CONTRACTS_VERSION);
                assert.equal(module.ONTOLOGY_CONTRACTS_VERSION, REAL_ONTOLOGY_CONTRACTS_VERSION);
                assert.equal(module.TEMPLATES_CONTRACTS_VERSION, REAL_TEMPLATES_CONTRACTS_VERSION);
                assert.equal(module.BODIES_CONTRACTS_VERSION, REAL_BODIES_CONTRACTS_VERSION);
                assert.equal(module.PACKS_CONTRACTS_VERSION, REAL_PACKS_CONTRACTS_VERSION);
        });

        test('THE AUTHORITY CROSS-PIN: the permission vocabulary IS the real catalog\'s (by import, never transcribed)', async () => {
                const module = await import('../../common/profilesContract.js');
                assert.equal(module.CATALOG_PERMISSION_IDS, REAL_CATALOG_PERMISSION_IDS);
                assert.equal(module.isCatalogPermissionId, REAL_isCatalogPermissionId);
                assert.deepStrictEqual([...module.CATALOG_PERMISSION_IDS], ['read-files', 'execute-command', 'network-access', 'write-workspace']);
        });

        test('THE AUTHORITY CROSS-PIN: the risk tiers ARE the real catalog\'s, and the live table is consistent', async () => {
                const module = await import('../../common/profilesContract.js');
                assert.equal(module.CATALOG_PERMISSION_RISK_TIERS, REAL_CATALOG_PERMISSION_RISK_TIERS);
                assert.equal(module.isCatalogPermissionRiskTier, REAL_isCatalogPermissionRiskTier);
                assert.deepStrictEqual([...module.CATALOG_PERMISSION_RISK_TIERS], ['low', 'moderate', 'high']);
                // the live-table consistency pin: every key of the imported table is a
                // REAL permission id, and every tier is a REAL risk tier.
                assert.equal(module.CATALOG_PERMISSION_TABLE, REAL_CATALOG_PERMISSION_TABLE);
                for (const permission of Object.keys(REAL_CATALOG_PERMISSION_TABLE)) {
                        assert.ok(REAL_isCatalogPermissionId(permission), `the live table key '${permission}' must be a catalog permission id`);
                        assert.ok(REAL_isCatalogPermissionRiskTier(REAL_CATALOG_PERMISSION_TABLE[permission as keyof typeof REAL_CATALOG_PERMISSION_TABLE]), `the live table tier for '${permission}' must be a real risk tier`);
                }
        });

        test('the imported permission predicate behaves over the real four-member vocabulary', () => {
                for (const permission of REAL_CATALOG_PERMISSION_IDS) {
                        assert.ok(REAL_isCatalogPermissionId(permission), `'${permission}' must be a member`);
                }
                assert.ok(!REAL_isCatalogPermissionId('root-access'));
                assert.ok(!REAL_isCatalogPermissionId('read-secret'));
                assert.ok(!REAL_isCatalogPermissionId(7));
        });

        test('THE AUTHORITY CROSS-PIN: the evidence ladder IS the real six-rung LabEvidenceLevel ladder', () => {
                assert.deepStrictEqual([...PROFILES_EVIDENCE_LADDER], [
                        'fixture',
                        'simulated',
                        'local-real',
                        'runtime-real',
                        'live-provider',
                        'production-real',
                ]);
                for (const rung of PROFILES_EVIDENCE_LADDER) {
                        assert.ok(isLabEvidenceLevel(rung), `the rung '${rung}' must be a member`);
                }
                // near-miss rungs are refused (the ladder is closed - never overstated)
                for (const nearMiss of ['staging', 'demo', 'production', 'local', 7, null]) {
                        assert.ok(!isLabEvidenceLevel(nearMiss), `'${String(nearMiss)}' must not be a rung`);
                }
        });

        test('the evidence ladder and eval dimensions are the pinned type-exhaustive mirrors of the imported unions (the source pin)', () => {
                assert.ok(CONTRACT_SOURCE.includes('Readonly<Record<LabEvidenceLevel, true>>'), 'the ladder runtime table must be the pinned type-exhaustive mirror of the imported LabEvidenceLevel union');
                assert.ok(CONTRACT_SOURCE.includes('Readonly<Record<EvalDimension, true>>'), 'the dims runtime table must be the pinned type-exhaustive mirror of the imported EvalDimension union');
                assert.ok(CONTRACT_SOURCE.includes("import type { LabEvidenceLevel, EvalDimension } from '../../../lab/common/labContracts.js'"), 'the ladder and dims types must be imported from the REAL lab contracts module');
        });

        test('THE AUTHORITY CROSS-PIN: the eval dimensions ARE the real four EvalDimension members', () => {
                assert.deepStrictEqual([...PROFILES_EVAL_DIMENSIONS], ['success', 'quality', 'latency', 'cost']);
                for (const dimension of PROFILES_EVAL_DIMENSIONS) {
                        assert.ok(isEvalDimension(dimension), `the dimension '${dimension}' must be a member`);
                }
                for (const nearMiss of ['throughput', 'safety', 'satisfaction', 7, null]) {
                        assert.ok(!isEvalDimension(nearMiss), `'${String(nearMiss)}' must not be a dimension`);
                }
        });
});

suite('profilesContract · the stage machine', () => {
        test('composing -> composed is the single whitelisted row', () => {
                const verdict = canTransitionProfilesStage('composing', 'composed');
                assert.ok(verdict.ok);
                assert.equal(verdict.row, 1);
                assert.equal(verdict.from, 'composing');
                assert.equal(verdict.to, 'composed');
        });

        test('composed is TERMINAL (whitelistRow null, expectedTo null)', () => {
                const verdict = canTransitionProfilesStage('composed', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                assert.equal(verdict.whitelistRow, null);
                assert.equal(verdict.expectedTo, null);
                const selfLoop = canTransitionProfilesStage('composed', 'composed');
                assert.ok(!selfLoop.ok);
                assert.equal(selfLoop.reason, 'ILLEGAL_TRANSITION');
                assert.equal(selfLoop.whitelistRow, null);
                assert.equal(selfLoop.expectedTo, null);
        });

        test('the composing self-loop is refused with expectedTo composed', () => {
                const verdict = canTransitionProfilesStage('composing', 'composing');
                assert.ok(!verdict.ok);
                assert.equal(verdict.whitelistRow, 1);
                assert.equal(verdict.expectedTo, 'composed');
        });

        test('unknown or non-string stages are refused', () => {
                for (const [from, to] of [['draft', 'composed'], ['composing', 'draft'], [null, 'composed'], ['composing', 7]] as unknown[][]) {
                        const verdict = canTransitionProfilesStage(from, to);
                        assert.ok(!verdict.ok);
                        assert.equal(verdict.reason, 'ILLEGAL_TRANSITION');
                }
        });
});

suite('profilesContract · validateProfileKey and validateProfileSummary (the split stations)', () => {
        test('validateProfileKey: green at 1 and 64 chars', () => {
                const oneChar = validateProfileKey('k');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 'k');
                assert.ok(validateProfileKey('a'.repeat(64)).ok);
        });

        test('validateProfileKey: a non-string carrier is the single-station malformed-record table', () => {
                for (const profileKey of [null, 7, undefined]) {
                        const outcome = validateProfileKey(profileKey);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('validateProfileKey: empty and 65 chars are profile-key-length', () => {
                assert.deepStrictEqual(reasons(validateProfileKey('')), ['profile-key-length']);
                assert.deepStrictEqual(outcomeItems(validateProfileKey('')), ['empty']);
                assert.deepStrictEqual(reasons(validateProfileKey('a'.repeat(65))), ['profile-key-length']);
                assert.deepStrictEqual(outcomeItems(validateProfileKey('a'.repeat(65))), ['65 chars']);
        });

        test('validateProfileKey: whitespace and control chars are their own split stations', () => {
                assert.deepStrictEqual(reasons(validateProfileKey(' k')), ['profile-key-whitespace']);
                assert.deepStrictEqual(outcomeItems(validateProfileKey('k ')), ['leading/trailing whitespace']);
                assert.deepStrictEqual(reasons(validateProfileKey('k\u0000')), ['profile-key-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateProfileKey('k\u0000')), ['U+0000']);
                assert.deepStrictEqual(outcomeItems(validateProfileKey('k\u007F')), ['U+007F']);
        });

        test('validateProfileKey: one multi-offense key reports every split station in the frozen order', () => {
                const outcome = validateProfileKey(' k\u0000');
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['profile-key-whitespace', 'profile-key-control-chars']);
        });

        test('validateProfileSummary: green at 1 and 200 chars; a non-string carrier is malformed-record', () => {
                const oneChar = validateProfileSummary('s');
                assert.ok(oneChar.ok);
                assert.equal(oneChar.value, 's');
                assert.ok(validateProfileSummary('a'.repeat(200)).ok);
                assert.deepStrictEqual(reasons(validateProfileSummary(7)), ['malformed-record']);
        });

        test('validateProfileSummary: empty and 201 chars are summary-length; control chars are summary-control-chars', () => {
                assert.deepStrictEqual(reasons(validateProfileSummary('')), ['summary-length']);
                assert.deepStrictEqual(outcomeItems(validateProfileSummary('')), ['empty']);
                assert.deepStrictEqual(outcomeItems(validateProfileSummary('a'.repeat(201))), ['201 chars']);
                assert.deepStrictEqual(reasons(validateProfileSummary('s\u009F')), ['summary-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateProfileSummary('s\u009F')), ['U+009F']);
        });
});

suite('profilesContract · validateProfileEntry', () => {
        test('a green profile entry validates (the canonical six-key copy)', () => {
                const outcome = validateProfileEntry(greenProfile());
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value, {
                        profileKey: 'core',
                        summary: 'The core policy profile.',
                        permissionRefs: ['read-files', 'network-access'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'local-real',
                        kpiDimensions: ['success', 'cost'],
                });
        });

        test('the honest-gap law: empty permissionRefs, approvalTiers and kpiDimensions validate', () => {
                const profile = greenProfile();
                profile.permissionRefs = [];
                profile.approvalTiers = [];
                profile.kpiDimensions = [];
                const outcome = validateProfileEntry(profile);
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value.permissionRefs, []);
                assert.deepStrictEqual(outcome.value.approvalTiers, []);
                assert.deepStrictEqual(outcome.value.kpiDimensions, []);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const profile of [null, 'profile', 7, ['x']]) {
                        const outcome = validateProfileEntry(profile);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-string profileKey or summary carrier is malformed-record', () => {
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), profileKey: 7 })), ['malformed-record']);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), summary: null })), ['malformed-record']);
                const noKey = greenProfile();
                delete noKey.profileKey;
                assert.deepStrictEqual(reasons(validateProfileEntry(noKey)), ['malformed-record']);
                const missing = validateProfileEntry({ profileKey: 7, summary: null, permissionRefs: [], approvalTiers: [], evidenceFloor: 'fixture', kpiDimensions: [] });
                assert.deepStrictEqual(outcomeItems(missing), ['profileKey', 'summary']);
        });

        test('an extra key is the typed no-fork rejection (THE NO-FORK LAW)', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), executor: 'shell' });
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'no-fork');
                assert.equal(outcome.rejections[0].law, 'THE NO-FORK LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['executor']);
        });

        test('profile-key boundaries: 1 and 64 chars are legal; empty and 65 refuse profile-key-length', () => {
                assert.ok(validateProfileEntry({ ...greenProfile(), profileKey: 'a' }).ok);
                assert.ok(validateProfileEntry({ ...greenProfile(), profileKey: 'a'.repeat(64) }).ok);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), profileKey: '' })), ['profile-key-length']);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), profileKey: 'a'.repeat(65) })), ['profile-key-length']);
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), profileKey: 'a'.repeat(65) })), ['65 chars']);
        });

        test('profile-key whitespace and control chars refuse their own stations', () => {
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), profileKey: ' k' })), ['profile-key-whitespace']);
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), profileKey: ' k' })), ['leading/trailing whitespace']);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), profileKey: 'k\u0000' })), ['profile-key-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), profileKey: 'k\u007F' })), ['U+007F']);
        });

        test('the split-station complete table: a 65-char control-char key refuses profile-key-length + profile-key-control-chars', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), profileKey: 'a'.repeat(64) + '\u0000' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['profile-key-length', 'profile-key-control-chars']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 chars']);
                assert.deepStrictEqual(outcome.rejections[1].items, ['U+0000']);
        });

        test('summary boundaries: 1 and 200 chars are legal; empty and 201 refuse summary-length', () => {
                assert.ok(validateProfileEntry({ ...greenProfile(), summary: 'a' }).ok);
                assert.ok(validateProfileEntry({ ...greenProfile(), summary: 'a'.repeat(200) }).ok);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), summary: '' })), ['summary-length']);
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), summary: 'a'.repeat(201) })), ['summary-length']);
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), summary: 'a'.repeat(201) })), ['201 chars']);
        });

        test('summary control chars refuse summary-control-chars', () => {
                assert.deepStrictEqual(reasons(validateProfileEntry({ ...greenProfile(), summary: 's\u0000' })), ['summary-control-chars']);
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), summary: 's\u0000' })), ['U+0000']);
        });

        test('a non-array permissionRefs carrier is bad-permission-refs-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), permissionRefs: 'read-files' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-permission-refs-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['permissionRefs']);
        });

        test('a non-string permissionRefs member is bad-permission-refs-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), permissionRefs: ['read-files', 7] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-permission-refs-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['permissionRefs[1]']);
        });

        test('a non-catalog permissionRef is bad-permission-ref (THE AUTHORITY-BINDING LAW, each offender named once)', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), permissionRefs: ['read-files', 'root-access', 'read-secret', 'root-access'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-permission-ref', 'duplicate-permission-ref']);
                assert.equal(outcome.rejections[0].law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['root-access', 'read-secret']);
        });

        test('repeated permissionRefs are duplicate-permission-ref', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), permissionRefs: ['read-files', 'write-workspace', 'read-files'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-permission-ref']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['read-files']);
        });

        test('a non-array approvalTiers carrier is bad-approval-tiers-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), approvalTiers: 'high' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-approval-tiers-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['approvalTiers']);
        });

        test('a non-string approvalTiers member is bad-approval-tiers-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), approvalTiers: ['high', 7] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-approval-tiers-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['approvalTiers[1]']);
        });

        test('a non-risk-tier approvalTier is bad-approval-tier (the REAL list, never transcribed; the fact-tier "none" is NOT a risk tier)', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), approvalTiers: ['critical', 'none', 'critical'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-approval-tier', 'duplicate-approval-tier']);
                assert.equal(outcome.rejections[0].law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['critical', 'none']);
        });

        test('repeated approvalTiers are duplicate-approval-tier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), approvalTiers: ['low', 'high', 'low'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-approval-tier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['low']);
        });

        test('a non-ladder evidenceFloor is bad-evidence-floor (exactly one REAL rung per profile)', () => {
                for (const evidenceFloor of ['staging', 'production', 'local', 7, null]) {
                        const outcome = validateProfileEntry({ ...greenProfile(), evidenceFloor });
                        assert.ok(!outcome.ok, `'${String(evidenceFloor)}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['bad-evidence-floor']);
                        assert.equal(outcome.rejections[0].law, 'THE AUTHORITY-BINDING LAW');
                }
                assert.deepStrictEqual(outcomeItems(validateProfileEntry({ ...greenProfile(), evidenceFloor: 7 })), ['7']);
        });

        test('a non-array kpiDimensions carrier is bad-kpi-dimensions-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), kpiDimensions: 'success' });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-kpi-dimensions-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['kpiDimensions']);
        });

        test('a non-string kpiDimensions member is bad-kpi-dimensions-carrier', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), kpiDimensions: ['success', 7] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-kpi-dimensions-carrier']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['kpiDimensions[1]']);
        });

        test('a non-member kpiDimension is bad-kpi-dimension', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), kpiDimensions: ['success', 'throughput', 'safety', 'throughput'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-kpi-dimension', 'duplicate-kpi-dimension']);
                assert.equal(outcome.rejections[0].law, 'THE AUTHORITY-BINDING LAW');
                assert.deepStrictEqual(outcome.rejections[0].items, ['throughput', 'safety']);
        });

        test('repeated kpiDimensions are duplicate-kpi-dimension', () => {
                const outcome = validateProfileEntry({ ...greenProfile(), kpiDimensions: ['success', 'cost', 'success'] });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-kpi-dimension']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['success']);
        });

        test('THE COMPLETE TABLE: one multi-offense entry reports every station in the frozen order', () => {
                const outcome = validateProfileEntry({
                        profileKey: ' k ',
                        summary: '',
                        permissionRefs: 'nope',
                        approvalTiers: 'nope',
                        evidenceFloor: 'staging',
                        kpiDimensions: 'nope',
                        executor: 1,
                });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), [
                        'no-fork',
                        'profile-key-whitespace',
                        'summary-length',
                        'bad-permission-refs-carrier',
                        'bad-approval-tiers-carrier',
                        'bad-evidence-floor',
                        'bad-kpi-dimensions-carrier',
                ]);
        });

        test('the four authority-binding stations report in the frozen order (permission, tier, floor, dimension)', () => {
                const outcome = validateProfileEntry({
                        profileKey: 'core',
                        summary: 'The core policy profile.',
                        permissionRefs: ['root-access'],
                        approvalTiers: ['critical'],
                        evidenceFloor: 'staging',
                        kpiDimensions: ['throughput'],
                });
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-permission-ref', 'bad-approval-tier', 'bad-evidence-floor', 'bad-kpi-dimension']);
        });

        test('the ok copy carries the fixed key order (the exact six keys)', () => {
                const outcome = validateProfileEntry(greenProfile());
                assert.ok(outcome.ok);
                assert.deepStrictEqual(Object.keys(outcome.value), [...PROFILE_ENTRY_SCHEMA_KEYS]);
        });
});

suite('profilesContract · validateProfilesRecord', () => {
        test('a green record validates and the ok copy is canonical', () => {
                const outcome = validateProfilesRecord(greenRecord());
                assert.ok(outcome.ok);
                assert.equal(outcome.value.profilesId, 'flauz:prf:0123456789abcdef');
                assert.equal(outcome.value.harnessId, 'flauz:hrn:0123456789abcdef');
                assert.equal(outcome.value.profiles.length, 1);
                assert.deepStrictEqual(outcome.value.profiles[0].permissionRefs, ['read-files', 'network-access']);
        });

        test('the canonical serialization order is the frozen five-key record order and the six-key entry order', () => {
                const bytes = serializeProfilesRecord(greenRecord());
                const parsed = JSON.parse(bytes) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), [...PROFILES_RECORD_SCHEMA_KEYS]);
                const firstProfile = (parsed.profiles as Record<string, unknown>[])[0];
                assert.deepStrictEqual(Object.keys(firstProfile), [...PROFILE_ENTRY_SCHEMA_KEYS]);
        });

        test('a non-object is the single-station malformed-record table', () => {
                for (const value of [null, 'record', 7, ['x']]) {
                        const outcome = validateProfilesRecord(value);
                        assert.ok(!outcome.ok);
                        assert.deepStrictEqual(reasons(outcome), ['malformed-record']);
                }
        });

        test('a non-array profiles / history carrier is malformed-record', () => {
                const badProfiles = clone(greenRecord());
                badProfiles.profiles = 'nope';
                assert.deepStrictEqual(reasons(validateProfilesRecord(badProfiles)), ['malformed-record']);
                const badHistory = clone(greenRecord());
                badHistory.history = 'nope';
                assert.deepStrictEqual(reasons(validateProfilesRecord(badHistory)), ['malformed-record']);
        });

        test('a non-object profile entry or a non-string entry carrier is malformed-record', () => {
                const badEntry = clone(greenRecord());
                badEntry.profiles = [7];
                const badEntryOutcome = validateProfilesRecord(badEntry);
                assert.deepStrictEqual(reasons(badEntryOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badEntryOutcome), ['profiles[0]']);
                const badCarrier = clone(greenRecord());
                badCarrier.profiles = [{ summary: 's', permissionRefs: [], approvalTiers: [], evidenceFloor: 'fixture', kpiDimensions: [] }];
                const badCarrierOutcome = validateProfilesRecord(badCarrier);
                assert.deepStrictEqual(reasons(badCarrierOutcome), ['malformed-record']);
                assert.deepStrictEqual(outcomeItems(badCarrierOutcome), ['profiles[0]:profileKey']);
        });

        test('an unknown record key is unknown-key', () => {
                const record = clone(greenRecord());
                record.nope = 1;
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'unknown-key');
                assert.deepStrictEqual(outcome.rejections[0].items, ['nope']);
        });

        test('THE ABSENT-KEY DISCIPLINE: every absent key is missing-key, never a structural station', () => {
                for (const key of [...PROFILES_RECORD_SCHEMA_KEYS]) {
                        const record = clone(greenRecord());
                        delete record[key];
                        const outcome = validateProfilesRecord(record);
                        assert.ok(!outcome.ok, `the absent '${key}' must refuse`);
                        assert.deepStrictEqual(reasons(outcome), ['missing-key'], `the absent '${key}' is the missing-key station only`);
                }
        });

        test('bad-harness-id classes refuse through the REAL DH-01 alphabet', () => {
                for (const harnessId of ['flauz:prf:0123456789abcdef', 'flauz:hrn:0123456789ABCDEF', 'flauz:hrn:0123456789abcde', 7]) {
                        const record = clone(greenRecord());
                        record.harnessId = harnessId;
                        assert.deepStrictEqual(reasons(validateProfilesRecord(record)), ['bad-harness-id']);
                }
        });

        test('a bad stage is bad-stage', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejections[0].reason, 'bad-stage');
                assert.equal(outcome.rejections[0].law, 'THE FORWARD-ONLY LAW');
        });

        test('a malformed history note is bad-history', () => {
                const record = clone(greenRecord());
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                assert.deepStrictEqual(reasons(validateProfilesRecord(record)), ['bad-history']);
        });

        test('per-profile violations surface with the profiles[i]: item prefixes', () => {
                const record = greenRecord();
                record.profiles = [{ ...greenProfile(), profileKey: ' k' }];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['profile-key-whitespace']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['profiles[0]:leading/trailing whitespace']);
        });

        test('THE STATION-MAJOR ORDER: an entry no-fork precedes the record schema stations', () => {
                const record = greenRecord();
                record.profiles = [{ ...greenProfile(), executor: 1 }];
                record.nope = 1;
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['no-fork', 'unknown-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['profiles[0]:executor']);
        });

        test('THE STATION-MAJOR ORDER: bad-stage and bad-history precede the profile family laws', () => {
                const record = greenRecord();
                record.stage = 'draft';
                record.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'nope', law: 'THE LAW', detail: 'd' }];
                record.profiles = [{ ...greenProfile(), profileKey: '' }];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-stage', 'bad-history', 'profile-key-length']);
        });

        test('THE STATION-MAJOR ORDER: the profile shape laws precede the authority-binding stations', () => {
                const record = greenRecord();
                record.profiles = [{ ...greenProfile(), profileKey: ' k', permissionRefs: ['root-access'] }];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['profile-key-whitespace', 'bad-permission-ref']);
        });

        test('repeated profileKeys are duplicate-profile-key', () => {
                const record = greenRecord();
                record.profiles = [
                        { ...greenProfile(), summary: 'One.' },
                        { ...greenProfile(), summary: 'Two.' },
                ];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['duplicate-profile-key']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['core']);
        });

        test('exactly 63 and 64 profiles validate (the composition bound)', () => {
                for (const count of [63, 64]) {
                        const record = greenRecord();
                        record.profiles = Array.from({ length: count }, (_unused, index) => ({ ...greenProfile(), profileKey: `p${String(index).padStart(2, '0')}` }));
                        assert.ok(validateProfilesRecord(record).ok, `${count} profiles must validate`);
                }
        });

        test('65 profiles are max-profiles', () => {
                const record = greenRecord();
                record.profiles = Array.from({ length: 65 }, (_unused, index) => ({ ...greenProfile(), profileKey: `p${String(index).padStart(2, '0')}` }));
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['max-profiles']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['65 profiles']);
        });

        test('empty profiles are LEGAL on the record shape (the floor fires at finalize)', () => {
                const record = greenRecord();
                record.profiles = [];
                assert.ok(validateProfilesRecord(record).ok);
        });

        test('the authority-binding stations surface with the profiles[i]: prefixes in the frozen order', () => {
                const record = greenRecord();
                record.profiles = [
                        { ...greenProfile(), permissionRefs: ['root-access'], approvalTiers: ['critical'], evidenceFloor: 'staging', kpiDimensions: ['throughput'] },
                        { ...greenProfile(), profileKey: 'extra' },
                ];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['bad-permission-ref', 'bad-approval-tier', 'bad-evidence-floor', 'bad-kpi-dimension']);
                assert.deepStrictEqual(outcome.rejections[0].items, ['profiles[0]:root-access']);
                assert.deepStrictEqual(outcome.rejections[1].items, ['profiles[0]:critical']);
                assert.deepStrictEqual(outcome.rejections[2].items, ['profiles[0]:staging']);
                assert.deepStrictEqual(outcome.rejections[3].items, ['profiles[0]:throughput']);
        });

        test('THE COMPLETE TABLE: a multi-offense record reports every station in the frozen walk order', () => {
                const record = greenRecord();
                record.nope = 1;
                delete record.stage;
                record.harnessId = 'bad';
                record.profiles = [
                        { ...greenProfile(), summary: 'One.' },
                        { ...greenProfile(), summary: 'Two.' },
                ];
                const outcome = validateProfilesRecord(record);
                assert.ok(!outcome.ok);
                assert.deepStrictEqual(reasons(outcome), ['unknown-key', 'missing-key', 'bad-harness-id', 'duplicate-profile-key']);
        });
});

suite('profilesContract · serialization and the fail-closed parse', () => {
        test('the round trip is byte-identical and double-serialize stable', () => {
                const bytes = serializeProfilesRecord(greenRecord());
                const parsed = parseProfilesRecord(bytes);
                assert.ok(parsed.ok);
                assert.equal(serializeProfilesRecord(parsed.record), bytes);
                assert.equal(serializeProfilesRecord(JSON.parse(bytes)), bytes);
        });

        test('serialize throws TypeError on a malformed record', () => {
                assert.throws(() => serializeProfilesRecord({ nope: 1 }), TypeError);
        });

        test('the canonical bytes sort the profile entries deterministically by profileKey', () => {
                const record = greenRecord();
                record.profiles = [
                        { ...greenProfile(), profileKey: 'zulu' },
                        { ...greenProfile(), profileKey: 'alpha' },
                ];
                const bytes = serializeProfilesRecord(record);
                const parsed = JSON.parse(bytes) as { profiles: { profileKey: string }[] };
                assert.deepStrictEqual(parsed.profiles.map((profile) => profile.profileKey), ['alpha', 'zulu']);
                // the canonical ok copy is sorted too (never the caller's insertion order)
                const outcome = validateProfilesRecord(record);
                assert.ok(outcome.ok);
                assert.deepStrictEqual(outcome.value.profiles.map((profile) => profile.profileKey), ['alpha', 'zulu']);
        });

        test('parse: malformed-json', () => {
                const outcome = parseProfilesRecord('{not json');
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'malformed-json');
        });

        test('parse: non-string bytes are torn-envelope', () => {
                const outcome = parseProfilesRecord(7);
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a missing key is torn-envelope', () => {
                const record = clone(greenRecord());
                delete record.stage;
                const outcome = parseProfilesRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: a wrong structural type is torn-envelope', () => {
                const record = clone(greenRecord());
                record.profiles = 'nope';
                const outcome = parseProfilesRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'torn-envelope');
        });

        test('parse: unknown keys at the record / profile / note level are unknown-key', () => {
                const atRecord = clone(greenRecord());
                atRecord.nope = 1;
                const atRecordOutcome = parseProfilesRecord(JSON.stringify(atRecord));
                assert.equal(atRecordOutcome.ok === true ? 'ok' : atRecordOutcome.rejection.reason, 'unknown-key');
                const atProfile = clone(greenRecord());
                atProfile.profiles = [{ ...greenProfile(), executor: 1 }];
                const profileOutcome = parseProfilesRecord(JSON.stringify(atProfile));
                assert.ok(!profileOutcome.ok);
                assert.equal(profileOutcome.rejection.reason, 'unknown-key');
                const atNote = clone(greenRecord());
                atNote.history = [{ at: '2026-01-01T00:00:00.000Z', fromStage: null, toStage: 'composing', op: 'begin-profiles', law: 'THE LAW', detail: 'd', nope: 1 }];
                const noteOutcome = parseProfilesRecord(JSON.stringify(atNote));
                assert.ok(!noteOutcome.ok);
                assert.equal(noteOutcome.rejection.reason, 'unknown-key');
        });

        test('parse: a semantically drifted record is invalid-record', () => {
                const record = clone(greenRecord());
                record.stage = 'draft';
                const outcome = parseProfilesRecord(JSON.stringify(record));
                assert.ok(!outcome.ok);
                assert.equal(outcome.rejection.reason, 'invalid-record');
                const badVocab = clone(greenRecord());
                badVocab.profiles = [{ ...greenProfile(), permissionRefs: ['root-access'] }];
                const badVocabOutcome = parseProfilesRecord(JSON.stringify(badVocab));
                assert.ok(!badVocabOutcome.ok);
                assert.equal(badVocabOutcome.rejection.reason, 'invalid-record');
        });

        test('parse: non-canonical bytes are refused (record key order, entry key order, unsorted profiles, whitespace)', () => {
                const bytes = serializeProfilesRecord(greenRecord());
                const green = JSON.parse(bytes) as Record<string, unknown>;
                // a record key emitted out of the frozen order
                const swapped = JSON.stringify({ harnessId: green.harnessId, profilesId: 'flauz:prf:0123456789abcdef', stage: 'composing', profiles: green.profiles, history: green.history });
                const swappedOutcome = parseProfilesRecord(swapped);
                assert.ok(!swappedOutcome.ok);
                assert.equal(swappedOutcome.rejection.reason, 'non-canonical');
                // a profile entry emitted with the keys out of the frozen order
                const entrySwapped = JSON.parse(bytes) as Record<string, unknown>;
                const entry = (entrySwapped.profiles as Record<string, unknown>[])[0];
                (entrySwapped.profiles as Record<string, unknown>[])[0] = { summary: entry.summary, profileKey: entry.profileKey, permissionRefs: entry.permissionRefs, approvalTiers: entry.approvalTiers, evidenceFloor: entry.evidenceFloor, kpiDimensions: entry.kpiDimensions };
                const entryOutcome = parseProfilesRecord(JSON.stringify(entrySwapped));
                assert.ok(!entryOutcome.ok);
                assert.equal(entryOutcome.rejection.reason, 'non-canonical');
                // the profile entries out of the profileKey sort
                const multi = greenRecord();
                multi.profiles = [
                        { ...greenProfile(), profileKey: 'zulu' },
                        { ...greenProfile(), profileKey: 'alpha' },
                ];
                const multiBytes = serializeProfilesRecord(multi);
                const unsorted = JSON.parse(multiBytes) as Record<string, unknown>;
                (unsorted.profiles as unknown[]).reverse();
                const unsortedOutcome = parseProfilesRecord(JSON.stringify(unsorted));
                assert.ok(!unsortedOutcome.ok);
                assert.equal(unsortedOutcome.rejection.reason, 'non-canonical');
                // drifting whitespace
                const spaced = `${bytes.slice(0, 1)} ${bytes.slice(1)}`;
                const spacedOutcome = parseProfilesRecord(spaced);
                assert.ok(!spacedOutcome.ok);
                assert.equal(spacedOutcome.rejection.reason, 'non-canonical');
        });

        test('parse: the green round trip carries the canonical copy', () => {
                const outcome = parseProfilesRecord(serializeProfilesRecord(greenRecord()));
                assert.ok(outcome.ok);
                assert.equal(outcome.record.profiles[0].profileKey, 'core');
                assert.deepStrictEqual(Object.keys(outcome.record), [...PROFILES_RECORD_SCHEMA_KEYS]);
                assert.deepStrictEqual(Object.keys(outcome.record.profiles[0]), [...PROFILE_ENTRY_SCHEMA_KEYS]);
        });
});

suite('profilesContract · determinism greps', () => {
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
