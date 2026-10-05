/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * ZC-009 grammar contracts test suite (mocha tdd style, matching
 * build/flauz/lab/test/common/labContracts.test.ts).
 *
 * Fixture policy: the journey and command vocabularies below are
 * ORDER-GIVEN (the work order enumerates them); arg specs are covered
 * by SEAM(ARG_SPECS) and reconciled repo-side. Custom grammar entries
 * used by parseSpec tests are synthetic 'fixture-command' shapes and
 * are never presented as authority values.
 */
import { strict as assert } from 'node:assert';
import {
    APPROVAL_COMMANDS,
    BACKGROUND_AGENT_COMMANDS,
    CAPABILITY_DISCOVERY_COMMANDS,
    CLI_ARG_KINDS,
    CLI_COMMAND_COUNT,
    CLI_COMMAND_GRAMMAR,
    CLI_JOURNEYS,
    CLI_PARITY_CONTRACTS_VERSION,
    CLI_PARSE_MISMATCH_KINDS,
    EVIDENCE_COMMANDS,
    LAB_COMMANDS,
    REPLAY_COMMANDS,
    WORKFLOW_COMMANDS,
    WORKSPACE_COMMANDS,
    grammarFor,
    lookupGrammar,
    parseSpec,
} from '../../common/grammar.js';
import type {
    CliArgSpec,
    CliGrammarEntry,
    CliJourney,
    CliParseMismatch,
    CliParseResult,
} from '../../common/grammar.js';

function parsed(result: CliParseResult): Record<string, string> {
    assert.equal(result.parsed, true, `expected parse success, got: ${JSON.stringify(result)}`);
    return (result as { parsed: true; args: Record<string, string> }).args;
}

function mismatched(result: CliParseResult): CliParseMismatch {
    assert.equal(result.parsed, false, `expected parse mismatch, got: ${JSON.stringify(result)}`);
    return result as CliParseMismatch;
}

function customEntry(argSpec: readonly CliArgSpec[]): CliGrammarEntry {
    return {
        journey: 'workspace',
        command: 'fixture-command',
        path: 'workspace.fixture-command',
        argSpec,
        summaryDigest: 'summary-digest:workspace.fixture-command',
    };
}

suite('ZC-009 grammar contracts', () => {

    suite('frozen vocabularies', () => {
        test('contract set version is 1.0.0', () => {
            assert.equal(CLI_PARITY_CONTRACTS_VERSION, '1.0.0');
        });

        test('journeys are the frozen eight-journey service surface list', () => {
            assert.deepStrictEqual([...CLI_JOURNEYS], [
                'workspace',
                'background-agent',
                'workflow',
                'approval',
                'evidence',
                'replay',
                'lab',
                'capability-discovery',
            ]);
        });

        test('workspace commands are the frozen status/list/focus group', () => {
            assert.deepStrictEqual([...WORKSPACE_COMMANDS], ['status', 'list', 'focus']);
        });

        test('background-agent commands are the frozen eight-command group', () => {
            assert.deepStrictEqual([...BACKGROUND_AGENT_COMMANDS], [
                'launch',
                'inspect',
                'message',
                'pause',
                'stop',
                'cancel',
                'resume',
                'roster',
            ]);
        });

        test('workflow commands are the frozen phases/advance/view group', () => {
            assert.deepStrictEqual([...WORKFLOW_COMMANDS], ['phases', 'advance', 'view']);
        });

        test('approval commands are the frozen list/respond group', () => {
            assert.deepStrictEqual([...APPROVAL_COMMANDS], ['list', 'respond']);
        });

        test('evidence commands are the frozen attach/list/verify group', () => {
            assert.deepStrictEqual([...EVIDENCE_COMMANDS], ['attach', 'list', 'verify']);
        });

        test('replay commands are the frozen plan/run/verify group', () => {
            assert.deepStrictEqual([...REPLAY_COMMANDS], ['plan', 'run', 'verify']);
        });

        test('lab commands are the frozen runs/catalog/calibration/recommendations group', () => {
            assert.deepStrictEqual([...LAB_COMMANDS], ['runs', 'catalog', 'calibration', 'recommendations']);
        });

        test('capability-discovery commands are the frozen sources/packs/search group', () => {
            assert.deepStrictEqual([...CAPABILITY_DISCOVERY_COMMANDS], ['sources', 'packs', 'search']);
        });

        test('arg kinds are the closed string/number/boolean/json list', () => {
            assert.deepStrictEqual([...CLI_ARG_KINDS], ['string', 'number', 'boolean', 'json']);
        });

        test('parse mismatch kinds are the closed three-kind list', () => {
            assert.deepStrictEqual([...CLI_PARSE_MISMATCH_KINDS], [
                'missing-argument',
                'unexpected-argument',
                'invalid-argument-value',
            ]);
        });
    });

    suite('the frozen grammar table', () => {
        test('carries 29 commands over the eight journeys', () => {
            assert.equal(CLI_COMMAND_COUNT, 29);
            assert.equal(CLI_COMMAND_GRAMMAR.length, 29);
        });

        test('every journey group size is the order-given count, and the sizes sum to the table', () => {
            const expected: Record<string, number> = {
                'workspace': 3,
                'background-agent': 8,
                'workflow': 3,
                'approval': 2,
                'evidence': 3,
                'replay': 3,
                'lab': 4,
                'capability-discovery': 3,
            };
            let sum = 0;
            for (const journey of CLI_JOURNEYS) {
                const size = grammarFor(journey).length;
                assert.equal(size, expected[journey], `journey '${journey}' group size`);
                sum += size;
            }
            assert.equal(sum, CLI_COMMAND_COUNT);
        });

        test('every path is the dotted journey.command form and paths are unique', () => {
            const paths = CLI_COMMAND_GRAMMAR.map((entry) => entry.path);
            assert.equal(new Set(paths).size, paths.length);
            for (const entry of CLI_COMMAND_GRAMMAR) {
                assert.equal(entry.path, `${entry.journey}.${entry.command}`);
            }
        });

        test('every summary digest is non-empty and every entry declares an argSpec array', () => {
            for (const entry of CLI_COMMAND_GRAMMAR) {
                assert.ok(typeof entry.summaryDigest === 'string' && entry.summaryDigest.length > 0);
                assert.ok(Array.isArray(entry.argSpec));
            }
        });

        test('arg names are unique and non-empty within every entry', () => {
            for (const entry of CLI_COMMAND_GRAMMAR) {
                const names = entry.argSpec.map((spec) => spec.name);
                assert.equal(new Set(names).size, names.length, `entry '${entry.path}'`);
                for (const name of names) {
                    assert.ok(name.length > 0, `entry '${entry.path}'`);
                }
            }
        });

        test('the table is frozen', () => {
            assert.ok(Object.isFrozen(CLI_COMMAND_GRAMMAR));
        });
    });

    suite('grammarFor pure query', () => {
        test('returns exactly the workspace group, all tagged workspace', () => {
            const group = grammarFor('workspace');
            assert.equal(group.length, 3);
            for (const entry of group) {
                assert.equal(entry.journey, 'workspace');
            }
            assert.deepStrictEqual(group.map((entry) => entry.command), ['status', 'list', 'focus']);
        });

        test('returns exactly the eight-command background-agent group', () => {
            const group = grammarFor('background-agent');
            assert.equal(group.length, 8);
            assert.deepStrictEqual(group.map((entry) => entry.command), [
                'launch',
                'inspect',
                'message',
                'pause',
                'stop',
                'cancel',
                'resume',
                'roster',
            ]);
        });

        test('returns exactly the three-command workflow group', () => {
            assert.equal(grammarFor('workflow').length, 3);
        });

        test('returns exactly the two-command approval group', () => {
            assert.equal(grammarFor('approval').length, 2);
        });

        test('returns exactly the three-command evidence group', () => {
            assert.equal(grammarFor('evidence').length, 3);
        });

        test('returns exactly the three-command replay group', () => {
            assert.equal(grammarFor('replay').length, 3);
        });

        test('returns exactly the four-command lab group', () => {
            assert.equal(grammarFor('lab').length, 4);
        });

        test('returns exactly the three-command capability-discovery group', () => {
            assert.equal(grammarFor('capability-discovery').length, 3);
        });

        test('is total and fail-closed: an unknown journey yields the empty group', () => {
            const junk = 'teleport' as CliJourney;
            assert.deepStrictEqual(grammarFor(junk), []);
        });
    });

    suite('lookupGrammar pure query', () => {
        test('resolves a known dotted path to its entry', () => {
            const entry = lookupGrammar('workspace.focus');
            assert.ok(entry !== undefined);
            assert.equal(entry.journey, 'workspace');
            assert.equal(entry.command, 'focus');
            assert.equal(entry.argSpec.length, 1);
            assert.equal(entry.argSpec[0].name, 'workspaceId');
        });

        test('resolves a hyphenated journey path and yields undefined for unknown paths', () => {
            assert.ok(lookupGrammar('background-agent.roster') !== undefined);
            assert.ok(lookupGrammar('workspace.teleport') === undefined);
            assert.ok(lookupGrammar('') === undefined);
        });
    });

    suite('parseSpec positional semantics', () => {
        test('an empty spec over an empty argv parses to the empty args map', () => {
            const entry = lookupGrammar('workspace.status');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, [])), {});
        });

        test('an empty spec over a non-empty argv is a typed unexpected-argument mismatch', () => {
            const entry = lookupGrammar('approval.list');
            assert.ok(entry !== undefined);
            const rejected = mismatched(parseSpec(entry, ['surprise']));
            assert.equal(rejected.kind, 'unexpected-argument');
            assert.equal(rejected.argName, 'surprise');
            assert.ok(rejected.detail.includes('approval.list'));
        });

        test('a required arg present parses into the args map', () => {
            const entry = lookupGrammar('workspace.focus');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['ws-1'])), { workspaceId: 'ws-1' });
        });

        test('a missing required arg is a typed missing-argument mismatch naming it', () => {
            const entry = lookupGrammar('workspace.focus');
            assert.ok(entry !== undefined);
            const rejected = mismatched(parseSpec(entry, []));
            assert.equal(rejected.kind, 'missing-argument');
            assert.equal(rejected.argName, 'workspaceId');
            assert.equal(rejected.expected, 'string');
        });

        test('a trailing optional arg may be absent', () => {
            const entry = lookupGrammar('capability-discovery.search');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['agents'])), { query: 'agents' });
        });

        test('a trailing optional arg may be present', () => {
            const entry = lookupGrammar('capability-discovery.search');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['agents', '10'])), {
                query: 'agents',
                limit: '10',
            });
        });

        test('two required args are consumed in spec order', () => {
            const entry = lookupGrammar('background-agent.message');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['agent-1', 'hello there'])), {
                agentId: 'agent-1',
                message: 'hello there',
            });
        });

        test('tokens beyond the spec are typed unexpected-argument mismatches', () => {
            const entry = lookupGrammar('workspace.focus');
            assert.ok(entry !== undefined);
            const rejected = mismatched(parseSpec(entry, ['ws-1', 'extra']));
            assert.equal(rejected.kind, 'unexpected-argument');
            assert.equal(rejected.argName, 'extra');
        });

        test('a missing required arg mid-spec names it even when later tokens exist', () => {
            const entry = customEntry([
                { name: 'first', required: true, argKind: 'string' },
                { name: 'second', required: false, argKind: 'string' },
            ]);
            const rejected = mismatched(parseSpec(entry, []));
            assert.equal(rejected.kind, 'missing-argument');
            assert.equal(rejected.argName, 'first');
        });
    });

    suite('parseSpec value validation', () => {
        test('a number arg accepts numeric tokens and rejects non-numeric ones', () => {
            const entry = lookupGrammar('lab.runs');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['25'])), { limit: '25' });
            const rejected = mismatched(parseSpec(entry, ['many']));
            assert.equal(rejected.kind, 'invalid-argument-value');
            assert.equal(rejected.argName, 'limit');
            assert.equal(rejected.expected, 'number');
        });

        test('an empty token is not a number', () => {
            const entry = lookupGrammar('lab.runs');
            assert.ok(entry !== undefined);
            const rejected = mismatched(parseSpec(entry, ['']));
            assert.equal(rejected.kind, 'invalid-argument-value');
            assert.equal(rejected.expected, 'number');
        });

        test('a boolean arg accepts exactly true and false', () => {
            const entry = customEntry([{ name: 'wait', required: true, argKind: 'boolean' }]);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['true'])), { wait: 'true' });
            assert.deepStrictEqual(parsed(parseSpec(entry, ['false'])), { wait: 'false' });
            const rejected = mismatched(parseSpec(entry, ['yes']));
            assert.equal(rejected.kind, 'invalid-argument-value');
            assert.equal(rejected.expected, 'boolean');
        });

        test('a json arg accepts valid JSON and rejects invalid JSON', () => {
            const entry = lookupGrammar('background-agent.launch');
            assert.ok(entry !== undefined);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['{"kind":"roster"}'])), {
                agentSpec: '{"kind":"roster"}',
            });
            const rejected = mismatched(parseSpec(entry, ['{not json']));
            assert.equal(rejected.kind, 'invalid-argument-value');
            assert.equal(rejected.expected, 'json');
        });

        test('a string arg accepts reserved-looking tokens without validation', () => {
            const entry = customEntry([{ name: 'label', required: true, argKind: 'string' }]);
            assert.deepStrictEqual(parsed(parseSpec(entry, ['true'])), { label: 'true' });
            assert.deepStrictEqual(parsed(parseSpec(entry, ['{}'])), { label: '{}' });
        });

        test('a required boolean arg missing names its expected kind', () => {
            const entry = customEntry([{ name: 'wait', required: true, argKind: 'boolean' }]);
            const rejected = mismatched(parseSpec(entry, []));
            assert.equal(rejected.kind, 'missing-argument');
            assert.equal(rejected.argName, 'wait');
            assert.equal(rejected.expected, 'boolean');
        });
    });

    suite('parseSpec purity', () => {
        test('never mutates the argv list or the grammar entry', () => {
            const entry = lookupGrammar('background-agent.message');
            assert.ok(entry !== undefined);
            const argv = ['agent-1', 'hello'];
            const argvSnapshot = JSON.parse(JSON.stringify(argv)) as string[];
            const entrySnapshot = JSON.parse(JSON.stringify(entry)) as CliGrammarEntry;
            parseSpec(entry, argv);
            assert.deepStrictEqual(argv, argvSnapshot);
            assert.deepStrictEqual(entry, entrySnapshot);
        });

        test('is deterministic: identical inputs yield identical verdicts', () => {
            const entry = lookupGrammar('evidence.attach');
            assert.ok(entry !== undefined);
            const first = parseSpec(entry, ['task-1', '{"kind":"log"}']);
            const second = parseSpec(entry, ['task-1', '{"kind":"log"}']);
            assert.deepStrictEqual(first, second);
        });
    });
});