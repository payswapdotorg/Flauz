/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-011 -- THE JOURNEY BATTERY HARNESS: the seven canonical Phase C-R
 * journeys as a runnable manifest with HONEST per-step statuses.
 *
 * LAWS:
 * - HONEST STATUSES: every step is 'runnable-now' (executes against
 *   real seams today) or 'pending-wiring' (a typed record naming the
 *   owning CR). A pending step carries NO receipt and NO evidence
 *   label. Nothing pending is ever reported as passing.
 * - EVIDENCE LABELS (the truth law): the driver-exercised legs are
 *   'simulated' (the fake model lane over REAL seams -- never
 *   promoted); the reload drill, the in-process CLI legs, and the
 *   CR-010b journey-4 capability legs are 'local-real'.
 * - NOT A SECOND RUNTIME: the battery holds no orchestration state of
 *   its own. The J1/J2/J3 legs invoke THE EXISTING dogfood driver as
 *   a child process (the full run; per-exercise selection is not
 *   documented in the driver's usage header -- the order's
 *   pre-authorized fallback, receipts selected from the output);
 *   the J5 drill and the J6 legs run in-process through the CLI's
 *   real service-context port; the CR-010b J4 legs run in-process
 *   through the CR-006 registry's PUBLIC API over the battery root's
 *   own registry directory (real node fs, a fixed deterministic
 *   registry clock -- never the wall clock, never the battery's
 *   duration clock). The DISCOVERY SOURCE is the battery's own
 *   fixture artifact -- DISCLOSED in every J4 receipt detail as
 *   'fixture source, real registry pipeline'. The registry operations
 *   are REAL; the source is a fixture; nothing is promoted beyond
 *   what runs.
 * - DETERMINISM: no Date.now, no Math.random. runId, clocks and the
 *   driver runner are injected inputs (deterministic defaults); two
 *   runs over the same root with the same inputs produce
 *   byte-identical receipts modulo the runId. Only stable facts are
 *   banked from the driver (exit code, exercise names found) -- the
 *   driver's own timestamped receipt bytes are never embedded. The
 *   J4 registry directory is wiped at pipeline start so repeated
 *   runs over the same root rebuild byte-identical registry files.
 * - CONTAINMENT: the battery writes NOTHING outside its given root
 *   (the driver child gets --out and TMPDIR inside the root, a
 *   sanitized environment with no live-provider contract present,
 *   and the J4 registry lives under the root's .flauz tree).
 */

import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_COMMAND_GRAMMAR } from '../../zcode-patterns/cli/common/grammar.ts';
import { projectParity, type RegisteredProjection } from '../../zcode-patterns/cli/common/parity.ts';
import {
        realRegistryFsPort,
        registryRootFor,
        runReloadDrill,
        sha256Hex,
        deriveScope,
        type ReloadDrillResult,
} from '../../cli/runtime/context.ts';
import { runCli } from '../../cli/bin/flauz.ts';
import { createRegistry } from '../../capabilities/registry/registry.mjs';

export const BATTERY_VERSION = '1.0.0';

export type BatteryStatus = 'runnable-now' | 'pending-wiring';
export type BatterySurface = 'desktop' | 'web' | 'cli' | 'headless';
export type EvidenceLabel = 'simulated' | 'local-real';
export type PendingOwner =
        | 'CR-002'
        | 'CR-003'
        | 'CR-004'
        | 'CR-005'
        | 'CR-006'
        | 'CR-007'
        | 'CR-008';

export interface BatteryStep {
        readonly stepId: string;
        readonly description: string;
        readonly surface: BatterySurface;
        readonly evidenceLabel?: EvidenceLabel;
        readonly status: BatteryStatus;
        readonly pendingOwner?: PendingOwner;
}

export interface BatteryJourney {
        readonly id: string;
        readonly title: string;
        readonly execution: 'driver' | 'in-process' | 'none';
        readonly steps: readonly BatteryStep[];
}

function runnable(
        stepId: string,
        description: string,
        surface: BatterySurface,
        evidenceLabel: EvidenceLabel,
): BatteryStep {
        return { stepId, description, surface, evidenceLabel, status: 'runnable-now' };
}

function pending(stepId: string, description: string, surface: BatterySurface, owner: PendingOwner): BatteryStep {
        return { stepId, description, surface, status: 'pending-wiring', pendingOwner: owner };
}

export const JOURNEYS: readonly BatteryJourney[] = [
        {
                id: 'journey-1-coding',
                title: 'the coding journey',
                execution: 'driver',
                steps: [
                        runnable('j1-s1-open-workspace', 'open the workspace (the session opens the workspace root)', 'desktop', 'simulated'),
                        runnable('j1-s2-inspect', 'inspect the workspace state (runs, tasks, graphs)', 'desktop', 'simulated'),
                        runnable('j1-s3-delegate', 'delegate a task to a background agent', 'desktop', 'simulated'),
                        runnable('j1-s4-background', 'push the delegated task to the background', 'desktop', 'simulated'),
                        runnable('j1-s5-approve-tool', 'approve the gated tool invocation (the human confirmation)', 'desktop', 'simulated'),
                        runnable('j1-s6-inspect-progress', 'inspect the delegated run progress', 'desktop', 'simulated'),
                        runnable('j1-s7-review', 'review the results and the evidence rows', 'desktop', 'simulated'),
                        runnable('j1-s8-continue', 'continue the session to the next task', 'desktop', 'simulated'),
                ],
        },
        {
                id: 'journey-2-research',
                title: 'the research journey',
                execution: 'driver',
                steps: [
                        runnable('j2-s1-research-task', 'a research task is issued', 'desktop', 'simulated'),
                        runnable('j2-s2-plan', 'the plan is composed', 'desktop', 'simulated'),
                        runnable('j2-s3-delegate', 'the research is delegated', 'desktop', 'simulated'),
                        runnable('j2-s4-browser-tool', 'browser/tool use over the real tool seams', 'desktop', 'simulated'),
                        runnable('j2-s5-gather-evidence', 'evidence is gathered into the ledger', 'desktop', 'simulated'),
                        runnable('j2-s6-synthesize', 'the findings are synthesized', 'desktop', 'simulated'),
                        pending('j2-s7-persist-memory', 'the findings persist into the memory runtime', 'desktop', 'CR-005'),
                        runnable('j2-s8-artifact', 'the artifact is persisted', 'desktop', 'simulated'),
                ],
        },
        {
                id: 'journey-3-multi-agent',
                title: 'the multi-agent journey',
                execution: 'driver',
                steps: [
                        runnable('j3-s1-objective', 'the objective is stated', 'desktop', 'simulated'),
                        runnable('j3-s2-organization', 'the agent organization is composed', 'desktop', 'simulated'),
                        runnable('j3-s3-launch', 'the agents are launched', 'desktop', 'simulated'),
                        runnable('j3-s4-observe', 'the organization is observed', 'desktop', 'simulated'),
                        runnable('j3-s5-intervene', 'a stuck gated step is taken over (the takeover transition)', 'desktop', 'simulated'),
                        runnable('j3-s6-resume', 'the work resumes after the intervention', 'desktop', 'simulated'),
                        runnable('j3-s7-consolidate', 'the results are consolidated', 'desktop', 'simulated'),
                ],
        },
        {
                id: 'journey-4-capability',
                title: 'the capability journey',
                execution: 'in-process',
                steps: [
                        pending('j4-s1-need', 'a capability need is identified', 'desktop', 'CR-006'),
                        runnable('j4-s2-discover', 'capability sources are discovered', 'desktop', 'local-real'),
                        runnable('j4-s3-inspect', 'a candidate pack is inspected', 'desktop', 'local-real'),
                        runnable('j4-s4-import', 'the pack is imported', 'desktop', 'local-real'),
                        runnable('j4-s5-verify', 'the imported capability is verified', 'desktop', 'local-real'),
                        runnable('j4-s6-approval', 'the registration is approved', 'desktop', 'local-real'),
                        pending('j4-s7-register', 'the capability is registered', 'desktop', 'CR-006'),
                        pending('j4-s8-execute', 'the capability is executed', 'desktop', 'CR-008'),
                        pending('j4-s9-evidence', 'the execution evidence is banked', 'desktop', 'CR-008'),
                ],
        },
        {
                id: 'journey-5-recovery',
                title: 'the recovery journey',
                execution: 'in-process',
                steps: [
                        runnable('j5-s1-long-task', 'a long task runs (the journal is live at the root)', 'desktop', 'local-real'),
                        runnable('j5-s2-interruption', 'the session is interrupted (the store is disposed without completing)', 'desktop', 'local-real'),
                        runnable('j5-s3-restart', 'the runtime restarts (the journal is loaded again from the same root)', 'desktop', 'local-real'),
                        pending('j5-s4-replay', 'the interrupted run is cold-replayed', 'desktop', 'CR-004'),
                        runnable('j5-s5-reconstruct', 'the state is reconstructed (the byte-equal reload compare)', 'desktop', 'local-real'),
                        runnable('j5-s6-resume', 'the work resumes from the reconstructed state', 'desktop', 'local-real'),
                        runnable('j5-s7-complete', 'the task completes (the drill final verdict)', 'desktop', 'local-real'),
                ],
        },
        {
                id: 'journey-6-cli',
                title: 'the CLI journey',
                execution: 'in-process',
                steps: [
                        runnable('j6-s1-cli', 'the CLI is invoked (the parse layer answers with the usage surface)', 'cli', 'local-real'),
                        runnable('j6-s2-task', 'a task command is parsed (the typed parse mismatch)', 'cli', 'local-real'),
                        runnable('j6-s3-agent', 'the agent roster is read through the real a2a seam', 'cli', 'local-real'),
                        runnable('j6-s4-approval', 'the approval decision is routed headless (the wired respond answers not-found over a fresh root)', 'cli', 'local-real'),
                        runnable('j6-s5-evidence', 'the evidence projection is refused (parity-projection-missing)', 'cli', 'local-real'),
                        runnable('j6-s6-restart', 'the store reload drill runs (load, dispose, reload)', 'cli', 'local-real'),
                        runnable('j6-s7-inspect', 'the graph state is inspected (workflow.view)', 'cli', 'local-real'),
                        runnable('j6-s8-resume', 'the resume command is wired (CR-002): the unknown run answers the typed not-found', 'cli', 'local-real'),
                ],
        },
        {
                id: 'journey-7-unsafe-capability',
                title: 'the unsafe-capability journey',
                execution: 'none',
                steps: [
                        pending('j7-s1-discover', 'a capability is discovered', 'desktop', 'CR-008'),
                        pending('j7-s2-inspect', 'the capability is inspected', 'desktop', 'CR-008'),
                        pending('j7-s3-detect', 'the policy/security problem is detected (a journey without a registered projection is refused, never silently served)', 'desktop', 'CR-008'),
                        pending('j7-s4-reject', 'the capability is rejected/quarantined', 'desktop', 'CR-008'),
                        pending('j7-s5-explain', 'the rejection is explained', 'desktop', 'CR-008'),
                ],
        },
];

export interface BatteryStepReceipt {
        readonly stepId: string;
        readonly status: 'runnable-now';
        readonly evidenceLabel: EvidenceLabel;
        readonly verdict: 'green' | 'red' | 'typed-failure';
        readonly detail: string;
        readonly exitCode?: number;
        readonly commandPath?: string;
        readonly durationMs: number;
}

export interface BatteryPendingStep {
        readonly stepId: string;
        readonly status: 'pending-wiring';
        readonly pendingOwner: PendingOwner;
}

export interface BatteryJourneyReceipt {
        readonly journeyId: string;
        readonly executed: readonly BatteryStepReceipt[];
        readonly pending: readonly BatteryPendingStep[];
        readonly verdict: 'green' | 'red';
}

export interface DriverRunRecord {
        readonly invocation: readonly string[];
        readonly exitCode: number;
        readonly outDir: string;
        readonly exercises: readonly string[];
        readonly verdictGreen: boolean;
        readonly runGreenText: boolean;
}

export interface BatteryRunRecord {
        readonly batteryVersion: string;
        readonly runId: string;
        readonly scope: { readonly workspaceId: string; readonly tenantId: string };
        readonly root: string;
        readonly driver?: DriverRunRecord;
        readonly journeys: readonly BatteryJourneyReceipt[];
        readonly reloadDrill: ReloadDrillResult;
        readonly capability: CapabilityRunRecord;
        readonly parity: readonly { journey: string; verdict: string }[];
}

export type DriverRunner = (root: string) => Promise<DriverRunRecord>;

export interface RunBatteryOptions {
        readonly root: string;
        readonly runId?: string;
        readonly driverRunner?: DriverRunner;
        readonly clock?: () => number;
}

const KNOWN_EXERCISES: readonly string[] = ['agent-delegation', 'tools-exploration'];
const JOURNEY_EXERCISE: Readonly<Record<string, string>> = {
        'journey-1-coding': 'agent-delegation',
        'journey-2-research': 'tools-exploration',
        'journey-3-multi-agent': 'agent-delegation',
};

// ---------------------------------------------------------------------------
// CR-010b: the J4 capability fixture artifact and the registry pipeline.
// The shapes are the registry.test.ts-validated values; the registry
// operations over them are REAL through the public API.
// ---------------------------------------------------------------------------

const J4_DISCLOSURE = 'fixture source, real registry pipeline';

const CAPABILITY_DISCOVERY_FIXTURE = {
        sourceKind: 'community-project',
        artifactKind: 'cli',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
        name: 'demo-capability',
};

const CAPABILITY_IMPORTED_FIXTURE = {
        digest: 'a'.repeat(64),
        version: '1.0.0',
        license: 'MIT',
        permissions: ['read-files'],
        endpoints: ['https://example.com/demo'],
        platforms: ['linux-x64'],
        artifactKind: 'cli',
        provenance: { origin: 'community-project' },
};

const CAPABILITY_APPROVAL_FIXTURE = {
        approver: 'operator-1',
        acknowledgedPermissions: ['read-files'],
};

const CAPABILITY_VERIFICATION_RECEIPT = {
        verificationStatus: 'verified',
        checks: [{ check: 'digest', outcome: 'match' }],
};

/**
 * The J4 registry clock: fixed, deterministic, and nonzero -- the
 * registry suite's own convention (its makeClock starts at 1000).
 * Never the wall clock; never the battery's duration clock (whose
 * default of 0 is unvalidated as a registry timestamp source).
 */
const CAPABILITY_REGISTRY_CLOCK = (): number => 1000;

export interface CapabilityStepOutcome {
        readonly ok: boolean;
        readonly detail: string;
}

export interface CapabilityRunRecord {
        readonly registryRoot: string;
        readonly entryId: string;
        readonly entryState: string;
        readonly journalDigest: string;
        readonly snapshotDigest: string;
        readonly steps: Readonly<Record<string, CapabilityStepOutcome>>;
}

function registryRefusalText(outcome: { ok: false; refusal: unknown }): string {
        const refusal = outcome.refusal as { code?: unknown; law?: unknown; detail?: unknown };
        const code = typeof refusal.code === 'string' ? refusal.code : 'unknown-refusal';
        const law = typeof refusal.law === 'string' ? ' (' + refusal.law + ')' : '';
        const detail = typeof refusal.detail === 'string' && refusal.detail.length > 0 ? ': ' + refusal.detail : '';
        return code + law + detail;
}

/**
 * THE J4 REGISTRY PIPELINE (CR-010b): discover -> inspect -> register ->
 * verify -> approve through the registry's PUBLIC API over the battery
 * root's own registry directory (real node fs, the fixed deterministic
 * registry clock). The directory is wiped at start so two runs over the
 * same root rebuild byte-identical files (the determinism law). Every
 * leg's receipt detail discloses the fixture source; every refusal
 * lands as an honest typed-failure verdict carrying the registry's code.
 */
async function runCapabilityPipeline(
        root: string,
        scope: { workspaceId: string; tenantId: string },
): Promise<CapabilityRunRecord> {
        const registryRoot = registryRootFor(root);
        await rm(registryRoot, { recursive: true, force: true });
        await mkdir(registryRoot, { recursive: true });
        const registry = createRegistry({
                root: registryRoot,
                clock: CAPABILITY_REGISTRY_CLOCK,
                fsPort: realRegistryFsPort(),
                scope,
        });
        // The registry's own law: every operation is gated on load() (the
        // journal/snapshot recovery happens here — D_SNAPSHOT_REBUILT on a fresh
        // root is the expected disclosure, never a failure). A load refusal fails
        // the pipeline honestly through the first step.
        const loaded = await registry.load();
        const steps: Record<string, CapabilityStepOutcome> = {};
        if (!loaded.ok) {
                steps['j4-s2-discover'] = { ok: false, detail: 'registry load refused: ' + registryRefusalText(loaded) };
                return { registryRoot, steps, journalDigest: '', snapshotDigest: '' } as CapabilityRunRecord;
        }
        const discovered = await registry.discover(CAPABILITY_DISCOVERY_FIXTURE);
        const discoveredId = discovered.ok ? discovered.entryId : '';
        steps['j4-s2-discover'] = discovered.ok
                ? { ok: true, detail: 'discover ' + discoveredId + ' (' + J4_DISCLOSURE + ')' }
                : { ok: false, detail: 'discover refused: ' + registryRefusalText(discovered) };
        const inspected = await registry.inspect(discoveredId);
        steps['j4-s3-inspect'] = inspected.ok
                ? { ok: true, detail: 'inspect ' + discoveredId + ' (' + inspected.entry.state + ') (' + J4_DISCLOSURE + ')' }
                : { ok: false, detail: 'inspect refused: ' + registryRefusalText(inspected) };
        const registered = await registry.register(CAPABILITY_IMPORTED_FIXTURE);
        const importedId = registered.ok ? registered.entryId : '';
        steps['j4-s4-import'] = registered.ok
                ? { ok: true, detail: 'register ' + importedId + ' (' + J4_DISCLOSURE + ')' }
                : { ok: false, detail: 'register refused: ' + registryRefusalText(registered) };
        const verified = await registry.verify(importedId, CAPABILITY_VERIFICATION_RECEIPT);
        steps['j4-s5-verify'] = verified.ok
                ? { ok: true, detail: 'verify ' + importedId + ' (' + J4_DISCLOSURE + ')' }
                : { ok: false, detail: 'verify refused: ' + registryRefusalText(verified) };
        const approved = await registry.approve(importedId, CAPABILITY_APPROVAL_FIXTURE);
        steps['j4-s6-approval'] = approved.ok
                ? { ok: true, detail: 'approve ' + importedId + ' (' + J4_DISCLOSURE + ')' }
                : { ok: false, detail: 'approve refused: ' + registryRefusalText(approved) };
        let journalDigest = '';
        let snapshotDigest = '';
        try {
                journalDigest = sha256Hex(await readFile(join(registryRoot, 'registry-journal.jsonl'), 'utf8'));
                snapshotDigest = sha256Hex(await readFile(join(registryRoot, 'registry-state.json'), 'utf8'));
        } catch {
                // honest: no registry files to digest (the digests stay empty)
        }
        return {
                registryRoot,
                entryId: importedId,
                entryState: approved.ok ? approved.state : '',
                journalDigest,
                snapshotDigest,
                steps,
        };
}

async function walkJsonFiles(dir: string, depth: number, out: string[]): Promise<void> {
        if (depth <= 0) {
                return;
        }
        let entries: Dirent[];
        try {
                entries = await readdir(dir, { withFileTypes: true });
        } catch {
                return;
        }
        for (const entry of entries) {
                const full = join(dir, entry.name);
                if (entry.isDirectory()) {
                        await walkJsonFiles(full, depth - 1, out);
                } else if (entry.isFile() && entry.name.endsWith('.json')) {
                        out.push(full);
                }
        }
}

async function scanDriverReceipts(outDir: string): Promise<string[]> {
        const files: string[] = [];
        await walkJsonFiles(outDir, 3, files);
        const found = new Set<string>();
        for (const file of files) {
                let text: string;
                try {
                        text = await readFile(file, 'utf8');
                } catch {
                        continue;
                }
                for (const exercise of KNOWN_EXERCISES) {
                        if (text.includes(exercise)) {
                                found.add(exercise);
                        }
                }
        }
        return [...found].sort();
}

/**
 * THE DRIVER LEG (the order's pre-authorized fallback): the pasted
 * usage header documents modes and --out but no per-exercise
 * selection flag, so the battery runs the FULL driver once (fake
 * lane; the environment is constructed fresh with no live-provider
 * contract present) and selects per-journey facts from its output.
 */
export async function spawnDogfoodDriver(root: string): Promise<DriverRunRecord> {
        const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
        const outDir = join(root, 'dogfood-records');
        const tmpDir = join(root, 'tmp');
        await mkdir(tmpDir, { recursive: true });
        const invocation: readonly string[] = [
                '--experimental-strip-types',
                'build/flauz/dogfood/dogfood-driver.mjs',
                '--out',
                outDir,
        ];
        const child = spawn('node', [...invocation], {
                cwd: repoRoot,
                env: {
                        PATH: process.env.PATH ?? '',
                        HOME: process.env.HOME ?? '',
                        TMPDIR: tmpDir,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
                stdout += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString('utf8');
        });
        const exitCode = await new Promise<number>((resolveExit) => {
                child.on('exit', (code) => {
                        resolveExit(code ?? -1);
                });
        });
        const exercises = await scanDriverReceipts(outDir);
        const runGreenText = stdout.includes('RUN GREEN') || stderr.includes('RUN GREEN');
        const verdictGreen =
                exitCode === 0 && exercises.includes('agent-delegation') && exercises.includes('tools-exploration');
        return { invocation: ['node', ...invocation], exitCode, outDir, exercises, verdictGreen, runGreenText };
}

interface CliLeg {
        readonly stepId: string;
        readonly argv: readonly string[];
        readonly commandPath?: string;
        readonly expectExit?: number;
}

const CLI_LEGS: readonly CliLeg[] = [
        { stepId: 'j6-s1-cli', argv: [] },
        { stepId: 'j6-s2-task', argv: ['workflow.phases'], commandPath: 'workflow.phases' },
        { stepId: 'j6-s3-agent', argv: ['--root', 'ROOT', 'background-agent.roster'], commandPath: 'background-agent.roster' },
        { stepId: 'j6-s4-approval', argv: ['--root', 'ROOT', 'approval.respond', 'ap-1', 'approved'], commandPath: 'approval.respond', expectExit: 3 },
        { stepId: 'j6-s5-evidence', argv: ['evidence.list', 'task-1'], commandPath: 'evidence.list', expectExit: 1 },
        { stepId: 'j6-s7-inspect', argv: ['--root', 'ROOT', 'workflow.view', 'graph-none'], commandPath: 'workflow.view' },
        { stepId: 'j6-s8-resume', argv: ['background-agent.resume', 'ag-1'], commandPath: 'background-agent.resume', expectExit: 3 },
];

export async function runBattery(options: RunBatteryOptions): Promise<BatteryRunRecord> {
        const root = resolve(options.root);
        const clock = options.clock ?? (() => 0);
        const runId =
                options.runId ?? 'battery-' + sha256Hex(root).slice(0, 16);
        const scope = deriveScope(root);
        const driverRunner = options.driverRunner ?? spawnDogfoodDriver;
        const driver = await driverRunner(root);
        const reloadRoot = join(root, 'reload');
        await mkdir(reloadRoot, { recursive: true });
        const drill = await runReloadDrill(reloadRoot);
        const capability = await runCapabilityPipeline(root, scope);
        const projections: RegisteredProjection[] = [];
        const receipts: BatteryJourneyReceipt[] = [];

        for (const journey of JOURNEYS) {
                const executed: BatteryStepReceipt[] = [];
                const pendingSteps: BatteryPendingStep[] = [];
                for (const step of journey.steps) {
                        if (step.status === 'pending-wiring') {
                                pendingSteps.push({
                                        stepId: step.stepId,
                                        status: 'pending-wiring',
                                        pendingOwner: step.pendingOwner as PendingOwner,
                                });
                                continue;
                        }
                        if (journey.execution === 'driver') {
                                const exercise = JOURNEY_EXERCISE[journey.id] ?? 'unknown';
                                const verdict: BatteryStepReceipt['verdict'] =
                                        driver.verdictGreen && driver.exercises.includes(exercise) ? 'green' : 'red';
                                executed.push({
                                        stepId: step.stepId,
                                        status: 'runnable-now',
                                        evidenceLabel: step.evidenceLabel as EvidenceLabel,
                                        verdict,
                                        detail:
                                                'driver exercise ' + exercise + ' (fake lane, real seams; exit ' +
                                                String(driver.exitCode) + ')',
                                        durationMs: 0,
                                });
                                continue;
                        }
                        if (journey.id === 'journey-4-capability') {
                                const outcome = capability.steps[step.stepId];
                                if (outcome !== undefined) {
                                        executed.push({
                                                stepId: step.stepId,
                                                status: 'runnable-now',
                                                evidenceLabel: 'local-real',
                                                verdict: outcome.ok ? 'green' : 'typed-failure',
                                                detail: outcome.detail,
                                                durationMs: 0,
                                        });
                                        continue;
                                }
                        }
                        if (journey.id === 'journey-5-recovery') {
                                executed.push(drillReceipt(step.stepId, drill, clock));
                                continue;
                        }
                        if (journey.id === 'journey-6-cli') {
                                const leg = CLI_LEGS.find((candidate) => candidate.stepId === step.stepId);
                                if (leg !== undefined) {
                                        const start = clock();
                                        const argv = leg.argv.map((token) => (token === 'ROOT' ? root : token));
                                        const result = await runCli(argv);
                                        if (result.response !== undefined) {
                                                projections.push({
                                                        commandPath: result.response.commandPath,
                                                        lastOutcome: result.response.outcome,
                                                });
                                        }
                                        const green =
                                                leg.expectExit !== undefined ? result.exitCode === leg.expectExit : result.response !== undefined;
                                        executed.push({
                                                stepId: step.stepId,
                                                status: 'runnable-now',
                                                evidenceLabel: 'local-real',
                                                verdict: green ? 'green' : 'typed-failure',
                                                detail:
                                                        'cli leg ' + argv.join(' ') + ' -> exit ' + String(result.exitCode) +
                                                        (result.edgeFailure !== undefined ? ' (edge: ' + result.edgeFailure.reason + ')' : ''),
                                                exitCode: result.exitCode,
                                                commandPath: leg.commandPath,
                                                durationMs: clock() - start,
                                        });
                                        continue;
                                }
                                if (step.stepId === 'j6-s6-restart') {
                                        executed.push(drillReceipt(step.stepId, drill, clock));
                                        continue;
                                }
                        }
                }
                const verdict: 'green' | 'red' =
                        executed.length > 0 && executed.every((receipt) => receipt.verdict === 'green') ? 'green' : 'red';
                receipts.push({ journeyId: journey.id, executed, pending: pendingSteps, verdict });
        }

        const parityOutcome = projectParity(CLI_COMMAND_GRAMMAR, projections, scope);
        const parity = parityOutcome.built
                ? parityOutcome.view.journeys.map((entry) => ({ journey: entry.journey, verdict: entry.verdict }))
                : [];

        return {
                batteryVersion: BATTERY_VERSION,
                runId,
                scope,
                root,
                driver,
                journeys: receipts,
                reloadDrill: drill,
                capability,
                parity,
        };
}

function drillReceipt(stepId: string, drill: ReloadDrillResult, _clock: () => number): BatteryStepReceipt {
        let green = false;
        let detail = '';
        if (stepId === 'j5-s1-long-task' || stepId === 'j5-s2-interruption') {
                green = drill.loadedFirst;
                detail = drill.loadedFirst ? 'journal loaded (live)' : drill.detail;
        } else if (stepId === 'j5-s3-restart') {
                green = drill.loadedSecond;
                detail = drill.loadedSecond ? 'journal reloaded from the same root' : drill.detail;
        } else {
                green = drill.byteEqual && drill.detail.length === 0;
                detail = drill.byteEqual
                        ? 'reload byte-equal (digest ' + drill.reloadDigest.slice(0, 16) + ')'
                        : 'reload not byte-equal: ' + drill.detail;
        }
        return {
                stepId,
                status: 'runnable-now',
                evidenceLabel: 'local-real',
                verdict: green ? 'green' : 'typed-failure',
                detail,
                durationMs: 0,
        };
}
