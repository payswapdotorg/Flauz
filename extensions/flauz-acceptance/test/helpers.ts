/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-acceptance suite (A-PROD-006-W2, the W1
 * helpers.ts pattern). UNVERIFIED-BY-ME: the station runs the battery.
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces carry REAL `.flauz/`
 * trees (real checklist artifacts whose checklistIds re-derive over their
 * own bytes through the contract-pinned derivation, real loop journals,
 * real evidence-ledger + watermark bodies written through the real
 * writers). Never claim runtime-real or production-real evidence.
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AcceptanceFsPort, ReleaseChecklistArtifactPin, ChecklistRowPin } from '../src/api.ts';
import { sha256Hex, canonicalJson, serializeWatermark } from '../src/api.ts';

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_100_000_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/** The flauz-acceptance AcceptanceFsPort over node:fs (the extension-host wiring, mirrored in the test lane). */
export function nodeAcceptanceFs(): AcceptanceFsPort {
	return {
		readFileUtf8: async target => {
			try {
				return await fs.readFile(target, { encoding: 'utf-8' });
			} catch (err) {
				if ((err as { code?: string }).code === 'ENOENT') {
					return undefined;
				}
				throw err;
			}
		},
		readdir: async target => {
			try {
				return await fs.readdir(target);
			} catch (err) {
				const code = (err as { code?: string }).code;
				if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM') {
					return undefined;
				}
				throw err;
			}
		},
		mkdir: target => fs.mkdir(target, { recursive: true }),
		writeFile: (target, contents) => fs.writeFile(target, contents, { encoding: 'utf-8' }),
		appendFile: (target, contents) => fs.appendFile(target, contents, { encoding: 'utf-8' }),
	};
}

/** A fresh temp workspace root (mkdtemp; cleanup removes the tree). */
export async function tempRoot(prefix: string): Promise<{ root: string; cleanup: () => Promise<void> }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
	return {
		root,
		cleanup: async () => {
			await fs.rm(root, { recursive: true, force: true });
		},
	};
}

/** Plants the real fresh-workspace evidence bodies: an empty (fresh) evidence ledger + its TRUE watermark. */
export async function plantEvidenceBodies(root: string): Promise<void> {
	await fs.mkdir(path.join(root, '.flauz', 'evidence'), { recursive: true });
	await fs.writeFile(path.join(root, '.flauz', 'evidence', 'ledger.jsonl'), '', 'utf-8');
	const watermark = serializeWatermark({ $schema: 'flauz.evidence.size/v1', rowCount: 0, bytes: 0, headSha256: sha256Hex(''), lastCheckpointSeq: null, updatedAt: 1_740_100_000_000 });
	await fs.writeFile(path.join(root, '.flauz', 'evidence', 'size.json'), watermark, 'utf-8');
}

// ---------------------------------------------------------------------------
// The checklist fixture (a REAL flauz.release.checklist-shaped artifact)
// ---------------------------------------------------------------------------

export interface ChecklistFixtureOptions {
	readonly stamp?: string;
	readonly createdAt?: number;
	readonly verdict?: 'GO' | 'NO-GO';
	/** When true, one row renders red (a NO-GO with the honest failing row). */
	readonly redRow?: boolean;
	/** When set, the artifact body is written VERBATIM (torn-JSON cases). */
	readonly rawBody?: string;
}

/** The ten green prove-item rows (the release's acceptance set; ids nominal, evidence commands nominal -- the VERDICT is what the launch reads). */
function greenRows(): ChecklistRowPin[] {
	const rows: ChecklistRowPin[] = [];
	for (let i = 1; i <= 10; i++) {
		rows.push({
			id: `prove-item-${String(i)}`,
			title: `the release prove-item ${String(i)}`,
			verdict: 'green',
			evidence: { command: 'flauz.release.checklist', observable: `the prove-item-${String(i)} observable` },
			reasons: [],
			details: {},
		});
	}
	return rows;
}

/**
 * Plants a REAL checklist artifact at `.flauz/release/checklist-<stamp>.json`
 * whose checklistId re-derives over its own bytes through the
 * contract-pinned derivation (sha256 over the canonical body without the id).
 * Returns the workspace-relative artifact path.
 */
export async function plantChecklist(root: string, workspaceRoot: string, options: ChecklistFixtureOptions = {}): Promise<string> {
	const stamp = options.stamp ?? '2026-10-04T210000.000Z';
	const createdAt = options.createdAt ?? 1_740_100_000_000;
	const verdict = options.verdict ?? 'GO';
	let rows = greenRows();
	if (options.redRow === true) {
		rows = rows.map((row, index) => index === 4 ? { ...row, verdict: 'red' as const, reasons: ['the prove-item observed a refusal'] } : row);
	}
	const body: Omit<ReleaseChecklistArtifactPin, 'checklistId'> = {
		schemaVersion: 0,
		createdAt,
		productName: 'Flauz',
		productVersion: '0.6.0',
		extensionId: 'flauz.flauz-release',
		workspaceRoot,
		commandLine: 'flauz.release.checklist',
		verdict,
		rows,
		privacyLaw: 'METADATA-ONLY: surface shapes -- never contents.',
	};
	const checklistId = sha256Hex(canonicalJson(body));
	const artifact = { $schema: 'flauz.release.checklist/v1', ...body, checklistId };
	await fs.mkdir(path.join(root, '.flauz', 'release'), { recursive: true });
	const relPath = `.flauz/release/checklist-${stamp}.json`;
	await fs.writeFile(path.join(root, relPath), options.rawBody ?? `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
	return relPath;
}

// ---------------------------------------------------------------------------
// The loop-journal fixture (a REAL flauz.incidents-loop-shaped journal)
// ---------------------------------------------------------------------------

/** The incident id fixture (a valid flauz:inc:<16-hex>). */
export const INCIDENT_ID = 'flauz:inc:0123456789abcdef';

/** Plants a REAL loop journal whose final toStage is `release` (the incident-bound launch precondition). */
export async function plantLoopJournalAtRelease(root: string, incidentId = INCIDENT_ID): Promise<void> {
	await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
	const journalPath = path.join(root, '.flauz', 'incidents', `loop-${incidentId}.jsonl`);
	if (await fs.readFile(journalPath, 'utf-8').catch(() => undefined) !== undefined) {
		return;
	}
	const stages: readonly string[] = ['incident', 'reproducible-finding', 'registry-item', 'fix', 'regression', 'release'];
	const lines: string[] = [];
	for (const [index, stage] of stages.entries()) {
		lines.push(JSON.stringify({
			$schema: 'flauz.incidents-loop/v1',
			schemaVersion: 0,
			kind: 'flauz-incidents-loop',
			extensionId: 'flauz.flauz-incidents',
			incidentId,
			seq: index + 1,
			timestampEpoch: 1_740_100_000_000 + index * 1000,
			timestampIso: '2026-10-04T21:00:00.000Z',
			actor: 'operator-1',
			transition: index === 0 ? 'forward' : 'forward',
			...(index > 0 ? { fromStage: stages[index - 1] } : {}),
			toStage: stage,
			...(index > 0 ? { evidence: { label: 'local-real', kind: `stage-evidence-${String(index)}`, detail: `the ${stage} evidence` } } : {}),
		}));
	}
	await fs.writeFile(journalPath, `${lines.join('\n')}\n`, 'utf-8');
}

/** Assembles a secret-shaped string from fragments at runtime (the flauz-resources discipline; never a complete literal in source). */
export function secretShapedFragment(): string {
	return ['ghp_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4'].join('');
}
