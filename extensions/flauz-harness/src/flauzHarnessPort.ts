/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DH-010 Harness console runtime port binding - the ONLY cross-lane
 * runtime edge (the flauz-lab law): this file imports the REAL
 * Domain Harness OS kits at build/flauz/harness/ with the kits' own
 * .js specifiers, which esbuild resolves at bundle time. NO TEST
 * EVER IMPORTS THIS FILE: Node type stripping cannot resolve those
 * .js specifiers, so the test lane covers the console state machine
 * and the view rendering against the port contract
 * (src/harnessPort.ts), while this binding is exercised by the
 * bundle + activation gates.
 *
 * THE COMPOSITION ROUTE (every op rides a REAL kit): the selection
 * session ops delegate to the real DH-02 onboarding kit (reopened
 * over the workspace's onboarding ledger; its propose delegates to
 * the real inner DH-01 kit); the draft composes from a composed DH-03
 * roles session through the REAL emitReviewComposition (refs default
 * EMPTY - the honest gap law; the owning waves are DH-004/DH-005/
 * DH-008); the harness and family records load through the REAL
 * per-family loaders; the navigation model derives through the REAL
 * DH-010 projectNavigation. The surface holds NO state of its own
 * beyond the reopened DH-02 kit handle; NOTHING executes; activation
 * stays routed through the DH-01 authority (the closed door the
 * console discloses on every row).
 *
 * THE CATALOG SEAM (disclosed): the DH-01 catalog snapshot is the
 * EMPTY resolution surface { capabilities: [], workflowIds: [],
 * policyIds: [], evidenceIds: [] } - the console composes with empty
 * ref families (the DH-03 emit's honest gap), so the mint/propose
 * validation is trivially green. Wiring the REAL capability registry
 * into the catalog is the DH-011 end-to-end lane's step, never this
 * surface's fork of it.
 *
 * THE ROOT SEAM: the workspace root is injected by extension.ts (the
 * first workspace folder); the real fs port rides node:fs/promises.
 * The rng seam rides node:crypto (the id minting belongs to the real
 * kits - the surface mints nothing); the clock seam is injected by
 * the caller (the extension's single timestamp source, src/format.ts).
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

import { HARNESS_INDUSTRIES, HARNESS_WORK_TYPES } from '../../../build/flauz/harness/contract/common/domainHarnessContract.js';
import type { HarnessRecord } from '../../../build/flauz/harness/contract/common/domainHarnessContract.js';
import { loadHarnessKit } from '../../../build/flauz/harness/contract/common/domainHarnessKit.js';
import type { HarnessFsPort, HarnessKitOptions } from '../../../build/flauz/harness/contract/common/domainHarnessKit.js';
import { COMPANY_SIZE_BANDS } from '../../../build/flauz/harness/onboarding/common/onboardingContract.js';
import { loadOnboardingKit } from '../../../build/flauz/harness/onboarding/common/onboardingKit.js';
import type { OnboardingKit, OnboardingKitRefusal } from '../../../build/flauz/harness/onboarding/common/onboardingKit.js';
import type { OnboardingSessionRecord } from '../../../build/flauz/harness/onboarding/common/onboardingContract.js';
import { loadRolesKit } from '../../../build/flauz/harness/roles/common/rolesKit.js';
import type { RolesKit } from '../../../build/flauz/harness/roles/common/rolesKit.js';
import { loadOntologyKit } from '../../../build/flauz/harness/ontology/common/ontologyKit.js';
import { loadTemplatesKit } from '../../../build/flauz/harness/templates/common/templatesKit.js';
import { loadBodiesKit } from '../../../build/flauz/harness/bodies/common/bodiesKit.js';
import { loadPacksKit } from '../../../build/flauz/harness/packs/common/packsKit.js';
import { loadProfilesKit } from '../../../build/flauz/harness/profiles/common/profilesKit.js';
import { loadBenchmarksKit } from '../../../build/flauz/harness/benchmarks/common/benchmarksKit.js';
import { projectNavigation } from '../../../build/flauz/harness/projections/common/projectionsContract.js';

import type {
        HarnessConsolePort,
        HarnessListResult,
        HarnessSummaryRow,
        NavigationLoadResult,
        RoleCompositionOption,
        RoleCompositionsResult,
        SelectionSessionView,
        SessionOpResult,
} from './harnessPort.ts';

/** The injected binding seams: the workspace root, the ISO clock and the 16-hex rng (the real kits' own seams). */
export interface FlauzHarnessPortDeps {
        /** The workspace root (the .flauz/harness subtree lands under it). */
        readonly root: string;
        /** The injected clock (returns the ISO string; the single timestamp source is src/format.ts). */
        readonly clock: () => string;
        /** The injected rng (returns exactly 16 lowercase hex chars; node:crypto-backed at the extension boundary). */
        readonly rng: () => string;
}

/** The typed port-open result: ok carries the bound port; refusal carries the observed kit refusal. */
export type FlauzHarnessPortOpenResult =
        | { readonly ok: true; readonly port: HarnessConsolePort }
        | { readonly ok: false; readonly reason: string; readonly detail: string };

/** THE CATALOG SEAM (disclosed above): the empty resolution surface. */
const EMPTY_CATALOG = { capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] } as const;

/** The real fs port over node:fs/promises (the HarnessFsPort shape; a missing file reads as ENOENT). */
const nodeFsPort: HarnessFsPort = {
        readFile: (path: string, encoding: 'utf8') => readFile(path, encoding),
        writeFile: (path: string, text: string) => writeFile(path, text, 'utf8'),
        appendFile: (path: string, text: string) => appendFile(path, text, 'utf8'),
        mkdir: (path: string, options: { recursive: boolean }) => mkdir(path, options),
};

/** The rng seam over node:crypto (16 lowercase hex chars; the id minting belongs to the real kits). */
export function cryptoRng(): string {
        return randomBytes(8).toString('hex');
}

/** The shared kit options (the injected seams, forwarded to every real kit verbatim). */
function kitOptions(deps: FlauzHarnessPortDeps): HarnessKitOptions {
        return { clock: deps.clock, rng: deps.rng, catalog: EMPTY_CATALOG, fsPort: nodeFsPort, root: deps.root };
}

/** The observed DH-02 session record -> the console view-model (every field observed, none fabricated). */
function sessionView(record: OnboardingSessionRecord): SelectionSessionView {
        return {
                sessionId: record.sessionId,
                stage: record.stage,
                industry: record.industry ?? undefined,
                companyDisplayName: record.companyProfile?.displayName,
                companySizeBand: record.companyProfile?.sizeBand,
                workTypes: record.workTypes ?? [],
                roleKeys: record.reviewComposition?.roles.map((role) => role.roleKey) ?? [],
                proposedHarnessId: record.harnessId ?? undefined,
                revision: record.revision,
        };
}

/** The observed DH-01 harness record -> the summary row. */
function harnessSummary(record: HarnessRecord): HarnessSummaryRow {
        return { harnessId: record.harnessId, state: record.state, industry: record.descriptor.industry, displayName: record.descriptor.displayName };
}

/** Maps a refused outcome's { reason, detail } pair onto the port's typed refusal shape (the seven composing families' and the DH-01 kit's own field name). */
function refused(reason: string, detail: string): { ok: false; reason: string; detail: string } {
        return { ok: false, reason, detail };
}

/** Maps the DH-02 onboarding kit's own refusal shape ({ reason, message }) onto the port's typed refusal (observed verbatim, only the field re-named). */
function onboardingRefused(refusal: OnboardingKitRefusal): { ok: false; reason: string; detail: string } {
        return refused(refusal.reason, refusal.message);
}

/**
 * Opens the Harness console port over the workspace: reopens the REAL
 * DH-02 onboarding kit (the ledger replay; a fresh root reopens as an
 * empty kit), whose inner REAL DH-01 kit rides the same fs port and
 * root - the propose boundary mints into the shared harness ledger.
 * A torn ledger or a refused fs port is the typed observed refusal
 * (never a silent fallback to an in-memory kit).
 */
export async function openFlauzHarnessPort(deps: FlauzHarnessPortDeps): Promise<FlauzHarnessPortOpenResult> {
        const opened = await loadOnboardingKit(kitOptions(deps));
        if (!opened.ok) {
                return onboardingRefused(opened.refusal);
        }
        const onboardingKit: OnboardingKit = opened.kit;

        /** Maps the real DH-02 session outcome onto the port's typed result (the observed record, never fabricated). */
        const sessionOutcome = (outcome: { ok: true; session: OnboardingSessionRecord } | { ok: false; refusal: OnboardingKitRefusal }): SessionOpResult => {
                if (outcome.ok) {
                        return { ok: true, session: sessionView(outcome.session) };
                }
                return onboardingRefused(outcome.refusal);
        };

        /** Loads the real roles kit (the ledger replay; a fresh root reopens empty). */
        const openRolesKit = async (): Promise<{ ok: true; kit: RolesKit } | { ok: false; reason: string; detail: string }> => {
                const loaded = await loadRolesKit(kitOptions(deps));
                if (!loaded.ok) {
                        return refused(loaded.refusal.reason, loaded.refusal.detail);
                }
                return { ok: true, kit: loaded.kit };
        };

        const port: HarnessConsolePort = {
                id: 'flauz-harness-console-v1',
                mode: 'flauz',
                async listIndustries(): Promise<readonly string[]> {
                        return [...HARNESS_INDUSTRIES];
                },
                async listSizeBands(): Promise<readonly string[]> {
                        return [...COMPANY_SIZE_BANDS];
                },
                async listWorkTypes(): Promise<readonly string[]> {
                        return [...HARNESS_WORK_TYPES];
                },
                async beginSession(): Promise<SessionOpResult> {
                        return sessionOutcome(await onboardingKit.beginSession());
                },
                async selectIndustry(sessionId: string, industry: string): Promise<SessionOpResult> {
                        return sessionOutcome(await onboardingKit.selectIndustry(sessionId, industry));
                },
                async composeCompany(sessionId: string, displayName: string, sizeBand: string): Promise<SessionOpResult> {
                        return sessionOutcome(await onboardingKit.composeCompany(sessionId, { displayName, sizeBand }));
                },
                async selectWorkTypes(sessionId: string, workTypes: readonly string[]): Promise<SessionOpResult> {
                        return sessionOutcome(await onboardingKit.selectWorkTypes(sessionId, workTypes));
                },
                async proposeDraft(sessionId: string, rolesSessionId: string): Promise<SessionOpResult> {
                        // THE COMPOSITION ROUTE: the REAL DH-03 emit (refs default EMPTY - the
                        // honest gap law) -> the REAL DH-02 compose-draft -> the REAL DH-02
                        // propose (the inner REAL DH-01 kit mints the harness).
                        const roles = await openRolesKit();
                        if (!roles.ok) {
                                return { ok: false, reason: roles.reason, detail: roles.detail };
                        }
                        const emitted = await roles.kit.emitReviewComposition(rolesSessionId);
                        if (!emitted.ok) {
                                return refused(emitted.refusal.reason, emitted.refusal.detail);
                        }
                        const draft = await onboardingKit.composeDraft(sessionId, emitted.composition);
                        if (!draft.ok) {
                                return onboardingRefused(draft.refusal);
                        }
                        return sessionOutcome(await onboardingKit.proposeSession(sessionId));
                },
                async inspectSession(sessionId: string): Promise<SessionOpResult> {
                        return sessionOutcome(await onboardingKit.inspectSession(sessionId));
                },
                async listRoleCompositions(): Promise<RoleCompositionsResult> {
                        const roles = await openRolesKit();
                        if (!roles.ok) {
                                return { ok: false, reason: roles.reason, detail: roles.detail };
                        }
                        const listed = await roles.kit.listSessions({ stage: 'composed' });
                        if (!listed.ok) {
                                return refused(listed.refusal.reason, listed.refusal.detail);
                        }
                        const options: RoleCompositionOption[] = listed.sessions.map((session) => ({
                                sessionId: session.sessionId,
                                industry: session.industry,
                                roleKeys: session.roles.map((role) => role.roleKey),
                        }));
                        return { ok: true, options };
                },
                async listHarnesses(): Promise<HarnessListResult> {
                        const loaded = await loadHarnessKit(kitOptions(deps));
                        if (!loaded.ok) {
                                return refused(loaded.refusal.reason, loaded.refusal.detail);
                        }
                        const listed = await loaded.kit.listHarnesses();
                        if (!listed.ok) {
                                return refused(listed.refusal.reason, listed.refusal.detail);
                        }
                        return { ok: true, harnesses: listed.records.map(harnessSummary) };
                },
                async loadNavigation(harnessId: string): Promise<NavigationLoadResult> {
                        // THE ANCHOR: the REAL DH-01 record (the ledger replay; a missing or
                        // malformed harness is the typed observed refusal - never a partial model).
                        const harnessLoad = await loadHarnessKit(kitOptions(deps));
                        if (!harnessLoad.ok) {
                                return refused(harnessLoad.refusal.reason, harnessLoad.refusal.detail);
                        }
                        const inspected = await harnessLoad.kit.inspectHarness(harnessId);
                        if (!inspected.ok) {
                                return refused(inspected.refusal.reason, inspected.refusal.detail);
                        }
                        const anchor = inspected.record;
                        // THE FAMILY LOADS: the REAL per-family loaders; a torn ledger is the
                        // typed observed refusal (fail-closed - never a silent partial model).
                        const rolesLoad = await loadRolesKit(kitOptions(deps));
                        if (!rolesLoad.ok) {
                                return refused(rolesLoad.refusal.reason, rolesLoad.refusal.detail);
                        }
                        const ontologyLoad = await loadOntologyKit(kitOptions(deps));
                        if (!ontologyLoad.ok) {
                                return refused(ontologyLoad.refusal.reason, ontologyLoad.refusal.detail);
                        }
                        const templatesLoad = await loadTemplatesKit(kitOptions(deps));
                        if (!templatesLoad.ok) {
                                return refused(templatesLoad.refusal.reason, templatesLoad.refusal.detail);
                        }
                        const bodiesLoad = await loadBodiesKit(kitOptions(deps));
                        if (!bodiesLoad.ok) {
                                return refused(bodiesLoad.refusal.reason, bodiesLoad.refusal.detail);
                        }
                        const packsLoad = await loadPacksKit(kitOptions(deps));
                        if (!packsLoad.ok) {
                                return refused(packsLoad.refusal.reason, packsLoad.refusal.detail);
                        }
                        const profilesLoad = await loadProfilesKit(kitOptions(deps));
                        if (!profilesLoad.ok) {
                                return refused(profilesLoad.refusal.reason, profilesLoad.refusal.detail);
                        }
                        const benchmarksLoad = await loadBenchmarksKit(kitOptions(deps));
                        if (!benchmarksLoad.ok) {
                                return refused(benchmarksLoad.refusal.reason, benchmarksLoad.refusal.detail);
                        }
                        // The observed records: the harnessId-bound families filtered by the
                        // REAL kits' own harnessId filters; the DH-02 sessions filtered to the
                        // pre-proposal (null) plus anchor-bound ones (THE BINDING LAW's caller
                        // wiring); the DH-03 roles sessions scoped to the anchor's industry
                        // (the caller's composition wiring - the roles record carries no
                        // harnessId, the projection never checks it).
                        const onboardingListed = await onboardingKit.listSessions();
                        if (!onboardingListed.ok) {
                                return onboardingRefused(onboardingListed.refusal);
                        }
                        const rolesListed = await rolesLoad.kit.listSessions({ industry: anchor.descriptor.industry });
                        if (!rolesListed.ok) {
                                return refused(rolesListed.refusal.reason, rolesListed.refusal.detail);
                        }
                        const ontologyListed = await ontologyLoad.kit.listOntologies({ harnessId });
                        if (!ontologyListed.ok) {
                                return refused(ontologyListed.refusal.reason, ontologyListed.refusal.detail);
                        }
                        const templatesListed = await templatesLoad.kit.listTemplates({ harnessId });
                        if (!templatesListed.ok) {
                                return refused(templatesListed.refusal.reason, templatesListed.refusal.detail);
                        }
                        const bodiesListed = await bodiesLoad.kit.listDefaults({ harnessId });
                        if (!bodiesListed.ok) {
                                return refused(bodiesListed.refusal.reason, bodiesListed.refusal.detail);
                        }
                        const packsListed = await packsLoad.kit.listPacks({ harnessId });
                        if (!packsListed.ok) {
                                return refused(packsListed.refusal.reason, packsListed.refusal.detail);
                        }
                        const profilesListed = await profilesLoad.kit.listProfilesSessions({ harnessId });
                        if (!profilesListed.ok) {
                                return refused(profilesListed.refusal.reason, profilesListed.refusal.detail);
                        }
                        const benchmarksListed = await benchmarksLoad.kit.listBenchmarksSessions({ harnessId });
                        if (!benchmarksListed.ok) {
                                return refused(benchmarksListed.refusal.reason, benchmarksListed.refusal.detail);
                        }
                        const inputs = {
                                harness: anchor,
                                onboarding: onboardingListed.sessions.filter((session) => session.harnessId === null || session.harnessId === harnessId),
                                roles: rolesListed.sessions,
                                ontology: ontologyListed.records,
                                templates: templatesListed.records,
                                bodies: bodiesListed.records,
                                packs: packsListed.records,
                                profiles: profilesListed.records,
                                benchmarks: benchmarksListed.records,
                        };
                        const projection = projectNavigation(inputs);
                        if (!projection.ok) {
                                const first = projection.rejections[0];
                                return refused(first.reason, first.detail);
                        }
                        return { ok: true, model: projection.model };
                },
        };
        return { ok: true, port };
}
