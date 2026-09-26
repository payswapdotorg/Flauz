# Workflow fixtures (Wave 4, Lane K)

- `envelope-good.json` - a completed golden run in the `flauz.tasks/v0` task envelope
  shape (produced by the real flauz-workspace services; validates via
  `validateEnvelope`).
- `workflow-good.json` - the matching `flauz.workflows/v1` fragment (produced by
  `distillTaskToFragment`).
- `bad/*.json` - one violated validation rule per file; consumed by
  `extensions/flauz-workflow/test/fixtures.test.ts`, which asserts each is
  rejected by `validateWorkflowFragment` with the expected rule message.
- Fixture JSON is tab-indented per repo hygiene; the canonical 2-space
  serialization discipline is pinned by the envelope unit tests.
- Checkpoint key + ledger tamper + A2A message fixtures land with their
  milestones (see REPORT.md).
