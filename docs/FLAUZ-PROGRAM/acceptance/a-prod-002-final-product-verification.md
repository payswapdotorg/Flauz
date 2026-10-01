# A-PROD-002 — Final Independent Product Verification (evidence artifact)

Status: DONE (2026-10-01)  
Owner: TL-A (Product Completion and Productionization)  
Verified main: `d022ec4c91e` (the post-A-PROD-001, post-P2-FIX-114, post-LAB-002-demotion head)  
Verification station: the TL-A resident-watch station (this file is the formal evidence artifact the registry wave records)

## Scope

The full integrated product, re-verified after the inherited tail closed
(A-PROD-001: P2-FIX 7/7 — 102/106/107/109/110/111 landed, 113 closed by the
DL-83 bounded deferral) and after the productization-era findings closed
(P2-FIX-114: the fork-critical demotion, PR #106). Every receipt below was
produced station-side on the named main by the TL-A station
(the P2-002 station-verification precedent shape), with the strongest
honestly-achieved evidence level per dimension — no simulated result is
promoted, and every level is labeled per the evidence law
(`fixture | simulated | local-real | runtime-real | live-provider | production-real`).

## The evidence matrix

| # | Dimension | Receipt | Level | Verdict |
|---|---|---|---|---|
| 1 | End-to-end journey | The 14-leg canonical acceptance journey, `--require` mode, 110 assertions, the station's dedicated Chrome for Testing **153.0.8010.12** (the exact pinned build) as the real CDP endpoint | **runtime-real** | **14/14 legs PASS, 0 fail, 0 skip** |
| 2 | Compatibility | `compat-battery.mjs --require` (1,887 rows incl. the embedded fork-critical-guard vs `origin/upstream/main`) | local-real | **1887/1887 PASS** — the fork-critical surface is pristine (P2-FIX-114's landing, PR #106: 4 pure renames, zero content edits) |
| 3 | Fixture integrity | `verify-fixtures.sh` (231 expectations across the gate matrix) | local-real | **ALL 231 CASES AS EXPECTED (0 deviations)** |
| 4 | Product surface | `verify-product.mjs` | local-real | **CLEAN (31 pass, 0 warn, 0 skip)** |
| 5 | Discovery posture | `p2-003-discovery-gate.mjs --require --strict` | local-real | **23 PASS · 0 KNOWN-GAP · CLEAN** |
| 6 | Packaging/release | `packaging-parity.mjs` | local-real | **CLEAN (9 extensions, 36 rows, 0 drift, 0 violations)** |
| 7 | Activation hygiene | `activation-lint.mjs --root .` | local-real | **GREEN** |
| 8 | Information architecture | `ia-gate.mjs` | local-real | **CLEAN (6 views, 66 command ids)** |
| 9 | Premium UX | `premium-ux-gate.mjs` | local-real | **CLEAN** |
| 10 | Performance budgets | `budget-gate.mjs` | local-real | **GREEN (45 documented skips — the documented-skip posture, no silent skips)** |
| 11 | Security (static) | `security-gate.mjs` | local-real | **GREEN** |
| 12 | Security (runtime) | `security-runtime-gate.mjs` | local-real | **GREEN** |
| 13 | Resources vocabulary (the DL-82 convergence) | flauz-resources suite (116 cases) — the P2-FIX-111 landing record, reproduced on the merged tree that became this main | local-real | **116/116/0/0** |
| 14 | Lab contracts + learner (the demoted LAB-001/LAB-002 modules) | isolated mocha+tsx runner (tooling OUTSIDE the repo), both suites on this main's tree | local-real | **24 passing (9 + 15)** |
| 15 | Live provider (provisioned credentials) | `live-provider-runtime.drill.ts` against the provisioned z.ai OpenAI-compatible endpoint, station-side, credential file at 600, redaction law verified (zero key values in any output) | **live-provider** | See the honest two-receipt record below |

## The live-provider record (dimension 15) — the honest two-receipt state

- **4/4 rows PASS on `393a0fd07c0`** (2026-10-01 morning, the TLA-1B
  pre-verification): routing (routed + exact model echo, glm-4-plus) ·
  auth-failure (typed AUTH_FAILED 401 under the invalidated real credential
  carriers) · retry (bounded-typed-exhaustion, 3×TIMEOUT) · provenance
  (responseId + requestHash + usage + modelEcho captured, redaction swept).
- **On the final main: 4/4 PASS live (completed).** The first re-run
  attempt series (five spaced retries across ~90 minutes) hit
  **429 RATE_LIMITED on the provenance row** — the known environmental
  burst class, typed retryable by the drill itself (no product defect; the
  TLA-1B runbook note predicted exactly this class; routing · auth-failure
  · retry were PASS live throughout). The quota window then cleared and
  the re-run on `3fb0c4fd22` (the evidence-artifact head;
  `extensions/flauz-models/**` unchanged from `d022ec4c91e` — the interim
  commit touched docs only) returned **routing PASS · auth-failure PASS ·
  retry PASS · provenance PASS** — responseId + requestHash + usage +
  modelEcho captured, redaction swept. The morning's 4/4 on
  `393a0fd07c0` and this 4/4 close the ring on both mains; the interim
  429 series stays recorded here as the honest environmental incident
  trail, never a wording-promoted PASS.

## Environment + operational notes (the honest incident record)

- The journey's first two runs failed leg 06 in 12 ms (browser session not
  ACTIVE, zero wire commands) — root cause: the dedicated CFT instance had
  been **reaped at the tool-call boundary** (the station's process-launch
  lesson: anything that must survive a call boundary launches via the
  double-fork mechanism; `setsid`/`nohup` do not escape it). The re-launch
  via the survivor mechanism produced the fully-green journey. Same class
  as the morning OOM lesson: verify the browser is ALIVE before diagnosing
  the product.
- The battery family ran clean on the first attempt on this main except the
  fork-critical row — which was the **P2-FIX-114 finding** (TL-B's LAB-001
  had landed 525 lines under `src/vs/platform/lab/`), registered,
  adjudicated (DL-84), implemented through the worker lane, cross-landed
  over the racing LAB-002 wave, and closed (PR #106/#107). The receipts in
  row 2/3 above are the post-114 state.
- The A-PROD-001-to-002 sequence was re-verified in one station cycle:
  tail closure (111) → battery re-run → finding (114) → decision (DL-84) →
  implementation → landing → the green matrix above.

## Verdict

**A-PROD-002 is complete with production-grade evidence at the strongest
honestly-achieved level per dimension** — runtime-real for the end-to-end
journey (the browser/environment/resource legs on real Chromium), local-real
for the gate/battery family, live-provider for the provisioned-credential
rung (4/4 pre-verified + 4/4 re-verified live on the final main — the
interim 429 series recorded honestly above). No simulated result is
promoted anywhere in this artifact. The program's next phase is A-PROD-003
(dogfooding), which turns real-work friction into registered findings.
