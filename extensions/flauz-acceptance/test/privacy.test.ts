/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The secret-shape canary sweep (A-PROD-006-W2, the W1 pattern).
 * UNVERIFIED-BY-ME: the station runs the battery.
 */

import * as assert from 'node:assert/strict';

import { AcceptanceError, sha256Hex, ledgerRowLine } from '../src/api.ts';
import { looksSecretShaped, assertNoSecretShapedValues, sweepArtifact } from '../src/privacy.ts';
import { secretShapedFragment } from './helpers.ts';

suite('flauz.acceptance/v1 -- the secret-shape canary sweep', () => {
	test('looksSecretShaped matches the known credential shapes (assembled from fragments at runtime)', () => {
		assert.ok(looksSecretShaped(secretShapedFragment()));
		assert.ok(looksSecretShaped(['sk-', 'ant-abc-def-ghi-jkl-mno'].join('')));
		assert.ok(looksSecretShaped(['-----BEGIN ', 'RSA PRIVATE KEY-----'].join('')));
		assert.ok(looksSecretShaped(['Bearer ', 'aaaaaaaaaaaaaaaaaaaa'].join('')));
		assert.ok(!looksSecretShaped('an ordinary repro-free detail'));
		assert.ok(!looksSecretShaped('.flauz/acceptance/acceptance-flauz:acc:0123456789abcdef.json'));
	});

	test('assertNoSecretShapedValues refuses deep (arrays + nested objects), typed fail-closed', () => {
		assert.throws(
			() => assertNoSecretShapedValues({ rows: [{ detail: secretShapedFragment() }] }, 'artifact'),
			(err: unknown) => err instanceof AcceptanceError && err.code === 'FLAUZ_ACCEPTANCE_SECRET_SHAPED' && String((err as AcceptanceError).message).includes('rows[0].detail'),
		);
		assertNoSecretShapedValues({ rows: [{ detail: 'an ordinary detail' }] }, 'artifact');
	});

	test('sweepArtifact is the pre-write backstop over a whole assembled artifact', () => {
		assert.throws(() => sweepArtifact({ boundaryDisclosure: secretShapedFragment() }, 'acceptance-record'), (err: unknown) => err instanceof AcceptanceError);
		sweepArtifact({ verdict: 'pass', counts: { checks: 1 } }, 'receipt');
	});

	test('the canary law: the banked census row carries the sha256 of the artifact, NEVER the artifact body -- a secret-shaped detail never reaches a banked row', () => {
		const artifactLine = JSON.stringify({ detail: secretShapedFragment() });
		const row = { seq: 1, ts: 1, taskId: 'flauz-acceptance', kind: 'note', uri: '.flauz/acceptance/x.json', sha256: sha256Hex(artifactLine), prev: null };
		const bankedLine = ledgerRowLine(row);
		assert.ok(!bankedLine.includes(secretShapedFragment())); // the banked row carries the hash, never the content
		assert.ok(bankedLine.includes(sha256Hex(artifactLine)));
	});
});
