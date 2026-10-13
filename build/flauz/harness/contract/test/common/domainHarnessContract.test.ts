/*
 * Copyright (c) Flauz contributors.
 * Licensed under the MIT License; see the repository LICENSE file.
 *
 * DH-001 DomainHarness contract test suite (mocha tdd style, matching
 * build/flauz/production/ops/test/common/productionOpsContract.test.ts
 * - the W7 family precedent).
 *
 * Fixture policy: every harness id, descriptor value, catalog entry,
 * and timestamp below is SYNTHETIC (prefixed 'fixture.' / 'cap-fixture-'
 * style ids, the 'flauz:hrn:<16-hex>' fixture id) and is NOT an
 * authority value, NOT credential material, NOT execution material.
 * Closed-vocabulary members (the industries, the work types, the
 * lifecycle states, the whitelist rows, the rejection reasons, the
 * version stamp) are the contract's own values under test. The
 * canonical-byte tests pin determinism and the frozen key orders; the
 * suites never read a clock; the in-suite determinism greps pin the
 * sources to law-comment lines only.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	DOMAIN_HARNESS_CONTRACTS_VERSION,
	FORBIDDEN_HARNESS_DESCRIPTOR_KEYS,
	HARNESS_CAPABILITY_BINDING_STATES,
	HARNESS_DESCRIPTOR_SCHEMA_KEYS,
	HARNESS_ID_PREFIX,
	HARNESS_INDUSTRIES,
	HARNESS_LIFECYCLE_FORWARD_TRANSITIONS,
	HARNESS_LIFECYCLE_STATES,
	HARNESS_NOTE_SCHEMA_KEYS,
	HARNESS_PARSE_REJECTION_REASONS,
	HARNESS_RECORD_SCHEMA_KEYS,
	HARNESS_REF_FAMILIES,
	HARNESS_VALIDATION_REJECTION_REASONS,
	HARNESS_WORK_TYPES,
	canTransitionHarnessLifecycle,
	isHarnessCatalogSnapshot,
	isHarnessId,
	isHarnessIndustry,
	isHarnessLifecycleState,
	isHarnessParseRejectionReason,
	isHarnessRecord,
	isHarnessValidationOutcome,
	isHarnessValidationRejectionReason,
	isHarnessWorkType,
	parseHarnessRecord,
	serializeHarnessRecord,
	validateDomainHarnessDescriptor,
	validateHarnessDescriptorShape,
} from '../../common/domainHarnessContract.js';
import type {
	DomainHarnessDescriptor,
	HarnessCatalogSnapshot,
	HarnessRecord,
	HarnessValidationOutcome,
	HarnessValidationRejection,
} from '../../common/domainHarnessContract.js';

const FIXTURE_NOW_ISO = '2026-10-13T00:00:00.000Z';
const FIXTURE_HARNESS_ID = `${HARNESS_ID_PREFIX}0123456789abcdef`;

/** Loose override maps (the boundary-test discipline: invalid values typecheck at the call site). */
type LooseDescriptor = { [K in keyof DomainHarnessDescriptor]?: unknown };
type LooseCatalog = { [K in keyof HarnessCatalogSnapshot]?: unknown };
type LooseRecord = { [K in keyof HarnessRecord]?: unknown };

function fixtureDescriptor(overrides: LooseDescriptor = {}): DomainHarnessDescriptor {
	return {
		harnessId: FIXTURE_HARNESS_ID,
		contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
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
	} as unknown as DomainHarnessDescriptor;
}

function fixtureCatalog(overrides: LooseCatalog = {}): HarnessCatalogSnapshot {
	return {
		capabilities: [{ entryId: 'cap-fixture-001', state: 'approved' }],
		workflowIds: ['wf-fixture-001'],
		policyIds: ['pol-fixture-001'],
		evidenceIds: ['ev-fixture-001'],
		...overrides,
	} as unknown as HarnessCatalogSnapshot;
}

function fixtureRecord(overrides: LooseRecord = {}): HarnessRecord {
	return {
		harnessId: FIXTURE_HARNESS_ID,
		contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
		state: 'draft',
		descriptor: fixtureDescriptor(),
		mintedAtIso: FIXTURE_NOW_ISO,
		revision: 1,
		history: [
			{
				at: FIXTURE_NOW_ISO,
				fromState: null,
				toState: 'draft',
				law: 'THE FORWARD-ONLY LIFECYCLE LAW',
				decision: null,
				detail: 'fixture mint detail (shape validation green; dangling refs allowed at draft)',
			},
		],
		lastValidation: { ok: true, mode: 'shape', descriptor: fixtureDescriptor() },
		...overrides,
	} as unknown as HarnessRecord;
}

function parsedJson(value: unknown): unknown {
	return JSON.parse(JSON.stringify(value)) as unknown;
}

function rejectionsOf(outcome: HarnessValidationOutcome): readonly HarnessValidationRejection[] {
	assert.equal(outcome.ok, false, 'expected a refused outcome');
	return (outcome as { rejections: readonly HarnessValidationRejection[] }).rejections;
}

function reasonsOf(outcome: HarnessValidationOutcome): string[] {
	return rejectionsOf(outcome).map((rejection) => rejection.reason);
}

/** In-suite determinism grep: every hit must be a law-comment line (the ban is quoted, never called). */
function determinismGrepHits(relativeModulePath: string): string[] {
	const modulePath = fileURLToPath(new URL(relativeModulePath, import.meta.url));
	const source = readFileSync(modulePath, 'utf8');
	return source.split('\n').filter((line) => /Date\.now|Math\.random|new Date\(|process\.env/.test(line));
}

suite('DH-001 DomainHarness contract', () => {

	suite('version stamping (the single declaration)', () => {
		test('DOMAIN_HARNESS_CONTRACTS_VERSION is 1.0.0', () => {
			assert.equal(DOMAIN_HARNESS_CONTRACTS_VERSION, '1.0.0');
		});
	});

	suite('HARNESS_INDUSTRIES (the frozen list)', () => {
		test('the exact sixteen industries, in the frozen order', () => {
			assert.deepEqual([...HARNESS_INDUSTRIES], [
				'software',
				'legal',
				'finance',
				'healthcare',
				'education',
				'marketing',
				'science',
				'media',
				'construction',
				'logistics',
				'retail',
				'manufacturing',
				'energy',
				'agriculture',
				'government',
				'hospitality',
			]);
		});

		test('the industries are unique', () => {
			assert.equal(new Set(HARNESS_INDUSTRIES).size, HARNESS_INDUSTRIES.length);
		});

		test('isHarnessIndustry admits the members only', () => {
			assert.equal(isHarnessIndustry('software'), true);
			assert.equal(isHarnessIndustry('hospitality'), true);
			assert.equal(isHarnessIndustry('fintech'), false);
			assert.equal(isHarnessIndustry('Software'), false);
			assert.equal(isHarnessIndustry(''), false);
			assert.equal(isHarnessIndustry(null), false);
			assert.equal(isHarnessIndustry(1), false);
		});
	});

	suite('HARNESS_WORK_TYPES (the frozen list)', () => {
		test('the exact ten work types, in the frozen order', () => {
			assert.deepEqual([...HARNESS_WORK_TYPES], [
				'analysis',
				'drafting',
				'review',
				'planning',
				'research',
				'reporting',
				'data-processing',
				'compliance',
				'communication',
				'administration',
			]);
		});

		test('the work types are unique', () => {
			assert.equal(new Set(HARNESS_WORK_TYPES).size, HARNESS_WORK_TYPES.length);
		});

		test('isHarnessWorkType admits the members only', () => {
			assert.equal(isHarnessWorkType('analysis'), true);
			assert.equal(isHarnessWorkType('administration'), true);
			assert.equal(isHarnessWorkType('coding'), false);
			assert.equal(isHarnessWorkType('data_processing'), false);
			assert.equal(isHarnessWorkType(''), false);
			assert.equal(isHarnessWorkType(null), false);
		});
	});

	suite('HARNESS_LIFECYCLE_STATES + the forward whitelist', () => {
		test('the exact five states, in the frozen order', () => {
			assert.deepEqual([...HARNESS_LIFECYCLE_STATES], ['draft', 'proposed', 'approved', 'active', 'retired']);
		});

		test('the states are unique', () => {
			assert.equal(new Set(HARNESS_LIFECYCLE_STATES).size, HARNESS_LIFECYCLE_STATES.length);
		});

		test('isHarnessLifecycleState admits the members only', () => {
			assert.equal(isHarnessLifecycleState('draft'), true);
			assert.equal(isHarnessLifecycleState('retired'), true);
			assert.equal(isHarnessLifecycleState('archived'), false);
			assert.equal(isHarnessLifecycleState('Draft'), false);
			assert.equal(isHarnessLifecycleState(null), false);
		});

		test('the exact four forward rows, in the frozen order', () => {
			assert.deepEqual([...HARNESS_LIFECYCLE_FORWARD_TRANSITIONS], [
				{ from: 'draft', to: 'proposed' },
				{ from: 'proposed', to: 'approved' },
				{ from: 'approved', to: 'active' },
				{ from: 'active', to: 'retired' },
			]);
		});

		test('the whitelist rows are unique', () => {
			assert.equal(new Set(HARNESS_LIFECYCLE_FORWARD_TRANSITIONS.map((row) => `${row.from}->${row.to}`)).size, 4);
		});
	});

	suite('canTransitionHarnessLifecycle (the verdict matrix)', () => {
		test('every legal edge is green and names its granting row', () => {
			assert.deepEqual(canTransitionHarnessLifecycle('draft', 'proposed'), { ok: true, from: 'draft', to: 'proposed', row: 1 });
			assert.deepEqual(canTransitionHarnessLifecycle('proposed', 'approved'), { ok: true, from: 'proposed', to: 'approved', row: 2 });
			assert.deepEqual(canTransitionHarnessLifecycle('approved', 'active'), { ok: true, from: 'approved', to: 'active', row: 3 });
			assert.deepEqual(canTransitionHarnessLifecycle('active', 'retired'), { ok: true, from: 'active', to: 'retired', row: 4 });
		});

		test('the full matrix: exactly the four whitelist edges are green, every other edge refused', () => {
			for (const from of HARNESS_LIFECYCLE_STATES) {
				for (const to of HARNESS_LIFECYCLE_STATES) {
					const verdict = canTransitionHarnessLifecycle(from, to);
					const whitelisted = (HARNESS_LIFECYCLE_FORWARD_TRANSITIONS as readonly { from: string; to: string }[]).some(
						(row) => row.from === from && row.to === to,
					);
					assert.equal(verdict.ok, whitelisted, `edge ${from}->${to} must be ${whitelisted ? 'green' : 'refused'}`);
				}
			}
		});

		test('a skip is refused naming the violated whitelist row', () => {
			const verdict = canTransitionHarnessLifecycle('draft', 'approved');
			assert.equal(verdict.ok, false);
			assert.equal((verdict as { reason: string }).reason, 'ILLEGAL_TRANSITION');
			assert.equal((verdict as { whitelistRow: number | null }).whitelistRow, 1);
			assert.equal((verdict as { expectedTo: string | null }).expectedTo, 'proposed');
			assert.match((verdict as { detail: string }).detail, /row 1/);
		});

		test('a skip from proposed is refused naming row 2', () => {
			const verdict = canTransitionHarnessLifecycle('proposed', 'retired');
			assert.equal(verdict.ok, false);
			assert.equal((verdict as { whitelistRow: number | null }).whitelistRow, 2);
			assert.equal((verdict as { expectedTo: string | null }).expectedTo, 'approved');
		});

		test('a backwards move is refused', () => {
			for (const [from, to] of [['proposed', 'draft'], ['approved', 'proposed'], ['active', 'approved'], ['retired', 'active']] as const) {
				const verdict = canTransitionHarnessLifecycle(from, to);
				assert.equal(verdict.ok, false, `${from}->${to} must be refused`);
				assert.equal((verdict as { reason: string }).reason, 'ILLEGAL_TRANSITION');
			}
		});

		test('retired is TERMINAL - every edge out of retired is refused with no whitelist row', () => {
			for (const to of ['draft', 'proposed', 'approved', 'active', 'retired']) {
				const verdict = canTransitionHarnessLifecycle('retired', to);
				assert.equal(verdict.ok, false, `retired->${to} must be refused`);
				assert.equal((verdict as { whitelistRow: number | null }).whitelistRow, null);
				assert.equal((verdict as { expectedTo: string | null }).expectedTo, null);
				assert.match((verdict as { detail: string }).detail, /TERMINAL/);
			}
		});

		test('self-loops are refused', () => {
			for (const state of HARNESS_LIFECYCLE_STATES) {
				assert.equal(canTransitionHarnessLifecycle(state, state).ok, false, `${state}->${state} must be refused`);
			}
		});

		test('unknown states fail closed', () => {
			for (const [from, to] of [['draft', 'bogus'], ['bogus', 'draft'], ['bogus', 'bogus']] as const) {
				const verdict = canTransitionHarnessLifecycle(from, to);
				assert.equal(verdict.ok, false);
				assert.equal((verdict as { reason: string }).reason, 'ILLEGAL_TRANSITION');
				assert.match((verdict as { detail: string }).detail, /frozen HARNESS_LIFECYCLE_STATES list/);
			}
		});

		test('non-string states fail closed', () => {
			assert.equal(canTransitionHarnessLifecycle(null, 'draft').ok, false);
			assert.equal(canTransitionHarnessLifecycle('draft', 123).ok, false);
			assert.equal(canTransitionHarnessLifecycle(undefined, undefined).ok, false);
		});
	});

	suite('FORBIDDEN_HARNESS_DESCRIPTOR_KEYS (the NO-FORK family)', () => {
		test('the exact ten forbidden keys, in the frozen order', () => {
			assert.deepEqual([...FORBIDDEN_HARNESS_DESCRIPTOR_KEYS], [
				'command',
				'commands',
				'tool',
				'tools',
				'implementation',
				'code',
				'script',
				'inline',
				'patch',
				'fork',
			]);
		});

		test('the forbidden keys are unique', () => {
			assert.equal(new Set(FORBIDDEN_HARNESS_DESCRIPTOR_KEYS).size, FORBIDDEN_HARNESS_DESCRIPTOR_KEYS.length);
		});
	});

	suite('HARNESS_DESCRIPTOR_SCHEMA_KEYS (the frozen strict schema)', () => {
		test('the exact ten keys, in the canonical fixed-key-order', () => {
			assert.deepEqual([...HARNESS_DESCRIPTOR_SCHEMA_KEYS], [
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
	});

	suite('HARNESS_CAPABILITY_BINDING_STATES (the catalog-binding law)', () => {
		test('the exact three allowed states, in the frozen order', () => {
			assert.deepEqual([...HARNESS_CAPABILITY_BINDING_STATES], ['approved', 'enabled', 'available']);
		});
	});

	suite('HARNESS_VALIDATION_REJECTION_REASONS (the frozen table)', () => {
		test('the exact seventeen reasons, in the exact walk order', () => {
			assert.deepEqual([...HARNESS_VALIDATION_REJECTION_REASONS], [
				'malformed-descriptor',
				'no-fork',
				'unknown-key',
				'missing-key',
				'unknown-harness-id',
				'version-mismatch',
				'unknown-industry',
				'empty-work-types',
				'unknown-work-type',
				'duplicate-work-types',
				'work-types-out-of-order',
				'invalid-display-name',
				'empty-roles',
				'malformed-role',
				'duplicate-role-keys',
				'duplicate-ref',
				'dangling-ref',
			]);
		});

		test('the reasons are unique', () => {
			assert.equal(new Set(HARNESS_VALIDATION_REJECTION_REASONS).size, HARNESS_VALIDATION_REJECTION_REASONS.length);
		});

		test('isHarnessValidationRejectionReason admits the members only', () => {
			assert.equal(isHarnessValidationRejectionReason('no-fork'), true);
			assert.equal(isHarnessValidationRejectionReason('dangling-ref'), true);
			assert.equal(isHarnessValidationRejectionReason('no-forks'), false);
			assert.equal(isHarnessValidationRejectionReason(''), false);
			assert.equal(isHarnessValidationRejectionReason(null), false);
		});
	});

	suite('HARNESS_PARSE_REJECTION_REASONS (the frozen parse table)', () => {
		test('the exact five reasons, in the exact first-failure order', () => {
			assert.deepEqual([...HARNESS_PARSE_REJECTION_REASONS], [
				'malformed-json',
				'torn-envelope',
				'unknown-contract-version',
				'unknown-key',
				'invalid-record',
			]);
		});

		test('isHarnessParseRejectionReason admits the members only', () => {
			assert.equal(isHarnessParseRejectionReason('torn-envelope'), true);
			assert.equal(isHarnessParseRejectionReason('torn'), false);
			assert.equal(isHarnessParseRejectionReason(null), false);
		});
	});

	suite('isHarnessId', () => {
		test('admits a well-formed id', () => {
			assert.equal(isHarnessId(FIXTURE_HARNESS_ID), true);
		});

		test('rejects a non-string', () => {
			assert.equal(isHarnessId(null), false);
			assert.equal(isHarnessId(123), false);
		});

		test('rejects a wrong prefix', () => {
			assert.equal(isHarnessId('flauz:prd:0123456789abcdef'), false);
			assert.equal(isHarnessId('0123456789abcdef'), false);
		});

		test('rejects a non-16-hex suffix (too short / too long)', () => {
			assert.equal(isHarnessId(`${HARNESS_ID_PREFIX}0123`), false);
			assert.equal(isHarnessId(`${HARNESS_ID_PREFIX}0123456789abcdef0`), false);
		});

		test('rejects uppercase hex and non-hex chars', () => {
			assert.equal(isHarnessId(`${HARNESS_ID_PREFIX}0123456789ABCDEF`), false);
			assert.equal(isHarnessId(`${HARNESS_ID_PREFIX}0123456789abcdeg`), false);
		});
	});

	suite('isHarnessCatalogSnapshot', () => {
		test('admits a well-formed snapshot', () => {
			assert.equal(isHarnessCatalogSnapshot(fixtureCatalog()), true);
		});

		test('admits a JSON-parsed snapshot at the runtime boundary', () => {
			assert.equal(isHarnessCatalogSnapshot(parsedJson(fixtureCatalog())), true);
		});

		test('rejects a non-object', () => {
			assert.equal(isHarnessCatalogSnapshot(null), false);
			assert.equal(isHarnessCatalogSnapshot('string'), false);
			assert.equal(isHarnessCatalogSnapshot([]), false);
		});

		test('rejects a missing or extra key', () => {
			const { capabilities, workflowIds, policyIds } = fixtureCatalog();
			assert.equal(isHarnessCatalogSnapshot({ capabilities, workflowIds, policyIds }), false);
			assert.equal(isHarnessCatalogSnapshot({ ...fixtureCatalog(), extra: true }), false);
		});

		test('rejects a malformed capability entry', () => {
			const snapshot = fixtureCatalog({ capabilities: [{ entryId: 'cap-fixture-001' }] as never });
			assert.equal(isHarnessCatalogSnapshot(snapshot), false);
			const snapshot2 = fixtureCatalog({ capabilities: [{ entryId: '', state: 'approved' }] });
			assert.equal(isHarnessCatalogSnapshot(snapshot2), false);
			const snapshot3 = fixtureCatalog({ capabilities: [{ entryId: 'cap-fixture-001', state: 'approved', extra: 1 }] });
			assert.equal(isHarnessCatalogSnapshot(snapshot3), false);
		});

		test('rejects duplicate entryIds and duplicate id-family members', () => {
			const snapshot = fixtureCatalog({ capabilities: [
				{ entryId: 'cap-fixture-001', state: 'approved' },
				{ entryId: 'cap-fixture-001', state: 'enabled' },
			] });
			assert.equal(isHarnessCatalogSnapshot(snapshot), false);
			assert.equal(isHarnessCatalogSnapshot(fixtureCatalog({ workflowIds: ['wf-fixture-001', 'wf-fixture-001'] })), false);
		});

		test('rejects non-string id-family members', () => {
			assert.equal(isHarnessCatalogSnapshot(fixtureCatalog({ policyIds: [123] as unknown as string[] })), false);
			assert.equal(isHarnessCatalogSnapshot(fixtureCatalog({ evidenceIds: [''] })), false);
		});
	});

	suite('validateDomainHarnessDescriptor (the full walk)', () => {
		test('admits a well-formed descriptor over a resolving catalog', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor(), fixtureCatalog());
			assert.equal(outcome.ok, true);
			assert.equal(outcome.mode, 'full');
			assert.deepEqual(outcome.descriptor, fixtureDescriptor());
		});

		test('admits a JSON-parsed descriptor at the runtime boundary', () => {
			const outcome = validateDomainHarnessDescriptor(parsedJson(fixtureDescriptor()), parsedJson(fixtureCatalog()));
			assert.equal(outcome.ok, true);
		});

		test('the ok branch carries the canonical fixed-key-order copy', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor(), fixtureCatalog());
			assert.equal(outcome.ok, true);
			assert.deepEqual(Object.keys(outcome.descriptor), [...HARNESS_DESCRIPTOR_SCHEMA_KEYS]);
		});

		test('the rejection table lists EVERY violated law (multi-violation)', () => {
			const descriptor = fixtureDescriptor({
				industry: 'fintech',
				workTypes: ['analysis', 'analysis'],
				displayName: 'x'.repeat(81),
			});
			const outcome = validateDomainHarnessDescriptor(descriptor, fixtureCatalog());
			assert.equal(outcome.ok, false);
			assert.equal(outcome.mode, 'full');
			assert.deepEqual(reasonsOf(outcome), ['unknown-industry', 'duplicate-work-types', 'invalid-display-name']);
		});
	});

	suite('the frozen-vocabulary family', () => {
		test('an unknown industry is the unknown-industry rejection naming the value', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ industry: 'fintech' }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections.length, 1);
			assert.equal(rejections[0].reason, 'unknown-industry');
			assert.equal(rejections[0].law, 'THE FROZEN-VOCABULARY LAW');
			assert.deepEqual(rejections[0].items, ['fintech']);
		});

		test('an unknown work type is the unknown-work-type rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: ['analysis', 'coding'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'unknown-work-type');
			assert.deepEqual(rejections[0].items, ['coding']);
		});

		test('empty workTypes is the empty-work-types rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: [] }), fixtureCatalog());
			assert.deepEqual(reasonsOf(outcome), ['empty-work-types']);
		});

		test('duplicate workTypes is the duplicate-work-types rejection naming the duplicate', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: ['analysis', 'drafting', 'analysis'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'duplicate-work-types');
			assert.deepEqual(rejections[0].items, ['analysis']);
		});

		test('out-of-order workTypes is the work-types-out-of-order rejection naming the inversion pair', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: ['drafting', 'analysis'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'work-types-out-of-order');
			assert.deepEqual(rejections[0].items, ['drafting', 'analysis']);
		});

		test('the full frozen list order is admissible (all ten members)', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: [...HARNESS_WORK_TYPES] }), fixtureCatalog());
			assert.equal(outcome.ok, true);
		});
	});

	suite('THE NO-FORK family (the structural engine)', () => {
		test('each forbidden key is the no-fork rejection (all ten)', () => {
			for (const key of FORBIDDEN_HARNESS_DESCRIPTOR_KEYS) {
				const descriptor = { ...fixtureDescriptor(), [key]: 'fixture execution material' } as unknown;
				const outcome = validateDomainHarnessDescriptor(descriptor, fixtureCatalog());
				const rejections = rejectionsOf(outcome);
				assert.equal(rejections[0].reason, 'no-fork', `the '${key}' key must be the NO-FORK rejection`);
				assert.equal(rejections[0].law, 'THE NO-FORK LAW');
				assert.deepEqual(rejections[0].items, [key]);
			}
		});

		test('the forbidden key takes precedence over unknown-key (never reported as unknown)', () => {
			const descriptor = { ...fixtureDescriptor(), command: 'ls', banana: true } as unknown;
			const outcome = validateDomainHarnessDescriptor(descriptor, fixtureCatalog());
			assert.deepEqual(reasonsOf(outcome), ['no-fork', 'unknown-key']);
			const noFork = rejectionsOf(outcome)[0];
			assert.deepEqual(noFork.items, ['command']);
		});

		test('an unknown key outside the forbidden family is the unknown-key rejection', () => {
			const descriptor = { ...fixtureDescriptor(), banana: true } as unknown;
			const rejections = rejectionsOf(validateDomainHarnessDescriptor(descriptor, fixtureCatalog()));
			assert.equal(rejections[0].reason, 'unknown-key');
			assert.equal(rejections[0].law, 'THE NO-FORK LAW');
			assert.deepEqual(rejections[0].items, ['banana']);
		});

		test('a role entry with an extra key is the no-fork rejection', () => {
			const descriptor = fixtureDescriptor({
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role', permissions: ['read'] }],
			});
			const rejections = rejectionsOf(validateDomainHarnessDescriptor(descriptor, fixtureCatalog()));
			assert.equal(rejections[0].reason, 'no-fork');
			assert.deepEqual(rejections[0].items, ['roles[0].permissions']);
			assert.match(rejections[0].detail, /grants NOTHING by itself/);
		});

		test('a role entry with a forbidden key is the no-fork rejection', () => {
			const descriptor = fixtureDescriptor({
				roles: [{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role', command: 'ls' }],
			});
			const rejections = rejectionsOf(validateDomainHarnessDescriptor(descriptor, fixtureCatalog()));
			assert.equal(rejections[0].reason, 'no-fork');
			assert.deepEqual(rejections[0].items, ['roles[0].command']);
		});
	});

	suite('THE NO-DANGLING-REF family', () => {
		test('a dangling capabilityRef is the dangling-ref rejection for the capabilityRefs family', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ capabilityRefs: ['cap-fixture-404'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections.length, 1);
			assert.equal(rejections[0].reason, 'dangling-ref');
			assert.equal(rejections[0].law, 'THE NO-DANGLING-REF LAW');
			assert.equal(rejections[0].family, 'capabilityRefs');
			assert.deepEqual(rejections[0].items, ['cap-fixture-404']);
		});

		test('a dangling workflowRef is reported for the workflowRefs family', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workflowRefs: ['wf-fixture-404'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].family, 'workflowRefs');
			assert.deepEqual(rejections[0].items, ['wf-fixture-404']);
		});

		test('a dangling policyRef is reported for the policyRefs family', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ policyRefs: ['pol-fixture-404'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].family, 'policyRefs');
		});

		test('a dangling evidenceRef is reported for the evidenceRefs family', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ evidenceRefs: ['ev-fixture-404'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].family, 'evidenceRefs');
		});

		test('multi-dangling reports every family with every offender', () => {
			const descriptor = fixtureDescriptor({
				capabilityRefs: ['cap-fixture-404', 'cap-fixture-405'],
				workflowRefs: ['wf-fixture-404'],
			});
			const rejections = rejectionsOf(validateDomainHarnessDescriptor(descriptor, fixtureCatalog()));
			assert.equal(rejections.length, 2);
			assert.equal(rejections[0].family, 'capabilityRefs');
			assert.deepEqual(rejections[0].items, ['cap-fixture-404', 'cap-fixture-405']);
			assert.equal(rejections[1].family, 'workflowRefs');
			assert.deepEqual(rejections[1].items, ['wf-fixture-404']);
		});

		test('a resolving catalog flips the outcome green', () => {
			const dangling = fixtureDescriptor({ capabilityRefs: ['cap-fixture-new'] });
			assert.equal(validateDomainHarnessDescriptor(dangling, fixtureCatalog()).ok, false);
			const resolving = fixtureCatalog({ capabilities: [{ entryId: 'cap-fixture-new', state: 'discovered' }] });
			assert.equal(validateDomainHarnessDescriptor(dangling, resolving).ok, true);
		});

		test('a malformed catalog resolves nothing (every non-empty family dangles)', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor(), null);
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections.length, 4);
			for (const family of HARNESS_REF_FAMILIES) {
				assert.equal(rejections.some((rejection) => rejection.family === family), true, `the ${family} family must dangle`);
			}
		});
	});

	suite('id / version / displayName shape checks', () => {
		test('a malformed id is the unknown-harness-id rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ harnessId: 'flauz:hrn:short' }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'unknown-harness-id');
			assert.deepEqual(rejections[0].items, ['flauz:hrn:short']);
		});

		test('a wrong contractVersion is the version-mismatch rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ contractVersion: '2.0.0' }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'version-mismatch');
			assert.equal(rejections[0].law, 'THE SINGLE-VERSION LAW');
			assert.deepEqual(rejections[0].items, ['2.0.0']);
		});

		test('an empty displayName is the invalid-display-name rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ displayName: '' }), fixtureCatalog());
			assert.deepEqual(reasonsOf(outcome), ['invalid-display-name']);
		});

		test('an 81-char displayName is refused; an 80-char displayName is the boundary green', () => {
			const refused = validateDomainHarnessDescriptor(fixtureDescriptor({ displayName: 'x'.repeat(81) }), fixtureCatalog());
			assert.deepEqual(reasonsOf(refused), ['invalid-display-name']);
			const green = validateDomainHarnessDescriptor(fixtureDescriptor({ displayName: 'x'.repeat(80) }), fixtureCatalog());
			assert.equal(green.ok, true);
		});
	});

	suite('the roles family', () => {
		test('empty roles is the empty-roles rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ roles: [] }), fixtureCatalog());
			assert.deepEqual(reasonsOf(outcome), ['empty-roles']);
		});

		test('a malformed role (missing summary) is the malformed-role rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ roles: [{ roleKey: 'fixture.counsel' }] as never }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'malformed-role');
			assert.deepEqual(rejections[0].items, ['roles[0]']);
		});

		test('a non-object role entry is the malformed-role rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ roles: ['not-a-role'] as never }), fixtureCatalog());
			assert.deepEqual(reasonsOf(outcome), ['malformed-role']);
		});

		test('duplicate roleKeys is the duplicate-role-keys rejection naming the duplicate', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({
				roles: [
					{ roleKey: 'fixture.counsel', summary: 'the fixture counsel role' },
					{ roleKey: 'fixture.counsel', summary: 'the duplicate counsel role' },
				],
			}), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'duplicate-role-keys');
			assert.deepEqual(rejections[0].items, ['fixture.counsel']);
		});
	});

	suite('structural checks', () => {
		test('a non-object is the malformed-descriptor rejection (the only rejection)', () => {
			for (const value of [null, 'string', 123, [], undefined]) {
				const outcome = validateDomainHarnessDescriptor(value, fixtureCatalog());
				const rejections = rejectionsOf(outcome);
				assert.equal(rejections.length, 1);
				assert.equal(rejections[0].reason, 'malformed-descriptor');
			}
		});

		test('a missing key is the missing-key rejection naming the key', () => {
			const descriptor = { ...fixtureDescriptor() } as Record<string, unknown>;
			delete descriptor.roles;
			const outcome = validateDomainHarnessDescriptor(descriptor, fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'missing-key');
			assert.deepEqual(rejections[0].items, ['roles']);
		});

		test('a non-array workTypes is the malformed-descriptor rejection', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ workTypes: 'analysis' as unknown as string[] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'malformed-descriptor');
			assert.deepEqual(rejections[0].items, ['workTypes']);
		});

		test('a non-string ref member is the malformed-descriptor rejection naming the slot', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ capabilityRefs: [123] as unknown as string[] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'malformed-descriptor');
			assert.deepEqual(rejections[0].items, ['capabilityRefs[0]']);
		});

		test('duplicate refs are the duplicate-ref rejection carrying the family', () => {
			const outcome = validateDomainHarnessDescriptor(fixtureDescriptor({ evidenceRefs: ['ev-fixture-001', 'ev-fixture-001'] }), fixtureCatalog());
			const rejections = rejectionsOf(outcome);
			assert.equal(rejections[0].reason, 'duplicate-ref');
			assert.equal(rejections[0].family, 'evidenceRefs');
			assert.deepEqual(rejections[0].items, ['ev-fixture-001']);
		});
	});

	suite('validateHarnessDescriptorShape (THE TWO-PHASE LAW draft mode)', () => {
		test('dangling refs are ALLOWED at draft (the shape walk ignores resolution)', () => {
			const outcome = validateHarnessDescriptorShape(fixtureDescriptor({ capabilityRefs: ['cap-fixture-404'] }));
			assert.equal(outcome.ok, true);
			assert.equal(outcome.mode, 'shape');
		});

		test('the frozen-vocab and NO-FORK laws still bite at draft', () => {
			assert.deepEqual(reasonsOf(validateHarnessDescriptorShape(fixtureDescriptor({ industry: 'fintech' }))), ['unknown-industry']);
			const descriptor = { ...fixtureDescriptor(), command: 'ls' } as unknown;
			assert.deepEqual(reasonsOf(validateHarnessDescriptorShape(descriptor)), ['no-fork']);
		});

		test('the full walk refuses what the shape walk allowed (the boundary difference)', () => {
			const descriptor = fixtureDescriptor({ workflowRefs: ['wf-fixture-404'] });
			assert.equal(validateHarnessDescriptorShape(descriptor).ok, true);
			assert.equal(validateDomainHarnessDescriptor(descriptor, fixtureCatalog()).ok, false);
		});
	});

	suite('isHarnessValidationOutcome / isHarnessRecord', () => {
		test('isHarnessValidationOutcome admits the ok and refused shapes only', () => {
			assert.equal(isHarnessValidationOutcome({ ok: true, mode: 'shape', descriptor: fixtureDescriptor() }), true);
			assert.equal(isHarnessValidationOutcome({ ok: true, mode: 'full', descriptor: fixtureDescriptor() }), true);
			assert.equal(
				isHarnessValidationOutcome({
					ok: false,
					mode: 'full',
					rejections: [{ reason: 'dangling-ref', law: 'THE NO-DANGLING-REF LAW', family: 'capabilityRefs', items: ['cap-fixture-404'], detail: 'fixture detail' }],
				}),
				true,
			);
			assert.equal(isHarnessValidationOutcome({ ok: true, mode: 'bogus', descriptor: fixtureDescriptor() }), false);
			assert.equal(isHarnessValidationOutcome({ ok: true, mode: 'shape' }), false);
			assert.equal(isHarnessValidationOutcome({ ok: false, mode: 'full', rejections: [] }), false);
			assert.equal(isHarnessValidationOutcome(null), false);
		});

		test('isHarnessRecord admits the well-formed record', () => {
			assert.equal(isHarnessRecord(fixtureRecord()), true);
			assert.equal(isHarnessRecord(parsedJson(fixtureRecord())), true);
		});

		test('isHarnessRecord rejects drift (bad id, bad state, bad revision, malformed note)', () => {
			assert.equal(isHarnessRecord({ ...fixtureRecord(), harnessId: 'bad' }), false);
			assert.equal(isHarnessRecord({ ...fixtureRecord(), state: 'bogus' }), false);
			assert.equal(isHarnessRecord({ ...fixtureRecord(), revision: 0 }), false);
			assert.equal(isHarnessRecord({ ...fixtureRecord(), revision: 1.5 }), false);
			assert.equal(isHarnessRecord({ ...fixtureRecord(), history: [{ at: '', fromState: null, toState: 'draft', law: 'LAW', decision: null, detail: 'd' }] }), false);
			assert.equal(isHarnessRecord({ ...fixtureRecord(), extra: true }), false);
			assert.equal(isHarnessRecord(null), false);
		});
	});

	suite('serializeHarnessRecord (the canonical bytes)', () => {
		test('the frozen key orders are pinned (record, descriptor, role, note, validation)', () => {
			const bytes = serializeHarnessRecord(fixtureRecord());
			const parsed = JSON.parse(bytes) as Record<string, unknown>;
			assert.deepEqual(Object.keys(parsed), [...HARNESS_RECORD_SCHEMA_KEYS]);
			const descriptor = parsed.descriptor as Record<string, unknown>;
			assert.deepEqual(Object.keys(descriptor), [...HARNESS_DESCRIPTOR_SCHEMA_KEYS]);
			const role = (descriptor.roles as Record<string, unknown>[])[0];
			assert.deepEqual(Object.keys(role), ['roleKey', 'summary']);
			const note = (parsed.history as Record<string, unknown>[])[0];
			assert.deepEqual(Object.keys(note), [...HARNESS_NOTE_SCHEMA_KEYS]);
			const validation = parsed.lastValidation as Record<string, unknown>;
			assert.deepEqual(Object.keys(validation), ['ok', 'mode', 'descriptor']);
		});

		test('double-serialize byte equality (determinism)', () => {
			const first = serializeHarnessRecord(fixtureRecord());
			const second = serializeHarnessRecord(fixtureRecord());
			assert.equal(first, second);
		});

		test('two equal-valued instances produce identical bytes', () => {
			assert.equal(serializeHarnessRecord(fixtureRecord()), serializeHarnessRecord(JSON.parse(JSON.stringify(fixtureRecord())) as HarnessRecord));
		});

		test('the decision emits in the frozen canonical order', () => {
			const record = fixtureRecord({
				state: 'approved',
				history: [
					{
						at: FIXTURE_NOW_ISO,
						fromState: 'proposed',
						toState: 'approved',
						law: 'THE CATALOG-BINDING LAW',
						decision: { note: 'fixture note', approvedBy: 'fixture.approver' },
						detail: 'fixture approve detail',
					},
				],
			});
			const parsed = JSON.parse(serializeHarnessRecord(record)) as { history: { decision: Record<string, string> }[] };
			assert.deepEqual(Object.keys(parsed.history[0].decision), ['approvedBy', 'note']);
		});

		test('the refused validation outcome emits its rejections in the walk order', () => {
			const record = fixtureRecord({
				lastValidation: {
					ok: false,
					mode: 'full',
					rejections: [
						{ reason: 'unknown-industry', law: 'THE FROZEN-VOCABULARY LAW', items: ['fintech'], detail: 'fixture detail one' },
						{ reason: 'dangling-ref', law: 'THE NO-DANGLING-REF LAW', family: 'capabilityRefs', items: ['cap-fixture-404'], detail: 'fixture detail two' },
					],
				},
			});
			const parsed = JSON.parse(serializeHarnessRecord(record)) as { lastValidation: { rejections: Record<string, unknown>[] } };
			assert.deepEqual(Object.keys(parsed.lastValidation), ['ok', 'mode', 'rejections']);
			assert.deepEqual(Object.keys(parsed.lastValidation.rejections[0]), ['reason', 'law', 'items', 'detail']);
			assert.deepEqual(Object.keys(parsed.lastValidation.rejections[1]), ['reason', 'law', 'family', 'items', 'detail']);
		});

		test('throws TypeError on a malformed record', () => {
			assert.throws(() => serializeHarnessRecord({ ...fixtureRecord(), state: 'bogus' }), TypeError);
			assert.throws(() => serializeHarnessRecord(null), TypeError);
			assert.throws(() => serializeHarnessRecord('string'), TypeError);
		});
	});

	suite('parseHarnessRecord (the fail-closed parse)', () => {
		test('round-trips the canonical bytes', () => {
			const bytes = serializeHarnessRecord(fixtureRecord());
			const outcome = parseHarnessRecord(bytes);
			assert.equal(outcome.ok, true);
			assert.deepEqual(outcome.record, fixtureRecord());
		});

		test('re-serializing the parsed record is byte-identical (canonical normalization)', () => {
			const bytes = serializeHarnessRecord(fixtureRecord());
			const outcome = parseHarnessRecord(bytes);
			assert.equal(outcome.ok, true);
			assert.equal(serializeHarnessRecord(outcome.record), bytes);
		});

		test('shuffled key order parses green and re-canonicalizes', () => {
			const bytes = serializeHarnessRecord(fixtureRecord());
			const shuffled = JSON.stringify({
				lastValidation: (JSON.parse(bytes) as Record<string, unknown>).lastValidation,
				history: (JSON.parse(bytes) as Record<string, unknown>).history,
				revision: 1,
				mintedAtIso: FIXTURE_NOW_ISO,
				descriptor: (JSON.parse(bytes) as Record<string, unknown>).descriptor,
				state: 'draft',
				contractVersion: DOMAIN_HARNESS_CONTRACTS_VERSION,
				harnessId: FIXTURE_HARNESS_ID,
			});
			const outcome = parseHarnessRecord(shuffled);
			assert.equal(outcome.ok, true);
			assert.equal(serializeHarnessRecord(outcome.record), bytes);
		});

		test('malformed JSON is the malformed-json rejection', () => {
			const outcome = parseHarnessRecord('{"harnessId": "flauz:hrn:012345678');
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'malformed-json');
		});

		test('a non-string bytes value is the torn-envelope rejection', () => {
			const outcome = parseHarnessRecord(null);
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'torn-envelope');
		});

		test('a structurally incomplete envelope is the torn-envelope rejection', () => {
			const outcome = parseHarnessRecord('{}');
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'torn-envelope');
			assert.match(outcome.rejection.detail, /missing/);
			const outcome2 = parseHarnessRecord(JSON.stringify({ harnessId: FIXTURE_HARNESS_ID }));
			assert.equal(outcome2.ok, false);
			assert.equal(outcome2.rejection.reason, 'torn-envelope');
		});

		test('a non-object JSON payload is the torn-envelope rejection', () => {
			for (const bytes of ['[]', '42', '"string"', 'null']) {
				const outcome = parseHarnessRecord(bytes);
				assert.equal(outcome.ok, false, `bytes '${bytes}' must be refused`);
				assert.equal(outcome.rejection.reason, 'torn-envelope');
			}
		});

		test('a torn descriptor roles carrier fails closed (invalid-record, never a bare throw)', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const descriptor = parsed.descriptor as Record<string, unknown>;
			const torn = JSON.stringify({ ...parsed, descriptor: { ...descriptor, roles: null } });
			const outcome = parseHarnessRecord(torn);
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'invalid-record');
		});

		test('a record-level roles carrier is the unknown-key rejection (the record schema is closed)', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const extra = JSON.stringify({ ...parsed, roles: null });
			const outcome = parseHarnessRecord(extra);
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'unknown-key');
		});

		test('an unknown record-level contract version is the unknown-contract-version rejection', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const drifted = JSON.stringify({ ...parsed, contractVersion: '9.9.9' });
			const outcome = parseHarnessRecord(drifted);
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'unknown-contract-version');
			assert.match(outcome.rejection.detail, /9\.9\.9/);
		});

		test('an unknown descriptor-level contract version is the unknown-contract-version rejection', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const descriptor = parsed.descriptor as Record<string, unknown>;
			const drifted = JSON.stringify({ ...parsed, descriptor: { ...descriptor, contractVersion: '9.9.9' } });
			const outcome = parseHarnessRecord(drifted);
			assert.equal(outcome.ok, false);
			assert.equal(outcome.rejection.reason, 'unknown-contract-version');
		});

		test('an unknown key at the record / descriptor / role / note level is the unknown-key rejection', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const descriptor = parsed.descriptor as Record<string, unknown>;
			const roles = descriptor.roles as Record<string, unknown>[];
			const history = parsed.history as Record<string, unknown>[];
			const recordLevel = parseHarnessRecord(JSON.stringify({ ...parsed, extra: true }));
			assert.equal(recordLevel.ok, false);
			assert.equal(recordLevel.rejection.reason, 'unknown-key');
			const descriptorLevel = parseHarnessRecord(JSON.stringify({ ...parsed, descriptor: { ...descriptor, extra: true } }));
			assert.equal(descriptorLevel.ok, false);
			assert.equal(descriptorLevel.rejection.reason, 'unknown-key');
			const roleLevel = parseHarnessRecord(JSON.stringify({ ...parsed, descriptor: { ...descriptor, roles: [{ ...roles[0], extra: true }, roles[1]] } }));
			assert.equal(roleLevel.ok, false);
			assert.equal(roleLevel.rejection.reason, 'unknown-key');
			const noteLevel = parseHarnessRecord(JSON.stringify({ ...parsed, history: [{ ...history[0], extra: true }] }));
			assert.equal(noteLevel.ok, false);
			assert.equal(noteLevel.rejection.reason, 'unknown-key');
		});

		test('semantically invalid content is the invalid-record rejection', () => {
			const parsed = JSON.parse(serializeHarnessRecord(fixtureRecord())) as Record<string, unknown>;
			const badId = parseHarnessRecord(JSON.stringify({ ...parsed, harnessId: 'bad' }));
			assert.equal(badId.ok, false);
			assert.equal(badId.rejection.reason, 'invalid-record');
			const badState = parseHarnessRecord(JSON.stringify({ ...parsed, state: 'bogus' }));
			assert.equal(badState.ok, false);
			assert.equal(badState.rejection.reason, 'invalid-record');
			const badDescriptor = parseHarnessRecord(JSON.stringify({ ...parsed, descriptor: { ...(parsed.descriptor as Record<string, unknown>), industry: 'fintech' } }));
			assert.equal(badDescriptor.ok, false);
			assert.equal(badDescriptor.rejection.reason, 'invalid-record');
		});
	});

	suite('in-suite determinism greps (the determinism law as a test)', () => {
		test('every Date.now / Math.random / new Date( / process.env hit in domainHarnessContract.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/domainHarnessContract.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});

		test('every Date.now / Math.random / new Date( / process.env hit in domainHarnessKit.ts is a law-comment line', () => {
			const hits = determinismGrepHits('../../common/domainHarnessKit.ts');
			assert.equal(hits.length > 0, true, 'the ban must be quoted in the law comments');
			for (const line of hits) {
				assert.match(line.trim(), /^\*/);
			}
		});
	});
});
