/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The pre-flight migration plan (A-PROD-004-W3, `flauz.migration.plan`).
 *
 * THE PLAN LAW: census the CURRENT state (the W1 enumeration), read the
 * per-surface format versions (the W2 MANIFEST shape -- surface -> version,
 * from the ACTUAL on-disk declarations/contracts), verify version
 * compatibility against the formats this build targets (the registry), and
 * render + persist the migration PLAN:
 *
 *   - per-surface transform steps: IDENTITY for same-format surfaces, the
 *     EXPLICIT TRANSFORM for cross-format (resolved through the transform
 *     registry);
 *   - the surfaces that will not move (absent surfaces are listed absent,
 *     never faked);
 *   - the anchor requirement (execute creates + verifies a W2 export anchor
 *     of the CURRENT state before any transform);
 *   - the typed incompatibility refusals: a plan NEVER proceeds past an
 *     incompatible version -- it reports the exact surface + version pair
 *     and persists NOTHING (a refused plan cannot be executed).
 *
 * The persisted plan (`.flauz/migration/plan.json`) carries its own planId
 * (sha256 over the canonical body minus the id itself) -- execute re-derives
 * it to detect plan tampering, and re-runs the version inventory to detect
 * state drift (the plan-currency check): a stale plan is a typed refusal,
 * the operator re-plans.
 */

import {
        type MigrationFsPort,
        type Clock,
        type SurfaceId,
        type TransformSpec,
        type VersionsInfo,
        MigrationError,
        PLAN_PATH,
        PLAN_SCHEMA_ID,
        PRODUCTION_TRANSFORMS,
        SURFACES,
        canonicalJson,
        joinPath,
        serializeArtifact,
        sha256Hex,
} from './api.ts';
import { expectedFileVersion, readSurfaceVersions, type FileVersionReading, type SurfaceVersionReading } from './versionInventory.ts';
import { detectTornState } from './torn.ts';
import { sweepArtifact } from './privacy.ts';

/** One planned surface row: the inventory + the judgment. */
export interface PlanSurfaceRow {
        readonly surface: SurfaceId;
        readonly present: boolean;
        readonly expectedVersion: string;
        readonly detectedVersion: string | undefined;
        readonly stepKind: 'identity' | 'transform' | 'absent';
        readonly files: readonly PlanFileRow[];
}

/** One planned file row: presence + digest + the version reading. */
export interface PlanFileRow {
        readonly sourcePath: string;
        readonly present: boolean;
        readonly sha256?: string;
        readonly bytes?: number;
        readonly detectedVersion?: string;
        readonly declared?: boolean;
}

/** One execution step (the ordered transform plan; absent surfaces produce no step). */
export interface PlanStep {
        readonly surface: SurfaceId;
        readonly stepKind: 'identity' | 'transform';
        readonly fromVersion: string;
        readonly toVersion: string;
        readonly files: readonly { readonly sourcePath: string; readonly sha256: string; readonly bytes: number }[];
}

/** The persisted migration plan body (.flauz/migration/plan.json). */
export interface MigrationPlan {
        readonly $schema: typeof PLAN_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly createdAt: number;
        readonly productName: string;
        readonly productVersion: string;
        readonly workspaceRoot: string;
        /** The build the migration targets (its supported formats = the surface registry). */
        readonly target: { readonly productVersion: string; readonly extensions: readonly { readonly id: string; readonly version: string }[] };
        readonly planId: string;
        readonly surfaces: readonly PlanSurfaceRow[];
        readonly steps: readonly PlanStep[];
        readonly anchorRequirement: string;
}

/** The plan result (surfaced by the command + tests). */
export interface PlanResult {
        readonly planPath: string;
        readonly planId: string;
        readonly createdAt: number;
        readonly surfaceCount: number;
        readonly presentSurfaceCount: number;
        readonly identityStepCount: number;
        readonly transformStepCount: number;
        readonly absentSurfaceCount: number;
        readonly plannedFileCount: number;
        readonly plannedBytes: number;
}

/** Deps of the plan path. */
export interface PlanDeps {
        readonly root: string;
        readonly fs: MigrationFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** Test-injected transform specs (the production registry is identity-only at the pinned base; see api.ts). */
        readonly transforms?: readonly TransformSpec[];
}

const ANCHOR_REQUIREMENT = 'flauz.migration.execute creates + verifies a W2 export anchor of the CURRENT state (a verified .flauz-exports/export-<stamp>/) BEFORE the first transform; no verified anchor = typed refusal, zero transforms run';

/** The plan-currency drift report: what moved between the plan and the execute pre-flight. */
export interface PlanDrift {
        readonly surface: SurfaceId;
        readonly sourcePath: string;
        readonly what: string;
}

/**
 * Compares a fresh version inventory against a persisted plan (the
 * plan-currency check): presence, digests and detected versions must match
 * exactly, or the plan is stale.
 */
export function planDriftOf(plan: MigrationPlan, readings: readonly SurfaceVersionReading[]): PlanDrift[] {
        const drift: PlanDrift[] = [];
        const planBySurface = new Map(plan.surfaces.map(row => [row.surface, row]));
        const readingBySurface = new Map(readings.map(row => [row.surface, row]));
        for (const def of SURFACES) {
                const planned = planBySurface.get(def.id);
                const reading = readingBySurface.get(def.id);
                if (planned === undefined || reading === undefined) {
                        continue; // unreachable (both derive from the same registry); fail-closed elsewhere
                }
                const plannedFiles = new Map(planned.files.map(file => [file.sourcePath, file]));
                for (const file of reading.files) {
                        const was = plannedFiles.get(file.sourcePath);
                        if (was === undefined) {
                                continue;
                        }
                        if (was.present !== file.present) {
                                drift.push({ surface: def.id, sourcePath: file.sourcePath, what: file.present ? 'the file appeared after the plan was written' : 'the file vanished after the plan was written' });
                                continue;
                        }
                        if (file.present && was.present && file.sha256 !== was.sha256) {
                                drift.push({ surface: def.id, sourcePath: file.sourcePath, what: 'the file\'s bytes changed after the plan was written' });
                                continue;
                        }
                        if (file.detectedVersion !== was.detectedVersion) {
                                drift.push({ surface: def.id, sourcePath: file.sourcePath, what: `the file's format version changed after the plan was written (${String(was.detectedVersion)} -> ${String(file.detectedVersion)})` });
                        }
                }
        }
        return drift;
}

/** Re-derives a plan's id (sha256 over the canonical body minus the id itself). */
export function planIdOf(plan: Omit<MigrationPlan, 'planId'>): string {
        return sha256Hex(canonicalJson(plan));
}

/**
 * THE PRE-FLIGHT. Resolves every surface's step (identity / transform /
 * absent) against the transform registry, refuses typed on any
 * incompatibility (nothing persisted), then sweeps + persists the plan.
 */
export async function planMigration(deps: PlanDeps): Promise<PlanResult> {
        // --- the torn pre-flight: a torn migration must be rolled back before any new plan ---
        const torn = await detectTornState(deps.root, deps.fs);
        if (torn.torn) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TORN',
                        `flauz.migration.plan: REFUSED -- a torn migration is present (${torn.reasons.join('; ')}); recover with flauz.migration.rollback first, then re-plan (a resume-after-rollback is a fresh plan, never a blind continue)`,
                );
        }

        // --- census + version inventory ---
        const readings = await readSurfaceVersions(deps.root, deps.fs);
        const transforms = deps.transforms ?? PRODUCTION_TRANSFORMS;

        const rows: PlanSurfaceRow[] = [];
        const steps: PlanStep[] = [];
        for (const def of SURFACES) {
                const reading = readings.find(entry => entry.surface === def.id) as SurfaceVersionReading;
                const files: PlanFileRow[] = reading.files.map((file: FileVersionReading) => ({
                        sourcePath: file.sourcePath,
                        present: file.present,
                        ...(file.sha256 !== undefined ? { sha256: file.sha256 } : {}),
                        ...(file.bytes !== undefined ? { bytes: file.bytes } : {}),
                        ...(file.detectedVersion !== undefined ? { detectedVersion: file.detectedVersion } : {}),
                        ...(file.declared !== undefined ? { declared: file.declared } : {}),
                }));
                if (!reading.present) {
                        rows.push({ surface: def.id, present: false, expectedVersion: def.formatVersion, detectedVersion: undefined, stepKind: 'absent', files });
                        continue;
                }

                const presentFiles = reading.files.filter(file => file.present);
                const unrecognized = presentFiles.filter(file => file.detectedVersion === undefined);
                if (unrecognized.length > 0) {
                        throw new MigrationError(
                                'FLAUZ_MIGRATION_INCOMPATIBLE',
                                `flauz.migration.plan: REFUSED -- surface ${String(def.id)} carries content this build cannot version-read: ${unrecognized.map(file => `${file.sourcePath} ${file.problem ?? 'is unrecognized'}`).join('; ')} -- a plan NEVER proceeds past a version it cannot read; restore the surface (flauz.backup.restore) or bring a build that reads it`,
                        );
                }
                const mismatched = presentFiles.filter(file => file.detectedVersion !== expectedFileVersion(def, file.sourcePath));
                if (mismatched.length === 0) {
                        // the identity case: every present file already carries this build's format
                        rows.push({ surface: def.id, present: true, expectedVersion: def.formatVersion, detectedVersion: presentFiles.length === 0 ? undefined : expectedFileVersion(def, (presentFiles[0] as FileVersionReading).sourcePath), stepKind: 'identity', files });
                        steps.push({
                                surface: def.id,
                                stepKind: 'identity',
                                fromVersion: def.formatVersion,
                                toVersion: def.formatVersion,
                                files: presentFiles.map(file => ({ sourcePath: file.sourcePath, sha256: file.sha256 as string, bytes: file.bytes as number })),
                        });
                        continue;
                }

                // the cross-format case: one common declared version across the mismatched files, or a typed refusal
                const versions = new Set(mismatched.map(file => file.detectedVersion));
                if (versions.size !== 1) {
                        throw new MigrationError(
                                'FLAUZ_MIGRATION_INCOMPATIBLE',
                                `flauz.migration.plan: REFUSED -- surface ${String(def.id)} carries MIXED format versions (${[...versions].map(version => JSON.stringify(version)).join(' + ')} vs this build's target ${JSON.stringify(def.formatVersion)}): ${mismatched.map(file => `${file.sourcePath} declares ${JSON.stringify(file.detectedVersion)}`).join('; ')} -- a plan NEVER proceeds past an incompatible version`,
                        );
                }
                const fromVersion = [...versions][0] as string;
                const spec = transforms.find(candidate => candidate.surface === def.id && candidate.fromVersion === fromVersion && candidate.toVersion === def.formatVersion);
                if (spec === undefined) {
                        throw new MigrationError(
                                'FLAUZ_MIGRATION_INCOMPATIBLE',
                                `flauz.migration.plan: REFUSED -- surface ${String(def.id)} is at format version ${JSON.stringify(fromVersion)} but this build targets ${JSON.stringify(def.formatVersion)} and NO registered transform bridges that pair (${mismatched.map(file => file.sourcePath).join(', ')}) -- a plan NEVER proceeds past an incompatible version; bring a build that carries the transform`,
                        );
                }
                rows.push({ surface: def.id, present: true, expectedVersion: def.formatVersion, detectedVersion: fromVersion, stepKind: 'transform', files });
                steps.push({
                        surface: def.id,
                        stepKind: 'transform',
                        fromVersion,
                        toVersion: def.formatVersion,
                        files: presentFiles.map(file => ({ sourcePath: file.sourcePath, sha256: file.sha256 as string, bytes: file.bytes as number })),
                });
        }

        // --- compose + persist ---
        const createdAt = deps.clock();
        const body: Omit<MigrationPlan, 'planId'> = {
                $schema: PLAN_SCHEMA_ID,
                schemaVersion: 0,
                createdAt,
                productName: deps.versions.productName,
                productVersion: deps.versions.productVersion,
                workspaceRoot: deps.root,
                target: { productVersion: deps.versions.productVersion, extensions: deps.versions.extensions },
                surfaces: rows,
                steps,
                anchorRequirement: ANCHOR_REQUIREMENT,
        };
        const planId = planIdOf(body);
        const plan: MigrationPlan = { ...body, planId };
        sweepArtifact(plan, 'plan.json');

        const planPath = joinPath(deps.root, PLAN_PATH);
        await deps.fs.mkdir(planPath.split('/').slice(0, -1).join('/'));
        await deps.fs.writeFile(planPath, serializeArtifact(plan));

        const presentRows = rows.filter(row => row.present);
        return {
                planPath,
                planId,
                createdAt,
                surfaceCount: rows.length,
                presentSurfaceCount: presentRows.length,
                identityStepCount: steps.filter(step => step.stepKind === 'identity').length,
                transformStepCount: steps.filter(step => step.stepKind === 'transform').length,
                absentSurfaceCount: rows.length - presentRows.length,
                plannedFileCount: steps.reduce((acc, step) => acc + step.files.length, 0),
                plannedBytes: steps.reduce((acc, step) => acc + step.files.reduce((inner, file) => inner + file.bytes, 0), 0),
        };
}

/** The plan render (the `flauz.migration.plan` channel surface + the tests' pin). */
export function renderPlan(plan: MigrationPlan): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.migration.plan: the workspace migration plan (planId ${plan.planId.slice(0, 12)}..., persisted at ${PLAN_PATH})`);
        lines.push(`  target: ${plan.productName} ${plan.productVersion} -- this build's supported durable-state formats (the surface registry)`);
        lines.push(`  anchor requirement: ${plan.anchorRequirement}`);
        lines.push(`  surface inventory (the census enumeration, ${String(plan.surfaces.length)} row(s)):`);
        for (const row of plan.surfaces) {
                if (!row.present) {
                        lines.push(`    [ABSENT  ] ${String(row.surface)} (${row.expectedVersion}): will not move -- listed absent, never faked`);
                } else if (row.stepKind === 'identity') {
                        lines.push(`    [identity] ${String(row.surface)} (${row.expectedVersion} -> ${row.expectedVersion}): ${String(row.files.filter(file => file.present).length)} file(s), re-committed byte-identically through the atomic stage+rename`);
                } else {
                        lines.push(`    [xform  ] ${String(row.surface)} (${String(row.detectedVersion)} -> ${row.expectedVersion}): ${String(row.files.filter(file => file.present).length)} file(s), the explicit registered transform`);
                }
        }
        lines.push(`  steps: ${String(plan.steps.length)} (${String(plan.steps.filter(step => step.stepKind === 'identity').length)} identity, ${String(plan.steps.filter(step => step.stepKind === 'transform').length)} transform); ${String(plan.surfaces.filter(row => !row.present).length)} absent surface(s) will not move`);
        lines.push('  privacy law: durable-state CONTENTS legitimately transit (the anchor\'s state/ copy, the transformed files); the metadata surfaces (this plan, the records, the renders) carry counts, hashes, paths and ids only, swept for secret-shaped values before write.');
        return lines;
}

/** Parses + validates a persisted plan (typed refusals: FORMAT when malformed, PLAN_STALE when the id does not re-derive). */
export function parsePersistedPlan(text: string): MigrationPlan {
        let parsed: unknown;
        try {
                parsed = JSON.parse(text);
        } catch (err) {
                throw new MigrationError('FLAUZ_MIGRATION_FORMAT', `flauz.migration/v1: the persisted plan does not parse as JSON (${(err as Error).message})`);
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                throw new MigrationError('FLAUZ_MIGRATION_FORMAT', 'flauz.migration/v1: the persisted plan is not a JSON object');
        }
        const record = parsed as Record<string, unknown>;
        const { planId, ...rest } = record;
        if (typeof planId !== 'string') {
                throw new MigrationError('FLAUZ_MIGRATION_FORMAT', 'flauz.migration/v1: the persisted plan carries no planId');
        }
        const body = rest as unknown as Omit<MigrationPlan, 'planId'>;
        const recomputed = planIdOf(body);
        if (recomputed !== planId) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_PLAN_STALE',
                        `flauz.migration/v1: the persisted plan's planId does not re-derive (recorded ${planId.slice(0, 12)}... vs recomputed ${recomputed.slice(0, 12)}...) -- the plan was edited after it was written; re-run flauz.migration.plan`,
                );
        }
        return { ...body, planId };
}
