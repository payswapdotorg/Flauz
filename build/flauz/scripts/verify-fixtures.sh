#!/bin/sh
# ---------------------------------------------------------------------------------------------
# Flauz Wave 3 — Lane H. verify-fixtures.sh — the in-sandbox verification matrix.
#
# Runs every harness script against every fixture and asserts the EXPECTED
# outcome (pass OR fail — a gate that cannot fail is not a gate). Zero-dep:
# POSIX sh + node >= 20. Runnable anywhere the repo is checked out; used by
# the Wave-3 delivery receipts (see flauz-delivery/h-perf-ci/REPORT.md) and
# available to CI as a self-test of the harness itself.
#
# Usage:
#   sh build/flauz/scripts/verify-fixtures.sh            # from the repo root
#   sh build/flauz/scripts/verify-fixtures.sh --quiet    # failures-only output
#
# Exit codes: 0 = every case produced its expected outcome · 1 = at least one
# case deviated (harness bug or fixture rot) · 2 = usage/environment error.
# ---------------------------------------------------------------------------------------------

set -u

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
[ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] && {
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
}

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
S="$ROOT/build/flauz/scripts"
F="$ROOT/test/fixtures"

command -v node >/dev/null 2>&1 || { echo "verify-fixtures: node not found (need >= 20)"; exit 2; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "verify-fixtures: node >= 20 required (found $(node --version))"; exit 2; }

PASS=0
FAIL=0
FAILED_CASES=""

# expect <label> <expected-exit> <cmd...>
expect() {
    label="$1"; want="$2"; shift 2
    "$@" >/dev/null 2>&1
    got=$?
    if [ "$got" -eq "$want" ]; then
        PASS=$((PASS + 1))
        [ "$QUIET" -eq 0 ] && printf '  ok    %-52s exit=%s (expected)\n' "$label" "$got"
    else
        FAIL=$((FAIL + 1))
        FAILED_CASES="$FAILED_CASES
  DEVIATED  $label — exit=$got, expected=$want"
        printf '  DEVIATED  %-52s exit=%s (expected %s)\n' "$label" "$got" "$want" >&2
    fi
}

echo "verify-fixtures: node $(node --version), repo root $ROOT"

# ---- shared parser selftest ----
expect "perf-log-parse --selftest"                     0 node "$S/perf-log-parse.mjs" --selftest

# ---- startup-pair: section 1.3 gates ----
expect "startup-pair timers PASS"                      0 node "$S/startup-pair.mjs" --timers-flauz "$F/perf-timers/flauz-main.timers.tsv" --timers-upstream "$F/perf-timers/upstream-main.timers.tsv"
expect "startup-pair markers PASS"                     0 node "$S/startup-pair.mjs" --markers-flauz "$F/perf-timers/flauz-main.markers.tsv" --markers-upstream "$F/perf-timers/upstream-main.markers.tsv"
expect "startup-pair regressed FAIL"                   1 node "$S/startup-pair.mjs" --timers-flauz "$F/perf-timers/flauz-main.regressed.timers.tsv" --timers-upstream "$F/perf-timers/upstream-main.timers.tsv" --markers-flauz "$F/perf-timers/flauz-main.markers.regressed.tsv" --markers-upstream "$F/perf-timers/upstream-main.markers.tsv"
expect "startup-pair too-few-runs FAIL"                1 node "$S/startup-pair.mjs" --timers-flauz "$F/perf-timers/flauz-main.too-few.timers.tsv" --timers-upstream "$F/perf-timers/upstream-main.timers.tsv"

# ---- startup-pair: R6 mark integrity + section 1.3 row 4 phase gate ----
expect "check-marks src-ok PASS"                       0 node "$S/startup-pair.mjs" --check-marks --src-root "$F/marks/src-ok"
expect "check-marks src-missing FAIL"                  1 node "$S/startup-pair.mjs" --check-marks --src-root "$F/marks/src-missing"
expect "check-marks no-sources SKIP"                   0 node "$S/startup-pair.mjs" --check-marks --src-root "$F/perf-timers"
expect "phase-gate src-ok PASS"                        0 node "$S/startup-pair.mjs" --phase-gate --src-root "$F/marks/src-ok"
expect "phase-gate src-phase-bad FAIL"                 1 node "$S/startup-pair.mjs" --phase-gate --src-root "$F/marks/src-phase-bad"
expect "phase-gate no-sources SKIP"                    0 node "$S/startup-pair.mjs" --phase-gate --src-root "$F/perf-timers"

# ---- memory-snapshot: section 3.2 gates, all three capture paths ----
expect "memory eventually (json) PASS"                 0 node "$S/memory-snapshot.mjs" --json "$F/process-shape/eventually.json" --scenario eventually
expect "memory after-session (json) PASS"              0 node "$S/memory-snapshot.mjs" --json "$F/process-shape/after-session.json" --scenario after-session
expect "memory violations (json) FAIL"                 1 node "$S/memory-snapshot.mjs" --json "$F/process-shape/after-session.violations.json" --scenario after-session
expect "memory violations --enforce (R1) FAIL"         1 node "$S/memory-snapshot.mjs" --json "$F/process-shape/after-session.violations.json" --scenario after-session --enforce
expect "memory eventually (status text) PASS"          0 node "$S/memory-snapshot.mjs" --status "$F/process-shape/eventually.status.txt" --scenario eventually
expect "memory eventually (ps text) PASS"              0 node "$S/memory-snapshot.mjs" --ps "$F/process-shape/eventually.ps.txt" --scenario eventually

# ---- activation-lint: section 2.1/section 2.2 rules ----
expect "activation-lint good set PASS"                 0 node "$S/activation-lint.mjs" --root "$F/manifests/good" --manifests-glob "flauz-*/package.json" --require-manifests
expect "activation-lint bad dir FAIL (R1-R8)"          1 node "$S/activation-lint.mjs" --root "$F/manifests/bad" --manifests-glob "*.json"
expect "activation-lint bad-set FAIL (R3 only)"        1 node "$S/activation-lint.mjs" --root "$F/manifests/bad-set" --manifests-glob "*.json"
expect "activation-lint empty dir SKIP"                0 node "$S/activation-lint.mjs" --root "$F/perf-timers" --manifests-glob "flauz-*/package.json"
expect "activation-lint empty dir --require FAIL"      1 node "$S/activation-lint.mjs" --root "$F/perf-timers" --manifests-glob "flauz-*/package.json" --require-manifests

# ---- proposed-api-rota: DL-4 churn gate ----
expect "rota clean fixture PASS"                       0 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/clean"
expect "rota dirty fixture FAIL (absent+mismatch)"     1 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty"
expect "rota dirty + baseline FAIL (deltas)"           1 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty" --baseline "$F/rota/baseline-snapshot.json"
expect "rota dirty --no-fail (informational)"          0 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty" --no-fail
expect "rota real mirror (no lanes) SKIP"              0 node "$S/proposed-api-rota.mjs" --repo-root "$ROOT"

# ---- fork-critical guard ----
if git -C "$ROOT" rev-parse --verify --quiet upstream/main >/dev/null 2>&1; then
    expect "fork-critical guard on this branch PASS"   0 sh "$S/fork-critical-guard.sh" --repo "$ROOT" --base upstream/main --head HEAD
else
    echo "  note  fork-critical guard refs test needs local 'upstream/main' — skipped here"
fi
expect "fork-critical guard usage error (no base)"     2 sh "$S/fork-critical-guard.sh" --repo "$F/rota/clean" --base does-not-exist --head HEAD

# ---- verdict ----
echo "----------------------------------------------------------------"
if [ "$FAIL" -eq 0 ]; then
    echo "verify-fixtures: ALL $PASS CASES AS EXPECTED (0 deviations)"
    exit 0
else
    echo "verify-fixtures: $FAIL DEVIATION(S), $PASS ok"
    echo "$FAILED_CASES"
    exit 1
fi
