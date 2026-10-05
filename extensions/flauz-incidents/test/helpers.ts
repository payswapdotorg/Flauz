/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-incidents suite (A-PROD-006-W1).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces carry REAL `.flauz/`
 * trees (real evidence-ledger + watermark bodies, real incident ledger +
 * loop journals written through THIS extension's real writers); the source
 * fixtures (the seeded telemetry failure census, the seeded durability
 * heartbeat escalation record, the seeded dogfood friction log) are REAL
 * workspace records produced by hand through the owning shapes (the
 * contract-duplicated shapes pinned by the contract suite against the
 * owning modules). Never claim runtime-real or production-real evidence
 * (the honest-evidence law: the launch has not happened; this wave proves
 * the machinery over seeded workspace records, honestly labeled).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IncidentsFsPort } from '../src/api.ts';
import { sha256Hex, serializeWatermark, EXTENSION_ID, INCIDENTS_SCHEMA_ID, LOOP_SCHEMA_ID, TELEMETRY_FAILURES_SCHEMA_ID, DURABILITY_HEARTBEAT_SCHEMA_ID, FRICTION_SCHEMA_ID } from '../src/api.ts';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

/** The real repo root (the contract suite's local-real subject). */
export const repoRoot = REPO_ROOT;

/** Deterministic but distinguishable timestamps (advances 1000 per call). */
export function steppingClock(start = 1_740_100_000_000): () => number {
	let current = start;
	return () => {
		const value = current;
		current += 1000;
		return value;
	};
}

/**
 * The flauz-incidents IncidentsFsPort over node:fs (the extension-host
 * wiring, mirrored in the test lane).
 */
export function nodeIncidentsFs(): IncidentsFsPort {
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

/**
 * The write-refusing fs port (the read-only law's proof vehicle): every
 * write surface throws; the read surface delegates to the real port. A
 * command that completes against this port has provably written nothing.
 */
export function writeRefusingFs(base: IncidentsFsPort): IncidentsFsPort {
	const refuse = async (): Promise<never> => {
		throw new Error('flauz-incidents/test: WRITE REFUSED (the read-only law: this command must not write)');
	};
	return {
		readFileUtf8: base.readFileUtf8,
		readdir: base.readdir,
		mkdir: () => refuse(),
		writeFile: () => refuse(),
		appendFile: () => refuse(),
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
// The seeded source fixtures (the typed source bindings' referenced records)
// ---------------------------------------------------------------------------

/**
 * Plants a REAL telemetry failure census at `.flauz/telemetry/failures.json`
 * (`flauz.telemetry-failures/v1`) carrying one class group the
 * telemetry-census source binding resolves against. The shape is the
 * contract-duplicated `TelemetryFailureCensus` (pinned byte-equal against
 * flauz-telemetry/src/failuresList.ts by the contract suite).
 */
export async function plantTelemetryFailureCensus(root: string, failureClass = 'provider-unreachable', eventCount = 3): Promise<string> {
	const censusPath = '.flauz/telemetry/failures.json';
	const census = {
		$schema: TELEMETRY_FAILURES_SCHEMA_ID,
		generatedAt: 1_740_100_000_000,
		windowDays: 14,
		totalFailures: eventCount,
		classes: [
			{ failureClass, label: 'Provider unreachable', surfaces: ['flauz-models', 'flauz-agent'], affectedIdentities: [], eventCount, timeDistribution: {}, remediation: 'Check network egress.' },
		],
		parseErrorCount: 0,
	};
	await fs.mkdir(path.join(root, '.flauz', 'telemetry'), { recursive: true });
	await fs.writeFile(path.join(root, censusPath), `${JSON.stringify(census, null, 2)}\n`, 'utf-8');
	return censusPath;
}

/**
 * Plants a REAL durability heartbeat record (with an escalation field) at
 * `.flauz/durability/heartbeat-<stamp>.json` (`flauz.durability-heartbeat/v1`).
 * The durability-escalation source binding resolves against the escalation
 * field. The shape is the contract-duplicated `DurabilityHeartbeatRecord`
 * (pinned byte-equal against flauz-durability/src/heartbeat.ts by the
 * contract suite).
 */
export async function plantDurabilityHeartbeat(root: string, laneId = 'lane-alpha', policy = 'checkpoint-and-restart', stamp = '2026-10-04T210000.000Z'): Promise<string> {
	const heartbeatPath = `.flauz/durability/heartbeat-${stamp}.json`;
	const heartbeat = {
		$schema: DURABILITY_HEARTBEAT_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-durability-heartbeat',
		createdAt: 1_740_100_000_000,
		extensionId: 'flauz.flauz-durability',
		boundaryDisclosure: 'the durability boundary disclosure',
		laneId,
		owner: 'flauz-workspace',
		beatAt: 1_740_100_001_000,
		beatCount: 3,
		ring: [1_740_100_001_000],
		liveness: 'STALE',
		escalation: { policy, demandedAt: 1_740_100_001_000, executionBoundary: 'the machinery records the demand; the execution of an actual restart routes through the owning task\'s own machinery' },
	};
	await fs.mkdir(path.join(root, '.flauz', 'durability'), { recursive: true });
	await fs.writeFile(path.join(root, heartbeatPath), `${JSON.stringify(heartbeat, null, 2)}\n`, 'utf-8');
	return heartbeatPath;
}

/**
 * Plants a REAL dogfood friction log at `.flauz/dogfood/exercise-1.friction.jsonl`
 * (`flauz.dogfood-friction/v1`) carrying one friction row the
 * dogfood-friction source binding resolves against. The shape is the
 * contract-duplicated `FrictionRow` (pinned byte-equal against
 * build/flauz/dogfood/frictionlog.mjs by the contract suite).
 */
export async function plantDogfoodFrictionLog(root: string, kind = 'failed-task', phase = 'build'): Promise<string> {
	const frictionLogPath = '.flauz/dogfood/exercise-1.friction.jsonl';
	const row = { schema: FRICTION_SCHEMA_ID, type: 'friction', ts: 1_740_100_000_000, phase, kind, detail: 'the dogfood friction record', recovery: '' };
	await fs.mkdir(path.join(root, '.flauz', 'dogfood'), { recursive: true });
	await fs.writeFile(path.join(root, frictionLogPath), `${JSON.stringify(row)}\n`, 'utf-8');
	return frictionLogPath;
}

// ---------------------------------------------------------------------------
// The seeded incident-lane fixtures (the contract suite's local-real subjects)
// ---------------------------------------------------------------------------

/** Plants a seeded incident ledger (one incident, one revision) for the status plane's verdict tests. */
export async function plantIncidentsLedger(root: string, incidentId: string, revision: { class: string; severity: 'sev1' | 'sev2' | 'sev3' | 'sev4'; affectedSurface: string; reproNote: string; evidenceRefs: readonly string[]; sourceBinding: Record<string, unknown> }, reportedAtIso = '2026-10-04T21:00:00.000Z', reportedAtEpoch = 1_740_100_000_000): Promise<void> {
	const ledger = {
		$schema: INCIDENTS_SCHEMA_ID,
		schemaVersion: 0,
		kind: 'flauz-incidents',
		createdAt: reportedAtEpoch,
		updatedAt: reportedAtEpoch,
		extensionId: EXTENSION_ID,
		incidents: [
			{
				incidentId,
				firstReportedAtIso: reportedAtIso,
				firstReportedAtEpoch: reportedAtEpoch,
				revisions: [{ revision: 1, reportedAtIso, reportedAtEpoch, class: revision.class, severity: revision.severity, affectedSurface: revision.affectedSurface, reproNote: revision.reproNote, evidenceRefs: revision.evidenceRefs, sourceBinding: revision.sourceBinding }],
			},
		],
	};
	await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
	await fs.writeFile(path.join(root, '.flauz', 'incidents', 'incidents.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
}

/** Plants a seeded loop journal (one row per transition) for the status plane's verdict tests. */
export async function plantLoopJournal(root: string, incidentId: string, rows: readonly Record<string, unknown>[]): Promise<void> {
	const journalPath = path.join(root, '.flauz', 'incidents', `loop-${incidentId}.jsonl`);
	await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
	const lines = rows.map(row => JSON.stringify({ $schema: LOOP_SCHEMA_ID, schemaVersion: 0, kind: 'flauz-incidents-loop', extensionId: EXTENSION_ID, ...row }));
	await fs.writeFile(journalPath, `${lines.join('\n')}\n`, 'utf-8');
}

/** Builds one loop journal row's body (without the schema envelope, added by plantLoopJournal). */
export function journalRowBody(seq: number, timestampEpoch: number, actor: string, transition: 'forward' | 'reopen' | 'close' | 'refusal', toStage: string, fromStage: string | undefined = undefined, evidence: Record<string, unknown> | undefined = undefined, refusedEvidenceKind: string | undefined = undefined): Record<string, unknown> {
	const row: Record<string, unknown> = {
		incidentId: 'flauz:inc:0000000000000000',
		seq,
		timestampEpoch,
		timestampIso: '2026-10-04T21:00:00.000Z',
		actor,
		transition,
		toStage,
	};
	if (fromStage !== undefined) {
		row.fromStage = fromStage;
	}
	if (evidence !== undefined) {
		row.evidence = evidence;
	}
	if (refusedEvidenceKind !== undefined) {
		row.refusedEvidenceKind = refusedEvidenceKind;
	}
	return row;
}
