/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * CR-009 -- the command-facade runtime battery (mocha tdd, LOCAL-REAL:
 * the real CR-006 registry over a temp root + the real CR-008 gate + the
 * real approval lane (the CR-002 OrchestrationStore), everything through
 * the authorities' own public APIs, every timestamp from the injected
 * clock -- the memoryRuntime/observatory test discipline).
 *
 * The pins (the work order's minimum, and more):
 * - the routing verdicts for all three request kinds over real authority
 *   state: an unavailable capability refuses typed; a permission-denied
 *   gate refuses typed; a confirmation-gated compound step routes through
 *   the approval lane with the frozen actor vocabulary;
 * - compound admission at the MAX_COMPOUND_STEPS boundary (15 / 16 / 17);
 * - the receipt trail + digest determinism;
 * - mirror freshness at the inclusive boundaries (the exported thresholds
 *   are the pins) + invalidation on a real registry journal append;
 * - the SideEffectDisclosure on every effect-bearing receipt;
 * - determinism: two runs over identically-built roots produce identical
 *   projection bytes; no wall-clock or randomness anywhere (the
 *   law-comment grep).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRegistry } from '../../registry/registry.mjs';
import type { FsPort, RegistryRuntime } from '../../registry/registry.mjs';
import { createGate } from '../../gate/gate.ts';
import { OrchestrationStore } from '../../../../../extensions/flauz-agent/core/orchStore.mjs';
import {
        CommandFacadeError,
        CommandFacadeRuntime,
        FACADE_REFUSAL_LAWS,
        isoToEpochMs,
        REGISTRY_READ_BRIDGE,
        type FacadeExecutionOutcome,
        type FacadeExecuted,
        type FacadeRefused,
        type FacadeRouteOutcome,
        type MirrorCaptureOutcome,
        type MirrorCaptured,
} from './commandFacade.ts';
import * as CompoundContract from '../common/compound.ts';
import * as MirrorContract from '../common/mirror.ts';
import * as FacadeContract from '../common/facade.ts';

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

const SCOPE = { workspaceId: 'ws-cr009', tenantId: 'tenant-cr009' };

const CONTRACT_VERSION = FacadeContract.COMMAND_FACADE_CONTRACTS_VERSION;

/** The injected clock: +1000 ms per call, with an advance helper (every stamped second is distinct). */
function makeClock(start = 1_000_000) {
        let t = start;
        return {
                now: (): number => {
                        t += 1000;
                        return t;
                },
                current: (): number => t,
                advance: (ms: number): void => {
                        t += ms;
                },
        };
}

/** The node-backed fs port (the registry's FsPort shape; context.ts's realRegistryFsPort, restated). */
function nodeFsPort(): FsPort {
        return {
                readFile: (path, encoding) => fsPromises.readFile(path, encoding),
                writeFile: (path, text) => fsPromises.writeFile(path, text),
                appendFile: (path, text) => fsPromises.appendFile(path, text),
                mkdir: async (path, options) => {
                        await fsPromises.mkdir(path, options);
                },
                readdir: (path) => fsPromises.readdir(path),
        };
}

// ---------------------------------------------------------------------------
// The real-authority seeding (through the authorities' OWN public APIs)
// ---------------------------------------------------------------------------

type SeedVariant = 'available' | 'verified-only' | 'unavailable';

const COMMANDS_CONTENT_HASH = 'sha256-cr009-commands-capability';
const COMMANDS_PERMISSIONS = ['execute-command'];

/**
 * Seeds the commands capability through the REAL registry + REAL gate:
 * discover -> register -> verify (gate-strict receipt) -> decidePermissions
 * (high-risk acknowledged) -> approve -> enable -> projectAvailability.
 * The variant stops early or projects unavailability.
 */
async function seedCommandsCapability(root: string, clock: () => number, variant: SeedVariant): Promise<string> {
        const registry = createRegistry({ root, clock, fsPort: nodeFsPort(), scope: SCOPE });
        const loaded = await registry.load();
        assert.equal(loaded.ok, true);
        const discovered = await registry.discover({
                sourceKind: 'user-spec',
                artifactKind: 'commands',
                contentHash: COMMANDS_CONTENT_HASH,
                version: '1.0.0',
        });
        assert.equal(discovered.ok, true);
        const registered = await registry.register({
                digest: COMMANDS_CONTENT_HASH,
                version: '1.0.0',
                license: 'MIT',
                permissions: COMMANDS_PERMISSIONS,
                endpoints: ['flauz://commands/facade'],
                platforms: ['linux-x64'],
                artifactKind: 'commands',
                provenance: { origin: 'cr009-suite' },
        });
        assert.equal(registered.ok, true);
        const gate = await createGate({ root, clock, fsPort: nodeFsPort(), scope: SCOPE });
        await gate.submitVerificationReceipt(registered.entryId, {
                verificationStatus: 'verified',
                checks: [{ checkId: 'digest', verdict: 'match' }],
        });
        if (variant === 'verified-only') {
                return registered.entryId;
        }
        await gate.decidePermissions(registered.entryId, {
                approver: 'op-cr009',
                acknowledgedPermissions: COMMANDS_PERMISSIONS,
                riskAcknowledged: true,
        });
        await gate.approve(registered.entryId);
        await gate.enable(registered.entryId);
        // The gate holds its OWN registry instance (law 4.1); the projection
        // rides a FRESH, LOADED instance so it replays the journal the gate
        // advanced (one journal, many instances -- the journal is the truth).
        const projectionRegistry = createRegistry({ root, clock, fsPort: nodeFsPort(), scope: SCOPE });
        const projectionLoaded = await projectionRegistry.load();
        assert.equal(projectionLoaded.ok, true);
        const projected = await projectionRegistry.projectAvailability(registered.entryId, {
                platformMatch: variant === 'available',
                dependenciesPresent: true,
        });
        assert.equal(projected.ok, true);
        return registered.entryId;
}

interface Env {
        readonly runtime: CommandFacadeRuntime;
        readonly root: string;
        readonly clock: ReturnType<typeof makeClock>;
        readonly entryId: string;
        cleanup(): Promise<void>;
}

/** A fresh temp root + the seeded authority state + the bound runtime (constructed AFTER the seed). */
async function bindEnv(variant: SeedVariant | 'fresh', clockStart = 1_000_000): Promise<Env> {
        const root = await fsPromises.mkdtemp(join(tmpdir(), 'flauz-cmdfac-'));
        const clock = makeClock(clockStart);
        const entryId = variant === 'fresh' ? '' : await seedCommandsCapability(root, clock.now, variant);
        const runtime = new CommandFacadeRuntime({ root, clock: clock.now, scope: SCOPE });
        await runtime.ensure();
        return {
                runtime,
                root,
                clock,
                entryId,
                cleanup: () => fsPromises.rm(root, { recursive: true, force: true }),
        };
}

/** Runs the body with a seeded env, cleaning up afterwards. */
async function withEnv(variant: SeedVariant | 'fresh', body: (env: Env) => Promise<void>): Promise<void> {
        const env = await bindEnv(variant);
        try {
                await body(env);
        } finally {
                await env.cleanup();
        }
}

// ---------------------------------------------------------------------------
// The request/compound fixtures (the frozen vocabulary's real shapes)
// ---------------------------------------------------------------------------

const TERMINAL_SPAWN_DISCLOSURE = {
        surfaceRef: { surfaceKind: 'terminal', resourceId: 'flauz-terminal-1' },
        kind: 'spawn',
        provenanceDigest: 'pd-terminal-spawn-1',
        visibility: 'visible',
} as const;

const READ_DISCLOSURE = {
        surfaceRef: { surfaceKind: 'terminal', resourceId: 'flauz-terminal-1' },
        kind: 'read',
        provenanceDigest: 'pd-terminal-read-1',
        visibility: 'visible',
} as const;

function terminalStep(stepId: string): CompoundContract.CompoundStep {
        return {
                stepId,
                toolRef: { toolName: 'flauz_terminal' },
                argsDigest: `args-${stepId}`,
                expectedSideEffects: [TERMINAL_SPAWN_DISCLOSURE],
                approvalRequirement: 'confirmation',
        };
}

function aCompound(commandId: string, steps: readonly CompoundContract.CompoundStep[]): CompoundContract.CompoundCommand {
        return { scope: SCOPE, contractVersion: CONTRACT_VERSION, commandId, nameDigest: `name-${commandId}`, steps };
}

function compoundRequest(commandId: string, facadeId = 'fac-compound-1'): FacadeContract.CompoundFacadeRequest {
        return {
                kind: 'compound',
                scope: SCOPE,
                contractVersion: CONTRACT_VERSION,
                facadeId,
                commandRef: { commandId },
                requestedAtIso: '2026-10-09T00:00:00Z',
        };
}

function mirrorRequest(mirrorId: string, facadeId = 'fac-mirror-1'): FacadeContract.MirroredReadFacadeRequest {
        return {
                kind: 'mirrored-read',
                scope: SCOPE,
                contractVersion: CONTRACT_VERSION,
                facadeId,
                mirrorRef: { mirrorId },
                requestedAtIso: '2026-10-09T00:00:00Z',
        };
}

function directToolRequest(facadeId = 'fac-direct-1'): FacadeContract.DirectToolFacadeRequest {
        return {
                kind: 'direct-tool',
                scope: SCOPE,
                contractVersion: CONTRACT_VERSION,
                facadeId,
                toolRef: { toolName: 'flauz_terminal' },
                argsDigest: 'args-direct-1',
                expectedSideEffects: [READ_DISCLOSURE],
                requestedAtIso: '2026-10-09T00:00:00Z',
        };
}

function refusalOf(outcome: FacadeRouteOutcome | MirrorCaptureOutcome | FacadeExecutionOutcome): FacadeRefused {
        assert.ok('refused' in outcome, 'expected a typed refusal');
        return outcome;
}

function routedOf(outcome: FacadeRouteOutcome): import('./commandFacade.ts').FacadeRouted {
        assert.ok('routed' in outcome, 'expected a routed verdict');
        return outcome;
}

function capturedOf(outcome: MirrorCaptureOutcome): MirrorCaptured {
        assert.ok('captured' in outcome, 'expected a captured mirror');
        return outcome;
}

function executedOf(outcome: FacadeExecutionOutcome): FacadeExecuted {
        assert.ok('executed' in outcome, 'expected an executed compound');
        return outcome;
}

async function expectFacadeError(code: string, run: () => Promise<unknown> | unknown): Promise<void> {
        let caught: unknown;
        let completed = false;
        try {
                await run();
                completed = true;
        } catch (error) {
                caught = error;
        }
        assert.ok(!completed, `expected a typed CommandFacadeError ('${code}') but the operation completed`);
        assert.ok(caught instanceof CommandFacadeError, `expected CommandFacadeError, got ${String(caught)}`);
        assert.equal((caught as CommandFacadeError).code, code);
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

suite('CR-009 command facade runtime', function () {
        this.timeout(30000);

        suite('the authority binding', function () {
                test('constructor validation is typed and fail-closed', async function () {
                        await expectFacadeError('INVALID-PARAMS', () => new CommandFacadeRuntime({ root: '', clock: () => 1, scope: SCOPE }));
                        await expectFacadeError('INVALID-PARAMS', () => new CommandFacadeRuntime({ root: '/tmp/x', clock: undefined as unknown as () => number, scope: SCOPE }));
                        await expectFacadeError('INVALID-PARAMS', () => new CommandFacadeRuntime({ root: '/tmp/x', clock: () => 1, fs: 'not-a-port' as unknown as FsPort, scope: SCOPE }));
                        await expectFacadeError('INVALID-PARAMS', () => new CommandFacadeRuntime({ root: '/tmp/x', clock: () => 1, scope: { workspaceId: '', tenantId: 't' } }));
                });

                test('ensure binds the real authorities over the root and is idempotent', async function () {
                        await withEnv('available', async (env) => {
                                await env.runtime.ensure();
                                const stat = await fsPromises.stat(join(env.root, 'registry-journal.jsonl'));
                                assert.ok(stat.isFile());
                                const gateRecords = await fsPromises.stat(join(env.root, '.flauz', 'gate', 'records.jsonl'));
                                assert.ok(gateRecords.isFile());
                        });
                });

                test('dispose makes every public operation the typed DISPOSED error', async function () {
                        await withEnv('available', async (env) => {
                                env.runtime.dispose();
                                await expectFacadeError('DISPOSED', () => env.runtime.route(directToolRequest()));
                        });
                });

                test('the runtime root hosts each authority\'s own tree after an execution', async function () {
                        await withEnv('available', async (env) => {
                                const admission = env.runtime.registerCompound(aCompound('cmd-lane-tree', [terminalStep('S-01')]));
                                assert.equal(admission.admitted, true);
                                const executed = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-lane-tree'), { 'S-01': 'granted' }));
                                const storeJournal = await fsPromises.stat(join(env.root, '.flauz', 'orchestration', 'journal.jsonl'));
                                assert.ok(storeJournal.isFile());
                                const registryJournal = await fsPromises.stat(join(env.root, 'registry-journal.jsonl'));
                                assert.ok(registryJournal.isFile());
                                const gateRecords = await fsPromises.stat(join(env.root, '.flauz', 'gate', 'records.jsonl'));
                                assert.ok(gateRecords.isFile());
                        });
                });
        });

        suite('the routing admission over real authority state', function () {
                test('a fresh exchange (no commands capability) refuses typed capability-unknown', async function () {
                        await withEnv('fresh', async (env) => {
                                const refusal = refusalOf(await env.runtime.route(directToolRequest()));
                                assert.equal(refusal.law, 'capability-unknown');
                        });
                });

                test('a never-approved commands capability refuses typed gate-permission-denied', async function () {
                        await withEnv('verified-only', async (env) => {
                                const refusal = refusalOf(await env.runtime.route(directToolRequest()));
                                assert.equal(refusal.law, 'gate-permission-denied');
                        });
                });

                test('an unavailable commands capability refuses typed capability-unavailable, naming the entry and state', async function () {
                        await withEnv('unavailable', async (env) => {
                                const refusal = refusalOf(await env.runtime.route(directToolRequest()));
                                assert.equal(refusal.law, 'capability-unavailable');
                                assert.equal(refusal.entryId, env.entryId);
                                assert.equal(refusal.state, 'unavailable');
                        });
                });

                test('an available + gate-cleared commands capability routes the direct-tool request (the Tool authority\'s own gating)', async function () {
                        await withEnv('available', async (env) => {
                                const outcome = routedOf(await env.runtime.route(directToolRequest()));
                                assert.equal(outcome.routing.kind, 'direct-tool');
                                assert.equal(outcome.routing.toolName, 'flauz_terminal');
                                assert.equal(outcome.routing.argsDigest, 'args-direct-1');
                                assert.equal(outcome.routing.routesThroughApprovalAuthority, true);
                                assert.deepEqual(outcome.routing.sideEffects, [READ_DISCLOSURE]);
                                assert.equal(outcome.receipt.contractVersion, CONTRACT_VERSION);
                                assert.equal(outcome.receipt.receiptsDigest, FacadeContract.deriveFacadeReceiptsDigest(outcome.routing));
                        });
                });

                test('the compound request routes over the registered compound (step routings + the side-effect union)', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-route-1', [terminalStep('S-01'), terminalStep('S-02')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = routedOf(await env.runtime.route(compoundRequest('cmd-route-1')));
                                assert.equal(outcome.routing.kind, 'compound');
                                assert.equal(outcome.routing.commandId, 'cmd-route-1');
                                assert.deepEqual(
                                        outcome.routing.stepRoutings.map((step) => [step.stepId, step.routesThroughApprovalAuthority]),
                                        [['S-01', true], ['S-02', true]],
                                );
                                assert.deepEqual(outcome.routing.sideEffects, [TERMINAL_SPAWN_DISCLOSURE, TERMINAL_SPAWN_DISCLOSURE]);
                        });
                });

                test('a compound request for an unregistered command carries the contract\'s unknown-compound refusal verbatim', async function () {
                        await withEnv('available', async (env) => {
                                const refusal = refusalOf(await env.runtime.route(compoundRequest('cmd-nope')));
                                assert.equal(refusal.law, 'contract-routing-refused');
                                assert.equal(refusal.contractReason, 'unknown-compound');
                        });
                });

                test('a foreign-scope request refuses typed scope-mismatch', async function () {
                        await withEnv('available', async (env) => {
                                const request = { ...directToolRequest(), scope: { workspaceId: 'somebody-elses', tenantId: 'tenant-cr009' } };
                                const refusal = refusalOf(await env.runtime.route(request));
                                assert.equal(refusal.law, 'scope-mismatch');
                        });
                });

                test('the routing verdict deep-equals the contract\'s routeFor over the same registries (the composition authority)', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-compose-1', [terminalStep('S-01')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const compoundOutcome = routedOf(await env.runtime.route(compoundRequest('cmd-compose-1', 'fac-compose-c')));
                                const directOutcome = routedOf(await env.runtime.route(directToolRequest('fac-compose-d')));
                                const expectedCompound = FacadeContract.routeFor(
                                        compoundRequest('cmd-compose-1', 'fac-compose-c'),
                                        env.runtime.registeredCompounds(),
                                        env.runtime.registeredMirrors(),
                                );
                                const expectedDirect = FacadeContract.routeFor(
                                        directToolRequest('fac-compose-d'),
                                        env.runtime.registeredCompounds(),
                                        env.runtime.registeredMirrors(),
                                );
                                assert.deepEqual(expectedCompound, { routed: true, routing: compoundOutcome.routing });
                                assert.deepEqual(expectedDirect, { routed: true, routing: directOutcome.routing });
                        });
                });
        });

        suite('compound admission at the MAX_COMPOUND_STEPS bound', function () {
                test('15 steps admitted', async function () {
                        await withEnv('available', async (env) => {
                                const steps = Array.from({ length: 15 }, (_unused, index) => terminalStep(`S-${String(index + 1).padStart(2, '0')}`));
                                const admission = env.runtime.registerCompound(aCompound('cmd-15', steps));
                                assert.equal(admission.admitted, true);
                        });
                });

                test('16 steps admitted (the bound exactly)', async function () {
                        await withEnv('available', async (env) => {
                                const steps = Array.from({ length: CompoundContract.MAX_COMPOUND_STEPS }, (_unused, index) => terminalStep(`S-${String(index + 1).padStart(2, '0')}`));
                                const admission = env.runtime.registerCompound(aCompound('cmd-16', steps));
                                assert.equal(admission.admitted, true);
                        });
                });

                test('17 steps refused typed too-many-steps, the detail names the bound', async function () {
                        await withEnv('available', async (env) => {
                                const steps = Array.from({ length: 17 }, (_unused, index) => terminalStep(`S-${String(index + 1).padStart(2, '0')}`));
                                const admission = env.runtime.registerCompound(aCompound('cmd-17', steps));
                                assert.equal(admission.admitted, false);
                                if (admission.admitted) {
                                        return;
                                }
                                assert.equal(admission.reason, 'too-many-steps');
                                assert.ok(admission.detail.includes(`MAX_COMPOUND_STEPS=${CompoundContract.MAX_COMPOUND_STEPS}`));
                                assert.deepEqual(env.runtime.registeredCompounds().map((command) => command.commandId), []);
                        });
                });

                test('an unknown tool refuses typed unknown-tool (the frozen vocabulary)', async function () {
                        await withEnv('available', async (env) => {
                                const step = { ...terminalStep('S-01'), toolRef: { toolName: 'not_a_real_tool' } };
                                const admission = env.runtime.registerCompound(aCompound('cmd-unknown-tool', [step]));
                                assert.equal(admission.admitted, false);
                                if (!admission.admitted) {
                                        assert.equal(admission.reason, 'unknown-tool');
                                }
                        });
                });

                test('a confirmation-gated tool declared none refuses typed approval-requirement-mismatch (fail closed)', async function () {
                        await withEnv('available', async (env) => {
                                const step = { ...terminalStep('S-01'), approvalRequirement: 'none' as const };
                                const admission = env.runtime.registerCompound(aCompound('cmd-escape', [step]));
                                assert.equal(admission.admitted, false);
                                if (!admission.admitted) {
                                        assert.equal(admission.reason, 'approval-requirement-mismatch');
                                }
                        });
                });
        });

        suite('the compound execution: the approval lane + the receipt trail', function () {
                test('a confirmation-gated compound routes through the approval lane with the frozen actor vocabulary', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-exec-1', [terminalStep('S-01')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-1'), { 'S-01': 'granted' }));
                                // The lane rows: the graph submit (agent) + the graph approval (human)
                                // + the step's approval request (agent) + the human grant.
                                assert.deepEqual(
                                        outcome.approvalLane.rows.map((row) => [row.type, row.actor]),
                                        [
                                                ['graph-submitted', 'agent'],
                                                ['graph-approved', 'human'],
                                                ['approval-requested', 'agent'],
                                                ['approval-granted', 'human'],
                                        ],
                                );
                                // The store's own journal on disk carries the same rows (the real seam).
                                const witness = new OrchestrationStore(env.root, { clock: env.clock.now });
                                witness.load();
                                const storeRows = witness.rowsFor(outcome.approvalLane.graphId);
                                assert.deepEqual(
                                        storeRows.map((row) => [row.type, row.actor]),
                                        outcome.approvalLane.rows.map((row) => [row.type, row.actor]),
                                );
                        });
                });

                test('the execution record carries the complete provenance-bearing trail', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-exec-2', [terminalStep('S-01'), terminalStep('S-02')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-2'), {
                                        'S-01': 'granted',
                                        'S-02': 'denied',
                                }));
                                assert.equal(outcome.executionRecord.commandId, 'cmd-exec-2');
                                assert.equal(outcome.executionRecord.contractVersion, CONTRACT_VERSION);
                                assert.equal(outcome.executionRecord.stepReceipts.length, 2);
                                assert.deepEqual(
                                        outcome.approvalLane.rows.filter((row) => row.type.startsWith('approval')).map((row) => row.type),
                                        ['approval-requested', 'approval-granted', 'approval-requested', 'approval-denied'],
                                );
                                assert.equal(outcome.trailCheck.complete, true);
                                // The contract's own trail check agrees.
                                const check = CompoundContract.isCompleteExecutionRecord(command, outcome.executionRecord);
                                assert.deepEqual(check, { complete: true, commandId: 'cmd-exec-2', stepCount: 2 });
                        });
                });

                test('the pending path (no injected decision) lands the request rows only, and the trail stays complete', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-exec-3', [terminalStep('S-01')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-3')));
                                assert.deepEqual(
                                        outcome.approvalLane.rows.map((row) => row.type),
                                        ['graph-submitted', 'graph-approved', 'approval-requested'],
                                );
                                assert.equal(outcome.trailCheck.complete, true);
                        });
                });

                test('a refused routing leaves the approval lane untouched (no partial effects)', async function () {
                        await withEnv('unavailable', async (env) => {
                                const command = aCompound('cmd-exec-4', [terminalStep('S-01')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const refusal = refusalOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-4'), { 'S-01': 'granted' }));
                                assert.equal(refusal.law, 'capability-unavailable');
                                await assert.rejects(
                                        () => fsPromises.stat(join(env.root, '.flauz', 'orchestration', 'journal.jsonl')),
                                        (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
                                );
                        });
                });

                test('the SideEffectDisclosure is present on every effect-bearing receipt', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-exec-5', [terminalStep('S-01'), terminalStep('S-02')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-5'), { 'S-01': 'granted', 'S-02': 'granted' }));
                                for (const receipt of outcome.executionRecord.stepReceipts) {
                                        assert.ok(receipt.sideEffects.length > 0, `step ${receipt.stepId} must disclose its effects`);
                                        for (const disclosure of receipt.sideEffects) {
                                                assert.equal(FacadeContract.isSideEffectDisclosure(disclosure), true);
                                                assert.equal(disclosure.visibility, 'visible');
                                        }
                                }
                                assert.ok(outcome.routing.sideEffects.length > 0);
                                assert.ok(outcome.receipt.routingVerdict.sideEffects.length > 0);
                        });
                });

                test('the receiptsDigest is the contract\'s deriveFacadeReceiptsDigest fold', async function () {
                        await withEnv('available', async (env) => {
                                const command = aCompound('cmd-exec-6', [terminalStep('S-01')]);
                                assert.equal(env.runtime.registerCompound(command).admitted, true);
                                const outcome = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-exec-6'), { 'S-01': 'granted' }));
                                assert.equal(outcome.receipt.receiptsDigest, FacadeContract.deriveFacadeReceiptsDigest(outcome.routing));
                        });
                });

                test('two identical executions over identically-built roots produce identical receipts digests AND identical trail bytes', async function () {
                        const run = async (): Promise<{ digest: string; trail: string; lane: string }> => {
                                const env = await bindEnv('available');
                                try {
                                        const command = aCompound('cmd-determinism', [terminalStep('S-01'), terminalStep('S-02')]);
                                        assert.equal(env.runtime.registerCompound(command).admitted, true);
                                        const outcome = executedOf(
                                                await env.runtime.executeCompound(compoundRequest('cmd-determinism'), {
                                                        'S-01': 'granted',
                                                        'S-02': 'granted',
                                                }),
                                        );
                                        return {
                                                digest: outcome.receipt.receiptsDigest,
                                                trail: JSON.stringify(outcome.executionRecord),
                                                lane: JSON.stringify(outcome.approvalLane),
                                        };
                                } finally {
                                        await env.cleanup();
                                }
                        };
                        const first = await run();
                        const second = await run();
                        assert.equal(first.digest, second.digest);
                        assert.equal(first.trail, second.trail);
                        assert.equal(first.lane, second.lane);
                });
        });

        suite('the mirrored-read lane', function () {
                test('capture over an available entry\'s artifact surface mints the mirror over the registry\'s read', async function () {
                        await withEnv('available', async (env) => {
                                const outcome = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                const mirror = outcome.mirror;
                                assert.equal(MirrorContract.isLocalMirror(mirror), true);
                                assert.equal(mirror.contractVersion, CONTRACT_VERSION);
                                assert.deepEqual(mirror.freshnessPolicy, MirrorContract.DEFAULT_FRESHNESS_POLICY);
                                assert.equal(mirror.freshnessPolicy.maxAgeMs, MirrorContract.MIRROR_FRESH_WINDOW_MS);
                                assert.equal(mirror.freshnessPolicy.staleMaxAgeMs, MirrorContract.MIRROR_STALE_WINDOW_MS);
                                assert.ok(mirror.contentDigest.length > 0);
                                assert.ok(mirror.byteSize > 0);
                                assert.equal(outcome.readDigest, mirror.contentDigest);
                                assert.equal(outcome.anchorSeq > 0, true);
                        });
                });

                test('a write-shaped surface refuses typed through the contract\'s canMirror guard', async function () {
                        await withEnv('available', async (env) => {
                                const refusal = refusalOf(await env.runtime.captureMirror({ surfaceKind: 'file', resourceId: env.entryId }));
                                assert.equal(refusal.law, 'mirror-admission-refused');
                                assert.equal(refusal.contractReason, 'surface-not-mirrorable');
                        });
                });

                test('a mirrorable kind the registry does not serve refuses typed (the honest read-bridge gap)', async function () {
                        await withEnv('available', async (env) => {
                                const refusal = refusalOf(await env.runtime.captureMirror({ surfaceKind: 'task', resourceId: env.entryId }));
                                assert.equal(refusal.law, 'registry-read-bridge-absent');
                        });
                });

                test('an unknown entry refuses typed capability-unknown at capture', async function () {
                        await withEnv('available', async (env) => {
                                const refusal = refusalOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: 'e-does-not-exist' }));
                                assert.equal(refusal.law, 'capability-unknown');
                        });
                });

                test('a never-approved entry refuses typed gate-permission-denied at capture', async function () {
                        await withEnv('verified-only', async (env) => {
                                const refusal = refusalOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                assert.equal(refusal.law, 'gate-permission-denied');
                        });
                });

                test('an unavailable entry refuses typed capability-unavailable at capture', async function () {
                        await withEnv('unavailable', async (env) => {
                                const refusal = refusalOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                assert.equal(refusal.law, 'capability-unavailable');
                        });
                });

                test('fresh at exactly the fresh window edge (inclusive boundary)', async function () {
                        await withEnv('available', async (env) => {
                                const captured = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                // The route's clock-delta read is the first tick after the advance.
                                env.clock.advance(MirrorContract.MIRROR_FRESH_WINDOW_MS - 1000);
                                const outcome = routedOf(await env.runtime.route(mirrorRequest(captured.mirror.mirrorId)));
                                assert.ok(outcome.routing.kind === 'mirrored-read');
                                if (outcome.routing.kind !== 'mirrored-read') {
                                        return;
                                }
                                assert.equal(outcome.routing.freshness, 'fresh');
                                assert.equal(outcome.routing.routeTarget, 'mirror');
                        });
                });

                test('stale one past the fresh window: the redirect carries the bypass disclosure (never a silent re-read)', async function () {
                        await withEnv('available', async (env) => {
                                const captured = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                env.clock.advance(MirrorContract.MIRROR_FRESH_WINDOW_MS - 1000 + 1);
                                const outcome = routedOf(await env.runtime.route(mirrorRequest(captured.mirror.mirrorId)));
                                assert.ok(outcome.routing.kind === 'mirrored-read');
                                if (outcome.routing.kind !== 'mirrored-read') {
                                        return;
                                }
                                assert.equal(outcome.routing.freshness, 'stale');
                                assert.equal(outcome.routing.routeTarget, 'direct-read');
                                assert.equal(outcome.routing.bypass.mirrorId, captured.mirror.mirrorId);
                                assert.equal(outcome.routing.bypass.recordedContentDigest, captured.mirror.contentDigest);
                                assert.equal(outcome.routing.bypass.redirectedTo, 'direct-read');
                        });
                });

                test('stale at exactly the stale window edge, expired one past it', async function () {
                        await withEnv('available', async (env) => {
                                const atStaleEdge = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                env.clock.advance(MirrorContract.MIRROR_STALE_WINDOW_MS - 1000);
                                const stale = routedOf(await env.runtime.route(mirrorRequest(atStaleEdge.mirror.mirrorId)));
                                assert.ok(stale.routing.kind === 'mirrored-read');
                                if (stale.routing.kind !== 'mirrored-read') {
                                        return;
                                }
                                assert.equal(stale.routing.freshness, 'stale');

                                const pastExpiry = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                env.clock.advance(MirrorContract.MIRROR_STALE_WINDOW_MS - 1000 + 1);
                                const expired = routedOf(await env.runtime.route(mirrorRequest(pastExpiry.mirror.mirrorId)));
                                assert.ok(expired.routing.kind === 'mirrored-read');
                                if (expired.routing.kind !== 'mirrored-read') {
                                        return;
                                }
                                assert.equal(expired.routing.freshness, 'expired');
                                assert.equal(expired.routing.routeTarget, 'direct-read');
                                assert.equal(expired.routing.bypass.redirectedTo, 'direct-read');
                        });
                });

                test('a real registry journal append invalidates the mirror through the typed invalidateMirror transition', async function () {
                        await withEnv('available', async (env) => {
                                const captured = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                const anchorSeq = captured.anchorSeq;
                                // A REAL journal append through a separate, LOADED registry instance (the journal is the truth).
                                const other = createRegistry({ root: env.root, clock: env.clock.now, fsPort: nodeFsPort(), scope: SCOPE });
                                const otherLoaded = await other.load();
                                assert.equal(otherLoaded.ok, true);
                                const appended = await other.discover({
                                        sourceKind: 'user-spec',
                                        artifactKind: 'cli',
                                        contentHash: 'sha256-cr009-drift-append',
                                        version: '1.0.0',
                                });
                                assert.equal(appended.ok, true);
                                const refusal = refusalOf(await env.runtime.route(mirrorRequest(captured.mirror.mirrorId)));
                                assert.equal(refusal.law, 'mirror-invalidated');
                                const receipt = refusal.invalidation;
                                assert.ok(receipt !== undefined, 'the refusal must carry the typed invalidation receipt');
                                assert.equal(receipt.kind, 'source-digest-drift');
                                assert.equal(receipt.mirrorId, captured.mirror.mirrorId);
                                assert.equal(receipt.recordedContentDigest, captured.mirror.contentDigest);
                                assert.equal(receipt.contractVersion, CONTRACT_VERSION);
                                assert.ok(receipt.evidenceDigest.length > 0);
                                assert.ok(Number.isFinite(isoToEpochMs(receipt.invalidatedAtIso)));
                                // The mirror is gone from the registry (never a silent stale serve).
                                assert.deepEqual(env.runtime.registeredMirrors().map((mirror) => mirror.mirrorId), []);
                                // The anchor actually moved.
                                const witness: RegistryRuntime = createRegistry({ root: env.root, clock: env.clock.now, fsPort: nodeFsPort(), scope: SCOPE });
                                const loaded = await witness.load();
                                assert.equal(loaded.ok, true);
                                if (loaded.ok) {
                                        assert.ok(loaded.seq > anchorSeq);
                                }
                        });
                });

                test('a mirrored-read for an unknown mirror carries the contract\'s unknown-mirror refusal', async function () {
                        await withEnv('available', async (env) => {
                                const refusal = refusalOf(await env.runtime.route(mirrorRequest('m-nope')));
                                assert.equal(refusal.law, 'contract-routing-refused');
                                assert.equal(refusal.contractReason, 'unknown-mirror');
                        });
                });
        });

        suite('determinism + the frozen vocabularies', function () {
                test('two runs over identically-built roots produce identical projection bytes', async function () {
                        const run = async (): Promise<string> => {
                                const env = await bindEnv('available');
                                try {
                                        const command = aCompound('cmd-projection', [terminalStep('S-01')]);
                                        assert.equal(env.runtime.registerCompound(command).admitted, true);
                                        const executed = executedOf(await env.runtime.executeCompound(compoundRequest('cmd-projection'), { 'S-01': 'granted' }));
                                        const captured = capturedOf(await env.runtime.captureMirror({ surfaceKind: 'artifact', resourceId: env.entryId }));
                                        const served = routedOf(await env.runtime.route(mirrorRequest(captured.mirror.mirrorId)));
                                        return JSON.stringify({
                                                mirrors: env.runtime.registeredMirrors(),
                                                executionRecord: executed.executionRecord,
                                                approvalLane: executed.approvalLane,
                                                receipts: [executed.receipt, served.receipt],
                                        });
                                } finally {
                                        await env.cleanup();
                                }
                        };
                        const first = await run();
                        const second = await run();
                        assert.equal(first, second);
                });

                test('the law-comment grep: no wall-clock or randomness outside comments', function () {
                        for (const file of ['commandFacade.ts', 'commandFacade.test.ts']) {
                                const source = readFileSync(join(RUNTIME_DIR, file), 'utf8');
                                const offending = source
                                        .split('\n')
                                        .filter((line) => /Date\.now|Math\.random|new Date\(/.test(line))
                                        .filter((line) => {
                                                const trimmed = line.trim();
                                                return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
                                        });
                                assert.deepEqual(offending, [], `${file} must carry wall-clock/random references in law comments only`);
                        }
                });

                test('the refusal laws + the read bridge are the frozen closed vocabularies', function () {
                        assert.deepEqual(FACADE_REFUSAL_LAWS, [
                                'capability-unknown',
                                'capability-unavailable',
                                'gate-permission-denied',
                                'mirror-invalidated',
                                'registry-read-bridge-absent',
                                'scope-mismatch',
                                'contract-routing-refused',
                                'compound-admission-refused',
                                'mirror-admission-refused',
                                'approval-lane-refused',
                        ]);
                        assert.deepEqual(REGISTRY_READ_BRIDGE.map((row) => row.surfaceKind), ['artifact']);
                });
        });
});
