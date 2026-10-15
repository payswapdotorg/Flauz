/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE HEALTHCARE INDUSTRY ACCEPTANCE FIXTURE (DH-013, the third of
 * the four curated representative fixture sets).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, deliberately modest, honestly labeled; NOT a claim
 * of comprehensive domain truth, NOT promoted evidence.
 *
 * THE HONEST GAP LAW: the healthcare fixture carries NO curated
 * benchmark - the REAL LAB task-world registry has no
 * healthcare-specific simulation worlds yet (the registry fact). The
 * fixture registers the 'lab-task-worlds-coverage' gap row honestly
 * (fail-closed: a fixture without a benchmark MUST register the row);
 * the journey's benchmarks family composes the runner-derived
 * REGISTRY-BOUND benchmark over the REAL SE scenarios (the only real
 * ones), with the limitation disclosed in the benchmark entry itself.
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** The honest gaps the healthcare industry registers: every ledger row, including the world-coverage row (its benchmark leg is gap-registered). */
const HEALTHCARE_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER;

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
        ],
        terms: [
                { term: 'hc.chief-complaint', definition: 'The primary reason the patient sought care.' },
                { term: 'hc.icd-code', definition: 'The diagnosis code assigned to a documented condition.' },
                { term: 'hc.prior-authorization', definition: 'The payer approval required before a billable service.' },
                { term: 'hc.discharge-summary', definition: 'The encounter-closing summary signed at discharge.' },
                { term: 'hc.audit-trail', definition: 'The immutable record of who changed what and when.' },
        ],
        tasks: [
                { taskKey: 'document-encounter', summary: 'Document a patient encounter with the complaint and the assigned codes.', termRefs: ['hc.chief-complaint', 'hc.icd-code', 'hc.discharge-summary'] },
                { taskKey: 'prepare-billing-claim', summary: 'Prepare the billing claim for a documented encounter.', termRefs: ['hc.icd-code', 'hc.prior-authorization'] },
        ],
        bodies: [
                { bodyKey: 'clinical-documentation-desk', summary: 'The desk that documents encounters and closes summaries.', roleRefs: ['clinical-documenter', 'audit-reviewer'] },
                { bodyKey: 'revenue-cycle-desk', summary: 'The desk that codes encounters and files claims.', roleRefs: ['billing-coder'] },
        ],
        packs: [
                { packKey: 'clinical-documentation-pack', summary: 'The clinical documentation capability pack.', bodyRefs: ['clinical-documentation-desk'] },
                { packKey: 'revenue-cycle-pack', summary: 'The revenue cycle capability pack.', bodyRefs: ['revenue-cycle-desk'] },
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
        ],
        benchmark: null,
        expectedGaps: HEALTHCARE_EXPECTED_GAPS,
};

/** The frozen curated healthcare acceptance fixture (the ONLY export of this pure-data module). */
export const HEALTHCARE_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(healthcareFixture);
