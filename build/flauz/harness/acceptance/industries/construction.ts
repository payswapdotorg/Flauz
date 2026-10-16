/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE CONSTRUCTION INDUSTRY ACCEPTANCE FIXTURE (DH-013, the fourth
 * of the four curated representative fixture sets; deepened to the
 * declared censused representativeness bar by the DH-GAP-2 wave).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, honestly labeled at the declared censused bar (six
 * roles, ten terms, four tasks, four bodies, four packs, two
 * profiles); NOT a claim of comprehensive domain truth, NOT promoted
 * evidence.
 *
 * THE HONEST GAP LAW (the DH-GAP-2 update): the construction fixture
 * now carries the curated INDUSTRY-EXTENSION benchmark binding - the
 * REAL three construction fixture scenarios of the lab industry
 * extension registry (world-construction-fixtures), the ids DERIVED
 * from the registry's own world by import (never a transcribed list),
 * every scenarioRef binding the construction industry's OWN
 * task-world through the combined catalog. Because the construction
 * fixture carries the curated benchmark, its benchmark leg is
 * EVALUATED and it does NOT register the CLOSED
 * 'lab-task-worlds-coverage' row (its closure is recorded IN the
 * ledger row); the closed 'content-representativeness' row is
 * registered by none (the censused bar is met by construction); the
 * closed 'no-live-provider-execution' row is registered by none (the
 * INF-009 canary's station-verified live-real exchange closed it at
 * the INF boundary 2026-10-16 - this family's own task-execution
 * evidence ceiling stays fixture-labeled, never promoted). The
 * journey's DH-09 record still composes the runner-derived
 * REGISTRY-BOUND floor entry (the REAL DH-09 scenario-binding law
 * resolves scenarioRefs against the landed base registry - the
 * limitation is disclosed IN that entry itself).
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { CONSTRUCTION_WORLD_ID } from '../../../lab/common/constructionTaskWorld.js';
import { getIndustryWorld } from '../../../lab/common/industryTaskWorlds.js';
import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL three construction scenario ids, derived from the lab industry extension registry by the world's own identity. */
const CONSTRUCTION_TASK_WORLD = getIndustryWorld(CONSTRUCTION_WORLD_ID);
const REAL_CONSTRUCTION_SCENARIO_IDS: readonly string[] = CONSTRUCTION_TASK_WORLD === undefined ? [] : CONSTRUCTION_TASK_WORLD.taskScenarios.map((scenario) => scenario.id);

/** The honest gaps the construction industry registers: the three OPEN ledger rows (the closed rows 1-3 are registered by none - their closures are recorded IN the ledger rows). */
const CONSTRUCTION_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER.filter((row) => row.gapKey !== 'lab-task-worlds-coverage' && row.gapKey !== 'content-representativeness' && row.gapKey !== 'no-live-provider-execution');

const constructionFixture: IndustryAcceptanceFixture = {
        industry: 'construction',
        companyProfile: {
                displayName: 'fixture site delivery harness co',
                sizeBand: 'medium',
        },
        workTypes: ['review', 'planning', 'reporting', 'compliance'],
        roles: [
                { roleKey: 'site-inspector', summary: 'Inspects the site against the drawings and the safety plan.' },
                { roleKey: 'quantity-surveyor', summary: 'Measures completed works and prepares the valuation.' },
                { roleKey: 'safety-compliance-officer', summary: 'Guards the safety plan and files the statutory notices.' },
                { roleKey: 'submittal-coordinator', summary: 'Routes submittal packages through the review and approval chain.' },
                { roleKey: 'schedule-planner', summary: 'Maintains the lookahead schedule and the delay analysis.' },
                { roleKey: 'commissioning-agent', summary: 'Verifies installed systems against the handover requirements.' },
        ],
        terms: [
                { term: 'con.site-diary', definition: 'The daily record of site conditions, attendance and events.' },
                { term: 'con.bill-of-quantities', definition: 'The itemized schedule of works priced for the contract.' },
                { term: 'con.change-order', definition: 'The signed instruction that varies the scope or the price.' },
                { term: 'con.safety-violation', definition: 'A recorded breach of the site safety plan.' },
                { term: 'con.snag-list', definition: 'The list of outstanding defects before handover.' },
                { term: 'con.submittal-package', definition: 'The assembled product data and shop drawings routed for approval.' },
                { term: 'con.lookahead-schedule', definition: 'The rolling near-term works plan derived from the master schedule.' },
                { term: 'con.request-for-information', definition: 'The formal query that resolves a drawing or specification gap.' },
                { term: 'con.material-certification', definition: 'The mill or supplier certificate accompanying a delivered material.' },
                { term: 'con.punch-list-closure', definition: 'The verified sign-off that clears an outstanding defect.' },
        ],
        tasks: [
                { taskKey: 'record-site-inspection', summary: 'Record a site inspection with the diary and any violations.', termRefs: ['con.site-diary', 'con.safety-violation'] },
                { taskKey: 'prepare-valuation', summary: 'Prepare the periodic valuation against the bill of quantities.', termRefs: ['con.bill-of-quantities', 'con.change-order', 'con.snag-list'] },
                { taskKey: 'coordinate-submittal-review', summary: 'Route a submittal package through the review chain to approval.', termRefs: ['con.submittal-package', 'con.request-for-information', 'con.material-certification'] },
                { taskKey: 'analyze-schedule-impact', summary: 'Analyze a delay event and update the lookahead schedule.', termRefs: ['con.lookahead-schedule', 'con.change-order', 'con.punch-list-closure'] },
        ],
        bodies: [
                { bodyKey: 'site-supervision-desk', summary: 'The desk that runs inspections and the site diary.', roleRefs: ['site-inspector', 'safety-compliance-officer'] },
                { bodyKey: 'commercial-desk', summary: 'The desk that surveys quantities and prepares valuations.', roleRefs: ['quantity-surveyor'] },
                { bodyKey: 'submittal-review-desk', summary: 'The desk that routes submittals and tracks the approval chain.', roleRefs: ['submittal-coordinator', 'site-inspector'] },
                { bodyKey: 'planning-desk', summary: 'The desk that maintains the lookahead schedule and the delay log.', roleRefs: ['schedule-planner', 'commissioning-agent'] },
        ],
        packs: [
                { packKey: 'site-operations-pack', summary: 'The site operations capability pack.', bodyRefs: ['site-supervision-desk'] },
                { packKey: 'commercial-surveying-pack', summary: 'The commercial surveying capability pack.', bodyRefs: ['commercial-desk'] },
                { packKey: 'submittal-coordination-pack', summary: 'The submittal coordination capability pack.', bodyRefs: ['submittal-review-desk'] },
                { packKey: 'schedule-planning-pack', summary: 'The schedule planning capability pack.', bodyRefs: ['planning-desk'] },
        ],
        profiles: [
                {
                        profileKey: 'default-site-delivery',
                        summary: 'The default site delivery policy profile.',
                        permissionRefs: ['read-files', 'write-workspace'],
                        approvalTiers: ['moderate', 'high'],
                        evidenceFloor: 'fixture',
                        kpiDimensions: ['success', 'quality'],
                },
                {
                        profileKey: 'commercial-controls',
                        summary: 'The commercial controls policy profile.',
                        permissionRefs: ['read-files'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'cost'],
                },
        ],
        benchmark: {
                bindingMode: 'industry-extension-registry',
                entry: {
                        benchmarkKey: 'site-delivery-health',
                        summary: 'The site delivery health benchmark.',
                        hypothesis: 'A composed construction agent organization completes the seeded construction fixture scenarios with a higher success rate than the single-agent baseline.',
                        scenarioRefs: REAL_CONSTRUCTION_SCENARIO_IDS,
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The candidate clears every acceptance criterion on the majority of seeded instances per scenario.',
                        limitations: 'Fixture worlds over a synthetic site-delivery layout; no real telemetry, no real project data, single-corpora runs only; bound through the lab industry extension registry (the combined catalog).',
                        evidenceLevel: 'fixture',
                },
        },
        expectedGaps: CONSTRUCTION_EXPECTED_GAPS,
};

/** The frozen curated construction acceptance fixture (the ONLY export of this pure-data module). */
export const CONSTRUCTION_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(constructionFixture);
