/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * P2-FIX-103 acceptance suite: `LeaseConflictFacts` carries the runtime `code`
 * field (the declaration-drift fix).
 *
 * THE CONTRACT (docs/FLAUZ-PROGRAM/findings/P2-FIX-103-leaseconflict-declaration-drift.md):
 * the runtime `leaseConflictFacts()` (core/leaseConflict.mjs) returns
 * `{ code, resource, violation, holder, leaseId, deadline, claimant }`, and the
 * hand-written sibling declaration (core/leaseConflict.d.mts) must type that
 * projection WITH the `code` field. The finding's acceptance test: a consumer
 * compiled under the DEFAULT config (`extensions/flauz-agent/tsconfig.json`,
 * which includes every `test/` .ts source; receipt: `tsc --noEmit`) can assert
 * `leaseConflictFacts(err)?.code === LEASE_CONFLICT_CODE` WITHOUT a structural
 * cast. Pre-fix, the `facts?.code` property accesses below are exactly the
 * TS2339 repro (`Property 'code' does not exist on type 'LeaseConflictFacts'`);
 * post-fix this whole file compiles green under the same default config.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	LEASE_CONFLICT_CODE,
	LeaseConflictError,
	evaluateLeaseClaim,
	isLeaseConflictError,
	leaseConflictFacts,
} from '../core/leaseConflict.mjs';

const RESOURCE = 'flauz-orch/G-001/S-01';
const HOLDER = 'agent-a';
const LEASE_ID = 'L-001-01-1';
const DEADLINE = 1_700_000_060_000;

/**
 * A refused claim's typed error, built through the decision table (no
 * hand-written facts literal: the refusal facts come from
 * `evaluateLeaseClaim`, whose conflict branch is the code-carrying shape
 * `LeaseConflictFacts & { code: 'flauz.a2a.lease-conflict' }`).
 */
function refusedClaimError(): LeaseConflictError {
	const verdict = evaluateLeaseClaim({ active: { holder: HOLDER, leaseId: LEASE_ID, deadline: DEADLINE }, claimant: 'agent-b', now: 1_700_000_000_000, resource: RESOURCE });
	if (verdict.ok !== false) {
		throw new Error('the fixture verdict must be a refusal (a live foreign lease)');
	}
	return new LeaseConflictError(verdict.conflict);
}

test('P2-FIX-103 acceptance: a default-config-compiled consumer asserts the conflict code without a cast', () => {
	const error = refusedClaimError();
	// THE ACCEPTANCE ASSERTION (the finding's acceptance test, no structural
	// cast anywhere): `facts?.code` is a typed property access on the declared
	// projection. Pre-fix this is the TS2339; post-fix it compiles and holds.
	assert.ok(leaseConflictFacts(error)?.code === LEASE_CONFLICT_CODE, 'leaseConflictFacts(err)?.code === LEASE_CONFLICT_CODE (no cast)');
	// the code field is the closed identity, not an open string
	assert.equal(leaseConflictFacts(error)?.code, LEASE_CONFLICT_CODE);
	// the full facts projection: the declaration's shape IS the runtime's shape
	assert.deepEqual(leaseConflictFacts(error), { code: LEASE_CONFLICT_CODE, resource: RESOURCE, violation: 'lease', holder: HOLDER, leaseId: LEASE_ID, deadline: DEADLINE, claimant: 'agent-b' });
});

test('P2-FIX-103 regression guard: the decision table\'s refusal facts carry the code (LeaseClaimEvaluation)', () => {
	const verdict = evaluateLeaseClaim({ active: { holder: HOLDER, leaseId: LEASE_ID, deadline: DEADLINE }, claimant: 'agent-b', now: 1_700_000_000_000, resource: RESOURCE });
	assert.equal(verdict.ok, false, 'a live foreign lease refuses the claim');
	if (verdict.ok !== false) {
		return;
	}
	// the refusal branch's own typed carrier: the conflict carries the code
	assert.ok(verdict.conflict.code === LEASE_CONFLICT_CODE, 'evaluateLeaseClaim\'s refusal facts carry the code');
	// and the typed error built from those refusal facts agrees on every axis
	const error = new LeaseConflictError(verdict.conflict);
	assert.ok(isLeaseConflictError(error));
	assert.equal(error.conflictCode, LEASE_CONFLICT_CODE, 'the error\'s own conflict identity matches the facts\' code');
	assert.ok(leaseConflictFacts(error)?.code === LEASE_CONFLICT_CODE, 'the error projects the same code (no cast)');
});

test('P2-FIX-103 regression guard: a non-conflict projects null (the acceptance expression\'s ?. path)', () => {
	// the facts projection is null for a plain error: the `?.` short-circuits
	assert.equal(leaseConflictFacts(new Error('not a conflict')), null);
	assert.equal(leaseConflictFacts(undefined), null);
	// so the acceptance expression is honestly false, never an accidental truthy
	assert.notEqual(leaseConflictFacts(new Error('not a conflict'))?.code, LEASE_CONFLICT_CODE);
});
