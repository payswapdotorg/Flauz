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
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/eventually.json"      > "$BGIN/eventually.process.json"
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/after-session.json"   > "$BGIN/after-session.process.json"
    node "$S/perf-log-parse.mjs" --parse-process-json "$F/process-shape/after-session.violations.json" > "$BGINV/after-session.process.json"
); then
    PASS=$((PASS + 1))
    [ "$QUIET" -eq 0 ] && printf '  ok    %-52s mapped 7 inputs\n' "budget-gate input mapping (perf-log-parse)"
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
else
    echo "  note  session-battery run cases need node >= 22.6 (runner has $(node --version)) -- covered by the flauz-session CI lane"
fi
expect "session-battery --list exit 0"                  0 node "$S/session-battery.mjs" --list
expect "session-battery usage error (unknown flag)"     2 node "$S/session-battery.mjs" --bogus-flag

# ---- security-gate (TL4-006): integrated security + release gate ----
expect "security-gate clean fixture PASS"              0 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/clean"
expect "security-gate planted-github FAIL"             1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-github"
expect "security-gate planted-neon FAIL"               1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-neon"
expect "security-gate planted-connstring FAIL"         1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-connstring"
expect "security-gate planted-key FAIL"                1 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/planted-key"
expect "security-gate allowlist suppression PASS"      0 node "$S/security-gate.mjs" --scan-tree "$F/security-gate/allowlist-case" --allowlist "$F/security-gate/allowlist-case/allowlist.json"
expect "security-gate repo mode PASS"                 0 node "$S/security-gate.mjs" --root "$ROOT"
expect "security-gate --list exit 0"                   0 node "$S/security-gate.mjs" --list

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
