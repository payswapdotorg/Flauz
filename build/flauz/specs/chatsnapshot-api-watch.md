# Chat-Editing Snapshot API Watch (DL-22) - SPEC ONLY

Status: WATCH / BLOCKED (no code rides on this spec). Owner: Wave 4 Lane K
(flauz-K-w4). Branch: `flauz/wave4/workflow-envelope`.

## What Flauz needs (the consumer story)

The workflow envelope (`flauz.workflows/v1`, extensions/flauz-workflow) records
per-run evidence with content-addressed artifacts (ledger rows with sha256 +
`.flauz/artifacts/` URIs). For runs that mutate the workspace through the chat
editing session, the evidence chain needs the SAME discipline on session
snapshots:

1. CREATE - a snapshot at an undo stop (the `flauz_terminal` tool brackets its
   external edits with undo stops today), so a re-run can be diffed against
   the exact pre-edit state.
2. READ - the snapshot content URI for a given (requestId, resource, stopId),
   to copy/hash into a ledger evidence row (changeset-kind evidence with a
   sha256, like every other Flauz artifact).
3. RESTORE - return to a snapshot (the chat-editing analog of the ledger's
   `verify` + repair posture; human-gated, never automatic).

## What the tree has today (clone-time cites; re-verify before acting)

- `src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSession.ts`
  - line ~386 `createSnapshot(requestId, undoStop)` - creates a checkpoint
    (`Request <id> - Stop <id>` label) on the internal editing timeline.
  - line ~418 `getSnapshotUri(requestId, uri, stopId)` - content URI of a
    resource at a stop; `restoreSnapshot(requestId, stopId)` navigates back.
  - These are PUBLIC METHODS ON THE BROWSER-LAYER CLASS ONLY. There is no
    extension-facing surface for create/read/restore; they are reachable from
    the workbench but not across the ext-host boundary.
- `src/vs/workbench/api/common/extHostChatAgents2.ts` lines ~316-330:
  `externalEdit(target, callback)` on the chat response stream
  (proposed `chatParticipantAdditions` API) - brackets external edits with an
  undo stop and RETURNS the undoStopId, but exposes no snapshot read/restore.
- `src/vs/workbench/api/browser/mainThreadChatAgents2.ts` line ~495: the
  `externalEdits` progress kind routes into `chatSession.editingSession` -
  i.e. the plumbing that COULD carry snapshot commands already crosses the
  boundary at exactly this seam.

## Why this is blocked (the C-matrix ruling)

Agent-to-participant editing surfaces are upstream-owned (C-26 family): Flauz
must not fork `src/vs` chat transport or add private API to the ext-host
surface. The snapshot primitives exist internally but their exposure is an
UPSTREAM API decision. The single-API-proposal discipline (DL-12/DL-19) means
Flauz files/advocates ONE proposal rather than forking.

## Unblocking conditions (any one)

1. Upstream proposes snapshot access next to `externalEdit` (e.g.
   `chatParticipantAdditions` gains `getSnapshotUri`/`restoreSnapshot` or an
   `onSnapshot` handle) - then Flauz binds it behind the evidence-ledger port
   (`extensions/flauz-workspace/src/api.ts` FileSystemPort-style seam) and the
   changeset evidence kind starts carrying session snapshots.
2. The external-edit undoStopId (already returned by `externalEdit`) grows a
   documented snapshot read - the minimal surface for the evidence chain
   (CREATE is already implicit: the stop brackets the edit).
3. Flauz ships its own workspace-level snapshotting outside the chat session
   (git worktree / fs copy) - a fallback that does NOT touch the blocked path
   but yields weaker session-scoped semantics (no automatic stop alignment).

## Standing decision (DL-22 as recorded)

v0 drops the snapshot evidence link (the envelope records editing evidence as
plain changeset rows without session snapshot URIs); this watch document is
the deliverable. When an unblocking condition lands, the upgrade content is:
evidence row kind extension (optional `snapshotUri` field on changeset rows -
backward-compatible, optional-key discipline like `params`), the port method,
and one fixture pair.

Re-verify the cites at every wave (the files are auto-generated/competitive;
line numbers are clone-time anchors, method names are the stable contract).
