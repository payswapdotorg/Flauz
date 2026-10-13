/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-001 DomainHarness kit test suite (mocha tdd style, matching
 * build/flauz/production/ops/test/common/productionOpsKit.test.ts -
 * the W7 family precedent - and the CR-006 registry battery's
 * persistence discipline).
 *
 * Fixture policy: every harness id, descriptor value, catalog entry,
 * decision actor, and timestamp below is SYNTHETIC (prefixed
 * 'fixture.' / 'cap-fixture-' style ids, fixed fixture ISO strings)
 * and is NOT an authority value, NOT credential material, NOT
 * execution material. The kit tests run over an in-memory fs port
 * (the PIN-2 sibling precedent's persistence seam) and deterministic
 * test doubles for the clock and the rng (fixed-value or
 * counter-based - NEVER the random global, never a real clock). The
 * in-suite determinism greps pin the sources to law-comment lines
 * only.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	HARNESS_ENVELOPE_RELATIVE_PATH,
	HARNESS_LEDGER_RELATIVE_PATH,
	createHarnessKit,
	loadHarnessKit,
} from '../../common/domainHarnessKit.js';
import type {
	HarnessFsPort,
	HarnessKit,
	HarnessKitOptions,
	HarnessKitRefusal,
} from '../../common/domainHarnessKit.js';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION as CONTRACT_VERSION_PIN,
	HARNESS_ID_PREFIX,
	serializeHarnessRecord,
} from '../../common/domainHarnessContract.js';
import type { HarnessRecord } from '../../common/domainHarnessContract.js';

const FIXTURE_ROOT = '/fixture-root';
const ENVELOPE_PATH = `${FIXTURE_ROOT}/${HARNESS_ENVELOPE_RELATIVE_PATH}`;
const LEDGER_PATH = `${FIXTURE_ROOT}/${HARNESS_LEDGER_RELATIVE_PATH}`;

function fixedClock(): () => string {
	return () => '2026-10-13T00:00:00.000Z';
}

/** The advancing fixture clock (deterministic ISO strings, never a real clock). */
function advancingClock(): { clock: () => string; reads: string[] } {
	const reads: string[] = [];
	const clock = (): string => {
		const read = `2026-10-13T00:00:${String(reads.length + 1).padStart(2, '0')}.000Z`;
		reads.push(read);
		return read;
	};
	return { clock, reads };
}

function fixedRng(hex: string): () => string {
	return () => hex;
}

function counterRng(): () => string {
	let n = 0;
	return () => {
		n += 1;
		return n.toString(16).padStart(16, '0');
	};
}

/** A queue rng (minted in the queued order). */
function queueRng(values: string[]): () => string {
	let i = 0;
	return () => {
		const value = values[i];
		i += 1;
		return value;
	};
}

function fixtureCatalog(overrides: Record<string, unknown> = {}): unknown {
	return {
		capabilities: [{ entryId: 'cap-fixture-001', state: 'approved' }],
		workflowIds: ['wf-fixture-001'],
		policyIds: ['pol-fixture-001'],
		evidenceIds: ['ev-fixture-001'],
		...overrides,
	};
}

function fixtureSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		industry: 'legal',
		workTypes: ['analysis', 'drafting', 'review'],
		displayName: 'fixture litigation harness',
		roles: [
			{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
			{ roleKey: 'fixture.paralegal', summary: 'the fixture paralegal role' },
		],
		capabilityRefs: ['cap-fixture-001'],
		workflowRefs: ['wf-fixture-001'],
		policyRefs: ['pol-fixture-001'],
		evidenceRefs: ['ev-fixture-001'],
		...overrides,
	};
}

/** The in-memory fs port (the PIN-2 sibling precedent's persistence seam; ENOENT convention). */
function makeMemoryFs(existing?: Map<string, string>): { files: Map<string, string>; port: HarnessFsPort } {
	const files = existing ?? new Map<string, string>();
	const enoent = (path: string): Error => {
		const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
		(err as NodeJS.ErrnoException).code = 'ENOENT';
		return err;
	};
	const port: HarnessFsPort = {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				throw enoent(path);
			}
			return text;
		},
		async writeFile(path: string, text: string): Promise<void> {
			files.set(path, text);
		},
		async appendFile(path: string, text: string): Promise<void> {
			files.set(path, (files.get(path) ?? '') + text);
		},
		async mkdir(): Promise<void> {},
	};
	return { files, port };
}

/** An fs port whose appendFile refuses (the ledger-append failure seam). */
function appendRefusingFs(files: Map<string, string>): HarnessFsPort {
	return {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
				(err as NodeJS.ErrnoException).code = 'ENOENT';
				throw err;
			}
			return text;
		},
		async writeFile(path: string, text: string): Promise<void> {
			files.set(path, text);
		},
		async appendFile(): Promise<void> {
			throw new Error('fixture port refusal (appendFile)');
		},
		async mkdir(): Promise<void> {},
	};
}

/** An fs port whose writeFile refuses (the envelope-rewrite failure seam). */
function writeRefusingFs(files: Map<string, string>): HarnessFsPort {
	return {
		async readFile(path: string): Promise<string> {
			const text = files.get(path);
			if (text === undefined) {
				const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
				(err as NodeJS.ErrnoException).code = 'ENOENT';
				throw err;
			}
			return text;
		},
		async writeFile(): Promise<void> {
			throw new Error('fixture port refusal (writeFile)');
		},
		async appendFile(path: string, text: string): Promise<void> {
			files.set(path, (files.get(path) ?? '') + text);
		},
		async mkdir(): Promise<void> {},
	};
}

function kitOptions(overrides: Record<string, unknown> = {}): unknown {
	return {
		clock: fixedClock(),
		rng: fixedRng('0123456789abcdef'),
		catalog: fixtureCatalog(),
		...overrides,
	};
}

function mustOk<T extends { ok: boolean }>(outcome: T): Extract<T, { ok: true }> {
	if (outcome.ok) {
		return outcome as Extract<T, { ok: true }>;
	}
	assert.fail(`expected an ok outcome, received refusal: ${JSON.stringify(outcome)}`);
}

function mustRefuse<T extends { ok: boolean }>(outcome: T): HarnessKitRefusal {
	if (!outcome.ok) {
		return (outcome as unknown as { refusal: HarnessKitRefusal }).refusal;
	}
	assert.fail(`expected a refusal, received an ok outcome: ${JSON.stringify(outcome)}`);
}

/** The refused validation outcome carried by a VALIDATION_REFUSED refusal (narrowed for the table assertions). */
function mustRefusedValidation(refusal: HarnessKitRefusal): { mode: string; rejections: readonly { reason: string; law: string; family?: string; items: readonly string[] }[] } {
	assert.equal(refusal.validation?.ok, false, 'expected the refusal to carry a refused validation outcome');
	return refusal.validation as unknown as { mode: string; rejections: readonly { reason: string; law: string; family?: string; items: readonly string[] }[] };
}

async function mintedDraftKit(overrides: Record<string, unknown> = {}): Promise<{ kit: HarnessKit; id: string }> {
	const kit = createHarnessKit(kitOptions(overrides) as HarnessKitOptions);
	const mint = mustOk(await kit.mintHarness(fixtureSpec()));
	return { kit, id: mint.record.harnessId };
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|new Date\(|process\.env/.test(line));
}

suite('DH-001 DomainHarness kit', () => {

	suite('the single-version law (the kit re-carries the contract version)', () => {
		test('the kit re-export equals the contract declaration', () => {
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, CONTRACT_VERSION_PIN);
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
		});

		test('every minted record re-carries the contract version', async () => {
			const { kit } = await mintedDraftKit();
			const list = mustOk(await kit.listHarnesses());
			assert.equal(list.records[0].contractVersion, DOMAIN_HARNESS_CONTRACTS_VERSION);
			assert.equal(list.records[0].descriptor.contractVersion, DOMAIN_HARNESS_CONTRACTS_VERSION);
		});
	});

	suite('createHarnessKit factory misuse (TypeError, never a typed refusal)', () => {
		test('refuses a non-object options', () => {
			assert.throws(() => createHarnessKit(null as unknown as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit('string' as unknown as HarnessKitOptions), TypeError);
		});

		test('refuses a missing or non-function clock', () => {
			assert.throws(() => createHarnessKit(kitOptions({ clock: undefined }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ clock: 'not-a-function' }) as HarnessKitOptions), TypeError);
		});

		test('refuses a clock that returns an empty value', () => {
			assert.throws(() => createHarnessKit(kitOptions({ clock: () => '' }) as HarnessKitOptions), TypeError);
		});

		test('refuses a missing or non-function rng', () => {
			assert.throws(() => createHarnessKit(kitOptions({ rng: undefined }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ rng: 123 }) as HarnessKitOptions), TypeError);
		});

		test('refuses an rng that returns a non-16-hex value', () => {
			assert.throws(() => createHarnessKit(kitOptions({ rng: () => 'short' }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ rng: () => '0123456789ABCDEF' }) as HarnessKitOptions), TypeError);
		});

		test('refuses a malformed catalog snapshot', () => {
			assert.throws(() => createHarnessKit(kitOptions({ catalog: null }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ catalog: { capabilities: [] } }) as HarnessKitOptions), TypeError);
		});

		test('refuses fsPort without root and root without fsPort', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createHarnessKit(kitOptions({ fsPort: port }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ root: FIXTURE_ROOT }) as HarnessKitOptions), TypeError);
		});

		test('refuses an fs port missing a method', () => {
			const partial = { readFile: async () => '', appendFile: async () => {}, mkdir: async () => {} };
			assert.throws(() => createHarnessKit(kitOptions({ fsPort: partial, root: FIXTURE_ROOT }) as HarnessKitOptions), TypeError);
		});

		test('refuses an empty or non-string root', () => {
			const { port } = makeMemoryFs();
			assert.throws(() => createHarnessKit(kitOptions({ fsPort: port, root: '' }) as HarnessKitOptions), TypeError);
			assert.throws(() => createHarnessKit(kitOptions({ fsPort: port, root: 123 }) as HarnessKitOptions), TypeError);
		});
	});

	suite('mintHarness (the DRAFT mint)', () => {
		test('mints a draft with the honest record shape', async () => {
			const { kit, id } = await mintedDraftKit();
			const inspect = mustOk(await kit.inspectHarness(id));
			assert.equal(inspect.record.state, 'draft');
			assert.equal(inspect.record.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
			assert.equal(inspect.record.revision, 1);
			assert.equal(inspect.record.mintedAtIso, '2026-10-13T00:00:00.000Z');
			assert.equal(inspect.record.history.length, 1);
			assert.equal(inspect.record.history[0].fromState, null);
			assert.equal(inspect.record.history[0].toState, 'draft');
			assert.equal(inspect.record.history[0].law, 'THE FORWARD-ONLY LIFECYCLE LAW');
			assert.equal(inspect.record.history[0].decision, null);
			assert.equal(inspect.record.lastValidation.ok, true);
			assert.equal(inspect.record.lastValidation.mode, 'shape');
		});

		test('the id is minted from the injected rng (fixed rng -> pinned id; counter rng -> sequential ids)', async () => {
			const kitA = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mintA = mustOk(await kitA.mintHarness(fixtureSpec()));
			assert.equal(mintA.record.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
			const kitB = createHarnessKit(kitOptions({ rng: counterRng() }) as HarnessKitOptions);
			const mintB1 = mustOk(await kitB.mintHarness(fixtureSpec()));
			const mintB2 = mustOk(await kitB.mintHarness(fixtureSpec()));
			// The factory validates the rng with one read (the W7 precedent), so the first mint lands the second counter value.
			assert.equal(mintB1.record.harnessId, `${HARNESS_ID_PREFIX}0000000000000002`);
			assert.equal(mintB2.record.harnessId, `${HARNESS_ID_PREFIX}0000000000000003`);
		});

		test('the minted descriptor is the canonical fixed-key-order copy', async () => {
			const mint = mustOk(await (await mintedDraftKit()).kit.inspectHarness(`${HARNESS_ID_PREFIX}0123456789abcdef`));
			assert.deepEqual(Object.keys(mint.record.descriptor), [
				'harnessId',
				'contractVersion',
				'industry',
				'workTypes',
				'displayName',
				'roles',
				'capabilityRefs',
				'workflowRefs',
				'policyRefs',
				'evidenceRefs',
			]);
		});

		test('an unknown industry is refused at mint (frozen-vocab immediate)', async () => {
			const { kit } = await mintedDraftKit();
			const mint = await kit.mintHarness(fixtureSpec({ industry: 'fintech' }));
			const refusal = mustRefuse(mint);
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			assert.equal(refusal.law, 'THE TWO-PHASE LAW');
			assert.equal(refusal.validation?.ok, false);
			assert.equal(refusal.validation?.mode, 'shape');
			assert.equal(mustRefusedValidation(refusal).rejections[0].reason, 'unknown-industry');
		});

		test('a forbidden key is refused at mint (NO-FORK immediate)', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = await kit.mintHarness(fixtureSpec({ command: 'ls' }));
			const refusal = mustRefuse(mint);
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			const rejections = mustRefusedValidation(refusal).rejections;
			assert.equal(rejections[0].reason, 'no-fork');
			assert.equal(rejections[0].law, 'THE NO-FORK LAW');
			assert.deepEqual(rejections[0].items, ['command']);
		});

		test('THE TWO-PHASE LAW: dangling refs mint fine at draft', async () => {
			const kit = createHarnessKit(kitOptions({ catalog: fixtureCatalog({ capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] }) }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			assert.equal(mint.record.state, 'draft');
			assert.deepEqual(mint.record.descriptor.capabilityRefs, ['cap-fixture-001']);
		});

		test('a caller-supplied harnessId is refused (the kit mints the id)', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = await kit.mintHarness(fixtureSpec({ harnessId: `${HARNESS_ID_PREFIX}ffffffffffffffff` }));
			const refusal = mustRefuse(mint);
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			assert.equal(mustRefusedValidation(refusal).rejections[0].reason, 'unknown-key');
			assert.deepEqual(mustRefusedValidation(refusal).rejections[0].items, ['harnessId']);
		});

		test('a caller-supplied contractVersion is refused (the single-version law)', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = await kit.mintHarness(fixtureSpec({ contractVersion: '2.0.0' }));
			const refusal = mustRefuse(mint);
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			assert.deepEqual(mustRefusedValidation(refusal).rejections[0].items, ['contractVersion']);
		});

		test('a non-object spec is refused fail-closed', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			for (const spec of [null, 'string', 123, []]) {
				const refusal = mustRefuse(await kit.mintHarness(spec));
				assert.equal(refusal.reason, 'VALIDATION_REFUSED');
				assert.equal(mustRefusedValidation(refusal).rejections[0].reason, 'malformed-descriptor');
			}
		});

		test('empty roles and out-of-order workTypes are refused at mint', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			assert.equal(mustRefusedValidation(mustRefuse(await kit.mintHarness(fixtureSpec({ roles: [] })))).rejections[0].reason, 'empty-roles');
			assert.equal(mustRefusedValidation(mustRefuse(await kit.mintHarness(fixtureSpec({ workTypes: ['drafting', 'analysis'] })))).rejections[0].reason, 'work-types-out-of-order');
		});

		test('a corrupt rng mid-op is the typed CORRUPT_SEAM refusal', async () => {
			let calls = 0;
			const rng = (): string => {
				calls += 1;
				// The factory consumes the first read; the second read mints; the third is corrupt.
				return calls <= 2 ? '0123456789abcdef' : 'corrupt';
			};
			const kit = createHarnessKit(kitOptions({ rng }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const refusal = mustRefuse(await kit.mintHarness(fixtureSpec()));
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.equal(refusal.law, 'THE DETERMINISM LAW');
		});

		test('a duplicate minted id is the typed CORRUPT_SEAM refusal', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const refusal = mustRefuse(await kit.mintHarness(fixtureSpec()));
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
			assert.match(refusal.detail, /duplicate harness id/);
		});

		test('a corrupt clock mid-op is the typed CORRUPT_SEAM refusal', async () => {
			let calls = 0;
			const clock = (): string => {
				calls += 1;
				return calls <= 1 ? '2026-10-13T00:00:00.000Z' : '';
			};
			const kit = createHarnessKit(kitOptions({ clock }) as HarnessKitOptions);
			const refusal = mustRefuse(await kit.mintHarness(fixtureSpec()));
			assert.equal(refusal.reason, 'CORRUPT_SEAM');
		});
	});

	suite('advanceHarness (the lifecycle machine)', () => {
		test('the full forward chain: draft -> proposed -> approved -> active -> retired', async () => {
			const { clock } = advancingClock();
			const kit = createHarnessKit(kitOptions({ clock }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			const proposed = mustOk(await kit.advanceHarness(id, 'proposed'));
			assert.equal(proposed.record.state, 'proposed');
			assert.equal(proposed.record.revision, 2);
			const approved = mustOk(await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver', note: 'fixture note' }));
			assert.equal(approved.record.state, 'approved');
			assert.equal(approved.record.revision, 3);
			const active = mustOk(await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' }));
			assert.equal(active.record.state, 'active');
			const retired = mustOk(await kit.advanceHarness(id, 'retired', { retiredBy: 'fixture.retirer', reason: 'fixture reason' }));
			assert.equal(retired.record.state, 'retired');
			assert.equal(retired.record.revision, 5);
			assert.equal(retired.record.history.length, 5);
		});

		test('the history carries the provenance laws in order (which law, which decision, which clock reading)', async () => {
			const { clock, reads } = advancingClock();
			const kit = createHarnessKit(kitOptions({ clock }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' });
			await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' });
			await kit.advanceHarness(id, 'retired', { retiredBy: 'fixture.retirer' });
			const inspect = mustOk(await kit.inspectHarness(id));
			const laws = inspect.record.history.map((note) => note.law);
			assert.deepEqual(laws, [
				'THE FORWARD-ONLY LIFECYCLE LAW',
				'THE TWO-PHASE LAW',
				'THE CATALOG-BINDING LAW',
				'THE FORWARD-ONLY LIFECYCLE LAW',
				'THE FORWARD-ONLY LIFECYCLE LAW',
			]);
			assert.deepEqual(inspect.record.history.map((note) => note.decision), [
				null,
				null,
				{ approvedBy: 'fixture.approver' },
				{ activatedBy: 'fixture.operator' },
				{ retiredBy: 'fixture.retirer' },
			]);
			for (const note of inspect.record.history) {
				assert.equal(note.at.startsWith('2026-10-13T00:00:'), true);
			}
			// The factory consumes the first clock read; the mint lands the second.
			assert.equal(inspect.record.mintedAtIso, reads[1]);
			assert.equal(inspect.record.history[1].at, reads[2]);
		});

		test('the descriptor is IMMUTABLE across the chain (the registry drift law)', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			const before = mint.record.descriptor;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' });
			const inspect = mustOk(await kit.inspectHarness(id));
			assert.deepEqual(inspect.record.descriptor, before);
		});

		test('an illegal skip is refused with the contract verdict carried', async () => {
			const { kit, id } = await mintedDraftKit();
			const refusal = mustRefuse(await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' }));
			assert.equal(refusal.reason, 'ILLEGAL_TRANSITION');
			assert.equal(refusal.law, 'THE FORWARD-ONLY LIFECYCLE LAW');
			assert.equal(refusal.transition?.ok, false);
			assert.equal(refusal.transition?.whitelistRow, 1);
			assert.equal(refusal.transition?.expectedTo, 'proposed');
		});

		test('a backwards move is refused', async () => {
			const { kit, id } = await mintedDraftKit();
			await kit.advanceHarness(id, 'proposed');
			const refusal = mustRefuse(await kit.advanceHarness(id, 'draft'));
			assert.equal(refusal.reason, 'ILLEGAL_TRANSITION');
		});

		test('retired is TERMINAL - nothing leaves it', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' });
			await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' });
			mustOk(await kit.advanceHarness(id, 'retired', { retiredBy: 'fixture.retirer' }));
			for (const to of ['draft', 'proposed', 'approved', 'active', 'retired']) {
				const refusal = mustRefuse(await kit.advanceHarness(id, to, { approvedBy: 'x' } as Record<string, string>));
				assert.equal(refusal.reason, 'ILLEGAL_TRANSITION', `retired->${to} must be refused`);
			}
		});

		test('an unknown target state is refused fail-closed', async () => {
			const { kit, id } = await mintedDraftKit();
			const refusal = mustRefuse(await kit.advanceHarness(id, 'bogus'));
			assert.equal(refusal.reason, 'ILLEGAL_TRANSITION');
			assert.match(refusal.detail, /frozen HARNESS_LIFECYCLE_STATES list/);
		});

		test('an unknown or malformed harness id is NOT_FOUND', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			assert.equal(mustRefuse(await kit.advanceHarness(`${HARNESS_ID_PREFIX}ffffffffffffffff`, 'proposed')).reason, 'NOT_FOUND');
			assert.equal(mustRefuse(await kit.advanceHarness('not-an-id', 'proposed')).reason, 'NOT_FOUND');
			assert.equal(mustRefuse(await kit.advanceHarness(null, 'proposed')).reason, 'NOT_FOUND');
		});

		test('THE NO-DANGLING-REF LAW: the propose boundary refuses dangling refs carrying the complete outcome', async () => {
			const kit = createHarnessKit(kitOptions({ catalog: fixtureCatalog({ workflowIds: [] }) }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const refusal = mustRefuse(await kit.advanceHarness(mint.record.harnessId, 'proposed'));
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			assert.equal(refusal.law, 'THE NO-DANGLING-REF LAW');
			assert.equal(refusal.validation?.ok, false);
			assert.equal(refusal.validation?.mode, 'full');
			const validation = mustRefusedValidation(refusal);
			assert.equal(validation.rejections.length, 1);
			assert.equal(validation.rejections[0].reason, 'dangling-ref');
			assert.equal(validation.rejections[0].family, 'workflowRefs');
			assert.deepEqual(validation.rejections[0].items, ['wf-fixture-001']);
		});

		test('THE TWO-PHASE LAW: a resolving catalog flips the propose boundary green', async () => {
			const danglingKit = createHarnessKit(kitOptions({ catalog: fixtureCatalog({ capabilities: [], workflowIds: [], policyIds: [], evidenceIds: [] }) }) as HarnessKitOptions);
			const mint = mustOk(await danglingKit.mintHarness(fixtureSpec()));
			assert.equal(mustRefuse(await danglingKit.advanceHarness(mint.record.harnessId, 'proposed')).reason, 'VALIDATION_REFUSED');
			const resolvingKit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint2 = mustOk(await resolvingKit.mintHarness(fixtureSpec()));
			const proposed = mustOk(await resolvingKit.advanceHarness(mint2.record.harnessId, 'proposed'));
			assert.equal(proposed.record.state, 'proposed');
			assert.equal(proposed.record.lastValidation.mode, 'full');
		});

		test('the propose transition carries NO decision', async () => {
			const { kit, id } = await mintedDraftKit();
			const refusal = mustRefuse(await kit.advanceHarness(id, 'proposed', { approvedBy: 'fixture.approver' }));
			assert.equal(refusal.reason, 'MALFORMED_DECISION');
			assert.match(refusal.detail, /carries NO decision/);
		});

		test('the propose boundary is repeatable after a refusal (no partial effect)', async () => {
			const kit = createHarnessKit(kitOptions({ catalog: fixtureCatalog({ evidenceIds: [] }) }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const refusal = mustRefuse(await kit.advanceHarness(mint.record.harnessId, 'proposed'));
			assert.equal(refusal.reason, 'VALIDATION_REFUSED');
			const inspect = mustOk(await kit.inspectHarness(mint.record.harnessId));
			assert.equal(inspect.record.state, 'draft');
			assert.equal(inspect.record.revision, 1);
			assert.equal(inspect.record.history.length, 1);
		});

		test('approve decision walks: missing approvedBy, empty approvedBy, unknown key', async () => {
			const { kit, id } = await mintedDraftKit();
			await kit.advanceHarness(id, 'proposed');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'approved', {})).reason, 'MALFORMED_DECISION');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'approved', { approvedBy: '' })).reason, 'MALFORMED_DECISION');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver', extra: true })).reason, 'MALFORMED_DECISION');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'approved')).reason, 'MALFORMED_DECISION');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'approved', 'not-an-object')).reason, 'MALFORMED_DECISION');
		});

		test('activate and retire decision walks', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver', note: 'fixture note' });
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'active', {})).reason, 'MALFORMED_DECISION');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator', extra: 1 })).reason, 'MALFORMED_DECISION');
			mustOk(await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' }));
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'retired', { reason: 'missing retiredBy' })).reason, 'MALFORMED_DECISION');
			const retired = mustOk(await kit.advanceHarness(id, 'retired', { retiredBy: 'fixture.retirer', reason: 'fixture reason' }));
			assert.deepEqual(retired.record.history[4].decision, { retiredBy: 'fixture.retirer', reason: 'fixture reason' });
		});
	});

	suite('THE CATALOG-BINDING LAW (the approve boundary)', () => {
		async function proposedKitWithCapabilityState(state: string): Promise<{ kit: HarnessKit; id: string }> {
			const kit = createHarnessKit(kitOptions({ catalog: fixtureCatalog({ capabilities: [{ entryId: 'cap-fixture-001', state }] }) }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			await kit.advanceHarness(mint.record.harnessId, 'proposed');
			return { kit, id: mint.record.harnessId };
		}

		test('an unapproved capability refuses the approve with every offender listed', async () => {
			const { kit, id } = await proposedKitWithCapabilityState('discovered');
			const refusal = mustRefuse(await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' }));
			assert.equal(refusal.reason, 'CATALOG_BINDING_REFUSED');
			assert.equal(refusal.law, 'THE CATALOG-BINDING LAW');
			assert.deepEqual(refusal.offenders, ['cap-fixture-001 (state: discovered)']);
		});

		test('imported, verified, unavailable and revoked capabilities all refuse', async () => {
			for (const state of ['imported', 'verified', 'unavailable', 'revoked']) {
				const { kit, id } = await proposedKitWithCapabilityState(state);
				const refusal = mustRefuse(await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' }));
				assert.equal(refusal.reason, 'CATALOG_BINDING_REFUSED', `state '${state}' must refuse`);
				assert.match(refusal.offenders?.[0] as string, new RegExp(`state: ${state}`));
			}
		});

		test('approved, enabled and available capabilities all pass', async () => {
			for (const state of ['approved', 'enabled', 'available']) {
				const { kit, id } = await proposedKitWithCapabilityState(state);
				const approved = mustOk(await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' }));
				assert.equal(approved.record.state, 'approved', `state '${state}' must pass`);
			}
		});

		test('multi-offender refusals list every unapproved capability', async () => {
			const kit = createHarnessKit(kitOptions({
				catalog: fixtureCatalog({
					capabilities: [
						{ entryId: 'cap-fixture-001', state: 'approved' },
						{ entryId: 'cap-fixture-002', state: 'imported' },
					],
				}),
			}) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec({ capabilityRefs: ['cap-fixture-001', 'cap-fixture-002'] })));
			await kit.advanceHarness(mint.record.harnessId, 'proposed');
			const refusal = mustRefuse(await kit.advanceHarness(mint.record.harnessId, 'approved', { approvedBy: 'fixture.approver' }));
			assert.equal(refusal.reason, 'CATALOG_BINDING_REFUSED');
			assert.deepEqual(refusal.offenders, ['cap-fixture-002 (state: imported)']);
		});
	});

	suite('inspectHarness (the honest record)', () => {
		test('discloses state, descriptor, history, last validation and revision count', async () => {
			const { kit, id } = await mintedDraftKit();
			const inspect = mustOk(await kit.inspectHarness(id));
			assert.equal(inspect.record.harnessId, id);
			assert.equal(inspect.record.descriptor.industry, 'legal');
			assert.equal(inspect.record.lastValidation.ok, true);
			assert.equal(inspect.record.revision, 1);
		});

		test('an unknown id is NOT_FOUND', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			assert.equal(mustRefuse(await kit.inspectHarness(`${HARNESS_ID_PREFIX}ffffffffffffffff`)).reason, 'NOT_FOUND');
			assert.equal(mustRefuse(await kit.inspectHarness(null)).reason, 'NOT_FOUND');
		});

		test('the last validation outcome flips to full at propose and persists onward', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			assert.equal(mint.record.lastValidation.mode, 'shape');
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' });
			await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' });
			const inspect = mustOk(await kit.inspectHarness(id));
			assert.equal(inspect.record.lastValidation.mode, 'full');
			assert.equal(inspect.record.lastValidation.ok, true);
		});

		test('the returned record is an isolated copy (mutating it never corrupts the kit)', async () => {
			const { kit, id } = await mintedDraftKit();
			const inspect = mustOk(await kit.inspectHarness(id));
			(inspect.record as { state: string }).state = 'retired';
			const again = mustOk(await kit.inspectHarness(id));
			assert.equal(again.record.state, 'draft');
		});
	});

	suite('listHarnesses (stable ordering + fail-closed filters)', () => {
		test('an empty kit lists nothing', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const list = mustOk(await kit.listHarnesses());
			assert.deepEqual(list.records, []);
		});

		test('stable ordering by harnessId regardless of mint order', async () => {
			// The factory consumes the first queued value (the rng validation read).
			const kit = createHarnessKit(kitOptions({ rng: queueRng(['0000000000000000', '0000000000000003', '0000000000000001', '0000000000000002']) }) as HarnessKitOptions);
			await kit.mintHarness(fixtureSpec());
			await kit.mintHarness(fixtureSpec({ displayName: 'fixture second harness' }));
			await kit.mintHarness(fixtureSpec({ displayName: 'fixture third harness' }));
			const list = mustOk(await kit.listHarnesses());
			assert.deepEqual(list.records.map((record) => record.harnessId), [
				`${HARNESS_ID_PREFIX}0000000000000001`,
				`${HARNESS_ID_PREFIX}0000000000000002`,
				`${HARNESS_ID_PREFIX}0000000000000003`,
			]);
		});

		test('filters by industry, workType and state', async () => {
			const kit = createHarnessKit(kitOptions({ rng: counterRng() }) as HarnessKitOptions);
			await kit.mintHarness(fixtureSpec({ industry: 'legal', workTypes: ['analysis'] }));
			await kit.mintHarness(fixtureSpec({ industry: 'finance', workTypes: ['drafting'], displayName: 'fixture finance harness' }));
			const legal = mustOk(await kit.listHarnesses({ industry: 'legal' }));
			assert.equal(legal.records.length, 1);
			assert.equal(legal.records[0].descriptor.industry, 'legal');
			const drafting = mustOk(await kit.listHarnesses({ workType: 'drafting' }));
			assert.equal(drafting.records.length, 1);
			const draft = mustOk(await kit.listHarnesses({ state: 'draft' }));
			assert.equal(draft.records.length, 2);
			const none = mustOk(await kit.listHarnesses({ state: 'active' }));
			assert.equal(none.records.length, 0);
		});

		test('an unknown filter field fails closed', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			const refusal = mustRefuse(await kit.listHarnesses({ displayName: 'x' }));
			assert.equal(refusal.reason, 'UNKNOWN_FILTER');
			assert.deepEqual(refusal.offenders, ['displayName']);
		});

		test('non-member filter values fail closed', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			assert.equal(mustRefuse(await kit.listHarnesses({ industry: 'fintech' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listHarnesses({ workType: 'coding' })).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listHarnesses({ state: 'bogus' })).reason, 'UNKNOWN_FILTER');
		});

		test('a non-object filter fails closed', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			assert.equal(mustRefuse(await kit.listHarnesses(null)).reason, 'UNKNOWN_FILTER');
			assert.equal(mustRefuse(await kit.listHarnesses('string')).reason, 'UNKNOWN_FILTER');
		});

		test('an empty filter object lists everything', async () => {
			const kit = createHarnessKit(kitOptions({ rng: counterRng() }) as HarnessKitOptions);
			await kit.mintHarness(fixtureSpec());
			await kit.mintHarness(fixtureSpec({ displayName: 'fixture second harness' }));
			const list = mustOk(await kit.listHarnesses({}));
			assert.equal(list.records.length, 2);
		});
	});

	suite('dispose (the dispose law)', () => {
		test('every operation after dispose rejects with the typed DISPOSED error', async () => {
			const { kit, id } = await mintedDraftKit();
			kit.dispose();
			assert.equal(mustRefuse(await kit.mintHarness(fixtureSpec())).reason, 'DISPOSED');
			assert.equal(mustRefuse(await kit.advanceHarness(id, 'proposed')).reason, 'DISPOSED');
			assert.equal(mustRefuse(await kit.inspectHarness(id)).reason, 'DISPOSED');
			assert.equal(mustRefuse(await kit.listHarnesses()).reason, 'DISPOSED');
		});

		test('dispose is idempotent (a second dispose never throws)', async () => {
			const { kit } = await mintedDraftKit();
			kit.dispose();
			assert.doesNotThrow(() => kit.dispose());
		});

		test('a disposed fresh kit refuses the first mint', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			kit.dispose();
			assert.equal(mustRefuse(await kit.mintHarness(fixtureSpec())).reason, 'DISPOSED');
		});
	});

	suite('persistence (the PIN-2 sibling precedent)', () => {
		test('the envelope and the append-only ledger land with the first applied op', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			assert.equal(files.has(LEDGER_PATH), true);
			assert.equal(files.has(ENVELOPE_PATH), true);
			const ledgerLines = (files.get(LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 1);
			const line = JSON.parse(ledgerLines[0]) as Record<string, unknown>;
			assert.equal(line.op, 'mint');
			assert.equal(line.seq, 1);
			assert.equal(line.harnessId, `${HARNESS_ID_PREFIX}0123456789abcdef`);
			const envelope = JSON.parse(files.get(ENVELOPE_PATH) as string) as Record<string, unknown>;
			assert.equal(envelope.seq, 1);
			assert.equal((envelope.harnesses as unknown[]).length, 1);
		});

		test('the ledger appends one canonical line per applied op (seq == line number)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			await kit.advanceHarness(mint.record.harnessId, 'proposed');
			await kit.advanceHarness(mint.record.harnessId, 'approved', { approvedBy: 'fixture.approver' });
			const ledgerLines = (files.get(LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			assert.equal(ledgerLines.length, 3);
			assert.deepEqual(ledgerLines.map((line) => (JSON.parse(line) as { seq: number }).seq), [1, 2, 3]);
		});

		test('round-trip: loadHarnessKit replays the identical honest record', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver', note: 'fixture note' });
			const live = mustOk(await kit.inspectHarness(id));
			const load = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			const reopened = mustOk(await load.kit.inspectHarness(id));
			assert.deepEqual(reopened.record, live.record);
			assert.equal(serializeHarnessRecord(reopened.record), serializeHarnessRecord(live.record as HarnessRecord));
			assert.equal((files.get(LEDGER_PATH) as string).endsWith('\n'), true);
		});

		test('the full chain round-trips (history, revision, last validation, decisions)', async () => {
			const { port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT, clock: advancingClock().clock }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			await kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' });
			await kit.advanceHarness(id, 'active', { activatedBy: 'fixture.operator' });
			await kit.advanceHarness(id, 'retired', { retiredBy: 'fixture.retirer', reason: 'fixture reason' });
			const live = mustOk(await kit.inspectHarness(id));
			const load = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			const reopened = mustOk(await load.kit.inspectHarness(id));
			assert.equal(reopened.record.state, 'retired');
			assert.equal(reopened.record.revision, 5);
			assert.equal(reopened.record.history.length, 5);
			assert.deepEqual(reopened.record.history[4].decision, { retiredBy: 'fixture.retirer', reason: 'fixture reason' });
			assert.equal(reopened.record.lastValidation.mode, 'full');
			assert.deepEqual(reopened.record.history.map((note) => note.law), live.record.history.map((note) => note.law));
		});

		test('the reopened kit continues the lifecycle over the persisted state', async () => {
			const { port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			const id = mint.record.harnessId;
			await kit.advanceHarness(id, 'proposed');
			const load = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			const approved = mustOk(await load.kit.advanceHarness(id, 'approved', { approvedBy: 'fixture.approver' }));
			assert.equal(approved.record.state, 'approved');
			assert.equal(approved.record.revision, 3);
		});

		test('a torn ledger (a missing trailing newline) fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const torn = (files.get(LEDGER_PATH) as string).slice(0, -1);
			files.set(LEDGER_PATH, torn);
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /does not end with a complete line/);
		});

		test('an unparseable ledger line fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			files.set(LEDGER_PATH, '{not json}\n');
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
		});

		test('a sequence drift in the ledger fails closed with E_LEDGER_TORN', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			await kit.advanceHarness(mint.record.harnessId, 'proposed');
			const lines = (files.get(LEDGER_PATH) as string).split('\n').filter((line) => line.length > 0);
			const tampered = JSON.parse(lines[1]) as Record<string, unknown>;
			tampered.seq = 9;
			lines[1] = JSON.stringify(tampered);
			files.set(LEDGER_PATH, `${lines.join('\n')}\n`);
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /out of order|missing/);
		});

		test('a divergent envelope fails closed with E_ENVELOPE_MISMATCH (never silently rebuilt)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const envelope = JSON.parse(files.get(ENVELOPE_PATH) as string) as Record<string, unknown>;
			const harnesses = envelope.harnesses as Record<string, unknown>[];
			(harnesses[0] as { state: string }).state = 'active';
			files.set(ENVELOPE_PATH, JSON.stringify(envelope));
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(refusal.detail, /never silently rebuilt/);
		});

		test('a missing envelope with a non-empty ledger fails closed with E_ENVELOPE_MISMATCH', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			files.delete(ENVELOPE_PATH);
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(refusal.detail, /envelope is missing/);
		});

		test('a malformed or version-drifted envelope fails closed with E_ENVELOPE_MISMATCH', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const validEnvelope = files.get(ENVELOPE_PATH) as string;
			files.set(ENVELOPE_PATH, '{not json}');
			assert.equal(mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions)).reason, 'E_ENVELOPE_MISMATCH');
			const envelope = JSON.parse(validEnvelope) as Record<string, unknown>;
			const drifted = JSON.stringify({ ...envelope, contractVersion: '9.9.9' });
			files.set(ENVELOPE_PATH, drifted);
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_ENVELOPE_MISMATCH');
			assert.match(refusal.detail, /contract version/);
		});

		test('an envelope ahead of the ledger fails closed with E_LEDGER_TORN (missing ledger lines)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const envelope = JSON.parse(files.get(ENVELOPE_PATH) as string) as Record<string, unknown>;
			files.set(ENVELOPE_PATH, JSON.stringify({ ...envelope, seq: 9 }));
			const refusal = mustRefuse(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /missing ledger lines/);
		});

		test('a fresh root (no files) reopens as an empty kit', async () => {
			const { port } = makeMemoryFs();
			const load = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			const list = mustOk(await load.kit.listHarnesses());
			assert.deepEqual(list.records, []);
		});

		test('loadHarnessKit is idempotent (a second load never rewrites the files)', async () => {
			const { files, port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const mint = mustOk(await kit.mintHarness(fixtureSpec()));
			await kit.advanceHarness(mint.record.harnessId, 'proposed');
			const first = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			const beforeLedger = files.get(LEDGER_PATH) as string;
			const beforeEnvelope = files.get(ENVELOPE_PATH) as string;
			const second = mustOk(await loadHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions));
			assert.equal(files.get(LEDGER_PATH), beforeLedger);
			assert.equal(files.get(ENVELOPE_PATH), beforeEnvelope);
			const a = mustOk(await first.kit.listHarnesses());
			const b = mustOk(await second.kit.listHarnesses());
			assert.equal(serializeHarnessRecord(a.records[0]), serializeHarnessRecord(b.records[0]));
		});

		test('loadHarnessKit requires both fsPort and root (TypeError)', async () => {
			await assert.rejects(() => loadHarnessKit(kitOptions() as HarnessKitOptions), TypeError);
			const { port } = makeMemoryFs();
			await assert.rejects(() => loadHarnessKit(kitOptions({ fsPort: port }) as HarnessKitOptions), TypeError);
			await assert.rejects(() => loadHarnessKit(kitOptions({ root: FIXTURE_ROOT }) as HarnessKitOptions), TypeError);
		});

		test('a fresh kit never appends over an existing ledger (E_LEDGER_TORN)', async () => {
			const { port } = makeMemoryFs();
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const second = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const refusal = mustRefuse(await second.mintHarness(fixtureSpec({ displayName: 'fixture second harness' })));
			assert.equal(refusal.reason, 'E_LEDGER_TORN');
			assert.match(refusal.detail, /reopen with loadHarnessKit/);
		});

		test('a refusing ledger append is the typed HARNESS_IO with NOTHING applied', async () => {
			const { files } = makeMemoryFs();
			const port = appendRefusingFs(files);
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const refusal = mustRefuse(await kit.mintHarness(fixtureSpec()));
			assert.equal(refusal.reason, 'HARNESS_IO');
			assert.match(refusal.detail, /nothing was applied/);
			const list = mustOk(await kit.listHarnesses());
			assert.deepEqual(list.records, []);
			assert.equal(files.has(LEDGER_PATH), false);
		});

		test('a refusing envelope rewrite is the typed HARNESS_IO disclosing the landed line', async () => {
			const { files } = makeMemoryFs();
			const port = writeRefusingFs(files);
			const kit = createHarnessKit(kitOptions({ fsPort: port, root: FIXTURE_ROOT }) as HarnessKitOptions);
			const refusal = mustRefuse(await kit.mintHarness(fixtureSpec()));
			assert.equal(refusal.reason, 'HARNESS_IO');
			assert.match(refusal.detail, /the ledger line landed at seq 1/);
			const list = mustOk(await kit.listHarnesses());
			assert.equal(list.records.length, 1);
			const { port: workingPort } = makeMemoryFs(files);
			const load = await loadHarnessKit(kitOptions({ fsPort: workingPort, root: FIXTURE_ROOT }) as HarnessKitOptions);
			assert.equal(load.ok, false);
			assert.equal(mustRefuse(load).reason, 'E_ENVELOPE_MISMATCH');
		});

		test('an in-memory kit (no fsPort) never touches a filesystem', async () => {
			const kit = createHarnessKit(kitOptions() as HarnessKitOptions);
			mustOk(await kit.mintHarness(fixtureSpec()));
			const list = mustOk(await kit.listHarnesses());
			assert.equal(list.records.length, 1);
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every Date.now / Math.random / new Date( / process.env hit in domainHarnessKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/domainHarnessKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / new Date( / process.env hit in domainHarnessContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/domainHarnessContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
