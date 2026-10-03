/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The per-surface format-version inventory (A-PROD-005-W1,
 * contract-duplicated from the W5 flauz-release versionInventory.ts, itself
 * duplicated from the W3 flauz-migration machinery -- the gate's
 * upgrade-compatibility row reads every surface's ACTUAL on-disk format
 * version and classifies identity/refusal the same way the W3 plan grammar
 * does).
 *
 * THE VERSION-SOURCE LAW (honest detection, never assumption):
 *
 *   - SELF-DECLARING files carry their version in-band: `.json` surface
 *     files declare `$schema` (or `schema`, the models family); `.jsonl`
 *     surface files declare it on EVERY row. The detected version is the
 *     declaration; a file whose declarations disagree with itself is
 *     unrecognized.
 *
 *   - CONTRACT-PINNED files self-declare nothing BY DESIGN: the evidence
 *     ledger (flauz.evidence.rows/v0) and the resources ops chain
 *     (flauz.resources-ops/v0) derive their version from the pinned row
 *     contract -- every line must parse as the owning row shape.
 *
 *   - ANYTHING ELSE is unrecognized: a parse failure, a missing declaration
 *     on a self-declaring format, a truncated file. An unrecognized surface
 *     is a refusal row naming the exact surface + file + problem -- the
 *     version is never guessed.
 */

import {
        type ProductionFsPort,
        type SurfaceDef,
        type SurfaceId,
        LEDGER_PATH,
        RESOURCES_OPS_PATH,
        isPlainObject,
        joinPath,
        sha256Hex,
        splitJsonl,
        utf8ByteLength,
        SURFACES,
} from './api.ts';
import { parseLedgerLine, parseOpsLine } from './verify.ts';

// ---------------------------------------------------------------------------
// The per-file expected version (derived from the surface registry)
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

// ---------------------------------------------------------------------------
// The per-file version readings
// ---------------------------------------------------------------------------

/** One file's version reading: presence, digest, the detected version (or the problem). */
export interface FileVersionReading {
        readonly sourcePath: string;
        readonly present: boolean;
        readonly sha256?: string;
        readonly bytes?: number;
        /** The detected format version (present files only; undefined = unrecognized). */
        readonly detectedVersion?: string;
        /** True when the version came from an in-band declaration (vs the pinned row contract). */
        readonly declared?: boolean;
        readonly problem?: string;
}

/** One surface's version reading: the per-file readings + the surface's expected version. */
export interface SurfaceVersionReading {
        readonly surface: SurfaceId;
        readonly present: boolean;
        readonly expectedVersion: string;
        readonly files: readonly FileVersionReading[];
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
 * Reads ONE surface file's version.
 *
 * `.json`: the parsed object's `$schema`/`schema` declaration. `.jsonl`: the
 * common declaration across every non-empty line (self-declaring journals),
 * or the pinned row contract (ledger + ops -- validated line-by-line by the
 * contract-duplicated parsers). An empty self-declaring journal carries no
 * declaration and no rows -- unrecognized; an empty contract-pinned ledger
 * is the valid zero-row v0.
 */
export async function readFileVersion(sourcePath: string, text: string | undefined): Promise<FileVersionReading> {
        if (text === undefined) {
                return { sourcePath, present: false };
        }
        const base: FileVersionReading = { sourcePath, present: true, sha256: sha256Hex(text), bytes: utf8ByteLength(text) };

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

        // --- the .jsonl family: the trailing-newline law first ---
        if (text !== '' && !text.endsWith('\n')) {
                return { ...base, problem: 'is torn (the file does not end with a newline -- an interrupted append never parses silently)' };
        }
        if (sourcePath === LEDGER_PATH || sourcePath === RESOURCES_OPS_PATH) {
                // the contract-pinned pair: the row contract IS the version
                const pinned = sourcePath === LEDGER_PATH ? 'flauz.evidence.rows/v0' : 'flauz.resources-ops/v0';
                for (const [index, line] of splitJsonl(text).entries()) {
                        if (line === '') {
                                return { ...base, problem: `line ${String(index + 1)} is empty` };
                        }
                        const outcome = sourcePath === LEDGER_PATH ? parseLedgerLine(line, index + 1) : parseOpsLine(line, index + 1);
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
 * Reads EVERY surface's version inventory in one pass (presence + sha256 +
 * bytes + detected version per file). The gate's upgrade-compatibility row
 * derives from this inventory.
 */
export async function readSurfaceVersions(root: string, fs: ProductionFsPort): Promise<readonly SurfaceVersionReading[]> {
        const out: SurfaceVersionReading[] = [];
        for (const def of SURFACES) {
                const files: FileVersionReading[] = [];
                for (const fixedPath of def.fixedFiles) {
                        const text = await fs.readFileUtf8(joinPath(root, fixedPath));
                        files.push(await readFileVersion(fixedPath, text));
                }
                // the census presence semantics: a surface is present when any of its
                // files is, or (workflows) when its enumerated dir exists even if empty
                let present = files.some(file => file.present);
                if (def.dirFile !== undefined) {
                        const dirEntries = await fs.readdir(joinPath(root, def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                        }
                }
                out.push({ surface: def.id, present, expectedVersion: def.formatVersion, files });
        }
        return out;
}

/** The per-surface readiness classification (the W3 plan grammar: identity/refusal, never a guess). */
export type SurfaceReadiness = 'identity' | 'absent' | 'refusal';

/** One surface's readiness row (the gate's upgrade-compatibility evidence). */
export interface ReadinessRow {
        readonly surface: SurfaceId;
        readonly readiness: SurfaceReadiness;
        readonly reason?: string;
}

/**
 * Classifies every surface's upgrade readiness: identity (the detected
 * version matches the expected), absent (honest), refusal (anything else --
 * unrecognized, mismatched, or mixed; with the empty transform registry
 * every mismatch refuses, the honest W3 scope).
 */
export function classifyReadings(readings: readonly SurfaceVersionReading[]): readonly ReadinessRow[] {
        return readings.map(reading => {
                if (!reading.present) {
                        return { surface: reading.surface, readiness: 'absent' as const };
                }
                const problems: string[] = [];
                let matched = true;
                for (const file of reading.files) {
                        if (!file.present) {
                                continue;
                        }
                        if (file.problem !== undefined) {
                                problems.push(`${file.sourcePath} ${file.problem}`);
                                matched = false;
                                continue;
                        }
                        const expected = expectedFileVersion(SURFACES.find(def => def.id === reading.surface) as SurfaceDef, file.sourcePath);
                        if (file.detectedVersion !== expected) {
                                problems.push(`${file.sourcePath} declares ${JSON.stringify(file.detectedVersion)} but the registry expects ${JSON.stringify(expected)} (the transform registry is EMPTY at this base -- every mismatch refuses)`);
                                matched = false;
                        }
                }
                return matched
                        ? { surface: reading.surface, readiness: 'identity' as const }
                        : { surface: reading.surface, readiness: 'refusal' as const, reason: problems.join('; ') };
        });
}
