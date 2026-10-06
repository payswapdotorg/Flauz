/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.acceptance.*` command surface (A-PROD-006-W2, DL-87). The W1
 * two-command pattern: commands carry DATA only -- every effect (fs, output
 * channel, clock) is a port wired by the extension layer or injected by
 * tests; command args never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W3 precedent): every command states
 * what it is about to do BEFORE it does it -- including the honest-scope
 * disclosure (this wave delivers MACHINERY over workspace state; production
 * usage is EMPTY by design -- the launch has not happened; no record or
 * receipt may claim production-real evidence) on every render; the typed
 * refusals (no-workspace, checklist absent/red/torn/stale, incident
 * absent/not-at-release, record absent/torn, bad-args, secret-shaped)
 * render the gate, not a wall.
 *
 * UNVERIFIED-BY-ME: authored against the unblock-packet surfaces; the
 * station runs the battery.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
	type Clock,
	type AcceptanceFsPort,
	type OutputChannelPort,
	AcceptanceError,
} from './api.ts';
import { parseLaunchArgs, launchReleaseAcceptance, renderLaunch, type LaunchResult } from './acceptance.ts';
import { parseVerifyArgs, verifyPostRelease, renderVerify, type VerifyResult } from './verify.ts';

export const COMMAND_IDS = ['flauz.acceptance.launch', 'flauz.acceptance.verify'] as const;
export type AcceptanceCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the W1 services pattern). */
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
				services.channel.appendLine('flauz.acceptance.launch: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to launch a release acceptance in.');
				return { ok: false, code: 'FLAUZ_ACCEPTANCE_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.acceptance.launch: the launch-act law (fail-closed) -- mints a release-acceptance record ONLY over a GREEN, FRESH flauz.release.checklist artifact (read through the contract-pinned parser; typed refusals on red/absent/torn/stale, never a silent default). The record carries the acceptance id flauz:acc:<16-hex> (a deterministic fnv1a32-style derivation from the bound content, no random), the bound checklist artifact path VERBATIM (the release identity the incidents loop carries), the pinned product state (the version-inventory + census snapshot shapes, contract-pinned from flauz-release) and the NAMED OWNING CHECKS set (the release\'s acceptance set -- the checklist row kinds + the incident\'s named regression test when launched to close an incident loop; the incident must sit at the release stage). The gate vocabulary does NOT grow: the eleven prove-items stay verbatim -- the verdict is READ from the checklist artifacts, never redefined. The two-registry separation: acceptance records NEVER mint registry items; WORK-REGISTRY.md stays the control plane. Persisted .flauz/acceptance/acceptance-<id>.json (flauz.acceptance/v1), census-visible, swept + banked (taskId \'flauz-acceptance\').');
			try {
				const args = parseLaunchArgs(arg);
				const result: LaunchResult = await launchReleaseAcceptance({ root, fs: services.fs, clock: services.clock }, args);
				for (const line of renderLaunch(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-acceptance'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
				return { ok: true, acceptanceId: result.acceptanceId, recordPath: result.persisted.recordPath, banking: result.persisted.banking, incidentBinding: result.record.incidentBinding };
			} catch (err) {
				return renderRefusal(services.channel, 'acceptance.launch', err);
			}
		},
		'flauz.acceptance.verify': async (arg: unknown) => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.acceptance.verify: no workspace folder open -- there is no workspace state to re-run the owning checks against.');
				return { ok: false, code: 'FLAUZ_ACCEPTANCE_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.acceptance.verify: the post-release-acceptance law -- re-runs the named owning checks against the released state and banks the closing receipt (pass or FAIL, both typed, both banked).');
			try {
				const args = parseVerifyArgs(arg);
				const result: VerifyResult = await verifyPostRelease({ root, fs: services.fs, clock: services.clock }, args);
				for (const line of renderVerify(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-acceptance'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
				return { ok: true, receiptId: result.receipt.receiptId, verdict: result.receipt.verdict, counts: result.receipt.counts, reopenConsumable: result.reopenConsumable, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'acceptance.verify', err);
			}
		},
	};
	const disposables: vscode.Disposable[] = [];
	for (const id of COMMAND_IDS) {
		disposables.push(api.commands.registerCommand(id, handlers[id]));
	}
	return disposables;
}
