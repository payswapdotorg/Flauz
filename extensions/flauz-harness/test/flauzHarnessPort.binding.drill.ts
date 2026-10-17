/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DH-GAP-5 RUNTIME-BINDING drill (the station's bun-lane drill, the
 * repo's real-execution drill precedent - see
 * build/flauz/inference/acceptance/test/canary/live-provider-drill.drill.ts):
 * the flauz-harness extension's runtime binding
 * (src/flauzHarnessPort.ts - the ONLY cross-lane runtime edge, the file
 * that imports the REAL Domain Harness OS kits at build/flauz/harness/
 * with the kits' own .js specifiers) driven END-TO-END over those REAL
 * kits - the node-lane execution evidence the acceptance gap ledger's
 * row 5 (`workbench-surface-runtime-binding`) records as closed. This
 * is REAL-VERIFICATION code, clearly separated from the gated battery:
 * the file's `.drill.ts` suffix keeps it OUTSIDE the node --test glob
 * (`test/*.test.ts`) - the extension's node lane still never imports
 * the binding (the letter of the flauz-lab law kept: Node type
 * stripping cannot resolve the kits' .js specifiers); the drill runs
 * under bun, which resolves the .js-specifier-to-.ts imports natively
 * (the same runner law every build/flauz family battery documents -
 * `bunx --bun mocha`).
 *
 * ENV CONTRACT: NONE. Unlike the INF-009 live-provider canary this
 * drill needs no env, no network, no secrets - it drives the real kits
 * over a fresh temp root (outside the repo tree) through the port's
 * own node:fs/promises fs port. It never reads process.env.
 *
 * WHAT IT DRIVES (REAL code only): openFlauzHarnessPort over the
 * injected seams (the workspace root, the fixed clock, the fixed
 * counter rng) - the port reopens the REAL DH-02 onboarding kit (whose
 * inner REAL DH-01 kit rides the same fs port and root), then the full
 * op chain through the port: the vocabulary reads (the REAL frozen
 * DH-01/DH-02 vocabularies), the DH-02 session walk (beginSession ->
 * selectIndustry -> composeCompany -> selectWorkTypes), a REAL DH-03
 * roles session composed at the SAME root through the REAL
 * loadRolesKit (begin -> addRole -> finalizeComposition ->
 * emitReviewComposition), the proposeDraft boundary (the REAL DH-03
 * emit -> the REAL DH-02 compose-draft -> the REAL DH-02 propose; the
 * harness MINTED through the inner REAL DH-01 kit into the shared
 * harness ledger), listHarnesses (the REAL DH-01 ledger read), and
 * loadNavigation (the REAL per-family loaders + the REAL DH-010
 * projectNavigation over the minted harness).
 *
 * THE SEAMS DISCLOSURE (the same class as the family batteries'
 * injected seams): the port's deps are injected seams BY DESIGN (the
 * root, the clock, the rng); the drill injects the FIXED clock
 * '2026-10-16T16:30:00.000Z' and a counter-based 16-hex rng so every
 * minted id is deterministic (the fixed counter derives exactly
 * harness id 'flauz:hrn:0000000000000007') - the REAL kit code
 * executes throughout, only the id/timestamp seams are fixed (the
 * extension itself injects the real clock and the node:crypto rng at
 * its boundary, src/flauzHarnessPort.ts's cryptoRng).
 *
 * WHAT IT ASSERTS, each with REAL observed evidence (exit 1 + message
 * on violation):
 *   1. the port opens ok over a fresh temp root (the ledger replay of
 *      the REAL DH-02 kit; a fresh root reopens as an empty kit);
 *   2. the REAL frozen vocabularies ride the port (the industries
 *      include 'software'; the size bands include 'medium'; the work
 *      types include 'analysis' and 'review' - membership observed,
 *      never counts);
 *   3. the full DH-02 session chain, each op ok, every stage
 *      transition observed on the returned session view (industry ->
 *      company -> work-types -> review);
 *   4. the REAL DH-03 roles session composed at the same root (begin
 *      -> addRole -> finalize -> emit; the composition carrying the
 *      one role);
 *   5. proposeDraft ok - the harness MINTED through the inner REAL
 *      DH-01 kit: the exact deterministic harnessId the fixed rng
 *      derives, pinned; the session stage 'proposed';
 *   6. listHarnesses ok - exactly the one minted harness, at state
 *      'proposed';
 *   7. loadNavigation ok - the REAL DH-010 projection: exactly the
 *      nine frozen sections (imported by reference), the composed
 *      sections (overview, roles, lifecycle) populated with the
 *      anchor's own rows and the six not-composed families honestly
 *      empty (zero rows, never fabricated);
 *   8. THE CLOSED DOOR: Object.keys(port) pinned EXACTLY - the twelve
 *      ops plus the two data keys (id, mode), fourteen keys in the
 *      port's own order, NO activation op (the DH-01 authority keeps
 *      the lifecycle);
 *   9. determinism: the whole flow run TWICE on two fresh roots with
 *      the same fixed clock/rng - the minted harness ids byte-equal
 *      (the id seam is the only nondeterminism source and it is
 *      injected).
 *
 * The drill reads the REAL clock (new Date) for its own log line only
 * - REAL-VERIFICATION code is sanctioned to; every seam the real kits
 * consume is FIXED (the law above).
 *
 * Exit codes: 0 = drill green (the receipts printed, the temp roots
 * removed); 1 = a law was violated (a refused op, a wrong shape, a
 * wrong id, a drifted projection, an unexpected port key, or the
 * determinism leg diverging).
 */
import { mkdirSync, rmSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openFlauzHarnessPort } from '../src/flauzHarnessPort.ts';
import { loadRolesKit } from '../../../build/flauz/harness/roles/common/rolesKit.js';
import { DOMAIN_NAVIGATION_SECTIONS, PROJECTIONS_CONTRACTS_VERSION } from '../../../build/flauz/harness/projections/common/projectionsContract.js';
import type { DomainNavigationSection } from '../../../build/flauz/harness/projections/common/projectionsContract.js';
import type { HarnessFsPort } from '../../../build/flauz/harness/contract/common/domainHarnessKit.js';
import type { SessionOpResult, SelectionSessionView } from '../src/harnessPort.ts';

/** The fixed clock (the drill's single injected timestamp source - every ISO stamp the real kits record derives from it). */
const FIXED_CLOCK_ISO = '2026-10-16T16:30:00.000Z';

/**
 * THE DETERMINISTIC MINT PIN: the exact harness id the fixed counter
 * rng derives over this op chain (the 7th read: one read per kit
 * factory/open along the chain, then the mint) - the drift canary's
 * byte-exact pin.
 */
const PINNED_HARNESS_ID = 'flauz:hrn:0000000000000007';

/** The two fresh temp roots (outside the repo tree; removed at the end of the drill). */
const DRILL_ROOT_A = join(tmpdir(), 'flauz-harness-binding-drill');
const DRILL_ROOT_B = join(tmpdir(), 'flauz-harness-binding-drill-b');

/**
 * THE CLOSED DOOR pin: the port surface's EXACT key set, in the port
 * object literal's own order - the twelve ops (listIndustries,
 * listSizeBands, listWorkTypes, beginSession, selectIndustry,
 * composeCompany, selectWorkTypes, proposeDraft, inspectSession,
 * listRoleCompositions, listHarnesses, loadNavigation) plus the two
 * data keys (id, mode). NO activation op - the DH-01 authority keeps
 * the lifecycle.
 */
const PORT_SURFACE_KEYS = [
        'id',
        'mode',
        'listIndustries',
        'listSizeBands',
        'listWorkTypes',
        'beginSession',
        'selectIndustry',
        'composeCompany',
        'selectWorkTypes',
        'proposeDraft',
        'inspectSession',
        'listRoleCompositions',
        'listHarnesses',
        'loadNavigation',
] as const;

/**
 * THE FRESH-DRAFT SECTION-STATE PIN (observed, not fabricated): over a
 * freshly proposed draft the REAL DH-010 projection composes the
 * overview (the anchor record + the onboarding session rows), the
 * roles (the descriptor's composed role + the DH-03 session's role)
 * and the lifecycle (the DH-01 state machine projection); the six
 * composing families with no content yet (workflows, capabilities,
 * policies, evidence, kpis, benchmarks) carry the honest
 * 'not-composed' state with ZERO rows.
 */
const PINNED_COMPOSED_SECTIONS = ['overview', 'roles', 'lifecycle'] as const;
const PINNED_NOT_COMPOSED_SECTIONS = ['workflows', 'capabilities', 'policies', 'evidence', 'kpis', 'benchmarks'] as const;

/** The drill's flow facts (the observed evidence the determinism leg compares). */
interface BindingFlowFacts {
        readonly sessionId: string;
        readonly rolesSessionId: string;
        readonly harnessId: string;
}

function fail(message: string): never {
        console.error(`RUNTIME-BINDING drill: FAIL: ${message}`);
        process.exit(1);
}

function freshRoot(root: string): string {
        rmSync(root, { recursive: true, force: true });
        mkdirSync(root, { recursive: true });
        return root;
}

/** The drill's receipts label ('run A' prints the full receipts; the determinism leg prints its own). */
function receipt(label: string, message: string): void {
        console.log(`RUNTIME-BINDING drill [${label}]: ${message}`);
}

/**
 * The fixed counter rng (the station's recipe seam): each read returns
 * the counter as 16 lowercase hex chars - the deterministic id stream
 * the real kits' mint stations consume (the extension injects
 * node:crypto here; the drill fixes it so the minted ids are
 * pinneable).
 */
function makeFixedRng(): () => string {
        let n = 0;
        return () => {
                n += 1;
                return (n.toString(16).padStart(16, '0') + '0'.repeat(16)).slice(0, 16);
        };
}

/** The DH-03 fs port over node:fs/promises (the same shape the port itself binds; the roles session composes at the SAME root). */
const drillFsPort: HarnessFsPort = {
        readFile: (path, encoding) => readFile(path, encoding),
        writeFile: (path, text) => writeFile(path, text, 'utf8'),
        appendFile: (path, text) => appendFile(path, text, 'utf8'),
        mkdir: (path, options) => mkdir(path, options),
};

/** Extracts the ok side of a port session op (a refusal is the drill's fail - the op chain must be green). */
function mustBeOk(outcome: SessionOpResult, op: string): SelectionSessionView {
        if (!outcome.ok) {
                fail(`${op}: the port op refused: '${outcome.reason}': ${outcome.detail}`);
        }
        return outcome.session;
}

/**
 * THE FULL OP CHAIN over the REAL kits, at a fresh root, through the
 * FIXED seams. Every assertion is real observed evidence; the receipts
 * print as the chain walks.
 */
async function runBindingFlow(root: string, label: string): Promise<BindingFlowFacts> {
        const clock = (): string => FIXED_CLOCK_ISO;
        const rng = makeFixedRng();

        // --- assertion 1: the port opens ok over the fresh root ---
        const opened = await openFlauzHarnessPort({ root, clock, rng });
        if (!opened.ok) {
                fail(`the port refused to open over the fresh root: '${opened.reason}': ${opened.detail}`);
        }
        const port = opened.port;
        receipt(label, `the runtime port opened ok over the fresh root (id '${port.id}', mode '${port.mode}') - the REAL DH-02 kit reopened through the port's own fs port`);

        // --- assertion 8 (pinned early: the surface the whole chain rides): THE CLOSED DOOR ---
        const portKeys: readonly string[] = Object.keys(port);
        if (portKeys.length !== PORT_SURFACE_KEYS.length || portKeys.some((key, index) => key !== PORT_SURFACE_KEYS[index])) {
                fail(`THE CLOSED DOOR: Object.keys(port) is ${JSON.stringify(portKeys)} - the pinned surface is ${JSON.stringify(PORT_SURFACE_KEYS)} (the twelve ops + the id/mode data keys, NO activation op)`);
        }
        if (portKeys.some((key) => key.toLowerCase().includes('activat') || key.toLowerCase().includes('advance'))) {
                fail('THE CLOSED DOOR: the port surface carries an activation-shaped key - the DH-01 authority keeps the lifecycle');
        }
        receipt(label, `THE CLOSED DOOR pinned: Object.keys(port) carries exactly the twelve ops plus the id/mode data keys (${String(portKeys.length)} keys, the port's own order) - no activation op, the DH-01 authority keeps the lifecycle`);

        // --- assertion 2: the REAL frozen vocabularies ride the port ---
        const industries = await port.listIndustries();
        if (!industries.includes('software')) {
                fail(`the REAL industry vocabulary does not include 'software' (observed: ${JSON.stringify(industries)})`);
        }
        const sizeBands = await port.listSizeBands();
        if (!sizeBands.includes('medium')) {
                fail(`the REAL size-band vocabulary does not include 'medium' (observed: ${JSON.stringify(sizeBands)})`);
        }
        const workTypes = await port.listWorkTypes();
        if (!workTypes.includes('analysis') || !workTypes.includes('review')) {
                fail(`the REAL work-type vocabulary does not include 'analysis' and 'review' (observed: ${JSON.stringify(workTypes)})`);
        }
        receipt(label, `the REAL frozen vocabularies ride the port (industries include 'software' among ${String(industries.length)} members; size bands include 'medium' among ${String(sizeBands.length)}; work types include 'analysis' and 'review' among ${String(workTypes.length)})`);

        // --- assertion 3: the full DH-02 session chain (each op ok, the stage transitions observed) ---
        const began = mustBeOk(await port.beginSession(), 'beginSession');
        const sessionId = began.sessionId;
        if (!sessionId.startsWith('flauz:onb:') || began.stage !== 'industry') {
                fail(`beginSession derived sessionId '${sessionId}' at stage '${began.stage}' - the REAL DH-02 mint form at the 'industry' stage was expected`);
        }
        const selectedIndustry = mustBeOk(await port.selectIndustry(sessionId, 'software'), 'selectIndustry');
        if (selectedIndustry.stage !== 'company' || selectedIndustry.industry !== 'software') {
                fail(`selectIndustry left the session at stage '${selectedIndustry.stage}' industry '${String(selectedIndustry.industry)}' - the 'company' stage at 'software' was expected`);
        }
        const composedCompany = mustBeOk(await port.composeCompany(sessionId, 'Smoke Co', 'medium'), 'composeCompany');
        if (composedCompany.stage !== 'work-types' || composedCompany.companyDisplayName !== 'Smoke Co' || composedCompany.companySizeBand !== 'medium') {
                fail(`composeCompany left the session at stage '${composedCompany.stage}' (company '${String(composedCompany.companyDisplayName)}/${String(composedCompany.companySizeBand)}') - the 'work-types' stage with the composed profile was expected`);
        }
        const selectedWorkTypes = mustBeOk(await port.selectWorkTypes(sessionId, ['analysis', 'review']), 'selectWorkTypes');
        if (selectedWorkTypes.stage !== 'review' || selectedWorkTypes.workTypes.join(',') !== 'analysis,review') {
                fail(`selectWorkTypes left the session at stage '${selectedWorkTypes.stage}' (work types '${selectedWorkTypes.workTypes.join(',')}') - the 'review' stage with the selected work types was expected`);
        }
        receipt(label, `the full DH-02 session chain green: session '${sessionId}' walked industry -> company -> work-types -> review (the REAL kit's forward-only stage transitions observed on every op)`);

        // --- assertion 4: the REAL DH-03 roles session composed at the SAME root ---
        const rolesLoad = await loadRolesKit({ clock, rng, fsPort: drillFsPort, root });
        if (!rolesLoad.ok) {
                fail(`the REAL loadRolesKit refused over the same root: '${rolesLoad.refusal.reason}': ${rolesLoad.refusal.detail}`);
        }
        const rolesKit = rolesLoad.kit;
        const rolesBegin = await rolesKit.beginSession('software');
        if (!rolesBegin.ok) {
                fail(`the DH-03 beginSession refused: '${rolesBegin.refusal.reason}': ${rolesBegin.refusal.detail}`);
        }
        const rolesSessionId = rolesBegin.session.sessionId;
        const addedRole = await rolesKit.addRole(rolesSessionId, { roleKey: 'software.architect', summary: 'Owns the architecture decisions and the review bar for the smoke composition.' });
        if (!addedRole.ok) {
                fail(`the DH-03 addRole refused: '${addedRole.refusal.reason}': ${addedRole.refusal.detail}`);
        }
        if (addedRole.session.roles.length !== 1 || addedRole.session.roles[0].roleKey !== 'software.architect') {
                fail(`the DH-03 session does not carry the one added role (observed: ${JSON.stringify(addedRole.session.roles)})`);
        }
        const finalized = await rolesKit.finalizeComposition(rolesSessionId);
        if (!finalized.ok) {
                fail(`the DH-03 finalizeComposition refused: '${finalized.refusal.reason}': ${finalized.refusal.detail}`);
        }
        const emitted = await rolesKit.emitReviewComposition(rolesSessionId);
        if (!emitted.ok) {
                fail(`the DH-03 emitReviewComposition refused: '${emitted.refusal.reason}': ${emitted.refusal.detail}`);
        }
        if (emitted.composition.roles.length !== 1 || emitted.composition.roles[0].roleKey !== 'software.architect') {
                fail(`the emitted composition does not carry the one role (observed: ${JSON.stringify(emitted.composition.roles)})`);
        }
        receipt(label, `the REAL DH-03 roles session composed at the SAME root: '${rolesSessionId}' (begin -> addRole -> finalize -> emit; the composition carries the one role 'software.architect')`);

        // --- assertion 5: proposeDraft ok - the harness MINTED through the inner REAL DH-01 kit ---
        const proposed = mustBeOk(await port.proposeDraft(sessionId, rolesSessionId), 'proposeDraft');
        const harnessId = proposed.proposedHarnessId ?? '';
        if (proposed.stage !== 'proposed' || !harnessId.startsWith('flauz:hrn:')) {
                fail(`proposeDraft left the session at stage '${proposed.stage}' with harness id '${harnessId}' - the 'proposed' stage with a REAL minted harness id was expected`);
        }
        if (harnessId !== PINNED_HARNESS_ID) {
                fail(`the minted harness id is '${harnessId}' - the fixed counter rng derives exactly '${PINNED_HARNESS_ID}' (a drift in the real kits' id-mint consumption is the drill's canary)`);
        }
        if (proposed.roleKeys.join(',') !== 'software.architect') {
                fail(`the proposed session does not carry the composed review roles (observed: ${JSON.stringify(proposed.roleKeys)})`);
        }
        receipt(label, `proposeDraft green: the harness MINTED through the inner REAL DH-01 kit - harness id '${harnessId}' (the pinned deterministic id), the session at stage 'proposed' carrying the composed role`);

        // --- assertion 6: listHarnesses ok - exactly the one minted harness at state 'proposed' ---
        const listed = await port.listHarnesses();
        if (!listed.ok) {
                fail(`listHarnesses refused: '${listed.reason}': ${listed.detail}`);
        }
        if (listed.harnesses.length !== 1 || listed.harnesses[0].harnessId !== harnessId) {
                fail(`listHarnesses does not carry exactly the one minted harness (observed: ${JSON.stringify(listed.harnesses)})`);
        }
        const harnessState = listed.harnesses[0].state;
        if (harnessState !== 'proposed' || listed.harnesses[0].industry !== 'software' || listed.harnesses[0].displayName !== 'Smoke Co') {
                fail(`the minted harness row is state '${harnessState}' industry '${listed.harnesses[0].industry}' name '${listed.harnesses[0].displayName}' - 'proposed' / 'software' / 'Smoke Co' was expected`);
        }
        receipt(label, `listHarnesses green: exactly the one minted harness '${harnessId}' at state 'proposed' (industry 'software', display name 'Smoke Co')`);

        // --- assertion 7: loadNavigation ok - the REAL DH-010 projection over the minted harness ---
        const navigation = await port.loadNavigation(harnessId);
        if (!navigation.ok) {
                fail(`loadNavigation refused: '${navigation.reason}': ${navigation.detail}`);
        }
        const model = navigation.model;
        if (model.harnessId !== harnessId || model.contractVersion !== PROJECTIONS_CONTRACTS_VERSION) {
                fail(`the navigation model is anchored on '${model.harnessId}' at contract version '${model.contractVersion}' - the minted harness at the REAL projections contract version was expected`);
        }
        const sections: readonly DomainNavigationSection[] = model.sections;
        const sectionIds = sections.map((section) => section.section);
        if (sectionIds.join(',') !== DOMAIN_NAVIGATION_SECTIONS.join(',')) {
                fail(`the navigation model's sections are ${JSON.stringify(sectionIds)} - the nine frozen DH-010 sections (imported by reference) in the frozen order were expected`);
        }
        for (const section of sections) {
                if ((section.sectionState === 'composed') !== (section.rows.length > 0)) {
                        fail(`THE SECTION-STATE LAW violated at '${section.section}': state '${section.sectionState}' with ${String(section.rows.length)} rows`);
                }
        }
        const composed = sections.filter((section) => section.sectionState === 'composed').map((section) => section.section);
        const notComposed = sections.filter((section) => section.sectionState === 'not-composed').map((section) => section.section);
        if (composed.join(',') !== PINNED_COMPOSED_SECTIONS.join(',')) {
                fail(`the composed sections are [${composed.join(', ')}] - the fresh-draft projection composes exactly [${PINNED_COMPOSED_SECTIONS.join(', ')}]`);
        }
        if (notComposed.join(',') !== PINNED_NOT_COMPOSED_SECTIONS.join(',')) {
                fail(`the not-composed sections are [${notComposed.join(', ')}] - the six content-less families carry exactly the honest empty states [${PINNED_NOT_COMPOSED_SECTIONS.join(', ')}]`);
        }
        // the composed sections' own evidence: the anchor's record rows ride the overview; the composed role rides the roles section.
        const overviewRows = sections[0].rows;
        const anchorRow = overviewRows.find((row) => row.rowKey === 'overview-harness');
        const lifecycleRow = overviewRows.find((row) => row.rowKey === 'overview-lifecycle');
        if (anchorRow === undefined || anchorRow.label !== harnessId || anchorRow.badge !== 'proposed' || lifecycleRow === undefined || lifecycleRow.label !== 'proposed') {
                fail(`the overview section does not carry the anchor's own rows (the harness record row and the lifecycle row at 'proposed'); observed: ${JSON.stringify(overviewRows.map((row) => [row.rowKey, row.label, row.badge]))}`);
        }
        const rolesRows = sections[1].rows;
        if (!rolesRows.some((row) => row.label === 'software.architect' && row.badge === 'proposed') || !rolesRows.some((row) => row.label === 'software.architect' && row.badge === 'composed')) {
                fail(`the roles section does not carry the composed role on both lanes (the descriptor's role at 'proposed' and the DH-03 session's role at 'composed'); observed: ${JSON.stringify(rolesRows.map((row) => [row.rowKey, row.badge]))}`);
        }
        receipt(label, `loadNavigation green: the REAL DH-010 projection over the minted harness - the nine frozen sections; composed: [${composed.join(', ')}] (the anchor's rows + the composed role + the lifecycle projection); honestly not-composed (zero rows, never fabricated): [${notComposed.join(', ')}]`);

        return { sessionId, rolesSessionId, harnessId };
}

async function main(): Promise<void> {
        receipt('run A', `drilling the flauz-harness runtime binding under bun at ${new Date().toISOString()} (the fixed clock/rng seams injected; NO env, NO network)`);
        const factsA = await runBindingFlow(freshRoot(DRILL_ROOT_A), 'run A');

        // --- assertion 9: determinism - the whole flow TWICE on two fresh roots with the same fixed clock/rng ---
        const factsB = await runBindingFlow(freshRoot(DRILL_ROOT_B), 'run B (the determinism leg)');
        if (factsA.harnessId !== factsB.harnessId) {
                fail(`the determinism leg diverged: run A minted '${factsA.harnessId}', run B minted '${factsB.harnessId}' (the id seam is the only nondeterminism source and it is injected)`);
        }
        if (factsA.sessionId !== factsB.sessionId || factsA.rolesSessionId !== factsB.rolesSessionId) {
                fail(`the determinism leg diverged on the session ids: run A '${factsA.sessionId}'/'${factsA.rolesSessionId}', run B '${factsB.sessionId}'/'${factsB.rolesSessionId}'`);
        }
        receipt('determinism', `the whole flow run TWICE on two fresh roots with the same fixed clock/rng: the minted harness ids are byte-equal ('${factsA.harnessId}'; the session ids too) - the id seam is the only nondeterminism source and it is injected`);

        // --- the clean exit: the temp roots removed ---
        rmSync(DRILL_ROOT_A, { recursive: true, force: true });
        rmSync(DRILL_ROOT_B, { recursive: true, force: true });
        receipt('exit', `GREEN (the full op chain over the REAL kits: the port open, the REAL vocabularies, the DH-02 session walk, the DH-03 compose+emit at the same root, the propose boundary minting '${factsA.harnessId}' through the inner REAL DH-01 kit, the one-harness 'proposed' ledger, the REAL DH-010 nine-section projection with the honest not-composed families, the closed door pinned, the determinism double-run byte-equal); the temp roots removed`);
}

void main().catch((error: unknown) => {
        console.error('RUNTIME-BINDING drill: ERROR', error);
        process.exit(1);
});
