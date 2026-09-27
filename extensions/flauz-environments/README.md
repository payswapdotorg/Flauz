# Flauz Environments (Wave 4, Lane J + TL3-003 + TL3-006)

The Flauz environment registry: typed environment descriptors persisted at
`.flauz/environments.json` (`flauz.environments/v0`), descriptor-level
provider adapters for the four v0 environment kinds, connection-plan
generation (the v0 artifact — **no live connections**), the env-switch
session-continuity model (N-8, re-open-based), and — since TL3-003 — a REAL
environment **lifecycle** behind executors
(`src/lifecycle/`): `create | start | stop | attach | detach | snapshot |
destroy` + the `describe` health probe, with MANDATORY provenance, fail-closed
trust enforcement, and two NEW sibling state envelopes (the PIN-2 contract)
— and, since TL3-006, continuity as an EXECUTABLE capability
(`src/continuityExec/`): export -> carry -> restore -> verify over
content-addressed bundles with the secret-redaction law and a NEW
append-only continuity ops ledger.

## Layout

- `src/api.ts` — descriptor/envelope types, validation predicates, canonical
  serialization (DL-9 discipline), `FileSystemPort`/`Clock` ports.
- `src/registry.ts` — `EnvironmentRegistry`: bootstrap / register /
  unregister / list / get / activate / deactivate / `planFor`; atomic
  tmp+rename persistence; sorted-by-id stable diffs; `parseEnvelope` with
  index-context errors.
- `src/providers/` — the four v0 provider adapters (`ssh`, `container`,
  `cloud-sandbox`, `workspace-remote`) + dispatch (`index.ts`). Each adapter
  validates its kind-specific connection shape and generates a
  `flauz.connectionPlan/v0` document whose steps carry tree citations
  (the plan is the artifact). The SSH adapter encodes the AHP RemoteProxy
  bridge handshake (`VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN` +
  `--agent-host-bridge-port`, mutually exclusive with `--agent-host-port`).
- `src/continuity.ts` — the N-8 model: persists/re-hydrates/lost artifact
  canon (16 surfaces), the switch state machine, `planSwitch` documents
  (TL3-006: an ADDITIVE optional `continuityBundleId` lets a plan reference
  a bundle to carry), and the PERF 5.5 overhead-accounting hooks
  (`code/flauz/*` mark pairs).
- `src/continuityExec/` — TL3-006, the continuity EXECUTION layer:
  - `types.ts` — the two NEW sibling-envelope shapes
    (`flauz.continuity-bundle/v0` + `flauz.continuity-ops/v0`), typed
    error codes, outcome envelopes, the bundleId grammar
    (`flauz:continuity:<16-hex>`, the browser-session id discipline).
  - `surfaces.ts` — the CLOSED surface table: the 16-surface N-8 canon
    materialized from actual `.flauz/` state + the post-canon state
    surfaces (PIN-1 journal, PIN-2 lifecycle pair, resources graph + ops,
    workflow state); the secret-shape classification (`captured` ->
    redacted by law).
  - `store.ts` — strict parsing (closed table, cross-field rules,
    path-traversal rejection, re-derived redaction path hashes), canonical
    serialization, pure-TS sha256, the append-only ops ledger.
  - `manager.ts` — `ContinuityManager`: export / restore / verify / status
    (typed outcomes, provenance law, atomic staging + commit rename).
- `src/lifecycle/` — TL3-003, the environment lifecycle:
  - `types.ts` — the PIN-2 shapes, typed states, provenance actors, typed
    error codes, describe verdicts, op outcomes.
  - `stateMachine.ts` — `registered -> created -> starting -> running <->
    stopping -> stopped -> destroyed` (+ `failed`, + the `/attached`
    connection substate on running/stopped). Illegal transitions are typed
    errors, never silent.
  - `store.ts` — the PIN-2 sibling-envelope persistence (strict parsing,
    canonical serialization, atomic writes, append-only ledger).
  - `manager.ts` — `EnvironmentLifecycleManager`: the orchestrator
    (provenance law, trust gate, executor resolution, ledger records).
  - `executor.ts` — the `EnvironmentExecutor` port (typed ops + probe).
  - `localProcess.ts` — the LOCAL-REAL executor (see the binding decision
    below): real node processes, real fs snapshots, terminate/reap.
  - `simulated.ts` — `SimulatedRemoteExecutor`: **TEST INFRASTRUCTURE — NOT
    PRODUCTION CODE** (deterministic remote-kind drills, styled after
    flauz-browser's FakeCdpTransport).
- `fixtures/env-agent.ts` — the FIXED harness script the local-real executor
  spawns (a stdio-protocol sleeper/state-tracker; the ONLY executable the
  executor will ever run — descriptor-supplied execution is forbidden).
- `src/extension.ts` — the thin vscode wiring: command-driven activation
  only (`onCommand:flauz.env.*` + `onView:flauz.environments`; activation-lint
  R3 keeps this extension off `onStartupFinished`). No resolver registration
  and no live remote connections in this lane — see `INTEGRATION-GAP.md`
  (real providers = TL3-004; the `resolvers` grant stays absent per DL-33).
- `test/` — `node --test` suites (registry / providers / continuity /
  fixtures / **lifecycle / localProcess / simulated / fixtures-lifecycle** /
  **continuityExec / fixtures-continuity** / views). Zero dependencies; Node
  >= 23.6 (type stripping). The repo fixture matrices live at
  `test/fixtures/environments/`, `test/fixtures/environments-lifecycle/`
  and `test/fixtures/continuity/` (repo root).

## The lifecycle (TL3-003)

Typed states: `registered -> created -> starting -> running <-> stopping ->
stopped -> destroyed` (+ `failed` with an error record, + the attach/detach
connection substate carried as `/attached` composites on running/stopped).
Every mutating op is ledger-recorded with MANDATORY provenance
(`agent|human|tool` — a missing actor is a schema rejection), before/after
state and a typed result/error. `describe` is a read-only probe that never
reports silently healthy: crash reconciliation surfaces a typed `stale`
verdict when the persisted state outruns the backing truth, and an alive pid
this executor never spawned surfaces as `orphan` (never signalled — pid
reuse could hit an innocent process).

### The PIN-2 file contracts (cross-worker, READ-ONLY consumers)

- `.flauz/environments-lifecycle.json` — envelope
  `flauz.environments-lifecycle/v0`:
  `{schemaVersion, schema, updatedAt, entries: {<envId>: {state, updatedAt,
  executorKind, lastOpRef}}}` (DL-9/DL-32 discipline: canonical sorted keys,
  2-space indent, one trailing newline, atomic tmp+rename writes).
- `.flauz/environments-ops.jsonl` — append-only, one canonical JSON line per
  op: `{"schemaVersion":0,"schema":"flauz.environments-ops/v0","ts":<epochMs>,
  "actor":"agent"|"human"|"tool","op":"create"|...,"environmentId":"<id>",
  "result":"ok"|"error","fromState":"...","toState":"...",
  "error?":{"code":"...","message":"..."}}`.

Key semantics: the connection substate lives INSIDE the `state` string
(`running/attached`) so the entry key set stays exactly the PIN-2 four;
`lastOpRef` is the 1-based line number of the environment's most recent
ledger record; `result:'error'` requires the `{code, message}` payload and
`result:'ok'` forbids it. Both shapes are pinned by the fixtures at
`test/fixtures/environments-lifecycle/` (valid + invalid samples).

## The continuity EXECUTION layer (TL3-006)

`src/continuity.ts` classifies the 16-surface canon; `src/continuityExec/`
makes it REAL: export -> carry -> restore -> verify, with provenance and
typed outcomes. `planSwitch` output gains an ADDITIVE optional
`continuityBundleId` (the switch state machine and the PIN-2 files are
untouched).

### The continuity bundle (`.flauz/continuity-bundles/<bundleId>/`)

A content-addressed export of the workspace's logical state, identified by
a LOGICAL id (`flauz:continuity:<16-hex>` — the browser-session id grammar
discipline; never a path, never a URL):

- `manifest.json` — envelope `flauz.continuity-bundle/v0`:
  `{schemaVersion, schema, bundleId, createdAt, actor, sourceEnvironmentId?,
  switchPlanRef?, surfaces: {<surfaceName>: {status:
  'carried'|'lost'|'redacted', artifactPath?, sha256?, bytes?, note?}}}`
  (DL-9/DL-32 canonical serialization, atomic writes).
- The CLOSED surface table materializes every surface from ACTUAL `.flauz/`
  state: the 16 N-8 canon surfaces + the post-canon state surfaces (the
  PIN-1 browser journal, the PIN-2 lifecycle pair, the resources graph +
  ops ledger, the workflow state). A surface with no file on disk is a
  typed `lost` entry with the canon name — never an error, never
  fabricated. Carried surfaces are copied into `surfaces/` with sha256
  recorded (directory surfaces carry a per-file tree manifest too).
- Every manifest covers the FULL table (22 surfaces in v0) — lost surfaces
  are typed entries, never dropped keys.

### THE SECRET-REDACTION LAW

A continuity bundle carries STATE, never secrets. Surfaces whose content
model admits secret-shaped material — the evidence ledger (captured
network/console rows), the artifacts directory (arbitrary captured bytes),
the browser session journal (tab URLs can embed tokens) — are exported as
typed `redacted` entries: their PRESENCE is recorded together with the
sha256 of their PATH, and the payload is NEVER copied into the bundle (the
parser re-derives the path hash — a fabricated redacted entry is
`BUNDLE_CORRUPT`). Structurally-validated envelopes (the vault-only policy
surfaces) are `carried`; as defense-in-depth the export deep-scans every
carried payload and fails closed with `EXPORT_SECRET_DETECTED` if a
secret-shaped literal is ever found (a source-envelope contract violation,
never a carryable state). Redacted surfaces ride the SCM surface or the
source environment instead of the bundle — the documented trade-off.

### The ops ledger (`.flauz/continuity-ops.jsonl`)

Append-only, one canonical JSON line per op, envelope
`flauz.continuity-ops/v0`: `{schemaVersion, schema, ts, actor, op:
'export'|'restore'|'verify', bundleId, result: 'ok'|'error', details?
{fromEnvironmentId?, toEnvironmentId?, surfacesCarried, surfacesLost,
surfacesRedacted}, error? {code, message}}` (MANDATORY actor — a missing
actor is a schema rejection; the existing content is re-validated and
preserved byte-for-byte before extension). Both new shapes are pinned by
the fixtures at `test/fixtures/continuity/` (valid + a 35-case invalid
matrix).

### Commands + the switch hand-off flow

- `flauz.continuity.export` — `{ actor?, environmentId?, switchPlanRef? }`
  -> the bundle manifest (materializes the bundle; journals the op).
- `flauz.continuity.restore` — `{ bundleId, actor?, targetEnvironmentId?,
  force? }` -> typed outcome: re-hydrates state files atomically (tmp+rename
  per file; all-or-nothing PER SURFACE with per-surface results), FAILS
  CLOSED on untrusted target environments, REQUIRES `force` to overwrite
  non-empty existing state (else typed `RESTORE_TARGET_NOT_EMPTY`), and
  records every surface outcome (`carried`/`lost`/`redacted`/`skipped` — a
  failed surface leaves the prior target state untouched).
- `flauz.continuity.verify` — `{ bundleId }` -> integrity check (manifest
  hashes re-verified against the bundle artifacts; the re-derivable path
  hash for redacted surfaces; typed per-surface verdicts).
- `flauz.continuity.status` — lists bundles + the ops ledger (read-only;
  staging leftovers and manifest-less dirs are flagged incomplete, never
  restorable).

The switch hand-off (documented flow, re-open model UNCHANGED — N-8):

1. **export at the source** — `flauz.continuity.export` (the bundle rides
   the workspace or is carried out-of-band);
2. **switch** — `flauz.env.switch { id, continuityBundleId }` -> the plan
   references the bundle; the workspace re-opens on the target authority
   (the switch state machine is untouched);
3. **restore at the target** — `flauz.continuity.restore { bundleId,
   targetEnvironmentId, force? }` (v0 boundary: restore re-hydrates the
   CURRENT workspace root's `.flauz/` state; `targetEnvironmentId` is the
   provenance/trust attribute — carrying bytes to a REMOTE filesystem is
   the TL3-004 provider lane).

Provenance at the command boundary: palette invocations default to actor
`human`; programmatic callers (agents/tools) pass `actor` explicitly — the
manager rejects any op without a valid actor (fail-closed).

### Executors

- **Local-real — `LocalProcessExecutor`** (`executorKind: 'local-process'`,
  REAL effects). KIND BINDING DECISION: it serves **`workspace-remote`** in a
  documented LOCAL-LOOPBACK posture — the descriptor's authorityPrefix is
  realized in this lane by a loopback agent-host stand-in (the fixed
  harness), not a remote authority resolver; the v0 kind vocabulary is NOT
  mutated, and real resolvers for all four kinds land in TL3-004. The
  executor is also KIND-AGNOSTIC infrastructure (a `kinds` option lets drills
  reuse the process/snapshot machinery). It spawns EXACTLY ONE executable —
  `fixtures/env-agent.ts` run via `node` (in the extension host with
  `ELECTRON_RUN_AS_NODE=1` when `process.execPath` is Electron — the
  standard pattern) — never a descriptor-derived command; pids are tracked
  in-memory; stop/destroy is graceful-SIGTERM-then-SIGKILL with full reaping;
  snapshots are REAL fs copies to `.flauz/env-snapshots/<envId>/<epochMs>/`
  with a canonical `manifest.json` (sha256 per file,
  `flauz.env-snapshot-manifest/v0`); attach/detach mint a logical connection
  lease (id + held-since) recorded in the lifecycle state — no process
  effect, a REAL state transition with provenance.
- **Remote-simulated — `SimulatedRemoteExecutor`**
  (`executorKind: 'simulated-<kind>'`, **TEST INFRASTRUCTURE — NOT
  PRODUCTION CODE**) for `ssh-local` / `container` / `cloud-sandbox`:
  deterministic, file-backed state (`.flauz/env-sim/<envId>.json`,
  shareable across instances for host-restart drills), injectable latency +
  failure cues, NO live connections. It is driven ONLY behind an explicit
  opt-in: the per-request `{ simulated: true }` argument or the
  `flauz.environments.simulated` setting (default `false`). Remote kinds
  without the opt-in fail closed with a typed `SIMULATED_NOT_OPTED_IN`
  error — this lane makes NO fake claims of real remote control.

### Security posture

- FAIL-CLOSED for agent side effects: `start`/`attach` on `untrusted`
  environments are ledger-recorded typed rejections naming the posture;
  `trusted`/`unknown` proceed per the DL-30 defaults (ssh-local `unknown`,
  container `trusted`, cloud-sandbox `untrusted` — so a default-posture
  cloud sandbox refuses start until the posture is reviewed). Every
  operation carries MANDATORY provenance (`agent|human|tool`).
- Secrets are never persisted: bridge tokens and cloud API keys are
  vault-style references (`vault:...` / `env:...`), validated at the schema
  level (literal keys are rejected) — SECURITY-MODEL 3.5.
- NO command/shell/script fields in descriptors EVER: the local-real
  executor runs ONLY the fixed harness shipped inside this extension;
  descriptor-supplied execution is forbidden (fail-closed against
  injection). The executor refuses to signal any pid it did not spawn
  (`orphan` verdicts; `PROCESS_NOT_OWNED` rejections).

## Commands

Registry v0: `flauz.env.list` / `flauz.env.register` / `flauz.env.unregister`
/ `flauz.env.activate` / `flauz.env.deactivate` / `flauz.env.showPlan` /
`flauz.env.switch` (plans the re-open switch and returns the switch plan).

Lifecycle (TL3-003 — every command returns a TYPED result, never a raw
throw): `flauz.env.create` / `flauz.env.start` / `flauz.env.stop` /
`flauz.env.attach` / `flauz.env.detach` / `flauz.env.snapshot` /
`flauz.env.destroy` / `flauz.env.status`. Arguments: `'<envId>'` or
`{ id, actor?, simulated? }`. Provenance at the command boundary: palette
invocations default to actor `human` (the command palette is a human
surface); programmatic callers (agents/tools) pass `actor` explicitly. The
`flauz.environments` tree view renders lifecycle state + last-op in row
descriptions (premium-ux row grammar; ages in descriptions, UTC stamps in
tooltips; codicons per phase).

Continuity (TL3-006 — typed results, never raw throws):
`flauz.continuity.export` / `flauz.continuity.restore` /
`flauz.continuity.verify` / `flauz.continuity.status` (see the continuity
EXECUTION section above; the same palette-defaults-to-human provenance
rule). `flauz.env.switch` accepts an ADDITIVE `{ continuityBundleId }`
argument that rides the returned switch plan.

## Development

```
npm run typecheck   # tsc --noEmit (uses the vendored vscode.d.ts)
npm run test        # node --test "test/*.test.ts"
node build/flauz/scripts/env-registry-canary.mjs   # from the repo root
```

Known residual: the harness path resolves relative to `src/extension.ts`
(`../fixtures/env-agent.ts`); the TL1 bundler must ship `fixtures/` next to
`dist/` when this extension is packaged (v0 runs from source in the dev flow).
