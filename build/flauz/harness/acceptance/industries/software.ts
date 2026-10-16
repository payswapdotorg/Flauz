/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * THE SOFTWARE INDUSTRY ACCEPTANCE FIXTURE (DH-013, the first of the
 * four curated representative fixture sets; deepened to the declared
 * censused representativeness bar by the DH-GAP-2 wave).
 *
 * THE CONTENT DISCLOSURE (binding, verbatim from the family charter):
 * this is a CURATED FIXTURE-LEVEL acceptance content set -
 * representative, honestly labeled at the declared censused bar (six
 * roles, ten terms, four tasks, four bodies, four packs, two
 * profiles); NOT a claim of comprehensive domain truth, NOT promoted
 * evidence. The entries are the REAL owning families' own shapes
 * (DH-02 profile, DH-03 roles, DH-04 terms, DH-05 tasks, DH-06
 * bodies, DH-07 packs, DH-08 profiles, DH-09 benchmark) and every
 * vocabulary member is REAL.
 *
 * THE SCENARIO-BINDING LAW: the curated benchmark is the BASE-REGISTRY
 * binding (the plain BenchmarkEntry shape) - it binds the REAL three
 * SE fixture scenarios, the ids DERIVED from the REAL landed
 * TASK_WORLDS registry by import (never a transcribed list). Because
 * the software fixture carries the curated benchmark, its benchmark
 * leg is EVALUATED and it does NOT register the CLOSED
 * 'lab-task-worlds-coverage' row (its closure is recorded IN the
 * ledger row); the closed 'content-representativeness' row is
 * registered by none (the censused bar is met by construction); the
 * closed 'no-live-provider-execution' row is registered by none (the
 * INF-009 canary's station-verified live-real exchange closed it at
 * the INF boundary 2026-10-16 - this family's own task-execution
 * evidence ceiling stays fixture-labeled, never promoted).
 *
 * This module is PURE DATA: it exports ONLY the frozen fixture (no
 * functions, no code paths - THE COMPOSITION-NOT-FORK LAW: the
 * industries differ only in data).
 */

import { TASK_WORLDS } from '../../../lab/common/taskWorlds.js';
import { HARNESS_ACCEPTANCE_GAP_LEDGER } from '../common/acceptanceContract.js';
import type { AcceptanceGapRow, IndustryAcceptanceFixture } from '../common/acceptanceContract.js';

/** THE SCENARIO-BINDING LAW's pin-by-import: the REAL three SE scenario ids, derived from the REAL landed base registry. */
const REAL_SE_SCENARIO_IDS: readonly string[] = TASK_WORLDS.flatMap((world) => world.taskScenarios.map((scenario) => scenario.id));

/** The honest gaps the software industry registers: the three OPEN ledger rows (the closed rows 1-3 are registered by none - their closures are recorded IN the ledger rows). */
const SOFTWARE_EXPECTED_GAPS: readonly AcceptanceGapRow[] = HARNESS_ACCEPTANCE_GAP_LEDGER.filter((row) => row.gapKey !== 'lab-task-worlds-coverage' && row.gapKey !== 'content-representativeness' && row.gapKey !== 'no-live-provider-execution');

const softwareFixture: IndustryAcceptanceFixture = {
        industry: 'software',
        companyProfile: {
                displayName: 'fixture software engineering harness co',
                sizeBand: 'small',
        },
        workTypes: ['analysis', 'drafting', 'review'],
        roles: [
                { roleKey: 'code-reviewer', summary: 'Reviews change sets against the regression suite and the API guidelines.' },
                { roleKey: 'feature-implementer', summary: 'Implements bounded features with test coverage before review.' },
                { roleKey: 'release-verifier', summary: 'Verifies release candidates and guards the merge queue.' },
                { roleKey: 'build-engineer', summary: 'Owns the build pipeline stages from commit to packaged artifact.' },
                { roleKey: 'test-automation-engineer', summary: 'Maintains the automated test suites and triages coverage gaps.' },
                { roleKey: 'incident-responder', summary: 'Takes the on-call rotation and drives production incidents to closure.' },
        ],
        terms: [
                { term: 'se.regression-suite', definition: 'The executable suite that must stay green after every change.' },
                { term: 'se.merge-queue', definition: 'The ordered queue that lands reviewed changes onto the mainline.' },
                { term: 'se.flaky-test', definition: 'A test whose outcome varies without a code change.' },
                { term: 'se.release-candidate', definition: 'A build promoted for release verification.' },
                { term: 'se.code-review', definition: 'The reviewer pass that gates the merge queue.' },
                { term: 'se.build-pipeline', definition: 'The staged automation that builds, tests and packages every commit.' },
                { term: 'se.canary-deploy', definition: 'The staged rollout that ships a release to a small slice first.' },
                { term: 'se.test-coverage-gap', definition: 'A behavior with no automated test exercising it.' },
                { term: 'se.incident-postmortem', definition: 'The blameless write-up that closes a production incident.' },
                { term: 'se.api-contract', definition: 'The published interface agreement between two services.' },
        ],
        tasks: [
                { taskKey: 'regression-fix', summary: 'Diagnose a regression, land the fix and guard it with tests.', termRefs: ['se.regression-suite', 'se.flaky-test'] },
                { taskKey: 'feature-rollout', summary: 'Ship a bounded feature through review and release verification.', termRefs: ['se.merge-queue', 'se.release-candidate', 'se.code-review'] },
                { taskKey: 'harden-test-coverage', summary: 'Close a coverage gap with a new automated test and review it.', termRefs: ['se.test-coverage-gap', 'se.regression-suite', 'se.code-review'] },
                { taskKey: 'respond-production-incident', summary: 'Triage a production alert, mitigate, and write the postmortem.', termRefs: ['se.incident-postmortem', 'se.canary-deploy', 'se.build-pipeline'] },
        ],
        bodies: [
                { bodyKey: 'triage-engineer', summary: 'Triages incoming regressions and drafts the fix.', roleRefs: ['feature-implementer', 'code-reviewer'] },
                { bodyKey: 'release-guardian', summary: 'Guards the release candidate and the merge queue.', roleRefs: ['release-verifier', 'code-reviewer'] },
                { bodyKey: 'platform-reliability-desk', summary: 'Owns the build pipeline and the on-call incident rotation.', roleRefs: ['build-engineer', 'incident-responder'] },
                { bodyKey: 'quality-enablement-desk', summary: 'Owns the test suites and the coverage program.', roleRefs: ['test-automation-engineer', 'code-reviewer'] },
        ],
        packs: [
                { packKey: 'core-dev-pack', summary: 'The core development capability pack.', bodyRefs: ['triage-engineer'] },
                { packKey: 'release-verification-pack', summary: 'The release verification capability pack.', bodyRefs: ['release-guardian'] },
                { packKey: 'platform-operations-pack', summary: 'The pipeline and incident operations capability pack.', bodyRefs: ['platform-reliability-desk'] },
                { packKey: 'test-automation-pack', summary: 'The test automation capability pack.', bodyRefs: ['quality-enablement-desk'] },
        ],
        profiles: [
                {
                        profileKey: 'default-engineering',
                        summary: 'The default software engineering policy profile.',
                        permissionRefs: ['read-files', 'execute-command'],
                        approvalTiers: ['moderate', 'high'],
                        evidenceFloor: 'local-real',
                        kpiDimensions: ['success', 'quality'],
                },
                {
                        profileKey: 'platform-reliability',
                        summary: 'The platform reliability policy profile.',
                        permissionRefs: ['read-files', 'network-access'],
                        approvalTiers: ['high'],
                        evidenceFloor: 'simulated',
                        kpiDimensions: ['success', 'latency'],
                },
        ],
        benchmark: {
                benchmarkKey: 'regression-suite-health',
                summary: 'The regression suite health benchmark.',
                hypothesis: 'A composed agent organization completes the seeded regression-fix scenarios with a higher success rate than the single-agent baseline.',
                scenarioRefs: REAL_SE_SCENARIO_IDS,
                kpiDimensions: ['success', 'quality'],
                expectedOutcome: 'The candidate clears every acceptance criterion on the majority of seeded instances per scenario.',
                limitations: 'Fixture worlds over a synthetic repository; no real telemetry, no live repositories, single-corpora runs only.',
                evidenceLevel: 'fixture',
        },
        expectedGaps: SOFTWARE_EXPECTED_GAPS,
};

/** The frozen curated software acceptance fixture (the ONLY export of this pure-data module). */
export const SOFTWARE_ACCEPTANCE_FIXTURE: Readonly<IndustryAcceptanceFixture> = Object.freeze(softwareFixture);
