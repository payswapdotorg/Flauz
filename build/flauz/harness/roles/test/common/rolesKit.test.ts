/*
 * DH-003 roles kit test suite (mocha tdd style, matching
 * build/flauz/harness/onboarding/test/common/onboardingKit.test.ts -
 * the DH-002 landed family precedent - and the DH-001 kit battery
 * before it).
 *
 * Fixture policy: every timestamp below is SYNTHETIC (the fixed fixture
 * ISO string, or the deterministic advancing fixture clock - never a
 * real clock) and is NOT an authority value, NOT credential material,
 * NOT execution material. The kit tests run the STATELESS instrument
 * over deterministic test doubles for the clock (fixed-value or
 * counter-based - NEVER the random global, never a real clock). THE
 * INTEGRATION LAW tests run a REAL DH-002 onboarding kit (which
 * internally constructs the REAL DH-001 harness kit) over a REAL
 * mkdtemp temp root with a REAL node:fs-backed port - the mint lands
 * on real disk and is read back from the harness ledger. The in-suite
 * determinism greps pin the sources to law-comment lines only (the
 * banned-global patterns are assembled piecewise so this test source
 * itself stays grep-clean).
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
        ROLES_CONTRACTS_VERSION,
        ROLES_KIT_EXTRA_REFUSAL_REASONS,
        ROLES_KIT_REFUSAL_REASONS,
        createRolesKit,
        isRolesKitRefusalReason,
} from '../../common/rolesKit.js';
import type { RolesKit, RolesKitRefusal, RolesSuggestOutcome } from '../../common/rolesKit.js';
import {
        INDUSTRY_ROLE_CATALOGS,
        ROLES_CONTRACTS_VERSION as CONTRACT_VERSION_PIN,
        ROLES_VALIDATION_REJECTION_REASONS,
        isRoleCompositionRecord,
        parseRoleComposition,
        serializeRoleComposition,
        validateRoleCompositionRequest,
} from '../../common/rolesContract.js';
import type { RoleCompositionRecord } from '../../common/rolesContract.js';
import { createOnboardingKit } from '../../../onboarding/common/onboardingKit.js';
import type { OnboardingKit } from '../../../onboarding/common/onboardingKit.js';
import type { HarnessFsPort } from '../../../contract/common/domainHarnessKit.js';
import type { HarnessCatalogSnapshot } from '../../../contract/common/domainHarnessContract.js';
import { HARNESS_INDUSTRIES, HARNESS_WORK_TYPES } from '../../../contract/common/domainHarnessContract.js';

const FIXTURE_NOW_ISO = '2026-10-13T00:00:00.000Z';

function fixedClock(): () => string {
        return () => FIXTURE_NOW_ISO;
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

/** The REAL node:fs-backed port (the DH-01 fs-port contract over the real filesystem; THE INTEGRATION LAW's temp root). */
function realFsPort(): HarnessFsPort {
        return {
                readFile: (path, encoding) => readFile(path, { encoding }),
                writeFile: (path, text) => writeFile(path, text, 'utf8'),
                appendFile: (path, text) => appendFile(path, text, 'utf8'),
                mkdir: async (path, options) => {
                        await mkdir(path, options);
                },
        };
}

function kitOptions(overrides: Record<string, unknown> = {}): unknown {
        return {
                clock: fixedClock(),
                ...overrides,
        };
}

function mustSuggest(outcome: RolesSuggestOutcome): RoleCompositionRecord {
        if (outcome.ok) {
                return outcome.composition;
        }
        assert.fail(`expected an ok suggestion, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuseKit<T extends { ok: boolean }>(outcome: T): RolesKitRefusal {
        if (!outcome.ok) {
                return (outcome as unknown as { refusal: RolesKitRefusal }).refusal;
        }
        assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

/** The DH-02 session outcome helpers (the landed battery's discipline). */
type SessionOutcome = { ok: boolean; session?: unknown };
function mustOkSession(outcome: SessionOutcome): { session: { sessionId: string; stage: string; harnessId: string | null; reviewComposition: { roles: unknown[] } | null } } {
        if (outcome.ok) {
                return outcome as unknown as { session: { sessionId: string; stage: string; harnessId: string | null; reviewComposition: { roles: unknown[] } | null } };
        }
        assert.fail(`expected an ok session outcome: ${JSON.stringify(outcome)}`);
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

suite('DH-003 roles kit', () => {

        suite('the factory (fail-closed, TypeError on misuse)', () => {
                test('a valid factory returns the kit interface', () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        assert.equal(typeof kit.suggestComposition, 'function');
                        assert.equal(typeof kit.validateSelection, 'function');
                        assert.equal(typeof kit.inspectCatalog, 'function');
                        assert.equal(typeof kit.dispose, 'function');
                });
                test('non-object options are refused with TypeError', () => {
                        assert.throws(() => createRolesKit(null as unknown as { clock: () => string }), TypeError);
                        assert.throws(() => createRolesKit(42 as unknown as { clock: () => string }), TypeError);
                });
                test('a missing or malformed clock is refused with TypeError (the injected-clock law)', () => {
                        assert.throws(() => createRolesKit({} as { clock: () => string }), /options.clock must be a function returning ISO string values/);
                        assert.throws(() => createRolesKit({ clock: 'not-a-function' } as unknown as { clock: () => string }), /options.clock must be a function/);
                });
                test('a clock whose first read is malformed is refused with TypeError', () => {
                        assert.throws(() => createRolesKit({ clock: () => '' } as { clock: () => string }), /non-empty ISO string/);
                        assert.throws(() => createRolesKit({ clock: () => 42 as unknown as string } as { clock: () => string }), /non-empty ISO string/);
                });
                test('THE SINGLE-VERSION LAW: the kit re-carries the contract version (both copies equal)', () => {
                        assert.equal(ROLES_CONTRACTS_VERSION === CONTRACT_VERSION_PIN, true);
                        assert.equal(ROLES_CONTRACTS_VERSION, '1.0.0');
                });
                test('ROLES_KIT_REFUSAL_REASONS is the contract sixteen plus the kit extras, in order', () => {
                        assert.deepEqual([...ROLES_KIT_REFUSAL_REASONS], [...ROLES_VALIDATION_REJECTION_REASONS, ...ROLES_KIT_EXTRA_REFUSAL_REASONS]);
                        assert.deepEqual([...ROLES_KIT_EXTRA_REFUSAL_REASONS], ['disposed', 'corrupt-seam']);
                        assert.equal(ROLES_KIT_REFUSAL_REASONS.length, 18);
                        for (const reason of ROLES_KIT_REFUSAL_REASONS) {
                                assert.equal(isRolesKitRefusalReason(reason), true);
                        }
                        assert.equal(isRolesKitRefusalReason('no-forkk'), false);
                });
        });

        suite('suggestComposition (THE COMPOSITION LAW engine)', () => {
                test('the legal + analysis/drafting/review suggestion is the exact pinned record', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const composition = mustSuggest(await kit.suggestComposition({ industry: 'legal', workTypes: ['analysis', 'drafting', 'review'] }));
                        assert.deepEqual(composition, {
                                contractVersion: '1.0.0',
                                industry: 'legal',
                                workTypes: ['analysis', 'drafting', 'review'],
                                composedAtIso: FIXTURE_NOW_ISO,
                                roles: [
                                        { roleKey: 'drafter', summary: 'writes the contracts, the pleadings and the instruments the matter needs' },
                                        { roleKey: 'reviewer', summary: 'examines the drafts for legal risk and for drift from the agreed position' },
                                        { roleKey: 'researcher', summary: 'performs the case research and the precedent analysis the position rests on' },
                                        { roleKey: 'writer', summary: 'maintains the memoranda and the client-facing explanations of the work' },
                                        { roleKey: 'analyst', summary: 'processes the matter data and the discovery material into the position files' },
                                ],
                                provenance: [
                                        { roleKey: 'drafter', contributedBy: ['drafting'] },
                                        { roleKey: 'reviewer', contributedBy: ['review'] },
                                        { roleKey: 'researcher', contributedBy: ['analysis'] },
                                        { roleKey: 'writer', contributedBy: ['drafting'] },
                                        { roleKey: 'analyst', contributedBy: ['analysis'] },
                                ],
                        });
                });
                test('the composed roles follow the CATALOG order (never the affinity order, never the request order)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const composition = mustSuggest(await kit.suggestComposition({ industry: 'software', workTypes: ['planning', 'compliance'] }));
                        assert.deepEqual(composition.roles.map((role) => role.roleKey), ['architect', 'reviewer', 'auditor']);
                        assert.deepEqual(composition.provenance, [
                                { roleKey: 'architect', contributedBy: ['planning'] },
                                { roleKey: 'reviewer', contributedBy: ['compliance'] },
                                { roleKey: 'auditor', contributedBy: ['compliance'] },
                        ]);
                });
                test('a role contributed by TWO work types appears once, its provenance carrying both (in the frozen work-type order)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const composition = mustSuggest(await kit.suggestComposition({ industry: 'legal', workTypes: ['analysis', 'research'] }));
                        assert.deepEqual(composition.roles.map((role) => role.roleKey), ['researcher', 'analyst']);
                        assert.deepEqual(composition.provenance, [
                                { roleKey: 'researcher', contributedBy: ['analysis', 'research'] },
                                { roleKey: 'analyst', contributedBy: ['analysis', 'research'] },
                        ]);
                });
                test('the full software selection composes the seven affinity-reachable templates (catalog-only roles are never suggested)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const composition = mustSuggest(await kit.suggestComposition({ industry: 'software', workTypes: [...HARNESS_WORK_TYPES] }));
                        assert.deepEqual(composition.roles.map((role) => role.roleKey), ['architect', 'implementer', 'reviewer', 'analyst', 'writer', 'coordinator', 'auditor']);
                        assert.deepEqual(composition.provenance.find((entry) => entry.roleKey === 'analyst'), { roleKey: 'analyst', contributedBy: ['analysis', 'research', 'reporting', 'data-processing'] });
                        assert.equal(composition.roles.some((role) => role.roleKey === 'tester'), false, 'tester sits in no affinity - it is never suggested');
                });
                test('every industry composes for at least one work type (the instrument is never structurally dead)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        for (const industry of HARNESS_INDUSTRIES) {
                                let composed = false;
                                for (const workType of HARNESS_WORK_TYPES) {
                                        const outcome = await kit.suggestComposition({ industry, workTypes: [workType] });
                                        if (outcome.ok) {
                                                composed = true;
                                                break;
                                        }
                                }
                                assert.equal(composed, true, `industry '${industry}' must compose for at least one work type`);
                        }
                });
                test('the suggestion record satisfies the deep walk and round-trips the canonical bytes', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const composition = mustSuggest(await kit.suggestComposition({ industry: 'government', workTypes: ['drafting', 'compliance'] }));
                        assert.equal(isRoleCompositionRecord(composition), true);
                        const bytes = serializeRoleComposition(composition);
                        const outcome = parseRoleComposition(bytes);
                        assert.equal(outcome.ok, true);
                        if (outcome.ok) {
                                assert.equal(serializeRoleComposition(outcome.record), bytes);
                        }
                });
                test('determinism: two independently constructed kits produce byte-identical canonical bytes for the same request', async () => {
                        const kitA = createRolesKit(kitOptions() as { clock: () => string });
                        const kitB = createRolesKit(kitOptions() as { clock: () => string });
                        const request = { industry: 'healthcare', workTypes: ['research', 'reporting'] };
                        const bytesA = serializeRoleComposition(mustSuggest(await kitA.suggestComposition(request)));
                        const bytesB = serializeRoleComposition(mustSuggest(await kitB.suggestComposition(request)));
                        assert.equal(bytesA, bytesB);
                });
                test('determinism: the same kit produces byte-identical canonical bytes on repeat calls', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const request = { industry: 'media', workTypes: ['planning', 'communication'] };
                        const once = serializeRoleComposition(mustSuggest(await kit.suggestComposition(request)));
                        const twice = serializeRoleComposition(mustSuggest(await kit.suggestComposition(request)));
                        assert.equal(once, twice);
                });
                test('the request-walk refusals surface verbatim (the contract walk, carried unchanged)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const unknownIndustry = mustRefuseKit(await kit.suggestComposition({ industry: 'aerospace', workTypes: ['review'] }));
                        assert.equal(unknownIndustry.reason, 'unknown-industry');
                        assert.equal(unknownIndustry.law, 'THE FROZEN-VOCABULARY LAW');
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: [] })).reason, 'empty-work-types');
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review', 'mind-reading'] })).reason, 'unknown-work-type');
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review', 'review'] })).reason, 'duplicate-work-types');
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review', 'analysis'] })).reason, 'work-types-out-of-order');
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review'], code: 'x' })).reason, 'no-fork');
                });
                test('the kit refusal is the contract refusal carried field-for-field (the verbatim pin)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const kitRefusal = mustRefuseKit(await kit.suggestComposition({ industry: 'aerospace', workTypes: ['review'] }));
                        const contractOutcome = validateRoleCompositionRequest({ industry: 'aerospace', workTypes: ['review'] });
                        assert.equal(contractOutcome.ok, false);
                        if (!contractOutcome.ok) {
                                assert.deepEqual(kitRefusal, { ...contractOutcome.refusal });
                        }
                });
                test('THE EMPTY-COMPOSITION refusal fires live (construction + analysis: the intersection is empty - the honest refusal)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const refusal = mustRefuseKit(await kit.suggestComposition({ industry: 'construction', workTypes: ['analysis'] }));
                        assert.equal(refusal.reason, 'empty-composition');
                        assert.equal(refusal.law, 'THE COMPOSITION LAW');
                        assert.deepEqual(refusal.items, ['analysis']);
                });
                test('a clock that returns a malformed value mid-op is the corrupt-seam refusal (an honest timestamp or none at all)', async () => {
                        let reads = 0;
                        const clock = (): string => {
                                reads += 1;
                                return reads === 1 ? FIXTURE_NOW_ISO : '';
                        };
                        const kit = createRolesKit({ clock });
                        const refusal = mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review'] }));
                        assert.equal(refusal.reason, 'corrupt-seam');
                        assert.equal(refusal.law, 'THE CORRUPT-SEAM LAW');
                });
                test('every operation after dispose refuses with the typed disposed refusal', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        kit.dispose();
                        const refusal = mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review'] }));
                        assert.equal(refusal.reason, 'disposed');
                        assert.equal(refusal.law, 'THE DISPOSE LAW');
                });
        });

        suite('validateSelection (the explicit-selection boundary)', () => {
                test('a well-formed selection resolves the templates in catalog order', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const outcome = await kit.validateSelection({ industry: 'legal', roleKeys: ['writer', 'counsel', 'drafter'] });
                        assert.equal(outcome.ok, true);
                        if (outcome.ok) {
                                assert.equal(outcome.selection.industry, 'legal');
                                assert.deepEqual(outcome.selection.roles.map((role) => role.roleKey), ['counsel', 'drafter', 'writer']);
                        }
                });
                test('a non-member roleKey is the role-not-in-catalog refusal listing every offender', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const refusal = mustRefuseKit(await kit.validateSelection({ industry: 'legal', roleKeys: ['counsel', 'architect', 'bogus'] }));
                        assert.equal(refusal.reason, 'role-not-in-catalog');
                        assert.deepEqual(refusal.items, ['architect', 'bogus']);
                });
                test('repeats are the duplicate-role-keys refusal; an empty selection is the empty-composition refusal', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        assert.equal(mustRefuseKit(await kit.validateSelection({ industry: 'legal', roleKeys: ['counsel', 'counsel'] })).reason, 'duplicate-role-keys');
                        assert.equal(mustRefuseKit(await kit.validateSelection({ industry: 'legal', roleKeys: [] })).reason, 'empty-composition');
                });
                test('an unknown industry is the unknown-industry refusal', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        assert.equal(mustRefuseKit(await kit.validateSelection({ industry: 'aerospace', roleKeys: ['counsel'] })).reason, 'unknown-industry');
                });
                test('the selection refuses after dispose', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        kit.dispose();
                        assert.equal(mustRefuseKit(await kit.validateSelection({ industry: 'legal', roleKeys: ['counsel'] })).reason, 'disposed');
                });
        });

        suite('inspectCatalog (the read surface - the frozen catalog BY REFERENCE)', () => {
                test('every industry returns the frozen catalog binding itself (never a copy)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        for (const industry of HARNESS_INDUSTRIES) {
                                const outcome = await kit.inspectCatalog(industry);
                                assert.equal(outcome.ok, true, `industry '${industry}' must inspect green`);
                                if (outcome.ok) {
                                        assert.equal(outcome.templates === INDUSTRY_ROLE_CATALOGS[industry], true, `the templates for '${industry}' must be the frozen binding BY REFERENCE`);
                                        assert.equal(outcome.industry, industry);
                                }
                        }
                });
                test('the templates are the frozen configuration (deep-equal the contract table)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        const outcome = await kit.inspectCatalog('science');
                        assert.equal(outcome.ok, true);
                        if (outcome.ok) {
                                assert.deepEqual(outcome.templates, INDUSTRY_ROLE_CATALOGS.science);
                                assert.deepEqual(outcome.templates.map((template) => template.roleKey), ['researcher', 'analyst', 'technician', 'writer', 'reviewer', 'editor', 'administrator', 'curator']);
                        }
                });
                test('an unknown industry is refused (including the prototype-key probe - membership is the only admissibility)', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        assert.equal(mustRefuseKit(await kit.inspectCatalog('aerospace')).reason, 'unknown-industry');
                        assert.equal(mustRefuseKit(await kit.inspectCatalog('toString')).reason, 'unknown-industry');
                        assert.equal(mustRefuseKit(await kit.inspectCatalog(null)).reason, 'unknown-industry');
                });
                test('the catalog read refuses after dispose', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        kit.dispose();
                        assert.equal(mustRefuseKit(await kit.inspectCatalog('legal')).reason, 'disposed');
                });
        });

        suite('THE DISPOSE LAW', () => {
                test('dispose is idempotent and every operation keeps refusing', async () => {
                        const kit = createRolesKit(kitOptions() as { clock: () => string });
                        kit.dispose();
                        kit.dispose();
                        assert.equal(mustRefuseKit(await kit.suggestComposition({ industry: 'legal', workTypes: ['review'] })).reason, 'disposed');
                        assert.equal(mustRefuseKit(await kit.validateSelection({ industry: 'legal', roleKeys: ['counsel'] })).reason, 'disposed');
                        assert.equal(mustRefuseKit(await kit.inspectCatalog('legal')).reason, 'disposed');
                });
        });

        suite('THE INTEGRATION LAW (the DH-02 review stage through a REAL onboarding kit mint in a REAL temp root)', () => {
                test('the suggested composition roles are DIRECTLY admissible as composeDraft roles input (a real harness mint on real disk)', async () => {
                        const tempRoot = await mkdtemp(join(tmpdir(), 'flauz-dh003-'));
                        try {
                                const rolesKit = createRolesKit(kitOptions() as { clock: () => string });
                                const suggestion = mustSuggest(await rolesKit.suggestComposition({ industry: 'legal', workTypes: ['analysis', 'drafting', 'review'] }));
                                const onboarding: OnboardingKit = createOnboardingKit({
                                        clock: fixedClock(),
                                        rng: counterRng(),
                                        catalog: fixtureCatalog(),
                                        fsPort: realFsPort(),
                                        root: tempRoot,
                                });
                                const begin = mustOkSession(await onboarding.beginSession());
                                const sessionId = begin.session.sessionId;
                                await onboarding.selectIndustry(sessionId, 'legal');
                                await onboarding.composeCompany(sessionId, { displayName: 'fixture litigation harness', sizeBand: 'small' });
                                await onboarding.selectWorkTypes(sessionId, ['analysis', 'drafting', 'review']);
                                const composed = mustOkSession(await onboarding.composeDraft(sessionId, {
                                        roles: suggestion.roles, // VERBATIM - THE INTEGRATION LAW (the record's own roles array)
                                        capabilityRefs: [],
                                        workflowRefs: [],
                                        policyRefs: [],
                                        evidenceRefs: [],
                                }));
                                assert.notEqual(composed.session.harnessId, null, 'the real kit minted the harness draft');
                                assert.deepEqual(composed.session.reviewComposition?.roles, suggestion.roles);
                                // The real harness ledger on disk: the mint line's descriptor carries the composition roles verbatim.
                                const ledgerText = await readFile(join(tempRoot, '.flauz/harness/harness-ops.jsonl'), 'utf8');
                                const mintLines = ledgerText
                                        .trim()
                                        .split('\n')
                                        .map((line) => JSON.parse(line) as { op: string; descriptor: { roles: unknown[] } })
                                        .filter((line) => line.op === 'mint');
                                assert.equal(mintLines.length, 1, 'exactly one harness mint landed on disk');
                                assert.deepEqual(mintLines[0].descriptor.roles, suggestion.roles);
                                onboarding.dispose();
                        } finally {
                                await rm(tempRoot, { recursive: true, force: true });
                        }
                });
                test('the proposed walk completes through the real NO-DANGLING-REF boundary (suggest -> composeDraft -> proposeSession)', async () => {
                        const tempRoot = await mkdtemp(join(tmpdir(), 'flauz-dh003-'));
                        try {
                                const rolesKit = createRolesKit(kitOptions() as { clock: () => string });
                                const suggestion = mustSuggest(await rolesKit.suggestComposition({ industry: 'finance', workTypes: ['analysis', 'reporting', 'compliance'] }));
                                const onboarding: OnboardingKit = createOnboardingKit({
                                        clock: fixedClock(),
                                        rng: counterRng(),
                                        catalog: fixtureCatalog(),
                                        fsPort: realFsPort(),
                                        root: tempRoot,
                                });
                                const begin = mustOkSession(await onboarding.beginSession());
                                const sessionId = begin.session.sessionId;
                                await onboarding.selectIndustry(sessionId, 'finance');
                                await onboarding.composeCompany(sessionId, { displayName: 'fixture advisory harness', sizeBand: 'medium' });
                                await onboarding.selectWorkTypes(sessionId, ['analysis', 'reporting', 'compliance']);
                                mustOkSession(await onboarding.composeDraft(sessionId, {
                                        roles: suggestion.roles,
                                        capabilityRefs: [],
                                        workflowRefs: [],
                                        policyRefs: [],
                                        evidenceRefs: [],
                                }));
                                const proposed = mustOkSession(await onboarding.proposeSession(sessionId));
                                assert.equal(proposed.session.stage, 'proposed', 'the session walked review -> proposed through the real boundary');
                                onboarding.dispose();
                        } finally {
                                await rm(tempRoot, { recursive: true, force: true });
                        }
                });
                test('the composed roles carry EXACTLY the DH-01 role shape (the provenance never leaks into the roles array - the no-fork boundary)', async () => {
                        const rolesKit = createRolesKit(kitOptions() as { clock: () => string });
                        const suggestion = mustSuggest(await rolesKit.suggestComposition({ industry: 'software', workTypes: ['review', 'planning', 'communication'] }));
                        assert.equal(suggestion.roles.length > 0, true);
                        for (const role of suggestion.roles) {
                                assert.deepEqual(Object.keys(role).sort(), ['roleKey', 'summary'], `the composed role '${role.roleKey}' must carry exactly the two DH-01 keys`);
                        }
                        assert.equal(suggestion.provenance.length, suggestion.roles.length, 'the provenance is the parallel array, never a roles field');
                });
                test('the VALIDATED selection composes into the same boundary (composeDraft with the resolved templates)', async () => {
                        const tempRoot = await mkdtemp(join(tmpdir(), 'flauz-dh003-'));
                        try {
                                const rolesKit = createRolesKit(kitOptions() as { clock: () => string });
                                const selectionOutcome = await rolesKit.validateSelection({ industry: 'legal', roleKeys: ['counsel', 'drafter', 'reviewer'] });
                                assert.equal(selectionOutcome.ok, true);
                                if (!selectionOutcome.ok) {
                                        throw new Error('unreachable');
                                }
                                const onboarding: OnboardingKit = createOnboardingKit({
                                        clock: fixedClock(),
                                        rng: counterRng(),
                                        catalog: fixtureCatalog(),
                                        fsPort: realFsPort(),
                                        root: tempRoot,
                                });
                                const begin = mustOkSession(await onboarding.beginSession());
                                const sessionId = begin.session.sessionId;
                                await onboarding.selectIndustry(sessionId, 'legal');
                                await onboarding.composeCompany(sessionId, { displayName: 'fixture litigation harness', sizeBand: 'solo' });
                                await onboarding.selectWorkTypes(sessionId, ['drafting', 'review']);
                                const composed = mustOkSession(await onboarding.composeDraft(sessionId, {
                                        roles: selectionOutcome.selection.roles, // the resolved templates, in catalog order
                                        capabilityRefs: [],
                                        workflowRefs: [],
                                        policyRefs: [],
                                        evidenceRefs: [],
                                }));
                                assert.notEqual(composed.session.harnessId, null);
                                assert.deepEqual(composed.session.reviewComposition?.roles, selectionOutcome.selection.roles);
                                onboarding.dispose();
                        } finally {
                                await rm(tempRoot, { recursive: true, force: true });
                        }
                });
        });

        suite('the determinism greps (the shipped modules quote the ban in law comments only)', () => {
                test('this test source carries zero banned-global hits (the patterns are assembled piecewise)', () => {
                        const hits = determinismGrepHits('./rolesKit.test.ts');
                        assert.deepEqual(hits, []);
                });
                test('the shipped modules never CALL the banned globals (the greps over both modules land on law-comment lines only)', () => {
                        for (const modulePath of ['../../common/rolesContract.ts', '../../common/rolesKit.ts']) {
                                const hits = determinismGrepHits(modulePath);
                                assert.equal(hits.length > 0, true, `the law comments in '${modulePath}' quote the ban`);
                                for (const hit of hits) {
                                        const trimmed = hit.trim();
                                        assert.equal(trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.startsWith('//'), true, `the hit in '${modulePath}' must be a comment line: '${trimmed}'`);
                                }
                        }
                });
        });
});
