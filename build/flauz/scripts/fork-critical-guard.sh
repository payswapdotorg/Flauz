#!/bin/sh
# ---------------------------------------------------------------------------------------------
# Flauz Wave 3 — Lane H (perf harness + CI + budget enforcement)
#
# fork-critical-guard.sh — FORK-CRITICAL ledger gate (DL-12 / DL-10; MIGRATION-PLAN
# section 5 local hygiene subset item 1; section 6 PR review gate 1).
#
# Asserts that the diff between the pristine upstream base and the Flauz head
# touches NOTHING under src/vs except the single additive dir
# src/vs/workbench/contrib/flauz (F-01 escape hatch, which itself requires a
# DECISION-LOG entry). Any violation = FORK-CRITICAL ledger entry required = CI
# must fail until TL adjudicates or the patch is demoted.
#
# Modes:
#   fork-critical-guard.sh [--base <ref>] [--head <ref>] [--repo <dir>]
#       Default refs: base = upstream/main, falling back to origin/main, falling
#       back to main; head = HEAD. Ref-vs-ref check (the CI shape, MIGRATION section 5.1:
#       git diff --stat upstream/main...flauz/main -- src/vs ':(exclude)src/vs/workbench/contrib/flauz'
#       must be EMPTY).
#
#   fork-critical-guard.sh --staged [--base <ref>]
#       Checks the INDEX (staged changes) against the base — the pre-commit-hook
#       shape. Install locally:
#         cp build/flauz/scripts/fork-critical-guard.sh .git/hooks/pre-commit
#         chmod +x .git/hooks/pre-commit
#       (--pre-commit is an alias that prints hook-friendly output.)
#
#   fork-critical-guard.sh --worktree [--base <ref>]
#       Checks uncommitted working-tree changes (tracked files) — the "am I about
#       to commit a fork?" smoke check before staging.
#
# Options:
#   --base <ref>    base ref (default: first existing of upstream/main, origin/main, main)
#   --head <ref>    head ref (default: HEAD; ignored with --staged/--worktree)
#   --repo <dir>    run inside this repository (default: cwd)
#   --name-only     print offending paths only (machine mode; still exit 1 on drift)
#   --quiet         suppress the explanatory banner
#
# Exit codes:
#   0  guard PASS — src/vs is pristine outside contrib/flauz (ledger stays EMPTY)
#   1  guard FAIL — forbidden src/vs divergence present (paths printed)
#   2  usage error / not a git repo / base ref missing
#
# POSIX sh only. No dependencies beyond git.
# ---------------------------------------------------------------------------------------------

set -u

BASE=""
HEAD_REF=""
REPO=""
MODE="refs"
NAME_ONLY=0
QUIET=0

usage() {
    cat <<'EOF'
fork-critical-guard.sh — FORK-CRITICAL ledger gate (DL-12/DL-10)

Usage:
  fork-critical-guard.sh [--base <ref>] [--head <ref>] [--repo <dir>] [--name-only] [--quiet]
  fork-critical-guard.sh --staged|--pre-commit|--worktree [--base <ref>] [...]

Default base resolution: upstream/main -> origin/main -> main.
Exit codes: 0 pass · 1 forbidden src/vs divergence · 2 usage/repo error.
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --base)       BASE="${2:-}"; shift 2 ;;
        --head)       HEAD_REF="${2:-}"; shift 2 ;;
        --repo)       REPO="${2:-}"; shift 2 ;;
        --staged|--pre-commit) MODE="staged"; shift ;;
        --worktree)   MODE="worktree"; shift ;;
        --name-only)  NAME_ONLY=1; shift ;;
        --quiet|-q)   QUIET=1; shift ;;
        -h|--help)    usage; exit 0 ;;
        *)            echo "fork-critical-guard: unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [ -n "$REPO" ]; then
    if ! cd "$REPO" 2>/dev/null; then
        echo "fork-critical-guard: cannot enter repo dir: $REPO" >&2
        exit 2
    fi
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "fork-critical-guard: not inside a git work tree (cwd=$(pwd))" >&2
    exit 2
fi

# resolve base ref
if [ -z "$BASE" ]; then
    for candidate in upstream/main origin/main main; do
        if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
            BASE="$candidate"
            break
        fi
    done
fi
if [ -z "$BASE" ]; then
    echo "fork-critical-guard: no base ref found (tried upstream/main, origin/main, main) — pass --base <ref>" >&2
    exit 2
fi
if ! git rev-parse --verify --quiet "$BASE" >/dev/null 2>&1; then
    echo "fork-critical-guard: base ref '$BASE' does not exist" >&2
    exit 2
fi

# build the diff command per mode
# note: the pathspec magic excludes the ONE additive escape hatch (F-01).
PATHSPEC="src/vs :(exclude)src/vs/workbench/contrib/flauz"

case "$MODE" in
    refs)
        if [ -z "$HEAD_REF" ]; then HEAD_REF="HEAD"; fi
        if ! git rev-parse --verify --quiet "$HEAD_REF" >/dev/null 2>&1; then
            echo "fork-critical-guard: head ref '$HEAD_REF' does not exist" >&2
            exit 2
        fi
        DIFF_ARGS="$BASE...$HEAD_REF"
        DIFF_LABEL="$BASE...$HEAD_REF"
        ;;
    staged)
        # diff base-tree vs index: forbidden paths among STAGED changes
        DIFF_ARGS="$BASE --cached"
        DIFF_LABEL="$BASE vs INDEX (staged)"
        ;;
    worktree)
        DIFF_ARGS="$BASE"
        DIFF_LABEL="$BASE vs WORKTREE (uncommitted, tracked)"
        ;;
esac

if [ "$NAME_ONLY" -eq 1 ]; then
    STAT="$(git diff --name-only $DIFF_ARGS -- $PATHSPEC 2>/dev/null)"
else
    STAT="$(git diff --stat $DIFF_ARGS -- $PATHSPEC 2>/dev/null)"
fi

if [ -z "$STAT" ]; then
    if [ "$QUIET" -ne 1 ]; then
        echo "fork-critical-guard: PASS — src/vs divergence outside contrib/flauz is EMPTY ($DIFF_LABEL)."
        echo "fork-critical-guard: FORK-CRITICAL ledger stays EMPTY (DL-12/DL-10)."
    fi
    exit 0
fi

# violation
if [ "$NAME_ONLY" -ne 1 ]; then
    echo "fork-critical-guard: FAIL — forbidden src/vs divergence detected ($DIFF_LABEL):" >&2
    echo "" >&2
    echo "$STAT" >&2
    echo "" >&2
    echo "src/vs must stay byte-identical to upstream except src/vs/workbench/contrib/flauz" >&2
    echo "(F-01 escape hatch — requires a DECISION-LOG entry with a demotion alternative)." >&2
    echo "Demote the change to an additive path (extensions/flauz-*, build/flauz/, product.flauz.json)" >&2
    echo "or get a TL adjudicated DECISION-LOG entry BEFORE merging (MIGRATION-PLAN section 6 gate 1)." >&2
else
    echo "$STAT"
fi
exit 1
