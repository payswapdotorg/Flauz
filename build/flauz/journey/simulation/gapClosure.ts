/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Flauz contributors. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the repository root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * CR-012 -- THE GAP-CLOSURE LEDGER.
 *
 * LAWS:
 * - PURE FUNCTION OF ITS INPUTS: buildGapLedger derives, it never
 *   mutates. The only import is a TYPE (erased at compile time), so
 *   this module is runtime-pure. Two calls with equal inputs produce
 *   deep-equal ledgers; the inputs are never modified.
 * - THE WIRINGMAP IS THE ONLY WIRED/GAP AUTHORITY: exercisedBy is
 *   evidence of RUNTIME SURFACE CONTACT, never a promotion. Every
 *   verdict defers to the map's own state; gapOwner and gapNote are
 *   carried VERBATIM.
 * - THE SURFACE MAP below is the disclosed, frozen mapping from the
 *   simulation's leg kinds to the WiringMap entries whose declared
 *   runtime surfaces those legs contact. Lab legs map to NO entry
 *   (no WiringMap entry carries the LAB authority) and are disclosed,
 *   never silently dropped.
 * - DETERMINISM: sorted aggregations, fixed iteration order, no
 *   clocks, no randomness.
 */

import type { WiringEntry } from '../../zcode-patterns/activation/common/wiring.ts';

export const GAP_LEDGER_VERSION = '1.0.0';

export type ClosureVerdict = 'closed' | 'exercised-still-gap' | 'unexercised-still-gap';

/** The structural summary of one simulation leg (simulate.ts receipts are structurally assignable). */
export interface LedgerLegSummary {
        readonly kind: string;
        readonly op: string;
        readonly evidenceLabel: string;
        readonly profileId: string;
        readonly runIndex: number;
        readonly status: string;
}

export interface ExercisedByRecord {
        readonly legKind: string;
        readonly evidenceLabel: string;
        readonly runs: number;
        readonly profiles: readonly string[];
        readonly ops: readonly string[];
        readonly note: string;
}

export interface GapLedgerEntry {
        readonly capabilityId: string;
        readonly title: string;
        readonly authority: string;
        readonly state: string;
        readonly mapEvidence: string;
        readonly gapOwner?: string;
        readonly gapNote?: string;
        readonly exercisedBy: readonly ExercisedByRecord[];
        readonly closureVerdict: ClosureVerdict;
        readonly disclosures: readonly string[];
}

export interface GapLedgerSummary {
        readonly total: number;
        readonly closed: number;
        readonly exercisedStillGap: number;
        readonly unexercisedStillGap: number;
        readonly byGapOwner: Readonly<Record<string, number>>;
        readonly exercisedCapabilityIds: readonly string[];
}

export interface GapLedger {
        readonly version: string;
        readonly entries: readonly GapLedgerEntry[];
        readonly summary: GapLedgerSummary;
        readonly disclosures: readonly string[];
}

export interface GapLedgerInput {
        readonly simulationReceipts: readonly LedgerLegSummary[];
        readonly wiringEntries: readonly WiringEntry[];
}

export const PENDING_GATE_DISCLOSURE =
        'gate.mjs (CR-008) has NOT landed on the pinned base (item-11 ruling): the simulation drove registry verify/approve/enable directly through the registry public API; the gate leg is pending -- owner CR-008';

const LAB_NO_ENTRY_DISCLOSURE =
        'no WiringMap entry carries the LAB authority: the simulation\'s lab legs are recorded in the receipts and mapped to no capability -- never silently dropped';

const EXERCISE_NEVER_PROMOTES =
        'exercise is evidence of surface contact, never a promotion: the WiringMap remains the only wired/gap authority and every verdict defers to it';

interface LegSurface {
        readonly capabilityId: string;
        readonly note: string;
}

/**
 * The disclosed, frozen leg-to-surface mapping. A leg "exercises" an
 * entry when it contacts a runtime surface that entry's own map record
 * declares (its stateSource surface or the runtime its gap names).
 */
const LEG_SURFACES: Readonly<Record<string, readonly LegSurface[]>> = {
        registry: [{ capabilityId: 'ZC-006', note: 'the CR-006 registry runtime pipeline (discover/register/verify/approve/enable) over the capability-exchange authority' }],
        query: [{ capabilityId: 'ZC-006', note: 'the registry query projection over the exchange runtime' }],
        store: [
                { capabilityId: 'ZC-002', note: 'the CR-002 background-agent runtime binding over the real OrchestrationStore' },
                { capabilityId: 'ZC-001', note: 'the AGENT_OS authority\'s orchStore seam (a ZC-001 stateSource surface)' },
        ],
        roster: [{ capabilityId: 'ZC-002', note: 'the CR-002 runtime roster projection (bus list + store graphs + journal-derived agents)' }],
        cli: [{ capabilityId: 'ZC-009', note: 'the CLI runtime (runCli) consuming the ZC-009 grammar/wire/exitcodes contracts' }],
        battery: [
                { capabilityId: 'ZC-001', note: 'the battery baseline: the driver lane over the dogfood authorities plus the j5 store seams' },
                { capabilityId: 'ZC-006', note: 'the battery baseline: the j4 registry pipeline legs' },
                { capabilityId: 'ZC-009', note: 'the battery baseline: the j6 in-process CLI legs' },
        ],
        lab: [],
};

export function buildGapLedger(input: GapLedgerInput): GapLedger {
        // Aggregate green legs per (capabilityId, legKind, evidenceLabel).
        const groups = new Map<string, { legKind: string; evidenceLabel: string; note: string; ops: Set<string>; profiles: Set<string>; runs: number }>();
        let labLegsPresent = false;
        for (const leg of input.simulationReceipts) {
                if (leg.kind === 'lab') {
                        labLegsPresent = true;
                }
                if (leg.status !== 'green') {
                        continue;
                }
                const surfaces = LEG_SURFACES[leg.kind];
                if (surfaces === undefined) {
                        continue;
                }
                for (const surface of surfaces) {
                        const key = surface.capabilityId + '|' + leg.kind + '|' + leg.evidenceLabel;
                        const group = groups.get(key) ?? {
                                legKind: leg.kind,
                                evidenceLabel: leg.evidenceLabel,
                                note: surface.note,
                                ops: new Set<string>(),
                                profiles: new Set<string>(),
                                runs: 0,
                        };
                        group.ops.add(leg.op);
                        group.profiles.add(leg.profileId);
                        group.runs += 1;
                        groups.set(key, group);
                }
        }

        const entries: GapLedgerEntry[] = [];
        const ownerCounts = new Map<string, number>();
        for (const wiring of input.wiringEntries) {
                const exercisedBy: ExercisedByRecord[] = [];
                for (const [key, group] of groups) {
                        if (key.startsWith(wiring.capabilityId + '|')) {
                                exercisedBy.push({
                                        legKind: group.legKind,
                                        evidenceLabel: group.evidenceLabel,
                                        runs: group.runs,
                                        profiles: [...group.profiles].sort(),
                                        ops: [...group.ops].sort(),
                                        note: group.note,
                                });
                        }
                }
                exercisedBy.sort((a, b) => (a.legKind < b.legKind ? -1 : a.legKind > b.legKind ? 1 : 0));
                const closureVerdict: ClosureVerdict =
                        wiring.state === 'wired' ? 'closed' : exercisedBy.length > 0 ? 'exercised-still-gap' : 'unexercised-still-gap';
                const disclosures: string[] = [];
                if (wiring.capabilityId === 'ZC-008') {
                        disclosures.push(PENDING_GATE_DISCLOSURE);
                }
                if (wiring.state === 'gap' && wiring.gapOwner !== undefined) {
                        ownerCounts.set(wiring.gapOwner, (ownerCounts.get(wiring.gapOwner) ?? 0) + 1);
                }
                entries.push({
                        capabilityId: wiring.capabilityId,
                        title: wiring.title,
                        authority: wiring.authority,
                        state: wiring.state,
                        mapEvidence: wiring.evidence,
                        ...(wiring.gapOwner !== undefined ? { gapOwner: wiring.gapOwner } : {}),
                        ...(wiring.gapNote !== undefined ? { gapNote: wiring.gapNote } : {}),
                        exercisedBy,
                        closureVerdict,
                        disclosures,
                });
        }

        const byGapOwner: Record<string, number> = {};
        for (const owner of [...ownerCounts.keys()].sort()) {
                byGapOwner[owner] = ownerCounts.get(owner) ?? 0;
        }
        const ledgerDisclosures = [EXERCISE_NEVER_PROMOTES];
        if (labLegsPresent) {
                ledgerDisclosures.push(LAB_NO_ENTRY_DISCLOSURE);
        }

        return {
                version: GAP_LEDGER_VERSION,
                entries,
                summary: {
                        total: entries.length,
                        closed: entries.filter((entry) => entry.closureVerdict === 'closed').length,
                        exercisedStillGap: entries.filter((entry) => entry.closureVerdict === 'exercised-still-gap').length,
                        unexercisedStillGap: entries.filter((entry) => entry.closureVerdict === 'unexercised-still-gap').length,
                        byGapOwner,
                        exercisedCapabilityIds: entries.filter((entry) => entry.exercisedBy.length > 0).map((entry) => entry.capabilityId).sort(),
                },
                disclosures: ledgerDisclosures,
        };
}