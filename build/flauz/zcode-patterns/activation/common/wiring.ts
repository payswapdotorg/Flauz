/*
 * MIT License
 * Copyright (c) 2025 the Flauz contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * CR-001 - the Runtime Activation Spine: the typed WiringMap.
 *
 * Pure data + types only. This module imports NOTHING (the sibling law). The
 * pure resolvers live in common/coverage.ts; the machine-checks live in
 * test/common/wiring.test.ts.
 *
 * DRAFT STATUS (emitted before the disk survey returned):
 * - contractModules lists mix ORDER-VOUCHED paths (cited verbatim by the work
 *   order) with PATTERN-INFERRED paths (the <subtree>/common/<family>.ts layout
 *   inferred from build/flauz/zcode-patterns/memory/common/scoping.ts and
 *   build/flauz/zcode-patterns/common/hooks.ts). They are NOT disk-verified
 *   yet; the coverage walk (no orphans, no phantoms) and the existence matrix
 *   machine-check every path the moment the battery runs, and the lists MUST
 *   be reconciled with the on-disk enumeration before commit. THE DISK WINS.
 * - ZC-001 is the only 'wired' entry; its 'simulated' label rests on the work
 *   order's own account of the dogfood seams and is flagged for station
 *   re-review (a promoted label is a voiding offense).
 */

export const ACTIVATION_CONTRACTS_VERSION = '1.0.0';

export type WiringState = 'wired' | 'gap';

export type AuthorityId =
        | 'AGENT_OS'
        | 'WORKSPACE_OS'
        | 'EXECUTION'
        | 'WORKFLOW'
        | 'MEMORY'
        | 'LAB'
        | 'BROWSER'
        | 'MODELS'
        | 'RESOURCES'
        | 'INTEGRITY'
        | 'ENVIRONMENTS'
        | 'ACCEPTANCE'
        | 'CAPABILITY_EXCHANGE';

export interface RuntimeEntryPoint {
        path: string;
        exportName?: string;
        role: string;
}

export interface WiringEntry {
        capabilityId: string;
        title: string;
        contractModules: string[];
        authority: AuthorityId;
        state: WiringState;
        entryPoints: RuntimeEntryPoint[];
        stateSource: string;
        projection: string;
        tests: string[];
        evidence: 'fixture' | 'simulated' | 'local-real' | 'runtime-real' | 'live-provider' | 'production-real';
        gapOwner?: 'CR-002' | 'CR-003' | 'CR-004' | 'CR-005' | 'CR-006' | 'CR-007' | 'CR-008' | 'CR-009' | 'CR-010';
        gapNote?: string;
}

export interface AuthorityRecord {
        owner: string;
        root: string;
        note: string;
}

export const AUTHORITIES: Record<AuthorityId, AuthorityRecord> = {
        AGENT_OS: {
                owner: 'flauz-agent',
                root: 'extensions/flauz-agent',
                note: 'The agent operating system: the orchestration store, the A2A seams, and the service/runtime/policy/recovery/routing cores.'
        },
        WORKSPACE_OS: {
                owner: 'flauz-workspace',
                root: 'extensions/flauz-workspace',
                note: 'The workspace authority: the workspace API surface and its projections.'
        },
        EXECUTION: {
                owner: 'flauz-execution',
                root: 'extensions/flauz-execution',
                note: 'The execution authority: contracts, runtime, journal, acquisition, adapters, continuity.'
        },
        WORKFLOW: {
                owner: 'flauz-workflow',
                root: 'extensions/flauz-workflow',
                note: 'The workflow authority: workflow runtime ownership.'
        },
        MEMORY: {
                owner: 'flauz-memory',
                root: 'extensions/flauz-memory',
                note: 'The memory authority: the real store (src/memory.ts) and its lifecycle.'
        },
        LAB: {
                owner: 'flauz-lab',
                root: 'extensions/flauz-lab',
                note: 'The lab authority: experiment and lab runtime ownership.'
        },
        BROWSER: {
                owner: 'flauz-browser',
                root: 'extensions/flauz-browser',
                note: 'The browser authority: browser automation runtime ownership.'
        },
        MODELS: {
                owner: 'flauz-models',
                root: 'extensions/flauz-models',
                note: 'The models authority: model and provider surface ownership.'
        },
        RESOURCES: {
                owner: 'flauz-resources',
                root: 'extensions/flauz-resources',
                note: 'The resources authority: tool and resource execution ownership.'
        },
        INTEGRITY: {
                owner: 'flauz-integrity',
                root: 'extensions/flauz-integrity',
                note: 'The integrity authority: verification and integrity gating ownership.'
        },
        ENVIRONMENTS: {
                owner: 'flauz-environments',
                root: 'extensions/flauz-environments',
                note: 'The environments authority: environment provisioning ownership.'
        },
        ACCEPTANCE: {
                owner: 'flauz-acceptance',
                root: 'extensions/flauz-acceptance',
                note: 'The acceptance authority: acceptance evidence, gates, and parity matrices.'
        },
        CAPABILITY_EXCHANGE: {
                owner: 'build/flauz/capabilities',
                root: 'build/flauz/capabilities',
                note: 'The capability exchange: packs, sources, and commands.'
        }
};

export const WIRING: WiringEntry[] = [
        {
                capabilityId: 'ZC-001',
                title: 'Common contract families: the typed projections over the live runtime surface',
                contractModules: [
                        'build/flauz/zcode-patterns/common/backgroundAgent.ts',
                        'build/flauz/zcode-patterns/common/hooks.ts',
                        'build/flauz/zcode-patterns/common/memoryProjection.ts',
                        'build/flauz/zcode-patterns/common/planContinuity.ts',
                        'build/flauz/zcode-patterns/common/replayResume.ts',
                        'build/flauz/zcode-patterns/common/runHealth.ts'
                ],
                authority: 'AGENT_OS',
                state: 'gap',
                entryPoints: [],
                stateSource: 'extensions/flauz-agent/src/types.ts + core/orchStore.mjs + core/a2a.mjs + extensions/flauz-workspace/src/api.ts + extensions/flauz-execution/src/contracts.ts - the AUTHORITIES are live and dogfood-exercised (simulated evidence); the ZC-001 PROJECTION modules themselves have no runtime consumer yet',
                projection: 'none yet - the projections are test-pinned only; the background-agent UX runtime (CR-002) is the first intended consumer of backgroundAgent.ts/runHealth.ts, the observatory (CR-004) of planContinuity.ts/replayResume.ts, the memory runtime (CR-005) of memoryProjection.ts',
                tests: [
                        'build/flauz/zcode-patterns/test/common/backgroundAgent.test.ts'
                ],
                evidence: 'fixture',
                gapOwner: 'CR-002',
                gapNote: 'the six projection modules exist and their ZC-001 suite pins them against the authorities (fixture evidence), but no runtime module imports them; activation lands with the CR-002/CR-004/CR-005 runtimes that consume these projections'
        },
        {
                capabilityId: 'ZC-002',
                title: 'Background agent contracts: launch, inspect, message, control, outcome, registryView',
                contractModules: [
                        'build/flauz/capabilities/background-agent/common/launch.ts',
                        'build/flauz/capabilities/background-agent/common/inspect.ts',
                        'build/flauz/capabilities/background-agent/common/message.ts',
                        'build/flauz/capabilities/background-agent/common/control.ts',
                        'build/flauz/capabilities/background-agent/common/outcome.ts',
                        'build/flauz/capabilities/background-agent/common/registryView.ts'
                ],
                authority: 'AGENT_OS',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/capabilities/background-agent/** - contract-only; no runtime state backs it yet',
                projection: 'none yet - CR-002',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-002',
                gapNote: 'The launch/inspect/message/control/outcome/registryView families are contract-only today: no extensions/flauz-agent runtime module consumes or enforces them. CR-002 owns activating them against the agent core seams (service.mjs, runtime.mjs, orchMediator.mjs).'
        },
        {
                capabilityId: 'ZC-003',
                title: 'Hook bus contracts: registration, dispatch, effects, policy',
                contractModules: [
                        'build/flauz/zcode-patterns/hook-bus/common/registration.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/dispatch.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/effects.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/policy.ts'
                ],
                authority: 'AGENT_OS',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/zcode-patterns/hook-bus/** - contract-only; the runtime has no live emission points yet',
                projection: 'none yet - CR-003',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-003',
                gapNote: 'The registration/dispatch/effects/policy families have no live emission points in the runtime today. CR-003 owns wiring the bus into the agent core emission seams.'
        },
        {
                capabilityId: 'ZC-004',
                title: 'Observatory contracts: planMode, phases, runHealth, replay',
                contractModules: [
                        'build/flauz/zcode-patterns/observatory/common/planMode.ts',
                        'build/flauz/zcode-patterns/observatory/common/phases.ts',
                        'build/flauz/zcode-patterns/observatory/common/runHealth.ts',
                        'build/flauz/zcode-patterns/observatory/common/replay.ts'
                ],
                authority: 'EXECUTION',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/zcode-patterns/observatory/** - contract-only; the journal authority holds the real state',
                projection: 'none yet - CR-004',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-004',
                gapNote: 'The planMode/phases/runHealth/replay families project the journal authority (extensions/flauz-execution/src/journal.ts), but no store read path consumes the contracts yet. CR-004 owns the journal-side activation.'
        },
        {
                capabilityId: 'ZC-005',
                title: 'Memory contracts: scoping, enablement, entry, lifecycle',
                contractModules: [
                        'build/flauz/zcode-patterns/memory/common/scoping.ts',
                        'build/flauz/zcode-patterns/memory/common/enablement.ts',
                        'build/flauz/zcode-patterns/memory/common/entry.ts',
                        'build/flauz/zcode-patterns/memory/common/lifecycle.ts'
                ],
                authority: 'MEMORY',
                state: 'gap',
                entryPoints: [],
                stateSource: 'extensions/flauz-memory/src/memory.ts - the real store; the contracts are not consumed by it yet',
                projection: 'none yet - CR-005',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-005',
                gapNote: 'The real store lives at extensions/flauz-memory/src/memory.ts; the scoping/enablement/entry/lifecycle families are not yet consumed or enforced by it. CR-005 owns the store-side activation.'
        },
        {
                capabilityId: 'ZC-006',
                title: 'Capability packs contracts: pack, verification, catalog',
                contractModules: [
                        'build/flauz/capabilities/packs/common/pack.ts',
                        'build/flauz/capabilities/packs/common/verification.ts',
                        'build/flauz/capabilities/packs/common/catalog.ts'
                ],
                authority: 'CAPABILITY_EXCHANGE',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/capabilities/packs/** - contract-only',
                projection: 'none yet - CR-006',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-006',
                gapNote: 'The pack/verification/catalog families are contract-only today; no exchange runtime consumes them. CR-006 owns the activation.'
        },
        {
                capabilityId: 'ZC-007',
                title: 'Capability sources contracts: source, adapter, import',
                contractModules: [
                        'build/flauz/capabilities/sources/common/source.ts',
                        'build/flauz/capabilities/sources/common/adapter.ts',
                        'build/flauz/capabilities/sources/common/import.ts'
                ],
                authority: 'CAPABILITY_EXCHANGE',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/capabilities/sources/** - contract-only',
                projection: 'none yet - CR-007',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-007',
                gapNote: 'The source/adapter/import families are contract-only today; no exchange runtime consumes them. CR-007 owns the activation.'
        },
        {
                capabilityId: 'ZC-008',
                title: 'Capability commands contracts: compound, mirror, facade',
                contractModules: [
                        'build/flauz/capabilities/commands/common/compound.ts',
                        'build/flauz/capabilities/commands/common/mirror.ts',
                        'build/flauz/capabilities/commands/common/facade.ts'
                ],
                authority: 'RESOURCES',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/capabilities/commands/** - contract-only',
                projection: 'none yet - CR-008',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-008',
                gapNote: 'The compound/mirror/facade families are contract-only today. Judged against AGENT_OS + RESOURCES with RESOURCES holding the single runtime ownership of tool/resource execution (see REPORT deviations). CR-008 owns the activation.'
        },
        {
                capabilityId: 'ZC-009',
                title: 'CLI contracts: grammar, wire, exitcodes, parity',
                contractModules: [
                        'build/flauz/zcode-patterns/cli/common/grammar.ts',
                        'build/flauz/zcode-patterns/cli/common/wire.ts',
                        'build/flauz/zcode-patterns/cli/common/exitcodes.ts',
                        'build/flauz/zcode-patterns/cli/common/parity.ts'
                ],
                authority: 'AGENT_OS',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/zcode-patterns/cli/** - contract-only',
                projection: 'none yet - CR-009',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-009',
                gapNote: 'The CLI families are a client of the service journeys; no service module consumes or enforces them yet. CR-009 owns the service-side activation.'
        },
        {
                capabilityId: 'ZC-010',
                title: 'Parity contracts: discovery, evidence, gate, matrix',
                contractModules: [
                        'build/flauz/zcode-patterns/parity/common/discovery.ts',
                        'build/flauz/zcode-patterns/parity/common/evidence.ts',
                        'build/flauz/zcode-patterns/parity/common/gate.ts',
                        'build/flauz/zcode-patterns/parity/common/matrix.ts'
                ],
                authority: 'ACCEPTANCE',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/zcode-patterns/parity/** - contract-only',
                projection: 'none yet - CR-010',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-010',
                gapNote: 'The discovery/evidence/gate/matrix families are contract-only today. Judged against ACCEPTANCE/INTEGRITY with ACCEPTANCE holding gate ownership (see REPORT deviations). CR-010 owns the activation.'
        }
];