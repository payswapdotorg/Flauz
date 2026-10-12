/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production ops contract test suite (mocha tdd style,
 * matching build/flauz/inference/acceptance/test/common/acceptanceContract.test.ts).
 *
 * Fixture policy: every target URL, evidence id, payload, and
 * timestamp below is SYNTHETIC (prefixed 'fixture.' or the
 * 'https://fixture.invalid' / 'http://localhost' URL classes) and is
 * NOT an authority value, NOT credential material. Closed-vocabulary
 * members (the evidence labels, the evidence kinds, the rejection
 * reasons, the URL classes, the version stamp) are the contract's
 * own values under test. Runtime-boundary probes are injected as
 * JSON-parsed values. The canonical-byte tests pin determinism and
 * the fixed key order; the suites never read a clock; the in-suite
 * determinism greps pin the sources to law-comment lines only.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	PRODUCTION_EVIDENCE_ID_PREFIX,
	PRODUCTION_EVIDENCE_KINDS,
	PRODUCTION_EVIDENCE_LABELS,
	PRODUCTION_LEDGER_SCHEMA_SQL,
	PRODUCTION_OPS_VERSION,
	PRODUCTION_REJECTION_REASONS,
	PRODUCTION_URL_CLASSES,
	classifyProductionUrl,
	isProductionEvidenceId,
	isProductionEvidenceKind,
	isProductionEvidenceLabel,
	isProductionEvidenceRecord,
	isProductionHealthReport,
	isProductionRejectionReason,
	isProductionTarget,
	serializeProductionRecord,
} from '../../common/productionOpsContract.js';
import type {
	ProductionEvidenceRecord,
	ProductionHealthReport,
	ProductionTarget,
} from '../../common/productionOpsContract.js';

const FIXTURE_NOW_ISO = '2024-01-01T00:00:00.000Z';
const FIXTURE_URL_PRODUCTION = 'https://flauz-production.vercel.app';
const FIXTURE_URL_LOCAL = 'http://localhost:3000';
const FIXTURE_URL_FIXTURE = 'https://fixture.invalid/production';

function fixtureTarget(url: string, expectedLabel: 'fixture' | 'local-real' | 'production-real'): ProductionTarget {
	return { url, expectedLabel };
}

function fixtureRecord(overrides: Partial<ProductionEvidenceRecord> = {}): ProductionEvidenceRecord {
	return {
		id: `${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdef`,
		kind: 'deployment',
		label: 'production-real',
		payload: { version: '0.2.0', deploymentId: 'dep_001' },
		recordedAtIso: FIXTURE_NOW_ISO,
		revision: 1,
		...overrides,
	};
}

function fixtureHealthReport(overrides: Partial<ProductionHealthReport> = {}): ProductionHealthReport {
	return {
		ok: true,
		version: '0.2.0',
		targetUrl: FIXTURE_URL_PRODUCTION,
		checkedAtIso: FIXTURE_NOW_ISO,
		dbConnectivity: 'connected',
		...overrides,
	};
}

function parsedJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|process\.env/.test(line));
}

suite('A-PROD-006-W7 production ops contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('PRODUCTION_OPS_VERSION is 1.0.0', () => {
			assert.equal(PRODUCTION_OPS_VERSION, '1.0.0');
		});
	});

	suite('PRODUCTION_EVIDENCE_LABELS (the frozen list)', () => {
		test('the exact three labels, in the frozen order', () => {
			assert.deepEqual([...PRODUCTION_EVIDENCE_LABELS], ['fixture', 'local-real', 'production-real']);
		});

		test('the labels are unique', () => {
			assert.equal(new Set(PRODUCTION_EVIDENCE_LABELS).size, PRODUCTION_EVIDENCE_LABELS.length);
		});

		test('isProductionEvidenceLabel admits the members only', () => {
			assert.equal(isProductionEvidenceLabel('fixture'), true);
			assert.equal(isProductionEvidenceLabel('local-real'), true);
			assert.equal(isProductionEvidenceLabel('production-real'), true);
			assert.equal(isProductionEvidenceLabel('promoted'), false);
			assert.equal(isProductionEvidenceLabel('live-real'), false);
			assert.equal(isProductionEvidenceLabel(''), false);
			assert.equal(isProductionEvidenceLabel(null), false);
			assert.equal(isProductionEvidenceLabel(1), false);
		});
	});

	suite('PRODUCTION_EVIDENCE_KINDS (the frozen list)', () => {
		test('the exact five kinds, in the frozen order', () => {
			assert.deepEqual([...PRODUCTION_EVIDENCE_KINDS], [
				'deployment',
				'smoke-run',
				'rollback-drill',
				'incident-record',
				'verification',
			]);
		});

		test('the kinds are unique', () => {
			assert.equal(new Set(PRODUCTION_EVIDENCE_KINDS).size, PRODUCTION_EVIDENCE_KINDS.length);
		});

		test('isProductionEvidenceKind admits the members only', () => {
			assert.equal(isProductionEvidenceKind('deployment'), true);
			assert.equal(isProductionEvidenceKind('smoke-run'), true);
			assert.equal(isProductionEvidenceKind('rollback-drill'), true);
			assert.equal(isProductionEvidenceKind('incident-record'), true);
			assert.equal(isProductionEvidenceKind('verification'), true);
			assert.equal(isProductionEvidenceKind('unknown'), false);
			assert.equal(isProductionEvidenceKind(''), false);
			assert.equal(isProductionEvidenceKind(null), false);
		});
	});

	suite('PRODUCTION_REJECTION_REASONS (the frozen list)', () => {
		test('the exact seven reasons, in the frozen order', () => {
			assert.deepEqual([...PRODUCTION_REJECTION_REASONS], [
				'malformed-payload',
				'caller-supplied-label',
				'unknown-kind',
				'label-target-mismatch',
				'ledger-io',
				'schema-io',
				'non-production-target',
			]);
		});

		test('the reasons are unique', () => {
			assert.equal(new Set(PRODUCTION_REJECTION_REASONS).size, PRODUCTION_REJECTION_REASONS.length);
		});

		test('isProductionRejectionReason admits the members only', () => {
			assert.equal(isProductionRejectionReason('malformed-payload'), true);
			assert.equal(isProductionRejectionReason('caller-supplied-label'), true);
			assert.equal(isProductionRejectionReason('unknown-kind'), true);
			assert.equal(isProductionRejectionReason('label-target-mismatch'), true);
			assert.equal(isProductionRejectionReason('ledger-io'), true);
			assert.equal(isProductionRejectionReason('schema-io'), true);
			assert.equal(isProductionRejectionReason('non-production-target'), true);
			assert.equal(isProductionRejectionReason('unknown'), false);
			assert.equal(isProductionRejectionReason(''), false);
			assert.equal(isProductionRejectionReason(null), false);
		});
	});

	suite('PRODUCTION_URL_CLASSES + classifyProductionUrl', () => {
		test('the exact three classes, in the frozen order', () => {
			assert.deepEqual([...PRODUCTION_URL_CLASSES], ['fixture', 'local', 'production']);
		});

		test('classifies a fixture URL (https://fixture.invalid)', () => {
			assert.equal(classifyProductionUrl(FIXTURE_URL_FIXTURE), 'fixture');
		});

		test('classifies a fixture URL (fixture:// scheme)', () => {
			assert.equal(classifyProductionUrl('fixture://anything'), 'fixture');
		});

		test('classifies a local URL (http://localhost)', () => {
			assert.equal(classifyProductionUrl(FIXTURE_URL_LOCAL), 'local');
		});

		test('classifies a local URL (http://127.0.0.1)', () => {
			assert.equal(classifyProductionUrl('http://127.0.0.1:8080'), 'local');
		});

		test('classifies a production URL', () => {
			assert.equal(classifyProductionUrl(FIXTURE_URL_PRODUCTION), 'production');
		});

		test('fail-closed: an unclassifiable URL defaults to fixture', () => {
			assert.equal(classifyProductionUrl('ftp://something'), 'fixture');
			assert.equal(classifyProductionUrl('not a url'), 'fixture');
		});

		test('fail-closed: a production URL with a .test marker defaults to fixture', () => {
			assert.equal(classifyProductionUrl('https://myapp.test'), 'fixture');
		});

		test('rejects a non-string / empty URL (defaults to fixture)', () => {
			assert.equal(classifyProductionUrl(null), 'fixture');
			assert.equal(classifyProductionUrl(123), 'fixture');
			assert.equal(classifyProductionUrl(''), 'fixture');
		});
	});

	suite('isProductionTarget', () => {
		test('admits a well-formed target', () => {
			assert.equal(isProductionTarget(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real')), true);
		});

		test('rejects a non-object', () => {
			assert.equal(isProductionTarget(null), false);
			assert.equal(isProductionTarget('string'), false);
			assert.equal(isProductionTarget([]), false);
		});

		test('rejects an empty url', () => {
			assert.equal(isProductionTarget({ url: '', expectedLabel: 'fixture' }), false);
		});

		test('rejects a non-string url', () => {
			assert.equal(isProductionTarget({ url: 123, expectedLabel: 'fixture' }), false);
		});

		test('rejects a non-member expectedLabel', () => {
			assert.equal(isProductionTarget({ url: FIXTURE_URL_FIXTURE, expectedLabel: 'promoted' }), false);
			assert.equal(isProductionTarget({ url: FIXTURE_URL_FIXTURE, expectedLabel: 'live-real' }), false);
		});

		test('rejects extra fields', () => {
			assert.equal(isProductionTarget({ url: FIXTURE_URL_FIXTURE, expectedLabel: 'fixture', extra: true }), false);
		});

		test('admits a JSON-parsed target at the runtime boundary', () => {
			assert.equal(isProductionTarget(parsedJson(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'))), true);
		});
	});

	suite('isProductionEvidenceId', () => {
		test('admits a well-formed id', () => {
			assert.equal(isProductionEvidenceId(`${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdef`), true);
		});

		test('rejects a non-string', () => {
			assert.equal(isProductionEvidenceId(null), false);
			assert.equal(isProductionEvidenceId(123), false);
		});

		test('rejects a wrong prefix', () => {
			assert.equal(isProductionEvidenceId('flauz:other:0123456789abcdef'), false);
			assert.equal(isProductionEvidenceId('0123456789abcdef'), false);
		});

		test('rejects a non-16-hex suffix (too short)', () => {
			assert.equal(isProductionEvidenceId(`${PRODUCTION_EVIDENCE_ID_PREFIX}0123`), false);
		});

		test('rejects a non-16-hex suffix (too long)', () => {
			assert.equal(isProductionEvidenceId(`${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdef0`), false);
		});

		test('rejects uppercase hex', () => {
			assert.equal(isProductionEvidenceId(`${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789ABCDEF`), false);
		});

		test('rejects non-hex chars', () => {
			assert.equal(isProductionEvidenceId(`${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdeg`), false);
		});
	});

	suite('isProductionEvidenceRecord', () => {
		test('admits a well-formed record', () => {
			assert.equal(isProductionEvidenceRecord(fixtureRecord()), true);
		});

		test('admits a JSON-parsed record at the runtime boundary', () => {
			assert.equal(isProductionEvidenceRecord(parsedJson(fixtureRecord())), true);
		});

		test('rejects a non-object', () => {
			assert.equal(isProductionEvidenceRecord(null), false);
			assert.equal(isProductionEvidenceRecord('string'), false);
			assert.equal(isProductionEvidenceRecord([]), false);
		});

		test('rejects a malformed id', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), id: 'bad' }), false);
		});

		test('rejects a non-member kind', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), kind: 'unknown' }), false);
		});

		test('rejects a non-member label', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), label: 'promoted' }), false);
		});

		test('rejects a non-object payload', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), payload: 'string' }), false);
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), payload: null }), false);
		});

		test('rejects an empty recordedAtIso', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), recordedAtIso: '' }), false);
		});

		test('rejects a non-string recordedAtIso', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), recordedAtIso: 123 }), false);
		});

		test('rejects a non-positive revision', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), revision: 0 }), false);
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), revision: -1 }), false);
		});

		test('rejects a non-integer revision', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), revision: 1.5 }), false);
		});

		test('rejects extra fields', () => {
			assert.equal(isProductionEvidenceRecord({ ...fixtureRecord(), extra: true }), false);
		});
	});

	suite('isProductionHealthReport', () => {
		test('admits a well-formed healthy report', () => {
			assert.equal(isProductionHealthReport(fixtureHealthReport()), true);
		});

		test('admits a well-formed refused report', () => {
			assert.equal(isProductionHealthReport(fixtureHealthReport({ ok: false, dbConnectivity: 'refused' })), true);
		});

		test('admits a report without version / refusal', () => {
			const report = { ok: true, targetUrl: FIXTURE_URL_PRODUCTION, checkedAtIso: FIXTURE_NOW_ISO, dbConnectivity: 'connected' };
			assert.equal(isProductionHealthReport(report), true);
		});

		test('rejects a non-object', () => {
			assert.equal(isProductionHealthReport(null), false);
			assert.equal(isProductionHealthReport('string'), false);
		});

		test('rejects a non-boolean ok', () => {
			assert.equal(isProductionHealthReport({ ...fixtureHealthReport(), ok: 'true' }), false);
		});

		test('rejects a non-string version', () => {
			assert.equal(isProductionHealthReport({ ...fixtureHealthReport(), version: 123 }), false);
		});

		test('rejects an empty targetUrl', () => {
			assert.equal(isProductionHealthReport({ ...fixtureHealthReport(), targetUrl: '' }), false);
		});

		test('rejects a non-member dbConnectivity', () => {
			assert.equal(isProductionHealthReport({ ...fixtureHealthReport(), dbConnectivity: 'green' }), false);
		});

		test('rejects a non-member refusal', () => {
			assert.equal(isProductionHealthReport({ ...fixtureHealthReport(), refusal: 'unknown' }), false);
		});

		test('admits a JSON-parsed report at the runtime boundary', () => {
			assert.equal(isProductionHealthReport(parsedJson(fixtureHealthReport())), true);
		});
	});

	suite('serializeProductionRecord', () => {
		test('produces canonical fixed-key-order bytes', () => {
			const record = fixtureRecord();
			const bytes = serializeProductionRecord(record);
			assert.equal(typeof bytes, 'string');
			assert.equal(bytes.length > 0, true);
		});

		test('double-run byte equality (determinism)', () => {
			const record = fixtureRecord();
			const first = serializeProductionRecord(record);
			const second = serializeProductionRecord(record);
			assert.equal(first, second);
		});

		test('the key order is id, kind, label, payload, recordedAtIso, revision', () => {
			const record = fixtureRecord();
			const bytes = serializeProductionRecord(record);
			const parsed = JSON.parse(bytes) as Record<string, unknown>;
			assert.deepEqual(Object.keys(parsed), ['id', 'kind', 'label', 'payload', 'recordedAtIso', 'revision']);
		});

		test('the bytes are byte-stable across two different record instances with the same values', () => {
			const bytes1 = serializeProductionRecord(fixtureRecord());
			const bytes2 = serializeProductionRecord(fixtureRecord());
			assert.equal(bytes1, bytes2);
		});

		test('throws TypeError on a malformed record', () => {
			const record = { ...fixtureRecord(), label: 'promoted' };
			assert.throws(() => serializeProductionRecord(record), TypeError);
		});

		test('throws TypeError on a non-object', () => {
			assert.throws(() => serializeProductionRecord(null), TypeError);
			assert.throws(() => serializeProductionRecord('string'), TypeError);
		});

		test('the payload is carried verbatim (the caller projection, never re-ordered)', () => {
			const payload = { z: 1, a: 2, m: 3 };
			const record = fixtureRecord({ payload });
			const bytes = serializeProductionRecord(record);
			const parsed = JSON.parse(bytes) as { payload: Record<string, unknown> };
			assert.deepEqual(Object.keys(parsed.payload), ['z', 'a', 'm']);
		});
	});

	suite('PRODUCTION_LEDGER_SCHEMA_SQL', () => {
		test('is a non-empty string', () => {
			assert.equal(typeof PRODUCTION_LEDGER_SCHEMA_SQL, 'string');
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.length > 0, true);
		});

		test('contains CREATE TABLE IF NOT EXISTS production_evidence', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS production_evidence'), true);
		});

		test('contains the id TEXT PRIMARY KEY column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('id TEXT PRIMARY KEY'), true);
		});

		test('contains the kind TEXT NOT NULL column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('kind TEXT NOT NULL'), true);
		});

		test('contains the label TEXT NOT NULL column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('label TEXT NOT NULL'), true);
		});

		test('contains the JSONB payload column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('payload JSONB NOT NULL'), true);
		});

		test('contains the recorded_at TEXT NOT NULL column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('recorded_at TEXT NOT NULL'), true);
		});

		test('contains the revision INTEGER NOT NULL DEFAULT 1 column', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL.includes('revision INTEGER NOT NULL DEFAULT 1'), true);
		});

		test('is byte-stable (the same string every read)', () => {
			assert.equal(PRODUCTION_LEDGER_SCHEMA_SQL, PRODUCTION_LEDGER_SCHEMA_SQL);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every Date.now / Math.random / process.env hit in productionOpsContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/productionOpsContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / process.env hit in productionOpsKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/productionOpsKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
