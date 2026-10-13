/*
 * DH-004 domain ontology/terminology contract test suite (mocha tdd
 * style, matching build/flauz/harness/roles/test/common/*.test.ts and
 * the landed DH-001/DH-002 family precedents).
 *
 * Fixture policy: every term, relation and timestamp below is
 * SYNTHETIC (the 'fixture-term-*' kebab keys, fixed fixture ISO
 * strings) and is NOT an authority value, NOT credential material,
 * NOT execution material. The frozen-vocabulary cross-pins import the
 * REAL DH-01 contract module and pin referential identity and verbatim
 * equality - THE REAL-VOCABULARY LAW as a test. The in-suite
 * determinism greps pin the shipped module to law-comment lines only
 * (the banned-global patterns are assembled piecewise so this test
 * source itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION,
        HARNESS_DESCRIPTOR_SCHEMA_KEYS as REAL_DESCRIPTOR_SCHEMA_KEYS,
        HARNESS_INDUSTRIES as REAL_INDUSTRIES,
        isHarnessIndustry as REAL_IS_HARNESS_INDUSTRY,
} from '../../../contract/common/domainHarnessContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        DOMAIN_TERM_SCHEMA_KEYS,
        HARNESS_INDUSTRIES,
        INDUSTRY_ONTOLOGY_SCHEMA_KEYS,
        INDUSTRY_TERM_CATALOGS,
        INDUSTRY_TERM_RELATIONS,
        ONTOLOGY_CONTRACTS_VERSION,
        ONTOLOGY_PARSE_REJECTION_REASONS,
        ONTOLOGY_VALIDATION_REJECTION_REASONS,
        TERM_DEFINITION_MAX_LENGTH,
        TERM_KEY_MAX_LENGTH,
        TERM_RELATION_CLASSES,
        TERM_RELATION_INVERSE_TABLE,
        TERM_RELATION_SCHEMA_KEYS,
        buildIndustryOntologyEnvelope,
        inverseRelationClassOf,
        isDomainTerm,
        isHarnessIndustry,
        isIndustryOntology,
        isKebabCaseTermKey,
        isOntologyParseRejectionReason,
        isOntologyRejectionReason,
        isTermRelationClass,
        parseIndustryOntology,
        serializeIndustryOntology,
        validateDomainTerm,
        validateIndustryOntology,
        validateTermRelation,
        walkRelationIntegrity,
} from '../../common/ontologyContract.js';
import type {
        DomainTerm,
        IndustryOntology,
        OntologyParseRejection,
        OntologyRejection,
        OntologyValidationOutcome,
} from '../../common/ontologyContract.js';

function fixtureTerm(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return { termKey: 'fixture-term', definition: 'the fixture definition', ...overrides };
}

function fixtureRelation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b', ...overrides };
}

function fixtureOntology(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
                contractVersion: '1.0.0',
                industry: 'legal',
                terms: [
                        { termKey: 'fixture-term-a', definition: 'the fixture a definition' },
                        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
                ],
                relations: [
                        { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                        { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                ],
                ...overrides,
        };
}

/** The synthetic three-term catalog (the integrity walk's resolution context). */
const SYNTHETIC_CATALOG: readonly DomainTerm[] = [
        { termKey: 'fixture-term-a', definition: 'the fixture a definition' },
        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
        { termKey: 'fixture-term-c', definition: 'the fixture c definition' },
];

function valueOf<T>(outcome: OntologyValidationOutcome<T>): T {
        if (outcome.ok) {
                return outcome.value;
        }
        assert.fail(`expected ok, received refusal: ${JSON.stringify(outcome.refusal)}`);
}

function refusalOf<T>(outcome: OntologyValidationOutcome<T>): OntologyRejection {
        if (!outcome.ok) {
                return outcome.refusal;
        }
        assert.fail(`expected a refusal, received ok: ${JSON.stringify(outcome.value)}`);
}

function parseRefusal(bytes: unknown): OntologyParseRejection {
        const outcome = parseIndustryOntology(bytes);
        if (!outcome.ok) {
                return outcome.rejection;
        }
        assert.fail(`expected a parse refusal, received ok: ${JSON.stringify(outcome.ontology)}`);
}

function parsedOntology(bytes: string): IndustryOntology {
        const outcome = parseIndustryOntology(bytes);
        if (outcome.ok) {
                return outcome.ontology;
        }
        assert.fail(`expected a parsed ontology, received refusal: ${JSON.stringify(outcome.rejection)}`);
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

suite('DH-004 ontology contract', () => {

        suite('the single-version law (the re-export chain)', () => {
                test('ONTOLOGY_CONTRACTS_VERSION is 1.0.0, declared ONCE here', () => {
                        assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
                });

                test('DOMAIN_HARNESS_CONTRACTS_VERSION is re-carried from the REAL DH-01 module', () => {
                        assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
                        assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
                });

                test('ONTOLOGY_VALIDATION_REJECTION_REASONS pinned verbatim: the WO sixteen stations in the exact walk order', () => {
                        assert.deepEqual([...ONTOLOGY_VALIDATION_REJECTION_REASONS], [
                                'malformed-record', 'no-fork', 'unknown-key', 'missing-key',
                                'unknown-industry', 'invalid-term-key', 'invalid-definition', 'duplicate-term-keys',
                                'malformed-relation', 'unknown-relation-class', 'unknown-term-ref', 'self-relation',
                                'duplicate-relation', 'missing-inverse-relation', 'version-mismatch', 'empty-catalog',
                        ]);
                });

                test('ONTOLOGY_PARSE_REJECTION_REASONS pinned verbatim (5)', () => {
                        assert.deepEqual([...ONTOLOGY_PARSE_REJECTION_REASONS], ['malformed-json', 'torn-envelope', 'unknown-contract-version', 'unknown-key', 'invalid-record']);
                });
        });

        suite('the real-vocabulary law (THE IMPORT pins)', () => {
                test('HARNESS_INDUSTRIES is the REAL DH-01 binding (referential identity) and pinned verbatim (16 members)', () => {
                        assert.equal(HARNESS_INDUSTRIES, REAL_INDUSTRIES);
                        assert.deepEqual([...HARNESS_INDUSTRIES], [...REAL_INDUSTRIES]);
                        assert.deepEqual([...REAL_INDUSTRIES], [
                                'software', 'legal', 'finance', 'healthcare', 'education', 'marketing', 'science', 'media',
                                'construction', 'logistics', 'retail', 'manufacturing', 'energy', 'agriculture', 'government', 'hospitality',
                        ]);
                });

                test('isHarnessIndustry is the REAL DH-01 binding (referential identity, the re-export)', () => {
                        assert.equal(isHarnessIndustry, REAL_IS_HARNESS_INDUSTRY);
                        assert.equal(isHarnessIndustry('legal'), true);
                        assert.equal(isHarnessIndustry('fintech'), false);
                });

                test('THE SCOPE BOUNDARY: the DH-01 descriptor alphabet stays the frozen 10 keys - terms are NOT a descriptor key', () => {
                        assert.equal(REAL_DESCRIPTOR_SCHEMA_KEYS.length, 10);
                        assert.equal((REAL_DESCRIPTOR_SCHEMA_KEYS as readonly string[]).includes('terms'), false);
                        assert.deepEqual([...REAL_DESCRIPTOR_SCHEMA_KEYS], [
                                'harnessId', 'contractVersion', 'industry', 'workTypes', 'displayName', 'roles',
                                'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs',
                        ]);
                });

                test('INDUSTRY_TERM_CATALOGS covers exactly the sixteen industries (key set equality, the list order)', () => {
                        assert.deepEqual(Object.keys(INDUSTRY_TERM_CATALOGS), [...HARNESS_INDUSTRIES]);
                });

                test('INDUSTRY_TERM_RELATIONS covers exactly the sixteen industries (key set equality, the list order)', () => {
                        assert.deepEqual(Object.keys(INDUSTRY_TERM_RELATIONS), [...HARNESS_INDUSTRIES]);
                });
        });

        suite('the frozen catalog law (the sixteen catalogs walked)', () => {
                test('every catalog holds 6-14 terms (the bounds) and is non-empty', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const catalog = INDUSTRY_TERM_CATALOGS[industry];
                                assert.equal(catalog.length >= 6, true, `${industry}: ${catalog.length} terms (the 6-term floor)`);
                                assert.equal(catalog.length <= 14, true, `${industry}: ${catalog.length} terms (the 14-term bound)`);
                        }
                });

                test('every frozen term passes validateDomainTerm (the 16 catalogs, all entries)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const term of INDUSTRY_TERM_CATALOGS[industry]) {
                                        const outcome = validateDomainTerm(term);
                                        assert.equal(outcome.ok, true, `${industry}/${term.termKey}: ${JSON.stringify(outcome.ok ? null : outcome.refusal)}`);
                                }
                        }
                });

                test('every frozen term carries EXACTLY the two keys (THE NO-FORK LAW pin on the frozen data)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const term of INDUSTRY_TERM_CATALOGS[industry]) {
                                        assert.deepEqual(Object.keys(term), ['termKey', 'definition'], `${industry}/${term.termKey}`);
                                }
                        }
                });

                test('termKeys are unique within each catalog (no duplicate-term-keys across the 16)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const keys = INDUSTRY_TERM_CATALOGS[industry].map((term) => term.termKey);
                                assert.equal(new Set(keys).size, keys.length, `${industry}: duplicate termKeys`);
                        }
                });

                test('every registry holds 2-6 relations and every relation passes validateTermRelation', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const registry = INDUSTRY_TERM_RELATIONS[industry];
                                assert.equal(registry.length >= 2, true, `${industry}: ${registry.length} relations (the 2-relation floor)`);
                                assert.equal(registry.length <= 6, true, `${industry}: ${registry.length} relations (the 6-relation bound)`);
                                for (const relation of registry) {
                                        const outcome = validateTermRelation(relation);
                                        assert.equal(outcome.ok, true, `${industry}: ${JSON.stringify(outcome.ok ? null : outcome.refusal)}`);
                                }
                        }
                });

                test('every relation end resolves in the SAME industry catalog and no relation is a self-relation', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const keys = new Set(INDUSTRY_TERM_CATALOGS[industry].map((term) => term.termKey));
                                for (const relation of INDUSTRY_TERM_RELATIONS[industry]) {
                                        assert.equal(keys.has(relation.fromTermKey), true, `${industry}: ${relation.fromTermKey} does not resolve`);
                                        assert.equal(keys.has(relation.toTermKey), true, `${industry}: ${relation.toTermKey} does not resolve`);
                                        assert.notEqual(relation.fromTermKey, relation.toTermKey, `${industry}: the self-relation ${relation.fromTermKey}`);
                                }
                        }
                });

                test('no duplicate triples in any registry (the 16 walked)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const triples = INDUSTRY_TERM_RELATIONS[industry].map((relation) => `${relation.fromTermKey} ${relation.relationClass} ${relation.toTermKey}`);
                                assert.equal(new Set(triples).size, triples.length, `${industry}: duplicate triples`);
                        }
                });

                test('THE INTEGRITY LAW reciprocity: every broader-than carries its narrower-than and every related-to its mirror (the 16 registries)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const triples = new Set(INDUSTRY_TERM_RELATIONS[industry].map((relation) => `${relation.fromTermKey} ${relation.relationClass} ${relation.toTermKey}`));
                                for (const relation of INDUSTRY_TERM_RELATIONS[industry]) {
                                        const inverseClass = inverseRelationClassOf(relation.relationClass);
                                        if (inverseClass === null) {
                                                continue;
                                        }
                                        const inverseTriple = `${relation.toTermKey} ${inverseClass} ${relation.fromTermKey}`;
                                        assert.equal(triples.has(inverseTriple), true, `${industry}: the inverse '${inverseTriple}' is absent`);
                                }
                        }
                });

                test('the class inventory: all four frozen classes are exercised across the union', () => {
                        const used = new Set<string>();
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const relation of INDUSTRY_TERM_RELATIONS[industry]) {
                                        used.add(relation.relationClass);
                                }
                        }
                        assert.deepEqual([...used].sort(), [...TERM_RELATION_CLASSES].slice().sort());
                });

                test('every frozen termKey is kebab-case and within the 64-character bound', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const term of INDUSTRY_TERM_CATALOGS[industry]) {
                                        assert.equal(isKebabCaseTermKey(term.termKey), true, `${industry}/${term.termKey}`);
                                }
                        }
                });

                test('every frozen definition is non-empty, at most 300 characters and control-free', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                for (const term of INDUSTRY_TERM_CATALOGS[industry]) {
                                        assert.equal(term.definition.length > 0, true, `${industry}/${term.termKey}: empty definition`);
                                        assert.equal(term.definition.length <= TERM_DEFINITION_MAX_LENGTH, true, `${industry}/${term.termKey}: ${term.definition.length} chars`);
                                        assert.equal(/[\u0000-\u001F\u007F-\u009F]/.test(term.definition), false, `${industry}/${term.termKey}: control characters`);
                                }
                        }
                });
        });

        suite('the term laws (the frozen constants and predicates)', () => {
                test('the bounds and the schema keys pinned', () => {
                        assert.equal(TERM_KEY_MAX_LENGTH, 64);
                        assert.equal(TERM_DEFINITION_MAX_LENGTH, 300);
                        assert.deepEqual([...DOMAIN_TERM_SCHEMA_KEYS], ['termKey', 'definition']);
                        assert.deepEqual([...TERM_RELATION_SCHEMA_KEYS], ['fromTermKey', 'relationClass', 'toTermKey']);
                        assert.deepEqual([...INDUSTRY_ONTOLOGY_SCHEMA_KEYS], ['contractVersion', 'industry', 'terms', 'relations']);
                });

                test('isKebabCaseTermKey: the green forms', () => {
                        for (const green of ['a', 'sku', 'a-b', 'a-b-test', 'a1-b2', 'source-code', 'revenue-per-available-room']) {
                                assert.equal(isKebabCaseTermKey(green), true, green);
                        }
                });

                test('isKebabCaseTermKey: the refusal forms (padding, doubling, case, separators, bound, type)', () => {
                        for (const refused of ['', '-a', 'a-', 'a--b', 'A-B', 'a b', 'a_b', 'a.b', 'a\u0007b', 'a'.repeat(65)]) {
                                assert.equal(isKebabCaseTermKey(refused), false, JSON.stringify(refused));
                        }
                        assert.equal(isKebabCaseTermKey('a'.repeat(64)), true, 'the 64-character bound is green');
                        assert.equal(isKebabCaseTermKey(123), false);
                        assert.equal(isKebabCaseTermKey(null), false);
                });

                test('TERM_RELATION_CLASSES pinned verbatim (4) and the membership predicate', () => {
                        assert.deepEqual([...TERM_RELATION_CLASSES], ['broader-than', 'narrower-than', 'related-to', 'part-of']);
                        assert.equal(isTermRelationClass('part-of'), true);
                        assert.equal(isTermRelationClass('Part-Of'), false);
                        assert.equal(isTermRelationClass('has-part'), false);
                        assert.equal(isTermRelationClass(123), false);
                });

                test('TERM_RELATION_INVERSE_TABLE pinned verbatim and inverseRelationClassOf behaviors', () => {
                        assert.deepEqual([...TERM_RELATION_INVERSE_TABLE], [
                                { relationClass: 'broader-than', inverseClass: 'narrower-than' },
                                { relationClass: 'narrower-than', inverseClass: 'broader-than' },
                                { relationClass: 'related-to', inverseClass: 'related-to' },
                                { relationClass: 'part-of', inverseClass: null },
                        ]);
                        assert.equal(inverseRelationClassOf('broader-than'), 'narrower-than');
                        assert.equal(inverseRelationClassOf('narrower-than'), 'broader-than');
                        assert.equal(inverseRelationClassOf('related-to'), 'related-to');
                        assert.equal(inverseRelationClassOf('part-of'), null);
                });
        });

        suite('validateDomainTerm (the single-term station walk)', () => {
                test('the green path returns the canonical { termKey, definition } copy', () => {
                        const value = valueOf(validateDomainTerm(fixtureTerm()));
                        assert.deepEqual(value, { termKey: 'fixture-term', definition: 'the fixture definition' });
                        assert.deepEqual(Object.keys(value), ['termKey', 'definition']);
                });

                test('a non-record is the malformed-record refusal', () => {
                        for (const bad of ['not-a-term', 123, null, undefined]) {
                                const refusal = refusalOf(validateDomainTerm(bad));
                                assert.equal(refusal.reason, 'malformed-record');
                                assert.deepEqual(refusal.items, ['term']);
                        }
                });

                test('non-string carriers are malformed-record naming the carriers (a PRESENT-but-invalid value)', () => {
                        const key = refusalOf(validateDomainTerm(fixtureTerm({ termKey: 123 })));
                        assert.equal(key.reason, 'malformed-record');
                        assert.deepEqual(key.items, ['termKey']);
                        const definition = refusalOf(validateDomainTerm(fixtureTerm({ definition: 123 })));
                        assert.equal(definition.reason, 'malformed-record');
                        assert.deepEqual(definition.items, ['definition']);
                });

                test('an extra key is the no-fork refusal (THE NO-FORK LAW - relations live in the registry, never inline)', () => {
                        const refusal = refusalOf(validateDomainTerm(fixtureTerm({ synonyms: ['fixture-synonym'] })));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.equal(refusal.law, 'THE NO-FORK LAW');
                        assert.deepEqual(refusal.items, ['synonyms']);
                        const forbidden = refusalOf(validateDomainTerm(fixtureTerm({ command: 'fixture-command' })));
                        assert.equal(forbidden.reason, 'no-fork');
                        assert.deepEqual(forbidden.items, ['command']);
                });

                test('an absent key is the missing-key refusal (the DH-01 absent-key discipline - never a structural station)', () => {
                        const withoutKey = { ...fixtureTerm() } as Record<string, unknown>;
                        delete withoutKey.termKey;
                        const key = refusalOf(validateDomainTerm(withoutKey));
                        assert.equal(key.reason, 'missing-key');
                        assert.deepEqual(key.items, ['termKey']);
                        const withoutDefinition = { ...fixtureTerm() } as Record<string, unknown>;
                        delete withoutDefinition.definition;
                        const definition = refusalOf(validateDomainTerm(withoutDefinition));
                        assert.equal(definition.reason, 'missing-key');
                        assert.deepEqual(definition.items, ['definition']);
                });

                test('the termKey bounds: empty and over-length (65 chars) are invalid-term-key', () => {
                        const empty = refusalOf(validateDomainTerm(fixtureTerm({ termKey: '' })));
                        assert.equal(empty.reason, 'invalid-term-key');
                        assert.deepEqual(empty.items, ['empty']);
                        const overLength = refusalOf(validateDomainTerm(fixtureTerm({ termKey: 'a'.repeat(65) })));
                        assert.equal(overLength.reason, 'invalid-term-key');
                        assert.deepEqual(overLength.items, ['65 chars']);
                        assert.equal(validateDomainTerm(fixtureTerm({ termKey: 'a'.repeat(64) })).ok, true, 'the 64-character bound is green');
                });

                test('the kebab alphabet violations are invalid-term-key (the not-kebab-case item)', () => {
                        for (const bad of ['Fixture-Term', 'fixture term', 'fixture_term', 'fixture--term', '-fixture-term', 'fixture-term-', 'fixture.term']) {
                                const refusal = refusalOf(validateDomainTerm(fixtureTerm({ termKey: bad })));
                                assert.equal(refusal.reason, 'invalid-term-key', bad);
                                assert.deepEqual(refusal.items, ['not kebab-case'], bad);
                        }
                });

                test('the definition bounds: empty, over-length (301 chars) and control characters are invalid-definition', () => {
                        const empty = refusalOf(validateDomainTerm(fixtureTerm({ definition: '' })));
                        assert.equal(empty.reason, 'invalid-definition');
                        assert.deepEqual(empty.items, ['empty']);
                        const overLength = refusalOf(validateDomainTerm(fixtureTerm({ definition: 'd'.repeat(301) })));
                        assert.equal(overLength.reason, 'invalid-definition');
                        assert.deepEqual(overLength.items, ['301 chars']);
                        const control = refusalOf(validateDomainTerm(fixtureTerm({ definition: 'the fixture\u0007definition' })));
                        assert.equal(control.reason, 'invalid-definition');
                        assert.deepEqual(control.items, ['U+0007']);
                });

                test('the first-failure walk order: an extra key fires no-fork BEFORE the field stations', () => {
                        const refusal = refusalOf(validateDomainTerm({ termKey: 'Not Kebab', definition: '', tools: 'fixture-tools' }));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.deepEqual(refusal.items, ['tools']);
                });
        });

        suite('validateTermRelation (the single-relation station walk)', () => {
                test('the green path returns the canonical { fromTermKey, relationClass, toTermKey } copy', () => {
                        const value = valueOf(validateTermRelation(fixtureRelation()));
                        assert.deepEqual(value, { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' });
                        assert.deepEqual(Object.keys(value), ['fromTermKey', 'relationClass', 'toTermKey']);
                });

                test('a non-record is the malformed-relation refusal', () => {
                        for (const bad of ['not-a-relation', 123, null]) {
                                const refusal = refusalOf(validateTermRelation(bad));
                                assert.equal(refusal.reason, 'malformed-relation');
                                assert.deepEqual(refusal.items, ['relation']);
                        }
                });

                test('absent or non-string carriers are malformed-relation naming the carriers', () => {
                        const nonString = refusalOf(validateTermRelation(fixtureRelation({ fromTermKey: 123 })));
                        assert.equal(nonString.reason, 'malformed-relation');
                        assert.deepEqual(nonString.items, ['fromTermKey']);
                        const absent = { ...fixtureRelation() } as Record<string, unknown>;
                        delete absent.relationClass;
                        const absentRefusal = refusalOf(validateTermRelation(absent));
                        assert.equal(absentRefusal.reason, 'malformed-relation');
                        assert.deepEqual(absentRefusal.items, ['relationClass']);
                });

                test('an extra key is the no-fork refusal (the registry entry shape is closed)', () => {
                        const refusal = refusalOf(validateTermRelation(fixtureRelation({ weight: 3 })));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.equal(refusal.law, 'THE NO-FORK LAW');
                        assert.deepEqual(refusal.items, ['weight']);
                });

                test('a non-member class is the unknown-relation-class refusal (THE FROZEN-CATALOG LAW)', () => {
                        const refusal = refusalOf(validateTermRelation(fixtureRelation({ relationClass: 'has-part' })));
                        assert.equal(refusal.reason, 'unknown-relation-class');
                        assert.equal(refusal.law, 'THE FROZEN-CATALOG LAW');
                        assert.deepEqual(refusal.items, ['has-part']);
                });

                test('the first-failure walk order: the structural station fires before no-fork and the class station', () => {
                        const refusal = refusalOf(validateTermRelation({ fromTermKey: 123, relationClass: 'has-part', toTermKey: 'fixture-term-b', weight: 3 }));
                        assert.equal(refusal.reason, 'malformed-relation');
                        assert.deepEqual(refusal.items, ['fromTermKey']);
                });
        });

        suite('walkRelationIntegrity (THE INTEGRITY LAW\'s report machine)', () => {
                test('a clean synthetic registry returns no findings', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                                { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                                { fromTermKey: 'fixture-term-c', relationClass: 'part-of', toTermKey: 'fixture-term-a' },
                        ]);
                        assert.deepEqual([...findings], []);
                });

                test('the REAL frozen registries: a clean report for every one of the sixteen industries', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const findings = walkRelationIntegrity(INDUSTRY_TERM_CATALOGS[industry], INDUSTRY_TERM_RELATIONS[industry]);
                                assert.deepEqual([...findings], [], `${industry}: ${JSON.stringify(findings)}`);
                        }
                });

                test('a non-record relation is a malformed-relation finding', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, ['not-a-relation']);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'malformed-relation');
                        assert.deepEqual([...findings[0].items], ['relations[0]']);
                });

                test('an absent or non-string carrier is a malformed-relation finding naming the carrier', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [fixtureRelation({ fromTermKey: 123 })]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'malformed-relation');
                        assert.deepEqual([...findings[0].items], ['relations[0].fromTermKey']);
                });

                test('a non-member class is an unknown-relation-class finding (the relation exits the walk - no further findings)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [fixtureRelation({ relationClass: 'has-part' })]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'unknown-relation-class');
                        assert.equal(findings[0].law, 'THE FROZEN-CATALOG LAW');
                        assert.deepEqual([...findings[0].items], ['relations[0]:has-part']);
                });

                test('an unresolved end is an unknown-term-ref finding (the fromTermKey / toTermKey item grammar)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'part-of', toTermKey: 'no-such-term' },
                        ]);
                        const unresolved = findings.filter((finding) => finding.reason === 'unknown-term-ref');
                        assert.equal(unresolved.length, 1);
                        assert.deepEqual([...unresolved[0].items], ['relations[0]:toTermKey=no-such-term']);
                        assert.equal(unresolved[0].law, 'THE INTEGRITY LAW');
                });

                test('a self-relation is a self-relation finding', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                        ]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'self-relation');
                        assert.deepEqual([...findings[0].items], ['relations[0]:fixture-term-a']);
                });

                test('a duplicate triple is a duplicate-relation finding (the triple grammar)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                                { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                                { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                        ]);
                        const duplicates = findings.filter((finding) => finding.reason === 'duplicate-relation');
                        assert.equal(duplicates.length, 1);
                        assert.deepEqual([...duplicates[0].items], ['fixture-term-a related-to fixture-term-b']);
                });

                test('a broader-than without its narrower-than is a missing-inverse-relation finding naming the expected inverse', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'broader-than', toTermKey: 'fixture-term-b' },
                        ]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'missing-inverse-relation');
                        assert.deepEqual([...findings[0].items], ['expected fixture-term-b narrower-than fixture-term-a']);
                });

                test('a related-to without its mirror is a missing-inverse-relation finding', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                        ]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'missing-inverse-relation');
                        assert.deepEqual([...findings[0].items], ['expected fixture-term-b related-to fixture-term-a']);
                });

                test('a narrower-than without its broader-than is a missing-inverse-relation finding (both twins demanded)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-b', relationClass: 'narrower-than', toTermKey: 'fixture-term-a' },
                        ]);
                        assert.equal(findings.length, 1);
                        assert.equal(findings[0].reason, 'missing-inverse-relation');
                        assert.deepEqual([...findings[0].items], ['expected fixture-term-a broader-than fixture-term-b']);
                });

                test('a lone part-of is CLEAN (the reciprocity table\'s null row - part-of demands no inverse)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-c', relationClass: 'part-of', toTermKey: 'fixture-term-a' },
                        ]);
                        assert.deepEqual([...findings], []);
                });

                test('the findings are station-ordered: unknown-term-ref reports before self-relation', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'fixture-term-a', relationClass: 'part-of', toTermKey: 'no-such-term' },
                                { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                        ]);
                        assert.deepEqual(findings.map((finding) => finding.reason), ['unknown-term-ref', 'self-relation']);
                });

                test('every offender at the reporting station is listed (the two unresolved ends)', () => {
                        const findings = walkRelationIntegrity(SYNTHETIC_CATALOG, [
                                { fromTermKey: 'no-such-a', relationClass: 'part-of', toTermKey: 'fixture-term-a' },
                                { fromTermKey: 'fixture-term-b', relationClass: 'part-of', toTermKey: 'no-such-b' },
                        ]);
                        const unresolved = findings.filter((finding) => finding.reason === 'unknown-term-ref');
                        assert.equal(unresolved.length, 1);
                        assert.deepEqual([...unresolved[0].items], ['relations[0]:fromTermKey=no-such-a', 'relations[1]:toTermKey=no-such-b']);
                });
        });

        suite('validateIndustryOntology (the deep envelope walk)', () => {
                test('the green path: every one of the sixteen REAL envelopes passes and returns the canonical copy', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const envelope = valueOf(buildIndustryOntologyEnvelope(industry));
                                const outcome = validateIndustryOntology(envelope);
                                assert.equal(outcome.ok, true, `${industry}: ${JSON.stringify(outcome.ok ? null : outcome.refusal)}`);
                                const value = valueOf(outcome);
                                assert.deepEqual(value.terms, INDUSTRY_TERM_CATALOGS[industry], industry);
                                assert.deepEqual(value.relations, INDUSTRY_TERM_RELATIONS[industry], industry);
                        }
                });

                test('a non-record is the malformed-record refusal', () => {
                        for (const bad of ['not-an-ontology', 123, null]) {
                                const refusal = refusalOf(validateIndustryOntology(bad));
                                assert.equal(refusal.reason, 'malformed-record');
                                assert.deepEqual(refusal.items, ['ontology']);
                        }
                });

                test('non-array carriers (terms / relations) are malformed-record naming the carrier', () => {
                        const terms = refusalOf(validateIndustryOntology(fixtureOntology({ terms: 'nope' })));
                        assert.equal(terms.reason, 'malformed-record');
                        assert.deepEqual(terms.items, ['terms']);
                        const relations = refusalOf(validateIndustryOntology(fixtureOntology({ relations: 'nope' })));
                        assert.equal(relations.reason, 'malformed-record');
                        assert.deepEqual(relations.items, ['relations']);
                });

                test('a non-record term entry is malformed-record (the terms[i] item)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ terms: ['not-a-term'] })));
                        assert.equal(refusal.reason, 'malformed-record');
                        assert.deepEqual(refusal.items, ['terms[0]']);
                });

                test('a non-string term carrier is malformed-record (the terms[i].key item)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ terms: [{ termKey: 'fixture-term-a', definition: 123 }] })));
                        assert.equal(refusal.reason, 'malformed-record');
                        assert.deepEqual(refusal.items, ['terms[0].definition']);
                });

                test('an extra key on a term entry is the no-fork refusal (THE NO-FORK LAW - never inline relations)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [
                                        { termKey: 'fixture-term-a', definition: 'the fixture a definition', relatedTerms: ['fixture-term-b'] },
                                        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.equal(refusal.law, 'THE NO-FORK LAW');
                        assert.deepEqual(refusal.items, ['terms[0]:relatedTerms']);
                });

                test('an extra key on a relation entry is the no-fork refusal', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [
                                        { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b', weight: 3 },
                                        { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'no-fork');
                        assert.deepEqual(refusal.items, ['relations[0]:weight']);
                });

                test('an envelope extra key is the unknown-key refusal (the strict four-key schema)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ bogus: 1 })));
                        assert.equal(refusal.reason, 'unknown-key');
                        assert.deepEqual(refusal.items, ['bogus']);
                });

                test('an absent envelope key is the missing-key refusal (each of the four)', () => {
                        for (const key of ['contractVersion', 'industry', 'terms', 'relations']) {
                                const candidate = fixtureOntology() as Record<string, unknown>;
                                delete candidate[key];
                                const refusal = refusalOf(validateIndustryOntology(candidate));
                                assert.equal(refusal.reason, 'missing-key', key);
                                assert.deepEqual(refusal.items, [key], key);
                        }
                });

                test('an absent term entry key is missing-key (the terms[i].key item - the absent-key discipline)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [
                                        { termKey: 'fixture-term-a' },
                                        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'missing-key');
                        assert.deepEqual(refusal.items, ['terms[0].definition']);
                });

                test('an absent relation entry key is missing-key (the relations[i].key item)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [
                                        { fromTermKey: 'fixture-term-a', toTermKey: 'fixture-term-b' },
                                        { fromTermKey: 'fixture-term-b', relationClass: 'related-to', toTermKey: 'fixture-term-a' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'missing-key');
                        assert.deepEqual(refusal.items, ['relations[0].relationClass']);
                });

                test('a non-member industry is the unknown-industry refusal (THE REAL-VOCABULARY LAW)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ industry: 'fintech' })));
                        assert.equal(refusal.reason, 'unknown-industry');
                        assert.equal(refusal.law, 'THE REAL-VOCABULARY LAW');
                        assert.deepEqual(refusal.items, ['fintech']);
                        const nonString = refusalOf(validateIndustryOntology(fixtureOntology({ industry: 123 })));
                        assert.equal(nonString.reason, 'unknown-industry');
                });

                test('a bad termKey inside the envelope is invalid-term-key with the terms[i] item prefix', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [
                                        { termKey: 'Not Kebab', definition: 'the fixture a definition' },
                                        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'invalid-term-key');
                        assert.deepEqual(refusal.items, ['terms[0]:not kebab-case']);
                });

                test('a bad definition inside the envelope is invalid-definition with the terms[i] item prefix', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [
                                        { termKey: 'fixture-term-a', definition: '' },
                                        { termKey: 'fixture-term-b', definition: 'the fixture b definition' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'invalid-definition');
                        assert.deepEqual(refusal.items, ['terms[0]:empty']);
                });

                test('duplicate termKeys inside the envelope are duplicate-term-keys', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [
                                        { termKey: 'fixture-term-a', definition: 'the fixture a definition' },
                                        { termKey: 'fixture-term-a', definition: 'the fixture a definition (repeated)' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'duplicate-term-keys');
                        assert.deepEqual(refusal.items, ['fixture-term-a']);
                });

                test('a non-record relation entry is malformed-relation (the integrity delegation)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ relations: ['not-a-relation'] })));
                        assert.equal(refusal.reason, 'malformed-relation');
                        assert.deepEqual(refusal.items, ['relations[0]']);
                });

                test('an unresolved relation end is unknown-term-ref (the integrity delegation)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [{ fromTermKey: 'fixture-term-a', relationClass: 'part-of', toTermKey: 'no-such-term' }],
                        })));
                        assert.equal(refusal.reason, 'unknown-term-ref');
                        assert.deepEqual(refusal.items, ['relations[0]:toTermKey=no-such-term']);
                });

                test('a self-relation is the self-relation refusal (the integrity delegation)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [{ fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-a' }],
                        })));
                        assert.equal(refusal.reason, 'self-relation');
                });

                test('a duplicate triple is the duplicate-relation refusal (the integrity delegation)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [
                                        { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                                        { fromTermKey: 'fixture-term-a', relationClass: 'related-to', toTermKey: 'fixture-term-b' },
                                ],
                        })));
                        assert.equal(refusal.reason, 'duplicate-relation');
                        assert.deepEqual(refusal.items, ['fixture-term-a related-to fixture-term-b']);
                });

                test('a missing inverse is the missing-inverse-relation refusal (the integrity delegation)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                relations: [{ fromTermKey: 'fixture-term-a', relationClass: 'broader-than', toTermKey: 'fixture-term-b' }],
                        })));
                        assert.equal(refusal.reason, 'missing-inverse-relation');
                        assert.deepEqual(refusal.items, ['expected fixture-term-b narrower-than fixture-term-a']);
                });

                test('a wrong contractVersion is the version-mismatch refusal (THE SINGLE-VERSION LAW)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ contractVersion: '2.0.0' })));
                        assert.equal(refusal.reason, 'version-mismatch');
                        assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
                        assert.deepEqual(refusal.items, ['2.0.0']);
                });

                test('an empty terms array is the empty-catalog refusal', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ terms: [], relations: [] })));
                        assert.equal(refusal.reason, 'empty-catalog');
                        assert.equal(refusal.law, 'THE FROZEN-CATALOG LAW');
                        assert.deepEqual(refusal.items, ['terms']);
                });

                test('the station order: version-mismatch (15) reports before empty-catalog (16)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({ contractVersion: '2.0.0', terms: [], relations: [] })));
                        assert.equal(refusal.reason, 'version-mismatch');
                });

                test('the station order: the term stations (6) report before the relation stations (11)', () => {
                        const refusal = refusalOf(validateIndustryOntology(fixtureOntology({
                                terms: [{ termKey: 'Not Kebab', definition: 'the fixture a definition' }],
                                relations: [{ fromTermKey: 'fixture-term-a', relationClass: 'part-of', toTermKey: 'no-such-term' }],
                        })));
                        assert.equal(refusal.reason, 'invalid-term-key');
                });
        });

        suite('buildIndustryOntologyEnvelope + the canonical serialization', () => {
                test('the envelope carries the frozen catalog + registry BY REFERENCE (the identity pin)', () => {
                        const envelope = valueOf(buildIndustryOntologyEnvelope('legal'));
                        assert.equal(envelope.terms, INDUSTRY_TERM_CATALOGS.legal);
                        assert.equal(envelope.relations, INDUSTRY_TERM_RELATIONS.legal);
                        assert.equal(envelope.contractVersion, ONTOLOGY_CONTRACTS_VERSION);
                });

                test('a non-member industry is the unknown-industry refusal', () => {
                        const refusal = refusalOf(buildIndustryOntologyEnvelope('fintech'));
                        assert.equal(refusal.reason, 'unknown-industry');
                        assert.deepEqual(refusal.items, ['fintech']);
                });

                test('the canonical byte pin (the exact fixed-key-order JSON)', () => {
                        const bytes = serializeIndustryOntology(fixtureOntology());
                        assert.equal(bytes, '{"contractVersion":"1.0.0","industry":"legal","terms":[{"termKey":"fixture-term-a","definition":"the fixture a definition"},{"termKey":"fixture-term-b","definition":"the fixture b definition"}],"relations":[{"fromTermKey":"fixture-term-a","relationClass":"related-to","toTermKey":"fixture-term-b"},{"fromTermKey":"fixture-term-b","relationClass":"related-to","toTermKey":"fixture-term-a"}]}');
                });

                test('double-serialize byte-equality and the round-trip deepEqual', () => {
                        const bytes = serializeIndustryOntology(fixtureOntology());
                        assert.equal(serializeIndustryOntology(JSON.parse(bytes)), bytes);
                        assert.deepEqual(parsedOntology(bytes), valueOf(validateIndustryOntology(fixtureOntology())));
                });

                test('serialize throws TypeError on a malformed record (never dishonest bytes)', () => {
                        assert.throws(() => serializeIndustryOntology(fixtureOntology({ industry: 'fintech' })), TypeError);
                        assert.throws(() => serializeIndustryOntology('not-an-ontology'), TypeError);
                });

                test('every REAL envelope serializes and re-parses byte-identically (the sixteen)', () => {
                        for (const industry of HARNESS_INDUSTRIES) {
                                const envelope = valueOf(buildIndustryOntologyEnvelope(industry));
                                const bytes = serializeIndustryOntology(envelope);
                                const parsed = parsedOntology(bytes);
                                assert.equal(serializeIndustryOntology(parsed), bytes, industry);
                                assert.deepEqual(parsed.terms, INDUSTRY_TERM_CATALOGS[industry], industry);
                        }
                });
        });

        suite('parseIndustryOntology (the fail-closed parse)', () => {
                test('the green round-trip carries the canonical value', () => {
                        const outcome = parseIndustryOntology(serializeIndustryOntology(fixtureOntology()));
                        assert.equal(outcome.ok, true);
                });

                test('non-string bytes are torn-envelope', () => {
                        const rejection = parseRefusal(123);
                        assert.equal(rejection.reason, 'torn-envelope');
                        assert.match(rejection.detail, /bytes must be a string/);
                });

                test('malformed JSON is malformed-json', () => {
                        const rejection = parseRefusal('{not json');
                        assert.equal(rejection.reason, 'malformed-json');
                        assert.match(rejection.detail, /not valid JSON/);
                });

                test('a non-object JSON payload is torn-envelope', () => {
                        const rejection = parseRefusal('["not-an-envelope"]');
                        assert.equal(rejection.reason, 'torn-envelope');
                        assert.match(rejection.detail, /must carry a JSON object/);
                });

                test('a missing key is torn-envelope (never a silent partial parse)', () => {
                        const rejection = parseRefusal('{"contractVersion":"1.0.0","industry":"legal","terms":[]}');
                        assert.equal(rejection.reason, 'torn-envelope');
                        assert.match(rejection.detail, /'relations' key is missing/);
                });

                test('a wrong structural carrier is torn-envelope', () => {
                        const rejection = parseRefusal('{"contractVersion":"1.0.0","industry":"legal","terms":"nope","relations":[]}');
                        assert.equal(rejection.reason, 'torn-envelope');
                        assert.match(rejection.detail, /wrong structural type/);
                });

                test('a wrong contractVersion is unknown-contract-version (THE SINGLE-VERSION LAW\'s parse station)', () => {
                        const rejection = parseRefusal(serializeIndustryOntology(fixtureOntology()).replace('"contractVersion":"1.0.0"', '"contractVersion":"0.9.0"'));
                        assert.equal(rejection.reason, 'unknown-contract-version');
                        assert.match(rejection.detail, /THE SINGLE-VERSION LAW/);
                });

                test('unknown keys at the envelope / term / relation level are unknown-key', () => {
                        const envelopeLevel = parseRefusal(`${serializeIndustryOntology(fixtureOntology()).slice(0, -1)},"bogus":1}`);
                        assert.equal(envelopeLevel.reason, 'unknown-key');
                        assert.match(envelopeLevel.detail, /the record carries the unknown key/);
                        const termLevel = parseRefusal('{"contractVersion":"1.0.0","industry":"legal","terms":[{"termKey":"fixture-term-a","definition":"d","synonyms":[]}],"relations":[]}');
                        assert.equal(termLevel.reason, 'unknown-key');
                        assert.match(termLevel.detail, /terms\[0\]/);
                        const relationLevel = parseRefusal('{"contractVersion":"1.0.0","industry":"legal","terms":[{"termKey":"fixture-term-a","definition":"d"}],"relations":[{"fromTermKey":"fixture-term-a","relationClass":"part-of","toTermKey":"fixture-term-a","weight":1}]}');
                        assert.equal(relationLevel.reason, 'unknown-key');
                        assert.match(relationLevel.detail, /relations\[0\]/);
                });

                test('an invalid record is invalid-record naming the deep walk\'s first refusal', () => {
                        const rejection = parseRefusal(serializeIndustryOntology(fixtureOntology()).replace('"industry":"legal"', '"industry":"fintech"'));
                        assert.equal(rejection.reason, 'invalid-record');
                        assert.match(rejection.detail, /unknown-industry/);
                });
        });

        suite('the frozen predicates', () => {
                test('the membership predicates over the closed lists', () => {
                        assert.equal(isOntologyRejectionReason('empty-catalog'), true);
                        assert.equal(isOntologyRejectionReason('NOPE'), false);
                        assert.equal(isOntologyParseRejectionReason('torn-envelope'), true);
                        assert.equal(isOntologyParseRejectionReason('NOPE'), false);
                        assert.equal(isTermRelationClass('part-of'), true);
                        assert.equal(isKebabCaseTermKey('fixture-term-a'), true);
                });

                test('isIndustryOntology is the deep walk\'s guard', () => {
                        assert.equal(isIndustryOntology(fixtureOntology()), true);
                        assert.equal(isIndustryOntology(fixtureOntology({ industry: 'fintech' })), false);
                        assert.equal(isIndustryOntology('not-an-ontology'), false);
                });

                test('isDomainTerm is the term walk\'s guard', () => {
                        assert.equal(isDomainTerm(fixtureTerm()), true);
                        assert.equal(isDomainTerm(fixtureTerm({ termKey: 'Not Kebab' })), false);
                        assert.equal(isDomainTerm('not-a-term'), false);
                });
        });

        suite('in-suite determinism greps (the determinism law as a test)', () => {
                test('every banned-global hit in ontologyContract.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/ontologyContract.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });

                test('this test source itself is grep-clean (the piecewise assembly)', () => {
                        const hits = determinismGrepHits('./ontologyContract.test.ts');
                        assert.deepEqual(hits, []);
                });
        });
});
