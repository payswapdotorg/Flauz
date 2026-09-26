/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Partition model (L4): derivation of `persist:flauz-<workspace-hash>[-<agent-id>]`
 * (and the memory-scope form), name-shape validation, containment checks, and
 * the fixture matrix under test/fixtures/browser-policy/partition-cases.json.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
	BrowserPolicyEngine,
	PolicyError,
	checkPartition,
	derivePartition,
	validatePartitionName,
	workspaceHashOf,
	type PartitionRules,
} from '../src/policy.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIXTURE = JSON.parse(readFileSync(path.join(REPO_ROOT, 'test', 'fixtures', 'browser-policy', 'partition-cases.json'), 'utf-8')) as {
	derivations: Array<{ workspaceRoot: string; agentId: string | null; rules: PartitionRules; expectShape: string }>;
	perAgentMisuse: { workspaceRoot: string; agentId: string; rules: PartitionRules; expectError: string };
	badAgentIds: string[];
	names: Array<{ name: string; valid: boolean; scope?: string; workspaceHash?: string; agentId?: string | null }>;
	containment: Array<{ workspaceRoot: string; scope: string; name: string; expect: string }>;
};

// #region Derivation

test('partition derivation follows the documented name shapes (fixture matrix)', () => {
	for (const caseItem of FIXTURE.derivations) {
		const name = derivePartition(caseItem.workspaceRoot, caseItem.agentId ?? undefined, caseItem.rules);
		const hash = workspaceHashOf(caseItem.workspaceRoot);
		const expected = caseItem.expectShape
			.replace('<hash>', hash)
			.replace('<agentId>', caseItem.agentId ?? '');
		assert.equal(name, expected.endsWith('-') ? expected.slice(0, -1) : expected);
	}
});

test('derivation is deterministic and collision-free across distinct roots', () => {
	const a = derivePartition('/ws/acme', undefined, { scope: 'persist', perAgent: false });
	const b = derivePartition('/ws/acme', undefined, { scope: 'persist', perAgent: false });
	const c = derivePartition('/ws/beta', undefined, { scope: 'persist', perAgent: false });
	assert.equal(a, b);
	assert.notEqual(a, c);
	assert.notEqual(a, c);
});

test('workspace hash is 16 lowercase hex chars derived from sha256 of the root', () => {
	const root = '/ws/acme';
	assert.equal(workspaceHashOf(root), createHash('sha256').update(root, 'utf8').digest('hex').slice(0, 16));
	assert.match(workspaceHashOf('/other/root'), /^[0-9a-f]{16}$/);
});

test('same workspace under per-agent rules yields the shared workspace jar when no agentId is passed', () => {
	const rules: PartitionRules = { scope: 'persist', perAgent: true };
	assert.equal(derivePartition('/ws/acme', undefined, rules), derivePartition('/ws/acme', undefined, { scope: 'persist', perAgent: false }));
});

test('asking for a per-agent partition while partitions.perAgent is false is a typed error (fail-closed)', () => {
	const misuse = FIXTURE.perAgentMisuse;
	assert.throws(
		() => derivePartition(misuse.workspaceRoot, misuse.agentId, misuse.rules),
		(err: unknown) => err instanceof PolicyError && err.code === 'FLAUZ_POLICY_PARTITION' && /per-agent partition requested but partitions\.perAgent is false/.test(err.message),
	);
});

test('invalid agent ids are rejected with the partition error class', () => {
	const rules: PartitionRules = { scope: 'persist', perAgent: true };
	for (const bad of FIXTURE.badAgentIds.filter(id => id !== 'x')) {
		assert.throws(
			() => derivePartition('/ws/acme', bad, rules),
			(err: unknown) => err instanceof PolicyError && err.code === 'FLAUZ_POLICY_PARTITION',
			`agentId ${JSON.stringify(bad)} must be rejected`,
		);
	}
	assert.equal(derivePartition('/ws/acme', 'x', rules), `persist:flauz-${workspaceHashOf('/ws/acme')}-x`);
});

test('empty workspace root is a typed error', () => {
	assert.throws(() => workspaceHashOf(''), (err: unknown) => err instanceof PolicyError && err.code === 'FLAUZ_POLICY_PARTITION');
});

// #endregion

// #region Name validation

test('partition name validation matches the fixture matrix (valid shapes parse to parts)', () => {
	for (const entry of FIXTURE.names) {
		const outcome = validatePartitionName(entry.name);
		assert.equal(outcome.ok, entry.valid, `name ${JSON.stringify(entry.name)} expected valid=${String(entry.valid)}`);
		if (entry.valid && outcome.ok) {
			assert.equal(outcome.parts.scope, entry.scope);
			assert.equal(outcome.parts.workspaceHash, entry.workspaceHash);
			assert.equal(outcome.parts.agentId ?? null, entry.agentId);
		}
		if (!entry.valid && !outcome.ok) {
			assert.equal(outcome.error.code, 'FLAUZ_POLICY_PARTITION');
		}
	}
});

test('the in-tree partition families are NOT flauz partitions (rejected by shape)', () => {
	for (const name of ['persist:vscode-browser', 'vscode-browser-ephemeral123', 'vscode-browser-agent-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef']) {
		const outcome = validatePartitionName(name);
		assert.equal(outcome.ok, false, name);
	}
});

// #endregion

// #region Containment

test('containment: derived partition allowed for its workspace; foreign hashes and scope mismatches denied', () => {
	for (const caseItem of FIXTURE.containment) {
		const name = caseItem.name === 'derived'
			? derivePartition(caseItem.workspaceRoot, undefined, { scope: caseItem.scope as 'persist' | 'memory', perAgent: false })
			: caseItem.name.replace('<derived-hash>', workspaceHashOf(caseItem.workspaceRoot));
		const verdict = checkPartition(name, { workspaceRoot: caseItem.workspaceRoot, expectedScope: caseItem.scope as 'persist' | 'memory', initiator: 'agent-tool', ts: 1, policyVersion: 0, policySource: 'builtin-default' });
		assert.equal(verdict.decision, caseItem.expect, `${caseItem.name} (${name}) expected ${caseItem.expect}`);
	}
});

test('containment deny reasons distinguish cross-workspace from scope mismatch', () => {
	const ts = 1;
	const ctx = { initiator: 'agent-tool' as const, ts, policyVersion: 0, policySource: 'builtin-default' as const };
	const cross = checkPartition('persist:flauz-1111111111111111', { workspaceRoot: '/ws/acme', expectedScope: 'persist', ...ctx });
	assert.equal(cross.decision, 'deny');
	assert.match(cross.reason, /cross-workspace partition/);
	const scopeMismatch = checkPartition(derivePartition('/ws/acme', undefined, { scope: 'persist', perAgent: false }), { workspaceRoot: '/ws/acme', expectedScope: 'memory', ...ctx });
	assert.equal(scopeMismatch.decision, 'deny');
	assert.match(scopeMismatch.reason, /scope mismatch/);
	const malformed = checkPartition('total nonsense', { workspaceRoot: '/ws/acme', expectedScope: 'persist', ...ctx });
	assert.equal(malformed.decision, 'deny');
	assert.match(malformed.reason, /malformed partition name/);
});

test('evaluate() surfaces the partition verdict first when a partition is provided', () => {
	const engine = new BrowserPolicyEngine({ policy: { schemaVersion: 0, driver: { enabled: true, allow: ['*'], deny: [], fileRoots: [] }, webRequest: { enabled: true, allow: [], deny: [], fileRoots: [] }, willNavigate: { enabled: true, allow: [], deny: [], fileRoots: [] }, partitions: { scope: 'persist', perAgent: false } } });
	const evaluation = engine.evaluate({ url: 'https://docs.example.com/x', initiator: 'agent-tool', partition: 'bogus-name', workspaceRoot: '/ws/acme' });
	assert.equal(evaluation.final.decision, 'deny');
	assert.equal(evaluation.final.layer, 'partition');
});

test('engine.derivePartition uses the engine policy partition rules', () => {
	const engine = BrowserPolicyEngine.fromPolicyText('{"schemaVersion":0,"partitions":{"scope":"memory","perAgent":true}}');
	const name = engine.derivePartition('/ws/acme', 'agent-7');
	assert.equal(name, `flauz-${workspaceHashOf('/ws/acme')}-agent-7`);
});

// #endregion
