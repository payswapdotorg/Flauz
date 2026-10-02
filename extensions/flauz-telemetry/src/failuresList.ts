/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The failure census (A-PROD-004-W4) -- the `flauz.failures.list` operator
 * UX: the provider/environment failure handling the beta gate demands.
 *
 * Failures become FIRST-CLASS queryable state, not scattered logs: the
 * census reads the local telemetry ledger's failure rows (the typed taxonomy
 * classes the record pass typed), groups them by failure class, and renders
 * -- per class -- the label, the affected surfaces, the affected identities
 * (ids only), the event count, the time distribution (per-day buckets over
 * the retention window), the first/last observation, and the operator-facing
 * remediation hint from the taxonomy. Classes with taxonomy residue (a code
 * outside the live taxonomy) render flagged, never silently dropped.
 *
 * The "recent" window is the config's retention window (the same policy that
 * bounds the ledger): failures older than the retention are no longer in the
 * ledger, so the census window and the ledger contents agree by construction.
 */

import { loadTelemetryConfig } from './config.ts';
import { readTelemetryLedger } from './record.ts';
import { failureClassOf, type FailureClassDef } from './failures.ts';
import { sweepArtifact } from './privacy.ts';
import { formatDate, formatTimestamp } from './format.ts';
import type { TelemetryRow } from './config.ts';
import type { Clock, TelemetryFsPort } from './api.ts';

// ---------------------------------------------------------------------------
// The census shape
// ---------------------------------------------------------------------------

/** The failure census schema id. */
export const TELEMETRY_FAILURES_SCHEMA_ID = 'flauz.telemetry-failures/v1';

/** One class group of the census. */
export interface FailureClassGroup {
        readonly failureClass: string;
        readonly label: string;
        readonly surfaces: readonly string[];
        /** The affected identities across the group's rows (ids only; capped for render sanity). */
        readonly affectedIdentities: readonly string[];
        readonly eventCount: number;
        /** Per-day buckets (ISO yyyy-mm-dd of the row stamp) over the census window. */
        readonly timeDistribution: Record<string, number>;
        readonly firstAt?: number;
        readonly lastAt?: number;
        readonly remediation: string;
        /** True when the ledger carries a failure code the live taxonomy does not define (residue; rendered flagged). */
        readonly unknownClass?: boolean;
}

/** The whole failure census (the render source). */
export interface FailureCensus {
        readonly $schema: typeof TELEMETRY_FAILURES_SCHEMA_ID;
        readonly generatedAt: number;
        readonly windowDays: number;
        readonly totalFailures: number;
        readonly classes: readonly FailureClassGroup[];
        readonly parseErrorCount: number;
}

/** The UTC calendar day of an epoch-ms stamp (the shared format module's day discipline; days are metadata). */
function isoDay(at: number): string {
        return formatDate(at);
}

function bump(map: Record<string, number>, key: string): void {
        map[key] = (map[key] ?? 0) + 1;
}

const MAX_IDENTITIES_PER_CLASS = 12;

/** Builds the census from the ledger's failure rows. */
export function buildCensus(rows: readonly TelemetryRow[], generatedAt: number, windowDays: number, parseErrorCount: number): FailureCensus {
        const groups = new Map<string, {
                failureClass: string;
                surfaces: Set<string>;
                identities: string[];
                eventCount: number;
                timeDistribution: Record<string, number>;
                firstAt: number | undefined;
                lastAt: number | undefined;
                unknownClass: boolean;
                def: FailureClassDef | undefined;
        }>();

        for (const row of rows) {
                if (row.eventKind !== 'failure' || row.errorCode === undefined) {
                        continue;
                }
                const code = row.errorCode;
                let group = groups.get(code);
                if (group === undefined) {
                        const def = failureClassOf(code);
                        group = {
                                failureClass: code,
                                surfaces: new Set<string>(),
                                identities: [],
                                eventCount: 0,
                                timeDistribution: {},
                                firstAt: undefined,
                                lastAt: undefined,
                                unknownClass: def === undefined,
                                def,
                        };
                        groups.set(code, group);
                }
                group.surfaces.add(row.surface);
                if (row.identity !== undefined) {
                        for (const [field, value] of Object.entries(row.identity).sort(([a], [b]) => (a < b ? -1 : 1))) {
                                const identity = `${field}:${value}`;
                                if (!group.identities.includes(identity) && group.identities.length < MAX_IDENTITIES_PER_CLASS) {
                                        group.identities.push(identity);
                                }
                        }
                }
                group.eventCount += row.count;
                bump(group.timeDistribution, isoDay(row.at));
                group.firstAt = group.firstAt === undefined ? row.at : Math.min(group.firstAt, row.at);
                group.lastAt = group.lastAt === undefined ? row.at : Math.max(group.lastAt, row.at);
        }

        const classes: FailureClassGroup[] = [...groups.values()]
                .sort((a, b) => (a.failureClass < b.failureClass ? -1 : 1))
                .map(group => ({
                        failureClass: group.failureClass,
                        label: group.def?.label ?? `UNKNOWN (${group.failureClass})`,
                        surfaces: [...group.surfaces].sort(),
                        affectedIdentities: group.identities,
                        eventCount: group.eventCount,
                        timeDistribution: group.timeDistribution,
                        ...(group.firstAt !== undefined ? { firstAt: group.firstAt } : {}),
                        ...(group.lastAt !== undefined ? { lastAt: group.lastAt } : {}),
                        remediation: group.def?.remediation ?? 'RESIDUE: this failure code is outside the live taxonomy -- report it for a later wave (never improvised here).',
                        ...(group.unknownClass ? { unknownClass: true } : {}),
                }));

        const census: FailureCensus = {
                $schema: TELEMETRY_FAILURES_SCHEMA_ID,
                generatedAt,
                windowDays,
                totalFailures: classes.reduce((sum, group) => sum + group.eventCount, 0),
                classes,
                parseErrorCount,
        };
        return census;
}

/** Collects + builds + sweeps the failure census (the retention window bounds "recent"). */
export async function collectFailureCensus(deps: { root: string; fs: TelemetryFsPort; clock: Clock }): Promise<FailureCensus> {
        const config = await loadTelemetryConfig(deps.root, deps.fs);
        const { rows, firstParseError } = await readTelemetryLedger(deps.root, deps.fs);
        const census = buildCensus(rows, deps.clock(), config.retentionDays, firstParseError !== undefined ? 1 : 0);
        sweepArtifact(census, 'telemetry-failure-census');
        return census;
}

// ---------------------------------------------------------------------------
// The render
// ---------------------------------------------------------------------------

/** Renders the failure census (the `flauz.failures.list` surface). */
export function renderCensusLines(census: FailureCensus): string[] {
        const lines: string[] = [];
        lines.push('flauz.failures.list -- the recent failure census (typed provider/environment failures from the local telemetry ledger; first-class queryable state, not scattered logs):');
        lines.push(`  window: the retention window (${String(census.windowDays)} day(s)); total failure events: ${String(census.totalFailures)}${census.parseErrorCount > 0 ? ` (+${String(census.parseErrorCount)} ledger parse error reported honestly)` : ''}`);
        if (census.classes.length === 0) {
                lines.push('  (no failure events in the window -- either nothing failed on the observed surfaces, or telemetry recorded while everything was healthy)');
                return lines;
        }
        lines.push('');
        for (const group of census.classes) {
                lines.push(`  [${group.failureClass}] ${group.label}${group.unknownClass === true ? ' -- UNKNOWN CLASS: residue, report it for a later wave' : ''}`);
                lines.push(`    surfaces: ${group.surfaces.join(', ')}`);
                if (group.affectedIdentities.length > 0) {
                        lines.push(`    affected identities (ids only): ${group.affectedIdentities.join(', ')}${group.affectedIdentities.length >= MAX_IDENTITIES_PER_CLASS ? ' (capped for render)' : ''}`);
                }
                lines.push(`    events: ${String(group.eventCount)}; observed ${formatTimestamp(group.firstAt ?? 0)} .. ${formatTimestamp(group.lastAt ?? 0)} UTC (epochs ${String(group.firstAt ?? 0)}..${String(group.lastAt ?? 0)})`);
                const days = Object.entries(group.timeDistribution).sort(([a], [b]) => (a < b ? -1 : 1));
                if (days.length > 0) {
                        lines.push(`    time distribution: ${days.map(([day, count]) => `${day}=${String(count)}`).join(' ')}`);
                }
                lines.push(`    remediation: ${group.remediation}`);
                lines.push('');
        }
        lines.push('  (diagnosability: every record pass banks a census-visible evidence-ledger note row -- flauz.diag.show reports the telemetry activity; the report command renders the full aggregate view.)');
        return lines;
}
