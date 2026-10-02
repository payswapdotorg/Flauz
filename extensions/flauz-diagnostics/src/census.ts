/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The durable-state census: the diagnostics.json surface (A-PROD-004-W1).
 *
 * THE CENSUS LAW (the work order's privacy gate): COUNTS AND HASHES ONLY,
 * never contents. Every artifact class reports {present, path} + the counts
 * and digests its format exposes; free-form text fields are never projected
 * here (they are contents-class). Paths and ids are metadata (the explicit
 * allowlist of the beta gate's privacy law).
 */

import {
        type Clock,
        type DiagFsPort,
        type EnvironmentInfo,
        type VersionsInfo,
        DIAGNOSTICS_SCHEMA_ID,
        BROWSER_SESSIONS_PATH,
        ENVIRONMENTS_REGISTRY_PATH,
        LEDGER_PATH,
        MODELS_DIR,
        ORCH_GRAPHS_PATH,
        ORCH_JOURNAL_PATH,
        PROVIDERS_PATH,
        RESOURCES_GRAPH_PATH,
        RESOURCES_OPS_PATH,
        ROUTING_DECISIONS_PATH,
        SIZE_PATH,
        TASKS_PATH,
        WORKFLOWS_DIR,
        isPlainObject,
        joinPath,
        serializeArtifact,
        sha256Hex,
        splitJsonl,
} from './api.ts';
import { ledgerHeadHash, parseLedgerLine, type LedgerRowShape } from './verify.ts';

/** One census row: the artifact's presence, workspace path and counted/hashed summary. */
export interface CensusRow {
        readonly present: boolean;
        readonly path: string;
        readonly [summary: string]: unknown;
}

/** The whole durable-state census (one row per artifact class). */
export interface DurableStateCensus {
        readonly tasks: CensusRow;
        readonly evidenceLedger: CensusRow;
        readonly evidenceWatermark: CensusRow;
        readonly resourcesGraph: CensusRow;
        readonly opsChain: CensusRow;
        readonly environmentsRegistry: CensusRow;
        readonly browserSessions: CensusRow;
        readonly workflows: CensusRow;
        readonly orchestration: CensusRow;
        readonly providerLanesState: CensusRow;
}

/** The diagnostics snapshot (the diagnostics.json artifact + the show surface). */
export interface DiagnosticsSnapshot {
        readonly $schema: typeof DIAGNOSTICS_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly versions: VersionsInfo;
        readonly environment: EnvironmentInfo;
        readonly durableState: DurableStateCensus;
}

/** Deps of the census (all ports; extension.ts wires node, tests wire temp dirs). */
export interface CensusDeps {
        readonly root: string;
        readonly fs: DiagFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        readonly environment: EnvironmentInfo;
}

async function readIfExists(deps: CensusDeps, relativePath: string): Promise<string | undefined> {
        return await deps.fs.readFileUtf8(joinPath(deps.root, relativePath));
}

/** Counts array elements (tolerant: non-arrays count 0 -- the census reports, it does not repair). */
function arrayLength(value: unknown): number {
        return Array.isArray(value) ? value.length : 0;
}

/** Recursively counts task events across the envelope (counts only; never payloads). */
function taskEventCount(envelope: unknown): number {
        if (!isPlainObject(envelope) || !Array.isArray(envelope.tasks)) {
                return 0;
        }
        let events = 0;
        for (const task of envelope.tasks) {
                if (isPlainObject(task) && Array.isArray(task.events)) {
                        events += task.events.length;
                }
        }
        return events;
}

/** Per-status task counts (statuses are the closed flauz.tasks/v0 vocabulary -- metadata). */
function taskStatusCounts(envelope: unknown): Record<string, number> {
        const counts: Record<string, number> = {};
        if (isPlainObject(envelope) && Array.isArray(envelope.tasks)) {
                for (const task of envelope.tasks) {
                        if (isPlainObject(task) && typeof task.status === 'string') {
                                counts[task.status] = (counts[task.status] ?? 0) + 1;
                        }
                }
        }
        return counts;
}

/** Ledger kind census (the closed evidence-kind vocabulary -- metadata). */
function ledgerKindCounts(rows: readonly LedgerRowShape[]): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const row of rows) {
                counts[row.kind] = (counts[row.kind] ?? 0) + 1;
        }
        return counts;
}

/**
 * Collects the diagnostics snapshot over the real durable state. Never throws
 * on absent state (absence is honest data: a workspace may legitimately not
 * have a class); malformed JSON surfaces as present + parseError (the census
 * reports, it does not repair).
 */
export async function collectDiagnostics(deps: CensusDeps): Promise<DiagnosticsSnapshot> {
        // --- tasks envelope (flauz-workspace) ---
        const tasksText = await readIfExists(deps, TASKS_PATH);
        const tasks: CensusRow = tasksText === undefined
                ? { present: false, path: TASKS_PATH }
                : (() => {
                        try {
                                const envelope: unknown = JSON.parse(tasksText);
                                return {
                                        present: true,
                                        path: TASKS_PATH,
                                        taskCount: arrayLength(isPlainObject(envelope) ? envelope.tasks : undefined),
                                        eventCount: taskEventCount(envelope),
                                        statusCounts: taskStatusCounts(envelope),
                                        fileSha256: sha256Hex(tasksText),
                                };
                        } catch (err) {
                                return { present: true, path: TASKS_PATH, parseError: (err as Error).message, fileSha256: sha256Hex(tasksText) };
                        }
                })();

        // --- evidence ledger (flauz-workspace) ---
        const ledgerText = await readIfExists(deps, LEDGER_PATH);
        let evidenceLedger: CensusRow;
        if (ledgerText === undefined) {
                evidenceLedger = { present: false, path: LEDGER_PATH };
        } else {
                const rows: LedgerRowShape[] = [];
                let firstParseError: string | undefined;
                for (const [index, line] of splitJsonl(ledgerText).entries()) {
                        if (line === '') {
                                firstParseError ??= `line ${String(index + 1)} is empty`;
                                continue;
                        }
                        const outcome = parseLedgerLine(line, index + 1);
                        if (outcome.ok) {
                                rows.push(outcome.row);
                        } else {
                                firstParseError ??= outcome.error;
                        }
                }
                evidenceLedger = {
                        present: true,
                        path: LEDGER_PATH,
                        rowCount: rows.length,
                        headSha256: ledgerHeadHash(rows),
                        kindCounts: ledgerKindCounts(rows),
                        ...(firstParseError !== undefined ? { parseError: firstParseError } : {}),
                };
        }

        // --- the ledger size watermark (the DL-20 hardening census; integrity.json verifies it) ---
        const sizeText = await readIfExists(deps, SIZE_PATH);
        let evidenceWatermark: CensusRow;
        if (sizeText === undefined) {
                evidenceWatermark = { present: false, path: SIZE_PATH };
        } else {
                try {
                        const parsed: unknown = JSON.parse(sizeText);
                        const recordedRowCount = isPlainObject(parsed) && typeof parsed.rowCount === 'number' ? parsed.rowCount : undefined;
                        evidenceWatermark = {
                                present: true,
                                path: SIZE_PATH,
                                ...(recordedRowCount !== undefined ? { recordedRowCount } : { parseError: 'watermark carries no numeric rowCount' }),
                        };
                } catch (err) {
                        evidenceWatermark = { present: true, path: SIZE_PATH, parseError: (err as Error).message };
                }
        }

        // --- resources graph (flauz-resources) ---
        const graphText = await readIfExists(deps, RESOURCES_GRAPH_PATH);
        let resourcesGraph: CensusRow;
        if (graphText === undefined) {
                resourcesGraph = { present: false, path: RESOURCES_GRAPH_PATH };
        } else {
                try {
                        const envelope: unknown = JSON.parse(graphText);
                        resourcesGraph = {
                                present: true,
                                path: RESOURCES_GRAPH_PATH,
                                refCount: arrayLength(isPlainObject(envelope) ? envelope.nodes : undefined),
                                edgeCount: arrayLength(isPlainObject(envelope) ? envelope.edges : undefined),
                                surfaceCount: arrayLength(isPlainObject(envelope) ? envelope.surfaces : undefined),
                                fileSha256: sha256Hex(graphText),
                        };
                } catch (err) {
                        resourcesGraph = { present: true, path: RESOURCES_GRAPH_PATH, parseError: (err as Error).message, fileSha256: sha256Hex(graphText) };
                }
        }

        // --- ops chain (flauz-resources) ---
        const opsText = await readIfExists(deps, RESOURCES_OPS_PATH);
        let opsChain: CensusRow;
        if (opsText === undefined) {
                opsChain = { present: false, path: RESOURCES_OPS_PATH };
        } else {
                const lines = splitJsonl(opsText).filter(line => line !== '');
                opsChain = {
                        present: true,
                        path: RESOURCES_OPS_PATH,
                        recordCount: lines.length,
                        ...(lines.length > 0 ? { headLineSha256: sha256Hex(lines[lines.length - 1] ?? '') } : {}),
                };
        }

        // --- environments registry (flauz-environments contract file; read-only sibling state) ---
        const environmentsText = await readIfExists(deps, ENVIRONMENTS_REGISTRY_PATH);
        let environmentsRegistry: CensusRow;
        if (environmentsText === undefined) {
                environmentsRegistry = { present: false, path: ENVIRONMENTS_REGISTRY_PATH };
        } else {
                try {
                        const registry: unknown = JSON.parse(environmentsText);
                        environmentsRegistry = {
                                present: true,
                                path: ENVIRONMENTS_REGISTRY_PATH,
                                environmentCount: arrayLength(isPlainObject(registry) ? registry.environments : undefined),
                                fileSha256: sha256Hex(environmentsText),
                        };
                } catch (err) {
                        environmentsRegistry = { present: true, path: ENVIRONMENTS_REGISTRY_PATH, parseError: (err as Error).message, fileSha256: sha256Hex(environmentsText) };
                }
        }

        // --- browser-session journal (flauz-browser) ---
        const browserText = await readIfExists(deps, BROWSER_SESSIONS_PATH);
        const browserSessions: CensusRow = browserText === undefined
                ? { present: false, path: BROWSER_SESSIONS_PATH }
                : { present: true, path: BROWSER_SESSIONS_PATH, recordCount: splitJsonl(browserText).filter(line => line !== '').length };

        // --- workflow envelopes (flauz-workflow) ---
        const workflowsDirEntries = await deps.fs.readdir(joinPath(deps.root, WORKFLOWS_DIR));
        let workflows: CensusRow;
        if (workflowsDirEntries === undefined) {
                workflows = { present: false, path: WORKFLOWS_DIR };
        } else {
                // Envelope files are W-NNN.json (index.json is the registry -- counted, not listed).
                const envelopeFiles = workflowsDirEntries.filter(name => /^W-\d{3,}\.json$/.test(name)).sort();
                workflows = {
                        present: true,
                        path: WORKFLOWS_DIR,
                        envelopeCount: envelopeFiles.length,
                        indexPresent: workflowsDirEntries.includes('index.json'),
                        ...(envelopeFiles.length > 0 ? { envelopeIds: envelopeFiles.map(name => name.replace(/\.json$/, '')) } : {}),
                };
        }

        // --- orchestration state (flauz-agent core) ---
        const graphsText = await readIfExists(deps, ORCH_GRAPHS_PATH);
        const journalText = await readIfExists(deps, ORCH_JOURNAL_PATH);
        let orchestration: CensusRow;
        if (graphsText === undefined && journalText === undefined) {
                orchestration = { present: false, path: '.flauz/orchestration' };
        } else {
                let graphCount = 0;
                if (graphsText !== undefined) {
                        try {
                                const envelope: unknown = JSON.parse(graphsText);
                                graphCount = arrayLength(isPlainObject(envelope) ? envelope.graphs : undefined);
                        } catch {
                                graphCount = 0;
                        }
                }
                const journalRowCount = journalText === undefined ? 0 : splitJsonl(journalText).filter(line => line !== '').length;
                orchestration = { present: true, path: '.flauz/orchestration', graphCount, journalRowCount };
        }

        // --- the models state dir (presence census only; the lane SUMMARY is provider-lanes.json) ---
        const providersText = await readIfExists(deps, PROVIDERS_PATH);
        const decisionsText = await readIfExists(deps, ROUTING_DECISIONS_PATH);
        const providerLanesState: CensusRow = providersText === undefined && decisionsText === undefined
                ? { present: false, path: MODELS_DIR }
                : {
                        present: true,
                        path: MODELS_DIR,
                        providersFilePresent: providersText !== undefined,
                        decisionRowCount: decisionsText === undefined ? 0 : splitJsonl(decisionsText).filter(line => line !== '').length,
                };

        return {
                $schema: DIAGNOSTICS_SCHEMA_ID,
                schemaVersion: 0,
                createdAt: deps.clock(),
                versions: deps.versions,
                environment: deps.environment,
                durableState: {
                        tasks,
                        evidenceLedger,
                        evidenceWatermark,
                        resourcesGraph,
                        opsChain,
                        environmentsRegistry,
                        browserSessions,
                        workflows,
                        orchestration,
                        providerLanesState,
                },
        };
}

/** The canonical artifact bytes of a snapshot (the diagnostics.json file body). */
export function serializeDiagnostics(snapshot: DiagnosticsSnapshot): string {
        return serializeArtifact(snapshot);
}
