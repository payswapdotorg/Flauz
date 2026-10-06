/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The pinned product state reader (A-PROD-006-W2, DL-87 law 2): the
 * version-inventory + census snapshot the acceptance record pins at launch
 * time, and the re-read the verify act compares it against.
 *
 * THE HONEST-DETECTION LAW (never assumption): the reading is derived from
 * the workspace's ACTUAL on-disk state through the contract-duplicated
 * surface registry + the version-source semantics of flauz-release's
 * versionInventory.ts (duplicated here, pinned by the contract suite):
 *
 *   - SELF-DECLARING files carry their version in-band: `.json` surface
 *     files declare `$schema` (or `schema`); `.jsonl` surface files declare
 *     it on EVERY row (the self-declaring journals).
 *   - CONTRACT-PINNED files self-declare nothing BY DESIGN: the evidence
 *     ledger (flauz.evidence.rows/v0) and the resources ops chain
 *     (flauz.resources-ops/v0) derive their version from the pinned row
 *     contract -- every line must parse as the owning row shape.
 *   - ANYTHING ELSE is unrecognized: a parse failure, a missing declaration,
 *     a torn file (a non-newline-terminated jsonl is a torn append). An
 *     unrecognized surface carries its `problem` verbatim -- the pin never
 *     guesses a version it could not read.
 *
 * THE PIN SEMANTICS (what verify compares, and what it deliberately does
 * NOT): the pin carries presence + sha256 + bytes + the detected format
 * version per file. The verify re-read compares PRESENCE + DETECTED VERSION
 * + PARSE CLEANLINESS -- never byte equality -- because the append-only
 * surfaces (the evidence ledger above all) LAWFULLY GROW after the launch:
 * byte growth is disclosed, never failed. A present file that goes absent,
 * a detected format version that changes, or a clean surface that tears --
 * those are the released-state regressions the receipt FAILS on.
 */

import {
        type AcceptanceFsPort,
        type PinnedCensusRow,
        type PinnedFileState,
        type PinnedProductState,
        type PinnedSurfaceState,
        type SurfaceDef,
        type SurfaceId,
        EVIDENCE_LEDGER_PATH,
        RESOURCES_OPS_PATH,
        SURFACES,
        isPlainObject,
        joinPath,
        parseLedgerLine,
        parseOpsLine,
        sha256Hex,
        splitJsonl,
        utf8ByteLength,
} from './api.ts';

// ---------------------------------------------------------------------------
// The per-file expected version (derived from the surface registry: the
// composite formatVersion split across the fixed files, in order -- the
// flauz-release versionInventory.ts semantics, contract-duplicated)
// ---------------------------------------------------------------------------

/**
 * The expected format version of ONE file of a surface: for composite-format
 * surfaces (orchestration, providerLanes) the fixed files align with the
 * ' + '-joined parts; every other file of the surface (the workflows
 * envelopes) carries the surface's single version.
 */
export function expectedFileVersion(def: SurfaceDef, sourcePath: string): string {
        const parts = def.formatVersion.split(' + ');
        if (parts.length === def.fixedFiles.length) {
                const index = def.fixedFiles.indexOf(sourcePath);
                if (index >= 0) {
                        return parts[index] ?? def.formatVersion;
                }
        }
        return def.formatVersion;
}

/** Reads the declared schema id of a parsed JSON object ($schema, then schema). */
function declaredSchemaOf(parsed: unknown): string | undefined {
        if (!isPlainObject(parsed)) {
                return undefined;
        }
        if (typeof parsed.$schema === 'string' && parsed.$schema.length > 0) {
                return parsed.$schema;
        }
        if (typeof parsed.schema === 'string' && parsed.schema.length > 0) {
                return parsed.schema;
        }
        return undefined;
}

/**
 * Reads ONE surface file's version (the flauz-release readFileVersion
 * semantics, contract-duplicated and pinned by the contract suite).
 *
 * `.json`: the parsed object's `$schema`/`schema` declaration. `.jsonl`: the
 * common declaration across every non-empty line (self-declaring journals),
 * or the pinned row contract (ledger + ops -- validated line-by-line by the
 * contract-duplicated parsers). An empty self-declaring journal carries no
 * declaration and no rows -- unrecognized (the version cannot be read); an
 * empty contract-pinned ledger is the valid zero-row v0.
 */
export async function readFileVersion(sourcePath: string, text: string | undefined): Promise<PinnedFileState> {
        if (text === undefined) {
                return { sourcePath, present: false };
        }
        const base: PinnedFileState = { sourcePath, present: true, sha256: sha256Hex(text), bytes: utf8ByteLength(text) };

        if (!sourcePath.endsWith('.jsonl')) {
                let parsed: unknown;
                try {
                        parsed = JSON.parse(text);
                } catch (err) {
                        return { ...base, problem: `does not parse as JSON (${(err as Error).message})` };
                }
                const declared = declaredSchemaOf(parsed);
                if (declared === undefined) {
                        return { ...base, problem: 'carries no $schema (or schema) declaration -- the format version cannot be read' };
                }
                return { ...base, detectedVersion: declared, declared: true };
        }

        // --- the .jsonl family: the trailing-newline law first (an interrupted append never ends clean) ---
        if (text !== '' && !text.endsWith('\n')) {
                return { ...base, problem: 'is torn (the file does not end with a newline -- an interrupted append never parses silently)' };
        }
        if (sourcePath === EVIDENCE_LEDGER_PATH || sourcePath === RESOURCES_OPS_PATH) {
                // the contract-pinned pair: the row contract IS the version
                const pinned = sourcePath === EVIDENCE_LEDGER_PATH ? 'flauz.evidence.rows/v0' : 'flauz.resources-ops/v0';
                for (const [index, line] of splitJsonl(text).entries()) {
                        if (line === '') {
                                return { ...base, problem: `line ${String(index + 1)} is empty` };
                        }
                        const outcome = sourcePath === EVIDENCE_LEDGER_PATH ? parseLedgerLine(line, index + 1) : parseOpsLine(line, index + 1);
                        if (!outcome.ok) {
                                return { ...base, problem: outcome.error };
                        }
                }
                return { ...base, detectedVersion: pinned, declared: false };
        }

        // the self-declaring journals: every non-empty line declares the same schema
        const lines = splitJsonl(text).filter(line => line !== '');
        if (lines.length === 0) {
                return { ...base, problem: 'carries no rows and no schema declaration -- the format version cannot be read' };
        }
        let version: string | undefined;
        for (const [index, line] of lines.entries()) {
                let parsed: unknown;
                try {
                        parsed = JSON.parse(line);
                } catch (err) {
                        return { ...base, problem: `line ${String(index + 1)} is not valid JSON (${(err as Error).message})` };
                }
                const declared = declaredSchemaOf(parsed);
                if (declared === undefined) {
                        return { ...base, problem: `line ${String(index + 1)} carries no $schema (or schema) declaration` };
                }
                if (version === undefined) {
                        version = declared;
                } else if (declared !== version) {
                        return { ...base, problem: `line ${String(index + 1)} declares ${JSON.stringify(declared)} but an earlier line declared ${JSON.stringify(version)} -- the file mixes formats` };
                }
        }
        return { ...base, detectedVersion: version, declared: true };
}

/**
 * Enumerates one surface's files (the flauz-release surfaces.ts enumeration
 * semantics, contract-duplicated): the fixed files in order + the workflows
 * envelopes (readdir + the pattern), deduplicated, sorted.
 */
export async function enumerateSurfaceFiles(def: SurfaceDef, root: string, fs: AcceptanceFsPort): Promise<readonly string[]> {
        const files: string[] = [];
        const seen = new Set<string>();
        for (const sourcePath of def.fixedFiles) {
                if (!seen.has(sourcePath)) {
                        seen.add(sourcePath);
                        files.push(sourcePath);
                }
        }
        if (def.dirFile !== undefined) {
                const entries = await fs.readdir(joinPath(root, def.dirFile.dir));
                if (entries !== undefined) {
                        for (const name of entries.filter(entry => def.dirFile !== undefined && def.dirFile.pattern.test(entry)).sort()) {
                                const sourcePath = joinPath(def.dirFile.dir, name);
                                if (!seen.has(sourcePath)) {
                                        seen.add(sourcePath);
                                        files.push(sourcePath);
                                }
                        }
                }
        }
        return files;
}

/**
 * The census row's path, mirroring the owning flauz-release census
 * convention EXACTLY (pinned by the contract suite's equivalence test):
 * the file-based surfaces carry their first fixed file; the dir-shaped
 * surfaces (workflows, orchestration, providerLanes) carry their owning
 * directory.
 */
function censusPathOf(def: SurfaceDef): string {
        if (def.id === 'workflows') {
                return '.flauz/workflows';
        }
        if (def.id === 'orchestration') {
                return '.flauz/orchestration';
        }
        if (def.id === 'providerLanesState') {
                return '.flauz/models';
        }
        return def.fixedFiles[0] ?? '';
}

/**
 * Reads the pinned product state in one pass: the version inventory (one
 * PinnedSurfaceState per surface, in census order) + the census snapshot
 * (one PinnedCensusRow per surface -- present + the primary path + the
 * honest summary fields: the first parse problem, the file count, the jsonl
 * row count).
 */
export async function readProductState(root: string, fs: AcceptanceFsPort): Promise<PinnedProductState> {
        const versionInventory: PinnedSurfaceState[] = [];
        const censusSnapshot: PinnedCensusRow[] = [];
        for (const def of SURFACES) {
                const files: PinnedFileState[] = [];
                let rowCount = 0;
                const sourcePaths = await enumerateSurfaceFiles(def, root, fs);
                for (const sourcePath of sourcePaths) {
                        const text = await fs.readFileUtf8(joinPath(root, sourcePath));
                        files.push(await readFileVersion(sourcePath, text));
                        if (sourcePath.endsWith('.jsonl') && text !== undefined) {
                                rowCount += splitJsonl(text).filter(line => line !== '').length;
                        }
                }
                // the census presence semantics: a surface is present when any of
                // its files is, or (workflows) when its enumerated dir exists even if empty
                let present = files.some(file => file.present);
                if (def.dirFile !== undefined) {
                        const dirEntries = await fs.readdir(joinPath(root, def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                        }
                }
                versionInventory.push({ surface: def.id, present, expectedVersion: def.formatVersion, files });
                const firstProblem = files.find(file => file.problem !== undefined);
                const censusRow: Record<string, unknown> = {
                        surface: def.id,
                        present,
                        path: censusPathOf(def),
                        fileCount: files.length,
                };
                if (firstProblem?.problem !== undefined) {
                        censusRow.parseError = `${firstProblem.sourcePath}: ${firstProblem.problem}`;
                }
                if (rowCount > 0) {
                        censusRow.rowCount = rowCount;
                }
                censusSnapshot.push(censusRow as PinnedCensusRow);
        }
        return { versionInventory, censusSnapshot };
}

/**
 * Re-reads the pinned product state the verify act compares (the fresh
 * reading; the comparison itself lives in verify.ts -- this is the same
 * reader the launch pinned with).
 */
export async function reReadProductState(root: string, fs: AcceptanceFsPort): Promise<PinnedProductState> {
        return readProductState(root, fs);
}

export type { SurfaceId };
