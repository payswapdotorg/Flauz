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
 *        flauz.res.list    list refs (optionally filtered by kind)
 *        flauz.res.show    ref + surfaces + edges + lineage
 *        flauz.res.graph   JSON dump of the envelope (or a --dot rendering)
 *        flauz.res.verify  schema + integrity + provenance verification
 *
 * The FileSystemPort binds vscode.workspace.fs (readFile/writeFile/
 * createDirectory/rename all exist on the stable API; appendFile is a
 * read-concat-write -- the ops ledger is small and workspace-local). This is
 * what lets src/extension.ts stay fully mock-testable under the copied
 * flauz-browser harness discipline (test/harness/).
 *
 * v0 boundary: no mutation commands are exposed on the palette (every
 * mutation requires fail-closed provenance; the library surface --
 * ResourceGraph/ContinuityService -- is what the Agent OS integration and
 * tests drive). See INTEGRATION-GAP.md for the Wave-next wiring.
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
		await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(current + contents));
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

export function deactivate(): void {
	graph = undefined;
}
