/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The supervised-lane registry core (A-PROD-005-W4): the
 * `flauz.durability.register` semantics.
 *
 * A lane id is UNIQUE: re-registering an id REFRESHES its policy (the
 * interval, the threshold, the escalation policy -- the owning task stays
 * the lane's own to re-claim), never duplicates. The ring + the escalation
 * state survive a refresh (the lane's HISTORY is the workspace's, not the
 * registration call's).
 *
 * The registry persists `.flauz/durability/lanes.json`
 * (`flauz.durability-lanes/v1`), swept fail-closed + banked
 * census-visible (taskId `flauz-durability`) -- the W3 record discipline.
 *
 * Typed refusals, never a guessed verdict: bad args refuse the whole
 * operation (the registry is never partially written); a torn registry
 * refuses a refresh that would silently erase the torn evidence.
 */

import {
        type Clock,
        type DurabilityFsPort,
        type LaneRecord,
        type LanesRecord,
        type EscalationPolicy,
        BEAT_RING_CAP,
        DURABILITY_DIR,
        DurabilityError,
        ESCALATION_POLICIES,
        EXTENSION_ID,
        joinPath,
        LANES_FILENAME,
        LANES_SCHEMA_ID,
        readLanesRegistry,
        serializeArtifact,
} from './api.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';
import { toIsoStamp } from './format.ts';

/** The register command's typed arguments (commands carry DATA only). */
export interface RegisterArgs {
        readonly laneId: string;
        readonly owner: string;
        readonly heartbeatIntervalMs: number;
        readonly stalenessThresholdMs: number;
        readonly escalationPolicy: EscalationPolicy;
}

/** Parses + validates the register arguments (the typed refusal surface). */
export function parseRegisterArgs(arg: unknown): RegisterArgs {
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.register: the argument must be { laneId, owner, heartbeatIntervalMs, stalenessThresholdMs, escalationPolicy }');
        }
        const record = arg as Record<string, unknown>;
        if (typeof record.laneId !== 'string' || record.laneId.length === 0) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.register: laneId must be a non-empty string (the lane\'s unique id)');
        }
        if (typeof record.owner !== 'string' || record.owner.length === 0) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.register: owner must be a non-empty string (the owning task/extension -- the checkpoint-law consultation\'s subject)');
        }
        if (typeof record.heartbeatIntervalMs !== 'number' || !Number.isSafeInteger(record.heartbeatIntervalMs) || record.heartbeatIntervalMs <= 0) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.register: heartbeatIntervalMs must be a positive integer (the interval the lane\'s worker promised)');
        }
        if (typeof record.stalenessThresholdMs !== 'number' || !Number.isSafeInteger(record.stalenessThresholdMs) || record.stalenessThresholdMs <= 0) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.register: stalenessThresholdMs must be a positive integer (a beat gap past this is STALE)');
        }
        if (typeof record.escalationPolicy !== 'string' || !(ESCALATION_POLICIES as readonly string[]).includes(record.escalationPolicy)) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', `flauz.durability.register: escalationPolicy must be one of ${ESCALATION_POLICIES.join('|')} (notify / checkpoint-and-restart / refuse -- the escalation the lane's policy demands)`);
        }
        return {
                laneId: record.laneId,
                owner: record.owner,
                heartbeatIntervalMs: record.heartbeatIntervalMs,
                stalenessThresholdMs: record.stalenessThresholdMs,
                escalationPolicy: record.escalationPolicy as EscalationPolicy,
        };
}

/** The register outcome (command-level). */
export interface RegisterResult {
        readonly ok: true;
        readonly laneId: string;
        /** True when this call REFRESHED an existing lane's policy (never a duplicate). */
        readonly refreshed: boolean;
        readonly laneCount: number;
        readonly record: LanesRecord;
        readonly persisted: PersistedLanes;
}

/** The persisted outcome. */
export interface PersistedLanes {
        readonly recordPath: string;
        readonly record: LanesRecord;
        readonly banking: BankingOutcome;
}

/** The lanes registry's workspace-relative path (the record + banked uri). */
export const LANES_RECORD_PATH = joinPath(DURABILITY_DIR, LANES_FILENAME);

/**
 * Registers (or refreshes) one supervised worker lane. Uniqueness law: a
 * lane id is unique -- re-registering refreshes the policy (interval,
 * threshold, escalation) and the owning task, never duplicates; the ring +
 * escalation state survive. A TORN registry refuses (typed) rather than
 * silently erasing the torn evidence.
 */
export async function registerLane(deps: { root: string; fs: DurabilityFsPort; clock: Clock }, args: RegisterArgs): Promise<RegisterResult> {
        const registry = await readLanesRegistry(deps.root, deps.fs);
        if (registry.state === 'torn') {
                throw new DurabilityError('FLAUZ_DURABILITY_FORMAT', `flauz.durability.register: REFUSED -- the lane registry is torn (${registry.reason}); a refresh would silently erase the torn evidence -- route to the operator`);
        }
        const at = deps.clock();
        const existing = registry.state === 'resolved' ? registry.record.lanes.find(lane => lane.laneId === args.laneId) : undefined;
        const refreshed = existing !== undefined;

        const lane: LaneRecord = {
                laneId: args.laneId,
                owner: args.owner,
                heartbeatIntervalMs: args.heartbeatIntervalMs,
                stalenessThresholdMs: args.stalenessThresholdMs,
                escalationPolicy: args.escalationPolicy,
                registeredAt: existing !== undefined ? existing.registeredAt : at,
                updatedAt: at,
                beats: existing !== undefined ? [...existing.beats].slice(-BEAT_RING_CAP) : [],
                totalBeats: existing !== undefined ? existing.totalBeats : 0,
                escalation: existing !== undefined
                        ? { policy: args.escalationPolicy, demandCount: existing.escalation.demandCount, ...(existing.escalation.lastDemandAt !== undefined ? { lastDemandAt: existing.escalation.lastDemandAt } : {}) }
                        : { policy: args.escalationPolicy, demandCount: 0 },
        };

        const baseLanes: readonly LaneRecord[] = registry.state === 'resolved' ? registry.record.lanes : [];
        const lanes = refreshed
                ? baseLanes.map(candidate => candidate.laneId === args.laneId ? lane : candidate)
                : [...baseLanes, lane];

        const record: LanesRecord = {
                $schema: LANES_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-durability-lanes',
                createdAt: registry.state === 'resolved' ? registry.record.createdAt : at,
                updatedAt: at,
                extensionId: EXTENSION_ID,
                lanes: [...lanes].sort((a, b) => (a.laneId < b.laneId ? -1 : a.laneId > b.laneId ? 1 : 0)),
        };

        const persisted = await persistLanes(deps, record);
        return { ok: true, laneId: args.laneId, refreshed, laneCount: record.lanes.length, record, persisted };
}

/** Persists the lanes registry the W3 way: swept, written, banked census-visible. */
export async function persistLanes(deps: { root: string; fs: DurabilityFsPort; clock: Clock }, record: LanesRecord): Promise<PersistedLanes> {
        const recordLine = serializeArtifact(record);
        const recordPath = joinPath(deps.root, LANES_RECORD_PATH);
        await deps.fs.mkdir(joinPath(deps.root, DURABILITY_DIR));
        await deps.fs.writeFile(recordPath, recordLine);
        const banking = await bankRecord(deps, record, recordLine, LANES_RECORD_PATH);
        return { recordPath, record, banking };
}

/** Renders the register outcome (the disclosure-first law). */
export function renderRegister(result: RegisterResult): string[] {
        const lines: string[] = [];
        lines.push(`  lane: ${result.laneId} ${result.refreshed ? '(POLICY REFRESHED -- a lane id is unique, re-registering refreshes its policy, never duplicates; the ring + escalation state survive)' : '(REGISTERED)'}`);
        lines.push(`    owner: ${result.record.lanes.find(lane => lane.laneId === result.laneId)?.owner ?? result.laneId}`);
        lines.push(`    heartbeat interval: ${result.record.lanes.find(lane => lane.laneId === result.laneId)?.heartbeatIntervalMs ?? '?'}ms · staleness threshold: ${result.record.lanes.find(lane => lane.laneId === result.laneId)?.stalenessThresholdMs ?? '?'}ms · escalation policy: ${result.record.lanes.find(lane => lane.laneId === result.laneId)?.escalationPolicy ?? '?'}`);
        lines.push(`    registered lanes: ${result.laneCount}`);
        return lines;
}

/** The filename-safe stamp helper (the export-stamp convention; exposed for the record paths). */
export function durabilityStamp(epochMs: number): string {
        return toIsoStamp(epochMs).replaceAll(':', '');
}
