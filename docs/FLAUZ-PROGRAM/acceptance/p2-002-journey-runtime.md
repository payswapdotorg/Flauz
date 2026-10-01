# P2-002 Journey Runtime Evidence — Full Product Acceptance (Worker A)

## Header

| Field | Value |
|---|---|
| Work order | P2-002 — full product acceptance journey (Worker A — journey runtime) |
| Pinned base | `7558680d8c537cc724c5026ca4a637afc86a1d72` (origin/main HEAD at dispatch) |
| Branch | `p2/a-journey-runtime` |
| Date | 2026-09-30 (Africa/Accra) |
| Harness (new, zero-dep) | `build/flauz/journey/p2-002-journey.mjs` (the gate) + `build/flauz/journey/journey.drill.ts` (the runtime drill) + `build/flauz/journey/records/` (per-leg receipts; format documented in `records/README.md`) |
| Canonical command | `node build/flauz/journey/p2-002-journey.mjs --root . --require` (driven with a real headless Chrome-for-Testing 153.0.8010.12 CDP endpoint in `FLAUZ_CDP_ENDPOINT`; CI lane `.github/workflows/flauz-acceptance.yml`) |
| Evidence levels used | `runtime-real` — all 14 legs. NO `fixture`, NO `simulated`, NO `local-real`, NO `live-provider` claims in this artifact. |
| Verdict | **14/14 legs PASS — 110 drill assertions, 0 failures.** Every leg held every assertion; the residues below are honest distance, not weakened assertions; no leg was skipped or softened. |

The journey runs the REAL product runtime composed of the repo's established
drill machinery (the TL3-003/session/agentos patterns): real fs workspace
root; the real TaskService / EvidenceLedger (Ed25519 fixture signer) /
MemoryStore / WorkflowService / OrchestrationStore / A2ABus / environment
registry + lifecycle manager; the real `createOpenAiCompatAdapter` +
`nodeHttpPort` over a REAL local OpenAI-compatible wire; the real
`CloudHttpExecutor` over the Flauz cloud-sandbox wire contract; the real
`BrowserSessionManager` + `CdpEndpointHost` against a REAL headless Chromium
over a real CDP WebSocket; the real `LocalProcessExecutor` spawning the FIXED
`env-agent.ts` harness as REAL grandchild processes; and REAL child processes
for the mid-flight cancel and the SIGKILL restart. The agent-domain semantic
baseline this composes with: the TL2-ACC-1 rehearsal
(`extensions/flauz-workflow/test/agentos-journey.rehearsal.test.ts`, 13/13
legs PASS at fixture/simulated levels — re-run green on this base, see the
gates table).

## Per-leg verdict table

The command executed for every leg is the canonical gate command above (the
gate spawns `node --experimental-strip-types build/flauz/journey/journey.drill.ts`
with `FLAUZ_JOURNEY_RECORDS=build/flauz/journey/records`; each receipt's
`command` field carries the drill invocation; receipts are overwritten by a
fresh run — the committed copies are this verification run's).

| Leg | Description | Evidence level | Verdict | Receipt (assertions) | Notes |
|---|---|---|---|---|---|
| 1 | create/open workspace | runtime-real | PASS | `leg-01-workspace-open.json` (6) | The full substrate boots on a real fs root: task envelope, evidence ledger, tiered memory, model registry (capabilities materialized), environment registry, orchestration store, A2A bus. |
| 2 | create mission/task | runtime-real | PASS | `leg-02-mission-task.json` (6) | `submitGraph` minted the mission -> task envelope (T-001, 5 steps, 2 human-approval gates) and persisted it on disk; journal rows carry agent/human attribution; graph approved. |
| 3 | start agent session | runtime-real | PASS | `leg-03-agent-session.json` (4) | The primary agent's session: exclusive step claim (holder + actor attribution) + session-tier memory record persisted to `.flauz/memory/session.jsonl`. |
| 4 | choose a live provider/model | runtime-real | PASS | `leg-04-provider-model.json` (8) | The real registry + router: the zero-network default decision (flauz-mock/echo-1, labeled), then the workspace providers-file enablement act (a REAL `flauz.model-providers/v0` file + user routing rule, rules are DATA); the durable decision ledger (rd-000001, rd-000002); a REAL chat completion streamed through the real `createOpenAiCompatAdapter` + `nodeHttpPort` over the real OpenAI-compatible wire (SSE, wire-echoed model, usage, provenance incl. requestHash, credentialRef resolved to the Bearer header on the wire). See the live-provider residue. |
| 5 | edit/read workspace resources | runtime-real | PASS | `leg-05-workspace-resources.json` (6) | The session's tool step edited + read the workspace resource on the real fs (round-trip, task-pinned), settled once on its idempotency key, and minted changeset evidence + the task's `changes` linkage. |
| 6 | use browser | runtime-real | PASS | `leg-06-browser-use.json` (6) | The real `BrowserSessionManager` + `CdpEndpointHost` + `RecordingWebSocketCdpTransport` against the real Chromium: session opened ACTIVE; the allowed navigation COMMITTED (exactly ONE `Page.navigate` on the real wire, committed URL pinned); the fail-closed denial probe (denied origin) sent ZERO additional wire commands; the session journal persisted; the journal hash-pinned into the shared evidence chain. |
| 7 | create/use environment | runtime-real | PASS | `leg-07-environment-use.json` (5) | The real registry + lifecycle manager + `LocalProcessExecutor`: create -> start -> a REAL grandchild harness process (live pid verified, `flauz.env-state/v0` state file on disk) -> stop (graceful; harness state `stopped`); every lifecycle op row carries provenance (actor). |
| 8 | delegate to another agent (A2A) | runtime-real | PASS | `leg-08-a2a-delegation.json` (8) | The real on-disk A2ABus round-trip: route-decided (WHY worker-1), typed `task-delegation` + `result-report` messages journaled, delegation-sent receipt linked, worker evidence attributed to the mission task, no ledger clobbering (+1 row exactly, chain verifies), the delegated step succeeded with runner worker-1. |
| 9 | require/handle approval or takeover | runtime-real | PASS | `leg-09-approval-takeover.json` (7) | FAIL-CLOSED end to end: the gate armed and the drive executed zero steps; the human interrupted the pending gate, accepted and completed the takeover (3 attributed rows, evidence minted into the shared chain); the step was completed by the HUMAN, never by an unapproved agent execution. |
| 10 | produce artifact/evidence | runtime-real | PASS | `leg-10-artifact-evidence.json` (4) | Note row + signed Ed25519 checkpoint + the mission workflow fragment (the run's distilled provenance) + the two-tool seed fragment; both hash chains verify at the midpoint. |
| 11 | exercise provider/environment failure | runtime-real | PASS | `leg-11-provider-env-failure.json` (11) | REAL wire failures: the model provider returned HTTP 500 twice (the typed `PROVIDER_OVERLOADED` classified from the REAL wire responses fed the bounded recorded retry: ordinals 1,2,3, outcomes retryable-failed/retryable-failed/recovered, waits 0/0/0; exactly 3 wire calls); the cloud-sandbox provider failed starts beyond the bound (typed `CLOUD_PROVIDER_ERROR`, bounded exhaustion at exactly 3 wire calls, ops-ledger attempt rows); the exhaustion probe failed TERMINALLY (retryPlanned false, graph failed honestly — never a silent success). |
| 12 | retry/cancel/recover | runtime-real | PASS | `leg-12-retry-cancel-recover.json` (6) | Retry/recover: the caller-driven second start recovered on a fresh bounded window over the real wire (6 wire calls total; 2 request-level rows 1 error + 1 ok; 5 recorded attempt rows). Cancel: a REAL child process re-ran the saved fragment W-001, blocked mid-flight on tool 1, the human cancelled the RUN TASK through the task machine cross-process, the child's next transition surfaced the typed stale-run-cancelled crash, tool 2 never ran, the task stayed terminal `cancelled` with the human-attributed cancel event. |
| 13 | restart | runtime-real | PASS | `leg-13-restart.json` (5) | TRUE process death: the finisher child (fresh instances on the SAME root) drove the final gated step; its effect SETTLED durably (the sink log line); the child froze inside the crash window and the parent SIGKILLed it — the journal append never landed (S-05 running, started, never succeeded); the frozen on-disk census: 30 journal rows, 20 ledger rows, 4 tasks, 8 sink-log lines. |
| 14 | resume task and inspect continuity/provenance | runtime-real | PASS | `leg-14-resume-continuity.json` (26) | Cold boot on the same root: NO silent state loss (tasks, ledger, journal, memory, A2A, routing decisions, workflow fragments, environment lifecycle — all recovered exactly); the recovery pass marked the interrupted step and fabricated nothing; WORK CONTINUED — the interrupted step re-drove on the SAME idempotency key (the settled effect REPLAYED: 1 fresh + 1 replay, never executed twice), the mission completed, the session claim was released with attribution; the provenance walk: ledger chain verifies (seqs contiguous), journal chain verifies, every evidence-bearing journal row resolves into the ledger, attribution intact for every actor (primary agent, delegate, human takeover, approver, canceller), the task<->ledger linkage holds, the workspace resource is still hash-pinned by its ledger row. |

## Summary verdict block

```
journey:        p2-002 (Worker A — journey runtime)
legs:           14 PASS / 0 FAIL / 0 SKIP
assertions:     110 (0 failing)
evidence:       runtime-real on every leg (no fixture/simulated claims)
receipts:       build/flauz/journey/records/ (14 leg receipts + journey-summary.json)
gate:           node build/flauz/journey/p2-002-journey.mjs --root . --require
                -> p2-002 journey: PASS -- 14/14 legs PASS (110 drill assertions)
gate fails:     doctored-receipt probe -> exit 1 (the gate fires); --verify
                re-checks an existing records dir without re-running the drill
CI lane:        .github/workflows/flauz-acceptance.yml (journey-static every
                push/PR on the surface; the runtime lane opt-in, pinned CfT)
findings:       0 non-pass legs; 5 routed findings P2-FIX-101..105 (instrument/
                evidence gaps and the four TL2-ACC-1 candidates — see findings/)
```

## Gates re-run on the delivery tree (real numbers)

| Gate | Command | Result |
|---|---|---|
| Fixture battery | `sh build/flauz/scripts/verify-fixtures.sh` | `verify-fixtures: ALL 219 CASES AS EXPECTED (0 deviations)` — exit 0 |
| Compat battery (CI invocation) | `node build/flauz/scripts/compat-battery.mjs --require` | `1887 rows — 1887 PASS · 0 FAIL · 0 SKIP — PASS (Flauz is additive over stock)` — exit 0 |
| Budget gate | `node build/flauz/scripts/budget-gate.mjs --json` | `0 pass / 0 fail / 45 skip / 0 warn` (documented skips; the runtime drills supply CI's enforced rows) — exit 0 |
| Activation lint | `node build/flauz/scripts/activation-lint.mjs --root .` | `ACTIVATION LINT GREEN` (9 manifests; R3 onStartupFinished declarers 2 <= 2) — exit 0 |
| Fork-critical guard | `sh build/flauz/scripts/fork-critical-guard.sh --base origin/main --head HEAD` | `PASS — src/vs divergence outside contrib/flauz is EMPTY` — exit 0 |
| **Journey gate (new)** | `FLAUZ_CDP_ENDPOINT=<real CfT ws> node build/flauz/journey/p2-002-journey.mjs --root . --require` | `p2-002 journey: PASS -- 14/14 legs PASS` + `p2-002 journey drill: GREEN (14 legs over the real runtime)` + `110 assertions, 0 failures` — exit 0 |
| Journey gate self-checks | `--list` / drill `--selftest` / `--verify build/flauz/journey/records --require` / doctored-receipt probe | catalogue 14 legs; selftest GREEN; verify PASS; doctored receipt -> exit 1 (fail-closed proven) |
| Agent OS battery (context) | `node build/flauz/scripts/agentos-battery.mjs --surge-rung` | `agentos-battery: PASS -- instrument green` (8/8 INV rows) — exit 0 |
| Session battery (context) | `node build/flauz/scripts/session-battery.mjs --root .` | `session-battery: PASS -- battery green (5 tests)` (fixture rung; J1-J4) — exit 0 |
| TL2-ACC-1 rehearsal (context) | `node --test extensions/flauz-workflow/test/agentos-journey.rehearsal.test.ts` | `agentos journey: GREEN -- 13/13 legs PASS` — exit 0 |

Extension source touched: **NONE.** The journey harness is additive-only
(`build/flauz/journey/**`, the CI lane, the allowlist entry, and these
acceptance/findings documents); every extension test suite above ran against
the pinned base unchanged.

## Honest residues

1. **live-provider rung not reached.** No vendor credentials
   (`FLAUZ_LIVE_PROVIDER_BASE_URL/_API_KEY/_MODEL`) exist in this sandbox.
   LEG 4 is honestly labeled `runtime-real`: the routing/enablement/adapter/
   wire path is the real production code path over a REAL socket, but the
   endpoint is a controlled local OpenAI-compatible stand-in, not a remote
   vendor. The rung exists and is wired: the drill invokes the repo's TL2-H1
   live drill (`extensions/flauz-models/test/canaries/live-provider-runtime.drill.ts`)
   and upgrades LEG 4 to `live-provider` when the env contract is present.
   This is a sandbox gap, not a product gap — no P2-FIX.
2. **No booted Code OSS workbench.** The journey drives the product's runtime
   surfaces headlessly (services + real child processes + real browser), not
   a launched workbench UI. The booted-workbench seam is documented future
   work in the existing session lane; the user-facing UX/discovery half of
   P2-002 is Worker B's lane (P2-003).
3. **Controlled failure backends.** The provider/environment failure legs
   exercise the REAL product code paths (adapter, executor, bounded recorded
   retry contracts) against locally scripted failure routes over REAL
   sockets. The failure injection is server-side scripting (the established
   INV-2/stub-provider pattern); no external network is touched.
4. **Orchestration-layer mid-drive cancel.** The journey's mid-flight cancel
   is driven at the task-machine layer in a REAL child process (the INV-3
   cross-process pattern — the product's cross-surface cancel seam). The
   orchestration-layer mid-drive cancel (single-process drive interleaving)
   was proven at the fixture level by TL2-ACC-1's LEG 9 (composing evidence;
   not re-claimed at runtime here).
5. **Chromium provisioning.** Chrome-for-Testing 153.0.8010.12 (the drills'
   pinned version) downloaded from the official Google storage in the
   verification environment; the CI lane does the same. Not a
   user-installed browser.
6. **Repo eslint lane not executable locally.** This sandbox has no repo
   `node_modules` (the vscode dev dependency tree is CI-scale); the full
   repo eslint run could not be executed here. Style conformance is by
   construction (tab indentation, single-quoted strings, the required
   copyright headers, zero runtime dependencies, the
   `code-no-new-javascript-files` allowlist entry for the new .mjs) and CI
   executes the full lint on the lane. Formatter-cleanliness follows the
   repo tsfmt config by construction (no local tsfmt binary available).
7. **Journey receipts are run products.** A fresh `--require` run overwrites
   the committed receipts (timestamps, durations, ephemeral ids vary);
   verdicts and assertion counts are deterministic for a given repo state.
   The station re-verification entry points: re-run the gate, or
   `--verify build/flauz/journey/records`.

## Proposed registry text (for TL1's WORK-REGISTRY merge wave — NOT applied; control-plane law)

> ### P2-002-A — Journey runtime acceptance (Worker A)
> Status: DONE (2026-09-30, TL4 — branch `p2/a-journey-runtime`, Worker A)
> Owner: TL4
> Purpose: execute the 14-leg canonical product acceptance journey over the
> real runtime and record per-leg runtime evidence.
> Completion record: 14/14 legs PASS at `runtime-real` (110 assertions, 0
> failures; 0 non-pass). Harness: `build/flauz/journey/p2-002-journey.mjs`
> (zero-dep gate, `--require` evidence mode, fail-closed receipts
> verification) + `build/flauz/journey/journey.drill.ts` (the runtime drill:
> real fs, real child processes incl. SIGKILL restart + mid-flight cancel,
> real A2A bus, real provider wire, real CDP, real LocalProcessExecutor) +
> `build/flauz/journey/records/` (per-leg receipts, README-documented
> format). CI lane `.github/workflows/flauz-acceptance.yml` (journey-static
> on every push/PR; the runtime lane opt-in with pinned Chrome-for-Testing
> 153.0.8010.12). Evidence artifact:
> `docs/FLAUZ-PROGRAM/acceptance/p2-002-journey-runtime.md`. Findings routed:
> P2-FIX-101..105 (four TL2-ACC-1 candidates formalized + one browser-journal
> evidence gap). Additive-only: no extension source, no src/vs, no
> control-plane edits. Honest residues: live-provider rung not reached (no
> vendor credentials in the sandbox; the rung is wired), no booted
> workbench (Worker B / P2-003 lane).
>
> ### P2-FIX-101..105 — acceptance findings routed
> Status: READY-TO-CLAIM (owners: 101/103/104 -> TL2; 102 -> TL1; 105 -> TL3)
> See docs/FLAUZ-PROGRAM/findings/P2-FIX-10[1-5]-*.md (each with evidence
> level, reproduction, owning TL, acceptance test, architecture impact).

## Re-run instructions (for the station)

From a checkout of the pinned base with this delivery applied:

```sh
# launch a real headless Chromium (the TL3-003/session/budgets drill pattern)
# and take the webSocketDebuggerUrl from http://127.0.0.1:9222/json/version
FLAUZ_CDP_ENDPOINT=ws://127.0.0.1:9222/devtools/browser/<id> \
  node build/flauz/journey/p2-002-journey.mjs --root . --require

# or re-verify the committed receipts without re-running the drill:
node build/flauz/journey/p2-002-journey.mjs --verify build/flauz/journey/records --require

# the machinery self-test (no Chromium, no sockets):
node --experimental-strip-types build/flauz/journey/journey.drill.ts --selftest
```

Expected markers: one `p2-002 journey drill: LEG nn <slug> PASS (n assertions,
evidence runtime-real)` line per leg, the final
`p2-002 journey drill: GREEN (14 legs over the real runtime)` line and the
census `p2-002 journey drill: 110 assertions, 0 failures`; the gate prints
`p2-002 journey: PASS -- 14/14 legs PASS` and exits 0. Without
`FLAUZ_CDP_ENDPOINT` LEG 6 records SKIP with the reason (exit 0 without
`--require`, FAIL with it) — never a silent skip.
