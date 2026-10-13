/*
 * DH-003 role-composition kit test suite (mocha tdd style, matching
 * build/flauz/harness/onboarding/test/common/onboardingKit.test.ts -
 * the landed DH-002 family precedent - and the DH-001 kit battery
 * before it).
 *
 * Fixture policy: every session id, industry, role, catalog entry and
 * timestamp below is SYNTHETIC (fixed fixture ISO strings, the
 * 'flauz:rol:<16-hex>' / 'flauz:onb:<16-hex>' / 'flauz:hrn:<16-hex>'
 * fixture ids, 'fixture.'-prefixed roleKeys, 'cap/wf/pol/ev-fixture-'
 * catalog ids) and is NOT an authority value, NOT credential
 * material, NOT execution material. The kit tests run over an
 * in-memory fs port (the PIN-2 sibling precedent's persistence seam,
 * SHARED with the REAL DH-02 onboarding kit in the cross-kit pins)
 * and deterministic test doubles for the clock and the rng (fixed or
 * counter-based - NEVER the random global, never a real clock). The
 * roles factory consumes exactly ONE clock read and ONE rng read
 * (there is no inner kit - unlike the DH-02 kit's doubled reads; the
 * counter-rng pins below account for them). The in-suite determinism
 * greps pin the shipped modules to law-comment lines only (the
 * banned-global patterns are assembled piecewise so this test source
 * itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
        HARNESS_ENVELOPE_RELATIVE_PATH,
        HARNESS_LEDGER_RELATIVE_PATH,
} from '../../../contract/common/domainHarnessKit.js';
import type { HarnessFsPort } from '../../../contract/common/domainHarnessKit.js';
import { HARNESS_ID_PREFIX } from '../../../contract/common/domainHarnessContract.js';
import {
        ONBOARDING_LEDGER_RELATIVE_PATH,
        createOnboardingKit,
} from '../../../onboarding/common/onboardingKit.js';
import type { HarnessCatalogSnapshot, OnboardingKit, OnboardingKitOptions, OnboardingKitRefusal } from '../../../onboarding/common/onboardingKit.js';
import { validateOnboardingReviewComposition } from '../../../onboarding/common/onboardingContract.js';
import {
        DOMAIN_HARNESS_CONTRACTS_VERSION,
        ONBOARDING_CONTRACTS_VERSION,
        ROLES_CONTRACTS_VERSION,
        ROLES_ENVELOPE_RELATIVE_PATH,
        ROLES_ENVELOPE_SCHEMA_KEYS,
        ROLES_KIT_EXTRA_REFUSAL_REASONS,
        ROLES_KIT_REFUSAL_REASONS,
        ROLES_LEDGER_LINE_SCHEMA_KEYS,
        ROLES_LEDGER_RELATIVE_PATH,
        createRolesKit,
        isRolesKitRefusalReason,
        loadRolesKit,
} from '../../common/rolesKit.js';
import type { RolesKit, RolesKitOptions, RolesKitRefusal } from '../../common/rolesKit.js';
import { ROLE_COMPOSITION_ID_PREFIX, ROLES_REJECTION_REASONS } from '../../common/rolesContract.js';
import { DOMAIN_HARNESS_CONTRACTS_VERSION as REAL_HARNESS_VERSION } from '../../../contract/common/domainHarnessContract.js';
import { ONBOARDING_CONTRACTS_VERSION as REAL_ONBOARDING_VERSION } from '../../../onboarding/common/onboardingContract.js';

const FIXTURE_ROOT = '/fixture-root';
const FIXTURE_HEX = '0123456789abcdef';
const ROL_LEDGER_PATH = `${FIXTURE_ROOT}/${ROLES_LEDGER_RELATIVE_PATH}`;
const ROL_ENVELOPE_PATH = `${FIXTURE_ROOT}/${ROLES_ENVELOPE_RELATIVE_PATH}`;
const ONB_LEDGER_PATH = `${FIXTURE_ROOT}/${ONBOARDING_LEDGER_RELATIVE_PATH}`;
const HRN_LEDGER_PATH = `${FIXTURE_ROOT}/${HARNESS_LEDGER_RELATIVE_PATH}`;
const HRN_ENVELOPE_PATH = `${FIXTURE_ROOT}/${HARNESS_ENVELOPE_RELATIVE_PATH}`;

function fixedClock(): () => string {
        return () => '2026-10-13T00:00:00.000Z';
}

/** The advancing fixture clock (deterministic ISO strings, never a real clock). */
function advancingClock(): { clock: () => string; reads: string[] } {
        const reads: string[] = [];
        const clock = (): string => {
                const read = `2026-10-13T00:00:${String(reads.length + 1).padStart(2, '0')}.000Z`;
                reads.push(read);
                return read;
        };
        return { clock, reads };
}

function fixedRng(hex: string): () => string {
        return () => hex;
}

function counterRng(): () => string {
        let n = 0;
        return () => {
                n += 1;
                return n.toString(16).padStart(16, '0');
        };
}

function fixtureCatalog(): HarnessCatalogSnapshot {
        return {
                capabilities: [{ entryId: 'cap-fixture-001', state: 'approved' }],
                workflowIds: ['wf-fixture-001'],
                policyIds: ['pol-fixture-001'],
                evidenceIds: ['ev-fixture-001'],
        };
}

function fixtureRole(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return { roleKey: 'fixture.counsel', summary: 'the fixture counsel role', ...overrides };
}

function fixtureParalegal(): Record<string, unknown> {
        return { roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' };
}

/** The in-memory fs port (the PIN-2 sibling precedent's persistence seam; ENOENT convention; shared with the real DH-02 kit in the cross-kit pins). */
function makeMemoryFs(existing?: Map<string, string>): { files: Map<string, string>; port: HarnessFsPort } {
        const files = existing ?? new Map<string, string>();
        const enoent = (path: string): Error => {
                const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
                (err as NodeJS.ErrnoException).code = 'ENOENT';
                return err;
        };
        const port: HarnessFsPort = {
                async readFile(path: string): Promise<string> {
                        const text = files.get(path);
                        if (text === undefined) {
                                throw enoent(path);
                        }
                        return text;
                },
                async writeFile(path: string, text: string): Promise<void> {
                        files.set(path, text);
                },
                async appendFile(path: string, text: string): Promise<void> {
                        files.set(path, (files.get(path) ?? '') + text);
                },
                async mkdir(): Promise<void> {},
        };
        return { files, port };
}

/** An fs port whose appendFile refuses (the ledger-append failure seam). */
function appendRefusingFs(files: Map<string, string>): HarnessFsPort {
        return {
                async readFile(path: string): Promise<string> {
                        const text = files.get(path);
                        if (text === undefined) {
                                const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
                                (err as NodeJS.ErrnoException).code = 'ENOENT';
                                throw err;
                        }
                        return text;
                },
                async writeFile(path: string, text: string): Promise<void> {
                        files.set(path, text);
                },
                async appendFile(): Promise<void> {
                        throw new Error('fixture port refusal (appendFile)');
                },
                async mkdir(): Promise<void> {},
        };
}

/** An fs port whose writeFile refuses (the envelope-rewrite failure seam). */
function writeRefusingFs(files: Map<string, string>): HarnessFsPort {
        return {
                async readFile(path: string): Promise<string> {
                        const text = files.get(path);
                        if (text === undefined) {
                                const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
                                (err as NodeJS.ErrnoException).code = 'ENOENT';
                                throw err;
                        }
                        return text;
                },
                async writeFile(): Promise<void> {
                        throw new Error('fixture port refusal (writeFile)');
                },
                async appendFile(path: string, text: string): Promise<void> {
                        files.set(path, (files.get(path) ?? '') + text);
                },
                async mkdir(): Promise<void> {},
        };
}

function kitOptions(overrides: Record<string, unknown> = {}): unknown {
        return {
                clock: fixedClock(),
                rng: fixedRng(FIXTURE_HEX),
                ...overrides,
        };
}

function mustOkSession<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
        if (outcome.ok) {
                return outcome as Extract<T, { ok: true }>;
        }
        assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuse(outcome: { ok: boolean }): RolesKitRefusal {
        if (!outcome.ok) {
                return (outcome as unknown as { refusal: RolesKitRefusal }).refusal;
        }
        assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

function mustOkEmit<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
        if (outcome.ok) {
                return outcome as Extract<T, { ok: true }>;
        }
        assert.fail(`expected an ok emit outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustOkList<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
        if (outcome.ok) {
                return outcome as Extract<T, { ok: true }>;
        }
        assert.fail(`expected an ok list outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustOkOb<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
        if (outcome.ok) {
                return outcome as Extract<T, { ok: true }>;
        }
        assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuseOb(outcome: { ok: boolean }): OnboardingKitRefusal {
        if (!outcome.ok) {
                return (outcome as unknown as { refusal: OnboardingKitRefusal }).refusal;
        }
        assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

/** Walks a roles session to the composed stage (the standard happy-path prefix: two fixture roles, finalized). */
async function composedFixtureSession(kit: RolesKit): Promise<string> {
        const begin = mustOkSession(await kit.beginSession('legal'));
        const sessionId = begin.session.sessionId;
        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
        mustOkSession(await kit.addRole(sessionId, fixtureParalegal()));
        mustOkSession(await kit.finalizeComposition(sessionId));
        return sessionId;
}

/** Walks an onboarding session to the review stage through the REAL DH-02 kit (the cross-kit prefix). */
async function walkedToObReview(obKit: OnboardingKit): Promise<string> {
        const begin = mustOkOb(await obKit.beginSession());
        const sessionId = begin.session.sessionId;
        mustOkOb(await obKit.selectIndustry(sessionId, 'legal'));
        mustOkOb(await obKit.composeCompany(sessionId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
        mustOkOb(await obKit.selectWorkTypes(sessionId, ['analysis', 'drafting', 'review']));
        return sessionId;
}

function ledgerLineCount(files: Map<string, string>): number {
        const text = files.get(ROL_LEDGER_PATH);
        return text === undefined ? 0 : text.split('\n').filter((line) => line.length > 0).length;
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

suite('DH-003 role-composition kit', () => {

        suite('the single-version law (the kit re-carries)', () => {
                test('the kit re-exports equal the contract declarations and the REAL landed modules', () => {
                        assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
                        assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, REAL_HARNESS_VERSION);
                        assert.equal(ONBOARDING_CONTRACTS_VERSION, REAL_ONBOARDING_VERSION);
                });

                test('ROLES_KIT_REFUSAL_REASONS is the contract\'s 19 plus the 6 kit extras (pinned)', () => {
                        assert.deepEqual([...ROLES_KIT_REFUSAL_REASONS].slice(0, 19), [...ROLES_REJECTION_REASONS]);
                        assert.deepEqual([...ROLES_KIT_EXTRA_REFUSAL_REASONS], ['DISPOSED', 'CORRUPT_SEAM', 'E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'ROLES_IO', 'UNKNOWN_FILTER']);
                        assert.equal(ROLES_KIT_REFUSAL_REASONS.length, 25);
                });

                test('isRolesKitRefusalReason membership', () => {
                        assert.equal(isRolesKitRefusalReason('empty-roles'), true);
                        assert.equal(isRolesKitRefusalReason('unknown-role'), true);
                        assert.equal(isRolesKitRefusalReason('E_LEDGER_TORN'), true);
                        assert.equal(isRolesKitRefusalReason('version-mismatch'), true);
                        assert.equal(isRolesKitRefusalReason('NOPE'), false);
                });
        });

        suite('createRolesKit factory misuse (TypeError, never a typed refusal)', () => {
                test('refuses a non-object options', () => {
                        assert.throws(() => createRolesKit(null as unknown as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit('string' as unknown as RolesKitOptions), TypeError);
                });

                test('refuses a missing or non-function clock', () => {
                        assert.throws(() => createRolesKit(kitOptions({ clock: undefined }) as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit(kitOptions({ clock: 'not-a-function' }) as RolesKitOptions), TypeError);
                });

                test('refuses a clock that returns an empty value', () => {
                        assert.throws(() => createRolesKit(kitOptions({ clock: () => '' }) as RolesKitOptions), TypeError);
                });

                test('refuses a missing or non-function rng', () => {
                        assert.throws(() => createRolesKit(kitOptions({ rng: undefined }) as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit(kitOptions({ rng: 123 }) as RolesKitOptions), TypeError);
                });

                test('refuses an rng that returns a non-16-hex value', () => {
                        assert.throws(() => createRolesKit(kitOptions({ rng: () => 'short' }) as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit(kitOptions({ rng: () => '0123456789ABCDEF' }) as RolesKitOptions), TypeError);
                });

                test('refuses fsPort without root and root without fsPort (the DH-01 pair law)', () => {
                        const { port } = makeMemoryFs();
                        assert.throws(() => createRolesKit(kitOptions({ fsPort: port }) as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit(kitOptions({ root: FIXTURE_ROOT }) as RolesKitOptions), TypeError);
                });

                test('refuses an fs port missing a method', () => {
                        const partial = { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} };
                        assert.throws(() => createRolesKit(kitOptions({ fsPort: partial, root: FIXTURE_ROOT }) as RolesKitOptions), TypeError);
                });

                test('refuses an empty or non-string root', () => {
                        const { port } = makeMemoryFs();
                        assert.throws(() => createRolesKit(kitOptions({ fsPort: port, root: '' }) as RolesKitOptions), TypeError);
                        assert.throws(() => createRolesKit(kitOptions({ fsPort: port, root: 123 }) as RolesKitOptions), TypeError);
                });

                test('loadRolesKit requires both fsPort and root (TypeError)', async () => {
                        await assert.rejects(() => loadRolesKit(kitOptions() as RolesKitOptions), TypeError);
                        const { port } = makeMemoryFs();
                        await assert.rejects(() => loadRolesKit(kitOptions({ fsPort: port }) as RolesKitOptions), TypeError);
                        await assert.rejects(() => loadRolesKit(kitOptions({ root: FIXTURE_ROOT }) as RolesKitOptions), TypeError);
                });
        });

        suite('the factory seam reads (the exact count: ONE clock read, ONE rng read)', () => {
                test('the factory consumes exactly one rng read (the first beginSession mints the SECOND counter value)', async () => {
                        const kit = createRolesKit(kitOptions({ rng: counterRng() }) as RolesKitOptions);
                        const first = mustOkSession(await kit.beginSession('legal'));
                        assert.equal(first.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}0000000000000002`);
                        const second = mustOkSession(await kit.beginSession('finance'));
                        assert.equal(second.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}0000000000000003`);
                });

                test('the factory consumes exactly one clock read (the first op lands the SECOND reading)', async () => {
                        const { clock, reads } = advancingClock();
                        const kit = createRolesKit(kitOptions({ clock }) as RolesKitOptions);
                        assert.equal(reads.length, 1);
                        const begin = mustOkSession(await kit.beginSession('legal'));
                        assert.equal(reads.length, 2);
                        assert.equal(begin.session.history[0].at, reads[1]);
                });
        });

        suite('beginSession (the session mint)', () => {
                test('mints the honest initial record (stage composing, ZERO roles, the begin note)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const begin = mustOkSession(await kit.beginSession('legal'));
                        assert.equal(begin.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`);
                        assert.equal(begin.session.industry, 'legal');
                        assert.equal(begin.session.stage, 'composing');
                        assert.deepEqual(begin.session.roles, []);
                        assert.equal(begin.session.history.length, 1);
                        assert.equal(begin.session.history[0].op, 'begin-session');
                        assert.equal(begin.session.history[0].fromStage, null);
                        assert.equal(begin.session.history[0].toStage, 'composing');
                        assert.equal(begin.session.history[0].law, 'THE FORWARD-ONLY LAW');
                });

                test('industry membership refusals: every non-member and malformed carrier (the REAL imported list)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        for (const bad of ['fintech', 'space-mining', '', 'LEGAL', 123, null, undefined, {}]) {
                                const refusal = mustRefuse(await kit.beginSession(bad));
                                assert.equal(refusal.reason, 'unknown-industry');
                                assert.equal(refusal.law, 'THE FROZEN-VOCABULARY LAW');
                        }
                        const list = mustOkList(await kit.listSessions());
                        assert.deepEqual(list.sessions, []);
                });

                test('a duplicate minted session id is the typed CORRUPT_SEAM refusal', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const refusal = mustRefuse(await kit.beginSession('legal'));
                        assert.equal(refusal.reason, 'CORRUPT_SEAM');
                        assert.equal(refusal.law, 'THE DETERMINISM LAW');
                        assert.match(refusal.detail, /duplicate session id/);
                });

                test('a corrupt rng mid-op is the typed CORRUPT_SEAM refusal', async () => {
                        let calls = 0;
                        const rng = (): string => {
                                calls += 1;
                                // Read #1 feeds the factory validation; read #2 mints the first session; read #3 is corrupt.
                                return calls <= 2 ? FIXTURE_HEX : 'not-hex-anymore';
                        };
                        const kit = createRolesKit(kitOptions({ rng }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const refusal = mustRefuse(await kit.beginSession('legal'));
                        assert.equal(refusal.reason, 'CORRUPT_SEAM');
                        assert.match(refusal.detail, /non-16-hex/);
                });

                test('a corrupt clock mid-op is the typed CORRUPT_SEAM refusal', async () => {
                        let reads = 0;
                        const clock = (): string => {
                                reads += 1;
                                return reads <= 1 ? '2026-10-13T00:00:00.000Z' : '';
                        };
                        const kit = createRolesKit(kitOptions({ clock }) as RolesKitOptions);
                        const refusal = mustRefuse(await kit.beginSession('legal'));
                        assert.equal(refusal.reason, 'CORRUPT_SEAM');
                        assert.match(refusal.detail, /empty value mid-op/);
                });

                test('a disposed fresh kit refuses the first begin', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.beginSession('legal')).reason, 'DISPOSED');
                });
        });

        suite('addRole (the composition grows)', () => {
                test('green: the role lands with provenance (op add-role, THE NO-FORK LAW, the composing self edge)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const begin = mustOkSession(await kit.beginSession('legal'));
                        const sessionId = begin.session.sessionId;
                        const outcome = mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        assert.deepEqual(outcome.session.roles, [fixtureRole()]);
                        assert.equal(outcome.session.stage, 'composing');
                        assert.equal(outcome.session.industry, 'legal');
                        assert.equal(outcome.session.history.length, 2);
                        assert.equal(outcome.session.history[1].op, 'add-role');
                        assert.equal(outcome.session.history[1].law, 'THE NO-FORK LAW');
                        assert.equal(outcome.session.history[1].fromStage, 'composing');
                        assert.equal(outcome.session.history[1].toStage, 'composing');
                });

                test('the role-entry law refusals are typed and carry the COMPLETE rejection table', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        const nonRecord = mustRefuse(await kit.addRole(sessionId, 'not-a-role'));
                        assert.equal(nonRecord.reason, 'malformed-role');
                        assert.equal((nonRecord.rejections as unknown[]).length, 1);
                        const noFork = mustRefuse(await kit.addRole(sessionId, fixtureRole({ tools: 'fixture-tools' })));
                        assert.equal(noFork.reason, 'no-fork');
                        assert.equal(noFork.law, 'THE NO-FORK LAW');
                        assert.deepEqual(noFork.items, ['tools']);
                        const badKey = mustRefuse(await kit.addRole(sessionId, fixtureRole({ roleKey: ' padded ' })));
                        assert.equal(badKey.reason, 'invalid-role-key');
                        assert.deepEqual(badKey.items, ['leading/trailing whitespace']);
                        const badSummary = mustRefuse(await kit.addRole(sessionId, fixtureRole({ summary: 'f'.repeat(201) })));
                        assert.equal(badSummary.reason, 'invalid-summary');
                        const multi = mustRefuse(await kit.addRole(sessionId, { roleKey: ' padded ', summary: '', tools: 'fixture-tools' }));
                        assert.deepEqual((multi.rejections as readonly { reason: string }[]).map((rejection) => rejection.reason), ['no-fork', 'invalid-role-key', 'invalid-summary']);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(inspect.session.roles.length, 0);
                        assert.equal(inspect.session.history.length, 1);
                });

                test('a duplicate roleKey refuses with the session unchanged', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const refusal = mustRefuse(await kit.addRole(sessionId, fixtureRole({ summary: 'a different summary' })));
                        assert.equal(refusal.reason, 'duplicate-role-key');
                        assert.deepEqual(refusal.items, ['fixture.counsel']);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.deepEqual(inspect.session.roles, [fixtureRole()]);
                });

                test('the MAX_ROLES bound: 32 adds green, the 33rd refuses with the session unchanged', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        for (let i = 1; i <= 32; i += 1) {
                                mustOkSession(await kit.addRole(sessionId, { roleKey: `fixture.role-${String(i).padStart(2, '0')}`, summary: `the fixture role ${i} summary` }));
                        }
                        const refused = mustRefuse(await kit.addRole(sessionId, { roleKey: 'fixture.role-33', summary: 'the thirty-third summary' }));
                        assert.equal(refused.reason, 'max-roles-exceeded');
                        assert.equal(refused.law, 'THE FAIL-CLOSED LAW');
                        const after = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(after.session.roles.length, 32);
                });

                test('a composed session refuses the mutating op (stale-stage, TERMINAL)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const refusal = mustRefuse(await kit.addRole(sessionId, fixtureRole({ roleKey: 'fixture.newcomer' })));
                        assert.equal(refusal.reason, 'stale-stage');
                        assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
                        assert.match(refusal.detail, /TERMINAL/);
                });

                test('an unknown or malformed session id is the unknown-session refusal', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const missing = mustRefuse(await kit.addRole(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`, fixtureRole()));
                        assert.equal(missing.reason, 'unknown-session');
                        assert.equal(missing.law, 'THE FAIL-CLOSED LAW');
                        const malformed = mustRefuse(await kit.addRole(123, fixtureRole()));
                        assert.equal(malformed.reason, 'unknown-session');
                        assert.match(malformed.detail, /malformed id fails closed/);
                });

                test('a disposed kit refuses', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.addRole(sessionId, fixtureRole())).reason, 'DISPOSED');
                });
        });

        suite('replaceRoleSummary (the remove+re-add law)', () => {
                test('green: the summary is replaced, the roleKey is immutable', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        mustOkSession(await kit.addRole(sessionId, fixtureParalegal()));
                        const outcome = mustOkSession(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'the revised fixture counsel summary'));
                        assert.deepEqual(outcome.session.roles, [
                                { roleKey: 'fixture.counsel', summary: 'the revised fixture counsel summary' },
                                fixtureParalegal(),
                        ]);
                        // station-fix (R67): begin + add + add + replace = 4 applied ops = 4 history notes
                        // (the per-op append model, pinned by the addRole green + inspect-isolated tests)
                        assert.equal(outcome.session.history.length, 4);
                        assert.equal(outcome.session.history[3].op, 'replace-role-summary');
                        assert.equal(outcome.session.history[3].law, 'THE REMOVE+RE-ADD LAW');
                });

                test('an unknown roleKey is the unknown-role refusal (a malformed key fails closed)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const missing = mustRefuse(await kit.replaceRoleSummary(sessionId, 'fixture.missing', 'a summary'));
                        assert.equal(missing.reason, 'unknown-role');
                        assert.equal(missing.law, 'THE FAIL-CLOSED LAW');
                        const malformed = mustRefuse(await kit.replaceRoleSummary(sessionId, 123, 'a summary'));
                        assert.equal(malformed.reason, 'unknown-role');
                        assert.match(malformed.detail, /malformed key fails closed/);
                });

                test('the summary law refusals leave the session unchanged (the COMPLETE table carried)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const refusal = mustRefuse(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', ''));
                        assert.equal(refusal.reason, 'invalid-summary');
                        assert.deepEqual((refusal.rejections as readonly { reason: string }[]).map((rejection) => rejection.reason), ['invalid-summary']);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.deepEqual(inspect.session.roles, [fixtureRole()]);
                });

                test('a composed session refuses (stale-stage)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        assert.equal(mustRefuse(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'a summary')).reason, 'stale-stage');
                });

                test('THE REMOVE+RE-ADD LAW: replace never re-keys (a changed key is a NEW role - remove, then re-add)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const replaced = mustOkSession(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'the revised summary'));
                        assert.equal(replaced.session.roles[0].roleKey, 'fixture.counsel');
                        assert.equal(replaced.session.roles[0].summary, 'the revised summary');
                });

                test('unknown session / disposed refuse typed', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        assert.equal(mustRefuse(await kit.replaceRoleSummary(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`, 'fixture.counsel', 'x')).reason, 'unknown-session');
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'x')).reason, 'DISPOSED');
                });
        });

        suite('removeRole (the composition shrinks)', () => {
                test('green: the role is removed with provenance (THE REMOVE+RE-ADD LAW)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        mustOkSession(await kit.addRole(sessionId, fixtureParalegal()));
                        const outcome = mustOkSession(await kit.removeRole(sessionId, 'fixture.counsel'));
                        assert.deepEqual(outcome.session.roles, [fixtureParalegal()]);
                        // station-fix (R67): begin + add + add + remove = 4 applied ops = 4 history notes
                        assert.equal(outcome.session.history.length, 4);
                        assert.equal(outcome.session.history[3].op, 'remove-role');
                        assert.equal(outcome.session.history[3].law, 'THE REMOVE+RE-ADD LAW');
                });

                test('an unknown roleKey refuses with the session unchanged', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const refusal = mustRefuse(await kit.removeRole(sessionId, 'fixture.missing'));
                        assert.equal(refusal.reason, 'unknown-role');
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.deepEqual(inspect.session.roles, [fixtureRole()]);
                });

                test('removing the LAST role is LEGAL while composing (the floor fires at finalize)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const removed = mustOkSession(await kit.removeRole(sessionId, 'fixture.counsel'));
                        assert.deepEqual(removed.session.roles, []);
                        assert.equal(removed.session.stage, 'composing');
                        const finalize = mustRefuse(await kit.finalizeComposition(sessionId));
                        assert.equal(finalize.reason, 'empty-roles');
                        assert.equal(finalize.law, 'THE FAIL-CLOSED LAW');
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(inspect.session.stage, 'composing');
                });

                test('re-adding after a remove is green (the remove+re-add law)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        mustOkSession(await kit.removeRole(sessionId, 'fixture.counsel'));
                        const readded = mustOkSession(await kit.addRole(sessionId, fixtureRole({ summary: 'the re-added counsel role' })));
                        assert.deepEqual(readded.session.roles, [{ roleKey: 'fixture.counsel', summary: 'the re-added counsel role' }]);
                });

                test('a composed session / an unknown session / a disposed kit refuse typed', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        assert.equal(mustRefuse(await kit.removeRole(sessionId, 'fixture.counsel')).reason, 'stale-stage');
                        assert.equal(mustRefuse(await kit.removeRole(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`, 'fixture.counsel')).reason, 'unknown-session');
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.removeRole(sessionId, 'fixture.counsel')).reason, 'DISPOSED');
                });
        });

        suite('finalizeComposition (the freeze)', () => {
                test('green: composing->composed with provenance (THE FORWARD-ONLY LAW)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const outcome = mustOkSession(await kit.finalizeComposition(sessionId));
                        assert.equal(outcome.session.stage, 'composed');
                        assert.deepEqual(outcome.session.roles, [fixtureRole()]);
                        // station-fix (R67): begin + add + finalize = 3 applied ops = 3 history notes
                        assert.equal(outcome.session.history.length, 3);
                        assert.equal(outcome.session.history[2].op, 'finalize-composition');
                        assert.equal(outcome.session.history[2].law, 'THE FORWARD-ONLY LAW');
                        assert.equal(outcome.session.history[2].fromStage, 'composing');
                        assert.equal(outcome.session.history[2].toStage, 'composed');
                });

                test('the empty-roles floor refuses with the session unchanged', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        const refusal = mustRefuse(await kit.finalizeComposition(sessionId));
                        assert.equal(refusal.reason, 'empty-roles');
                        assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                        assert.match(refusal.detail, /DH-01 FLOOR/);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(inspect.session.stage, 'composing');
                });

                test('composed is TERMINAL: re-finalize and every mutating op refuse stale-stage', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        for (const outcome of [
                                await kit.finalizeComposition(sessionId),
                                await kit.addRole(sessionId, fixtureRole({ roleKey: 'fixture.newcomer' })),
                                await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'a summary'),
                                await kit.removeRole(sessionId, 'fixture.counsel'),
                        ]) {
                                const refusal = mustRefuse(outcome);
                                assert.equal(refusal.reason, 'stale-stage');
                                assert.match(refusal.detail, /TERMINAL/);
                        }
                });

                test('the frozen composition is inspectable verbatim (the serialize byte pin)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(inspect.session.stage, 'composed');
                        assert.equal(JSON.stringify(inspect.session.roles), JSON.stringify([fixtureRole(), fixtureParalegal()]));
                });

                test('an unknown session / a disposed kit refuse typed', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        assert.equal(mustRefuse(await kit.finalizeComposition(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`)).reason, 'unknown-session');
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.finalizeComposition(sessionId)).reason, 'DISPOSED');
                });
        });

        suite('emitReviewComposition (the boundary emit)', () => {
                test('a premature call (the session still composing) is the premature-op refusal', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const refusal = mustRefuse(await kit.emitReviewComposition(sessionId));
                        assert.equal(refusal.reason, 'premature-op');
                        assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
                        assert.match(refusal.detail, /finalizeComposition/);
                });

                test('green on a composed session: the composed roles are carried VERBATIM (byte-identical)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        const emit = mustOkEmit(await kit.emitReviewComposition(sessionId));
                        assert.equal(JSON.stringify(emit.composition.roles), JSON.stringify(inspect.session.roles));
                        assert.deepEqual(emit.composition.roles, inspect.session.roles);
                        assert.deepEqual(emit.composition.roles, [fixtureRole(), fixtureParalegal()]);
                });

                test('the four ref families default EMPTY (THE HONEST-GAP LAW)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const emit = mustOkEmit(await kit.emitReviewComposition(sessionId));
                        assert.deepEqual(emit.composition.capabilityRefs, []);
                        assert.deepEqual(emit.composition.workflowRefs, []);
                        assert.deepEqual(emit.composition.policyRefs, []);
                        assert.deepEqual(emit.composition.evidenceRefs, []);
                        assert.deepEqual(Object.keys(emit.composition), ['roles', 'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']);
                });

                test('caller-supplied refs are carried verbatim (all four families)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const emit = mustOkEmit(await kit.emitReviewComposition(sessionId, {
                                capabilityRefs: ['cap-fixture-001'],
                                workflowRefs: ['wf-fixture-001'],
                                policyRefs: ['pol-fixture-001'],
                                evidenceRefs: ['ev-fixture-001', 'ev-fixture-002'],
                        }));
                        assert.deepEqual(emit.composition.capabilityRefs, ['cap-fixture-001']);
                        assert.deepEqual(emit.composition.workflowRefs, ['wf-fixture-001']);
                        assert.deepEqual(emit.composition.policyRefs, ['pol-fixture-001']);
                        assert.deepEqual(emit.composition.evidenceRefs, ['ev-fixture-001', 'ev-fixture-002']);
                });

                test('duplicate refs refuse typed (the family-prefixed items)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const refusal = mustRefuse(await kit.emitReviewComposition(sessionId, { workflowRefs: ['wf-1', 'wf-1'] }));
                        assert.equal(refusal.reason, 'duplicate-ref');
                        assert.deepEqual(refusal.items, ['workflowRefs:wf-1']);
                });

                test('malformed refs carriers refuse typed (non-record refs, unknown key, non-array family, non-string member)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        assert.equal(mustRefuse(await kit.emitReviewComposition(sessionId, 'nope')).reason, 'malformed-record');
                        assert.equal(mustRefuse(await kit.emitReviewComposition(sessionId, { bogus: [] })).reason, 'unknown-key');
                        assert.equal(mustRefuse(await kit.emitReviewComposition(sessionId, { policyRefs: 'nope' })).reason, 'malformed-record');
                        assert.equal(mustRefuse(await kit.emitReviewComposition(sessionId, { evidenceRefs: [123] })).reason, 'malformed-record');
                });

                test('the REAL-validator cross-check: every emitted composition passes validateOnboardingReviewComposition', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        for (const refs of [undefined, {}, { capabilityRefs: ['cap-fixture-001'] }, { workflowRefs: ['wf-fixture-001'], evidenceRefs: ['ev-fixture-001', 'ev-fixture-002'] }]) {
                                const emit = mustOkEmit(await kit.emitReviewComposition(sessionId, refs));
                                const review = validateOnboardingReviewComposition(emit.composition);
                                assert.equal(review.ok, true, `the REAL DH-02 validator must pass every emitted composition (refs: ${JSON.stringify(refs ?? null)})`);
                        }
                });

                test('the emit is a READ op: no clock read, no ledger line, repeatable', async () => {
                        const { files, port } = makeMemoryFs();
                        let clockReads = 0;
                        const clock = (): string => {
                                clockReads += 1;
                                return `2026-10-13T00:00:${String(clockReads).padStart(2, '0')}.000Z`;
                        };
                        const kit = createRolesKit({ clock, rng: fixedRng(FIXTURE_HEX), fsPort: port, root: FIXTURE_ROOT } as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const readsAtFinalize = clockReads;
                        const linesBefore = ledgerLineCount(files);
                        const first = mustOkEmit(await kit.emitReviewComposition(sessionId));
                        const second = mustOkEmit(await kit.emitReviewComposition(sessionId));
                        assert.deepEqual(first.composition, second.composition);
                        assert.equal(clockReads, readsAtFinalize);
                        assert.equal(ledgerLineCount(files), linesBefore);
                });

                test('an unknown session / a disposed kit refuse typed', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        assert.equal(mustRefuse(await kit.emitReviewComposition(`${ROLE_COMPOSITION_ID_PREFIX}ffffffffffffffff`)).reason, 'unknown-session');
                        const sessionId = await composedFixtureSession(kit);
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.emitReviewComposition(sessionId)).reason, 'DISPOSED');
                });
        });

        suite('inspectSession and listSessions', () => {
                test('inspectSession discloses the full honest record', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(inspect.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`);
                        assert.equal(inspect.session.industry, 'legal');
                        assert.equal(inspect.session.stage, 'composed');
                        assert.deepEqual(inspect.session.roles, [fixtureRole(), fixtureParalegal()]);
                        assert.deepEqual(inspect.session.history.map((note) => note.op), ['begin-session', 'add-role', 'add-role', 'finalize-composition']);
                });

                test('an unknown or malformed id is the unknown-session refusal', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        assert.equal(mustRefuse(await kit.inspectSession('nope')).reason, 'unknown-session');
                        assert.equal(mustRefuse(await kit.inspectSession(null)).reason, 'unknown-session');
                });

                test('the returned record is an isolated copy (mutating it never corrupts the kit)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const inspect = mustOkSession(await kit.inspectSession(sessionId));
                        (inspect.session.roles as unknown[]).length = 0;
                        (inspect.session.history as unknown[]).length = 0;
                        const again = mustOkSession(await kit.inspectSession(sessionId));
                        assert.equal(again.session.roles.length, 2);
                        assert.equal(again.session.history.length, 4);
                });

                test('an empty kit lists nothing', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const list = mustOkList(await kit.listSessions());
                        assert.deepEqual(list.sessions, []);
                });

                test('stable ordering by sessionId regardless of begin order', async () => {
                        const kit = createRolesKit(kitOptions({ rng: counterRng() }) as RolesKitOptions);
                        const first = mustOkSession(await kit.beginSession('legal'));
                        const second = mustOkSession(await kit.beginSession('finance'));
                        const list = mustOkList(await kit.listSessions());
                        assert.deepEqual(list.sessions.map((session) => session.sessionId), [
                                first.session.sessionId,
                                second.session.sessionId,
                        ]);
                        assert.equal(first.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}0000000000000002`);
                        assert.equal(second.session.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}0000000000000003`);
                });

                test('filters by stage and industry', async () => {
                        const kit = createRolesKit(kitOptions({ rng: counterRng() }) as RolesKitOptions);
                        const sessionIdA = await composedFixtureSession(kit);
                        const beginB = mustOkSession(await kit.beginSession('finance'));
                        const sessionIdB = beginB.session.sessionId;
                        assert.deepEqual(mustOkList(await kit.listSessions({ stage: 'composed' })).sessions.map((session) => session.sessionId), [sessionIdA]);
                        assert.deepEqual(mustOkList(await kit.listSessions({ stage: 'composing' })).sessions.map((session) => session.sessionId), [sessionIdB]);
                        assert.deepEqual(mustOkList(await kit.listSessions({ industry: 'legal' })).sessions.map((session) => session.sessionId), [sessionIdA]);
                        assert.deepEqual(mustOkList(await kit.listSessions({ industry: 'legal', stage: 'composing' })).sessions, []);
                });

                test('unknown filter fields and non-member values fail closed (UNKNOWN_FILTER)', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const unknownField = mustRefuse(await kit.listSessions({ roles: [] }));
                        assert.equal(unknownField.reason, 'UNKNOWN_FILTER');
                        assert.deepEqual(unknownField.items, ['roles']);
                        assert.equal(mustRefuse(await kit.listSessions({ stage: 'draft' })).reason, 'UNKNOWN_FILTER');
                        assert.equal(mustRefuse(await kit.listSessions({ industry: 'fintech' })).reason, 'UNKNOWN_FILTER');
                        assert.equal(mustRefuse(await kit.listSessions('nope')).reason, 'UNKNOWN_FILTER');
                });

                test('a disposed kit refuses inspect and list', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        kit.dispose();
                        assert.equal(mustRefuse(await kit.inspectSession(`${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`)).reason, 'DISPOSED');
                        assert.equal(mustRefuse(await kit.listSessions()).reason, 'DISPOSED');
                });
        });

        suite('persistence (the PIN-2 mirror, mirrored EXACTLY)', () => {
                test('the roles envelope and the append-only ledger land with the first applied op', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        assert.equal(files.has(ROL_LEDGER_PATH), true);
                        assert.equal(files.has(ROL_ENVELOPE_PATH), true);
                        const ledgerLines = (files.get(ROL_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
                        assert.equal(ledgerLines.length, 1);
                        const line = JSON.parse(ledgerLines[0]) as Record<string, unknown>;
                        assert.deepEqual(Object.keys(line), [...ROLES_LEDGER_LINE_SCHEMA_KEYS]);
                        assert.equal(line.op, 'begin-session');
                        assert.equal(line.seq, 1);
                        assert.equal(line.sessionId, `${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`);
                        assert.equal(line.fromStage, null);
                        assert.equal(line.toStage, 'composing');
                        assert.equal(line.payload, 'legal');
                        assert.equal(line.contractVersion, ROLES_CONTRACTS_VERSION);
                        const envelope = JSON.parse(files.get(ROL_ENVELOPE_PATH) as string) as Record<string, unknown>;
                        assert.deepEqual(Object.keys(envelope), [...ROLES_ENVELOPE_SCHEMA_KEYS]);
                        assert.equal(envelope.contractVersion, ROLES_CONTRACTS_VERSION);
                        assert.equal(envelope.seq, 1);
                        assert.equal((envelope.sessions as unknown[]).length, 1);
                });

                test('the ledger appends one canonical line per applied op (seq == line number; the payload shapes)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        mustOkSession(await kit.addRole(sessionId, fixtureParalegal()));
                        mustOkSession(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'the revised fixture counsel summary'));
                        mustOkSession(await kit.removeRole(sessionId, 'fixture.paralegal'));
                        mustOkSession(await kit.finalizeComposition(sessionId));
                        const ledgerLines = (files.get(ROL_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
                        assert.equal(ledgerLines.length, 6);
                        assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2, 3, 4, 5, 6]);
                        assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { op: string }).op), [
                                'begin-session', 'add-role', 'add-role', 'replace-role-summary', 'remove-role', 'finalize-composition',
                        ]);
                        assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { law: string }).law), [
                                'THE FORWARD-ONLY LAW', 'THE NO-FORK LAW', 'THE NO-FORK LAW', 'THE REMOVE+RE-ADD LAW', 'THE REMOVE+RE-ADD LAW', 'THE FORWARD-ONLY LAW',
                        ]);
                        assert.equal((JSON.parse(ledgerLines[0]) as { payload: unknown }).payload, 'legal');
                        assert.deepEqual((JSON.parse(ledgerLines[1]) as { payload: unknown }).payload, fixtureRole());
                        assert.deepEqual((JSON.parse(ledgerLines[2]) as { payload: unknown }).payload, fixtureParalegal());
                        assert.deepEqual((JSON.parse(ledgerLines[3]) as { payload: unknown }).payload, { roleKey: 'fixture.counsel', summary: 'the revised fixture counsel summary' });
                        assert.deepEqual((JSON.parse(ledgerLines[4]) as { payload: unknown }).payload, fixtureParalegal());
                        assert.equal((JSON.parse(ledgerLines[5]) as { payload: unknown }).payload, null);
                });

                test('round-trip: loadRolesKit replays the identical honest session state', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        mustOkSession(await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'the revised fixture counsel summary'));
                        mustOkSession(await kit.finalizeComposition(sessionId));
                        const live = mustOkSession(await kit.inspectSession(sessionId));
                        const load = mustOkOb(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        const reopened = mustOkSession(await load.kit.inspectSession(sessionId));
                        assert.deepEqual(reopened.session, live.session);
                        assert.equal((files.get(ROL_LEDGER_PATH) as string).endsWith('\n'), true);
                });

                test('restart mid-walk: the reloaded kit continues composing (the seq continues)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as RolesKitOptions);
                        const sessionId = (mustOkSession(await kit.beginSession('legal'))).session.sessionId;
                        mustOkSession(await kit.addRole(sessionId, fixtureRole()));
                        const loadOutcome = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(loadOutcome.ok, true);
                        const reopened = loadOutcome.ok ? loadOutcome.kit : null;
                        assert.notEqual(reopened, null);
                        const added = mustOkSession(await (reopened as RolesKit).addRole(sessionId, fixtureParalegal()));
                        assert.deepEqual(added.session.roles, [fixtureRole(), fixtureParalegal()]);
                        const finalized = mustOkSession(await (reopened as RolesKit).finalizeComposition(sessionId));
                        assert.equal(finalized.session.stage, 'composed');
                        const ledgerLines = (files.get(ROL_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
                        assert.equal(ledgerLines.length, 4);
                        assert.equal((JSON.parse(ledgerLines[3]) as { seq: number }).seq, 4);
                });

                test('the multi-session ledger replays both sessions (interleaved ops)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: counterRng(), clock: advancingClock().clock }) as RolesKitOptions);
                        const beginA = mustOkSession(await kit.beginSession('legal'));
                        const sessionIdA = beginA.session.sessionId;
                        const beginB = mustOkSession(await kit.beginSession('finance'));
                        const sessionIdB = beginB.session.sessionId;
                        mustOkSession(await kit.addRole(sessionIdA, fixtureRole()));
                        mustOkSession(await kit.addRole(sessionIdB, fixtureParalegal()));
                        mustOkSession(await kit.finalizeComposition(sessionIdA));
                        const loadOutcome = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(loadOutcome.ok, true);
                        const reopened = loadOutcome.ok ? loadOutcome.kit : null;
                        const inspectA = mustOkSession(await (reopened as RolesKit).inspectSession(sessionIdA));
                        const inspectB = mustOkSession(await (reopened as RolesKit).inspectSession(sessionIdB));
                        assert.equal(inspectA.session.stage, 'composed');
                        assert.deepEqual(inspectA.session.roles, [fixtureRole()]);
                        assert.equal(inspectB.session.stage, 'composing');
                        assert.deepEqual(inspectB.session.roles, [fixtureParalegal()]);
                        const list = mustOkList(await (reopened as RolesKit).listSessions());
                        assert.deepEqual(list.sessions.map((session) => session.sessionId), [sessionIdA, sessionIdB]);
                        assert.equal(ledgerLineCount(files), 5);
                });

                test('a fresh kit never appends over an existing roles ledger (E_LEDGER_TORN)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const second = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, rng: fixedRng('ffffffffffffffff') }) as RolesKitOptions);
                        const refusal = mustRefuse(await second.beginSession('legal'));
                        assert.equal(refusal.reason, 'E_LEDGER_TORN');
                        assert.match(refusal.detail, /reopen with loadRolesKit/);
                        assert.equal(ledgerLineCount(files), 1);
                });

                test('a torn roles ledger (a missing trailing newline) fails closed with E_LEDGER_TORN', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const torn = (files.get(ROL_LEDGER_PATH) as string).slice(0, -1);
                        files.set(ROL_LEDGER_PATH, torn);
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'E_LEDGER_TORN');
                        assert.match(refusal.detail, /does not end with a complete line/);
                });

                test('an unparseable or sequence-drifted roles ledger line fails closed with E_LEDGER_TORN', async () => {
                        const { files, port } = makeMemoryFs();
                        files.set(ROL_LEDGER_PATH, '{not json}\n');
                        assert.equal(mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions)).reason, 'E_LEDGER_TORN');
                        const sessionId = `${ROLE_COMPOSITION_ID_PREFIX}${FIXTURE_HEX}`;
                        const lines = [
                                '{"seq":1,"at":"2026-10-13T00:00:00.000Z","contractVersion":"1.0.0","op":"begin-session","sessionId":"' + sessionId + '","fromStage":null,"toStage":"composing","law":"THE FORWARD-ONLY LAW","payload":"legal","detail":"fixture"}',
                                '{"seq":9,"at":"2026-10-13T00:00:01.000Z","contractVersion":"1.0.0","op":"add-role","sessionId":"' + sessionId + '","fromStage":"composing","toStage":"composing","law":"THE NO-FORK LAW","payload":{"roleKey":"fixture.counsel","summary":"the fixture counsel role"},"detail":"fixture"}',
                        ];
                        files.set(ROL_LEDGER_PATH, `${lines.join('\n')}\n`);
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'E_LEDGER_TORN');
                        assert.match(refusal.detail, /out of order|missing/);
                });

                test('a divergent roles envelope fails closed with E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const envelope = JSON.parse(files.get(ROL_ENVELOPE_PATH) as string) as { sessions: Record<string, unknown>[] };
                        (envelope.sessions[0] as { stage: string }).stage = 'composed';
                        files.set(ROL_ENVELOPE_PATH, JSON.stringify(envelope));
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
                        assert.match(refusal.detail, /never silently rebuilt/);
                });

                test('a missing or malformed roles envelope fails closed with E_ENVELOPE_MISMATCH', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        files.delete(ROL_ENVELOPE_PATH);
                        const missing = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(missing.reason, 'E_ENVELOPE_MISMATCH');
                        assert.match(missing.detail, /envelope is missing/);
                        files.set(ROL_ENVELOPE_PATH, '{not json}');
                        assert.equal(mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions)).reason, 'E_ENVELOPE_MISMATCH');
                });

                test('a version-drifted roles ledger line is the typed version-mismatch (THE SINGLE-VERSION LAW\'s live station)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const lines = (files.get(ROL_LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
                        const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
                        parsed.contractVersion = '9.9.9';
                        lines[0] = JSON.stringify(parsed);
                        files.set(ROL_LEDGER_PATH, `${lines.join('\n')}\n`);
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'version-mismatch');
                        assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
                        assert.match(refusal.detail, /single-version law/);
                });

                test('a version-drifted roles envelope is the typed version-mismatch', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const envelope = JSON.parse(files.get(ROL_ENVELOPE_PATH) as string) as Record<string, unknown>;
                        files.set(ROL_ENVELOPE_PATH, JSON.stringify({ ...envelope, contractVersion: '9.9.9' }));
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'version-mismatch');
                        assert.equal(refusal.law, 'THE SINGLE-VERSION LAW');
                });

                test('an envelope ahead of the ledger fails closed with E_LEDGER_TORN (missing ledger lines)', async () => {
                        const { files, port } = makeMemoryFs();
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        mustOkSession(await kit.beginSession('legal'));
                        const envelope = JSON.parse(files.get(ROL_ENVELOPE_PATH) as string) as Record<string, unknown>;
                        files.set(ROL_ENVELOPE_PATH, JSON.stringify({ ...envelope, seq: 9 }));
                        const refusal = mustRefuse(await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions));
                        assert.equal(refusal.reason, 'E_LEDGER_TORN');
                        assert.match(refusal.detail, /missing ledger lines/);
                });

                test('a fresh root reopens empty and loadRolesKit is idempotent (never rewrites the files)', async () => {
                        const { files, port } = makeMemoryFs();
                        const first = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(first.ok, true);
                        assert.deepEqual(mustOkList(await (first.ok ? first.kit : null as unknown as RolesKit).listSessions()).sessions, []);
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const beforeLedger = files.get(ROL_LEDGER_PATH) as string;
                        const beforeEnvelope = files.get(ROL_ENVELOPE_PATH) as string;
                        const second = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        const third = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(files.get(ROL_LEDGER_PATH), beforeLedger);
                        assert.equal(files.get(ROL_ENVELOPE_PATH), beforeEnvelope);
                        const a = mustOkSession(await (second.ok ? second.kit : null as unknown as RolesKit).inspectSession(sessionId));
                        const b = mustOkSession(await (third.ok ? third.kit : null as unknown as RolesKit).inspectSession(sessionId));
                        assert.equal(JSON.stringify(a.session), JSON.stringify(b.session));
                });

                test('a refusing roles ledger append is the typed ROLES_IO with NOTHING applied', async () => {
                        const { files } = makeMemoryFs();
                        const port = appendRefusingFs(files);
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        const refusal = mustRefuse(await kit.beginSession('legal'));
                        assert.equal(refusal.reason, 'ROLES_IO');
                        assert.match(refusal.detail, /nothing was applied/);
                        const list = mustOkList(await kit.listSessions());
                        assert.deepEqual(list.sessions, []);
                        assert.equal(files.has(ROL_LEDGER_PATH), false);
                });

                test('a refusing envelope rewrite is the typed ROLES_IO disclosing the landed line (a reload fails E_ENVELOPE_MISMATCH)', async () => {
                        const { files } = makeMemoryFs();
                        const port = writeRefusingFs(files);
                        const kit = createRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        const refusal = mustRefuse(await kit.beginSession('legal'));
                        assert.equal(refusal.reason, 'ROLES_IO');
                        assert.match(refusal.detail, /landed at seq 1/);
                        const list = mustOkList(await kit.listSessions());
                        assert.equal(list.sessions.length, 1);
                        const { port: workingPort } = makeMemoryFs(files);
                        const load = await loadRolesKit(kitOptions({ fsPort: workingPort, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(load.ok, false);
                        assert.equal(mustRefuse(load).reason, 'E_ENVELOPE_MISMATCH');
                });

                test('an in-memory kit (no fsPort) never touches a filesystem - the full compose, freeze and emit stay in memory', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        const emit = mustOkEmit(await kit.emitReviewComposition(sessionId));
                        assert.deepEqual(emit.composition.roles, [fixtureRole(), fixtureParalegal()]);
                });
        });

        suite('dispose (the dispose law)', () => {
                test('every operation after dispose rejects with the typed DISPOSED refusal', async () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        const sessionId = await composedFixtureSession(kit);
                        kit.dispose();
                        for (const outcome of [
                                await kit.beginSession('legal'),
                                await kit.addRole(sessionId, fixtureRole({ roleKey: 'fixture.newcomer' })),
                                await kit.replaceRoleSummary(sessionId, 'fixture.counsel', 'a summary'),
                                await kit.removeRole(sessionId, 'fixture.counsel'),
                                await kit.finalizeComposition(sessionId),
                                await kit.emitReviewComposition(sessionId),
                                await kit.inspectSession(sessionId),
                                await kit.listSessions(),
                        ]) {
                                assert.equal(mustRefuse(outcome).reason, 'DISPOSED');
                        }
                });

                test('dispose is idempotent (a second dispose never throws)', () => {
                        const kit = createRolesKit(kitOptions() as RolesKitOptions);
                        kit.dispose();
                        assert.doesNotThrow(() => kit.dispose());
                });
        });

        suite('THE CROSS-KIT INTEGRATION PINS (the wave\'s crown)', () => {
                test('the full journey through the REAL createOnboardingKit: composeDraft green, propose green, the minted descriptor\'s roles BYTE-IDENTICAL', async () => {
                        const { files, port } = makeMemoryFs();
                        const rolesKit = createRolesKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as RolesKitOptions);
                        const sessionId = await composedFixtureSession(rolesKit);
                        const emit = mustOkEmit(await rolesKit.emitReviewComposition(sessionId));
                        const obKit = createOnboardingKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as OnboardingKitOptions);
                        const obSessionId = await walkedToObReview(obKit);
                        const draft = mustOkOb(await obKit.composeDraft(obSessionId, emit.composition));
                        assert.equal(draft.session.stage, 'review');
                        const proposed = mustOkOb(await obKit.proposeSession(obSessionId));
                        assert.equal(proposed.session.stage, 'proposed');
                        assert.equal((proposed.session.harnessId as string).startsWith(HARNESS_ID_PREFIX), true);
                        // the minted draft descriptor's roles BYTE-IDENTICAL to the composed roles
                        const harnessEnvelope = JSON.parse(files.get(HRN_ENVELOPE_PATH) as string) as { harnesses: { state: string; descriptor: Record<string, unknown> }[] };
                        const descriptor = harnessEnvelope.harnesses[0].descriptor;
                        assert.equal(JSON.stringify(descriptor.roles), JSON.stringify(emit.composition.roles));
                        assert.deepEqual(descriptor.roles, emit.composition.roles);
                        // the deterministic displayName / industry / workTypes from the onboarding answers
                        assert.equal(descriptor.industry, 'legal');
                        assert.deepEqual(descriptor.workTypes, ['analysis', 'drafting', 'review']);
                        assert.equal(descriptor.displayName, 'fixture litigation harness');
                        assert.equal(harnessEnvelope.harnesses[0].state, 'proposed');
                });

                test('THE HONEST GAP: a fabricated workflowRef emits, mints at draft, and refuses at the REAL propose boundary - fail-closed, never a fake resolution', async () => {
                        const { files, port } = makeMemoryFs();
                        const rolesKit = createRolesKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as RolesKitOptions);
                        const sessionId = await composedFixtureSession(rolesKit);
                        const emit = mustOkEmit(await rolesKit.emitReviewComposition(sessionId, { workflowRefs: ['wf-fixture-fabricated'] }));
                        assert.deepEqual(emit.composition.workflowRefs, ['wf-fixture-fabricated']);
                        const obKit = createOnboardingKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as OnboardingKitOptions);
                        const obSessionId = await walkedToObReview(obKit);
                        // THE TWO-PHASE LAW: the fabricated ref mints fine at draft (the honest emit NEVER invents a resolution)
                        const draft = mustOkOb(await obKit.composeDraft(obSessionId, emit.composition));
                        assert.notEqual(draft.session.harnessId, null);
                        // the DANGLING_REF fires at the REAL DH-02 propose boundary against the injected catalog snapshot
                        const refusal = mustRefuseOb(await obKit.proposeSession(obSessionId));
                        assert.equal(refusal.reason, 'harness-kit-refused');
                        assert.equal(refusal.law, 'THE REAL-KIT LAW');
                        assert.match(refusal.message, /NO-DANGLING-REF boundary/);
                        assert.equal(refusal.harnessRefusal?.reason, 'VALIDATION_REFUSED');
                        const validation = refusal.harnessRefusal?.validation as unknown as { rejections: { reason: string; family?: string; items: readonly string[] }[] };
                        assert.equal(validation.rejections[0].reason, 'dangling-ref');
                        assert.equal(validation.rejections[0].family, 'workflowRefs');
                        assert.deepEqual(validation.rejections[0].items, ['wf-fixture-fabricated']);
                        // no partial effect: the onboarding session stays at review with the draft link intact
                        const inspect = mustOkOb(await obKit.inspectSession(obSessionId));
                        assert.equal(inspect.session.stage, 'review');
                });

                test('the three families\' ledgers coexist under the shared root (the roles replay stays green after the journey)', async () => {
                        const { files, port } = makeMemoryFs();
                        const rolesKit = createRolesKit({ clock: fixedClock(), rng: fixedRng('fedcba9876543210'), fsPort: port, root: FIXTURE_ROOT } as RolesKitOptions);
                        const sessionId = await composedFixtureSession(rolesKit);
                        const emit = mustOkEmit(await rolesKit.emitReviewComposition(sessionId));
                        const obKit = createOnboardingKit({ clock: fixedClock(), rng: fixedRng(FIXTURE_HEX), catalog: fixtureCatalog(), fsPort: port, root: FIXTURE_ROOT } as OnboardingKitOptions);
                        const obSessionId = await walkedToObReview(obKit);
                        mustOkOb(await obKit.composeDraft(obSessionId, emit.composition));
                        mustOkOb(await obKit.proposeSession(obSessionId));
                        assert.equal(files.has(ROL_LEDGER_PATH), true);
                        assert.equal(files.has(ONB_LEDGER_PATH), true);
                        assert.equal(files.has(HRN_LEDGER_PATH), true);
                        const loadOutcome = await loadRolesKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as RolesKitOptions);
                        assert.equal(loadOutcome.ok, true);
                        const reopened = loadOutcome.ok ? loadOutcome.kit : null;
                        const inspect = mustOkSession(await (reopened as RolesKit).inspectSession(sessionId));
                        assert.equal(inspect.session.stage, 'composed');
                        assert.deepEqual(inspect.session.roles, [fixtureRole(), fixtureParalegal()]);
                        const list = mustOkList(await (reopened as RolesKit).listSessions());
                        assert.equal(list.sessions.length, 1);
                });
        });

        suite('in-suite determinism greps (the determinism law as a test)', () => {
                test('every banned-global hit in rolesKit.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/rolesKit.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });

                test('every banned-global hit in rolesContract.ts is a law-comment line', () => {
                        const hits = determinismGrepHits('../../common/rolesContract.ts');
                        assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
                        for (const line of hits) {
                                assert.match(line.trim(), /^\*/);
                        }
                });
        });
});
