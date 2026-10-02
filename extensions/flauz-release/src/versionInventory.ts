/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The per-surface format-version inventory (A-PROD-004-W5,
 * contract-duplicated from the W3 flauz-migration machinery -- the update
 * check's readiness matrix reads every surface's ACTUAL on-disk format
 * version, in the W2 MANIFEST's per-surface format-version shape (surface
 * -> version), for the migration-readiness classification).
 *
 * THE VERSION-SOURCE LAW (honest detection, never assumption):
 *
 *   - SELF-DECLARING files carry their version in-band: `.json` surface
 *     files declare `$schema` (or `schema`, the models family); `.jsonl`
 *     surface files declare it on EVERY row (the orchestration journal, the
 *     browser-session journal, the routing decisions, the provider
 *     switches). The detected version is the declaration; a file whose
 *     declarations disagree with itself is unrecognized.
 *
 *   - CONTRACT-PINNED files self-declare nothing BY DESIGN: the evidence
 *     ledger (flauz.evidence.rows/v0) and the resources ops chain
 *     (flauz.resources-ops/v0) derive their version from the pinned row
 *     contract -- every line must parse as the owning row shape (the
 *     flauz-backup api.ts law: "the ledger file self-declares no $schema;
 *     the pinned row contract is the version").
 *
 *   - ANYTHING ELSE is unrecognized: a parse failure, a missing declaration
 *     on a self-declaring format, a truncated file. An unrecognized surface
 *     is a refusal row naming the exact surface + file + problem -- the
 *     update check never guesses a version it could not read (the W3 plan
 *     grammar's FLAUZ_MIGRATION_INCOMPATIBLE semantics, re-derived here).
 */

import {
        type ReleaseFsPort,
        type SurfaceDef,
        type SurfaceId,
        LEDGER_PATH,
        RESOURCES_OPS_PATH,
        isPlainObject,
        joinPath,
        sha256Hex,
        splitJsonl,
        utf8ByteLength,
} from './api.ts';
import { parseLedgerLine, parseOpsLine } from './verify.ts';
import { enumerateSurfaces } from './surfaces.ts';

// ---------------------------------------------------------------------------
// The per-file expected version (derived from the surface registry: the
// composite formatVersion split across the fixed files, in order)
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
 * declaration and no rows -- unrecognized (the version cannot be read); an
 * empty contract-pinned ledger is the valid zero-row v0.
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

        // --- the .jsonl family: the trailing-newline law first (an interrupted append never ends clean;
        //     the owning ops-ledger law, surfaceFileStructurallyComplete's jsonl branch) ---
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
 * bytes + detected version per file). The plan's compat matrix and the
 * execute path's plan-currency check both derive from this inventory.
 */
export async function readSurfaceVersions(root: string, fs: ReleaseFsPort): Promise<readonly SurfaceVersionReading[]> {
        const enumerations = await enumerateSurfaces(root, fs);
        const out: SurfaceVersionReading[] = [];
        for (const enumeration of enumerations) {
                const files: FileVersionReading[] = [];
                for (const file of enumeration.files) {
                        const text = await fs.readFileUtf8(joinPath(root, file.sourcePath));
                        files.push(await readFileVersion(file.sourcePath, text));
                }
                // the census presence semantics: a surface is present when any of its
                // files is, or (workflows) when its enumerated dir exists even if empty
                let present = files.some(file => file.present);
                if (enumeration.def.dirFile !== undefined) {
                        const dirEntries = await fs.readdir(joinPath(root, enumeration.def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                        }
                }
                out.push({ surface: enumeration.def.id, present, expectedVersion: enumeration.def.formatVersion, files });
        }
        return out;
}
