/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-012 -- THE CROSS-INDUSTRY PROFILE FIXTURES (evidence label: fixture).
 *
 * LAWS:
 * - PURE DATA, NO BEHAVIOR: six frozen industry profiles. Each is a
 *   parameter set over the EXISTING journey/seam surfaces: the
 *   profiles NAME battery journey legs (never invent steps) and the
 *   lab's own frozen fixture vocabulary (never new worlds). This
 *   module imports NOTHING.
 * - THE ONE-SHAPE CAPABILITY LANE (deviation D1, disclosed): the
 *   registry's frozen artifact/permission vocabulary lives in
 *   state.mjs, which was never pasted into this lane; the only
 *   registry-validated shapes are the battery's J4 fixtures. The
 *   profiles therefore vary capability DENSITY (entryShare), never
 *   artifact KIND: sourceKind/artifactKind/platform/license/version
 *   and the permission set are locked at compile time to the
 *   J4-validated values.
 * - THE LAB PARAMETERS are frozen pasted vocabulary: scenario ids and
 *   task-type ids come from the lab's own fixture tables; utility
 *   weights are per-industry fixture decisions summing to 1 (the
 *   engine's own law); ladder levels cover 0/1/2.
 * - DETERMINISM: pure constants; no clock reads, no randomness.
 */

export const INDUSTRIES_VERSION = '1.0.0';

/** The honesty label of every profile record (never promoted). */
export type IndustryEvidenceLabel = 'fixture';

export interface IndustryTaskMix {
        readonly capability: number;
        readonly orchestration: number;
        readonly lab: number;
        readonly cli: number;
}

/** The J4-validated single capability shape (see the module header, deviation D1). */
export interface IndustryCapabilityNeeds {
        /** Registry pipelines driven per run (the registry share of entriesPerRun). */
        readonly entryShare: number;
        readonly sourceKind: 'community-project';
        readonly artifactKind: 'cli';
        readonly platform: 'linux-x64';
        readonly license: 'MIT';
        readonly version: '1.0.0';
        readonly permissions: readonly string[];
        readonly disclosure: string;
}

export interface IndustryLabParams {
        readonly scenarioId: 'scenario-se-bugfix-regression' | 'scenario-se-feature-addition' | 'scenario-se-flaky-investigation';
        readonly taskTypeId: 'tt-bugfix-regression' | 'tt-feature-addition' | 'tt-flaky-investigation';
        readonly ladderLevel: 0 | 1 | 2;
        readonly maxAgents: number;
        readonly instanceCount: number;
        readonly utilityWeights: Readonly<Record<'success' | 'quality' | 'latency' | 'cost', number>>;
}

export interface IndustryProfile {
        readonly id: string;
        readonly title: string;
        readonly description: string;
        readonly evidenceLabel: IndustryEvidenceLabel;
        readonly taskMix: IndustryTaskMix;
        readonly capabilityNeeds: IndustryCapabilityNeeds;
        /** Weights over REAL battery step ids only (validated by the harness and the tests). */
        readonly journeyLegWeights: Readonly<Record<string, number>>;
        readonly lab: IndustryLabParams;
        readonly seedBase: string;
}

const ONE_SHAPE_DISCLOSURE =
        'single J4-validated artifact shape (state.mjs vocabulary not pasted into this lane: profiles vary density, not kind)';

function deepFreeze<T>(value: T): T {
        if (value !== null && typeof value === 'object') {
                for (const key of Object.keys(value as Record<string, unknown>)) {
                        deepFreeze((value as Record<string, unknown>)[key]);
                }
                Object.freeze(value);
        }
        return value;
}

function profile(init: IndustryProfile): IndustryProfile {
        return deepFreeze(init);
}

export const INDUSTRY_PROFILES: readonly IndustryProfile[] = deepFreeze([
        profile({
                id: 'se-maintenance',
                title: 'software maintenance',
                description: 'bugfix and regression work: delegation-heavy coding journeys plus capability imports',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.25, orchestration: 0.45, lab: 0.2, cli: 0.1 },
                capabilityNeeds: {
                        entryShare: 4,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j1-s3-delegate': 3,
                        'j1-s4-background': 3,
                        'j1-s6-inspect-progress': 2,
                        'j4-s2-discover': 2,
                        'j4-s4-import': 2,
                        'j5-s1-long-task': 1,
                        'j5-s3-restart': 1,
                },
                lab: {
                        scenarioId: 'scenario-se-bugfix-regression',
                        taskTypeId: 'tt-bugfix-regression',
                        ladderLevel: 1,
                        maxAgents: 3,
                        instanceCount: 4,
                        utilityWeights: { success: 0.4, quality: 0.3, latency: 0.2, cost: 0.1 },
                },
                seedBase: 'se-maintenance',
        }),
        profile({
                id: 'content-ops',
                title: 'content operations',
                description: 'research-to-artifact pipelines with CLI-driven inspection',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.2, orchestration: 0.25, lab: 0.35, cli: 0.2 },
                capabilityNeeds: {
                        entryShare: 2,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j2-s1-research-task': 3,
                        'j2-s3-delegate': 2,
                        'j2-s8-artifact': 2,
                        'j6-s1-cli': 1,
                        'j6-s7-inspect': 1,
                },
                lab: {
                        scenarioId: 'scenario-se-feature-addition',
                        taskTypeId: 'tt-feature-addition',
                        ladderLevel: 0,
                        maxAgents: 2,
                        instanceCount: 4,
                        utilityWeights: { success: 0.3, quality: 0.4, latency: 0.1, cost: 0.2 },
                },
                seedBase: 'content-ops',
        }),
        profile({
                id: 'data-analysis',
                title: 'data analysis',
                description: 'multi-agent organization search and evaluation over the lab engine',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.15, orchestration: 0.3, lab: 0.45, cli: 0.1 },
                capabilityNeeds: {
                        entryShare: 3,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j3-s2-organization': 3,
                        'j3-s3-launch': 3,
                        'j3-s4-observe': 2,
                        'j2-s5-gather-evidence': 2,
                },
                lab: {
                        scenarioId: 'scenario-se-flaky-investigation',
                        taskTypeId: 'tt-flaky-investigation',
                        ladderLevel: 2,
                        maxAgents: 4,
                        instanceCount: 4,
                        utilityWeights: { success: 0.35, quality: 0.25, latency: 0.25, cost: 0.15 },
                },
                seedBase: 'data-analysis',
        }),
        profile({
                id: 'support-ops',
                title: 'support operations',
                description: 'approval-heavy human-in-the-loop flows over the CLI surface',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.3, orchestration: 0.3, lab: 0.15, cli: 0.25 },
                capabilityNeeds: {
                        entryShare: 2,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j1-s5-approve-tool': 3,
                        'j1-s7-review': 2,
                        'j6-s4-approval': 2,
                        'j4-s6-approval': 2,
                },
                lab: {
                        scenarioId: 'scenario-se-bugfix-regression',
                        taskTypeId: 'tt-bugfix-regression',
                        ladderLevel: 1,
                        maxAgents: 2,
                        instanceCount: 4,
                        utilityWeights: { success: 0.5, quality: 0.2, latency: 0.2, cost: 0.1 },
                },
                seedBase: 'support-ops',
        }),
        profile({
                id: 'compliance-audit',
                title: 'compliance audit',
                description: 'capability verification and unsafe-capability detection (the pending CR-008 legs are referenced, never executed)',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.45, orchestration: 0.25, lab: 0.15, cli: 0.15 },
                capabilityNeeds: {
                        entryShare: 6,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j4-s5-verify': 3,
                        'j4-s6-approval': 3,
                        'j7-s3-detect': 2,
                        'j7-s4-reject': 2,
                        'j5-s5-reconstruct': 1,
                },
                lab: {
                        scenarioId: 'scenario-se-feature-addition',
                        taskTypeId: 'tt-feature-addition',
                        ladderLevel: 0,
                        maxAgents: 3,
                        instanceCount: 4,
                        utilityWeights: { success: 0.25, quality: 0.35, latency: 0.15, cost: 0.25 },
                },
                seedBase: 'compliance-audit',
        }),
        profile({
                id: 'research-synthesis',
                title: 'research synthesis',
                description: 'lab-heavy multi-seed evaluation with memory persistence referenced (pending CR-005, echoed never executed)',
                evidenceLabel: 'fixture',
                taskMix: { capability: 0.1, orchestration: 0.3, lab: 0.5, cli: 0.1 },
                capabilityNeeds: {
                        entryShare: 2,
                        sourceKind: 'community-project',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        license: 'MIT',
                        version: '1.0.0',
                        permissions: ['read-files'],
                        disclosure: ONE_SHAPE_DISCLOSURE,
                },
                journeyLegWeights: {
                        'j2-s2-plan': 2,
                        'j2-s6-synthesize': 3,
                        'j2-s7-persist-memory': 2,
                        'j3-s5-intervene': 2,
                        'j3-s7-consolidate': 2,
                },
                lab: {
                        scenarioId: 'scenario-se-flaky-investigation',
                        taskTypeId: 'tt-flaky-investigation',
                        ladderLevel: 2,
                        maxAgents: 5,
                        instanceCount: 4,
                        utilityWeights: { success: 0.3, quality: 0.3, latency: 0.2, cost: 0.2 },
                },
                seedBase: 'research-synthesis',
        }),
]);

export const INDUSTRY_IDS: readonly string[] = Object.freeze(INDUSTRY_PROFILES.map((p) => p.id));