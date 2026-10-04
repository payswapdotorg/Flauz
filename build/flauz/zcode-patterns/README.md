/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

# ZCode Pattern Contracts (ZC-001)

Additive, versioned contract set for the six ZC-001 pattern families. Contract version:
`ZCODE_PATTERNS_CONTRACTS_VERSION = '1.0.0'` (re-declared in every module; the
zero-import law forbids a shared base module, and the tests pin every declaration to
the exact same value).

## Projections, not authorities

Every type in this tree describes a READ-MODEL or REQUEST shape over the EXISTING
Flauz authorities. Nothing here schedules, journals, brokers permissions, routes
models, or persists state: types, constants, pure guards, and mapping tables only.
The projected authorities (read-only; never edited by this lane):

- `extensions/flauz-agent/src/types.ts` -- Task, TaskStatus, TaskEvent, TaskEnvelope,
  SeamEventEnvelope, SeamLike (the task/session/event authority).
- `extensions/flauz-workspace/src/api.ts` -- the `flauz.tasks/v0` state machine
  (TASK_STATUSES, ACTIVE_STATUSES, the 9 TRANSITIONS) that governs the projected
  lifecycle and continuity laws.
- `extensions/flauz-execution/src/contracts.ts` -- EXEC_JOURNAL_SCHEMA_ID, the
  append-only `flauz.execution-journal/v0` journal, LIFECYCLE_STATES,
  ExecutionResourceRef (the journal/resource authority).
- `extensions/flauz-workflow/src/` -- the workflow envelope authority
  (WorkflowFragment: plan + ordered steps + approvals) behind the plan-continuity
  summary shape.
- `extensions/flauz-memory/src/memory.ts` -- MemoryStore (the memory authority) to
  which the memory projection stays subordinate.

The tests pin the contract-duplicated vocabularies against the authorities they
project (runtime list equality plus both-direction type pins). Two authorities
(flauz-memory, flauz-workflow) cannot be imported by tests under the scoped gate
posture because their internal `.ts`-suffixed imports trip TS5097 in the station's
`NodeNext`/`verbatimModuleSyntax` configuration; those projections are documented
in module headers instead, and no unpinned duplication of their vocabularies exists.

## The six families

| Module | Family | What it is |
| --- | --- | --- |
| `common/backgroundAgent.ts` | Background-agent lifecycle projection | `BackgroundAgentRunRecord` read-model, `BACKGROUND_RUN_PHASES` + `backgroundRunPhaseTransitions` + `canTransitionBackgroundRunPhase`, and the total pure mapping `toBackgroundRunPhase(taskStatus)` from the authority TaskStatus. |
| `common/hooks.ts` | Hook events | `HookEventKind` (session/prompt/tool/approval/post-tool/finalization), kind/payload-correlated `HookEvent` records, the `HookEventEnvelope` wire shape, and the hook-effect law as a type: `HookEffect` admits only `context-enrichment` and `approval-request`, so a bypass-granting effect is unrepresentable. |
| `common/planContinuity.ts` | Plan continuity | `ApprovedPlanRecord` (planId, owning task, session lineage, steps summary), `PlanStepStatus` + transition map, and the continuity law as pure guards: `planStepMayProceed` (steps proceed only under active authority tasks) and `pinnedPlanStepMayProceed` (pinned steps never proceed under `failed`/`cancelled` authority tasks). |
| `common/runHealth.ts` | Run observability/health | `RunHealthSnapshot` (last event, stall signal, concurrency roster), `RunHealthStatus` (`healthy | stalled | unknown`), and the pure `classifyRunHealth` classifier with the exported `STALL_AFTER_MS` threshold (no hidden magic numbers). |
| `common/memoryProjection.ts` | Persistent agent memory projection | `MemoryScopeLevel` (user/project/workspace-local), `MemoryEntryRecord` carrying enablement/retention/provenance/secret-exclusion fields ONLY (no storage, no content), with `enablementRequired: true` and `secretExclusion: 'enforced'` as literal types, plus the `isExportableMemoryEntry` and `memoryScopeAllowsPersistence` guards. |
| `common/replayResume.ts` | Replay/resume projections | `ReplayCursorRecord` over the `flauz.execution-journal/v0` subject, `ResumePlan` with bounded ordered replay steps (`REPLAY_WINDOW_ROWS`), and the pure `deriveResumePlan`: a grown journal is resumable, a journal behind the cursor is a typed `divergence` (never an exception). |

## Laws

- **Zero imports** inside `common/` contract modules (exactly like
  `build/flauz/lab/common/labContracts.ts`); tests import whatever they need.
- **Determinism**: no `Math.random`, no `Date.now`, no `new Date()` inside
  `common/**`; timestamps are plain ISO strings set at persistence edges.
- **Scoping**: every persisted record carries `scope: ZcodeScope`
  (`workspaceId`, `tenantId`) and `contractVersion: string`.
- **Fail-closed typing**: policy-constrained shapes make the illegal state
  unrepresentable (the hook-effect union, the memory literal types, the correlated
  hook payloads) or guard it with an exported pure guard (never a comment-only
  promise).
- **Totality**: every mapping from an authority state set covers ALL authority
  states; the tests prove it by iterating the authority lists.

## Tests

Mocha tdd suites in `test/common/` (one per family), run with the isolated
mocha+tsx runner posture (`--ui tdd`, `assert`, `.js` import suffixes) and type
checked with the scoped strict tsc posture (`NodeNext`, `verbatimModuleSyntax`,
`types node+mocha`).
