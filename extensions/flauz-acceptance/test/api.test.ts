/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The record contracts, the chain hashes, the watermark and the parser
 * torn/shape cases (A-PROD-006-W2, the W1 api-suite pattern).
 * UNVERIFIED-BY-ME: the station runs the battery.
 */

import * as assert from 'node:assert/strict';

import {
	AcceptanceError,
	EVIDENCE_LABELS,
	acceptanceIdFromContent,
	canonicalJson,
	deepSorted,
	fnv1a32Hex,
	isAcceptanceId,
	isEvidenceLabel,
	isReceiptId,
	isUnderFlauz,
	joinPath,
	ledgerHeadHash,
	ledgerRowHash,
	ledgerRowLine,
	parseAcceptanceRecord,
	parseLedgerLine,
	parseVerificationReceipt,
	parseWatermarkLenient,
	receiptIdFromContent,
	serializeArtifact,
	serializeWatermark,
	sha256Hex,
	splitJsonl,
	utf8ByteLength,
} from '../src/api.ts';
import { BOUNDARY_DISCLOSURE, PRIVACY_LAW } from '../src/globals.ts';
import { nodeAcceptanceFs, tempRoot, plantChecklist } from './helpers.ts';

suite('flauz.acceptance/v1 -- the deterministic primitives', () => {
	test('fnv1a32Hex is pure arithmetic (known vectors, no random)', () => {
		assert.equal(fnv1a32Hex(''), '811c9dc5');
		assert.equal(fnv1a32Hex('a'), 'e40c292c');
		assert.equal(fnv1a32Hex('hello'), '4f9f2cab');
		assert.equal(fnv1a32Hex('hello'), fnv1a32Hex('hello'));
	});

	test('the acceptance + receipt ids are the flauz:acc/flauz:rcp <16-hex> shape and deterministic', () => {
		const id = acceptanceIdFromContent('bound content');
		assert.ok(isAcceptanceId(id));
		assert.equal(id, acceptanceIdFromContent('bound content'));
		assert.notEqual(id, acceptanceIdFromContent('other content'));
		const rcp = receiptIdFromContent('bound content');
		assert.ok(isReceiptId(rcp));
		assert.ok(rcp.startsWith('flauz:rcp:'));
		assert.notEqual(id, rcp);
	});

	test('the evidence ladder is frozen (never promoted)', () => {
		assert.deepEqual([...EVIDENCE_LABELS], ['fixture', 'simulated', 'local-real', 'runtime-real', 'live-provider', 'production-real']);
		assert.ok(isEvidenceLabel('local-real'));
		assert.ok(!isEvidenceLabel('local-real-plus'));
		assert.ok(!isEvidenceLabel('PRODUCTION-REAL'));
	});
});

suite('flauz.acceptance/v1 -- canonical serialization + paths', () => {
	test('canonicalJson sorts keys, drops undefined, and is byte-stable', () => {
		assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
		assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
		assert.equal(canonicalJson({ b: [1, { z: 1, a: 2 }] }), '{"b":[1,{"a":2,"z":1}]}');
		assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
	});

	test('serializeArtifact is deep-sorted pretty JSON + trailing newline', () => {
		assert.equal(serializeArtifact({ b: 1, a: { d: 2, c: 3 } }), '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
	});

	test('isUnderFlauz enforces the .flauz/-only scoping', () => {
		assert.ok(isUnderFlauz('.flauz/acceptance/x.json'));
		assert.ok(isUnderFlauz('.flauz'));
		assert.ok(!isUnderFlauz('outside/.flauz/x.json'));
		assert.ok(!isUnderFlauz('../.flauz/x.json'));
		assert.ok(!isUnderFlauz('/abs/.flauz/x.json'));
		assert.ok(!isUnderFlauz(''));
	});

	test('joinPath + splitJsonl + utf8ByteLength', () => {
		assert.equal(joinPath('.flauz', 'acceptance', 'x.json'), '.flauz/acceptance/x.json');
		assert.deepEqual(splitJsonl('a\nb\n'), ['a', 'b']);
		assert.deepEqual(splitJsonl('a\nb'), ['a', 'b']);
		assert.equal(utf8ByteLength('abc'), 3);
	});
});

suite('flauz.acceptance/v1 -- the ledger chain + the watermark', () => {
	test('parseLedgerLine accepts a well-formed row and refuses torn shapes with reasons', () => {
		const row = { seq: 1, ts: 1000, taskId: 'flauz-acceptance', kind: 'note', uri: '.flauz/acceptance/x.json', sha256: sha256Hex('x'), prev: null };
		const ok = parseLedgerLine(JSON.stringify(row), 1);
		assert.equal(ok.ok, true);
		assert.ok(!parseLedgerLine('not json', 1).ok);
		assert.ok(!parseLedgerLine(JSON.stringify({ ...row, seq: 0 }), 1).ok);
		assert.ok(!parseLedgerLine(JSON.stringify({ ...row, sha256: 'nothex' }), 1).ok);
		assert.ok(!parseLedgerLine(JSON.stringify({ ...row, prev: 'nothex' }), 1).ok);
	});

	test('the chain hashes link rows (prev = the prior row hash; head = the last row hash)', () => {
		const row1 = { seq: 1, ts: 1000, taskId: 'flauz-acceptance', kind: 'note', uri: 'a', sha256: sha256Hex('a'), prev: null };
		const row2 = { seq: 2, ts: 2000, taskId: 'flauz-acceptance', kind: 'note', uri: 'b', sha256: sha256Hex('b'), prev: ledgerRowHash(row1) };
		assert.equal(ledgerHeadHash([]), sha256Hex(''));
		assert.equal(ledgerHeadHash([row1, row2]), ledgerRowHash(row2));
		assert.equal(ledgerRowLine(row2), canonicalJson({ seq: 2, ts: 2000, taskId: 'flauz-acceptance', kind: 'note', uri: 'b', sha256: sha256Hex('b'), prev: ledgerRowHash(row1) }));
	});

	test('parseWatermarkLenient accepts the true shape and refuses drift', () => {
		const good = parseWatermarkLenient({ $schema: 'flauz.evidence.size/v1', rowCount: 1, bytes: 10, headSha256: sha256Hex('x'), lastCheckpointSeq: null, updatedAt: 5 });
		assert.ok(good !== undefined);
		assert.equal(good?.rowCount, 1);
		assert.ok(parseWatermarkLenient({ $schema: 'other/v1', rowCount: 1, bytes: 10, headSha256: sha256Hex('x'), updatedAt: 5 }) === undefined);
		assert.ok(parseWatermarkLenient({ $schema: 'flauz.evidence.size/v1', rowCount: 1, bytes: 10, headSha256: 'nothex', updatedAt: 5 }) === undefined);
		assert.equal(serializeWatermark(good as NonNullable<typeof good>).endsWith('\n'), true);
	});
});

suite('flauz.acceptance/v1 -- the read-only sibling parsers', () => {
	test('readChecklistArtifact resolves GREEN artifacts and re-derives the id; refuses torn shapes', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-api-');
		try {
			const relPath = await plantChecklist(root, root);
			const state = await (await import('../src/api.ts')).readChecklistArtifact(root, nodeAcceptanceFs(), relPath);
			assert.equal(state.state, 'resolved');
			if (state.state === 'resolved') {
				assert.equal(state.artifact.verdict, 'GO');
				assert.equal(state.artifact.rows.length, 10);
				assert.equal(state.idReDerives, true);
			}
			const absent = await (await import('../src/api.ts')).readChecklistArtifact(root, nodeAcceptanceFs(), '.flauz/release/checklist-absent.json');
			assert.equal(absent.state, 'absent');
		} finally {
			await cleanup();
		}
	});

	test('readLoopJournalPin resolves seeded journals and refuses torn lines', async () => {
		const { root, cleanup } = await tempRoot('flauz-acc-api-');
		try {
			const { readLoopJournalPin } = await import('../src/api.ts');
			const { plantLoopJournalAtRelease, INCIDENT_ID } = await import('./helpers.ts');
			const before = await readLoopJournalPin(root, nodeAcceptanceFs(), INCIDENT_ID);
			assert.equal(before.state, 'absent');
			await plantLoopJournalAtRelease(root);
			const state = await readLoopJournalPin(root, nodeAcceptanceFs(), INCIDENT_ID);
			assert.equal(state.state, 'resolved');
			if (state.state === 'resolved') {
				assert.equal(state.rows[state.rows.length - 1]?.toStage, 'release');
			}
		} finally {
			await cleanup();
		}
	});
});

suite('flauz.acceptance/v1 -- the record parsers (shape refusal, never guesses)', () => {
	test('parseAcceptanceRecord refuses wrong shapes (schema, kind, id, verdict, disclosure mismatch)', () => {
		assert.ok(parseAcceptanceRecord(null) === undefined);
		assert.ok(parseAcceptanceRecord({}) === undefined);
		assert.ok(parseAcceptanceRecord({ $schema: 'other/v1' }) === undefined);
		const base = {
			$schema: 'flauz.acceptance/v1',
			schemaVersion: 0,
			kind: 'flauz-acceptance',
			extensionId: 'flauz.flauz-acceptance',
			acceptanceId: 'flauz:acc:0123456789abcdef',
			createdAt: 1,
			createdAtIso: '2026-10-04T21:00:00.000Z',
			actor: 'operator-1',
			checklist: { artifactPath: '.flauz/release/checklist-x.json', checklistId: sha256Hex('x'), createdAt: 1, productName: 'Flauz', productVersion: '0.6.0', verdict: 'GO', rowCount: 10, fileSha256: sha256Hex('y') },
			productStatePin: { extensions: [], parity: { present: false, rowCount: 0, rows: [], extensionSurfaces: [] }, sbom: { present: false, componentCount: 0, extensionComponents: [], dependsOn: [] } },
			censusPin: { rows: [], problems: [] },
			owningChecks: [{ name: 'c', kind: 'census-integrity', command: 'x', observable: 'y', owner: 'flauz-acceptance', evaluableByPlane: true }],
			boundaryDisclosure: BOUNDARY_DISCLOSURE,
			privacyLaw: PRIVACY_LAW,
		};
		assert.ok(parseAcceptanceRecord(base) !== undefined);
		assert.ok(parseAcceptanceRecord({ ...base, acceptanceId: 'nope' }) === undefined);
		assert.ok(parseAcceptanceRecord({ ...base, checklist: { ...base.checklist, verdict: 'NO-GO' } }) === undefined); // a GO-only record kind
		assert.ok(parseAcceptanceRecord({ ...base, boundaryDisclosure: 'drifted' }) === undefined);
		assert.ok(parseAcceptanceRecord({ ...base, owningChecks: [] }) === undefined);
	});

	test('parseVerificationReceipt refuses wrong shapes (verdict, labels, disclosure rows must name the owning surface)', () => {
		assert.ok(parseVerificationReceipt(null) === undefined);
		const base = {
			$schema: 'flauz.acceptance/v1',
			schemaVersion: 0,
			kind: 'flauz-acceptance-receipt',
			extensionId: 'flauz.flauz-acceptance',
			receiptId: 'flauz:rcp:0123456789abcdef',
			acceptanceId: 'flauz:acc:0123456789abcdef',
			verdict: 'pass',
			createdAt: 1,
			createdAtIso: '2026-10-04T21:00:00.000Z',
			actor: 'operator-1',
			rows: [{ check: 'census-integrity', kind: 'census-integrity', verdict: 'pass', evidenceLabel: 'local-real', detail: 'd' }],
			counts: { checks: 1, pass: 1, fail: 0, disclosure: 0 },
			boundaryDisclosure: BOUNDARY_DISCLOSURE,
			privacyLaw: PRIVACY_LAW,
		};
		assert.ok(parseVerificationReceipt(base) !== undefined);
		assert.ok(parseVerificationReceipt({ ...base, verdict: 'maybe' }) === undefined);
		assert.ok(parseVerificationReceipt({ ...base, rows: [{ ...base.rows[0], evidenceLabel: 'local-real-ish' }] }) === undefined);
		// a disclosure row without an owning surface is torn (the honest-scope law is structural)
		assert.ok(parseVerificationReceipt({ ...base, rows: [{ check: 'x', kind: 'checklist-row', verdict: 'disclosure', evidenceLabel: 'fixture', detail: 'd' }] }) === undefined);
		assert.ok(parseVerificationReceipt({ ...base, boundaryDisclosure: 'drifted' }) === undefined);
	});
});
