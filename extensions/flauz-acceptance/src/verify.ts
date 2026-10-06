/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The post-release-acceptance law (A-PROD-006-W2, DL-87). UNVERIFIED-BY-ME:
 * authored against the unblock-packet surfaces; the station runs the battery.
 *
 * flauz.acceptance.verify re-runs the named owning checks against the
 * released state and banks the closing receipt -- pass or FAIL, both typed,
 * both banked. A FAILED receipt is the typed failure record the incidents
 * reopen law consumes (a closed loop never hides a regression).
 *
 * THE HONEST-SCOPE LAW: the receipt's evidence label comes from the frozen
 * ladder and is never promoted by wording; a check this plane cannot itself
 * evaluate is a TYPED DISCLOSURE row naming its owning surface, never a
 * silent green. The evaluable rows re-verify over REAL workspace state and
 * carry the 'local-real' label; a disclosure row carries the lowest ladder
 * rung ('fixture') with an explicit detail that the plane observed nothing
 * itself -- the label is never promoted by wording.
 */

import {
	type AcceptanceFsPort,
	type Clock,
	type ReceiptRow,
	type VerificationReceipt,
	AcceptanceError,
	isAcceptanceId,
	isPlainObject,
	readAcceptanceRecord,
	readChecklistArtifact,
	readLoopJournalPin,
	receiptIdFromContent,
	canonicalJson,
	sha256Hex,
} from './api.ts';
import {
	ACCEPTANCE_SCHEMA_ID,
	BOUNDARY_DISCLOSURE,
	EXTENSION_ID,
	PRIVACY_LAW,
} from './globals.ts';
import { toIsoStamp } from './format.ts';
import { readCensusPin, readProductStatePin } from './acceptance.ts';
import { persistReceipt, type PersistedReceipt } from './ledger.ts';

// ---------------------------------------------------------------------------
// The args
// ---------------------------------------------------------------------------

export interface VerifyArgs {
	/** The acceptance record id whose owning checks are re-run (flauz:acc:<16-hex>). */
	readonly acceptanceId: string;
	/** The operator id firing the verify (never contents). */
	readonly actor: string;
}

export function parseVerifyArgs(arg: unknown): VerifyArgs {
	if (!isPlainObject(arg)) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.verify: the verify args must be an object { acceptanceId, actor }');
	}
	if (!isAcceptanceId(arg.acceptanceId)) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', `flauz.acceptance.verify: the acceptance id '${String(arg.acceptanceId)}' is not the flauz:acc:<16-hex> shape`);
	}
	if (typeof arg.actor !== 'string' || arg.actor.length === 0) {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_BAD_ARGS', 'flauz.acceptance.verify: actor must be a non-empty string (the operator id firing the verify)');
	}
	return { acceptanceId: arg.acceptanceId, actor: arg.actor };
}

// ---------------------------------------------------------------------------
// The evaluable checks (re-run against the released state)
// ---------------------------------------------------------------------------

function evaluateChecklistBinding(root: string, artifactPath: string, checklistId: string, fileSha256: string, fs: AcceptanceFsPort): Promise<ReceiptRow> {
	return readChecklistArtifact(root, fs, artifactPath).then(state => {
		if (state.state === 'absent') {
			return failRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' no longer exists (the release identity is gone -- the release cannot be verified against a vanished gate)`);
		}
		if (state.state === 'torn') {
			return failRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' is torn (${state.reason})`);
		}
		if (!state.idReDerives) {
			return failRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' carries a checklistId that does not re-derive over the re-read bytes`);
		}
		if (state.artifact.checklistId !== checklistId) {
			return failRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' now carries checklistId ${state.artifact.checklistId.slice(0, 12)}... but the acceptance record pinned ${checklistId.slice(0, 12)}... (the release identity drifted)`);
		}
		if (sha256Hex(state.text) !== fileSha256) {
			return failRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' bytes drifted (fileSha256 mismatch against the pinned ${fileSha256.slice(0, 12)}...)`);
		}
		return passRow('binding-checklist-re-read', `the bound checklist artifact '${artifactPath}' re-read, its checklistId re-derived over the re-read bytes and its bytes match the pinned sha256 (the release identity still pins)`);
	});
}

async function evaluateIncidentJournal(root: string, fs: AcceptanceFsPort, incidentId: string): Promise<ReceiptRow> {
	const journal = await readLoopJournalPin(root, fs, incidentId);
	if (journal.state === 'absent') {
		return failRow('binding-incident-journal', `the bound incident's loop journal (${incidentId}) is absent at verify time (the loop evidence vanished)`);
	}
	if (journal.state === 'torn') {
		return failRow('binding-incident-journal', `the bound incident's loop journal (${incidentId}) is torn (${journal.reason})`);
	}
	const lastStage = journal.rows[journal.rows.length - 1]?.toStage;
	if (lastStage !== 'release' && lastStage !== 'post-release-verification') {
		return failRow('binding-incident-journal', `the bound incident ${incidentId} sits at loop stage '${String(lastStage)}' at verify time (expected 'release' or 'post-release-verification')`);
	}
	return passRow('binding-incident-journal', `the bound incident's loop journal re-reads and the incident sits at stage '${String(lastStage)}' (the release-stage carry holds)`);
}

async function evaluateProductInventory(root: string, fs: AcceptanceFsPort, pinnedExtensions: readonly string[], pinnedParityRowCount: number, pinnedSbomComponents: readonly string[]): Promise<ReceiptRow> {
	const current = await readProductStatePin(root, fs);
	const currentNames = current.extensions.map(extension => extension.name);
	const sameExtensions = currentNames.length === pinnedExtensions.length && [...currentNames].sort().join(',') === [...pinnedExtensions].sort().join(',');
	const sameParity = current.parity.rowCount === pinnedParityRowCount;
	const currentSbom = current.sbom.extensionComponents.map(component => component.name);
	const sameSbom = currentSbom.length === pinnedSbomComponents.length && [...currentSbom].sort().join(',') === [...pinnedSbomComponents].sort().join(',');
	if (!sameExtensions || !sameParity || !sameSbom) {
		return failRow('product-inventory', `the product inventory drifted against the pinned state (extensions ${String(currentNames.length)} vs pinned ${String(pinnedExtensions.length)}, parity rows ${String(current.parity.rowCount)} vs pinned ${String(pinnedParityRowCount)}, sbom extension components ${String(currentSbom.length)} vs pinned ${String(pinnedSbomComponents.length)})`);
	}
	return passRow('product-inventory', `the product inventory matches the pinned state (${String(currentNames.length)} flauz extensions, parity rows ${String(current.parity.rowCount)}, sbom extension components ${String(currentSbom.length)})`);
}

async function evaluateCensusIntegrity(root: string, fs: AcceptanceFsPort): Promise<ReceiptRow> {
	const census = await readCensusPin(root, fs);
	if (census.problems.length > 0) {
		return failRow('census-integrity', `the durable-state census carries ${String(census.problems.length)} parse problem(s): ${census.problems.map(problem => `${problem.row} (${problem.problem})`).join('; ')}`);
	}
	return passRow('census-integrity', `the durable-state census surfaces parse clean (${String(census.rows.length)} surfaces re-walked, no parseError rows)`);
}

function passRow(check: string, detail: string): ReceiptRow {
	return { check, kind: check as ReceiptRow['kind'], verdict: 'pass', evidenceLabel: 'local-real', detail };
}

function failRow(check: string, detail: string): ReceiptRow {
	return { check, kind: check as ReceiptRow['kind'], verdict: 'fail', evidenceLabel: 'local-real', detail };
}

// ---------------------------------------------------------------------------
// The post-release-acceptance law
// ---------------------------------------------------------------------------

export interface VerifyResult {
	readonly ok: true;
	readonly receipt: VerificationReceipt;
	readonly persisted: PersistedReceipt;
	/** True when the receipt FAILED -- the typed failure record the incidents reopen law consumes. */
	readonly reopenConsumable: boolean;
}

export async function verifyPostRelease(deps: { root: string; fs: AcceptanceFsPort; clock: Clock }, args: VerifyArgs): Promise<VerifyResult> {
	const recordState = await readAcceptanceRecord(deps.root, deps.fs, args.acceptanceId);
	if (recordState.state === 'absent') {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_RECORD_ABSENT', `flauz.acceptance.verify: REFUSED -- the acceptance record ${args.acceptanceId} does not exist (the closing receipt is minted ONLY over a launched acceptance; fire flauz.acceptance.launch first)`);
	}
	if (recordState.state === 'torn') {
		throw new AcceptanceError('FLAUZ_ACCEPTANCE_RECORD_TORN', `flauz.acceptance.verify: REFUSED -- the acceptance record ${args.acceptanceId} is torn (${recordState.reason}); a verify over torn data would silently erase the evidence -- route to the operator`);
	}
	const record = recordState.record;

	// --- re-run the named owning checks against the released state ---
	const rows: ReceiptRow[] = [];
	for (const check of record.owningChecks) {
		if (!check.evaluableByPlane) {
			// the honest-scope law: a TYPED DISCLOSURE row naming the owning surface, never a silent green
			rows.push({
				check: check.name,
				kind: check.kind,
				verdict: 'disclosure',
				evidenceLabel: 'fixture',
				detail: `the acceptance plane cannot itself evaluate '${check.name}' (the honest-scope law): it is owned by ${check.owner} (evidence command '${check.command}', observable: ${check.observable}); this row is a TYPED DISCLOSURE naming the owning surface -- the acceptance plane observed nothing itself and the ladder label is never promoted by wording; never a silent green`,
				owningSurface: check.owner,
			});
			continue;
		}
		switch (check.kind) {
			case 'binding-checklist-re-read':
				rows.push(await evaluateChecklistBinding(deps.root, record.checklist.artifactPath, record.checklist.checklistId, record.checklist.fileSha256, deps.fs));
				break;
			case 'binding-incident-journal':
				if (record.incidentBinding === undefined) {
					rows.push(failRow(check.name, 'the owning check names an incident binding but the acceptance record carries none (an internally inconsistent record)'));
				} else {
					rows.push(await evaluateIncidentJournal(deps.root, deps.fs, record.incidentBinding.incidentId));
				}
				break;
			case 'product-inventory':
				rows.push(await evaluateProductInventory(deps.root, deps.fs, record.productStatePin.extensions.map(extension => extension.name), record.productStatePin.parity.rowCount, record.productStatePin.sbom.extensionComponents.map(component => component.name)));
				break;
			case 'census-integrity':
				rows.push(await evaluateCensusIntegrity(deps.root, deps.fs));
				break;
			default:
				// an evaluable check of an unknown kind is a typed failure, never a silent skip
				rows.push(failRow(check.name, `the owning check '${check.name}' is marked evaluable but its kind '${check.kind}' has no evaluator in this plane (a programming error surfaced honestly, never a silent green)`));
				break;
		}
	}

	const counts = {
		checks: rows.length,
		pass: rows.filter(row => row.verdict === 'pass').length,
		fail: rows.filter(row => row.verdict === 'fail').length,
		disclosure: rows.filter(row => row.verdict === 'disclosure').length,
	};
	const verdict: 'pass' | 'fail' = counts.fail > 0 ? 'fail' : 'pass';
	const now = deps.clock();
	const receiptId = receiptIdFromContent(canonicalJson({
		acceptanceId: record.acceptanceId,
		createdAt: now,
		rowVerdicts: rows.map(row => `${row.check}:${row.verdict}`),
	}));

	const receipt: VerificationReceipt = {
		$schema: ACCEPTANCE_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-acceptance-receipt',
		extensionId: EXTENSION_ID,
		receiptId,
		acceptanceId: record.acceptanceId,
		verdict,
		createdAt: now,
		createdAtIso: toIsoStamp(now),
		actor: args.actor,
		rows,
		counts,
		boundaryDisclosure: BOUNDARY_DISCLOSURE,
		privacyLaw: PRIVACY_LAW,
	};

	// pass or FAIL, both typed, both banked (a FAILED receipt is the reopen-consumable record)
	const persisted = await persistReceipt(deps, receipt);
	return { ok: true, receipt, persisted, reopenConsumable: verdict === 'fail' };
}

export function renderVerify(result: VerifyResult): readonly string[] {
	const lines: string[] = [];
	lines.push(`  receipt: ${result.receipt.receiptId} over acceptance ${result.receipt.acceptanceId} -- VERDICT ${result.receipt.verdict.toUpperCase()}${result.reopenConsumable ? ' (the FAILED receipt is the typed failure record the incidents reopen law consumes -- a closed loop never hides a regression)' : ''}`);
	lines.push(`    checks: ${String(result.receipt.counts.checks)} (pass ${String(result.receipt.counts.pass)} | fail ${String(result.receipt.counts.fail)} | disclosure ${String(result.receipt.counts.disclosure)} -- the disclosure rows are typed honest-scope rows naming their owning surfaces, never silent greens)`);
	for (const row of result.receipt.rows) {
		const marker = row.verdict === 'pass' ? '[PASS     ]' : row.verdict === 'fail' ? '[FAIL     ]' : '[DISCLOSURE]';
		lines.push(`    ${marker} ${row.check} (label '${row.evidenceLabel}' -- the frozen ladder, never promoted by wording)`);
		lines.push(`              ${row.detail}`);
	}
	lines.push(`    verified at: ${result.receipt.createdAtIso} (the injected clock -- the only timestamp source)`);
	lines.push(`  ${BOUNDARY_DISCLOSURE}`);
	return lines;
}
