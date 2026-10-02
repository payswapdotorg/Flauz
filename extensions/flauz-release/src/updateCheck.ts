/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The pre-update gate (A-PROD-004-W5 -- the install/update reliability
 * plane's PRE-FLIGHT): censuses the CURRENT state, reads the CURRENT
 * per-surface format versions, and reports the update readiness.
 *
 * THE NEVER-UPDATES LAW: this command NEVER performs the update -- it reads,
 * classifies, and refuses. The migration itself stays in flauz-migration's
 * hands (the boundary law: flauz.migration.plan / execute / rollback own the
 * transform path; this gate is the operator's pre-flight only). It writes
 * NOTHING: no plan is persisted, no anchor is cut, no marker is touched.
 *
 * THE READINESS GRAMMAR (the W3 plan grammar, mirrored read-only):
 *
 *   identity  -- every present file of the surface already carries the
 *                registry's expected format version (the migration step
 *                would be a byte-identical re-commit);
 *   transform -- the surface's mismatched files share ONE declared version
 *                AND a bridging transform exists for (surface, from, to).
 *                THE HONEST SCOPE: the production transform registry at the
 *                pinned base is EMPTY (the W3 PRODUCTION_TRANSFORMS law --
 *                zero shipped transforms), so a version mismatch is a
 *                refusal in the shipped product; tests inject fixture
 *                transforms to exercise the transform class;
 *   refusal   -- any surface that cannot migrate safely: an unrecognized
 *                version (unreadable/torn/mixed), a mixed-version surface,
 *                or a mismatch no transform bridges -- the exact
 *                FLAUZ_MIGRATION_INCOMPATIBLE semantics, re-derived;
 *   absent    -- the surface is absent in this workspace (no step, honest).
 *
 * THE ANCHOR DRY-RUN (the W2 machinery, dry): enumerates EXACTLY what an
 * anchor would copy (the same enumeration createSelfExport acts on), lists
 * the existing anchors, and reports feasibility. Feasibility is the W3 law:
 * an anchor cannot be cut over a TORN state (the update check's first
 * pre-flight is the torn detector -- a torn state is the typed refusal
 * condition that routes to flauz.migration.rollback).
 */

import {
        type Clock,
        type ReleaseFsPort,
        type SurfaceDef,
        type SurfaceId,
        type VersionsInfo,
        SURFACES,
        joinPath,
        utf8ByteLength,
} from './api.ts';
import { type SurfaceVersionReading, readSurfaceVersions, expectedFileVersion } from './versionInventory.ts';
import { detectTornState, renderTornReport, type TornState } from './torn.ts';
import { enumerateSurfaces } from './surfaces.ts';
import { listExportDirs } from './selfExport.ts';

// ---------------------------------------------------------------------------
// The transform registry (the W3 grammar, mirrored)
// ---------------------------------------------------------------------------

/** One bridging transform (the W3 TransformSpec minus the apply function -- the pre-flight classifies, it never applies). */
export interface TransformSpec {
        readonly surface: SurfaceId;
        readonly fromVersion: string;
        readonly toVersion: string;
}

/**
 * The production transform registry -- EMPTY at the pinned base, mirroring
 * the W3 PRODUCTION_TRANSFORMS law (zero shipped transforms; the honest
 * scope). A mismatched surface is a REFUSAL in the shipped product until a
 * transform ships in flauz-migration.
 */
export const PRODUCTION_TRANSFORMS: readonly TransformSpec[] = [];

// ---------------------------------------------------------------------------
// The readiness matrix
// ---------------------------------------------------------------------------

/** One surface's update readiness. */
export type SurfaceReadiness = 'identity' | 'transform' | 'refusal' | 'absent';

/** One readiness row (the report's unit). */
export interface ReadinessRow {
        readonly surface: SurfaceId;
        readonly present: boolean;
        readonly expectedVersion: string;
        readonly detectedVersion?: string;
        readonly readiness: SurfaceReadiness;
        readonly fromVersion?: string;
        readonly toVersion?: string;
        readonly reasons: readonly string[];
}

/**
 * Classifies one surface's reading (the W3 plan step derivation, mirrored
 * read-only): absent; identity when every present file matches its expected
 * version; transform when the mismatched files share one version AND a
 * bridging spec exists; refusal otherwise (unrecognized / mixed / no
 * bridge).
 */
export function classifySurface(def: SurfaceDef, reading: SurfaceVersionReading, transforms: readonly TransformSpec[]): ReadinessRow {
        const reasons: string[] = [];
        if (!reading.present) {
                return { surface: def.id, present: false, expectedVersion: def.formatVersion, readiness: 'absent', reasons: [] };
        }
        const presentFiles = reading.files.filter(file => file.present);
        const unrecognized = presentFiles.filter(file => file.detectedVersion === undefined);
        if (unrecognized.length > 0) {
                for (const file of unrecognized) {
                        reasons.push(`${file.sourcePath}: ${file.problem ?? 'the format version cannot be read'}`);
                }
                return { surface: def.id, present: true, expectedVersion: def.formatVersion, readiness: 'refusal', reasons };
        }
        const mismatched = presentFiles.filter(file => file.detectedVersion !== expectedFileVersion(def, file.sourcePath));
        if (mismatched.length === 0) {
                return { surface: def.id, present: true, expectedVersion: def.formatVersion, detectedVersion: expectedFileVersion(def, (presentFiles[0] as { readonly sourcePath: string }).sourcePath), readiness: 'identity', reasons: [] };
        }
        const fromVersions = [...new Set(mismatched.map(file => file.detectedVersion as string))];
        if (fromVersions.length !== 1) {
                reasons.push(`the surface's files mix format versions (${fromVersions.map(version => JSON.stringify(version)).join(', ')}) -- a migration step must bridge ONE declared version`);
                return { surface: def.id, present: true, expectedVersion: def.formatVersion, readiness: 'refusal', reasons };
        }
        const fromVersion = fromVersions[0] as string;
        const bridging = transforms.find(spec => spec.surface === def.id && spec.fromVersion === fromVersion && spec.toVersion === def.formatVersion);
        if (bridging === undefined) {
                reasons.push(`no bridging transform exists for (${String(def.id)}, ${JSON.stringify(fromVersion)} -> ${JSON.stringify(def.formatVersion)}) -- the surface cannot migrate safely (the production transform registry is empty at this base)`);
                return { surface: def.id, present: true, expectedVersion: def.formatVersion, detectedVersion: fromVersion, readiness: 'refusal', reasons };
        }
        return { surface: def.id, present: true, expectedVersion: def.formatVersion, detectedVersion: fromVersion, readiness: 'transform', fromVersion, toVersion: def.formatVersion, reasons: [] };
}

// ---------------------------------------------------------------------------
// The anchor dry-run
// ---------------------------------------------------------------------------

/** The anchor dry-run result (the W2 machinery, dry -- nothing is written). */
export interface AnchorDryRun {
        readonly feasible: boolean;
        readonly reasons: readonly string[];
        readonly surfaceCount: number;
        readonly presentSurfaceCount: number;
        readonly plannedFileCount: number;
        readonly plannedBytes: number;
        readonly existingAnchors: readonly string[];
}

/**
 * The anchor dry-run: enumerates exactly what an anchor would copy (the same
 * enumeration the W2 export machinery acts on), lists the existing anchors,
 * and reports feasibility (the W3 law: no anchor over a torn state).
 */
export async function dryRunAnchor(root: string, fs: ReleaseFsPort, torn: TornState): Promise<AnchorDryRun> {
        const enumerations = await enumerateSurfaces(root, fs);
        let presentSurfaceCount = 0;
        let plannedFileCount = 0;
        let plannedBytes = 0;
        for (const enumeration of enumerations) {
                let present = false;
                for (const file of enumeration.files) {
                        const text = await fs.readFileUtf8(joinPath(root, file.sourcePath));
                        if (text !== undefined) {
                                present = true;
                                plannedFileCount += 1;
                                plannedBytes += utf8ByteLength(text);
                        }
                }
                if (enumeration.def.dirFile !== undefined) {
                        const dirEntries = await fs.readdir(joinPath(root, enumeration.def.dirFile.dir));
                        if (dirEntries !== undefined) {
                                present = true;
                        }
                }
                if (present) {
                        presentSurfaceCount += 1;
                }
        }
        const existingAnchors = await listExportDirs(root, fs);
        return {
                feasible: !torn.torn,
                reasons: torn.reasons,
                surfaceCount: enumerations.length,
                presentSurfaceCount,
                plannedFileCount,
                plannedBytes,
                existingAnchors,
        };
}

// ---------------------------------------------------------------------------
// The whole pre-update gate
// ---------------------------------------------------------------------------

/** The whole update-readiness result. */
export interface UpdateReadiness {
        readonly ok: boolean;
        readonly createdAt: number;
        readonly torn: TornState;
        /** The readiness matrix (empty when the torn pre-flight refused -- the W3 plan semantics). */
        readonly surfaces: readonly ReadinessRow[];
        readonly anchor: AnchorDryRun;
        /** The top-level typed refusal conditions (torn state; the refusal surfaces are carried by the rows). */
        readonly refusalReasons: readonly string[];
}

/** Deps of the pre-update gate. */
export interface UpdateCheckDeps {
        readonly root: string;
        readonly fs: ReleaseFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** Test-injected transforms (default: the empty production registry -- the honest scope). */
        readonly transforms?: readonly TransformSpec[];
}

/**
 * Runs the pre-update gate. READ-ONLY: no plan is persisted, no anchor is
 * cut, no marker is touched -- the update itself NEVER happens here (the
 * boundary law). A torn state refuses the whole gate (the W3 plan
 * semantics; the recovery path is flauz.migration.rollback).
 */
export async function checkUpdateReadiness(deps: UpdateCheckDeps): Promise<UpdateReadiness> {
        const createdAt = deps.clock();
        const torn = await detectTornState(deps.root, deps.fs);
        const transforms = deps.transforms ?? PRODUCTION_TRANSFORMS;
        if (torn.torn) {
                const anchor = await dryRunAnchor(deps.root, deps.fs, torn);
                return {
                        ok: false,
                        createdAt,
                        torn,
                        surfaces: [],
                        anchor: { ...anchor, feasible: false },
                        refusalReasons: [
                                'the workspace carries a TORN migration state -- the update pre-flight refuses (the W3 plan semantics); recovery is flauz.migration.rollback, never a blind continue',
                                ...torn.reasons,
                        ],
                };
        }
        const readings = await readSurfaceVersions(deps.root, deps.fs);
        const byId = new Map(SURFACES.map(def => [def.id, def] as const));
        const rows: ReadinessRow[] = [];
        for (const reading of readings) {
                const def = byId.get(reading.surface);
                if (def === undefined) {
                        continue; // unreachable: the readings enumerate the same registry
                }
                rows.push(classifySurface(def, reading, transforms));
        }
        const anchor = await dryRunAnchor(deps.root, deps.fs, torn);
        const refusalRows = rows.filter(row => row.readiness === 'refusal');
        const refusalReasons = refusalRows.map(row => `${String(row.surface)} cannot migrate safely: ${row.reasons.join('; ')}`);
        return {
                ok: refusalRows.length === 0 && anchor.feasible,
                createdAt,
                torn,
                surfaces: rows,
                anchor,
                refusalReasons,
        };
}

/** Renders the update readiness (the `flauz.release.updateCheck` channel surface). */
export function renderUpdateReadiness(readiness: UpdateReadiness): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.release.updateCheck: the pre-update gate -- verdict ${readiness.ok ? 'READY' : 'NOT-READY'} (NEVER performs the update; the migration itself stays in flauz-migration's hands)`);
        lines.push(`  torn pre-flight (the W3 signals): ${readiness.torn.torn ? 'TORN' : 'clean'}`);
        if (readiness.torn.torn) {
                lines.push(...renderTornReport(readiness.torn).map(line => `  ${line}`));
        }
        lines.push('  migration readiness (the W3 plan grammar, read-only):');
        for (const row of readiness.surfaces) {
                const target = row.readiness === 'transform' ? ` (${JSON.stringify(row.fromVersion)} -> ${JSON.stringify(row.toVersion)})` : row.readiness === 'identity' ? ` (${row.expectedVersion})` : '';
                const summary = row.reasons.length > 0 ? ` -- ${row.reasons.join('; ')}` : '';
                lines.push(`    ${row.readiness.padEnd(9)} ${String(row.surface)}${target}${summary}`);
        }
        lines.push(`  anchor dry-run (the W2 machinery, dry -- nothing is written): ${readiness.anchor.feasible ? 'FEASIBLE' : 'NOT FEASIBLE'} -- ${String(readiness.anchor.presentSurfaceCount)}/${String(readiness.anchor.surfaceCount)} present surface(s), ${String(readiness.anchor.plannedFileCount)} file(s), ${String(readiness.anchor.plannedBytes)} bytes; existing anchor(s): ${readiness.anchor.existingAnchors.length > 0 ? readiness.anchor.existingAnchors.join(', ') : 'none'}`);
        if (readiness.refusalReasons.length > 0) {
                lines.push('  typed refusal conditions:');
                for (const reason of readiness.refusalReasons) {
                        lines.push(`    - ${reason}`);
                }
        }
        return lines;
}
