/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Shared fixture boot for the flauz-acceptance suite (A-PROD-006-W2).
 *
 * EVIDENCE LEVEL -- local-real: the fixture workspaces carry REAL `.flauz/`
 * trees (real evidence-ledger + watermark bodies, real checklist artifacts
 * cut by the REAL flauz-release machinery over the seeded workspace or
 * planted through the contract-duplicated shape, real acceptance ledgers +
 * verification journals written through THIS extension's real writers); the
 * seeded incident ledgers are REAL workspace records produced by hand
 * through the owning shapes (the contract-duplicated shapes pinned by the
 * contract suite against the owning modules). Never claim runtime-real or
 * production-real evidence (the honest-evidence law: the production launch
 * has not happened; this wave proves the machinery over seeded workspace
 * records, honestly labeled).
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AcceptanceFsPort, ReleaseChecklistArtifact } from '../src/api.ts';
import { sha256Hex, serializeArtifact, serializeWatermark, checklistIdOf, EXTENSION_ID, ACCEPTANCE_SCHEMA_ID, VERIFICATION_SCHEMA_ID, INCIDENTS_SCHEMA_ID, ACCEPTANCE_DIR } from '../src/api.ts';

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
 * The flauz-acceptance AcceptanceFsPort over node:fs (the extension-host
 * wiring, mirrored in the test lane).
 */
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
// The seeded checklist fixtures (the launch-act's subject)
// ---------------------------------------------------------------------------

/** The ten checklist row ids, the real flauz-release order (the named owning checks' source set). */
export const CHECKLIST_ROW_IDS = ['diagnostics', 'backup', 'crashRecovery', 'migration', 'telemetry', 'failureTyping', 'rollback', 'supportBundle', 'installVerification', 'checklistArtifact'] as const;

/** Builds one checklist row body for a planted artifact (the contract-duplicated shape). */
function checklistRow(id: string, command: string, verdict: 'green' | 'red' | 'unknown'): Record<string, unknown> {
        return {
                id,
                title: `the ${id} row`,
                verdict,
                evidence: { command, observable: `the ${id} observable` },
                reasons: [],
                details: {},
        };
}

/**
 * Plants a REAL checklist artifact through the contract-duplicated shape:
 * `.flauz/release/checklist-<stamp>.json` with the TRUE checklistId (the
 * id re-derives over the artifact's own canonical body). Fixture-labeled
 * (the artifact is planted by hand through the pinned shape, not cut by
 * the real flauz.release.checklist machinery -- disclosed honestly).
 */
export async function plantChecklistArtifact(root: string, verdict: 'GO' | 'NO-GO' = 'GO', stamp = '2026-10-05T120000.000Z', rowOverrides: Record<string, 'green' | 'red' | 'unknown'> = {}): Promise<string> {
        const rows = CHECKLIST_ROW_IDS.map((id, index) => checklistRow(id, `flauz.owner.${id}`, verdict === 'GO' ? (rowOverrides[id] ?? 'green') : (rowOverrides[id] ?? 'red')));
        const body: Omit<ReleaseChecklistArtifact, 'checklistId'> = {
                $schema: 'flauz.release-checklist/v1',
                schemaVersion: 0,
                createdAt: 1_740_100_000_000 + Number(stamp.slice(11, 13)) * 3_600_000,
                productName: 'Flauz',
                productVersion: '1.100.0-flauz',
                extensionId: 'flauz.flauz-release',
                extensionVersion: '0.1.0',
                workspaceRoot: root,
                commandLine: 'flauz.release.checklist',
                verdict,
                rows: rows as unknown as ReleaseChecklistArtifact['rows'],
                privacyLaw: 'METADATA-ONLY: surface shapes (paths, versions, checksums, verdicts, counts) -- never contents.',
        };
        const artifact: ReleaseChecklistArtifact = { ...body, checklistId: checklistIdOf(body) };
        const relPath = `.flauz/release/checklist-${stamp}.json`;
        await fs.mkdir(path.join(root, '.flauz', 'release'), { recursive: true });
        await fs.writeFile(path.join(root, relPath), serializeArtifact(artifact), 'utf-8');
        return relPath;
}

// ---------------------------------------------------------------------------
// The seeded incidents fixtures (the launch's incident binding subject)
// ---------------------------------------------------------------------------

/**
 * Plants a REAL incidents ledger (`.flauz/incidents/incidents.json`,
 * `flauz.incidents/v1`) carrying the given incident id (one incident, one
 * revision, the manual source binding) -- the shape the launch's
 * contract-pinned binding resolver reads.
 */
export async function plantIncidentsLedger(root: string, incidentId: string): Promise<void> {
        const ledger = {
                $schema: INCIDENTS_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-incidents',
                createdAt: 1_740_100_000_000,
                updatedAt: 1_740_100_000_000,
                extensionId: 'flauz.flauz-incidents',
                incidents: [
                        {
                                incidentId,
                                firstReportedAtIso: '2026-10-04T21:00:00.000Z',
                                firstReportedAtEpoch: 1_740_100_000_000,
                                revisions: [{
                                        revision: 1,
                                        reportedAtIso: '2026-10-04T21:00:00.000Z',
                                        reportedAtEpoch: 1_740_100_000_000,
                                        class: 'regression',
                                        severity: 'sev2',
                                        affectedSurface: 'flauz-release',
                                        reproNote: 'the seeded repro note',
                                        evidenceRefs: [],
                                        sourceBinding: { kind: 'manual', resolved: true, disclosed: 'manual-disclosed' },
                                }],
                        },
                ],
        };
        await fs.mkdir(path.join(root, '.flauz', 'incidents'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'incidents', 'incidents.json'), `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
}

/** The deterministic incident id the seeded fixtures use (flauz:inc:<16-hex> from a fixed seed). */
export const SEEDED_INCIDENT_ID = `flauz:inc:${sha256Hex('the-seeded-acceptance-incident').slice(0, 16)}`;

/** The deterministic acceptance id for a fixed seed (flauz:acc:<16-hex>). */
export function acceptanceIdOfSeed(seed: string): string {
        return `flauz:acc:${sha256Hex(seed).slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// The seeded durable-state fixtures (the pinned product state's subject)
// ---------------------------------------------------------------------------

/** Plants a REAL tasks envelope (`.flauz/tasks.json`, `flauz.tasks/v0`). */
export async function plantTasksEnvelope(root: string): Promise<void> {
        const envelope = {
                $schema: 'flauz.tasks/v0',
                tasks: [],
        };
        await fs.mkdir(path.join(root, '.flauz'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'tasks.json'), `${JSON.stringify(envelope, null, 2)}\n`, 'utf-8');
}

/** Plants a REAL workflows index + one envelope (the workflows surface with its enumerated dir). */
export async function plantWorkflows(root: string): Promise<void> {
        await fs.mkdir(path.join(root, '.flauz', 'workflows'), { recursive: true });
        await fs.writeFile(path.join(root, '.flauz', 'workflows', 'index.json'), `${JSON.stringify({ $schema: 'flauz.workflows/v1', workflows: [] }, null, 2)}\n`, 'utf-8');
        await fs.writeFile(path.join(root, '.flauz', 'workflows', 'W-001.json'), `${JSON.stringify({ $schema: 'flauz.workflows/v1', id: 'W-001' }, null, 2)}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// The seeded acceptance-lane fixtures (the status plane's verdict subjects)
// ---------------------------------------------------------------------------

/** Reads the acceptance ledger's raw text (the fixture verification lane). */
export async function readAcceptanceLedgerText(root: string): Promise<string> {
        return await fs.readFile(path.join(root, ACCEPTANCE_DIR, 'acceptances.json'), 'utf-8');
}

/** Reads one acceptance's verification journal's raw text (the fixture verification lane). */
export async function readVerificationJournalText(root: string, acceptanceId: string): Promise<string> {
        return await fs.readFile(path.join(root, ACCEPTANCE_DIR, `verify-${acceptanceId}.jsonl`), 'utf-8');
}

/** The seeded acceptance ledger's schema id (re-exported for the fixture assertions). */
export const SEEDED_ACCEPTANCE_SCHEMA_ID = ACCEPTANCE_SCHEMA_ID;

/** The seeded verification journal's schema id (re-exported for the fixture assertions). */
export const SEEDED_VERIFICATION_SCHEMA_ID = VERIFICATION_SCHEMA_ID;

/** This extension's own id (re-exported for the fixture assertions). */
export const SEEDED_EXTENSION_ID = EXTENSION_ID;
