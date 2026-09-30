/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Flauz Resources -- extension entry point (activation wiring).
 *
 * Activation discipline (PERF section 2.1/2.2, activation-lint R1-R3): this
 * extension NEVER declares `onStartupFinished` and never `*`. It activates
 * lazily on the first `onCommand:flauz.res.*` invocation.
 *
 * On activation the extension:
 *   1. resolves the (first) workspace folder and bootstraps the resource
 *      graph at `.flauz/resources.json` (created empty when absent; a broken
 *      file surfaces an error message and the command surface degrades --
 *      fail-closed, no silent resets);
 *   2. registers the command surface (see package.json contributes):
 *        flauz.res.list                 list refs (optionally filtered by kind)
 *        flauz.res.show                 ref + surfaces + edges + lineage
 *        flauz.res.graph                JSON dump of the envelope (or a --dot rendering)
 *        flauz.res.verify               schema + integrity + provenance verification
 *        flauz.res.syncBrowserSessions  reconcile browser-session refs from the
 *                                      PIN-1 journal (.flauz/browser-sessions.jsonl,
 *                                      READ-ONLY consumption; provenance-recorded)
 *
 * The FileSystemPort binds vscode.workspace.fs (readFile/writeFile/
 * createDirectory/rename all exist on the stable API; appendFile is a
 * read-concat-write -- the ops ledger is small and workspace-local). This is
 * what lets src/extension.ts stay fully mock-testable under the copied
 * flauz-browser harness discipline (test/harness/).
 *
 * v0 boundary: no UNATTRIBUTED mutation commands are exposed on the palette
 * (every mutation requires fail-closed provenance and the Agent OS
 * integration is the intended writer). The TL3-006 journal-sync command is
 * the documented exception: a bounded, provenance-recorded reconciliation
 * whose actor defaults to `human` at the palette boundary exactly like the
 * flauz-environments lifecycle commands (programmatic callers pass `actor`
 * explicitly). See INTEGRATION-GAP.md for the Wave-next wiring.
 */
import * as vscode from 'vscode';
import {
	GRAPH_PATH,
	type FileSystemPort,
	type ResourceKind,
	type SurfaceRecord,
	isResourceKind,
} from './api.ts';
import { ResourceGraph, toDot, verifyWorkspace, type NeighborLink } from './graph.ts';
import { BrowserSessionBridge, type SyncReport } from './journalBridge.ts';

const vscodeFs: FileSystemPort = {
	readFileUtf8: async path => {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
			return new TextDecoder().decode(bytes);
		} catch {
			return undefined;
		}
	},
	writeFile: async (path, contents) => {
		await vscode.workspace.fs.writeFile(vscode.Uri.file(path), new TextEncoder().encode(contents));
	},
	appendFile: async (path, contents) => {
		const uri = vscode.Uri.file(path);
		let current = '';
		try {
			current = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
		} catch {
			current = '';
		}
		// atomic append (DL-77: never an in-place mutation): read the
		// existing bytes, write the extension to a tmp file, rename over
		// the target -- a torn append can never leave a half-written line.
		const tmpUri = vscode.Uri.file(`${path}.tmp`);
		await vscode.workspace.fs.writeFile(tmpUri, new TextEncoder().encode(current + contents));
		await vscode.workspace.fs.rename(tmpUri, uri, { overwrite: true });
	},
	rename: async (fromPath, toPath) => {
		await vscode.workspace.fs.rename(vscode.Uri.file(fromPath), vscode.Uri.file(toPath), { overwrite: true });
	},
	mkdir: async path => {
		await vscode.workspace.fs.createDirectory(vscode.Uri.file(path));
	},
};

let graph: ResourceGraph | undefined;
let log: (message: string) => void = () => undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const channel = vscode.window.createOutputChannel('Flauz Resources');
	log = (message: string) => channel.appendLine(message);
	context.subscriptions.push({ dispose: () => channel.dispose() });

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder === undefined) {
		void vscode.window.showWarningMessage('flauz-resources: no workspace folder open -- the resource graph stays inactive (state lives at .flauz/resources.json).');
		return;
	}

	graph = new ResourceGraph({ root: folder.uri.fsPath, fs: vscodeFs });
	try {
		await graph.bootstrap();
		log(`flauz.res: graph active (${GRAPH_PATH}; ${graph.envelope().nodes.length} ref(s))`);
	} catch (err) {
		graph = undefined;
		void vscode.window.showErrorMessage(`flauz-resources: failed to bootstrap ${GRAPH_PATH}: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('flauz.res.list', (arg?: unknown) => commandList(arg)),
		vscode.commands.registerCommand('flauz.res.show', (arg?: unknown) => commandShow(arg)),
		vscode.commands.registerCommand('flauz.res.graph', (arg?: unknown) => commandGraph(arg)),
		vscode.commands.registerCommand('flauz.res.verify', () => commandVerify(folder)),
		vscode.commands.registerCommand('flauz.res.syncBrowserSessions', (arg?: unknown) => commandSyncBrowserSessions(arg)),
	);
}

function currentGraph(): ResourceGraph {
	if (graph === undefined) {
		throw new Error('flauz.res: graph inactive (no workspace folder or failed bootstrap)');
	}
	return graph;
}

function parseKindArg(arg: unknown): ResourceKind | undefined {
	if (arg === undefined || arg === null || arg === '') {
		return undefined;
	}
	const kind = typeof arg === 'string' ? arg : (arg as { kind?: unknown })?.kind;
	if (typeof kind !== 'string' || !isResourceKind(kind)) {
		throw new Error(`flauz.res.list: expected a resource kind (one of file, directory, task, agent-session, browser-session, environment, artifact, evidence, model, provider, workflow, workspace) or no argument; got ${JSON.stringify(arg)}`);
	}
	return kind;
}

function parseRefArg(command: string, arg: unknown): string {
	const id = typeof arg === 'string' ? arg : (arg as { id?: unknown; refId?: unknown } | undefined)?.id ?? (arg as { refId?: unknown } | undefined)?.refId;
	if (typeof id !== 'string' || id === '') {
		throw new Error(`${command}: expected the resource ref id (string or { id } | { refId })`);
	}
	return id;
}

function commandList(arg: unknown): unknown {
	const kind = parseKindArg(arg);
	const refs = kind === undefined ? currentGraph().envelope().nodes : currentGraph().byKind(kind);
	log(`flauz.res: ${refs.length} ref(s)${kind !== undefined ? ` of kind ${kind}` : ''}`);
	for (const ref of refs) {
		log(`flauz.res: ${ref.id} -- ${ref.displayName ?? '(no display name)'} (${ref.kind}, created ${ref.createdAt}, by ${ref.provenance.actor})`);
	}
	return refs;
}

function describeSurface(record: SurfaceRecord): string {
	const current = record.versions[record.versions.length - 1];
	const versionNote = record.versions.length > 1 ? `, ${record.versions.length} versions (prior retained)` : '';
	return `${record.family}${versionNote}: ${JSON.stringify(current?.surface)}`;
}

async function commandShow(arg: unknown): Promise<unknown> {
	const id = parseRefArg('flauz.res.show', arg);
	const g = currentGraph();
	const ref = g.get(id);
	if (ref === undefined) {
		throw new Error(`flauz.res.show: unknown ref '${id}'`);
	}
	const surfaces: readonly SurfaceRecord[] = g.surfacesFor(id);
	const neighbors: readonly NeighborLink[] = g.neighbors(id);
	const lineage = g.lineage(id);
	log(`flauz.res: ${ref.id} -- ${ref.displayName ?? '(no display name)'} (${ref.kind})`);
	log(`flauz.res:   provenance: ${JSON.stringify(ref.provenance)}`);
	log(`flauz.res:   created: ${ref.createdAt}`);
	for (const record of surfaces) {
		log(`flauz.res:   surface ${describeSurface(record)}`);
	}
	for (const link of neighbors) {
		log(`flauz.res:   edge ${link.direction === 'out' ? '->' : '<-'} ${link.ref.id} (${link.edgeKind})`);
	}
	log(`flauz.res:   lineage: ${lineage.map(entry => entry.id).join(' <- ')}`);
	return { ref, surfaces, neighbors, lineage };
}

function commandGraph(arg: unknown): unknown {
	const dot = arg === 'dot' || arg === '--dot' || (typeof arg === 'object' && arg !== null && (arg as { dot?: unknown }).dot === true);
	const envelope = currentGraph().envelope();
	if (dot) {
		const text = toDot(envelope);
		log('flauz.res: graph (dot):');
		for (const line of text.split('\n')) {
			log(`flauz.res: ${line}`);
		}
		return text;
	}
	log(`flauz.res: graph (${envelope.nodes.length} nodes, ${envelope.edges.length} edges, ${envelope.surfaces.length} surface records):`);
	for (const line of JSON.stringify(envelope, null, 2).split('\n')) {
		log(`flauz.res: ${line}`);
	}
	return envelope;
}

async function commandVerify(folder: vscode.WorkspaceFolder): Promise<unknown> {
	const report = await verifyWorkspace(folder.uri.fsPath, vscodeFs);
	const ok = report.envelope.ok && (report.ops === undefined || report.ops.ok);
	log(`flauz.res: verify ${ok ? 'PASS' : 'FAIL'} (nodes ${report.envelope.nodes}, edges ${report.envelope.edges}, surfaces ${report.envelope.surfaces}${report.ops !== undefined ? `, ops ${report.ops.records}` : ''})`);
	if (report.opsNote !== undefined) {
		log(`flauz.res:   ops: ${report.opsNote}`);
	}
	for (const problem of report.envelope.problems) {
		log(`flauz.res:   problem [${problem.code}] ${problem.path}: ${problem.message}`);
	}
	if (report.ops !== undefined) {
		for (const problem of report.ops.problems) {
			log(`flauz.res:   ops problem [line ${problem.line}]: ${problem.message}`);
		}
	}
	return report;
}

/** The result the journal-sync command returns (typed, never a raw throw). */
export type SyncCommandResult =
	| { readonly ok: true; readonly report: SyncReport }
	| { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

/**
 * flauz.res.syncBrowserSessions — reconciles browser-session refs from the
 * PIN-1 journal (READ-ONLY consumption of .flauz/browser-sessions.jsonl).
 * Provenance at the command boundary: palette invocations default to actor
 * `human`; programmatic callers (agents/tools) pass `actor` explicitly. Edge
 * attribution is EXPLICIT only (bindEnvironmentRefId/bindTaskRefId name
 * existing graph refs — never fabricated from the active-environment guess).
 */
async function commandSyncBrowserSessions(arg: unknown): Promise<SyncCommandResult> {
	if (graph === undefined) {
		return { ok: false, error: { code: 'FLAUZ_RESOURCES_INACTIVE', message: 'flauz.res.syncBrowserSessions: graph inactive (no workspace folder or failed bootstrap)' } };
	}
	const record = typeof arg === 'object' && arg !== null ? (arg as { actor?: unknown; bindEnvironmentRefId?: unknown; bindTaskRefId?: unknown }) : {};
	if (record.actor !== undefined && (typeof record.actor !== 'string' || !['agent', 'human', 'tool'].includes(record.actor))) {
		return { ok: false, error: { code: 'FLAUZ_RESOURCES_PROVENANCE', message: `flauz.res.syncBrowserSessions: actor must be one of agent|human|tool (got ${JSON.stringify(record.actor)})` } };
	}
	for (const key of ['bindEnvironmentRefId', 'bindTaskRefId'] as const) {
		const value = record[key];
		if (value !== undefined && typeof value !== 'string') {
			return { ok: false, error: { code: 'FLAUZ_RESOURCES_SCHEMA', message: `flauz.res.syncBrowserSessions: ${key} must be a resource ref id string (explicit attribution names an existing graph ref)` } };
		}
	}
	try {
		const bridge = new BrowserSessionBridge({ graph });
		const report = await bridge.sync({
			provenance: {
				actor: (record.actor as 'agent' | 'human' | 'tool' | undefined) ?? 'human',
				cause: 'flauz.res.syncBrowserSessions (PIN-1 journal reconciliation)',
			},
			...(typeof record.bindEnvironmentRefId === 'string' ? { bindEnvironmentRefId: record.bindEnvironmentRefId } : {}),
			...(typeof record.bindTaskRefId === 'string' ? { bindTaskRefId: record.bindTaskRefId } : {}),
		});
		log(`flauz.res: browser-session sync: ${report.sessions} session(s) from ${report.journalRecords} journal record(s) — ${report.refsMinted.length} ref(s) minted, ${report.surfacesRefreshed.length} surface(s) refreshed, ${report.edgesMinted.length} edge(s) minted`);
		for (const skip of report.skippedJournalLines) {
			log(`flauz.res:   journal skip [line ${skip.line}]: ${skip.reason}`);
		}
		return { ok: true, report };
	} catch (err) {
		return { ok: false, error: { code: (err as { code?: unknown }).code && typeof (err as { code: string }).code === 'string' ? (err as { code: string }).code : 'FLAUZ_RESOURCES_SYNC', message: err instanceof Error ? err.message : String(err) } };
	}
}

export function deactivate(): void {
	graph = undefined;
}
