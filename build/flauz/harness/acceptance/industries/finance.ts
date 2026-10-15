/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE FINANCE INDUSTRY ACCEPTANCE FIXTURE (DH-013, the second of the
 * four curated representative fixture sets).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, deliberately modest, honestly labeled; NOT a claim
 * of comprehensive domain truth, NOT promoted evidence.
 *
 * THE HONEST GAP LAW: the finance fixture carries NO curated
 * benchmark - the REAL LAB task-world registry has no
 * finance-specific simulation worlds yet (the registry fact). The
 * fixture registers the 'lab-task-worlds-coverage' gap row
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

/** The honest gaps the finance industry registers: every ledger row, including the world-coverage row (its benchmark leg is gap-registered). */
const FINANCE_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER;

const financeFixture: IndustryAcceptanceFixture = {
        industry: 'finance',
        companyProfile: {
                displayName: 'fixture community lending harness co',
                sizeBand: 'medium',
        },
        workTypes: ['analysis', 'review', 'reporting', 'compliance'],
        roles: [
                { roleKey: 'mortgage-underwriter', summary: 'Underwrites residential mortgage applications against the lending policy.' },
                { roleKey: 'credit-analyst', summary: 'Analyzes applicant creditworthiness and prepares the credit memo.' },
                { roleKey: 'compliance-reporter', summary: 'Files the regulatory compliance reports for the lending book.' },
        ],
        terms: [
                { term: 'fin.loan-to-value', definition: 'The loan amount divided by the appraised collateral value.' },
                { term: 'fin.credit-memo', definition: 'The analyst memo summarizing creditworthiness and conditions.' },
                { term: 'fin.kyc-check', definition: 'The know-your-customer verification every applicant must clear.' },
                { term: 'fin.risk-weight', definition: 'The regulatory weight assigned to an exposure class.' },
                { term: 'fin.disclosure-statement', definition: 'The borrower-facing statement of terms and fees.' },
        ],
        tasks: [
                { taskKey: 'underwrite-mortgage', summary: 'Underwrite a mortgage application with the credit memo and KYC evidence.', termRefs: ['fin.loan-to-value', 'fin.credit-memo', 'fin.kyc-check'] },
                { taskKey: 'file-compliance-report', summary: 'Prepare and file the periodic compliance report for the lending book.', termRefs: ['fin.risk-weight', 'fin.disclosure-statement'] },
        ],
        bodies: [
                { bodyKey: 'underwriting-desk', summary: 'The desk that underwrites applications and drafts conditions.', roleRefs: ['mortgage-underwriter', 'credit-analyst'] },
                { bodyKey: 'compliance-desk', summary: 'The desk that files the regulatory reports.', roleRefs: ['compliance-reporter', 'credit-analyst'] },
        ],
        packs: [
                { packKey: 'underwriting-pack', summary: 'The underwriting capability pack.', bodyRefs: ['underwriting-desk'] },
                { packKey: 'regulatory-reporting-pack', summary: 'The regulatory reporting capability pack.', bodyRefs: ['compliance-desk'] },
        ],
        profiles: [
                {
                        profileKey: 'default-lending',
                        summary: 'The default lending policy profile.',
                        permissionRefs: ['read-files'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'quality'],
                },
        ],
        benchmark: null,
        expectedGaps: FINANCE_EXPECTED_GAPS,
};

/** The frozen curated finance acceptance fixture (the ONLY export of this pure-data module). */
export const FINANCE_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(financeFixture);
