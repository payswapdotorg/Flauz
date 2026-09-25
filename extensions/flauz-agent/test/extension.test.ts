/**
 * Activation-wiring tests: drive src/extension.ts against the redirected
 * 'vscode' mock and assert the documented behavior (marks order, participant
 * + tool registration, graceful no-models, no-workspace degradation).
 */

import { test } from 'node:test';
import { ok, strictEqual } from 'node:assert';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importWithVscodeMock } from './harness/vscode-redirect.ts';
import { __reset, __state } from './harness/vscode-mock-module.ts';

const EXTENSION_URL = new URL('../src/extension.ts', import.meta.url);

async function settle(ms: number): Promise<void> {
        await new Promise<void>((resolve) => {
                setTimeout(() => resolve(), ms);
        });
}

interface ExtensionModule {
        activate(context: unknown): Promise<void>;
        deactivate(): void;
}

function mockContext(globalStoragePath: string): { subscriptions: Array<{ dispose(): void }>; globalStorageUri: { fsPath: string; scheme: string } } {
        return { subscriptions: [], globalStorageUri: { fsPath: globalStoragePath, scheme: 'file' } };
}

function recordMarks(): { marks: string[]; restore(): void } {
        const target = (globalThis as { performance?: { mark: (name: string) => void } }).performance;
        const marks: string[] = [];
        if (!target) {
                return { marks, restore() { /* nothing to restore */ } };
        }
        const original = target.mark.bind(target);
        target.mark = (name: string) => {
                marks.push(name);
                original(name);
        };
        return {
                marks,
                restore() {
                        target.mark = original;
                },
        };
}

test('activate wires core + participant + tool + commands and emits the documented marks in order', async () => {
        const workspaceRoot = mkdtempSync(join(tmpdir(), 'flauz-ext-'));
        __reset({
                workspaceFolders: [{ uri: { fsPath: workspaceRoot, scheme: 'file' }, name: 'workspace', index: 0 }],
                models: [{ vendor: 'flauz-mock', id: 'echo-1', family: 'flauz-echo', version: '1', name: 'Flauz Mock Echo' }],
        });
        const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-ext-storage-'));
        mkdirSync(globalStorage, { recursive: true });
        const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
        const recorder = recordMarks();
        try {
                await extension.activate(mockContext(globalStorage));
                const state = __state();
                strictEqual(state.participants.length, 1, 'flauz.agent registered');
                strictEqual(state.participants[0].id, 'flauz.agent');
                strictEqual(state.tools.length, 1, 'flauz_terminal registered');
                strictEqual(state.tools[0].name, 'flauz_terminal');
                ok(state.commands.some((entry) => entry.command === 'flauz.showTasks'));
                ok(state.commands.some((entry) => entry.command === 'flauz.verifyLedger'));
                strictEqual(
                        recorder.marks.filter((name) => name.startsWith('code/flauz/')).join(','),
                        'code/flauz/willConnectCore,code/flauz/didConnectCore,code/flauz/willRegisterParticipants,code/flauz/didRegisterParticipants,code/flauz/willWarmModels,code/flauz/didWarmModels',
                        'documented mark order (PERF-PLAN 2.2)',
                );
                // The core service actually started against the workspace root.
                ok(state.outputChannels[0].lines.some((line) => line.includes('ready')), 'output channel logs the core ready line');
                // (The globalStorage event-relay is covered by seamClient.test.ts — activation
                // itself creates no tasks, so no relay rows exist yet by design.)
        } finally {
                recorder.restore();
                extension.deactivate();
                await settle(150);
        }
});

test('graceful no-models: activation completes, participant still registered, warning logged', async () => {
        const workspaceRoot = mkdtempSync(join(tmpdir(), 'flauz-ext-nomodels-'));
        __reset({
                workspaceFolders: [{ uri: { fsPath: workspaceRoot, scheme: 'file' }, name: 'workspace', index: 0 }],
                models: [],
        });
        const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-ext-storage2-'));
        const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
        try {
                await extension.activate(mockContext(globalStorage));
                const state = __state();
                strictEqual(state.participants.length, 1, 'participant registered even with zero models');
                ok(state.outputChannels[0].lines.some((line) => line.includes('models: no-models')), 'no-models status logged');
        } finally {
                extension.deactivate();
                await settle(150);
        }
});

test('no workspace folder: activate degrades gracefully (no participant, no crash)', async () => {
        __reset({ workspaceFolders: [], models: [] });
        const globalStorage = mkdtempSync(join(tmpdir(), 'flauz-ext-storage3-'));
        const extension = await importWithVscodeMock<ExtensionModule>(EXTENSION_URL);
        await extension.activate(mockContext(globalStorage));
        const state = __state();
        strictEqual(state.participants.length, 0, 'no participant without a workspace root');
        strictEqual(state.tools.length, 1, 'terminal tool is seam-independent and still registered');
        ok(state.outputChannels[0].lines.some((line) => line.includes('no workspace folder open')), 'degradation logged');
        extension.deactivate();
});
