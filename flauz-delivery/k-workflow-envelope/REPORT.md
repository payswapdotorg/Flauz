# Wave 4 / Lane K — Workflow Envelope + Ledger Hardening + Orchestrator Messaging (REPORT)

Worker K (flauz-K-w4), branch `flauz/wave4/workflow-envelope`, base `a4c245147e8fe046c33b2987c322a070d161c9ba` (flauz/main @ clone time).

> STATUS: IN PROGRESS — running report, refreshed at every milestone-transit.
> Milestones: M1 envelope [DONE] -> M2 ledger hardening -> M3 A2A messaging ->
> M4 triggers + chatsnapshot spec -> M5 canary + CI -> M6 final verification.

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

## VERIFICATION-RECEIPTS

- Baseline (before any edit): flauz-workspace 55/55, flauz-agent 26/26,
  flauz-models 12/12 (node v24.21.0).
- M1: `node --test test/*.test.ts` (flauz-workflow) = 27/27 pass;
  `npx tsc --noEmit` = 0 errors; flauz-workspace re-run 55/55.
- Hygiene audit (hygiene-k.py, work order section 4.4 rules): GREEN over the
  delta (headers byte-exact, tabs, ASCII, json tabs, vendored dts exempt as
  byte-copy; .eslint-ignore itself exempts **/extensions/**/*.d.ts).

## DECISION-LOG-PROPOSALS

(DL-29+ candidates - finalized in M6; drafts accumulate per milestone.)

- derivedFrom linking semantics (M1): new evidence rows link to the original
  run's rows via the task-event payload `derivedFrom` field (the 7-field ledger
  row schema stays untouched); the fragment `history` records per-run
  derivations. Proposal: canonize `derivedFrom` as the cross-run linking
  primitive for Wave-5 evidence navigation.

## GAPS-AND-SKIPS

- Tool execution in the extension v0 uses the shell executor directly; binding
  the executor to the participant's toolInvocationToken + the flauz_terminal
  tool's native HumanApproval confirmation (C-25 surface) is the Wave-5
  follow-up (the approval-replay digest-binding posture is documented in
  src/extension.ts).
- Model attribution in fragments defaults to the flauz-mock provider (the
  participant does not persist model selection into task events at HEAD).
