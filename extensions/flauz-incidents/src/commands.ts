/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The `flauz.incidents.*` command surface (A-PROD-006-W1).
 *
 * Commands carry DATA only -- every effect (fs, output channel, clock) is a
 * port wired by the extension layer or injected by tests; command args
 * never carry code.
 *
 * THE DISCLOSURE + REFUSAL LAW (the W1-W3 precedent): every command states
 * what it is about to do BEFORE it does it -- including the honest-scope
 * disclosure (this wave delivers MACHINERY over workspace state; production
 * usage is EMPTY by design -- the launch has not happened; no record may
 * claim production evidence) on every render; the typed refusals
 * (no-workspace, unknown-incident, bad-args, secret-shaped, refused-evidence,
 * bad-transition) render the gate, not a wall.
 */

import type * as vscode from 'vscode';
import { vscodeApi } from './globals.ts';
import {
	type Clock,
	type IncidentsFsPort,
	type OutputChannelPort,
	IncidentsError,
} from './api.ts';
import { parseReportArgs, reportIncident, renderReport, INCIDENTS_LEDGER_PATH, type ReportResult } from './incidents.ts';
import { parseAdvanceArgs, advanceLoop, renderAdvance, type AdvanceResult } from './loop.ts';
import { runStatus, renderStatus, BOUNDARY_DISCLOSURE, type StatusResult } from './status.ts';

export const COMMAND_IDS = ['flauz.incidents.report', 'flauz.incidents.advance', 'flauz.incidents.status'] as const;
export type IncidentsCommandId = (typeof COMMAND_IDS)[number];

/** The ports the commands consume (all injected; the flauz-integrity services pattern). */
export interface IncidentsCommandServices {
	readonly fs: IncidentsFsPort;
	readonly clock: Clock;
	readonly channel: OutputChannelPort;
	/** The workspace root (undefined: the honest no-workspace degradation). */
	readonly getWorkspaceRoot: () => string | undefined;
}

/** Renders a typed refusal into the channel (the gate, not a wall) + rethrows. */
function renderRefusal(channel: OutputChannelPort, command: string, err: unknown): never {
	if (err instanceof IncidentsError) {
		channel.appendLine(`flauz.${command}: REFUSED -- ${err.message}`);
		throw err;
	}
	throw err;
}

export type IncidentsHandler = (arg: unknown) => Promise<unknown>;

export function registerIncidentsCommands(services: IncidentsCommandServices): vscode.Disposable[] {
	const api = vscodeApi();
	const handlers: Record<IncidentsCommandId, IncidentsHandler> = {
		'flauz.incidents.report': async (arg: unknown) => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.incidents.report: no workspace folder open -- the durable .flauz/ state is inactive; there is no workspace to record incidents in.');
				return { ok: false, code: 'FLAUZ_INCIDENTS_NO_WORKSPACE' };
			}
			services.channel.appendLine(`flauz.incidents.report: the typed incident intake -- the incident record (id flauz:inc:<16-hex> from an explicit rng/seed input, class, severity sev1..sev4, affected surface, repro note, evidence refs under .flauz/ only, reportedAtIso, the typed source binding manual | telemetry-census | durability-escalation | dogfood-friction). A source binding that cannot resolve is a TYPED DISCLOSURE record, never a dropped row and never a fabricated/inferred incident. Persisted ${INCIDENTS_LEDGER_PATH} (flauz.incidents/v1), append-only, census-visible, swept + banked (taskId 'flauz-incidents'). The unique-id law: re-reporting an id appends a NEW revision, never duplicates. Swept FAIL-CLOSED for secret-shaped values in repro notes.`);
			try {
				const args = parseReportArgs(arg);
				const result: ReportResult = await reportIncident({ root, fs: services.fs, clock: services.clock }, args);
				for (const line of renderReport(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-incidents'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})${result.intakeJournal !== undefined ? ` | intake row: ${result.intakeJournal.journalPath}` : ''}`);
				return { ok: true, incidentId: result.incidentId, revised: result.revised, revision: result.revision, incidentCount: result.incidentCount, sourceBindingState: result.sourceBindingState, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'incidents.report', err);
			}
		},
		'flauz.incidents.advance': async (arg: unknown) => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.incidents.advance: no workspace folder open -- there is no workspace state to advance the loop of.');
				return { ok: false, code: 'FLAUZ_INCIDENTS_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.incidents.advance: the loop state machine -- per-incident loop stages frozen verbatim from the A6 law (incident -> reproducible-finding -> registry-item -> fix -> regression -> release -> post-release-verification). Typed forward transitions ONLY, each evidence-bearing, each carrying its evidence label from the frozen ladder (fixture | simulated | local-real | runtime-real | live-provider | production-real -- never promote a label by wording). The closure law (fail-closed): fix -> regression REQUIRES regression evidence; regression -> release requires the release identity; the loop closes ONLY on post-release verification evidence. Missing evidence = typed REFUSAL naming the exact missing stage-evidence kind, never a silent skip; NO stage may be skipped forward. The ONE reopen law: a failed post-release verification REOPENS the incident (a closed loop never hides a regression). The registry-item stage carries the repo-side registry item id VERBATIM (the two-registry separation). Transition journal .flauz/incidents/loop-<incident>.jsonl (flauz.incidents-loop/v1, append-only, one row per transition with actor + timestampIso via the INJECTED clock).');
			try {
				const args = parseAdvanceArgs(arg);
				const result: AdvanceResult = await advanceLoop({ root, fs: services.fs, clock: services.clock }, args);
				for (const line of renderAdvance(result)) {
					services.channel.appendLine(line);
				}
				return { ok: true, incidentId: result.incidentId, transition: result.transition, fromStage: result.fromStage, toStage: result.toStage, refused: result.refused, refusedEvidenceKind: result.refusedEvidenceKind, journalPath: result.persisted.journalPath, banking: result.persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'incidents.advance', err);
			}
		},
		'flauz.incidents.status': async () => {
			const root = services.getWorkspaceRoot();
			if (root === undefined) {
				services.channel.appendLine('flauz.incidents.status: no workspace folder open -- there is no workspace state to render the verdict of.');
				return { ok: false, code: 'FLAUZ_INCIDENTS_NO_WORKSPACE' };
			}
			services.channel.appendLine('flauz.incidents.status: the ledger verdict -- the verdict table over every incident (per-incident loop stage, source-binding state resolved | disclosed-unresolvable | manual-disclosed, closure readiness -- the exact list of missing stage-evidence kinds, typed, and the loop verdict closed | open | reopened | refused-evidence). Record .flauz/incidents/status-<stamp>.json (flauz.incidents-status/v1), swept + banked census-visible (taskId \'flauz-incidents\').');
			services.channel.appendLine(`  ${BOUNDARY_DISCLOSURE}`);
			try {
				const result: StatusResult = await runStatus({ root, fs: services.fs, clock: services.clock });
				for (const line of renderStatus(result)) {
					services.channel.appendLine(line);
				}
				services.channel.appendLine(`  record: ${result.persisted.recordPath} (census-visible: the banked evidence row taskId 'flauz-incidents'${result.persisted.banking.watermarkUpdated ? ', watermark re-synced' : ''})`);
				return { ok: true, counts: result.record.counts, recordPath: result.persisted.recordPath, banking: result.persisted.banking };
			} catch (err) {
				return renderRefusal(services.channel, 'incidents.status', err);
			}
		},
	};
	const disposables: vscode.Disposable[] = [];
	for (const id of COMMAND_IDS) {
		disposables.push(api.commands.registerCommand(id, handlers[id]));
	}
	return disposables;
}
