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
 *   promoted); the reload drill and the in-process CLI legs are
 *   'local-real'.
 * - NOT A SECOND RUNTIME: the battery holds no orchestration state of
 *   its own. The J1/J2/J3 legs invoke THE EXISTING dogfood driver as
 *   a child process (the full run; per-exercise selection is not
 *   documented in the driver's usage header -- the order's
 *   pre-authorized fallback, receipts selected from the output);
 *   the J5 drill and the J6 legs run in-process through the CLI's
 *   real service-context port.
 * - DETERMINISM: no Date.now, no Math.random. runId, clocks and the
 *   driver runner are injected inputs (deterministic defaults); two
 *   runs over the same root with the same inputs produce
 *   byte-identical receipts modulo the runId. Only stable facts are
 *   banked from the driver (exit code, exercise names found) -- the
 *   driver's own timestamped receipt bytes are never embedded.
 * - CONTAINMENT: the battery writes NOTHING outside its given root
 *   (the driver child gets --out and TMPDIR inside the root, and a
 *   sanitized environment with no live-provider contract present).
 */

import { spawn } from 'node:child_process';
import type { Dirent } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_COMMAND_GRAMMAR } from '../../zcode-patterns/cli/common/grammar.ts';
import { projectParity, type RegisteredProjection } from '../../zcode-patterns/cli/common/parity.ts';
import {
	runReloadDrill,
	sha256Hex,
	deriveScope,
	type ReloadDrillResult,
} from '../../cli/runtime/context.ts';
import { runCli } from '../../cli/bin/flauz.ts';

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
		execution: 'none',
		steps: [
			pending('j4-s1-need', 'a capability need is identified', 'desktop', 'CR-006'),
			pending('j4-s2-discover', 'capability sources are discovered', 'desktop', 'CR-006'),
			pending('j4-s3-inspect', 'a candidate pack is inspected', 'desktop', 'CR-006'),
			pending('j4-s4-import', 'the pack is imported', 'desktop', 'CR-006'),
			pending('j4-s5-verify', 'the imported capability is verified', 'desktop', 'CR-007'),
			pending('j4-s6-approval', 'the registration is approved', 'desktop', 'CR-008'),
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
			runnable('j6-s4-approval', 'the approval decision is refused headless (the typed refusal)', 'cli', 'local-real'),
			runnable('j6-s5-evidence', 'the evidence projection is refused (parity-projection-missing)', 'cli', 'local-real'),
			runnable('j6-s6-restart', 'the store reload drill runs (load, dispose, reload)', 'cli', 'local-real'),
			runnable('j6-s7-inspect', 'the graph state is inspected (workflow.view)', 'cli', 'local-real'),
			runnable('j6-s8-resume', 'the resume command is refused (parity-projection-missing)', 'cli', 'local-real'),
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
	{ stepId: 'j6-s4-approval', argv: ['approval.respond', 'ap-1', 'approved'], commandPath: 'approval.respond', expectExit: 1 },
	{ stepId: 'j6-s5-evidence', argv: ['evidence.list', 'task-1'], commandPath: 'evidence.list', expectExit: 1 },
	{ stepId: 'j6-s7-inspect', argv: ['--root', 'ROOT', 'workflow.view', 'graph-none'], commandPath: 'workflow.view' },
	{ stepId: 'j6-s8-resume', argv: ['background-agent.resume', 'ag-1'], commandPath: 'background-agent.resume', expectExit: 1 },
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