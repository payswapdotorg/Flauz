/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.integrity.*` command surface (A-PROD-005-W2).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock, the
 * key-operations port, the product-root probe) is a port wired by the
 * extension layer or injected by tests; command args never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W5 precedent): every command states
 * what it is about to do BEFORE it does it -- including the LOCAL-DEV
 * key-posture disclosure on every sign render; the typed refusals
 * (no-workspace, no-product-state, no-manifest, manifest-format,
 * artifact-missing, pin-mismatch, secret-shaped) render the gate, not a
 * wall; the verify command persists its record WHATEVER the verdict says
 * (never a silent green); the status command renders read-only.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type Clock,
        type IntegrityFsPort,
        type KeyPort,
        type OutputChannelPort,
        IntegrityError,
        isProductRoot,
        joinPath,
        PRODUCT_BUNDLE_MANIFEST_PATH,
        PRODUCT_PARITY_REGISTRY_PATH,
} from './api.ts';
import { renderSign, persistLedger, runSign, type SignResult } from './ledger.ts';
import { renderVerify, persistVerify, runVerify, type VerifyResult } from './verify.ts';
import { renderStatus, runStatus, type IntegrityStatus } from './status.ts';

export const COMMAND_IDS = ['flauz.integrity.sign', 'flauz.integrity.verify', 'flauz.integrity.status'] as const;
export type IntegrityCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-migration/flauz-release/flauz-production services pattern). */
export interface IntegrityCommandServices {
        readonly fs: IntegrityFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        readonly keys: KeyPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
        /**
         * The repo-state product root (the signing plane's subject): the
         * workspace root when it carries the packaging-parity registry, else
         * undefined -- the typed no-product-state refusal (the W5 evidence
         * law; the pinned bundle manifest + the dist artifacts live in the
         * product tree).
         */
        readonly getProductRoot: () => Promise<string | undefined>;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof IntegrityError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type IntegrityHandler = (arg: unknown) => Promise<unknown>;

export function registerIntegrityCommands(services: IntegrityCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<IntegrityCommandId, IntegrityHandler> = {
                'flauz.integrity.sign': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.integrity.sign: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to record the signature ledger in.');
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine(`flauz.integrity.sign: REFUSED -- no repo-state product in this workspace (the signing plane signs the PINNED bundle artifacts of the product tree: the bundle manifest at ${PRODUCT_BUNDLE_MANIFEST_PATH} + the dist artifacts it pins, probed through the parity registry at ${PRODUCT_PARITY_REGISTRY_PATH}).`);
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine(`flauz.integrity.sign: the detached-signature ledger -- every artifact pinned by ${PRODUCT_BUNDLE_MANIFEST_PATH}, hash RE-DERIVED live over the real bytes (a live hash that disagrees with the pin = typed refusal), one ed25519 detached signature per artifact + the self-signed chain, the ledger persisted workspace-locally + banked census-visible. LOCAL-DEV KEY POSTURE: a workspace-local ed25519 keypair (generated on first sign; private key confined to the port-owned store) -- production signing keys are the operator's; this command proves the verification machinery, not key custody.`);
                        try {
                                const result: SignResult = await runSign({ root, productRoot, fs: services.fs, clock: services.clock, keys: services.keys });
                                const persisted = await persistLedger({ root, fs: services.fs, clock: services.clock }, result.ledger);
                                for (const line of renderSign(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-integrity', uri = the record path${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: true, keyStatus: result.keyStatus, artifactCount: result.artifactCount, record: persisted.record, recordPath: persisted.recordPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'integrity.sign', err);
                        }
                },
                'flauz.integrity.verify': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.integrity.verify: no workspace folder open -- there is no workspace to record the verify record in.');
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine(`flauz.integrity.verify: REFUSED -- no repo-state product in this workspace (the verdict re-hashes the pinned bundle artifacts + verifies the ledger signatures; without the product tree there is nothing to verify).`);
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine('flauz.integrity.verify: the one-command integrity verdict -- every pinned artifact re-hashed live + compared against the manifest pin (tamper signal), every ledger signature verified against the ledger\'s recorded public key (authenticity), the ledger self-chain re-derived, the coverage checked (unsigned artifacts = typed UNSIGNED rows; absent key store / absent ledger = typed degradation). The record persists whatever the verdict says -- never a silent green.');
                        try {
                                const result: VerifyResult = await runVerify({ root, productRoot, fs: services.fs, clock: services.clock, keys: services.keys });
                                const persisted = await persistVerify({ root, fs: services.fs, clock: services.clock }, result.record);
                                for (const line of renderVerify(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-integrity'${persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: result.ok, verdict: result.record.verdict, counts: result.record.counts, recordPath: persisted.recordPath, banking: persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'integrity.verify', err);
                        }
                },
                'flauz.integrity.status': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.integrity.status: no workspace folder open -- there is no workspace state to view.');
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_WORKSPACE' };
                        }
                        const productRoot = await services.getProductRoot();
                        if (productRoot === undefined) {
                                services.channel.appendLine(`flauz.integrity.status: REFUSED -- no repo-state product in this workspace (the status view reports the pinned artifact count from the product tree's bundle manifest).`);
                                return { ok: false, code: 'FLAUZ_INTEGRITY_NO_PRODUCT_STATE' };
                        }
                        services.channel.appendLine('flauz.integrity.status: the read-only state view -- the pinned artifact count, the signed coverage, the key fingerprint, the last verify verdict summary. No state change: nothing written, nothing banked, the key store only peeked.');
                        try {
                                const status: IntegrityStatus = await runStatus({ root, productRoot, fs: services.fs, keys: services.keys });
                                for (const line of renderStatus(status)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: true, status };
                        } catch (err) {
                                return renderRefusal(services.channel, 'integrity.status', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}

/** Re-exported for the tests' product-root fixtures (the probe seam). */
export const productRootProbe = { isProductRoot, joinPath };
