/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * The heartbeat core (A-PROD-005-W4): the `flauz.durability.heartbeat`
 * semantics -- the worker's own liveness signal.
 *
 * THE LIVENESS LAW (typed, never a guessed verdict, evaluated with the
 * injected clock at the beat's arrival -- the PRE-BEAT observation, what
 * the supervision plane saw when the signal came in):
 *
 *   UNKNOWN -- the lane is not registered: a TYPED REFUSAL (never a record
 *              with a guessed verdict; the refusal renders the gate);
 *   FLAT    -- no beat EVER and one interval has passed since registration
 *              (the lane never signalled: the first beat below arrives
 *              after the flat window opened);
 *   STALE   -- beats exist and the gap since the last beat is past the
 *              lane's staleness threshold (the lane went silent);
 *   LIVE    -- the complement: a fresh last beat within the threshold, or a
 *              beatless lane still inside its first interval (the startup
 *              grace window -- disclosed, never silently green).
 *
 * A STALE/FLAT classification triggers the lane's ESCALATION POLICY RECORD:
 * the machinery RECORDS the escalation demand (what the policy demands --
 * notify / checkpoint-and-restart / refuse). The EXECUTION of an actual
 * restart routes through the owning task's own machinery -- disclosed in
 * every record + render, never claimed here.
 *
 * The beat history is a BOUNDED RING: the last BEAT_RING_CAP stamps. The
 * record persists `.flauz/durability/heartbeat-<stamp>.json`
 * (`flauz.durability-heartbeat/v1`), swept fail-closed + banked
 * census-visible (taskId `flauz-durability`).
 */

import {
        type Clock,
        type DurabilityFsPort,
        type LaneRecord,
        type LivenessClass,
        type EscalationPolicy,
        type LanesRecord,
        BEAT_RING_CAP,
        DURABILITY_DIR,
        DurabilityError,
        EXTENSION_ID,
        HEARTBEAT_PREFIX,
        HEARTBEAT_SCHEMA_ID,
        joinPath,
        readLanesRegistry,
        serializeArtifact,
} from './api.ts';
import { persistLanes, durabilityStamp } from './lanes.ts';
import { bankRecord, type BankingOutcome } from './banking.ts';
import { sweepArtifact } from './privacy.ts';

/** The heartbeat record (schema `flauz.durability-heartbeat/v1`). */
export interface HeartbeatRecord {
        readonly $schema: typeof HEARTBEAT_SCHEMA_ID;
        readonly schemaVersion: 0;
        readonly kind: 'flauz-durability-heartbeat';
        readonly createdAt: number;
        readonly extensionId: typeof EXTENSION_ID;
        /** The honest-boundary disclosure, verbatim in every record. */
        readonly boundaryDisclosure: string;
        readonly laneId: string;
        readonly owner: string;
        /** The beat's stamp (the injected clock -- the ONLY timestamp source). */
        readonly beatAt: number;
        /** The lane's total beat count after this beat. */
        readonly beatCount: number;
        /** The bounded ring after this beat (the last N stamps, ascending). */
        readonly ring: readonly number[];
        /** The PRE-BEAT liveness observation (the law above). */
        readonly liveness: LivenessClass;
        /** The escalation demand the classification triggered (present ONLY on STALE/FLAT). */
        readonly escalation?: {
                readonly policy: EscalationPolicy;
                readonly demandedAt: number;
                /** The execution boundary, verbatim (the record-keeping-vs-execution law). */
                readonly executionBoundary: string;
        };
}

/** The heartbeat outcome (command-level). */
export interface HeartbeatResult {
        readonly ok: true;
        readonly record: HeartbeatRecord;
        /** The post-beat lane registry (the ring + escalation state persisted). */
        readonly lanes: LanesRecord;
        readonly persisted: PersistedHeartbeat;
}

/** The persisted outcome. */
export interface PersistedHeartbeat {
        readonly recordPath: string;
        readonly record: HeartbeatRecord;
        readonly banking: BankingOutcome;
}

/** The honest-boundary disclosure carried by every heartbeat record + render. */
export const BOUNDARY_DISCLOSURE = 'THE HONEST BOUNDARY: this extension proves the RECORD-KEEPING + VERDICT machinery (lane registry, heartbeat ring, escalation-demand records, supervision verdicts); the EXECUTION of an actual restart routes through the owning task\'s own machinery -- cross-process supervision is the host\'s orchestration posture (disclosed, never claimed; the W3 host-isolation posture). Evidence level: local-real.';

/** Parses the heartbeat argument ({ laneId }) -- the typed refusal surface. */
export function parseHeartbeatArgs(arg: unknown): string {
        if (!arg || typeof arg !== 'object' || Array.isArray(arg)) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.heartbeat: the argument must be { laneId }');
        }
        const record = arg as Record<string, unknown>;
        if (typeof record.laneId !== 'string' || record.laneId.length === 0) {
                throw new DurabilityError('FLAUZ_DURABILITY_BAD_ARGS', 'flauz.durability.heartbeat: laneId must be a non-empty string (the lane whose worker is signalling)');
        }
        return record.laneId;
}

/**
 * The liveness classification law (exported for the status plane + the
 * suite): the PRE-BEAT observation of a lane at `now`.
 */
export function classifyLiveness(lane: LaneRecord, now: number): LivenessClass {
        const lastBeat = lane.beats.length > 0 ? lane.beats[lane.beats.length - 1] : undefined;
        if (lastBeat === undefined) {
                // FLAT: no beat ever, past one interval since registration.
                // The complement (inside the first interval) is the startup
                // grace window: LIVE, disclosed -- never a silent green.
                return now - lane.registeredAt > lane.heartbeatIntervalMs ? 'FLAT' : 'LIVE';
        }
        return now - lastBeat > lane.stalenessThresholdMs ? 'STALE' : 'LIVE';
}

/** Stamps one beat: the ring push with the cap, ascending. */
function stampBeat(lane: LaneRecord, at: number): readonly number[] {
        return [...lane.beats, at].slice(-BEAT_RING_CAP);
}

/**
 * Records one heartbeat for a lane. UNKNOWN (lane not registered) is a
 * TYPED REFUSAL -- no record, no guessed verdict. The PRE-BEAT liveness
 * observation classifies; STALE/FLAT triggers the escalation-demand record;
 * the beat then stamps the ring.
 */
export async function recordHeartbeat(deps: { root: string; fs: DurabilityFsPort; clock: Clock }, laneId: string): Promise<HeartbeatResult> {
        const registry = await readLanesRegistry(deps.root, deps.fs);
        if (registry.state === 'torn') {
                throw new DurabilityError('FLAUZ_DURABILITY_FORMAT', `flauz.durability.heartbeat: REFUSED -- the lane registry is torn (${registry.reason}); a beat would silently erase the torn evidence -- route to the operator`);
        }
        const lane = registry.state === 'resolved' ? registry.record.lanes.find(candidate => candidate.laneId === laneId) : undefined;
        if (lane === undefined) {
                throw new DurabilityError('FLAUZ_DURABILITY_UNKNOWN_LANE', `flauz.durability.heartbeat: REFUSED -- lane '${laneId}' is not registered (UNKNOWN is a typed refusal, never a guessed verdict; register the lane first with flauz.durability.register)`);
        }
        if (registry.state !== 'resolved') {
                throw new DurabilityError('FLAUZ_DURABILITY_FORMAT', 'flauz.durability.heartbeat: REFUSED -- the lane registry is absent (unreachable: the unknown-lane refusal fired first)');
        }
        const resolvedRegistry: LanesRecord = registry.record;

        const at = deps.clock();
        const preBeat = classifyLiveness(lane, at);
        const ring = stampBeat(lane, at);
        const escalationDemand = preBeat === 'STALE' || preBeat === 'FLAT';

        const updatedLane: LaneRecord = {
                ...lane,
                updatedAt: at,
                beats: ring,
                totalBeats: lane.totalBeats + 1,
                escalation: {
                        policy: lane.escalationPolicy,
                        demandCount: lane.escalation.demandCount + (escalationDemand ? 1 : 0),
                        ...(escalationDemand || lane.escalation.lastDemandAt !== undefined ? { lastDemandAt: escalationDemand ? at : lane.escalation.lastDemandAt } : {}),
                },
        };
        const lanes: LanesRecord = {
                ...resolvedRegistry,
                updatedAt: at,
                lanes: resolvedRegistry.lanes.map(candidate => candidate.laneId === laneId ? updatedLane : candidate),
        };

        const record: HeartbeatRecord = {
                $schema: HEARTBEAT_SCHEMA_ID,
                schemaVersion: 0,
                kind: 'flauz-durability-heartbeat',
                createdAt: at,
                extensionId: EXTENSION_ID,
                boundaryDisclosure: BOUNDARY_DISCLOSURE,
                laneId,
                owner: lane.owner,
                beatAt: at,
                beatCount: updatedLane.totalBeats,
                ring,
                liveness: preBeat,
                ...(escalationDemand ? { escalation: { policy: lane.escalationPolicy, demandedAt: at, executionBoundary: 'the machinery RECORDS this escalation demand; the execution of an actual restart routes through the owning task\'s own machinery (disclosed, never claimed here)' } } : {}),
        };

        // the registry carries the post-beat ring + escalation state; the
        // record carries the observation. Both swept; both banked.
        await persistLanes(deps, lanes);

        const recordLine = serializeArtifact(record);
        const stamp = durabilityStamp(at);
        const recordRelPath = joinPath(DURABILITY_DIR, `${HEARTBEAT_PREFIX}${stamp}.json`);
        const recordPath = joinPath(deps.root, recordRelPath);
        await deps.fs.mkdir(joinPath(deps.root, DURABILITY_DIR));
        await deps.fs.writeFile(recordPath, recordLine);
        const banking = await bankRecord(deps, record, recordLine, recordRelPath);

        return { ok: true, record, lanes, persisted: { recordPath, record, banking } };
}

/** Renders the heartbeat outcome (the disclosure-first law). */
export function renderHeartbeat(result: HeartbeatResult): string[] {
        const lines: string[] = [];
        lines.push(`  lane: ${result.record.laneId} (owner ${result.record.owner})`);
        lines.push(`  beat at: ${result.record.beatAt} (the injected clock -- the only timestamp source)`);
        lines.push(`  PRE-BEAT liveness: ${result.record.liveness}${result.record.liveness === 'LIVE' ? ' (the complement: a fresh last beat, or a beatless lane inside its startup grace window -- disclosed)' : ''}`);
        lines.push(`  ring: ${result.record.ring.length}/${BEAT_RING_CAP} stamps (the last N beats; total beats ${result.record.beatCount})`);
        if (result.record.escalation !== undefined) {
                lines.push(`  ESCALATION DEMAND RECORDED: policy '${result.record.escalation.policy}' demanded at ${result.record.escalation.demandedAt} -- the machinery records the demand; the execution of an actual restart routes through the owning task's own machinery (disclosed, never claimed)`);
        }
        return lines;
}

/** Sweeps a whole assembled heartbeat record (the pre-write backstop; exposed for the suite). */
export function sweepHeartbeatRecord(record: HeartbeatRecord): void {
        sweepArtifact(record, 'durability-heartbeat-record');
}
