/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-010 -- the CLI runtime suite (mocha tdd).
 *
 * Coverage: grammar pins, the parse layer, wired round trips over a
 * harness-backed fixture context, the typed-refusal battery (including
 * the verbatim-law pin and the headless violation), output-shape
 * pins (canonical JSON, table determinism, the digest), the parity
 * view projection, the real-seam loader's typeness, and determinism
 * double-run byte-equality. No Date.now, no Math.random.
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
        loadHarnessContext,
        loadRealContext,
        runReloadDrill,
        sha256Hex,
} from './runtime/context.ts';
import { refusedCommandPaths, routeCommand, wiredCommandPaths } from './runtime/handlers.ts';
import { renderOutput, runCli } from './bin/flauz.ts';

const FIXTURE = {
        state: { status: 'fixture', graphs: ['graph-1'] },
        graphs: {
                'graph-1': { id: 'graph-1', status: 'complete', steps: [{ id: 's1', status: 'succeeded' }] },
        },
        rows: [],
        roster: [{ agentId: 'agent-alpha', role: 'worker' }],
        messages: [],
};

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
        test('approval.respond is the headless-interactive-surface refusal with the verbatim law (exit 1)', async () => {
                const result = await runCli(['approval.respond', 'ap-1', 'approved'], {
                        context: harnessContext,
                });
                assert.equal(result.exitCode, EXIT_TYPED_REFUSAL);
                const refusal = result.response as { refusalCode?: string; violatedLaw?: string };
                assert.equal(refusal.refusalCode, 'headless-interactive-surface');
                assert.equal(refusal.violatedLaw, refusalFor('headless-interactive-surface')?.violatedLaw);
        });

        test('evidence.list is the parity-projection-missing refusal with the verbatim law (exit 1)', async () => {
                const result = await runCli(['evidence.list', 'task-1'], { context: harnessContext });
                assert.equal(result.exitCode, EXIT_TYPED_REFUSAL);
                const refusal = result.response as { refusalCode?: string; violatedLaw?: string };
                assert.equal(refusal.refusalCode, 'parity-projection-missing');
                assert.equal(refusal.violatedLaw, refusalFor('parity-projection-missing')?.violatedLaw);
        });

        test('capability-discovery.search is the parity-projection-missing refusal (exit 1)', async () => {
                const result = await runCli(['capability-discovery.search', 'query'], {
                        context: harnessContext,
                });
                assert.equal(
                        (result.response as { refusalCode?: string }).refusalCode,
                        'parity-projection-missing',
                );
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

        test('every grammar command routes: 4 wired + 25 typed refusals, no drift', async () => {
                assert.equal(wiredCommandPaths().length, 4);
                assert.equal(refusedCommandPaths().length, 25);
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

let harnessContext: Awaited<ReturnType<typeof loadHarnessContext>>;
let fixtureRoot: string;
let freshRoot: string;

suiteSetup(async () => {
        fixtureRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-fixture-'));
        await writeFile(join(fixtureRoot, 'flauz-cli-fixture.json'), JSON.stringify(FIXTURE));
        harnessContext = await loadHarnessContext({
                root: fixtureRoot,
                issuedAtIso: '1970-01-01T00:00:00.000Z',
        });
        freshRoot = await mkdtemp(join(tmpdir(), 'flauz-cli-fresh-'));
});

