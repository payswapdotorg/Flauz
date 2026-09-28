/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * TL2-002 (Worker B) -- the MCP/tool policy drills (M5): fail-closed
 * evaluation (unknown agents, unmatched tools), pattern semantics (exact,
 * trailing-*, bare *), per-agent defaults, MCP server scoping, durable
 * materialization + recovery, strict validation, and the shipped default
 * posture (flauz-agent gets the native tool families, nothing else).
 */

import { test } from 'node:test';
import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert';

import {
	DEFAULT_TOOL_POLICY,
	evaluateMcpServerPolicy,
	evaluateToolPolicy,
	isValidPattern,
	loadToolPolicy,
	parseToolPolicy,
	patternMatches,
	saveToolPolicy,
	ToolPolicyError,
	type ToolPolicyFile,
} from '../src/mcp/policy.ts';
import { makeTempFs } from './fsPort.ts';

test('tool policy: pattern semantics (exact, trailing star, bare star)', () => {
	strictEqual(patternMatches('flauz_terminal', 'flauz_terminal'), true);
	strictEqual(patternMatches('flauz_terminal', 'flauz_terminal2'), false);
	strictEqual(patternMatches('flauz_browser_*', 'flauz_browser_navigate'), true);
	strictEqual(patternMatches('flauz_browser_*', 'flauz_terminal'), false);
	strictEqual(patternMatches('*', 'anything-at-all'), true);
	strictEqual(isValidPattern('ok'), true);
	strictEqual(isValidPattern('ok*'), true);
	strictEqual(isValidPattern('*ok'), false, 'star only valid as the final character');
	strictEqual(isValidPattern('a*b'), false);
	strictEqual(isValidPattern(''), false);
});

test('tool policy: unknown agents are denied (fail closed), with the fix named', () => {
	const verdict = evaluateToolPolicy(DEFAULT_TOOL_POLICY, 'mystery-agent', 'flauz_terminal');
	strictEqual(verdict.allowed, false);
	strictEqual(verdict.basis, 'unknown-agent-deny');
	ok(verdict.explanation.includes('tool-policy.json'));
});

test('tool policy: the shipped default grants flauz-agent the native tool families only', () => {
	strictEqual(evaluateToolPolicy(DEFAULT_TOOL_POLICY, 'flauz-agent', 'flauz_terminal').allowed, true);
	const browser = evaluateToolPolicy(DEFAULT_TOOL_POLICY, 'flauz-agent', 'flauz_browser_navigate');
	strictEqual(browser.allowed, true);
	strictEqual(browser.matchedPattern, 'flauz_browser_*');
	strictEqual(evaluateToolPolicy(DEFAULT_TOOL_POLICY, 'flauz-agent', 'some_mcp_tool').allowed, false, 'unmatched tools default-deny');
	strictEqual(evaluateToolPolicy(DEFAULT_TOOL_POLICY, 'flauz-agent', 'some_mcp_tool').basis, 'entry-default-deny');
	strictEqual(evaluateMcpServerPolicy(DEFAULT_TOOL_POLICY, 'flauz-agent', 'vscode-automation-mcp').allowed, false, 'no MCP servers by default');
});

test('tool policy: entry defaults can allow, and verdicts explain themselves', () => {
	const policy: ToolPolicyFile = {
		schema: 'flauz.tool-policy/v0',
		schemaVersion: 0,
		updatedAt: 1,
		agents: {
			permissive: { default: 'allow', tools: [], mcpServers: ['*'] },
		},
	};
	const allowed = evaluateToolPolicy(policy, 'permissive', 'any_tool');
	strictEqual(allowed.allowed, true);
	strictEqual(allowed.basis, 'entry-default-allow');
	const mcp = evaluateMcpServerPolicy(policy, 'permissive', 'any-server');
	strictEqual(mcp.allowed, true);
	strictEqual(mcp.matchedPattern, '*');
	ok(allowed.explanation.length > 0);
});

test('tool policy: materializes the default on first run and recovers user edits', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const first = await loadToolPolicy(temp.port, stateDir, () => 11);
		deepStrictEqual(Object.keys(first.agents), ['flauz-agent']);
		const text = await temp.port.readFileUtf8(`${stateDir}/tool-policy.json`);
		ok(text !== undefined && text.includes('flauz.tool-policy/v0'));
		// user edit survives (user-owned after materialization)
		const edited: ToolPolicyFile = { schema: 'flauz.tool-policy/v0', schemaVersion: 0, updatedAt: 12, agents: { custom: { default: 'deny', tools: ['t_*'], mcpServers: [] } } };
		await saveToolPolicy(temp.port, stateDir, edited);
		const reloaded = await loadToolPolicy(temp.port, stateDir, () => 13);
		deepStrictEqual(Object.keys(reloaded.agents), ['custom']);
		strictEqual(evaluateToolPolicy(reloaded, 'custom', 't_read').allowed, true);
	} finally {
		temp.cleanup();
	}
});

test('tool policy: corrupt files fail closed with typed errors', async () => {
	const temp = makeTempFs();
	try {
		const stateDir = `${temp.root}/.flauz/models`;
		const { ensureDir } = await import('../src/discovery/stateFiles.ts');
		await ensureDir(temp.port, stateDir);
		await temp.port.writeFile(`${stateDir}/tool-policy.json`, '{"schema":"flauz.tool-policy/v0","agents":{"a":{"default":"maybe"}}}');
		await loadToolPolicy(temp.port, stateDir, () => 0).then(
			() => {
				throw new Error('must not resolve');
			},
			(error: unknown) => {
				ok(error instanceof ToolPolicyError);
				strictEqual(error.code, 'STORE_CORRUPT');
			},
		);
		throws(
			() => parseToolPolicy('{"schema":"flauz.tool-policy/v0","agents":{"a":{"default":"deny","tools":["bad*pattern"]}}}', 'p'),
			(error: unknown): boolean => error instanceof ToolPolicyError && error.code === 'STORE_CORRUPT',
		);
	} finally {
		temp.cleanup();
	}
});
