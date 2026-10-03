/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.durability.*` command surface (A-PROD-005-W4).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock) is a
 * port wired by the extension layer or injected by tests; command args
 * never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W3 precedent): every command states
 * what it is about to do BEFORE it does it -- including the
 * honest-boundary disclosure (this extension proves the record-keeping +
 * verdict machinery; the execution of an actual restart routes through the
 * owning task's own machinery) on every render; the typed refusals
 * (no-workspace, unknown-lane, bad-args, secret-shaped) render the gate,
 * not a wall; the heartbeat command persists its record WHATEVER the
 * liveness observation says (never a silent green); the status command
 * persists its verdict record whatever the table says.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
        type Clock,
        type DurabilityFsPort,
        type OutputChannelPort,
        DurabilityError,
        BEAT_RING_CAP,
} from './api.ts';
import { parseRegisterArgs, registerLane, renderRegister, LANES_RECORD_PATH, type RegisterResult } from './lanes.ts';
import { parseHeartbeatArgs, recordHeartbeat, renderHeartbeat, BOUNDARY_DISCLOSURE, type HeartbeatResult } from './heartbeat.ts';
import { runStatus, renderStatus, type StatusResult } from './status.ts';

export const COMMAND_IDS = ['flauz.durability.register', 'flauz.durability.heartbeat', 'flauz.durability.status'] as const;
export type DurabilityCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-integrity services pattern). */
export interface DurabilityCommandServices {
        readonly fs: DurabilityFsPort;
        readonly clock: Clock;
        readonly channel: OutputChannelPort;
        /** The workspace root (undefined: the honest no-workspace degradation). */
        readonly getWorkspaceRoot: () => string | undefined;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
        if (err instanceof DurabilityError) {
                channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
                throw err;
        }
        throw err;
}

export type DurabilityHandler = (arg: unknown) => Promise<unknown>;

export function registerDurabilityCommands(services: DurabilityCommandServices): vscode.Disposable[] {
        const api = vscodeApi();
        const handlers: Record<DurabilityCommandId, DurabilityHandler> = {
                'flauz.durability.register': async (arg: unknown) => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.durability.register: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to supervise worker lanes in.');
                                return { ok: false, code: 'FLAUZ_DURABILITY_NO_WORKSPACE' };
                        }
                        services.channel.appendLine(`flauz.durability.register: register a supervised worker lane -- the typed lane record (lane id, the owning task/extension, the heartbeat interval, the staleness threshold, the escalation policy: notify / checkpoint-and-restart / refuse), persisted ${LANES_RECORD_PATH} (flauz.durability-lanes/v1). A lane id is unique: re-registering an id refreshes its policy, never duplicates. The record is swept + banked census-visible (taskId 'flauz-durability').`);
                        try {
                                const args = parseRegisterArgs(arg);
                                const result: RegisterResult = await registerLane({ root, fs: services.fs, clock: services.clock }, args);
                                for (const line of renderRegister(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-durability', uri = ${LANES_RECORD_PATH}${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: true, laneId: result.laneId, refreshed: result.refreshed, laneCount: result.laneCount, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'durability.register', err);
                        }
                },
                'flauz.durability.heartbeat': async (arg: unknown) => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.durability.heartbeat: no workspace folder open -- there is no workspace to record the worker liveness signal in.');
                                return { ok: false, code: 'FLAUZ_DURABILITY_NO_WORKSPACE' };
                        }
                        services.channel.appendLine(`flauz.durability.heartbeat: record a heartbeat for a lane (the worker's own liveness signal) -- stamps the lane's beat history (a bounded ring: the last ${BEAT_RING_CAP} stamps, the injected clock), classifies the PRE-BEAT liveness LIVE / STALE (past the threshold) / FLAT (no beat ever, past one interval) / UNKNOWN (lane not registered -- a typed refusal, never a guessed verdict). A STALE/FLAT classification triggers the lane's escalation policy record (the machinery RECORDS the escalation demand; the execution of an actual restart routes through the owning task's own machinery -- disclosed). Record .flauz/durability/heartbeat-<stamp>.json (flauz.durability-heartbeat/v1), swept + banked.`);
                        try {
                                const laneId = parseHeartbeatArgs(arg);
                                const result: HeartbeatResult = await recordHeartbeat({ root, fs: services.fs, clock: services.clock }, laneId);
                                for (const line of renderHeartbeat(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-durability'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: true, laneId: result.record.laneId, liveness: result.record.liveness, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'durability.heartbeat', err);
                        }
                },
                'flauz.durability.status': async () => {
                        const root = services.getWorkspaceRoot();
                        if (root === undefined) {
                                services.channel.appendLine('flauz.durability.status: no workspace folder open -- there is no workspace state to render the supervision verdict of.');
                                return { ok: false, code: 'FLAUZ_DURABILITY_NO_WORKSPACE' };
                        }
                        services.channel.appendLine('flauz.durability.status: the supervision verdict -- every registered lane with its liveness class, its beat-history shape (the inter-beat intervals: min/median/max, the jitter disclosure), its escalation state, and the CHECKPOINT LAW consultation (the workspace-bound record surfaces the lane\'s owning extension owns through the W3 isolation audit\'s derivation surfaces, read-only + the W2 backup plane\'s export anchor when one exists). The typed verdict table per lane: supervised-green / stale / flat / unknown / degraded (a lane whose state surfaces do not resolve -- typed, never silent). Record .flauz/durability/status-<stamp>.json (flauz.durability-status/v1), swept + banked.');
                        services.channel.appendLine(`  ${BOUNDARY_DISCLOSURE}`);
                        try {
                                const result: StatusResult = await runStatus({ root, fs: services.fs, clock: services.clock });
                                for (const line of renderStatus(result)) {
                                        services.channel.appendLine(line);
                                }
                                services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-durability'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
                                return { ok: true, counts: result.record.counts, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
                        } catch (err) {
                                return renderRefusal(services.channel, 'durability.status', err);
                        }
                },
        };
        const disposables: vscode.Disposable[] = [];
        for (const id of COMMAND_IDS) {
                disposables.push(api.commands.registerCommand(id, handlers[id]));
        }
        return disposables;
}
