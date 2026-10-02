/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture-workspace boot for the flauz-diagnostics suite (A-PROD-004-W1).
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
 * pin the flauz-resources contract tests use.
 */

import * as fsSync from 'node:fs';
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

import type { Clock, DiagFsPort } from '../src/api.ts';
import { toIsoStamp } from '../src/format.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const ENVIRONMENTS_FIXTURE = path.join(REPO_ROOT, 'test', 'fixtures', 'resources', 'contracts', 'environments-registry.json');

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

/** The flauz-diagnostics DiagFsPort over node:fs (the extension-host wiring). */
export function nodeDiagFs(): DiagFsPort {
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
                                if ((err as { code?: string }).code === 'ENOENT') {
                                        return undefined;
                                }
                                throw err;
                        }
                },
                mkdir: target => fs.mkdir(target, { recursive: true }),
                writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
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
        readonly fs: DiagFsPort;
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
}

/**
 * Boots a REAL `.flauz/` workspace: every artifact class constructed through
 * its owning service, then handed to the diagnostics surface under test.
 */
export async function bootFixtureWorkspace(options: FixtureOptions = {}): Promise<FixtureWorkspace> {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'flauz-diag-'));
        const workspaceFs = nodeWorkspaceFs();
        const diagFs = nodeDiagFs();
        const clock = options.clock ?? steppingClock();
        const canaries = options.canaries ?? [];

        // --- flauz-workspace: the task envelope + the evidence ledger ---
        const tasks = new TaskService({ root, fs: workspaceFs, clock });
        await tasks.bootstrap();
        await tasks.createTask('Diagnose the flaky provider lane');
        await tasks.createTask('Ship the support bundle');
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
                title: 'the diagnostics fixture graph',
                steps: [
                        { stepId: 'S-01', title: 'Probe the durable state', instruction: 'read the .flauz census surfaces' },
                        { stepId: 'S-02', title: 'Emit the bundle', instruction: 'create the support bundle' },
                ],
                actor: 'agent',
                taskId: 'T-001',
        });
        await orchestration.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'test:flauz-diagnostics' });
        await orchestration.startStep({ graphId: submitted.graphId, stepId: 'S-01', actor: 'agent', origin: 'test:flauz-diagnostics', runnerId: 'diag-runner' });
        await orchestration.finishStep({
                graphId: submitted.graphId,
                stepId: 'S-01',
                outcome: 'succeeded',
                actor: 'agent',
                origin: 'test:flauz-diagnostics',
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

        // --- flauz-models: the provider lanes + a real lane switch (the P2-FIX-116 event) ---
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

        // --- flauz-workflow: one saved envelope (the service expects the workflows dir bootstrapped,
        //     the extension.ts wiring does this on activation) ---
        await fs.mkdir(path.join(root, '.flauz', 'workflows'), { recursive: true });
        const workflows = new WorkflowService({ root, fs: workspaceFs, tasks, ledger, clock });
        await workflows.save({ taskId: 'T-001' });

        // --- flauz-environments: the registry contract fixture (the shared pin) ---
        await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
        await fs.copyFile(ENVIRONMENTS_FIXTURE, path.join(root, '.flauz', 'environments.json'));

        return {
                root,
                fs: diagFs,
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

/** Lists the support-bundle directories a root carries (the bundle-shape test helper). */
export async function listBundleDirs(root: string): Promise<string[]> {
        const entries = await fs.readdir(path.join(root, '.flauz'), { withFileTypes: true }).catch(() => []);
        return entries.filter(entry => entry.isDirectory() && entry.name.startsWith('support-bundle-')).map(entry => entry.name).sort();
}

export { fsSync };
