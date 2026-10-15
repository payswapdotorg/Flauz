/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-011 activation kit battery: THE FAIL-CLOSED FACTORY (every option
 * station, the one-clock/one-rng read law), THE COMPLETE JOURNEY HAPPY
 * PATH (the crown: beginJourney -> selectIndustry -> composeCompany ->
 * selectWorkTypes -> composeRoles (THREE roles - THE MULTI-ROLE LAW) ->
 * composeRecords (the six REAL record kits) -> proposeHarness (the REAL
 * DH-02 review composition + the REAL DH-01 draft->proposed full
 * validation boundary) -> approveHarness -> activateHarness - everything
 * THROUGH the real kits, with the REAL harness record re-read from the
 * authority's own ledger at 'active' and the descriptor carrying the
 * three composed roles), THE MULTI-ROLE PINS (the 3-role path, the
 * single-role floor, the REAL DH-03 MAX_ROLES (32) bound surfaced
 * verbatim), THE LIFECYCLE-CONSTRAINT PINS (the frozen journey-leg
 * order: every premature-leg and stale-leg refusal; 'active' TERMINAL),
 * THE FAIL-CLOSED BRANCHES (the row's core acceptance: every unsafe
 * condition typed, the record-unchanged law pinned byte-identical after
 * every refusal, NO code path from an unsafe proposal to an active
 * harness), THE VERBATIM-CARRY LAW (the real kits' refusals carried
 * complete), THE EVIDENCE-NOT-AUTHORITY LAW (the authority's own state
 * wins at every boundary; the post-approval external advance refuses
 * the journey's activation), the PIN-2 persistence mirror (ledger +
 * envelope, torn line, tampered line, divergent envelope, the
 * fresh-kit guard, restart determinism, the fail-closed laws re-proven
 * from the ledger alone), the listing filters, THE DISPOSE LAW and the
 * in-suite determinism greps.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadHarnessKit } from '../../../contract/common/domainHarnessKit.js';
import { serializeHarnessRecord } from '../../../contract/common/domainHarnessContract.js';
import { loadOnboardingKit } from '../../../onboarding/common/onboardingKit.js';
import { loadRolesKit } from '../../../roles/common/rolesKit.js';
import { createRolesKit } from '../../../roles/common/rolesKit.js';
import { TASK_WORLDS } from '../../../../lab/common/taskWorlds.js';
import {
        ACTIVATION_ENVELOPE_RELATIVE_PATH,
        ACTIVATION_KIT_REFUSAL_REASONS,
        ACTIVATION_LEDGER_LINE_SCHEMA_KEYS,
        ACTIVATION_LEDGER_RELATIVE_PATH,
        createActivationKit,
        loadActivationKit,
} from '../../common/activationKit.js';
import type { ActivationKit, ActivationKitRefusal, HarnessFsPort, JourneyOutcome } from '../../common/activationKit.js';
import { ACTIVATION_CONTRACTS_VERSION, serializeActivationJourney } from '../../common/activationContract.js';

const KIT_SOURCE = readFileSync(fileURLToPath(new URL('../../common/activationKit.ts', import.meta.url)), 'utf8');

/** THE SCENARIO-BINDING LAW's pin-by-import: the benchmark fixture binds the REAL registry ids. */
const REAL_SCENARIO_IDS: string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

const THREE_ROLES = [
        { roleKey: 'analyst', summary: 'Runs the domain analysis.' },
        { roleKey: 'reviewer', summary: 'Reviews the domain work.' },
        { roleKey: 'operations-lead', summary: 'Runs the operations floor.' },
] as const;

const ONE_ROLE = [{ roleKey: 'analyst', summary: 'Runs the domain analysis.' }] as const;

function fixtureContent(roleRefs: readonly string[]): Record<string, unknown> {
        return {
                terms: [
                        { term: 'fixture.discovery', definition: 'the fixture discovery term' },
                        { term: 'fixture.affidavit', definition: 'the fixture affidavit term' },
                ],
                tasks: [{ taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['fixture.discovery'] }],
                bodies: [{ bodyKey: 'triage', summary: 'Triage the incoming work.', roleRefs: [...roleRefs] }],
                packs: [{ packKey: 'core', summary: 'The core pack.', bodyRefs: ['triage'] }],
                profiles: [{
                        profileKey: 'core',
                        summary: 'The core policy profile.',
                        permissionRefs: ['read-files'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'local-real',
                        kpiDimensions: ['success', 'cost'],
                }],
                benchmarks: [{
                        benchmarkKey: 'regression-suite-health',
                        summary: 'The regression suite health benchmark.',
                        hypothesis: 'A composed agent organization completes the seeded regression-fix scenarios with a higher success rate than the single-agent baseline.',
                        scenarioRefs: [...REAL_SCENARIO_IDS],
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The candidate clears every acceptance criterion on at least 6 of 8 seeded instances per scenario.',
                        limitations: 'Fixture worlds over a synthetic repository; no real telemetry, no live repositories, single-seed runs only.',
                        evidenceLevel: 'fixture',
                }],
        };
}

function makeSeams(): { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number } {
        let clockCount = 0;
        let rngCount = 0;
        return {
                clock: () => {
                        clockCount += 1;
                        return `2026-01-01T00:00:${String(clockCount % 60).padStart(2, '0')}.${String(clockCount).padStart(3, '0')}Z`;
                },
                rng: () => {
                        rngCount += 1;
                        return rngCount.toString(16).padStart(16, '0');
                },
                clockReads: () => clockCount,
                rngReads: () => rngCount,
        };
}

/** The in-memory fs port (the DH-01 port shape; a missing file reads as ENOENT; selective refusals isolate the journey family's own files). */
class MemoryFsPort {
        readonly files = new Map<string, string>();
        refuseAppends = false;
        refuseWrites = false;
        refuseMkdirs = false;
        refuseReads = false;
        /** The selective-mode: when set, only paths containing this fragment refuse (isolates the activation family's own files). */
        selectFragment: string | null = null;
        private refused(path: string, flag: boolean): boolean {
                if (!flag) {
                        return false;
                }
                return this.selectFragment === null || path.includes(this.selectFragment);
        }
        async readFile(path: string): Promise<string> {
                if (this.refused(path, this.refuseReads)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                if (!this.files.has(path)) {
                        throw { code: 'ENOENT', message: `ENOENT: no such file: ${path}` };
                }
                return this.files.get(path) as string;
        }
        async writeFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseWrites)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, text);
        }
        async appendFile(path: string, text: string): Promise<void> {
                if (this.refused(path, this.refuseAppends)) {
                        throw { code: 'EACCES', message: `refused: ${path}` };
                }
                this.files.set(path, (this.files.get(path) ?? '') + text);
        }
        async mkdir(): Promise<void> {
                if (this.refuseMkdirs) {
                        throw { code: 'EACCES', message: 'refused mkdir' };
                }
        }
        dump(path: string): string | undefined {
                return this.files.get(path);
        }
        overwrite(path: string, text: string): void {
                this.files.set(path, text);
        }
        remove(path: string): void {
                this.files.delete(path);
        }
}

/** A mutable catalog fixture (the injected READ-ONLY resolution surface; the battery wires the runtime-minted ids after composeRecords). */
function makeCatalog(): { capabilities: { entryId: string; state: string }[]; workflowIds: string[]; policyIds: string[]; evidenceIds: string[] } {
        return { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] };
}

interface JourneyRig {
        kit: ActivationKit;
        port: MemoryFsPort;
        catalog: ReturnType<typeof makeCatalog>;
        seams: ReturnType<typeof makeSeams>;
        journeyId: string;
        /** the roles this rig composes (THE MULTI-ROLE LAW: the caller supplies them). */
        readonly roles: readonly unknown[];
        /** the caller-supplied record content (THE CONTENT LAW), built to resolve against this rig's roles. */
        readonly content: Record<string, unknown>;
}

async function beginRig(roles: readonly unknown[] = THREE_ROLES, root = 'ws'): Promise<JourneyRig> {
        const seams = makeSeams();
        const port = new MemoryFsPort();
        const catalog = makeCatalog();
        const kit = createActivationKit({ clock: seams.clock, rng: seams.rng, catalog, fsPort: port as unknown as HarnessFsPort, root });
        const begun = await kit.beginJourney();
        if (!begun.ok) {
                throw new Error(`beginJourney refused: ${begun.refusal.reason}`);
        }
        const roleKeys = (roles as { roleKey: string }[]).map((role) => role.roleKey);
        return { kit, port, catalog, seams, journeyId: begun.journey.journeyId, roles, content: fixtureContent(roleKeys) };
}

/** The stage-aware walk: walks ONLY the legs between the journey's current frontier and the target (composable, never double-walking). */
async function walkTo(rig: JourneyRig, target: 'roles' | 'records' | 'proposed' | 'approved' | 'active', content: Record<string, unknown> = rig.content): Promise<string> {
        const inspected = await rig.kit.inspectJourney(rig.journeyId);
        if (!inspected.ok) {
                throw new Error(`inspectJourney refused: ${inspected.refusal.reason}`);
        }
        const frontier = inspected.journey.history[inspected.journey.history.length - 1].leg;
        const legOrder = [null, 'industry-selection', 'company-composition', 'work-type-selection', 'role-composition', 'record-composition', 'proposal', 'validation', 'approval', 'activation'] as const;
        const targetLeg = target === 'roles' ? 'role-composition' : target === 'records' ? 'record-composition' : target === 'proposed' ? 'validation' : target === 'approved' ? 'approval' : 'activation';
        const frontierIndex = legOrder.indexOf(frontier);
        const targetIndex = legOrder.indexOf(targetLeg);
        for (let i = frontierIndex + 1; i <= targetIndex; i += 1) {
                const leg = legOrder[i] as string;
                // THE TWO-LEG OP: proposeHarness walks the proposal AND validation legs in one
                // op (the ledger line lands on the validation leg carrying the proposal leg's
                // evidence) - the walk driver visits the leg without re-driving the op.
                if (leg === 'proposal') {
                        continue;
                }
                const steps: Record<string, () => Promise<{ ok: boolean; refusal?: ActivationKitRefusal }>> = {
                        'industry-selection': () => rig.kit.selectIndustry(rig.journeyId, 'software'),
                        'company-composition': () => rig.kit.composeCompany(rig.journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }),
                        'work-type-selection': () => rig.kit.selectWorkTypes(rig.journeyId, ['analysis', 'drafting', 'review']),
                        'role-composition': () => rig.kit.composeRoles(rig.journeyId, rig.roles),
                        'record-composition': () => rig.kit.composeRecords(rig.journeyId, content),
                        validation: () => rig.kit.proposeHarness(rig.journeyId),
                        approval: () => rig.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver', note: 'the fixture approval' }),
                        activation: () => rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' }),
                };
                // the catalog wires when the record links exist (the emitted refs must resolve at the propose boundary)
                if (leg === 'validation') {
                        const links = (journeyOf(await rig.kit.inspectJourney(rig.journeyId)).recordLinks) as Record<string, string> | null;
                        if (links !== null && !rig.catalog.workflowIds.includes(links.templateId)) {
                                wireCatalog(rig.catalog, links);
                        }
                }
                const outcome = await steps[leg]();
                if (!outcome.ok) {
                        throw new Error(`the leg '${leg}' refused: ${refusalOf(outcome as never).reason}: ${refusalOf(outcome as never).message}`);
                }
        }
        const after = await rig.kit.inspectJourney(rig.journeyId);
        if (!after.ok) {
                throw new Error(`inspectJourney refused: ${after.refusal.reason}`);
        }
        return (after.journey.harnessId ?? after.journey.bindingHarnessId) as string;
}

async function walkToRoles(rig: JourneyRig, roles: readonly unknown[]): Promise<void> {
        const { kit, journeyId } = rig;
        await mustOk(await kit.selectIndustry(journeyId, 'software'));
        await mustOk(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
        await mustOk(await kit.selectWorkTypes(journeyId, ['analysis', 'drafting', 'review']));
        const composed = await kit.composeRoles(journeyId, roles);
        if (!composed.ok) {
                throw new Error(`composeRoles refused: ${composed.refusal.reason}`);
        }
}

async function mustOk(outcome: { ok: boolean; refusal?: ActivationKitRefusal }): Promise<void> {
        if (!outcome.ok) {
                throw new Error(`the leg refused: ${refusalOf(outcome as never).reason}`);
        }
}

function wireCatalog(catalog: ReturnType<typeof makeCatalog>, links: Record<string, string>): void {
        catalog.capabilities.push({ entryId: links.packsId, state: 'approved' });
        catalog.capabilities.push({ entryId: links.bodyId, state: 'enabled' });
        catalog.workflowIds.push(links.templateId);
        catalog.policyIds.push(links.profilesId);
        catalog.evidenceIds.push(links.profilesId, links.benchmarksId);
}

/** The journey's current composed record links (read from the honest evidence record). */
async function linksOf(rig: JourneyRig): Promise<Record<string, string>> {
        const journey = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
        return journey.recordLinks as Record<string, string>;
}

async function walkToProposed(rig: JourneyRig, content: Record<string, unknown> = rig.content): Promise<string> {
        return walkTo(rig, 'proposed', content);
}

async function walkToApproved(rig: JourneyRig, content: Record<string, unknown> = rig.content): Promise<string> {
        return walkTo(rig, 'approved', content);
}

async function walkToActive(rig: JourneyRig, content: Record<string, unknown> = rig.content): Promise<string> {
        return walkTo(rig, 'active', content);
}

function refusalOf(outcome: { ok: boolean; refusal?: ActivationKitRefusal } | { ok: true } | { ok: false; refusal: ActivationKitRefusal }): ActivationKitRefusal {
        if (outcome.ok || outcome.refusal === undefined) {
                throw new Error('expected a refusal outcome');
        }
        return outcome.refusal;
}

function journeyOf(outcome: { ok: boolean; journey?: unknown; refusal?: ActivationKitRefusal }): Record<string, unknown> {
        if (!outcome.ok || outcome.journey === undefined) {
                throw new Error(`expected an ok outcome: ${refusalOf(outcome as never).reason}`);
        }
        return outcome.journey as Record<string, unknown>;
}

/** The record-unchanged law's byte pin: the journey record before == after (canonical bytes). */
async function journeyBytes(kit: ActivationKit, journeyId: string): Promise<string> {
        const inspected = await kit.inspectJourney(journeyId);
        if (!inspected.ok) {
                throw new Error(`inspectJourney refused: ${inspected.refusal.reason}`);
        }
        return serializeActivationJourney(inspected.journey as unknown as Record<string, unknown>);
}

/** THE EVIDENCE-NOT-AUTHORITY LAW's read: the REAL DH-01 record, re-read from the authority's own ledger. */
async function realHarnessRecord(rig: JourneyRig, harnessId: string): Promise<{ state: string; bytes: string; roles: string[] }> {
        const loaded = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
        if (!loaded.ok) {
                throw new Error(`loadHarnessKit refused: ${loaded.refusal.reason}`);
        }
        const inspected = await loaded.kit.inspectHarness(harnessId);
        if (!inspected.ok) {
                throw new Error(`inspectHarness refused: ${inspected.refusal.reason}`);
        }
        return {
                state: inspected.record.state,
                bytes: serializeHarnessRecord(inspected.record),
                roles: inspected.record.descriptor.roles.map((role) => role.roleKey),
        };
}

suite('activationKit · THE FAIL-CLOSED FACTORY', () => {
        test('the options shape is walked (clock / rng / catalog / fsPort / root all required - THE PERSISTENCE-FIRST LAW)', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                for (const [label, options] of [
                        ['non-object', undefined],
                        ['clock', { rng: seams.rng, catalog: makeCatalog(), fsPort: port, root: 'ws' }],
                        ['rng', { clock: seams.clock, catalog: makeCatalog(), fsPort: port, root: 'ws' }],
                        ['catalog', { clock: seams.clock, rng: seams.rng, fsPort: port, root: 'ws' }],
                        ['fsPort', { clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), root: 'ws' }],
                        ['root', { clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port }],
                ] as const) {
                        assert.throws(() => createActivationKit(options as never), TypeError, `the '${label}' station must throw`);
                }
        });

        test('the clock and rng first reads are validated (the injected-seam laws)', () => {
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                const badClock = makeSeams();
                const emptyClock = { clock: () => '', rng: makeSeams().rng, catalog: makeCatalog(), fsPort: port, root: 'ws' };
                assert.throws(() => createActivationKit(emptyClock as never), /clock/);
                const badRng = { clock: badClock.clock, rng: () => 'NOT-HEX!!', catalog: makeCatalog(), fsPort: port, root: 'ws' };
                assert.throws(() => createActivationKit(badRng as never), /rng/);
        });

        test('a malformed catalog snapshot refuses at the factory (the REAL predicate, imported)', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                assert.throws(() => createActivationKit({ clock: seams.clock, rng: seams.rng, catalog: { capabilities: [] }, fsPort: port, root: 'ws' } as never), /isHarnessCatalogSnapshot/);
        });

        test('the fs port must carry all four functions', () => {
                const seams = makeSeams();
                const partial = { readFile: async () => '', appendFile: async () => undefined } as never;
                assert.throws(() => createActivationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: partial, root: 'ws' }), /writeFile/);
        });

        test('THE DETERMINISM LAW: the factory consumes exactly ONE clock read and ONE rng read', () => {
                const seams = makeSeams();
                const port = new MemoryFsPort() as unknown as HarnessFsPort;
                createActivationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port, root: 'ws' });
                assert.equal(seams.clockReads(), 1);
                assert.equal(seams.rngReads(), 1);
        });

        test('ACTIVATION_KIT_REFUSAL_REASONS is the frozen union (the contract domain reasons + the kit-layer extras)', () => {
                assert.deepStrictEqual([...ACTIVATION_KIT_REFUSAL_REASONS].slice(-5), ['E_LEDGER_TORN', 'E_ENVELOPE_MISMATCH', 'ACTIVATION_IO', 'CORRUPT_SEAM', 'UNKNOWN_FILTER']);
                assert.ok((ACTIVATION_KIT_REFUSAL_REASONS as readonly string[]).includes('dangling-ref-at-proposal'));
                assert.ok((ACTIVATION_KIT_REFUSAL_REASONS as readonly string[]).includes('unapproved-capability'));
                assert.ok((ACTIVATION_KIT_REFUSAL_REASONS as readonly string[]).includes('approval-missing'));
        });
});

suite('activationKit · THE COMPLETE JOURNEY HAPPY PATH (the crown)', () => {
        test('the crown: the WHOLE journey through the REAL kits - active at the authority, active in the evidence, three roles on the descriptor', async () => {
                const rig = await beginRig();
                const { kit, journeyId } = rig;
                // the journey legs, in the registry row order
                const begun = journeyOf(await kit.beginJourney()); // (the rig begun it; a second begin mints a second journey)
                assert.equal(begun.stage, 'selection');
                const industry = journeyOf(await kit.selectIndustry(journeyId, 'software'));
                assert.equal(industry.industry, 'software');
                assert.equal(industry.stage, 'selection');
                const company = journeyOf(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
                assert.deepStrictEqual(company.companyProfile, { displayName: 'fixture litigation harness', sizeBand: 'small' });
                const workTypes = journeyOf(await kit.selectWorkTypes(journeyId, ['analysis', 'drafting', 'review']));
                assert.deepStrictEqual(workTypes.workTypes, ['analysis', 'drafting', 'review']);
                const roles = journeyOf(await kit.composeRoles(journeyId, THREE_ROLES));
                assert.equal(roles.stage, 'composed');
                assert.equal((roles.rolesSession as Record<string, unknown>).stage, 'composed');
                assert.equal(((roles.rolesSession as { roles: { roleKey: string }[] }).roles).length, 3);
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                const records = journeyOf(await kit.composeRecords(journeyId, content));
                assert.equal(records.stage, 'composed');
                const links = records.recordLinks as Record<string, string>;
                assert.ok(links.ontologyId.startsWith('flauz:ont:'));
                assert.ok(links.templateId.startsWith('flauz:tpl:'));
                assert.ok(links.bodyId.startsWith('flauz:bod:'));
                assert.ok(links.packsId.startsWith('flauz:pak:'));
                assert.ok(links.profilesId.startsWith('flauz:prf:'));
                assert.ok(links.benchmarksId.startsWith('flauz:ben:'));
                assert.ok((records.bindingHarnessId as string).startsWith('flauz:hrn:'));
                // THE LINEAGE LAW: the binding draft (the provisional composition) is a DIFFERENT harness id than the final proposal
                wireCatalog(rig.catalog, links);
                const proposed = journeyOf(await kit.proposeHarness(journeyId));
                assert.equal(proposed.stage, 'proposed');
                const harnessId = proposed.harnessId as string;
                assert.notEqual(harnessId, records.bindingHarnessId);
                assert.ok(harnessId.startsWith('flauz:hrn:'));
                // the validation evidence: the REAL green FULL outcome
                const validation = proposed.validation as { ok: boolean; mode: string; descriptor: { roles: { roleKey: string }[] } };
                assert.equal(validation.ok, true);
                assert.equal(validation.mode, 'full');
                const approved = journeyOf(await kit.approveHarness(journeyId, { approvedBy: 'fixture-approver', note: 'the fixture approval' }));
                assert.equal(approved.stage, 'approved');
                assert.deepStrictEqual(approved.approval, { approvedBy: 'fixture-approver', note: 'the fixture approval' });
                const active = journeyOf(await kit.activateHarness(journeyId, { activatedBy: 'fixture-activator' }));
                assert.equal(active.stage, 'active');
                assert.deepStrictEqual(active.activation, { activatedBy: 'fixture-activator' });
                assert.equal(active.revision, 9);
                // THE AUTHORITY RE-PROOF: the REAL DH-01 record, re-read from the authority's own ledger
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'active');
                assert.deepStrictEqual(authority.roles, ['analyst', 'reviewer', 'operations-lead']);
                // the journey history walked the full leg order (the proposal leg's evidence rides the propose line)
                const history = active.history as { leg: string | null; toStage: string; op: string }[];
                assert.deepStrictEqual(history.map((note) => note.leg), [null, 'industry-selection', 'company-composition', 'work-type-selection', 'role-composition', 'record-composition', 'validation', 'approval', 'activation']);
                assert.deepStrictEqual(history.map((note) => note.toStage), ['selection', 'selection', 'selection', 'selection', 'composed', 'composed', 'proposed', 'approved', 'active']);
        });

        test('the single-role floor: the whole journey walks green with ONE role (the REAL DH-03 floor)', async () => {
                const rig = await beginRig(ONE_ROLE);
                const harnessId = await walkToActive(rig);
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'active');
                assert.deepStrictEqual(authority.roles, ['analyst']);
                const inspected = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(inspected.stage, 'active');
                assert.equal(((inspected.rolesSession as { roles: unknown[] }).roles).length, 1);
        });

        test('THE LINEAGE LAW: a re-composition is never re-written - the binding draft and the final harness are distinct authority records', async () => {
                const rig = await beginRig();
                const binding = await walkTo(rig, 'records');
                const harnessId = await walkToProposed(rig);
                // both harness ids live in the REAL authority's ledger: the binding draft at draft, the proposal at proposed
                const bindingRecord = await realHarnessRecord(rig, binding);
                assert.equal(bindingRecord.state, 'draft');
                const proposedRecord = await realHarnessRecord(rig, harnessId);
                assert.equal(proposedRecord.state, 'proposed');
        });

        test('THE MULTI-ROLE LAW crown negative: the 33rd role surfaces the REAL DH-03 MAX_ROLES (32) bound verbatim', async () => {
                const rig = await beginRig();
                // walk ONLY the selection legs: the 33-role composition lands at the correct frontier
                await mustOk(await rig.kit.selectIndustry(rig.journeyId, 'software'));
                await mustOk(await rig.kit.composeCompany(rig.journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
                await mustOk(await rig.kit.selectWorkTypes(rig.journeyId, ['analysis', 'drafting', 'review']));
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const roles = Array.from({ length: 33 }, (_value, index) => ({ roleKey: `fixture.role-${String(index + 1).padStart(2, '0')}`, summary: `the fixture role ${index + 1} summary` }));
                const refusal = refusalOf(await rig.kit.composeRoles(rig.journeyId, roles));
                assert.equal(refusal.reason, 'roles-refused');
                assert.equal(refusal.leg, 'role-composition');
                assert.equal(refusal.law, 'THE VERBATIM-CARRY LAW');
                // the REAL DH-03 refusal is carried verbatim (never paraphrased)
                assert.ok(refusal.rolesRefusal !== undefined, 'the real DH-03 refusal is carried complete');
                assert.equal(refusal.rolesRefusal?.reason, 'max-roles-exceeded');
                // THE RECORD-UNCHANGED LAW: the journey record is byte-identical (still at 'selection')
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
                const inspected = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(inspected.stage, 'selection');
        });
});

suite('activationKit · THE LIFECYCLE-CONSTRAINT PINS (the frozen journey-leg order)', () => {
        test('every op before its walked prerequisites refuses premature-leg (THE FORWARD-ONLY LAW)', async () => {
                const rig = await beginRig();
                const { kit, journeyId } = rig;
                // compose-company before industry
                assert.equal(refusalOf(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' })).reason, 'premature-leg');
                // select-work-types before company
                assert.equal(refusalOf(await kit.selectWorkTypes(journeyId, ['analysis'])).reason, 'premature-leg');
                // compose-roles before work-types
                assert.equal(refusalOf(await kit.composeRoles(journeyId, THREE_ROLES)).reason, 'premature-leg');
                // compose-records before roles
                assert.equal(refusalOf(await kit.composeRecords(journeyId, fixtureContent(['analyst']))).reason, 'premature-leg');
                // propose before records
                assert.equal(refusalOf(await kit.proposeHarness(journeyId)).reason, 'premature-leg');
                // approve before validation
                assert.equal(refusalOf(await kit.approveHarness(journeyId, { approvedBy: 'fixture-approver' })).reason, 'premature-leg');
                // activate before approval (the specific law fires at THIS boundary)
                assert.equal(refusalOf(await kit.activateHarness(journeyId, { activatedBy: 'fixture-activator' })).reason, 'approval-missing');
        });

        test('the premature refusal names the leg and the frontier discipline', async () => {
                const rig = await beginRig();
                const refusal = refusalOf(await rig.kit.proposeHarness(rig.journeyId));
                assert.equal(refusal.leg, 'record-composition');
                assert.equal(refusal.law, 'THE FORWARD-ONLY LAW');
                assert.match(refusal.message, /never proposes, never activates/);
        });

        test('the record-unchanged law: a premature leg leaves the journey record byte-identical', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                refusalOf(await rig.kit.proposeHarness(rig.journeyId));
                refusalOf(await rig.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver' }));
                refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' }));
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
        });

        test('every walked leg refuses a re-walk (stale-leg: the journey record never walks back)', async () => {
                const rig = await beginRig();
                const { kit, journeyId } = rig;
                await walkTo(rig, 'records');
                const links = await linksOf(rig);
                wireCatalog(rig.catalog, links);
                await walkToProposed(rig, fixtureContent(['analyst', 'reviewer', 'operations-lead']));
                // the walked selection legs
                assert.equal(refusalOf(await kit.selectIndustry(journeyId, 'software')).reason, 'stale-leg');
                assert.equal(refusalOf(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' })).reason, 'stale-leg');
                assert.equal(refusalOf(await kit.selectWorkTypes(journeyId, ['analysis'])).reason, 'stale-leg');
                assert.equal(refusalOf(await kit.composeRoles(journeyId, THREE_ROLES)).reason, 'stale-leg');
                assert.equal(refusalOf(await kit.composeRecords(journeyId, fixtureContent(['analyst']))).reason, 'stale-leg');
                assert.equal(refusalOf(await kit.proposeHarness(journeyId)).reason, 'stale-leg');
        });

        test("'active' is TERMINAL for the journey record (a changed journey is a NEW journey id)", async () => {
                const rig = await beginRig();
                const { kit, journeyId } = rig;
                const harnessId = await walkToActive(rig, fixtureContent(['analyst', 'reviewer', 'operations-lead']));
                for (const [op, payload] of [
                        ['selectIndustry', 'software'],
                        ['composeCompany', { displayName: 'fixture litigation harness', sizeBand: 'small' }],
                        ['selectWorkTypes', ['analysis']],
                        ['composeRoles', THREE_ROLES],
                        ['composeRecords', fixtureContent(['analyst'])],
                        ['proposeHarness', null],
                        ['approveHarness', { approvedBy: 'fixture-approver' }],
                        ['activateHarness', { activatedBy: 'fixture-activator' }],
                ] as const) {
                        const outcome = await (kit as unknown as Record<string, (id: unknown, payload: unknown) => Promise<JourneyOutcome>>)[op](journeyId, payload);
                        assert.equal(refusalOf(outcome).reason, 'stale-leg', `the op '${op}' must refuse stale-leg after activation`);
                }
                // THE REAL LAW re-proven through the journey: the authority record stays active
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'active');
        });

        test('the second begin mints a SECOND journey (the journey lineage law)', async () => {
                const rig = await beginRig();
                const second = await rig.kit.beginJourney();
                assert.ok(second.ok);
                assert.notEqual(second.journey.journeyId, rig.journeyId);
                const listed = await rig.kit.listJourneys();
                assert.ok(listed.ok);
                assert.equal(listed.journeys.length, 2);
        });

        test("the real retired-terminal law re-proven through the journey: a post-activation retirement lands in the REAL kit alone and the journey evidence never overrides it", async () => {
                const rig = await beginRig();
                const harnessId = await walkToActive(rig, fixtureContent(['analyst', 'reviewer', 'operations-lead']));
                // a post-journey retirement through the REAL authority (the only lifecycle authority)
                const loaded = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(loaded.ok);
                const retired = await loaded.kit.advanceHarness(harnessId, 'retired', { retiredBy: 'fixture-retirer' });
                assert.ok(retired.ok);
                assert.equal(retired.record.state, 'retired');
                // 'retired' is TERMINAL (the real law, re-proven at the authority's own boundary)
                const refused = await loaded.kit.advanceHarness(harnessId, 'active', { activatedBy: 'fixture-activator' });
                assert.ok(!refused.ok);
                assert.equal(refused.refusal.reason, 'ILLEGAL_TRANSITION');
                // THE EVIDENCE-NOT-AUTHORITY LAW: the journey record stays at 'active' (the honest
                // evidence of the run; the post-activation lifecycle belongs to the REAL kit alone)
                const journey = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(journey.stage, 'active');
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'retired');
        });
});

suite('activationKit · THE FAIL-CLOSED BRANCHES (the row\'s core acceptance)', () => {
        test('dangling-ref-at-proposal: an unresolved ref refuses the REAL boundary; the REAL record stays at draft; the journey is unchanged; NO path to active', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'records');
                const links = await linksOf(rig);
                // the catalog stays EMPTY: every emitted ref dangles at the real propose boundary
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.proposeHarness(rig.journeyId));
                assert.equal(refusal.reason, 'dangling-ref-at-proposal');
                assert.equal(refusal.leg, 'validation');
                assert.equal(refusal.law, 'THE NO-DANGLING-REF LAW');
                assert.ok(refusal.onboardingRefusal !== undefined, 'the REAL DH-02 refusal is carried verbatim');
                // THE VERBATIM-CARRY LAW: the onboarding refusal carries the real DH-01 VALIDATION_REFUSED refusal carrying the typed rejection table
                assert.equal(refusal.onboardingRefusal?.reason, 'harness-kit-refused');
                assert.equal(refusal.onboardingRefusal?.harnessRefusal?.reason, 'VALIDATION_REFUSED');
                const carried = refusal.onboardingRefusal?.harnessRefusal?.validation;
                assert.ok(carried !== undefined && !carried.ok && Array.isArray(carried.rejections) && carried.rejections.length > 0, 'the complete typed rejection table is carried verbatim');
                // the record-unchanged law (both records)
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
                const finalDraft = (journeyOf(await rig.kit.inspectJourney(rig.journeyId)).bindingHarnessId) as string;
                const authority = await realHarnessRecord(rig, finalDraft);
                assert.equal(authority.state, 'draft');
                // THE FAIL-CLOSED LAW: after the unsafe refusal, activateHarness ALSO refuses (no approval leg, no approved record)
                const activationRefusal = refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' }));
                assert.equal(activationRefusal.reason, 'approval-missing');
                void links;
        });

        test('unapproved-capability: a capability below approved/enabled/available refuses the approve boundary; the record stays proposed; NO path to active', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                await walkTo(rig, 'records', content);
                const links = await linksOf(rig);
                wireCatalog(rig.catalog, links);
                await walkToProposed(rig, content);
                const harnessId = (journeyOf(await rig.kit.inspectJourney(rig.journeyId)).harnessId) as string;
                // the capability registry flips the pack capability below the binding law between proposal and approval
                const packCapability = rig.catalog.capabilities.find((entry) => entry.entryId === links.packsId) as { state: string };
                packCapability.state = 'requested';
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver' }));
                assert.equal(refusal.reason, 'unapproved-capability');
                assert.equal(refusal.leg, 'approval');
                assert.equal(refusal.law, 'THE CATALOG-BINDING LAW');
                assert.ok(refusal.harnessRefusal !== undefined, 'the REAL DH-01 refusal is carried verbatim');
                assert.equal(refusal.harnessRefusal?.reason, 'CATALOG_BINDING_REFUSED');
                assert.match(refusal.message, /NEVER approved over an unapproved capability/);
                // the record-unchanged law (both records)
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'proposed');
                // THE FAIL-CLOSED LAW: the activation boundary also refuses (the approval leg never walked)
                assert.equal(refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' })).reason, 'approval-missing');
        });

        test('catalog-binding-refused: a capability REMOVED from the catalog is the fail-closed escalation (the absent-refusal)', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                await walkTo(rig, 'records', content);
                const links = await linksOf(rig);
                wireCatalog(rig.catalog, links);
                await walkToProposed(rig, content);
                const harnessId = (journeyOf(await rig.kit.inspectJourney(rig.journeyId)).harnessId) as string;
                const index = rig.catalog.capabilities.findIndex((entry) => entry.entryId === links.packsId);
                rig.catalog.capabilities.splice(index, 1);
                const refusal = refusalOf(await rig.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver' }));
                assert.equal(refusal.reason, 'catalog-binding-refused');
                assert.equal(refusal.leg, 'approval');
                assert.equal(refusal.harnessRefusal?.reason, 'CATALOG_BINDING_REFUSED');
                assert.match(refusal.message, /ABSENT from the catalog snapshot/);
                // the records unchanged
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'proposed');
                assert.equal(refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' })).reason, 'approval-missing');
        });

        test('approval-missing: activation without the approval leg refuses (THE APPROVAL-BEFORE-ACTIVATION LAW)', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                await walkToProposed(rig, content);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' }));
                assert.equal(refusal.reason, 'approval-missing');
                assert.equal(refusal.leg, 'activation');
                assert.equal(refusal.law, 'THE APPROVAL-BEFORE-ACTIVATION LAW');
                assert.match(refusal.message, /no approval input, no activation/);
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
        });

        test('malformed-decision: the REAL DH-01 kit refuses the caller-supplied approval decision; the refusal is carried verbatim', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                const harnessId = await walkToProposed(rig, content);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.approveHarness(rig.journeyId, { approver: 'not-the-shape' }));
                assert.equal(refusal.reason, 'malformed-decision');
                assert.equal(refusal.leg, 'approval');
                assert.equal(refusal.harnessRefusal?.reason, 'MALFORMED_DECISION');
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'proposed');
                // the activation boundary also refuses
                assert.equal(refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' })).reason, 'approval-missing');
        });

        test('malformed-decision at the activation boundary: the { activatedBy } shape is enforced by the REAL kit', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                const harnessId = await walkToApproved(rig, content);
                const refusal = refusalOf(await rig.kit.activateHarness(rig.journeyId, { approvedBy: 'wrong-shape' }));
                assert.equal(refusal.reason, 'malformed-decision');
                assert.equal(refusal.leg, 'activation');
                assert.equal(refusal.harnessRefusal?.reason, 'MALFORMED_DECISION');
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'approved');
        });

        test('malformed-catalog: a malformed authority snapshot refuses at the boundary (a malformed authority resolves nothing)', async () => {
                const rig = await beginRig();
                await walkTo(rig, 'records');
                const links = await linksOf(rig);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                // the shared catalog snapshot drifts malformed (a duplicated entryId)
                rig.catalog.capabilities.push({ entryId: links.packsId, state: 'approved' }, { entryId: links.packsId, state: 'enabled' });
                const refusal = refusalOf(await rig.kit.proposeHarness(rig.journeyId));
                assert.equal(refusal.reason, 'malformed-catalog');
                assert.equal(refusal.leg, 'validation');
                assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                assert.match(refusal.message, /malformed authority resolves nothing/);
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
        });

        test('malformed-catalog fires at the approval and activation boundaries too', async () => {
                const rig = await beginRig();
                await walkToProposed(rig);
                const original = rig.catalog.capabilities;
                const malformed = { capabilities: 'nope' } as unknown;
                (rig.catalog as { capabilities: unknown }).capabilities = malformed;
                assert.equal(refusalOf(await rig.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver' })).reason, 'malformed-catalog');
                // restore the wired catalog: the walk continues green (the refusal corrupted nothing)
                (rig.catalog as { capabilities: unknown }).capabilities = original;
                await walkToApproved(rig);
                (rig.catalog as { capabilities: unknown }).capabilities = malformed;
                assert.equal(refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' })).reason, 'malformed-catalog');
        });

        test('unsafe-proposal: an EXTERNAL advance of the real record refuses the journey activation (THE EVIDENCE-NOT-AUTHORITY LAW)', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                const harnessId = await walkToApproved(rig, content);
                // another actor activates the harness directly through the REAL authority (the only lifecycle authority)
                const loaded = await loadHarnessKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(loaded.ok);
                const advanced = await loaded.kit.advanceHarness(harnessId, 'active', { activatedBy: 'external-actor' });
                assert.ok(advanced.ok);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' }));
                assert.equal(refusal.reason, 'unsafe-proposal');
                assert.equal(refusal.leg, 'activation');
                assert.equal(refusal.law, 'THE FAIL-CLOSED LAW');
                assert.match(refusal.message, /the authority's own state is the truth/);
                // the journey evidence NEVER overrides the authority: the journey record is unchanged at approved
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'active');
        });

        test('THE INCOMPLETE-COMPOSITION LAW: zero roles refuses at the REAL DH-03 floor (never at the boundary)', async () => {
                const rig = await beginRig();
                // walk ONLY the selection legs: the zero-role composition lands at the correct frontier
                await mustOk(await rig.kit.selectIndustry(rig.journeyId, 'software'));
                await mustOk(await rig.kit.composeCompany(rig.journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
                await mustOk(await rig.kit.selectWorkTypes(rig.journeyId, ['analysis', 'drafting', 'review']));
                const refusal = refusalOf(await rig.kit.composeRoles(rig.journeyId, []));
                assert.equal(refusal.reason, 'roles-refused');
                assert.equal(refusal.leg, 'role-composition');
                assert.ok(refusal.rolesRefusal !== undefined, 'the REAL DH-03 finalize refusal is carried verbatim');
                // the journey never left the selection stage: the record-composition leg never opens
                assert.equal(refusalOf(await rig.kit.composeRecords(rig.journeyId, fixtureContent([]))).reason, 'premature-leg');
                assert.equal(refusalOf(await rig.kit.proposeHarness(rig.journeyId)).reason, 'premature-leg');
        });

        test('unknown-journey: a fabricated or malformed id fails closed at every op (the DH-01 NOT_FOUND discipline)', async () => {
                const rig = await beginRig();
                for (const [op, payload] of [
                        ['selectIndustry', 'software'],
                        ['composeCompany', { displayName: 'fixture litigation harness', sizeBand: 'small' }],
                        ['selectWorkTypes', ['analysis']],
                        ['composeRoles', THREE_ROLES],
                        ['composeRecords', fixtureContent(['analyst'])],
                        ['proposeHarness', null],
                        ['approveHarness', { approvedBy: 'fixture-approver' }],
                        ['activateHarness', { activatedBy: 'fixture-activator' }],
                        ['inspectJourney', null],
                ] as const) {
                        for (const id of ['flauz:jrn:ffffffffffffffff', 'not-an-id', 7, null]) {
                                const outcome = await (rig.kit as unknown as Record<string, (id: unknown, payload: unknown) => Promise<JourneyOutcome>>)[op](id, payload);
                                assert.equal(refusalOf(outcome).reason, 'unknown-journey', `the op '${op}' must refuse the id ${JSON.stringify(id)}`);
                        }
                }
        });

        test('onboarding-refused: the REAL DH-02 refusals ride verbatim (industry / company / work-types)', async () => {
                const rig = await beginRig();
                const { kit, journeyId } = rig;
                const before = await journeyBytes(kit, journeyId);
                const industry = refusalOf(await kit.selectIndustry(journeyId, 'aerospace'));
                assert.equal(industry.reason, 'onboarding-refused');
                assert.equal(industry.leg, 'industry-selection');
                assert.ok(industry.onboardingRefusal !== undefined, 'the REAL DH-02 refusal is carried verbatim');
                // walk the frontier forward, then refuse each next leg through the real kit
                await mustOk(await kit.selectIndustry(journeyId, 'software'));
                const company = refusalOf(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'giant' }));
                assert.equal(company.reason, 'onboarding-refused');
                assert.equal(company.leg, 'company-composition');
                assert.ok(company.onboardingRefusal !== undefined, 'the REAL DH-02 refusal is carried verbatim');
                await mustOk(await kit.composeCompany(journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
                const workTypes = refusalOf(await kit.selectWorkTypes(journeyId, ['teleportation']));
                assert.equal(workTypes.reason, 'onboarding-refused');
                assert.equal(workTypes.leg, 'work-type-selection');
                assert.ok(workTypes.onboardingRefusal !== undefined, 'the REAL DH-02 refusal is carried verbatim');
                // the journey record carries the two green legs only (the refusals never landed)
                const inspected = journeyOf(await kit.inspectJourney(journeyId));
                assert.equal(inspected.stage, 'selection');
                assert.equal(inspected.industry, 'software');
                assert.equal((inspected.history as unknown[]).length, 3);
        });

        test('record-refused: the record-content walk refuses before any real kit is driven (THE CONTENT LAW)', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const badContent = fixtureContent(['analyst']);
                (badContent.terms as Record<string, unknown>[])[0] = { term: 7, definition: 'the definition' };
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, badContent));
                assert.equal(refusal.reason, 'record-refused');
                assert.equal(refusal.leg, 'record-composition');
                assert.ok(refusal.contentRejection !== undefined, 'the contract-level rejection is carried');
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
        });

        test('record-refused: THE TERM-RESOLUTION LAW - a ghost termRef refuses the REAL DH-05 finalize verbatim', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                (content.tasks as Record<string, unknown>[])[0] = { taskKey: 'survey', summary: 'Survey the incoming signal.', termRefs: ['ghost-term'] };
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, content));
                assert.equal(refusal.reason, 'record-refused');
                assert.equal(refusal.leg, 'record-composition');
                assert.ok(refusal.recordRefusal !== undefined, 'the REAL DH-05 refusal is carried verbatim');
                // the journey record is unchanged (the leg never landed)
                const inspected = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(inspected.stage, 'composed');
                assert.equal(inspected.recordLinks, null);
        });

        test('record-refused: THE ROLE-RESOLUTION LAW - a ghost roleRef refuses the REAL DH-06 finalize verbatim', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const content = fixtureContent(['ghost-role']);
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, content));
                assert.equal(refusal.reason, 'record-refused');
                assert.ok(refusal.recordRefusal !== undefined, 'the REAL DH-06 refusal is carried verbatim');
        });

        test('record-refused: THE BODY-RESOLUTION LAW - a ghost bodyRef refuses the REAL DH-07 finalize verbatim', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                (content.packs as Record<string, unknown>[])[0] = { packKey: 'core', summary: 'The core pack.', bodyRefs: ['ghost-body'] };
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, content));
                assert.equal(refusal.reason, 'record-refused');
                assert.ok(refusal.recordRefusal !== undefined, 'the REAL DH-07 refusal is carried verbatim');
        });

        test('record-refused: THE SCENARIO-BINDING LAW - a fabricated scenario id refuses the OWNING family validator verbatim', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                (content.benchmarks as Record<string, unknown>[])[0] = {
                        ...(content.benchmarks as Record<string, unknown>[])[0],
                        scenarioRefs: ['scenario-se-fabricated-ghost'],
                };
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, content));
                assert.equal(refusal.reason, 'record-refused');
                assert.equal(refusal.leg, 'record-composition');
                // the contract-level content walk surfaces the OWNING DH-09 family's COMPLETE typed rejection table verbatim
                assert.ok(refusal.contentRejection !== undefined, 'the contract-level rejection is carried');
                assert.ok(Array.isArray(refusal.contentRejection?.familyRejections) && (refusal.contentRejection?.familyRejections?.length ?? 0) > 0, 'the REAL DH-09 rejection table is carried verbatim');
                // the journey record is unchanged (the leg never landed)
                const inspected = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(inspected.recordLinks, null);
        });

        test('record-refused: THE AUTHORITY-BINDING LAW - a fabricated permissionRef refuses the OWNING family validator verbatim', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                (content.profiles as Record<string, unknown>[])[0] = {
                        ...(content.profiles as Record<string, unknown>[])[0],
                        permissionRefs: ['not-a-real-permission'],
                };
                const refusal = refusalOf(await rig.kit.composeRecords(rig.journeyId, content));
                assert.equal(refusal.reason, 'record-refused');
                assert.equal(refusal.leg, 'record-composition');
                // the contract-level content walk surfaces the OWNING DH-08 family's COMPLETE typed rejection table verbatim
                assert.ok(refusal.contentRejection !== undefined, 'the contract-level rejection is carried');
                assert.ok(Array.isArray(refusal.contentRejection?.familyRejections) && (refusal.contentRejection?.familyRejections?.length ?? 0) > 0, 'the REAL DH-08 rejection table is carried verbatim');
        });

        test('the roles payload must be an array (the DH-03 carrier discipline)', async () => {
                const rig = await beginRig();
                // walk ONLY the selection legs: the malformed carrier lands at the correct frontier
                await mustOk(await rig.kit.selectIndustry(rig.journeyId, 'software'));
                await mustOk(await rig.kit.composeCompany(rig.journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' }));
                await mustOk(await rig.kit.selectWorkTypes(rig.journeyId, ['analysis', 'drafting', 'review']));
                const refusal = refusalOf(await rig.kit.composeRoles(rig.journeyId, 'nope'));
                assert.equal(refusal.reason, 'malformed-record');
                assert.equal(refusal.leg, 'role-composition');
                assert.match(refusal.message, /must be an array/);
        });

        test('CORRUPT_SEAM: a corrupt rng mid-op refuses; a duplicate journey id refuses; an empty clock read refuses', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                // a rng that goes bad right after the factory read: the journey's own id mint
                // at beginJourney is the first mid-op read of the seam (the real kits' own
                // factory reads follow only after the journey id mints green)
                let rngBudget = 1;
                const flakyRng = () => {
                        rngBudget -= 1;
                        if (rngBudget < 0) {
                                return 'NOT-HEX';
                        }
                        return (1000 - rngBudget).toString(16).padStart(16, '0');
                };
                const kit = createActivationKit({ clock: seams.clock, rng: flakyRng, catalog: makeCatalog(), fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(refusalOf(await kit.beginJourney()).reason, 'CORRUPT_SEAM');
                // a duplicate journey id (the same rng forever)
                const stickySeams = makeSeams();
                const stickyRig = await beginRigWith(() => '0000000000000001', stickySeams);
                assert.equal(refusalOf(await stickyRig.kit.beginJourney()).reason, 'CORRUPT_SEAM');
                // an empty clock read mid-op: the journey's own clock read fires the typed
                // refusal (beginJourney consumes FIVE clock reads: the factory, the onboarding
                // factory, the inner DH-01 factory, the beginSession note and the journey's
                // own begin note; the 6th read - the selectIndustry leg - returns the empty
                // reading and the REAL DH-02 kit's own CORRUPT_SEAM refusal rides verbatim)
                const emptyClockSeams = makeSeams();
                let clockBudget = 5;
                const emptyClock = () => {
                        clockBudget -= 1;
                        return clockBudget < 0 ? '' : '2026-01-01T00:00:00.000Z';
                };
                const emptyRig = await beginRigWith(undefined, { clock: emptyClock, rng: emptyClockSeams.rng, clockReads: () => 0, rngReads: () => 0 });
                const refused = await emptyRig.kit.selectIndustry(emptyRig.journeyId, 'software');
                assert.ok(!refused.ok, 'the empty clock read must refuse the leg');
                // THE VERBATIM-CARRY LAW: the REAL DH-02 kit's own CORRUPT_SEAM refusal rides verbatim
                const carried = refusalOf(refused);
                assert.equal(carried.reason, 'onboarding-refused');
                assert.equal(carried.onboardingRefusal?.reason, 'CORRUPT_SEAM');
        });

        async function beginRigWith(rngOverride: (() => string) | undefined, seams: { clock: () => string; rng: () => string; clockReads: () => number; rngReads: () => number }): Promise<JourneyRig> {
                const port = new MemoryFsPort();
                const catalog = makeCatalog();
                const kit = createActivationKit({ clock: seams.clock, rng: rngOverride ?? seams.rng, catalog, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                const begun = await kit.beginJourney();
                if (!begun.ok) {
                        throw new Error(`beginJourney refused: ${begun.refusal.reason}`);
                }
                return { kit, port, catalog, seams, journeyId: begun.journey.journeyId } as JourneyRig;
        }
});

suite('activationKit · the persistence mirror (PIN-2)', () => {
        test('the ledger and the envelope land lazily at the distinct family paths; the line carries the frozen fourteen-key schema', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                const catalog = makeCatalog();
                const kit = createActivationKit({ clock: seams.clock, rng: seams.rng, catalog, fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                // LAZY: nothing lands before the first persisted op
                assert.equal(port.dump(`ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`), undefined);
                assert.equal(port.dump(`ws/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`), undefined);
                const begun = await kit.beginJourney();
                assert.ok(begun.ok);
                const ledger = port.dump(`ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`);
                assert.ok(ledger !== undefined && ledger.endsWith('\n'));
                assert.equal(ledger.split('\n').length - 1, 1);
                const line = JSON.parse(ledger.split('\n')[0]) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(line), [...ACTIVATION_LEDGER_LINE_SCHEMA_KEYS]);
                assert.equal(line.seq, 1);
                assert.equal(line.contractVersion, ACTIVATION_CONTRACTS_VERSION);
                assert.equal(line.op, 'begin-journey');
                assert.equal(line.leg, null);
                assert.equal(line.payload, null);
                const envelope = port.dump(`ws/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`);
                assert.ok(envelope !== undefined);
                const parsed = JSON.parse(envelope) as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(parsed), ['contractVersion', 'seq', 'journeys']);
                assert.equal(parsed.seq, 1);
                assert.equal((parsed.journeys as unknown[]).length, 1);
        });

        test('the propose line carries the validation column and the review-composition payload (the proposal leg\'s evidence)', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                await walkToProposed(rig, content);
                const ledger = rig.port.dump(`ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`) as string;
                const lines = ledger.split('\n').filter((line) => line.length > 0);
                const proposeLine = JSON.parse(lines[6]) as Record<string, unknown>;
                assert.equal(proposeLine.op, 'propose-harness');
                assert.equal(proposeLine.leg, 'validation');
                assert.equal(proposeLine.fromStage, 'composed');
                assert.equal(proposeLine.toStage, 'proposed');
                const payload = proposeLine.payload as Record<string, unknown>;
                assert.deepStrictEqual(Object.keys(payload), ['roles', 'capabilityRefs', 'workflowRefs', 'policyRefs', 'evidenceRefs']);
                const validation = proposeLine.validation as Record<string, unknown>;
                assert.equal(validation.ok, true);
                assert.equal(validation.mode, 'full');
        });

        test('restart determinism: reload reproduces the journey state byte-for-byte and the walk continues', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                const harnessId = await walkToProposed(rig, content);
                const beforeBytes = await journeyBytes(rig.kit, rig.journeyId);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                assert.equal(await journeyBytes(reloaded.kit, rig.journeyId), beforeBytes);
                // the walk CONTINUES through the reloaded kit (the real kits reopen from their own ledgers)
                const approved = await reloaded.kit.approveHarness(rig.journeyId, { approvedBy: 'fixture-approver' });
                assert.ok(approved.ok);
                const activated = await reloaded.kit.activateHarness(rig.journeyId, { activatedBy: 'fixture-activator' });
                assert.ok(activated.ok);
                assert.equal(activated.journey.stage, 'active');
                const authority = await realHarnessRecord(rig, harnessId);
                assert.equal(authority.state, 'active');
        });

        test('reload at an earlier stage: the mid-walk restart continues green', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok);
                const composed = await reloaded.kit.composeRecords(rig.journeyId, fixtureContent(['analyst', 'reviewer', 'operations-lead']));
                assert.ok(composed.ok);
                wireCatalog(rig.catalog, composed.journey.recordLinks as unknown as Record<string, string>);
                const proposed = await reloaded.kit.proposeHarness(rig.journeyId);
                assert.ok(proposed.ok);
                assert.equal(proposed.journey.stage, 'proposed');
        });

        test('E_LEDGER_TORN: a torn last line refuses the reload (never a silent partial replay)', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                const ledger = rig.port.dump(`ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`) as string;
                rig.port.overwrite(`ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`, `${ledger.slice(0, -20)}`);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'E_LEDGER_TORN');
                assert.match(reloaded.refusal.message, /replayActivationLedger/);
        });

        test('E_LEDGER_TORN: the fresh-kit guard - a fresh kit never appends over an existing non-empty ledger', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                const fresh = createActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                const refusal = refusalOf(await fresh.beginJourney());
                assert.equal(refusal.reason, 'E_LEDGER_TORN');
                assert.match(refusal.message, /reopen with loadActivationKit/);
        });

        test('E_LEDGER_TORN: a line with a drifted seq / an unknown op / a foreign contract version refuses the replay', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                const path = `ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
                const lines = (rig.port.dump(path) as string).split('\n').filter((line) => line.length > 0);
                // drifted seq
                const drifted = JSON.parse(lines[1]) as Record<string, unknown>;
                drifted.seq = 9;
                rig.port.overwrite(path, `${lines[0]}\n${JSON.stringify(drifted)}\n`);
                const first = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(first.ok ? 'ok' : first.refusal.reason, 'E_LEDGER_TORN');
                // unknown op
                const unknownOp = JSON.parse(lines[1]) as Record<string, unknown>;
                unknownOp.op = 'inspect-journey';
                rig.port.overwrite(path, `${lines[0]}\n${JSON.stringify(unknownOp)}\n`);
                const second = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(second.ok ? 'ok' : second.refusal.reason, 'E_LEDGER_TORN');
                // foreign contract version
                const foreign = JSON.parse(lines[1]) as Record<string, unknown>;
                foreign.contractVersion = '2.0.0';
                rig.port.overwrite(path, `${lines[0]}\n${JSON.stringify(foreign)}\n`);
                const third = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.equal(third.ok ? 'ok' : third.refusal.reason, 'E_LEDGER_TORN');
        });

        test('E_LEDGER_TORN: an illegal stage edge refuses the replay (the contract machine re-proven from the ledger alone)', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                const path = `ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
                const lines = (rig.port.dump(path) as string).split('\n').filter((line) => line.length > 0);
                const tampered = JSON.parse(lines[1]) as Record<string, unknown>;
                tampered.toStage = 'composed';
                rig.port.overwrite(path, `${lines[0]}\n${JSON.stringify(tampered)}\n`);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.match(reloaded.refusal.message, /leg<->stage table|ILLEGAL/);
        });

        test('THE INCOMPLETE-COMPOSITION LAW re-proven from the ledger alone: a compose-records line that binds NO draft refuses the replay', async () => {
                const rig = await beginRig();
                await walkToProposed(rig);
                const path = `ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
                const lines = (rig.port.dump(path) as string).split('\n').filter((line) => line.length > 0);
                // a torn compose-records line: the payload survives the family walks but the
                // binding draft column is torn away - the fold binds NO draft, so the propose
                // line's INCOMPLETE-COMPOSITION station fires from the ledger alone
                const torn = JSON.parse(lines[5]) as Record<string, unknown>;
                torn.harnessId = null;
                rig.port.overwrite(path, [...lines.slice(0, 5), JSON.stringify(torn), ...lines.slice(6)].join('\n') + '\n');
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'E_LEDGER_TORN');
                assert.match(reloaded.refusal.message, /INCOMPLETE-COMPOSITION/);
        });

        test('THE APPROVAL-BEFORE-ACTIVATION LAW re-proven from the ledger alone: an activate line without the approve line is torn', async () => {
                const rig = await beginRig();
                await walkToActive(rig);
                const path = `ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
                const lines = (rig.port.dump(path) as string).split('\n').filter((line) => line.length > 0);
                // drop the approve line and re-sequence the activate line in its place: the
                // replay refuses the activation boundary - the frontier discipline fires
                // first (the approval leg never walked) and there is NO path from an
                // approval-less ledger to a reopened active journey
                const crafted = JSON.parse(lines[8]) as Record<string, unknown>;
                crafted.seq = 8;
                rig.port.overwrite(path, [...lines.slice(0, 7), JSON.stringify(crafted)].join('\n') + '\n');
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'E_LEDGER_TORN');
                assert.match(reloaded.refusal.message, /activate-harness/);
                assert.match(reloaded.refusal.message, /THE FORWARD-ONLY LAW re-proven from the ledger alone/);
        });

        test('E_LEDGER_TORN: a tampered payload refuses the replay (the REAL family validators re-prove the line bytes)', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                const path = `ws/${ACTIVATION_LEDGER_RELATIVE_PATH}`;
                const lines = (rig.port.dump(path) as string).split('\n').filter((line) => line.length > 0);
                const tampered = JSON.parse(lines[1]) as Record<string, unknown>;
                tampered.payload = { industry: 'aerospace' };
                rig.port.overwrite(path, `${lines[0]}\n${JSON.stringify(tampered)}\n`);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.match(reloaded.refusal.message, /DH-02 walk/);
        });

        test('E_ENVELOPE_MISMATCH: a divergent envelope refuses the reload (never silently rebuilt)', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                rig.port.overwrite(`ws/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`, '{"contractVersion":"1.0.0","seq":2,"journeys":[]}');
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'E_ENVELOPE_MISMATCH');
                assert.match(reloaded.refusal.message, /never silently rebuilt/);
        });

        test('E_ENVELOPE_MISMATCH: a MISSING envelope over a non-empty ledger refuses; a fresh root reopens empty', async () => {
                const rig = await beginRig();
                await rig.kit.selectIndustry(rig.journeyId, 'software');
                rig.port.remove(`ws/${ACTIVATION_ENVELOPE_RELATIVE_PATH}`);
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'E_ENVELOPE_MISMATCH');
                // a fresh root reopens as an empty kit
                const freshPort = new MemoryFsPort();
                const empty = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: makeCatalog(), fsPort: freshPort as unknown as HarnessFsPort, root: 'ws2' });
                assert.ok(empty.ok);
                const listed = await empty.kit.listJourneys();
                assert.ok(listed.ok);
                assert.deepStrictEqual(listed.journeys, []);
        });

        test('ACTIVATION_IO: a refused append leaves NOTHING applied (the ledger is authoritative)', async () => {
                const rig = await beginRig();
                rig.port.selectFragment = 'activation-ops';
                rig.port.refuseAppends = true;
                const before = await journeyBytes(rig.kit, rig.journeyId);
                const refusal = refusalOf(await rig.kit.selectIndustry(rig.journeyId, 'software'));
                assert.equal(refusal.reason, 'ACTIVATION_IO');
                assert.match(refusal.message, /nothing was applied/);
                assert.equal(await journeyBytes(rig.kit, rig.journeyId), before);
        });

        test('ACTIVATION_IO: a refused mkdir at load / a refused read refuses closed', async () => {
                const seams = makeSeams();
                const port = new MemoryFsPort();
                port.refuseMkdirs = true;
                const reloaded = await loadActivationKit({ clock: seams.clock, rng: seams.rng, catalog: makeCatalog(), fsPort: port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!reloaded.ok);
                assert.equal(reloaded.refusal.reason, 'ACTIVATION_IO');
        });

        test('the envelope rewrite failure discloses the applied line (the ledger is authoritative)', async () => {
                const rig = await beginRig();
                rig.port.selectFragment = 'activation-journeys';
                rig.port.refuseWrites = true;
                const refusal = refusalOf(await rig.kit.selectIndustry(rig.journeyId, 'software'));
                assert.equal(refusal.reason, 'ACTIVATION_IO');
                assert.match(refusal.law, /THE FAIL-CLOSED LAW/);
                assert.match(refusal.message, /the ledger line landed/);
                // the line landed: a reload fails closed over the envelope mismatch (the
                // ledger is authoritative; the envelope is behind by one line)
                rig.port.refuseWrites = false;
                const stuck = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(!stuck.ok, 'a reload over the stale envelope must fail closed');
                assert.equal(stuck.refusal.reason, 'E_ENVELOPE_MISMATCH');
                // the next op rewrites the envelope: the mismatch resolves (the journey
                // record was committed in-memory; the leg's successor walks green)
                const composed = await rig.kit.composeCompany(rig.journeyId, { displayName: 'fixture litigation harness', sizeBand: 'small' });
                assert.ok(composed.ok, 'the next op walks green over the committed line');
                const reloaded = await loadActivationKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reloaded.ok, 'the re-appended envelope (the next op rewrites it) resolves the mismatch');
        });
});

suite('activationKit · listJourneys and the filters', () => {
        test('the journeys list in id order; the stage and industry filters narrow honestly', async () => {
                const rig = await beginRig();
                const content = fixtureContent(['analyst', 'reviewer', 'operations-lead']);
                await walkToActive(rig, content);
                const second = await rig.kit.beginJourney();
                assert.ok(second.ok);
                await rig.kit.selectIndustry(second.journey.journeyId, 'legal');
                const listed = await rig.kit.listJourneys();
                assert.ok(listed.ok);
                assert.equal(listed.journeys.length, 2);
                assert.deepStrictEqual(listed.journeys.map((journey) => journey.stage).sort(), ['active', 'selection']);
                const byStage = await rig.kit.listJourneys({ stage: 'active' });
                assert.ok(byStage.ok);
                assert.equal(byStage.journeys.length, 1);
                assert.equal(byStage.journeys[0].journeyId, rig.journeyId);
                const byIndustry = await rig.kit.listJourneys({ industry: 'legal' });
                assert.ok(byIndustry.ok);
                assert.equal(byIndustry.journeys.length, 1);
                assert.equal(byIndustry.journeys[0].journeyId, second.journey.journeyId);
        });

        test('UNKNOWN_FILTER: an unknown field or a non-member value refuses', async () => {
                const rig = await beginRig();
                assert.equal(refusalOf(await rig.kit.listJourneys({ nope: 1 })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await rig.kit.listJourneys({ stage: 'hatched' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await rig.kit.listJourneys({ industry: 'aerospace' })).reason, 'UNKNOWN_FILTER');
                assert.equal(refusalOf(await rig.kit.listJourneys('nope' as never)).reason, 'UNKNOWN_FILTER');
        });

        test('inspectJourney returns the honest deep copy (the record the caller may not mutate)', async () => {
                const rig = await beginRig();
                const first = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                (first as Record<string, unknown>).stage = 'active';
                const second = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.equal(second.stage, 'selection');
        });
});

suite('activationKit · THE DISPOSE LAW', () => {
        test('every operation after dispose rejects with the typed disposed refusal', async () => {
                const rig = await beginRig();
                rig.kit.dispose();
                for (const [op, payload] of [
                        ['beginJourney', null],
                        ['selectIndustry', 'software'],
                        ['composeCompany', { displayName: 'fixture litigation harness', sizeBand: 'small' }],
                        ['selectWorkTypes', ['analysis']],
                        ['composeRoles', THREE_ROLES],
                        ['composeRecords', fixtureContent(['analyst'])],
                        ['proposeHarness', null],
                        ['approveHarness', { approvedBy: 'fixture-approver' }],
                        ['activateHarness', { activatedBy: 'fixture-activator' }],
                        ['inspectJourney', null],
                        ['listJourneys', null],
                ] as const) {
                        const outcome = await (rig.kit as unknown as Record<string, (id: unknown, payload: unknown) => Promise<JourneyOutcome | { ok: boolean; refusal?: ActivationKitRefusal }>>)[op](payload === null ? undefined : rig.journeyId, payload);
                        assert.equal(refusalOf(outcome as never).reason, 'disposed', `the op '${op}' must refuse disposed`);
                }
        });

        test('dispose is idempotent', async () => {
                const rig = await beginRig();
                rig.kit.dispose();
                rig.kit.dispose();
                assert.equal(refusalOf(await rig.kit.inspectJourney(rig.journeyId)).reason, 'disposed');
        });
});

suite('activationKit · THE REAL-KIT LAW and THE EVIDENCE-NOT-AUTHORITY LAW (the import pins)', () => {
        test('the kit module drives the REAL kits by import (createOnboardingKit / createRolesKit / loadHarnessKit referenced by name)', () => {
                assert.match(KIT_SOURCE, /createOnboardingKit\(/);
                assert.match(KIT_SOURCE, /loadOnboardingKit\(/);
                assert.match(KIT_SOURCE, /createRolesKit\(/);
                assert.match(KIT_SOURCE, /loadRolesKit\(/);
                assert.match(KIT_SOURCE, /createOntologyKit\(/);
                assert.match(KIT_SOURCE, /createTemplatesKit\(/);
                assert.match(KIT_SOURCE, /createBodiesKit\(/);
                assert.match(KIT_SOURCE, /createPacksKit\(/);
                assert.match(KIT_SOURCE, /createProfilesKit\(/);
                assert.match(KIT_SOURCE, /createBenchmarksKit\(/);
                assert.match(KIT_SOURCE, /loadHarnessKit\(/);
        });

        test('THE NO-NEW-AUTHORITY LAW: the kit constructs no second lifecycle machine (no mintHarness / no second journal surface)', () => {
                assert.ok(!/mintHarness\(/.test(KIT_SOURCE), 'the journey never mints a harness itself (the REAL DH-02 composeDraft mints through the REAL DH-01 kit)');
                assert.ok(!/advanceHarness\([^)]*'draft'/.test(KIT_SOURCE));
                // the lifecycle legs route through the authority's OWN advance surface
                assert.match(KIT_SOURCE, /advanceHarness\(harnessId, 'approved', decision\)/);
                assert.match(KIT_SOURCE, /advanceHarness\(harnessId, 'active', decision\)/);
        });

        test('THE DETERMINISM LAW: the kit consumes no forbidden runtime calls (law-comment lines only)', () => {
                const pattern = /Date\.now|Math\.random|new Date\(|process\.env/;
                const matches = KIT_SOURCE.split('\n').filter((line) => pattern.test(line));
                assert.ok(matches.length > 0, 'the greps must actually match the law-comment lines');
                const offending = matches.filter((line) => {
                        const trimmed = line.trim();
                        return !trimmed.startsWith('*') && !trimmed.startsWith('/*') && !trimmed.startsWith('//');
                });
                assert.deepStrictEqual(offending, [], 'no executable line may carry the forbidden tokens');
        });

        test('the onboarding session id is a REAL DH-02 flauz:onb: id minted at begin', async () => {
                const rig = await beginRig();
                const journey = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                assert.match(journey.onboardingSessionId as string, /^flauz:onb:[0-9a-f]{16}$/);
        });

        test('the journey drives the REAL DH-02 session (the session record advances at every leg)', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                // REOPEN the REAL onboarding kit from its own ledger: the selection trio walks
                // the session industry -> company -> work-types -> review (the real kit's own
                // stage machine: selectWorkTypes lands at 'review', the draft-mint stage)
                const reopened = await loadOnboardingKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reopened.ok, 'the REAL DH-02 kit reopens over its own ledger');
                const sessionId = (journeyOf(await rig.kit.inspectJourney(rig.journeyId)).onboardingSessionId) as string;
                const session = await reopened.kit.inspectSession(sessionId);
                assert.ok(session.ok);
                assert.equal(session.session.stage, 'review');
                assert.equal(session.session.harnessId, null, 'no draft is minted before the record-composition leg');
                // composeRecords mints the binding draft THROUGH the real session (re-open the
                // real DH-02 kit from its own ledger to read the advanced state - a loaded
                // kit instance is an in-memory snapshot; the ledger is the live surface)
                await walkTo(rig, 'records');
                const reopenedAfter = await loadOnboardingKit({ clock: rig.seams.clock, rng: rig.seams.rng, catalog: rig.catalog, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(reopenedAfter.ok, 'the REAL DH-02 kit re-opens over its own ledger after the draft mint');
                const after = await reopenedAfter.kit.inspectSession(sessionId);
                assert.ok(after.ok);
                assert.equal(after.session.stage, 'review');
                assert.ok((after.session.harnessId as string).startsWith('flauz:hrn:'));
        });

        test('the journey drives the REAL DH-03 roles kit (the composed session is the kit\'s own record)', async () => {
                const rig = await beginRig();
                await walkToRoles(rig, THREE_ROLES);
                const journey = journeyOf(await rig.kit.inspectJourney(rig.journeyId));
                const rolesSession = journey.rolesSession as { sessionId: string; industry: string; stage: string; roles: { roleKey: string }[] };
                assert.match(rolesSession.sessionId, /^flauz:rol:[0-9a-f]{16}$/);
                assert.equal(rolesSession.industry, 'software');
                assert.equal(rolesSession.stage, 'composed');
                assert.equal(rolesSession.roles.length, 3);
                // REOPEN the REAL roles kit from its own ledger: the same composed session
                const rolesKitLoaded = await loadRolesKit({ clock: rig.seams.clock, rng: rig.seams.rng, fsPort: rig.port as unknown as HarnessFsPort, root: 'ws' });
                assert.ok(rolesKitLoaded.ok, 'the REAL DH-03 kit reopens over its own ledger');
                const inspected = await rolesKitLoaded.kit.inspectSession(rolesSession.sessionId);
                assert.ok(inspected.ok);
                assert.deepStrictEqual(inspected.session?.roles.map((role) => role.roleKey), ['analyst', 'reviewer', 'operations-lead']);
        });
});
