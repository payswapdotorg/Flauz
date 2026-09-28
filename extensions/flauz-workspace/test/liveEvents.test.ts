/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootWorkspace, fixedClock, nodeFsPort, FIXED_TS, type TestWorkspace } from './helpers.ts';
import { installMockVscode, type MockFileSystemWatcher, type MockVscode } from './shims.ts';
import { TaskService } from '../src/taskService.ts';
import { registerWorkspaceViews, TasksTreeProvider, TASKS_VIEW_ID, type WorkspaceViewContext } from '../src/views.ts';
import { registerLiveEvents, LIVE_EVENTS_DEBOUNCE_MS, LIVE_EVENTS_WATCH_PATTERN, type LiveEventsWiring } from '../src/liveEvents.ts';

const HEX64 = 'a'.repeat(64);
const DEBOUNCE_MS = 10;
const SETTLE_MS = 120;

/** Boots a test workspace + the full view stack + the live-events wiring over the EXISTING refresh path. */
async function bootLiveWorkspace(): Promise<TestWorkspace & {
	views: ReturnType<typeof registerWorkspaceViews>;
	live: LiveEventsWiring;
	watcher: MockFileSystemWatcher;
	refreshCount: () => number;
}> {
	const ws = await bootWorkspace({ registerCommands: false });
	const views = registerWorkspaceViews(viewContextOf(ws));
	let refreshes = 0;
	const live = registerLiveEvents({
		getWorkspaceRoot: () => ws.root,
		refresh: () => {
			refreshes += 1;
			views.refresh();
		},
		debounceMs: DEBOUNCE_MS,
	});
	assert.equal(live.watching, true);
	assert.equal(ws.mock.workspace.fileSystemWatchers.length, 1, 'exactly one watcher over the workspace root');
	const watcher = ws.mock.workspace.fileSystemWatchers[0]!;
	return { ...ws, views, live, watcher, refreshCount: () => refreshes };
}

function viewContextOf(ws: TestWorkspace): WorkspaceViewContext {
	return {
		getServices: () => ({ tasks: ws.tasks, ledger: ws.ledger, checkpoints: ws.checkpoints, artifacts: ws.artifacts }),
		getWorkspaceRoot: () => ws.root,
		readFile: async relativePath => ws.fs.readFileUtf8(join(ws.root, relativePath)),
		clock: () => FIXED_TS,
	};
}

const tasksJsonPath = (ws: { root: string }): string => join(ws.root, '.flauz', 'tasks.json');

test('guard: no workspace folder open -> watcher not created (logged), wiring inert', () => {
	const mock = installMockVscode();
	const logs: string[] = [];
	const live = registerLiveEvents({
		getWorkspaceRoot: () => undefined,
		refresh: () => assert.fail('refresh must never run without a workspace root'),
		log: message => logs.push(message),
	});
	assert.equal(live.watching, false);
	assert.deepEqual(live.disposables, []);
	assert.equal(mock.workspace.fileSystemWatchers.length, 0, 'no watcher created');
	assert.equal(logs.length, 1);
	assert.match(logs[0]!, /no workspace folder open/);
	assert.match(logs[0]!, /watcher not created/);
});

test('watcher surface: one watcher over the workspace root with the .flauz/** pattern (documented constants)', async () => {
	const ws = await bootWorkspace({ registerCommands: false });
	const logs: string[] = [];
	const live = registerLiveEvents({ getWorkspaceRoot: () => ws.root, refresh: () => undefined, debounceMs: DEBOUNCE_MS, log: m => logs.push(m) });
	assert.equal(live.watching, true);
	assert.equal(LIVE_EVENTS_WATCH_PATTERN, '.flauz/**');
	assert.equal(LIVE_EVENTS_DEBOUNCE_MS, 300);
	assert.equal(live.disposables.length, 5, 'watcher + 3 event subscriptions + the debounce-cancel token');
	const watcher = ws.mock.workspace.fileSystemWatchers[0]!;
	assert.equal(watcher.base, ws.root);
	assert.equal(watcher.pattern, '.flauz/**');
	assert.equal(watcher.backend, 'synthetic-only');
	assert.match(logs[0]!, /live \.flauz\/ file events active/);
	for (const disposable of live.disposables) {
		disposable.dispose();
	}
	assert.equal(watcher.disposed, true);
	await ws.cleanup();
});

test('live refresh: a burst of watcher events -> debounce -> ONE refresh -> rows re-render the OBSERVED disk state', async () => {
	const ws = await bootLiveWorkspace();
	await ws.tasks.createTask('First slice');
	const provider = ws.mock.window.treeViewHandles[TASKS_VIEW_ID]! as unknown as { revealCalls: unknown[] };
	// The tasks provider behind the view handle is the one whose change event fires.
	const tasksProvider = findTasksProvider(ws.mock);
	let changeEvents = 0;
	tasksProvider.onDidChangeTreeData?.(() => { changeEvents += 1; });
	const before = await ws.tasks.listTasks();
	assert.equal(before.length, 1);
	// Mutate the disk from a SECOND task-service handle: the view's own services
	// never see this in memory -- only through the observed file change.
	const second = new TaskService({ root: ws.root, fs: nodeFsPort(), clock: fixedClock() });
	await second.createTask('Second slice');
	// The atomic-save event burst (tmp create, tmp delete, target create) -- the
	// shape a real flauz.tasks/v0 save produces.
	ws.watcher.fire('create', join(ws.root, '.flauz', 'tasks.json.tmp'));
	ws.watcher.fire('delete', join(ws.root, '.flauz', 'tasks.json.tmp'));
	ws.watcher.fire('create', tasksJsonPath(ws));
	await sleep(SETTLE_MS);
	assert.equal(ws.refreshCount(), 1, 'the 3-event burst coalesced into exactly ONE refresh');
	assert.equal(changeEvents, 1, 'the refresh rode the EXISTING provider change-event path');
	assert.equal(ws.watcher.eventCount, 3);
	const root = await tasksProvider.getChildren() as Array<{ kind: string; task?: { id: string; title: string } }>;
	assert.equal(root.length, 2, 'the tree re-rendered the OBSERVED new state');
	assert.deepEqual(root.map(row => row.task?.id), ['T-001', 'T-002']);
	assert.deepEqual(root.map(row => row.task?.title), ['First slice', 'Second slice']);
	assert.equal(provider.revealCalls.length, 0);
	await ws.cleanup();
	void second;
});

test('live refresh failure: a failed re-read keeps the last-known-good rows below the unified error row', async () => {
	const ws = await bootLiveWorkspace();
	await ws.tasks.createTask('Survivor slice');
	const tasksProvider = findTasksProvider(ws.mock);
	const first = await tasksProvider.getChildren() as Array<{ kind: string; task?: { title: string } }>;
	assert.equal(first.length, 1);
	// Corrupt the envelope ON DISK (a real re-read failure), then deliver the
	// watcher event exactly as the OS would.
	await ws.fs.writeFile(tasksJsonPath(ws), '{ nope');
	ws.watcher.fire('change', tasksJsonPath(ws));
	await sleep(SETTLE_MS);
	assert.equal(ws.refreshCount(), 1, 'the debounced refresh ran');
	const second = await tasksProvider.getChildren() as Array<{ kind: string; message?: string; retryCommand?: string; stale?: boolean; task?: { title: string } }>;
	assert.equal(second.length, 2);
	assert.equal(second[0]?.kind, 'error');
	assert.equal(second[0]?.retryCommand, 'flauz.workspace.refreshTasks');
	assert.equal(second[0]?.stale, true, 'the error row announces the last-known-good snapshot below');
	assert.equal(second[1]?.kind, 'task');
	assert.equal(second[1]?.task?.title, 'Survivor slice', 'last-known-good row survived the failed re-read');
	await ws.cleanup();
});

test('pattern scoping: events outside .flauz/** never refresh the trees', async () => {
	const ws = await bootLiveWorkspace();
	ws.watcher.fire('change', join(ws.root, 'unrelated.txt'));
	ws.watcher.fire('create', join(ws.root, 'src', 'main.ts'));
	await sleep(SETTLE_MS);
	assert.equal(ws.refreshCount(), 0);
	assert.equal(ws.watcher.eventCount, 0, 'pattern misses never dispatch');
	await ws.cleanup();
});

test('dispose: a disposed wiring never fires a refresh (pending debounce cancelled)', async () => {
	const ws = await bootLiveWorkspace();
	ws.watcher.fire('change', tasksJsonPath(ws));
	// Dispose IMMEDIATELY -- while the debounce timer is still pending.
	for (const disposable of ws.live.disposables) {
		disposable.dispose();
	}
	await sleep(SETTLE_MS);
	assert.equal(ws.refreshCount(), 0, 'the pending debounced refresh was cancelled by disposal');
	assert.equal(ws.watcher.disposed, true);
	// Events after dispose stay inert.
	ws.watcher.fire('change', tasksJsonPath(ws));
	await sleep(SETTLE_MS);
	assert.equal(ws.refreshCount(), 0);
	await ws.cleanup();
});

/** The tasks-view provider from the recorded tree registrations. */
function findTasksProvider(mock: MockVscode): TasksTreeProvider {
	const registration = mock.window.treeViews.find(entry => entry.viewId === TASKS_VIEW_ID);
	assert.ok(registration, 'flauz.tasks view registered');
	return registration.provider as unknown as TasksTreeProvider;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
