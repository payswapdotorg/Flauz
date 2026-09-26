# Wave 4 / Lane K — Workflow Envelope + Ledger Hardening + Orchestrator Messaging (REPORT)

Worker K (flauz-K-w4), branch `flauz/wave4/workflow-envelope`, base `a4c245147e8fe046c33b2987c322a070d161c9ba` (flauz/main @ clone time).

> STATUS: COMPLETE - all milestones landed (M1-M6). Final verification sweep
> green; see VERIFICATION-RECEIPTS (the receipts below are reproducible:
> suites, canary, guards, determinism).

## WHAT-BUILT

### M1 - Workflow envelope v1 (DONE)

- `extensions/flauz-workflow/` (new zero-dep extension, command activation only):
  - `src/envelope.ts` - `flauz.workflows/v1` fragment schema (plan / tool
    sequence / approval decisions / evidence refs / model+params / re-run
    recipe / history), strict 21-rule validation, canonical git-diffable
    serialization (sorted keys, 2-space, trailing newline - DL-9/21(2)
    discipline), `distillTaskToFragment` (task-timeline walk), and
    `WorkflowService` with `save` / `list` / `load` / `run` (the one-command
    re-run: hydrate plan -> replay-approvals-or-ask -> execute tools via
    ToolExecutorPort -> new ledger rows linked to the ORIGINAL run's rows via
    `derivedFrom`; every state change flows through the flauz.tasks/v0
    nine-transition machine with actor gates).
  - `src/commands.ts` - `flauz.workflow.{save,run,list}` handlers + registration.
  - `src/extension.ts` - activation wiring (no-workspace degradation), shell
    tool executor (node:child_process, workspace-root cwd), quick-pick ask port,
    `.flauz/workflows/` + registry bootstrap.
  - `src/globals.ts`, `shims/node.d.ts`, `vscode-dts/vscode.d.ts` (byte-identical
    body to the Lane-G vendored copy; PROVENANCE line only difference),
    `tsconfig.json` (noEmit, zero `types`), `README.md`.
  - Tests (node --test, type-stripping): 27/27 green; `tsc --noEmit` green.
- `test/fixtures/workflow/` - `envelope-good.json` (real golden run via the real
  services), `workflow-good.json` (real distill output), `bad/` 21 fixtures
  (one violated validation rule each) + README; consumed by
  `test/fixtures.test.ts` (rot protection).

### M2 - Ledger hardening, the DL-20 Wave-4 hook (DONE, commit f88a3a85)

- `extensions/flauz-workspace`: signed checkpoints (`kind: 'checkpoint'` rows
  with the 8th checkpoint field; signer port in api.ts, logic in hardening.ts),
  size watermark `.flauz/evidence/size.json` (rowCount+bytes+head+lastCkptSeq,
  atomic tmp+rename), extended `verify()` with tamper classes 6 (watermark
  mismatch / truncated tail — closes the v0 last-row limitation) and 7 (forged
  checkpoint / keyId mismatch / bad binding / no signer); `append()` refuses
  to mint checkpoint rows; `appendCheckpoint()` idempotent.
- `extensions/flauz-workflow`: `src/keys.ts` (Ed25519 via node:crypto where
  available, else HMAC-SHA256 with documented posture downgrade; deterministic
  fixture keystore; manifest loader), keystore wiring in extension.ts
  (~/.flauz/keystore, user owns the chain), `test/hardening.test.ts`,
  `test/generateLedgerFixtures.ts`.
- `extensions/flauz-agent/core/contracts.mjs`: additive checkpoint-row
  structural acceptance + rowHash parity (narrow edit, our own file).
- `test/fixtures/workflow/{keys,ledger}`: deterministic fixture keystore +
  good/tamper ledger fixtures.

### M3 - A2A messaging, orchestration layer (DONE, commit a40946d9)

- `extensions/flauz-agent/core/a2a.mjs` (new, zero-dep): the G-side A2A bus —
  `flauz.a2a/v0` typed message journal `.flauz/a2a/messages.jsonl` (append-only
  canonical JSONL; seq-minted M-NNNNNN ids; byte-strict loader: non-canonical
  lines, seq gaps, and structural drift refuse to load), per-agent mailboxes
  as a PROJECTION of the journal, delivery cursors `.flauz/a2a/cursors.json`
  as the only other persisted fact (DL-9/DL-20 house style: replay =
  re-derivation). Four kinds: task-delegation (the AHP subagent-spawn
  surface), result-report (evidence referenced BY ID — the bus carries
  routing, not proof; verifiable facts ride the DL-20 ledger), steering-relay
  (C-24 surface), resource-claim (Claim+Lease notices; acquire MUST carry
  leaseUntil). `core/a2a.d.mts` hand-written types (contracts.d.mts pattern).
- `extensions/flauz-agent/core/service.mjs`: narrow seam wiring (DL-21) —
  `flauz.a2a.post/collect/list` commands, lazy bus construction (a corrupt
  journal surfaces as that command's error, not a failed hello), and the
  `a2a-message` relay event.
- `extensions/flauz-workflow/src/messaging.ts`: the typed TS mirror (strict
  validation, canonical serialization pinned byte-equal to the G side),
  `projectMailbox`/`knownAgents` projections, `AgentMessenger` over the
  `A2aPort` (the seam client implements it), and the
  delivered-to-the-participant bridge spec (identity/outbox/inbox/cursor).
- Tests: `messaging.test.ts` (fixture matrix with expected-rule map + G/TS
  parity incl. byte-canonical serialization + port facade) and
  `a2a.test.ts` (real-service seam round-trips, restart-no-replay, typed-gate
  rejections, direct-bus tamper/peek/inReplyTo). Fixtures
  `test/fixtures/workflow/a2a/` from a deterministic generator (2 runs ->
  identical sha256).

### M4 - AHP trigger interop + chatEditing snapshot watch (DONE)

- `extensions/flauz-workflow/src/triggers.ts`: v0 mapping of a validated
  fragment onto the AHP automation grammar — strict five-field cron validation
  (the tree-documented AHP grammar: steps on '*' or ranges, ASCII month/day
  names, day 7 = Sunday, no seconds/macros/Quartz), `automationFromFragment`
  (title, message = plan prompt with origin 'automation', session = model
  attribution, the host-opaque `flauz.workflow` _meta binding with the rerun
  recipe), and the emission drafts `automationCreateAction`
  (automation/createRequested) + `runAutomationRequest` (RunAutomationParams)
  with the deterministic `workflowRunRequestId` idempotency key (transport
  retries return the original run). NO live AHP dependency; the host owns
  schedule evaluation (tree rule honored).
- `build/flauz/specs/chatsnapshot-api-watch.md` (new `specs/` home): the DL-22
  watch spec — what Flauz needs (create/read/restore session snapshots for
  changeset evidence), the clone-time tree cites (chatEditingSession.ts
  createSnapshot/getSnapshotUri/restoreSnapshot are browser-layer only;
  extHostChatAgents2 externalEdit returns undoStopId but no snapshot read;
  mainThreadChatAgents2 externalEdits routing), why it is blocked (upstream
  API decision, single-proposal discipline), and three unblocking conditions
  + the upgrade content. Registered in build/flauz/README.md section 8.
- Tests: `triggers.test.ts` — 6 tests (cron accept/reject matrices, mapping
  golden incl. _meta binding, authoring gates, emission drafts).


### M5 - C-WORKFLOW canary + CI line (DONE, commits c9089de6 + 5536db85)

- `build/flauz/canaries/C-WORKFLOW.md` + `build/flauz/scripts/c-workflow-canary.mjs`:
  the scripted canary - A1 the save -> re-run round trip over the REAL
  services (derivedFrom link, fragment history, artifact sha256), A2 the
  DL-20 hardening live (checkpoint verifies; an on-disk truncation is
  FLAGGED, proving the canary can fail), A3 the A2A bus round trip +
  restart-no-replay, A4 the trigger-mapping smoke (cron gates, _meta
  binding, idempotency key), A5 mechanical lane hygiene (headers, tabs,
  ASCII, CR, allowlist over the lane delta). Node-only, zero-dep, no boot.
- `.github/workflows/flauz-workflow.yml` (zero secrets): spec gate, pinned
  actions, the canary, the four node-only suites, four typechecks
  (typescript-only per-extension install - no root install), and the
  fixture-determinism receipt with a committed-fixture drift gate. Gated on
  Flauz paths + workflow_dispatch.
- **The canary caught a real M3 bug on first run** (commit c9089de6): the
  exact-count key check made every optional key required - a delegation
  payload without workflowId was rejected by BOTH validators. Fixed on both
  sides (count ranges [required, required+optional]) + regression test.
  envelope.ts (M1, landed+verified) keeps its documented exact-key discipline
  per the work order (do-not-redo); the distill path always serializes
  model.params so v1 fragments round-trip stably (noted in GAPS).

## VERIFICATION-RECEIPTS

- Baseline (before any edit): flauz-workspace 55/55, flauz-agent 26/26,
  flauz-models 12/12 (node v24.21.0).
- M1: `node --test test/*.test.ts` (flauz-workflow) = 27/27 pass;
  `npx tsc --noEmit` = 0 errors; flauz-workspace re-run 55/55.
- M2: workflow 51/51, workspace 55/55, agent 26/26; tsc green x2.
- M3: workflow 58/58, agent 31/31, workspace 55/55; tsc green x2; fixture
  generator determinism receipt (two runs -> identical aggregate sha256
  7437b7351af3fb4c); G/TS canonical-serialization byte parity pinned by test.
- M4: workflow 64/64, agent 31/31, workspace 55/55; tsc green x2.
- Hygiene audit (work order section 4.4 rules) re-run over the full
  f88a3a8..HEAD delta at every milestone: headers byte-exact, TAB indent
  (the ` *` docblock continuation the sole exception), ASCII-only added
  lines, new .mjs in `.eslint-allowed-javascript-files`, zero src/vs paths.
- M5: canary 5/5 (A1-A5); suites workflow 65/65, agent 31/31, workspace
  55/55, models 12/12; tsc green x2 (workflow, agent); yml structure
  validated (pinned actions, no tabs, gates present); committed fixtures
  byte-equal generator output.
- FINAL SWEEP (M6): fork-critical-guard.sh --base f88a3a85 --head HEAD ->
  PASS (src/vs divergence outside contrib/flauz is EMPTY; DL-12/DL-10);
  git diff --name-only f88a3a8..HEAD -> every path is lane-K-owned
  (extensions/flauz-{workflow,agent}, test/fixtures/workflow, build/flauz,
  .github/workflows/flauz-workflow.yml, .eslint-allowed-javascript-files,
  flauz-delivery/k-workflow-envelope); zero upstream paths.


## DECISION-LOG-PROPOSALS

(DL-29+ candidates - finalized in M6; drafts accumulate per milestone.)

- derivedFrom linking semantics (M1): new evidence rows link to the original
  run's rows via the task-event payload `derivedFrom` field (the 7-field ledger
  row schema stays untouched); the fragment `history` records per-run
  derivations. Proposal: canonize `derivedFrom` as the cross-run linking
  primitive for Wave-5 evidence navigation.
- A2A journal as the agent-message primitive (M3): proposal to canonize
  `.flauz/a2a/messages.jsonl` (flauz.a2a/v0, four kinds, cursor projection)
  as THE inter-agent transport for Flauz orchestrators, with the
  DL-20-hardened ledger remaining the only tamper-evident layer (the bus
  carries routing, not proof).
- Deterministic run idempotency keys (M4): proposal to adopt the
  `<surface>/<id>/run/<attempt>` key shape (workflowRunRequestId) as the
  house pattern for every retryable side-effect request spoken to host-owned
  surfaces.
- Resource-claim enforcement gap (M3): v0 claim notices are informational;
  enforcement (rejecting a mutation whose Claim+Lease is absent/expired)
  needs a Core-side hook — proposed as a Wave-5 candidate with the
  chatParticipant toolInvocation surface.

## GAPS-AND-SKIPS

- Tool execution in the extension v0 uses the shell executor directly; binding
  the executor to the participant's toolInvocationToken + the flauz_terminal
  tool's native HumanApproval confirmation (C-25 surface) is the Wave-5
  follow-up (the approval-replay digest-binding posture is documented in
  src/extension.ts).
- Model attribution in fragments defaults to the flauz-mock provider (the
  participant does not persist model selection into task events at HEAD).
- A2A resource-claim notices are informational in v0 (see DECISION-LOG
  proposal above); no enforcement hook exists yet.
- AHP trigger interop is MAPPING + EMISSION DRAFTS only (C-40): no live
  dispatch to the ahp-automations:// channel rides in v0 — the F-side wiring
  waits on lane F's session driver (same gate as the canaries' interactive
  assertions).
- Chat-editing snapshot evidence is spec-only (DL-22): see
  build/flauz/specs/chatsnapshot-api-watch.md (blocked on an upstream API
  decision; three unblocking conditions recorded).
- v1 fragment validation follows M1's documented 'exact key sets' discipline:
  model.params is always present in validated fragments (the distill path
  always serializes it). The M3 hotfix made optional keys TRULY optional on
  the A2A surfaces (a2a + messaging); the envelope keeps the landed M1
  semantics per the work order (do-not-redo). If hand-authoring fragments
  without params ever matters, that is a deliberate v2 schema decision.

