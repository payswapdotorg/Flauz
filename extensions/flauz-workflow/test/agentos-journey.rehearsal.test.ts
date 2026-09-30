/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * FLAUZ-TL2-ACC1 -- the P2-002 Agent-domain semantic journey rehearsal
 * (support for the product-phase acceptance journey, docs/FLAUZ-PROGRAM/
 * PRODUCT-PHASE.md P2-002; evidence artifact sidecar:
 * docs/FLAUZ-PROGRAM/acceptance/tl2-agent-domain-journey-evidence.md).
 *
 * The battery (test/agentos-battery.test.ts) verifies every Agent OS
 * invariant INV-1..INV-8 IN ISOLATION. This rehearsal verifies the journey
 * as ONE CHAINED FLOW: the seams BETWEEN the invariants -- state created by
 * the provider-retry leg must survive the restart leg; evidence written
 * during cancellation must still verify in the provenance leg; the A2A
 * delegation composes with the approval gate and the lease conflict; the
 * takeover's evidence mints into the same hash chain the provenance leg
 * walks. ONE shared Agent OS state instance (one workspace root carrying
 * the task envelope, the evidence ledger, the orchestration graphs + journal,
 * tiered memory, the model routing state, the workflow fragment and the A2A
 * bus journal) is carried through every leg IN THIS ORDER:
 *
 *   LEG  1 workspace/mission/task   submit + approve the mission graph
 *                                   through the orchestration surface; the
 *                                   task envelope (mission -> task) is
 *                                   minted and persisted on disk.
 *   LEG  2 agent session            the primary agent opens a session on the
 *                                   task (exclusive claim + session-tier
 *                                   memory record); session state and
 *                                   attribution are journaled.
 *   LEG  3 provider routing         the session's planning turn routes
 *                                   through the model fabric at fixture
 *                                   level (flauz-mock/echo-1 via the
 *                                   zero-network default rule; the durable
 *                                   routing decision ledger) and calls the
 *                                   fixture provider -- NO network, NO live
 *                                   provider (the live-provider rung is
 *                                   landed separately as TL2-H1).
 *   LEG  4 resources                the session's tool step edits + reads a
 *                                   workspace resource through the fixture
 *                                   filesystem port (the LocalEnvFsPort
 *                                   convention of the existing suites) and
 *                                   mints changeset evidence.
 *   LEG  5 A2A delegation           a subtask is delegated to a second agent
 *                                   (routing decision + typed task-delegation
 *                                   message + receipt); the worker reports
 *                                   back; the delegation records and the
 *                                   worker's evidence attribution resolve
 *                                   (no ledger clobbering).
 *   LEG  6 approval/takeover        a human-approval gate arms and stays
 *                                   FAIL-CLOSED (no approval = no execution);
 *                                   the human INTERRUPTS the gate and TAKES
 *                                   the step over; takeover attribution is
 *                                   journaled on every row.
 *   LEG  7 evidence                 provenance ledger entries are written
 *                                   (note + signed checkpoint rows + the
 *                                   workflow fragment, the run's distilled
 *                                   provenance); the hash chain verifies.
 *   LEG  8 provider failure         a typed provider failure is injected at
 *                                   the durable step-execution seam: the
 *                                   automatic bounded, recorded retry
 *                                   engages and recovers (ordinals + waits
 *                                   recorded); an exhaustion probe proves
 *                                   the bound stops (exactly maxAttempts)
 *                                   and the failure is terminal, recorded,
 *                                   never a silent success.
 *   LEG  9 cancel                   a mid-flight human cancel: downstream
 *                                   work stops, the in-flight step is never
 *                                   fake-completed, cancellation attribution
 *                                   (canceller + observation) is recorded,
 *                                   and the cancel observation mints
 *                                   evidence into the shared chain.
 *   LEG 10 lease conflict           two concurrent claimants race one step
 *                                   lease through the flauz.a2a claim path:
 *                                   exactly one winner; the loser receives
 *                                   the typed conflict; both attempts are
 *                                   journaled with minted evidence.
 *   LEG 11 restart                  simulated process death mid-flight (all
 *                                   service instances dropped without
 *                                   cleanup, the INV-1 fixture-rung
 *                                   convention) after the final step's
 *                                   effect settled but BEFORE its journal
 *                                   append (the crash window).
 *   LEG 12 recovery/continuity      cold-boot on the same root: the recovery
 *                                   pass marks the interrupted step, NO
 *                                   silent state loss (tasks, ledger, journal,
 *                                   memory, A2A, routing state, workflow
 *                                   fragment all recover), and WORK CONTINUES:
 *                                   the interrupted step re-drives on the
 *                                   SAME idempotency key (the effect REPLAYS,
 *                                   never executes twice) and the mission
 *                                   completes.
 *   LEG 13 provenance inspection    the evidence chain is walked end-to-end:
 *                                   every ledger row verifies; every
 *                                   minted journal evidence id resolves;
 *                                   attribution is intact for every actor
 *                                   (primary agent, delegate, human
 *                                   approver/takeover, canceller).
 *
 * ONE-STATE LAW: exactly one workspace root + one service bundle carries
 * the whole journey. LEG 11/12 are the sanctioned exception the restart
 * invariant REQUIRES: the service INSTANCES are dropped and rebuilt from
 * the same on-disk state (a real simulated process death -- the
 * recovery-matrix convention: "ALL service instances are dropped and
 * rebuilt from disk only"). The STATE is never reset.
 *
 * EVIDENCE LEVELS (honest, per the evidence law; never up-claimed):
 *   - fixture:    real on-disk substrate (temp-dir workspace root) driven
 *                 through the established fixture ports (the FileSystemPort/
 *                 LocalEnvFsPort convention, the flauz-mock echo provider,
 *                 the on-disk A2A bus, the scripted file-backed effect
 *                 sink). This is the battery's own rung posture.
 *   - simulated:  the process death (LEG 11) is an instance drop, not a
 *                 SIGKILL (the runtime-real SIGKILL version is the drill
 *                 rung); the mid-flight rendezvous (LEG 9) is a
 *                 deterministic promise gate.
 *
 * Receipt:
 *   node --test extensions/flauz-workflow/test/agentos-journey.rehearsal.test.ts
 *
 * The final assembly emits the journey evidence document (schema
 * flauz.agentos-journey/v1) to $FLAUZ_AGENTOS_JOURNEY_EVIDENCE (fallback:
 * a tmpdir file) and prints the greppable per-leg census lines (prefix
 * "agentos journey:"). A leg that CANNOT be made green because of a REAL
 * semantic gap stays in this file with its assertion intact -- it is
 * reported as a CANDIDATE FINDING in the evidence artifact, never weakened
 * or skipped.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeFsSync from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as vscode from 'vscode';

import { sha256Hex, type EvidenceKind, type FileSystemPort, type TaskEvent } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { WorkflowService } from '../src/envelope.ts';
import { createEd25519Signer } from '../src/keys.ts';
import { MemoryStore } from '../../flauz-memory/src/memory.ts';
import { buildEchoResponse, createMockProvider } from '../../flauz-models/src/mockProvider.ts';
import { A2ABus, type A2aMessage } from '../../flauz-agent/core/a2a.mjs';
import { OrchestrationStore, type TaskPort } from '../../flauz-agent/core/orchStore.mjs';
import type { JournalRow } from '../../flauz-agent/core/orchestration.mjs';
import { driveGraph, type EffectSink, type EffectSinkResult, type EffectSpec, type ProviderErrorField } from '../../flauz-agent/core/runtime.mjs';
import { recoveryScan } from '../../flauz-agent/core/recovery.mjs';
import { delegateStep, ingestResultReport, stepResourceId } from '../../flauz-agent/core/routing.mjs';
import { claimStepLease, isLeaseConflictError, leaseConflictFacts, LEASE_CONFLICT_CODE, type ClaimStepLeaseResult } from '../../flauz-agent/core/leaseConflict.mjs';

// ---------------------------------------------------------------------------
// The flauz-models fabric surface (RUNTIME-RESOLVED dynamic import)
//
// The model fabric (the capability registry + the router + the durable
// decision ledger) is exercised through a runtime-resolved dynamic import:
// the flauz-models src surface compiles under flauz-models' OWN tsconfig but
// NOT under this extension's DEFAULT tsconfig -- the default config's
// noUnusedLocals flags a foreign unused import in the fabric's routing store,
// and the fabric's contract/adapters sources need ambient
// TextDecoder/AbortSignal/'node:buffer' declarations this extension's shims
// do not provide -- and the additive-only law of this work order forbids
// editing the default tsconfig (or any foreign file) to wire a dedicated
// config. The local structural types below mirror the real contracts; the
// leg's runtime checks assert the REAL behavior (the actual registry,
// router and decision ledger of flauz-models). The seam itself is recorded
// as a CANDIDATE FINDING in the evidence artifact.
// ---------------------------------------------------------------------------

/** Structural mirror of the flauz-models routing decision (the members this journey asserts). */
interface FabricRoutingDecision {
	readonly decisionId: string;
	readonly ruleId?: string;
	readonly selectionBasis: 'rule-match' | 'no-candidate';
	readonly selected: { readonly providerId: string; readonly modelId: string } | null;
	readonly candidates: ReadonlyArray<{ readonly eligible: boolean; readonly exclusionReason?: string }>;
}

/** Structural mirrors of the fabric constructors (the real classes at runtime). */
interface FabricRegistryHandle {
	load(): Promise<void>;
	list(): readonly unknown[];
}

interface FabricRouterHandle {
	route(request: { purpose: string; requirements: Record<string, unknown> }): Promise<FabricRoutingDecision>;
}

interface FabricModules {
	readonly ModelCapabilityRegistry: new (deps: { root: string; fs: FileSystemPort; clock: () => number }) => FabricRegistryHandle;
	readonly ModelRouter: new (deps: { stateDir: string; fs: FileSystemPort; clock: () => number; records: () => readonly unknown[]; policy: unknown }) => FabricRouterHandle;
	readonly listDecisions: (fs: FileSystemPort, stateDir: string) => Promise<ReadonlyArray<{ decisionId: string }>>;
	readonly DEFAULT_ROUTING_POLICY: unknown;
}

/**
 * Runtime-resolved dynamic import: the NON-LITERAL specifier keeps the type
 * checker from resolving (and pulling) the flauz-models sources into this
 * program (see the seam note above); the runtime loads the REAL modules.
 */
function runtimeImport(specifier: string): Promise<unknown> {
	return import(specifier);
}

async function loadFabricModules(): Promise<FabricModules> {
	const discovery = await runtimeImport('../../flauz-models/src/discovery/registry.ts');
	const routing = await runtimeImport('../../flauz-models/src/routing/store.ts');
	const policy = await runtimeImport('../../flauz-models/src/routing/policy.ts');
	return {
		ModelCapabilityRegistry: (discovery as { ModelCapabilityRegistry: FabricModules['ModelCapabilityRegistry'] }).ModelCapabilityRegistry,
		ModelRouter: (routing as { ModelRouter: FabricModules['ModelRouter']; listDecisions: FabricModules['listDecisions'] }).ModelRouter,
		listDecisions: (routing as { ModelRouter: FabricModules['ModelRouter']; listDecisions: FabricModules['listDecisions'] }).listDecisions,
		DEFAULT_ROUTING_POLICY: (policy as { DEFAULT_ROUTING_POLICY: unknown }).DEFAULT_ROUTING_POLICY,
	};
}

// ---------------------------------------------------------------------------
// Constants, identities, the leg catalogue
// ---------------------------------------------------------------------------

const JOURNEY_SCHEMA = 'flauz.agentos-journey/v1';
const WO_ID = 'FLAUZ-TL2-ACC1';

const PRIMARY = 'flauz.agent.primary';
const WORKER_1 = 'flauz.agent.worker-1';
const WORKER_2 = 'flauz.agent.worker-2';
const WORKER_3 = 'flauz.agent.worker-3';

const MISSION_TITLE = 'P2-002 agent-domain journey mission';
const PLANNING_PROMPT = 'plan the flauz agent-domain acceptance journey';

/** The fixture signer keys (the committed Wave-4 Lane K fixture posture; committed repo fixtures, no secrets). */
const KEYS_DIR = nodePath.join(
	nodePath.dirname(fileURLToPath(import.meta.url)),
	'..', '..', '..',
	'test', 'fixtures', 'workflow', 'keys',
);

interface LegEntry {
	readonly leg: number;
	readonly name: string;
	readonly evidenceLevel: 'fixture' | 'simulated';
}

const LEGS: readonly LegEntry[] = [
	{ leg: 1, name: 'workspace-mission-task', evidenceLevel: 'fixture' },
	{ leg: 2, name: 'agent-session', evidenceLevel: 'fixture' },
	{ leg: 3, name: 'provider-routing', evidenceLevel: 'fixture' },
	{ leg: 4, name: 'resources', evidenceLevel: 'fixture' },
	{ leg: 5, name: 'a2a-delegation', evidenceLevel: 'fixture' },
	{ leg: 6, name: 'approval-takeover', evidenceLevel: 'fixture' },
	{ leg: 7, name: 'evidence', evidenceLevel: 'fixture' },
	{ leg: 8, name: 'provider-failure', evidenceLevel: 'fixture' },
	{ leg: 9, name: 'cancel', evidenceLevel: 'simulated' },
	{ leg: 10, name: 'lease-conflict', evidenceLevel: 'fixture' },
	{ leg: 11, name: 'restart', evidenceLevel: 'simulated' },
	{ leg: 12, name: 'recovery-continuity', evidenceLevel: 'simulated' },
	{ leg: 13, name: 'provenance-inspection', evidenceLevel: 'fixture' },
];

// ---------------------------------------------------------------------------
// The leg recorder (the battery's JourneyRecorder discipline, journey-shaped)
// ---------------------------------------------------------------------------

interface LegVerdict {
	readonly leg: number;
	readonly name: string;
	readonly verdict: 'PASS' | 'FAIL';
	readonly assertions: { readonly pass: number; readonly fail: number };
	readonly evidenceLevel: string;
	readonly firstFailing?: string;
}

interface RecordedCheck {
	readonly id: string;
	readonly ok: boolean;
	readonly detail: string;
}

class LegRecorder {
	private readonly checks: RecordedCheck[] = [];
	private readonly legNumber: number;
	private readonly legName: string;
	private readonly level: string;

	constructor(legNumber: number, legName: string, level: string) {
		this.legNumber = legNumber;
		this.legName = legName;
		this.level = level;
	}

	/** Records one target assertion. NEVER weakens: a false check fails the leg. */
	check(id: string, ok: boolean, detail: string): boolean {
		this.checks.push({ id, ok, detail });
		return ok;
	}

	buildVerdict(): LegVerdict {
		const pass = this.checks.filter(check => check.ok).length;
		const fail = this.checks.filter(check => !check.ok).length;
		const firstFailing = this.checks.find(check => !check.ok);
		return {
			leg: this.legNumber,
			name: this.legName,
			verdict: fail === 0 ? 'PASS' : 'FAIL',
			assertions: { pass, fail },
			evidenceLevel: this.level,
			...(firstFailing === undefined ? {} : { firstFailing: `${firstFailing.id}: ${firstFailing.detail}` }),
		};
	}
}

const legVerdicts: LegVerdict[] = [];

function leg(legNumber: number): LegRecorder {
	const entry = LEGS.find(candidate => candidate.leg === legNumber);
	assert.ok(entry !== undefined, `journey leg ${String(legNumber)} is in the catalogue`);
	return new LegRecorder(entry.leg, entry.name, entry.evidenceLevel);
}

// ---------------------------------------------------------------------------
// The shared state bundle (ONE workspace root, the full Agent OS substrate)
// ---------------------------------------------------------------------------

/** The fixture filesystem port (the battery convention: FileSystemPort & LocalEnvFsPort & rm). */
type JourneyFs = FileSystemPort & { rm(path: string): Promise<void> };

function journeyFsPort(): JourneyFs {
	return {
		readFileUtf8: async target => {
			try {
				return await nodeFs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		writeFile: (target, contents) => nodeFs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => nodeFs.appendFile(target, contents, { encoding: 'utf-8' }),
		rename: (from, to) => nodeFs.rename(from, to),
		mkdir: target => nodeFs.mkdir(target, { recursive: true }),
		rm: target => nodeFs.rm(target, { force: true, recursive: true }),
	};
}

/** Deterministic stepping clock (advances 1000 per call, documented start). */
function steppingClock(start: number): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/** One provider-attempt wait observation (the injected wait port; never a real sleep). */
interface WaitObservation {
	readonly ms: number;
}

/**
 * The file-backed idempotent effect sink (the kill-matrix harness pattern:
 * every run() settles its idempotency key durably; a key already settled
 * REPLAYS its recorded outcome instead of executing twice -- the sink port
 * contract, made durable so it survives the LEG 11 instance drop).
 */
interface SettledEffect {
	readonly ok: boolean;
	readonly value?: unknown;
	readonly failureClass?: string;
	readonly message?: string;
	readonly providerError?: ProviderErrorField;
}

type StepEffectFn = (spec: EffectSpec) => Promise<EffectSinkResult> | EffectSinkResult;

class JourneyEffectSink implements EffectSink {
	private readonly settled: Map<string, SettledEffect>;
	private readonly effects: ReadonlyMap<string, StepEffectFn>;
	readonly logPath: string;
	readonly callLog: Array<{ readonly key: string; readonly replayed: boolean }> = [];

	constructor(logPath: string, effects: ReadonlyMap<string, StepEffectFn>) {
		this.logPath = logPath;
		this.effects = effects;
		this.settled = new Map<string, SettledEffect>();
		if (nodeFsSync.existsSync(logPath)) {
			for (const line of nodeFsSync.readFileSync(logPath, { encoding: 'utf-8' }).split('\n')) {
				if (line.length === 0) {
					continue;
				}
				const entry = JSON.parse(line) as { key: string; replayed: boolean } & SettledEffect;
				if (!entry.replayed) {
					this.settled.set(entry.key, { ok: entry.ok, value: entry.value, failureClass: entry.failureClass, message: entry.message, providerError: entry.providerError });
				}
			}
		}
	}

	async run(idempotencyKey: string, spec: EffectSpec): Promise<EffectSinkResult> {
		const recorded = this.settled.get(idempotencyKey);
		if (recorded !== undefined) {
			// The effect already executed (its log line survived the death) -
			// replay the recorded outcome, NEVER execute twice.
			this.callLog.push({ key: idempotencyKey, replayed: true });
			await this.appendLog({ key: idempotencyKey, replayed: true, ok: recorded.ok, value: recorded.value, failureClass: recorded.failureClass, message: recorded.message });
			return { ok: recorded.ok, value: recorded.value, failureClass: recorded.failureClass, message: recorded.message, providerError: recorded.providerError, replayed: true };
		}
		const effect = this.effects.get(`${spec.graphId}/${spec.stepId}`);
		const result: EffectSinkResult = effect === undefined
			? { ok: true, value: `effect:${spec.stepId}:attempt-${String(spec.attempt)}` }
			: await effect(spec);
		const record: SettledEffect = { ok: result.ok, value: result.value, failureClass: result.failureClass, message: result.message, providerError: result.providerError };
		this.settled.set(idempotencyKey, record);
		this.callLog.push({ key: idempotencyKey, replayed: false });
		await this.appendLog({ key: idempotencyKey, replayed: false, ok: record.ok, value: record.value, failureClass: record.failureClass, message: record.message });
		return { ...record, replayed: false };
	}

	private async appendLog(entry: Record<string, unknown>): Promise<void> {
		await nodeFs.appendFile(this.logPath, `${JSON.stringify(entry)}\n`, { encoding: 'utf-8' });
	}

	/** Fresh (non-replayed) executions of one key recorded in the DURABLE log (survives instance drops). */
	freshExecutionsInLog(key: string): number {
		return this.readLog().filter(entry => entry.key === key && !entry.replayed).length;
	}

	/** Replay calls of one key recorded in the DURABLE log (survives instance drops). */
	replaysOf(key: string): number {
		return this.readLog().filter(entry => entry.key === key && entry.replayed).length;
	}

	private readLog(): Array<{ key: string; replayed: boolean }> {
		if (!nodeFsSync.existsSync(this.logPath)) {
			return [];
		}
		const entries: Array<{ key: string; replayed: boolean }> = [];
		for (const line of nodeFsSync.readFileSync(this.logPath, { encoding: 'utf-8' }).split('\n')) {
			if (line.length === 0) {
				continue;
			}
			entries.push(JSON.parse(line) as { key: string; replayed: boolean });
		}
		return entries;
	}

	callsForStep(graphId: string, stepId: string): number {
		return this.callLog.filter(call => call.key.includes(`/${graphId}/${stepId}/`)).length;
	}
}

/** The evidence-minting TaskPort adapter (the battery trio pattern, recordEvidence-aware). */
function journeyTaskPort(tasks: TaskService, ledger: EvidenceLedger): TaskPort {
	return {
		createTask: async args => ({ taskId: (await tasks.createTask(args.title)).id }),
		appendEvent: async args => ({ task: await tasks.appendEvent(args.taskId, args.event as unknown as TaskEvent) }),
		appendEvidence: async args => {
			const appended = await ledger.append(args.taskId, {
				kind: args.row.kind as EvidenceKind,
				uri: args.row.uri,
				sha256: args.row.sha256,
				...(args.row.note !== undefined ? { note: args.row.note } : {}),
			});
			await tasks.recordEvidence(args.taskId, {
				evidenceId: appended.evidenceId,
				seq: appended.seq,
				kind: args.row.kind as EvidenceKind,
				uri: args.row.uri,
				sha256: args.row.sha256,
				...(args.row.note !== undefined ? { note: args.row.note } : {}),
			});
			return { evidenceId: appended.evidenceId, seq: appended.seq };
		},
	};
}

/** The journey's substrate (constructed per boot; the root persists across LEG 11's death). */
interface JourneyState {
	readonly root: string;
	readonly fs: JourneyFs;
	readonly clock: () => number;
	readonly tasks: TaskService;
	readonly ledger: EvidenceLedger;
	readonly workflows: WorkflowService;
	readonly memory: MemoryStore;
	readonly registry: FabricRegistryHandle;
	readonly router: FabricRouterHandle;
	readonly listDecisions: (fs: FileSystemPort, stateDir: string) => Promise<ReadonlyArray<{ decisionId: string }>>;
	readonly store: OrchestrationStore;
	readonly bus: A2ABus;
	readonly sink: JourneyEffectSink;
}

/**
 * Boots the full substrate on one workspace root. The `effects` map is
 * injected so the LEG 12 cold boot re-creates the sink over the same log
 * with the same effect closures (settled keys replay; the closures never
 * re-run for settled keys). The flauz-models fabric modules are loaded once
 * per journey (runtime-resolved; see the seam note) and shared by both
 * boots -- the INSTANCES are per-boot, the on-disk state is shared.
 */
async function bootJourney(root: string, effects: ReadonlyMap<string, StepEffectFn>, fabric: FabricModules): Promise<JourneyState> {
	const fs = journeyFsPort();
	const clock = steppingClock(1_740_000_000_000);
	const tasks = new TaskService({ root, fs, clock });
	const ledger = new EvidenceLedger({
		root,
		fs,
		clock,
		signer: createEd25519Signer(
			'flauz-fixture-ed25519-1',
			nodeFsSync.readFileSync(nodePath.join(KEYS_DIR, 'ed25519-private.pem'), { encoding: 'utf-8' }),
			nodeFsSync.readFileSync(nodePath.join(KEYS_DIR, 'ed25519-public.pem'), { encoding: 'utf-8' }),
		),
		checkpointInterval: 0,
	});
	const workflows = new WorkflowService({ root, fs, tasks, ledger, clock });
	const memory = new MemoryStore({ root, fs, clock });
	await tasks.bootstrap();
	await ledger.ensure();
	await memory.ensure();
	await fs.mkdir(`${root}/.flauz/workflows`);
	const registry = new fabric.ModelCapabilityRegistry({ root, fs, clock });
	await registry.load();
	const router = new fabric.ModelRouter({ stateDir: `${root}/.flauz/models`, fs, clock, records: () => registry.list(), policy: fabric.DEFAULT_ROUTING_POLICY });
	const store = new OrchestrationStore(root, { clock, taskPort: journeyTaskPort(tasks, ledger) });
	const bus = new A2ABus(root);
	const sink = new JourneyEffectSink(`${root}/.flauz/journey-sink.jsonl`, effects);
	return { root, fs, clock, tasks, ledger, workflows, memory, registry, router, listDecisions: fabric.listDecisions, store, bus, sink };
}

/** Reads the on-disk bus journal lines (the shared A2A surface). */
async function readBusMessages(root: string): Promise<A2aMessage[]> {
	const raw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'a2a', 'messages.jsonl'), { encoding: 'utf-8' });
	return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as A2aMessage);
}

/** Reads the on-disk orchestration journal (raw; the store's own loader is the strict reader). */
async function readJournalOnDisk(root: string): Promise<JournalRow[]> {
	const raw = await nodeFs.readFile(nodePath.join(root, '.flauz', 'orchestration', 'journal.jsonl'), { encoding: 'utf-8' });
	return raw.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as JournalRow);
}

/** The LEG 9 mid-flight rendezvous (deterministic: the drive blocks until the human cancels). */
class CancelRendezvous {
	private resolveGate: () => void = () => { };
	private signalStarted: () => void = () => { };
	readonly started: Promise<void>;
	private readonly gate: Promise<void>;

	constructor() {
		this.gate = new Promise<void>(resolve => {
			this.resolveGate = resolve;
		});
		this.started = new Promise<void>(resolve => {
			this.signalStarted = resolve;
		});
	}

	/** The blocked effect calls this when it enters (mid-flight reached). */
	enter(): void {
		this.signalStarted();
	}

	/** The blocked effect awaits this (released by the human's cancel). */
	released(): Promise<void> {
		return this.gate;
	}

	/** The main flow releases the blocked effect after the cancel lands. */
	release(): void {
		this.resolveGate();
	}
}

// ---------------------------------------------------------------------------
// The journey (ONE test flow, ONE shared state, thirteen legs in order)
// ---------------------------------------------------------------------------

test('the P2-002 agent-domain journey: thirteen chained legs over one shared Agent OS state', async () => {
	const root = await nodeFs.mkdtemp(nodePath.join(os.tmpdir(), 'flauz-agentos-journey-'));
	const effects = new Map<string, StepEffectFn>();
	const providerWaits: WaitObservation[] = [];
	const cancelRendezvous = new CancelRendezvous();

	// shared journey facts (captured by the effect closures and asserted across legs)
	let missionTaskId = '';
	let missionGraphId = '';
	let cancelGraphId = '';
	let cancelTaskId = '';
	let planningEchoText = '';
	let briefResourceUri = '';
	let briefReadBack: string | undefined;
	let workerEvidenceId = '';

	// ---- the scripted effects (the sink executes them; settled keys replay) ----

	// LEG 4: S-01 drafts the journey brief (the resource edit + read through the fixture fs port)
	effects.set('G-001/S-01', async () => {
		const briefContent = `# Journey brief\n\n${planningEchoText}\n\n- mission: ${MISSION_TITLE}\n- task: ${missionTaskId}\n`;
		await state.fs.writeFile(`${state.root}/${briefResourceUri}`, briefContent);
		briefReadBack = await state.fs.readFileUtf8(`${state.root}/${briefResourceUri}`);
		return { ok: true, value: `brief drafted (${String(briefReadBack?.length)} bytes)` };
	});

	// LEG 8: S-04 is the provider-reliant step: fails twice with the TYPED provider
	// error (the DL-35 shape), succeeds on the third attempt INSIDE the window bound.
	let s04FreshRuns = 0;
	effects.set('G-001/S-04', () => {
		s04FreshRuns += 1;
		if (s04FreshRuns <= 2) {
			return {
				ok: false,
				failureClass: 'provider-error',
				message: 'typed provider failure injected (HTTP 500 from the journey provider double)',
				providerError: { code: 'flauz.provider.journey-500', retryClass: 'short-backoff' as const, retryAfterMs: 25 },
			};
		}
		return { ok: true, value: 'provider-reliant enrichment recovered' };
	});

	// LEG 8 (b): the exhaustion probe -- the provider fails beyond the bound (unbounded
	// queued failures; the window must stop at exactly maxAttempts).
	let probeFreshRuns = 0;
	effects.set('G-002/S-01', () => {
		probeFreshRuns += 1;
		return {
			ok: false,
			failureClass: 'provider-error',
			message: 'typed provider failure injected (HTTP 503; failures queued beyond the window bound)',
			providerError: { code: 'flauz.provider.journey-503', retryClass: 'immediate' as const },
		};
	});

	// LEG 9: the cancellation probe -- the first step blocks mid-flight (the deterministic
	// rendezvous: the human cancel lands while the effect is in flight).
	effects.set('G-003/S-01', async () => {
		cancelRendezvous.enter();
		await cancelRendezvous.released();
		return { ok: true, value: 'blocked work finished after the cancel landed' };
	});

	// LEG 11: S-05 (final assembly) settles BEFORE the death; the LEG 12 re-drive REPLAYS it.
	effects.set('G-001/S-05', () => ({ ok: true, value: 'journey final assembly complete' }));

	const fakeWait = async (ms: number): Promise<void> => {
		providerWaits.push({ ms });
	};

	// the flauz-models fabric modules (runtime-resolved; see the seam note) --
	// loaded ONCE, shared by both boots (the instances are per-boot)
	const fabric = await loadFabricModules();

	let state = await bootJourney(root, effects, fabric);

	try {
		// =====================================================================
		// LEG 1 -- workspace/mission/task: the mission -> task envelope
		// =====================================================================
		{
			const recorder = leg(1);
			const submitted = await state.store.submitGraph({
				title: MISSION_TITLE,
				steps: [
					{ stepId: 'S-01', title: 'draft the journey brief', instruction: 'route the planning turn through the model fabric and draft the workspace brief resource', tool: 'flauz_terminal' },
					{ stepId: 'S-02', title: 'research the delegated slice', instruction: 'the delegated research slice, executed by the worker agent', dependsOn: ['S-01'] },
					{ stepId: 'S-03', title: 'gated release decision', instruction: 'the human-approval gate before release', dependsOn: ['S-02'], gate: 'human-approval' },
					{ stepId: 'S-04', title: 'provider-reliant enrichment', instruction: 'the enrichment step that calls the failing provider', dependsOn: ['S-03'] },
					{ stepId: 'S-05', title: 'final assembly', instruction: 'assemble the journey artifacts (gated: the human approves the final assembly)', dependsOn: ['S-04'], gate: 'human-approval' },
				],
				actor: 'agent',
				origin: 'journey:tl2-acc1',
			});
			missionGraphId = submitted.graphId;
			missionTaskId = submitted.taskId ?? '';
			await state.store.approveGraph({ graphId: missionGraphId, actor: 'human', origin: 'journey:tl2-acc1' });

			// the task envelope persisted on disk (read the raw envelope, not the instance)
			const envelopeRaw = await state.fs.readFileUtf8(`${root}/.flauz/tasks.json`);
			recorder.check('leg1.task-envelope-persisted', envelopeRaw !== undefined && envelopeRaw.includes(missionTaskId), `the .flauz/tasks.json envelope carries the minted task ${missionTaskId}`);
			const envelope = envelopeRaw === undefined ? undefined : JSON.parse(envelopeRaw) as { $schema?: string; tasks?: Array<{ id?: string; status?: string; events?: Array<{ type?: string; actor?: string }> }> };
			recorder.check('leg1.mission-to-task-minted', /^T-\d{3,}$/.test(missionTaskId) && envelope?.tasks?.some(task => task.id === missionTaskId) === true, `submitGraph minted the task envelope ${missionTaskId} through the orchestration surface`);
			const mintedTask = envelope?.tasks?.find(task => task.id === missionTaskId);
			recorder.check('leg1.task-spine-on-disk', mintedTask?.status === 'plan' && (mintedTask.events?.length ?? 0) >= 1 && mintedTask.events?.some(event => event.type === 'graph-submitted' && event.actor === 'agent') === true, `the persisted task ${missionTaskId} is 'plan' and carries the mirrored graph-submitted (actor agent) event on its timeline`);

			// the graph envelope persisted on disk
			const graphsRaw = await state.fs.readFileUtf8(`${root}/.flauz/orchestration/graphs.json`);
			const graphs = graphsRaw === undefined ? undefined : JSON.parse(graphsRaw) as { graphs?: Array<{ graphId?: string; taskId?: string; steps?: unknown[] }> };
			recorder.check('leg1.graph-envelope-persisted', graphs?.graphs?.some(graph => graph.graphId === missionGraphId && graph.taskId === missionTaskId && (graph.steps?.length ?? 0) === 5) === true, `the graphs envelope persists ${missionGraphId} (5 steps) linked to ${missionTaskId}`);

			// the journal rows: submission + approval, with attribution
			const rows = state.store.rowsFor(missionGraphId);
			recorder.check('leg1.journal-rows', rows.some(row => row.type === 'graph-submitted' && row.actor === 'agent' && (row.payload as { taskId?: string }).taskId === missionTaskId) && rows.some(row => row.type === 'graph-approved' && row.actor === 'human'), `the journal records graph-submitted (actor agent, taskId ${missionTaskId}) + graph-approved (actor human)`);

			const listed = state.store.listGraphs();
			recorder.check('leg1.graph-approved-state', listed.some(graph => graph.graphId === missionGraphId && graph.graphStatus === 'approved'), `the mission graph ${missionGraphId} is approved and ready for work`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 2 -- agent session: state + attribution
		// =====================================================================
		{
			const recorder = leg(2);
			const claim = await state.store.acquireClaim({ graphId: missionGraphId, stepId: 'S-01', holder: PRIMARY, actor: 'agent', origin: 'journey:session' });
			const sessionRecord = await state.memory.record('session', {
				kind: 'observation',
				content: `session opened on ${missionTaskId} by ${PRIMARY}`,
				taskId: missionTaskId,
				agentId: PRIMARY,
				provenance: { actor: 'agent', origin: 'task-event', ts: state.clock() },
			});

			const claimRow = state.store.journalRows.find(row => row.type === 'claim-acquired' && row.rowId === claim.rowId);
			recorder.check('leg2.claim-attribution', claimRow !== undefined && (claimRow.payload as { holder?: string }).holder === PRIMARY && claimRow.actor === 'agent', `the session claim row carries holder ${PRIMARY} with actor attribution`);
			const stateAfter = state.store.stateOf(missionGraphId);
			const activeClaim = (stateAfter as { claims?: Record<string, { holder?: string }> }).claims?.['S-01'];
			recorder.check('leg2.session-claim-state', activeClaim?.holder === PRIMARY, `the session claim is active in the graph state (holder ${String(activeClaim?.holder)})`);

			const sessionRecords = await state.memory.list('session');
			recorder.check('leg2.session-memory-attribution', sessionRecords.length === 1 && sessionRecords[0]?.taskId === missionTaskId && sessionRecords[0]?.agentId === PRIMARY && sessionRecords[0]?.provenance.actor === 'agent', `the session-tier memory record is attributed to task ${missionTaskId} + agent ${PRIMARY}`);

			const sessionJournalRaw = await state.fs.readFileUtf8(`${root}/.flauz/memory/session.jsonl`);
			recorder.check('leg2.session-memory-persisted', sessionJournalRaw !== undefined && sessionJournalRaw.includes(sessionRecord.record.id), `the session journal on disk carries the record ${sessionRecord.record.id}`);
			const sessionJournal = sessionJournalRaw?.split('\n').filter(line => line.length > 0) ?? [];
			recorder.check('leg2.session-journal-lines', sessionJournal.length === 1, `exactly one session journal line is persisted (${String(sessionJournal.length)})`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 3 -- provider routing: the model fabric at fixture level
		// =====================================================================
		{
			const recorder = leg(3);
			// (a) the durable routing decision (the zero-network default rule)
			const decision = await state.router.route({ purpose: 'chat-turn', requirements: { enabledOnly: true } });
			recorder.check('leg3.routing-decision', decision.selected?.providerId === 'flauz-mock' && decision.selected?.modelId === 'echo-1' && decision.ruleId === 'zero-network-default' && decision.selectionBasis === 'rule-match', `the session's planning turn routed to ${String(decision.selected?.providerId)}/${String(decision.selected?.modelId)} via rule ${String(decision.ruleId)} (decision ${decision.decisionId})`);
			recorder.check('leg3.no-silent-fallback', decision.candidates.some(candidate => !candidate.eligible && candidate.exclusionReason === 'provider disabled'), 'the disabled remote vendors are listed as excluded with reasons (no silent fallback)');
			const decisionsOnDisk = await state.listDecisions(state.fs, `${root}/.flauz/models`);
			recorder.check('leg3.decision-persisted', decisionsOnDisk.length === 1 && decisionsOnDisk[0]?.decisionId === decision.decisionId, `the routing decision ${decision.decisionId} is persisted in the durable decision ledger`);

			// (b) the provider call through the fixture echo provider (NO network, NO live provider)
			const provider = createMockProvider();
			const token: vscode.CancellationToken = {
				isCancellationRequested: false,
				onCancellationRequested: () => ({ dispose: () => { } }),
			};
			const models = await provider.provideLanguageModelChatInformation({ silent: true }, token);
			const model = models === undefined || models === null ? undefined : models[0];
			recorder.check('leg3.provider-models', model !== undefined && model.id === 'echo-1', `the fixture provider serves exactly the echo-1 model (${String(model?.id)})`);
			if (model === undefined) {
				throw new Error('agentos journey: the fixture provider did not report the echo-1 model');
			}
			const ROLE_USER: vscode.LanguageModelChatMessageRole = 1; // vscode.d.ts:20134 (erasable-syntax law: never reference enum values)
			const TOOL_MODE_AUTO: vscode.LanguageModelChatToolMode = 1; // vscode.d.ts: LanguageModelChatToolMode.Auto (same law)
			// the request-message content is the typed parts array (the LanguageModelTextPart shape: { value })
			const messages: vscode.LanguageModelChatRequestMessage[] = [{ role: ROLE_USER, content: [{ value: PLANNING_PROMPT }], name: undefined }];
			const chunks: string[] = [];
			const progress: vscode.Progress<vscode.LanguageModelResponsePart> = {
				report(part) {
					if (typeof (part as { value?: unknown }).value === 'string') {
						chunks.push((part as { value: string }).value);
					}
				},
			};
			await provider.provideLanguageModelChatResponse(model, messages, { toolMode: TOOL_MODE_AUTO }, progress, token);
			planningEchoText = chunks.join('');
			recorder.check('leg3.provider-call-deterministic', planningEchoText === `flauz-mock echo: ${PLANNING_PROMPT}` && planningEchoText === buildEchoResponse(PLANNING_PROMPT).join(''), `the routed provider call echoed deterministically: ${planningEchoText.slice(0, 60)}...`);

			// (c) the planning output lands in the shared evidence chain (the session's planning artifact)
			const echoArtifactUri = `.flauz/artifacts/${missionTaskId}/planning-echo-1.txt`;
			await state.fs.mkdir(`${root}/.flauz/artifacts/${missionTaskId}`);
			await state.fs.writeFile(`${root}/${echoArtifactUri}`, planningEchoText);
			const appended = await state.ledger.append(missionTaskId, { kind: 'note', uri: echoArtifactUri, sha256: sha256Hex(planningEchoText), note: 'flauz-mock echo planning turn' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: appended.evidenceId, seq: appended.seq, kind: 'note', uri: echoArtifactUri, sha256: sha256Hex(planningEchoText), note: 'flauz-mock echo planning turn' });
			recorder.check('leg3.evidence-minted', appended.evidenceId !== '' && (await state.ledger.rowByEvidenceId(appended.evidenceId))?.uri === echoArtifactUri, `the planning turn minted evidence row ${appended.evidenceId}`);

			// (d) the session's memory references the evidence row (origin ledger-row requires the linkage)
			const planningMemory = await state.memory.record('session', {
				kind: 'evidence-ref',
				content: `the planning turn produced ${appended.evidenceId}`,
				taskId: missionTaskId,
				agentId: PRIMARY,
				provenance: { actor: 'agent', origin: 'ledger-row', ts: state.clock(), evidenceId: appended.evidenceId },
			});
			recorder.check('leg3.memory-evidence-linkage', planningMemory.record.provenance.evidenceId === appended.evidenceId, `the session memory references the ledger row ${appended.evidenceId} (origin ledger-row)`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 4 -- resources: edit + read through the fixture filesystem port
		// =====================================================================
		{
			const recorder = leg(4);
			// the session's tool step: start -> effect (the resource edit through the fs port) -> finish
			briefResourceUri = 'journey-brief.md';
			const start = await state.store.startStep({ graphId: missionGraphId, stepId: 'S-01', runnerId: PRIMARY, actor: 'agent', origin: 'journey:brief' });
			const effect = await state.sink.run(start.idempotencyKey, {
				graphId: missionGraphId,
				stepId: 'S-01',
				attempt: start.attempt,
				tool: 'flauz_terminal',
				toolInput: null,
				instruction: 'route the planning turn through the model fabric and draft the workspace brief resource',
			});
			const finished = await state.store.finishStep({
				graphId: missionGraphId,
				stepId: 'S-01',
				attempt: start.attempt,
				outcome: 'succeeded',
				output: String(effect.value ?? ''),
				evidence: [{ kind: 'note', uri: `flauz-orch-effect://${missionGraphId}/S-01/run/${String(start.attempt)}`, sha256: sha256Hex(String(effect.value ?? '')) }],
				actor: 'agent',
				origin: 'journey:brief',
			});

			// the effect wrote + read the resource through the fixture fs port (the LocalEnvFsPort convention)
			const briefOnDisk = await state.fs.readFileUtf8(`${root}/${briefResourceUri}`);
			recorder.check('leg4.resource-round-trip', briefReadBack !== undefined && briefOnDisk === briefReadBack && (briefReadBack?.includes(missionTaskId) ?? false), `the workspace resource ${briefResourceUri} round-trips through the fixture filesystem port (${String(briefReadBack?.length)} bytes, task-pinned)`);
			recorder.check('leg4.resource-on-disk', briefOnDisk !== undefined && briefOnDisk.length === (briefReadBack?.length ?? -1) && briefOnDisk.length > 0, `the edited resource is persisted on disk (${String(briefOnDisk?.length)} bytes)`);

			recorder.check('leg4.step-started-attribution', (state.store.journalRows.find(row => row.type === 'step-started' && row.rowId === start.rowId)?.payload as { runnerId?: string } | undefined)?.runnerId === PRIMARY, `the tool step started with runner attribution ${PRIMARY}`);
			recorder.check('leg4.effect-idempotency-key', start.idempotencyKey === `flauz-orch/${missionGraphId}/S-01/run/${String(start.attempt)}` && state.sink.freshExecutionsInLog(start.idempotencyKey) === 1, `the effect settled exactly once on its idempotency key ${start.idempotencyKey}`);
			recorder.check('leg4.step-succeeded', finished.type === 'step-succeeded' && state.store.stateOf(missionGraphId).steps['S-01']?.status === 'succeeded', `the brief-drafting step S-01 succeeded (row ${finished.rowId})`);

			// the resource edit mints changeset evidence (the changeset -> task.changes linkage)
			const briefContent = briefReadBack ?? '';
			const changeset = await state.ledger.append(missionTaskId, { kind: 'changeset', uri: briefResourceUri, sha256: sha256Hex(briefContent), note: 'the journey brief resource edit' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: changeset.evidenceId, seq: changeset.seq, kind: 'changeset', uri: briefResourceUri, sha256: sha256Hex(briefContent), note: 'the journey brief resource edit' });
			const missionTask = await state.tasks.getTask(missionTaskId);
			recorder.check('leg4.changeset-linkage', (await state.ledger.rowByEvidenceId(changeset.evidenceId))?.uri === briefResourceUri && missionTask.changes.some(change => change.uri === briefResourceUri), `the resource edit minted changeset evidence ${changeset.evidenceId} and the task carries the change ${briefResourceUri}`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 5 -- A2A delegation: records + attribution (no ledger clobbering)
		// =====================================================================
		{
			const recorder = leg(5);
			const ledgerRowsBefore = (await state.ledger.readRows()).length;

			const delegation = await delegateStep(state.store, state.bus, {
				graphId: missionGraphId,
				stepId: 'S-02',
				targetAgent: WORKER_1,
				reason: 'capability-match',
				details: { requiredCapability: 'journey-research', matched: [WORKER_1] },
				fromAgent: PRIMARY,
				origin: 'journey:delegation',
			});

			// the worker executes the delegated slice: its own artifact + evidence in the SHARED ledger
			const workerArtifactUri = `.flauz/artifacts/${missionTaskId}/worker-research-1.txt`;
			const workerOutput = `delegated research slice complete for ${MISSION_TITLE}`;
			await state.fs.writeFile(`${root}/${workerArtifactUri}`, workerOutput);
			const workerEvidence = await state.ledger.append(missionTaskId, { kind: 'command-output', uri: workerArtifactUri, sha256: sha256Hex(workerOutput), note: 'the delegated research slice (worker)' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: workerEvidence.evidenceId, seq: workerEvidence.seq, kind: 'command-output', uri: workerArtifactUri, sha256: sha256Hex(workerOutput), note: 'the delegated research slice (worker)' });
			workerEvidenceId = workerEvidence.evidenceId;

			// the worker reports back over the real bus (the typed result-report)
			const report = await state.bus.post({
				message: {
					kind: 'result-report',
					from: WORKER_1,
					to: PRIMARY,
					payload: { taskId: missionTaskId, outcome: 'ok', evidenceIds: [workerEvidenceId], summary: workerOutput },
				},
			});
			const ingested = await ingestResultReport(state.store, {
				graphId: missionGraphId,
				stepId: 'S-02',
				messageId: report.id,
				outcome: 'ok',
				summary: workerOutput,
				evidenceIds: [workerEvidenceId],
				fromAgent: WORKER_1,
			});

			// the delegation records: routing decision, message, receipt, result
			const decisionRow = state.store.journalRows.find(row => row.type === 'route-decided' && row.rowId === delegation.decisionRowId);
			recorder.check('leg5.routing-decision-recorded', (decisionRow?.payload as { targetAgent?: string; reason?: string } | undefined)?.targetAgent === WORKER_1 && decisionRow !== undefined && (decisionRow.payload as { reason?: string }).reason === 'capability-match', `the routing decision row records WHY ${WORKER_1} (reason capability-match)`);
			const receiptRow = state.store.journalRows.find(row => row.type === 'delegation-sent' && row.rowId === delegation.receiptRowId);
			recorder.check('leg5.delegation-receipt-linked', receiptRow !== undefined && (receiptRow.payload as { messageId?: string; decisionRowId?: string }).messageId === delegation.messageId && (receiptRow.payload as { decisionRowId?: string }).decisionRowId === delegation.decisionRowId, `the delegation-sent receipt links decision row ${delegation.decisionRowId} + bus message ${delegation.messageId}`);
			const resultRow = state.store.journalRows.find(row => row.type === 'result-received' && row.rowId === ingested.receiptRowId);
			recorder.check('leg5.result-attribution', resultRow !== undefined && resultRow.origin === `a2a:${WORKER_1}` && (resultRow.payload as { evidenceIds?: string[] }).evidenceIds?.[0] === workerEvidenceId, `the result-received row carries the delegate attribution origin ${String(resultRow?.origin)}`);

			// the bus journal on disk: the typed round-trip
			const busMessages = await readBusMessages(root);
			const delegationMessage = busMessages.find(message => message.id === delegation.messageId);
			const reportMessage = busMessages.find(message => message.id === report.id);
			recorder.check('leg5.bus-round-trip', delegationMessage?.kind === 'task-delegation' && delegationMessage?.from === PRIMARY && delegationMessage?.to === WORKER_1 && reportMessage?.kind === 'result-report' && reportMessage?.from === WORKER_1 && reportMessage?.to === PRIMARY, `the typed A2A round-trip landed on the shared bus journal (${String(delegationMessage?.kind)} ${String(delegationMessage?.id)} + ${String(reportMessage?.kind)} ${String(reportMessage?.id)})`);

			// the delegated step completed with the worker as runner
			const delegatedStep = state.store.stateOf(missionGraphId).steps['S-02'];
			recorder.check('leg5.delegated-step-succeeded', delegatedStep?.status === 'succeeded' && delegatedStep?.runnerId === WORKER_1, `the delegated step S-02 succeeded with runner ${String(delegatedStep?.runnerId)}`);

			// evidence attribution: the reported evidence resolves to the shared ledger, attributed to the mission task
			const workerRow = await state.ledger.rowByEvidenceId(workerEvidenceId);
			recorder.check('leg5.evidence-attribution', workerRow !== undefined && workerRow.taskId === missionTaskId && workerRow.uri === workerArtifactUri, `the delegate's reported evidence ${workerEvidenceId} resolves to a ledger row attributed to ${missionTaskId}`);
			const ledgerRowsAfter = await state.ledger.readRows();
			// only the worker's evidence row is a LEDGER row (the delegation receipts are journal rows);
			// every seq stays unique -- no clobbering of the shared chain
			recorder.check('leg5.no-ledger-clobbering', ledgerRowsAfter.length === ledgerRowsBefore + 1 && new Set(ledgerRowsAfter.map(row => row.seq)).size === ledgerRowsAfter.length, `the shared ledger grew by exactly the worker's one row (${String(ledgerRowsBefore)} -> ${String(ledgerRowsAfter.length)}, seqs unique)`);
			const chainVerify = await state.ledger.verify();
			recorder.check('leg5.chain-intact', chainVerify.ok, `the ledger hash chain verifies after the delegation round-trip (rows ${String(chainVerify.rows)})`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 6 -- approval/takeover: FAIL-CLOSED gate + human takeover
		// =====================================================================
		{
			const recorder = leg(6);

			// (a) the gate arms and the drive STOPS: no approval = no execution
			const gateDrive = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:gate', now: state.clock(), wait: fakeWait });
			const approvalRow = state.store.journalRows.find(row => row.type === 'approval-requested' && row.graphId === missionGraphId && row.stepId === 'S-03');
			recorder.check('leg6.gate-arms-fail-closed', approvalRow !== undefined && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'awaiting-approval' && gateDrive.started.length === 0, `the human-approval gate armed on S-03 (row ${String(approvalRow?.rowId)}) and the drive executed zero steps`);
			recorder.check('leg6.no-execution-without-approval', state.sink.callsForStep(missionGraphId, 'S-03') === 0 && state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-03') === false, 'FAIL-CLOSED: the gated step never started (no approval = no execution)');

			// (b) the human INTERRUPTS the pending gate and TAKES the step over
			const takeoverRequested = await state.store.takeoverRequest({ graphId: missionGraphId, stepId: 'S-03', actor: 'human', origin: 'journey:takeover', reason: 'the human interrupts the approval gate and takes the release decision over' });
			recorder.check('leg6.takeover-interrupts-gate', takeoverRequested.type === 'takeover-requested' && takeoverRequested.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'takeover-pending', `the interrupted gate moved to takeover-pending (row ${takeoverRequested.rowId}, actor human)`);
			const takeoverAccepted = await state.store.takeoverAccept({ graphId: missionGraphId, stepId: 'S-03', actor: 'human', origin: 'journey:takeover', note: 'the human accepts the takeover' });
			recorder.check('leg6.takeover-accepted', takeoverAccepted.type === 'takeover-accepted' && takeoverAccepted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'taken-over', 'the human-only takeover acceptance landed with attribution');
			const takeoverSummary = 'the human completed the gated release decision personally';
			const takeoverCompleted = await state.store.takeoverComplete({
				graphId: missionGraphId,
				stepId: 'S-03',
				actor: 'human',
				origin: 'journey:takeover',
				summary: takeoverSummary,
				evidence: [{ kind: 'note', uri: `flauz-orch-takeover://${missionGraphId}/S-03`, sha256: sha256Hex(takeoverSummary) }],
			});
			recorder.check('leg6.takeover-completed-attribution', takeoverCompleted.type === 'takeover-completed' && takeoverCompleted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-03']?.status === 'succeeded', `the taken-over step completed by the HUMAN (row ${takeoverCompleted.rowId}, actor human) -- never by an unapproved agent execution`);

			// the takeover mints evidence into the shared chain
			const takeoverEvidenceIds = (takeoverCompleted.payload as { evidence?: Array<{ evidenceId?: string }> }).evidence?.map(item => item.evidenceId ?? '') ?? [];
			const takeoverEvidenceRow = takeoverEvidenceIds[0] === undefined || takeoverEvidenceIds[0] === '' ? undefined : await state.ledger.rowByEvidenceId(takeoverEvidenceIds[0]);
			recorder.check('leg6.takeover-evidence-minted', takeoverEvidenceRow !== undefined && takeoverEvidenceRow.uri === `flauz-orch-takeover://${missionGraphId}/S-03`, `the takeover minted evidence ${String(takeoverEvidenceIds[0])} into the shared chain`);

			// the gate never unlocked an agent execution: S-03 still has no step-started row
			recorder.check('leg6.gate-never-unlocked-agent-run', state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-03') === false && state.sink.callsForStep(missionGraphId, 'S-03') === 0, 'the gate stayed FAIL-CLOSED end to end: the step was completed by the human takeover, never by agent execution');

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 7 -- evidence: provenance ledger entries + the hash chain
		// =====================================================================
		{
			const recorder = leg(7);
			// (a) a note row + its artifact
			const noteArtifactUri = `.flauz/artifacts/${missionTaskId}/journey-note-1.txt`;
			const noteText = `journey midpoint provenance note for ${missionTaskId}`;
			await state.fs.writeFile(`${root}/${noteArtifactUri}`, noteText);
			const noteRow = await state.ledger.append(missionTaskId, { kind: 'note', uri: noteArtifactUri, sha256: sha256Hex(noteText), note: 'the journey midpoint note' });
			await state.tasks.recordEvidence(missionTaskId, { evidenceId: noteRow.evidenceId, seq: noteRow.seq, kind: 'note', uri: noteArtifactUri, sha256: sha256Hex(noteText), note: 'the journey midpoint note' });

			// (b) a SIGNED ledger checkpoint (the DL-20 Wave-4 fixture-signer posture; a chain-level
			// row -- the ledger's own checkpoint task id, NOT mission-task evidence)
			const checkpoint = await state.ledger.appendCheckpoint();
			const checkpointRow = checkpoint.row;
			recorder.check('leg7.checkpoint-signed', checkpointRow.kind === 'checkpoint' && checkpointRow.checkpoint !== undefined && checkpointRow.checkpoint.algorithm === 'ed25519', `the signed checkpoint row ${checkpoint.evidenceId} carries the ed25519 payload (key ${String(checkpointRow.checkpoint?.keyId)})`);

			// (c) the workflow fragment: the run's distilled provenance (plan + tools + approvals + evidence refs)
			const savedFragment = await state.workflows.save({ taskId: missionTaskId });
			const fragments = await state.workflows.list();
			const missionTask = await state.tasks.getTask(missionTaskId);
			recorder.check('leg7.workflow-fragment-saved', fragments.length === 1 && fragments[0]?.id === savedFragment.workflowId && fragments[0]?.source.taskId === missionTaskId && (fragments[0]?.evidenceRefs.length ?? 0) >= 3, `the workflow fragment ${savedFragment.workflowId} distills the run (task ${missionTaskId}, ${String(fragments[0]?.evidenceRefs.length)} evidence refs)`);
			recorder.check('leg7.fragment-recorded-on-timeline', missionTask.events.some(event => event.type === 'workflow-saved' && (event.payload as { workflowId?: string }).workflowId === savedFragment.workflowId), `the task timeline records the fragment save (${savedFragment.workflowId})`);

			// (d) the hash chain verifies end to end at the midpoint
			const verify = await state.ledger.verify();
			const rows = await state.ledger.readRows();
			recorder.check('leg7.hash-chain-verifies', verify.ok && verify.rows === rows.length && rows.every((row, index) => row.seq === index + 1), `the ledger hash chain verifies at the midpoint (rows ${String(verify.rows)}, seqs contiguous)`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 8 -- provider failure: typed, bounded, recorded retry
		// =====================================================================
		{
			const recorder = leg(8);

			// (a) the mission's provider-reliant step: fail -> retry (recorded) -> recover INSIDE the bound
			const providerDrive = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:provider', providerRetry: { maxAttempts: 3 }, wait: fakeWait, now: state.clock() });
			const s04 = providerDrive.started.find(record => record.stepId === 'S-04');
			recorder.check('leg8.recovered-within-bound', s04 !== undefined && s04.providerAttempts === 3 && s04.providerExhausted === false && state.store.stateOf(missionGraphId).steps['S-04']?.status === 'succeeded', `the provider-reliant step recovered on attempt ${String(s04?.providerAttempts)}/3 (bounded) and succeeded`);
			const retryRows = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === missionGraphId && row.stepId === 'S-04');
			const ordinals = retryRows.map(row => (row.payload as { attemptOrdinal?: number }).attemptOrdinal ?? -1).join(',');
			const outcomes = retryRows.map(row => (row.payload as { outcome?: string }).outcome ?? '').join(',');
			recorder.check('leg8.retry-attempts-recorded', retryRows.length === 3 && ordinals === '1,2,3' && outcomes === 'retryable-failed,retryable-failed,recovered', `the retry window recorded its attempts (ordinals ${ordinals}; outcomes ${outcomes})`);
			const waitFacts = retryRows.map(row => (row.payload as { waitAppliedMs?: number }).waitAppliedMs ?? -1).join(',');
			const codeFacts = retryRows.map(row => (row.payload as { code?: string }).code ?? '').join(',');
			recorder.check('leg8.retry-rows-typed', codeFacts === 'flauz.provider.journey-500,flauz.provider.journey-500,flauz.provider.journey-500' && waitFacts === '0,25,25' && retryRows.every(row => (row.payload as { maxAttempts?: number }).maxAttempts === 3), `every attempt row carries the typed DL-35 facts (code ${codeFacts}; waits applied ${waitFacts}; bound 3)`);
			recorder.check('leg8.waits-injected-never-slept', providerWaits.filter(wait => wait.ms === 25).length === 2, `the two backoff waits were applied through the injected wait port (observed ${String(providerWaits.filter(wait => wait.ms === 25).length)} x 25ms; never a real sleep)`);

			// the second gate (S-05) armed while the drive drained -- the lease leg composes with a pending approval
			recorder.check('leg8.final-gate-armed', state.store.stateOf(missionGraphId).steps['S-05']?.status === 'awaiting-approval', 'the final-assembly gate armed (S-05 awaits the human) -- the lease leg composes with a pending approval');

			// (b) the exhaustion probe: the bound STOPS; the failure is terminal and recorded, never a silent success
			const probeSubmitted = await state.store.submitGraph({
				title: 'journey provider-failure exhaustion probe',
				steps: [{ stepId: 'S-01', title: 'always-failing provider call', instruction: 'the provider fails beyond the window bound' }],
				policy: { onStepFailure: 'fail-graph' },
				actor: 'agent',
				origin: 'journey:tl2-acc1',
			});
			await state.store.approveGraph({ graphId: probeSubmitted.graphId, actor: 'human', origin: 'journey:tl2-acc1' });
			const probeDrive = await driveGraph(state.store, { graphId: probeSubmitted.graphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:provider-probe', providerRetry: { maxAttempts: 3 }, wait: fakeWait, now: state.clock() });
			const probeRetryRows = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === probeSubmitted.graphId);
			const probeOutcomes = probeRetryRows.map(row => (row.payload as { outcome?: string }).outcome ?? '').join(',');
			const probeStep = probeDrive.started.find(record => record.stepId === 'S-01');
			recorder.check('leg8.exhaustion-bounded', probeStep !== undefined && probeStep.providerAttempts === 3 && probeStep.providerExhausted === true && probeRetryRows.length === 3 && probeOutcomes === 'retryable-failed,retryable-failed,exhausted', `the exhaustion window stopped at exactly the bound (${String(probeStep?.providerAttempts)} attempts against unbounded queued failures; outcomes ${probeOutcomes})`);
			const probeFailedRow = state.store.journalRows.find(row => row.type === 'step-failed' && row.graphId === probeSubmitted.graphId);
			recorder.check('leg8.exhaustion-terminal-recorded', probeFailedRow !== undefined && (probeFailedRow.payload as { retryPlanned?: boolean }).retryPlanned === false && state.store.journalRows.some(row => row.type === 'graph-failed' && row.graphId === probeSubmitted.graphId), `the exhausted step failed TERMINALLY (retryPlanned false) and the graph failed honestly (never a silent success)`);
			recorder.check('leg8.probe-no-silent-success', probeDrive.completed === false && probeFreshRuns === 3, `the probe never completed and the provider was called exactly ${String(probeFreshRuns)} times (the bound, not the queued failure count)`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 9 -- cancel: mid-flight stop + attribution
		// =====================================================================
		{
			const recorder = leg(9);
			// the cancellation probe: S-01 blocks mid-flight; S-02 is downstream work
			const probeSubmitted = await state.store.submitGraph({
				title: 'journey cancellation probe',
				steps: [
					{ stepId: 'S-01', title: 'blocking work', instruction: 'blocks mid-flight until the cancel lands' },
					{ stepId: 'S-02', title: 'downstream work', instruction: 'must never run after the cancel', dependsOn: ['S-01'] },
				],
				actor: 'agent',
				origin: 'journey:tl2-acc1',
			});
			cancelGraphId = probeSubmitted.graphId;
			cancelTaskId = probeSubmitted.taskId ?? '';
			await state.store.approveGraph({ graphId: cancelGraphId, actor: 'human', origin: 'journey:tl2-acc1' });

			const drivePromise = driveGraph(state.store, { graphId: cancelGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:cancel-probe', wait: fakeWait, now: state.clock() });
			await cancelRendezvous.started; // S-01 is mid-flight (the deterministic rendezvous)

			// the human cancel lands MID-FLIGHT
			const cancelOutcome = await state.store.cancelGraph({ graphId: cancelGraphId, actor: 'human', origin: 'journey:cancel', reason: 'the human cancelled the probe mid-flight' });
			cancelRendezvous.release();
			const cancelledDrive = await drivePromise;

			// the canceller's attribution: request + observation + mirrored task event
			const cancelRequestedRow = state.store.journalRows.find(row => row.type === 'cancel-requested' && row.graphId === cancelGraphId);
			recorder.check('leg9.cancel-attribution', cancelRequestedRow !== undefined && cancelRequestedRow.actor === 'human', `the mid-flight cancel is recorded with the canceller's attribution (actor ${String(cancelRequestedRow?.actor)})`);
			const cancelObservedRow = state.store.journalRows.find(row => row.type === 'cancel-observed' && row.graphId === cancelGraphId);
			recorder.check('leg9.cancel-observation-attributed', cancelObservedRow !== undefined && cancelObservedRow.actor === 'human' && (cancelObservedRow.payload as { reason?: string }).reason === 'in-flight-abort', `the in-flight abort observation carries the cancel's actor (${String(cancelObservedRow?.actor)}, reason ${String((cancelObservedRow?.payload as { reason?: string }).reason)})`);
			const cancelTask = await state.tasks.getTask(cancelTaskId);
			recorder.check('leg9.cancel-mirrored-to-task', cancelTask.events.some(event => event.type === 'graph-cancelled' && event.actor === 'human'), `the cancellation is mirrored onto the task timeline with human attribution (task ${cancelTaskId})`);

			// downstream stop: S-02 never started
			recorder.check('leg9.downstream-stopped', state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === cancelGraphId && row.stepId === 'S-02') === false && state.sink.callsForStep(cancelGraphId, 'S-02') === 0 && cancelOutcome.cancelledSteps.includes('S-02'), `downstream work never started after the cancel (cancelled steps: ${cancelOutcome.cancelledSteps.join(',')})`);

			// no fake success: the in-flight step's effect resolved ok but was NEVER completed
			recorder.check('leg9.no-fake-success', state.store.journalRows.some(row => row.type === 'step-succeeded' && row.graphId === cancelGraphId) === false && cancelledDrive.completed === false && cancelledDrive.cancelled === true && cancelledDrive.cancelObservation?.reason === 'in-flight-abort', `the cancelled step was never fake-completed (drive cancelled=${String(cancelledDrive.cancelled)}, observation ${String(cancelledDrive.cancelObservation?.reason)})`);

			// the cancel observation minted evidence into the SHARED chain (the provenance leg must still verify it)
			const cancelEvidenceId = (cancelObservedRow?.payload as { evidenceId?: string }).evidenceId;
			const cancelEvidenceRow = cancelEvidenceId === undefined ? undefined : await state.ledger.rowByEvidenceId(cancelEvidenceId);
			recorder.check('leg9.cancellation-evidence-minted', cancelEvidenceRow !== undefined && cancelEvidenceRow.taskId === cancelTaskId, `the cancellation observation minted evidence ${String(cancelEvidenceId)} into the shared chain (task ${cancelTaskId})`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 10 -- lease conflict: one winner, typed loser, both journaled
		// =====================================================================
		{
			const recorder = leg(10);
			const resource = stepResourceId(missionGraphId, 'S-05');
			const race = await Promise.allSettled([
				claimStepLease(state.store, state.bus, { graphId: missionGraphId, stepId: 'S-05', claimant: WORKER_2, ttlMs: 60_000, origin: `a2a:${WORKER_2}` }),
				claimStepLease(state.store, state.bus, { graphId: missionGraphId, stepId: 'S-05', claimant: WORKER_3, ttlMs: 60_000, origin: `a2a:${WORKER_3}` }),
			]);
			const acquiredRows = state.store.journalRows.filter(row => row.type === 'lease-acquired' && row.graphId === missionGraphId && row.stepId === 'S-05');
			const winner = race.find((result): result is PromiseFulfilledResult<ClaimStepLeaseResult> => result.status === 'fulfilled');
			const loser = race.find((result): result is PromiseRejectedResult => result.status === 'rejected');
			recorder.check('leg10.exactly-one-winner', race.filter(result => result.status === 'fulfilled').length === 1 && loser !== undefined && acquiredRows.length === 1, `exactly one claimant acquired the lease (${race.map(result => result.status).join(' + ')}; lease-acquired rows: ${String(acquiredRows.length)})`);

			const reason = loser?.reason;
			const facts = reason === undefined ? null : leaseConflictFacts(reason);
			// the runtime facts projection carries the conflict code (the .d.mts sibling's LeaseConflictFacts omits it)
			const conflictCode = (facts as { code?: string } | null)?.code ?? '';
			const winnerClaim = winner?.value;
			recorder.check('leg10.typed-conflict-for-loser', isLeaseConflictError(reason) && facts !== null && conflictCode === LEASE_CONFLICT_CODE && facts.violation === 'lease' && facts.holder === winnerClaim?.holder && facts.leaseId === winnerClaim?.leaseId && facts.deadline === winnerClaim?.deadline && facts.claimant !== winnerClaim?.holder, `the loser received the typed ${conflictCode} naming the holder (${String(facts?.holder)}), lease ${String(facts?.leaseId)}) and deadline ${String(facts?.deadline)})`);

			const conflicts = state.store.journalRows.filter(row => row.type === 'conflict-noticed' && row.graphId === missionGraphId && row.stepId === 'S-05');
			const conflictPayload = conflicts[0]?.payload as { violation?: string; expectedHolder?: string; actualRunner?: string; evidenceId?: string } | undefined;
			recorder.check('leg10.both-attempts-journaled', conflicts.length === 1 && conflictPayload?.violation === 'lease' && conflictPayload?.expectedHolder === winnerClaim?.holder && conflictPayload?.actualRunner !== winnerClaim?.holder && acquiredRows[0] !== undefined && (acquiredRows[0].payload as { holder?: string }).holder === winnerClaim?.holder, `the winner's acquisition and the loser's refusal are both journaled (conflict: expectedHolder ${String(conflictPayload?.expectedHolder)} actualRunner ${String(conflictPayload?.actualRunner)})`);

			// both attempts minted evidence into the shared chain
			const conflictEvidenceRow = conflictPayload?.evidenceId === undefined ? undefined : await state.ledger.rowByEvidenceId(conflictPayload.evidenceId);
			const acquiredEvidenceId = (acquiredRows[0]?.payload as { evidenceId?: string }).evidenceId;
			const acquiredEvidenceRow = acquiredEvidenceId === undefined ? undefined : await state.ledger.rowByEvidenceId(acquiredEvidenceId);
			recorder.check('leg10.evidence-linkage', conflictEvidenceRow !== undefined && acquiredEvidenceRow !== undefined && conflictEvidenceRow.uri === `flauz-orch-transition://${String(conflicts[0]?.rowId)}` && acquiredEvidenceRow.uri === `flauz-orch-transition://${String(acquiredRows[0]?.rowId)}` && conflictEvidenceRow.taskId === acquiredEvidenceRow.taskId, `both lease attempts minted evidence rows referencing their own journal rows (task ${String(acquiredEvidenceRow?.taskId)})`);

			// the bus surface: the winner's acquire notice is the journal-projected lease
			const active = state.bus.activeClaimOf(resource);
			const busMessages = await readBusMessages(root);
			const claimNotices = busMessages.filter(message => message.kind === 'resource-claim');
			recorder.check('leg10.bus-claim-path-enforces', active !== undefined && active.holder === winnerClaim?.holder && active.leaseId === winnerClaim?.noticeId && claimNotices.length === 1 && claimNotices[0]?.from === winnerClaim?.holder, `the winner's acquire notice is the journal-projected lease (holder ${String(active?.holder)}, notice ${String(active?.leaseId)}) and the bus carries exactly one claim notice`);

			// never a silent double-execution
			recorder.check('leg10.no-silent-double-execution', acquiredRows.length === 1 && conflicts.length === 1 && claimNotices.length === 1, `one lease-acquired row, one conflict-noticed row, one bus notice -- never a silent double-execution over ${resource}`);

			// the race composes with the pending approval: the lease landed while S-05 was awaiting-approval
			recorder.check('leg10.lease-composes-with-approval-gate', state.store.stateOf(missionGraphId).steps['S-05']?.status === 'awaiting-approval', 'the lease race landed while the final-assembly approval gate was still pending (S-05 awaiting-approval; the composed seam)');

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 11 -- restart: simulated process death mid-flight
		// =====================================================================
		let journalRowsAtDeath = 0;
		let ledgerRowsAtDeath = 0;
		{
			const recorder = leg(11);

			// the winner releases the lease (recorded) so the post-recovery drive is clean
			const leaseRow = state.store.journalRows.find(row => row.type === 'lease-acquired' && row.graphId === missionGraphId && row.stepId === 'S-05');
			const leaseId = (leaseRow?.payload as { leaseId?: string }).leaseId ?? '';
			const leaseResourceId = stepResourceId(missionGraphId, 'S-05');
			const released = await state.store.releaseLease({ graphId: missionGraphId, stepId: 'S-05', actor: 'agent', origin: 'journey:lease-release' });
			recorder.check('leg11.lease-released-before-death', released.type === 'lease-released' && (released.payload as { leaseId?: string }).leaseId === leaseId, `the race's lease ${leaseId} was released with attribution before the death`);

			// OBSERVED SEAM ODDITY (documented v0 posture; routed as a CANDIDATE FINDING, not a
			// leg failure): the graph-level release does NOT retract the a2a bus notice -- the
			// journal-projected claim outlives the release until the notice's leaseUntil horizon.
			// The check documents the observed divergence honestly (the store layer is free; the
			// bus layer still names the released holder).
			const storeLeaseAfterRelease = (state.store.stateOf(missionGraphId) as { leases?: Record<string, unknown> }).leases?.['S-05'];
			const busClaimAfterRelease = state.bus.activeClaimOf(leaseResourceId);
			recorder.check('leg11.bus-notice-outlives-release', storeLeaseAfterRelease === undefined && busClaimAfterRelease !== undefined && busClaimAfterRelease.holder === (leaseRow?.payload as { holder?: string }).holder, `OBSERVED (documented v0 posture, routed as a candidate finding): the store lease is released yet the bus notice still projects the claim (holder ${String(busClaimAfterRelease?.holder)} until ${String(busClaimAfterRelease?.deadline)} -- the two enforcement layers diverge until the notice horizon)`);

			// the human grants the final-assembly approval (the gate the lease composed with)
			const granted = await state.store.approvalDecide({ graphId: missionGraphId, stepId: 'S-05', decision: 'granted', actor: 'human', origin: 'journey:approval' });
			recorder.check('leg11.approval-granted', granted.type === 'approval-granted' && granted.actor === 'human' && state.store.stateOf(missionGraphId).steps['S-05']?.status === 'ready', `the human granted the final-assembly approval (row ${granted.rowId}); S-05 is ready`);

			// the final flight: the step STARTS and its effect SETTLES (durable in the sink log)...
			const start = await state.store.startStep({ graphId: missionGraphId, stepId: 'S-05', runnerId: PRIMARY, actor: 'agent', origin: 'journey:final-assembly' });
			const settled = await state.sink.run(start.idempotencyKey, {
				graphId: missionGraphId,
				stepId: 'S-05',
				attempt: start.attempt,
				tool: null,
				toolInput: null,
				instruction: 'assemble the journey artifacts (gated: the human approves the final assembly)',
			});
			recorder.check('leg11.final-flight-settled', settled.ok === true && state.sink.freshExecutionsInLog(start.idempotencyKey) === 1, `the final-assembly effect settled once on key ${start.idempotencyKey} (the crash window opens)`);
			recorder.check('leg11.crash-window-open', state.store.stateOf(missionGraphId).steps['S-05']?.status === 'running' && state.store.journalRows.some(row => row.type === 'step-started' && row.graphId === missionGraphId && row.stepId === 'S-05') === true && state.store.journalRows.some(row => row.type === 'step-succeeded' && row.graphId === missionGraphId && row.stepId === 'S-05') === false, 'the death lands between the settled effect and its journal append (running, started, never succeeded)');

			// the death: capture the on-disk facts, then DROP every instance (no cleanup, no deletes)
			journalRowsAtDeath = state.store.journalRows.length;
			ledgerRowsAtDeath = (await state.ledger.readRows()).length;
			const tasksAtDeath = await state.tasks.listTasks();
			recorder.check('leg11.state-on-disk-at-death', journalRowsAtDeath > 0 && ledgerRowsAtDeath > 0 && tasksAtDeath.length === 3, `the death froze ${String(journalRowsAtDeath)} journal rows, ${String(ledgerRowsAtDeath)} ledger rows and ${String(tasksAtDeath.length)} tasks on disk`);
			// THE DEATH: every instance above is abandoned here (the recovered store, ledger,
			// memory, bus, router and sink are rebuilt from disk in LEG 12 -- the state survives).

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 12 -- recovery/continuity: no silent state loss; work continues
		// =====================================================================
		{
			const recorder = leg(12);
			// cold boot: fresh instances on the SAME root (the recovery-matrix convention)
			state = await bootJourney(root, effects, fabric);

			const tasksRecovered = await state.tasks.listTasks();
			recorder.check('leg12.task-envelopes-recover', tasksRecovered.length === 3 && tasksRecovered.some(task => task.id === missionTaskId && task.events.some(event => event.type === 'graph-submitted' && event.actor === 'agent')), `all 3 task envelopes recovered (mission ${missionTaskId} carries its mirrored events)`);
			const ledgerVerify = await state.ledger.verify();
			const ledgerRowsRecovered = await state.ledger.readRows();
			recorder.check('leg12.ledger-recovers-no-loss', ledgerVerify.ok && ledgerRowsRecovered.length === ledgerRowsAtDeath, `the ledger chain recovered with NO silent state loss (verify ok, ${String(ledgerRowsRecovered.length)} rows === ${String(ledgerRowsAtDeath)} at death)`);
			recorder.check('leg12.journal-recovers-no-loss', state.store.journalRows.length === journalRowsAtDeath && state.store.verifyJournal().ok && state.store.tornTail === null, `the orchestration journal recovered exactly (${String(state.store.journalRows.length)} rows, chain verifies, no torn tail)`);
			const providerRetryRowsRecovered = state.store.journalRows.filter(row => row.type === 'provider-retry' && row.graphId === missionGraphId && row.stepId === 'S-04');
			recorder.check('leg12.provider-retry-state-survives', providerRetryRowsRecovered.length === 3, `the provider-retry state created in LEG 8 survived the restart (${String(providerRetryRowsRecovered.length)} attempt rows) -- the seam held`);

			const memoryVerdict = await state.memory.verify();
			const sessionRecords = await state.memory.list('session');
			recorder.check('leg12.memory-recovers', memoryVerdict.ok && sessionRecords.length === 2 && sessionRecords.some(record => record.taskId === missionTaskId && record.agentId === PRIMARY), `tiered memory recovered and verifies (${String(memoryVerdict.records)} records; the session records persist)`);

			const workerMailbox = state.bus.collect({ agentId: WORKER_1 }).messages;
			const busJournalRecovered = await readBusMessages(root);
			recorder.check('leg12.a2a-journal-recovers', workerMailbox.length === 1 && workerMailbox.some(message => message.kind === 'task-delegation') && busJournalRecovered.length === 3, `the A2A bus journal recovered (the worker mailbox replays the delegation; ${String(busJournalRecovered.length)} messages on disk)`);

			const fragments = await state.workflows.list();
			recorder.check('leg12.workflow-fragment-recovers', fragments.length === 1 && fragments[0]?.source.taskId === missionTaskId, `the workflow fragment recovered (${String(fragments[0]?.id)})`);
			const decisionsRecovered = await state.listDecisions(state.fs, `${root}/.flauz/models`);
			recorder.check('leg12.routing-state-recovers', decisionsRecovered.length === 1 && decisionsRecovered[0]?.decisionId === 'rd-000001', `the model routing state recovered (decision ${String(decisionsRecovered[0]?.decisionId)})`);

			// the cancellation evidence written mid-flight still resolves (the LEG 13 seam)
			const cancelObservedOnDisk = (await readJournalOnDisk(root)).find(row => row.type === 'cancel-observed');
			const cancelEvidenceId = (cancelObservedOnDisk?.payload as { evidenceId?: string }).evidenceId;
			const cancelRow = cancelEvidenceId === undefined ? undefined : await state.ledger.rowByEvidenceId(cancelEvidenceId);
			recorder.check('leg12.cancellation-evidence-survives', cancelRow !== undefined, `the cancellation evidence ${String(cancelEvidenceId)} still resolves after the restart`);

			// the recovery pass: the interrupted step is marked, never fabricated
			const recovery = await recoveryScan(state.store, { record: true, now: state.clock(), actor: 'service', origin: 'journey:recovery' });
			const g001Report = recovery.graphs.find(report => report.graphId === missionGraphId);
			recorder.check('leg12.recovery-marks-interrupted', recovery.clean === false && g001Report !== undefined && g001Report.actions.includes('step-interrupted:S-05') && state.store.stateOf(missionGraphId).steps['S-05']?.status === 'ready', `the recovery pass marked the interrupted final step (${String(g001Report?.actions.join(','))}); S-05 is ready again`);
			recorder.check('leg12.recovery-never-fabricates', state.store.journalRows.some(row => row.type === 'step-succeeded' && row.graphId === missionGraphId && row.stepId === 'S-05') === false && state.store.journalRows.some(row => row.type === 'graph-completed' && row.graphId === missionGraphId) === false, 'the recovery pass completed nothing on its own (no fabricated completion)');

			// WORK CONTINUES: the re-drive replays the settled effect on the SAME idempotency key
			const continuation = await driveGraph(state.store, { graphId: missionGraphId, sink: state.sink, runnerId: PRIMARY, actor: 'agent', origin: 'journey:continuation', wait: fakeWait, now: state.clock() });
			const s05 = continuation.started.find(record => record.stepId === 'S-05');
			const s05Key = `flauz-orch/${missionGraphId}/S-05/run/1`;
			recorder.check('leg12.work-continues-replays', s05 !== undefined && s05.replayed === true && state.sink.freshExecutionsInLog(s05Key) === 1 && state.sink.replaysOf(s05Key) === 1, `the interrupted step re-drove on the SAME key ${s05Key}: the settled effect REPLAYED (1 fresh + 1 replay -- never executed twice)`);
			recorder.check('leg12.mission-completes', continuation.completed === true && state.store.stateOf(missionGraphId).graphStatus === 'completed' && state.store.journalRows.some(row => row.type === 'graph-completed' && row.graphId === missionGraphId), `the mission graph completed after the restart (drive completed=${String(continuation.completed)})`);
			recorder.check('leg12.takeover-step-survives-restart', state.store.stateOf(missionGraphId).steps['S-03']?.status === 'succeeded' && state.store.stateOf(missionGraphId).steps['S-03']?.takeover?.state === 'completed', 'the taken-over step survived the restart with its takeover state intact');

			// the session closes: the claim is released with attribution
			const claimReleased = await state.store.releaseClaim({ graphId: missionGraphId, stepId: 'S-01', actor: 'agent', origin: 'journey:session-close' });
			recorder.check('leg12.session-claim-released', claimReleased.type === 'claim-released' && (claimReleased.payload as { holder?: string }).holder === PRIMARY && (state.store.stateOf(missionGraphId) as { claims?: Record<string, unknown> }).claims?.['S-01'] === undefined, `the session claim was released with attribution (${String((claimReleased.payload as { holder?: string }).holder)})`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// LEG 13 -- provenance inspection: walk the chain end to end
		// =====================================================================
		{
			const recorder = leg(13);

			// (a) the ledger chain: every row verifies, seqs contiguous; the post-death
			// continuation minted exactly the two new rows (S-05's effect + the claim release)
			const finalVerify = await state.ledger.verify();
			const finalRows = await state.ledger.readRows();
			recorder.check('leg13.chain-verifies-end-to-end', finalVerify.ok && finalRows.length === ledgerRowsAtDeath + 2 && finalRows.every((row, index) => row.seq === index + 1), `the final chain verifies: ${String(finalRows.length)} rows (${String(ledgerRowsAtDeath)} pre-death + 2 continuation rows), seqs contiguous 1..${String(finalRows.length)}`);

			// (b) the orchestration journal chain verifies
			recorder.check('leg13.journal-verifies', state.store.verifyJournal().ok, `the orchestration journal hash chain verifies (${String(state.store.journalRows.length)} rows)`);

			// (c) memory + routing provenance
			recorder.check('leg13.memory-verifies', (await state.memory.verify()).ok, 'the tiered memory substrate verifies');
			recorder.check('leg13.routing-provenance', (await state.listDecisions(state.fs, `${root}/.flauz/models`)).length === 1, 'the routing decision ledger is intact');

			// (d) every minted journal evidence id resolves into the ledger (the rowId-evidence linkage)
			const journalOnDisk = await readJournalOnDisk(root);
			const evidenceBearing = journalOnDisk.filter(row => typeof (row.payload as { evidenceId?: unknown }).evidenceId === 'string');
			const resolvedIds: string[] = [];
			for (const row of evidenceBearing) {
				const evidenceId = (row.payload as { evidenceId?: string }).evidenceId ?? '';
				const resolved = await state.ledger.rowByEvidenceId(evidenceId);
				if (resolved !== undefined) {
					resolvedIds.push(evidenceId);
				}
			}
			recorder.check('leg13.journal-evidence-linkage', evidenceBearing.length >= 10 && resolvedIds.length === evidenceBearing.length, `every one of the ${String(evidenceBearing.length)} evidence-bearing journal rows resolves into the ledger`);

			// (e) attribution is intact for every actor
			const primaryStarts = journalOnDisk.filter(row => row.type === 'step-started' && (row.payload as { runnerId?: string }).runnerId === PRIMARY);
			recorder.check('leg13.primary-agent-attribution', primaryStarts.length >= 3 && journalOnDisk.some(row => row.type === 'claim-acquired' && (row.payload as { holder?: string }).holder === PRIMARY) && journalOnDisk.some(row => row.type === 'claim-released' && (row.payload as { holder?: string }).holder === PRIMARY), `the primary agent's attribution is intact (${String(primaryStarts.length)} started steps + the session claim round-trip)`);
			const delegationDecision = journalOnDisk.find(row => row.type === 'route-decided' && (row.payload as { targetAgent?: string }).targetAgent === WORKER_1);
			const resultReceived = journalOnDisk.find(row => row.type === 'result-received' && row.origin === `a2a:${WORKER_1}`);
			const busMessagesFinal = await readBusMessages(root);
			recorder.check('leg13.delegate-attribution', delegationDecision !== undefined && resultReceived !== undefined && busMessagesFinal.some(message => message.kind === 'task-delegation' && message.from === PRIMARY && message.to === WORKER_1) && busMessagesFinal.some(message => message.kind === 'result-report' && message.from === WORKER_1), `the delegate's attribution is intact (decision row + result-received origin + the typed bus round-trip)`);
			const workerRow = await state.ledger.rowByEvidenceId(workerEvidenceId);
			recorder.check('leg13.delegate-evidence-attributed', workerRow !== undefined && workerRow.taskId === missionTaskId, `the delegate's evidence ${workerEvidenceId} still resolves to ${missionTaskId}`);
			const takeoverRows = journalOnDisk.filter(row => row.type.startsWith('takeover-'));
			recorder.check('leg13.takeover-attribution', takeoverRows.length === 3 && takeoverRows.every(row => row.actor === 'human'), `the takeover's three rows all carry the human attribution (${takeoverRows.map(row => row.type).join(',')})`);
			const cancelRequested = journalOnDisk.find(row => row.type === 'cancel-requested' && row.graphId === cancelGraphId);
			const cancelObserved = journalOnDisk.find(row => row.type === 'cancel-observed' && row.graphId === cancelGraphId);
			const cancelTask = await state.tasks.getTask(cancelTaskId);
			recorder.check('leg13.canceller-attribution', cancelRequested?.actor === 'human' && cancelObserved?.actor === 'human' && cancelTask.events.some(event => event.type === 'graph-cancelled' && event.actor === 'human'), `the canceller's attribution is intact (request + observation + the mirrored task event, all actor human)`);
			const approvalGranted = journalOnDisk.find(row => row.type === 'approval-granted' && row.graphId === missionGraphId);
			recorder.check('leg13.approver-attribution', journalOnDisk.some(row => row.type === 'graph-approved' && row.actor === 'human') && approvalGranted?.actor === 'human', 'the human approver attribution is intact (graph approval + the final gate grant)');

			// (f) the task<->ledger linkage: every mission ledger row has its evidence event on the task timeline
			const missionRows = finalRows.filter(row => row.taskId === missionTaskId);
			const finalMissionTask = await state.tasks.getTask(missionTaskId);
			const evidenceEvents = finalMissionTask.events.filter(event => event.type === 'evidence');
			recorder.check('leg13.task-ledger-linkage', missionRows.length === evidenceEvents.length && missionRows.length >= 12, `every one of the ${String(missionRows.length)} mission ledger rows has its evidence event on the task timeline (no orphan evidence, no silent drops)`);

			// (g) the resources the journey produced are still on disk and hash-pinned
			const briefOnDisk = await state.fs.readFileUtf8(`${root}/${briefResourceUri}`);
			const changesetRow = finalRows.find(row => row.uri === briefResourceUri);
			recorder.check('leg13.resource-provenance', briefOnDisk !== undefined && changesetRow !== undefined && changesetRow.sha256 === sha256Hex(briefOnDisk), `the workspace resource is still on disk and its ledger row hash-pins it (${briefResourceUri})`);

			legVerdicts.push(recorder.buildVerdict());
		}

		// =====================================================================
		// The journey verdict: every leg green, the evidence document emitted
		// =====================================================================
		assert.equal(legVerdicts.length, LEGS.length, `the journey recorded exactly ${String(LEGS.length)} legs (got ${String(legVerdicts.length)})`);
		const failing = legVerdicts.filter(verdict => verdict.verdict === 'FAIL');
		for (const verdict of failing) {
			console.log(`agentos journey: LEG ${String(verdict.leg).padStart(2, '0')} ${verdict.name} FAIL -- ${verdict.firstFailing ?? 'no detail'}`);
		}
		assert.deepEqual(failing.map(verdict => verdict.leg), [], `every journey leg must be green (failing legs: ${JSON.stringify(failing)})`);

		const document = {
			schema: JOURNEY_SCHEMA,
			wo: WO_ID,
			rung: 'fixture' as const,
			legs: legVerdicts,
			summary: {
				pass: legVerdicts.filter(verdict => verdict.verdict === 'PASS').length,
				fail: legVerdicts.filter(verdict => verdict.verdict === 'FAIL').length,
			},
		};
		const evidencePath = process.env.FLAUZ_AGENTOS_JOURNEY_EVIDENCE ?? nodePath.join(os.tmpdir(), 'flauz-agentos-journey-evidence.json');
		await nodeFs.mkdir(nodePath.dirname(evidencePath), { recursive: true });
		await nodeFs.writeFile(evidencePath, `${JSON.stringify(document, null, '\t')}\n`, { encoding: 'utf-8' });

		for (const verdict of legVerdicts) {
			console.log(`agentos journey: LEG ${String(verdict.leg).padStart(2, '0')} ${verdict.name} ${verdict.verdict} (${String(verdict.assertions.pass)} assertions, evidence ${verdict.evidenceLevel})`);
		}
		console.log(`agentos journey: GREEN -- ${String(document.summary.pass)}/${String(LEGS.length)} legs PASS -- ${evidencePath}`);
	} finally {
		await nodeFs.rm(root, { recursive: true, force: true });
	}
});
