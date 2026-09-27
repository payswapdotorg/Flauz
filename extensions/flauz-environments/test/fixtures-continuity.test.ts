/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Repo continuity fixture matrix tests (test/fixtures/continuity/): the good
 * pair pins BOTH new envelope shapes (the bundle manifest with all 22
 * surfaces — carried/redacted/lost exactly per the contract — and the ops
 * ledger lines with details + the error payload); EVERY bad fixture is
 * rejected with a `flauz.continuity/v0:`-prefixed typed error (each rule
 * violated at least once).
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalJson } from '../src/api.ts';
import {
	ContinuityOpsLedger,
	parseBundleManifest,
	serializeBundleManifest,
	serializeContinuityOpRecord,
	sha256Hex,
} from '../src/continuityExec/store.ts';

const PREFIX = /flauz\.continuity\/v0:/;

function continuityFixturePath(...segments: readonly string[]): string {
	// test/ -> flauz-environments/ -> extensions/ -> repo root
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'continuity', ...segments);
}

async function readContinuityFixture(...segments: readonly string[]): Promise<string> {
	return await fs.readFile(continuityFixturePath(...segments), { encoding: 'utf-8' });
}

test('the good manifest fixture parses and pins the full surface contract (carried/redacted/lost)', async () => {
	const raw = await readContinuityFixture('good', 'manifest.json');
	const manifest = parseBundleManifest(raw);
	strictEqual(manifest.schema, 'flauz.continuity-bundle/v0');
	strictEqual(manifest.schemaVersion, 0);
	strictEqual(manifest.bundleId, 'flauz:continuity:0123456789abcdef');
	strictEqual(manifest.actor, 'human');
	strictEqual(manifest.sourceEnvironmentId, 'env-source-main');
	strictEqual(manifest.switchPlanRef, 'flauz.switchPlan/v0:env-target-box@1760000090000');
	strictEqual(Object.keys(manifest.surfaces).length, 22, 'the full closed surface table');
	// the three status shapes, exactly
	const carried = Object.values(manifest.surfaces).filter(entry => entry.status === 'carried');
	const redacted = Object.values(manifest.surfaces).filter(entry => entry.status === 'redacted');
	const lost = Object.values(manifest.surfaces).filter(entry => entry.status === 'lost');
	strictEqual(carried.length, 7);
	strictEqual(redacted.length, 3);
	strictEqual(lost.length, 12);
	for (const entry of carried) {
		ok(entry.artifactPath !== undefined && entry.sha256 !== undefined && entry.bytes !== undefined, 'carried entries carry artifact + content hash + bytes');
	}
	for (const entry of lost) {
		ok(entry.artifactPath === undefined && entry.sha256 === undefined && entry.bytes === undefined, 'lost entries carry nothing but the note');
		ok(entry.note !== undefined, 'lost entries carry the why-note');
	}
	// the redaction law: the redacted sha256 IS the sha256 of the surface PATH (re-derivable)
	strictEqual(manifest.surfaces['flauz-evidence-ledger']!.sha256, sha256Hex('.flauz/evidence/ledger.jsonl'));
	strictEqual(manifest.surfaces['flauz-evidence-artifacts']!.sha256, sha256Hex('.flauz/artifacts'));
	strictEqual(manifest.surfaces['flauz-browser-session-journal']!.sha256, sha256Hex('.flauz/browser-sessions.jsonl'));
	// semantic round-trip through the canonical serializer (fixture is TAB-indented;
	// the runtime manifest is 2-space — equal states, not bytes)
	const serialized = serializeBundleManifest(manifest);
	strictEqual(canonicalJson(parseBundleManifest(serialized)), canonicalJson(manifest));
	strictEqual(serialized.endsWith('}\n'), true);
	strictEqual(serialized.includes('\n\n'), false);
});

test('the good ops fixture parses line-by-line and pins the record shapes (details + error payload)', async () => {
	const raw = await readContinuityFixture('good', 'ops.jsonl');
	const records = ContinuityOpsLedger.parseLedger(raw);
	strictEqual(records.length, 4);
	strictEqual(records[0]!.op, 'export');
	strictEqual(records[0]!.result, 'ok');
	strictEqual(records[0]!.actor, 'human');
	deepStrictEqualSorted(records[0]!.details, { fromEnvironmentId: 'env-source-main', surfacesCarried: 7, surfacesLost: 12, surfacesRedacted: 3 });
	strictEqual(records[1]!.op, 'restore');
	deepStrictEqualSorted(records[1]!.details, { fromEnvironmentId: 'env-source-main', toEnvironmentId: 'env-target-box', surfacesCarried: 7, surfacesLost: 12, surfacesRedacted: 3 });
	strictEqual(records[2]!.op, 'verify');
	strictEqual(records[2]!.result, 'error');
	strictEqual(records[2]!.error!.code, 'VERIFY_FAILED');
	strictEqual(records[3]!.op, 'export');
	strictEqual(records[3]!.result, 'error');
	strictEqual(records[3]!.error!.code, 'EXPORT_SECRET_DETECTED');
	// every line round-trips through canonical single-line serialization
	for (let i = 0; i < records.length; i++) {
		strictEqual(raw.split('\n')[i], serializeContinuityOpRecord(records[i]!), `line ${i + 1} is canonical`);
	}
	// the actor coverage pins the provenance surface
	strictEqual(records[1]!.actor, 'agent');
	strictEqual(records[2]!.actor, 'tool');
});

test('every bad fixture is rejected with a schema-prefixed typed error', async () => {
	const badDir = continuityFixturePath('bad');
	const files = (await fs.readdir(badDir)).sort();
	ok(files.length >= 35, `bad matrix covers all rules (found ${files.length} files)`);
	for (const file of files) {
		const raw = await fs.readFile(path.join(badDir, file), { encoding: 'utf-8' });
		if (file.endsWith('.json')) {
			throws(() => parseBundleManifest(raw), PREFIX, `${file} must be rejected by parseBundleManifest`);
		} else {
			throws(() => ContinuityOpsLedger.parseLedger(raw), PREFIX, `${file} must be rejected by the ledger parser`);
		}
	}
});

/** deepStrictEqual over the canonical form (key-order-insensitive). */
function deepStrictEqualSorted(actual: unknown, expected: unknown): void {
	strictEqual(canonicalJson(actual), canonicalJson(expected));
}
