/*
 * MIT License
 * Copyright (c) 2025 the Flauz contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
 * CR-001 - pure coverage/gap resolvers over the activation WiringMap.
 *
 * SIBLING LAW: this module imports NOTHING. The WiringEntryView shape below is
 * a structural mirror of WiringEntry in common/wiring.ts; TypeScript structural
 * typing makes the real entries assignable here with no import edge. The
 * frozen vocabularies are mirrored locally on purpose - the test suite
 * cross-checks that both copies agree.
 */

export type WiringState = 'wired' | 'gap';

export type EvidenceKind =
        | 'fixture'
        | 'simulated'
        | 'local-real'
        | 'runtime-real'
        | 'live-provider'
        | 'production-real';

export type GapOwnerId =
        | 'CR-002'
        | 'CR-003'
        | 'CR-004'
        | 'CR-005'
        | 'CR-006'
        | 'CR-007'
        | 'CR-008'
        | 'CR-009'
        | 'CR-010';

export interface RuntimeEntryPointView {
        path: string;
        exportName?: string;
        role: string;
}

export interface WiringEntryView {
        capabilityId: string;
        title: string;
        contractModules: string[];
        authority: string;
        state: WiringState;
        entryPoints: RuntimeEntryPointView[];
        stateSource: string;
        projection: string;
        tests: string[];
        evidence: EvidenceKind;
        gapOwner?: GapOwnerId;
        gapNote?: string;
}

/** The frozen authority vocabulary (mirrors AUTHORITIES in common/wiring.ts). */
export const AUTHORITY_IDS: readonly string[] = [
        'AGENT_OS',
        'WORKSPACE_OS',
        'EXECUTION',
        'WORKFLOW',
        'MEMORY',
        'LAB',
        'BROWSER',
        'MODELS',
        'RESOURCES',
        'INTEGRITY',
        'ENVIRONMENTS',
        'ACCEPTANCE',
        'CAPABILITY_EXCHANGE'
];

/** The frozen evidence vocabulary (mirrors WiringEntry['evidence']). */
export const EVIDENCE_KINDS: readonly string[] = [
        'fixture',
        'simulated',
        'local-real',
        'runtime-real',
        'live-provider',
        'production-real'
];

/** The frozen gap-owner vocabulary (mirrors WiringEntry['gapOwner']). */
export const GAP_OWNER_IDS: readonly string[] = [
        'CR-002',
        'CR-003',
        'CR-004',
        'CR-005',
        'CR-006',
        'CR-007',
        'CR-008',
        'CR-009',
        'CR-010'
];

export function wiredEntries(entries: readonly WiringEntryView[]): WiringEntryView[] {
        return entries.filter((entry) => entry.state === 'wired');
}

export function gapEntries(entries: readonly WiringEntryView[]): WiringEntryView[] {
        return entries.filter((entry) => entry.state === 'gap');
}

export function entriesForAuthority(
        entries: readonly WiringEntryView[],
        authority: string
): WiringEntryView[] {
        return entries.filter((entry) => entry.authority === authority);
}

export function allContractModules(entries: readonly WiringEntryView[]): string[] {
        const seen = new Set<string>();
        for (const entry of entries) {
                for (const mod of entry.contractModules) {
                        seen.add(mod);
                }
        }
        return [...seen].sort();
}

export type WiringInvariantResult =
        | { ok: true }
        | { ok: false; violations: string[] };

/**
 * The pure law-checker for one WiringEntry:
 * - entryPoints MUST be [] when gap and non-empty when wired;
 * - gapOwner/gapNote MUST be present when gap and absent when wired;
 * - authority MUST be a member of the frozen authority table;
 * - contractModules MUST be non-empty;
 * - evidence MUST be a member of the frozen evidence vocabulary.
 */
export function wiringInvariant(entry: WiringEntryView): WiringInvariantResult {
        const violations: string[] = [];
        const id = entry.capabilityId;

        if (entry.state !== 'wired' && entry.state !== 'gap') {
                violations.push(`${id}: state must be 'wired' or 'gap' (got '${String(entry.state)}')`);
        }
        if (entry.state === 'gap' && entry.entryPoints.length !== 0) {
                violations.push(`${id}: gap entries MUST declare an empty entryPoints array`);
        }
        if (entry.state === 'wired' && entry.entryPoints.length === 0) {
                violations.push(`${id}: wired entries MUST declare at least one entryPoint`);
        }
        if (entry.state === 'gap') {
                if (entry.gapOwner === undefined || (entry.gapOwner as string) === '') {
                        violations.push(`${id}: gap entries MUST carry a gapOwner`);
                }
                if (entry.gapNote === undefined || entry.gapNote.trim() === '') {
                        violations.push(`${id}: gap entries MUST carry a non-empty gapNote`);
                }
        } else {
                if (entry.gapOwner !== undefined) {
                        violations.push(`${id}: wired entries MUST NOT carry a gapOwner`);
                }
                if (entry.gapNote !== undefined && entry.gapNote.trim() !== '') {
                        violations.push(`${id}: wired entries MUST NOT carry a gapNote`);
                }
        }
        if (!AUTHORITY_IDS.includes(entry.authority)) {
                violations.push(`${id}: authority '${String(entry.authority)}' is not in the frozen authority table`);
        }
        if (!Array.isArray(entry.contractModules) || entry.contractModules.length === 0) {
                violations.push(`${id}: contractModules MUST be non-empty`);
        }
        if (!EVIDENCE_KINDS.includes(entry.evidence)) {
                violations.push(`${id}: evidence '${String(entry.evidence)}' is not in the frozen evidence vocabulary`);
        }
        return violations.length === 0 ? { ok: true } : { ok: false, violations };
}