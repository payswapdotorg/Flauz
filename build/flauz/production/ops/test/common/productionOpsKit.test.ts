/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * A-PROD-006-W7 production ops kit test suite (mocha tdd style,
 * matching build/flauz/inference/acceptance/test/common/acceptanceKit.test.ts).
 *
 * Fixture policy: every target URL, evidence id, payload, and
 * timestamp below is SYNTHETIC (prefixed 'fixture.' or the
 * 'https://fixture.invalid' / 'http://localhost' URL classes) and is
 * NOT an authority value, NOT credential material. The kit tests run
 * over an in-memory queryLike port (a local-real exchange seam - the
 * sibling acceptance family's pattern) AND a fixture port (the
 * fixture-configured kit). The rng is a deterministic test double
 * (counter-based or fixed-value - NEVER the random global). The
 * suites never read a real clock (the injected now returns a fixed
 * ISO string); the in-suite determinism greps pin the sources to
 * law-comment lines only.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	FIXTURE_EVIDENCE_DEPLOYMENT_ID,
	FIXTURE_EVIDENCE_SMOKE_ID,
	createProductionOpsKit,
} from '../../common/productionOpsKit.js';
import type {
	ProductionOpsKit,
	ProductionOpsKitOptions,
	ProductionQueryLike,
	ProductionRng,
} from '../../common/productionOpsKit.js';
import {
	PRODUCTION_EVIDENCE_ID_PREFIX,
	PRODUCTION_OPS_VERSION,
	isProductionEvidenceRecord,
} from '../../common/productionOpsContract.js';
import type {
	ProductionEvidenceLabel,
	ProductionTarget,
} from '../../common/productionOpsContract.js';

const FIXTURE_NOW_ISO = '2024-01-01T00:00:00.000Z';
const FIXTURE_URL_PRODUCTION = 'https://flauz-production.vercel.app';
const FIXTURE_URL_LOCAL = 'http://localhost:3000';
const FIXTURE_URL_FIXTURE = 'https://fixture.invalid/production';

function fixedClock(): () => string {
	return () => FIXTURE_NOW_ISO;
}

function fixedRng(hex: string): ProductionRng {
	return () => hex;
}

function counterRng(): ProductionRng {
	let n = 0;
	return () => {
		n += 1;
		return n.toString(16).padStart(16, '0');
	};
}

function fixtureTarget(url: string, expectedLabel: ProductionEvidenceLabel): ProductionTarget {
	return { url, expectedLabel };
}

/**
 * The in-memory queryLike port (a local-real exchange seam). Handles
 * the four SQL patterns the kit sends: the DDL (CREATE TABLE), the
 * INSERT ... ON CONFLICT UPSERT (the append-only revision law), the
 * SELECT read, and the SELECT 1 DB probe. The port stores rows in a
 * Map keyed by id; the UPSERT increments the revision counter.
 */
function inMemoryPort(): { port: ProductionQueryLike; rows: Map<string, Record<string, unknown>>; refusing: boolean } {
	const rows = new Map<string, Record<string, unknown>>();
	const state = { refusing: false };
	const port: ProductionQueryLike = async (sql: string, params?: readonly unknown[]) => {
		if (state.refusing) {
			throw new Error('port refused (test-injected refusal)');
		}
		if (sql.includes('CREATE TABLE')) {
			return { rows: [] };
		}
		if (sql.includes('INSERT INTO production_evidence')) {
			const p = params as unknown[];
			const id = p[0] as string;
			const kind = p[1] as string;
			const label = p[2] as string;
			const payloadStr = p[3] as string;
			const recordedAt = p[4] as string;
			const existing = rows.get(id);
			const finalRevision = existing ? (existing.revision as number) + 1 : 1;
			const row: Record<string, unknown> = {
				id,
				kind,
				label,
				payload: payloadStr,
				recorded_at: recordedAt,
				revision: finalRevision,
			};
			rows.set(id, row);
			return { rows: [{ ...row }] };
		}
		if (sql.includes('SELECT id, kind, label')) {
			const limit = (params as unknown[])[0] as number;
			const allRows = Array.from(rows.values());
			allRows.sort((a, b) => (b.recorded_at as string).localeCompare(a.recorded_at as string));
			return { rows: allRows.slice(0, limit).map((r) => ({ ...r })) };
		}
		if (sql === 'SELECT 1') {
			return { rows: [{ '?column?': 1 }] };
		}
		return { rows: [] };
	};
	return { port, rows, refusing: state.refusing as boolean } as { port: ProductionQueryLike; rows: Map<string, Record<string, unknown>>; refusing: boolean };
}

function throwingPort(): ProductionQueryLike {
	return async () => {
		throw new Error('port refused (test-injected refusal)');
	};
}

function dbRefusingPort(): ProductionQueryLike {
	const mem = inMemoryPort();
	return async (sql: string, params?: readonly unknown[]) => {
		if (sql === 'SELECT 1') {
			throw new Error('DB refused');
		}
		return mem.port(sql, params);
	};
}

function okFetch(): (url: string) => Promise<{ ok: boolean; status: number }> {
	return async () => ({ ok: true, status: 200 });
}

function failFetch(): (url: string) => Promise<{ ok: boolean; status: number }> {
	return async () => {
		throw new Error('network refused');
	};
}

function non200Fetch(): (url: string) => Promise<{ ok: boolean; status: number }> {
	return async () => ({ ok: false, status: 500 });
}

function makeKit(
	target: ProductionTarget = fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'),
	queryLike: ProductionQueryLike = inMemoryPort().port,
	rng: ProductionRng = counterRng(),
	version: string = '0.2.0',
): ProductionOpsKit {
	const options: ProductionOpsKitOptions = {
		now: fixedClock(),
		target,
		queryLike,
		rng,
		version,
	};
	return createProductionOpsKit(options);
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

suite('A-PROD-006-W7 production ops kit', () => {

	suite('createProductionOpsKit validation', () => {
		test('rejects a non-object options', () => {
			assert.throws(() => createProductionOpsKit(null as unknown as ProductionOpsKitOptions), TypeError);
		});

		test('rejects a non-function now', () => {
			assert.throws(
				() => createProductionOpsKit({ now: 'not-a-function', target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: inMemoryPort().port, rng: counterRng() } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects a non-target target', () => {
			assert.throws(
				() => createProductionOpsKit({ now: fixedClock(), target: { url: '', expectedLabel: 'fixture' }, queryLike: inMemoryPort().port, rng: counterRng() } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects a non-function queryLike', () => {
			assert.throws(
				() => createProductionOpsKit({ now: fixedClock(), target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: 'not-a-function', rng: counterRng() } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects a non-function rng', () => {
			assert.throws(
				() => createProductionOpsKit({ now: fixedClock(), target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: inMemoryPort().port, rng: 'not-a-function' } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects a now that returns empty', () => {
			assert.throws(
				() => createProductionOpsKit({ now: () => '', target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: inMemoryPort().port, rng: counterRng() } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects an rng that returns non-16-hex', () => {
			assert.throws(
				() => createProductionOpsKit({ now: fixedClock(), target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: inMemoryPort().port, rng: () => 'short' } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});

		test('rejects an rng that returns uppercase hex', () => {
			assert.throws(
				() => createProductionOpsKit({ now: fixedClock(), target: fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), queryLike: inMemoryPort().port, rng: () => '0123456789ABCDEF' } as unknown as ProductionOpsKitOptions),
				TypeError,
			);
		});
	});

	suite('ensureSchema', () => {
		test('success: the DDL is applied through the port', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port);
			const outcome = await kit.ensureSchema();
			assert.equal(outcome.ok, true);
		});

		test('schema-io: the port refusal is the typed reason', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), throwingPort());
			const outcome = await kit.ensureSchema();
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'schema-io');
			}
		});
	});

	suite('recordProductionEvidence - happy paths', () => {
		test('fixture target mints a fixture-labeled record', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.label, 'fixture');
				assert.equal(outcome.record.kind, 'deployment');
			}
		});

		test('local-real target mints a local-real-labeled record', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_LOCAL, 'local-real'));
			const outcome = await kit.recordProductionEvidence('smoke-run', { probe: 'healthz' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.label, 'local-real');
			}
		});

		test('production-real target mints a production-real-labeled record', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const outcome = await kit.recordProductionEvidence('verification', { schema: 'ok' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.label, 'production-real');
			}
		});

		test('the record satisfies isProductionEvidenceRecord', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(isProductionEvidenceRecord(parsedJson(outcome.record)), true);
			}
		});

		test('the record carries the injected clock verbatim', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.recordedAtIso, FIXTURE_NOW_ISO);
			}
		});

		test('the record revision starts at 1', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.revision, 1);
			}
		});
	});

	suite('recordProductionEvidence - the frozen reason walk', () => {
		test('malformed-payload: payload not an object', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', 'not-an-object');
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'malformed-payload');
			}
		});

		test('malformed-payload: payload is null', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', null);
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'malformed-payload');
			}
		});

		test('caller-supplied-label: a supplied label is the rejection', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' }, 'fixture');
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'caller-supplied-label');
			}
		});

		test('caller-supplied-label: any supplied label (even the correct one) is rejected', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' }, 'production-real');
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'caller-supplied-label');
			}
		});

		test('unknown-kind: a non-member kind is the rejection', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('unknown-kind', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'unknown-kind');
			}
		});

		test('label-target-mismatch: production-real label over a fixture URL', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'production-real'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'label-target-mismatch');
			}
		});

		test('label-target-mismatch: fixture label over a production URL (BOTH directions)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'label-target-mismatch');
			}
		});

		test('label-target-mismatch: local-real label over a production URL', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'local-real'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'label-target-mismatch');
			}
		});

		test('label-target-mismatch: production-real label over a local URL', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_LOCAL, 'production-real'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'label-target-mismatch');
			}
		});

		test('ledger-io: the port refusal is the typed reason', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), throwingPort());
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'ledger-io');
			}
		});

		test('the walk order: malformed-payload fires before caller-supplied-label', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('deployment', 'not-an-object', 'fixture');
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'malformed-payload');
			}
		});

		test('the walk order: caller-supplied-label fires before unknown-kind', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const outcome = await kit.recordProductionEvidence('unknown-kind', { version: '0.2.0' }, 'fixture');
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'caller-supplied-label');
			}
		});

		test('the walk order: unknown-kind fires before label-target-mismatch', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'fixture'));
			const outcome = await kit.recordProductionEvidence('unknown-kind', { version: '0.2.0' });
			assert.equal(outcome.ok, false);
			if (!outcome.ok) {
				assert.equal(outcome.reason, 'unknown-kind');
			}
		});
	});

	suite('id-seed determinism', () => {
		test('same rng -> same id (the determinism law)', async () => {
			const hex = '0123456789abcdef';
			const kit1 = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), inMemoryPort().port, fixedRng(hex));
			const kit2 = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), inMemoryPort().port, fixedRng(hex));
			const o1 = await kit1.recordProductionEvidence('deployment', { version: '0.2.0' });
			const o2 = await kit2.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(o1.ok, true);
			assert.equal(o2.ok, true);
			if (o1.ok && o2.ok) {
				assert.equal(o1.record.id, o2.record.id);
			}
		});

		test('different rngs -> different ids', async () => {
			const kit1 = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), inMemoryPort().port, fixedRng('0123456789abcdef'));
			const kit2 = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), inMemoryPort().port, fixedRng('fedcba9876543210'));
			const o1 = await kit1.recordProductionEvidence('deployment', { version: '0.2.0' });
			const o2 = await kit2.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(o1.ok, true);
			assert.equal(o2.ok, true);
			if (o1.ok && o2.ok) {
				assert.notEqual(o1.record.id, o2.record.id);
			}
		});

		test('the id is the flauz:prd:<16-hex> form', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), inMemoryPort().port, fixedRng('0123456789abcdef'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.id, `${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdef`);
			}
		});

		test('the counter rng mints incrementing ids', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, counterRng());
			const o1 = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			const o2 = await kit.recordProductionEvidence('smoke-run', { probe: 'healthz' });
			assert.equal(o1.ok, true);
			assert.equal(o2.ok, true);
			if (o1.ok && o2.ok) {
				assert.notEqual(o1.record.id, o2.record.id);
			}
		});
	});

	suite('append-only revision law', () => {
		test('first record: revision 1', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, fixedRng('0123456789abcdef'));
			const outcome = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			assert.equal(outcome.ok, true);
			if (outcome.ok) {
				assert.equal(outcome.record.revision, 1);
			}
		});

		test('re-record same id: revision 2 (the append-only law)', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, fixedRng('0123456789abcdef'));
			const o1 = await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			const o2 = await kit.recordProductionEvidence('deployment', { version: '0.2.1' });
			assert.equal(o1.ok, true);
			assert.equal(o2.ok, true);
			if (o1.ok && o2.ok) {
				assert.equal(o1.record.id, o2.record.id);
				assert.equal(o1.record.revision, 1);
				assert.equal(o2.record.revision, 2);
			}
		});

		test('re-record same id thrice: revision 3', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, fixedRng('0123456789abcdef'));
			await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			await kit.recordProductionEvidence('deployment', { version: '0.2.1' });
			const o3 = await kit.recordProductionEvidence('deployment', { version: '0.2.2' });
			assert.equal(o3.ok, true);
			if (o3.ok) {
				assert.equal(o3.record.revision, 3);
			}
		});

		test('the read discloses the revision counts', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, fixedRng('0123456789abcdef'));
			await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			await kit.recordProductionEvidence('deployment', { version: '0.2.1' });
			const read = await kit.readEvidenceLedger(10);
			assert.equal(read.ok, true);
			if (read.ok) {
				const id = `${PRODUCTION_EVIDENCE_ID_PREFIX}0123456789abcdef`;
				assert.equal(read.revisionCounts[id], 2);
			}
		});
	});

	suite('readEvidenceLedger', () => {
		test('reads the records newest-first', async () => {
			const mem = inMemoryPort();
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), mem.port, counterRng());
			await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			await kit.recordProductionEvidence('smoke-run', { probe: 'healthz' });
			const read = await kit.readEvidenceLedger(10);
			assert.equal(read.ok, true);
			if (read.ok) {
				assert.equal(read.records.length, 2);
			}
		});

		test('malformed-payload: a non-integer limit is the rejection', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const read = await kit.readEvidenceLedger('not-a-number');
			assert.equal(read.ok, false);
			if (!read.ok) {
				assert.equal(read.reason, 'malformed-payload');
			}
		});

		test('malformed-payload: a zero limit is the rejection', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const read = await kit.readEvidenceLedger(0);
			assert.equal(read.ok, false);
			if (!read.ok) {
				assert.equal(read.reason, 'malformed-payload');
			}
		});

		test('ledger-io: the port refusal is the typed reason', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), throwingPort());
			const read = await kit.readEvidenceLedger(10);
			assert.equal(read.ok, false);
			if (!read.ok) {
				assert.equal(read.reason, 'ledger-io');
			}
		});

		test('malformed-payload: a malformed row is the typed rejection (never a silent drop)', async () => {
			const mem = inMemoryPort();
			const badPort: ProductionQueryLike = async (sql: string) => {
				if (sql.includes('SELECT id, kind, label')) {
					return { rows: [{ id: 'bad', kind: 'deployment', label: 'fixture', payload: '{}', recorded_at: FIXTURE_NOW_ISO, revision: 1 }] };
				}
				return mem.port(sql);
			};
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'), badPort);
			const read = await kit.readEvidenceLedger(10);
			assert.equal(read.ok, false);
			if (!read.ok) {
				assert.equal(read.reason, 'malformed-payload');
			}
		});
	});

	suite('healthCheck (the fail-closed probe)', () => {
		test('no fetch port -> non-production-target refusal (the no-global-fetch law)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck();
			assert.equal(report.ok, false);
			assert.equal(report.dbConnectivity, 'unknown');
			assert.equal(report.refusal, 'non-production-target');
		});

		test('HTTP failure -> non-production-target refusal', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(failFetch());
			assert.equal(report.ok, false);
			assert.equal(report.dbConnectivity, 'unknown');
			assert.equal(report.refusal, 'non-production-target');
		});

		test('HTTP non-200 -> non-production-target refusal', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(non200Fetch());
			assert.equal(report.ok, false);
			assert.equal(report.dbConnectivity, 'unknown');
			assert.equal(report.refusal, 'non-production-target');
		});

		test('HTTP ok + DB ok -> ok: true, dbConnectivity connected', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(okFetch());
			assert.equal(report.ok, true);
			assert.equal(report.dbConnectivity, 'connected');
			assert.equal(report.refusal, undefined);
		});

		test('HTTP ok + DB refused -> ok: false, dbConnectivity refused (never a green)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'), dbRefusingPort());
			const report = await kit.healthCheck(okFetch());
			assert.equal(report.ok, false);
			assert.equal(report.dbConnectivity, 'refused');
			assert.equal(report.refusal, undefined);
		});

		test('the report carries the injected clock verbatim', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(okFetch());
			assert.equal(report.checkedAtIso, FIXTURE_NOW_ISO);
		});

		test('the report carries the target url verbatim', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(okFetch());
			assert.equal(report.targetUrl, FIXTURE_URL_PRODUCTION);
		});

		test('the report carries the injected version', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_PRODUCTION, 'production-real'));
			const report = await kit.healthCheck(okFetch());
			assert.equal(report.version, '0.2.0');
		});
	});

	suite('statusView (the fold)', () => {
		test('the fold carries the target', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.target.url, FIXTURE_URL_FIXTURE);
			assert.equal(view.target.expectedLabel, 'fixture');
		});

		test('the fold carries the version', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.version, '0.2.0');
		});

		test('the fold carries the ledger census (empty on a fresh kit)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.ledgerCensus.count, 0);
			assert.equal(view.ledgerCensus.latestRecordId, null);
			assert.equal(view.ledgerCensus.latestKind, null);
		});

		test('the fold carries the ledger census (after a record)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			const view = await kit.statusView();
			assert.equal(view.ledgerCensus.count, 1);
			assert.notEqual(view.ledgerCensus.latestRecordId, null);
			assert.equal(view.ledgerCensus.latestKind, 'deployment');
		});

		test('the kit state re-carries the contract version stamp', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.kitState.contractVersion, PRODUCTION_OPS_VERSION);
		});

		test('the counters are honest (recordsRecorded starts at 0)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.kitState.recordsRecorded, 0);
			assert.equal(view.kitState.refusalsEmitted, 0);
			assert.equal(view.kitState.schemaEnsured, false);
		});

		test('the counters increment (recordsRecorded after a record)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			await kit.recordProductionEvidence('deployment', { version: '0.2.0' });
			const view = await kit.statusView();
			assert.equal(view.kitState.recordsRecorded, 1);
		});

		test('the counters increment (schemaEnsured after ensureSchema)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			await kit.ensureSchema();
			const view = await kit.statusView();
			assert.equal(view.kitState.schemaEnsured, true);
		});
	});

	suite('version stamp equality (the single declaration law)', () => {
		test('the kit statusView reports the contract version stamp (1.0.0)', async () => {
			const kit = makeKit(fixtureTarget(FIXTURE_URL_FIXTURE, 'fixture'));
			const view = await kit.statusView();
			assert.equal(view.kitState.contractVersion, '1.0.0');
			assert.equal(view.kitState.contractVersion, PRODUCTION_OPS_VERSION);
		});
	});

	suite('fixture disclosed ids (the fixture-policy synthetic ids)', () => {
		test('FIXTURE_EVIDENCE_DEPLOYMENT_ID is the flauz:prd:<16-hex> form', () => {
			assert.equal(FIXTURE_EVIDENCE_DEPLOYMENT_ID, `${PRODUCTION_EVIDENCE_ID_PREFIX}0000000000000001`);
		});

		test('FIXTURE_EVIDENCE_SMOKE_ID is the flauz:prd:<16-hex> form', () => {
			assert.equal(FIXTURE_EVIDENCE_SMOKE_ID, `${PRODUCTION_EVIDENCE_ID_PREFIX}0000000000000002`);
		});

		test('the fixture ids are distinct', () => {
			assert.notEqual(FIXTURE_EVIDENCE_DEPLOYMENT_ID, FIXTURE_EVIDENCE_SMOKE_ID);
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
