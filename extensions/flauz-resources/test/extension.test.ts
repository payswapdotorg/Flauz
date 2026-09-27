/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Extension wiring (src/extension.ts) under the fidelity-mapped vscode mock:
 * activation bootstraps the graph (empty workspace -> created; broken file ->
 * fail-closed error message + inactive commands), registers the four
 * flauz.res.* commands, and the commands behave observably (log lines +
 * return values) through the vscode.workspace.fs-backed port.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWithVscodeMock } from './harness/vscode-redirect.ts';
import { __configure, __reset, __state } from './harness/vscode-mock-module.ts';
import type { MockVscodeState } from './harness/vscode-mock.ts';

interface ExtensionModule {
	activate(context: { subscriptions: Array<{ dispose(): void }> }): Promise<void>;
	deactivate(): void;
}

async function bootExtension(): Promise<ExtensionModule> {
	return importWithVscodeMock<ExtensionModule>(new URL('../src/extension.ts', import.meta.url));
}

function channelLines(state: MockVscodeState): string[] {
	const channel = state.outputChannels.find(c => c.name === 'Flauz Resources');
	return channel === undefined ? [] : channel.lines;
}

function commandHandler(name: string): (...args: unknown[]) => unknown {
	const record = __state().commands.find(c => c.command === name);
	assert.ok(record !== undefined, `command '${name}' must be registered`);
	return record.handler;
}

function seededGraphText(): string {
	return JSON.stringify({
		$schema: 'flauz.resources/v0',
		nodes: [
			{
				schemaVersion: 0,
				kind: 'browser-session',
				id: 'flauz:browser:9c8d7e6f5a4b3c2d',
				displayName: 'login flow session',
				provenance: { actor: 'agent', actorId: 'flauz-agent' },
				createdAt: 1730000000000,
			},
			{
				schemaVersion: 0,
				kind: 'environment',
				id: 'flauz:environment:env-staging',
				displayName: 'Staging container',
				provenance: { actor: 'human', actorId: 'user-1' },
				createdAt: 1730000001000,
			},
		],
		edges: [
			{
				kind: 'bound-to',
				from: 'flauz:browser:9c8d7e6f5a4b3c2d',
				to: 'flauz:environment:env-staging',
				provenance: { actor: 'agent' },
				createdAt: 1730000002000,
			},
		],
		surfaces: [
			{
				refId: 'flauz:browser:9c8d7e6f5a4b3c2d',
				family: 'browser',
				versions: [
					{
						surface: { kind: 'browser', cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc', partition: 'persist:flauz-0123456789abcdef' },
						provenance: { actor: 'agent' },
						updatedAt: 1730000003000,
					},
				],
			},
			{
				refId: 'flauz:environment:env-staging',
				family: 'environment',
				versions: [
					{
						surface: { kind: 'environment', descriptorId: 'env-staging', providerKind: 'container' },
						provenance: { actor: 'human' },
						updatedAt: 1730000003000,
					},
				],
			},
		],
	}, null, 2) + '\n';
}

async function freshActivate(fsFiles?: Map<string, string>): Promise<ExtensionModule> {
	__reset();
	if (fsFiles !== undefined) {
		__configure({ fsFiles });
	}
	const extension = await bootExtension();
	await extension.activate({ subscriptions: [] });
	return extension;
}

test('activation with an empty workspace creates .flauz/resources.json + the ops ledger and logs the active line', async () => {
	const extension = await freshActivate();
	const state = __state();
	assert.ok(state.createdDirectories.some(p => p === '/ws/acme/.flauz'), '.flauz created');
	const graphFile = state.fsFiles.get('/ws/acme/.flauz/resources.json');
	assert.ok(graphFile !== undefined, 'graph file created');
	assert.equal(graphFile, '{\n  "$schema": "flauz.resources/v0",\n  "edges": [],\n  "nodes": [],\n  "surfaces": []\n}\n');
	assert.ok(state.fsFiles.has('/ws/acme/.flauz/resources-ops.jsonl'), 'ops ledger created');
	assert.ok(channelLines(state).some(l => l.includes('flauz.res: graph active (.flauz/resources.json; 0 ref(s))')));
	void extension.deactivate();
});

test('activation registers exactly the four flauz.res.* commands', async () => {
	const extension = await freshActivate();
	const names = __state().commands.map(c => c.command);
	assert.deepEqual(names.sort(), [
		'flauz.res.graph',
		'flauz.res.list',
		'flauz.res.show',
		'flauz.res.verify',
	].sort());
	void extension.deactivate();
});

test('activation without a workspace folder degrades gracefully (warning, no commands)', async () => {
	__reset({ workspaceFolders: undefined });
	const extension = await bootExtension();
	await extension.activate({ subscriptions: [] });
	const state = __state();
	assert.ok(state.messages.some(m => m.level === 'warn' && m.text.includes('no workspace folder open')));
	assert.equal(state.commands.length, 0);
	void extension.deactivate();
});

test('activation with a BROKEN graph file is fail-closed: error message, no command surface, no reset', async () => {
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', '{"$schema": "flauz.resources/v0", "nodes": 42}']]));
	const state = __state();
	assert.ok(state.messages.some(m => m.level === 'error' && m.text.includes('failed to bootstrap .flauz/resources.json')), 'error surfaced');
	assert.equal(state.commands.length, 0, 'no commands registered while the graph is broken');
	// the broken file is never overwritten by activation
	assert.equal(state.fsFiles.get('/ws/acme/.flauz/resources.json'), '{"$schema": "flauz.resources/v0", "nodes": 42}');
	void extension.deactivate();
});

test('flauz.res.list: all refs, kind filter, and a typed error for unknown kinds', async () => {
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', seededGraphText()]]));
	const all = commandHandler('flauz.res.list')() as Array<{ id: string }>;
	assert.equal(all.length, 2);
	const filtered = commandHandler('flauz.res.list')('environment') as Array<{ id: string }>;
	assert.deepEqual(filtered.map(r => r.id), ['flauz:environment:env-staging']);
	const viaObject = commandHandler('flauz.res.list')({ kind: 'browser-session' }) as Array<{ id: string }>;
	assert.deepEqual(viaObject.map(r => r.id), ['flauz:browser:9c8d7e6f5a4b3c2d']);
	assert.throws(() => commandHandler('flauz.res.list')('database'), /expected a resource kind/);
	assert.ok(channelLines(__state()).some(l => l.includes('flauz.res: flauz:environment:env-staging -- Staging container (environment,')));
	void extension.deactivate();
});

test('flauz.res.show: ref + surfaces + edges + lineage', async () => {
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', seededGraphText()]]));
	const result = await (commandHandler('flauz.res.show')('flauz:browser:9c8d7e6f5a4b3c2d') as Promise<{
		ref: { id: string };
		surfaces: Array<{ family: string; versions: unknown[] }>;
		neighbors: Array<{ ref: { id: string }; edgeKind: string; direction: string }>;
		lineage: Array<{ id: string }>;
	}>);
	assert.equal(result.ref.id, 'flauz:browser:9c8d7e6f5a4b3c2d');
	assert.equal(result.surfaces.length, 1);
	assert.equal(result.surfaces[0]?.family, 'browser');
	assert.deepEqual(result.neighbors.map(n => ({ id: n.ref.id, kind: n.edgeKind, dir: n.direction })), [
		{ id: 'flauz:environment:env-staging', kind: 'bound-to', dir: 'out' },
	]);
	assert.deepEqual(result.lineage.map(r => r.id), ['flauz:browser:9c8d7e6f5a4b3c2d']);
	await assert.rejects(() => commandHandler('flauz.res.show')('flauz:file:0000000000000000') as Promise<unknown>, /unknown ref/);
	await assert.rejects(() => commandHandler('flauz.res.show')() as Promise<unknown>, /expected the resource ref id/);
	const lines = channelLines(__state());
	assert.ok(lines.some(l => l.includes('surface browser: {"cdpEndpoint"')));
	assert.ok(lines.some(l => l.includes('edge -> flauz:environment:env-staging (bound-to)')));
	void extension.deactivate();
});

test('flauz.res.graph: JSON dump by default, --dot rendering on request', async () => {
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', seededGraphText()]]));
	const envelope = commandHandler('flauz.res.graph')() as { nodes: unknown[]; edges: unknown[] };
	assert.equal(envelope.nodes.length, 2);
	assert.equal(envelope.edges.length, 1);
	const dot = commandHandler('flauz.res.graph')('dot') as string;
	assert.match(dot, /^digraph flauz_resources \{/);
	assert.match(dot, /"flauz:browser:9c8d7e6f5a4b3c2d" -> "flauz:environment:env-staging" \[label="bound-to"\];/);
	const dotViaObject = commandHandler('flauz.res.graph')({ dot: true }) as string;
	assert.match(dotViaObject, /digraph flauz_resources/);
	const lines = channelLines(__state());
	assert.ok(lines.some(l => l.includes('flauz.res: graph (2 nodes, 1 edges, 2 surface records):')));
	assert.ok(lines.some(l => l.includes('flauz.res: graph (dot):')));
	void extension.deactivate();
});

test('flauz.res.verify: PASS receipt on a clean seeded graph, FAIL with problems on a tampered one', async () => {
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', seededGraphText()]]));
	const pass = await (commandHandler('flauz.res.verify')() as Promise<{ envelope: { ok: boolean }; ops?: { ok: boolean } }>);
	assert.equal(pass.envelope.ok, true);
	assert.ok(channelLines(__state()).some(l => l.includes('flauz.res: verify PASS')));
	// note path: seeded graph has no ops ledger
	assert.ok(channelLines(__state()).some(l => l.includes('no ops ledger present')));

	// tamper: orphan surface -- the strict loader refuses the file, and the
	// verify command reports the parse problem (fail-closed, with the defect named)
	const tampered = JSON.parse(seededGraphText()) as { surfaces: unknown[] };
	tampered.surfaces.push({ refId: 'flauz:file:ffffffffffffffff', family: 'workspace', versions: [{ surface: { kind: 'workspace', root: '/w' }, provenance: { actor: 'human' }, updatedAt: 1 }] });
	__state().fsFiles.set('/ws/acme/.flauz/resources.json', JSON.stringify(tampered, null, 2) + '\n');
	const fail = await (commandHandler('flauz.res.verify')() as Promise<{ envelope: { ok: boolean; problems: Array<{ code: string; message: string }> } }>);
	assert.equal(fail.envelope.ok, false);
	assert.ok(fail.envelope.problems.some(p => p.code === 'bad-schema' && /surface bound to unknown ref/.test(p.message)));
	assert.ok(channelLines(__state()).some(l => l.includes('flauz.res: verify FAIL')));
	assert.ok(channelLines(__state()).some(l => l.includes('problem [bad-schema]')));
	void extension.deactivate();
});

test('the FileSystemPort write path goes through workspace.fs with atomic tmp+rename', async () => {
	// empty workspace: the graph is CREATED through tmp+rename (atomic), then the ops ledger
	const extension = await freshActivate();
	const state = __state();
	assert.ok(state.writtenFiles.some(w => w.path === '/ws/acme/.flauz/resources.json.tmp'));
	assert.ok(state.renamedFiles.some(r => r.from === '/ws/acme/.flauz/resources.json.tmp' && r.to === '/ws/acme/.flauz/resources.json'));
	assert.ok(state.writtenFiles.some(w => w.path === '/ws/acme/.flauz/resources-ops.jsonl'));
	void extension.deactivate();
});

test('a seeded graph file is loaded, never rewritten by activation (no clobber)', async () => {
	const seeded = seededGraphText();
	const extension = await freshActivate(new Map<string, string>([['/ws/acme/.flauz/resources.json', seeded]]));
	const state = __state();
	assert.ok(!state.writtenFiles.some(w => w.path === '/ws/acme/.flauz/resources.json'), 'the seeded graph is not rewritten');
	assert.ok(!state.renamedFiles.some(r => r.to === '/ws/acme/.flauz/resources.json'), 'no rename over the seeded file');
	assert.equal(state.fsFiles.get('/ws/acme/.flauz/resources.json'), seeded);
	assert.ok(channelLines(state).some(l => l.includes('flauz.res: graph active (.flauz/resources.json; 2 ref(s))')));
	void extension.deactivate();
});
