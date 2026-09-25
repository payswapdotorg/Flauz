/*---------------------------------------------------------------------------------------------
 *  flauz-workspace — src/checkpoint.ts
 *
 *  chatEditing checkpoint interop. Reachability analysis at mirror HEAD 9bf9ae764da:
 *
 *  Workbench-internal snapshot surface (NOT extension-reachable):
 *    - src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSession.ts:386-423
 *      createSnapshot(requestId, undoStop) / restoreSnapshot(requestId, stopId)
 *    - persistence via chatEditingSessionStorage.ts:22-47
 *      (workspaceStorage/<wsId>/chatEditingSessions, state.json + contents/)
 *    - driven by chatEditingServiceImpl.ts:236 (auto createSnapshot on request start)
 *      and :371 (createSnapshot on 'undoStop' response change)
 *
 *  Extension-reachable path at HEAD:
 *    - ChatResultStream.externalEdit(target, callback) —
 *      src/vs/workbench/api/common/extHostChatAgents2.ts:316-330 — mints a platform
 *      undoStopId (generateUuid), relays 'externalEdits' start/stop to
 *      mainThreadChatAgents2.ts:495 (startExternalEdits), and RETURNS the undoStopId
 *      to the extension. This works only INSIDE a live chat request.
 *
 *  Consequence: out-of-band createCheckpoint (no live request) and restore are NOT
 *  reachable at HEAD. Per DL-4 (built-ins may use proposed APIs, zero promotion, no
 *  workarounds) the blocked path returns {checkpointRef: null} and records a gap row
 *  in the evidence ledger instead of faking a reference. Promotion proposals for a
 *  real out-of-band surface live in REPORT §DECISION-LOG-PROPOSALS (DL-17).
 *
 *  Decision matrix:
 *    - 'verified'  — platform-issued snapshot confirmed by the platform itself.
 *                    UNREACHABLE at HEAD (no query/mint API outside a live request).
 *    - 'attested'  — caller holds an undoStopId obtained from externalEdit() within
 *                    `requestId`. Accepted and recorded as attested (never verified).
 *    - 'blocked'   — no stopId, no live request: {checkpointRef: null} + gap row.
 *--------------------------------------------------------------------------------------------*/

import { type Clock, canonicalJson, sha256Hex } from './api.ts';
import type { TaskService } from './taskService.ts';
import type { EvidenceLedger } from './ledger.ts';

/** URI of the note-kind ledger row recorded when the blocked path is hit. */
export const GAP_CHECKPOINT_URI = 'flauz://gap/checkpoint-out-of-band-unreachable';

export interface CheckpointRequest {
        readonly taskId: string;
        readonly requestId: string;
        readonly stopId?: string | null;
}

export interface CheckpointOutcome {
        readonly checkpointRef: string | null;
        readonly mode: 'attested' | 'blocked';
        readonly gapSeq?: number;
}

export class CheckpointInterop {
        private readonly tasks: TaskService;
        private readonly ledger: EvidenceLedger;
        private readonly clock: Clock;

        constructor(tasks: TaskService, ledger: EvidenceLedger, clock: Clock) {
                this.tasks = tasks;
                this.ledger = ledger;
                this.clock = clock;
        }

        async create(request: CheckpointRequest): Promise<CheckpointOutcome> {
                if (typeof request.taskId !== 'string' || request.taskId.length === 0) {
                        throw new Error('flauz.workspace.createCheckpoint: taskId must be a non-empty string');
                }
                if (typeof request.requestId !== 'string' || request.requestId.length === 0) {
                        throw new Error('flauz.workspace.createCheckpoint: requestId must be a non-empty string');
                }
                // Unknown-task check (throws with the standard message).
                await this.tasks.getTask(request.taskId);

                const stopId = typeof request.stopId === 'string' ? request.stopId : '';
                if (stopId.length > 0) {
                        await this.tasks.recordCheckpoint(request.taskId, { mode: 'attested', requestId: request.requestId, stopId });
                        return { checkpointRef: stopId, mode: 'attested' };
                }

                // 'verified' is unreachable at HEAD — see the file header. Record the gap,
                // never fake a reference.
                const ts = this.clock();
                const reason = 'out-of-band chatEditing snapshot creation is not extension-reachable at HEAD 9bf9ae764da (createSnapshot/restoreSnapshot are workbench-internal; only ChatResultStream.externalEdit within a live chat request can mint an undoStopId)';
                const gapSha256 = sha256Hex(canonicalJson({ taskId: request.taskId, requestId: request.requestId, reason, ts }));
                const appended = await this.ledger.append(request.taskId, { kind: 'note', uri: GAP_CHECKPOINT_URI, sha256: gapSha256 });
                await this.tasks.recordCheckpoint(request.taskId, { mode: 'blocked', requestId: request.requestId, gap: { uri: GAP_CHECKPOINT_URI, seq: appended.seq } });
                return { checkpointRef: null, mode: 'blocked', gapSeq: appended.seq };
        }
}
