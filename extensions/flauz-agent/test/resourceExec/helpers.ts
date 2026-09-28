/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared helpers for the resourceExec test suites: the in-memory
 * FileSystemPort, deterministic clocks, state builders (PIN-1 journal,
 * registry + PIN-2 pair, resources graph, continuity bundle) and the lease
 * environment boot. Zero dependencies (Node >= 23.6 type stripping; the
 * flauz-agent shims are the typecheck surface -- only their declared node
 * API is used).
 */
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, sha256Hex, type FileSystemPort, type LeaseProvenance } from '../../src/resourceExec/types.ts';
import { TaskLeaseBook, type LeaseEnv, type TaskResourceLedgerPort } from '../../src/resourceExec/contracts.ts';
import { TaskResourceLedger } from '../../src/resourceExec/store.ts';

export const FIXED_TS = 1730001000000;

export function fixedClock(): () => number {
	return () => FIXED_TS;
}

/** Advances by 1000 on every call -- deterministic but distinguishable timestamps. */
export function steppingClock(start = 1730001000000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

export const AGENT: LeaseProvenance = { actor: 'agent', actorId: 'flauz-agent' };
export const HUMAN: LeaseProvenance = { actor: 'human', actorId: 'user-1' };
export const TOOL: LeaseProvenance = { actor: 'tool', actorId: 'flauz-verify' };

// ---------------------------------------------------------------------------
// The in-memory FileSystemPort
// ---------------------------------------------------------------------------

export interface MemoryFs {
	readonly port: FileSystemPort;
	readonly files: Map<string, string>;
}

export function memoryFs(seed?: Record<string, string>): MemoryFs {
	const files = new Map<string, string>(Object.entries(seed ?? {}));
	const port: FileSystemPort = {
		readFileUtf8: async target => files.get(target),
		writeFile: async (target, contents) => {
			files.set(target, contents);
		},
		rename: async (from, to) => {
			if (!files.has(from)) {
				throw new Error(`ENOENT: ${from}`);
			}
			files.set(to, files.get(from)!);
			files.delete(from);
		},
		mkdir: async () => {
			// directories are implicit in the in-memory port
		},
	};
	return { port, files };
}

/** A port whose writeFile fails ONCE (fail-closed ledger write injection). */
export function failingWriteOnce(inner: FileSystemPort): FileSystemPort {
	let failed = false;
	return {
		readFileUtf8: inner.readFileUtf8,
		rename: inner.rename,
		mkdir: inner.mkdir,
		writeFile: async (target, contents) => {
			if (!failed) {
				failed = true;
				throw new Error('injected write failure (EIO)');
			}
			return await inner.writeFile(target, contents);
		},
	};
}

// ---------------------------------------------------------------------------
// State builders (canonical bytes via the module's own canonicalJson)
// ---------------------------------------------------------------------------

export function jsonlLine(record: Record<string, unknown>): string {
	return canonicalJson(record);
}

export interface JournalLineInput {
	ts: number;
	actor: 'agent' | 'human' | 'tool';
	event: 'opened' | 'state-changed' | 'closed' | 'failed';
	sessionId: string;
	initiator: 'agent' | 'human';
	partition: string;
	state: string;
	tabs?: readonly string[];
	agentId?: string;
}

export function browserJournalLine(input: JournalLineInput): string {
	return jsonlLine({
		actor: input.actor,
		descriptor: {
			...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
			createdAt: '2026-10-27T10:00:00.000Z',
			initiator: input.initiator,
			partition: input.partition,
			policySourceRef: 'flauz:browser-policy/v0@workspace-file#0123456789abcdef',
			schemaVersion: 0,
			sessionId: input.sessionId,
			state: input.state,
			tabs: (input.tabs ?? ['flauz:tab:0000000000000001']).map(tabId => ({ openedAt: '2026-10-27T10:00:00.000Z', state: 'active', tabId, targetId: 'fixture-target-1', url: 'about:blank' })),
		},
		event: input.event,
		schema: 'flauz.browser-session-journal/v0',
		schemaVersion: 0,
		ts: input.ts,
	});
}

export const AGENT_SESSION = 'flauz:browser:0123456789abcdef';
export const HUMAN_SESSION = 'flauz:browser:fedcba9876543210';

export function goodJournal(): string {
	return [
		browserJournalLine({ ts: 1730000100000, actor: 'agent', event: 'opened', sessionId: AGENT_SESSION, initiator: 'agent', partition: 'persist:flauz-0123456789abcdef-worker-1', state: 'active', agentId: 'worker-1' }),
		browserJournalLine({ ts: 1730000110000, actor: 'human', event: 'opened', sessionId: HUMAN_SESSION, initiator: 'human', partition: 'persist:flauz-0123456789abcdef', state: 'active' }),
	].join('\n') + '\n';
}

export interface EnvEntryInput {
	id: string;
	kind: 'ssh-local' | 'container' | 'cloud-sandbox' | 'workspace-remote';
	posture: 'trusted' | 'untrusted' | 'unknown';
	enabled?: boolean;
}

export function environmentsRegistry(entries: readonly EnvEntryInput[], activeId: string | null = null): string {
	return JSON.stringify({
		$schema: 'flauz.environments/v0',
		activeId,
		environments: entries.map(entry => ({
			id: entry.id,
			kind: entry.kind,
			label: `Label ${entry.id}`,
			connection: { workspaceFolder: `/work/${entry.id}`, name: entry.id },
			trust: { posture: entry.posture, inheritsWorkspaceTrust: false },
			capabilities: { browser: false, exec: true, agentHost: true, terminal: true },
			enabled: entry.enabled ?? true,
			timing: { created: 1730000000000, updatedAt: 1730000060000 },
		})),
	}, null, '\t') + '\n';
}

export function lifecycleEnvelope(entries: Record<string, { state: string; updatedAt: number; executorKind?: string; lastOpRef?: number }>): string {
	const built: Record<string, { state: string; updatedAt: number; executorKind: string; lastOpRef: number }> = {};
	for (const [id, entry] of Object.entries(entries)) {
		built[id] = { state: entry.state, updatedAt: entry.updatedAt, executorKind: entry.executorKind ?? 'local-process', lastOpRef: entry.lastOpRef ?? 1 };
	}
	return JSON.stringify({ schemaVersion: 0, schema: 'flauz.environments-lifecycle/v0', updatedAt: 1730000063000, entries: built }, null, '\t') + '\n';
}

export function envOpsLine(ts: number, actor: 'agent' | 'human' | 'tool', op: string, environmentId: string, fromState: string, toState: string): string {
	return jsonlLine({ actor, environmentId, fromState, op, result: 'ok', schema: 'flauz.environments-ops/v0', schemaVersion: 0, toState, ts });
}

export const FILE_REF = 'flauz:file:0123456789abcdef';

export function resourcesGraph(options: { fileRef?: boolean; fileSurfaceFamily?: 'file-system' | 'model' } = {}): string {
	const includeFile = options.fileRef ?? true;
	const family = options.fileSurfaceFamily ?? 'file-system';
	const surface = family === 'file-system'
		? { kind: 'file-system', root: 'workspace', path: 'notes.md' }
		: { kind: 'model', providerId: 'fixture-provider', modelId: 'fixture-model' };
	return JSON.stringify({
		$schema: 'flauz.resources/v0',
		nodes: [
			{ schemaVersion: 0, kind: 'task', id: 'flauz:task:T-001', provenance: AGENT, createdAt: 1730000050000 },
			...(includeFile ? [{ schemaVersion: 0, kind: 'file', id: FILE_REF, displayName: 'notes.md', provenance: AGENT, createdAt: 1730000051000 }] : []),
		],
		edges: [],
		surfaces: includeFile ? [{ refId: FILE_REF, family, versions: [{ surface, provenance: AGENT, updatedAt: 1730000053000 }] }] : [],
	}, null, '\t') + '\n';
}

// ---------------------------------------------------------------------------
// The continuity bundle builder (in-memory; real sha256 over the artifacts)
// ---------------------------------------------------------------------------

export const BUNDLE_ID = 'flauz:continuity:0123456789abcdef';

export interface BundleBuildOptions {
	readonly bundleId?: string;
	readonly carried?: Readonly<Record<string, string>>;
	readonly extraRedacted?: readonly { id: string; sha256: string }[];
	readonly omitSurface?: string;
	readonly tamperCarriedSha?: { id: string; sha: string };
}

/** Builds a full 22-surface continuity bundle as an in-memory file map. */
export function continuityBundle(options: BundleBuildOptions = {}): Record<string, string> {
	const bundleId = options.bundleId ?? BUNDLE_ID;
	const files: Record<string, string> = {};
	const surfaces: Record<string, Record<string, unknown>> = {};
	const carriedDefaults: Record<string, string> = {
		'flauz-tasks-envelope': JSON.stringify({ $schema: 'flauz.tasks/v0', tasks: [] }),
		'flauz-environments-registry': JSON.stringify({ $schema: 'flauz.environments/v0', activeId: null, environments: [] }),
		'flauz-environments-lifecycle': JSON.stringify({ schemaVersion: 0, schema: 'flauz.environments-lifecycle/v0', updatedAt: 1730000063000, entries: {} }),
		'flauz-environments-ops': 'create ok\nstart ok',
		'flauz-resources-graph': JSON.stringify({ $schema: 'flauz.resources/v0', nodes: [], edges: [], surfaces: [] }),
		'flauz-resources-ops': JSON.stringify({ note: 'fixture ops ledger carried' }),
	};
	const carried = { ...carriedDefaults, ...(options.carried ?? {}) };
	for (const [id, contents] of Object.entries(carried)) {
		const artifactPath = `surfaces/${id}.json`;
		files[`.flauz/continuity-bundles/${bundleId}/${artifactPath}`] = contents;
		surfaces[id] = { status: 'carried', artifactPath, sha256: options.tamperCarriedSha?.id === id ? options.tamperCarriedSha.sha : sha256Hex(contents), bytes: contents.length, note: 'carried from the fixture workspace' };
	}
	const redactedDefaults = [
		{ id: 'flauz-evidence-ledger', path: '.flauz/evidence/ledger.jsonl' },
		{ id: 'flauz-evidence-artifacts', path: '.flauz/artifacts' },
		{ id: 'flauz-browser-session-journal', path: '.flauz/browser-sessions.jsonl' },
	];
	for (const entry of redactedDefaults) {
		surfaces[entry.id] = { status: 'redacted', sha256: sha256Hex(entry.path), note: 'secret-shaped surface: presence + sha256 of the path recorded; the payload is never copied into a continuity bundle (the secret-redaction law)' };
	}
	for (const extra of options.extraRedacted ?? []) {
		surfaces[extra.id] = { status: 'redacted', sha256: extra.sha256, note: 'presence + path hash' };
	}
	const lost: Readonly<Record<string, string>> = {
		'scm-working-tree': 'rides the SCM substrate',
		'chat-sessions': 'natively re-hydrated by the sessions infra',
		'chat-editing-checkpoints': 'natively re-hydrated by the chat editing infra',
		'edit-sessions': 'natively re-hydrated by the edit-sessions infra',
		'agent-sessions': 'AHP server-side',
		'flauz-task-state-machine': 're-hydrates from the carried tasks envelope',
		'persisted-approvals': 'AHP session-permission entries',
		'terminal-scrollback': 'renderer-local -- lost by design (N-8)',
		'browser-pane-state': 'live CDP state is renderer-local -- lost by design (N-8)',
		'inflight-chat-streams': 'lost by design (N-8)',
		'window-layout': 'machine-local -- lost by design (N-8)',
		'resolver-connection-state': 're-established by resolve()',
		'flauz-workflow-state': 'no file materialized this surface at export time (typed lost, never fabricated)',
	};
	for (const [id, note] of Object.entries(lost)) {
		surfaces[id] = { status: 'lost', note };
	}
	if (options.omitSurface !== undefined) {
		delete surfaces[options.omitSurface];
	}
	files[`.flauz/continuity-bundles/${bundleId}/manifest.json`] = JSON.stringify({
		schemaVersion: 0,
		schema: 'flauz.continuity-bundle/v0',
		bundleId,
		createdAt: 1730000300000,
		actor: 'human',
		sourceEnvironmentId: 'env-build-agent',
		switchPlanRef: 'flauz.switchPlan/v0:env-build-agent@1730000290000',
		surfaces,
	}, null, '\t') + '\n';
	return files;
}

export function continuityOpsOk(bundleId: string): string {
	return [
		jsonlLine({ schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1730000300000, actor: 'human', op: 'export', bundleId, result: 'ok', details: { fromEnvironmentId: 'env-build-agent', surfacesCarried: 2, surfacesLost: 14, surfacesRedacted: 3 } }),
		jsonlLine({ schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1730000310000, actor: 'tool', op: 'verify', bundleId, result: 'ok', details: { fromEnvironmentId: 'env-build-agent', surfacesCarried: 2, surfacesLost: 14, surfacesRedacted: 3 } }),
	].join('\n') + '\n';
}

export function continuityOpsFailedVerify(bundleId: string): string {
	return jsonlLine({ schemaVersion: 0, schema: 'flauz.continuity-ops/v0', ts: 1730000310000, actor: 'tool', op: 'verify', bundleId, result: 'error', error: { code: 'VERIFY_FAILED', message: 'fixture failed verify' } }) + '\n';
}

// ---------------------------------------------------------------------------
// The lease environment boot
// ---------------------------------------------------------------------------

/** Deterministic lease-id factory (0000000000000001, 0000000000000002, ...). */
export function counterMintIds(start = 1): () => string {
	let current = start;
	return () => {
		const id = `flauz:lease:${String(current).padStart(16, '0')}`;
		current += 1;
		return id;
	};
}

export interface BootedLeaseEnv {
	readonly env: LeaseEnv;
	readonly ledger: TaskResourceLedger;
	readonly book: TaskLeaseBook;
}

/** Boots a ledger + book over the given fs (crash-recovery semantics: the ledger is the truth). */
export async function bootLeaseEnv(fs: FileSystemPort, clock: () => number, root = 'workspace', mintStart = 1): Promise<BootedLeaseEnv> {
	const ledger = new TaskResourceLedger({ root, fs, clock });
	await ledger.bootstrap();
	const rebuilt = await ledger.rebuildBook();
	if (!rebuilt.ok) {
		throw new Error(`boot: ledger failed verification: ${JSON.stringify(rebuilt.problems)}`);
	}
	return { env: { book: rebuilt.book, ledger: ledger as unknown as TaskResourceLedgerPort, clock, mintLeaseId: counterMintIds(mintStart) }, ledger, book: rebuilt.book };
}

// ---------------------------------------------------------------------------
// Repo-root fixture access (READ-ONLY; the flauz-agent shim surface only)
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

export function fixturePath(...segments: readonly string[]): string {
	return path.join(REPO_ROOT, 'test', 'fixtures', 'task-resources', ...segments);
}

export function readFixture(...segments: readonly string[]): string {
	return fsSync.readFileSync(fixturePath(...segments), 'utf-8');
}

export function listFixtureFiles(...segments: readonly string[]): string[] {
	return fsSync.readdirSync(fixturePath(...segments)).filter(name => fsSync.statSync(fixturePath(...segments, name)).isFile()).sort();
}

/**
 * Assembles a secret-shaped string from fragments at RUNTIME (no complete
 * secret shape ever appears in this repository's source or fixtures). Used
 * only to prove the no-flattening law's schema-level rejection.
 */
export function runtimeSecretFixture(kind: 'github-pat' | 'api-key' | 'jwt'): string {
	switch (kind) {
		case 'github-pat':
			return ['ghp_', 'Flauz', 'Fixture', 'Only', '0000', '1111', '2222', '3333'].join('');
		case 'api-key':
			return ['sk-', 'flauz-fixture-', 'aaaa', 'bbbb', 'cccc', 'dddd'].join('');
		case 'jwt':
			return ['eyJhbGciOiJIUzI1NiJ9.eyJmbGF1eiI6Zml4dHVyZX0.', 'aaaa', 'bbbb', 'cccc', 'dddd', 'eeee'].join('');
	}
}
