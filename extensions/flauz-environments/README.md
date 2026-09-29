# Flauz Environments (Wave 4, Lane J + TL3-003 + TL3-004 + TL3-006)

The Flauz environment registry: typed environment descriptors persisted at
`.flauz/environments.json` (`flauz.environments/v0`), descriptor-level
provider adapters for the four v0 environment kinds, connection-plan
generation (the v0 artifact — **no live connections**), the env-switch
session-continuity model (N-8, re-open-based), and — since TL3-003 — a REAL
environment **lifecycle** behind executors
(`src/lifecycle/`): `create | start | stop | attach | detach | snapshot |
destroy` + the `describe` health probe, with MANDATORY provenance, fail-closed
trust enforcement, and two NEW sibling state envelopes (the PIN-2 contract).
Since TL3-004 rung 1, the remote kinds are REAL behind the same contract:
`ssh-local` drives the system `ssh` binary (`ssh-cli`), `container` drives
the system `docker` daemon (`docker-cli`), and `cloud-sandbox` speaks the
Flauz cloud-sandbox wire contract v0 over HTTP (`cloud-http`) — all behind
injectable `CliPort`/`HttpPort` seams, all fail-closed with typed capability
errors when the binary/daemon/keys/endpoint are absent.
Since TL3-H1 rung 2, the workbench AUTHORITY RESOLVER is live: the extension
registers the `flauz-env` authority resolver through the proposed
`registerRemoteAuthorityResolver` surface (the `resolvers` grant lands in
the same commit — DL-19/DL-33) and resolves registered provider kinds'
connection plans with trust/policy gating (see "The authority resolver"
below).
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
  - `cliPort.ts` — **the `CliPort` seam (TL3-004)**: EVERY process the real
    remote executors spawn goes through `spawnCli(argv, {stdin, timeoutMs})`
    (bounded, SIGKILL-on-timeout, typed `spawnError` for the ENOENT class);
    includes the harness stdio-protocol parser (`parseHarnessStdio`). The
    production `NodeCliPort` wraps `node:child_process`; `test/fakeCli.ts`
    scripts it (records argv + canned results — every failure class provable
    without real binaries). This is the audit point: grep `spawnCli(` to find
    every place a provider process comes from.
  - `sshCli.ts` — **`SshCliExecutor`** (`executorKind: 'ssh-cli'`, REAL
    effects, kind `ssh-local`): probe `ssh -V`; create = `ssh <target>
    true` connectivity/auth probe; start ships the FIXED harness over stdin
    (`ssh <target> 'mkdir -p <dir> && nohup node - --state-dir ... >
    <dir>/harness.out 2>&1 &'` — command-free pipe, argv tokens
    executor-constructed only); stop/destroy = graceful `kill -15` then
    `kill -9` on the harness-reported pid ONLY (never-signal-foreign-pids);
    snapshot = `ssh cat` -> the canonical manifest; describe = crash
    reconciliation against the remote state file (`kill -0` liveness).
  - `dockerCli.ts` — **`DockerCliExecutor`** (`executorKind: 'docker-cli'`,
    REAL effects, kind `container`): probe `docker info` (typed
    `DAEMON_UNREACHABLE` when the daemon is down); start = `docker run -d`
    keep-alive holder + `docker cp` the FIXED harness in + `docker exec
    sh -c 'tail -f /dev/null | node /flauz/env-agent.ts ...'` (the stdin
    pipe-holder keeps the fixed program alive — its EOF law); stop/destroy =
    harness-signal escalation then the blessed container-scoped
    `docker stop --time <grace>`/`docker rm` (pid-namespace bounded);
    snapshot = `docker cp` out; describe = reconciliation against real
    `docker inspect`.
  - `cloudHttp.ts` — **`CloudHttpExecutor`** (`executorKind: 'cloud-http'`,
    REAL effects, kind `cloud-sandbox`): the Flauz cloud-sandbox wire
    contract v0 over the injectable `HttpPort` (production = stdlib fetch +
    `AbortSignal.timeout`). `apiKeyRef` resolves ONLY through the injectable
    `SecretResolverPort` (`env:<NAME>` from the process environment,
    `vault:<NAME>` from the host secret storage; literal keys are rejected
    at the descriptor schema level). The endpoint is executor WIRING (the
    `flauz.environments.cloudApiBaseUrl` setting; empty = typed
    `CLOUD_UNREACHABLE` fail-closed) — never descriptor data (DL-29).
  - `simulated.ts` — `SimulatedRemoteExecutor`: **TEST INFRASTRUCTURE — NOT
    PRODUCTION CODE** (deterministic remote-kind drills, styled after
    flauz-browser's FakeCdpTransport), still wired behind the explicit
    `simulated` opt-in.
- `fixtures/env-agent.ts` — the FIXED harness script the executors run
  (a stdio-protocol sleeper/state-tracker; the ONLY executable ANY executor
  will ever run — local, over ssh, or in a container — descriptor-supplied
  execution is forbidden).
- `src/resolver/` — **TL3-H1 rung 2, the authority resolver core** (pure,
  vscode-free; the ONLY vscode-importing file stays `src/extension.ts`):
  - `types.ts` — the `flauz-env` authority prefix, the typed failure
    taxonomy (AUTHORITY_MALFORMED / ENVIRONMENT_ABSENT / PLAN_ABSENT /
    TRUST_REFUSED / POSTURE_REFUSED / ENDPOINT_UNRESOLVED /
    SECRET_UNRESOLVED / BRIDGE_MISCONFIGURED — mirroring the rung-1
    executor codes as `detail`), and the typed resolution envelope.
  - `authority.ts` — the authority grammar `flauz-env+<kind>+<envId>`
    (pure, total; every malformed class typed).
  - `resolver.ts` — `FlauzEnvResolver`: the pipeline (grammar -> registry
    lookup -> connection plan -> TRUST/POLICY gate -> per-kind endpoint
    probe through the rung-1 `CliPort`/`HttpPort`/`SecretResolverPort`
    seams -> the AHP bridge handshake riding the result).
- `src/extension.ts` — the thin vscode wiring: command-driven activation
  only (`onCommand:flauz.env.*` + `onView:flauz.environments`; activation-lint
  R3 keeps this extension off `onStartupFinished`). TL3-004 wires the REAL
  remote executors; TL3-H1 rung 2 registers the `flauz-env` authority
  resolver (feature-detected — the flauz-browser proposed-API posture) and
  maps the typed core outcome onto the vscode `ResolverResult` surface.
- `test/` — `node --test` suites (registry / providers / continuity /
  fixtures / **lifecycle / localProcess / simulated / fixtures-lifecycle** /
  **sshCli / dockerCli / cloudHttp** + the skip-gated `liveRemote` LIVE drills
  + `fakeCli.ts` the scriptable `CliPort` double / **continuityExec /
  fixtures-continuity** / views / **resolver (TL3-H1): resolverAuthority +
  resolver + the skip-gated resolverLive LIVE drills** + the CI boot drill
  lives OUTSIDE the suite: the test-driver fixture at the repo root's
  `test/fixtures/resolver-driver/` + the evaluator
  `build/flauz/scripts/cenv-resolver-boot-drill.mjs`, the
  b-policy-boot-drill pattern). Zero dependencies;
  Node >= 23.6 (type stripping). The repo fixture matrices live at
  `test/fixtures/environments/`, `test/fixtures/environments-lifecycle/` and
  `test/fixtures/continuity/` (repo root).

## The lifecycle (TL3-003)

Typed states: `registered -> created -> starting -> running <-> stopping ->
stopped -> destroyed` (+ `failed` with an error record, + the attach/detach
connection substate carried as `/attached` composites on running/stopped).
Every mutating op is ledger-recorded with MANDATORY provenance
(`agent|human|tool` — a missing actor is a schema rejection), before/after
state and a typed result/error. ONE mutating op runs per environment at a
time: a second op issued while one is in flight is the typed pre-flight
rejection `OP_IN_FLIGHT` (nothing recorded, nothing mutated) — concurrent
commits could otherwise interleave and record an impossible sequence (e.g. a
start-ok landing after a destroy-ok), silently violating the state machine's
terminal states. `describe` is a read-only probe that never
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

### The bounded provider retry (TL2-F2B)

The manager's provider-facing op path retries a RETRYABLE typed provider
error automatically, bounded and recorded (`src/lifecycle/providerRetry.ts`
is the policy; the loop lives in the manager's `runExecutorOpBounded`, the
semantic mirror of the landed durable-runtime retry — PR #45):

- **Trigger** — only a typed retryable provider error class: the executor
  surfaces a structured, EPHEMERAL `providerRetryHint: { status,
  retryAfterMs? }` on the failed effect error (the cloud executor attaches
  it to `CLOUD_PROVIDER_ERROR`; the hint is never persisted — the ledger
  payload stays exactly `{code, message}`). Retryable at this seam: 5xx and
  the network-ish 429. Everything else keeps the single-shot honest path
  byte-identically: hint-less classes (404 `CLOUD_SANDBOX_UNKNOWN`, auth,
  unreachable, timeout, vault, the local/simulated/ssh/docker executors),
  4xx hints, malformed hints (never retried — fail-closed), and a thrown
  executor (outcome-unknown; `EXECUTOR_THREW` never re-issues).
- **Bound** — `maxAttempts` TOTAL attempts (default 3), configured through
  the ADDITIVE manager-options field `providerRetry: { maxAttempts?: n }`.
  `{ maxAttempts: 1 }` is the off-switch: byte-identical single-shot, no
  attempt rows (the additivity law). An invalid config is a typed
  fail-closed constructor throw (`RETRY_CONFIG_INVALID`).
- **Backoff** — the provider's Retry-After-style hint is honored, capped at
  30s; otherwise a minimal fixed delay (25ms). The wait is an INJECTABLE
  port (`providerRetryWait` on the manager options; default: the real
  timer) — tests, the battery and the drills never really sleep.
- **Recording** — every attempt of an ENGAGED window appends one ops-ledger
  row with the pinned key set; the ordinal/bound/wait/next facts ride
  `error.message` in the parseable grammar
  `provider retry attempt <n>/<max> on <op>: <CODE> (wait <ms>ms, next
  attempt <n+1> | window exhausted) - <original message>` (the typed
  outcome is the row's `error.code`; the row is state-preserving on the
  in-flight phase, e.g. `starting`). Windows that never engage mint no
  rows; a within-window recovery mints no extra row — the request-level ok
  row closes the window and the recovered ordinal is reconstructable from
  the preceding row's next-attempt marker.
- **Exhaustion** — after `maxAttempts` retryable failures the op resolves
  to the EXISTING typed terminal failure outcome through the unchanged
  failure path (request-level error row, `failed` transition, typed
  `{ok:false, error}`): never a silent success, never an auto-pass.
- **Composability** — a caller-driven retry after exhaustion (a second
  `perform(...)`) opens a FRESH window from attempt 1 with a fresh budget.

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
  mutated, and the real authority resolver lands with the `resolvers` grant
  (rung 2; INTEGRATION-GAP.md). The executor is also KIND-AGNOSTIC
  infrastructure (a `kinds` option lets drills reuse the process/snapshot
  machinery). It spawns EXACTLY ONE executable — `fixtures/env-agent.ts`
  run via `node` (in the extension host with `ELECTRON_RUN_AS_NODE=1` when
  `process.execPath` is Electron — the standard pattern) — never a
  descriptor-derived command; pids are tracked in-memory; stop/destroy is
  graceful-SIGTERM-then-SIGKILL with full reaping; snapshots are REAL fs
  copies to `.flauz/env-snapshots/<envId>/<epochMs>/` with a canonical
  `manifest.json` (sha256 per file, `flauz.env-snapshot-manifest/v0`);
  attach/detach mint a logical connection lease (id + held-since) recorded
  in the lifecycle state — no process effect, a REAL state transition with
  provenance.
- **Real remote (TL3-004 rung 1)** — `SshCliExecutor` (`ssh-local`),
  `DockerCliExecutor` (`container`), `CloudHttpExecutor` (`cloud-sandbox`):
  REAL effects behind the same `EnvironmentExecutor` contract, resolved by
  the manager WITHOUT any opt-in (the `simulated` request flag / setting
  still selects the drill executors on demand). Every process/socket goes
  through the `CliPort`/`HttpPort` seams; every argv/url token is
  executor-constructed from registry-VALIDATED descriptor DATA fields
  (host/port/user are data; there are no command/shell/script fields to
  abuse — the injection law). The fixed-harness invariant is EXTENDED to
  every execution surface: the ONLY program any executor runs — locally,
  over ssh, or inside a container — is `fixtures/env-agent.ts` (byte-for-byte
  the shipped file; descriptor-supplied execution is forbidden everywhere).
  Capability detection is first-class and fail-closed: absent ssh binary =>
  typed `CLI_NOT_AVAILABLE`; absent docker daemon => typed
  `DAEMON_UNREACHABLE`; unresolvable `apiKeyRef` => typed
  `VAULT_REF_UNRESOLVED`; unset cloud endpoint => typed `CLOUD_UNREACHABLE`
  (never a silent fallback, never a crash). Never-signal-foreign-pids holds
  on every surface: a live pid/container backing state this executor
  instance did not start is surfaced as `orphan` and NEVER signalled
  directly (container recovery is the pid-namespace-bounded `docker stop`).
- **Remote-simulated — `SimulatedRemoteExecutor`**
  (`executorKind: 'simulated-<kind>'`, **TEST INFRASTRUCTURE — NOT
  PRODUCTION CODE**) for `ssh-local` / `container` / `cloud-sandbox`:
  deterministic, file-backed state (`.flauz/env-sim/<envId>.json`,
  shareable across instances for host-restart drills), injectable latency +
  failure cues, NO live connections. It is driven ONLY behind an explicit
  opt-in: the per-request `{ simulated: true }` argument or the
  `flauz.environments.simulated` setting (default `false`). A kind served
  only by simulated executors with no opt-in still fails closed with a
  typed `SIMULATED_NOT_OPTED_IN` error — no fake claims of real remote
  control.

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
- NO command/shell/script fields in descriptors EVER: the fixed-harness
  invariant covers EVERY execution surface — the ONLY program any executor
  runs (local, over ssh, in a container) is the fixed
  `fixtures/env-agent.ts` shipped inside this extension; descriptor-supplied
  execution is forbidden (fail-closed against injection). The executors
  refuse to signal any pid they did not start (`orphan` verdicts;
  `PROCESS_NOT_OWNED` rejections).

## The authority resolver (TL3-H1 rung 2)

Rung 2 ships the LIVE WORKBENCH RESOLVER CODE: the extension registers ONE
authority resolver under the prefix **`flauz-env`** via the proposed
`vscode.workspace.registerRemoteAuthorityResolver` surface (the `resolvers`
grant — `product.flauz.json` `extensionEnabledApiProposals` + the manifest's
`enabledApiProposals` — lands in the SAME commit as this code; DL-19/DL-33,
no dead config). All resolution logic is the pure core in `src/resolver/`;
`src/extension.ts` only maps the typed outcome onto the vscode surface
(feature-detected: a host without the live grant records the typed disabled
state instead of crashing).

### The authority grammar (pinned; stable contract)

```
authority := "flauz-env" "+" <kind> "+" <envId>
```

- ONE prefix (`flauz-env`) — the workbench dispatches every `flauz-env+...`
  authority to this resolver.
- `<kind>` — one of the four v0 kinds (the registered provider kind is
  encoded in the authority).
- `<envId>` — the registry's logical id, the same `env-[a-z0-9][a-z0-9-]{0,47}`
  grammar the descriptors + PIN-2 entries key on.
- The `a@b` nested-authority transit is NOT part of v0 (typed
  AUTHORITY_MALFORMED / NESTED_TRANSIT).

### The trust/policy gate (the center of gravity)

The lifecycle manager's fail-closed gate EXTENDS to resolution — the
resolver READS the same verdicts, it never re-derives trust:

- **TRUST_REFUSED** — the descriptor's posture is `untrusted`, OR the
  environment has no PIN-2 lifecycle entry (never created: an unproven
  backing never resolves). An untrusted environment NEVER resolves, even
  with a perfect plan and a green probe.
- **POSTURE_REFUSED** — the descriptor is disabled, or the PIN-2 state is
  outside the connection-eligible running family
  (`running` / `running/attached`) — resolution is connection-scoped.
- **Re-resolution re-checks the CURRENT state**: every `resolve()` call
  re-reads the registry + PIN-2 state (nothing cached) — a trust or state
  flip between resolves flips the verdict (pinned by tests).

### Per-kind resolution semantics (the honest v0 scope)

| kind | probe (rung-1 seam, rung-1 semantics) | transport result |
|---|---|---|
| `ssh-local` | `ssh <target> true` (the SshCliExecutor create probe, CliPort) | **endpoint**: the SSH transport endpoint (host, port ?? 22) — a real `ResolvedAuthority`; the remote-server spawn over it is the live rung |
| `container` | `docker inspect flauz-<envId>` (the describe probe; deterministic name) | **verified backing** (running container id) + `pending-live-rung` — the docker-exec stream / published port is the live rung; NO fabricated host:port |
| `cloud-sandbox` | `GET {base}/v0/sandboxes/{id}` (the wire contract v0; sandboxId from the rung-1 tracking record; apiKeyRef via the `SecretResolverPort` ONLY) | **verified backing** (running sandbox id) + `pending-live-rung` — the wire contract v0 reports status, not session endpoints (INTEGRATION-GAP section 7) |
| `workspace-remote` | the PIN-2 state itself (the local loopback posture — the TL3-003 binding decision) | **verified backing** + `pending-live-rung` — the loopback stand-in is a stdio harness, no TCP endpoint |

The vscode boundary maps `pending-live-rung` honestly to
`RemoteAuthorityResolverError.NotAvailable` naming the exact scope — never a
fabricated endpoint (the blueprint's own error posture).

### The AHP bridge handshake (ssh-local, bridged plans)

When the connection carries `agentHostBridge`, the result carries the
blueprint handshake (`--agent-host-bridge-port` +
`VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN`): the bridge port rides the
envelope (`agentHostBridge.bridgePort`), the token rides
`extensionHostEnv[VSCODE_AGENT_HOST_BRIDGE_CONNECTION_TOKEN]` resolved ONLY
through the `SecretResolverPort` (never materialized in descriptors or
logs). Bridged and embedded (`--agent-host-port`) are mutually exclusive —
a contradictory plan is a typed `BRIDGE_MISCONFIGURED` (the blueprint's own
up-front rejection).

### Scope decisions (recorded, not blurred)

- **tunnelFactory is NOT wired in v0**: an `ssh -L` forward needs a
  long-lived process and the `CliPort` seam is bounded-invocation by design;
  tunnels land with the live rung behind a dedicated session port. No fake
  tunnel.
- **resolveExecServer is not implemented in v0** (the `a@b` transit is
  out of the v0 grammar).
- The LIVE remote-session evidence (real server spawn over the endpoint,
  live tunnels, live `a@b` transit) stays with the skip-gated live rung
  (`test/resolverLive.test.ts` opts in with `FLAUZ_RESOLVER_LIVE_SSH=1` /
  `FLAUZ_RESOLVER_LIVE_DOCKER=1`; CI never fails for lacking a daemon).

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

Resolver (TL3-H1 rung 2 — typed results, never raw throws):
`flauz.env.resolver` (read-only registration surface: prefix, grammar,
kinds served, the live/disabled state — the CI drill asserts here) and
`flauz.env.resolve` (resolves `'<envId>'` / `{ id }` / `{ authority }`
through the SAME pure core the workbench authority path drives; the typed
outcome is returned directly).

## Development

```
npm run typecheck   # tsc --noEmit (uses the vendored vscode.d.ts)
npm run test        # node --test "test/*.test.ts"
node build/flauz/scripts/env-registry-canary.mjs   # from the repo root
```

Test discipline (TL3-004): every scripted drill runs against `FakeCli` /
`HttpPort` stubs / a local mock cloud server — NO real binaries needed, and
NO wall-clock readiness windows: the executor poll loops take an injectable
latency cue and the rigs drive VIRTUAL TIME (the latency advance moves the
injected clock), so a readiness/stop window expires in bounded iterations
with zero real waiting (a test never depends on a real timeout). The LIVE
drills (`test/liveRemote.test.ts`) exercise the real ssh binary + sshd and
the real docker daemon, each SKIP-GATED with an explicit printed SKIP line
when the binary/daemon is absent — they never fabricate a pass.

Known residual: the harness path resolves relative to `src/extension.ts`
(`../fixtures/env-agent.ts`); the TL1 bundler must ship `fixtures/` next to
`dist/` when this extension is packaged (v0 runs from source in the dev flow).
