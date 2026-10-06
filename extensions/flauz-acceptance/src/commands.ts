/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.acceptance.*` command surface (A-PROD-006-W2, DL-87).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock) is a
 * port wired by the extension layer or injected by tests; command args
 * never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W3 precedent): every command states
 * what it is about to do BEFORE it does it -- including the honest-scope
 * disclosure (this wave delivers MACHINERY over workspace state; the
 * production launch has not happened; no record may claim production
 * evidence) on every render; the typed refusals (no-workspace,
 * no-checklist, red, torn, stale, not-found, unknown-acceptance, bad-args,
 * secret-shaped) render the gate, not a wall.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type AcceptanceFsPort,
        type Clock,
        type OutputChannelPort,
        AcceptanceError,
} from './api.ts';
import { parseLaunchArgs, launchAcceptance, renderLaunch, ACCEPTANCE_LEDGER_PATH, type LaunchResult } from './launch.ts';
import { parseVerifyArgs, verifyAcceptance, renderVerify, type VerifyResult } from './verify.ts';
import { runStatus, renderStatus, BOUNDARY_DISCLOSURE, type StatusResult } from './status.ts';

export const COMMAND_IDS = ['flauz.acceptance.launch', 'flauz.acceptance.verify', 'flauz.acceptance.status'] as const;
export type AcceptanceCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-integrity services pattern). */
export interface AcceptanceCommandServices {
        readonly fs: AcceptanceFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof AcceptanceError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type AcceptanceHandler = (arg: unknown) => Promise<unknown>;

export function registerAcceptanceCommands(services: AcceptanceCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<AcceptanceCommandId, AcceptanceHandler> = {
                'flauz.acceptance.launch': async (arg: unknown) => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.acceptance.launch: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to launch a release acceptance over.');
                                return { ok: false, code: 'FLAUZ_ACCEPTANCE_NO_WORKSPACE' };
                        }
                        services.channel.appendLine(`flauz.acceptance.launch: the launch-act law (fail-closed) -- a release-acceptance record is minted ONLY over a GREEN, FRESH flauz.release.checklist artifact (reads .flauz/release/checklist-<stamp>.json through the contract-pinned parser; refuses typed on absent/torn/red/stale; never a silent green). The record carries the acceptance id flauz:acc:<16-hex> from an explicit rng/seed input, the bound checklist artifact path VERBATIM + its checklistId (the release identity the incidents loop carries), the pinned product state (the version-inventory + census snapshot shapes, contract-pinned from flauz-release), and the NAMED OWNING CHECKS set (the checklist row kinds + the incident's named regression test when launched to close an incident loop; the binding resolves against the incidents ledger or is a TYPED DISCLOSURE). Persisted ${ACCEPTANCE_LEDGER_PATH} (flauz.acceptance/v1), append-only (the unique-id law: re-launching an id appends a NEW revision), census-visible, swept + banked (taskId 'flauz-acceptance'). The gate vocabulary does not grow: the eleven prove-items stay verbatim in their owning plane; this launch binds by READING the checklist verdict, never by redefining it.`);
                        try {
                                const args = parseLaunchArgs(arg);
                                const result: LaunchResult = await launchAcceptance({ root, fs: services.fs, clock: services.clock }, args);
                                for (const line of renderLaunch(result)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: true, acceptanceId: result.acceptanceId, revised: result.revised, revision: result.revision, checklistPath: result.checklistPath, checklistId: result.checklistId, owningCheckCount: result.owningCheckCount, incidentBindingState: result.incidentBindingState, ledgerPath: result.persisted.ledgerPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'acceptance.launch', err);
                        }
                },
                'flauz.acceptance.verify': async (arg: unknown) => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.acceptance.verify: no workspace folder open -- there is no released state to verify without a workspace.');
                                return { ok: false, code: 'FLAUZ_ACCEPTANCE_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.acceptance.verify: the closing receipt -- re-runs the named owning checks against the released state and banks the receipt (pass or FAIL, both typed, both banked). A FAILED receipt is the typed failure record the incidents reopen law consumes (the closed loop never hides a regression). The self-evaluable named checks are genuinely re-run over the workspace state (the bound checklist artifact re-read + its checklistId re-derived; the pinned product state re-read -- presence + detected format version + parse cleanliness, the append-only growth honestly disclosed); a check the acceptance plane cannot itself evaluate is a TYPED DISCLOSURE row naming its owning surface (the honest-scope law), never a silent green. The receipt\'s evidence label comes from the frozen ladder and is never promoted by wording. Journal .flauz/acceptance/verify-<acceptanceId>.jsonl (flauz.acceptance-verification/v1, append-only, one row per verify run with actor + timestampIso via the INJECTED clock).');
                        try {
                                const args = parseVerifyArgs(arg);
                                const result: VerifyResult = await verifyAcceptance({ root, fs: services.fs, clock: services.clock }, args);
                                for (const line of renderVerify(result)) {
                                        services.channel.appendLine(line);
                                }
                                return { ok: true, acceptanceId: result.acceptanceId, verdict: result.verdict, evidenceLabel: result.evidenceLabel, counts: result.row.counts, journalPath: result.persisted.journalPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'acceptance.verify', err);
                        }
                },
                'flauz.acceptance.status': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.acceptance.status: no workspace folder open -- there is no workspace state to render the verdict of.');
                                return { ok: false, code: 'FLAUZ_ACCEPTANCE_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.acceptance.status: the ledger verdict -- the verdict table over every acceptance record (per-record bound checklist identity, revision count, owning-checks count, incident-binding state, latest receipt verdict pass | fail | none with its disclosure/fail counts). Record .flauz/acceptance/status-<stamp>.json (flauz.acceptance-status/v1), swept + banked census-visible (taskId \'flauz-acceptance\').');
                        services.channel.appendLine(`  ${BOUNDARY_DISCLOSURE}`);
                        try {
                                const result: StatusResult = await runStatus({ root, fs: services.fs, clock: services.clock });
                                for (const line of renderStatus(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-acceptance'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: true, counts: result.record.counts, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'acceptance.status', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
