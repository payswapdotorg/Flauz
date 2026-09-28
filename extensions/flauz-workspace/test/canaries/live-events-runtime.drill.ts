/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL4-H2 -- the live file-events + reveal-navigation RUNTIME drill (the
 * promoted TL4-002 follow-ups; spec:
 * docs/FLAUZ-PROGRAM/TL4-PREMIUM-UX.md section 14).
 *
 * Drives the REAL flauz-workspace modules over REAL on-disk state and REAL
 * OS file events, below the workbench boundary (the
 * session-battery-runtime.drill.ts precedent):
 *
 *   - REAL temp workspace root on disk (node mkdtemp);
 *   - the REAL TaskService + EvidenceLedger + the real node FileSystemPort
 *     (the same fs port shape extension.ts injects);
 *   - the REAL views module (HomeTreeProvider + TasksTreeProvider +
 *     registerWorkspaceViews: the reveal command set, getParent chain,
 *     last-known-good recovery);
 *   - the REAL live-events wiring (registerLiveEvents: the production
 *     debounce interval, the .flauz/** watcher surface);
 *   - a REAL watcher harness: the vscode shim's createFileSystemWatcher
 *     backed by Node fs.watch (REAL OS events, not synthetic callbacks).
 *     The shim translates the API surface onto real watching: 'change'
 *     stays change; fs.watch's 'rename' is classified create/delete by
 *     target existence; events are scoped by the .flauz/** pattern exactly
 *     as the real workbench scopes them.
 *
 * The journey:
 *   1. builds real .flauz state (task envelopes + evidence rows written
 *      through the REAL TaskService/EvidenceLedger) and asserts the
 *      initial tree census (rows + ages) over the real disk state;
 *   2. mutates the state ON DISK through a SECOND real service handle
 *      (task status transition + a new evidence row) and asserts the
 *      watcher fires -> the debounce coalesces (the coalescing law model
 *      predicts the refresh count from the observed event times) -> the
 *      tree re-renders the new OBSERVED state within a bounded wait;
 *   3. breaks the state file on disk (invalid JSON) and asserts the
 *      last-known-good + unified-error-row behavior survives a REAL
 *      re-read failure; restoring the envelope proves the recovery loop;
 *   4. reveal-runtime: drives flauz.workspace.revealTask over the REAL
 *      provider (fresh-read task resolution + getParent chain + the
 *      reveal call landing on the RIGHT row with focus restoration, per
 *      premium spec section 5) through the shim's TreeView.reveal
 *      recording surface (the session-battery recording-transport
 *      pattern).
 *
 * HONESTY LAW (the workbench seam, stated exactly like the
 * session-battery residue): everything below the workbench boundary is
 * REAL -- real disk state, real OS events, the real providers, the real
 * command handlers, the real debounce timer. The WORKBENCH TreeView
 * rendering itself (pixels, keyboard focus, the extHost reveal->main
 * thread round trip) is shimmed: reveal calls are RECORDED, the tree
 * re-render is observed by pulling getChildren exactly as the workbench
 * does when onDidChangeTreeData fires. Those two assertions remain
 * fixture-rung-only (the booted-workbench seam is future work; see
 * docs/FLAUZ-PROGRAM/TL4-SESSION-BATTERY.md section 4).
 *
 * MODES:
 *   (no flags)   the full runtime journey (node --experimental-strip-types
 *                --test <this file>; plain execution works too).
 *   --selftest   zero-dep machinery self-test (pattern matcher both
 *                directions, rename classification both directions, the
 *                trailing-edge coalescing law both directions). No fs, no
 *                temp dirs, no watcher.
 *
 * SKIP semantics (never fail a gate for lacking real fs events):
 *   - FLAUZ_LIVE_EVENTS_RUNTIME_SKIP=1  -> SKIP (forced)
 *   - the fs.watch backend fails to attach (exotic sandbox) -> the live
 *     phases report SKIP with the exact reason; exit 0. The CI lane
 *     asserts the GREEN line, so a CI without real fs events fails
 *     loudly (the honest posture: CI must have real events).
 *
 * Exit codes: 0 = drill green (or SKIP) or selftest green;
 * 1 = any assertion failed (the failing row is named on stderr);
 * 2 = usage error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { installMockVscode, matchesWatchPattern, classifyRenameEvent, type MockFileSystemWatcher, type MockVscode } from '../shims.ts';
import { sha256Hex, type FileSystemPort, type LedgerRow, type Task } from '../../src/api.ts';
import { TaskService } from '../../src/taskService.ts';
import { EvidenceLedger } from '../../src/ledger.ts';
import { CheckpointInterop } from '../../src/checkpoint.ts';
import { FlauzArtifactProvider } from '../../src/scmArtifactProvider.ts';
import { registerWorkspaceViews, TasksTreeProvider, TASKS_VIEW_ID, type TasksTreeElement, type WorkspaceViewContext } from '../../src/views.ts';
import { registerLiveEvents, LIVE_EVENTS_DEBOUNCE_MS, LIVE_EVENTS_WATCH_PATTERN, type LiveEventsWiring } from '../../src/liveEvents.ts';

const PREFIX = 'live-events runtime drill:';
const GREEN_LINE = `${PREFIX} GREEN (real fs events + reveal chain over real on-disk state)`;
const SKIP_PREFIX = `${PREFIX} SKIP`;
const FORCE_SKIP = process.env['FLAUZ_LIVE_EVENTS_RUNTIME_SKIP'] === '1';

/** The production debounce window (300ms, premium spec section 8) -- the drill runs the REAL interval. */
const DEBOUNCE_MS = LIVE_EVENTS_DEBOUNCE_MS;
/** Bounded waits: the drill must converge well inside these. */
const CONVERGENCE_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 25;
/** Settle window for straggler events (two debounce windows). */
const SETTLE_MS = DEBOUNCE_MS * 2;

const FIXED_TS = 1_730_000_000_000;
const FIXED_CLOCK = (): number => FIXED_TS;
const HEX64 = 'a'.repeat(64);

let assertions = 0;
let failures = 0;

function drillAssert(condition: boolean, label: string, detail: string): void {
	assertions += 1;
	if (condition) {
		console.log(`${PREFIX} PASS ${label}`);
	} else {
		failures += 1;
		console.error(`${PREFIX} FAIL ${label} -- ${detail}`);
	}
}

function info(message: string): void {
	console.log(`${PREFIX} NOTE ${message}`);
}

function census(line: string): void {
	console.log(`${PREFIX} CENSUS ${line}`);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// The coalescing law, as a pure model (selftested both directions; the live
// phases verify the REAL wiring against it: refreshes observed === groups
// predicted from the observed event times)
// ---------------------------------------------------------------------------

/**
 * Trailing-edge debounce law: each event (re)arms one timer that fires
 * `debounceMs` after the LAST event of its burst. Two events belong to the
 * same burst iff they arrive within the window of each other. Returns the
 * number of refreshes the wiring must deliver for the given event timeline.
 */
export function coalescedRefreshCount(eventTimesMs: readonly number[], debounceMs: number): number {
	if (eventTimesMs.length === 0) {
		return 0;
	}
	let refreshes = 1;
	for (let i = 1; i < eventTimesMs.length; i += 1) {
		if (eventTimesMs[i]! - eventTimesMs[i - 1]! > debounceMs) {
			refreshes += 1;
		}
	}
	return refreshes;
}

// ---------------------------------------------------------------------------
// --selftest: the zero-dep machinery cases (wired into verify-fixtures.sh)
// ---------------------------------------------------------------------------

function runSelftest(): void {
	console.log(`${PREFIX} --- selftest (zero-dep machinery) ---`);
	// pattern matcher, accept direction: the wiring's glob subset
	drillAssert(matchesWatchPattern('.flauz/**', '.flauz/tasks.json'), 'selftest: matcher accepts a state file directly under .flauz/', '.flauz/** vs .flauz/tasks.json');
	drillAssert(matchesWatchPattern('.flauz/**', '.flauz/evidence/ledger.jsonl'), 'selftest: matcher accepts nested state files', '.flauz/** vs .flauz/evidence/ledger.jsonl');
	drillAssert(matchesWatchPattern('.flauz/**', '.flauz'), 'selftest: matcher accepts the .flauz directory itself (its creation is an event)', '.flauz/** vs .flauz');
	drillAssert(matchesWatchPattern('**', 'any/thing/at/all.json'), 'selftest: the catch-all ** accepts every path', '** vs any/thing/at/all.json');
	// pattern matcher, reject direction (the doctored cases that MUST fail)
	drillAssert(!matchesWatchPattern('.flauz/**', 'tasks.json'), 'selftest: matcher rejects workspace-root files outside .flauz/', '.flauz/** vs tasks.json');
	drillAssert(!matchesWatchPattern('.flauz/**', 'other/.flauz/tasks.json'), 'selftest: matcher rejects .flauz paths nested under other directories', '.flauz/** vs other/.flauz/tasks.json');
	drillAssert(!matchesWatchPattern('.flauz/**', '.flauz-tasks.json'), 'selftest: matcher rejects prefix-lookalike names', '.flauz/** vs .flauz-tasks.json');
	// rename classification, both directions
	drillAssert(classifyRenameEvent(true) === 'create', 'selftest: fs.watch rename with existing target classifies create', 'exists=true');
	drillAssert(classifyRenameEvent(false) === 'delete', 'selftest: fs.watch rename with vanished target classifies delete', 'exists=false');
	// the coalescing law, coalesce direction: one burst -> one refresh
	drillAssert(coalescedRefreshCount([0, 5, 12], DEBOUNCE_MS) === 1, 'selftest: a 3-event burst inside the window coalesces to ONE refresh', `times [0,5,12] window ${DEBOUNCE_MS}`);
	drillAssert(coalescedRefreshCount([0, 299], DEBOUNCE_MS) === 1, 'selftest: an event re-arming just before the timer fires still coalesces', 'times [0,299]');
	drillAssert(coalescedRefreshCount([], DEBOUNCE_MS) === 0, 'selftest: no events -> no refresh', 'times []');
	// the coalescing law, separate-burst direction (the doctored case)
	drillAssert(coalescedRefreshCount([0, 400], DEBOUNCE_MS) === 2, 'selftest: bursts separated beyond the window each refresh', `times [0,400] window ${DEBOUNCE_MS}`);
	drillAssert(coalescedRefreshCount([0, 5, 700, 705, 710], DEBOUNCE_MS) === 2, 'selftest: two bursts of three events each -> exactly two refreshes', 'times [0,5,700,705,710]');
	if (failures > 0) {
		console.error(`${PREFIX} SELFTEST FAILED (${failures} assertion(s))`);
		process.exit(1);
	}
	console.log(`${PREFIX} ${assertions} assertions, 0 failures`);
	console.log(`${PREFIX} SELFTEST GREEN (pattern + classification + coalescing machinery, zero-dep)`);
}

// ---------------------------------------------------------------------------
// The runtime journey harness
// ---------------------------------------------------------------------------

/** The real node FileSystemPort (the exact shape extension.ts injects). */
function nodeFsPort(): FileSystemPort {
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
	};
}

interface DrillStack {
	readonly root: string;
	readonly mock: MockVscode;
	readonly watcher: MockFileSystemWatcher;
	readonly live: LiveEventsWiring;
	readonly refreshes: () => number;
	readonly resetRefreshes: () => void;
	readonly eventTimes: () => number[];
	readonly resetEventTimes: () => void;
	tasksProvider(): TasksTreeProvider;
	revealCalls(): Array<{ element: unknown; options?: { select?: boolean; focus?: boolean; expand?: boolean | number } }>;
	disposeAll(): void;
}

async function bootStack(): Promise<DrillStack> {
	const root = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'flauz-live-drill-'));
	const fsPort = nodeFsPort();
	// REAL services over the REAL fs port (the activation wiring shape).
	const tasks = new TaskService({ root, fs: fsPort, clock: FIXED_CLOCK });
	const ledger = new EvidenceLedger({ root, fs: fsPort, clock: FIXED_CLOCK });
	await tasks.bootstrap();
	await ledger.ensure();
	// The REAL vscode shim with the REAL fs-events backend.
	const mock = installMockVscode({ realFileEvents: true });
	const services = {
		tasks,
		ledger,
		checkpoints: new CheckpointInterop(tasks, ledger, FIXED_CLOCK),
		artifacts: new FlauzArtifactProvider(() => ledger.readRows()),
	};
	const viewContext: WorkspaceViewContext = {
		getServices: () => services,
		getWorkspaceRoot: () => root,
		readFile: async relativePath => fsPort.readFileUtf8(path.join(root, relativePath)),
		clock: FIXED_CLOCK,
	};
	const views = registerWorkspaceViews(viewContext);
	let refreshCount = 0;
	const times: number[] = [];
	const live = registerLiveEvents({
		getWorkspaceRoot: () => root,
		refresh: () => {
			refreshCount += 1;
			views.refresh();
		},
	});
	assert.equal(live.watching, true, 'the wiring created a watcher (workspace root present)');
	assert.equal(mock.workspace.fileSystemWatchers.length, 1);
	const watcher = mock.workspace.fileSystemWatchers[0]!;
	// The drill's own observation subscriptions: REAL event timestamps (the
	// coalescing-model input) recorded from the REAL watcher.
	watcher.onDidChange(() => times.push(Date.now()));
	watcher.onDidCreate(() => times.push(Date.now()));
	watcher.onDidDelete(() => times.push(Date.now()));
	return {
		root,
		mock,
		watcher,
		live,
		refreshes: () => refreshCount,
		resetRefreshes: () => { refreshCount = 0; },
		eventTimes: () => [...times],
		resetEventTimes: () => { times.length = 0; },
		tasksProvider: () => {
			const registration = mock.window.treeViews.find(entry => entry.viewId === TASKS_VIEW_ID);
			assert.ok(registration, 'flauz.tasks view registered');
			return registration.provider as unknown as TasksTreeProvider;
		},
		revealCalls: () => mock.window.treeViewHandles[TASKS_VIEW_ID]!.revealCalls as Array<{ element: unknown; options?: { select?: boolean; focus?: boolean; expand?: boolean | number } }>,
		disposeAll: () => {
			for (const disposable of live.disposables) {
				disposable.dispose();
			}
		},
	};
}

/** Shape view of a rendered root (task rows keep their Task for assertions). */
function taskRowsOf(elements: readonly TasksTreeElement[]): Array<{ kind: string; task?: Task }> {
	return elements.map(element => ({ kind: element.kind, task: element.kind === 'task' ? element.task : undefined }));
}

/** Polls getChildren (exactly what the workbench does when the change event fires) until the predicate holds. */
async function pollRender(provider: TasksTreeProvider, predicate: (elements: readonly TasksTreeElement[]) => boolean | Promise<boolean>): Promise<boolean> {
	const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (await predicate(await provider.getChildren())) {
			return true;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	return await predicate(await provider.getChildren());
}

// ---------------------------------------------------------------------------
// The runtime journey
// ---------------------------------------------------------------------------

async function runJourney(): Promise<void> {
	const stack = await bootStack();
	const tasksJson = path.join(stack.root, '.flauz', 'tasks.json');
	try {
		// ---- the real-fs backend gate (honest SKIP on exotic sandboxes) ----
		if (stack.watcher.backend !== 'real-fs') {
			console.log(`${SKIP_PREFIX} (real fs events unavailable: fs.watch did not attach${stack.watcher.lastError !== undefined ? ` -- ${stack.watcher.lastError}` : ''})`);
			return;
		}
		info(`real fs.watch backend attached over ${stack.root} (pattern ${LIVE_EVENTS_WATCH_PATTERN}, debounce ${DEBOUNCE_MS}ms)`);

		// ---- 1. build real .flauz state through the REAL services ----
		const first = new TaskService({ root: stack.root, fs: nodeFsPort(), clock: FIXED_CLOCK });
		const firstLedger = new EvidenceLedger({ root: stack.root, fs: nodeFsPort(), clock: FIXED_CLOCK });
		await first.createTask('Reveal runtime slice');
		await first.createTask('Second slice');
		await firstLedger.append('T-001', { kind: 'note', uri: 'file:///w/reveal.ts', sha256: HEX64 });
		// Let the setup writes' own debounced refresh land + zero the baselines.
		await sleep(SETTLE_MS);
		stack.resetRefreshes();
		stack.resetEventTimes();

		// ---- 2. the initial tree census over the real disk state ----
		const provider = stack.tasksProvider();
		const initial = await provider.getChildren();
		drillAssert(initial.length === 2, 'the initial tree renders BOTH real task rows', `${initial.length} root rows`);
		const initialRows = taskRowsOf(initial);
		drillAssert(initialRows[0]?.task?.id === 'T-001' && initialRows[1]?.task?.id === 'T-002', 'the rows render in envelope order (T-001, T-002)', JSON.stringify(initialRows.map(r => r.task?.id)));
		const initialItem = provider.getTreeItem(initial[0]!);
		drillAssert(initialItem.description === 'T-001 · plan · updated just now', 'the task row description carries the OBSERVED disk state (id · status · age)', String(initialItem.description));
		drillAssert(initialItem.tooltip?.includes('Updated: 2024-10-27 03:33 UTC (1730000000000)') === true, 'the tooltip carries the absolute UTC stamp via the format.ts protocol (PU6)', String(initialItem.tooltip));
		const initialEvidence = await provider.getChildren(initial[0]!);
		drillAssert(initialEvidence.length === 1 && initialEvidence[0]?.kind === 'evidence', 'the task row has its REAL evidence child from the on-disk ledger', `${initialEvidence.length} children`);
		census(`initial-rows: 2 tasks (T-001 Reveal runtime slice, T-002 Second slice), statuses plan/plan, T-001 evidence children: 1 (E-000001), refreshes-so-far: ${stack.refreshes()}`);

		// ---- 3. live task mutation from a SECOND handle -> watcher -> debounce -> re-render ----
		const second = new TaskService({ root: stack.root, fs: nodeFsPort(), clock: FIXED_CLOCK });
		await second.appendEvent('T-001', { ts: FIXED_TS, actor: 'agent', type: 'submit-plan', payload: {} });
		let renderedStatus = 'plan';
		const converged = await pollRender(provider, elements => {
			renderedStatus = taskRowsOf(elements).find(row => row.task?.id === 'T-001')?.task?.status ?? 'plan';
			return renderedStatus === 'awaiting-approval';
		});
		await sleep(SETTLE_MS); // catch stragglers before the exact-count assertions
		const predictedFromModel = coalescedRefreshCount(stack.eventTimes(), DEBOUNCE_MS);
		drillAssert(converged, 'the watcher fired -> the tree re-rendered the NEW OBSERVED status (T-001 -> awaiting-approval) within the bounded wait', `last observed status: ${renderedStatus}`);
		drillAssert(stack.refreshes() === predictedFromModel, `the REAL wiring matches the coalescing law (${stack.eventTimes().length} events -> ${predictedFromModel} refresh(es))`, `refreshes=${stack.refreshes()} predicted=${predictedFromModel}`);
		drillAssert(stack.watcher.eventCount >= 2, 'the atomic save delivered MULTIPLE real OS events (the coalescing input)', `eventCount=${stack.watcher.eventCount}`);
		drillAssert(stack.refreshes() < stack.watcher.eventCount, 'the debounce coalesced: fewer refreshes than events', `refreshes=${stack.refreshes()} events=${stack.watcher.eventCount}`);
		const transitionedItem = provider.getTreeItem((await provider.getChildren())[0]!);
		drillAssert(transitionedItem.description === 'T-001 · awaiting-approval · updated just now', 'the re-rendered row carries the transitioned status', String(transitionedItem.description));
		census(`live-mutation: ${stack.eventTimes().length} real events in the burst -> ${stack.refreshes()} refresh(es) (model predicted ${predictedFromModel}), observed status awaiting-approval`);

		// ---- 4. live evidence append from a SECOND ledger handle ----
		stack.resetRefreshes();
		stack.resetEventTimes();
		const secondLedger = new EvidenceLedger({ root: stack.root, fs: nodeFsPort(), clock: FIXED_CLOCK });
		await secondLedger.append('T-001', { kind: 'note', uri: 'file:///w/second.ts', sha256: sha256Hex('second') });
		const evidenceConverged = await pollRender(provider, async elements => {
			const taskRow = elements.find(element => element.kind === 'task' && element.task.id === 'T-001');
			const children = await provider.getChildren(taskRow!);
			return children.filter(child => child.kind === 'evidence').length === 2;
		});
		await sleep(SETTLE_MS);
		const predictedEvidence = coalescedRefreshCount(stack.eventTimes(), DEBOUNCE_MS);
		drillAssert(evidenceConverged, 'the evidence append surfaced live: T-001 now renders TWO evidence children within the bounded wait', 'children did not reach 2');
		drillAssert(stack.refreshes() === predictedEvidence && predictedEvidence >= 1, `the ledger burst coalesced per the law (${stack.eventTimes().length} events -> ${predictedEvidence} refresh(es))`, `refreshes=${stack.refreshes()} predicted=${predictedEvidence}`);
		const evidenceRows = (await provider.getChildren((await provider.getChildren()).find(element => element.kind === 'task' && element.task.id === 'T-001')!)) as ReadonlyArray<{ kind: string; row?: LedgerRow }>;
		drillAssert(evidenceRows.filter(row => row.kind === 'evidence' && row.row?.taskId === 'T-001').length === 2, 'both evidence rows belong to T-001 (the ledger filter held)', JSON.stringify(evidenceRows.map(r => r.row?.seq)));
		census(`live-evidence: T-001 evidence children: 2 (E-000001, E-000002); coalesced per the law (${stack.eventTimes().length} events -> ${predictedEvidence} refresh(es))`);

		// ---- 5. broken state file -> last-known-good + error row; restore -> recovery ----
		const validEnvelope = await nodeFs.readFile(tasksJson, { encoding: 'utf-8' });
		await nodeFs.writeFile(tasksJson, '{ nope', { encoding: 'utf-8' });
		const failureConverged = await pollRender(provider, elements => taskRowsOf(elements)[0]?.kind === 'error');
		const broken = await provider.getChildren();
		const brokenRows = taskRowsOf(broken);
		drillAssert(failureConverged, 'the corrupt envelope produced the unified error row through a REAL re-read failure', `first row kind: ${brokenRows[0]?.kind}`);
		drillAssert(brokenRows.length === 3, 'the error row sits ABOVE the last-known-good rows (nothing blanked)', `${brokenRows.length} rows`);
		const errorElement = broken[0]?.kind === 'error' ? provider.getTreeItem(broken[0]!) : undefined;
		drillAssert(errorElement?.contextValue === 'flauzError', 'the error row carries the shared flauzError context', String(errorElement?.contextValue));
		drillAssert(errorElement?.command?.title === 'Retry' && errorElement?.command?.command === 'flauz.workspace.refreshTasks', 'the error row primary action is the Retry-titled refresh command', JSON.stringify(errorElement?.command));
		drillAssert(errorElement?.tooltip?.includes('The rows below are the last-known-good snapshot.') === true, 'the error row announces the last-known-good snapshot below', String(errorElement?.tooltip));
		drillAssert(brokenRows.slice(1).filter(row => row.kind === 'task').length === 2, 'BOTH task rows survived as the last-known-good snapshot', JSON.stringify(brokenRows.map(r => r.kind)));
		census(`lkg-recovery: error row + ${brokenRows.length - 1} last-known-good task rows; tree never blanked`);
		// restore the valid envelope: the recovery loop closes.
		await nodeFs.writeFile(tasksJson, validEnvelope, { encoding: 'utf-8' });
		const restoredConverged = await pollRender(provider, elements => {
			const rows = taskRowsOf(elements);
			return rows.length === 2 && rows.every(row => row.kind === 'task');
		});
		drillAssert(restoredConverged, 'restoring the envelope re-rendered the clean task rows live (the recovery loop closes)', 'rows did not return to 2 clean tasks');
		census('lkg-restore: valid envelope rewritten on disk -> error row gone, 2 clean task rows');

		// ---- 6. reveal-runtime: the session -> task -> evidence chain ----
		stack.mock.commands.registerCommand(`${TASKS_VIEW_ID}.focus`, () => undefined);
		await stack.mock.commands.executeCommand('flauz.workspace.revealTask', { taskId: 'T-002' });
		const calls = stack.revealCalls();
		drillAssert(calls.length === 1, 'revealTask drove the REAL command handler onto the TreeView handle exactly once', `${calls.length} reveal calls`);
		const revealCall = calls[0];
		const revealed = revealCall?.element as { kind?: string; task?: Task } | undefined;
		drillAssert(revealed?.kind === 'task' && revealed?.task?.id === 'T-002', 'the reveal landed on the RIGHT row (T-002, not the first row)', JSON.stringify(revealed?.task?.id));
		drillAssert(revealCall?.options !== undefined && revealCall.options?.select === true && revealCall.options?.focus === true && revealCall.options?.expand === true, 'the reveal options restore focus per the premium spec (select + focus + expand)', JSON.stringify(revealCall?.options));
		// the getParent chain: evidence resolves to its task (the reveal contract's chain).
		const root = await provider.getChildren();
		const t001 = root.find(element => element.kind === 'task' && element.task.id === 'T-001')!;
		const evidenceChild = (await provider.getChildren(t001)).find(element => element.kind === 'evidence')!;
		const parent = provider.getParent?.(evidenceChild);
		drillAssert(parent?.kind === 'task' && (parent as { task?: Task }).task?.id === 'T-001', 'the getParent chain resolves evidence -> its task (the reveal chain below the workbench seam)', JSON.stringify(parent));
		drillAssert(provider.getParent?.(t001) === undefined, 'the task row is a root (the chain terminates)', 'getParent(task) !== undefined');
		// graceful degradation: an unknown id lands on the view-focus fallback, never a dead command.
		const focusCalls: string[] = [];
		stack.mock.commands.registerCommand(`${TASKS_VIEW_ID}.focus`, () => { focusCalls.push(`${TASKS_VIEW_ID}.focus`); });
		await stack.mock.commands.executeCommand('flauz.workspace.revealTask', { taskId: 'T-does-not-exist' });
		drillAssert(stack.revealCalls().length === 1 && focusCalls.length === 1, 'an unknown reveal id degrades to focusing the Tasks view (no dead command)', `revealCalls=${stack.revealCalls().length} focusCalls=${focusCalls.length}`);
		census(`reveal: revealTask(T-002) -> {select,focus,expand} on the T-002 row; getParent(E-000001) -> T-001; unknown-id -> ${TASKS_VIEW_ID}.focus fallback`);

		// ---- 7. dispose: the wiring never refreshes after disposal ----
		const refreshesAtDispose = stack.refreshes();
		stack.disposeAll();
		await second.appendEvent('T-002', { ts: FIXED_TS, actor: 'human', type: 'approve', payload: {} }).catch(() => undefined);
		await nodeFs.writeFile(path.join(stack.root, '.flauz', 'evidence', 'ledger.jsonl'), 'x\n', { encoding: 'utf-8' });
		await sleep(SETTLE_MS + DEBOUNCE_MS);
		drillAssert(stack.refreshes() === refreshesAtDispose, 'a disposed wiring never fires another refresh (no leak, pending debounce cancelled)', `refreshes before=${refreshesAtDispose} after=${stack.refreshes()}`);
		drillAssert(stack.watcher.disposed === true, 'the watcher is disposed with the wiring', `disposed=${stack.watcher.disposed}`);
		census('dispose: watcher closed, pending debounce cancelled, zero post-dispose refreshes');

		if (failures > 0) {
			console.error(`${PREFIX} FAILED (${failures} assertion(s))`);
			assert.equal(failures, 0, `${failures} drill assertion(s) failed`);
			return;
		}
		console.log(`${PREFIX} ${assertions} assertions, 0 failures`);
		console.log(GREEN_LINE);
	} finally {
		// close the real watcher before removing the tree (fs.watch holds the dir).
		stack.disposeAll();
		await nodeFs.rm(stack.root, { recursive: true, force: true });
	}
}

// ---------------------------------------------------------------------------
// main: mode dispatch (plain invocation honors --selftest / usage; the runner
// invocation (node --test) sees no extra argv and runs the journey)
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
	runSelftest();
} else if (argv.length > 0) {
	console.error(`${PREFIX} unknown argument '${argv[0]}' (expected --selftest)`);
	process.exit(2);
} else if (FORCE_SKIP) {
	console.log(`${SKIP_PREFIX} (FLAUZ_LIVE_EVENTS_RUNTIME_SKIP=1 forced)`);
} else {
	test('live-events runtime drill (real fs events + reveal chain)', async () => {
		await runJourney();
	});
}
