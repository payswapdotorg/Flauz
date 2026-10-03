/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The privacy suite (A-PROD-005-W3): the canary sweep laws over the
 * isolation surfaces -- pattern battery, fail-closed refusal, the full-run
 * byte scan, the contents-never-ride law, the port-owned-surface boundary.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { IsolationError, joinPath } from '../src/api.ts';
import { ISOLATION_TASK_ID } from '../src/api.ts';
import { runAudit, persistAudit, renderAudit } from '../src/audit.ts';
import { runEnforce, persistEnforce, renderEnforce } from '../src/enforce.ts';
import { looksSecretShaped, sweepArtifact } from '../src/privacy.ts';
import { bankedUriIsPortOwned } from '../src/banking.ts';
import { looksSecretShaped as integrityLooksSecretShaped } from '../../flauz-integrity/src/privacy.ts';
import {
	nodeIsolationFs,
	steppingClock,
	tempRoot,
	plantFixtureProduct,
	plantFixtureWorkspace,
	plantStrayRecord,
	plantNestedFlauzTree,
	readAllFiles,
	canaryToken,
} from './helpers.ts';

const fsPort = nodeIsolationFs();

suite('privacy — the pattern battery (assembled from fragments at runtime; the no-literal law)', () => {
	test('every known credential shape is detected', () => {
		for (const kind of ['github', 'openai', 'aws', 'bearer', 'pem'] as const) {
			assert.equal(looksSecretShaped(canaryToken(kind)), true, `the ${kind} canary is secret-shaped`);
		}
	});

	test('ordinary metadata is NEVER flagged (paths, hashes, stamps, ids, verdicts, classifications)', () => {
		const ordinary = [
			'.flauz/isolation/audit-2026-10-03T000000.000Z.json',
			'.flauz-exports/export-2026-10-03T000000.000Z/state/evidence/ledger.jsonl',
			'a'.repeat(64),
			'flauz-isolation',
			'workspace-exportable',
			'BOUNDARY_VIOLATION',
			'green / violation / unknown / absent',
			'target .flauz/telemetry/config.json',
			'ed25519',
			'extensions/flauz-isolation/package.json',
			'AKIA notes are uppercase but the shape needs exactly 16 chars after',
		];
		for (const value of ordinary) {
			assert.equal(looksSecretShaped(value), false, `ordinary metadata must never be flagged: ${value.slice(0, 40)}`);
		}
	});

	test('the pattern battery matches the owning flauz-integrity implementation (the W2 posture, contract-pinned)', () => {
		const battery = [
			...(['github', 'openai', 'aws', 'bearer', 'pem'] as const).map(kind => canaryToken(kind)),
			'.flauz/isolation/audit-2026-10-03T000000.000Z.json',
			'b'.repeat(64),
			'flauz-isolation',
		];
		for (const value of battery) {
			assert.equal(looksSecretShaped(value), integrityLooksSecretShaped(value), `the sweep agrees with the owning implementation over: ${value.slice(0, 30)}`);
		}
	});
});

suite('privacy — the fail-closed refusal (typed, before a single byte is written)', () => {
	test('a secret-shaped value deep inside an audit-shaped record refuses the whole sweep', () => {
		const poisoned = {
			$schema: 'flauz-isolation-audit/v1',
			surfaces: [{ id: 'tasks', owner: 'flauz-workspace', paths: [canaryToken('github')] }],
		};
		assert.throws(() => sweepArtifact(poisoned, 'isolation-audit'), (err: unknown) => err instanceof IsolationError && err.code === 'FLAUZ_ISOLATION_SECRET_SHAPED');
	});

	test('a secret-shaped value deep inside an enforce-shaped record refuses the whole sweep', () => {
		const poisoned = {
			$schema: 'flauz-isolation-enforce/v1',
			checks: [{ id: 'crossWorkspaceCensus', verdict: 'green', reasons: [`nested at ${canaryToken('pem')}`] }],
		};
		assert.throws(() => sweepArtifact(poisoned, 'isolation-enforce'), (err: unknown) => err instanceof IsolationError && err.code === 'FLAUZ_ISOLATION_SECRET_SHAPED');
	});

	test('the refusal names the JSON-path location (the typed error detail)', () => {
		try {
			sweepArtifact({ surfaces: [{ paths: [canaryToken('aws')] }] }, 'isolation-audit');
			throw new Error('the sweep must refuse');
		} catch (err) {
			assert.ok(err instanceof IsolationError);
			assert.match(err.message, /surfaces\[0\].paths\[0\]/);
		}
	});
});

suite('privacy — the full-run byte scan (every written byte + every render line, canary-clean)', () => {
	test('a full audit + enforce run over a fixture workspace writes only canary-clean bytes', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-pri-');
		try {
			await plantFixtureProduct(root);
			await plantFixtureWorkspace(root, { withEvidence: true, withTelemetry: true, withIntegrity: true, withExport: true }, steppingClock());
			const clock = steppingClock();
			const audit = await runAudit({ root, productRoot: root, fs: fsPort, clock });
			const persistedAudit = await persistAudit({ root, fs: fsPort, clock }, audit.record);
			const enforce = await runEnforce({ root, fs: fsPort, clock });
			const persistedEnforce = await persistEnforce({ root, fs: fsPort, clock }, enforce.record);
			const renderLines = [...renderAudit(audit), ...renderEnforce(enforce)];
			// every byte under .flauz/ (the isolation records + the banked evidence + the port-owned store)
			const files = await readAllFiles(path.join(root, '.flauz'));
			assert.ok(files.length >= 4, 'the run wrote its records + banked its rows');
			for (const file of files) {
				assert.equal(looksSecretShaped(file.text), false, `a written artifact is canary-clean: ${path.relative(root, file.path)}`);
				assert.ok(!file.text.includes('ghp_'), `no ghp_ fragment in ${path.relative(root, file.path)}`);
				assert.ok(!file.text.includes('sk-ant-'), `no sk-ant- fragment in ${path.relative(root, file.path)}`);
				assert.ok(!file.text.includes('BEGIN'), `no PEM marker in ${path.relative(root, file.path)}`);
			}
			for (const line of renderLines) {
				assert.equal(looksSecretShaped(line), false, 'a render line is canary-clean');
			}
			// the persisted paths are the expected lawful homes
			assert.ok(persistedAudit.recordPath.endsWith('.json'));
			assert.ok(persistedEnforce.recordPath.includes(joinPath('.flauz', 'isolation')));
		} finally {
			await cleanup();
		}
	});

	test('a violation-laden run stays canary-clean (the violation rows carry PATHS, never contents)', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-pri-');
		try {
			await plantFixtureProduct(root);
			await plantFixtureWorkspace(root, { withEvidence: true }, steppingClock());
			// a stray record whose CONTENTS carry a canary: the violation row must carry the path only
			const stray = await plantStrayRecord(root, 'leaky');
			await fs.writeFile(path.join(root, stray), JSON.stringify({ note: canaryToken('openai') }), 'utf-8');
			await plantNestedFlauzTree(root);
			const audit = await runAudit({ root, productRoot: root, fs: fsPort, clock: steppingClock() });
			const serialized = JSON.stringify(audit.record);
			assert.ok(serialized.includes('record-outside-boundary'), 'the stray is disclosed');
			assert.equal(looksSecretShaped(serialized), false, 'the record stays canary-clean');
			assert.ok(!serialized.includes('sk-ant-'), 'the stray record CONTENTS never ride the audit record');
			for (const line of renderAudit(audit)) {
				assert.equal(looksSecretShaped(line), false);
			}
		} finally {
			await cleanup();
		}
	});
});

suite('privacy — the port-owned-surface boundary (the key store never rides a record)', () => {
	test('the port-owned store path is never a banked uri + the boundary helper holds', async () => {
		const { root, cleanup } = await tempRoot('flauz-iso-pri-');
		try {
			await plantFixtureProduct(root);
			await plantFixtureWorkspace(root, { withEvidence: true, withIntegrity: true }, steppingClock());
			const clock = steppingClock();
			const audit = await runAudit({ root, productRoot: root, fs: fsPort, clock });
			const persistedAudit = await persistAudit({ root, fs: fsPort, clock }, audit.record);
			// the port-owned path shape helper (the banking module's own boundary law)
			assert.equal(bankedUriIsPortOwned('.flauz/integrity/keys/ed25519-local-dev.json', '.flauz/integrity/keys/ed25519-local-dev.json'), true);
			assert.equal(bankedUriIsPortOwned('.flauz/isolation/audit-x.json', '.flauz/integrity/keys/ed25519-local-dev.json'), false);
			// the real banked rows: only the audit record uri rides, never the key store
			const ledger = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
			const auditRecordUri = '.flauz/isolation/' + path.basename(persistedAudit.recordPath);
			let auditRowSeen = false;
			for (const line of ledger.split('\n').filter(text => text !== '')) {
				const row = JSON.parse(line) as { taskId: string; uri: string };
				assert.equal(bankedUriIsPortOwned(row.uri, '.flauz/integrity/keys/ed25519-local-dev.json'), false, `the banked uri is never the port-owned store: ${row.uri}`);
				if (row.uri === auditRecordUri) {
					auditRowSeen = true;
					assert.equal(row.taskId, ISOLATION_TASK_ID, 'the banked audit-record row carries the isolation taskId');
				}
			}
			assert.equal(auditRowSeen, true, 'the audit record is banked census-visible');
			// the audit record CLASSIFIES the store (port-owned) without ever embedding its material
			const keyStoreRow = audit.record.surfaces.find(surface => surface.id === 'integrityKeyStore');
			assert.ok(keyStoreRow !== undefined);
			assert.equal(keyStoreRow.present, true);
			const serialized = JSON.stringify(audit.record);
			assert.ok(!serialized.includes('privateKeyHex'), 'the store material never rides the record');
			assert.ok(!serialized.includes('publicKeyHex'), 'not even the public key rides the record (shapes only: paths + classification)');
		} finally {
			await cleanup();
		}
	});
});
