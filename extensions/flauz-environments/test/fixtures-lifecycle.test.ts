/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Repo PIN-2 fixture matrix tests (test/fixtures/environments-lifecycle/):
 * the good pair pins both envelope shapes (phases + the /attached substate +
 * the error record); EVERY bad fixture is rejected with a
 * `flauz.environments-lifecycle/v0:`-prefixed typed error (each rule
 * violated at least once).
 */
import { test } from 'node:test';
import { ok, strictEqual, throws } from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { canonicalJson } from '../src/api.ts';
import { LifecycleStore, parseLifecycleEnvelope, serializeLifecycleEnvelope, serializeOpRecord } from '../src/lifecycle/store.ts';

const PREFIX = /flauz\.environments-lifecycle\/v0:/;

function lifecycleFixturePath(...segments: readonly string[]): string {
	// test/ -> flauz-environments/ -> extensions/ -> repo root
	return path.join(path.resolve(import.meta.dirname, '..', '..', '..'), 'test', 'fixtures', 'environments-lifecycle', ...segments);
}

async function readLifecycleFixture(...segments: readonly string[]): Promise<string> {
	return await fs.readFile(lifecycleFixturePath(...segments), { encoding: 'utf-8' });
}

test('the good lifecycle fixture parses and pins every phase + the /attached substate', async () => {
	const envelope = parseLifecycleEnvelope(await readLifecycleFixture('good', 'lifecycle.json'));
	strictEqual(envelope.schema, 'flauz.environments-lifecycle/v0');
	strictEqual(envelope.schemaVersion, 0);
	strictEqual(Object.keys(envelope.entries).length, 6);
	strictEqual(envelope.entries['env-fixture-running']?.state, 'running');
	strictEqual(envelope.entries['env-fixture-attached']?.state, 'running/attached');
	strictEqual(envelope.entries['env-fixture-stopped']?.state, 'stopped');
	strictEqual(envelope.entries['env-fixture-failed']?.state, 'failed');
	strictEqual(envelope.entries['env-fixture-destroyed']?.state, 'destroyed');
	// semantic round-trip through the canonical serializer (fixture is
	// TAB-indented; the runtime file is 2-space — equal states, not bytes)
	const serialized = serializeLifecycleEnvelope(envelope);
	strictEqual(canonicalJson(parseLifecycleEnvelope(serialized)), canonicalJson(envelope));
	strictEqual(serialized.endsWith('}\n'), true);
	strictEqual(serialized.includes('\n\n'), false);
});

test('the good ops fixture parses line-by-line and pins the error-record shape', async () => {
	const raw = await readLifecycleFixture('good', 'ops.jsonl');
	const records = LifecycleStore.parseLedger(raw);
	strictEqual(records.length, 6);
	strictEqual(records[0]!.op, 'create');
	strictEqual(records[1]!.op, 'start');
	strictEqual(records[2]!.op, 'attach');
	strictEqual(records[3]!.op, 'stop');
	strictEqual(records[4]!.op, 'start');
	strictEqual(records[4]!.result, 'error');
	strictEqual(records[4]!.error!.code, 'SIM_REMOTE_UNREACHABLE');
	strictEqual(records[5]!.op, 'destroy');
	// the actors pin the provenance surface
	strictEqual(records[0]!.actor, 'human');
	strictEqual(records[2]!.actor, 'agent');
	strictEqual(records[3]!.actor, 'tool');
	// every line round-trips through canonical single-line serialization
	for (let i = 0; i < records.length; i++) {
		strictEqual(raw.split('\n')[i], serializeOpRecord(records[i]!));
	}
	// the good pair is internally consistent: every lastOpRef resolves
	const envelope = parseLifecycleEnvelope(await readLifecycleFixture('good', 'lifecycle.json'));
	for (const [envId, entry] of Object.entries(envelope.entries)) {
		strictEqual(records[entry.lastOpRef - 1]!.environmentId, envId);
	}
});

test('every bad fixture is rejected with a schema-prefixed typed error', async () => {
	const badDir = lifecycleFixturePath('bad');
	const files = (await fs.readdir(badDir)).sort();
	ok(files.length >= 21, `bad matrix covers all rules (found ${files.length} files)`);
	for (const file of files) {
		const raw = await fs.readFile(path.join(badDir, file), { encoding: 'utf-8' });
		if (file.endsWith('.json')) {
			throws(() => parseLifecycleEnvelope(raw), PREFIX, `${file} must be rejected by parseLifecycleEnvelope`);
		} else {
			throws(() => LifecycleStore.parseLedger(raw), PREFIX, `${file} must be rejected by the ledger parser`);
		}
	}
});
