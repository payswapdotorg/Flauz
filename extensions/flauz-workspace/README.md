# flauz-workspace

Flauz built-in extension owning the agent workspace state: the `.flauz/` task
envelope (`flauz.tasks/v0`), the hash-chained evidence ledger, SCM artifact
exposure, and chatEditing checkpoint interop. This is the Wave-3 Lane-G vertical
slice — first product code on the pristine Code OSS mirror (additive-only, DL-12).

Everything in `src/` except `extension.ts` is free of runtime `vscode` and node
imports: services talk to the outside world through injected ports
(`FileSystemPort`, `Clock`, `globals.vscodeApi()`), which is what makes the whole
core runnable under plain `node --test` with zero dependencies.

## Layout

```
.flauz/
  tasks.json              # the envelope (flauz.tasks/v0)
  evidence/
    ledger.jsonl          # append-only, hash-chained evidence rows
```

Paths are POSIX-style relative to the workspace root (v0 targets POSIX hosts).

## The envelope — `.flauz/tasks.json`

```json
{
  "$schema": "flauz.tasks/v0",
  "tasks": [
    {
      "id": "T-001",
      "title": "Fix login flow",
      "status": "plan",
      "events": [
        { "ts": 1730000000000, "actor": "agent", "type": "submit-plan", "payload": {} }
      ],
      "timing": { "created": 1730000000000, "updatedAt": 1730000000000 },
      "changes": [ { "uri": "file:///w/a.ts", "checkpointRef": null } ]
    }
  ]
}
```

Serialization follows the git-diffability discipline (DL-9): fully canonical
(recursively sorted) key order, 2-space indent, exactly one trailing newline, no
volatile noise. Logically identical states always serialize to identical bytes, so
envelope churn diffs minimally in review.

Loading is strict v0: unknown keys, bad `$schema`, malformed tasks/events/changes
all fail loudly (a forward-incompatible envelope must never be silently rewritten).

Task ids are `T-NNN` (zero-padded to 3, growing naturally past `T-999`), allocated
as `max(existing) + 1`.

## The state machine (`flauz.tasks/v0`)

Nine legal transitions, actor-gated (seed: flauz-code-lab
`prototypes/agent-task-state`):

| transition       | from                                   | actors        | to                 |
| ---------------- | -------------------------------------- | ------------- | ------------------ |
| `submit-plan`    | `plan`                                 | agent         | `awaiting-approval`|
| `approve`        | `awaiting-approval`                    | human         | `execute`          |
| `request-changes`| `awaiting-approval`                    | human         | `plan`             |
| `report`         | `execute`                              | agent         | `verify`           |
| `verify-pass`    | `verify`                               | agent, tool   | `awaiting-signoff` |
| `verify-fail`    | `verify`                               | agent         | `execute`          |
| `fail`           | `execute`                              | agent         | `failed`           |
| `sign-off`       | `awaiting-signoff`                     | human         | `done`             |
| `cancel`         | any active (plan/…/awaiting-signoff)   | human         | `cancelled`        |

`failed`, `done`, `cancelled` are terminal: nothing is legal from them.

Transitions are driven through `appendEvent`: an event whose `type` names a
transition is gated (actor + source status) and moves the status; any other type is
appended verbatim as an observational timeline entry. Illegal transitions throw an
`Error` whose message lists the allowed source statuses. The status is always
re-derivable by replaying the events.

## The evidence ledger — `.flauz/evidence/ledger.jsonl`

One JSON object per line — exactly the 7 contract fields, stored as canonical JSON
(sorted keys, no whitespace):

```json
{"kind":"changeset","prev":null,"seq":1,"sha256":"…","taskId":"T-001","ts":1730000000000,"uri":"file:///w/a.ts"}
```

* `kind` ∈ `changeset | screenshot | command-output | note`
* `sha256` is the caller-supplied hash of the artifact content (64 lowercase hex)
* The **row hash** (never stored) is sha256 over the canonical line — i.e. over the
  stored bytes minus the trailing newline. The next row's `prev` carries it;
  `seq 1` has `prev: null`.
* Evidence ids are `E-` + the seq zero-padded to 6 (`E-000001`).
* `flauz.workspace.verifyLedger` recomputes the whole chain and reports the first
  bad `seq` across all tamper classes (payload mutation, broken links, deleted
  rows, forged appends, bad genesis link).

The optional `note` on `appendEvidence` is **not** a ledger field — it is recorded
on the task timeline (`evidence` event), keeping ledger rows exactly at the 7
contract fields.

## Ledger v0 scope

Hash chain only — no signatures (Wave-4 hook per SECURITY-MODEL §3.3). Known v0
limits, accepted and documented rather than hidden:

* A **truncated tail** (deleted last rows) is not detectable by the chain itself.
* `verify` is a full O(n) recompute; no compaction, no partial verification.
* Single-writer assumption (the agent); no cross-process locking.
* Gap rows (e.g. blocked checkpoints) use a `flauz://gap/...` uri and a
  self-minted sha256 over the canonical gap payload.

## The command seam

`flauz.workspace.*` commands — Worker F's runtime calls these via
`vscode.commands.executeCommand`:

| command | args | returns |
| --- | --- | --- |
| `createTask` | `{title}` | `{taskId}` |
| `appendEvent` | `{taskId, event}` | `{task}` |
| `listTasks` | `{}` | `{tasks}` |
| `getTask` | `{taskId}` | `{task}` |
| `appendEvidence` | `{taskId, row: {kind, uri, sha256, note?}}` | `{evidenceId, seq}` |
| `createCheckpoint` | `{taskId, requestId, stopId?}` | `{checkpointRef \| null}` |
| `verifyLedger` | `{}` | `{ok, rows, firstBadSeq?}` |
| `openEvidence` | `{evidenceId}` | opens the artifact (additive 8th command — required by the SCM artifact mapping) |

## SCM artifact exposure

A dedicated `SourceControl` (`flauz-evidence` / "Flauz Evidence") exposes the
ledger through the proposed `scmArtifactProvider` API (registry:
`extensionsApiProposals.ts:414`; enabled for built-ins via product.json
`extensionEnabledApiProposals` — key proposed to Worker F, see REPORT DL-16).
`provideArtifactGroups()` returns the **4 static kind groups** (changesets,
screenshots, command outputs, notes); `provideArtifacts(group)` maps that group's
rows to artifacts carrying the row timestamp and an `openEvidence` command bound to
the evidence id. `onDidChangeArtifacts` fires the changed group ids after appends.

## Checkpoint interop (chatEditing)

Decision matrix at mirror HEAD `9bf9ae764da`:

* **verified** — platform-issued snapshot confirmed by the platform. *Unreachable*
  at HEAD: `createSnapshot`/`restoreSnapshot` are workbench-internal
  (`chatEditingSession.ts:386-423`, storage `chatEditingSessionStorage.ts:22-47`).
* **attested** — the caller holds an `undoStopId` obtained from
  `ChatResultStream.externalEdit()` within a live chat request
  (`extHostChatAgents2.ts:316-330` → `mainThreadChatAgents2.ts:495`). Accepted,
  recorded as *attested* on the timeline and in `changes` as
  `{uri: "flauz-checkpoint://<stopId>", checkpointRef: <stopId>}`.
* **blocked** — no stopId, no live request: returns `{checkpointRef: null}` and
  records a gap row (`flauz://gap/checkpoint-out-of-band-unreachable`) in the
  ledger. Never a faked reference. Promotion proposals for a real out-of-band
  surface: REPORT §DECISION-LOG-PROPOSALS (DL-17).

## Verification

```
bun install          # dev-only: typescript@5.9.3 for the typecheck
npm run typecheck    # tsc --noEmit (strict, standalone tsconfig, no @types/node)
npm test             # node --test test/*.test.ts (55 tests, zero deps)
```

The typecheck covers `src/` + the vendored `vscode-dts/`; the tests execute the
same source files under Node's native type stripping (Node ≥ 23.6; no transpile,
no loader, no `vscode` module resolution — see `test/shims.ts`).

`vscode-dts/` vendors `vscode.d.ts` and
`vscode.proposed.scmArtifactProvider.d.ts` verbatim from the mirror (PROVENANCE
line at the top of each; byte-identity of the remainder diff-verified) so the
extension typechecks standalone — the sandbox discipline forbids building the
workbench.

`main: ./out/extension.js` points at the upstream built-in-extension compile
output (CI-side per MIGRATION-PLAN §5; never built in the dev sandbox).

## v0 non-goals

Real-IDE boot, SCM UI rendering and chatEditing runtime behavior are CI-side
verification concerns (MIGRATION-PLAN §5); this slice verifies statically
(typecheck) and behaviorally (node tests) against the contract above.
