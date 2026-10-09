/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-009 -- the compound capability suite (mocha tdd). v4 (station gate-run corrections, round 2).
 *
 * Coverage: the three compounds over the REAL registry + REAL gate
 * over real node fs on per-test temp roots, with the injected fixed
 * clock (the registry suite's fixed-clock convention, expressed as
 * the landed Date.parse(issuedAtIso) idiom). Happy paths, the typed
 * intermediate-state refusals (the authorities' own refusals,
 * asserted verbatim where the bytes were pasted and differentially
 * -- re-running the failing authority op directly on a LOADED fresh
 * instance and comparing field by field -- everywhere else), the
 * partial-failure ledger disclosure, journal and gate-records byte
 * accounting (the compound writes nothing of its own), the
 * cross-instance laws (a live instance never sees another instance's
 * writes; a fresh one sees everything), the terminal-state laws,
 * gate-record survival after teardown, the register binding law (the
 * digest-scan branch AND the explicit entryId branch, both verbatim),
 * the machine-law partial-verification leg, and determinism by the
 * battery's own proven idiom (wipe the registry root and rerun on
 * the SAME root; cross-root byte-equality is NOT asserted because
 * the entryId derivation was never pasted). No wall-clock reads, no
 * random.
 *
 * v2 audit corrections (disclosed in REPORT.md section 6): (a) every
 * seed and differential now loads its instance first -- every
 * registry operation is gated on load() (E_NOT_LOADED); (b) the
 * determinism tests moved from cross-root to same-root wipe-rerun;
 * (c) the census was recounted and two byte-grounded tests added
 * (the torn gate-records construction refusal; the approved-only
 * teardown differential).
 *
 * v3 station gate-run corrections (REQUIRE-CHANGES round 1; 39
 * passing / 2 failing, both failures being test expectations vs the
 * REAL registry bytes -- the paste-protocol truth layer; the source
 * module compounds.ts was NOT implicated):
 * (1) compound.test.ts:339 -- the register binding law, both branches
 *     verbatim: the no-entryId digest-scan branch refuses
 *     E_REGISTER_REQUIRES_DISCOVERED (both detail variants); the
 *     explicit entryId branch refuses E_REGISTER_DIGEST_MISMATCH.
 *     [Stood at the 40/41 run; unchanged in v4.]
 * (2) compound.test.ts:575 -- expected the refusal at enable, actual
 *     at approve; re-derived as 'unavailable' with the approve
 *     refusal from a no-edge state. [RETRACTED by v4: the derivation
 *     was wrong -- see the v4 block.]
 *
 * v4 station gate-run correction (REQUIRE-CHANGES round 2; 40/41,
 * the one failure being the partial-verification leg at the :668
 * area). The station pasted the machine's own verify case VERBATIM:
 *
 *   if (status === "verified-partial") {
 *       return { ok: true, nextState: state, disclosure: disclosureFor("D_VERIFICATION_PARTIAL", { detail: "receipt recorded; the entry state is unchanged" }) };
 *   }
 *   if (status === "verification-failed") {
 *       return grant(state, op, "unavailable", { cause: "verification-failed" });
 *   }
 *
 * THE LAW: a 'verified-partial' receipt is ACCEPTED (ok:true,
 * journaled) and the entry state is UNCHANGED ('imported') with the
 * D_VERIFICATION_PARTIAL disclosure ("receipt recorded; the entry
 * state is unchanged"). ONLY 'verification-failed' lands
 * 'unavailable'. The approve continuation then refuses through the
 * machine from 'imported' (E_APPROVE_REQUIRES_VERIFIED -- verified
 * is required). The v4 leg pins exactly this: the receipt step ok at
 * 'imported' carrying the threaded disclosure (code
 * D_VERIFICATION_PARTIAL, detail verbatim); decide state-neutral at
 * 'imported'; failedOp 'approve', source 'registry', state
 * 'imported', code E_APPROVE_REQUIRES_VERIFIED; the differential
 * machine-refusal comparison; and the byte accounting (journal 3 --
 * the partial receipt IS journaled; gate records 2). Census stays
 * 41; the other 40 tests are byte-identical to v3.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lookupGrammar } from '../zcode-patterns/cli/common/grammar.ts';
import { deriveScope, realRegistryFsPort, registryRootFor } from './runtime/context.ts';
import { createRegistry } from '../capabilities/registry/registry.mjs';
import type { RegistryRuntime } from '../capabilities/registry/registry.mjs';
import { GATE_REFUSALS, loadGate } from '../capabilities/gate/gate.ts';
import {
	COMPOUND_FAMILIES,
	gateFlowCapability,
	onboardCapability,
	teardownCapability,
	type CompoundOptions,
	type CompoundRefusalView,
} from './runtime/compounds.ts';

const ISSUED_AT_ISO = '2025-06-01T00:00:00.000Z';
const CLOCK_MS = Date.parse(ISSUED_AT_ISO);

const DISCOVERY = {
	sourceKind: 'community-project',
	artifactKind: 'cli',
	version: '1.0.0',
	contentHash: 'a'.repeat(64),
	name: 'demo-capability',
};
const IMPORTED = {
	digest: 'a'.repeat(64),
	version: '1.0.0',
	license: 'MIT',
	permissions: ['read-files'],
	endpoints: ['https://example.com/demo'],
	platforms: ['linux-x64'],
	artifactKind: 'cli',
	provenance: { origin: 'community-project' },
};
/** Gate-strict receipts (CR-008 4.2): frozen status + non-empty { checkId, verdict } checks. */
const RECEIPT = { verificationStatus: 'verified', checks: [{ checkId: 'digest-match', verdict: 'match' }] };
const PARTIAL_RECEIPT = { verificationStatus: 'verified-partial', checks: [{ checkId: 'c-partial', verdict: 'pass' }] };
const FAILED_RECEIPT = { verificationStatus: 'verification-failed', checks: [{ checkId: 'digest-match', verdict: 'mismatch' }] };
const DECISION = { approver: 'operator-1', acknowledgedPermissions: ['read-files'] };

function opts(root: string, scope?: { workspaceId: string; tenantId: string }): CompoundOptions {
	return scope === undefined ? { root, issuedAtIso: ISSUED_AT_ISO } : { root, issuedAtIso: ISSUED_AT_ISO, scope };
}

async function freshRoot(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

function makeRegistry(root: string, scopeOverride?: { workspaceId: string; tenantId: string }): RegistryRuntime {
	return createRegistry({
		root: registryRootFor(root),
		clock: () => CLOCK_MS,
		fsPort: realRegistryFsPort(),
		scope: scopeOverride ?? deriveScope(root),
	});
}

/**
 * A LOADED registry instance (v2 fix A): every registry operation is
 * gated on load() -- an unloaded instance refuses E_NOT_LOADED, which
 * would poison every seed and differential below.
 */
async function loadedRegistry(root: string, scopeOverride?: { workspaceId: string; tenantId: string }): Promise<RegistryRuntime> {
	const registry = makeRegistry(root, scopeOverride);
	const loaded = await registry.load();
	if (!loaded.ok) {
		throw new Error('seed load refused: ' + String((loaded.refusal as { code?: unknown }).code));
	}
	return registry;
}

async function journalLinesOf(root: string): Promise<string[]> {
	try {
		const text = await readFile(join(registryRootFor(root), 'registry-journal.jsonl'), 'utf8');
		return text.split('\n').filter((line) => line.length > 0);
	} catch {
		return []; /* no journal yet: the honest empty ledger */
	}
}

async function gateRecordsTextOf(root: string): Promise<string> {
	try {
		return await readFile(join(registryRootFor(root), '.flauz', 'gate', 'records.jsonl'), 'utf8');
	} catch {
		return ''; /* no gate records yet: the honest empty ledger */
	}
}

async function journalTextOf(root: string): Promise<string> {
	try {
		return await readFile(join(registryRootFor(root), 'registry-journal.jsonl'), 'utf8');
	} catch {
		return '';
	}
}

/** Differential comparison: the compound's refusal vs the authority's own, field by field (zero transcription). */
function refusalFields(refusal: CompoundRefusalView): Record<string, unknown> {
	return { code: refusal.code, law: refusal.law, entryId: refusal.entryId, state: refusal.state, detail: refusal.detail };
}

function registryRefusalFields(refusal: unknown): Record<string, unknown> {
	const record = refusal as { code?: unknown; law?: unknown; entryId?: unknown; state?: unknown; detail?: unknown };
	return {
		code: record.code ?? null,
		law: record.law ?? null,
		entryId: record.entryId ?? null,
		state: record.state ?? null,
		detail: record.detail ?? null,
	};
}

async function seedDiscoveredAndRegistered(
	root: string,
	imported: Record<string, unknown> = IMPORTED,
	scope?: { workspaceId: string; tenantId: string },
): Promise<string> {
	const registry = await loadedRegistry(root, scope);
	const discovered = await registry.discover(DISCOVERY);
	if (!discovered.ok) {
		throw new Error('seed discover refused');
	}
	const registered = await registry.register(imported);
	if (!registered.ok) {
		throw new Error('seed register refused');
	}
	return registered.entryId;
}

async function seedEnabled(
	root: string,
	imported: Record<string, unknown> = IMPORTED,
	scope?: { workspaceId: string; tenantId: string },
): Promise<string> {
	const entryId = await seedDiscoveredAndRegistered(root, imported, scope);
	const registry = await loadedRegistry(root, scope);
	const verified = await registry.verify(entryId, RECEIPT);
	if (!verified.ok) {
		throw new Error('seed verify refused');
	}
	const approved = await registry.approve(entryId, {
		approver: 'operator-1',
		acknowledgedPermissions: (imported as { permissions?: string[] }).permissions ?? ['read-files'],
	});
	if (!approved.ok) {
		throw new Error('seed approve refused');
	}
	const enabled = await registry.enable(entryId);
	if (!enabled.ok) {
		throw new Error('seed enable refused');
	}
	return entryId;
}

async function seedApproved(root: string, imported: Record<string, unknown> = IMPORTED): Promise<string> {
	const entryId = await seedDiscoveredAndRegistered(root, imported);
	const registry = await loadedRegistry(root);
	const verified = await registry.verify(entryId, RECEIPT);
	if (!verified.ok) {
		throw new Error('seed verify refused');
	}
	const approved = await registry.approve(entryId, {
		approver: 'operator-1',
		acknowledgedPermissions: (imported as { permissions?: string[] }).permissions ?? ['read-files'],
	});
	if (!approved.ok) {
		throw new Error('seed approve refused');
	}
	return entryId;
}

/** The battery's own determinism idiom: wipe the registry root, re-create it, rerun (same root). */
async function wipeRegistryRoot(root: string): Promise<void> {
	await rm(registryRootFor(root), { recursive: true, force: true });
	await mkdir(registryRootFor(root), { recursive: true });
}

suite('flauz compounds: the onboarding compound', () => {
	test('the happy path walks discover -> register -> the gate tail to enabled, one entryId throughout', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-onboard-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		if (!result.ok) {
			throw new Error('onboard refused');
		}
		assert.equal(typeof result.entryId, 'string');
		assert.ok(result.entryId.length > 0);
		assert.equal(result.state, 'enabled');
		assert.deepEqual(
			result.steps.map((step) => step.op),
			['discover', 'register', 'submit-verification-receipt', 'decide-permissions', 'approve', 'enable'],
		);
		assert.deepEqual(
			result.steps.map((step) => step.authority),
			['registry', 'registry', 'gate', 'gate', 'gate', 'gate'],
		);
		assert.deepEqual(
			result.steps.map((step) => step.state),
			['discovered', 'imported', 'verified', 'verified', 'approved', 'enabled'],
		);
		for (const step of result.steps) {
			assert.equal(step.entryId, result.entryId);
		}
		assert.equal(result.warning, null);
		assert.equal(result.entry.state, 'enabled');
		assert.equal(result.entry.updatedAt, CLOCK_MS);
		assert.equal(result.policySummary.verification.status, 'verified');
		assert.equal(result.policySummary.approval?.approver, 'operator-1');
		assert.equal(result.policySummary.approval?.at, CLOCK_MS);
		assert.equal(result.policySummary.gateDecisions.length, 1);
	});

	test('an explicit scope journals under that scope (a mismatched-scope load refuses E_SNAPSHOT_MISMATCH)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-scope-');
		const result = await onboardCapability(
			opts(root, { workspaceId: 'ws-nine', tenantId: 'tenant-nine' }),
			DISCOVERY,
			IMPORTED,
			RECEIPT,
			DECISION,
		);
		assert.equal(result.ok, true);
		const mismatched = makeRegistry(root); /* deriveScope(root): the mkdtemp basename, not ws-nine */
		const loaded = await mismatched.load();
		assert.equal(loaded.ok, false);
		if (!loaded.ok) {
			assert.equal(loaded.refusal.code, 'E_SNAPSHOT_MISMATCH');
		}
	});

	test('byte accounting: the registry journal gains exactly 5 lines and the gate records exactly 2', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-accounting-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		assert.equal((await journalLinesOf(root)).length, 5); /* discover, register, verify, approve, enable */
		assert.equal((await gateRecordsTextOf(root)).split('\n').filter((line) => line.length > 0).length, 2); /* receipt + decision */
		/* The gate records live under the registry root's own .flauz tree (one root, one journal). */
		assert.ok((await gateRecordsTextOf(root)).length > 0);
	});

	test('every authority timestamp is the injected clock value, never the wall clock', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-clock-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		if (!result.ok) {
			throw new Error('onboard refused');
		}
		assert.equal(result.entry.updatedAt, CLOCK_MS);
		for (const transition of result.entry.transitions) {
			assert.equal(transition.at, CLOCK_MS);
		}
		for (const line of (await gateRecordsTextOf(root)).split('\n').filter((line) => line.length > 0)) {
			const record = JSON.parse(line) as { at?: unknown };
			assert.equal(record.at, CLOCK_MS);
		}
	});

	test('determinism (the battery idiom): wipe and rerun on the same root yields the identical outcome', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-det-');
		const first = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(first.ok, true);
		await wipeRegistryRoot(root);
		const second = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(second.ok, true);
		assert.deepEqual(second, first);
	});

	test('determinism (the battery idiom): the journal, snapshot, and gate-records bytes are identical after the wipe-rerun', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-detf-');
		const first = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(first.ok, true);
		const journalBefore = await journalTextOf(root);
		const snapshotBefore = await readFile(join(registryRootFor(root), 'registry-state.json'), 'utf8');
		const recordsBefore = await gateRecordsTextOf(root);
		await wipeRegistryRoot(root);
		const second = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(second.ok, true);
		assert.equal(await journalTextOf(root), journalBefore);
		assert.equal(await readFile(join(registryRootFor(root), 'registry-state.json'), 'utf8'), snapshotBefore);
		assert.equal(await gateRecordsTextOf(root), recordsBefore);
	});

	test('the register binding law, both branches verbatim: the digest scan refuses E_REGISTER_REQUIRES_DISCOVERED; the explicit entryId path refuses E_REGISTER_DIGEST_MISMATCH', async function () {
		this.timeout(30000);
		/* Branch one (the scan path -- no entryId): register scans for a DISCOVERED
		 * entry whose contentHash === imported.digest (R27 verbatim); a digest that
		 * matches no entry at all refuses E_REGISTER_REQUIRES_DISCOVERED with the
		 * no-discovered-entry detail. */
		const rootOne = await freshRoot('flauz-compound-digest-');
		const resultOne = await onboardCapability(opts(rootOne), DISCOVERY, { ...IMPORTED, digest: 'b'.repeat(64) }, RECEIPT, DECISION);
		assert.equal(resultOne.ok, false);
		if (!resultOne.ok) {
			assert.equal(resultOne.refusal.code, 'E_REGISTER_REQUIRES_DISCOVERED');
			assert.equal(resultOne.refusal.source, 'registry');
			assert.equal(resultOne.refusal.failedOp, 'register');
			assert.equal(resultOne.refusal.entryId, null);
			assert.equal(resultOne.refusal.state, null);
			assert.equal(resultOne.refusal.detail, 'no discovered entry with content hash ' + 'b'.repeat(64));
			assert.equal(resultOne.refusal.completedSteps.length, 1);
			assert.equal(resultOne.refusal.completedSteps[0]?.op, 'discover');
		}
		assert.equal((await journalLinesOf(rootOne)).length, 1); /* the compound's discover only */
		assert.equal(await gateRecordsTextOf(rootOne), ''); /* the gate is never constructed */

		/* Branch one, existing-entry variant: an entry with the digest exists but is
		 * NOT discovered (pre-seeded through the registry's own API to imported),
		 * so the scan still fails and the refusal names that entry and its state
		 * (R27 verbatim). */
		const rootTwo = await freshRoot('flauz-compound-digest2-');
		const seedRegistry = await loadedRegistry(rootTwo);
		const seededDiscover = await seedRegistry.discover({ ...DISCOVERY, contentHash: 'b'.repeat(64) });
		if (!seededDiscover.ok) {
			throw new Error('seed discover refused');
		}
		const seededRegister = await seedRegistry.register({ ...IMPORTED, digest: 'b'.repeat(64) });
		if (!seededRegister.ok) {
			throw new Error('seed register refused');
		}
		const resultTwo = await onboardCapability(opts(rootTwo), DISCOVERY, { ...IMPORTED, digest: 'b'.repeat(64) }, RECEIPT, DECISION);
		assert.equal(resultTwo.ok, false);
		if (!resultTwo.ok) {
			assert.equal(resultTwo.refusal.code, 'E_REGISTER_REQUIRES_DISCOVERED');
			assert.equal(resultTwo.refusal.source, 'registry');
			assert.equal(resultTwo.refusal.failedOp, 'register');
			assert.equal(resultTwo.refusal.entryId, null);
			assert.equal(resultTwo.refusal.state, null);
			assert.equal(
				resultTwo.refusal.detail,
				'entry ' + seededRegister.entryId + ' with content hash ' + 'b'.repeat(64) + ' is in state imported',
			);
			assert.equal(resultTwo.refusal.completedSteps.length, 1);
			assert.equal(resultTwo.refusal.completedSteps[0]?.op, 'discover');
		}
		assert.equal((await journalLinesOf(rootTwo)).length, 3); /* seed discover + seed register + the compound's discover */
		assert.equal(await gateRecordsTextOf(rootTwo), '');

		/* Branch two (the explicit entryId path): when imported.entryId references
		 * a known entry, register binds BY ID and the contentHash/digest comparison
		 * refuses E_REGISTER_DIGEST_MISMATCH carrying the entry's own id and state
		 * (R27 verbatim). */
		const rootThree = await freshRoot('flauz-compound-digest3-');
		const seedRegistryThree = await loadedRegistry(rootThree);
		const seededDiscoverThree = await seedRegistryThree.discover({ ...DISCOVERY, contentHash: 'd'.repeat(64) });
		if (!seededDiscoverThree.ok) {
			throw new Error('seed discover refused');
		}
		const resultThree = await onboardCapability(
			opts(rootThree),
			DISCOVERY,
			{ ...IMPORTED, entryId: seededDiscoverThree.entryId, digest: 'b'.repeat(64) },
			RECEIPT,
			DECISION,
		);
		assert.equal(resultThree.ok, false);
		if (!resultThree.ok) {
			assert.equal(resultThree.refusal.code, 'E_REGISTER_DIGEST_MISMATCH');
			assert.equal(resultThree.refusal.source, 'registry');
			assert.equal(resultThree.refusal.failedOp, 'register');
			assert.equal(resultThree.refusal.entryId, seededDiscoverThree.entryId);
			assert.equal(resultThree.refusal.state, 'discovered');
			assert.equal(
				resultThree.refusal.detail,
				'the discovered content hash ' + 'd'.repeat(64) + ' does not match the imported digest ' + 'b'.repeat(64),
			);
			assert.equal(resultThree.refusal.completedSteps.length, 1);
			assert.equal(resultThree.refusal.completedSteps[0]?.op, 'discover');
			/* The binding went to the SEEDED entry, not the compound's own discovery. */
			assert.notEqual(resultThree.refusal.completedSteps[0]?.entryId, resultThree.refusal.entryId);
		}
		assert.equal((await journalLinesOf(rootThree)).length, 2); /* seed discover + the compound's discover */
		assert.equal(await gateRecordsTextOf(rootThree), '');
	});

	test('an empty checks array is the gate-strict E_RECEIPT_MALFORMED refusal with the pasted detail', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-receipt-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, { verificationStatus: 'verified', checks: [] }, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_RECEIPT_MALFORMED');
			assert.equal(result.refusal.source, 'gate');
			assert.equal(result.refusal.failedOp, 'submit-verification-receipt');
			assert.equal(result.refusal.detail, 'receipt.checks must not be empty');
			assert.equal(result.refusal.completedSteps.length, 2);
		}
	});

	test('a missing checks array is the gate-strict refusal with the pasted detail', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-receipt2-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, { verificationStatus: 'verified' }, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_RECEIPT_MALFORMED');
			assert.equal(result.refusal.failedOp, 'submit-verification-receipt');
			assert.equal(
				result.refusal.detail,
				'receipt.checks must be a non-empty array of { checkId, verdict } checks (CR-008 4.2 gate strictness: the checks array is required)',
			);
		}
	});

	test('an unacknowledged high-risk permission is E_HIGH_RISK_UNACKNOWLEDGED with the gate law verbatim', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-highrisk-');
		const highRiskImport = { ...IMPORTED, permissions: ['read-files', 'execute-command'] };
		const highRiskDecision = { approver: 'operator-1', acknowledgedPermissions: ['read-files', 'execute-command'] };
		const result = await onboardCapability(opts(root), DISCOVERY, highRiskImport, RECEIPT, highRiskDecision);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_HIGH_RISK_UNACKNOWLEDGED');
			assert.equal(result.refusal.law, GATE_REFUSALS.E_HIGH_RISK_UNACKNOWLEDGED.law);
			assert.equal(
				result.refusal.detail,
				'declared high-risk permissions [execute-command] require riskAcknowledged: true in the permission decision',
			);
			assert.equal(result.refusal.source, 'gate');
			assert.equal(result.refusal.failedOp, 'decide-permissions');
			assert.equal(result.refusal.completedSteps.length, 3);
			assert.equal(result.refusal.completedSteps[2]?.state, 'verified');
		}
	});

	test('an acknowledgement mismatch is E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH with the pasted detail format', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-ack-');
		const twoPermissionImport = { ...IMPORTED, permissions: ['read-files', 'write-workspace'] };
		const offDecision = { approver: 'operator-1', acknowledgedPermissions: ['read-files', 'network-access'] };
		const result = await onboardCapability(opts(root), DISCOVERY, twoPermissionImport, RECEIPT, offDecision);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_APPROVAL_ACKNOWLEDGEMENT_MISMATCH');
			assert.equal(result.refusal.failedOp, 'decide-permissions');
			assert.equal(
				result.refusal.detail,
				'unacknowledged declared permissions: [write-workspace]; acknowledged undeclared permissions: [network-access]',
			);
		}
	});

	test('a malformed decision (empty approver) is E_APPROVAL_MALFORMED with the pasted detail', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-approver-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, { approver: '', acknowledgedPermissions: ['read-files'] });
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_APPROVAL_MALFORMED');
			assert.equal(result.refusal.failedOp, 'decide-permissions');
			assert.equal(result.refusal.detail, 'decision.approver must be a non-empty string');
		}
	});

	test('the verification-failed leg: verify lands unavailable, the machine refuses the continuation, and the compound discloses both', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-failed-');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, FAILED_RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			/* The honest intermediate-state disclosure: the receipt step landed the dual edge. */
			assert.equal(result.refusal.completedSteps[2]?.op, 'submit-verification-receipt');
			assert.equal(result.refusal.completedSteps[2]?.state, 'unavailable');
			assert.equal(result.refusal.completedSteps[3]?.op, 'decide-permissions');
			assert.equal(result.refusal.completedSteps[3]?.state, 'unavailable');
			/* The machine is the sole continuation arbiter: approve refuses through the machine, verbatim. */
			assert.equal(result.refusal.failedOp, 'approve');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.state, 'unavailable');
			if (result.refusal.entryId === null) {
				throw new Error('the machine refusal must carry the entryId');
			}
			/* Differential: re-run the failing authority op on a LOADED fresh instance and compare. */
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.approve(result.refusal.entryId, {
				approver: 'operator-1',
				acknowledgedPermissions: ['read-files'],
			});
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(result.refusal), registryRefusalFields(direct.refusal));
			}
		}
	});

	test('a torn journal refuses at load with E_JOURNAL_TORN before any step runs', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-torn-');
		await mkdir(registryRootFor(root), { recursive: true });
		await writeFile(join(registryRootFor(root), 'registry-journal.jsonl'), 'not-json\n', 'utf8');
		const result = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_JOURNAL_TORN');
			assert.equal(result.refusal.failedOp, 'load');
			assert.equal(result.refusal.completedSteps.length, 0);
		}
	});

	test('factory misuse throws TypeError (the createRegistry/createGate doctrine)', async function () {
		this.timeout(30000);
		await assert.rejects(
			onboardCapability({} as unknown as CompoundOptions, DISCOVERY, IMPORTED, RECEIPT, DECISION),
			TypeError,
		);
		await assert.rejects(
			onboardCapability({ root: '', issuedAtIso: ISSUED_AT_ISO } as unknown as CompoundOptions, DISCOVERY, IMPORTED, RECEIPT, DECISION),
			TypeError,
		);
		await assert.rejects(
			onboardCapability({ root: 'x', issuedAtIso: '' } as unknown as CompoundOptions, DISCOVERY, IMPORTED, RECEIPT, DECISION),
			TypeError,
		);
		await assert.rejects(
			onboardCapability({ root: 'x', issuedAtIso: ISSUED_AT_ISO, scope: 'junk' } as unknown as CompoundOptions, DISCOVERY, IMPORTED, RECEIPT, DECISION),
			TypeError,
		);
	});

	test('a second onboarding over a root with an existing entry binds to the NEW discovered entry', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-multi-');
		const first = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(first.ok, true);
		const secondDiscovery = { ...DISCOVERY, contentHash: 'c'.repeat(64) };
		const secondImport = { ...IMPORTED, digest: 'c'.repeat(64) };
		const second = await onboardCapability(opts(root), secondDiscovery, secondImport, RECEIPT, DECISION);
		assert.equal(second.ok, true);
		if (first.ok && second.ok) {
			assert.notEqual(first.entryId, second.entryId);
			const registry = await loadedRegistry(root);
			const queried = await registry.query({});
			assert.equal(queried.ok, true);
			if (queried.ok) {
				assert.equal(queried.count, 2);
			}
		}
	});
});

suite('flauz compounds: the gate-flow compound', () => {
	test('the gate tail over a pre-seeded imported entry walks to enabled with the decision recorded', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-gateflow-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		if (!result.ok) {
			throw new Error('gate flow refused');
		}
		assert.equal(result.state, 'enabled');
		assert.equal(result.warning, null);
		assert.deepEqual(
			result.steps.map((step) => step.op),
			['submit-verification-receipt', 'decide-permissions', 'approve', 'enable'],
		);
		assert.deepEqual(
			result.steps.map((step) => step.state),
			['verified', 'verified', 'approved', 'enabled'],
		);
		assert.equal(result.policySummary.gateDecisions.length, 1);
		assert.equal(result.policySummary.gateDecisions[0]?.approver, 'operator-1');
		assert.equal(result.policySummary.gateDecisions[0]?.riskAcknowledged, false);
		assert.equal(result.policySummary.approval?.approver, 'operator-1');
		assert.equal(result.entry.state, 'enabled');
	});

	test('the decision is evidence, not lifecycle: it writes no registry line (journal 2 -> 5, gate records 2)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-decide-');
		const entryId = await seedDiscoveredAndRegistered(root);
		assert.equal((await journalLinesOf(root)).length, 2);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		assert.equal((await journalLinesOf(root)).length, 5); /* verify, approve, enable -- decide writes none */
		assert.equal((await gateRecordsTextOf(root)).split('\n').filter((line) => line.length > 0).length, 2);
	});

	test('the partial-verification leg (the real machine law): a verified-partial receipt is accepted with the state unchanged, and the machine refuses the approve continuation (E_APPROVE_REQUIRES_VERIFIED)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-partial-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const result = await gateFlowCapability(opts(root), entryId, PARTIAL_RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			/* THE MACHINE LAW (state.mjs, station-pasted VERBATIM): a 'verified-partial'
			 * receipt is ACCEPTED (ok:true, journaled) and the entry state is UNCHANGED
			 * ('imported') with the D_VERIFICATION_PARTIAL disclosure; ONLY
			 * 'verification-failed' lands 'unavailable'. */
			assert.equal(result.refusal.completedSteps.length, 2);
			/* The receipt step: ok, journaled, state UNCHANGED at 'imported'. */
			assert.equal(result.refusal.completedSteps[0]?.op, 'submit-verification-receipt');
			assert.equal(result.refusal.completedSteps[0]?.state, 'imported');
			/* The compound threads disclosures: the D_VERIFICATION_PARTIAL disclosure
			 * rides the step (code + the verbatim detail; the note is the registry's,
			 * never pasted -- not asserted). */
			assert.notEqual(result.refusal.completedSteps[0]?.disclosure, null);
			assert.equal(result.refusal.completedSteps[0]?.disclosure?.code, 'D_VERIFICATION_PARTIAL');
			assert.equal(
				result.refusal.completedSteps[0]?.disclosure?.detail,
				'receipt recorded; the entry state is unchanged',
			);
			/* decidePermissions is state-neutral evidence: ok, still 'imported'. */
			assert.equal(result.refusal.completedSteps[1]?.op, 'decide-permissions');
			assert.equal(result.refusal.completedSteps[1]?.state, 'imported');
			/* The machine is the sole continuation arbiter: approve requires
			 * 'verified', and the entry is still 'imported'. */
			assert.equal(result.refusal.failedOp, 'approve');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.state, 'imported');
			assert.equal(result.refusal.code, 'E_APPROVE_REQUIRES_VERIFIED');
			if (result.refusal.entryId === null) {
				throw new Error('the machine refusal must carry the entryId');
			}
			/* Differential: the machine refusal passes through verbatim (zero
			 * transcription of any unpasted field text). */
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.approve(result.refusal.entryId, {
				approver: 'operator-1',
				acknowledgedPermissions: ['read-files'],
			});
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(result.refusal), registryRefusalFields(direct.refusal));
			}
		}
		/* Byte accounting: the accepted partial receipt IS journaled (journal 3:
		 * discover, register, verify) and the decision evidence is recorded (gate
		 * records 2); the refused approve wrote nothing. */
		assert.equal((await journalLinesOf(root)).length, 3);
		assert.equal((await gateRecordsTextOf(root)).split('\n').filter((line) => line.length > 0).length, 2);
	});

	test('a high-risk permission with riskAcknowledged: true onboards through the gate law', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-hr-ok-');
		const netImport = { ...IMPORTED, permissions: ['network-access'] };
		const entryId = await seedDiscoveredAndRegistered(root, netImport);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, {
			approver: 'operator-1',
			acknowledgedPermissions: ['network-access'],
			riskAcknowledged: true,
		});
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.state, 'enabled');
			assert.deepEqual(result.policySummary.highRiskPermissions, ['network-access']);
			assert.deepEqual(result.policySummary.declaredPermissions, [{ id: 'network-access', riskTier: 'high' }]);
		}
	});

	test('the gate records carry the pasted record shapes (receipt then decision)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-records-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		const lines = (await gateRecordsTextOf(root)).split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Record<string, unknown>);
		assert.equal(lines.length, 2);
		assert.equal(lines[0]?.['kind'], 'receipt');
		assert.equal(lines[0]?.['entryId'], entryId);
		assert.equal(lines[0]?.['seq'], 1);
		assert.equal(lines[0]?.['contractVersion'], 'cr-008.1');
		assert.equal(lines[1]?.['kind'], 'decision');
		assert.equal(lines[1]?.['seq'], 2);
		const data = lines[1]?.['data'] as Record<string, unknown>;
		assert.equal(data['approver'], 'operator-1');
		assert.deepEqual(data['acknowledgedPermissions'], ['read-files']);
		assert.equal(data['riskAcknowledged'], false);
		assert.deepEqual(data['declaredPermissions'], ['read-files']);
		assert.deepEqual(data['highRiskPermissions'], []);
		const scope = lines[1]?.['scope'] as Record<string, unknown>;
		assert.equal(scope['workspaceId'], deriveScope(root).workspaceId);
	});

	test('an unknown entry refuses E_ENTRY_UNKNOWN at the receipt step (source registry)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-unknown-');
		const result = await gateFlowCapability(opts(root), 'entry-nope', RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_ENTRY_UNKNOWN');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.failedOp, 'submit-verification-receipt');
			assert.equal(result.refusal.completedSteps.length, 0);
		}
	});

	test('an already-verified entry refuses the second receipt through the machine (differential)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-reverify-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const registry = await loadedRegistry(root);
		const verified = await registry.verify(entryId, RECEIPT);
		if (!verified.ok) {
			throw new Error('seed verify refused');
		}
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.failedOp, 'submit-verification-receipt');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.state, 'verified');
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.verify(entryId, RECEIPT);
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(result.refusal), registryRefusalFields(direct.refusal));
			}
		}
	});

	test('a torn gate-records file refuses at gate construction with the pasted detail (source gate)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-torngate-');
		const entryId = await seedDiscoveredAndRegistered(root);
		await mkdir(join(registryRootFor(root), '.flauz', 'gate'), { recursive: true });
		await writeFile(join(registryRootFor(root), '.flauz', 'gate', 'records.jsonl'), 'not-json\n', 'utf8');
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_JOURNAL_TORN');
			assert.equal(result.refusal.source, 'gate');
			assert.equal(result.refusal.failedOp, 'gate-construction');
			assert.equal(result.refusal.detail, 'gate records line 1 is not valid JSON');
			assert.equal(result.refusal.completedSteps.length, 0);
		}
	});

	test('the documented restart seam: loadGate replays the decisions and warnings', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-restart-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		const restarted = await loadGate(registryRootFor(root), {
			clock: () => CLOCK_MS,
			fsPort: realRegistryFsPort(),
			scope: deriveScope(root),
		});
		const summary = await restarted.gatePolicySummary(entryId);
		assert.equal(summary.state, 'enabled');
		assert.equal(summary.gateDecisions.length, 1);
		assert.equal(summary.gateDecisions[0]?.approver, 'operator-1');
		assert.equal(summary.verification.receiptCount, 1);
	});

	test('determinism (the battery idiom): wipe, reseed, and rerun yield identical gate-flow outcomes and record bytes', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-gfdet-');
		const entryOne = await seedDiscoveredAndRegistered(root);
		const first = await gateFlowCapability(opts(root), entryOne, RECEIPT, DECISION);
		assert.equal(first.ok, true);
		const journalBefore = await journalTextOf(root);
		const recordsBefore = await gateRecordsTextOf(root);
		await wipeRegistryRoot(root);
		const entryTwo = await seedDiscoveredAndRegistered(root);
		const second = await gateFlowCapability(opts(root), entryTwo, RECEIPT, DECISION);
		assert.equal(second.ok, true);
		assert.deepEqual(second, first);
		assert.equal(await journalTextOf(root), journalBefore);
		assert.equal(await gateRecordsTextOf(root), recordsBefore);
	});

	test('factory misuse throws TypeError for the gate flow too', async function () {
		await assert.rejects(
			gateFlowCapability({} as unknown as CompoundOptions, 'x', RECEIPT, DECISION),
			TypeError,
		);
	});
});

suite('flauz compounds: the teardown compound', () => {
	test('teardown walks disable -> remove to revoked with the revocation record disclosed', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-teardown-');
		const entryId = await seedEnabled(root);
		const result = await teardownCapability(opts(root), entryId, 'decommissioned');
		assert.equal(result.ok, true);
		if (!result.ok) {
			throw new Error('teardown refused');
		}
		assert.equal(result.state, 'revoked');
		assert.deepEqual(
			result.steps.map((step) => [step.op, step.state]),
			[['disable', 'unavailable'], ['remove', 'revoked']],
		);
		assert.equal(result.entry.state, 'revoked');
		assert.equal(result.entry.revocation?.reason, 'decommissioned');
		assert.equal(result.entry.revocation?.at, CLOCK_MS);
		const transitions = result.entry.transitions;
		assert.equal(transitions[transitions.length - 1]?.op, 'remove');
		assert.equal(transitions[transitions.length - 1]?.toState, 'revoked');
	});

	test('teardown without a reason revokes with a null reason (the registry\'s own law)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-teardown2-');
		const entryId = await seedEnabled(root);
		const result = await teardownCapability(opts(root), entryId);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.entry.revocation?.reason, null);
			assert.equal(result.entry.revocation?.at, CLOCK_MS);
		}
	});

	test('byte accounting: teardown adds exactly 2 journal lines and no gate records', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-teardown3-');
		const entryId = await seedEnabled(root);
		assert.equal((await journalLinesOf(root)).length, 5);
		const result = await teardownCapability(opts(root), entryId, 'done');
		assert.equal(result.ok, true);
		assert.equal((await journalLinesOf(root)).length, 7); /* disable + remove */
		assert.equal(await gateRecordsTextOf(root), '');
	});

	test('teardown of a discovered-only entry refuses through the machine (differential)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-disc-');
		const registry = await loadedRegistry(root);
		const discovered = await registry.discover(DISCOVERY);
		if (!discovered.ok) {
			throw new Error('discover refused');
		}
		const result = await teardownCapability(opts(root), discovered.entryId);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.failedOp, 'disable');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.state, 'discovered');
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.disable(discovered.entryId);
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(result.refusal), registryRefusalFields(direct.refusal));
			}
		}
	});

	test('teardown of an approved-only entry refuses at disable through the machine (differential; disable is granted only from enabled/available)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-approved-');
		const entryId = await seedApproved(root);
		const result = await teardownCapability(opts(root), entryId);
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.failedOp, 'disable');
			assert.equal(result.refusal.source, 'registry');
			assert.equal(result.refusal.state, 'approved');
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.disable(entryId);
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(result.refusal), registryRefusalFields(direct.refusal));
			}
		}
	});

	test('a second teardown refuses through the machine from the terminal state (differential)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-term-');
		const entryId = await seedEnabled(root);
		const first = await teardownCapability(opts(root), entryId);
		assert.equal(first.ok, true);
		const second = await teardownCapability(opts(root), entryId);
		assert.equal(second.ok, false);
		if (!second.ok) {
			assert.equal(second.refusal.failedOp, 'disable');
			assert.equal(second.refusal.state, 'revoked');
			const directRegistry = await loadedRegistry(root);
			const direct = await directRegistry.disable(entryId);
			assert.equal(direct.ok, false);
			if (!direct.ok) {
				assert.deepEqual(refusalFields(second.refusal), registryRefusalFields(direct.refusal));
			}
		}
	});

	test('an empty reason is E_ARGUMENT_MALFORMED with the pasted verbatim detail', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-reason-');
		const entryId = await seedEnabled(root);
		const result = await teardownCapability(opts(root), entryId, '');
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_ARGUMENT_MALFORMED');
			assert.equal(result.refusal.failedOp, 'disable');
			assert.equal(result.refusal.detail, 'the disable reason must be a non-empty string when present');
		}
	});

	test('an unknown entry refuses E_ENTRY_UNKNOWN with the pasted verbatim detail', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-unknown-');
		const result = await teardownCapability(opts(root), 'entry-nope');
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.refusal.code, 'E_ENTRY_UNKNOWN');
			assert.equal(result.refusal.failedOp, 'disable');
			assert.equal(result.refusal.entryId, 'entry-nope');
			assert.equal(result.refusal.detail, 'disable: unknown entry');
		}
	});

	test('gate records survive teardown: loadGate constructs over the revoked entry (no E_JOURNAL_UNLAWFUL)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-td-gate-');
		const onboarded = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(onboarded.ok, true);
		const entryId = onboarded.ok ? onboarded.entryId : '';
		const result = await teardownCapability(opts(root), entryId);
		assert.equal(result.ok, true);
		const gate = await loadGate(registryRootFor(root), {
			clock: () => CLOCK_MS,
			fsPort: realRegistryFsPort(),
			scope: deriveScope(root),
		});
		const summary = await gate.gatePolicySummary(entryId);
		assert.equal(summary.state, 'revoked');
	});

	test('determinism (the battery idiom): onboard + teardown, wiped and rerun, yields identical outcomes and journal bytes', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-tddet-');
		const firstOnboard = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(firstOnboard.ok, true);
		const first = await teardownCapability(opts(root), firstOnboard.ok ? firstOnboard.entryId : '', 'retired');
		assert.equal(first.ok, true);
		const journalBefore = await journalTextOf(root);
		await wipeRegistryRoot(root);
		const secondOnboard = await onboardCapability(opts(root), DISCOVERY, IMPORTED, RECEIPT, DECISION);
		assert.equal(secondOnboard.ok, true);
		const second = await teardownCapability(opts(root), secondOnboard.ok ? secondOnboard.entryId : '', 'retired');
		assert.equal(second.ok, true);
		assert.deepEqual(second, first);
		assert.equal(await journalTextOf(root), journalBefore);
	});
});

suite('flauz compounds: the cross-instance and census laws', () => {
	test('a live instance never sees the gate\'s writes; a fresh instance sees everything (the station-ruled law)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-q7-');
		const live = await loadedRegistry(root);
		const discovered = await live.discover(DISCOVERY);
		if (!discovered.ok) {
			throw new Error('discover refused');
		}
		const registered = await live.register(IMPORTED);
		if (!registered.ok) {
			throw new Error('register refused');
		}
		const entryId = registered.entryId;
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		const blind = await live.query({ state: 'enabled' });
		assert.equal(blind.ok, true);
		if (blind.ok) {
			assert.equal(blind.count, 0); /* the live instance's map is stale by law */
		}
		const staleView = await live.inspect(entryId);
		assert.equal(staleView.ok, true);
		if (staleView.ok) {
			assert.equal(staleView.entry.state, 'imported');
		}
		const fresh = await loadedRegistry(root);
		const seen = await fresh.query({ state: 'enabled' });
		assert.equal(seen.ok, true);
		if (seen.ok) {
			assert.equal(seen.count, 1);
		}
		const freshView = await fresh.inspect(entryId);
		assert.equal(freshView.ok, true);
		if (freshView.ok) {
			assert.equal(freshView.entry.state, 'enabled');
		}
	});

	test('the compound\'s final disclosure is the journal truth (identical to a fresh instance\'s view)', async function () {
		this.timeout(30000);
		const root = await freshRoot('flauz-compound-truth-');
		const entryId = await seedDiscoveredAndRegistered(root);
		const result = await gateFlowCapability(opts(root), entryId, RECEIPT, DECISION);
		assert.equal(result.ok, true);
		const fresh = await loadedRegistry(root);
		const freshView = await fresh.inspect(entryId);
		assert.equal(freshView.ok, true);
		if (result.ok && freshView.ok) {
			assert.deepEqual(result.entry, freshView.entry);
			assert.equal(result.policySummary.state, freshView.entry.state);
		}
	});

	test('the compound census pins the three families', () => {
		assert.equal(COMPOUND_FAMILIES.length, 3);
		assert.deepEqual([...COMPOUND_FAMILIES], ['onboard', 'gate-flow', 'teardown']);
	});

	test('the grammar ruling FINAL NO: no compound path exists in the frozen CLI grammar', () => {
		assert.equal(lookupGrammar('capability.onboard'), undefined);
		assert.equal(lookupGrammar('capability.gate-flow'), undefined);
		assert.equal(lookupGrammar('capability.teardown'), undefined);
	});
});
