/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture-workspace + fixture-product boot for the flauz-release
 * suite (A-PROD-004-W5).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces are constructed by
 * driving the REAL owning services (test-time cross-extension imports are
 * the sanctioned session-battery pattern; src never crosses boundaries):
 *
 *   - TaskService + EvidenceLedger     (extensions/flauz-workspace)
 *   - ResourceGraph + ProvenanceLedger (extensions/flauz-resources)
 *   - OrchestrationStore               (extensions/flauz-agent core)
 *   - FileSystemSessionJournal         (extensions/flauz-browser)
 *   - switchProviderLane + ModelRouter (extensions/flauz-models)
 *   - WorkflowService                  (extensions/flauz-workflow)
 *
 * The environments registry is seeded from the shared contract fixture
 * (test/fixtures/resources/contracts/environments-registry.json) -- the same
 * pin the flauz-resources contract tests, the flauz-diagnostics suite and
 * the flauz-backup/flauz-migration suites use. The shape mirrors the W1/W2
 * helpers verbatim (the same durable state, the same cross-worker pins).
 *
 * The FIXTURE PRODUCT STATES (this wave's own fixture class) construct
 * repo-state products: the `extensions/flauz-<name>` manifests + the
 * packaging-parity registry + the SBOM, with injectable defects (the
 * install-verification check-class fixtures). The REAL repo root is also a
 * product state -- the strongest local-real receipt (the live 14-extension
 * product with this wave's rows).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

import type { FileSystemPort } from '../../flauz-workspace/src/api.ts';
import { TaskService } from '../../flauz-workspace/src/taskService.ts';
import { EvidenceLedger } from '../../flauz-workspace/src/ledger.ts';
import { ResourceGraph } from '../../flauz-resources/src/graph.ts';
import { ProvenanceLedger } from '../../flauz-resources/src/provenance.ts';
import { OrchestrationStore } from '../../flauz-agent/core/orchStore.mjs';
import { FileSystemSessionJournal, buildSessionJournalRecord } from '../../flauz-browser/src/runtime/journal.ts';
import { switchProviderLane } from '../../flauz-models/src/routing/switch.ts';
import { ROUTING_POLICY_SCHEMA_ID, type RoutingPolicyFile } from '../../flauz-models/src/routing/policy.ts';
import type { ProviderOverride } from '../../flauz-models/src/discovery/configs.ts';
import type { FileSystemPort as ModelsFsPort, HashPort } from '../../flauz-models/src/contract/ports.ts';
import { WorkflowService } from '../../flauz-workflow/src/envelope.ts';

import type { ReleaseFsPort, Clock } from '../src/api.ts';
import { toIsoStamp } from '../src/format.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const ENVIRONMENTS_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'resources', 'contracts', 'environments-registry.json');

/** The real repo root (the live repo-state product -- the local-real receipt's subject). */
export const repoRoot = REPO_ROOT;

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_000_000_000): () => number {
        let current = start;
        return () => {
                const value = current;
                current += 1000;
                return value;
        };
}

/** The flauz-workspace FileSystemPort over node:fs (the extension-host wiring). */
export function nodeWorkspaceFs(): FileSystemPort {
        return {
                readFileUtf8: async target => {
                        try {
                                return await fs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
                rename: (from, to) => fs.rename(from, to),
                mkdir: target => fs.mkdir(target, { recursive: true }),
        };
}

/** The flauz-release ReleaseFsPort over node:fs (the extension-host wiring). */
export function nodeReleaseFs(): ReleaseFsPort {
        return {
                readFileUtf8: async target => {
                        try {
                                return await fs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                readdir: async target => {
                        try {
                                return await fs.readdir(target);
                        } catch (err) {
                                // Unlistable = missing (ENOENT) OR a non-directory (ENOTDIR):
                                // undefined in both cases (the ReleaseFsPort.readdir contract).
                                const code = (err as { code?: string }).code;
                                if (code === 'ENOENT' || code === 'ENOTDIR') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                mkdir: target => fs.mkdir(target, { recursive: true }),
                writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
                appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
        };
}

/** The models HashPort over node:crypto (the production wiring). */
export const nodeHashPort: HashPort = {
        sha256Hex: input => createHash('sha256').update(input, 'utf8').digest('hex'),
};

/** A models FileSystemPort bound to a fixed root (the makeTempFs shape, workspace-bound). */
function modelsFsPort(): ModelsFsPort {
        return {
                readFileUtf8: async target => {
                        try {
                                return await fs.readFile(target, { encoding: 'utf-8' });
                        } catch (err) {
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                writeFile: async (target, contents) => {
                        await fs.mkdir(path.dirname(target), { recursive: true });
                        await fs.writeFile(target, contents, { encoding: 'utf-8' });
                },
                rename: async (from, to) => fs.rename(from, to),
                mkdir: async target => {
                        await fs.mkdir(target, { recursive: true });
                },
        };
}

export interface FixtureWorkspace {
        readonly root: string;
        readonly fs: ReleaseFsPort;
        readonly clock: Clock;
        readonly tasks: TaskService;
        readonly ledger: EvidenceLedger;
        readonly graph: ResourceGraph;
        readonly ops: ProvenanceLedger;
        readonly orchestration: OrchestrationStore;
        readonly browserJournal: FileSystemSessionJournal;
        readonly workflows: WorkflowService;
        cleanup(): Promise<void>;
}

export interface FixtureOptions {
        readonly clock?: () => number;
        /** Free-form payload fields to plant in durable state (the canary sweep's delivery vehicle). */
        readonly canaries?: readonly string[];
        /** The parent dir to boot the fixture workspace under (default: the OS tempdir). */
        readonly rootDir?: string;
}

/**
 * Boots a REAL `.flauz/` workspace: every artifact class constructed through
 * its owning service, then handed to the release surface under test.
 */
export async function bootFixtureWorkspace(options: FixtureOptions = {}): Promise<FixtureWorkspace> {
        const root = await fs.mkdtemp(path.join(options.rootDir ?? os.tmpdir(), options.rootDir !== undefined ? 'wk-' : 'flauz-release-'));
        const workspaceFs = nodeWorkspaceFs();
        const releaseFs = nodeReleaseFs();
        const clock = options.clock ?? steppingClock();
        const canaries = options.canaries ?? [];

        // --- flauz-workspace: the task envelope + the evidence ledger ---
        const tasks = new TaskService({ root, fs: workspaceFs, clock });
        await tasks.bootstrap();
        await tasks.createTask('Verify the installed product state');
        await tasks.createTask('Ship the release checklist');
        const first = await tasks.getTask('T-001');
        await tasks.appendEvent(first.id, {
                ts: clock(),
                actor: 'agent',
                type: 'custom-note',
                ...(canaries[0] !== undefined ? { payload: { note: canaries[0] } } : { payload: { note: 'ordinary note' } }),
        });

        const ledger = new EvidenceLedger({ root, fs: workspaceFs, clock });
        await ledger.ensure();
        const artifactSha = '5d41402abc4b2a76b9719d911017c592a8c8bbf84e34c1e9d70e2f3d2e1f0c3a';
        await ledger.append('T-001', { kind: 'command-output', uri: '.flauz/artifacts/T-001/out.txt', sha256: artifactSha });
        await ledger.append('T-001', { kind: 'note', uri: '.flauz/artifacts/T-001/note.txt', sha256: artifactSha });

        // --- flauz-resources: the resource graph + the ops chain ---
        const graph = new ResourceGraph({ root, fs: workspaceFs, clock });
        await graph.bootstrap();
        const TOOL = { actor: 'tool' as const };
        const provenance = { actor: 'human' as const, actorId: 'test-driver' };
        const taskRef = await graph.addRef({ kind: 'task', id: 'flauz:task:T-001', provenance });
        await graph.addSurface(taskRef.id, { kind: 'task', envelopePath: '.flauz/tasks.json', taskId: 'T-001' }, TOOL);
        const artifactRef = await graph.addRef({ kind: 'artifact', id: 'flauz:artifact:0123456789abcdef', provenance });
        await graph.addSurface(artifactRef.id, { kind: 'artifact', uri: '.flauz/artifacts/T-001/out.txt', sha256: artifactSha }, TOOL);
        await graph.addEdge({ kind: 'produced', from: taskRef.id, to: artifactRef.id }, provenance);
        const ops = new ProvenanceLedger({ root, fs: workspaceFs, clock });

        // --- flauz-agent: the orchestration store (execution journal) ---
        const orchestration = new OrchestrationStore(root, { clock });
        const submitted = await orchestration.submitGraph({
                title: 'the release fixture graph',
                steps: [
                        { stepId: 'S-01', title: 'Probe the durable state', instruction: 'read the .flauz census surfaces' },
                        { stepId: 'S-02', title: 'Emit the checklist', instruction: 'run the ten-row go/no-go' },
                ],
                actor: 'agent',
                taskId: 'T-001',
        });
        await orchestration.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:flauz-release' });
        await orchestration.startStep({ graphId: submitted.graphId, stepId: 'S-01', actor: 'agent', origin: 'test:flauz-release', runnerId: 'release-runner' });
        await orchestration.finishStep({
                graphId: submitted.graphId,
                stepId: 'S-01',
                outcome: 'succeeded',
                actor: 'agent',
                origin: 'test:flauz-release',
                evidence: [],
                ...(canaries[1] !== undefined ? { output: canaries[1] } : { output: 'ordinary step output' }),
        });

        // --- flauz-browser: the session journal ---
        const browserJournal = new FileSystemSessionJournal(root);
        // the full descriptor shape the journal builder validates (seeded with the
        // shared contract fixture's pinned session id -- the cross-worker pin)
        const pinnedDescriptor = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'test', 'fixtures', 'resources', 'contracts', 'browser-session-descriptor.json'), 'utf-8')) as { sessionId: string };
        const descriptor = {
                schemaVersion: 0,
                sessionId: pinnedDescriptor.sessionId,
                initiator: 'agent' as const,
                partition: 'persist:flauz-0123456789abcdef',
                policySourceRef: 'workspace-policy.json',
                createdAt: toIsoStamp(clock()),
                state: 'active' as const,
                tabs: [],
        };
        await browserJournal.append(buildSessionJournalRecord('agent', 'opened', descriptor as never, clock()));
        await browserJournal.append(buildSessionJournalRecord('agent', 'navigated', descriptor as never, clock(), { decision: 'allow', requestedUrl: 'https://example.invalid/search', sent: true }));

        // --- flauz-models: the provider lanes + a real lane switch ---
        const laneOverride = (providerId: string, enabled: boolean): ProviderOverride => ({
                providerId,
                enabled,
                models: [{
                        modelId: `${providerId}-model`,
                        modelName: `${providerId} model`,
                        family: providerId,
                        version: '1',
                        contextWindowTokens: 8192,
                        maxOutputTokens: 1024,
                        inputModalities: ['text'],
                        toolCalling: false,
                }],
        });
        const lanePolicy = (prefer: string): RoutingPolicyFile => ({
                schema: ROUTING_POLICY_SCHEMA_ID,
                schemaVersion: 0,
                updatedAt: 42,
                rules: [{ id: 'lane-primary', description: `prefer ${prefer}`, priority: 1, match: { enabledOnly: true }, ranking: 'prefer-order', prefer: [prefer] }],
        });
        const modelsFs = modelsFsPort();
        await switchProviderLane({
                root,
                fs: modelsFs,
                clock,
                hash: nodeHashPort,
                overrides: [laneOverride('flauz-mock', false), laneOverride('lane-b', true)],
                policy: lanePolicy('lane-b'),
                targetProviderId: 'lane-b',
        });
        await switchProviderLane({
                root,
                fs: modelsFs,
                clock,
                hash: nodeHashPort,
                overrides: [laneOverride('flauz-mock', false), laneOverride('lane-b', false), laneOverride('lane-c', true)],
                policy: lanePolicy('lane-c'),
                targetProviderId: 'lane-c',
        });

        // --- flauz-workflow: one saved envelope ---
        await fs.mkdir(path.join(root, '.flauz', 'workflows'), { recursive: true });
        const workflows = new WorkflowService({ root, fs: workspaceFs, tasks, ledger, clock });
        await workflows.save({ taskId: 'T-001' });

        // --- flauz-environments: the registry contract fixture (the shared pin) ---
        await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
        await fs.copyFile(ENVIRONMENTS_FIXTURE, path.join(root, '.flauz', 'environments.json'));

        return {
                root,
                fs: releaseFs,
                clock,
                tasks,
                ledger,
                graph,
                ops,
                orchestration,
                browserJournal,
                workflows,
                cleanup: async () => {
                        await fs.rm(root, { recursive: true, force: true });
                },
        };
}

/** Reads every file under a directory (recursive) as { path, text } -- the canary byte-scan vehicle. */
export async function readAllFiles(dir: string): Promise<{ path: string; text: string }[]> {
        const out: { path: string; text: string }[] = [];
        let entries;
        try {
                entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
                return out;
        }
        for (const entry of entries) {
                const target = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                        out.push(...await readAllFiles(target));
                } else if (entry.isFile()) {
                        out.push({ path: target, text: await fs.readFile(target, 'utf-8') });
                }
        }
        return out;
}

/** Lists the export directories a root carries (the export-shape test helper). */
export async function listExportsOnDisk(root: string): Promise<string[]> {
        const entries = await fs.readdir(path.join(root, '.flauz-exports'), { withFileTypes: true }).catch(() => []);
        return entries.filter(entry => entry.isDirectory() && entry.name.startsWith('export-')).map(entry => entry.name).sort();
}

/** The fixture versions block (the tests' deterministic VersionsInfo). */
export function fixtureVersions(): { productVersion: string; productName: string; extensions: { id: string; version: string }[] } {
        return {
                productVersion: '0.1.0',
                productName: 'Flauz',
                extensions: [{ id: 'flauz.flauz-release', version: '0.1.0' }, { id: 'flauz.flauz-diagnostics', version: '0.1.0' }],
        };
}

/**
 * The crash-corruption fixture: truncates the tasks envelope mid-JSON and
 * tears the evidence ledger's tail (drops the trailing newline + half the
 * last row) -- the two torn-write classes (the W2 helper, mirrored).
 */
export async function corruptSurfaces(root: string): Promise<void> {
        const tasksPath = path.join(root, '.flauz', 'tasks.json');
        const tasksText = await fs.readFile(tasksPath, 'utf-8');
        await fs.writeFile(tasksPath, tasksText.slice(0, Math.floor(tasksText.length / 2)), 'utf-8');
        const ledgerPath = path.join(root, '.flauz', 'evidence', 'ledger.jsonl');
        const ledgerText = await fs.readFile(ledgerPath, 'utf-8');
        const lines = ledgerText.split('\n').filter(line => line !== '');
        const last = lines.pop() ?? '';
        await fs.writeFile(ledgerPath, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}${last.slice(0, Math.floor(last.length / 2))}`, 'utf-8');
}

/**
 * The tamper fixture: rewrites the FIRST ledger row's uri in place (the row
 * still parses; the NEXT row's prev link breaks -- the mutated-payload
 * class, tamper not torn). Mutating a non-last row is what makes the chain
 * break visible: the last row's own hash is referenced by no later row.
 */
export async function tamperLedgerRow(root: string): Promise<void> {
        const ledgerPath = path.join(root, '.flauz', 'evidence', 'ledger.jsonl');
        const ledgerText = await fs.readFile(ledgerPath, 'utf-8');
        const lines = ledgerText.split('\n').filter(line => line !== '');
        const first = lines[0];
        if (first === undefined || lines.length < 2) {
                throw new Error('tamperLedgerRow: the fixture ledger carries fewer than two rows');
        }
        const parsed = JSON.parse(first) as Record<string, unknown>;
        parsed.uri = '.flauz/artifacts/TAMPERED/uri.txt';
        lines[0] = JSON.stringify(parsed);
        await fs.writeFile(ledgerPath, `${lines.join('\n')}\n`, 'utf-8');
}

/** Plants the W3 torn-migration marker (the torn pre-flight's signal 1). */
export async function plantTornMarker(root: string, anchorDirName: string): Promise<void> {
        const marker = {
                planId: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                anchorDirName,
                startedAt: 1_740_000_500_000,
                steps: [
                        { surface: 'tasks', stepKind: 'identity', done: true },
                        { surface: 'evidenceLedger', stepKind: 'transform', done: false },
                ],
        };
        await fs.mkdir(path.join(root, '.flauz', 'migration'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'migration', 'in-progress.json'), `${JSON.stringify(marker)}\n`, 'utf-8');
}

/** Rewrites the tasks envelope with a FUTURE format version (the migration refusal fixture: parse-clean, unrecognized). */
export async function writeFutureVersionedTasks(root: string): Promise<void> {
        const tasksPath = path.join(root, '.flauz', 'tasks.json');
        const tasksText = await fs.readFile(tasksPath, 'utf-8');
        const parsed = JSON.parse(tasksText) as Record<string, unknown>;
        parsed.$schema = 'flauz.tasks/v99';
        await fs.writeFile(tasksPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
}

/** Writes a telemetry config artifact (the checklist telemetry-row fixture). */
export async function writeTelemetryConfig(root: string, body: Record<string, unknown>): Promise<void> {
        await fs.mkdir(path.join(root, '.flauz', 'telemetry'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'telemetry', 'config.json'), `${JSON.stringify(body, null, 2)}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// The fixture product states (the install-verification check-class fixtures)
// ---------------------------------------------------------------------------

/** The injectable defects of a fixture product. */
export interface FixtureProductOptions {
        /** Delete flauz-beta's manifest (the torn install class). */
        readonly missingManifest?: boolean;
        /** flauz-alpha's manifest carries '*' activation (the tampered class). */
        readonly wildcardActivation?: boolean;
        /** flauz-alpha's manifest loses its main entrypoint (the tampered class). */
        readonly missingMain?: boolean;
        /** Add flauz-gamma with NO parity rows (the parity drift class). */
        readonly uncoveredExtension?: boolean;
        /** flauz-beta's posture row declares web-full on a main-only manifest (the PP4 drift class). */
        readonly postureDrift?: boolean;
        /** Remove flauz-beta's SBOM component row (the coverage drift class). */
        readonly sbomMissingComponent?: boolean;
        /** Remove flauz-beta from the SBOM dependency graph (the ungraphed-component class). */
        readonly sbomMissingDependsOn?: boolean;
        /** Delete the parity registry entirely (the torn contract class). */
        readonly noParity?: boolean;
        /** Delete the SBOM entirely (the torn inventory class). */
        readonly noSbom?: boolean;
}

export interface FixtureProduct {
        readonly root: string;
        readonly fs: ReleaseFsPort;
        cleanup(): Promise<void>;
}

/** A well-formed command-only extension manifest (the fixture product's packaged extension). */
function fixtureManifest(name: string, options: FixtureProductOptions): Record<string, unknown> {
        const activationEvents = options.wildcardActivation && name === 'flauz-alpha'
                ? ['*']
                : [`onCommand:flauz.${name.replace(/^flauz-/, '')}.thing`];
        const manifest: Record<string, unknown> = {
                name,
                displayName: `Fixture ${name}`,
                description: `the ${name} fixture extension`,
                version: '0.1.0',
                publisher: 'flauz',
                license: 'MIT',
                type: 'module',
                engines: { vscode: '^1.140.0' },
                categories: ['Other'],
                activationEvents,
        };
        if (!(options.missingMain === true && name === 'flauz-alpha')) {
                manifest.main = './dist/extension.js';
        }
        return manifest;
}

/** The parity triad rows for one fixture extension (the W4 row shapes). */
function fixtureParityRows(name: string, options: FixtureProductOptions): Record<string, unknown>[] {
        const postureClass = options.postureDrift && name === 'flauz-beta' ? 'web-full' : 'web-blocked';
        return [
                {
                        surface: `extensions/${name}`,
                        capability: 'extension packaging posture',
                        class: postureClass,
                        reason: `fixture posture row for ${name}`,
                        evidence: [
                                { kind: 'manifest-key', file: `extensions/${name}/package.json`, key: ['main'], value: './dist/extension.js' },
                                { kind: 'manifest-key', file: `extensions/${name}/package.json`, key: ['browser'], absent: true },
                        ],
                        recoveryPath: 'fixture recovery path',
                },
                {
                        surface: `extensions/${name}`,
                        capability: `the ${name} core (fixture)`,
                        class: 'web-full',
                        reason: 'fixture core row',
                        evidence: [{ kind: 'node-free', path: `extensions/${name}/src/api.ts` }],
                        recoveryPath: 'fixture recovery path',
                },
                {
                        surface: `extensions/${name}`,
                        capability: `the ${name} wiring (fixture)`,
                        class: 'web-blocked',
                        reason: 'fixture wiring row',
                        evidence: [{ kind: 'node-import', file: `extensions/${name}/src/extension.ts`, module: 'fs/promises' }],
                        recoveryPath: 'fixture recovery path',
                },
        ];
}

/**
 * Boots a fixture repo-state product: two extension manifests + the parity
 * registry + the SBOM, with the injectable defects.
 */
export async function bootFixtureProduct(options: FixtureProductOptions = {}): Promise<FixtureProduct> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-product-'));
        const names = ['flauz-alpha', 'flauz-beta', ...(options.uncoveredExtension ? ['flauz-gamma'] : [])];
        for (const name of ['flauz-alpha', 'flauz-beta', ...(options.uncoveredExtension ? ['flauz-gamma'] : [])]) {
                await fs.mkdir(path.join(root, 'extensions', name, 'src'), { recursive: true });
                if (options.missingManifest && name === 'flauz-beta') {
                        continue; // the torn install class: the dir exists, the manifest does not
                }
                await fs.writeFile(path.join(root, 'extensions', name, 'package.json'), `${JSON.stringify(fixtureManifest(name, options), null, 2)}\n`, 'utf-8');
                await fs.writeFile(path.join(root, 'extensions', name, 'src', 'extension.ts'), 'export function activate(): void { /* fixture */ }\n', 'utf-8');
        }
        // the node-free citation targets for the core rows (the gate requires >=1 source file under a node-free path)
        await fs.writeFile(path.join(root, 'extensions', 'flauz-alpha', 'src', 'api.ts'), 'export const fixture = 1;\n', 'utf-8');
        await fs.writeFile(path.join(root, 'extensions', 'flauz-beta', 'src', 'api.ts'), 'export const fixture = 2;\n', 'utf-8');

        if (!options.noParity) {
                const rows: Record<string, unknown>[] = [];
                for (const name of names) {
                        if (options.uncoveredExtension && name === 'flauz-gamma') {
                                continue; // the PP2 drift class: the extension exists with NO parity rows
                        }
                        rows.push(...fixtureParityRows(name, options));
                }
                const registry = { version: 1, description: 'fixture parity registry', rows };
                await fs.mkdir(path.join(root, 'build', 'flauz'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'packaging-parity.json'), `${JSON.stringify(registry, null, 2)}\n`, 'utf-8');
        }
        if (!options.noSbom) {
                const componentNames = names.filter(name => !(options.sbomMissingComponent && name === 'flauz-beta'));
                const components = componentNames.map(name => ({
                        type: 'library',
                        bomRef: `pkg:generic/flauz/${name}@0.1.0`,
                        name,
                        version: '0.1.0',
                        properties: [
                                { name: 'flauz:component-kind', value: 'flauz-extension' },
                                { name: 'flauz:artifact', value: `extensions/${name}/dist/` },
                        ],
                }));
                const dependsOn = componentNames
                        .filter(name => !(options.sbomMissingDependsOn && name === 'flauz-beta'))
                        .map(name => `pkg:generic/flauz/${name}@0.1.0`);
                const sbom = {
                        bomFormat: 'CycloneDX',
                        specVersion: '1.5',
                        components,
                        dependencies: [{ ref: 'pkg:generic/flauz@0.1.0', dependsOn }],
                };
                await fs.mkdir(path.join(root, 'build', 'flauz', 'security'), { recursive: true });
                await fs.writeFile(path.join(root, 'build', 'flauz', 'security', 'flauz-sbom.json'), `${JSON.stringify(sbom, null, 2)}\n`, 'utf-8');
        }
        return {
                root,
                fs: nodeReleaseFs(),
                cleanup: async () => {
                        await fs.rm(root, { recursive: true, force: true });
                },
        };
}
