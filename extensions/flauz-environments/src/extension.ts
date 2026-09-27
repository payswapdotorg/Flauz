/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Extension wiring (v0 + TL3-003 lifecycle). Thin: the registry/providers/
 * continuity/lifecycle core is pure TypeScript (zero deps, testable under
 * `node --test`); this file binds the ports to node, resolves the workspace
 * root, and registers the `flauz.env.*` commands. Activation is command- and
 * view-driven only (activation-lint R3: the onStartupFinished cap is already
 * spent by flauz-agent + flauz-workspace).
 *
 * TL4-001: activation registers the `flauz.environments` view FIRST — the
 * tree renders the live registry + lifecycle state, a retryable error row
 * when the bootstrap failed, and refreshes after every mutating command.
 *
 * TL3-003: the lifecycle manager is wired with the LOCAL-REAL executor
 * (workspace-remote, local-loopback posture; fixed harness only) and the
 * SIMULATED remote executors behind an explicit opt-in (per-command
 * `simulated` or the `flauz.environments.simulated` setting; default REAL
 * for the local kind, SIMULATED only on demand — no fake claims of real
 * remote control; real providers = TL3-004).
 *
 * Provenance at the command boundary: palette invocations default to actor
 * `human` (the command palette is a human surface); programmatic callers
 * (agents/tools) MUST pass `actor` explicitly — the manager itself rejects
 * any op without a valid actor.
 *
 * v0 boundary: NO resolver registration and NO live remote connection
 * happen here (INTEGRATION-GAP.md; the `resolvers` grant stays absent per
 * DL-33 until real resolver code lands).
 */
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import type { FileSystemPort } from './api.ts';
import { EnvironmentRegistry } from './registry.ts';
import { planSwitch } from './continuity.ts';
import { registerEnvironmentsView, type EnvironmentsViewApi } from './views.ts';
import {
	ContinuityManager,
	type ContinuityStatusReport,
	type RestoreSurfaceResult,
	type VerifySurfaceResult,
} from './continuityExec/index.ts';
import {
	EnvironmentLifecycleManager,
	LocalProcessExecutor,
	SimulatedRemoteExecutor,
	type ChildHandle,
	type DescribeReport,
	type EnvironmentOpOutcome,
	type ExecutorOpDetail,
	type HashPort,
	type LocalEnvFsPort,
	type ProcessPort,
	type SimFsPort,
} from './lifecycle/index.ts';

const nodeFs: FileSystemPort = {
	readFileUtf8: async path => {
		try {
			return await fs.readFile(path, { encoding: 'utf-8' });
		} catch (err) {
			if ((err as { code?: string }).code === 'ENOENT') {
				return undefined;
			}
			throw err;
		}
	},
	writeFile: (path, contents) => fs.writeFile(path, contents, { encoding: 'utf-8' }),
	rename: (fromPath, toPath) => fs.rename(fromPath, toPath),
	mkdir: path => fs.mkdir(path, { recursive: true }),
};

/** The richer fs surface the local-real executor + simulators need. */
const localFs: LocalEnvFsPort & SimFsPort = {
	...nodeFs,
	readdir: async path => (await fs.readdir(path)).sort(),
	rm: path => fs.rm(path, { recursive: true, force: true }),
};

/**
 * The process port. `launchNodeProcess` runs a harness under the host's node
 * binary with the standard extension-host pattern: ELECTRON_RUN_AS_NODE=1
 * when `process.execPath` is Electron (Electron re-execs itself as plain
 * node; the harness then type-strips like any node >= 23.6 process).
 */
const nodeProcessPort: ProcessPort = {
	launchNodeProcess: (scriptPath, args, options) => {
		const electron = process.versions.electron !== undefined;
		const env: Record<string, string | undefined> = { ...process.env, ...(options?.env ?? {}) };
		if (electron) {
			env.ELECTRON_RUN_AS_NODE = '1';
		}
		return spawn(process.execPath, [scriptPath, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] }) as ChildHandle;
	},
	isPidAlive: pid => {
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	},
};

const nodeHashPort: HashPort = {
	sha256Hex: contents => createHash('sha256').update(contents, 'utf-8').digest('hex'),
};

/**
 * The FIXED harness shipped inside this extension — the only executable the
 * local-real executor ever spawns (injection law: no descriptor-derived
 * command/shell/script ever reaches the spawn surface).
 */
const HARNESS_PATH = new URL('../fixtures/env-agent.ts', import.meta.url).pathname;

/** Live extension state the view + commands read (single source of truth). */
const state: {
	registry: EnvironmentRegistry | undefined;
	lifecycle: EnvironmentLifecycleManager | undefined;
	continuity: ContinuityManager | undefined;
	error: string | undefined;
	view: { refresh(): void } | undefined;
	workspaceRoot: string | undefined;
	fs: FileSystemPort;
	clock: () => number;
} = {
	registry: undefined,
	lifecycle: undefined,
	continuity: undefined,
	error: undefined,
	view: undefined,
	workspaceRoot: undefined,
	fs: nodeFs,
	clock: () => Date.now(),
};

function currentRegistry(): EnvironmentRegistry {
	if (state.registry === undefined) {
		throw new Error('flauz.env: registry inactive (no workspace folder or failed bootstrap)');
	}
	return state.registry;
}

function currentLifecycle(): EnvironmentLifecycleManager {
	if (state.lifecycle === undefined) {
		throw new Error('flauz.env: lifecycle inactive (no workspace folder or failed bootstrap)');
	}
	return state.lifecycle;
}

function currentContinuity(): ContinuityManager {
	if (state.continuity === undefined) {
		throw new Error('flauz.continuity: continuity inactive (no workspace folder or failed bootstrap)');
	}
	return state.continuity;
}

/** Builds the registry + lifecycle manager pair for a workspace root. */
async function bootManagers(root: string): Promise<{ registry: EnvironmentRegistry; lifecycle: EnvironmentLifecycleManager; continuity: ContinuityManager }> {
	const registry = new EnvironmentRegistry({ root, fs: state.fs, clock: state.clock });
	await registry.bootstrap();
	const lifecycle = new EnvironmentLifecycleManager({
		registry,
		root,
		fs: state.fs,
		clock: state.clock,
		executors: [
			new LocalProcessExecutor({
				root,
				fs: localFs,
				process: nodeProcessPort,
				hash: nodeHashPort,
				clock: state.clock,
				harnessPath: HARNESS_PATH,
			}),
			new SimulatedRemoteExecutor({ kind: 'ssh-local', root, fs: localFs, clock: state.clock }),
			new SimulatedRemoteExecutor({ kind: 'container', root, fs: localFs, clock: state.clock }),
			new SimulatedRemoteExecutor({ kind: 'cloud-sandbox', root, fs: localFs, clock: state.clock }),
		],
	});
	await lifecycle.bootstrap();
	const continuity = new ContinuityManager({
		root,
		fs: {
			...nodeFs,
			readdir: async path => {
				try {
					const entries = await fs.readdir(path, { withFileTypes: true });
					return entries
						.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
						.map(entry => ({ name: entry.name, kind: entry.isDirectory() ? ('directory' as const) : ('file' as const) }));
				} catch (err) {
					if ((err as { code?: string }).code === 'ENOENT') {
						return undefined;
					}
					throw err;
				}
			},
			rm: path => fs.rm(path, { recursive: true, force: true }),
		},
		clock: state.clock,
		mintId: () => `flauz:continuity:${randomBytes(8).toString('hex')}`,
		registry,
	});
	return { registry, lifecycle, continuity };
}

/** Real recovery: re-attempts the registry + lifecycle bootstrap from scratch. */
async function retryBootstrap(): Promise<void> {
	if (state.workspaceRoot === undefined) {
		state.registry = undefined;
		state.lifecycle = undefined;
		state.continuity = undefined;
		state.error = undefined;
		return;
	}
	try {
		const fresh = await bootManagers(state.workspaceRoot);
		state.registry = fresh.registry;
		state.lifecycle = fresh.lifecycle;
		state.continuity = fresh.continuity;
		state.error = undefined;
	} catch (err) {
		state.registry = undefined;
		state.lifecycle = undefined;
		state.continuity = undefined;
		state.error = err instanceof Error ? err.message : String(err);
	}
}

/** Refreshes the view after a mutation (or a state change). */
function refreshView(): void {
	state.view?.refresh();
}

function describeEnvironment(descriptor: { id: string; label: string; kind: string; enabled: boolean; active: boolean }): string {
	const flags = [
		descriptor.active ? 'active' : 'inactive',
		descriptor.enabled ? 'enabled' : 'disabled',
	];
	return `${descriptor.id} -- ${descriptor.label} (${descriptor.kind}, ${flags.join(', ')})`;
}

// ---------------------------------------------------------------------------
// TL3-003 lifecycle command surface (typed results, never raw throws)
// ---------------------------------------------------------------------------

/** The result every lifecycle command returns (success carries the ledger record). */
export type LifecycleCommandResult =
	| { readonly ok: true; readonly outcome: EnvironmentOpOutcome & { ok: true } }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string }; readonly outcome?: EnvironmentOpOutcome & { ok: false } }
	| { readonly ok: true; readonly report: DescribeReport };

/** Command arg shape: `'<envId>'` or `{ id, actor?, simulated? }`. */
interface LifecycleCommandArg {
	readonly id: string;
	readonly actor?: string;
	readonly simulated?: boolean;
}

function parseLifecycleArg(command: string, arg: unknown): { ok: true; value: LifecycleCommandArg } | { ok: false; error: { code: string; message: string } } {
	if (typeof arg === 'string' && arg.length > 0) {
		return { ok: true, value: { id: arg } };
	}
	if (typeof arg === 'object' && arg !== null && typeof (arg as { id?: unknown }).id === 'string' && (arg as { id: string }).id.length > 0) {
		const record = arg as { id: string; actor?: unknown; simulated?: unknown };
		return {
			ok: true,
			value: {
				id: record.id,
				...(typeof record.actor === 'string' ? { actor: record.actor } : {}),
				...(typeof record.simulated === 'boolean' ? { simulated: record.simulated } : {}),
			},
		};
	}
	return { ok: false, error: { code: 'ARG_INVALID', message: `flauz.env.${command}: expected the environment id (string or { id, actor?, simulated? })` } };
}

/** Resolves the simulated opt-in: per-command arg wins over the setting. */
function resolveSimulated(argSimulated: boolean | undefined): boolean {
	if (argSimulated !== undefined) {
		return argSimulated;
	}
	return vscode.workspace.getConfiguration('flauz.environments').get<boolean>('simulated', false);
}

function preflightError(err: unknown): LifecycleCommandResult {
	const code = (err as { code?: unknown }).code;
	return {
		ok: false,
		error: {
			code: typeof code === 'string' && code.length > 0 ? code : 'LIFECYCLE_ERROR',
			message: err instanceof Error ? err.message : String(err),
		},
	};
}

/** Wraps one lifecycle op as a typed command result (never a raw throw). */
async function runLifecycleCommand(command: string, op: 'create' | 'start' | 'stop' | 'attach' | 'detach' | 'snapshot' | 'destroy', arg: unknown): Promise<LifecycleCommandResult> {
	const parsed = parseLifecycleArg(command, arg);
	if (!parsed.ok) {
		return { ok: false, error: parsed.error };
	}
	try {
		const outcome = await currentLifecycle().perform(op, {
			id: parsed.value.id,
			actor: parsed.value.actor ?? 'human',
			simulated: resolveSimulated(parsed.value.simulated),
		});
		refreshView();
		const label = outcome.record.op;
		if (outcome.ok) {
			void vscode.window.showInformationMessage(`flauz-environments: ${label} ${parsed.value.id} -> ${outcome.record.toState}`);
		} else {
			void vscode.window.showErrorMessage(`flauz-environments: ${label} ${parsed.value.id} failed (${outcome.error.code}): ${outcome.error.message}`);
		}
		return outcome.ok ? { ok: true, outcome } : { ok: false, error: outcome.error, outcome };
	} catch (err) {
		return preflightError(err);
	}
}

/** The vscode slices handed to the view module (kept here for clarity). */
function viewApi(): EnvironmentsViewApi {
	return {
		registerTreeDataProvider: (viewId, provider) => vscode.window.registerTreeDataProvider(viewId, provider),
		registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
		executeCommand: (command, ...args) => vscode.commands.executeCommand(command, ...args),
		EventEmitter: vscode.EventEmitter,
		TreeItem: vscode.TreeItem,
		ThemeIcon: vscode.ThemeIcon,
		TreeItemCollapsibleState: vscode.TreeItemCollapsibleState,
	};
}

// ---------------------------------------------------------------------------
// TL3-006 continuity command surface (typed results, never raw throws).
// Provenance at the command boundary: palette invocations default to actor
// `human` (the command palette is a human surface); programmatic callers
// (agents/tools) pass `actor` explicitly — the manager itself rejects any op
// without a valid actor (fail-closed).
// ---------------------------------------------------------------------------

/** The result every continuity command returns (typed, never a raw throw). */
export type ContinuityCommandResult =
	| { readonly ok: true; readonly op: 'export'; readonly manifest: import('./continuityExec/types.ts').ContinuityBundleManifest; readonly record: import('./continuityExec/types.ts').ContinuityOpRecord }
	| { readonly ok: true; readonly op: 'restore'; readonly surfaces: readonly RestoreSurfaceResult[]; readonly record: import('./continuityExec/types.ts').ContinuityOpRecord }
	| { readonly ok: true; readonly op: 'verify'; readonly surfaces: readonly VerifySurfaceResult[]; readonly record: import('./continuityExec/types.ts').ContinuityOpRecord }
	| { readonly ok: true; readonly op: 'status'; readonly report: ContinuityStatusReport }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string }; readonly record?: import('./continuityExec/types.ts').ContinuityOpRecord; readonly surfaces?: readonly (RestoreSurfaceResult | VerifySurfaceResult)[] };

/** Wraps a continuity pre-flight error as a typed command result. */
function continuityPreflightError(err: unknown): ContinuityCommandResult {
	const code = (err as { code?: unknown }).code;
	return {
		ok: false,
		error: {
			code: typeof code === 'string' && code.length > 0 ? code : 'CONTINUITY_ERROR',
			message: err instanceof Error ? err.message : String(err),
		},
	};
}

async function runContinuityExport(arg: unknown): Promise<ContinuityCommandResult> {
	const record = typeof arg === 'object' && arg !== null ? (arg as { actor?: unknown; environmentId?: unknown; switchPlanRef?: unknown }) : {};
	try {
		const outcome = await currentContinuity().export({
			actor: record.actor ?? 'human',
			...(record.environmentId !== undefined ? { environmentId: record.environmentId } : {}),
			...(record.switchPlanRef !== undefined ? { switchPlanRef: record.switchPlanRef } : {}),
		});
		if (outcome.ok) {
			const counts = Object.values(outcome.manifest.surfaces).reduce((acc, entry) => { acc[entry.status] = (acc[entry.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
			void vscode.window.showInformationMessage(`flauz-environments: continuity bundle ${outcome.manifest.bundleId} exported (${counts.carried ?? 0} carried, ${counts.redacted ?? 0} redacted, ${counts.lost ?? 0} lost surfaces)`);
			return { ok: true, op: 'export', manifest: outcome.manifest, record: outcome.record };
		}
		void vscode.window.showErrorMessage(`flauz-environments: continuity export failed (${outcome.error.code}): ${outcome.error.message}`);
		return { ok: false, error: outcome.error, record: outcome.record };
	} catch (err) {
		return continuityPreflightError(err);
	}
}

async function runContinuityRestore(arg: unknown): Promise<ContinuityCommandResult> {
	const bundleId = typeof arg === 'string' && arg.length > 0 ? arg : (arg as { bundleId?: unknown } | undefined)?.bundleId;
	const record = typeof arg === 'object' && arg !== null ? (arg as { actor?: unknown; targetEnvironmentId?: unknown; force?: unknown }) : {};
	if (typeof bundleId !== 'string' || bundleId.length === 0) {
		return { ok: false, error: { code: 'ARG_INVALID', message: 'flauz.continuity.restore: expected the bundle id (string or { bundleId, actor?, targetEnvironmentId?, force? })' } };
	}
	try {
		const outcome = await currentContinuity().restore({
			bundleId,
			actor: record.actor ?? 'human',
			...(record.targetEnvironmentId !== undefined ? { targetEnvironmentId: record.targetEnvironmentId } : {}),
			...(record.force !== undefined ? { force: record.force } : {}),
		});
		if (outcome.ok) {
			const carried = outcome.surfaces.filter((surface: RestoreSurfaceResult) => surface.outcome === 'carried').length;
			void vscode.window.showInformationMessage(`flauz-environments: continuity bundle ${bundleId} restored (${carried} surface(s) re-hydrated)`);
			return { ok: true, op: 'restore', surfaces: outcome.surfaces, record: outcome.record };
		}
		void vscode.window.showErrorMessage(`flauz-environments: continuity restore failed (${outcome.error.code}): ${outcome.error.message}`);
		return { ok: false, error: outcome.error, record: outcome.record, ...(outcome.surfaces.length > 0 ? { surfaces: outcome.surfaces } : {}) };
	} catch (err) {
		return continuityPreflightError(err);
	}
}

async function runContinuityVerify(arg: unknown): Promise<ContinuityCommandResult> {
	const bundleId = typeof arg === 'string' && arg.length > 0 ? arg : (arg as { bundleId?: unknown } | undefined)?.bundleId;
	const actor = typeof arg === 'object' && arg !== null ? (arg as { actor?: unknown }).actor : undefined;
	if (typeof bundleId !== 'string' || bundleId.length === 0) {
		return { ok: false, error: { code: 'ARG_INVALID', message: 'flauz.continuity.verify: expected the bundle id (string or { bundleId, actor? })' } };
	}
	try {
		const outcome = await currentContinuity().verify({ bundleId, actor: actor ?? 'human' });
		if (outcome.ok) {
			const verified = outcome.surfaces.filter((surface: VerifySurfaceResult) => surface.verdict === 'verified').length;
			void vscode.window.showInformationMessage(`flauz-environments: continuity bundle ${bundleId} verified (${verified} surface artifact(s) hash-checked)`);
			return { ok: true, op: 'verify', surfaces: outcome.surfaces, record: outcome.record };
		}
		void vscode.window.showErrorMessage(`flauz-environments: continuity verify failed (${outcome.error.code}): ${outcome.error.message}`);
		return { ok: false, error: outcome.error, surfaces: outcome.surfaces, record: outcome.record };
	} catch (err) {
		return continuityPreflightError(err);
	}
}

async function runContinuityStatus(): Promise<ContinuityCommandResult> {
	try {
		const report: ContinuityStatusReport = await currentContinuity().status();
		void vscode.window.showInformationMessage(`flauz-environments: ${report.bundles.length} continuity bundle(s), ${report.ops.length} recorded op(s)`);
		return { ok: true, op: 'status', report };
	} catch (err) {
		return continuityPreflightError(err);
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	state.workspaceRoot = workspaceRoot;

	// TL4-001: the view registers before any early return so the shell surface
	// (welcome/error/retry states) exists even without a workspace folder.
	const view = registerEnvironmentsView(viewApi(), {
		getRegistry: () => state.registry,
		getLifecycle: () => state.lifecycle,
		getError: () => state.error,
		retry: () => retryBootstrap().finally(refreshView),
	});
	state.view = view.provider;
	for (const disposable of view.disposables) {
		context.subscriptions.push(disposable);
	}

	if (workspaceRoot === undefined) {
		// command handlers surface this on use; boot stays silent otherwise
		void vscode.window.showWarningMessage('flauz-environments: no workspace folder open -- the environment registry stays inactive.');
		return;
	}

	void (async () => {
		try {
			const managers = await bootManagers(workspaceRoot);
			state.registry = managers.registry;
			state.lifecycle = managers.lifecycle;
		} catch (err) {
			state.error = err instanceof Error ? err.message : String(err);
			void vscode.window.showErrorMessage(`flauz-environments: failed to bootstrap .flauz state: ${err instanceof Error ? err.message : String(err)}`);
		}
		refreshView();
	})();

	const commands: [string, (arg?: unknown) => unknown][] = [
		['flauz.env.list', () => {
			const list = currentRegistry().list();
			const activeId = currentRegistry().activeId();
			return list.map(descriptor => describeEnvironment({ id: descriptor.id, label: descriptor.label, kind: descriptor.kind, enabled: descriptor.enabled, active: descriptor.id === activeId }));
		}],
		['flauz.env.register', async (arg?: unknown) => {
			// arg: EnvironmentRegistration (id/kind/label/connection/trust/capabilities[/enabled])
			const reg = currentRegistry();
			const descriptor = await reg.register(arg as never);
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: registered ${descriptor.id} (${descriptor.kind})`);
			return descriptor;
		}],
		['flauz.env.unregister', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.unregister: expected the environment id (string or { id })');
			}
			await currentRegistry().unregister(id);
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: unregistered ${id}`);
		}],
		['flauz.env.activate', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.activate: expected the environment id (string or { id })');
			}
			const reg = currentRegistry();
			const plan = await reg.activate(id);
			const descriptor = reg.get(id)!;
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: ${id} active -- connection plan ready (${plan.authority}, agent host: ${plan.agentHost.mode})`);
			return plan;
		}],
		['flauz.env.deactivate', async () => {
			await currentRegistry().deactivate();
			refreshView();
		}],
		['flauz.env.showPlan', (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.showPlan: expected the environment id (string or { id })');
			}
			return currentRegistry().planFor(id);
		}],
		['flauz.env.switch', async (arg?: unknown) => {
			const id = typeof arg === 'string' ? arg : (arg as { id?: string } | undefined)?.id;
			const rawBundleId = typeof arg === 'object' && arg !== null ? (arg as { continuityBundleId?: unknown }).continuityBundleId : undefined;
			if (typeof id !== 'string') {
				throw new Error('flauz.env.switch: expected the target environment id (string or { id, continuityBundleId? })');
			}
			if (rawBundleId !== undefined && typeof rawBundleId !== 'string') {
				throw new Error(`flauz.env.switch: continuityBundleId must be a continuity bundle id string (got ${JSON.stringify(rawBundleId)})`);
			}
			const reg = currentRegistry();
			const target = reg.get(id);
			if (target === undefined) {
				throw new Error(`flauz.env.switch: unknown environment '${id}'`);
			}
			const active = reg.active();
			const plan = await reg.activate(id);
			const switchPlan = planSwitch(active ?? null, target, typeof rawBundleId === 'string' ? { continuityBundleId: rawBundleId } : undefined);
			refreshView();
			void vscode.window.showInformationMessage(`flauz-environments: switch planned ${switchPlan.fromEnvironmentId ?? 'local'} -> ${id} (re-open on ${switchPlan.toAuthority}${switchPlan.continuityBundleId !== undefined ? `; continuity bundle ${switchPlan.continuityBundleId}` : ''}; see flauz.env.showPlan)`);
			return switchPlan;
		}],
		// ---- TL3-003 lifecycle commands (typed results, never raw throws) ----
		['flauz.env.create', (arg?: unknown) => runLifecycleCommand('create', 'create', arg)],
		['flauz.env.start', (arg?: unknown) => runLifecycleCommand('start', 'start', arg)],
		['flauz.env.stop', (arg?: unknown) => runLifecycleCommand('stop', 'stop', arg)],
		['flauz.env.attach', (arg?: unknown) => runLifecycleCommand('attach', 'attach', arg)],
		['flauz.env.detach', (arg?: unknown) => runLifecycleCommand('detach', 'detach', arg)],
		['flauz.env.snapshot', (arg?: unknown) => runLifecycleCommand('snapshot', 'snapshot', arg)],
		['flauz.env.destroy', (arg?: unknown) => runLifecycleCommand('destroy', 'destroy', arg)],
		['flauz.env.status', async (arg?: unknown) => {
			const parsed = parseLifecycleArg('status', arg);
			if (!parsed.ok) {
				return { ok: false, error: parsed.error };
			}
			try {
				const report = await currentLifecycle().describe({ id: parsed.value.id });
				refreshView();
				void vscode.window.showInformationMessage(`flauz-environments: ${report.environmentId} is ${report.state} (${report.verdict.health})`);
				return { ok: true, report };
			} catch (err) {
				return preflightError(err);
			}
		}],
		// ---- TL3-006 continuity commands (typed results, never raw throws) ----
		['flauz.continuity.export', async (arg?: unknown) => runContinuityExport(arg)],
		['flauz.continuity.restore', async (arg?: unknown) => runContinuityRestore(arg)],
		['flauz.continuity.verify', async (arg?: unknown) => runContinuityVerify(arg)],
		['flauz.continuity.status', async () => runContinuityStatus()],
	];

	for (const [id, handler] of commands) {
		context.subscriptions.push(vscode.commands.registerCommand(id, handler));
	}
}

export function deactivate(): void {
	state.registry = undefined;
	state.lifecycle = undefined;
	state.continuity = undefined;
	state.error = undefined;
	state.view = undefined;
	state.workspaceRoot = undefined;
}
