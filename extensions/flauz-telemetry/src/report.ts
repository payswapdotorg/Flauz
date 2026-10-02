/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The telemetry report (A-PROD-004-W4) -- the inspection plane.
 *
 * Renders the aggregate view from the LOCAL ledger only (no network, no
 * export): per-surface event counts, outcome distributions, duration
 * histograms and the error-code census. The assembled report is swept before
 * render (the fail-closed backstop: a hand-poisoned ledger refuses the
 * report instead of leaking through it).
 */

import { TelemetryError, joinPath } from './api.ts';
import { readTelemetryLedger } from './record.ts';
import { sweepArtifact } from './privacy.ts';
import { failureClassOf } from './failures.ts';
import { formatTimestamp } from './format.ts';
import type { TelemetryRow } from './config.ts';
import type { Clock, TelemetryFsPort } from './api.ts';

// ---------------------------------------------------------------------------
// The report shape (counts only)
// ---------------------------------------------------------------------------

/** The report schema id. */
export const TELEMETRY_REPORT_SCHEMA_ID = 'flauz.telemetry-report/v1';

/** One per-surface aggregate block (mutable during the fold; frozen in the finished report). */
export interface SurfaceAggregate {
        readonly surface: string;
        eventCount: number;
        readonly outcomeCounts: Record<string, number>;
        readonly durationHistogram: Record<string, number>;
        readonly errorCodeCounts: Record<string, number>;
}

/** The whole aggregate report (the render source). */
export interface TelemetryReport {
        readonly $schema: typeof TELEMETRY_REPORT_SCHEMA_ID;
        readonly generatedAt: number;
        readonly rowCount: number;
        readonly totalEvents: number;
        readonly perSurface: readonly SurfaceAggregate[];
        readonly outcomeDistribution: Record<string, number>;
        readonly durationHistogram: Record<string, number>;
        readonly errorCodeCensus: Record<string, number>;
        readonly firstRowAt?: number;
        readonly lastRowAt?: number;
        readonly parseErrorCount: number;
}

function bump(map: Record<string, number>, key: string, by = 1): void {
        map[key] = (map[key] ?? 0) + by;
}

/** Builds the aggregate report from parsed ledger rows. */
export function buildReport(rows: readonly TelemetryRow[], generatedAt: number, parseErrorCount: number): TelemetryReport {
        const perSurfaceMap = new Map<string, SurfaceAggregate>();
        const outcomeDistribution: Record<string, number> = {};
        const durationHistogram: Record<string, number> = {};
        const errorCodeCensus: Record<string, number> = {};
        let totalEvents = 0;
        let firstRowAt: number | undefined;
        let lastRowAt: number | undefined;

        for (const row of rows) {
                let aggregate = perSurfaceMap.get(row.surface);
                if (aggregate === undefined) {
                        aggregate = { surface: row.surface, eventCount: 0, outcomeCounts: {}, durationHistogram: {}, errorCodeCounts: {} };
                        perSurfaceMap.set(row.surface, aggregate);
                }
                aggregate.eventCount += row.count;
                bump(aggregate.outcomeCounts, row.outcome, row.count);
                bump(aggregate.durationHistogram, row.durationBucket, row.count);
                if (row.errorCode !== undefined) {
                        bump(aggregate.errorCodeCounts, row.errorCode, row.count);
                }
                bump(outcomeDistribution, row.outcome, row.count);
                bump(durationHistogram, row.durationBucket, row.count);
                if (row.errorCode !== undefined) {
                        bump(errorCodeCensus, row.errorCode, row.count);
                }
                totalEvents += row.count;
                firstRowAt = firstRowAt === undefined ? row.at : Math.min(firstRowAt, row.at);
                lastRowAt = lastRowAt === undefined ? row.at : Math.max(lastRowAt, row.at);
        }

        const report: TelemetryReport = {
                $schema: TELEMETRY_REPORT_SCHEMA_ID,
                generatedAt,
                rowCount: rows.length,
                totalEvents,
                perSurface: [...perSurfaceMap.values()].sort((a, b) => (a.surface < b.surface ? -1 : 1)),
                outcomeDistribution,
                durationHistogram,
                errorCodeCensus,
                ...(firstRowAt !== undefined ? { firstRowAt } : {}),
                ...(lastRowAt !== undefined ? { lastRowAt } : {}),
                parseErrorCount,
        };
        return report;
}

/** Collects + builds + sweeps the report from the local ledger. */
export async function collectReport(deps: { root: string; fs: TelemetryFsPort; clock: Clock }): Promise<TelemetryReport> {
        const { rows, firstParseError } = await readTelemetryLedger(deps.root, deps.fs);
        const report = buildReport(rows, deps.clock(), firstParseError !== undefined ? 1 : 0);
        sweepArtifact(report, 'telemetry-report');
        return report;
}

// ---------------------------------------------------------------------------
// The render (counts only; the taxonomy labels join the error-code lines)
// ---------------------------------------------------------------------------

function renderCounts(counts: Record<string, number>): string {
        const entries = Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1));
        if (entries.length === 0) {
                return '(none)';
        }
        return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ');
}

/** Renders the aggregate report (the `flauz.telemetry.report` surface). */
export function renderReportLines(report: TelemetryReport): string[] {
        const lines: string[] = [];
        lines.push('flauz.telemetry.report -- the aggregate view of the LOCAL telemetry ledger (.flauz/telemetry/ledger.jsonl; no network, no export, nothing leaves the machine):');
        lines.push(`  rows: ${String(report.rowCount)} aggregate row(s) covering ${String(report.totalEvents)} observed event(s)${report.parseErrorCount > 0 ? ` (+${String(report.parseErrorCount)} parse error reported honestly)` : ''}`);
        if (report.firstRowAt !== undefined && report.lastRowAt !== undefined) {
                lines.push(`  observed window: ${formatTimestamp(report.firstRowAt)} .. ${formatTimestamp(report.lastRowAt)} UTC (epochs ${String(report.firstRowAt)}..${String(report.lastRowAt)} for log correlation)`);
        }
        lines.push('');
        lines.push('  per-surface event counts:');
        if (report.perSurface.length === 0) {
                lines.push('    (the ledger is empty -- either telemetry never recorded in this workspace, or every row has aged out of retention)');
        }
        for (const aggregate of report.perSurface) {
                lines.push(`    ${aggregate.surface}: ${String(aggregate.eventCount)} event(s)`);
                lines.push(`      outcomes: ${renderCounts(aggregate.outcomeCounts)}`);
                lines.push(`      durations: ${renderCounts(aggregate.durationHistogram)}`);
                if (Object.keys(aggregate.errorCodeCounts).length > 0) {
                        lines.push(`      error codes: ${renderCounts(aggregate.errorCodeCounts)}`);
                }
        }
        lines.push('');
        lines.push(`  outcome distribution (all surfaces): ${renderCounts(report.outcomeDistribution)}`);
        lines.push(`  duration histogram (all surfaces): ${renderCounts(report.durationHistogram)}`);
        const censusEntries = Object.entries(report.errorCodeCensus).sort(([a], [b]) => (a < b ? -1 : 1));
        if (censusEntries.length > 0) {
                lines.push('  error-code census (the typed failure taxonomy classes):');
                for (const [code, count] of censusEntries) {
                        const def = failureClassOf(code);
                        lines.push(`    ${code}: ${String(count)} (${def !== undefined ? def.label : 'UNKNOWN CLASS -- residue: the ledger carries a code outside the taxonomy'})`);
                }
        } else {
                lines.push('  error-code census: no failure events recorded.');
        }
        return lines;
}

/** The typed refusal helper for report-time ledger corruption (rendered by the command layer). */
export function ledgerCorruptionRefusal(detail: string): TelemetryError {
        return new TelemetryError('FLAUZ_TELEMETRY_LEDGER_CORRUPT', `flauz.telemetry.report: the local ledger has unparseable rows (${detail}) -- the parse errors are reported as counts, the parseable rows are aggregated honestly; fix or prune the ledger before relying on the totals`);
}

/** Re-export for the command layer (single import surface). */
export { joinPath };
