/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The torn-migration detector (A-PROD-004-W5, contract-duplicated from the
 * W3 flauz-migration machinery -- the update check's FIRST pre-flight).
 *
 * THE TORN-MIGRATION LAW (the W3 law, consulted read-only here): a migration
 * interrupted mid-transform is DETECTABLE and RECOVERABLE. Three orthogonal
 * signals, each naming the EXACT surface:
 *
 *   1. THE IN-PROGRESS MARKER (`.flauz/migration/in-progress.json`): execute
 *      writes it after the anchor verifies and before the first transform,
 *      with the ordered per-surface step checklist; each completed surface
 *      is checked off by an atomic marker rewrite. A present marker with
 *      unchecked steps = torn (the first unchecked surface was in flight or
 *      next to run); all steps checked = the transforms completed but the
 *      banking was interrupted. The marker is removed ONLY at full success
 *      (or by rollback).
 *
 *   2. THE STAGE-FILE SCAN: a per-surface atomic stage+rename interrupted
 *      between staging and rename leaves a sibling
 *      `<file>.flauz-migration.tmp` under `.flauz/` -- the leftover names
 *      its surface exactly.
 *
 *   3. THE CONTENT READERS: a surface corrupted mid-structure (by an
 *      interrupted write of the OWNING service, or tampering) surfaces
 *      through the version readers / chain verifiers / counting laws with
 *      the exact surface + parse problem (the plan's typed refusals and the
 *      post-flight verification carry them).
 *
 * Signals 1 + 2 are this module; signal 3 lives in versionInventory.ts /
 * verify.ts / surfaces.ts and is surfaced by the update check's readiness
 * rows. The update check REFUSES while torn (the recovery path is
 * flauz.migration.rollback -- this extension never migrates, never rolls
 * back; the boundary law).
 */

import {
        type ReleaseFsPort,
        type SurfaceId,
        FLAUZ_DIR,
        MARKER_PATH,
        STAGE_SUFFIX,
        isPlainObject,
        joinPath,
} from './api.ts';
import { surfaceOfSourcePath } from './surfaces.ts';

/** The marker's step checklist row. */
export interface MarkerStep {
        readonly surface: SurfaceId;
        readonly stepKind: 'identity' | 'transform';
        readonly done: boolean;
}

/** The parsed in-progress marker (the torn state's own record). */
export interface MigrationMarker {
        readonly planId: string;
        readonly anchorDirName: string;
        readonly startedAt: number;
        readonly steps: readonly MarkerStep[];
}

/** The whole torn-detection result. */
export interface TornState {
        readonly torn: boolean;
        readonly markerPresent: boolean;
        readonly marker?: MigrationMarker;
        readonly markerProblem?: string;
        /** Stage leftovers: each names its surface exactly. */
        readonly stageLeftovers: readonly { readonly path: string; readonly surface: SurfaceId | undefined }[];
        /** The surfaces the signals pin as in-flight (the torn report's exact-surface law). */
        readonly inFlightSurfaces: readonly SurfaceId[];
        readonly reasons: readonly string[];
}

/** Parses the marker body (undefined + a problem when it does not parse as the marker shape). */
export function parseMarker(value: unknown): { marker?: MigrationMarker; problem?: string } {
        if (!isPlainObject(value)) {
                return { problem: 'the in-progress marker is not a JSON object' };
        }
        if (typeof value.planId !== 'string' || typeof value.anchorDirName !== 'string' || typeof value.startedAt !== 'number' || !Array.isArray(value.steps)) {
                return { problem: 'the in-progress marker does not carry the marker shape (planId/anchorDirName/startedAt/steps)' };
        }
        const steps: MarkerStep[] = [];
        for (const step of value.steps) {
                if (!isPlainObject(step) || typeof step.surface !== 'string' || typeof step.done !== 'boolean' || (step.stepKind !== 'identity' && step.stepKind !== 'transform')) {
                        return { problem: 'the in-progress marker carries a malformed step row' };
                }
                steps.push({ surface: step.surface as SurfaceId, stepKind: step.stepKind, done: step.done });
        }
        return { marker: { planId: value.planId, anchorDirName: value.anchorDirName, startedAt: value.startedAt, steps } };
}

/** Recursively lists every file under a dir, as root-relative paths. */
async function walkFilesUnder(fs: ReleaseFsPort, dir: string, prefix: string): Promise<string[]> {
        const entries = await fs.readdir(dir);
        if (entries === undefined) {
                return [];
        }
        const out: string[] = [];
        for (const entry of [...entries].sort()) {
                const rel = prefix === '' ? entry : `${prefix}/${entry}`;
                const sub = await walkFilesUnder(fs, joinPath(dir, entry), rel);
                if (sub.length > 0) {
                        out.push(...sub);
                } else {
                        out.push(rel);
                }
        }
        return out;
}

/**
 * Detects the torn state. Read-only: never writes, never repairs -- the
 * recovery path is flauz.migration.rollback (this extension consults the
 * signal; it never acts on it).
 */
export async function detectTornState(root: string, fs: ReleaseFsPort): Promise<TornState> {
        const reasons: string[] = [];
        const markerText = await fs.readFileUtf8(joinPath(root, MARKER_PATH));
        let markerPresent = false;
        let marker: MigrationMarker | undefined;
        let markerProblem: string | undefined;
        if (markerText !== undefined) {
                markerPresent = true;
                try {
                        const parsed = parseMarker(JSON.parse(markerText));
                        marker = parsed.marker;
                        markerProblem = parsed.problem;
                } catch (err) {
                        markerProblem = `the in-progress marker does not parse (${(err as Error).message})`;
                }
                if (marker !== undefined) {
                        const unchecked = marker.steps.filter(step => !step.done);
                        if (unchecked.length > 0) {
                                const first = unchecked[0] as MarkerStep;
                                reasons.push(`the in-progress marker (plan ${marker.planId.slice(0, 12)}..., anchor ${marker.anchorDirName}) carries ${String(unchecked.length)} unchecked step(s) -- ${String(first.surface)} was in flight or next to run`);
                        } else {
                                reasons.push(`the in-progress marker (plan ${marker.planId.slice(0, 12)}..., anchor ${marker.anchorDirName}) shows every transform complete -- the migration was interrupted between post-flight and record banking`);
                        }
                } else {
                        reasons.push(`the in-progress marker is present but unreadable (${markerProblem ?? 'malformed'})`);
                }
        }

        // the stage-file scan: a leftover names its surface exactly
        const stageLeftovers: { path: string; surface: SurfaceId | undefined }[] = [];
        const flauzFiles = await walkFilesUnder(fs, joinPath(root, FLAUZ_DIR), FLAUZ_DIR);
        for (const rel of flauzFiles) {
                if (rel.endsWith(STAGE_SUFFIX)) {
                        const surface = surfaceOfSourcePath(rel.slice(0, -STAGE_SUFFIX.length));
                        stageLeftovers.push({ path: rel, surface });
                        reasons.push(`a staged transform file was left behind: ${rel}${surface !== undefined ? ` (surface ${String(surface)})` : ''} -- the rename phase was interrupted`);
                }
        }

        const inFlight = new Set<SurfaceId>();
        if (marker !== undefined) {
                const unchecked = marker.steps.filter(step => !step.done);
                for (const step of unchecked) {
                        inFlight.add(step.surface);
                }
        }
        for (const leftover of stageLeftovers) {
                if (leftover.surface !== undefined) {
                        inFlight.add(leftover.surface);
                }
        }

        return {
                torn: markerPresent || stageLeftovers.length > 0,
                markerPresent,
                marker,
                markerProblem,
                stageLeftovers,
                inFlightSurfaces: [...inFlight],
                reasons,
        };
}

/** Renders the torn report (the exact-surface law: every line names its surface; the recovery pointer stays flauz.migration.rollback). */
export function renderTornReport(torn: TornState): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.migration: TORN MIGRATION DETECTED -- ${torn.reasons.length > 0 ? torn.reasons.join('; ') : 'an interrupted migration was found'}`);
        if (torn.inFlightSurfaces.length > 0) {
                lines.push(`  surface(s) in flight: ${torn.inFlightSurfaces.map(surface => String(surface)).join(', ')}`);
        }
        if (torn.marker !== undefined && torn.marker.anchorDirName !== undefined) {
                lines.push(`  the anchor recorded by the marker: ${torn.marker.anchorDirName} (verify + roll back with flauz.migration.rollback)`);
        }
        lines.push('  recovery: flauz.migration.rollback (verify-first restore from the anchor, byte-identical; a resume-after-rollback is a FRESH plan, never a blind continue)');
        return lines;
}
