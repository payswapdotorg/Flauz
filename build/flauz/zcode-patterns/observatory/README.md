# ZC-004 Observatory — Plan Mode + Run Health + Replay (contract set)

`OBSERVATORY_CONTRACTS_VERSION = '1.0.0'`

THE JOURNAL IS CANONICAL. Everything in this subtree is a typed projection
over the canonical Flauz journal and its authorities: read-models, request
shapes, pure guards, transition/mapping tables, and pure digest functions.
There is no second journal, no event store, no replay engine, no health
poller, and no scheduler here, by law.

Projected authorities (READ ONLY — never edited by this wave):

- `extensions/flauz-execution/src/contracts.ts` — the `LifecycleState`
  machine, `LIFECYCLE_STATES` (ten states), `ExecutionResourceRef`,
  journal/event semantics
- `extensions/flauz-agent/src/types.ts` — `TaskStatus`, `Task`, `TaskEvent`,
  `TaskEnvelope` (plan/approval semantics)
- `extensions/flauz-agent/src/seamUsageMap.ts` and `sessionsView.ts` — the
  existing visibility surfaces; this subtree projects deeper, never replaces

Modules:

- `common/planMode.ts` — explicit plan mode lifecycle
  (draft -> awaiting-approval -> approved -> executing -> superseded), plan
  document refs, approved-plan continuity with typed drift verdicts, and the
  total TaskStatus -> plan-mode projection
- `common/phases.ts` — workflow/subagent phase descriptors, phase-local
  forward-only transitions over the authority lifecycle states (a projection
  order, never the authority's own transition map), subagent phase envelopes
  and their admissibility guard
- `common/runHealth.ts` — run health/stall/concurrency view: `StallVerdict`
  predicates over injected plain-number event-time deltas, exported stall
  thresholds, plain-count `ConcurrencyGauge`
- `common/replay.ts` — deterministic cold replay: `ReplayCursor`,
  `ReplayPlan`, the pure + total `replayDigest` fold, and the fail-closed
  `coldReplayAdmissible` guard
- `runtime/observatory.ts` — the CR-004 live runtime (wave-5): the typed
  projection layer binding the REAL agent task authority (TaskService) and
  the REAL execution journal authority (ExecJournalStore) through the four
  frozen contract modules — the planMode views (the status table + the
  evidence-edge trail + the typed drift verdicts), the phases view (a
  graph's rows classed through `PHASE_STATE_ORDER` with the journal's own
  row hashes as evidence), the runHealth gauge over the live task records
  with the injected nowMs, and the deterministic cold-replay drill pinned to
  the journal's own head hash (local-real evidence: 49/49 suite at
  `runtime/observatory.test.ts`; the disclosed task-transition/plan-mode and
  acquisition-event/phase-state bridge tables propose, the contract guards
  dispose)

Laws (enforced by gates):

- Determinism: no `Math.random`, no `Date.now`, no `new Date()` inside
  `common/**`; timestamps are plain ISO-8601 strings; clock deltas are
  injected plain numbers
- Fail-closed typing: plan drift, inadmissible phase envelopes,
  cursor/journal mismatch, and missing heart evidence are typed verdicts
  carrying the exact violated law — never exceptions, never silent
- Every persisted record carries `scope: ObservatoryScope` and
  `contractVersion`
- Zero import statements inside `common/**` contract modules (shared
  vocabulary is declared locally, mirroring
  `build/flauz/lab/common/labContracts.ts`)

OUT OF SCOPE BY LAW: any runtime observatory/replay ENGINE — pollers,
schedulers, event stores, replay executors, dashboards. This wave is the
typed contract set only.

Honest seam record (TL application, 2026-10-05): the ZC-004 work order
described the execution authority as "the 26-state AgentTaskState machine";
the real authority exports `LIFECYCLE_STATES` with TEN members and
`TaskStatus` with eight. The projections were transcribed from the REAL
authorities (the projection law) and the tests pin them by direct import —
`PHASE_STATE_ORDER` deep-equals `LIFECYCLE_STATES`, and
`PLAN_MODE_BY_TASK_STATUS` covers every TaskStatus member.
