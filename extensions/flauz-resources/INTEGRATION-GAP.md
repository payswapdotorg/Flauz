# INTEGRATION-GAP — flauz-resources vs the tree + the sibling lanes (TL3-005, Worker C)

The extension-land vs product-side boundary for the logical resource graph.
Headline: **v0 requires ZERO product-side code and ZERO proposal grants** —
the graph is workspace-local `.flauz/` state (ARCHITECTURE-LOCK section 3
Persistence two-layer rule, layer 1) composed with the sibling envelopes by
CONVENTION (DL-32), never by imports.

## 1. What v0 shipped (extension-land, this lane)

- The full `ResourceRef` + access-surface + edge + provenance model
  (`src/api.ts`), the graph + persistence + verification (`src/graph.ts`),
  the ops ledger (`src/provenance.ts`), the restoration-planning continuity
  service (`src/continuity.ts`), and the 4 command palette surfaces
  (`src/extension.ts`). Pure TypeScript, zero deps; only `src/extension.ts`
  imports `vscode`.
- No live runtimes: restore PLANS are the artifact (like the
  flauz-environments connection plans); plan execution belongs to the
  browser/environment runtimes (Workers A/B) and the Agent OS integration.
- Activation is command-driven only; `enabledApiProposals: []` — no dead
  config (a grant lands only with code that needs it, DL-19/DL-33
  discipline).

## 2. The cross-worker contract table (the TL3 orchestrator pins)

Duplicate-as-types + literal-fixture pins (DL-32 convention); drift between
the parallel branches shows up in `test/contract.test.ts` and the R-RES
canary A6, never silently.

| # | Contract | Owner lane | This extension's pin | Integration step |
|---|---|---|---|---|
| 1 | BrowserSessionDescriptor summary (`sessionId`, `initiator`, `partition`, `state`) | Worker A (browser runtime) | `BrowserSessionSummary` (src/continuity.ts) + `test/fixtures/resources/contracts/browser-session-descriptor.json`; session ids are exactly `flauz:browser:<16-hex>` (`isBrowserSessionId`) | Worker A's session registry mints refs with THAT id; the summary `state` vocabulary replaces the v0 `'unknown'` placeholder on both sides |
| 2 | Environment descriptor id (`env-*`) + lifecycle | Worker B (environment runtime) + flauz-environments registry | `EnvironmentSurface.descriptorId` validated against the registry pattern; `EnvironmentSummary` probed from `.flauz/environments.json` (read-only) + `contracts/environment-descriptor.json` + `contracts/environments-registry.json` | Worker B's lifecycle states join the summary (push into the graph, or extend the read-only probe); `flauz.env.*` plan re-execution is the restore path |
| 3 | Task ids `T-<3+ digits>` + the tasks envelope | flauz-workspace | `TaskSurface.taskId` + `envelopePath` validated against the duplicated pattern; task refs are `flauz:task:T-###` | flauz-workspace writes refs for created tasks (or a sync shim derives them); the ops ledger's taskId context rides provenance |
| 4 | Evidence row (kind `note`, uri, sha256, note) | flauz-browser (`toEvidenceRow`) | `contracts/evidence-row.json` bindable as an evidence ref + artifact surface (uri + 64-hex sha) | the evidence ledger append path also records an evidence ref + `produced` edge from the task |
| 5 | URN id families (`flauz:<kind>:<16-hex-or-slug>`) | TL3 orchestrator | `KIND_NAMESPACES` + `parseResourceUrn` + `contracts/urn-ids.json` | any new kind (v1) needs a namespace decision + fixture update on every side |
| 6 | Edge kinds (v0 closed set) + legality matrix | this lane (proposed) | `EDGE_LEGALITY` (src/api.ts) pinned by tests | widening for real compositions is a deliberate joint update (matrix + tests + R-RES spec) |

## 3. Open integration steps (Wave-next)

1. **Writers**: the Agent OS integration (flauz-agent) becomes the primary
   mutation source — refs for agent sessions, browser sessions, artifacts;
   the graph's library surface (`ResourceGraph`/`ContinuityService`) is the
   seam. A `flauz.res.restore` command surface lands with the runtime
   drivers (needs an actor source for fail-closed provenance).
2. **Browser runtime (Worker A)**: session creation emits a
   `browser-session` ref + `BrowserSurface` (+ `bound-to` environment);
   recovery/reattach consumes `ContinuityService.restore` and re-versions
   the surface on endpoint swap. The `state: 'unknown'` placeholder in the
   pinned summary is replaced by the real descriptor states.
3. **Environment runtime (Worker B)**: lifecycle transitions surface in the
   environment summary; `snapshot-of` artifacts for env snapshots; the
   plan re-execution hint composes with `flauz.env.activate`/`switch`.
4. **flauz-workspace**: task/evidence mutations record refs + `produced`
   edges; the ops ledger's before/after digests can be cross-anchored with
   the evidence ledger's checkpoints (both are digest chains).
5. **Boot-level canary (P1)**: the bundled-extension surface grep for the 4
   `flauz.res.*` commands follows the C-ENV phase-2 recipe once a
   runtime-dependent lane lands (the lane-presence probe is already in the
   workflow).

## 4. Product-side code (FORK-CRITICAL ledger)

**EMPTY.** No `src/vs/**` change is required. The branch's deltas are
purely additive: `extensions/flauz-resources/**`,
`.github/workflows/flauz-resources.yml`, `build/flauz/canaries/R-RES.md`,
`test/fixtures/resources/**`. `product.flauz.json` is untouched (no
proposals); `.eslint-allowed-javascript-files` is untouched (the canary is
YAML-embedded, written to `$RUNNER_TEMP` at runtime).

## 5. DECISION-LOG proposals (for the TL)

- **DL-R1 (proposed)** — URN namespace map: `browser-session` -> `browser`,
  `agent-session` -> `agent` (symmetric with Worker A's pinned
  `flauz:browser:` ids); environment refs carry the registry descriptor id
  as the local part. The agent-session namespace is THIS lane's assumption —
  reconcile when the AgentSessionDescriptor id shape lands.
- **DL-R2 (proposed)** — edge legality matrix (v0 closed set): the
  from/to kind lists per edge kind in `src/api.ts` are a typed, test-pinned
  RESTRICTION, not free-form graph edges. Widening is deliberate (matrix +
  tests + fixtures together).
- **DL-R3 (proposed)** — ops-ledger integrity model: state-digest chaining
  (before/after sha256 of the canonical envelope per record) rather than
  per-row hash chaining (the flauz-workspace evidence ledger model). Same
  fail-closed goal, adapted to a whole-document state artifact.
- **DL-R4 (proposed)** — restoration origin rule: `restore()` requires an
  explicit origin or a `snapshot-of` ancestor (no free-floating
  restored-from edges). If integration needs origin-less re-attach
  semantics, that is a deliberate contract change.
- **DL-R5 (proposed)** — no surface-kind × ref-kind legality matrix in v0
  (any ref may carry any surface family): avoids pre-constraining the
  parallel lanes' compositions; revisit with real usage data.

## 6. Open integration questions (for the TL)

1. Who OWNS ref minting for tasks/evidence — flauz-workspace directly, or a
   sync shim in this extension reading the sibling envelopes?
2. Should the environment summary's registry read (read-only probe) become
   a push (Worker B writes lifecycle state INTO the graph) once the env
   runtime lands? Push is more current; probe has zero coupling.
3. Does the Agent OS want graph subscriptions (refs/surfaces changed) via
   the vscode event surface, or is polling the file enough for v1?
4. `agent-session` namespace confirmation (DL-R1) — needs the Agent OS
   lane's session id shape.
5. Multi-root workspaces: v0 binds the FIRST workspace folder (like the
   sibling lanes); a per-folder graph model is a v1 decision.
