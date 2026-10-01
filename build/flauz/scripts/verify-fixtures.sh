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

# ---- TL4-H1: FLAUZ_PERF_MARKS_FILE mark-tap parsing + tap consumption ----
expect "perf-log-parse tap PASS"                        0 node "$S/perf-log-parse.mjs" --parse-tap "$F/perf-timers/flauz-main.marks.tap"
expect "startup-pair tap+markers PASS"                 0 node "$S/startup-pair.mjs" --markers-flauz "$F/perf-timers/flauz-main.markers.tsv" --markers-upstream "$F/perf-timers/upstream-main.markers.tsv" --tap-flauz "$F/perf-timers/flauz-main.marks.tap"
expect "startup-pair tap-only PASS"                    0 node "$S/startup-pair.mjs" --tap-flauz "$F/perf-timers/flauz-main.marks.tap"
expect "startup-pair tap doctored FAIL (bridge>300)"   1 node "$S/startup-pair.mjs" --tap-flauz "$F/perf-timers/flauz-main.marks.doctored.tap"
expect "startup-pair tap usage (missing flag value)"   2 node "$S/startup-pair.mjs" --tap-flauz

# ---- startup-pair: R6 mark integrity + section 1.3 row 4 phase gate ----
# empty tap dir: the tap was requested but never fired (R6 drift class)
TAP_EMPTY="$(mktemp -d 2>/dev/null || echo "/tmp/flauz-tap-empty-$$")"
mkdir -p "$TAP_EMPTY"
expect "startup-pair empty-tap-dir FAIL (R6)"           1 node "$S/startup-pair.mjs" --tap-flauz "$TAP_EMPTY"
rm -rf "$TAP_EMPTY"

# ---- TL4-H1 runtime drills: machinery selftests + SKIP law (plain-script
# drills live under extensions/*/test/canaries/ and are NOT part of npm test;
# the matrix pins their selftests and the exit-0 SKIP contract) ----
expect "drill model-switch selftest"                    0 node --experimental-strip-types extensions/flauz-models/test/canaries/model-switch-runtime.drill.ts --selftest
expect "drill multi-agent selftest"                     0 node --experimental-strip-types extensions/flauz-agent/test/canaries/multi-agent-runtime.drill.ts --selftest
expect "drill browser selftest"                         0 node --experimental-strip-types extensions/flauz-browser/test/canaries/browser-launch-runtime.drill.ts --selftest
expect "drill browser SKIP (no endpoint)"              0 node --experimental-strip-types extensions/flauz-browser/test/canaries/browser-launch-runtime.drill.ts
expect "drill model-switch SKIP (forced)"              0 env FLAUZ_MODEL_SWITCH_RUNTIME_SKIP=1 node --experimental-strip-types extensions/flauz-models/test/canaries/model-switch-runtime.drill.ts
expect "drill multi-agent SKIP (forced)"               0 env FLAUZ_MULTIAGENT_RUNTIME_SKIP=1 node --experimental-strip-types extensions/flauz-agent/test/canaries/multi-agent-runtime.drill.ts

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

# ---- ia-gate: TL4-001 Flauz shell manifest discipline ----
expect "ia-gate clean fixture PASS"                    0 node "$S/ia-gate.mjs" --root "$F/ia-gate/clean" --require
expect "ia-gate real tree PASS"                        0 node "$S/ia-gate.mjs" --root "$ROOT"
expect "ia-gate duplicate container FAIL"              1 node "$S/ia-gate.mjs" --root "$F/ia-gate/fail-duplicate-container" --require
expect "ia-gate missing welcome FAIL"                  1 node "$S/ia-gate.mjs" --root "$F/ia-gate/fail-missing-welcome" --require
expect "ia-gate startup activation FAIL"               1 node "$S/ia-gate.mjs" --root "$F/ia-gate/fail-startup-activation" --require
expect "ia-gate empty dir SKIP"                        0 node "$S/ia-gate.mjs" --root "$F/perf-timers"
expect "ia-gate empty dir --require FAIL"              1 node "$S/ia-gate.mjs" --root "$F/perf-timers" --require
expect "ia-gate usage error (bad flag)"                2 node "$S/ia-gate.mjs" --definitely-not-a-flag

# ---- premium-ux-gate: TL4-002 Flauz premium UX discipline ----
expect "premium-ux-gate clean fixture PASS"            0 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/clean" --require
expect "premium-ux-gate real tree PASS"                0 node "$S/premium-ux-gate.mjs" --root "$ROOT" --require
expect "premium-ux-gate no-retry FAIL"                 1 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/fail-no-retry" --require
expect "premium-ux-gate no-welcome FAIL"               1 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/fail-no-welcome" --require
expect "premium-ux-gate webview FAIL"                  1 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/fail-webview" --require
expect "premium-ux-gate title-case FAIL"               1 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/fail-title-case" --require
expect "premium-ux-gate date-drift FAIL"               1 node "$S/premium-ux-gate.mjs" --root "$F/premium-ux-gate/fail-date-drift" --require
expect "premium-ux-gate empty dir SKIP"                0 node "$S/premium-ux-gate.mjs" --root "$F/perf-timers"
expect "premium-ux-gate empty dir --require FAIL"      1 node "$S/premium-ux-gate.mjs" --root "$F/perf-timers" --require
expect "premium-ux-gate usage error (bad flag)"        2 node "$S/premium-ux-gate.mjs" --definitely-not-a-flag
expect "premium-ux-gate --help"                        0 node "$S/premium-ux-gate.mjs" --help

# ---- p2-003-discovery-gate: TL4/P2-003 user discovery audit ----
D="$ROOT/build/flauz/discovery/p2-003-discovery-gate.mjs"
expect "discovery-gate clean fixture PASS"            0 node "$D" --root "$F/discovery-gate/clean" --require
expect "discovery-gate real tree PASS (known gaps pinned)" 0 node "$D" --root "$ROOT" --require
expect "discovery-gate real tree --strict PASS (post-closure enforcement)" 0 node "$D" --root "$ROOT" --require --strict
expect "discovery-gate missing view FAIL"              1 node "$D" --root "$F/discovery-gate/fail-missing-view" --require
expect "discovery-gate welcome no-link FAIL"          1 node "$D" --root "$F/discovery-gate/fail-welcome-link" --require
expect "discovery-gate error-grammar FAIL"            1 node "$D" --root "$F/discovery-gate/fail-error-grammar" --require
expect "discovery-gate a11y-labels FAIL"              1 node "$D" --root "$F/discovery-gate/fail-a11y" --require
expect "discovery-gate empty dir SKIP"                0 node "$D" --root "$F/perf-timers"
expect "discovery-gate empty dir --require FAIL"      1 node "$D" --root "$F/perf-timers" --require
expect "discovery-gate usage error (bad flag)"        2 node "$D" --definitely-not-a-flag
expect "discovery-gate --help"                        0 node "$D" --help

# ---- proposed-api-rota: DL-4 churn gate ----
expect "rota clean fixture PASS"                       0 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/clean"
expect "rota dirty fixture FAIL (absent+mismatch)"     1 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty"
expect "rota dirty + baseline FAIL (deltas)"           1 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty" --baseline "$F/rota/baseline-snapshot.json"
expect "rota dirty --no-fail (informational)"          0 node "$S/proposed-api-rota.mjs" --repo-root "$F/rota/dirty" --no-fail
expect "rota real mirror (no lanes) SKIP"              0 node "$S/proposed-api-rota.mjs" --repo-root "$ROOT"

# ---- budget-gate: TL4-005 unified budget gate ----
BG="$S/budget-gate.mjs"
BGF="$F/budget-gate"
expect "budget-gate clean fixture PASS"                0 node "$BG" --budgets "$BGF/budgets-clean.json" --measurements "$BGF/measurements-clean.jsonl"
expect "budget-gate over-budget FAIL"                  1 node "$BG" --budgets "$BGF/budgets-over.json" --measurements "$BGF/measurements-clean.jsonl"
expect "budget-gate skip case (no --require)"          0 node "$BG" --budgets "$BGF/budgets-with-pending.json" --measurements "$BGF/measurements-missing.jsonl"
expect "budget-gate skip case (--require)"             1 node "$BG" --budgets "$BGF/budgets-with-pending.json" --measurements "$BGF/measurements-missing.jsonl" --require
expect "budget-gate skip case (--require enforced-ci)" 0 node "$BG" --budgets "$BGF/budgets-with-pending.json" --measurements "$BGF/measurements-missing.jsonl" --require enforced-ci
expect "budget-gate malformed budgets"                 2 node "$BG" --budgets "$BGF/malformed-budgets.json" --measurements "$BGF/measurements-clean.jsonl"
expect "budget-gate warn-severity over (exit 0)"       0 node "$BG" --budgets "$BGF/budgets-warn.json" --measurements "$BGF/measurements-clean.jsonl"
expect "budget-gate unknown measurement id WARN"       0 node "$BG" --budgets "$BGF/budgets-clean.json" --measurements "$BGF/measurements-unknown-id.jsonl"
expect "budget-gate unit mismatch SKIP+WARN"           0 node "$BG" --budgets "$BGF/budgets-clean.json" --measurements "$BGF/measurements-unit-mismatch.jsonl"
expect "budget-gate usage error (unknown flag)"         2 node "$BG" --bogus
expect "budget-gate --help"                            0 node "$BG" --help
expect "budget-gate registry self-check (no input)"    0 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json"

# ---- TL4-H1: runtime-measured rows over drill-shaped record fixtures ----
expect "budget-gate runtime records PASS"              0 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$BGF/runtime-records.jsonl" --require runtime-measured
expect "budget-gate runtime records doctored FAIL"     1 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$BGF/runtime-records-doctored.jsonl"
expect "budget-gate runtime rows require flip FAIL"    1 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$BGF/measurements-missing.jsonl" --require runtime-measured

# real-data input plumbing: map the perf fixtures through perf-log-parse (the
# single source of truth for perf-log parsing) into a CURATED temp dir, then run
# the unified gate over it with --require enforced-ci — proves every enforced-ci
# registry row is measured by the mapped repo data and green (TL4-005 D5a).
BGIN="$(mktemp -d 2>/dev/null || echo "/tmp/flauz-bg-$$")"
BGINV="$(mktemp -d 2>/dev/null || echo "/tmp/flauz-bgv-$$")"
mkdir -p "$BGIN" "$BGINV"
if (
    set -e
    node "$S/perf-log-parse.mjs" --parse-timers     "$F/perf-timers/flauz-main.timers.tsv"   > "$BGIN/flauz.timers.json"
    node "$S/perf-log-parse.mjs" --parse-timers     "$F/perf-timers/upstream-main.timers.tsv" > "$BGIN/upstream.timers.json"
    node "$S/perf-log-parse.mjs" --parse-markers    "$F/perf-timers/flauz-main.markers.tsv"   > "$BGIN/flauz.markers.json"
    node "$S/perf-log-parse.mjs" --parse-markers    "$F/perf-timers/upstream-main.markers.tsv" > "$BGIN/upstream.markers.json"
    node "$S/perf-log-parse.mjs" --parse-tap       "$F/perf-timers/flauz-main.marks.tap"       > "$BGIN/flauz.marks-tap.json"
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/eventually.json"      > "$BGIN/eventually.process.json"
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/after-session.json"   > "$BGIN/after-session.process.json"
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/after-session.violations.json" > "$BGINV/after-session.process.json"
); then
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && printf '  ok    %-52s mapped 8 inputs\n' "budget-gate input mapping (perf-log-parse)"
else
    FAIL=$((FAIL + 1))
    printf '  DEVIATED  %-52s mapping failed\n' "budget-gate input mapping (perf-log-parse)" >&2
fi
expect "budget-gate perf-fixture plumbing PASS"        0 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$BGIN" --require enforced-ci
expect "budget-gate violations fixture FAIL"           1 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$BGINV"
expect "budget-gate ps-text input rejected"            2 node "$BG" --budgets "$ROOT/build/flauz/budgets/flauz-budgets.json" --measurements "$F/process-shape/eventually.ps.txt"
rm -rf "$BGIN" "$BGINV"

# ---- sync-upstream: TL1-001 report/plan gates ----
# The fixtures are tiny git repos BUILT AT RUNTIME in a temp dir (never a
# committed .git); content assertions live in sync-upstream.test.mjs, this
# matrix pins the exit-code contract (same shape as the budget-gate mapping
# case above). base ref = the local 'upstream/main' branch parked at the
# shared base commit.
SU="$S/sync-upstream.mjs"
SUT="$(mktemp -d 2>/dev/null || echo "/tmp/flauz-su-$$")"
if (
    set -e
    git -C "$SUT" init -q -b main
    git -C "$SUT" config user.email fixture@example.invalid
    git -C "$SUT" config user.name "Flauz Fixture"
    printf 'upstream readme\n' > "$SUT/README.md"
    printf 'base content\n' > "$SUT/shared.txt"
    mkdir -p "$SUT/src/vs/base/common" "$SUT/extensions/git"
    printf 'upstream core\n' > "$SUT/src/vs/base/common/core.txt"
    printf '{ "name": "git" }\n' > "$SUT/extensions/git/package.json"
    git -C "$SUT" add -A && git -C "$SUT" commit -qm "base"
    git -C "$SUT" branch upstream/main
    # product line: one additive (clean) commit, then one shared-file commit
    mkdir -p "$SUT/build/flauz"
    printf '// flauz gate\n' > "$SUT/build/flauz/gate.mjs"
    git -C "$SUT" add -A && git -C "$SUT" commit -qm "flauz additive"
    git -C "$SUT" tag clean-head
    printf 'product-modified readme\n' > "$SUT/README.md"
    printf 'flauz side\n' > "$SUT/shared.txt"
    git -C "$SUT" add -A && git -C "$SUT" commit -qm "shared-file mod"
    git -C "$SUT" tag dirty-head
); then
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && printf '  ok    %-52s built base+product fixture repo\n' "sync-upstream fixture repo (temp)"
else
    FAIL=$((FAIL + 1))
    printf '  DEVIATED  %-52s fixture build failed\n' "sync-upstream fixture repo (temp)" >&2
fi
# report cases: reference line still parked at the shared base (the "clean"
# census is only clean while there is nothing unabsorbed to report)
expect "sync-upstream clean additive PASS"             0 node "$SU" --report --repo "$SUT" --base upstream/main --head clean-head
expect "sync-upstream shared-file mod FAIL"            1 node "$SU" --report --repo "$SUT" --base upstream/main --head dirty-head
expect "sync-upstream shared-file mod --no-fail"       0 node "$SU" --report --repo "$SUT" --base upstream/main --head dirty-head --no-fail
if (
    set -e
    # reference line moves for the --plan conflict case
    git -C "$SUT" checkout -q upstream/main
    printf 'upstream side\n' > "$SUT/shared.txt"
    git -C "$SUT" add -A && git -C "$SUT" commit -qm "upstream moves"
    git -C "$SUT" checkout -q main
); then
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && printf '  ok    %-52s reference line advanced\n' "sync-upstream fixture repo (temp)"
else
    FAIL=$((FAIL + 1))
    printf '  DEVIATED  %-52s upstream move failed\n' "sync-upstream fixture repo (temp)" >&2
fi
expect "sync-upstream plan conflict (data) PASS"      0 node "$SU" --plan --repo "$SUT" --target upstream/main --head dirty-head
expect "sync-upstream plan clean PASS"                 0 node "$SU" --plan --repo "$SUT" --target upstream/main --head clean-head
expect "sync-upstream usage error (bad flag)"          2 node "$SU" --bogus
expect "sync-upstream usage error (no mode)"           2 node "$SU"
expect "sync-upstream --help"                          0 node "$SU" --help
rm -rf "$SUT"

# ---- packaging-parity: TL1-005 web/desktop parity gate ----
# Committed fixture family under test/fixtures/packaging-parity/ (modeled on
# the premium-ux-gate family): clean/, drifted/ (one dir per drift kind),
# empty/. Content-level assertions live in packaging-parity.test.mjs; this
# matrix pins the exit-code contract.
PP="$F/packaging-parity"
expect "packaging-parity clean fixture PASS"          0 node "$S/packaging-parity.mjs" --root "$PP/clean" --require
expect "packaging-parity real tree PASS"              0 node "$S/packaging-parity.mjs" --root "$ROOT" --require
expect "packaging-parity key-value drift FAIL"        1 node "$S/packaging-parity.mjs" --root "$PP/drifted/key-value"
expect "packaging-parity browser-added drift FAIL"    1 node "$S/packaging-parity.mjs" --root "$PP/drifted/browser-added"
expect "packaging-parity import-removed drift FAIL"   1 node "$S/packaging-parity.mjs" --root "$PP/drifted/import-removed"
expect "packaging-parity node-free-broken FAIL"       1 node "$S/packaging-parity.mjs" --root "$PP/drifted/node-free-broken"
expect "packaging-parity class-mismatch FAIL"         1 node "$S/packaging-parity.mjs" --root "$PP/drifted/class-mismatch"
expect "packaging-parity posture-mismatch FAIL"       1 node "$S/packaging-parity.mjs" --root "$PP/drifted/posture-mismatch"
expect "packaging-parity coverage-gap FAIL"           1 node "$S/packaging-parity.mjs" --root "$PP/drifted/coverage-gap"
expect "packaging-parity surface-vanished FAIL"       1 node "$S/packaging-parity.mjs" --root "$PP/drifted/surface-vanished"
expect "packaging-parity malformed-row FAIL"          1 node "$S/packaging-parity.mjs" --root "$PP/drifted/malformed-row"
expect "packaging-parity packaged-asset-missing FAIL" 1 node "$S/packaging-parity.mjs" --root "$PP/drifted/packaged-asset-missing"
expect "packaging-parity --no-fail reports only"      0 node "$S/packaging-parity.mjs" --root "$PP/drifted/key-value" --no-fail
expect "packaging-parity empty dir SKIP"              0 node "$S/packaging-parity.mjs" --root "$PP/empty"
expect "packaging-parity empty dir --require FAIL"    1 node "$S/packaging-parity.mjs" --root "$PP/empty" --require
expect "packaging-parity usage error (bad flag)"      2 node "$S/packaging-parity.mjs" --definitely-not-a-flag
expect "packaging-parity --help"                      0 node "$S/packaging-parity.mjs" --help

# ---- fork-critical guard ----
if git -C "$ROOT" rev-parse --verify --quiet upstream/main >/dev/null 2>&1; then
    expect "fork-critical guard on this branch PASS"   0 sh "$S/fork-critical-guard.sh" --repo "$ROOT" --base upstream/main --head HEAD
else
    echo "  note  fork-critical guard refs test needs local 'upstream/main' — skipped here"
fi
expect "fork-critical guard usage error (no base)"     2 sh "$S/fork-critical-guard.sh" --repo "$F/rota/clean" --base does-not-exist --head HEAD

# ---- compat-battery: TL4-003 L1+L2 contribution-surface diff (fixture matrix) ----
# Tree-mode sides (upstream/ + product/ dirs); L1 SKIPs in tree mode by design
# (no git history) — the fail cases below prove every L2 rule can fire.
CB="$F/compat-battery"
expect "compat-battery clean-additive PASS"            0 node "$S/compat-battery.mjs" --upstream "$CB/clean-additive/upstream" --product "$CB/clean-additive/product"
expect "compat-battery removed-command FAIL"           1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-command/upstream" --product "$CB/fail-removed-command/product"
expect "compat-battery removed-config FAIL"            1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-config/upstream" --product "$CB/fail-removed-config/product"
expect "compat-battery removed-keybinding FAIL"        1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-keybinding/upstream" --product "$CB/fail-removed-keybinding/product"
expect "compat-battery removed-menu FAIL"              1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-menu/upstream" --product "$CB/fail-removed-menu/product"
expect "compat-battery removed-submenu FAIL"           1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-submenu/upstream" --product "$CB/fail-removed-submenu/product"
expect "compat-battery retyped-view FAIL"              1 node "$S/compat-battery.mjs" --upstream "$CB/fail-retyped-view/upstream" --product "$CB/fail-retyped-view/product"
expect "compat-battery removed-viewscontainer FAIL"    1 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-viewscontainer/upstream" --product "$CB/fail-removed-viewscontainer/product"
expect "compat-battery deleted-extension FAIL"         1 node "$S/compat-battery.mjs" --upstream "$CB/fail-deleted-extension/upstream" --product "$CB/fail-deleted-extension/product"
expect "compat-battery product-identity FAIL"          1 node "$S/compat-battery.mjs" --upstream "$CB/fail-product-identity/upstream" --product "$CB/fail-product-identity/product"
expect "compat-battery root-script-removed FAIL"       1 node "$S/compat-battery.mjs" --upstream "$CB/fail-root-script-removed/upstream" --product "$CB/fail-root-script-removed/product"
expect "compat-battery non-flauz-addition FAIL"        1 node "$S/compat-battery.mjs" --upstream "$CB/fail-non-flauz-addition/upstream" --product "$CB/fail-non-flauz-addition/product"
expect "compat-battery flauz-vanished FAIL (pos-ctl)"  1 node "$S/compat-battery.mjs" --upstream "$CB/flauz-vanished/upstream" --product "$CB/flauz-vanished/product"
expect "compat-battery allowlist suppression PASS"     0 node "$S/compat-battery.mjs" --upstream "$CB/allowlist-case/upstream" --product "$CB/allowlist-case/product" --allowlist "$CB/allowlist-case/allowlist.json"
expect "compat-battery allowlist-case sans list FAIL"  1 node "$S/compat-battery.mjs" --upstream "$CB/allowlist-case/upstream" --product "$CB/allowlist-case/product"
expect "compat-battery --require flips tree SKIP FAIL" 1 node "$S/compat-battery.mjs" --upstream "$CB/clean-additive/upstream" --product "$CB/clean-additive/product" --require
expect "compat-battery --no-fail reports only"         0 node "$S/compat-battery.mjs" --upstream "$CB/fail-removed-command/upstream" --product "$CB/fail-removed-command/product" --no-fail
expect "compat-battery usage error (bad spec)"         2 node "$S/compat-battery.mjs" --upstream "$F/does-not-exist-anywhere"

# ---- compat-battery: the real mirror (origin/upstream/main vs HEAD, --require) ----
if git -C "$ROOT" rev-parse --verify --quiet origin/upstream/main >/dev/null 2>&1; then
    expect "compat-battery real repo (--require) PASS" 0 node "$S/compat-battery.mjs" --root "$ROOT" --require
else
    echo "  note  compat-battery real-repo case needs local 'origin/upstream/main' — skipped here"
fi

# ---- compat-l3-smoke (TL4-008): the L3 runtime boot smoke driver ----
# Driver logic pinned against the fixture matrix (synthetic log corpora +
# fake compiled trees - a workbench is never booted in a sandbox). The
# settle timeouts are tiny because fixture markers are already on disk
# (the CI lane passes the generous defaults).
CL3="$F/compat-l3"
expect "compat-l3 clean logs+compile PASS"             0 node "$S/compat-l3-smoke.mjs" --log "$CL3/logs-clean/boot.log" --log-dir "$CL3/logs-clean/userdata-logs" --compile-root "$CL3/fake-out" --settle-timeout 300
expect "compat-l3 no-logs SKIP census PASS"            0 node "$S/compat-l3-smoke.mjs" --compile-root "$CL3/fake-out"
expect "compat-l3 fatal log FAIL"                      1 node "$S/compat-l3-smoke.mjs" --log "$CL3/logs-fatal/boot.log" --settle-timeout 300
expect "compat-l3 no-ext-marker FAIL"                  1 node "$S/compat-l3-smoke.mjs" --log "$CL3/logs-no-ext/boot.log" --settle-timeout 300
expect "compat-l3 flauz-vanished FAIL (pos-ctl)"       1 node "$S/compat-l3-smoke.mjs" --log "$CL3/logs-no-flauz/boot.log" --settle-timeout 300
expect "compat-l3 missing pillar FAIL"                 1 node "$S/compat-l3-smoke.mjs" --compile-root "$CL3/fake-out-missing"
expect "compat-l3 absent compile-root FAIL"            1 node "$S/compat-l3-smoke.mjs" --compile-root "$CL3/no-out"
expect "compat-l3 --no-fail reports only"              0 node "$S/compat-l3-smoke.mjs" --log "$CL3/logs-fatal/boot.log" --no-fail --settle-timeout 300
expect "compat-l3 --require sans channel FAIL (usage)" 2 node "$S/compat-l3-smoke.mjs" --require --log "$CL3/logs-clean/boot.log"
expect "compat-l3 usage error (bad flag)"              2 node "$S/compat-l3-smoke.mjs" --definitely-not-a-flag
expect "compat-l3 --help"                              0 node "$S/compat-l3-smoke.mjs" --help
expect "compat-l3 node --test suite"                   0 node --test "$ROOT/build/flauz/compat-l3-smoke.test.mjs"

# ---- session-battery (TL4-004): whole-session acceptance gate ----
# The battery runner needs node >= 22.6 (type stripping). On older nodes the
# gate SKIPs (exit 0) -- the run/failability cases only apply where the
# runner can actually run; the flauz-session CI lane pins node 22 and runs
# the full matrix. The --list/usage cases are runner-independent.
NODE_MAJOR_SB="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR_SB="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR_SB" -gt 22 ] || { [ "$NODE_MAJOR_SB" -eq 22 ] && [ "$NODE_MINOR_SB" -ge 6 ]; }; then
    expect "session-battery golden PASS"                0 node "$S/session-battery.mjs" --root "$ROOT"
    expect "session-battery doctored fixture FAIL"      1 node "$S/session-battery.mjs" --root "$ROOT" --fixtures "$F/session-battery-doctored"
    # ---- TL4-007: the runtime-rung zero-dep cases (NO Chromium needed).
    # The FULL runtime rung (J1-J4 over real CDP + LocalProcessExecutor)
    # needs a real headless Chromium via FLAUZ_CDP_ENDPOINT -- that lane
    # lives in the flauz-session CI job `session-runtime`, never here. What
    # IS runnable zero-dep: the drill's normalization/compare machinery
    # selftest, the pinned-artifact normalization-discipline check (both
    # directions), and the gate's --runtime SKIP semantics (both modes). ----
    RUNTIME_DRILL="$ROOT/extensions/flauz-workflow/test/canaries/session-battery-runtime.drill.ts"
    expect "session-battery runtime selftest PASS"      0 node --experimental-strip-types "$RUNTIME_DRILL" --selftest
    expect "session-battery runtime transcript clean PASS"  0 node --experimental-strip-types "$RUNTIME_DRILL" --check-transcript "$F/session-battery-runtime/golden-runtime.json"
    expect "session-battery runtime transcript doctored FAIL"  1 node --experimental-strip-types "$RUNTIME_DRILL" --check-transcript "$F/session-battery-runtime-doctored/golden-runtime.json"
    expect "session-battery --runtime no-endpoint SKIP"  0 env FLAUZ_CDP_ENDPOINT= node "$S/session-battery.mjs" --runtime
    expect "session-battery --runtime --require no-endpoint FAIL"  1 env FLAUZ_CDP_ENDPOINT= node "$S/session-battery.mjs" --runtime --require
    # ---- TL4-H2: the workspace live-events/reveal runtime drill. Unlike the
    # session-battery runtime rung the drill is SELF-CONTAINED (temp
    # workspace + REAL fs.watch; no Chromium, no endpoint), so the full
    # runtime rung IS runnable zero-dep here. Cases: the machinery selftest
    # (its matcher/coalescing reject directions are the doctored cases), the
    # REAL RUN (GREEN, or the documented honest SKIP on sandboxes without
    # real fs events -- the CI lane asserts GREEN strictly), the forced-SKIP
    # semantics, and the usage contract. ----
    LIVE_DRILL="$ROOT/extensions/flauz-workspace/test/canaries/live-events-runtime.drill.ts"
    LIVE_LOG="$(mktemp 2>/dev/null || echo "/tmp/flauz-live-events-$$")"
    expect "live-events runtime selftest PASS"        0 node --experimental-strip-types "$LIVE_DRILL" --selftest
    expect "live-events runtime REAL RUN green"       0 sh -c "node --experimental-strip-types --test '$LIVE_DRILL' > '$LIVE_LOG' 2>&1 && { grep -q 'live-events runtime drill: GREEN (real fs events + reveal chain over real on-disk state)' '$LIVE_LOG' || grep -q 'live-events runtime drill: SKIP' '$LIVE_LOG'; }"
    expect "live-events runtime forced SKIP exit 0"   0 env FLAUZ_LIVE_EVENTS_RUNTIME_SKIP=1 node --experimental-strip-types "$LIVE_DRILL"
    expect "live-events runtime usage error"          2 node --experimental-strip-types "$LIVE_DRILL" --bogus-flag
    rm -f "$LIVE_LOG"
else
    echo "  note  session-battery run cases need node >= 22.6 (runner has $(node --version)) -- covered by the flauz-session CI lane"
fi
expect "session-battery --list exit 0"                  0 node "$S/session-battery.mjs" --list
expect "session-battery usage error (unknown flag)"     2 node "$S/session-battery.mjs" --bogus-flag

# ---- agentos-battery (TL2-S3): the Agent OS runtime verification gate ----
# The battery runner needs node >= 22.6 (type stripping). On older nodes the
# gate SKIPs (exit 0) -- the run/failability cases only apply where the
# runner can actually run; the flauz-agentos CI lane pins node 22 and runs
# the full matrix. The --list/usage cases are runner-independent.
NODE_MAJOR_AB="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR_AB="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR_AB" -gt 22 ] || { [ "$NODE_MAJOR_AB" -eq 22 ] && [ "$NODE_MINOR_AB" -ge 6 ]; }; then
    AB="$S/agentos-battery.mjs"
    ABF="$F/agentos-battery"
    ABRUNTIME="$ROOT/extensions/flauz-workflow/test/canaries/agentos-runtime.drill.ts"
    expect "agentos-battery default rung PASS"          0 node "$AB" --root "$ROOT"
    expect "agentos-battery --json exit 0"              0 node "$AB" --root "$ROOT" --json
    expect "agentos-battery golden verdict control PASS"    0 node "$AB" --verdict "$ABF/golden-verdict.json"
    expect "agentos-battery doctored missing-row FAIL"      1 node "$AB" --verdict "$ABF/doctored-verdict-missing-row.json"
    expect "agentos-battery doctored blind-fail FAIL"       1 node "$AB" --verdict "$ABF/doctored-verdict-blind-fail.json"
    expect "agentos-battery surge-rung all-green (census complete)"     0 node "$AB" --root "$ROOT" --surge-rung
    expect "agentos-battery runtime selftest PASS"      0 node --experimental-strip-types "$ABRUNTIME" --selftest
    # The FULL runtime rung (real child processes + real CDP + the stub
    # provider server) needs FLAUZ_CDP_ENDPOINT -- that lane lives in the
    # flauz-agentos CI job `agentos-runtime`, never here. Zero-dep here:
    # the gate's --runtime SKIP semantics (both modes).
    expect "agentos-battery --runtime no-endpoint SKIP"  0 env FLAUZ_CDP_ENDPOINT= node "$AB" --runtime
    expect "agentos-battery --runtime --require no-endpoint FAIL"  1 env FLAUZ_CDP_ENDPOINT= node "$AB" --runtime --require
else
    echo "  note  agentos-battery run cases need node >= 22.6 (runner has $(node --version)) -- covered by the flauz-agentos CI lane"
fi
expect "agentos-battery --list exit 0"                  0 node "$S/agentos-battery.mjs" --list
expect "agentos-battery usage error (unknown flag)"     2 node "$S/agentos-battery.mjs" --bogus-flag

# ---- security-gate (TL4-006): integrated security + release gate ----
expect "security-gate clean fixture PASS"              0 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/clean"
expect "security-gate planted-github FAIL"             1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-github"
expect "security-gate planted-neon FAIL"               1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-neon"
expect "security-gate planted-connstring FAIL"         1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-connstring"
expect "security-gate planted-key FAIL"                1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-key"
expect "security-gate allowlist suppression PASS"      0 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/allowlist-case" --allowlist "$F/security-gate/allowlist-case/allowlist.json"
expect "security-gate repo mode PASS"                 0 node "$S/security-gate.mjs" --root "$ROOT"
expect "security-gate --list exit 0"                   0 node "$S/security-gate.mjs" --list

# ---- verify-product (TL1-002): merged product posture gate ----
# Every rule family has a fixture that makes it FAIL (a gate that cannot fail
# is not a gate); fixtures under test/fixtures/product-shell/. Content-level
# assertions live in node --test build/flauz/verify-product.test.mjs.
VP="$S/verify-product.mjs"
VPF="$F/product-shell"
expect "verify-product clean fixture PASS"            0 node "$VP" --root "$VPF/clean" --require
expect "verify-product real tree PASS"                0 node "$VP" --root "$ROOT" --require
expect "verify-product branding FAIL (VS Code name)"  1 node "$VP" --root "$VPF/fail-branding" --require
expect "verify-product branding FAIL (msft url)"      1 node "$VP" --root "$VPF/fail-branding-url" --require
expect "verify-product copilot agent FAIL"            1 node "$VP" --root "$VPF/fail-copilot-agent" --require
expect "verify-product copilot residue FAIL"          1 node "$VP" --root "$VPF/fail-copilot-residue" --require
expect "verify-product proposal missing FAIL"         1 node "$VP" --root "$VPF/fail-proposal-missing" --require
expect "verify-product proposal drift FAIL"           1 node "$VP" --root "$VPF/fail-proposal-drift" --require
expect "verify-product unknown proposal FAIL"         1 node "$VP" --root "$VPF/fail-unknown-proposal" --require
expect "verify-product invented grant FAIL"           1 node "$VP" --root "$VPF/fail-invented-grant" --require
expect "verify-product stale grant FAIL"              1 node "$VP" --root "$VPF/fail-stale-grant" --require
expect "verify-product inclusion builtin FAIL"        1 node "$VP" --root "$VPF/fail-inclusion-builtin" --require
expect "verify-product excluded-list FAIL"            1 node "$VP" --root "$VPF/fail-excluded-list" --require
expect "verify-product missing src FAIL"              1 node "$VP" --root "$VPF/fail-missing-src" --require
expect "verify-product missing manifest FAIL"         1 node "$VP" --root "$VPF/fail-missing-manifest" --require
expect "verify-product main convention FAIL"          1 node "$VP" --root "$VPF/fail-main-convention" --require
expect "verify-product invalid overlay FAIL"          1 node "$VP" --root "$VPF/fail-invalid-overlay" --require
expect "verify-product unknown key WARN (exit 0)"     0 node "$VP" --root "$VPF/warn-unknown-key" --require
expect "verify-product no-overlay SKIP"               0 node "$VP" --root "$VPF/fail-no-overlay"
expect "verify-product no-overlay --require FAIL"     1 node "$VP" --root "$VPF/fail-no-overlay" --require
expect "verify-product empty dir SKIP"                0 node "$VP" --root "$F/perf-timers"
expect "verify-product empty dir --require FAIL"      1 node "$VP" --root "$F/perf-timers" --require
expect "verify-product usage error (bad flag)"        2 node "$VP" --bogus
expect "verify-product --help"                        0 node "$VP" --help
expect "node --test verify-product.test.mjs"          0 node --test "$ROOT/build/flauz/verify-product.test.mjs"
# ---- security-runtime-gate (TL4-009): audit-delta + SBOM + bundle-manifest ----
# Fixture inputs are SYNTHETIC (npm-audit-shaped reports with GHSA-aaaa-...
# ids, synthetic package pairs, synthetic dist trees) -- zero-dep: no npm
# spawn, no network, no esbuild. The repo-mode cases at the end pin the
# skip-vs-fail policy shapes and only run where the tree is NOT installed
# (worker sandbox / CI job 1); post-install contexts (the station, job 2)
# run the real rows.
SRT="$S/security-runtime-gate.mjs"
SRF="$F/security-runtime"
SRTD="$SRF/delta"
SRTA="$SRF/audit"
# audit row: delta filter + severity policy (synthetic reports)
expect "runtime audit clean PASS"                        0 node "$SRT" --row audit --audit-json "$SRTA/clean.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json"
expect "runtime audit high-in-delta FAIL"                1 node "$SRT" --row audit --audit-json "$SRTA/high-in-delta.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json"
expect "runtime audit critical-in-delta FAIL"            1 node "$SRT" --row audit --audit-json "$SRTA/critical-in-delta.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json"
expect "runtime audit moderate-in-delta PASS (info)"     0 node "$SRT" --row audit --audit-json "$SRTA/moderate-in-delta.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json"
expect "runtime audit outside-delta PASS (info)"         0 node "$SRT" --row audit --audit-json "$SRTA/outside-delta.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json"
expect "runtime audit allowlisted PASS (suppressed)"     0 node "$SRT" --row audit --audit-json "$SRTA/allowlisted.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --audit-allowlist "$SRTA/audit-allowlist.json"
expect "runtime audit unused-allowlist-entry FAIL"       1 node "$SRT" --row audit --audit-json "$SRTA/clean.json" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --audit-allowlist "$SRTA/audit-allowlist.json"
# audit row: the delta computation itself (json content assertions)
expect "runtime delta computation (json content)"        0 node -e "
const cp = require('child_process');
const r = cp.spawnSync(process.execPath, ['$SRT', '--row', 'audit', '--audit-json', '$SRTA/clean.json', '--package-json', '$SRTD/product.json', '--upstream-package-json', '$SRTD/upstream.json', '--json'], { encoding: 'utf-8', maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) { console.error('gate exit ' + r.status); process.exit(1); }
const row = JSON.parse(r.stdout).rows.find(x => x.id === 'audit-delta');
const d = row.audit.delta;
const added = d.added.map(x => x.name + '@' + x.range + ':' + x.section);
const ok = JSON.stringify(added) === JSON.stringify(['flauz-dep-a@^1.2.3:dependencies', 'flauz-dep-b@2.0.0:dependencies', 'flauz-devtool-c@^0.9.0:devDependencies'])
    && JSON.stringify(d.removed) === JSON.stringify(['upstream-only'])
    && JSON.stringify(d.unchanged) === JSON.stringify(['shared-dev', 'shared-lib']);
if (!ok) { console.error('delta mismatch: ' + JSON.stringify(d)); process.exit(1); }
console.log('delta content ok');
"
# sbom row: verify postures over the synthetic extension tree + delta pair
SRTS="$SRF/sbom"
expect "runtime sbom verify match PASS"                  0 node "$SRT" --row sbom --extensions-root "$SRTS/extensions" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --verify-sbom "$SRTS/expected-sbom.json"
expect "runtime sbom missing-extension FAIL"             1 node "$SRT" --row sbom --extensions-root "$SRTS/extensions" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --verify-sbom "$SRTS/missing-extension.json"
expect "runtime sbom invalid FAIL"                       1 node "$SRT" --row sbom --extensions-root "$SRTS/extensions" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --verify-sbom "$SRTS/invalid.json"
expect "runtime sbom drift FAIL"                         1 node "$SRT" --row sbom --extensions-root "$SRTS/extensions" --package-json "$SRTD/product.json" --upstream-package-json "$SRTD/upstream.json" --verify-sbom "$SRTS/drifted.json"
# sbom row: emit determinism + byte-compare vs the committed expected document
SRTT="$(mktemp -d 2>/dev/null || echo "/tmp/flauz-srt-$$")"
mkdir -p "$SRTT"
expect "runtime sbom emit deterministic + byte-match"    0 sh -c "node '$SRT' --row sbom --extensions-root '$SRTS/extensions' --package-json '$SRTD/product.json' --upstream-package-json '$SRTD/upstream.json' --sbom-out '$SRTT/a.json' && node '$SRT' --row sbom --extensions-root '$SRTS/extensions' --package-json '$SRTD/product.json' --upstream-package-json '$SRTD/upstream.json' --sbom-out '$SRTT/b.json' && cmp -s '$SRTT/a.json' '$SRTT/b.json' && cmp -s '$SRTT/a.json' '$SRTS/expected-sbom.json'"
# manifest row: fixture verify over the synthetic dist trees (no bundling)
SRTM="$SRF/manifest"
expect "runtime manifest match PASS"                     0 node "$SRT" --row manifest --extensions-root "$SRTM/extensions" --manifest "$SRTM/pinned-match.json"
expect "runtime manifest drift FAIL"                     1 node "$SRT" --row manifest --extensions-root "$SRTM/extensions" --manifest "$SRTM/pinned-drift.json"
expect "runtime manifest unpinned-extension FAIL"        1 node "$SRT" --row manifest --extensions-root "$SRTM/extensions" --manifest "$SRTM/pinned-incomplete.json"
# usage / flag contracts
expect "runtime gate usage error (bad flag)"             2 node "$SRT" --bogus
expect "runtime gate fixture flag needs --row"           2 node "$SRT" --audit-json "$SRTA/clean.json"
expect "runtime gate unknown row id"                     2 node "$SRT" --row nonsense
expect "runtime gate --help"                             0 node "$SRT" --help
expect "runtime gate --list"                             0 node "$SRT" --list
# repo-mode shapes: skip-vs-fail policy (pre-install contexts only).
# Station fix (2026-09-27, riding the TL4-009 merge): the guard must mirror
# the gate's resolveEsbuild candidate list -- a station that installs ONLY
# build/node_modules (the manifest pin-generation posture) has no root
# install yet a RESOLVABLE esbuild, so the no-esbuild shape cases would
# deviate. The six cases pin the BOTH-absent shape (worker sandbox /
# CI job 1); any esbuild-present context runs the real rows instead.
ESB_CAN=""
for _c in "$ROOT/node_modules/esbuild/bin/esbuild" "$ROOT/node_modules/.bin/esbuild" "$ROOT/build/node_modules/esbuild/bin/esbuild"; do
    if [ -e "$_c" ]; then ESB_CAN="$_c"; break; fi
done
if [ ! -d "$ROOT/node_modules" ] && [ -z "$ESB_CAN" ]; then
    expect "runtime gate repo mode PASS (skip shapes)"   0 node "$SRT" --root "$ROOT"
    expect "runtime gate repo mode --require FAIL"       1 node "$SRT" --root "$ROOT" --require
    expect "runtime audit repo SKIP (no install)"        0 node "$SRT" --row audit --root "$ROOT"
    expect "runtime audit repo --require FAIL"           1 node "$SRT" --row audit --root "$ROOT" --require
    expect "runtime manifest repo SKIP (no esbuild)"     0 node "$SRT" --row manifest --root "$ROOT"
    expect "runtime manifest --generate no-esbuild FAIL" 1 node "$SRT" --row manifest --root "$ROOT" --generate --manifest "$SRTT/never-written.json"
else
    echo "  note  runtime repo-mode skip/require cases need a pre-install, esbuild-free tree (no root node_modules AND no resolvable esbuild) -- post-install / station-pin contexts run the real rows (flauz-security job 2)"
fi
rm -rf "$SRTT"

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
