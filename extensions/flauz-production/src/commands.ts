/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.production.*` command surface (A-PROD-005-W1).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock, the
 * product-root probe, the runtime installed-product port) is a port wired
 * by the extension layer or injected by tests; command args never carry
 * code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W5 precedent): every command states
 * what it is about to do BEFORE it does it; the typed refusals
 * (no-workspace, no-product-state, secret-shaped, format) render the gate,
 * not a wall; the census renders its typed degradation honestly (the absent
 * runtime surface is a certified behavior, never a silent green); the gate
 * renders its full row table whatever the verdict says.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        ProductionError,
        type Clock,
        type OutputChannelPort,
        type ProductionFsPort,
        type VersionsInfo,
} from './api.ts';
import { renderCensus, persistCensus, runCensus, type InstalledProductCensusResult } from './census.ts';
import { renderMatrix, persistMatrix, runMatrix, type CapabilityMatrixResult } from './matrix.ts';
import { renderGate, persistGate, runGate, type ProductionGateResult } from './gate.ts';
import type { InstalledProductPort } from './installedProduct.ts';

export const COMMAND_IDS = ['flauz.production.census', 'flauz.production.matrix', 'flauz.production.gate'] as const;
export type ProductionCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-migration/flauz-release services pattern). */
export interface ProductionCommandServices {
        readonly fs: ProductionFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        /**
         * The repo-state product root (the verification plane's subject): the
         * workspace root when it carries the packaging-parity registry, else
         * undefined -- the typed no-product-state refusal (the W5 evidence
         * law; the runtime-installed-product angle is THIS wave's lane,
         * driven through the installed-product port).
         */
        readonly getProductRoot: () => Promise<string | undefined>;
        /** The runtime installed-product port (the seam a real install drives). */
        readonly installedProduct: InstalledProductPort;
        readonly versions: () => VersionsInfo;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof ProductionError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type ProductionHandler = (arg: unknown) => Promise<unknown>;

export function registerProductionCommands(services: ProductionCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<ProductionCommandId, ProductionHandler> = {
                'flauz.production.census': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.production.census: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to record the census in.');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine('flauz.production.census: REFUSED -- no repo-state product in this workspace (the census verifies the INSTALLED product against the repo-state product registry: extensions/flauz-* manifests + the packaging-parity registry + the SBOM, read through the W5 product-root ports).');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine(`flauz.production.census: the runtime-installed-product census -- the extension set the runtime actually loaded + the dist-tree manifests, verified against the repo-state product registry (${productRoot}) through the W5 product-root ports. Five typed check classes (installed/laws/presence/parity/sbom, green/tampered/torn). Where the runtime surface is absent the census degrades typed, never silently green.`);
                        try {
                                const result: InstalledProductCensusResult = await runCensus({ root, fs: services.fs, clock: services.clock, productRoot, installedProduct: services.installedProduct });
                                const persisted = await persistCensus({ root, fs: services.fs, clock: services.clock }, services.versions(), result);
                                for (const line of renderCensus(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-production', uri = the record path${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: result.ok, degraded: result.degradation !== undefined, record: persisted.record, recordPath: persisted.recordPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'production.census', err);
                        }
                },
                'flauz.production.matrix': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.production.matrix: no workspace folder open -- there is no workspace to record the matrix artifact in.');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine('flauz.production.matrix: REFUSED -- no repo-state product in this workspace (the matrix derives its rows from the live manifests\' contributed commands + the parity rows; it never runs on a hardcoded list).');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine('flauz.production.matrix: the documented supported/unsupported capability matrix -- every capability the product ships, its supported envelope + its honest unsupported boundary, derived from the real registry surfaces (the live manifests\' commands matched against the documented catalog). Unknown live commands + drifted documented commands are typed disclosures; the matrix never invents a capability.');
                        try {
                                const result: CapabilityMatrixResult = await runMatrix({ root, fs: services.fs, clock: services.clock, productRoot });
                                const persisted = await persistMatrix({ root, fs: services.fs, clock: services.clock }, services.versions(), result);
                                for (const line of renderMatrix(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  artifact: ${persisted.artifactPath} (machine-readable, census-visible: the banked evidence row taskId 'flauz-production'${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: result.ok, counts: result.counts, rows: result.rows, artifactPath: persisted.artifactPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'production.matrix', err);
                        }
                },
                'flauz.production.gate': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.production.gate: no workspace folder open -- there is no workspace to record the gate record in.');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine('flauz.production.gate: REFUSED -- no repo-state product in this workspace (the gate evaluates its prove-items from the real surfaces: the registries, the telemetry state, the export tree, the per-surface version inventory).');
                                return { ok: false, code: 'FLAUZ_PRODUCTION_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine('flauz.production.gate: the production-readiness gate -- the ELEVEN prove-items (reproducible artifacts, signing/integrity, security posture, data isolation, secret handling, worker durability, observability, backup/recovery, failure/rollback, upgrade compatibility, documented capabilities) + the runtime-census consultation. Every row carries its evidence pointer; the not-yet rows name their owning later wave; the verdict is GO-FOR-BETA / NOT-PRODUCTION-READY, never a silently green aggregate.');
                        try {
                                const result: ProductionGateResult = await runGate({ root, fs: services.fs, clock: services.clock, versions: services.versions(), productRoot, installedProduct: services.installedProduct });
                                const persisted = await persistGate({ root, fs: services.fs, clock: services.clock }, services.versions(), result);
                                for (const line of renderGate(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-production'${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: result.verdict === 'GO-FOR-BETA', verdict: result.verdict, rows: result.rows, recordPath: persisted.recordPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'production.gate', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
