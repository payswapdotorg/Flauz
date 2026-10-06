/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-010 / CR-010b -- the CLI runtime suite (mocha tdd).
 *
 * Coverage: grammar pins, the parse layer, wired round trips over a
 * harness-backed fixture context, the typed-refusal battery (including
 * the verbatim-law pin and the headless violation), output-shape
 * pins (canonical JSON, table determinism, the digest), the parity
 * view projection, the real-seam loader's typeness, determinism
 * double-run byte-equality, the CR-010b approval family (the listed
 * derivation over the fixture journal; the grant / deny / fail-closed
 * expiry acts over the REAL store on temp roots), and the CR-010b
 * capability-discovery search (READ-ONLY over a registry seeded
 * through the registry's own public API). No wall-clock reads, no
 * random.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
        CLI_COMMAND_COUNT,
        CLI_COMMAND_GRAMMAR,
        lookupGrammar,
} from '../zcode-patterns/cli/common/grammar.ts';
import { refusalFor } from '../zcode-patterns/cli/common/wire.ts';
import {
        EXIT_OK,
        EXIT_TYPED_REFUSAL,
        EXIT_NOT_FOUND,
        EXIT_USAGE_ERROR,
        HEADLESS_INTERACTIVE_REFUSAL_CODE,
        admitsInteractiveSurfaces,
        exitCodeFor,
        interactiveRefusalCodeFor,
        renderSpec,
} from '../zcode-patterns/cli/common/exitcodes.ts';
import { projectParity } from '../zcode-patterns/cli/common/parity.ts';
import {
        canonicalJson,
        deriveScope,
        loadHarnessContext,
        loadRealContext,
        realRegistryFsPort,
        registryRootFor,
        runReloadDrill,
        sha256Hex,
        type Binding,
        type OrchestrationStoreBinding,
} from './runtime/context.ts';

/** Narrow a Binding to its bound payload (fail loudly on the unbound branch). */
function mustBound(binding: Binding<OrchestrationStoreBinding>): OrchestrationStoreBinding {
        if (binding.bound !== true) {
                throw new Error('the store binding must be bound (' + binding.detail + ')');
        }
        return binding.binding;
}
import { APPROVAL_DERIVATION, refusedCommandPaths, routeCommand, wiredCommandPaths } from './runtime/handlers.ts';
import { renderOutput, runCli } from './bin/flauz.ts';
import { createRegistry } from '../capabilities/registry/registry.mjs';
import type { RegistryRuntime } from '../capabilities/registry/registry.mjs';

const FIXTURE = {
        state: { status: 'fixture', graphs: ['graph-1'] },
        graphs: {
                'graph-1': { id: 'graph-1', status: 'complete', steps: [{ id: 's1', status: 'succeeded' }] },
        },
        rows: [],
        roster: [{ agentId: 'agent-alpha', role: 'worker' }],
        messages: [],
};

// ---------------------------------------------------------------------------
// CR-010b fixtures: the approval journal fixture and the registry seed
// (the registry.test.ts-validated shapes; the registry is seeded through
// its OWN public API and the CLI only reads it).
// ---------------------------------------------------------------------------

const APPROVAL_ISSUED_AT = '2025-06-01T00:00:00.000Z';

function fixtureJournalRow(
        seq: number,
        graphId: string,
        stepId: string,
        type: string,
        payload: Record<string, unknown>,
): Record<string, unknown> {
        return {
                $schema: 'flauz.orch.journal/v1',
                seq,
                rowId: 'r-' + String(seq).padStart(6, '0'),
                ts: 1000 + seq,
                graphId,
                stepId,
                type,
                actor: 'fixture-actor',
                origin: 'flauz-cli-test',
                attempt: null,
                idempotencyKey: null,
                payload,
                contentHash: 'f'.repeat(64),
                prev: null,
        };
}

const APPROVAL_FIXTURE = {
        state: { status: 'fixture', graphs: ['graph-a', 'graph-b'] },
        graphs: {
                'graph-a': { id: 'graph-a', status: 'running' },
                'graph-b': { id: 'graph-b', status: 'running' },
        },
        rows: [
                fixtureJournalRow(1, 'graph-a', 'step-1', 'approval-requested', {
                        reason: 'deploy the service',
                        expiresAt: 1750000000000,
                }),
                fixtureJournalRow(2, 'graph-a', 'step-2', 'approval-requested', { reason: 'rotate the keys' }),
                fixtureJournalRow(3, 'graph-a', 'step-2', 'approval-granted', { decision: 'granted' }),
                fixtureJournalRow(4, 'graph-b', 'step-9', 'approval-requested', { reason: 'purge the cache' }),
                fixtureJournalRow(5, 'graph-b', 'step-9', 'approval-expired', {}),
                fixtureJournalRow(6, 'graph-b', 'step-3', 'approval-requested', {
                        reason: 'open the firewall',
                        expiresAt: 1750000000000,
                }),
        ],
        roster: [],
        messages: [],
};

const EXPECTED_PENDING_APPROVALS = [
        {
                approvalId: 'r-000001',
                graphId: 'graph-a',
                stepId: 'step-1',
                reason: 'deploy the service',
                expiresAt: 1750000000000,
                requestedAt: 1001,
                actor: 'fixture-actor',
                origin: 'flauz-cli-test',
        },
        {
                approvalId: 'r-000006',
                graphId: 'graph-b',
                stepId: 'step-3',
                reason: 'open the firewall',
                expiresAt: 1750000000000,
                requestedAt: 1006,
                actor: 'fixture-actor',
                origin: 'flauz-cli-test',
        },
];

const CAPABILITY_DISCOVERY = {
        sourceKind: 'community-project',
        artifactKind: 'cli',
        version: '1.0.0',
        contentHash: 'a'.repeat(64),
        name: 'demo-capability',
};
const CAPABILITY_IMPORTED = {
        digest: 'a'.repeat(64),
        version: '1.0.0',
        license: 'MIT',
        permissions: ['read-files'],
        endpoints: ['https://example.com/demo'],
        platforms: ['linux-x64'],
        artifactKind: 'cli',
        provenance: { origin: 'community-project' },
};
const CAPABILITY_APPROVAL = { approver: 'operator-1', acknowledgedPermissions: ['read-files'] };
const CAPABILITY_VERIFICATION_RECEIPT = {
        verificationStatus: 'verified',
        checks: [{ check: 'digest', outcome: 'match' }],
};

/** Seeds the registry through its OWN public API (discover -> register -> verify -> approve -> enable, plus one discovered-only entry). */
async function seedCapabilityRegistry(root: string): Promise<RegistryRuntime> {
        const registry = createRegistry({
                root: registryRootFor(root),
                clock: () => 1000,
                fsPort: realRegistryFsPort(),
                scope: deriveScope(root),
        });
        const loaded = await registry.load();
        assert.equal(loaded.ok, true);
        const discovered = await registry.discover(CAPABILITY_DISCOVERY);
        assert.equal(discovered.ok, true);
        const registered = await registry.register(CAPABILITY_IMPORTED);
        assert.equal(registered.ok, true);
        const verified = await registry.verify(registered.entryId, CAPABILITY_VERIFICATION_RECEIPT);
        assert.equal(verified.ok, true);
        const approved = await registry.approve(registered.entryId, CAPABILITY_APPROVAL);
        assert.equal(approved.ok, true);
        const enabled = await registry.enable(registered.entryId);
        assert.equal(enabled.ok, true);
        const second = await registry.discover({ ...CAPABILITY_DISCOVERY, contentHash: 'e'.repeat(64) });
        assert.equal(second.ok, true);
        return registry;
}

interface SeededApproval {
        context: Awaited<ReturnType<typeof loadRealContext>>;
        graphId: string;
        stepId: string;
        approvalId: string;
}

/**
 * Seeds one pending approval through the REAL store write API (the
 * runReloadDrill precedent: raw.submitGraph + raw.approveGraph, then
 * raw.approvalRequest). A refused direct request retries once with
 * startStep first (the gated-step state machine variant); the store
 * appends nothing on a refused preview, so the retry starts clean.
 */
async function seedRealApproval(root: string, issuedAtIso: string, stepId: string, expiresAt?: number): Promise<SeededApproval> {
        const context = await loadRealContext({ root, issuedAtIso });
        const store = await context.readStore();
        assert.equal(store.bound, true);
        const rawStore = mustBound(store).raw as {
                submitGraph(input: Record<string, unknown>): Promise<{ graphId: string }>;
                approveGraph(input: Record<string, unknown>): Promise<unknown>;
                startStep(input: Record<string, unknown>): Promise<unknown>;
                approvalRequest(input: Record<string, unknown>): Promise<{ rowId: string }>;
        } | undefined;
        assert.notEqual(rawStore, undefined);
        const submitted = await rawStore!.submitGraph({
                title: 'cli approval round trip',
                steps: [
                        {
                                stepId,
                                title: 'the approval gate step',
                                instruction: 'await the human approval',
                                gate: 'human-approval',
                        },
                ],
                actor: 'human',
                origin: 'flauz-cli',
        });
        await rawStore!.approveGraph({ graphId: submitted.graphId, actor: 'human', origin: 'flauz-cli' });
        const requestInput: Record<string, unknown> = {
                graphId: submitted.graphId,
                stepId,
                reason: 'the CLI approval round trip',
                // The transition table: approval-requested requires an agent |
                // service actor (the request is mechanical; only the DECIDE act
                // is human).
                actor: 'agent',
                origin: 'service:flauz-cli',
        };
        if (expiresAt !== undefined) {
                requestInput.expiresAt = expiresAt;
        }
        const requested: { rowId: string } = await rawStore!.approvalRequest(requestInput);
        return {
                context,
                graphId: submitted.graphId,
                stepId,
                approvalId: requested.rowId,
        };
}

/** The last step-level approval row for the seeded step (the row the act returned, wherever it sits in the journal). */
async function lastApprovalRow(seeded: SeededApproval): Promise<Record<string, unknown>> {
        const store = await seeded.context.readStore();
        assert.equal(store.bound, true);
        const rows = mustBound(store).rowsFor(seeded.graphId) as Array<Record<string, unknown>>;
        const approvalRows = rows.filter(
                (row) =>
                        typeof row.type === 'string' &&
                        String(row.type).includes('approval') &&
                        row.stepId === seeded.stepId,
        );
        assert.ok(approvalRows.length >= 2, 'expected the request row plus the act row');
        return approvalRows[approvalRows.length - 1];
}

function resultDigestOf(result: { response?: unknown }): string {
        const digest = (result.response as { resultDigest?: string }).resultDigest;
        assert.equal(typeof digest, 'string');
        return digest as string;
}

suite('flauz cli: grammar pins', () => {
        test('the frozen grammar carries 29 commands', () => {
                assert.equal(CLI_COMMAND_COUNT, 29);
                assert.equal(CLI_COMMAND_GRAMMAR.length, 29);
        });

        test('lookupGrammar resolves a dotted path to its journey entry', () => {
                const entry = lookupGrammar('background-agent.roster');
                assert.notEqual(entry, undefined);
                assert.equal(entry?.journey, 'background-agent');
                assert.equal(entry?.argSpec.length, 0);
        });

        test('lookupGrammar returns undefined for an unknown path', () => {
                assert.equal(lookupGrammar('workspace.teleport'), undefined);
        });
});

suite('flauz cli: parse layer', () => {
        test('no command is a usage error (exit 2)', async () => {
                const result = await runCli([]);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.ok(result.stderr.includes('no command given'));
        });

        test('--help renders the grammar usage surface (exit 0)', async () => {
                const result = await runCli(['--help']);
                assert.equal(result.exitCode, EXIT_OK);
                assert.ok(result.stdout.includes('workspace.status'));
                assert.ok(result.stdout.includes('capability-discovery.search'));
        });

        test('an unknown command is a usage error (exit 2)', async () => {
                const result = await runCli(['workspac.status']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.ok(result.stderr.includes('unknown command'));
        });

        test('an unknown flag is a typed flag problem (exit 2)', async () => {
                const result = await runCli(['--frobnicate', 'workspace.status']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.ok(result.stderr.includes('unknown flag'));
        });

        test('a value flag without a value is a typed flag problem (exit 2)', async () => {
                const result = await runCli(['--root']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.ok(result.stderr.includes('requires a value'));
        });

        test('a missing required argument is the typed parse mismatch (exit 2)', async () => {
                const result = await runCli(['workflow.view']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.equal(result.parseMismatch?.kind, 'missing-argument');
                assert.equal(result.parseMismatch?.argName, 'workflowId');
                assert.ok(result.stderr.includes('missing-argument'));
        });

        test('a missing approval.respond argument is the typed parse mismatch (exit 2)', async () => {
                const result = await runCli(['approval.respond']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.equal(result.parseMismatch?.kind, 'missing-argument');
                assert.equal(result.parseMismatch?.argName, 'approvalId');
                assert.ok(result.stderr.includes('missing-argument'));
        });

        test('an extra token is the typed unexpected-argument mismatch (exit 2)', async () => {
                const result = await runCli(['workspace.status', 'extra']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.equal(result.parseMismatch?.kind, 'unexpected-argument');
        });

        test('a non-number where a number is declared is invalid-argument-value (exit 2)', async () => {
                const result = await runCli(['lab.runs', 'abc']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.equal(result.parseMismatch?.kind, 'invalid-argument-value');
                assert.equal(result.parseMismatch?.argName, 'limit');
        });

        test('malformed JSON where JSON is declared is invalid-argument-value (exit 2)', async () => {
                const result = await runCli(['background-agent.launch', '{oops']);
                assert.equal(result.exitCode, EXIT_USAGE_ERROR);
                assert.equal(result.parseMismatch?.kind, 'invalid-argument-value');
                assert.equal(result.parseMismatch?.expected, 'json');
        });
});

suite('flauz cli: wired round trips over the harness fixture', () => {
        suiteSetup(async function () {
                this.timeout(30000);
        });

        test('background-agent.roster projects the roster digest (exit 0)', async () => {
                const result = await runCli(['background-agent.roster'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                assert.equal(
                        (result.response as { resultDigest?: string }).resultDigest,
                        sha256Hex(canonicalJson(FIXTURE.roster)),
                );
        });

        test('background-agent.inspect finds the fixture agent (exit 0)', async () => {
                const result = await runCli(['background-agent.inspect', 'agent-alpha'], {
                        context: harnessContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
        });

        test('background-agent.inspect of an unknown agent is not-found (exit 3)', async () => {
                const result = await runCli(['background-agent.inspect', 'agent-nobody'], {
                        context: harnessContext,
                });
                assert.equal(result.exitCode, EXIT_NOT_FOUND);
                assert.equal(result.response?.outcome, 'not-found');
        });

        test('workflow.phases projects the graph state digest (exit 0)', async () => {
                const result = await runCli(['workflow.phases', 'graph-1'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(
                        (result.response as { resultDigest?: string }).resultDigest,
                        sha256Hex(canonicalJson(FIXTURE.graphs['graph-1'])),
                );
        });

        test('workflow.view of an unknown graph is not-found (exit 3)', async () => {
                const result = await runCli(['workflow.view', 'graph-none'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_NOT_FOUND);
        });

        test('the two-token form is byte-identical to the dotted form', async () => {
                const dotted = await runCli(['background-agent.roster'], { context: harnessContext });
                const twoToken = await runCli(['background-agent', 'roster'], { context: harnessContext });
                assert.equal(dotted.stdout, twoToken.stdout);
                assert.equal(dotted.response?.requestId, twoToken.response?.requestId);
        });

        test('--issued-at flows into the request verbatim', async () => {
                const result = await runCli(
                        ['--issued-at', '2025-06-01T00:00:00.000Z', 'background-agent.roster'],
                        { context: harnessContext },
                );
                assert.equal((result.response?.requestId ?? '').length > 0, true);
                const second = await runCli(
                        ['--issued-at', '2025-06-02T00:00:00.000Z', 'background-agent.roster'],
                        { context: harnessContext },
                );
                assert.notEqual(result.response?.requestId, second.response?.requestId);
        });
});

suite('flauz cli: output shapes', () => {
        test('the json render carries exactly the renderSpec fields in order', async () => {
                const result = await runCli(['background-agent.roster'], { context: harnessContext });
                const spec = renderSpec('json', result.response!);
                assert.equal(spec.built, true);
                const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
                assert.deepEqual(Object.keys(parsed), spec.built ? spec.spec.requiredFields : []);
        });

        test('the table render is deterministic and differs from json', async () => {
                const first = await runCli(['--table', 'workflow.view', 'graph-1'], { context: harnessContext });
                const second = await runCli(['--table', 'workflow.view', 'graph-1'], { context: harnessContext });
                assert.equal(first.stdout, second.stdout);
                assert.ok(first.stdout.includes('workflow.view'));
                assert.ok(first.stdout.includes('ok'));
                assert.notEqual(first.stdout, renderOutput(first.response as never, 'json'));
        });

        test('the digest render is the sha256 hex of the canonical response JSON', async () => {
                const result = await runCli(['--digest', 'workflow.view', 'graph-1'], {
                        context: harnessContext,
                });
                const jsonRun = await runCli(['--json', 'workflow.view', 'graph-1'], {
                        context: harnessContext,
                });
                const expected = sha256Hex(canonicalJson(JSON.parse(jsonRun.stdout)));
                assert.equal(result.stdout.trim(), expected);
                assert.match(result.stdout.trim(), /^[0-9a-f]{64}$/);
        });

        test('determinism: two identical invocations are byte-identical', async () => {
                const first = await runCli(['--root', fixtureRoot, 'background-agent.roster'], {
                        context: harnessContext,
                });
                const second = await runCli(['--root', fixtureRoot, 'background-agent.roster'], {
                        context: harnessContext,
                });
                assert.equal(first.stdout, second.stdout);
                assert.equal(first.exitCode, second.exitCode);
                assert.equal(first.response?.requestId, second.response?.requestId);
        });
});

suite('flauz cli: the typed-refusal battery', () => {
        test('evidence.list is the parity-projection-missing refusal with the verbatim law (exit 1)', async () => {
                const result = await runCli(['evidence.list', 'task-1'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_TYPED_REFUSAL);
                const refusal = result.response as { refusalCode?: string; violatedLaw?: string };
                assert.equal(refusal.refusalCode, 'parity-projection-missing');
                assert.equal(refusal.violatedLaw, refusalFor('parity-projection-missing')?.violatedLaw);
        });

        test('replay.run is the parity-projection-missing refusal (exit 1)', async () => {
                const result = await runCli(['replay.run', 'plan-1'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_TYPED_REFUSAL);
                assert.equal(
                        (result.response as { refusalCode?: string }).refusalCode,
                        'parity-projection-missing',
                );
        });

        test('a mismatched scope override is the scope-isolation-violated refusal (exit 1)', async () => {
                const result = await runCli(
                        ['--root', fixtureRoot, '--workspace-id', 'somebody-elses', 'background-agent.roster'],
                        { context: harnessContext },
                );
                assert.equal(result.exitCode, EXIT_TYPED_REFUSAL);
                assert.equal(
                        (result.response as { refusalCode?: string }).refusalCode,
                        'scope-isolation-violated',
                );
        });

        test('every grammar command routes: 13 wired + 16 typed refusals, no drift', async () => {
                // The merged wave-2 census: 6 read handlers + approval.respond
                // (CR-010b) + the six background-agent mutations (CR-002) wired;
                // the remaining 16 paths stay typed refusals.
                assert.equal(wiredCommandPaths().length, 13);
                assert.equal(refusedCommandPaths().length, 16);
                for (const entry of CLI_COMMAND_GRAMMAR) {
                        const routed = await routeCommand(harnessContext, {
                                scope: { workspaceId: harnessContext.root.split('/').pop() ?? 'x', tenantId: 'local' },
                                contractVersion: '1.0.0',
                                commandPath: entry.path,
                                args: {},
                                requestId: 'test-' + entry.path,
                                issuedAtIso: '1970-01-01T00:00:00.000Z',
                        });
                        assert.equal(routed.kind, 'projection', entry.path);
                }
        });
});

suite('flauz cli: the headless law', () => {
        test('headless mode admits no interactive surfaces and discloses the typed code', () => {
                assert.equal(admitsInteractiveSurfaces('headless'), false);
                assert.equal(interactiveRefusalCodeFor('headless'), HEADLESS_INTERACTIVE_REFUSAL_CODE);
                assert.equal(
                        refusalFor(HEADLESS_INTERACTIVE_REFUSAL_CODE)?.code,
                        'headless-interactive-surface',
                );
        });

        test('exitCodeFor fails a corrupt outcome channel closed to usage-error', () => {
                assert.equal(exitCodeFor({ outcome: 'junk' } as never), EXIT_USAGE_ERROR);
        });
});

suite('flauz cli: the parity view over run receipts', () => {
        test('projectParity over wired-and-refused receipts yields the per-journey verdicts', () => {
                const projections = [
                        { commandPath: 'background-agent.roster', lastOutcome: 'ok' },
                        { commandPath: 'background-agent.inspect', lastOutcome: 'not-found' },
                        { commandPath: 'background-agent.resume', lastOutcome: 'typed-refusal' },
                        { commandPath: 'approval.respond', lastOutcome: 'typed-refusal' },
                        { commandPath: 'evidence.list', lastOutcome: 'typed-refusal' },
                ] as const;
                const outcome = projectParity(CLI_COMMAND_GRAMMAR, projections, {
                        workspaceId: 'w',
                        tenantId: 't',
                });
                assert.equal(outcome.built, true);
                if (outcome.built) {
                        const verdicts = new Map(outcome.view.journeys.map((e) => [e.journey, e.verdict]));
                        assert.equal(verdicts.get('background-agent'), 'par-partial');
                        assert.equal(verdicts.get('approval'), 'par-partial');
                        assert.equal(verdicts.get('evidence'), 'par-partial');
                        assert.equal(verdicts.get('workspace'), 'par-absent');
                }
        });
});

suite('flauz cli: the real seam loader (typeness)', () => {
        test('readStore over a fresh root answers a typed binding verdict, never a throw', async () => {
                const context = await loadRealContext({
                        root: freshRoot,
                        issuedAtIso: '1970-01-01T00:00:00.000Z',
                });
                const store = await context.readStore();
                assert.equal(typeof store.bound, 'boolean');
        });

        test('readBus over a fresh root answers a typed binding verdict, never a throw', async () => {
                const context = await loadRealContext({
                        root: freshRoot,
                        issuedAtIso: '1970-01-01T00:00:00.000Z',
                });
                const bus = await context.readBus();
                assert.equal(typeof bus.bound, 'boolean');
        });

        test('the reload drill over a fresh root answers a typed record', async () => {
                const drill = await runReloadDrill(freshRoot);
                assert.equal(typeof drill.byteEqual, 'boolean');
                assert.equal(typeof drill.loadedFirst, 'boolean');
        });
});

// ---------------------------------------------------------------------------
// CR-010b wave 2: approval.list (the disclosed derivation)
// ---------------------------------------------------------------------------

suite('flauz cli: approval.list round trips', () => {
        test('an empty journal projects the empty pending set with the derivation disclosed', async () => {
                const result = await runCli(['approval.list'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'pending-approvals',
                        derivation: APPROVAL_DERIVATION,
                        count: 0,
                        approvals: [],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('the pending derivation lists requests without later decision rows, sorted by graph and step', async () => {
                const result = await runCli(['approval.list'], { context: approvalContext });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'pending-approvals',
                        derivation: APPROVAL_DERIVATION,
                        count: EXPECTED_PENDING_APPROVALS.length,
                        approvals: EXPECTED_PENDING_APPROVALS,
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('approval.list is byte-stable across repeats over the same fixture', async () => {
                const first = await runCli(['approval.list'], { context: approvalContext });
                const second = await runCli(['approval.list'], { context: approvalContext });
                assert.equal(first.stdout, second.stdout);
        });
});

// ---------------------------------------------------------------------------
// CR-010b wave 2: approval.respond (the real store authority)
// ---------------------------------------------------------------------------

suite('flauz cli: approval.respond round trips (real store)', () => {
        test('approval.respond grants through approvalDecide (exit 0)', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const result = await runCli(['approval.respond', seeded.approvalId, 'granted'], {
                        context: seeded.context,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'approval-responded',
                        approvalId: seeded.approvalId,
                        decision: 'granted',
                        outcome: 'granted',
                        row: await lastApprovalRow(seeded),
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('approval.respond denies through approvalDecide', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const result = await runCli(['approval.respond', seeded.approvalId, 'denied'], {
                        context: seeded.context,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const store = await seeded.context.readStore();
                const rows = mustBound(store).rowsFor(seeded.graphId) as unknown[];
                assert.ok(JSON.stringify(rows).includes('denied'));
                const expected = {
                        kind: 'approval-responded',
                        approvalId: seeded.approvalId,
                        decision: 'denied',
                        outcome: 'denied',
                        row: await lastApprovalRow(seeded),
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('responding past expiresAt runs the fail-closed expiry (CANCELLED, never granted)', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01', 1);
                const result = await runCli(['approval.respond', seeded.approvalId, 'granted'], {
                        context: seeded.context,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'approval-responded',
                        approvalId: seeded.approvalId,
                        decision: 'granted',
                        outcome: 'expired',
                        failClosed: true,
                        stepDisposition: 'cancelled',
                        row: await lastApprovalRow(seeded),
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
                const store = await seeded.context.readStore();
                const rows = mustBound(store).rowsFor(seeded.graphId) as unknown[];
                assert.equal(JSON.stringify(rows).includes('granted'), false);
                const state = (mustBound(store).raw as { stateOf(id: string): { pendingApprovals?: string[] } }).stateOf(
                        seeded.graphId,
                );
                assert.equal((state.pendingApprovals ?? []).includes(seeded.stepId), false);
        });

        test('approval.respond of an unknown approval id is not-found (exit 3)', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const result = await runCli(['approval.respond', 'r-999999', 'granted'], {
                        context: seeded.context,
                });
                assert.equal(result.exitCode, EXIT_NOT_FOUND);
                assert.equal(result.response?.outcome, 'not-found');
        });

        test('a decided approval is no longer pending: the second respond is not-found', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const first = await runCli(['approval.respond', seeded.approvalId, 'granted'], {
                        context: seeded.context,
                });
                assert.equal(first.exitCode, EXIT_OK);
                const second = await runCli(['approval.respond', seeded.approvalId, 'denied'], {
                        context: seeded.context,
                });
                assert.equal(second.exitCode, EXIT_NOT_FOUND);
        });

        test('determinism: every approval row carries the injected issuedAt, never the wall clock', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const result = await runCli(['approval.respond', seeded.approvalId, 'granted'], {
                        context: seeded.context,
                });
                assert.equal(result.exitCode, EXIT_OK);
                const store = await seeded.context.readStore();
                assert.equal(store.bound, true);
                const rows = mustBound(store).rowsFor(seeded.graphId) as Array<Record<string, unknown>>;
                const approvalRows = rows.filter(
                        (row) =>
                                typeof row.type === 'string' &&
                                String(row.type).includes('approval') &&
                                row.stepId === seeded.stepId,
                );
                assert.ok(approvalRows.length >= 2, 'expected the request row plus the act row');
                for (const row of approvalRows) {
                        assert.equal(row.ts, Date.parse(APPROVAL_ISSUED_AT));
                }
        });

        test('approval.respond over the harness fixture store is the honest no-raw-seam edge', async () => {
                const result = await runCli(['approval.respond', 'r-000001', 'granted'], {
                        context: approvalContext,
                });
                assert.notEqual(result.exitCode, EXIT_OK);
                assert.equal(result.edgeFailure?.reason, 'seam-unavailable');
                assert.ok(String(result.edgeFailure?.detail ?? '').includes('raw approval API'));
        });

        test('approval.list over the real seam derives the seeded pending approval', async function () {
                this.timeout(30000);
                const root = await mkdtemp(join(tmpdir(), 'flauz-cli-respond-'));
                const seeded = await seedRealApproval(root, APPROVAL_ISSUED_AT, 'S-01');
                const store = await seeded.context.readStore();
                const rows = mustBound(store).rowsFor(seeded.graphId) as Array<Record<string, unknown>>;
                const requestRow = rows.find(
                        (row) =>
                                typeof row.type === 'string' &&
                                String(row.type).includes('approval') &&
                                String(row.type).includes('request'),
                );
                assert.notEqual(requestRow, undefined);
                const payload = (requestRow!.payload ?? {}) as Record<string, unknown>;
                const result = await runCli(['approval.list'], { context: seeded.context });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'pending-approvals',
                        derivation: APPROVAL_DERIVATION,
                        count: 1,
                        approvals: [
                                {
                                        approvalId: requestRow!.rowId as string,
                                        graphId: seeded.graphId,
                                        stepId: seeded.stepId,
                                        reason: typeof payload.reason === 'string' ? payload.reason : null,
                                        expiresAt: typeof payload.expiresAt === 'number' ? payload.expiresAt : null,
                                        requestedAt: typeof requestRow!.ts === 'number' ? requestRow!.ts : null,
                                        actor: typeof requestRow!.actor === 'string' ? requestRow!.actor : null,
                                        origin: typeof requestRow!.origin === 'string' ? requestRow!.origin : null,
                                },
                        ],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });
});

// ---------------------------------------------------------------------------
// CR-010b wave 2: capability-discovery.search (read-only over the live registry)
// ---------------------------------------------------------------------------

suite('flauz cli: capability-discovery.search round trips', () => {
        test('search by state projects the registry query result', async () => {
                const result = await runCli(['capability-discovery.search', 'state:enabled'], {
                        context: capabilityContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const q = await capabilityRegistry.query({ state: 'enabled' });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                const expected = {
                        kind: 'capability-search',
                        predicate: { state: 'enabled' },
                        limit: null,
                        count: q.count,
                        returned: q.entries.length,
                        entries: [...q.entries],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('search by artifactKind projects the registry query result', async () => {
                const result = await runCli(['capability-discovery.search', 'artifactKind:cli'], {
                        context: capabilityContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                const q = await capabilityRegistry.query({ artifactKind: 'cli' });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                const expected = {
                        kind: 'capability-search',
                        predicate: { artifactKind: 'cli' },
                        limit: null,
                        count: q.count,
                        returned: q.entries.length,
                        entries: [...q.entries],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('search by platform projects the registry query result', async () => {
                const result = await runCli(['capability-discovery.search', 'platform:linux-x64'], {
                        context: capabilityContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                const q = await capabilityRegistry.query({ platform: 'linux-x64' });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                const expected = {
                        kind: 'capability-search',
                        predicate: { platform: 'linux-x64' },
                        limit: null,
                        count: q.count,
                        returned: q.entries.length,
                        entries: [...q.entries],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('search by permissionTier projects the registry query result', async () => {
                const result = await runCli(['capability-discovery.search', 'permissionTier:low'], {
                        context: capabilityContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                const q = await capabilityRegistry.query({ permissionTier: 'low' });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                const expected = {
                        kind: 'capability-search',
                        predicate: { permissionTier: 'low' },
                        limit: null,
                        count: q.count,
                        returned: q.entries.length,
                        entries: [...q.entries],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('a combined predicate intersects through the registry', async () => {
                const result = await runCli(
                        ['capability-discovery.search', 'state:enabled artifactKind:cli platform:linux-x64 permissionTier:low'],
                        { context: capabilityContext },
                );
                assert.equal(result.exitCode, EXIT_OK);
                const q = await capabilityRegistry.query({
                        state: 'enabled',
                        artifactKind: 'cli',
                        platform: 'linux-x64',
                        permissionTier: 'low',
                });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                assert.equal(q.count, 1);
                const expected = {
                        kind: 'capability-search',
                        predicate: { state: 'enabled', artifactKind: 'cli', platform: 'linux-x64', permissionTier: 'low' },
                        limit: null,
                        count: q.count,
                        returned: q.entries.length,
                        entries: [...q.entries],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('the declared limit applies over the registry stable ordering and is disclosed', async () => {
                const result = await runCli(['capability-discovery.search', 'artifactKind:cli', '1'], {
                        context: capabilityContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                const q = await capabilityRegistry.query({ artifactKind: 'cli' });
                assert.equal(q.ok, true);
                if (!q.ok) {
                        throw new Error('registry query refused');
                }
                // The registry's honest semantics: only REGISTERED-and-beyond
                // entries carry imported.artifactKind; the discovered-only seed
                // (imported === null) is excluded from an artifactKind query.
                assert.equal(q.count, 1);
                const expected = {
                        kind: 'capability-search',
                        predicate: { artifactKind: 'cli' },
                        limit: 1,
                        count: q.count,
                        returned: 1,
                        entries: [q.entries[0]],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });

        test('a malformed predicate is the registry typed refusal surfaced as an edge failure', async () => {
                const result = await runCli(['capability-discovery.search', 'rank:best'], {
                        context: capabilityContext,
                });
                assert.notEqual(result.exitCode, EXIT_OK);
                assert.equal(result.edgeFailure?.reason, 'seam-unavailable');
                assert.ok(String(result.edgeFailure?.detail ?? '').includes('E_QUERY_MALFORMED'));
        });

        test('the read-only law: searches leave the registry bytes untouched', async () => {
                const journalPath = join(registryRootFor(capabilityRoot), 'registry-journal.jsonl');
                const snapshotPath = join(registryRootFor(capabilityRoot), 'registry-state.json');
                const journalBefore = await readFile(journalPath, 'utf8');
                const snapshotBefore = await readFile(snapshotPath, 'utf8');
                await runCli(['capability-discovery.search', 'state:enabled'], { context: capabilityContext });
                await runCli(['capability-discovery.search', 'artifactKind:cli', '1'], { context: capabilityContext });
                await runCli(['capability-discovery.search', 'rank:best'], { context: capabilityContext });
                await runCli(
                        ['capability-discovery.search', 'state:enabled', 'platform:linux-x64', 'permissionTier:low', 'artifactKind:cli'],
                        { context: capabilityContext },
                );
                assert.equal(await readFile(journalPath, 'utf8'), journalBefore);
                assert.equal(await readFile(snapshotPath, 'utf8'), snapshotBefore);
        });

        test('search over an empty registry directory projects an honest empty result', async () => {
                const result = await runCli(['capability-discovery.search', 'state:enabled'], {
                        context: harnessContext,
                });
                assert.equal(result.exitCode, EXIT_OK);
                assert.equal(result.response?.outcome, 'ok');
                const expected = {
                        kind: 'capability-search',
                        predicate: { state: 'enabled' },
                        limit: null,
                        count: 0,
                        returned: 0,
                        entries: [],
                };
                assert.equal(resultDigestOf(result), sha256Hex(canonicalJson(expected)));
        });
});

suite('flauz cli: the registry binding', () => {
        test('readRegistry binds the read-only registry surface', () => {
                const binding = harnessContext.readRegistry(harnessContext.root);
                assert.equal(typeof binding.load, 'function');
                assert.equal(typeof binding.query, 'function');
                assert.equal(typeof binding.inspect, 'function');
                assert.equal('discover' in binding, false);
                assert.equal('register' in binding, false);
                assert.equal('verify' in binding, false);
                assert.equal('approve' in binding, false);
                assert.equal('enable' in binding, false);
                assert.equal('remove' in binding, false);
        });

        test('registryRootFor places the registry under the root .flauz tree and the seeded files live there', async () => {
                assert.equal(
                        registryRootFor(capabilityRoot),
                        join(resolve(capabilityRoot), '.flauz', 'capability-registry'),
                );
                const journal = await readFile(join(registryRootFor(capabilityRoot), 'registry-journal.jsonl'), 'utf8');
                assert.ok(journal.length > 0);
        });
});

let harnessContext: Awaited<ReturnType<typeof loadHarnessContext>>;
let fixtureRoot: string;
let freshRoot: string;
let approvalContext: Awaited<ReturnType<typeof loadHarnessContext>>;
let approvalFixtureRoot: string;
let capabilityContext: Awaited<ReturnType<typeof loadRealContext>>;
let capabilityRoot: string;
let capabilityRegistry: RegistryRuntime;

suiteSetup(async () => {
        fixtureRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-fixture-'));
        await writeFile(join(fixtureRoot, 'flauz-cli-fixture.json'), JSON.stringify(FIXTURE));
        // CR-010b: the harness root's registry directory exists so the census
        // loop's capability-discovery.search loads an honest empty registry.
        await mkdir(join(fixtureRoot, '.flauz', 'capability-registry'), { recursive: true });
        harnessContext = await loadHarnessContext({
                root: fixtureRoot,
                issuedAtIso: '1970-01-01T00:00:00.000Z',
        });
        freshRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-fresh-'));
        approvalFixtureRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-approval-'));
        await writeFile(join(approvalFixtureRoot, 'flauz-cli-fixture.json'), JSON.stringify(APPROVAL_FIXTURE));
        approvalContext = await loadHarnessContext({
                root: approvalFixtureRoot,
                issuedAtIso: APPROVAL_ISSUED_AT,
        });
        capabilityRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-capability-'));
        capabilityRegistry = await seedCapabilityRegistry(capabilityRoot);
        capabilityContext = await loadRealContext({
                root: capabilityRoot,
                issuedAtIso: APPROVAL_ISSUED_AT,
        });
});
