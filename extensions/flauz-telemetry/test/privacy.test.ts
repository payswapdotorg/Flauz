/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy suite (A-PROD-004-W4): the canary sweep -- secrets planted in
 * the durable sources' free-form CONTENTS fields (the routing decision
 * explanation, the failed-step message, the succeeded-step output, the
 * environment label, the workflow tool note) NEVER appear in ANY telemetry
 * surface (the ledger, the config, the report aggregates, the failure
 * census, every command render, the banked evidence row); and the
 * fail-closed backstop: a secret-shaped IDENTITY reaching a would-be row
 * refuses the whole pass with zero bytes written.
 *
 * Secret shapes are assembled from fragments at runtime (the
 * flauz-resources discipline); no complete secret literal is spelled out in
 * this source file.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { TelemetryError } from '../src/api.ts';
import { applyConfigChange, loadTelemetryConfig } from '../src/config.ts';
import { runRecordPass, readTelemetryLedger } from '../src/record.ts';
import { collectReport, renderReportLines } from '../src/report.ts';
import { collectFailureCensus, renderCensusLines } from '../src/failuresList.ts';
import { renderConfigLines } from '../src/config.ts';

import { bootFixtureWorkspace, readAllFiles, type FixtureWorkspace } from './helpers.ts';

/** The assembled canaries (fragments joined at runtime -- never literals in this file). */
function canaries(): string[] {
	return [
		['ghp_', 'TelemetryCanaryOne234567890'].join(''),
		['sk-', 'TelemetryCanaryTwo abcdefghijk'].join(''),
		['AKIA', 'TELEMETRYCANARY3'].join(''),
		['Bearer ', 'telemetry-canary-four-xyz'].join(''),
		['-----BEGIN RSA PRIVATE KEY-----'].join(''),
	];
}

/** Enables telemetry on a fixture (the explicit operator action). */
async function enable(fixture: FixtureWorkspace): Promise<void> {
	const current = await loadTelemetryConfig(fixture.root, fixture.fs);
	await applyConfigChange({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, current, { enable: true });
}

suite('privacy: planted secrets in provider payloads never reach any telemetry surface', () => {

	let fixture: FixtureWorkspace;
	const secrets = canaries();

	suiteSetup(async () => {
		// the fixture plants the canaries in the durable sources' CONTENTS fields
		fixture = await bootFixtureWorkspace({ canaries: secrets });
		await enable(fixture);
		const result = await runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-canary');
		assert.ok(result.rowsAppended > 0, 'the pass records the aggregates');
		assert.ok(result.bankedLedgerRowSeq !== undefined, 'the pass banks the census-visible row');
	});

	suiteTeardown(async () => {
		await fixture.cleanup();
	});

	test('NO canary byte appears in ANY file under .flauz/telemetry/ (ledger + config)', async () => {
		const files = await readAllFiles(path.join(fixture.root, '.flauz', 'telemetry'));
		assert.ok(files.length >= 2, 'the telemetry dir carries the config + the ledger');
		for (const file of files) {
			for (const secret of secrets) {
				assert.equal(file.text.includes(secret), false, `a canary leaked into ${file.path}`);
			}
		}
	});

	test('NO canary byte appears in the banked evidence row (the census-visible surface)', async () => {
		const evidenceText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
		for (const secret of secrets) {
			assert.equal(evidenceText.includes(secret), false, 'a canary leaked into the evidence ledger');
		}
	});

	test('NO canary byte appears in the report render, the failure census render, or the config render', async () => {
		const report = await collectReport({ root: fixture.root, fs: fixture.fs, clock: fixture.clock });
		const renders = [
			renderReportLines(report).join('\n'),
			renderCensusLines(await collectFailureCensus({ root: fixture.root, fs: fixture.fs, clock: fixture.clock })).join('\n'),
			renderConfigLines(await loadTelemetryConfig(fixture.root, fixture.fs)).join('\n'),
		];
		for (const [index, render] of renders.entries()) {
			for (const secret of secrets) {
				assert.equal(render.includes(secret), false, `a canary leaked into render #${String(index)}`);
			}
		}
	});

	test('the ledger rows carry ONLY closed-vocabulary fields (no explanation/message/output/label/note keys anywhere)', async () => {
		const { rows } = await readTelemetryLedger(fixture.root, fixture.fs);
		assert.ok(rows.length > 0);
		for (const row of rows) {
			const serialized = JSON.stringify(row);
			for (const forbidden of ['explanation', 'message', 'output', 'label', 'note', 'prompt', 'completion', 'payload']) {
				assert.equal(serialized.includes(`"${forbidden}"`), false, `the row must not carry the contents-class key '${forbidden}'`);
			}
		}
	});
});

suite('privacy: the fail-closed backstop (a secret-shaped identity refuses the whole pass)', () => {

	let fixture: FixtureWorkspace;

	setup(async () => {
		fixture = await bootFixtureWorkspace();
	});

	teardown(async () => {
		await fixture.cleanup();
	});

	test('a secret-shaped provider id on the routing surface refuses typed with ZERO rows written', async () => {
		await enable(fixture);
		const secret = ['sk-', 'FailClosedCanary12345'].join('');
		const decisionPath = path.join(fixture.root, '.flauz', 'models', 'routing-decisions.jsonl');
		const at = fixture.clock();
		const poisoned = {
			schema: 'flauz.model-routing-decision/v0',
			schemaVersion: 0,
			decisionId: 'rd-900001',
			at,
			purpose: 'the fail-closed leg',
			requirements: { enabledOnly: true },
			selected: { providerId: secret, modelId: 'm' },
			candidates: [{ providerId: secret, modelId: 'm', eligible: true, contextWindowTokens: 8192, locality: 'local' }],
			selectionBasis: 'rule-match',
			explanation: 'ordinary explanation',
		};
		await fs.appendFile(decisionPath, `${JSON.stringify(poisoned)}\n`, 'utf-8');

		await assert.rejects(
			() => runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-failclosed'),
			(err: unknown) => {
				assert.ok(err instanceof TelemetryError);
				assert.equal(err.code, 'FLAUZ_TELEMETRY_SECRET_SHAPED');
				assert.match(err.message, /secret-shaped literal refused/);
				return true;
			},
		);
		// the batch law: NOTHING was written (no partial write)
		const telemetryDir = path.join(fixture.root, '.flauz', 'telemetry');
		const files = await readAllFiles(telemetryDir);
		const ledger = files.find(file => file.path.endsWith('ledger.jsonl'));
		assert.ok(ledger === undefined || !ledger.text.includes('sess-failclosed'), 'the refused pass left no rows');
		for (const file of files) {
			assert.equal(file.text.includes(secret), false);
		}
		const evidenceText = await fs.readFile(path.join(fixture.root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
		assert.equal(evidenceText.includes('flauz-telemetry'), false, 'the refused pass banked nothing');
	});

	test('a secret-shaped session id refuses typed before any observation', async () => {
		await enable(fixture);
		const secret = ['github_pat_', 'SessionCanary_1234567890'].join('');
		await assert.rejects(
			() => runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, secret),
			(err: unknown) => {
				assert.ok(err instanceof TelemetryError);
				assert.equal(err.code, 'FLAUZ_TELEMETRY_SECRET_SHAPED');
				return true;
			},
		);
	});

	test('a secret-shaped environment id in the registry refuses the pass (the sweep covers every identity field)', async () => {
		await enable(fixture);
		const secret = ['xoxb-', 'EnvCanary1234567'].join('');
		await fs.writeFile(path.join(fixture.root, '.flauz', 'environments.json'), JSON.stringify({
			$schema: 'flauz.environments/v0',
			activeId: secret,
			environments: [{
				id: secret,
				kind: 'ssh-local',
				label: 'the poisoned leg',
				connection: { host: 'h', port: 22, user: 'u', authMethod: 'key' },
				trust: { posture: 'unknown', inheritsWorkspaceTrust: false },
				capabilities: { agentHost: false, browser: false, exec: true, terminal: true },
				enabled: true,
				timing: { created: 1, updatedAt: 1 },
			}],
		}, null, 2) + '\n', 'utf-8');
		await assert.rejects(
			() => runRecordPass({ root: fixture.root, fs: fixture.fs, clock: fixture.clock }, 'sess-env-poison'),
			(err: unknown) => {
				assert.ok(err instanceof TelemetryError);
				assert.equal(err.code, 'FLAUZ_TELEMETRY_SECRET_SHAPED');
				return true;
			},
		);
		const telemetryDir = path.join(fixture.root, '.flauz', 'telemetry');
		const files = await readAllFiles(telemetryDir);
		for (const file of files) {
			assert.equal(file.text.includes(secret), false);
			assert.equal(file.text.includes('sess-env-poison'), false);
		}
	});
});
