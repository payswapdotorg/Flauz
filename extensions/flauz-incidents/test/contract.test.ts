/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The contract pins (A-PROD-006-W1, DL-86): every durable-state shape this
 * extension consults is duplicated in its src as types + parsers -- THIS
 * suite pins the duplication byte-equal against the REAL owning modules
 * (test-time cross-extension imports are the sanctioned pin pattern; src
 * never crosses extension boundaries). The drift protection: a sibling
 * wave that moves a surface path, a record prefix, the loop vocabulary or
 * the source-record shape fails HERE until the consultation contract grows
 * through a reviewed update.
 *
 * THE LOOP VOCABULARY EXACTNESS PIN (DL-86): the loop stages are FROZEN
 * VERBATIM from the handoff's A6 law; the transition map's total (every
 * non-final stage has exactly one forward successor); the evidence-label
 * ladder's exactness; the source-binding kind vocabulary. Any drift in
 * these frozen vocabularies fails HERE.
 */

import * as assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
	INCIDENTS_SCHEMA_ID,
	LOOP_SCHEMA_ID,
	STATUS_SCHEMA_ID,
	INCIDENTS_TASK_ID,
	EXTENSION_ID,
	LEDGER_PATH,
	SIZE_PATH,
	LOOP_STAGES,
	LOOP_FORWARD,
	CLOSURE_STAGE,
	EVIDENCE_LABELS,
	SEVERITIES,
	SOURCE_BINDING_KINDS,
	INCIDENT_ID_SHAPE,
	isIncidentId,
	incidentIdFromSeed,
	canonicalJson,
	serializeArtifact,
	joinPath,
	ledgerRowLine,
	ledgerRowHash,
	ledgerHeadHash,
	parseLedgerLine,
	parseWatermarkLenient,
	serializeWatermark,
	sha256Hex,
	TELEMETRY_FAILURES_SCHEMA_ID,
	DURABILITY_HEARTBEAT_SCHEMA_ID,
	FRICTION_SCHEMA_ID,
	parseTelemetryFailureCensusLenient,
	parseDurabilityHeartbeatLenient,
	parseFrictionRowLenient,
} from '../src/api.ts';
import { INCIDENTS_LEDGER_PATH } from '../src/incidents.ts';
import { bankLedgerRowFor } from '../src/ledger.ts';
import { nodeIncidentsFs, repoRoot, steppingClock, tempRoot, plantEvidenceBodies } from './helpers.ts';

// --- the REAL owning modules (test-time cross-extension imports; the pin pattern) ---
import {
	sha256Hex as isolationSha256Hex,
	canonicalJson as isolationCanonicalJson,
	serializeArtifact as isolationSerializeArtifact,
	ledgerRowLine as isolationLedgerRowLine,
	ledgerRowHash as isolationLedgerRowHash,
	ledgerHeadHash as isolationLedgerHeadHash,
	parseLedgerLine as isolationParseLedgerLine,
	parseWatermarkLenient as isolationParseWatermarkLenient,
	serializeWatermark as isolationSerializeWatermark,
	LEDGER_PATH as OWNER_EVIDENCE_LEDGER_PATH,
	SIZE_PATH as OWNER_EVIDENCE_SIZE_PATH,
	HEARTBEAT_SCHEMA_ID as OWNER_DURABILITY_HEARTBEAT_SCHEMA_ID,
	HEARTBEAT_PREFIX as OWNER_DURABILITY_HEARTBEAT_PREFIX,
	DURABILITY_DIR as OWNER_DURABILITY_DIR,
} from '../../flauz-durability/src/api.ts';
import { LEDGER_PATH as WORKSPACE_LEDGER_PATH, SIZE_PATH as WORKSPACE_SIZE_PATH } from '../../flauz-workspace/src/api.ts';
import { TELEMETRY_FAILURES_SCHEMA_ID as OWNER_TELEMETRY_FAILURES_SCHEMA_ID } from '../../flauz-telemetry/src/failuresList.ts';

// The dogfood friction log is a build/flauz/dogfood/ harness module (not an
// extension). The friction schema id is pinned as a string literal here --
// the contract is the literal 'flauz.dogfood-friction/v1' (the schema the
// frictionlog.mjs FRICTION_SCHEMA constant declares; the contract suite
// pins this wave's duplicated constant against the literal).
const OWNER_FRICTION_SCHEMA = 'flauz.dogfood-friction/v1';

suite('contract -- the order-pinned schema ids + the wave constants', () => {
	test('the order-pinned schema ids (verbatim) + the wave constants', () => {
		assert.equal(INCIDENTS_SCHEMA_ID, 'flauz.incidents/v1');
		assert.equal(LOOP_SCHEMA_ID, 'flauz.incidents-loop/v1');
		assert.equal(STATUS_SCHEMA_ID, 'flauz.incidents-status/v1');
		assert.equal(INCIDENTS_TASK_ID, 'flauz-incidents');
		assert.equal(EXTENSION_ID, 'flauz.flauz-incidents');
		assert.equal(INCIDENTS_LEDGER_PATH, '.flauz/incidents/incidents.json');
	});

	test('the incident id shape + the seed-based id generator (the determinism law)', () => {
		assert.ok(INCIDENT_ID_SHAPE.test('flauz:inc:0123456789abcdef'));
		assert.ok(!INCIDENT_ID_SHAPE.test('flauz:inc:0123456789abcde'), 'too short');
		assert.ok(!INCIDENT_ID_SHAPE.test('flauz:inc:0123456789abcdef0'), 'too long');
		assert.ok(!INCIDENT_ID_SHAPE.test('flauz:inc:GHIJKLMNOPQRSTUV'), 'non-hex');
		assert.ok(isIncidentId('flauz:inc:0123456789abcdef'));
		assert.ok(!isIncidentId('flauz:inc:short'));
		// the seed-based id generator: identical seeds produce identical ids (determinism)
		assert.equal(incidentIdFromSeed('the-alpha-incident'), incidentIdFromSeed('the-alpha-incident'));
		// distinct seeds produce distinct ids
		assert.notEqual(incidentIdFromSeed('the-alpha-incident'), incidentIdFromSeed('the-beta-incident'));
		// the id is the first 16 hex chars of sha256(seed)
		assert.equal(incidentIdFromSeed('the-alpha-incident'), `flauz:inc:${sha256Hex('the-alpha-incident').slice(0, 16)}`);
	});
});

suite('contract -- the frozen loop vocabulary exactness (DL-86, the A6 law verbatim)', () => {
	test('the loop stages are FROZEN VERBATIM from the A6 law (the exact 7-stage list, in order)', () => {
		assert.deepEqual([...LOOP_STAGES], [
			'incident',
			'reproducible-finding',
			'registry-item',
			'fix',
			'regression',
			'release',
			'post-release-verification',
		], 'the A6 law\'s exact stage list, in order, verbatim');
		assert.equal(LOOP_STAGES.length, 7, 'exactly seven stages (the A6 law)');
	});

	test('the transition map total: every non-final stage has exactly one forward successor; the final stage closes the loop', () => {
		assert.equal(LOOP_FORWARD['incident'], 'reproducible-finding');
		assert.equal(LOOP_FORWARD['reproducible-finding'], 'registry-item');
		assert.equal(LOOP_FORWARD['registry-item'], 'fix');
		assert.equal(LOOP_FORWARD['fix'], 'regression');
		assert.equal(LOOP_FORWARD['regression'], 'release');
		assert.equal(LOOP_FORWARD['release'], 'post-release-verification');
		// the final stage (post-release-verification) has no forward successor; the closure
		assert.equal(CLOSURE_STAGE, 'post-release-verification');
		assert.ok(!((LOOP_FORWARD as Record<string, unknown>).hasOwnProperty('post-release-verification')), 'the final stage has no forward successor (the closure)');
		// the transition map's total: 6 forward transitions over 7 stages
		assert.equal(Object.keys(LOOP_FORWARD).length, 6, 'exactly 6 forward transitions (one per non-final stage)');
	});

	test('the evidence-label ladder exactness (frozen, the program\'s evidence law)', () => {
		assert.deepEqual([...EVIDENCE_LABELS], [
			'fixture',
			'simulated',
			'local-real',
			'runtime-real',
			'live-provider',
			'production-real',
		], 'the frozen evidence-label ladder, in order, verbatim');
		assert.equal(EVIDENCE_LABELS.length, 6);
	});

	test('the severity vocabulary (sev1..sev4) + the source-binding kind vocabulary (the four sources)', () => {
		assert.deepEqual([...SEVERITIES], ['sev1', 'sev2', 'sev3', 'sev4']);
		assert.deepEqual([...SOURCE_BINDING_KINDS], ['manual', 'telemetry-census', 'durability-escalation', 'dogfood-friction'], 'the four typed sources, verbatim');
		assert.equal(SOURCE_BINDING_KINDS.length, 4);
	});
});

suite('contract -- the duplicated serialization + chain contracts (byte-equal against the owning modules)', () => {
	test('sha256Hex: byte-equal against node:crypto AND the flauz-durability implementation', () => {
		for (const input of ['', 'flauz', '{"a":1,"b":[1,2,3]}', 'x'.repeat(1000), 'ünïcödé-☂']) {
			const expected = nodeCrypto.createHash('sha256').update(input, 'utf-8').digest('hex');
			assert.equal(sha256Hex(input), expected);
			assert.equal(sha256Hex(input), isolationSha256Hex(input));
		}
	});

	test('canonicalJson + serializeArtifact + the ledger row chain (byte-equal)', () => {
		const row = { seq: 1, ts: 1_740_000_000_000, taskId: 'flauz-incidents', kind: 'note', uri: '.flauz/incidents/incidents.json', sha256: sha256Hex('x'), prev: null } as const;
		assert.equal(canonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }), isolationCanonicalJson({ b: 1, a: [2, { d: null, c: undefined }] }));
		assert.equal(serializeArtifact({ z: 1, a: { y: [1, 2] } }), isolationSerializeArtifact({ z: 1, a: { y: [1, 2] } }));
		assert.equal(ledgerRowLine(row), isolationLedgerRowLine(row));
		assert.equal(ledgerRowHash(row), isolationLedgerRowHash(row));
		assert.equal(ledgerHeadHash([row]), isolationLedgerRowHash(row));
		const mine = parseLedgerLine(ledgerRowLine(row), 1);
		const theirs = isolationParseLedgerLine(isolationLedgerRowLine(row), 1);
		assert.equal(mine.ok, true);
		assert.equal(theirs.ok, true);
		assert.equal(ledgerRowLine((mine as { row: typeof row }).row), isolationLedgerRowLine((theirs as { row: typeof row }).row));
		const watermark = { $schema: 'flauz.evidence.size/v1', rowCount: 0, bytes: 0, headSha256: sha256Hex(''), lastCheckpointSeq: null, updatedAt: 1 } as const;
		assert.deepEqual(parseWatermarkLenient(JSON.parse(serializeWatermark(watermark))), isolationParseWatermarkLenient(JSON.parse(isolationSerializeWatermark(watermark))));
	});

	test('the banking surfaces pin byte-equal against the flauz-workspace owning constants', () => {
		assert.equal(LEDGER_PATH, OWNER_EVIDENCE_LEDGER_PATH);
		assert.equal(SIZE_PATH, OWNER_EVIDENCE_SIZE_PATH);
		assert.equal(LEDGER_PATH, WORKSPACE_LEDGER_PATH);
		assert.equal(SIZE_PATH, WORKSPACE_SIZE_PATH);
	});
});

suite('contract -- the source-record shapes (the typed source bindings\' referenced records)', () => {
	test('the telemetry failure census schema id pins byte-equal against the flauz-telemetry owning constant', () => {
		assert.equal(TELEMETRY_FAILURES_SCHEMA_ID, OWNER_TELEMETRY_FAILURES_SCHEMA_ID);
	});

	test('the durability heartbeat schema id + paths pin byte-equal against the flauz-durability owning constants', () => {
		assert.equal(DURABILITY_HEARTBEAT_SCHEMA_ID, OWNER_DURABILITY_HEARTBEAT_SCHEMA_ID);
		assert.equal('heartbeat-', OWNER_DURABILITY_HEARTBEAT_PREFIX);
		assert.equal('.flauz/durability', OWNER_DURABILITY_DIR);
	});

	test('the dogfood friction log schema id pins byte-equal against the frictionlog.mjs owning constant', () => {
		assert.equal(FRICTION_SCHEMA_ID, OWNER_FRICTION_SCHEMA);
	});

	test('the telemetry failure census lenient parser round-trip', () => {
		const census = {
			$schema: TELEMETRY_FAILURES_SCHEMA_ID,
			generatedAt: 1,
			windowDays: 14,
			totalFailures: 2,
			classes: [
				{ failureClass: 'provider-unreachable', label: 'x', surfaces: ['flauz-models'], affectedIdentities: [], eventCount: 2, timeDistribution: {}, remediation: 'r' },
				{ failureClass: 'model-timeout', label: 'y', surfaces: ['flauz-models'], affectedIdentities: [], eventCount: 0, timeDistribution: {}, remediation: 'r' },
			],
			parseErrorCount: 0,
		};
		const parsed = parseTelemetryFailureCensusLenient(census);
		assert.ok(parsed !== undefined);
		assert.equal(parsed?.classes.length, 2);
		assert.equal(parsed?.classes[0]?.failureClass, 'provider-unreachable');
		// a non-census shape is undefined (typed, never guessed)
		assert.equal(parseTelemetryFailureCensusLenient({ $schema: 'other', classes: [] }), undefined);
		assert.equal(parseTelemetryFailureCensusLenient({ $schema: TELEMETRY_FAILURES_SCHEMA_ID, classes: 'not-array' }), undefined);
	});

	test('the durability heartbeat lenient parser round-trip (the escalation field is the consulted slice)', () => {
		const heartbeat = {
			$schema: DURABILITY_HEARTBEAT_SCHEMA_ID,
			schemaVersion: 0,
			kind: 'flauz-durability-heartbeat',
			createdAt: 1,
			extensionId: 'flauz.flauz-durability',
			boundaryDisclosure: 'x',
			laneId: 'lane-alpha',
			owner: 'flauz-workspace',
			beatAt: 2,
			beatCount: 3,
			ring: [2],
			liveness: 'STALE',
			escalation: { policy: 'checkpoint-and-restart', demandedAt: 2, executionBoundary: 'x' },
		};
		const parsed = parseDurabilityHeartbeatLenient(heartbeat);
		assert.ok(parsed !== undefined);
		assert.equal(parsed?.laneId, 'lane-alpha');
		assert.equal(parsed?.escalation?.policy, 'checkpoint-and-restart');
		// a heartbeat with no escalation field is valid (the binding resolves to false)
		const noEsc = parseDurabilityHeartbeatLenient({ $schema: DURABILITY_HEARTBEAT_SCHEMA_ID, laneId: 'lane-beta' });
		assert.ok(noEsc !== undefined);
		assert.equal(noEsc?.escalation, undefined);
		// a non-heartbeat shape is undefined
		assert.equal(parseDurabilityHeartbeatLenient({ $schema: 'other' }), undefined);
	});

	test('the dogfood friction row lenient parser round-trip', () => {
		const row = { schema: FRICTION_SCHEMA_ID, type: 'friction', ts: 1, phase: 'build', kind: 'failed-task', detail: 'x', recovery: '' };
		const parsed = parseFrictionRowLenient(row);
		assert.ok(parsed !== undefined);
		assert.equal(parsed?.kind, 'failed-task');
		assert.equal(parsed?.phase, 'build');
		// a timing row is not a friction row (typed false)
		assert.equal(parseFrictionRowLenient({ schema: FRICTION_SCHEMA_ID, type: 'timing', ts: 1, phase: 'build', durationMs: 100 }), undefined);
		// a non-friction schema is undefined
		assert.equal(parseFrictionRowLenient({ schema: 'other', type: 'friction' }), undefined);
	});
});

suite('contract -- this manifest shape (the packaging-parity posture)', () => {
	test('this manifest shape (main-only, command-only activation, no browser)', async () => {
		const manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'extensions', 'flauz-incidents', 'package.json'), 'utf-8')) as Record<string, unknown>;
		assert.equal(manifest['name'], 'flauz-incidents');
		assert.equal(manifest['publisher'], 'flauz');
		assert.equal(manifest['main'], './dist/extension.js');
		assert.equal((manifest as { browser?: string }).browser, undefined, 'main-only manifest (the web-blocked posture row)');
		assert.equal(manifest['type'], 'module');
		assert.deepEqual(manifest['engines'], { vscode: '^1.140.0' });
		assert.deepEqual(manifest['activationEvents'], ['onCommand:flauz.incidents.report', 'onCommand:flauz.incidents.advance', 'onCommand:flauz.incidents.status']);
		assert.deepEqual(manifest['devDependencies'], { typescript: '5.9.3' });
	});

	test('the banking cross-recognition: a row banked by THIS writer parses by the flauz-durability contract', async () => {
		const { root, cleanup } = await tempRoot('flauz-inc-ctr-');
		try {
			await bankLedgerRowFor({ root, fs: nodeIncidentsFs(), clock: steppingClock() }, '{"x":1}', '.flauz/incidents/incidents.json');
			const text = await fs.readFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), 'utf-8');
			const line = text.trim();
			const owning = isolationParseLedgerLine(line, 1);
			assert.equal(owning.ok, true, 'the owning parser accepts this extension\'s banked row');
			assert.equal((owning as { row: { taskId: string } }).row.taskId, INCIDENTS_TASK_ID);
		} finally {
			await cleanup();
		}
	});
});
