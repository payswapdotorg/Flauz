/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE FINANCE INDUSTRY ACCEPTANCE FIXTURE (DH-013, the second of the
 * four curated representative fixture sets; deepened to the declared
 * censused representativeness bar by the DH-GAP-2 wave).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, honestly labeled at the declared censused bar (six
 * roles, ten terms, four tasks, four bodies, four packs, two
 * profiles); NOT a claim of comprehensive domain truth, NOT promoted
 * evidence.
 *
 * THE HONEST GAP LAW (the DH-GAP-2 update): the finance fixture now
 * carries the curated INDUSTRY-EXTENSION benchmark binding - the REAL
 * three finance fixture scenarios of the lab industry extension
 * registry (world-finance-fixtures), the ids DERIVED from the
 * registry's own world by import (never a transcribed list), every
 * scenarioRef binding the finance industry's OWN task-world through
 * the combined catalog. Because the finance fixture carries the
 * curated benchmark, its benchmark leg is EVALUATED and it does NOT
 * register the CLOSED 'lab-task-worlds-coverage' row (its closure is
 * recorded IN the ledger row); the closed 'content-representativeness'
 * row is registered by none (the censused bar is met by construction);
 * the closed 'no-live-provider-execution' row is registered by none
 * (the INF-009 canary's station-verified live-real exchange closed it
 * at the INF boundary 2026-10-16 - this family's own task-execution
 * evidence ceiling stays fixture-labeled, never promoted).
 * The journey's DH-09 record still composes the runner-derived
 * REGISTRY-BOUND floor entry (the REAL DH-09 scenario-binding law
 * resolves scenarioRefs against the landed base registry - the
 * limitation is disclosed IN that entry itself).
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { FINANCE_WORLD_ID } from '../../../lab/common/financeTaskWorld.js';
import { getIndustryWorld } from '../../../lab/common/industryTaskWorlds.js';
import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL three finance scenario ids, derived from the lab industry extension registry by the world's own identity. */
const FINANCE_TASK_WORLD = getIndustryWorld(FINANCE_WORLD_ID);
const REAL_FINANCE_SCENARIO_IDS: readonly string[] = FINANCE_TASK_WORLD === undefined ? [] : FINANCE_TASK_WORLD.taskScenarios.map((scenario) => scenario.id);

/** The honest gaps the finance industry registers: the three OPEN ledger rows (the closed rows 1-3 are registered by none - their closures are recorded IN the ledger rows). */
const FINANCE_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER.filter((row) => row.gapKey !== 'lab-task-worlds-coverage' && row.gapKey !== 'content-representativeness' && row.gapKey !== 'no-live-provider-execution');

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
                { roleKey: 'reconciliation-analyst', summary: 'Investigates ledger breaks and closes them with correcting entries.' },
                { roleKey: 'treasury-desk-operator', summary: 'Monitors counterparty limits and the daily cash position.' },
                { roleKey: 'payments-ops-specialist', summary: 'Triages failed payments and dispositions the retry queue.' },
        ],
        terms: [
                { term: 'fin.loan-to-value', definition: 'The loan amount divided by the appraised collateral value.' },
                { term: 'fin.credit-memo', definition: 'The analyst memo summarizing creditworthiness and conditions.' },
                { term: 'fin.kyc-check', definition: 'The know-your-customer verification every applicant must clear.' },
                { term: 'fin.risk-weight', definition: 'The regulatory weight assigned to an exposure class.' },
                { term: 'fin.disclosure-statement', definition: 'The borrower-facing statement of terms and fees.' },
                { term: 'fin.reconciliation-break', definition: 'An unexplained difference between the subledger and the general ledger.' },
                { term: 'fin.nostro-account', definition: 'The correspondent account held at another bank for foreign currency settlement.' },
                { term: 'fin.payment-retry-budget', definition: 'The documented retry allowance for a stuck payment before escalation.' },
                { term: 'fin.subledger', definition: 'The detail ledger that rolls up into the general ledger balances.' },
                { term: 'fin.exception-queue', definition: 'The aged queue of items that failed automated matching or validation.' },
        ],
        tasks: [
                { taskKey: 'underwrite-mortgage', summary: 'Underwrite a mortgage application with the credit memo and KYC evidence.', termRefs: ['fin.loan-to-value', 'fin.credit-memo', 'fin.kyc-check'] },
                { taskKey: 'file-compliance-report', summary: 'Prepare and file the periodic compliance report for the lending book.', termRefs: ['fin.risk-weight', 'fin.disclosure-statement'] },
                { taskKey: 'investigate-reconciliation-break', summary: 'Investigate a subledger break and land the correcting entries with reasons.', termRefs: ['fin.reconciliation-break', 'fin.subledger', 'fin.exception-queue'] },
                { taskKey: 'triage-payment-failures', summary: 'Classify a cluster of failed payments and disposition the retry queue.', termRefs: ['fin.payment-retry-budget', 'fin.nostro-account', 'fin.exception-queue'] },
        ],
        bodies: [
                { bodyKey: 'underwriting-desk', summary: 'The desk that underwrites applications and drafts conditions.', roleRefs: ['mortgage-underwriter', 'credit-analyst'] },
                { bodyKey: 'compliance-desk', summary: 'The desk that files the regulatory reports.', roleRefs: ['compliance-reporter', 'credit-analyst'] },
                { bodyKey: 'reconciliation-desk', summary: 'The desk that investigates ledger breaks and closes them.', roleRefs: ['reconciliation-analyst', 'credit-analyst'] },
                { bodyKey: 'payments-operations-desk', summary: 'The desk that triages failed payments and manages the retry queue.', roleRefs: ['payments-ops-specialist', 'treasury-desk-operator'] },
        ],
        packs: [
                { packKey: 'underwriting-pack', summary: 'The underwriting capability pack.', bodyRefs: ['underwriting-desk'] },
                { packKey: 'regulatory-reporting-pack', summary: 'The regulatory reporting capability pack.', bodyRefs: ['compliance-desk'] },
                { packKey: 'reconciliation-ops-pack', summary: 'The reconciliation operations capability pack.', bodyRefs: ['reconciliation-desk'] },
                { packKey: 'payments-triage-pack', summary: 'The payments triage capability pack.', bodyRefs: ['payments-operations-desk'] },
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
                {
                        profileKey: 'payments-operations',
                        summary: 'The payments operations policy profile.',
                        permissionRefs: ['read-files', 'execute-command'],
                        approvalTiers: ['moderate', 'high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'cost'],
                },
        ],
        benchmark: {
                bindingMode: 'industry-extension-registry',
                entry: {
                        benchmarkKey: 'lending-operations-health',
                        summary: 'The lending operations health benchmark.',
                        hypothesis: 'A composed finance agent organization completes the seeded finance fixture scenarios with a higher success rate than the single-agent baseline.',
                        scenarioRefs: REAL_FINANCE_SCENARIO_IDS,
                        kpiDimensions: ['success', 'quality'],
                        expectedOutcome: 'The candidate clears every acceptance criterion on the majority of seeded instances per scenario.',
                        limitations: 'Fixture worlds over a synthetic finance-operations layout; no real telemetry, no live ledgers, single-corpora runs only; bound through the lab industry extension registry (the combined catalog).',
                        evidenceLevel: 'fixture',
                },
        },
        expectedGaps: FINANCE_EXPECTED_GAPS,
};

/** The frozen curated finance acceptance fixture (the ONLY export of this pure-data module). */
export const FINANCE_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(financeFixture);
