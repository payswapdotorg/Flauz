/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Browser Policy -- extension entry point (activation wiring).
 *
 * Activation discipline (PERF-PLAN section 2.1/section 2.2, activation-lint
 * R1-R3): this extension NEVER declares `onStartupFinished` (the cap of 2 is
 * reserved for the bridge + workspace extensions) and never `*`. It activates
 * lazily on the first `onCommand:flauz.browser.*` invocation.
 *
 * On activation the extension:
 *   1. loads `.flauz/browser-policy.json` from the (first) workspace folder
 *      and builds a BrowserPolicyEngine (fail-closed: missing or broken file
 *      -> builtin deny-all default, error carried on the engine),
 *   2. logs the effective policy (the B-POLICY canary greps these lines),
 *   3. registers the command surface (see package.json contributes):
 *        flauz.browser.setPolicy     open-or-create the policy file
 *        flauz.browser.showPolicy    dump the effective policy to the channel
 *        flauz.browser.verifyPolicy  re-validate the file, PASS/FAIL receipt
 *        flauz.browser.checkUrl      evaluate a URL at every layer (both
 *                                     initiator classes) and log the verdicts
 *        flauz.browser.evaluate      machine surface: { url, initiator?,
 *                                     partition?, workspaceRoot? } -> verdict
 *                                     (the Agent Bridge integration seam),
 *   4. watches the policy file and hot-swaps the engine on changes.
 */

import * as vscode from 'vscode';
import { mark, FlauzBrowserMarks } from './marks.ts';
import {
        BrowserPolicyEngine,
        POLICY_PATH,
        POLICY_SCHEMA_ID,
        type NavigationInitiator,
        type PolicyVerdict,
        policyTemplate,
        formatVerdictLine,
} from './policy.ts';

interface PolicyState {
        engine: BrowserPolicyEngine;
}

let state: PolicyState | undefined;
let log: (message: string) => void = () => undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
        mark(FlauzBrowserMarks.willActivateBrowserPolicy);
        try {
                await activateInner(context);
        } finally {
                mark(FlauzBrowserMarks.didActivateBrowserPolicy);
        }
}

async function activateInner(context: vscode.ExtensionContext): Promise<void> {
        const channel = vscode.window.createOutputChannel('Flauz Browser Policy');
        log = (message: string) => channel.appendLine(message);
        context.subscriptions.push({ dispose: () => channel.dispose() });

        const folder = firstWorkspaceFolder();
        if (folder === undefined) {
                log('flauz.browser: no workspace folder open; the builtin deny-all default policy is in effect (the policy file and partitions need a workspace root)');
        }

        const initial = await loadEngine(folder);
        state = { engine: initial };
        logEffectivePolicy(initial);

        context.subscriptions.push(
                vscode.commands.registerCommand('flauz.browser.setPolicy', () => commandSetPolicy(folder)),
                vscode.commands.registerCommand('flauz.browser.showPolicy', () => commandShowPolicy()),
                vscode.commands.registerCommand('flauz.browser.verifyPolicy', () => commandVerifyPolicy(folder)),
                vscode.commands.registerCommand('flauz.browser.checkUrl', (arg?: unknown) => commandCheckUrl(folder, arg)),
                vscode.commands.registerCommand('flauz.browser.evaluate', (arg?: unknown) => commandEvaluate(folder, arg)),
        );

        if (folder !== undefined) {
                const watcher = vscode.workspace.createFileSystemWatcher(
                        new vscode.RelativePattern(folder, POLICY_PATH),
                );
                const reload = async () => {
                        const reloaded = await loadEngine(folder);
                        state = { engine: reloaded };
                        log(`flauz.browser: policy file changed on disk; reloaded (source=${reloaded.source}${reloaded.sourceError !== undefined ? ` error=${reloaded.sourceError.code}` : ''})`);
                        logEffectivePolicy(reloaded);
                };
                watcher.onDidChange(() => void reload());
                watcher.onDidCreate(() => void reload());
                watcher.onDidDelete(() => void reload());
                context.subscriptions.push(watcher);
        }
}

function firstWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        const folders = vscode.workspace.workspaceFolders;
        return folders !== undefined && folders.length > 0 ? folders[0] : undefined;
}

function policyUri(folder: vscode.WorkspaceFolder): vscode.Uri {
        return vscode.Uri.joinPath(folder.uri, ...POLICY_PATH.split('/'));
}

async function readPolicyText(folder: vscode.WorkspaceFolder | undefined): Promise<string | undefined> {
        if (folder === undefined) {
                return undefined;
        }
        try {
                const bytes = await vscode.workspace.fs.readFile(policyUri(folder));
                return new TextDecoder().decode(bytes);
        } catch {
                return undefined;
        }
}

async function loadEngine(folder: vscode.WorkspaceFolder | undefined): Promise<BrowserPolicyEngine> {
        return BrowserPolicyEngine.fromPolicyText(await readPolicyText(folder));
}

function logEffectivePolicy(engine: BrowserPolicyEngine): void {
        const policy = engine.policyInEffect;
        log(`flauz.browser: effective policy ${POLICY_SCHEMA_ID} source=${engine.source} schemaVersion=${policy.schemaVersion}`);
        if (engine.sourceError !== undefined) {
                log(`flauz.browser: policy file INVALID (${engine.sourceError.code}) at ${engine.sourceError.path}: ${engine.sourceError.message} -- deny-all builtin default in effect (fail-closed)`);
        }
        for (const layer of ['driver', 'webRequest', 'willNavigate'] as const) {
                const rules = policy[layer];
                log(`flauz.browser: layer ${layer}: enabled=${String(rules.enabled)} allow=${String(rules.allow.length)} deny=${String(rules.deny.length)}${layer === 'driver' ? ` fileRoots=${String(rules.fileRoots.length)}` : ''}`);
        }
        log(`flauz.browser: partitions scope=${policy.partitions.scope} perAgent=${String(policy.partitions.perAgent)}`);
        for (const warning of engine.warnings) {
                log(`flauz.browser: warning: ${warning}`);
        }
}

async function commandSetPolicy(folder: vscode.WorkspaceFolder | undefined): Promise<void> {
        if (folder === undefined) {
                void vscode.window.showWarningMessage('Flauz Browser Policy: open a workspace folder first (the policy file lives at .flauz/browser-policy.json).');
                return;
        }
        const uri = policyUri(folder);
        try {
                await vscode.workspace.fs.readFile(uri);
        } catch {
                await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder.uri, '.flauz'));
                await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(policyTemplate()));
                log(`flauz.browser: created starter policy file (deny-all defaults) at ${POLICY_PATH}`);
        }
        const document = await vscode.workspace.openTextDocument(uri);
        void vscode.window.showTextDocument(document);
}

function commandShowPolicy(): void {
        const current = state;
        if (current === undefined) {
                log('flauz.browser: extension state unavailable (not activated)');
                return;
        }
        logEffectivePolicy(current.engine);
        void vscode.window.showInformationMessage('Flauz Browser Policy: effective policy written to the output channel.');
}

async function commandVerifyPolicy(folder: vscode.WorkspaceFolder | undefined): Promise<{ ok: boolean; error?: { code: string; path: string; message: string } }> {
        const text = await readPolicyText(folder);
        if (text === undefined) {
                log(`flauz.browser: verifyPolicy: no policy file at ${POLICY_PATH} (builtin deny-all default in effect)`);
                return { ok: true };
        }
        const engine = BrowserPolicyEngine.fromPolicyText(text);
        if (engine.sourceError !== undefined) {
                const error = engine.sourceError;
                log(`flauz.browser: verifyPolicy: FAIL ${error.code} at ${error.path}: ${error.message}`);
                return { ok: false, error: { code: error.code, path: error.path, message: error.message } };
        }
        log(`flauz.browser: verifyPolicy: PASS (${POLICY_SCHEMA_ID}, ${engine.warnings.length} warning(s))`);
        for (const warning of engine.warnings) {
                log(`flauz.browser: warning: ${warning}`);
        }
        return { ok: true };
}

async function commandCheckUrl(folder: vscode.WorkspaceFolder | undefined, arg: unknown): Promise<{ agentTool: PolicyVerdict; user: PolicyVerdict } | undefined> {
        const current = state;
        if (current === undefined) {
                log('flauz.browser: extension state unavailable (not activated)');
                return undefined;
        }
        let url: string | undefined = typeof arg === 'string' && arg !== '' ? arg : undefined;
        if (url === undefined) {
                url = await vscode.window.showInputBox({ prompt: 'URL to check against the Flauz browser policy', placeHolder: 'https://example.com/page' });
        }
        if (url === undefined || url === '') {
                return undefined;
        }
        const workspaceRoot = folder?.uri.fsPath;
        const partition = workspaceRoot === undefined ? undefined : safeDerive(current.engine, workspaceRoot);
        log(`flauz.browser: checkUrl ${url} (partition=${partition ?? 'n/a'}, workspaceRoot=${workspaceRoot ?? 'n/a'})`);
        const results = {
                agentTool: current.engine.evaluate({ url, initiator: 'agent-tool', partition, workspaceRoot }).final,
                user: current.engine.evaluate({ url, initiator: 'user', partition, workspaceRoot }).final,
        };
        log(`flauz.browser: agent-tool path: ${formatVerdictLine(results.agentTool)}`);
        log(`flauz.browser: user path:         ${formatVerdictLine(results.user)}`);
        return results;
}

function safeDerive(engine: BrowserPolicyEngine, workspaceRoot: string): string | undefined {
        try {
                return engine.derivePartition(workspaceRoot);
        } catch {
                return undefined;
        }
}

function commandEvaluate(folder: vscode.WorkspaceFolder | undefined, arg: unknown): PolicyVerdict | { error: string } {
        const current = state;
        if (current === undefined) {
                return { error: 'flauz.browser.evaluate: extension state unavailable (not activated)' };
        }
        if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) {
                return { error: 'flauz.browser.evaluate: expected an argument object { url, initiator?, partition?, workspaceRoot? }' };
        }
        const record = arg as Record<string, unknown>;
        if (typeof record['url'] !== 'string' || record['url'] === '') {
                return { error: 'flauz.browser.evaluate: url must be a non-empty string' };
        }
        const initiator: NavigationInitiator = record['initiator'] === 'user' ? 'user' : 'agent-tool';
        const workspaceRoot = typeof record['workspaceRoot'] === 'string'
                ? record['workspaceRoot']
                : folder?.uri.fsPath;
        const partition = typeof record['partition'] === 'string'
                ? record['partition']
                : workspaceRoot === undefined ? undefined : safeDerive(current.engine, workspaceRoot);
        const evaluation = current.engine.evaluate({ url: record['url'], initiator, partition, workspaceRoot });
        log(`flauz.browser: evaluate: ${formatVerdictLine(evaluation.final)}`);
        return evaluation.final;
}

export function deactivate(): void {
        state = undefined;
}
