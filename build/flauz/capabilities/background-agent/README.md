# ZC-002 — Background-Agent User Experience Contracts

Versioned, zero-dependency contracts for the background-agent UX surface
(launch / inspect / message / control / outcome / roster). These are
**projections over existing Flauz authorities**, not new authorities: no
scheduler, executor, message bus or persistence engine is introduced here —
only types, constants, pure guards and total transition/mapping tables.

Contract set version: `BACKGROUND_AGENT_UX_VERSION = '1.0.0'` (every persisted
record carries `scope: CapabilityScope` + `contractVersion: string` + plain
ISO-8601 timestamps).

## Modules

| Module | What it is |
| --- | --- |
| `common/launch.ts` | `AgentLaunchRequest`, `AgentLaunchAcceptance`, `canAcceptLaunch` — a pure admission guard over the roster. |
| `common/inspect.ts` | `AgentInspectView`, `inspectViewsEqual`, `projectInspectView` — a bounded read-model of one task. |
| `common/message.ts` | `AgentMessage`, `canDeliverMessage` — the message-delivery law (never terminal, never pre-launch). |
| `common/control.ts` | `PauseRequest` / `StopRequest` / `CancelRequest` / `ResumeRequest`, `controlAdmissible` — a TOTAL admissibility map over the authority states. |
| `common/outcome.ts` | `AgentOutcome`, `ArtifactHandoff`, `isTerminalOutcome`, `outcomeFromTerminalState` — a TOTAL terminal-state → disposition map. |
| `common/registryView.ts` | `BackgroundAgentRosterEntry`, `rosterFromTaskRecords`, `HEALTH_PROJECTION` — a TOTAL health classification (active / idle / terminal). |

## Laws

- **Projections, not authorities.** Every type is a read-model or request shape
  over the agent-task state machine and session/evidence/lease semantics. No
  scheduler, executor, message bus or persistence engine lives here.
- **Zero-dependency.** `import` statements inside `common/**` contract modules
  are forbidden (exactly like `build/flauz/lab/common/labContracts.ts`). The
  agent-task state vocabulary is CONTRACT-DUPLICATED as a closed `as const`
  list with a derived union in every module that needs it.
- **Determinism.** No `Math.random`, no `Date.now`, no `new Date()` inside
  `common/**`. Timestamps are plain ISO strings; every guard is a pure function
  of its inputs.
- **Fail-closed typing.** Control verbs and message delivery are guarded by
  exported pure guards derived from the authority state machine; an illegal
  (verb, state) pair is guarded, never representable as admissible.
- **Total mappings.** `controlAdmissible`, `outcomeFromTerminalState` and the
  roster `HEALTH_PROJECTION` are TOTAL over the authority states and are pinned
  by tests that iterate the authority's own exported state list (runtime
  equality + type-level pin).
- **Scoping.** Every persisted record carries `scope: CapabilityScope` +
  `contractVersion: string` + plain-string ISO timestamps.
- **Style.** Tabs, ASCII only, MIT header, `.js` import suffixes in tests,
  `as const` state lists with derived unions.

## Projected authorities (READ ONLY — not edited by this wave)

The contracts project over, and do not redefine, these Flauz authorities:

- `extensions/flauz-execution/src/contracts.ts` — `LIFECYCLE_STATES` (the
  execution lifecycle state machine; contract-duplicated here as
  `AGENT_TASK_STATES`), `ExecutionResourceRef`, and the execution journal
  (`ExecJournalRow` / `EXEC_JOURNAL_*`). This is the **state-machine authority**
  every UX operation projects over.
- `extensions/flauz-agent/src/types.ts` — `Task`, `TaskStatus`, `TaskEnvelope`,
  `SeamEventEnvelope` (session/task semantics), `EvidenceRowInput` (evidence
  semantics). These are the session/task/evidence semantics the read-models
  project; `AgentSessionDescriptor` (ARCHITECTURE-LOCK §5) is the session
  descriptor authority.
- `OperationLease` (ARCHITECTURE-LOCK §5) — the lease authority projected by
  `leaseRemaining` / `LeaseGrantSummary`.

## Authority-state vocabulary note (honest disclosure)

The work order names the state-machine authority as "the 26-state
`AgentTaskState` machine" in `extensions/flauz-execution/src/contracts.ts`. At
the dispatch base commit (`c984e1d90714322eee11283240429a65049d33bf`) that file
exports `LIFECYCLE_STATES` — a **10-state** execution lifecycle machine
(`registered`, `created`, `starting`, `running`, `stopping`, `stopped`,
`destroyed`, `failed`, `running/attached`, `stopped/attached`) — and contains no
literal `AgentTaskState` type or 26-state list. No other file in the tree
exports one either.

These contracts therefore project over the real authority list that IS exported
from the named file — `LIFECYCLE_STATES` — contract-duplicated as
`AGENT_TASK_STATES` and pinned by runtime list equality + a bidirectional
type-level pin against `LIFECYCLE_STATES` in every test suite. All mappings are
total over these 10 states. If the authority later grows to a 26-state
`AgentTaskState`, the duplicated vocabulary and the totality tests are re-pinned
in one place per module. The semantic projection (terminal = `destroyed` /
`failed`; pre-launch = `registered`; running-shape = `running` /
`running/attached`; stopped-shape = `stopped` / `stopped/attached`) is
documented in each module.

## Test harness

The specs are TypeScript using the NodeNext `.js` import-suffix convention (the
`labContracts.ts` binding style). Loading `.ts` specs that use `.js`-suffix
cross-file imports requires the tsx ESM loader — the Flauz repo's TS test
loader, declared in `extensions/copilot/package.json`.

`build/flauz/capabilities/.mocharc.cjs` mirrors `extensions/copilot/.mocharc.js`
(`require: ['tsx']`, `ui: 'tdd'`). Run the suite with:

```
NODE_OPTIONS=--import tsx npx mocha --ui tdd build/flauz/capabilities/background-agent/test/common/*.test.ts
```

Scoped strict typecheck:

```
tsc -p build/flauz/capabilities/tsconfig.json --noEmit
```
