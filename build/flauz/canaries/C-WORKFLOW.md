# Canary C-WORKFLOW - Workflow envelope save -> re-run round trip (Lane K)

- **Surface (Wave 4 Lane K)**: the `flauz.workflows/v1` envelope + re-run
  machine, the DL-20-hardened evidence ledger, the `flauz.a2a/v0` bus, and the
  AHP trigger mapping - `extensions/flauz-workflow/` over
  `extensions/flauz-workspace/` services and the `extensions/flauz-agent`
  core seam. All node-only, zero-dep surfaces: this canary needs NO IDE boot,
  NO xvfb, NO npm install (type-stripped `node --test` + a zero-dep script).
- **Why a canary (not just unit suites)**: the suites pin rules; the canary
  pins the END-TO-END story a Flauz user actually gets - a completed task run
  is distilled into a fragment, saved, and ONE COMMAND re-runs it against the
  real services, producing new evidence rows that link back to the original
  run (derivedFrom) on a ledger that then verifies clean INCLUDING the
  M2 checkpoint + watermark layers.
- **Script**: `build/flauz/scripts/c-workflow-canary.mjs` (assertions A1-A5
  below; prints a receipt per assertion, exits nonzero on the first failure).
  Run locally: `node build/flauz/scripts/c-workflow-canary.mjs`.

## Assertions

- **A1 - save -> re-run round trip (the headline)**: boot a temp workspace
  with the real TaskService + EvidenceLedger + WorkflowService; drive one
  golden task run (plan -> approve -> tool output captured as artifact ->
  evidence row -> report -> verify-pass -> sign-off); distill it to a
  fragment; `save` -> `load` -> `run` with `approvals: 'replay'`; assert:
  the re-run completes, new evidence rows are appended (not copied), each new
  row's `derivedFrom` names the ORIGINAL run's row id, the fragment `history`
  records the derivation, and the artifact bytes hash to the recorded sha256.
- **A2 - ledger hardening stays in the loop**: after the re-run, append a
  signed checkpoint (fixture-keystore signer), then `verifyLedger` reports ok
  across the full chain; truncate the journal on disk and re-verify: the
  watermark layer must flag the truncation (tamper class 6). (Proves the
  canary would CATCH a hardening regression, not just pass it.)
- **A3 - A2A bus round trip + restart no-replay**: over a temp workspace,
  `A2ABus` post (delegation, steering, report, claim) -> collect drains in
  order -> collect again empty -> NEW bus instance on the same root replays
  nothing, a post-restart message arrives exactly once.
- **A4 - trigger mapping smoke**: the round-trip fragment maps onto an AHP
  automation definition draft with the `flauz.workflow` _meta binding; the
  tree cron grammar gates accept `30 9 * * 1-5` and reject a 6-field
  expression.
- **A5 - lane hygiene (the binding rules, mechanically)**: over the Lane K
  delta (the four extensions + fixtures + this script/spec): the 4-line
  copyright header byte-exact on every new code file, no CR bytes, added
  lines ASCII-only, TAB indent (the ` *` docblock continuation the sole
  space-led exception), new `.mjs` files present in
  `.eslint-allowed-javascript-files`.

## CI job

`.github/workflows/flauz-workflow.yml` (job `workflow-envelope`, zero
secrets): spec-present gate -> Node per `.nvmrc` -> the canary script (A1-A5)
-> the four node-only suites (flauz-workflow / flauz-workspace /
flauz-agent / flauz-models) -> `tsc --noEmit` for workflow + agent (a
typescript-only `npm install` inside each extension; no root install) ->
fixture-generator determinism receipt (two runs, identical sha256). Gated on
Flauz paths + `workflow_dispatch` (same discipline as `flauz-canaries.yml`).

## Notes

- Interactive/UI assertions (the `flauz.workflow.*` command palette surface)
  are out of scope here - they ride lane F's session driver like every other
  interactive canary (PROBE-ONLY posture, see C-20.md).
- The canary intentionally re-implements the golden-path drive (same event
  shape as `extensions/flauz-workflow/test/helpers.ts` goldenRun) instead of
  importing the test helper: a canary must fail loudly when the EXTENSION
  moves, not silently follow test-only scaffolding.
