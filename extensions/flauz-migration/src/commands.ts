/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.migration.*` command surface (A-PROD-004-W3).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock,
 * versions) is a port wired by the extension layer or injected by tests;
 * command args never carry code.
 *
 * THE DISCLOSURE LAW (the W1/W2 precedent): `flauz.migration.plan` renders
 * the WHOLE plan (the per-surface inventory, the step kinds, the anchor
 * requirement) before anything is transformed; the typed refusals (torn,
 * incompatible, stale, unverified-anchor, tampered) carry the full detail so
 * the operator sees the gate, not a wall.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type MigrationFsPort,
        type Clock,
        type OutputChannelPort,
        type VersionsInfo,
        MigrationError,
} from './api.ts';
import { planMigration, renderPlan, parsePersistedPlan, type PlanResult } from './plan.ts';
import { executeMigration, renderExecuteResult, type ExecuteResult } from './execute.ts';
import { rollbackMigration, renderRollbackResult, type RollbackResult } from './rollback.ts';
import { renderTornReport, detectTornState } from './torn.ts';

export const COMMAND_IDS = ['flauz.migration.plan', 'flauz.migration.execute', 'flauz.migration.rollback'] as const;
export type MigrationCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-memory services pattern). */
export interface MigrationCommandServices {
        readonly fs: MigrationFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        readonly versions: () => VersionsInfo;
}

/** Parses the anchor reference argument ({ anchor } | 'name' | undefined). */
function parseAnchorArg(arg: unknown): string | undefined {
        if (arg === undefined || arg === null) {
                return undefined;
        }
        if (typeof arg === 'string') {
                return arg;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                if (record.anchor === undefined || record.anchor === null) {
                        return undefined;
                }
                if (typeof record.anchor === 'string') {
                        return record.anchor;
                }
        }
        throw new MigrationError('FLAUZ_MIGRATION_ANCHOR_NOT_FOUND', 'flauz.migration.rollback: the \'anchor\' argument must be an export directory name (or omit it to roll back the most recent migration\'s anchor)');
}

/** Parses the overwrite consent argument ({ overwrite: boolean }). */
function parseOverwriteArg(arg: unknown): boolean {
        if (arg === undefined || arg === null) {
                return false;
        }
        if (typeof arg === 'object' && !Array.isArray(arg)) {
                const record = arg as Record<string, unknown>;
                if (record.overwrite === undefined) {
                        return false;
                }
                if (typeof record.overwrite === 'boolean') {
                        return record.overwrite;
                }
        }
        throw new MigrationError('FLAUZ_MIGRATION_TARGET_NOT_EMPTY', 'flauz.migration.rollback: the \'overwrite\' argument must be a boolean (true is the explicit overwrite consent for non-empty target surfaces)');
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof MigrationError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type MigrationHandler = (arg: unknown) => Promise<unknown>;

export function registerMigrationCommands(services: MigrationCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<MigrationCommandId, MigrationHandler> = {
                'flauz.migration.plan': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.migration.plan: no workspace folder open -- the durable .flauz/ state is inactive, nothing to plan.');
                                return { ok: false, code: 'FLAUZ_MIGRATION_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.migration.plan: the pre-flight -- census the current state, read the per-surface format versions, judge compatibility against this build\'s formats.');
                        try {
                                const result: PlanResult = await planMigration({
                                        root,
                                        fs: services.fs,
                                        clock: services.clock,
                                        versions: services.versions(),
                                });
                                const planText = await services.fs.readFileUtf8(`${root}/.flauz/migration/plan.json`);
                                if (planText !== undefined) {
                                        for (const line of renderPlan(parsePersistedPlan(planText))) {
                                                services.channel.appendLine(line);
                                        }
                                }
                                return { ok: true, planId: result.planId, planPath: result.planPath, surfaceCount: result.surfaceCount, presentSurfaceCount: result.presentSurfaceCount, identityStepCount: result.identityStepCount, transformStepCount: result.transformStepCount, absentSurfaceCount: result.absentSurfaceCount, plannedFileCount: result.plannedFileCount, plannedBytes: result.plannedBytes };
                        } catch (err) {
                                return renderRefusal(services.channel, 'migration.plan', err);
                        }
                },
                'flauz.migration.execute': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.migration.execute: no workspace folder open -- there is no workspace state to migrate.');
                                return { ok: false, code: 'FLAUZ_MIGRATION_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.migration.execute: the upgrade path -- ANCHOR FIRST (a verified export of the current state before any transform), then per-surface atomic stage+rename exactly as planned, then post-flight verification + the record banking.');
                        try {
                                const result: ExecuteResult = await executeMigration({
                                        root,
                                        fs: services.fs,
                                        clock: services.clock,
                                        versions: services.versions(),
                                });
                                for (const line of renderExecuteResult(result)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: true, result };
                        } catch (err) {
                                if (err instanceof MigrationError && err.code === 'FLAUZ_MIGRATION_TORN') {
                                        // the torn refusal renders the recovery path (the gate, not a wall)
                                        services.channel.appendLine(`flauz.migration.execute: REFUSED -- ${err.message}`);
                                        for (const line of renderTornReport(await detectTornState(root, services.fs))) {
                                                services.channel.appendLine(line);
                                        }
                                        throw err;
                                }
                                return renderRefusal(services.channel, 'migration.execute', err);
                        }
                },
                'flauz.migration.rollback': async arg => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.migration.rollback: no workspace folder open -- there is no workspace state to restore.');
                                return { ok: false, code: 'FLAUZ_MIGRATION_NO_WORKSPACE' };
                        }
                        const anchor = parseAnchorArg(arg);
                        const overwrite = parseOverwriteArg(arg);
                        services.channel.appendLine(`flauz.migration.rollback: the safety path -- VERIFY FIRST on the anchor${anchor !== undefined ? ` (${anchor})` : ' (the most recent migration\'s anchor)'}, then per-surface atomic stage+rename restore${overwrite ? ' with the explicit overwrite consent' : ''}, then the rollback record banking.`);
                        try {
                                const result: RollbackResult = await rollbackMigration({ root, fs: services.fs, clock: services.clock }, { overwrite, anchor });
                                for (const line of renderRollbackResult(result)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: true, result };
                        } catch (err) {
                                return renderRefusal(services.channel, 'migration.rollback', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
