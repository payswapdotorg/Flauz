/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { bootWorkspace, FIXED_TS, type TestWorkspace } from './helpers.ts';
import { installMockVscode } from './shims.ts';
import {
        HOME_VIEW_ID,
        TASKS_VIEW_ID,
        VIEW_COMMAND_IDS,
        HomeTreeProvider,
        TasksTreeProvider,
        registerWorkspaceViews,
        type TasksTreeElement,
        type WorkspaceViewContext,
} from '../src/views.ts';

const HEX64 = 'a'.repeat(64);

/** Builds the view context over a booted test workspace (fixed clock -> deterministic ages). */
function viewContextOf(ws: TestWorkspace): WorkspaceViewContext {
        return {
                getServices: () => ({ tasks: ws.tasks, ledger: ws.ledger, checkpoints: ws.checkpoints, artifacts: ws.artifacts }),
                getWorkspaceRoot: () => ws.root,
                readFile: async relativePath => ws.fs.readFileUtf8(join(ws.root, relativePath)),
                clock: () => FIXED_TS,
        };
}

test('registration: both tree views + the six shell commands register', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        const views = registerWorkspaceViews(viewContextOf(ws));
        assert.deepEqual(
                ws.mock.window.treeViews.map(registration => registration.viewId).sort(),
                [HOME_VIEW_ID, TASKS_VIEW_ID].sort(),
        );
        const registered = ws.mock.commands.registered();
        for (const id of VIEW_COMMAND_IDS) {
                assert.ok(registered.includes(id), `command ${id} must be registered`);
        }
        assert.equal(views.disposables.length, VIEW_COMMAND_IDS.length + 2, 'one disposable per command + view');
        await ws.cleanup();
});

test('empty state: no services -> both providers return [] (viewsWelcome path)', async () => {
        const mock = installMockVscode();
        const context: WorkspaceViewContext = {
                getServices: () => undefined,
                getWorkspaceRoot: () => undefined,
                readFile: async () => undefined,
        };
        assert.deepEqual(await new HomeTreeProvider(context).getChildren(), []);
        assert.deepEqual(await new TasksTreeProvider(context).getChildren(), []);
        assert.equal(mock.window.treeViews.length, 0);
});

test('home rows reflect the real .flauz/ state (counts + peer artifacts)', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('Ship the slice');
        await ws.tasks.createTask('Second slice');
        await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 });
        await ws.fs.writeFile(join(ws.root, '.flauz', 'environments.json'), JSON.stringify({
                $schema: 'flauz.environments/v0',
                activeId: 'e-ssh',
                environments: [{ id: 'e-ssh' }, { id: 'e-docker' }],
        }));
        const provider = new HomeTreeProvider(viewContextOf(ws));
        const rows = await provider.getChildren();
        assert.deepEqual(rows.map(row => row.label), ['Tasks', 'Evidence Ledger', 'Environments', 'Browser Policy', 'Workflows']);
        assert.deepEqual(rows.map(row => row.description), [
                '2 open · 2 total',
                '1 row',
                '2 registered · active: e-ssh',
                'built-in default (deny-all)',
                'not initialized',
        ]);
        const tasksItem = provider.getTreeItem(rows[0]!);
        assert.equal(tasksItem.iconPath?.id, 'list-tree');
        assert.equal(tasksItem.command?.command, 'flauz.focusView.tasks');
        // TL4-002: summary-row a11y grammar "<label>: <description>" on every Home row.
        assert.equal(tasksItem.accessibilityInformation?.label, 'Tasks: 2 open · 2 total');
        const ledgerItem = provider.getTreeItem(rows[1]!);
        assert.equal(ledgerItem.command?.command, 'vscode.open');
        const ledgerUri = ledgerItem.command?.arguments?.[0] as { fsPath?: string };
        assert.equal(ledgerUri.fsPath, join(ws.root, '.flauz', 'evidence', 'ledger.jsonl'));
        await ws.cleanup();
});

test('home rows degrade to unreadable + retry when an artifact is corrupt', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('t');
        await ws.fs.writeFile(join(ws.root, '.flauz', 'tasks.json'), '{ nope');
        const provider = new HomeTreeProvider(viewContextOf(ws));
        const rows = await provider.getChildren();
        const tasksRow = rows.find(row => row.id === 'tasks')!;
        assert.equal(tasksRow.description, 'unreadable');
        assert.equal(tasksRow.icon, 'warning');
        assert.equal(tasksRow.command?.command, 'flauz.workspace.refreshHome');
        // TL4-002 state-template tokens: Retry title + shared flauzError context.
        assert.equal(tasksRow.command?.title, 'Retry');
        assert.equal(tasksRow.contextValue, 'flauzError');
        assert.ok(tasksRow.tooltip.includes('Select this row to retry.'));
        const item = provider.getTreeItem(tasksRow);
        assert.equal(item.contextValue, 'flauzError');
        assert.equal(item.accessibilityInformation?.label, 'Tasks: unreadable');
        await ws.cleanup();
});

test('tasks tree: task rows with evidence children (openEvidence wired)', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('Ship the slice');
        await ws.ledger.append('T-001', { kind: 'note', uri: 'file:///w/a.ts', sha256: HEX64 });
        const provider = new TasksTreeProvider(viewContextOf(ws));
        const root = await provider.getChildren();
        assert.equal(root.length, 1);
        assert.equal(root[0]?.kind, 'task');
        const taskItem = provider.getTreeItem(root[0]!);
        assert.equal(taskItem.label, 'Ship the slice');
        assert.equal(taskItem.description, 'T-001 · plan · updated just now');
        assert.equal(taskItem.collapsibleState, 2, 'active tasks start expanded');
        assert.equal(taskItem.iconPath?.id, 'circle-filled');
        assert.ok(taskItem.tooltip?.includes('T-001'));
        // TL4-002: tooltips carry the absolute UTC stamp (fixed clock = 1730000000000).
        assert.ok(taskItem.tooltip?.includes('Updated: 2024-10-27 03:33 UTC (1730000000000)'));
        assert.equal(taskItem.accessibilityInformation?.label, 'Task T-001, Ship the slice, status plan');
        const evidence = await provider.getChildren(root[0]!);
        assert.equal(evidence.length, 1);
        assert.equal(evidence[0]?.kind, 'evidence');
        const evidenceItem = provider.getTreeItem(evidence[0]!);
        assert.equal(evidenceItem.label, 'E-000001');
        assert.equal(evidenceItem.description, 'note · /w/a.ts · just now');
        assert.ok(evidenceItem.tooltip?.includes('Recorded: 2024-10-27 03:33 UTC'));
        assert.equal(evidenceItem.command?.command, 'flauz.workspace.openEvidence');
        assert.deepEqual(evidenceItem.command?.arguments, [{ evidenceId: 'E-000001' }]);
        await ws.cleanup();
});

test('tasks tree: corrupt envelope -> error row wired to the retry command', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.fs.writeFile(join(ws.root, '.flauz', 'tasks.json'), '{ nope');
        const provider = new TasksTreeProvider(viewContextOf(ws));
        const root = await provider.getChildren();
        assert.equal(root.length, 1);
        assert.equal(root[0]?.kind, 'error');
        const item = provider.getTreeItem(root[0]!);
        assert.equal(item.iconPath?.id, 'error');
        assert.equal(item.command?.command, 'flauz.workspace.refreshTasks');
        assert.equal(item.command?.title, 'Retry');
        assert.equal(item.contextValue, 'flauzError');
        assert.ok(item.tooltip?.includes('not valid JSON'));
        assert.ok(item.tooltip?.includes('Select this row to retry.'));
        assert.ok(!item.tooltip?.includes('last-known-good'), 'no cache yet -> no stale note');
        await ws.cleanup();
});

test('tasks tree recovery: a failed refresh keeps the last-known-good rows below the error row', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('Ship the slice');
        const provider = new TasksTreeProvider(viewContextOf(ws));
        const first = await provider.getChildren();
        assert.equal(first.length, 1);
        assert.equal(first[0]?.kind, 'task');
        // Corrupt the envelope AFTER a successful render.
        await ws.fs.writeFile(join(ws.root, '.flauz', 'tasks.json'), '{ nope');
        const second = await provider.getChildren();
        assert.equal(second.length, 2);
        assert.equal(second[0]?.kind, 'error');
        assert.equal(second[1]?.kind, 'task');
        const errorItem = provider.getTreeItem(second[0]!);
        assert.equal(errorItem.contextValue, 'flauzError');
        assert.ok(errorItem.tooltip?.includes('The rows below are the last-known-good snapshot.'));
        const taskItem = provider.getTreeItem(second[1]!);
        assert.equal(taskItem.label, 'Ship the slice');
        await ws.cleanup();
});

test('tasks tree: corrupt ledger -> error child row under the task', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('t');
        await ws.ledger.append('T-001', { kind: 'note', uri: 'flauz://e/x', sha256: HEX64 });
        await ws.fs.writeFile(join(ws.root, '.flauz', 'evidence', 'ledger.jsonl'), 'not-json\n');
        const provider = new TasksTreeProvider(viewContextOf(ws));
        const root = await provider.getChildren();
        const children = await provider.getChildren(root[0]!);
        assert.equal(children.length, 1);
        assert.equal(children[0]?.kind, 'error');
        const item = provider.getTreeItem(children[0]!);
        assert.equal(item.command?.command, 'flauz.workspace.refreshTasks');
        await ws.cleanup();
});

test('focus commands delegate to the built-in view/container focus commands', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        registerWorkspaceViews(viewContextOf(ws));
        const executed: string[] = [];
        for (const builtIn of ['flauz.home.focus', 'flauz.tasks.focus', 'workbench.view.extension.flauz.focus']) {
                ws.mock.commands.registerCommand(builtIn, () => {
                        executed.push(builtIn);
                });
        }
        await ws.run('flauz.focusView.home', {});
        await ws.run('flauz.focusView.tasks', {});
        await ws.run('flauz.focusView', {});
        assert.deepEqual(executed, ['flauz.home.focus', 'flauz.tasks.focus', 'workbench.view.extension.flauz.focus']);
        await ws.cleanup();
});

test('refresh commands fire the providers change events', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        registerWorkspaceViews(viewContextOf(ws));
        const homeProvider = ws.mock.window.treeViews.find(registration => registration.viewId === HOME_VIEW_ID)!.provider;
        const tasksProvider = ws.mock.window.treeViews.find(registration => registration.viewId === TASKS_VIEW_ID)!.provider;
        const events: unknown[][] = [[], []];
        homeProvider.onDidChangeTreeData?.(e => events[0]!.push(e));
        tasksProvider.onDidChangeTreeData?.(e => events[1]!.push(e));
        await ws.run('flauz.workspace.refreshHome', {});
        await ws.run('flauz.workspace.refreshTasks', {});
        assert.equal(events[0]!.length, 1);
        assert.equal(events[1]!.length, 1);
        await ws.cleanup();
});

test('getParent: evidence resolves to its task element; task/error rows are roots', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('Ship the slice');
        await ws.ledger.append('T-001', { kind: 'note', uri: 'file:///w/a.ts', sha256: HEX64 });
        const provider = new TasksTreeProvider(viewContextOf(ws));
        const root = await provider.getChildren();
        const evidence = await provider.getChildren(root[0]!);
        const parent = provider.getParent?.(evidence[0]!);
        assert.equal(parent?.kind, 'task');
        assert.equal(parent?.kind === 'task' ? parent.task.id : undefined, 'T-001');
        assert.equal(provider.getParent?.(root[0]!), undefined);
        await ws.cleanup();
});

test('revealTask: reveals the task row (select + focus + expand) via the TreeView handle', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        await ws.tasks.createTask('Ship the slice');
        await ws.tasks.createTask('Second slice');
        registerWorkspaceViews(viewContextOf(ws));
        await ws.run('flauz.workspace.revealTask', { taskId: 'T-002' });
        const handle = ws.mock.window.treeViewHandles[TASKS_VIEW_ID]!;
        assert.equal(handle.revealCalls.length, 1);
        const call = handle.revealCalls[0]!;
        assert.deepEqual(call.options, { select: true, focus: true, expand: true });
        const element = call.element as { kind: string; task?: { id: string } };
        assert.equal(element.kind, 'task');
        assert.equal(element.task?.id, 'T-002');
        await ws.cleanup();
});

test('revealTask: unknown id degrades to focusing the Tasks view', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        registerWorkspaceViews(viewContextOf(ws));
        const executed: string[] = [];
        ws.mock.commands.registerCommand(`${TASKS_VIEW_ID}.focus`, () => {
                executed.push(`${TASKS_VIEW_ID}.focus`);
        });
        await ws.run('flauz.workspace.revealTask', { taskId: 'T-does-not-exist' });
        assert.deepEqual(executed, ['flauz.tasks.focus']);
        assert.equal(ws.mock.window.treeViewHandles[TASKS_VIEW_ID]!.revealCalls.length, 0);
        await ws.cleanup();
});

test('revealTask: malformed args degrade to focusing the Tasks view', async () => {
        const ws = await bootWorkspace({ registerCommands: false });
        registerWorkspaceViews(viewContextOf(ws));
        const executed: string[] = [];
        ws.mock.commands.registerCommand(`${TASKS_VIEW_ID}.focus`, () => {
                executed.push(`${TASKS_VIEW_ID}.focus`);
        });
        await ws.run('flauz.workspace.revealTask', 'not-an-object');
        assert.deepEqual(executed, ['flauz.tasks.focus']);
        await ws.cleanup();
});
