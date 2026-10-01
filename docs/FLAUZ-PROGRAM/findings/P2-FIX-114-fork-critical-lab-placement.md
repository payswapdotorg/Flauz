# P2-FIX-114 — LAB-001's contract module landed in forbidden fork surface (`src/vs/platform/lab`)

Finding domain: TL-A (productization landing gates) · Found by: A-PROD-002 battery re-run on final main · Status: CLAIMED (TL-A; decision DL-84 recorded BEFORE implementation dispatch)

## Observable gate behavior

The A-PROD-002 final-verification battery re-run on main `a5a454bd5e`
(2026-10-01, the station's resident-watch cycle) reports the compatibility
dimension RED:

- `compat-battery --require` — **1886 PASS · 1 FAIL · 0 SKIP**: the embedded
  fork-critical-guard row fails with

  ```text
  fork-critical-guard FAIL — forbidden src/vs divergence:
  (origin/upstream/main...HEAD)
   src/vs/platform/lab/common/labContracts.ts         | 419 +++++++++
   .../platform/lab/test/common/labContracts.test.ts  | 106 ++++
   2 files changed, 525 insertions(+)
  ```

- `verify-fixtures` — **1 DEVIATION** (230 ok): "compat-battery real repo
  (--require) PASS — exit=1, expected=0" — the same root cause surfaced
  through the fixture-matrix expectation.

The battery family was fully GREEN on the pre-LAB-001 main `680fb00bc8e`
(2026-10-01 morning: compat-battery 1887/1887, verify-fixtures 0 deviations).
The regression arrived with PR #101 (LAB-001, squash `b4768563d82`).

## The violated law

`build/flauz/scripts/fork-critical-guard.sh` (DL-12/DL-10; CORE-CHANGE-BUDGET
§5, MIGRATION-PLAN section 6 gate 1): `src/vs` must stay byte-identical to
upstream except the single additive escape hatch
`src/vs/workbench/contrib/flauz` (F-01 — itself DECISION-LOG-gated).
`src/vs/platform/lab` is in NO sanctioned placement family. The guard's own
banner prescribes the remedy: "Demote the change to an additive path
(extensions/flauz-*, build/flauz/, product.flauz.json) or get a TL adjudicated
DECISION-LOG entry BEFORE merging."

The placement-order law (CORE-CHANGE-BUDGET): additive paths are not
budget-bearing; every line under `src/vs` outside the escape hatch is
fork-critical (upstream merge burden) and CI must fail until a TL adjudicates
or the patch is demoted.

## Evidence + runtime level

`local-real`: the real guard + the real battery + the real fixture matrix on
the real main (`a5a454bd5e`), reproduced twice in the same session; the
pre-regression green baseline (`680fb00bc8e`) is the same morning's
A-PROD-002 pre-verification record.

## Consumer + wiring survey (station, read-only)

- No file on main imports the module: the only reference is the module's own
  test (`src/vs/platform/lab/test/common/labContracts.test.ts`, relative
  import `../../common/labContracts.js` — depth-identical after the demotion
  to `build/flauz/lab/**`, so the import specifier survives the move
  UNCHANGED).
- No CI/workflow wiring references `platform/lab` (`.github/` clean).
- No packaging surface references it (packaging-parity's 9-extension/36-row
  machinery untouched by the module).
- The 9-test suite is station-runnable with the isolated tooling precedent
  (mocha + tsx OUTSIDE the repo, never a repo install): reproduced 9/9
  passing on main BEFORE the demotion.

## The fix (decided — DL-84 in WORK-REGISTRY.md)

The restrict-to-additive demotion: `git mv src/vs/platform/lab
build/flauz/lab` (verbatim relocation, zero content edits), with the guard,
battery, fixture matrix, scoped typecheck and the 9-test suite as the
landing gate. The named demotion alternative and the LAB-009 revisit trigger
are recorded in DL-84.
