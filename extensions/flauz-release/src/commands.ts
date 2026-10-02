/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.release.*` command surface (A-PROD-004-W5).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock, the
 * product-state probe) is a port wired by the extension layer or injected by
 * tests; command args never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1/W2/W3/W4 precedent): every command
 * states what it is about to do BEFORE it does it; the typed refusals
 * (no-workspace, no-product-state, secret-shaped, format) render the gate,
 * not a wall; the update check NEVER performs the update; the checklist
 * renders its full verdict table whatever the verdict says.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        ReleaseError,
        type Clock,
        type OutputChannelPort,
        type ReleaseFsPort,
        type VersionsInfo,
} from './api.ts';
import { renderInstallVerification, persistInstallVerification, verifyInstall, type InstallVerificationResult } from './verifyInstall.ts';
import { renderUpdateReadiness, checkUpdateReadiness, type UpdateReadiness } from './updateCheck.ts';
import { checklistDisclosure, renderChecklist, runChecklist, type ReleaseChecklistResult } from './checklist.ts';

export const COMMAND_IDS = ['flauz.release.verify', 'flauz.release.updateCheck', 'flauz.release.checklist'] as const;
export type ReleaseCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-migration services pattern). */
export interface ReleaseCommandServices {
        readonly fs: ReleaseFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        /**
         * The repo-state product root (the install verification's subject): the
         * workspace root when it carries the packaging-parity registry, else
         * undefined -- the typed no-product-state refusal (this wave's evidence
         * law; the runtime-installed-product angle is A-PROD-005's lane).
         */
        readonly getProductRoot: () => Promise<string | undefined>;
        readonly versions: () => VersionsInfo;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof ReleaseError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type ReleaseHandler = (arg: unknown) => Promise<unknown>;

export function registerReleaseCommands(services: ReleaseCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<ReleaseCommandId, ReleaseHandler> = {
                'flauz.release.verify': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.release.verify: no workspace folder open -- the durable .flauz/ state is inactive; there is no installed product state to verify.');
                                return { ok: false, code: 'FLAUZ_RELEASE_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine('flauz.release.verify: REFUSED -- no repo-state product in this workspace (the install verification runs against the repo-state product: extensions/flauz-* manifests + the packaging-parity registry + the SBOM; the runtime-installed-product angle is A-PROD-005\'s production-readiness lane).');
                                return { ok: false, code: 'FLAUZ_RELEASE_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine(`flauz.release.verify: the install verification -- the extension census (every packaged extension present + activation-lint clean), the packaging-parity contract (rows vs manifests), the SBOM component coverage, the durable-state census (the W1 machinery runs clean), and the integrity verdicts (the W2 machinery: a fresh self-export verifies). Product state: ${productRoot}.`);
                        try {
                                const result: InstallVerificationResult = await verifyInstall({ root, fs: services.fs, clock: services.clock, versions: services.versions(), productRoot });
                                const persisted = await persistInstallVerification({ root, fs: services.fs, clock: services.clock }, services.versions(), result);
                                for (const line of renderInstallVerification(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-release', uri = the record path${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: result.ok, record: persisted.record, recordPath: persisted.recordPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'release.verify', err);
                        }
                },
                'flauz.release.updateCheck': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.release.updateCheck: no workspace folder open -- there is no workspace state to pre-flight.');
                                return { ok: false, code: 'FLAUZ_RELEASE_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.release.updateCheck: the pre-update gate -- censuses the CURRENT state, reads the CURRENT per-surface format versions, reports the migration readiness (identity/transform/refusal) + the anchor dry-run. NEVER performs the update: the migration itself stays in flauz-migration\'s hands. This command writes nothing.');
                        try {
                                const readiness: UpdateReadiness = await checkUpdateReadiness({ root, fs: services.fs, clock: services.clock, versions: services.versions() });
                                for (const line of renderUpdateReadiness(readiness)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: readiness.ok, readiness };
                        } catch (err) {
                                return renderRefusal(services.channel, 'release.updateCheck', err);
                        }
                },
                'flauz.release.checklist': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.release.checklist: no workspace folder open -- there is no workspace state to check.');
                                return { ok: false, code: 'FLAUZ_RELEASE_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.release.checklist: the release checklist -- the one-command go/no-go binding ALL TEN beta capabilities (diagnostics, backup/export, crash recovery, migration safety, telemetry, failure typing, rollback, the support bundle, install verification, this artifact itself). GO only when all ten rows are green.');
                        try {
                                for (const line of await checklistDisclosure({ root, fs: services.fs, clock: services.clock })) {
                                        services.channel.appendLine(line);
                                }
                                const productRoot = await services.getProductRoot();
                                const result: ReleaseChecklistResult = await runChecklist({ root, fs: services.fs, clock: services.clock, versions: services.versions(), productRoot });
                                for (const line of renderChecklist(result)) {
                                        services.channel.appendLine(line);
                                }
                                if (result.banking !== undefined) {
                                        services.channel.appendLine(`  census-visible: the banked evidence row taskId 'flauz-release', uri = the artifact path${result.banking.watermarkUpdated ? ', watermark re-synced' : ''}`);
                                }
                                return { ok: result.verdict === 'GO', verdict: result.verdict, rows: result.rows, artifactPath: result.artifactPath, checklistId: result.checklistId, banking: result.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'release.checklist', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
