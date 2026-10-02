/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The surface enumeration + counting core (A-PROD-004-W2).
 *
 * THE SURFACE-SET LAW: the export/restore surface set is EXACTLY the W1
 * diagnostics census enumeration -- one SurfaceDef per census row, ids
 * identical (pinned by test/contract.test.ts). Absent surfaces are listed as
 * absent, never faked.
 *
 * THE COUNT LAW (the census privacy posture, inherited by the manifest): the
 * per-surface summaries are COUNTS AND HASHES ONLY, never contents -- the
 * same counting logic the census performs, contract-duplicated here (DL-32)
 * and pinned against the real census output in the contract suite.
 */

import {
        type BackupFsPort,
        type SurfaceDef,
        type SurfaceId,
        BROWSER_SESSIONS_PATH,
        ENVIRONMENTS_REGISTRY_PATH,
        LEDGER_PATH,
        PROVIDERS_PATH,
        RESOURCES_GRAPH_PATH,
        RESOURCES_OPS_PATH,
        ROUTING_DECISIONS_PATH,
        SURFACES,
        TASKS_PATH,
        ORCH_GRAPHS_PATH,
        ORCH_JOURNAL_PATH,
        SIZE_PATH,
        WORKFLOWS_DIR,
        isPlainObject,
        joinPath,
        splitJsonl,
} from './api.ts';
import { parseLedgerLine, type LedgerRowShape } from './verify.ts';

/** One enumerated surface file: where it lives in the workspace and where it lands in the export. */
export interface SurfaceFileRef {
        /** The workspace-relative source path (e.g. `.flauz/evidence/ledger.jsonl`). */
        readonly sourcePath: string;
        /** The export-relative path (e.g. `state/.flauz/evidence/ledger.jsonl`). */
        readonly exportPath: string;
}

/** One enumerated surface: its files resolved against a live tree (or a manifest). */
export interface SurfaceEnumeration {
        readonly def: SurfaceDef;
        readonly files: readonly SurfaceFileRef[];
}

/** The export-relative path of a workspace-relative durable file (the state/ mirror). */
export function stateMirrorPath(sourcePath: string): string {
        return `state/${sourcePath}`;
}

/** The workspace-relative source path of an export-relative state file (the inverse mirror). */
export function stateSourcePath(exportPath: string): string {
        return exportPath.slice('state/'.length);
}

/**
 * Enumerates every surface's files against the live tree: fixed files as
 * defined, plus the workflows dir glob (W-NNN.json envelopes, index.json via
 * the fixed list). Presence is resolved per-file by the CALLER (this walks
 * the tree shape, not the bytes).
 */
export async function enumerateSurfaces(root: string, fs: BackupFsPort): Promise<readonly SurfaceEnumeration[]> {
        const out: SurfaceEnumeration[] = [];
        for (const def of SURFACES) {
                const files: SurfaceFileRef[] = [];
                const seen = new Set<string>();
                for (const sourcePath of def.fixedFiles) {
                        if (!seen.has(sourcePath)) {
                                seen.add(sourcePath);
                                files.push({ sourcePath, exportPath: stateMirrorPath(sourcePath) });
                        }
                }
                if (def.dirFile !== undefined) {
                        const entries = await fs.readdir(joinPath(root, def.dirFile.dir));
                        if (entries !== undefined) {
                                for (const name of entries.filter(entry => def.dirFile !== undefined && def.dirFile.pattern.test(entry)).sort()) {
                                        const sourcePath = joinPath(def.dirFile.dir, name);
                                        if (!seen.has(sourcePath)) {
                                                seen.add(sourcePath);
                                                files.push({ sourcePath, exportPath: stateMirrorPath(sourcePath) });
                                        }
                                }
                        }
                }
                out.push({ def, files });
        }
        return out;
}

/** Enumerates every surface's files against a MANIFEST's recorded file list (the verify path). */
export function enumerateSurfacesFromManifest(files: readonly { readonly sourcePath: string; readonly exportPath: string }[]): readonly SurfaceEnumeration[] {
        return SURFACES.map(def => ({
                def,
                files: files
                        .filter(file => surfaceOfSourcePath(file.sourcePath) === def.id)
                        .map(file => ({ sourcePath: file.sourcePath, exportPath: file.exportPath })),
        }));
}

/**
 * The interrupted-copy signature probe (the torn/tampered discriminator).
 *
 * Receipts alone cannot tell a TORN copy (a byte-prefix of the original: the
 * copy was cut mid-write) from an EDIT that shed bytes -- both are shorter
 * than recorded with a mismatched sha256. The honest discriminator is
 * STRUCTURAL: an interrupted copy is a valid PREFIX cut mid-structure, so
 *   - a `.json` surface file no longer parses as JSON, while
 *   - a `.jsonl` surface file loses its trailing newline (the ops-ledger
 *     interrupted-append law) or its final line no longer parses.
 * An edit that leaves the file structurally whole (it parses) is
 * tamper-shaped however many bytes it shed. Refusal fires either way; the
 * verdict label is the diagnostic.
 */
export function surfaceFileStructurallyComplete(sourcePath: string, text: string): boolean {
        if (sourcePath.endsWith('.jsonl')) {
                if (text !== '' && !text.endsWith('\n')) {
                        return false; // the trailing-newline law: an interrupted append never ends clean
                }
                const lines = text.split('\n').filter(line => line !== '');
                const last = lines[lines.length - 1];
                if (last === undefined) {
                        return true; // empty (or all-blank): structurally whole
                }
                try {
                        JSON.parse(last);
                        return true;
                } catch {
                        return false; // the final line is a partial cut
                }
        }
        try {
                JSON.parse(text);
                return true;
        } catch {
                return false;
        }
}

/** The surface a workspace-relative source path belongs to (fixed-file membership). */
export function surfaceOfSourcePath(sourcePath: string): SurfaceId | undefined {
        for (const def of SURFACES) {
                if (def.fixedFiles.includes(sourcePath)) {
                        return def.id;
                }
                if (def.dirFile !== undefined && sourcePath.startsWith(`${def.dirFile.dir}/`) && def.dirFile.pattern.test(sourcePath.slice(def.dirFile.dir.length + 1))) {
                        return def.id;
                }
        }
        return undefined;
}

// ---------------------------------------------------------------------------
// The per-surface counts (the census counting laws, contract-duplicated)
// ---------------------------------------------------------------------------

/** Counts array elements (tolerant: non-arrays count 0 -- the manifest reports, it does not repair). */
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

/** Parse error surface: a short, shape-safe capture (the sweep still scans the result). */
function parseErrorOf(err: unknown): string {
        return (err as Error).message;
}

/**
 * Counts one surface from its file contents (the census counting laws). The
 * input is the surface's present files (path -> text); the output is the
 * manifest's `counts` block: COUNTS ONLY, parse failures surface as
 * `parseError` (honest data, never faked counts).
 */
export function countSurface(surfaceId: SurfaceId, texts: ReadonlyMap<string, string>): Record<string, unknown> {
        switch (surfaceId) {
                case 'tasks': {
                        const text = texts.get(TASKS_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        try {
                                const envelope: unknown = JSON.parse(text);
                                return {
                                        taskCount: arrayLength(isPlainObject(envelope) ? envelope.tasks : undefined),
                                        eventCount: taskEventCount(envelope),
                                        statusCounts: taskStatusCounts(envelope),
                                };
                        } catch (err) {
                                return { parseError: parseErrorOf(err) };
                        }
                }
                case 'evidenceLedger': {
                        const text = texts.get(LEDGER_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        const rows: LedgerRowShape[] = [];
                        let firstParseError: string | undefined;
                        for (const [index, line] of splitJsonl(text).entries()) {
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
                        const counts: Record<string, unknown> = { rowCount: rows.length, kindCounts: ledgerKindCounts(rows) };
                        if (firstParseError !== undefined) {
                                counts.parseError = firstParseError;
                        }
                        return counts;
                }
                case 'evidenceWatermark': {
                        const text = texts.get(SIZE_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        try {
                                const parsed: unknown = JSON.parse(text);
                                const recordedRowCount = isPlainObject(parsed) && typeof parsed.rowCount === 'number' ? parsed.rowCount : undefined;
                                return recordedRowCount !== undefined ? { recordedRowCount } : { parseError: 'watermark carries no numeric rowCount' };
                        } catch (err) {
                                return { parseError: parseErrorOf(err) };
                        }
                }
                case 'resourcesGraph': {
                        const text = texts.get(RESOURCES_GRAPH_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        try {
                                const envelope: unknown = JSON.parse(text);
                                return {
                                        refCount: arrayLength(isPlainObject(envelope) ? envelope.nodes : undefined),
                                        edgeCount: arrayLength(isPlainObject(envelope) ? envelope.edges : undefined),
                                        surfaceCount: arrayLength(isPlainObject(envelope) ? envelope.surfaces : undefined),
                                };
                        } catch (err) {
                                return { parseError: parseErrorOf(err) };
                        }
                }
                case 'opsChain': {
                        const text = texts.get(RESOURCES_OPS_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        return { recordCount: splitJsonl(text).filter(line => line !== '').length };
                }
                case 'environmentsRegistry': {
                        const text = texts.get(ENVIRONMENTS_REGISTRY_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        try {
                                const registry: unknown = JSON.parse(text);
                                return { environmentCount: arrayLength(isPlainObject(registry) ? registry.environments : undefined) };
                        } catch (err) {
                                return { parseError: parseErrorOf(err) };
                        }
                }
                case 'browserSessions': {
                        const text = texts.get(BROWSER_SESSIONS_PATH);
                        if (text === undefined) {
                                return {};
                        }
                        return { recordCount: splitJsonl(text).filter(line => line !== '').length };
                }
                case 'workflows': {
                        const counts: Record<string, unknown> = {};
                        const indexText = texts.get(`${WORKFLOWS_DIR}/index.json`);
                        counts.indexPresent = indexText !== undefined;
                        const envelopeFiles = [...texts.keys()].filter(key => key.startsWith(`${WORKFLOWS_DIR}/`) && /^W-\d{3,}\.json$/.test(key.slice(WORKFLOWS_DIR.length + 1))).sort();
                        counts.envelopeCount = envelopeFiles.length;
                        if (envelopeFiles.length > 0) {
                                counts.envelopeIds = envelopeFiles.map(key => key.slice(WORKFLOWS_DIR.length + 1).replace(/\.json$/, ''));
                        }
                        return counts;
                }
                case 'orchestration': {
                        const counts: Record<string, unknown> = {};
                        const graphsText = texts.get(ORCH_GRAPHS_PATH);
                        if (graphsText !== undefined) {
                                try {
                                        const envelope: unknown = JSON.parse(graphsText);
                                        counts.graphCount = arrayLength(isPlainObject(envelope) ? envelope.graphs : undefined);
                                } catch {
                                        counts.graphCount = 0;
                                }
                        } else {
                                counts.graphCount = 0;
                        }
                        const journalText = texts.get(ORCH_JOURNAL_PATH);
                        counts.journalRowCount = journalText === undefined ? 0 : splitJsonl(journalText).filter(line => line !== '').length;
                        return counts;
                }
                case 'providerLanesState': {
                        const counts: Record<string, unknown> = {};
                        counts.providersFilePresent = texts.get(PROVIDERS_PATH) !== undefined;
                        const decisionsText = texts.get(ROUTING_DECISIONS_PATH);
                        counts.decisionRowCount = decisionsText === undefined ? 0 : splitJsonl(decisionsText).filter(line => line !== '').length;
                        return counts;
                }
        }
}
