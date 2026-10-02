/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.telemetry.*` / `flauz.failures.list` command surface
 * (A-PROD-004-W4).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock) is a
 * port wired by the extension layer or injected by tests; command args never
 * carry code.
 *
 * THE DISCLOSURE LAW (the W1/W2/W3 precedent): `flauz.telemetry.config`
 * renders the WHOLE declared schema (the inspect-before-enable plane) before
 * anything can be enabled; the typed refusals (disabled, schema-drift,
 * config-invalid, secret-shaped) carry the full remediation path so the
 * operator sees the gate, not a wall.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
	TelemetryError,
	type Clock,
	type OutputChannelPort,
	type TelemetryFsPort,
} from './api.ts';
import {
	applyConfigChange,
	loadTelemetryConfig,
	parseConfigArg,
	renderConfigLines,
	type TelemetryConfig,
} from './config.ts';
import { renderRecordResult, resolveSessionId, runRecordPass, type RecordPassResult } from './record.ts';
import { collectReport, renderReportLines, type TelemetryReport } from './report.ts';
import { collectFailureCensus, renderCensusLines, type FailureCensus } from './failuresList.ts';

export const COMMAND_IDS = ['flauz.telemetry.config', 'flauz.telemetry.record', 'flauz.telemetry.report', 'flauz.failures.list'] as const;
export type TelemetryCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-migration services pattern). */
export interface TelemetryCommandServices {
	readonly fs: TelemetryFsPort;
	readonly clock: Clock;
	readonly channel: OutputChannelPort;
	/** The workspace root (undefined: the honest no-workspace degradation). */
	readonly getWorkspaceRoot: () => string | undefined;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
	if (err instanceof TelemetryError) {
		channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
		throw err;
	}
	throw err;
}

export type TelemetryHandler = (arg: unknown) => Promise<unknown>;

export function registerTelemetryCommands(services: TelemetryCommandServices): vscode.Disposable[] {
	const api = vscodeApi();
	const handlers: Record<TelemetryCommandId, TelemetryHandler> = {
		'flauz.telemetry.config': async arg => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.telemetry.config: no workspace folder open -- the durable .flauz/ state is inactive; there is no telemetry config to inspect or change.');
				return { ok: false, code: 'FLAUZ_TELEMETRY_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.telemetry.config: the opt-in plane -- the declared event schema FIRST (inspect before enabling), then the live state; enabling requires your explicit action and records the consent event itself.');
			let change;
			try {
				change = parseConfigArg(arg);
			} catch (err) {
				return renderRefusal(services.channel, 'telemetry.config', err);
			}
			try {
				const current: TelemetryConfig = await loadTelemetryConfig(root, services.fs);
				const next = await applyConfigChange({ root, fs: services.fs, clock: services.clock }, current, change);
				for (const line of renderConfigLines(next)) {
					services.channel.appendLine(line);
				}
				return {
					ok: true,
					enabled: next.enabled,
					retentionDays: next.retentionDays,
					consent: next.consent ?? null,
					changed: change.enable !== undefined || change.retentionDays !== undefined,
				};
			} catch (err) {
				return renderRefusal(services.channel, 'telemetry.config', err);
			}
		},
		'flauz.telemetry.record': async arg => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.telemetry.record: no workspace folder open -- there is no workspace state to observe.');
				return { ok: false, code: 'FLAUZ_TELEMETRY_NO_WORKSPACE' };
			}
			let session: string;
			try {
				session = resolveSessionId(arg, services.clock);
			} catch (err) {
				return renderRefusal(services.channel, 'telemetry.record', err);
			}
			services.channel.appendLine(`flauz.telemetry.record: the collection plane -- observe the real durable surfaces, fold the observations into closed-vocabulary aggregate rows, sweep the whole batch (fail-closed), append to the workspace-local ledger (session ${session}).`);
			try {
				const result: RecordPassResult = await runRecordPass({ root, fs: services.fs, clock: services.clock }, session);
				for (const line of renderRecordResult(result)) {
					services.channel.appendLine(line);
				}
				return { ok: true, result };
			} catch (err) {
				return renderRefusal(services.channel, 'telemetry.record', err);
			}
		},
		'flauz.telemetry.report': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.telemetry.report: no workspace folder open -- there is no local telemetry ledger to aggregate.');
				return { ok: false, code: 'FLAUZ_TELEMETRY_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.telemetry.report: the inspection plane -- the aggregate view of the LOCAL ledger only (per-surface counts, outcome distributions, duration histograms, the error-code census); no network, no export.');
			try {
				const report: TelemetryReport = await collectReport({ root, fs: services.fs, clock: services.clock });
				for (const line of renderReportLines(report)) {
					services.channel.appendLine(line);
				}
				return { ok: true, report };
			} catch (err) {
				return renderRefusal(services.channel, 'telemetry.report', err);
			}
		},
		'flauz.failures.list': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.failures.list: no workspace folder open -- there is no local telemetry ledger to census.');
				return { ok: false, code: 'FLAUZ_TELEMETRY_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.failures.list: the failure census -- typed provider/environment failures from the local ledger, grouped by failure class with the affected surfaces, remediation hints and the time distribution (the retention window bounds "recent").');
			try {
				const census: FailureCensus = await collectFailureCensus({ root, fs: services.fs, clock: services.clock });
				for (const line of renderCensusLines(census)) {
					services.channel.appendLine(line);
				}
				return { ok: true, census };
			} catch (err) {
				return renderRefusal(services.channel, 'failures.list', err);
			}
		},
	};
	const disposables: vscode.Disposable[] = [];
	for (const id of COMMAND_IDS) {
		disposables.push(api.commands.registerCommand(id, handlers[id]));
	}
	return disposables;
}
