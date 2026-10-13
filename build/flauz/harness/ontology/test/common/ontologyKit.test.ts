/*
 * DH-004 domain ontology/terminology kit test suite (mocha tdd style,
 * matching build/flauz/harness/roles/test/common/rolesKit.test.ts -
 * the landed DH-003 family precedent - and the DH-001/DH-002 kit
 * batteries before it).
 *
 * Fixture policy: every term key, industry and timestamp below is
 * SYNTHETIC ('fixture-term-*' keys, fixed fixture ISO strings) and is
 * NOT an authority value, NOT credential material, NOT execution
 * material. The kit is STATELESS: there is no fs port, no rng and no
 * ledger - the fixtures are deterministic test doubles for the clock
 * ONLY (fixed or counter-based - NEVER the random global, never a
 * real clock). The factory consumes exactly ONE clock read (the
 * seam-validation read); lookupTerm consumes exactly ONE read per
 * SUCCESSFUL lookup (a refused lookup consumes none); the counter
 * pins below account for them. The in-suite determinism greps pin the
 * shipped modules to law-comment lines only (the banned-global
 * patterns are assembled piecewise so this test source itself stays
 * grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HARNESS_INDUSTRIES as REAL_INDUSTRIES } from '../../../contract/common/domainHarnessContract.js';
import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION } from '../../../contract/common/domainHarnessContract.js';
import {
        INDUSTRY_TERM_CATALOGS as REAL_CATALOGS,
        INDUSTRY_TERM_RELATIONS as REAL_RELATIONS,
        ONTOLOGY_CONTRACTS_VERSION as CONTRACT_VERSION,
        ONTOLOGY_VALIDATION_REJECTION_REASONS as CONTRACT_REJECTION_REASONS,
} from '../../common/ontologyContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        INDUSTRY_TERM_CATALOGS,
        INDUSTRY_TERM_RELATIONS,
        ONTOLOGY_CONTRACTS_VERSION,
        ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS,
        ONTOLOGY_KIT_REFUSAL_REASONS,
        createOntologyKit,
        isOntologyKitRefusalReason,
} from '../../common/ontologyKit.js';
import type {
        DomainTerm,
        OntologyCatalogOutcome,
        OntologyIntegrityOutcome,
        OntologyKit,
        OntologyKitOptions,
        OntologyKitRefusal,
        OntologyLookupOutcome,
        OntologyTermSetOutcome,
        RelationIntegrityReport,
        TermLookupRecord,
        TermRelation,
} from '../../common/ontologyKit.js';

const FIXTURE_CLOCK_READ = '2026-10-13T00:00:00.000Z';

function fixedClock(): () => string {
        return () => FIXTURE_CLOCK_READ;
}

/** The advancing fixture clock (deterministic ISO strings, never a real clock). */
function counterClock(): { clock: () => string; reads: string[] } {
        const reads: string[] = [];
        const clock = (): string => {
                const read = `2026-10-13T00:00:${String(reads.length + 1).padStart(2, '0')}.000Z`;
                reads.push(read);
                return read;
        };
        return { clock, reads };
}

/**
 * The scriptable clock (the corrupt-seam seam): yields the scripted
 * values in order, repeating the last. The factory consumes read 0;
 * the kit ops consume the next ones.
 */
function scriptableClock(script: readonly unknown[]): { clock: () => unknown; reads: () => number } {
        let index = 0;
        const clock = (): unknown => {
                const value = script[Math.min(index, script.length - 1)];
                index += 1;
                return value;
        };
        return { clock, reads: () => index };
}

function makeKit(): OntologyKit {
        return createOntologyKit({ clock: fixedClock() });
}

function lookupOf(outcome: OntologyLookupOutcome): TermLookupRecord {
        if (outcome.ok) {
                return outcome.lookup;
        }
        assert.fail(`expected an ok lookup, received refusal: ${JSON.stringify(outcome.refusal)}`);
}

function termSetOf(outcome: OntologyTermSetOutcome): readonly import('../../common/ontologyContract.js').DomainTerm[] {
        if (outcome.ok) {
                return outcome.terms;
        }
        assert.fail(`expected an ok term set, received refusal: ${JSON.stringify(outcome.refusal)}`);
}

function catalogOf(outcome: OntologyCatalogOutcome): { terms: readonly import('../../common/ontologyContract.js').DomainTerm[]; relations: readonly import('../../common/ontologyContract.js').TermRelation[] } {
        if (outcome.ok) {
                return { terms: outcome.terms, relations: outcome.relations };
        }
        assert.fail(`expected an ok catalog, received refusal: ${JSON.stringify(outcome.refusal)}`);
}

function reportOf(outcome: OntologyIntegrityOutcome): import('../../common/ontologyKit.js').RelationIntegrityReport {
        if (outcome.ok) {
                return outcome.report;
        }
        assert.fail(`expected an ok report, received refusal: ${JSON.stringify(outcome.refusal)}`);
}

function refusalOf<T extends { ok: boolean; refusal?: OntologyKitRefusal }>(outcome: T): OntologyKitRefusal {
        if (!outcome.ok) {
                return (outcome as { refusal: OntologyKitRefusal }).refusal;
        }
        assert.fail(`expected a refusal, received ok: ${JSON.stringify(outcome)}`);
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

suite('DH-004 ontology kit', () => {

        suite('the factory (fail-closed)', () => {
                test('the green factory constructs the five-op kit', () => {
                        const kit = createOntologyKit({ clock: fixedClock() });
                        assert.equal(typeof kit.lookupTerm, 'function');
                        assert.equal(typeof kit.validateTermSet, 'function');
                        assert.equal(typeof kit.inspectCatalog, 'function');
                        assert.equal(typeof kit.relationIntegrityReport, 'function');
                        assert.equal(typeof kit.dispose, 'function');
                });

                test('options not an object is a TypeError (the DH-01 message shape)', () => {
                        for (const bad of [null, undefined, 123, 'nope']) {
                                assert.throws(() => createOntologyKit(bad as unknown as OntologyKitOptions), /createOntologyKit: options must be an object/);
                        }
                });

                test('a non-function clock is a TypeError (the injected-clock law)', () => {
                        assert.throws(
                                () => createOntologyKit({ clock: 123 as unknown as () => string }),
                                /createOntologyKit: options\.clock must be a function returning ISO string values \(the injected-clock law - the kit never reads a clock itself\)/,
                        );
                });

                test('a clock whose first read is empty is a TypeError', () => {
                        assert.throws(() => createOntologyKit({ clock: () => '' }), /createOntologyKit: options\.clock\(\) must return a non-empty ISO string \(the injected-clock law\)/);
                });

                test('a clock whose first read is not a string is a TypeError', () => {
                        assert.throws(() => createOntologyKit({ clock: () => 123 as unknown as string }), /createOntologyKit: options\.clock\(\) must return a non-empty ISO string/);
                });

                test('the factory consumes exactly ONE clock read (the seam-validation read)', () => {
                        const { clock, reads } = counterClock();
                        createOntologyKit({ clock });
                        assert.equal(reads.length, 1);
                });
        });

        suite('the single-version law (the re-export chain)', () => {
                test('ONTOLOGY_CONTRACTS_VERSION is re-carried by the kit and equals the contract\'s own', () => {
                        assert.equal(ONTOLOGY_CONTRACTS_VERSION, CONTRACT_VERSION);
                        assert.equal(ONTOLOGY_CONTRACTS_VERSION, '1.0.0');
                });

                test('DOMAIN_HARNESS_CONTRACTS_VERSION is re-carried from the REAL DH-01 module', () => {
                        assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
                        assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
                });

                test('ONTOLOGY_KIT_REFUSAL_REASONS pinned: the 16 contract domain reasons plus the 4 kit extras, in order', () => {
                        assert.deepEqual([...ONTOLOGY_KIT_REFUSAL_REASONS], [
                                ...CONTRACT_REJECTION_REASONS,
                                ...ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS,
                        ]);
                        assert.deepEqual([...ONTOLOGY_KIT_EXTRA_REFUSAL_REASONS], ['disposed', 'corrupt-seam', 'malformed-term-set', 'empty-term-set']);
                        assert.equal(isOntologyKitRefusalReason('disposed'), true);
                        assert.equal(isOntologyKitRefusalReason('DISPOSED'), false);
                });

                test('the frozen catalogs and registries are re-exported BY REFERENCE (the identity pins)', () => {
                        assert.equal(INDUSTRY_TERM_CATALOGS, REAL_CATALOGS);
                        assert.equal(INDUSTRY_TERM_RELATIONS, REAL_RELATIONS);
                });
        });

        suite('lookupTerm (the read surface)', () => {
                test('the green lookup: the term plus its relations in BOTH directions', async () => {
                        const kit = makeKit();
                        const lookup = lookupOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(lookup.industry, 'legal');
                        assert.equal(lookup.term.termKey, 'negligence');
                        assert.deepEqual(lookup.outgoingRelations, [{ fromTermKey: 'negligence', relationClass: 'narrower-than', toTermKey: 'tort' }]);
                        assert.deepEqual(lookup.incomingRelations, [{ fromTermKey: 'tort', relationClass: 'broader-than', toTermKey: 'negligence' }]);
                });

                test('the clock reading is carried VERBATIM into the lookup record (exactly one read)', async () => {
                        const { clock, reads } = counterClock();
                        const kit = createOntologyKit({ clock });
                        const lookup = lookupOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(reads.length, 2, 'the factory read + the one lookup read');
                        assert.equal(lookup.at, reads[1]);
                });

                test('a term with no relations resolves green with BOTH arrays empty', async () => {
                        const kit = makeKit();
                        const lookup = lookupOf(await kit.lookupTerm('legal', 'jurisdiction'));
                        assert.deepEqual([...lookup.outgoingRelations], []);
                        assert.deepEqual([...lookup.incomingRelations], []);
                });

                test('an unknown industry is the unknown-industry refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.lookupTerm('fintech', 'negligence'));
                        assert.equal(refusal.reason, 'unknown-industry');
                        assert.equal(refusal.law, 'THE REAL-VOCABULARY LAW');
                        assert.deepEqual(refusal.items, ['fintech']);
                });

                test('a malformed industry fails closed as unknown-industry', async () => {
                        const kit = makeKit();
                        for (const bad of [123, null, undefined, []]) {
                                const refusal = refusalOf(await kit.lookupTerm(bad, 'negligence'));
                                assert.equal(refusal.reason, 'unknown-industry', JSON.stringify(bad));
                        }
                });

                test('an unknown termKey is the unknown-term-ref refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.lookupTerm('legal', 'no-such-term'));
                        assert.equal(refusal.reason, 'unknown-term-ref');
                        assert.equal(refusal.law, 'THE INTEGRITY LAW');
                        assert.deepEqual(refusal.items, ['no-such-term']);
                });

                test('a malformed termKey fails closed as unknown-term-ref', async () => {
                        const kit = makeKit();
                        for (const bad of [123, null, 'Not Kebab', '']) {
                                const refusal = refusalOf(await kit.lookupTerm('legal', bad));
                                assert.equal(refusal.reason, 'unknown-term-ref', JSON.stringify(bad));
                        }
                });

                test('the first catalog term of every one of the sixteen industries looks up green', async () => {
                        const kit = makeKit();
                        for (const industry of REAL_INDUSTRIES) {
                                const outcome = await kit.lookupTerm(industry, INDUSTRY_TERM_CATALOGS[industry][0].termKey);
                                assert.equal(outcome.ok, true, `${industry}: ${JSON.stringify(outcome.ok ? null : outcome.refusal)}`);
                        }
                });

                test('the resolved term is the frozen catalog entry BY REFERENCE (the identity pin)', async () => {
                        const kit = makeKit();
                        const catalog = INDUSTRY_TERM_CATALOGS.legal;
                        const negligence = catalog.find((term) => term.termKey === 'negligence')!;
                        const lookup = lookupOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(lookup.term, negligence);
                });

                test('determinism: two lookups of the same term under the same clock are deep-equal', async () => {
                        const kit = makeKit();
                        const first = lookupOf(await kit.lookupTerm('software', 'defect'));
                        const second = lookupOf(await kit.lookupTerm('software', 'defect'));
                        assert.deepEqual(first, second);
                        assert.equal(JSON.stringify(first), JSON.stringify(second));
                });

                test('a refused lookup consumes NO clock read', async () => {
                        const { clock, reads } = counterClock();
                        const kit = createOntologyKit({ clock });
                        const refused = await kit.lookupTerm('legal', 'no-such-term');
                        assert.equal(refused.ok, false);
                        const unknownIndustry = await kit.lookupTerm('fintech', 'negligence');
                        assert.equal(unknownIndustry.ok, false);
                        assert.equal(reads.length, 1, 'only the factory read - the record never exists');
                });
        });

        suite('validateTermSet (the selected terminology)', () => {
                test('the full catalog selection resolves to the whole catalog in order', async () => {
                        const kit = makeKit();
                        const keys = INDUSTRY_TERM_CATALOGS.legal.map((term) => term.termKey);
                        const terms = termSetOf(await kit.validateTermSet('legal', keys));
                        assert.deepEqual([...terms], [...INDUSTRY_TERM_CATALOGS.legal]);
                });

                test('the CATALOG-ORDER pin: a reversed caller order resolves in catalog order', async () => {
                        const kit = makeKit();
                        const terms = termSetOf(await kit.validateTermSet('legal', ['negligence', 'tort', 'pleading']));
                        assert.deepEqual(terms.map((term) => term.termKey), ['tort', 'negligence', 'pleading']);
                });

                test('a subset selection resolves green', async () => {
                        const kit = makeKit();
                        const terms = termSetOf(await kit.validateTermSet('software', ['regression', 'technical-debt']));
                        assert.deepEqual(terms.map((term) => term.termKey), ['technical-debt', 'regression']);
                });

                test('an unknown industry is the unknown-industry refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.validateTermSet('fintech', ['negligence']));
                        assert.equal(refusal.reason, 'unknown-industry');
                });

                test('a non-array carrier is the malformed-term-set refusal', async () => {
                        const kit = makeKit();
                        for (const bad of ['negligence', 123, null]) {
                                const refusal = refusalOf(await kit.validateTermSet('legal', bad));
                                assert.equal(refusal.reason, 'malformed-term-set', JSON.stringify(bad));
                                assert.deepEqual(refusal.items, ['termKeys']);
                        }
                });

                test('a non-string member is the malformed-term-set refusal (the termKeys[i] item)', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.validateTermSet('legal', ['negligence', 123]));
                        assert.equal(refusal.reason, 'malformed-term-set');
                        assert.deepEqual(refusal.items, ['termKeys[1]']);
                });

                test('an empty selection is the empty-term-set refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.validateTermSet('legal', []));
                        assert.equal(refusal.reason, 'empty-term-set');
                        assert.deepEqual(refusal.items, ['termKeys']);
                });

                test('unresolved keys are the unknown-term-ref refusal listing EVERY offender', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.validateTermSet('legal', ['negligence', 'no-such-a', 'tort', 'no-such-b']));
                        assert.equal(refusal.reason, 'unknown-term-ref');
                        assert.deepEqual(refusal.items, ['no-such-a', 'no-such-b']);
                });

                test('duplicate keys are the duplicate-term-keys refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.validateTermSet('legal', ['negligence', 'negligence', 'tort', 'tort']));
                        assert.equal(refusal.reason, 'duplicate-term-keys');
                        assert.deepEqual(refusal.items, ['negligence', 'tort']);
                });
        });

        suite('inspectCatalog (the frozen surfaces BY REFERENCE)', () => {
                test('the green inspection carries the frozen catalog + registry BY REFERENCE', async () => {
                        const kit = makeKit();
                        const catalog = catalogOf(await kit.inspectCatalog('legal'));
                        assert.equal(catalog.terms, INDUSTRY_TERM_CATALOGS.legal);
                        assert.equal(catalog.relations, INDUSTRY_TERM_RELATIONS.legal);
                });

                test('the contents equal the contract exports (the deep pins)', async () => {
                        const kit = makeKit();
                        const catalog = catalogOf(await kit.inspectCatalog('software'));
                        assert.equal(catalog.terms.length, INDUSTRY_TERM_CATALOGS.software.length);
                        assert.equal(catalog.relations.length, INDUSTRY_TERM_RELATIONS.software.length);
                        assert.deepEqual(catalog.terms[0], { termKey: 'source-code', definition: INDUSTRY_TERM_CATALOGS.software[0].definition });
                });

                test('an unknown industry is the unknown-industry refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.inspectCatalog('fintech'));
                        assert.equal(refusal.reason, 'unknown-industry');
                });

                test('every one of the sixteen industries inspects green with the frozen counts', async () => {
                        const kit = makeKit();
                        for (const industry of REAL_INDUSTRIES) {
                                const catalog = catalogOf(await kit.inspectCatalog(industry));
                                assert.equal(catalog.terms.length, INDUSTRY_TERM_CATALOGS[industry].length, industry);
                                assert.equal(catalog.relations.length, INDUSTRY_TERM_RELATIONS[industry].length, industry);
                        }
                });
        });

        suite('relationIntegrityReport (THE INTEGRITY LAW\'s typed report)', () => {
                test('a CLEAN report for every one of the sixteen industries (the battery\'s crown pin)', async () => {
                        const kit = makeKit();
                        for (const industry of REAL_INDUSTRIES) {
                                const report = reportOf(await kit.relationIntegrityReport(industry));
                                assert.equal(report.clean, true, `${industry}: ${JSON.stringify(report.findings)}`);
                                assert.deepEqual([...report.findings], [], industry);
                                assert.equal(report.termCount, INDUSTRY_TERM_CATALOGS[industry].length, industry);
                                assert.equal(report.relationCount, INDUSTRY_TERM_RELATIONS[industry].length, industry);
                        }
                });

                test('the report is a typed VALUE (never a throw): the shape pins for one industry', async () => {
                        const kit = makeKit();
                        const report = reportOf(await kit.relationIntegrityReport('legal'));
                        assert.equal(report.industry, 'legal');
                        assert.equal(report.termCount, 10);
                        assert.equal(report.relationCount, 6);
                        assert.equal(report.clean, true);
                        assert.deepEqual([...report.findings], []);
                });

                test('an unknown industry is the unknown-industry refusal', async () => {
                        const kit = makeKit();
                        const refusal = refusalOf(await kit.relationIntegrityReport('fintech'));
                        assert.equal(refusal.reason, 'unknown-industry');
                });

                test('the report reads the FROZEN registry (the counts match the contract exports)', async () => {
                        const kit = makeKit();
                        for (const industry of ['software', 'retail', 'hospitality'] as const) {
                                const report = reportOf(await kit.relationIntegrityReport(industry));
                                assert.equal(report.relationCount, INDUSTRY_TERM_RELATIONS[industry].length, industry);
                        }
                });
        });

        suite('the dispose law', () => {
                test('lookupTerm after dispose refuses disposed', async () => {
                        const kit = makeKit();
                        kit.dispose();
                        const refusal = refusalOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(refusal.reason, 'disposed');
                        assert.equal(refusal.law, 'THE DISPOSE LAW');
                });

                test('validateTermSet after dispose refuses disposed', async () => {
                        const kit = makeKit();
                        kit.dispose();
                        const refusal = refusalOf(await kit.validateTermSet('legal', ['negligence']));
                        assert.equal(refusal.reason, 'disposed');
                });

                test('inspectCatalog after dispose refuses disposed', async () => {
                        const kit = makeKit();
                        kit.dispose();
                        const refusal = refusalOf(await kit.inspectCatalog('legal'));
                        assert.equal(refusal.reason, 'disposed');
                });

                test('relationIntegrityReport after dispose refuses disposed', async () => {
                        const kit = makeKit();
                        kit.dispose();
                        const refusal = refusalOf(await kit.relationIntegrityReport('legal'));
                        assert.equal(refusal.reason, 'disposed');
                });

                test('dispose is idempotent (a double dispose; the ops still refuse)', async () => {
                        const kit = makeKit();
                        kit.dispose();
                        kit.dispose();
                        const refusal = refusalOf(await kit.inspectCatalog('legal'));
                        assert.equal(refusal.reason, 'disposed');
                        assert.match(refusal.message, /every operation after dispose refuses/);
                });
        });

        suite('the corrupt-seam law (THE DETERMINISM LAW\'s live station)', () => {
                test('a clock returning an empty string mid-lookup is the corrupt-seam refusal', async () => {
                        const { clock } = scriptableClock([FIXTURE_CLOCK_READ, '']);
                        const kit = createOntologyKit({ clock: clock as () => string });
                        const refusal = refusalOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(refusal.reason, 'corrupt-seam');
                        assert.equal(refusal.law, 'THE DETERMINISM LAW');
                });

                test('a clock returning a non-string mid-lookup is the corrupt-seam refusal', async () => {
                        const { clock } = scriptableClock([FIXTURE_CLOCK_READ, 123]);
                        const kit = createOntologyKit({ clock: clock as () => string });
                        const refusal = refusalOf(await kit.lookupTerm('legal', 'negligence'));
                        assert.equal(refusal.reason, 'corrupt-seam');
                });
        });

        suite('in-suite determinism greps (the determinism law as a test)', () => {
                test('every banned-global hit in ontologyKit.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/ontologyKit.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });

                test('this test source itself is grep-clean (the piecewise assembly)', () => {
                        const hits = determinismGrepHits('./ontologyKit.test.ts');
                        assert.deepEqual(hits, []);
                });
        });
});
