# TL2-S3 - The Agent OS Runtime Verification Battery

Status: DELIVERED (TL2-S3, TL4 Worker B seconded into the TL2 Agent OS surge;
base `main` @ `2d9b4a43939adb1f439f8b9eb76d741c9470b54c`, branch
`tl2/s3-agentos-runtime`).

Mission: independently prove that the Agent OS is actually durable rather than
merely appearing durable in unit tests. The battery is a verification
INSTRUMENT: it measures the Agent OS as implemented and records findings as
data for TL2 (the architecture owner). It never defines orchestration
semantics, never weakens fail-closed controls, and never "fixes" the target
to go green.

Artifacts:

| Piece | Path |
|---|---|
| The gate (zero-dep, house conventions) | `build/flauz/scripts/agentos-battery.mjs` |
| The fixture-rung suite (node:test, real sources) | `extensions/flauz-workflow/test/agentos-battery.test.ts` |
| The runtime-rung drill (real ports) | `extensions/flauz-workflow/test/canaries/agentos-runtime.drill.ts` |
| The dedicated cross-extension typecheck | `extensions/flauz-workflow/tsconfig.agentos-battery.json` |
| The control fixtures | `test/fixtures/agentos-battery/` |
| The CI lane (two jobs) | `.github/workflows/flauz-agentos.yml` |
| The honest baseline | `build/flauz/agentos-battery-baseline.md` |

## 1. The invariant catalogue (permanent ids)

Eight invariants. The ids are permanent: fixtures, gates, CI, docs and verdict
documents use them verbatim.

```
INV-1  restart-recovery        process death/restart preserves logical task
                               state and provenance (journal, ledger, task
                               envelopes recover; work continues; no silent
                               state loss)
INV-2  provider-failure-retry  provider errors surface bounded, recorded
                               retry behavior; no silent success; task state
                               reflects the failure path
INV-3  cancellation-propagation  cancel mid-flight stops downstream work;
                               cancellation is recorded with attribution
INV-4  approval-interruption   an interrupted/taken-over approval gate stays
                               FAIL-CLOSED; takeover is recorded with
                               attribution; no approval = no execution
INV-5  lease-conflict          concurrent claimants on one lease: exactly
                               one winner; losers receive an explicit
                               conflict error (never silent double-execution)
INV-6  multi-agent-coordination  concurrent agents preserve evidence and
                               attribution (no ledger clobbering, no
                               cross-agent evidence attribution)
INV-7  evidence-provenance-integrity  the ledger hash chain verifies; any
                               tamper (doctored row, reordered chain) is
                               DETECTED, with the first broken link named
INV-8  partial-environment-browser-failure  a browser/environment leg dying
                               mid-step marks the task FAILED with evidence;
                               never a fake success
```

The journeys consume the existing stable contracts as-is: the
`flauz.tasks/v0` TaskService (task state machine, envelopes, validation), the
EvidenceLedger (append-only hash chain, VerifyResult), the chat-edit
checkpoint interop, the flauz-agent Orchestrator seam types and artifacts, the
flauz-models provider seam, the `flauz.workflows/v1` envelope + WorkflowService
re-run engine (approval modes), the BrowserSessionManager/policy/journal, the
environment lifecycle manager behind its executors (simulated, cloud-http,
local-process), and the `flauz.a2a/v0` messaging seam.

## 2. The verdict contract (deterministic, machine-checkable)

Every run emits a verdict document with one row per catalogue invariant:

```
{ "schema": "flauz.agentos-battery/v1",
  "rung": "fixture" | "runtime",
  "rows": [ { "invariant": "INV-5",
              "verdict": "PASS" | "FAIL" | "SKIP",
              "reason": "<exact reason - mandatory for SKIP/FAIL>",
              "violatedInvariant": "<named invariant + first failing
                assertion id - mandatory on FAIL>",
              "assertions": { "pass": <n>, "fail": <n> },
              "evidence": "<artifact paths / transcript hashes>" } ],
  "summary": { "pass": <n>, "fail": <n>, "skip": <n> } }
```

Binding rules (all machine-checked by the gate):

- **The coverage law** - a catalogue invariant with no row is itself a gate
  FAIL (a missing verdict is a broken instrument, not an omission). Unknown
  or duplicate rows fail the same way.
- **FAIL rows MUST identify the violated invariant and the first failing
  assertion id** - a symptom-only failure report ("test failed", a bare stack
  trace) is a contract violation and fails the gate.
- **SKIP rows MUST carry the exact reason** - a contract skip names the exact
  missing contract (e.g. "no lease conflict contract on main ... TL2-004
  pending").
- **PASS rows rest on at least one target assertion** - a PASS with zero
  assertions is blind.
- **The summary must match the rows** - drift is a malformed document.

Row verdicts are DATA about the Agent OS; the gate separates them cleanly from
instrument failures (journey crashes, malformed verdicts, blinded controls),
which always fail.

## 3. The one-contract-two-rungs law

The SAME journeys and the SAME verdict schema run at both rungs; ONLY the
ports change:

- **RUNG fixture** (default) - the session-battery pattern: FakeCdpTransport,
  the simulated remote executor, a scriptable HttpPort double for the cloud
  seam, an in-memory A2A port, temp-dir on-disk roots. Deterministic; runs in
  the gate's default mode and CI job `agentos-fixture`.
- **RUNG runtime** (opt-in, `--runtime`) - real ports: real child processes
  for the restart legs (kill and relaunch real processes against the on-disk
  root - the drill's `inv1-seed` is SIGKILLed; `inv1-recover` cold-boots),
  the real LocalProcessExecutor (real grandchild harness processes), a real
  local-origin HTTP server, a real CDP endpoint when `FLAUZ_CDP_ENDPOINT` is
  provided (SKIP honestly without it, exactly like the session drill), a stub
  provider server over a real socket for INV-2/INV-8, and the REAL on-disk
  A2A bus (`extensions/flauz-agent/core/a2a.mjs`) for INV-6 attribution.

The journeys, the row schema and the invariant ids are NEVER rewritten between
rungs. Two journeys (INV-4 approval gates, INV-7 ledger tamper detection over
real fs) have no rung-substitutable port at the fixture rung (their ports are
the on-disk task machine and a human-responder double already) and re-run
in-process against the same contracts; INV-5 stays the honest contract-skip at
both rungs. The first live double-rung run (CfT 153.0.8010.12) produced an
IDENTICAL census at both rungs - the law held, not just on paper.

## 4. The gate modes

`node build/flauz/scripts/agentos-battery.mjs [--root <dir>] [--fixtures <dir>]
[--json] [--list] [--require] [--surge-rung] [--no-fail] [--runtime]
[--verdict <file>]`

| Mode | Semantics | Exit |
|---|---|---|
| default | run the fixture rung; validate the verdict (coverage law, shapes, summary) and the committed doctored controls. Current-tree FAIL rows are honest DATA - findings block TL2's completion claims, not the instrument's landing. | 0 green / 1 harness/coverage/blindness failure / 2 usage |
| `--require` | evidence mode: environmental SKIP rows FAIL. Named-missing-contract distance rows (reason ends "; TL2-0NN pending") stay SKIP - the rung ran; the product contract is absent; they are promoted only by `--surge-rung`. | SKIP promotes to 1 |
| `--surge-rung` | completion-claim evidence mode: EVERY catalogue row must be PASS (FAIL or SKIP fails). **This is the mode the TL2 surge completion claim runs at** - the honest all-PASS bar for the surge's "durable Agent OS" demonstration. | any non-PASS row -> 1 |
| `--runtime` | run the drill instead of the fixture suite; without `FLAUZ_CDP_ENDPOINT` report SKIP (exit 0), FAIL under `--require`. The drill's verbatim GREEN evidence lines + ROW census are relayed to stdout (CI asserts on the relayed lines). | per mode above |
| `--verdict <file>` | validate a standalone verdict document against the same rules + mode semantics (the doctored-control and fixture-matrix driver). | per rules |

The gate always FAILS (exit 1) on: harness errors (journey crash = nonzero
suite exit), malformed/unreadable verdict documents, COVERAGE-LAW violations,
and INSTRUMENT BLINDNESS - the committed doctored controls MUST produce their
expected FAIL/tamper-detected verdicts; if a doctored control PASSES, the
instrument is blind and the gate FAILS.

## 5. The promotion ladder

```
fixture rung (default, CI job agentos-fixture, every push)
    |
    +-- --require         (evidence mode; environmental skips promote)
    |
    +-- --surge-rung      (completion-claim mode; every row must be PASS)
    |
    v
runtime rung (--runtime, CI job agentos-runtime: workflow_dispatch + weekly
canary; real child processes, real CDP via CfT 153.0.8010.12, real sockets,
the on-disk A2A bus; FLAUZ_CDP_ENDPOINT wired by the job)
```

The doctored controls and the verify-fixtures matrix prove failability in
BOTH directions at the fixture rung (a gate that cannot fail is not a gate);
the drill's `--selftest` proves the runtime machinery zero-dep.

## 6. The control fixtures (`test/fixtures/agentos-battery/`)

| Fixture | Purpose | Expected |
|---|---|---|
| `golden-verdict.json` | the all-instrument-green control (honest current-tree verdicts, 4/3/1) | clean under default semantics |
| `doctored-verdict-missing-row.json` | a catalogue row (INV-6) removed | gate FAILs (coverage law) |
| `doctored-verdict-blind-fail.json` | a FAIL row with the `violatedInvariant` stripped (symptom-only) | gate FAILs (verdict contract) |
| `doctored-ledger/` | a tampered ledger tree (row 3's uri altered) | the INV-7 journey detects it, names the first broken link (firstBadSeq 4) - a journey-level instrument control |

The verdict controls are wired into the gate (every default run re-checks
them: instrument blindness) and into the verify-fixtures matrix; the
doctored-ledger control is consumed live by the INV-7 journey at both rungs.

## 7. The re-entry law

If `build/flauz/scripts/agentos-battery.mjs` already exists at the dispatch's
pinned base, the job becomes VERIFY-AND-REPORT, not redo: audit the landed
battery against this spec, run every gate verbatim, and report what was
verified with exact results. Fix forward surgically only for real defects;
never rewrite history; never re-implement work already on main.

## 8. Hard boundaries honored

- **No orchestration semantics defined.** The battery consumes the existing
  contracts as-is. Where an invariant needs a contract that does not exist
  (leases), the row is SKIP with the exact missing contract named.
- **No fail-closed weakening.** No test-only bypasses, no policy relaxations,
  no approval shortcuts. The J3 law holds everywhere (denial paths send zero
  drive commands - inherited from the session battery's fail-closed journey).
- **No fake production claims.** The spec and the baseline state exactly what
  is proven, at which rung, on which head; the v0 slice's simplifications stay
  documented (the stub provider is the Flauz wire contract over a real
  socket, not a real E2B account; the flauz-models seam has no failure path).
- **Findings never redefine the architecture.** FAIL rows are findings for
  TL2 recorded as data; the battery never "fixes" the target to go green.
- **Zero FORK-CRITICAL.** `src/vs` untouched;
  `sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD`
  exits 0.

## 9. The honest residue (what the battery does NOT yet prove)

- **Workbench-level seams stay fixture-only** per the session-battery
  precedent: nothing here boots a Flauz workbench or drives the chat
  participant UI. The booted-workbench seam remains the session lane's
  documented future work.
- **INV-5 cannot run** until TL2-004 lands the lease contract; when it does,
  the conflict journey must be written against THAT contract (a work order,
  never invented by the verifier).
- **The runtime rung's browser legs** ride the real-Chromium divergences
  pinned by the TL3-003 drill (F-DELIVERY .. F-RECOVERY-DOMAINS); the
  battery inherits that drift-canary posture rather than re-pinning it.
- **The concurrency finding (INV-6)** is demonstrated through a deterministic
  rendezvous (both readers provably observe the same pre-state) - a
  deterministic proof of the lost-update class, not a fuzzed race; the
  architectural fix (seq uniqueness / serialization) belongs to TL2-001.
- **The cancellation finding (INV-3)** is demonstrated through the recorded
  crash surface (typed state-machine rejection at the next transition) - the
  propagation semantics themselves are TL2-001's to define.
