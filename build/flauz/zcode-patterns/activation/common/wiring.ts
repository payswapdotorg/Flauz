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
                gapNote: 'Terminal CR-013 walk verdict: the runtimes routed as these projections\' consumers all landed binding their own authorities DIRECTLY and none imports any of the six modules -- the CR-002 background-agent runtime (bgAgent.mjs over the real OrchestrationStore + A2ABus), the CR-004 observatory (over the real TaskService + ExecJournalStore), the CR-005 memory runtime (over the real tiered MemoryStore); the projection family remains test-pinned only (zcode-patterns/test/common/*.test.ts, fixture evidence). This is the map-vs-runtime delta the gap ledger exists to expose -- recorded by CR-013 as the terminal state.'
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
                gapNote: 'Terminal CR-013 walk verdict: the CR-002 runtime landed self-contained -- capabilities/background-agent/runtime/bgAgent.mjs binds the real OrchestrationStore + A2ABus directly through validated non-literal dynamic imports and imports NONE of the six launch/inspect/message/control/outcome/registryView families; they remain test-pinned only (fixture evidence). This is the map-vs-runtime delta the gap ledger exists to expose -- recorded by CR-013 as the terminal state.'
        },
        {
                capabilityId: 'ZC-003',
                title: 'Hook bus contracts: registration, dispatch, effects, policy',
                contractModules: [
                        'build/flauz/zcode-patterns/hook-bus/common/registration.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/dispatch.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/effects.ts',
                        'build/flauz/zcode-patterns/hook-bus/common/policy.ts',
                        /* station repair (wave-3): the CR-003 runtime module is a
                         * contract-module-class .ts under the hook-bus subtree —
                         * the walk-law cites it (the R28 orphan-law class). */
                        'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.ts'
                ],
                authority: 'AGENT_OS',
                state: 'wired',
                entryPoints: [
                        {
                                path: 'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.ts',
                                exportName: 'bindHookBus',
                                role: 'the live runtime over the real OrchestrationStore journal + A2ABus: bind/register/dispatch/receipts/cursors'
                        }
                ],
                stateSource: 'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.ts - the live runtime over the real OrchestrationStore journal + A2ABus (bind/register/dispatch/receipts/cursors; the CR-003 landing 44739d49df6)',
                projection: 'the DispatchReport (translated HookEventRefs + contract-composed plans + receipts + the unmapped census) + the durable .flauz/hooks/ artifacts',
                tests: [
                        'build/flauz/zcode-patterns/hook-bus/runtime/hookBus.test.ts'
                ],
                evidence: 'local-real',
                /* the deliberate flip per the R28 map-staleness routing: CR-003
                 * (the gap owner) landed its runtime consumer — the entry point
                 * is cited, the tests are local-real (real store/bus/fs +
                 * injected clock, 54/54). */
        },
        {
                capabilityId: 'ZC-004',
                title: 'Observatory contracts: planMode, phases, runHealth, replay',
                contractModules: [
                        'build/flauz/zcode-patterns/observatory/common/planMode.ts',
                        'build/flauz/zcode-patterns/observatory/common/phases.ts',
                        'build/flauz/zcode-patterns/observatory/common/runHealth.ts',
                        'build/flauz/zcode-patterns/observatory/common/replay.ts',
                        /* station flip (wave-5): the CR-004 runtime module is a
                         * contract-module-class .ts under the observatory subtree —
                         * the walk-law cites it (the ZC-003 orphan-law precedent). */
                        'build/flauz/zcode-patterns/observatory/runtime/observatory.ts'
                ],
                authority: 'EXECUTION',
                state: 'wired',
                entryPoints: [
                        {
                                path: 'build/flauz/zcode-patterns/observatory/runtime/observatory.ts',
                                exportName: 'ObservatoryRuntime',
                                role: 'the live runtime over the real agent task authority (TaskService) + the real execution journal authority (ExecJournalStore): the planMode/phases/runHealth projections + the deterministic cold-replay drill'
                        }
                ],
                stateSource: 'build/flauz/zcode-patterns/observatory/runtime/observatory.ts - the live runtime over the real TaskService (extensions/flauz-workspace/src/taskService.ts) + ExecJournalStore (extensions/flauz-execution/src/journal.ts) with the injected fs/clock ports; the planMode/phases/runHealth projections and the cold-replay drill ride the four frozen contract modules; the CR-004 landing',
                projection: 'the plan-mode views with the evidence-edge trail + the typed drift verdicts + the phase descriptors over the graph journal rows + the stall/concurrency gauge over the live task records + the cold-replay drill pinned to the journal head hash (restart-deterministic)',
                tests: [
                        'build/flauz/zcode-patterns/observatory/runtime/observatory.test.ts'
                ],
                evidence: 'local-real',
                /* the deliberate flip per the R28 map-staleness routing: CR-004
                 * (the gap owner) landed its runtime consumer — the entry point
                 * is cited, the tests are local-real (real TaskService + real
                 * ExecJournalStore + injected clock, 49/49). */
        },
        {
                capabilityId: 'ZC-005',
                title: 'Memory contracts: scoping, enablement, entry, lifecycle',
                contractModules: [
                        'build/flauz/zcode-patterns/memory/common/scoping.ts',
                        'build/flauz/zcode-patterns/memory/common/enablement.ts',
                        'build/flauz/zcode-patterns/memory/common/entry.ts',
                        'build/flauz/zcode-patterns/memory/common/lifecycle.ts',
                        /* station flip (wave-4): the CR-005 runtime module is a
                         * contract-module-class .ts under the memory subtree —
                         * the walk-law cites it (the ZC-003 orphan-law precedent). */
                        'build/flauz/zcode-patterns/memory/runtime/memoryRuntime.ts'
                ],
                authority: 'MEMORY',
                state: 'wired',
                entryPoints: [
                        {
                                path: 'build/flauz/zcode-patterns/memory/runtime/memoryRuntime.ts',
                                exportName: 'MemoryRuntime',
                                role: 'the live runtime over the real tiered MemoryStore: the enablement gate, the disclosed scope-tier bridge, fail-closed admission, retention/export over the sanctioned lanes'
                        }
                ],
                stateSource: 'build/flauz/zcode-patterns/memory/runtime/memoryRuntime.ts - the live runtime over the real tiered MemoryStore (extensions/flauz-memory/src/memory.ts; the enablement gate + the scope-tier bridge + fail-closed admission + retention/export; the CR-005 landing)',
                projection: 'the enablement audit journal + the bridge-disclosed read models + the retention/export receipts over the store journals',
                tests: [
                        'build/flauz/zcode-patterns/memory/runtime/memoryRuntime.test.ts'
                ],
                evidence: 'local-real',
                /* the deliberate flip per the R28 map-staleness routing: CR-005
                 * (the gap owner) landed its runtime consumer — the entry point
                 * is cited, the tests are local-real (real store/fs + injected
                 * clock, 66/66). */
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
                gapNote: 'Terminal CR-013 walk verdict: the exchange runtimes landed binding the authorities DIRECTLY, not through this family -- the CR-006 registry runtime (registry.mjs over its own frozen state.mjs tables) and the CR-008 gate (gate.ts imports only registry.mjs; its packs references are transcribed comments, never imports); the pack/verification/catalog families remain test-pinned only (fixture evidence). This is the map-vs-runtime delta the gap ledger exists to expose -- recorded by CR-013 as the terminal state.'
        },
        {
                capabilityId: 'ZC-007',
                title: 'Capability sources contracts: source, adapter, import',
                contractModules: [
                        'build/flauz/capabilities/sources/common/source.ts',
                        'build/flauz/capabilities/sources/common/adapter.ts',
                        'build/flauz/capabilities/sources/common/import.ts',
                        // CR-007 wave-2 additions (station repair 2026-10-06, R28):
                        // the four deterministic fixture adapters + the kit's adapter
                        // surface module are non-test .ts modules under this subtree,
                        // so the orphan law requires them to be cited here.
                        'build/flauz/capabilities/sources/adapters/sources/adapters.ts',
                        'build/flauz/capabilities/sources/adapters/sources/composio.ts',
                        'build/flauz/capabilities/sources/adapters/sources/direct.ts',
                        'build/flauz/capabilities/sources/adapters/sources/mcpSkills.ts',
                        'build/flauz/capabilities/sources/adapters/sources/printingPress.ts'
                ],
                authority: 'CAPABILITY_EXCHANGE',
                state: 'gap',
                entryPoints: [],
                stateSource: 'build/flauz/capabilities/sources/** - contract-only',
                projection: 'none yet - CR-007',
                tests: [],
                evidence: 'fixture',
                gapOwner: 'CR-007',
                gapNote: 'Terminal CR-013 walk verdict: the CR-007 adapter kit (sources/adapters/sources/*.ts -- the four deterministic fixture adapters + the kit surface) landed binding the source seams directly and is itself consumed only by its own tests; the source/adapter/import families remain test-pinned only (fixture evidence) with zero non-test consumers. This is the map-vs-runtime delta the gap ledger exists to expose -- recorded by CR-013 as the terminal state.'
        },
        {
                capabilityId: 'ZC-008',
                title: 'Capability commands contracts: compound, mirror, facade',
                contractModules: [
                        'build/flauz/capabilities/commands/common/compound.ts',
                        'build/flauz/capabilities/commands/common/mirror.ts',
                        'build/flauz/capabilities/commands/common/facade.ts',
                        /* station flip (wave-5): the CR-009 runtime module is a
                         * contract-module-class .ts under the commands subtree —
                         * the walk-law cites it (the ZC-003 orphan-law precedent,
                         * exactly as the ZC-004 flip cited the observatory runtime). */
                        'build/flauz/capabilities/commands/runtime/commandFacade.ts'
                ],
                authority: 'RESOURCES',
                state: 'wired',
                entryPoints: [
                        {
                                path: 'build/flauz/capabilities/commands/runtime/commandFacade.ts',
                                exportName: 'CommandFacadeRuntime',
                                role: 'the live runtime over the real CR-006 registry + the real CR-008 gate + the real approval lane (the CR-002 orchStore pattern): the facade routing/admission/receipt layer with the safe local mirrors anchored on the registry journal position'
                        }
                ],
                stateSource: 'build/flauz/capabilities/commands/runtime/commandFacade.ts - the live runtime over the real capability-exchange registry (registry.mjs: the read surface the mirrors serve + the availability truth + the journal-position freshness anchor, read through fresh instances per operation) + the real verification/permission gate (gate.ts: the permission truth, one instance per binding per the gate law 4.1) + the real approval lane (extensions/flauz-agent/core/orchStore.mjs: the CR-002 approval-requested -> approval-decided transitions with the frozen actor vocabulary); every table/guard/verdict rides the three frozen contract modules (compound/mirror/facade, namespace-imported with .ts specifiers); the CR-009 landing',
                projection: 'the facade receipts (the contract routing verdicts + the deterministic deriveFacadeReceiptsDigest fold) + the provenance-bearing compound execution records (the step receipt trails with their SideEffectDisclosures + the approval-lane rows over the runtime\'s own graphs) + the local mirrors with their typed invalidateMirror receipts over the registry journal position',
                tests: [
                        'build/flauz/capabilities/commands/runtime/commandFacade.test.ts'
                ],
                evidence: 'local-real',
                /* the deliberate flip per the R28 map-staleness routing: the entry's
                 * stale gapOwner 'CR-008' predates the wave replanning — the CR-008
                 * wave landed the gate (the permission truth this runtime derives),
                 * and the CR-009 wave lands the runtime consumer. The entry point
                 * is cited, the tests are local-real (real registry + real gate +
                 * the real approval lane + injected clock, 38/38), exactly as the
                 * ZC-003/ZC-004/ZC-005 flips disclosed their own routings. */
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
                state: 'wired',
                entryPoints: [
                        {
                                path: 'build/flauz/cli/bin/flauz.ts',
                                exportName: 'runCli',
                                role: 'the live CLI runtime entry: the grammar-driven parse layer, the typed wire builder, the exitcodes reconciliation, and the deterministic renders (json/table/digest), routing every command through the real service-context port (cli/runtime/context.ts: the real registry read surface + the real OrchestrationStore/A2ABus seams) with the CR-009 observatory handlers over the real ExecJournalStore'
                        }
                ],
                stateSource: 'build/flauz/cli/bin/flauz.ts - the live CLI runtime (runCli): the bin entry VALUE-imports the frozen grammar/wire/exitcodes contracts; cli/runtime/handlers.ts additionally TYPE-imports wire.ts; cli/runtime/context.ts TYPE-imports exitcodes.ts (HeadlessMode); the parity family is consumed by the journey battery harness (journey/battery/battery.ts: CLI_COMMAND_GRAMMAR + projectParity) -- the parity view\'s designed surface; the CR-010/CR-010b CLI landing with the CR-009 observatory handlers riding the same runtime; the CR-013 terminal-walk flip',
                projection: 'the rendered CLI responses (the canonical json wire shape + the deterministic table + the sha256 digest render) + the typed-refusal battery (16 wired + 13 typed refusals, no drift) + the parity view projection over run receipts',
                tests: [
                        'build/flauz/cli/cli.test.ts'
                ],
                evidence: 'local-real',
                /* the deliberate flip per the wave-2 record's routed-forward
                 * decision ("flipping it is an evidence-label decision the next
                 * wave should make deliberately when it cites the runtimes as
                 * entry points") -- CR-013 is that wave and the disk walk is
                 * the evidence: the CLI bin (a non-test runtime module)
                 * VALUE-imports grammar.ts + wire.ts + exitcodes.ts, the
                 * pinning suite cli/cli.test.ts runs 60/60 local-real over
                 * the real seams (real store/registry/journal/observatory +
                 * injected clock), and the parity nuance is disclosed:
                 * parity.ts's consumer is the journey battery harness -- the
                 * parity view's designed surface (projectParity over run
                 * receipts), not the bin. The stale gapNote's "service-side"
                 * phrasing predates the CLI's own landing (CR-010/CR-010b):
                 * the wave replanning superseded the service-side activation
                 * it named -- the CLI landed as its own runtime consumer of
                 * these contracts, exactly as the ZC-008 flip disclosed its
                 * own stale-owner routing. The runtime module itself lives
                 * under build/flauz/cli (outside the map's cited subtree
                 * zcode-patterns/cli), so the orphan law does not cite it in
                 * contractModules -- it is cited here and in entryPoints. */
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
                gapNote: 'Terminal CR-013 walk verdict: zero non-test consumers of the discovery/evidence/gate/matrix families -- the runtime parity surface that landed is the CLI\'s own parity view (ZC-009\'s cli/common/parity.ts, projected by the CLI runtime and the journey battery), a different family; these four remain test-pinned only (fixture evidence). This is the map-vs-runtime delta the gap ledger exists to expose -- recorded by CR-013 as the terminal state.'
        }
];