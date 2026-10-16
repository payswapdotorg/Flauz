/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE HEALTHCARE INDUSTRY ACCEPTANCE FIXTURE (DH-013, the third of
 * the four curated representative fixture sets; deepened to the
 * declared censused representativeness bar by the DH-GAP-2 wave).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, honestly labeled at the declared censused bar (six
 * roles, ten terms, four tasks, four bodies, four packs, two
 * profiles); NOT a claim of comprehensive domain truth, NOT promoted
 * evidence.
 *
 * THE HONEST GAP LAW (the DH-GAP-2 update): the healthcare fixture
 * now carries the curated INDUSTRY-EXTENSION benchmark binding - the
 * REAL three healthcare fixture scenarios of the lab industry
 * extension registry (world-healthcare-fixtures), the ids DERIVED
 * from the registry's own world by import (never a transcribed list),
 * every scenarioRef binding the healthcare industry's OWN task-world
 * through the combined catalog. Because the healthcare fixture
 * carries the curated benchmark, its benchmark leg is EVALUATED and it
 * does NOT register the CLOSED 'lab-task-worlds-coverage' row (its
 * closure is recorded IN the ledger row); the closed
 * 'content-representativeness' row is registered by none (the censused
 * bar is met by construction); the closed 'no-live-provider-execution'
 * row is registered by none (the INF-009 canary's station-verified
 * live-real exchange closed it at the INF boundary 2026-10-16 - this
 * family's own task-execution evidence ceiling stays fixture-labeled,
 * never promoted). The journey's DH-09 record still
 * composes the runner-derived REGISTRY-BOUND floor entry (the REAL
 * DH-09 scenario-binding law resolves scenarioRefs against the landed
 * base registry - the limitation is disclosed IN that entry itself).
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { HEALTHCARE_WORLD_ID } from '../../../lab/common/healthcareTaskWorld.js';
import { getIndustryWorld } from '../../../lab/common/industryTaskWorlds.js';
import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL three healthcare scenario ids, derived from the lab industry extension registry by the world's own identity. */
const HEALTHCARE_TASK_WORLD = getIndustryWorld(HEALTHCARE_WORLD_ID);
const REAL_HEALTHCARE_SCENARIO_IDS: readonly string[] = HEALTHCARE_TASK_WORLD === undefined ? [] : HEALTHCARE_TASK_WORLD.taskScenarios.map((scenario) => scenario.id);

/** The honest gaps the healthcare industry registers: the three OPEN ledger rows (the closed rows 1-3 are registered by none - their closures are recorded IN the ledger rows). */
const HEALTHCARE_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER.filter((row) => row.gapKey !== 'lab-task-worlds-coverage' && row.gapKey !== 'content-representativeness' && row.gapKey !== 'no-live-provider-execution');

const healthcareFixture: IndustryAcceptanceFixture = {
        industry: 'healthcare',
        companyProfile: {
                displayName: 'fixture clinical operations harness co',
                sizeBand: 'large',
        },
        workTypes: ['analysis', 'drafting', 'review', 'compliance'],
        roles: [
                { roleKey: 'clinical-documenter', summary: 'Documents patient encounters into the clinical record.' },
                { roleKey: 'billing-coder', summary: 'Codes documented encounters for the billing claim.' },
                { roleKey: 'audit-reviewer', summary: 'Audits documentation and claims against the compliance policy.' },
                { roleKey: 'care-coordinator', summary: 'Coordinates transitions of care and the pending authorization queue.' },
                { roleKey: 'utilization-review-nurse', summary: 'Reviews requested services against the coverage policy.' },
                { roleKey: 'release-of-information-officer', summary: 'Processes record-disclosure requests against the consent forms.' },
        ],
        terms: [
                { term: 'hc.chief-complaint', definition: 'The primary reason the patient sought care.' },
                { term: 'hc.icd-code', definition: 'The diagnosis code assigned to a documented condition.' },
                { term: 'hc.prior-authorization', definition: 'The payer approval required before a billable service.' },
                { term: 'hc.discharge-summary', definition: 'The encounter-closing summary signed at discharge.' },
                { term: 'hc.audit-trail', definition: 'The immutable record of who changed what and when.' },
                { term: 'hc.coverage-determination', definition: 'The payer decision on whether a service is a covered benefit.' },
                { term: 'hc.encounter-note', definition: 'The structured clinical note recording one patient encounter.' },
                { term: 'hc.claim-denial', definition: 'A rejected billing claim with a coded denial reason.' },
                { term: 'hc.consent-form', definition: 'The signed record authorizing treatment or disclosure.' },
                { term: 'hc.clinical-pathway', definition: 'The standardized care sequence for a condition or procedure.' },
        ],
        tasks: [
                { taskKey: 'document-encounter', summary: 'Document a patient encounter with the complaint and the assigned codes.', termRefs: ['hc.chief-complaint', 'hc.icd-code', 'hc.discharge-summary'] },
                { taskKey: 'prepare-billing-claim', summary: 'Prepare the billing claim for a documented encounter.', termRefs: ['hc.icd-code', 'hc.prior-authorization'] },
                { taskKey: 'coordinate-care-transitions', summary: 'Coordinate a care transition with the pathway and the pending authorizations.', termRefs: ['hc.clinical-pathway', 'hc.prior-authorization', 'hc.encounter-note'] },
                { taskKey: 'appeal-claim-denial', summary: 'Appeal a denied claim with the coverage determination and the encounter evidence.', termRefs: ['hc.claim-denial', 'hc.coverage-determination', 'hc.audit-trail'] },
        ],
        bodies: [
                { bodyKey: 'clinical-documentation-desk', summary: 'The desk that documents encounters and closes summaries.', roleRefs: ['clinical-documenter', 'audit-reviewer'] },
                { bodyKey: 'revenue-cycle-desk', summary: 'The desk that codes encounters and files claims.', roleRefs: ['billing-coder'] },
                { bodyKey: 'care-coordination-desk', summary: 'The desk that coordinates transitions and the authorization queue.', roleRefs: ['care-coordinator', 'utilization-review-nurse'] },
                { bodyKey: 'health-information-desk', summary: 'The desk that processes disclosure requests and the consent records.', roleRefs: ['release-of-information-officer', 'clinical-documenter'] },
        ],
        packs: [
                { packKey: 'clinical-documentation-pack', summary: 'The clinical documentation capability pack.', bodyRefs: ['clinical-documentation-desk'] },
                { packKey: 'revenue-cycle-pack', summary: 'The revenue cycle capability pack.', bodyRefs: ['revenue-cycle-desk'] },
                { packKey: 'care-coordination-pack', summary: 'The care coordination capability pack.', bodyRefs: ['care-coordination-desk'] },
                { packKey: 'health-information-pack', summary: 'The health information management capability pack.', bodyRefs: ['health-information-desk'] },
        ],
        profiles: [
                {
                        profileKey: 'default-clinical',
                        summary: 'The default clinical policy profile.',
                        permissionRefs: ['read-files'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'quality'],
                },
                {
                        profileKey: 'care-coordination',
                        summary: 'The care coordination policy profile.',
                        permissionRefs: ['read-files', 'write-workspace'],
                        approvalTiers: ['moderate', 'high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'latency'],
                },
        ],
        benchmark: {
                bindingMode: 'industry-extension-registry',
                entry: {
                        benchmarkKey: 'clinical-operations-health',
                        summary: 'The clinical operations health benchmark.',
                        hypothesis: 'A composed healthcare agent organization completes the seeded healthcare fixture scenarios with a higher success rate than the single-agent baseline.',
                        scenarioRefs: REAL_HEALTHCARE_SCENARIO_IDS,
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The candidate clears every acceptance criterion on the majority of seeded instances per scenario.',
                        limitations: 'Fixture worlds over a synthetic clinical-operations layout; no real telemetry, no real patient data, single-corpora runs only; bound through the lab industry extension registry (the combined catalog).',
                        evidenceLevel: 'fixture',
                },
        },
        expectedGaps: HEALTHCARE_EXPECTED_GAPS,
};

/** The frozen curated healthcare acceptance fixture (the ONLY export of this pure-data module). */
export const HEALTHCARE_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(healthcareFixture);
