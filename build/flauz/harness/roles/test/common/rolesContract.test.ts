/*
 * DH-003 roles contract test suite (mocha tdd style, matching
 * build/flauz/harness/onboarding/test/common/onboardingContract.test.ts
 * - the DH-002 landed family precedent - and the DH-001 contract
 * battery before it).
 *
 * Fixture policy: every timestamp below is SYNTHETIC (the fixed fixture
 * ISO string) and is NOT an authority value, NOT credential material,
 * NOT execution material. Closed-vocabulary members (the industries,
 * the work types, the catalogs, the affinities, the schema keys, the
 * rejection reasons, the parse reasons, the version stamp) are the
 * contract's own values under test - the catalog templates (roleKey +
 * summary pairs) are the contract's own frozen configuration and are
 * pinned byte-exact. The canonical-byte tests pin determinism and the
 * frozen key orders; the suites never read a clock; the in-suite
 * determinism greps pin the sources to law-comment lines only (the
 * banned-global patterns are assembled piecewise below so this test
 * source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        INDUSTRY_ROLE_CATALOGS,
        ROLE_COMPOSITION_SCHEMA_KEYS,
        ROLE_PROVENANCE_SCHEMA_KEYS,
        ROLE_SUMMARY_MAX_CHARS,
        ROLES_CONTRACTS_VERSION,
        ROLES_PARSE_REJECTION_REASONS,
        ROLES_VALIDATION_REJECTION_REASONS,
        WORK_TYPE_ROLE_AFFINITIES,
        isRoleCompositionRecord,
        isRoleKey,
        isRolesParseRejectionReason,
        isRolesValidationRejectionReason,
        parseRoleComposition,
        serializeRoleComposition,
        validateIndustryRoleCatalog,
        validateRoleCompositionRecord,
        validateRoleCompositionRequest,
        validateRoleSelection,
        validateRoleTemplate,
        validateWorkTypeRoleAffinity,
        FORBIDDEN_HARNESS_DESCRIPTOR_KEYS as ROLES_FORBIDDEN_KEYS,
        HARNESS_INDUSTRIES as ROLES_INDUSTRIES,
        HARNESS_WORK_TYPES as ROLES_WORK_TYPES,
        isHarnessIndustry as ROLES_IS_HARNESS_INDUSTRY,
        isHarnessWorkType as ROLES_IS_HARNESS_WORK_TYPE,
} from '../../common/rolesContract.js';
import type { RolesRefusal } from '../../common/rolesContract.js';
import {
        FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
        HARNESS_INDUSTRIES,
        HARNESS_WORK_TYPES,
        isHarnessIndustry,
        isHarnessWorkType,
} from '../../../contract/common/domainHarnessContract.js';

const FIXTURE_NOW_ISO = '2026-10-13T00:00:00.000Z';

/** A well-formed legal-industry composition record (the catalog templates are the contract's own values). */
function fixtureRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                contractVersion: ROLES_CONTRACTS_VERSION,
                industry: 'legal',
                workTypes: ['analysis', 'drafting', 'review'],
                composedAtIso: FIXTURE_NOW_ISO,
                roles: [
                        { roleKey: 'drafter', summary: 'writes the contracts, the pleadings and the instruments the matter needs' },
                        { roleKey: 'reviewer', summary: 'examines the drafts for legal risk and for drift from the agreed position' },
                ],
                provenance: [
                        { roleKey: 'drafter', contributedBy: ['drafting'] },
                        { roleKey: 'reviewer', contributedBy: ['review'] },
                ],
                ...overrides,
        };
}

function parsedJson(value: unknown): unknown {
        return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Extracts the refusal of a refused payload outcome (narrowed for the assertions). */
function refusalOf(outcome: { ok: boolean }): RolesRefusal {
        assert.equal(outcome.ok, false, 'expected a refused outcome');
        return (outcome as unknown as { refusal: RolesRefusal }).refusal;
}

/** The union of every catalog's role keys (the affinity resolution surface). */
function allCatalogRoleKeys(): Set<string> {
        const keys = new Set<string>();
        for (const industry of HARNESS_INDUSTRIES) {
                for (const template of INDUSTRY_ROLE_CATALOGS[industry]) {
                        keys.add(template.roleKey);
                }
        }
        return keys;
}

/**
 * The banned-global patterns, assembled piecewise so this test source
 * itself stays grep-clean (every grep hit in the family must be a
 * law-comment line in the shipped modules).
 */
const BANNED_GLOBAL_PATTERNS = ['Date' + '.now', 'new ' + 'Date', 'Math' + '.random', 'process' + '.env'];

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
        const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
        const source = readFileSync(modulePath, 'utf8');
        return source.split('\n').filter((line) => BANNED_GLOBAL_PATTERNS.some((banned) => line.includes(banned)));
}

suite('DH-003 roles contract', () => {

        suite('version stamping (the single declaration)', () => {
                test('ROLES_CONTRACTS_VERSION is 1.0.0', () => {
                        assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
                        assert.equal(typeof ROLES_CONTRACTS_VERSION, 'string');
                });
        });

        suite('the DH-01 vocabularies are re-exported BY REFERENCE (never re-declared)', () => {
                test('HARNESS_INDUSTRIES is the DH-01 binding itself, with the exact sixteen members in the frozen order', () => {
                        assert.equal(ROLES_INDUSTRIES === HARNESS_INDUSTRIES, true, 'the re-export must be the same binding');
                        assert.deepEqual([...ROLES_INDUSTRIES], [
                                'software', 'legal', 'finance', 'healthcare', 'education', 'marketing', 'science', 'media',
                                'construction', 'logistics', 'retail', 'manufacturing', 'energy', 'agriculture', 'government', 'hospitality',
                        ]);
                });
                test('HARNESS_WORK_TYPES is the DH-01 binding itself, with the exact ten members in the frozen order', () => {
                        assert.equal(ROLES_WORK_TYPES === HARNESS_WORK_TYPES, true, 'the re-export must be the same binding');
                        assert.deepEqual([...ROLES_WORK_TYPES], [
                                'analysis', 'drafting', 'review', 'planning', 'research', 'reporting', 'data-processing', 'compliance', 'communication', 'administration',
                        ]);
                });
                test('the DH-01 predicates are re-exported by reference (the same function bindings)', () => {
                        assert.equal(ROLES_IS_HARNESS_INDUSTRY === isHarnessIndustry, true);
                        assert.equal(ROLES_IS_HARNESS_WORK_TYPE === isHarnessWorkType, true);
                        assert.equal(ROLES_IS_HARNESS_INDUSTRY('legal'), true);
                        assert.equal(ROLES_IS_HARNESS_WORK_TYPE('drafting'), true);
                });
                test('FORBIDDEN_HARNESS_DESCRIPTOR_KEYS is the DH-01 binding itself (the no-fork family, never re-declared)', () => {
                        assert.equal(ROLES_FORBIDDEN_KEYS === FORBIDDEN_HARNESS_DESCRIPTOR_KEYS, true);
                        assert.equal(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS.length, 10);
                        assert.equal(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS.includes('fork'), true);
                });
        });

        suite('isRoleKey + ROLE_SUMMARY_MAX_CHARS (THE ROLE-KEY LAW)', () => {
                test('admits non-empty lowercase hyphen-free single-word identifiers', () => {
                        for (const key of ['architect', 'a', 'implementer', 'paralegal', 'agronomist']) {
                                assert.equal(isRoleKey(key), true, `expected '${key}' to be a valid roleKey`);
                        }
                });
                test('refuses hyphens, underscores, digits, uppercase, empty strings and non-strings', () => {
                        for (const value of ['role-key', 'role_key', 'role1', 'RolE', '', 'role.key', 'role key', 42, null, undefined, {}, []]) {
                                assert.equal(isRoleKey(value), false, `expected '${String(value)}' to be refused`);
                        }
                });
                test('ROLE_SUMMARY_MAX_CHARS is 200', () => {
                        assert.equal(ROLE_SUMMARY_MAX_CHARS, 200);
                });
        });

        suite('INDUSTRY_ROLE_CATALOGS (THE FROZEN-CATALOG LAW)', () => {
                test('carries exactly the sixteen frozen industries, one catalog each', () => {
                        assert.deepEqual(Object.keys(INDUSTRY_ROLE_CATALOGS), [...HARNESS_INDUSTRIES]);
                });
                test('every catalog passes the integrity walk (the battery runs all 16)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const verdict = validateIndustryRoleCatalog(industry, INDUSTRY_ROLE_CATALOGS[industry]);
                                assert.equal(verdict.ok, true, `industry '${industry}' must have a green catalog walk: ${JSON.stringify(verdict)}`);
                        }
                });
                test('every catalog carries 4-8 domain-honest templates (the design law)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const size = INDUSTRY_ROLE_CATALOGS[industry].length;
                                assert.equal(size >= 4 && size <= 8, true, `industry '${industry}' carries ${size} templates (expected 4-8)`);
                        }
                });
                test('every roleKey is unique within its catalog and satisfies isRoleKey', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const keys = INDUSTRY_ROLE_CATALOGS[industry].map((template) => template.roleKey);
                                assert.equal(new Set(keys).size, keys.length, `industry '${industry}' carries duplicate roleKeys`);
                                for (const key of keys) {
                                        assert.equal(isRoleKey(key), true, `industry '${industry}' carries the malformed roleKey '${key}'`);
                                }
                        }
                });
                test('every summary is a non-empty human string within the 200-character bound', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const template of INDUSTRY_ROLE_CATALOGS[industry]) {
                                        assert.equal(typeof template.summary, 'string', `industry '${industry}' role '${template.roleKey}' carries a non-string summary`);
                                        assert.equal(template.summary.length > 0 && template.summary.length <= ROLE_SUMMARY_MAX_CHARS, true, `industry '${industry}' role '${template.roleKey}' summary is out of bounds (${template.summary.length} chars)`);
                                }
                        }
                });
                test('the software catalog is frozen byte-exact (the shared-vocabulary pin)', () => {
                        assert.deepEqual(INDUSTRY_ROLE_CATALOGS.software, [
                                { roleKey: 'architect', summary: 'shapes the software system, its structure and its boundary contracts (the design authority)' },
                                { roleKey: 'implementer', summary: 'builds the software against the agreed contracts and lands the changes' },
                                { roleKey: 'reviewer', summary: 'examines the changes for defects, risks and design drift before they land' },
                                { roleKey: 'tester', summary: 'designs and runs the verification battery that pins the behavior' },
                                { roleKey: 'analyst', summary: 'studies the requirements and the telemetry to define what the work must satisfy' },
                                { roleKey: 'writer', summary: 'maintains the technical documentation the harness composes (guides, references, runbooks)' },
                                { roleKey: 'coordinator', summary: 'tracks the work items, the schedule and the handoffs between the roles' },
                                { roleKey: 'auditor', summary: 'examines the work and its artifacts for policy and compliance drift' },
                        ]);
                });
                test('the legal catalog is frozen byte-exact', () => {
                        assert.deepEqual(INDUSTRY_ROLE_CATALOGS.legal, [
                                { roleKey: 'counsel', summary: 'owns the legal judgment: advises the party, frames the position and signs the opinions' },
                                { roleKey: 'paralegal', summary: 'prepares the filings, the research bundles and the matter administration' },
                                { roleKey: 'drafter', summary: 'writes the contracts, the pleadings and the instruments the matter needs' },
                                { roleKey: 'reviewer', summary: 'examines the drafts for legal risk and for drift from the agreed position' },
                                { roleKey: 'researcher', summary: 'performs the case research and the precedent analysis the position rests on' },
                                { roleKey: 'writer', summary: 'maintains the memoranda and the client-facing explanations of the work' },
                                { roleKey: 'negotiator', summary: 'represents the party in negotiating terms and settling disputes' },
                                { roleKey: 'analyst', summary: 'processes the matter data and the discovery material into the position files' },
                        ]);
                });
                test('the shared vocabulary is real: reviewer appears in exactly the seven pinned industries', () => {
                        const industriesWithReviewer = HARNESS_INDUSTRIES.filter((industry) =>
                                INDUSTRY_ROLE_CATALOGS[industry].some((template) => template.roleKey === 'reviewer'),
                        );
                        assert.deepEqual(industriesWithReviewer, ['software', 'legal', 'finance', 'marketing', 'science', 'media', 'government']);
                });
        });

        suite('WORK_TYPE_ROLE_AFFINITIES (THE FROZEN-CATALOG LAW)', () => {
                test('carries exactly the ten frozen work types, one affinity each', () => {
                        assert.deepEqual(Object.keys(WORK_TYPE_ROLE_AFFINITIES), [...HARNESS_WORK_TYPES]);
                });
                test('every affinity passes the integrity walk against the frozen catalogs (the battery runs all 10)', () => {
                        for (const workType of HARNESS_WORK_TYPES) {
                                const verdict = validateWorkTypeRoleAffinity(workType, WORK_TYPE_ROLE_AFFINITIES[workType], INDUSTRY_ROLE_CATALOGS);
                                assert.equal(verdict.ok, true, `work type '${workType}' must have a green affinity walk: ${JSON.stringify(verdict)}`);
                        }
                });
                test('every affinity is non-empty, duplicate-free and ordered', () => {
                        for (const workType of HARNESS_WORK_TYPES) {
                                const keys = WORK_TYPE_ROLE_AFFINITIES[workType];
                                assert.equal(keys.length > 0, true, `work type '${workType}' carries an empty affinity`);
                                assert.equal(new Set(keys).size, keys.length, `work type '${workType}' carries duplicate affinity keys`);
                        }
                });
                test('every affinity key resolves in at least one catalog (the unknown-affinity-role guarantee, cross-checked independently)', () => {
                        const resolvable = allCatalogRoleKeys();
                        for (const workType of HARNESS_WORK_TYPES) {
                                for (const key of WORK_TYPE_ROLE_AFFINITIES[workType]) {
                                        assert.equal(resolvable.has(key), true, `work type '${workType}' affinity key '${key}' resolves in no catalog`);
                                }
                        }
                });
                test('the affinity map is frozen byte-exact', () => {
                        assert.deepEqual(WORK_TYPE_ROLE_AFFINITIES, {
                                analysis: ['analyst', 'researcher', 'auditor'],
                                drafting: ['drafter', 'writer', 'implementer', 'designer', 'copywriter'],
                                review: ['reviewer', 'editor', 'auditor', 'inspector', 'assessor'],
                                planning: ['planner', 'architect', 'strategist', 'supervisor', 'counsel', 'administrator', 'producer'],
                                research: ['researcher', 'analyst', 'technician', 'surveyor'],
                                reporting: ['writer', 'analyst', 'editor', 'accountant'],
                                'data-processing': ['implementer', 'analyst', 'technician', 'accountant'],
                                compliance: ['auditor', 'counsel', 'inspector', 'reviewer', 'accountant'],
                                communication: ['writer', 'coordinator', 'producer', 'associate', 'instructor', 'copywriter', 'editor'],
                                administration: ['administrator', 'paralegal', 'coordinator', 'associate'],
                        });
                });
        });

        suite('the frozen rejection vocabularies', () => {
                test('ROLES_VALIDATION_REJECTION_REASONS is the exact sixteen, in the exact walk order', () => {
                        assert.deepEqual([...ROLES_VALIDATION_REJECTION_REASONS], [
                                'malformed-record', 'no-fork', 'unknown-key', 'missing-key', 'unknown-industry',
                                'empty-work-types', 'unknown-work-type', 'duplicate-work-types', 'work-types-out-of-order',
                                'role-not-in-catalog', 'duplicate-role-keys', 'unknown-affinity-role', 'empty-composition',
                                'invalid-role-key', 'invalid-summary', 'version-mismatch',
                        ]);
                });
                test('the sixteen reasons are unique and the predicate admits members only', () => {
                        assert.equal(new Set(ROLES_VALIDATION_REJECTION_REASONS).size, ROLES_VALIDATION_REJECTION_REASONS.length);
                        for (const reason of ROLES_VALIDATION_REJECTION_REASONS) {
                                assert.equal(isRolesValidationRejectionReason(reason), true);
                        }
                        for (const value of ['no-forkk', 'malformed', '', 'DISPOSED', null, 42]) {
                                assert.equal(isRolesValidationRejectionReason(value), false);
                        }
                });
                test('ROLES_PARSE_REJECTION_REASONS is the exact five, in the exact order', () => {
                        assert.deepEqual([...ROLES_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
                        for (const reason of ROLES_PARSE_REJECTION_REASONS) {
                                assert.equal(isRolesParseRejectionReason(reason), true);
                        }
                        for (const value of ['torn', 'malformed-jsonx', '', null]) {
                                assert.equal(isRolesParseRejectionReason(value), false);
                        }
                });
                test('ROLE_COMPOSITION_SCHEMA_KEYS is the exact six, in the canonical order', () => {
                        assert.deepEqual([...ROLE_COMPOSITION_SCHEMA_KEYS], ['contractVersion', 'industry', 'workTypes', 'composedAtIso', 'roles', 'provenance']);
                });
                test('ROLE_PROVENANCE_SCHEMA_KEYS is the exact two, in the canonical order', () => {
                        assert.deepEqual([...ROLE_PROVENANCE_SCHEMA_KEYS], ['roleKey', 'contributedBy']);
                });
        });

        suite('validateRoleTemplate (the DH-01 role shape, this family bounds)', () => {
                test('a well-formed template walks green and carries the canonical copy', () => {
                        const verdict = validateRoleTemplate({ roleKey: 'drafter', summary: 'writes the instruments' });
                        assert.equal(verdict.ok, true);
                        if (verdict.ok) {
                                assert.deepEqual(verdict.value, { roleKey: 'drafter', summary: 'writes the instruments' });
                        }
                });
                test('a non-object template is the malformed-record refusal', () => {
                        for (const candidate of [null, 42, 'role', [], undefined]) {
                                const refusal = refusalOf(validateRoleTemplate(candidate));
                                assert.equal(refusal.reason, 'malformed-record');
                                assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                        }
                });
                test('ANY extra key is the no-fork refusal (the DH-01 station (c) - a named role grants NOTHING)', () => {
                        const refusal = refusalOf(validateRoleTemplate({ roleKey: 'drafter', summary: 's', command: 'rm-rf' }));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.equal(refusal.law, 'THE NO-FORK LAW');
                        assert.deepEqual(refusal.items, ['command']);
                });
                test('the forbidden execution-material family fires no-fork (before unknown-key, the precedence law)', () => {
                        for (const key of ['command', 'commands', 'tool', 'tools', 'implementation', 'code', 'script', 'inline', 'patch', 'fork']) {
                                const refusal = refusalOf(validateRoleTemplate({ roleKey: 'drafter', summary: 's', [key]: 'execution material' }));
                                assert.equal(refusal.reason, 'no-fork', `the forbidden key '${key}' must fire no-fork`);
                        }
                });
                test('a missing roleKey or summary is the missing-key refusal', () => {
                        assert.deepEqual(refusalOf(validateRoleTemplate({ summary: 's' })).items, ['roleKey']);
                        assert.deepEqual(refusalOf(validateRoleTemplate({ roleKey: 'drafter' })).items, ['summary']);
                        assert.deepEqual(refusalOf(validateRoleTemplate({})).items, ['roleKey', 'summary']);
                });
                test('a malformed roleKey is the invalid-role-key refusal (THE ROLE-KEY LAW)', () => {
                        for (const roleKey of ['Role', 'role-key', 'role_key', 'role1', '', 'role.key', 42, null]) {
                                const refusal = refusalOf(validateRoleTemplate({ roleKey, summary: 's' }));
                                assert.equal(refusal.reason, 'invalid-role-key', `the roleKey '${String(roleKey)}' must fire invalid-role-key`);
                                assert.equal(refusal.law, 'THE ROLE-KEY LAW');
                        }
                });
                test('an out-of-bounds summary is the invalid-summary refusal', () => {
                        const tooLong = 'x'.repeat(ROLE_SUMMARY_MAX_CHARS + 1);
                        for (const summary of ['', tooLong, 42, null]) {
                                const refusal = refusalOf(validateRoleTemplate({ roleKey: 'drafter', summary }));
                                assert.equal(refusal.reason, 'invalid-summary', `the summary '${String(summary).slice(0, 8)}...' must fire invalid-summary`);
                        }
                        const atBound = 'x'.repeat(ROLE_SUMMARY_MAX_CHARS);
                        assert.equal(validateRoleTemplate({ roleKey: 'drafter', summary: atBound }).ok, true, 'a summary at exactly the bound walks green');
                });
        });

        suite('validateIndustryRoleCatalog (the per-industry integrity walk)', () => {
                test('a well-formed catalog walks green and carries the canonical template copies', () => {
                        const verdict = validateIndustryRoleCatalog('software', [
                                { roleKey: 'architect', summary: 'the design authority' },
                                { roleKey: 'implementer', summary: 'builds the software' },
                        ]);
                        assert.equal(verdict.ok, true);
                        if (verdict.ok) {
                                assert.deepEqual(verdict.value, [
                                        { roleKey: 'architect', summary: 'the design authority' },
                                        { roleKey: 'implementer', summary: 'builds the software' },
                                ]);
                        }
                });
                test('a non-array or empty catalog is the malformed-record refusal', () => {
                        for (const catalog of [null, 'catalog', {}, []]) {
                                const refusal = refusalOf(validateIndustryRoleCatalog('software', catalog));
                                assert.equal(refusal.reason, 'malformed-record');
                                assert.deepEqual(refusal.items, ['catalog']);
                        }
                });
                test('an unknown industry is the unknown-industry refusal', () => {
                        const refusal = refusalOf(validateIndustryRoleCatalog('aerospace', [{ roleKey: 'architect', summary: 's' }]));
                        assert.equal(refusal.reason, 'unknown-industry');
                        assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
                        assert.deepEqual(refusal.items, ['aerospace']);
                });
                test('a non-object entry is the malformed-record refusal carrying its catalog position', () => {
                        const refusal = refusalOf(validateIndustryRoleCatalog('software', [{ roleKey: 'architect', summary: 's' }, 'not-a-role']));
                        assert.equal(refusal.reason, 'malformed-record');
                        assert.deepEqual(refusal.items, ['catalog[1].template']);
                });
                test('an entry refusal wraps with the catalog position (the no-fork case)', () => {
                        const refusal = refusalOf(validateIndustryRoleCatalog('software', [{ roleKey: 'architect', summary: 's', tools: [] }]));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.deepEqual(refusal.items, ['catalog[0].tools']);
                });
                test('duplicate roleKeys within a catalog are the duplicate-role-keys refusal', () => {
                        const refusal = refusalOf(validateIndustryRoleCatalog('software', [
                                { roleKey: 'architect', summary: 'one' },
                                { roleKey: 'implementer', summary: 'two' },
                                { roleKey: 'architect', summary: 'three' },
                        ]));
                        assert.equal(refusal.reason, 'duplicate-role-keys');
                        assert.deepEqual(refusal.items, ['architect']);
                });
                test('the entry shape laws fire inside the catalog walk (invalid-role-key)', () => {
                        const refusal = refusalOf(validateIndustryRoleCatalog('software', [{ roleKey: 'Architect', summary: 's' }]));
                        assert.equal(refusal.reason, 'invalid-role-key');
                        assert.deepEqual(refusal.items, ['catalog[0].Architect']);
                });
        });

        suite('validateWorkTypeRoleAffinity (the per-work-type integrity walk)', () => {
                test('a well-formed affinity walks green and carries the fresh key list', () => {
                        const verdict = validateWorkTypeRoleAffinity('analysis', ['analyst', 'researcher'], INDUSTRY_ROLE_CATALOGS);
                        assert.equal(verdict.ok, true);
                        if (verdict.ok) {
                                assert.deepEqual(verdict.value, ['analyst', 'researcher']);
                        }
                });
                test('a non-array or empty affinity is the malformed-record refusal', () => {
                        for (const affinity of [null, 'analyst', {}, []]) {
                                const refusal = refusalOf(validateWorkTypeRoleAffinity('analysis', affinity, INDUSTRY_ROLE_CATALOGS));
                                assert.equal(refusal.reason, 'malformed-record');
                                assert.deepEqual(refusal.items, ['affinity']);
                        }
                });
                test('an unknown work type is the unknown-work-type refusal', () => {
                        const refusal = refusalOf(validateWorkTypeRoleAffinity('mind-reading', ['analyst'], INDUSTRY_ROLE_CATALOGS));
                        assert.equal(refusal.reason, 'unknown-work-type');
                        assert.deepEqual(refusal.items, ['mind-reading']);
                });
                test('duplicate affinity keys are the duplicate-role-keys refusal', () => {
                        const refusal = refusalOf(validateWorkTypeRoleAffinity('analysis', ['analyst', 'analyst'], INDUSTRY_ROLE_CATALOGS));
                        assert.equal(refusal.reason, 'duplicate-role-keys');
                        assert.deepEqual(refusal.items, ['analyst']);
                });
                test('an unresolvable key is the unknown-affinity-role refusal listing the offender', () => {
                        const refusal = refusalOf(validateWorkTypeRoleAffinity('analysis', ['analyst', 'nonexistentrole'], INDUSTRY_ROLE_CATALOGS));
                        assert.equal(refusal.reason, 'unknown-affinity-role');
                        assert.equal(refusal.law, 'THE FROZEN-CATALOG LAW');
                        assert.deepEqual(refusal.items, ['nonexistentrole']);
                });
                test('a non-string member fails closed as unknown-affinity-role', () => {
                        const refusal = refusalOf(validateWorkTypeRoleAffinity('analysis', ['analyst', 42, null], INDUSTRY_ROLE_CATALOGS));
                        assert.equal(refusal.reason, 'unknown-affinity-role');
                        assert.deepEqual(refusal.items, ['42', '<null>']);
                });
                test('a malformed catalogs argument resolves NOTHING (fail-closed: every member dangles)', () => {
                        for (const catalogs of [null, 'catalogs', [], { software: 'not-an-array' }]) {
                                const refusal = refusalOf(validateWorkTypeRoleAffinity('analysis', ['analyst'], catalogs));
                                assert.equal(refusal.reason, 'unknown-affinity-role', `the catalogs argument '${String(catalogs)}' must resolve nothing`);
                        }
                });
        });

        suite('validateRoleCompositionRequest (the composition-request walk)', () => {
                test('a well-formed request walks green and carries the canonical echo', () => {
                        const verdict = validateRoleCompositionRequest({ industry: 'legal', workTypes: ['analysis', 'drafting', 'review'] });
                        assert.equal(verdict.ok, true);
                        if (verdict.ok) {
                                assert.deepEqual(verdict.value, { industry: 'legal', workTypes: ['analysis', 'drafting', 'review'] });
                        }
                });
                test('a non-object request is the malformed-record refusal', () => {
                        for (const candidate of [null, 42, 'request', [], undefined]) {
                                assert.equal(refusalOf(validateRoleCompositionRequest(candidate)).reason, 'malformed-record');
                        }
                });
                test('a present-but-malformed workTypes carrier is the malformed-record refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: 'analysis' }));
                        assert.equal(refusal.reason, 'malformed-record');
                        assert.deepEqual(refusal.items, ['workTypes']);
                });
                test('the forbidden family fires no-fork BEFORE unknown-key (the precedence law)', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: ['review'], tool: 'execution material' }));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.equal(refusal.law, 'THE NO-FORK LAW');
                        assert.deepEqual(refusal.items, ['tool']);
                });
                test('an unknown key is the unknown-key refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: ['review'], roleKeys: ['drafter'] }));
                        assert.equal(refusal.reason, 'unknown-key');
                        assert.deepEqual(refusal.items, ['roleKeys']);
                });
                test('a missing key is the missing-key refusal', () => {
                        assert.deepEqual(refusalOf(validateRoleCompositionRequest({ workTypes: ['review'] })).items, ['industry']);
                        assert.deepEqual(refusalOf(validateRoleCompositionRequest({ industry: 'legal' })).items, ['workTypes']);
                });
                test('an unknown industry is the unknown-industry refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'aerospace', workTypes: ['review'] }));
                        assert.equal(refusal.reason, 'unknown-industry');
                        assert.deepEqual(refusal.items, ['aerospace']);
                });
                test('an empty workTypes selection is the empty-work-types refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: [] }));
                        assert.equal(refusal.reason, 'empty-work-types');
                        assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
                });
                test('an unknown member is the unknown-work-type refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: ['review', 'mind-reading'] }));
                        assert.equal(refusal.reason, 'unknown-work-type');
                        assert.deepEqual(refusal.items, ['mind-reading']);
                });
                test('repeats are the duplicate-work-types refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: ['review', 'review'] }));
                        assert.equal(refusal.reason, 'duplicate-work-types');
                        assert.deepEqual(refusal.items, ['review']);
                });
                test('a frozen-order inversion is the work-types-out-of-order refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRequest({ industry: 'legal', workTypes: ['review', 'analysis'] }));
                        assert.equal(refusal.reason, 'work-types-out-of-order');
                        assert.deepEqual(refusal.items, ['review', 'analysis']);
                });
        });

        suite('validateRoleSelection (the explicit-selection walk)', () => {
                test('a well-formed selection resolves the templates in CATALOG order (never the request order)', () => {
                        const verdict = validateRoleSelection({ industry: 'software', roleKeys: ['reviewer', 'architect'] });
                        assert.equal(verdict.ok, true);
                        if (verdict.ok) {
                                assert.equal(verdict.value.industry, 'software');
                                assert.deepEqual(verdict.value.roles.map((role) => role.roleKey), ['architect', 'reviewer']);
                                assert.deepEqual(verdict.value.roles, [
                                        { roleKey: 'architect', summary: INDUSTRY_ROLE_CATALOGS.software[0].summary },
                                        { roleKey: 'reviewer', summary: INDUSTRY_ROLE_CATALOGS.software[2].summary },
                                ]);
                        }
                });
                test('a non-object request is the malformed-record refusal', () => {
                        for (const candidate of [null, 42, 'request', [], undefined]) {
                                assert.equal(refusalOf(validateRoleSelection(candidate)).reason, 'malformed-record');
                        }
                });
                test('a present-but-malformed roleKeys carrier is the malformed-record refusal', () => {
                        const refusal = refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: 'drafter' }));
                        assert.equal(refusal.reason, 'malformed-record');
                        assert.deepEqual(refusal.items, ['roleKeys']);
                });
                test('the forbidden family and the unknown keys fire no-fork / unknown-key', () => {
                        assert.equal(refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: ['drafter'], code: 'x' })).reason, 'no-fork');
                        assert.equal(refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: ['drafter'], workTypes: [] })).reason, 'unknown-key');
                });
                test('a missing key is the missing-key refusal', () => {
                        assert.deepEqual(refusalOf(validateRoleSelection({ roleKeys: ['drafter'] })).items, ['industry']);
                        assert.deepEqual(refusalOf(validateRoleSelection({ industry: 'legal' })).items, ['roleKeys']);
                });
                test('an unknown industry is the unknown-industry refusal', () => {
                        assert.equal(refusalOf(validateRoleSelection({ industry: 'aerospace', roleKeys: ['drafter'] })).reason, 'unknown-industry');
                });
                test('a non-member roleKey is the role-not-in-catalog refusal listing EVERY offender', () => {
                        const refusal = refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: ['counsel', 'architect', 'nonexistentrole'] }));
                        assert.equal(refusal.reason, 'role-not-in-catalog');
                        assert.equal(refusal.law, 'THE FROZEN-CATALOG LAW');
                        assert.deepEqual(refusal.items, ['architect', 'nonexistentrole']);
                });
                test('a shared-vocabulary key from ANOTHER industry is not a member of THIS catalog (the frozen-catalog boundary)', () => {
                        const refusal = refusalOf(validateRoleSelection({ industry: 'construction', roleKeys: ['architect', 'paralegal'] }));
                        assert.equal(refusal.reason, 'role-not-in-catalog');
                        assert.deepEqual(refusal.items, ['paralegal']);
                });
                test('repeats are the duplicate-role-keys refusal (the inherited law)', () => {
                        const refusal = refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: ['counsel', 'counsel'] }));
                        assert.equal(refusal.reason, 'duplicate-role-keys');
                        assert.deepEqual(refusal.items, ['counsel']);
                });
                test('an empty selection is the empty-composition refusal', () => {
                        const refusal = refusalOf(validateRoleSelection({ industry: 'legal', roleKeys: [] }));
                        assert.equal(refusal.reason, 'empty-composition');
                        assert.equal(refusal.law, 'THE COMPOSITION LAW');
                });
        });

        suite('validateRoleCompositionRecord + isRoleCompositionRecord (the deep record walk)', () => {
                test('a well-formed record walks green and carries the canonical copy', () => {
                        const verdict = validateRoleCompositionRecord(parsedJson(fixtureRecord()));
                        assert.equal(verdict.ok, true, JSON.stringify(verdict));
                        if (verdict.ok) {
                                assert.deepEqual(verdict.value, parsedJson(fixtureRecord()));
                        }
                        assert.equal(isRoleCompositionRecord(parsedJson(fixtureRecord())), true);
                });
                test('a non-object record is the malformed-record refusal', () => {
                        for (const candidate of [null, 42, 'record', [], undefined]) {
                                assert.equal(refusalOf(validateRoleCompositionRecord(candidate)).reason, 'malformed-record');
                        }
                        assert.equal(isRoleCompositionRecord(null), false);
                });
                test('a wrong-typed carrier is the malformed-record refusal (fail-closed on every structural path)', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ roles: 'nope' }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ provenance: 42 }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ composedAtIso: '' }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ workTypes: {} }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ roles: [{ roleKey: 'drafter', summary: 's' }, 'not-a-role'] }))).reason, 'malformed-record');
                });
                test('the forbidden family fires no-fork on the record', () => {
                        const refusal = refusalOf(validateRoleCompositionRecord(fixtureRecord({ script: 'execution material' })));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.deepEqual(refusal.items, ['script']);
                });
                test('an unknown record key is the unknown-key refusal', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ extra: true }))).reason, 'unknown-key');
                });
                test('a missing record key is the missing-key refusal', () => {
                        for (const key of [...ROLE_COMPOSITION_SCHEMA_KEYS]) {
                                const record = fixtureRecord();
                                delete record[key];
                                assert.equal(refusalOf(validateRoleCompositionRecord(record)).reason, 'missing-key', `the missing '${key}' must fire missing-key`);
                        }
                });
                test('an unknown industry is the unknown-industry refusal', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ industry: 'aerospace' }))).reason, 'unknown-industry');
                });
                test('the workTypes subset laws fire on the record echo', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ workTypes: [] }))).reason, 'empty-work-types');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ workTypes: ['review', 'mind-reading'] }))).reason, 'unknown-work-type');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ workTypes: ['review', 'review'] }))).reason, 'duplicate-work-types');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ workTypes: ['review', 'analysis'] }))).reason, 'work-types-out-of-order');
                });
                test('a role outside the industry catalog is the role-not-in-catalog refusal', () => {
                        const refusal = refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                roles: [
                                        { roleKey: 'drafter', summary: 'writes the instruments the matter needs' },
                                        { roleKey: 'architect', summary: 'a software role, not a legal one' },
                                ],
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['drafting'] },
                                        { roleKey: 'architect', contributedBy: ['drafting'] },
                                ],
                        })));
                        assert.equal(refusal.reason, 'role-not-in-catalog');
                        assert.deepEqual(refusal.items, ['architect']);
                });
                test('an empty roles array is the empty-composition refusal', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ roles: [], provenance: [] }))).reason, 'empty-composition');
                });
                test('a torn provenance parallel structure is the malformed-record refusal', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({ provenance: [{ roleKey: 'drafter', contributedBy: ['drafting'] }] }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['drafting'] },
                                        { roleKey: 'counsel', contributedBy: ['review'] },
                                ],
                        }))).reason, 'malformed-record');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: [] },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                ],
                        }))).reason, 'malformed-record');
                });
                test('the provenance entry laws fire (unknown-key, missing-key, the work-type subset laws)', () => {
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['drafting'], weight: 3 },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                ],
                        }))).reason, 'unknown-key');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter' },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                ],
                        }))).reason, 'missing-key');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['drafting', 'mind-reading'] },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                ],
                        }))).reason, 'unknown-work-type');
                        assert.equal(refusalOf(validateRoleCompositionRecord(fixtureRecord({
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['review', 'drafting'] },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                ],
                        }))).reason, 'work-types-out-of-order');
                });
                test('a wrong contract version is the version-mismatch refusal (the LAST station)', () => {
                        const refusal = refusalOf(validateRoleCompositionRecord(fixtureRecord({ contractVersion: '0.9.9' })));
                        assert.equal(refusal.reason, 'version-mismatch');
                        assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
                });
                test('the version station is walked LAST: a record with BOTH an unknown industry and a wrong version reports unknown-industry', () => {
                        const refusal = refusalOf(validateRoleCompositionRecord(fixtureRecord({ industry: 'aerospace', contractVersion: '0.9.9' })));
                        assert.equal(refusal.reason, 'unknown-industry');
                });
        });

        suite('serializeRoleComposition (the canonical bytes)', () => {
                test('the canonical bytes emit the frozen key orders (deep)', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const parsed = JSON.parse(bytes) as Record<string, unknown>;
                        assert.deepEqual(Object.keys(parsed), [...ROLE_COMPOSITION_SCHEMA_KEYS]);
                        const roles = parsed.roles as Record<string, unknown>[];
                        assert.deepEqual(Object.keys(roles[0]), ['roleKey', 'summary']);
                        const provenance = parsed.provenance as Record<string, unknown>[];
                        assert.deepEqual(Object.keys(provenance[0]), [...ROLE_PROVENANCE_SCHEMA_KEYS]);
                });
                test('double serialization is byte-identical, and a scrambled key order re-canonicalizes (determinism)', () => {
                        const record = parsedJson(fixtureRecord());
                        const once = serializeRoleComposition(record);
                        const twice = serializeRoleComposition(JSON.parse(once) as unknown);
                        assert.equal(once, twice);
                        const reOrdered = JSON.parse(once) as Record<string, unknown>;
                        const scrambled = { provenance: reOrdered.provenance, roles: reOrdered.roles, composedAtIso: reOrdered.composedAtIso, workTypes: reOrdered.workTypes, industry: reOrdered.industry, contractVersion: reOrdered.contractVersion };
                        assert.equal(serializeRoleComposition(scrambled as unknown), once);
                });
                test('a malformed record never gets canonical bytes (TypeError)', () => {
                        assert.throws(() => serializeRoleComposition(fixtureRecord({ industry: 'nope' })), TypeError);
                        assert.throws(() => serializeRoleComposition(null), TypeError);
                        assert.throws(() => serializeRoleComposition(42), TypeError);
                });
        });

        suite('parseRoleComposition (the fail-closed parse)', () => {
                test('round-trips the canonical bytes into the identical record', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const outcome = parseRoleComposition(bytes);
                        assert.equal(outcome.ok, true);
                        if (outcome.ok) {
                                assert.equal(serializeRoleComposition(outcome.record), bytes);
                                assert.equal(outcome.record.industry, 'legal');
                                assert.equal(outcome.record.composedAtIso, FIXTURE_NOW_ISO);
                        }
                });
                test('non-string bytes and malformed JSON are refused fail-closed', () => {
                        assert.equal(parseRoleComposition(null).ok, false);
                        assert.equal((parseRoleComposition(null) as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                        assert.equal(parseRoleComposition('{not json').ok, false);
                        assert.equal((parseRoleComposition('{not json') as { rejection: { reason: string } }).rejection.reason, 'malformed-json');
                        assert.equal(parseRoleComposition('[1,2,3]').ok, false);
                        assert.equal((parseRoleComposition('[1,2,3]') as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                });
                test('a torn envelope (a missing key or a wrong structural type) is never a silent partial parse', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const withoutRoles = JSON.parse(bytes) as Record<string, unknown>;
                        delete withoutRoles.roles;
                        assert.equal((parseRoleComposition(JSON.stringify(withoutRoles)) as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                        const withTornWorkTypes = JSON.parse(bytes) as Record<string, unknown>;
                        withTornWorkTypes.workTypes = 'analysis';
                        assert.equal((parseRoleComposition(JSON.stringify(withTornWorkTypes)) as { rejection: { reason: string } }).rejection.reason, 'torn-envelope');
                });
                test('an unknown contract version is the unknown-contract-version rejection', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const drifted = JSON.parse(bytes) as Record<string, unknown>;
                        drifted.contractVersion = '0.9.9';
                        const outcome = parseRoleComposition(JSON.stringify(drifted));
                        assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'unknown-contract-version');
                });
                test('tampered extra keys are the unknown-key rejection (record, role and provenance level)', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const recordDrift = JSON.parse(bytes) as Record<string, unknown>;
                        recordDrift.extra = true;
                        assert.equal((parseRoleComposition(JSON.stringify(recordDrift)) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                        const roleDrift = JSON.parse(bytes) as Record<string, unknown>;
                        (roleDrift.roles as Record<string, unknown>[])[0].command = 'execution material';
                        assert.equal((parseRoleComposition(JSON.stringify(roleDrift)) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                        const provenanceDrift = JSON.parse(bytes) as Record<string, unknown>;
                        (provenanceDrift.provenance as Record<string, unknown>[])[0].weight = 3;
                        assert.equal((parseRoleComposition(JSON.stringify(provenanceDrift)) as { rejection: { reason: string } }).rejection.reason, 'unknown-key');
                });
                test('a semantically drifted record is the invalid-record rejection (the deep walk surfaces verbatim)', () => {
                        const bytes = serializeRoleComposition(parsedJson(fixtureRecord()));
                        const drifted = JSON.parse(bytes) as Record<string, unknown>;
                        drifted.industry = 'aerospace';
                        const outcome = parseRoleComposition(JSON.stringify(drifted));
                        assert.equal((outcome as { rejection: { reason: string } }).rejection.reason, 'invalid-record');
                        const tornProvenance = JSON.parse(bytes) as Record<string, unknown>;
                        tornProvenance.provenance = (tornProvenance.provenance as unknown[]).slice(0, 1);
                        assert.equal((parseRoleComposition(JSON.stringify(tornProvenance)) as { rejection: { reason: string } }).rejection.reason, 'invalid-record');
                });
        });

        suite('the determinism greps (the shipped modules quote the ban in law comments only)', () => {
                test('rolesContract.ts: every banned-global hit is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/rolesContract.ts');
                        assert.equal(hits.length > 0, true, 'the law comments quote the ban - the grep must find them');
                        for (const hit of hits) {
                                assert.equal(hit.trim().startsWith('*') || hit.trim().startsWith('/*') || hit.trim().startsWith('//'), true, `the hit must be a comment line: '${hit.trim()}'`);
                        }
                });
                test('rolesKit.ts: every banned-global hit is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/rolesKit.ts');
                        assert.equal(hits.length > 0, true, 'the law comments quote the ban - the grep must find them');
                        for (const hit of hits) {
                                assert.equal(hit.trim().startsWith('*') || hit.trim().startsWith('/*') || hit.trim().startsWith('//'), true, `the hit must be a comment line: '${hit.trim()}'`);
                        }
                });
                test('this test source carries zero banned-global hits (the patterns are assembled piecewise)', () => {
                        const hits = determinismGrepHits('./rolesContract.test.ts');
                        assert.deepEqual(hits, []);
                });
        });
});
