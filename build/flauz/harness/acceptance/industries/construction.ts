/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE CONSTRUCTION INDUSTRY ACCEPTANCE FIXTURE (DH-013, the fourth
 * of the four curated representative fixture sets).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, deliberately modest, honestly labeled; NOT a claim
 * of comprehensive domain truth, NOT promoted evidence.
 *
 * THE HONEST GAP LAW: the construction fixture carries NO curated
 * benchmark - the REAL LAB task-world registry has no
 * construction-specific simulation worlds yet (the registry fact).
 * The fixture registers the 'lab-task-worlds-coverage' gap row
 * honestly (fail-closed: a fixture without a benchmark MUST register
 * the row); the journey's benchmarks family composes the
 * runner-derived REGISTRY-BOUND benchmark over the REAL SE scenarios
 * (the only real ones), with the limitation disclosed in the
 * benchmark entry itself.
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** The honest gaps the construction industry registers: every ledger row, including the world-coverage row (its benchmark leg is gap-registered). */
const CONSTRUCTION_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER;

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
        ],
        terms: [
                { term: 'con.site-diary', definition: 'The daily record of site conditions, attendance and events.' },
                { term: 'con.bill-of-quantities', definition: 'The itemized schedule of works priced for the contract.' },
                { term: 'con.change-order', definition: 'The signed instruction that varies the scope or the price.' },
                { term: 'con.safety-violation', definition: 'A recorded breach of the site safety plan.' },
                { term: 'con.snag-list', definition: 'The list of outstanding defects before handover.' },
        ],
        tasks: [
                { taskKey: 'record-site-inspection', summary: 'Record a site inspection with the diary and any violations.', termRefs: ['con.site-diary', 'con.safety-violation'] },
                { taskKey: 'prepare-valuation', summary: 'Prepare the periodic valuation against the bill of quantities.', termRefs: ['con.bill-of-quantities', 'con.change-order', 'con.snag-list'] },
        ],
        bodies: [
                { bodyKey: 'site-supervision-desk', summary: 'The desk that runs inspections and the site diary.', roleRefs: ['site-inspector', 'safety-compliance-officer'] },
                { bodyKey: 'commercial-desk', summary: 'The desk that surveys quantities and prepares valuations.', roleRefs: ['quantity-surveyor'] },
        ],
        packs: [
                { packKey: 'site-operations-pack', summary: 'The site operations capability pack.', bodyRefs: ['site-supervision-desk'] },
                { packKey: 'commercial-surveying-pack', summary: 'The commercial surveying capability pack.', bodyRefs: ['commercial-desk'] },
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
        ],
        benchmark: null,
        expectedGaps: CONSTRUCTION_EXPECTED_GAPS,
};

/** The frozen curated construction acceptance fixture (the ONLY export of this pure-data module). */
export const CONSTRUCTION_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(constructionFixture);
