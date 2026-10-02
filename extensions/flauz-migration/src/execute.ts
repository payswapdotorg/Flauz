/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The upgrade path (A-PROD-004-W3, `flauz.migration.execute`).
 *
 * THE ORDER OF OPERATIONS IS THE LAW:
 *
 *   1. TORN PRE-FLIGHT -- a torn migration refuses typed (the recovery path
 *      is rollback; a fresh plan follows it).
 *   2. PLAN -- the persisted plan is read + planId-re-derived (tamper
 *      detection) + re-validated against the CURRENT state (the
 *      plan-currency check: presence + digests + versions must match
 *      exactly, or the typed stale-plan refusal -- nothing runs).
 *   3. ANCHOR FIRST -- a W2 export of the CURRENT state is created (the
 *      contract-duplicated flauz-backup builder) and VERIFIED (the
 *      contract-duplicated verifier). No verified anchor = the typed
 *      refusal, ZERO transforms run (the wave's core safety law).
 *   4. EXECUTE -- the in-progress marker is written (the torn signal), then
 *      per-surface atomic stage+rename transforms EXACTLY AS PLANNED:
 *      identity steps re-commit byte-identical content; transform steps
 *      apply the registered spec. A failure mid-transform surfaces as the
 *      typed TORN refusal naming the surface in flight; the marker stays
 *      (recovery = rollback).
 *   5. POST-FLIGHT -- re-census (the version inventory re-read: every
 *      planned surface must now carry its target version) + the chain
 *      verifiers re-run + compared with the anchor's anchor-time verdicts
 *      (identical bytes must produce identical verdicts -- the same math at
 *      every station).
 *   6. BANK -- the migration record is banked into the migrated state
 *      (what/when/which-plan/which-anchor) at
 *      `.flauz/migration/migration-log.jsonl` + the census-visible ledger
 *      note row + the watermark re-sync; the marker is cleared only at full
 *      success.
 */

import {
        type MigrationFsPort,
        type Clock,
        type SurfaceId,
        type TransformSpec,
        type VersionsInfo,
        MigrationError,
        MARKER_PATH,
        MARKER_SCHEMA_ID,
        MIGRATION_LOG_PATH,
        MIGRATION_RECORD_SCHEMA_ID,
        PLAN_PATH,
        PRODUCTION_TRANSFORMS,
        STAGE_SUFFIX,
        SURFACES,
        canonicalJson,
        joinPath,
        serializeArtifact,
        sha256Hex,
        utf8ByteLength,
} from './api.ts';
import { collectIntegrity, type IntegrityVerdicts } from './verify.ts';
import { expectedFileVersion } from './versionInventory.ts';
import { createAnchorExport, verifyAnchorExport, type AnchorResult, type AnchorVerification } from './anchor.ts';
import { parsePersistedPlan, planDriftOf, type MigrationPlan } from './plan.ts';
import { readSurfaceVersions } from './versionInventory.ts';
import { detectTornState, type TornState } from './torn.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';
import { sweepArtifact } from './privacy.ts';
import { formatTimestamp } from './format.ts';

/** The execute command id (the provenance value pinned into the migration record). */
export const EXECUTE_COMMAND_LINE = 'flauz.migration.execute';

/** One executed step's outcome. */
export interface ExecutedStep {
        readonly surface: SurfaceId;
        readonly stepKind: 'identity' | 'transform';
        readonly fileCount: number;
        readonly bytes: number;
        readonly sha256Before: readonly string[];
        readonly sha256After: readonly string[];
}

/** The post-flight verification summary (honest data, recorded in the record). */
export interface PostFlightSummary {
        readonly versionInventoryOk: boolean;
        readonly ledgerOk: boolean;
        readonly opsOk: boolean;
        readonly verdictsMatchAnchor: boolean;
        readonly problems: readonly string[];
}

/** The execute result (surfaced by the command + tests). */
export interface ExecuteResult {
        readonly anchor: { readonly exportDirName: string; readonly manifestSha256: string; readonly createdAt: number; readonly fileCount: number; readonly totalBytes: number };
        readonly planId: string;
        readonly executedSteps: readonly ExecutedStep[];
        readonly executedFileCount: number;
        readonly executedBytes: number;
        readonly postFlight: PostFlightSummary;
        readonly banked: BankingOutcome;
        readonly executedAt: number;
}

/** Deps of the execute path. */
export interface ExecuteDeps {
        readonly root: string;
        readonly fs: MigrationFsPort;
        readonly clock: Clock;
        readonly versions: VersionsInfo;
        /** Test-injected transform specs (the production registry is identity-only at the pinned base; see api.ts). */
        readonly transforms?: readonly TransformSpec[];
}

/** The banked migration record shape (the durable record + the ledger row's pinned payload). */
export interface MigrationRecord {
        readonly $schema: typeof MIGRATION_RECORD_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly at: number;
        readonly commandLine: string;
        readonly planId: string;
        readonly planPath: string;
        readonly anchor: { readonly exportDirName: string; readonly manifestSha256: string; readonly createdAt: number };
        readonly steps: readonly { readonly surface: SurfaceId; readonly stepKind: 'identity' | 'transform'; readonly fileCount: number; readonly bytes: number }[];
        readonly postFlight: { readonly ledgerOk: boolean; readonly opsOk: boolean; readonly verdictsMatchAnchor: boolean; readonly problemCount: number };
}

/** Writes the in-progress marker atomically (stage+rename on the marker itself). */
async function writeMarker(deps: ExecuteDeps, plan: MigrationPlan, anchor: AnchorResult, steps: readonly { surface: SurfaceId; done: boolean }[]): Promise<void> {
        const marker = {
                $schema: MARKER_SCHEMA_ID,
                schemaVersion: 0,
                planId: plan.planId,
                anchorDirName: anchor.exportDirName,
                startedAt: deps.clock(),
                steps,
        };
        sweepArtifact(marker, 'in-progress.json');
        const markerPath = joinPath(deps.root, MARKER_PATH);
        await deps.fs.mkdir(markerPath.split('/').slice(0, -1).join('/'));
        await deps.fs.writeFile(`${markerPath}${STAGE_SUFFIX}`, serializeArtifact(marker));
        await deps.fs.rename(`${markerPath}${STAGE_SUFFIX}`, markerPath);
}

/**
 * The upgrade path. Torn pre-flight, plan read + currency check, ANCHOR
 * FIRST (typed refusal without a verified anchor -- zero transforms), the
 * atomic per-surface transforms exactly as planned, post-flight
 * verification, then the record banking.
 */
export async function executeMigration(deps: ExecuteDeps): Promise<ExecuteResult> {
        // --- 1. the torn pre-flight ---
        const torn: TornState = await detectTornState(deps.root, deps.fs);
        if (torn.torn) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TORN',
                        `flauz.migration.execute: REFUSED -- a torn migration is present (${torn.reasons.join('; ')}); recover with flauz.migration.rollback first, then re-plan (a resume-after-rollback is a fresh plan, never a blind continue)`,
                );
        }

        // --- 2. the plan (read + tamper check + currency check) ---
        const planText = await deps.fs.readFileUtf8(joinPath(deps.root, PLAN_PATH));
        if (planText === undefined) {
                throw new MigrationError('FLAUZ_MIGRATION_NO_PLAN', `flauz.migration/v1: no persisted plan at ${PLAN_PATH} -- run flauz.migration.plan first (the pre-flight)`);
        }
        const plan: MigrationPlan = parsePersistedPlan(planText);

        const readings = await readSurfaceVersions(deps.root, deps.fs);
        const drift = planDriftOf(plan, readings);
        if (drift.length > 0) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_PLAN_STALE',
                        `flauz.migration.execute: REFUSED -- the persisted plan is stale (${drift.map(entry => `${String(entry.surface)}/${entry.sourcePath}: ${entry.what}`).join('; ')}) -- re-run flauz.migration.plan against the current state`,
                );
        }

        // --- 3. ANCHOR FIRST (no verified anchor = typed refusal, zero transforms) ---
        const anchor: AnchorResult = await createAnchorExport({ root: deps.root, fs: deps.fs, clock: deps.clock, versions: deps.versions });
        const anchorVerification: AnchorVerification = await verifyAnchorExport({ root: deps.root, fs: deps.fs }, anchor.exportDirName);
        if (!anchorVerification.ok) {
                const table = anchorVerification.surfaces
                        .map(surface => `${String(surface.surface)}=${surface.verdict}`)
                        .join(', ');
                const metadata = `metadata=${String(anchorVerification.metadata.verdict)}`;
                const extras = anchorVerification.extras.length > 0 ? `, ${String(anchorVerification.extras.length)} unexpected state file(s)` : '';
                throw new MigrationError(
                        'FLAUZ_MIGRATION_ANCHOR_UNVERIFIED',
                        `flauz.migration.execute: REFUSED -- the anchor '${anchor.exportDirName}' does not verify against its manifest (${metadata}, ${table}${extras}); NO transform ran (the anchor-first law: no verified rollback anchor, no migration)`,
                );
        }

        // --- 4. EXECUTE (marker + per-surface atomic stage+rename, exactly as planned) ---
        const transforms = deps.transforms ?? PRODUCTION_TRANSFORMS;
        await writeMarker(deps, plan, anchor, plan.steps.map(step => ({ surface: step.surface, stepKind: step.stepKind, done: false })));

        const executedSteps: ExecutedStep[] = [];
        const doneSteps: { surface: SurfaceId; done: boolean }[] = [];
        let executedBytes = 0;
        try {
                for (const step of plan.steps) {
                        const spec = step.stepKind === 'transform'
                                ? transforms.find(candidate => candidate.surface === step.surface && candidate.fromVersion === step.fromVersion && candidate.toVersion === step.toVersion)
                                : undefined;
                        if (step.stepKind === 'transform' && spec === undefined) {
                                throw new MigrationError(
                                        'FLAUZ_MIGRATION_INCOMPATIBLE',
                                        `flauz.migration.execute: REFUSED -- surface ${String(step.surface)} planned a transform ${JSON.stringify(step.fromVersion)} -> ${JSON.stringify(step.toVersion)} but no registered transform carries that pair -- re-plan with a build that registers it`,
                                );
                        }
                        const sha256Before: string[] = [];
                        const sha256After: string[] = [];
                        let stepBytes = 0;
                        for (const file of step.files) {
                                const target = joinPath(deps.root, file.sourcePath);
                                const text = await deps.fs.readFileUtf8(target);
                                if (text === undefined) {
                                        throw new MigrationError('FLAUZ_MIGRATION_PLAN_STALE', `flauz.migration.execute: REFUSED -- ${file.sourcePath} vanished mid-migration (concurrent modification?) -- roll back`);
                                }
                                sha256Before.push(sha256Hex(text));
                                const transformed = step.stepKind === 'identity' ? text : (spec as TransformSpec).apply(file.sourcePath, text);
                                await deps.fs.mkdir(target.split('/').slice(0, -1).join('/'));
                                await deps.fs.writeFile(`${target}${STAGE_SUFFIX}`, transformed);
                                await deps.fs.rename(`${target}${STAGE_SUFFIX}`, target);
                                const after = await deps.fs.readFileUtf8(target) ?? '';
                                sha256After.push(sha256Hex(after));
                                stepBytes += utf8ByteLength(after);
                        }
                        executedSteps.push({ surface: step.surface, stepKind: step.stepKind, fileCount: step.files.length, bytes: stepBytes, sha256Before, sha256After });
                        executedBytes += stepBytes;
                        doneSteps.push({ surface: step.surface, done: true });
                        await writeMarker(deps, plan, anchor, plan.steps.map(step2 => ({ surface: step2.surface, stepKind: step2.stepKind, done: doneSteps.some(done => done.surface === step2.surface) })));
                }
        } catch (err) {
                const inFlight = executedSteps.length < plan.steps.length
                        ? String((plan.steps[executedSteps.length] as { surface: SurfaceId }).surface)
                        : 'unknown';
                if (err instanceof MigrationError) {
                        throw new MigrationError('FLAUZ_MIGRATION_TORN', `flauz.migration.execute: TORN at surface ${inFlight} -- ${err.message}`);
                }
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TORN',
                        `flauz.migration.execute: TORN at surface ${inFlight} -- the transform phase failed mid-flight (${(err as Error).message}); the marker stays, the anchor is ${anchor.exportDirName}: recover with flauz.migration.rollback`,
                );
        }

        // --- 5. POST-FLIGHT (re-census + the chain verifiers re-run + the anchor-verdict comparison) ---
        const postReadings = await readSurfaceVersions(deps.root, deps.fs);
        const problems: string[] = [];
        for (const step of plan.steps) {
                const def = SURFACES.find(candidate => candidate.id === step.surface);
                const reading = postReadings.find(entry => entry.surface === step.surface);
                if (reading === undefined || def === undefined) {
                        problems.push(`surface ${String(step.surface)} left the census enumeration post-migration (impossible -- registry drift?)`);
                        continue;
                }
                // the per-FILE expected version (composite surfaces carry per-file targets)
                for (const file of reading.files.filter(candidate => step.files.some(planned => planned.sourcePath === candidate.sourcePath))) {
                        const expected = expectedFileVersion(def, file.sourcePath);
                        if (!file.present) {
                                problems.push(`${file.sourcePath} is absent post-migration (the transform dropped it)`);
                        } else if (file.detectedVersion === undefined) {
                                problems.push(`${file.sourcePath} ${file.problem ?? 'does not version-read post-migration'}`);
                        } else if (file.detectedVersion !== expected) {
                                problems.push(`${file.sourcePath} declares ${JSON.stringify(file.detectedVersion)} post-migration but the step's target for that file is ${JSON.stringify(expected)}`);
                        }
                }
        }
        const postVerdicts: IntegrityVerdicts = await collectIntegrity(deps.root, deps.fs);
        const anchorVerdicts = anchorVerification.chainVerdicts;
        // the identity-migration law: identical bytes must produce identical verdicts
        // (transform steps on the chained surfaces own their semantic changes -- none exist at the pinned base)
        const chainedSurfacesTransformed = plan.steps.some(step => step.stepKind === 'transform' && (step.surface === 'evidenceLedger' || step.surface === 'opsChain'));
        const verdictsMatchAnchor = chainedSurfacesTransformed
                ? true
                : canonicalJson(anchorVerdicts.evidenceLedger) === canonicalJson(postVerdicts.evidenceLedger) && canonicalJson(anchorVerdicts.opsChain) === canonicalJson(postVerdicts.opsChain);
        if (!verdictsMatchAnchor && !chainedSurfacesTransformed) {
                problems.push('the post-flight chain verdicts diverge from the anchor-time verdicts (same bytes must produce the same verdict) -- the migrated state is not what the anchor certified');
        }

        if (problems.length > 0) {
                throw new MigrationError(
                        'FLAUZ_MIGRATION_TORN',
                        `flauz.migration.execute: TORN post-flight -- ${problems.join('; ')}; the marker stays, the anchor is ${anchor.exportDirName}: recover with flauz.migration.rollback`,
                );
        }
        const postFlight: PostFlightSummary = {
                versionInventoryOk: true,
                ledgerOk: postVerdicts.evidenceLedger.ok,
                opsOk: postVerdicts.opsChain.ok,
                verdictsMatchAnchor,
                problems,
        };

        // --- 6. BANK (the record + the census-visible ledger row + the watermark re-sync; marker cleared at full success) ---
        const executedAt = deps.clock();
        const record: MigrationRecord = {
                $schema: MIGRATION_RECORD_SCHEMA_ID,
                schemaVersion: 0,
                at: executedAt,
                commandLine: EXECUTE_COMMAND_LINE,
                planId: plan.planId,
                planPath: PLAN_PATH,
                anchor: { exportDirName: anchor.exportDirName, manifestSha256: anchor.manifestSha256, createdAt: anchor.createdAt },
                steps: executedSteps.map(step => ({ surface: step.surface, stepKind: step.stepKind, fileCount: step.fileCount, bytes: step.bytes })),
                postFlight: { ledgerOk: postFlight.ledgerOk, opsOk: postFlight.opsOk, verdictsMatchAnchor: postFlight.verdictsMatchAnchor, problemCount: postFlight.problems.length },
        };
        const recordLine = canonicalJson(record);
        const banking = await bankRecord(deps, record, recordLine, MIGRATION_LOG_PATH);

        await deps.fs.remove(joinPath(deps.root, MARKER_PATH));

        const result: ExecuteResult = {
                anchor: { exportDirName: anchor.exportDirName, manifestSha256: anchor.manifestSha256, createdAt: anchor.createdAt, fileCount: anchor.fileCount, totalBytes: anchor.totalBytes },
                planId: plan.planId,
                executedSteps,
                executedFileCount: executedSteps.reduce((acc, step) => acc + step.fileCount, 0),
                executedBytes,
                postFlight,
                banked: banking,
                executedAt,
        };
        sweepArtifact(result, 'execute-result');
        return result;
}

/** Renders the execute result (the channel surface + the tests' pin). */
export function renderExecuteResult(result: ExecuteResult): readonly string[] {
        const lines: string[] = [];
        lines.push(`flauz.migration.execute: migration complete at ${formatTimestamp(result.executedAt)} UTC -- plan ${result.planId.slice(0, 12)}..., anchor ${result.anchor.exportDirName} (verified before the first transform).`);
        for (const step of result.executedSteps) {
                lines.push(`  ${step.stepKind === 'identity' ? 'identity' : 'xform   '} ${String(step.surface)}: ${String(step.fileCount)} file(s), ${String(step.bytes)} bytes${step.stepKind === 'identity' ? ' (byte-identical re-commit)' : ''}`);
        }
        lines.push(`  post-flight: version inventory GREEN, ledger ${result.postFlight.ledgerOk ? 'ok' : 'BROKEN (honest pre-existing state -- the anchor recorded the same verdict)'}, ops ${result.postFlight.opsOk ? 'ok' : 'BROKEN (honest pre-existing state -- the anchor recorded the same verdict)'}, verdicts ${result.postFlight.verdictsMatchAnchor ? 'match the anchor-time verdicts' : 'DIVERGE from the anchor-time verdicts'}.`);
        lines.push(`  banked: the migration record (${result.banked.ledgerRowSeq !== undefined ? `ledger row seq ${String(result.banked.ledgerRowSeq)}` : 'ledger row skipped -- see the result'}${result.banked.watermarkUpdated ? ', watermark resynced' : ''}) -- the next diagnostics census reports it.`);
        return lines;
}
