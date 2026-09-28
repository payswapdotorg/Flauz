# Agent OS Battery Baseline - TL2-S3

The honest first-run record of the Agent OS runtime verification battery
(gate `build/flauz/scripts/agentos-battery.mjs`, spec
`docs/FLAUZ-PROGRAM/TL2-AGENTOS-BATTERY.md`) at the pinned base.

- Base: `main` @ `2d9b4a43939adb1f439f8b9eb76d741c9470b54c` (the post-surge-setup
  control-plane head).
- Branch: `tl2/s3-agentos-runtime` (one commit on the pinned base).
- Runner: node v24.21.0 (`--experimental-strip-types`), zero-dep.
- Runtime rung: Chrome-for-Testing 153.0.8010.12 (headless, real CDP WebSocket),
  real child processes, the real LocalProcessExecutor, a stub provider server
  over a real socket, the on-disk A2A bus (`extensions/flauz-agent/core/a2a.mjs`).

## Row census (8 rows - the coverage law)

Every catalogue invariant carries exactly one row at both rungs; the census is
IDENTICAL at both rungs (the one-contract-two-rungs law held live: only the
port layer changed, the findings did not).

| Invariant | Verdict | First failing assertion | One-line reason |
|---|---|---|---|
| INV-1 restart-recovery | PASS | - | process death (SIGKILL of a real seed child at the runtime rung; service disposal at the fixture rung) preserves task state, provenance, journal, workflows, env lifecycle; work continues (the recovered W-001 re-run completes). |
| INV-2 provider-failure-retry | FAIL | `inv2.bounded-retry` | the failing provider surfaces typed, recorded errors (CLOUD_PROVIDER_ERROR, ops ledger, actor attribution, lifecycle `failed`, no silent success) but performs NO automatic bounded retry: 1 provider call before the typed error; retries are caller-driven only. TL2-002 pending. |
| INV-3 cancellation-propagation | FAIL | `inv3.downstream-stopped` | the mid-flight human cancel is recorded with attribution and the task stays terminal `cancelled`, but downstream work is NOT stopped: tool 2 executes after the cancel (the run then crashes with a typed state-machine error at the next transition append instead of propagating a typed cancellation). TL2-001 pending. |
| INV-4 approval-interruption | PASS | - | interrupted gates stay FAIL-CLOSED (cancel -> task cancelled + ZERO executor calls; request-changes -> task plan + ZERO executor calls; sign-off skip -> awaiting-signoff); every gate event carries actor=human + gate attribution. |
| INV-5 lease-conflict | SKIP | - | no lease conflict contract on main (the flauz.a2a/v0 resource-claim surface is informational-only by design; concurrent claimants cannot receive a conflict error); TL2-004 pending. |
| INV-6 multi-agent-coordination | FAIL | `inv6.no-clobber` | evidence and attribution are preserved per agent (A2A round-trip attributed; every concurrent row names its own task), but concurrent ledger appends through the deterministic lost-update rendezvous CLOBBER the chain (duplicate seq; verify fails with the first broken link named). TL2-001 pending. |
| INV-7 evidence-provenance-integrity | PASS | - | the hash chain verifies after restart; a doctored mid-chain row and a reordered chain are both DETECTED with the first broken link named; the committed doctored-ledger control fixture is detected (firstBadSeq 4). |
| INV-8 partial-environment-browser-failure | PASS | - | a dead cloud sandbox (HTTP 404 over the real socket at the runtime rung) and a browser transport dying mid-navigation both mark the wrapping task FAILED with evidence, recorded attribution, downstream stop and NO fake success (no committedUrl; describe never claims healthy). |

Summary at the pinned base: **4 PASS / 3 FAIL (findings) / 1 SKIP (distance)**.

## The findings are TL2's action list

The FAIL rows are recorded data, not instrument failures. They measure the v0
slice honestly and map 1:1 onto the registered TL2 lane items:

1. **INV-2 (bounded retry)** - bounded, recorded provider retry does not exist
   on the v0 slice; the failure path itself (typed error + recording + task
   state) is correct. Activated by the durable-orchestration retry semantics
   (TL2-001) plus real provider adapters/routing (TL2-002).
2. **INV-3 (cancellation propagation)** - a recorded cancel does not stop
   in-flight or downstream work; the state machine then rejects the stale run
   with a typed error rather than propagating the cancellation. Activated by
   the durable-orchestration cancellation semantics (TL2-001).
3. **INV-6 (concurrent append integrity)** - the append-only ledger has no
   concurrency control: two agents appending between reads of the same
   pre-state mint the same seq (the classic lost-update). Activated by
   durable-orchestration multi-agent routing (TL2-001; the seq-uniqueness fix
   is the architectural decision - the battery records the shape, TL2 owns it).

The SKIP row is distance, not missing evidence: the lease conflict contract
does not exist on main and the battery does not invent one. Activated by the
approval/takeover/lease semantics work order (TL2-004).

## First-run record (exact commands and results)

| Gate command | Result |
|---|---|
| `node --experimental-strip-types --test extensions/flauz-workflow/test/agentos-battery.test.ts` | 11 pass / 0 fail (exit 0) - census 4/3/1 |
| `node build/flauz/scripts/agentos-battery.mjs --list` | catalogue printed, exit 0 |
| `node build/flauz/scripts/agentos-battery.mjs` (default) | `PASS -- instrument green`, exit 0 |
| `node build/flauz/scripts/agentos-battery.mjs --json` | verdict document on stdout, exit 0 |
| `node build/flauz/scripts/agentos-battery.mjs --runtime` (with FLAUZ_CDP_ENDPOINT, CfT 153.0.8010.12) | `PASS -- runtime drill green (verdict validated)`, 16 drill assertions 0 failures, exit 0 - census 4/3/1 (identical) |
| `node build/flauz/scripts/agentos-battery.mjs --surge-rung` | exit 1 (the completion-claim mode correctly refuses the current findings/skips) |
| `node build/flauz/scripts/agentos-battery.mjs --verdict .../doctored-verdict-missing-row.json` | exit 1 (coverage law fires) |
| `node build/flauz/scripts/agentos-battery.mjs --verdict .../doctored-verdict-blind-fail.json` | exit 1 (symptom-only FAIL rejected) |
| `sh build/flauz/scripts/fork-critical-guard.sh --base upstream/main --head HEAD` | exit 0 (EMPTY ledger) |
| `sh build/flauz/scripts/verify-fixtures.sh` | ALL 201 CASES AS EXPECTED, 0 deviations (the matrix grew by the 11-case agentos-battery section) |
| `node build/flauz/scripts/session-battery.mjs` | PASS (sibling battery stays green) |
| `node build/flauz/scripts/compat-battery.mjs --require` | PASS (sibling stays green) |
| `tsc --noEmit -p extensions/flauz-workflow/tsconfig.agentos-battery.json` | exit 0 |
| `tsc --noEmit` (flauz-workflow main, with the new excludes) | exit 0 |
| `tsc --noEmit -p extensions/flauz-workflow/tsconfig.session-battery.json` | exit 0 (sibling typecheck unbroken) |

## Honest distance ladder (what activates each non-PASS row)

| Row | Missing contract on main | Activated by |
|---|---|---|
| INV-5 SKIP | lease conflict semantics (resource-claim notices are informational-only) | TL2-004 (approval/takeover/lease semantics) |
| INV-2 FAIL | bounded, recorded provider retry | TL2-001 (durable orchestration) + TL2-002 (real provider adapters/routing) |
| INV-3 FAIL | cancellation propagation into in-flight/downstream work | TL2-001 (durable orchestration) |
| INV-6 FAIL | concurrent-append integrity (seq uniqueness under interleaved read-modify-write) | TL2-001 (durable orchestration; multi-agent routing) |

## What this baseline does NOT claim

- The battery verifies the CURRENT v0 slice only, at the pinned base, at the
  two implemented rungs. Workbench-level seams (a booted Flauz workbench
  driving the chat participant) stay fixture-only per the session-battery
  precedent - nothing here is a real-workbench E2E claim.
- The stub provider server is the Flauz cloud-sandbox wire contract over a
  real socket, not a real E2B account; real provider behavior is TL2-002.
- The INV-5 row activates only when TL2-004 lands the lease contract; the
  battery will then need the conflict journey written against that contract
  (a work order for the follow-up, never invented by this verifier).
- The runtime rung's real-Chromium behavior is pinned to the FakeCdpTransport
  contract plus the five recorded real-Chromium divergences from the TL3-003
  drill; the agentos battery inherits those drift canaries' posture.
