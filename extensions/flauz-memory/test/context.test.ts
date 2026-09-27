/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Context compiler tests (TL2-003 M2): assembly priority, provenance into
 * the prompt, budget enforcement + truncation records, section caps, the
 * budget seam shape, resource fragments from descriptor fixtures, and the
 * determinism proof (contentHash).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileContext, type CompiledContext, type ContextBudget, type ResourceFragment } from '../src/context.ts';
import type { MemoryRecord } from '../src/api.ts';

const NOW = 1_740_100_000_000;
const FIXTURES = new URL('../../../test/fixtures/memory/', import.meta.url).pathname;

function record(overrides: Partial<MemoryRecord> & { id: string; tier: MemoryRecord['tier'] }): MemoryRecord {
	return {
		taskId: null,
		agentId: null,
		kind: 'observation',
		content: `content of ${overrides.id}`,
		tags: [],
		pinned: false,
		timing: { created: NOW - 1000, updatedAt: NOW - 1000 },
		provenance: { actor: 'agent', origin: 'task-event', contentHash: '0'.repeat(64), ts: NOW - 1000, evidenceId: null },
		...overrides,
	};
}

const BUDGET: ContextBudget = {
	model: { id: 'fixture-model-128k' },
	window: { inputTokens: 512, outputTokens: 256 },
};

test('sections assemble in priority order with provenance tags in the prompt', () => {
	const records = [
		record({ id: 'MEM-S-000001', tier: 'session', taskId: 'T-001', agentId: 'flauz.agent', kind: 'evidence-ref', provenance: { actor: 'tool', origin: 'ledger-row', contentHash: '0'.repeat(64), ts: NOW - 1000, evidenceId: 'E-000003' } }),
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const { context } = compileContext({
		taskId: 'T-001',
		agentId: 'flauz.agent',
		budget: BUDGET,
		records,
		taskBrief: { title: 'Fix login flow', status: 'execute' },
		nowMs: NOW,
	});
	assert.deepEqual(context.sections.map(section => section.role), ['system', 'working', 'task-memory', 'project-memory', 'resources']);
	assert.ok(context.sections[0]?.content.includes('Task: Fix login flow [status: execute]'));
	assert.ok(context.sections[1]?.content.includes('[record MEM-S-000001]'));
	assert.ok(context.sections[1]?.content.includes('[evidence E-000003]'));
	assert.ok(context.sections[2]?.content.includes('[record MEM-T-001-000001]'));
	assert.ok(context.sections[3]?.content.includes('[record MEM-P-000001]'));
	// Provenance surfaces structurally too.
	assert.deepEqual(context.sections[1]?.provenance, [{ recordId: 'MEM-S-000001', evidenceId: 'E-000003' }]);
	assert.deepEqual(context.sections[3]?.provenance, [{ recordId: 'MEM-P-000001', evidenceId: null }]);
});

test('determinism proof: same inputs produce the identical contentHash', () => {
	const records = [
		record({ id: 'MEM-S-000001', tier: 'session', taskId: 'T-001', agentId: 'flauz.agent' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const input = {
		taskId: 'T-001',
		agentId: 'flauz.agent',
		budget: BUDGET,
		records,
		nowMs: NOW,
	};
	const first: CompiledContext = compileContext(input).context;
	const second: CompiledContext = compileContext(input).context;
	assert.equal(first.contentHash, second.contentHash);
	assert.equal(first.contentHash.length, 64);
	// Different nowMs -> different compilation (generatedAt is part of the hash input).
	const later: CompiledContext = compileContext({ ...input, nowMs: NOW + 1000 }).context;
	assert.notEqual(first.contentHash, later.contentHash);
});

test('budget enforcement truncates least-relevant lines first and records every drop', () => {
	const records: MemoryRecord[] = [
		record({ id: 'MEM-S-000001', tier: 'session', taskId: 'T-001', agentId: 'flauz.agent', pinned: true }),
	];
	for (let n = 1; n <= 6; n++) {
		records.push(record({ id: `MEM-P-${String(n).padStart(6, '0')}`, tier: 'project', content: `project note ${String(n)} with some words to burn tokens quickly` }));
	}
	const small: ContextBudget = { model: { id: 'fixture-model-small' }, window: { inputTokens: 90, outputTokens: 32 } };
	const { context, accounting } = compileContext({
		taskId: 'T-001',
		agentId: 'flauz.agent',
		budget: small,
		records,
		nowMs: NOW,
	});
	assert.ok(accounting.consumed <= small.window.inputTokens, `consumed ${String(accounting.consumed)} must fit ${String(small.window.inputTokens)}`);
	assert.ok(context.truncations.length > 0);
	assert.ok(context.truncations.every(row => row.reason === 'budget-exceeded'));
	// Project memory drops before working memory (assembly priority).
	assert.ok(context.truncations.some(row => row.section === 'project-memory'));
	assert.ok(!context.truncations.some(row => row.section === 'working'));
	assert.ok(!context.truncations.some(row => row.section === 'system'));
	// The pinned session record survives.
	assert.ok(context.sections[1]?.content.includes('MEM-S-000001'));

	// A budget BELOW the never-dropping core (system preamble + section
	// headers) cannot be met by dropping content lines: the compiler emits
	// as-is (documented) - the accounting row shows consumed > budget and the
	// system section survives untouched.
	const impossible: ContextBudget = { model: { id: 'fixture-model-impossible' }, window: { inputTokens: 10, outputTokens: 8 } };
	const overBudget = compileContext({ taskId: 'T-001', agentId: 'flauz.agent', budget: impossible, records, nowMs: NOW });
	assert.ok(overBudget.accounting.consumed > impossible.window.inputTokens);
	assert.ok(overBudget.context.sections[0]?.role === 'system' && overBudget.context.sections[0].content.includes('Flauz context'));
});

test('section caps produce section-cap truncation records', () => {
	const records: MemoryRecord[] = [];
	for (let n = 1; n <= 5; n++) {
		records.push(record({ id: `MEM-P-${String(n).padStart(6, '0')}`, tier: 'project', content: `project note ${String(n)}` }));
	}
	const capped: ContextBudget = { model: { id: 'fixture-model' }, window: { inputTokens: 512, outputTokens: 256 }, sectionCaps: { 'project-memory': 10 } };
	const { context } = compileContext({ agentId: 'flauz.agent', budget: capped, records, nowMs: NOW });
	const project = context.sections.find(section => section.role === 'project-memory');
	assert.ok(project !== undefined && project.tokens <= 10 + 4, `project section tokens ${String(project?.tokens)} near the 10-token cap (header counts)`);
	assert.ok(context.truncations.some(row => row.reason === 'section-cap' && row.section === 'project-memory'));
});

test('resource fragments render with ref ids and provenance tags (descriptor fixtures)', () => {
	const envDescriptor = JSON.parse(readFileSync(join(FIXTURES, 'descriptors', 'environment-descriptor.json'), { encoding: 'utf-8' })) as Record<string, unknown>;
	const browserDescriptor = JSON.parse(readFileSync(join(FIXTURES, 'descriptors', 'browser-session-descriptor.json'), { encoding: 'utf-8' })) as Record<string, unknown>;
	const fragments: ResourceFragment[] = [
		{
			refId: `environment:${String(envDescriptor.id)}`,
			kind: 'environment',
			uri: `flauz-env://${String(envDescriptor.id)}`,
			content: `Environment ${String(envDescriptor.label)} (kind ${String(envDescriptor.kind)}, trust ${String((envDescriptor.trust as Record<string, unknown>)?.posture)})`,
			provenanceTags: [`environment:${String(envDescriptor.id)}`, `kind:${String(envDescriptor.kind)}`],
		},
		{
			refId: `browser:${String(browserDescriptor.sessionId)}`,
			kind: 'browser-session',
			uri: `flauz-browser://${String(browserDescriptor.sessionId)}`,
			content: `Browser session ${String(browserDescriptor.sessionId)} opened by ${String(browserDescriptor.initiator)} under partition ${String(browserDescriptor.partition)}`,
			provenanceTags: [`browser:${String(browserDescriptor.sessionId)}`, `initiator:${String(browserDescriptor.initiator)}`],
		},
	];
	const { context } = compileContext({ agentId: 'flauz.agent', budget: BUDGET, records: [], resourceFragments: fragments, nowMs: NOW });
	const resources = context.sections.find(section => section.role === 'resources');
	assert.ok(resources !== undefined && resources.content.includes('[ref environment:env-local-1]'));
	assert.ok(resources?.content.includes('[environment:env-local-1] [kind:container]'));
	assert.ok(resources?.content.includes('[ref browser:flauz:browser:0123456789abcdef]'));
	assert.deepEqual(resources?.provenance.map(p => p.refId), ['environment:env-local-1', 'browser:flauz:browser:0123456789abcdef']);
});

test('private-context boundary: peer records never enter the peer context (ids only)', () => {
	const records = [
		record({ id: 'MEM-T-001-000001', tier: 'task', taskId: 'T-001', agentId: 'flauz.agent.worker-1', content: 'worker-1 private finding' }),
		record({ id: 'MEM-P-000001', tier: 'project' }),
	];
	const { context } = compileContext({ taskId: 'T-001', agentId: 'flauz.agent', budget: BUDGET, records, nowMs: NOW });
	assert.ok(!context.sections.some(section => section.content.includes('worker-1 private finding')));
	assert.deepEqual(context.excludedPrivate, ['MEM-T-001-000001']);
});

test('ranking rules are recorded with the compiled context', () => {
	const { context } = compileContext({ agentId: 'flauz.agent', budget: BUDGET, records: [record({ id: 'MEM-P-000001', tier: 'project' })], nowMs: NOW });
	const ruleIds = context.rankingRules.map(rule => rule.ruleId);
	assert.deepEqual(ruleIds, ['scope-match', 'recency-decay', 'tag-overlap', 'kind-weight', 'pin-boost']);
});

test('the budget seam is data: model id never branches, output tokens never charged to input', () => {
	const records = [record({ id: 'MEM-P-000001', tier: 'project' })];
	const a = compileContext({ agentId: 'flauz.agent', budget: { model: { id: 'vendor-a' }, window: { inputTokens: 512, outputTokens: 256 } }, records, nowMs: NOW });
	const b = compileContext({ agentId: 'flauz.agent', budget: { model: { id: 'vendor-b' }, window: { inputTokens: 512, outputTokens: 999 } }, records, nowMs: NOW });
	// Identical input budget + records -> identical sections; model id and
	// reserved output tokens are provenance/accounting only.
	assert.deepEqual(a.context.sections, b.context.sections);
	assert.equal(a.accounting.reservedOutput, 256);
	assert.equal(b.accounting.reservedOutput, 999);
	assert.equal(a.accounting.consumed, b.accounting.consumed);
});
